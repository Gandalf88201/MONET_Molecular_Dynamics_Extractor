"""
MONET fast trajectory I/O for XYZ / extended XYZ.

A frame-offset index is built once with numpy (newline search in large chunks)
and cached on disk, so later requests can jump to any frame and parse only the
frames and atoms they need. Parsing converts whole token blocks at a time.

Validation matches the JavaScript parser where it matters: constant atom
count, complete frames, constant element order, finite coordinates. Frame
headers are checked while indexing; element order and coordinates are checked
whenever a frame is parsed (every frame during extraction).
"""
import hashlib
import json
import mmap
import os
from pathlib import Path
import re
import time

import numpy as np

CHUNK = 64 << 20
INDEX_VERSION = 2
CACHE_DAYS = 30
# The index file holds only these attributes (plus offsets); anything else in a cache file is ignored.
_CACHE_KEYS = ('natoms', 'symbols', 'format', 'ncols', 'comment0', 'species_col', 'pos_col', 'properties', 'first', 'raw_symbols')
_SYMBOL = re.compile(r'^[A-Za-z]{1,3}$')


class TrajectoryError(ValueError):
    pass


def _normalize(symbol):
    return symbol[:1].upper() + symbol[1:].lower()


def _cache_dir():
    """Per-user index cache: $MONET_CACHE_DIR, else $XDG_CACHE_HOME/monet/index or ~/.cache/monet/index.

    It is never a shared folder such as /tmp, where another user of the machine could place index files.
    """
    base = os.environ.get('XDG_CACHE_HOME') or os.path.join(Path.home(), '.cache')
    path = os.environ.get('MONET_CACHE_DIR') or os.path.join(base, 'monet', 'index')
    os.makedirs(path, mode=0o700, exist_ok=True)
    return path


def _prune_cache(folder, days=CACHE_DAYS):
    """Delete index files not used for `days` days."""
    limit = time.time() - days * 86400
    for entry in os.scandir(folder):
        try:
            if entry.name.endswith('.npz') and entry.stat().st_mtime < limit:
                os.remove(entry.path)
        except OSError:
            pass


def _cache_path(path):
    stat = os.stat(path)
    key = f'{os.path.abspath(path)}|{stat.st_size}|{stat.st_mtime_ns}|{INDEX_VERSION}'
    return os.path.join(_cache_dir(), hashlib.sha256(key.encode()).hexdigest()[:32] + '.npz')


def is_xyz(path):
    """True when the file starts like an XYZ trajectory (atom count line)."""
    try:
        with open(path, 'rb') as fh:
            head = fh.read(4096)
    except OSError:
        return False
    for line in head.lstrip(b'\xef\xbb\xbf').splitlines():
        if line.strip():
            return line.strip().isdigit()
    return False


class XYZTrajectory:
    """Random access to the frames of an XYZ or extended XYZ file."""

    def __init__(self, path, progress=None, use_cache=True):
        self.path = path
        self.size = os.path.getsize(path)
        cache = _cache_path(path) if use_cache else None
        if cache and os.path.exists(cache):
            try:
                self._load(cache)
                os.utime(cache)  # recently used: kept by _prune_cache
                return
            except Exception:
                pass
        self._first_frame()
        try:
            self.offsets = self._fast_index(progress)
        except TrajectoryError:
            self.offsets = self._slow_index(progress)
        self._parse(0)
        if cache:
            try:
                self._save(cache)
                _prune_cache(os.path.dirname(cache))
            except OSError:
                pass

    # ── index ────────────────────────────────────────────────────────────────

    def _save(self, cache):
        meta = {k: getattr(self, k) for k in ('natoms', 'symbols', 'format', 'ncols', 'comment0',
                                              'species_col', 'pos_col', 'properties', 'first')}
        meta['raw_symbols'] = [s.decode('ascii') for s in self.raw_symbols]
        tmp = cache + f'.{os.getpid()}.tmp.npz'
        np.savez(tmp, offsets=self.offsets, meta=json.dumps(meta))
        os.replace(tmp, cache)

    def _load(self, cache):
        with np.load(cache) as data:
            self.offsets = data['offsets']
            meta = json.loads(str(data['meta']))
        if not isinstance(meta, dict) or set(meta) != set(_CACHE_KEYS):
            raise ValueError('Not a MONET index file.')
        for key in _CACHE_KEYS:
            setattr(self, key, meta[key])
        self.raw_symbols = np.array([s.encode('ascii') for s in self.raw_symbols])

    def _first_frame(self):
        with open(self.path, 'rb') as fh:
            offset = 0
            line_no = 0
            line = fh.readline()
            if line.startswith(b'\xef\xbb\xbf'):
                offset, line = 3, line[3:]
            while line and not line.strip():
                offset += len(line)
                line_no += 1
                line = fh.readline()
            if not line:
                raise TrajectoryError('The file contains no XYZ frames.')
            line_no += 1
            text = line.strip()
            if not text.isdigit():
                raise TrajectoryError(f'Line {line_no}: Expected an XYZ atom count.')
            self.natoms = int(text)
            if self.natoms < 1:
                raise TrajectoryError(f'Line {line_no}: Atom count must be a positive integer.')
            self.first = offset
            comment = fh.readline()
            if not comment:
                raise TrajectoryError('Incomplete XYZ frame 1; check the atom count and comment line.')
            comment = comment.decode('utf-8', 'replace').rstrip('\r\n')
            self.comment0 = comment
            if re.search(r'STEP\s*[=:]', comment, re.I):
                self.format = 'CPMD'
            elif re.search(r'\bi\s*=', comment):
                self.format = 'CP2K'
            else:
                self.format = 'XYZ'
            self.properties = None
            self.species_col, self.pos_col, required = 0, 1, 4
            match = re.search(r'\bProperties=(\S+)', comment)
            if match:
                self.properties = match.group(1).strip('"')
                fields = self.properties.split(':')
                if len(fields) % 3:
                    raise TrajectoryError(f'Line {line_no + 1}: Invalid extended XYZ Properties header.')
                col, self.species_col, self.pos_col = 0, -1, -1
                for i in range(0, len(fields), 3):
                    width = int(fields[i + 2]) if fields[i + 2].isdigit() else 0
                    if width < 1:
                        raise TrajectoryError(f'Line {line_no + 1}: Invalid extended XYZ property width.')
                    if fields[i] == 'species' and width == 1:
                        self.species_col = col
                    if fields[i] == 'pos' and width == 3:
                        self.pos_col = col
                    col += width
                if self.species_col < 0 or self.pos_col < 0:
                    raise TrajectoryError(f'Line {line_no + 1}: Extended XYZ requires species and pos properties.')
                required = col
            rows = []
            for k in range(self.natoms):
                row = fh.readline()
                if not row:
                    raise TrajectoryError('Incomplete XYZ frame 1; check the atom count and comment line.')
                fields = row.split()
                if len(fields) < required:
                    raise TrajectoryError(f'Line {line_no + 2 + k}: Incomplete atom row; expected element and x, y, z coordinates.')
                symbol = fields[self.species_col].decode('ascii', 'replace')
                if not _SYMBOL.match(symbol):
                    raise TrajectoryError(f'Line {line_no + 2 + k}: Invalid element symbol.')
                rows.append(len(fields))
            self.raw_symbols = None
            # Plain XYZ files may carry extra columns; they are ignored like in ASE.
            self.ncols = rows[0] if len(set(rows)) == 1 and (self.properties is None or rows[0] == required) else None
            if self.properties is not None and self.ncols is None:
                raise TrajectoryError('Extended XYZ rows do not match the Properties header.')

    def _check_header(self, block, frame):
        if block.strip() != str(self.natoms).encode():
            text = block.strip()
            if text.isdigit():
                raise TrajectoryError(f'Frame {frame + 1}: The number of atoms must stay constant across frames.')
            raise TrajectoryError(f'Frame {frame + 1}: Expected an XYZ atom count.')

    def _fast_index(self, progress):
        """Frame boundaries every natoms+2 lines; any irregularity falls back to _slow_index."""
        period = self.natoms + 2
        count = str(self.natoms).encode()
        ends = []
        line_no = 0          # lines completed so far (relative to self.first)
        last_start = 0       # start offset of the current line, relative to buffer
        with open(self.path, 'rb') as fh:
            fh.seek(self.first)
            base = self.first
            carry = b''
            header_start = self.first
            while True:
                chunk = fh.read(CHUNK)
                buf = carry + chunk
                if not buf:
                    break
                arr = np.frombuffer(buf, dtype=np.uint8)
                nl = np.flatnonzero(arr == 10)
                if not chunk:
                    # Final line without a newline terminator.
                    nl = np.append(nl, len(buf))
                if len(nl):
                    idx = np.arange(line_no, line_no + len(nl))
                    starts = np.concatenate(([0], nl[:-1] + 1))
                    for j in np.flatnonzero(idx % period == 0):
                        header = buf[starts[j]:nl[j]]
                        if header.strip() != count:
                            if not header.strip() and not buf[starts[j]:].strip() and not fh.read(1 << 20).strip():
                                # Only whitespace remains: trailing blank lines.
                                return self._finish(ends)
                            raise TrajectoryError('irregular')
                    for j in np.flatnonzero(idx % period == period - 1):
                        ends.append(base + int(nl[j]) + 1)
                    line_no += len(nl)
                    cut = int(nl[-1]) + 1
                else:
                    cut = 0
                carry = buf[cut:]
                base += cut
                if not chunk:
                    break
                if progress:
                    progress(f'Indexing frames … {len(ends):,}', min(95, 100 * fh.tell() / max(self.size, 1)))
        if line_no % period:
            # A partial frame: acceptable only when the remainder is whitespace.
            tail_start = ends[-1] if ends else self.first
            with open(self.path, 'rb') as fh:
                fh.seek(tail_start)
                while True:
                    block = fh.read(CHUNK)
                    if not block:
                        break
                    if block.strip():
                        raise TrajectoryError('irregular')
        return self._finish(ends)

    def _finish(self, ends):
        if not ends:
            raise TrajectoryError('Incomplete XYZ frame 1; check the atom count and comment line.')
        return np.array([self.first] + ends, dtype=np.int64)

    def _slow_index(self, progress):
        """Line-by-line index that tolerates blank lines between frames (like the JS parser)."""
        starts = []
        phase, remaining, offset, line_no = 'count', 0, 0, 0
        with open(self.path, 'rb') as fh:
            for line in fh:
                if line_no == 0 and line.startswith(b'\xef\xbb\xbf'):
                    offset += 3
                    line = line[3:]
                line_no += 1
                if phase == 'count':
                    if line.strip():
                        self._check_header(line, len(starts))
                        starts.append(offset)
                        phase = 'comment'
                elif phase == 'comment':
                    phase, remaining = 'atoms', self.natoms
                else:
                    if len(line.split()) < 4:
                        raise TrajectoryError(f'Line {line_no}: Incomplete atom row; expected element and x, y, z coordinates.')
                    remaining -= 1
                    if not remaining:
                        phase = 'count'
                offset += len(line)
                if progress and line_no % 2_000_000 == 0:
                    progress(f'Indexing frames … {len(starts):,}', min(95, 100 * offset / max(self.size, 1)))
        if phase != 'count':
            raise TrajectoryError(f'Incomplete XYZ frame {len(starts)}; check the atom count and comment line.')
        if not starts:
            raise TrajectoryError('The file contains no XYZ frames.')
        return np.array(starts + [self.size], dtype=np.int64)

    # ── access ───────────────────────────────────────────────────────────────

    @property
    def nframes(self):
        return len(self.offsets) - 1

    def info(self):
        return {'atomCount': self.natoms, 'configCount': self.nframes, 'format': self.format,
                'symbols': self.symbols_list(), 'extended': self.properties is not None}

    def symbols_list(self):
        if self.raw_symbols is None:
            self._parse(0)
        return list(self.symbols)

    def atom_properties(self):
        """Extra per-atom extended-XYZ columns (resname, resid, atomname) from the first frame."""
        if not self.properties:
            return {}
        fields = self.properties.split(':')
        wanted, col = {}, 0
        for i in range(0, len(fields), 3):
            name, kind, width = fields[i], fields[i + 1], int(fields[i + 2])
            if name in ('resname', 'resid', 'atomname') and width == 1:
                wanted[name] = (col, kind)
            col += width
        if not wanted:
            return {}
        with open(self.path, 'rb') as fh, mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ) as mm:
            parts = self._block(mm, 0).split(b'\n', 2)
            table = self._tokens(parts[2], 0)
        return {name: [int(v) if kind == 'I' else v.decode('utf-8', 'replace') for v in table[:, column]]
                for name, (column, kind) in wanted.items()}

    def frame_indices(self, step=1, start=0, stop=None):
        if not isinstance(step, int) or step < 1:
            raise ValueError('Frame step must be a positive integer.')
        return range(start, self.nframes if stop is None else min(stop, self.nframes), step)

    def write_frames(self, indices, output):
        """Copy the given frames byte for byte (atom rows and lattice kept), tagging each comment
        with source_frame=<index in this file>; an existing tag (from an earlier subsampling) is kept,
        so it always refers to the original trajectory."""
        count = 0
        with open(self.path, 'rb') as fh, mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ) as mm, open(output, 'wb') as out:
            for frame in indices:
                block = self._block(mm, frame)
                head, comment, rest = block.split(b'\n', 2)
                comment = comment.rstrip(b'\r')
                if not re.search(rb'\bsource_frame=\S+', comment):
                    comment += b' source_frame=%d' % frame
                out.write(head.rstrip(b'\r') + b'\n' + comment + b'\n' + rest)
                if not rest.endswith(b'\n'):
                    out.write(b'\n')
                count += 1
        return count

    def _block(self, mm, frame):
        return mm[self.offsets[frame]:self.offsets[frame + 1]]

    def _tokens(self, rest, frame):
        tokens = rest.split()
        if self.ncols and len(tokens) == self.natoms * self.ncols:
            return np.array(tokens).reshape(self.natoms, self.ncols)
        # Irregular column count: validate row by row, keep element + x y z.
        rows = [line.split() for line in rest.splitlines() if line.strip()]
        need = max(4, self.pos_col + 3)
        if len(rows) != self.natoms or any(len(row) < need for row in rows):
            raise TrajectoryError(f'Frame {frame + 1}: Incomplete atom row; expected element and x, y, z coordinates.')
        width = min(len(row) for row in rows)
        return np.array([row[:width] for row in rows])

    def _parse(self, frame, atoms=None, mm=None):
        """Return (positions[n_sel, 3], comment bytes) for one frame, validating it."""
        if mm is None:
            with open(self.path, 'rb') as fh, mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ) as local:
                return self._parse(frame, atoms, local)
        block = self._block(mm, frame)
        parts = block.split(b'\n', 2)
        if len(parts) < 3:
            raise TrajectoryError(f'Incomplete XYZ frame {frame + 1}; check the atom count and comment line.')
        self._check_header(parts[0], frame)
        if atoms is not None and self.raw_symbols is not None and len(atoms) * 4 < self.natoms:
            return self._parse_subset(parts[2], frame, atoms), parts[1]
        table = self._tokens(parts[2], frame)
        species = table[:, self.species_col]
        if self.raw_symbols is None:
            names = [s.decode('ascii', 'replace') for s in species]
            if any(not _SYMBOL.match(name) for name in names):
                raise TrajectoryError(f'Frame {frame + 1}: Invalid element symbol.')
            self.raw_symbols = species
            self.symbols = [_normalize(name) for name in names]
        elif not np.array_equal(species, self.raw_symbols):
            names = [_normalize(s.decode('ascii', 'replace')) for s in species]
            if names != self.symbols:
                raise TrajectoryError(f'Frame {frame + 1}: Atom order/elements must stay constant across frames.')
        coords = table[:, self.pos_col:self.pos_col + 3] if atoms is None else table[atoms, self.pos_col:self.pos_col + 3]
        try:
            positions = coords.astype(np.float64)
        except ValueError:
            fixed = np.char.replace(np.char.replace(coords, b'D', b'e'), b'd', b'e')
            try:
                positions = fixed.astype(np.float64)
            except ValueError:
                raise TrajectoryError(f'Frame {frame + 1}: Invalid numeric coordinate.') from None
        return self._finite(positions, frame), parts[1]

    def _finite(self, positions, frame):
        if not np.isfinite(positions).all():
            raise TrajectoryError(f'Frame {frame + 1}: Coordinates must be finite numbers.')
        return positions + 0.0

    def _parse_subset(self, rest, frame, atoms):
        # Small selections: split only the requested rows (their elements are still checked).
        lines = rest.split(b'\n', self.natoms)
        if len(lines) < self.natoms or not lines[self.natoms - 1].strip():
            raise TrajectoryError(f'Frame {frame + 1}: Incomplete atom row; expected element and x, y, z coordinates.')
        rows = [lines[i].split() for i in atoms]
        need = self.pos_col + 3
        if any(len(row) < need for row in rows):
            raise TrajectoryError(f'Frame {frame + 1}: Incomplete atom row; expected element and x, y, z coordinates.')
        species = [row[self.species_col] for row in rows]
        expected = self.raw_symbols[atoms]
        if not np.array_equal(np.array(species), expected):
            if [_normalize(s.decode('ascii', 'replace')) for s in species] != [self.symbols[i] for i in atoms]:
                raise TrajectoryError(f'Frame {frame + 1}: Atom order/elements must stay constant across frames.')
        coords = np.array([row[self.pos_col:need] for row in rows])
        try:
            positions = coords.astype(np.float64)
        except ValueError:
            try:
                positions = np.char.replace(np.char.replace(coords, b'D', b'e'), b'd', b'e').astype(np.float64)
            except ValueError:
                raise TrajectoryError(f'Frame {frame + 1}: Invalid numeric coordinate.') from None
        return self._finite(positions, frame)

    def iter_frames(self, frames, atoms=None):
        """Yield (frame_index, positions, comment) for the requested frames."""
        atoms = None if atoms is None else np.asarray(atoms, dtype=np.intp)
        if atoms is not None and len(atoms) and (atoms.min() < 0 or atoms.max() >= self.natoms):
            raise ValueError(f'Use atom indices between 0 and {self.natoms - 1}.')
        with open(self.path, 'rb') as fh, mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ) as mm:
            for frame in frames:
                if not 0 <= frame < self.nframes:
                    raise ValueError('Frame index is outside the trajectory.')
                positions, comment = self._parse(frame, atoms, mm)
                yield frame, positions, comment

    def positions(self, frames, atoms=None):
        frames = list(frames)
        count = self.natoms if atoms is None else len(atoms)
        out = np.empty((len(frames), count, 3))
        for k, (_, pos, _) in enumerate(self.iter_frames(frames, atoms)):
            out[k] = pos
        return out

    def cell(self, comment):
        """Lattice and pbc from an extended XYZ comment line, or (None, None)."""
        if b'Lattice=' not in comment:
            return None, None
        from ase.io.extxyz import key_val_str_to_dict
        info = key_val_str_to_dict(comment.decode('utf-8', 'replace'))
        # Extended XYZ lists a1 a2 a3 as rows. ASE's key_val_str_to_dict returns them as columns
        # (order='F'), so the nine numbers are read here directly, as in the JavaScript engine.
        match = re.search(rb'\bLattice="([^"]+)"', comment)
        if match is None or info.get('Lattice') is None:
            return None, None
        lattice = np.array(match.group(1).split(), dtype=float)
        if lattice.size != 9:
            return None, None
        pbc = info.get('pbc', [True, True, True])
        return lattice.reshape(3, 3), [bool(v) for v in np.atleast_1d(pbc)]

    def atoms(self, frames, indices=None):
        """Yield (frame_index, ase.Atoms) — used by the ASE analyses."""
        from ase import Atoms
        symbols = self.symbols_list()
        if indices is not None:
            symbols = [symbols[i] for i in indices]
        for frame, positions, comment in self.iter_frames(frames, indices):
            atoms = Atoms(symbols, positions=positions)
            lattice, pbc = self.cell(comment)
            if lattice is not None:
                atoms.set_cell(lattice)
                atoms.set_pbc(pbc)
            yield frame, atoms


# ── extraction ───────────────────────────────────────────────────────────────

GAUSSIAN_TEMPLATE = ('%nproc=6\n%chk={chk}\n%mem=4gb\n'
                     '#p ub3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight gfinput gfoldprint pop=full\n\n'
                     '{tag}\n\n0 {mult}\n{positions}\n')


_SOURCE_FRAME = re.compile(r'(?:^|\s)source_frame=(\d+)')


def output_comment(index, comment):
    """Comment line of an extracted frame: its index in the file being extracted, plus the frame of the
    original trajectory when this file is derived (uncorrelated, cropped, PCA selection: source_frame=)."""
    if isinstance(comment, bytes):
        comment = comment.decode('utf-8', 'replace')
    source = _SOURCE_FRAME.search(comment or '')
    return f'frame {index} source_frame={source.group(1)}' if source else f'frame {index}'


def _row_format(symbols):
    return ''.join(f'{symbol}  %.7f  %.7f  %.7f\n' for symbol in symbols)


def extract(traj, out_dir, selected, frequency, compute_average=False, generate_gaussian=False,
            options=None, progress=None, qm_writer=None, cancelled=None):
    """Write the MONET result tree. `selected` holds 1-based MONET atom IDs."""
    if not isinstance(frequency, int) or frequency < 1:
        raise ValueError('Sampling frequency must be a positive integer.')
    ids = sorted(set(selected))
    if not ids or any(type(i) is not int or not 1 <= i <= traj.natoms for i in ids):
        raise ValueError('Select valid atom IDs from the loaded trajectory.')
    indices = np.array(ids, dtype=np.intp) - 1
    dirs = {name: os.path.join(out_dir, name) for name in
            ('0-HISTORY', '1-FULL_TRAJECTORY_EXTRACTED', '2-SAMPLED_CONFIGURATIONS', '3-AVERAGE_STRUCTURE')}
    for name, path in dirs.items():
        if name != '3-AVERAGE_STRUCTURE' or compute_average:
            os.makedirs(path, exist_ok=True)
    with open(os.path.join(dirs['0-HISTORY'], 'run.json'), 'w') as fh:
        json.dump({**(options or {}), 'frequency': frequency, 'selectedAtoms': ids,
                   'computeAverage': compute_average, 'generateGaussian': generate_gaussian}, fh, indent=2)
    symbols = traj.symbols_list()
    selected_symbols = [symbols[i] for i in indices]
    row = _row_format(selected_symbols)
    count = len(ids)
    sums = np.zeros((traj.natoms, 3)) if compute_average else None
    sampled = 0
    full_path = os.path.join(dirs['1-FULL_TRAJECTORY_EXTRACTED'], 'FULL_TRAJECTORY_EXTRACTED.xyz')
    sampled_path = os.path.join(dirs['2-SAMPLED_CONFIGURATIONS'], 'SAMPLED_CONFIGURATIONS.xyz')
    total = traj.nframes
    with open(full_path, 'w', buffering=8 << 20) as full, open(sampled_path, 'w', buffering=1 << 20) as sample:
        # Every atom row is parsed so the whole file is validated, as in the desktop/browser engines.
        for frame, positions, comment in traj.iter_frames(range(total)):
            if compute_average:
                sums += positions
            positions = positions[indices]
            atoms_text = row % tuple(positions.ravel())
            text = f'{count}\n{output_comment(frame, comment)}\n{atoms_text}'
            full.write(text)
            if frame % frequency == 0:
                sample.write(text)
                sampled += 1
                folder = os.path.join(dirs['2-SAMPLED_CONFIGURATIONS'], f'conf{sampled}')
                os.makedirs(folder, exist_ok=True)
                with open(os.path.join(folder, f'pos{sampled}.txt'), 'w') as fh:
                    fh.write(atoms_text)
                if generate_gaussian:
                    for name, mult, chk, tag in (('sing', 1, 's0', 'singlet'), ('trip', 3, 't0', 'triplet')):
                        with open(os.path.join(folder, f'{name}.dat'), 'w') as fh:
                            fh.write(GAUSSIAN_TEMPLATE.format(chk=f'{chk}.chk', tag=f'scf_{tag}', mult=mult, positions=atoms_text))
                if qm_writer:
                    lattice = traj.cell(comment)[0]
                    qm_writer(folder, sampled, frame, selected_symbols, positions,
                              None if lattice is None else lattice.tolist())
            if frame % 500 == 499:
                if cancelled and cancelled():
                    raise RuntimeError('Extraction cancelled.')
                if progress:
                    progress(f'Processed {frame + 1:,} / {total:,} frames …', 100 * (frame + 1) / total)
    if compute_average:
        average = sums / total
        with open(os.path.join(dirs['3-AVERAGE_STRUCTURE'], 'GEO-AVERAGE.xyz'), 'w') as fh:
            fh.write(f'{traj.natoms}\nAVERAGE ({total} frames)\n' + _row_format(symbols) % tuple((average + 0.0).ravel()))
    return {'totalFrames': total, 'sampledFrames': sampled, 'fullTrajectory': full_path}


def zip_tree(folder, destination, progress=None):
    """Store (no compression) for speed; ZIP64 is used automatically when needed."""
    import zipfile
    files = []
    for base, _, names in os.walk(folder):
        for name in sorted(names):
            files.append(os.path.join(base, name))
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_STORED, allowZip64=True) as archive:
        for k, path in enumerate(sorted(files)):
            archive.write(path, os.path.relpath(path, folder))
            if progress and k % 500 == 0:
                progress(f'Packing results … {k:,}/{len(files):,}', 100 * k / max(len(files), 1))
    return destination


if __name__ == '__main__':
    import sys
    import time
    start = time.time()
    trajectory = XYZTrajectory(sys.argv[1], use_cache=False)
    print('index', trajectory.info()['configCount'], f'{time.time() - start:.2f}s')
    start = time.time()
    data = trajectory.positions(trajectory.frame_indices(1), [0, 1, 2, 3])
    print('positions', data.shape, f'{time.time() - start:.2f}s')
    if len(sys.argv) > 2:
        start = time.time()
        extract(trajectory, sys.argv[2], list(range(1, 74)), 10, True, True)
        print('extract', f'{time.time() - start:.2f}s')

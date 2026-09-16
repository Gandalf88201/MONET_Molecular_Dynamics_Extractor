#!/usr/bin/env python3
"""
MONET ASE Bridge
Receives one JSON command on stdin, streams JSON progress lines,
then writes a final JSON result line to stdout.

Protocol
--------
  stdin  : one JSON object (the command)
  stdout : zero-or-more  {"type":"progress","message":"...","percent":0-100}
           followed by exactly one {"type":"result",...}
           or           {"type":"error","message":"..."}
"""
import sys, os, json, traceback, math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import monet_io

try:
    import numpy as np
    import ase
    import ase.io
    from ase.io.formats import ioformats
    _ASE_OK = True
    _ASE_VERSION = ase.__version__
except ImportError as _e:
    _ASE_OK = False
    _ASE_VERSION = None
    _ASE_ERR = str(_e)


# ── helpers ──────────────────────────────────────────────────────────────────

def _emit(obj):
    print(json.dumps(obj, allow_nan=False), flush=True)

def prog(msg, pct=None):
    d = {"type": "progress", "message": msg}
    if pct is not None:
        d["percent"] = round(pct, 1)
    _emit(d)

def ok(**kwargs):
    _emit({"type": "result", "ok": True, **kwargs})

def err(msg):
    _emit({"type": "error", "ok": False, "message": msg})

def _require_ase():
    if not _ASE_OK:
        err(f"ASE not installed. Run:  pip install ase\n({_ASE_ERR})")
        return False
    return True

def _apply_geometry(atoms, cmd):
    if cmd.get('cell') is not None:
        from ase.geometry import cellpar_to_cell
        atoms.set_cell(cellpar_to_cell(cmd['cell']), scale_atoms=False)
        atoms.set_pbc(cmd.get('pbc', [True, True, True]))
    elif cmd.get('pbc') is not None:
        atoms.set_pbc(cmd['pbc'])
    if cmd.get('mic', False) and any(atoms.pbc) and atoms.cell.rank < 3:
        raise ValueError('Periodic calculations require a complete, non-degenerate cell.')
    return atoms


_TRAJECTORIES = {}


def _trajectory(filename):
    """Indexed XYZ/extXYZ access, or None for other formats (read through ASE)."""
    if filename not in _TRAJECTORIES:
        _TRAJECTORIES[filename] = (monet_io.XYZTrajectory(filename, progress=lambda m, p: prog(m, p * .1))
                                   if monet_io.is_xyz(filename) else None)
    return _TRAJECTORIES[filename]


def _first_atoms(filename, cmd):
    traj = _trajectory(filename)
    atoms = next(traj.atoms([0]))[1] if traj else ase.io.read(filename, index=0)
    return _apply_geometry(atoms, cmd)


def _load_images(filename, frame_step=1, max_frames=None, cmd=None, label='Frame'):
    """Generator: yield (frame_index, Atoms) every frame_step frames, reporting progress."""
    if not isinstance(frame_step, int) or frame_step < 1:
        raise ValueError('Frame step must be a positive integer.')
    traj = _trajectory(filename)
    if traj is not None:
        frames = traj.frame_indices(frame_step)
        if max_frames:
            frames = frames[:max_frames]
        total = max(len(frames), 1)
        for k, (i, atoms) in enumerate(traj.atoms(frames)):
            yield i, _apply_geometry(atoms, cmd or {})
            if k % 250 == 249:
                prog(f'{label} {i:,} ({k + 1:,}/{total:,}) …', 10 + 88 * (k + 1) / total)
        return
    count = 0
    for i, atoms in enumerate(ase.io.iread(filename)):
        if i % frame_step != 0:
            continue
        yield i, _apply_geometry(atoms, cmd or {})
        count += 1
        if count % 250 == 0:
            prog(f'{label} {i:,} …')
        if max_frames and count >= max_frames:
            break


# ── actions ──────────────────────────────────────────────────────────────────

def action_check(_):
    if not _ASE_OK:
        return err(f"ASE not found. pip install ase  ({_ASE_ERR})")
    ok(ase_version=_ASE_VERSION, numpy_version=np.__version__)


def action_read_info(cmd):
    if not _require_ase(): return
    filename = cmd["filename"]
    prog("Reading structure …", 5)
    try:
        atoms = _first_atoms(filename, cmd)
        pos   = atoms.get_positions().tolist()
        syms  = list(atoms.get_chemical_symbols())
        prog("Done", 100)
        ok(
            formula   = atoms.get_chemical_formula(),
            n_atoms   = len(atoms),
            symbols   = syms,
            positions = pos,
            cell      = atoms.get_cell().tolist(),
            has_pbc   = any(atoms.get_pbc()),
            pbc       = atoms.get_pbc().tolist(),
            cellpar   = atoms.cell.cellpar().tolist(),
        )
    except Exception:
        err(traceback.format_exc())


def _require_xyz(filename):
    traj = _trajectory(filename)
    if traj is None:
        raise ValueError('MONET needs an XYZ or extended XYZ trajectory here. Import other formats first.')
    return traj


def action_scan(cmd):
    """Index an XYZ trajectory (cached) and report its size; needs only numpy."""
    traj = _require_xyz(cmd['filename'])
    prog('Trajectory indexed', 100)
    ok(**traj.info())


def action_frame(cmd):
    """Atoms of one frame for the viewer: [{index, element, x, y, z}] with 1-based MONET IDs."""
    traj = _require_xyz(cmd['filename'])
    index = cmd.get('index', 0)
    if type(index) is not int or not 0 <= index < traj.nframes:
        raise ValueError('Frame index is outside the trajectory.')
    positions = traj.positions([index])[0]
    symbols = traj.symbols_list()
    ok(atoms=[{'index': i + 1, 'element': symbols[i], 'x': float(x), 'y': float(y), 'z': float(z)}
              for i, (x, y, z) in enumerate(positions.tolist())])


def action_extract(cmd):
    """Core MONET extraction (every frame for selected atoms, sampled configurations, average)."""
    traj = _require_xyz(cmd['filename'])
    out_dir = cmd['output_dir']
    atom_count = cmd.get('atom_count')
    if atom_count is not None and atom_count != traj.natoms:
        raise ValueError('Atom count changed. Load the trajectory again.')
    prog('Reading trajectory …', 0)
    summary = monet_io.extract(
        traj, out_dir, cmd.get('selected') or [], cmd.get('frequency'),
        compute_average=bool(cmd.get('compute_average')), generate_gaussian=bool(cmd.get('generate_gaussian')),
        options=cmd.get('history'), progress=lambda message, pct: prog(message, pct * .9))
    if cmd.get('zip'):
        monet_io.zip_tree(out_dir, cmd['zip'], progress=lambda message, pct: prog(message, 90 + pct * .1))
    prog(f"Extracted {summary['totalFrames']:,} frames · {summary['sampledFrames']:,} sampled configurations", 100)
    ok(**summary)


def action_rmsd(cmd):
    """RMSD of selected atoms vs frame-0, sampled every frame_step frames."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    indices    = cmd.get("indices")          # 0-indexed list; None = all
    frame_step = int(cmd.get("frame_step", 1))

    prog("Loading frames …", 0)
    try:
        ref_pos = None
        raw_idx = []
        rmsds = []
        for i, img in _load_images(filename, frame_step, cmd=cmd):
            pos = img.get_positions()
            if indices is not None:
                _validate_groups([indices], len(indices), len(img))
                pos = pos[np.array(indices)]
            if ref_pos is None:
                ref_pos = pos.copy()
            if pos.shape != ref_pos.shape:
                raise ValueError('All frames must contain the same number of atoms.')
            diff = pos - ref_pos
            rmsds.append(float(np.sqrt(np.mean(np.sum(diff ** 2, axis=1)))))
            raw_idx.append(i)
        if not rmsds:
            raise ValueError('No frames found.')

        prog("RMSD done", 100)
        ok(rmsd=rmsds, frame_indices=raw_idx)
    except Exception:
        err(traceback.format_exc())


def action_pdd(cmd):
    """Pair-distance distribution (histogram of all inter-atomic distances)."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    nbins      = int(cmd.get("nbins", 80))
    rmax       = cmd.get("rmax", None)
    frame_step = int(cmd.get("frame_step", 1))
    elements   = cmd.get("elements")        # e.g. ["C","N"] — filter by element pair

    prog("Computing pair-distance distribution …", 0)
    try:
        all_dists = []
        n_frames  = 0
        for fi, atoms in _load_images(filename, frame_step, cmd=cmd):
            indices = cmd.get('indices')
            if indices is not None:
                _validate_groups([indices], len(indices), len(atoms))
                atoms = atoms[indices]
            pos  = atoms.get_positions()
            syms = atoms.get_chemical_symbols()
            for i in range(len(pos)):
                for j in range(i + 1, len(pos)):
                    if elements:
                        target = sorted(elements if len(elements) == 2 else elements * 2)
                        if sorted([syms[i], syms[j]]) != target:
                            continue
                    d = float(atoms.get_distance(i, j, mic=cmd.get('mic', False)))
                    all_dists.append(d)
            n_frames += 1

        if not all_dists:
            return err("No distances found (check element filter).")

        _rmax = rmax if rmax else float(np.percentile(all_dists, 99))
        counts, edges = np.histogram(all_dists, bins=nbins, range=(0.5, _rmax))
        centres = ((edges[:-1] + edges[1:]) / 2).tolist()

        prog("Done", 100)
        ok(r=centres, counts=counts.tolist(), n_frames=n_frames, rmax=_rmax)
    except Exception:
        err(traceback.format_exc())


def action_bonds(cmd):
    """Bond-length time series for specified atom pairs (0-indexed)."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    pairs      = cmd["pairs"]               # [[i,j], ...]  0-indexed
    frame_step = int(cmd.get("frame_step", 1))

    prog("Computing bond lengths …", 0)
    try:
        series  = {f"{p[0]}-{p[1]}": [] for p in pairs}
        raw_idx = []
        for fi, atoms in _load_images(filename, frame_step, cmd=cmd):
            _validate_groups(pairs, 2, len(atoms))
            for p in pairs:
                key = f"{p[0]}-{p[1]}"
                series[key].append(float(atoms.get_distance(p[0], p[1], mic=cmd.get('mic', False))))
            raw_idx.append(fi)

        prog("Done", 100)
        ok(series=series, frame_indices=raw_idx)
    except Exception:
        err(traceback.format_exc())


def action_angles(cmd):
    """Bond-angle time series for specified atom triplets (0-indexed)."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    triplets   = cmd["triplets"]            # [[i,j,k], ...]
    frame_step = int(cmd.get("frame_step", 1))

    prog("Computing bond angles …", 0)
    try:
        series  = {f"{t[0]}-{t[1]}-{t[2]}": [] for t in triplets}
        raw_idx = []
        for fi, atoms in _load_images(filename, frame_step, cmd=cmd):
            _validate_groups(triplets, 3, len(atoms))
            for t in triplets:
                key = f"{t[0]}-{t[1]}-{t[2]}"
                series[key].append(_bond_angle(atoms, t, cmd))
            raw_idx.append(fi)

        prog("Done", 100)
        ok(series=series, frame_indices=raw_idx)
    except Exception:
        err(traceback.format_exc())


def action_dihedrals(cmd):
    """Dihedral-angle time series for specified quadruplets (0-indexed)."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    quads      = cmd["quads"]              # [[i,j,k,l], ...]
    frame_step = int(cmd.get("frame_step", 1))

    prog("Computing dihedral angles …", 0)
    try:
        series  = {f"{q[0]}-{q[1]}-{q[2]}-{q[3]}": [] for q in quads}
        raw_idx = []
        for fi, atoms in _load_images(filename, frame_step, cmd=cmd):
            _validate_groups(quads, 4, len(atoms))
            for q in quads:
                key = f"{q[0]}-{q[1]}-{q[2]}-{q[3]}"
                series[key].append(_angle_value(float(atoms.get_dihedral(*q, mic=cmd.get('mic', False))), cmd))
            raw_idx.append(fi)

        prog("Done", 100)
        ok(series=series, frame_indices=raw_idx)
    except Exception:
        err(traceback.format_exc())


def action_convert(cmd):
    """Convert a trajectory file between any ASE-supported formats."""
    if not _require_ase(): return
    inp    = cmd["input"]
    out    = cmd["output"]
    fmt    = cmd.get("format")             # output format string; None = infer from ext

    prog(f"Reading {inp} …", 10)
    try:
        images = [ase.io.read(inp, index=0)] if cmd.get('first_frame_only', False) else list(ase.io.iread(inp))
        if not images:
            raise ValueError('No frames found.')
        images = [_apply_geometry(image, cmd) for image in images]
        if fmt == 'gaussian':
            fmt = 'gaussian-in'
        if fmt in ioformats and ioformats[fmt].single and len(images) > 1:
            raise ValueError('This format stores one structure. Enable Convert first frame only.')
        if fmt == 'vasp' and images[0].cell.rank < 3:
            raise ValueError('VASP requires three cell vectors. Apply a crystal cell or use extended XYZ with lattice data.')
        if fmt == 'espresso-in':
            raise ValueError('Quantum ESPRESSO requires cell and pseudopotential settings, which this conversion panel does not yet collect.')
        prog(f'{len(images)} frames — writing output …', 60)
        ase.io.write(out, images[0] if fmt in ioformats and ioformats[fmt].single else images, format=fmt)
        prog("Done", 100)
        ok(n_frames=len(images), output=out)
    except Exception:
        err(traceback.format_exc())


def action_average(cmd):
    """Compute average structure using ASE and write to XYZ."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    output     = cmd.get("output", "GEO-AVERAGE-ASE.xyz")
    frame_step = int(cmd.get("frame_step", 1))

    prog("Loading frames …", 0)
    try:
        all_pos = []
        ref     = None
        n       = 0
        for fi, atoms in _load_images(filename, frame_step, cmd=cmd):
            if ref is None:
                ref = atoms.copy()
            all_pos.append(atoms.get_positions())
            n += 1

        avg = ref.copy()
        avg.set_positions(np.mean(all_pos, axis=0))
        ase.io.write(output, avg)
        prog("Done", 100)
        ok(n_frames=n, output=output)
    except Exception:
        err(traceback.format_exc())


def _validate_groups(groups, width, atom_count):
    if not groups:
        raise ValueError('Enter at least one atom group.')
    for group in groups:
        if (len(group) != width or any(type(i) is not int or i < 0 or i >= atom_count for i in group)
                or len(set(group)) != width):
            raise ValueError(f'Use {width} distinct atom indices between 0 and {atom_count - 1}.')


def _angle_value(value, cmd):
    if cmd.get('angle_range') == 'signed90':
        # Axial convention: orientations separated by 180 degrees are equivalent.
        return (value + 90.0) % 180.0 - 90.0
    return value % 360.0


def _bond_angle(atoms, group, cmd):
    mic = cmd.get('mic', False)
    value = float(atoms.get_angle(*group, mic=mic))
    if cmd.get('angle_range', 'natural') == '360':
        # Preserve the spatial angle magnitude; the fixed normal chooses its sign.
        normal = np.asarray(cmd['angle_normal'], dtype=float)
        normal /= np.linalg.norm(normal)
        u = atoms.get_distance(group[1], group[0], mic=mic, vector=True)
        v = atoms.get_distance(group[1], group[2], mic=mic, vector=True)
        cross = np.cross(u, v)
        if np.linalg.norm(cross) > 1e-10 * np.linalg.norm(u) * np.linalg.norm(v):
            orientation = np.dot(cross, normal)
            if abs(orientation) <= 1e-10 * np.linalg.norm(cross):
                raise ValueError('Reference normal lies in the angle plane. Choose a normal with a nonzero component perpendicular to that plane.')
            if orientation < 0:
                value = 360.0 - value
    return _angle_value(value, cmd)


def action_molecule(cmd):
    """Connected first-frame component using ASE covalent radii and image offsets."""
    if not _require_ase(): return
    from ase.neighborlist import neighbor_list, natural_cutoffs
    atoms = _first_atoms(cmd['filename'], cmd)
    seed = cmd.get('seed')
    _validate_groups([[seed]], 1, len(atoms))
    if not cmd.get('mic', False):
        atoms.set_pbc(False)
    ii, jj, shifts = neighbor_list('ijS', atoms, natural_cutoffs(atoms, mult=cmd.get('bond_scale', 1.2)))
    graph = [[] for _ in atoms]
    for i, j, shift in zip(ii, jj, shifts):
        graph[int(i)].append((int(j), shift))
    offsets = {seed: np.zeros(3, dtype=int)}
    queue = [seed]
    for i in queue:
        for j, shift in sorted(graph[i], key=lambda edge: edge[0]):
            offset = offsets[i] + shift
            if j not in offsets:
                offsets[j] = offset
                queue.append(j)
            elif not np.array_equal(offsets[j], offset):
                raise ValueError('This connected component forms a periodic network, not a single finite molecule. Adjust the bond cutoff or select atoms manually.')
    ok(indices=queue, n_atoms=len(queue), bond_scale=cmd.get('bond_scale', 1.2))


def validate_command(cmd):
    cell = cmd.get('cell')
    if cell is not None:
        if (not isinstance(cell, list) or len(cell) != 6 or
                any(type(v) not in (int, float) or not math.isfinite(v) for v in cell) or
                any(v <= 0 for v in cell[:3]) or any(not 0 < v < 180 for v in cell[3:])):
            raise ValueError('Cell requires positive a, b, c and angles strictly between 0 and 180 degrees.')
        ca, cb, cg = [math.cos(math.radians(v)) for v in cell[3:]]
        if 1 + 2*ca*cb*cg - ca*ca - cb*cb - cg*cg <= 1e-10:
            raise ValueError('Cell angles define a degenerate or impossible cell.')
    if cmd.get('pbc') is not None and (not isinstance(cmd['pbc'], list) or len(cmd['pbc']) != 3 or any(type(v) is not bool for v in cmd['pbc'])):
        raise ValueError('PBC must contain three boolean flags.')
    if 'mic' in cmd and type(cmd['mic']) is not bool:
        raise ValueError('Periodic-image option must be boolean.')
    mode = cmd.get('angle_range', 'natural')
    if mode not in ('natural', '360', 'signed90'):
        raise ValueError('Unknown angle range.')
    if cmd.get('action') == 'angles' and mode == '360':
        normal = cmd.get('angle_normal')
        if (not isinstance(normal, list) or len(normal) != 3 or
                any(type(v) not in (int, float) or not math.isfinite(v) for v in normal) or
                math.hypot(*normal) < 1e-12):
            raise ValueError('Directed bond angles require a finite nonzero reference normal (x y z).')
    scale = cmd.get('bond_scale', 1.2)
    if type(scale) not in (int, float) or not math.isfinite(scale) or not .5 <= scale <= 2:
        raise ValueError('Bond cutoff multiplier must be between 0.5 and 2.')
    indices = cmd.get('indices')
    if indices is not None:
        minimum = 2 if cmd.get('action') == 'pdd' else 1
        if (not isinstance(indices, list) or len(indices) < minimum
                or any(type(i) is not int or i < 0 for i in indices)
                or len(set(indices)) != len(indices)):
            raise ValueError(f'Select at least {minimum} distinct valid atom indices.')
    if 'frame_step' in cmd and (type(cmd['frame_step']) is not int or cmd['frame_step'] < 1):
        raise ValueError('Frame step must be a positive integer.')
    if cmd.get('action') == 'pdd':
        bins = cmd.get('nbins', 80)
        if type(bins) is not int or not 1 <= bins <= 10000:
            raise ValueError('Bins must be an integer between 1 and 10000.')
        rmax = cmd.get('rmax')
        if rmax is not None and (not isinstance(rmax, (int, float)) or not math.isfinite(rmax) or rmax <= 0.5):
            raise ValueError('Maximum distance must be greater than 0.5 angstrom.')
        elements = cmd.get('elements')
        if elements and (not isinstance(elements, list) or len(elements) not in (1, 2)
                         or any(not isinstance(element, str) for element in elements)):
            raise ValueError('Enter one element for like pairs, or two elements for an exact pair.')


# ── dispatch ─────────────────────────────────────────────────────────────────

ACTIONS = {
    "check":     action_check,
    "scan":      action_scan,
    "frame":     action_frame,
    "extract":   action_extract,
    "read_info": action_read_info,
    "molecule":  action_molecule,
    "rmsd":      action_rmsd,
    "pdd":       action_pdd,
    "bonds":     action_bonds,
    "angles":    action_angles,
    "dihedrals": action_dihedrals,
    "convert":   action_convert,
    "average":   action_average,
}

def main():
    raw = sys.stdin.read().strip()
    if not raw:
        err("Empty command"); return
    try:
        cmd = json.loads(raw)
    except json.JSONDecodeError as e:
        err(f"JSON parse error: {e}"); return

    action = cmd.get("action")
    handler = ACTIONS.get(action)
    if not handler:
        err(f"Unknown action '{action}'. Available: {list(ACTIONS)}")
        return

    try:
        validate_command(cmd)
        handler(cmd)
    except Exception:
        err(traceback.format_exc())

if __name__ == "__main__":
    main()

"""
Import trajectories written by other codes into extended XYZ, which the MONET
engines (JavaScript and Python) read directly.

ASE provides the readers for VASP (XDATCAR, OUTCAR, vasprun.xml, POSCAR),
Quantum ESPRESSO pw.x output, Qbox output, ORCA output, CP2K DCD, LAMMPS dumps
and more. MONET adds readers for CPMD TRAJECTORY files, Quantum ESPRESSO cp.x
.pos/.cel files and CP2K .cell files (per-frame lattice for XYZ trajectories).
Formats without element information take them from a reference structure.
"""
import os
import re

import numpy as np

import monet_io
import monet_mda

BOHR = 0.529177210903  # Å

FORMATS = {
    'auto': 'Auto-detect',
    'xyz': 'XYZ / extended XYZ',
    'vasp-xdatcar': 'VASP XDATCAR',
    'vasp-out': 'VASP OUTCAR',
    'vasp-xml': 'VASP vasprun.xml',
    'vasp': 'VASP POSCAR/CONTCAR',
    'espresso-out': 'Quantum ESPRESSO pw.x output',
    'qe-cp-pos': 'Quantum ESPRESSO cp.x .pos',
    'qbox': 'Qbox output',
    'orca-output': 'ORCA output',
    'cp2k-dcd': 'CP2K DCD',
    'cpmd-trajectory': 'CPMD TRAJECTORY',
    'lammps-dump-text': 'LAMMPS text dump',
    'traj': 'ASE trajectory',
    'cif': 'CIF',
    'gaussian-out': 'Gaussian output',
    **{key: value[0] for key, value in monet_mda.FORMATS.items()},
}
NEEDS_REFERENCE = {'qe-cp-pos', 'cp2k-dcd', 'cpmd-trajectory'} | {k for k, v in monet_mda.FORMATS.items() if v[2]}
EXTRA_PROPERTIES = (('resname', 'S'), ('resid', 'I'), ('atomname', 'S'))


def ase_readable():
    """All formats ASE can read, as [(name, description)]."""
    from ase.io.formats import ioformats
    return sorted((name, fmt.description) for name, fmt in ioformats.items() if fmt.can_read)


def valid_format(fmt):
    if fmt in FORMATS:
        return True
    if isinstance(fmt, str) and fmt.startswith('ase:'):
        return fmt[4:] in dict(ase_readable())
    return False


def _is_cp2k_dcd(path):
    with open(path, 'rb') as fh:
        return b'CP2K' in fh.read(300)
ASE_FORMATS = {'vasp-xdatcar', 'vasp-out', 'vasp-xml', 'vasp', 'espresso-out', 'qbox',
               'cp2k-dcd', 'lammps-dump-text', 'traj', 'cif', 'gaussian-out'}
# ASE 3.29 returns Qbox positions and cells without unit conversion (Qbox writes bohr).
BOHR_FORMATS = {'qbox'}


def detect(path, name=None):
    """Guess the format from the original file name and the first bytes."""
    base = os.path.basename(name or path).lower()
    if base.startswith('xdatcar'):
        return 'vasp-xdatcar'
    if base.startswith('outcar'):
        return 'vasp-out'
    if base.startswith('vasprun') and base.endswith('.xml'):
        return 'vasp-xml'
    if base.startswith(('poscar', 'contcar')) or base.endswith(('.vasp', '.poscar')):
        return 'vasp'
    if base.endswith('.dcd'):
        return 'cp2k-dcd' if _is_cp2k_dcd(path) else 'mda-dcd'
    extension = os.path.splitext(base)[1]
    if extension in monet_mda.EXTENSIONS:
        return monet_mda.EXTENSIONS[extension]
    if extension in ('.tpr', '.psf', '.prmtop', '.parm7', '.top', '.itp'):
        raise ValueError('This is a topology file: load the trajectory (XTC, TRR, DCD …) and add the topology as the reference structure.')
    if base.endswith('.pos'):
        return 'qe-cp-pos'
    if base.endswith('.traj'):
        return 'traj'
    if base.endswith('.cif'):
        return 'cif'
    if base.endswith(('.xyz', '.extxyz')) or monet_io.is_xyz(path):
        return 'xyz'
    with open(path, 'rb') as fh:
        head = fh.read(1 << 16).decode('utf-8', 'replace')
    lower = head.lower()
    if base.startswith('trajectory') or re.match(r'\s*(<<<<<<\s+new data\s+>>>>>>\s*)?\d+(\s+[-+.\deE]+){3,6}\s*\n', head, re.I):
        return 'cpmd-trajectory'
    if 'program pwscf' in lower:
        return 'espresso-out'
    if 'o   r   c   a' in lower:
        return 'orca-output'
    if '<release>' in lower and ('qbox' in lower or 'qb@ll' in lower):
        return 'qbox'
    if '<modeling>' in lower:
        return 'vasp-xml'
    if 'entering gaussian system' in lower:
        return 'gaussian-out'
    if 'item: timestep' in lower:
        return 'lammps-dump-text'
    if 'vasp.' in lower and 'direct lattice vectors' in lower:
        return 'vasp-out'
    raise ValueError('Could not recognise this file format. Choose the format explicitly.')


def _reference_symbols(path):
    from ase.io import read
    if not path:
        raise ValueError('This format has no element names: add a reference structure (e.g. the first frame as XYZ) with the same atom order.')
    if monet_io.is_xyz(path):
        return monet_io.XYZTrajectory(path, use_cache=False).symbols_list()
    try:
        return read(path, index=0).get_chemical_symbols()
    except Exception:
        if monet_mda.available():
            return monet_mda._elements(monet_mda._require().Universe(path))
        raise


def _chunks(fh, size=32 << 20):
    """Yield whole-line text chunks."""
    rest = b''
    while True:
        block = fh.read(size)
        if not block:
            if rest.strip():
                yield rest
            return
        block = rest + block
        cut = block.rfind(b'\n') + 1
        if cut == 0:
            rest = block
            continue
        rest = block[cut:]
        yield block[:cut]


def _numeric_rows(path, skip=None):
    """All numeric rows of a whitespace table as (rows, width) arrays, chunk by chunk."""
    width = None
    with open(path, 'rb') as fh:
        for chunk in _chunks(fh):
            if skip is not None:
                chunk = skip.sub(b'', chunk)
            lines = chunk.split(b'\n', 1)
            if width is None:
                first = next((line for line in chunk.splitlines() if line.strip()), b'')
                width = len(first.split())
            values = chunk.split()
            if len(values) % width:
                raise ValueError('Rows with different numbers of columns were found.')
            try:
                yield np.array(values, dtype=float).reshape(-1, width)
            except ValueError:
                raise ValueError(f'Non-numeric data near: {lines[0][:60].decode("utf-8", "replace")}') from None


def read_cpmd_trajectory(path, symbols):
    """CPMD TRAJECTORY: `step x y z vx vy vz` per atom, bohr. Restart markers are skipped."""
    marker = re.compile(rb'^\s*<<<<<<.*$', re.M)
    natoms = len(symbols)
    pending = np.empty((0, 4))
    frame = 0
    for rows in _numeric_rows(path, marker):
        if rows.shape[1] < 4:
            raise ValueError('CPMD TRAJECTORY rows need a step number and x, y, z.')
        pending = np.concatenate([pending, rows[:, :4]])
        complete = len(pending) // natoms * natoms
        for block in pending[:complete].reshape(-1, natoms, 4):
            if np.ptp(block[:, 0]) != 0:
                raise ValueError(f'Frame {frame + 1}: the atom count of the reference does not match the TRAJECTORY blocks.')
            yield block[:, 1:] * BOHR, None, int(block[0, 0])
            frame += 1
        pending = pending[complete:]
    if len(pending):
        raise ValueError('The TRAJECTORY file ends with an incomplete frame (check the reference atom count).')


def _read_blocks(path, rows_per_block):
    """Blocks of `1 header + rows_per_block` lines, as used by cp.x .pos/.cel files."""
    with open(path) as fh:
        while True:
            header = fh.readline()
            if not header:
                return
            if not header.strip():
                continue
            rows = [fh.readline().split() for _ in range(rows_per_block)]
            if len(rows[-1]) < 3:
                raise ValueError(f'{os.path.basename(path)}: incomplete block after "{header.strip()}".')
            yield header.split(), np.array([row[:3] for row in rows], dtype=float)


def read_qe_cp(path, symbols, cell_file=None, cell_vectors='rows'):
    """cp.x .pos (bohr) with an optional .cel file (bohr) or a structure file with one cell (Å)."""
    constant = None
    if cell_file and cell_file_kind(cell_file) == 'structure':
        constant, cell_file = read_constant_cell(cell_file), None
    cells = _read_blocks(cell_file, 3) if cell_file else None
    for header, positions in _read_blocks(path, len(symbols)):
        lattice = constant
        if cells is not None:
            try:
                cell_header, lattice = next(cells)
            except StopIteration:
                raise ValueError('The .cel file has fewer steps than the .pos file.') from None
            if cell_header[:1] != header[:1]:
                raise ValueError(f'Step {header[0]} in .pos does not match step {cell_header[0]} in .cel.')
            lattice = lattice * BOHR
            if cell_vectors == 'columns':
                lattice = lattice.T
        yield positions * BOHR, lattice, int(float(header[0]))


def read_cp2k_cell(path):
    """CP2K .cell file: step time Ax Ay Az Bx By Bz Cx Cy Cz volume (Å) -> {step: 3x3}."""
    cells = {}
    order = []
    with open(path) as fh:
        for line in fh:
            fields = line.split()
            if not fields or fields[0].startswith('#'):
                continue
            if len(fields) < 11:
                raise ValueError('CP2K .cell rows need step, time and nine cell components.')
            step = int(float(fields[0]))
            cells[step] = np.array(fields[2:11], dtype=float).reshape(3, 3)
            order.append(step)
    if not order:
        raise ValueError('The cell file contains no cell rows.')
    return cells, order


_CIF_CELL = re.compile(r'^\s*_cell_(length_a|length_b|length_c|angle_alpha|angle_beta|angle_gamma)\s+([-+0-9.eE]+)', re.M)


def cell_file_kind(path):
    """'cp2k' for per-step CP2K .cell tables, 'cel' for cp.x blocks, otherwise 'structure' (CIF, POSCAR, PDB …)."""
    base = os.path.basename(path).lower()
    if base.endswith('.cell'):
        return 'cp2k'
    if base.endswith('.cel'):
        return 'cel'
    with open(path, errors='replace') as fh:
        for line in fh:
            fields = line.split()
            if not fields or fields[0].startswith('#'):
                continue
            try:
                [float(v) for v in fields]
            except ValueError:
                return 'structure'
            if len(fields) >= 11:
                return 'cp2k'
            # cp.x blocks start with "step time"; a lone number is an XYZ atom count.
            return 'cel' if len(fields) == 2 else 'structure'
    raise ValueError(f'The cell file {os.path.basename(path)} is empty.')


def read_constant_cell(path):
    """One 3x3 lattice (Å) from a CIF or any ASE-readable structure; a along x, b in the xy plane."""
    from ase.geometry import cellpar_to_cell
    name = os.path.basename(path)
    with open(path, errors='replace') as fh:
        text = fh.read()
    if '_cell_length_a' in text:
        # Read the metric directly: disordered or symmetry-expanded CIF atoms are irrelevant here.
        values = dict((key, float(value)) for key, value in _CIF_CELL.findall(text))
        keys = ('length_a', 'length_b', 'length_c', 'angle_alpha', 'angle_beta', 'angle_gamma')
        missing = [f'_cell_{key}' for key in keys if key not in values]
        if missing:
            raise ValueError(f'{name}: missing {", ".join(missing)}.')
        cellpar = [values[key] for key in keys]
    else:
        import ase.io
        try:
            atoms = ase.io.read(path, index=0)
        except Exception as error:
            raise ValueError(f'Could not read a cell from {name}: {error}') from None
        if atoms.cell.rank != 3:
            raise ValueError(f'{name} contains no complete cell (three lattice vectors).')
        return atoms.cell.array
    if min(cellpar[:3]) <= 0 or not all(0 < angle < 180 for angle in cellpar[3:]):
        raise ValueError(f'{name}: invalid cell parameters {cellpar}.')
    try:
        lattice = cellpar_to_cell(cellpar)
    except Exception as error:
        raise ValueError(f'{name}: the cell angles do not describe a valid cell ({error}).') from None
    if not np.isfinite(lattice).all() or abs(np.linalg.det(lattice)) < 1e-6:
        raise ValueError(f'{name}: the cell angles do not describe a valid cell.')
    return lattice


def read_cell_source(path):
    """(per-step cells, step order) for CP2K .cell tables, or (None, constant 3x3 lattice)."""
    kind = cell_file_kind(path)
    if kind == 'cp2k':
        return read_cp2k_cell(path)
    if kind == 'cel':
        raise ValueError('cp.x .cel files can only be combined with cp.x .pos trajectories.')
    return None, read_constant_cell(path)


def read_orca(path):
    """Every 'CARTESIAN COORDINATES (ANGSTROEM)' block of an ORCA output (optimisations, scans, MD)."""
    with open(path, errors='replace') as fh:
        lines = iter(fh)
        for line in lines:
            if 'CARTESIAN COORDINATES (ANGSTROEM)' not in line:
                continue
            next(lines, None)  # dashed underline
            symbols, positions = [], []
            for row in lines:
                fields = row.split()
                if len(fields) < 4:
                    break
                symbols.append(fields[0])
                positions.append([float(v) for v in fields[1:4]])
            if symbols:
                yield symbols, np.array(positions)


def _xyz_frames(path, cell_file):
    traj = monet_io.XYZTrajectory(path)
    cells, order = read_cell_source(cell_file) if cell_file else (None, None)
    constant = order if cells is None and order is not None else None
    for frame, positions, comment in traj.iter_frames(range(traj.nframes)):
        lattice, _ = traj.cell(comment)
        if constant is not None:
            lattice = constant
        step = None
        match = re.search(rb'\bi\s*=\s*(\d+)', comment)
        if match:
            step = int(match.group(1))
        if cells is not None:
            if step is not None and step in cells:
                lattice = cells[step]
            elif len(order) == traj.nframes:
                lattice = cells[order[frame]]
            else:
                raise ValueError(f'No cell for frame {frame + 1}: the .cell file has {len(order)} rows for {traj.nframes} frames.')
        yield positions, lattice, step


def frames(path, fmt, name=None, reference=None, cell_file=None, cell_vectors='rows'):
    """Yield (symbols, positions Å, lattice or None, pbc, step[, extra]) for each frame."""
    if fmt == 'auto':
        fmt = detect(path, name)
    if fmt in monet_mda.FORMATS:
        yield from monet_mda.frames(path, fmt, reference)
        return
    if fmt.startswith('ase:'):
        import ase.io
        if not valid_format(fmt):
            raise ValueError(f'ASE cannot read the format {fmt[4:]}.')
        for step, atoms in enumerate(ase.io.iread(path, index=':', format=fmt[4:])):
            periodic = atoms.cell.rank == 3
            yield (atoms.get_chemical_symbols(), atoms.get_positions(), atoms.cell.array if periodic else None,
                   atoms.pbc.tolist() if periodic and atoms.pbc.any() else None, step)
        return
    if fmt == 'xyz':
        symbols = monet_io.XYZTrajectory(path).symbols_list()
        for positions, lattice, step in _xyz_frames(path, cell_file):
            yield symbols, positions, lattice, None, step
        return
    if fmt in ('cpmd-trajectory', 'qe-cp-pos'):
        symbols = _reference_symbols(reference)
        source = read_cpmd_trajectory(path, symbols) if fmt == 'cpmd-trajectory' else read_qe_cp(path, symbols, cell_file, cell_vectors)
        cells = read_cell_source(cell_file) if cell_file and fmt == 'cpmd-trajectory' else None
        constant = None
        if cells is not None and cells[0] is None:
            constant, cells = cells[1], None
        for k, (positions, lattice, step) in enumerate(source):
            if constant is not None:
                lattice = constant
            if cells is not None:
                lattice = cells[0].get(step, cells[0][cells[1][min(k, len(cells[1]) - 1)]])
            yield symbols, positions, lattice, None, step
        return
    if fmt == 'orca-output':
        found = False
        for step, (symbols, positions) in enumerate(read_orca(path)):
            found = True
            yield symbols, positions, None, None, step
        if not found:
            raise ValueError('No "CARTESIAN COORDINATES (ANGSTROEM)" blocks were found in this ORCA output.')
        return
    if fmt not in ASE_FORMATS:
        raise ValueError(f'Unsupported input format: {fmt}.')
    import ase.io
    kwargs = {}
    if fmt == 'cp2k-dcd':
        kwargs['ref_atoms'] = ase.io.read(reference, index=0) if reference else None
    scale = BOHR if fmt in BOHR_FORMATS else 1.0
    for step, atoms in enumerate(ase.io.iread(path, index=':', format=fmt, **kwargs)):
        periodic = atoms.cell.rank == 3
        yield (atoms.get_chemical_symbols(), atoms.get_positions() * scale, atoms.cell.array * scale if periodic else None,
               atoms.pbc.tolist() if periodic and atoms.pbc.any() else None, step)


def _flag(value):
    return 'T' if value else 'F'


def import_to_extxyz(path, output, fmt='auto', name=None, reference=None, cell_file=None,
                     cell_vectors='rows', progress=None):
    """Write an extended XYZ file; returns a summary for the UI."""
    detected = detect(path, name) if fmt == 'auto' else fmt
    count = 0
    natoms = None
    symbols0 = None
    with open(output, 'w', buffering=8 << 20) as fh:
        for symbols, positions, lattice, pbc, step, *rest in frames(path, detected, name, reference, cell_file, cell_vectors):
            positions = np.asarray(positions, dtype=float)
            if natoms is None:
                natoms, symbols0 = len(symbols), list(symbols)
                unknown = all(symbol == 'X' for symbol in symbols0)
                if any(symbol == 'X' for symbol in symbols0) and not unknown:
                    raise ValueError('Some element names are missing: add a reference structure.')
                extra = rest[0] if rest else None
                properties = 'species:S:1:pos:R:3'
                columns = [[''] * natoms]
                if extra:
                    # Topology labels travel as extra extended-XYZ columns (used by MDAnalysis selections).
                    properties += ''.join(f':{key}:{kind}:1' for key, kind in EXTRA_PROPERTIES)
                    columns = [[' ' + ' '.join(str(extra[key][i]).replace('%', '%%') for key, _ in EXTRA_PROPERTIES) for i in range(natoms)]]
                row = ''.join(f'{symbol} %.8f %.8f %.8f{columns[0][i]}\n' for i, symbol in enumerate(symbols0))
            elif list(symbols) != symbols0:
                raise ValueError(f'Frame {count + 1}: atom count or order changed; MONET needs a constant atom list.')
            if not np.isfinite(positions).all():
                raise ValueError(f'Frame {count + 1}: coordinates must be finite numbers.')
            comment = f'Properties={properties} frame={count}'
            if step is not None:
                comment += f' source_step={step}'
            if lattice is not None:
                lattice = np.asarray(lattice, dtype=float)
                flags = pbc if pbc is not None else [True, True, True]
                comment = (f'Lattice="{" ".join(f"{v:.10f}" for v in lattice.ravel())}" ' + comment
                           + f' pbc="{" ".join(_flag(v) for v in flags)}"')
            fh.write(f'{natoms}\n{comment}\n' + row % tuple((positions + 0.0).ravel()))
            count += 1
            if progress and count % 500 == 0:
                progress(f'Imported {count:,} frames …', None)
    if not count:
        raise ValueError('No frames were found in this file.')
    summary = {'frames': count, 'natoms': natoms, 'source_format': detected, 'source_label': FORMATS.get(detected, detected)}
    if unknown:
        summary['source_label'] += ' · no topology, atoms shown as X'
        summary['warning'] = ('No topology was given: every atom is imported as element X (no names, masses or bonds). '
                              'Distances, angles, RMSD and MSD work; add the topology for element-based analyses.')
    return summary

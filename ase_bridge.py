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
import monet_analysis
import monet_mda

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

def _report_exception():
    """Input problems become short messages; unexpected failures keep their traceback."""
    error = sys.exc_info()[1]
    if isinstance(error, ValueError):
        err(str(error))
    elif isinstance(error, KeyError):
        err(f'Missing parameter: {error}')
    elif isinstance(error, OSError) or type(error).__name__ == 'UnknownFileTypeError':
        err(f'Could not read the file: {error}')
    else:
        import traceback
        err(traceback.format_exc())


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
    ok(ase_version=_ASE_VERSION, numpy_version=np.__version__, mdanalysis_version=monet_mda.version())


def action_cell_file(cmd):
    """Cell parameters from a CIF, POSCAR, PDB … or a CP2K .cell file (first row)."""
    import monet_formats
    from ase.geometry import cell_to_cellpar
    cells, lattice = monet_formats.read_cell_source(cmd['filename'])
    note = ''
    if cells is not None:
        lattice = cells[lattice[0]]
        note = f'First of {len(cells)} cells in the CP2K .cell file.'
    ok(cellpar=[float(v) for v in cell_to_cellpar(lattice)], cell=np.asarray(lattice).tolist(), note=note)


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
        _report_exception()


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
    qm = cmd.get('qm')
    if qm is not None:
        import monet_qm
        qm = monet_qm.writer(qm)
    prog('Reading trajectory …', 0)
    summary = monet_io.extract(
        traj, out_dir, cmd.get('selected') or [], cmd.get('frequency'),
        compute_average=bool(cmd.get('compute_average')), generate_gaussian=bool(cmd.get('generate_gaussian')),
        options=cmd.get('history'), progress=lambda message, pct: prog(message, pct * .9), qm_writer=qm)
    if cmd.get('zip'):
        monet_io.zip_tree(out_dir, cmd['zip'], progress=lambda message, pct: prog(message, 90 + pct * .1))
    prog(f"Extracted {summary['totalFrames']:,} frames · {summary['sampledFrames']:,} sampled configurations", 100)
    ok(**summary)


def action_import(cmd):
    """Convert another code's trajectory (plus optional reference/cell files) into extended XYZ."""
    import monet_formats
    prog('Importing trajectory …', 0)
    summary = monet_formats.import_to_extxyz(
        cmd['filename'], cmd['output'], cmd.get('format') or 'auto', name=cmd.get('source_name'),
        reference=cmd.get('reference'), cell_file=cmd.get('cell_file'),
        cell_vectors=cmd.get('cell_vectors', 'rows'), progress=prog)
    prog(f"Imported {summary['frames']:,} frames from {summary['source_label']}", 100)
    ok(**summary)


def _frame_data(cmd, indices=None, max_frames=None, need_cell=False):
    """(frame_indices, positions[F, n, 3], cells[F, 3, 3] or None, pbc) with the cell/PBC options applied."""
    filename = cmd['filename']
    step = cmd.get('frame_step', 1)
    frames, positions, cells = [], [], []
    pbc = None
    for i, atoms in _load_images(filename, step, max_frames=max_frames, cmd=cmd, label='Reading frame'):
        if indices is not None:
            _validate_groups([indices], len(indices), len(atoms))
            atoms = atoms[list(indices)]
        frames.append(i)
        positions.append(atoms.get_positions())
        if atoms.cell.rank == 3:
            cells.append(atoms.cell.array.copy())
            pbc = atoms.pbc.copy() if pbc is None else pbc
        elif need_cell:
            raise ValueError('This analysis needs a complete periodic cell. Apply a crystal cell or use an extended XYZ with a lattice.')
    if not frames:
        raise ValueError('No frames found.')
    if cells and len(cells) != len(frames):
        raise ValueError('Some frames have no cell; apply a constant crystal cell.')
    if need_cell and (pbc is None or not pbc.any()):
        raise ValueError('This analysis needs periodic directions (PBC) in the cell settings.')
    return frames, np.array(positions), (np.array(cells) if cells else None), pbc


def _maybe_unwrap(cmd, positions, cells, pbc):
    if not cmd.get('unwrap') or cells is None or pbc is None or not pbc.any():
        return positions, None
    unwrapped, worst = monet_analysis.unwrap(positions, cells, pbc)
    warning = None
    if worst > 0.35:
        warning = f'Largest step between analysed frames is {worst:.2f} of the cell; use a smaller frame step for reliable unwrapping.'
    return unwrapped, warning


def action_formats(_):
    """Readable formats for the import menu."""
    import monet_formats
    ok(ase=[{'name': name, 'description': description} for name, description in monet_formats.ase_readable()],
       mdanalysis=monet_mda.version(),
       mda_formats=[{'key': key, 'label': value[0], 'topology': value[2]} for key, value in monet_mda.FORMATS.items()])


def _universe(cmd):
    """MDAnalysis Universe of the active trajectory (frame step and cell options applied)."""
    frames, positions, cells, pbc = _frame_data(cmd)
    atoms = _first_atoms(cmd['filename'], cmd)
    traj = _trajectory(cmd['filename'])
    properties = traj.atom_properties() if traj else {}
    prog('Building the MDAnalysis universe …', 40)
    ids = cmd.get('atom_ids')
    if ids is not None and (not isinstance(ids, list) or len(ids) != len(atoms)
                            or any(type(i) is not int or i < 1 for i in ids) or len(set(ids)) != len(ids)):
        raise ValueError('The MONET atom IDs do not match the atoms of the trajectory; reload it.')
    universe = monet_mda.build_universe(atoms.get_chemical_symbols(), positions, cells, pbc, properties,
                                        bond_scale=cmd.get('bond_scale', 1.2), ids=ids)
    return frames, universe


def action_mda_select(cmd):
    """Indices matching an MDAnalysis selection on the first frame."""
    cmd = {**cmd, 'frame_step': 10 ** 9}
    _, universe = _universe(cmd)
    group = monet_mda.select(universe, cmd['selection'])
    residues = sorted({f'{r.resname}{r.resid}' for r in group.residues})
    ok(indices=group.indices.tolist(), n_atoms=len(group), residues=residues[:50], n_residues=len(residues))


MDA_ANALYSES = {'rmsd', 'rmsd_matrix', 'rmsf', 'rgyr', 'hbonds', 'contacts', 'interrdf', 'msd', 'lineardensity', 'pca',
                'com_distance', 'min_distance', 'atomic_distances', 'dihedral_mda', 'ramachandran', 'dssp',
                'gnm', 'diffusionmap', 'density'}


def action_mda_run(cmd):
    """Any analysis of monet_mda.run_analysis on the active trajectory (same atom order as MONET)."""
    frames, universe = _universe(cmd)
    name = cmd['analysis']
    prog(f'Running MDAnalysis {name} …', 55)
    dt = cmd.get('dt')
    result = monet_mda.run_analysis(universe, name, cmd.get('params') or {}, frames,
                                    dt=dt * cmd.get('frame_step', 1) if dt else None, output=cmd.get('output'))
    prog('Done', 100)
    ok(analysis=name, frame_indices=frames, n_frames=len(frames), **result)


def action_mda_align(cmd):
    """Write the trajectory after optimal superposition of a selection on the first frame."""
    frames, universe = _universe(cmd)
    selection = (cmd.get('params') or {}).get('selection') or 'all'
    prog('Aligning …', 50)
    positions = monet_mda.aligned_positions(universe, selection)
    symbols = [str(e) for e in universe.atoms.elements]
    # Topology columns of the source (atom names, residues) are kept so selections still work.
    traj = _trajectory(cmd['filename'])
    properties = traj.atom_properties() if traj else {}
    extra = [(name, kind) for name, kind in (('resname', 'S'), ('resid', 'I'), ('atomname', 'S')) if name in properties]
    columns = 'species:S:1:pos:R:3' + ''.join(f':{name}:{kind}:1' for name, kind in extra)
    row = ''.join(f'{s} %.8f %.8f %.8f' + ''.join(f' {properties[name][i]}' for name, _ in extra) + '\n'
                  for i, s in enumerate(symbols))
    with open(cmd['output'], 'w') as fh:
        for k, frame in enumerate(frames):
            fh.write(f'{len(symbols)}\nProperties={columns} frame={frame} source_frame={frame} aligned_on="{selection}"\n')
            fh.write(row % tuple((positions[k] + 0.0).ravel()))
    prog('Done', 100)
    ok(n_frames=len(frames), selection=selection)


def action_topology(cmd):
    """Atom identity of the active file as ASE and MDAnalysis see it, for the MONET consistency check."""
    if not _require_ase(): return
    atoms = _first_atoms(cmd['filename'], cmd)
    info = {'n_atoms': len(atoms), 'symbols': atoms.get_chemical_symbols(),
            'positions': np.round(atoms.get_positions(), 4).tolist(), 'mdanalysis': None}
    traj = _trajectory(cmd['filename'])
    info['n_frames'] = traj.nframes if traj else None
    if monet_mda.available():
        prog('Building the MDAnalysis topology …', 40)
        _, universe = _universe({**cmd, 'frame_step': 10 ** 9})
        table = monet_mda.topology_table(universe)
        table['positions'] = np.round(universe.atoms.positions.astype(float), 3).tolist()
        info['mdanalysis'] = table
    ok(**info)


def _neighbours(atoms, scale, mic):
    from ase.neighborlist import natural_cutoffs, neighbor_list
    if not mic:
        atoms = atoms.copy()
        atoms.set_pbc(False)
    cutoffs = [0.0 if s == 'X' else c for s, c in zip(atoms.get_chemical_symbols(), natural_cutoffs(atoms, mult=scale))]
    return neighbor_list('ijd', atoms, cutoffs)


def action_ase_structure(cmd):
    """Structural summary of one frame: formula, mass, cell, density, inertia, bonds, coordination, symmetry."""
    if not _require_ase(): return
    from collections import Counter
    from ase.geometry import get_duplicate_atoms
    traj = _require_xyz(cmd['filename'])
    frame = cmd.get('frame', 0)
    if type(frame) is not int or not 0 <= frame < traj.nframes:
        raise ValueError('The frame must be inside the trajectory.')
    atoms = _apply_geometry(next(traj.atoms([frame]))[1], cmd)
    scale = cmd.get('bond_scale', 1.2)
    mic = bool(cmd.get('mic', False)) and atoms.pbc.any()
    symbols = atoms.get_chemical_symbols()
    masses = atoms.get_masses()
    com = atoms.get_center_of_mass()
    rg = float(np.sqrt(np.sum(masses * np.sum((atoms.positions - com) ** 2, axis=1)) / masses.sum()))
    rows = [['Frame', frame], ['Formula (Hill)', atoms.get_chemical_formula('hill')], ['Atoms', len(atoms)],
            ['Total mass (amu)', round(float(masses.sum()), 4)],
            ['Centre of mass (Å)', ', '.join(f'{v:.4f}' for v in com)],
            ['Principal moments of inertia (amu·Å²)', ', '.join(f'{v:.3f}' for v in atoms.get_moments_of_inertia())],
            ['Radius of gyration, mass-weighted (Å)', round(rg, 4)]]
    if atoms.cell.rank == 3:
        volume = atoms.get_volume()
        rows += [['Cell a, b, c (Å); α, β, γ (°)', ', '.join(f'{v:.4f}' for v in atoms.cell.cellpar())],
                 ['Periodic directions', ''.join('abc'[k] for k in range(3) if atoms.pbc[k]) or 'none'],
                 ['Volume (Å³)', round(float(volume), 4)],
                 ['Density (g cm⁻³)', round(float(masses.sum() * 1.66053906660 / volume), 5)]]
        try:
            from ase.spacegroup import get_spacegroup
            group = get_spacegroup(atoms, symprec=float(cmd.get('symprec', 1e-3)))
            rows.append(['Space group (spglib)', f'{group.symbol} (No. {group.no})'])
        except ImportError:
            rows.append(['Space group', 'spglib is not installed (python -m pip install spglib)'])
        except Exception as error:
            rows.append(['Space group', f'not determined: {error}'])
    else:
        rows.append(['Cell', 'none (molecule in vacuum)'])
    ii, jj, dd = _neighbours(atoms, scale, mic)
    if len(atoms) > 1:
        from ase.geometry import get_distances
        _, distances = get_distances(atoms.positions, cell=atoms.cell if mic else None, pbc=atoms.pbc if mic else None)
        np.fill_diagonal(distances, np.inf)
        a, b = np.unravel_index(np.argmin(distances), distances.shape)
        rows.append(['Shortest interatomic distance (Å)', f'{distances[a, b]:.4f} (atoms {min(a, b) + 1}–{max(a, b) + 1})'])
    duplicates = get_duplicate_atoms(atoms.copy(), cutoff=0.1)
    rows.append(['Overlapping atoms (< 0.1 Å)', len(duplicates) if duplicates is not None else 0])
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    count, labels = connected_components(coo_matrix((np.ones(len(ii)), (ii, jj)), shape=(len(atoms), len(atoms))), directed=False)
    rows.append([f'Molecules (bond cutoff × {scale})', count])
    keep = ii < jj
    bonds = {}
    for i, j, d in zip(ii[keep], jj[keep], dd[keep]):
        key = '–'.join(sorted((symbols[i], symbols[j])))
        bonds.setdefault(key, []).append(float(d))
    bond_rows = [[key, len(v), round(float(np.mean(v)), 4), round(float(np.min(v)), 4), round(float(np.max(v)), 4)]
                 for key, v in sorted(bonds.items(), key=lambda item: -len(item[1]))]
    cn = np.bincount(ii, minlength=len(atoms))
    cn_rows = []
    for element in sorted(set(symbols), key=symbols.index):
        values = cn[[k for k, s in enumerate(symbols) if s == element]]
        cn_rows.append([element, int(len(values)), round(float(values.mean()), 3), int(values.min()), int(values.max()),
                        ', '.join(f'{n}×{c}' for n, c in sorted(Counter(values.tolist()).items()))])
    ok(frame=frame, summary=rows, bonds={'columns': ['Pair', 'Bonds', 'Mean (Å)', 'Min (Å)', 'Max (Å)'], 'rows': bond_rows},
       coordination={'columns': ['Element', 'Atoms', 'Mean CN', 'Min', 'Max', 'Histogram (CN×atoms)'], 'rows': cn_rows},
       molecules=labels.tolist(), coordination_numbers=cn.tolist())


def action_ase_coordination(cmd):
    """Coordination numbers (ASE natural cutoffs) of selected atoms along the trajectory."""
    if not _require_ase(): return
    indices = cmd.get('indices')
    scale = cmd.get('bond_scale', 1.2)
    frames, series, names = [], None, None
    for i, atoms in _load_images(cmd['filename'], cmd.get('frame_step', 1), cmd=cmd, label='Coordination, frame'):
        mic = bool(cmd.get('mic', False)) and atoms.pbc.any()
        ii, _, _ = _neighbours(atoms, scale, mic)
        cn = np.bincount(ii, minlength=len(atoms))
        chosen = list(range(len(atoms))) if indices is None else indices
        _validate_groups([chosen], len(chosen), len(atoms))
        if series is None:
            symbols = atoms.get_chemical_symbols()
            elements = sorted({symbols[k] for k in chosen}, key=symbols.index)
            per_element = {e: [k for k in chosen if symbols[k] == e] for e in elements}
            names = [f'{e} (mean of {len(v)})' for e, v in per_element.items()] + [f'{symbols[k]}{k + 1}' for k in chosen[:8]]
            series = [[] for _ in names]
        values = [float(cn[v].mean()) for v in per_element.values()] + [int(cn[k]) for k in chosen[:8]]
        for target, value in zip(series, values):
            target.append(value)
        frames.append(i)
    ok(frame_indices=frames, series={name: data for name, data in zip(names, series)}, bond_scale=scale)


def action_mda_rmsf(cmd):
    frames, universe = _universe(cmd)
    prog('Computing RMSF …', 70)
    indices, values = monet_mda.rmsf(universe, cmd.get('selection') or 'all', cmd.get('align', True))
    prog('Done', 100)
    ok(indices=indices, rmsf=values, n_frames=len(frames))


def action_mda_rgyr(cmd):
    frames, universe = _universe(cmd)
    prog('Computing radius of gyration …', 70)
    values = monet_mda.radius_of_gyration(universe, cmd.get('selection') or 'all')
    prog('Done', 100)
    ok(rgyr=values, frame_indices=frames)


def action_mda_hbonds(cmd):
    frames, universe = _universe(cmd)
    prog('Searching hydrogen bonds …', 60)
    counts, pairs = monet_mda.hydrogen_bonds(
        universe, cmd.get('donors') or 'element O N F', cmd.get('hydrogens') or 'element H',
        cmd.get('acceptors') or 'element O N F', cmd.get('d_a_cutoff', 3.0), cmd.get('angle', 150.0))
    prog('Done', 100)
    ok(counts=counts, pairs=pairs, frame_indices=frames)


def action_rmsd(cmd):
    """RMSD of selected atoms vs a reference frame, optionally Kabsch-aligned and unwrapped."""
    if not _require_ase(): return
    indices = cmd.get("indices")          # 0-indexed list; None = all
    prog("Loading frames …", 0)
    frames, positions, cells, pbc = _frame_data(cmd, indices)
    positions, warning = _maybe_unwrap(cmd, positions, cells, pbc)
    reference = cmd.get('reference_index')
    if reference is None:
        ref = positions[0]
    else:
        if reference not in frames:
            raise ValueError('The reference frame must be one of the analysed frames (a multiple of the frame step).')
        ref = positions[frames.index(reference)]
    values = monet_analysis.kabsch_rmsd(positions, ref, bool(cmd.get('align')))
    prog("RMSD done", 100)
    ok(rmsd=values.tolist(), frame_indices=frames, reference_index=frames[0] if reference is None else reference,
       aligned=bool(cmd.get('align')), warning=warning)


def action_rmsd_matrix(cmd):
    """Pairwise RMSD between analysed frames (reference paper: revisiting of states)."""
    if not _require_ase(): return
    max_frames = cmd.get('max_frames', 1000)
    prog("Loading frames …", 0)
    frames, positions, cells, pbc = _frame_data(cmd, cmd.get('indices'), max_frames=max_frames)
    positions, warning = _maybe_unwrap(cmd, positions, cells, pbc)
    matrix = monet_analysis.rmsd_matrix(positions, bool(cmd.get('align', True)), progress=prog)
    prog("Done", 100)
    ok(matrix=np.round(matrix, 6).tolist(), frame_indices=frames, aligned=bool(cmd.get('align', True)),
       truncated=len(frames) >= max_frames, warning=warning)


def _element_group(symbols, indices, element):
    pool = range(len(symbols)) if indices is None else indices
    return [i for i in pool if element is None or symbols[i] == element]


def action_rdf(cmd):
    """Normalised radial distribution function g(r) and coordination number n(r)."""
    if not _require_ase(): return
    prog("Loading frames …", 0)
    frames, positions, cells, pbc = _frame_data(cmd, need_cell=True)
    symbols = _first_atoms(cmd['filename'], cmd).get_chemical_symbols()
    elements = cmd.get('elements') or []
    first = elements[0] if elements else None
    second = elements[1] if len(elements) > 1 else first
    group_a = _element_group(symbols, cmd.get('indices'), first)
    group_b = _element_group(symbols, cmd.get('indices'), second)
    if not group_a or not group_b or (group_a == group_b and len(group_a) < 2):
        raise ValueError('The element/atom selection leaves too few atoms for an RDF.')
    limit = monet_analysis.max_rdf_radius(cells)
    rmax = cmd.get('rmax') or limit
    if rmax > limit + 1e-9:
        raise ValueError(f'Rmax must not exceed half the smallest cell width ({limit:.3f} A) for minimum-image distances.')
    r, g, n = monet_analysis.rdf(positions, cells, pbc, group_a, group_b, rmax, cmd.get('nbins', 200), progress=prog)
    prog("Done", 100)
    ok(r=r.tolist(), g=g.tolist(), n=n.tolist(), n_frames=len(frames), rmax=rmax, rmax_limit=limit,
       n_a=len(group_a), n_b=len(group_b), label=f"{first or 'all'}–{second or 'all'}")


def action_msd(cmd):
    """Mean-square displacement (unwrapped, time-origin averaged) and diffusion coefficient."""
    if not _require_ase(): return
    dt = cmd['dt'] * cmd.get('frame_step', 1)
    prog("Loading frames …", 0)
    frames, positions, cells, pbc = _frame_data(cmd, cmd.get('indices'))
    positions, warning = _maybe_unwrap({**cmd, 'unwrap': True}, positions, cells, pbc)
    if cmd.get('remove_drift', True):
        positions = positions - (positions.mean(axis=1, keepdims=True) - positions[:1].mean(axis=1, keepdims=True))
    if len(frames) < 4:
        raise ValueError('MSD needs at least four analysed frames.')
    prog("Computing MSD …", 90)
    symbols = _first_atoms(cmd['filename'], cmd).get_chemical_symbols()
    chosen = cmd.get('indices') or list(range(len(symbols)))
    times = np.arange(len(frames)) * dt
    series = {'selection': monet_analysis.msd(positions)}
    if cmd.get('by_element', True):
        for element in dict.fromkeys(symbols[i] for i in chosen):
            columns = [k for k, i in enumerate(chosen) if symbols[i] == element]
            if len(columns) != len(chosen):
                series[element] = monet_analysis.msd(positions[:, columns])
    start = cmd.get('fit_start', 0.1 * times[-1])
    end = cmd.get('fit_end', 0.5 * times[-1])
    fits = {name: monet_analysis.diffusion(times, values, start, end) for name, values in series.items()}
    prog("Done", 100)
    ok(times=times.tolist(), series={k: v.tolist() for k, v in series.items()}, fits=fits,
       fit_start=start, fit_end=end, frame_indices=frames, dt=dt, warning=warning,
       periodic=bool(pbc is not None and pbc.any()))


def action_vdos(cmd):
    """Vibrational density of states from finite-difference velocities."""
    if not _require_ase(): return
    dt = cmd['dt'] * cmd.get('frame_step', 1)
    prog("Loading frames …", 0)
    frames, positions, cells, pbc = _frame_data(cmd, cmd.get('indices'))
    positions, warning = _maybe_unwrap({**cmd, 'unwrap': True}, positions, cells, pbc)
    masses = None
    if cmd.get('mass_weighted', True):
        atoms = _first_atoms(cmd['filename'], cmd)
        chosen = cmd.get('indices') or list(range(len(atoms)))
        masses = atoms.get_masses()[chosen]
    prog("Computing spectrum …", 90)
    freq, intensity = monet_analysis.vdos(positions, dt, masses, cmd.get('smooth_cm', 0))
    keep = freq <= cmd.get('max_cm', 4000)
    prog("Done", 100)
    ok(wavenumber=freq[keep].tolist(), intensity=intensity[keep].tolist(), n_frames=len(frames), dt=dt,
       nyquist_cm=float(freq[-1]), resolution_cm=float(freq[1] - freq[0]) if len(freq) > 1 else None, warning=warning)


def action_subsample(cmd):
    """Write every `stride`-th frame (from `start`) as a new trajectory: the uncorrelated configurations."""
    traj = _require_xyz(cmd['filename'])
    stride = cmd.get('stride')
    start = cmd.get('start', 0)
    if type(stride) is not int or stride < 1:
        raise ValueError('The sampling stride must be a positive integer.')
    if type(start) is not int or not 0 <= start < traj.nframes:
        raise ValueError('The first frame must be inside the trajectory.')
    indices = list(range(start, traj.nframes, stride))
    if len(indices) < 2:
        raise ValueError(f'A stride of {stride} leaves only {len(indices)} configuration(s) out of {traj.nframes}: '
                         'the trajectory is shorter than the decorrelation time.')
    prog(f'Writing {len(indices):,} uncorrelated configurations …', 10)
    count = traj.write_frames(indices, cmd['output'])
    prog('Done', 100)
    ok(n_frames=count, source_frames=traj.nframes, stride=stride, start=start, first=indices[0], last=indices[-1])


def action_frames(cmd):
    """Positions of several frames for the trajectory player (Å, 4 decimals), plus their lattices."""
    traj = _require_xyz(cmd['filename'])
    indices = cmd.get('indices') or []
    if (not isinstance(indices, list) or not 1 <= len(indices) <= 500
            or any(type(i) is not int or not 0 <= i < traj.nframes for i in indices)):
        raise ValueError('Frame indices must be between 0 and the last frame (at most 500 per request).')
    positions = traj.positions(indices)
    cells = []
    for frame, _, comment in traj.iter_frames(indices):
        lattice, _ = traj.cell(comment)
        cells.append(None if lattice is None else lattice.tolist())
    ok(nframes=traj.nframes, natoms=traj.natoms, indices=indices,
       positions=[np.round(p, 4).ravel().tolist() for p in positions], cells=cells)


def action_wrap(cmd):
    """Write a copy with atoms or whole molecules inside the cell (optionally centred on a group)."""
    if not _require_ase(): return
    prog("Loading frames …", 0)
    frames, positions, cells, pbc = _frame_data(cmd, need_cell=True)
    if cells is None:
        raise ValueError('Wrapping needs a periodic cell: apply or load one first.')
    mode = cmd.get('mode', 'molecules')
    atoms = _first_atoms(cmd['filename'], cmd)
    symbols = atoms.get_chemical_symbols()
    tree = monet_analysis.molecule_tree(symbols, positions[0], cells[0], [True, True, True]) if mode == 'molecules' else None
    prog("Wrapping …", 50)
    wrapped = monet_analysis.wrap_positions(positions, cells, mode, tree, cmd.get('center'))
    row = ''.join(f'{s} %.8f %.8f %.8f\n' for s in symbols)
    flags = ' '.join('T' if v else 'F' for v in (pbc if pbc is not None else [True] * 3))
    with open(cmd['output'], 'w') as fh:
        for k, frame in enumerate(frames):
            lattice = ' '.join(f'{v:.10f}' for v in cells[k].ravel())
            fh.write(f'{len(symbols)}\nLattice="{lattice}" Properties=species:S:1:pos:R:3 pbc="{flags}" frame={frame} wrapped={mode}\n')
            fh.write(row % tuple((wrapped[k] + 0.0).ravel()))
    prog("Done", 100)
    ok(n_frames=len(frames), n_molecules=int(tree[2].max() + 1) if tree is not None else None, mode=mode)


def action_unwrap(cmd):
    """Write an unwrapped extended XYZ copy (continuous atom paths across PBC)."""
    if not _require_ase(): return
    prog("Loading frames …", 0)
    frames, positions, cells, pbc = _frame_data(cmd, need_cell=True)
    unwrapped, warning = _maybe_unwrap({**cmd, 'unwrap': True}, positions, cells, pbc)
    symbols = _first_atoms(cmd['filename'], cmd).get_chemical_symbols()
    row = ''.join(f'{s} %.8f %.8f %.8f\n' for s in symbols)
    flags = ' '.join('T' if v else 'F' for v in pbc)
    with open(cmd['output'], 'w') as fh:
        for k, frame in enumerate(frames):
            lattice = ' '.join(f'{v:.10f}' for v in cells[k].ravel())
            fh.write(f'{len(symbols)}\nLattice="{lattice}" Properties=species:S:1:pos:R:3 pbc="{flags}" frame={frame} unwrapped=T\n')
            fh.write(row % tuple((unwrapped[k] + 0.0).ravel()))
    prog("Done", 100)
    ok(n_frames=len(frames), output=cmd['output'], warning=warning)


def _series_for(cmd, quantity, groups):
    """Per-group time series (groups x frames) of a geometric quantity."""
    mic = cmd.get('mic', False)
    width = {'bond': 2, 'angle': 3, 'dihedral': 4, 'rmsd': None}[quantity]
    values = [[] for _ in groups]
    frames = []
    reference = None
    for fi, atoms in _load_images(cmd['filename'], cmd.get('frame_step', 1), cmd=cmd, label='Frame'):
        frames.append(fi)
        if quantity == 'rmsd':
            _validate_groups(groups, len(groups[0]), len(atoms))
            positions = atoms.get_positions()
            if reference is None:
                reference = positions
            for k, group in enumerate(groups):
                values[k].append(float(monet_analysis.kabsch_rmsd(positions[None, group], reference[group], cmd.get('align', False))[0]))
            continue
        _validate_groups(groups, width, len(atoms))
        for k, g in enumerate(groups):
            if quantity == 'bond':
                values[k].append(float(atoms.get_distance(g[0], g[1], mic=mic)))
            elif quantity == 'angle':
                values[k].append(float(atoms.get_angle(*g, mic=mic)))
            else:
                values[k].append(float(atoms.get_dihedral(*g, mic=mic)))
    return frames, np.array(values)


def _acf_series(cmd):
    """Analysed frames, per-group series and period of the autocorrelation quantity."""
    quantity = cmd['quantity']
    frames, series = _series_for(cmd, quantity, cmd['groups'])
    if cmd.get('mode', 'linear') == 'circular' and quantity not in ('angle', 'dihedral'):
        raise ValueError('Circular autocorrelation applies to angles and dihedrals only.')
    # Folded dihedrals (0-180, period 180) treat opposite orientations as the same torsion.
    folded = quantity == 'dihedral' and cmd.get('angle_range') == 'fold180'
    period = 180.0 if folded else 360.0
    return frames, (series % 180.0 if folded else series), period


def action_acf(cmd):
    """Autocorrelation of a selected quantity, exponential fit, correlation times and distribution."""
    if not _require_ase(): return
    quantity = cmd['quantity']
    step = cmd.get('frame_step', 1)
    dt = cmd['dt'] * step
    prog("Computing the quantity …", 0)
    frames, series, period = _acf_series(cmd)
    mode = cmd.get('mode', 'linear')
    signal = monet_analysis.unwrap_angles(series, period) if quantity == 'dihedral' and mode == 'linear' else series
    max_lag = cmd.get('max_lag')
    # Default: half of the run; longer lags average over too few time origins to be meaningful.
    lags_steps = series.shape[1] // 2 if max_lag is None else int(round(max_lag / dt))
    acf = monet_analysis.autocorrelation(signal, mode, lags_steps, period)
    lags = np.arange(len(acf)) * dt
    fit = monet_analysis.correlation_time(lags, acf, cmd.get('fit_until', 'zero'), cmd.get('fit_model', 'exp'),
                                          cmd.get('tau_int_method', 'sokal'), series.shape[1])
    tau = fit['tau_fit']
    plateau = fit['plateau'] if math.isfinite(fit['plateau']) else 0.0
    curve = ((1 - plateau) * np.exp(-lags / tau) + plateau).tolist() if math.isfinite(tau) and tau > 0 else None
    shown = series % period if quantity == 'dihedral' else series
    bins = cmd.get('nbins', 60)
    value_range = (0.0, period) if quantity == 'dihedral' else (0.0, 180.0) if quantity == 'angle' else None
    centres, density = monet_analysis.histogram_density(shown, bins, value_range)
    # Standard error of the mean corrected for correlation (N_eff = N dt / (2 tau_int)).
    tau_int = fit['tau_int']
    n = series.shape[1]
    n_eff = n * dt / (2 * tau_int) if math.isfinite(tau_int) and tau_int > 0 else n
    per_group = []
    for k, row in enumerate(shown):
        if quantity == 'dihedral':
            k = 2 * np.pi / period
            radians = k * row
            mean = float(np.arctan2(np.sin(radians).mean(), np.cos(radians).mean()) / k % period)
            std = float(np.sqrt(-2 * np.log(max(np.hypot(np.sin(radians).mean(), np.cos(radians).mean()), 1e-12))) / k)
        else:
            mean, std = float(row.mean()), float(row.std(ddof=1)) if n > 1 else 0.0
        per_group.append({'mean': mean, 'std': std, 'sem': std / math.sqrt(max(min(n_eff, n), 1))})
    # Blocking of the first group, on deviations from its (circular) mean so torsions crossing 0/360 stay continuous.
    first = shown[0] - per_group[0]['mean']
    if quantity == 'dihedral':
        first = (first + period / 2) % period - period / 2
    blocking = monet_analysis.block_average(first)
    blocking['times'] = [size * dt for size in blocking['sizes']]
    prog("Done", 100)
    ok(lags=lags.tolist(), acf=acf.tolist(), fit_curve=curve, frame_indices=frames, dt=dt, frame_step=step,
       series=np.round(shown, 6).tolist(), distribution={'x': centres.tolist(), 'density': density.tolist()},
       statistics=per_group, n_frames=n, n_effective=float(min(n_eff, n)), mode=mode, quantity=quantity,
       period=period if quantity == 'dihedral' else None, blocking=_finite(blocking), **_finite(fit))


def action_equilibration(cmd):
    """Start of the production window of the selected quantity by maximum N_eff (Chodera 2016)."""
    if not _require_ase(): return
    step = cmd.get('frame_step', 1)
    dt = cmd['dt'] * step
    prog('Computing the quantity …', 0)
    frames, series, period = _acf_series(cmd)
    if cmd['quantity'] == 'dihedral':
        series = monet_analysis.unwrap_angles(series, period)
    method = cmd.get('tau_int_method', 'sokal')
    results = []
    for k, row in enumerate(series):
        prog(f'Scanning production origins of group {k + 1}/{len(series)} …', 10 + 80 * k / len(series))
        results.append(monet_analysis.detect_equilibration(row, method=method))
    # The latest origin over all groups: every group is equilibrated from there on.
    group = max(range(len(results)), key=lambda k: results[k]['t0'])
    chosen = results[group]
    t0 = chosen['t0']
    prog('Done', 100)
    ok(**_finite({'starts': chosen['starts'], 'times': [s * dt for s in chosen['starts']], 'g': chosen['g'],
                  'n_effective': chosen['n_effective'], 't0': t0, 't0_time': t0 * dt, 't0_frame': int(frames[t0]),
                  'group': group, 'per_group_t0': [r['t0'] for r in results], 'n_frames': len(frames),
                  'frame_step': step, 'dt': dt, 'g_t0': chosen['g_t0'], 'n_effective_t0': chosen['n_effective_t0'],
                  'n_effective_full': chosen['n_effective'][0]}))


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
        _report_exception()


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
        _report_exception()


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
        _report_exception()


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
        _report_exception()


def _finite(value):
    """JSON-safe copy: non-finite floats become null."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite(v) for v in value]
    return value


FLUCTUATION_WIDTH = {'atoms': 1, 'bonds': 2, 'angles': 3, 'dihedrals': 4}


def action_fluctuations(cmd):
    """Oscillation statistics of atoms, bonds, angles or dihedrals: spread, extremes, trend and dominant frequency."""
    if not _require_ase(): return
    quantity = cmd['quantity']
    width = FLUCTUATION_WIDTH[quantity]
    step = cmd.get('frame_step', 1)
    prog('Loading frames …', 0)
    frames, positions, cells, pbc = _frame_data(cmd)
    if len(frames) < 3:
        raise ValueError('At least three analysed frames are needed; lower the frame step.')
    n_atoms = positions.shape[1]
    periodic = bool(cmd.get("mic", False) and cells is not None and pbc is not None and pbc.any())
    dt = cmd.get('dt')
    unit_dt = dt * step if dt else 1.0
    selection = cmd.get('indices')
    if selection is not None:
        _validate_groups([selection], len(selection), n_atoms)
    groups = cmd.get('groups')
    auto = groups is None
    prog('Measuring …', 40)
    if quantity == 'atoms':
        items = [[i] for i in (selection if selection is not None else range(n_atoms))] if auto else groups
        _validate_groups(items, 1, n_atoms)
        index = [g[0] for g in items]
        series, rmsf, deviation = monet_analysis.atomic_fluctuations(
            positions[:, index], cells if periodic else None, pbc, bool(cmd.get('align', True)) and len(index) >= 3)
        stats = monet_analysis.series_statistics(series, unit_dt)
        for k, entry in enumerate(stats):
            entry['rmsf'] = float(rmsf[k])
            if rmsf[k] > 1e-9:
                entry['frequency'], entry['frequency_share'] = monet_analysis.dominant_frequency(deviation[:, k, :], unit_dt)
            else:
                entry['frequency'] = entry['frequency_share'] = math.nan
    else:
        if auto:
            atoms = _first_atoms(cmd['filename'], cmd)
            ii, jj, _ = _neighbours(atoms, cmd.get('bond_scale', 1.2), periodic)
            neighbours = [set() for _ in range(n_atoms)]
            for i, j in zip(ii.tolist(), jj.tolist()):
                if i != j:
                    neighbours[i].add(j)
            items = monet_analysis.bonded_items(neighbours, quantity, None if selection is None else set(selection))
            if not items:
                raise ValueError(f'No {quantity} found among the selected atoms with this bond cutoff.')
        else:
            items = groups
            _validate_groups(items, width, n_atoms)
        series = monet_analysis.geometry_series(positions, items, cells if periodic else None, pbc).T
        stats = monet_analysis.series_statistics(series, unit_dt, 360.0 if quantity == 'dihedrals' else None)
    prog('Done', 100)
    # Time series travel only when they are small; otherwise the page asks for one item at a time.
    send = series.size <= 400000 or len(items) == 1
    ok(quantity=quantity, items=items, statistics=_finite(stats), frame_indices=frames, n_frames=len(frames),
       dt=unit_dt if dt else None, periodic=periodic, auto=auto, bond_scale=cmd.get('bond_scale', 1.2),
       series=_finite(np.round(series, 5).tolist()) if send else None)


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
        _report_exception()


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
        _report_exception()


def _validate_groups(groups, width, atom_count):
    if not groups:
        raise ValueError('Enter at least one atom group.')
    for group in groups:
        if (len(group) != width or any(type(i) is not int or i < 0 or i >= atom_count for i in group)
                or len(set(group)) != width):
            raise ValueError(f'Use {width} distinct atom indices between 0 and {atom_count - 1}.')


def _angle_value(value, cmd):
    if cmd.get('angle_range') == 'fold180':
        # Axial convention on [0, 180): suited to torsions fluctuating around 90 degrees.
        return value % 180.0
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


SELECT_MODES = {'element', 'neighbors', 'molecules', 'within', 'bonds', 'angles', 'dihedrals'}
PATTERN_WIDTH = {'bonds': 2, 'angles': 3, 'dihedrals': 4}


def _bond_graph(atoms, bond_scale):
    """Neighbour sets from ASE natural_cutoffs × bond_scale (minimum image when the atoms are periodic)."""
    from ase.neighborlist import neighbor_list, natural_cutoffs
    ii, jj = neighbor_list('ij', atoms, natural_cutoffs(atoms, mult=bond_scale))
    graph = [set() for _ in atoms]
    for i, j in zip(ii, jj):
        if i != j:
            graph[int(i)].add(int(j))
    return graph


def _pattern_groups(graph, symbols, pattern, allowed=None):
    """Bonded chains i-j (bonds), i-j-k (angles) or i-j-k-l (dihedrals) whose elements match
    the pattern in either direction ('*' matches any element). Each chain is reported once."""
    width = len(pattern)
    match = lambda chain, pat: all(p == '*' or symbols[a] == p for a, p in zip(chain, pat))
    ok_atom = (lambda a: a in allowed) if allowed is not None else (lambda a: True)
    groups, seen = [], set()

    def emit(chain):
        key = min(tuple(chain), tuple(reversed(chain)))
        if key in seen or not all(ok_atom(a) for a in chain):
            return
        if match(chain, pattern):
            seen.add(key); groups.append(list(chain))
        elif match(chain[::-1], pattern):
            seen.add(key); groups.append(list(chain[::-1]))

    for j, neighbours in enumerate(graph):
        if width == 2:
            for k in neighbours:
                emit((j, k))
        elif width == 3:
            ordered = sorted(neighbours)
            for a in range(len(ordered)):
                for b in range(a + 1, len(ordered)):
                    emit((ordered[a], j, ordered[b]))
        else:
            for k in neighbours:
                if k < j:
                    continue
                for i in graph[j] - {k}:
                    for l in graph[k] - {j, i}:
                        emit((i, j, k, l))
    groups.sort()
    return groups


def action_select_atoms(cmd):
    """Selection helpers on the first frame, with ASE neighbour lists (like ase gui / ase.geometry.analysis):
    element, bonded neighbours, whole molecules, sphere of radius R, and bond/angle/dihedral chains by element."""
    if not _require_ase(): return
    from ase.neighborlist import neighbor_list
    atoms = _first_atoms(cmd['filename'], cmd)
    if not cmd.get('mic', False):
        atoms.set_pbc(False)
    mode = cmd['mode']
    n = len(atoms)
    seeds = [int(i) for i in cmd.get('indices') or []]
    _validate_groups([[i] for i in seeds], 1, n) if seeds else None
    symbols = atoms.get_chemical_symbols()
    scale = cmd.get('bond_scale', 1.2)
    if mode == 'element':
        wanted = set(cmd.get('elements') or [])
        ok(indices=[i for i, s in enumerate(symbols) if s in wanted], mode=mode)
    elif mode in ('neighbors', 'molecules'):
        if not seeds:
            raise ValueError('Select at least one atom first.')
        graph = _bond_graph(atoms, scale)
        chosen = list(dict.fromkeys(seeds))
        found = set(chosen)
        frontier = list(chosen)
        while frontier:
            nxt = []
            for i in frontier:
                for j in sorted(graph[i]):
                    if j not in found:
                        found.add(j); chosen.append(j); nxt.append(j)
            frontier = nxt if mode == 'molecules' else []
        ok(indices=chosen, mode=mode, bond_scale=scale)
    elif mode == 'within':
        if not seeds:
            raise ValueError('Select at least one atom first.')
        radius = float(cmd['radius'])
        ii, jj = neighbor_list('ij', atoms, radius)
        seed_set = set(seeds)
        found = set(int(j) for i, j in zip(ii, jj) if int(i) in seed_set)
        ok(indices=seeds + sorted(found - seed_set), mode=mode, radius=radius)
    else:
        pattern = [str(p) for p in cmd['pattern']]
        restrict = cmd.get('restrict')
        allowed = set(int(i) for i in restrict) if restrict else None
        groups = _pattern_groups(_bond_graph(atoms, scale), symbols, pattern, allowed)
        ok(groups=groups[:20000], n_groups=len(groups), truncated=len(groups) > 20000, mode=mode, bond_scale=scale)


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
    def positive(name, required=False, integer=False, maximum=None):
        value = cmd.get(name)
        if value is None:
            if required:
                raise ValueError(f'{name} is required.')
            return
        kind = (int,) if integer else (int, float)
        if type(value) not in kind or not math.isfinite(value) or value <= 0 or (maximum and value > maximum):
            raise ValueError(f'{name} must be a positive {"integer" if integer else "number"}' + (f' up to {maximum}.' if maximum else '.'))
    action = cmd.get('action')
    if action == 'mda_run':
        if cmd.get('analysis') not in MDA_ANALYSES:
            raise ValueError('Unknown MDAnalysis analysis.')
        params = cmd.get('params') or {}
        if not isinstance(params, dict) or len(params) > 20:
            raise ValueError('Analysis parameters must be a small object.')
        for key, value in params.items():
            if isinstance(value, str):
                if len(value) > 2000:
                    raise ValueError(f'{key} is too long.')
            elif isinstance(value, bool) or value is None:
                continue
            elif isinstance(value, (int, float)):
                if not math.isfinite(value) or value < 0:
                    raise ValueError(f'{key} must be a non-negative number.')
            elif isinstance(value, list):
                if key == 'quads':
                    _validate_groups(value, 4, 10 ** 9)
                elif not all(isinstance(v, str) and len(v) <= 2000 for v in value) or len(value) > 20:
                    raise ValueError(f'{key} must be a list of selections.')
            else:
                raise ValueError(f'Unsupported value for {key}.')
    if action == 'select_atoms':
        mode = cmd.get('mode')
        if mode not in SELECT_MODES:
            raise ValueError('Unknown selection mode.')
        for key in ('indices', 'restrict'):
            value = cmd.get(key)
            if value is not None and (not isinstance(value, list) or len(value) > 10 ** 6
                                      or any(type(i) is not int or i < 0 for i in value)):
                raise ValueError(f'{key} must be a list of atom indices.')
        if mode == 'element':
            elements = cmd.get('elements')
            if not isinstance(elements, list) or not elements or any(not isinstance(e, str) or len(e) > 3 for e in elements):
                raise ValueError('Choose at least one element.')
        if mode == 'within':
            radius = cmd.get('radius')
            if type(radius) not in (int, float) or not 0 < radius <= 30:
                raise ValueError('The radius must be between 0 and 30 Å.')
        if mode in PATTERN_WIDTH:
            pattern = cmd.get('pattern')
            if (not isinstance(pattern, list) or len(pattern) != PATTERN_WIDTH[mode]
                    or any(not isinstance(p, str) or not p or len(p) > 3 for p in pattern)):
                raise ValueError(f'Enter {PATTERN_WIDTH[mode]} element symbols (or *) for {mode}.')
    if action in ('ase_structure', 'ase_coordination', 'topology', 'mda_run', 'mda_align', 'molecule', 'fluctuations', 'select_atoms'):
        scale = cmd.get('bond_scale', 1.2)
        if type(scale) not in (int, float) or not 0.5 <= scale <= 2.0:
            raise ValueError('The bond cutoff scale must be between 0.5 and 2.')
    if action and action.startswith('mda_'):
        for name in ('selection', 'donors', 'hydrogens', 'acceptors'):
            if name in cmd and cmd[name] is not None and (not isinstance(cmd[name], str) or len(cmd[name]) > 2000):
                raise ValueError(f'{name} must be an MDAnalysis selection string.')
        if action == 'mda_select' and not (cmd.get('selection') or '').strip():
            raise ValueError('Enter an MDAnalysis selection, e.g. "resname H2O and element O".')
        for name, low, high in (('d_a_cutoff', 1.0, 6.0), ('angle', 90.0, 180.0)):
            if name in cmd and (type(cmd[name]) not in (int, float) or not low <= cmd[name] <= high):
                raise ValueError(f'{name} must be between {low} and {high}.')
    if action in ('msd', 'vdos', 'acf', 'equilibration'):
        positive('dt', required=True)
    if action == 'fluctuations':
        if cmd.get('quantity') not in FLUCTUATION_WIDTH:
            raise ValueError('Quantity must be atoms, bonds, angles or dihedrals.')
        positive('dt')
        groups = cmd.get('groups')
        if groups is not None and (not isinstance(groups, list) or len(groups) > 5000):
            raise ValueError('Enter at most 5000 atom groups.')
        if groups is not None:
            _validate_groups(groups, FLUCTUATION_WIDTH[cmd['quantity']], 10 ** 9)
    for name in ('fit_start', 'fit_end', 'max_lag', 'max_cm'):
        positive(name)
    if 'smooth_cm' in cmd and (type(cmd['smooth_cm']) not in (int, float) or not 0 <= cmd['smooth_cm'] < 1000):
        raise ValueError('Smoothing must be between 0 and 1000 cm-1.')
    positive('max_frames', integer=True, maximum=3000)
    for name in ('align', 'unwrap', 'remove_drift', 'by_element', 'mass_weighted'):
        if name in cmd and type(cmd[name]) is not bool:
            raise ValueError(f'{name} must be true or false.')
    if cmd.get('reference_index') is not None and (type(cmd['reference_index']) is not int or cmd['reference_index'] < 0):
        raise ValueError('Reference frame must be a non-negative integer.')
    if action == 'rdf':
        bins = cmd.get('nbins', 200)
        if type(bins) is not int or not 1 <= bins <= 10000:
            raise ValueError('Bins must be an integer between 1 and 10000.')
        positive('rmax')
    if action == 'wrap':
        if cmd.get('mode', 'molecules') not in ('atoms', 'molecules'):
            raise ValueError('Wrap atoms or whole molecules.')
        center = cmd.get('center')
        if center is not None and (not isinstance(center, list) or any(type(i) is not int or i < 0 for i in center)):
            raise ValueError('Centre atoms must be valid indices.')
    if action in ('acf', 'equilibration'):
        quantity = cmd.get('quantity')
        widths = {'bond': 2, 'angle': 3, 'dihedral': 4, 'rmsd': None}
        if quantity not in widths:
            raise ValueError('Choose bond, angle, dihedral or RMSD for the autocorrelation.')
        groups = cmd.get('groups')
        if not isinstance(groups, list) or not groups or not all(isinstance(g, list) and g for g in groups):
            raise ValueError('Select at least one atom group.')
        for group in groups:
            if any(type(i) is not int or i < 0 for i in group) or len(set(group)) != len(group):
                raise ValueError('Atom groups must contain distinct valid indices.')
            if widths[quantity] and len(group) != widths[quantity]:
                raise ValueError(f'Use groups of {widths[quantity]} atoms for this quantity.')
        if quantity == 'rmsd' and len(groups) != 1:
            raise ValueError('RMSD autocorrelation uses a single atom selection.')
        if cmd.get('mode', 'linear') not in ('linear', 'circular'):
            raise ValueError('Unknown autocorrelation mode.')
        if cmd.get('angle_range', '360') not in ('360', 'fold180'):
            raise ValueError('Autocorrelation dihedrals use the 0–360° or folded 0–180° range.')
        if cmd.get('fit_until', 'zero') not in ('zero', 'efold', 'all'):
            raise ValueError('Unknown fit window.')
        if cmd.get('fit_model', 'exp') not in ('exp', 'exp_offset'):
            raise ValueError('Unknown autocorrelation fit model.')
        bins = cmd.get('nbins', 60)
        if type(bins) is not int or not 2 <= bins <= 2000:
            raise ValueError('Distribution bins must be an integer between 2 and 2000.')
        if cmd.get('tau_int_method', 'sokal') not in monet_analysis.TAU_INT_METHODS:
            raise ValueError('Unknown τ_int estimator: use sokal, geyer or zero.')
    if cmd.get('action') == 'import':
        import monet_formats
        if not monet_formats.valid_format(cmd.get('format', 'auto')):
            raise ValueError('Unsupported input format.')
        if cmd.get('cell_vectors', 'rows') not in ('rows', 'columns'):
            raise ValueError('Cell vectors must be rows or columns.')
    mode = cmd.get('angle_range', 'natural')
    if mode not in ('natural', '360', 'signed90', 'fold180'):
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
    "rmsd_matrix": action_rmsd_matrix,
    "rdf":       action_rdf,
    "msd":       action_msd,
    "vdos":      action_vdos,
    "unwrap":    action_unwrap,
    "wrap":      action_wrap,
    "frames":    action_frames,
    "mda_run":   action_mda_run,
    "mda_align": action_mda_align,
    "topology":  action_topology,
    "ase_structure": action_ase_structure,
    "ase_coordination": action_ase_coordination,
    "fluctuations": action_fluctuations,
    "subsample": action_subsample,
    "acf":       action_acf,
    "equilibration": action_equilibration,
    "formats":   action_formats,
    "mda_select": action_mda_select,
    "mda_rmsf":  action_mda_rmsf,
    "mda_rgyr":  action_mda_rgyr,
    "mda_hbonds": action_mda_hbonds,
    "import":    action_import,
    "read_info": action_read_info,
    "cell_file": action_cell_file,
    "molecule":  action_molecule,
    "select_atoms": action_select_atoms,
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
        _report_exception()

if __name__ == "__main__":
    main()

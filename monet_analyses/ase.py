"""ASE analyses of ASE › More analyses, on the active MONET trajectory.

Every function receives the context (frames with the MONET cell, PBC, minimum-image and bond-cutoff
settings) and the checked parameters, and returns a result for the generic plots. The modules used
are those of ASE that analyse configurations that already exist: md.analysis, geometry (analysis,
rdf, dimensionality, layers), neighborlist, cell, spacegroup.symmetrize, utils.xrdebye and build.
ASE calculators, optimisers, MD engines, NEB, vibrations and phonons are not used: they compute
new energies or forces, which a trajectory analysis does not do.
"""
from collections import Counter

import numpy as np

import monet_analysis
from monet_registry import Param, analysis, profile, series, table

DYNAMICS = 'Dynamics'
STORED = 'Values stored in the file'
BONDS = 'Bonds and molecules'
STRUCTURE = 'Structure and symmetry'
SCATTERING = 'Scattering'
CELL = 'Cell'

ASE_CITATION = ('A. H. Larsen et al., The atomic simulation environment — a Python library for working with atoms, '
                'J. Phys.: Condens. Matter 29, 273002 (2017).')
DIMENSIONALITY_CITATION = (ASE_CITATION + ' P. M. Larsen, M. Pandey, M. Strange, K. W. Jacobsen, Definition of a scoring '
                           'parameter to identify low-dimensional materials components, Phys. Rev. Materials 3, 034003 (2019).')
XRAY_CITATION = (ASE_CITATION + ' D. Waasmaier, A. Kirfel, New analytical scattering-factor functions for free atoms '
                 'and ions, Acta Cryst. A51, 416–431 (1995).')
MAX_CURVES = 12       # curves drawn per plot; the table lists every type
MAX_EVENT_ROWS = 2000


# ── shared helpers ───────────────────────────────────────────────────────────

def _images(ctx, need_cell=False, periodic=None):
    """(frames, [ase.Atoms]) of the analysed frames built from ctx.frames().

    periodic=None follows the minimum-image setting of MONET (bonds, molecules); True keeps the PBC of the
    cell whatever that setting (analyses of the lattice itself)."""
    data = ctx.frames(need_cell=need_cell)
    base = ctx.atoms()
    base.calc = None
    use_pbc = ctx.mic if periodic is None else periodic
    images = []
    for k in range(len(data.frames)):
        atoms = base.copy()
        atoms.positions = data.positions[k]
        if data.cells is not None:
            atoms.set_cell(data.cells[k])
            atoms.set_pbc(data.pbc if use_pbc else False)
        else:
            atoms.set_cell(np.zeros((3, 3)))
            atoms.set_pbc(False)
        images.append(atoms)
    return data.frames, images


def _cutoffs(atoms, scale):
    """Covalent radii × the MONET bond-cutoff scale (dummy atoms X never bond), as in the ASE structure panel."""
    from ase.neighborlist import natural_cutoffs
    return [0.0 if s == 'X' else c for s, c in zip(atoms.get_chemical_symbols(), natural_cutoffs(atoms, mult=scale))]


def _bond_codes(atoms, cutoffs):
    """Bonded pairs i < j of one frame as sorted codes i·n + j."""
    from ase.neighborlist import neighbor_list
    i, j = neighbor_list('ij', atoms, cutoffs)
    keep = i < j
    return np.unique(i[keep].astype(np.int64) * len(atoms) + j[keep])


def _element_filter(text, width, what):
    """Element tuple typed as "C-H" / "H C H" (None when blank), checked against the width of the type."""
    text = (text or '').replace('–', '-').replace(',', ' ').replace('-', ' ').split()
    if not text:
        return None
    names = tuple(s[:1].upper() + s[1:].lower() for s in text)
    if len(names) != width:
        raise ValueError(f'“Elements” needs {width} element symbols for {what}, e.g. '
                         f'{"-".join(("C", "H", "H", "C")[:width]) if width != 2 else "O-H"}.')
    return names


def _canonical(names):
    names = tuple(names)
    return min(names, names[::-1])


def _stats_row(label, values, digits=4):
    values = np.asarray(values, dtype=float)
    sd = float(np.std(values, ddof=1)) if values.size > 1 else 0.0
    return [label, int(values.size), round(float(np.mean(values)), digits), round(sd, digits),
            round(float(np.min(values)), digits), round(float(np.max(values)), digits)]


def _hill(counts):
    from ase.formula import Formula
    return Formula.from_dict(counts).format('hill')


def _components(n, codes):
    """Connected components (molecules) of n atoms bonded by the pair codes."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    i, j = np.divmod(codes, n)
    graph = coo_matrix((np.ones(len(codes)), (i, j)), shape=(n, n))
    return connected_components(graph, directed=False)[1]


# ── dynamics ─────────────────────────────────────────────────────────────────

@analysis('diffusion', 'ase', 'Self-diffusion coefficient per element (md.analysis.DiffusionCoefficient)',
          category=DYNAMICS, citation=ASE_CITATION,
          description='ase.md.analysis.DiffusionCoefficient: Einstein relation ⟨|r(t) − r(0)|²⟩ = 6Dt fitted over each '
                      'segment of the trajectory, one D per element (or for the centre of mass of the chosen atoms). '
                      'The spread between segments gives the standard deviation. Periodic trajectories are unwrapped '
                      'first. The fit covers the whole segment, ballistic start included; MONET Custom › MSD/diffusion '
                      'lets you choose the fitting window. Needs the time axis (fs between frames).',
          params=[Param.atoms('Atoms (blank = all)'),
                  Param.integer('segments', 'Segments (for the standard deviation)', 1, min=1, max=100),
                  Param.integer('skip', 'Analysed frames skipped at the start (equilibration)', 0, min=0),
                  Param.bool('molecule', 'Centre of mass of the chosen atoms (one molecule)', False)])
def diffusion(ctx, p):
    from ase import Atoms, units
    from ase.md.analysis import DiffusionCoefficient
    if not ctx.dt:
        raise ValueError('Set the time axis (fs between frames) first: a diffusion coefficient needs time.')
    data = ctx.frames()
    positions = data.positions
    notes = []
    if data.cells is not None and data.pbc is not None and data.pbc.any():
        positions, worst = monet_analysis.unwrap(positions, data.cells, data.pbc)
        if worst > 0.35:
            notes.append(f'Largest step between analysed frames is {worst:.2f} of the cell: use a smaller frame step '
                         'for reliable unwrapping.')
    symbols = ctx.symbols
    indices = p['indices'] if p['indices'] is not None else list(range(len(symbols)))
    usable = len(positions) - p['skip']
    if usable // p['segments'] < 3:
        raise ValueError(f'Each segment needs at least 3 analysed frames ({usable} left after the skipped ones for '
                         f'{p["segments"]} segment(s)): use fewer segments, a smaller frame step or skip fewer frames.')
    images = [Atoms(symbols, positions=pos) for pos in positions]
    ctx.progress('Fitting the mean square displacement …', 40)
    coefficient = DiffusionCoefficient(images, ctx.dt * units.fs, atom_indices=indices, molecule=p['molecule'])
    if not p['molecule']:
        # ASE divides by every atom of the element in the file; only the chosen atoms were summed.
        chosen = [symbols[i] for i in indices]
        coefficient.no_of_atoms = [chosen.count(s) for s in coefficient.types_of_atoms]
    coefficient.calculate(ignore_n_images=p['skip'], number_of_segments=p['segments'])
    slopes, spread = coefficient.get_diffusion_coefficients()
    # Å² per ASE time unit → Å²/fs (× units.fs) → cm²/s (× 0.1); shown in 10⁻⁵ cm²/s.
    to_1e5 = units.fs * 0.1 * 1e5
    msd = 2 * coefficient.xyz_segment_ensemble_average.sum(axis=2).mean(axis=0)
    time_ps = np.arange(coefficient.len_segments) * ctx.dt / 1000.0
    labels = coefficient.types_of_atoms
    counts = coefficient.no_of_atoms
    rows = [[('centre of mass' if p['molecule'] else name), (len(indices) if p['molecule'] else counts[k]),
             round(slopes[k] * to_1e5, 5), round(spread[k] * to_1e5, 5), round(slopes[k] * units.fs * 1000, 6)]
            for k, name in enumerate(labels)]
    curves = {f'MSD {"centre of mass" if p["molecule"] else name}': msd[k] for k, name in enumerate(labels)}
    notes += [f'{coefficient.no_of_segments} segment(s) of {coefficient.len_segments} analysed frames '
              f'({time_ps[-1]:.4g} ps each); {p["skip"]} frame(s) skipped.',
              'Curves: MSD averaged over the segments (6Dt in three dimensions).']
    return profile(time_ps, curves, 'Time (ps)', 'MSD (Å²)', notes=notes,
                   table={'columns': ['Element', 'Atoms', 'D (10⁻⁵ cm² s⁻¹)', 'SD between segments', 'D (Å² ps⁻¹)'],
                          'rows': rows})


# ── values stored in the file ────────────────────────────────────────────────

STORED_QUANTITIES = ('potential energy', 'forces', 'kinetic temperature', 'pressure')


def _energy(atoms):
    from ase import units
    results = atoms.calc.results if atoms.calc is not None else {}
    for key in ('energy', 'free_energy'):
        if key in results:
            return float(results[key])
    info = atoms.info
    for key in ('energy', 'Energy', 'potential_energy', 'E_pot', 'Epot'):
        if isinstance(info.get(key), (int, float, np.number)):
            return float(info[key])
    if isinstance(info.get('E'), (int, float, np.number)) and 'i' in info:
        return float(info['E']) * units.Hartree       # CP2K comment line: i = …, time = …, E = … (hartree)
    return None


def _forces(atoms):
    results = atoms.calc.results if atoms.calc is not None else {}
    forces = results.get('forces')
    if forces is None:
        forces = atoms.arrays.get('forces')
    return None if forces is None else np.linalg.norm(np.asarray(forces, dtype=float), axis=1)


def _stress(atoms):
    results = atoms.calc.results if atoms.calc is not None else {}
    stress = results.get('stress')
    if stress is None:
        stress = atoms.info.get('stress')
    if stress is None:
        return None
    stress = np.asarray(stress, dtype=float).ravel()
    return stress[:3] if stress.size == 6 else stress[[0, 4, 8]] if stress.size == 9 else None


def _stored_names(atoms):
    found = []
    if _energy(atoms) is not None:
        found.append('potential energy')
    if _forces(atoms) is not None:
        found.append('forces')
    if 'momenta' in atoms.arrays:
        found.append('kinetic temperature')
    if _stress(atoms) is not None:
        found.append('pressure')
    return found


@analysis('stored_properties', 'ase', 'Energy, forces, temperature or pressure written in the file',
          category=STORED, citation=ASE_CITATION,
          description='Reads with ase.io what the MD program wrote for every frame: potential energy (extended XYZ '
                      'energy=, CP2K "E =" in hartree converted to eV), forces (largest and RMS |F|), kinetic '
                      'temperature from the momenta (Atoms.get_temperature, 3N degrees of freedom) and pressure '
                      '−tr(σ)/3 from the stress. Nothing is recomputed: no calculator is used. The stress is taken as '
                      'written; whether it includes the kinetic term depends on the MD program.',
          params=[Param.choice('quantity', 'Quantity', STORED_QUANTITIES)])
def stored_properties(ctx, p):
    from ase import units
    frames, images = ctx.images()
    quantity = p['quantity']
    values = {}
    for atoms in images:
        if quantity == 'potential energy':
            energy = _energy(atoms)
            values.setdefault('Potential energy', []).append(energy)
        elif quantity == 'forces':
            norms = _forces(atoms)
            values.setdefault('Largest |F|', []).append(None if norms is None else float(norms.max()))
            values.setdefault('RMS |F|', []).append(None if norms is None else float(np.sqrt(np.mean(norms ** 2))))
        elif quantity == 'kinetic temperature':
            values.setdefault('Kinetic temperature', []).append(
                float(atoms.get_temperature()) if 'momenta' in atoms.arrays else None)
        else:
            diagonal = _stress(atoms)
            values.setdefault('Pressure', []).append(None if diagonal is None else float(-diagonal.mean() / units.GPa))
    present = [v for v in next(iter(values.values())) if v is not None]
    if not present:
        stored = sorted({name for atoms in images[:5] for name in _stored_names(atoms)})
        raise ValueError(f'The file stores no {quantity} for the analysed frames. '
                         + (f'It stores: {", ".join(stored)}.' if stored else
                            'It stores only coordinates (write an extended XYZ with energy, forces, momenta or stress).'))
    unit = {'potential energy': 'eV', 'forces': 'eV Å⁻¹', 'kinetic temperature': 'K', 'pressure': 'GPa'}[quantity]
    rows = [_stats_row(name, [v for v in data if v is not None], 6) for name, data in values.items()]
    notes = []
    missing = sum(v is None for v in next(iter(values.values())))
    if missing:
        notes.append(f'{missing} of {len(frames)} analysed frames store no {quantity} (gaps in the curve).')
    return series(frames, values, y_label=f'{quantity.capitalize()} ({unit})', notes=notes,
                  table={'columns': ['Quantity', 'Frames', f'Mean ({unit})', 'SD', 'Min', 'Max'], 'rows': rows})


# ── bonds and molecules ──────────────────────────────────────────────────────

BOND_KINDS = {'bonds': (2, 'Bond length (Å)'), 'angles': (3, 'Angle (°)'), 'dihedrals': (4, 'Dihedral (°, 0–360)')}


def _connectivity_tuples(atoms, scale, kind):
    """Bonds, angles or dihedrals of the first frame from ase.geometry.analysis.Analysis (MONET bond cutoff)."""
    from ase.geometry.analysis import Analysis
    found = Analysis(atoms, cutoffs=_cutoffs(atoms, scale), self_interaction=False, bothways=True)
    if kind == 'bonds':
        return [(i, int(j)) for i, others in enumerate(found.unique_bonds[0]) for j in others]
    if kind == 'angles':
        return [(i, int(v), int(k)) for i, others in enumerate(found.unique_angles[0]) for v, k in others]
    return [(i, int(a), int(b), int(d)) for i, others in enumerate(found.unique_dihedrals[0]) for a, b, d in others]


def _tuple_values(atoms, tuples, kind):
    """Values of every tuple in one frame with ase.geometry (minimum image when the frame is periodic)."""
    from ase.geometry import find_mic, get_angles, get_dihedrals
    pos = atoms.positions
    t = np.asarray(tuples)
    periodic = bool(atoms.pbc.any())
    cell, pbc = (atoms.cell, atoms.pbc) if periodic else (None, None)
    if kind == 'bonds':
        v = pos[t[:, 1]] - pos[t[:, 0]]
        return find_mic(v, cell, pbc)[1] if periodic else np.linalg.norm(v, axis=1)
    if kind == 'angles':
        return get_angles(pos[t[:, 0]] - pos[t[:, 1]], pos[t[:, 2]] - pos[t[:, 1]], cell, pbc)
    return get_dihedrals(pos[t[:, 1]] - pos[t[:, 0]], pos[t[:, 2]] - pos[t[:, 1]], pos[t[:, 3]] - pos[t[:, 2]], cell, pbc)


@analysis('bond_types', 'ase', 'Every bond, angle or dihedral by element type (geometry.analysis.Analysis)',
          category=BONDS, citation=ASE_CITATION,
          description='ase.geometry.analysis.Analysis finds every bond, angle and dihedral of the first frame (bond '
                      'cutoff of MONET); their values are then followed in every analysed frame and grouped by element '
                      'type (C–H, H–C–H, H–C–C–H …). Distribution: histogram of all values of each type; along the '
                      'trajectory: mean of each type per frame. Minimum image follows the MONET setting.',
          params=[Param.choice('kind', 'Measure', tuple(BOND_KINDS)),
                  Param.text('elements', 'Elements (blank = every type), e.g. O-H, H-O-H'),
                  Param.choice('show', 'Show', ('distribution', 'mean along the trajectory')),
                  Param.integer('bins', 'Histogram bins', 100, min=10, max=1000)])
def bond_types(ctx, p):
    kind = p['kind']
    width, axis = BOND_KINDS[kind]
    wanted = _element_filter(p['elements'], width, kind)
    frames, images = _images(ctx)
    symbols = images[0].get_chemical_symbols()
    ctx.progress(f'Finding the {kind} of the first frame …', 20)
    tuples = _connectivity_tuples(images[0], ctx.bond_scale, kind)
    groups = {}
    for k, tup in enumerate(tuples):
        name = _canonical(symbols[i] for i in tup)
        if wanted is None or name == _canonical(wanted):
            groups.setdefault(name, []).append(k)
    if not groups:
        raise ValueError(f'No {kind} ' + (f'of type {"–".join(wanted)} ' if wanted else '')
                         + 'in the first frame with the current bond cutoff.')
    values = np.empty((len(images), len(tuples)))
    for f, atoms in enumerate(images):
        values[f] = _tuple_values(atoms, tuples, kind)
        if f % 200 == 199:
            ctx.progress(f'Frame {frames[f]:,} …', 20 + 75 * (f + 1) / len(images))
    order = sorted(groups, key=lambda name: -len(groups[name]))
    rows = [_stats_row('–'.join(name) + f' ({len(groups[name])})', values[:, groups[name]]) for name in order]
    notes = [f'{len(tuples)} {kind} in the first frame, {len(groups)} type(s); '
             f'{len(images)} analysed frames.']
    if len(order) > MAX_CURVES:
        notes.append(f'The plot shows the {MAX_CURVES} most frequent types; the table lists all of them.')
    shown = order[:MAX_CURVES]
    columns = ['Type (count)', 'Values', 'Mean', 'SD', 'Min', 'Max']
    if p['show'] == 'distribution':
        chosen = np.concatenate([values[:, groups[name]].ravel() for name in shown])
        low, high = float(chosen.min()), float(chosen.max())
        if high - low < 1e-9:
            low, high = low - 0.5, high + 0.5
        curves = {}
        for name in shown:
            centres, density = monet_analysis.histogram_density(values[:, groups[name]], p['bins'], (low, high))
            curves['–'.join(name)] = density
        return profile(centres, curves, axis, 'Probability density', notes=notes,
                       table={'columns': columns, 'rows': rows})
    curves = {'–'.join(name): values[:, groups[name]].mean(axis=1) for name in shown}
    return series(frames, curves, y_label=f'Mean {axis[0].lower() + axis[1:]}', notes=notes,
                  table={'columns': columns, 'rows': rows})


@analysis('molecules', 'ase', 'Molecules and species along the trajectory (neighborlist)',
          category=BONDS, citation=ASE_CITATION,
          description='In every analysed frame the atoms are joined by bonds (ase.neighborlist, covalent radii × the '
                      'MONET bond cutoff) and each connected group is a molecule, named by its Hill formula. Shows how '
                      'many molecules of each species there are in every frame: proton transfer, dissociation, '
                      'clustering. Minimum image follows the MONET setting.',
          params=[Param.integer('species', 'Species plotted (most abundant)', 8, min=1, max=MAX_CURVES)])
def molecules(ctx, p):
    frames, images = _images(ctx)
    cutoffs = _cutoffs(images[0], ctx.bond_scale)
    symbols = images[0].get_chemical_symbols()
    counts = []
    for f, atoms in enumerate(images):
        labels = _components(len(atoms), _bond_codes(atoms, cutoffs))
        members = {}
        for index, label in enumerate(labels):
            members.setdefault(label, Counter())[symbols[index]] += 1
        counts.append(Counter(_hill(dict(c)) for c in members.values()))
        if f % 200 == 199:
            ctx.progress(f'Frame {frames[f]:,} …', 10 + 85 * (f + 1) / len(images))
    names = sorted({name for c in counts for name in c}, key=lambda name: -sum(c[name] for c in counts))
    rows = []
    for name in names:
        values = np.array([c[name] for c in counts])
        first = next(frames[k] for k, v in enumerate(values) if v)
        rows.append([name, round(float(values.mean()), 4), int(values.min()), int(values.max()),
                     round(100 * float(np.count_nonzero(values)) / len(values), 2), first])
    curves = {name: [c[name] for c in counts] for name in names[:p['species']]}
    curves['all molecules'] = [sum(c.values()) for c in counts]
    notes = [f'{len(names)} species in {len(frames)} analysed frames; bond cutoff = covalent radii × {ctx.bond_scale}.']
    if len(names) > p['species']:
        notes.append(f'The plot shows the {p["species"]} most abundant species; the table lists all of them.')
    return series(frames, curves, y_label='Molecules', notes=notes,
                  table={'columns': ['Species', 'Mean count', 'Min', 'Max', 'Frames present (%)', 'First frame'],
                         'rows': rows})


def _confirmed(states, hold):
    """Bond states (frames × pairs) after ignoring changes that last fewer than `hold` analysed frames."""
    if hold <= 1:
        return states
    count = len(states)
    stays = np.zeros_like(states)
    if count >= hold:
        window = np.lib.stride_tricks.sliding_window_view(states, hold, axis=0)
        stays[:count - hold + 1] = np.all(window == states[:count - hold + 1, :, None], axis=2)
    out = states.copy()
    for t in range(1, count):
        change = (states[t] != out[t - 1]) & stays[t]
        out[t] = np.where(change, states[t], out[t - 1])
    return out


@analysis('bond_events', 'ase', 'Bonds formed and broken (neighborlist)', category=BONDS, citation=ASE_CITATION,
          description='Compares the bonds (ase.neighborlist, covalent radii × the MONET bond cutoff) of consecutive '
                      'analysed frames and lists every bond that forms or breaks, with its atoms as MONET IDs. A change '
                      'counts only when it lasts at least the given number of analysed frames, so bonds that flicker '
                      'around the cutoff are not counted as reactions.',
          params=[Param.integer('hold', 'A change must last (analysed frames)', 3, min=1, max=1000)])
def bond_events(ctx, p):
    frames, images = _images(ctx)
    if len(images) < 2:
        raise ValueError('Bond events need at least two analysed frames.')
    cutoffs = _cutoffs(images[0], ctx.bond_scale)
    n = len(images[0])
    per_frame = []
    for f, atoms in enumerate(images):
        per_frame.append(_bond_codes(atoms, cutoffs))
        if f % 200 == 199:
            ctx.progress(f'Frame {frames[f]:,} …', 10 + 70 * (f + 1) / len(images))
    always = per_frame[0]
    ever = per_frame[0]
    for codes in per_frame[1:]:
        always = np.intersect1d(always, codes, assume_unique=True)
        ever = np.union1d(ever, codes)
    changing = np.setdiff1d(ever, always, assume_unique=True)
    states = np.array([np.isin(changing, codes, assume_unique=True) for codes in per_frame])
    states = _confirmed(states, p['hold']) if changing.size else states
    formed = np.zeros(len(frames), dtype=int)
    broken = np.zeros(len(frames), dtype=int)
    rows = []
    symbols = images[0].get_chemical_symbols()
    if changing.size:
        steps = states[1:].astype(int) - states[:-1].astype(int)
        formed[1:] = (steps > 0).sum(axis=1)
        broken[1:] = (steps < 0).sum(axis=1)
        for t, k in zip(*np.nonzero(steps)):
            if len(rows) >= MAX_EVENT_ROWS:
                break
            i, j = divmod(int(changing[k]), n)
            atoms = images[t + 1]
            distance = float(atoms.get_distance(i, j, mic=bool(atoms.pbc.any())))
            rows.append([frames[t + 1], 'formed' if steps[t, k] > 0 else 'broken', i, j,
                         f'{symbols[i]}–{symbols[j]}', round(distance, 4)])
    notes = [f'{int(formed.sum())} bonds formed and {int(broken.sum())} broken in {len(frames)} analysed frames '
             f'({len(always)} bonds never change); a change must last {p["hold"]} analysed frame(s).']
    if len(rows) >= MAX_EVENT_ROWS:
        notes.append(f'The table lists the first {MAX_EVENT_ROWS} events.')
    return series(frames, {'formed': formed, 'broken': broken}, y_label='Bonds per analysed frame', bars=True,
                  notes=notes, table={'columns': ['Frame', 'Event', 'Atom', 'Atom', 'Elements', 'Distance (Å)'],
                                      'rows': rows, 'atom_columns': [2, 3]})


# ── structure and symmetry ───────────────────────────────────────────────────

@analysis('rdf', 'ase', 'Radial distribution function, total or partial (geometry.rdf.get_rdf)',
          category=STRUCTURE, citation=ASE_CITATION,
          description='ase.geometry.rdf.get_rdf averaged over the analysed frames, with the volume of each frame. A '
                      'pair of elements gives the partial g_AB(r) (same convention as LAMMPS compute rdf). The cell must '
                      'contain a sphere of radius r_max. MONET Custom › RDF gives the same curve for groups of atoms.',
          params=[Param.number('rmax', 'r_max (Å)', 6.0, positive=True),
                  Param.integer('nbins', 'Bins', 200, min=10, max=5000),
                  Param.text('elements', 'Pair of elements (blank = total), e.g. O-H')])
def rdf(ctx, p):
    from ase.geometry.rdf import CellTooSmall, VolumeNotDefined, get_rdf
    wanted = _element_filter(p['elements'], 2, 'a partial RDF')
    frames, images = _images(ctx, need_cell=True, periodic=True)
    if wanted:
        missing = [s for s in wanted if s not in images[0].get_chemical_symbols()]
        if missing:
            raise ValueError(f'No {", ".join(sorted(set(missing)))} atoms in the trajectory.')
    ctx.progress('Computing g(r) …', 40)
    try:
        values, distances = get_rdf(images, p['rmax'], p['nbins'], elements=wanted)
    except (CellTooSmall, VolumeNotDefined) as error:
        raise ValueError(f'{error}') from None
    label = f'g(r) {"–".join(wanted)}' if wanted else 'g(r) total'
    peak = int(np.argmax(values))
    rows = [['First maximum r (Å)', round(float(distances[peak]), 4)], ['g at the maximum', round(float(values[peak]), 4)],
            ['Frames', len(frames)]]
    return profile(distances, {label: values}, 'r (Å)', 'g(r)', table={'columns': ['Quantity', 'Value'], 'rows': rows})


def _symmetry(atoms, symprec):
    from ase.spacegroup.symmetrize import check_symmetry
    data = check_symmetry(atoms, symprec)
    if data is None:
        return None, None
    get = (lambda key: data[key]) if isinstance(data, dict) else (lambda key: getattr(data, key))
    return int(get('number')), str(get('international'))


@analysis('space_group', 'ase', 'Space group along the trajectory (spacegroup.symmetrize, spglib)',
          category=STRUCTURE, requires=('spglib',), citation=ASE_CITATION,
          description='Space group of every analysed frame with ase.spacegroup.symmetrize.check_symmetry (spglib) and '
                      'the given tolerance: phase transitions in NPT runs, or the symmetry an average structure keeps. '
                      'Thermal motion lowers the symmetry of single frames; raise the tolerance to see the underlying '
                      'lattice.',
          params=[Param.number('symprec', 'Tolerance (Å)', 0.1, positive=True)])
def space_group(ctx, p):
    frames, images = _images(ctx, need_cell=True, periodic=True)
    numbers, found = [], {}
    for f, atoms in enumerate(images):
        number, symbol = _symmetry(atoms, p['symprec'])
        numbers.append(number)
        key = (number, symbol)
        entry = found.setdefault(key, [0, frames[f]])
        entry[0] += 1
        if f % 100 == 99:
            ctx.progress(f'Frame {frames[f]:,} …', 10 + 85 * (f + 1) / len(images))
    rows = [[symbol or 'not found', number or '', count, round(100 * count / len(frames), 2), first]
            for (number, symbol), (count, first) in sorted(found.items(), key=lambda item: -item[1][0])]
    return series(frames, {'Space group number': numbers}, y_label='Space group number',
                  notes=[f'Tolerance {p["symprec"]} Å; {len(found)} different group(s) in {len(frames)} frames.'],
                  table={'columns': ['Space group', 'No.', 'Frames', '%', 'First frame'], 'rows': rows})


@analysis('dimensionality', 'ase', 'Dimensionality of the bonded network (geometry.dimensionality)',
          category=STRUCTURE, citation=DIMENSIONALITY_CITATION,
          description='ase.geometry.dimensionality.analyze_dimensionality: finds whether the bonded network is made of '
                      'molecules (0D), chains (1D), layers (2D) or a 3D framework, in every analysed frame. The most '
                      'likely k-interval is kept; its components are counted by dimensionality. RDA: rank determination '
                      '(Mounet et al.); TSA: topological scaling (Ashton et al.). The bond scale k is chosen by the '
                      'method, not by the MONET bond cutoff.',
          params=[Param.choice('method', 'Method', ('RDA', 'TSA'))])
def dimensionality(ctx, p):
    from ase.geometry.dimensionality import analyze_dimensionality
    frames, images = _images(ctx, need_cell=True, periodic=True)
    counts = {f'{d}D components': [] for d in range(4)}
    found = {}
    for f, atoms in enumerate(images):
        try:
            best = analyze_dimensionality(atoms, method=p['method'], merge=True)[0]
        except TypeError:
            # ASE 3.29 returns no k-interval when bonds never join all atoms (molecules far apart in vacuum).
            raise ValueError(f'Frame {frames[f]}: ASE finds no k-interval, because the atoms never form one network '
                             'within its bond range (isolated molecules in a large cell).') from None
        for d in range(4):
            counts[f'{d}D components'].append(int(best.h[d]))
        entry = found.setdefault(best.dimtype, [0, [], frames[f], (best.a, best.b)])
        entry[0] += 1
        entry[1].append(best.score)
        if f % 50 == 49:
            ctx.progress(f'Frame {frames[f]:,} …', 10 + 85 * (f + 1) / len(images))
    rows = [[dimtype, count, round(100 * count / len(frames), 2), round(float(np.mean(scores)), 4), first,
             f'{a:.3f}–{b:.3f}'] for dimtype, (count, scores, first, (a, b)) in sorted(found.items(), key=lambda i: -i[1][0])]
    curves = {name: values for name, values in counts.items() if any(values)}
    return series(frames, curves, y_label='Components', bars=len(frames) == 1,
                  notes=[f'Method {p["method"]}; dimensionality type of the most likely k-interval in every frame.'],
                  table={'columns': ['Type', 'Frames', '%', 'Mean score', 'First frame', 'k-interval (first frame)'],
                         'rows': rows})


@analysis('layers', 'ase', 'Atomic layers along a lattice direction (geometry.get_layers)',
          category=STRUCTURE, citation=ASE_CITATION,
          description='ase.geometry.get_layers groups the atoms into planes of the given Miller indices: atoms closer '
                      'than the tolerance along the plane normal share a layer. Shows the number of layers in every '
                      'analysed frame (surface reconstruction, melting, intercalation); the table describes the layers '
                      'of the first frame.',
          params=[Param.text('miller', 'Miller indices h k l', '0 0 1'),
                  Param.number('tolerance', 'Tolerance along the normal (Å)', 0.5, positive=True),
                  Param.atoms('Atoms (blank = all)')])
def layers(ctx, p):
    from ase.geometry import get_layers
    try:
        miller = [int(v) for v in p['miller'].replace(',', ' ').split()]
    except ValueError:
        raise ValueError('“Miller indices” must be three whole numbers, e.g. 0 0 1.') from None
    if len(miller) != 3 or not any(miller):
        raise ValueError('“Miller indices” must be three whole numbers, not all zero, e.g. 0 0 1.')
    frames, images = _images(ctx, need_cell=True, periodic=True)
    chosen = p['indices'] if p['indices'] is not None else list(range(len(images[0])))
    numbers, spacings = [], []
    first = None
    for atoms in images:
        tags, levels = get_layers(atoms[chosen], miller, p['tolerance'])
        numbers.append(len(levels))
        spacings.append(float(np.mean(np.diff(levels))) if len(levels) > 1 else None)
        if first is None:
            first = (tags, levels)
    tags, levels = first
    symbols = [images[0].get_chemical_symbols()[i] for i in chosen]
    rows = []
    for layer, level in enumerate(levels):
        members = [symbols[k] for k in range(len(chosen)) if tags[k] == layer]
        rows.append([layer + 1, round(float(level), 4), len(members), _hill(dict(Counter(members)))])
    spacing = [s for s in spacings if s is not None]
    notes = [f'Miller indices ({" ".join(map(str, miller))}), tolerance {p["tolerance"]} Å, {len(chosen)} atoms.']
    if spacing:
        notes.append(f'Mean spacing between layers: {np.mean(spacing):.4f} Å.')
    return series(frames, {'Layers': numbers}, y_label='Number of layers', notes=notes,
                  table={'columns': ['Layer (first frame)', 'Position along the normal (Å)', 'Atoms', 'Composition'],
                         'rows': rows})


# ── scattering ───────────────────────────────────────────────────────────────

def _debye(ctx, p, mode):
    """Debye scattering averaged over the frames, as ase.utils.xrdebye.XrDebye (Waasmaier–Kirfel form factors,
    Iwasa polarisation, damping) but from a histogram of the interatomic distances, so large systems stay fast."""
    from ase.utils.xrdebye import XrDebye
    frames, images = _images(ctx, periodic=False)
    x = np.linspace(p['start'], p['stop'], p['points'])
    if p['stop'] <= p['start']:
        raise ValueError('The end of the range must be larger than its start.')
    wavelength = p['wavelength']
    if mode == 'XRD':
        if p['stop'] >= 180:
            raise ValueError('2θ must stay below 180°.')
        s = 2 * np.sin(np.radians(x) / 2) / wavelength
    else:
        s = x / (2 * np.pi)
    symbols = images[0].get_chemical_symbols()
    elements = sorted(set(symbols))
    groups = {e: np.array([i for i, sym in enumerate(symbols) if sym == e]) for e in elements}
    width = 0.005
    histograms = {}
    rmax = 0.0
    for f, atoms in enumerate(images):
        pos = atoms.positions
        for a_index, a in enumerate(elements):
            for b in elements[a_index:]:
                pa, pb = pos[groups[a]], pos[groups[b]]
                for start in range(0, len(pa), 512):
                    d = np.linalg.norm(pa[start:start + 512, None, :] - pb[None, :, :], axis=2).ravel()
                    d = d[d > 1e-8]
                    if not d.size:
                        continue
                    bins = np.rint(d / width).astype(np.int64)
                    counts = np.bincount(bins)
                    old = histograms.get((a, b))
                    if old is None or len(old) < len(counts):
                        grown = np.zeros(len(counts))
                        if old is not None:
                            grown[:len(old)] = old
                        old = grown
                    old[:len(counts)] += counts
                    histograms[(a, b)] = old
                    rmax = max(rmax, float(d.max()))
        if f % 20 == 19:
            ctx.progress(f'Frame {frames[f]:,} …', 10 + 80 * (f + 1) / len(images))
    reference = XrDebye(images[0], wavelength=wavelength, damping=p['damping'], warn=False)
    factors = {e: np.array([reference.get_waasmaier(e, v) for v in s], dtype=float) for e in elements}
    intensity = np.zeros_like(s)
    for e in elements:
        intensity += len(groups[e]) * factors[e] ** 2
    for (a, b), counts in histograms.items():
        r = np.arange(len(counts)) * width
        keep = counts > 0
        # counts / frames: pairs of the ordered double sum; an a–b pair (a ≠ b) appears once, so twice in the sum.
        weight = counts[keep] / len(images) * (1 if a == b else 2)
        intensity += factors[a] * factors[b] * (np.sinc(2 * s[:, None] * r[keep][None, :]) @ weight)
    pre = np.exp(-p['damping'] * s ** 2 / 2)
    sin_theta = wavelength * s / 2
    cos_theta = np.sqrt(np.clip(1 - sin_theta ** 2, 0, None))
    cos_2theta = np.cos(2 * np.arccos(cos_theta))
    pre *= cos_theta / (1 + reference.alpha * cos_2theta ** 2)
    intensity *= pre
    notes = [f'{len(frames)} analysed frames, {len(symbols)} atoms, wavelength {wavelength} Å, damping {p["damping"]} Å².',
             'Debye formula over the atoms present (no periodic images): a periodic cell scatters like a finite '
             'particle of that size, so Bragg peaks are broad.']
    if 'H' in symbols:
        notes.append('Hydrogen has zero form factor in ase.utils.xrdebye and does not scatter.')
    return frames, x, intensity, notes


XRAY_PARAMS = [Param.number('wavelength', 'Wavelength (Å)', 1.5406, positive=True),
               Param.number('damping', 'Damping (thermal factor, Å²)', 0.04, min=0),
               Param.integer('points', 'Points', 300, min=10, max=5000)]


@analysis('xrd', 'ase', 'Powder X-ray diffraction pattern (utils.xrdebye)', category=SCATTERING, citation=XRAY_CITATION,
          description='Powder XRD intensity against 2θ from the Debye formula of ase.utils.xrdebye.XrDebye '
                      '(Waasmaier–Kirfel form factors, Iwasa polarisation factor), averaged over the analysed frames. '
                      'Compares an MD ensemble with a measured pattern of a liquid, glass or nanoparticle.',
          params=[Param.number('start', '2θ from (°)', 10.0, min=0), Param.number('stop', '2θ to (°)', 90.0, positive=True)]
          + XRAY_PARAMS)
def xrd(ctx, p):
    _, x, intensity, notes = _debye(ctx, p, 'XRD')
    return profile(x, {'XRD intensity': intensity}, '2θ (°)', 'Intensity (a.u.)', notes=notes)


@analysis('saxs', 'ase', 'Small-angle X-ray scattering (utils.xrdebye)', category=SCATTERING, citation=XRAY_CITATION,
          description='SAXS intensity against q = 4π sin θ / λ from the Debye formula of ase.utils.xrdebye.XrDebye, '
                      'averaged over the analysed frames: size and shape of particles or clusters.',
          params=[Param.number('start', 'q from (Å⁻¹)', 0.01, positive=True), Param.number('stop', 'q to (Å⁻¹)', 1.0, positive=True)]
          + XRAY_PARAMS)
def saxs(ctx, p):
    _, x, intensity, notes = _debye(ctx, p, 'SAXS')
    return profile(x, {'SAXS intensity': intensity}, 'q (Å⁻¹)', 'Intensity (a.u.)', notes=notes)


# ── cell ─────────────────────────────────────────────────────────────────────

@analysis('lattice', 'ase', 'Bravais lattice and Niggli-reduced cell along the trajectory (ase.cell)',
          category=CELL, citation=ASE_CITATION,
          description='For every analysed frame: the Bravais lattice of the cell (Cell.get_bravais_lattice, with the '
                      'given tolerance) and the Niggli-reduced cell (Cell.niggli_reduce), the unique shortest '
                      'description of the lattice. Follows NPT runs where the box shears or changes shape.',
          params=[Param.choice('quantity', 'Show', ('reduced lengths', 'reduced angles')),
                  Param.number('eps', 'Tolerance for the lattice type', 2e-4, positive=True)])
def lattice(ctx, p):
    frames, images = _images(ctx, need_cell=True, periodic=True)
    reduced, found = [], {}
    for f, atoms in enumerate(images):
        cell = atoms.cell
        try:
            bravais = cell.get_bravais_lattice(eps=p['eps'], pbc=atoms.pbc)
            name = f'{bravais.name} ({bravais.longname})'
        except Exception:
            name = 'not identified'
        entry = found.setdefault(name, [0, frames[f]])
        entry[0] += 1
        reduced.append(cell.niggli_reduce(eps=1e-5)[0].cellpar() if atoms.pbc.all() else cell.cellpar())
    reduced = np.array(reduced)
    if p['quantity'] == 'reduced lengths':
        curves, unit = {'a': reduced[:, 0], 'b': reduced[:, 1], 'c': reduced[:, 2]}, 'Length (Å)'
    else:
        curves, unit = {'α': reduced[:, 3], 'β': reduced[:, 4], 'γ': reduced[:, 5]}, 'Angle (°)'
    rows = [[name, count, round(100 * count / len(frames), 2), first]
            for name, (count, first) in sorted(found.items(), key=lambda item: -item[1][0])]
    notes = [f'Mean reduced cell: a, b, c = {", ".join(f"{v:.4f}" for v in reduced[:, :3].mean(axis=0))} Å; '
             f'α, β, γ = {", ".join(f"{v:.3f}" for v in reduced[:, 3:].mean(axis=0))}°.']
    if not images[0].pbc.all():
        notes.append('The cell is not periodic in every direction: the cell is shown as it is, without Niggli reduction.')
    return series(frames, curves, y_label=unit, notes=notes,
                  table={'columns': ['Bravais lattice', 'Frames', '%', 'First frame'], 'rows': rows})


@analysis('supercell', 'ase', 'Supercell trajectory (build.make_supercell)', category=CELL, citation=ASE_CITATION,
          output={'suffix': '-supercell.extxyz', 'trajectory': True},
          description='Repeats every analysed frame na × nb × nc times along the cell vectors with '
                      'ase.build.make_supercell and writes the trajectory (extended XYZ with the new lattice), e.g. to '
                      'build a larger model for QM inputs. Copy c of atom i gets MONET ID c·N + i (N atoms per cell).',
          params=[Param.integer('na', 'Repeats along a', 2, min=1, max=20),
                  Param.integer('nb', 'Repeats along b', 2, min=1, max=20),
                  Param.integer('nc', 'Repeats along c', 1, min=1, max=20)])
def supercell(ctx, p):
    import ase.io
    from ase.build import make_supercell
    repeat = np.diag([p['na'], p['nb'], p['nc']])
    frames, images = _images(ctx, need_cell=True, periodic=True)
    count = int(round(np.linalg.det(repeat)))
    if count * len(images[0]) > 2_000_000:
        raise ValueError('The supercell would have more than 2 000 000 atoms.')
    with open(ctx.output(), 'w') as fh:
        for f, atoms in enumerate(images):
            big = make_supercell(atoms, repeat, wrap=False, order='cell-major')
            big.info = {'source_frame': frames[f], 'supercell': f'{p["na"]} {p["nb"]} {p["nc"]}'}
            ase.io.write(fh, big, format='extxyz')
            if f % 100 == 99:
                ctx.progress(f'Frame {frames[f]:,} …', 10 + 85 * (f + 1) / len(images))
    return table(['Supercell trajectory', 'Value'],
                 [['Frames', len(frames)], ['Repeats', f'{p["na"]} × {p["nb"]} × {p["nc"]}'],
                  ['Atoms per frame', count * len(images[0])]])

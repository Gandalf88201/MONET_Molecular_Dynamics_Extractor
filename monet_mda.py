"""
MDAnalysis integration (optional dependency).

MDAnalysis is used only where it adds something ASE does not provide:
- reading GROMACS XTC/TRR, CHARMM/NAMD DCD, AMBER NetCDF, GRO, PDB, PSF/TPR
  topologies and other MDAnalysis formats;
- the atom selection language, RMSF, radius of gyration and hydrogen bonds.

Geometry analyses that already exist in MONET (bonds, angles, dihedrals, RDF,
MSD ...) keep using ASE/numpy, so the two libraries never compute the same
quantity. MDAnalysis positions and cell lengths are in Å, like ASE.
"""
import warnings

import math

import numpy as np

# Deprecation/guessing notices go to stderr and are not actionable for MONET users.
warnings.filterwarnings('ignore', module=r'MDAnalysis(\..*)?$')
warnings.filterwarnings('ignore', message=r'DCDReader currently makes independent timesteps')

# format key -> (label, MDAnalysis format name or None to infer, needs a topology)
FORMATS = {
    'mda-xtc': ('GROMACS XTC (MDAnalysis)', 'XTC', True),
    'mda-trr': ('GROMACS TRR (MDAnalysis)', 'TRR', True),
    'mda-dcd': ('CHARMM/NAMD DCD (MDAnalysis)', 'DCD', True),
    'mda-netcdf': ('AMBER NetCDF (MDAnalysis)', 'NCDF', True),
    'mda-gro': ('GROMACS GRO (MDAnalysis)', 'GRO', False),
    'mda-pdb': ('PDB, multi-model (MDAnalysis)', 'PDB', False),
    'mda-lammpsdump': ('LAMMPS dump (MDAnalysis)', 'LAMMPSDUMP', False),
    'mda-auto': ('Other MDAnalysis format (by extension)', None, False),
}
EXTENSIONS = {'.xtc': 'mda-xtc', '.trr': 'mda-trr', '.nc': 'mda-netcdf', '.ncdf': 'mda-netcdf',
              '.gro': 'mda-gro', '.pdb': 'mda-pdb', '.ent': 'mda-pdb', '.lammpstrj': 'mda-lammpsdump'}


def available():
    try:
        import MDAnalysis  # noqa: F401
        return True
    except ImportError:
        return False


def version():
    try:
        import MDAnalysis
        return MDAnalysis.__version__
    except ImportError:
        return None


def _require():
    if not available():
        raise ValueError('MDAnalysis is not installed in the Python used by MONET. Run: python -m pip install MDAnalysis')
    import MDAnalysis
    return MDAnalysis


def _clean(value, fallback):
    text = str(value).strip().replace(' ', '_') if value is not None else ''
    return text or fallback


def _elements(universe):
    """Element symbols from the topology, guessing them from names/types when absent."""
    from ase.data import chemical_symbols
    atoms = universe.atoms
    try:
        elements = [str(e) for e in atoms.elements]
    except (AttributeError, Exception):
        elements = []
    if not elements or any(not e.strip() for e in elements):
        try:
            universe.guess_TopologyAttrs(to_guess=['elements'], force_guess=['elements'])
            elements = [str(e) for e in universe.atoms.elements]
        except Exception:
            elements = []
    valid = set(chemical_symbols[1:])
    out = []
    for i, element in enumerate(elements or [''] * len(atoms)):
        symbol = element.strip().capitalize()
        if symbol not in valid:
            name = ''.join(ch for ch in str(atoms[i].name) if ch.isalpha())
            symbol = name[:2].capitalize() if name[:2].capitalize() in valid else name[:1].upper()
        if symbol not in valid:
            raise ValueError(f'Cannot determine the element of atom {i + 1} ({atoms[i].name}); use a topology with element information.')
        out.append(symbol)
    return out


def _coordinate_summary(path, mda_format):
    """' (N atoms, M frames, with a periodic cell)' read from the file header, when possible."""
    try:
        from MDAnalysis.lib.formats import libdcd, libmdaxdr
        if mda_format == 'DCD':
            with libdcd.DCDFile(path) as fh:
                natoms, frames, periodic = fh.header['natoms'], fh.n_frames, bool(fh.header['is_periodic'])
        elif mda_format in ('XTC', 'TRR'):
            with (libmdaxdr.XTCFile if mda_format == 'XTC' else libmdaxdr.TRRFile)(path) as fh:
                frames = len(fh)
                first = fh.read()
                natoms, periodic = len(first.x), bool(abs(first.box).sum() > 0)
        else:
            return ''
        return f' ({natoms:,} atoms, {frames:,} frames{", with a periodic cell" if periodic else ""})'
    except Exception:
        return ''


def open_universe(path, fmt, topology=None):
    """MDAnalysis Universe, or None for a coordinate-only file given without a topology."""
    mda = _require()
    label, mda_format, needs_topology = FORMATS[fmt]
    if needs_topology and not topology:
        return None
    kwargs = {'format': mda_format} if mda_format else {}
    try:
        return mda.Universe(topology, path, **kwargs) if topology else mda.Universe(path, **kwargs)
    except Exception as error:
        raise ValueError(f'MDAnalysis could not read this file: {error}') from None


def _coordinate_reader(path, fmt):
    """Bare MDAnalysis coordinate reader: positions and box without any topology."""
    _require()
    from MDAnalysis.coordinates.core import get_reader_for
    mda_format = FORMATS[fmt][1]
    try:
        return get_reader_for(path, format=mda_format)(path)
    except Exception as error:
        raise ValueError(f'MDAnalysis could not read this file{_coordinate_summary(path, mda_format)}: {error}') from None


def _lattice(dims):
    from ase.geometry import cellpar_to_cell
    if dims is None or not np.all(np.asarray(dims[:3]) > 0):
        return None
    return cellpar_to_cell(dims)


def frames(path, fmt, topology=None):
    """Yield (symbols, positions Å, lattice or None, pbc, step, extra) for import_to_extxyz.

    Without a topology, coordinate-only formats (XTC, TRR, DCD, NetCDF) are read atom by
    atom with element X: geometry is kept, element-dependent properties are not.
    """
    universe = open_universe(path, fmt, topology)
    if universe is None:
        reader = _coordinate_reader(path, fmt)
        try:
            symbols = ['X'] * reader.n_atoms
            for ts in reader:
                yield symbols, ts.positions.astype(float), _lattice(ts.dimensions), None, int(ts.frame)
        finally:
            reader.close()
        return
    symbols = _elements(universe)
    atoms = universe.atoms
    extra = {
        'resname': [_clean(r, 'RES') for r in getattr(atoms, 'resnames', ['RES'] * len(atoms))],
        'resid': [int(r) for r in getattr(atoms, 'resids', [1] * len(atoms))],
        'atomname': [_clean(n, symbols[i]) for i, n in enumerate(getattr(atoms, 'names', symbols))],
    }
    for ts in universe.trajectory:
        yield symbols, atoms.positions.astype(float), _lattice(ts.dimensions), None, int(ts.frame), extra


# ── analyses on the active MONET trajectory ─────────────────────────────────

def bonded_pairs(symbols, positions, cell, pbc, mult=1.2):
    """Covalent bonds (i < j) and molecule labels with ASE natural cutoffs, as in the ASE molecule picker."""
    from ase import Atoms
    from ase.neighborlist import natural_cutoffs, neighbor_list
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    atoms = Atoms(symbols, positions=positions)
    if cell is not None and pbc is not None and np.any(pbc):
        atoms.set_cell(cell)
        atoms.set_pbc(pbc)
    cutoffs = [0.0 if s == 'X' else c for s, c in zip(symbols, natural_cutoffs(atoms, mult=mult))]
    i, j = neighbor_list('ij', atoms, cutoffs)
    keep = i < j
    pairs = np.unique(np.stack([i[keep], j[keep]], axis=1), axis=0) if keep.any() else np.empty((0, 2), dtype=int)
    graph = coo_matrix((np.ones(len(i)), (i, j)), shape=(len(atoms), len(atoms)))
    return pairs, connected_components(graph, directed=False)[1]


def build_universe(symbols, positions, cells=None, pbc=None, properties=None, bond_scale=1.2, ids=None):
    """MDAnalysis Universe (in memory) from MONET arrays.

    Atom i of the Universe is atom i of the MONET/ASE trajectory (index = MONET ID − 1). Residues come
    from the topology columns when present, otherwise from bonded molecules named by their formula.
    Bonds use the same covalent cutoffs as the ASE molecule selection, so fragments are identical.
    """
    mda = _require()
    from ase.data import atomic_masses, atomic_numbers
    from ase.geometry import cell_to_cellpar
    from MDAnalysis.coordinates.memory import MemoryReader
    n = len(symbols)
    properties = properties or {}
    periodic = cells is not None and pbc is not None and np.any(pbc)
    pairs, labels = bonded_pairs(symbols, positions[0], cells[0] if periodic else None, pbc if periodic else None, bond_scale)
    if 'resid' in properties:
        keys = list(zip(properties['resid'], properties.get('resname', ['RES'] * n)))
    else:
        order = {label: k for k, label in enumerate(dict.fromkeys(labels))}
        formulas = {}
        for atom, label in enumerate(labels):
            formulas.setdefault(label, []).append(symbols[atom])
        names = {}
        for label, members in formulas.items():
            counts = {sym: members.count(sym) for sym in dict.fromkeys(sorted(members, key=lambda sym: (sym != 'C', sym)))}
            names[label] = ''.join(f'{sym}{c if c > 1 else ""}' for sym, c in counts.items())[:8]
        keys = [(order[label] + 1, names[label]) for label in labels]
    residues = list(dict.fromkeys(keys))
    index = {key: k for k, key in enumerate(residues)}
    universe = mda.Universe.empty(n, n_residues=len(residues), atom_resindex=[index[key] for key in keys], trajectory=False)
    # ids are the MONET atom IDs (1-based in the original file), so `id 5` selects the same atom everywhere.
    universe.add_TopologyAttr('ids', np.arange(1, n + 1) if ids is None else np.asarray(ids, dtype=int))
    universe.add_TopologyAttr('names', properties.get('atomname', [f'{sym}{i + 1}' for i, sym in enumerate(symbols)]))
    universe.add_TopologyAttr('elements', symbols)
    universe.add_TopologyAttr('types', symbols)
    universe.add_TopologyAttr('masses', [atomic_masses[atomic_numbers[sym]] for sym in symbols])
    # XYZ files carry no charges; zeros keep charge-aware analyses (e.g. LinearDensity) usable.
    universe.add_TopologyAttr('charges', np.zeros(n))
    universe.add_TopologyAttr('resids', [key[0] for key in residues])
    universe.add_TopologyAttr('resnames', [key[1] for key in residues])
    universe.add_TopologyAttr('segids', ['SYSTEM'])
    universe.add_TopologyAttr('bonds', [tuple(map(int, pair)) for pair in pairs])
    dims = np.array([cell_to_cellpar(cell) for cell in cells]) if periodic else None
    universe.load_new(np.asarray(positions, dtype=np.float32), format=MemoryReader, dimensions=dims)
    universe.monet_molecules = labels
    return universe


def topology_table(universe):
    """Per-atom identity as MDAnalysis sees it (index, name, element, resname, resid, fragment, mass)."""
    atoms = universe.atoms
    fragment = np.empty(len(atoms), dtype=int)
    for k, frag in enumerate(universe.atoms.fragments):
        fragment[frag.indices] = k
    return {
        'index': atoms.indices.tolist(), 'id': [int(v) for v in atoms.ids], 'name': [str(v) for v in atoms.names],
        'element': [str(v) for v in atoms.elements], 'resname': [str(v) for v in atoms.resnames],
        'resid': [int(v) for v in atoms.resids], 'fragment': fragment.tolist(),
        'mass': [round(float(v), 4) for v in atoms.masses],
        'n_bonds': len(universe.bonds), 'n_residues': len(universe.residues), 'n_fragments': len(universe.atoms.fragments),
    }


def select(universe, selection):
    try:
        group = universe.select_atoms(selection)
    except Exception as error:
        raise ValueError(f'Invalid MDAnalysis selection: {error}') from None
    return group


def rmsf(universe, selection, align=True):
    from MDAnalysis.analysis import align as mda_align, rms
    group = select(universe, selection)
    if not len(group):
        raise ValueError('The selection is empty.')
    if align:
        if len(group) < 3:
            raise ValueError('Alignment needs at least three atoms; disable alignment.')
        mda_align.AlignTraj(universe, universe, select=selection, in_memory=True).run()
        group = select(universe, selection)
    result = rms.RMSF(group).run()
    return group.indices.tolist(), result.results.rmsf.tolist()


def radius_of_gyration(universe, selection):
    group = select(universe, selection)
    if not len(group):
        raise ValueError('The selection is empty.')
    values = []
    for _ in universe.trajectory:
        # Unwrap molecules split by the boundary when a cell is known.
        values.append(float(group.radius_of_gyration(wrap=False, unwrap=False)))
    return values


def hydrogen_bonds(universe, donors, hydrogens, acceptors, d_a_cutoff=3.0, angle=150.0, d_h_cutoff=1.2):
    from MDAnalysis.analysis.hydrogenbonds import HydrogenBondAnalysis
    for label, text in (('donor', donors), ('hydrogen', hydrogens), ('acceptor', acceptors)):
        if not len(select(universe, text)):
            raise ValueError(f'The {label} selection is empty.')
    analysis = HydrogenBondAnalysis(universe, donors_sel=donors, hydrogens_sel=hydrogens, acceptors_sel=acceptors,
                                    d_a_cutoff=d_a_cutoff, d_h_a_angle_cutoff=angle, d_h_cutoff=d_h_cutoff)
    analysis.run()
    counts = analysis.count_by_time().tolist()
    pairs = []
    index_of = {int(i): k for k, i in enumerate(universe.atoms.ids)}
    for donor, hydrogen, acceptor, count in analysis.count_by_ids()[:10].tolist():
        # count_by_ids reports atom ids (MONET IDs); results use 0-based trajectory indices.
        pairs.append({'donor': index_of[int(donor)], 'hydrogen': index_of[int(hydrogen)], 'acceptor': index_of[int(acceptor)],
                      'fraction': count / max(len(counts), 1)})
    return counts, pairs


# ── generic analysis dispatcher ─────────────────────────────────────────────
# Every analysis returns a dict for the renderer:
#   kind 'series' | 'profile'; x, xLabel, yLabel, series [{label, data}], notes, optional table {columns, rows}.

def _group(universe, text, label, minimum=1):
    group = select(universe, text or 'all')
    if len(group) < minimum:
        raise ValueError(f'The {label} selection "{text}" contains {len(group)} atoms; at least {minimum} are needed.')
    return group


def _need_cell(universe, what):
    dims = universe.trajectory.ts.dimensions
    if dims is None or not np.all(np.asarray(dims[:3]) > 0):
        raise ValueError(f'{what} needs a periodic cell: apply or load one in "Crystal cell".')


def _frames_series(frames, xlabel='Frame'):
    return {'x': list(frames), 'xLabel': xlabel}


def run_analysis(universe, name, params, frames, dt=None, output=None):
    """Run one MDAnalysis analysis on the in-memory Universe; `frames` are the MONET frame indices."""
    p = params or {}
    sel = p.get('selection') or 'all'
    if name == 'rmsd':
        from MDAnalysis.analysis import rms
        group = _group(universe, sel, 'fit', 3)
        extra = [g for g in (p.get('groups') or []) if g.strip()]
        for g in extra:
            _group(universe, g, 'RMSD group')
        result = rms.RMSD(universe, universe, select=sel, groupselections=extra or None, ref_frame=0).run()
        data = result.results.rmsd
        series = [{'label': f'RMSD of "{sel}" (fit on it)', 'data': data[:, 2].tolist()}]
        series += [{'label': f'RMSD of "{g}" after fitting "{sel}"', 'data': data[:, 3 + k].tolist()} for k, g in enumerate(extra)]
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'RMSD (Å)', 'series': series,
                'notes': [f'{len(group)} atoms, reference = first analysed frame (MDAnalysis rms.RMSD, optimal superposition).']}
    if name == 'rmsd_matrix':
        from functools import partial
        from MDAnalysis.analysis import diffusionmap, rms
        group = _group(universe, sel, 'pairwise RMSD')
        total = universe.trajectory.n_frames
        limit = int(p.get('max_frames') or 500)
        if not 2 <= limit <= 3000:
            raise ValueError('The maximum number of frames must be between 2 and 3000.')
        stride = max(1, math.ceil(total / limit))
        superpose = bool(p.get('superposition', True)) and len(group) >= 3
        metric = partial(rms.rmsd, center=superpose, superposition=superpose)
        analysis = diffusionmap.DistanceMatrix(universe, select=sel, metric=metric).run(step=stride)
        matrix = np.asarray(analysis.results.dist_matrix, dtype=float)
        picked = list(frames)[::stride]
        upper = matrix[np.triu_indices(len(matrix), 1)]
        notes = [f'{len(group)} atoms of "{sel}", {len(picked)} frames' + (f' (every {stride}th analysed frame)' if stride > 1 else '') +
                 (', optimal superposition of every pair (MDAnalysis DistanceMatrix + rms.rmsd)' if superpose else ', no superposition')]
        if len(upper):
            notes.append(f'Off-diagonal RMSD: mean {upper.mean():.4f} ± {upper.std():.4f} Å, max {upper.max():.4f} Å')
        return {'kind': 'matrix', 'matrix': np.round(matrix, 5).tolist(), 'labels': picked, 'xLabel': 'Frame', 'yLabel': 'Frame',
                'colorLabel': 'RMSD (Å)', 'stride': stride, 'notes': notes,
                'table': {'columns': ['Quantity', 'Value (Å)'], 'rows': [['Mean off-diagonal RMSD', round(float(upper.mean()), 5)],
                          ['SD', round(float(upper.std()), 5)], ['Maximum', round(float(upper.max()), 5)]]} if len(upper) else None}
    if name == 'rmsf':
        indices, values = rmsf(universe, sel, bool(p.get('align', True)))
        return {'kind': 'profile', 'x': [int(universe.atoms[i].id) for i in indices], 'xLabel': 'MONET atom ID', 'yLabel': 'RMSF (Å)',
                'series': [{'label': f'RMSF of "{sel}"', 'data': values}], 'atoms': indices, 'bars': True,
                'notes': ['Aligned on the selection (first frame) before RMSF.' if p.get('align', True) else 'No alignment.']}
    if name == 'rgyr':
        values = radius_of_gyration(universe, sel)
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'Radius of gyration (Å)',
                'series': [{'label': f'Rg of "{sel}" (mass-weighted)', 'data': values}]}
    if name == 'hbonds':
        counts, pairs = hydrogen_bonds(universe, p.get('donors') or 'element O N F', p.get('hydrogens') or 'element H',
                                       p.get('acceptors') or 'element O N F', p.get('d_a_cutoff', 3.0), p.get('angle', 150.0))
        rows = [[pair['donor'], pair['hydrogen'], pair['acceptor'], round(100 * pair['fraction'], 1)] for pair in pairs]
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'Hydrogen bonds',
                'series': [{'label': 'H-bond count', 'data': counts}], 'pairs': pairs,
                'table': {'columns': ['Donor', 'Hydrogen', 'Acceptor', 'Occupancy (%)'], 'rows': rows, 'atom_columns': [0, 1, 2]}}
    if name == 'contacts':
        from MDAnalysis.analysis import contacts
        a = _group(universe, p.get('group_a') or sel, 'first contact group')
        b = _group(universe, p.get('group_b') or 'all', 'second contact group')
        universe.trajectory[0]
        method = p.get('method') or 'hard_cut'
        radius = float(p.get('radius', 4.5))
        analysis = contacts.Contacts(universe, select=(p.get('group_a') or sel, p.get('group_b') or 'all'),
                                     refgroup=(a, b), method=method, radius=radius).run()
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'Fraction of native contacts Q',
                'series': [{'label': f'Q ({method}, r = {radius} Å)', 'data': analysis.results.timeseries[:, 1].tolist()}],
                'notes': [f'Native contacts = pairs closer than {radius} Å in the first analysed frame.']}
    if name == 'interrdf':
        from MDAnalysis.analysis import rdf
        _need_cell(universe, 'The radial distribution function')
        a = _group(universe, p.get('group_a') or sel, 'first RDF group')
        b = _group(universe, p.get('group_b') or sel, 'second RDF group')
        rmax = float(p.get('rmax', 10.0))
        block = p.get('exclude_same')
        kwargs = {'exclusion_block': (1, 1)} if block == 'atom' else {}
        if block == 'residue':
            sizes_a = {len(r.atoms) for r in a.residues}
            sizes_b = {len(r.atoms) for r in b.residues}
            if len(sizes_a) == 1 and len(sizes_b) == 1:
                kwargs = {'exclusion_block': (sizes_a.pop(), sizes_b.pop())}
        analysis = rdf.InterRDF(a, b, nbins=int(p.get('nbins', 150)), range=(0.0, rmax), **kwargs).run()
        return {'kind': 'profile', 'x': analysis.results.bins.tolist(), 'xLabel': 'r (Å)', 'yLabel': 'g(r)',
                'series': [{'label': f'g(r) {p.get("group_a") or sel} – {p.get("group_b") or sel}', 'data': analysis.results.rdf.tolist()}],
                'notes': [f'MDAnalysis InterRDF, minimum image, {len(a)} × {len(b)} atoms' + (f', exclusion block {kwargs["exclusion_block"]}' if kwargs else '')]}
    if name == 'msd':
        from MDAnalysis.analysis import msd
        _group(universe, sel, 'MSD')
        analysis = msd.EinsteinMSD(universe, select=sel, msd_type=p.get('msd_type') or 'xyz', fft=False).run()
        series = analysis.results.timeseries.tolist()
        step = dt if dt else 1.0
        return {'kind': 'profile', 'x': [k * step for k in range(len(series))], 'xLabel': 'Lag time (fs)' if dt else 'Lag (analysed frames)',
                'yLabel': 'MSD (Å²)', 'series': [{'label': f'MSD {p.get("msd_type") or "xyz"} of "{sel}"', 'data': series}],
                'notes': ['MDAnalysis EinsteinMSD (windowed, no FFT). Use an unwrapped trajectory for periodic runs.']}
    if name == 'lineardensity':
        from MDAnalysis.analysis import lineardensity
        _need_cell(universe, 'Linear density')
        group = _group(universe, sel, 'density')
        analysis = lineardensity.LinearDensity(group, grouping=p.get('grouping') or 'atoms', binsize=float(p.get('binsize', 0.25))).run()
        out = analysis.results
        series, x = [], None
        for axis in (p.get('axes') or 'xyz'):
            dim = out[axis]
            edges = np.asarray(dim['hist_bin_edges'])
            centres = ((edges[:-1] + edges[1:]) / 2).tolist()
            x = x or centres
            series.append({'label': f'mass density along {axis}', 'data': np.asarray(dim['mass_density']).tolist()[:len(x)]})
        return {'kind': 'profile', 'x': x, 'xLabel': 'Position along the axis (Å)', 'yLabel': 'Mass density (g cm⁻³)',
                'series': series, 'notes': ['MDAnalysis LinearDensity averaged over the analysed frames; charge density is not shown (XYZ files carry no charges).']}
    if name == 'pca':
        from MDAnalysis.analysis import pca
        group = _group(universe, sel, 'PCA', 2)
        # With align=True, PCA.run() superimposes every frame of the in-memory trajectory in place,
        # so transform() below projects the aligned coordinates (it does no fitting of its own).
        analysis = pca.PCA(universe, select=sel, align=bool(p.get('align', True))).run()
        # Eigen-decomposition may return a zero imaginary part.
        variance = np.real(np.asarray(analysis.results.variance))
        cumulated = np.real(np.asarray(analysis.results.cumulated_variance)).tolist()
        # Up to 10 projections are returned so that the plotted components can be changed without
        # computing again; `shown` is how many are plotted at first.
        count = min(10, len(cumulated))
        shown = max(1, min(count, int(p.get('n_components', 3))))
        projection = np.real(analysis.transform(group, n_components=count))
        take = int(np.searchsorted(np.asarray(cumulated), 0.9)) + 1
        ratio = variance / variance.sum()
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'Projection (Å)',
                'series': [{'label': f'PC{k + 1} ({100 * ratio[k]:.1f} %)', 'data': projection[:, k].tolist()} for k in range(count)],
                'pca': {'components': count, 'shown': shown, 'variance_ratio': [float(v) for v in ratio[:count]]},
                'notes': [f'{take} components explain 90 % of the variance; cumulated variance of PC1–PC{count}: ' +
                          ', '.join(f'{100 * v:.1f} %' for v in cumulated[:count])],
                'table': {'columns': ['Component', 'Variance (Å²)', 'Cumulated (%)'],
                          'rows': [[k + 1, round(float(variance[k]), 5), round(100 * cumulated[k], 2)] for k in range(count)]}}
    if name in ('com_distance', 'min_distance'):
        from MDAnalysis.lib.distances import distance_array, minimize_vectors
        a = _group(universe, p.get('group_a') or sel, 'first group')
        b = _group(universe, p.get('group_b') or 'all', 'second group')
        values = []
        for ts in universe.trajectory:
            box = ts.dimensions if ts.dimensions is not None and np.all(ts.dimensions[:3] > 0) else None
            if name == 'com_distance':
                vector = b.center_of_mass() - a.center_of_mass()
                if box is not None:
                    vector = minimize_vectors(vector[None, :], box)[0]
                values.append(float(np.linalg.norm(vector)))
            else:
                values.append(float(distance_array(a.positions, b.positions, box=box).min()))
        label = 'centre-of-mass distance' if name == 'com_distance' else 'minimum distance'
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'Distance (Å)',
                'series': [{'label': f'{label}: "{p.get("group_a") or sel}" – "{p.get("group_b") or "all"}"', 'data': values}]}
    if name == 'atomic_distances':
        from MDAnalysis.analysis import atomicdistances
        a = _group(universe, p.get('group_a') or sel, 'first group')
        b = _group(universe, p.get('group_b') or 'all', 'second group')
        if len(a) != len(b):
            raise ValueError(f'Both groups need the same number of atoms (they have {len(a)} and {len(b)}); atom k of the first is paired with atom k of the second.')
        box = universe.trajectory.ts.dimensions
        analysis = atomicdistances.AtomicDistances(a, b, pbc=box is not None and bool(np.all(box[:3] > 0))).run()
        data = analysis.results
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'Distance (Å)',
                'series': [{'label': f'{int(a[k].id)}–{int(b[k].id)}', 'data': data[:, k].tolist()} for k in range(min(12, len(a)))],
                'notes': [f'{len(a)} atom pairs' + (' (first 12 shown)' if len(a) > 12 else '')]}
    if name == 'dihedral_mda':
        from MDAnalysis.analysis.dihedrals import Dihedral
        quads = p.get('quads') or []
        if not quads:
            raise ValueError('Enter at least one group of four MONET IDs.')
        if any(int(i) >= len(universe.atoms) for quad in quads for i in quad):
            raise ValueError(f'Atom IDs must be between 1 and {len(universe.atoms)}.')
        groups = [universe.atoms[[int(i) for i in quad]] for quad in quads]
        analysis = Dihedral(groups).run()
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'Dihedral (°, −180 to 180)',
                'series': [{'label': '-'.join(str(int(universe.atoms[int(i)].id)) for i in quad), 'data': analysis.results.angles[:, k].tolist()} for k, quad in enumerate(quads)],
                'notes': ['MDAnalysis Dihedral (IUPAC sign convention, −180…180°).']}
    if name == 'ramachandran':
        from MDAnalysis.analysis.dihedrals import Ramachandran
        group = _group(universe, sel if sel != 'all' else 'protein', 'protein')
        try:
            analysis = Ramachandran(group.residues.atoms).run()
        except Exception as error:
            raise ValueError(f'Ramachandran needs protein backbone atoms (N, CA, C with standard names): {error}') from None
        angles = analysis.results.angles
        residues = [r for r in group.residues][1:-1][:angles.shape[1]]
        series = []
        for k in range(min(4, angles.shape[1])):
            label = f'{residues[k].resname}{residues[k].resid}' if k < len(residues) else f'residue {k + 1}'
            series += [{'label': f'φ {label}', 'data': angles[:, k, 0].tolist()}, {'label': f'ψ {label}', 'data': angles[:, k, 1].tolist()}]
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'Angle (°)', 'series': series,
                'notes': [f'{angles.shape[1]} residues; the first 4 are plotted.']}
    if name == 'dssp':
        from MDAnalysis.analysis.dssp import DSSP
        try:
            analysis = DSSP(universe).run()
        except Exception as error:
            raise ValueError(f'DSSP needs a protein with backbone atoms N, CA, C, O: {error}') from None
        codes = np.asarray(analysis.results.dssp)
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'Fraction of residues',
                'series': [{'label': label, 'data': (codes == code).mean(axis=1).tolist()} for code, label in (('H', 'helix'), ('E', 'strand'), ('-', 'loop'))],
                'notes': [f'{codes.shape[1]} residues (MDAnalysis DSSP).']}
    if name == 'gnm':
        from MDAnalysis.analysis import gnm
        _group(universe, sel, 'GNM', 3)
        analysis = gnm.GNMAnalysis(universe, select=sel, cutoff=float(p.get('cutoff', 7.0))).run()
        return {'kind': 'series', **_frames_series(frames), 'yLabel': 'Lowest non-zero eigenvalue',
                'series': [{'label': f'GNM of "{sel}"', 'data': np.asarray(analysis.results.eigenvalues, dtype=float).tolist()}],
                'notes': ['Gaussian network model (Kirchhoff matrix, cutoff %.1f Å).' % float(p.get('cutoff', 7.0))]}
    if name == 'diffusionmap':
        from MDAnalysis.analysis import diffusionmap, rms
        _group(universe, sel, 'diffusion map', 3)
        if universe.trajectory.n_frames > 1500:
            raise ValueError('The diffusion map compares all frame pairs: use a frame step so that at most 1500 frames are analysed.')
        analysis = diffusionmap.DiffusionMap(universe, select=sel, epsilon=float(p.get('epsilon', 1.0)))
        analysis.run()
        values = np.asarray(analysis.eigenvalues, dtype=float)[:20]
        return {'kind': 'profile', 'x': list(range(1, len(values) + 1)), 'xLabel': 'Eigenvector', 'yLabel': 'Eigenvalue',
                'series': [{'label': f'diffusion map of "{sel}" (ε = {p.get("epsilon", 1.0)})', 'data': values.tolist()}], 'bars': True}
    if name == 'density':
        from MDAnalysis.analysis import density
        group = _group(universe, sel, 'density')
        if not output:
            raise ValueError('No output file for the density grid.')
        analysis = density.DensityAnalysis(group, delta=float(p.get('delta', 1.0))).run()
        grid = analysis.results.density
        grid.export(output, type='double')
        values = np.asarray(grid.grid)
        return {'kind': 'table', 'download': True,
                'table': {'columns': ['Quantity', 'Value'],
                          'rows': [['Grid points', ' × '.join(map(str, values.shape))], ['Spacing (Å)', p.get('delta', 1.0)],
                                   ['Maximum density (Å⁻³)', round(float(values.max()), 6)], ['Mean density (Å⁻³)', round(float(values.mean()), 6)]]},
                'notes': ['OpenDX grid (VMD, PyMOL, Chimera); the selection is averaged over the analysed frames.']}
    raise ValueError(f'Unknown MDAnalysis analysis: {name}')


def aligned_positions(universe, selection):
    """All positions after optimal superposition of `selection` on the first frame."""
    from MDAnalysis.analysis import align
    _group(universe, selection, 'alignment', 3)
    align.AlignTraj(universe, universe, select=selection, in_memory=True).run()
    return np.array([universe.atoms.positions.copy() for _ in universe.trajectory])

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


# ── helpers of the MDAnalysis analyses (monet_analyses/mdanalysis.py) ─────────

def _group(universe, text, label, minimum=1):
    group = select(universe, text or 'all')
    if len(group) < minimum:
        raise ValueError(f'The {label} selection "{text}" contains {len(group)} atoms; at least {minimum} are needed.')
    return group


def _need_cell(universe, what):
    dims = universe.trajectory.ts.dimensions
    if dims is None or not np.all(np.asarray(dims[:3]) > 0):
        raise ValueError(f'{what} needs a periodic cell: apply or load one in "Crystal cell".')


def aligned_positions(universe, selection):
    """All positions after optimal superposition of `selection` on the first frame."""
    from MDAnalysis.analysis import align
    _group(universe, selection, 'alignment', 3)
    align.AlignTraj(universe, universe, select=selection, in_memory=True).run()
    return np.array([universe.atoms.positions.copy() for _ in universe.trajectory])

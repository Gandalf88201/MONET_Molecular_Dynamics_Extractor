"""MDAnalysis analyses of the MDAnalysis tab, on the active MONET trajectory.

Every function receives the context (ctx.universe() is an in-memory Universe whose atom ids are
the MONET IDs) and the checked parameters, and returns a result for the generic plots.
"""
from functools import partial
import math

import numpy as np

import monet_mda
from monet_mda import _group, _need_cell
from monet_registry import Param, analysis

STRUCTURE = 'Structure and dynamics'
INTERACTIONS = 'Interactions and distances'
DENSITIES = 'Densities'
PROTEINS = 'Proteins'


def _frames(frames, xlabel='Frame'):
    return {'x': list(frames), 'xLabel': xlabel}


@analysis('rmsd', 'mdanalysis', 'RMSD after optimal superposition (rms.RMSD)', category=STRUCTURE,
          description='rms.RMSD: RMSD of the fit selection after optimal superposition on the first analysed frame; '
                      'extra groups are measured after the same fit.',
          params=[Param.selection('selection', 'Fit selection'), Param.lines('groups', 'Extra groups (one selection per line)')])
def rmsd(ctx, p):
    from MDAnalysis.analysis import rms
    frames, universe = ctx.universe()
    sel = p['selection']
    group = _group(universe, sel, 'fit', 3)
    extra = p['groups']
    for g in extra:
        _group(universe, g, 'RMSD group')
    result = rms.RMSD(universe, universe, select=sel, groupselections=extra or None, ref_frame=0).run()
    data = result.results.rmsd
    series = [{'label': f'RMSD of "{sel}" (fit on it)', 'data': data[:, 2].tolist()}]
    series += [{'label': f'RMSD of "{g}" after fitting "{sel}"', 'data': data[:, 3 + k].tolist()} for k, g in enumerate(extra)]
    return {'kind': 'series', **_frames(frames), 'yLabel': 'RMSD (Å)', 'series': series,
            'notes': [f'{len(group)} atoms, reference = first analysed frame (MDAnalysis rms.RMSD, optimal superposition).']}


@analysis('rmsd_matrix', 'mdanalysis', 'Pairwise RMSD matrix (diffusionmap.DistanceMatrix)', category=STRUCTURE,
          description='diffusionmap.DistanceMatrix: RMSD between every pair of analysed frames, after optimal superposition '
                      'of each pair (rms.rmsd). Use the frame step or the uncorrelated trajectory to compare independent '
                      'configurations; long runs are thinned to the maximum number of frames.',
          params=[Param.selection('selection', 'Selection'),
                  Param.bool('superposition', 'Superimpose each pair (remove rotation and translation)', True),
                  Param.integer('max_frames', 'Maximum frames', 500, min=2, max=3000)])
def rmsd_matrix(ctx, p):
    from MDAnalysis.analysis import diffusionmap, rms
    frames, universe = ctx.universe()
    sel = p['selection']
    group = _group(universe, sel, 'pairwise RMSD')
    total = universe.trajectory.n_frames
    stride = max(1, math.ceil(total / p['max_frames']))
    superpose = p['superposition'] and len(group) >= 3
    metric = partial(rms.rmsd, center=superpose, superposition=superpose)
    result = diffusionmap.DistanceMatrix(universe, select=sel, metric=metric).run(step=stride)
    values = np.asarray(result.results.dist_matrix, dtype=float)
    picked = list(frames)[::stride]
    upper = values[np.triu_indices(len(values), 1)]
    notes = [f'{len(group)} atoms of "{sel}", {len(picked)} frames' + (f' (every {stride}th analysed frame)' if stride > 1 else '') +
             (', optimal superposition of every pair (MDAnalysis DistanceMatrix + rms.rmsd)' if superpose else ', no superposition')]
    if len(upper):
        notes.append(f'Off-diagonal RMSD: mean {upper.mean():.4f} ± {upper.std():.4f} Å, max {upper.max():.4f} Å')
    return {'kind': 'matrix', 'matrix': np.round(values, 5).tolist(), 'labels': picked, 'xLabel': 'Frame', 'yLabel': 'Frame',
            'colorLabel': 'RMSD (Å)', 'stride': stride, 'notes': notes,
            'table': {'columns': ['Quantity', 'Value (Å)'], 'rows': [['Mean off-diagonal RMSD', round(float(upper.mean()), 5)],
                      ['SD', round(float(upper.std()), 5)], ['Maximum', round(float(upper.max()), 5)]]} if len(upper) else None}


@analysis('rmsf', 'mdanalysis', 'RMSF per atom (rms.RMSF)', category=STRUCTURE,
          description='rms.RMSF: fluctuation of every selected atom around its average position.',
          params=[Param.selection('selection', 'Selection'), Param.bool('align', 'Align on the selection first', True)])
def rmsf(ctx, p):
    _, universe = ctx.universe()
    indices, values = monet_mda.rmsf(universe, p['selection'], p['align'])
    return {'kind': 'profile', 'x': [int(universe.atoms[i].id) for i in indices], 'xLabel': 'MONET atom ID', 'yLabel': 'RMSF (Å)',
            'series': [{'label': f'RMSF of "{p["selection"]}"', 'data': values}], 'atoms': indices, 'bars': True,
            'notes': ['Aligned on the selection (first frame) before RMSF.' if p['align'] else 'No alignment.']}


@analysis('rgyr', 'mdanalysis', 'Radius of gyration', category=STRUCTURE,
          description='Mass-weighted radius of gyration of the selection in every frame.',
          params=[Param.selection('selection', 'Selection')])
def rgyr(ctx, p):
    frames, universe = ctx.universe()
    values = monet_mda.radius_of_gyration(universe, p['selection'])
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Radius of gyration (Å)',
            'series': [{'label': f'Rg of "{p["selection"]}" (mass-weighted)', 'data': values}]}


@analysis('pca', 'mdanalysis', 'Principal component analysis (pca.PCA)', category=STRUCTURE,
          description='pca.PCA: principal components of the selected coordinates; projections of up to 10 components along '
                      'the trajectory (tick them in the list), their distribution, and the configurations picked on them, '
                      'written as a trajectory for the extraction.',
          params=[Param.selection('selection', 'Selection'), Param.bool('align', 'Align on the selection first', True),
                  Param.integer('n_components', 'Components plotted at first (1–10)', 3, min=1, max=10)])
def pca(ctx, p):
    from MDAnalysis.analysis import pca as mda_pca
    frames, universe = ctx.universe()
    group = _group(universe, p['selection'], 'PCA', 2)
    # With align=True, PCA.run() superimposes every frame of the in-memory trajectory in place,
    # so transform() below projects the aligned coordinates (it does no fitting of its own).
    result = mda_pca.PCA(universe, select=p['selection'], align=p['align']).run()
    # Eigen-decomposition may return a zero imaginary part.
    variance = np.real(np.asarray(result.results.variance))
    cumulated = np.real(np.asarray(result.results.cumulated_variance)).tolist()
    # Up to 10 projections are returned so that the plotted components can be changed without
    # computing again; `shown` is how many are plotted at first.
    count = min(10, len(cumulated))
    shown = max(1, min(count, p['n_components']))
    projection = np.real(result.transform(group, n_components=count))
    take = int(np.searchsorted(np.asarray(cumulated), 0.9)) + 1
    ratio = variance / variance.sum()
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Projection (Å)',
            'series': [{'label': f'PC{k + 1} ({100 * ratio[k]:.1f} %)', 'data': projection[:, k].tolist()} for k in range(count)],
            'pca': {'components': count, 'shown': shown, 'variance_ratio': [float(v) for v in ratio[:count]]},
            'notes': [f'{take} components explain 90 % of the variance; cumulated variance of PC1–PC{count}: ' +
                      ', '.join(f'{100 * v:.1f} %' for v in cumulated[:count])],
            'table': {'columns': ['Component', 'Variance (Å²)', 'Cumulated (%)'],
                      'rows': [[k + 1, round(float(variance[k]), 5), round(100 * cumulated[k], 2)] for k in range(count)]}}


@analysis('msd', 'mdanalysis', 'Mean-squared displacement (msd.EinsteinMSD)', category=STRUCTURE,
          description='msd.EinsteinMSD: windowed mean-squared displacement (set the time axis for a lag in fs). '
                      'Use an unwrapped trajectory for periodic runs.',
          params=[Param.selection('selection', 'Selection'),
                  Param.choice('msd_type', 'Dimensions', ['xyz', 'xy', 'yz', 'xz', 'x', 'y', 'z'])])
def msd(ctx, p):
    from MDAnalysis.analysis import msd as mda_msd
    _, universe = ctx.universe()
    _group(universe, p['selection'], 'MSD')
    result = mda_msd.EinsteinMSD(universe, select=p['selection'], msd_type=p['msd_type'], fft=False).run()
    values = result.results.timeseries.tolist()
    step = ctx.dt or 1.0
    return {'kind': 'profile', 'x': [k * step for k in range(len(values))], 'xLabel': 'Lag time (fs)' if ctx.dt else 'Lag (analysed frames)',
            'yLabel': 'MSD (Å²)', 'series': [{'label': f'MSD {p["msd_type"]} of "{p["selection"]}"', 'data': values}],
            'notes': ['MDAnalysis EinsteinMSD (windowed, no FFT). Use an unwrapped trajectory for periodic runs.']}


@analysis('gnm', 'mdanalysis', 'Gaussian network model (gnm.GNMAnalysis)', category=STRUCTURE,
          description='gnm.GNMAnalysis: lowest non-zero eigenvalue of the Kirchhoff matrix in every frame.',
          params=[Param.selection('selection', 'Selection'), Param.number('cutoff', 'Cutoff (Å)', 7, positive=True)])
def gnm(ctx, p):
    from MDAnalysis.analysis import gnm as mda_gnm
    frames, universe = ctx.universe()
    _group(universe, p['selection'], 'GNM', 3)
    result = mda_gnm.GNMAnalysis(universe, select=p['selection'], cutoff=float(p['cutoff'])).run()
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Lowest non-zero eigenvalue',
            'series': [{'label': f'GNM of "{p["selection"]}"', 'data': np.asarray(result.results.eigenvalues, dtype=float).tolist()}],
            'notes': ['Gaussian network model (Kirchhoff matrix, cutoff %.1f Å).' % float(p['cutoff'])]}


@analysis('diffusionmap', 'mdanalysis', 'Diffusion map (diffusionmap.DiffusionMap)', category=STRUCTURE,
          description='diffusionmap.DiffusionMap: eigenvalues of the frame-to-frame RMSD diffusion kernel (at most 1500 frames).',
          params=[Param.selection('selection', 'Selection'), Param.number('epsilon', 'Kernel width ε (Å²)', 1, positive=True)])
def diffusionmap(ctx, p):
    from MDAnalysis.analysis import diffusionmap as mda_diffusionmap
    _, universe = ctx.universe()
    _group(universe, p['selection'], 'diffusion map', 3)
    if universe.trajectory.n_frames > 1500:
        raise ValueError('The diffusion map compares all frame pairs: use a frame step so that at most 1500 frames are analysed.')
    result = mda_diffusionmap.DiffusionMap(universe, select=p['selection'], epsilon=float(p['epsilon']))
    result.run()
    values = np.asarray(result.eigenvalues, dtype=float)[:20]
    return {'kind': 'profile', 'x': list(range(1, len(values) + 1)), 'xLabel': 'Eigenvector', 'yLabel': 'Eigenvalue',
            'series': [{'label': f'diffusion map of "{p["selection"]}" (ε = {p["epsilon"]})', 'data': values.tolist()}], 'bars': True}


@analysis('align', 'mdanalysis', 'Align the trajectory and download it (align.AlignTraj)', category=STRUCTURE,
          description='align.AlignTraj: superimpose every frame on the first one and write the aligned trajectory '
                      '(same atoms, same MONET IDs).',
          params=[Param.selection('selection', 'Fit selection')], output={'suffix': '-aligned.extxyz', 'trajectory': True})
def align(ctx, p):
    frames, universe = ctx.universe()
    selection = p['selection']
    ctx.progress('Aligning …', 50)
    positions = monet_mda.aligned_positions(universe, selection)
    symbols = [str(e) for e in universe.atoms.elements]
    # Topology columns of the source (atom names, residues) are kept so selections still work.
    properties = ctx.atom_properties()
    extra = [(name, kind) for name, kind in (('resname', 'S'), ('resid', 'I'), ('atomname', 'S')) if name in properties]
    columns = 'species:S:1:pos:R:3' + ''.join(f':{name}:{kind}:1' for name, kind in extra)
    suffixes = [''.join(f' {properties[name][i]}' for name, _ in extra) for i in range(len(symbols))]
    # The selection is stored without double quotes, which would end the extended-XYZ value.
    label = selection.replace('"', "'")
    with open(ctx.output(), 'w') as fh:
        for k, frame in enumerate(frames):
            fh.write(f'{len(symbols)}\nProperties={columns} frame={frame} source_frame={frame} aligned_on="{label}"\n')
            fh.write(''.join(f'{s} {x:.8f} {y:.8f} {z:.8f}{tail}\n'
                             for s, (x, y, z), tail in zip(symbols, (positions[k] + 0.0).tolist(), suffixes)))
    return {'kind': 'table', 'table': {'columns': ['Aligned trajectory', 'Value'],
                                       'rows': [['Frames', len(frames)], ['Fit selection', selection]]},
            'selection': selection}


@analysis('hbonds', 'mdanalysis', 'Hydrogen bonds (HydrogenBondAnalysis)', category=INTERACTIONS,
          description='HydrogenBondAnalysis: donor–hydrogen···acceptor triplets by distance and angle; count per frame and '
                      'occupancy table (MONET IDs).',
          params=[Param.selection('donors', 'Donors', 'element O N F'), Param.selection('hydrogens', 'Hydrogens', 'element H'),
                  Param.selection('acceptors', 'Acceptors', 'element O N F'),
                  Param.number('d_a_cutoff', 'D–A cutoff (Å)', 3, min=1, max=6),
                  Param.number('angle', 'D–H–A minimum angle (°)', 150, min=90, max=180)])
def hbonds(ctx, p):
    frames, universe = ctx.universe()
    counts, pairs = monet_mda.hydrogen_bonds(universe, p['donors'], p['hydrogens'], p['acceptors'], p['d_a_cutoff'], p['angle'])
    rows = [[pair['donor'], pair['hydrogen'], pair['acceptor'], round(100 * pair['fraction'], 1)] for pair in pairs]
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Hydrogen bonds',
            'series': [{'label': 'H-bond count', 'data': counts}], 'pairs': pairs,
            'table': {'columns': ['Donor', 'Hydrogen', 'Acceptor', 'Occupancy (%)'], 'rows': rows, 'atom_columns': [0, 1, 2]}}


@analysis('contacts', 'mdanalysis', 'Native contacts Q(t) (contacts.Contacts)', category=INTERACTIONS,
          description='contacts.Contacts: fraction of the native contacts of the first frame kept along the trajectory.',
          params=[Param.selection('group_a', 'Group A'), Param.selection('group_b', 'Group B'),
                  Param.number('radius', 'Contact radius (Å)', 4.5, positive=True),
                  Param.choice('method', 'Method', ['hard_cut', 'soft_cut', 'radius_cut'])])
def contacts(ctx, p):
    from MDAnalysis.analysis import contacts as mda_contacts
    frames, universe = ctx.universe()
    a = _group(universe, p['group_a'], 'first contact group')
    b = _group(universe, p['group_b'], 'second contact group')
    universe.trajectory[0]
    radius = float(p['radius'])
    result = mda_contacts.Contacts(universe, select=(p['group_a'], p['group_b']), refgroup=(a, b),
                                   method=p['method'], radius=radius).run()
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Fraction of native contacts Q',
            'series': [{'label': f'Q ({p["method"]}, r = {radius} Å)', 'data': result.results.timeseries[:, 1].tolist()}],
            'notes': [f'Native contacts = pairs closer than {radius} Å in the first analysed frame.']}


@analysis('interrdf', 'mdanalysis', 'Radial distribution function (rdf.InterRDF)', category=INTERACTIONS,
          description='rdf.InterRDF: radial distribution function between two groups with minimum-image distances (needs a cell).',
          params=[Param.selection('group_a', 'Group A', 'element O'), Param.selection('group_b', 'Group B', 'element O'),
                  Param.number('rmax', 'r max (Å)', 8, positive=True), Param.integer('nbins', 'Bins', 150, min=1, max=10000),
                  Param.choice('exclude_same', 'Exclude pairs within the same', ['none', 'atom', 'residue'])])
def interrdf(ctx, p):
    from MDAnalysis.analysis import rdf
    _, universe = ctx.universe()
    _need_cell(universe, 'The radial distribution function')
    a = _group(universe, p['group_a'], 'first RDF group')
    b = _group(universe, p['group_b'], 'second RDF group')
    kwargs = {'exclusion_block': (1, 1)} if p['exclude_same'] == 'atom' else {}
    if p['exclude_same'] == 'residue':
        sizes_a = {len(r.atoms) for r in a.residues}
        sizes_b = {len(r.atoms) for r in b.residues}
        if len(sizes_a) == 1 and len(sizes_b) == 1:
            kwargs = {'exclusion_block': (sizes_a.pop(), sizes_b.pop())}
    result = rdf.InterRDF(a, b, nbins=p['nbins'], range=(0.0, float(p['rmax'])), **kwargs).run()
    return {'kind': 'profile', 'x': result.results.bins.tolist(), 'xLabel': 'r (Å)', 'yLabel': 'g(r)',
            'series': [{'label': f'g(r) {p["group_a"]} – {p["group_b"]}', 'data': result.results.rdf.tolist()}],
            'notes': [f'MDAnalysis InterRDF, minimum image, {len(a)} × {len(b)} atoms' + (f', exclusion block {kwargs["exclusion_block"]}' if kwargs else '')]}


def _group_distance(ctx, p, name):
    from MDAnalysis.lib.distances import distance_array, minimize_vectors
    frames, universe = ctx.universe()
    a = _group(universe, p['group_a'], 'first group')
    b = _group(universe, p['group_b'], 'second group')
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
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Distance (Å)',
            'series': [{'label': f'{label}: "{p["group_a"]}" – "{p["group_b"]}"', 'data': values}]}


@analysis('com_distance', 'mdanalysis', 'Centre-of-mass distance between two groups', category=INTERACTIONS,
          description='Distance between the centres of mass of two groups (minimum image when a cell is set).',
          params=[Param.selection('group_a', 'Group A', 'resid 1'), Param.selection('group_b', 'Group B', 'resid 2')])
def com_distance(ctx, p):
    return _group_distance(ctx, p, 'com_distance')


@analysis('min_distance', 'mdanalysis', 'Minimum distance between two groups', category=INTERACTIONS,
          description='Shortest distance between any atom of group A and any atom of group B (minimum image when a cell is set).',
          params=[Param.selection('group_a', 'Group A', 'resid 1'), Param.selection('group_b', 'Group B', 'not resid 1')])
def min_distance(ctx, p):
    return _group_distance(ctx, p, 'min_distance')


@analysis('atomic_distances', 'mdanalysis', 'Atom-by-atom distances (atomicdistances)', category=INTERACTIONS,
          description='atomicdistances.AtomicDistances: atom k of group A with atom k of group B (same size; the first 12 pairs are plotted).',
          params=[Param.selection('group_a', 'Group A', 'id 1'), Param.selection('group_b', 'Group B', 'id 2')])
def atomic_distances(ctx, p):
    from MDAnalysis.analysis import atomicdistances
    frames, universe = ctx.universe()
    a = _group(universe, p['group_a'], 'first group')
    b = _group(universe, p['group_b'], 'second group')
    if len(a) != len(b):
        raise ValueError(f'Both groups need the same number of atoms (they have {len(a)} and {len(b)}); atom k of the first is paired with atom k of the second.')
    box = universe.trajectory.ts.dimensions
    data = atomicdistances.AtomicDistances(a, b, pbc=box is not None and bool(np.all(box[:3] > 0))).run().results
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Distance (Å)',
            'series': [{'label': f'{int(a[k].id)}–{int(b[k].id)}', 'data': data[:, k].tolist()} for k in range(min(12, len(a)))],
            'notes': [f'{len(a)} atom pairs' + (' (first 12 shown)' if len(a) > 12 else '')]}


@analysis('dihedral_mda', 'mdanalysis', 'Dihedral angles (dihedrals.Dihedral, −180…180°)', category=INTERACTIONS,
          description='dihedrals.Dihedral: torsions of groups of four atoms with the IUPAC sign convention (−180…180°; the ASE tab uses 0–360°).',
          params=[Param.groups('quads', 'Groups of four MONET IDs', 4)])
def dihedral_mda(ctx, p):
    from MDAnalysis.analysis.dihedrals import Dihedral
    frames, universe = ctx.universe()
    quads = p['quads']
    if not quads:
        raise ValueError('Enter at least one group of four MONET IDs.')
    if any(i >= len(universe.atoms) for quad in quads for i in quad):
        raise ValueError(f'Atom IDs must be between 1 and {len(universe.atoms)}.')
    result = Dihedral([universe.atoms[quad] for quad in quads]).run()
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Dihedral (°, −180 to 180)',
            'series': [{'label': '-'.join(str(int(universe.atoms[i].id)) for i in quad), 'data': result.results.angles[:, k].tolist()}
                       for k, quad in enumerate(quads)],
            'notes': ['MDAnalysis Dihedral (IUPAC sign convention, −180…180°).']}


@analysis('lineardensity', 'mdanalysis', 'Linear density profile (lineardensity)', category=DENSITIES,
          description='lineardensity.LinearDensity: mass-density profile along the cell axes, averaged over the analysed frames (needs a cell).',
          params=[Param.selection('selection', 'Selection'),
                  Param.choice('grouping', 'Grouping', ['atoms', 'residues', 'segments', 'fragments']),
                  Param.number('binsize', 'Bin size (Å)', 0.25, positive=True),
                  Param.choice('axes', 'Axes', ['xyz', 'x', 'y', 'z'])])
def lineardensity(ctx, p):
    from MDAnalysis.analysis import lineardensity as mda_lineardensity
    _, universe = ctx.universe()
    _need_cell(universe, 'Linear density')
    group = _group(universe, p['selection'], 'density')
    out = mda_lineardensity.LinearDensity(group, grouping=p['grouping'], binsize=float(p['binsize'])).run().results
    series, x = [], None
    for axis in p['axes']:
        dim = out[axis]
        edges = np.asarray(dim['hist_bin_edges'])
        centres = ((edges[:-1] + edges[1:]) / 2).tolist()
        x = x or centres
        series.append({'label': f'mass density along {axis}', 'data': np.asarray(dim['mass_density']).tolist()[:len(x)]})
    return {'kind': 'profile', 'x': x, 'xLabel': 'Position along the axis (Å)', 'yLabel': 'Mass density (g cm⁻³)',
            'series': series, 'notes': ['MDAnalysis LinearDensity averaged over the analysed frames; charge density is not shown (XYZ files carry no charges).']}


@analysis('density', 'mdanalysis', '3D density grid, OpenDX (density.DensityAnalysis)', category=DENSITIES,
          description='density.DensityAnalysis: 3D number-density grid of the selection, written as OpenDX for VMD, PyMOL or Chimera.',
          params=[Param.selection('selection', 'Selection', 'element O'), Param.number('delta', 'Grid spacing (Å)', 1, positive=True)],
          output={'suffix': '-density.dx'})
def density(ctx, p):
    from MDAnalysis.analysis import density as mda_density
    _, universe = ctx.universe()
    group = _group(universe, p['selection'], 'density')
    grid = mda_density.DensityAnalysis(group, delta=float(p['delta'])).run().results.density
    grid.export(ctx.output(), type='double')
    values = np.asarray(grid.grid)
    return {'kind': 'table', 'download': True,
            'table': {'columns': ['Quantity', 'Value'],
                      'rows': [['Grid points', ' × '.join(map(str, values.shape))], ['Spacing (Å)', p['delta']],
                               ['Maximum density (Å⁻³)', round(float(values.max()), 6)], ['Mean density (Å⁻³)', round(float(values.mean()), 6)]]},
            'notes': ['OpenDX grid (VMD, PyMOL, Chimera); the selection is averaged over the analysed frames.']}


@analysis('ramachandran', 'mdanalysis', 'Ramachandran φ/ψ (dihedrals.Ramachandran)', category=PROTEINS,
          description='dihedrals.Ramachandran: backbone φ/ψ of protein residues (needs a topology with standard atom names, e.g. PDB).',
          params=[Param.selection('selection', 'Protein selection', 'protein')])
def ramachandran(ctx, p):
    from MDAnalysis.analysis.dihedrals import Ramachandran
    frames, universe = ctx.universe()
    group = _group(universe, p['selection'] if p['selection'] != 'all' else 'protein', 'protein')
    try:
        result = Ramachandran(group.residues.atoms).run()
    except Exception as error:
        raise ValueError(f'Ramachandran needs protein backbone atoms (N, CA, C with standard names): {error}') from None
    angles = result.results.angles
    residues = [r for r in group.residues][1:-1][:angles.shape[1]]
    series = []
    for k in range(min(4, angles.shape[1])):
        label = f'{residues[k].resname}{residues[k].resid}' if k < len(residues) else f'residue {k + 1}'
        series += [{'label': f'φ {label}', 'data': angles[:, k, 0].tolist()}, {'label': f'ψ {label}', 'data': angles[:, k, 1].tolist()}]
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Angle (°)', 'series': series,
            'notes': [f'{angles.shape[1]} residues; the first 4 are plotted.']}


@analysis('dssp', 'mdanalysis', 'Secondary structure (dssp.DSSP)', category=PROTEINS,
          description='dssp.DSSP: fraction of helix, strand and loop residues per frame (protein topology with backbone N, CA, C, O).')
def dssp(ctx, p):
    from MDAnalysis.analysis.dssp import DSSP
    frames, universe = ctx.universe()
    try:
        result = DSSP(universe).run()
    except Exception as error:
        raise ValueError(f'DSSP needs a protein with backbone atoms N, CA, C, O: {error}') from None
    codes = np.asarray(result.results.dssp)
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Fraction of residues',
            'series': [{'label': label, 'data': (codes == code).mean(axis=1).tolist()} for code, label in (('H', 'helix'), ('E', 'strand'), ('-', 'loop'))],
            'notes': [f'{codes.shape[1]} residues (MDAnalysis DSSP).']}

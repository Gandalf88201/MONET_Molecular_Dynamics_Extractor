"""MDAnalysis analyses of the MDAnalysis tab, on the active MONET trajectory.

Every function receives the context (ctx.universe() is an in-memory Universe whose atom ids are
the MONET IDs) and the checked parameters, and returns a result for the generic plots.
"""
from functools import partial
import math
import warnings

import numpy as np

import monet_mda
from monet_mda import _group, _need_cell
from monet_registry import Param, analysis

STRUCTURE = 'Structure and dynamics'
INTERACTIONS = 'Interactions and distances'
DENSITIES = 'Densities'
PROTEINS = 'Proteins'
NUCLEIC = 'Nucleic acids'
SOFT = 'Membranes, polymers and dielectrics'
MAX_CURVES = 12       # curves drawn per plot; the tables list every value


def _frames(frames, xlabel='Frame'):
    return {'x': list(frames), 'xLabel': xlabel}


def _lags(ctx, count):
    """Lag axis of `count` analysed frames: ps when the time axis is set, frames otherwise."""
    if ctx.dt:
        return [k * ctx.dt / 1000 for k in range(count)], 'Lag time (ps)'
    return list(range(count)), 'Lag (analysed frames)'


def _has_cell(universe):
    dims = universe.trajectory.ts.dimensions
    return dims is not None and bool(np.all(np.asarray(dims[:3]) > 0))


def _ids(atoms):
    return '-'.join(str(int(a.id)) for a in atoms)


def _circular(values_deg, axis=0):
    """Circular mean (−180…180°) and circular SD (°) of angles in degrees."""
    from scipy.stats import circmean, circstd
    rad = np.deg2rad(values_deg)
    return (np.rad2deg(circmean(rad, high=np.pi, low=-np.pi, axis=axis, nan_policy='omit')),
            np.rad2deg(circstd(rad, high=np.pi, low=-np.pi, axis=axis, nan_policy='omit')))


def _write_structures(ctx, atoms, blocks):
    """Write [(comment, positions of `atoms`)] as extended XYZ with the topology columns of the source."""
    symbols = [str(e) for e in atoms.elements]
    # Topology columns of the source (atom names, residues, charges) are kept so selections still work.
    properties = ctx.atom_properties()
    extra = [(name, kind) for name, kind in (('resname', 'S'), ('resid', 'I'), ('atomname', 'S'), ('charge', 'R'))
             if name in properties]
    columns = 'species:S:1:pos:R:3' + ''.join(f':{name}:{kind}:1' for name, kind in extra)
    suffixes = [''.join(f' {properties[name][i]}' for name, _ in extra) for i in atoms.indices]
    with open(ctx.output(), 'w') as fh:
        for comment, positions in blocks:
            fh.write(f'{len(symbols)}\nProperties={columns} {comment}\n')
            fh.write(''.join(f'{s} {x:.8f} {y:.8f} {z:.8f}{tail}\n'
                             for s, (x, y, z), tail in zip(symbols, (np.asarray(positions) + 0.0).tolist(), suffixes)))


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
                      'written as a trajectory for the extraction. The cosine content of each projection '
                      '(pca.cosine_content) flags components that look like random diffusion (close to 1) rather than '
                      'sampled motion.',
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
    # Cosine content (Hess 2002): near 1 means the projection is a half cosine, i.e. unconverged random diffusion.
    cosine = [float(mda_pca.cosine_content(projection, k)) if len(projection) > 2 else float('nan') for k in range(count)]
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Projection (Å)',
            'series': [{'label': f'PC{k + 1} ({100 * ratio[k]:.1f} %)', 'data': projection[:, k].tolist()} for k in range(count)],
            'pca': {'components': count, 'shown': shown, 'variance_ratio': [float(v) for v in ratio[:count]]},
            'notes': [f'{take} components explain 90 % of the variance; cumulated variance of PC1–PC{count}: ' +
                      ', '.join(f'{100 * v:.1f} %' for v in cumulated[:count]),
                      'Cosine content close to 1 (e.g. above 0.7) marks a component dominated by random diffusion: '
                      'the sampling has not converged along it.'],
            'table': {'columns': ['Component', 'Variance (Å²)', 'Cumulated (%)', 'Cosine content'],
                      'rows': [[k + 1, round(float(variance[k]), 5), round(100 * cumulated[k], 2), round(cosine[k], 4)]
                               for k in range(count)]}}


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
          description='gnm.GNMAnalysis: lowest non-zero eigenvalue of the Kirchhoff matrix in every frame. The '
                      'close-contact variant (closeContactGNMAnalysis) builds the matrix from residue–residue atom '
                      'contacts, weighted by the number of contacts divided by the square root of the residue sizes.',
          params=[Param.selection('selection', 'Selection'), Param.number('cutoff', 'Cutoff (Å)', 7, positive=True),
                  Param.choice('model', 'Kirchhoff matrix', ['GNMAnalysis', 'closeContactGNMAnalysis'])])
def gnm(ctx, p):
    from MDAnalysis.analysis import gnm as mda_gnm
    frames, universe = ctx.universe()
    _group(universe, p['selection'], 'GNM', 3)
    model = getattr(mda_gnm, p['model'])
    result = model(universe, select=p['selection'], cutoff=float(p['cutoff'])).run()
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Lowest non-zero eigenvalue',
            'series': [{'label': f'{p["model"]} of "{p["selection"]}"', 'data': np.asarray(result.results.eigenvalues, dtype=float).tolist()}],
            'notes': [f'Gaussian network model ({p["model"]}, Kirchhoff matrix, cutoff {float(p["cutoff"]):.1f} Å).']}


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
    # The selection is stored without double quotes, which would end the extended-XYZ value.
    label = selection.replace('"', "'")
    _write_structures(ctx, universe.atoms, [(f'frame={frame} source_frame={frame} aligned_on="{label}"', positions[k])
                                      for k, frame in enumerate(frames)])
    return {'kind': 'table', 'table': {'columns': ['Aligned trajectory', 'Value'],
                                       'rows': [['Frames', len(frames)], ['Fit selection', selection]]},
            'selection': selection}


@analysis('average_structure', 'mdanalysis', 'Average structure and RMSD from it (align.AverageStructure)', category=STRUCTURE,
          description='align.AverageStructure: every frame is superimposed on the first one by the selection and its '
                      'positions are averaged; the RMSD of each frame from this average (after fitting on it) is plotted '
                      'and the average structure of the selection is written as extended XYZ.',
          params=[Param.selection('selection', 'Selection (fitted and averaged)')], output={'suffix': '-average.extxyz'})
def average_structure(ctx, p):
    from MDAnalysis.analysis import align as mda_align, rms
    frames, universe = ctx.universe()
    selection = p['selection']
    group = _group(universe, selection, 'fit', 3)
    average = mda_align.AverageStructure(universe, universe, select=selection, ref_frame=0).run()
    reference = average.results.universe.atoms          # the selected atoms only, in the same order
    rmsd = rms.RMSD(group, reference).run().results.rmsd[:, 2]
    label = selection.replace('"', "'")
    _write_structures(ctx, group, [(f'frame=0 average_of={len(frames)} aligned_on="{label}"', reference.positions)])
    return {'kind': 'series', **_frames(frames), 'yLabel': 'RMSD from the average (Å)',
            'series': [{'label': f'RMSD of "{selection}" from its average structure', 'data': rmsd.tolist()}],
            'table': {'columns': ['Quantity', 'Value'],
                      'rows': [['Frames averaged', len(frames)], ['Atoms', len(group)],
                               ['RMSD of the first frame from the average (Å)', round(float(average.results.rmsd), 5)],
                               ['Mean RMSD from the average (Å)', round(float(rmsd.mean()), 5)]]},
            'notes': ['MDAnalysis AverageStructure (frames superimposed on the first one) and rms.RMSD against the average.']}


@analysis('bat', 'mdanalysis', 'Bond–angle–torsion internal coordinates (bat.BAT)', category=STRUCTURE,
          description='bat.BAT: internal coordinates of one whole bonded molecule — bonds, angles and torsions of a spanning '
                      'tree grown from a terminal root atom. The most fluctuating coordinates of the chosen type are '
                      'plotted; the table lists all of them. Torsions that share their central bond with an earlier one '
                      'are stored as an offset from it (improper), as in MDAnalysis.',
          params=[Param.selection('selection', 'One whole molecule', 'resid 1'),
                  Param.choice('kind', 'Plot', ['torsions', 'angles', 'bonds'])])
def bat(ctx, p):
    from MDAnalysis.analysis.bat import BAT
    frames, universe = ctx.universe()
    group = _group(universe, p['selection'], 'BAT', 4)
    fragments = group.fragments
    if len(fragments) != 1 or len(fragments[0]) != len(group):
        raise ValueError(f'BAT needs exactly one whole bonded molecule; "{p["selection"]}" covers '
                         f'{len(fragments)} molecule(s) ({len(group)} of {sum(len(f) for f in fragments)} atoms).')
    try:
        result = BAT(group).run()
    except Exception as error:
        raise ValueError(f'BAT could not build the internal coordinates: {error}') from None
    values = np.asarray(result.results.bat, dtype=float)[:, 6:]      # the first six place and orient the molecule
    root, torsions = result._root, result._torsions
    primary = set(result._unique_primary_torsion_indices)
    labels = [('bond', _ids(root[:2])), ('bond', _ids(root[1:])), ('angle', _ids(root))]
    labels += [('bond', _ids(t[:2])) for t in torsions] + [('angle', _ids(t[:3])) for t in torsions]
    labels += [('torsion' if k in primary else 'torsion offset', _ids(t)) for k, t in enumerate(torsions)]
    rows, curves = [], []
    for k, (kind, atoms) in enumerate(labels):
        data = values[:, k] if kind == 'bond' else np.rad2deg(values[:, k])
        if kind.startswith('torsion'):
            data = (data + 180) % 360 - 180
            mean, sd = _circular(data)
        else:
            mean, sd = data.mean(), data.std()
        unit = 'Å' if kind == 'bond' else '°'
        rows.append([kind, atoms, round(float(mean), 4), round(float(sd), 4), unit])
        if kind.split()[0] == p['kind'][:-1]:
            curves.append((float(sd), f'{kind} {atoms}', data))
    curves.sort(key=lambda c: -c[0])
    y = {'torsions': 'Torsion (°)', 'angles': 'Angle (°)', 'bonds': 'Bond length (Å)'}[p['kind']]
    return {'kind': 'series', **_frames(frames), 'yLabel': y,
            'series': [{'label': label, 'data': data.tolist()} for _, label, data in curves[:MAX_CURVES]],
            'table': {'columns': ['Coordinate', 'Atoms (MONET IDs)', 'Mean', 'SD', 'Unit'], 'rows': rows},
            'notes': [f'{len(group)} atoms, root {_ids(root)}; {3 * len(group) - 6} internal coordinates. '
                      f'The {min(MAX_CURVES, len(curves))} most fluctuating {p["kind"]} are plotted.']}


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


@analysis('interrdf_s', 'mdanalysis', 'Site-specific RDF and coordination number (rdf.InterRDF_s)', category=INTERACTIONS,
          description='rdf.InterRDF_s: radial distribution function of every site atom with a group (minimum image, needs a '
                      'cell), and the running coordination number N(r) of each site; e.g. each ion with the water oxygens.',
          params=[Param.selection('sites', 'Sites (at most 50 atoms)', 'element Na'),
                  Param.selection('group_b', 'Group', 'element O'),
                  Param.number('rmax', 'r max (Å)', 8, positive=True), Param.integer('nbins', 'Bins', 150, min=1, max=10000),
                  Param.number('shell', 'Coordination shell radius (Å)', 3.2, positive=True)])
def interrdf_s(ctx, p):
    from MDAnalysis.analysis import rdf
    _, universe = ctx.universe()
    _need_cell(universe, 'The site-specific radial distribution function')
    sites = _group(universe, p['sites'], 'site')
    group = _group(universe, p['group_b'], 'second RDF group')
    if len(sites) > 50:
        raise ValueError(f'The site selection has {len(sites)} atoms; choose at most 50 (use rdf.InterRDF for group averages).')
    result = rdf.InterRDF_s(universe, [[sites, group]], nbins=p['nbins'], range=(0.0, float(p['rmax']))).run()
    result.get_cdf()
    bins = np.asarray(result.results.bins)
    # rdf[i, j] is normalised per pair: the site RDF with the whole group is the mean over j,
    # its running coordination number the sum of the cumulative counts over j.
    self_pairs = np.equal.outer(sites.indices, group.indices)
    rdfs = np.asarray(result.results.rdf[0]).copy()
    cdfs = np.asarray(result.results.cdf[0]).copy()
    rdfs[self_pairs] = 0          # an atom in both selections is not its own neighbour
    cdfs[self_pairs] = 0
    partners = np.maximum(len(group) - self_pairs.sum(axis=1), 1)
    site_rdf = rdfs.sum(axis=1) / partners[:, None]
    site_cn = cdfs.sum(axis=1)
    shell = float(p['shell'])
    at_shell = int(np.clip(np.searchsorted(bins, shell), 0, len(bins) - 1))
    rows = []
    for k, atom in enumerate(sites):
        peak = int(np.argmax(site_rdf[k]))
        rows.append([int(sites.indices[k]), str(atom.element), round(float(bins[peak]), 3), round(float(site_rdf[k, peak]), 4),
                     round(float(site_cn[k, at_shell]), 3)])
    return {'kind': 'profile', 'x': bins.tolist(), 'xLabel': 'r (Å)', 'yLabel': 'g(r)',
            'series': [{'label': f'g(r) {int(atom.id)} – "{p["group_b"]}"', 'data': site_rdf[k].tolist()}
                       for k, atom in enumerate(sites[:MAX_CURVES])],
            'table': {'columns': ['Site', 'Element', 'First peak r (Å)', 'Peak g(r)', f'N(r ≤ {shell:g} Å)'], 'rows': rows,
                      'atom_columns': [0]},
            'notes': [f'MDAnalysis InterRDF_s, minimum image, {len(sites)} sites × {len(group)} atoms'
                      + (f'; the first {MAX_CURVES} sites are plotted' if len(sites) > MAX_CURVES else '') + '.',
                      f'Mean coordination number within {shell:g} Å: {float(site_cn[:, at_shell].mean()):.3f}.']}


def _hbond_analysis(universe, p):
    from MDAnalysis.analysis.hydrogenbonds import HydrogenBondAnalysis
    for label, text in (('donor', p['donors']), ('hydrogen', p['hydrogens']), ('acceptor', p['acceptors'])):
        _group(universe, text, label)
    return HydrogenBondAnalysis(universe, donors_sel=p['donors'], hydrogens_sel=p['hydrogens'], acceptors_sel=p['acceptors'],
                                d_a_cutoff=float(p['d_a_cutoff']), d_h_a_angle_cutoff=float(p['angle']), d_h_cutoff=1.2)


def _hbond_params():
    return [Param.selection('donors', 'Donors', 'element O N F'), Param.selection('hydrogens', 'Hydrogens', 'element H'),
            Param.selection('acceptors', 'Acceptors', 'element O N F'),
            Param.number('d_a_cutoff', 'D–A cutoff (Å)', 3, min=1, max=6),
            Param.number('angle', 'D–H–A minimum angle (°)', 150, min=90, max=180)]


@analysis('hbond_lifetime', 'mdanalysis', 'Hydrogen-bond lifetime (HydrogenBondAnalysis.lifetime)', category=INTERACTIONS,
          description='HydrogenBondAnalysis.lifetime: autocorrelation C(τ) of the hydrogen bonds found along the trajectory; '
                      'with an allowed gap of 0 frames it is the continuous lifetime, larger gaps give the intermittent one. '
                      'Set the time axis to get τ in ps; save frames often enough to resolve the decay.',
          params=_hbond_params() + [Param.integer('tau_max', 'Longest lag (analysed frames)', 20, min=1, max=100000),
                                    Param.integer('intermittency', 'Allowed gap (frames)', 0, min=0, max=1000)])
def hbond_lifetime(ctx, p):
    frames, universe = ctx.universe()
    if p['tau_max'] >= len(frames):
        raise ValueError(f'The longest lag must be shorter than the {len(frames)} analysed frames.')
    hba = _hbond_analysis(universe, p)
    hba.run()
    if not len(hba.results.hbonds):
        raise ValueError('No hydrogen bonds were found with these selections and cutoffs.')
    tau, values = hba.lifetime(tau_max=p['tau_max'], window_step=1, intermittency=p['intermittency'])
    x, label = _lags(ctx, len(tau))
    integral = float(np.trapezoid(values, x)) if hasattr(np, 'trapezoid') else float(np.trapz(values, x))
    unit = 'ps' if ctx.dt else 'frames'
    kind = 'continuous' if p['intermittency'] == 0 else f'intermittent (gaps ≤ {p["intermittency"]} frames)'
    return {'kind': 'profile', 'x': x, 'xLabel': label, 'yLabel': 'C(τ)',
            'series': [{'label': f'H-bond autocorrelation, {kind}', 'data': np.asarray(values, dtype=float).tolist()}],
            'table': {'columns': ['Quantity', 'Value'],
                      'rows': [['Hydrogen bonds found (all frames)', len(hba.results.hbonds)],
                               [f'∫ C(τ) dτ up to τ max ({unit})', round(integral, 5)],
                               ['C(τ max)', round(float(values[-1]), 5)]]},
            'notes': ['The integral estimates the lifetime only when C(τ) has decayed to about 0 by τ max.']}


@analysis('hbond_autocorrel', 'mdanalysis', 'Hydrogen-bond autocorrelation with triexponential fit (HydrogenBondAutoCorrel)',
          category=INTERACTIONS,
          description='hydrogenbonds.HydrogenBondAutoCorrel: C(t) of the hydrogen bonds present at several starting frames, '
                      'fitted with a sum of exponentials to give the lifetime τ (Gowers & Carbone 2015). Each hydrogen is '
                      'paired with the donor bonded to it. Set the time axis to get t and τ in ps.',
          params=[Param.selection('hydrogens', 'Hydrogens', 'element H'), Param.selection('donors', 'Donors', 'element O N F'),
                  Param.selection('acceptors', 'Acceptors', 'element O N F'),
                  Param.choice('bond_type', 'Bond type', ['continuous', 'intermittent']),
                  Param.number('dist_crit', 'D–A cutoff (Å)', 3, min=1, max=6),
                  Param.number('angle_crit', 'D–H–A minimum angle (°)', 130, min=90, max=180),
                  Param.integer('window', 'Window (analysed frames)', 20, min=2, max=100000),
                  Param.integer('nruns', 'Starting frames', 1, min=1, max=1000),
                  Param.integer('nsamples', 'Samples per window', 50, min=2, max=10000)])
def hbond_autocorrel(ctx, p):
    from MDAnalysis.analysis.hydrogenbonds import HydrogenBondAutoCorrel
    frames, universe = ctx.universe()
    hydrogens = _group(universe, p['hydrogens'], 'hydrogen')
    donors = _group(universe, p['donors'], 'donor')
    acceptors = _group(universe, p['acceptors'], 'acceptor')
    donor_set = set(donors.indices)
    pairs = [(h, next(a for a in h.bonded_atoms if a.index in donor_set)) for h in hydrogens
             if any(a.index in donor_set for a in h.bonded_atoms)]
    if not pairs:
        raise ValueError('No selected hydrogen is bonded to a selected donor.')
    if p['window'] >= len(frames):
        raise ValueError(f'The window must be shorter than the {len(frames)} analysed frames.')
    step = float(universe.trajectory.dt)
    hydrogen_group = universe.atoms[[h.index for h, _ in pairs]]
    donor_group = universe.atoms[[d.index for _, d in pairs]]
    try:
        hbac = HydrogenBondAutoCorrel(universe, hydrogens=hydrogen_group, acceptors=acceptors, donors=donor_group,
                                      bond_type=p['bond_type'], angle_crit=float(p['angle_crit']), dist_crit=float(p['dist_crit']),
                                      sample_time=p['window'] * step, nruns=p['nruns'], nsamples=p['nsamples'],
                                      pbc=_has_cell(universe))
        hbac.run()
    except Exception as error:
        raise ValueError(f'HydrogenBondAutoCorrel failed: {error}') from None
    frames_axis = np.asarray(hbac.solution['time'], dtype=float) / step
    x = (frames_axis * ctx.dt / 1000).tolist() if ctx.dt else frames_axis.tolist()
    values = np.asarray(hbac.solution['results'], dtype=float)
    series = [{'label': f'C(t), {p["bond_type"]}', 'data': values.tolist()}]
    rows, notes = [['Donor–hydrogen pairs', len(pairs)], ['Acceptors', len(acceptors)]], []
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', RuntimeWarning)
            hbac.solve()
        if hbac.solution['ier'] not in (1, 2, 3, 4):
            raise ValueError(hbac.solution['mesg'])
        tau = float(hbac.solution['tau']) * (ctx.dt / 1000 if ctx.dt else 1) / step
        series.append({'label': 'fit (sum of exponentials)', 'data': np.asarray(hbac.solution['estimate'], dtype=float).tolist()})
        rows.append([f'τ ({"ps" if ctx.dt else "frames"})', round(tau, 5)])
    except Exception as error:
        notes.append(f'The exponential fit did not converge ({error}); only C(t) is shown.')
    return {'kind': 'profile', 'x': x, 'xLabel': 'Time (ps)' if ctx.dt else 'Time (analysed frames)', 'yLabel': 'C(t)',
            'series': series, 'table': {'columns': ['Quantity', 'Value'], 'rows': rows}, 'notes': notes}


@analysis('water_bridges', 'mdanalysis', 'Water bridges (WaterBridgeAnalysis)', category=INTERACTIONS,
          description='hydrogenbonds.WaterBridgeAnalysis: hydrogen-bond chains that link selection 1 to selection 2 through '
                      'up to `order` water molecules; count per frame and the most frequent bridges. Donor and acceptor '
                      'atoms are taken from the two atom selections below.',
          params=[Param.selection('selection1', 'Selection 1', 'not resname H2O'), Param.selection('selection2', 'Selection 2', 'not resname H2O'),
                  Param.selection('water', 'Water', 'resname H2O'),
                  Param.selection('donors', 'Donor heavy atoms', 'element O N'), Param.selection('acceptors', 'Acceptor atoms', 'element O N F'),
                  Param.integer('order', 'Waters in a bridge (at most)', 1, min=1, max=4),
                  Param.number('distance', 'Cutoff (Å)', 3, min=1, max=6), Param.number('angle', 'Minimum angle (°)', 120, min=90, max=180)])
def water_bridges(ctx, p):
    from MDAnalysis.analysis.hydrogenbonds import WaterBridgeAnalysis
    frames, universe = ctx.universe()
    for key, label in (('selection1', 'first'), ('selection2', 'second'), ('water', 'water')):
        _group(universe, p[key], f'{label}')
    donors = tuple(sorted({str(n) for n in _group(universe, p['donors'], 'donor').names}))
    acceptors = tuple(sorted({str(n) for n in _group(universe, p['acceptors'], 'acceptor').names}))
    try:
        wba = WaterBridgeAnalysis(universe, p['selection1'], p['selection2'], water_selection=p['water'], order=p['order'],
                                  distance=float(p['distance']), angle=float(p['angle']), donors=donors, acceptors=acceptors,
                                  distance_type='hydrogen', pbc=_has_cell(universe))
        wba.run()
    except Exception as error:
        raise ValueError(f'WaterBridgeAnalysis failed: {error}') from None
    counts = [int(count) for _, count in wba.count_by_time() or []] or [0] * len(frames)
    # count_by_type rows: atom indices of the two ends, their residue names, numbers and atom names, fraction.
    by_type = sorted(wba.count_by_type() or [], key=lambda row: -row[-1])[:50]
    rows = [[int(row[0]), int(row[1]), round(float(row[-1]), 4)] for row in by_type]
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Water bridges',
            'series': [{'label': f'bridges between the two selections (≤ {p["order"]} water)', 'data': counts}],
            'table': {'columns': ['Selection 1 atom', 'Selection 2 atom', 'Bridges per frame (mean)'], 'rows': rows,
                      'atom_columns': [0, 1]},
            'notes': ['The ends are the atoms that donate or accept the first and last hydrogen bond (a hydrogen for a donor); '
                      'several paths between the same ends are each counted, so a pair can have more than one bridge per frame.']}


@analysis('contact_map', 'mdanalysis', 'Contact map (distances.contact_matrix)', category=INTERACTIONS,
          description='distances.contact_matrix: fraction of the analysed frames in which each pair of selected atoms is closer '
                      'than the cutoff (minimum image when a cell is set); at most 1000 atoms, e.g. "name CA" of a protein.',
          params=[Param.selection('selection', 'Selection', 'all'), Param.number('cutoff', 'Cutoff (Å)', 8, positive=True)])
def contact_map(ctx, p):
    from MDAnalysis.analysis.distances import contact_matrix
    frames, universe = ctx.universe()
    group = _group(universe, p['selection'], 'contact map', 2)
    if len(group) > 1000:
        raise ValueError(f'The selection has {len(group)} atoms; the contact map takes at most 1000 (e.g. "name CA").')
    cutoff = float(p['cutoff'])
    total = np.zeros((len(group), len(group)))
    for ts in universe.trajectory:
        box = ts.dimensions if _has_cell(universe) else None
        total += contact_matrix(group.positions, cutoff=cutoff, box=box)
    fraction = total / len(frames)
    np.fill_diagonal(fraction, 1.0)
    upper = np.triu_indices(len(group), 1)
    order = np.argsort(-fraction[upper], kind='stable')[:50]
    rows = [[int(group.indices[upper[0][k]]), int(group.indices[upper[1][k]]), round(100 * float(fraction[upper][k]), 1)]
            for k in order if fraction[upper][k] > 0]
    return {'kind': 'matrix', 'matrix': np.round(fraction, 4).tolist(), 'labels': [int(i) for i in group.ids],
            'xLabel': 'MONET atom ID', 'yLabel': 'MONET atom ID', 'colorLabel': 'Fraction of frames in contact',
            'table': {'columns': ['Atom A', 'Atom B', 'Contact (%)'], 'rows': rows, 'atom_columns': [0, 1]},
            'notes': [f'{len(group)} atoms, cutoff {cutoff:g} Å, {len(frames)} frames'
                      + (', minimum image' if _has_cell(universe) else '') + '; the table lists the 50 most frequent contacts.']}


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


@analysis('leaflets', 'mdanalysis', 'Membrane leaflets and thickness (leaflet.LeafletFinder)', category=SOFT,
          description='leaflet.LeafletFinder: head-group atoms closer than the cutoff are linked into a graph; its connected '
                      'components (first analysed frame) are the leaflets. The z of the two largest leaflets and their '
                      'distance (bilayer thickness along z) are then followed along the trajectory.',
          params=[Param.selection('headgroups', 'Head-group atoms', 'name P'),
                  Param.number('cutoff', 'Cutoff (Å)', 15, positive=True), Param.bool('pbc', 'Periodic neighbours', True)], requires=('networkx',))
def leaflets(ctx, p):
    from MDAnalysis.analysis.leaflet import LeafletFinder
    frames, universe = ctx.universe()
    heads = _group(universe, p['headgroups'], 'head-group', 2)
    universe.trajectory[0]
    try:
        finder = LeafletFinder(universe, heads, cutoff=float(p['cutoff']), pbc=bool(p['pbc']) and _has_cell(universe))
        groups = finder.groups()
    except Exception as error:
        raise ValueError(f'LeafletFinder failed: {error}') from None
    rows = []
    for k, group in enumerate(groups):
        resids = sorted({int(r) for r in group.resids})
        rows.append([k + 1, len(group), len(resids), round(float(group.positions[:, 2].mean()), 3),
                     f'{resids[0]}…{resids[-1]}' if len(resids) > 1 else str(resids[0])])
    notes = [f'{len(groups)} leaflet(s) at cutoff {float(p["cutoff"]):g} Å (first analysed frame).']
    if len(groups) < 2:
        notes.append('Only one leaflet was found: lower the cutoff to separate the two layers.')
        return {'kind': 'table', 'table': {'columns': ['Leaflet', 'Atoms', 'Residues', 'Mean z (Å)', 'Residue IDs'], 'rows': rows},
                'notes': notes}
    upper, lower = sorted(groups[:2], key=lambda g: -g.positions[:, 2].mean())
    z_upper, z_lower = [], []
    for _ in universe.trajectory:
        z_upper.append(float(upper.positions[:, 2].mean()))
        z_lower.append(float(lower.positions[:, 2].mean()))
    thickness = np.abs(np.asarray(z_upper) - np.asarray(z_lower))
    notes.append(f'Thickness (head-group planes along z): {thickness.mean():.3f} ± {thickness.std():.3f} Å.')
    return {'kind': 'series', **_frames(frames), 'yLabel': 'z (Å)',
            'series': [{'label': 'upper leaflet, mean z', 'data': z_upper}, {'label': 'lower leaflet, mean z', 'data': z_lower},
                       {'label': 'thickness', 'data': thickness.tolist()}],
            'table': {'columns': ['Leaflet', 'Atoms', 'Residues', 'Mean z (Å)', 'Residue IDs'], 'rows': rows}, 'notes': notes}


@analysis('persistence_length', 'mdanalysis', 'Persistence length (polymer.PersistenceLength)', category=SOFT,
          description='polymer.PersistenceLength: bond autocorrelation ⟨cos θ(n)⟩ along the backbone, averaged over chains '
                      'and frames, fitted with exp(−n l_b / l_p). Each bonded molecule of the selection is one chain, ordered '
                      'by polymer.sort_backbone; all chains need the same number of backbone atoms.',
          params=[Param.selection('selection', 'Backbone atoms', 'element C')])
def persistence_length(ctx, p):
    from MDAnalysis.analysis import polymer
    _, universe = ctx.universe()
    group = _group(universe, p['selection'], 'backbone', 3)
    chains = []
    for fragment in group.fragments:
        chain = fragment.intersection(group)
        if len(chain) < 3:
            continue
        try:
            chains.append(polymer.sort_backbone(chain))
        except Exception as error:
            raise ValueError(f'The backbone atoms of molecule {_ids(chain[:1])}… are not a linear bonded chain: {error}') from None
    if not chains:
        raise ValueError('No chain of at least three bonded backbone atoms was found.')
    lengths = sorted({len(c) for c in chains})
    if len(lengths) > 1:
        raise ValueError(f'All chains need the same number of backbone atoms (found {", ".join(map(str, lengths))}).')
    result = polymer.PersistenceLength(chains).run().results
    x = np.asarray(result.x, dtype=float)
    return {'kind': 'profile', 'x': x.tolist(), 'xLabel': 'Contour distance n·l_b (Å)', 'yLabel': '⟨cos θ⟩',
            'series': [{'label': 'bond autocorrelation', 'data': np.asarray(result.bond_autocorrelation, dtype=float).tolist()},
                       {'label': f'fit exp(−x / {float(result.lp):.3f} Å)', 'data': np.asarray(result.fit, dtype=float).tolist()}],
            'table': {'columns': ['Quantity', 'Value'],
                      'rows': [['Chains', len(chains)], ['Backbone atoms per chain', lengths[0]],
                               ['Mean bond length l_b (Å)', round(float(result.lb), 5)],
                               ['Persistence length l_p (Å)', round(float(result.lp), 5)]]}}


def _charges(universe, text):
    """Charges typed as "element charge" pairs (e.g. "O -0.8476 H 0.4238"), else those stored in the file."""
    tokens = text.replace(',', ' ').replace(';', ' ').split()
    if not tokens:
        if not np.any(universe.atoms.charges):
            raise ValueError('The trajectory has no partial charges: type them by element (e.g. "O -0.8476 H 0.4238"), '
                             'or load a file with a charge column (extended XYZ, or a topology with charges).')
        return 'file'
    if len(tokens) % 2:
        raise ValueError('Type the charges as pairs "element charge", e.g. "O -0.8476 H 0.4238".')
    table = {}
    for element, value in zip(tokens[::2], tokens[1::2]):
        try:
            table[element.capitalize()] = float(value)
        except ValueError:
            raise ValueError(f'"{value}" is not a charge (element {element}).') from None
    elements = [str(e) for e in universe.atoms.elements]
    missing = sorted(set(elements) - set(table))
    if missing:
        raise ValueError(f'No charge given for {", ".join(missing)}.')
    universe.atoms.charges = np.array([table[e] for e in elements])
    return 'typed'


@analysis('dielectric', 'mdanalysis', 'Static dielectric constant (dielectric.DielectricConstant)', category=SOFT,
          description='dielectric.DielectricConstant: ε from the fluctuations of the total dipole moment M, '
                      'ε = 1 + (⟨M²⟩ − ⟨M⟩²) / (3 ε₀ V k_B T), tin-foil boundary conditions (Neumann 1983). Needs a cell, a '
                      'neutral selection made of whole molecules and partial charges (from the file, or typed by element). '
                      'Converges slowly: use long trajectories.',
          params=[Param.selection('selection', 'Selection (neutral molecules)', 'all'),
                  Param.number('temperature', 'Temperature (K)', 300, positive=True),
                  Param.text('charges', 'Charges by element (blank = from the file)', ''),
                  Param.bool('make_whole', 'Make molecules whole across the cell', True)])
def dielectric(ctx, p):
    from MDAnalysis.analysis.dielectric import DielectricConstant
    frames, universe = ctx.universe()
    _need_cell(universe, 'The dielectric constant')
    source = _charges(universe, p['charges'])
    group = _group(universe, p['selection'], 'dielectric')
    try:
        result = DielectricConstant(group, temperature=float(p['temperature']), make_whole=bool(p['make_whole'])).run().results
    except NotImplementedError:
        raise ValueError(f'The selection is not neutral (total charge {float(group.total_charge()):.4f} e) or contains '
                         'charged molecules: select whole neutral molecules.') from None
    dipoles = []
    for _ in universe.trajectory:
        if p['make_whole']:
            group.unwrap()
        dipoles.append(group.charges @ group.positions)
    dipoles = np.asarray(dipoles)
    eps = np.asarray(result.eps, dtype=float)
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Total dipole M (e Å)',
            'series': [{'label': f'M{axis}', 'data': dipoles[:, k].tolist()} for k, axis in enumerate('xyz')],
            'table': {'columns': ['Quantity', 'Value'],
                      'rows': [['ε (mean of x, y, z)', round(float(result.eps_mean), 4)],
                               ['ε_x, ε_y, ε_z', ', '.join(f'{v:.4f}' for v in eps)],
                               ['⟨M⟩ (e Å)', ', '.join(f'{v:.4f}' for v in result.M)],
                               ['⟨M²⟩ − ⟨M⟩² (e² Å²)', ', '.join(f'{v:.4f}' for v in result.fluct)],
                               ['Charges', 'from the file' if source == 'file' else f'typed: {p["charges"]}'],
                               ['Temperature (K)', float(p['temperature'])]]},
            'notes': ['Tin-foil (conducting) boundary conditions. Check convergence: ε changes with trajectory length.']}


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


@analysis('janin', 'mdanalysis', 'Janin χ1/χ2 side-chain angles (dihedrals.Janin)', category=PROTEINS,
          description='dihedrals.Janin: side-chain χ1/χ2 of protein residues that have them (ALA, CYS, GLY, PRO, SER, THR and '
                      'VAL are skipped); needs standard atom names (e.g. a PDB topology). Angles in 0…360°.',
          params=[Param.selection('selection', 'Protein selection', 'protein')])
def janin(ctx, p):
    from MDAnalysis.analysis.dihedrals import Janin
    frames, universe = ctx.universe()
    group = _group(universe, p['selection'] if p['selection'] != 'all' else 'protein', 'protein')
    try:
        result = Janin(group.residues.atoms).run()
    except Exception as error:
        raise ValueError(f'Janin needs protein side chains with standard atom names (N, CA, CB, CG, CD…): {error}') from None
    angles = result.results.angles
    residues = [r for r in group.residues if r.resname not in ('ALA', 'CYS', 'GLY', 'PRO', 'SER', 'THR', 'VAL')
                and not r.resname.startswith('CY')][:angles.shape[1]]
    series, rows = [], []
    for k in range(angles.shape[1]):
        label = f'{residues[k].resname}{residues[k].resid}' if k < len(residues) else f'residue {k + 1}'
        chi1 = np.asarray(angles[:, k, 0], dtype=float)
        chi2 = np.asarray(angles[:, k, 1], dtype=float)
        rows.append([label, round(float(_circular(chi1)[0] % 360), 2), round(float(_circular(chi2)[0] % 360), 2)])
        if k < MAX_CURVES // 2:
            series += [{'label': f'χ1 {label}', 'data': chi1.tolist()}, {'label': f'χ2 {label}', 'data': chi2.tolist()}]
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Angle (°, 0 to 360)', 'series': series,
            'table': {'columns': ['Residue', 'Mean χ1 (°)', 'Mean χ2 (°)'], 'rows': rows},
            'notes': [f'{angles.shape[1]} residues; the first {min(MAX_CURVES // 2, angles.shape[1])} are plotted (circular means in the table).']}


HELANAL_PLOTS = {'twist': ('local_twists', 'Local twist (°)'), 'rise': ('local_heights', 'Rise per residue (Å)'),
                 'residues per turn': ('local_nres_per_turn', 'Residues per turn'),
                 'bend': ('local_bends', 'Local bend (°)'), 'tilt': ('global_tilts', 'Tilt of the helix axis from z (°)')}


@analysis('helanal', 'mdanalysis', 'Helix geometry (helix_analysis.HELANAL)', category=PROTEINS,
          description='helix_analysis.HELANAL: local twist, rise, residues per turn and bending of a helix from its Cα atoms '
                      '(one atom per residue, consecutive residues), and the tilt of the helix axis from z. The chosen '
                      'quantity is plotted as its mean over the helix in every frame.',
          params=[Param.selection('selection', 'Cα atoms of one helix', 'name CA'),
                  Param.choice('plot', 'Plot', list(HELANAL_PLOTS))])
def helanal(ctx, p):
    from MDAnalysis.analysis.helix_analysis import HELANAL
    frames, universe = ctx.universe()
    group = _group(universe, p['selection'], 'helix', 5)
    try:
        result = HELANAL(universe, select=p['selection'], flatten_single_helix=False).run().results
    except Exception as error:
        raise ValueError(f'HELANAL needs one Cα atom per residue, at least 5 consecutive residues: {error}') from None
    rows = []
    for name, (key, label) in HELANAL_PLOTS.items():
        values = np.asarray(result[key][0], dtype=float)
        per_frame = values.reshape(len(values), -1).mean(axis=1) if values.ndim > 1 else values
        rows.append([label, round(float(per_frame.mean()), 4), round(float(per_frame.std()), 4)])
    key, label = HELANAL_PLOTS[p['plot']]
    values = np.asarray(result[key][0], dtype=float)
    data = values.reshape(len(values), -1).mean(axis=1) if values.ndim > 1 else values
    return {'kind': 'series', **_frames(frames), 'yLabel': label,
            'series': [{'label': f'{p["plot"]} (mean over the helix)', 'data': data.tolist()}],
            'table': {'columns': ['Quantity', 'Mean', 'SD over frames'], 'rows': rows},
            'notes': [f'{len(group)} Cα atoms' + (f'; {len(result["global_tilts"])} helical segments, the first is shown'
                                                 if len(result['global_tilts']) > 1 else '') + '.']}


NUCLEIC_PAIRS = {'watson-crick (N1–N3)': 'WatsonCrickDist', 'minor groove (O2–C2)': 'MinorPairDist',
                 'major groove (N4–O6)': 'MajorPairDist'}


@analysis('nucleic_pairs', 'mdanalysis', 'Base-pair distances (nucleicacids)', category=NUCLEIC,
          description='nucleicacids.WatsonCrickDist, MinorPairDist and MajorPairDist: distance between the paired atoms of '
                      'each base pair (residue k of strand 1 with residue k of strand 2, the second strand read backwards '
                      'for an antiparallel duplex); needs standard nucleic-acid residue and atom names.',
          params=[Param.selection('strand1', 'Strand 1', 'nucleic and resid 1-10'), Param.selection('strand2', 'Strand 2', 'nucleic and resid 11-20'),
                  Param.choice('pair', 'Distance', list(NUCLEIC_PAIRS)), Param.bool('antiparallel', 'Read strand 2 backwards', True)])
def nucleic_pairs(ctx, p):
    from MDAnalysis.analysis import nucleicacids
    frames, universe = ctx.universe()
    strand1 = _group(universe, p['strand1'], 'first strand').residues
    strand2 = _group(universe, p['strand2'], 'second strand').residues
    if len(strand1) != len(strand2):
        raise ValueError(f'Both strands need the same number of residues ({len(strand1)} and {len(strand2)}).')
    if p['antiparallel']:
        strand2 = strand2[::-1]
    labels = [f'{a.resname}{a.resid}–{b.resname}{b.resid}' for a, b in zip(strand1, strand2)]
    # MDAnalysis tells purines from pyrimidines by the first letter of the residue name: DNA and RNA
    # names such as DA, DT5 or RG3 (PDB, AMBER) are given their base letter for this analysis.
    for residue in list(strand1) + list(strand2):
        name = str(residue.resname).upper()
        if len(name) > 1 and name[0] in 'DR' and name[1] in 'ACGTU':
            residue.resname = name[1]
    try:
        result = getattr(nucleicacids, NUCLEIC_PAIRS[p['pair']])(strand1, strand2).run().results
    except Exception as error:
        raise ValueError(f'{NUCLEIC_PAIRS[p["pair"]]} needs nucleic-acid residues with standard names (DA, DT, G, C…): {error}') from None
    distances = np.asarray(result.distances, dtype=float)
    return {'kind': 'series', **_frames(frames), 'yLabel': 'Distance (Å)',
            'series': [{'label': labels[k], 'data': distances[:, k].tolist()} for k in range(min(MAX_CURVES, len(labels)))],
            'table': {'columns': ['Base pair', 'Mean (Å)', 'SD (Å)'],
                      'rows': [[labels[k], round(float(distances[:, k].mean()), 4), round(float(distances[:, k].std()), 4)]
                               for k in range(len(labels))]},
            'notes': [f'{len(labels)} base pairs, {p["pair"]} distance' + (f'; the first {MAX_CURVES} are plotted' if len(labels) > MAX_CURVES else '') + '.']}


NUCLEIC_TORSIONS = ('alpha', 'beta', 'gamma', 'delta', 'eps', 'zeta', 'chi')


def _pucker_class(phase):
    """Sugar pucker from the pseudorotation phase (°): the ten envelope ranges of 36°."""
    names = ["C3'-endo", "C4'-exo", "O4'-endo", "C1'-exo", "C2'-endo", "C3'-exo", "C4'-endo", "O4'-exo", "C1'-endo", "C2'-exo"]
    return names[int((phase % 360) // 36)]


@analysis('nucleic_torsions', 'mdanalysis', 'Backbone torsions and sugar pucker (nuclinfo)', category=NUCLEIC,
          description='nuclinfo: backbone torsions α, β, γ, δ, ε, ζ, glycosidic χ and the Altona–Sundaralingam pseudorotation '
                      'phase of the sugar (nuclinfo.phase_as) for every residue (0…360°); needs standard (CHARMM/AMBER) atom '
                      'names. The first residue has no α; ε and ζ use the residue numbered next, so the last residue of '
                      'each strand is not meaningful. At most 60 residues.',
          params=[Param.selection('selection', 'Nucleic-acid residues', 'nucleic'),
                  Param.choice('plot', 'Plot', ['pucker'] + list(NUCLEIC_TORSIONS))])
def nucleic_torsions(ctx, p):
    from MDAnalysis.analysis import nuclinfo
    frames, universe = ctx.universe()
    residues = _group(universe, p['selection'], 'nucleic-acid').residues
    if len(residues) > 60:
        raise ValueError(f'The selection has {len(residues)} residues; choose at most 60.')
    functions = {name: getattr(nuclinfo, f'tors_{name}') for name in NUCLEIC_TORSIONS}
    functions['pucker'] = nuclinfo.phase_as
    segments = {int(r.resid): str(r.segid) for r in residues}
    values = {name: np.full((len(frames), len(residues)), np.nan) for name in functions}
    for f, _ in enumerate(universe.trajectory):
        for k, residue in enumerate(residues):
            for name, function in functions.items():
                if f and np.isnan(values[name][0, k]):
                    continue        # missing atoms (e.g. α of the first residue) stay missing
                try:
                    values[name][f, k] = float(function(universe, segments[int(residue.resid)], int(residue.resid))) % 360
                except Exception:
                    pass
    if np.all(np.isnan(values['pucker'])) and np.all(np.isnan(values['chi'])):
        raise ValueError('No nucleotide with standard atom names (P, O5\', C5\', C4\', O4\', C1\', C2\', C3\', O3\', N1/N9) was found.')
    labels = [f'{r.resname}{r.resid}' for r in residues]
    rows = []
    for k, label in enumerate(labels):
        means = [_circular(values[name][:, k])[0] % 360 for name in ('pucker',) + NUCLEIC_TORSIONS]
        row = [label] + [None if np.isnan(m) else round(float(m), 1) for m in means]
        row.insert(2, _pucker_class(means[0]) if not np.isnan(means[0]) else '')
        rows.append(row)
    shown = [k for k in range(len(labels)) if not np.all(np.isnan(values[p['plot']][:, k]))][:MAX_CURVES]
    return {'kind': 'series', **_frames(frames), 'yLabel': ('Pseudorotation phase P' if p['plot'] == 'pucker' else f'{p["plot"]}') + ' (°)',
            'series': [{'label': f'{p["plot"]} {labels[k]}', 'data': values[p['plot']][:, k].tolist()} for k in shown] or
                      [{'label': f'{p["plot"]} (not available)', 'data': [None] * len(frames)}],
            'table': {'columns': ['Residue', 'Pucker P (°)', 'Pucker', 'α', 'β', 'γ', 'δ', 'ε', 'ζ', 'χ'], 'rows': rows},
            'notes': ['Circular means over the analysed frames; blank cells lack atoms (chain ends or non-standard names).']}

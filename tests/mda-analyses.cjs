'use strict'
// MDAnalysis analyses added in 2.7.0 (monet_analyses/mdanalysis.py): every analysis is run through the
// bridge and compared with MDAnalysis called directly on the same Universe, or with a value known by
// construction (ideal helix, planar bilayer, rigid torsion, paired bases).
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

const script = String.raw`
import json, subprocess, sys, tempfile, warnings
from pathlib import Path
import numpy as np
import ase.io
from ase import Atoms
from ase.build import molecule
root = Path(sys.argv[1])
sys.path.insert(0, str(root))
warnings.filterwarnings('ignore')
import ase_bridge
folder = Path(tempfile.mkdtemp())
checks = 0
rng = np.random.default_rng(11)

def bridge(command):
    out = subprocess.run([sys.executable, str(root / 'ase_bridge.py')], input=json.dumps(command), capture_output=True, text=True)
    lines = [json.loads(l) for l in out.stdout.splitlines() if l.startswith('{')]
    return [l for l in lines if l.get('type') in ('result', 'error')][-1]

def run(name, filename, params=None, **extra):
    return bridge({'action': 'run_analysis', 'analysis': f'mdanalysis.{name}', 'filename': str(filename), 'params': params or {}, **extra})

def good(name, filename, params=None, **extra):
    r = run(name, filename, params, **extra)
    assert r.get('ok'), (name, r.get('message'))
    return r

def universe(filename):
    return ase_bridge._universe({'filename': str(filename), 'frame_step': 1})[1]

def topology(atoms, resnames, resids, names):
    atoms.new_array('resname', np.array(resnames, dtype='U8'))
    atoms.new_array('resid', np.array(resids, dtype=int))
    atoms.new_array('atomname', np.array(names, dtype='U8'))
    return atoms

# The 14 new analyses are listed in their categories, without import errors.
listed = bridge({'action': 'list_analyses'})
assert listed['ok'] and not listed['errors'], listed['errors']
specs = {a['id']: a for a in listed['analyses']}
new = {'average_structure': 'Structure and dynamics', 'bat': 'Structure and dynamics', 'interrdf_s': 'Interactions and distances',
       'hbond_lifetime': 'Interactions and distances', 'hbond_autocorrel': 'Interactions and distances',
       'water_bridges': 'Interactions and distances', 'contact_map': 'Interactions and distances',
       'leaflets': 'Membranes, polymers and dielectrics', 'persistence_length': 'Membranes, polymers and dielectrics',
       'dielectric': 'Membranes, polymers and dielectrics', 'janin': 'Proteins', 'helanal': 'Proteins',
       'nucleic_pairs': 'Nucleic acids', 'nucleic_torsions': 'Nucleic acids'}
for name, category in new.items():
    spec = specs[f'mdanalysis.{name}']
    assert spec['category'] == category and spec['available'] and spec['source'] == 'built-in', spec
checks += 1

# A periodic box of 27 waters, 25 frames with thermal noise.
L, n = 9.3, 3
waters = []
for i in range(n):
    for j in range(n):
        for k in range(n):
            w = molecule('H2O')
            w.rotate(rng.uniform(0, 360), rng.normal(size=3))
            w.translate(np.array([i, j, k]) * L / n + 1.5)
            waters.append(w)
box = waters[0]
for w in waters[1:]:
    box += w
box.set_cell([L] * 3)
box.pbc = True
frames = []
for f in range(25):
    a = box.copy()
    a.positions += rng.normal(0, 0.04, a.positions.shape)
    frames.append(a)
water = folder / 'water.extxyz'
ase.io.write(water, frames)
u = universe(water)

# Site RDF: the mean over all sites is InterRDF of the two groups; each O has its own 2 H within 1.2 Å.
from MDAnalysis.analysis import rdf as mda_rdf
r = good('interrdf_s', water, {'sites': 'element O', 'group_b': 'element H', 'rmax': 4, 'nbins': 80, 'shell': 1.2})
from MDAnalysis.analysis.rdf import InterRDF_s
oxygens, hydrogens = u.select_atoms('element O'), u.select_atoms('element H')
per_pair = np.asarray(InterRDF_s(u, [[oxygens, hydrogens]], nbins=80, range=(0, 4)).run().results.rdf[0])
site = np.array([s['data'] for s in r['series']])
assert len(site) == 12 and len(r['table']['rows']) == 27 and r['table']['atom_columns'] == [0]
assert np.allclose(site, per_pair[:12].mean(axis=1))
# The mean over all sites is InterRDF of the two groups.
direct = mda_rdf.InterRDF(oxygens, hydrogens, nbins=80, range=(0, 4)).run()
assert np.allclose(per_pair.mean(axis=(0, 1)), direct.results.rdf)
assert np.allclose([row[4] for row in r['table']['rows']], 2.0)                                  # its own 2 H within 1.2 Å
assert all(abs(row[2] - 0.975) < 0.1 for row in r['table']['rows']), r['table']['rows'][:3]    # first peak at the O–H bond
# A site that is also in the group (O with O) is not its own neighbour.
oo = good('interrdf_s', water, {'sites': 'id 1', 'group_b': 'element O', 'rmax': 4, 'nbins': 80})
assert oo['series'][0]['data'][0] == 0 and oo['table']['rows'][0][2] > 2
assert 'at most 50' in run('interrdf_s', water, {'sites': 'all'})['message']
checks += 1

# Hydrogen-bond lifetime = HydrogenBondAnalysis.lifetime on the same Universe; lags in ps from the time axis.
from MDAnalysis.analysis.hydrogenbonds import HydrogenBondAnalysis, HydrogenBondAutoCorrel, WaterBridgeAnalysis
hb = {'donors': 'element O', 'hydrogens': 'element H', 'acceptors': 'element O', 'd_a_cutoff': 3.4, 'angle': 120}
r = good('hbond_lifetime', water, {**hb, 'tau_max': 6, 'intermittency': 1}, dt=2.0)
h = HydrogenBondAnalysis(u, donors_sel='element O', hydrogens_sel='element H', acceptors_sel='element O', d_a_cutoff=3.4,
                         d_h_a_angle_cutoff=120, d_h_cutoff=1.2).run()
tau, values = h.lifetime(tau_max=6, window_step=1, intermittency=1)
assert np.allclose(r['series'][0]['data'], values) and np.allclose(r['x'], np.arange(7) * 0.002) and r['xLabel'] == 'Lag time (ps)'
assert r['table']['rows'][0][1] == len(h.results.hbonds)
assert 'shorter than' in run('hbond_lifetime', water, {**hb, 'tau_max': 25})['message']
checks += 1

# HydrogenBondAutoCorrel: same C(t) as MDAnalysis with each H paired with its bonded O.
r = good('hbond_autocorrel', water, {'dist_crit': 3.4, 'angle_crit': 120, 'window': 8, 'nruns': 2, 'nsamples': 8, 'donors': 'element O',
                                     'acceptors': 'element O'})
hs = u.select_atoms('element H')
ds = u.atoms[[next(a for a in h_.bonded_atoms if a.element == 'O').index for h_ in hs]]
ac = HydrogenBondAutoCorrel(u, hydrogens=hs, acceptors=u.select_atoms('element O'), donors=ds, bond_type='continuous', angle_crit=120,
                            dist_crit=3.4, sample_time=8 * u.trajectory.dt, nruns=2, nsamples=8, pbc=True)
ac.run()
assert np.allclose(r['series'][0]['data'], ac.solution['results']) and r['table']['rows'][0] == ['Donor–hydrogen pairs', 54]
assert r['xLabel'] == 'Time (analysed frames)' and np.isclose(r['x'][-1], ac.solution['time'][-1] / u.trajectory.dt)
checks += 1

# Water bridges: counts per frame as WaterBridgeAnalysis finds them with the same names and cutoffs.
params = {'selection1': 'resid 1', 'selection2': 'resid 14', 'water': 'not resid 1 14', 'order': 2, 'distance': 3.4, 'angle': 110}
r = good('water_bridges', water, params)
names = tuple(sorted(set(u.select_atoms('element O N').names)))
acc = tuple(sorted(set(u.select_atoms('element O N F').names)))
wb = WaterBridgeAnalysis(u, 'resid 1', 'resid 14', water_selection='not resid 1 14', order=2, distance=3.4, angle=110, donors=names,
                         acceptors=acc, distance_type='hydrogen', pbc=True).run()
assert r['series'][0]['data'] == [c for _, c in wb.count_by_time()] and r['table']['atom_columns'] == [0, 1]
checks += 1

# Contact map: fraction of frames within the cutoff, minimum image, as ASE distances give it.
r = good('contact_map', water, {'selection': 'element O', 'cutoff': 3.6})
d = np.array([a.get_all_distances(mic=True)[np.ix_(range(0, 81, 3), range(0, 81, 3))] for a in frames])
expect = (d < 3.6).mean(axis=0)
np.fill_diagonal(expect, 1)
assert np.allclose(r['matrix'], expect, atol=1e-4) and r['labels'] == list(range(1, 82, 3)) and r['xLabel'] == 'MONET atom ID'
assert 'at most 1000' not in r.get('message', '')
checks += 1

# Dielectric constant: typed charges = DielectricConstant with the same charges; a charge column in
# the file (ASE initial_charges) gives the same result; non-neutral charges are refused.
from MDAnalysis.analysis.dielectric import DielectricConstant
r = good('dielectric', water, {'charges': 'O -0.8476 H 0.4238', 'temperature': 298})
u2 = universe(water)
u2.atoms.charges = np.where(u2.atoms.elements == 'O', -0.8476, 0.4238)
eps = DielectricConstant(u2.atoms, temperature=298).run().results.eps_mean
assert abs(r['table']['rows'][0][1] - eps) < 1e-3, (r['table']['rows'][0], eps)
charged = []
for a in frames:
    a = a.copy()
    a.set_initial_charges(np.where(np.array(a.get_chemical_symbols()) == 'O', -0.8476, 0.4238))
    charged.append(a)
ase.io.write(folder / 'charged.extxyz', charged)
from_file = good('dielectric', folder / 'charged.extxyz', {'temperature': 298})
assert abs(from_file['table']['rows'][0][1] - eps) < 1e-3 and from_file['table']['rows'][4][1] == 'from the file'
assert 'no partial charges' in run('dielectric', water)['message']
assert 'not neutral' in run('dielectric', water, {'charges': 'O -1 H 0.4'})['message']
assert 'No charge given for H' in run('dielectric', water, {'charges': 'O -0.8'})['message']
checks += 1

# Average structure: MDAnalysis AverageStructure of the selection, written with its atoms only.
from MDAnalysis.analysis import align as mda_align
out = folder / 'average.extxyz'
r = good('average_structure', water, {'selection': 'element O'}, output=str(out))
avg = mda_align.AverageStructure(u, u, select='element O', ref_frame=0).run().results.universe.atoms.positions
written = ase.io.read(out)
assert len(written) == 27 and set(written.get_chemical_symbols()) == {'O'} and np.allclose(written.positions, avg, atol=1e-5)
assert r['output_file'] and len(r['series'][0]['data']) == 25 and r['table']['rows'][1] == ['Atoms', 27]
checks += 1

# BAT: ethane with one methyl group turned rigidly by 7° per frame: one primary torsion moves by 7°
# per frame, bonds and angles stay constant.
ethane = molecule('C2H6')
c0, c1 = ethane.positions[0], ethane.positions[1]
methyl = [i for i in range(2, 8) if np.linalg.norm(ethane.positions[i] - c1) < 1.3]
images = []
for f in range(12):
    a = ethane.copy()
    a.rotate(7 * f, c1 - c0, center=c1)
    a.positions[[i for i in range(len(a)) if i not in methyl]] = ethane.positions[[i for i in range(len(a)) if i not in methyl]]
    images.append(a)
ase.io.write(folder / 'ethane.xyz', images)
r = good('bat', folder / 'ethane.xyz', {'selection': 'all', 'kind': 'torsions'})
rows = r['table']['rows']
assert len(rows) == 3 * 8 - 6 and all(row[3] < 1e-3 for row in rows if row[0] in ('bond', 'angle'))
primary = [row for row in rows if row[0] == 'torsion' and row[3] > 1]
assert primary, rows
ids = [int(i) - 1 for i in primary[0][1].split('-')]
series = next(s['data'] for s in r['series'] if s['label'] == f'torsion {primary[0][1]}')
expect = [images[f].get_dihedral(*ids) for f in range(12)]
diff = (np.asarray(series) - np.asarray(expect) + 180) % 360 - 180
assert np.allclose(diff, 0, atol=1e-3), (series, expect)
assert 'one whole bonded molecule' in run('bat', water, {'selection': 'resid 1 2'})['message']
checks += 1

# Leaflets: two planes of head groups 20 Å apart that approach by 0.2 Å per frame.
images = []
grid = np.array([[i * 8, j * 8] for i in range(5) for j in range(5)], float)
for f in range(4):
    pos = np.vstack([np.c_[grid, np.full(25, 10.0 + 0.1 * f)], np.c_[grid + 4, np.full(25, 30.0 - 0.1 * f)]])
    images.append(Atoms('P50', positions=pos, cell=[40, 40, 40], pbc=True))
ase.io.write(folder / 'bilayer.extxyz', images)
r = good('leaflets', folder / 'bilayer.extxyz', {'headgroups': 'element P', 'cutoff': 10})
thickness = next(s['data'] for s in r['series'] if s['label'] == 'thickness')
assert np.allclose(thickness, [20 - 0.2 * f for f in range(4)], atol=1e-4) and [row[1] for row in r['table']['rows']] == [25, 25]
one = good('leaflets', folder / 'bilayer.extxyz', {'headgroups': 'element P', 'cutoff': 25})
assert one['kind'] == 'table' and 'Only one leaflet' in ' '.join(one['notes'])
checks += 1

# Persistence length: PersistenceLength of the same chains (each molecule one backbone, sorted by bonds).
from MDAnalysis.analysis import polymer
images = []
for f in range(5):
    pos = [[1.26 * k, 0.45 * (k % 2) + rng.normal(0, 0.06), 6 * c + rng.normal(0, 0.06)] for c in range(6) for k in range(20)]
    images.append(Atoms('C120', positions=np.array(pos) + 2))
ase.io.write(folder / 'chains.xyz', images)
r = good('persistence_length', folder / 'chains.xyz', {'selection': 'element C'})
uc = universe(folder / 'chains.xyz')
chains = [polymer.sort_backbone(frag) for frag in uc.atoms.fragments]
pl = polymer.PersistenceLength(chains).run().results
rows = dict((row[0], row[1]) for row in r['table']['rows'])
assert rows['Chains'] == 6 and rows['Backbone atoms per chain'] == 20
assert np.isclose(rows['Persistence length l_p (Å)'], pl.lp, rtol=1e-4) and np.isclose(rows['Mean bond length l_b (Å)'], pl.lb, rtol=1e-4)
assert np.allclose(r['series'][0]['data'], pl.bond_autocorrelation)
checks += 1

# HELANAL on an ideal α-helix (radius 2.3 Å, 100° and 1.5 Å per residue): twist 100°, rise 1.5 Å, 3.6 residues per turn.
images = []
k = np.arange(20)
for f in range(4):
    pos = np.c_[2.3 * np.cos(np.deg2rad(100) * k), 2.3 * np.sin(np.deg2rad(100) * k), 1.5 * k] + 10
    images.append(topology(Atoms('C20', positions=pos), ['ALA'] * 20, k + 1, ['CA'] * 20))
ase.io.write(folder / 'helix.extxyz', images)
r = good('helanal', folder / 'helix.extxyz', {'plot': 'twist'})
table = {row[0]: row[1] for row in r['table']['rows']}
assert abs(table['Local twist (°)'] - 100) < 1e-3 and abs(table['Rise per residue (Å)'] - 1.5) < 1e-3
assert abs(table['Residues per turn'] - 3.6) < 1e-3 and np.allclose(r['series'][0]['data'], 100, atol=1e-3)
checks += 1

# Janin χ1 = the N–CA–CB–CG dihedral (0…360°) of each lysine.
names = ['N', 'CA', 'C', 'O', 'CB', 'CG', 'CD', 'CE', 'NZ']
elements = ['N', 'C', 'C', 'O', 'C', 'C', 'C', 'C', 'N']
base = rng.normal(0, 1.2, (27, 3)) + np.repeat(np.arange(3) * 6.0, 9)[:, None] * [1, 0, 0] + 10
lys = topology(Atoms(elements * 3, positions=base), ['LYS'] * 27, np.repeat([1, 2, 3], 9), names * 3)
ase.io.write(folder / 'lys.extxyz', [lys, lys])
r = good('janin', folder / 'lys.extxyz')
for n_res, row in enumerate(r['table']['rows']):
    chi1 = lys.get_dihedral(9 * n_res, 9 * n_res + 1, 9 * n_res + 4, 9 * n_res + 5)
    chi2 = lys.get_dihedral(9 * n_res + 1, 9 * n_res + 4, 9 * n_res + 5, 9 * n_res + 6)
    assert row[0] == f'LYS{n_res + 1}' and abs((row[1] - chi1 + 180) % 360 - 180) < 0.05 and abs((row[2] - chi2 + 180) % 360 - 180) < 0.05, (row, chi1, chi2)
checks += 1

# Nucleic acids: DA1 DA2 paired with DT4 DT3 (PDB names); Watson–Crick N1–N3 distances by construction,
# χ and the sugar pucker as nuclinfo gives them on the same Universe.
backbone = ["P", "O5'", "C5'", "C4'", "O4'", "C3'", "O3'", "C2'", "C1'"]
purine, pyrimidine = backbone + ['N9', 'C4', 'N1'], backbone + ['N1', 'C2', 'N3']
residues = [('DA', 1, purine), ('DA', 2, purine), ('DT', 3, pyrimidine), ('DT', 4, pyrimidine)]
symbols, atom_names, resnames, resids = [], [], [], []
for resname, resid, atoms in residues:
    for name in atoms:
        symbols.append(name[0]); atom_names.append(name); resnames.append(resname); resids.append(resid)
positions = rng.normal(0, 1.5, (48, 3)) + np.repeat(np.arange(4) * 5.0, 12)[:, None] * [0, 0, 1] + 10
dna = topology(Atoms(symbols, positions=positions), resnames, resids, atom_names)
ase.io.write(folder / 'dna.extxyz', [dna, dna, dna])
r = good('nucleic_pairs', folder / 'dna.extxyz', {'strand1': 'resid 1 2', 'strand2': 'resid 3 4'})
n1 = lambda res: 12 * (res - 1) + 11
assert [row[0] for row in r['table']['rows']] == ['DA1–DT4', 'DA2–DT3']
assert np.allclose([row[1] for row in r['table']['rows']], [dna.get_distance(n1(1), n1(4)), dna.get_distance(n1(2), n1(3))], atol=1e-4)
assert 'same number of residues' in run('nucleic_pairs', folder / 'dna.extxyz', {'strand1': 'resid 1 2', 'strand2': 'resid 3'})['message']
from MDAnalysis.analysis import nuclinfo
r = good('nucleic_torsions', folder / 'dna.extxyz', {'selection': 'resid 1-4', 'plot': 'chi'})
ud = universe(folder / 'dna.extxyz')
for n_res, row in enumerate(r['table']['rows']):
    assert np.isclose(row[1], round(nuclinfo.phase_as(ud, 'SYSTEM', n_res + 1) % 360, 1), atol=0.11)
    assert np.isclose(row[9], round(nuclinfo.tors_chi(ud, 'SYSTEM', n_res + 1) % 360, 1), atol=0.11)
assert r['table']['rows'][0][3] is None and r['table']['rows'][3][7] is None       # no α for the first residue, no ε at the end
assert len(r['series']) == 4 and r['yLabel'] == 'chi (°)'
checks += 1

# PCA table has the cosine content (pca.cosine_content) of each component; GNM offers the close-contact model.
from MDAnalysis.analysis import gnm as mda_gnm
r = good('pca', water, {'selection': 'element O'})
assert r['table']['columns'][3] == 'Cosine content' and all(0 <= row[3] <= 1 for row in r['table']['rows'])
r = good('gnm', water, {'selection': 'element O', 'model': 'closeContactGNMAnalysis', 'cutoff': 4.5})
g = mda_gnm.closeContactGNMAnalysis(u, select='element O', cutoff=4.5).run()
assert np.allclose(r['series'][0]['data'], np.asarray(g.results.eigenvalues, dtype=float))
checks += 1

print(f'PASS: {checks} MDAnalysis analysis checks (site RDF, H-bond lifetimes, water bridges, contact map, dielectric, '
      'average structure, BAT, leaflets, persistence length, HELANAL, Janin, nucleic acids, PCA cosine content, GNM).')
`
process.stdout.write(execFileSync(process.env.PYTHON || 'python3', ['-c', script, root], { encoding: 'utf8', maxBuffer: 1 << 26 }))

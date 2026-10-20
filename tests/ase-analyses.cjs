'use strict'
// ASE › More analyses (monet_analyses/ase.py): every analysis is run through the bridge and compared
// with ASE called directly, or with a value known by construction.
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

const script = String.raw`
import json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
import ase.io
from ase import Atoms, units
from ase.build import bulk, molecule
from ase.calculators.singlepoint import SinglePointCalculator
root = Path(sys.argv[1])
sys.path.insert(0, str(root))
folder = Path(tempfile.mkdtemp())
checks = 0
rng = np.random.default_rng(7)

def bridge(command):
    out = subprocess.run([sys.executable, str(root / 'ase_bridge.py')], input=json.dumps(command), capture_output=True, text=True)
    lines = [json.loads(l) for l in out.stdout.splitlines() if l.startswith('{')]
    return [l for l in lines if l.get('type') in ('result', 'error')][-1]

def run(name, filename, params=None, **extra):
    return bridge({'action': 'run_analysis', 'analysis': f'ase.{name}', 'filename': str(filename), 'params': params or {}, **extra})

def good(name, filename, params=None, **extra):
    r = run(name, filename, params, **extra)
    assert r.get('ok'), (name, r.get('message'))
    return r

def curve(r, label):
    return np.array(next(s['data'] for s in r['series'] if s['label'] == label), dtype=float)

# Every ASE analysis is listed under its category, with no import error.
listed = bridge({'action': 'list_analyses'})
assert listed['ok'] and not listed['errors'], listed['errors']
ase_ids = [a['id'] for a in listed['analyses'] if a['engine'] == 'ase' and a['source'] == 'built-in']
expected = ['diffusion', 'stored_properties', 'bond_types', 'molecules', 'bond_events', 'rdf', 'space_group',
            'dimensionality', 'layers', 'xrd', 'saxs', 'lattice', 'supercell']
assert ase_ids == [f'ase.{n}' for n in expected], ase_ids
assert all(a['category'] for a in listed['analyses'] if a['id'] in ase_ids)
checks += 1

# Diffusion: a random walk with step σ per axis has D = σ² / (2 Δt); a subset of one element gives the same D.
n, steps, dt, sigma = 60, 400, 2.0, 0.05
walk = np.cumsum(rng.normal(0, sigma, (steps, n, 3)), axis=0)
walk[0] = 0
symbols = ['Ar'] * 40 + ['Ne'] * 20
ase.io.write(folder / 'walk.xyz', [Atoms(symbols, positions=p + 5) for p in walk])
expect = sigma ** 2 / (2 * dt) * 0.1 * 1e5          # 10⁻⁵ cm²/s
r = good('diffusion', folder / 'walk.xyz', {'segments': 4}, dt=dt)
rows = {row[0]: row for row in r['table']['rows']}
assert abs(rows['Ar'][2] / expect - 1) < 0.15 and abs(rows['Ne'][2] / expect - 1) < 0.2, (rows, expect)
assert r['kind'] == 'profile' and r['xLabel'] == 'Time (ps)' and len(r['x']) == steps // 4
half = good('diffusion', folder / 'walk.xyz', {'segments': 4, 'indices': list(range(20))}, dt=dt)
assert abs(half['table']['rows'][0][2] / expect - 1) < 0.2 and half['table']['rows'][0][1] == 20, half['table']
molecule_d = good('diffusion', folder / 'walk.xyz', {'molecule': True}, dt=dt)
assert molecule_d['table']['rows'][0][0] == 'centre of mass'
assert 'time axis' in run('diffusion', folder / 'walk.xyz')['message']
assert 'at least 3' in run('diffusion', folder / 'walk.xyz', {'segments': 100, 'skip': 300}, dt=dt)['message']
checks += 1

# Values stored in the file: energy, forces, momenta and stress exactly as written; CP2K energies in hartree.
images = []
for k in range(5):
    a = molecule('H2O', cell=[8, 8, 8], pbc=True)
    a.set_momenta(rng.normal(0, 1, (3, 3)))
    forces = rng.normal(0, 1, (3, 3))
    a.calc = SinglePointCalculator(a, energy=-10.0 - k, forces=forces, stress=np.array([0.01, 0.02, 0.03, 0, 0, 0]) * (k + 1))
    images.append(a)
ase.io.write(folder / 'stored.extxyz', images, format='extxyz')
r = good('stored_properties', folder / 'stored.extxyz', {'quantity': 'potential energy'})
assert np.allclose(curve(r, 'Potential energy'), [-10, -11, -12, -13, -14]) and r['yLabel'] == 'Potential energy (eV)'
r = good('stored_properties', folder / 'stored.extxyz', {'quantity': 'forces'})
norms = [np.linalg.norm(a.get_forces(), axis=1) for a in images]
assert np.allclose(curve(r, 'Largest |F|'), [v.max() for v in norms], atol=1e-6)
assert np.allclose(curve(r, 'RMS |F|'), [np.sqrt(np.mean(v ** 2)) for v in norms], atol=1e-6)
r = good('stored_properties', folder / 'stored.extxyz', {'quantity': 'kinetic temperature'})
assert np.allclose(curve(r, 'Kinetic temperature'), [a.get_temperature() for a in images], rtol=1e-6)
r = good('stored_properties', folder / 'stored.extxyz', {'quantity': 'pressure'}, frame_step=2)
assert r['x'] == [0, 2, 4] and np.allclose(curve(r, 'Pressure'), [-0.02 * m / units.GPa for m in (1, 3, 5)], rtol=1e-6)
(folder / 'cp2k.xyz').write_text(''.join(f'3\n i = {k}, time = {k * 0.5:.3f}, E = {-17.5 + k * 0.001:.10f}\n'
                                         'O 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n' for k in range(3)))
r = good('stored_properties', folder / 'cp2k.xyz', {'quantity': 'potential energy'})
assert np.allclose(curve(r, 'Potential energy'), [(-17.5 + k * 0.001) * units.Hartree for k in range(3)])
missing = run('stored_properties', folder / 'cp2k.xyz', {'quantity': 'forces'})
assert not missing['ok'] and 'stores no forces' in missing['message'] and 'potential energy' in missing['message'], missing
checks += 1

# Bonds, angles and dihedrals by type: the values of ASE's own getters in every frame.
ethane = []
for k in range(6):
    a = molecule('C2H6')
    a.positions += rng.normal(0, 0.02, a.positions.shape)
    ethane.append(a)
ase.io.write(folder / 'ethane.xyz', ethane)
r = good('bond_types', folder / 'ethane.xyz', {'kind': 'bonds', 'show': 'mean along the trajectory'})
ch = [np.mean([a.get_distance(0, j) for j in (2, 3, 4)] + [a.get_distance(1, j) for j in (5, 6, 7)]) for a in ethane]
assert np.allclose(curve(r, 'C–H'), ch, atol=1e-9) and np.allclose(curve(r, 'C–C'), [a.get_distance(0, 1) for a in ethane])
rows = {row[0]: row for row in r['table']['rows']}
assert rows['C–H (6)'][1] == 36 and rows['C–C (1)'][1] == 6, rows
r = good('bond_types', folder / 'ethane.xyz', {'kind': 'dihedrals', 'elements': 'H-C-C-H', 'show': 'mean along the trajectory'})
dihedrals = [np.mean([a.get_dihedral(h1, 0, 1, h2) for h1 in (2, 3, 4) for h2 in (5, 6, 7)]) for a in ethane]
assert np.allclose(curve(r, 'H–C–C–H'), dihedrals, atol=1e-6) and r['table']['rows'][0][0] == 'H–C–C–H (9)'
r = good('bond_types', folder / 'ethane.xyz', {'kind': 'angles', 'bins': 20})
assert r['kind'] == 'profile' and len(r['x']) == 20 and {s['label'] for s in r['series']} == {'C–C–H', 'H–C–H'}
bad = run('bond_types', folder / 'ethane.xyz', {'kind': 'angles', 'elements': 'C-H'})
assert 'needs 3 element symbols' in bad['message'], bad
checks += 1

# Molecules and bond events: a proton moves from one water to the other at frame 4 (and flickers at frame 1).
pair = molecule('H2O') + molecule('H2O')
pair.positions[3:] += [2.8, 0, 0]
frames = []
for k in range(8):
    a = pair.copy()
    moved = k >= 4 or k == 1
    if moved:
        a.positions[1] = a.positions[3] + [-1.0, 0.0, 0.0]
    frames.append(a)
ase.io.write(folder / 'transfer.xyz', frames)
r = good('molecules', folder / 'transfer.xyz')
assert list(curve(r, 'H2O')) == [2, 0, 2, 2, 0, 0, 0, 0] and list(curve(r, 'H3O')) == [0, 1, 0, 0, 1, 1, 1, 1], r['series']
assert list(curve(r, 'all molecules')) == [2] * 8
species = {row[0]: row for row in r['table']['rows']}
assert species['HO'][5] == 1 and species['H3O'][4] == 62.5, species
r = good('bond_events', folder / 'transfer.xyz', {'hold': 1})
assert list(curve(r, 'formed')) == list(curve(r, 'broken')) == [0, 1, 1, 0, 1, 0, 0, 0]
r = good('bond_events', folder / 'transfer.xyz', {'hold': 3})
assert list(curve(r, 'formed')) == [0, 0, 0, 0, 1, 0, 0, 0] and list(curve(r, 'broken')) == [0, 0, 0, 0, 1, 0, 0, 0]
events = {(row[1], row[2], row[3]) for row in r['table']['rows']}
assert events == {('formed', 1, 3), ('broken', 0, 1)} and r['table']['atom_columns'] == [2, 3], r['table']
assert r['table']['rows'][0][0] == 4
checks += 1

# RDF: ase.geometry.rdf.get_rdf averaged over the frames; a cell too small for r_max is refused with a message.
from ase.geometry.rdf import get_rdf
liquid = []
for k in range(4):
    a = bulk('NaCl', 'rocksalt', a=5.64, cubic=True) * (2, 2, 2)
    a.rattle(0.1, seed=k)
    liquid.append(a)
ase.io.write(folder / 'nacl.extxyz', liquid, format='extxyz')
r = good('rdf', folder / 'nacl.extxyz', {'rmax': 5.0, 'nbins': 50, 'elements': 'Na-Cl'})
reference, distances = get_rdf(liquid, 5.0, 50, elements=('Na', 'Cl'))
assert np.allclose(r['x'], distances) and np.allclose(curve(r, 'g(r) Na–Cl'), reference)
assert abs(r['table']['rows'][0][1] - 2.82) < 0.15, r['table']
assert 'not large enough' in run('rdf', folder / 'nacl.extxyz', {'rmax': 7.0})['message']
assert 'No F atoms' in run('rdf', folder / 'nacl.extxyz', {'rmax': 5.0, 'elements': 'Na-F'})['message']
assert 'cell' in run('rdf', folder / 'ethane.xyz', {'rmax': 3.0})['message']
checks += 1

# Space group (spglib), Bravais lattice, Niggli cell, layers and dimensionality of known crystals.
copper = bulk('Cu', 'fcc', a=3.61)
shaken = bulk('Cu', 'fcc', a=3.61, cubic=True) * (2, 2, 2)
cubes = [bulk('Cu', 'fcc', a=3.61, cubic=True) * (2, 2, 2) for _ in range(2)]
shaken.rattle(0.2, seed=1)
ase.io.write(folder / 'copper.extxyz', cubes + [shaken], format='extxyz')
ase.io.write(folder / 'primitive.extxyz', [copper, copper], format='extxyz')
r = good('space_group', folder / 'copper.extxyz', {'symprec': 0.01})
assert curve(r, 'Space group number').tolist() == [225, 225, 1] and r['table']['rows'][0][:3] == ['Fm-3m', 225, 2]
checks += 1
r = good('lattice', folder / 'primitive.extxyz')
assert r['table']['rows'][0][0].startswith('FCC') and np.allclose(curve(r, 'a'), 3.61 / np.sqrt(2)), r
r = good('lattice', folder / 'primitive.extxyz', {'quantity': 'reduced angles'})
assert np.allclose(curve(r, 'α'), 60) and np.allclose(curve(r, 'γ'), 60)
r = good('layers', folder / 'copper.extxyz', {'tolerance': 0.3}, frame_step=2)
assert r['x'] == [0, 2] and curve(r, 'Layers')[0] == 4, r['series']  # frame 2 is shaken: its layers may split
assert [row[2] for row in r['table']['rows']] == [8, 8, 8, 8] and abs(r['table']['rows'][1][1] - 1.805) < 1e-6
assert 'Miller' in run('layers', folder / 'copper.extxyz', {'miller': '0 0 0'})['message']
r = good('dimensionality', folder / 'copper.extxyz')
assert r['table']['rows'][0][0] == '3D' and curve(r, '3D components').tolist() == [1, 1, 1]
box = Atoms(cell=[6.2] * 3, pbc=True)
for x in range(2):
    for y in range(2):
        for z in range(2):
            box += Atoms(molecule('H2O').symbols, positions=molecule('H2O').positions + [3.1 * x + 1, 3.1 * y + 1, 3.1 * z + 1])
ase.io.write(folder / 'ice.extxyz', [box, box], format='extxyz')
r = good('dimensionality', folder / 'ice.extxyz', {'method': 'TSA'})
assert r['table']['rows'][0][0] == '0D' and curve(r, '0D components').tolist() == [8, 8], r['table']
assert 'no k-interval' in run('dimensionality', folder / 'stored.extxyz')['message']
checks += 1

# XRD and SAXS: the Debye formula of ase.utils.xrdebye.XrDebye, averaged over the frames.
from ase.cluster import Icosahedron
from ase.utils.xrdebye import XrDebye
particles = []
for k in range(3):
    c = Icosahedron('Au', 3)
    c.rattle(0.05, seed=k)
    c += Atoms('O', positions=[[7.0, 0.0, 0.1 * k]])
    particles.append(c)
ase.io.write(folder / 'particle.xyz', particles)
for name, mode, low, high in (('xrd', 'XRD', 20.0, 80.0), ('saxs', 'SAXS', 0.05, 2.0)):
    r = good(name, folder / 'particle.xyz', {'start': low, 'stop': high, 'points': 40})
    x = np.linspace(low, high, 40)
    reference = np.mean([XrDebye(c, wavelength=1.5406).calc_pattern(x, mode=mode) for c in particles], axis=0)
    got = np.array(r['series'][0]['data'])
    assert np.allclose(r['x'], x) and np.max(np.abs(got - reference)) < 2e-3 * reference.max(), (name, np.max(np.abs(got - reference)))
assert 'larger than its start' in run('xrd', folder / 'particle.xyz', {'start': 50.0, 'stop': 40.0})['message']
checks += 1

# Supercell: a trajectory of the repeated cells, copy c of atom i at index c·N + i, lattice scaled.
out = folder / 'copper-supercell.extxyz'
r = good('supercell', folder / 'primitive.extxyz', {'na': 2, 'nb': 3, 'nc': 1}, output=str(out))
assert r['output_file'] and r['trajectory'] and r['table']['rows'][2] == ['Atoms per frame', 6]
written = ase.io.read(out, ':')
assert len(written) == 2 and len(written[0]) == 6 and written[0].info['source_frame'] == 0
assert np.allclose(written[0].cell.array, np.diag([2, 3, 1]) @ copper.cell.array)
assert np.allclose(written[0].positions[1], copper.positions[0] + copper.cell.array[1])
assert 'choose where' in run('supercell', folder / 'primitive.extxyz')['message']
checks += 1

print(checks)
`

const out = execFileSync(process.env.PYTHON || 'python3', ['-c', script, root], { encoding: 'utf8', maxBuffer: 1 << 26 })
const checks = Number(out.trim().split('\n').pop())
console.log(`PASS: ${checks} ASE analysis checks (diffusion, stored values, bond types, molecules, bond events, RDF, symmetry, lattice, layers, dimensionality, XRD/SAXS, supercell).`)

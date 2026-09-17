'use strict'
// Numerical checks of the new analyses against synthetic trajectories with known answers.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const python = process.env.PYTHON || 'python3'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monet-analysis-'))
let checks = 0
const bridge = command => {
  const out = execFileSync(python, [path.join(root, 'ase_bridge.py')], { input: JSON.stringify(command), env: { ...process.env, MONET_CACHE_DIR: path.join(temp, 'cache') }, maxBuffer: 1 << 28 }).toString()
  return JSON.parse(out.trim().split('\n').pop())
}
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b} (tol ${tol})`)

// Synthetic trajectories generated with a fixed seed.
execFileSync(python, ['-c', `
import sys, numpy as np
out = sys.argv[1]
rng = np.random.default_rng(7)
def write(name, symbols, frames, cell=None):
    with open(f'{out}/{name}', 'w') as fh:
        for k, pos in enumerate(frames):
            head = f'Properties=species:S:1:pos:R:3 frame={k}'
            if cell is not None:
                head = 'Lattice="' + ' '.join(f'{v:.10f}' for v in np.ravel(cell)) + '" ' + head + ' pbc="T T T"'
            fh.write(f'{len(symbols)}\\n{head}\\n')
            fh.write(''.join(f'{s} {x:.10f} {y:.10f} {z:.10f}\\n' for s, (x, y, z) in zip(symbols, pos)))
# 1) rigid rotation + translation of a molecule
mol = rng.normal(size=(6, 3))
frames = []
for k in range(5):
    a = 0.4 * k
    R = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
    frames.append(mol @ R.T + [k, 2 * k, -k])
write('rigid.xyz', ['C'] * 6, frames)
# 2) simple cubic lattice (a = 2 A) in a 10 A box with thermal noise
grid = np.array([[i, j, k] for i in range(5) for j in range(5) for k in range(5)], float) * 2.0
write('lattice.xyz', ['Ar'] * len(grid), [grid + rng.normal(0, .03, grid.shape) for _ in range(20)], np.eye(3) * 10)
# 3) Brownian particles in a periodic box (wrapped output): D = sigma^2 / (2 dt)
n, steps, sigma = 40, 3000, 0.05
path = rng.uniform(0, 8, (1, n, 3)) + np.cumsum(rng.normal(0, sigma, (steps, n, 3)), axis=0)
write('brownian.xyz', ['O'] * n, np.mod(path, 8.0), np.eye(3) * 8)
# 4) diatomic vibrating at 1000 cm^-1 sampled every 0.5 fs
t = np.arange(4000) * 0.5
omega = 2 * np.pi * 1000 * 2.99792458e10 * 1e-15
bond = 1.1 + 0.02 * np.cos(omega * t)
write('diatomic.xyz', ['C', 'O'], [[[0, 0, 0], [0, 0, b]] for b in bond])
# 5) torsion following an Ornstein-Uhlenbeck process with tau = 40 fs around 90 deg (dt = 1 fs)
tau, dt, N = 40.0, 1.0, 20000
theta = np.zeros(N); theta[0] = 90
for i in range(1, N):
    theta[i] = 90 + (theta[i - 1] - 90) * np.exp(-dt / tau) + 15 * np.sqrt(1 - np.exp(-2 * dt / tau)) * rng.normal()
frames = []
for th in np.radians(theta):
    frames.append([[1, 0, 0], [0, 0, 0], [0, 0, 1.5], [np.cos(th), np.sin(th), 1.5]])
write('torsion-ou.xyz', ['C', 'C', 'C', 'C'], frames)
# 6) six rigid waters scattered around a triclinic cell (molecules partly outside it)
from ase.geometry import cellpar_to_cell
cellw = cellpar_to_cell([10.3528, 13.029, 21.211, 96.2968, 97.439, 98.371])
wat = np.array([[0, 0, 0], [0.957, 0, 0], [-0.24, 0.927, 0]])
origins = rng.uniform(-12, 30, (6, 3))
write('waters.xyz', ['O', 'H', 'H'] * 6, [np.concatenate([wat + o + 0.2 * f for o in origins]) for f in range(3)])
# The same torsion, randomly flipped by 180 deg in each frame (equivalent orientations of a symmetric group).
flips = np.radians(theta + 180 * rng.integers(0, 2, len(theta)))
write('torsion-flip.xyz', ['C', 'C', 'C', 'C'], [[[1, 0, 0], [0, 0, 0], [0, 0, 1.5], [np.cos(th), np.sin(th), 1.5]] for th in flips])
`, temp])

// Kabsch: rigid motion has zero aligned RMSD but a large raw RMSD.
let r = bridge({ action: 'rmsd', filename: path.join(temp, 'rigid.xyz'), align: true })
assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(Math.max(...r.rmsd) < 1e-6); checks++
r = bridge({ action: 'rmsd', filename: path.join(temp, 'rigid.xyz'), align: false })
assert.ok(r.rmsd[4] > 5); checks++
r = bridge({ action: 'rmsd', filename: path.join(temp, 'rigid.xyz'), reference_index: 2, frame_step: 2 })
assert.equal(r.rmsd[1], 0); checks++
r = bridge({ action: 'rmsd', filename: path.join(temp, 'rigid.xyz'), reference_index: 1, frame_step: 2 })
assert.equal(r.ok, false); assert.match(r.message, /reference frame/); checks++
r = bridge({ action: 'rmsd_matrix', filename: path.join(temp, 'rigid.xyz'), align: false })
assert.equal(r.matrix.length, 5); assert.equal(r.matrix[2][2], 0); assert.equal(r.matrix[1][3], r.matrix[3][1]); assert.ok(r.matrix[0][4] > 5); checks++
r = bridge({ action: 'rmsd_matrix', filename: path.join(temp, 'rigid.xyz'), align: true, max_frames: 3 })
assert.equal(r.matrix.length, 3); assert.equal(r.truncated, true); assert.ok(Math.max(...r.matrix.flat()) < 1e-6); checks++

// RDF: simple cubic first shell at 2 A with 6 neighbours; g -> ~1 is not expected for a crystal, but n(r) is exact.
r = bridge({ action: 'rdf', filename: path.join(temp, 'lattice.xyz'), rmax: 3.5, nbins: 70 })
assert.equal(r.ok, true, JSON.stringify(r))
const inner = r.g.map((g, i) => r.r[i] < 2.4 ? g : 0)
const peak = r.r[inner.indexOf(Math.max(...inner))]
near(peak, 2.0, 0.05, 'first peak'); checks++
near(r.n[r.r.findIndex(x => x > 2.4)], 6, 0.05, 'first-shell coordination'); checks++
near(r.n[r.r.findIndex(x => x > 3.0)], 18, 0.05, 'second-shell coordination'); checks++
r = bridge({ action: 'rdf', filename: path.join(temp, 'lattice.xyz'), rmax: 6 })
assert.equal(r.ok, false); assert.match(r.message, /half the smallest cell width \(5\.000/); checks++
r = bridge({ action: 'rdf', filename: path.join(temp, 'rigid.xyz') })
assert.equal(r.ok, false); assert.match(r.message, /periodic cell/); checks++
// Ideal gas: g(r) ~ 1 on average.
r = bridge({ action: 'rdf', filename: path.join(temp, 'brownian.xyz'), frame_step: 30, rmax: 4, nbins: 20 })
near(r.g.slice(5).reduce((a, b) => a + b, 0) / 15, 1, 0.08, 'ideal-gas g(r)'); checks++

// MSD / diffusion of wrapped Brownian motion: D = 0.05^2 / (2 * 1 fs) = 1.25e-3 A^2/fs.
r = bridge({ action: 'msd', filename: path.join(temp, 'brownian.xyz'), dt: 1, fit_start: 50, fit_end: 800, remove_drift: false })
assert.equal(r.ok, true, JSON.stringify(r))
near(r.fits.selection.D_A2_fs, 1.25e-3, 1.25e-4, 'diffusion'); checks++
near(r.fits.selection.D_cm2_s, 1.25e-4, 1.25e-5, 'diffusion cm2/s'); checks++
near(r.series.selection[10], 6 * 1.25e-3 * 10, 0.02, 'MSD(10 fs)'); checks++
r = bridge({ action: 'msd', filename: path.join(temp, 'brownian.xyz'), dt: 1, frame_step: 20, fit_start: 100, fit_end: 1500 })
near(r.fits.selection.D_A2_fs, 1.25e-3, 2.5e-4, 'diffusion with frame step'); assert.equal(r.dt, 20); checks++
r = bridge({ action: 'msd', filename: path.join(temp, 'brownian.xyz'), dt: 0 })
assert.equal(r.ok, false); assert.match(r.message, /dt must be a positive/); checks++

// Unwrapping produces continuous paths; the downloadable copy keeps the lattice.
r = bridge({ action: 'unwrap', filename: path.join(temp, 'brownian.xyz'), output: path.join(temp, 'unwrapped.xyz'), frame_step: 1 })
assert.equal(r.ok, true, JSON.stringify(r))
const unwrapped = bridge({ action: 'bonds', filename: path.join(temp, 'unwrapped.xyz'), pairs: [[0, 1]], frame_step: 1000 })
assert.equal(unwrapped.ok, true); checks++
const firstLines = fs.readFileSync(path.join(temp, 'unwrapped.xyz'), 'utf8').split('\n')
assert.match(firstLines[1], /Lattice="8\.0000000000 .*unwrapped=T/); checks++

// VDOS of a diatomic vibrating at 1000 cm^-1.
r = bridge({ action: 'vdos', filename: path.join(temp, 'diatomic.xyz'), dt: 0.5, max_cm: 3000 })
assert.equal(r.ok, true, JSON.stringify(r))
near(r.wavenumber[r.intensity.indexOf(Math.max(...r.intensity))], 1000, 2 * r.resolution_cm, 'VDOS peak'); checks++
near(r.wavenumber.at(-1), 3000, r.resolution_cm, 'VDOS range'); checks++

// Autocorrelation of a torsion with tau = 40 fs (the user supplies dt; nothing is hard-coded).
r = bridge({ action: 'acf', filename: path.join(temp, 'torsion-ou.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, max_lag: 300 })
assert.equal(r.ok, true, JSON.stringify(r).slice(0, 500))
near(r.tau_fit, 40, 6, 'tau fit'); near(r.tau_int, 40, 8, 'tau integral'); checks++
assert.equal(r.acf[0], 1); assert.equal(r.lags.length, 301); assert.equal(r.fit_curve.length, 301); checks++
near(r.statistics[0].mean, 90, 2, 'circular mean'); near(r.statistics[0].std, 15, 1.5, 'std'); checks++
assert.ok(r.n_effective < r.n_frames / 20); checks++
const area = r.distribution.density.reduce((a, b) => a + b, 0) * (r.distribution.x[1] - r.distribution.x[0])
near(area, 1, 1e-9, 'distribution normalisation'); checks++
// Same series analysed with dt in atomic units (1 a.u. = 0.0241888 fs) scales tau accordingly.
const au = 0.02418884326585747
const r2 = bridge({ action: 'acf', filename: path.join(temp, 'torsion-ou.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: au, max_lag: 300 * au })
near(r2.tau_fit / au, r.tau_fit, 1e-6 * r.tau_fit, 'unit scaling'); checks++
// Frame step: tau stays physical, the lag spacing grows.
const r3 = bridge({ action: 'acf', filename: path.join(temp, 'torsion-ou.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, frame_step: 5, max_lag: 300 })
near(r3.tau_fit, 40, 7, 'tau with frame step'); assert.equal(r3.lags[1], 5); checks++
const circ = bridge({ action: 'acf', filename: path.join(temp, 'torsion-ou.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, mode: 'circular', max_lag: 200, fit_until: 'efold' })
assert.equal(circ.ok, true); near(circ.tau_fit, 40, 8, 'circular tau (mean-removed unit vector)'); assert.ok(Math.abs(circ.acf[200]) < 0.3, 'circular ACF decays'); checks++
// Default lag range: half of the run.
const half = bridge({ action: 'acf', filename: path.join(temp, 'torsion-ou.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1 })
assert.equal(half.lags.length - 1, Math.floor(half.n_frames / 2)); checks++
// Folded dihedrals: 180° flips are ignored with period 180 and destroy the 0–360 correlation.
const folded = bridge({ action: 'acf', filename: path.join(temp, 'torsion-flip.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, max_lag: 300, angle_range: 'fold180' })
assert.equal(folded.ok, true, JSON.stringify(folded).slice(0, 300)); near(folded.tau_fit, 40, 6, 'folded tau'); near(folded.statistics[0].mean, 90, 2, 'folded mean'); assert.equal(folded.period, 180); checks++
assert.ok(folded.distribution.x.at(-1) < 180); checks++
const foldedCirc = bridge({ action: 'acf', filename: path.join(temp, 'torsion-flip.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, max_lag: 300, angle_range: 'fold180', mode: 'circular' })
near(foldedCirc.tau_fit, 40, 8, 'folded circular tau'); checks++
const unfolded = bridge({ action: 'acf', filename: path.join(temp, 'torsion-flip.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, max_lag: 300, mode: 'circular' })
assert.ok(unfolded.tau_fit < 5, `flips decorrelate the 0–360° series: ${unfolded.tau_fit}`); checks++
const bondAcf = bridge({ action: 'acf', filename: path.join(temp, 'diatomic.xyz'), quantity: 'bond', groups: [[0, 1]], dt: 0.5, max_lag: 100 })
near(bondAcf.acf[Math.round(1e15 / (1000 * 2.99792458e10) / 0.5)], 1, 0.02, 'periodic bond ACF'); checks++
for (const bad of [{ quantity: 'volume' }, { groups: [[0, 1]] }, { mode: 'circular', quantity: 'bond', groups: [[0, 1]] }, { dt: -1 }, { groups: [[0, 0, 1, 2]] }]) {
  const result = bridge({ action: 'acf', filename: path.join(temp, 'torsion-ou.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, ...bad })
  assert.equal(result.ok, false, JSON.stringify(bad)); assert.ok(!/Traceback/.test(result.message), result.message); checks++
}

// Fit with an asymptotic plateau: C(t) = (1 − c) exp(−t/τ) + c.
const plateauFit = JSON.parse(execFileSync(python, ['-c', `
import json, sys, numpy as np
sys.path.insert(0, sys.argv[1])
import monet_analysis
t = np.arange(0, 300.0)
acf = 0.7 * np.exp(-t / 20) + 0.3 + 0.002 * np.sin(t)
print(json.dumps(monet_analysis.correlation_time(t, acf, 'all', 'exp_offset')))
`, root]).toString())
near(plateauFit.tau_fit, 20, 0.2, 'offset tau'); near(plateauFit.plateau, 0.3, 0.005, 'plateau c'); assert.equal(plateauFit.fit_model, 'exp_offset'); checks++
r = bridge({ action: 'acf', filename: path.join(temp, 'torsion-ou.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, max_lag: 300, fit_model: 'exp_offset', fit_until: 'all' })
assert.equal(r.ok, true); near(r.tau_fit, 40, 8, 'offset tau on OU'); assert.ok(Math.abs(r.plateau) < 0.1); near(r.fit_curve.at(-1), r.plateau + (1 - r.plateau) * Math.exp(-300 / r.tau_fit), 1e-9, 'curve uses the plateau'); checks++
assert.equal(bridge({ action: 'acf', filename: path.join(temp, 'torsion-ou.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, fit_model: 'cubic' }).ok, false); checks++
// Uncorrelated configurations: every stride-th frame, copied verbatim, source frame recorded.
r = bridge({ action: 'subsample', filename: path.join(temp, 'waters.xyz'), output: path.join(temp, 'sub.xyz'), stride: 2 })
assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.n_frames, 2); assert.equal(r.last, 2); checks++
const subLines = fs.readFileSync(path.join(temp, 'sub.xyz'), 'utf8').split('\n')
const srcLines = fs.readFileSync(path.join(temp, 'waters.xyz'), 'utf8').split('\n')
assert.match(subLines[1], /source_frame=0$/); assert.match(subLines[21], /frame=2 source_frame=2$/); assert.equal(subLines[22], srcLines[42]); checks++
assert.equal(bridge({ action: 'scan', filename: path.join(temp, 'sub.xyz') }).configCount, 2); checks++
// Subsampling a subsample keeps the index of the original trajectory (frame 1 of sub.xyz is frame 2).
r = bridge({ action: 'subsample', filename: path.join(temp, 'sub.xyz'), output: path.join(temp, 'sub2.xyz'), stride: 1 })
assert.equal(r.ok, true, JSON.stringify(r)); assert.match(fs.readFileSync(path.join(temp, 'sub2.xyz'), 'utf8').split('\n')[21], /frame=2 source_frame=2$/); checks++
for (const bad of [{ stride: 0 }, { stride: 1.5 }, { stride: 3 }, { stride: 1, start: 9 }]) {
  r = bridge({ action: 'subsample', filename: path.join(temp, 'waters.xyz'), output: path.join(temp, 'bad.xyz'), ...bad })
  assert.equal(r.ok, false, JSON.stringify(bad))
}
assert.match(bridge({ action: 'subsample', filename: path.join(temp, 'waters.xyz'), output: path.join(temp, 'bad.xyz'), stride: 3 }).message, /shorter than the decorrelation time/); checks++

// Wrapping into a triclinic cell: whole molecules keep their bonds, atoms end up inside the cell.
const cellpar = [10.3528, 13.029, 21.211, 96.2968, 97.439, 98.371]
r = bridge({ action: 'wrap', filename: path.join(temp, 'waters.xyz'), output: path.join(temp, 'wrapped.xyz'), cell: cellpar, pbc: [true, true, true], mode: 'molecules', center: [0, 1, 2] })
assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.n_molecules, 6); assert.equal(r.n_frames, 3); checks++
const check = execFileSync(python, ['-c', `
import sys, json, numpy as np
from ase.io import read
out = []
for a in read(sys.argv[1], ':'):
    f = a.get_scaled_positions(wrap=False).reshape(6, 3, 3).mean(axis=1)
    out.append({'inside': bool(((f >= 0) & (f < 1)).all()), 'oh': [a.get_distance(3 * m, 3 * m + 1) for m in range(6)], 'centre': f[0].tolist()})
print(json.dumps(out))
`, path.join(temp, 'wrapped.xyz')]).toString()
for (const frame of JSON.parse(check)) {
  assert.ok(frame.inside); frame.oh.forEach(d => near(d, 0.957, 1e-6, 'whole molecule')); frame.centre.forEach(v => near(v, 0.5, 1e-6, 'centred'))
}
checks++
r = bridge({ action: 'wrap', filename: path.join(temp, 'waters.xyz'), output: path.join(temp, 'wrapped-atoms.xyz'), cell: cellpar, pbc: [true, true, true], mode: 'atoms' })
const inside = execFileSync(python, ['-c', `import sys; from ase.io import read; f = read(sys.argv[1]).get_scaled_positions(wrap=False); print(bool(((f > -1e-9) & (f < 1)).all()))`, path.join(temp, 'wrapped-atoms.xyz')]).toString().trim()
assert.equal(r.ok, true); assert.equal(inside, 'True'); checks++
r = bridge({ action: 'wrap', filename: path.join(temp, 'waters.xyz'), output: path.join(temp, 'x.xyz'), mode: 'molecules' })
assert.equal(r.ok, false); assert.match(r.message, /periodic cell/); checks++
r = bridge({ action: 'wrap', filename: path.join(temp, 'waters.xyz'), output: path.join(temp, 'x.xyz'), cell: cellpar, pbc: [true, true, true], mode: 'everything' })
assert.equal(r.ok, false); checks++
// Frames for the trajectory player; unreadable files give a short message.
r = bridge({ action: 'frames', filename: path.join(temp, 'waters.xyz'), indices: [2, 0] })
assert.equal(r.ok, true); assert.equal(r.nframes, 3); assert.equal(r.positions[0].length, 54); near(r.positions[0][0] - r.positions[1][0], 0.4, 1e-3, 'frame order'); assert.equal(r.cells[0], null); checks++
r = bridge({ action: 'frames', filename: path.join(temp, 'waters.xyz'), indices: [3] })
assert.equal(r.ok, false); checks++
r = bridge({ action: 'bonds', filename: path.join(temp, 'missing.xyz'), pairs: [[0, 1]] })
assert.equal(r.ok, false); assert.ok(!/Traceback|RecursionError/.test(r.message), r.message); checks++

// Fluctuations: a four-atom chain across the cell boundary (oscillating bond, drifting bond, torsion around 180°)
// and a water molecule; expected values come from ASE get_distance/get_angle/get_dihedral frame by frame.
const expected = JSON.parse(execFileSync(python, ['-W', 'ignore', '-c', `
import sys, json, numpy as np
from ase import Atoms
out = sys.argv[1]
F, L = 200, 10.0
frames = []
for f in range(F):
    b1 = 1.5 + 0.03 * np.sin(2 * np.pi * f / 20)       # period 20 frames
    b2 = 1.5 + 0.0005 * f                                # slow drift
    th = np.radians(110 + 2 * np.cos(2 * np.pi * f / 50))
    phi = np.radians(180 + 25 * np.sin(2 * np.pi * f / 40))
    p1 = np.zeros(3); p2 = np.array([b2, 0, 0]); p0 = b1 * np.array([np.cos(th), np.sin(th), 0])
    p3 = p2 + 1.5 * np.array([-np.cos(th), np.sin(th) * np.cos(phi), np.sin(th) * np.sin(phi)])
    chain = np.array([p0, p1, p2, p3]) + [9.2, 5, 5]
    water = np.array([[0, 0, 0], [0.96, 0, 0], [-0.24, 0.93, 0]]) + [3, 3, 3]
    pos = np.vstack([chain, water]) % L                  # atoms wrapped one by one
    frames.append(pos)
symbols = ['C', 'C', 'C', 'C', 'O', 'H', 'H']
with open(f'{out}/chain.xyz', 'w') as fh:
    for k, pos in enumerate(frames):
        fh.write(f'7\\nLattice="{L} 0 0 0 {L} 0 0 0 {L}" Properties=species:S:1:pos:R:3 pbc="T T T" frame={k}\\n')
        fh.write(''.join(f'{s} {x:.10f} {y:.10f} {z:.10f}\\n' for s, (x, y, z) in zip(symbols, pos)))
atoms = [Atoms(symbols, positions=p, cell=[L] * 3, pbc=True) for p in frames]
b1 = np.array([a.get_distance(0, 1, mic=True) for a in atoms])
b2 = np.array([a.get_distance(1, 2, mic=True) for a in atoms])
ang = np.array([a.get_angle(0, 1, 2, mic=True) for a in atoms])
dih = np.array([a.get_dihedral(0, 1, 2, 3, mic=True) for a in atoms])
r = np.radians(dih)
res = np.hypot(np.sin(r).mean(), np.cos(r).mean())
print(json.dumps({'b1': [b1.mean(), b1.std(ddof=1)], 'b2': [b2.mean(), b2.std(ddof=1)], 'angle': [ang.mean(), ang.std(ddof=1)],
                  'dihedral': [float(np.degrees(np.arctan2(np.sin(r).mean(), np.cos(r).mean())) % 360), float(np.degrees(np.sqrt(-2 * np.log(res))))]}))
`, temp]).toString())
const chain = path.join(temp, 'chain.xyz')
const byItem = (r, item) => r.statistics[r.items.findIndex(i => i.join() === item.join())]
r = bridge({ action: 'fluctuations', filename: chain, quantity: 'bonds', mic: true, dt: 0.5 })
assert.equal(r.ok, true, JSON.stringify(r)); assert.deepEqual(r.items, [[0, 1], [1, 2], [2, 3], [4, 5], [4, 6]]); assert.equal(r.periodic, true); checks++
near(byItem(r, [0, 1]).mean, expected.b1[0], 1e-8, 'bond mean'); near(byItem(r, [0, 1]).std, expected.b1[1], 1e-8, 'bond SD'); checks++
near(byItem(r, [1, 2]).mean, expected.b2[0], 1e-8, 'drifting bond mean'); checks++
// Period 20 frames × 0.5 fs → 0.1 fs⁻¹; the oscillating bond has no trend, the drifting one has.
near(byItem(r, [0, 1]).frequency, 0.1, 1e-9, 'dominant frequency'); assert.equal(byItem(r, [0, 1]).trend, false); checks++
assert.equal(byItem(r, [1, 2]).trend, true); near(byItem(r, [1, 2]).slope, 0.0005 / 0.5, 1e-6, 'trend slope per fs'); near(byItem(r, [1, 2]).drift, 0.0005 * 100, 1e-6, 'drift between halves'); checks++
// Rigid water bonds: zero spread, no frequency (null in JSON).
assert.ok(byItem(r, [4, 5]).std < 1e-9); assert.equal(byItem(r, [4, 5]).frequency, null); assert.equal(r.series.length, 5); assert.equal(r.series[0].length, 200); checks++
r = bridge({ action: 'fluctuations', filename: chain, quantity: 'bonds', mic: false, indices: [0, 1, 2, 3] })
assert.deepEqual(r.items.map(String), ['0,1', '1,2', '2,3'].filter(k => r.items.map(String).includes(k))); assert.ok(r.items.length <= 3); assert.equal(r.periodic, false); assert.equal(r.dt, null); checks++
r = bridge({ action: 'fluctuations', filename: chain, quantity: 'angles', mic: true })
assert.equal(r.items.length, 3); near(byItem(r, [0, 1, 2]).mean, expected.angle[0], 1e-8, 'angle mean'); near(byItem(r, [0, 1, 2]).std, expected.angle[1], 1e-8, 'angle SD'); checks++
r = bridge({ action: 'fluctuations', filename: chain, quantity: 'dihedrals', mic: true })
assert.deepEqual(r.items, [[0, 1, 2, 3]]); checks++
// Circular statistics for a torsion crossing 180°: extremes stay around the mean (no 0/360 jump).
near(r.statistics[0].mean, expected.dihedral[0], 1e-8, 'circular mean'); near(r.statistics[0].std, expected.dihedral[1], 1e-8, 'circular SD'); checks++
assert.ok(r.statistics[0].max - r.statistics[0].min < 60); assert.equal(r.statistics[0].trend, false); checks++
r = bridge({ action: 'fluctuations', filename: chain, quantity: 'dihedrals', mic: true, groups: [[0, 1, 2, 3]], frame_step: 2 })
assert.equal(r.n_frames, 100); assert.equal(r.series[0].length, 100); checks++
r = bridge({ action: 'fluctuations', filename: chain, quantity: 'angles', groups: [[0, 1]] })
assert.equal(r.ok, false); checks++
r = bridge({ action: 'fluctuations', filename: chain, quantity: 'torsions' })
assert.equal(r.ok, false); checks++
r = bridge({ action: 'fluctuations', filename: chain, quantity: 'bonds', indices: [4], mic: true })
assert.equal(r.ok, false); assert.match(r.message, /No bonds found/); checks++
// Atoms: the water only translates and rotates rigidly → RMSF ≈ 0 after alignment; unwrapped chain atoms move.
r = bridge({ action: 'fluctuations', filename: chain, quantity: 'atoms', indices: [4, 5, 6], mic: true })
assert.ok(Math.max(...r.statistics.map(st => st.rmsf)) < 1e-6); checks++
r = bridge({ action: 'fluctuations', filename: chain, quantity: 'atoms', indices: [0, 1, 2, 3], mic: true, align: false })
assert.ok(r.statistics[3].rmsf > r.statistics[1].rmsf); assert.ok(r.statistics[3].rmsf < 2, 'unwrapped across the boundary'); checks++

fs.rmSync(temp, { recursive: true, force: true })
console.log(`PASS: ${checks} analysis checks (Kabsch, RMSD matrix, RDF, MSD/D, unwrap, VDOS, ACF, fluctuations).`)

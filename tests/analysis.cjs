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
assert.equal(circ.ok, true); assert.ok(circ.acf[200] > 0.9, 'circular ACF plateaus at <cos> > 0'); checks++
const bondAcf = bridge({ action: 'acf', filename: path.join(temp, 'diatomic.xyz'), quantity: 'bond', groups: [[0, 1]], dt: 0.5, max_lag: 100 })
near(bondAcf.acf[Math.round(1e15 / (1000 * 2.99792458e10) / 0.5)], 1, 0.02, 'periodic bond ACF'); checks++
for (const bad of [{ quantity: 'volume' }, { groups: [[0, 1]] }, { mode: 'circular', quantity: 'bond', groups: [[0, 1]] }, { dt: -1 }, { groups: [[0, 0, 1, 2]] }]) {
  const result = bridge({ action: 'acf', filename: path.join(temp, 'torsion-ou.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, ...bad })
  assert.equal(result.ok, false, JSON.stringify(bad)); assert.ok(!/Traceback/.test(result.message), result.message); checks++
}

fs.rmSync(temp, { recursive: true, force: true })
console.log(`PASS: ${checks} analysis checks (Kabsch, RMSD matrix, RDF, MSD/D, unwrap, VDOS, ACF).`)

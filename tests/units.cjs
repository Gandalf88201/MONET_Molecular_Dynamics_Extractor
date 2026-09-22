'use strict'
// Units and cell conversions: JavaScript (units.js) and Python (monet_units.py) must agree.
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const U = require('../units.js')
const root = path.resolve(__dirname, '..')
let checks = 0
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`)

assert.equal(U.BOHR_ANGSTROM, 0.529177210903); checks++
close(U.angstromToBohr(1), 1.8897261246257702); close(U.bohrToAngstrom(U.angstromToBohr(3.7)), 3.7, 1e-12); checks++
close(U.RY_TIME_FS, 0.04837768653171494); close(U.RY_EV, 13.605693122994); checks++
// Cell parameters <-> vectors (ASE convention).
const cubic = U.cellVectors([10, 10, 10, 90, 90, 90])
cubic.flat().forEach((v, i) => close(v, [10, 0, 0, 0, 10, 0, 0, 0, 10][i], 1e-12)); checks++
const hex = U.cellVectors([3, 3, 5, 90, 90, 120])
close(hex[1][0], -1.5, 1e-12); close(hex[1][1], 3 * Math.sqrt(3) / 2, 1e-12); close(hex[2][2], 5, 1e-12); checks++
const tri = [10.3528, 13.029, 21.211, 96.2968, 97.439, 98.371]
U.cellParameters(U.cellVectors(tri)).forEach((v, i) => close(v, tri[i], 1e-9)); checks++
assert.equal(U.isStandardOrientation(U.cellVectors(tri)), true); assert.equal(U.isStandardOrientation([[0, 10, 0], [10, 0, 0], [0, 0, 10]]), false); checks++
// Fractional coordinates.
const frac = U.fractional(hex, [[0, 0, 0], [1.5, 3 * Math.sqrt(3) / 2 / 2, 2.5]])
close(frac[1][0], 0.75, 1e-12); close(frac[1][1], 0.5, 1e-12); close(frac[1][2], 0.5, 1e-12); checks++
assert.throws(() => U.cellParameters([[1, 0, 0], [2, 0, 0], [0, 0, 1]]), /degenerate/); checks++
// JS/Python parity.
const cases = { cellpar: tri, rows: U.cellVectors(tri), positions: [[1, 2, 3], [-0.5, 4.25, 7]] }
const js = { bohr: U.angstromToBohr(2.5), vectors: U.cellVectors(tri), params: U.cellParameters(cases.rows), frac: U.fractional(cases.rows, cases.positions), std: U.isStandardOrientation(cases.rows) }
const py = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_units as u
c = json.load(sys.stdin)
print(json.dumps({'bohr': u.angstrom_to_bohr(2.5), 'vectors': u.cell_vectors(c['cellpar']), 'params': u.cell_parameters(c['rows']), 'frac': u.fractional(c['rows'], c['positions']), 'std': u.is_standard_orientation(c['rows'])}))
`, root], { input: JSON.stringify(cases) }))
close(py.bohr, js.bohr, 1e-15); checks++
py.vectors.flat().forEach((v, i) => close(v, js.vectors.flat()[i], 1e-12)); checks++
py.params.forEach((v, i) => close(v, js.params[i], 1e-10)); checks++
py.frac.flat().forEach((v, i) => close(v, js.frac.flat()[i], 1e-12)); assert.equal(py.std, js.std); checks++
console.log(`PASS: ${checks} units checks (bohr, time, cell parameters and vectors, fractional coordinates, JS/Python).`)

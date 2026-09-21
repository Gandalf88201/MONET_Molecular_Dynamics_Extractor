'use strict'
// Analysis history model (provenance.js): steps, pauses, clearing, re-runs, derived sources, JSON.
const assert = require('node:assert/strict')
const P = require('../provenance.js')
let checks = 0
let tick = 0
const now = () => `2026-09-21T10:00:${String(tick++).padStart(2, '0')}.000Z`
const s = P.create({ monet_version: '2.1.0', python: '3.12.1', ase: '3.23.0' }, { now })
assert.equal(s.data.schema, 'monet-session/1'); assert.equal(s.data.monet_version, '2.1.0'); assert.equal(s.data.environment.ase, '3.23.0'); checks++
const S1 = s.addSource({ name: 'torsion.xyz', size: 1234, sha256: 'ab'.repeat(32), format: 'XYZ', frames: 100, atoms: 4 })
assert.equal(S1, 'S1'); assert.equal(s.source('S1').name, 'torsion.xyz'); assert.equal(s.source('S1').parent, null); checks++
const load = s.record({ kind: 'load', source: S1, params: { name: 'torsion.xyz' } })
assert.equal(load, 1); assert.equal(s.step(1).status, 'ok'); checks++
const acf = s.begin({ kind: 'analysis', action: 'acf', source: S1, call: 'acf(quantity="dihedral")', params: { quantity: 'dihedral', groups: [[0, 1, 2, 3]] }, atoms: [1, 2, 3, 4] })
assert.equal(acf, 2); assert.equal(s.step(acf).status, 'running'); checks++
s.finish(acf, { ok: true, tau_int: 44.6, tau_int_error: 13.2, tau_fit: NaN, lags: [0, 1], blocking: { g: null, plateau_sem: 0.5 } })
assert.deepEqual(s.step(acf).result, { tau_fit: null, tau_int: 44.6, tau_int_error: 13.2, 'blocking.plateau_sem': 0.5, 'blocking.g': null }); assert.equal(s.step(acf).status, 'ok'); checks++
const bad = s.begin({ kind: 'analysis', action: 'rdf', source: S1 })
s.fail(bad, 'RMAX too large')
assert.equal(s.step(bad).status, 'error'); assert.equal(s.step(bad).error, 'RMAX too large'); checks++
// Clearing keeps the step and adds a clear step pointing at it.
const clearId = s.clear(acf)
assert.equal(s.step(acf).status, 'cleared'); assert.equal(s.step(clearId).kind, 'clear'); assert.deepEqual(s.step(clearId).params, { step: acf }); checks++
assert.equal(s.clear(acf), null); checks++
// A re-run is a new step linked to the original.
const again = s.begin({ kind: 'analysis', action: 'acf', source: S1, rerun_of: acf })
s.finish(again, { ok: true, tau_int: 40 })
assert.equal(s.step(again).rerun_of, acf); assert.equal(s.step(acf).status, 'cleared'); checks++
// Pausing: nothing is added until resume; the history keeps one pause/resume pair.
assert.equal(s.hasGaps(), false)
s.pause()
assert.equal(s.data.paused, true); assert.equal(s.begin({ kind: 'analysis', action: 'rmsd' }), null); assert.equal(s.record({ kind: 'cell' }), null); checks++
s.pause()
s.resume()
const kinds = s.data.steps.map(step => step.kind)
assert.deepEqual(kinds.slice(-2), ['pause', 'resume']); assert.equal(kinds.filter(k => k === 'pause').length, 1); assert.equal(s.hasGaps(), true); checks++
// Derived trajectory: new source with its parent chain.
const sub = s.begin({ kind: 'derive', action: 'subsample', source: S1, params: { stride: 2 } })
s.finish(sub, { ok: true, n_frames: 50, stride: 2, start: 0, source_frames: 100 }, { outputs: [{ file: 'torsion-uncorrelated.extxyz', sha256: 'cd'.repeat(32) }] })
const S2 = s.addSource({ name: 'torsion-uncorrelated.extxyz', frames: 50, atoms: 4, parent: { source: S1, step: sub } })
s.addOutput(sub, { source: S2 })
assert.equal(S2, 'S2'); assert.deepEqual(s.step(sub).outputs, [{ file: 'torsion-uncorrelated.extxyz', sha256: 'cd'.repeat(32) }, { source: 'S2' }]); checks++
assert.equal(s.lineage(S2), `S1 → #${sub} subsample → S2`); assert.equal(s.lineage(S1), 'S1'); checks++
assert.deepEqual(s.step(sub).result, { n_frames: 50, stride: 2, start: 0, source_frames: 100 }); checks++
// Notes, final marks, console input history and environment.
s.annotate(again, { note: 'production value', final: true })
assert.equal(s.step(again).note, 'production value'); assert.equal(s.step(again).final, true); checks++
for (let i = 0; i < 105; i++) s.addInput(`help() ${i}`)
assert.equal(s.data.inputs.length, 100); assert.equal(s.data.inputs[99], 'help() 104'); checks++
s.setEnvironment({ numpy: '2.1.0' }); assert.equal(s.data.environment.numpy, '2.1.0'); assert.equal(s.data.environment.ase, '3.23.0'); checks++
// JSON round trip keeps everything and continues the step numbering.
const copy = P.fromJSON(JSON.parse(JSON.stringify(s.toJSON())), { now })
assert.deepEqual(copy.toJSON(), s.toJSON()); checks++
assert.equal(copy.record({ kind: 'export', params: { file: 'a.csv' } }), s.data.steps.length + 1); checks++
// Steps still running when the file was saved are marked as interrupted.
const running = s.toJSON(); running.steps.push({ ...running.steps[1], id: 99, status: 'running' })
assert.equal(P.fromJSON(running).step(99).status, 'error'); assert.match(P.fromJSON(running).step(99).error, /interrupted/); checks++
assert.throws(() => P.fromJSON({ schema: 'monet-session/2', sources: [], steps: [] }), /newer MONET/); checks++
assert.throws(() => P.fromJSON({ hello: 1 }), /Not a MONET session/); checks++
assert.throws(() => P.fromJSON({ schema: 'monet-session/1', sources: [] }), /incomplete/); checks++
assert.throws(() => s.record({ kind: 'video' }), /Unknown step kind/); checks++
// Key numbers: raw paths are kept exactly; statistics are rounded and marked with ':'.
assert.deepEqual(P.summarize('dihedrals', { series: { '0-1-2-3': [350, 30] } }), { 'circmean:0-1-2-3': 10 }); checks++
assert.deepEqual(P.summarize('rmsd', { rmsd: [0, 0.1, 0.2], reference_index: 0 }), { reference_index: 0, 'mean:rmsd': 0.1, 'max:rmsd': 0.2 }); checks++
assert.deepEqual(P.summarize('msd', { fits: { selection: { D_cm2_s: 1.5e-5, r2: 0.99 } }, fit_start: 1, fit_end: 2 }), { 'fits.selection.D_cm2_s': 1.5e-5, 'fits.selection.r2': 0.99, fit_start: 1, fit_end: 2 }); checks++
assert.deepEqual(P.summarize('unknown_action', { x: 1 }), {}); assert.deepEqual(P.summarize('acf', null), {}); checks++
console.log(`PASS: ${checks} provenance checks (steps, pause, clear, re-run, derived sources, JSON).`)

# Analysis History, Console and Replay: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MONET keeps a text history of every step that changes a result. From that history it offers:
- a side console to re-run analyses with edited parameters;
- Save/Open session;
- a methods report;
- a `replay.py` script that reproduces the numbers without the browser.

**Architecture:** The history is a pure model in the browser (`provenance.js`), fed by hooks at the few places every step already passes through in `renderer.js` (`runAse`, `activateTrajectory`, load, cell, time axis, extraction, exports). The launcher (`start_monet.py`):
- computes SHA-256 checksums;
- autosaves the history to `~/.monet/sessions/`;
- builds the session ZIP.

Pure modules turn the history into:
- console calls (`console.js`);
- a methods report (`report.js`);
- `replay.py` (`replaygen.js`), which runs headless through `monet_replay.py` → `ase_bridge.py`.

**Tech Stack:** Vanilla JS (UMD modules, as in `ase-model.js`), jsdom tests in Node, Python 3 standard library (hashlib, zipfile), the existing `ase_bridge.py`.

**Spec:** `docs/superpowers/specs/2026-09-21-provenance-console-design.md`

## Global Constraints

- **Text only.** The history is a text log. There is no video or screen recording anywhere. UI wording is "History" / "History: on" / "History: paused". The words "record", "recording" and "REC" never appear in the UI.
- **Paths.** Full file paths are never stored in the history, only file names. A file is identified by name, size and SHA-256.
- **Parser.** The console parser never uses `eval`, `Function` or any code execution. Names are checked against a whitelist.
- **Logging never breaks an analysis.** Every hook runs inside `historyDo()` (try/catch). A failure adds a `logging_error` step and a one-time status warning.
- **Language.** The report and the UI text are in English.
- **Schema.** The schema string is exactly `monet-session/1`.
- **Autosave.** The default folder is `~/.monet/sessions/`, overridable with the `--sessions-dir` launcher flag.
- **Replay tolerance.** `replay.py` uses a relative tolerance of `1e-6` by default (`--rtol`).
- **Result keys.** A key without `:` is a dotted path into the raw bridge result and is compared by replay. A key with `:` is a statistic computed by MONET: it is shown but not replayed.
- **Style.**
  - JS follows the existing style: no semicolons, 2-space indent, single quotes.
  - Python follows the existing style: 4-space indent, single quotes in the launcher.
  - Match the surrounding comment density.
- **Tests.**
  - Run each suite with `PYTHON=.venv/bin/python node tests/<suite>.cjs`.
  - All existing suites must still pass: regression, qm-parity, formats, analysis, mdanalysis, ase-integration and ase-ui.
- **Git.** Commit each task on `v2-ase`. Never push.

## File Structure

| File | Role |
| --- | --- |
| `provenance.js` (new) | History model: sources, steps, pause/resume, clear, re-run links, key-number summaries, JSON |
| `console.js` (new) | Call parser/formatter, analysis whitelist with parameters, did-you-mean, MONET ID ⇄ file index |
| `report.js` (new) | `methods.md` text |
| `replaygen.js` (new) | `replay.py` text |
| `monet_replay.py` (new) | Headless replay runtime used by `replay.py` |
| `start_monet.py` | Checksums, `--sessions-dir`, `/api/session/{save,find,export,read}`, new static files |
| `ase_bridge.py` | `check` also returns the Python and SciPy versions |
| `browser-bridge.js` | `fileDigest`, `sessionSave`, `sessionFind`, `sessionExport`, `sessionOpen`; `selectFile(accept)` |
| `renderer.js` | Capture hooks, drawer and console, session buttons |
| `index.html`, `styles.css` | Script tags, drawer markup, drawer styles |
| `tests/provenance.cjs`, `tests/console.cjs`, `tests/report.cjs`, `tests/session.cjs`, `tests/replay.cjs`, `tests/history-ui.cjs` (new) | Tests |

---

### Task 1: History model (`provenance.js`)

**Files:**
- Create: `provenance.js`
- Test: `tests/provenance.cjs`

**Interfaces:**
- Produces:
  - `MonetProvenance` (browser global) / `module.exports`, containing `{ SCHEMA, KINDS, SUMMARY, summarize(action, result), create(env, { now }), fromJSON(object, { now }) }`.
  - A session object with:
    - `data` (getter);
    - `source(id)`, `step(id)`;
    - `setEnvironment(env)`;
    - `addSource(info) → 'S1'…`;
    - `begin(fields) → id | null`, `record(fields) → id | null`;
    - `finish(id, result, { outputs })`, `fail(id, message)`, `addOutput(id, output)`;
    - `clear(id) → clearStepId | null`;
    - `pause()`, `resume()`;
    - `annotate(id, { note, final })`, `addInput(text)`;
    - `hasGaps()`, `lineage(sourceId) → 'S1 → #3 subsample → S2'`;
    - `toJSON()`.
  - Step fields: `{ id, time, kind, action, source, call, params, atoms, result, outputs, rerun_of, status, error, note, final }`.
  - Source fields: `{ id, name, size, sha256, format, frames, atoms, atom_ids, label, import, parent }`.
  - Session fields: `{ schema, monet_version, created, updated, environment, paused, sources, steps, inputs }`.

- [ ] **Step 1: Write the failing test** `tests/provenance.cjs`

```js
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
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node tests/provenance.cjs`
Expected: `Error: Cannot find module '../provenance.js'`

- [ ] **Step 3: Write `provenance.js`**

```js
'use strict'

// Analysis history of a MONET session (schema monet-session/1). A pure data model with no DOM or
// network access. It keeps what changed a result: inputs with checksums, settings, analyses with
// their parameters and key numbers, derived trajectories and exports. That lets the session be
// reported and replayed. File paths are never stored, only file names.
;(function (root) {
  const SCHEMA = 'monet-session/1'
  const KINDS = new Set(['load', 'cell', 'time', 'analysis', 'derive', 'extract', 'export', 'pause', 'resume', 'clear', 'logging_error'])
  const MAX_INPUTS = 100
  const MAX_SERIES = 8
  const clone = value => JSON.parse(JSON.stringify(value))

  const round6 = v => (Number.isFinite(v) ? Number(v.toPrecision(6)) : null)
  const numbers = a => (Array.isArray(a) ? a.filter(Number.isFinite) : [])
  const mean = a => { const v = numbers(a); return v.length ? round6(v.reduce((s, x) => s + x, 0) / v.length) : null }
  const max = a => { const v = numbers(a); return v.length ? round6(v.reduce((m, x) => (x > m ? x : m), -Infinity)) : null }
  function circularMean (a, period = 360) {
    const v = numbers(a)
    if (!v.length) return null
    const k = 2 * Math.PI / period
    let s = 0, c = 0
    for (const x of v) { s += Math.sin(k * x); c += Math.cos(k * x) }
    const m = round6(((Math.atan2(s, c) / k) % period + period) % period)
    return m >= period ? 0 : m
  }
  function argmaxAt (xs, ys) {
    let best = -1
    for (let i = 0; i < (Array.isArray(ys) ? ys.length : 0); i++) if (Number.isFinite(ys[i]) && (best < 0 || ys[i] > ys[best])) best = i
    return best < 0 || !Array.isArray(xs) ? null : round6(xs[best])
  }
  function offDiagonalMean (matrix) {
    let sum = 0, n = 0
    ;(Array.isArray(matrix) ? matrix : []).forEach((row, i) => (row || []).forEach((v, j) => { if (i !== j && Number.isFinite(v)) { sum += v; n++ } }))
    return n ? round6(sum / n) : null
  }
  const get = (object, path) => path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), object)
  const plain = v => (typeof v === 'number' && !Number.isFinite(v) ? null : v)
  // Scalars at the given dotted paths of the raw result, kept exactly (replay compares them).
  function pick (result, paths) {
    const out = {}
    for (const path of paths) {
      const v = get(result, path)
      if (v !== undefined && (v === null || typeof v !== 'object')) out[path] = plain(v)
    }
    return out
  }
  const seriesStat = (result, stat, tag) => Object.fromEntries(Object.entries(result.series || {}).slice(0, MAX_SERIES).map(([key, data]) => [`${tag}:${key}`, stat(data)]))

  // Key numbers kept for each action. A key without ':' is a path into the raw result; a key with
  // ':' is a statistic computed here, shown in the report but not compared by replay.
  const SUMMARY = {
    rmsd: r => ({ ...pick(r, ['reference_index']), 'mean:rmsd': mean(r.rmsd), 'max:rmsd': max(r.rmsd) }),
    rmsd_matrix: r => ({ ...pick(r, ['aligned', 'truncated']), 'mean:offdiagonal': offDiagonalMean(r.matrix) }),
    pdd: r => pick(r, ['n_frames', 'rmax']),
    rdf: r => ({ ...pick(r, ['n_frames', 'rmax']), 'peak:r': argmaxAt(r.r, r.g) }),
    msd: r => pick(r, ['fits.selection.D_cm2_s', 'fits.selection.r2', 'fit_start', 'fit_end']),
    vdos: r => ({ ...pick(r, ['n_frames', 'nyquist_cm', 'resolution_cm']), 'peak:wavenumber': argmaxAt(r.wavenumber, r.intensity) }),
    acf: r => pick(r, ['tau_fit', 'tau_fit_error', 'tau_int', 'tau_int_error', 'tau_int_method', 'n_effective', 'n_frames', 'blocking.plateau_sem', 'blocking.g']),
    equilibration: r => pick(r, ['t0_frame', 't0_time', 'g_t0', 'n_effective_t0', 'n_effective_full']),
    bonds: r => seriesStat(r, mean, 'mean'),
    angles: r => seriesStat(r, mean, 'mean'),
    dihedrals: r => seriesStat(r, circularMean, 'circmean'),
    fluctuations: r => pick(r, ['quantity', 'n_frames']),
    mda_run: r => pick(r, ['kind', 'n_frames']),
    ase_structure: r => pick(r, ['frame']),
    ase_coordination: r => seriesStat(r, mean, 'mean'),
    subsample: r => pick(r, ['n_frames', 'stride', 'start', 'source_frames']),
    mda_align: r => pick(r, ['n_frames']),
    wrap: r => pick(r, ['n_frames']),
    unwrap: r => pick(r, ['n_frames']),
    extract: r => pick(r, ['totalFrames', 'sampledFrames'])
  }

  function summarize (action, result) {
    const summary = SUMMARY[action]
    if (!summary || !result || typeof result !== 'object') return {}
    try { return clone(summary(result)) } catch { return {} }
  }

  function wrap (data, { now = () => new Date().toISOString() } = {}) {
    let nextId = data.steps.reduce((m, step) => Math.max(m, step.id), 0) + 1
    const touch = () => { data.updated = now() }
    const find = id => data.steps.find(step => step.id === id)
    function push (fields) {
      const step = {
        id: nextId, time: now(), kind: null, action: null, source: null, call: null, params: {}, atoms: [],
        result: {}, outputs: [], rerun_of: null, status: 'ok', error: null, note: '', final: false, ...clone(fields)
      }
      if (!KINDS.has(step.kind)) throw new Error(`Unknown step kind '${step.kind}'.`)
      step.id = nextId++
      data.steps.push(step)
      touch()
      return step.id
    }
    return {
      get data () { return data },
      source: id => data.sources.find(source => source.id === id),
      step: find,
      setEnvironment (env) { Object.assign(data.environment, clone(env || {})); touch() },
      addSource (info) {
        const id = `S${data.sources.length + 1}`
        data.sources.push({ name: null, size: null, sha256: null, format: null, frames: null, atoms: null, atom_ids: null, label: null, import: null, parent: null, ...clone(info || {}), id })
        touch()
        return id
      },
      begin (fields) { return data.paused ? null : push({ ...fields, status: 'running' }) },
      record (fields) { return data.paused ? null : push(fields) },
      finish (id, result, { outputs } = {}) {
        const step = find(id)
        if (!step) return
        step.status = 'ok'
        step.error = null
        step.result = summarize(step.action, result)
        if (outputs) step.outputs.push(...clone(outputs))
        touch()
      },
      fail (id, message) { const step = find(id); if (!step) return; step.status = 'error'; step.error = String(message); touch() },
      addOutput (id, output) { const step = find(id); if (!step) return; step.outputs.push(clone(output)); touch() },
      clear (id) {
        const step = find(id)
        if (!step || step.status === 'cleared') return null
        step.status = 'cleared'
        touch()
        return data.paused ? null : push({ kind: 'clear', action: step.action, source: step.source, params: { step: id } })
      },
      pause () { if (data.paused) return; push({ kind: 'pause' }); data.paused = true; touch() },
      resume () { if (!data.paused) return; data.paused = false; push({ kind: 'resume' }) },
      annotate (id, { note, final } = {}) {
        const step = find(id)
        if (!step) return
        if (note !== undefined) step.note = String(note)
        if (final !== undefined) step.final = Boolean(final)
        touch()
      },
      addInput (text) {
        data.inputs.push(String(text))
        if (data.inputs.length > MAX_INPUTS) data.inputs.splice(0, data.inputs.length - MAX_INPUTS)
        touch()
      },
      hasGaps: () => data.steps.some(step => step.kind === 'pause'),
      lineage (id) {
        const parts = []
        for (let source = data.sources.find(s => s.id === id), guard = 0; source && guard < 100; guard++) {
          parts.unshift(source.id)
          if (!source.parent) break
          const step = source.parent.step != null ? find(source.parent.step) : null
          parts.unshift(step ? `#${step.id} ${step.action}` : 'derived')
          source = data.sources.find(s => s.id === source.parent.source)
        }
        return parts.join(' → ')
      },
      toJSON: () => clone(data)
    }
  }

  function create (env = {}, options = {}) {
    const now = options.now || (() => new Date().toISOString())
    const { monet_version = null, ...versions } = env
    const time = now()
    return wrap({
      schema: SCHEMA, monet_version, created: time, updated: time,
      environment: { python: null, ase: null, mdanalysis: null, numpy: null, scipy: null, platform: null, ...clone(versions) },
      paused: false, sources: [], steps: [], inputs: []
    }, { now })
  }

  function fromJSON (object, options = {}) {
    if (!object || typeof object !== 'object' || typeof object.schema !== 'string' || !object.schema.startsWith('monet-session/')) throw new Error('Not a MONET session file.')
    if (object.schema !== SCHEMA) throw new Error(`This session uses ${object.schema}; open it with a newer MONET.`)
    if (!Array.isArray(object.sources) || !Array.isArray(object.steps)) throw new Error('The session file is incomplete.')
    const data = clone(object)
    data.inputs = Array.isArray(data.inputs) ? data.inputs : []
    data.environment = data.environment || {}
    for (const step of data.steps) if (step.status === 'running') { step.status = 'error'; step.error = 'interrupted (MONET closed before it finished)' }
    return wrap(data, options)
  }

  const api = { SCHEMA, KINDS: [...KINDS], SUMMARY, summarize, create, fromJSON }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetProvenance = api
})(globalThis)
```

- [ ] **Step 4: Run the test**

Run: `node tests/provenance.cjs`
Expected: `PASS: 28 provenance checks (steps, pause, clear, re-run, derived sources, JSON).` (the count may differ; there must be no failure).

- [ ] **Step 5: Commit**

```bash
git add provenance.js tests/provenance.cjs
git commit -m "feat(history): analysis history model (monet-session/1)"
```

---

### Task 2: Console calls (`console.js`)

**Files:**
- Create: `console.js`
- Test: `tests/console.cjs`

**Interfaces:**
- Consumes: `MonetProvenance.SUMMARY` (in the test only).
- Produces: `MonetConsole` / `module.exports`, containing:
  - `names() → string[]` (15 analyses) and `parameters(name) → string[]`;
  - `parse(text) → { name, args }`, where `help()` / `help(acf)` give `{ name: 'help', args: { topic? } }`;
  - `format(name, args) → string`, `formatArgs(args) → 'k=v, …'`, `formatValue(v)`;
  - `validate(name, args)`, which throws with "did you mean";
  - `help(topic?) → string`;
  - `toCall(command, mapping) → { name, args }`, which drops the hidden keys and converts file indices to MONET IDs;
  - `fromCall(args, mapping) → args` (MONET IDs → file indices);
  - `atomIds(args) → number[]`.
  - `mapping` is an array of `{ monetId, aseIndex }`.

- [ ] **Step 1: Write the failing test** `tests/console.cjs`

```js
'use strict'
// MONET console (console.js): parser, formatter, whitelist, did-you-mean and MONET ID conversion.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const C = require('../console.js')
const P = require('../provenance.js')
let checks = 0
assert.deepEqual(C.parse('acf(quantity="dihedral", groups=[[228, 227, 289, 225]], dt=0.4838, max_lag=None, align=True)'),
  { name: 'acf', args: { quantity: 'dihedral', groups: [[228, 227, 289, 225]], dt: 0.4838, max_lag: null, align: true } }); checks++
assert.deepEqual(C.parse(' rdf ( indices = [1,2,] , rmax=-1.5e1 ) '), { name: 'rdf', args: { indices: [1, 2], rmax: -15 } }); checks++
assert.deepEqual(C.parse('mda_run(analysis="rmsf", params={"selection": "name C*", "align": False})'), { name: 'mda_run', args: { analysis: 'rmsf', params: { selection: 'name C*', align: false } } }); checks++
assert.deepEqual(C.parse('help()'), { name: 'help', args: {} }); assert.deepEqual(C.parse('help(acf)'), { name: 'help', args: { topic: 'acf' } }); checks++
assert.deepEqual(C.parse('rmsd()'), { name: 'rmsd', args: {} }); checks++
for (const [text, message] of [
  ['acf(', /Expected a parameter name/],
  ['acf(quantity=)', /Unexpected '\)'/],
  ['acf(quantity="a" "b")', /Expected '\)'/],
  ['acf(x=1, x=2)', /given twice/],
  ['acf(x=os)', /Unknown value 'os'/],
  ['__import__("os").system("ls")', /Unexpected '\.'/],
  ['acf(x=1) y', /after the call/],
  ['acf(x=1).y', /Unexpected '\.'/],
  ['acf(x=[1, 2)', /Expected '\]'/],
  ['acf(x={"__proto__": 1})', /not allowed/],
  ['acf(__proto__=1)', /not allowed/],
  ['acf(x=' + '['.repeat(20) + ']'.repeat(20) + ')', /nested too deeply/],
  ['acf(x="unterminated)', /Unexpected '"'/],
  ['1(x=1)', /Start with an analysis name/],
  ['acf(x=1); rm()', /Unexpected ';'/],
  ['import os', /Expected '\('/]
]) { assert.throws(() => C.parse(text), message, text); checks++ }
// Formatting gives text that parses back to the same values, in the parameter order of the action.
const call = 'acf(quantity="dihedral", groups=[[228, 227, 289, 225]], dt=0.4838, frame_step=1, mode="value", tau_int_method="sokal", max_lag=None)'
const parsed = C.parse(call)
assert.equal(C.format(parsed.name, parsed.args), call); checks++
for (const value of [0, -2.5, 1e-7, 1e21, 'say "hi"\n', true, false, null, [], [[1, 2], [3]], { 'a b': [1, { c: 'd' }] }]) {
  const text = C.format('rdf', { rmax: value })
  assert.deepEqual(C.parse(text).args.rmax, value, text); assert.equal(C.format('rdf', C.parse(text).args), text); checks++
}
// Unknown names and parameters, with suggestions.
assert.throws(() => C.validate('acff', {}), /Unknown analysis 'acff'\. Did you mean 'acf'\?/); checks++
assert.throws(() => C.validate('acf', { lag: 5 }), /acf has no parameter 'lag'\. Did you mean 'max_lag'\?/); checks++
assert.throws(() => C.validate('convert', {}), /Unknown analysis 'convert'/); checks++
assert.doesNotThrow(() => C.validate('rdf', { indices: [1], rmax: 6 })); checks++
assert.match(C.help(), /acf, equilibration/); assert.match(C.help('acf'), /^acf\(quantity, groups, dt/); assert.throws(() => C.help('nope'), /Unknown analysis/); checks++
// MONET IDs in calls, file indices in commands; paths and cell options never appear in a call.
const mapping = [{ monetId: 228, aseIndex: 0 }, { monetId: 227, aseIndex: 1 }, { monetId: 289, aseIndex: 2 }, { monetId: 225, aseIndex: 3 }]
const command = { action: 'acf', filename: '/secret/path/traj.xyz', quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 0.5, cell: [10, 10, 10, 90, 90, 90], pbc: [true, true, true], mic: true, atom_ids: [228, 227, 289, 225], bond_scale: 1.2, max_lag: undefined }
const { name, args } = C.toCall(command, mapping)
assert.equal(name, 'acf'); assert.deepEqual(args, { quantity: 'dihedral', groups: [[228, 227, 289, 225]], dt: 0.5 }); checks++
assert.equal(C.format(name, args).includes('secret'), false); checks++
assert.deepEqual(C.fromCall(args, mapping), { quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 0.5 }); checks++
assert.throws(() => C.fromCall({ indices: [999] }, mapping), /MONET atom 999 is not in the active trajectory/); checks++
assert.deepEqual(C.toCall({ action: 'mda_run', analysis: 'dihedral_mda', params: { quads: [[3, 2, 1, 0]] } }, mapping).args.params.quads, [[225, 289, 227, 228]]); checks++
assert.deepEqual(C.atomIds({ pairs: [[228, 227], [227, 289]], params: { quads: [[1, 2, 3, 4]] } }).sort((a, b) => a - b), [1, 2, 3, 4, 227, 228, 289]); checks++
// Every console analysis is a launcher action with allowed keys, and has key numbers for the history.
const launcher = fs.readFileSync(path.join(__dirname, '..', 'start_monet.py'), 'utf8')
const setOf = key => new Set(launcher.match(new RegExp(`^${key} = \\{([^}]*)\\}`, 'm'))[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1)))
const actions = setOf('ACTIONS'), allowed = setOf('ALLOWED')
for (const analysis of C.names()) {
  assert.ok(actions.has(analysis), `${analysis} is not a launcher action`)
  for (const key of C.parameters(analysis)) assert.ok(allowed.has(key), `${analysis}.${key} is not allowed by the launcher`)
  assert.ok(P.SUMMARY[analysis], `no key numbers for ${analysis}`)
}
assert.equal(C.names().length, 15); checks++
console.log(`PASS: ${checks} console checks (parser, formatter, whitelist, MONET IDs).`)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node tests/console.cjs`
Expected: `Error: Cannot find module '../console.js'`

- [ ] **Step 3: Write `console.js`**

```js
'use strict'

// MONET console: readable calls such as acf(quantity="dihedral", groups=[[228, 227, 289, 225]]).
// It contains:
//   - a strict hand-written parser (never eval);
//   - a formatter whose text parses back to the same values;
//   - the analyses the console may run, with their parameters;
//   - the MONET ID ⇄ file index conversion.
;(function (root) {
  // Parameters of each console analysis, in display order. Keys are the bridge command keys.
  const ACTIONS = {
    rmsd: ['indices', 'frame_step', 'align', 'unwrap', 'reference_index'],
    rmsd_matrix: ['indices', 'frame_step', 'max_frames', 'align', 'unwrap'],
    pdd: ['indices', 'elements', 'rmax', 'nbins', 'frame_step'],
    rdf: ['indices', 'elements', 'rmax', 'nbins', 'frame_step'],
    bonds: ['pairs', 'frame_step'],
    angles: ['triplets', 'frame_step', 'angle_range', 'angle_normal'],
    dihedrals: ['quads', 'frame_step', 'angle_range'],
    msd: ['indices', 'dt', 'frame_step', 'remove_drift', 'fit_start', 'fit_end'],
    vdos: ['indices', 'dt', 'frame_step', 'mass_weighted', 'smooth_cm', 'max_cm'],
    acf: ['quantity', 'groups', 'dt', 'frame_step', 'mode', 'fit_until', 'fit_model', 'tau_int_method', 'angle_range', 'max_lag'],
    equilibration: ['quantity', 'groups', 'dt', 'frame_step', 'mode', 'fit_until', 'fit_model', 'tau_int_method', 'angle_range', 'max_lag'],
    fluctuations: ['quantity', 'indices', 'groups', 'frame_step', 'align', 'dt'],
    mda_run: ['analysis', 'params', 'frame_step', 'dt'],
    ase_structure: ['frame', 'symprec'],
    ase_coordination: ['indices', 'frame_step']
  }
  // Keys that hold atoms: file indices in bridge commands, MONET IDs in console calls.
  const ATOM_KEYS = ['indices', 'groups', 'pairs', 'triplets', 'quads']
  // Filled in by MONET, never typed: paths, cell options, atom numbering, bond cutoff.
  const HIDDEN = new Set(['action', 'filename', 'output', 'input', 'file_id', 'cell', 'pbc', 'mic', 'atom_ids', 'bond_scale'])
  const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
  const MAX_TEXT = 20000
  const MAX_DEPTH = 8
  const TOKEN = /\s*(?:("(?:[^"\\\n]|\\.)*")|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([()[\]{},=:]))/y

  function tokenize (text) {
    if (text.length > MAX_TEXT) throw new Error(`The call is longer than ${MAX_TEXT} characters.`)
    const tokens = []
    let index = 0
    while (index < text.length) {
      const rest = text.slice(index)
      const skip = rest.length - rest.trimStart().length
      if (skip === rest.length) break
      TOKEN.lastIndex = index
      const match = TOKEN.exec(text)
      const pos = index + skip + 1
      if (!match) throw new Error(`Unexpected '${text[index + skip]}' at position ${pos}.`)
      if (match[1] !== undefined) {
        let value
        try { value = JSON.parse(match[1]) } catch { throw new Error(`Invalid text value at position ${pos}.`) }
        tokens.push({ type: 'string', value, pos })
      } else if (match[2] !== undefined) tokens.push({ type: 'number', value: Number(match[2]), pos })
      else if (match[3] !== undefined) tokens.push({ type: 'name', value: match[3], pos })
      else tokens.push({ type: 'punct', value: match[4], pos })
      index = TOKEN.lastIndex
    }
    return tokens
  }

  function define (object, key, value) {
    if (FORBIDDEN.has(key)) throw new Error(`'${key}' is not allowed as a name.`)
    Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true })
  }

  function parse (text) {
    const tokens = tokenize(String(text))
    let i = 0
    const peek = () => tokens[i]
    const isPunct = (token, value) => Boolean(token) && token.type === 'punct' && token.value === value
    const fail = message => { throw new Error(message) }
    const expect = value => {
      const token = tokens[i++]
      if (!isPunct(token, value)) fail(`Expected '${value}'${token ? ` at position ${token.pos}` : ' at the end'}.`)
    }
    function value (depth) {
      if (depth > MAX_DEPTH) fail('Values are nested too deeply.')
      const token = tokens[i++]
      if (!token) fail('The call ends too early.')
      if (token.type === 'number' || token.type === 'string') return token.value
      if (token.type === 'name') {
        if (token.value === 'True') return true
        if (token.value === 'False') return false
        if (token.value === 'None') return null
        fail(`Unknown value '${token.value}' at position ${token.pos}: use numbers, "text", True, False, None, [lists] or {"key": value}.`)
      }
      if (token.value === '[') {
        const list = []
        while (!isPunct(peek(), ']')) {
          list.push(value(depth + 1))
          if (isPunct(peek(), ',')) i++
          else break
        }
        expect(']')
        return list
      }
      if (token.value === '{') {
        const object = {}
        while (!isPunct(peek(), '}')) {
          const key = tokens[i++]
          if (!key || key.type !== 'string') fail('Dictionary keys must be "text".')
          expect(':')
          define(object, key.value, value(depth + 1))
          if (isPunct(peek(), ',')) i++
          else break
        }
        expect('}')
        return object
      }
      fail(`Unexpected '${token.value}' at position ${token.pos}.`)
    }
    const head = tokens[i++]
    if (!head || head.type !== 'name') fail('Start with an analysis name, e.g. acf(...). Type help() for the list.')
    expect('(')
    if (head.value === 'help') {
      const topic = peek() && peek().type === 'name' ? tokens[i++].value : null
      expect(')')
      if (i < tokens.length) fail('Unexpected text after the call.')
      return { name: 'help', args: topic ? { topic } : {} }
    }
    const args = {}
    while (!isPunct(peek(), ')')) {
      const key = tokens[i++]
      if (!key || key.type !== 'name') fail(`Expected a parameter name${key ? ` at position ${key.pos}` : ''}.`)
      expect('=')
      if (Object.prototype.hasOwnProperty.call(args, key.value)) fail(`Parameter '${key.value}' is given twice.`)
      define(args, key.value, value(1))
      if (isPunct(peek(), ',')) i++
      else break
    }
    expect(')')
    if (i < tokens.length) fail('Unexpected text after the call.')
    return { name: head.value, args }
  }

  // Python-compatible literals, so replay.py can use the same text.
  function formatValue (v) {
    if (v === null || v === undefined) return 'None'
    if (v === true) return 'True'
    if (v === false) return 'False'
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'None'
    if (typeof v === 'string') return JSON.stringify(v)
    if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`
    if (typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${formatValue(x)}`).join(', ')}}`
    return JSON.stringify(String(v))
  }
  const formatArgs = args => Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${formatValue(v)}`).join(', ')
  function format (name, args) {
    const order = ACTIONS[name] || []
    const keys = [...order.filter(k => k in args), ...Object.keys(args).filter(k => !order.includes(k)).sort()]
    return `${name}(${formatArgs(Object.fromEntries(keys.map(k => [k, args[k]])))})`
  }

  function distance (a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const current = row[j]
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
        previous = current
      }
    }
    return row[b.length]
  }
  function suggest (word, candidates) {
    let best = null, score = Infinity
    for (const candidate of candidates) {
      const d = distance(word, candidate) - (candidate.includes(word) || word.includes(candidate) ? 10 : 0)
      if (d < score) { score = d; best = candidate }
    }
    return best !== null && (score < 0 || score <= Math.max(2, Math.floor(word.length / 3))) ? best : null
  }

  const names = () => Object.keys(ACTIONS)
  const parameters = name => [...(ACTIONS[name] || [])]
  function unknown (name) {
    const near = suggest(name, names())
    return new Error(`Unknown analysis '${name}'.${near ? ` Did you mean '${near}'?` : ''} Type help() for the list.`)
  }
  function validate (name, args) {
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, name)) throw unknown(name)
    for (const key of Object.keys(args)) {
      if (!ACTIONS[name].includes(key)) {
        const near = suggest(key, ACTIONS[name])
        throw new Error(`${name} has no parameter '${key}'.${near ? ` Did you mean '${near}'?` : ''} Type help(${name}) for its parameters.`)
      }
    }
  }
  function help (topic) {
    if (!topic) return `Analyses: ${names().join(', ')}. Type help(acf) for the parameters of one; click a line above to copy its call.`
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, topic)) throw unknown(topic)
    return `${topic}(${ACTIONS[topic].join(', ')})\nAtoms are MONET IDs; dt comes from the time axis; cell, PBC and minimum image come from the panel.`
  }

  const mapAtoms = (value, convert) => (Array.isArray(value) ? value.map(v => mapAtoms(v, convert)) : convert(value))
  function convertKeys (object, convert) {
    const out = { ...object }
    for (const key of ATOM_KEYS) if (out[key] != null) out[key] = mapAtoms(out[key], convert)
    if (out.params && typeof out.params === 'object' && !Array.isArray(out.params)) out.params = convertKeys(out.params, convert)
    return out
  }
  function toCall (command, mapping) {
    const byIndex = new Map(mapping.map(atom => [atom.aseIndex, atom.monetId]))
    const args = {}
    for (const [key, value] of Object.entries(command)) if (!HIDDEN.has(key) && value !== undefined) args[key] = value
    return {
      name: command.action,
      args: convertKeys(args, index => {
        if (!byIndex.has(index)) throw new Error(`File index ${index} has no MONET ID.`)
        return byIndex.get(index)
      })
    }
  }
  function fromCall (args, mapping) {
    const byId = new Map(mapping.map(atom => [atom.monetId, atom.aseIndex]))
    return convertKeys(args, id => {
      if (!Number.isInteger(id) || !byId.has(id)) throw new Error(`MONET atom ${id} is not in the active trajectory.`)
      return byId.get(id)
    })
  }
  function atomIds (args) {
    const ids = new Set()
    const walk = v => (Array.isArray(v) ? v.forEach(walk) : Number.isInteger(v) && ids.add(v))
    for (const key of ATOM_KEYS) {
      if (args[key] != null) walk(args[key])
      if (args.params && args.params[key] != null) walk(args.params[key])
    }
    return [...ids]
  }

  const api = { names, parameters, parse, format, formatArgs, formatValue, validate, help, toCall, fromCall, atomIds }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetConsole = api
})(globalThis)
```

- [ ] **Step 4: Run the tests**

Run: `node tests/console.cjs && node tests/provenance.cjs`
Expected: both print `PASS: …`

- [ ] **Step 5: Commit**

```bash
git add console.js tests/console.cjs
git commit -m "feat(history): console call parser, formatter and analysis whitelist"
```

---
### Task 3: Methods report (`report.js`)

**Files:**
- Create: `report.js`
- Test: `tests/report.cjs`

**Interfaces:**
- Consumes: `MonetConsole.formatArgs` (Task 2), `MonetProvenance.fromJSON(...).lineage` (Task 1).
- Produces: `MonetReport` / `module.exports`, containing:
  - `methodsReport(data, { finalOnly }) → string` (Markdown);
  - `resultText(result) → 'τ_int (fs) = 44.6; …'`;
  - `stepText(step) → call or 'kind action (k=v)'`;
  - `label(key)`.

- [ ] **Step 1: Write the failing test** `tests/report.cjs`

```js
'use strict'
// Methods report (report.js): software, input checksums, steps, reporting checklist and gaps.
const assert = require('node:assert/strict')
const P = require('../provenance.js')
const R = require('../report.js')
let checks = 0
let tick = 0
const now = () => `2026-09-21T10:${String(tick++).padStart(2, '0')}:00.000Z`
const s = P.create({ monet_version: '2.1.0', python: '3.12.1', ase: '3.23.0', mdanalysis: '2.10.0' }, { now })
const S1 = s.addSource({ name: 'torsion.xyz', size: 1234, sha256: 'ab'.repeat(32), format: 'XYZ', frames: 100, atoms: 4 })
s.record({ kind: 'load', source: S1, params: { name: 'torsion.xyz' } })
s.record({ kind: 'time', source: S1, params: { timestep: 0.5, unit: 'fs', steps_per_frame: 2, dt: 1 } })
const acf = s.begin({ kind: 'analysis', action: 'acf', source: S1, call: 'acf(quantity="dihedral", groups=[[1, 2, 3, 4]], dt=1, tau_int_method="sokal")', params: { tau_int_method: 'sokal' } })
s.finish(acf, { tau_fit: 47.9, tau_fit_error: 2.2, tau_int: 44.6, tau_int_error: 13.2, tau_int_method: 'sokal', n_effective: 30, blocking: { plateau_sem: 0.8, g: 150 } })
const sub = s.begin({ kind: 'derive', action: 'subsample', source: S1, call: 'subsample(start=0, stride=90)' })
s.finish(sub, { n_frames: 2, stride: 90, start: 0, source_frames: 100 })
const S2 = s.addSource({ name: 'torsion-uncorrelated.extxyz', frames: 2, atoms: 4, parent: { source: S1, step: sub } })
s.addOutput(sub, { source: S2 })
const rmsd = s.begin({ kind: 'analysis', action: 'rmsd', source: S2, call: 'rmsd(frame_step=1, align=True)' })
s.finish(rmsd, { rmsd: [0, 0.2], reference_index: 0 })
s.annotate(rmsd, { note: 'uncorrelated set', final: true })
const rdf = s.begin({ kind: 'analysis', action: 'rdf', source: S1, call: 'rdf(nbins=100)' })
s.finish(rdf, { n_frames: 100, rmax: 6, r: [1, 2], g: [0, 1] })
s.clear(rdf)
const msd = s.begin({ kind: 'analysis', action: 'msd', source: S1, call: 'msd(dt=1)' })
s.fail(msd, 'Set the time axis first.')
s.pause(); s.resume()
const data = s.toJSON()
const text = R.methodsReport(data)
assert.ok(text.startsWith('# Methods: MONET analysis session\n')); checks++
assert.match(text, /> \*\*Warning:\*\* the history was paused 1 time in this session/); checks++
assert.match(text, /^- MONET 2\.1\.0 \(MONET, Zenodo concept DOI 10\.5281\/zenodo\.22816521\)$/m); checks++
assert.match(text, /^- ASE 3\.23\.0 \(A\. H\. Larsen et al\./m); assert.match(text, /^- MDAnalysis 2\.10\.0 \(N\. Michaud-Agrawal/m); assert.doesNotMatch(text, /NumPy/); checks++
assert.ok(text.includes(`| S1 | torsion.xyz | 1234 | ${'ab'.repeat(32)} | XYZ | 100 | 4 | loaded |`)); checks++
assert.ok(text.includes(`| S2 | torsion-uncorrelated.extxyz | n/a | not recorded | n/a | 2 | 4 | S1 → #${sub} subsample → S2 |`)); checks++
// Final steps come first; cleared and failed steps are not in the list but in the gaps.
const steps = text.split('## Analysis steps')[1].split('## Reporting checklist')[0]
assert.match(steps, new RegExp(`^1\\. \\*\\*#${rmsd} rmsd\\*\\* on S2 ☆ final: \`rmsd\\(frame_step=1, align=True\\)\`$`, 'm')); checks++
assert.match(steps, /^ {3}Results: reference frame = 0; mean RMSD \(Å\) = 0\.1; max RMSD \(Å\) = 0\.2\.$/m); assert.match(steps, /^ {3}Note: uncorrelated set$/m); checks++
assert.match(steps, /Results: τ \(fit, fs\) = 47\.9; τ error \(fs\) = 2\.2; τ_int \(fs\) = 44\.6; τ_int error \(fs\) = 13\.2; τ_int estimator = sokal; N_eff = 30; block-averaged SEM = 0\.8; g \(blocking\) = 150\./); checks++
assert.doesNotMatch(steps, /`rdf\(|`msd\(/); checks++
assert.match(text, /^- \[ \] Engine, level of theory .*: not recorded$/m); checks++
assert.match(text, /^- \[x\] Time step, saving interval, total length, and the discarded equilibration with the criterion used: 1 fs between saved frames \(0\.5 fs × 2, #2\); torsion\.xyz: 100 frames$/m); checks++
assert.match(text, new RegExp(`^- \\[x\\] Observables used for the ACF.*: acf\\(.*\\) → τ = 47\\.9 ± 2\\.2 fs, τ_int = 44\\.6 ± 13\\.2 fs \\(sokal\\) \\(#${acf}\\)$`, 'm')); checks++
assert.match(text, new RegExp(`^- \\[x\\] Stride and the resulting number of configurations; g of the subsample: stride 90 from frame 0 → 2 configurations \\(#${sub}\\)$`, 'm')); checks++
assert.match(text, /^- \[x\] How every error bar was computed; replicas, if any: block averaging \(Flyvbjerg–Petersen\), SEM = 0\.8/m); checks++
const gaps = text.split('## Gaps')[1]
assert.match(gaps, new RegExp(`^- #${rdf} rdf was cleared\\.$`, 'm')); assert.match(gaps, new RegExp(`^- #${msd} msd failed: Set the time axis first\\.$`, 'm')); assert.match(gaps, /^- History paused .* → resumed .*\.$/m); checks++
// Same session, same text; final-only keeps the marked steps.
assert.equal(R.methodsReport(JSON.parse(JSON.stringify(data))), text); checks++
const finalOnly = R.methodsReport(data, { finalOnly: true })
const finalSteps = finalOnly.split('## Analysis steps (marked final)')[1].split('## Reporting checklist')[0]
assert.match(finalSteps, /rmsd\(/); assert.doesNotMatch(finalSteps, /acf\(|subsample/); checks++
// A session without pauses has no warning and "None." under gaps.
const clean = P.create({ monet_version: '2.1.0' }, { now })
clean.addSource({ name: 'a.xyz' })
assert.doesNotMatch(R.methodsReport(clean.toJSON()), /Warning/); assert.match(R.methodsReport(clean.toJSON()), /## Gaps\n\nNone\.\n/); checks++
assert.equal(R.resultText({ 'mean:0-1': 1.5, 'circmean:0-1-2-3': 10 }), 'mean of 0-1 = 1.5; circular mean of 0-1-2-3 = 10'); checks++
assert.equal(R.stepText({ kind: 'cell', action: 'apply', params: { cell: [12, 12, 12, 90, 90, 90], mic: true } }), 'cell apply (cell=[12, 12, 12, 90, 90, 90], mic=True)'); checks++
console.log(`PASS: ${checks} report checks (software, checksums, steps, checklist, gaps).`)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node tests/report.cjs`
Expected: `Error: Cannot find module '../report.js'`

- [ ] **Step 3: Write `report.js`**

```js
'use strict'

// Methods report (Markdown, English) built from a MONET session. It contains:
//   - the software, with citations;
//   - the input checksums;
//   - the steps in order, with their key numbers;
//   - the reporting checklist of the workflow document (§12), filled with the logged values.
// It is template text only, so the same session always gives the same report.
;(function (root) {
  const node = typeof module === 'object' && module.exports
  const C = node ? require('./console.js') : root.MonetConsole
  const P = node ? require('./provenance.js') : root.MonetProvenance
  const SOFTWARE = [
    ['python', 'Python', null],
    ['ase', 'ASE', 'A. H. Larsen et al., J. Phys.: Condens. Matter 29, 273002 (2017), doi:10.1088/1361-648X/aa680e'],
    ['mdanalysis', 'MDAnalysis', 'N. Michaud-Agrawal et al., J. Comput. Chem. 32, 2319 (2011), doi:10.1002/jcc.21787; R. J. Gowers et al., Proc. 15th Python in Science Conf., 98 (2016), doi:10.25080/Majora-629e541a-00e'],
    ['numpy', 'NumPy', 'C. R. Harris et al., Nature 585, 357 (2020), doi:10.1038/s41586-020-2649-2'],
    ['scipy', 'SciPy', 'P. Virtanen et al., Nat. Methods 17, 261 (2020), doi:10.1038/s41592-019-0686-2']
  ]
  const LABELS = {
    tau_fit: 'τ (fit, fs)', tau_fit_error: 'τ error (fs)', tau_int: 'τ_int (fs)', tau_int_error: 'τ_int error (fs)', tau_int_method: 'τ_int estimator',
    n_effective: 'N_eff', n_frames: 'frames', 'blocking.plateau_sem': 'block-averaged SEM', 'blocking.g': 'g (blocking)',
    t0_frame: 't₀ (frame)', t0_time: 't₀ (fs)', g_t0: 'g after t₀', n_effective_t0: 'N_eff after t₀', n_effective_full: 'N_eff (whole run)',
    'fits.selection.D_cm2_s': 'D (cm²/s)', 'fits.selection.r2': 'R² of the MSD fit', fit_start: 'fit start (fs)', fit_end: 'fit end (fs)',
    nyquist_cm: 'Nyquist limit (cm⁻¹)', resolution_cm: 'resolution (cm⁻¹)', 'peak:wavenumber': 'highest peak (cm⁻¹)', 'peak:r': 'first maximum of g(r) (Å)',
    rmax: 'r_max (Å)', 'mean:rmsd': 'mean RMSD (Å)', 'max:rmsd': 'max RMSD (Å)', 'mean:offdiagonal': 'mean pairwise RMSD (Å)', reference_index: 'reference frame',
    stride: 'stride (frames)', start: 'first frame', source_frames: 'frames in the source', totalFrames: 'frames read', sampledFrames: 'configurations extracted'
  }
  const number = v => (typeof v === 'number' ? String(Number(v.toPrecision(6))) : v === null || v === undefined ? 'n/a' : String(v))
  const label = key => LABELS[key] || key.replace(/^(mean|circmean):/, (_, tag) => (tag === 'mean' ? 'mean of ' : 'circular mean of '))
  const resultText = result => Object.entries(result || {}).map(([key, v]) => `${label(key)} = ${number(v)}`).join('; ')
  function stepText (step) {
    if (step.call) return step.call
    const args = step.params && Object.keys(step.params).length ? C.formatArgs(step.params) : ''
    return `${step.kind}${step.action ? ' ' + step.action : ''}${args ? ` (${args})` : ''}`
  }

  const done = (data, test) => data.steps.filter(step => step.status === 'ok' && test(step))
  const calls = steps => (steps.length ? steps.map(s => `${s.call || s.action} (#${s.id})`).join('; ') : null)
  // The reporting checklist of the workflow document (§12); each filler returns text or null.
  const CHECKLIST = [
    ['Engine, level of theory (functional, basis or cutoff, pseudopotentials) or force field, and the ensemble with its thermostat or barostat and coupling constants', () => null],
    ['Time step, saving interval, total length, and the discarded equilibration with the criterion used', data => {
      const parts = []
      const time = done(data, s => s.kind === 'time').pop()
      if (time) parts.push(`${number(time.params.dt)} fs between saved frames (${number(time.params.timestep)} ${time.params.unit} × ${time.params.steps_per_frame}, #${time.id})`)
      for (const source of data.sources.filter(s => !s.parent)) parts.push(`${source.name}: ${source.frames ?? 'n/a'} frames`)
      for (const s of done(data, s => s.action === 'equilibration')) parts.push(`equilibration t₀ = ${number(s.result.t0_time)} fs (frame ${number(s.result.t0_frame)}, maximum N_eff, #${s.id})`)
      return parts.length ? parts.join('; ') : null
    }],
    ['Energy drift, and for CPMD the fictitious mass with evidence of adiabaticity', () => null],
    ['Observables used for the ACF; τ (the fit model and window, with its error) and τ_int (with the truncation rule); T/τ', data => {
      const steps = done(data, s => s.action === 'acf')
      return steps.length ? steps.map(s => `${s.call || 'acf'} → τ = ${number(s.result.tau_fit)} ± ${number(s.result.tau_fit_error)} fs, τ_int = ${number(s.result.tau_int)} ± ${number(s.result.tau_int_error)} fs (${s.result.tau_int_method ?? s.params.tau_int_method ?? 'n/a'}) (#${s.id})`).join('; ') : null
    }],
    ['Stride and the resulting number of configurations; g of the subsample', data => {
      const steps = done(data, s => s.action === 'subsample')
      return steps.length ? steps.map(s => `stride ${number(s.result.stride)} from frame ${number(s.result.start)} → ${number(s.result.n_frames)} configurations (#${s.id})`).join('; ') : null
    }],
    ['RMSD reference and atom subset; the alignment method', data => calls(done(data, s => s.action === 'rmsd' || s.action === 'rmsd_matrix'))],
    ['Clustering method and cutoff; cluster populations with errors', () => null],
    ['RDF bin width, r_max, and the frames used; H-bond criterion', data => calls(done(data, s => s.action === 'rdf' || (s.action === 'mda_run' && ['hbonds', 'interrdf'].includes(s.params.analysis))))],
    ['MSD fitting window, the finite-size correction applied or not, and the unwrapping method', data => {
      const steps = done(data, s => s.action === 'msd')
      return steps.length ? steps.map(s => `fit ${number(s.result.fit_start)}–${number(s.result.fit_end)} fs, D = ${number(s.result['fits.selection.D_cm2_s'])} cm²/s, no finite-size correction (#${s.id})`).join('; ') : null
    }],
    ['VDOS: the saving interval, window and smoothing', data => calls(done(data, s => s.action === 'vdos'))],
    ['How every error bar was computed; replicas, if any', data => {
      const steps = done(data, s => s.action === 'acf' && s.result['blocking.plateau_sem'] != null)
      return steps.length ? steps.map(s => `block averaging (Flyvbjerg–Petersen), SEM = ${number(s.result['blocking.plateau_sem'])} (#${s.id}); ACF standard errors use N_eff = ${number(s.result.n_effective)}`).join('; ') : null
    }],
    ['Software with version numbers and citations', () => 'see Software above']
  ]

  function methodsReport (data, { finalOnly = false } = {}) {
    const session = P.fromJSON(data)
    const out = ['# Methods: MONET analysis session', '', `Session created ${data.created}, last change ${data.updated}. Schema ${data.schema}.`, '']
    const pauses = data.steps.filter(s => s.kind === 'pause').length
    if (pauses) out.push(`> **Warning:** the history was paused ${pauses} time${pauses > 1 ? 's' : ''} in this session. Steps taken while it was paused are not recorded, so this report and replay.py may be incomplete.`, '')
    out.push('## Software', '', `- MONET ${data.monet_version || 'n/a'} (MONET, Zenodo concept DOI 10.5281/zenodo.22816521)`)
    for (const [key, name, citation] of SOFTWARE) {
      const version = data.environment && data.environment[key]
      if (version) out.push(`- ${name} ${version}${citation ? ` (${citation})` : ''}`)
    }
    out.push('', '## Input data', '', '| Source | File | Size (bytes) | SHA-256 | Format | Frames | Atoms | Origin |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const s of data.sources) {
      out.push(`| ${s.id} | ${s.name ?? 'n/a'} | ${s.size ?? 'n/a'} | ${s.sha256 ?? 'not recorded'} | ${s.format ?? 'n/a'} | ${s.frames ?? 'n/a'} | ${s.atoms ?? 'n/a'} | ${s.parent ? session.lineage(s.id) : 'loaded'} |`)
    }
    const listed = data.steps.filter(s => s.status === 'ok' && !['pause', 'resume', 'clear', 'logging_error'].includes(s.kind) && (!finalOnly || s.final))
    const ordered = [...listed.filter(s => s.final), ...listed.filter(s => !s.final)]
    out.push('', finalOnly ? '## Analysis steps (marked final)' : '## Analysis steps', '')
    if (!ordered.length) out.push('No steps recorded.')
    ordered.forEach((s, i) => {
      out.push(`${i + 1}. **#${s.id} ${s.action || s.kind}**${s.source ? ` on ${s.source}` : ''}${s.final ? ' ☆ final' : ''}${s.rerun_of ? ` (re-run of #${s.rerun_of})` : ''}: \`${stepText(s)}\``)
      const text = resultText(s.result)
      if (text) out.push(`   Results: ${text}.`)
      if (s.note) out.push(`   Note: ${s.note}`)
    })
    out.push('', '## Reporting checklist', '', 'Items MONET did not record are left for you to fill in.', '')
    for (const [item, fill] of CHECKLIST) {
      const value = fill(data)
      out.push(`- [${value ? 'x' : ' '}] ${item}: ${value || 'not recorded'}`)
    }
    out.push('', '## Gaps', '')
    const gaps = []
    let pausedAt = null
    for (const s of data.steps) {
      if (s.kind === 'pause') pausedAt = s
      if (s.kind === 'resume' && pausedAt) { gaps.push(`- History paused ${pausedAt.time} → resumed ${s.time} (#${pausedAt.id}–#${s.id}).`); pausedAt = null }
      if (s.kind === 'logging_error') gaps.push(`- #${s.id} a step could not be logged: ${String(s.error).replace(/\.$/, '')}.`)
      if (s.status === 'cleared') gaps.push(`- #${s.id} ${s.action || s.kind} was cleared.`)
      if (s.status === 'error') gaps.push(`- #${s.id} ${s.action || s.kind} failed: ${String(s.error).replace(/\.$/, '')}.`)
    }
    if (pausedAt) gaps.push(`- History paused ${pausedAt.time} and not resumed (#${pausedAt.id}).`)
    out.push(...(gaps.length ? gaps : ['None.']), '')
    return out.join('\n')
  }

  const api = { methodsReport, resultText, stepText, label }
  if (node) module.exports = api
  else root.MonetReport = api
})(globalThis)
```

- [ ] **Step 4: Run the tests**

Run: `node tests/report.cjs && node tests/console.cjs && node tests/provenance.cjs`
Expected: three `PASS: …` lines.

- [ ] **Step 5: Commit**

```bash
git add report.js tests/report.cjs
git commit -m "feat(history): methods report with the reporting checklist"
```

---

### Task 4: Checksums and session endpoints (launcher, bridge, browser bridge)

**Files:**
- Modify: `start_monet.py`, `ase_bridge.py` (`action_check`, imports), `browser-bridge.js`
- Test: `tests/session.cjs` (new)

**Interfaces:**
- Produces (HTTP, all POST with the `X-Monet-Token` header):
  - `/api/upload` → also `sha256`;
  - `/api/run` and `/api/jobs` results that add a file → also `sha256`; `extract` → `extracted_sha256`;
  - `/api/check` → also `python_version`, `scipy_version`;
  - `/api/session/save {session}` → `{ok, saved}`, or `{ok:false, error:'…checksum is not known…'}`;
  - `/api/session/find {sha256}` → `{ok, session|null}`;
  - `/api/session/export {session, methods, replay, name}` → `{ok, download_id}`;
  - `/api/session/read {file_id}` → `{ok, session}`.
- Produces (browser, `window.monet`):
  - `fileDigest(name) → {sha256, size} | null`;
  - `sessionSave(session)`, `sessionFind(sha256)`;
  - `sessionExport(body) → {ok, downloadURL}`;
  - `sessionOpen() → {ok, session} | {error} | null`;
  - `selectFile(accept?)`.
- Autosave file name: `<first 12 hex of sha256>-<safe_name(source name)>-<created digits, 14>.json` in `--sessions-dir` (default `~/.monet/sessions`).

- [ ] **Step 1: Write the failing test** `tests/session.cjs`

```js
'use strict'
// Launcher:
//   - SHA-256 of uploads and derived files;
//   - versions for the report;
//   - session endpoints (autosave, find, export ZIP, open);
//   - the browser adapter's digest and session calls.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { File } = require('node:buffer')
const { spawn, execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const python = process.env.PYTHON || 'python3'
const sessions = fs.mkdtempSync(path.join(os.tmpdir(), 'monet-sessions-'))
const child = spawn(python, [path.join(root, 'start_monet.py'), '--port', '0', '--no-browser', '--sessions-dir', sessions])
const text = fs.readFileSync(path.join(root, 'examples/water.XYZ'), 'utf8')
const sha = crypto.createHash('sha256').update(text).digest('hex')
let checks = 0
async function main () {
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10000)
    let buffer = ''
    child.on('error', reject)
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)) })
    child.stdout.on('data', chunk => {
      buffer += chunk
      const match = buffer.match(/MONET: (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const token = (await (await fetch(origin)).text()).match(/name="monet-api-token" content="([^"]+)"/)[1]
  const post = async (route, body) => {
    const response = await fetch(origin + route, { method: 'POST', headers: { 'X-Monet-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const upload = async (name, data) => (await fetch(origin + '/api/upload', {
    method: 'POST', body: data, headers: { 'X-Monet-Token': token, 'Content-Type': 'application/octet-stream', 'X-Monet-Filename': encodeURIComponent(name) }
  })).json()
  const up = await upload('water.XYZ', text)
  assert.equal(up.ok, true); assert.equal(up.sha256, sha); assert.equal(up.size, Buffer.byteLength(text)); checks++
  const check = await post('/api/check', {})
  assert.match(check.body.python_version, /^3\.\d+/); assert.ok('scipy_version' in check.body); checks++
  const sub = await post('/api/run', { action: 'subsample', file_id: up.file_id, stride: 1, output: 'water' })
  assert.equal(sub.body.ok, true, JSON.stringify(sub.body)); assert.match(sub.body.sha256, /^[0-9a-f]{64}$/); checks++
  // Autosave: one file per session, written through a temporary file.
  const session = { schema: 'monet-session/1', monet_version: '2.1.0', created: '2026-09-21T10:00:00.000Z', updated: '2026-09-21T10:05:00.000Z', environment: {}, paused: false, inputs: [], sources: [{ id: 'S1', name: 'water.XYZ', sha256: sha }], steps: [{ id: 1, kind: 'load', status: 'ok' }] }
  let r = await post('/api/session/save', { session })
  assert.equal(r.body.ok, true, JSON.stringify(r.body)); assert.equal(r.body.saved, `${sha.slice(0, 12)}-water.XYZ-20260921100000.json`); checks++
  assert.deepEqual(fs.readdirSync(sessions), [r.body.saved]); checks++
  r = await post('/api/session/find', { sha256: sha })
  assert.deepEqual(r.body.session, session); checks++
  // The newest history with more than the load step wins over a history just started.
  const longer = { ...session, created: '2026-09-22T08:00:00.000Z', updated: '2026-09-22T08:00:00.000Z', steps: [...session.steps, { id: 2, kind: 'analysis', status: 'ok' }] }
  await post('/api/session/save', { session: longer })
  await post('/api/session/save', { session: { ...session, created: '2026-09-23T08:00:00.000Z', updated: '2026-09-23T08:00:00.000Z' } })
  r = await post('/api/session/find', { sha256: sha })
  assert.equal(r.body.session.created, '2026-09-22T08:00:00.000Z'); checks++
  assert.equal((await post('/api/session/find', { sha256: 'f'.repeat(64) })).body.session, null); checks++
  r = await post('/api/session/save', { session: { hello: 1 } })
  assert.equal(r.status, 400); assert.match(r.body.error, /Not a MONET session/); checks++
  r = await post('/api/session/save', { session: { ...session, schema: 'monet-session/2' } })
  assert.equal(r.status, 400); assert.match(r.body.error, /newer MONET/); checks++
  r = await post('/api/session/save', { session: { ...session, sources: [{ id: 'S1', name: 'x.xyz', sha256: null }] } })
  assert.equal(r.body.ok, false); assert.match(r.body.error, /checksum is not known/); checks++
  // Export: a ZIP with the session, the report and replay.py (methods.docx only with pandoc).
  r = await post('/api/session/export', { session, methods: '# Methods', replay: 'print(1)\n', name: 'MONET-session-water.zip' })
  assert.equal(r.body.ok, true, JSON.stringify(r.body)); checks++
  const zip = Buffer.from(await (await fetch(`${origin}/api/download/${r.body.download_id}?token=${encodeURIComponent(token)}`)).arrayBuffer())
  const zipPath = path.join(os.tmpdir(), `monet-export-${process.pid}.zip`)
  fs.writeFileSync(zipPath, zip)
  const names = execFileSync(python, ['-c', 'import sys, zipfile; print(" ".join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))', zipPath]).toString().trim().split(' ')
  fs.rmSync(zipPath)
  assert.deepEqual(names.filter(n => n !== 'methods.docx'), ['README.txt', 'methods.md', 'replay.py', 'session.json']); checks++
  // Open: the ZIP or a session.json uploaded back; damaged files are refused.
  const opened = await upload('MONET-session-water.zip', zip)
  r = await post('/api/session/read', { file_id: opened.file_id })
  assert.deepEqual(r.body.session, session); checks++
  const broken = await upload('broken.json', '{"schema": "monet-session/1", ')
  r = await post('/api/session/read', { file_id: broken.file_id })
  assert.equal(r.status, 400); assert.match(r.body.error, /damaged/); checks++
  // The browser adapter keeps the digests of uploaded and derived files.
  const context = {
    window: {}, File, Blob, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    fetch: (route, options) => fetch(origin + route, options),
    URL: { createObjectURL () {}, revokeObjectURL () {} },
    document: {
      querySelector: () => ({ content: token }), body: { appendChild () {} },
      createElement () {
        const callbacks = {}
        return { files: [new File([text], 'water.XYZ')], remove () {}, addEventListener (name, callback) { callbacks[name] = callback }, click () { callbacks.change() } }
      }
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'browser-bridge.js'), 'utf8'), context)
  const api = context.window.monet
  const name = await api.selectFile()
  assert.equal((await api.analyzeFile(name)).configCount, 2)
  assert.deepEqual({ ...(await api.fileDigest(name)) }, { sha256: sha, size: Buffer.byteLength(text) }); checks++
  const derived = await api.aseRun({ action: 'subsample', filename: name, stride: 1, output: 'water' })
  assert.match((await api.fileDigest(derived.filePath)).sha256, /^[0-9a-f]{64}$/); checks++
  assert.equal((await api.sessionSave(longer)).ok, true); assert.equal((await api.sessionFind(sha)).session.steps.length, 2); checks++
  console.log(`PASS: ${checks} session checks (checksums, versions, autosave, find, export, open).`)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { child.kill(); fs.rmSync(sessions, { recursive: true, force: true }) })
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PYTHON=.venv/bin/python node tests/session.cjs`
Expected: failure (`Server exited: 2`, because `--sessions-dir` is unknown).

- [ ] **Step 3: `ase_bridge.py`, Python and SciPy versions in `check`**

Change the import line `import sys, os, json, traceback, math` to:

```python
import sys, os, json, traceback, math, platform
```

Replace `action_check` with:

```python
def action_check(_):
    if not _ASE_OK:
        return err(f"ASE not found. pip install ase  ({_ASE_ERR})")
    try:
        import scipy
        scipy_version = scipy.__version__
    except ImportError:
        scipy_version = None
    ok(ase_version=_ASE_VERSION, numpy_version=np.__version__, mdanalysis_version=monet_mda.version(),
       python_version=platform.python_version(), scipy_version=scipy_version)
```

- [ ] **Step 4: `start_monet.py`, imports and constants**

Imports (keep the alphabetical order): add `import hashlib` after `import atexit`, `import os` after `import json`, and `import zipfile` after `import webbrowser`.

After `CHUNK = 1024 * 1024` add:

```python
SESSION_SCHEMA = 'monet-session/1'
SESSIONS_DIR = Path.home() / '.monet' / 'sessions'
SESSION_README = """MONET analysis session

session.json   the analysis history (schema monet-session/1); open it in MONET with History > Open session
methods.md     methods report: software versions, input checksums, steps and the reporting checklist
methods.docx   the same report for Word (only when pandoc was installed)
replay.py      re-runs the logged analyses without the browser and compares the numbers:
                 python replay.py --monet /path/to/MONET
               run it in the folder that holds the input trajectories
"""
```

- [ ] **Step 5: `start_monet.py`, session helpers** (insert after the `safe_name` function)

```python
def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(CHUNK), b''):
            digest.update(block)
    return digest.hexdigest()


def check_session(data):
    if not isinstance(data, dict) or not str(data.get('schema', '')).startswith('monet-session/'):
        raise ValueError('Not a MONET session file.')
    if data['schema'] != SESSION_SCHEMA:
        raise ValueError(f'This session uses {data["schema"]}; open it with a newer MONET.')
    if not isinstance(data.get('sources'), list) or not isinstance(data.get('steps'), list):
        raise ValueError('The session file is incomplete.')
    return data


def session_path(folder, data):
    """Autosave file of a session: checksum prefix, trajectory name, creation time. None without a checksum."""
    first = data['sources'][0] if data['sources'] and isinstance(data['sources'][0], dict) else {}
    digest = first.get('sha256')
    if not digest:
        return None
    if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise ValueError('Invalid checksum in the session.')
    stamp = re.sub(r'\D', '', str(data.get('created') or ''))[:14] or 'undated'
    return Path(folder) / f'{digest[:12]}-{safe_name(first.get("name") or "trajectory")}-{stamp}.json'


def write_atomic(path, text):
    """Write through a temporary file in the same folder, so a crash never leaves half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.tmp-', suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def save_session(folder, data):
    path = session_path(folder, check_session(data))
    if path is None:
        return {'ok': False, 'error': 'The trajectory checksum is not known yet; the history is kept in the page.'}
    write_atomic(path, json.dumps(data, allow_nan=False))
    return {'ok': True, 'saved': path.name}


def find_session(folder, digest):
    if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise ValueError('Invalid checksum.')
    found = []
    for path in Path(folder).glob(f'{digest[:12]}-*.json'):
        try:
            data = check_session(json.loads(path.read_text(encoding='utf-8')))
        except (OSError, ValueError):
            continue
        if data['sources'] and isinstance(data['sources'][0], dict) and data['sources'][0].get('sha256') == digest:
            found.append(data)
    # The newest history with more than the load step first; a history just started is the fallback.
    found.sort(key=lambda data: (len(data['steps']) > 1, str(data.get('updated', ''))))
    return {'ok': True, 'session': found[-1] if found else None}


def read_session(path):
    path = Path(path)
    try:
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                names = [name for name in archive.namelist() if name.split('/')[-1] == 'session.json']
                if not names:
                    raise ValueError('The ZIP has no session.json.')
                info = archive.getinfo(names[0])
                if info.file_size > MAX_JSON:
                    raise ValueError('session.json is too large.')
                text = archive.read(info).decode('utf-8')
        else:
            if path.stat().st_size > MAX_JSON:
                raise ValueError('The session file is too large.')
            text = path.read_text(encoding='utf-8')
        data = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        raise ValueError(f'The session file is damaged ({error.__class__.__name__}).') from None
    return {'ok': True, 'session': check_session(data)}


def build_session_zip(target, data, methods, replay):
    check_session(data)
    if not isinstance(methods, str) or not isinstance(replay, str):
        raise ValueError('Invalid session export.')
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('session.json', json.dumps(data, indent=1, allow_nan=False))
        archive.writestr('methods.md', methods)
        archive.writestr('replay.py', replay)
        archive.writestr('README.txt', SESSION_README)
        pandoc = shutil.which('pandoc')
        if pandoc:
            with tempfile.TemporaryDirectory() as work:
                source, docx = Path(work) / 'methods.md', Path(work) / 'methods.docx'
                source.write_text(methods, encoding='utf-8')
                try:
                    done = subprocess.run([pandoc, str(source), '-o', str(docx)], capture_output=True, timeout=60)
                    if done.returncode == 0 and docx.exists():
                        archive.write(docx, 'methods.docx')
                except (OSError, subprocess.TimeoutExpired):
                    pass
    return target
```

- [ ] **Step 6: `start_monet.py`, checksums on files and the export method**

Replace `Session.add_file` with:

```python
    def add_file(self, path, name, sha256=None):
        file_id = secrets.token_urlsafe(16)
        digest = sha256 or sha256_file(path)
        with self.lock:
            self.files[file_id] = {'path': Path(path), 'name': name, 'size': Path(path).stat().st_size, 'sha256': digest}
        return file_id
```

In `Session.start`'s inner `finish`, replace

```python
                result['extracted_id'] = self.add_file(result.pop('fullTrajectory'), 'FULL_TRAJECTORY_EXTRACTED.xyz')
            return result
```

with

```python
                result['extracted_id'] = self.add_file(result.pop('fullTrajectory'), 'FULL_TRAJECTORY_EXTRACTED.xyz')
            # Checksums of new files, for the analysis history.
            if result.get('file_id') in self.files:
                result['sha256'] = self.files[result['file_id']]['sha256']
            if result.get('extracted_id') in self.files:
                result['extracted_sha256'] = self.files[result['extracted_id']]['sha256']
            return result
```

After the end of `Session.start` (its last line is `return self.register(Job(command, finish))`), add:

```python
    def export_session(self, request):
        folder = self.new_dir('session-')
        name = safe_name(request.get('name') or 'MONET-session.zip', 'MONET-session.zip')
        build_session_zip(folder / 'session.zip', request.get('session'), request.get('methods'), request.get('replay'))
        return {'ok': True, 'download_id': self.add_download(folder / 'session.zip', name)}
```

- [ ] **Step 7: `start_monet.py`, server, routes, upload, command line**

Replace `Server.__init__` with:

```python
    def __init__(self, address, max_upload, sessions_dir=SESSIONS_DIR):
        super().__init__(address, Handler)
        self.token = secrets.token_urlsafe(32)
        self.session = Session()
        self.max_upload = max_upload
        self.sessions_dir = Path(sessions_dir).expanduser()
```

In `do_POST`, insert before `elif self.path.startswith('/api/jobs/') and len(parts) == 5 and parts[4] == 'cancel':`:

```python
            elif self.path == '/api/session/save':
                result = save_session(self.server.sessions_dir, request.get('session'))
            elif self.path == '/api/session/find':
                result = find_session(self.server.sessions_dir, request.get('sha256'))
            elif self.path == '/api/session/export':
                result = session.export_session(request)
            elif self.path == '/api/session/read':
                result = read_session(session.file(request.get('file_id'))['path'])
```

In `upload`, hash while writing. Replace the body from `remaining = length` to the final `self.respond(...)` with:

```python
        remaining = length
        digest = hashlib.sha256()
        try:
            with target.open('wb') as fh:
                while remaining:
                    block = self.rfile.read(min(CHUNK, remaining))
                    if not block:
                        raise ValueError('Upload interrupted.')
                    fh.write(block)
                    digest.update(block)
                    remaining -= len(block)
        except Exception:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        sha256 = digest.hexdigest()
        self.respond(200, {'ok': True, 'file_id': session.add_file(target, name, sha256), 'size': length, 'sha256': sha256})
```

In `main`, add after the `--max-upload-gb` argument:

```python
    parser.add_argument('--sessions-dir', default=str(SESSIONS_DIR),
                        help=f'folder for the autosaved analysis histories (default: {SESSIONS_DIR})')
```

Change `server = Server(('127.0.0.1', args.port), int(args.max_upload_gb * 1024 ** 3))` to:

```python
        server = Server(('127.0.0.1', args.port), int(args.max_upload_gb * 1024 ** 3), args.sessions_dir)
```

After the `Session files: …` print, add:

```python
    print(f'Analysis histories: {server.sessions_dir} (kept)', flush=True)
```

- [ ] **Step 8: `browser-bridge.js`, digests and session calls**

After `const remote = new Map()  // name -> Promise<server file_id>` add:

```js
  const digests = new Map() // name -> { sha256, size } of files the launcher holds (for the analysis history)
```

Change `function selectFile () {` to `function selectFile (accept) {`, and change `input.accept = server ? '' : '.xyz,.XYZ,.extxyz,.EXTXYZ'` to:

```js
      input.accept = accept ?? (server ? '' : '.xyz,.XYZ,.extxyz,.EXTXYZ')
```

In `upload`, replace `      return result.file_id` with:

```js
      digests.set(name, { sha256: result.sha256 || null, size: result.size ?? file.size })
      return result.file_id
```

In `importFile`, after `remote.set(key, Promise.resolve(result.file_id))` add:

```js
      digests.set(key, { sha256: result.sha256 || null, size: null })
```

In `aseRun`, after `remote.set(key, Promise.resolve(result.file_id))` add:

```js
          digests.set(key, { sha256: result.sha256 || null, size: null })
```

In `processTrajectory`, after `remote.set(fullName, Promise.resolve(result.extracted_id))` add:

```js
      digests.set(fullName, { sha256: result.extracted_sha256 || null, size: null })
```

Add these members to the `window.monet = { … }` object (after `cancel: …,`):

```js
    fileDigest: async name => {
      const pending = remote.get(name)
      if (pending) await pending.catch(() => null)
      return digests.get(name) || null
    },
    sessionSave: session => request('/api/session/save', { session }),
    sessionFind: sha256 => request('/api/session/find', { sha256 }),
    sessionExport: async body => {
      const result = await request('/api/session/export', body)
      if (result.ok) result.downloadURL = downloadURL(result.download_id)
      return result
    },
    sessionOpen: safe(async () => {
      const name = await selectFile('.json,.zip,application/json,application/zip')
      if (!name) return null
      if (!server) {
        const file = files.get(name)
        files.delete(name)
        if (/\.zip$/i.test(file.name || name)) throw new Error('Opening a session ZIP needs the launcher; open its session.json instead.')
        return { ok: true, session: JSON.parse(await file.text()) }
      }
      try {
        return await request('/api/session/read', { file_id: await upload(name) })
      } finally {
        window.monet.releaseFile(name)
      }
    }),
```

- [ ] **Step 9: Run the new and existing launcher tests**

Run:
```bash
PYTHON=.venv/bin/python node tests/session.cjs
PYTHON=.venv/bin/python node tests/ase-integration.cjs
PYTHON=.venv/bin/python node tests/regression.cjs
PYTHON=.venv/bin/python node tests/analysis.cjs
```
Expected: four `PASS: …` lines.

- [ ] **Step 10: Commit**

```bash
git add start_monet.py ase_bridge.py browser-bridge.js tests/session.cjs
git commit -m "feat(history): file checksums and session save/find/export/open in the launcher"
```

---

### Task 5: `replay.py` generator and headless replay runtime

**Files:**
- Create: `replaygen.js`, `monet_replay.py`
- Test: `tests/replay.cjs`

**Interfaces:**
- Consumes:
  - `MonetConsole.parse`, `format`, `formatArgs`, `formatValue`, `names`, `toCall`, `atomIds` (Task 2);
  - `MonetProvenance.fromJSON` (Task 1).
- Produces:
  - `MonetReplay` / `module.exports`, containing `{ replayScript(data) → string }`.
  - `monet_replay.Session(monet, out, rtol, force)`, with:
    - `.load(name, sha256, atoms, atom_ids, import_format, reference, cell_file, cell_vectors, step) → Source`;
    - `.options(cell, pbc, mic, bond_scale)`;
    - `.<analysis>(source, step, expect, **args)` for the 15 console names;
    - `.derive(source, action, step, expect, **args) → Source`;
    - `.extract(source, step, selected, frequency, compute_average, qm, expect) → Source`;
    - `.report() → exit code`.
  - Output lines: `OK   step N action`, `DIFF step N action: key: logged X, now Y`, `FAIL step N action: message`.

- [ ] **Step 1: Write the failing test** `tests/replay.cjs`

```js
'use strict'
// A replay.py generated from a logged session re-runs the analyses headless and matches the logged
// numbers; a changed number gives DIFF and a changed input stops the replay.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const P = require('../provenance.js')
const C = require('../console.js')
const R = require('../replaygen.js')
const root = path.resolve(__dirname, '..')
const python = process.env.PYTHON || 'python3'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monet-replay-'))
const env = { ...process.env, MONET_CACHE_DIR: path.join(temp, 'cache') }
let checks = 0
// 400 frames: the H atom turns about the C2–C3 bond, so the C1–C2–C3–H dihedral fluctuates.
let text = ''
for (let k = 0; k < 400; k++) {
  const phi = 1.2 * Math.sin(k / 7) + 0.3 * Math.sin(k / 2.3)
  text += `4\nframe ${k}\nC 1 0 0\nC 0 0 0\nC 0 1 0\nH ${Math.sin(phi).toFixed(6)} 1 ${Math.cos(phi).toFixed(6)}\n`
}
const traj = path.join(temp, 'torsion-long.xyz')
fs.writeFileSync(traj, text)
const bridge = command => {
  const out = execFileSync(python, [path.join(root, 'ase_bridge.py')], { input: JSON.stringify(command), env, maxBuffer: 1 << 28 }).toString()
  return out.trim().split('\n').map(line => JSON.parse(line)).find(message => message.type === 'result' || message.type === 'error')
}
// Log the steps the way renderer.js does: call with MONET IDs, params without paths.
const mapping = [1, 2, 3, 4].map((monetId, aseIndex) => ({ monetId, aseIndex }))
const s = P.create({ monet_version: '2.1.0' })
const S1 = s.addSource({ name: 'torsion-long.xyz', size: text.length, sha256: crypto.createHash('sha256').update(text).digest('hex'), format: 'XYZ', frames: 400, atoms: 4 })
s.record({ kind: 'load', source: S1, params: { name: 'torsion-long.xyz' } })
function log (kind, command, source, outputs) {
  const { name, args } = C.toCall(command, mapping)
  const params = Object.fromEntries(Object.entries(command).filter(([key]) => !['filename', 'output'].includes(key)))
  const id = s.begin({ kind, action: command.action, source, call: C.format(name, args), params, atoms: C.atomIds(args) })
  const result = bridge(command)
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 300))
  s.finish(id, result, { outputs })
  return { id, result }
}
const acf = log('analysis', { action: 'acf', filename: traj, quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 0.5, tau_int_method: 'sokal', mic: true }, S1)
assert.ok(Number.isFinite(acf.result.tau_int)); checks++
log('analysis', { action: 'equilibration', filename: traj, quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 0.5, mic: true }, S1)
const derivedFile = path.join(temp, 'derived.extxyz')
const sub = log('derive', { action: 'subsample', filename: traj, stride: 4, start: 0, output: derivedFile, mic: true }, S1, [{ file: 'torsion-long-uncorrelated.extxyz' }])
const S2 = s.addSource({ name: 'torsion-long-uncorrelated.extxyz', frames: sub.result.n_frames, atoms: 4, parent: { source: S1, step: sub.id } })
s.addOutput(sub.id, { source: S2 })
const rmsd = log('analysis', { action: 'rmsd', filename: derivedFile, frame_step: 1, align: true, mic: true }, S2)
const cleared = log('analysis', { action: 'dihedrals', filename: traj, quads: [[0, 1, 2, 3]], frame_step: 1, angle_range: '360', mic: true }, S1)
s.clear(cleared.id)
const script = R.replayScript(s.toJSON())
assert.match(script, /^S1 = s\.load\(name="torsion-long\.xyz", sha256="[0-9a-f]{64}", atoms=4, step=1\)$/m); checks++
assert.match(script, /^s\.options\(cell=None, pbc=None, mic=True, bond_scale=None\)$/m); checks++
assert.match(script, new RegExp(`^s\\.acf\\(S1, step=${acf.id}, quantity="dihedral", groups=\\[\\[1, 2, 3, 4\\]\\], dt=0\\.5, tau_int_method="sokal", expect=\\{`, 'm')); checks++
assert.match(script, new RegExp(`^S2 = s\\.derive\\(S1, "subsample", step=${sub.id}, start=0, stride=4, expect=`, 'm')); checks++
assert.match(script, new RegExp(`^s\\.rmsd\\(S2, step=${rmsd.id}, frame_step=1, align=True`, 'm')); checks++
assert.match(script, new RegExp(`^# step ${cleared.id} dihedrals: cleared in MONET$`, 'm')); assert.match(script, /^# {3}s\.dihedrals\(/m); checks++
assert.doesNotMatch(script, new RegExp(temp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); checks++
// Run it in a folder that holds a copy of the trajectory.
const work = path.join(temp, 'work')
fs.mkdirSync(work)
fs.copyFileSync(traj, path.join(work, 'torsion-long.xyz'))
fs.writeFileSync(path.join(work, 'replay.py'), script)
const run = (...extra) => spawnSync(python, ['replay.py', '--monet', root, '--out', 'out', ...extra], { cwd: work, env, encoding: 'utf8' })
let done = run()
assert.equal(done.status, 0, done.stdout + done.stderr); checks++
assert.match(done.stdout, new RegExp(`OK   step ${acf.id} acf \\(\\d+ values\\)`)); assert.match(done.stdout, new RegExp(`OK   step ${rmsd.id} rmsd`)); assert.doesNotMatch(done.stdout, /DIFF|FAIL/); checks++
assert.ok(fs.existsSync(path.join(work, 'out', `step${String(acf.id).padStart(2, '0')}_acf.json`))); checks++
// A changed number is reported as DIFF, with exit code 1.
fs.writeFileSync(path.join(work, 'replay.py'), script.replace(/"tau_int": ([-0-9.e+]+)/, (_, v) => `"tau_int": ${Number(v) * 1.5}`))
done = run()
assert.equal(done.status, 1); assert.match(done.stdout, new RegExp(`DIFF step ${acf.id} acf: tau_int: logged`)); checks++
// A different input file stops the replay unless --force is given.
fs.writeFileSync(path.join(work, 'replay.py'), script)
fs.appendFileSync(path.join(work, 'torsion-long.xyz'), '\n')
done = run()
assert.notEqual(done.status, 0); assert.match(done.stderr, /differs from the logged/); checks++
done = run('--force')
assert.match(done.stdout, /WARNING: torsion-long\.xyz: SHA-256/); checks++
fs.rmSync(temp, { recursive: true, force: true })
console.log(`PASS: ${checks} replay checks (replay.py generation, headless re-run, DIFF, checksum stop).`)
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PYTHON=.venv/bin/python node tests/replay.cjs`
Expected: `Error: Cannot find module '../replaygen.js'`

- [ ] **Step 3: Write `replaygen.js`**

```js
'use strict'

// replay.py for a MONET session: one readable line per logged step, with the console names and
// MONET atom IDs. monet_replay.py runs it headless through ase_bridge.py and compares the key numbers.
;(function (root) {
  const node = typeof module === 'object' && module.exports
  const C = node ? require('./console.js') : root.MonetConsole
  const P = node ? require('./provenance.js') : root.MonetProvenance
  // Hidden settings MONET sends with every command; replay.py sets them with s.options(...).
  const OPTIONS = ['cell', 'pbc', 'mic', 'bond_scale']
  const expected = result => Object.fromEntries(Object.entries(result || {}).filter(([key]) => !key.includes(':')))

  function header (data) {
    const gaps = data.steps.some(step => step.kind === 'pause')
    return [
      '#!/usr/bin/env python3',
      `"""Replay of a MONET analysis session (${data.schema}, created ${data.created}).`,
      '',
      'Run it in the folder that holds the input trajectories:',
      '    python replay.py --monet /path/to/MONET',
      'Each step runs the same MONET calculation without the browser, writes stepNN_<action>.json',
      'to --out and compares the key numbers with the ones MONET logged (relative tolerance --rtol).',
      'Edit it like a notebook: change a parameter, delete a line, add your own Python.',
      '"""',
      'import argparse',
      'import os',
      'import sys',
      '',
      "parser = argparse.ArgumentParser(description='Replay a MONET analysis session.')",
      "parser.add_argument('--monet', default=os.environ.get('MONET_HOME'), help='MONET folder (the one with ase_bridge.py); default: $MONET_HOME')",
      "parser.add_argument('--out', default='replay_out', help='folder for the step outputs')",
      "parser.add_argument('--rtol', type=float, default=1e-6, help='relative tolerance for the logged numbers')",
      "parser.add_argument('--force', action='store_true', help='replay even if an input checksum differs')",
      'args = parser.parse_args()',
      'if not args.monet:',
      "    sys.exit('Pass --monet /path/to/MONET (the folder with ase_bridge.py) or set MONET_HOME.')",
      'sys.path.insert(0, args.monet)',
      'from monet_replay import Session  # noqa: E402',
      '',
      's = Session(monet=args.monet, out=args.out, rtol=args.rtol, force=args.force)',
      ...(gaps ? ["print('WARNING: the MONET history was paused during this session; steps taken while paused are missing.')"] : []),
      ''
    ]
  }

  function stepCode (session, step) {
    const target = (step.outputs || []).find(output => output.source)
    const assign = target ? `${target.source} = ` : ''
    const expect = expected(step.result)
    const tail = step.status === 'ok' && Object.keys(expect).length ? { expect } : {}
    if (step.kind === 'load') {
      const source = session.source(step.source)
      if (!source) return null
      const imported = source.import || {}
      return `${source.id} = s.load(${C.formatArgs({
        name: source.name, sha256: source.sha256 ?? undefined, atoms: source.atoms ?? undefined, atom_ids: source.atom_ids ?? undefined,
        import_format: imported.format ?? undefined, reference: imported.reference ?? undefined, cell_file: imported.cell_file ?? undefined,
        cell_vectors: source.import ? imported.cell_vectors : undefined, step: step.id
      })})`
    }
    if (step.kind === 'extract') return `${assign}s.extract(${step.source}, ${C.formatArgs({ step: step.id, ...step.params, ...tail })})`
    if (!step.call) return null
    const { args } = C.parse(step.call)
    if (step.kind === 'derive') return `${assign}s.derive(${step.source}, ${C.formatValue(step.action)}, ${C.formatArgs({ step: step.id, ...args, ...tail })})`
    if (step.kind === 'analysis' && C.names().includes(step.action)) return `s.${step.action}(${step.source}, ${C.formatArgs({ step: step.id, ...args, ...tail })})`
    return null
  }

  function replayScript (data) {
    const session = P.fromJSON(data)
    const lines = header(data)
    let options = null
    for (const step of session.data.steps) {
      if (step.kind === 'pause') { lines.push('', `# step ${step.id}: history paused at ${step.time}; steps until it was resumed are not in this script`); continue }
      if (step.kind === 'resume') { lines.push(`# step ${step.id}: history resumed at ${step.time}`, ''); continue }
      if (step.kind === 'clear' || step.kind === 'logging_error') continue
      if (['time', 'cell', 'export'].includes(step.kind)) {
        lines.push(`# step ${step.id} ${step.kind}${step.action ? ' ' + step.action : ''}: ${C.formatArgs(step.params || {})} (setting or export, not replayed)`)
        continue
      }
      const code = stepCode(session, step)
      if (!code) { lines.push(`# step ${step.id} ${step.action || step.kind}: no call recorded, not replayed`); continue }
      if (step.status !== 'ok') {
        lines.push(`# step ${step.id} ${step.action || step.kind}: ${step.status === 'cleared' ? 'cleared in MONET' : `failed in MONET (${step.error})`}`, `#   ${code}`)
        continue
      }
      if (step.kind !== 'load') {
        const next = Object.fromEntries(OPTIONS.map(key => [key, step.params && step.params[key] !== undefined ? step.params[key] : null]))
        if (JSON.stringify(next) !== JSON.stringify(options)) { lines.push(`s.options(${C.formatArgs(next)})`); options = next }
      }
      lines.push(code)
    }
    lines.push('', 'sys.exit(s.report())', '')
    return lines.join('\n')
  }

  const api = { replayScript }
  if (node) module.exports = api
  else root.MonetReplay = api
})(globalThis)
```

- [ ] **Step 4: Write `monet_replay.py`**

```python
"""Headless replay of a MONET analysis session, used by the replay.py scripts MONET writes.

Each call builds the same command the browser sends (MONET atom IDs become file indices), runs
ase_bridge.py, writes the result to the output folder and compares the logged key numbers.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

ATOM_KEYS = ('indices', 'groups', 'pairs', 'triplets', 'quads')
ANALYSES = ('rmsd', 'rmsd_matrix', 'pdd', 'rdf', 'bonds', 'angles', 'dihedrals', 'msd', 'vdos', 'acf',
            'equilibration', 'fluctuations', 'mda_run', 'ase_structure', 'ase_coordination')
DERIVED = {'subsample': 'uncorrelated.extxyz', 'mda_align': 'aligned.extxyz', 'unwrap': 'unwrapped.extxyz', 'wrap': 'wrapped.extxyz'}
# MONET sends its atom IDs (and the bond cutoff scale) to these actions only, as renderer.js does.
NEEDS_IDS = ('mda_', 'topology', 'ase_', 'fluctuations')


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def _get(result, path):
    for key in path.split('.'):
        if not isinstance(result, dict) or key not in result:
            return None
        result = result[key]
    return result


def _same(expected, actual, rtol):
    if isinstance(expected, bool) or isinstance(actual, bool) or isinstance(expected, str):
        return expected == actual
    if expected is None or actual is None:
        return expected is None and (actual is None or (isinstance(actual, float) and math.isnan(actual)))
    return abs(actual - expected) <= rtol * max(abs(actual), abs(expected)) + 1e-12


class Source:
    """A trajectory on disk with the MONET ID of each of its atoms (None: IDs 1…N in file order)."""

    def __init__(self, path, atoms, atom_ids=None):
        self.path, self.atoms, self.atom_ids = Path(path), atoms, atom_ids

    def index(self, monet_id):
        if self.atom_ids is None:
            if not isinstance(monet_id, int) or not 1 <= monet_id <= (self.atoms or monet_id):
                raise ValueError(f'MONET atom {monet_id} is not in {self.path.name}.')
            return monet_id - 1
        try:
            return self.atom_ids.index(monet_id)
        except ValueError:
            raise ValueError(f'MONET atom {monet_id} is not in {self.path.name}.') from None

    def ids(self):
        return list(self.atom_ids) if self.atom_ids is not None else list(range(1, (self.atoms or 0) + 1))


def _to_indices(value, source):
    return [_to_indices(item, source) for item in value] if isinstance(value, list) else source.index(value)


class Session:
    def __init__(self, monet=None, out='replay_out', rtol=1e-6, force=False):
        root = Path(monet or os.environ.get('MONET_HOME') or Path(__file__).resolve().parent)
        self.bridge = root / 'ase_bridge.py'
        if not self.bridge.exists():
            raise SystemExit(f'ase_bridge.py not found in {root}: pass --monet /path/to/MONET or set MONET_HOME.')
        self.out = Path(out)
        self.out.mkdir(parents=True, exist_ok=True)
        self.rtol, self.force = rtol, force
        self.opts = {}
        self.checked = self.differences = self.failures = 0

    def load(self, name, sha256=None, atoms=None, atom_ids=None, import_format=None, reference=None,
             cell_file=None, cell_vectors='rows', step=None):
        path = Path(name)
        if not path.exists():
            raise SystemExit(f'{name} not found: run replay.py in the folder that holds it, or edit its path here.')
        if sha256:
            actual = sha256_file(path)
            if actual != sha256:
                message = f'{name}: SHA-256 {actual[:12]}… differs from the logged {sha256[:12]}… (different file).'
                if not self.force:
                    raise SystemExit(message + ' Use --force to replay anyway.')
                print('WARNING: ' + message)
        if import_format:
            output = self.out / f'step{step or 0:02d}_import.extxyz'
            command = {'action': 'import', 'filename': str(path), 'format': import_format, 'cell_vectors': cell_vectors,
                       'output': str(output), 'source_name': path.name}
            if reference:
                command['reference'] = str(Path(reference))
            if cell_file:
                command['cell_file'] = str(Path(cell_file))
            result = self._bridge(command)
            if not result.get('ok'):
                raise SystemExit(f'Import of {name} failed: {result.get("message") or result.get("error")}')
            path = output
        return Source(path, atoms, atom_ids)

    def options(self, **options):
        """Cell, PBC, minimum image and bond cutoff scale sent with every later step, as in MONET."""
        self.opts = {key: value for key, value in options.items() if value is not None}

    def _bridge(self, command):
        process = subprocess.run([sys.executable, str(self.bridge)], input=json.dumps(command),
                                 capture_output=True, text=True, encoding='utf-8')
        result = None
        for line in process.stdout.splitlines():
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if message.get('type') in ('result', 'error'):
                result = message
        if result is None:
            tail = process.stderr.strip().splitlines()[-1:] or ['no output']
            result = {'ok': False, 'message': f'ASE returned no result ({tail[0]}).'}
        return result

    def _command(self, action, source, args):
        command = dict(args)
        for key in ATOM_KEYS:
            if command.get(key) is not None:
                command[key] = _to_indices(command[key], source)
        params = command.get('params')
        if isinstance(params, dict) and params.get('quads') is not None:
            command['params'] = {**params, 'quads': _to_indices(params['quads'], source)}
        command.update(self.opts)
        if action.startswith(NEEDS_IDS):
            command['atom_ids'] = source.ids()
        else:
            command.pop('bond_scale', None)
        command.update(action=action, filename=str(source.path))
        return command

    def _check(self, label, name, result, expect):
        (self.out / f'{name}.json').write_text(json.dumps(result, indent=1))
        if not result.get('ok'):
            return self._fail(label, result.get('message') or result.get('error') or 'failed')
        bad = []
        for key, value in (expect or {}).items():
            self.checked += 1
            actual = _get(result, key)
            if not _same(value, actual, self.rtol):
                bad.append(f'{key}: logged {value}, now {actual}')
        if bad:
            self.differences += 1
            print(f'DIFF {label}: ' + '; '.join(bad))
        else:
            print(f'OK   {label}' + (f' ({len(expect)} values)' if expect else ''))
        return result

    def _fail(self, label, message):
        self.failures += 1
        print(f'FAIL {label}: {message}')
        return {'ok': False, 'message': message}

    @staticmethod
    def _names(action, step):
        return (f'step {step} {action}' if step is not None else action,
                f'step{step:02d}_{action}' if step is not None else action)

    def run(self, action, source, step=None, expect=None, **args):
        label, name = self._names(action, step)
        try:
            command = self._command(action, source, args)
        except ValueError as error:
            return self._fail(label, str(error))
        return self._check(label, name, self._bridge(command), expect)

    def __getattr__(self, name):
        if name in ANALYSES:
            return lambda source, **kwargs: self.run(name, source, **kwargs)
        raise AttributeError(name)

    def derive(self, source, action, step=None, expect=None, **args):
        if action not in DERIVED:
            raise ValueError(f'Unknown derived trajectory {action!r}.')
        label, name = self._names(action, step)
        output = self.out / f'{name}_{DERIVED[action]}'
        try:
            command = self._command(action, source, args)
        except ValueError as error:
            self._fail(label, str(error))
            return source
        command['output'] = str(output)
        self._check(label, name, self._bridge(command), expect)
        return Source(output, source.atoms, source.atom_ids)

    def extract(self, source, step=None, selected=(), frequency=1, compute_average=True, qm=None, expect=None):
        label, name = self._names('extract', step)
        folder = self.out / name
        folder.mkdir(parents=True, exist_ok=True)
        command = {'action': 'extract', 'filename': str(source.path), 'selected': list(selected), 'frequency': frequency,
                   'atom_count': source.atoms, 'compute_average': bool(compute_average), 'generate_gaussian': False,
                   'output_dir': str(folder / 'MONET-results'), 'zip': str(folder / 'MONET-results.zip')}
        if qm:
            command['qm'] = qm
        result = self._check(label, name, self._bridge(command), expect)
        full = result.get('fullTrajectory') or str(folder / 'MONET-results' / '1-FULL_TRAJECTORY_EXTRACTED' / 'FULL_TRAJECTORY_EXTRACTED.xyz')
        return Source(full, len(selected), sorted(selected))

    def report(self):
        print(f'\n{self.checked} values compared: {self.differences} steps differ, {self.failures} failed. Outputs in {self.out}/')
        return 1 if self.differences or self.failures else 0
```

- [ ] **Step 5: Run the tests**

Run: `PYTHON=.venv/bin/python node tests/replay.cjs`
Expected: `PASS: 14 replay checks (…)` (the count may differ; there must be no failure).

- [ ] **Step 6: Commit**

```bash
git add replaygen.js monet_replay.py tests/replay.cjs
git commit -m "feat(history): replay.py generator and headless replay runtime"
```

---

### Task 6: Capture hooks in the app (`renderer.js`)

**Files:**
- Modify: `renderer.js`, `index.html` (script tags), `start_monet.py` (`STATIC`), `tests/ase-ui.cjs` (script list)
- Test: `tests/history-ui.cjs` (new)

**Interfaces:**
- Consumes:
  - `MonetProvenance` (Task 1), `MonetConsole` (Task 2);
  - `window.monet.fileDigest`, `sessionSave`, `sessionFind`, `hasAseServer` (Task 4); every call is optional-chained, so the Electron preload and the test mocks without them keep working.
- Produces (top-level names in `renderer.js`, used by Tasks 7–8):
  - `monetHistory` (the state object below);
  - `historyDo(fn)`, `historyRecord(fields)`, `onHistoryChange()`, `saveHistoryNow()`;
  - `historyBegin`, `historyEnd`, `historyClear(kind)`, `historyLoad(info)`, `attachSource(id)`, `historyDerived`, `historyExtracted`;
  - `LOGGED_ACTIONS`, `fileName(path)`.
- Also produces: `renderHistory()` and `offerPreviousHistory(digest)` are called only when defined (Tasks 7 and 8 define them).

- [ ] **Step 1: Load the new modules**

`index.html`: replace `<script src="plot.js"></script>` with

```html
<script src="plot.js"></script>
<script src="provenance.js"></script>
<script src="console.js"></script>
<script src="report.js"></script>
<script src="replaygen.js"></script>
```

`start_monet.py`: add `'provenance.js', 'console.js', 'report.js', 'replaygen.js'` to the `STATIC` set.

`tests/ase-ui.cjs` line 120: in the file list, insert `'provenance.js', 'console.js', 'report.js', 'replaygen.js'` between `'plot.js'` and `'renderer.js'`.

- [ ] **Step 2: Write the failing test** `tests/history-ui.cjs`

Start the file with a verbatim copy of lines 1–119 of `tests/ase-ui.cjs` (the jsdom harness and the `w.monet` mock, ending with the `}` that closes `w.monet`). Then append:

```js
// ── history additions to the mock backend ───────────────────────────────────
const SHA = 'ab'.repeat(32)
const saved = []
const plain = value => JSON.parse(JSON.stringify(value))
const baseRun = w.monet.aseRun
Object.assign(w.monet, {
  hasAseServer: true,
  aseCheck: async () => ({ ok: true, ase_version: 'test', mdanalysis_version: '2.10.0', python_version: '3.12.1', numpy_version: '2.1.0', scipy_version: '1.14.0' }),
  fileDigest: async () => ({ sha256: SHA, size: 42 }),
  sessionSave: async session => { saved.push(session); return { ok: true } },
  sessionFind: async () => ({ ok: true, session: null }),
  aseRun: async command => {
    const result = await baseRun(command)
    return command.action === 'subsample' ? { ...result, filePath: 'derived/production.extxyz', output: 'production.extxyz', sha256: 'cd'.repeat(32) } : result
  }
})
for (const file of ['theme.js', 'qm-inputs.js', 'viewer.js', 'ase-model.js', 'fit.js', 'pbc.js', 'plot.js', 'provenance.js', 'console.js', 'report.js', 'replaygen.js', 'renderer.js']) {
  w.eval(fs.readFileSync(path.join(root, file), 'utf8') + (file === 'renderer.js' ? '\nwindow.testMonet = { charts, runProcessing, aseViewer, viewer, state, aseState, player, monetHistory, saveHistoryNow };' : ''))
}
const el = id => w.document.getElementById(id)
const tick = () => new Promise(resolve => setImmediate(resolve))
async function click (id) { el(id).click(); await tick(); await tick() }
async function settle (n = 12) { for (let i = 0; i < n; i++) await tick() }

async function run () {
  await tick()
  const H = w.testMonet.monetHistory
  const steps = () => H.session.data.steps
  await click('btn-browse'); await click('next-1'); await settle()
  // Load: a new history with the source, its checksum and the software versions.
  assert.equal(H.session.data.sources[0].name, 'torsion.xyz'); assert.equal(H.session.data.sources[0].sha256, SHA); assert.equal(steps()[0].kind, 'load'); checks++
  assert.equal(H.session.data.environment.ase, 'test'); assert.equal(H.session.data.environment.python, '3.12.1'); assert.equal(H.session.data.monet_version, '2.1.0'); checks++
  // The time axis is logged when the value is committed.
  el('md-timestep').value = '0.5'; el('md-timestep').dispatchEvent(new w.Event('change'))
  assert.deepEqual(plain(steps().at(-1)), { ...plain(steps().at(-1)), kind: 'time', params: { timestep: 0.5, unit: 'fs', steps_per_frame: 1, dt: 0.5 } }); checks++
  // An analysis: readable call with MONET IDs, parameters without paths, key numbers only.
  el('acf-quantity').value = 'dihedral'; el('acf-quantity').dispatchEvent(new w.Event('change'))
  el('acf-groups').value = '1 2 3 4'
  await click('btn-run-acf')
  const acf = steps().at(-1)
  assert.equal(acf.kind, 'analysis'); assert.equal(acf.action, 'acf'); assert.equal(acf.status, 'ok'); assert.equal(acf.source, 'S1'); checks++
  assert.match(acf.call, /^acf\(quantity="dihedral", groups=\[\[1, 2, 3, 4\]\], dt=0\.5, /); assert.deepEqual(plain(acf.atoms), [1, 2, 3, 4]); checks++
  assert.equal(acf.result.tau_int, 40); assert.equal(acf.result.tau_fit, 43.6); assert.equal('lags' in acf.result, false); assert.equal(acf.params.filename, undefined); checks++
  // The clear button marks the step cleared; the history keeps it.
  await click('clear-acf')
  assert.equal(H.session.step(acf.id).status, 'cleared'); assert.equal(steps().at(-1).kind, 'clear'); checks++
  // Equilibration crop: a derived trajectory S2 with its parent chain.
  await click('btn-run-acf')
  await click('btn-run-equil'); await click('equil-crop'); await settle()
  const derive = steps().find(step => step.kind === 'derive')
  assert.equal(derive.action, 'subsample'); assert.equal(derive.status, 'ok'); checks++
  const S2 = H.session.data.sources[1]
  assert.equal(S2.parent.source, 'S1'); assert.equal(S2.parent.step, derive.id); assert.equal(S2.sha256, SHA); assert.equal(H.activeSource, S2.id); checks++
  assert.equal(H.session.lineage(S2.id), `S1 → #${derive.id} subsample → S2`); assert.deepEqual(plain(derive.outputs.filter(o => o.source).map(o => o.source)), ['S2']); checks++
  await click('btn-run-rmsd')
  const rmsd = steps().at(-1)
  assert.equal(rmsd.action, 'rmsd'); assert.equal(rmsd.source, 'S2'); checks++
  // Exports and cell changes are logged; clearing by a cell change is not a user clear.
  await click('csv-rmsd')
  assert.equal(steps().at(-1).kind, 'export'); assert.equal(steps().at(-1).params.file, 'MONET-rmsd.csv'); checks++
  el('cell-system').value = 'cubic'; el('cell-a').value = '12'; el('cell-system').dispatchEvent(new w.Event('change'))
  await click('cell-apply')
  const cell = steps().at(-1)
  assert.equal(cell.kind, 'cell'); assert.equal(cell.action, 'apply'); assert.deepEqual(plain(cell.params.cell), [12, 12, 12, 90, 90, 90]); checks++
  assert.equal(H.session.step(rmsd.id).status, 'ok'); checks++
  // Paused: analyses run, nothing is added.
  H.session.pause()
  let count = steps().length
  await click('btn-run-rmsd')
  assert.equal(steps().length, count); H.session.resume(); checks++
  // A logging failure never breaks the analysis.
  const finish = H.session.finish
  H.session.finish = () => { throw new Error('disk on fire') }
  latestCommand = null
  await click('btn-run-rmsd')
  H.session.finish = finish
  assert.equal(latestCommand.action, 'rmsd'); assert.ok(w.testMonet.charts.rmsd.data); assert.equal(steps().at(-1).kind, 'logging_error'); assert.match(steps().at(-1).error, /disk on fire/); checks++
  // Autosave sends the whole history.
  await w.testMonet.saveHistoryNow()
  assert.equal(saved.at(-1).steps.length, steps().length); assert.equal(saved.at(-1).schema, 'monet-session/1'); checks++
  // Extraction: a step with the options and a new source S3 with the extracted atoms.
  for (const id of [1, 2, 3, 4]) w.testMonet.state.selectedAtoms.add(id)
  await w.testMonet.runProcessing(); await settle()
  const extract = steps().find(step => step.kind === 'extract')
  assert.equal(extract.status, 'ok'); assert.deepEqual(plain(extract.params.selected), [1, 2, 3, 4]); assert.equal(extract.result.totalFrames, 2); checks++
  const S3 = H.session.data.sources.at(-1)
  assert.equal(S3.parent.step, extract.id); assert.deepEqual(plain(S3.atom_ids), [1, 2, 3, 4]); assert.equal(H.activeSource, S3.id); checks++
  // ── more checks ──
  console.log(`PASS: ${checks} history UI checks (capture, derived sources, clear, pause, logging errors, autosave).`)
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => w.close())
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `PYTHON=.venv/bin/python node tests/history-ui.cjs`
Expected: failure (`monetHistory is not defined`).

- [ ] **Step 4: The history state and helpers** (in `renderer.js`, immediately after the `const state = { … }` block and before the `// ── DOM helpers` banner)

```js
// =============================================================================
// ── Analysis history (provenance.js) ─────────────────────────────────────────
// =============================================================================

// Every step that changes a result is logged as text; view-only actions are not. Logging never breaks an analysis.
const MONET_VERSION = document.querySelector('.titlebar-sub')?.textContent.match(/v\s*([\d.]+)/)?.[1] || null
const monetHistory = {
  env: { monet_version: MONET_VERSION },
  session: MonetProvenance.create({ monet_version: MONET_VERSION }),
  activeSource: null,       // source id of the trajectory the analyses run on
  sourceByPath: new Map(),  // bridge file key → source id
  stepByPath: new Map(),    // derived file key → id of the step that wrote it
  stepByKind: {},           // chart kind → id of the step drawn there
  rerunOf: null,            // { id, action } set by the console for its next run
  consoleRerun: null,       // the history line copied into the console input
  started: false,           // the last console run reached runAse
  readOnly: false,          // an opened session whose trajectory is not attached yet
  selected: null,           // step shown in the history detail
  lastTime: null,           // JSON of the last logged time axis
  saveTimer: null,
  warned: false
}
const fileName = name => String(name || '').split(/[\\/]/).pop()

function historyDo (fn) {
  try { return fn(monetHistory.session) } catch (error) {
    try { monetHistory.session.record({ kind: 'logging_error', error: String(error?.message || error) }) } catch {}
    if (!monetHistory.warned) {
      monetHistory.warned = true
      setStatus('The analysis history could not log a step: ' + (error?.message || error))
    }
    return null
  }
}

function historyRecord (fields) {
  if (monetHistory.readOnly) return null
  const id = historyDo(P => P.record({ source: monetHistory.activeSource, ...fields }))
  onHistoryChange()
  return id
}

function onHistoryChange () {
  clearTimeout(monetHistory.saveTimer)
  monetHistory.saveTimer = setTimeout(saveHistoryNow, 1000)
  if (typeof renderHistory === 'function') renderHistory()
}

// Autosave in the launcher's session folder, keyed by the trajectory checksum.
async function saveHistoryNow () {
  clearTimeout(monetHistory.saveTimer)
  if (!window.monet.hasAseServer || !window.monet.sessionSave || monetHistory.readOnly || !monetHistory.session.data.sources.length) return
  let r
  try { r = await window.monet.sessionSave(monetHistory.session.toJSON()) } catch (error) { r = { ok: false, error: error.message } }
  const failed = !r?.ok && !/checksum is not known/.test(r?.error || '')
  $('history-save-badge')?.classList.toggle('hidden', !failed)
}
```

- [ ] **Step 5: Capture functions** (in `renderer.js`, immediately before `async function runAse (kind, command) {`)

```js
// Bridge actions logged by runAse: the console analyses, derived trajectories and format conversion.
const LOGGED_ACTIONS = new Set([...MonetConsole.names(), 'subsample', 'mda_align', 'wrap', 'unwrap', 'convert'])
const DERIVING_ACTIONS = new Set(['subsample', 'mda_align', 'wrap', 'unwrap'])

function historyBegin (kind, command, mapping) {
  monetHistory.started = true
  if (monetHistory.readOnly || kind === 'fluctseries' || !LOGGED_ACTIONS.has(command.action)) return null
  const rerun = monetHistory.rerunOf?.action === command.action ? monetHistory.rerunOf.id : null
  monetHistory.rerunOf = null
  const id = historyDo(P => {
    const { name, args } = MonetConsole.toCall(command, mapping)
    const params = Object.fromEntries(Object.entries(command).filter(([key, value]) => !['filename', 'output', 'input', 'file_id'].includes(key) && value !== undefined))
    return P.begin({
      kind: DERIVING_ACTIONS.has(command.action) ? 'derive' : command.action === 'convert' ? 'export' : 'analysis',
      action: command.action, source: monetHistory.sourceByPath.get(command.filename) ?? monetHistory.activeSource,
      call: MonetConsole.format(name, args), params, atoms: MonetConsole.atomIds(args), rerun_of: rerun
    })
  })
  onHistoryChange()
  return id
}

function historyEnd (stepId, kind, command, result) {
  if (stepId == null) return
  historyDo(P => {
    if (!result?.ok) return P.fail(stepId, result?.message || result?.error || 'failed')
    const outputs = []
    if (result.filePath) {
      monetHistory.stepByPath.set(result.filePath, stepId)
      outputs.push({ file: result.output || fileName(result.filePath), sha256: result.sha256 || null })
    } else if (result.output) outputs.push({ file: fileName(result.output) })
    P.finish(stepId, result, { outputs })
    if (!DERIVING_ACTIONS.has(command.action)) monetHistory.stepByKind[kind] = stepId
  })
  onHistoryChange()
}

// Only the user's clear marks a step cleared; analyses cleared by a new source or cell are just forgotten.
function historyClear (kind) {
  const id = monetHistory.stepByKind[kind]
  if (id == null) return
  delete monetHistory.stepByKind[kind]
  historyDo(P => P.clear(id))
  onHistoryChange()
}

function attachSource (id) {
  monetHistory.activeSource = id
  monetHistory.sourceByPath.set(state.filePath, id)
}

// A loaded trajectory starts a new history, unless it is the trajectory of the current one.
async function historyLoad (info) {
  let digest = null
  try { digest = await window.monet.fileDigest?.(state.source.original) } catch {}
  const name = fileName(state.source.original)
  const first = monetHistory.session.data.sources[0]
  const same = Boolean(digest?.sha256) && digest.sha256 === first?.sha256
  if (monetHistory.readOnly) {
    if (same) {
      monetHistory.readOnly = false
      attachSource(first.id)
      setStatus(`${name} matches the opened session: its history continues.`)
      updateAseControls()
      onHistoryChange()
      return
    }
    if (!window.confirm(`${name} is a different file from the one in the opened session (the SHA-256 differs). Start a new history for it? Cancel keeps the opened history, read-only.`)) return
    monetHistory.readOnly = false
    updateAseControls()
  } else if (same) {
    attachSource(first.id)
    return
  }
  await saveHistoryNow()
  monetHistory.session = MonetProvenance.create(monetHistory.env)
  monetHistory.stepByKind = {}
  monetHistory.sourceByPath.clear()
  monetHistory.stepByPath.clear()
  monetHistory.lastTime = null
  historyDo(P => {
    const imported = state.filePath !== state.source.original
    const id = P.addSource({
      name, size: digest?.size ?? null, sha256: digest?.sha256 ?? null, format: state.source.label || info.format,
      frames: info.configCount, atoms: info.atomCount,
      import: imported ? {
        format: state.source.format, cell_vectors: $('inp-cell-vectors').value,
        reference: state.source.reference ? fileName(state.source.reference) : null, cell_file: state.source.cellFile ? fileName(state.source.cellFile) : null
      } : null
    })
    attachSource(id)
    P.record({ kind: 'load', source: id, params: { name, format: state.source.format } })
  })
  onHistoryChange()
  if (typeof offerPreviousHistory === 'function') await offerPreviousHistory(digest)
}

async function historyDerived (path, info, label) {
  if (monetHistory.readOnly) return
  let digest = null
  try { digest = await window.monet.fileDigest?.(path) } catch {}
  historyDo(P => {
    const stepId = monetHistory.stepByPath.get(path) ?? null
    const parent = monetHistory.activeSource
    const id = P.addSource({
      name: fileName(path), size: digest?.size ?? null, sha256: digest?.sha256 ?? null, format: info.format,
      frames: info.configCount, atoms: info.atomCount, label, parent: parent ? { source: parent, step: stepId } : null
    })
    if (stepId != null) P.addOutput(stepId, { source: id })
    monetHistory.activeSource = id
    monetHistory.sourceByPath.set(path, id)
  })
  onHistoryChange()
}

async function historyExtracted (stepId, result, sourceAtoms) {
  const path = extractedTrajPath()
  let digest = null
  try { digest = await window.monet.fileDigest?.(path) } catch {}
  historyDo(P => {
    P.finish(stepId, result)
    const id = P.addSource({
      name: fileName(path), size: digest?.size ?? null, sha256: digest?.sha256 ?? null, format: 'XYZ', frames: result.totalFrames ?? null,
      atoms: sourceAtoms.length, atom_ids: sourceAtoms.map(atom => atom.index), label: 'extracted atoms',
      parent: { source: P.step(stepId)?.source ?? monetHistory.activeSource, step: stepId }
    })
    P.addOutput(stepId, { source: id })
    monetHistory.sourceByPath.set(path, id)
    monetHistory.activeSource = id
  })
  onHistoryChange()
}
```

- [ ] **Step 6: Hook `runAse`**

In `runAse`, insert before the line `  const rmsdNote = command.align ? ' Kabsch-aligned RMSD.' : ' Raw Cartesian RMSD.'`:

```js
  const stepId = historyBegin(kind, command, mapping)
```

Replace the `try { … } catch { … } finally {` block of `runAse`, down to and including the first line of the `finally` body, with:

```js
  let outcome = { ok: false, error: 'Analysis discarded because its source or result was cleared.' }
  try {
    if (kind !== 'conv') {
      const info = await window.monet.aseRun({ action: 'read_info', filename: command.filename, ...options })
      if (!current()) return outcome
      MonetASEModel.verifyAtoms(mapping, info)
      $('ase-atom-match').textContent = `Verified with ASE: ${mapping.length} matching atoms, elements and first-frame coordinates.`
    }
    const result = await window.monet.aseRun(command)
    if (!current()) return outcome
    if (charts[kind]) charts[kind].source = source
    outcome = { ...result, atomMapping: mapping, angleRange: command.angle_range, angleNormal: command.angle_normal }
    return outcome
  } catch (error) {
    if (kind !== 'conv' && current()) $('ase-atom-match').textContent = 'ASE verification or calculation failed: ' + error.message
    outcome = { ok: false, error: error.message }
    return outcome
  } finally {
    historyEnd(stepId, kind, command, outcome)
    if (typeof unsubscribe === 'function') unsubscribe()
```

(The rest of the `finally` body stays unchanged.)

- [ ] **Step 7: Hook the load, derived trajectories and extraction**

In the `next-1` handler, after `    state.fileInfo = info` (the line followed by ``$('stat-format').textContent = state.source.label ? `${state.source.label} → extXYZ` : info.format``), insert:

```js
    await historyLoad(info)
```

In `activateTrajectory`, after `  state.derivedLabel = label`, insert:

```js
  await historyDerived(path, info, label)
```

In the `restore-full-trajectory` handler, after `  state.fileInfo = full.fileInfo`, insert:

```js
  monetHistory.activeSource = monetHistory.sourceByPath.get(full.filePath) ?? monetHistory.activeSource
```

In `runProcessing`:
- Insert before `  const result = await window.monet.processTrajectory({`:

```js
  const extractStep = monetHistory.readOnly ? null : historyDo(P => P.begin({
    kind: 'extract', action: 'extract', source: monetHistory.sourceByPath.get(state.filePath) ?? monetHistory.activeSource,
    params: { selected: processedIds, frequency: state.frequency, compute_average: Boolean(state.opts.computeAverage), ...(state.opts.qm ? { qm: state.opts.qm } : {}) },
    atoms: processedIds
  }))
```

- Insert as the first statement inside `if (result.error) {`:

```js
    historyDo(P => P.fail(extractStep, result.error)); onHistoryChange()
```

- Replace

```js
  result.sourceAtoms = sourceAtoms
  state.lastResult = result
  updateAnalysisSource()
```

with

```js
  result.sourceAtoms = sourceAtoms
  state.lastResult = result
  if (extractStep != null) await historyExtracted(extractStep, result, sourceAtoms)
  updateAnalysisSource()
```

- [ ] **Step 8: Hook clears, exports, the cell, the time axis and the versions**

In the `for (const [kind, chart] of Object.entries(charts))` loop, replace the three listeners with:

```js
  $(`clear-${kind}`).addEventListener('click', () => { historyClear(kind); clearAnalysis(kind) })
  $(`download-${kind}`).addEventListener('click', async () => {
    try {
      await chart.downloadPNG(`MONET-${kind}.png`)
      historyRecord({ kind: 'export', action: 'png', params: { chart: kind, file: `MONET-${kind}.png` } })
      setStatus('Plot PNG download started.')
    } catch (error) { setStatus(error.message) }
  })
  $(`csv-${kind}`).addEventListener('click', () => {
    try {
      chart.downloadCSV(`MONET-${kind}.csv`)
      historyRecord({ kind: 'export', action: 'csv', params: { chart: kind, file: `MONET-${kind}.csv` } })
      setStatus('CSV download started.')
    } catch (error) { setStatus(error.message) }
  })
```

Replace `$('btn-clear-analyses').addEventListener('click', () => clearAllAnalyses())` with:

```js
$('btn-clear-analyses').addEventListener('click', () => { for (const kind of Object.keys(charts)) historyClear(kind); clearAllAnalyses() })
```

In the `cell-apply` handler, after `    setStatus('Crystal cell applied without changing Cartesian coordinates.')`, insert:

```js
    historyRecord({ kind: 'cell', action: 'apply', params: { cell: aseState.cellParameters, pbc: aseState.cellPbc, mic: aseState.mic } })
```

Replace the `cell-reset` and `ase-mic` handlers with:

```js
$('cell-reset').addEventListener('click', () => {
  aseState.cellParameters = null
  invalidateCellAnalyses()
  historyRecord({ kind: 'cell', action: 'reset', params: { mic: aseState.mic } })
})
$('ase-mic').addEventListener('change', () => {
  aseState.mic = $('ase-mic').checked
  invalidateCellAnalyses()
  historyRecord({ kind: 'cell', action: 'mic', params: { mic: aseState.mic } })
})
```

In the `cell-read` handler, after the line that starts with ``    $('cell-status').textContent = `Using source cell (``, insert:

```js
    historyRecord({ kind: 'cell', action: 'source', params: { cellpar: info.cellpar, pbc: info.pbc } })
```

In the `cell-load-file` handler, after `    const name = fp.split(/[\\/]/).pop()` (the line directly after `updateCellPreset()`), insert:

```js
    historyRecord({ kind: 'cell', action: 'file', params: { name, cellpar: info.cellpar } })
```

After the `for (const kind of ['time-step', 'time-unit', 'time-stride']) { … }` loop, add:

```js
// The time axis is logged once a value is committed (change event), not on every keystroke.
function recordTimeAxis () {
  const axis = timeAxis()
  if (!axis) return
  const params = { timestep: Number($('md-timestep').value), unit: $('md-timestep-unit').value, steps_per_frame: axis.stride, dt: axis.dt }
  const key = JSON.stringify(params)
  if (key === monetHistory.lastTime) return
  monetHistory.lastTime = key
  historyRecord({ kind: 'time', params })
}
for (const input of $$('.time-step, .time-unit, .time-stride')) input.addEventListener('change', recordTimeAxis)
```

In `checkAseStatus`, after `  aseState.mdanalysis = r?.mdanalysis_version || null`, insert:

```js
  monetHistory.env = {
    monet_version: MONET_VERSION, python: r?.python_version ?? null, ase: r?.ase_version ?? null,
    mdanalysis: r?.mdanalysis_version ?? null, numpy: r?.numpy_version ?? null, scipy: r?.scipy_version ?? null
  }
  historyDo(P => P.setEnvironment(monetHistory.env))
```

- [ ] **Step 9: Run the new and existing UI tests**

Run:
```bash
PYTHON=.venv/bin/python node tests/history-ui.cjs
PYTHON=.venv/bin/python node tests/ase-ui.cjs
```
Expected: two `PASS: …` lines; the ase-ui count is the same as before this task.

If a history-ui check fails because of mock timing (a handler still awaiting), raise the `settle()` count at that point. Do not change the assertions.

- [ ] **Step 10: Commit**

```bash
git add renderer.js index.html start_monet.py tests/ase-ui.cjs tests/history-ui.cjs
git commit -m "feat(history): log loads, analyses, derived trajectories, extraction, cell, time axis and exports"
```

---

### Task 7: History drawer and console

**Files:**
- Modify: `index.html` (toggle button and drawer markup), `styles.css`, `renderer.js`
- Test: `tests/history-ui.cjs` (append checks)

**Interfaces:**
- Consumes:
  - `monetHistory`, `historyDo`, `onHistoryChange` (Task 6);
  - `MonetConsole` (Task 2), `MonetReport.stepText` / `resultText` (Task 3).
- Produces:
  - `renderHistory()`;
  - `runConsoleLine(text)` (the tests reach it through `window.testMonet`);
  - `revealPanel(tab)`;
  - `CONSOLE_FORMS` (action → `{ tab, button, fill(args) }`);
  - `downloadText(text, name, type)` (used by Task 8).
- DOM ids: `history-toggle`, `history-drawer`, `history-tab-console`, `history-tab-log`, `history-pause`, `history-save-badge`, `history-readonly`, `history-close`, `console-lines`, `console-output`, `console-input`, `history-filters`, `history-list`, `history-detail`, `history-detail-text`, `history-note`, `history-final`, `history-final-only`, `history-save-session`, `history-open-session`, `history-export-methods`, `history-export-replay`.

How a console run works:
1. The console fills the panel's controls with the call's values.
2. It shows that panel and clicks the panel's own Run button.

The buttons' checks and drawing code therefore run unchanged, and `runAse` logs the step. If the panel refuses the input before `runAse` starts, the status-bar message is shown in the console.

- [ ] **Step 1: Write the failing checks.** In `tests/history-ui.cjs`:
  - in the `window.testMonet = { … }` export string, change `monetHistory, saveHistoryNow };` to `monetHistory, saveHistoryNow, runConsoleLine };`;
  - replace the line `  // ── more checks ──` with:

```js
  // ── drawer and console ──
  await click('history-toggle')
  assert.equal(el('history-drawer').classList.contains('hidden'), false); assert.equal(el('history-pause').textContent, 'History: on'); checks++
  const lines = () => [...el('console-lines').children].map(row => row.textContent)
  assert.ok(lines().some(line => line.startsWith(`#${acf.id} acf(`) && line.includes('τ_int (fs) = 40')), lines().join('\n')); checks++
  assert.ok(el('console-lines').querySelector(`[data-step="${acf.id}"]`).classList.contains('status-cleared')); checks++
  // Click a line, edit it, Enter: the panel runs with the new value and the new step links to the original.
  el('console-lines').querySelector(`[data-step="${acf.id}"]`).click()
  assert.equal(el('console-input').value, acf.call); checks++
  await w.testMonet.runConsoleLine(acf.call.replace('tau_int_method="sokal"', 'tau_int_method="geyer"')); await settle()
  const rerun = steps().at(-1)
  assert.equal(rerun.action, 'acf'); assert.equal(rerun.rerun_of, acf.id); assert.equal(latestCommand.tau_int_method, 'geyer'); assert.equal(el('acf-tauint').value, 'geyer'); checks++
  assert.ok(el('ase-sub-acf').classList.contains('active')); checks++
  // Errors are shown in the console and nothing runs.
  await w.testMonet.runConsoleLine('acf(lag=3)')
  assert.match(el('console-output').textContent, /acf has no parameter 'lag'\. Did you mean 'max_lag'\?/); assert.ok(el('console-output').classList.contains('console-error')); checks++
  await w.testMonet.runConsoleLine('acf(dt=9)')
  assert.match(el('console-output').textContent, /dt comes from the time axis/); checks++
  await w.testMonet.runConsoleLine('import os')
  assert.match(el('console-output').textContent, /Expected '\('/); checks++
  await w.testMonet.runConsoleLine('help(acf)')
  assert.match(el('console-output').textContent, /^acf\(quantity, groups/); assert.equal(el('console-output').classList.contains('console-error'), false); checks++
  count = steps().length
  await w.testMonet.runConsoleLine('bonds(pairs=[[1, 99]], frame_step=1)'); await settle()
  assert.match(el('console-output').textContent, /MONET atom 99/); assert.equal(steps().length, count); checks++
  // ↑ recalls the previous input.
  el('console-input').value = ''
  el('console-input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp' }))
  assert.equal(el('console-input').value, 'bonds(pairs=[[1, 99]], frame_step=1)'); checks++
  // Pause and resume from the drawer.
  await click('history-pause')
  assert.equal(el('history-pause').textContent, 'History: paused'); assert.equal(H.session.data.paused, true); checks++
  count = steps().length
  await click('btn-run-rmsd')
  assert.equal(steps().length, count); checks++
  await click('history-pause')
  assert.equal(el('history-pause').textContent, 'History: on'); assert.ok(lines().some(line => /history paused/.test(line))); checks++
  // History tab: details, note, final mark, filters.
  await click('history-tab-log')
  el('history-list').querySelector(`[data-step="${acf.id}"]`).click()
  assert.match(el('history-detail-text').textContent, new RegExp(`^#${acf.id} analysis acf · S1`)); checks++
  el('history-note').value = 'use this'; el('history-note').dispatchEvent(new w.Event('input'))
  el('history-final').checked = true; el('history-final').dispatchEvent(new w.Event('change'))
  assert.equal(H.session.step(acf.id).note, 'use this'); assert.equal(H.session.step(acf.id).final, true); checks++
  el('history-filters').querySelector('[data-filter="cleared"]').click()
  assert.equal(el('history-list').querySelector(`[data-step="${acf.id}"]`), null); checks++
  el('history-filters').querySelector('[data-filter="cleared"]').click()
  // Ctrl+` toggles the drawer.
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: '`', ctrlKey: true }))
  assert.equal(el('history-drawer').classList.contains('hidden'), true); checks++
  // ── session checks ──
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PYTHON=.venv/bin/python node tests/history-ui.cjs`
Expected: failure (`Cannot read properties of null (reading 'click')` for `history-toggle`).

- [ ] **Step 3: Markup (`index.html`)**

In the title bar, insert before `<button class="theme-toggle" id="theme-toggle" …>`:

```html
    <button class="theme-toggle" id="history-toggle" type="button" aria-pressed="false" title="Analysis history and console (Ctrl+`)">History</button>
```

Insert before `<script src="xyz.js"></script>`:

```html
<!-- ===== ANALYSIS HISTORY AND CONSOLE ===== -->
<aside class="history-drawer hidden" id="history-drawer" aria-label="Analysis history and console">
  <div class="history-head">
    <button class="history-tab active" id="history-tab-console" data-htab="console" type="button">Console</button>
    <button class="history-tab" id="history-tab-log" data-htab="log" type="button">History</button>
    <button class="btn btn-sm" id="history-pause" type="button" aria-pressed="false">History: on</button>
    <span class="history-badge hidden" id="history-save-badge">history not saved</span>
    <span class="history-badge hidden" id="history-readonly">read-only</span>
    <button class="history-close" id="history-close" type="button" title="Close">×</button>
  </div>
  <div class="history-pane active" id="history-pane-console">
    <div class="console-lines" id="console-lines" role="log"></div>
    <div class="console-output hidden" id="console-output"></div>
    <div class="console-input-row">
      <span class="console-prompt">›</span>
      <input class="field-input console-input" id="console-input" spellcheck="false" autocomplete="off" placeholder='acf(quantity="dihedral", groups=[[1, 2, 3, 4]])   ·   help()' />
    </div>
  </div>
  <div class="history-pane" id="history-pane-log">
    <div class="history-filters" id="history-filters">
      <label><input type="checkbox" data-filter="analysis" checked /> analyses</label>
      <label><input type="checkbox" data-filter="derive" checked /> derived</label>
      <label><input type="checkbox" data-filter="export" checked /> exports</label>
      <label><input type="checkbox" data-filter="error" checked /> errors</label>
      <label><input type="checkbox" data-filter="cleared" checked /> cleared</label>
      <label><input type="checkbox" data-filter="other" checked /> inputs &amp; settings</label>
    </div>
    <ol class="history-list" id="history-list"></ol>
    <div class="history-detail hidden" id="history-detail">
      <pre id="history-detail-text"></pre>
      <label class="field-label" for="history-note">Note</label>
      <textarea class="field-input" id="history-note" rows="2"></textarea>
      <label><input type="checkbox" id="history-final" /> ☆ final (use in the paper)</label>
    </div>
    <div class="history-actions">
      <button class="btn btn-sm" id="history-save-session" type="button">Save session</button>
      <button class="btn btn-sm" id="history-open-session" type="button">Open session</button>
      <button class="btn btn-sm" id="history-export-methods" type="button">Export methods report</button>
      <button class="btn btn-sm" id="history-export-replay" type="button">Export replay.py</button>
      <label><input type="checkbox" id="history-final-only" /> final steps only</label>
    </div>
  </div>
</aside>
```

- [ ] **Step 4: Styles (`styles.css`, append at the end)**

```css
/* ── Analysis history drawer and console ── */
.history-drawer { position: fixed; top: 56px; right: 0; bottom: 0; width: min(460px, 92vw); z-index: 40; display: flex; flex-direction: column; background: var(--bg2); border-left: 1px solid var(--border-strong); box-shadow: var(--shadow); font-size: 12px; }
.history-drawer.hidden, .history-drawer .hidden { display: none !important; }
.history-head { display: flex; align-items: center; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); }
.history-tab { background: none; border: 1px solid transparent; border-radius: 6px; padding: 4px 10px; color: inherit; cursor: pointer; font: inherit; }
.history-tab.active { border-color: var(--accent); color: var(--accent); }
.history-close { margin-left: auto; background: none; border: none; color: inherit; font-size: 18px; cursor: pointer; }
.history-badge { color: #d9534f; font-weight: 600; }
.history-pane { display: none; flex: 1; min-height: 0; flex-direction: column; padding: 8px; gap: 8px; }
.history-pane.active { display: flex; }
.console-lines, .history-list, .console-output, .history-detail pre { font-family: ui-monospace, Menlo, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
.console-lines { flex: 1; overflow: auto; }
.console-line { padding: 2px 4px; border-radius: 4px; }
.console-rerunnable { cursor: pointer; }
.console-rerunnable:hover, .history-item:hover { background: var(--bg3); }
.status-cleared { opacity: .55; text-decoration: line-through; }
.status-error { color: #d9534f; }
.kind-pause, .kind-resume { color: var(--gold); text-align: center; }
.console-output { padding: 4px 6px; border-radius: 4px; background: var(--bg3); }
.console-output.console-error { color: #d9534f; }
.console-input-row { display: flex; align-items: center; gap: 6px; }
.console-prompt { color: var(--accent); font-weight: 700; }
.console-input { flex: 1; font-family: ui-monospace, Menlo, Consolas, monospace; }
.history-filters, .history-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.history-list { flex: 1; overflow: auto; margin: 0; padding-left: 0; list-style: none; }
.history-item { padding: 3px 6px; border-radius: 4px; cursor: pointer; }
.history-item.selected { background: var(--bg3); outline: 1px solid var(--accent); }
.history-detail pre { margin: 0 0 6px; }
```

- [ ] **Step 5: Drawer, history list and console (`renderer.js`)**

Add as the last statement inside `function updateAseControls () {`:

```js
  if ($('console-input')) $('console-input').disabled = aseState.busy || monetHistory.readOnly
```

Append at the end of `renderer.js`:

```js
// =============================================================================
// ── Analysis history drawer and console ──────────────────────────────────────
// =============================================================================

function stepHeadline (step) {
  if (step.kind === 'pause') return `── history paused ${step.time.slice(11, 19)} ──`
  if (step.kind === 'resume') return `── history resumed ${step.time.slice(11, 19)} ──`
  const result = MonetReport.resultText(step.result)
  const tail = step.status === 'error' ? ` ✗ ${step.error}` : step.status === 'running' ? ' …' : result ? ` → ${result}` : ''
  return `#${step.id} ${MonetReport.stepText(step)}${tail}`
}
const historyFilter = step => step.status === 'error' ? 'error' : step.status === 'cleared' ? 'cleared' : ['analysis', 'derive', 'export'].includes(step.kind) ? step.kind : 'other'

function renderHistory () {
  if (!$('history-drawer')) return
  const steps = monetHistory.session.data.steps
  const lines = $('console-lines')
  lines.replaceChildren(...steps.filter(step => step.kind !== 'clear').map(step => {
    const row = document.createElement('div')
    row.className = `console-line status-${step.status} kind-${step.kind}`
    row.dataset.step = step.id
    row.textContent = stepHeadline(step)
    if (step.call && MonetConsole.names().includes(step.action)) {
      row.classList.add('console-rerunnable')
      row.title = 'Click to copy this call into the input line, edit it and press Enter'
      row.addEventListener('click', () => {
        $('console-input').value = step.call
        monetHistory.consoleRerun = { id: step.id, action: step.action }
        $('console-input').focus()
      })
    }
    return row
  }))
  lines.scrollTop = lines.scrollHeight
  const shown = new Set([...$$('#history-filters input:checked')].map(input => input.dataset.filter))
  $('history-list').replaceChildren(...steps.filter(step => shown.has(historyFilter(step))).map(step => {
    const item = document.createElement('li')
    item.className = `history-item status-${step.status}${step.id === monetHistory.selected ? ' selected' : ''}`
    item.dataset.step = step.id
    item.textContent = `${step.final ? '☆ ' : ''}${stepHeadline(step)}`
    item.addEventListener('click', () => { monetHistory.selected = step.id; renderHistory() })
    return item
  }))
  renderHistoryDetail()
  const paused = monetHistory.session.data.paused
  $('history-pause').textContent = paused ? 'History: paused' : 'History: on'
  $('history-pause').setAttribute('aria-pressed', String(paused))
  $('history-readonly').classList.toggle('hidden', !monetHistory.readOnly)
}

function renderHistoryDetail () {
  const session = monetHistory.session
  const step = session.step(monetHistory.selected)
  $('history-detail').classList.toggle('hidden', !step)
  if (!step) return
  const lines = [`#${step.id} ${step.kind}${step.action ? ' ' + step.action : ''} · ${step.source || 'no source'} · ${step.time}`, `status: ${step.status}${step.error ? ` (${step.error})` : ''}`, `call: ${MonetReport.stepText(step)}`]
  const result = MonetReport.resultText(step.result)
  if (result) lines.push(`results: ${result}`)
  if (step.source) lines.push(`source: ${session.lineage(step.source)}`)
  for (const output of step.outputs) lines.push(`output: ${output.source ? session.lineage(output.source) : output.file}${output.sha256 ? ` (SHA-256 ${output.sha256.slice(0, 12)}…)` : ''}`)
  if (step.rerun_of) lines.push(`re-run of #${step.rerun_of}`)
  $('history-detail-text').textContent = lines.join('\n')
  if (document.activeElement !== $('history-note')) $('history-note').value = step.note
  $('history-final').checked = step.final
}

function toggleHistoryDrawer (open = $('history-drawer').classList.contains('hidden')) {
  $('history-drawer').classList.toggle('hidden', !open)
  $('history-toggle').setAttribute('aria-pressed', String(open))
  if (open) { renderHistory(); $('console-input').focus() }
}
$('history-toggle').addEventListener('click', () => toggleHistoryDrawer())
$('history-close').addEventListener('click', () => toggleHistoryDrawer(false))
document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.key === '`') { event.preventDefault(); toggleHistoryDrawer() }
})
for (const tab of $$('.history-tab')) {
  tab.addEventListener('click', () => {
    for (const other of $$('.history-tab')) other.classList.toggle('active', other === tab)
    for (const pane of $$('.history-pane')) pane.classList.toggle('active', pane.id === `history-pane-${tab.dataset.htab}`)
    renderHistory()
  })
}
$('history-pause').addEventListener('click', () => {
  historyDo(P => (P.data.paused ? P.resume() : P.pause()))
  onHistoryChange()
})
$('history-filters').addEventListener('change', renderHistory)
$('history-note').addEventListener('input', () => {
  historyDo(P => P.annotate(monetHistory.selected, { note: $('history-note').value }))
  onHistoryChange()
})
$('history-final').addEventListener('change', () => {
  historyDo(P => P.annotate(monetHistory.selected, { final: $('history-final').checked }))
  onHistoryChange()
})

// ── console: a call fills the panel's controls and clicks its Run button ──
function setField (id, value, optional = false) {
  const field = $(id)
  if (!field) throw new Error(`Missing field ${id}.`)
  if (value === undefined && !optional) return
  if (field.type === 'checkbox') field.checked = Boolean(value)
  else field.value = value == null ? '' : Array.isArray(value) ? value.flat(Infinity).join(' ') : String(value)
  field.dispatchEvent(new Event('input'))
  field.dispatchEvent(new Event('change'))
}
const OPTIONAL = true
function fillAcf (a) {
  setField('acf-quantity', a.quantity)
  setField('acf-groups', a.groups)
  setField('acf-step', a.frame_step)
  setField('acf-mode', a.mode)
  setField('acf-fit', a.fit_until)
  setField('acf-fit-model', a.fit_model)
  setField('acf-tauint', a.tau_int_method)
  setField('acf-range', a.angle_range)
  setField('acf-maxlag', a.max_lag, OPTIONAL)
}
function fillMda (a) {
  if (a.analysis !== undefined) { $('mda-analysis').value = a.analysis; $('mda-analysis').dispatchEvent(new Event('change')) }
  setField('mda-step', a.frame_step)
  for (const [key, value] of Object.entries(a.params || {})) {
    if (!$(`mda-p-${key}`)) throw new Error(`mda_run(analysis="${a.analysis}") has no parameter "${key}".`)
    setField(`mda-p-${key}`, key === 'quads' ? value : Array.isArray(value) ? value.join('\n') : value)
  }
}
// Console analysis → panel sub-tab, Run button and the controls its parameters go to.
const CONSOLE_FORMS = {
  rmsd: { tab: 'rmsd', button: 'btn-run-rmsd', fill: a => { setField('rmsd-atoms', a.indices, OPTIONAL); setField('rmsd-step', a.frame_step); setField('rmsd-align', a.align); setField('rmsd-unwrap', a.unwrap); setField('rmsd-reference', a.reference_index, OPTIONAL) } },
  rmsd_matrix: { tab: 'rmsdmatrix', button: 'btn-run-rmsdmatrix', fill: a => { setField('rmsdmatrix-atoms', a.indices, OPTIONAL); setField('rmsdmatrix-step', a.frame_step); setField('rmsdmatrix-max', a.max_frames); setField('rmsdmatrix-align', a.align); setField('rmsdmatrix-unwrap', a.unwrap) } },
  pdd: { tab: 'pdd', button: 'btn-run-pdd', fill: a => { setField('pdd-atoms', a.indices, OPTIONAL); setField('pdd-elements', a.elements, OPTIONAL); setField('pdd-rmax', a.rmax); setField('pdd-bins', a.nbins); setField('pdd-step', a.frame_step) } },
  rdf: { tab: 'rdf', button: 'btn-run-rdf', fill: a => { setField('rdf-atoms', a.indices, OPTIONAL); setField('rdf-elements', a.elements, OPTIONAL); setField('rdf-rmax', a.rmax, OPTIONAL); setField('rdf-bins', a.nbins); setField('rdf-step', a.frame_step) } },
  bonds: { tab: 'bonds', button: 'btn-run-bonds', fill: a => { setField('bonds-pairs', a.pairs); setField('bonds-step', a.frame_step) } },
  angles: { tab: 'angles', button: 'btn-run-angles', fill: a => { setField('angles-triplets', a.triplets); setField('angles-step', a.frame_step); setField('angles-range', a.angle_range); setField('angles-normal', a.angle_normal) } },
  dihedrals: { tab: 'dihedrals', button: 'btn-run-dihedrals', fill: a => { setField('dihedrals-quads', a.quads); setField('dihedrals-step', a.frame_step); setField('dihedrals-range', a.angle_range) } },
  msd: { tab: 'msd', button: 'btn-run-msd', fill: a => { setField('msd-atoms', a.indices, OPTIONAL); setField('msd-step', a.frame_step); setField('msd-drift', a.remove_drift); setField('msd-fit-start', a.fit_start, OPTIONAL); setField('msd-fit-end', a.fit_end, OPTIONAL) } },
  vdos: { tab: 'vdos', button: 'btn-run-vdos', fill: a => { setField('vdos-atoms', a.indices, OPTIONAL); setField('vdos-step', a.frame_step); setField('vdos-mass', a.mass_weighted); setField('vdos-smooth', a.smooth_cm); setField('vdos-max', a.max_cm) } },
  acf: { tab: 'acf', button: 'btn-run-acf', fill: fillAcf },
  equilibration: { tab: 'acf', button: 'btn-run-equil', fill: fillAcf },
  fluctuations: {
    tab: 'fluct', button: 'btn-run-fluct',
    fill: a => {
      setField('fluct-quantity', a.quantity)
      setField('fluct-step', a.frame_step)
      if (a.groups) { setField('fluct-scope', 'groups'); setField('fluct-groups', a.groups) } else { setField('fluct-scope', 'auto'); setField('fluct-atoms', a.indices, OPTIONAL) }
      setField('fluct-align', a.align)
    }
  },
  mda_run: { tab: 'mda', button: 'btn-run-mda', fill: fillMda },
  ase_structure: { tab: 'structure', button: 'btn-run-structure', fill: a => { setField('structure-frame', a.frame); setField('structure-symprec', a.symprec) } },
  ase_coordination: { tab: 'coordination', button: 'btn-run-coordination', fill: a => { setField('coordination-atoms', a.indices, OPTIONAL); setField('coordination-step', a.frame_step) } }
}

function revealPanel (tab) {
  const button = document.querySelector(`.ase-stab[data-stab="${tab}"]`)
  if (!button) return
  showViewerTab(button.dataset.group)
  showGroup(button.dataset.group, tab)
}

function consoleMessage (text, error = false) {
  $('console-output').textContent = text
  $('console-output').classList.toggle('console-error', error)
  $('console-output').classList.toggle('hidden', !text)
}

async function runConsoleLine (text) {
  consoleMessage('')
  historyDo(P => P.addInput(text))
  let call
  try { call = MonetConsole.parse(text) } catch (error) { return consoleMessage(error.message, true) }
  if (call.name === 'help') {
    try { return consoleMessage(MonetConsole.help(call.args.topic)) } catch (error) { return consoleMessage(error.message, true) }
  }
  try { MonetConsole.validate(call.name, call.args) } catch (error) { return consoleMessage(error.message, true) }
  if (monetHistory.readOnly) return consoleMessage('This session is open read-only: load its trajectory to run analyses.', true)
  if (!extractedTrajPath()) return consoleMessage('Load a trajectory first.', true)
  if (aseState.busy) return consoleMessage('Another calculation is running.', true)
  const axis = timeAxis()
  if (call.args.dt !== undefined && !(axis && Math.abs(call.args.dt - axis.dt) <= 1e-9 * Math.max(1, axis.dt))) {
    return consoleMessage(`dt comes from the time axis (now ${axis ? fmt(axis.dt, 6) + ' fs' : 'not set'}): change the MD time step or the MD steps per saved frame in the panel.`, true)
  }
  const form = CONSOLE_FORMS[call.name]
  try { form.fill(call.args) } catch (error) { return consoleMessage(error.message, true) }
  revealPanel(form.tab)
  const rerun = monetHistory.consoleRerun
  monetHistory.consoleRerun = null
  monetHistory.rerunOf = rerun?.action === call.name ? rerun : null
  monetHistory.started = false
  setStatus('')
  $(form.button).click()
  // The panel's handler reaches runAse synchronously (or after an immediate await); if it did
  // not, it refused the input and said why in the status bar.
  await new Promise(resolve => setTimeout(resolve, 0))
  if (!monetHistory.started) {
    monetHistory.rerunOf = null
    consoleMessage($('status-msg').textContent || 'The panel did not accept these parameters.', true)
  }
}

let consoleCursor = null
$('console-input').addEventListener('keydown', event => {
  const inputs = monetHistory.session.data.inputs
  if (event.key === 'Enter') {
    event.preventDefault()
    const text = $('console-input').value.trim()
    if (!text) return
    $('console-input').value = ''
    consoleCursor = null
    runConsoleLine(text)
  } else if (event.key === 'ArrowUp' && inputs.length) {
    event.preventDefault()
    consoleCursor = consoleCursor === null ? inputs.length - 1 : Math.max(0, consoleCursor - 1)
    $('console-input').value = inputs[consoleCursor]
  } else if (event.key === 'ArrowDown' && consoleCursor !== null) {
    event.preventDefault()
    consoleCursor++
    if (consoleCursor >= inputs.length) { consoleCursor = null; $('console-input').value = '' } else $('console-input').value = inputs[consoleCursor]
  } else if (event.key === 'Escape') {
    $('console-input').value = ''
    consoleCursor = null
    monetHistory.consoleRerun = null
  }
})

function downloadText (text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

renderHistory()
```

- [ ] **Step 6: Run the UI tests**

Run:
```bash
PYTHON=.venv/bin/python node tests/history-ui.cjs
PYTHON=.venv/bin/python node tests/ase-ui.cjs
```
Expected: two `PASS: …` lines.

- [ ] **Step 7: Check it in the browser.** Start the launcher, load `examples/torsion.xyz`, open History (button or Ctrl+`) and do the following:
- run an ACF from its panel;
- click its line in the console, change `tau_int_method`, press Enter;
- check that the panel shows the new value and that a new step `re-run of #N` appears.

Take a screenshot of the drawer.

- [ ] **Step 8: Commit**

```bash
git add index.html styles.css renderer.js tests/history-ui.cjs
git commit -m "feat(history): history drawer and console that re-runs analyses through their panels"
```

---

### Task 8: Save, open and resume sessions; export the report and `replay.py`

**Files:**
- Modify: `renderer.js`
- Test: `tests/history-ui.cjs` (append checks)

**Interfaces:**
- Consumes:
  - `downloadText`, `renderHistory` (Task 7);
  - `saveHistoryNow`, `attachSource`, `historyLoad` (Task 6), which calls `offerPreviousHistory(digest)` when it is defined;
  - `MonetReport.methodsReport`, `MonetReplay.replayScript`;
  - `window.monet.sessionExport`, `sessionOpen`, `sessionFind`.
- Produces: `offerPreviousHistory(digest)`, `restoreSettings(data)`, and handlers for `history-save-session`, `history-open-session`, `history-export-methods` and `history-export-replay`.

- [ ] **Step 1: Write the failing checks.** In `tests/history-ui.cjs`, replace the line `  // ── session checks ──` with:

```js
  // ── sessions ──
  const readBlob = blob => new Promise(resolve => { const reader = new w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(blob) })
  let exported
  w.monet.sessionExport = async body => { exported = body; return { ok: true, downloadURL: '/api/download/z1' } }
  await click('history-save-session'); await settle()
  assert.match(exported.methods, /^# Methods: MONET analysis session/); assert.match(exported.replay, /from monet_replay import Session/); checks++
  assert.equal(exported.name, 'MONET-session-torsion.zip'); assert.equal(exported.session.steps.length, steps().length); assert.equal(downloadName, 'MONET-session-torsion.zip'); checks++
  await click('history-export-methods')
  assert.equal(downloadName, 'MONET-methods-torsion.md'); assert.match(await readBlob(pngBlob), /## Reporting checklist/); checks++
  await click('history-export-replay')
  assert.equal(downloadName, 'replay.py'); assert.match(await readBlob(pngBlob), /sys\.exit\(s\.report\(\)\)/); checks++
  // Open: read-only until the matching trajectory is loaded; nothing re-runs.
  const openedData = plain(H.session.toJSON())
  w.monet.sessionOpen = async () => ({ ok: true, session: openedData })
  latestCommand = null
  el('md-timestep').value = '2'
  await click('history-open-session'); await settle()
  assert.equal(H.readOnly, true); assert.equal(el('console-input').disabled, true); assert.match(el('status-msg').textContent, /read-only/); assert.equal(latestCommand, null); checks++
  assert.equal(el('md-timestep').value, '0.5'); checks++
  await click('btn-browse'); await click('next-1'); await settle()
  assert.equal(H.readOnly, false); assert.equal(H.session.data.steps.length, openedData.steps.length); assert.equal(H.activeSource, 'S1'); checks++
  // A different file: confirm starts a new history for it.
  await click('history-open-session'); await settle()
  w.monet.fileDigest = async () => ({ sha256: 'ef'.repeat(32), size: 1 })
  w.confirm = () => true
  await click('btn-browse'); await click('next-1'); await settle()
  assert.equal(H.readOnly, false); assert.equal(H.session.data.sources[0].sha256, 'ef'.repeat(32)); assert.equal(H.session.data.steps.length, 1); checks++
  // A previous autosaved history for the same checksum is offered.
  w.monet.fileDigest = async () => ({ sha256: '12'.repeat(32), size: 1 })
  const previous = { ...openedData, sources: [{ ...openedData.sources[0], sha256: '12'.repeat(32) }] }
  let asked = ''
  w.monet.sessionFind = async () => ({ ok: true, session: previous })
  w.confirm = message => { asked = message; return true }
  await click('btn-browse'); await click('next-1'); await settle()
  assert.match(asked, /Previous history found for torsion\.xyz \(\d+ steps/); assert.equal(H.session.data.steps.length, previous.steps.length); assert.equal(H.activeSource, 'S1'); checks++
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `PYTHON=.venv/bin/python node tests/history-ui.cjs`
Expected: failure (`exported` is undefined, because the Save session button has no handler yet).

- [ ] **Step 3: Session handlers (`renderer.js`, append after the Task 7 block, before the final `renderHistory()` call)**

```js
// ── sessions: save, export, open (read-only until its trajectory is loaded), resume ──
const sessionStem = () => fileName(monetHistory.session.data.sources[0]?.name || 'session').replace(/\.[^.]*$/, '') || 'session'

function downloadLink (url, name) {
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
}

$('history-save-session').addEventListener('click', async () => {
  const data = monetHistory.session.toJSON()
  const name = `MONET-session-${sessionStem()}.zip`
  if (window.monet.hasAseServer && window.monet.sessionExport) {
    let r
    try {
      r = await window.monet.sessionExport({ session: data, methods: MonetReport.methodsReport(data), replay: MonetReplay.replayScript(data), name })
    } catch (error) { r = { ok: false, error: error.message } }
    if (!r?.ok) return setStatus('Could not save the session: ' + (r?.error || r?.message || 'unknown error'))
    downloadLink(r.downloadURL, name)
    return setStatus('Session ZIP download started: session.json, methods report and replay.py.')
  }
  downloadText(JSON.stringify(data, null, 1), `MONET-session-${sessionStem()}.json`, 'application/json')
  setStatus('Session file download started (the ZIP with the report and replay.py needs the launcher).')
})

$('history-export-methods').addEventListener('click', () => {
  const text = MonetReport.methodsReport(monetHistory.session.toJSON(), { finalOnly: $('history-final-only').checked })
  downloadText(text, `MONET-methods-${sessionStem()}.md`, 'text/markdown')
  setStatus('Methods report download started.')
})

$('history-export-replay').addEventListener('click', () => {
  downloadText(MonetReplay.replayScript(monetHistory.session.toJSON()), 'replay.py', 'text/x-python')
  setStatus('replay.py download started: run it with python replay.py --monet /path/to/MONET next to the trajectory.')
})

// The last logged time axis and applied cell are put back in the panel; nothing is re-run.
function restoreSettings (data) {
  const last = test => [...data.steps].reverse().find(step => step.status === 'ok' && test(step))
  const time = last(step => step.kind === 'time')
  if (time) {
    $('md-timestep').value = time.params.timestep
    $('md-timestep-unit').value = time.params.unit
    $('md-stride').value = time.params.steps_per_frame
    for (const id of ['md-timestep', 'md-timestep-unit', 'md-stride']) $(id).dispatchEvent(new Event('input'))
    monetHistory.lastTime = JSON.stringify(time.params)
  }
  const cell = last(step => step.kind === 'cell' && step.action === 'apply')
  if (cell?.params.cell) {
    $('cell-system').value = 'triclinic'
    cell.params.cell.forEach((value, i) => { $(`cell-${cellFields[i]}`).value = value })
    ;['a', 'b', 'c'].forEach((axis, i) => { $(`cell-pbc-${axis}`).checked = Boolean(cell.params.pbc?.[i]) })
    updateCellPreset()
  }
}

$('history-open-session').addEventListener('click', async () => {
  const r = await window.monet.sessionOpen?.()
  if (!r) return
  if (!r.ok) return setStatus('Could not open the session: ' + (r.error || r.message))
  let restored
  try { restored = MonetProvenance.fromJSON(r.session) } catch (error) { return setStatus('Could not open the session: ' + error.message) }
  await saveHistoryNow()
  monetHistory.session = restored
  monetHistory.readOnly = true
  monetHistory.stepByKind = {}
  monetHistory.sourceByPath.clear()
  monetHistory.stepByPath.clear()
  monetHistory.activeSource = null
  monetHistory.selected = null
  restoreSettings(restored.data)
  updateAseControls()
  onHistoryChange()
  const source = restored.data.sources[0]
  setStatus(`Session opened read-only: ${restored.data.steps.length} steps. Load ${source?.name || 'its trajectory'}${source?.sha256 ? ` (SHA-256 ${source.sha256.slice(0, 12)}…)` : ''} to continue it; nothing is re-run automatically.`)
})

// After loading a trajectory: offer the newest autosaved history of the same file.
async function offerPreviousHistory (digest) {
  if (!digest?.sha256 || !window.monet.sessionFind) return
  let found
  try { found = await window.monet.sessionFind(digest.sha256) } catch { return }
  const previous = found?.ok ? found.session : null
  if (!previous || !Array.isArray(previous.steps) || previous.steps.length < 2) return
  const name = fileName(state.source.original)
  if (!window.confirm(`Previous history found for ${name} (${previous.steps.length} steps, last change ${String(previous.updated).slice(0, 10)}). Continue it? Cancel starts a new history.`)) return
  let restored
  try { restored = MonetProvenance.fromJSON(previous) } catch (error) { return setStatus('The previous history could not be read: ' + error.message) }
  monetHistory.session = restored
  attachSource(restored.data.sources[0].id)
  onHistoryChange()
}
```

- [ ] **Step 4: Run the UI tests**

Run:
```bash
PYTHON=.venv/bin/python node tests/history-ui.cjs
PYTHON=.venv/bin/python node tests/ase-ui.cjs
```
Expected: two `PASS: …` lines.

- [ ] **Step 5: Check it in the browser.** With the launcher:
1. Load `examples/torsion.xyz` and run two analyses.
2. Click *Save session*; the ZIP must contain `session.json`, `methods.md` and `replay.py`.
3. Reload the page and load the same file: the "Previous history found" prompt appears.
4. Unzip, then run `python replay.py --monet <repo>` next to a copy of the trajectory. Every line must be `OK`.

- [ ] **Step 6: Commit**

```bash
git add renderer.js tests/history-ui.cjs
git commit -m "feat(history): save, open and resume sessions; export the methods report and replay.py"
```

---

### Task 9: Documentation and full test run

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: CHANGELOG.** Add to the `## Unreleased` section:

```markdown
- Analysis history:
  - MONET keeps a text log of every step that changes a result: input files with SHA-256, cell, time axis, analyses with their parameters and key numbers, derived trajectories, extraction and exports;
  - it is autosaved in `~/.monet/sessions/` (launcher option `--sessions-dir`) and can be paused and resumed;
  - cleared analyses stay in the log, marked *cleared*.
- History drawer (History button or Ctrl+`):
  - a console shows every analysis as a readable call such as `acf(quantity="dihedral", groups=[[1, 2, 3, 4]], …)`;
  - click a line, edit it and press Enter to re-run it through its panel; the new step is linked to the original;
  - the History tab has filters, notes and a *final* mark.
- Sessions:
  - *Save session* downloads a ZIP with `session.json`, a methods report (Markdown, and Word when pandoc is installed) and `replay.py`;
  - *Open session* restores the log read-only until the trajectory with the same SHA-256 is loaded;
  - loading a trajectory offers its previous history.
- Methods report: software versions with citations, input checksums, the steps with their key numbers, and the reporting checklist of the workflow document pre-filled.
- `replay.py`: re-runs the logged analyses without the browser (`python replay.py --monet /path/to/MONET`), checks the input checksums and reports every number that differs from the logged one (`--rtol`, default 1e-6).
```

- [ ] **Step 2: README.** Add a section after the analysis section (use the README's heading level for feature sections):

```markdown
### Analysis history, console and replay

MONET keeps a text log of every step that changes a result. The log contains:
- the input file, with its SHA-256;
- the cell and the time axis;
- each analysis, with its parameters and key numbers;
- derived trajectories, extraction and exports.

View-only actions such as rotating, zooming or changing colours are not logged. The log stays on your computer: the launcher autosaves it in `~/.monet/sessions/` (change the folder with `--sessions-dir`), and it stores file names, never full paths.

Open **History** (Ctrl+`) for the drawer:

- **Console:**
  - Each step appears as a call, for example `acf(quantity="dihedral", groups=[[228, 227, 289, 225]], dt=0.4838, tau_int_method="sokal")`.
  - Click a line, edit it and press Enter. The analysis runs again through its panel, with the same checks as the Run button, and the new step is linked to the original.
  - `help()` lists the analyses; `help(acf)` lists the parameters of one.
  - Atoms are MONET IDs; `dt` comes from the time axis.
- **History:**
  - filters, details and parent chains (e.g. `S1 → #9 subsample → S2`);
  - a note and a ☆ *final* mark on each step;
  - *History: on / paused*: while paused, nothing is logged, and the report and `replay.py` warn about the gap.
- **Save session:** a ZIP containing:
  - `session.json`;
  - `methods.md`, and `methods.docx` when pandoc is installed. The report lists the software versions with citations, the input checksums and the steps, and pre-fills the reporting checklist of `docs/md-analysis-workflow.md` §12.
  - `replay.py`.
- **Open session:**
  - It restores a saved log read-only and never re-runs anything.
  - Load the trajectory with the same SHA-256 to continue it.
  - Loading a trajectory also offers its previous autosaved history.
- **replay.py:**
  - Run `python replay.py --monet /path/to/MONET` in the folder that holds the trajectory.
  - It checks the input checksums (`--force` skips this), re-runs each step headless, writes `stepNN_<action>.json` to `--out`, and prints `OK` or `DIFF` against the logged numbers (`--rtol`, default 1e-6).
  - Edit it like a notebook.
```

- [ ] **Step 3: Run every suite**

```bash
for t in regression qm-parity formats analysis mdanalysis ase-integration ase-ui provenance console report session replay history-ui; do PYTHON=.venv/bin/python node tests/$t.cjs || echo "FAILED: $t"; done
```

Expected: 13 `PASS: …` lines and no `FAILED`.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: analysis history, console, sessions and replay"
```

---

## Self-review notes (for the executor)

- **Spec coverage:**

  | Spec | Task |
  | --- | --- |
  | Data model | 1 |
  | Console grammar, whitelist and suggestions | 2 |
  | Report | 3 |
  | Checksums and persistence | 4 |
  | Replay | 5 |
  | Capture | 6 |
  | Drawer and console UI | 7 |
  | Save, open and resume | 8 |
  | Documentation | 9 |

  The error-handling table of the spec is covered in Tasks 4–8, with tests.
- **Deliberate refinements of the spec** (also recorded in the spec's last section):
  - the console list holds the 15 analyses the panels actually run (`mda_run` instead of the unused `mda_rmsf`/`mda_rgyr`/`mda_hbonds`);
  - QM inputs are part of the `extract` step;
  - figure and CSV exports record the file name only, while derived trajectories carry a SHA-256;
  - key numbers use raw dotted paths (compared by replay) and `stat:` keys (display only);
  - a console run fills the panel and clicks its Run button, so validation and drawing are shared;
  - autosave file names include the creation time, and `find` prefers the newest history with more than the load step.

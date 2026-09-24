'use strict'
// DOM integration tests use jsdom and a real Canvas implementation; no browser/network is needed.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM } = require('jsdom')
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const root = path.resolve(__dirname, '..')
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), { runScripts: 'outside-only', url: 'http://localhost/' })
const w = dom.window
const canvasMap = new WeakMap()
for (const axis of ['width', 'height']) {
  const original = Object.getOwnPropertyDescriptor(w.HTMLCanvasElement.prototype, axis)
  Object.defineProperty(w.HTMLCanvasElement.prototype, axis, {
    get: original.get,
    set (value) { original.set.call(this, value); if (canvasMap.has(this)) canvasMap.get(this)[axis] = value }
  })
}
w.HTMLCanvasElement.prototype.getContext = function () {
  if (!canvasMap.has(this)) canvasMap.set(this, createCanvas(this.width, this.height))
  return canvasMap.get(this).getContext('2d')
}
w.HTMLCanvasElement.prototype.toBlob = function (callback) {
  callback(new Blob([canvasMap.get(this).toBuffer('image/png')], { type: 'image/png' }))
}
Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get: () => 900 })
Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get: () => 420 })
let pngBlob, downloadName
w.URL.createObjectURL = blob => { pngBlob = blob; return 'blob:test' }
w.URL.revokeObjectURL = () => {}
w.HTMLAnchorElement.prototype.click = function () { downloadName = this.download }
const atoms = [
  { index: 1, element: 'C', x: 1, y: 0, z: 0 },
  { index: 2, element: 'C', x: 0, y: 0, z: 0 },
  { index: 3, element: 'C', x: 0, y: 1, z: 0 },
  { index: 4, element: 'H', x: 0, y: 1, z: 1 }
]
let lastProcessOptions, importCalls = []
let activeAtoms = atoms, latestCommand, pendingResolve, defer = false, checks = 0
const listeners = new Set()
let nextFile = 'torsion.xyz'
let frameCount = 2
const framesCommands = []
const topologyCommands = []
let topologyBreak = false
// Registered analyses as the Python side lists them (monet_registry.py: MDAnalysis and the example plugins).
const REGISTRY = JSON.parse(require('node:child_process').execFileSync(process.env.PYTHON || 'python3', [path.join(root, 'ase_bridge.py')], { input: '{"action": "list_analyses"}', encoding: 'utf8' }).trim().split('\n').pop())
w.monet = {
  listAnalyses: async () => REGISTRY,
  isBrowser: true, selectFile: async () => nextFile,
  canImport: true,
  importFile: async (name, options) => { importCalls.push([name, options]); return { filePath: 'imported/' + name + '.extxyz', sourceLabel: 'VASP XDATCAR', frames: 2, warning: name.endsWith('.dcd') ? 'No topology was given: every atom is imported as element X.' : undefined } },
  releaseFile: () => {},
  listFormats: async () => ({ ok: true, mdanalysis: '2.10.0', ase: [{ name: 'gromacs', description: 'Gromacs coordinates' }, { name: 'xyz', description: 'XYZ-file' }] }),
  analyzeFile: async () => ({ atomCount: 4, configCount: frameCount, format: 'XYZ' }),
  aseSelectOutput: async name => name,
  readFrame: async () => ({ atoms }),
  onProgress () {}, onAseProgress: callback => { listeners.add(callback); return () => listeners.delete(callback) },
  aseCheck: async () => ({ ok: true, ase_version: 'test', mdanalysis_version: '2.10.0' }),
  processTrajectory: async options => {
    lastProcessOptions = options
    activeAtoms = atoms.filter(atom => options.selectedAtoms.includes(atom.index))
    return { success: true, totalFrames: 2, sampledFrames: 2, outputDir: 'MONET-results' }
  },
  aseRun: async command => {
    if (command.action === 'frames') {
      framesCommands.push(command)
      return {
        ok: true, nframes: frameCount, natoms: activeAtoms.length, indices: command.indices,
        positions: command.indices.map(f => activeAtoms.flatMap(a => [a.x + f, a.y, a.z])), cells: command.indices.map(() => null)
      }
    }
    if (command.action === 'topology') {
      topologyCommands.push(command)
      const n = activeAtoms.length
      const symbols = activeAtoms.map(a => a.element)
      return {
        ok: true, n_atoms: n, n_frames: frameCount, symbols, positions: activeAtoms.map(a => [a.x, a.y, a.z]),
        mdanalysis: {
          index: [...Array(n).keys()], id: topologyBreak ? command.atom_ids.map(id => id + 1) : command.atom_ids, name: symbols.map((e, i) => e + (i + 1)),
          element: symbols, resname: symbols.map(() => 'C3H'), resid: symbols.map(() => 1), fragment: symbols.map(() => 0), mass: symbols.map(e => e === 'H' ? 1.008 : 12.011),
          n_bonds: 3, n_residues: 1, n_fragments: 1, positions: activeAtoms.map(a => [a.x, a.y, a.z])
        }
      }
    }
    if (command.action === 'read_info') return { ok: true, n_atoms: activeAtoms.length, symbols: activeAtoms.map(a => a.element), positions: activeAtoms.map(a => [a.x, a.y, a.z]) }
    latestCommand = command
    if (command.action === 'subsample') {
      latestCommand = command
      const kept = Math.floor((w.testMonet.state.fileInfo.configCount - 1) / command.stride) + 1
      return { ok: true, n_frames: kept, source_frames: w.testMonet.state.fileInfo.configCount, stride: command.stride, start: 0, first: 0, last: (kept - 1) * command.stride }
    }
    if (command.action === 'cell_file') return { ok: true, cellpar: [10.3528, 13.029, 21.211, 96.2968, 97.439, 98.371], note: '' }
    if (command.action === 'select_atoms') return command.pattern
      ? { ok: true, groups: [[0, 1, 2, 3]], n_groups: 1, truncated: false }
      : { ok: true, indices: [...command.indices, ...activeAtoms.map((_, i) => i).filter(i => !command.indices.includes(i))] }
    if (command.action === 'molecule') return { ok: true, indices: [command.seed, ...activeAtoms.map((_,i) => i).filter(i => i !== command.seed)] }
    if (defer) return new Promise(resolve => { pendingResolve = resolve })
    if (command.action === 'dihedrals') return { ok: true, frame_indices: [0, 1], series: { [command.quads[0].join('-')]: [270, 90] } }
    if (command.action === 'acf') return { ok: true, lags: [0, 10, 20, 30], acf: [1, .6, .3, .1], fit_curve: [1, .5, .25, .12], tau_fit: 43.6, tau_fit_error: 2.2, tau_int: 40, tau_int_error: 5, tau_int_window: 3, tau_int_converged: true, tau_int_method: command.tau_int_method, fit_end: 30, fit_points: 4, decorrelated: false, dt: command.dt * (command.frame_step || 1), frame_step: command.frame_step || 1, n_frames: 4, n_effective: 2, mode: command.mode, statistics: [{ mean: 90, std: 10, sem: 7 }], distribution: { x: [45, 135], density: [0.004, 0.007] }, frame_indices: [0, 1, 2, 3], blocking: { sizes: [1, 2], times: [command.dt, 2 * command.dt], sem: [0.5, 0.7], sem_error: [0.01, 0.05], plateau_index: null, plateau_sem: null, g: null } }
    if (command.action === 'equilibration') { latestCommand = command; return { ok: true, starts: [0, 1, 2], times: [0, command.dt, 2 * command.dt], g: [4, 2, 2], n_effective: [1, 1.5, 0.5], t0: 1, t0_time: command.dt, t0_frame: 1, group: 0, per_group_t0: [1], n_frames: 4, frame_step: 1, dt: command.dt, g_t0: 2, n_effective_t0: 1.5, n_effective_full: 1 } }
    if (command.action === 'rmsd_matrix') return { ok: true, matrix: [[0, 1], [1, 0]], frame_indices: [0, 10], aligned: true, truncated: false }
    if (command.action === 'msd') return { ok: true, times: [0, 1, 2, 3], series: { selection: [0, 1, 2, 3] }, fits: { selection: { slope: 1, intercept: 0, r2: 1, D_A2_fs: 1 / 6, D_cm2_s: 1 / 60 } }, fit_start: 1, fit_end: 2, periodic: false, frame_indices: [0, 1, 2, 3], dt: command.dt }
    if (command.action === 'vdos') return { ok: true, wavenumber: [0, 500, 1000], intensity: [0, .002, 0], nyquist_cm: 33356, resolution_cm: 8.3, n_frames: 100, dt: command.dt }
    if (command.action === 'mda_select') return { ok: true, indices: [1, 3], n_atoms: 2, n_residues: 1, residues: ['MOL1'] }
    if (command.action === 'mda_run' && command.analysis === 'rmsf') return { ok: true, kind: 'profile', x: [1, 2], xLabel: 'MONET atom ID', yLabel: 'RMSF (Å)', atoms: [0, 1], bars: true, series: [{ label: 'RMSF of "all"', data: [0.2, 0.4] }], n_frames: 5, frame_indices: [0, 1, 2, 3, 4] }
    if (command.action === 'mda_run' && command.analysis === 'hbonds') return { ok: true, kind: 'series', x: [0, 1], xLabel: 'Frame', yLabel: 'Hydrogen bonds', series: [{ label: 'H-bond count', data: [2, 4] }], n_frames: 2, frame_indices: [0, 1], table: { columns: ['Donor', 'Hydrogen', 'Acceptor', 'Occupancy (%)'], rows: [[0, 3, 2, 50]], atom_columns: [0, 1, 2] } }
    if (command.action === 'mda_run' && command.analysis === 'interrdf') return { ok: true, kind: 'profile', x: [0.5, 1.5], xLabel: 'r (Å)', yLabel: 'g(r)', series: [{ label: 'g(r)', data: [0, 1.2] }], n_frames: 2, notes: ['InterRDF'] }
    if (command.action === 'mda_run' && command.analysis === 'density') return { ok: true, kind: 'table', download: true, table: { columns: ['Quantity', 'Value'], rows: [['Grid points', '2 × 2 × 2']] }, notes: ['OpenDX grid'], n_frames: 2, output: 'density.dx', download_id: 'd1', downloadURL: '/api/download/d1' }
    if (command.action === 'run_analysis') return { ok: true, analysis: command.analysis, kind: 'series', x: [0, 1], xLabel: 'Frame', yLabel: 'Radius of gyration (Å)', series: [{ label: 'Rg', data: [1, 1.2] }], n_frames: 2, frame_indices: [0, 1] }
    if (command.action === 'mda_align') return { ok: true, n_frames: 2, selection: command.params.selection, output: 'torsion-aligned.extxyz', downloadURL: '/api/download/a1', filePath: 'derived/torsion-aligned.extxyz' }
    if (command.action === 'mda_run' && command.analysis === 'rmsd_matrix') return { ok: true, kind: 'matrix', matrix: [[0, 0.3], [0.3, 0]], labels: [0, 10], xLabel: 'Frame', yLabel: 'Frame', colorLabel: 'RMSD (Å)', notes: ['2 frames'], n_frames: 2, table: { columns: ['Quantity', 'Value (Å)'], rows: [['Mean off-diagonal RMSD', 0.3]] } }
    if (command.action === 'fluctuations') {
      const st = (mean, std, trend) => ({ mean, std, min: mean - 2 * std, max: mean + 2 * std, range: 4 * std, p5: mean - std, p95: mean + std, slope: trend ? 0.002 : 0, slope_error: 0.0001, r2: 0.5, drift: trend ? 0.1 : 0, block_sem: 0.01, trend, frequency: 0.03, frequency_share: 0.4, rmsf: std })
      const items = command.groups || (command.quantity === 'atoms' ? (command.indices || [0, 1, 2, 3]).map(i => [i]) : [[0, 1], [1, 2]])
      return { ok: true, quantity: command.quantity, items, statistics: items.map((_, k) => st(1 + k, 0.02 * (k + 1), k === 1)), frame_indices: [0, 1, 2], n_frames: 3, dt: command.dt ? command.dt * command.frame_step : null, periodic: false, auto: !command.groups, series: command.groups?.length === 1 || command.quantity !== 'dihedrals' ? items.map((_, k) => [1 + k, 1.1 + k, 0.9 + k]) : null }
    }
    if (command.action === 'ase_structure') return { ok: true, frame: command.frame, summary: [['Formula (Hill)', 'C3H'], ['Atoms', 4]], bonds: { columns: ['Pair', 'Bonds'], rows: [['C–C', 2]] }, coordination: { columns: ['Element', 'Atoms'], rows: [['C', 3]] }, molecules: [0, 0, 0, 0], coordination_numbers: [1, 2, 1, 0] }
    if (command.action === 'ase_coordination') return { ok: true, frame_indices: [0, 1], bond_scale: command.bond_scale, series: { 'C (mean of 2)': [1.5, 1.5], C1: [1, 1], C3: [2, 2] } }
    if (command.action === 'bonds') return { ok: true, frame_indices: [0, 1], series: { [command.pairs[0].join('-')]: [1, 1] } }
    return { ok: true, frame_indices: [0, 1], rmsd: [0, .1] }
  }
}

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
// renderer.js runs in strict mode, so its top-level bindings (monetHistory, renderHistory, …) live
// in a declarative environment private to this one eval call, not as window properties: a later,
// separate w.eval('...') cannot see them by name (only what this same call exposes on
// window.testMonet can be reached from outside). __setRenderHistory/__getRenderHistory below let a
// later check swap out renderHistory itself, which a plain identifier reference could not reach.
for (const file of ['theme.js', 'units.js', 'qm-resolve.js', 'qm-inputs.js', 'qm-panel.js', 'viewer.js', 'ase-model.js', 'fit.js', 'pbc.js', 'plot.js', 'provenance.js', 'console.js', 'report.js', 'replaygen.js', 'analysis-forms.js', 'renderer.js']) {
  w.eval(fs.readFileSync(path.join(root, file), 'utf8') + (file === 'renderer.js' ? '\nwindow.testMonet = { charts, runProcessing, aseViewer, viewer, state, aseState, player, monetHistory, saveHistoryNow, runConsoleLine, __getRenderHistory: () => renderHistory, __setRenderHistory: fn => { renderHistory = fn } };' : ''))
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
  assert.equal(H.session.data.environment.ase, 'test'); assert.equal(H.session.data.environment.python, '3.12.1'); assert.equal(H.session.data.monet_version, '2.2.0'); checks++
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
  // Important 5: bonds/angles/dihedrals/ase_coordination series keys are file indices ("0-1"), not
  // atom labels; historyEnd must relabel them through the step's mapping (aseIndex → monetId)
  // before logging, so the history and methods report read MONET atom IDs.
  el('bonds-pairs').value = '1 2'
  await click('btn-run-bonds')
  const bonds = steps().at(-1)
  assert.equal(bonds.action, 'bonds'); assert.equal(bonds.result['mean:1-2'], 1); assert.equal('mean:0-1' in bonds.result, false); checks++
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
  // A failing history view never breaks an analysis.
  const __savedRenderHistory = w.testMonet.__getRenderHistory()
  w.testMonet.__setRenderHistory(() => { throw new Error('view broke') })
  latestCommand = null
  await click('btn-run-rmsd')
  assert.equal(latestCommand.action, 'rmsd'); assert.equal(w.testMonet.aseState.busy, false); checks++
  w.testMonet.__setRenderHistory(__savedRenderHistory)
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
  // A plugin analysis runs from the console like any other: MONET IDs in, file indices to Python, logged as a step.
  await w.testMonet.runConsoleLine('run_analysis(analysis="custom.radius_of_gyration", params={"indices": [1, 2], "mass_weighted": False})'); await settle()
  assert.equal(latestCommand.action, 'run_analysis'); assert.equal(latestCommand.params.mass_weighted, false); checks++
  assert.deepEqual([...latestCommand.params.indices], [1, 2].map(id => w.testMonet.aseState.analysisAtoms.find(a => a.monetId === id).aseIndex)); checks++
  assert.equal(steps().at(-1).action, 'run_analysis'); assert.match(steps().at(-1).call, /^run_analysis\(analysis="custom\.radius_of_gyration", params=\{"indices": \[1, 2\], "mass_weighted": False\}/); checks++
  assert.ok(el('ase-sub-extcustom').classList.contains('active')); checks++
  // ↑ recalls the previous input.
  el('console-input').value = ''
  el('console-input').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp' }))
  assert.match(el('console-input').value, /^run_analysis\(/); checks++
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
  latestCommand = null
  await click('btn-run-rmsd')
  assert.equal(latestCommand, null); assert.match(el('status-msg').textContent, /read-only/); checks++
  await click('btn-browse'); await click('next-1'); await settle()
  assert.equal(H.readOnly, false); assert.equal(H.session.data.steps.length, openedData.steps.length); assert.equal(H.activeSource, 'S1'); checks++
  // Important 1: opening a session forks it -- a new `created` and `forked_from` pointing at the
  // original -- so once the trajectory is attached and autosave resumes, it writes a new file
  // instead of overwriting the (older, now possibly diverged) autosave it was opened from.
  assert.notEqual(H.session.data.created, openedData.created); checks++
  assert.equal(H.session.data.forked_from, openedData.created); checks++
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
  // Important 2: a step's session is captured when it begins, so a session swap while it is still
  // in flight (Open session, a resume or a new load) can never finish onto -- and corrupt -- a step
  // of whatever session turns out to be current when the call lands.
  const beforeSwap = H.session
  defer = true
  await click('btn-run-rmsd')
  assert.equal(typeof pendingResolve, 'function'); assert.equal(w.testMonet.aseState.busy, true); checks++
  // Snapshot after historyBegin already pushed the running placeholder step for this call: that
  // step must stay exactly as it is (still "running") once the call resolves onto a session that
  // is no longer current, instead of being finished or failed in place.
  const beforeSwapSteps = JSON.stringify(beforeSwap.data.steps)
  // Open session is disabled while busy, so the swap can't be driven through the UI at all...
  w.monet.sessionOpen = async () => ({ ok: true, session: openedData })
  await click('history-open-session')
  assert.equal(H.session, beforeSwap); assert.match(el('status-msg').textContent, /before opening a session/); checks++
  // ...so the capture is tested directly: swap the session mid-flight the way a resume or a new
  // load would, then resolve the pending call.
  const fresh = w.MonetProvenance.create({ monet_version: null })
  H.session = fresh
  pendingResolve({ ok: true, rmsd: [0, 1], frame_indices: [0, 1] })
  await tick(); await tick()
  assert.equal(fresh.data.steps.length, 0); checks++
  assert.equal(JSON.stringify(beforeSwap.data.steps), beforeSwapSteps); checks++
  assert.equal(w.testMonet.aseState.busy, false); checks++
  defer = false
  H.session = beforeSwap
  console.log(`PASS: ${checks} history UI checks (capture, derived sources, clear, pause, logging errors, autosave).`)
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => w.close())

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
const MonetXYZ = require(path.join(root, 'xyz.js'))
const periodicFrame = header => `4\n${header}\nC 1 0 0\nC 0 0 0\nC 0 1 0\nH 0 1 1\n`
const periodicText = periodicFrame('Lattice="10 0 0 0 11 0 0 0 12" Properties=species:S:1:pos:R:3 pbc="T T T"') + periodicFrame('Lattice="10 0 0 0 11 0 0 0 12" Properties=species:S:1:pos:R:3 pbc="T T T"')
// hexagonal.xyz: a lattice in the Materials Project setting (not the standard orientation).
const hexagonalHeader = 'Lattice="1.6 -2.771281 0 1.6 2.771281 0 0 0 5.2" Properties=species:S:1:pos:R:3 pbc="T T T"'
const trajectoryTexts = { 'periodic.xyz': periodicText, 'hexagonal.xyz': periodicFrame(hexagonalHeader) + periodicFrame(hexagonalHeader) }
let lastProcessOptions, importCalls = []
let activeAtoms = atoms, latestCommand, pendingResolve, defer = false, checks = 0, equilT0 = 1
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
  // periodic.xyz: an extended XYZ whose first frame carries a lattice, parsed like the real local reader (xyz.js).
  readFrame: async (name, index) => {
    if (!trajectoryTexts[name]) return { atoms }
    for await (const frame of MonetXYZ.frames(trajectoryTexts[name].split('\n'))) if (frame.index === index) return { atoms: frame.atoms, lattice: frame.lattice }
    return { error: 'Frame index is outside the trajectory.' }
  },
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
    if (command.action === 'subsample' && command.frames) return { ok: true, n_frames: command.frames.length, source_frames: 6, selected: true, first: command.frames[0], last: command.frames.at(-1), output: 'torsion-pca-selected.extxyz', downloadURL: '/api/download/p1', filePath: 'derived/torsion-pca-selected.extxyz' }
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
    if (command.action === 'equilibration') { latestCommand = command; return { ok: true, starts: [0, 1, 2], times: [0, command.dt, 2 * command.dt], g: [4, 2, 2], n_effective: [1, 1.5, 0.5], t0: equilT0, t0_time: equilT0 * command.dt, t0_frame: equilT0, group: command.groups.length - 1, per_group_t0: command.groups.map((_, k) => k + 1), n_frames: 4, frame_step: 1, dt: command.dt, g_t0: 2, n_effective_t0: 1.5, n_effective_full: 1 } }
    if (command.action === 'run_analysis') return { ok: true, analysis: command.analysis, kind: 'series', x: [0, 1], xLabel: 'Frame', yLabel: 'Radius of gyration (Å)', series: [{ label: 'Rg (mass-weighted, 2 atoms)', data: [1, 1.2] }], n_frames: 2, frame_indices: [0, 1], table: { columns: ['Quantity', 'Mean'], rows: [['Rg', 1.1]] } }
    if (command.action === 'rmsd_matrix') return { ok: true, matrix: [[0, 1], [1, 0]], frame_indices: [0, 10], aligned: true, truncated: false }
    if (command.action === 'msd') return { ok: true, times: [0, 1, 2, 3], series: { selection: [0, 1, 2, 3] }, fits: { selection: { slope: 1, intercept: 0, r2: 1, D_A2_fs: 1 / 6, D_cm2_s: 1 / 60 } }, fit_start: 1, fit_end: 2, periodic: false, frame_indices: [0, 1, 2, 3], dt: command.dt }
    if (command.action === 'vdos') return { ok: true, wavenumber: [0, 500, 1000], intensity: [0, .002, 0], nyquist_cm: 33356, resolution_cm: 8.3, n_frames: 100, dt: command.dt }
    if (command.action === 'mda_select') return { ok: true, indices: [1, 3], n_atoms: 2, n_residues: 1, residues: ['MOL1'] }
    if (command.action === 'mda_run' && command.analysis === 'pca') {
      const data = [[-2, -1, 0, 1, 2, 3], [1, -1, 1, -1, 1, -1], [0, 0.5, 0, -0.5, 0, 0], [0.1, 0, -0.1, 0, 0.1, -0.1]]
      return { ok: true, kind: 'series', x: [0, 1, 2, 3, 4, 5], xLabel: 'Frame', yLabel: 'Projection (Å)', n_frames: 6, frame_indices: [0, 1, 2, 3, 4, 5],
        series: data.map((values, k) => ({ label: `PC${k + 1} (${[50, 30, 15, 5][k]}.0 %)`, data: values })),
        pca: { components: 4, shown: command.params.n_components, variance_ratio: [0.5, 0.3, 0.15, 0.05] }, notes: ['2 components explain 90 % of the variance'],
        table: { columns: ['Component', 'Variance (Å²)', 'Cumulated (%)'], rows: [[1, 3.5, 50], [2, 1, 80], [3, 0.1, 95], [4, 0.01, 100]] } }
    }
    if (command.action === 'mda_run' && command.analysis === 'rmsf') return { ok: true, kind: 'profile', x: [1, 2], xLabel: 'MONET atom ID', yLabel: 'RMSF (Å)', atoms: [0, 1], bars: true, series: [{ label: 'RMSF of "all"', data: [0.2, 0.4] }], n_frames: 5, frame_indices: [0, 1, 2, 3, 4] }
    if (command.action === 'mda_run' && command.analysis === 'hbonds') return { ok: true, kind: 'series', x: [0, 1], xLabel: 'Frame', yLabel: 'Hydrogen bonds', series: [{ label: 'H-bond count', data: [2, 4] }], n_frames: 2, frame_indices: [0, 1], table: { columns: ['Donor', 'Hydrogen', 'Acceptor', 'Occupancy (%)'], rows: [[0, 3, 2, 50]], atom_columns: [0, 1, 2] } }
    if (command.action === 'mda_run' && command.analysis === 'interrdf') return { ok: true, kind: 'profile', x: [0.5, 1.5], xLabel: 'r (Å)', yLabel: 'g(r)', series: [{ label: 'g(r)', data: [0, 1.2] }], n_frames: 2, notes: ['InterRDF'] }
    if (command.action === 'mda_run' && command.analysis === 'density') return { ok: true, kind: 'table', download: true, table: { columns: ['Quantity', 'Value'], rows: [['Grid points', '2 × 2 × 2']] }, notes: ['OpenDX grid'], n_frames: 2, output: 'density.dx', download_id: 'd1', downloadURL: '/api/download/d1' }
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
for (const file of ['theme.js', 'units.js', 'qm-resolve.js', 'qm-inputs.js', 'qm-panel.js', 'viewer.js', 'ase-model.js', 'fit.js', 'pbc.js', 'plot.js', 'provenance.js', 'console.js', 'report.js', 'replaygen.js', 'analysis-forms.js', 'renderer.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8') + (file === 'renderer.js' ? '\nwindow.testMonet = { charts, runProcessing, aseViewer, viewer, state, aseState, player, qmReadiness };' : ''))
const el = id => w.document.getElementById(id)
const $$ = selector => [...w.document.querySelectorAll(selector)]
const tick = () => new Promise(resolve => setImmediate(resolve))
async function click (id) { el(id).click(); await tick(); await tick() }
const chooseMda = name => { el('mda-analysis').value = `mdanalysis.${name}`; el('mda-analysis').dispatchEvent(new w.Event('change')) }
async function mdaChecks () {
  // MDAnalysis module: its own tab with the generic analysis form.
  await click('vtab-mda')
  assert.ok(el('vtab-mda').classList.contains('active')); assert.ok(el('ase-sub-topology').classList.contains('active')); checks++
  assert.deepEqual($$('.ase-stab:not(.group-hidden)').map(b => b.dataset.stab), ['topology', 'mda']); checks++
  w.document.querySelector('.ase-stab[data-stab="mda"]').click(); await tick()
  assert.ok(el('ase-sub-mda').classList.contains('active')); checks++
  chooseMda('rmsf')
  assert.ok(el('mda-p-selection')); assert.equal(el('mda-p-align').checked, true); assert.match(el('mda-description').textContent, /RMSF/); checks++
  await click('btn-run-mda')
  assert.equal(latestCommand.action, 'mda_run'); assert.equal(latestCommand.analysis, 'rmsf'); checks++
  assert.deepEqual({ ...latestCommand.params }, { selection: 'all', align: true }); checks++
  // MDAnalysis gets the MONET IDs of the analysed atoms, in file order, and the viewer's bond cutoff.
  assert.deepEqual([...latestCommand.atom_ids], w.testMonet.aseState.analysisAtoms.map(a => a.monetId)); assert.equal(latestCommand.bond_scale, 1.2); checks++
  assert.deepEqual([...w.testMonet.charts.mda.data.labels], w.testMonet.aseState.analysisAtoms.slice(0, 2).map(a => String(a.monetId))); assert.equal(w.testMonet.charts.mda.data.datasets[0].bars, true); checks++
  // "← picked" inserts the viewer selection as MONET ids.
  const pickButton = el('mda-p-selection').nextElementSibling
  pickButton.click()
  assert.match(el('mda-p-selection').value, /^id \d+ \d+$/); checks++
  chooseMda('hbonds')
  assert.equal(el('mda-p-d_a_cutoff').value, '3'); assert.equal(el('mda-p-selection'), null); checks++
  await click('btn-run-mda')
  assert.equal(latestCommand.params.d_a_cutoff, 3); assert.equal(latestCommand.params.acceptors, 'element O N F'); checks++
  assert.match(w.testMonet.charts.mda.data.datasets[0].label, /mean 3 ± 1\.41/); checks++
  const hbondRow = el('mda-table').querySelector('tbody tr')
  const name = index => { const a = w.testMonet.aseState.analysisAtoms.find(atom => atom.aseIndex === index); return `${a.monetId} (${a.element})` }
  assert.deepEqual([...hbondRow.cells].map(c => c.textContent), [name(0), name(3), name(2), '50']); checks++
  chooseMda('interrdf')
  el('mda-p-rmax').value = '-1'
  latestCommand = null
  await click('btn-run-mda')
  assert.equal(latestCommand, null); assert.match(el('status-msg').textContent, /positive number/); checks++
  el('mda-p-rmax').value = '6'
  el('mda-p-exclude_same').value = 'residue'
  await click('btn-run-mda')
  assert.equal(latestCommand.params.rmax, 6); assert.equal(latestCommand.params.nbins, 150); assert.equal(latestCommand.params.exclude_same, 'residue'); checks++
  assert.deepEqual([...w.testMonet.charts.mda.data.labels], ['0.5', '1.5']); assert.equal(w.testMonet.charts.mda.data.xLabel, 'r (Å)'); checks++
  // Pairwise RMSD matrix as a heatmap with a colour map, frame 0 in the upper-left corner and a custom title.
  chooseMda('rmsd_matrix')
  assert.equal(el('mda-p-superposition').checked, true); assert.equal(el('mda-p-max_frames').value, '500'); checks++
  await click('btn-run-mda')
  assert.deepEqual({ ...latestCommand.params }, { selection: 'all', superposition: true, max_frames: 500 }); checks++
  assert.equal(el('mda-matrix-block').classList.contains('hidden'), false); assert.equal(w.testMonet.charts.mdamatrix.data.colormap, 'plasma'); assert.equal(w.testMonet.charts.mdamatrix.data.origin, 'top'); checks++
  assert.deepEqual([...w.testMonet.charts.mdamatrix.data.labels], ['0', '10']); assert.match(el('mda-table').textContent, /Mean off-diagonal RMSD/); checks++
  el('mdamatrix-title').value = 'S0 (non-correlated)'; el('mdamatrix-title').dispatchEvent(new w.Event('input'))
  el('mdamatrix-colormap').value = 'viridis'; el('mdamatrix-colormap').dispatchEvent(new w.Event('input'))
  assert.equal(w.testMonet.charts.mdamatrix.data.title, 'S0 (non-correlated)'); assert.equal(w.testMonet.charts.mdamatrix.data.colormap, 'viridis'); checks++
  el('mdamatrix-title').value = ''; el('mdamatrix-title').dispatchEvent(new w.Event('input'))
  assert.equal(w.testMonet.charts.mdamatrix.data.title, 'Pairwise RMSD (MDAnalysis)'); checks++
  w.testMonet.charts.mdamatrix.render?.()
  chooseMda('dihedral_mda')
  assert.equal(el('mda-matrix-block').classList.contains('hidden'), true); assert.equal(w.testMonet.charts.mdamatrix.data, null); checks++
  el('mda-p-quads').value = '1 2 3'
  latestCommand = null
  await click('btn-run-mda')
  assert.equal(latestCommand, null); assert.match(el('status-msg').textContent, /groups of 4/); checks++
  chooseMda('density')
  await click('btn-run-mda')
  assert.equal(latestCommand.output, 'torsion-density.dx'); assert.equal(el('mda-download').classList.contains('hidden'), false); checks++
  assert.match(el('mda-table').textContent, /Grid points.*2 × 2 × 2/); assert.equal(w.testMonet.charts.mda.data, null); checks++
  chooseMda('align')
  assert.equal(el('mda-download').classList.contains('hidden'), true); checks++
  await click('btn-run-mda')
  assert.equal(latestCommand.action, 'mda_align'); assert.equal(latestCommand.params.selection, 'all'); checks++
  assert.equal(el('mda-activate').classList.contains('hidden'), false); checks++
  // The aligned file keeps every frame_step-th frame: activating it multiplies the MD steps per saved frame.
  { const fullPath = w.testMonet.state.filePath, step = el('mda-step').value
    el('mda-step').value = '2'
    el('md-stride').value = '3'; el('md-stride').dispatchEvent(new w.Event('input'))
    await click('btn-run-mda')
    assert.equal(latestCommand.action, 'mda_align'); assert.equal(latestCommand.frame_step, 2); checks++
    await click('mda-activate'); await tick()
    assert.equal(w.testMonet.state.filePath, 'derived/torsion-aligned.extxyz'); assert.equal(el('md-stride').value, '6'); checks++
    await click('restore-full-trajectory'); await tick()
    assert.equal(w.testMonet.state.filePath, fullPath); assert.equal(el('md-stride').value, '3'); assert.equal(el('restore-full-trajectory').classList.contains('hidden'), true); checks++
    el('mda-step').value = step }
  // PCA: up to 10 components ticked in the list; configurations picked on them are written and extracted.
  { const charts = w.testMonet.charts
    chooseMda('pca')
    assert.equal(el('mda-p-n_components').value, '3'); assert.equal(el('mda-pca-block').classList.contains('hidden'), true); checks++
    await click('btn-run-mda')
    assert.equal(latestCommand.params.n_components, 3); assert.equal(el('mda-pca-block').classList.contains('hidden'), false); checks++
    assert.equal($$('#pca-components tbody tr').length, 4); assert.equal(el('mda-table').textContent, ''); checks++
    const plotted = () => [...charts.mda.data.datasets].filter(d => !d.points).map(d => d.label.split(' ')[0])
    assert.deepEqual(plotted(), ['PC1', 'PC2', 'PC3']); assert.match(charts.mda.data.datasets[0].label, /PC1 \(50\.0 %\) · mean 0\.5 ± /); checks++
    el('pca-show-3').click(); el('pca-show-0').click(); await tick()
    assert.deepEqual(plotted(), ['PC2', 'PC3', 'PC4']); assert.deepEqual([...charts.mdadist.data.datasets].map(d => d.label), ['PC2', 'PC3', 'PC4']); checks++
    el('pca-show-2').click(); el('pca-show-3').click(); el('pca-show-1').click(); await tick()
    assert.equal(el('pca-show-1').checked, true); assert.deepEqual(plotted(), ['PC2']); assert.match(el('status-msg').textContent, /at least one component/); checks++
    // Projection window on PC2 (0…2 Å), two frames apart at least: frames 0, 2, 4 → 0, 4 with spacing 3.
    el('pca-win-pc').value = '1'; el('pca-win-low').value = '0'; el('pca-win-high').value = '2'; el('pca-spacing').value = '3'
    await click('pca-select')
    assert.match(el('pca-selection-text').textContent, /^2 configurations selected \(PC2 from 0 to 2 Å, at least 3 frames apart; frames 0…4\)/); checks++
    assert.deepEqual($$('#pca-selected-table tbody tr').map(row => row.cells[0].textContent), ['0', '4']); checks++
    const marks = [...charts.mda.data.datasets].find(d => d.points)
    assert.deepEqual([...marks.data].map(v => Number.isFinite(v) ? v : null), [1, null, null, null, 1, null]); assert.deepEqual([...charts.mdadist.data.markers].map(m => m.value), [0, 2]); checks++
    // Extremes of PC1: the lowest and the highest projection.
    el('pca-show-0').click(); await tick()
    el('pca-mode').value = 'extremes'; el('pca-mode').dispatchEvent(new w.Event('change')); el('pca-ext-pc').value = '0'; el('pca-ext-n').value = '1'; el('pca-spacing').value = '1'
    assert.equal($$('.pca-mode-row').filter(row => !row.classList.contains('hidden')).map(row => row.dataset.mode).join(), 'extremes'); checks++
    await click('pca-select')
    assert.deepEqual($$('#pca-selected-table tbody tr').map(row => [...row.cells].slice(0, 2).map(c => c.textContent)), [['0', 'lowest'], ['5', 'highest']]); checks++
    // A frame list, typed or added from the viewer.
    el('pca-mode').value = 'list'; el('pca-mode').dispatchEvent(new w.Event('change')); el('pca-frame-list').value = '1 0-1'
    await click('pca-select')
    assert.deepEqual($$('#pca-selected-table tbody tr').map(row => row.cells[0].textContent), ['0', '1']); checks++
    el('pca-frame-list').value = `1 ${w.testMonet.state.fileInfo.configCount}`
    await click('pca-select')
    assert.match(el('status-msg').textContent, /past the last frame \(199\)/); checks++
    // Clicking a bar of the distribution selects its bin as the window of that component.
    const dist = charts.mdadist
    dist.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: dist.canvas.clientWidth, height: dist.canvas.clientHeight })
    dist._render()
    const axis = dist._axis
    // The PC2 bar (second of each bin) that holds the projections +1 Å (frames 0, 2, 4).
    const bin = [...dist.data.datasets[1].data].findIndex((density, i) => density > 0 && Number(dist.data.labels[i]) > 0)
    dist.canvas.dispatchEvent(new w.MouseEvent('click', { clientX: axis.left + axis.width * (bin + 0.75) / axis.slots, bubbles: true }))
    await tick()
    assert.equal(el('pca-mode').value, 'window'); assert.equal(el('pca-win-pc').value, '1'); assert.ok(Number(el('pca-win-high').value) >= 1); checks++
    assert.match(el('pca-selection-text').textContent, /^3 configurations selected \(PC2 from /); checks++
    await click('pca-write')
    assert.equal(latestCommand.action, 'subsample'); assert.deepEqual([...latestCommand.frames], [0, 2, 4]); assert.equal(latestCommand.output, 'torsion-pca-selected.extxyz'); checks++
    assert.equal(el('pca-download').classList.contains('hidden'), false); assert.equal(el('pca-activate').classList.contains('hidden'), false); checks++
    const fullPath = w.testMonet.state.filePath
    // The applied cell (e.g. from a CIF) follows the derived trajectory and comes back with the full one.
    Object.assign(w.testMonet.aseState, { cellParameters: [10, 11, 12, 90, 90, 90], cellSource: fullPath, cellSourceName: 'UNITCELL.cif' })
    await click('pca-activate'); await tick()
    assert.deepEqual([...w.testMonet.aseState.cellParameters], [10, 11, 12, 90, 90, 90]); assert.equal(w.testMonet.aseState.cellSourceName, 'UNITCELL.cif'); checks++
    assert.equal(w.testMonet.state.filePath, 'derived/torsion-pca-selected.extxyz'); assert.deepEqual([...w.testMonet.state.frameMap.frames], [0, 2, 4]); checks++
    assert.match(el('stat-format').textContent, /PCA selection · 3 configurations/); assert.match($$('.time-info')[0].textContent, /not evenly spaced/); checks++
    await click('restore-full-trajectory'); await tick()
    assert.equal(w.testMonet.state.filePath, fullPath); assert.equal(w.testMonet.state.frameMap, null); assert.doesNotMatch($$('.time-info')[0].textContent, /not evenly spaced/); checks++
    assert.deepEqual([...w.testMonet.aseState.cellParameters], [10, 11, 12, 90, 90, 90]); checks++
    Object.assign(w.testMonet.aseState, { cellParameters: null, cellSourceName: null })
    chooseMda('pca')
    assert.equal(el('mda-pca-block').classList.contains('hidden'), true); assert.equal(charts.mdadist.data, null); checks++ }
  // Switching the module keeps the other module's sub-tab.
  await click('vtab-ase')
  assert.ok(el('vtab-ase').classList.contains('active')); assert.equal(el('ase-sub-mda').classList.contains('active'), false); checks++
  await click('vtab-mda')
  assert.ok(el('ase-sub-mda').classList.contains('active')); checks++
}

async function registryChecks () {
  // Plugin analyses of the MONET Custom module: the form comes from the declared parameters.
  w.document.querySelector('.ase-stab[data-stab="extcustom"]').click(); await tick()
  assert.ok(el('ase-sub-extcustom').classList.contains('active')); assert.ok(el('vtab-custom').classList.contains('active')); checks++
  el('extcustom-analysis').value = 'custom.radius_of_gyration'; el('extcustom-analysis').dispatchEvent(new w.Event('change'))
  assert.ok(el('extcustom-p-indices')); assert.equal(el('extcustom-p-mass_weighted').checked, true); checks++
  assert.match(el('extcustom-description').textContent, /Plugin: plugins\/radius_of_gyration\.py/); checks++
  const two = w.testMonet.aseState.analysisAtoms.slice(0, 2)
  el('extcustom-p-indices').value = two.map(a => a.monetId).join(' ')
  await click('btn-run-extcustom')
  assert.equal(latestCommand.action, 'run_analysis'); assert.equal(latestCommand.analysis, 'custom.radius_of_gyration'); checks++
  // MONET IDs typed in the form reach the analysis as indices of the analysed file.
  assert.deepEqual([...latestCommand.params.indices], two.map(a => a.aseIndex)); assert.equal(latestCommand.params.mass_weighted, true); assert.ok(latestCommand.atom_ids); checks++
  assert.match(w.testMonet.charts.extcustom.data.datasets[0].label, /^Rg .* · mean 1\.1/); assert.match(el('extcustom-table').textContent, /Rg/); checks++
  el('extcustom-p-indices').value = '999'
  latestCommand = null
  await click('btn-run-extcustom')
  assert.equal(latestCommand, null); assert.match(el('status-msg').textContent, /MONET atom 999/); checks++
  await click('clear-extcustom')
  assert.equal(w.testMonet.charts.extcustom.data, null); assert.equal(el('extcustom-table').textContent, ''); checks++
  // The ASE module lists its own plugins; a choice parameter becomes a menu.
  el('extase-analysis').value = 'ase.cell_volume'; el('extase-analysis').dispatchEvent(new w.Event('change'))
  assert.deepEqual([...el('extase-p-quantity').options].map(o => o.value), ['volume', 'density', 'lengths']); checks++
  assert.ok([...el('extase-analysis').querySelectorAll('optgroup')].some(group => group.label === 'Cell')); checks++
}

async function fluctChecks () {
  // Custom module: fluctuations and trends mapped on the molecule.
  w.document.querySelector('.ase-stab[data-stab="fluct"]').click(); await tick()
  assert.ok(el('vtab-custom').classList.contains('active')); assert.ok(el('ase-sub-fluct').classList.contains('active')); checks++
  assert.equal(el('fluct-groups-row').classList.contains('hidden'), true); assert.equal(el('fluct-align-row').classList.contains('hidden'), true); checks++
  await click('btn-run-fluct')
  assert.equal(latestCommand.action, 'fluctuations'); assert.equal(latestCommand.quantity, 'bonds'); assert.equal(latestCommand.groups, undefined); assert.equal(latestCommand.bond_scale, 1.2); checks++
  const atomsNow = w.testMonet.aseState.analysisAtoms
  const label = index => { const a = atomsNow.find(atom => atom.aseIndex === index); return `${a.element}${a.monetId}` }
  assert.deepEqual([...w.testMonet.charts.fluct.data.labels], [`${label(0)}–${label(1)}`, `${label(1)}–${label(2)}`]); checks++
  assert.deepEqual([...w.testMonet.charts.fluct.data.datasets[0].data], [0.02, 0.04]); assert.equal(w.testMonet.charts.fluct.data.datasets[0].bars, true); checks++
  // Colour map on the molecule: one coloured path per bond, other atoms dimmed, colour bar.
  const overlay = w.testMonet.aseViewer.overlay
  assert.equal(overlay.segments.length, 2); assert.equal(overlay.dimAtoms, true); assert.equal(overlay.legend.min, 0.02); assert.equal(overlay.legend.max, 0.04); checks++
  assert.deepEqual([...overlay.segments[0].ids], [0, 1].map(i => atomsNow.find(a => a.aseIndex === i).monetId)); assert.match(overlay.segments[0].color, /^rgb\(13,8,135\)$/); checks++
  const rows = () => [...el('fluct-table').querySelectorAll('tbody tr')]
  assert.equal(rows().length, 2); assert.equal(rows()[1].lastElementChild.textContent, 'yes'); assert.match(el('fluct-summary').textContent, /1 with a significant trend/); checks++
  // Sorting by SD (descending first) and selecting a row.
  const sdHeader = [...el('fluct-table').querySelectorAll('th')].find(th => th.dataset.key === 'std')
  sdHeader.click()
  assert.equal(rows()[0].firstElementChild.textContent, `${label(1)}–${label(2)}`); checks++
  rows()[0].click(); await tick(); await tick()
  assert.equal(w.testMonet.charts.fluctseries.data.datasets.length, 5); assert.deepEqual([...w.testMonet.charts.fluctseries.data.datasets[0].data], [2, 2.1, 1.9]); checks++
  assert.equal(el('ase-picked-count').textContent, '2'); assert.ok(rows()[0].classList.contains('active')); checks++
  el('fluct-metric').value = 'slope'; el('fluct-metric').dispatchEvent(new w.Event('change'))
  // The time axis set earlier turns slopes into Å/ps.
  assert.deepEqual([...w.testMonet.charts.fluct.data.datasets[0].data], [0, 2]); assert.match(w.testMonet.charts.fluct.data.yLabel, /Å\/ps/); checks++
  w.document.querySelector('.ase-stab[data-stab="rdf"]').click(); await tick()
  assert.equal(w.testMonet.aseViewer.overlay, null); checks++
  w.document.querySelector('.ase-stab[data-stab="fluct"]').click(); await tick()
  assert.equal(w.testMonet.aseViewer.overlay.segments.length, 2); checks++
  el('fluct-map').checked = false; el('fluct-map').dispatchEvent(new w.Event('change'))
  assert.equal(w.testMonet.aseViewer.overlay, null); checks++
  // Atoms: RMSF coloured per atom; explicit groups; time axis converts units.
  el('fluct-metric').value = 'frequency'; el('fluct-map').checked = true
  el('fluct-quantity').value = 'atoms'; el('fluct-quantity').dispatchEvent(new w.Event('change'))
  assert.equal(w.testMonet.aseViewer.overlay, null); assert.equal(el('fluct-align-row').classList.contains('hidden'), false); checks++
  el('fluct-atoms').value = String(atomsNow[0].monetId)
  await click('btn-run-fluct')
  assert.deepEqual([...latestCommand.indices], [atomsNow[0].aseIndex]); assert.equal(latestCommand.align, true); assert.ok(latestCommand.dt > 0); checks++
  assert.equal(w.testMonet.aseViewer.overlay.atomColors.size, 1); assert.match(el('fluct-table').querySelector('thead').textContent, /RMSF.*Dominant ν \(cm⁻¹\)/); checks++
  near(w.testMonet.charts.fluct.data.datasets[0].data[0], 0.03 * 1e15 / 2.99792458e10, 1e-6); checks++
  el('fluct-quantity').value = 'dihedrals'; el('fluct-quantity').dispatchEvent(new w.Event('change'))
  el('fluct-scope').value = 'groups'; el('fluct-scope').dispatchEvent(new w.Event('change'))
  assert.equal(el('fluct-atoms-row').classList.contains('hidden'), true); assert.match(el('fluct-groups-label').textContent, /Groups of 4/); checks++
  el('ase-selection-target').value = 'fluct'; el('ase-selection-target').dispatchEvent(new w.Event('change'))
  assert.equal(el('ase-append-group').disabled, false); checks++
  el('fluct-groups').value = '1 2 3'
  latestCommand = null
  await click('btn-run-fluct')
  assert.equal(latestCommand, null); assert.match(el('status-msg').textContent, /groups of 4/); checks++
  const ids = atomsNow.map(a => a.monetId).join(' ')
  el('fluct-groups').value = ids
  await click('btn-run-fluct')
  assert.equal(latestCommand.groups.length, 1); assert.equal(el('fluct-summary').textContent.includes('loaded when a row is clicked'), false); checks++
  await click('clear-fluct')
  assert.equal(w.testMonet.aseViewer.overlay, null); assert.equal(el('fluct-table').childElementCount, 0); assert.equal(el('fluct-table-csv').disabled, true); checks++
  el('fluct-scope').value = 'auto'; el('fluct-scope').dispatchEvent(new w.Event('change'))
}
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`)

// Step 4 › Cell section of the plane-wave cards: structure cell detection, per-card custom cells, native units.
async function qmCellChecks () {
  const setCodes = wanted => {
    for (const box of $$('[data-qm-code]')) if (box.checked !== wanted.includes(box.dataset.qmCode)) box.click()
  }
  const fire = (id, type) => el(id).dispatchEvent(new w.Event(type, { bubbles: true }))
  const set = (id, value) => { el(id).value = value; fire(id, el(id).tagName === 'SELECT' ? 'change' : 'input') }
  const sourceLabel = code => el(`qm-${code}-cellSource`).selectedOptions[0].textContent
  const fields = code => ['a', 'b', 'c', 'alpha', 'beta', 'gamma'].map(k => el(`qm-${code}-cell-${k}`).value)
  // The lattice of the first frame comes with the loaded file: no launcher frame fetch is needed.
  frameCount = 2; activeAtoms = atoms; nextFile = 'periodic.xyz'
  await click('btn-browse'); await click('next-1'); await tick()
  assert.equal(w.testMonet.player.cells.get(0), undefined, 'the mock launcher gives no lattice'); checks++
  el('inp-atom-ids').value = '1 2 3 4'; await click('btn-apply-ids')
  w.testMonet.state.outputDir = 'out'
  setCodes(['qe'])
  assert.equal(el('qm-qe-cellSource').value, 'structure'); assert.equal(sourceLabel('qe'), 'Lattice from the trajectory'); checks++
  assert.deepEqual(fields('qe'), ['10', '11', '12', '90', '90', '90']); checks++
  assert.match(el('qm-qe-cell').textContent, /Lattice from the trajectory/); assert.equal(el('next-4').disabled, false); checks++
  assert.match(el('qm-qe-cell-vectors').textContent, /CELL_PARAMETERS angstrom\n10\.0000000000  0\.0000000000  0\.0000000000\n0\.0000000000  11\.0000000000/); checks++
  assert.match(el('qm-qe-positions').textContent, /crystal/); checks++
  // The isolated flag defines the cell itself: the Cell group is hidden while it is ticked.
  el('qm-qe-isolated').click()
  assert.equal(el('qm-qe-cellSource').closest('.qm-cell-group').hidden, true); checks++
  el('qm-qe-isolated').click()
  assert.equal(el('qm-qe-cellSource').closest('.qm-cell-group').hidden, false); checks++
  // A cell read by Load cell file names its source.
  nextFile = 'crystal.cif'; await click('cell-load-file')
  assert.equal(sourceLabel('qe'), 'Cell from crystal.cif'); assert.equal(el('qm-qe-cell-a').value, '10.3528'); checks++
  assert.match(el('qm-qe-cell').textContent, /Cell from crystal\.cif/); checks++
  await click('cell-reset')
  assert.equal(sourceLabel('qe'), 'Lattice from the trajectory'); assert.equal(el('qm-qe-cell-a').value, '10'); checks++
  // Editing a field makes the cell custom for this code only.
  set('qm-qe-cell-a', '9')
  assert.equal(el('qm-qe-cellSource').value, 'custom'); assert.equal(sourceLabel('qe'), 'Custom cell for this code'); checks++
  assert.match(el('qm-qe-preview').textContent, /CELL_PARAMETERS angstrom\n9\.0000000000/); checks++
  assert.match(el('qm-qe-cell').textContent, /Custom cell 9×11×12 Å/); checks++
  // Native units: QE in bohr.
  set('qm-qe-cellUnits', 'bohr')
  assert.match(el('qm-qe-cell-vectors').textContent, /CELL_PARAMETERS bohr\n17\.0075351216  0\.0000000000  0\.0000000000/); checks++
  assert.match(el('qm-qe-preview').textContent, /CELL_PARAMETERS bohr\n17\.0075351216/); checks++
  await click('next-4'); await tick(); await tick()
  assert.equal(lastProcessOptions.qm.codes.qe.cell.rows[0][0], 9); assert.equal(lastProcessOptions.qm.codes.qe.format.cellUnits, 'bohr'); checks++
  // Back to the structure cell: the fields are refilled.
  set('qm-qe-cellUnits', 'angstrom'); set('qm-qe-cellSource', 'structure')
  assert.deepEqual(fields('qe'), ['10', '11', '12', '90', '90', '90']); assert.match(el('qm-qe-preview').textContent, /CELL_PARAMETERS angstrom\n10\.0000000000/); checks++
  // CP2K: ABC + angles by default, vectors on request.
  setCodes(['cp2k'])
  assert.match(el('qm-cp2k-preview').textContent, /ABC \[angstrom\] 10\.0000000000 11\.0000000000 12\.0000000000/); checks++
  set('qm-cp2k-cellStyle', 'vectors')
  assert.match(el('qm-cp2k-preview').textContent, /\bA \[angstrom\] 10\.0000000000 0\.0000000000 0\.0000000000/); checks++
  assert.match(el('qm-cp2k-positions').textContent, /SCALED/); checks++
  // Qbox: always bohr, with a note.
  el('cell-system').value = 'cubic'; el('cell-a').value = '10'; el('cell-system').dispatchEvent(new w.Event('change'))
  await click('cell-apply')
  setCodes(['qbox', 'vasp'])
  assert.equal(sourceLabel('qbox'), 'Crystal cell applied'); checks++
  assert.match(el('qm-card-qbox').textContent, /Qbox uses bohr \(1 bohr = 0\.529177210903 Å\)\./); checks++
  assert.match(el('qm-qbox-cell-vectors').textContent, /^set cell 18\.89726125 0\.00000000 0\.00000000 0\.00000000 18\.89726125/); checks++
  assert.equal(el('qm-qbox-positions'), null); assert.match(el('qm-vasp-positions').textContent, /Direct/); checks++
  await click('cell-reset')
  // No cell anywhere: a custom cell releases VASP only.
  nextFile = 'torsion.xyz'
  await click('btn-browse'); await click('next-1'); await tick()
  el('inp-atom-ids').value = '1 2 3 4'; await click('btn-apply-ids')
  setCodes(['qe', 'vasp'])
  assert.equal(sourceLabel('vasp'), 'No cell in the structure'); assert.deepEqual(fields('vasp'), ['', '', '', '', '', '']); checks++
  assert.match(el('qm-vasp-cell').textContent, /✖ No cell/); checks++
  ;['8', '8', '8', '90', '90', '90'].forEach((v, i) => set(`qm-vasp-cell-${['a', 'b', 'c', 'alpha', 'beta', 'gamma'][i]}`, v))
  const ready = w.testMonet.qmReadiness()
  assert.ok(ready.blocked.some(m => /^Quantum ESPRESSO \(pw\.x\): no cell/.test(m))); assert.ok(!ready.blocked.some(m => /^VASP/.test(m))); checks++
  assert.match(el('qm-vasp-cell').textContent, /Custom cell 8×8×8 Å/); assert.match(el('qm-vasp-preview').textContent, /1\.0\n8\.0000000000  0\.0000000000  0\.0000000000/); checks++
  assert.equal(el('next-4').disabled, true); checks++
  // Loading another trajectory resets every plane-wave card to the structure cell (a custom cell belonged to the old file).
  assert.equal(el('qm-vasp-cellSource').value, 'custom'); checks++
  nextFile = 'hexagonal.xyz'
  await click('btn-browse')
  assert.equal(el('qm-vasp-cellSource').value, 'structure'); assert.equal(el('qm-qe-cellSource').value, 'structure'); checks++
  await click('next-1'); await tick()
  el('inp-atom-ids').value = '1 2 3 4'; await click('btn-apply-ids')
  setCodes(['qe'])
  assert.equal(sourceLabel('qe'), 'Lattice from the trajectory'); assert.equal(el('qm-qe-cellSource').value, 'structure'); checks++
  // A custom cell keeps the orientation of a non-standard structure lattice (Materials Project hexagonal setting), with a note.
  const orientation = el('qm-qe-cell-orientation')
  assert.equal(orientation.hidden, true); checks++
  set('qm-qe-cell-c', '10')
  assert.equal(el('qm-qe-cellSource').value, 'custom'); assert.equal(orientation.hidden, false); checks++
  assert.equal(orientation.textContent, 'The custom cell keeps the orientation of the structure lattice.'); checks++
  const cellRows = text => {
    const lines = text.split('\n')
    const start = lines.indexOf('CELL_PARAMETERS angstrom')
    return lines.slice(start + 1, start + 4).map(line => line.trim().split(/\s+/).map(Number))
  }
  const expected = [[1.6, -2.771281, 0], [1.6, 2.771281, 0], [0, 0, 10]]
  for (const shown of [el('qm-qe-preview').textContent, el('qm-qe-cell-vectors').textContent]) {
    cellRows(shown).flat().forEach((v, i) => near(v, expected.flat()[i], 1e-5)); checks++
  }
  // An invalid custom cell blocks the card and the preview does not fall back to the structure lattice.
  set('qm-qe-cell-a', '0')
  assert.match(el('qm-qe-cell').textContent, /✖ Invalid custom cell/); assert.doesNotMatch(el('qm-qe-preview').textContent, /CELL_PARAMETERS/); checks++
  assert.equal(el('next-4').disabled, true); checks++
  setCodes([])
}

async function run () {
  await tick()
  await click('btn-browse'); await click('next-1')
  assert.equal(el('ase-atom-count').textContent, '4'); checks++
  // Analysis comes before extraction: loading opens the ASE module with the workflow folded away.
  assert.ok(el('panel-analysis').classList.contains('active')); assert.ok(el('nav-analysis').classList.contains('active')); checks++
  assert.ok(el('vtab-content-ase').classList.contains('active')); assert.ok(w.document.querySelector('.layout').classList.contains('sidebar-collapsed')); checks++
  // Module order: ASE, MDAnalysis, then MONET Custom Functionalities (3D view, extraction and custom analyses).
  assert.deepEqual($$('.vtab').map(b => b.dataset.vtab), ['ase', 'mda', 'custom']); checks++
  assert.equal(el('vtab-custom').textContent.trim(), 'MONET Custom Functionalities'); checks++
  assert.ok(el('vtab-ase').classList.contains('active')); assert.ok(el('ase-sub-structure').classList.contains('active')); checks++
  // Tabs are announced as tabs, with the selected one marked.
  assert.equal(el('vtab-ase').getAttribute('role'), 'tab'); assert.equal(el('vtab-ase').getAttribute('aria-selected'), 'true'); assert.equal(el('vtab-custom').getAttribute('aria-selected'), 'false'); checks++
  assert.equal(w.document.querySelector('.ase-stab[data-stab="structure"]').getAttribute('aria-selected'), 'true'); assert.equal(w.document.querySelector('.ase-stab[data-stab="bonds"]').getAttribute('aria-selected'), 'false'); checks++
  assert.deepEqual($$('.ase-stab:not(.group-hidden)').map(b => b.dataset.stab), ['structure', 'bonds', 'angles', 'dihedrals', 'pdd', 'coordination', 'convert', 'extase']); checks++
  assert.match(el('module-intro').textContent, /ASE modules/); checks++
  // The MONET tab opens on the 3D view, whose sub-tab row also leads to the custom analyses.
  await click('vtab-custom')
  assert.ok(el('vtab-custom').classList.contains('active')); assert.ok(el('vtab-content-view3d').classList.contains('active')); checks++
  assert.equal(w.document.querySelector('.layout').classList.contains('sidebar-collapsed'), false); checks++
  const monetLinks = [...el('monet-subtabbar').children]
  assert.deepEqual(monetLinks.map(b => b.textContent), ['3D viewer & extraction', 'Autocorrelation', 'Fluctuations & trends', 'RMSD (Kabsch)', 'RMSD Matrix', 'RDF', 'MSD / Diffusion', 'VDOS', 'More analyses']); checks++
  assert.equal(monetLinks.at(-1).hidden, false); checks++
  assert.ok(monetLinks[0].classList.contains('active')); checks++
  monetLinks[3].click(); await tick(); await tick()
  assert.ok(el('vtab-custom').classList.contains('active')); assert.ok(el('vtab-content-ase').classList.contains('active')); assert.ok(el('ase-sub-rmsd').classList.contains('active')); checks++
  assert.deepEqual($$('.ase-stab:not(.group-hidden)').map(b => b.dataset.stab), ['view3d', 'acf', 'fluct', 'rmsd', 'rmsdmatrix', 'rdf', 'msd', 'vdos', 'extcustom']); checks++
  assert.match(el('module-intro').textContent, /MONET custom functionalities/); checks++
  // Switching module and back keeps the last MONET page; the "3D viewer" sub-tab returns to the view.
  await click('vtab-ase'); await click('vtab-custom')
  assert.ok(el('ase-sub-rmsd').classList.contains('active')); assert.ok(el('vtab-content-ase').classList.contains('active')); checks++
  w.document.querySelector('.ase-stab[data-stab="view3d"]').click(); await tick()
  assert.ok(el('vtab-content-view3d').classList.contains('active')); assert.ok(el('vtab-custom').classList.contains('active')); checks++
  await click('vtab-ase')
  assert.ok(el('vtab-content-ase').classList.contains('active')); assert.ok(el('ase-sub-structure').classList.contains('active')); checks++
  // Atom identity is checked automatically in MONET, ASE and MDAnalysis.
  assert.equal(topologyCommands.length, 1); assert.deepEqual([...topologyCommands[0].atom_ids], [1, 2, 3, 4]); checks++
  assert.ok(el('topology-status').classList.contains('topology-ok')); assert.match(el('topology-status').textContent, /4 atoms: MONET IDs, ASE indices and MDAnalysis ids/); checks++
  assert.equal(el('ase-atom-body').rows[0].cells[6].textContent, 'C3H1'); assert.equal(el('ase-atom-body').rows[0].cells[7].textContent, '1'); checks++
  assert.equal(el('topology-table').querySelectorAll('tbody tr').length, 4); checks++
  topologyBreak = true
  await click('btn-run-topology')
  assert.ok(el('topology-status').classList.contains('topology-bad')); assert.match(el('topology-status').textContent, /MONET ID 1: MDAnalysis id 2/); checks++
  assert.equal(el('topology-table').querySelectorAll('tbody tr.mismatch').length, 4); assert.match(el('ase-atom-match').textContent, /mismatch/); checks++
  topologyBreak = false
  await click('btn-run-topology')
  assert.ok(el('topology-status').classList.contains('topology-ok')); checks++
  // ASE structure summary and coordination numbers.
  el('structure-frame').value = '1'
  await click('btn-run-structure')
  assert.equal(latestCommand.action, 'ase_structure'); assert.equal(latestCommand.frame, 1); assert.equal(latestCommand.symprec, 0.001); assert.equal(latestCommand.bond_scale, 1.2); checks++
  assert.equal(el('structure-result').querySelectorAll('table').length, 3); assert.match(el('structure-result').textContent, /Formula \(Hill\)C3H/); assert.equal(el('clear-structure').disabled, false); checks++
  await click('clear-structure')
  assert.equal(el('structure-result').childElementCount, 0); checks++
  await click('btn-run-coordination')
  assert.equal(latestCommand.action, 'ase_coordination'); assert.equal(latestCommand.indices, undefined); checks++
  assert.deepEqual([...w.testMonet.charts.coordination.data.datasets].map(d => d.label.split(' ·')[0]), ['C (mean of 2)', 'C 1', 'C 3']); checks++
  assert.match(el('rail-step').textContent, /02 · Structure analysis/); assert.equal(el('rail-continue').classList.contains('hidden'), false); checks++
  await click('rail-expand')
  assert.equal(w.document.querySelector('.layout').classList.contains('sidebar-collapsed'), false); checks++
  await click('sidebar-toggle')
  assert.ok(w.document.querySelector('.layout').classList.contains('sidebar-collapsed')); checks++
  assert.equal(el('next-analysis').disabled, false); assert.equal(el('ase-continue').disabled, false); checks++
  // Representation styles apply to both viewers and are remembered.
  el('ase-view-style').value = 'sticks'; el('ase-view-style').dispatchEvent(new w.Event('change'))
  assert.equal(w.testMonet.aseViewer.style, 'sticks'); assert.equal(w.localStorage.getItem('monet-ase-view-style'), 'sticks'); checks++
  for (const style of ['lines', 'points', 'spacefill', 'ball-stick']) { el('ase-view-style').value = style; el('ase-view-style').dispatchEvent(new w.Event('change')) }
  assert.equal(w.testMonet.aseViewer.style, 'ball-stick'); checks++
  el('ase-viewer-size').value = 'full'; el('ase-viewer-size').dispatchEvent(new w.Event('change'))
  assert.equal(w.document.querySelector('.ase-reference').dataset.size, 'full'); checks++
  el('view-style').value = 'spacefill'; el('view-style').dispatchEvent(new w.Event('change'))
  assert.equal(w.testMonet.viewer.style, 'spacefill'); checks++
  el('view-style').value = 'ball-stick'; el('view-style').dispatchEvent(new w.Event('change'))
  const rows = () => [...el('ase-atom-body').rows].map(row => [...row.cells].map(cell => cell.textContent))
  assert.deepEqual(rows().map(row => row.slice(0, 3)), [['1', '0', 'C'], ['2', '1', 'C'], ['3', '2', 'C'], ['4', '3', 'H']]); checks++
  // Exercise actual mouse events against the viewer's rendered atom positions.
  const canvas = el('ase-mol-canvas')
  function pick (id) {
    const atom = w.testMonet.aseViewer.atoms.find(atom => atom.index === id)
    const point = w.testMonet.aseViewer._project(atom.x, atom.y, atom.z)
    for (const type of ['mousedown', 'mouseup', 'click']) canvas.dispatchEvent(new w.MouseEvent(type, { clientX: point.sx, clientY: point.sy, button: 0, bubbles: true }))
  }
  pick(2); pick(1); pick(3)
  assert.equal([...w.testMonet.aseViewer.selected].join(' '), '2 1 3'); checks++
  assert.match(el('ase-picked-atoms').textContent, /1: 2 \(C\)/); checks++
  assert.equal(w.testMonet.state.selectedAtoms.size, 0); checks++
  el('ase-selection-target').value = 'angles'; await click('ase-use-selection')
  assert.equal(el('angles-triplets').value, '2 1 3'); checks++
  pick(1); pick(1)
  assert.equal([...w.testMonet.aseViewer.selected].join(' '), '2 3 1'); checks++
  // A rotation ending with a click must not change the selection.
  const beforeDrag = [...w.testMonet.aseViewer.selected].join(' ')
  canvas.dispatchEvent(new w.MouseEvent('mousedown', { clientX: 10, clientY: 10, button: 0 }))
  canvas.dispatchEvent(new w.MouseEvent('mousemove', { clientX: 70, clientY: 45, button: 0 }))
  const target = w.testMonet.aseViewer._project(atoms[3].x, atoms[3].y, atoms[3].z)
  canvas.dispatchEvent(new w.MouseEvent('mouseup', { clientX: target.sx, clientY: target.sy, button: 0 }))
  canvas.dispatchEvent(new w.MouseEvent('click', { clientX: target.sx, clientY: target.sy, button: 0 }))
  assert.equal([...w.testMonet.aseViewer.selected].join(' '), beforeDrag); checks++
  await click('ase-clear-selection'); await click('ase-fit-view')
  assert.equal(el('ase-picked-count').textContent, '0'); checks++
  pick(1); pick(2); pick(3); pick(4)
  if (process.env.MONET_VIEWER_QA) fs.writeFileSync(process.env.MONET_VIEWER_QA, canvasMap.get(canvas).toBuffer('image/png'))
  el('ase-selection-target').value = 'dihedrals'; await click('ase-use-selection')
  assert.equal(el('dihedrals-quads').value, '1 2 3 4'); checks++
  // Append ordered groups without overwriting existing groups.
  el('ase-append-group').checked = true; await click('ase-use-selection')
  assert.equal(el('dihedrals-quads').value, '1 2 3 4  1 2 3 4'); checks++
  el('ase-append-group').checked = false
  await click('ase-clear-selection')
  pick(1); el('ase-selection-target').value = 'bonds'; await click('ase-use-selection')
  assert.match(el('ase-selection-hint').textContent, /groups of 2/); checks++
  el('ase-selection-target').value = 'rmsd'; await click('ase-use-selection'); await click('btn-run-rmsd')
  assert.equal(JSON.stringify(latestCommand.indices), '[0]'); checks++
  await click('ase-clear-selection')
  el('dihedrals-quads').value = '1 2 3 4'
  await click('btn-run-dihedrals')
  assert.equal(JSON.stringify(latestCommand.quads), '[[0,1,2,3]]'); checks++
  assert.match(el('ase-atom-match').textContent, /Verified with ASE/); checks++
  assert.equal(el('download-dihedrals').disabled, false); checks++
  await click('download-dihedrals')
  assert.equal(downloadName, 'MONET-dihedrals.png'); checks++
  const png = Buffer.from(await pngBlob.arrayBuffer())
  const image = await loadImage(png)
  assert.equal(image.width, 2400); assert.equal(image.height, 1440); checks++
  // Optional artifact for QA; not required for running tests.
  if (process.env.MONET_PLOT_QA) fs.writeFileSync(process.env.MONET_PLOT_QA, png)
  await click('clear-dihedrals')
  assert.equal(w.testMonet.charts.dihedrals.data, null); assert.equal(el('download-dihedrals').disabled, true); checks++
  assert.equal(el('ase-atom-count').textContent, '4'); checks++
  // Unique controls and real mouse context-menu selection.
  const allIds = [...w.document.querySelectorAll('[id]')].map(node => node.id)
  assert.equal(new Set(allIds).size, allIds.length); checks++
  const seedPoint = w.testMonet.aseViewer._project(atoms[1].x, atoms[1].y, atoms[1].z)
  const rightClick = (target, x, y) => {
    target.dispatchEvent(new w.MouseEvent('mousedown', { clientX: x, clientY: y, button: 2, bubbles: true }))
    target.dispatchEvent(new w.MouseEvent('contextmenu', { clientX: x, clientY: y, button: 2, bubbles: true, cancelable: true }))
    target.dispatchEvent(new w.MouseEvent('mouseup', { clientX: x, clientY: y, button: 2, bubbles: true }))
  }
  rightClick(canvas, seedPoint.sx, seedPoint.sy)
  assert.equal(el('viewer-context-menu').classList.contains('hidden'), false); checks++
  assert.match(el('ctx-molecule').textContent, /atom 2/); checks++
  await click('ctx-molecule')
  assert.equal([...w.testMonet.aseViewer.selected].join(' '), '2 1 3 4'); checks++
  assert.equal(latestCommand.action, 'select_atoms'); assert.equal(latestCommand.mode, 'molecules'); checks++
  el('ase-selection-target').value = 'rmsd'; await click('ase-use-selection'); await click('btn-run-rmsd')
  assert.equal(JSON.stringify(latestCommand.indices), '[1,0,2,3]'); checks++
  // A right-drag translates the view and opens no menu; rotation is unchanged.
  const view = w.testMonet.aseViewer, before = [...view.center], rot = [view.rotX, view.rotY]
  canvas.dispatchEvent(new w.MouseEvent('mousedown', { clientX: 20, clientY: 20, button: 2, bubbles: true }))
  canvas.dispatchEvent(new w.MouseEvent('mousemove', { clientX: 80, clientY: 50, button: 2, bubbles: true }))
  canvas.dispatchEvent(new w.MouseEvent('mouseup', { clientX: 80, clientY: 50, button: 2, bubbles: true }))
  assert.notDeepEqual(view.center, before); assert.deepEqual([view.rotX, view.rotY], rot); checks++
  const moved = view._project(...before)
  assert.ok(Math.abs(moved.sx - view.canvas.width / 2 - 60) < 1e-6 && Math.abs(moved.sy - view.canvas.height / 2 - 30) < 1e-6); checks++
  assert.equal(el('viewer-context-menu').classList.contains('hidden'), true); checks++
  // Element, invert and pattern tools.
  el('ase-sel-element').value = 'H'; await click('ase-sel-select')
  assert.deepEqual([...view.selected].map(id => atoms.find(a => a.index === id).element).every(e => e === 'H'), true); checks++
  await click('ase-sel-invert'); await click('ase-sel-all')
  assert.equal(view.selected.size, atoms.length); checks++
  el('sel-pattern').value = 'c c c c'; el('sel-pattern-target').value = 'geometry'
  await click('sel-pattern-find')
  assert.equal(latestCommand.mode, 'dihedrals'); assert.equal(el('dihedrals-quads').value, '1 2 3 4'); assert.equal(JSON.stringify(latestCommand.pattern), '["C","C","C","C"]'); checks++
  await click('ase-clear-selection')
  // Presets constrain the cell, and calculations receive its applied snapshot.
  el('cell-system').value = 'hexagonal'; el('cell-system').dispatchEvent(new w.Event('change'))
  el('cell-a').value = '8'; el('cell-a').dispatchEvent(new w.Event('input'))
  assert.equal(el('cell-b').value, '8'); assert.equal(el('cell-gamma').value, '120'); assert.equal(el('cell-b').disabled, true); checks++
  await click('cell-apply')
  assert.equal(w.testMonet.aseViewer.cell.length, 3); checks++
  // Centre selection: the centred atoms are fixed when ticked; later picks must not move the structure.
  if (!el('ase-center').disabled) {
    const coordsOf = () => JSON.stringify(w.testMonet.aseViewer.atoms.map(atom => [atom.x, atom.y, atom.z]))
    await click('ase-clear-selection')
    el('ase-center').checked = true; el('ase-center').dispatchEvent(new w.Event('change'))
    const centred = coordsOf()
    pick(2); pick(3)
    assert.equal(coordsOf(), centred); checks++
    el('ase-center').checked = false; el('ase-center').dispatchEvent(new w.Event('change'))
    el('ase-center').checked = true; el('ase-center').dispatchEvent(new w.Event('change'))
    assert.notEqual(coordsOf(), centred); checks++ // re-ticking centres on atoms 2 and 3
    el('ase-center').checked = false; el('ase-center').dispatchEvent(new w.Event('change'))
    await click('ase-clear-selection')
  } else console.warn('ase-center disabled in this fixture: centre-selection check skipped')
  assert.equal(w.testMonet.charts.rmsd.data, null); checks++
  el('bonds-pairs').value = '1 2'; await click('btn-run-bonds')
  assert.equal(JSON.stringify(latestCommand.cell), '[8,8,10,90,90,120]'); assert.equal(latestCommand.mic, true); checks++
  assert.match(w.testMonet.charts.bonds.data.source, /Cell: 8, 8, 10/); checks++
  el('cell-a').value = '9' // Unapplied changes must not affect calculations.
  await click('btn-run-bonds'); assert.equal(latestCommand.cell[0], 8); checks++
  el('dihedrals-range').value = 'signed90'; el('dihedrals-range').dispatchEvent(new w.Event('change'))
  await click('btn-run-dihedrals')
  assert.equal(latestCommand.angle_range, 'signed90'); assert.equal(w.testMonet.charts.dihedrals.data.angleRange, 'signed90'); checks++
  await click('download-dihedrals')
  assert.equal((await loadImage(Buffer.from(await pngBlob.arrayBuffer()))).width, 2400); checks++
  if (process.env.MONET_FOLDED_QA) fs.writeFileSync(process.env.MONET_FOLDED_QA, Buffer.from(await pngBlob.arrayBuffer()))
  if (process.env.MONET_CELL_QA) fs.writeFileSync(process.env.MONET_CELL_QA, canvasMap.get(canvas).toBuffer('image/png'))
  // Folded 0-180: a torsion oscillating around 90 deg is drawn continuously (edge crossings, no gaps).
  const chart = new w.MonetLineChart(w.document.createElement('canvas'))
  const segments = []
  chart.canvas.getContext = () => new Proxy({}, { get: (_, name) => name === 'measureText' ? () => ({ width: 10 }) : name === 'createLinearGradient' ? () => ({ addColorStop () {} }) : name === 'lineTo' || name === 'moveTo' ? (x, y) => segments.push([name, Math.round(y)]) : () => {} })
  chart.data = { title: 't', xLabel: 'Frame', yLabel: 'y', labels: ['0', '1', '2', '3'], angleRange: 'signed90', datasets: [{ label: 'd', data: [80, 95, 85, 100] }] }
  chart._render(chart.canvas, 600, 320)
  const folded90 = segments.filter(([name]) => name === 'moveTo').length
  segments.length = 0
  chart.data = { ...chart.data, angleRange: 'fold180' }
  chart._render(chart.canvas, 600, 320)
  const folded180 = segments.filter(([name]) => name === 'moveTo').length
  // 80, -85, 85, -80 crosses the ±90 edge three times; 80, 95, 85, 100 never crosses the 0/180 edge.
  assert.equal(folded90 - folded180, 3, 'one re-entry per edge crossing, no breaks in 0-180 mode'); checks++
  assert.ok(segments.some(([name, y]) => name === 'lineTo'), 'trace drawn'); checks++
  el('dihedrals-range').value = 'fold180'; el('dihedrals-range').dispatchEvent(new w.Event('change'))
  await click('btn-run-dihedrals')
  assert.equal(latestCommand.angle_range, 'fold180'); checks++
  el('angles-range').value = '360'; el('angles-range').dispatchEvent(new w.Event('change'))
  assert.equal(el('angles-normal-row').classList.contains('hidden'), false); checks++
  await click('cell-reset'); assert.equal(w.testMonet.aseViewer.cell, null); checks++
  await click('ase-clear-selection')
  // Extraction ordering comes from the original file, not the order entered by the user.
  el('inp-atom-ids').value = '4 1 3'; await click('btn-apply-ids')
  await w.testMonet.runProcessing()
  assert.deepEqual(rows().map(row => row.slice(0, 2)), [['1', '0'], ['3', '1'], ['4', '2']]); checks++
  el('inp-atom-ids').value = '2'; await click('btn-apply-ids')
  assert.deepEqual(rows().map(row => row[0]), ['1', '3', '4']); checks++
  assert.deepEqual(w.testMonet.aseViewer.atoms.map(atom => atom.index).join(' '), '1 3 4'); checks++
  assert.equal(el('ase-picked-count').textContent, '0'); checks++
  pick(3); pick(4)
  el('ase-selection-target').value = 'pdd'; await click('ase-use-selection')
  assert.equal(el('pdd-atoms').value, '3 4'); checks++
  el('bonds-pairs').value = '3 4'; await click('btn-run-bonds')
  assert.equal(JSON.stringify(latestCommand.pairs), '[[1,2]]'); checks++
  assert.match(w.testMonet.charts.bonds.data.datasets[0].label, /3 \(C\).*4 \(H\)/); checks++
  el('bonds-pairs').value = '1 2'; await click('btn-run-bonds')
  assert.match(el('status-msg').textContent, /atom 2 is not in/); checks++
  await click('btn-clear-analyses')
  assert.equal(Object.values(w.testMonet.charts).every(chart => chart.data === null), true); checks++
  // Clearing an in-flight request must keep its eventual result discarded.
  defer = true; await click('btn-run-rmsd')
  assert.equal(typeof pendingResolve, 'function')
  await click('clear-rmsd')
  pendingResolve({ ok: true, rmsd: [0, 1], frame_indices: [0, 1] })
  await tick(); await tick()
  assert.equal(w.testMonet.charts.rmsd.data, null); checks++
  assert.equal(listeners.size, 1); checks++
  // A backend order mismatch blocks the calculation before dispatch.
  defer = false; activeAtoms = activeAtoms.slice().reverse()
  await click('btn-run-rmsd')
  assert.match(el('ase-atom-match').textContent, /does not match MONET/); checks++
  await click('btn-browse')
  assert.equal(el('ase-atom-count').textContent, '0'); checks++
  // Other formats are imported before analysis; XYZ is read directly.
  nextFile = 'XDATCAR'
  await click('btn-browse'); await click('next-1')
  assert.equal(importCalls.length, 1); assert.equal(importCalls[0][1].format, 'auto'); checks++
  assert.equal(el('stat-format').textContent, 'VASP XDATCAR → extXYZ'); assert.equal(w.testMonet.state.filePath, 'imported/XDATCAR.extxyz'); checks++
  el('inp-format').value = 'cpmd-trajectory'; el('inp-format').dispatchEvent(new w.Event('change'))
  assert.equal(el('aux-reference').classList.contains('hidden'), false); checks++
  nextFile = 'first-frame.xyz'; await click('btn-reference')
  await click('back-2'); await click('next-1')
  assert.equal(importCalls.at(-1)[1].reference, 'first-frame.xyz'); assert.equal(importCalls.at(-1)[1].format, 'cpmd-trajectory'); checks++
  // Quantum-chemistry settings reach the extraction engine as a validated template spec.
  w.document.querySelector('[data-qm-code="orca"]').click()
  el('qm-mults').value = '2'; el('qm-mults').dispatchEvent(new w.Event('input'))
  el('qm-charge').value = '-1'; el('qm-charge').dispatchEvent(new w.Event('input'))
  assert.match(el('qm-template-file').textContent, /ORCA — \{tag\}\.inp/); checks++
  el('qm-template-file').value = 'orca:0'; el('qm-template-file').dispatchEvent(new w.Event('change'))
  el('qm-template-text').value = '! custom {mult}\n{coords}'; el('qm-template-text').dispatchEvent(new w.Event('input'))
  el('inp-atom-ids').value = '1 2'; await click('btn-apply-ids')
  await click('next-2'); await click('next-3'); await click('next-4')
  await tick(); await tick()
  assert.deepEqual(Object.keys(lastProcessOptions.qm.codes), ['gaussian', 'orca']); checks++
  assert.equal(lastProcessOptions.qm.common.charge, -1); assert.deepEqual([...lastProcessOptions.qm.common.multiplicities], [2]); checks++
  assert.equal(lastProcessOptions.qm.codes.orca.files[0].template, '! custom {mult}\n{coords}'); assert.equal(lastProcessOptions.generateGaussian, false); checks++
  assert.match(lastProcessOptions.qm.summary.orca, /^ORCA: b3lyp\/6-31\+g\(d,p\)/); checks++
  el('qm-mults').value = '1 1'; el('qm-mults').dispatchEvent(new w.Event('input'))
  assert.match(el('qm-status').textContent, /distinct/); checks++
  await click('retry-processing')
  assert.equal(el('next-4').disabled, true); checks++ // an invalid spec disables Run
  el('next-4').disabled = false; await click('next-4') // the handler still refuses an invalid spec
  assert.match(el('status-msg').textContent, /distinct/); assert.match(el('qm-status').textContent, /distinct/); checks++
  // Per-code cards: one card per ticked code; old shared fields are gone.
  assert.equal(el('qm-nproc'), null); assert.equal(el('qm-method'), null); assert.equal(el('qm-padding'), null); checks++
  w.document.querySelector('[data-qm-code="qe"]').click()
  assert.ok(el('qm-card-gaussian')); assert.ok(el('qm-card-orca')); assert.ok(el('qm-card-qe')); assert.equal(el('qm-card-vasp'), null); checks++
  el('qm-qe-calc').value = 'freq'; el('qm-qe-calc').dispatchEvent(new w.Event('change'))
  assert.equal(el('qm-qe-phx').checked, true); checks++
  assert.equal(el('qm-qe-padding').closest('.field-label').hidden, true)
  el('qm-qe-isolated').click(); assert.equal(el('qm-qe-padding').closest('.field-label').hidden, false); checks++
  w.document.querySelector('[data-qm-code="qbox"]').click()
  assert.deepEqual([...el('qm-qbox-calc').options].map(o => o.value), ['sp', 'opt', 'vcrelax', 'md']); checks++
  // Cell check: a plane-wave code without a cell blocks Run; the isolated flag or an applied cell releases it.
  w.document.querySelector('[data-qm-code="qbox"]').click() // only QE among the plane-wave codes
  el('qm-charge').value = '0'; el('qm-charge').dispatchEvent(new w.Event('input'))
  el('qm-mults').value = '1'; el('qm-mults').dispatchEvent(new w.Event('input'))
  el('qm-qe-calc').value = 'sp'; el('qm-qe-calc').dispatchEvent(new w.Event('change'))
  w.testMonet.state.outputDir = 'out'
  el('qm-qe-isolated').click() // back to not isolated
  assert.match(el('qm-status').textContent, /Quantum ESPRESSO \(pw\.x\): no cell/); assert.equal(el('next-4').disabled, true); checks++
  assert.equal(el('qm-define-cell').classList.contains('hidden'), false); assert.match(el('qm-qe-cell').textContent, /✖ No cell/); checks++
  assert.ok(w.testMonet.qmReadiness().blocked.some(m => /no cell/.test(m))); checks++
  el('qm-qe-isolated').click()
  assert.doesNotMatch(el('qm-status').textContent, /no cell/); assert.equal(el('next-4').disabled, false); assert.match(el('qm-qe-cell').textContent, /Vacuum box \(isolated\)/); checks++
  el('qm-qe-isolated').click()
  w.testMonet.aseState.cellParameters = [10, 10, 10, 90, 90, 90]; el('qm-charge').dispatchEvent(new w.Event('input'))
  assert.match(el('qm-qe-cell').textContent, /Crystal cell applied \(10, 10, 10, 90, 90, 90\)/); assert.equal(el('next-4').disabled, false); checks++
  assert.match(el('qm-status').textContent, /Gaussian: the configuration is written as an isolated cluster/); checks++
  w.testMonet.aseState.cellParameters = null
  // Override, preview, custom template marker (the ORCA edit made above is reset first).
  el('qm-template-file').value = 'orca:0'; el('qm-template-file').dispatchEvent(new w.Event('change')); el('qm-template-reset').click()
  assert.doesNotMatch(el('qm-card-orca').querySelector('summary').textContent, /custom template/); checks++
  assert.equal(el('qm-orca-custom-note').hidden, true); checks++
  el('qm-orca-override').click(); el('qm-orca-override-mults').value = '2'; el('qm-orca-override-mults').dispatchEvent(new w.Event('input'))
  assert.match(el('qm-orca-preview').textContent, /\* xyz 0 2\n/); checks++
  el('qm-template-file').value = 'orca:0'; el('qm-template-file').dispatchEvent(new w.Event('change'))
  el('qm-template-text').value = '! custom {mult}\n{coords}'; el('qm-template-text').dispatchEvent(new w.Event('input'))
  assert.match(el('qm-card-orca').querySelector('summary').textContent, /custom template \(\{tag\}\.inp\)/); checks++
  // A custom template makes the card's Calculation select (etc.) misleading for that file; a note explains why.
  assert.equal(el('qm-orca-custom-note').hidden, false); checks++
  assert.match(el('qm-orca-custom-note').textContent, /Edited templates replace the card settings for those files\./); checks++
  assert.equal(el('qm-gaussian-custom-note').hidden, true); checks++ // untouched cards show no note
  assert.match(el('qm-orca-preview').textContent, /! custom 2\n/); checks++
  // Define cell… opens Structure analysis › Cell (ASE workspace, cell panel unfolded); the workflow stays on Options.
  el('qm-qe-isolated').click(); el('qm-qe-isolated').click() // ensure blocked state
  assert.equal(el('qm-define-cell').classList.contains('hidden'), false)
  w.testMonet.state.step = 4; el('qm-define-cell').click()
  assert.equal(el('vtab-content-ase').classList.contains('active'), true); assert.equal(el('cell-apply').closest('details').open, true); checks++
  assert.equal(w.testMonet.state.step, 4); checks++
  w.document.querySelector('[data-qm-code="qe"]').click(); w.document.querySelector('[data-qm-code="orca"]').click()
  // New analyses: the MD time step must be set by the user; nothing is assumed.
  activeAtoms = atoms; nextFile = 'torsion.xyz'
  el('inp-format').value = 'auto'; el('inp-format').dispatchEvent(new w.Event('change'))
  await click('btn-reference-clear')
  await click('btn-browse'); await click('next-1')
  el('vtab-ase').click()
  el('acf-groups').value = '1 2 3 4'
  await click('btn-run-acf')
  assert.match(el('status-msg').textContent, /Set the MD time step/); assert.match(el('acf-error').textContent, /Set the MD time step/); assert.equal(el('acf-error').classList.contains('hidden'), false); checks++
  assert.ok(el('acf-md-timestep').classList.contains('field-missing')); assert.ok(el('md-timestep').classList.contains('field-missing')); checks++
  // The time step typed inside the ACF panel is the same value as the Time axis row.
  el('acf-md-timestep').value = '20'; el('acf-md-timestep').dispatchEvent(new w.Event('input'))
  el('acf-md-unit').value = 'au'; el('acf-md-unit').dispatchEvent(new w.Event('change'))
  assert.equal(el('md-timestep').value, '20'); assert.equal(el('md-timestep-unit').value, 'au'); assert.equal(el('vdos-md-timestep').value, '20'); checks++
  assert.ok(!el('acf-md-timestep').classList.contains('field-missing')); assert.match(el('acf-md-timestep').closest('.time-mirror').textContent, /0\.483777 fs/); checks++
  el('md-stride').value = '1'; el('md-stride').dispatchEvent(new w.Event('input'))
  assert.equal(el('acf-md-stride').value, '1'); checks++
  assert.match(el('md-dt-info').textContent, /0\.483777 fs/); checks++
  await click('btn-run-acf')
  assert.equal(latestCommand.action, 'acf'); assert.deepEqual(JSON.parse(JSON.stringify(latestCommand.groups)), [[0, 1, 2, 3]]); checks++
  assert.ok(Math.abs(latestCommand.dt - 20 * 0.02418884326585747) < 1e-12); checks++
  assert.equal(latestCommand.angle_range, '360'); assert.equal(latestCommand.max_lag, undefined); assert.equal(el('acf-error').classList.contains('hidden'), true); checks++
  el('acf-range').value = 'fold180'; await click('btn-run-acf')
  assert.equal(latestCommand.angle_range, 'fold180'); checks++
  el('acf-range').value = '360'
  // Labels formatted with thousands separators ("1,500") still map to numbers for zoom, cursor and markers.
  { const chart = w.testMonet.charts.acf
    chart.setData({ title: 't', labels: ['0', '500', '1,000', '1,500', '2,000'], datasets: [{ label: 'a', data: [1, .8, .5, .3, .1] }], markers: [{ value: 1200, label: 'm' }] })
    assert.deepEqual([...chart.axisValues()], [0, 500, 1000, 1500, 2000]); checks++
    assert.equal(chart.zoomToValues(0, 1000), true); assert.deepEqual([...chart.viewRange()], [0, 2]); checks++
    assert.equal(chart.labelIndex(1200), 2); checks++
    chart.setView(null) }
  el('acf-quantity').value = 'bond'; el('acf-quantity').dispatchEvent(new w.Event('change'))
  assert.equal(el('acf-range').disabled, true)
  el('acf-quantity').value = 'dihedral'; el('acf-quantity').dispatchEvent(new w.Event('change'))
  assert.equal(el('acf-range').disabled, false); checks++
  el('acf-groups').value = '1 2 3 4'; await click('btn-run-acf')
  assert.equal(w.testMonet.charts.acf.data.datasets.length, 2); assert.equal(w.testMonet.charts.acf.data.datasets[1].dash, true); checks++
  assert.equal(latestCommand.fit_model, 'exp'); assert.equal(el('chart-acfdist'), null); checks++
  // Zoom on the ACF plot: typed lag window, programmatic view, reset.
  el('acf-view-max').value = '15'; el('acf-view-max').dispatchEvent(new w.Event('input'))
  assert.deepEqual([...w.testMonet.charts.acf.viewRange()], [0, 1]); assert.equal(el('acf-zoom-reset').disabled, false); checks++
  w.testMonet.charts.acf.setView(1, 3)
  assert.deepEqual([...w.testMonet.charts.acf.viewRange()], [1, 3]); checks++
  await click('acf-zoom-reset')
  assert.equal(w.testMonet.charts.acf.viewRange(), null); assert.equal(el('acf-view-max').value, ''); assert.equal(el('acf-zoom-reset').disabled, true); checks++
  // tau = 43.6 fs with dt = 20 a.u. -> 90.1 frames; plateau within 5 %: t* = tau ln 20 = 130.6 fs -> 270 frames
  assert.match(el('acf-tau-text').textContent, /= 90\.12 MD steps = 90\.12 saved frames/); checks++
  assert.match(el('acf-plateau-text').textContent, /t\* = τ·ln\(1\/ε\) = 130\.61 fs/); assert.equal(el('acf-plateau-time').value, '130.61'); checks++
  assert.match(el('acf-stride-text').textContent, /every 270 saved frames/); checks++
  assert.ok(Math.abs(w.testMonet.charts.acf.data.markers[0].value - 43.6 * Math.log(20)) < 1e-9); assert.match(w.testMonet.charts.acf.data.markers[0].label, /t\* = 130\.6 fs \(270 frames\)/); checks++
  // Too few frames for that stride: accepting is not possible yet.
  assert.equal(el('acf-accept').disabled, true); checks++
  el('acf-plateau-eps').value = '0.01'; el('acf-plateau-eps').dispatchEvent(new w.Event('change'))
  assert.match(el('acf-stride-text').textContent, /every 416 saved frames/); checks++
  el('acf-plateau-eps').value = '0.05'; el('acf-plateau-eps').dispatchEvent(new w.Event('change'))
  el('acf-plateau-time').value = '50'; el('acf-plateau-time').dispatchEvent(new w.Event('input'))
  assert.match(el('acf-stride-text').textContent, /every 104 saved frames/); assert.match(el('acf-plateau-text').textContent, /You set t\* = 50 fs/); checks++
  el('acf-tau-manual').value = '10'; el('acf-tau-manual').dispatchEvent(new w.Event('input'))
  assert.match(el('acf-stride-text').textContent, /every 62 saved frames/); assert.match(el('acf-plateau-text').textContent, /τ entered = 10 fs/); checks++
  // The entered τ is drawn; the effective spacing after rounding is shown; no warning at τ = 10 fs ≈ 21 Δt.
  assert.match(w.testMonet.charts.acf.data.datasets.at(-1).label, /τ entered = 10 fs/)
  { const entered = w.testMonet.charts.acf.data.datasets.at(-1).data, fitted = w.testMonet.charts.acf.data.datasets[1].data
    assert.ok(entered[0] <= 1 && entered.every((v, i) => i === 0 || v <= entered[i - 1]) && Math.abs(entered[2] - Math.exp(-2)) < 1e-12 && entered[2] < fitted[2]); checks++ }
  assert.match(el('acf-stride-text').textContent, /rounded up to a whole number of frames.*effective spacing/); assert.equal(el('acf-plateau-warn').classList.contains('hidden'), true); checks++
  el('acf-tau-manual').value = '1'; el('acf-tau-manual').dispatchEvent(new w.Event('input'))
  assert.equal(el('acf-plateau-warn').classList.contains('hidden'), false); assert.match(el('acf-plateau-warn').textContent, /τ entered = 1 fs/); checks++
  el('acf-tau-manual').value = '10'; el('acf-tau-manual').dispatchEvent(new w.Event('input'))
  el('md-stride').value = '5'; el('md-stride').dispatchEvent(new w.Event('input'))
  assert.match(el('acf-stride-text').textContent, /every 13 saved frames \(65 MD steps/); checks++
  await click('acf-apply-stride')
  assert.equal(el('inp-freq').value, '13'); checks++
  // Accept t*: the uncorrelated trajectory is written and becomes the active one.
  w.testMonet.state.fileInfo.configCount = 200
  el('acf-plateau-eps').dispatchEvent(new w.Event('change'))
  assert.match(el('acf-stride-text').textContent, /16 uncorrelated configurations out of 200/); assert.equal(el('acf-accept').disabled, false); checks++
  const fullPath = w.testMonet.state.filePath
  await click('acf-accept'); await tick(); await tick()
  assert.equal(latestCommand.action, 'subsample'); assert.equal(latestCommand.stride, 13); assert.equal(latestCommand.filename, fullPath); checks++
  assert.match(el('acf-subsample-text').textContent, /✓ 16 uncorrelated configurations written \(every 13 of 200 frames/); assert.equal(el('acf-subsample-result').classList.contains('hidden'), false, 'summary survives the reload'); checks++
  assert.equal(w.testMonet.state.filePath, 'torsion-uncorrelated.extxyz'); assert.equal(el('inp-freq').value, '1'); assert.equal(el('md-stride').value, '65'); checks++
  assert.equal(el('restore-full-trajectory').classList.contains('hidden'), false); assert.match(el('analysis-source').textContent, /uncorrelated · every 13 frames/); checks++
  await click('restore-full-trajectory'); await tick()
  assert.equal(w.testMonet.state.filePath, fullPath); assert.equal(el('md-stride').value, '5'); assert.equal(el('inp-freq').value, '13'); assert.equal(el('restore-full-trajectory').classList.contains('hidden'), true); checks++
  // Cropping an already-derived trajectory (equilibration crop of the uncorrelated trajectory) must keep the
  // derived md-stride, not fall back to the full trajectory's (renderer.js activateTrajectory regression).
  el('acf-plateau-eps').dispatchEvent(new w.Event('change'))
  assert.equal(el('acf-accept').disabled, false); checks++
  await click('acf-accept'); await tick(); await tick()
  assert.equal(el('md-stride').value, '65'); checks++
  el('acf-groups').value = '1 2 3 4' // activating a trajectory clears the ACF inputs, as elsewhere in this flow
  await click('btn-run-equil')
  assert.equal(el('equil-crop').disabled, false); checks++
  // Saved frame 1 of the every-13-frames trajectory is frame 13 of the full one: text and crop label say so.
  assert.match(el('equil-text').textContent, /saved frame 1, frame 13 of the full trajectory/); checks++
  await click('equil-crop'); await tick(); await tick()
  assert.equal(el('md-stride').value, '65', 'cropping the uncorrelated trajectory must not reset md-stride to the full-trajectory value'); checks++
  assert.match(el('analysis-source').textContent, /production · from frame 13 of the full trajectory \(t₀ = .* fs into the active file\)/); checks++
  // Crop of a crop: saved frame 1 of the production file is frame 13 + 1·13 = 26 of the full trajectory.
  el('acf-groups').value = '1 2 3 4'; await click('btn-run-equil')
  assert.match(el('equil-text').textContent, /saved frame 1, frame 26 of the full trajectory/); checks++
  await click('equil-crop'); await tick(); await tick()
  assert.match(el('analysis-source').textContent, /production · from frame 26 of the full trajectory/); checks++
  // Back to step 1 and Next re-analyses the original file: derived stride, frequency and frame numbering are dropped.
  await click('back-analysis'); await click('next-1'); await tick(); await tick()
  w.testMonet.state.fileInfo.configCount = 200 // the mock re-analysis reports 2 frames; keep the 200-frame run of this flow
  assert.equal(w.testMonet.state.filePath, fullPath); assert.equal(w.testMonet.state.frameMap, null); assert.equal(el('md-stride').value, '5'); assert.equal(el('inp-freq').value, '13'); assert.equal(el('restore-full-trajectory').classList.contains('hidden'), true); checks++
  el('acf-groups').value = '1 2 3 4'; await click('btn-run-equil')
  assert.match(el('equil-text').textContent, /\(saved frame 1\)/); assert.doesNotMatch(el('equil-text').textContent, /of the full trajectory/); checks++
  // Re-accept t* so the flow below starts from the uncorrelated trajectory, as before.
  el('acf-groups').value = '1 2 3 4'; await click('btn-run-acf'); el('acf-tau-manual').value = '10'; el('acf-tau-manual').dispatchEvent(new w.Event('input'))
  await click('acf-accept'); await tick(); await tick()
  el('acf-groups').value = '1 2 3 4'; await click('btn-run-equil'); await click('equil-crop'); await tick(); await tick()
  await click('restore-full-trajectory'); await tick()
  assert.equal(el('md-stride').value, '5'); checks++
  el('acf-groups').value = '1 2 3 4'; el('acf-fit-model').value = 'exp_offset'; await click('btn-run-acf')
  assert.equal(latestCommand.fit_model, 'exp_offset'); checks++
  await click('csv-acf')
  assert.equal(downloadName, 'MONET-acf.csv'); assert.match(await pngBlob.text(), /^# Autocorrelation of the dihedral/); checks++
  // τ_int estimator and error, run length in units of τ, residual correlation g of the sampled configurations.
  el('acf-tau-manual').value = ''; el('acf-tau-manual').dispatchEvent(new w.Event('input'))
  assert.equal(latestCommand.tau_int_method, 'sokal'); assert.match(el('acf-tau-text').textContent, /τ_int \(Sokal window, 3 lags\) = 40 ± 5 fs/); checks++
  assert.match(el('acf-length-text').textContent, /T = 9\.68 fs = 0\.222 τ/); assert.match(el('acf-length-text').textContent, /fewer than 20 τ/); checks++
  el('md-stride').value = '1'; el('md-stride').dispatchEvent(new w.Event('input'))
  el('acf-plateau-time').value = '0.5'; el('acf-plateau-time').dispatchEvent(new w.Event('input'))
  assert.match(el('acf-stride-text').textContent, /every 2 saved frames/); assert.match(el('acf-stride-text').textContent, /g ≈ 1\.6, N_eff ≈ 62\.5/); checks++
  // g of the sampled configurations must divide the stride (in saved frames) by frame_step, since the ACF
  // lags are frame_step saved frames apart: frame_step = 2 with stride = 4 lands on the same lag index (2,
  // acf = 0.3) as stride = 2 with frame_step = 1 above, so g is unchanged but N_eff halves with fewer kept frames.
  el('acf-step').value = '2'; await click('btn-run-acf')
  assert.equal(latestCommand.frame_step, 2); checks++
  el('acf-plateau-time').value = '1.9'; el('acf-plateau-time').dispatchEvent(new w.Event('input'))
  assert.match(el('acf-stride-text').textContent, /every 4 saved frames/); assert.match(el('acf-stride-text').textContent, /g ≈ 1\.6, N_eff ≈ 31\.3/); checks++
  el('acf-step').value = '1'
  el('acf-tauint').value = 'geyer'; await click('btn-run-acf')
  assert.equal(latestCommand.tau_int_method, 'geyer'); assert.match(el('acf-tau-text').textContent, /Geyer sequence/); checks++
  el('acf-tauint').value = 'sokal'
  // Block averaging (Flyvbjerg–Petersen) under the ACF; cleared with it.
  assert.deepEqual([...w.testMonet.charts.acfblock.data.datasets[0].data], [0.5, 0.7]); assert.match(el('acfblock-text').textContent, /No plateau/); checks++
  await click('csv-acfblock')
  assert.equal(downloadName, 'MONET-acfblock.csv'); checks++
  await click('clear-acf')
  assert.equal(w.testMonet.charts.acfblock.data, null); assert.equal(el('acfblock-text').classList.contains('hidden'), true); checks++
  // Equilibration: t₀ by maximum N_eff, then crop to the production window (a new active trajectory).
  await click('btn-run-equil')
  assert.equal(latestCommand.action, 'equilibration'); assert.equal(latestCommand.tau_int_method, 'sokal'); checks++
  assert.match(el('equil-text').textContent, /Production starts at t₀ = .* \(saved frame 1\)/); assert.equal(el('equil-crop').disabled, false); checks++
  assert.equal(w.testMonet.charts.equil.data.markers.length, 1); checks++
  assert.doesNotMatch(el('equil-text').textContent, /is set by/); checks++
  // The crop button follows the busy state like the Run buttons.
  defer = true
  el('rmsd-atoms').value = ''; el('btn-run-rmsd').click(); await tick(); await tick()
  assert.equal(el('equil-crop').disabled, true, 'crop disabled while a calculation runs'); checks++
  defer = false; pendingResolve({ ok: true, frame_indices: [0, 1], rmsd: [0, 0.1] }); await tick(); await tick()
  assert.equal(el('equil-crop').disabled, false); checks++
  // t₀ = 0: no transient, nothing to crop, and ✂ stays disabled after another calculation finishes.
  equilT0 = 0; await click('btn-run-equil')
  assert.match(el('equil-text').textContent, /No transient found/); assert.equal(el('equil-crop').disabled, true); checks++
  el('rmsd-atoms').value = ''; await click('btn-run-rmsd'); await tick()
  assert.equal(el('equil-crop').disabled, true, 't₀ = 0 keeps ✂ disabled after a busy cycle'); checks++
  equilT0 = 1; await click('btn-run-equil')
  // With several groups the text names the group that set t₀ (the one that equilibrates last).
  el('acf-groups').value = '1 2 3 4 4 3 2 1'; await click('btn-run-equil')
  assert.match(el('equil-text').textContent, /t₀ is set by .+, the group that equilibrates last \(t₀ per group: .+ fs, .+ fs\)/); checks++
  assert.match(w.testMonet.charts.equil.data.datasets[0].label, /^N_eff\(t₀\) · /); checks++
  el('acf-groups').value = '1 2 3 4'; await click('btn-run-equil')
  const beforeCrop = w.testMonet.state.filePath
  await click('equil-crop'); await tick(); await tick()
  assert.equal(latestCommand.action, 'subsample'); assert.equal(latestCommand.stride, 1); assert.equal(latestCommand.start, 1); checks++
  assert.match(el('analysis-source').textContent, /production · from frame 1/); checks++
  await click('restore-full-trajectory'); await tick()
  assert.equal(w.testMonet.state.filePath, beforeCrop); checks++
  el('acf-quantity').value = 'bond'; el('acf-quantity').dispatchEvent(new w.Event('change'))
  assert.equal(w.testMonet.charts.acf.data, null); assert.equal(el('acf-result').classList.contains('hidden'), true); checks++
  el('acf-groups').value = '1 2 3'; await click('btn-run-acf')
  assert.match(el('status-msg').textContent, /groups of 2/); checks++
  el('rmsdmatrix-atoms').value = ''; await click('btn-run-rmsdmatrix')
  assert.equal(latestCommand.action, 'rmsd_matrix'); assert.equal(latestCommand.align, true); assert.equal(w.testMonet.charts.rmsdmatrix.data.matrix.length, 2); checks++
  await click('download-rmsdmatrix')
  assert.equal((await loadImage(Buffer.from(await pngBlob.arrayBuffer()))).width, 2400); checks++
  await click('btn-run-msd')
  assert.equal(w.testMonet.charts.msd.data.datasets.at(-1).dash, true); assert.match(el('msd-info').textContent, /D = 0\.01667 cm²\/s \(0\.1667 Å²\/fs/); checks++
  await click('btn-run-vdos')
  assert.equal(latestCommand.mass_weighted, true); assert.match(el('vdos-info').textContent, /Nyquist/); checks++
  el('ase-selection-target').value = 'acf'; el('ase-selection-target').dispatchEvent(new w.Event('change'))
  assert.match(el('ase-selection-hint').textContent, /groups of 2/); checks++
  el('rmsd-align').checked = true; el('rmsd-reference').value = '0'
  await click('btn-run-rmsd')
  assert.equal(latestCommand.align, true); assert.equal(latestCommand.reference_index, 0); checks++
  // Atoms picked in the ASE module become the extraction selection; continuing expands the workflow.
  await click('ase-clear-selection')
  pick(1); pick(3)
  await click('ase-continue')
  assert.ok(el('panel-2').classList.contains('active')); assert.ok(el('vtab-content-view3d').classList.contains('active')); checks++
  assert.ok(el('vtab-custom').classList.contains('active')); checks++
  assert.equal(w.document.querySelector('.layout').classList.contains('sidebar-collapsed'), false); checks++
  await click('next-2')
  assert.equal(el('use-ase-selection').disabled, false); checks++
  await click('use-ase-selection')
  assert.equal(el('inp-atom-ids').value, '1 3'); assert.equal(el('next-3').disabled, false); checks++
  await click('back-3'); await click('back-2')
  assert.ok(el('panel-analysis').classList.contains('active')); assert.ok(el('vtab-content-ase').classList.contains('active')); checks++
  // Mean ± std in legends, distribution view, MDAnalysis selection and analyses.
  el('bonds-pairs').value = '1 2'; await click('btn-run-bonds')
  assert.match(w.testMonet.charts.bonds.data.datasets[0].label, /mean 1 ± 0 Å$/); checks++
  // The distribution (with fit) is a second chart below the time series.
  assert.equal(w.testMonet.charts.bonds.data.xLabel, 'Frame'); assert.ok(!el('bonds-view').querySelector('option[value="distribution"]')); checks++
  assert.equal(w.testMonet.charts.bondsdist.data.datasets[0].bars, true); assert.match(w.testMonet.charts.bondsdist.data.yLabel, /Probability density/); checks++
  assert.match(w.testMonet.charts.bondsdist.data.notes.join(' '), /Mean 1 Å, standard deviation 0 Å, 2 frames/); checks++
  {
    // Circular σ (Mardia), and the SEM corrected with τ_int as in the ACF panel.
    const M = require(path.join(root, 'ase-model.js'))
    const pair = M.seriesStats([350, 10], '360')
    assert.ok(Math.abs(pair.mean) < 1e-9 && Math.abs(pair.std - 10.0257) < 1e-3 && Math.abs(pair.resultant - Math.cos(Math.PI / 18)) < 1e-12); checks++
    let seed = 3
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd())
    let x = 0
    const ar = Array.from({ length: 20000 }, () => { x = 0.9 * x + Math.sqrt(0.19) * gauss(); return 100 + 9 * x })
    const correlated = M.seriesStats(ar, 'fold180')
    assert.ok(correlated.tauInt > 7 && correlated.tauInt < 11, correlated.tauInt); assert.ok(Math.abs(correlated.sem - correlated.std / Math.sqrt(20000 / (2 * correlated.tauInt))) < 1e-9); checks++
    const white = M.seriesStats(Array.from({ length: 20000 }, () => 100 + 9 * gauss()), 'fold180')
    assert.ok(white.nEff > 18000 && Math.abs(white.std - 9) < 0.2 && Math.abs(white.mean - 100) < 0.3); checks++
    assert.ok(correlated.sem > 3 * white.sem); checks++
    // Histogram fits: Gaussian across the 180°/0° edge, von Mises width, two components, linear data.
    const F = require(path.join(root, 'fit.js'))
    const wrapped = M.histogram(Array.from({ length: 20000 }, () => ((178 + 5 * gauss()) % 180 + 180) % 180), 90, 0, 180)
    const edge = F.fitHistogram(wrapped.centres, wrapped.density, { model: 'gaussian', period: 180, low: 0 })
    assert.ok(Math.abs(edge.params[1] - 178) < 0.3 && Math.abs(edge.params[2] - 5) < 0.3 && edge.rSquared > 0.99, JSON.stringify(edge.params)); checks++
    const single = M.histogram(Array.from({ length: 20000 }, () => ((100 + 9 * gauss()) % 180 + 180) % 180), 90, 0, 180)
    const vm = F.fitHistogram(single.centres, single.density, { model: 'vonmises', period: 180, low: 0 })
    assert.ok(Math.abs(vm.params[1] - 100) < 0.5 && Math.abs(vm.sigma - 9) < 0.5 && vm.errors[1] > 0 && vm.errors[1] < 0.2); checks++
    assert.throws(() => F.fitHistogram(single.centres, single.density, { model: 'vonmises' }), /periodic/); checks++
    const mixture = M.histogram(Array.from({ length: 30000 }, (_, i) => (i % 3 ? 60 + 6 * gauss() : 120 + 8 * gauss())), 90, 0, 180)
    const two = F.fitHistogram(mixture.centres, mixture.density, { model: 'gaussian2', period: 180, low: 0 })
    const peaks = [[two.params[1], two.params[2], two.weights[0]], [two.params[4], two.params[5], two.weights[1]]].sort((a, b) => a[0] - b[0])
    assert.ok(Math.abs(peaks[0][0] - 60) < 0.5 && Math.abs(peaks[1][0] - 120) < 0.5 && Math.abs(peaks[0][2] - 2 / 3) < 0.03 && Math.abs(peaks[1][1] - 8) < 0.5, JSON.stringify(peaks)); checks++
    const part = F.fitHistogram(mixture.centres, mixture.density, { model: 'gaussian', period: 180, low: 0, range: [100, 150] })
    assert.ok(Math.abs(part.params[1] - 120) < 0.5 && part.points === 25); checks++
    const lengths = M.histogram(Array.from({ length: 5000 }, () => 1.45 + 0.03 * gauss()), 50)
    const linear = F.fitHistogram(lengths.centres, lengths.density, { model: 'gaussian' })
    assert.ok(Math.abs(linear.params[1] - 1.45) < 0.003 && Math.abs(linear.params[2] - 0.03) < 0.003); checks++
    // Lorentzian and pseudo-Voigt on Cauchy-distributed data (γ = 4).
    const cauchy = M.histogram(Array.from({ length: 40000 }, () => 80 + 4 * Math.tan(Math.PI * (rnd() - 0.5))).filter(v => v > 0 && v < 180), 180, 0, 180)
    const lor = F.fitHistogram(cauchy.centres, cauchy.density, { model: 'lorentzian', period: 180, low: 0 })
    assert.ok(Math.abs(lor.params[1] - 80) < 0.1 && Math.abs(lor.params[2] - 4) < 0.25 && Math.abs(lor.fwhm - 2 * lor.params[2]) < 1e-12 && lor.rSquared > 0.99, JSON.stringify(lor.params)); checks++
    const pv = F.fitHistogram(cauchy.centres, cauchy.density, { model: 'pseudovoigt', period: 180, low: 0 })
    assert.ok(pv.params[3] > 0.85 && pv.params[3] <= 1 && Math.abs(pv.params[2] - 8) < 0.6, JSON.stringify(pv.params)); checks++
    const pvGauss = F.fitHistogram(single.centres, single.density, { model: 'pseudovoigt', period: 180, low: 0 })
    assert.ok(pvGauss.params[3] < 0.15 && Math.abs(pvGauss.params[2] - 2.3548 * 9) < 1, JSON.stringify(pvGauss.params)); checks++
    assert.ok(Math.abs(F.besselRatio(0.5) - 0.242500) < 1e-5 && Math.abs(F.besselRatio(10) - 0.948599) < 1e-5); checks++
  }
  // Histogram fits in the distribution chart.
  assert.ok(!el('bonds-fit').querySelector('option[value="vonmises"]')); assert.ok(el('bonds-fit').querySelector('option[value="lorentzian"]')); checks++
  el('bonds-fit').value = 'gaussian'; el('bonds-fit').dispatchEvent(new w.Event('change'))
  const bondsDist = () => w.testMonet.charts.bondsdist.data
  assert.equal(bondsDist().datasets.length, 2); assert.equal(bondsDist().datasets[1].dash, true); assert.equal(w.testMonet.charts.bonds.data.xLabel, 'Frame'); checks++
  assert.match(bondsDist().notes.join(' '), /Gaussian fit: μ = 1\.0\d* ± .*σ = .*FWHM = .*R² = /); assert.match(bondsDist().notes.join(' '), /ignore time correlation/); checks++
  el('bonds-fit-range').value = '5'; el('bonds-fit-range').dispatchEvent(new w.Event('input'))
  assert.match(bondsDist().notes.join(' '), /Fit range: enter two numbers/); checks++
  el('bonds-fit-range').value = '9 10'; el('bonds-fit-range').dispatchEvent(new w.Event('input'))
  assert.match(bondsDist().notes.join(' '), /fit failed \(The fit needs at least 4 bins/); assert.equal(bondsDist().datasets.length, 1); checks++
  el('bondsdist-bins').value = '30'; el('bondsdist-bins').dispatchEvent(new w.Event('input'))
  assert.equal(bondsDist().labels.length, 30); checks++
  el('bonds-fit').value = ''; el('bonds-fit').dispatchEvent(new w.Event('change'))
  assert.equal(bondsDist().datasets.length, 1); checks++
  await click('clear-bonds')
  assert.equal(w.testMonet.charts.bondsdist.data, null); checks++
  el('bonds-pairs').value = '1 2'; await click('btn-run-bonds')
  el('dihedrals-range').value = '360'; el('dihedrals-range').dispatchEvent(new w.Event('change'))
  el('dihedrals-quads').value = '1 2 3 4'; await click('btn-run-dihedrals')
  assert.match(w.testMonet.charts.dihedrals.data.datasets[0].label, /\(circular\)$/); checks++
  // Polar and dot-histogram views: stacked dots, custom radial values, reference angles.
  const setView = (kind, value) => { el(`${kind}-view`).value = value; el(`${kind}-view`).dispatchEvent(new w.Event('change')) }
  const input = (id, value) => { el(id).value = value; el(id).dispatchEvent(new w.Event(el(id).tagName === 'SELECT' ? 'change' : 'input')) }
  setView('dihedrals', 'polar')
  let polar = w.testMonet.charts.dihedrals.data
  assert.equal(polar.type, 'polar'); assert.deepEqual([...polar.range], [0, 360]); assert.equal(polar.radial, null); checks++
  assert.ok(Number.isFinite(polar.series[0].mean)); assert.equal(el('dihedrals-dist-options').classList.contains('hidden'), false); checks++
  input('dihedrals-ref', '84.3'); input('dihedrals-ref-label', 'θExp')
  assert.deepEqual(JSON.parse(JSON.stringify(w.testMonet.charts.dihedrals.data.references)), [{ value: 84.3, short: 'θExp', label: 'θExp = 84.3' }]); checks++
  input('dihedrals-radial', 'custom')
  assert.equal(el('dihedrals-custom-row').classList.contains('hidden'), false); checks++
  const frames = [...w.testMonet.charts.dihedrals.data.frames]
  input('dihedrals-custom', `${frames[0]} 0.15\n# comment\n${frames[frames.length - 1]} 0.30\n999999 1`)
  polar = w.testMonet.charts.dihedrals.data
  assert.equal(polar.radial.label, 'ΔEST (eV)'); assert.equal(polar.radial.values[0][0], 0.15); assert.equal(polar.radial.values[0][frames.length - 1], 0.3); checks++
  assert.match(polar.notes.join(' '), /1 radial value\(s\) refer to frames that were not computed/); checks++
  assert.match(w.testMonet.charts.dihedrals.toCSV(), /^frame,.*ΔEST \(eV\)/m); assert.deepEqual([...w.testMonet.charts.dihedrals.exportSize()], [1200, 1150]); checks++
  input('dihedrals-radial', 'frame')
  assert.equal(w.testMonet.charts.dihedrals.data.radial.label, 'Frame'); assert.equal(el('dihedrals-custom-row').classList.contains('hidden'), true); checks++
  setView('dihedrals', 'series')
  assert.equal(el('dihedrals-dist-options').classList.contains('hidden'), true); checks++
  setView('bonds', 'dots')
  assert.equal(w.testMonet.charts.bonds.data.type, 'dots'); assert.equal(w.testMonet.charts.bonds.data.series[0].mean, 1); assert.equal(el('bonds-radial'), null); checks++
  assert.ok(!el('bonds-view').querySelector('option[value="polar"]')); assert.ok(el('angles-view').querySelector('option[value="polar"]')); checks++
  setView('bonds', 'series')
  assert.ok(el('inp-format').querySelector('option[value="ase:gromacs"]')); assert.ok(!el('inp-format').querySelector('option[value="ase:xyz"]')); checks++
  assert.match(el('ase-badge-text').textContent, /MDA 2\.10\.0/); checks++
  el('mda-pick-selection').value = 'resname MOL and element C'; await click('mda-pick')
  assert.equal(latestCommand.action, 'mda_select'); assert.equal(el('ase-picked-count').textContent, '2'); assert.match(el('mda-pick-status').textContent, /2 atoms in 1 residues/); checks++
  await mdaChecks()
  await fluctChecks()
  await registryChecks()
  // Day/night toggle persists the choice and redraws canvases without errors.
  const theme = w.document.documentElement.dataset.theme
  let redraws = 0
  w.addEventListener('monet-theme', () => redraws++)
  await click('theme-toggle')
  assert.notEqual(w.document.documentElement.dataset.theme, theme); checks++
  assert.equal(w.localStorage.getItem('monet-theme'), w.document.documentElement.dataset.theme); checks++
  assert.equal(el('theme-toggle').getAttribute('aria-pressed'), String(w.document.documentElement.dataset.theme === 'light')); checks++
  await click('theme-toggle')
  assert.equal(w.document.documentElement.dataset.theme, theme); assert.equal(redraws, 2); checks++
  // Trajectory player: frames in batches, live geometry, plot cursor, cell display and wrapping.
  frameCount = 6; nextFile = 'movie.xyz'; activeAtoms = atoms
  await click('btn-browse'); await click('next-1'); await tick()
  assert.equal(el('player-slider').max, '5'); assert.equal(el('player-play').disabled, false); assert.equal(el('player-frame').textContent, 'frame 0 / 5'); checks++
  el('dihedrals-quads').value = '1 2 3 4'; await click('btn-run-dihedrals')
  framesCommands.length = 0
  await click('player-next'); await tick()
  assert.equal(el('player-frame').textContent, 'frame 1 / 5'); assert.deepEqual([...framesCommands[0].indices], [1, 2, 3, 4, 5]); checks++
  const shown = id => w.testMonet.aseViewer.atoms.find(atom => atom.index === id)
  assert.equal(shown(1).x, 2); assert.equal(el('ase-viewer-title').textContent, 'ASE molecule · frame 1'); checks++
  assert.equal(w.testMonet.charts.dihedrals.cursor, '1'); assert.equal(w.testMonet.charts.dihedrals.labelIndex('1'), 1); assert.equal(w.testMonet.charts.dihedrals.labelIndex('7'), 1); checks++
  $$('#ase-atom-body tr').slice(0, 2).forEach(row => row.click())
  assert.match(el('ase-live').textContent, /^Frame 1: d\(1–2\) = 1\.0000 Å/); checks++
  $$('#ase-atom-body tr')[2].click()
  assert.match(el('ase-live').textContent, /∠\(1–2–3\) = 90\.00°/); checks++
  el('player-step').value = '2'; await click('player-next'); await tick()
  assert.equal(el('player-frame').textContent, 'frame 3 / 5'); assert.equal(framesCommands.length, 1, 'frames come from the cache'); checks++
  await click('player-prev'); await click('player-first'); await tick()
  assert.equal(el('player-frame').textContent, 'frame 0 / 5'); checks++
  el('player-step').value = '1'; el('player-fps').value = '30'
  await click('player-play')
  assert.equal(el('player-play').textContent, '⏸ Stop'); checks++
  await new Promise(resolve => setTimeout(resolve, 250))
  await click('player-play')
  assert.equal(el('player-play').textContent, '▶ Play'); assert.ok(w.testMonet.player.index > 0 || el('player-loop').checked); checks++
  const stopped = w.testMonet.player.index
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(w.testMonet.player.index, stopped, 'playback stops'); checks++
  el('player-slider').value = '5'; el('player-slider').dispatchEvent(new w.Event('input')); await tick(); await tick()
  assert.equal(el('player-frame').textContent, 'frame 5 / 5'); assert.equal(shown(1).x, 6); checks++
  // A small cell leaves the atoms outside: the diagnostic suggests wrapping; wrapping moves them inside.
  el('cell-system').value = 'cubic'; el('cell-a').value = '0.9'; el('cell-system').dispatchEvent(new w.Event('change'))
  await click('cell-apply')
  assert.match(el('cell-status').textContent, /% of the atoms lie outside this cell/); checks++
  el('ase-wrap').value = 'atoms'; el('ase-wrap').dispatchEvent(new w.Event('change'))
  assert.ok(w.testMonet.aseViewer.atoms.every(atom => [atom.x, atom.y, atom.z].every(v => v >= -1e-9 && v < 0.9)), 'wrapped into the cell'); checks++
  assert.match(el('ase-live').textContent, /∠\(1–2–3\) = 90\.00° · minimum image/); checks++
  el('ase-wrap').value = 'none'; el('ase-wrap').dispatchEvent(new w.Event('change'))
  assert.equal(shown(1).x, 6); checks++
  await click('btn-wrap')
  assert.equal(latestCommand.action, 'wrap'); assert.equal(latestCommand.mode, 'molecules'); assert.equal(latestCommand.center, undefined); assert.deepEqual([...latestCommand.cell], [0.9, 0.9, 0.9, 90, 90, 90]); checks++
  el('wrap-center').checked = true; el('wrap-mode').value = 'atoms'; await click('btn-wrap')
  assert.deepEqual([...latestCommand.center], [0, 1, 2]); assert.equal(latestCommand.mode, 'atoms'); checks++
  el('wrap-center').checked = false
  await click('cell-reset')
  // Cell from a CIF in the ASE module; removing wrong input files.
  nextFile = 'crystal.cif'
  await click('cell-load-file')
  assert.equal(latestCommand.action, 'cell_file'); assert.equal(latestCommand.filename, 'crystal.cif'); checks++
  assert.equal(el('cell-alpha').value, '96.2968'); assert.deepEqual([...w.testMonet.aseState.cellParameters], [10.3528, 13.029, 21.211, 96.2968, 97.439, 98.371]); checks++
  assert.match(el('cell-status').textContent, /Read from crystal\.cif/); checks++
  assert.equal(el('btn-cell-file-clear').disabled, true); assert.equal(el('btn-reference-clear').disabled, true); checks++
  nextFile = 'crystal.cif'; await click('btn-cell-file')
  assert.equal(el('cell-file-path').textContent, 'crystal.cif'); assert.equal(el('btn-cell-file-clear').disabled, false); checks++
  await click('btn-cell-file-clear')
  assert.equal(el('cell-file-path').textContent, 'Not selected'); assert.equal(w.testMonet.state.source.cellFile, null); checks++
  nextFile = 'npt72.dcd'; await click('btn-browse')
  assert.equal(el('file-display').classList.contains('hidden'), false); assert.equal(el('next-1').disabled, false); checks++
  await click('next-1')
  assert.match(el('status-msg').textContent, /element X/); checks++
  await click('btn-file-clear')
  assert.equal(el('file-display').classList.contains('hidden'), true); assert.equal(el('next-1').disabled, true); checks++
  assert.equal(w.testMonet.state.source.original, null); assert.equal(el('stat-atoms').textContent, '—'); assert.ok(el('panel-1').classList.contains('active')); checks++
  await qmCellChecks()
  console.log(`PASS: ${checks} DOM/plot checks (stable atom IDs, dihedrals, clear controls, PNG export, theme).`)
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => w.close())

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
let activeAtoms = atoms, latestCommand, pendingResolve, defer = false, checks = 0
const listeners = new Set()
w.monet = {
  isBrowser: true, selectFile: async () => 'torsion.xyz',
  analyzeFile: async () => ({ atomCount: 4, configCount: 2, format: 'XYZ' }),
  readFrame: async () => ({ atoms }),
  onProgress () {}, onAseProgress: callback => { listeners.add(callback); return () => listeners.delete(callback) },
  aseCheck: async () => ({ ok: true, ase_version: 'test' }),
  processTrajectory: async options => {
    activeAtoms = atoms.filter(atom => options.selectedAtoms.includes(atom.index))
    return { success: true, totalFrames: 2, sampledFrames: 2, outputDir: 'MONET-results' }
  },
  aseRun: async command => {
    if (command.action === 'read_info') return { ok: true, n_atoms: activeAtoms.length, symbols: activeAtoms.map(a => a.element), positions: activeAtoms.map(a => [a.x, a.y, a.z]) }
    latestCommand = command
    if (command.action === 'molecule') return { ok: true, indices: [command.seed, ...activeAtoms.map((_,i) => i).filter(i => i !== command.seed)] }
    if (defer) return new Promise(resolve => { pendingResolve = resolve })
    if (command.action === 'dihedrals') return { ok: true, frame_indices: [0, 1], series: { [command.quads[0].join('-')]: [270, 90] } }
    if (command.action === 'bonds') return { ok: true, frame_indices: [0, 1], series: { [command.pairs[0].join('-')]: [1, 1] } }
    return { ok: true, frame_indices: [0, 1], rmsd: [0, .1] }
  }
}
for (const file of ['ase-model.js', 'plot.js', 'renderer.js']) w.eval(fs.readFileSync(path.join(root, file), 'utf8') + (file === 'renderer.js' ? '\nwindow.testMonet = { charts, runProcessing, aseViewer, state, aseState };' : ''))
const el = id => w.document.getElementById(id)
const tick = () => new Promise(resolve => setImmediate(resolve))
async function click (id) { el(id).click(); await tick(); await tick() }
async function run () {
  await tick()
  await click('btn-browse'); await click('next-1')
  assert.equal(el('ase-atom-count').textContent, '4'); checks++
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
  canvas.dispatchEvent(new w.MouseEvent('contextmenu', { clientX: seedPoint.sx, clientY: seedPoint.sy, bubbles: true, cancelable: true }))
  assert.equal(el('ase-context-menu').classList.contains('hidden'), false); checks++
  await click('ase-select-molecule')
  assert.equal([...w.testMonet.aseViewer.selected].join(' '), '2 1 3 4'); checks++
  el('ase-selection-target').value = 'rmsd'; await click('ase-use-selection'); await click('btn-run-rmsd')
  assert.equal(JSON.stringify(latestCommand.indices), '[1,0,2,3]'); checks++
  // Presets constrain the cell, and calculations receive its applied snapshot.
  el('cell-system').value = 'hexagonal'; el('cell-system').dispatchEvent(new w.Event('change'))
  el('cell-a').value = '8'; el('cell-a').dispatchEvent(new w.Event('input'))
  assert.equal(el('cell-b').value, '8'); assert.equal(el('cell-gamma').value, '120'); assert.equal(el('cell-b').disabled, true); checks++
  await click('cell-apply')
  assert.equal(w.testMonet.aseViewer.cell.length, 3); checks++
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
  console.log(`PASS: ${checks} DOM/plot checks (stable atom IDs, dihedrals, clear controls, PNG export).`)
}
run().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => w.close())

'use strict'

// MONET page script, part 3 of 8: Analysis workspace shared by the modules: tabs, charts, ASE connection, runAse, the trajectory player and time-series views.
// The app-*.js files are classic scripts sharing one global scope; index.html loads them in this order.

// =============================================================================
// ── Viewer tab switching ─────────────────────────────────────────────────────
// =============================================================================

$$('.vtab').forEach(btn => btn.addEventListener('click', () => showViewerTab(btn.dataset.vtab)))
$('open-ase-btn').addEventListener('click', () => showViewerTab('ase'))

// ── Representation style (shared preference) and ASE viewer size ──
function stored (key, fallback) { try { return localStorage.getItem(key) || fallback } catch { return fallback } }
function store (key, value) { try { localStorage.setItem(key, value) } catch {} }
for (const [selectId, target] of [['view-style', () => viewer], ['ase-view-style', () => aseViewer]]) {
  const select = $(selectId)
  for (const [key, style] of Object.entries(VIEW_STYLES)) {
    const option = document.createElement('option')
    option.value = key
    option.textContent = style.label
    select.appendChild(option)
  }
  select.value = stored(`monet-${selectId}`, 'ball-stick')
  select.addEventListener('change', () => {
    target().setStyle(select.value)
    store(`monet-${selectId}`, select.value)
  })
}
$('ase-viewer-size').value = stored('monet-ase-viewer-size', 'large')
document.querySelector('.ase-reference').dataset.size = $('ase-viewer-size').value
$('ase-viewer-size').addEventListener('change', () => {
  document.querySelector('.ase-reference').dataset.size = $('ase-viewer-size').value
  store('monet-ase-viewer-size', $('ase-viewer-size').value)
  aseViewerNeedsFit = true
  resizeAseViewer()
})

function redrawVisibleChart () {
  resizeAseViewer()
  for (const chart of Object.values(charts)) if (chart.data && chart.canvas.clientWidth && chart.canvas.clientHeight) chart._render()
}
window.addEventListener('resize', redrawVisibleChart)
// The workflow panel folds and unfolds with a short width transition: redraw whenever the viewer area
// changes size, so canvases never keep the resolution of an intermediate width (stretched atoms, plots).
if (window.ResizeObserver) new ResizeObserver(() => { resizeCanvas(); redrawVisibleChart() }).observe(document.querySelector('.viewer-area'))

// ASE sub-tab switching
function selectSubtab (id) {
  const btn = document.querySelector(`.ase-stab[data-stab="${id}"]`)
  $$('.ase-stab').forEach(b => b.classList.remove('active'))
  $$('.ase-subpanel').forEach(p => p.classList.remove('active'))
  btn.classList.add('active')
  $(`ase-sub-${id}`).classList.add('active')
  lastSubtab[btn.dataset.group] = id
  syncTabAria()
  if (charts[id]?.data) charts[id]._render()
  // The fluctuation colour map belongs to its own tab.
  if (id === 'fluct') drawFluct()
  else aseViewer.setOverlay(null)
  if (selectionTargets[id]) { $('ase-selection-target').value = id; updateSelectionTarget() }
}
$$('.ase-stab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.stab === 'view3d') return showViewerTab('view3d')
    // A sub-tab of another module (e.g. from "Use selection") also switches the module tab.
    if (btn.dataset.group !== activeGroup || !$('vtab-content-ase').classList.contains('active')) {
      lastSubtab[btn.dataset.group] = btn.dataset.stab
      showViewerTab(btn.dataset.group)
    } else selectSubtab(btn.dataset.stab)
  })
})
// The 3D view repeats the MONET sub-tabs, so the custom analyses are one click away.
$$('.ase-stab[data-group="custom"]').forEach(source => {
  const btn = document.createElement('button')
  btn.className = 'ase-stab-link' + (source.dataset.stab === 'view3d' ? ' active' : '')
  btn.setAttribute('role', 'tab')
  btn.dataset.stab = source.dataset.stab
  btn.textContent = source.textContent
  btn.hidden = source.classList.contains('registry-empty')
  btn.addEventListener('click', () => source.click())
  $('monet-subtabbar').appendChild(btn)
})
syncTabAria()
// "More analyses" is shown only when plugins are installed for the module.
function syncMonetSubtabs () {
  for (const btn of $('monet-subtabbar').children) {
    btn.hidden = Boolean(document.querySelector(`.ase-stab[data-stab="${btn.dataset.stab}"]`)?.classList.contains('registry-empty'))
  }
}

// =============================================================================
// ── LineChart — canvas-based scientific line chart ───────────────────────────
// =============================================================================

// Series colors are resolved from the active theme when a chart is drawn.
window.addEventListener('monet-theme', () => {
  viewer.render()
  aseViewer.render()
  redrawVisibleChart()
})

// =============================================================================
// ── ASE panel state + helpers ────────────────────────────────────────────────
// =============================================================================

const aseState = {
  available:   false,
  version:     null,
  convInput:   null,
  convOutput:  null,
  busy: false,
  activeKind: null,
  sourceRevision: 0,
  analysisAtoms: [],
  pickedIds: [],
  centreIds: null, // atoms centred in the cell ("centre selection"), fixed when the option is ticked
  cellParameters: null,
  cellSourceName: null, // file name when the applied cell came from Load cell file
  mic: true,
  cellPbc: [true, true, true],
  cellSource: null
}

const aseViewer = new MolecularViewer($('ase-mol-canvas'))
aseViewer.style = stored('monet-ase-view-style', 'ball-stick')
aseViewer.showAllLabels = true
aseViewer.showSelectionOrder = true
let aseViewerNeedsFit = true

function resizeAseViewer () {
  if (!$('ase-mol-canvas').clientWidth || !$('ase-mol-canvas').clientHeight) return
  aseViewer.resize()
  if (aseViewerNeedsFit) { aseViewer.fitView(); aseViewerNeedsFit = false }
}
window.addEventListener('resize', resizeAseViewer)

function syncAsePicks (ids) {
  const valid = new Set(aseState.analysisAtoms.map(atom => atom.monetId))
  aseState.pickedIds = [...new Set(ids)].filter(id => valid.has(id))
  aseViewer.setSelected(aseState.pickedIds)
  $('ase-picked-count').textContent = aseState.pickedIds.length
  const chips = $('ase-picked-atoms')
  chips.replaceChildren()
  if (!aseState.pickedIds.length) chips.textContent = 'No atoms selected.'
  aseState.pickedIds.forEach((id, order) => {
    const atom = aseState.analysisAtoms.find(atom => atom.monetId === id)
    const chip = document.createElement('button')
    chip.className = 'ase-pick-chip'
    chip.textContent = `${order + 1}: ${id} (${atom.element}) ×`
    chip.title = `Remove MONET atom ${id} from the selection`
    chip.addEventListener('click', () => syncAsePicks(aseState.pickedIds.filter(value => value !== id)))
    chips.appendChild(chip)
  })
  $$('#ase-atom-body tr').forEach(row => {
    const picked = aseState.pickedIds.includes(Number(row.dataset.monetId))
    row.classList.toggle('row-selected', picked)
    row.setAttribute('aria-selected', String(picked))
  })
  $('ase-clear-selection').disabled = !aseState.pickedIds.length
  $('use-ase-selection').disabled = !aseState.pickedIds.length
  $('ase-use-selection').disabled = !aseState.pickedIds.length
  // "centre selection" keeps the atoms fixed when it was ticked: picking atoms must not move the structure.
  if (typeof player !== 'undefined') updateLive()
}
aseViewer.onSelectionChange = syncAsePicks
$('ase-clear-selection').addEventListener('click', () => syncAsePicks([]))
$('ase-fit-view').addEventListener('click', () => {
  aseViewer.rotX = .25; aseViewer.rotY = -.40
  aseViewerNeedsFit = true
  resizeAseViewer()
})

const cellFields = ['a', 'b', 'c', 'alpha', 'beta', 'gamma']
function updateCellPreset () {
  const system = $('cell-system').value
  const disabled = {
    triclinic: [], monoclinic: ['alpha', 'gamma'], orthorhombic: ['alpha', 'beta', 'gamma'],
    tetragonal: ['b', 'alpha', 'beta', 'gamma'], hexagonal: ['b', 'alpha', 'beta', 'gamma'],
    rhombohedral: ['b', 'c', 'beta', 'gamma'], cubic: ['b', 'c', 'alpha', 'beta', 'gamma']
  }[system]
  for (const field of cellFields) $(`cell-${field}`).disabled = disabled.includes(field)
  try {
    const parameters = MonetASEModel.cellParameters(system, cellFields.map(field => $(`cell-${field}`).value))
    parameters.forEach((value, i) => { $(`cell-${cellFields[i]}`).value = value })
  } catch {}
}
$('cell-system').addEventListener('change', updateCellPreset)
for (const field of cellFields) $(`cell-${field}`).addEventListener('input', updateCellPreset)
function invalidateCellAnalyses () {
  aseState.sourceRevision++
  clearAllAnalyses(false)
  aseViewer.cell = aseState.cellParameters ? MonetASEModel.cellVectors(aseState.cellParameters) : null
  aseViewerNeedsFit = true
  resizeAseViewer()
  $('cell-status').textContent = aseState.cellParameters
    ? `Applied cell: ${aseState.cellParameters.join(', ')} (Å, °). PBC: ${aseState.cellPbc.map((on,i) => on ? 'abc'[i] : '').join('') || 'none'}.`
    : 'No manual cell. Source lattice/PBC are used when present.'
  player.treeKey = null
  applyDisplay()
  updateLive()
  if (aseState.cellParameters) $('cell-status').textContent += describeCellFit()
  updateQmUI()
}
$('cell-apply').addEventListener('click', () => {
  try {
    if (!aseState.analysisAtoms.length) throw new Error('Load a trajectory before applying a cell.')
    aseState.cellParameters = MonetASEModel.cellParameters($('cell-system').value, cellFields.map(field => $(`cell-${field}`).value))
    aseState.cellPbc = ['a', 'b', 'c'].map(axis => $(`cell-pbc-${axis}`).checked)
    aseState.cellSourceName = null
    invalidateCellAnalyses()
    setStatus('Crystal cell applied without changing Cartesian coordinates.')
    historyRecord({ kind: 'cell', action: 'apply', params: { cell: aseState.cellParameters, pbc: aseState.cellPbc, mic: aseState.mic } })
  } catch (error) { $('cell-status').textContent = error.message; setStatus(error.message) }
})
$('cell-reset').addEventListener('click', () => {
  aseState.cellParameters = null
  aseState.cellSourceName = null
  invalidateCellAnalyses()
  historyRecord({ kind: 'cell', action: 'reset', params: { mic: aseState.mic } })
})
$('ase-mic').addEventListener('change', () => {
  aseState.mic = $('ase-mic').checked
  invalidateCellAnalyses()
  historyRecord({ kind: 'cell', action: 'mic', params: { mic: aseState.mic } })
})
function cellOptions () {
  return { ...(aseState.cellParameters ? { cell: aseState.cellParameters, pbc: aseState.cellPbc } : {}), mic: aseState.mic }
}
$('cell-read').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename || aseState.busy || !aseState.available) return setStatus('Load a trajectory and connect ASE first.')
  const revision = aseState.sourceRevision
  aseState.busy = true; updateAseControls()
  try {
    const info = await window.monet.aseRun({ action: 'read_info', filename })
    if (revision !== aseState.sourceRevision) return
    if (!info.ok) throw new Error(info.message || info.error)
    MonetASEModel.verifyAtoms(aseState.analysisAtoms, info)
    if (!info.cellpar || info.cellpar.slice(0, 3).some(v => v <= 0)) throw new Error('The active XYZ contains no complete cell. Enter the six parameters manually.')
    $('cell-system').value = 'triclinic'
    info.cellpar.forEach((v, i) => { $(`cell-${cellFields[i]}`).value = Number(v.toFixed(6)) })
    ;['a', 'b', 'c'].forEach((axis,i) => { $(`cell-pbc-${axis}`).checked = Boolean(info.pbc[i]) })
    updateCellPreset()
    aseState.cellParameters = null
    aseState.cellSourceName = null
    aseState.sourceRevision++; clearAllAnalyses(false)
    // Preserve the source vectors' orientation, rather than rebuilding from metrics.
    aseViewer.cell = info.cell
    aseViewerNeedsFit = true; resizeAseViewer()
    $('cell-status').textContent = `Using source cell (${info.cellpar.map(v => Number(v.toFixed(5))).join(', ')}); original vector orientation retained. Apply cell would replace it with the standard orientation.`
    historyRecord({ kind: 'cell', action: 'source', params: { cellpar: info.cellpar, pbc: info.pbc } })
  } catch (error) { $('cell-status').textContent = error.message; setStatus(error.message) }
  finally { aseState.busy = false; updateAseControls() }
})

$('cell-load-file').addEventListener('click', async () => {
  if (aseState.busy || !aseState.available) return setStatus('Connect ASE first (python3 start_monet.py or the desktop app).')
  let fp = null
  try {
    fp = await window.monet.selectFile()
    if (!fp) return
    aseState.busy = true; updateAseControls()
    const info = await window.monet.aseRun({ action: 'cell_file', filename: fp })
    if (!info.ok) throw new Error(info.message || info.error)
    $('cell-system').value = 'triclinic'
    info.cellpar.forEach((v, i) => { $(`cell-${cellFields[i]}`).value = Number(v.toFixed(6)) })
    updateCellPreset()
    const name = fp.split(/[\\/]/).pop()
    historyRecord({ kind: 'cell', action: 'file', params: { name, cellpar: info.cellpar } })
    if (aseState.analysisAtoms.length) {
      aseState.cellParameters = MonetASEModel.cellParameters('triclinic', cellFields.map(field => $(`cell-${field}`).value))
      aseState.cellPbc = ['a', 'b', 'c'].map(axis => $(`cell-pbc-${axis}`).checked)
      aseState.cellSourceName = name // the QM cards name the cell's file
      invalidateCellAnalyses()
      $('cell-status').textContent += ` Read from ${name}.${info.note ? ' ' + info.note : ''}`
      setStatus(`Cell from ${name} applied.`)
    } else {
      $('cell-status').textContent = `Cell read from ${name}; load a trajectory, then press Apply cell.${info.note ? ' ' + info.note : ''}`
    }
  } catch (error) { $('cell-status').textContent = error.message; setStatus(error.message) }
  finally {
    if (fp) window.monet.releaseFile?.(fp)
    aseState.busy = false; updateAseControls()
  }
})


// =============================================================================
// ── Trajectory player, cell display and live geometry (ASE viewer) ──────────
// =============================================================================

// `var`: other handlers check `typeof player` before this block has run.
var player = {
  index: 0, count: 0, playing: false, timer: null, token: 0,
  cache: new Map(), cells: new Map(), raw: null, tree: null, treeKey: null, loading: null
}
const PLAYER_BUDGET = 3e7 // cached coordinates (numbers) kept in memory
const CURSOR_KINDS = ['rmsd', 'bonds', 'angles', 'dihedrals', 'mda', 'coordination', 'fluctseries', ...Object.keys(REGISTRY_PANELS)]

function playerCount () {
  if (state.lastResult?.success) return state.lastResult.totalFrames || state.fileInfo?.configCount || 0
  return state.fileInfo?.configCount || 0
}

function playerAtomsByIndex () {
  const n = aseState.analysisAtoms.length
  const elements = new Array(n)
  for (const atom of aseState.analysisAtoms) elements[atom.aseIndex] = atom.element
  return elements
}

function firstFrameCoords () {
  const coords = new Float64Array(3 * aseState.analysisAtoms.length)
  for (const atom of aseState.analysisAtoms) {
    coords[3 * atom.aseIndex] = atom.x; coords[3 * atom.aseIndex + 1] = atom.y; coords[3 * atom.aseIndex + 2] = atom.z
  }
  return coords
}

// Cell used for display and live geometry: manual cell, otherwise the lattice of the shown frame.
function displayCell () {
  if (aseState.cellParameters) return MonetASEModel.cellVectors(aseState.cellParameters)
  return player.cells.get(player.index) || aseViewer.cell || null
}

function playerReset () {
  playerStop()
  player.token++
  player.cache.clear()
  player.cells.clear()
  player.index = 0
  player.count = playerCount()
  player.tree = null
  player.treeKey = null
  player.raw = aseState.analysisAtoms.length ? firstFrameCoords() : null
  if (player.raw) player.cache.set(0, player.raw)
  $('player-slider').max = Math.max(0, player.count - 1)
  $('player-slider').value = 0
  updatePlayerControls()
  updateFrameLabel()
  updateLive()
  // Pick up the lattice of the first frame (extended XYZ) without blocking the load.
  if (player.raw && aseState.available && extractedTrajPath()) fetchFrames([0]).then(() => { if (player.index === 0) showFrame(0) }).catch(() => {})
}

function updatePlayerControls () {
  const ready = Boolean(player.raw) && player.count > 0
  const remote = ready && aseState.available && player.count > 1
  for (const id of ['player-first', 'player-prev', 'player-next', 'player-last', 'player-play', 'player-slider']) $(id).disabled = !remote
  $('player-play').textContent = player.playing ? '⏸ Stop' : '▶ Play'
  $('player-play').setAttribute('aria-pressed', String(player.playing))
  $('ase-wrap').disabled = !ready
  $('ase-center').disabled = !ready
  $('btn-wrap').disabled = !aseState.available || aseState.busy || !extractedTrajPath()
}

function updateFrameLabel () {
  const last = Math.max(0, player.count - 1)
  $('player-frame').textContent = `frame ${player.index} / ${last}`
  $('ase-viewer-title').textContent = player.count > 1 ? `ASE molecule · frame ${player.index}` : 'ASE molecule · first frame'
}

function playerStep () { return Math.max(1, Math.floor(Number($('player-step').value) || 1)) }

function evictFrames () {
  const size = 3 * aseState.analysisAtoms.length || 1
  while (player.cache.size * size > PLAYER_BUDGET && player.cache.size > 2) {
    const oldest = player.cache.keys().next().value
    if (oldest === player.index) { player.cache.delete(oldest); player.cache.set(oldest, player.raw); continue }
    player.cache.delete(oldest)
  }
}

async function fetchFrames (indices) {
  const filename = extractedTrajPath()
  const token = player.token
  const wanted = indices.filter(i => !player.cache.has(i) || !player.cells.has(i))
  if (!wanted.length || !filename) return
  const r = await window.monet.aseRun({ action: 'frames', filename, indices: wanted })
  if (token !== player.token) return
  if (!r.ok) throw new Error(r.message || r.error)
  if (r.natoms !== aseState.analysisAtoms.length) throw new Error('The trajectory changed; reload it.')
  if (r.nframes && r.nframes !== player.count) {
    player.count = r.nframes
    $('player-slider').max = Math.max(0, player.count - 1)
    updateFrameLabel()
  }
  r.indices.forEach((frame, k) => {
    player.cache.set(frame, Float64Array.from(r.positions[k]))
    if (r.cells[k]) player.cells.set(frame, r.cells[k])
  })
  evictFrames()
}

// Frames requested together: the target and the next ones along the playback direction.
function batchFrom (start, direction = 1) {
  const n = Math.max(1, aseState.analysisAtoms.length)
  const size = Math.max(1, Math.min(200, Math.floor(4e5 / (3 * n))))
  const step = playerStep() * direction
  const out = []
  for (let k = 0, i = start; k < size && i >= 0 && i < player.count; k++, i += step) out.push(i)
  return out
}

async function goToFrame (frame, { direction = 1 } = {}) {
  if (!player.raw || !player.count) return
  frame = Math.max(0, Math.min(player.count - 1, Math.round(frame)))
  if (!player.cache.has(frame)) {
    if (!aseState.available) return setStatus('The trajectory player needs ASE (launcher or desktop app).')
    try {
      player.loading = frame
      $('player-frame').textContent = `loading frame ${frame} …`
      await fetchFrames(batchFrom(frame, direction))
    } catch (error) {
      playerStop()
      setStatus('Trajectory player: ' + error.message)
      return
    } finally { player.loading = null }
    if (!player.cache.has(frame)) return
  }
  showFrame(frame)
}

function showFrame (frame) {
  player.index = frame
  player.raw = player.cache.get(frame)
  const cell = displayCell()
  if (!aseState.cellParameters) {
    const lattice = player.cells.get(frame)
    if (lattice) aseViewer.cell = lattice
  }
  applyDisplay({ rebond: !player.playing || aseState.analysisAtoms.length < 3000, cell })
  $('player-slider').value = frame
  updateFrameLabel()
  updateLive()
  for (const kind of CURSOR_KINDS) {
    const chart = charts[kind]
    const frameAxis = chart?.data && !chart.data.type && /^Frame/.test(chart.data.xLabel || '')
    if (chart?.setCursor) chart.setCursor(frameAxis ? String(frame) : null)
  }
}

function moleculeTreeFor (cell) {
  const key = `${JSON.stringify(cell)}|${$('ase-bond-scale').value}`
  if (player.treeKey !== key) {
    const coords = player.cache.get(0) || player.raw
    player.tree = MonetPBC.moleculeTree(aseState.analysisAtoms.length,
      MonetPBC.periodicBonds(playerAtomsByIndex(), coords, cell, Number($('ase-bond-scale').value) || 1.2))
    player.treeKey = key
  }
  return player.tree
}

function applyDisplay ({ rebond = true, cell = displayCell() } = {}) {
  if (!player.raw) return
  const mode = $('ase-wrap').value
  const centre = $('ase-center').checked
  let coords = player.raw
  if (cell && (mode !== 'none' || centre)) {
    try {
      const byId = new Map(aseState.analysisAtoms.map(atom => [atom.monetId, atom.aseIndex]))
      const picked = (aseState.centreIds || []).map(id => byId.get(id)).filter(i => i !== undefined)
      const center = centre ? (picked.length ? picked : aseState.analysisAtoms.map(atom => atom.aseIndex)) : null
      coords = MonetPBC.wrapFrame(player.raw, cell, { mode, tree: mode === 'molecules' ? moleculeTreeFor(cell) : null, center })
    } catch (error) { setStatus('Cell display: ' + error.message) }
  } else if (mode !== 'none' || centre) {
    setStatus('Cell display needs a periodic cell: apply one in “Crystal cell”, load it from a CIF, or use an extended XYZ with a lattice.')
  }
  const ordered = new Float64Array(3 * aseViewer.atoms.length)
  aseViewer.atoms.forEach((atom, k) => {
    ordered[3 * k] = coords[3 * atom.aseIndex]; ordered[3 * k + 1] = coords[3 * atom.aseIndex + 1]; ordered[3 * k + 2] = coords[3 * atom.aseIndex + 2]
  })
  aseViewer.updateCoordinates(ordered, { rebond })
}

// Distance / angle / dihedral of the picked atoms in the shown frame (minimum image when enabled).
function updateLive () {
  const box = $('ase-live')
  const ids = aseState.pickedIds
  if (!player.raw || ids.length < 2 || ids.length > 4) {
    box.textContent = ids.length > 4 ? 'Select 2–4 atoms for a live distance, angle or dihedral.' : ''
    return
  }
  const byId = new Map(aseState.analysisAtoms.map(atom => [atom.monetId, atom.aseIndex]))
  const cell = aseState.mic ? displayCell() : null
  const result = MonetPBC.geometry(player.raw, ids.map(id => byId.get(id)), cell)
  const label = ids.join('–')
  const text = {
    distance: `d(${label}) = ${result.value.toFixed(4)} Å`,
    angle: `∠(${label}) = ${result.value.toFixed(2)}°`,
    dihedral: `φ(${label}) = ${result.value.toFixed(2)}° (0–360°)`
  }[result.kind]
  box.textContent = `Frame ${player.index}: ${text}${cell ? ' · minimum image' : ''}`
}

function playerStop () {
  player.playing = false
  clearTimeout(player.timer)
  player.timer = null
  updatePlayerControls()
}

async function playerTick () {
  if (!player.playing) return
  const started = performance.now()
  let next = player.index + playerStep()
  if (next >= player.count) {
    if (!$('player-loop').checked) return playerStop()
    next = 0
  }
  await goToFrame(next)
  if (!player.playing) return
  // Prefetch ahead so playback does not stall at the end of a batch.
  const ahead = batchFrom(player.index + playerStep())
  if (ahead.length && !player.cache.has(ahead[Math.min(ahead.length - 1, 3)]) && player.loading === null) fetchFrames(ahead).catch(() => {})
  const delay = Math.max(0, 1000 / Number($('player-fps').value) - (performance.now() - started))
  player.timer = setTimeout(playerTick, delay)
}

function playerToggle () {
  if (player.playing) return playerStop()
  if (!player.raw || player.count < 2) return
  player.playing = true
  updatePlayerControls()
  playerTick()
}

$('player-play').addEventListener('click', playerToggle)
$('player-first').addEventListener('click', () => { playerStop(); goToFrame(0) })
$('player-last').addEventListener('click', () => { playerStop(); goToFrame(player.count - 1, { direction: -1 }) })
$('player-next').addEventListener('click', () => { playerStop(); goToFrame(player.index + playerStep()) })
$('player-prev').addEventListener('click', () => { playerStop(); goToFrame(player.index - playerStep(), { direction: -1 }) })
$('player-slider').addEventListener('input', () => { playerStop(); goToFrame(Number($('player-slider').value)) })
for (const id of ['ase-wrap', 'ase-center']) $(id).addEventListener('change', () => {
  // The centring atoms are those selected when the box is ticked (all atoms if none).
  if (id === 'ase-center') {
    aseState.centreIds = $('ase-center').checked ? [...aseState.pickedIds] : null
    if ($('ase-center').checked) setStatus(aseState.centreIds.length
      ? `Centred on the ${aseState.centreIds.length} selected atoms; later picks do not move the view (untick and tick again to re-centre).`
      : 'Centred on all atoms; select atoms, then untick and tick again to centre on them.')
  }
  applyDisplay()
  aseViewerNeedsFit = true
  resizeAseViewer()
})
$('ase-bond-scale').addEventListener('change', () => { player.treeKey = null; applyDisplay() })
$('ase-mol-canvas').addEventListener('keydown', event => {
  if (event.key === ' ') { event.preventDefault(); playerToggle() }
  if (event.key === 'ArrowRight') { event.preventDefault(); playerStop(); goToFrame(player.index + playerStep()) }
  if (event.key === 'ArrowLeft') { event.preventDefault(); playerStop(); goToFrame(player.index - playerStep(), { direction: -1 }) }
})
$('ase-mol-canvas').tabIndex = 0
// Click a time-series plot to show that frame (bound once the charts exist).
function bindPlayerCharts () {
  for (const kind of CURSOR_KINDS) {
    const chart = charts[kind]
    chart.canvas.addEventListener('click', event => {
      if (!chart.data || chart.data.type || !/^Frame/.test(chart.data.xLabel || '')) return
      const label = chart.labelAt(event.clientX)
      if (label === null || label === undefined) return
      playerStop()
      goToFrame(Number(label))
    })
  }
}

// Diagnostic after a cell is set: share of first-frame atoms outside it.
function describeCellFit () {
  const cell = displayCell()
  if (!cell || !player.raw) return ''
  try {
    const outside = MonetPBC.outsideFraction(player.cache.get(0) || player.raw, cell)
    if (outside < 0.005) return ''
    return ` ${Math.round(outside * 100)}% of the atoms lie outside this cell: choose “Cell display → wrap whole molecules” under the viewer (display only), or “Wrap and download” in Convert. If molecules still overlap after wrapping, the XYZ was written with other cell vectors: use the simulation cell (extended XYZ lattice, CP2K .cell) rather than the CIF metric.`
  } catch { return '' }
}

$('btn-wrap').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load a trajectory first.')
  const stem = filename.split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
  const output = await window.monet.aseSelectOutput(`${stem}-wrapped.extxyz`)
  if (!output) return
  $('download-wrapped').classList.add('hidden')
  const byId = new Map(aseState.analysisAtoms.map(atom => [atom.monetId, atom.aseIndex]))
  const center = $('wrap-center').checked ? aseState.pickedIds.map(id => byId.get(id)) : null
  if (center && !center.length) return setStatus('Select the atoms to centre in the viewer first.')
  const r = await runAse('wrap', { action: 'wrap', filename, output, mode: $('wrap-mode').value, ...(center ? { center } : {}) })
  if (!r.ok) return setStatus('Wrap error: ' + (r.message || r.error))
  if (r.downloadURL) {
    $('download-wrapped').href = r.downloadURL
    $('download-wrapped').download = r.output || `${stem}-wrapped.extxyz`
    $('download-wrapped').classList.remove('hidden')
  }
  setStatus(`Wrapped ${r.n_frames} frames${r.n_molecules ? ` (${r.n_molecules} molecules)` : ''}${r.output && !r.downloadURL ? ` → ${r.output}` : ''}.`)
})

const ACF_WIDTH = { bond: 2, angle: 3, dihedral: 4 }
const selectionTargets = {
  rmsd: { input: 'rmsd-atoms', minimum: 1 },
  pdd: { input: 'pdd-atoms', minimum: 2 },
  bonds: { input: 'bonds-pairs', width: 2 },
  angles: { input: 'angles-triplets', width: 3 },
  dihedrals: { input: 'dihedrals-quads', width: 4 },
  rmsdmatrix: { input: 'rmsdmatrix-atoms', minimum: 1 },
  rdf: { input: 'rdf-atoms', minimum: 1 },
  msd: { input: 'msd-atoms', minimum: 1 },
  vdos: { input: 'vdos-atoms', minimum: 1 },
  fluct: {
    get input () { return $('fluct-scope').value === 'groups' ? 'fluct-groups' : 'fluct-atoms' },
    get width () { return $('fluct-scope').value === 'groups' ? FLUCT_WIDTH[$('fluct-quantity').value] : undefined },
    minimum: 1
  },
  acf: {
    input: 'acf-groups',
    get width () { return ACF_WIDTH[$('acf-quantity').value] },
    get minimum () { return 1 }
  }
}
function updateSelectionTarget () {
  const target = selectionTargets[$('ase-selection-target').value]
  $('ase-append-group').disabled = !target.width
  $('ase-selection-hint').textContent = target.width
    ? `Select atoms in groups of ${target.width}, in order. Use selection to fill the IDs; then click Compute.`
    : `Select at least ${target.minimum} atom${target.minimum > 1 ? 's' : ''}. Use selection to restrict this analysis to those atoms.`
}
$('ase-selection-target').addEventListener('change', updateSelectionTarget)
$('ase-use-selection').addEventListener('click', () => {
  const kind = $('ase-selection-target').value
  const target = selectionTargets[kind]
  const raw = aseState.pickedIds.join(' ')
  try {
    if (target.width) MonetASEModel.groupsFromIds(raw, target.width, aseState.analysisAtoms)
    else MonetASEModel.selectedIndices(raw, aseState.analysisAtoms, target.minimum)
    const input = $(target.input)
    input.value = target.width && $('ase-append-group').checked && input.value.trim()
      ? `${input.value.trim()}  ${raw}` : raw
    document.querySelector(`.ase-stab[data-stab="${kind}"]`).click()
    setStatus('Selected MONET IDs applied. Click Compute to run the analysis.')
  } catch (error) {
    $('ase-selection-hint').textContent = error.message
    setStatus(error.message)
  }
})

const charts = {
  rmsd:   new MonetLineChart('chart-rmsd',   'chart-rmsd-ph'),
  pdd:    new MonetLineChart('chart-pdd',    'chart-pdd-ph'),
  bonds:  new MonetLineChart('chart-bonds',  'chart-bonds-ph'),
  angles: new MonetLineChart('chart-angles', 'chart-angles-ph'),
  dihedrals: new MonetLineChart('chart-dihedrals', 'chart-dihedrals-ph'),
  rmsdmatrix: new MonetHeatmapChart('chart-rmsdmatrix', 'chart-rmsdmatrix-ph'),
  rdf: new MonetLineChart('chart-rdf', 'chart-rdf-ph'),
  msd: new MonetLineChart('chart-msd', 'chart-msd-ph'),
  vdos: new MonetLineChart('chart-vdos', 'chart-vdos-ph'),
  acf: new MonetLineChart('chart-acf', 'chart-acf-ph'),
  acfblock: new MonetLineChart('chart-acfblock', 'chart-acfblock-ph'),
  equil: new MonetLineChart('chart-equil', 'chart-equil-ph'),
  rmsddist: new MonetLineChart('chart-rmsddist', 'chart-rmsddist-ph'),
  bondsdist: new MonetLineChart('chart-bondsdist', 'chart-bondsdist-ph'),
  anglesdist: new MonetLineChart('chart-anglesdist', 'chart-anglesdist-ph'),
  dihedralsdist: new MonetLineChart('chart-dihedralsdist', 'chart-dihedralsdist-ph'),
  mda: new MonetLineChart('chart-mda', 'chart-mda-ph'),
  mdadist: new MonetLineChart('chart-mdadist', 'chart-mdadist-ph'),
  coordination: new MonetLineChart('chart-coordination', 'chart-coordination-ph'),
  mdamatrix: new MonetHeatmapChart('chart-mdamatrix', 'chart-mdamatrix-ph'),
  fluct: new MonetLineChart('chart-fluct', 'chart-fluct-ph'),
  fluctseries: new MonetLineChart('chart-fluctseries', 'chart-fluctseries-ph'),
}
for (const kind of Object.keys(REGISTRY_PANELS)) {
  charts[kind] = new MonetLineChart(`chart-${kind}`, `chart-${kind}-ph`)
  charts[`${kind}matrix`] = new MonetHeatmapChart(`chart-${kind}matrix`, `chart-${kind}matrix-ph`)
}
bindPlayerCharts()
for (const [kind, chart] of Object.entries(charts)) if (chart.enableZoom && !kind.endsWith('dist')) chart.enableZoom()
const RUN_KINDS = ['rmsd', 'pdd', 'bonds', 'angles', 'dihedrals', 'rmsdmatrix', 'rdf', 'msd', 'vdos', 'acf', 'equil', 'mda', 'structure', 'coordination', 'topology', 'fluct', ...Object.keys(REGISTRY_PANELS)]
const lastResults = {}

// Wire up ASE progress listener (once)
window.monet.onAseProgress(msg => {
  setStatus(msg.message)
})

function setAseProgress (fillId, labelId, rowId, pct, msg) {
  const row = $(rowId)
  if (!row) return
  row.classList.remove('hidden')
  $(fillId).style.width  = (pct ?? 0) + '%'
  $(labelId).textContent = msg || ''
}

function hideAseProgress (rowId) {
  $(rowId)?.classList.add('hidden')
}

function extractedTrajPath () {
  if (state.lastResult?.success) return `${state.lastResult.outputDir}/1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz`
  return state.fileInfo ? state.filePath : null
}

function updateAnalysisSource () {
  aseState.sourceRevision++
  if (aseState.cellSource !== state.filePath) {
    aseState.cellParameters = null
    aseState.cellSourceName = null
    aseState.cellSource = state.filePath
    aseViewer.cell = null
    $('cell-status').textContent = 'No manual cell. Source lattice/PBC are used when present.'
  } else if (!aseState.cellParameters) aseViewer.cell = null
  hideAtomMenu()
  const extracted = Boolean(state.lastResult?.success)
  aseState.centreIds = $('ase-center').checked ? [] : null
  aseState.analysisAtoms = extracted ? state.lastResult.sourceAtoms.map(atom => ({ ...atom }))
    : MonetASEModel.atomMap(state.firstFrame || [])
  const atoms = aseState.analysisAtoms
  const name = extractedTrajPath()?.split(/[\\/]/).pop() || ''
  $('analysis-source').textContent = atoms.length
    ? `Source: ${extracted ? 'extracted trajectory' : state.derivedLabel ? state.derivedLabel : 'loaded XYZ'} · ${name} · ${atoms.length} atoms. Use MONET IDs in analysis inputs.`
    : 'Load an XYZ file and click Next to begin analysis.'
  $('ase-atom-count').textContent = atoms.length
  const body = $('ase-atom-body')
  body.replaceChildren()
  for (const atom of atoms) {
    const row = document.createElement('tr')
    row.dataset.monetId = atom.monetId
    row.tabIndex = 0
    const toggle = () => syncAsePicks(aseState.pickedIds.includes(atom.monetId)
      ? aseState.pickedIds.filter(id => id !== atom.monetId) : [...aseState.pickedIds, atom.monetId])
    row.addEventListener('click', toggle)
    row.addEventListener('contextmenu', event => showAtomMenu(event, atom.monetId))
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle() }
    })
    for (const value of [atom.monetId, atom.aseIndex, atom.element, ...['x', 'y', 'z'].map(axis => atom[axis].toFixed(7)), atom.residue ?? '', atom.molecule ?? '']) {
      const cell = document.createElement('td')
      cell.textContent = value
      row.appendChild(cell)
    }
    body.appendChild(row)
  }
  $('ase-atom-match').textContent = atoms.length
    ? 'Atom order matches MONET. Elements and coordinates will be checked against ASE before calculation.'
    : 'No trajectory loaded.'
  resetTopology()
  aseViewer.loadAtoms(atoms.map(atom => ({ ...atom, index: atom.monetId })))
  aseViewerNeedsFit = true
  resizeAseViewer()
  syncAsePicks([])
  for (const target of Object.values(selectionTargets)) $(target.input).value = ''
  $('fluct-groups').value = ''
  updateSelectionTarget()
  clearAllAnalyses(false)
  updateAseControls()
  playerReset()
  if (atoms.length && aseState.available) checkTopology({ quiet: true })
}

function updateAseControls () {
  for (const kind of RUN_KINDS) {
    $(`btn-run-${kind}`).disabled = !aseState.available || aseState.busy
  }
  $('btn-unwrap').disabled = !aseState.available || aseState.busy || !extractedTrajPath()
  $('btn-run-mda').disabled ||= !aseState.mdanalysis || !registrySpec($('mda-analysis').value)?.available
  for (const kind of Object.keys(REGISTRY_PANELS)) $(`btn-run-${kind}`).disabled ||= !registrySpec($(`${kind}-analysis`).value)?.available
  $('clear-structure').disabled = !$('structure-result').childElementCount
  $('mda-pick').disabled = !aseState.available || aseState.busy || !aseState.mdanalysis || !aseState.analysisAtoms.length
  updateConvBtn()
  updatePlotControls()
  for (const id of ['cell-apply', 'cell-reset', 'cell-read', 'cell-load-file', 'btn-ase-recheck']) $(id).disabled = aseState.busy
  if (typeof player !== 'undefined') updatePlayerControls()
  $('ase-cancel').disabled = !aseState.busy || !window.monet.cancel
  $('ase-mic').disabled = aseState.busy
  if ($('console-input')) $('console-input').disabled = aseState.busy || monetHistory.readOnly
  $('equil-crop').disabled = !lastResults.equil || lastResults.equil.t0 === 0 || !aseState.available || aseState.busy
}

async function checkAseStatus () {
  $('ase-badge-text').textContent = 'Checking ASE …'
  $('ase-dot').className = 'ase-dot dot-checking'
  let r
  try { r = await window.monet.aseCheck() }
  catch (error) { r = { ok: false, error: error.message } }
  aseState.available = Boolean(r?.ok)
  aseState.version = r?.ase_version
  aseState.mdanalysis = r?.mdanalysis_version || null
  monetHistory.env = {
    monet_version: MONET_VERSION, python: r?.python_version ?? null, ase: r?.ase_version ?? null,
    mdanalysis: r?.mdanalysis_version ?? null, numpy: r?.numpy_version ?? null, scipy: r?.scipy_version ?? null
  }
  historyDo(P => P.setEnvironment(monetHistory.env))
  $('mda-availability').textContent = aseState.mdanalysis
    ? `MDAnalysis ${aseState.mdanalysis} on the active trajectory, with the MONET atom IDs as MDAnalysis ids.`
    : 'MDAnalysis is not installed in the launcher Python (python -m pip install MDAnalysis); these analyses and XTC/TRR/DCD import are unavailable.'
  await loadRegistry()
  if (aseState.available && window.monet.listFormats) loadFormatList()
  $('ase-dot').className = `ase-dot ${aseState.available ? 'dot-ok' : 'dot-err'}`
  $('ase-badge-text').textContent = aseState.available ? `ASE ${r.ase_version}${aseState.mdanalysis ? ` · MDA ${aseState.mdanalysis}` : ''}` : 'ASE unavailable'
  $('ase-tab-badge').style.display = aseState.available ? 'inline' : 'none'
  $('ase-connection').textContent = aseState.available
    ? 'ASE connected. RMSD uses raw Cartesian coordinates. Distances and angles follow the minimum-image setting. RMSD does not unwrap periodic trajectories.'
    : (r?.message || r?.error || 'ASE is unavailable.') + ' Install ASE in the Python environment used to launch MONET, then click Recheck.'
  $('ase-badge').title = $('ase-connection').textContent
  updateAseControls()
  if (aseState.available && aseState.analysisAtoms.length) checkTopology({ quiet: true })
}

$('btn-ase-recheck').addEventListener('click', checkAseStatus)

const analysisRevision = Object.fromEntries(Object.keys(charts).map(kind => [kind, 0]))

function updatePlotControls () {
  for (const [kind, chart] of Object.entries(charts)) {
    $(`clear-${kind}`).disabled = !chart.data && aseState.activeKind !== kind
    $(`download-${kind}`).disabled = !chart.data
    $(`csv-${kind}`).disabled = !chart.data
  }
  $('fluct-table-csv').disabled = !fluct
  $('btn-clear-analyses').disabled = !Object.values(charts).some(chart => chart.data) && !charts[aseState.activeKind]
}

function clearAnalysis (kind, report = true) {
  analysisRevision[kind]++
  charts[kind].clear()
  delete lastResults[kind]
  hideAseProgress(`${kind}-prog-row`)
  if ($(`${kind}-prog-label`)) $(`${kind}-prog-label`).textContent = '—'
  if (kind === 'acf') { $('acf-result').classList.add('hidden'); clearAnalysis('acfblock', false) }
  if (kind === 'acfblock') $('acfblock-text').classList.add('hidden')
  if (kind === 'equil') $('equil-result').classList.add('hidden')
  if (charts[`${kind}dist`]) clearAnalysis(`${kind}dist`, false)
  for (const id of { msd: ['msd-info'], vdos: ['vdos-info'] }[kind] || []) $(id).classList.add('hidden')
  if (kind === 'mda' || REGISTRY_PANELS[kind]) {
    for (const id of [`${kind}-download`, `${kind}-activate`, `${kind}-error`]) $(id).classList.add('hidden')
    $(`${kind}-table`).replaceChildren()
    if (kind === 'mda') resetPca()
    clearAnalysis(`${kind}matrix`, false)
    $(`${kind}-matrix-block`).classList.add('hidden')
  }
  if (kind === 'fluct') {
    fluct = null
    clearAnalysis('fluctseries', false)
    $('fluct-table').replaceChildren()
    $('fluct-summary').classList.add('hidden')
    aseViewer.setOverlay(null)
  }
  if (report) setStatus('Analysis cleared. Your trajectory and atom selection are unchanged.')
}

function clearAllAnalyses (report = true) {
  for (const kind of Object.keys(charts)) clearAnalysis(kind, false)
  if (report) setStatus('All analyses cleared. Your trajectory and atom selection are unchanged.')
}

for (const [kind, chart] of Object.entries(charts)) {
  chart.onChange = updatePlotControls
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
}
$('btn-clear-analyses').addEventListener('click', () => { for (const kind of Object.keys(charts)) historyClear(kind); clearAllAnalyses() })
$('ase-cancel').addEventListener('click', async () => {
  $('ase-cancel').disabled = true
  setStatus('Cancelling the running calculation …')
  await window.monet.cancel?.('ase')
})

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

// Series keys of bonds/angles/dihedrals/ase_coordination results are file indices (e.g. "0-1"), not
// atom labels. Relabel every '-'-separated integer part through the step's mapping (aseIndex →
// monetId) before it is logged, so the history and methods report read MONET atom IDs. A key whose
// parts are not all mapped integers (coordination's "C (mean of 2)", "C1", …) is left unchanged.
function relabelSeriesKeys (series, mapping) {
  if (!series || typeof series !== 'object' || !Array.isArray(mapping) || !mapping.length) return series
  const byIndex = new Map(mapping.map(atom => [atom.aseIndex, atom.monetId]))
  const out = {}
  for (const [key, value] of Object.entries(series)) {
    const parts = key.split('-')
    const mapped = parts.map(part => (/^\d+$/.test(part) && byIndex.has(Number(part)) ? byIndex.get(Number(part)) : null))
    out[mapped.every(id => id !== null) ? mapped.join('-') : key] = value
  }
  return out
}

// session is the one captured when the step began (see runAse): if it isn't the current one any
// more -- Open session, a resume or a new load swapped it while this step was in flight -- do
// nothing, rather than finishing or failing a step id that may not even mean the same thing in
// whatever session is current now.
function historyEnd (stepId, session, kind, command, result, mapping) {
  if (stepId == null || session !== monetHistory.session) return
  historyDo(P => {
    if (!result?.ok) return P.fail(stepId, result?.message || result?.error || 'failed')
    const outputs = []
    if (result.filePath) {
      monetHistory.stepByPath.set(result.filePath, stepId)
      outputs.push({ file: fileName(result.output) || fileName(result.filePath), sha256: result.sha256 || null })
    } else if (result.output) outputs.push({ file: fileName(result.output) })
    const forSummary = result.series ? { ...result, series: relabelSeriesKeys(result.series, mapping) } : result
    P.finish(stepId, forSummary, { outputs })
    if (!DERIVING_ACTIONS.has(command.action)) monetHistory.stepByKind[kind] = stepId
  }, session)
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
      historyDo(P => P.setEnvironment(monetHistory.env))
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

async function historyExtracted (stepId, session, result, sourceAtoms) {
  const path = extractedTrajPath()
  let digest = null
  try { digest = await window.monet.fileDigest?.(path) } catch {}
  if (session !== monetHistory.session) return
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
  }, session)
  onHistoryChange()
}

async function runAse (kind, command) {
  if (aseState.busy) return { ok: false, error: 'Another ASE calculation is running.' }
  if (monetHistory.readOnly) return { ok: false, error: 'Session open read-only: load its trajectory to continue, or load another file to start a new history.' }
  if (!aseState.available) return { ok: false, error: 'ASE is unavailable. Check the connection message above.' }
  const sourceRevision = aseState.sourceRevision
  const revision = analysisRevision[kind]
  const mapping = aseState.analysisAtoms.map(atom => ({ ...atom }))
  if (kind === 'conv' && $('conv-apply-cell').checked && !aseState.cellParameters) return { ok: false, error: 'Apply a manual crystal cell first.' }
  const options = kind !== 'conv' || $('conv-apply-cell').checked ? cellOptions() : {}
  command = { ...command, ...options }
  if (/^(mda_|topology$|ase_|fluctuations$|run_analysis$)/.test(command.action || '')) {
    // Atom i of the analysed file is MONET ID atom_ids[i]: MDAnalysis gets the same numbering.
    const ids = []
    for (const atom of mapping) ids[atom.aseIndex] = atom.monetId
    if (ids.length === mapping.length && !ids.includes(undefined)) command.atom_ids = ids
    const scale = Number($('ase-bond-scale').value)
    if (scale >= 0.5 && scale <= 2) command.bond_scale = scale
  }
  const stepId = historyBegin(kind, command, mapping)
  const stepSession = monetHistory.session
  const rmsdNote = command.align ? ' Kabsch-aligned RMSD.' : ' Raw Cartesian RMSD.'
  const source = $('analysis-source').textContent + (options.cell ? ` Cell: ${options.cell.join(', ')}; PBC ${options.pbc.map(v => v ? 1 : 0).join('')}.` : ' Source cell.') + (['rmsd', 'rmsdmatrix'].includes(kind) ? rmsdNote + (command.unwrap ? ' Unwrapped.' : '') : ` MIC ${options.mic ? 'on' : 'off'}.`)
  aseState.busy = true
  aseState.activeKind = kind
  updateAseControls()
  const current = () => sourceRevision === aseState.sourceRevision && revision === analysisRevision[kind]
  const relay = msg => {
    if (current()) setAseProgress(`${kind}-prog-fill`, `${kind}-prog-label`, `${kind}-prog-row`, msg.percent ?? 0, msg.message)
  }
  relay({ message: 'Checking ASE atom mapping …', percent: 0 })
  const unsubscribe = window.monet.onAseProgress(relay)
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
    historyEnd(stepId, stepSession, kind, command, outcome, mapping)
    if (typeof unsubscribe === 'function') unsubscribe()
    hideAseProgress(`${kind}-prog-row`)
    aseState.busy = false
    aseState.activeKind = null
    updateAseControls()
  }
}

// =============================================================================
// ── Time series / distribution views with mean ± std in the legend ───────────
// =============================================================================

function geometrySeries (r) {
  return {
    labels: r.frame_indices.map(String),
    series: Object.entries(r.series).map(([key, data]) => ({ name: MonetASEModel.seriesLabel(key, r.atomMapping), data }))
  }
}

const GEOMETRY_RANGES = { natural: [0, 180], 360: [0, 360], signed90: [-90, 90], fold180: [0, 180] }
const GEOMETRY_PERIODS = { 360: 360, signed90: 180, fold180: 180 }

// Probability density of every series (own bins) with the optional fit, below the time series.
function drawGeometryDistribution (kind, entry, { stats, legend, statNotes, low, high, range }) {
  const chart = charts[`${kind}dist`]
  if (!chart) return
  const bins = Math.max(2, Math.min(500, Number($(`${kind}dist-bins`).value) || 60))
  const notes = [...statNotes]
  const hists = entry.series.map(series => MonetASEModel.histogram(series.data, bins, low, high))
  const datasets = entry.series.map((series, i) => ({ label: legend(series, i), data: hists[i].density, bars: true, colorIndex: i }))
  const model = $(`${kind}-fit`).value
  if (model) {
    const period = GEOMETRY_PERIODS[range] || null
    const fitRange = parseFitRange($(`${kind}-fit-range`).value, notes)
    entry.series.forEach((series, i) => {
      try {
        const fit = MonetFit.fitHistogram(hists[i].centres, hists[i].density, { model, period, low, range: fitRange, binWidth: hists[i].width })
        datasets.push({ label: `${fit.label} fit · ${series.name}`, data: fit.curve, dash: true, colorIndex: i })
        notes.push(fitNote(fit, entry.series.length > 1 ? series.name : '', entry.unit))
      } catch (error) {
        notes.push(`${series.name}: fit failed (${error.message})`)
      }
    })
    notes.push('Fit errors come from the fit covariance (bins treated as independent) and ignore time correlation; compare them with the standard error of the mean above.')
  }
  chart.setData({
    title: entry.title.replace(/ vs .*$/, '') + ' — distribution', source: entry.source,
    xLabel: `${entry.quantity} (${entry.unit})`, yLabel: `Probability density (1/${entry.unit})`,
    labels: hists[0].centres.map(value => fmt(value, 5)), yMin: 0, notes, datasets
  })
}

function parseFitRange (text, notes) {
  if (!text.trim()) return null
  const bounds = text.trim().split(/[\s,;]+/).map(Number)
  if (bounds.length === 2 && bounds.every(Number.isFinite)) return bounds
  notes.push('Fit range: enter two numbers (first and last bin centre).')
  return null
}

// "Gaussian fit: μ = 100.03 ± 0.03 °, σ = 8.98 ± 0.03 °, R² = 0.9994"
function fitNote (fit, name, unit) {
  const value = i => `${fmt(fit.params[i], 5)} ± ${fmt(fit.errors[i], 2)}`
  const parts = []
  fit.names.forEach((symbol, i) => {
    if (symbol.startsWith('A')) return
    parts.push(`${symbol} = ${value(i)}${symbol.startsWith('κ') || symbol === 'η' ? '' : ' ' + unit}`)
  })
  if (fit.fwhm) parts.push(`FWHM = ${fmt(fit.fwhm, 5)} ${unit}`)
  if (fit.model === 'vonmises') parts.push(`circular σ = ${fmt(fit.sigma, 4)} ${unit}`)
  if (fit.weights) parts.push(`weights ${fit.weights.map(w => fmt(w, 3)).join(' / ')}`)
  parts.push(`R² = ${fmt(fit.rSquared, 5)}`)
  return `${fit.label} fit${name ? ` (${name})` : ''}: ${parts.join(', ')}`
}

function drawGeometry (kind) {
  const entry = lastResults[kind]
  if (!entry) return
  const range = entry.angleRange
  const digits = entry.unit === '°' ? 4 : 5
  const stats = entry.series.map(series => MonetASEModel.seriesStats(series.data, range))
  const legend = (series, i) => stats[i]
    ? `${series.name} · mean ${fmt(stats[i].mean, digits)} ± ${fmt(stats[i].std, 3)} ${entry.unit}${stats[i].circular ? ' (circular)' : ''}`
    : series.name
  // ± in the legend is the spread (σ); the uncertainty of the mean is the correlation-corrected SEM below.
  const statNote = (st, prefix) => {
    const parts = [`${prefix}${prefix ? 'mean' : 'Mean'} ${fmt(st.mean, 6)} ${entry.unit}, standard deviation ${fmt(st.std, 4)} ${entry.unit}${st.circular ? ` (circular, R = ${fmt(st.resultant, 4)})` : ''}, ${st.n} frames`]
    if (Number.isFinite(st.sem) && st.n > 1) {
      parts.push(`standard error of the mean ${fmt(st.sem, 3)} ${entry.unit} (N_eff = ${fmt(st.nEff, 4)}` +
        (Number.isFinite(st.tauInt) ? `, τ_int = ${fmt(st.tauInt, 3)} analysed frames)` : ')'))
    }
    return parts.join('; ')
  }
  const statNotes = entry.series.length === 1
    ? (stats[0] ? [statNote(stats[0], '')] : [])
    : entry.series.slice(0, 6).map((series, i) => stats[i] ? statNote(stats[i], `${series.name}: `) : null).filter(Boolean)
  const notes = [...(entry.notes || []), ...statNotes]
  const view = $(`${kind}-view`).value
  const values = entry.series.flatMap(series => series.data.filter(Number.isFinite))
  const [low, high] = GEOMETRY_RANGES[range] || [Math.min(...values), Math.max(...values)]
  const bins = Math.max(2, Math.min(500, Number($(`${kind}-bins`).value) || 60))
  updateDistributionOptions(kind)
  drawGeometryDistribution(kind, entry, { stats, legend, statNotes, low, high, range })
  const keepView = charts[kind]._entry === entry
  charts[kind]._entry = entry
  if (view === 'dots' || (view === 'polar' && entry.unit === '°')) {
    const polar = view === 'polar'
    const references = parseReferences(kind)
    let radial = null
    const radialMode = polar ? $(`${kind}-radial`).value : 'dots'
    if (radialMode === 'frame') {
      radial = { label: 'Frame', values: entry.series.map(() => entry.labels.map(Number)) }
    } else if (radialMode === 'custom') {
      const parsed = parseRadialValues($(`${kind}-custom`).value, entry.labels)
      radial = { label: $(`${kind}-custom-label`).value.trim() || 'Value', values: entry.series.map(() => parsed.values) }
      if (parsed.message) notes.push(parsed.message)
    }
    const title = entry.title.replace(/ vs .*$/, '')
    charts[kind].setData({
      type: polar ? 'polar' : 'dots',
      title: `${title} — ${polar ? 'polar distribution' : 'dot histogram'}`, source: entry.source,
      xLabel: `${entry.quantity} (${entry.unit})`, frames: entry.labels, notes, bins,
      range: polar ? GEOMETRY_RANGES[range] || [0, 180] : [low, high], radial, references,
      series: entry.series.map((series, i) => ({ label: legend(series, i), values: series.data, mean: stats[i]?.mean, colorIndex: i }))
    })
    return
  }
  charts[kind].setData({
    title: entry.title, source: entry.source, xLabel: 'Frame', yLabel: `${entry.quantity} (${entry.unit})`,
    angleRange: range, angleNormal: entry.angleNormal, labels: entry.labels, notes,
    datasets: entry.series.map((series, i) => ({ label: legend(series, i), data: series.data, colorIndex: i }))
  }, { keepView })
}

// Reference markers: "84.3" or "84.3 96" (labels are numbered when several values are given).
function parseReferences (kind) {
  const text = $(`${kind}-ref`).value.trim()
  if (!text) return []
  const label = $(`${kind}-ref-label`).value.trim() || 'reference'
  const values = text.split(/[\s,;]+/).map(Number).filter(Number.isFinite)
  return values.map((value, i) => {
    const name = values.length > 1 ? `${label} ${i + 1}` : label
    return { value, short: name, label: `${name} = ${fmt(value, 5)}` }
  })
}

// Radial values for the polar plot: "value" per computed frame, or "frame value" pairs.
function parseRadialValues (text, frameLabels) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^[#!]/.test(line))
  const values = new Array(frameLabels.length).fill(NaN)
  if (!lines.length) return { values, message: 'Paste the radial values to draw the points.' }
  const rows = lines.map(line => line.split(/[\s,;]+/).map(Number))
  if (rows.every(row => row.length >= 2 && row.slice(0, 2).every(Number.isFinite))) {
    const position = new Map(frameLabels.map((frame, k) => [Number(frame), k]))
    let unmatched = 0
    for (const [frame, value] of rows) {
      if (position.has(frame)) values[position.get(frame)] = value
      else unmatched++
    }
    return { values, message: unmatched ? `${unmatched} radial value(s) refer to frames that were not computed.` : '' }
  }
  const single = rows.map(row => row[0])
  single.slice(0, values.length).forEach((value, k) => { values[k] = value })
  const message = single.length !== values.length ? `${single.length} radial values for ${values.length} computed frames; extra frames are not drawn.` : ''
  return { values, message }
}

function updateDistributionOptions (kind) {
  const view = $(`${kind}-view`).value
  const shown = view === 'dots' || view === 'polar'
  $(`${kind}-dist-options`).classList.toggle('hidden', !shown)
  const radial = $(`${kind}-radial`)
  if (!radial) return
  radial.closest('label').classList.toggle('hidden', view !== 'polar')
  $(`${kind}-custom-row`).classList.toggle('hidden', !(view === 'polar' && radial.value === 'custom'))
}

for (const kind of ['rmsd', 'bonds', 'angles', 'dihedrals']) {
  for (const id of [`${kind}-view`, `${kind}-bins`, `${kind}dist-bins`, `${kind}-fit`, `${kind}-fit-range`, `${kind}-radial`, `${kind}-ref`, `${kind}-ref-label`, `${kind}-custom`, `${kind}-custom-label`]) {
    const element = $(id)
    if (!element) continue
    element.addEventListener(element.tagName === 'SELECT' ? 'change' : 'input', () => {
      updateDistributionOptions(kind)
      drawGeometry(kind)
    })
  }
}

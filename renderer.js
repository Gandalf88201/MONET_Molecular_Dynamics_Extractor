'use strict'

// =============================================================================
// ── Molecular Viewer ─────────────────────────────────────────────────────────
// =============================================================================

const { MolecularViewer, STYLES: VIEW_STYLES } = MonetViewer
function themeColor (name, fallback) { return globalThis.MonetTheme ? MonetTheme.color(name, fallback) : fallback }

// =============================================================================
// ── App State ────────────────────────────────────────────────────────────────
// =============================================================================

const state = {
  step:          1,
  filePath:      null,
  fileInfo:      null,   // { format, configCount, atomCount }
  frequency:     10,
  firstFrame:    null,   // [{ index, element, x, y, z }]
  selectedAtoms: new Set(),
  outputDir:     null,
  source: { original: null, format: 'auto', reference: null, cellFile: null, label: null },
  opts: {
    computeAverage:   true,
    generateGaussian: true
  }
}

// Registered analyses (monet_registry.py) outside the MDAnalysis tab: plugins of the ASE and MONET
// Custom engines get a "More analyses" sub-tab, built before the sub-tabs are wired up.
const REGISTRY_PANELS = { extase: 'ase', extcustom: 'custom' }
for (const [kind, engine] of Object.entries(REGISTRY_PANELS)) MonetAnalysisForms.mountPanel(document, { kind, group: engine, title: 'More analyses' })

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

// session defaults to the current one; a caller that captured a session earlier (e.g. before an
// awaited ASE call) can pass it explicitly, so a session swap meanwhile logs onto the session the
// step actually belongs to, never onto whatever session happens to be current when the call lands.
function historyDo (fn, session = monetHistory.session) {
  try { return fn(session) } catch (error) {
    try { session.record({ kind: 'logging_error', error: String(error?.message || error) }) } catch {}
    if (!monetHistory.warned) {
      monetHistory.warned = true
      try { setStatus('The analysis history could not log a step: ' + (error?.message || error)) } catch {}
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
  if (typeof renderHistory === 'function') { try { renderHistory() } catch (error) { console.warn('History view could not be updated:', error) } }
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

// =============================================================================
// ── DOM helpers ──────────────────────────────────────────────────────────────
// =============================================================================

const $  = id  => document.getElementById(id)
const $$ = sel => document.querySelectorAll(sel)

function setStatus (msg) { $('status-msg').textContent = msg }

function log (msg, type = 'info') {
  const box  = $('log-box')
  const line = document.createElement('div')
  line.className = `log-line log-${type}`
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  box.appendChild(line)
  box.scrollTop = box.scrollHeight
}

// =============================================================================
// ── Step navigation ──────────────────────────────────────────────────────────
// =============================================================================

// Workflow order: structure analysis (ASE/MDAnalysis) comes before the MONET extraction.
const STEP_ORDER = ['1', 'analysis', '2', '3', '4', '5', '6']
const STEP_NAMES = { 1: 'File input', analysis: 'Structure analysis', 2: 'Sampling', 3: 'Atom selection', 4: 'Options', 5: 'Processing', 6: 'Results' }

function goTo (step) {
  const position = STEP_ORDER.indexOf(String(step))
  $$('.step-panel').forEach(p => p.classList.remove('active'))
  $$('.step-item').forEach(n => {
    n.classList.remove('active', 'done')
    const ns = STEP_ORDER.indexOf(n.dataset.step)
    if (ns < position)  n.classList.add('done')
    if (ns === position) n.classList.add('active')
  })
  $(`panel-${step}`).classList.add('active')
  state.step = step
  $('rail-step').textContent = `${String(position + 1).padStart(2, '0')} · ${STEP_NAMES[step]}`
  $('rail-continue').classList.toggle('hidden', step !== 'analysis')
  if (step === 3) $('use-ase-selection').disabled = !aseState.pickedIds.length
  if (String(step) === '4') updateQmUI()
}

// ── Collapsible workflow panel ──
function setSidebarCollapsed (collapsed) {
  const layout = document.querySelector('.layout')
  if (layout.classList.contains('sidebar-collapsed') === collapsed) return
  layout.classList.toggle('sidebar-collapsed', collapsed)
  $('sidebar-toggle').textContent = collapsed ? '⇥' : '⇤'
  $('sidebar-toggle').setAttribute('aria-pressed', String(collapsed))
  // Canvases take their size from the new layout.
  const refresh = () => { resizeCanvas(); redrawVisibleChart() }
  if (window.requestAnimationFrame) requestAnimationFrame(refresh); else refresh()
}
$('sidebar-toggle').addEventListener('click', () => setSidebarCollapsed(!document.querySelector('.layout').classList.contains('sidebar-collapsed')))
$('rail-expand').addEventListener('click', () => setSidebarCollapsed(false))

// Analysis groups share one workspace (viewer, atom table, cell, time axis); each shows its own sub-tabs.
const ANALYSIS_GROUPS = {
  ase: 'ASE modules on the loaded trajectory: structure summary, geometry along the frames, coordination, conversion and wrapping.',
  mda: 'MDAnalysis modules on the same trajectory: topology and atom-identity check, then RMSD/RMSF, PCA, hydrogen bonds, contacts, RDF, densities and more.',
  custom: 'MONET custom functionalities: 3D viewer and extraction, autocorrelation (decorrelation time and uncorrelated configurations), Kabsch RMSD, RMSD matrix, RDF, MSD/diffusion and VDOS.'
}
// The 3D view (sub-tab "view3d") is the first page of the MONET custom functionalities.
const lastSubtab = { ase: 'structure', mda: 'topology', custom: 'view3d' }
let activeGroup = 'custom'

function showGroup (group, subtab) {
  activeGroup = group
  $$('.vtab').forEach(b => b.classList.toggle('active', b.dataset.vtab === group))
  $$('.ase-stab').forEach(b => b.classList.toggle('group-hidden', b.dataset.group !== group))
  $('module-intro').textContent = ANALYSIS_GROUPS[group]
  const id = subtab || lastSubtab[group]
  if (!document.querySelector('.ase-stab.active')?.matches(`[data-stab="${id}"]`)) selectSubtab(id)
}

function showViewerTab (id) {
  if (id === 'custom' && lastSubtab.custom === 'view3d') id = 'view3d'
  const group = ANALYSIS_GROUPS[id] ? id : null
  if (id === 'view3d') lastSubtab.custom = 'view3d'
  $$('.vtab').forEach(b => b.classList.toggle('active', b.dataset.vtab === (group || 'custom')))
  $$('.vtab-content').forEach(c => c.classList.remove('active'))
  $(`vtab-content-${group ? 'ase' : id}`).classList.add('active')
  // Analysis modules get the full width; the 3D view is used with the workflow steps.
  setSidebarCollapsed(Boolean(group))
  if (group) showGroup(group)
  if (id === 'view3d') resizeCanvas()
  else redrawVisibleChart()
}

function continueToExtraction () {
  goTo(2)
  showViewerTab('view3d')
  setStatus('Choose the sampling frequency, then the atoms to extract.')
}

// =============================================================================
// ── Viewer setup ─────────────────────────────────────────────────────────────
// =============================================================================

const canvas = $('mol-canvas')
const viewer = new MolecularViewer(canvas)
viewer.style = (() => { try { return localStorage.getItem('monet-view-style') || 'ball-stick' } catch { return 'ball-stick' } })()

let viewerNeedsFit = false
function resizeCanvas () {
  canvas.width  = canvas.clientWidth
  canvas.height = canvas.clientHeight
  if (viewerNeedsFit && canvas.width && canvas.height) { viewerNeedsFit = false; viewer.fitView() }
  else viewer.render()
}

window.addEventListener('resize', resizeCanvas)

viewer.onSelectionChange = ids => {
  state.selectedAtoms = new Set(ids)
  // sync with table + input
  syncSelectionUI()
}

function syncSelectionUI () {
  const ids = [...state.selectedAtoms]
  $('sel-count').textContent = ids.length
  $('inp-atom-ids').value    = ids.sort((a,b) => a-b).join(' ')
  viewer.setSelected(ids)
  // update table checkboxes
  $$('#atom-table-body tr').forEach(row => {
    const id  = parseInt(row.dataset.atomId, 10)
    const chk = row.querySelector('.row-chk')
    if (chk) chk.checked = state.selectedAtoms.has(id)
    row.classList.toggle('row-selected', state.selectedAtoms.has(id))
  })
  $('next-3').disabled = ids.length === 0
}

// =============================================================================
// ── Step 1 — File Input ──────────────────────────────────────────────────────
// =============================================================================

function clearTrajectory () {
  state.fullTrajectory = null
  state.derivedLabel = null
  state.frameMap = null
  $('restore-full-trajectory')?.classList.add('hidden')
  state.fileInfo = null
  state.firstFrame = null
  state.firstLattice = null
  state.selectedAtoms.clear()
  state.lastResult = null
  // A custom cell of the QM cards belongs to the trajectory it was typed for.
  qmPanel.resetCells()
  updateAnalysisSource()
  if (typeof charts !== 'undefined') Object.values(charts).forEach(chart => chart.clear())
  $('next-2').disabled = true
  for (const id of ['next-analysis', 'open-analysis', 'ase-continue']) $(id).disabled = true
  $('stat-format').textContent = '—'
  $('stat-configs').textContent = '—'
  $('stat-atoms').textContent = '—'
  $('sampled-count').textContent = '—'
  $('viewer-title').textContent = '3D Molecular Viewer'
  $('viewer-overlay').classList.remove('hidden')
  viewer.loadAtoms([])
  $('atom-table-body').innerHTML = ''
  syncSelectionUI()
}

const FORMAT_HINTS = {
  auto: 'XYZ/extXYZ files are read directly; other files are recognised by name and content and imported.',
  xyz: 'Read directly. Add a CIF/POSCAR/PDB cell file for one fixed cell, or a CP2K .cell file for a per-step lattice (NPT runs).',
  'qe-cp-pos': 'cp.x positions in bohr. Needs a reference structure with the same atom order; add the .cel file for the cell.',
  'cp2k-dcd': 'DCD has no element names: add a reference structure (e.g. the first frame as XYZ); without it every atom is imported as X.',
  'cpmd-trajectory': 'CPMD TRAJECTORY (bohr). Needs a reference structure with the same atom order; restart markers are skipped.',
  qbox: 'Reads every MD iteration (<atomset>) from the Qbox output.',
  'espresso-out': 'Reads every ionic step of a pw.x relax/MD output.',
  'orca-output': 'Reads the geometries printed in the ORCA output. ORCA MD trajectories (.xyz) are read directly as XYZ.'
}
const REFERENCE_FORMATS = new Set(['qe-cp-pos', 'cp2k-dcd', 'cpmd-trajectory', 'mda-xtc', 'mda-trr', 'mda-dcd', 'mda-netcdf', 'mda-auto'])
Object.assign(FORMAT_HINTS, {
  'mda-xtc': 'Read with MDAnalysis. XTC stores only coordinates: add the topology (GRO, PDB, TPR …) to keep elements, residue and atom names. Without it, atoms are imported as X (geometry only).',
  'mda-trr': 'Read with MDAnalysis; add the topology (GRO, PDB, TPR …), otherwise atoms are imported as X.',
  'mda-dcd': 'CHARMM/NAMD DCD read with MDAnalysis; add the topology (PSF, PDB …), otherwise atoms are imported as X. CP2K DCD files are detected automatically.',
  'mda-netcdf': 'AMBER NetCDF read with MDAnalysis; add the topology (PRMTOP, PDB …), otherwise atoms are imported as X.',
  'mda-auto': 'MDAnalysis chooses the reader from the file extension; add a topology when the format has no atom names.'
})
const CELL_FORMATS = new Set(['auto', 'xyz', 'qe-cp-pos', 'cpmd-trajectory'])

function updateFormatUI () {
  const format = $('inp-format').value
  state.source.format = format
  $('aux-reference').classList.toggle('hidden', !REFERENCE_FORMATS.has(format) && !state.source.reference)
  $('aux-cell').classList.toggle('hidden', !CELL_FORMATS.has(format) && !state.source.cellFile)
  $('btn-reference-clear').disabled = !state.source.reference
  $('btn-cell-file-clear').disabled = !state.source.cellFile
  $('inp-cell-vectors').classList.toggle('hidden', format !== 'qe-cp-pos')
  const canImport = Boolean(window.monet.canImport)
  $('format-hint').textContent = (FORMAT_HINTS[format] || (format.startsWith('mda-') ? 'Read with MDAnalysis and imported into extended XYZ.' : 'Imported with ASE into extended XYZ.')) +
    (canImport ? '' : ' Only XYZ is available in this mode: run python3 start_monet.py to import other formats.')
}
$('inp-format').addEventListener('change', updateFormatUI)

function needsImport () {
  const { original, format, cellFile } = state.source
  if (cellFile) return true
  if (format === 'xyz') return false
  return format !== 'auto' || !/\.(xyz|extxyz)$/i.test(original || '')
}

for (const [kind, button, clear, label] of [['reference', 'btn-reference', 'btn-reference-clear', 'reference-path'], ['cellFile', 'btn-cell-file', 'btn-cell-file-clear', 'cell-file-path']]) {
  $(button).addEventListener('click', async () => {
    try {
      const fp = await window.monet.selectFile()
      if (!fp) return
      state.source[kind] = fp
      $(label).textContent = fp
      updateFormatUI()
    } catch (error) { setStatus('Could not open file: ' + error.message) }
  })
  $(clear).addEventListener('click', () => {
    if (state.source[kind]) window.monet.releaseFile?.(state.source[kind])
    state.source[kind] = null
    $(label).textContent = 'Not selected'
    updateFormatUI()
    setStatus(`${kind === 'reference' ? 'Reference structure' : 'Cell file'} removed.`)
  })
}

function releaseTrajectory () {
  for (const name of new Set([state.source.original, state.filePath])) {
    if (name && name !== aseState.convInput) window.monet.releaseFile?.(name)
  }
}

$('btn-browse').addEventListener('click', async () => {
  setStatus('Selecting file …')
  try {
    const fp = await window.monet.selectFile()
    if (!fp) { setStatus('Ready'); return }
    releaseTrajectory()
    clearTrajectory()
    state.source.original = fp
    state.source.label = null
    state.filePath = fp
    $('file-path-text').textContent = fp
    $('file-display').classList.remove('hidden')
    $('next-1').disabled = false
    setStatus('File selected: ' + fp.split(/[\\/]/).pop())
  } catch (error) {
    setStatus('Could not open file: ' + error.message)
  }
})

$('btn-file-clear').addEventListener('click', () => {
  releaseTrajectory()
  clearTrajectory()
  state.source.original = null
  state.source.label = null
  state.filePath = null
  $('file-path-text').textContent = ''
  $('file-display').classList.add('hidden')
  $('next-1').disabled = true
  goTo(1)
  showViewerTab('view3d')
  setStatus('Trajectory removed. Select another file.')
})

$('next-1').addEventListener('click', async () => {
  goTo('analysis')
  $('back-analysis').disabled = true
  $('next-analysis').disabled = true
  $('open-analysis').disabled = true
  $('next-2').disabled = true
  setStatus('Analysing trajectory …')
  try {
    if (state.filePath !== state.source.original) {
      window.monet.releaseFile?.(state.filePath)
      state.filePath = state.source.original
    }
    // Re-analysing the original file drops any derived trajectory (uncorrelated, cropped, aligned):
    // its time stride, sampling frequency and frame numbering no longer apply.
    const full = state.fullTrajectory
    if (full) {
      setTimeStride(full.mdStride)
      $('inp-freq').value = full.frequency
    }
    state.fullTrajectory = null
    state.derivedLabel = null
    state.frameMap = null
    $('restore-full-trajectory').classList.add('hidden')
    state.source.label = null
    if (needsImport()) {
      if (!window.monet.importFile) throw new Error('Importing this format needs the launcher (python3 start_monet.py) or the desktop app.')
      setStatus('Importing trajectory with ASE …')
      const imported = await window.monet.importFile(state.source.original, {
        format: state.source.format, reference: state.source.reference, cellFile: state.source.cellFile,
        cellVectors: $('inp-cell-vectors').value
      })
      if (imported.error) throw new Error(imported.error)
      state.filePath = imported.filePath
      state.source.label = imported.sourceLabel
      state.source.warning = imported.warning || null
    } else {
      state.source.warning = null
    }
    const info = await window.monet.analyzeFile(state.filePath)
    if (info.error) throw new Error(info.error)
    state.fileInfo = info
    await historyLoad(info)
    $('stat-format').textContent = state.source.label ? `${state.source.label} → extXYZ` : info.format
    $('stat-configs').textContent = info.configCount.toLocaleString()
    $('stat-atoms').textContent = info.atomCount.toLocaleString()
    updateSampledCount()
    await loadFrameForViewer(0)
    updateSampledCount()
    updateAnalysisSource()
    $('sampling-source').textContent = `Sampling ${info.configCount.toLocaleString()} configurations of ${state.filePath.split(/[\\/]/).pop()}.`
    for (const id of ['next-analysis', 'open-analysis', 'ase-continue']) $(id).disabled = false
    showViewerTab('ase')
    setStatus(state.source.warning ? `Trajectory loaded. ${state.source.warning}` : 'Trajectory loaded. Analyse it in the ASE module, then continue to the extraction.')
  } catch (error) {
    clearTrajectory()
    setStatus('Error: ' + error.message)
  } finally {
    $('back-analysis').disabled = false
  }
})

// Make another trajectory file (e.g. the uncorrelated configurations) the one MONET analyses and extracts.
async function activateTrajectory (path, { label, strideFactor = 1, start = 0, frames = null } = {}) {
  if (typeof playerStop === 'function') playerStop()
  const info = await window.monet.analyzeFile(path)
  if (info.error) throw new Error(info.error)
  if (!state.fullTrajectory) {
    state.fullTrajectory = {
      filePath: state.filePath, fileInfo: state.fileInfo, label: state.source.label,
      lastResult: state.lastResult, mdStride: $('md-stride').value, frequency: $('inp-freq').value
    }
  }
  // Frame k of the new file is frame offset + k·step of the full trajectory, or frames[k] when the
  // new file holds picked frames (e.g. a PCA selection) that are not evenly spaced.
  const base = state.frameMap || { offset: 0, step: 1 }
  if (frames) state.frameMap = { frames: frames.map(fullFrame) }
  else if (base.frames) state.frameMap = { frames: Array.from({ length: info.configCount }, (_, k) => fullFrame(start + k * strideFactor)) }
  else state.frameMap = { offset: base.offset + start * base.step, step: base.step * strideFactor }
  state.lastResult = null
  carryCell(state.filePath, path)
  state.filePath = path
  state.fileInfo = info
  state.derivedLabel = label
  await historyDerived(path, info, label)
  // One saved frame of the new file spans `strideFactor` frames of the file that was active just
  // before this call. md-stride always holds the value of the ACTIVE file, not the full trajectory's,
  // so it must be the base here: deriving from an already-derived file (e.g. cropping the
  // equilibration transient out of an uncorrelated trajectory) would otherwise drop the stride
  // already applied by the earlier crop and desynchronise the time axis from the frames.
  const stride = Number($('md-stride').value) || 1
  setTimeStride(stride * strideFactor)
  $('inp-freq').value = 1
  await showActiveTrajectory()
  $('restore-full-trajectory').classList.remove('hidden')
}

// A derived trajectory comes from the same simulation: the applied cell (typed or read from a cell
// file) follows it there and back, instead of being dropped as for a newly loaded file.
function carryCell (from, to) {
  if (aseState.cellParameters && aseState.cellSource === from) aseState.cellSource = to
}

// Frame number of the full trajectory for a saved frame of the active (possibly derived) file.
function fullFrame (frame) {
  const map = state.frameMap
  if (!map) return frame
  return map.frames ? map.frames[frame] : map.offset + frame * map.step
}

function setTimeStride (value) {
  const field = $('md-stride')
  field.value = value
  field.dispatchEvent(new Event('input'))
}

async function showActiveTrajectory () {
  const info = state.fileInfo
  $('stat-format').textContent = state.derivedLabel || (state.source.label ? `${state.source.label} → extXYZ` : info.format)
  $('stat-configs').textContent = info.configCount.toLocaleString()
  $('stat-atoms').textContent = info.atomCount.toLocaleString()
  updateSampledCount()
  await loadFrameForViewer(0)
  updateAnalysisSource()
  $('sampling-source').textContent = `Sampling ${info.configCount.toLocaleString()} configurations of ${state.filePath.split(/[\\/]/).pop()}${state.derivedLabel ? ` (${state.derivedLabel})` : ''}.`
}

$('restore-full-trajectory').addEventListener('click', async () => {
  const full = state.fullTrajectory
  if (!full) return
  state.fullTrajectory = null
  state.derivedLabel = null
  state.frameMap = null
  carryCell(state.filePath, full.filePath)
  state.filePath = full.filePath
  state.fileInfo = full.fileInfo
  monetHistory.activeSource = monetHistory.sourceByPath.get(full.filePath) ?? monetHistory.activeSource
  state.lastResult = full.lastResult
  setTimeStride(full.mdStride)
  $('inp-freq').value = full.frequency
  $('restore-full-trajectory').classList.add('hidden')
  try {
    await showActiveTrajectory()
    setStatus('Back to the full trajectory.')
  } catch (error) { setStatus('Could not reload the full trajectory: ' + error.message) }
})

$('back-analysis').addEventListener('click', () => { goTo(1); showViewerTab('view3d') })
$('open-analysis').addEventListener('click', () => showViewerTab('ase'))
for (const id of ['next-analysis', 'rail-continue', 'ase-continue']) $(id).addEventListener('click', continueToExtraction)
$('use-ase-selection').addEventListener('click', () => {
  if (!aseState.pickedIds.length) return
  state.selectedAtoms = new Set(aseState.pickedIds)
  syncSelectionUI()
  setStatus(`${aseState.pickedIds.length} atoms from the ASE analysis selected for extraction.`)
})

// =============================================================================
// ── Step 2 — Sampling ────────────────────────────────────────────────────────
// =============================================================================

$('inp-freq').addEventListener('input', updateSampledCount)

function updateSampledCount () {
  const freq = Number($('inp-freq').value)
  const valid = Number.isInteger(freq) && freq > 0
  $('next-2').disabled = !valid || !state.fileInfo
  if (!valid) { $('sampled-count').textContent = '—'; return }
  state.frequency = freq
  if (!state.fileInfo) return
  const n = Math.floor((state.fileInfo.configCount - 1) / freq) + 1
  $('sampled-count').textContent = n.toLocaleString()
}

$('back-2').addEventListener('click', () => { goTo('analysis'); showViewerTab('ase') })

$('next-2').addEventListener('click', () => {
  const frequency = Number($('inp-freq').value)
  if (!Number.isInteger(frequency) || frequency < 1) return setStatus('Sampling frequency must be a positive integer.')
  state.frequency = frequency
  goTo(3)
})

// =============================================================================
// ── Load first frame into viewer & table ─────────────────────────────────────
// =============================================================================

async function loadFrameForViewer (frameIdx) {
  if (!state.filePath || !state.fileInfo) return
  setStatus('Loading frame …')

  const result = await window.monet.readFrame(
    state.filePath, frameIdx, state.fileInfo.atomCount
  )
  if (result.error) throw new Error(result.error)
  $('viewer-overlay').classList.add('hidden')

  state.firstFrame = result.atoms
  // The lattice of frame 0 (extended XYZ Lattice="…", also written by the importer for CIF/cell files) is the
  // structure cell of the QM cards, available at once without waiting for the player's frame requests.
  if (frameIdx === 0) state.firstLattice = usableLattice(result.lattice)
  viewer.loadAtoms(result.atoms)
  viewerNeedsFit = true
  buildAtomTable(result.atoms)
  resizeCanvas()
  setStatus(`Frame ${frameIdx} loaded · ${result.atoms.length} atoms`)
  $('viewer-title').textContent = `Frame ${frameIdx} — ${result.atoms.length} atoms`
}

function buildAtomTable (atoms) {
  const tbody = $('atom-table-body')
  tbody.innerHTML = ''
  for (const a of atoms) {
    const tr = document.createElement('tr')
    tr.dataset.atomId = a.index
    tr.classList.toggle('row-selected', state.selectedAtoms.has(a.index))
    tr.innerHTML = `
      <td class="td-id">${a.index}</td>
      <td class="td-el"><span class="el-badge" style="background:${atomColor(a.element)}">${a.element}</span></td>
      <td>${a.x.toFixed(3)}</td>
      <td>${a.y.toFixed(3)}</td>
      <td>${a.z.toFixed(3)}</td>
      <td><input type="checkbox" class="row-chk" ${state.selectedAtoms.has(a.index) ? 'checked' : ''} /></td>
    `
    tr.querySelector('.row-chk').addEventListener('change', evt => {
      if (evt.target.checked) state.selectedAtoms.add(a.index)
      else                    state.selectedAtoms.delete(a.index)
      syncSelectionUI()
    })
    tr.addEventListener('click', evt => {
      if (evt.target.type === 'checkbox') return
      if (state.selectedAtoms.has(a.index)) state.selectedAtoms.delete(a.index)
      else                                  state.selectedAtoms.add(a.index)
      syncSelectionUI()
    })
    tbody.appendChild(tr)
  }
}

const atomColor = MonetViewer.atomColor

// =============================================================================
// ── Step 3 — Atom Selection ──────────────────────────────────────────────────
// =============================================================================

$('btn-apply-ids').addEventListener('click', () => {
  const raw = $('inp-atom-ids').value.trim()
  const ids = raw.split(/[\s,]+/).map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= (state.fileInfo?.atomCount || 0))
  state.selectedAtoms = new Set(ids)
  syncSelectionUI()
})

$('btn-clear-sel').addEventListener('click', () => {
  state.selectedAtoms.clear()
  syncSelectionUI()
})

$('back-3').addEventListener('click', () => goTo(2))

$('next-3').addEventListener('click', () => goTo(4))

// =============================================================================
// ── Step 4 — Options ─────────────────────────────────────────────────────────
// =============================================================================

$('opt-average').addEventListener('change',  e => { state.opts.computeAverage   = e.target.checked })

// Quantum-chemistry inputs: shared electronic states + one card per code (qm-panel.js) → per-code spec (qm-resolve.js).
// Template edits are kept per session; previews render configuration 1 of the current selection.
const qmCodes = () => [...$$('[data-qm-code]')].filter(input => input.checked).map(input => input.dataset.qmCode)
const qmCustom = {} // code → { file name pattern → edited template }
const qmPanel = MonetQMPanel.mount($('qm-cards'), { onChange: () => updateQmUI() })
let qmSymbolsKey = null // species tables are rebuilt only when the selected elements change

function qmAtoms () { return state.firstFrame ? MonetASEModel.atomMap(state.firstFrame, [...state.selectedAtoms]) : [] }
function qmSymbols () { return qmAtoms().map(atom => atom.element) }
function qmExtent () {
  const atoms = qmAtoms()
  if (!atoms.length) return null
  return ['x', 'y', 'z'].map(k => Math.max(...atoms.map(a => a[k])) - Math.min(...atoms.map(a => a[k])))
}
// A 3×3 lattice (Å rows) with a non-zero volume, or null (absent, all zeros, malformed).
function usableLattice (rows) {
  if (!Array.isArray(rows) || rows.length !== 3 || !rows.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))) return null
  try { MonetUnits.cellParameters(rows); return rows.map(row => [...row]) } catch { return null }
}
// Structure cell for the plane-wave cards: the applied crystal cell, else the lattice of frame 0.
function qmCellInfo () {
  if (aseState.cellParameters) {
    const label = aseState.cellSourceName ? `Cell from ${aseState.cellSourceName}` : 'Crystal cell applied'
    return { source: 'applied', rows: MonetASEModel.cellVectors(aseState.cellParameters), label, detail: aseState.cellParameters.join(', ') }
  }
  const lattice = usableLattice(player.cells && player.cells.get(0)) || state.firstLattice
  if (!lattice) return null
  const label = state.source.cellFile ? `Lattice from the trajectory (cell file ${fileName(state.source.cellFile)})` : 'Lattice from the trajectory'
  return { source: 'trajectory', rows: lattice, label }
}
function qmCellStatus (s, cell) {
  if (s.isolated) return { text: `Vacuum box (isolated), ${s.padding} Å`, blocked: false }
  if (s.cellSource === 'custom') {
    if (!s.cellCustom) return { text: '✖ Invalid custom cell', blocked: true }
    const len = v => Number(v.toFixed(4))
    return { text: `Custom cell ${s.cellCustom.slice(0, 3).map(len).join('×')} Å (${s.cellCustom.slice(3).map(v => Number(v.toFixed(2))).join('/')}°)`, blocked: false }
  }
  if (!cell) return { text: '✖ No cell', blocked: true }
  return { text: cell.detail ? `${cell.label} (${cell.detail})` : cell.label, blocked: false }
}
function qmPotcarAvailable () { return Boolean(aseState.available || window.monet.desktop) }
function qmCommon () {
  return { charge: Number($('qm-charge').value), multiplicities: $('qm-mults').value.trim().split(/[\s,]+/).filter(Boolean).map(Number) }
}
function buildQmSpec () {
  const codes = qmCodes()
  if (!codes.length) return null
  // structureRows: a custom cell keeps the orientation of the structure lattice the cards show.
  const structure = qmCellInfo()
  const spec = { ...MonetQMResolve.buildSpec({ codes, common: qmCommon(), cards: qmPanel.read(), symbols: qmSymbols(), cell: aseState.cellParameters ? MonetASEModel.cellVectors(aseState.cellParameters) : null, custom: qmCustom, structureRows: structure ? structure.rows : null }), masses: MonetQM.MASSES }
  return MonetQM.validate(spec)
}
function qmReadiness () {
  return MonetQMResolve.readiness(qmCodes(), qmPanel.read(), { cell: qmCellInfo(), extent: qmExtent(), symbols: qmSymbols(), potcarAvailable: qmPotcarAvailable(), common: qmCommon() })
}

function updateQmUI () {
  const codes = qmCodes()
  state.opts.generateGaussian = codes.includes('gaussian')
  $('gaussian-details').classList.toggle('disabled', !codes.length)
  qmPanel.show(codes)
  const symbols = qmSymbols()
  const symbolsKey = [...new Set(symbols)].join(' ')
  if (symbolsKey !== qmSymbolsKey) { qmSymbolsKey = symbolsKey; qmPanel.setSymbols(symbols) }
  qmPanel.setPotcarAvailable(qmPotcarAvailable())
  const cell = qmCellInfo()
  qmPanel.setStructureCell(cell ? { label: cell.label, rows: cell.rows } : null)
  const cards = qmPanel.read()
  for (const code of codes.filter(c => MonetQMResolve.PLANE_WAVE.includes(c))) {
    const status = qmCellStatus(cards[code], cell)
    qmPanel.setCellStatus(code, status.text, status.blocked)
  }
  let spec = null
  const messages = []
  const ready = qmReadiness()
  try { spec = buildQmSpec() } catch (error) { messages.push(error.message) }
  messages.push(...ready.blocked, ...ready.warnings.map(w => `⚠ ${w}`))
  const blocked = Boolean(codes.length) && (ready.blocked.length > 0 || !spec)
  $('qm-status').textContent = messages.length ? messages.join(' ') : codes.length ? `Inputs for: ${codes.map(code => MonetQMResolve.LABELS[code]).join(', ')}.` : 'No quantum-chemistry inputs will be written.'
  $('qm-define-cell').classList.toggle('hidden', !ready.blocked.some(m => / no cell\./.test(m)))
  $('next-4').disabled = !state.outputDir || blocked
  // Card titles mark custom templates; previews render configuration 1.
  const atoms = qmAtoms()
  for (const code of codes) {
    const summary = $(`qm-card-${code}`).querySelector('summary')
    const edited = spec ? spec.codes[code].files.map(file => file.name).filter(name => qmCustom[code] && Object.prototype.hasOwnProperty.call(qmCustom[code], name)) : Object.keys(qmCustom[code] || {})
    summary.textContent = MonetQMResolve.LABELS[code] + (edited.length ? ` · custom template (${edited.join(', ')})` : '')
    qmPanel.setCustomNote(code, edited.length > 0)
    let preview = ''
    const card = cards[code]
    // An invalid custom cell blocks the code: never preview it with the structure cell instead.
    if (card && MonetQMResolve.PLANE_WAVE.includes(code) && !card.isolated && card.cellSource === 'custom' && !card.cellCustom) preview = 'Enter a valid custom cell to preview this code.'
    else if (spec && atoms.length) {
      try {
        const conf = { index: 1, frame: 0, symbols: atoms.map(a => a.element), positions: atoms.map(a => [a.x, a.y, a.z]), lattice: cell && cell.source === 'trajectory' ? cell.rows : undefined }
        const files = MonetQM.render({ ...spec, codes: { [code]: spec.codes[code] } }, conf)
        preview = files.map(file => `── ${file.path}\n${file.text}`).join('\n')
      } catch (error) { preview = error.message }
    } else if (!atoms.length) preview = 'Select atoms to preview configuration 1.'
    qmPanel.setPreview(code, preview)
  }
  // Template selector lists the resolved files of every selected code.
  const select = $('qm-template-file'), previous = selectedTemplate()
  select.replaceChildren()
  if (spec) {
    for (const code of codes) {
      spec.codes[code].files.forEach((file, i) => {
        const option = document.createElement('option')
        option.value = `${code}:${i}`
        option.dataset.name = file.name
        option.textContent = `${MonetQMResolve.LABELS[code]} — ${file.name}`
        select.appendChild(option)
      })
    }
  }
  // Keep the same file selected (by name) when a calculation change shifts the file list.
  const same = previous && [...select.options].find(option => option.value.startsWith(`${previous.code}:`) && option.dataset.name === previous.name)
  if (same) select.value = same.value
  showTemplate(spec)
}

// The selector value is `${code}:${index}`; edits are stored by the file's name pattern so they follow their file.
function selectedTemplate () {
  const [code, index] = ($('qm-template-file').value || '').split(':')
  if (!code) return null
  const option = $('qm-template-file').selectedOptions[0]
  return { code, index: Number(index), name: option ? option.dataset.name : '' }
}
function showTemplate (spec = null) {
  const target = selectedTemplate()
  let text = ''
  if (target) {
    const custom = qmCustom[target.code] && qmCustom[target.code][target.name]
    if (custom !== undefined) text = custom
    else {
      try { text = (spec || buildQmSpec()).codes[target.code].files[target.index].template } catch { text = '' }
    }
  }
  $('qm-template-text').value = text
  $('qm-template-text').disabled = !target
}
$$('[data-qm-code]').forEach(input => input.addEventListener('change', updateQmUI))
for (const id of ['qm-charge', 'qm-mults']) $(id).addEventListener('input', updateQmUI)
$('qm-template-file').addEventListener('change', () => showTemplate())
$('qm-template-text').addEventListener('input', () => {
  const target = selectedTemplate()
  if (!target) return
  ;(qmCustom[target.code] ||= {})[target.name] = $('qm-template-text').value
  updateQmUI()
})
$('qm-template-reset').addEventListener('click', () => {
  const target = selectedTemplate()
  if (!target || !qmCustom[target.code]) return
  delete qmCustom[target.code][target.name]
  updateQmUI()
})
$('qm-define-cell').addEventListener('click', () => {
  // Structure analysis › Cell lives in the ASE workspace (the panel holding #cell-apply). The workflow stays on
  // Options: the workspace folds the workflow panel away and ⇥ brings it back with the cards updated.
  showViewerTab('ase')
  const panel = $('cell-apply').closest('details')
  if (panel) panel.open = true
  if ($('cell-apply').scrollIntoView) $('cell-apply').scrollIntoView({ block: 'center' })
  setStatus('Apply a crystal cell, then reopen the workflow panel (⇥) to return to Options.')
})

$('btn-output-dir').addEventListener('click', async () => {
  const dir = await window.monet.selectOutputDir()
  if (!dir) return
  state.outputDir = dir
  $('output-dir-text').textContent = dir
  updateQmUI()
})

$('back-4').addEventListener('click', () => goTo(3))

$('next-4').addEventListener('click', () => {
  const ready = qmReadiness()
  if (ready.blocked.length) {
    $('qm-status').textContent = ready.blocked.join(' ')
    return setStatus(ready.blocked[0])
  }
  try { state.opts.qm = buildQmSpec() } catch (error) {
    $('qm-status').textContent = error.message
    return setStatus(error.message)
  }
  goTo(5)
  runProcessing().catch(error => {
    log('ERROR: ' + error.message, 'error')
    setStatus('Processing failed: ' + error.message)
    $('retry-processing').classList.remove('hidden')
  })
})

// =============================================================================
// ── Step 5 — Processing ──────────────────────────────────────────────────────
// =============================================================================

const PROGRESS_STEPS = {
  extraction: 0.40,
  folders:    0.30,
  average:    0.20,
  gaussian:   0.10
}

let progressAccum = 0

window.monet.onProgress(data => {
  log(data.message, data.status === 'done' ? 'success' : 'info')
  setStatus(data.message)

  if (data.step === 'extraction' && Number.isFinite(data.percent)) {
    setProgress(Math.min(data.percent * PROGRESS_STEPS.extraction / .4, 95))
  } else if (data.status === 'done' && PROGRESS_STEPS[data.step]) {
    progressAccum += PROGRESS_STEPS[data.step] * 100
    setProgress(Math.min(progressAccum, 95))
  }
})

function setProgress (pct) {
  $('prog-fill').style.width  = pct + '%'
  $('prog-label').textContent = Math.round(pct) + '%'
}

async function runProcessing () {
  progressAccum = 0
  setProgress(0)
  $('log-box').innerHTML = ''
  $('next-5').classList.add('hidden')
  $('download-results').classList.add('hidden')
  $('retry-processing').classList.add('hidden')

  log(`Starting MONET processing …`, 'info')
  log(`File     : ${state.filePath}`)
  log(`Atoms    : ${[...state.selectedAtoms].sort((a,b)=>a-b).join(', ')}`)
  log(`Frequency: every ${state.frequency} frames`)
  log(`QM inputs: ${state.opts.qm ? Object.keys(state.opts.qm.codes).join(', ') : 'none'}`)
  log(`Output   : ${state.outputDir}`)
  log('')

  const processedIds = [...state.selectedAtoms]
  const sourceAtoms = MonetASEModel.atomMap(state.firstFrame, processedIds)
  $('cancel-processing').classList.remove('hidden')
  $('cancel-processing').disabled = !window.monet.cancel
  const extractSession = monetHistory.session
  const extractStep = monetHistory.readOnly ? null : historyDo(P => P.begin({
    kind: 'extract', action: 'extract', source: monetHistory.sourceByPath.get(state.filePath) ?? monetHistory.activeSource,
    params: { selected: processedIds, frequency: state.frequency, compute_average: Boolean(state.opts.computeAverage), ...(state.opts.qm ? { qm: state.opts.qm } : {}) },
    atoms: processedIds
  }))
  const result = await window.monet.processTrajectory({
    filePath:         state.filePath,
    outputDir:        state.outputDir,
    atomCount:        state.fileInfo.atomCount,
    configCount:      state.fileInfo.configCount,
    selectedAtoms:    processedIds,
    frequency:        state.frequency,
    computeAverage:   state.opts.computeAverage,
    generateGaussian: false,
    ...(state.opts.qm ? { qm: state.opts.qm } : {})
  })
  $('cancel-processing').classList.add('hidden')

  if (result.error) {
    if (extractStep != null && extractSession === monetHistory.session) historyDo(P => P.fail(extractStep, result.error))
    onHistoryChange()
    log('ERROR: ' + result.error, 'error')
    setStatus('Processing failed: ' + result.error)
    $('retry-processing').classList.remove('hidden')
    return
  }

  setProgress(100)
  log(`Done! ${result.totalFrames} frames processed · ${result.sampledFrames} sampled.`, 'success')
  setStatus('Processing complete!')

  if (result.downloadURL) {
    $('download-results').href = result.downloadURL
    $('download-results').classList.remove('hidden')
    setStatus('Processing complete. Click Download results ZIP to save the files.')
  }
  result.sourceAtoms = sourceAtoms
  state.lastResult = result
  if (extractStep != null) await historyExtracted(extractStep, extractSession, result, sourceAtoms)
  updateAnalysisSource()
  $('next-5').classList.remove('hidden')
}

$('retry-processing').addEventListener('click', () => goTo(4))
$('cancel-processing').addEventListener('click', async () => {
  $('cancel-processing').disabled = true
  log('Cancelling …')
  await window.monet.cancel?.('extraction')
})

$('next-5').addEventListener('click', () => {
  buildResultsView(state.lastResult)
  goTo(6)
})

// =============================================================================
// ── Step 6 — Results ─────────────────────────────────────────────────────────
// =============================================================================

function qmSummary () {
  const spec = state.opts.qm
  if (!spec) return ''
  return ', ' + Object.keys(spec.codes).map(code => {
    const folder = MonetQM.CODES[code].folder
    const names = spec.codes[code].files.map(file => /\{(tag|mult|state|chk)\}/.test(file.name)
      ? (spec.codes[code].override || spec.common).multiplicities.map(m => file.name.replace('{tag}', MonetQM.stateOf(m).tag)).join(', ') : file.name)
    if (code === 'vasp' && spec.codes.vasp.potcar) names.push('POTCAR')
    return folder ? `${folder}/ (${names.join(', ')})` : names.join(', ')
  }).join('; ')
}

function buildResultsView (result) {
  $('result-summary').innerHTML = `
    <div class="result-stat"><span>Total frames</span><strong>${result.totalFrames.toLocaleString()}</strong></div>
    <div class="result-stat"><span>Sampled confs</span><strong>${result.sampledFrames.toLocaleString()}</strong></div>
    <div class="result-stat"><span>Selected atoms</span><strong>${state.selectedAtoms.size}</strong></div>
  `

  const tree = [
    { icon: '📁', label: '0-HISTORY/',         sub: ['run.json'] },
    { icon: '📁', label: '1-FULL_TRAJECTORY_EXTRACTED/', sub: ['FULL_TRAJECTORY_EXTRACTED.xyz'] },
    { icon: '📁', label: '2-SAMPLED_CONFIGURATIONS/',
      sub: [
        'SAMPLED_CONFIGURATIONS.xyz',
        `conf1/ … conf${result.sampledFrames}/ (pos*.txt${qmSummary()})`
      ]
    },
    ...(state.opts.computeAverage
      ? [{ icon: '📁', label: '3-AVERAGE_STRUCTURE/', sub: ['GEO-AVERAGE.xyz'] }]
      : [])
  ]

  $('result-tree').innerHTML = tree.map(node => `
    <div class="tree-node">
      <div class="tree-dir">${node.icon} <code>${result.outputDir}/${node.label}</code></div>
      ${node.sub.map(s => `<div class="tree-file">└─ ${s}</div>`).join('')}
    </div>
  `).join('')
}

$('back-6').addEventListener('click', () => {
  // Reset for a new run
  state.filePath      = null
  state.fileInfo      = null
  state.frequency     = 10
  state.firstFrame    = null
  state.selectedAtoms = new Set()
  state.outputDir     = window.monet.isBrowser ? 'MONET-results' : null
  releaseTrajectory()
  state.source.original = null
  state.source.label = null
  clearTrajectory()
  updateQmUI()
  $('output-dir-text').textContent = window.monet.isBrowser ? 'Download results as a ZIP file' : 'Not selected'

  $('file-display').classList.add('hidden')
  $('next-1').disabled = true
  $('inp-freq').value  = 10
  $('viewer-overlay').classList.remove('hidden')
  viewer.loadAtoms([])
  $('atom-table-body').innerHTML = ''
  $('log-box').innerHTML         = ''

  goTo(1)
  setStatus('Ready')
})

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

// ASE sub-tab switching
function selectSubtab (id) {
  const btn = document.querySelector(`.ase-stab[data-stab="${id}"]`)
  $$('.ase-stab').forEach(b => b.classList.remove('active'))
  $$('.ase-subpanel').forEach(p => p.classList.remove('active'))
  btn.classList.add('active')
  $(`ase-sub-${id}`).classList.add('active')
  lastSubtab[btn.dataset.group] = id
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
  btn.dataset.stab = source.dataset.stab
  btn.textContent = source.textContent
  btn.hidden = source.classList.contains('registry-empty')
  btn.addEventListener('click', () => source.click())
  $('monet-subtabbar').appendChild(btn)
})
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
    for (const id of [`${kind}-download`, `${kind}-activate`]) $(id).classList.add('hidden')
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

// =============================================================================
// ── ASE: RMSD ────────────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-rmsd').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Load an XYZ file and click Next first.')

  const step = Number($('rmsd-step').value)
  let indices
  try { indices = MonetASEModel.selectedIndices($('rmsd-atoms').value, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const reference = $('rmsd-reference').value.trim()
  const r = await runAse('rmsd', {
    action: 'rmsd', filename: traj, frame_step: step, indices,
    align: $('rmsd-align').checked, unwrap: $('rmsd-unwrap').checked,
    ...(reference ? { reference_index: Number(reference) } : {})
  })

  if (!r.ok) { setStatus('RMSD error: ' + (r.message || r.error)); return }

  hideAseProgress('rmsd-prog-row')
  const labels = r.frame_indices.map(String)
  lastResults.rmsd = {
    source: charts.rmsd.source, labels, series: [{ name: indices ? `RMSD · MONET IDs ${indices.map(i => r.atomMapping[i].monetId).join(', ')}` : 'RMSD · all atoms', data: r.rmsd }],
    title: `RMSD vs frame ${r.reference_index}${r.aligned ? ' (Kabsch-aligned)' : ''}`, quantity: 'RMSD', unit: 'Å', notes: r.warning ? [r.warning] : []
  }
  drawGeometry('rmsd')
  setStatus(`RMSD computed over ${r.rmsd.length} frames` + (r.warning ? ` — ${r.warning}` : ''))
})

// =============================================================================
// ── ASE: Pair-distance distribution ─────────────────────────────────────────
// =============================================================================

$('btn-run-pdd').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Load an XYZ file and click Next first.')

  const rmax  = Number($('pdd-rmax').value)
  const nbins = Number($('pdd-bins').value)
  const step  = Number($('pdd-step').value)
  const elRaw = $('pdd-elements').value.trim()
  const elems = elRaw ? elRaw.split(/\s+/) : null

  let indices
  try { indices = MonetASEModel.selectedIndices($('pdd-atoms').value, aseState.analysisAtoms, 2) }
  catch (error) { return setStatus(error.message) }
  const r = await runAse('pdd', {
    action: 'pdd', filename: traj,
    rmax, nbins, frame_step: step, elements: elems, indices
  })

  if (!r.ok) { setStatus('PDD error: ' + (r.message || r.error)); return }

  hideAseProgress('pdd-prog-row')
  const label = (elems ? elems.join('–') : 'all pairs') + (indices ? ` · MONET IDs ${indices.map(i => r.atomMapping[i].monetId).join(', ')}` : ' · all atoms')
  charts.pdd.setData({
    source: charts.pdd.source,
    title:    'Pair-Distance Distribution',
    xLabel:   'Distance (Å)',
    yLabel:   'Count',
    labels:   r.r.map(v => v.toFixed(2)),
    datasets: [{ label: label, data: r.counts, colorIndex: 2 }]
  })
  setStatus(`PDD over ${r.n_frames} frames`)
})

// =============================================================================
// ── ASE: Bond lengths ─────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-bonds').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Load an XYZ file and click Next first.')

  let pairs
  try { pairs = MonetASEModel.groupsFromIds($('bonds-pairs').value, 2, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const step  = Number($('bonds-step').value)

  const r = await runAse('bonds', { action: 'bonds', filename: traj, pairs, frame_step: step })

  if (!r.ok) { setStatus('Bond error: ' + (r.message || r.error)); return }

  hideAseProgress('bonds-prog-row')
  lastResults.bonds = { ...geometrySeries(r), source: charts.bonds.source, title: 'Bond Lengths vs Frame', quantity: 'Distance', unit: 'Å' }
  drawGeometry('bonds')
  setStatus('Bond lengths computed')
})

// =============================================================================
// ── ASE: Bond angles ─────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-angles').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Load an XYZ file and click Next first.')

  let triplets
  try { triplets = MonetASEModel.groupsFromIds($('angles-triplets').value, 3, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const step = Number($('angles-step').value)

  const r = await runAse('angles', { action: 'angles', filename: traj, triplets, frame_step: step, angle_range: $('angles-range').value, angle_normal: $('angles-normal').value.trim().split(/[\s,]+/).map(Number) })

  if (!r.ok) { setStatus('Angles error: ' + (r.message || r.error)); return }

  hideAseProgress('angles-prog-row')
  lastResults.angles = {
    ...geometrySeries(r), angleRange: r.angleRange, angleNormal: r.angleNormal,
    source: charts.angles.source + (r.angleRange === '360' ? ` Reference normal: ${r.angleNormal.join(', ')}.` : ''),
    title: 'Bond Angles vs Frame', quantity: 'Angle', unit: '°'
  }
  drawGeometry('angles')
  setStatus('Bond angles computed')
})

for (const kind of ['angles', 'dihedrals']) {
  $(`${kind}-range`).addEventListener('change', () => {
    clearAnalysis(kind, false)
    $('angles-normal-row').classList.toggle('hidden', $('angles-range').value !== '360')
    setStatus('Angle range changed. Click Compute to calculate and plot this convention.')
  })
}
$('angles-normal').addEventListener('input', () => clearAnalysis('angles', false))

// Dihedral inputs are ordered MONET IDs; rotation is about the middle bond.
$('btn-run-dihedrals').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let quads
  try { quads = MonetASEModel.groupsFromIds($('dihedrals-quads').value, 4, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const r = await runAse('dihedrals', {
    action: 'dihedrals', filename, quads, angle_range: $('dihedrals-range').value, frame_step: Number($('dihedrals-step').value)
  })
  if (!r.ok) return setStatus('Dihedral error: ' + (r.message || r.error))
  lastResults.dihedrals = { ...geometrySeries(r), angleRange: r.angleRange, source: charts.dihedrals.source, title: 'Dihedral Angles vs Frame', quantity: 'Dihedral', unit: '°' }
  drawGeometry('dihedrals')
  setStatus(`Dihedral angles computed (${{ signed90: '−90° to +90°, folded', fold180: '0° to 180°, folded' }[r.angleRange] || '0–360°'}).`)
})


// =============================================================================
// ── Time axis (user-defined MD time step) ────────────────────────────────────
// =============================================================================

const TIME_UNITS = { fs: 1, au: 0.02418884326585747, ps: 1000 }
function fmt (value, digits = 3) {
  if (!Number.isFinite(value)) return '—'
  const size = Math.abs(value)
  if (size && (size < 1e-3 || size >= 1e7)) return value.toExponential(digits - 1)
  return Number(value.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 6 })
}

// Returns { timestep (fs per MD step), stride (MD steps per saved frame), dt (fs per saved frame) } or null.
function timeAxis () {
  if (state.frameMap?.frames) return null
  const value = Number($('md-timestep').value)
  const stride = Number($('md-stride').value)
  if (!$('md-timestep').value.trim() || !(value > 0) || !Number.isInteger(stride) || stride < 1) return null
  const timestep = value * TIME_UNITS[$('md-timestep-unit').value]
  return { timestep, stride, dt: timestep * stride }
}

function updateTimeInfo () {
  const axis = timeAxis()
  const text = axis
    ? `Time between saved frames: ${fmt(axis.dt, 6)} fs (${fmt(axis.timestep, 6)} fs × ${axis.stride}).`
    : state.frameMap?.frames
      ? 'The active trajectory holds picked configurations that are not evenly spaced in time: MSD, VDOS and autocorrelation need the full trajectory (↩ Full trajectory).'
      : 'Set the MD time step used in your simulation (needed for MSD, VDOS and autocorrelation).'
  $$('.time-info').forEach(info => { info.textContent = text })
  if (axis) $$('.time-step').forEach(input => input.classList.remove('field-missing'))
  if (lastResults.acf) showAcfResult()
}
// The time axis is shown at the top of the module and again in the MSD, VDOS and ACF panels:
// every copy edits the same value.
for (const kind of ['time-step', 'time-unit', 'time-stride']) {
  for (const input of $$(`.${kind}`)) {
    const sync = () => {
      for (const other of $$(`.${kind}`)) if (other !== input) other.value = input.value
      updateTimeInfo()
    }
    input.addEventListener('input', sync)
    input.addEventListener('change', sync)
  }
}

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

function requireTime () {
  const axis = timeAxis()
  if (!axis) {
    const fields = [...$$('.time-step')]
    fields.forEach(input => input.classList.add('field-missing'))
    const visible = fields.find(input => input.closest('.ase-subpanel.active'))
    ;(visible || $('md-timestep')).focus()
    throw new Error('Set the MD time step (and MD steps per saved frame): enter it in the highlighted “MD time step” field of this panel.')
  }
  return axis
}

const lineLabels = values => values.map(value => fmt(value, 5))

// =============================================================================
// ── ASE: RMSD matrix ─────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-rmsdmatrix').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let indices
  try { indices = MonetASEModel.selectedIndices($('rmsdmatrix-atoms').value, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const r = await runAse('rmsdmatrix', {
    action: 'rmsd_matrix', filename, indices, frame_step: Number($('rmsdmatrix-step').value),
    max_frames: Number($('rmsdmatrix-max').value), align: $('rmsdmatrix-align').checked, unwrap: $('rmsdmatrix-unwrap').checked
  })
  if (!r.ok) return setStatus('RMSD matrix error: ' + (r.message || r.error))
  charts.rmsdmatrix.setData(matrixStyle('rmsdmatrix', {
    title: `Pairwise RMSD${r.aligned ? ' (Kabsch-aligned)' : ''}`, source: charts.rmsdmatrix.source,
    xLabel: 'Frame', yLabel: 'Frame', colorLabel: 'RMSD (Å)',
    labels: r.frame_indices.map(String), matrix: r.matrix,
    notes: [r.truncated ? `Only the first ${r.frame_indices.length} analysed frames are shown; increase the frame step to cover the whole run.` : '', r.warning || ''].filter(Boolean)
  }))
  setStatus(`RMSD matrix computed for ${r.frame_indices.length} frames.`)
})

// Colour map, orientation and title chosen under a matrix plot; the computed title is kept as default.
function matrixStyle (prefix, data) {
  const base = data.defaultTitle ?? data.title
  return { ...data, defaultTitle: base, title: $(`${prefix}-title`).value.trim() || base, colormap: $(`${prefix}-colormap`).value, origin: $(`${prefix}-origin`).value }
}
for (const [prefix, kind] of [['rmsdmatrix', 'rmsdmatrix'], ['mdamatrix', 'mdamatrix'], ...Object.keys(REGISTRY_PANELS).map(k => [`${k}matrix`, `${k}matrix`])]) {
  for (const id of ['colormap', 'origin', 'title']) {
    $(`${prefix}-${id}`).addEventListener('input', () => {
      if (charts[kind].data) charts[kind].setData(matrixStyle(prefix, charts[kind].data))
    })
  }
}

// =============================================================================
// ── ASE: RDF ─────────────────────────────────────────────────────────────────
// =============================================================================

function drawRdf () {
  const r = lastResults.rdf
  if (!r) return
  const showN = $('rdf-plot').value === 'n'
  charts.rdf.setData({
    title: `Radial distribution function ${r.label}`, source: charts.rdf.source,
    xLabel: 'r (Å)', yLabel: showN ? 'n(r) — coordination number' : 'g(r)',
    labels: lineLabels(r.r),
    datasets: [{ label: `${showN ? 'n(r)' : 'g(r)'} ${r.label} · ${r.n_a}×${r.n_b} atoms · ${r.n_frames} frames`, data: showN ? r.n : r.g, colorIndex: showN ? 4 : 2 }],
    notes: [`Rmax ${fmt(r.rmax, 4)} Å (limit ${fmt(r.rmax_limit, 4)} Å)`]
  })
}
$('rdf-plot').addEventListener('change', drawRdf)

$('btn-run-rdf').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let indices
  try { indices = MonetASEModel.selectedIndices($('rdf-atoms').value, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const elements = $('rdf-elements').value.trim().split(/\s+/).filter(Boolean)
  const rmax = $('rdf-rmax').value.trim()
  const r = await runAse('rdf', {
    action: 'rdf', filename, indices, elements: elements.length ? elements : undefined,
    nbins: Number($('rdf-bins').value), frame_step: Number($('rdf-step').value), ...(rmax ? { rmax: Number(rmax) } : {})
  })
  if (!r.ok) return setStatus('RDF error: ' + (r.message || r.error))
  lastResults.rdf = r
  drawRdf()
  setStatus(`RDF ${r.label} computed over ${r.n_frames} frames.`)
})

// =============================================================================
// ── ASE: MSD / diffusion ─────────────────────────────────────────────────────
// =============================================================================

$('btn-run-msd').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let indices, axis
  try {
    indices = MonetASEModel.selectedIndices($('msd-atoms').value, aseState.analysisAtoms)
    axis = requireTime()
  } catch (error) { return setStatus(error.message) }
  const start = $('msd-fit-start').value.trim(), end = $('msd-fit-end').value.trim()
  const r = await runAse('msd', {
    action: 'msd', filename, indices, dt: axis.dt, frame_step: Number($('msd-step').value),
    remove_drift: $('msd-drift').checked, ...(start ? { fit_start: Number(start) } : {}), ...(end ? { fit_end: Number(end) } : {})
  })
  if (!r.ok) return setStatus('MSD error: ' + (r.message || r.error))
  const names = Object.keys(r.series)
  const fit = r.fits.selection
  const datasets = names.map((name, i) => ({ label: name === 'selection' ? 'MSD · selection' : `MSD · ${name}`, data: r.series[name], colorIndex: i }))
  datasets.push({
    label: `Linear fit ${fmt(r.fit_start, 4)}–${fmt(r.fit_end, 4)} fs`, dash: true, colorIndex: names.length,
    data: r.times.map(t => t >= r.fit_start && t <= r.fit_end ? fit.slope * t + fit.intercept : NaN)
  })
  const lines = names.map(name => `${name === 'selection' ? 'Selection' : name}: D = ${fmt(r.fits[name].D_cm2_s, 4)} cm²/s (${fmt(r.fits[name].D_A2_fs, 4)} Å²/fs, R² ${fmt(r.fits[name].r2, 3)})`)
  charts.msd.setData({
    title: 'Mean-square displacement', source: charts.msd.source,
    xLabel: 'Lag time (fs)', yLabel: 'MSD (Å²)', labels: lineLabels(r.times), datasets,
    notes: [lines[0], r.periodic ? 'Unwrapped with minimum-image steps.' : 'No periodic cell: positions used as written.', r.warning || ''].filter(Boolean)
  })
  $('msd-info').textContent = lines.join(' · ') + (r.warning ? ` — ${r.warning}` : '')
  $('msd-info').classList.remove('hidden')
  setStatus(lines[0])
})

// =============================================================================
// ── ASE: VDOS ────────────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-vdos').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let indices, axis
  try {
    indices = MonetASEModel.selectedIndices($('vdos-atoms').value, aseState.analysisAtoms)
    axis = requireTime()
  } catch (error) { return setStatus(error.message) }
  const r = await runAse('vdos', {
    action: 'vdos', filename, indices, dt: axis.dt, frame_step: Number($('vdos-step').value),
    mass_weighted: $('vdos-mass').checked, smooth_cm: Number($('vdos-smooth').value) || 0, max_cm: Number($('vdos-max').value) || 4000
  })
  if (!r.ok) return setStatus('VDOS error: ' + (r.message || r.error))
  const info = `Nyquist limit ${fmt(r.nyquist_cm, 5)} cm⁻¹ · resolution ${fmt(r.resolution_cm, 3)} cm⁻¹ · ${r.n_frames} frames · Δt ${fmt(r.dt, 5)} fs`
  charts.vdos.setData({
    title: 'Vibrational density of states', source: charts.vdos.source,
    xLabel: 'Wavenumber (cm⁻¹)', yLabel: 'Normalised intensity', labels: lineLabels(r.wavenumber),
    datasets: [{ label: `VDOS${$('vdos-mass').checked ? ' (mass-weighted)' : ''}`, data: r.intensity, colorIndex: 0 }],
    notes: [info, r.warning || ''].filter(Boolean), yMin: 0
  })
  $('vdos-info').textContent = info + (r.warning ? ` — ${r.warning}` : '')
  $('vdos-info').classList.remove('hidden')
  setStatus('VDOS computed. ' + info)
})

// =============================================================================
// ── ASE: autocorrelation and decorrelation stride ────────────────────────────
// =============================================================================

const TAU_INT_LABELS = { sokal: 'Sokal window', geyer: 'Geyer sequence', zero: 'integral to first zero' }
function acfTau () {
  const r = lastResults.acf
  const manual = Number($('acf-tau-manual').value)
  if ($('acf-tau-manual').value.trim() && manual > 0) return { tau: manual, source: 'entered' }
  if (r && Number.isFinite(r.tau_fit) && r.tau_fit > 0) return { tau: r.tau_fit, source: 'fit' }
  if (r && Number.isFinite(r.tau_int) && r.tau_int > 0) return { tau: r.tau_int, source: 'integral' }
  return null
}

// Asymptotic plateau of the fitted ACF: (1 − c)·exp(−t/τ) + c is within ε·(1 − c) of c from
// t* = τ·ln(1/ε) on. Configurations sampled t* apart are treated as uncorrelated.
let acfPlateauEdited = false
function acfDecorrelation () {
  const choice = acfTau()
  if (!choice) return null
  const eps = Number($('acf-plateau-eps').value) || 0.05
  const fitted = choice.tau * Math.log(1 / eps)
  const typed = Number($('acf-plateau-time').value)
  const time = acfPlateauEdited && typed > 0 ? typed : fitted
  const axis = timeAxis()
  const stride = axis ? Math.max(1, Math.ceil(time / axis.dt - 1e-9)) : null
  const frames = playerCount()
  return { ...choice, eps, fitted, time, edited: acfPlateauEdited && typed > 0, axis, stride, frames, kept: stride ? Math.floor((frames - 1) / stride) + 1 : null }
}

function drawAcfChart () {
  const r = lastResults.acf
  if (!r) return
  const datasets = [{ label: `C(t) · ${r.distLabel}`, data: r.acf, colorIndex: 0 }]
  const offset = r.fit_model === 'exp_offset'
  if (r.fit_curve) {
    datasets.push({ label: offset ? `(1 − c)·exp(−t/τ) + c, τ = ${fmt(r.tau_fit, 4)} fs, c = ${fmt(r.plateau, 3)}` : `exp(−t/τ), τ = ${fmt(r.tau_fit, 4)} fs`, data: r.fit_curve, dash: true, colorIndex: 1 })
  }
  if (offset && Number.isFinite(r.plateau)) datasets.push({ label: `plateau c = ${fmt(r.plateau, 3)}`, data: r.acf.map(() => r.plateau), dash: true, colorIndex: 2 })
  const d = acfDecorrelation()
  // A τ typed by hand is drawn with the same model (and plateau c) as the fit, so t* can be checked against it.
  if (d?.source === 'entered') {
    const c = offset && Number.isFinite(r.plateau) ? r.plateau : 0
    datasets.push({ label: `${offset ? '(1 − c)·exp(−t/τ) + c' : 'exp(−t/τ)'}, τ entered = ${fmt(d.tau, 4)} fs`,
      data: r.lags.map(t => (1 - c) * Math.exp(-t / d.tau) + c), dash: true, colorIndex: 3 })
  }
  const markers = d ? [{ value: d.time, label: `t* = ${fmt(d.time, 4)} fs${d.stride ? ` (${d.stride} frames)` : ''}` }] : []
  const keepView = charts.acf._entry === r
  charts.acf._entry = r
  charts.acf.setData({
    title: `Autocorrelation of the ${r.quantity === 'rmsd' ? 'RMSD' : r.quantity}${r.period === 180 ? ' (folded, period 180°)' : ''}`, source: charts.acf.source,
    xLabel: 'Time lag (fs)', yLabel: r.mode === 'circular' ? 'Normalised circular autocorrelation' : 'Normalised autocorrelation',
    labels: lineLabels(r.lags), datasets, markers,
    notes: [`τ fit ${fmt(r.tau_fit, 4)} ± ${fmt(r.tau_fit_error, 2)} fs · τ integral ${fmt(r.tau_int, 4)} fs · Δt ${fmt(r.dt, 5)} fs` +
      (offset ? ` · plateau c = ${fmt(r.plateau, 3)} ± ${fmt(r.plateau_error, 2)}` : '')]
  }, { keepView })
}

// Block averaging (Flyvbjerg & Petersen 1989): the SEM grows with the block length and levels off once
// blocks are longer than the correlation time; the plateau checks the ACF error bar independently.
function drawAcfBlockChart () {
  const r = lastResults.acf
  const b = r?.blocking
  if (!b?.sizes?.length) return clearAnalysis('acfblock', false)
  const plateau = Number.isInteger(b.plateau_index) ? b.times[b.plateau_index] : null
  const note = plateau === null
    ? 'No plateau: the standard error still grows at the longest blocks, so the run is too short for a reliable error bar.'
    // tau_int can be null (fit/window not available): guard the division so fmt shows '—' instead of 0.
    : `Plateau from blocks of ${fmt(plateau, 4)} fs: SEM = ${fmt(b.plateau_sem, 3)} ${r.unit}, g = ${fmt(b.g, 3)} (ACF: g = ${fmt(Number.isFinite(r.tau_int) ? 2 * r.tau_int / r.dt : NaN, 3)}).`
  charts.acfblock.setData({
    title: 'Block averaging of the mean (Flyvbjerg–Petersen)', source: charts.acf.source,
    xLabel: 'Block length (fs)', yLabel: `Standard error of the mean (${r.unit})`,
    labels: b.times.map(t => String(Number(t.toPrecision(5)))),
    datasets: [
      { label: 'SEM of the block means', data: b.sem, colorIndex: 0 },
      { label: 'SEM + error', data: b.sem.map((v, i) => v + b.sem_error[i]), dash: true, colorIndex: 1 },
      { label: 'SEM − error', data: b.sem.map((v, i) => v - b.sem_error[i]), dash: true, colorIndex: 1 },
      { label: `SEM from the ACF (N_eff = ${fmt(r.n_effective, 3)})`, data: b.times.map(() => r.statistics[0].sem), dash: true, colorIndex: 2 }
    ],
    markers: plateau === null ? [] : [{ value: plateau, label: `plateau ${fmt(b.plateau_sem, 3)} ${r.unit}` }],
    notes: [note]
  })
  $('acfblock-text').textContent = note
  $('acfblock-text').classList.remove('hidden')
}

function showAcfResult () {
  const r = lastResults.acf
  if (!r) return
  const axis = timeAxis()
  const steps = value => axis ? ` = ${fmt(value / axis.timestep, 4)} MD steps = ${fmt(value / axis.dt, 4)} saved frames` : ''
  const model = r.fit_model === 'exp_offset' ? '(1 − c)·exp(−t/τ) + c' : 'exp(−t/τ)'
  $('acf-tau-text').textContent = [
    `τ (fit ${model}, ${r.fit_points} points up to ${fmt(r.fit_end, 4)} fs) = ${fmt(r.tau_fit, 4)} ± ${fmt(r.tau_fit_error, 2)} fs${steps(r.tau_fit)}`,
    r.fit_model === 'exp_offset' ? `plateau c = ${fmt(r.plateau, 3)} ± ${fmt(r.plateau_error, 2)}` : null,
    // Sokal/Geyer can return tau_int <= 0 for an anti-correlated series (e.g. a bond saved near half its
    // vibrational period): printing it would show a negative time and a negative error, so say why instead.
    Number.isFinite(r.tau_int) && r.tau_int <= 0
      ? `τ_int (${TAU_INT_LABELS[r.tau_int_method] || 'integral'}): τ_int ≤ 0: no positive correlation resolved`
      : `τ_int (${TAU_INT_LABELS[r.tau_int_method] || 'integral'}${Number.isFinite(r.tau_int_window) ? `, ${r.tau_int_window} lags` : ''}) = ${fmt(r.tau_int, 4)} ± ${fmt(r.tau_int_error, 2)} fs` +
        (r.tau_int_converged === false ? ' (window not reached: extend the lag range or the run)' : ''),
    `Mean ${fmt(r.statistics[0].mean, 5)} ± ${fmt(r.statistics[0].sem, 2)} (std ${fmt(r.statistics[0].std, 4)}), N_eff ≈ ${fmt(r.n_effective, 3)} of ${r.n_frames} frames`
  ].filter(Boolean).join(' · ')
  const d = acfDecorrelation()
  // Run length in units of τ: below ~20 τ neither τ nor the error bars are reliable (workflow document §4.2).
  const runLength = r.n_frames * r.dt
  const ratio = runLength / (d?.tau ?? r.tau_fit)
  $('acf-length-text').textContent = Number.isFinite(ratio)
    ? `Run length T = ${fmt(runLength, 3)} fs = ${fmt(ratio, 3)} τ.` + (ratio < 20
      ? ' ⚠ fewer than 20 τ: τ and the error bars are unreliable; extend the run or add replicas.'
      : ratio < 50 ? ' Fewer than 50 τ: treat τ and the stride as approximate.' : '')
    : ''
  if (d && !acfPlateauEdited) $('acf-plateau-time').value = Number(d.fitted.toPrecision(5))
  // g of configurations taken every `stride` saved frames (the ACF lags are frame_step saved frames apart).
  const gSub = d?.stride ? MonetASEModel.subsampleInefficiency(r.acf, d.stride / (r.frame_step || 1)) : NaN
  if (!d) {
    $('acf-plateau-text').textContent = 'No correlation time is available: the fit failed and the ACF never crossed zero. Enter τ by hand.'
    $('acf-stride-text').textContent = ''
    $('acf-plateau-warn').classList.add('hidden')
  } else {
    $('acf-plateau-text').textContent = d.edited
      ? `You set t* = ${fmt(d.time, 5)} fs (the fit gives ${fmt(d.fitted, 5)} fs = τ·ln(1/ε) with τ ${d.source} = ${fmt(d.tau, 4)} fs, ε = ${d.eps * 100} %).`
      : d.source === 'entered'
        ? `With τ entered = ${fmt(d.tau, 4)} fs (not fitted: the fit gives ${fmt(r.tau_fit, 4)} fs), exp(−t/τ) reaches its plateau within ε = ${d.eps * 100} % at t* = τ·ln(1/ε) = ${fmt(d.fitted, 5)} fs (“τ entered” curve and dashed line on the plot). ` +
          'Compare that curve with C(t) before accepting t*.'
        : `The fitted ACF reaches its plateau within ε = ${d.eps * 100} % at t* = τ·ln(1/ε) = ${fmt(d.fitted, 5)} fs (τ ${d.source} = ${fmt(d.tau, 4)} fs; dashed line on the plot). ` +
          'Check it against the curve, then accept it or type another t*.'
    $('acf-stride-text').textContent = d.stride
      ? `→ t* = ${fmt(d.time, 5)} fs rounded up to a whole number of frames: one configuration every ${d.stride} saved frames (${fmt(d.stride * d.axis.stride, 6)} MD steps, effective spacing ${fmt(d.stride * d.axis.dt, 5)} fs): ${d.kept} uncorrelated configurations out of ${d.frames}`
        + ` · residual correlation of the sampled configurations g ≈ ${fmt(gSub, 3)}, N_eff ≈ ${fmt(d.kept / gSub, 3)}`
      : 'Set the MD time step to convert t* into saved frames.'
    // τ close to the saving interval: the ACF is sampled by only a few points per decay time.
    const coarse = d.axis && d.tau < 5 * d.axis.dt
    $('acf-plateau-warn').textContent = coarse
      ? `⚠ τ ${d.source} = ${fmt(d.tau, 4)} fs is only ${fmt(d.tau / d.axis.dt, 2)} saved frames (Δt = ${fmt(d.axis.dt, 4)} fs): below ~5 Δt the decay is not resolved and t* is not reliable. Check τ against the curve, or save frames more often.`
      : ''
    $('acf-plateau-warn').classList.toggle('hidden', !coarse)
  }
  const ready = Boolean(d?.stride)
  $('acf-apply-stride').disabled = !ready
  $('acf-accept').disabled = !ready || !aseState.available || aseState.busy || (d && d.kept < 2)
  $('acf-result').classList.remove('hidden')
  drawAcfChart()
  drawAcfBlockChart()
}
$('acf-tau-manual').addEventListener('input', () => { acfPlateauEdited = false; showAcfResult() })
$('acf-plateau-eps').addEventListener('change', () => { acfPlateauEdited = false; showAcfResult() })
$('acf-plateau-time').addEventListener('input', () => { acfPlateauEdited = true; showAcfResult() })
$('acf-apply-stride').addEventListener('click', () => {
  const d = acfDecorrelation()
  if (!d?.stride) return
  $('inp-freq').value = d.stride
  updateSampledCount()
  setStatus(`Sampling frequency set to every ${d.stride} frames (step 02, t* = ${fmt(d.time, 4)} fs). Re-run the extraction to apply it.`)
})

// Accepted t*: write the uncorrelated configurations and (optionally) make them the active trajectory.
$('acf-accept').addEventListener('click', async () => {
  const d = acfDecorrelation()
  const filename = extractedTrajPath()
  if (!d?.stride || !filename) return
  const stem = filename.split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
  const output = await window.monet.aseSelectOutput(`${stem}-uncorrelated.extxyz`)
  if (!output) return
  $('acf-subsample-result').classList.add('hidden')
  $('acf-download-uncorrelated').classList.add('hidden')
  const r = await runAse('subsample', { action: 'subsample', filename, stride: d.stride, output })
  if (!r.ok) return acfError(r.message || r.error)
  const summary = `✓ ${r.n_frames} uncorrelated configurations written (every ${d.stride} of ${r.source_frames} frames, t* = ${fmt(d.time, 4)} fs, source frames ${r.first}…${r.last}; each comment line keeps source_frame=).`
  $('acf-subsample-text').textContent = summary
  $('acf-subsample-result').classList.remove('hidden')
  if (r.downloadURL) {
    $('acf-download-uncorrelated').href = r.downloadURL
    $('acf-download-uncorrelated').download = r.output || `${stem}-uncorrelated.extxyz`
    $('acf-download-uncorrelated').classList.remove('hidden')
  }
  const path = r.filePath || output
  if (!$('acf-activate').checked) return setStatus(summary)
  try {
    await activateTrajectory(path, { label: `uncorrelated · every ${d.stride} frames (t* = ${fmt(d.time, 4)} fs)`, strideFactor: d.stride })
    setStatus(`${summary} MONET now analyses and extracts this uncorrelated trajectory (↩ Full trajectory to go back).`)
  } catch (error) { acfError('The uncorrelated trajectory was written but could not be loaded: ' + error.message) }
})

// Lag window of the ACF plot: typed maximum lag, or drag-zoom on the plot.
function applyAcfView () {
  const max = Number($('acf-view-max').value)
  if (!charts.acf.data) return
  if ($('acf-view-max').value.trim() && max > 0) charts.acf.zoomToValues(0, max)
  else charts.acf.setView(null)
}
$('acf-view-max').addEventListener('input', applyAcfView)
$('acf-zoom-reset').addEventListener('click', () => { $('acf-view-max').value = ''; charts.acf.setView(null) })
charts.acf.onZoom = view => { $('acf-zoom-reset').disabled = !view }

function acfError (message) {
  $('acf-error').textContent = message
  $('acf-error').classList.toggle('hidden', !message)
  if (message) setStatus('Autocorrelation: ' + message)
}
function updateAcfRange () { $('acf-range').disabled = $('acf-quantity').value !== 'dihedral' }
updateAcfRange()
$('acf-quantity').addEventListener('change', () => {
  updateAcfRange()
  $('acf-groups').placeholder = { dihedral: '1 2 3 4', angle: '2 1 3', bond: '1 2', rmsd: '1 2 3 …' }[$('acf-quantity').value]
  $('acf-mode').value = 'linear'
  clearAnalysis('acf', false)
  clearAnalysis('equil', false)
  if ($('ase-selection-target').value === 'acf') updateSelectionTarget()
})

// The autocorrelation command built from the panel (also used by equilibration detection).
function acfCommand () {
  const quantity = $('acf-quantity').value
  const axis = requireTime()
  const groups = quantity === 'rmsd'
    ? [MonetASEModel.selectedIndices($('acf-groups').value, aseState.analysisAtoms) || aseState.analysisAtoms.map(atom => atom.aseIndex)]
    : MonetASEModel.groupsFromIds($('acf-groups').value, ACF_WIDTH[quantity], aseState.analysisAtoms)
  const maxLag = $('acf-maxlag').value.trim()
  return {
    action: 'acf', filename: extractedTrajPath(), quantity, groups, dt: axis.dt, frame_step: Number($('acf-step').value),
    mode: $('acf-mode').value, fit_until: $('acf-fit').value, fit_model: $('acf-fit-model').value, tau_int_method: $('acf-tauint').value,
    ...(quantity === 'dihedral' ? { angle_range: $('acf-range').value } : {}),
    ...(maxLag ? { max_lag: Number(maxLag) } : {})
  }
}

$('btn-run-acf').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  acfError('')
  if (!filename) return acfError('Load a trajectory first.')
  let command
  try { command = acfCommand() } catch (error) { return acfError(error.message) }
  const { quantity, groups } = command
  const r = await runAse('acf', command)
  if (!r.ok) return acfError(r.message || r.error)
  lastResults.acf = r
  r.distLabel = quantity === 'rmsd' ? 'RMSD' : groups.map(group => MonetASEModel.seriesLabel(group.join('-'), r.atomMapping)).join(' | ')
  r.unit = { dihedral: '°', angle: '°', bond: 'Å', rmsd: 'Å' }[quantity]
  r.quantity = quantity
  acfPlateauEdited = false
  $('acf-subsample-result').classList.add('hidden')
  showAcfResult()
  applyAcfView()
  const d = acfDecorrelation()
  setStatus(`Autocorrelation computed: τ = ${fmt(r.tau_fit, 4)} fs${d ? `, plateau at t* = ${fmt(d.time, 4)} fs — please validate it below the plot` : ''}.`)
  $('acf-plateau').scrollIntoView?.({ block: 'nearest' })
})

// Equilibration (Chodera 2016): production starts at the t₀ that maximises N_eff = (N − t₀)/g(t₀).
function showEquilibration () {
  const r = lastResults.equil
  if (!r) return
  $('equil-text').textContent = r.t0 === 0
    ? `No transient found: N_eff is largest with the whole run (N_eff ≈ ${fmt(r.n_effective_t0, 4)} of ${r.n_frames} analysed frames). Keep the full trajectory.`
    : `Production starts at t₀ = ${fmt(r.t0_time, 5)} fs (saved frame ${r.t0_frame}${state.frameMap ? `, frame ${fullFrame(r.t0_frame)} of the full trajectory` : ''}): discarding the transient raises N_eff from ${fmt(r.n_effective_full, 4)} to ${fmt(r.n_effective_t0, 4)} (g = ${fmt(r.g_t0, 4)} analysed frames).`
  const labels = r.groupLabels || []
  if (labels.length > 1) {
    const perGroup = (r.per_group_t0 || []).map((t0, k) => `${labels[k] ?? `group ${k + 1}`} ${fmt(t0 * r.dt, 4)} fs`).join(', ')
    $('equil-text').textContent += ` t₀ is set by ${labels[r.group] ?? `group ${r.group + 1}`}, the group that equilibrates last (t₀ per group: ${perGroup}); the curve is that group's.`
  }
  $('equil-crop').disabled = r.t0 === 0 || !aseState.available || aseState.busy
  $('equil-result').classList.remove('hidden')
  charts.equil.setData({
    title: 'Equilibration: effective sample size against the start of production (Chodera 2016)', source: charts.acf.source,
    xLabel: 'Start of production t₀ (fs)', yLabel: 'N_eff = (N − t₀) / g(t₀)',
    labels: r.times.map(t => String(Number(t.toPrecision(6)))),
    datasets: [{ label: `N_eff(t₀)${r.groupLabels?.length > 1 ? ` · ${r.groupLabels[r.group]}` : ''}`, data: r.n_effective, colorIndex: 0 }],
    markers: [{ value: r.t0_time, label: `t₀ = ${fmt(r.t0_time, 4)} fs` }]
  })
}

$('btn-run-equil').addEventListener('click', async () => {
  acfError('')
  if (!extractedTrajPath()) return acfError('Load a trajectory first.')
  let command
  try { command = acfCommand() } catch (error) { return acfError(error.message) }
  const r = await runAse('equil', { ...command, action: 'equilibration' })
  if (!r.ok) return acfError(r.message || r.error)
  r.groupLabels = command.quantity === 'rmsd' ? ['RMSD'] : command.groups.map(group => MonetASEModel.seriesLabel(group.join('-'), r.atomMapping))
  lastResults.equil = r
  showEquilibration()
  setStatus(r.t0 === 0 ? 'Equilibration: no transient found.' : `Equilibration: production starts at t₀ = ${fmt(r.t0_time, 4)} fs.`)
})

$('equil-crop').addEventListener('click', async () => {
  const r = lastResults.equil
  const filename = extractedTrajPath()
  if (!r || !filename || r.t0_frame < 1) return
  const stem = filename.split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
  const output = await window.monet.aseSelectOutput(`${stem}-production.extxyz`)
  if (!output) return
  const s = await runAse('subsample', { action: 'subsample', filename, stride: 1, start: r.t0_frame, output })
  if (!s.ok) return acfError(s.message || s.error)
  try {
    const first = fullFrame(r.t0_frame)
    const derived = Boolean(state.frameMap)
    await activateTrajectory(s.filePath || output, { label: `production · from frame ${first} of the full trajectory (t₀ = ${fmt(r.t0_time, 4)} fs${derived ? ' into the active file' : ''})`, start: r.t0_frame })
    setStatus(`Production window active: ${s.n_frames} frames from frame ${first} of the full trajectory. Compute the ACF again on it (↩ Full trajectory to go back).`)
  } catch (error) { acfError('The production window was written but could not be loaded: ' + error.message) }
})

// =============================================================================
// ── MDAnalysis: format list, selections and analyses ────────────────────────
// =============================================================================

let formatsLoaded = false
async function loadFormatList () {
  if (formatsLoaded) return
  const result = await window.monet.listFormats()
  if (!result?.ok) return
  formatsLoaded = true
  const group = $('inp-format-ase')
  const known = new Set([...$('inp-format').options].map(option => option.value))
  for (const { name, description } of result.ase) {
    if (known.has(name)) continue
    const option = document.createElement('option')
    option.value = `ase:${name}`
    option.textContent = `${description} (${name})`
    group.appendChild(option)
  }
  for (const option of $('inp-format').querySelectorAll('option[value^="mda-"]')) option.disabled = !result.mdanalysis
}

function monetIdsFromIndices (indices, mapping = aseState.analysisAtoms) {
  return indices.map(index => mapping[index]?.monetId).filter(id => id !== undefined)
}

// =============================================================================
// ── Selection tools of both viewers: ASE neighbour lists when available,
//    otherwise the displayed geometry (bonds drawn in the viewer, no periodic images).
// =============================================================================

const viewerSelections = {
  ase: { viewer: aseViewer, get: () => [...aseState.pickedIds], set: ids => syncAsePicks(ids) },
  main: {
    viewer,
    get: () => [...state.selectedAtoms],
    set: ids => { state.selectedAtoms = new Set(ids); syncSelectionUI() }
  }
}

function selectionRadius (target) {
  const radius = Number($(`${target}-sel-radius`)?.value)
  return radius > 0 && radius <= 30 ? radius : 3
}

// ASE selection on the analysed trajectory; null when ASE cannot map these atoms (then the viewer geometry is used).
async function aseSelect (mode, ids, extra = {}) {
  const filename = extractedTrajPath()
  if (!aseState.available || !filename) return null
  const byId = new Map(aseState.analysisAtoms.map(atom => [atom.monetId, atom.aseIndex]))
  if (!byId.size || ids.some(id => !byId.has(id))) return null
  const scale = Number($('ase-bond-scale').value)
  const r = await runAse('select', { action: 'select_atoms', filename, mode, ...(ids.length ? { indices: ids.map(id => byId.get(id)) } : {}),
    bond_scale: scale >= 0.5 && scale <= 2 ? scale : 1.2, ...extra })
  if (!r.ok) throw new Error(r.message || r.error)
  return r
}

const SELECT_LABELS = { neighbors: 'bonded neighbours', molecules: 'molecules', within: 'sphere' }
// mode: neighbors | molecules | within. replace: the result replaces the selection (it starts at the seeds).
async function selectAround (target, mode, seeds, { replace = false } = {}) {
  const t = viewerSelections[target]
  if (!seeds.length) return setStatus('Select at least one atom first.')
  const extra = mode === 'within' ? { radius: selectionRadius(target) } : {}
  let ids = null, via = 'ASE'
  try {
    const r = await aseSelect(mode, seeds, extra)
    if (r) ids = monetIdsFromIndices(r.indices, r.atomMapping)
  } catch (error) { return setStatus(`Selection (${SELECT_LABELS[mode]}): ${error.message}`) }
  if (!ids) {
    via = 'displayed bonds'
    ids = mode === 'within' ? t.viewer.idsWithin(seeds, extra.radius) : t.viewer.bondedIds(seeds, { whole: mode === 'molecules' })
  }
  const shown = new Set(t.viewer.atoms.map(atom => atom.index))
  ids = ids.filter(id => shown.has(id))
  const before = t.get()
  t.set(replace ? ids : [...before, ...ids.filter(id => !before.includes(id))])
  const added = t.get().length - (replace ? 0 : before.length)
  setStatus(`${SELECT_LABELS[mode][0].toUpperCase() + SELECT_LABELS[mode].slice(1)}${mode === 'within' ? ` of ${extra.radius} Å` : ''}: ${replace ? `${ids.length} atoms selected` : `${added} atoms added`} (${via}).`)
}

function selectElements (target, elements, { add = false } = {}) {
  const t = viewerSelections[target]
  const ids = t.viewer.idsOfElements(elements)
  const before = add ? t.get() : []
  t.set([...before, ...ids.filter(id => !before.includes(id))])
  setStatus(`${ids.length} ${elements.join('/')} atoms ${add ? 'added to' : 'selected in'} the viewer.`)
}

function selectAllAtoms (target) {
  const t = viewerSelections[target]
  t.set(t.viewer.atoms.map(atom => atom.index))
}

function invertSelection (target) {
  const t = viewerSelections[target]
  const picked = new Set(t.get())
  t.set(t.viewer.atoms.map(atom => atom.index).filter(id => !picked.has(id)))
}

// Toolbar: element, all/invert, grow by bonds or molecules, sphere of radius R.
function buildSelectionTools (target) {
  const box = $(`${target}-select-tools`)
  const make = (tag, props, text) => Object.assign(document.createElement(tag), props, text ? { textContent: text } : {})
  const element = make('select', { id: `${target}-sel-element`, className: 'field-input field-input-sm', title: 'Element' })
  const buttons = [
    ['select', 'Select element', 'Select every atom of this element', () => element.value && selectElements(target, [element.value])],
    ['add', '+ Element', 'Add every atom of this element to the selection', () => element.value && selectElements(target, [element.value], { add: true })],
    ['all', 'All', 'Select all atoms', () => selectAllAtoms(target)],
    ['invert', 'Invert', 'Invert the selection', () => invertSelection(target)],
    ['neighbors', '+ Bonded', 'Add the atoms bonded to the selection (ASE neighbour list)', () => selectAround(target, 'neighbors', viewerSelections[target].get())],
    ['molecules', '+ Molecules', 'Extend the selection to whole bonded molecules (ASE neighbour list)', () => selectAround(target, 'molecules', viewerSelections[target].get())]
  ].map(([key, text, title, run]) => {
    const button = make('button', { id: `${target}-sel-${key}`, className: 'btn btn-sm', title, type: 'button' }, text)
    button.addEventListener('click', run)
    return button
  })
  const radius = make('input', { id: `${target}-sel-radius`, className: 'field-input field-input-sm', type: 'number', value: '3', min: '0.1', max: '30', step: '0.1', title: 'Radius R (Å)' })
  const within = make('button', { id: `${target}-sel-within`, className: 'btn btn-sm', type: 'button', title: 'Add the atoms within R Å of the selected atoms (minimum image when enabled)' }, '+ Within R')
  within.addEventListener('click', () => selectAround(target, 'within', viewerSelections[target].get()))
  const sphere = make('span', { className: 'select-tools-radius' })
  sphere.append(make('span', {}, 'R'), radius, make('span', {}, 'Å'), within)
  box.append(element, ...buttons, sphere)
  updateSelectionTools(target)
}

function updateSelectionTools (target) {
  const t = viewerSelections[target]
  const select = $(`${target}-sel-element`)
  if (!select) return
  const current = select.value
  const elements = t.viewer.elements()
  select.replaceChildren(...elements.map(el => Object.assign(document.createElement('option'), { value: el, textContent: el })))
  if (elements.includes(current)) select.value = current
  for (const button of $(`${target}-select-tools`).querySelectorAll('button')) button.disabled = !elements.length
  if (target === 'ase') $('sel-pattern-find').disabled = !elements.length
}

// Context menu, shared by the two viewers and the ASE atom table.
const contextMenu = $('viewer-context-menu')
function hideAtomMenu () { $('viewer-context-menu').classList.add('hidden') }
function showViewerMenu (target, event, id) {
  event.preventDefault?.()
  const t = viewerSelections[target]
  if (!t.viewer.atoms.length) return hideAtomMenu()
  const picks = t.get()
  const atom = id === null || id === undefined ? null : t.viewer.atoms[t.viewer._index?.get(id)]
  const radius = selectionRadius(target)
  const items = []
  if (atom) {
    items.push(['header', `Atom ${id} (${atom.element})`],
      ['ctx-toggle', picks.includes(id) ? `Deselect atom ${id}` : `Select atom ${id}`,
        () => t.set(picks.includes(id) ? picks.filter(v => v !== id) : [...picks, id])],
      ['ctx-molecule', `Select molecule containing atom ${id}`, () => selectAround(target, 'molecules', [id], { replace: true })],
      ['ctx-neighbours', `Select atom ${id} and its bonded neighbours`, () => selectAround(target, 'neighbors', [id], { replace: true })],
      ['ctx-sphere', `Select atoms within ${radius} Å of atom ${id}`, () => selectAround(target, 'within', [id], { replace: true })],
      ['ctx-element', `Select all ${atom.element} atoms`, () => selectElements(target, [atom.element])],
      ['sep'])
  }
  const none = !picks.length
  items.push(['header', `Selection (${picks.length} atoms)`],
    ['ctx-grow-bonded', 'Add bonded neighbours', () => selectAround(target, 'neighbors', picks), none],
    ['ctx-grow-molecules', 'Extend to whole molecules', () => selectAround(target, 'molecules', picks), none],
    ['ctx-grow-within', `Add atoms within ${radius} Å`, () => selectAround(target, 'within', picks), none],
    ['ctx-all', 'Select all', () => selectAllAtoms(target)],
    ['ctx-invert', 'Invert selection', () => invertSelection(target)],
    ['ctx-clear', 'Clear selection', () => t.set([]), none],
    ['sep'],
    ['ctx-center', none ? 'Centre view on all atoms' : 'Centre view on selection', () => t.viewer.centerOn(picks)],
    ['ctx-reset', 'Reset view', () => target === 'ase' ? $('ase-fit-view').click() : (t.viewer.rotX = .25, t.viewer.rotY = -.40, t.viewer.fitView())])
  contextMenu.replaceChildren(...items.map(([key, text, run, disabled]) => {
    if (key === 'sep') return Object.assign(document.createElement('div'), { className: 'ctx-sep' })
    if (key === 'header') return Object.assign(document.createElement('div'), { className: 'ctx-header', textContent: text })
    const button = Object.assign(document.createElement('button'), { id: key, className: 'ctx-item', type: 'button', textContent: text, disabled: Boolean(disabled) })
    button.setAttribute('role', 'menuitem')
    button.addEventListener('click', () => { hideAtomMenu(); run() })
    return button
  }))
  contextMenu.classList.remove('hidden')
  const { width, height } = contextMenu.getBoundingClientRect()
  contextMenu.style.left = Math.max(0, Math.min(event.clientX, window.innerWidth - (width || 290))) + 'px'
  contextMenu.style.top = Math.max(0, Math.min(event.clientY, window.innerHeight - (height || 380))) + 'px'
  contextMenu.querySelector('.ctx-item:not(:disabled)')?.focus()
}
// Kept for the ASE atom table (right-click on a row).
function showAtomMenu (event, id) { showViewerMenu('ase', event, id) }
aseViewer.onContextClick = (event, id) => showViewerMenu('ase', event, id)
viewer.onContextClick = (event, id) => showViewerMenu('main', event, id)
document.addEventListener('mousedown', event => { if (!contextMenu.contains(event.target)) hideAtomMenu() })
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideAtomMenu() })
window.addEventListener('blur', hideAtomMenu)
for (const target of Object.keys(viewerSelections)) {
  buildSelectionTools(target)
  viewerSelections[target].viewer.onLoad = () => updateSelectionTools(target)
}

// Bonded chains by element (bonds, angles, dihedrals) from the ASE neighbour list, written into analysis inputs.
const PATTERN_MODES = { 2: 'bonds', 3: 'angles', 4: 'dihedrals' }
$('sel-pattern-find').addEventListener('click', async () => {
  const pattern = $('sel-pattern').value.trim().split(/[\s,\-]+/).filter(Boolean)
    .map(p => p === '*' ? p : p[0].toUpperCase() + p.slice(1).toLowerCase())
  const mode = PATTERN_MODES[pattern.length]
  const status = message => { $('sel-pattern-status').textContent = message; setStatus(message) }
  if (!mode) return status('Enter 2, 3 or 4 element symbols, e.g. "O H", "H O H" or "C C C C" (* = any element).')
  if (!aseState.available) return status('Bonded chains need ASE: start MONET with python3 start_monet.py or the desktop app.')
  const byId = new Map(aseState.analysisAtoms.map(atom => [atom.monetId, atom.aseIndex]))
  const restrict = $('sel-pattern-restrict').checked ? aseState.pickedIds.map(id => byId.get(id)).filter(i => i !== undefined) : null
  if (restrict && !restrict.length) return status('Select atoms first, or untick "only among selected atoms".')
  let r
  try { r = await aseSelect(mode, [], { pattern, ...(restrict ? { restrict } : {}) }) } catch (error) { return status(`Find ${mode}: ${error.message}`) }
  if (!r) return status('Load a trajectory first.')
  if (!r.groups.length) return status(`No ${pattern.join('-')} ${mode} found with this bond cutoff.`)
  const groups = r.groups.map(group => monetIdsFromIndices(group, r.atomMapping))
  const text = groups.map(group => group.join(' ')).join('  ')
  const where = $('sel-pattern-target').value
  const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new Event('change')) }
  if (where === 'acf') { change('acf-quantity', mode.slice(0, -1)); $('acf-groups').value = text }
  else if (where === 'fluct') { change('fluct-quantity', mode); change('fluct-scope', 'groups'); $('fluct-groups').value = text }
  else $(selectionTargets[mode].input).value = text
  syncAsePicks([...new Set(groups.flat())])
  const into = { geometry: `the ${mode} input`, acf: 'the autocorrelation groups', fluct: 'the fluctuation groups' }[where]
  status(`${r.n_groups} ${pattern.join('-')} ${mode} found${r.truncated ? ` (first ${groups.length} kept)` : ''} and written to ${into}; their atoms are selected. Click Compute in that panel.`)
})
$('sel-pattern').addEventListener('keydown', event => { if (event.key === 'Enter') $('sel-pattern-find').click() })

$('mda-pick').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  const selection = $('mda-pick-selection').value.trim()
  if (!filename || !selection) return setStatus('Load a trajectory and enter an MDAnalysis selection.')
  const r = await runAse('mdapick', { action: 'mda_select', filename, selection })
  if (!r.ok) {
    $('mda-pick-status').textContent = r.message || r.error
    return setStatus('MDAnalysis selection: ' + (r.message || r.error))
  }
  syncAsePicks(monetIdsFromIndices(r.indices, r.atomMapping))
  $('mda-pick-status').textContent = `${r.n_atoms} atoms in ${r.n_residues} residues${r.residues.length ? ': ' + r.residues.slice(0, 12).join(', ') + (r.n_residues > 12 ? ' …' : '') : ''}.`
  setStatus(`Selected ${r.n_atoms} atoms with "${selection}".`)
})

// ── Registered analyses (monet_registry.py): MDAnalysis tab and "More analyses" ──
// Forms, menus and plots come from the list the Python side sends (list_analyses), so an analysis
// or plugin added in Python appears here without any change to this file.
aseState.analyses = []
aseState.analysisErrors = []

function registrySpec (id) { return aseState.analyses.find(entry => entry.id === id) || null }

async function loadRegistry () {
  let r = null
  if (aseState.available && window.monet.listAnalyses) {
    try { r = await window.monet.listAnalyses() } catch (error) { r = { ok: false, error: error.message } }
  }
  aseState.analyses = r?.ok ? r.analyses : []
  aseState.analysisErrors = r?.ok ? r.errors : []
  MonetAnalysisForms.fillSelect($('mda-analysis'), aseState.analyses.filter(entry => entry.engine === 'mdanalysis'))
  updateMdaForm()
  const failed = aseState.analysisErrors.map(e => `${e.source}: ${e.error}`)
  for (const [kind, engine] of Object.entries(REGISTRY_PANELS)) {
    const entries = aseState.analyses.filter(entry => entry.engine === engine)
    MonetAnalysisForms.fillSelect($(`${kind}-analysis`), entries)
    document.querySelector(`.ase-stab[data-stab="${kind}"]`).classList.toggle('registry-empty', !entries.length)
    $(`${kind}-availability`).textContent = (entries.length
      ? `${entries.length} analys${entries.length === 1 ? 'is' : 'es'} added as plugins. Put your own in the plugins folder of MONET or in ~/.monet/plugins (see docs/plugins.md), then restart the launcher.`
      : 'No plugin analyses for this module.') + (failed.length ? ` Plugins that could not be loaded: ${failed.join('; ')}` : '')
    updateRegistryForm(kind)
  }
  syncMonetSubtabs()
}

function buildRegistryForm (prefix, spec) {
  MonetAnalysisForms.build($(`${prefix}-fields`), spec, {
    prefix, picked: () => aseState.pickedIds, onMissingPick: () => setStatus('Select atoms in the viewer first.')
  })
  $(`${prefix}-description`).textContent = MonetAnalysisForms.describe(spec)
}

function readRegistryForm (prefix) {
  return MonetAnalysisForms.read($(`${prefix}-fields`), {
    indices: text => MonetASEModel.selectedIndices(text, aseState.analysisAtoms),
    groups: (text, width) => MonetASEModel.groupsFromIds(text, width, aseState.analysisAtoms)
  })
}

function updateMdaForm () {
  const spec = registrySpec($('mda-analysis').value)
  buildRegistryForm('mda', spec)
  if (!spec) $('mda-description').textContent = aseState.available ? 'MDAnalysis analyses are unavailable.' : 'MDAnalysis analyses need the launcher (python3 start_monet.py).'
  clearAnalysis('mda', false)
  if (typeof updateAseControls === 'function' && typeof charts !== 'undefined') updateAseControls()
}
$('mda-analysis').addEventListener('change', updateMdaForm)

function updateRegistryForm (kind) {
  buildRegistryForm(kind, registrySpec($(`${kind}-analysis`).value))
  clearAnalysis(kind, false)
  updateAseControls()
}

// Atom indices (0-based, analysed file) → "MONET ID (element)".
function atomName (index, mapping) {
  const atom = mapping.find(a => a.aseIndex === index)
  return atom ? `${atom.monetId} (${atom.element})` : `#${index}`
}

function renderTable (container, table, { title, mapping, mismatch } = {}) {
  const wrap = document.createElement('div')
  if (title) {
    const heading = document.createElement('h4')
    heading.textContent = title
    wrap.appendChild(heading)
  }
  const element = document.createElement('table')
  element.className = 'atom-table'
  const head = element.createTHead().insertRow()
  for (const column of table.columns) {
    const th = document.createElement('th')
    th.textContent = column
    head.appendChild(th)
  }
  const body = element.createTBody()
  const atomColumns = new Set(table.atom_columns || [])
  table.rows.forEach((values, r) => {
    const row = body.insertRow()
    if (mismatch?.has(r)) row.classList.add('mismatch')
    values.forEach((value, c) => { row.insertCell().textContent = atomColumns.has(c) && mapping ? atomName(value, mapping) : value })
  })
  const scroll = document.createElement('div')
  scroll.className = 'ase-atom-scroll'
  scroll.appendChild(element)
  wrap.appendChild(scroll)
  container.appendChild(wrap)
}

let mdaAlignedPath = null
// The aligned file keeps only every frame_step-th frame: one of its frames spans that many of the active file.
let mdaAlignedStep = 1

// Command of a registered analysis. The built-in MDAnalysis analyses keep their own actions
// (mda_run, mda_align) so that saved histories and replay scripts stay valid.
async function registryCommand (spec, kind) {
  const filename = extractedTrajPath()
  if (!filename) throw new Error('Load an XYZ file and click Next first.')
  if (!spec) throw new Error('Choose an analysis.')
  const params = readRegistryForm(kind)
  const command = { filename, frame_step: Number($(`${kind}-step`).value) || 1, params }
  if (spec.output) {
    const stem = filename.split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
    command.output = await window.monet.aseSelectOutput(`${stem}${spec.output.suffix}`)
    if (!command.output) return null
  }
  if (spec.id === 'mdanalysis.align') command.action = 'mda_align'
  else if (spec.engine === 'mdanalysis' && spec.source === 'built-in') Object.assign(command, { action: 'mda_run', analysis: spec.name })
  else Object.assign(command, { action: 'run_analysis', analysis: spec.id })
  const axis = timeAxis()
  if (axis && command.action !== 'mda_align') command.dt = axis.dt
  return command
}

// Plot, map and table of a registered analysis result in the panel of `kind` (mda, extase, extcustom).
function showRegistryResult (kind, r, { title, step, matrixTitle }) {
  const notes = [...(r.notes || []), ...(r.n_frames ? [`${r.n_frames} analysed frames (step ${step})`] : [])]
  if (r.kind === 'matrix') {
    $(`${kind}-matrix-block`).classList.remove('hidden')
    charts[`${kind}matrix`].source = charts[kind].source
    charts[`${kind}matrix`].setData(matrixStyle(`${kind}matrix`, {
      title: matrixTitle || title, source: charts[kind].source, xLabel: r.xLabel, yLabel: r.yLabel, colorLabel: r.colorLabel,
      labels: r.labels.map(String), matrix: r.matrix, notes: r.notes || []
    }))
  } else if (r.kind !== 'table') {
    const frames = r.xLabel === 'Frame'
    let labels = frames ? r.x.map(String) : lineLabels(r.x)
    if (r.atoms) labels = r.atoms.map(index => String(r.atomMapping.find(a => a.aseIndex === index)?.monetId ?? index + 1))
    charts[kind].setData({
      title, source: charts[kind].source, xLabel: r.xLabel, yLabel: r.yLabel, labels, notes,
      datasets: r.series.map((entry, k) => {
        const stats = frames ? MonetASEModel.seriesStats(entry.data) : null
        return { label: stats ? `${entry.label} · mean ${fmt(stats.mean, 4)} ± ${fmt(stats.std, 3)}` : entry.label, data: entry.data, bars: Boolean(r.bars), colorIndex: k }
      })
    })
  }
  lastResults[kind] = r
  if (r.table && !r.pca) renderTable($(`${kind}-table`), r.table, { mapping: r.atomMapping, title: r.kind === 'table' ? title : null })
  if (r.kind === 'table' && notes.length) {
    const note = document.createElement('p')
    note.className = 'panel-desc'
    note.textContent = notes.join(' · ')
    $(`${kind}-table`).appendChild(note)
  }
}

// Download link of a written file; a written trajectory can become the active one.
function showRegistryOutput (kind, r, command) {
  const link = $(`${kind}-download`)
  if (r.downloadURL) {
    link.href = r.downloadURL
    link.download = r.output || command.output.split(/[\\/]/).pop()
    link.classList.remove('hidden')
  }
  return r.filePath || command.output
}

$('btn-run-mda').addEventListener('click', async () => {
  const spec = registrySpec($('mda-analysis').value)
  let command
  try { command = await registryCommand(spec, 'mda') } catch (error) { return setStatus(error.message) }
  if (!command) return
  clearAnalysis('mda', false)
  const r = await runAse('mda', command)
  if (!r.ok) return setStatus('MDAnalysis error: ' + (r.message || r.error))
  const written = showRegistryOutput('mda', r, command)
  if (spec.output?.trajectory) {
    mdaAlignedPath = written
    mdaAlignedStep = command.frame_step
    $('mda-activate').classList.remove('hidden')
    if (command.action === 'mda_align') {
      renderTable($('mda-table'), { columns: ['Aligned trajectory', 'Value'], rows: [['Frames', r.n_frames], ['Fit selection', r.selection], ['File', $('mda-download').download || command.output]] })
      return setStatus(`Aligned ${r.n_frames} frames on "${r.selection}".`)
    }
  } else mdaAlignedPath = null
  const title = $('mda-analysis').selectedOptions[0].textContent
  if (r.pca) {
    lastResults.mda = r
    showPca(r, { title, notes: [...(r.notes || []), `${r.n_frames} analysed frames (step ${command.frame_step})`], filename: command.filename, step: command.frame_step })
  } else showRegistryResult('mda', r, { title, step: command.frame_step, matrixTitle: spec.id === 'mdanalysis.rmsd_matrix' ? 'Pairwise RMSD (MDAnalysis)' : title })
  setStatus(`MDAnalysis ${spec.name} computed.`)
})

$('mda-activate').addEventListener('click', async () => {
  if (!mdaAlignedPath) return
  try {
    await activateTrajectory(mdaAlignedPath, { label: 'aligned (MDAnalysis AlignTraj)', strideFactor: mdaAlignedStep })
    setStatus('MONET now analyses and extracts the aligned trajectory (↩ Full trajectory to go back).')
  } catch (error) { setStatus('The aligned trajectory could not be loaded: ' + error.message) }
})

// "More analyses" of the ASE and MONET Custom modules: any registered analysis of that engine.
const registryWritten = {}
for (const kind of Object.keys(REGISTRY_PANELS)) {
  $(`${kind}-analysis`).addEventListener('change', () => updateRegistryForm(kind))
  $(`btn-run-${kind}`).addEventListener('click', async () => {
    const spec = registrySpec($(`${kind}-analysis`).value)
    let command
    try { command = await registryCommand(spec, kind) } catch (error) { return setStatus(error.message) }
    if (!command) return
    clearAnalysis(kind, false)
    const r = await runAse(kind, command)
    if (!r.ok) return setStatus(`${spec.label}: ${r.message || r.error}`)
    const written = showRegistryOutput(kind, r, command)
    registryWritten[kind] = spec.output?.trajectory ? { path: written, step: command.frame_step, label: spec.label } : null
    $(`${kind}-activate`).classList.toggle('hidden', !registryWritten[kind])
    showRegistryResult(kind, r, { title: spec.label, step: command.frame_step })
    setStatus(`${spec.label} computed.`)
  })
  $(`${kind}-activate`).addEventListener('click', async () => {
    const written = registryWritten[kind]
    if (!written) return
    try {
      await activateTrajectory(written.path, { label: written.label, strideFactor: written.step })
      setStatus(`MONET now analyses and extracts the trajectory written by ${written.label} (↩ Full trajectory to go back).`)
    } catch (error) { setStatus('The trajectory could not be loaded: ' + error.message) }
  })
}

// =============================================================================
// ── PCA: plotted components, distribution and picked configurations ──────────
// =============================================================================

// `var`: clearAnalysis('mda') resets it, possibly before this block has run.
var pca = null
const PCA_TABLE_ROWS = 500

function resetPca () {
  pca = null
  $('mda-pca-block').classList.add('hidden')
  $('pca-components').replaceChildren()
  $('pca-selected-table').replaceChildren()
  $('pca-selection').classList.add('hidden')
  $('pca-clear').disabled = true
}

// r: mda_run result of pca.PCA (up to 10 projections, the first `r.pca.shown` plotted).
function showPca (r, { title, notes, filename }) {
  const count = r.pca.components
  pca = {
    title, notes, filename, xLabel: r.xLabel,
    frames: r.frame_indices,
    index: new Map(r.frame_indices.map((frame, i) => [frame, i])),
    labels: r.series.map(series => series.label.replace(/ \(.*$/, '')),
    legends: r.series.map(series => series.label),
    projections: r.series.map(series => series.data),
    stats: r.series.map(series => MonetASEModel.seriesStats(series.data)),
    variance: r.table.rows.map(row => row[1]),
    cumulated: r.table.rows.map(row => row[2]),
    ratio: r.pca.variance_ratio,
    shown: new Set(Array.from({ length: r.pca.shown }, (_, k) => k)),
    selected: [], sides: null, component: null, written: null
  }
  for (const id of ['pca-win-pc', 'pca-win2-pc', 'pca-ext-pc']) {
    const select = $(id)
    select.replaceChildren()
    if (id === 'pca-win2-pc') select.add(new Option('—', ''))
    for (let k = 0; k < count; k++) select.add(new Option(pca.labels[k], String(k)))
  }
  for (const id of ['pca-win-low', 'pca-win-high', 'pca-win2-low', 'pca-win2-high']) $(id).value = ''
  $('pca-selection').classList.add('hidden')
  $('pca-selected-table').replaceChildren()
  $('pca-clear').disabled = true
  renderPcaComponents()
  $('mda-pca-block').classList.remove('hidden')
  drawPca({ keepView: false })
}

// The component list: tick the ones to plot (at least one).
function renderPcaComponents () {
  const table = document.createElement('table')
  table.className = 'atom-table pca-components-table'
  const head = table.createTHead().insertRow()
  for (const column of ['Plot', 'Component', 'Variance (Å²)', 'Explained (%)', 'Cumulated (%)', 'Mean ± std (Å)']) {
    const th = document.createElement('th')
    th.textContent = column
    head.appendChild(th)
  }
  const body = table.createTBody()
  pca.labels.forEach((label, k) => {
    const row = body.insertRow()
    row.classList.toggle('pca-off', !pca.shown.has(k))
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.id = `pca-show-${k}`
    box.checked = pca.shown.has(k)
    box.setAttribute('aria-label', `Plot ${label}`)
    box.addEventListener('change', () => {
      if (!box.checked && pca.shown.size === 1) { box.checked = true; return setStatus('Keep at least one component plotted.') }
      if (box.checked) pca.shown.add(k)
      else pca.shown.delete(k)
      row.classList.toggle('pca-off', !box.checked)
      drawPca()
    })
    row.insertCell().appendChild(box)
    const stats = pca.stats[k]
    for (const value of [label, pca.variance[k], fmt(100 * pca.ratio[k], 3), pca.cumulated[k], `${fmt(stats.mean, 3)} ± ${fmt(stats.std, 3)}`]) row.insertCell().textContent = value
  })
  const scroll = document.createElement('div')
  scroll.className = 'ase-atom-scroll'
  scroll.appendChild(table)
  $('pca-components').replaceChildren(scroll)
}

function pcaShown () {
  return [...pca.shown].sort((a, b) => a - b)
}

function drawPca ({ keepView = true } = {}) {
  if (!pca) return
  const shown = pcaShown()
  const datasets = shown.map(k => ({
    label: `${pca.legends[k]} · mean ${fmt(pca.stats[k].mean, 4)} ± ${fmt(pca.stats[k].std, 3)}`,
    // Eight series colours: PC9 and PC10 are dashed so they differ from PC1 and PC2.
    data: pca.projections[k], colorIndex: k, dash: k >= 8 || undefined
  }))
  if (pca.selected.length) {
    // Picked frames are marked on the component they were picked on (or the first plotted one).
    const k = shown.includes(pca.component) ? pca.component : shown[0]
    const picked = new Set(pca.selected)
    // A series colour not used by the plotted components, the high-contrast ones first.
    const free = [4, 5, 1, 6, 7, 0, 2, 3].find(c => !shown.includes(c)) ?? 4
    datasets.push({
      label: `selected configurations (${pca.selected.length}) on ${pca.labels[k]}`, points: true, colorIndex: free,
      data: pca.frames.map((frame, i) => picked.has(frame) ? pca.projections[k][i] : NaN)
    })
  }
  charts.mda.setData({
    title: pca.title, source: charts.mda.source, xLabel: pca.xLabel, yLabel: 'Projection (Å)',
    labels: pca.frames.map(String), notes: pca.notes, datasets
  }, { keepView })
  drawPcaDistribution(shown)
}

// Probability density of every plotted projection on common bins, with the projection window marked.
function drawPcaDistribution (shown) {
  const bins = Math.max(2, Math.min(500, Math.round(Number($('mdadist-bins').value)) || 60))
  let low = Infinity, high = -Infinity
  for (const k of shown) for (const value of pca.projections[k]) {
    if (Number.isFinite(value)) { low = Math.min(low, value); high = Math.max(high, value) }
  }
  const hists = shown.map(k => MonetASEModel.histogram(pca.projections[k], bins, low, high))
  const { centres, width } = hists[0]
  pca.hist = { low: centres[0] - width / 2, width, shown }
  const markers = []
  const window = pcaWindow()
  if (window && shown.includes(window.component)) {
    markers.push({ value: window.low, label: `${pca.labels[window.component]} window` }, { value: window.high, label: '' })
  }
  charts.mdadist.setData({
    title: `${pca.title} — distribution`, source: charts.mda.source,
    xLabel: 'Projection (Å)', yLabel: 'Probability density (1/Å)', yMin: 0, markers,
    labels: centres.map(value => fmt(value, 5)),
    notes: [`${pca.frames.length} analysed frames · click a bar to select that projection window (Shift-click widens it)`],
    datasets: shown.map((k, i) => ({ label: pca.labels[k], data: hists[i].density, bars: true, colorIndex: k }))
  })
}

// First projection window typed or clicked, or null when incomplete.
function pcaWindow () {
  const component = $('pca-win-pc').value
  const low = Number($('pca-win-low').value), high = Number($('pca-win-high').value)
  if (component === '' || !$('pca-win-low').value.trim() || !$('pca-win-high').value.trim() || !Number.isFinite(low) || !Number.isFinite(high)) return null
  return { component: Number(component), low: Math.min(low, high), high: Math.max(low, high) }
}

function updatePcaMode () {
  const mode = $('pca-mode').value
  for (const row of $$('.pca-mode-row')) row.classList.toggle('hidden', row.dataset.mode !== mode)
}

function applyPcaSelection () {
  if (!pca) return
  const spacing = Math.max(1, Math.round(Number($('pca-spacing').value)) || 1)
  const mode = $('pca-mode').value
  let selected, describe, sides = null, component = null
  try {
    if (mode === 'window') {
      const first = pcaWindow()
      if (!first) throw new Error('Enter both ends of the projection window, or click a bar of the distribution.')
      const windows = [first]
      const second = $('pca-win2-pc').value
      const low = $('pca-win2-low').value.trim(), high = $('pca-win2-high').value.trim()
      if (second !== '' && (low || high)) {
        if (!low || !high || !Number.isFinite(Number(low)) || !Number.isFinite(Number(high))) throw new Error('Enter both ends of the second window, or set its component to —.')
        windows.push({ component: Number(second), low: Math.min(Number(low), Number(high)), high: Math.max(Number(low), Number(high)) })
      }
      component = first.component
      selected = MonetASEModel.thinFrames(MonetASEModel.framesInWindows(pca.frames, pca.projections, windows), spacing)
      describe = windows.map(w => `${pca.labels[w.component]} from ${fmt(w.low, 4)} to ${fmt(w.high, 4)} Å`).join(' and ')
    } else if (mode === 'extremes') {
      component = Number($('pca-ext-pc').value)
      const n = Math.round(Number($('pca-ext-n').value))
      if (!(n >= 1)) throw new Error('Enter how many configurations to take at each end.')
      const ends = MonetASEModel.extremeFrames(pca.frames, pca.projections[component], n, spacing)
      sides = new Map([...ends.low.map(item => [item.frame, 'lowest']), ...ends.high.map(item => [item.frame, 'highest'])])
      selected = [...sides.keys()].sort((a, b) => a - b)
      describe = `the ${n} lowest and ${n} highest projections on ${pca.labels[component]}`
    } else {
      selected = MonetASEModel.thinFrames(MonetASEModel.parseFrameList($('pca-frame-list').value, playerCount() || undefined), spacing)
      if (!selected.length) throw new Error('Enter frame numbers, or Shift-click the projection plot.')
      describe = 'frames picked by number'
    }
  } catch (error) { return setStatus(error.message) }
  if (spacing > 1) describe += `, at least ${spacing} frames apart`
  Object.assign(pca, { selected, sides, component, written: null })
  showPcaSelection(describe)
  drawPca()
}

function showPcaSelection (describe) {
  const n = pca.selected.length
  $('pca-selection').classList.remove('hidden')
  $('pca-clear').disabled = false
  $('pca-write').disabled = !n
  $('pca-download').classList.add('hidden')
  $('pca-activate').classList.add('hidden')
  $('pca-selection-text').textContent = n
    ? `${n} configuration${n > 1 ? 's' : ''} selected (${describe}; ${n > 1 ? `frames ${pca.selected[0]}…${pca.selected[n - 1]}` : `frame ${pca.selected[0]}`}). Click a row to show it in the viewer.`
    : `No analysed frame matches: ${describe}.`
  const shown = pcaShown()
  const table = document.createElement('table')
  table.className = 'atom-table'
  const head = table.createTHead().insertRow()
  for (const column of ['Frame', ...(pca.sides ? ['End'] : []), ...shown.map(k => `${pca.labels[k]} (Å)`)]) {
    const th = document.createElement('th')
    th.textContent = column
    head.appendChild(th)
  }
  const body = table.createTBody()
  for (const frame of pca.selected.slice(0, PCA_TABLE_ROWS)) {
    const row = body.insertRow()
    row.tabIndex = 0
    row.title = `Show frame ${frame} in the viewer`
    const i = pca.index.get(frame)
    const cells = [frame, ...(pca.sides ? [pca.sides.get(frame)] : []), ...shown.map(k => i === undefined ? '—' : fmt(pca.projections[k][i], 4))]
    for (const value of cells) row.insertCell().textContent = value
    const show = () => { playerStop(); goToFrame(frame) }
    row.addEventListener('click', show)
    row.addEventListener('keydown', event => { if (event.key === 'Enter') show() })
  }
  const scroll = document.createElement('div')
  scroll.className = 'ase-atom-scroll'
  scroll.appendChild(table)
  const parts = [scroll]
  if (n > PCA_TABLE_ROWS) {
    const note = document.createElement('p')
    note.className = 'panel-desc'
    note.textContent = `First ${PCA_TABLE_ROWS} of ${n} configurations listed; all of them are written.`
    parts.push(note)
  }
  $('pca-selected-table').replaceChildren(...(n ? parts : []))
}

function addPcaFrames (frames) {
  const text = $('pca-frame-list').value.trim()
  $('pca-frame-list').value = (text ? `${text} ` : '') + frames.join(' ')
  $('pca-mode').value = 'list'
  updatePcaMode()
  applyPcaSelection()
}

$('pca-mode').addEventListener('change', updatePcaMode)
$('pca-select').addEventListener('click', applyPcaSelection)
$('mdadist-bins').addEventListener('input', () => { if (pca) drawPcaDistribution(pcaShown()) })
for (const id of ['pca-win-pc', 'pca-win-low', 'pca-win-high']) $(id).addEventListener('input', () => { if (pca) drawPcaDistribution(pcaShown()) })
$('pca-clear').addEventListener('click', () => {
  if (!pca) return
  Object.assign(pca, { selected: [], sides: null, component: null, written: null })
  $('pca-selection').classList.add('hidden')
  $('pca-selected-table').replaceChildren()
  $('pca-clear').disabled = true
  drawPca()
})
$('pca-add-shown').addEventListener('click', () => {
  if (!pca) return
  if (!player.count) return setStatus('Load a trajectory first.')
  addPcaFrames([player.index])
})

// Shift-click on the projections: add that frame to the list (a plain click shows it, see bindPlayerCharts).
charts.mda.canvas.addEventListener('click', event => {
  if (!pca || !event.shiftKey) return
  const label = charts.mda.labelAt(event.clientX)
  if (label !== null && label !== undefined) addPcaFrames([Number(label)])
})

// Click a bar of the distribution: that bin becomes the projection window of its component.
charts.mdadist.canvas.addEventListener('click', event => {
  if (!pca?.hist || !charts.mdadist.data) return
  const hit = charts.mdadist.slotAt(event.clientX)
  if (!hit) return
  const { low, width, shown } = pca.hist
  const current = pcaWindow()
  let component = hit.bar !== null ? shown[hit.bar] : shown.includes(current?.component) ? current.component : shown[0]
  if (component === undefined) component = shown[0]
  let from = low + hit.index * width, to = from + width
  if (event.shiftKey && current && current.component === component) {
    from = Math.min(from, current.low)
    to = Math.max(to, current.high)
  }
  // Round outwards so that the frames on the bin edges stay inside the window.
  $('pca-win-pc').value = String(component)
  $('pca-win-low').value = String(Math.floor(from * 1e4) / 1e4)
  $('pca-win-high').value = String(Math.ceil(to * 1e4) / 1e4)
  $('pca-mode').value = 'window'
  updatePcaMode()
  applyPcaSelection()
})

// Write the picked frames as a trajectory (source_frame= kept in every comment line).
$('pca-write').addEventListener('click', async () => {
  if (!pca?.selected.length) return
  const filename = extractedTrajPath()
  if (!filename || filename !== pca.filename) return setStatus('The active trajectory changed after the PCA: compute it again.')
  const frames = [...pca.selected]
  const stem = filename.split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
  const output = await window.monet.aseSelectOutput(`${stem}-pca-selected.extxyz`)
  if (!output) return
  const r = await runAse('mda', { action: 'subsample', filename, frames, output })
  if (!r.ok) return setStatus('The selected configurations could not be written: ' + (r.message || r.error))
  if (!pca) return
  pca.written = { path: r.filePath || output, frames }
  const link = $('pca-download')
  if (r.downloadURL) {
    link.href = r.downloadURL
    link.download = r.output || `${stem}-pca-selected.extxyz`
    link.classList.remove('hidden')
  }
  $('pca-activate').classList.remove('hidden')
  setStatus(`✓ ${r.n_frames} selected configurations written (frames ${r.first}…${r.last} of ${r.source_frames}; each comment line keeps source_frame=).`)
})

$('pca-activate').addEventListener('click', async () => {
  if (!pca?.written) return
  const { path, frames } = pca.written
  try {
    await activateTrajectory(path, { label: `PCA selection · ${frames.length} configurations`, frames })
    setStatus(`MONET now analyses and extracts the ${frames.length} selected configurations (↩ Full trajectory to go back).`)
  } catch (error) { setStatus('The selected configurations were written but could not be loaded: ' + error.message) }
})

// =============================================================================
// ── ASE: structure summary and coordination numbers ──────────────────────────
// =============================================================================

$('btn-run-structure').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  const frame = Number($('structure-frame').value)
  if (!Number.isInteger(frame) || frame < 0) return setStatus('Enter a frame number (0 = first).')
  const symprec = Number($('structure-symprec').value) || 1e-3
  const r = await runAse('structure', { action: 'ase_structure', filename, frame, symprec })
  const box = $('structure-result')
  box.replaceChildren()
  if (!r.ok) { updateAseControls(); return setStatus('Structure error: ' + (r.message || r.error)) }
  renderTable(box, { columns: ['Property', 'Value'], rows: r.summary }, { title: `Frame ${r.frame}` })
  renderTable(box, r.bonds, { title: 'Bonds per element pair' })
  renderTable(box, r.coordination, { title: 'Coordination numbers' })
  updateAseControls()
  setStatus(`Structure of frame ${r.frame} analysed with ASE.`)
})
$('clear-structure').addEventListener('click', () => {
  $('structure-result').replaceChildren()
  updateAseControls()
})

$('btn-run-coordination').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let indices
  try { indices = MonetASEModel.selectedIndices($('coordination-atoms').value, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const step = Number($('coordination-step').value) || 1
  const r = await runAse('coordination', { action: 'ase_coordination', filename, indices, frame_step: step })
  if (!r.ok) return setStatus('Coordination error: ' + (r.message || r.error))
  // Per-atom keys are element + (index + 1) in the analysed file: show MONET IDs.
  const name = key => {
    const match = /^([A-Za-z]+)(\d+)$/.exec(key)
    const atom = match && r.atomMapping.find(a => a.aseIndex === Number(match[2]) - 1)
    return atom ? `${atom.element} ${atom.monetId}` : key
  }
  charts.coordination.setData({
    title: 'Coordination numbers (ASE natural cutoffs)', source: charts.coordination.source, xLabel: 'Frame', yLabel: 'Coordination number', yMin: 0,
    labels: r.frame_indices.map(String), notes: [`Bond cutoff × ${r.bond_scale} covalent radii · frame step ${step}`],
    datasets: Object.entries(r.series).map(([key, data], k) => {
      const stats = MonetASEModel.seriesStats(data)
      return { label: `${name(key)} · mean ${fmt(stats.mean, 4)}`, data, colorIndex: k, dash: /mean of/.test(key) ? undefined : [4, 3] }
    })
  })
  setStatus('Coordination numbers computed.')
})

// =============================================================================
// ── Atom identity: MONET = ASE = MDAnalysis ──────────────────────────────────
// =============================================================================

let topologyRevision = 0
function resetTopology () {
  topologyRevision++
  $('topology-status').className = 'info-box'
  $('topology-status').textContent = aseState.analysisAtoms.length ? 'Atom identity not checked yet.' : 'Load a trajectory to compare MONET, ASE and MDAnalysis.'
  $('topology-table').replaceChildren()
}

// Compare MONET's atoms with what ASE and MDAnalysis read from the same file.
function compareTopology (atoms, info) {
  const problems = []
  const bad = new Set()
  const byIndex = []
  for (const atom of atoms) byIndex[atom.aseIndex] = atom
  if (info.n_atoms !== atoms.length) problems.push(`ASE reads ${info.n_atoms} atoms, MONET ${atoms.length}.`)
  const mda = info.mdanalysis
  if (mda && mda.index.length !== atoms.length) problems.push(`MDAnalysis builds ${mda.index.length} atoms, MONET ${atoms.length}.`)
  const n = Math.min(atoms.length, info.n_atoms, mda ? mda.index.length : Infinity)
  for (let i = 0; i < n; i++) {
    const atom = byIndex[i]
    const reasons = []
    if (!atom) { reasons.push('no MONET atom'); bad.add(i); problems.push(`File atom ${i} has no MONET ID.`); continue }
    if (info.symbols[i] !== atom.element) reasons.push(`ASE element ${info.symbols[i]}`)
    if (['x', 'y', 'z'].some((axis, j) => Math.abs(info.positions[i][j] - atom[axis]) > 1e-3)) reasons.push('ASE coordinates')
    if (mda) {
      if (mda.id[i] !== atom.monetId) reasons.push(`MDAnalysis id ${mda.id[i]}`)
      if (mda.element[i] !== atom.element) reasons.push(`MDAnalysis element ${mda.element[i]}`)
      if (['x', 'y', 'z'].some((axis, j) => Math.abs(mda.positions[i][j] - atom[axis]) > 2e-3)) reasons.push('MDAnalysis coordinates')
    }
    if (reasons.length) {
      bad.add(i)
      if (problems.length < 6) problems.push(`MONET ID ${atom.monetId}: ${reasons.join(', ')}.`)
    }
  }
  return { problems, bad, byIndex }
}

async function checkTopology ({ quiet = false } = {}) {
  const filename = extractedTrajPath()
  if (!filename || !aseState.available || !aseState.analysisAtoms.length) return
  const revision = ++topologyRevision
  const atoms = aseState.analysisAtoms
  $('topology-status').className = 'info-box'
  $('topology-status').textContent = 'Comparing MONET, ASE and MDAnalysis …'
  const command = { action: 'topology', filename, ...cellOptions(), atom_ids: [] }
  for (const atom of atoms) command.atom_ids[atom.aseIndex] = atom.monetId
  const scale = Number($('ase-bond-scale').value)
  if (scale >= 0.5 && scale <= 2) command.bond_scale = scale
  let info
  // Read-only check: it does not take the calculation lock, so analyses can start meanwhile.
  try { info = await window.monet.aseRun(command) } catch (error) { info = { ok: false, error: error.message } }
  if (revision !== topologyRevision) return
  const status = $('topology-status')
  if (!info?.ok) {
    status.classList.add('topology-bad')
    status.textContent = 'Atom identity could not be checked: ' + (info?.message || info?.error)
    return quiet || setStatus(status.textContent)
  }
  const { problems, bad, byIndex } = compareTopology(atoms, info)
  const mda = info.mdanalysis
  if (mda) {
    // Residue and molecule of every atom, as MDAnalysis sees them, in the MONET atom table.
    for (let i = 0; i < mda.index.length; i++) {
      const atom = byIndex[i]
      if (!atom) continue
      atom.residue = `${mda.resname[i]}${mda.resid[i]}`
      atom.molecule = mda.fragment[i] + 1
    }
    for (const row of $('ase-atom-body').rows) {
      const atom = atoms.find(a => String(a.monetId) === row.dataset.monetId)
      if (atom && row.cells.length >= 8) { row.cells[6].textContent = atom.residue; row.cells[7].textContent = atom.molecule }
    }
  }
  status.classList.add(problems.length ? 'topology-bad' : 'topology-ok')
  status.textContent = problems.length
    ? `✗ Atom identity mismatch: ${problems.join(' ')} Reload the trajectory (and its topology) before analysing it.`
    : `✓ ${atoms.length} atoms: MONET IDs, ASE indices${mda ? ' and MDAnalysis ids' : ''} refer to the same atoms (elements and first-frame coordinates agree)${info.n_frames ? `; ${info.n_frames} frames` : ''}.` +
      (mda ? ` MDAnalysis: ${mda.n_residues} residues, ${mda.n_fragments} molecules, ${mda.n_bonds} bonds (cutoff × ${command.bond_scale ?? 1.2}).` : ' MDAnalysis is not installed: only ASE was compared.')
  const rows = []
  for (let i = 0; i < info.n_atoms; i++) {
    const atom = byIndex[i]
    rows.push([atom?.monetId ?? '—', i, atom?.element ?? '—', info.symbols[i],
      ...(mda ? [mda.id[i], mda.name[i], mda.element[i], `${mda.resname[i]}${mda.resid[i]}`, mda.fragment[i] + 1, mda.mass[i]] : [])])
  }
  const table = $('topology-table')
  table.replaceChildren()
  renderTable(table, { columns: ['MONET ID', 'ASE index', 'MONET element', 'ASE element', ...(mda ? ['MDA id', 'MDA name', 'MDA element', 'Residue', 'Molecule', 'Mass (amu)'] : [])], rows },
    { title: 'Atom identity', mismatch: bad })
  if (problems.length) $('ase-atom-match').textContent = 'Atom identity mismatch — see MDAnalysis › Topology & consistency.'
  if (!quiet) setStatus(problems.length ? 'Atom identity mismatch found.' : 'Atom identity verified in MONET, ASE and MDAnalysis.')
}
$('btn-run-topology').addEventListener('click', () => checkTopology())

// =============================================================================
// ── Custom: fluctuations and trends of atoms, bonds, angles and dihedrals ────
// =============================================================================

var FLUCT_WIDTH = { atoms: 1, bonds: 2, angles: 3, dihedrals: 4 }
var fluct = null // { r, active, sort: { key, dir } }
const FS_TO_CM1 = 1e15 / 2.99792458e10

function updateFluctForm () {
  const quantity = $('fluct-quantity').value
  const groups = $('fluct-scope').value === 'groups'
  $('fluct-align-row').classList.toggle('hidden', quantity !== 'atoms')
  $('fluct-groups-row').classList.toggle('hidden', !groups)
  $('fluct-atoms-row').classList.toggle('hidden', groups)
  $('fluct-groups-label').textContent = quantity === 'atoms' ? 'Atoms — MONET IDs' : `Groups of ${FLUCT_WIDTH[quantity]} MONET IDs, in order`
  if ($('ase-selection-target').value === 'fluct') updateSelectionTarget()
}
for (const id of ['fluct-quantity', 'fluct-scope']) $(id).addEventListener('change', () => { updateFluctForm(); clearAnalysis('fluct', false) })

function fluctItemName (item, mapping) {
  const atoms = item.map(index => mapping.find(a => a.aseIndex === index))
  if (item.length === 1) return atoms[0] ? `${atoms[0].element}${atoms[0].monetId}` : `#${item[0]}`
  return atoms.map((atom, k) => atom ? `${atom.element}${atom.monetId}` : `#${item[k]}`).join('–')
}

// Columns of the statistics table: [key, header, value(stat) → number, digits].
function fluctColumns (r) {
  const unit = r.quantity === 'atoms' || r.quantity === 'bonds' ? 'Å' : '°'
  const perTime = r.dt ? `${unit}/ps` : `${unit}/frame`
  const slopeScale = r.dt ? 1000 : 1
  const spread = r.quantity === 'atoms' ? 'RMSF' : r.quantity === 'dihedrals' ? 'circular SD' : 'SD'
  const frequency = r.dt
    ? ['frequency', 'Dominant ν (cm⁻¹)', st => st.frequency * FS_TO_CM1, 4]
    : ['frequency', 'Dominant period (frames)', st => (st.frequency > 0 ? 1 / st.frequency : NaN), 4]
  return [
    ['mean', r.quantity === 'atoms' ? `Mean |Δr| (${unit})` : `Mean (${unit})`, st => st.mean, 5],
    ['std', `${spread} (${unit})`, st => (r.quantity === 'atoms' ? st.rmsf : st.std), 4],
    ['min', `Min (${unit})`, st => st.min, 5],
    ['max', `Max (${unit})`, st => st.max, 5],
    ['range', `5–95 % (${unit})`, st => st.p95 - st.p5, 4],
    ['slope', `Trend (${perTime})`, st => st.slope * slopeScale, 3],
    ['slope_error', '± error', st => st.slope_error * slopeScale, 2],
    ['r2', 'R²', st => st.r2, 3],
    ['drift', `Drift 2nd−1st half (${unit})`, st => st.drift, 3],
    ['block_sem', `Block SEM (${unit})`, st => st.block_sem, 2],
    frequency,
    ['frequency_share', 'Power share (%)', st => 100 * st.frequency_share, 3]
  ]
}

function fluctMetric (r, st) {
  const metric = $('fluct-metric').value
  const column = fluctColumns(r).find(([key]) => key === metric)
  const value = column[2](st)
  return ['slope', 'drift'].includes(metric) ? Math.abs(value) : value
}

function drawFluct () {
  if (!fluct) return
  const { r } = fluct
  const metric = $('fluct-metric')
  const metricLabel = metric.selectedOptions[0].textContent
  const column = fluctColumns(r).find(([key]) => key === metric.value)
  const values = r.statistics.map(st => fluctMetric(r, st))
  const names = r.items.map(item => fluctItemName(item, r.atomMapping))
  charts.fluct.setData({
    title: `${metricLabel} — ${r.quantity}`, source: charts.fluct.source, xLabel: r.quantity === 'atoms' ? 'Atom (MONET ID)' : 'Item (MONET IDs)',
    yLabel: column[1], labels: names, notes: [fluct.summary], yMin: values.every(v => !Number.isFinite(v) || v >= 0) ? 0 : undefined,
    datasets: [{ label: `${column[1]} of ${r.items.length} ${r.quantity}`, data: values.map(v => (Number.isFinite(v) ? v : null)), bars: true, colorIndex: 0 }]
  })
  // Colour map on the molecule.
  const finite = values.filter(Number.isFinite)
  if (!$('fluct-map').checked || !finite.length) return aseViewer.setOverlay(null)
  const low = Math.min(...finite), high = Math.max(...finite)
  const name = $('fluct-colormap').value
  const color = value => {
    const [red, green, blue] = MonetLineChart.colormap(name, high > low ? (value - low) / (high - low) : 0.5)
    return `rgb(${red},${green},${blue})`
  }
  const monetId = index => r.atomMapping.find(a => a.aseIndex === index)?.monetId
  const overlay = { dimAtoms: true, atomColors: new Map(), segments: [], legend: { title: `${column[1]} · ${r.quantity}`, min: low, max: high, colors: Array.from({ length: 9 }, (_, k) => color(low + (k / 8) * (high - low))), format: v => fmt(v, 3) } }
  r.items.forEach((item, k) => {
    if (!Number.isFinite(values[k])) return
    if (r.quantity === 'atoms') overlay.atomColors.set(monetId(item[0]), color(values[k]))
    else overlay.segments.push({ ids: item.map(monetId), color: color(values[k]) })
  })
  // Draw the largest values last, on top.
  aseViewer.setOverlay(overlay)
}
for (const id of ['fluct-metric', 'fluct-colormap', 'fluct-map']) $(id).addEventListener('change', () => { drawFluct(); renderFluctTable() })

function renderFluctTable () {
  const box = $('fluct-table')
  box.replaceChildren()
  if (!fluct) return
  const { r, sort } = fluct
  const columns = fluctColumns(r)
  const order = r.items.map((_, k) => k)
  if (sort.key) {
    const column = columns.find(([key]) => key === sort.key)
    const value = k => (sort.key === 'item' ? k : column[2](r.statistics[k]))
    order.sort((a, b) => {
      const va = value(a), vb = value(b)
      if (!Number.isFinite(va)) return 1
      if (!Number.isFinite(vb)) return -1
      return sort.dir * (va - vb)
    })
  }
  const table = document.createElement('table')
  table.className = 'atom-table'
  const head = table.createTHead().insertRow()
  for (const [key, label] of [['item', r.quantity === 'atoms' ? 'Atom' : 'Item (MONET IDs)'], ...columns, ['trend', 'Trend?']]) {
    const th = document.createElement('th')
    th.textContent = label + (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '')
    th.dataset.key = key
    if (key !== 'trend') {
      th.title = 'Sort'
      th.addEventListener('click', () => {
        fluct.sort = { key, dir: sort.key === key ? -sort.dir : key === 'item' ? 1 : -1 }
        renderFluctTable()
      })
    }
    head.appendChild(th)
  }
  const body = table.createTBody()
  for (const k of order.slice(0, 2000)) {
    const st = r.statistics[k]
    const row = body.insertRow()
    row.dataset.index = k
    if (fluct.active === k) row.classList.add('active')
    row.insertCell().textContent = fluctItemName(r.items[k], r.atomMapping)
    for (const [, , value, digits] of columns) {
      const v = value(st)
      row.insertCell().textContent = Number.isFinite(v) ? fmt(v, digits) : '—'
    }
    const flag = row.insertCell()
    flag.textContent = st.trend ? 'yes' : 'no'
    if (st.trend) flag.className = 'trend-flag'
    row.addEventListener('click', () => showFluctItem(k))
  }
  box.appendChild(table)
  if (order.length > 2000) {
    const note = document.createElement('p')
    note.className = 'panel-desc'
    note.textContent = `First 2000 of ${order.length} rows shown; the statistics CSV contains all of them.`
    box.appendChild(note)
  }
}

async function showFluctItem (k) {
  if (!fluct) return
  const { r } = fluct
  fluct.active = k
  renderFluctTable()
  const item = r.items[k]
  syncAsePicks(item.map(index => r.atomMapping.find(a => a.aseIndex === index)?.monetId).filter(id => id !== undefined))
  let data = r.series?.[k]
  if (!data) {
    const current = fluct
    const one = await runAse('fluctseries', { ...fluct.command, groups: [item] })
    if (current !== fluct) return
    if (!one.ok) return setStatus('Fluctuation series error: ' + (one.message || one.error))
    data = one.series[0]
  }
  const st = r.statistics[k]
  const period = r.quantity === 'dihedrals' ? 360 : null
  // Dihedrals are shown around their circular mean, so the trace stays continuous.
  const shown = period ? data.map(v => st.mean + ((((v - st.mean + 180) % 360) + 360) % 360) - 180) : data
  const n = shown.length
  const xs = shown.map((_, i) => i)
  const mx = (n - 1) / 2, my = shown.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0
  shown.forEach((v, i) => { sxy += (i - mx) * (v - my); sxx += (i - mx) ** 2 })
  const slope = sxx ? sxy / sxx : 0
  const unit = r.quantity === 'atoms' || r.quantity === 'bonds' ? 'Å' : '°'
  const centre = st.mean
  const spread = st.std
  const name = fluctItemName(item, r.atomMapping)
  const columns = fluctColumns(r)
  const describe = key => { const c = columns.find(([k2]) => k2 === key); const v = c[2](st); return `${c[1]} ${Number.isFinite(v) ? fmt(v, c[3]) : '—'}` }
  charts.fluctseries.setData({
    title: r.quantity === 'atoms' ? `Displacement of ${name} from its average position` : `${name} along the trajectory`,
    source: charts.fluct.source, xLabel: 'Frame', yLabel: r.quantity === 'atoms' ? `|Δr| (${unit})` : `${r.quantity.replace(/s$/, '')} (${unit})`,
    labels: r.frame_indices.map(String),
    notes: [[describe('std'), describe('slope'), describe('frequency'), st.trend ? 'significant trend' : 'no significant trend'].join(' · ')],
    datasets: [
      { label: name, data: shown, colorIndex: 0 },
      { label: `mean ${fmt(centre, 5)} ${unit}`, data: shown.map(() => centre), colorIndex: 2, dash: [6, 4] },
      { label: `± SD ${fmt(spread, 4)} ${unit}`, data: shown.map(() => centre + spread), colorIndex: 3, dash: [2, 3] },
      { label: '', data: shown.map(() => centre - spread), colorIndex: 3, dash: [2, 3] },
      { label: `linear trend (${describe('slope')})`, data: xs.map(i => my + slope * (i - mx)), colorIndex: 1 }
    ]
  })
  setStatus(`${name}: time series shown below the table and highlighted in the viewer.`)
}

$('btn-run-fluct').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  const quantity = $('fluct-quantity').value
  const command = { action: 'fluctuations', filename, quantity, frame_step: Number($('fluct-step').value) || 1 }
  try {
    if ($('fluct-scope').value === 'groups') command.groups = MonetASEModel.groupsFromIds($('fluct-groups').value, FLUCT_WIDTH[quantity], aseState.analysisAtoms)
    else {
      const indices = MonetASEModel.selectedIndices($('fluct-atoms').value, aseState.analysisAtoms)
      if (indices) command.indices = indices
    }
  } catch (error) { return setStatus(error.message) }
  if (quantity === 'atoms') command.align = $('fluct-align').checked
  const axis = timeAxis()
  if (axis) command.dt = axis.dt
  clearAnalysis('fluct', false)
  const r = await runAse('fluct', command)
  if (!r.ok) return setStatus('Fluctuation error: ' + (r.message || r.error))
  const spreads = r.statistics.map(st => (quantity === 'atoms' ? st.rmsf : st.std))
  let top = 0
  spreads.forEach((v, k) => { if (v > spreads[top]) top = k })
  const trends = r.statistics.filter(st => st.trend).length
  const unit = quantity === 'atoms' || quantity === 'bonds' ? 'Å' : '°'
  // Spectral resolution of the dominant frequency: one Fourier bin.
  const resolution = r.dt ? ` · ν resolution ${fmt(FS_TO_CM1 / (r.n_frames * r.dt), 3)} cm⁻¹` : ''
  const summary = `${r.items.length} ${quantity} · ${r.n_frames} frames${r.dt ? ` (Δt ${fmt(r.dt, 4)} fs)` : ''}${resolution} · largest ${quantity === 'atoms' ? 'RMSF' : 'SD'}: ${fluctItemName(r.items[top], r.atomMapping)} (${fmt(spreads[top], 4)} ${unit}) · ${trends} with a significant trend${r.periodic ? ' · minimum image' : ''}`
  delete command.groups
  if ($('fluct-scope').value === 'groups') command.groups = r.items
  fluct = { r, command, active: null, sort: { key: null, dir: -1 }, summary }
  $('fluct-summary').textContent = summary + (r.series ? '' : ' · time series are loaded when a row is clicked')
  $('fluct-summary').classList.remove('hidden')
  drawFluct()
  renderFluctTable()
  updatePlotControls()
  setStatus(`Fluctuations of ${r.items.length} ${quantity} computed.`)
})

$('fluct-table-csv').addEventListener('click', () => {
  if (!fluct) return
  const { r } = fluct
  const columns = fluctColumns(r)
  const cell = value => (/[",\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : value)
  const lines = [`# ${fluct.summary}`, ['item', 'monet_ids', ...columns.map(c => c[1]), 'trend'].map(cell).join(',')]
  r.items.forEach((item, k) => {
    const ids = item.map(index => r.atomMapping.find(a => a.aseIndex === index)?.monetId).join(' ')
    lines.push([fluctItemName(item, r.atomMapping), ids, ...columns.map(c => { const v = c[2](r.statistics[k]); return Number.isFinite(v) ? v : '' }), r.statistics[k].trend].map(cell).join(','))
  })
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `MONET-fluctuations-${r.quantity}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  setStatus('Statistics CSV download started.')
})

// =============================================================================
// ── ASE: unwrap trajectory ───────────────────────────────────────────────────
// =============================================================================

$('btn-unwrap').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load a trajectory first.')
  const stem = filename.split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
  const output = await window.monet.aseSelectOutput(`${stem}-unwrapped.extxyz`)
  if (!output) return
  $('download-unwrapped').classList.add('hidden')
  const r = await runAse('unwrap', { action: 'unwrap', filename, output })
  if (!r.ok) return setStatus('Unwrap error: ' + (r.message || r.error))
  if (r.downloadURL) {
    $('download-unwrapped').href = r.downloadURL
    $('download-unwrapped').download = r.output || `${stem}-unwrapped.extxyz`
    $('download-unwrapped').classList.remove('hidden')
  }
  setStatus(`Unwrapped ${r.n_frames} frames${r.warning ? ` — ${r.warning}` : ''}.`)
})

// =============================================================================
// ── ASE: Format conversion ────────────────────────────────────────────────────
// =============================================================================

$('btn-conv-input').addEventListener('click', async () => {
  let fp
  try { fp = await window.monet.selectFile() }
  catch (error) { return setStatus('Could not open conversion input: ' + error.message) }
  if (!fp) return
  aseState.convInput = fp
  $('download-converted').classList.add('hidden')
  $('conv-input-path').textContent = fp
  updateConvBtn()
})

$('btn-conv-output').addEventListener('click', async () => {
  const fmt  = $('conv-format').value
  const ext = ({ vasp: 'vasp', 'gaussian-in': 'gjf', 'espresso-in': 'pwi', 'lammps-data': 'data', aims: 'in', turbomole: 'coord', dftb: 'gen' })[fmt] || fmt || 'xyz'
  const defName = aseState.convInput
    ? aseState.convInput.replace(/\.[^.]+$/, '') + '_converted.' + ext
    : 'converted.' + ext
  const fp = await window.monet.aseSelectOutput(defName)
  if (!fp) return
  aseState.convOutput = fp
  $('conv-output-path').textContent = fp
  updateConvBtn()
})

$('conv-format').addEventListener('change', () => {
  aseState.convOutput = null
  $('conv-output-path').textContent = 'Choose an output filename for this format'
  $('download-converted').classList.add('hidden')
  updateConvBtn()
})

function updateConvBtn () {
  $('btn-run-conv').disabled = !aseState.available || aseState.busy || !(aseState.convInput && aseState.convOutput)
}

$('btn-run-conv').addEventListener('click', async () => {
  const fmt = $('conv-format').value || undefined
  $('download-converted').classList.add('hidden')
  const r = await runAse('conv', {
    action: 'convert',
    input:  aseState.convInput,
    output: aseState.convOutput,
    format: fmt,
    first_frame_only: $('conv-first-frame').checked
  })

  if (!r.ok) {
    setStatus('Conversion error: ' + (r.message || r.error))
    $('conv-result').textContent = '✗ ' + (r.message || r.error)
    $('conv-result').classList.remove('hidden')
    return
  }

  hideAseProgress('conv-prog-row')
  $('conv-result').textContent = `✓ ${r.n_frames} frames written to ${r.output}`
  $('conv-result').classList.remove('hidden')
  if (r.downloadURL) {
    $('download-converted').href = r.downloadURL
    $('download-converted').download = r.output
    $('download-converted').classList.remove('hidden')
  }
  setStatus(`Converted: ${r.output}`)
})

// =============================================================================
// ── Init ─────────────────────────────────────────────────────────────────────
// =============================================================================

window.addEventListener('load', () => {
  resizeCanvas()
  Object.values(charts).forEach(chart => chart.clear())
  resizeAseViewer()
  updateCellPreset()
  updateSelectionTarget()
  updateSampledCount()
  updateFormatUI()
  updateQmUI()
  updateTimeInfo()
  updateMdaForm()
  updateFluctForm()
  $$('.ase-stab').forEach(b => b.classList.toggle('group-hidden', b.dataset.group !== activeGroup))
  $('module-intro').textContent = ANALYSIS_GROUPS[activeGroup]
  if (window.monet.isBrowser) {
    state.outputDir = 'MONET-results'
    $('output-dir-text').textContent = 'Download results as a ZIP file'
    $('btn-output-dir').classList.add('hidden')
    updateQmUI()
    setStatus('Browser mode · Select an XYZ file to begin')
    $('btn-conv-output').textContent = 'Set download name'
    $('conv-format').value = 'extxyz'
    $('conv-format').querySelector('option[value=""]').disabled = true
  }
  checkAseStatus().catch(error => setStatus('ASE check failed: ' + error.message))
})

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
// Form of a registered analysis from a logged call: mda_run names a built-in MDAnalysis analysis,
// run_analysis gives the full id ("<engine>.<name>").
function fillRegistry (kind, a) {
  const id = String(a.analysis ?? '').includes('.') ? a.analysis : `mdanalysis.${a.analysis}`
  if (!registrySpec(id)) throw new Error(`Analysis "${a.analysis}" is not available (is its plugin installed?).`)
  $(`${kind}-analysis`).value = id
  $(`${kind}-analysis`).dispatchEvent(new Event('change'))
  setField(`${kind}-step`, a.frame_step)
  for (const [key, value] of Object.entries(a.params || {})) {
    const input = $(`${kind}-p-${key}`)
    if (!input) throw new Error(`${a.analysis} has no parameter "${key}".`)
    setField(`${kind}-p-${key}`, ['atoms', 'groups', 'bool'].includes(input.dataset.type) ? value : Array.isArray(value) ? value.join('\n') : value)
  }
}
function fillMda (a) { fillRegistry('mda', a) }
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

// run_analysis goes to the panel of its engine: MDAnalysis › Analyses or a "More analyses" tab.
function registryConsoleForm (args) {
  const engine = String(args.analysis ?? '').split('.')[0]
  const kind = engine === 'mdanalysis' ? 'mda' : Object.keys(REGISTRY_PANELS).find(k => REGISTRY_PANELS[k] === engine) || 'extcustom'
  return { tab: kind, button: `btn-run-${kind}`, fill: a => fillRegistry(kind, a) }
}

function revealPanel (tab) {
  const button = document.querySelector(`.ase-stab[data-stab="${tab}"]`)
  if (!button) return
  lastSubtab[button.dataset.group] = tab
  showViewerTab(button.dataset.group)
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
  const form = call.name === 'run_analysis' ? registryConsoleForm(call.args) : CONSOLE_FORMS[call.name]
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
  if (aseState.busy) return setStatus('Another calculation is running: finish or cancel it before opening a session.')
  const r = await window.monet.sessionOpen?.()
  if (!r) return
  if (!r.ok) return setStatus('Could not open the session: ' + (r.error || r.message))
  let restored
  try { restored = MonetProvenance.fromJSON(r.session) } catch (error) { return setStatus('Could not open the session: ' + error.message) }
  // Fork: an opened session keeps its own autosave file, and the trajectory-matching load below
  // resumes writing to this in-memory copy, not to the file it was opened from. Without this, once
  // the trajectory is attached and autosave picks back up, it would overwrite the original file
  // with whatever the newer, possibly-diverged in-page history has become.
  const openedCreated = restored.data.created
  restored.data.created = new Date().toISOString()
  restored.data.forked_from = openedCreated
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
  historyDo(P => P.setEnvironment(monetHistory.env))
  onHistoryChange()
}

renderHistory()

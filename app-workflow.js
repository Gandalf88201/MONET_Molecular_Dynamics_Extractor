'use strict'

// MONET page script, part 2 of 8: Workflow steps 1–6: file input and import, sampling, atom selection, options and QM inputs, extraction, results.
// The app-*.js files are classic scripts sharing one global scope; index.html loads them in this order.

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
  setViewerEmpty(true)
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
  setViewerEmpty(false)

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
  setViewerEmpty(true)
  viewer.loadAtoms([])
  $('atom-table-body').innerHTML = ''
  $('log-box').innerHTML         = ''

  goTo(1)
  setStatus('Ready')
})

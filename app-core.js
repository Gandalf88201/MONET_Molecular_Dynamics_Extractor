'use strict'

// MONET page script, part 1 of 8: App state, analysis-history core, DOM helpers, workflow navigation and the main 3D viewer.
// The app-*.js files are classic scripts sharing one global scope; index.html loads them in this order.

// =============================================================================
// ── Molecular Viewer ─────────────────────────────────────────────────────────
// =============================================================================

const { MolecularViewer, STYLES: VIEW_STYLES } = MonetViewer

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
  syncTabAria()
}

// Screen readers learn the selected module and analysis from aria-selected, set with the active class.
function syncTabAria () {
  for (const tab of document.querySelectorAll('[role="tab"]')) tab.setAttribute('aria-selected', String(tab.classList.contains('active')))
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

// Without a trajectory the 3D view shows only "Load a trajectory file to begin": the title,
// style menu and hints appear with the first frame. The canvas is resized to the new space.
function setViewerEmpty (empty) {
  $('viewer-overlay').classList.toggle('hidden', !empty)
  $('viewer-header').classList.toggle('hidden', empty)
  resizeCanvas()
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

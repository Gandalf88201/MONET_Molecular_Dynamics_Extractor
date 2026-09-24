'use strict'

// MONET page script, part 7 of 8: Analysis history drawer, console (a call fills a panel and runs it) and sessions (save, export, open, resume).
// The app-*.js files are classic scripts sharing one global scope; index.html loads them in this order.

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

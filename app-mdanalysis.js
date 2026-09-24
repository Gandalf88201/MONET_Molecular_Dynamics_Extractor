'use strict'

// MONET page script, part 5 of 8: MDAnalysis module and registered analyses (monet_registry.py): formats, selections, generic forms and plots, PCA.
// The app-*.js files are classic scripts sharing one global scope; index.html loads them in this order.

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
  const pattern = $('sel-pattern').value.trim().split(/[\s,-]+/).filter(Boolean)
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

// A failed analysis is shown in its panel: the reason in one line, a Python traceback folded below it.
function showAnalysisError (kind, label, message) {
  const box = $(`${kind}-error`)
  const text = String(message || 'Unknown error').trim()
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const traceback = /^Traceback \(most recent call last\)/.test(text)
  const reason = traceback ? lines[lines.length - 1] : text
  const plugin = traceback && (text.match(/plugins[\\/][\w.-]+\.py/g) || []).pop()
  box.replaceChildren()
  const title = document.createElement('strong')
  title.textContent = `${label} failed: `
  box.append(title, reason)
  if (plugin) box.append(document.createElement('br'), `The error comes from the plugin ${plugin.replace(/\\/g, '/')}; check that it matches this MONET version.`)
  if (traceback) {
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = 'Python traceback'
    const pre = document.createElement('pre')
    pre.textContent = text
    details.append(summary, pre)
    box.append(details)
  }
  box.classList.remove('hidden')
  setStatus(`${label} failed: ${reason}`)
}

$('btn-run-mda').addEventListener('click', async () => {
  const spec = registrySpec($('mda-analysis').value)
  let command
  try { command = await registryCommand(spec, 'mda') } catch (error) { return setStatus(error.message) }
  if (!command) return
  clearAnalysis('mda', false)
  const r = await runAse('mda', command)
  if (!r.ok) return showAnalysisError('mda', `MDAnalysis ${spec.label}`, r.message || r.error)
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
    if (!r.ok) return showAnalysisError(kind, spec.label, r.message || r.error)
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

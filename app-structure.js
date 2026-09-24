'use strict'

// MONET page script, part 6 of 8: ASE structure summary and coordination, atom identity check, fluctuations and trends, unwrap and format conversion.
// The app-*.js files are classic scripts sharing one global scope; index.html loads them in this order.

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
// sqrt of the χ²(3) quantile: semi-axes, in standard deviations, of the ellipsoid holding that probability.
const FLUCT_PROBABILITY = { 50: 1.5382, 90: 2.5003, 99: 3.3682 }

function updateFluctForm () {
  const quantity = $('fluct-quantity').value
  const groups = $('fluct-scope').value === 'groups'
  $('fluct-align-row').classList.toggle('hidden', quantity !== 'atoms')
  $('fluct-ellipsoid-row').classList.toggle('hidden', quantity !== 'atoms')
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
  // Colour map and displacement ellipsoids on the molecule.
  const finite = values.filter(Number.isFinite)
  const mapped = $('fluct-map').checked && finite.length > 0
  const ellipsoids = r.quantity === 'atoms' && $('fluct-ellipsoids').checked && r.statistics.some(st => st.u)
  if (!mapped && !ellipsoids) return aseViewer.setOverlay(null)
  const low = Math.min(...finite), high = Math.max(...finite)
  const name = $('fluct-colormap').value
  const color = value => {
    const [red, green, blue] = MonetLineChart.colormap(name, high > low ? (value - low) / (high - low) : 0.5)
    return `rgb(${red},${green},${blue})`
  }
  const monetId = index => r.atomMapping.find(a => a.aseIndex === index)?.monetId
  const overlay = { dimAtoms: mapped, atomColors: new Map(), segments: [] }
  if (mapped) {
    overlay.legend = { title: `${column[1]} · ${r.quantity}`, min: low, max: high, colors: Array.from({ length: 9 }, (_, k) => color(low + (k / 8) * (high - low))), format: v => fmt(v, 3) }
    r.items.forEach((item, k) => {
      if (!Number.isFinite(values[k])) return
      if (r.quantity === 'atoms') overlay.atomColors.set(monetId(item[0]), color(values[k]))
      else overlay.segments.push({ ids: item.map(monetId), color: color(values[k]) })
    })
  }
  if (ellipsoids) {
    const probability = $('fluct-ellipsoid-prob').value
    const magnify = Math.min(50, Math.max(1, Number($('fluct-ellipsoid-scale').value) || 1))
    // Ellipsoid of a 3D Gaussian enclosing the probability: sqrt of the χ²(3) quantile, in standard deviations.
    overlay.ellipsoidScale = FLUCT_PROBABILITY[probability] * magnify
    overlay.ellipsoids = r.items.map((item, k) => ({
      id: monetId(item[0]), u: r.statistics[k].u, color: mapped && Number.isFinite(values[k]) ? color(values[k]) : null
    })).filter(e => e.id !== undefined && e.u?.every(Number.isFinite))
    const note = `ellipsoids ${probability} %${magnify > 1 ? ` ×${fmt(magnify, 3)}` : ''}`
    if (overlay.legend) overlay.legend.title += ` · ${note}`
    else overlay.caption = `Displacement ${note}`
  }
  aseViewer.setOverlay(overlay)
}
for (const id of ['fluct-metric', 'fluct-colormap', 'fluct-map']) $(id).addEventListener('change', () => { drawFluct(); renderFluctTable() })
for (const id of ['fluct-ellipsoids', 'fluct-ellipsoid-prob', 'fluct-ellipsoid-scale']) $(id).addEventListener('change', () => drawFluct())

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
  if (!r.ok) {
    // Shown next to the plot too: the status bar alone is easily missed.
    const message = 'Fluctuation error: ' + (r.message || r.error)
    $('fluct-summary').textContent = message
    $('fluct-summary').classList.remove('hidden')
    return setStatus(message)
  }
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
  // Atoms also carry their displacement tensor (Å², Cartesian axes of the first frame).
  const tensor = r.statistics.some(st => st.u) ? ['U11 (Å²)', 'U22 (Å²)', 'U33 (Å²)', 'U12 (Å²)', 'U13 (Å²)', 'U23 (Å²)'] : []
  const lines = [`# ${fluct.summary}`, ['item', 'monet_ids', ...columns.map(c => c[1]), 'trend', ...tensor].map(cell).join(',')]
  r.items.forEach((item, k) => {
    const ids = item.map(index => r.atomMapping.find(a => a.aseIndex === index)?.monetId).join(' ')
    const u = tensor.map((_, i) => (Number.isFinite(r.statistics[k].u?.[i]) ? r.statistics[k].u[i] : ''))
    lines.push([fluctItemName(item, r.atomMapping), ids, ...columns.map(c => { const v = c[2](r.statistics[k]); return Number.isFinite(v) ? v : '' }), r.statistics[k].trend, ...u].map(cell).join(','))
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

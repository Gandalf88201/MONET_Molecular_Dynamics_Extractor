'use strict'

// MONET page script, part 4 of 8: Geometry and dynamics analyses: RMSD, pair distances, bonds, angles, dihedrals, time axis, RMSD matrix, RDF, MSD, VDOS, autocorrelation.
// The app-*.js files are classic scripts sharing one global scope; index.html loads them in this order.

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

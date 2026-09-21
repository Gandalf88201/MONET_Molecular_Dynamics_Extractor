'use strict'

// Methods report (Markdown, English) built from a MONET session. It contains:
//   - the software, with citations;
//   - the input checksums;
//   - the steps in order, with their key numbers;
//   - the reporting checklist of the workflow document (§12), filled with the logged values.
// It is template text only, so the same session always gives the same report.
;(function (root) {
  const node = typeof module === 'object' && module.exports
  const C = node ? require('./console.js') : root.MonetConsole
  const P = node ? require('./provenance.js') : root.MonetProvenance
  const SOFTWARE = [
    ['python', 'Python', null],
    ['ase', 'ASE', 'A. H. Larsen et al., J. Phys.: Condens. Matter 29, 273002 (2017), doi:10.1088/1361-648X/aa680e'],
    ['mdanalysis', 'MDAnalysis', 'N. Michaud-Agrawal et al., J. Comput. Chem. 32, 2319 (2011), doi:10.1002/jcc.21787; R. J. Gowers et al., Proc. 15th Python in Science Conf., 98 (2016), doi:10.25080/Majora-629e541a-00e'],
    ['numpy', 'NumPy', 'C. R. Harris et al., Nature 585, 357 (2020), doi:10.1038/s41586-020-2649-2'],
    ['scipy', 'SciPy', 'P. Virtanen et al., Nat. Methods 17, 261 (2020), doi:10.1038/s41592-019-0686-2']
  ]
  const LABELS = {
    tau_fit: 'τ (fit, fs)', tau_fit_error: 'τ error (fs)', tau_int: 'τ_int (fs)', tau_int_error: 'τ_int error (fs)', tau_int_method: 'τ_int estimator',
    n_effective: 'N_eff', n_frames: 'frames', 'blocking.plateau_sem': 'block-averaged SEM', 'blocking.g': 'g (blocking)',
    t0_frame: 't₀ (frame)', t0_time: 't₀ (fs)', g_t0: 'g after t₀', n_effective_t0: 'N_eff after t₀', n_effective_full: 'N_eff (whole run)',
    'fits.selection.D_cm2_s': 'D (cm²/s)', 'fits.selection.r2': 'R² of the MSD fit', fit_start: 'fit start (fs)', fit_end: 'fit end (fs)',
    nyquist_cm: 'Nyquist limit (cm⁻¹)', resolution_cm: 'resolution (cm⁻¹)', 'peak:wavenumber': 'highest peak (cm⁻¹)', 'peak:r': 'first maximum of g(r) (Å)',
    rmax: 'r_max (Å)', 'mean:rmsd': 'mean RMSD (Å)', 'max:rmsd': 'max RMSD (Å)', 'mean:offdiagonal': 'mean pairwise RMSD (Å)', reference_index: 'reference frame',
    stride: 'stride (frames)', start: 'first frame', source_frames: 'frames in the source', totalFrames: 'frames read', sampledFrames: 'configurations extracted'
  }
  const number = v => (typeof v === 'number' ? String(Number(v.toPrecision(6))) : v === null || v === undefined ? 'n/a' : String(v))
  const label = key => LABELS[key] || key.replace(/^(mean|circmean):/, (_, tag) => (tag === 'mean' ? 'mean of ' : 'circular mean of '))
  const resultText = result => Object.entries(result || {}).map(([key, v]) => `${label(key)} = ${number(v)}`).join('; ')
  function stepText (step) {
    if (step.call) return step.call
    const args = step.params && Object.keys(step.params).length ? C.formatArgs(step.params) : ''
    return `${step.kind}${step.action ? ' ' + step.action : ''}${args ? ` (${args})` : ''}`
  }

  const done = (data, test) => data.steps.filter(step => step.status === 'ok' && test(step))
  const calls = steps => (steps.length ? steps.map(s => `${s.call || s.action} (#${s.id})`).join('; ') : null)
  // The reporting checklist of the workflow document (§12); each filler returns text or null.
  const CHECKLIST = [
    ['Engine, level of theory (functional, basis or cutoff, pseudopotentials) or force field, and the ensemble with its thermostat or barostat and coupling constants', () => null],
    ['Time step, saving interval, total length, and the discarded equilibration with the criterion used', data => {
      const parts = []
      const time = done(data, s => s.kind === 'time').pop()
      if (time) parts.push(`${number(time.params.dt)} fs between saved frames (${number(time.params.timestep)} ${time.params.unit} × ${time.params.steps_per_frame}, #${time.id})`)
      for (const source of data.sources.filter(s => !s.parent)) parts.push(`${source.name}: ${source.frames ?? 'n/a'} frames`)
      for (const s of done(data, s => s.action === 'equilibration')) parts.push(`equilibration t₀ = ${number(s.result.t0_time)} fs (frame ${number(s.result.t0_frame)}, maximum N_eff, #${s.id})`)
      return parts.length ? parts.join('; ') : null
    }],
    ['Energy drift, and for CPMD the fictitious mass with evidence of adiabaticity', () => null],
    ['Observables used for the ACF; τ (the fit model and window, with its error) and τ_int (with the truncation rule); T/τ', data => {
      const steps = done(data, s => s.action === 'acf')
      return steps.length ? steps.map(s => `${s.call || 'acf'} → τ = ${number(s.result.tau_fit)} ± ${number(s.result.tau_fit_error)} fs, τ_int = ${number(s.result.tau_int)} ± ${number(s.result.tau_int_error)} fs (${s.result.tau_int_method ?? s.params.tau_int_method ?? 'n/a'}) (#${s.id})`).join('; ') : null
    }],
    ['Stride and the resulting number of configurations; g of the subsample', data => {
      const steps = done(data, s => s.action === 'subsample')
      return steps.length ? steps.map(s => `stride ${number(s.result.stride)} from frame ${number(s.result.start)} → ${number(s.result.n_frames)} configurations (#${s.id})`).join('; ') : null
    }],
    ['RMSD reference and atom subset; the alignment method', data => calls(done(data, s => s.action === 'rmsd' || s.action === 'rmsd_matrix'))],
    ['Clustering method and cutoff; cluster populations with errors', () => null],
    ['RDF bin width, r_max, and the frames used; H-bond criterion', data => calls(done(data, s => s.action === 'rdf' || (s.action === 'mda_run' && ['hbonds', 'interrdf'].includes(s.params.analysis))))],
    ['MSD fitting window, the finite-size correction applied or not, and the unwrapping method', data => {
      const steps = done(data, s => s.action === 'msd')
      return steps.length ? steps.map(s => `fit ${number(s.result.fit_start)}–${number(s.result.fit_end)} fs, D = ${number(s.result['fits.selection.D_cm2_s'])} cm²/s, no finite-size correction (#${s.id})`).join('; ') : null
    }],
    ['VDOS: the saving interval, window and smoothing', data => calls(done(data, s => s.action === 'vdos'))],
    ['How every error bar was computed; replicas, if any', data => {
      const steps = done(data, s => s.action === 'acf' && s.result['blocking.plateau_sem'] != null)
      return steps.length ? steps.map(s => `block averaging (Flyvbjerg–Petersen), SEM = ${number(s.result['blocking.plateau_sem'])} (#${s.id}); ACF standard errors use N_eff = ${number(s.result.n_effective)}`).join('; ') : null
    }],
    ['Software with version numbers and citations', () => 'see Software above']
  ]

  function methodsReport (data, { finalOnly = false } = {}) {
    const session = P.fromJSON(data)
    const out = ['# Methods: MONET analysis session', '', `Session created ${data.created}, last change ${data.updated}. Schema ${data.schema}.`, '']
    const pauses = data.steps.filter(s => s.kind === 'pause').length
    if (pauses) out.push(`> **Warning:** the history was paused ${pauses} time${pauses > 1 ? 's' : ''} in this session. Steps taken while it was paused are not recorded, so this report and replay.py may be incomplete.`, '')
    out.push('## Software', '', `- MONET ${data.monet_version || 'n/a'} (MONET, Zenodo concept DOI 10.5281/zenodo.22816521)`)
    for (const [key, name, citation] of SOFTWARE) {
      const version = data.environment && data.environment[key]
      if (version) out.push(`- ${name} ${version}${citation ? ` (${citation})` : ''}`)
    }
    out.push('', '## Input data', '', '| Source | File | Size (bytes) | SHA-256 | Format | Frames | Atoms | Origin |', '| --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const s of data.sources) {
      out.push(`| ${s.id} | ${s.name ?? 'n/a'} | ${s.size ?? 'n/a'} | ${s.sha256 ?? 'not recorded'} | ${s.format ?? 'n/a'} | ${s.frames ?? 'n/a'} | ${s.atoms ?? 'n/a'} | ${s.parent ? session.lineage(s.id) : 'loaded'} |`)
    }
    const listed = data.steps.filter(s => s.status === 'ok' && !['pause', 'resume', 'clear', 'logging_error'].includes(s.kind) && (!finalOnly || s.final))
    const ordered = [...listed.filter(s => s.final), ...listed.filter(s => !s.final)]
    out.push('', finalOnly ? '## Analysis steps (marked final)' : '## Analysis steps', '')
    if (!ordered.length) out.push('No steps recorded.')
    ordered.forEach((s, i) => {
      out.push(`${i + 1}. **#${s.id} ${s.action || s.kind}**${s.source ? ` on ${s.source}` : ''}${s.final ? ' ☆ final' : ''}${s.rerun_of ? ` (re-run of #${s.rerun_of})` : ''}: \`${stepText(s)}\``)
      const text = resultText(s.result)
      if (text) out.push(`   Results: ${text}.`)
      if (s.note) out.push(`   Note: ${s.note}`)
    })
    out.push('', '## Reporting checklist', '', 'Items MONET did not record are left for you to fill in.', '')
    for (const [item, fill] of CHECKLIST) {
      const value = fill(data)
      out.push(`- [${value ? 'x' : ' '}] ${item}: ${value || 'not recorded'}`)
    }
    out.push('', '## Gaps', '')
    const gaps = []
    let pausedAt = null
    for (const s of data.steps) {
      if (s.kind === 'pause') pausedAt = s
      if (s.kind === 'resume' && pausedAt) { gaps.push(`- History paused ${pausedAt.time} → resumed ${s.time} (#${pausedAt.id}–#${s.id}).`); pausedAt = null }
      if (s.kind === 'logging_error') gaps.push(`- #${s.id} a step could not be logged: ${String(s.error).replace(/\.$/, '')}.`)
      if (s.status === 'cleared') gaps.push(`- #${s.id} ${s.action || s.kind} was cleared.`)
      if (s.status === 'error') gaps.push(`- #${s.id} ${s.action || s.kind} failed: ${String(s.error).replace(/\.$/, '')}.`)
    }
    if (pausedAt) gaps.push(`- History paused ${pausedAt.time} and not resumed (#${pausedAt.id}).`)
    out.push(...(gaps.length ? gaps : ['None.']), '')
    return out.join('\n')
  }

  const api = { methodsReport, resultText, stepText, label }
  if (node) module.exports = api
  else root.MonetReport = api
})(globalThis)

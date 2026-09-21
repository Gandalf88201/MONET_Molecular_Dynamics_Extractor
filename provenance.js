'use strict'

// Analysis history of a MONET session (schema monet-session/1). A pure data model with no DOM or
// network access. It keeps what changed a result: inputs with checksums, settings, analyses with
// their parameters and key numbers, derived trajectories and exports. That lets the session be
// reported and replayed. File paths are never stored, only file names.
;(function (root) {
  const SCHEMA = 'monet-session/1'
  const KINDS = new Set(['load', 'cell', 'time', 'analysis', 'derive', 'extract', 'export', 'pause', 'resume', 'clear', 'logging_error'])
  const MAX_INPUTS = 100
  const MAX_SERIES = 8
  const clone = value => JSON.parse(JSON.stringify(value))

  const round6 = v => (Number.isFinite(v) ? Number(v.toPrecision(6)) : null)
  const numbers = a => (Array.isArray(a) ? a.filter(Number.isFinite) : [])
  const mean = a => { const v = numbers(a); return v.length ? round6(v.reduce((s, x) => s + x, 0) / v.length) : null }
  const max = a => { const v = numbers(a); return v.length ? round6(v.reduce((m, x) => (x > m ? x : m), -Infinity)) : null }
  function circularMean (a, period = 360) {
    const v = numbers(a)
    if (!v.length) return null
    const k = 2 * Math.PI / period
    let s = 0, c = 0
    for (const x of v) { s += Math.sin(k * x); c += Math.cos(k * x) }
    const m = round6(((Math.atan2(s, c) / k) % period + period) % period)
    return m >= period ? 0 : m
  }
  function argmaxAt (xs, ys) {
    let best = -1
    for (let i = 0; i < (Array.isArray(ys) ? ys.length : 0); i++) if (Number.isFinite(ys[i]) && (best < 0 || ys[i] > ys[best])) best = i
    return best < 0 || !Array.isArray(xs) ? null : round6(xs[best])
  }
  function offDiagonalMean (matrix) {
    let sum = 0, n = 0
    ;(Array.isArray(matrix) ? matrix : []).forEach((row, i) => (row || []).forEach((v, j) => { if (i !== j && Number.isFinite(v)) { sum += v; n++ } }))
    return n ? round6(sum / n) : null
  }
  const get = (object, path) => path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), object)
  const plain = v => (typeof v === 'number' && !Number.isFinite(v) ? null : v)
  // Scalars at the given dotted paths of the raw result, kept exactly (replay compares them).
  function pick (result, paths) {
    const out = {}
    for (const path of paths) {
      const v = get(result, path)
      if (v !== undefined && (v === null || typeof v !== 'object')) out[path] = plain(v)
    }
    return out
  }
  const seriesStat = (result, stat, tag) => Object.fromEntries(Object.entries(result.series || {}).slice(0, MAX_SERIES).map(([key, data]) => [`${tag}:${key}`, stat(data)]))

  // Key numbers kept for each action. A key without ':' is a path into the raw result; a key with
  // ':' is a statistic computed here, shown in the report but not compared by replay.
  const SUMMARY = {
    rmsd: r => ({ ...pick(r, ['reference_index']), 'mean:rmsd': mean(r.rmsd), 'max:rmsd': max(r.rmsd) }),
    rmsd_matrix: r => ({ ...pick(r, ['aligned', 'truncated']), 'mean:offdiagonal': offDiagonalMean(r.matrix) }),
    pdd: r => pick(r, ['n_frames', 'rmax']),
    rdf: r => ({ ...pick(r, ['n_frames', 'rmax']), 'peak:r': argmaxAt(r.r, r.g) }),
    msd: r => pick(r, ['fits.selection.D_cm2_s', 'fits.selection.r2', 'fit_start', 'fit_end']),
    vdos: r => ({ ...pick(r, ['n_frames', 'nyquist_cm', 'resolution_cm']), 'peak:wavenumber': argmaxAt(r.wavenumber, r.intensity) }),
    acf: r => pick(r, ['tau_fit', 'tau_fit_error', 'tau_int', 'tau_int_error', 'tau_int_method', 'n_effective', 'n_frames', 'blocking.plateau_sem', 'blocking.g']),
    equilibration: r => pick(r, ['t0_frame', 't0_time', 'g_t0', 'n_effective_t0', 'n_effective_full']),
    bonds: r => seriesStat(r, mean, 'mean'),
    angles: r => seriesStat(r, mean, 'mean'),
    dihedrals: r => seriesStat(r, circularMean, 'circmean'),
    fluctuations: r => pick(r, ['quantity', 'n_frames']),
    mda_run: r => pick(r, ['kind', 'n_frames']),
    ase_structure: r => pick(r, ['frame']),
    ase_coordination: r => seriesStat(r, mean, 'mean'),
    subsample: r => pick(r, ['n_frames', 'stride', 'start', 'source_frames']),
    mda_align: r => pick(r, ['n_frames']),
    wrap: r => pick(r, ['n_frames']),
    unwrap: r => pick(r, ['n_frames']),
    extract: r => pick(r, ['totalFrames', 'sampledFrames'])
  }

  function summarize (action, result) {
    const summary = SUMMARY[action]
    if (!summary || !result || typeof result !== 'object') return {}
    try { return clone(summary(result)) } catch { return {} }
  }

  function wrap (data, { now = () => new Date().toISOString() } = {}) {
    let nextId = data.steps.reduce((m, step) => Math.max(m, step.id), 0) + 1
    const touch = () => { data.updated = now() }
    const find = id => data.steps.find(step => step.id === id)
    function push (fields) {
      const step = {
        id: nextId, time: now(), kind: null, action: null, source: null, call: null, params: {}, atoms: [],
        result: {}, outputs: [], rerun_of: null, status: 'ok', error: null, note: '', final: false, ...clone(fields)
      }
      if (!KINDS.has(step.kind)) throw new Error(`Unknown step kind '${step.kind}'.`)
      step.id = nextId++
      data.steps.push(step)
      touch()
      return step.id
    }
    return {
      get data () { return data },
      source: id => data.sources.find(source => source.id === id),
      step: find,
      setEnvironment (env) { Object.assign(data.environment, clone(env || {})); touch() },
      addSource (info) {
        const id = `S${data.sources.length + 1}`
        data.sources.push({ name: null, size: null, sha256: null, format: null, frames: null, atoms: null, atom_ids: null, label: null, import: null, parent: null, ...clone(info || {}), id })
        touch()
        return id
      },
      begin (fields) { return data.paused ? null : push({ ...fields, status: 'running' }) },
      record (fields) { return data.paused ? null : push(fields) },
      finish (id, result, { outputs } = {}) {
        const step = find(id)
        if (!step) return
        step.status = 'ok'
        step.error = null
        step.result = summarize(step.action, result)
        if (outputs) step.outputs.push(...clone(outputs))
        touch()
      },
      fail (id, message) { const step = find(id); if (!step) return; step.status = 'error'; step.error = String(message); touch() },
      addOutput (id, output) { const step = find(id); if (!step) return; step.outputs.push(clone(output)); touch() },
      clear (id) {
        const step = find(id)
        if (!step || step.status === 'cleared') return null
        step.status = 'cleared'
        touch()
        return data.paused ? null : push({ kind: 'clear', action: step.action, source: step.source, params: { step: id } })
      },
      pause () { if (data.paused) return; push({ kind: 'pause' }); data.paused = true; touch() },
      resume () { if (!data.paused) return; data.paused = false; push({ kind: 'resume' }) },
      annotate (id, { note, final } = {}) {
        const step = find(id)
        if (!step) return
        if (note !== undefined) step.note = String(note)
        if (final !== undefined) step.final = Boolean(final)
        touch()
      },
      addInput (text) {
        data.inputs.push(String(text))
        if (data.inputs.length > MAX_INPUTS) data.inputs.splice(0, data.inputs.length - MAX_INPUTS)
        touch()
      },
      hasGaps: () => data.steps.some(step => step.kind === 'pause'),
      lineage (id) {
        const parts = []
        for (let source = data.sources.find(s => s.id === id), guard = 0; source && guard < 100; guard++) {
          parts.unshift(source.id)
          if (!source.parent) break
          const step = source.parent.step != null ? find(source.parent.step) : null
          parts.unshift(step ? `#${step.id} ${step.action}` : 'derived')
          source = data.sources.find(s => s.id === source.parent.source)
        }
        return parts.join(' → ')
      },
      toJSON: () => clone(data)
    }
  }

  function create (env = {}, options = {}) {
    const now = options.now || (() => new Date().toISOString())
    const { monet_version = null, ...versions } = env
    const time = now()
    return wrap({
      schema: SCHEMA, monet_version, created: time, updated: time,
      environment: { python: null, ase: null, mdanalysis: null, numpy: null, scipy: null, platform: null, ...clone(versions) },
      paused: false, sources: [], steps: [], inputs: []
    }, { now })
  }

  function fromJSON (object, options = {}) {
    if (!object || typeof object !== 'object' || typeof object.schema !== 'string' || !object.schema.startsWith('monet-session/')) throw new Error('Not a MONET session file.')
    if (object.schema !== SCHEMA) throw new Error(`This session uses ${object.schema}; open it with a newer MONET.`)
    if (!Array.isArray(object.sources) || !Array.isArray(object.steps)) throw new Error('The session file is incomplete.')
    const data = clone(object)
    data.inputs = Array.isArray(data.inputs) ? data.inputs : []
    data.environment = data.environment || {}
    for (const step of data.steps) if (step.status === 'running') { step.status = 'error'; step.error = 'interrupted (MONET closed before it finished)' }
    return wrap(data, options)
  }

  const api = { SCHEMA, KINDS: [...KINDS], SUMMARY, summarize, create, fromJSON }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetProvenance = api
})(globalThis)

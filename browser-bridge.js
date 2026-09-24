'use strict'

// A normal browser has no Electron preload. Keep the desktop bridge untouched.
// With the launcher (start_monet.py) files are uploaded once and processed by Python;
// without it, parsing and extraction run in this page (limited to 100 MiB).
;(function () {
  if (window.monet) return

  const files = new Map()   // name -> File/Blob kept in this page
  const remote = new Map()  // name -> Promise<server file_id>
  const digests = new Map() // name -> { sha256, size } of files the launcher holds (for the analysis history)
  const progress = new Set()
  const aseProgress = new Set()
  const running = { extraction: new Set(), ase: new Set() }
  const token = document.querySelector?.('meta[name="monet-api-token"]')?.content
  const server = Boolean(token)
  const limit = 100 * 1024 * 1024
  const fullName = 'MONET-results/1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz'
  let resultURL = null
  let localCancel = false
  const desktopOnly = 'To enable ASE in your browser, run python3 start_monet.py and open the address it prints. Python and ASE must be installed.'
  const safe = fn => async (...args) => {
    try { return await fn(...args) } catch (error) { return { error: error.message } }
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const emit = data => progress.forEach(callback => callback(data))
  const emitAse = data => aseProgress.forEach(callback => callback(data))
  const megabytes = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`

  // ── local (no launcher) engine ────────────────────────────────────────────

  // Read in chunks so large trajectories do not need to be retained as text.
  async function * lines (name) {
    const file = files.get(name)
    if (!file) throw new Error('Please select the XYZ file again.')
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let pending = ''
    for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
      const chunk = await file.slice(offset, offset + 1024 * 1024).arrayBuffer()
      pending += decoder.decode(chunk, { stream: true })
      // Retain a final CR in case the next chunk starts with LF.
      const trailingCR = pending.endsWith('\r')
      const parts = (trailingCR ? pending.slice(0, -1) : pending).split(/\r\n|\n|\r/)
      pending = parts.pop() + (trailingCR ? '\r' : '')
      yield * parts
    }
    pending += decoder.decode()
    if (pending) yield * pending.split(/\r\n|\n|\r/)
  }

  const atomText = atoms => atoms.map(a => `${a.element}  ${a.x.toFixed(7)}  ${a.y.toFixed(7)}  ${a.z.toFixed(7)}\n`).join('')
  const xyzText = (atoms, comment) => `${atoms.length}\n${comment}\n${atomText(atoms)}`

  // Dependency-free ZIP (stored entries); works offline and preserves folders.
  async function zip (entries) {
    const encoder = new TextEncoder()
    const table = Uint32Array.from({ length: 256 }, (_, n) => {
      for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
      return n >>> 0
    })
    const local = [], central = []
    let offset = 0, centralSize = 0
    if (entries.length > 65535) throw new Error('Too many output files for browser export; increase the sampling frequency or use the launcher.')
    for (const [path, content] of entries) {
      const name = encoder.encode(path)
      const data = new Uint8Array(await new Blob(Array.isArray(content) ? content : [content]).arrayBuffer())
      let crc = 0xffffffff
      for (const byte of data) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8)
      crc = (crc ^ 0xffffffff) >>> 0
      const header = new Uint8Array(30), h = new DataView(header.buffer)
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true)
      h.setUint16(6, 0x800, true); h.setUint16(12, 33, true)
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true)
      h.setUint32(22, data.length, true); h.setUint16(26, name.length, true)
      local.push(header, name, data)
      const directory = new Uint8Array(46), d = new DataView(directory.buffer)
      d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true)
      d.setUint16(8, 0x800, true); d.setUint16(14, 33, true)
      d.setUint32(16, crc, true); d.setUint32(20, data.length, true)
      d.setUint32(24, data.length, true); d.setUint16(28, name.length, true)
      d.setUint32(42, offset, true)
      central.push(directory, name)
      centralSize += directory.length + name.length
      offset += header.length + name.length + data.length
      if (offset + centralSize > 0xffffffff) throw new Error('Output exceeds browser ZIP limits. Use the launcher.')
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer)
    e.setUint32(0, 0x06054b50, true)
    e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true)
    e.setUint32(12, centralSize, true); e.setUint32(16, offset, true)
    return new Blob([...local, ...central, end], { type: 'application/zip' })
  }

  async function localExtraction (options) {
    const { filePath, frequency, selectedAtoms, computeAverage, generateGaussian, qm } = options
    if (qm && qm.codes && qm.codes.vasp && qm.codes.vasp.potcar) throw new Error('Building POTCAR needs the launcher or the desktop app.')
    const selected = new Set(selectedAtoms)
    const entries = [['0-HISTORY/run.json', JSON.stringify({ ...options, date: new Date().toISOString() }, null, 2)]]
    const full = [], sampled = []
    let totalFrames = 0, sampledFrames = 0, sums
    localCancel = false
    emit({ step: 'extraction', status: 'started', message: 'Reading trajectory …' })
    for await (const frame of MonetXYZ.frames(lines(filePath))) {
      const atoms = frame.atoms.filter(atom => selected.has(atom.index))
      const xyz = xyzText(atoms, MonetXYZ.outputComment(frame.index, frame.comment))
      full.push(xyz)
      if (frame.index % frequency === 0) {
        sampled.push(xyz)
        const folder = `2-SAMPLED_CONFIGURATIONS/conf${++sampledFrames}`
        const positions = atomText(atoms)
        entries.push([`${folder}/pos${sampledFrames}.txt`, positions])
        if (generateGaussian) {
          for (const [name, multiplicity, checkpoint, tag] of [['sing', 1, 's0', 'singlet'], ['trip', 3, 't0', 'triplet']]) {
            entries.push([`${folder}/${name}.dat`, `%nproc=6\n%chk=${checkpoint}.chk\n%mem=4gb\n#p ub3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight gfinput gfoldprint pop=full\n\nscf_${tag}\n\n0 ${multiplicity}\n${positions}\n`])
          }
        }
        if (qm) {
          const conf = { index: sampledFrames, frame: frame.index, symbols: atoms.map(a => a.element), positions: atoms.map(a => [a.x, a.y, a.z]), lattice: frame.lattice }
          for (const file of MonetQM.render(qm, conf)) entries.push([`${folder}/${file.path}`, file.text])
        }
      }
      if (computeAverage) {
        if (!sums) sums = frame.atoms.map(atom => ({ ...atom, x: 0, y: 0, z: 0 }))
        frame.atoms.forEach((atom, i) => { for (const axis of ['x', 'y', 'z']) sums[i][axis] += atom[axis] })
      }
      totalFrames++
      if (totalFrames % 200 === 0) {
        if (localCancel) throw new Error('Extraction cancelled.')
        emit({ step: 'extraction', status: 'progress', message: `Processed ${totalFrames} frames …` })
        await sleep(0)
      }
    }
    entries.push(['1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz', full])
    entries.push(['2-SAMPLED_CONFIGURATIONS/SAMPLED_CONFIGURATIONS.xyz', sampled])
    if (computeAverage) {
      sums.forEach(atom => { for (const axis of ['x', 'y', 'z']) atom[axis] /= totalFrames })
      entries.push(['3-AVERAGE_STRUCTURE/GEO-AVERAGE.xyz', xyzText(sums, `AVERAGE (${totalFrames} frames)`)])
    }
    emit({ step: 'extraction', status: 'done', message: 'Preparing ZIP download …' })
    const blob = await zip(entries)
    if (resultURL) URL.revokeObjectURL(resultURL)
    resultURL = URL.createObjectURL(blob)
    files.set(fullName, new Blob(full, { type: 'text/plain' }))
    return { success: true, totalFrames, sampledFrames, outputDir: 'MONET-results', downloadURL: resultURL }
  }

  // ── launcher (Python) engine ──────────────────────────────────────────────

  async function request (path, body) {
    if (!server) return { ok: false, error: desktopOnly }
    try {
      const response = await fetch(path, body === undefined
        ? { headers: { 'X-Monet-Token': token } }
        : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Monet-Token': token }, body: JSON.stringify(body) })
      const result = await response.json()
      if (!response.ok && !result.error) result.error = `ASE request failed (${response.status}).`
      return result
    } catch {
      return { ok: false, error: 'Cannot reach the local ASE server. Keep the launcher terminal open.' }
    }
  }

  function upload (name) {
    if (remote.has(name)) return remote.get(name)
    const file = files.get(name)
    if (!file) return Promise.reject(new Error('Load an XYZ file or run extraction first.'))
    emitAse({ message: `Uploading ${megabytes(file.size)} to the local ASE service …`, percent: 0 })
    const pending = fetch('/api/upload', {
      method: 'POST', body: file,
      headers: { 'X-Monet-Token': token, 'Content-Type': 'application/octet-stream', 'X-Monet-Filename': encodeURIComponent(file.name || name) }
    }).then(async response => {
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.ok) throw new Error(result.error || `Upload failed (${response.status}).`)
      digests.set(name, { sha256: result.sha256 || null, size: result.size ?? file.size })
      return result.file_id
    }, () => { throw new Error('Cannot reach the local ASE server. Keep the launcher terminal open.') })
    remote.set(name, pending)
    pending.catch(() => remote.delete(name))
    return pending
  }

  // Start a background job and poll it until it finishes, relaying progress.
  async function job (command, scope, onProgress) {
    const started = await request('/api/jobs', command)
    if (!started.ok) return started
    running[scope].add(started.job_id)
    let last = null
    try {
      for (let delay = 80; ; delay = Math.min(500, delay * 1.5)) {
        await sleep(delay)
        const status = await request(`/api/jobs/${started.job_id}`)
        if (!status.ok) return status
        if (status.state !== 'running') return status.result
        const key = status.progress && `${status.progress.message}|${status.progress.percent}`
        if (key && key !== last) { last = key; onProgress(status.progress) }
      }
    } finally {
      running[scope].delete(started.job_id)
    }
  }

  // The random download ID is the permission for that one file: the session token stays out of URLs.
  const downloadURL = id => `/api/download/${encodeURIComponent(id)}`

  async function serverRun (command, scope = 'ase', onProgress = emitAse) {
    const key = command.action === 'convert' ? command.input : command.filename
    const fileId = await upload(key)
    const { filename, input, ...rest } = command
    return job({ ...rest, file_id: fileId }, scope, onProgress)
  }

  // ── public API (same shape as the Electron preload) ───────────────────────

  function selectFile (accept) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept ?? (server ? '' : '.xyz,.XYZ,.extxyz,.EXTXYZ')
      input.hidden = true
      document.body.appendChild(input)
      const finish = value => { input.remove(); resolve(value) }
      input.addEventListener('cancel', () => finish(null), { once: true })
      input.addEventListener('change', () => {
        const file = input.files[0]
        if (!file) return finish(null)
        if (!server && file.size > limit) {
          input.remove()
          reject(new Error('Without the launcher the browser supports files up to 100 MiB. Run python3 start_monet.py for larger trajectories.'))
          return
        }
        let key = file.name
        let copy = 1
        while (files.has(key)) key = `file-${++copy}/${file.name}`
        files.set(key, file)
        finish(key)
      }, { once: true })
      input.click()
    })
  }

  window.monet = {
    isBrowser: true,
    hasAseServer: server,
    selectFile,
    canImport: server,
    importFile: safe(async (name, options = {}) => {
      if (!server) throw new Error('Importing other formats needs the launcher: run python3 start_monet.py.')
      const fileId = await upload(name)
      const extra = {}
      if (options.reference) extra.reference_id = await upload(options.reference)
      if (options.cellFile) extra.cell_id = await upload(options.cellFile)
      const result = await job({
        action: 'import', file_id: fileId, format: options.format || 'auto', cell_vectors: options.cellVectors || 'rows',
        source_name: (files.get(name)?.name || name), ...extra
      }, 'ase', emitAse)
      if (!result.ok) throw new Error(result.message || result.error)
      let key = `imported/${(files.get(name)?.name || name).replace(/\.[^./]*$/, '')}.extxyz`
      for (let copy = 2; remote.has(key); copy++) key = `imported-${copy}/${key.split('/').pop()}`
      remote.set(key, Promise.resolve(result.file_id))
      digests.set(key, { sha256: result.sha256 || null, size: null })
      return { filePath: key, frames: result.frames, sourceFormat: result.source_format, sourceLabel: result.source_label, warning: result.warning }
    }),
    releaseFile: async name => {
      const pending = remote.get(name)
      remote.delete(name)
      if (name !== fullName) files.delete(name)
      if (pending) request('/api/release', { file_id: await pending.catch(() => null) })
    },
    analyzeFile: safe(async name => {
      if (server) {
        const result = await serverRun({ action: 'scan', filename: name })
        if (!result.ok) throw new Error(result.message || result.error)
        return { atomCount: result.atomCount, configCount: result.configCount, format: result.format, filePath: name }
      }
      const parser = new MonetXYZ.Parser()
      for await (const line of lines(name)) parser.push(line)
      return { ...parser.finish(), filePath: name }
    }),
    readFrame: safe(async (name, index) => {
      if (!Number.isInteger(index) || index < 0) throw new Error('Invalid frame index.')
      if (server) {
        const result = await serverRun({ action: 'frame', filename: name, index })
        if (!result.ok) throw new Error(result.message || result.error)
        return { atoms: result.atoms, lattice: result.lattice || null }
      }
      // lattice: the frame's extended XYZ Lattice="…" (3×3 Å rows) or null; step 4 uses frame 0's as the structure cell.
      for await (const frame of MonetXYZ.frames(lines(name))) {
        if (frame.index === index) return { atoms: frame.atoms, lattice: frame.lattice || null }
      }
      throw new Error('Frame index is outside the trajectory.')
    }),
    selectOutputDir: async () => 'MONET-results',
    onProgress: callback => { progress.add(callback); return () => progress.delete(callback) },
    onAseProgress: callback => { aseProgress.add(callback); return () => aseProgress.delete(callback) },
    aseCheck: () => request('/api/check', {}),
    listFormats: () => request('/api/formats', {}),
    // Registered analyses (monet_registry.py) with their parameters.
    listAnalyses: async () => server ? job({ action: 'list_analyses' }, 'ase', () => {}) : { ok: false, error: desktopOnly },
    aseSelectOutput: async name => name.split(/[\\/]/).pop(),
    aseRun: async command => {
      try {
        if (!server) return { ok: false, error: desktopOnly }
        // Player frames and cell look-ups run in the background: no status-bar progress.
        const quiet = ['frames', 'cell_file', 'topology'].includes(command.action)
        const result = await serverRun(command, 'ase', quiet ? () => {} : emitAse)
        // Derived trajectories (uncorrelated subset, unwrapped copy) can become the active file.
        if (result.ok && result.file_id) {
          let key = `derived/${result.output || command.action + '.extxyz'}`
          for (let copy = 2; remote.has(key); copy++) key = `derived-${copy}/${key.split('/').pop()}`
          remote.set(key, Promise.resolve(result.file_id))
          digests.set(key, { sha256: result.sha256 || null, size: null })
          result.filePath = key
        }
        if (result.ok && result.download_id) {
          result.downloadURL = downloadURL(result.download_id)
          result.output = command.output
        }
        return result
      } catch (error) {
        return { ok: false, error: error.message }
      }
    },
    cancel: async scope => {
      if (scope === 'extraction') localCancel = true
      await Promise.all([...(running[scope] || [])].map(id => request(`/api/jobs/${id}/cancel`, {})))
    },
    fileDigest: async name => {
      const pending = remote.get(name)
      if (pending) await pending.catch(() => null)
      return digests.get(name) || null
    },
    sessionSave: session => request('/api/session/save', { session }),
    sessionFind: sha256 => request('/api/session/find', { sha256 }),
    sessionExport: async body => {
      const result = await request('/api/session/export', body)
      if (result.ok) result.downloadURL = downloadURL(result.download_id)
      return result
    },
    sessionOpen: safe(async () => {
      const name = await selectFile('.json,.zip,application/json,application/zip')
      if (!name) return null
      if (!server) {
        const file = files.get(name)
        files.delete(name)
        if (/\.zip$/i.test(file.name || name)) throw new Error('Opening a session ZIP needs the launcher; open its session.json instead.')
        return { ok: true, session: JSON.parse(await file.text()) }
      }
      try {
        return await request('/api/session/read', { file_id: await upload(name) })
      } finally {
        window.monet.releaseFile(name)
      }
    }),
    processTrajectory: safe(async options => {
      const { filePath, frequency, selectedAtoms } = options
      if (!Number.isInteger(frequency) || frequency < 1) throw new Error('Sampling frequency must be a positive integer.')
      const selected = new Set(selectedAtoms)
      if (!selected.size || [...selected].some(id => !Number.isInteger(id) || id < 1 || id > options.atomCount)) {
        throw new Error('Select valid atom IDs from the loaded trajectory.')
      }
      if (!server) return localExtraction(options)
      emit({ step: 'extraction', status: 'started', message: 'Extracting with the local Python engine …' })
      const result = await serverRun({
        action: 'extract', filename: filePath, selected: [...selected], frequency, atom_count: options.atomCount,
        compute_average: Boolean(options.computeAverage), generate_gaussian: Boolean(options.generateGaussian),
        ...(options.qm ? { qm: options.qm } : {}),
        history: { ...options, date: new Date().toISOString() }
      }, 'extraction', status => emit({ step: 'extraction', status: 'progress', message: status.message, percent: status.percent }))
      if (!result.ok) throw new Error(result.message || result.error)
      emit({ step: 'extraction', status: 'done', message: `Extracted ${result.totalFrames} frames · ${result.sampledFrames} sampled configurations` })
      const previous = remote.get(fullName)
      files.delete(fullName)
      remote.set(fullName, Promise.resolve(result.extracted_id))
      digests.set(fullName, { sha256: result.extracted_sha256 || null, size: null })
      if (previous) previous.then(id => request('/api/release', { file_id: id }), () => {})
      return { success: true, totalFrames: result.totalFrames, sampledFrames: result.sampledFrames, outputDir: 'MONET-results', downloadURL: downloadURL(result.download_id) }
    })
  }
})()

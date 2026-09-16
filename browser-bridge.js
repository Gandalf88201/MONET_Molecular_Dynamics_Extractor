'use strict'

// A normal browser has no Electron preload. Keep the desktop bridge untouched.
;(function () {
  if (window.monet) return

  const files = new Map()
  const progress = new Set()
  const aseProgress = new Set()
  const token = document.querySelector?.('meta[name="monet-api-token"]')?.content
  let convertedURL = null
  const limit = 100 * 1024 * 1024
  let resultURL = null
  const desktopOnly = 'To enable ASE in your browser, run python3 start_monet.py and open the address it prints. Python and ASE must be installed.'
  const safe = fn => async (...args) => {
    try { return await fn(...args) } catch (error) { return { error: error.message } }
  }

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

  function selectFile () {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.xyz,.XYZ,.extxyz,.EXTXYZ'
      input.hidden = true
      document.body.appendChild(input)
      const finish = value => { input.remove(); resolve(value) }
      input.addEventListener('cancel', () => finish(null), { once: true })
      input.addEventListener('change', () => {
        const file = input.files[0]
        if (!file) return finish(null)
        if (file.size > limit) {
          input.remove()
          reject(new Error('Browser mode supports files up to 100 MiB. Use the desktop app for larger trajectories.'))
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

  const atomText = atoms => atoms.map(a => `${a.element}  ${a.x.toFixed(7)}  ${a.y.toFixed(7)}  ${a.z.toFixed(7)}\n`).join('')
  const xyzText = (atoms, comment) => `${atoms.length}\n${comment}\n${atomText(atoms)}`
  const emit = data => progress.forEach(callback => callback(data))

  // Dependency-free ZIP (stored entries); works offline and preserves folders.
  async function zip (entries) {
    const encoder = new TextEncoder()
    const table = Uint32Array.from({ length: 256 }, (_, n) => {
      for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
      return n >>> 0
    })
    const local = [], central = []
    let offset = 0, centralSize = 0
    if (entries.length > 65535) throw new Error('Too many output files for browser export; increase the sampling frequency or use the desktop app.')
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
      if (offset + centralSize > 0xffffffff) throw new Error('Output exceeds browser ZIP limits. Use the desktop app.')
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer)
    e.setUint32(0, 0x06054b50, true)
    e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true)
    e.setUint32(12, centralSize, true); e.setUint32(16, offset, true)
    return new Blob([...local, ...central, end], { type: 'application/zip' })
  }

  async function apiRequest (path, body) {
    if (!token) return { ok: false, error: desktopOnly }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 310000)
    try {
      const response = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Monet-Token': token },
        body: JSON.stringify(body), signal: controller.signal
      })
      const result = await response.json()
      if (!response.ok && !result.error) result.error = `ASE request failed (${response.status}).`
      return result
    } catch (error) {
      return { ok: false, error: error.name === 'AbortError' ? 'ASE request timed out.' : 'Cannot reach the local ASE server. Keep the launcher terminal open.' }
    } finally {
      clearTimeout(timeout)
    }
  }

  window.monet = {
    isBrowser: true,
    hasAseServer: Boolean(token),
    selectFile,
    analyzeFile: safe(async name => {
      const parser = new MonetXYZ.Parser()
      for await (const line of lines(name)) parser.push(line)
      return { ...parser.finish(), filePath: name }
    }),
    readFrame: safe(async (name, index) => {
      if (!Number.isInteger(index) || index < 0) throw new Error('Invalid frame index.')
      for await (const frame of MonetXYZ.frames(lines(name))) {
        if (frame.index === index) return { atoms: frame.atoms }
      }
      throw new Error('Frame index is outside the trajectory.')
    }),
    selectOutputDir: async () => 'MONET-results',
    onProgress: callback => { progress.add(callback); return () => progress.delete(callback) },
    onAseProgress: callback => { aseProgress.add(callback); return () => aseProgress.delete(callback) },
    aseCheck: () => apiRequest('/api/check', {}),
    aseSelectOutput: async name => name.split(/[\\/]/).pop(),
    aseRun: async command => {
      try {
        const file = files.get(command.input || command.filename)
        if (!file) return { ok: false, error: 'Load an XYZ file or run extraction first.' }
        aseProgress.forEach(callback => callback({ message: 'Computing with ASE …', percent: 0 }))
        const result = await apiRequest('/api/run', { ...command, contents: await file.text() })
        if (result.ok && result.data_base64) {
          const bytes = Uint8Array.from(atob(result.data_base64), char => char.charCodeAt(0))
          if (convertedURL) URL.revokeObjectURL(convertedURL)
          convertedURL = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
          result.downloadURL = convertedURL
          result.output = command.output
        }
        return result
      } catch (error) {
        return { ok: false, error: error.message }
      }
    },
    processTrajectory: safe(async options => {
      const { filePath, frequency, selectedAtoms, computeAverage, generateGaussian } = options
      if (!Number.isInteger(frequency) || frequency < 1) throw new Error('Sampling frequency must be a positive integer.')
      const selected = new Set(selectedAtoms)
      if (!selected.size || [...selected].some(id => !Number.isInteger(id) || id < 1 || id > options.atomCount)) {
        throw new Error('Select valid atom IDs from the loaded trajectory.')
      }
      const entries = [['0-HISTORY/run.json', JSON.stringify({ ...options, date: new Date().toISOString() }, null, 2)]]
      const full = [], sampled = []
      let totalFrames = 0, sampledFrames = 0, sums
      emit({ step: 'extraction', status: 'started', message: 'Reading trajectory …' })
      for await (const frame of MonetXYZ.frames(lines(filePath))) {
        const atoms = frame.atoms.filter(atom => selected.has(atom.index))
        const xyz = xyzText(atoms, `frame ${frame.index}`)
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
        }
        if (computeAverage) {
          if (!sums) sums = frame.atoms.map(atom => ({ ...atom, x: 0, y: 0, z: 0 }))
          frame.atoms.forEach((atom, i) => { for (const axis of ['x', 'y', 'z']) sums[i][axis] += atom[axis] })
        }
        totalFrames++
        if (totalFrames % 200 === 0) {
          emit({ step: 'extraction', status: 'progress', message: `Processed ${totalFrames} frames …` })
          await new Promise(resolve => setTimeout(resolve, 0))
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
      files.set('MONET-results/1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz', new Blob(full, { type: 'text/plain' }))
      return { success: true, totalFrames, sampledFrames, outputDir: 'MONET-results', downloadURL: resultURL }
    })
  }
})()

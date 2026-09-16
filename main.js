'use strict'
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path    = require('path')
const fs      = require('fs')
const readline = require('readline')
const XYZ = require('./xyz.js')
const { finished } = require('stream/promises')
const { spawn, execFile } = require('child_process')

let mainWindow

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d0d1a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.loadFile('index.html')
  mainWindow.once('ready-to-show', () => mainWindow.show())
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ---------------------------------------------------------------------------
// IPC — file dialogs
// ---------------------------------------------------------------------------
ipcMain.handle('select-file', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Select XYZ Trajectory File',
    properties: ['openFile'],
    filters: [
      { name: 'XYZ Trajectory', extensions: ['xyz'] },
      { name: 'All Files',      extensions: ['*']   }
    ]
  })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('select-output-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Output Directory',
    properties: ['openDirectory', 'createDirectory']
  })
  return r.canceled ? null : r.filePaths[0]
})

// ---------------------------------------------------------------------------
// IPC — trajectory analysis
// ---------------------------------------------------------------------------
ipcMain.handle('analyze-file', async (_, filePath) => {
  try   { return await analyzeTrajectoryFile(filePath) }
  catch (e) { return { error: e.message } }
})

ipcMain.handle('read-frame', async (_, filePath, frameIndex, atomCount) => {
  try   { return await readTrajectoryFrame(filePath, frameIndex, atomCount) }
  catch (e) { return { error: e.message } }
})

// ---------------------------------------------------------------------------
// IPC — main processing pipeline
// ---------------------------------------------------------------------------
ipcMain.handle('process-trajectory', async (event, options) => {
  try   { return await processTrajectory(event, options) }
  catch (e) { return { error: e.message } }
})

// ---------------------------------------------------------------------------
// analyzeTrajectoryFile
//   Returns: { atomCount, configCount, format, filePath }
// ---------------------------------------------------------------------------
async function * trajectoryLines (filePath) {
  const input = fs.createReadStream(filePath)
  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  try { yield * rl } finally { rl.close(); input.destroy() }
}

async function analyzeTrajectoryFile (filePath) {
  const parser = new XYZ.Parser()
  for await (const line of trajectoryLines(filePath)) parser.push(line)
  return { ...parser.finish(), filePath }
}

async function readTrajectoryFrame (filePath, frameIndex) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0) throw new Error('Invalid frame index.')
  for await (const frame of XYZ.frames(trajectoryLines(filePath))) {
    if (frame.index === frameIndex) return { atoms: frame.atoms }
  }
  throw new Error('Frame index is outside the trajectory.')
}

// ---------------------------------------------------------------------------
// processTrajectory — single streaming pass (validation, extraction, average)
// ---------------------------------------------------------------------------
let cancelExtraction = false

async function writeText (stream, text) {
  if (!stream.write(text)) await new Promise((resolve, reject) => {
    const fail = error => { stream.off('drain', done); reject(error) }
    const done = () => { stream.off('error', fail); resolve() }
    stream.once('drain', done)
    stream.once('error', fail)
  })
}

const atomRows = atoms => {
  let text = ''
  for (const a of atoms) text += `${a.element}  ${a.x.toFixed(7)}  ${a.y.toFixed(7)}  ${a.z.toFixed(7)}\n`
  return text
}

async function processTrajectory (event, options) {
  const {
    filePath,
    outputDir,
    atomCount,
    selectedAtoms,    // 1-indexed numbers
    frequency,
    computeAverage,
    generateGaussian,
    configCount
  } = options

  if (!Number.isInteger(frequency) || frequency < 1) throw new Error('Sampling frequency must be a positive integer.')
  if (!selectedAtoms.length || selectedAtoms.some(id => !Number.isInteger(id) || id < 1 || id > atomCount)) {
    throw new Error('Select valid atom IDs from the loaded trajectory.')
  }
  const send     = msg => event.sender.send('progress', msg)
  const selected = [...new Set(selectedAtoms.map(Number))].sort((a, b) => a - b).map(id => id - 1)
  cancelExtraction = false

  // Create directory tree
  const dirs = {
    history:  path.join(outputDir, '0-HISTORY'),
    fullTraj: path.join(outputDir, '1-FULL_TRAJECTORY_EXTRACTED'),
    sampled:  path.join(outputDir, '2-SAMPLED_CONFIGURATIONS'),
    average:  path.join(outputDir, '3-AVERAGE_STRUCTURE')
  }
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })

  // Save processing options to history
  const histLog = {
    date: new Date().toISOString(),
    filePath, frequency, selectedAtoms, computeAverage, generateGaussian
  }
  fs.writeFileSync(path.join(dirs.history, 'run.json'), JSON.stringify(histLog, null, 2))

  const fullTrajPath = path.join(dirs.fullTraj, 'FULL_TRAJECTORY_EXTRACTED.xyz')
  const sampledPath  = path.join(dirs.sampled,  'SAMPLED_CONFIGURATIONS.xyz')
  const ftStream     = fs.createWriteStream(fullTrajPath, { highWaterMark: 4 << 20 })
  const smStream     = fs.createWriteStream(sampledPath)
  const sums = computeAverage ? new Float64Array(atomCount * 3) : null
  let elements = null
  let frameIndex = 0
  let sampledCount = 0

  send({ step: 'extraction', status: 'started', message: 'Reading trajectory …' })

  try {
    for await (const frame of XYZ.frames(trajectoryLines(filePath))) {
      const atoms = frame.atoms
      if (atoms.length !== atomCount) throw new Error('Atom count changed. Load the trajectory again.')
      if (!elements) elements = atoms.map(a => a.element)
      if (sums) {
        for (let i = 0; i < atomCount; i++) {
          sums[3 * i] += atoms[i].x; sums[3 * i + 1] += atoms[i].y; sums[3 * i + 2] += atoms[i].z
        }
      }
      const rows = atomRows(selected.map(i => atoms[i]))
      const text = `${selected.length}\nframe ${frameIndex}\n${rows}`
      await writeText(ftStream, text)

      // Write to sampled every `frequency` frames (include frame 0)
      if (frameIndex % frequency === 0) {
        await writeText(smStream, text)
        const confDir = path.join(dirs.sampled, `conf${++sampledCount}`)
        fs.mkdirSync(confDir, { recursive: true })
        fs.writeFileSync(path.join(confDir, `pos${sampledCount}.txt`), rows)
        if (generateGaussian) writeGaussianInputs(confDir, rows)
      }

      frameIndex++
      if (frameIndex % 500 === 0) {
        if (cancelExtraction) throw new Error('Extraction cancelled.')
        send({
          step: 'extraction', status: 'progress', frameIndex,
          message: `Processed ${frameIndex.toLocaleString()}${configCount ? ` / ${configCount.toLocaleString()}` : ''} frames …`,
          percent: configCount ? 100 * frameIndex / configCount : undefined
        })
      }
    }
    ftStream.end()
    smStream.end()
    await Promise.all([finished(ftStream), finished(smStream)])
  } catch (error) {
    ftStream.destroy()
    smStream.destroy()
    throw error
  }

  send({
    step: 'extraction', status: 'done',
    message: `Extracted ${frameIndex} frames · ${sampledCount} sampled configurations`
  })

  // -------------------------------------------------------------------
  // Average structure (all atoms, full trajectory)
  // -------------------------------------------------------------------
  if (sums && frameIndex > 0) {
    send({ step: 'average', status: 'started', message: 'Computing average structure …' })
    const average = elements.map((element, i) => ({
      element, x: sums[3 * i] / frameIndex, y: sums[3 * i + 1] / frameIndex, z: sums[3 * i + 2] / frameIndex
    }))
    fs.writeFileSync(path.join(dirs.average, 'GEO-AVERAGE.xyz'), `${atomCount}\nAVERAGE (${frameIndex} frames)\n${atomRows(average)}`)
    send({ step: 'average', status: 'done', message: 'GEO-AVERAGE.xyz written' })
  }

  return {
    success:       true,
    totalFrames:   frameIndex,
    sampledFrames: sampledCount,
    outputDir
  }
}

// ---------------------------------------------------------------------------
// writeGaussianInputs
// ---------------------------------------------------------------------------
function writeGaussianInputs (confDir, posContent) {
  const header = (mult, tag, chkName) =>
`%nproc=6
%chk=${confDir}/${chkName}
%mem=4gb
#p ub3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight gfinput gfoldprint pop=full

${tag}

0 ${mult}
${posContent}
`
  fs.writeFileSync(path.join(confDir, 'sing.dat'), header(1, 'scf_singlet', 's0.chk'))
  fs.writeFileSync(path.join(confDir, 'trip.dat'), header(3, 'scf_triplet', 't0.chk'))
}

// ===========================================================================
// ASE Python bridge
// ===========================================================================

const ASE_BRIDGE = path.join(__dirname, 'ase_bridge.py')

// Detect which python binary is available
function detectPython () {
  return new Promise(resolve => {
    const candidates = ['python3', 'python']
    let i = 0
    const next = () => {
      if (i >= candidates.length) { resolve(null); return }
      const bin = candidates[i++]
      execFile(bin, ['--version'], { timeout: 4000 }, err => {
        if (err) next()
        else resolve(bin)
      })
    }
    next()
  })
}

let _pythonBin = null   // cached after first detection
const aseChildren = new Set()

ipcMain.handle('cancel', async (_, scope) => {
  if (scope === 'extraction') cancelExtraction = true
  if (scope === 'ase') for (const child of aseChildren) child.kill()
  return true
})

ipcMain.handle('ase-check', async () => {
  try {
    const bin = await detectPython()
    if (!bin) return { ok: false, error: 'Python not found on PATH' }
    _pythonBin = bin

    return await runAseBridge({ action: 'check' }, () => {})
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('ase-run', async (event, command) => {
  try {
    if (!_pythonBin) _pythonBin = await detectPython()
    if (!_pythonBin) return { ok: false, error: 'Python not found on PATH' }
    return await runAseBridge(command, msg => event.sender.send('ase-progress', msg))
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('ase-select-output', async (_, defaultName) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Save converted file',
    defaultPath: defaultName,
    filters: [
      { name: 'XYZ',   extensions: ['xyz']  },
      { name: 'POSCAR', extensions: ['vasp', 'poscar'] },
      { name: 'CIF',   extensions: ['cif']  },
      { name: 'JSON',  extensions: ['json'] },
      { name: 'All',   extensions: ['*']    }
    ]
  })
  return r.canceled ? null : r.filePath
})

function runAseBridge (command, onProgress) {
  return new Promise((resolve, reject) => {
    const py = spawn(_pythonBin, [ASE_BRIDGE])
    let buf = ''
    let killed = false
    aseChildren.add(py)
    const kill = py.kill.bind(py)
    py.kill = signal => { killed = true; return kill(signal) }

    py.stdout.on('data', chunk => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop()                        // keep partial last line
      for (const line of lines) {
        if (!line.trim()) continue
        let msg
        try { msg = JSON.parse(line) } catch { continue }
        if (msg.type === 'progress') onProgress(msg)
        else if (msg.type === 'result') resolve(msg)
        else if (msg.type === 'error')  resolve(msg)
      }
    })

    py.stderr.on('data', d => console.error('[ASE stderr]', d.toString().trim()))
    py.on('error', e  => resolve({ ok: false, error: e.message }))
    py.on('close', code => {
      aseChildren.delete(py)
      if (killed) { resolve({ ok: false, cancelled: true, error: 'Calculation cancelled.' }); return }
      // flush any remaining buffer
      if (buf.trim()) {
        try {
          const msg = JSON.parse(buf)
          if (msg.type === 'result' || msg.type === 'error') { resolve(msg); return }
        } catch {}
      }
      resolve({ ok: false, error: code !== 0 ? `Python exited with code ${code}` : 'Python returned no result.' })
    })

    py.stdin.write(JSON.stringify(command) + '\n')
    py.stdin.end()
  })
}

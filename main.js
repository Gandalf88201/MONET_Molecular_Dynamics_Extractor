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

// Normalize validated frames for the existing extraction pipeline.
async function * normalizedTrajectoryLines (filePath) {
  for await (const frame of XYZ.frames(trajectoryLines(filePath))) {
    yield String(frame.atoms.length)
    yield frame.comment
    for (const atom of frame.atoms) yield `${atom.element} ${atom.x} ${atom.y} ${atom.z}`
  }
}

// ---------------------------------------------------------------------------
// processTrajectory — full pipeline
// ---------------------------------------------------------------------------
async function processTrajectory (event, options) {
  const {
    filePath,
    outputDir,
    atomCount,
    selectedAtoms,    // 1-indexed numbers
    frequency,
    computeAverage,
    generateGaussian
  } = options

  const info = await analyzeTrajectoryFile(filePath)
  if (info.atomCount !== atomCount) throw new Error('Atom count changed. Load the trajectory again.')
  if (!Number.isInteger(frequency) || frequency < 1) throw new Error('Sampling frequency must be a positive integer.')
  if (!selectedAtoms.length || selectedAtoms.some(id => !Number.isInteger(id) || id < 1 || id > atomCount)) {
    throw new Error('Select valid atom IDs from the loaded trajectory.')
  }
  const send      = msg => event.sender.send('progress', msg)
  const frameSize = atomCount + 2
  const selSet    = new Set(selectedAtoms.map(Number))
  const selCount  = selSet.size

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

  // Accumulators for average structure (all atoms, full trajectory)
  const avgSum = Array.from({ length: atomCount }, () => ({ x: 0, y: 0, z: 0, element: '' }))
  let avgFrameCount = 0

  // Output streams
  const fullTrajPath = path.join(dirs.fullTraj, 'FULL_TRAJECTORY_EXTRACTED.xyz')
  const sampledPath  = path.join(dirs.sampled,  'SAMPLED_CONFIGURATIONS.xyz')
  const ftStream     = fs.createWriteStream(fullTrajPath)
  const smStream     = fs.createWriteStream(sampledPath)
  let writeError = null
  ftStream.on('error', error => { writeError = error })
  smStream.on('error', error => { writeError = error })

  // Collected sampled frames for individual conf folders
  const sampledFrames = []

  send({ step: 'extraction', status: 'started', message: 'Reading trajectory …' })

  const rl = normalizedTrajectoryLines(filePath)

  let lineInFrame      = 0
  let frameIndex       = 0   // 0-indexed
  let atomLineIndex    = 0   // 1-indexed within frame
  let currentFrameAtoms = []

  try {
    for await (const line of rl) {
      if (writeError) throw writeError
      lineInFrame++

      if (lineInFrame === 1) {
        // Start of new frame
        currentFrameAtoms = []
        atomLineIndex     = 0
      } else if (lineInFrame === 2) {
        // Comment / step header — ignore content
      } else {
        // Atom line
        atomLineIndex++
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 4) {
          const atom = {
            index:   atomLineIndex,
            element: parts[0],
            x:       parseFloat(parts[1]),
            y:       parseFloat(parts[2]),
            z:       parseFloat(parts[3])
          }
          currentFrameAtoms.push(atom)

          if (computeAverage) {
            avgSum[atomLineIndex - 1].x       += atom.x
            avgSum[atomLineIndex - 1].y       += atom.y
            avgSum[atomLineIndex - 1].z       += atom.z
            avgSum[atomLineIndex - 1].element  = atom.element
          }
        }
      }

      if (lineInFrame >= frameSize) {
        // Frame complete
        if (computeAverage) avgFrameCount++

        const selAtoms = currentFrameAtoms.filter(a => selSet.has(a.index))

        // Always write to full trajectory
        ftStream.write(`${selCount}\n`)
        ftStream.write(`frame ${frameIndex}\n`)
        for (const a of selAtoms)
          ftStream.write(`${a.element}  ${a.x.toFixed(7)}  ${a.y.toFixed(7)}  ${a.z.toFixed(7)}\n`)

        // Write to sampled every `frequency` frames (include frame 0)
        if (frameIndex % frequency === 0) {
          smStream.write(`${selCount}\n`)
          smStream.write(`frame ${frameIndex}\n`)
          for (const a of selAtoms)
            smStream.write(`${a.element}  ${a.x.toFixed(7)}  ${a.y.toFixed(7)}  ${a.z.toFixed(7)}\n`)

          sampledFrames.push({ frameIndex, atoms: selAtoms })
        }

        frameIndex++
        lineInFrame = 0

        if (frameIndex % 200 === 0)
          send({ step: 'extraction', status: 'progress', message: `Processed ${frameIndex} frames …`, frameIndex })
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
    message: `Extracted ${frameIndex} frames · ${sampledFrames.length} sampled configurations`
  })

  // -------------------------------------------------------------------
  // Individual conf folders + pos files
  // -------------------------------------------------------------------
  send({ step: 'folders', status: 'started', message: 'Creating configuration folders …' })

  for (let i = 0; i < sampledFrames.length; i++) {
    const confDir = path.join(dirs.sampled, `conf${i + 1}`)
    fs.mkdirSync(confDir, { recursive: true })

    let posContent = ''
    for (const a of sampledFrames[i].atoms)
      posContent += `${a.element}  ${a.x.toFixed(7)}  ${a.y.toFixed(7)}  ${a.z.toFixed(7)}\n`

    fs.writeFileSync(path.join(confDir, `pos${i + 1}.txt`), posContent)

    if (generateGaussian) writeGaussianInputs(confDir, posContent)
  }

  send({ step: 'folders', status: 'done', message: `Created ${sampledFrames.length} conf folders` })

  // -------------------------------------------------------------------
  // Average structure (all atoms, full trajectory)
  // -------------------------------------------------------------------
  if (computeAverage && avgFrameCount > 0) {
    send({ step: 'average', status: 'started', message: 'Computing average structure …' })

    let avgXYZ = `${atomCount}\nAVERAGE (${avgFrameCount} frames)\n`
    for (const a of avgSum)
      avgXYZ += `${a.element}  ${(a.x / avgFrameCount).toFixed(7)}  ${(a.y / avgFrameCount).toFixed(7)}  ${(a.z / avgFrameCount).toFixed(7)}\n`

    fs.writeFileSync(path.join(dirs.average, 'GEO-AVERAGE.xyz'), avgXYZ)
    send({ step: 'average', status: 'done', message: 'GEO-AVERAGE.xyz written' })
  }

  return {
    success:       true,
    totalFrames:   frameIndex,
    sampledFrames: sampledFrames.length,
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

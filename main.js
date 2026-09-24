'use strict'
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path    = require('path')
const fs      = require('fs')
const readline = require('readline')
const XYZ = require('./xyz.js')
const { createPool } = require('./bridge-worker.js')
const { execFile } = require('child_process')

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
    title: 'Select Trajectory or Structure File',
    properties: ['openFile'],
    filters: [
      { name: 'All Files',      extensions: ['*']   },
      { name: 'XYZ Trajectory', extensions: ['xyz', 'extxyz'] }
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
    if (frame.index === frameIndex) return { atoms: frame.atoms, lattice: frame.lattice || null }
  }
  throw new Error('Frame index is outside the trajectory.')
}

// ---------------------------------------------------------------------------
// processTrajectory — the Python engine (monet_io.extract), as in the launcher
// ---------------------------------------------------------------------------
async function processTrajectory (event, options) {
  const { filePath, outputDir, atomCount, selectedAtoms, frequency, computeAverage, generateGaussian, qm } = options
  if (!Number.isInteger(frequency) || frequency < 1) throw new Error('Sampling frequency must be a positive integer.')
  if (!selectedAtoms.length || selectedAtoms.some(id => !Number.isInteger(id) || id < 1 || id > atomCount)) {
    throw new Error('Select valid atom IDs from the loaded trajectory.')
  }
  if (!outputDir) throw new Error('Choose an output folder.')
  const bridge = await pythonBridge()
  if (!bridge) throw new Error('Extraction needs Python 3 with numpy (python3 on PATH).')
  const send = msg => event.sender.send('progress', msg)
  send({ step: 'extraction', status: 'started', message: 'Reading trajectory …' })
  const result = await bridge.run({
    action: 'extract', filename: filePath, output_dir: outputDir, selected: [...new Set(selectedAtoms)], frequency,
    atom_count: atomCount, compute_average: Boolean(computeAverage), generate_gaussian: Boolean(generateGaussian),
    ...(qm ? { qm } : {}),
    history: { date: new Date().toISOString(), filePath, frequency, selectedAtoms, computeAverage, generateGaussian }
  }, msg => send({ step: 'extraction', status: 'progress', message: msg.message, percent: msg.percent }), 'extraction')
  if (!result.ok) throw new Error(result.cancelled ? 'Extraction cancelled.' : result.message || result.error)
  send({ step: 'extraction', status: 'done', message: `Extracted ${result.totalFrames} frames · ${result.sampledFrames} sampled configurations` })
  if (computeAverage) send({ step: 'average', status: 'done', message: 'GEO-AVERAGE.xyz written' })
  return { success: true, totalFrames: result.totalFrames, sampledFrames: result.sampledFrames, outputDir }
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

// Persistent bridge workers (bridge-worker.js), created once Python is found.
let pool = null
async function pythonBridge () {
  if (!pool) {
    const python = await detectPython()
    if (!python || pool) return pool
    pool = createPool({ python, script: ASE_BRIDGE })
  }
  return pool
}
app.on('will-quit', () => { if (pool) pool.close() })

ipcMain.handle('cancel', async (_, scope) => {
  if (pool && (scope === 'extraction' || scope === 'ase')) pool.cancel(scope)
  return true
})

ipcMain.handle('ase-check', async () => {
  try {
    const bridge = await pythonBridge()
    if (!bridge) return { ok: false, error: 'Python not found on PATH' }
    const result = await bridge.run({ action: 'check' })
    bridge.warm()
    return result
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('ase-run', async (event, command) => {
  try {
    const bridge = await pythonBridge()
    if (!bridge) return { ok: false, error: 'Python not found on PATH' }
    return await bridge.run(command, msg => event.sender.send('ase-progress', msg))
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('ase-import', async (event, name, options = {}) => {
  try {
    const bridge = await pythonBridge()
    if (!bridge) return { error: 'Python with ASE is required to import this format.' }
    const folder = fs.mkdtempSync(path.join(require('os').tmpdir(), 'monet-import-'))
    const output = path.join(folder, path.basename(name).replace(/\.[^.]*$/, '') + '.extxyz')
    const result = await bridge.run({
      action: 'import', filename: name, output, format: options.format || 'auto', source_name: path.basename(name),
      reference: options.reference || undefined, cell_file: options.cellFile || undefined, cell_vectors: options.cellVectors || 'rows'
    }, msg => event.sender.send('ase-progress', msg))
    if (!result.ok) return { error: result.message || result.error }
    return { filePath: output, frames: result.frames, sourceFormat: result.source_format, sourceLabel: result.source_label, warning: result.warning }
  } catch (e) {
    return { error: e.message }
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

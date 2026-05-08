'use strict'
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path   = require('path')
const fs     = require('fs')
const readline = require('readline')

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
async function analyzeTrajectoryFile (filePath) {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity })

  let lineNum     = 0
  let atomCount   = 0
  let configCount = 0
  let format      = 'unknown'

  for await (const line of rl) {
    lineNum++
    if (lineNum === 1) atomCount = parseInt(line.trim(), 10)

    if      (line.includes('STEP ='))  { format = 'CPMD'; configCount++ }
    else if (line.includes('STEP:'))   { format = 'CPMD'; configCount++ }
    else if (/ i =/.test(line))        { format = 'CP2K'; configCount++ }
  }

  return { atomCount, configCount, format, filePath }
}

// ---------------------------------------------------------------------------
// readTrajectoryFrame
//   Returns: { atoms: [{index, element, x, y, z}] }
// ---------------------------------------------------------------------------
async function readTrajectoryFrame (filePath, frameIndex, atomCount) {
  const frameSize = atomCount + 2
  const startLine = frameIndex * frameSize   // 0-indexed line number

  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity })

  const atoms        = []
  let   absLine      = -1
  let   frameLineNum = 0
  let   inFrame      = false

  for await (const line of rl) {
    absLine++
    if (absLine === startLine) inFrame = true
    if (!inFrame) continue

    frameLineNum++
    if (frameLineNum === 1 || frameLineNum === 2) continue   // skip header lines

    const parts = line.trim().split(/\s+/)
    if (parts.length >= 4) {
      atoms.push({
        index:   atoms.length + 1,
        element: parts[0],
        x:       parseFloat(parts[1]),
        y:       parseFloat(parts[2]),
        z:       parseFloat(parts[3])
      })
    }
    if (frameLineNum >= frameSize) break
  }

  return { atoms }
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

  // Collected sampled frames for individual conf folders
  const sampledFrames = []

  send({ step: 'extraction', status: 'started', message: 'Reading trajectory …' })

  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity })

  let lineInFrame      = 0
  let frameIndex       = 0   // 0-indexed
  let atomLineIndex    = 0   // 1-indexed within frame
  let currentFrameAtoms = []

  for await (const line of rl) {
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

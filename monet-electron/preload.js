'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('monet', {
  selectFile:      ()                => ipcRenderer.invoke('select-file'),
  selectOutputDir: ()                => ipcRenderer.invoke('select-output-dir'),
  analyzeFile:     filePath          => ipcRenderer.invoke('analyze-file', filePath),
  readFrame:       (fp, idx, atoms)  => ipcRenderer.invoke('read-frame', fp, idx, atoms),
  processTrajectory: opts            => ipcRenderer.invoke('process-trajectory', opts),
  onProgress:      cb                => ipcRenderer.on('progress', (_, data) => cb(data))
})

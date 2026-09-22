'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('monet', {
  desktop: true, // Electron app: POTCAR can be assembled from a local library
  // ── core trajectory ops ──────────────────────────────────────────────────
  selectFile:        ()               => ipcRenderer.invoke('select-file'),
  selectOutputDir:   ()               => ipcRenderer.invoke('select-output-dir'),
  analyzeFile:       fp               => ipcRenderer.invoke('analyze-file', fp),
  readFrame:         (fp, idx, atoms) => ipcRenderer.invoke('read-frame', fp, idx, atoms),
  processTrajectory: opts             => ipcRenderer.invoke('process-trajectory', opts),
  onProgress:        cb               => ipcRenderer.on('progress', (_, d) => cb(d)),
  cancel:            scope            => ipcRenderer.invoke('cancel', scope),
  canImport:         true,
  listFormats:       ()               => ipcRenderer.invoke('ase-run', { action: 'formats' }),
  importFile:        (fp, options)    => ipcRenderer.invoke('ase-import', fp, options),

  // ── ASE Python bridge ────────────────────────────────────────────────────
  aseCheck:          ()               => ipcRenderer.invoke('ase-check'),
  aseRun:            cmd              => ipcRenderer.invoke('ase-run', cmd),
  aseSelectOutput:   name             => ipcRenderer.invoke('ase-select-output', name),
  onAseProgress: cb => {
    const listener = (_, data) => cb(data)
    ipcRenderer.on('ase-progress', listener)
    return () => ipcRenderer.removeListener('ase-progress', listener)
  },
})

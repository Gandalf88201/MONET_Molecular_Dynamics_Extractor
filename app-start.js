'use strict'

// MONET page script, part 9 of 9: Start-up: runs once every app-*.js file has loaded.
// The app-*.js files are classic scripts sharing one global scope; index.html loads them in this order.

// =============================================================================
// ── Init ─────────────────────────────────────────────────────────────────────
// =============================================================================

window.addEventListener('load', () => {
  resizeCanvas()
  Object.values(charts).forEach(chart => chart.clear())
  resizeAseViewer()
  updateCellPreset()
  updateSelectionTarget()
  updateSampledCount()
  updateFormatUI()
  updateQmUI()
  updateTimeInfo()
  updateMdaForm()
  updateFluctForm()
  $$('.ase-stab').forEach(b => b.classList.toggle('group-hidden', b.dataset.group !== activeGroup))
  $('module-intro').textContent = ANALYSIS_GROUPS[activeGroup]
  if (window.monet.isBrowser) {
    state.outputDir = 'MONET-results'
    $('output-dir-text').textContent = 'Download results as a ZIP file'
    $('btn-output-dir').classList.add('hidden')
    updateQmUI()
    setStatus('Browser mode · Select an XYZ file to begin')
    $('btn-conv-output').textContent = 'Set download name'
    $('conv-format').value = 'extxyz'
    $('conv-format').querySelector('option[value=""]').disabled = true
  }
  // The manual is served by the launcher; opening index.html directly or the desktop window has no /manual.
  if (/^https?:$/.test(location.protocol)) $('manual-link').hidden = false
  checkAseStatus().catch(error => setStatus('ASE check failed: ' + error.message))
})

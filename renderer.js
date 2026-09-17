'use strict'

// =============================================================================
// ── Molecular Viewer ─────────────────────────────────────────────────────────
// =============================================================================

const CPK = {
  H:  '#e8e8e8', C:  '#404040', N:  '#3050f8', O:  '#ff0d0d',
  S:  '#ffff30', P:  '#ff8000', F:  '#90e050', Cl: '#1ff01f',
  Br: '#a62929', I:  '#940094', Fe: '#e06633', Cu: '#c88033',
  Zn: '#7d80b0', Se: '#ffa100', Mg: '#228b22', Ca: '#3dff00',
  Na: '#ab5cf2', K:  '#8f40d4'
}
const DEFAULT_COLOR = '#ff69b4'

// Covalent radii in Å (used for bond detection)
const COV = {
  H: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07,
  F: 0.57, Cl: 1.02, Br: 1.20, I: 1.39, Fe: 1.32, Cu: 1.32,
  default: 1.0
}

function atomColor   (el) { return CPK[el]  ?? DEFAULT_COLOR }
function themeColor  (name, fallback) { return globalThis.MonetTheme ? MonetTheme.color(name, fallback) : fallback }
function covalentRad (el) { return COV[el]  ?? COV.default   }

function hexToRgb (hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lighten (hex, f) {
  const [r, g, b] = hexToRgb(hex)
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)))
  return `rgb(${clamp(r+(255-r)*f)},${clamp(g+(255-g)*f)},${clamp(b+(255-b)*f)})`
}

function darken (hex, f) {
  const [r, g, b] = hexToRgb(hex)
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)))
  return `rgb(${clamp(r*(1-f))},${clamp(g*(1-f))},${clamp(b*(1-f))})`
}

// ─── 3D Math ──────────────────────────────────────────────────────────────────

function rotY (x, y, z, a) {
  const c = Math.cos(a), s = Math.sin(a)
  return [x*c + z*s, y, -x*s + z*c]
}

function rotX (x, y, z, a) {
  const c = Math.cos(a), s = Math.sin(a)
  return [x, y*c - z*s, y*s + z*c]
}

// ─── MolecularViewer class ────────────────────────────────────────────────────

class MolecularViewer {
  constructor (canvas) {
    this.canvas   = canvas
    this.ctx      = canvas.getContext('2d')
    this.atoms    = []
    this.bonds    = []
    this.selected = new Set()  // 1-indexed atom IDs
    this.rotX     = 0.25
    this.rotY     = -0.40
    this.zoom     = 30
    this.center   = [0, 0, 0]
    this.dragging = false
    this.lastMouse = null
    this.onSelectionChange = null
    this._wasDrag = false
    this.showAllLabels = false
    this.showSelectionOrder = false
    this.cell = null

    canvas.addEventListener('mousedown',   e => this._onMouseDown(e))
    canvas.addEventListener('mousemove',   e => this._onMouseMove(e))
    canvas.addEventListener('mouseup',     () => { this.dragging = false })
    canvas.addEventListener('mouseleave',  () => { this.dragging = false })
    canvas.addEventListener('wheel',       e => this._onWheel(e), { passive: false })
    window.addEventListener('mouseup', () => { this.dragging = false })
    canvas.addEventListener('click',       e => this._onClick(e))
  }

  loadAtoms (atoms) {
    this.atoms = atoms
    this.bonds = []
    if (!atoms.length) { this.render(); return }

    // Center
    const cx = atoms.reduce((s,a) => s+a.x, 0) / atoms.length
    const cy = atoms.reduce((s,a) => s+a.y, 0) / atoms.length
    const cz = atoms.reduce((s,a) => s+a.z, 0) / atoms.length
    this.center = [cx, cy, cz]

    // Auto-zoom
    const maxD = atoms.reduce((m, a) =>
      Math.max(m, Math.hypot(a.x-cx, a.y-cy, a.z-cz)), 0) || 5
    const minDim = Math.min(this.canvas.width, this.canvas.height)
    this.zoom = (minDim * 0.38) / maxD

    // Compute bonds
    this.bonds = []
    for (let i = 0; i < atoms.length; i++) {
      for (let j = i+1; j < atoms.length; j++) {
        const a = atoms[i], b = atoms[j]
        const d = Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z)
        const threshold = (covalentRad(a.element) + covalentRad(b.element)) * 1.30
        if (d < threshold) this.bonds.push([i, j])
      }
    }

    this.render()
  }

  // Project a 3D point to 2D canvas coords + depth
  _project (x, y, z) {
    const [cx, cy, cz] = this.center
    let px = x - cx, py = y - cy, pz = z - cz;
    [px, py, pz] = rotY(px, py, pz, this.rotY);
    [px, py, pz] = rotX(px, py, pz, this.rotX)
    return {
      sx: this.canvas.width  / 2 + px * this.zoom,
      sy: this.canvas.height / 2 - py * this.zoom,
      sz: pz
    }
  }

  render () {
    const { canvas, ctx, atoms, bonds, selected, zoom } = this
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height)
    bg.addColorStop(0, themeColor('--canvas-bg', '#0d0d1a'))
    bg.addColorStop(1, themeColor('--canvas-bg2', '#10101f'))
    const selectColor = themeColor('--select', '#ffd700')
    const selectRing = themeColor('--select-ring', '#fff')
    const outline = themeColor('--atom-outline', 'rgba(0,0,0,0)')
    const carbonBond = themeColor('--bond-carbon', '#666')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (!atoms.length) return

    if (this.cell) {
      const vertices = this.cellVertices().map(point => this._project(...point))
      ctx.save(); ctx.strokeStyle = themeColor('--cell-line', '#54cbd8'); ctx.globalAlpha = .65; ctx.lineWidth = 1
      for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) {
        ctx.beginPath(); ctx.moveTo(vertices[i].sx, vertices[i].sy); ctx.lineTo(vertices[i | bit].sx, vertices[i | bit].sy); ctx.stroke()
      }
      ctx.font = '12px monospace'; ctx.fillStyle = themeColor('--cell-label', '#8fe9f3')
      for (const [i, label] of [[1, 'a'], [2, 'b'], [4, 'c']]) ctx.fillText(label, vertices[i].sx, vertices[i].sy)
      ctx.restore()
    }
    // Project all atoms
    const proj = atoms.map((a, i) => ({
      ...a, i, ...this._project(a.x, a.y, a.z)
    }))

    // Sort back-to-front for painter's algorithm
    const sorted = [...proj].sort((a, b) => a.sz - b.sz)

    // Draw bonds
    ctx.save()
    ctx.lineWidth = 1.8
    for (const [i, j] of bonds) {
      const a = proj[i], b = proj[j]
      const midx = (a.sx + b.sx) / 2
      const midy = (a.sy + b.sy) / 2
      const aColor = atomColor(a.element)
      const bColor = atomColor(b.element)
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(midx, midy)
      ctx.strokeStyle = aColor === '#404040' ? carbonBond : aColor
      ctx.globalAlpha = 0.55
      ctx.stroke()
      ctx.beginPath(); ctx.moveTo(midx, midy); ctx.lineTo(b.sx, b.sy)
      ctx.strokeStyle = bColor === '#404040' ? carbonBond : bColor
      ctx.stroke()
    }
    ctx.restore()

    // Draw atoms (back to front)
    for (const a of sorted) {
      const isSel = selected.has(a.index)
      const baseR = covalentRad(a.element)
      const r     = Math.max(4, baseR * zoom * 0.28)
      const color = atomColor(a.element)

      ctx.save()

      if (isSel) {
        ctx.shadowBlur  = 22
        ctx.shadowColor = selectColor
      }

      // Sphere-like radial gradient
      const hlx = a.sx - r * 0.35, hly = a.sy - r * 0.35
      const grd = ctx.createRadialGradient(hlx, hly, r * 0.08, a.sx, a.sy, r)
      grd.addColorStop(0,   lighten(color, 0.65))
      grd.addColorStop(0.55, color)
      grd.addColorStop(1,   darken(color, 0.45))

      ctx.beginPath()
      ctx.arc(a.sx, a.sy, r, 0, Math.PI * 2)
      ctx.fillStyle = isSel ? selectColor : grd
      ctx.fill()

      if (isSel) {
        ctx.lineWidth   = 2.5
        ctx.strokeStyle = selectRing
        ctx.stroke()
        ctx.shadowBlur = 0
      } else {
        ctx.lineWidth   = 1
        ctx.strokeStyle = outline
        ctx.stroke()
      }

      // Label: always show atom ID (1-indexed), element on hover-like if selected
      const fontSize = Math.max(9, Math.min(r * 0.72, 14))
      ctx.font        = `bold ${fontSize}px monospace`
      ctx.textAlign   = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle   = isSel ? '#1a1a1a' : (r > 14 ? '#fff' : 'rgba(255,255,255,0.7)')
      if (this.showAllLabels || isSel || r > 8)
        ctx.fillText(a.index, a.sx, a.sy)
      if (this.showSelectionOrder && isSel) {
        ctx.font = 'bold 11px monospace'
        ctx.fillStyle = themeColor('--gold', '#ffd700')
        ctx.fillText(`#${[...selected].indexOf(a.index) + 1}`, a.sx + r + 12, a.sy - r - 5)
      }

      ctx.restore()
    }
  }

  // Hit-test: find atom closest to click point
  _hitTest (mx, my) {
    let best = null, bestDepth = -Infinity
    for (const a of this.atoms) {
      const p = this._project(a.x, a.y, a.z)
      const distance = Math.hypot(p.sx - mx, p.sy - my)
      const radius = Math.max(4, covalentRad(a.element) * this.zoom * 0.28)
      // Match painter order: the visible front atom receives the click.
      if (distance <= radius && p.sz >= bestDepth) { best = a.index; bestDepth = p.sz }
    }
    return best
  }

  _onMouseDown (e) {
    if (e.button !== 0) return
    this._wasDrag = false
    this.dragStart = { x: e.clientX, y: e.clientY }
    this.dragging  = true
    this.lastMouse = { x: e.clientX, y: e.clientY }
  }

  _onMouseMove (e) {
    if (!this.dragging || !this.lastMouse) return
    if (!this._wasDrag && Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) <= 4) return
    this._wasDrag = true
    const dx = e.clientX - this.lastMouse.x
    const dy = e.clientY - this.lastMouse.y
    this.rotY += dx * 0.008
    this.rotX += dy * 0.008
    this.lastMouse = { x: e.clientX, y: e.clientY }
    this.render()
  }

  _onWheel (e) {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    this.zoom = Math.max(2, Math.min(600, this.zoom * factor))
    this.render()
  }

  _onClick (e) {
    if (this._wasDrag) { this._wasDrag = false; return }
    const rect  = this.canvas.getBoundingClientRect()
    const mx    = (e.clientX - rect.left) * this.canvas.width / (rect.width || this.canvas.clientWidth || 1)
    const my    = (e.clientY - rect.top) * this.canvas.height / (rect.height || this.canvas.clientHeight || 1)
    const hit   = this._hitTest(mx, my)
    if (hit !== null) {
      if (this.selected.has(hit)) this.selected.delete(hit)
      else                        this.selected.add(hit)
      this.render()
      this.onSelectionChange?.([...this.selected])
    }
  }

  setSelected (ids) {
    this.selected = new Set(ids.map(Number))
    this.render()
  }

  cellVertices () {
    return Array.from({ length: 8 }, (_, mask) => [0, 1, 2].map(axis =>
      this.cell.reduce((sum, vector, i) => sum + (mask & (1 << i) ? vector[axis] : 0), 0)))
  }

  fitView () {
    if (!this.atoms.length) return
    const points = this.atoms.map(atom => [atom.x, atom.y, atom.z]).concat(this.cell ? this.cellVertices() : [])
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
    for (const point of points) for (let j = 0; j < 3; j++) {
      low[j] = Math.min(low[j], point[j]); high[j] = Math.max(high[j], point[j])
    }
    this.center = low.map((v, j) => (v + high[j]) / 2)
    const [cx, cy, cz] = this.center
    const maxD = points.reduce((distance, point) => Math.max(distance, Math.hypot(point[0] - cx, point[1] - cy, point[2] - cz)), 0) || 1
    this.zoom = Math.min(this.canvas.width, this.canvas.height) * .34 / maxD
    this.render()
  }

  resize () {
    const { canvas } = this
    canvas.width  = canvas.clientWidth
    canvas.height = canvas.clientHeight
    this.render()
  }
}

// =============================================================================
// ── App State ────────────────────────────────────────────────────────────────
// =============================================================================

const state = {
  step:          1,
  filePath:      null,
  fileInfo:      null,   // { format, configCount, atomCount }
  frequency:     10,
  firstFrame:    null,   // [{ index, element, x, y, z }]
  selectedAtoms: new Set(),
  outputDir:     null,
  source: { original: null, format: 'auto', reference: null, cellFile: null, label: null },
  opts: {
    computeAverage:   true,
    generateGaussian: true
  }
}

// =============================================================================
// ── DOM helpers ──────────────────────────────────────────────────────────────
// =============================================================================

const $  = id  => document.getElementById(id)
const $$ = sel => document.querySelectorAll(sel)

function setStatus (msg) { $('status-msg').textContent = msg }

function log (msg, type = 'info') {
  const box  = $('log-box')
  const line = document.createElement('div')
  line.className = `log-line log-${type}`
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  box.appendChild(line)
  box.scrollTop = box.scrollHeight
}

// =============================================================================
// ── Step navigation ──────────────────────────────────────────────────────────
// =============================================================================

function goTo (step) {
  $$('.step-panel').forEach(p => p.classList.remove('active'))
  $$('.step-item').forEach(n => {
    n.classList.remove('active', 'done')
    const ns = parseInt(n.dataset.step, 10)
    if (ns < step)  n.classList.add('done')
    if (ns === step) n.classList.add('active')
  })
  $(`panel-${step}`).classList.add('active')
  state.step = step
}

// =============================================================================
// ── Viewer setup ─────────────────────────────────────────────────────────────
// =============================================================================

const canvas = $('mol-canvas')
const viewer = new MolecularViewer(canvas)

function resizeCanvas () {
  canvas.width  = canvas.clientWidth
  canvas.height = canvas.clientHeight
  viewer.render()
}

window.addEventListener('resize', resizeCanvas)

viewer.onSelectionChange = ids => {
  state.selectedAtoms = new Set(ids)
  // sync with table + input
  syncSelectionUI()
}

function syncSelectionUI () {
  const ids = [...state.selectedAtoms]
  $('sel-count').textContent = ids.length
  $('inp-atom-ids').value    = ids.sort((a,b) => a-b).join(' ')
  viewer.setSelected(ids)
  // update table checkboxes
  $$('#atom-table-body tr').forEach(row => {
    const id  = parseInt(row.dataset.atomId, 10)
    const chk = row.querySelector('.row-chk')
    if (chk) chk.checked = state.selectedAtoms.has(id)
    row.classList.toggle('row-selected', state.selectedAtoms.has(id))
  })
  $('next-3').disabled = ids.length === 0
}

// =============================================================================
// ── Step 1 — File Input ──────────────────────────────────────────────────────
// =============================================================================

function clearTrajectory () {
  state.fileInfo = null
  state.firstFrame = null
  state.selectedAtoms.clear()
  state.lastResult = null
  updateAnalysisSource()
  if (typeof charts !== 'undefined') Object.values(charts).forEach(chart => chart.clear())
  $('next-2').disabled = true
  $('stat-format').textContent = '—'
  $('stat-configs').textContent = '—'
  $('stat-atoms').textContent = '—'
  $('sampled-count').textContent = '—'
  $('viewer-title').textContent = '3D Molecular Viewer'
  $('viewer-overlay').classList.remove('hidden')
  viewer.loadAtoms([])
  $('atom-table-body').innerHTML = ''
  syncSelectionUI()
}

const FORMAT_HINTS = {
  auto: 'XYZ/extXYZ files are read directly; other files are recognised by name and content and imported.',
  xyz: 'Read directly. Add a CP2K .cell file to attach a per-step lattice (NPT runs).',
  'qe-cp-pos': 'cp.x positions in bohr. Needs a reference structure with the same atom order; add the .cel file for the cell.',
  'cp2k-dcd': 'DCD has no element names: add a reference structure (e.g. the first frame as XYZ).',
  'cpmd-trajectory': 'CPMD TRAJECTORY (bohr). Needs a reference structure with the same atom order; restart markers are skipped.',
  qbox: 'Reads every MD iteration (<atomset>) from the Qbox output.',
  'espresso-out': 'Reads every ionic step of a pw.x relax/MD output.',
  'orca-output': 'Reads the geometries printed in the ORCA output. ORCA MD trajectories (.xyz) are read directly as XYZ.'
}
const REFERENCE_FORMATS = new Set(['qe-cp-pos', 'cp2k-dcd', 'cpmd-trajectory'])
const CELL_FORMATS = new Set(['auto', 'xyz', 'qe-cp-pos', 'cpmd-trajectory'])

function updateFormatUI () {
  const format = $('inp-format').value
  state.source.format = format
  $('aux-reference').classList.toggle('hidden', !REFERENCE_FORMATS.has(format) && !state.source.reference)
  $('aux-cell').classList.toggle('hidden', !CELL_FORMATS.has(format) && !state.source.cellFile)
  $('inp-cell-vectors').classList.toggle('hidden', format !== 'qe-cp-pos')
  const canImport = Boolean(window.monet.canImport)
  $('format-hint').textContent = (FORMAT_HINTS[format] || 'Imported with ASE into extended XYZ.') +
    (canImport ? '' : ' Only XYZ is available in this mode: run python3 start_monet.py to import other formats.')
}
$('inp-format').addEventListener('change', updateFormatUI)

function needsImport () {
  const { original, format, cellFile } = state.source
  if (cellFile) return true
  if (format === 'xyz') return false
  return format !== 'auto' || !/\.(xyz|extxyz)$/i.test(original || '')
}

for (const [kind, button, clear, label] of [['reference', 'btn-reference', 'btn-reference-clear', 'reference-path'], ['cellFile', 'btn-cell-file', 'btn-cell-file-clear', 'cell-file-path']]) {
  $(button).addEventListener('click', async () => {
    try {
      const fp = await window.monet.selectFile()
      if (!fp) return
      state.source[kind] = fp
      $(label).textContent = fp
      updateFormatUI()
    } catch (error) { setStatus('Could not open file: ' + error.message) }
  })
  $(clear).addEventListener('click', () => {
    state.source[kind] = null
    $(label).textContent = 'Not selected'
    updateFormatUI()
  })
}

function releaseTrajectory () {
  for (const name of new Set([state.source.original, state.filePath])) {
    if (name && name !== aseState.convInput) window.monet.releaseFile?.(name)
  }
}

$('btn-browse').addEventListener('click', async () => {
  setStatus('Selecting file …')
  try {
    const fp = await window.monet.selectFile()
    if (!fp) { setStatus('Ready'); return }
    releaseTrajectory()
    clearTrajectory()
    state.source.original = fp
    state.source.label = null
    state.filePath = fp
    $('file-path-text').textContent = fp
    $('file-display').classList.remove('hidden')
    $('next-1').disabled = false
    setStatus('File selected: ' + fp.split(/[\\/]/).pop())
  } catch (error) {
    setStatus('Could not open file: ' + error.message)
  }
})

$('next-1').addEventListener('click', async () => {
  goTo(2)
  $('back-2').disabled = true
  $('next-2').disabled = true
  setStatus('Analysing trajectory …')
  try {
    if (state.filePath !== state.source.original) {
      window.monet.releaseFile?.(state.filePath)
      state.filePath = state.source.original
    }
    state.source.label = null
    if (needsImport()) {
      if (!window.monet.importFile) throw new Error('Importing this format needs the launcher (python3 start_monet.py) or the desktop app.')
      setStatus('Importing trajectory with ASE …')
      const imported = await window.monet.importFile(state.source.original, {
        format: state.source.format, reference: state.source.reference, cellFile: state.source.cellFile,
        cellVectors: $('inp-cell-vectors').value
      })
      if (imported.error) throw new Error(imported.error)
      state.filePath = imported.filePath
      state.source.label = imported.sourceLabel
    }
    const info = await window.monet.analyzeFile(state.filePath)
    if (info.error) throw new Error(info.error)
    state.fileInfo = info
    $('stat-format').textContent = state.source.label ? `${state.source.label} → extXYZ` : info.format
    $('stat-configs').textContent = info.configCount.toLocaleString()
    $('stat-atoms').textContent = info.atomCount.toLocaleString()
    updateSampledCount()
    await loadFrameForViewer(0)
    updateSampledCount()
    updateAnalysisSource()
  } catch (error) {
    clearTrajectory()
    setStatus('Error: ' + error.message)
  } finally {
    $('back-2').disabled = false
  }
})

// =============================================================================
// ── Step 2 — Sampling ────────────────────────────────────────────────────────
// =============================================================================

$('inp-freq').addEventListener('input', updateSampledCount)

function updateSampledCount () {
  const freq = Number($('inp-freq').value)
  const valid = Number.isInteger(freq) && freq > 0
  $('next-2').disabled = !valid || !state.fileInfo
  if (!valid) { $('sampled-count').textContent = '—'; return }
  state.frequency = freq
  if (!state.fileInfo) return
  const n = Math.floor((state.fileInfo.configCount - 1) / freq) + 1
  $('sampled-count').textContent = n.toLocaleString()
}

$('back-2').addEventListener('click', () => goTo(1))

$('next-2').addEventListener('click', () => {
  const frequency = Number($('inp-freq').value)
  if (!Number.isInteger(frequency) || frequency < 1) return setStatus('Sampling frequency must be a positive integer.')
  state.frequency = frequency
  goTo(3)
})

// =============================================================================
// ── Load first frame into viewer & table ─────────────────────────────────────
// =============================================================================

async function loadFrameForViewer (frameIdx) {
  if (!state.filePath || !state.fileInfo) return
  setStatus('Loading frame …')

  const result = await window.monet.readFrame(
    state.filePath, frameIdx, state.fileInfo.atomCount
  )
  if (result.error) throw new Error(result.error)
  $('viewer-overlay').classList.add('hidden')

  state.firstFrame = result.atoms
  viewer.loadAtoms(result.atoms)
  buildAtomTable(result.atoms)
  resizeCanvas()
  setStatus(`Frame ${frameIdx} loaded · ${result.atoms.length} atoms`)
  $('viewer-title').textContent = `Frame ${frameIdx} — ${result.atoms.length} atoms`
}

function buildAtomTable (atoms) {
  const tbody = $('atom-table-body')
  tbody.innerHTML = ''
  for (const a of atoms) {
    const tr = document.createElement('tr')
    tr.dataset.atomId = a.index
    tr.classList.toggle('row-selected', state.selectedAtoms.has(a.index))
    tr.innerHTML = `
      <td class="td-id">${a.index}</td>
      <td class="td-el"><span class="el-badge" style="background:${atomColor(a.element)}">${a.element}</span></td>
      <td>${a.x.toFixed(3)}</td>
      <td>${a.y.toFixed(3)}</td>
      <td>${a.z.toFixed(3)}</td>
      <td><input type="checkbox" class="row-chk" ${state.selectedAtoms.has(a.index) ? 'checked' : ''} /></td>
    `
    tr.querySelector('.row-chk').addEventListener('change', evt => {
      if (evt.target.checked) state.selectedAtoms.add(a.index)
      else                    state.selectedAtoms.delete(a.index)
      syncSelectionUI()
    })
    tr.addEventListener('click', evt => {
      if (evt.target.type === 'checkbox') return
      if (state.selectedAtoms.has(a.index)) state.selectedAtoms.delete(a.index)
      else                                  state.selectedAtoms.add(a.index)
      syncSelectionUI()
    })
    tbody.appendChild(tr)
  }
}

function atomColor (el) { return CPK[el] ?? DEFAULT_COLOR }

// =============================================================================
// ── Step 3 — Atom Selection ──────────────────────────────────────────────────
// =============================================================================

$('btn-apply-ids').addEventListener('click', () => {
  const raw = $('inp-atom-ids').value.trim()
  const ids = raw.split(/[\s,]+/).map(Number).filter(n => Number.isInteger(n) && n > 0 && n <= (state.fileInfo?.atomCount || 0))
  state.selectedAtoms = new Set(ids)
  syncSelectionUI()
})

$('btn-clear-sel').addEventListener('click', () => {
  state.selectedAtoms.clear()
  syncSelectionUI()
})

$('back-3').addEventListener('click', () => goTo(2))

$('next-3').addEventListener('click', () => goTo(4))

// =============================================================================
// ── Step 4 — Options ─────────────────────────────────────────────────────────
// =============================================================================

$('opt-average').addEventListener('change',  e => { state.opts.computeAverage   = e.target.checked })

// Quantum-chemistry inputs: editable templates (kept for the session) + common parameters.
const qmTemplates = Object.fromEntries(Object.entries(MonetQM.CODES).map(([code, def]) => [code, def.files.map(file => ({ ...file }))]))
const qmCodes = () => [...$$('[data-qm-code]')].filter(input => input.checked).map(input => input.dataset.qmCode)

function buildQmSpec () {
  const codes = qmCodes()
  if (!codes.length) return null
  const spec = MonetQM.defaultSpec(codes)
  for (const code of codes) spec.codes[code].files = qmTemplates[code].map(file => ({ ...file }))
  const mults = $('qm-mults').value.trim().split(/[\s,]+/).filter(Boolean).map(Number)
  Object.assign(spec.params, {
    charge: Number($('qm-charge').value), multiplicities: mults, nproc: Number($('qm-nproc').value),
    mem: $('qm-mem').value.trim(), method: $('qm-method').value.trim(), basis: $('qm-basis').value.trim(),
    padding: Number($('qm-padding').value)
  })
  spec.cell = aseState.cellParameters ? MonetASEModel.cellVectors(aseState.cellParameters) : null
  return MonetQM.validate(spec)
}

function updateQmUI () {
  const codes = qmCodes()
  state.opts.generateGaussian = codes.includes('gaussian')
  $('gaussian-details').classList.toggle('disabled', !codes.length)
  const select = $('qm-template-file'), previous = select.value
  select.replaceChildren()
  for (const code of codes) {
    qmTemplates[code].forEach((file, i) => {
      const option = document.createElement('option')
      option.value = `${code}:${i}`
      option.textContent = `${MonetQM.CODES[code].label} — ${file.name}`
      select.appendChild(option)
    })
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous
  showTemplate()
  try {
    buildQmSpec()
    $('qm-status').textContent = codes.length ? `Inputs for: ${codes.map(code => MonetQM.CODES[code].label).join(', ')}.` : 'No quantum-chemistry inputs will be written.'
  } catch (error) { $('qm-status').textContent = error.message }
}

function selectedTemplate () {
  const [code, index] = ($('qm-template-file').value || '').split(':')
  return code ? { code, index: Number(index) } : null
}
function showTemplate () {
  const target = selectedTemplate()
  $('qm-template-text').value = target ? qmTemplates[target.code][target.index].template : ''
  $('qm-template-text').disabled = !target
}
$$('[data-qm-code]').forEach(input => input.addEventListener('change', updateQmUI))
for (const id of ['qm-charge', 'qm-mults', 'qm-nproc', 'qm-mem', 'qm-method', 'qm-basis', 'qm-padding']) $(id).addEventListener('input', updateQmUI)
$('qm-template-file').addEventListener('change', showTemplate)
$('qm-template-text').addEventListener('input', () => {
  const target = selectedTemplate()
  if (target) qmTemplates[target.code][target.index].template = $('qm-template-text').value
})
$('qm-template-reset').addEventListener('click', () => {
  const target = selectedTemplate()
  if (!target) return
  qmTemplates[target.code][target.index] = { ...MonetQM.CODES[target.code].files[target.index] }
  showTemplate()
})

$('btn-output-dir').addEventListener('click', async () => {
  const dir = await window.monet.selectOutputDir()
  if (!dir) return
  state.outputDir = dir
  $('output-dir-text').textContent = dir
  $('next-4').disabled = false
})

$('back-4').addEventListener('click', () => goTo(3))

$('next-4').addEventListener('click', () => {
  try { state.opts.qm = buildQmSpec() } catch (error) {
    $('qm-status').textContent = error.message
    return setStatus(error.message)
  }
  goTo(5)
  runProcessing().catch(error => {
    log('ERROR: ' + error.message, 'error')
    setStatus('Processing failed: ' + error.message)
    $('retry-processing').classList.remove('hidden')
  })
})

// =============================================================================
// ── Step 5 — Processing ──────────────────────────────────────────────────────
// =============================================================================

const PROGRESS_STEPS = {
  extraction: 0.40,
  folders:    0.30,
  average:    0.20,
  gaussian:   0.10
}

let progressAccum = 0

window.monet.onProgress(data => {
  log(data.message, data.status === 'done' ? 'success' : 'info')
  setStatus(data.message)

  if (data.step === 'extraction' && Number.isFinite(data.percent)) {
    setProgress(Math.min(data.percent * PROGRESS_STEPS.extraction / .4, 95))
  } else if (data.status === 'done' && PROGRESS_STEPS[data.step]) {
    progressAccum += PROGRESS_STEPS[data.step] * 100
    setProgress(Math.min(progressAccum, 95))
  }
})

function setProgress (pct) {
  $('prog-fill').style.width  = pct + '%'
  $('prog-label').textContent = Math.round(pct) + '%'
}

async function runProcessing () {
  progressAccum = 0
  setProgress(0)
  $('log-box').innerHTML = ''
  $('next-5').classList.add('hidden')
  $('download-results').classList.add('hidden')
  $('retry-processing').classList.add('hidden')

  log(`Starting MONET processing …`, 'info')
  log(`File     : ${state.filePath}`)
  log(`Atoms    : ${[...state.selectedAtoms].sort((a,b)=>a-b).join(', ')}`)
  log(`Frequency: every ${state.frequency} frames`)
  log(`QM inputs: ${state.opts.qm ? Object.keys(state.opts.qm.codes).join(', ') : 'none'}`)
  log(`Output   : ${state.outputDir}`)
  log('')

  const processedIds = [...state.selectedAtoms]
  const sourceAtoms = MonetASEModel.atomMap(state.firstFrame, processedIds)
  $('cancel-processing').classList.remove('hidden')
  $('cancel-processing').disabled = !window.monet.cancel
  const result = await window.monet.processTrajectory({
    filePath:         state.filePath,
    outputDir:        state.outputDir,
    atomCount:        state.fileInfo.atomCount,
    configCount:      state.fileInfo.configCount,
    selectedAtoms:    processedIds,
    frequency:        state.frequency,
    computeAverage:   state.opts.computeAverage,
    generateGaussian: false,
    ...(state.opts.qm ? { qm: state.opts.qm } : {})
  })
  $('cancel-processing').classList.add('hidden')

  if (result.error) {
    log('ERROR: ' + result.error, 'error')
    setStatus('Processing failed: ' + result.error)
    $('retry-processing').classList.remove('hidden')
    return
  }

  setProgress(100)
  log(`Done! ${result.totalFrames} frames processed · ${result.sampledFrames} sampled.`, 'success')
  setStatus('Processing complete!')

  if (result.downloadURL) {
    $('download-results').href = result.downloadURL
    $('download-results').classList.remove('hidden')
    setStatus('Processing complete. Click Download results ZIP to save the files.')
  }
  result.sourceAtoms = sourceAtoms
  state.lastResult = result
  updateAnalysisSource()
  $('next-5').classList.remove('hidden')
}

$('retry-processing').addEventListener('click', () => goTo(4))
$('cancel-processing').addEventListener('click', async () => {
  $('cancel-processing').disabled = true
  log('Cancelling …')
  await window.monet.cancel?.('extraction')
})

$('next-5').addEventListener('click', () => {
  buildResultsView(state.lastResult)
  goTo(6)
})

// =============================================================================
// ── Step 6 — Results ─────────────────────────────────────────────────────────
// =============================================================================

function qmSummary () {
  const spec = state.opts.qm
  if (!spec) return ''
  return ', ' + Object.keys(spec.codes).map(code => {
    const folder = MonetQM.CODES[code].folder
    const names = spec.codes[code].files.map(file => /\{(tag|mult|state|chk)\}/.test(file.name)
      ? spec.params.multiplicities.map(m => file.name.replace('{tag}', MonetQM.stateOf(m).tag)).join(', ') : file.name)
    return folder ? `${folder}/ (${names.join(', ')})` : names.join(', ')
  }).join('; ')
}

function buildResultsView (result) {
  $('result-summary').innerHTML = `
    <div class="result-stat"><span>Total frames</span><strong>${result.totalFrames.toLocaleString()}</strong></div>
    <div class="result-stat"><span>Sampled confs</span><strong>${result.sampledFrames.toLocaleString()}</strong></div>
    <div class="result-stat"><span>Selected atoms</span><strong>${state.selectedAtoms.size}</strong></div>
  `

  const tree = [
    { icon: '📁', label: '0-HISTORY/',         sub: ['run.json'] },
    { icon: '📁', label: '1-FULL_TRAJECTORY_EXTRACTED/', sub: ['FULL_TRAJECTORY_EXTRACTED.xyz'] },
    { icon: '📁', label: '2-SAMPLED_CONFIGURATIONS/',
      sub: [
        'SAMPLED_CONFIGURATIONS.xyz',
        `conf1/ … conf${result.sampledFrames}/ (pos*.txt${qmSummary()})`
      ]
    },
    ...(state.opts.computeAverage
      ? [{ icon: '📁', label: '3-AVERAGE_STRUCTURE/', sub: ['GEO-AVERAGE.xyz'] }]
      : [])
  ]

  $('result-tree').innerHTML = tree.map(node => `
    <div class="tree-node">
      <div class="tree-dir">${node.icon} <code>${result.outputDir}/${node.label}</code></div>
      ${node.sub.map(s => `<div class="tree-file">└─ ${s}</div>`).join('')}
    </div>
  `).join('')
}

$('back-6').addEventListener('click', () => {
  // Reset for a new run
  state.filePath      = null
  state.fileInfo      = null
  state.frequency     = 10
  state.firstFrame    = null
  state.selectedAtoms = new Set()
  state.outputDir     = window.monet.isBrowser ? 'MONET-results' : null
  releaseTrajectory()
  state.source.original = null
  state.source.label = null
  clearTrajectory()
  $('next-4').disabled = !window.monet.isBrowser
  $('output-dir-text').textContent = window.monet.isBrowser ? 'Download results as a ZIP file' : 'Not selected'

  $('file-display').classList.add('hidden')
  $('next-1').disabled = true
  $('inp-freq').value  = 10
  $('viewer-overlay').classList.remove('hidden')
  viewer.loadAtoms([])
  $('atom-table-body').innerHTML = ''
  $('log-box').innerHTML         = ''

  goTo(1)
  setStatus('Ready')
})

// =============================================================================
// ── Viewer tab switching ─────────────────────────────────────────────────────
// =============================================================================

$$('.vtab').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.vtab
    $$('.vtab').forEach(b => b.classList.remove('active'))
    $$('.vtab-content').forEach(c => c.classList.remove('active'))
    btn.classList.add('active')
    $(`vtab-content-${id}`).classList.add('active')
    if (id === 'view3d') resizeCanvas()
    else redrawVisibleChart()
  })
})

$('open-ase-btn').addEventListener('click', () => {
  $$('.vtab').forEach(b => b.classList.remove('active'))
  $$('.vtab-content').forEach(c => c.classList.remove('active'))
  $('vtab-ase').classList.add('active')
  $('vtab-content-ase').classList.add('active')
  redrawVisibleChart()
})

function redrawVisibleChart () {
  resizeAseViewer()
  for (const chart of Object.values(charts)) if (chart.data && chart.canvas.clientWidth && chart.canvas.clientHeight) chart._render()
}
window.addEventListener('resize', redrawVisibleChart)

// ASE sub-tab switching
$$('.ase-stab').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.stab
    $$('.ase-stab').forEach(b => b.classList.remove('active'))
    $$('.ase-subpanel').forEach(p => p.classList.remove('active'))
    btn.classList.add('active')
    $(`ase-sub-${id}`).classList.add('active')
    if (charts[id]?.data) charts[id]._render()
    if (selectionTargets[id]) { $('ase-selection-target').value = id; updateSelectionTarget() }
  })
})

// =============================================================================
// ── LineChart — canvas-based scientific line chart ───────────────────────────
// =============================================================================

// Series colors are resolved from the active theme when a chart is drawn.
window.addEventListener('monet-theme', () => {
  viewer.render()
  aseViewer.render()
  redrawVisibleChart()
})

// =============================================================================
// ── ASE panel state + helpers ────────────────────────────────────────────────
// =============================================================================

const aseState = {
  available:   false,
  version:     null,
  convInput:   null,
  convOutput:  null,
  busy: false,
  activeKind: null,
  sourceRevision: 0,
  analysisAtoms: [],
  pickedIds: [],
  cellParameters: null,
  mic: true,
  cellPbc: [true, true, true],
  cellSource: null
}

const aseViewer = new MolecularViewer($('ase-mol-canvas'))
aseViewer.showAllLabels = true
aseViewer.showSelectionOrder = true
let aseViewerNeedsFit = true

function resizeAseViewer () {
  if (!$('ase-mol-canvas').clientWidth || !$('ase-mol-canvas').clientHeight) return
  aseViewer.resize()
  if (aseViewerNeedsFit) { aseViewer.fitView(); aseViewerNeedsFit = false }
}
window.addEventListener('resize', resizeAseViewer)

function syncAsePicks (ids) {
  const valid = new Set(aseState.analysisAtoms.map(atom => atom.monetId))
  aseState.pickedIds = [...new Set(ids)].filter(id => valid.has(id))
  aseViewer.setSelected(aseState.pickedIds)
  $('ase-picked-count').textContent = aseState.pickedIds.length
  const chips = $('ase-picked-atoms')
  chips.replaceChildren()
  if (!aseState.pickedIds.length) chips.textContent = 'No atoms selected.'
  aseState.pickedIds.forEach((id, order) => {
    const atom = aseState.analysisAtoms.find(atom => atom.monetId === id)
    const chip = document.createElement('button')
    chip.className = 'ase-pick-chip'
    chip.textContent = `${order + 1}: ${id} (${atom.element}) ×`
    chip.title = `Remove MONET atom ${id} from the selection`
    chip.addEventListener('click', () => syncAsePicks(aseState.pickedIds.filter(value => value !== id)))
    chips.appendChild(chip)
  })
  $$('#ase-atom-body tr').forEach(row => {
    const picked = aseState.pickedIds.includes(Number(row.dataset.monetId))
    row.classList.toggle('row-selected', picked)
    row.setAttribute('aria-selected', String(picked))
  })
  $('ase-clear-selection').disabled = !aseState.pickedIds.length
  $('ase-use-selection').disabled = !aseState.pickedIds.length
}
aseViewer.onSelectionChange = syncAsePicks
$('ase-clear-selection').addEventListener('click', () => syncAsePicks([]))
$('ase-fit-view').addEventListener('click', () => {
  aseViewer.rotX = .25; aseViewer.rotY = -.40
  aseViewerNeedsFit = true
  resizeAseViewer()
})

const cellFields = ['a', 'b', 'c', 'alpha', 'beta', 'gamma']
function updateCellPreset () {
  const system = $('cell-system').value
  const disabled = {
    triclinic: [], monoclinic: ['alpha', 'gamma'], orthorhombic: ['alpha', 'beta', 'gamma'],
    tetragonal: ['b', 'alpha', 'beta', 'gamma'], hexagonal: ['b', 'alpha', 'beta', 'gamma'],
    rhombohedral: ['b', 'c', 'beta', 'gamma'], cubic: ['b', 'c', 'alpha', 'beta', 'gamma']
  }[system]
  for (const field of cellFields) $(`cell-${field}`).disabled = disabled.includes(field)
  try {
    const parameters = MonetASEModel.cellParameters(system, cellFields.map(field => $(`cell-${field}`).value))
    parameters.forEach((value, i) => { $(`cell-${cellFields[i]}`).value = value })
  } catch {}
}
$('cell-system').addEventListener('change', updateCellPreset)
for (const field of cellFields) $(`cell-${field}`).addEventListener('input', updateCellPreset)
function invalidateCellAnalyses () {
  aseState.sourceRevision++
  clearAllAnalyses(false)
  aseViewer.cell = aseState.cellParameters ? MonetASEModel.cellVectors(aseState.cellParameters) : null
  aseViewerNeedsFit = true
  resizeAseViewer()
  $('cell-status').textContent = aseState.cellParameters
    ? `Applied cell: ${aseState.cellParameters.join(', ')} (Å, °). PBC: ${aseState.cellPbc.map((on,i) => on ? 'abc'[i] : '').join('') || 'none'}.`
    : 'No manual cell. Source lattice/PBC are used when present.'
}
$('cell-apply').addEventListener('click', () => {
  try {
    if (!aseState.analysisAtoms.length) throw new Error('Load a trajectory before applying a cell.')
    aseState.cellParameters = MonetASEModel.cellParameters($('cell-system').value, cellFields.map(field => $(`cell-${field}`).value))
    aseState.cellPbc = ['a', 'b', 'c'].map(axis => $(`cell-pbc-${axis}`).checked)
    invalidateCellAnalyses()
    setStatus('Crystal cell applied without changing Cartesian coordinates.')
  } catch (error) { $('cell-status').textContent = error.message; setStatus(error.message) }
})
$('cell-reset').addEventListener('click', () => {
  aseState.cellParameters = null
  invalidateCellAnalyses()
})
$('ase-mic').addEventListener('change', () => {
  aseState.mic = $('ase-mic').checked
  invalidateCellAnalyses()
})
function cellOptions () {
  return { ...(aseState.cellParameters ? { cell: aseState.cellParameters, pbc: aseState.cellPbc } : {}), mic: aseState.mic }
}
$('cell-read').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename || aseState.busy || !aseState.available) return setStatus('Load a trajectory and connect ASE first.')
  const revision = aseState.sourceRevision
  aseState.busy = true; updateAseControls()
  try {
    const info = await window.monet.aseRun({ action: 'read_info', filename })
    if (revision !== aseState.sourceRevision) return
    if (!info.ok) throw new Error(info.message || info.error)
    MonetASEModel.verifyAtoms(aseState.analysisAtoms, info)
    if (!info.cellpar || info.cellpar.slice(0, 3).some(v => v <= 0)) throw new Error('The active XYZ contains no complete cell. Enter the six parameters manually.')
    $('cell-system').value = 'triclinic'
    info.cellpar.forEach((v, i) => { $(`cell-${cellFields[i]}`).value = v })
    ;['a', 'b', 'c'].forEach((axis,i) => { $(`cell-pbc-${axis}`).checked = Boolean(info.pbc[i]) })
    updateCellPreset()
    aseState.cellParameters = null
    aseState.sourceRevision++; clearAllAnalyses(false)
    // Preserve the source vectors' orientation, rather than rebuilding from metrics.
    aseViewer.cell = info.cell
    aseViewerNeedsFit = true; resizeAseViewer()
    $('cell-status').textContent = `Using source cell (${info.cellpar.map(v => Number(v.toFixed(5))).join(', ')}); original vector orientation retained. Apply cell would replace it with the standard orientation.`
  } catch (error) { $('cell-status').textContent = error.message; setStatus(error.message) }
  finally { aseState.busy = false; updateAseControls() }
})

let contextAtom = null
function hideAtomMenu () { $('ase-context-menu').classList.add('hidden') }
function showAtomMenu (event, id) {
  event.preventDefault()
  if (id === null) { hideAtomMenu(); return }
  contextAtom = id
  const menu = $('ase-context-menu')
  $('ase-select-molecule').textContent = `Select molecule containing atom ${id}`
  $('ase-select-molecule').disabled = !aseState.available || aseState.busy
  menu.style.left = Math.max(0, Math.min(event.clientX, window.innerWidth - 290)) + 'px'
  menu.style.top = Math.max(0, Math.min(event.clientY, window.innerHeight - 70)) + 'px'
  menu.classList.remove('hidden')
  $('ase-select-molecule').focus()
}
$('ase-mol-canvas').addEventListener('contextmenu', event => {
  const canvas = $('ase-mol-canvas'), rect = canvas.getBoundingClientRect()
  const x = (event.clientX - rect.left) * canvas.width / (rect.width || canvas.clientWidth || 1)
  const y = (event.clientY - rect.top) * canvas.height / (rect.height || canvas.clientHeight || 1)
  showAtomMenu(event, aseViewer._hitTest(x, y))
})
document.addEventListener('click', hideAtomMenu)
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideAtomMenu() })
$('ase-select-molecule').addEventListener('click', async () => {
  const atom = aseState.analysisAtoms.find(atom => atom.monetId === contextAtom)
  if (!atom || aseState.busy || !aseState.available) return
  const revision = aseState.sourceRevision
  const filename = extractedTrajPath(), options = cellOptions()
  const mapping = aseState.analysisAtoms.map(atom => ({ ...atom }))
  aseState.busy = true; updateAseControls(); hideAtomMenu()
  try {
    setStatus('Finding bonded molecule …')
    const info = await window.monet.aseRun({ action: 'read_info', filename, ...options })
    if (revision !== aseState.sourceRevision) return
    MonetASEModel.verifyAtoms(mapping, info)
    const result = await window.monet.aseRun({ action: 'molecule', filename, seed: atom.aseIndex,
      bond_scale: Number($('ase-bond-scale').value), ...options })
    if (revision !== aseState.sourceRevision) return setStatus('Molecule selection discarded because the source changed.')
    if (!result.ok) throw new Error(result.message || result.error)
    syncAsePicks(result.indices.map(index => mapping[index].monetId))
    setStatus(`Selected ${result.indices.length} atoms in the molecule. IDs start at the clicked atom in graph order; pick ordered groups for angles or dihedrals.`)
  } catch (error) { setStatus('Molecule selection: ' + error.message) }
  finally { aseState.busy = false; updateAseControls() }
})

const ACF_WIDTH = { bond: 2, angle: 3, dihedral: 4 }
const selectionTargets = {
  rmsd: { input: 'rmsd-atoms', minimum: 1 },
  pdd: { input: 'pdd-atoms', minimum: 2 },
  bonds: { input: 'bonds-pairs', width: 2 },
  angles: { input: 'angles-triplets', width: 3 },
  dihedrals: { input: 'dihedrals-quads', width: 4 },
  rmsdmatrix: { input: 'rmsdmatrix-atoms', minimum: 1 },
  rdf: { input: 'rdf-atoms', minimum: 1 },
  msd: { input: 'msd-atoms', minimum: 1 },
  vdos: { input: 'vdos-atoms', minimum: 1 },
  acf: {
    input: 'acf-groups',
    get width () { return ACF_WIDTH[$('acf-quantity').value] },
    get minimum () { return 1 }
  }
}
function updateSelectionTarget () {
  const target = selectionTargets[$('ase-selection-target').value]
  $('ase-append-group').disabled = !target.width
  $('ase-selection-hint').textContent = target.width
    ? `Select atoms in groups of ${target.width}, in order. Use selection to fill the IDs; then click Compute.`
    : `Select at least ${target.minimum} atom${target.minimum > 1 ? 's' : ''}. Use selection to restrict this analysis to those atoms.`
}
$('ase-selection-target').addEventListener('change', updateSelectionTarget)
$('ase-use-selection').addEventListener('click', () => {
  const kind = $('ase-selection-target').value
  const target = selectionTargets[kind]
  const raw = aseState.pickedIds.join(' ')
  try {
    if (target.width) MonetASEModel.groupsFromIds(raw, target.width, aseState.analysisAtoms)
    else MonetASEModel.selectedIndices(raw, aseState.analysisAtoms, target.minimum)
    const input = $(target.input)
    input.value = target.width && $('ase-append-group').checked && input.value.trim()
      ? `${input.value.trim()}  ${raw}` : raw
    document.querySelector(`.ase-stab[data-stab="${kind}"]`).click()
    setStatus('Selected MONET IDs applied. Click Compute to run the analysis.')
  } catch (error) {
    $('ase-selection-hint').textContent = error.message
    setStatus(error.message)
  }
})

const charts = {
  rmsd:   new MonetLineChart('chart-rmsd',   'chart-rmsd-ph'),
  pdd:    new MonetLineChart('chart-pdd',    'chart-pdd-ph'),
  bonds:  new MonetLineChart('chart-bonds',  'chart-bonds-ph'),
  angles: new MonetLineChart('chart-angles', 'chart-angles-ph'),
  dihedrals: new MonetLineChart('chart-dihedrals', 'chart-dihedrals-ph'),
  rmsdmatrix: new MonetHeatmapChart('chart-rmsdmatrix', 'chart-rmsdmatrix-ph'),
  rdf: new MonetLineChart('chart-rdf', 'chart-rdf-ph'),
  msd: new MonetLineChart('chart-msd', 'chart-msd-ph'),
  vdos: new MonetLineChart('chart-vdos', 'chart-vdos-ph'),
  acf: new MonetLineChart('chart-acf', 'chart-acf-ph'),
  acfdist: new MonetLineChart('chart-acfdist', 'chart-acfdist-ph'),
}
const RUN_KINDS = ['rmsd', 'pdd', 'bonds', 'angles', 'dihedrals', 'rmsdmatrix', 'rdf', 'msd', 'vdos', 'acf']
const lastResults = {}

// Wire up ASE progress listener (once)
window.monet.onAseProgress(msg => {
  setStatus(msg.message)
})

function setAseProgress (fillId, labelId, rowId, pct, msg) {
  const row = $(rowId)
  row.classList.remove('hidden')
  $(fillId).style.width  = (pct ?? 0) + '%'
  $(labelId).textContent = msg || ''
}

function hideAseProgress (rowId) {
  $(rowId)?.classList.add('hidden')
}

function extractedTrajPath () {
  if (state.lastResult?.success) return `${state.lastResult.outputDir}/1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz`
  return state.fileInfo ? state.filePath : null
}

function updateAnalysisSource () {
  aseState.sourceRevision++
  if (aseState.cellSource !== state.filePath) {
    aseState.cellParameters = null
    aseState.cellSource = state.filePath
    aseViewer.cell = null
    $('cell-status').textContent = 'No manual cell. Source lattice/PBC are used when present.'
  } else if (!aseState.cellParameters) aseViewer.cell = null
  hideAtomMenu()
  const extracted = Boolean(state.lastResult?.success)
  aseState.analysisAtoms = extracted ? state.lastResult.sourceAtoms.map(atom => ({ ...atom }))
    : MonetASEModel.atomMap(state.firstFrame || [])
  const atoms = aseState.analysisAtoms
  const name = extractedTrajPath()?.split(/[\\/]/).pop() || ''
  $('analysis-source').textContent = atoms.length
    ? `Source: ${extracted ? 'extracted trajectory' : 'loaded XYZ'} · ${name} · ${atoms.length} atoms. Use MONET IDs in analysis inputs.`
    : 'Load an XYZ file and click Next to begin analysis.'
  $('ase-atom-count').textContent = atoms.length
  const body = $('ase-atom-body')
  body.replaceChildren()
  for (const atom of atoms) {
    const row = document.createElement('tr')
    row.dataset.monetId = atom.monetId
    row.tabIndex = 0
    const toggle = () => syncAsePicks(aseState.pickedIds.includes(atom.monetId)
      ? aseState.pickedIds.filter(id => id !== atom.monetId) : [...aseState.pickedIds, atom.monetId])
    row.addEventListener('click', toggle)
    row.addEventListener('contextmenu', event => showAtomMenu(event, atom.monetId))
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle() }
    })
    for (const value of [atom.monetId, atom.aseIndex, atom.element, ...['x', 'y', 'z'].map(axis => atom[axis].toFixed(7))]) {
      const cell = document.createElement('td')
      cell.textContent = value
      row.appendChild(cell)
    }
    body.appendChild(row)
  }
  $('ase-atom-match').textContent = atoms.length
    ? 'Atom order matches MONET. Elements and coordinates will be checked against ASE before calculation.'
    : 'No trajectory loaded.'
  aseViewer.loadAtoms(atoms.map(atom => ({ ...atom, index: atom.monetId })))
  aseViewerNeedsFit = true
  resizeAseViewer()
  syncAsePicks([])
  for (const target of Object.values(selectionTargets)) $(target.input).value = ''
  updateSelectionTarget()
  clearAllAnalyses(false)
}

function updateAseControls () {
  for (const kind of RUN_KINDS) {
    $(`btn-run-${kind}`).disabled = !aseState.available || aseState.busy
  }
  $('btn-unwrap').disabled = !aseState.available || aseState.busy || !extractedTrajPath()
  updateConvBtn()
  updatePlotControls()
  for (const id of ['cell-apply', 'cell-reset', 'cell-read', 'btn-ase-recheck']) $(id).disabled = aseState.busy
  $('ase-cancel').disabled = !aseState.busy || !window.monet.cancel
  $('ase-mic').disabled = aseState.busy
}

async function checkAseStatus () {
  $('ase-badge-text').textContent = 'Checking ASE …'
  $('ase-dot').className = 'ase-dot dot-checking'
  let r
  try { r = await window.monet.aseCheck() }
  catch (error) { r = { ok: false, error: error.message } }
  aseState.available = Boolean(r?.ok)
  aseState.version = r?.ase_version
  $('ase-dot').className = `ase-dot ${aseState.available ? 'dot-ok' : 'dot-err'}`
  $('ase-badge-text').textContent = aseState.available ? `ASE ${r.ase_version}` : 'ASE unavailable'
  $('ase-tab-badge').style.display = aseState.available ? 'inline' : 'none'
  $('ase-connection').textContent = aseState.available
    ? 'ASE connected. RMSD uses raw Cartesian coordinates. Distances and angles follow the minimum-image setting. RMSD does not unwrap periodic trajectories.'
    : (r?.message || r?.error || 'ASE is unavailable.') + ' Install ASE in the Python environment used to launch MONET, then click Recheck.'
  $('ase-badge').title = $('ase-connection').textContent
  updateAseControls()
}

$('btn-ase-recheck').addEventListener('click', checkAseStatus)

const analysisRevision = Object.fromEntries(Object.keys(charts).map(kind => [kind, 0]))

function updatePlotControls () {
  for (const [kind, chart] of Object.entries(charts)) {
    $(`clear-${kind}`).disabled = !chart.data && aseState.activeKind !== kind
    $(`download-${kind}`).disabled = !chart.data
    $(`csv-${kind}`).disabled = !chart.data
  }
  $('btn-clear-analyses').disabled = !Object.values(charts).some(chart => chart.data) && !charts[aseState.activeKind]
}

function clearAnalysis (kind, report = true) {
  analysisRevision[kind]++
  charts[kind].clear()
  delete lastResults[kind]
  hideAseProgress(`${kind}-prog-row`)
  if ($(`${kind}-prog-label`)) $(`${kind}-prog-label`).textContent = '—'
  if (kind === 'acf') { $('acf-result').classList.add('hidden'); clearAnalysis('acfdist', false) }
  for (const id of { msd: ['msd-info'], vdos: ['vdos-info'] }[kind] || []) $(id).classList.add('hidden')
  if (report) setStatus('Analysis cleared. Your trajectory and atom selection are unchanged.')
}

function clearAllAnalyses (report = true) {
  for (const kind of Object.keys(charts)) clearAnalysis(kind, false)
  if (report) setStatus('All analyses cleared. Your trajectory and atom selection are unchanged.')
}

for (const [kind, chart] of Object.entries(charts)) {
  chart.onChange = updatePlotControls
  $(`clear-${kind}`).addEventListener('click', () => clearAnalysis(kind))
  $(`download-${kind}`).addEventListener('click', async () => {
    try {
      await chart.downloadPNG(`MONET-${kind}.png`)
      setStatus('Plot PNG download started.')
    } catch (error) { setStatus(error.message) }
  })
  $(`csv-${kind}`).addEventListener('click', () => {
    try {
      chart.downloadCSV(`MONET-${kind}.csv`)
      setStatus('CSV download started.')
    } catch (error) { setStatus(error.message) }
  })
}
$('btn-clear-analyses').addEventListener('click', () => clearAllAnalyses())
$('ase-cancel').addEventListener('click', async () => {
  $('ase-cancel').disabled = true
  setStatus('Cancelling the running calculation …')
  await window.monet.cancel?.('ase')
})

async function runAse (kind, command) {
  if (aseState.busy) return { ok: false, error: 'Another ASE calculation is running.' }
  if (!aseState.available) return { ok: false, error: 'ASE is unavailable. Check the connection message above.' }
  const sourceRevision = aseState.sourceRevision
  const revision = analysisRevision[kind]
  const mapping = aseState.analysisAtoms.map(atom => ({ ...atom }))
  if (kind === 'conv' && $('conv-apply-cell').checked && !aseState.cellParameters) return { ok: false, error: 'Apply a manual crystal cell first.' }
  const options = kind !== 'conv' || $('conv-apply-cell').checked ? cellOptions() : {}
  command = { ...command, ...options }
  const rmsdNote = command.align ? ' Kabsch-aligned RMSD.' : ' Raw Cartesian RMSD.'
  const source = $('analysis-source').textContent + (options.cell ? ` Cell: ${options.cell.join(', ')}; PBC ${options.pbc.map(v => v ? 1 : 0).join('')}.` : ' Source cell.') + (['rmsd', 'rmsdmatrix'].includes(kind) ? rmsdNote + (command.unwrap ? ' Unwrapped.' : '') : ` MIC ${options.mic ? 'on' : 'off'}.`)
  aseState.busy = true
  aseState.activeKind = kind
  updateAseControls()
  const current = () => sourceRevision === aseState.sourceRevision && revision === analysisRevision[kind]
  const relay = msg => {
    if (current()) setAseProgress(`${kind}-prog-fill`, `${kind}-prog-label`, `${kind}-prog-row`, msg.percent ?? 0, msg.message)
  }
  relay({ message: 'Checking ASE atom mapping …', percent: 0 })
  const unsubscribe = window.monet.onAseProgress(relay)
  try {
    if (kind !== 'conv') {
      const info = await window.monet.aseRun({ action: 'read_info', filename: command.filename, ...options })
      if (!current()) return { ok: false, error: 'Analysis discarded because its source or result was cleared.' }
      MonetASEModel.verifyAtoms(mapping, info)
      $('ase-atom-match').textContent = `Verified with ASE: ${mapping.length} matching atoms, elements and first-frame coordinates.`
    }
    const result = await window.monet.aseRun(command)
    if (!current()) return { ok: false, error: 'Analysis discarded because its source or result was cleared.' }
    if (charts[kind]) charts[kind].source = source
    return { ...result, atomMapping: mapping, angleRange: command.angle_range, angleNormal: command.angle_normal }
  } catch (error) {
    if (kind !== 'conv' && current()) $('ase-atom-match').textContent = 'ASE verification or calculation failed: ' + error.message
    return { ok: false, error: error.message }
  } finally {
    if (typeof unsubscribe === 'function') unsubscribe()
    hideAseProgress(`${kind}-prog-row`)
    aseState.busy = false
    aseState.activeKind = null
    updateAseControls()
  }
}

// =============================================================================
// ── ASE: RMSD ────────────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-rmsd').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Load an XYZ file and click Next first.')

  const step = Number($('rmsd-step').value)
  let indices
  try { indices = MonetASEModel.selectedIndices($('rmsd-atoms').value, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const reference = $('rmsd-reference').value.trim()
  const r = await runAse('rmsd', {
    action: 'rmsd', filename: traj, frame_step: step, indices,
    align: $('rmsd-align').checked, unwrap: $('rmsd-unwrap').checked,
    ...(reference ? { reference_index: Number(reference) } : {})
  })

  if (!r.ok) { setStatus('RMSD error: ' + (r.message || r.error)); return }

  hideAseProgress('rmsd-prog-row')
  const labels = r.frame_indices.map(String)
  charts.rmsd.setData({
    source: charts.rmsd.source,
    title:    `RMSD vs frame ${r.reference_index}${r.aligned ? ' (Kabsch-aligned)' : ''}`,
    notes:    r.warning ? [r.warning] : [],
    xLabel:   'Frame',
    yLabel:   'RMSD (Å)',
    labels,
    datasets: [{ label: indices ? `RMSD · MONET IDs ${indices.map(i => r.atomMapping[i].monetId).join(', ')}` : 'RMSD · all atoms', data: r.rmsd, colorIndex: 0 }]
  })
  setStatus(`RMSD computed over ${r.rmsd.length} frames` + (r.warning ? ` — ${r.warning}` : ''))
})

// =============================================================================
// ── ASE: Pair-distance distribution ─────────────────────────────────────────
// =============================================================================

$('btn-run-pdd').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Load an XYZ file and click Next first.')

  const rmax  = Number($('pdd-rmax').value)
  const nbins = Number($('pdd-bins').value)
  const step  = Number($('pdd-step').value)
  const elRaw = $('pdd-elements').value.trim()
  const elems = elRaw ? elRaw.split(/\s+/) : null

  let indices
  try { indices = MonetASEModel.selectedIndices($('pdd-atoms').value, aseState.analysisAtoms, 2) }
  catch (error) { return setStatus(error.message) }
  const r = await runAse('pdd', {
    action: 'pdd', filename: traj,
    rmax, nbins, frame_step: step, elements: elems, indices
  })

  if (!r.ok) { setStatus('PDD error: ' + (r.message || r.error)); return }

  hideAseProgress('pdd-prog-row')
  const label = (elems ? elems.join('–') : 'all pairs') + (indices ? ` · MONET IDs ${indices.map(i => r.atomMapping[i].monetId).join(', ')}` : ' · all atoms')
  charts.pdd.setData({
    source: charts.pdd.source,
    title:    'Pair-Distance Distribution',
    xLabel:   'Distance (Å)',
    yLabel:   'Count',
    labels:   r.r.map(v => v.toFixed(2)),
    datasets: [{ label: label, data: r.counts, colorIndex: 2 }]
  })
  setStatus(`PDD over ${r.n_frames} frames`)
})

// =============================================================================
// ── ASE: Bond lengths ─────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-bonds').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Load an XYZ file and click Next first.')

  let pairs
  try { pairs = MonetASEModel.groupsFromIds($('bonds-pairs').value, 2, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const step  = Number($('bonds-step').value)

  const r = await runAse('bonds', { action: 'bonds', filename: traj, pairs, frame_step: step })

  if (!r.ok) { setStatus('Bond error: ' + (r.message || r.error)); return }

  hideAseProgress('bonds-prog-row')
  const labels = r.frame_indices.map(String)
  const datasets = Object.entries(r.series).map(([key, data], i) => ({
    label: MonetASEModel.seriesLabel(key, r.atomMapping), data, colorIndex: i
  }))
  charts.bonds.setData({
    source: charts.bonds.source,
    title: 'Bond Lengths vs Frame', xLabel: 'Frame', yLabel: 'Distance (Å)',
    labels, datasets
  })
  setStatus('Bond lengths computed')
})

// =============================================================================
// ── ASE: Bond angles ─────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-angles').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Load an XYZ file and click Next first.')

  let triplets
  try { triplets = MonetASEModel.groupsFromIds($('angles-triplets').value, 3, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const step = Number($('angles-step').value)

  const r = await runAse('angles', { action: 'angles', filename: traj, triplets, frame_step: step, angle_range: $('angles-range').value, angle_normal: $('angles-normal').value.trim().split(/[\s,]+/).map(Number) })

  if (!r.ok) { setStatus('Angles error: ' + (r.message || r.error)); return }

  hideAseProgress('angles-prog-row')
  const labels   = r.frame_indices.map(String)
  const datasets = Object.entries(r.series).map(([key, data], i) => ({
    label: MonetASEModel.seriesLabel(key, r.atomMapping), data, colorIndex: i
  }))
  charts.angles.setData({
    source: charts.angles.source + (r.angleRange === '360' ? ` Reference normal: ${r.angleNormal.join(', ')}.` : ''), angleRange: r.angleRange, angleNormal: r.angleNormal,
    title: 'Bond Angles vs Frame', xLabel: 'Frame', yLabel: 'Angle (°)',
    labels, datasets
  })
  setStatus('Bond angles computed')
})

for (const kind of ['angles', 'dihedrals']) {
  $(`${kind}-range`).addEventListener('change', () => {
    clearAnalysis(kind, false)
    $('angles-normal-row').classList.toggle('hidden', $('angles-range').value !== '360')
    setStatus('Angle range changed. Click Compute to calculate and plot this convention.')
  })
}
$('angles-normal').addEventListener('input', () => clearAnalysis('angles', false))

// Dihedral inputs are ordered MONET IDs; rotation is about the middle bond.
$('btn-run-dihedrals').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let quads
  try { quads = MonetASEModel.groupsFromIds($('dihedrals-quads').value, 4, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const r = await runAse('dihedrals', {
    action: 'dihedrals', filename, quads, angle_range: $('dihedrals-range').value, frame_step: Number($('dihedrals-step').value)
  })
  if (!r.ok) return setStatus('Dihedral error: ' + (r.message || r.error))
  charts.dihedrals.setData({
    title: 'Dihedral Angles vs Frame', xLabel: 'Frame', yLabel: 'Dihedral (°)',
    source: charts.dihedrals.source, angleRange: r.angleRange,
    labels: r.frame_indices.map(String),
    datasets: Object.entries(r.series).map(([key, data], i) => ({
      label: MonetASEModel.seriesLabel(key, r.atomMapping), data, colorIndex: i
    }))
  })
  setStatus(`Dihedral angles computed (${r.angleRange === 'signed90' ? '−90° to +90°, folded' : '0–360°'}).`)
})


// =============================================================================
// ── Time axis (user-defined MD time step) ────────────────────────────────────
// =============================================================================

const TIME_UNITS = { fs: 1, au: 0.02418884326585747, ps: 1000 }
function fmt (value, digits = 3) {
  if (!Number.isFinite(value)) return '—'
  const size = Math.abs(value)
  if (size && (size < 1e-3 || size >= 1e7)) return value.toExponential(digits - 1)
  return Number(value.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 6 })
}

// Returns { timestep (fs per MD step), stride (MD steps per saved frame), dt (fs per saved frame) } or null.
function timeAxis () {
  const value = Number($('md-timestep').value)
  const stride = Number($('md-stride').value)
  if (!$('md-timestep').value.trim() || !(value > 0) || !Number.isInteger(stride) || stride < 1) return null
  const timestep = value * TIME_UNITS[$('md-timestep-unit').value]
  return { timestep, stride, dt: timestep * stride }
}

function updateTimeInfo () {
  const axis = timeAxis()
  $('md-dt-info').textContent = axis
    ? `Time between saved frames: ${fmt(axis.dt, 6)} fs (${fmt(axis.timestep, 6)} fs × ${axis.stride}).`
    : 'Set the MD time step used in your simulation (needed for MSD, VDOS and autocorrelation).'
  if (lastResults.acf) showAcfResult()
}
for (const id of ['md-timestep', 'md-timestep-unit', 'md-stride']) {
  $(id).addEventListener('input', updateTimeInfo)
  $(id).addEventListener('change', updateTimeInfo)
}

function requireTime () {
  const axis = timeAxis()
  if (!axis) throw new Error('Set the MD time step (and MD steps per saved frame) in the Time axis row first.')
  return axis
}

const lineLabels = values => values.map(value => fmt(value, 5))

// =============================================================================
// ── ASE: RMSD matrix ─────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-rmsdmatrix').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let indices
  try { indices = MonetASEModel.selectedIndices($('rmsdmatrix-atoms').value, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const r = await runAse('rmsdmatrix', {
    action: 'rmsd_matrix', filename, indices, frame_step: Number($('rmsdmatrix-step').value),
    max_frames: Number($('rmsdmatrix-max').value), align: $('rmsdmatrix-align').checked, unwrap: $('rmsdmatrix-unwrap').checked
  })
  if (!r.ok) return setStatus('RMSD matrix error: ' + (r.message || r.error))
  charts.rmsdmatrix.setData({
    title: `Pairwise RMSD${r.aligned ? ' (Kabsch-aligned)' : ''}`, source: charts.rmsdmatrix.source,
    xLabel: 'Frame', yLabel: 'Frame', colorLabel: 'RMSD (Å)',
    labels: r.frame_indices.map(String), matrix: r.matrix,
    notes: [r.truncated ? `Only the first ${r.frame_indices.length} analysed frames are shown; increase the frame step to cover the whole run.` : '', r.warning || ''].filter(Boolean)
  })
  setStatus(`RMSD matrix computed for ${r.frame_indices.length} frames.`)
})

// =============================================================================
// ── ASE: RDF ─────────────────────────────────────────────────────────────────
// =============================================================================

function drawRdf () {
  const r = lastResults.rdf
  if (!r) return
  const showN = $('rdf-plot').value === 'n'
  charts.rdf.setData({
    title: `Radial distribution function ${r.label}`, source: charts.rdf.source,
    xLabel: 'r (Å)', yLabel: showN ? 'n(r) — coordination number' : 'g(r)',
    labels: lineLabels(r.r),
    datasets: [{ label: `${showN ? 'n(r)' : 'g(r)'} ${r.label} · ${r.n_a}×${r.n_b} atoms · ${r.n_frames} frames`, data: showN ? r.n : r.g, colorIndex: showN ? 4 : 2 }],
    notes: [`Rmax ${fmt(r.rmax, 4)} Å (limit ${fmt(r.rmax_limit, 4)} Å)`]
  })
}
$('rdf-plot').addEventListener('change', drawRdf)

$('btn-run-rdf').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let indices
  try { indices = MonetASEModel.selectedIndices($('rdf-atoms').value, aseState.analysisAtoms) }
  catch (error) { return setStatus(error.message) }
  const elements = $('rdf-elements').value.trim().split(/\s+/).filter(Boolean)
  const rmax = $('rdf-rmax').value.trim()
  const r = await runAse('rdf', {
    action: 'rdf', filename, indices, elements: elements.length ? elements : undefined,
    nbins: Number($('rdf-bins').value), frame_step: Number($('rdf-step').value), ...(rmax ? { rmax: Number(rmax) } : {})
  })
  if (!r.ok) return setStatus('RDF error: ' + (r.message || r.error))
  lastResults.rdf = r
  drawRdf()
  setStatus(`RDF ${r.label} computed over ${r.n_frames} frames.`)
})

// =============================================================================
// ── ASE: MSD / diffusion ─────────────────────────────────────────────────────
// =============================================================================

$('btn-run-msd').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let indices, axis
  try {
    indices = MonetASEModel.selectedIndices($('msd-atoms').value, aseState.analysisAtoms)
    axis = requireTime()
  } catch (error) { return setStatus(error.message) }
  const start = $('msd-fit-start').value.trim(), end = $('msd-fit-end').value.trim()
  const r = await runAse('msd', {
    action: 'msd', filename, indices, dt: axis.dt, frame_step: Number($('msd-step').value),
    remove_drift: $('msd-drift').checked, ...(start ? { fit_start: Number(start) } : {}), ...(end ? { fit_end: Number(end) } : {})
  })
  if (!r.ok) return setStatus('MSD error: ' + (r.message || r.error))
  const names = Object.keys(r.series)
  const fit = r.fits.selection
  const datasets = names.map((name, i) => ({ label: name === 'selection' ? 'MSD · selection' : `MSD · ${name}`, data: r.series[name], colorIndex: i }))
  datasets.push({
    label: `Linear fit ${fmt(r.fit_start, 4)}–${fmt(r.fit_end, 4)} fs`, dash: true, colorIndex: names.length,
    data: r.times.map(t => t >= r.fit_start && t <= r.fit_end ? fit.slope * t + fit.intercept : NaN)
  })
  const lines = names.map(name => `${name === 'selection' ? 'Selection' : name}: D = ${fmt(r.fits[name].D_cm2_s, 4)} cm²/s (${fmt(r.fits[name].D_A2_fs, 4)} Å²/fs, R² ${fmt(r.fits[name].r2, 3)})`)
  charts.msd.setData({
    title: 'Mean-square displacement', source: charts.msd.source,
    xLabel: 'Lag time (fs)', yLabel: 'MSD (Å²)', labels: lineLabels(r.times), datasets,
    notes: [lines[0], r.periodic ? 'Unwrapped with minimum-image steps.' : 'No periodic cell: positions used as written.', r.warning || ''].filter(Boolean)
  })
  $('msd-info').textContent = lines.join(' · ') + (r.warning ? ` — ${r.warning}` : '')
  $('msd-info').classList.remove('hidden')
  setStatus(lines[0])
})

// =============================================================================
// ── ASE: VDOS ────────────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-vdos').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  let indices, axis
  try {
    indices = MonetASEModel.selectedIndices($('vdos-atoms').value, aseState.analysisAtoms)
    axis = requireTime()
  } catch (error) { return setStatus(error.message) }
  const r = await runAse('vdos', {
    action: 'vdos', filename, indices, dt: axis.dt, frame_step: Number($('vdos-step').value),
    mass_weighted: $('vdos-mass').checked, smooth_cm: Number($('vdos-smooth').value) || 0, max_cm: Number($('vdos-max').value) || 4000
  })
  if (!r.ok) return setStatus('VDOS error: ' + (r.message || r.error))
  const info = `Nyquist limit ${fmt(r.nyquist_cm, 5)} cm⁻¹ · resolution ${fmt(r.resolution_cm, 3)} cm⁻¹ · ${r.n_frames} frames · Δt ${fmt(r.dt, 5)} fs`
  charts.vdos.setData({
    title: 'Vibrational density of states', source: charts.vdos.source,
    xLabel: 'Wavenumber (cm⁻¹)', yLabel: 'Normalised intensity', labels: lineLabels(r.wavenumber),
    datasets: [{ label: `VDOS${$('vdos-mass').checked ? ' (mass-weighted)' : ''}`, data: r.intensity, colorIndex: 0 }],
    notes: [info, r.warning || ''].filter(Boolean), yMin: 0
  })
  $('vdos-info').textContent = info + (r.warning ? ` — ${r.warning}` : '')
  $('vdos-info').classList.remove('hidden')
  setStatus('VDOS computed. ' + info)
})

// =============================================================================
// ── ASE: autocorrelation and decorrelation stride ────────────────────────────
// =============================================================================

function acfTau () {
  const r = lastResults.acf
  const manual = Number($('acf-tau-manual').value)
  if ($('acf-tau-manual').value.trim() && manual > 0) return { tau: manual, source: 'entered' }
  if (r && Number.isFinite(r.tau_fit) && r.tau_fit > 0) return { tau: r.tau_fit, source: 'fit' }
  if (r && Number.isFinite(r.tau_int) && r.tau_int > 0) return { tau: r.tau_int, source: 'integral' }
  return null
}

function showAcfResult () {
  const r = lastResults.acf
  if (!r) return
  const axis = timeAxis()
  const steps = value => axis ? ` = ${fmt(value / axis.timestep, 4)} MD steps = ${fmt(value / axis.dt, 4)} saved frames` : ''
  $('acf-tau-text').textContent = [
    `τ (fit exp(−t/τ), ${r.fit_points} points up to ${fmt(r.fit_end, 4)} fs) = ${fmt(r.tau_fit, 4)} ± ${fmt(r.tau_fit_error, 2)} fs${steps(r.tau_fit)}`,
    `τ (integral to first zero) = ${fmt(r.tau_int, 4)} fs${r.decorrelated ? '' : ' (ACF never crossed zero: extend the lag range or the run)'}`,
    `Mean ${fmt(r.statistics[0].mean, 5)} ± ${fmt(r.statistics[0].sem, 2)} (std ${fmt(r.statistics[0].std, 4)}), N_eff ≈ ${fmt(r.n_effective, 3)} of ${r.n_frames} frames`
  ].join(' · ')
  const choice = acfTau()
  const factor = Number($('acf-multiplier').value) || 1
  if (!choice || !axis) {
    $('acf-stride-text').textContent = axis ? 'No correlation time available.' : 'Set the MD time step to convert τ into a sampling stride.'
    $('acf-apply-stride').disabled = true
  } else {
    const stride = Math.max(1, Math.ceil(factor * choice.tau / axis.dt - 1e-9))
    $('acf-stride-text').textContent = `Sample every ${stride} saved frames (${fmt(stride * axis.stride, 6)} MD steps, ${fmt(stride * axis.dt, 5)} fs) using τ ${choice.source} = ${fmt(choice.tau, 4)} fs × ${factor}`
    $('acf-apply-stride').dataset.stride = stride
    $('acf-apply-stride').disabled = false
  }
  $('acf-result').classList.remove('hidden')
}
for (const id of ['acf-tau-manual', 'acf-multiplier']) $(id).addEventListener('input', showAcfResult)
$('acf-apply-stride').addEventListener('click', () => {
  const stride = Number($('acf-apply-stride').dataset.stride)
  if (!Number.isInteger(stride) || stride < 1) return
  $('inp-freq').value = stride
  updateSampledCount()
  setStatus(`Sampling frequency set to every ${stride} frames (step 02). Re-run the extraction to apply it.`)
})
$('acf-quantity').addEventListener('change', () => {
  $('acf-groups').placeholder = { dihedral: '1 2 3 4', angle: '2 1 3', bond: '1 2', rmsd: '1 2 3 …' }[$('acf-quantity').value]
  $('acf-mode').value = 'linear'
  clearAnalysis('acf', false)
  if ($('ase-selection-target').value === 'acf') updateSelectionTarget()
})

$('btn-run-acf').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load an XYZ file and click Next first.')
  const quantity = $('acf-quantity').value
  let groups, axis
  try {
    axis = requireTime()
    groups = quantity === 'rmsd'
      ? [MonetASEModel.selectedIndices($('acf-groups').value, aseState.analysisAtoms) || aseState.analysisAtoms.map(atom => atom.aseIndex)]
      : MonetASEModel.groupsFromIds($('acf-groups').value, ACF_WIDTH[quantity], aseState.analysisAtoms)
  } catch (error) { return setStatus(error.message) }
  const maxLag = $('acf-maxlag').value.trim()
  const r = await runAse('acf', {
    action: 'acf', filename, quantity, groups, dt: axis.dt, frame_step: Number($('acf-step').value),
    mode: $('acf-mode').value, fit_until: $('acf-fit').value, nbins: Number($('acf-bins').value),
    ...(maxLag ? { max_lag: Number(maxLag) } : {})
  })
  if (!r.ok) return setStatus('Autocorrelation error: ' + (r.message || r.error))
  lastResults.acf = r
  const label = quantity === 'rmsd' ? 'RMSD' : groups.map(group => MonetASEModel.seriesLabel(group.join('-'), r.atomMapping)).join(' | ')
  const unit = { dihedral: '°', angle: '°', bond: 'Å', rmsd: 'Å' }[quantity]
  const datasets = [{ label: `C(t) · ${label}`, data: r.acf, colorIndex: 0 }]
  if (r.fit_curve) datasets.push({ label: `exp(−t/τ), τ = ${fmt(r.tau_fit, 4)} fs`, data: r.fit_curve, dash: true, colorIndex: 1 })
  charts.acf.setData({
    title: `Autocorrelation of the ${quantity === 'rmsd' ? 'RMSD' : quantity}`, source: charts.acf.source,
    xLabel: 'Time lag (fs)', yLabel: r.mode === 'circular' ? '⟨cos Δθ⟩' : 'Normalised autocorrelation',
    labels: lineLabels(r.lags), datasets,
    notes: [`τ fit ${fmt(r.tau_fit, 4)} ± ${fmt(r.tau_fit_error, 2)} fs · τ integral ${fmt(r.tau_int, 4)} fs · Δt ${fmt(r.dt, 5)} fs`]
  })
  charts.acfdist.source = charts.acf.source
  charts.acfdist.setData({
    title: `Distribution of the ${quantity === 'rmsd' ? 'RMSD' : quantity}`, source: charts.acf.source,
    xLabel: `${quantity === 'rmsd' ? 'RMSD' : quantity[0].toUpperCase() + quantity.slice(1)} (${unit})`, yLabel: 'Probability density',
    labels: lineLabels(r.distribution.x),
    datasets: [{ label: `${label} · ${r.n_frames} frames`, data: r.distribution.density, bars: true, colorIndex: 2 }],
    notes: [`Mean ${fmt(r.statistics[0].mean, 5)} ${unit} · std ${fmt(r.statistics[0].std, 4)} ${unit}`], yMin: 0
  })
  showAcfResult()
  setStatus(`Autocorrelation computed: τ = ${fmt(r.tau_fit, 4)} fs.`)
})

// =============================================================================
// ── ASE: unwrap trajectory ───────────────────────────────────────────────────
// =============================================================================

$('btn-unwrap').addEventListener('click', async () => {
  const filename = extractedTrajPath()
  if (!filename) return setStatus('Load a trajectory first.')
  const stem = filename.split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
  const output = await window.monet.aseSelectOutput(`${stem}-unwrapped.extxyz`)
  if (!output) return
  $('download-unwrapped').classList.add('hidden')
  const r = await runAse('unwrap', { action: 'unwrap', filename, output })
  if (!r.ok) return setStatus('Unwrap error: ' + (r.message || r.error))
  if (r.downloadURL) {
    $('download-unwrapped').href = r.downloadURL
    $('download-unwrapped').download = r.output || `${stem}-unwrapped.extxyz`
    $('download-unwrapped').classList.remove('hidden')
  }
  setStatus(`Unwrapped ${r.n_frames} frames${r.warning ? ` — ${r.warning}` : ''}.`)
})

// =============================================================================
// ── ASE: Format conversion ────────────────────────────────────────────────────
// =============================================================================

$('btn-conv-input').addEventListener('click', async () => {
  let fp
  try { fp = await window.monet.selectFile() }
  catch (error) { return setStatus('Could not open conversion input: ' + error.message) }
  if (!fp) return
  aseState.convInput = fp
  $('download-converted').classList.add('hidden')
  $('conv-input-path').textContent = fp
  updateConvBtn()
})

$('btn-conv-output').addEventListener('click', async () => {
  const fmt  = $('conv-format').value
  const ext = ({ vasp: 'vasp', 'gaussian-in': 'gjf', 'espresso-in': 'pwi', 'lammps-data': 'data', aims: 'in', turbomole: 'coord', dftb: 'gen' })[fmt] || fmt || 'xyz'
  const defName = aseState.convInput
    ? aseState.convInput.replace(/\.[^.]+$/, '') + '_converted.' + ext
    : 'converted.' + ext
  const fp = await window.monet.aseSelectOutput(defName)
  if (!fp) return
  aseState.convOutput = fp
  $('conv-output-path').textContent = fp
  updateConvBtn()
})

$('conv-format').addEventListener('change', () => {
  aseState.convOutput = null
  $('conv-output-path').textContent = 'Choose an output filename for this format'
  $('download-converted').classList.add('hidden')
  updateConvBtn()
})

function updateConvBtn () {
  $('btn-run-conv').disabled = !aseState.available || aseState.busy || !(aseState.convInput && aseState.convOutput)
}

$('btn-run-conv').addEventListener('click', async () => {
  const fmt = $('conv-format').value || undefined
  $('download-converted').classList.add('hidden')
  const r = await runAse('conv', {
    action: 'convert',
    input:  aseState.convInput,
    output: aseState.convOutput,
    format: fmt,
    first_frame_only: $('conv-first-frame').checked
  })

  if (!r.ok) {
    setStatus('Conversion error: ' + (r.message || r.error))
    $('conv-result').textContent = '✗ ' + (r.message || r.error)
    $('conv-result').classList.remove('hidden')
    return
  }

  hideAseProgress('conv-prog-row')
  $('conv-result').textContent = `✓ ${r.n_frames} frames written to ${r.output}`
  $('conv-result').classList.remove('hidden')
  if (r.downloadURL) {
    $('download-converted').href = r.downloadURL
    $('download-converted').download = r.output
    $('download-converted').classList.remove('hidden')
  }
  setStatus(`Converted: ${r.output}`)
})

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
  if (window.monet.isBrowser) {
    state.outputDir = 'MONET-results'
    $('output-dir-text').textContent = 'Download results as a ZIP file'
    $('btn-output-dir').classList.add('hidden')
    $('next-4').disabled = false
    setStatus('Browser mode · Select an XYZ file to begin')
    $('btn-conv-output').textContent = 'Set download name'
    $('conv-format').value = 'extxyz'
    $('conv-format').querySelector('option[value=""]').disabled = true
  }
  checkAseStatus().catch(error => setStatus('ASE check failed: ' + error.message))
})

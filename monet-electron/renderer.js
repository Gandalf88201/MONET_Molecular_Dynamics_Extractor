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

    canvas.addEventListener('mousedown',   e => this._onMouseDown(e))
    canvas.addEventListener('mousemove',   e => this._onMouseMove(e))
    canvas.addEventListener('mouseup',     () => { this.dragging = false })
    canvas.addEventListener('mouseleave',  () => { this.dragging = false })
    canvas.addEventListener('wheel',       e => this._onWheel(e), { passive: true })
    canvas.addEventListener('click',       e => this._onClick(e))
  }

  loadAtoms (atoms) {
    this.atoms = atoms
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
    bg.addColorStop(0, '#0d0d1a')
    bg.addColorStop(1, '#10101f')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    if (!atoms.length) return

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
      ctx.strokeStyle = aColor === '#404040' ? '#666' : aColor
      ctx.globalAlpha = 0.55
      ctx.stroke()
      ctx.beginPath(); ctx.moveTo(midx, midy); ctx.lineTo(b.sx, b.sy)
      ctx.strokeStyle = bColor === '#404040' ? '#666' : bColor
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
        ctx.shadowColor = '#ffd700'
      }

      // Sphere-like radial gradient
      const hlx = a.sx - r * 0.35, hly = a.sy - r * 0.35
      const grd = ctx.createRadialGradient(hlx, hly, r * 0.08, a.sx, a.sy, r)
      grd.addColorStop(0,   lighten(color, 0.65))
      grd.addColorStop(0.55, color)
      grd.addColorStop(1,   darken(color, 0.45))

      ctx.beginPath()
      ctx.arc(a.sx, a.sy, r, 0, Math.PI * 2)
      ctx.fillStyle = isSel ? '#ffd700' : grd
      ctx.fill()

      if (isSel) {
        ctx.lineWidth   = 2.5
        ctx.strokeStyle = '#fff'
        ctx.stroke()
        ctx.shadowBlur = 0
      }

      // Label: always show atom ID (1-indexed), element on hover-like if selected
      const fontSize = Math.max(9, Math.min(r * 0.72, 14))
      ctx.font        = `bold ${fontSize}px monospace`
      ctx.textAlign   = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle   = isSel ? '#1a1a1a' : (r > 14 ? '#fff' : 'rgba(255,255,255,0.7)')
      if (isSel || r > 8)
        ctx.fillText(a.index, a.sx, a.sy)

      ctx.restore()
    }
  }

  // Hit-test: find atom closest to click point
  _hitTest (mx, my) {
    let best = null, bestDist = Infinity
    for (const a of this.atoms) {
      const p = this._project(a.x, a.y, a.z)
      const d = Math.hypot(p.sx - mx, p.sy - my)
      const r = Math.max(4, covalentRad(a.element) * this.zoom * 0.28)
      if (d < r && d < bestDist) { best = a.index; bestDist = d }
    }
    return best
  }

  _onMouseDown (e) {
    this.dragging  = true
    this.lastMouse = { x: e.clientX, y: e.clientY }
  }

  _onMouseMove (e) {
    if (!this.dragging || !this.lastMouse) return
    const dx = e.clientX - this.lastMouse.x
    const dy = e.clientY - this.lastMouse.y
    this.rotY += dx * 0.008
    this.rotX += dy * 0.008
    this.lastMouse = { x: e.clientX, y: e.clientY }
    this.render()
  }

  _onWheel (e) {
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    this.zoom = Math.max(2, Math.min(600, this.zoom * factor))
    this.render()
  }

  _onClick (e) {
    if (this._wasDrag) { this._wasDrag = false; return }
    const rect  = this.canvas.getBoundingClientRect()
    const mx    = e.clientX - rect.left
    const my    = e.clientY - rect.top
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
  ids.forEach(id => state.selectedAtoms.add(id))
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

$('btn-browse').addEventListener('click', async () => {
  setStatus('Selecting file …')
  const fp = await window.monet.selectFile()
  if (!fp) { setStatus('Ready'); return }

  state.filePath = fp
  $('file-path-text').textContent = fp
  $('file-display').classList.remove('hidden')
  $('next-1').disabled = false
  setStatus('File selected: ' + fp.split(/[\\/]/).pop())
})

$('next-1').addEventListener('click', async () => {
  goTo(2)
  setStatus('Analysing trajectory …')
  const info = await window.monet.analyzeFile(state.filePath)
  if (info.error) { setStatus('Error: ' + info.error); return }

  state.fileInfo        = info
  $('stat-format').textContent  = info.format
  $('stat-configs').textContent = info.configCount.toLocaleString()
  $('stat-atoms').textContent   = info.atomCount.toLocaleString()
  updateSampledCount()
  setStatus(`Analysed: ${info.configCount} frames · ${info.atomCount} atoms / frame`)

  // Load first frame for 3D viewer
  loadFrameForViewer(0)
})

// =============================================================================
// ── Step 2 — Sampling ────────────────────────────────────────────────────────
// =============================================================================

$('inp-freq').addEventListener('input', updateSampledCount)

function updateSampledCount () {
  const freq  = parseInt($('inp-freq').value, 10) || 1
  state.frequency = freq
  if (!state.fileInfo) return
  const n = Math.floor((state.fileInfo.configCount - 1) / freq) + 1
  $('sampled-count').textContent = n.toLocaleString()
}

$('back-2').addEventListener('click', () => goTo(1))

$('next-2').addEventListener('click', () => {
  state.frequency = parseInt($('inp-freq').value, 10) || 10
  goTo(3)
})

// =============================================================================
// ── Load first frame into viewer & table ─────────────────────────────────────
// =============================================================================

async function loadFrameForViewer (frameIdx) {
  if (!state.filePath || !state.fileInfo) return
  $('viewer-overlay').classList.add('hidden')
  setStatus('Loading frame …')

  const result = await window.monet.readFrame(
    state.filePath, frameIdx, state.fileInfo.atomCount
  )
  if (result.error) { setStatus('Viewer error: ' + result.error); return }

  state.firstFrame = result.atoms
  viewer.loadAtoms(result.atoms)
  buildAtomTable(result.atoms)
  resizeCanvas()
  setStatus(`Frame 0 loaded · ${result.atoms.length} atoms`)
  $('viewer-title').textContent = `Frame 0 — ${result.atoms.length} atoms`
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
  const ids = raw.split(/[\s,]+/).map(Number).filter(n => Number.isInteger(n) && n > 0)
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
$('opt-gaussian').addEventListener('change', e => {
  state.opts.generateGaussian = e.target.checked
  $('gaussian-details').style.opacity = e.target.checked ? '1' : '0.35'
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
  goTo(5)
  runProcessing()
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

  if (data.status === 'done' && PROGRESS_STEPS[data.step]) {
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

  log(`Starting MONET processing …`, 'info')
  log(`File     : ${state.filePath}`)
  log(`Atoms    : ${[...state.selectedAtoms].sort((a,b)=>a-b).join(', ')}`)
  log(`Frequency: every ${state.frequency} frames`)
  log(`Output   : ${state.outputDir}`)
  log('')

  const result = await window.monet.processTrajectory({
    filePath:         state.filePath,
    outputDir:        state.outputDir,
    atomCount:        state.fileInfo.atomCount,
    selectedAtoms:    [...state.selectedAtoms],
    frequency:        state.frequency,
    computeAverage:   state.opts.computeAverage,
    generateGaussian: state.opts.generateGaussian
  })

  if (result.error) {
    log('ERROR: ' + result.error, 'error')
    setStatus('Processing failed: ' + result.error)
    return
  }

  setProgress(100)
  log(`Done! ${result.totalFrames} frames processed · ${result.sampledFrames} sampled.`, 'success')
  setStatus('Processing complete!')

  state.lastResult = result
  $('next-5').classList.remove('hidden')
}

$('next-5').addEventListener('click', () => {
  buildResultsView(state.lastResult)
  goTo(6)
})

// =============================================================================
// ── Step 6 — Results ─────────────────────────────────────────────────────────
// =============================================================================

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
        `conf1/ … conf${result.sampledFrames}/ (pos*.txt${state.opts.generateGaussian ? ', sing.dat, trip.dat' : ''})`
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
  state.outputDir     = null

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
  })
})

$('open-ase-btn').addEventListener('click', () => {
  $$('.vtab').forEach(b => b.classList.remove('active'))
  $$('.vtab-content').forEach(c => c.classList.remove('active'))
  $('vtab-ase').classList.add('active')
  $('vtab-content-ase').classList.add('active')
})

// ASE sub-tab switching
$$('.ase-stab').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.stab
    $$('.ase-stab').forEach(b => b.classList.remove('active'))
    $$('.ase-subpanel').forEach(p => p.classList.remove('active'))
    btn.classList.add('active')
    $(`ase-sub-${id}`).classList.add('active')
  })
})

// =============================================================================
// ── LineChart — canvas-based scientific line chart ───────────────────────────
// =============================================================================

const CHART_PALETTE = [
  '#4d9de0', '#e94560', '#00c87a', '#ffd700',
  '#c77dff', '#ff9f1c', '#2ec4b6', '#ff6b6b'
]

class LineChart {
  constructor (canvasId, placeholderId) {
    this.canvas = $(canvasId)
    this.ph     = placeholderId ? $(placeholderId) : null
    this.ctx    = this.canvas.getContext('2d')
    this.data   = null
  }

  setData ({ title, xLabel, yLabel, labels, datasets }) {
    this.data = { title, xLabel, yLabel, labels, datasets }
    if (this.ph) this.ph.classList.add('hidden')
    this.canvas.classList.remove('hidden')
    this._render()
  }

  clear () {
    this.data = null
    if (this.ph) this.ph.classList.remove('hidden')
    this.canvas.classList.add('hidden')
  }

  _render () {
    const { canvas, ctx, data } = this
    if (!data) return

    const W = canvas.clientWidth  || 600
    const H = canvas.clientHeight || 320
    canvas.width  = W
    canvas.height = H

    const PAD = { top: 36, right: 24, bottom: 52, left: 64 }
    const pw  = W - PAD.left - PAD.right
    const ph  = H - PAD.top  - PAD.bottom

    // Background
    ctx.fillStyle = '#0d0d1a'
    ctx.fillRect(0, 0, W, H)

    const { labels, datasets, title, xLabel, yLabel } = data
    if (!datasets.length || !labels.length) return

    const allY  = datasets.flatMap(d => d.data.filter(Number.isFinite))
    const minY  = Math.min(...allY)
    const maxY  = Math.max(...allY)
    const rangeY = (maxY - minY) || 1
    const N     = labels.length

    const xS = i => PAD.left + (i / Math.max(N - 1, 1)) * pw
    const yS = v => PAD.top  + ph - ((v - minY) / rangeY) * ph

    // Grid
    const NY_TICKS = 5
    ctx.lineWidth   = 1
    ctx.strokeStyle = '#1e1e3a'
    ctx.fillStyle   = '#55557a'
    ctx.font        = '10px monospace'
    for (let i = 0; i <= NY_TICKS; i++) {
      const v = minY + (i / NY_TICKS) * rangeY
      const y = yS(v)
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke()
      ctx.textAlign = 'right'
      ctx.fillText(v.toFixed(3), PAD.left - 6, y + 4)
    }
    const NX_TICKS = Math.min(8, N)
    for (let i = 0; i <= NX_TICKS; i++) {
      const idx = Math.round(i * (N - 1) / NX_TICKS)
      const x   = xS(idx)
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + ph); ctx.stroke()
      ctx.textAlign = 'center'
      ctx.fillText(labels[idx], x, PAD.top + ph + 16)
    }

    // Axes
    ctx.strokeStyle = '#3a3a60'
    ctx.lineWidth   = 1.5
    ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top); ctx.lineTo(PAD.left, PAD.top + ph); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(PAD.left, PAD.top + ph); ctx.lineTo(W - PAD.right, PAD.top + ph); ctx.stroke()

    // Axis labels
    ctx.fillStyle = '#7a7a9e'; ctx.font = '11px monospace'; ctx.textAlign = 'center'
    ctx.fillText(xLabel, PAD.left + pw / 2, H - 6)
    ctx.save()
    ctx.translate(14, PAD.top + ph / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText(yLabel, 0, 0)
    ctx.restore()

    // Title
    ctx.fillStyle = '#dde0ef'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'
    ctx.fillText(title, PAD.left + pw / 2, 20)

    // Series
    datasets.forEach((ds, di) => {
      const color = ds.color || CHART_PALETTE[di % CHART_PALETTE.length]
      ctx.strokeStyle = color
      ctx.lineWidth   = 1.8
      ctx.beginPath()
      let moved = false
      for (let i = 0; i < ds.data.length; i++) {
        if (!Number.isFinite(ds.data[i])) continue
        const x = xS(i), y = yS(ds.data[i])
        if (!moved) { ctx.moveTo(x, y); moved = true }
        else          ctx.lineTo(x, y)
      }
      ctx.stroke()
    })

    // Legend
    let lx = PAD.left + 6
    datasets.forEach((ds, di) => {
      const color = ds.color || CHART_PALETTE[di % CHART_PALETTE.length]
      ctx.fillStyle = color
      ctx.fillRect(lx, PAD.top + 8, 18, 3)
      ctx.fillStyle = '#c0c0d8'; ctx.font = '9px monospace'; ctx.textAlign = 'left'
      ctx.fillText(ds.label, lx + 22, PAD.top + 13)
      lx += Math.max(80, ds.label.length * 6.5 + 30)
    })
  }
}

// =============================================================================
// ── ASE panel state + helpers ────────────────────────────────────────────────
// =============================================================================

const aseState = {
  available:   false,
  version:     null,
  convInput:   null,
  convOutput:  null
}

const charts = {
  rmsd:   new LineChart('chart-rmsd',   'chart-rmsd-ph'),
  pdd:    new LineChart('chart-pdd',    'chart-pdd-ph'),
  bonds:  new LineChart('chart-bonds',  'chart-bonds-ph'),
  angles: new LineChart('chart-angles', 'chart-angles-ph'),
}

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
  $(rowId).classList.add('hidden')
}

function extractedTrajPath () {
  if (!state.outputDir) return null
  return `${state.outputDir}/1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz`
}

// =============================================================================
// ── ASE: Python status check ─────────────────────────────────────────────────
// =============================================================================

async function checkAseStatus () {
  $('ase-badge-text').textContent = 'ASE …'
  $('ase-dot').className          = 'ase-dot dot-checking'

  const r = await window.monet.aseCheck()
  if (r && r.ok) {
    aseState.available       = true
    aseState.version         = r.ase_version
    $('ase-dot').className   = 'ase-dot dot-ok'
    $('ase-badge-text').textContent = `ASE ${r.ase_version}`
    $('ase-tab-badge').style.display = 'inline'
  } else {
    aseState.available       = false
    $('ase-dot').className   = 'ase-dot dot-err'
    $('ase-badge-text').textContent = 'ASE not found'
    $('vtab-ase').title      = 'ASE not installed — run: pip install ase'
    $('ase-tab-badge').style.display = 'none'
  }
}

// =============================================================================
// ── ASE: RMSD ────────────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-rmsd').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Run processing first (Step 5) to generate extracted trajectory.')

  const step = parseInt($('rmsd-step').value, 10) || 1
  $('btn-run-rmsd').disabled = true
  setAseProgress('rmsd-prog-fill', 'rmsd-prog-label', 'rmsd-prog-row', 0, 'Starting …')

  // relay progress
  const unsub = window.monet.onAseProgress(msg => {
    setAseProgress('rmsd-prog-fill', 'rmsd-prog-label', 'rmsd-prog-row',
                   msg.percent ?? 0, msg.message)
  })

  const r = await window.monet.aseRun({ action: 'rmsd', filename: traj, frame_step: step })
  $('btn-run-rmsd').disabled = false

  if (!r.ok) { setStatus('RMSD error: ' + (r.message || r.error)); return }

  hideAseProgress('rmsd-prog-row')
  const labels = r.frame_indices.map(String)
  charts.rmsd.setData({
    title:    'RMSD vs Frame 0',
    xLabel:   'Frame',
    yLabel:   'RMSD (Å)',
    labels,
    datasets: [{ label: 'RMSD', data: r.rmsd, color: '#4d9de0' }]
  })
  setStatus(`RMSD computed over ${r.rmsd.length} frames`)
})

// =============================================================================
// ── ASE: Pair-distance distribution ─────────────────────────────────────────
// =============================================================================

$('btn-run-pdd').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Run processing first to generate extracted trajectory.')

  const rmax  = parseFloat($('pdd-rmax').value)  || 8
  const nbins = parseInt($('pdd-bins').value, 10) || 80
  const step  = parseInt($('pdd-step').value, 10) || 5
  const elRaw = $('pdd-elements').value.trim()
  const elems = elRaw ? elRaw.split(/\s+/) : null

  $('btn-run-pdd').disabled = true
  setAseProgress('pdd-prog-fill', 'pdd-prog-label', 'pdd-prog-row', 0, 'Starting …')

  window.monet.onAseProgress(msg => {
    setAseProgress('pdd-prog-fill', 'pdd-prog-label', 'pdd-prog-row',
                   msg.percent ?? 0, msg.message)
  })

  const r = await window.monet.aseRun({
    action: 'pdd', filename: traj,
    rmax, nbins, frame_step: step, elements: elems
  })
  $('btn-run-pdd').disabled = false

  if (!r.ok) { setStatus('PDD error: ' + (r.message || r.error)); return }

  hideAseProgress('pdd-prog-row')
  const label = elems ? elems.join('–') : 'all pairs'
  charts.pdd.setData({
    title:    'Pair-Distance Distribution',
    xLabel:   'Distance (Å)',
    yLabel:   'Count',
    labels:   r.r.map(v => v.toFixed(2)),
    datasets: [{ label: label, data: r.counts, color: '#00c87a' }]
  })
  setStatus(`PDD over ${r.n_frames} frames`)
})

// =============================================================================
// ── ASE: Bond lengths ─────────────────────────────────────────────────────────
// =============================================================================

$('btn-run-bonds').addEventListener('click', async () => {
  const traj = extractedTrajPath()
  if (!traj) return setStatus('Run processing first.')

  const raw   = $('bonds-pairs').value.trim()
  const nums  = raw.split(/\s+/).map(Number).filter(Number.isInteger)
  if (nums.length < 2 || nums.length % 2 !== 0)
    return setStatus('Enter atom pairs as pairs of integers (0-indexed), e.g. "0 5  2 8".')

  const pairs = []
  for (let i = 0; i < nums.length; i += 2) pairs.push([nums[i], nums[i+1]])
  const step  = parseInt($('bonds-step').value, 10) || 1

  $('btn-run-bonds').disabled = true
  setAseProgress('bonds-prog-fill', 'bonds-prog-label', 'bonds-prog-row', 0, 'Starting …')

  window.monet.onAseProgress(msg => {
    setAseProgress('bonds-prog-fill', 'bonds-prog-label', 'bonds-prog-row',
                   msg.percent ?? 0, msg.message)
  })

  const r = await window.monet.aseRun({ action: 'bonds', filename: traj, pairs, frame_step: step })
  $('btn-run-bonds').disabled = false

  if (!r.ok) { setStatus('Bond error: ' + (r.message || r.error)); return }

  hideAseProgress('bonds-prog-row')
  const labels = r.frame_indices.map(String)
  const datasets = Object.entries(r.series).map(([key, data], i) => ({
    label: `atoms ${key}`, data, color: CHART_PALETTE[i % CHART_PALETTE.length]
  }))
  charts.bonds.setData({
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
  if (!traj) return setStatus('Run processing first.')

  const raw  = $('angles-triplets').value.trim()
  const nums = raw.split(/\s+/).map(Number).filter(Number.isInteger)
  if (nums.length < 3 || nums.length % 3 !== 0)
    return setStatus('Enter triplets of integers (0-indexed), e.g. "0 1 2  3 4 5".')

  const triplets = []
  for (let i = 0; i < nums.length; i += 3) triplets.push([nums[i], nums[i+1], nums[i+2]])
  const step = parseInt($('angles-step').value, 10) || 1

  $('btn-run-angles').disabled = true
  setAseProgress('angles-prog-fill', 'angles-prog-label', 'angles-prog-row', 0, 'Starting …')

  window.monet.onAseProgress(msg => {
    setAseProgress('angles-prog-fill', 'angles-prog-label', 'angles-prog-row',
                   msg.percent ?? 0, msg.message)
  })

  const r = await window.monet.aseRun({ action: 'angles', filename: traj, triplets, frame_step: step })
  $('btn-run-angles').disabled = false

  if (!r.ok) { setStatus('Angles error: ' + (r.message || r.error)); return }

  hideAseProgress('angles-prog-row')
  const labels   = r.frame_indices.map(String)
  const datasets = Object.entries(r.series).map(([key, data], i) => ({
    label: `atoms ${key}`, data, color: CHART_PALETTE[i % CHART_PALETTE.length]
  }))
  charts.angles.setData({
    title: 'Bond Angles vs Frame', xLabel: 'Frame', yLabel: 'Angle (°)',
    labels, datasets
  })
  setStatus('Bond angles computed')
})

// =============================================================================
// ── ASE: Format conversion ────────────────────────────────────────────────────
// =============================================================================

$('btn-conv-input').addEventListener('click', async () => {
  const fp = await window.monet.selectFile()
  if (!fp) return
  aseState.convInput = fp
  $('conv-input-path').textContent = fp
  updateConvBtn()
})

$('btn-conv-output').addEventListener('click', async () => {
  const fmt  = $('conv-format').value
  const ext  = fmt === 'vasp' ? 'POSCAR' : fmt ? fmt : 'out.xyz'
  const defName = aseState.convInput
    ? aseState.convInput.replace(/\.[^.]+$/, '') + '_converted.' + ext
    : 'converted.' + ext
  const fp = await window.monet.aseSelectOutput(defName)
  if (!fp) return
  aseState.convOutput = fp
  $('conv-output-path').textContent = fp
  updateConvBtn()
})

function updateConvBtn () {
  $('btn-run-conv').disabled = !(aseState.convInput && aseState.convOutput)
}

$('btn-run-conv').addEventListener('click', async () => {
  const fmt = $('conv-format').value || undefined
  $('btn-run-conv').disabled = true
  setAseProgress('conv-prog-fill', 'conv-prog-label', 'conv-prog-row', 0, 'Converting …')

  window.monet.onAseProgress(msg => {
    setAseProgress('conv-prog-fill', 'conv-prog-label', 'conv-prog-row',
                   msg.percent ?? 0, msg.message)
  })

  const r = await window.monet.aseRun({
    action: 'convert',
    input:  aseState.convInput,
    output: aseState.convOutput,
    format: fmt
  })
  $('btn-run-conv').disabled = false

  if (!r.ok) {
    setStatus('Conversion error: ' + (r.message || r.error))
    $('conv-result').textContent = '✗ ' + (r.message || r.error)
    $('conv-result').classList.remove('hidden')
    return
  }

  hideAseProgress('conv-prog-row')
  $('conv-result').textContent = `✓ ${r.n_frames} frames written to ${r.output}`
  $('conv-result').classList.remove('hidden')
  setStatus(`Converted: ${r.output}`)
})

// =============================================================================
// ── Init ─────────────────────────────────────────────────────────────────────
// =============================================================================

window.addEventListener('load', () => {
  resizeCanvas()
  updateSampledCount()
  checkAseStatus()
})

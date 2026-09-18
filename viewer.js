'use strict'

// Canvas 2D molecular viewer tuned for large systems:
// - bonds from a spatial grid (linear in the number of atoms),
// - atoms drawn from cached sphere sprites, bonds batched per colour,
// - coalesced redraws (requestAnimationFrame) and a light mode while rotating.
;(function (root) {
  const CPK = {
    H: '#e8e8e8', C: '#404040', N: '#3050f8', O: '#ff0d0d', S: '#ffff30', P: '#ff8000', F: '#90e050',
    Cl: '#1ff01f', Br: '#a62929', I: '#940094', Fe: '#e06633', Cu: '#c88033', Zn: '#7d80b0', Se: '#ffa100',
    Mg: '#228b22', Ca: '#3dff00', Na: '#ab5cf2', K: '#8f40d4', B: '#ffb5b5', Si: '#f0c8a0', Li: '#cc80ff',
    Al: '#bfa6a6', Ti: '#bfc2c7', Co: '#f090a0', Ni: '#50d050', Mn: '#9c7ac7', Cr: '#8a99c7', Ar: '#80d1e3',
    He: '#d9ffff', Ne: '#b3e3f5', Au: '#ffd123', Ag: '#c0c0c0', Pt: '#d0d0e0', Pd: '#006985', Ru: '#248f8f',
    Ir: '#175487', Cs: '#57178f', Rb: '#702eb0', Sr: '#00ff00', Ba: '#00c900', X: '#ff69b4'
  }
  const DEFAULT_COLOR = '#ff69b4'
  const COV = {
    H: 0.31, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Br: 1.20,
    I: 1.39, Fe: 1.32, Cu: 1.32, Zn: 1.22, Na: 1.66, K: 2.03, Mg: 1.41, Ca: 1.76, Li: 1.28, Se: 1.20, Al: 1.21,
    Ti: 1.60, Co: 1.26, Ni: 1.24, Mn: 1.39, Au: 1.36, Ag: 1.45, Pt: 1.36
  }
  const VDW = { H: 1.2, C: 1.7, N: 1.55, O: 1.52, F: 1.47, P: 1.8, S: 1.8, Cl: 1.75, Br: 1.85, I: 1.98, Na: 2.27, K: 2.75, Mg: 1.73, Ca: 2.31, Si: 2.1, Se: 1.9, B: 1.92, Li: 1.82 }
  const atomColor = element => CPK[element] ?? DEFAULT_COLOR
  const covalentRadius = element => COV[element] ?? 1.0
  const vdwRadius = element => VDW[element] ?? 1.8

  // Radii in Å (scaled by zoom = pixels per Å); bond widths in Å (null = hairline).
  const STYLES = {
    'ball-stick': { label: 'Balls & sticks', atom: el => 0.28 * covalentRadius(el) + 0.12, minAtom: 2.5, bond: 0.09, bonds: true },
    sticks: { label: 'Sticks (licorice)', atom: () => 0.14, minAtom: 1.2, bond: 0.28, bonds: true },
    spacefill: { label: 'Space-filling (vdW)', atom: el => vdwRadius(el), minAtom: 2, bond: 0, bonds: false },
    lines: { label: 'Lines (wireframe)', atom: () => 0, minAtom: 0, bond: null, bonds: true },
    points: { label: 'Points', atom: () => 0, minAtom: 1.6, bond: 0, bonds: false, flat: true }
  }
  const LABEL_LIMIT = 300
  const FAST_LIMIT = 2500

  function themeColor (name, fallback) { return root.MonetTheme ? root.MonetTheme.color(name, fallback) : fallback }
  function rgb (hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
  function shade (hex, f) {
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)))
    return `rgb(${rgb(hex).map(v => clamp(f >= 0 ? v + (255 - v) * f : v * (1 + f))).join(',')})`
  }

  // Bonds from a uniform grid: only neighbouring cells are compared.
  function findBonds (atoms, scale = 1.3) {
    const n = atoms.length
    if (n < 2) return new Uint32Array(0)
    let maxRadius = 0
    const radii = new Float32Array(n)
    // Unknown atoms (X, from coordinate-only files) get no bonds: their distances say nothing about chemistry.
    for (let i = 0; i < n; i++) { radii[i] = atoms[i].element === 'X' ? 0 : covalentRadius(atoms[i].element); maxRadius = Math.max(maxRadius, radii[i]) }
    if (maxRadius === 0) return new Uint32Array(0)
    const size = 2 * maxRadius * scale
    let minX = Infinity, minY = Infinity, minZ = Infinity
    for (const a of atoms) { minX = Math.min(minX, a.x); minY = Math.min(minY, a.y); minZ = Math.min(minZ, a.z) }
    const cells = new Map()
    const keyOf = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791)
    const coords = new Int32Array(3 * n)
    for (let a = 0; a < n; a++) {
      const i = Math.floor((atoms[a].x - minX) / size), j = Math.floor((atoms[a].y - minY) / size), k = Math.floor((atoms[a].z - minZ) / size)
      coords[3 * a] = i; coords[3 * a + 1] = j; coords[3 * a + 2] = k
      const key = keyOf(i, j, k)
      const list = cells.get(key)
      if (list) list.push(a); else cells.set(key, [a])
    }
    const bonds = []
    for (let a = 0; a < n; a++) {
      const A = atoms[a]
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        const list = cells.get(keyOf(coords[3 * a] + di, coords[3 * a + 1] + dj, coords[3 * a + 2] + dk))
        if (!list) continue
        for (const b of list) {
          if (b <= a || radii[a] === 0 || radii[b] === 0) continue
          const B = atoms[b]
          const limit = (radii[a] + radii[b]) * scale
          const dx = A.x - B.x, dy = A.y - B.y, dz = A.z - B.z
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 < limit * limit && d2 > 0.01) bonds.push(a, b)
        }
      }
    }
    return Uint32Array.from(bonds)
  }

  class MolecularViewer {
    constructor (canvas) {
      this.canvas = canvas
      this.ctx = canvas.getContext('2d')
      this.atoms = []
      this.bonds = new Uint32Array(0)
      this.selected = new Set() // MONET atom IDs, in selection order
      this.rotX = 0.25
      this.rotY = -0.40
      this.zoom = 30
      this.center = [0, 0, 0]
      this.style = 'ball-stick'
      this.showAllLabels = false
      this.showSelectionOrder = false
      this.cell = null
      // Colour map of an analysis: { atomColors: Map(MONET ID → colour), segments: [{ ids, color }], legend }
      this.overlay = null
      this.onSelectionChange = null
      // Right click (or Ctrl-click) without dragging: onContextClick(event, MONET ID or null).
      this.onContextClick = null
      this.onLoad = null // called after loadAtoms()
      this.dragging = false
      this.panning = false
      this.moving = false
      this.lastMouse = null
      this._wasDrag = false
      this._frame = null
      this._sprites = new Map()
      this._spritesOK = true
      this.proj = { x: new Float32Array(0), y: new Float32Array(0), z: new Float32Array(0) }

      canvas.addEventListener('mousedown', e => this._onMouseDown(e))
      canvas.addEventListener('mousemove', e => this._onMouseMove(e))
      canvas.addEventListener('mouseup', e => this._onMouseUp(e))
      // The browser menu is replaced by onContextClick, sent on release so that a right-drag pans instead.
      canvas.addEventListener('contextmenu', e => e.preventDefault())
      canvas.addEventListener('mouseleave', () => this._endDrag())
      canvas.addEventListener('wheel', e => this._onWheel(e), { passive: false })
      canvas.addEventListener('click', e => this._onClick(e))
      root.addEventListener?.('mouseup', () => this._endDrag())
    }

    get atomCount () { return this.atoms.length }

    setStyle (style) {
      if (!STYLES[style]) return
      this.style = style
      this.render()
    }

    loadAtoms (atoms) {
      this.atoms = atoms
      this.bonds = new Uint32Array(0)
      this._index = new Map(atoms.map((atom, i) => [atom.index, i]))
      if (!atoms.length) { this.render(); this.onLoad?.(); return }
      let cx = 0, cy = 0, cz = 0
      for (const a of atoms) { cx += a.x; cy += a.y; cz += a.z }
      cx /= atoms.length; cy /= atoms.length; cz /= atoms.length
      this.center = [cx, cy, cz]
      let maxD = 0
      for (const a of atoms) maxD = Math.max(maxD, Math.hypot(a.x - cx, a.y - cy, a.z - cz))
      // A hidden canvas has no size yet; fitView() is called again once it is shown.
      this.zoom = (Math.min(this.canvas.width, this.canvas.height) || 600) * 0.38 / (maxD || 5)
      this.bonds = findBonds(atoms)
      this._topology = this.bonds
      this.render()
      this.onLoad?.()
    }

    // Move atoms to new coordinates (flat [x0, y0, z0, x1, …] in atom order) keeping the view.
    // rebond: search bonds again; otherwise keep the known bonds that are still short (fast for playback).
    updateCoordinates (coords, { rebond = true } = {}) {
      const n = this.atoms.length
      if (coords.length !== 3 * n) throw new Error('Coordinate count does not match the displayed atoms.')
      for (let i = 0; i < n; i++) {
        const atom = this.atoms[i]
        atom.x = coords[3 * i]; atom.y = coords[3 * i + 1]; atom.z = coords[3 * i + 2]
      }
      if (rebond || !this._topology) {
        this.bonds = findBonds(this.atoms)
        this._topology = this.bonds
      } else {
        const kept = []
        const t = this._topology
        for (let k = 0; k < t.length; k += 2) {
          const a = this.atoms[t[k]], b = this.atoms[t[k + 1]]
          const limit = (covalentRadius(a.element) + covalentRadius(b.element)) * 1.45
          const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
          if (dx * dx + dy * dy + dz * dz < limit * limit) kept.push(t[k], t[k + 1])
        }
        this.bonds = Uint32Array.from(kept)
      }
      this.requestRender()
    }

    // Project a 3D point to 2D canvas coords + depth.
    _project (x, y, z) {
      const [cx, cy, cz] = this.center
      const px = x - cx, py = y - cy, pz = z - cz
      const cyR = Math.cos(this.rotY), syR = Math.sin(this.rotY), cxR = Math.cos(this.rotX), sxR = Math.sin(this.rotX)
      const x1 = px * cyR + pz * syR
      const z1 = -px * syR + pz * cyR
      const y2 = py * cxR - z1 * sxR
      const z2 = py * sxR + z1 * cxR
      return { sx: this.canvas.width / 2 + x1 * this.zoom, sy: this.canvas.height / 2 - y2 * this.zoom, sz: z2 }
    }

    _projectAll () {
      const n = this.atoms.length
      if (this.proj.x.length !== n) this.proj = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n) }
      const { x, y, z } = this.proj
      const [cx, cy, cz] = this.center
      const cyR = Math.cos(this.rotY), syR = Math.sin(this.rotY), cxR = Math.cos(this.rotX), sxR = Math.sin(this.rotX)
      const w2 = this.canvas.width / 2, h2 = this.canvas.height / 2, zoom = this.zoom
      for (let i = 0; i < n; i++) {
        const a = this.atoms[i]
        const px = a.x - cx, py = a.y - cy, pz = a.z - cz
        const x1 = px * cyR + pz * syR
        const z1 = -px * syR + pz * cyR
        x[i] = w2 + x1 * zoom
        y[i] = h2 - (py * cxR - z1 * sxR) * zoom
        z[i] = py * sxR + z1 * cxR
      }
      return this.proj
    }

    _radius (i) {
      const style = STYLES[this.style]
      return Math.max(style.minAtom, style.atom(this.atoms[i].element) * this.zoom)
    }

    // Coalesce redraws triggered by mouse moves into one per animation frame.
    requestRender () {
      if (this._frame) return
      const schedule = root.requestAnimationFrame || (fn => setTimeout(fn, 16))
      this._frame = schedule(() => { this._frame = null; this.render() })
    }

    _sprite (color, radius, outline) {
      const size = Math.max(1, Math.round(radius * 2))
      const key = `${color}|${size}|${outline}`
      let sprite = this._sprites.get(key)
      if (sprite) return sprite
      if (this._sprites.size > 600) this._sprites.clear()
      const doc = this.canvas.ownerDocument || root.document
      sprite = doc.createElement('canvas')
      sprite.width = sprite.height = size + 2
      const c = sprite.getContext('2d')
      const r = size / 2, m = r + 1
      const grad = c.createRadialGradient(m - r * 0.35, m - r * 0.35, r * 0.08, m, m, r)
      grad.addColorStop(0, shade(color, 0.65))
      grad.addColorStop(0.55, color)
      grad.addColorStop(1, shade(color, -0.45))
      c.beginPath(); c.arc(m, m, r, 0, Math.PI * 2); c.fillStyle = grad; c.fill()
      if (outline) { c.lineWidth = 1; c.strokeStyle = outline; c.stroke() }
      this._sprites.set(key, sprite)
      return sprite
    }

    render () {
      const { canvas, ctx, atoms } = this
      const W = canvas.width, H = canvas.height
      const bg = ctx.createLinearGradient(0, 0, 0, H)
      bg.addColorStop(0, themeColor('--canvas-bg', '#0d0d1a'))
      bg.addColorStop(1, themeColor('--canvas-bg2', '#10101f'))
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, W, H)
      if (!atoms.length) return
      const selectColor = themeColor('--select', '#ffd700')
      const selectRing = themeColor('--select-ring', '#fff')
      const outline = themeColor('--atom-outline', 'rgba(0,0,0,0)')
      const carbonBond = themeColor('--bond-carbon', '#666')
      const n = atoms.length
      // While rotating a large system, draw bonds as lines and skip sphere shading.
      const light = this.moving && n > FAST_LIMIT
      const styleName = light && this.style !== 'points' ? 'lines' : this.style
      const style = STYLES[styleName]
      const { x, y, z } = this._projectAll()
      const overlay = this.overlay
      const dimmed = themeColor('--atom-dimmed', '#5a5a6a')
      // Mapped atoms take the colour of their value; with a map of bonds/angles the other atoms are dimmed.
      const colorOf = i => overlay?.atomColors?.get(atoms[i].index) || (overlay?.dimAtoms ? dimmed : atomColor(atoms[i].element))

      if (this.cell) {
        const v = this.cellVertices().map(point => this._project(...point))
        ctx.save(); ctx.strokeStyle = themeColor('--cell-line', '#54cbd8'); ctx.globalAlpha = .65; ctx.lineWidth = 1
        ctx.beginPath()
        for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) { ctx.moveTo(v[i].sx, v[i].sy); ctx.lineTo(v[i | bit].sx, v[i | bit].sy) }
        ctx.stroke()
        ctx.font = '12px monospace'; ctx.fillStyle = themeColor('--cell-label', '#8fe9f3')
        for (const [i, label] of [[1, 'a'], [2, 'b'], [4, 'c']]) ctx.fillText(label, v[i].sx, v[i].sy)
        ctx.restore()
      }

      // Bonds: two half-segments coloured by element, one path per colour.
      if (style.bonds && this.bonds.length) {
        const paths = new Map()
        const pathFor = color => { let p = paths.get(color); if (!p) { p = []; paths.set(color, p) } return p }
        for (let k = 0; k < this.bonds.length; k += 2) {
          const a = this.bonds[k], b = this.bonds[k + 1]
          const mx = (x[a] + x[b]) / 2, my = (y[a] + y[b]) / 2
          const ca = atomColor(atoms[a].element), cb = atomColor(atoms[b].element)
          pathFor(ca === '#404040' ? carbonBond : ca).push(x[a], y[a], mx, my)
          pathFor(cb === '#404040' ? carbonBond : cb).push(mx, my, x[b], y[b])
        }
        ctx.save()
        ctx.lineCap = 'round'
        ctx.lineWidth = style.bond === null ? 1.2 : Math.max(1.2, style.bond * this.zoom)
        ctx.globalAlpha = (styleName === 'ball-stick' ? 0.75 : 1) * (overlay?.segments?.length ? 0.3 : 1)
        for (const [color, segments] of paths) {
          ctx.strokeStyle = color
          ctx.beginPath()
          for (let s = 0; s < segments.length; s += 4) { ctx.moveTo(segments[s], segments[s + 1]); ctx.lineTo(segments[s + 2], segments[s + 3]) }
          ctx.stroke()
        }
        ctx.restore()
      }

      // Mapped bonds, angles and dihedrals as thick coloured paths.
      if (overlay?.segments?.length) {
        ctx.save()
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        ctx.lineWidth = Math.max(3, (style.bond ?? 0.08) * this.zoom * 1.6)
        for (const { ids, color } of overlay.segments) {
          const points = ids.map(id => this._index?.get(id)).filter(i => i !== undefined)
          if (points.length < 2) continue
          ctx.strokeStyle = color
          ctx.beginPath()
          ctx.moveTo(x[points[0]], y[points[0]])
          for (const i of points.slice(1)) ctx.lineTo(x[i], y[i])
          ctx.stroke()
        }
        ctx.restore()
      }

      // Atoms back to front (line mode draws only the selected atoms, below).
      if (styleName !== 'lines') {
        const order = Array.from({ length: n }, (_, i) => i)
        if (!style.flat) order.sort((a, b) => z[a] - z[b])
        if (style.flat) {
          const groups = new Map()
          for (const i of order) {
            const color = colorOf(i)
            let g = groups.get(color); if (!g) { g = []; groups.set(color, g) }
            g.push(i)
          }
          for (const [color, list] of groups) {
            ctx.fillStyle = color
            ctx.beginPath()
            const r = style.minAtom
            for (const i of list) { ctx.moveTo(x[i] + r, y[i]); ctx.arc(x[i], y[i], r, 0, Math.PI * 2) }
            ctx.fill()
          }
        } else {
          for (const i of order) {
            if (this.selected.has(atoms[i].index)) continue
            const r = this._radius(i)
            const color = colorOf(i)
            let drawn = false
            if (this._spritesOK) {
              try {
                const sprite = this._sprite(color, r, outline)
                ctx.drawImage(sprite, x[i] - sprite.width / 2, y[i] - sprite.height / 2)
                drawn = true
              } catch { this._spritesOK = false }
            }
            if (!drawn) {
              ctx.beginPath(); ctx.arc(x[i], y[i], r, 0, Math.PI * 2)
              ctx.fillStyle = color; ctx.fill()
              ctx.lineWidth = 1; ctx.strokeStyle = outline; ctx.stroke()
            }
          }
        }
      }

      // Selected atoms on top, highlighted in every style.
      const selectedOrder = [...this.selected]
      for (const [order, id] of selectedOrder.entries()) {
        const i = this._index?.get(id)
        if (i === undefined) continue
        const r = Math.max(5, this._radius(i))
        ctx.save()
        ctx.shadowBlur = 18; ctx.shadowColor = selectColor
        ctx.beginPath(); ctx.arc(x[i], y[i], r, 0, Math.PI * 2)
        ctx.fillStyle = selectColor; ctx.fill()
        ctx.shadowBlur = 0
        ctx.lineWidth = 2.5; ctx.strokeStyle = selectRing; ctx.stroke()
        ctx.restore()
        if (this.showSelectionOrder) {
          ctx.font = 'bold 11px monospace'; ctx.fillStyle = themeColor('--gold', '#ffd700')
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(`#${order + 1}`, x[i] + r + 12, y[i] - r - 5)
        }
      }

      if (overlay?.legend) this._drawLegend(overlay.legend)

      // Labels: atom IDs for small systems (or when requested) and always for selections.
      if (!light) {
        const labelAll = n <= LABEL_LIMIT && (this.showAllLabels || styleName === 'ball-stick' || styleName === 'spacefill')
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        for (let i = 0; i < n; i++) {
          const isSel = this.selected.has(atoms[i].index)
          if (!isSel && !labelAll) continue
          const r = this._radius(i)
          if (!isSel && !this.showAllLabels && r <= 8) continue
          const fontSize = Math.max(9, Math.min(Math.max(r, 6) * 0.72, 14))
          ctx.font = `bold ${fontSize}px monospace`
          ctx.fillStyle = isSel ? '#1a1a1a' : (r > 14 ? '#fff' : 'rgba(255,255,255,0.75)')
          if (styleName === 'lines' || styleName === 'points') ctx.fillStyle = isSel ? '#1a1a1a' : themeColor('--plot-label', '#c0c0d8')
          ctx.fillText(atoms[i].index, x[i], y[i])
        }
      }
    }

    // Colour bar of the overlay (bottom-left corner).
    _drawLegend ({ title, min, max, colors, format = v => v.toPrecision(3) }) {
      const { ctx, canvas } = this
      const width = Math.min(180, canvas.width * 0.4), height = 10
      const left = 12, top = canvas.height - 34
      const gradient = ctx.createLinearGradient(left, 0, left + width, 0)
      colors.forEach((color, k) => gradient.addColorStop(k / (colors.length - 1), color))
      ctx.save()
      ctx.fillStyle = gradient
      ctx.fillRect(left, top, width, height)
      ctx.strokeStyle = themeColor('--plot-axis', '#7a7a9e'); ctx.strokeRect(left, top, width, height)
      ctx.fillStyle = themeColor('--plot-label', '#c0c0d8'); ctx.font = '11px sans-serif'; ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'; ctx.fillText(title, left, top - 5, canvas.width - 24)
      ctx.textBaseline = 'top'
      ctx.fillText(format(min), left, top + height + 3)
      ctx.textAlign = 'right'; ctx.fillText(format(max), left + width, top + height + 3)
      ctx.restore()
    }

    setOverlay (overlay) {
      this.overlay = overlay
      this.requestRender()
    }

    // Hit-test: the visible front-most atom within its drawn radius (min 5 px).
    _hitTest (mx, my) {
      const { x, y, z } = this._projectAll()
      let best = null, bestDepth = -Infinity
      for (let i = 0; i < this.atoms.length; i++) {
        const radius = Math.max(5, this._radius(i))
        const dx = x[i] - mx, dy = y[i] - my
        if (dx * dx + dy * dy <= radius * radius && z[i] >= bestDepth) { best = this.atoms[i].index; bestDepth = z[i] }
      }
      return best
    }

    // Left drag rotates; right drag (also Shift/Ctrl + left drag, for trackpads) translates.
    _onMouseDown (e) {
      if (e.button !== 0 && e.button !== 2) return
      this._wasDrag = false
      this.dragStart = { x: e.clientX, y: e.clientY }
      this.dragging = true
      this.panning = e.button === 2 || e.shiftKey || e.ctrlKey
      this._contextPress = e.button === 2 || (e.button === 0 && e.ctrlKey)
      this.lastMouse = { x: e.clientX, y: e.clientY }
    }

    _onMouseMove (e) {
      if (!this.dragging || !this.lastMouse) return
      if (!this._wasDrag && Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) <= 4) return
      this._wasDrag = true
      this.moving = true
      const dx = e.clientX - this.lastMouse.x, dy = e.clientY - this.lastMouse.y
      if (this.panning) {
        const rect = this.canvas.getBoundingClientRect?.()
        const scale = rect?.width ? this.canvas.width / rect.width : 1
        this.pan(dx * scale, dy * scale)
      } else {
        this.rotY += dx * 0.008
        this.rotX += dy * 0.008
      }
      this.lastMouse = { x: e.clientX, y: e.clientY }
      this.requestRender()
    }

    // Shift the view by (dx, dy) canvas pixels: the centre moves in the screen plane, so rotation
    // and zoom then act around the new point in the middle of the canvas.
    pan (dx, dy) {
      const X = -dx / this.zoom, Y = dy / this.zoom
      const cyR = Math.cos(this.rotY), syR = Math.sin(this.rotY), cxR = Math.cos(this.rotX), sxR = Math.sin(this.rotX)
      // Inverse of the rotation in _project applied to the screen-plane vector (X, Y, 0).
      const py = Y * cxR, z1 = -Y * sxR
      const px = X * cyR - z1 * syR, pz = X * syR + z1 * cyR
      this.center = [this.center[0] + px, this.center[1] + py, this.center[2] + pz]
      this.requestRender()
    }

    _onMouseUp (e) {
      const context = this.dragging && this._contextPress && !this._wasDrag
      this._contextPress = false
      this._endDrag()
      if (!context) return
      const [mx, my] = this._canvasPoint(e)
      this.onContextClick?.(e, this._hitTest(mx, my))
    }

    _canvasPoint (e) {
      const rect = this.canvas.getBoundingClientRect()
      return [(e.clientX - rect.left) * this.canvas.width / (rect.width || this.canvas.clientWidth || 1),
        (e.clientY - rect.top) * this.canvas.height / (rect.height || this.canvas.clientHeight || 1)]
    }

    _endDrag () {
      this.dragging = false
      this.panning = false
      if (this.moving) { this.moving = false; this.requestRender() }
    }

    _onWheel (e) {
      e.preventDefault()
      this.zoom = Math.max(0.5, Math.min(600, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1)))
      this.requestRender()
    }

    _onClick (e) {
      if (this._wasDrag) { this._wasDrag = false; return }
      if (e.ctrlKey) return // Ctrl-click is the macOS right click
      const [mx, my] = this._canvasPoint(e)
      const hit = this._hitTest(mx, my)
      if (hit !== null) {
        if (this.selected.has(hit)) this.selected.delete(hit)
        else this.selected.add(hit)
        this.render()
        this.onSelectionChange?.([...this.selected])
      }
    }

    // Selection helpers on the displayed geometry (used when ASE is not available).
    // IDs are MONET IDs; bonds are the displayed ones (no periodic images).
    elements () { return [...new Set(this.atoms.map(atom => atom.element))].sort() }

    idsOfElements (elements) {
      const wanted = new Set(elements)
      return this.atoms.filter(atom => wanted.has(atom.element)).map(atom => atom.index)
    }

    bondedIds (ids, { whole = false } = {}) {
      const adjacency = this.atoms.map(() => [])
      for (let k = 0; k < this.bonds.length; k += 2) {
        adjacency[this.bonds[k]].push(this.bonds[k + 1]); adjacency[this.bonds[k + 1]].push(this.bonds[k])
      }
      const start = ids.map(id => this._index?.get(id)).filter(i => i !== undefined)
      const found = new Set(start), order = [...start]
      let frontier = start
      while (frontier.length) {
        const next = []
        for (const i of frontier) for (const j of adjacency[i].sort((a, b) => a - b)) {
          if (!found.has(j)) { found.add(j); order.push(j); next.push(j) }
        }
        frontier = whole ? next : []
      }
      return order.map(i => this.atoms[i].index)
    }

    idsWithin (ids, radius) {
      const seeds = ids.map(id => this._index?.get(id)).filter(i => i !== undefined).map(i => this.atoms[i])
      const inside = this.atoms.filter(atom => !ids.includes(atom.index) &&
        seeds.some(s => (s.x - atom.x) ** 2 + (s.y - atom.y) ** 2 + (s.z - atom.z) ** 2 <= radius * radius))
      return [...ids, ...inside.map(atom => atom.index)]
    }

    // Centre the view on the given atoms (all atoms when empty) keeping the rotation and zoom.
    centerOn (ids) {
      const list = ids?.length ? ids.map(id => this.atoms[this._index?.get(id)]).filter(Boolean) : this.atoms
      if (!list.length) return
      this.center = ['x', 'y', 'z'].map(axis => list.reduce((sum, atom) => sum + atom[axis], 0) / list.length)
      this.requestRender()
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
      const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
      const extend = (px, py, pz) => {
        low[0] = Math.min(low[0], px); low[1] = Math.min(low[1], py); low[2] = Math.min(low[2], pz)
        high[0] = Math.max(high[0], px); high[1] = Math.max(high[1], py); high[2] = Math.max(high[2], pz)
      }
      for (const a of this.atoms) extend(a.x, a.y, a.z)
      if (this.cell) for (const p of this.cellVertices()) extend(...p)
      this.center = low.map((v, j) => (v + high[j]) / 2)
      const half = Math.hypot(high[0] - low[0], high[1] - low[1], high[2] - low[2]) / 2 || 1
      this.zoom = Math.min(this.canvas.width, this.canvas.height) * .45 / half
      this.render()
    }

    resize () {
      const { canvas } = this
      canvas.width = canvas.clientWidth
      canvas.height = canvas.clientHeight
      this.render()
    }
  }

  const api = { MolecularViewer, STYLES, findBonds, atomColor, covalentRadius, CPK }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetViewer = api
})(globalThis)

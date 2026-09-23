'use strict'

;(function (root) {
  const FALLBACK = {
    bg: '#0d0d1a', grid: '#262640', axis: '#7a7a9e', tick: '#a9acc3', label: '#c0c0d8', title: '#dde0ef',
    series: ['#4d9de0', '#e94560', '#00c87a', '#ffd700', '#c77dff', '#ff9f1c', '#2ec4b6', '#ff6b6b'],
    heat: ['#0d0887', '#cc4778', '#f0f921']
  }

  // Colors follow the active day/night theme at render time, so exports match the screen.
  function palette () {
    const color = (name, fallback) => root.MonetTheme ? root.MonetTheme.color(name, fallback) : fallback
    return {
      bg: color('--canvas-bg', FALLBACK.bg),
      grid: color('--plot-grid', FALLBACK.grid),
      axis: color('--plot-axis', FALLBACK.axis),
      tick: color('--plot-tick', FALLBACK.tick),
      label: color('--plot-label', FALLBACK.label),
      title: color('--plot-title', FALLBACK.title),
      series: FALLBACK.series.map((fallback, i) => color(`--series-${i + 1}`, fallback)),
      heat: ['low', 'mid', 'high'].map((name, i) => color(`--heat-${name}`, FALLBACK.heat[i]))
    }
  }

  function wrap90 (value) { return ((value + 90) % 180 + 180) % 180 - 90 }
  function wrap180 (value) { return (value % 180 + 180) % 180 }

  // Axis limits, wrap period and tick step for each angle convention.
  const ANGLE_RANGES = {
    natural: { min: 0, max: 180, period: null, step: 30 },
    360: { min: 0, max: 360, period: 360, step: 60, wrap: value => (value % 360 + 360) % 360 },
    signed90: { min: -90, max: 90, period: 180, step: 30, wrap: wrap90, label: 'Folded angle (°, −90 to +90, period 180°)' },
    fold180: { min: 0, max: 180, period: 180, step: 30, wrap: wrap180, label: 'Folded angle (°, 0–180, period 180°)' }
  }

  function formatTick (value, span) {
    if (value === 0) return '0'
    const magnitude = Math.abs(value)
    if (magnitude >= 1e5 || magnitude < 1e-3) return value.toExponential(2)
    // Enough decimals to tell the ~5 ticks of the axis apart, even for very narrow ranges.
    const digits = span > 0 ? Math.min(8, Math.max(0, 2 - Math.floor(Math.log10(span)))) : 3
    return value.toFixed(digits)
  }

  function csvCell (value) {
    const text = value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? '' : String(value)
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  function saveBlob (blob, filename) {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = filename
    document.body.appendChild(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }

  function header (ctx, colors, W, title, source) {
    ctx.textAlign = 'center'
    ctx.fillStyle = colors.title; ctx.font = 'bold 15px sans-serif'
    ctx.fillText(title || '', W / 2, 23, W - 30)
    if (source) { ctx.font = '11px sans-serif'; ctx.fillStyle = colors.label; ctx.fillText(source, W / 2, 41, W - 30) }
  }

  class Chart {
    constructor (canvasId, placeholderId) {
      this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId
      this.ph = typeof placeholderId === 'string' ? document.getElementById(placeholderId) : placeholderId
      this.data = null
      this.onChange = null
    }

    setData (data, { keepView = false } = {}) {
      if (!keepView) this.view = null
      this.data = data
      this.ph?.classList.add('hidden')
      this.canvas.classList.remove('hidden')
      this._render()
      this.onChange?.()
    }

    clear () {
      this.data = null
      this.canvas.getContext('2d').clearRect(0, 0, this.canvas.width, this.canvas.height)
      this.ph?.classList.remove('hidden')
      this.canvas.classList.add('hidden')
      this.onChange?.()
    }

    _prepare (target, width, height, scale) {
      const ctx = target.getContext('2d')
      const W = width || target.clientWidth || 600
      const H = height || target.clientHeight || 320
      target.width = Math.round(W * scale)
      target.height = Math.round(H * scale)
      ctx.scale(scale, scale)
      const colors = palette()
      ctx.fillStyle = colors.bg
      ctx.fillRect(0, 0, W, H)
      return { ctx, W, H, colors }
    }

    exportSize () { return [1200, 720] }

    async downloadPNG (filename) {
      if (!this.data) throw new Error('Compute an analysis before downloading its plot.')
      const output = document.createElement('canvas')
      const [width, height] = this.exportSize()
      this._render(output, width, height, 2)
      const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not create the PNG image.')
      saveBlob(blob, filename)
    }

    downloadCSV (filename) {
      if (!this.data) throw new Error('Compute an analysis before downloading its data.')
      saveBlob(new Blob([this.toCSV()], { type: 'text/csv' }), filename)
    }
  }

  // ── Stacked-dot distributions: polar (angles) and linear (any quantity) ──

  function wrapLegend (ctx, W, entries, top) {
    ctx.font = '11px sans-serif'
    let lx = 70, ly = top
    const placed = []
    for (const entry of entries) {
      const size = Math.min(W - 90, ctx.measureText(entry.label).width + 40)
      if (lx + size > W - 20 && lx > 70) { lx = 70; ly += 17 }
      placed.push({ ...entry, x: lx, y: ly, width: size })
      lx += size
    }
    return { placed, bottom: ly }
  }

  function drawLegend (ctx, colors, placed) {
    for (const item of placed) {
      ctx.fillStyle = item.color
      if (item.line) { ctx.strokeStyle = item.color; ctx.setLineDash([4, 3]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(item.x, item.y - 4); ctx.lineTo(item.x + 18, item.y - 4); ctx.stroke(); ctx.setLineDash([]) }
      else { ctx.beginPath(); ctx.arc(item.x + 9, item.y - 4, 4.5, 0, Math.PI * 2); ctx.fill() }
      ctx.fillStyle = colors.label; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(item.label, item.x + 23, item.y, item.width - 25)
    }
  }

  // Bin every series on a common grid; `perDot` frames are represented by one dot.
  function stackBins (series, low, high, bins, maxDots) {
    const width = (high - low) / bins
    const counts = series.map(item => {
      const c = new Array(bins).fill(0)
      for (const v of item.values) if (Number.isFinite(v)) c[Math.min(bins - 1, Math.max(0, Math.floor((v - low) / width)))]++
      return c
    })
    const tallest = Math.max(1, ...counts.flat())
    const perDot = Math.max(1, Math.ceil(tallest / maxDots))
    return { width, counts, perDot, dots: counts.map(c => c.map(n => Math.ceil(n / perDot))) }
  }

  function renderDistribution (chart, target, width, height, scale) {
    const { ctx, W, H, colors } = chart._prepare(target, width, height, scale)
    const d = chart.data
    const colorOf = (item, i) => colors.series[(item.colorIndex ?? i) % colors.series.length]
    const entries = d.series.map((item, i) => ({ label: item.label, color: colorOf(item, i) }))
    for (const ref of d.references || []) entries.push({ label: ref.label, color: colors.label, line: true })
    const legend = wrapLegend(ctx, W, entries, d.source ? 65 : 47)
    const notes = d.notes || []
    header(ctx, colors, W, d.title, d.source)
    ctx.font = '11px sans-serif'; ctx.fillStyle = colors.label; ctx.textAlign = 'left'
    notes.forEach((note, i) => ctx.fillText(note, 70, legend.bottom + 20 + i * 15, W - 90))
    const top = legend.bottom + 30 + notes.length * 15
    const radialValues = d.radial?.values
    const series = d.series.map((item, i) => ({ ...item, radial: radialValues ? radialValues[i] : null }))
    if (d.type === 'polar') renderPolar(ctx, colors, W, H, top, d, series, colorOf)
    else renderLinearDots(ctx, colors, W, H, top, d, series, colorOf)
    drawLegend(ctx, colors, legend.placed)
  }

  function renderPolar (ctx, colors, W, H, top, d, series, colorOf) {
    const [low, high] = d.range
    const span = high - low
    const full = span > 180
    // Half circle: radial axis on the left (paper style); full circle: ring labels on the vertical spoke.
    const R = Math.max(40, full
      ? Math.min((W - 130) / 2, (H - top - 110) / 2)
      : Math.min((W - 150) / 2, H - top - 90))
    const cx = full ? W / 2 : Math.max(W / 2, R + 100)
    const cy = top + 34 + R
    const phi = theta => (theta - low) / span * (full ? 2 * Math.PI : Math.PI)
    const at = (theta, r) => [cx + r * Math.cos(phi(theta)), cy - r * Math.sin(phi(theta))]
    const arcEnd = full ? 2 * Math.PI : Math.PI
    // Radial scale: stacked dots or a value axis.
    const dotsMode = !series.some(item => item.radial)
    const r0 = dotsMode ? R * 0.1 : 0
    let rMin = 0, rMax = 1, stack
    if (dotsMode) {
      const dotStep = Math.max(3, Math.min(11, R / 40))
      const maxDots = Math.max(4, Math.floor((R - r0) / dotStep))
      stack = { ...stackBins(series, low, high, d.bins || 72, maxDots), dotStep }
      rMax = maxDots * stack.perDot
    } else {
      const values = series.flatMap(item => item.radial.filter(Number.isFinite))
      rMin = Math.min(0, ...values); rMax = Math.max(...values)
      if (!(rMax > rMin)) rMax = rMin + 1
      rMax += (rMax - rMin) * 0.05
    }
    const radius = value => dotsMode ? r0 + (value / rMax) * (R - r0) : (value - rMin) / (rMax - rMin) * R
    // Grid: rings, spokes and angle labels.
    ctx.lineWidth = 1
    const ringValues = Array.from({ length: 6 }, (_, k) => (dotsMode ? 0 : rMin) + (k / 5) * (rMax - (dotsMode ? 0 : rMin)))
    for (const [k, value] of ringValues.entries()) {
      ctx.strokeStyle = k === 5 ? colors.axis : colors.grid
      ctx.setLineDash(k % 2 ? [3, 3] : [])
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(0.5, radius(value)), -arcEnd, 0); ctx.stroke()
    }
    ctx.setLineDash([])
    const step = full ? 30 : 15
    ctx.font = '12px sans-serif'; ctx.fillStyle = colors.tick; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    for (let theta = low; theta <= high + 1e-9; theta += step) {
      const [x1, y1] = at(theta, r0)
      const [x2, y2] = at(theta, R)
      ctx.strokeStyle = colors.grid
      ctx.setLineDash(Math.round(theta - low) % (step * 2) ? [2, 4] : [])
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      if (full && theta === high) continue
      const [lx, ly] = at(theta, R + 20)
      ctx.fillText(String(Math.round(theta)), lx, ly)
    }
    ctx.setLineDash([])
    if (!full) { ctx.strokeStyle = colors.axis; ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke() }
    // Radial axis: left vertical scale for half circles, ring labels for full circles.
    ctx.font = '11px sans-serif'; ctx.fillStyle = colors.tick
    const radialLabel = dotsMode ? `Frames per bin${stack.perDot > 1 ? ` (1 dot = ${stack.perDot} frames)` : ''}` : (d.radial?.label || 'Value')
    if (!full) {
      const ax = cx - R - 40
      ctx.strokeStyle = colors.axis; ctx.beginPath(); ctx.moveTo(ax, cy); ctx.lineTo(ax, cy - R); ctx.stroke()
      ctx.textAlign = 'right'
      for (const value of ringValues) {
        const yy = cy - radius(value)
        ctx.beginPath(); ctx.moveTo(ax - 4, yy); ctx.lineTo(ax, yy); ctx.stroke()
        ctx.fillText(formatTick(value, rMax - rMin), ax - 7, yy)
      }
      ctx.textAlign = 'left'; ctx.fillStyle = colors.label; ctx.font = '12px sans-serif'
      ctx.fillText(radialLabel, 8, cy - R - 22, W - 16)
    } else {
      ctx.textAlign = 'left'
      for (const value of ringValues.slice(1)) ctx.fillText(formatTick(value, rMax - rMin), cx + 4, cy - radius(value) - 7)
      ctx.fillStyle = colors.label; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(radialLabel, cx, cy + R + 50)
    }
    ctx.fillStyle = colors.label; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(`${d.xLabel} · dashed rays: mean of each series`, cx, full ? cy + R + 68 : cy + 30)
    ctx.textBaseline = 'alphabetic'
    // Data points.
    series.forEach((item, s) => {
      const color = colorOf(item, s)
      ctx.fillStyle = color; ctx.strokeStyle = colors.axis; ctx.lineWidth = 0.8
      ctx.globalAlpha = 0.72
      if (dotsMode) {
        const binAngle = stack.width
        const offset = (s - (series.length - 1) / 2) * binAngle / Math.max(1, series.length) * 0.8
        const dotRadius = Math.max(1.4, stack.dotStep * 0.42)
        stack.dots[s].forEach((count, b) => {
          const theta = low + (b + 0.5) * binAngle + offset
          for (let k = 0; k < count; k++) {
            const [x, y] = at(theta, r0 + (k + 0.5) * stack.dotStep)
            ctx.beginPath(); ctx.arc(x, y, dotRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
          }
        })
      } else {
        item.values.forEach((theta, k) => {
          const value = item.radial[k]
          if (!Number.isFinite(theta) || !Number.isFinite(value)) return
          const [x, y] = at(theta, radius(value))
          ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        })
      }
      ctx.globalAlpha = 1
      if (Number.isFinite(item.mean)) drawRay(ctx, at, cx, cy, item.mean, R, color, '', colors)
    })
    for (const ref of d.references || []) drawRay(ctx, at, cx, cy, ref.value, R + 34, colors.label, ref.short || ref.label, colors, true)
  }

  function drawRay (ctx, at, cx, cy, theta, length, color, label, colors, marker = false) {
    const [x, y] = at(theta, length)
    ctx.save()
    ctx.strokeStyle = color; ctx.lineWidth = marker ? 1.5 : 2; ctx.setLineDash(marker ? [2, 3] : [6, 4])
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke()
    ctx.setLineDash([])
    if (!label) { ctx.restore(); return }
    if (marker) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill() }
    ctx.fillStyle = color; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = x >= cx ? 'left' : 'right'; ctx.textBaseline = 'middle'
    ctx.fillText(label, x + (x >= cx ? 8 : -8), y)
    ctx.restore()
  }

  function renderLinearDots (ctx, colors, W, H, top, d, series, colorOf) {
    const values = series.flatMap(item => item.values.filter(Number.isFinite))
    let [low, high] = d.range || [Math.min(...values), Math.max(...values)]
    if (!(high > low)) { low -= 0.5; high += 0.5 }
    const pad = { left: 76, right: 25, bottom: 52 }
    const pw = W - pad.left - pad.right
    const ph = Math.max(40, H - top - pad.bottom)
    const bins = d.bins || 60
    const slot = pw / bins
    const dotStep = Math.max(3, Math.min(12, slot / Math.max(1, series.length) * 0.95))
    const maxDots = Math.max(3, Math.floor(ph / dotStep))
    const stack = stackBins(series, low, high, bins, maxDots)
    // Axis top: the tallest column plus some headroom, rounded to a multiple of 5 dots.
    const axisDots = Math.min(maxDots, Math.max(5, Math.ceil(Math.max(...stack.dots.flat()) * 1.15 / 5) * 5))
    const dotStepY = ph / axisDots
    const x = v => pad.left + (v - low) / (high - low) * pw
    const base = top + ph
    // Axes and ticks.
    ctx.strokeStyle = colors.axis; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(pad.left, top); ctx.lineTo(pad.left, base); ctx.lineTo(W - pad.right, base); ctx.stroke()
    ctx.font = '11px sans-serif'; ctx.fillStyle = colors.tick
    for (let k = 0; k <= 8; k++) {
      const v = low + k / 8 * (high - low)
      ctx.textAlign = 'center'; ctx.fillText(formatTick(v, high - low), x(v), base + 18)
    }
    for (let k = 0; k <= 5; k++) {
      const dots = Math.round(k / 5 * axisDots)
      const yy = base - dots * dotStepY
      ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(W - pad.right, yy); ctx.stroke()
      ctx.textAlign = 'right'; ctx.fillText(String(dots * stack.perDot), pad.left - 8, yy + 4)
    }
    ctx.fillStyle = colors.label; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(d.xLabel, pad.left + pw / 2, H - 8)
    ctx.save(); ctx.translate(16, top + ph / 2); ctx.rotate(-Math.PI / 2)
    ctx.fillText(`Frames per bin${stack.perDot > 1 ? ` (1 dot = ${stack.perDot})` : ''}`, 0, 0); ctx.restore()
    series.forEach((item, s) => {
      const color = colorOf(item, s)
      ctx.fillStyle = color; ctx.strokeStyle = colors.axis; ctx.lineWidth = 0.6; ctx.globalAlpha = 0.75
      const offset = (s - (series.length - 1) / 2) * dotStep
      stack.dots[s].forEach((count, b) => {
        const cxDot = pad.left + (b + 0.5) * slot + offset
        for (let k = 0; k < count; k++) {
          ctx.beginPath(); ctx.arc(cxDot, base - (k + 0.5) * dotStepY, Math.min(dotStep, dotStepY) * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
        }
      })
      ctx.globalAlpha = 1
      if (Number.isFinite(item.mean)) {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([5, 4])
        ctx.beginPath(); ctx.moveTo(x(item.mean), base); ctx.lineTo(x(item.mean), top); ctx.stroke(); ctx.setLineDash([])
      }
    })
    for (const ref of d.references || []) {
      ctx.strokeStyle = colors.label; ctx.lineWidth = 1.5; ctx.setLineDash([2, 3])
      ctx.beginPath(); ctx.moveTo(x(ref.value), base); ctx.lineTo(x(ref.value), top); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = colors.label; ctx.textAlign = 'left'; ctx.font = 'bold 12px sans-serif'
      ctx.fillText(ref.short || ref.label, x(ref.value) + 5, top + 12)
    }
  }

  class LineChart extends Chart {
    static wrap90 (value) { return wrap90(value) }

    // Numeric value of every x label; "1,234.5" (en-US grouping from the renderer's fmt) is 1234.5.
    axisValues () {
      return (this.data?.labels || []).map(label => Number(String(label).replace(/,/g, '')))
    }

    // Index of the label equal to `label`, or of the closest numeric label not after it.
    labelIndex (label) {
      const labels = this.data?.labels
      if (!labels?.length) return -1
      const exact = labels.indexOf(String(label))
      if (exact >= 0) return exact
      const target = Number(String(label).replace(/,/g, ''))
      if (!Number.isFinite(target)) return -1
      const values = this.axisValues()
      let best = -1
      for (let i = 0; i < values.length; i++) {
        const value = values[i]
        if (!Number.isFinite(value)) return -1
        if (value <= target) best = i
        else break
      }
      return best
    }

    // [from, to] indices of the zoom window, or null for the whole data.
    viewRange () {
      const n = this.data?.labels?.length || 0
      if (!this.view || n < 2) return null
      const from = Math.max(0, Math.min(n - 2, this.view[0]))
      const to = Math.max(from + 1, Math.min(n - 1, this.view[1]))
      return from === 0 && to === n - 1 ? null : [from, to]
    }

    setView (from, to) {
      this.view = from === null || from === undefined ? null : [Math.round(Math.min(from, to)), Math.round(Math.max(from, to))]
      if (this.data) this._render()
      this.onZoom?.(this.viewRange())
    }

    // Zoom to x labels between two numeric values (e.g. lags up to 500 fs).
    zoomToValues (low, high) {
      const values = this.axisValues()
      const from = values.findIndex(v => v >= low)
      let to = -1
      values.forEach((v, i) => { if (v <= high) to = i })
      if (from < 0 || to <= from) return false
      this.setView(from, to)
      return true
    }

    // Drag horizontally over the plot to zoom; double-click to show everything again.
    enableZoom () {
      if (this._zoomBound) return
      this._zoomBound = true
      const canvas = this.canvas
      const localX = event => {
        const rect = canvas.getBoundingClientRect()
        return (event.clientX - rect.left) * ((canvas.clientWidth || rect.width) / (rect.width || 1))
      }
      const indexAt = x => {
        const axis = this._axis
        const t = (x - axis.left) / axis.width
        return axis.offset + Math.max(0, Math.min(axis.labels.length - 1, Math.round(t * axis.slots)))
      }
      canvas.addEventListener('mousedown', event => {
        if (event.button !== 0 || !this.data || this.data.type || !this._axis || this._axis.bars) return
        const x = localX(event)
        if (x < this._axis.left || x > this._axis.left + this._axis.width) return
        this._drag = { x0: x, x1: x }
      })
      canvas.addEventListener('mousemove', event => {
        if (!this._drag) return
        this._drag.x1 = localX(event)
        this._render()
      })
      const finish = () => {
        const drag = this._drag
        this._drag = null
        if (!drag) return
        if (Math.abs(drag.x1 - drag.x0) > 4) {
          this._suppressClick = true
          this.setView(indexAt(drag.x0), indexAt(drag.x1))
        } else this._render()
      }
      canvas.addEventListener('mouseup', finish)
      canvas.addEventListener('mouseleave', finish)
      // A drag must not also count as a click (e.g. "jump to frame").
      canvas.addEventListener('click', event => {
        if (this._suppressClick) { this._suppressClick = false; event.stopImmediatePropagation() }
      }, true)
      canvas.addEventListener('dblclick', () => { if (this.view) this.setView(null) })
    }

    setCursor (label) {
      if (this.cursor === label) return
      this.cursor = label
      if (this.data && !this.data.type) this._render()
    }

    // Label under a clientX position (for "click a plot to jump to that frame").
    labelAt (clientX) {
      const axis = this._axis
      if (!axis || axis.bars || !this.data || this.data.type) return null
      const rect = this.canvas.getBoundingClientRect()
      const px = (clientX - rect.left) * ((this.canvas.clientWidth || rect.width) / (rect.width || 1))
      const t = (px - axis.left) / axis.width
      if (t < -0.02 || t > 1.02) return null
      const index = Math.max(0, Math.min(axis.labels.length - 1, Math.round(t * axis.slots)))
      return axis.labels[index]
    }

    // Index into data.labels under a clientX position, bars included (e.g. click a histogram bin);
    // `bar` is which of the side-by-side bar series of that bin was hit (null between them).
    slotAt (clientX) {
      const axis = this._axis
      if (!axis || !this.data || this.data.type) return null
      const rect = this.canvas.getBoundingClientRect()
      const px = (clientX - rect.left) * ((this.canvas.clientWidth || rect.width) / (rect.width || 1))
      const t = (px - axis.left) / axis.width
      if (t < 0 || t > 1) return null
      const position = t * axis.slots
      const slot = Math.max(0, Math.min(axis.labels.length - 1, axis.bars ? Math.floor(position) : Math.round(position)))
      let bar = null
      if (axis.bars) {
        const within = (position - slot - 0.05) / 0.9
        if (within >= 0 && within < 1) bar = Math.floor(within * axis.barSeries)
      }
      return { index: axis.offset + slot, bar }
    }

    indexAt (clientX) {
      return this.slotAt(clientX)?.index ?? null
    }

    // Reserve enough space even for numerous atom groups; export is independent of tab visibility.
    exportSize () {
      if (this.data.type === 'polar') return this.data.range[1] - this.data.range[0] > 180 ? [1200, 1150] : [1200, 780]
      if (this.data.type === 'dots') return [1200, 760]
      return [1200, Math.max(720, 400 + this.data.datasets.length * 17)]
    }

    toCSV () {
      if (this.data.type === 'polar' || this.data.type === 'dots') {
        const d = this.data
        const header = ['frame', ...d.series.flatMap((item, i) => d.radial?.values ? [item.label, `${d.radial.label} · ${item.label}`] : [item.label])]
        const rows = [header]
        d.frames.forEach((frame, k) => rows.push([frame, ...d.series.flatMap((item, i) => d.radial?.values ? [item.values[k], d.radial.values[i][k]] : [item.values[k]])]))
        const notes = [d.title, d.source, ...(d.notes || [])].filter(Boolean).map(text => `# ${text}`)
        return notes.concat(rows.map(row => row.map(csvCell).join(','))).join('\n') + '\n'
      }
      const { labels, datasets, xLabel } = this.data
      const rows = [[xLabel || 'x', ...datasets.map(series => series.label)]]
      labels.forEach((label, i) => rows.push([label, ...datasets.map(series => series.data[i])]))
      const notes = [this.data.title, this.data.source, ...(this.data.notes || [])].filter(Boolean).map(text => `# ${text}`)
      return notes.concat(rows.map(row => row.map(csvCell).join(','))).join('\n') + '\n'
    }

    _render (target = this.canvas, width, height, scale = 1) {
      if (!this.data) return
      if (this.data.type === 'polar' || this.data.type === 'dots') return renderDistribution(this, target, width, height, scale)
      const { ctx, W, H, colors } = this._prepare(target, width, height, scale)
      const { title, xLabel, source } = this.data
      // Zoom window: indices [from, to] of the full data (drag on the plot, double-click to reset).
      const zoomable = !this.data.datasets.some(series => series.bars)
      const view = zoomable ? this.viewRange() : null
      const offset = view ? view[0] : 0
      const cut = values => (view ? values.slice(view[0], view[1] + 1) : values)
      const labels = cut(this.data.labels)
      const range = ANGLE_RANGES[this.data.angleRange] || (this.data.circular ? ANGLE_RANGES[360] : null)
      const angular = Boolean(range)
      const period = range?.period
      const visible = this.data.datasets.map(series => ({ ...series, data: cut(series.data) }))
      const datasets = range?.wrap ? visible.map(series => ({ ...series, data: series.data.map(value => Number.isFinite(value) ? range.wrap(value) : value) })) : visible
      const yLabel = range?.label || this.data.yLabel
      if (!datasets.length || !labels.length) return
      const colorOf = (series, i) => series.color || colors.series[(series.colorIndex ?? i) % colors.series.length]

      // Wrap every legend entry rather than clipping labels off the image.
      ctx.font = '11px sans-serif'
      const legend = []
      let lx = 70, ly = source ? 65 : 47
      for (const [i, series] of datasets.entries()) {
        const size = Math.min(W - 90, ctx.measureText(series.label).width + 40)
        if (lx + size > W - 20 && lx > 70) { lx = 70; ly += 17 }
        legend.push({ x: lx, y: ly, series, i, width: size })
        lx += size
      }
      const notes = this.data.notes || []
      const pad = { top: ly + 25 + notes.length * 15, right: 25, bottom: 52, left: 76 }
      const pw = W - pad.left - pad.right
      const ph = Math.max(25, H - pad.top - pad.bottom)
      let min = Infinity, max = -Infinity
      for (const series of datasets) for (const value of series.data) {
        if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value) }
      }
      if (!Number.isFinite(min)) return
      if (angular) { min = range.min; max = range.max }
      else {
        if (Number.isFinite(this.data.yMin)) min = Math.min(min, this.data.yMin)
        if (Number.isFinite(this.data.yMax)) max = Math.max(max, this.data.yMax)
        const margin = (max - min) * .06 || Math.max(Math.abs(min) * .06, .01)
        const floor = Number.isFinite(this.data.yMin) && min >= this.data.yMin ? this.data.yMin : null
        min -= margin; max += margin
        // Densities and counts start exactly at their floor instead of a padded negative value.
        if (floor !== null) min = Math.max(min, floor)
      }
      const bars = datasets.some(series => series.bars)
      const slots = bars ? labels.length : Math.max(labels.length - 1, 1)
      const x = i => pad.left + (bars ? (i + .5) / slots : i / slots) * pw
      const y = value => pad.top + ph - (value - min) / (max - min) * ph
      ctx.lineWidth = 1
      ctx.font = '11px sans-serif'
      const ticks = angular
        ? Array.from({ length: Math.round((max - min) / range.step) + 1 }, (_, i) => min + i * range.step)
        : Array.from({ length: 6 }, (_, i) => min + i / 5 * (max - min))
      for (const value of ticks) {
        const yy = y(value)
        ctx.strokeStyle = colors.grid; ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(W - pad.right, yy); ctx.stroke()
        ctx.fillStyle = colors.tick; ctx.textAlign = 'right'
        ctx.fillText(angular ? value.toFixed(0) : formatTick(value, max - min), pad.left - 8, yy + 4)
      }
      if (min < 0 && max > 0 && !angular) {
        ctx.strokeStyle = colors.axis; ctx.setLineDash([3, 3])
        ctx.beginPath(); ctx.moveTo(pad.left, y(0)); ctx.lineTo(W - pad.right, y(0)); ctx.stroke(); ctx.setLineDash([])
      }
      const count = Math.min(8, labels.length - 1)
      ctx.fillStyle = colors.tick
      for (let i = 0; i <= count; i++) {
        const index = count ? Math.round(i * (labels.length - 1) / count) : 0
        ctx.textAlign = 'center'; ctx.fillText(labels[index], x(index), pad.top + ph + 18)
      }
      ctx.strokeStyle = colors.axis; ctx.beginPath(); ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + ph); ctx.lineTo(W - pad.right, pad.top + ph); ctx.stroke()
      ctx.fillStyle = colors.label; ctx.textAlign = 'center'; ctx.font = '12px sans-serif'
      ctx.fillText(xLabel, pad.left + pw / 2, H - 8)
      ctx.save(); ctx.translate(16, pad.top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore()
      header(ctx, colors, W, title, source)
      ctx.font = '11px sans-serif'; ctx.fillStyle = colors.label; ctx.textAlign = 'left'
      notes.forEach((note, i) => ctx.fillText(note, 70, ly + 22 + i * 15, W - 90))
      const barSeries = datasets.filter(series => series.bars).length
      let barIndex = 0
      datasets.forEach((series, di) => {
        const color = colorOf(series, di)
        ctx.strokeStyle = color; ctx.fillStyle = color
        if (series.bars) {
          const slot = pw / slots, width = Math.max(1, slot * .9 / barSeries), base = y(Math.max(min, Math.min(max, 0)))
          ctx.globalAlpha = .75
          series.data.forEach((value, i) => {
            if (!Number.isFinite(value)) return
            const left = x(i) - slot * .45 + barIndex * width
            ctx.fillRect(left, Math.min(base, y(value)), width, Math.abs(base - y(value)))
          })
          ctx.globalAlpha = 1
          barIndex++
          return
        }
        // Marked points only (e.g. the configurations selected on a PCA projection).
        if (series.points) {
          ctx.lineWidth = 1; ctx.strokeStyle = colors.label
          series.data.forEach((value, i) => {
            if (!Number.isFinite(value)) return
            ctx.beginPath(); ctx.arc(x(i), y(value), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
          })
          return
        }
        ctx.lineWidth = series.dash ? 1.6 : 1.8
        ctx.setLineDash(series.dash ? [7, 5] : [])
        ctx.beginPath()
        let previous = null
        series.data.forEach((value, i) => {
          if (!Number.isFinite(value)) { previous = null; return }
          if (previous === null) ctx.moveTo(x(i), y(value))
          else if (period && Math.abs(value - previous) > period / 2) {
            // Periodic wrap: continue the trace to one edge and re-enter from the opposite edge.
            const upward = value < previous
            const unwrapped = value + (upward ? period : -period)
            const edge = upward ? max : min
            const xb = x(i - 1) + (edge - previous) / (unwrapped - previous) * (x(i) - x(i - 1))
            ctx.lineTo(xb, y(edge))
            ctx.moveTo(xb, y(upward ? min : max))
            ctx.lineTo(x(i), y(value))
          } else ctx.lineTo(x(i), y(value))
          previous = value
        })
        ctx.stroke()
        ctx.setLineDash([])
        if (!series.dash) series.data.forEach((value, i) => {
          if (!Number.isFinite(value)) return
          const isolated = !Number.isFinite(series.data[i - 1]) && !Number.isFinite(series.data[i + 1])
          if (labels.length > 60 && !isolated) return
          ctx.beginPath(); ctx.arc(x(i), y(value), 2.5, 0, Math.PI * 2); ctx.fill()
        })
      })
      // Vertical markers at x values (e.g. the decorrelation time t* on an ACF), exported too.
      for (const marker of this.data.markers || []) {
        const values = this.axisValues()
        if (!values.length || !values.every(Number.isFinite)) break
        if (marker.value < values[0] || marker.value > values[values.length - 1]) continue
        let k = 0
        while (k < values.length - 2 && values[k + 1] < marker.value) k++
        const span = values[k + 1] - values[k]
        const xm = span > 0 ? x(k) + (marker.value - values[k]) / span * (x(k + 1) - x(k)) : x(k)
        ctx.save()
        ctx.strokeStyle = marker.color || colors.series[3 % colors.series.length]; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4])
        ctx.beginPath(); ctx.moveTo(xm, pad.top); ctx.lineTo(xm, pad.top + ph); ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 11px sans-serif'
        ctx.textAlign = xm > pad.left + pw * 0.7 ? 'right' : 'left'
        ctx.fillText(marker.label, xm + (ctx.textAlign === 'right' ? -5 : 5), pad.top + 26)
        ctx.restore()
      }
      // Frame cursor (trajectory player); only on the live canvas, never in exports.
      const onScreen = target === this.canvas
      if (onScreen) this._axis = { left: pad.left, width: pw, slots, bars, labels, top: pad.top, height: ph, offset, barSeries }
      if (onScreen && this._drag && Math.abs(this._drag.x1 - this._drag.x0) > 4) {
        ctx.save()
        ctx.fillStyle = colors.series[0]; ctx.globalAlpha = .12
        const left = Math.max(pad.left, Math.min(this._drag.x0, this._drag.x1))
        const right = Math.min(pad.left + pw, Math.max(this._drag.x0, this._drag.x1))
        ctx.fillRect(left, pad.top, right - left, ph)
        ctx.restore()
      }
      if (view && onScreen) {
        ctx.save(); ctx.fillStyle = colors.tick; ctx.font = '10px sans-serif'; ctx.textAlign = 'right'
        ctx.fillText('zoomed · double-click to reset', W - pad.right, pad.top - 4)
        ctx.restore()
      }
      if (onScreen && this.cursor !== null && this.cursor !== undefined && !bars) {
        const index = this.labelIndex(this.cursor) - offset
        if (index >= 0 && index < labels.length) {
          const xc = x(index)
          ctx.save()
          ctx.strokeStyle = colors.label; ctx.globalAlpha = .8; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3])
          ctx.beginPath(); ctx.moveTo(xc, pad.top); ctx.lineTo(xc, pad.top + ph); ctx.stroke()
          ctx.setLineDash([]); ctx.globalAlpha = 1
          datasets.forEach((series, di) => {
            const value = series.data[index]
            if (series.dash || !Number.isFinite(value)) return
            ctx.fillStyle = colorOf(series, di)
            ctx.beginPath(); ctx.arc(xc, y(value), 4.5, 0, Math.PI * 2); ctx.fill()
            ctx.strokeStyle = colors.bg; ctx.lineWidth = 1.5; ctx.stroke()
          })
          ctx.fillStyle = colors.label; ctx.font = '11px sans-serif'
          ctx.textAlign = xc > pad.left + pw - 60 ? 'right' : 'left'
          ctx.fillText(`frame ${labels[index]}`, xc + (ctx.textAlign === 'right' ? -5 : 5), pad.top + 12)
          ctx.restore()
        }
      }
      for (const item of legend) {
        ctx.strokeStyle = ctx.fillStyle = colorOf(item.series, item.i)
        if (item.series.dash) {
          ctx.setLineDash([5, 3]); ctx.lineWidth = 2
          ctx.beginPath(); ctx.moveTo(item.x, item.y - 4); ctx.lineTo(item.x + 18, item.y - 4); ctx.stroke(); ctx.setLineDash([])
        } else if (item.series.points) {
          ctx.beginPath(); ctx.arc(item.x + 9, item.y - 4, 3.2, 0, Math.PI * 2); ctx.fill()
        } else ctx.fillRect(item.x, item.y - 5, 18, 3)
        ctx.fillStyle = colors.label; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'
        ctx.fillText(item.series.label, item.x + 23, item.y, item.width - 25)
      }
    }
  }

  // Perceptually ordered colour maps (samples of the matplotlib maps); 'theme' follows the day/night palette.
  const COLORMAPS = {
    plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
    viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
    inferno: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'],
    magma: ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#feca8d', '#fcfdbf'],
    coolwarm: ['#3b4cc0', '#6788ee', '#9abbff', '#c9d7f0', '#edd1c2', '#f7a889', '#e26952', '#b40426']
  }

  function heatColor (stops, t) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (stops.length - 1)
    const k = Math.min(stops.length - 2, Math.floor(x))
    const f = x - k
    const ca = rgb(stops[k]), cb = rgb(stops[k + 1])
    return ca.map((value, i) => Math.round(value + (cb[i] - value) * f))
  }

  // Square matrix plot, e.g. pairwise RMSD between frames.
  class HeatmapChart extends Chart {
    exportSize () { return [1200, 1080] }

    toCSV () {
      const { labels, matrix } = this.data
      const rows = [['frame', ...labels]]
      matrix.forEach((row, i) => rows.push([labels[i], ...row]))
      const notes = [this.data.title, this.data.source, ...(this.data.notes || [])].filter(Boolean).map(text => `# ${text}`)
      return notes.concat(rows.map(row => row.map(csvCell).join(','))).join('\n') + '\n'
    }

    _render (target = this.canvas, width, height, scale = 1) {
      if (!this.data) return
      const { ctx, W, H, colors } = this._prepare(target, width, height, scale)
      const { labels, matrix, title, source, xLabel, yLabel, colorLabel } = this.data
      const stops = COLORMAPS[this.data.colormap] || colors.heat
      // origin 'top' puts the first frame in the upper-left corner (matplotlib imshow).
      const topOrigin = this.data.origin === 'top'
      const n = matrix.length
      if (!n) return
      let min = Infinity, max = -Infinity
      for (const row of matrix) for (const value of row) if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value) }
      if (!Number.isFinite(min)) return
      if (max === min) max = min + 1
      const notes = this.data.notes || []
      const top = (source ? 58 : 42) + notes.length * 15
      const size = Math.max(40, Math.min(W - 190, H - top - 60))
      const left = 76 + Math.max(0, (W - 190 - size) / 2)
      // Nearest-neighbour cells written straight into device pixels (sharp at any export scale).
      const colorsByCell = new Uint8ClampedArray(n * n * 3)
      matrix.forEach((row, i) => row.forEach((value, j) => {
        colorsByCell.set(Number.isFinite(value) ? heatColor(stops, (value - min) / (max - min)) : [128, 128, 128], (i * n + j) * 3)
      }))
      const pixels = Math.max(1, Math.round(size * scale))
      const bitmap = ctx.createImageData(pixels, pixels)
      const columns = Array.from({ length: pixels }, (_, x) => Math.min(n - 1, Math.floor(x * n / pixels)))
      for (let y = 0; y < pixels; y++) {
        const row = Math.min(n - 1, Math.floor(y * n / pixels))
        const i = topOrigin ? row : n - 1 - row
        for (let x = 0; x < pixels; x++) {
          const source = (i * n + columns[x]) * 3, target = (y * pixels + x) * 4
          bitmap.data[target] = colorsByCell[source]
          bitmap.data[target + 1] = colorsByCell[source + 1]
          bitmap.data[target + 2] = colorsByCell[source + 2]
          bitmap.data[target + 3] = 255
        }
      }
      ctx.putImageData(bitmap, Math.round(left * scale), Math.round(top * scale))
      ctx.strokeStyle = colors.axis; ctx.strokeRect(left, top, size, size)
      ctx.font = '11px sans-serif'; ctx.fillStyle = colors.tick
      const ticks = Math.min(6, n - 1)
      for (let k = 0; k <= ticks; k++) {
        const index = ticks ? Math.round(k * (n - 1) / ticks) : 0
        const offset = (index + .5) / n * size
        ctx.textAlign = 'center'; ctx.fillText(labels[index], left + offset, top + size + 16)
        ctx.textAlign = 'right'; ctx.fillText(labels[index], left - 6, (topOrigin ? top + offset : top + size - offset) + 4)
      }
      const barX = left + size + 24, barW = 16
      for (let p = 0; p < size; p++) {
        const [r, g, b] = heatColor(stops, 1 - p / size)
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(barX, top + p, barW, 1.5)
      }
      ctx.strokeStyle = colors.axis; ctx.strokeRect(barX, top, barW, size)
      ctx.fillStyle = colors.tick; ctx.textAlign = 'left'
      for (let k = 0; k <= 4; k++) {
        const value = max - k / 4 * (max - min)
        ctx.fillText(formatTick(value, max - min), barX + barW + 5, top + k / 4 * size + 4)
      }
      ctx.fillStyle = colors.label; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(xLabel || 'Frame', left + size / 2, top + size + 38)
      ctx.save(); ctx.translate(16, top + size / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel || 'Frame', 0, 0); ctx.restore()
      ctx.save(); ctx.translate(Math.min(W - 10, barX + barW + 62), top + size / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(colorLabel || '', 0, 0); ctx.restore()
      header(ctx, colors, W, title, source)
      ctx.font = '11px sans-serif'; ctx.fillStyle = colors.label; ctx.textAlign = 'center'
      notes.forEach((note, i) => ctx.fillText(note, W / 2, top - 8 - (notes.length - 1 - i) * 15, W - 30))
    }
  }

  LineChart.Heatmap = HeatmapChart
  LineChart.COLORMAPS = COLORMAPS
  // [r, g, b] of value t in [0, 1] on a named colour map (theme palette when unknown).
  LineChart.colormap = (name, t) => heatColor(COLORMAPS[name] || palette().heat, t)
  LineChart.palette = palette
  if (typeof module === 'object' && module.exports) module.exports = LineChart
  else { root.MonetLineChart = LineChart; root.MonetHeatmapChart = HeatmapChart }
})(globalThis)

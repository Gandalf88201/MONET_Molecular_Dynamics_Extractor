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

  function formatTick (value, span) {
    if (value === 0) return '0'
    const magnitude = Math.abs(value)
    if (magnitude >= 1e5 || magnitude < 1e-3) return value.toExponential(2)
    const digits = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : 3
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

    setData (data) {
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

  class LineChart extends Chart {
    static wrap90 (value) { return wrap90(value) }

    // Reserve enough space even for numerous atom groups; export is independent of tab visibility.
    exportSize () { return [1200, Math.max(720, 400 + this.data.datasets.length * 17)] }

    toCSV () {
      const { labels, datasets, xLabel } = this.data
      const rows = [[xLabel || 'x', ...datasets.map(series => series.label)]]
      labels.forEach((label, i) => rows.push([label, ...datasets.map(series => series.data[i])]))
      const notes = [this.data.title, this.data.source, ...(this.data.notes || [])].filter(Boolean).map(text => `# ${text}`)
      return notes.concat(rows.map(row => row.map(csvCell).join(','))).join('\n') + '\n'
    }

    _render (target = this.canvas, width, height, scale = 1) {
      if (!this.data) return
      const { ctx, W, H, colors } = this._prepare(target, width, height, scale)
      const { labels, title, xLabel, source } = this.data
      const signed = this.data.angleRange === 'signed90'
      const angular = Boolean(this.data.angleRange || this.data.circular)
      const period = signed ? 180 : 360
      const datasets = signed ? this.data.datasets.map(series => ({ ...series, data: series.data.map(value => Number.isFinite(value) ? wrap90(value) : value) })) : this.data.datasets
      const yLabel = signed ? 'Wrapped angle (°, period 180°)' : this.data.yLabel
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
      if (angular) { min = signed ? -90 : 0; max = signed ? 90 : this.data.angleRange === 'natural' ? 180 : 360 }
      else {
        if (Number.isFinite(this.data.yMin)) min = Math.min(min, this.data.yMin)
        if (Number.isFinite(this.data.yMax)) max = Math.max(max, this.data.yMax)
        const margin = (max - min) * .06 || Math.max(Math.abs(min) * .06, .01)
        min -= margin; max += margin
      }
      const bars = datasets.some(series => series.bars)
      const slots = bars ? labels.length : Math.max(labels.length - 1, 1)
      const x = i => pad.left + (bars ? (i + .5) / slots : i / slots) * pw
      const y = value => pad.top + ph - (value - min) / (max - min) * ph
      ctx.lineWidth = 1
      ctx.font = '11px sans-serif'
      for (let i = 0; i <= 5; i++) {
        const value = min + i / 5 * (max - min), yy = y(value)
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
        ctx.lineWidth = series.dash ? 1.6 : 1.8
        ctx.setLineDash(series.dash ? [7, 5] : [])
        ctx.beginPath()
        let previous = null
        series.data.forEach((value, i) => {
          if (!Number.isFinite(value)) { previous = null; return }
          // Do not draw a spurious full-range line over a 0/360° torsion wrap.
          if (previous === null || (angular && this.data.angleRange !== 'natural' && Math.abs(value - previous) > period / 2)) ctx.moveTo(x(i), y(value))
          else ctx.lineTo(x(i), y(value))
          previous = value
        })
        ctx.stroke()
        ctx.setLineDash([])
        if (labels.length <= 60 && !series.dash) series.data.forEach((value, i) => {
          if (!Number.isFinite(value)) return
          ctx.beginPath(); ctx.arc(x(i), y(value), 2.5, 0, Math.PI * 2); ctx.fill()
        })
      })
      for (const item of legend) {
        ctx.strokeStyle = ctx.fillStyle = colorOf(item.series, item.i)
        if (item.series.dash) {
          ctx.setLineDash([5, 3]); ctx.lineWidth = 2
          ctx.beginPath(); ctx.moveTo(item.x, item.y - 4); ctx.lineTo(item.x + 18, item.y - 4); ctx.stroke(); ctx.setLineDash([])
        } else ctx.fillRect(item.x, item.y - 5, 18, 3)
        ctx.fillStyle = colors.label; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'
        ctx.fillText(item.series.label, item.x + 23, item.y, item.width - 25)
      }
    }
  }

  function heatColor (stops, t) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    const [a, b] = t < .5 ? [stops[0], stops[1]] : [stops[1], stops[2]]
    const f = t < .5 ? t * 2 : (t - .5) * 2
    const ca = rgb(a), cb = rgb(b)
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
      const bitmap = ctx.createImageData(n, n)
      matrix.forEach((row, i) => row.forEach((value, j) => {
        const [r, g, b] = Number.isFinite(value) ? heatColor(colors.heat, (value - min) / (max - min)) : [128, 128, 128]
        bitmap.data.set([r, g, b, 255], ((n - 1 - i) * n + j) * 4)
      }))
      const tile = document.createElement('canvas')
      tile.width = n; tile.height = n
      tile.getContext('2d').putImageData(bitmap, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(tile, left, top, size, size)
      ctx.strokeStyle = colors.axis; ctx.strokeRect(left, top, size, size)
      ctx.font = '11px sans-serif'; ctx.fillStyle = colors.tick
      const ticks = Math.min(6, n - 1)
      for (let k = 0; k <= ticks; k++) {
        const index = ticks ? Math.round(k * (n - 1) / ticks) : 0
        const offset = (index + .5) / n * size
        ctx.textAlign = 'center'; ctx.fillText(labels[index], left + offset, top + size + 16)
        ctx.textAlign = 'right'; ctx.fillText(labels[index], left - 6, top + size - offset + 4)
      }
      const barX = left + size + 24, barW = 16
      for (let p = 0; p < size; p++) {
        const [r, g, b] = heatColor(colors.heat, 1 - p / size)
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
  LineChart.palette = palette
  if (typeof module === 'object' && module.exports) module.exports = LineChart
  else { root.MonetLineChart = LineChart; root.MonetHeatmapChart = HeatmapChart }
})(globalThis)

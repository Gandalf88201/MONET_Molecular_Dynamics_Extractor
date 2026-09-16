'use strict'

;(function (root) {
  const COLORS = ['#4d9de0', '#e94560', '#00c87a', '#ffd700', '#c77dff', '#ff9f1c', '#2ec4b6', '#ff6b6b']
  function wrap90 (value) { return ((value + 90) % 180 + 180) % 180 - 90 }
  class LineChart {
    static wrap90 (value) { return wrap90(value) }

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

    _render (target = this.canvas, width, height, scale = 1) {
      if (!this.data) return
      const ctx = target.getContext('2d')
      const W = width || target.clientWidth || 600
      const H = height || target.clientHeight || 320
      target.width = Math.round(W * scale)
      target.height = Math.round(H * scale)
      ctx.scale(scale, scale)
      ctx.fillStyle = '#0d0d1a'
      ctx.fillRect(0, 0, W, H)
      const { labels, title, xLabel, source } = this.data
      const signed = this.data.angleRange === 'signed90'
      const angular = Boolean(this.data.angleRange || this.data.circular)
      const period = signed ? 180 : 360
      const datasets = signed ? this.data.datasets.map(series => ({ ...series, data: series.data.map(value => Number.isFinite(value) ? wrap90(value) : value) })) : this.data.datasets
      const yLabel = signed ? 'Wrapped angle (°, period 180°)' : this.data.yLabel
      if (!datasets.length || !labels.length) return

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
      const pad = { top: ly + 25, right: 25, bottom: 52, left: 70 }
      const pw = W - pad.left - pad.right
      const ph = Math.max(25, H - pad.top - pad.bottom)
      let min = Infinity, max = -Infinity
      for (const series of datasets) for (const value of series.data) {
        if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value) }
      }
      if (!Number.isFinite(min)) return
      if (angular) { min = signed ? -90 : 0; max = signed ? 90 : this.data.angleRange === 'natural' ? 180 : 360 }
      else {
        const margin = (max - min) * .06 || Math.max(Math.abs(min) * .06, .01)
        min -= margin; max += margin
      }
      const x = i => pad.left + i / Math.max(labels.length - 1, 1) * pw
      const y = value => pad.top + ph - (value - min) / (max - min) * ph
      ctx.lineWidth = 1
      ctx.font = '11px sans-serif'
      for (let i = 0; i <= 5; i++) {
        const value = min + i / 5 * (max - min), yy = y(value)
        ctx.strokeStyle = '#262640'; ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(W - pad.right, yy); ctx.stroke()
        ctx.fillStyle = '#a9acc3'; ctx.textAlign = 'right'
        ctx.fillText(value.toFixed(3), pad.left - 8, yy + 4)
      }
      const count = Math.min(8, labels.length - 1)
      for (let i = 0; i <= count; i++) {
        const index = count ? Math.round(i * (labels.length - 1) / count) : 0
        ctx.textAlign = 'center'; ctx.fillText(labels[index], x(index), pad.top + ph + 18)
      }
      ctx.strokeStyle = '#7a7a9e'; ctx.beginPath(); ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + ph); ctx.lineTo(W - pad.right, pad.top + ph); ctx.stroke()
      ctx.fillStyle = '#c0c0d8'; ctx.textAlign = 'center'; ctx.font = '12px sans-serif'
      ctx.fillText(xLabel, pad.left + pw / 2, H - 8)
      ctx.save(); ctx.translate(16, pad.top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore()
      ctx.fillStyle = '#dde0ef'; ctx.font = 'bold 15px sans-serif'
      ctx.fillText(title, W / 2, 23, W - 30)
      if (source) { ctx.font = '11px sans-serif'; ctx.fillText(source, W / 2, 41, W - 30) }
      datasets.forEach((series, di) => {
        const color = series.color || COLORS[di % COLORS.length]
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.8; ctx.beginPath()
        let previous = null
        series.data.forEach((value, i) => {
          if (!Number.isFinite(value)) { previous = null; return }
          // Do not draw a spurious full-range line over a 0/360° torsion wrap.
          if (previous === null || (angular && this.data.angleRange !== 'natural' && Math.abs(value - previous) > period / 2)) ctx.moveTo(x(i), y(value))
          else ctx.lineTo(x(i), y(value))
          previous = value
        })
        ctx.stroke()
        if (labels.length <= 60) series.data.forEach((value, i) => {
          if (!Number.isFinite(value)) return
          ctx.beginPath(); ctx.arc(x(i), y(value), 2.5, 0, Math.PI * 2); ctx.fill()
        })
      })
      for (const item of legend) {
        ctx.fillStyle = item.series.color || COLORS[item.i % COLORS.length]
        ctx.fillRect(item.x, item.y - 5, 18, 3)
        ctx.fillStyle = '#c0c0d8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left'
        ctx.fillText(item.series.label, item.x + 23, item.y, item.width - 25)
      }
    }

    async downloadPNG (filename) {
      if (!this.data) throw new Error('Compute an analysis before downloading its plot.')
      const output = document.createElement('canvas')
      // Reserve enough space even for numerous atom groups; export is independent of tab visibility.
      const height = Math.max(720, 400 + this.data.datasets.length * 17)
      this._render(output, 1200, height, 2)
      const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not create the PNG image.')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = filename
      document.body.appendChild(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    }
  }
  if (typeof module === 'object' && module.exports) module.exports = LineChart
  else root.MonetLineChart = LineChart
})(globalThis)

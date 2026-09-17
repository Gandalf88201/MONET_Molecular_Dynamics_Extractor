'use strict'
// Least-squares fits of histogram (probability density) data.
// Levenberg–Marquardt with a numerical Jacobian; parameter errors come from the covariance
// (JᵀJ)⁻¹·χ²/(n − p), as scipy.optimize.curve_fit does by default. They treat the bins as
// independent points and therefore ignore time correlation between MD frames.
;(function (root) {
  // Signed difference x − μ, wrapped into [−P/2, P/2) for periodic data.
  const delta = (x, mu, period) => period ? ((x - mu + period / 2) % period + period) % period - period / 2 : x - mu

  function solve (matrix, vector) {
    const n = vector.length
    const a = matrix.map((row, i) => [...row, vector[i]])
    for (let c = 0; c < n; c++) {
      let pivot = c
      for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r
      if (Math.abs(a[pivot][c]) < 1e-300) return null
      ;[a[c], a[pivot]] = [a[pivot], a[c]]
      for (let r = 0; r < n; r++) {
        if (r === c) continue
        const f = a[r][c] / a[c][c]
        for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k]
      }
    }
    return a.map((row, i) => row[n] / row[i])
  }

  function invert (matrix) {
    const n = matrix.length
    const columns = []
    for (let j = 0; j < n; j++) {
      const column = solve(matrix, matrix.map((_, i) => (i === j ? 1 : 0)))
      if (!column) return null
      columns.push(column)
    }
    return matrix.map((_, i) => columns.map(column => column[i]))
  }

  function levenbergMarquardt (model, x, y, start, { lower = [], upper = [], maxIterations = 400 } = {}) {
    const p = start.length
    const clamp = params => params.map((v, i) => Math.min(upper[i] ?? Infinity, Math.max(lower[i] ?? -Infinity, v)))
    const residuals = params => x.map((xi, i) => y[i] - model(xi, params))
    const cost = r => r.reduce((sum, v) => sum + v * v, 0)
    const jacobian = params => {
      const base = x.map(xi => model(xi, params))
      const columns = params.map((value, j) => {
        const h = 1e-6 * Math.max(Math.abs(value), 1e-3)
        const shifted = params.slice()
        shifted[j] = value + h
        return x.map((xi, i) => (model(xi, shifted) - base[i]) / h)
      })
      return x.map((_, i) => columns.map(column => column[i]))
    }
    let params = clamp(start)
    let r = residuals(params)
    let current = cost(r)
    let lambda = 1e-3
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const J = jacobian(params)
      const JTJ = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => J.reduce((sum, row) => sum + row[a] * row[b], 0)))
      const JTr = Array.from({ length: p }, (_, a) => J.reduce((sum, row, i) => sum + row[a] * r[i], 0))
      let improved = false
      for (let attempt = 0; attempt < 30; attempt++) {
        const damped = JTJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)))
        const step = solve(damped, JTr)
        if (step) {
          const trial = clamp(params.map((v, i) => v + step[i]))
          const trialResiduals = residuals(trial)
          const trialCost = cost(trialResiduals)
          if (Number.isFinite(trialCost) && trialCost < current) {
            const relative = (current - trialCost) / Math.max(current, 1e-300)
            params = trial; r = trialResiduals; current = trialCost
            lambda = Math.max(lambda / 10, 1e-12)
            improved = true
            if (relative < 1e-12) iteration = maxIterations
            break
          }
        }
        lambda *= 10
      }
      if (!improved) break
    }
    const J = jacobian(params)
    const JTJ = Array.from({ length: p }, (_, a) => Array.from({ length: p }, (_, b) => J.reduce((sum, row) => sum + row[a] * row[b], 0)))
    const dof = x.length - p
    const inverse = invert(JTJ)
    const scale = dof > 0 ? current / dof : NaN
    const errors = inverse ? inverse.map((row, i) => Math.sqrt(Math.max(row[i] * scale, 0))) : params.map(() => NaN)
    const mean = y.reduce((sum, v) => sum + v, 0) / y.length
    const total = y.reduce((sum, v) => sum + (v - mean) ** 2, 0)
    return { params, errors, ssr: current, rSquared: total > 0 ? 1 - current / total : NaN, dof }
  }

  // A1(κ) = I1(κ)/I0(κ) with exponentially scaled Abramowitz–Stegun approximations (9.8.1–9.8.4).
  function besselRatio (kappa) {
    const k = Math.abs(kappa)
    if (k < 3.75) {
      const t = (k / 3.75) ** 2
      const i0 = 1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813)))))
      const i1 = k * (0.5 + t * (0.87890594 + t * (0.51498869 + t * (0.15084934 + t * (0.02658733 + t * (0.00301532 + t * 0.00032411))))))
      return i1 / i0
    }
    const t = 3.75 / k
    const i0 = 0.39894228 + t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 + t * (0.00916281 + t * (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))))
    const i1 = 0.39894228 + t * (-0.03988024 + t * (-0.00362018 + t * (0.00163801 + t * (-0.01031555 + t * (0.02282967 + t * (-0.02895312 + t * (0.01787654 - t * 0.00420059)))))))
    return i1 / i0
  }

  const MODELS = {
    gaussian: {
      label: 'Gaussian',
      names: ['A', 'μ', 'σ'],
      evaluate: (x, [a, mu, sigma], period) => a * Math.exp(-(delta(x, mu, period) ** 2) / (2 * sigma * sigma))
    },
    lorentzian: {
      label: 'Lorentzian',
      names: ['A', 'μ', 'γ'],
      // γ is the half width at half maximum (FWHM = 2γ).
      evaluate: (x, [a, mu, gamma], period) => a / (1 + (delta(x, mu, period) / gamma) ** 2)
    },
    pseudovoigt: {
      label: 'Pseudo-Voigt',
      names: ['A', 'μ', 'FWHM', 'η'],
      // η·Lorentzian + (1 − η)·Gaussian with a common full width at half maximum.
      evaluate: (x, [a, mu, w, eta], period) => {
        const t = (delta(x, mu, period) / w) ** 2
        return a * (eta / (1 + 4 * t) + (1 - eta) * Math.exp(-4 * Math.LN2 * t))
      }
    },
    vonmises: {
      label: 'von Mises',
      names: ['A', 'μ', 'κ'],
      periodic: true,
      evaluate: (x, [a, mu, kappa], period) => a * Math.exp(kappa * (Math.cos(2 * Math.PI * delta(x, mu, period) / period) - 1))
    },
    gaussian2: {
      label: 'Two Gaussians',
      names: ['A₁', 'μ₁', 'σ₁', 'A₂', 'μ₂', 'σ₂'],
      evaluate: (x, [a1, m1, s1, a2, m2, s2], period) =>
        a1 * Math.exp(-(delta(x, m1, period) ** 2) / (2 * s1 * s1)) + a2 * Math.exp(-(delta(x, m2, period) ** 2) / (2 * s2 * s2))
    }
  }

  const wrap = (value, low, period) => period ? ((value - low) % period + period) % period + low : value

  // Moments of the selected histogram part, used as starting values.
  function moments (x, y, period) {
    const total = y.reduce((sum, v) => sum + v, 0)
    if (!(total > 0)) return null
    const peak = x[y.indexOf(Math.max(...y))]
    let mean = 0, variance = 0
    for (let i = 0; i < x.length; i++) mean += y[i] * delta(x[i], peak, period)
    mean = peak + mean / total
    for (let i = 0; i < x.length; i++) variance += y[i] * delta(x[i], mean, period) ** 2
    return { peak, mean, sigma: Math.sqrt(variance / total), amplitude: Math.max(...y) }
  }

  /**
   * Fit a histogram. x: bin centres, y: densities.
   * options: model, period (null for non-periodic data), low (range start for wrapping), range [from, to] limits the fitted bins.
   */
  function fitHistogram (x, y, { model = 'gaussian', period = null, low = 0, range = null, binWidth } = {}) {
    const spec = MODELS[model]
    if (!spec) throw new Error(`Unknown fit model: ${model}`)
    if (spec.periodic && !period) throw new Error('The von Mises model needs a periodic angle range.')
    let xs = x, ys = y
    if (range) {
      const [from, to] = range
      const keep = x.map(v => (period && from > to ? v >= from || v <= to : v >= from && v <= to))
      xs = x.filter((_, i) => keep[i]); ys = y.filter((_, i) => keep[i])
    }
    if (xs.length < spec.names.length + 1) throw new Error(`The fit needs at least ${spec.names.length + 1} bins in the selected range.`)
    const m = moments(xs, ys, period)
    if (!m) throw new Error('The selected range contains no counts.')
    const width = binWidth || (xs.length > 1 ? Math.abs(xs[1] - xs[0]) : 1)
    const sigma0 = Math.max(m.sigma, width)
    let start, lower, upper
    if (model === 'gaussian') {
      start = [m.amplitude, m.mean, sigma0]
      lower = [0, -Infinity, width / 10]
    } else if (model === 'lorentzian') {
      start = [m.amplitude, m.mean, 1.1774 * sigma0]
      lower = [0, -Infinity, width / 20]
    } else if (model === 'pseudovoigt') {
      start = [m.amplitude, m.mean, 2.3548 * sigma0, 0.5]
      lower = [0, -Infinity, width / 10, 0]
      upper = [Infinity, Infinity, Infinity, 1]
    } else if (model === 'vonmises') {
      const k = 2 * Math.PI / period
      start = [m.amplitude, m.mean, Math.min(1e4, 1 / (k * sigma0) ** 2)]
      lower = [0, -Infinity, 1e-6]
      upper = [Infinity, Infinity, 1e6]
    } else {
      // Two peaks: the tallest bin, and the tallest bin at least ~1.5 σ away from it.
      const order = ys.map((v, i) => i).sort((a, b) => ys[b] - ys[a])
      const first = order[0]
      const second = order.find(i => Math.abs(delta(xs[i], xs[first], period)) > Math.max(1.5 * sigma0 / 2, 3 * width)) ?? order[1]
      const s = Math.max(sigma0 / 2, width)
      start = [ys[first], xs[first], s, ys[second], xs[second], s]
      lower = [0, -Infinity, width / 10, 0, -Infinity, width / 10]
    }
    const evaluate = (xi, params) => spec.evaluate(xi, params, period)
    const result = levenbergMarquardt(evaluate, xs, ys, start, { lower, upper })
    const params = result.params.slice()
    // Report centres inside the plotted range and widths as positive numbers.
    spec.names.forEach((name, i) => {
      if (name.startsWith('μ')) params[i] = wrap(params[i], low, period)
      if (name.startsWith('σ') || name === 'γ' || name === 'FWHM') params[i] = Math.abs(params[i])
    })
    const out = {
      model, label: spec.label, names: spec.names, params, errors: result.errors,
      rSquared: result.rSquared, dof: result.dof, points: xs.length,
      curve: x.map(xi => evaluate(xi, result.params))
    }
    if (model === 'vonmises') {
      // Circular standard deviation of the fitted distribution, in the units of x.
      const k = 2 * Math.PI / period
      const ratio = besselRatio(params[2])
      out.sigma = ratio > 0 ? Math.sqrt(-2 * Math.log(ratio)) / k : Infinity
    }
    if (model === 'lorentzian') out.fwhm = 2 * params[2]
    if (model === 'gaussian') out.fwhm = 2 * Math.sqrt(2 * Math.LN2) * params[2]
    if (model === 'gaussian2') {
      // Weights of the two components (areas A·σ).
      const area1 = params[0] * params[2], area2 = params[3] * params[5]
      out.weights = [area1 / (area1 + area2), area2 / (area1 + area2)]
    }
    return out
  }

  const api = { fitHistogram, levenbergMarquardt, besselRatio, MODELS }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetFit = api
})(globalThis)

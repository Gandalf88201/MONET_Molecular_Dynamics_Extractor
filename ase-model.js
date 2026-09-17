'use strict'

// MONET atom IDs remain stable; only the private ASE indices are renumbered.
;(function (root) {
  function atomMap (atoms, selectedIds = null) {
    const selected = selectedIds === null ? null : new Set(selectedIds)
    return atoms.filter(atom => !selected || selected.has(atom.index)).map((atom, aseIndex) => ({
      ...atom, monetId: atom.index, aseIndex
    }))
  }

  function groupsFromIds (raw, width, atoms) {
    const values = raw.trim().split(/[\s,]+/).map(Number)
    if (!raw.trim() || values.length % width || values.some(id => !Number.isInteger(id) || id < 1)) {
      throw new Error(`Enter groups of ${width} MONET atom IDs from the list above.`)
    }
    const mapping = new Map(atoms.map(atom => [atom.monetId, atom.aseIndex]))
    const groups = []
    for (let i = 0; i < values.length; i += width) {
      const group = values.slice(i, i + width)
      if (new Set(group).size !== width) throw new Error('Each group must contain distinct atoms.')
      groups.push(group.map(id => {
        if (!mapping.has(id)) throw new Error(`MONET atom ${id} is not in the active ASE trajectory.`)
        return mapping.get(id)
      }))
    }
    return groups
  }

  function selectedIndices (raw, atoms, minimum = 1) {
    if (!raw.trim()) return undefined
    const groups = groupsFromIds(raw, 1, atoms)
    const ids = groups.map(group => group[0])
    if (new Set(ids).size !== ids.length) throw new Error('Select each atom only once.')
    if (ids.length < minimum) throw new Error(`Select at least ${minimum} atoms for this analysis.`)
    return ids
  }

  function cellParameters (system, values) {
    let [a, b, c, alpha, beta, gamma] = values.map(Number)
    if (system === 'cubic') { b = c = a; alpha = beta = gamma = 90 }
    else if (system === 'tetragonal') { b = a; alpha = beta = gamma = 90 }
    else if (system === 'orthorhombic') alpha = beta = gamma = 90
    else if (system === 'hexagonal') { b = a; alpha = beta = 90; gamma = 120 }
    else if (system === 'rhombohedral') { b = c = a; beta = gamma = alpha }
    else if (system === 'monoclinic') { alpha = gamma = 90 }
    else if (system !== 'triclinic') throw new Error('Choose a valid crystal system.')
    const parameters = [a, b, c, alpha, beta, gamma]
    if (parameters.some(value => !Number.isFinite(value)) || [a, b, c].some(value => value <= 0)
      || [alpha, beta, gamma].some(value => value <= 0 || value >= 180)) {
      throw new Error('Cell lengths must be positive and angles must be between 0° and 180°.')
    }
    const [ca, cb, cg] = [alpha, beta, gamma].map(value => Math.cos(value * Math.PI / 180))
    const metric = 1 + 2 * ca * cb * cg - ca * ca - cb * cb - cg * cg
    if (metric <= 1e-10) throw new Error('These cell angles do not define a non-degenerate crystal cell.')
    return parameters
  }

  function cellVectors (parameters) {
    const [a, b, c, alpha, beta, gamma] = cellParameters('triclinic', parameters)
    const [ca, cb, cg] = [alpha, beta, gamma].map(value => Math.cos(value * Math.PI / 180))
    const sg = Math.sin(gamma * Math.PI / 180)
    const cy = (ca - cb * cg) / sg
    return [[a, 0, 0], [b * cg, b * sg, 0], [c * cb, c * cy, c * Math.sqrt(Math.max(0, 1 - cb * cb - cy * cy))]]
  }

  function verifyAtoms (mapping, info) {
    if (!info.ok) throw new Error(info.message || info.error || 'ASE could not read the trajectory.')
    if (info.n_atoms !== mapping.length || info.symbols?.length !== mapping.length || info.positions?.length !== mapping.length) {
      throw new Error('The ASE atom count does not match MONET. Reload the trajectory.')
    }
    mapping.forEach((atom, index) => {
      if (info.symbols[index] !== atom.element || ['x', 'y', 'z'].some((axis, j) =>
        !Number.isFinite(info.positions[index]?.[j]) || Math.abs(info.positions[index][j] - atom[axis]) > 1e-6)) {
        throw new Error(`ASE atom ${index} does not match MONET atom ${atom.monetId}. Reload the trajectory.`)
      }
    })
    return true
  }

  function seriesLabel (key, atoms) {
    return 'Atoms ' + key.split('-').map(index => {
      const atom = atoms[Number(index)]
      if (!atom) throw new Error('ASE returned an unknown atom index.')
      return `${atom.monetId} (${atom.element})`
    }).join(' – ')
  }

  // Periodic angle conventions: [start of the range, period].
  const ANGLE_PERIODS = { 360: [0, 360], signed90: [-90, 180], fold180: [0, 180] }

  // Sums x(t)·x(t+m) over time origins for every lag m (FFT, O(N log N)).
  function autocorrelationSums (x) {
    const n = x.length
    let size = 1
    while (size < 2 * n) size *= 2
    const re = new Float64Array(size), im = new Float64Array(size)
    re.set(x)
    const fft = (re, im, inverse) => {
      for (let i = 1, j = 0; i < size; i++) {
        let bit = size >> 1
        for (; j & bit; bit >>= 1) j ^= bit
        j ^= bit
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
      }
      for (let len = 2; len <= size; len *= 2) {
        const angle = (inverse ? -2 : 2) * Math.PI / len
        const wr = Math.cos(angle), wi = Math.sin(angle)
        for (let i = 0; i < size; i += len) {
          let cr = 1, ci = 0
          for (let k = 0; k < len / 2; k++) {
            const a = i + k, b = a + len / 2
            const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
            re[b] = re[a] - tr; im[b] = im[a] - ti
            re[a] += tr; im[a] += ti
            const next = cr * wr - ci * wi
            ci = cr * wi + ci * wr; cr = next
          }
        }
      }
    }
    fft(re, im, false)
    for (let i = 0; i < size; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0 }
    fft(re, im, true)
    return Array.from(re.subarray(0, n), v => v / size)
  }

  // Integrated autocorrelation time (in samples) of the deviations, as in the Python ACF panel:
  // trapezoidal integral of the normalised ACF up to its first non-positive value.
  function integratedTime (deviations) {
    const n = deviations.length
    if (n < 4) return NaN
    const sums = autocorrelationSums(deviations)
    if (!(sums[0] > 0)) return NaN
    const acf = sums.map((v, m) => (v / (n - m)) / (sums[0] / n))
    let zero = acf.findIndex(v => v <= 0)
    if (zero < 0) zero = n
    if (zero < 2) return NaN
    let tau = 0
    for (let m = 1; m < zero; m++) tau += (acf[m] + acf[m - 1]) / 2
    return tau
  }

  // Mean, standard deviation (spread) and standard error of the mean corrected for time correlation.
  // Periodic angle ranges use circular statistics (Mardia): std = sqrt(-2 ln R)/k with R the mean resultant length.
  function seriesStats (values, angleRange) {
    const data = values.filter(Number.isFinite)
    if (!data.length) return null
    const periodic = ANGLE_PERIODS[angleRange]
    let result
    let deviations
    if (!periodic) {
      const mean = data.reduce((sum, v) => sum + v, 0) / data.length
      const variance = data.length > 1 ? data.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (data.length - 1) : 0
      result = { mean, std: Math.sqrt(variance), n: data.length, circular: false }
      deviations = data.map(v => v - mean)
    } else {
      const [start, period] = periodic
      const k = 2 * Math.PI / period
      const c = data.reduce((sum, v) => sum + Math.cos(v * k), 0) / data.length
      const s = data.reduce((sum, v) => sum + Math.sin(v * k), 0) / data.length
      const length = Math.min(1, Math.hypot(c, s))
      const angle = Math.atan2(s, c) / k
      const mean = ((angle - start) % period + period) % period + start
      const std = length > 0 ? Math.sqrt(-2 * Math.log(length)) / k : Infinity
      result = { mean, std, n: data.length, circular: true, resultant: length }
      // Signed deviations from the circular mean, wrapped into [-P/2, P/2).
      deviations = data.map(v => ((v - mean + period / 2) % period + period) % period - period / 2)
    }
    const tau = integratedTime(deviations)
    const nEff = Number.isFinite(tau) && tau > 0 ? Math.min(result.n, Math.max(1, result.n / (2 * tau))) : result.n
    return { ...result, tauInt: tau, nEff, sem: Number.isFinite(result.std) ? result.std / Math.sqrt(nEff) : Infinity }
  }

  // Probability density histogram; periodic ranges use the full period as bin range.
  function histogram (values, bins, low, high) {
    const data = values.filter(Number.isFinite)
    if (low === undefined) { low = Math.min(...data); high = Math.max(...data) }
    if (!(high > low)) { low -= 0.5; high += 0.5 }
    const width = (high - low) / bins
    const counts = new Array(bins).fill(0)
    for (const v of data) counts[Math.min(bins - 1, Math.max(0, Math.floor((v - low) / width)))]++
    return { centres: counts.map((_, i) => low + (i + 0.5) * width), density: counts.map(count => count / (data.length * width)), width }
  }

  const api = { atomMap, groupsFromIds, selectedIndices, cellParameters, cellVectors, verifyAtoms, seriesLabel, seriesStats, histogram, ANGLE_PERIODS }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetASEModel = api
})(globalThis)

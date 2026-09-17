'use strict'
// Periodic-cell helpers for display: fractional coordinates, minimum-image bonds,
// whole molecules and wrapping into the cell. Cell vectors are the rows of `cell` (Å).
;(function (root) {
  const covalentRadius = element => (root.MonetViewer || require('./viewer.js')).covalentRadius(element)

  function inverse (m) {
    const [[a, b, c], [d, e, f], [g, h, i]] = m
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    if (!(Math.abs(det) > 1e-12)) throw new Error('The cell is singular.')
    return [
      [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
      [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
      [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]
    ]
  }

  // Row-vector convention: cart = frac · cell, frac = cart · inv(cell).
  const toFrac = (x, y, z, inv) => [
    x * inv[0][0] + y * inv[1][0] + z * inv[2][0],
    x * inv[0][1] + y * inv[1][1] + z * inv[2][1],
    x * inv[0][2] + y * inv[1][2] + z * inv[2][2]
  ]
  const toCart = (u, v, w, cell) => [
    u * cell[0][0] + v * cell[1][0] + w * cell[2][0],
    u * cell[0][1] + v * cell[1][1] + w * cell[2][1],
    u * cell[0][2] + v * cell[1][2] + w * cell[2][2]
  ]

  // Minimum-image displacement from p to q (exact for bond-length vectors in cells wider than twice the cutoff).
  function minimumImage (dx, dy, dz, cell, inv) {
    const f = toFrac(dx, dy, dz, inv).map(v => v - Math.round(v))
    return toCart(f[0], f[1], f[2], cell)
  }

  // Share of atoms outside the cell (fractional coordinates outside [0, 1)).
  function outsideFraction (coords, cell) {
    const inv = inverse(cell)
    const n = coords.length / 3
    let outside = 0
    for (let a = 0; a < n; a++) {
      const f = toFrac(coords[3 * a], coords[3 * a + 1], coords[3 * a + 2], inv)
      if (f.some(v => v < -1e-9 || v >= 1 + 1e-9)) outside++
    }
    return n ? outside / n : 0
  }

  // Bonds by covalent radii with periodic images, using a cell list in fractional space.
  function periodicBonds (elements, coords, cell, scale = 1.2) {
    const n = elements.length
    const inv = inverse(cell)
    const radii = elements.map(e => (e === 'X' ? 0 : covalentRadius(e)))
    const cutoff = 2 * Math.max(0, ...radii) * scale
    if (!(cutoff > 0) || n < 2) return new Uint32Array(0)
    // Perpendicular widths of the cell decide how many grid cells fit along each axis.
    const volume = Math.abs(cell[0][0] * (cell[1][1] * cell[2][2] - cell[1][2] * cell[2][1]) - cell[0][1] * (cell[1][0] * cell[2][2] - cell[1][2] * cell[2][0]) + cell[0][2] * (cell[1][0] * cell[2][1] - cell[1][1] * cell[2][0]))
    const cross = (p, q) => Math.hypot(p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0])
    const widths = [volume / cross(cell[1], cell[2]), volume / cross(cell[2], cell[0]), volume / cross(cell[0], cell[1])]
    const dims = widths.map(w => Math.max(1, Math.floor(w / cutoff)))
    const frac = new Float64Array(3 * n)
    const bins = new Map()
    const keyOf = (i, j, k) => (i * dims[1] + j) * dims[2] + k
    const cellOf = new Int32Array(3 * n)
    for (let a = 0; a < n; a++) {
      const f = toFrac(coords[3 * a], coords[3 * a + 1], coords[3 * a + 2], inv)
      for (let d = 0; d < 3; d++) {
        const w = f[d] - Math.floor(f[d])
        frac[3 * a + d] = w
        cellOf[3 * a + d] = Math.min(dims[d] - 1, Math.floor(w * dims[d]))
      }
      const key = keyOf(cellOf[3 * a], cellOf[3 * a + 1], cellOf[3 * a + 2])
      const list = bins.get(key)
      if (list) list.push(a); else bins.set(key, [a])
    }
    const offsets = dims.map(d => [...new Set([-1, 0, 1].map(o => ((o % d) + d) % d))])
    const pairs = []
    for (let a = 0; a < n; a++) {
      if (!radii[a]) continue
      const visited = new Set()
      for (const oi of offsets[0]) for (const oj of offsets[1]) for (const ok of offsets[2]) {
        const key = keyOf((cellOf[3 * a] + oi) % dims[0], (cellOf[3 * a + 1] + oj) % dims[1], (cellOf[3 * a + 2] + ok) % dims[2])
        if (visited.has(key)) continue
        visited.add(key)
        const list = bins.get(key)
        if (!list) continue
        for (const b of list) {
          if (b <= a || !radii[b]) continue
          let du = frac[3 * b] - frac[3 * a], dv = frac[3 * b + 1] - frac[3 * a + 1], dw = frac[3 * b + 2] - frac[3 * a + 2]
          du -= Math.round(du); dv -= Math.round(dv); dw -= Math.round(dw)
          const [dx, dy, dz] = toCart(du, dv, dw, cell)
          const limit = (radii[a] + radii[b]) * scale
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 > 0.16 && d2 < limit * limit) pairs.push(a, b)
        }
      }
    }
    return Uint32Array.from(pairs)
  }

  // Breadth-first spanning forest of the bond graph: order, parent (−1 for roots) and molecule id.
  function moleculeTree (n, bonds) {
    const neighbours = Array.from({ length: n }, () => [])
    for (let k = 0; k < bonds.length; k += 2) { neighbours[bonds[k]].push(bonds[k + 1]); neighbours[bonds[k + 1]].push(bonds[k]) }
    const parent = new Int32Array(n).fill(-2)
    const molecule = new Int32Array(n)
    const order = []
    let count = 0
    for (let start = 0; start < n; start++) {
      if (parent[start] !== -2) continue
      parent[start] = -1
      molecule[start] = count
      const queue = [start]
      for (let q = 0; q < queue.length; q++) {
        const a = queue[q]
        order.push(a)
        for (const b of neighbours[a]) {
          if (parent[b] !== -2) continue
          parent[b] = a
          molecule[b] = count
          queue.push(b)
        }
      }
      count++
    }
    return { order: Int32Array.from(order), parent, molecule, count }
  }

  /**
   * Display coordinates for one frame.
   * mode: 'none' | 'atoms' (each atom into the cell) | 'molecules' (whole molecules, centroid inside the cell)
   * center: atom indices whose centroid is moved to the cell centre (after making molecules whole), or null.
   */
  function wrapFrame (coords, cell, { mode = 'none', tree = null, center = null } = {}) {
    const n = coords.length / 3
    const out = Float64Array.from(coords)
    if (mode === 'none' && !center) return out
    const inv = inverse(cell)
    if (mode === 'molecules' && tree) {
      // Rebuild molecules split by the boundary: each atom follows its parent by the minimum image.
      for (const a of tree.order) {
        const p = tree.parent[a]
        if (p < 0) continue
        const d = minimumImage(out[3 * a] - out[3 * p], out[3 * a + 1] - out[3 * p + 1], out[3 * a + 2] - out[3 * p + 2], cell, inv)
        out[3 * a] = out[3 * p] + d[0]; out[3 * a + 1] = out[3 * p + 1] + d[1]; out[3 * a + 2] = out[3 * p + 2] + d[2]
      }
    }
    if (center && center.length) {
      let cx = 0, cy = 0, cz = 0
      for (const a of center) { cx += out[3 * a]; cy += out[3 * a + 1]; cz += out[3 * a + 2] }
      const middle = toCart(0.5, 0.5, 0.5, cell)
      const shift = [middle[0] - cx / center.length, middle[1] - cy / center.length, middle[2] - cz / center.length]
      for (let a = 0; a < n; a++) for (let d = 0; d < 3; d++) out[3 * a + d] += shift[d]
    }
    if (mode === 'atoms') {
      for (let a = 0; a < n; a++) {
        const f = toFrac(out[3 * a], out[3 * a + 1], out[3 * a + 2], inv)
        const shift = toCart(-Math.floor(f[0]), -Math.floor(f[1]), -Math.floor(f[2]), cell)
        for (let d = 0; d < 3; d++) out[3 * a + d] += shift[d]
      }
    } else if (mode === 'molecules') {
      const count = tree ? tree.count : n
      const sums = new Float64Array(3 * count), sizes = new Int32Array(count)
      for (let a = 0; a < n; a++) {
        const m = tree ? tree.molecule[a] : a
        sums[3 * m] += out[3 * a]; sums[3 * m + 1] += out[3 * a + 1]; sums[3 * m + 2] += out[3 * a + 2]; sizes[m]++
      }
      const shifts = new Float64Array(3 * count)
      for (let m = 0; m < count; m++) {
        const f = toFrac(sums[3 * m] / sizes[m], sums[3 * m + 1] / sizes[m], sums[3 * m + 2] / sizes[m], inv)
        const s = toCart(-Math.floor(f[0]), -Math.floor(f[1]), -Math.floor(f[2]), cell)
        shifts[3 * m] = s[0]; shifts[3 * m + 1] = s[1]; shifts[3 * m + 2] = s[2]
      }
      for (let a = 0; a < n; a++) {
        const m = tree ? tree.molecule[a] : a
        for (let d = 0; d < 3; d++) out[3 * a + d] += shifts[3 * m + d]
      }
    }
    return out
  }

  // Distance, angle or dihedral of 2–4 atoms from flat coordinates (minimum image when a cell is given).
  function geometry (coords, ids, cell) {
    const inv = cell ? inverse(cell) : null
    const vec = (a, b) => {
      const d = [coords[3 * b] - coords[3 * a], coords[3 * b + 1] - coords[3 * a + 1], coords[3 * b + 2] - coords[3 * a + 2]]
      return inv ? minimumImage(d[0], d[1], d[2], cell, inv) : d
    }
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
    const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
    const norm = p => Math.sqrt(dot(p, p))
    if (ids.length === 2) return { kind: 'distance', value: norm(vec(ids[0], ids[1])) }
    if (ids.length === 3) {
      const u = vec(ids[1], ids[0]), v = vec(ids[1], ids[2])
      return { kind: 'angle', value: Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (norm(u) * norm(v))))) * 180 / Math.PI }
    }
    if (ids.length === 4) {
      // Same convention as ase.Atoms.get_dihedral: 0–360°.
      const b0 = vec(ids[0], ids[1]), b1 = vec(ids[1], ids[2]), b2 = vec(ids[2], ids[3])
      const n1 = cross(b0, b1), n2 = cross(b1, b2)
      const m = cross(n1, b1)
      const angle = Math.atan2(dot(m, n2) / norm(b1), dot(n1, n2)) * 180 / Math.PI
      return { kind: 'dihedral', value: ((-angle % 360) + 360) % 360 }
    }
    return null
  }

  const api = { inverse, minimumImage, outsideFraction, periodicBonds, moleculeTree, wrapFrame, geometry }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetPBC = api
})(globalThis)

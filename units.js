'use strict'

// Physical constants and cell conversions shared by the QM inputs (browser and Node).
// monet_units.py implements the same functions for the Python launcher.
;(function (root) {
  const BOHR_ANGSTROM = 0.529177210903 // CODATA 2018
  const HARTREE_EV = 27.211386245988
  const RY_EV = HARTREE_EV / 2
  const AU_TIME_FS = 0.02418884326585747 // ħ/E_h
  const RY_TIME_FS = 2 * AU_TIME_FS // ħ/Ry

  const angstromToBohr = x => x / BOHR_ANGSTROM
  const bohrToAngstrom = x => x * BOHR_ANGSTROM
  const RAD = Math.PI / 180
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const norm = v => Math.sqrt(dot(v, v))
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]

  // a along x, b in the xy plane (ASE convention).
  function cellVectors ([a, b, c, alpha, beta, gamma]) {
    const [ca, cb, cg] = [alpha, beta, gamma].map(v => Math.cos(v * RAD))
    const sg = Math.sin(gamma * RAD)
    const cy = (ca - cb * cg) / sg
    return [[a, 0, 0], [b * cg, b * sg, 0], [c * cb, c * cy, c * Math.sqrt(Math.max(0, 1 - cb * cb - cy * cy))]]
  }

  function cellParameters (rows) {
    const [a, b, c] = rows
    const volume = Math.abs(dot(a, cross(b, c)))
    const lengths = rows.map(norm)
    if (!(volume > 1e-12) || lengths.some(l => !(l > 0))) throw new Error('The cell is degenerate (zero volume).')
    const angle = (u, v) => Math.acos(Math.min(1, Math.max(-1, dot(u, v) / (norm(u) * norm(v))))) / RAD
    return [...lengths, angle(b, c), angle(a, c), angle(a, b)]
  }

  // Fractional coordinates: solve r = f · rows (rows are the cell vectors).
  function fractional (rows, positions) {
    const [a, b, c] = rows
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b)
    const volume = dot(a, bc)
    if (!(Math.abs(volume) > 1e-12)) throw new Error('The cell is degenerate (zero volume).')
    return positions.map(r => [dot(r, bc) / volume, dot(r, ca) / volume, dot(r, ab) / volume])
  }

  const isStandardOrientation = (rows, tol = 1e-6) => Math.abs(rows[0][1]) <= tol && Math.abs(rows[0][2]) <= tol && Math.abs(rows[1][2]) <= tol && rows[0][0] > 0 && rows[1][1] > 0 && rows[2][2] > 0

  // Row-vector matrix product and inverse (3×3).
  const matMul = (A, B) => A.map(row => [0, 1, 2].map(j => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]))
  function inverse (M) {
    const [a, b, c] = M
    const det = dot(a, cross(b, c))
    const cols = [cross(b, c), cross(c, a), cross(a, b)] // columns of the inverse, times det
    return [0, 1, 2].map(i => cols.map(col => col[i] / det))
  }
  // A custom cell (rows built in the standard orientation) turned into the orientation of the reference lattice:
  // Q = inverse(standard(reference)) · reference is the rotation from the standard setting to the reference one, and
  // customRows · Q keeps the cell fixed relative to the atoms. No reference, a reference already in the standard
  // orientation or a degenerate one: customRows unchanged.
  function orientLike (customRows, referenceRows) {
    if (!referenceRows || isStandardOrientation(referenceRows)) return customRows
    let standard
    try { standard = cellVectors(cellParameters(referenceRows)) } catch (error) { return customRows }
    return matMul(customRows, matMul(inverse(standard), referenceRows))
  }

  const api = { BOHR_ANGSTROM, HARTREE_EV, RY_EV, AU_TIME_FS, RY_TIME_FS, angstromToBohr, bohrToAngstrom, cellVectors, cellParameters, fractional, isStandardOrientation, orientLike }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetUnits = api
})(globalThis)

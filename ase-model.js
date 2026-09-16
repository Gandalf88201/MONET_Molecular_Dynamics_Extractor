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

  const api = { atomMap, groupsFromIds, selectedIndices, cellParameters, cellVectors, verifyAtoms, seriesLabel }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetASEModel = api
})(globalThis)

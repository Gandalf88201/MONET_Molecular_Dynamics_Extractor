'use strict'
// Viewer: water and ions are found from the bonds (not from residue names) and can be hidden.
const assert = require('node:assert/strict')
const { MolecularViewer, classifySolvent, findBonds } = require('../viewer.js')
let checks = 0

const stub = new Proxy(function () {}, { get: (_, key) => (key === 'canvas' ? undefined : stub), apply: () => stub, set: () => true })
const canvas = { width: 0, height: 0, getContext: () => stub, addEventListener () {}, ownerDocument: undefined, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }) }

function build ({ waters = 0, solute = true, ions = [], wrongName = false } = {}) {
  const atoms = []
  const add = (element, x, y, z) => atoms.push({ index: atoms.length + 1, element, x, y, z })
  if (solute) { // methanol: its O has one H and one C, so it is not a water
    add('C', 0, 0, 0); add('O', 1.43, 0, 0); add('H', 1.75, 0.9, 0); add('H', -0.36, 1.02, 0); add('H', -0.36, -0.5, 0.88); add('H', -0.36, -0.5, -0.88)
  }
  for (let k = 0; k < waters; k++) {
    const x = 10 + 4 * (k % 20), y = 10 + 4 * Math.floor(k / 20 % 20), z = 10 + 4 * Math.floor(k / 400)
    add('O', x, y, z); add('H', x + 0.9572, y, z); add('H', x - 0.24, y + 0.927, z)
  }
  for (const [element, x, y, z] of ions) add(element, x, y, z)
  return atoms
}
const kinds = atoms => classifySolvent(atoms, findBonds(atoms))

// Waters and ions, even when the covalent cut-offs join an ion to the O of its first shell (Na–O 2.4 Å).
let atoms = build({ waters: 3, ions: [['Na', 10, 10, 12.4], ['Cl', 30, 30, 30]] })
let kind = kinds(atoms)
assert.deepEqual([...kind.slice(0, 6)], [0, 0, 0, 0, 0, 0]); checks++ // methanol stays solute
assert.deepEqual([...kind.slice(6, 15)], [1, 1, 1, 1, 1, 1, 1, 1, 1]); checks++ // three waters
assert.deepEqual([...kind.slice(15)], [2, 2]); checks++ // both ions
assert.ok(findBonds(atoms).length > 0); checks++

// An ion bonded to the solute (Na at 2.3 Å from the methanol O) is part of the solute; so is a covalent chlorine.
atoms = build({ waters: 1, ions: [['Na', 3.7, 0, 0]] })
assert.equal(kinds(atoms)[atoms.length - 1], 0); checks++
atoms = [{ index: 1, element: 'C', x: 0, y: 0, z: 0 }, { index: 2, element: 'Cl', x: 1.77, y: 0, z: 0 }]
assert.deepEqual([...kinds(atoms)], [0, 0]); checks++
// H2O2 and hydronium are not water; an O with two H and one more bond is not water.
atoms = [{ index: 1, element: 'O', x: 0, y: 0, z: 0 }, { index: 2, element: 'H', x: 0.96, y: 0, z: 0 }, { index: 3, element: 'H', x: -0.24, y: 0.93, z: 0 }, { index: 4, element: 'C', x: 0, y: -1.4, z: 0 }]
assert.deepEqual([...kinds(atoms)], [0, 0, 0, 0]); checks++

// Counts, the suggested mode and the visibility mask.
const viewer = new MolecularViewer(canvas)
viewer.loadAtoms(build({ waters: 3, ions: [['Na', 10, 10, 12.4], ['Cl', 30, 30, 30]] }))
assert.deepEqual(viewer.solventCounts(), { water: 3, ions: 2, solute: 6, atoms: 17 }); checks++
assert.equal(viewer.suggestSolventMode(), 'show'); checks++ // small systems are shown as they are
assert.equal(viewer.visibleCount, 17); assert.equal(viewer.hidden, null); checks++
viewer.setSolventMode('water', { fit: false })
assert.equal(viewer.visibleCount, 8); assert.deepEqual([...viewer.hidden.slice(0, 8)], [0, 0, 0, 0, 0, 0, 1, 1]); assert.equal(viewer.hidden[15], 0); checks++
viewer.setSolventMode('solvent', { fit: false })
assert.equal(viewer.visibleCount, 6); assert.equal(viewer.hidden[15], 1); assert.equal(viewer.hidden[16], 1); checks++
viewer.setSolventMode('show', { fit: false })
assert.equal(viewer.hidden, null); assert.equal(viewer.visibleCount, 17); checks++
viewer.setSolventMode('nonsense', { fit: false })
assert.equal(viewer.solventMode, 'show'); checks++

// A large solvated system is hidden by default; a large pure-water box (nothing to look at) is not.
viewer.loadAtoms(build({ waters: 1200, ions: [['Na', 10, 10, 12.4]] }))
assert.equal(viewer.suggestSolventMode(), 'solvent'); checks++
viewer.loadAtoms(build({ waters: 1200, solute: false }))
assert.equal(viewer.solventCounts().solute, 0); assert.equal(viewer.suggestSolventMode(), 'show'); checks++
viewer.loadAtoms(build({ waters: 20 }))
assert.equal(viewer.suggestSolventMode(), 'show'); checks++

// Fit view and hit testing only consider the atoms that are drawn.
canvas.width = canvas.height = 400
viewer.loadAtoms(build({ waters: 1200 }))
const crowd = viewer.atoms.length
viewer.setSolventMode('solvent', { fit: false })
assert.equal(viewer.visibleCount, 6); checks++
viewer.fitView()
const solute = viewer.atoms.slice(0, 6)
const bounds = axis => (Math.max(...solute.map(a => a[axis])) + Math.min(...solute.map(a => a[axis]))) / 2
assert.ok(Math.abs(viewer.center[0] - bounds('x')) < 1e-9 && Math.abs(viewer.center[1] - bounds('y')) < 1e-9 && Math.abs(viewer.center[2] - bounds('z')) < 1e-9); checks++
assert.equal(viewer._hitTest(-1000, -1000), null); checks++
const projected = viewer._projectAll()
const watersAtom = viewer.atoms.findIndex(a => a.element === 'O' && a.index > 6)
assert.equal(viewer._hitTest(projected.x[watersAtom], projected.y[watersAtom]), null); checks++ // a hidden water cannot be picked
assert.ok(crowd > 3000); checks++

// Atoms are classified once per load: moving the coordinates (player) keeps the mask.
viewer.updateCoordinates(Float64Array.from(viewer.atoms.flatMap(a => [a.x + 1, a.y, a.z])), { rebond: false })
assert.equal(viewer.visibleCount, 6); assert.equal(viewer.hidden[watersAtom], 1); checks++

console.log(`PASS: ${checks} viewer checks (water and ion detection, solvent hiding, fit view, hit testing).`)

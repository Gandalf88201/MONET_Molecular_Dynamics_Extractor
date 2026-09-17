'use strict'
// Import of other codes' trajectories into extended XYZ (Python side, no browser needed).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const python = process.env.PYTHON || 'python3'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monet-formats-'))
const BOHR = 0.529177210903
let checks = 0

function bridge (command) {
  const out = execFileSync(python, [path.join(root, 'ase_bridge.py')], { input: JSON.stringify(command), env: { ...process.env, MONET_CACHE_DIR: path.join(temp, 'cache') } }).toString()
  return JSON.parse(out.trim().split('\n').pop())
}
const write = (name, text) => { const file = path.join(temp, name); fs.writeFileSync(file, text); return file }
function importFile (file, extra = {}) {
  const output = path.join(temp, `${path.basename(file)}-${checks}.extxyz`)
  const result = bridge({ action: 'import', filename: file, output, source_name: path.basename(file), ...extra })
  if (result.ok) result.frames_data = bridge({ action: 'scan', filename: output })
  result.output = output
  return result
}
const frame = (output, index) => bridge({ action: 'frame', filename: output, index }).atoms
const close = (a, b, tol = 1e-6) => Math.abs(a - b) < tol

// VASP XDATCAR written by ASE (variable cell) and ASE's own OUTCAR / vasprun test data.
const testdata = execFileSync(python, ['-c', 'import ase, os; print(os.path.join(os.path.dirname(ase.__file__), "test", "testdata"))']).toString().trim()
execFileSync(python, ['-c', `
import sys
from ase import Atoms
from ase.io import write
frames = [Atoms('OH2', positions=[[0,0,0],[0.96,0,0],[-0.24,0.93,0]], cell=[5+i,5,5], pbc=True) for i in range(3)]
for i, a in enumerate(frames): a.positions += 0.01 * i
write(sys.argv[1], frames, format='vasp-xdatcar')
`, path.join(temp, 'XDATCAR')])
let result = importFile(path.join(temp, 'XDATCAR'))
assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.source_format, 'vasp-xdatcar'); assert.equal(result.frames, 3); checks++
assert.equal(result.frames_data.configCount, 3); assert.deepEqual(result.frames_data.symbols, ['O', 'H', 'H']); checks++
assert.match(fs.readFileSync(result.output, 'utf8').split('\n')[1], /^Lattice="5\.0000000000 0\.0000000000/, 'cell kept'); checks++
assert.ok(close(frame(result.output, 2)[1].x, 0.98, 1e-6)); checks++
for (const [file, format] of [['vasp/OUTCAR_example_1', 'vasp-out'], ['vasp/vasprun_pstress.xml', 'vasp-xml']]) {
  const source = path.join(testdata, file)
  if (!fs.existsSync(source)) continue
  const copy = path.join(temp, format === 'vasp-out' ? 'OUTCAR' : 'vasprun.xml'); fs.copyFileSync(source, copy)
  result = importFile(copy)
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.source_format, format); assert.ok(result.frames >= 1); checks++
}

// Qbox output (ASE test file): positions/cell converted from bohr to Å.
const qbox = path.join(testdata, 'qbox_test.xml')
result = importFile(qbox)
assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.source_format, 'qbox'); assert.equal(result.frames, 5); checks++
assert.ok(close(frame(result.output, 4)[0].x, 3.70001108 * BOHR, 1e-7)); checks++
assert.match(fs.readFileSync(result.output, 'utf8').split('\n')[1], new RegExp(`Lattice="${(16 * BOHR).toFixed(10)}`)); checks++

// ORCA optimisation: every coordinate block is a frame.
const orcaBlock = (x) => `\n---------------------------------\nCARTESIAN COORDINATES (ANGSTROEM)\n---------------------------------\n  O      0.000000    0.000000    ${x}\n  H      0.757000    0.586000    0.000000\n  H     -0.757000    0.586000    0.000000\n\n----------------------------\nCARTESIAN COORDINATES (A.U.)\n`
const orca = write('opt.out', `                                 * O   R   C   A *\n${orcaBlock('0.000000')}ORCA GEOMETRY RELAXATION STEP\n${orcaBlock('0.100000')}\n****ORCA TERMINATED NORMALLY****\n`)
result = importFile(orca)
assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.source_format, 'orca-output'); assert.equal(result.frames, 2); checks++
assert.ok(close(frame(result.output, 1)[0].z, .1)); checks++

// CPMD TRAJECTORY (bohr) with a reference structure and a restart marker.
const reference = write('ref.xyz', '2\nreference\nC 0 0 0\nO 0 0 1.128\n')
const cpmd = write('TRAJECTORY', '1 0.0 0.0 0.0 0 0 0\n1 0.0 0.0 2.13 0 0 0\n<<<<<<  NEW DATA  >>>>>>\n2 0.1 0.0 0.0 0 0 0\n2 0.1 0.0 2.20 0 0 0\n')
result = importFile(cpmd)
assert.equal(result.ok, false); assert.match(result.message, /reference structure/); checks++
result = importFile(cpmd, { reference })
assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.source_format, 'cpmd-trajectory'); assert.equal(result.frames, 2); checks++
assert.ok(close(frame(result.output, 1)[1].z, 2.2 * BOHR)); assert.equal(frame(result.output, 1)[1].element, 'O'); checks++
assert.match(fs.readFileSync(result.output, 'utf8'), /source_step=2/); checks++
result = importFile(write('TRAJECTORY-bad', '1 0 0 0\n1 0 0 2\n2 0 0 0\n'), { format: 'cpmd-trajectory', reference })
assert.equal(result.ok, false); assert.match(result.message, /incomplete frame/); checks++

// QE cp.x .pos + .cel (bohr); columns option transposes the cell.
const pos = write('water.pos', '   10   0.0010\n 0.0 0.0 0.0\n 0.0 0.0 2.0\n   20   0.0020\n 0.1 0.0 0.0\n 0.1 0.0 2.0\n')
const cel = write('water.cel', '   10   0.0010\n 20.0 0.0 0.0\n 1.0 21.0 0.0\n 0.0 0.0 22.0\n   20   0.0020\n 20.5 0.0 0.0\n 1.0 21.0 0.0\n 0.0 0.0 22.0\n')
result = importFile(pos, { reference, cell_file: cel })
assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.frames, 2); checks++
let header = fs.readFileSync(result.output, 'utf8').split('\n')
assert.match(header[5], new RegExp(`^Lattice="${(20.5 * BOHR).toFixed(10)} 0.0000000000 0.0000000000 ${(1 * BOHR).toFixed(10)}`)); checks++
result = importFile(pos, { reference, cell_file: cel, cell_vectors: 'columns' })
assert.match(fs.readFileSync(result.output, 'utf8').split('\n')[1], new RegExp(`^Lattice="${(20 * BOHR).toFixed(10)} ${(1 * BOHR).toFixed(10)}`)); checks++
result = importFile(pos, { reference, cell_file: write('short.cel', '   10  0.001\n 1 0 0\n 0 1 0\n 0 0 1\n') })
assert.equal(result.ok, false); assert.match(result.message, /fewer steps/); checks++

// CP2K XYZ + .cell (NPT): lattice matched by step number.
const cp2kXyz = write('run-pos-1.xyz', '2\n i =        0, time = 0.0, E = -1\nC 0 0 0\nO 0 0 1.1\n2\n i =        5, time = 2.5, E = -1\nC 0 0 0\nO 0 0 1.2\n')
const cp2kCell = write('run-1.cell', '#   Step   Time [fs]       Ax [Angstrom]  Ay  Az  Bx  By  Bz  Cx  Cy  Cz   Volume [Angstrom^3]\n 0 0.0 10 0 0 0 10 0 0 0 10 1000\n 5 2.5 11 0 0 0 10 0 0 0 10 1100\n')
result = importFile(cp2kXyz, { cell_file: cp2kCell })
assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.source_format, 'xyz'); checks++
header = fs.readFileSync(result.output, 'utf8').split('\n')
assert.match(header[1], /^Lattice="10\.0000000000 /); assert.match(header[5], /^Lattice="11\.0000000000 /); assert.match(header[5], /source_step=5/); checks++
result = bridge({ action: 'bonds', filename: result.output, pairs: [[0, 1]], mic: true })
assert.deepEqual(result.series['0-1'].map(v => Number(v.toFixed(6))), [1.1, 1.2]); checks++

// CP2K DCD (binary) with a reference.
execFileSync(python, ['-c', `
import sys, numpy as np
from ase.io.cp2k import _HEADER_DTYPE
natoms = 2
header = np.zeros(1, _HEADER_DTYPE)
header['blk0-0'] = 84; header['hdr'] = b'CORD'; header['blk0-1'] = 84; header['blk1-0'] = 164; header['ntitle'] = 2
header['remark1'] = b'REMARK FILETYPE CORD DCD GENERATED BY CP2K'; header['blk1-1'] = 164
header['blk2-0'] = 4; header['natoms'] = natoms; header['blk2-1'] = 4
with open(sys.argv[1], 'wb') as fh:
    header.tofile(fh)
    for step in range(3):
        np.array([48], 'i4').tofile(fh); np.array([10, 90, 10, 90, 90, 10], 'f8').tofile(fh)
        for axis in range(3):
            np.array([48, 4 * natoms][1:], 'i4').tofile(fh) if False else None
            np.array([48 if axis == 0 else 4 * natoms, 4 * natoms], 'i4').tofile(fh)
            coords = np.array([[0, 0, 0], [0, 0, 1.1 + 0.1 * step]], 'f4')[:, axis]
            coords.tofile(fh)
        np.array([4 * natoms], 'i4').tofile(fh)
`, path.join(temp, 'run.dcd')])
result = importFile(path.join(temp, 'run.dcd'))
assert.equal(result.ok, false); assert.match(result.message, /reference/); checks++
result = importFile(path.join(temp, 'run.dcd'), { reference })
assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.frames, 3); checks++
assert.ok(close(frame(result.output, 2)[1].z, 1.3, 1e-6)); assert.equal(frame(result.output, 2)[0].element, 'C'); checks++

// Plain XYZ passes through unchanged in values; unknown data is rejected clearly.
result = importFile(path.join(root, 'examples/water.XYZ'), { format: 'xyz' })
assert.equal(result.ok, true); assert.ok(close(frame(result.output, 1)[0].x, .1)); checks++
result = importFile(write('mystery.dat', 'hello world\n'))
assert.equal(result.ok, false); assert.match(result.message, /Could not recognise/); checks++
result = bridge({ action: 'import', filename: qbox, output: path.join(temp, 'x.extxyz'), format: 'nonsense' })
assert.equal(result.ok, false); checks++

fs.rmSync(temp, { recursive: true, force: true })
console.log(`PASS: ${checks} format import checks (VASP, Qbox, ORCA, CPMD, cp.x, CP2K cell/DCD).`)

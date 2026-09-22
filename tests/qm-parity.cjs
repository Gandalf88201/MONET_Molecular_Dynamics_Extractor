'use strict'
// The JavaScript (browser/Electron) and Python (launcher) engines must write identical QM inputs.
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const QM = require('../qm-inputs.js')
const R = require('../qm-resolve.js')
const root = path.resolve(__dirname, '..')
let checks = 0

const conf = {
  index: 4, frame: 90, symbols: ['C', 'O', 'H', 'H', 'N'],
  positions: [[0, 0, 0], [1.2089, -0.0000001, 0], [-0.54, 0.93, -0.00001], [-0.54, -0.93, 1e-9], [2.5, 1.125, -3.0000005]]
}
const lattice = [[9.1, 0, 0], [-4.55, 7.881, 0], [0, 0, 15]]
const build = (codes, cards, extra = {}) => ({ ...R.buildSpec({ codes, common: { charge: 0, multiplicities: [1, 3] }, cards, symbols: conf.symbols, cell: null, ...extra }), masses: QM.MASSES })
const cases = []
// 0: every code, defaults, isolated plane-wave codes (centred box)
cases.push([QM.defaultSpec(Object.keys(QM.CODES)), conf, {}])
// 1: charged, override, restricted/auto references, broken symmetry, manual cell
cases.push([build(['gaussian', 'orca', 'qe', 'vasp', 'cp2k', 'qbox'], {
  gaussian: { reference: 'r', brokenSymmetry: true, calc: 'optfreq', override: { charge: -1, multiplicities: [1, 2] } },
  orca: { reference: 'auto', calc: 'td', nstates: 4 },
  qe: { calc: 'optfreq', phx: true, species: { C: 'C.pbe-n-kjpaw.UPF', O: 'O.UPF', H: 'H.UPF', N: 'N.UPF' } },
  vasp: { calc: 'md', species: { C: 'C', O: 'O_s', H: 'H_h', N: 'N' } },
  cp2k: { functional: 'pbe0', calc: 'vcrelax' },
  qbox: { calc: 'md' }
}, { cell: [[10, 0, 0], [0, 11, 0], [0, 0, 12.5]] }), conf, {}])
// 2: trajectory lattice (NPT frame), CP2K HSE06, VASP optfreq
cases.push([build(['vasp', 'cp2k'], { vasp: { calc: 'optfreq' }, cp2k: { functional: 'hse06' } }), { ...conf, lattice }, {}])
// 3: custom template, legacy spec shape
cases.push([build(['gaussian'], {}, { custom: { gaussian: { 0: '{unknown} {ref}{guess} {state}\n{coords}' } } }), conf, {}])
cases.push([{ codes: { gaussian: { folder: '', files: [{ name: 'conf{index}_{tag}.gjf', template: '{mem} {maxcore} {method}/{basis} {nproc}\n' }] }, qe: { folder: 'qe', files: [{ name: '{tag}.pwi', template: '{cell_note}\n{cell_ang}\n' }] } },
  params: { charge: 0, multiplicities: [1], nproc: 6, mem: '4gb', method: 'b3lyp', basis: 'sto-3g', padding: 10 }, masses: QM.MASSES, cell: null }, conf, {}])
// 5: POTCAR runtime, charged
cases.push([build(['vasp'], { vasp: { isolated: true, override: { charge: 1, multiplicities: [2] } } }), conf, { potcar: { text: 'PAW C\nPAW O\nPAW H\nPAW N\n', zval: { C: 4, O: 6, H: 1, N: 5 } } }])

const js = cases.map(([spec, c, runtime]) => QM.render(QM.validate(spec), c, runtime).map(file => [file.path, file.text]))
const py = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
cases = json.load(sys.stdin)
print(json.dumps([[list(item) for item in monet_qm.render(monet_qm.validate(spec), conf, runtime)] for spec, conf, runtime in cases]))
`, root], { input: JSON.stringify(cases) }))
for (let i = 0; i < cases.length; i++) { assert.deepEqual(py[i], js[i], `case ${i}`); checks++ }

// Legacy Gaussian text unchanged with the default card.
const positions = 'O  0.0000000  0.0000000  0.0000000\n'
const legacy = QM.render(QM.defaultSpec(), { index: 1, frame: 0, symbols: ['O'], positions: [[0, 0, 0]] })
assert.deepEqual(legacy.map(file => file.path), ['sing.dat', 'trip.dat']); checks++
assert.equal(legacy[0].text, `%nproc=6\n%chk=s0.chk\n%mem=4gb\n#p ub3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight gfinput gfoldprint pop=full\n\nscf_singlet\n\n0 1\n${positions}\n`); checks++

const text = i => Object.fromEntries(js[i])
// References, broken symmetry, override
assert.match(text(1)['sing.dat'], /#p rb3lyp\/6-31\+g\(d,p\) opt freq maxdisk=300gb nosymm scf=tight guess=mix gfinput/); checks++
assert.match(text(1)['doub.dat'], /#p rob3lyp\/[\s\S]*\n-1 2\n/); assert.equal(text(1)['trip.dat'], undefined); checks++
assert.match(text(1)['orca/sing.inp'], /^! RKS /); assert.match(text(1)['orca/trip.inp'], /^! UKS /); checks++
// Species tables, ph.x, VASP POTCAR.spec, MD
assert.match(text(1)['qe/sing.inp'], /  C 12.011 C.pbe-n-kjpaw.UPF\n/); assert.ok(text(1)['qe/ph_trip.inp']); checks++
assert.equal(text(1)['vasp/POTCAR.spec'], 'C\nO_s\nH_h\nN\n'); assert.match(text(1)['vasp/INCAR_sing'], /MDALGO = 2\n/); checks++
// Manual cell wins over nothing; CP2K truncation radius from the cell (min width 10 → 4.9)
assert.match(text(1)['cp2k/sing.inp'], /CUTOFF_RADIUS 4.9000\n/); assert.match(text(1)['cp2k/sing.inp'], /BASIS_SET AUX_FIT cFIT3\n/); checks++
assert.match(text(1)['qe/sing.inp'], /! MONET configuration 4 \(frame 90\), singlet. Cell: applied manual cell.\n/); checks++
// Isolated: centred box. Extent x: -0.54..2.5 (3.04) + 10 = 13.04, centre shift 6.52 - 0.98 = 5.54
assert.match(text(0)['cp2k/sing.inp'], /A 13.0400000000 0.0000000000 0.0000000000\n/); checks++
assert.match(text(0)['qe/sing.inp'], /ATOMIC_POSITIONS angstrom\nC  5.5400000  /); checks++
assert.match(text(0)['qe/sing.inp'], /Cell: vacuum box = extent \+ 10 A, configuration centred \(isolated system\)./); checks++
// Trajectory lattice per frame
assert.match(text(2)['vasp/POSCAR'], /-4.5500000000  7.8810000000/); assert.match(text(2)['vasp/INCAR_sing_relax'], /# Cell: from the trajectory.\n/); checks++
// Custom template and legacy shape
assert.match(text(3)['sing.dat'], /^\{unknown\} u singlet\nC  0.0000000/); checks++
assert.equal(text(4)['conf4_sing.gjf'], '4gb 666 b3lyp/sto-3g 6\n'); assert.match(text(4)['qe/sing.pwi'], /^Cell: vacuum box = extent \+ 10 A/); checks++
// POTCAR runtime and exact NELECT: 4 + 6 + 2·1 + 5 − 1 = 16
assert.equal(text(5)['vasp/POTCAR'], 'PAW C\nPAW O\nPAW H\nPAW N\n'); assert.match(text(5)['vasp/INCAR_doub'], /\nNELECT = 16\n/); checks++
assert.match(text(0)['vasp/INCAR_sing'], /\n# Net charge 0: set NELECT = \(sum of ZVAL in POTCAR\) - \(0\) for charged systems.\n/); checks++

// Plane-wave code without any cell: both engines refuse.
const bare = build(['qe'], {})
assert.throws(() => QM.render(QM.validate(bare), conf), /no cell for configuration 4/); checks++
assert.throws(() => execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
spec, conf = json.load(sys.stdin)
monet_qm.render(monet_qm.validate(spec), conf)
`, root], { input: JSON.stringify([bare, conf]), stdio: 'pipe' })); checks++

// Validation
for (const bad of [{ multiplicities: [] }, { multiplicities: [1, 1] }, { charge: 0.5 }]) {
  const spec = QM.defaultSpec(); Object.assign(spec.common, bad)
  assert.throws(() => QM.validate(spec)); checks++
}
{ const spec = QM.defaultSpec(['qe']); spec.codes.qe.species = { O: 'O.UPF\nevil' }; assert.throws(() => QM.validate(spec)); checks++ }
{ const spec = QM.defaultSpec(['gaussian']); spec.codes.gaussian.reference = 'x'; assert.throws(() => QM.validate(spec)); checks++ }
const evil = QM.defaultSpec(); evil.codes.gaussian.files[0].name = '../x'
assert.throws(() => QM.validate(evil)); checks++
console.log(`PASS: ${checks} QM input checks (JS/Python parity per code, legacy Gaussian, cells, species, POTCAR).`)

'use strict'
// The JavaScript (browser/Electron) and Python (launcher) engines must write identical QM inputs.
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const QM = require('../qm-inputs.js')
const root = path.resolve(__dirname, '..')
let checks = 0

const conf = {
  index: 4, frame: 90, symbols: ['C', 'O', 'H', 'H', 'N'],
  positions: [[0, 0, 0], [1.2089, -0.0000001, 0], [-0.54, 0.93, -0.00001], [-0.54, -0.93, 1e-9], [2.5, 1.125, -3.0000005]]
}
const cases = []
const all = QM.defaultSpec(Object.keys(QM.CODES))
cases.push([all, conf])
const charged = QM.defaultSpec(Object.keys(QM.CODES))
Object.assign(charged.params, { charge: -1, multiplicities: [2, 4, 7], nproc: 12, mem: '32gb', method: 'pbe0', basis: 'def2-TZVP', padding: 7.5 })
charged.cell = [[10, 0, 0], [0, 11, 0], [0, 0, 12.5]]
cases.push([charged, conf])
cases.push([QM.defaultSpec(['qe', 'vasp', 'cp2k', 'qbox']), { ...conf, lattice: [[9.1, 0, 0], [-4.55, 7.881, 0], [0, 0, 15]] }])
const custom = QM.defaultSpec(['gaussian'])
custom.codes.gaussian.files[0] = { name: 'conf{index}_{tag}.gjf', template: '{unknown} {mem} {maxcore} {state}\n{coords}' }
cases.push([custom, conf])

const js = cases.map(([spec, c]) => QM.render(QM.validate(spec), c).map(file => [file.path, file.text]))
const py = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
cases = json.load(sys.stdin)
print(json.dumps([[list(item) for item in monet_qm.render(monet_qm.validate(spec), conf)] for spec, conf in cases]))
`, root], { input: JSON.stringify(cases) }))
for (let i = 0; i < cases.length; i++) {
  assert.deepEqual(py[i], js[i], `case ${i}`); checks++
}

// Backward compatibility: the default Gaussian template equals the legacy sing.dat/trip.dat text.
const positions = 'O  0.0000000  0.0000000  0.0000000\n'
const legacy = QM.render(QM.defaultSpec(), { index: 1, frame: 0, symbols: ['O'], positions: [[0, 0, 0]] })
assert.deepEqual(legacy.map(file => file.path), ['sing.dat', 'trip.dat']); checks++
assert.equal(legacy[0].text, `%nproc=6\n%chk=s0.chk\n%mem=4gb\n#p ub3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight gfinput gfoldprint pop=full\n\nscf_singlet\n\n0 1\n${positions}\n`); checks++
// Placeholders and derived values.
const text = Object.fromEntries(js[1])
assert.match(text['orca/doub.inp'], /^! UKS pbe0 def2-TZVP TightSCF\n%pal nprocs 12 end\n%maxcore 2666\n/); checks++
assert.match(text['qbox/quar.i'], /set delta_spin 1.5\n/); assert.match(text['qbox/quar.i'], /set cell 18.89726125 0.00000000/); checks++
assert.match(text['qe/mult7.pwi'], /tot_magnetization = 6\n/); assert.match(text['qe/mult7.pwi'], /tot_charge = -1\n/); checks++
assert.match(text['vasp/POSCAR'], /\nC O H N\n1 1 2 1\nCartesian\n/); checks++
assert.equal(js[1].filter(([name]) => name === 'vasp/POSCAR').length, 1); checks++
assert.match(Object.fromEntries(js[0])['cp2k/sing.inp'], /A 13.0400000000 0.0000000000/); checks++
assert.match(Object.fromEntries(js[2])['vasp/POSCAR'], /-4.5500000000  7.8810000000/); checks++
assert.equal(Object.fromEntries(js[3])['conf4_sing.gjf'].split('\n')[0], '{unknown} 4gb 666 singlet'); checks++
for (const bad of [{ multiplicities: [] }, { multiplicities: [1, 1] }, { charge: 0.5 }, { nproc: 0 }, { padding: -1 }]) {
  const spec = QM.defaultSpec(); Object.assign(spec.params, bad)
  assert.throws(() => QM.validate(spec)); checks++
}
const evil = QM.defaultSpec(); evil.codes.gaussian.files[0].name = '../x'
assert.throws(() => QM.validate(evil)); checks++
console.log(`PASS: ${checks} QM input checks (JS/Python parity, legacy Gaussian, placeholders).`)

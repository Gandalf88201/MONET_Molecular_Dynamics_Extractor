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
cases.push([build(['gaussian'], {}, { custom: { gaussian: { '{tag}.dat': '{unknown} {ref}{guess} {state}\n{coords}' } } }), conf, {}])
cases.push([{ codes: { gaussian: { folder: '', files: [{ name: 'conf{index}_{tag}.gjf', template: '{mem} {maxcore} {method}/{basis} {nproc}\n{coords}' }] }, qe: { folder: 'qe', files: [{ name: '{tag}.pwi', template: '{cell_note}\n{cell_ang}\n' }] } },
  params: { charge: 0, multiplicities: [1], nproc: 6, mem: '4gb', method: 'b3lyp', basis: 'sto-3g', padding: 10 }, masses: QM.MASSES, cell: null }, conf, {}])
// 5: POTCAR runtime, charged
cases.push([build(['vasp'], { vasp: { isolated: true, override: { charge: 1, multiplicities: [2] } } }), conf, { potcar: { text: 'PAW C\nPAW O\nPAW H\nPAW N\n', zval: { C: 4, O: 6, H: 1, N: 5 } } }])
// 6-7: degenerate (all-zero) trajectory lattice: Gaussian still renders, no CP2K truncation radius
const zero = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
cases.push([build(['gaussian', 'cp2k'], { cp2k: { isolated: true } }), { ...conf, lattice: zero }, {}])
cases.push([build(['gaussian'], {}, { custom: { gaussian: { '{tag}.dat': '[{cp2k_hf_cutoff}] {cell_note}\n{cell_ang}\n' } } }), { ...conf, lattice: zero }, {}])
// 8: CP2K user species table with AUX_FIT, isolated padding 7.5
const kinds = { C: { basis: 'TZV2P-MOLOPT-GTH', potential: 'GTH-PBE', aux: 'cpFIT3' }, O: { basis: 'TZV2P-MOLOPT-GTH', potential: 'GTH-PBE', aux: 'cpFIT3' }, H: { basis: 'TZV2P-MOLOPT-GTH', potential: 'GTH-PBE', aux: 'cpFIT3' }, N: { basis: 'TZV2P-MOLOPT-GTH', potential: 'GTH-PBE', aux: 'cpFIT3' } }
cases.push([build(['cp2k', 'qe'], { cp2k: { functional: 'pbe0', isolated: true, padding: 7.5, species: kinds }, qe: { isolated: true, padding: 7.5 } }), conf, {}])
// 9: broken-symmetry singlet forces an unrestricted reference regardless of the configured reference;
// higher multiplicities keep the configured reference (restricted open-shell here) as before.
cases.push([build(['gaussian'], { gaussian: { reference: 'r', brokenSymmetry: true } }), conf, {}])
// 10-20: native cell blocks and position modes (spec.codes.<code>.cell / .format set directly; Task 3 wires the cards).
const box3 = [[10, 0, 0], [0, 11, 0], [0, 0, 12.5]]
const withFormat = (codes, cards, format, extra = { cell: box3 }) => {
  const spec = build(codes, cards, extra)
  for (const code of codes) spec.codes[code].format = { ...format }
  return spec
}
cases.push([withFormat(['qe'], {}, { cellUnits: 'bohr' }), conf, {}]) // 10
cases.push([withFormat(['qe'], {}, { cellUnits: 'alat' }), conf, {}]) // 11
cases.push([withFormat(['qe'], {}, { positions: 'fractional' }), conf, {}]) // 12
cases.push([build(['cp2k'], {}, { cell: [[0, 10, 0], [-10, 0, 0], [0, 0, 10]] }), conf, {}]) // 13: rotated cell, abc requested
cases.push([withFormat(['cp2k'], {}, { positions: 'fractional' }), conf, {}]) // 14
cases.push([withFormat(['cp2k'], {}, { cellStyle: 'vectors' }), conf, {}]) // 15
cases.push([withFormat(['vasp'], {}, { positions: 'fractional' }), conf, {}]) // 16
cases.push([(() => { const spec = build(['qe', 'vasp'], {}, { cell: box3 }); spec.codes.qe.cell = { rows: [[8, 0, 0], [0, 8, 0], [0, 0, 8]] }; return spec })(), conf, {}]) // 17: custom cell wins over spec.cell
cases.push([(() => { const spec = build(['qe'], { qe: { isolated: true } }, { cell: box3 }); spec.codes.qe.cell = { rows: [[8, 0, 0], [0, 8, 0], [0, 0, 8]] }; return spec })(), conf, {}]) // 18: isolated wins over custom
cases.push([withFormat(['vasp', 'qe'], { vasp: { isolated: true }, qe: { isolated: true } }, { positions: 'fractional', cellUnits: 'bohr' }, {}), conf, {}]) // 19: fractional after centring
cases.push([{ codes: { cp2k: { folder: 'cp2k', files: [{ name: '{tag}.inp', template: '{cell_note}\n{cp2k_cell}\n' }] } }, // 20: legacy CP2K cell text unchanged
  params: { charge: 0, multiplicities: [1], nproc: 6, mem: '4gb', method: 'b3lyp', basis: 'sto-3g', padding: 10 }, masses: QM.MASSES, cell: null }, conf, {}])
cases.push([withFormat(['qe', 'cp2k', 'vasp', 'qbox'], {}, { cellUnits: 'alat', positions: 'fractional' }, {}), { ...conf, lattice }, {}]) // 21: hexagonal lattice everywhere

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
// Broken-symmetry singlet forces an unrestricted reference (guess=mix on a restricted singlet is meaningless).
assert.match(text(1)['sing.dat'], /#p ub3lyp\/6-31\+g\(d,p\) opt freq maxdisk=300gb nosymm scf=tight guess=mix gfinput/); checks++
assert.match(text(1)['doub.dat'], /#p rob3lyp\/[\s\S]*\n-1 2\n/); assert.equal(text(1)['trip.dat'], undefined); checks++
assert.match(text(1)['orca/sing.inp'], /^! RKS /); assert.match(text(1)['orca/trip.inp'], /^! UKS /); checks++
// Species tables, ph.x, VASP POTCAR.spec, MD
assert.match(text(1)['qe/sing.inp'], /  C 12.011 C.pbe-n-kjpaw.UPF\n/); assert.ok(text(1)['qe/ph_trip.inp']); checks++
assert.equal(text(1)['vasp/POTCAR.spec'], 'C\nO_s\nH_h\nN\n'); assert.match(text(1)['vasp/INCAR_sing'], /MDALGO = 2\n/); checks++
// Manual cell wins over nothing; CP2K truncation radius from the cell (min width 10 → 4.9)
assert.match(text(1)['cp2k/sing.inp'], /CUTOFF_RADIUS 4.9000\n/); assert.match(text(1)['cp2k/sing.inp'], /BASIS_SET AUX_FIT cFIT3\n/); checks++
assert.match(text(1)['qe/sing.inp'], /! MONET configuration 4 \(frame 90\), singlet. Cell: applied manual cell.\n/); checks++
// Isolated: centred box. Extent x: -0.54..2.5 (3.04) + 10 = 13.04, centre shift 6.52 - 0.98 = 5.54
// CP2K default: the vacuum box is in the standard orientation → ABC + ALPHA_BETA_GAMMA.
assert.match(text(0)['cp2k/sing.inp'], /    &CELL\n      ABC \[angstrom\] 13.0400000000 [0-9.]+ [0-9.]+\n      ALPHA_BETA_GAMMA 90.000000 90.000000 90.000000\n/); checks++
assert.doesNotMatch(text(0)['cp2k/sing.inp'], /not in the standard orientation/); checks++
assert.match(text(0)['qe/sing.inp'], /ATOMIC_POSITIONS angstrom\nC  5.5400000  /); checks++
assert.match(text(0)['qe/sing.inp'], /Cell: vacuum box = extent \+ 10 A, configuration centred \(isolated system\)./); checks++
// Trajectory lattice per frame
assert.match(text(2)['vasp/POSCAR'], /-4.5500000000  7.8810000000/); assert.match(text(2)['vasp/INCAR_sing_relax'], /# Cell: from the trajectory.\n/); checks++
// Custom template and legacy shape
assert.match(text(3)['sing.dat'], /^\{unknown\} u singlet\nC  0.0000000/); checks++
// Legacy specs render as before this plan: Gaussian keeps the raw coordinates, QE gets the uncentred box and old note.
const raw = conf.symbols.map((s, i) => `${s}  ${conf.positions[i].map(v => v.toFixed(7)).join('  ')}\n`).join('')
assert.equal(text(4)['conf4_sing.gjf'], `4gb 666 b3lyp/sto-3g 6\n${raw}`); checks++
assert.equal(text(4)['qe/sing.pwi'].split('\n')[0], 'Cell: orthorhombic box = extent + 10 A padding (no cell in the trajectory).'); checks++
assert.match(text(4)['qe/sing.pwi'], /\n13.0400000000  0.0000000000  0.0000000000\n/); checks++
// Degenerate lattice
assert.match(text(6)['sing.dat'], /\n0 1\nC  0.0000000  0.0000000  0.0000000\n/); assert.match(text(6)['cp2k/sing.inp'], /ABC \[angstrom\] 13.0400000000 /); checks++
assert.match(text(7)['sing.dat'], /^\[\] Cell: from the trajectory.\n0.0000000000  0.0000000000  0.0000000000\n/); checks++
// CP2K user AUX_FIT basis, padding 7.5
assert.match(text(8)['cp2k/sing.inp'], /    &KIND C\n      BASIS_SET TZV2P-MOLOPT-GTH\n      BASIS_SET AUX_FIT cpFIT3\n      POTENTIAL GTH-PBE\n    &END KIND/); checks++
assert.match(text(8)['cp2k/sing.inp'], /ABC \[angstrom\] 10.5400000000 /); assert.match(text(8)['qe/sing.inp'], /Cell: vacuum box = extent \+ 7.5 A, configuration centred/); checks++
// POTCAR runtime and exact NELECT: 4 + 6 + 2·1 + 5 − 1 = 16
assert.equal(text(5)['vasp/POTCAR'], 'PAW C\nPAW O\nPAW H\nPAW N\n'); assert.match(text(5)['vasp/INCAR_doub'], /\nNELECT = 16\n/); checks++
// Case 9: broken-symmetry singlet (reference 'r') → unrestricted for the singlet, restricted open-shell for the triplet.
assert.match(text(9)['sing.dat'], /#p ub3lyp\/6-31\+g\(d,p\) maxdisk=300gb nosymm scf=tight guess=mix gfinput/); checks++
assert.match(text(9)['trip.dat'], /#p rob3lyp\/6-31\+g\(d,p\) maxdisk=300gb nosymm scf=tight gfinput/); checks++
assert.doesNotMatch(text(9)['trip.dat'], /guess=mix/); checks++
assert.match(text(0)['vasp/INCAR_sing'], /\n# Net charge 0: set NELECT = \(sum of ZVAL in POTCAR\) - \(0\) for charged systems.\n/); checks++

// Native cell blocks and position modes.
// QE bohr: cell and Cartesian positions in bohr (10 Å = 18.8972612463 bohr).
assert.ok(text(10)['qe/sing.inp'].includes('CELL_PARAMETERS bohr\n18.8972612463  0.0000000000  0.0000000000\n0.0000000000  20.7869873709  0.0000000000\n')); checks++
assert.ok(text(10)['qe/sing.inp'].includes('ATOMIC_POSITIONS bohr\nC  0.00000000  0.00000000  0.00000000\nO  2.28448991  ')); checks++
assert.ok(text(10)['qe/sing.inp'].includes('  ibrav = 0\n  nat = 5\n')); checks++
// QE alat: celldm(1) = |a| in bohr, rows in units of |a|, positions in Å.
assert.ok(text(11)['qe/sing.inp'].includes('  ibrav = 0\n  celldm(1) = 18.8972612463\n  nat = 5\n')); checks++
assert.ok(text(11)['qe/sing.inp'].includes('CELL_PARAMETERS alat\n1.0000000000  0.0000000000  0.0000000000\n0.0000000000  1.1000000000  0.0000000000\n0.0000000000  0.0000000000  1.2500000000\nATOMIC_POSITIONS angstrom\nC  0.0000000  ')); checks++
// QE crystal: fractional positions, cell still in Å.
assert.ok(text(12)['qe/sing.inp'].includes('CELL_PARAMETERS angstrom\n10.0000000000  0.0000000000  0.0000000000\n')); checks++
assert.ok(text(12)['qe/sing.inp'].includes('ATOMIC_POSITIONS crystal\nC  0.0000000000  0.0000000000  0.0000000000\nO  0.1208900000  -0.0000000091  0.0000000000\n')); checks++
// CP2K hexagonal trajectory lattice (b = |(-4.55, 7.881, 0)| = 9.1001462076 Å, γ = 119.999469°).
assert.ok(text(2)['cp2k/sing.inp'].includes('    &CELL\n      ABC [angstrom] 9.1000000000 9.1001462076 15.0000000000\n      ALPHA_BETA_GAMMA 90.000000 90.000000 119.999469\n')); checks++
// CP2K rotated cell: ABC requested but the cell is not in the standard orientation → vectors and a note.
assert.ok(text(13)['cp2k/sing.inp'].includes('      A [angstrom] 0.0000000000 10.0000000000 0.0000000000\n      B [angstrom] -10.0000000000 0.0000000000 0.0000000000\n      C [angstrom] 0.0000000000 0.0000000000 10.0000000000\n')); checks++
assert.ok(text(13)['cp2k/sing.inp'].startsWith('! MONET configuration 4 (frame 90), singlet. Cell: applied manual cell. Cell written as vectors (not in the standard orientation).\n')); checks++
// CP2K fractional positions: SCALED .TRUE.
assert.ok(text(14)['cp2k/sing.inp'].includes('    &COORD\n      SCALED .TRUE.\nC  0.0000000000  0.0000000000  0.0000000000\nO  0.1208900000  -0.0000000091  0.0000000000\n')); checks++
assert.ok(text(14)['cp2k/sing.inp'].includes('      ABC [angstrom] 10.0000000000 11.0000000000 12.5000000000\n      ALPHA_BETA_GAMMA 90.000000 90.000000 90.000000\n')); checks++
// CP2K vectors requested: A/B/C with units, no note.
assert.ok(text(15)['cp2k/sing.inp'].includes('    &CELL\n      A [angstrom] 10.0000000000 0.0000000000 0.0000000000\n      B [angstrom] 0.0000000000 11.0000000000 0.0000000000\n      C [angstrom] 0.0000000000 0.0000000000 12.5000000000\n')); checks++
assert.doesNotMatch(text(15)['cp2k/sing.inp'], /not in the standard orientation/); checks++
// VASP Direct: mode line of the POSCAR (index 7: comment, scale, 3 vectors, species, counts), fractional coordinates grouped by element.
assert.equal(text(16)['vasp/POSCAR'].split('\n')[7], 'Direct'); checks++
assert.equal(text(16)['vasp/POSCAR'].split('\n').slice(8, 10).join('\n'), '0.0000000000  0.0000000000  0.0000000000\n0.1208900000  -0.0000000091  0.0000000000'); checks++
assert.equal(text(10)['qe/sing.inp'].includes('Direct'), false); assert.equal(text(2)['vasp/POSCAR'].split('\n')[7], 'Cartesian'); checks++
// Custom per-code cell wins over the applied cell (for that code only); isolated wins over the custom cell.
assert.ok(text(17)['qe/sing.inp'].startsWith('! MONET configuration 4 (frame 90), singlet. Cell: custom cell for this code.\n')); checks++
assert.ok(text(17)['qe/sing.inp'].includes('CELL_PARAMETERS angstrom\n8.0000000000  0.0000000000  0.0000000000\n')); checks++
assert.match(text(17)['vasp/INCAR_sing'], /# Cell: applied manual cell.\n/); assert.ok(text(17)['vasp/POSCAR'].includes('\n10.0000000000  0.0000000000  0.0000000000\n')); checks++
assert.match(text(18)['qe/sing.inp'], /Cell: vacuum box = extent \+ 10 A, configuration centred/); assert.ok(text(18)['qe/sing.inp'].includes('CELL_PARAMETERS angstrom\n13.0400000000  ')); checks++
// Fractional positions come from the positions written (centred in the vacuum box): C x = 5.54 / 13.04.
assert.equal(text(19)['vasp/POSCAR'].split('\n')[8].split('  ')[0], '0.4248466258'); checks++
assert.ok(text(19)['qe/sing.inp'].includes('CELL_PARAMETERS bohr\n24.6420286651  0.0000000000  0.0000000000\n')); assert.ok(text(19)['qe/sing.inp'].includes('ATOMIC_POSITIONS crystal\nC  0.4248466258  ')); checks++
// Legacy specs keep the old CP2K cell text (A/B/C, no unit).
assert.equal(text(20)['cp2k/sing.inp'], 'Cell: orthorhombic box = extent + 10 A padding (no cell in the trajectory).\n      A 13.0400000000 0.0000000000 0.0000000000\n      B 0.0000000000 12.0550000000 0.0000000000\n      C 0.0000000000 0.0000000000 13.0000005010\n'); checks++
// Hexagonal lattice with alat + crystal; Qbox stays in bohr.
assert.ok(text(21)['qe/sing.inp'].includes('CELL_PARAMETERS alat\n1.0000000000  0.0000000000  0.0000000000\n-0.5000000000  0.8660439560  0.0000000000\n')); checks++
assert.ok(text(21)['qe/sing.inp'].includes('  celldm(1) = 17.1965077341\n')); checks++
assert.equal(text(21)['vasp/POSCAR'].split('\n')[7], 'Direct'); assert.match(text(21)['cp2k/sing.inp'], /SCALED \.TRUE\./); checks++
assert.ok(text(21)['qbox/sing.i'].includes(`set cell ${lattice.flat().map(v => (v / 0.529177210903).toFixed(8)).join(' ')}\n`)); checks++

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

// Degenerate cell only found lazily (e.g. a near-collinear trajectory lattice in CP2K ABC mode, where
// isStandardOrientation is satisfied but the volume is not): both engines label the error with the code
// and configuration, identically, rather than surfacing the bare units-module message.
{
  const nearCollinear = [[10, 0, 0], [10, 1e-15, 0], [0, 0, 10]]
  const degenerate = build(['cp2k'], {}, { cell: nearCollinear })
  assert.throws(() => QM.render(QM.validate(degenerate), conf), /^Error: CP2K: configuration 4: The cell is degenerate \(zero volume\)\.$/); checks++
  assert.throws(() => execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
spec, conf = json.load(sys.stdin)
monet_qm.render(monet_qm.validate(spec), conf)
`, root], { input: JSON.stringify([degenerate, conf]), stdio: 'pipe' }), error => /ValueError: CP2K: configuration 4: The cell is degenerate \(zero volume\)\./.test(String(error.stderr))); checks++
}

// Missing ZVAL: both engines refuse with the same message.
const noZval = [build(['vasp'], { vasp: { isolated: true } }), conf, { potcar: { text: 'PAW\n', zval: { C: 4, O: 6, H: 1 } } }]
assert.throws(() => QM.render(QM.validate(noZval[0]), noZval[1], noZval[2]), /^Error: VASP: no ZVAL for N in the POTCAR\.$/); checks++
assert.throws(() => execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
spec, conf, runtime = json.load(sys.stdin)
monet_qm.render(monet_qm.validate(spec), conf, runtime)
`, root], { input: JSON.stringify(noZval), stdio: 'pipe' }), error => /ValueError: VASP: no ZVAL for N in the POTCAR\./.test(String(error.stderr))); checks++

// The ZVAL check belongs to VASP only: Gaussian + VASP fails because of VASP, Gaussian alone renders.
const both = [build(['gaussian', 'vasp'], { vasp: { isolated: true } }), conf, noZval[2]]
const gaussianOnly = [build(['gaussian'], {}), conf, noZval[2]]
assert.throws(() => QM.render(QM.validate(structuredClone(both[0])), both[1], both[2]), /^Error: VASP: no ZVAL for N in the POTCAR\.$/); checks++
assert.equal(QM.render(QM.validate(structuredClone(gaussianOnly[0])), gaussianOnly[1], gaussianOnly[2]).length, 2); checks++
const pyZval = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
out = []
for spec, conf, runtime in json.load(sys.stdin):
    try:
        out.append([list(item) for item in monet_qm.render(monet_qm.validate(spec), conf, runtime)])
    except ValueError as error:
        out.append(str(error))
print(json.dumps(out))
`, root], { input: JSON.stringify([both, gaussianOnly]) }))
assert.equal(pyZval[0], 'VASP: no ZVAL for N in the POTCAR.'); checks++
assert.deepEqual(pyZval[1], QM.render(QM.validate(structuredClone(gaussianOnly[0])), gaussianOnly[1], gaussianOnly[2]).map(file => [file.path, file.text])); checks++

// Validation (JS and Python reject the same specs)
const legacySpec = () => ({ codes: { gaussian: { files: [{ name: '{tag}.dat', template: '{coords}' }] } }, params: { charge: 0, multiplicities: [1], nproc: 6, mem: '4gb', method: 'b3lyp', basis: 'sto-3g', padding: 10 }, masses: QM.MASSES, cell: null })
const rejected = [
  Object.assign(QM.defaultSpec(), { masses: { C: '12/0' } }),
  Object.assign(QM.defaultSpec(), { masses: { C: -12 } }),
  Object.assign(QM.defaultSpec(), { masses: { C: '12.0\nX' } }),
  Object.assign(QM.defaultSpec(), { cell: [[10, 0, 0], [0, 10, 0], [0, 0, '10']] }),
  Object.assign(QM.defaultSpec(), { cell: [[10, 0, 0], [0, 10, 0], [0, 0, null]] }),
  (() => { const spec = legacySpec(); spec.params.method = 'b3lyp/x'; return spec })(),
  (() => { const spec = legacySpec(); spec.params.basis = 'sto-3g\\x'; return spec })(),
  (() => { const spec = legacySpec(); spec.params.mem = '4gb\n%x'; return spec })(),
  // Cell format and custom per-code cell
  (() => { const spec = QM.defaultSpec(['qe']); spec.codes.qe.format = { cellUnits: 'nm' }; return spec })(),
  (() => { const spec = QM.defaultSpec(['cp2k']); spec.codes.cp2k.format = { cellStyle: 'matrix' }; return spec })(),
  (() => { const spec = QM.defaultSpec(['vasp']); spec.codes.vasp.format = { positions: 'direct' }; return spec })(),
  (() => { const spec = QM.defaultSpec(['vasp']); spec.codes.vasp.format = 'fractional'; return spec })(),
  (() => { const spec = QM.defaultSpec(['qe']); spec.codes.qe.cell = { rows: [[8, 0], [0, 8], [0, 0]] }; return spec })(),
  (() => { const spec = QM.defaultSpec(['qe']); spec.codes.qe.cell = { rows: [[8, 0, 0], [0, 8, 0], [0, 0, '8']] }; return spec })(),
  (() => { const spec = QM.defaultSpec(['qe']); spec.codes.qe.cell = { rows: [[8, 0, 0], [0, 8, 0], [0, 0, Infinity]] }; return spec })(),
  (() => { const spec = QM.defaultSpec(['qe']); spec.codes.qe.cell = [[8, 0, 0], [0, 8, 0], [0, 0, 8]]; return spec })(),
  (() => { const spec = QM.defaultSpec(['qe']); spec.codes.qe.cell = { rows: [[8, 0, 0], [16, 0, 0], [0, 0, 8]] }; return spec })()
]
const accepted = [Object.assign(QM.defaultSpec(), { masses: { C: 12.011, O: '15.999' } }), legacySpec(),
  (() => { const spec = QM.defaultSpec(['qe', 'cp2k']); spec.codes.qe.cell = { rows: [[8, 0, 0], [0, 8, 0], [0, 0, 8]] }; spec.codes.qe.format = { cellUnits: 'alat', positions: 'fractional' }; spec.codes.cp2k.format = { cellStyle: 'vectors', cellUnits: 'angstrom', positions: 'cartesian' }; return spec })()]
const pyValid = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
out = []
for spec in json.load(sys.stdin):
    try:
        monet_qm.validate(spec); out.append(True)
    except ValueError:
        out.append(False)
print(json.dumps(out))
`, root], { input: JSON.stringify([...rejected, ...accepted]) }))
for (const spec of rejected) { assert.throws(() => QM.validate(structuredClone(spec))); checks++ }
for (const spec of accepted) { QM.validate(structuredClone(spec)); checks++ }
assert.deepEqual(pyValid, [...rejected.map(() => false), ...accepted.map(() => true)]); checks++
// normalize fills the cell/format defaults (missing keys only) in both engines.
{
  const spec = QM.defaultSpec(['qe', 'vasp']); delete spec.codes.qe.cell; delete spec.codes.qe.format; spec.codes.vasp.format = { positions: 'fractional' }
  const pyNorm = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
spec = monet_qm.normalize(json.load(sys.stdin))
print(json.dumps({code: [entry['cell'], entry['format']] for code, entry in spec['codes'].items()}))
`, root], { input: JSON.stringify(spec) }))
  QM.normalize(spec)
  assert.deepEqual([spec.codes.qe.cell, spec.codes.qe.format], [null, { cellUnits: 'angstrom', cellStyle: 'abc', positions: 'cartesian' }]); checks++
  assert.deepEqual(spec.codes.vasp.format, { cellUnits: 'angstrom', cellStyle: 'abc', positions: 'fractional' }); checks++
  assert.deepEqual(pyNorm, { qe: [spec.codes.qe.cell, spec.codes.qe.format], vasp: [spec.codes.vasp.cell, spec.codes.vasp.format] }); checks++
}
// Degenerate custom cell: same message in both engines.
{
  const spec = QM.defaultSpec(['qe']); spec.codes.qe.cell = { rows: [[8, 0, 0], [16, 0, 0], [0, 0, 8]] }
  assert.throws(() => QM.validate(structuredClone(spec)), /^Error: Quantum ESPRESSO \(pw\.x\): The cell is degenerate \(zero volume\)\.$/); checks++
  assert.throws(() => execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
monet_qm.validate(json.load(sys.stdin))
`, root], { input: JSON.stringify(spec), stdio: 'pipe' }), error => /ValueError: Quantum ESPRESSO \(pw\.x\): The cell is degenerate \(zero volume\)\./.test(String(error.stderr))); checks++
}
// Cell values are bounded (|v| ≤ 10000 Å) and enum errors print lists like JavaScript's String(array): same messages in both engines.
{
  const custom = rows => { const spec = QM.defaultSpec(['qe']); spec.codes.qe.cell = { rows }; return spec }
  const format = (code, value) => { const spec = QM.defaultSpec([code]); spec.codes[code].format = value; return spec }
  const cases = [
    custom([[10001, 0, 0], [0, 8, 0], [0, 0, 8]]),
    custom([[8, 0, 0], [0, 8, 0], [0, -2e4, 8]]),
    Object.assign(QM.defaultSpec(['gaussian']), { cell: [[2e4, 0, 0], [0, 10, 0], [0, 0, 10]] }),
    custom([[1e4, 0, 0], [0, 8, 0], [0, 0, 8]]),
    format('qe', { cellUnits: ['nm', 'pm'] }),
    format('cp2k', { cellStyle: [[1, 2], [3]] }),
    format('vasp', { positions: [null, 'x', true, 1.5] })
  ]
  const jsMessages = cases.map(spec => { try { QM.validate(structuredClone(spec)); return null } catch (error) { return error.message } })
  assert.deepEqual(jsMessages, [
    'Quantum ESPRESSO (pw.x): Cell values must be at most 10000 Å.',
    'Quantum ESPRESSO (pw.x): Cell values must be at most 10000 Å.',
    'Cell values must be at most 10000 Å.',
    null,
    'Quantum ESPRESSO (pw.x): Unknown cell units nm,pm.',
    'CP2K: Unknown cell style 1,2,3.',
    'VASP: Unknown position mode ,x,true,1.5.'
  ]); checks++
  const pyMessages = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
out = []
for spec in json.load(sys.stdin):
    try:
        monet_qm.validate(spec); out.append(None)
    except ValueError as error:
        out.append(str(error))
print(json.dumps(out))
`, root], { input: JSON.stringify(cases) }))
  assert.deepEqual(pyMessages, jsMessages); checks++
}
for (const bad of [{ multiplicities: [] }, { multiplicities: [1, 1] }, { charge: 0.5 }]) {
  const spec = QM.defaultSpec(); Object.assign(spec.common, bad)
  assert.throws(() => QM.validate(spec)); checks++
}
{ const spec = QM.defaultSpec(['qe']); spec.codes.qe.species = { O: 'O.UPF\nevil' }; assert.throws(() => QM.validate(spec)); checks++ }
{ const spec = QM.defaultSpec(['gaussian']); spec.codes.gaussian.reference = 'x'; assert.throws(() => QM.validate(spec)); checks++ }
const evil = QM.defaultSpec(); evil.codes.gaussian.files[0].name = '../x'
assert.throws(() => QM.validate(evil)); checks++
// POTCAR assembly from a local library (launcher writer and desktop helper).
{
  const fs = require('node:fs')
  const os = require('node:os')
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'potcar-'))
  for (const [variant, zval] of [['O_s', 6], ['H', 1], ['C', 4]]) {
    fs.mkdirSync(path.join(lib, variant))
    fs.writeFileSync(path.join(lib, variant, 'POTCAR'), `  PAW_PBE ${variant}\n   POMASS =   1.000; ZVAL   =    ${zval}.000    mass and valenz\nEnd of Dataset\n`)
  }
  const io = { read: f => fs.readFileSync(f, 'utf8'), join: path.join, real: f => fs.realpathSync(f), sep: path.sep }
  const js = QM.loadPotcar(lib, ['O_s', 'H', 'C'], io)
  assert.deepEqual(js.zval, [6, 1, 4]); assert.match(js.text, /PAW_PBE O_s[\s\S]*PAW_PBE H[\s\S]*PAW_PBE C/); checks++
  assert.throws(() => QM.loadPotcar(lib, ['N'], io), /POTCAR variant N not found/); checks++
  assert.throws(() => QM.loadPotcar(lib, ['../x'], io), /Invalid POTCAR variant/); checks++
  const out = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
text, zval = monet_qm.load_potcar(sys.argv[2], ['O_s', 'H', 'C'])
print(json.dumps([text, zval]))
`, root, lib]))
  assert.deepEqual(out, [js.text, js.zval]); checks++
  // Writer end to end: extract command through ase_bridge.py writes POTCAR and NELECT per configuration.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-extract-'))
  const xyz = path.join(outDir, 'w.xyz')
  fs.writeFileSync(xyz, '3\nframe 0\nO 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n3\nframe 1\nO 0 0 0.1\nH 0.96 0 0\nH -0.24 0.93 0\n')
  const spec = { ...R.buildSpec({ codes: ['vasp', 'qe'], common: { charge: -1, multiplicities: [2] }, symbols: ['O', 'H', 'H'], cell: null,
    cards: { vasp: { isolated: true, buildPotcar: true, potcarLibrary: lib, species: { O: 'O_s', H: 'H' } }, qe: { isolated: true, calc: 'freq', phx: true } } }), masses: QM.MASSES }
  execFileSync(process.env.PYTHON || 'python3', [path.join(root, 'ase_bridge.py')], { input: JSON.stringify({ action: 'extract', filename: xyz, output_dir: path.join(outDir, 'out'), selected: [1, 2, 3], frequency: 1, compute_average: false, qm: spec }) })
  const conf1 = path.join(outDir, 'out/2-SAMPLED_CONFIGURATIONS/conf1')
  assert.match(fs.readFileSync(path.join(conf1, 'vasp/POTCAR'), 'utf8'), /PAW_PBE O_s[\s\S]*PAW_PBE H/); checks++
  assert.match(fs.readFileSync(path.join(conf1, 'vasp/INCAR_doub'), 'utf8'), /\nNELECT = 9\n/); checks++
  assert.ok(fs.existsSync(path.join(conf1, 'vasp/KPOINTS'))); assert.ok(fs.existsSync(path.join(conf1, 'vasp/POTCAR.spec'))); assert.ok(fs.existsSync(path.join(conf1, 'qe/ph_doub.inp'))); checks++
  const bad = { ...spec, codes: { ...spec.codes, vasp: { ...spec.codes.vasp, species: { O: 'O_h', H: 'H' } } } }
  const failed = execFileSync(process.env.PYTHON || 'python3', [path.join(root, 'ase_bridge.py')], { input: JSON.stringify({ action: 'extract', filename: xyz, output_dir: path.join(outDir, 'bad'), selected: [1, 2, 3], frequency: 1, compute_average: false, qm: bad }) }).toString()
  assert.match(failed, /POTCAR variant O_h not found/); assert.ok(!fs.existsSync(path.join(outDir, 'bad/2-SAMPLED_CONFIGURATIONS/conf1'))); checks++
  // Validation runs before preflight: a malformed spec fails with the validation message, not a POTCAR
  // error, even when the library/variant is also broken (fail-fast still happens before extraction).
  const malformed = { ...spec, codes: { ...spec.codes, vasp: { ...spec.codes.vasp, species: { O: 'O_s\nEVIL', H: 'H' }, potcar: { library: path.join(outDir, 'no-such-library') } } } }
  const malformedOut = execFileSync(process.env.PYTHON || 'python3', [path.join(root, 'ase_bridge.py')], { input: JSON.stringify({ action: 'extract', filename: xyz, output_dir: path.join(outDir, 'malformed'), selected: [1, 2, 3], frequency: 1, compute_average: false, qm: malformed }) }).toString()
  assert.match(malformedOut, /Invalid pseudopotential entry for O/); checks++
  assert.doesNotMatch(malformedOut, /POTCAR variant|no-such-library/); checks++
  assert.ok(!fs.existsSync(path.join(outDir, 'malformed/2-SAMPLED_CONFIGURATIONS/conf1'))); checks++
}

console.log(`PASS: ${checks} QM input checks (JS/Python parity per code, legacy Gaussian, cells, species, POTCAR).`)

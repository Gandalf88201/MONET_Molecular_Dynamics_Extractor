'use strict'
// Code-level keyword mapping of the quantum-chemistry cards (qm-resolve.js).
const assert = require('node:assert/strict')
const R = require('../qm-resolve.js')
let checks = 0
const one = (code, partial) => R.resolve(code, R.settingsFor(code, partial))
const text = (code, partial, i = 0) => one(code, partial)[i].template

// Gaussian: the default card is the legacy template (engine fills {ref} = u, {guess} = '').
assert.deepEqual(one('gaussian', {}).map(f => f.name), ['{tag}.dat']); checks++
assert.equal(text('gaussian', {}), '%nproc=6\n%chk={chk}\n%mem=4gb\n#p {ref}b3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight{guess} gfinput gfoldprint pop=full\n\nscf_{state}\n\n{charge} {mult}\n{coords}\n'); checks++
assert.match(text('gaussian', { calc: 'optfreq' }), /\/6-31\+g\(d,p\) opt freq maxdisk/); assert.match(text('gaussian', { calc: 'optfreq' }), /\n\noptfreq_\{state\}\n/); checks++
assert.match(text('gaussian', { calc: 'td', nstates: 6 }), / td=\(nstates=6\) maxdisk/); checks++
assert.match(text('gaussian', { calc: 'md', md: { timestep: 0.25, steps: 500 } }), / admp\(maxpoints=500,stepsize=2500\) maxdisk/); checks++
assert.match(text('gaussian', { dispersion: 'd3bj', solvent: 'water', scf: 'verytight', extra: 'int=ultrafine' }), /scf=verytight empiricaldispersion=gd3bj scrf=\(smd,solvent=water\)\{guess\} gfinput gfoldprint pop=full int=ultrafine\n/); checks++
assert.match(text('gaussian', { nproc: 12, mem: '32gb', method: 'pbe0', basis: 'def2tzvp' }), /^%nproc=12\n%chk=\{chk\}\n%mem=32gb\n#p \{ref\}pbe0\/def2tzvp /); checks++

// ORCA
assert.deepEqual(one('orca', {}).map(f => f.name), ['{tag}.inp']); checks++
assert.equal(text('orca', {}), '! {ks} b3lyp 6-31+g(d,p) TightSCF\n%pal nprocs 6 end\n%maxcore 500\n# MONET configuration {index} (frame {frame}), {state}\n* xyz {charge} {mult}\n{coords}*\n'); checks++
assert.match(text('orca', { maxcorePct: 100, mem: '8gb', nproc: 4 }), /%maxcore 2000\n/); checks++
assert.match(text('orca', { calc: 'optfreq', dispersion: 'd4', solvent: 'water', scf: 'verytight', extra: 'RIJCOSX def2/J' }), /^! \{ks\} b3lyp 6-31\+g\(d,p\) Opt Freq D4 CPCM\(water\) VeryTightSCF RIJCOSX def2\/J\n/); checks++
assert.match(text('orca', { calc: 'td', nstates: 8 }), /%maxcore 500\n%tddft nroots 8 end\n# MONET/); checks++
assert.match(text('orca', { calc: 'md' }), /^! \{ks\} b3lyp 6-31\+g\(d,p\) MD TightSCF\n[\s\S]*%md\n  Timestep 0.5_fs\n  Initvel 300_K\n  Thermostat CSVR 300_K Timecon 100_fs\n  Run 1000\nend\n# MONET/); checks++
assert.doesNotMatch(text('orca', { calc: 'md', md: { ensemble: 'nve' } }), /Thermostat/); checks++
assert.equal(R.memoryMB('4gb'), 4000); assert.equal(R.memoryMB('500mb'), 500); assert.equal(R.memoryMB('junk'), 4000); checks++
assert.throws(() => R.resolve('gaussian', R.settingsFor('gaussian', { calc: 'vcrelax' })), /not available for Gaussian/); checks++

// Quantum ESPRESSO
assert.deepEqual(one('qe', {}).map(f => f.name), ['{tag}.inp']); checks++
assert.equal(text('qe', {}), "! MONET configuration {index} (frame {frame}), {state}. {cell_note}\n&CONTROL\n  calculation = 'scf'\n  prefix = '{tag}_conf{index}'\n  pseudo_dir = './pseudo'\n  outdir = './tmp'\n/\n&SYSTEM\n  ibrav = 0\n  nat = {nat}\n  ntyp = {ntyp}\n  ecutwfc = 50\n  ecutrho = 200\n  tot_charge = {charge}\n  nspin = {nspin}\n{qe_magnetization}/\n&ELECTRONS\n  conv_thr = 1.0d-8\n/\nATOMIC_SPECIES\n{qe_species}\nCELL_PARAMETERS angstrom\n{cell_ang}\nATOMIC_POSITIONS angstrom\n{coords}K_POINTS gamma\n"); checks++
assert.deepEqual(one('qe', { calc: 'optfreq', phx: true }).map(f => f.name), ['{tag}.inp', 'ph_{tag}.inp']); checks++
assert.match(text('qe', { calc: 'optfreq', phx: true }), /calculation = 'relax'[\s\S]*\/\n&IONS\n\/\nATOMIC_SPECIES/); checks++
assert.equal(text('qe', { calc: 'freq', phx: true }, 1), "MONET configuration {index} (frame {frame}), {state}: Gamma-point phonons after pw.x (apply the acoustic sum rule with dynmat.x)\n&INPUTPH\n  prefix = '{tag}_conf{index}'\n  outdir = './tmp'\n  fildyn = '{tag}_conf{index}.dyn'\n  tr2_ph = 1.0d-14\n/\n0.0 0.0 0.0\n"); checks++
assert.deepEqual(one('qe', { calc: 'freq', phx: false }).map(f => f.name), ['{tag}.inp']); checks++
assert.match(text('qe', { calc: 'vcrelax', pressure: 1.5 }), /calculation = 'vc-relax'[\s\S]*&IONS\n\/\n&CELL\n  cell_dofree = 'all'\n  press = 15\n\/\nATOMIC_SPECIES/); checks++
assert.match(text('qe', { calc: 'vcrelax', pressure: 0.3 }), /  press = 3\n/); checks++
assert.match(text('qe', { calc: 'md' }), /calculation = 'md'\n  prefix = '\{tag\}_conf\{index\}'\n  pseudo_dir = '.\/pseudo'\n  outdir = '.\/tmp'\n  dt = 10.3353\n  nstep = 1000\n\/\n/); checks++
assert.match(text('qe', { calc: 'md' }), /&IONS\n  ion_temperature = 'svr'\n  tempw = 300\n  nraise = 200\n\/\n/); checks++
assert.match(text('qe', { calc: 'md', md: { ensemble: 'nve' } }), /&IONS\n  ion_temperature = 'not_controlled'\n\/\n/); checks++
assert.match(text('qe', { functional: 'pbe0', dispersion: 'd3bj', isolated: true, extra: 'nbnd = 40; occupations = "fixed"', ecutwfc: 60, ecutrhoFactor: 8, pseudoDir: '/pp' }), /pseudo_dir = '\/pp'[\s\S]*ecutwfc = 60\n  ecutrho = 480\n[\s\S]*\{qe_magnetization\}  input_dft = 'pbe0'\n  vdw_corr = 'dft-d3'\n  dftd3_version = 4\n  assume_isolated = 'mt'\n  nbnd = 40\n  occupations = "fixed"\n\/\n/); checks++
assert.match(text('qe', { kpoints: 'grid', grid: [4, 4, 2] }), /\{coords\}K_POINTS automatic\n4 4 2 0 0 0\n$/); checks++

// ph.x refuses K_POINTS gamma: Γ + ph.x on a Freq/Opt+Freq calculation becomes a 1x1x1 automatic mesh.
assert.match(text('qe', { calc: 'freq', phx: true }), /\{coords\}K_POINTS automatic\n1 1 1 0 0 0\n$/); checks++
assert.match(text('qe', { calc: 'optfreq', phx: true }), /\{coords\}K_POINTS automatic\n1 1 1 0 0 0\n$/); checks++
assert.match(text('qe', { calc: 'freq', phx: false }), /\{coords\}K_POINTS gamma\n$/); checks++
assert.match(text('qe', { calc: 'sp', phx: true }), /\{coords\}K_POINTS gamma\n$/); checks++ // phx only forces the mesh for Freq/Opt+Freq
assert.match(text('qe', { calc: 'freq', phx: true, kpoints: 'grid', grid: [2, 2, 2] }), /\{coords\}K_POINTS automatic\n2 2 2 0 0 0\n$/); checks++ // an explicit grid wins

// VASP
assert.deepEqual(one('vasp', {}).map(f => f.name), ['POSCAR', 'INCAR_{tag}', 'KPOINTS', 'POTCAR.spec']); checks++
assert.equal(text('vasp', {}, 0), 'MONET configuration {index} (frame {frame}); atoms grouped by element\n1.0\n{cell_ang}\n{vasp_species}\n{vasp_counts}\nCartesian\n{vasp_coords}\n'); checks++
assert.equal(text('vasp', {}, 1), 'SYSTEM = MONET configuration {index} {state}\n# {cell_note}\n{vasp_nelect}\nENCUT = 500\nISPIN = {nspin}\nNUPDOWN = {unpaired}\nISMEAR = 0\nSIGMA = 0.01\nEDIFF = 1E-6\nNSW = 0\n'); checks++
assert.equal(text('vasp', {}, 2), 'MONET k-points\n0\nGamma\n1 1 1\n0 0 0\n'); checks++
assert.equal(text('vasp', { kpoints: 'grid', grid: [3, 3, 1] }, 2), 'MONET k-points\n0\nGamma\n3 3 1\n0 0 0\n'); checks++
assert.equal(text('vasp', {}, 3), '{vasp_potcar_spec}\n'); checks++
assert.deepEqual(one('vasp', { calc: 'optfreq' }).map(f => f.name), ['POSCAR', 'INCAR_{tag}_relax', 'INCAR_{tag}_freq', 'KPOINTS', 'POTCAR.spec']); checks++
assert.match(text('vasp', { calc: 'optfreq' }, 1), /EDIFF = 1E-6\nIBRION = 2\nISIF = 2\nNSW = 200\n$/); checks++
assert.match(text('vasp', { calc: 'optfreq' }, 2), /EDIFF = 1E-6\nIBRION = 5\nNFREE = 2\nPOTIM = 0.015\nNSW = 1\n$/); checks++
assert.match(text('vasp', { calc: 'vcrelax', pressure: 2 }, 1), /IBRION = 2\nISIF = 3\nNSW = 200\nPSTRESS = 20\n$/); checks++
assert.match(text('vasp', { calc: 'md' }, 1), /IBRION = 0\nNSW = 1000\nPOTIM = 0.5\nISYM = 0\nMDALGO = 2\nSMASS = 0\nTEBEG = 300\nTEEND = 300\n$/); checks++
assert.match(text('vasp', { calc: 'md', md: { ensemble: 'nve', temperature: 250 } }, 1), /ISYM = 0\nMDALGO = 1\nANDERSEN_PROB = 0.0\nTEBEG = 250\n$/); checks++
assert.match(text('vasp', { functional: 'hse06', dispersion: 'd3bj', isolated: true, extra: 'LREAL = Auto; ALGO = All', encut: 400 }, 1), /ENCUT = 400\n[\s\S]*NSW = 0\nLHFCALC = .TRUE.\nHFSCREEN = 0.2\nIVDW = 12\nLDIPOL = .TRUE.\nIDIPOL = 4\nDIPOL = 0.5 0.5 0.5\nLREAL = Auto\nALGO = All\n$/); checks++
assert.match(text('vasp', { functional: 'pbe0' }, 1), /NSW = 0\nLHFCALC = .TRUE.\nAEXX = 0.25\n$/); checks++
assert.match(text('vasp', { functional: 'pbesol', dispersion: 'd3' }, 1), /NSW = 0\nGGA = PS\nIVDW = 11\n$/); checks++

// Test ecutrho rounding with floating-point multiplication
assert.match(text('qe', { ecutwfc: 33.3, ecutrhoFactor: 6 }), /  ecutrho = 199.8\n/); checks++


// CP2K
assert.deepEqual(one('cp2k', {}).map(f => f.name), ['{tag}.inp']); checks++
assert.equal(text('cp2k', {}), '! MONET configuration {index} (frame {frame}), {state}. {cell_note}\n&GLOBAL\n  PROJECT {tag}_conf{index}\n  RUN_TYPE ENERGY\n&END GLOBAL\n&FORCE_EVAL\n  METHOD Quickstep\n  &DFT\n    BASIS_SET_FILE_NAME BASIS_MOLOPT\n    POTENTIAL_FILE_NAME GTH_POTENTIALS\n    CHARGE {charge}\n    MULTIPLICITY {mult}\n    UKS {uks}\n    &MGRID\n      CUTOFF 400\n      REL_CUTOFF 60\n    &END MGRID\n    &XC\n      &XC_FUNCTIONAL PBE\n      &END XC_FUNCTIONAL\n    &END XC\n  &END DFT\n  &SUBSYS\n    &CELL\n{cp2k_cell}\n      PERIODIC XYZ\n    &END CELL\n    &COORD\n{coords}    &END COORD\n{cp2k_kinds}\n  &END SUBSYS\n&END FORCE_EVAL\n'); checks++
assert.deepEqual(one('cp2k', { calc: 'optfreq' }).map(f => f.name), ['{tag}_opt.inp', '{tag}_freq.inp']); checks++
assert.match(text('cp2k', { calc: 'optfreq' }, 1), /RUN_TYPE VIBRATIONAL_ANALYSIS\n/); checks++
assert.match(text('cp2k', { calc: 'vcrelax', pressure: 1 }), /RUN_TYPE CELL_OPT\n&END GLOBAL\n&MOTION\n  &CELL_OPT\n    EXTERNAL_PRESSURE 10000\n    TYPE DIRECT_CELL_OPT\n  &END CELL_OPT\n&END MOTION\n&FORCE_EVAL\n  METHOD Quickstep\n  STRESS_TENSOR ANALYTICAL\n  &DFT\n/); checks++
assert.match(text('cp2k', { calc: 'md' }), /RUN_TYPE MD\n&END GLOBAL\n&MOTION\n  &MD\n    ENSEMBLE NVT\n    STEPS 1000\n    TIMESTEP 0.5\n    TEMPERATURE 300\n    &THERMOSTAT\n      TYPE CSVR\n      &CSVR\n        TIMECON 100\n      &END CSVR\n    &END THERMOSTAT\n  &END MD\n&END MOTION\n/); checks++
assert.doesNotMatch(text('cp2k', { calc: 'md', md: { ensemble: 'nve' } }), /THERMOSTAT/); assert.match(text('cp2k', { calc: 'md', md: { ensemble: 'nve' } }), /ENSEMBLE NVE\n/); checks++
// Isolated + k-point grid: PERIODIC NONE means no &KPOINTS block is written (k-points are meaningless for an isolated system).
{ const t = text('cp2k', { isolated: true, kpoints: 'grid', grid: [2, 2, 2], dispersion: 'd3bj', functional: 'blyp', extra: 'SURFACE_DIPOLE_CORRECTION F' })
  assert.doesNotMatch(t, /&KPOINTS/); checks++
  assert.match(t, /    &END MGRID\n    &POISSON\n      PERIODIC NONE\n      PSOLVER MT\n    &END POISSON\n    &XC\n      &XC_FUNCTIONAL BLYP\n      &END XC_FUNCTIONAL\n      &VDW_POTENTIAL\n        POTENTIAL_TYPE PAIR_POTENTIAL\n        &PAIR_POTENTIAL\n          TYPE DFTD3\(BJ\)\n          PARAMETER_FILE_NAME dftd3.dat\n          REFERENCE_FUNCTIONAL BLYP\n        &END PAIR_POTENTIAL\n      &END VDW_POTENTIAL\n    &END XC\n    SURFACE_DIPOLE_CORRECTION F\n  &END DFT\n[\s\S]*PERIODIC NONE\n    &END CELL/); checks++ }
assert.match(text('cp2k', { functional: 'revpbe' }), /      &XC_FUNCTIONAL\n        &PBE\n          PARAMETRIZATION REVPBE\n        &END PBE\n      &END XC_FUNCTIONAL\n/); checks++
{ const pbe0 = text('cp2k', { functional: 'pbe0', hfMemory: 3000 })
  assert.match(pbe0, /    BASIS_SET_FILE_NAME BASIS_MOLOPT\n    BASIS_SET_FILE_NAME BASIS_ADMM\n    POTENTIAL_FILE_NAME GTH_POTENTIALS\n/); checks++
  assert.match(pbe0, /    &AUXILIARY_DENSITY_MATRIX_METHOD\n      METHOD BASIS_PROJECTION\n      ADMM_PURIFICATION_METHOD MO_DIAG\n      EXCH_SCALING_MODEL NONE\n      EXCH_CORRECTION_FUNC PBEX\n    &END AUXILIARY_DENSITY_MATRIX_METHOD\n    &XC\n      &XC_FUNCTIONAL\n        &PBE\n          SCALE_X 0.75\n          SCALE_C 1.0\n        &END PBE\n      &END XC_FUNCTIONAL\n      &HF\n        FRACTION 0.25\n        &SCREENING\n          EPS_SCHWARZ 1.0E-10\n          SCREEN_ON_INITIAL_P FALSE\n        &END SCREENING\n        &INTERACTION_POTENTIAL\n          POTENTIAL_TYPE TRUNCATED\n          CUTOFF_RADIUS \{cp2k_hf_cutoff\}\n          T_C_G_DATA t_c_g.dat\n        &END INTERACTION_POTENTIAL\n        &MEMORY\n          MAX_MEMORY 3000\n        &END MEMORY\n      &END HF\n    &END XC\n/); checks++ }
assert.match(text('cp2k', { functional: 'pbe0', isolated: true }), /POTENTIAL_TYPE COULOMB\n        &END INTERACTION_POTENTIAL/); checks++
{ const b3lyp = text('cp2k', { functional: 'b3lyp' })
  assert.match(b3lyp, /EXCH_CORRECTION_FUNC BECKE88X\n/); assert.match(b3lyp, /      &XC_FUNCTIONAL B3LYP\n      &END XC_FUNCTIONAL\n      &HF\n        FRACTION 0.20\n/); checks++ }
{ const hse = text('cp2k', { functional: 'hse06' })
  assert.match(hse, /        &PBE\n          SCALE_X 0.0\n          SCALE_C 1.0\n        &END PBE\n        &XWPBE\n          SCALE_X -0.25\n          SCALE_X0 1.0\n          OMEGA 0.11\n        &END XWPBE\n/); assert.match(hse, /POTENTIAL_TYPE SHORTRANGE\n          OMEGA 0.11\n/); checks++ }
assert.equal(R.isHybrid('cp2k', 'hse06'), true); assert.equal(R.isHybrid('vasp', 'pbe'), false); assert.equal(R.isHybrid('qe', 'pbe0'), true); checks++

// Qbox
assert.deepEqual(one('qbox', {}).map(f => f.name), ['{tag}.i']); checks++
assert.equal(text('qbox', {}), '# Qbox input generated by MONET: configuration {index} (frame {frame}), {state}\n# Units are bohr. {cell_note}\n# Check net_charge/delta_spin conventions for your Qbox version.\nset cell {qbox_cell}\n{qbox_species}\n{qbox_atoms}\nset ecut 70\nset xc PBE\nset wf_dyn PSDA\nset ecutprec 5\nset net_charge {charge}\nset nspin {nspin}\nset delta_spin {delta_spin}\nrandomize_wf\nrun 0 200 10\nsave {tag}_conf{index}.xml\n'); checks++
assert.match(text('qbox', { calc: 'opt', functional: 'pbe0', ecut: 85 }), /set ecut 85\nset xc PBE0\n[\s\S]*set delta_spin \{delta_spin\}\nset atoms_dyn CG\nrandomize_wf\nrun 50 20 5\n/); checks++
assert.match(text('qbox', { calc: 'vcrelax', pressure: 2 }), /set atoms_dyn CG\nset cell_dyn SD\nset stress ON\nset ref_stress 2 2 2 0 0 0\nrandomize_wf\nrun 50 20 5\n/); checks++
assert.match(text('qbox', { calc: 'md' }), /set atoms_dyn MD\nset dt 20.6707\nset thermostat BDP\nset th_temp 300\nset th_time 4134.1373\nrandomize_wf\nrun 1000 10\n/); checks++
assert.match(text('qbox', { isolated: true, extra: 'set scf_tol 1.e-8' }), /# Units are bohr. \{cell_note\}\n# Check net_charge\/delta_spin conventions for your Qbox version.\n# Isolated system: Qbox applies no Poisson correction; keep the vacuum large.\nset cell[\s\S]*set delta_spin \{delta_spin\}\nset scf_tol 1.e-8\nrandomize_wf\n/); checks++
assert.throws(() => R.resolve('qbox', R.settingsFor('qbox', { calc: 'freq' })), /not available for Qbox/); checks++

// Species tables, spec, report line, readiness
const syms = ['O', 'H', 'H', 'C']
assert.deepEqual(R.defaultSpecies('qe', syms, R.settingsFor('qe')), { O: 'O.UPF', H: 'H.UPF', C: 'C.UPF' }); checks++
assert.deepEqual(R.defaultSpecies('vasp', syms, R.settingsFor('vasp')), { O: 'O', H: 'H', C: 'C' }); checks++
assert.deepEqual(R.defaultSpecies('qbox', ['O'], R.settingsFor('qbox')), { O: 'O_ONCV_PBE-1.0.xml' }); checks++
assert.deepEqual(R.defaultSpecies('cp2k', ['O'], R.settingsFor('cp2k')), { O: { basis: 'DZVP-MOLOPT-SR-GTH', potential: 'GTH-PBE' } }); checks++
assert.deepEqual(R.defaultSpecies('cp2k', ['O'], R.settingsFor('cp2k', { functional: 'b3lyp' })), { O: { basis: 'DZVP-MOLOPT-SR-GTH', potential: 'GTH-BLYP', aux: 'cFIT3' } }); checks++
assert.deepEqual(R.cellWidths([[10, 0, 0], [0, 12, 0], [0, 0, 8]]).map(v => +v.toFixed(6)), [10, 12, 8]); checks++
assert.equal(+R.hfCutoff([[10, 0, 0], [0, 12, 0], [0, 0, 8]]).toFixed(6), 3.9); assert.equal(R.hfCutoff([[20, 0, 0], [0, 20, 0], [0, 0, 20]]), 6); checks++
// Sheared (non-orthogonal) cell: perpendicular widths, not the row lengths.
assert.deepEqual(R.cellWidths([[10, 0, 0], [2, 10, 0], [0, 0, 8]]).map(v => +v.toFixed(6)), [9.805807, 10, 8]); checks++
assert.equal(+R.hfCutoff([[10, 0, 0], [2, 10, 0], [0, 0, 8]]).toFixed(6), 3.9); checks++
{ const spec = R.buildSpec({ codes: ['gaussian', 'vasp'], common: { charge: 0, multiplicities: [1, 3] }, symbols: syms, cell: null,
    cards: { gaussian: { reference: 'auto', brokenSymmetry: true }, vasp: { isolated: true, padding: 12, buildPotcar: true, potcarLibrary: ' /pp ' } }, custom: { vasp: { 'INCAR_{tag}': 'CUSTOM {mult}' } } })
  assert.deepEqual(spec.common, { charge: 0, multiplicities: [1, 3] }); checks++
  assert.equal(spec.codes.gaussian.reference, 'auto'); assert.equal(spec.codes.gaussian.brokenSymmetry, true); assert.equal(spec.codes.gaussian.isolated, null); checks++
  assert.deepEqual(spec.codes.vasp.isolated, { padding: 12 }); assert.deepEqual(spec.codes.vasp.potcar, { library: '/pp' }); assert.deepEqual(spec.codes.vasp.species, { O: 'O', H: 'H', C: 'C' }); checks++
  assert.equal(spec.codes.vasp.files[1].template, 'CUSTOM {mult}'); assert.equal(spec.codes.vasp.files[1].name, 'INCAR_{tag}'); checks++
  assert.equal(spec.codes.vasp.files[0].template === 'CUSTOM {mult}', false); checks++
  assert.equal(spec.summary.gaussian, 'Gaussian: b3lyp/6-31+g(d,p) (auto reference, broken-symmetry singlet), single point, singlet and triplet'); checks++
  assert.equal(spec.summary.vasp, 'VASP: PBE, ENCUT 500 eV, Γ point, single point, isolated (dipole correction, vacuum 12 Å), singlet and triplet'); checks++ }
assert.equal(R.describe('qe', R.settingsFor('qe', { calc: 'md', override: { charge: -1, multiplicities: [2] } }), { charge: 0, multiplicities: [1] }), "QE pw.x: functional from the pseudopotentials, ecutwfc 50 Ry, Γ point, molecular dynamics (NVT, 300 K, 0.5 fs × 1000 steps), charge -1, doublet"); checks++
assert.equal(R.describe('cp2k', R.settingsFor('cp2k', { functional: 'pbe0', kpoints: 'grid', grid: [2, 2, 2], calc: 'vcrelax', pressure: 1 }), { charge: 0, multiplicities: [1] }), 'CP2K: PBE0 (ADMM), CUTOFF 400 Ry, 2×2×2 k-points, variable-cell relaxation (1 GPa), singlet'); checks++
// Isolated CP2K: a k-point grid is never used for PERIODIC NONE, so describe() reports Γ point rather than the grid.
assert.equal(R.describe('cp2k', R.settingsFor('cp2k', { kpoints: 'grid', grid: [2, 2, 2], isolated: true }), { charge: 0, multiplicities: [1] }), 'CP2K: PBE, CUTOFF 400 Ry, Γ point, single point, isolated (MT Poisson solver, vacuum 10 Å), singlet'); checks++
// Gaussian ADMP is NVE only, with no target temperature to report.
assert.equal(R.describe('gaussian', R.settingsFor('gaussian', { calc: 'md' }), { charge: 0, multiplicities: [1] }), 'Gaussian: b3lyp/6-31+g(d,p) (unrestricted), molecular dynamics (NVE, 0.5 fs × 1000 steps), singlet'); checks++
assert.equal(R.describe('orca', R.settingsFor('orca', { calc: 'md' }), { charge: 0, multiplicities: [1] }), 'ORCA: b3lyp/6-31+g(d,p) (unrestricted), molecular dynamics (NVT, 300 K, 0.5 fs × 1000 steps), singlet'); checks++

// Custom templates follow their file name: a calc switch that inserts files keeps each edit on its own file.
{ const custom = { vasp: { KPOINTS: 'MY KPOINTS', 'INCAR_{tag}': 'CUSTOM {mult}' } }
  const spec = R.buildSpec({ codes: ['vasp'], common: { charge: 0, multiplicities: [1] }, symbols: syms, cards: { vasp: { calc: 'optfreq', isolated: true } }, custom })
  const files = spec.codes.vasp.files
  assert.deepEqual(files.map(f => f.name), ['POSCAR', 'INCAR_{tag}_relax', 'INCAR_{tag}_freq', 'KPOINTS', 'POTCAR.spec']); checks++
  assert.equal(files.find(f => f.name === 'KPOINTS').template, 'MY KPOINTS'); checks++
  assert.equal(files.filter(f => f.template === 'CUSTOM {mult}').length, 0); checks++ }

const ready = (codes, cards, ctx) => R.readiness(codes, Object.fromEntries(codes.map(code => [code, { ...R.settingsFor(code, cards[code] || {}), species: (cards[code] || {}).species || R.defaultSpecies(code, ctx.symbols, R.settingsFor(code, cards[code] || {})) }])), ctx)
const noCell = { cell: null, extent: [3, 2, 1], symbols: syms, potcarAvailable: true }
const cubic = { cell: { source: 'applied', rows: [[10, 0, 0], [0, 10, 0], [0, 0, 10]] }, extent: [3, 2, 1], symbols: syms, potcarAvailable: true }
assert.deepEqual(ready(['gaussian', 'orca'], {}, noCell), { blocked: [], warnings: [] }); checks++
assert.deepEqual(ready(['qe'], {}, noCell).blocked, ['Quantum ESPRESSO (pw.x): no cell. Apply a crystal cell (Structure analysis › Cell) or tick “Isolated system: vacuum box”.']); checks++
assert.deepEqual(ready(['qe'], { qe: { isolated: true } }, noCell), { blocked: [], warnings: [] }); checks++
assert.deepEqual(ready(['vasp'], {}, cubic).blocked, []); checks++
assert.deepEqual(ready(['qe'], { qe: { isolated: true, padding: 2 } }, noCell).warnings, ['Quantum ESPRESSO (pw.x): vacuum 2 Å is smaller than the configuration extent (3 Å); isolated-system corrections need a box at least twice the size of the molecule.']); checks++
assert.deepEqual(ready(['qe'], { qe: { species: { O: 'O.UPF', H: '', C: 'C.UPF' } } }, cubic).blocked, ['Quantum ESPRESSO (pw.x): no pseudopotential for H.']); checks++
assert.deepEqual(ready(['cp2k'], { cp2k: { species: { O: { basis: 'X', potential: '' }, H: { basis: 'X', potential: 'Y' }, C: { basis: 'X', potential: 'Y' } } } }, cubic).blocked, ['CP2K: no pseudopotential for O.']); checks++
assert.deepEqual(ready(['gaussian'], { gaussian: { calc: 'td', nstates: 0 } }, noCell).blocked, ['Gaussian: TD-DFT needs at least one excited state.']); checks++
assert.deepEqual(ready(['orca'], { orca: { maxcorePct: 120 } }, noCell).blocked, ['ORCA: maxcore % must be between 1 and 100.']); checks++
assert.deepEqual(ready(['vasp'], { vasp: { kpoints: 'grid', grid: [2, 0, 1] } }, cubic).blocked, ['VASP: k-point grid values must be integers ≥ 1.']); checks++
assert.deepEqual(ready(['qbox'], { qbox: { ecut: 0 } }, cubic).blocked, ['Qbox: the cutoff must be positive.']); checks++
assert.deepEqual(ready(['qbox'], { qbox: { calc: 'freq' } }, cubic).blocked, ['Qbox: Qbox has no built-in vibrational analysis.']); checks++
assert.deepEqual(ready(['vasp'], { vasp: { calc: 'vcrelax', isolated: true } }, noCell).blocked, ['VASP: variable-cell relaxation is not possible with a vacuum box.']); checks++
assert.deepEqual(ready(['cp2k'], { cp2k: { calc: 'md', md: { timestep: 0 } } }, cubic).blocked, ['CP2K: MD needs a positive time step, at least one step and (NVT) a positive temperature.']); checks++
assert.deepEqual(ready(['vasp'], { vasp: { buildPotcar: true } }, cubic).blocked, ['VASP: choose the POTCAR library folder or untick “Build POTCAR”.']); checks++
assert.deepEqual(ready(['vasp'], { vasp: { buildPotcar: true, potcarLibrary: '/pp' } }, { ...cubic, potcarAvailable: false }).blocked, ['VASP: building POTCAR needs the launcher or the desktop app.']); checks++
assert.deepEqual(ready(['orca'], {}, cubic).warnings, ['ORCA: the configuration is written as an isolated cluster without PBC; molecules cut by the box must be made whole first.']); checks++
assert.deepEqual(ready(['vasp'], { vasp: { functional: 'hse06', calc: 'vcrelax' } }, cubic).warnings, ['VASP: hybrid functionals are expensive with plane waves.', 'VASP: raise the cutoff by about 30 % to limit Pulay stress.']); checks++
assert.deepEqual(ready(['cp2k'], { cp2k: { functional: 'pbe0' } }, { ...cubic, cell: { source: 'applied', rows: [[7, 0, 0], [0, 7, 0], [0, 0, 7]] } }).warnings, ['CP2K: hybrid functionals are expensive with plane waves.', 'CP2K: truncation radius 3.4 Å is below 4 Å; the cell is too small for the truncated Coulomb operator.']); checks++

// Gaussian/ORCA: processors and memory are validated (blocking).
assert.deepEqual(ready(['gaussian'], { gaussian: { nproc: 0 } }, noCell).blocked, ['Gaussian: processors must be a positive integer.']); checks++
assert.deepEqual(ready(['gaussian'], { gaussian: { nproc: 2.5 } }, noCell).blocked, ['Gaussian: processors must be a positive integer.']); checks++
assert.deepEqual(ready(['orca'], { orca: { mem: '4 xb' } }, noCell).blocked, ['ORCA: memory must look like 4gb or 500mb.']); checks++
assert.deepEqual(ready(['gaussian'], { gaussian: { mem: '500mb' } }, noCell).blocked, []); checks++
assert.deepEqual(ready(['gaussian'], { gaussian: { mem: '4' } }, noCell).blocked, ['Gaussian: memory must look like 4gb or 500mb.']); checks++ // a bare number has no unit: Gaussian would read %mem=4 as 4 words

// QE ph.x: warnings (not blocks) for open-shell multiplicities, hybrid functionals and isolated systems.
// These only apply when ph.x is actually written (phx && calc is freq/optfreq — the same condition the qe resolver uses).
// Effective multiplicities come from the card override, or ctx.common when the caller supplies it (backward compatible when absent).
assert.deepEqual(ready(['qe'], { qe: { phx: true, calc: 'freq', isolated: true } }, { ...noCell, common: { charge: 0, multiplicities: [1] } }).warnings, ["Quantum ESPRESSO (pw.x): check that your ph.x version supports assume_isolated='mt'."]); checks++
assert.deepEqual(ready(['qe'], { qe: { phx: true, calc: 'freq' } }, { ...cubic, common: { charge: 0, multiplicities: [1, 3] } }).warnings, ['Quantum ESPRESSO (pw.x): ph.x may not support fixed total magnetization (open-shell multiplicities); check your QE version.']); checks++
assert.deepEqual(ready(['qe'], { qe: { phx: true, calc: 'optfreq', override: { charge: 0, multiplicities: [2] } } }, { ...cubic, common: { charge: 0, multiplicities: [1] } }).warnings, ['Quantum ESPRESSO (pw.x): ph.x may not support fixed total magnetization (open-shell multiplicities); check your QE version.']); checks++
assert.deepEqual(ready(['qe'], { qe: { phx: true, calc: 'freq', functional: 'pbe0' } }, { ...cubic, common: { charge: 0, multiplicities: [1] } }).warnings, ['Quantum ESPRESSO (pw.x): hybrid functionals are expensive with plane waves.', 'Quantum ESPRESSO (pw.x): ph.x does not support hybrid functionals.']); checks++
assert.deepEqual(ready(['qe'], { qe: { phx: true, calc: 'freq' } }, cubic).warnings, []); checks++ // no ctx.common: the multiplicity warning is skipped, not thrown
assert.deepEqual(ready(['qe'], { qe: {} }, { ...cubic, common: { charge: 0, multiplicities: [1, 3] } }).warnings, []); checks++ // phx off: no ph.x warnings at all
assert.deepEqual(ready(['qe'], { qe: { phx: true, calc: 'sp', isolated: true } }, { ...cubic, common: { charge: 0, multiplicities: [1, 3] } }).warnings, []); checks++ // phx true but calc 'sp': ph.x is never written, so no ph.x warnings

// CP2K: k-point grids with an isolated system or an ADMM hybrid (warnings).
assert.deepEqual(ready(['cp2k'], { cp2k: { kpoints: 'grid', grid: [2, 2, 2], isolated: true } }, noCell).warnings, ['CP2K: k-point grids are not used for an isolated system (PERIODIC NONE).']); checks++
assert.deepEqual(ready(['cp2k'], { cp2k: { kpoints: 'grid', grid: [2, 2, 2], functional: 'pbe0' } }, cubic).warnings, ['CP2K: hybrid functionals are expensive with plane waves.', 'CP2K: ADMM hybrids with k-points are expensive and not supported by every CP2K version.']); checks++

console.log(`PASS: ${checks} QM resolve checks (keywords per code, defaults).`)

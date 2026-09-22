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

console.log(`PASS: ${checks} QM resolve checks (keywords per code, defaults).`)

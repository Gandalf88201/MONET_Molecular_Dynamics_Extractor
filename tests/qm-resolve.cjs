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

console.log(`PASS: ${checks} QM resolve checks (Gaussian/ORCA keywords, defaults).`)

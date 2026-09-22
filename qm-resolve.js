'use strict'

// Code-level settings of the quantum-chemistry cards → input templates.
// resolve() fills the [[slot]] values of each code's skeleton once, in the browser; the
// {placeholders} that change per configuration are left for the engines (qm-inputs.js,
// monet_qm.py), which render every extracted configuration identically.
;(function (root) {
  const LABELS = { gaussian: 'Gaussian', orca: 'ORCA', qe: 'Quantum ESPRESSO (pw.x)', vasp: 'VASP', cp2k: 'CP2K', qbox: 'Qbox' }
  const PLANE_WAVE = ['qe', 'vasp', 'cp2k', 'qbox']
  const MOLECULAR_CALCS = ['sp', 'opt', 'optfreq', 'freq', 'td', 'md']
  const PW_CALCS = ['sp', 'opt', 'optfreq', 'freq', 'vcrelax', 'md']
  const CALCS = { gaussian: MOLECULAR_CALCS, orca: MOLECULAR_CALCS, qe: PW_CALCS, vasp: PW_CALCS, cp2k: PW_CALCS, qbox: ['sp', 'opt', 'vcrelax', 'md'] }
  const CALC_LABELS = { sp: 'Single point', opt: 'Geometry optimisation', optfreq: 'Optimisation + frequencies', freq: 'Frequencies', td: 'Excited states (TD-DFT)', vcrelax: 'Variable-cell relaxation', md: 'Molecular dynamics' }
  const RY_FS = 0.048377687
  const HA_FS = 0.0241888433
  const MD = { ensemble: 'nvt', temperature: 300, timestep: 0.5, steps: 1000 }
  const GRID = [1, 1, 1]
  const PW = { isolated: false, padding: 10, pressure: 0, kpoints: 'gamma', grid: GRID, extra: '', species: null, md: MD }
  const DEFAULTS = {
    gaussian: { calc: 'sp', nstates: 10, reference: 'u', brokenSymmetry: false, method: 'b3lyp', basis: '6-31+g(d,p)', dispersion: 'none', solvent: '', scf: 'tight', nproc: 6, mem: '4gb', extra: '', override: null, md: { ...MD, ensemble: 'nve' } },
    orca: { calc: 'sp', nstates: 10, reference: 'u', method: 'b3lyp', basis: '6-31+g(d,p)', dispersion: 'none', solvent: '', scf: 'tight', nproc: 6, mem: '4gb', maxcorePct: 75, extra: '', override: null, md: MD },
    qe: { ...PW, calc: 'sp', phx: false, functional: 'default', ecutwfc: 50, ecutrhoFactor: 4, dispersion: 'none', pseudoDir: './pseudo', override: null },
    vasp: { ...PW, calc: 'sp', functional: 'pbe', encut: 500, dispersion: 'none', buildPotcar: false, potcarLibrary: '', override: null },
    cp2k: { ...PW, calc: 'sp', functional: 'pbe', cutoff: 400, relCutoff: 60, dispersion: 'none', basisFile: 'BASIS_MOLOPT', potentialFile: 'GTH_POTENTIALS', hfMemory: 2000, override: null },
    qbox: { ...PW, calc: 'sp', functional: 'pbe', ecut: 70, override: null }
  }

  function settingsFor (code, partial = {}) {
    if (!DEFAULTS[code]) throw new Error(`Unknown input code ${code}.`)
    const base = DEFAULTS[code]
    return { ...base, ...partial, md: { ...base.md, ...(partial.md || {}) }, grid: [...(partial.grid || base.grid || GRID)] }
  }

  function memoryMB (text) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(gb|mb|g|m)?\s*$/i.exec(String(text))
    if (!match) return 4000
    return Number(match[1]) * (/^g/i.test(match[2] || 'gb') ? 1000 : 1)
  }

  const fixed = (value, digits) => (value + 0).toFixed(digits)
  const fill = (text, slots) => text.replace(/\[\[(\w+)\]\]/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(slots, key)) throw new Error(`Template slot ${key} has no value.`)
    return slots[key]
  })
  const words = text => String(text || '').trim()
  // Unit conversions such as 0.3 GPa × 10 must print 3, not 3.0000000000000004.
  const scaled = (value, factor) => String(Number((value * factor).toPrecision(12)))
  const lines = text => String(text || '').split(/[;\n]/).map(line => line.trim()).filter(Boolean)

  const SKELETONS = {
    gaussian:
`%nproc=[[nproc]]
%chk={chk}
%mem=[[mem]]
#p {ref}[[method]]/[[basis]][[calc]] maxdisk=300gb nosymm scf=[[scf]][[dispersion]][[solvent]]{guess} gfinput gfoldprint pop=full[[extra]]

[[title]]_{state}

{charge} {mult}
{coords}
`,
    orca:
`! {ks} [[method]] [[basis]][[calc]][[dispersion]][[solvent]] [[scf]][[extra]]
%pal nprocs [[nproc]] end
%maxcore [[maxcore]]
[[blocks]]# MONET configuration {index} (frame {frame}), {state}
* xyz {charge} {mult}
{coords}*
`,
    qe:
`! MONET configuration {index} (frame {frame}), {state}. {cell_note}
&CONTROL
  calculation = '[[calculation]]'
  prefix = '{tag}_conf{index}'
  pseudo_dir = '[[pseudo_dir]]'
  outdir = './tmp'
[[control_extra]]/
&SYSTEM
  ibrav = 0
  nat = {nat}
  ntyp = {ntyp}
  ecutwfc = [[ecutwfc]]
  ecutrho = [[ecutrho]]
  tot_charge = {charge}
  nspin = {nspin}
{qe_magnetization}[[system_extra]]/
&ELECTRONS
  conv_thr = 1.0d-8
/
[[ions_cell]]ATOMIC_SPECIES
{qe_species}
CELL_PARAMETERS angstrom
{cell_ang}
ATOMIC_POSITIONS angstrom
{coords}[[kpoints]]`,
    ph:
`MONET configuration {index} (frame {frame}), {state}: Gamma-point phonons after pw.x (apply the acoustic sum rule with dynmat.x)
&INPUTPH
  prefix = '{tag}_conf{index}'
  outdir = './tmp'
  fildyn = '{tag}_conf{index}.dyn'
  tr2_ph = 1.0d-14
/
0.0 0.0 0.0
`,
    vasp_poscar:
`MONET configuration {index} (frame {frame}); atoms grouped by element
1.0
{cell_ang}
{vasp_species}
{vasp_counts}
Cartesian
{vasp_coords}
`,
    vasp_incar:
`SYSTEM = MONET configuration {index} {state}
# {cell_note}
{vasp_nelect}
ENCUT = [[encut]]
ISPIN = {nspin}
NUPDOWN = {unpaired}
ISMEAR = 0
SIGMA = 0.01
EDIFF = 1E-6
[[body]]`,
    vasp_kpoints: 'MONET k-points\n0\nGamma\n[[grid]]\n0 0 0\n',
    vasp_potcar_spec: '{vasp_potcar_spec}\n'
  }

  function checkCalc (code, s) {
    if (!CALCS[code].includes(s.calc)) throw new Error(`${CALC_LABELS[s.calc] || s.calc} is not available for ${LABELS[code]}.`)
  }

  const RESOLVERS = {
    gaussian (s) {
      const calc = { sp: '', opt: ' opt', optfreq: ' opt freq', freq: ' freq', td: ` td=(nstates=${s.nstates})`, md: ` admp(maxpoints=${s.md.steps},stepsize=${Math.round(s.md.timestep * 10000)})` }[s.calc]
      const slots = {
        nproc: String(s.nproc), mem: words(s.mem), method: words(s.method), basis: words(s.basis), calc, scf: s.scf,
        dispersion: { none: '', d3bj: ' empiricaldispersion=gd3bj', d3: ' empiricaldispersion=gd3' }[s.dispersion],
        solvent: words(s.solvent) ? ` scrf=(smd,solvent=${words(s.solvent)})` : '',
        extra: words(s.extra) ? ' ' + words(s.extra) : '',
        title: s.calc === 'sp' ? 'scf' : s.calc
      }
      return [{ name: '{tag}.dat', template: fill(SKELETONS.gaussian, slots) }]
    },
    orca (s) {
      const md = s.md
      const blocks = s.calc === 'td' ? `%tddft nroots ${s.nstates} end\n`
        : s.calc === 'md' ? `%md\n  Timestep ${md.timestep}_fs\n  Initvel ${md.temperature}_K\n${md.ensemble === 'nvt' ? `  Thermostat CSVR ${md.temperature}_K Timecon 100_fs\n` : ''}  Run ${md.steps}\nend\n` : ''
      const slots = {
        method: words(s.method), basis: words(s.basis),
        calc: { sp: '', opt: ' Opt', optfreq: ' Opt Freq', freq: ' Freq', td: '', md: ' MD' }[s.calc],
        dispersion: { none: '', d3bj: ' D3BJ', d4: ' D4' }[s.dispersion],
        solvent: words(s.solvent) ? ` CPCM(${words(s.solvent)})` : '',
        scf: s.scf === 'verytight' ? 'VeryTightSCF' : 'TightSCF',
        extra: words(s.extra) ? ' ' + words(s.extra) : '',
        nproc: String(s.nproc),
        maxcore: String(Math.floor(memoryMB(s.mem) * s.maxcorePct / 100 / Math.max(1, s.nproc))),
        blocks
      }
      return [{ name: '{tag}.inp', template: fill(SKELETONS.orca, slots) }]
    },
    qe (s) {
      const md = s.md
      const kpoints = s.kpoints === 'grid' ? `K_POINTS automatic\n${s.grid.join(' ')} 0 0 0\n` : 'K_POINTS gamma\n'
      const system = [
        ...(s.functional !== 'default' ? [`input_dft = '${s.functional}'`] : []),
        ...(s.dispersion === 'd3bj' ? ["vdw_corr = 'dft-d3'", 'dftd3_version = 4'] : []),
        ...(s.isolated ? ["assume_isolated = 'mt'"] : []),
        ...lines(s.extra)
      ].map(line => `  ${line}\n`).join('')
      const ions = {
        opt: '&IONS\n/\n', optfreq: '&IONS\n/\n',
        vcrelax: `&IONS\n/\n&CELL\n  cell_dofree = 'all'\n  press = ${scaled(s.pressure, 10)}\n/\n`,
        md: md.ensemble === 'nvt'
          ? `&IONS\n  ion_temperature = 'svr'\n  tempw = ${md.temperature}\n  nraise = ${Math.round(100 / md.timestep)}\n/\n`
          : "&IONS\n  ion_temperature = 'not_controlled'\n/\n"
      }[s.calc] || ''
      const slots = {
        calculation: { sp: 'scf', opt: 'relax', optfreq: 'relax', freq: 'scf', vcrelax: 'vc-relax', md: 'md' }[s.calc],
        pseudo_dir: words(s.pseudoDir) || './pseudo',
        control_extra: s.calc === 'md' ? `  dt = ${fixed(md.timestep / RY_FS, 4)}\n  nstep = ${md.steps}\n` : '',
        ecutwfc: String(s.ecutwfc), ecutrho: String(s.ecutwfc * s.ecutrhoFactor),
        system_extra: system, ions_cell: ions, kpoints
      }
      const files = [{ name: '{tag}.inp', template: fill(SKELETONS.qe, slots) }]
      if (s.phx && (s.calc === 'freq' || s.calc === 'optfreq')) files.push({ name: 'ph_{tag}.inp', template: SKELETONS.ph })
      return files
    },
    vasp (s) {
      const md = s.md
      const calcLines = {
        sp: 'NSW = 0\n', opt: 'IBRION = 2\nISIF = 2\nNSW = 200\n', freq: 'IBRION = 5\nNFREE = 2\nPOTIM = 0.015\nNSW = 1\n',
        vcrelax: `IBRION = 2\nISIF = 3\nNSW = 200\nPSTRESS = ${scaled(s.pressure, 10)}\n`,
        md: `IBRION = 0\nNSW = ${md.steps}\nPOTIM = ${md.timestep}\nISYM = 0\n` + (md.ensemble === 'nvt'
          ? `MDALGO = 2\nSMASS = 0\nTEBEG = ${md.temperature}\nTEEND = ${md.temperature}\n`
          : `MDALGO = 1\nANDERSEN_PROB = 0.0\nTEBEG = ${md.temperature}\n`)
      }
      const common = [
        { pbe: '', pbesol: 'GGA = PS\n', pbe0: 'LHFCALC = .TRUE.\nAEXX = 0.25\n', hse06: 'LHFCALC = .TRUE.\nHFSCREEN = 0.2\n' }[s.functional],
        { none: '', d3bj: 'IVDW = 12\n', d3: 'IVDW = 11\n' }[s.dispersion],
        s.isolated ? 'LDIPOL = .TRUE.\nIDIPOL = 4\nDIPOL = 0.5 0.5 0.5\n' : '',
        lines(s.extra).map(line => `${line}\n`).join('')
      ].join('')
      const incar = calc => fill(SKELETONS.vasp_incar, { encut: String(s.encut), body: calcLines[calc] + common })
      const incars = s.calc === 'optfreq'
        ? [{ name: 'INCAR_{tag}_relax', template: incar('opt') }, { name: 'INCAR_{tag}_freq', template: incar('freq') }]
        : [{ name: 'INCAR_{tag}', template: incar(s.calc) }]
      return [
        { name: 'POSCAR', template: SKELETONS.vasp_poscar },
        ...incars,
        { name: 'KPOINTS', template: fill(SKELETONS.vasp_kpoints, { grid: (s.kpoints === 'grid' ? s.grid : [1, 1, 1]).join(' ') }) },
        { name: 'POTCAR.spec', template: SKELETONS.vasp_potcar_spec }
      ]
    }
  }

  function resolve (code, settings) {
    checkCalc(code, settings)
    return RESOLVERS[code](settings)
  }

  const api = { LABELS, PLANE_WAVE, CALCS, CALC_LABELS, DEFAULTS, RY_FS, HA_FS, SKELETONS, settingsFor, memoryMB, resolve, fill, fixed, lines, words, scaled }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetQMResolve = api
})(globalThis)

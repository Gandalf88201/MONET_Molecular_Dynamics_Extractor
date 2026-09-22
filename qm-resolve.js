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

  const HYBRIDS = { qe: ['pbe0', 'hse'], vasp: ['pbe0', 'hse06'], cp2k: ['pbe0', 'b3lyp', 'hse06'], qbox: ['pbe0', 'b3lyp', 'hse'] }
  const isHybrid = (code, functional) => (HYBRIDS[code] || []).includes(functional)
  const CP2K_XC = {
    pbe: '      &XC_FUNCTIONAL PBE\n      &END XC_FUNCTIONAL\n',
    blyp: '      &XC_FUNCTIONAL BLYP\n      &END XC_FUNCTIONAL\n',
    revpbe: '      &XC_FUNCTIONAL\n        &PBE\n          PARAMETRIZATION REVPBE\n        &END PBE\n      &END XC_FUNCTIONAL\n',
    pbe0: '      &XC_FUNCTIONAL\n        &PBE\n          SCALE_X 0.75\n          SCALE_C 1.0\n        &END PBE\n      &END XC_FUNCTIONAL\n',
    b3lyp: '      &XC_FUNCTIONAL B3LYP\n      &END XC_FUNCTIONAL\n',
    hse06: '      &XC_FUNCTIONAL\n        &PBE\n          SCALE_X 0.0\n          SCALE_C 1.0\n        &END PBE\n        &XWPBE\n          SCALE_X -0.25\n          SCALE_X0 1.0\n          OMEGA 0.11\n        &END XWPBE\n      &END XC_FUNCTIONAL\n'
  }
  const CP2K_VDW_REFERENCE = { pbe: 'PBE', blyp: 'BLYP', revpbe: 'revPBE', pbe0: 'PBE0', b3lyp: 'B3LYP', hse06: 'HSE06' }

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
    vasp_potcar_spec: '{vasp_potcar_spec}\n',
    cp2k:
`! MONET configuration {index} (frame {frame}), {state}. {cell_note}
&GLOBAL
  PROJECT {tag}_conf{index}
  RUN_TYPE [[run_type]]
&END GLOBAL
[[motion]]&FORCE_EVAL
  METHOD Quickstep
[[stress]]  &DFT
    BASIS_SET_FILE_NAME [[basis_file]]
[[admm_basis_file]]    POTENTIAL_FILE_NAME [[potential_file]]
    CHARGE {charge}
    MULTIPLICITY {mult}
    UKS {uks}
    &MGRID
      CUTOFF [[cutoff]]
      REL_CUTOFF [[rel_cutoff]]
    &END MGRID
[[poisson]][[kpoints]][[admm]]    &XC
[[xc]][[vdw]][[hf]]    &END XC
[[dft_extra]]  &END DFT
  &SUBSYS
    &CELL
{cp2k_cell}
      PERIODIC [[periodic]]
    &END CELL
    &COORD
{coords}    &END COORD
{cp2k_kinds}
  &END SUBSYS
&END FORCE_EVAL
`,
    qbox:
`# Qbox input generated by MONET: configuration {index} (frame {frame}), {state}
# Units are bohr. {cell_note}
[[isolated_note]]set cell {qbox_cell}
{qbox_species}
{qbox_atoms}
set ecut [[ecut]]
set xc [[xc]]
set wf_dyn PSDA
set ecutprec 5
set net_charge {charge}
set nspin {nspin}
set delta_spin {delta_spin}
[[calc]][[extra]]randomize_wf
run [[run]]
save {tag}_conf{index}.xml
`
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
        ecutwfc: String(s.ecutwfc), ecutrho: scaled(s.ecutwfc, s.ecutrhoFactor),
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
    },
    cp2k (s) {
      const md = s.md
      const hybrid = isHybrid('cp2k', s.functional)
      const potential = s.functional === 'hse06' ? '          POTENTIAL_TYPE SHORTRANGE\n          OMEGA 0.11\n'
        : s.isolated ? '          POTENTIAL_TYPE COULOMB\n'
        : '          POTENTIAL_TYPE TRUNCATED\n          CUTOFF_RADIUS {cp2k_hf_cutoff}\n          T_C_G_DATA t_c_g.dat\n'
      const motion = {
        vcrelax: `&MOTION\n  &CELL_OPT\n    EXTERNAL_PRESSURE ${scaled(s.pressure, 10000)}\n    TYPE DIRECT_CELL_OPT\n  &END CELL_OPT\n&END MOTION\n`,
        md: `&MOTION\n  &MD\n    ENSEMBLE ${md.ensemble.toUpperCase()}\n    STEPS ${md.steps}\n    TIMESTEP ${md.timestep}\n    TEMPERATURE ${md.temperature}\n` +
          (md.ensemble === 'nvt' ? '    &THERMOSTAT\n      TYPE CSVR\n      &CSVR\n        TIMECON 100\n      &END CSVR\n    &END THERMOSTAT\n' : '') + '  &END MD\n&END MOTION\n'
      }[s.calc] || ''
      const slots = {
        motion,
        stress: s.calc === 'vcrelax' ? '  STRESS_TENSOR ANALYTICAL\n' : '',
        basis_file: words(s.basisFile), potential_file: words(s.potentialFile),
        admm_basis_file: hybrid ? '    BASIS_SET_FILE_NAME BASIS_ADMM\n' : '',
        cutoff: String(s.cutoff), rel_cutoff: String(s.relCutoff),
        poisson: s.isolated ? '    &POISSON\n      PERIODIC NONE\n      PSOLVER MT\n    &END POISSON\n' : '',
        kpoints: s.kpoints === 'grid' ? `    &KPOINTS\n      SCHEME MONKHORST-PACK ${s.grid.join(' ')}\n    &END KPOINTS\n` : '',
        admm: hybrid ? `    &AUXILIARY_DENSITY_MATRIX_METHOD\n      METHOD BASIS_PROJECTION\n      ADMM_PURIFICATION_METHOD MO_DIAG\n      EXCH_SCALING_MODEL NONE\n      EXCH_CORRECTION_FUNC ${s.functional === 'b3lyp' ? 'BECKE88X' : 'PBEX'}\n    &END AUXILIARY_DENSITY_MATRIX_METHOD\n` : '',
        xc: CP2K_XC[s.functional],
        vdw: s.dispersion === 'd3bj' ? `      &VDW_POTENTIAL\n        POTENTIAL_TYPE PAIR_POTENTIAL\n        &PAIR_POTENTIAL\n          TYPE DFTD3(BJ)\n          PARAMETER_FILE_NAME dftd3.dat\n          REFERENCE_FUNCTIONAL ${CP2K_VDW_REFERENCE[s.functional]}\n        &END PAIR_POTENTIAL\n      &END VDW_POTENTIAL\n` : '',
        hf: hybrid ? `      &HF\n        FRACTION ${s.functional === 'b3lyp' ? '0.20' : '0.25'}\n        &SCREENING\n          EPS_SCHWARZ 1.0E-10\n          SCREEN_ON_INITIAL_P FALSE\n        &END SCREENING\n        &INTERACTION_POTENTIAL\n${potential}        &END INTERACTION_POTENTIAL\n        &MEMORY\n          MAX_MEMORY ${s.hfMemory}\n        &END MEMORY\n      &END HF\n` : '',
        dft_extra: lines(s.extra).map(line => `    ${line}\n`).join(''),
        periodic: s.isolated ? 'NONE' : 'XYZ'
      }
      const RUN = { sp: 'ENERGY', opt: 'GEO_OPT', freq: 'VIBRATIONAL_ANALYSIS', vcrelax: 'CELL_OPT', md: 'MD' }
      if (s.calc === 'optfreq') {
        return [
          { name: '{tag}_opt.inp', template: fill(SKELETONS.cp2k, { ...slots, run_type: 'GEO_OPT' }) },
          { name: '{tag}_freq.inp', template: fill(SKELETONS.cp2k, { ...slots, run_type: 'VIBRATIONAL_ANALYSIS' }) }
        ]
      }
      return [{ name: '{tag}.inp', template: fill(SKELETONS.cp2k, { ...slots, run_type: RUN[s.calc] }) }]
    },
    qbox (s) {
      const md = s.md
      const P = s.pressure
      const calc = {
        opt: 'set atoms_dyn CG\n',
        vcrelax: `set atoms_dyn CG\nset cell_dyn SD\nset stress ON\nset ref_stress ${P} ${P} ${P} 0 0 0\n`,
        md: `set atoms_dyn MD\nset dt ${fixed(md.timestep / HA_FS, 4)}\n` + (md.ensemble === 'nvt'
          ? `set thermostat BDP\nset th_temp ${md.temperature}\nset th_time ${fixed(100 / HA_FS, 4)}\n` : '')
      }[s.calc] || ''
      const slots = {
        isolated_note: s.isolated ? '# Isolated system: Qbox applies no Poisson correction; keep the vacuum large.\n' : '',
        ecut: String(s.ecut), xc: s.functional.toUpperCase(), calc,
        extra: lines(s.extra).map(line => `${line}\n`).join(''),
        run: { sp: '0 200 10', opt: '50 20 5', vcrelax: '50 20 5', md: `${md.steps} 10` }[s.calc]
      }
      return [{ name: '{tag}.i', template: fill(SKELETONS.qbox, slots) }]
    }
  }

  function resolve (code, settings) {
    checkCalc(code, settings)
    return RESOLVERS[code](settings)
  }

  const api = { LABELS, PLANE_WAVE, CALCS, CALC_LABELS, DEFAULTS, RY_FS, HA_FS, SKELETONS, settingsFor, memoryMB, resolve, fill, fixed, lines, words, scaled, HYBRIDS, isHybrid }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetQMResolve = api
})(globalThis)

'use strict'

// Code-level settings of the quantum-chemistry cards → input templates.
// resolve() fills the [[slot]] values of each code's skeleton once, in the browser; the
// {placeholders} that change per configuration are left for the engines (qm-inputs.js,
// monet_qm.py), which render every extracted configuration identically.
;(function (root) {
  const U = (typeof module === 'object' && module.exports) ? require('./units.js') : root.MonetUnits
  const LABELS = { gaussian: 'Gaussian', orca: 'ORCA', qe: 'Quantum ESPRESSO (pw.x)', vasp: 'VASP', cp2k: 'CP2K', qbox: 'Qbox' }
  const PLANE_WAVE = ['qe', 'vasp', 'cp2k', 'qbox']
  const MOLECULAR_CALCS = ['sp', 'opt', 'optfreq', 'freq', 'td', 'md']
  const PW_CALCS = ['sp', 'opt', 'optfreq', 'freq', 'vcrelax', 'md']
  const CALCS = { gaussian: MOLECULAR_CALCS, orca: MOLECULAR_CALCS, qe: PW_CALCS, vasp: PW_CALCS, cp2k: PW_CALCS, qbox: ['sp', 'opt', 'vcrelax', 'md'] }
  const CALC_LABELS = { sp: 'Single point', opt: 'Geometry optimisation', optfreq: 'Optimisation + frequencies', freq: 'Frequencies', td: 'Excited states (TD-DFT)', vcrelax: 'Variable-cell relaxation', md: 'Molecular dynamics' }
  const RY_FS = U.RY_TIME_FS
  const HA_FS = U.AU_TIME_FS
  const MD = { ensemble: 'nvt', temperature: 300, timestep: 0.5, steps: 1000 }
  const GRID = [1, 1, 1]
  // cellSource/cellCustom: per-card cell, independent of the crystal cell in Structure analysis (plan4-constraints.md).
  // cellCustom is [a, b, c, α, β, γ] in Å/°; positions is Cartesian vs. fractional (qbox ignores it, always bohr Cartesian).
  const PW = { isolated: false, padding: 10, pressure: 0, kpoints: 'gamma', grid: GRID, extra: '', species: null, md: MD, cellSource: 'structure', cellCustom: null, positions: 'cartesian' }
  const DEFAULTS = {
    gaussian: { calc: 'sp', nstates: 10, reference: 'u', brokenSymmetry: false, method: 'b3lyp', basis: '6-31+g(d,p)', dispersion: 'none', solvent: '', scf: 'tight', nproc: 6, mem: '4gb', extra: '', override: null, md: { ...MD, ensemble: 'nve' } },
    orca: { calc: 'sp', nstates: 10, reference: 'u', method: 'b3lyp', basis: '6-31+g(d,p)', dispersion: 'none', solvent: '', scf: 'tight', nproc: 6, mem: '4gb', maxcorePct: 75, extra: '', override: null, md: MD },
    qe: { ...PW, calc: 'sp', phx: false, functional: 'default', ecutwfc: 50, ecutrhoFactor: 4, dispersion: 'none', pseudoDir: './pseudo', override: null, cellUnits: 'angstrom' },
    vasp: { ...PW, calc: 'sp', functional: 'pbe', encut: 500, dispersion: 'none', buildPotcar: false, potcarLibrary: '', override: null },
    cp2k: { ...PW, calc: 'sp', functional: 'pbe', cutoff: 400, relCutoff: 60, dispersion: 'none', basisFile: 'BASIS_MOLOPT', potentialFile: 'GTH_POTENTIALS', hfMemory: 2000, override: null, cellStyle: 'abc' },
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
{qe_celldm}  nat = {nat}
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
{qe_cell_block}
{qe_positions_block}[[kpoints]]`,
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
{vasp_coord_mode}
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
{cp2k_coords}    &END COORD
{cp2k_kinds}
  &END SUBSYS
&END FORCE_EVAL
`,
    qbox:
`# Qbox input generated by MONET: configuration {index} (frame {frame}), {state}
# Units are bohr. {cell_note}
# Check net_charge/delta_spin conventions for your Qbox version.
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
      // ph.x refuses K_POINTS gamma (pw.x's Γ tricks halve the k-point set); force a 1×1×1 mesh instead.
      const phGammaMesh = s.phx && (s.calc === 'freq' || s.calc === 'optfreq') && s.kpoints === 'gamma'
      const kpoints = s.kpoints === 'grid' ? `K_POINTS automatic\n${s.grid.join(' ')} 0 0 0\n`
        : phGammaMesh ? 'K_POINTS automatic\n1 1 1 0 0 0\n'
        : 'K_POINTS gamma\n'
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
        kpoints: s.kpoints === 'grid' && !s.isolated ? `    &KPOINTS\n      SCHEME MONKHORST-PACK ${s.grid.join(' ')}\n    &END KPOINTS\n` : '',
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

  const STATE_NAMES = { 1: 'singlet', 2: 'doublet', 3: 'triplet', 4: 'quartet', 5: 'quintet' }
  const stateList = mults => {
    const names = mults.map(m => STATE_NAMES[m] || `multiplicity ${m}`)
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  }

  function cellWidths (rows) {
    const [a, b, c] = rows
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const norm = v => Math.hypot(v[0], v[1], v[2])
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b)
    const volume = Math.abs(a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2])
    return [volume / norm(bc), volume / norm(ca), volume / norm(ab)]
  }
  const hfCutoff = rows => Math.min(6, Math.min(...cellWidths(rows)) / 2 - 0.1)

  // cellCustom = [a, b, c, α, β, γ] (Å/°): 6 finite numbers, positive lengths, angles strictly between 0° and 180°,
  // and a non-degenerate resulting cell (U.cellParameters throws on zero volume).
  function validCustomCell (cellCustom) {
    if (!Array.isArray(cellCustom) || cellCustom.length !== 6 || !cellCustom.every(v => typeof v === 'number' && Number.isFinite(v))) return false
    const [a, b, c, alpha, beta, gamma] = cellCustom
    if (!(a > 0 && b > 0 && c > 0)) return false
    if (![alpha, beta, gamma].every(v => v > 0 && v < 180)) return false
    try { U.cellParameters(U.cellVectors(cellCustom)) } catch (error) { return false }
    return true
  }

  function defaultSpecies (code, symbols, s) {
    const out = {}
    for (const el of new Set(symbols)) {
      if (code === 'qe') out[el] = `${el}.UPF`
      else if (code === 'vasp') out[el] = el
      else if (code === 'qbox') out[el] = `${el}_ONCV_PBE-1.0.xml`
      else if (code === 'cp2k') {
        out[el] = { basis: 'DZVP-MOLOPT-SR-GTH', potential: ['blyp', 'b3lyp'].includes(s.functional) ? 'GTH-BLYP' : 'GTH-PBE' }
        if (isHybrid('cp2k', s.functional)) out[el].aux = 'cFIT3'
      }
    }
    return out
  }

  const FUNCTIONAL_LABELS = { default: 'functional from the pseudopotentials', pbe: 'PBE', pbesol: 'PBEsol', pbe0: 'PBE0', hse: 'HSE', hse06: 'HSE06', blyp: 'BLYP', revpbe: 'revPBE', b3lyp: 'B3LYP' }
  const REFERENCE_LABELS = { u: 'unrestricted', auto: 'auto reference', r: 'restricted' }
  function calcText (code, s) {
    const md = s.md
    // Gaussian ADMP is NVE only and has no thermostat/target temperature to report.
    if (s.calc === 'md' && code === 'gaussian') return `molecular dynamics (NVE, ${md.timestep} fs × ${md.steps} steps)`
    if (s.calc === 'md') return `molecular dynamics (${md.ensemble.toUpperCase()}, ${md.temperature} K, ${md.timestep} fs × ${md.steps} steps)`
    if (s.calc === 'vcrelax') return `variable-cell relaxation (${s.pressure} GPa)`
    if (s.calc === 'td') return `excited states (TD-DFT, ${s.nstates} states)`
    return CALC_LABELS[s.calc].toLowerCase()
  }
  // rows: the effective cell (Å), when known, for a plane-wave code; appends " cell a×b×c Å (α/β/γ°)".
  // Unknown (no rows, or a degenerate/invalid cell) → no cell text, same as before this cell text existed.
  function describe (code, s, common, rows) {
    const states = s.override || common
    const charge = states.charge ? `, charge ${states.charge}` : ''
    const kp = s.kpoints === 'grid' && !(code === 'cp2k' && s.isolated) ? `${s.grid.join('×')} k-points` : 'Γ point'
    const iso = corr => (s.isolated ? `, isolated (${corr}, vacuum ${s.padding} Å)` : '')
    let head
    if (code === 'gaussian' || code === 'orca') {
      const notes = [REFERENCE_LABELS[s.reference], ...(code === 'gaussian' && s.brokenSymmetry ? ['broken-symmetry singlet'] : [])]
      head = `${LABELS[code]}: ${s.method}/${s.basis} (${notes.join(', ')}), ${calcText(code, s)}`
    } else if (code === 'qe') head = `QE pw.x: ${FUNCTIONAL_LABELS[s.functional]}, ecutwfc ${s.ecutwfc} Ry, ${kp}, ${calcText(code, s)}${iso('MT')}`
    else if (code === 'vasp') head = `VASP: ${FUNCTIONAL_LABELS[s.functional]}, ENCUT ${s.encut} eV, ${kp}, ${calcText(code, s)}${iso('dipole correction')}`
    else if (code === 'cp2k') head = `CP2K: ${FUNCTIONAL_LABELS[s.functional]}${isHybrid('cp2k', s.functional) ? ' (ADMM)' : ''}, CUTOFF ${s.cutoff} Ry, ${kp}, ${calcText(code, s)}${iso('MT Poisson solver')}`
    else head = `Qbox: ${FUNCTIONAL_LABELS[s.functional]}, ecut ${s.ecut} Ry, ${calcText(code, s)}${iso('no Poisson correction')}`
    let cellText = ''
    if (PLANE_WAVE.includes(code) && rows) {
      try {
        const [a, b, c, alpha, beta, gamma] = U.cellParameters(rows)
        const len = v => Number(v.toFixed(3))
        const ang = v => Number(v.toFixed(1))
        cellText = ` cell ${len(a)}×${len(b)}×${len(c)} Å (${ang(alpha)}/${ang(beta)}/${ang(gamma)}°)`
      } catch (error) { cellText = '' }
    }
    return `${head}${charge}, ${stateList(states.multiplicities)}${cellText}`
  }

  function buildSpec ({ codes, common, cards = {}, symbols = [], cell = null, custom = {} }) {
    const spec = { common: { charge: common.charge, multiplicities: [...common.multiplicities] }, codes: {}, cell, summary: {} }
    for (const code of codes) {
      const s = settingsFor(code, cards[code] || {})
      const pw = PLANE_WAVE.includes(code)
      const customRows = pw && s.cellSource === 'custom' && s.cellCustom ? U.cellVectors(s.cellCustom) : null
      // custom[code]: file name pattern → edited template; edits for files this calculation no longer writes are ignored.
      const edits = custom[code] || {}
      const files = resolve(code, s).map(file => (Object.prototype.hasOwnProperty.call(edits, file.name) ? { ...file, template: edits[file.name] } : file))
      spec.codes[code] = {
        files,
        override: s.override ? { charge: s.override.charge, multiplicities: [...s.override.multiplicities] } : null,
        isolated: pw && s.isolated ? { padding: s.padding } : null,
        species: s.species || defaultSpecies(code, symbols, s),
        reference: code === 'gaussian' || code === 'orca' ? s.reference : 'u',
        brokenSymmetry: code === 'gaussian' ? Boolean(s.brokenSymmetry) : false,
        potcar: code === 'vasp' && s.buildPotcar ? { library: words(s.potcarLibrary) } : null,
        // Molecular codes have no cell/format of their own (qm-inputs.js/monet_qm.py default an
        // absent format to Cartesian Å for them; nothing there ever reads it).
        cell: pw && customRows ? { rows: customRows } : null,
        ...(pw ? { format: { cellUnits: s.cellUnits || 'angstrom', cellStyle: s.cellStyle || 'abc', positions: s.positions || 'cartesian' } } : {})
      }
      spec.summary[code] = describe(code, s, spec.common, customRows || cell)
    }
    return spec
  }

  function readiness (codes, cards, ctx) {
    const blocked = []
    const warnings = []
    const elements = [...new Set(ctx.symbols || [])]
    for (const code of codes) {
      const s = cards[code]
      const label = LABELS[code]
      const pw = PLANE_WAVE.includes(code)
      const block = message => blocked.push(`${label}: ${message}`)
      const warn = message => warnings.push(`${label}: ${message}`)
      if (!CALCS[code].includes(s.calc)) block(code === 'qbox' ? 'Qbox has no built-in vibrational analysis.' : `${CALC_LABELS[s.calc]} is not available.`)
      if (pw && !ctx.cell && !s.isolated && s.cellSource !== 'custom') block('no cell. Apply a crystal cell (Structure analysis › Cell) or tick “Isolated system: vacuum box”.')
      if (pw && s.cellSource === 'custom') {
        if (!validCustomCell(s.cellCustom)) block('enter a valid custom cell (positive lengths, angles between 0° and 180°).')
        else if (ctx.cell && ctx.cell.source === 'trajectory') warn('the custom cell replaces the trajectory lattice for every configuration.')
      }
      if (pw) {
        for (const el of elements) {
          const entry = s.species && s.species[el]
          const missing = code === 'cp2k' ? !entry || !words(entry.basis) || !words(entry.potential) || (isHybrid('cp2k', s.functional) && !words(entry.aux)) : !words(entry)
          if (missing) block(`no pseudopotential for ${el}.`)
        }
      }
      if (s.calc === 'td' && !(Number.isInteger(s.nstates) && s.nstates >= 1)) block('TD-DFT needs at least one excited state.')
      if (code === 'orca' && !(s.maxcorePct >= 1 && s.maxcorePct <= 100)) block('maxcore % must be between 1 and 100.')
      if ((code === 'gaussian' || code === 'orca') && !(Number.isInteger(s.nproc) && s.nproc >= 1)) block('processors must be a positive integer.')
      if ((code === 'gaussian' || code === 'orca') && !/^\s*\d+(\.\d+)?\s*(gb|mb|g|m)\s*$/i.test(s.mem)) block('memory must look like 4gb or 500mb.')
      if (pw && s.kpoints === 'grid' && !s.grid.every(n => Number.isInteger(n) && n >= 1)) block('k-point grid values must be integers ≥ 1.')
      const cutoffs = { qe: [s.ecutwfc, s.ecutrhoFactor], vasp: [s.encut], cp2k: [s.cutoff, s.relCutoff], qbox: [s.ecut] }[code] || []
      if (cutoffs.some(v => !(v > 0))) block('the cutoff must be positive.')
      if (s.calc === 'vcrelax' && s.isolated) block('variable-cell relaxation is not possible with a vacuum box.')
      if (s.calc === 'md' && !(s.md.timestep > 0 && Number.isInteger(s.md.steps) && s.md.steps >= 1 && (s.md.ensemble !== 'nvt' || code === 'gaussian' || s.md.temperature > 0))) block('MD needs a positive time step, at least one step and (NVT) a positive temperature.')
      if (code === 'vasp' && s.buildPotcar) {
        if (!words(s.potcarLibrary)) block('choose the POTCAR library folder or untick “Build POTCAR”.')
        else if (!ctx.potcarAvailable) block('building POTCAR needs the launcher or the desktop app.')
      }
      if (pw && s.isolated && ctx.extent) {
        const extent = Math.max(...ctx.extent)
        if (s.padding < extent) warn(`vacuum ${s.padding} Å is smaller than the configuration extent (${Number(extent.toFixed(2))} Å); isolated-system corrections need a box at least twice the size of the molecule.`)
      }
      if (!pw && ctx.cell) warn('the configuration is written as an isolated cluster without PBC; molecules cut by the box must be made whole first.')
      if (pw && isHybrid(code, s.functional)) warn('hybrid functionals are expensive with plane waves.')
      if (s.calc === 'vcrelax') warn('raise the cutoff by about 30 % to limit Pulay stress.')
      if (code === 'qe' && s.phx && (s.calc === 'freq' || s.calc === 'optfreq')) {
        const mults = s.override ? s.override.multiplicities : (ctx.common ? ctx.common.multiplicities : [])
        if ((mults || []).some(m => m > 1)) warn('ph.x may not support fixed total magnetization (open-shell multiplicities); check your QE version.')
        if (isHybrid('qe', s.functional)) warn('ph.x does not support hybrid functionals.')
        if (s.isolated) warn('check that your ph.x version supports assume_isolated=\'mt\'.')
      }
      if (code === 'cp2k' && s.kpoints === 'grid' && s.isolated) warn('k-point grids are not used for an isolated system (PERIODIC NONE).')
      if (code === 'cp2k' && s.kpoints === 'grid' && isHybrid('cp2k', s.functional)) warn('ADMM hybrids with k-points are expensive and not supported by every CP2K version.')
      if (code === 'cp2k' && ['pbe0', 'b3lyp'].includes(s.functional) && !s.isolated) {
        const customRows = s.cellSource === 'custom' && validCustomCell(s.cellCustom) ? U.cellVectors(s.cellCustom) : null
        const effectiveRows = customRows || (ctx.cell ? ctx.cell.rows : null)
        if (effectiveRows) {
          const radius = hfCutoff(effectiveRows)
          if (radius < 4) warn(`truncation radius ${Number(radius.toFixed(2))} Å is below 4 Å; the cell is too small for the truncated Coulomb operator.`)
        }
      }
    }
    return { blocked, warnings }
  }

  const api = { LABELS, PLANE_WAVE, CALCS, CALC_LABELS, DEFAULTS, RY_FS, HA_FS, SKELETONS, settingsFor, memoryMB, resolve, fill, fixed, lines, words, scaled, HYBRIDS, isHybrid, cellWidths, hfCutoff, validCustomCell, defaultSpecies, buildSpec, describe, readiness }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetQMResolve = api
})(globalThis)

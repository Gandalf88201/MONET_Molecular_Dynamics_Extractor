'use strict'

// Quantum-chemistry input files for every sampled configuration.
// Templates come from qm-resolve.js with only per-configuration {placeholders} left; this engine
// fills them for each code (states, cell, species, POTCAR). monet_qm.py renders the same spec
// with identical output (tests/qm-parity.cjs).
;(function (root) {
  const node = typeof module === 'object' && module.exports
  const BOHR = 0.529177210903 // Å

  // Standard atomic weights (IUPAC, abridged), used for Quantum ESPRESSO ATOMIC_SPECIES.
  const MASSES = {
    H: '1.008', He: '4.0026', Li: '6.94', Be: '9.0122', B: '10.81', C: '12.011', N: '14.007', O: '15.999',
    F: '18.998', Ne: '20.180', Na: '22.990', Mg: '24.305', Al: '26.982', Si: '28.085', P: '30.974', S: '32.06',
    Cl: '35.45', Ar: '39.95', K: '39.098', Ca: '40.078', Sc: '44.956', Ti: '47.867', V: '50.942', Cr: '51.996',
    Mn: '54.938', Fe: '55.845', Co: '58.933', Ni: '58.693', Cu: '63.546', Zn: '65.38', Ga: '69.723', Ge: '72.630',
    As: '74.922', Se: '78.971', Br: '79.904', Kr: '83.798', Rb: '85.468', Sr: '87.62', Y: '88.906', Zr: '91.224',
    Nb: '92.906', Mo: '95.95', Tc: '98', Ru: '101.07', Rh: '102.91', Pd: '106.42', Ag: '107.87', Cd: '112.41',
    In: '114.82', Sn: '118.71', Sb: '121.76', Te: '127.60', I: '126.90', Xe: '131.29', Cs: '132.91', Ba: '137.33',
    La: '138.91', Ce: '140.12', Pr: '140.91', Nd: '144.24', Pm: '145', Sm: '150.36', Eu: '151.96', Gd: '157.25',
    Tb: '158.93', Dy: '162.50', Ho: '164.93', Er: '167.26', Tm: '168.93', Yb: '173.05', Lu: '174.97', Hf: '178.49',
    Ta: '180.95', W: '183.84', Re: '186.21', Os: '190.23', Ir: '192.22', Pt: '195.08', Au: '196.97', Hg: '200.59',
    Tl: '204.38', Pb: '207.2', Bi: '208.98', Po: '209', At: '210', Rn: '222'
  }

  const STATES = { 1: ['sing', 's0', 'singlet'], 2: ['doub', 'd0', 'doublet'], 3: ['trip', 't0', 'triplet'], 4: ['quar', 'q0', 'quartet'], 5: ['quin', 'p0', 'quintet'] }
  const CODES = {
    gaussian: { label: 'Gaussian', folder: '' }, orca: { label: 'ORCA', folder: 'orca' }, qbox: { label: 'Qbox', folder: 'qbox' },
    qe: { label: 'Quantum ESPRESSO (pw.x)', folder: 'qe' }, vasp: { label: 'VASP', folder: 'vasp' }, cp2k: { label: 'CP2K', folder: 'cp2k' }
  }
  const PLANE_WAVE = ['qe', 'vasp', 'cp2k', 'qbox']
  const SAFE = /^[A-Za-z0-9_.+()-]+$/
  const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
  const resolver = () => (node ? require('./qm-resolve.js') : root.MonetQMResolve)

  // Default spec: default cards, plane-wave codes isolated so they always render.
  function defaultSpec (codes = ['gaussian']) {
    const R = resolver()
    const cards = Object.fromEntries(codes.map(code => [code, PLANE_WAVE.includes(code) ? { isolated: true } : {}]))
    return { ...R.buildSpec({ codes, common: { charge: 0, multiplicities: [1, 3] }, cards, symbols: [], cell: null }), masses: MASSES }
  }

  const num = value => String(value)
  const fixed = (value, digits) => (value + 0).toFixed(digits)
  function memoryMB (text) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(gb|mb|g|m)?\s*$/i.exec(String(text))
    if (!match) return 4000
    return Number(match[1]) * (/^g/i.test(match[2] || 'gb') ? 1000 : 1)
  }
  function stateOf (mult) {
    const [tag, chk, state] = STATES[mult] || [`mult${mult}`, `m${mult}`, `multiplicity-${mult}`]
    return { tag, chk: `${chk}.chk`, state }
  }

  // Legacy specs ({ params }) → { common, legacy }; missing per-code fields get their defaults.
  function normalize (spec) {
    if (isObject(spec) && isObject(spec.params) && !('common' in spec)) {
      const p = spec.params
      spec.common = { charge: p.charge, multiplicities: p.multiplicities }
      spec.legacy = { nproc: p.nproc, mem: p.mem, method: p.method, basis: p.basis, padding: p.padding }
    }
    for (const entry of Object.values((spec && typeof spec.codes === 'object' && spec.codes) || {})) {
      if (!entry || typeof entry !== 'object') continue
      for (const [key, value] of [['override', null], ['isolated', null], ['species', {}], ['reference', 'u'], ['brokenSymmetry', false], ['potcar', null]]) {
        if (!Object.prototype.hasOwnProperty.call(entry, key)) entry[key] = value
      }
    }
    return spec
  }

  function checkStates (states, where) {
    const mults = states && states.multiplicities
    if (!Array.isArray(mults) || !mults.length || mults.some(m => !Number.isInteger(m) || m < 1 || m > 11) || new Set(mults).size !== mults.length) {
      throw new Error(`${where}Enter distinct spin multiplicities between 1 and 11, e.g. "1 3".`)
    }
    if (!Number.isInteger(states.charge) || Math.abs(states.charge) > 50) throw new Error(`${where}Charge must be an integer.`)
  }

  function validate (spec) {
    if (!isObject(spec) || !isObject(spec.codes)) throw new Error('Invalid quantum-chemistry input settings.')
    normalize(spec)
    checkStates(spec.common, '')
    if (spec.legacy && (!Number.isInteger(spec.legacy.nproc) || spec.legacy.nproc < 1)) throw new Error('Processors must be a positive integer.')
    if (spec.legacy && !(Number.isFinite(spec.legacy.padding) && spec.legacy.padding >= 0)) throw new Error('Vacuum padding must be zero or positive.')
    if (spec.legacy && ['method', 'basis', 'mem'].some(key => /[/\\\r\n]/.test(String(spec.legacy[key])))) throw new Error('Method, basis and memory must not contain slashes or line breaks.')
    if (spec.masses != null && !(isObject(spec.masses) && Object.values(spec.masses).every(m => (typeof m === 'string' || (typeof m === 'number' && Number.isFinite(m))) && /^[0-9.]+$/.test(String(m))))) throw new Error('Invalid atomic masses.')
    for (const [code, entry] of Object.entries(spec.codes)) {
      if (!CODES[code]) throw new Error(`Unknown input code ${code}.`)
      if (!isObject(entry) || !Array.isArray(entry.files)) throw new Error('Invalid quantum-chemistry input settings.')
      const label = `${CODES[code].label}: `
      if (entry.override) checkStates(entry.override, label)
      if (entry.isolated && !(isObject(entry.isolated) && Number.isFinite(entry.isolated.padding) && entry.isolated.padding >= 0)) throw new Error(`${label}Vacuum padding must be zero or positive.`)
      if (!['u', 'auto', 'r'].includes(entry.reference)) throw new Error(`${label}Unknown reference ${entry.reference}.`)
      if (!isObject(entry.species)) throw new Error(`${label}Invalid pseudopotential table.`)
      for (const [el, value] of Object.entries(entry.species)) {
        // CP2K: { basis, potential, aux? }; other codes: one file name / variant per element.
        const parts = code === 'cp2k' ? (isObject(value) ? [value.basis, value.potential, ...(value.aux ? [value.aux] : [])] : [null]) : [value]
        if (!/^[A-Z][a-z]?$/.test(el) || parts.some(part => typeof part !== 'string' || !SAFE.test(part))) throw new Error(`${label}Invalid pseudopotential entry for ${el}.`)
      }
      if (entry.potcar && !(isObject(entry.potcar) && typeof entry.potcar.library === 'string' && entry.potcar.library)) throw new Error(`${label}Choose the POTCAR library folder.`)
      for (const file of entry.files) {
        if (!isObject(file) || typeof file.name !== 'string' || !/^[A-Za-z0-9_.{}-]+$/.test(file.name) || typeof file.template !== 'string') throw new Error(`Invalid file name pattern ${file && file.name}.`)
      }
    }
    const cell = spec.cell
    if (cell != null && !(Array.isArray(cell) && cell.length === 3 && cell.every(row => Array.isArray(row) && row.length === 3 && row.every(v => typeof v === 'number' && Number.isFinite(v))))) throw new Error('Cell must be a 3x3 matrix.')
    if (spec.summary != null && !(isObject(spec.summary) && Object.values(spec.summary).every(text => typeof text === 'string'))) throw new Error('Invalid quantum-chemistry input summary.')
    return spec
  }

  // Cell rows (Å), shifted positions and note for one code and configuration.
  function cellFor (code, entry, conf, spec) {
    // Legacy specs ({ params }): plane-wave codes only, box not centred, old note (output as before).
    const legacyBox = padding => ({
      rows: [0, 1, 2].map(axis => {
        let low = Infinity, high = -Infinity
        for (const p of conf.positions) { low = Math.min(low, p[axis]); high = Math.max(high, p[axis]) }
        const row = [0, 0, 0]
        row[axis] = Math.max(high - low + padding, 1)
        return row
      }),
      positions: conf.positions,
      note: `Cell: orthorhombic box = extent + ${num(padding)} A padding (no cell in the trajectory).`
    })
    const box = padding => {
      const shift = [], rows = []
      for (let axis = 0; axis < 3; axis++) {
        let low = Infinity, high = -Infinity
        for (const p of conf.positions) { low = Math.min(low, p[axis]); high = Math.max(high, p[axis]) }
        const side = Math.max(high - low + padding, 1)
        const row = [0, 0, 0]; row[axis] = side; rows.push(row)
        shift.push(side / 2 - (low + high) / 2)
      }
      return { rows, positions: conf.positions.map(p => p.map((v, k) => v + shift[k])), note: `Cell: vacuum box = extent + ${num(padding)} A, configuration centred (isolated system).` }
    }
    if (entry.isolated) return box(Number(entry.isolated.padding))
    if (spec.cell) return { rows: spec.cell, positions: conf.positions, note: 'Cell: applied manual cell.' }
    if (conf.lattice) return { rows: conf.lattice, positions: conf.positions, note: 'Cell: from the trajectory.' }
    if (spec.legacy && PLANE_WAVE.includes(code)) return legacyBox(Number(spec.legacy.padding))
    if (PLANE_WAVE.includes(code)) throw new Error(`${CODES[code].label}: no cell for configuration ${conf.index}. Apply a crystal cell or tick “Isolated system: vacuum box”.`)
    return { rows: null, positions: conf.positions, note: 'No cell (isolated cluster).' }
  }

  // CP2K truncation radius from the perpendicular widths of the cell; '' for a degenerate cell.
  // Plain sqrt (not Math.hypot) so Python gives the same bits.
  function hfCutoff (rows) {
    const [a, b, c] = rows
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const norm = v => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b)
    const volume = Math.abs(a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2])
    const norms = [norm(bc), norm(ca), norm(ab)]
    if (!(Number.isFinite(volume) && volume > 0) || norms.some(n => !(Number.isFinite(n) && n > 0))) return ''
    return fixed(Math.min(6, Math.min(...norms.map(n => volume / n)) / 2 - 0.1), 4)
  }

  function context (code, entry, conf, spec, states, mult, runtime) {
    const symbols = conf.symbols
    const species = [...new Set(symbols)]
    const cell = cellFor(code, entry, conf, spec)
    const positions = cell.positions
    const rows = cell.rows
    const unpaired = mult - 1
    const table = entry.species || {}
    const name = (s, fallback) => (typeof table[s] === 'string' && table[s] ? table[s] : fallback)
    const masses = spec.masses || {}
    const counts = species.map(s => symbols.filter(x => x === s).length)
    const order = species.flatMap(s => symbols.map((x, i) => x === s ? i : -1).filter(i => i >= 0))
    const seen = {}
    // u: unrestricted always; auto: restricted singlet, unrestricted otherwise; r: restricted / restricted open-shell.
    const ref = entry.reference === 'u' ? 'u' : mult === 1 ? 'r' : entry.reference === 'auto' ? 'u' : 'ro'
    const ks = { u: 'UKS', r: 'RKS', ro: 'ROKS' }[ref]
    const charge = states.charge
    let nelect = `# Net charge ${num(charge)}: set NELECT = (sum of ZVAL in POTCAR) - (${num(charge)}) for charged systems.`
    if (code === 'vasp' && runtime && runtime.potcar) {
      const zval = runtime.potcar.zval || {}
      for (const s of species) if (typeof zval[s] !== 'number' || !Number.isFinite(zval[s])) throw new Error(`VASP: no ZVAL for ${s} in the POTCAR.`)
      const total = species.reduce((sum, s, k) => sum + zval[s] * counts[k], 0) - charge
      nelect = charge ? `NELECT = ${num(total)}` : '# NELECT: neutral system, taken from POTCAR'
    }
    const values = {
      ...stateOf(mult),
      index: num(conf.index), frame: num(conf.frame), charge: num(charge), mult: num(mult),
      coords: symbols.map((s, i) => `${s}  ${fixed(positions[i][0], 7)}  ${fixed(positions[i][1], 7)}  ${fixed(positions[i][2], 7)}\n`).join(''),
      nat: num(symbols.length), ntyp: num(species.length),
      nspin: unpaired ? '2' : '1', unpaired: num(unpaired), delta_spin: num(unpaired / 2),
      uks: unpaired ? '.TRUE.' : '.FALSE.',
      ref, ks, guess: entry.brokenSymmetry && mult === 1 ? ' guess=mix' : '',
      cell_note: cell.note,
      cell_ang: rows ? rows.map(row => row.map(v => fixed(v, 10)).join('  ')).join('\n') : '',
      qbox_cell: rows ? rows.flat().map(v => fixed(v / BOHR, 8)).join(' ') : '',
      qbox_species: species.map(s => `species ${s.toLowerCase()} ${name(s, `${s}_ONCV_PBE-1.0.xml`)}`).join('\n'),
      qbox_atoms: symbols.map((s, i) => {
        seen[s] = (seen[s] || 0) + 1
        return `atom ${s}${seen[s]} ${s.toLowerCase()} ${positions[i].map(v => fixed(v / BOHR, 8)).join(' ')}`
      }).join('\n'),
      qe_species: species.map(s => `  ${s} ${String(masses[s] || '1.0')} ${name(s, `${s}.UPF`)}`).join('\n'),
      qe_magnetization: unpaired ? `  tot_magnetization = ${unpaired}\n` : '',
      vasp_species: species.join(' '),
      vasp_counts: counts.join(' '),
      vasp_coords: order.map(i => positions[i].map(v => fixed(v, 10)).join('  ')).join('\n'),
      vasp_potcar_spec: species.map(s => name(s, s)).join('\n'),
      vasp_nelect: nelect,
      cp2k_cell: rows ? ['A', 'B', 'C'].map((axis, k) => `      ${axis} ${rows[k].map(v => fixed(v, 10)).join(' ')}`).join('\n') : '',
      cp2k_kinds: species.map(s => {
        const kind = isObject(table[s]) ? table[s] : {}
        return `    &KIND ${s}\n      BASIS_SET ${kind.basis || 'DZVP-MOLOPT-SR-GTH'}\n${kind.aux ? `      BASIS_SET AUX_FIT ${kind.aux}\n` : ''}      POTENTIAL ${kind.potential || 'GTH-PBE'}\n    &END KIND`
      }).join('\n'),
      cp2k_hf_cutoff: rows ? hfCutoff(rows) : ''
    }
    if (spec.legacy) {
      const p = spec.legacy
      Object.assign(values, { nproc: num(p.nproc), mem: String(p.mem), method: String(p.method), basis: String(p.basis), maxcore: num(Math.floor(memoryMB(p.mem) / Math.max(1, Number(p.nproc)))) })
    }
    return values
  }

  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match)

  // POTCAR text and valences for the given variants, read from a local library (<library>/<variant>/POTCAR).
  function loadPotcar (library, variants, io) {
    const base = io.real(library)
    const parts = []
    const zval = []
    for (const variant of variants) {
      if (!/^[A-Za-z0-9_.-]+$/.test(variant) || variant === '.' || variant === '..') throw new Error(`Invalid POTCAR variant ${variant}.`)
      let file
      try { file = io.real(io.join(base, variant, 'POTCAR')) } catch (e) { throw new Error(`POTCAR variant ${variant} not found in ${library}.`) }
      if (!file.startsWith(base + io.sep)) throw new Error(`Invalid POTCAR variant ${variant}.`)
      const text = io.read(file)
      const match = /ZVAL\s*=\s*([-+0-9.Ee]+)/.exec(text)
      if (!match) throw new Error(`No ZVAL in POTCAR of ${variant}.`)
      parts.push(text.endsWith('\n') ? text : text + '\n')
      zval.push(Number(match[1]))
    }
    return { text: parts.join(''), zval }
  }

  // conf = { index (1-based), frame, symbols, positions: [[x,y,z]...], lattice?: 3x3 }
  // runtime.potcar = { text, zval: { El: number } } adds vasp/POTCAR and the exact NELECT.
  function render (spec, conf, runtime = {}) {
    normalize(spec)
    const out = []
    for (const [code, entry] of Object.entries(spec.codes)) {
      const states = entry.override || spec.common
      const folder = CODES[code].folder
      for (const file of entry.files) {
        const perState = /\{(tag|mult|state|chk)\}/.test(file.name)
        for (const mult of perState ? states.multiplicities : [states.multiplicities[0]]) {
          const values = context(code, entry, conf, spec, states, mult, runtime)
          const name = fill(file.name, values)
          if (name.includes('/') || ['', '.', '..'].includes(name)) throw new Error(`Invalid output file name ${name}.`)
          out.push({ path: folder ? `${folder}/${name}` : name, text: fill(file.template, values) })
        }
      }
      if (code === 'vasp' && runtime && runtime.potcar) out.push({ path: 'vasp/POTCAR', text: runtime.potcar.text })
    }
    return out
  }

  const api = { CODES, MASSES, BOHR, PLANE_WAVE, defaultSpec, normalize, render, validate, stateOf, memoryMB, loadPotcar }
  if (node) module.exports = api
  else root.MonetQM = api
})(globalThis)

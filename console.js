'use strict'

// MONET console: readable calls such as acf(quantity="dihedral", groups=[[228, 227, 289, 225]]).
// It contains:
//   - a strict hand-written parser (never eval);
//   - a formatter whose text parses back to the same values;
//   - the analyses the console may run, with their parameters;
//   - the MONET ID ⇄ file index conversion.
;(function (root) {
  // Parameters of each console analysis, in display order. Keys are the bridge command keys.
  const ACTIONS = {
    rmsd: ['indices', 'frame_step', 'align', 'unwrap', 'reference_index'],
    rmsd_matrix: ['indices', 'frame_step', 'max_frames', 'align', 'unwrap'],
    pdd: ['indices', 'elements', 'rmax', 'nbins', 'frame_step'],
    rdf: ['indices', 'elements', 'rmax', 'nbins', 'frame_step'],
    bonds: ['pairs', 'frame_step'],
    angles: ['triplets', 'frame_step', 'angle_range', 'angle_normal'],
    dihedrals: ['quads', 'frame_step', 'angle_range'],
    msd: ['indices', 'dt', 'frame_step', 'remove_drift', 'fit_start', 'fit_end'],
    vdos: ['indices', 'dt', 'frame_step', 'mass_weighted', 'smooth_cm', 'max_cm'],
    acf: ['quantity', 'groups', 'dt', 'frame_step', 'mode', 'fit_until', 'fit_model', 'tau_int_method', 'angle_range', 'max_lag'],
    equilibration: ['quantity', 'groups', 'dt', 'frame_step', 'mode', 'fit_until', 'fit_model', 'tau_int_method', 'angle_range', 'max_lag'],
    fluctuations: ['quantity', 'indices', 'groups', 'frame_step', 'align', 'dt'],
    mda_run: ['analysis', 'params', 'frame_step', 'dt'],
    ase_structure: ['frame', 'symprec'],
    ase_coordination: ['indices', 'frame_step']
  }
  // Keys that hold atoms: file indices in bridge commands, MONET IDs in console calls.
  const ATOM_KEYS = ['indices', 'groups', 'pairs', 'triplets', 'quads']
  // Filled in by MONET, never typed: paths, cell options, atom numbering, bond cutoff.
  const HIDDEN = new Set(['action', 'filename', 'output', 'input', 'file_id', 'cell', 'pbc', 'mic', 'atom_ids', 'bond_scale'])
  const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
  const MAX_TEXT = 20000
  const MAX_DEPTH = 8
  const TOKEN = /\s*(?:("(?:[^"\\\n]|\\.)*")|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([()[\]{},=:]))/y

  function tokenize (text) {
    if (text.length > MAX_TEXT) throw new Error(`The call is longer than ${MAX_TEXT} characters.`)
    const tokens = []
    let index = 0
    while (index < text.length) {
      const rest = text.slice(index)
      const skip = rest.length - rest.trimStart().length
      if (skip === rest.length) break
      TOKEN.lastIndex = index
      const match = TOKEN.exec(text)
      const pos = index + skip + 1
      if (!match) throw new Error(`Unexpected '${text[index + skip]}' at position ${pos}.`)
      if (match[1] !== undefined) {
        let value
        try { value = JSON.parse(match[1]) } catch { throw new Error(`Invalid text value at position ${pos}.`) }
        tokens.push({ type: 'string', value, pos })
      } else if (match[2] !== undefined) tokens.push({ type: 'number', value: Number(match[2]), pos })
      else if (match[3] !== undefined) tokens.push({ type: 'name', value: match[3], pos })
      else tokens.push({ type: 'punct', value: match[4], pos })
      index = TOKEN.lastIndex
    }
    return tokens
  }

  function define (object, key, value) {
    if (FORBIDDEN.has(key)) throw new Error(`'${key}' is not allowed as a name.`)
    Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true })
  }

  function parse (text) {
    const tokens = tokenize(String(text))
    let i = 0
    const peek = () => tokens[i]
    const isPunct = (token, value) => Boolean(token) && token.type === 'punct' && token.value === value
    const fail = message => { throw new Error(message) }
    const expect = value => {
      const token = tokens[i++]
      if (!isPunct(token, value)) fail(`Expected '${value}'${token ? ` at position ${token.pos}` : ' at the end'}.`)
    }
    function value (depth) {
      if (depth > MAX_DEPTH) fail('Values are nested too deeply.')
      const token = tokens[i++]
      if (!token) fail('The call ends too early.')
      if (token.type === 'number' || token.type === 'string') return token.value
      if (token.type === 'name') {
        if (token.value === 'True') return true
        if (token.value === 'False') return false
        if (token.value === 'None') return null
        fail(`Unknown value '${token.value}' at position ${token.pos}: use numbers, "text", True, False, None, [lists] or {"key": value}.`)
      }
      if (token.value === '[') {
        const list = []
        while (!isPunct(peek(), ']')) {
          list.push(value(depth + 1))
          if (isPunct(peek(), ',')) i++
          else break
        }
        expect(']')
        return list
      }
      if (token.value === '{') {
        const object = {}
        while (!isPunct(peek(), '}')) {
          const key = tokens[i++]
          if (!key || key.type !== 'string') fail('Dictionary keys must be "text".')
          expect(':')
          define(object, key.value, value(depth + 1))
          if (isPunct(peek(), ',')) i++
          else break
        }
        expect('}')
        return object
      }
      fail(`Unexpected '${token.value}' at position ${token.pos}.`)
    }
    const head = tokens[i++]
    if (!head || head.type !== 'name') fail('Start with an analysis name, e.g. acf(...). Type help() for the list.')
    expect('(')
    if (head.value === 'help') {
      const topic = peek() && peek().type === 'name' ? tokens[i++].value : null
      expect(')')
      if (i < tokens.length) fail('Unexpected text after the call.')
      return { name: 'help', args: topic ? { topic } : {} }
    }
    const args = {}
    while (!isPunct(peek(), ')')) {
      const key = tokens[i++]
      if (!key || key.type !== 'name') fail(`Expected a parameter name${key ? ` at position ${key.pos}` : ''}.`)
      expect('=')
      if (Object.prototype.hasOwnProperty.call(args, key.value)) fail(`Parameter '${key.value}' is given twice.`)
      define(args, key.value, value(1))
      if (isPunct(peek(), ',')) i++
      else break
    }
    expect(')')
    if (i < tokens.length) fail('Unexpected text after the call.')
    return { name: head.value, args }
  }

  // Python-compatible literals, so replay.py can use the same text.
  function formatValue (v) {
    if (v === null || v === undefined) return 'None'
    if (v === true) return 'True'
    if (v === false) return 'False'
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'None'
    if (typeof v === 'string') return JSON.stringify(v)
    if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`
    if (typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${formatValue(x)}`).join(', ')}}`
    return JSON.stringify(String(v))
  }
  const formatArgs = args => Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${formatValue(v)}`).join(', ')
  function format (name, args) {
    const order = ACTIONS[name] || []
    const keys = [...order.filter(k => k in args), ...Object.keys(args).filter(k => !order.includes(k)).sort()]
    return `${name}(${formatArgs(Object.fromEntries(keys.map(k => [k, args[k]])))})`
  }

  function distance (a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0]
      row[0] = i
      for (let j = 1; j <= b.length; j++) {
        const current = row[j]
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
        previous = current
      }
    }
    return row[b.length]
  }
  function suggest (word, candidates) {
    let best = null, score = Infinity
    for (const candidate of candidates) {
      const d = distance(word, candidate) - (candidate.includes(word) || word.includes(candidate) ? 10 : 0)
      if (d < score) { score = d; best = candidate }
    }
    return best !== null && (score < 0 || score <= Math.max(2, Math.floor(word.length / 3))) ? best : null
  }

  const names = () => Object.keys(ACTIONS)
  const parameters = name => [...(ACTIONS[name] || [])]
  function unknown (name) {
    const near = suggest(name, names())
    return new Error(`Unknown analysis '${name}'.${near ? ` Did you mean '${near}'?` : ''} Type help() for the list.`)
  }
  function validate (name, args) {
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, name)) throw unknown(name)
    for (const key of Object.keys(args)) {
      if (!ACTIONS[name].includes(key)) {
        const near = suggest(key, ACTIONS[name])
        throw new Error(`${name} has no parameter '${key}'.${near ? ` Did you mean '${near}'?` : ''} Type help(${name}) for its parameters.`)
      }
    }
  }
  function help (topic) {
    if (!topic) return `Analyses: ${names().join(', ')}. Type help(acf) for the parameters of one; click a line above to copy its call.`
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, topic)) throw unknown(topic)
    return `${topic}(${ACTIONS[topic].join(', ')})\nAtoms are MONET IDs; dt comes from the time axis; cell, PBC and minimum image come from the panel.`
  }

  const mapAtoms = (value, convert) => (Array.isArray(value) ? value.map(v => mapAtoms(v, convert)) : convert(value))
  function convertKeys (object, convert) {
    const out = { ...object }
    for (const key of ATOM_KEYS) if (out[key] != null) out[key] = mapAtoms(out[key], convert)
    if (out.params && typeof out.params === 'object' && !Array.isArray(out.params)) out.params = convertKeys(out.params, convert)
    return out
  }
  function toCall (command, mapping) {
    const byIndex = new Map(mapping.map(atom => [atom.aseIndex, atom.monetId]))
    const args = {}
    for (const [key, value] of Object.entries(command)) if (!HIDDEN.has(key) && value !== undefined) args[key] = value
    return {
      name: command.action,
      args: convertKeys(args, index => {
        if (!byIndex.has(index)) throw new Error(`File index ${index} has no MONET ID.`)
        return byIndex.get(index)
      })
    }
  }
  function fromCall (args, mapping) {
    const byId = new Map(mapping.map(atom => [atom.monetId, atom.aseIndex]))
    return convertKeys(args, id => {
      if (!Number.isInteger(id) || !byId.has(id)) throw new Error(`MONET atom ${id} is not in the active trajectory.`)
      return byId.get(id)
    })
  }
  function atomIds (args) {
    const ids = new Set()
    const walk = v => (Array.isArray(v) ? v.forEach(walk) : Number.isInteger(v) && ids.add(v))
    for (const key of ATOM_KEYS) {
      if (args[key] != null) walk(args[key])
      if (args.params && args.params[key] != null) walk(args.params[key])
    }
    return [...ids]
  }

  const api = { names, parameters, parse, format, formatArgs, formatValue, validate, help, toCall, fromCall, atomIds }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetConsole = api
})(globalThis)

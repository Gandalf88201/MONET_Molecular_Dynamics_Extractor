'use strict'

// Shared by the browser and Electron. Count complete frames, not comment tags.
;(function (root) {
  const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/

  // Number() is fast but also accepts 0x/0b/0o literals; those and any other
  // unusual text take the strict regular-expression path.
  function coordinate (value, fail) {
    let number = +value
    const second = value.charCodeAt(1)
    if (number !== number || second === 120 || second === 88 || second === 98 || second === 66 || second === 111 || second === 79) {
      if (!NUMERIC.test(value)) fail('Invalid numeric coordinate.')
      number = Number(value.replace(/[dD]/, 'e'))
    }
    if (!Number.isFinite(number)) fail('Coordinates must be finite numbers.')
    return number
  }

  class Parser {
    constructor () {
      this.line = 0
      this.phase = 'count'
      this.atomCount = 0
      this.configCount = 0
      this.format = 'XYZ'
    }

    push (raw) {
      this.line++
      const line = this.line === 1 ? raw.replace(/^\uFEFF/, '') : raw
      const fail = message => { throw new Error(`Line ${this.line}: ${message}`) }
      if (this.phase === 'count') {
        if (!line.trim()) return null
        if (!/^\d+$/.test(line.trim())) fail('Expected an XYZ atom count.')
        const count = Number(line.trim())
        if (!Number.isSafeInteger(count) || count < 1) fail('Atom count must be a positive integer.')
        if (this.atomCount && count !== this.atomCount) fail('The number of atoms must stay constant across frames.')
        this.atomCount = count
        this.atoms = []
        if (!this.elements) this.rawRow = []
        this.phase = 'comment'
      } else if (this.phase === 'comment') {
        this.comment = line // A blank comment is a valid, required header line.
        if (/STEP\s*[=:]/i.test(line)) this.format = 'CPMD'
        else if (/\bi\s*=/.test(line)) this.format = 'CP2K'
        this.columns = { element: 0, position: 1, required: 4 }
        this.lattice = null
        const lattice = line.match(/\bLattice="([^"]+)"/)
        if (lattice) {
          const values = lattice[1].trim().split(/\s+/).map(Number)
          if (values.length === 9 && values.every(Number.isFinite)) this.lattice = [values.slice(0, 3), values.slice(3, 6), values.slice(6, 9)]
        }
        const props = line.match(/\bProperties=([^\s]+)/)
        if (props) {
          const fields = props[1].replace(/^"|"$/g, '').split(':')
          let offset = 0, element = -1, position = -1
          if (fields.length % 3) fail('Invalid extended XYZ Properties header.')
          for (let i = 0; i < fields.length; i += 3) {
            const width = Number(fields[i + 2])
            if (!Number.isSafeInteger(width) || width < 1) fail('Invalid extended XYZ property width.')
            if (fields[i] === 'species' && width === 1) element = offset
            if (fields[i] === 'pos' && width === 3) position = offset
            offset += width
          }
          if (element < 0 || position < 0) fail('Extended XYZ requires species and pos properties.')
          this.columns = { element, position, required: offset }
        }
        this.phase = 'atoms'
      } else {
        const fields = line.trim().split(/\s+/)
        const { element, position, required } = this.columns
        if (fields.length < required) fail('Incomplete atom row; expected element and x, y, z coordinates.')
        const index = this.atoms.length + 1
        const symbol = fields[element]
        if (!this.elements) this.rawRow.push(symbol)
        let normalized
        // Fast path: the raw symbol matches the first frame, which was fully validated.
        if (this.rawElements && this.rawElements[index - 1] === symbol) normalized = this.elements[index - 1]
        else {
          if (!/^[A-Za-z]{1,3}$/.test(symbol)) fail('Invalid element symbol.')
          normalized = symbol[0].toUpperCase() + symbol.slice(1).toLowerCase()
          if (this.elements && this.elements[index - 1] !== normalized) fail('Atom order/elements must stay constant across frames.')
        }
        const x = coordinate(fields[position], fail)
        const y = coordinate(fields[position + 1], fail)
        const z = coordinate(fields[position + 2], fail)
        this.atoms.push({ index, element: normalized, x, y, z })
        if (this.atoms.length === this.atomCount) {
          if (!this.elements) {
            this.elements = this.atoms.map(atom => atom.element)
            this.rawElements = this.rawRow || null
          }
          const frame = { index: this.configCount++, comment: this.comment, atoms: this.atoms, lattice: this.lattice }
          this.phase = 'count'
          return frame
        }
      }
      return null
    }

    finish () {
      if (this.phase !== 'count') throw new Error(`Incomplete XYZ frame ${this.configCount + 1}; check the atom count and comment line.`)
      if (!this.configCount) throw new Error('The file contains no XYZ frames.')
      return { atomCount: this.atomCount, configCount: this.configCount, format: this.format }
    }
  }

  async function * frames (lines) {
    const parser = new Parser()
    for await (const line of lines) {
      const frame = parser.push(line)
      if (frame) yield frame
    }
    parser.finish()
  }

  // Comment line of an extracted frame: its index in the file being extracted, plus the frame of the
  // original trajectory when this file is derived (uncorrelated, cropped, PCA selection: source_frame=).
  function outputComment (index, comment) {
    const source = /(?:^|\s)source_frame=(\d+)/.exec(comment || '')
    return source ? `frame ${index} source_frame=${source[1]}` : `frame ${index}`
  }

  const api = { Parser, frames, outputComment }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetXYZ = api
})(globalThis)

'use strict'

// Shared by the browser and Electron. Count complete frames, not comment tags.
;(function (root) {
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
        this.phase = 'comment'
      } else if (this.phase === 'comment') {
        this.comment = line // A blank comment is a valid, required header line.
        if (/STEP\s*[=:]/i.test(line)) this.format = 'CPMD'
        else if (/\bi\s*=/.test(line)) this.format = 'CP2K'
        this.columns = { element: 0, position: 1, required: 4 }
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
        if (!/^[A-Za-z]{1,3}$/.test(fields[element])) fail('Invalid element symbol.')
        const coordinates = fields.slice(position, position + 3).map(value => {
          if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(value)) fail('Invalid numeric coordinate.')
          const number = Number(value.replace(/[dD]/, 'e'))
          if (!Number.isFinite(number)) fail('Coordinates must be finite numbers.')
          return number
        })
        const symbol = fields[element]
        const normalized = symbol[0].toUpperCase() + symbol.slice(1).toLowerCase()
        const index = this.atoms.length + 1
        if (this.elements && this.elements[index - 1] !== normalized) fail('Atom order/elements must stay constant across frames.')
        this.atoms.push({ index, element: normalized, x: coordinates[0], y: coordinates[1], z: coordinates[2] })
        if (this.atoms.length === this.atomCount) {
          if (!this.elements) this.elements = this.atoms.map(atom => atom.element)
          const frame = { index: this.configCount++, comment: this.comment, atoms: this.atoms }
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

  const api = { Parser, frames }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetXYZ = api
})(globalThis)

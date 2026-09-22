'use strict'
// MONET console (console.js): parser, formatter, whitelist, did-you-mean and MONET ID conversion.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const C = require('../console.js')
const P = require('../provenance.js')
let checks = 0
assert.deepEqual(C.parse('acf(quantity="dihedral", groups=[[228, 227, 289, 225]], dt=0.4838, max_lag=None, align=True)'),
  { name: 'acf', args: { quantity: 'dihedral', groups: [[228, 227, 289, 225]], dt: 0.4838, max_lag: null, align: true } }); checks++
assert.deepEqual(C.parse(' rdf ( indices = [1,2,] , rmax=-1.5e1 ) '), { name: 'rdf', args: { indices: [1, 2], rmax: -15 } }); checks++
assert.deepEqual(C.parse('mda_run(analysis="rmsf", params={"selection": "name C*", "align": False})'), { name: 'mda_run', args: { analysis: 'rmsf', params: { selection: 'name C*', align: false } } }); checks++
assert.deepEqual(C.parse('help()'), { name: 'help', args: {} }); assert.deepEqual(C.parse('help(acf)'), { name: 'help', args: { topic: 'acf' } }); checks++
assert.deepEqual(C.parse('rmsd()'), { name: 'rmsd', args: {} }); checks++
for (const [text, message] of [
  ['acf(', /Expected a parameter name/],
  ['acf(quantity=)', /Unexpected '\)'/],
  ['acf(quantity="a" "b")', /Expected '\)'/],
  ['acf(x=1, x=2)', /given twice/],
  ['acf(x=os)', /Unknown value 'os'/],
  ['__import__("os").system("ls")', /Unexpected '\.'/],
  ['acf(x=1) y', /after the call/],
  ['acf(x=1).y', /Unexpected '\.'/],
  ['acf(x=[1, 2)', /Expected '\]'/],
  ['acf(x={"__proto__": 1})', /not allowed/],
  ['acf(__proto__=1)', /not allowed/],
  ['acf(x=' + '['.repeat(20) + ']'.repeat(20) + ')', /nested too deeply/],
  ['acf(x="unterminated)', /Unexpected '"'/],
  ['1(x=1)', /Start with an analysis name/],
  ['acf(x=1); rm()', /Unexpected ';'/],
  ['import os', /Expected '\('/]
]) { assert.throws(() => C.parse(text), message, text); checks++ }
// Formatting gives text that parses back to the same values, in the parameter order of the action.
const call = 'acf(quantity="dihedral", groups=[[228, 227, 289, 225]], dt=0.4838, frame_step=1, mode="value", tau_int_method="sokal", max_lag=None)'
const parsed = C.parse(call)
assert.equal(C.format(parsed.name, parsed.args), call); checks++
for (const value of [0, -2.5, 1e-7, 1e21, 'say "hi"\n', true, false, null, [], [[1, 2], [3]], { 'a b': [1, { c: 'd' }] }]) {
  const text = C.format('rdf', { rmax: value })
  assert.deepEqual(C.parse(text).args.rmax, value, text); assert.equal(C.format('rdf', C.parse(text).args), text); checks++
}
// formatArgs keys reach replay.py verbatim as Python parameter names, so a non-identifier key
// (as a crafted session could supply) must be rejected rather than spliced in as code.
assert.throws(() => C.formatArgs({ 'a b': 1 }), /Invalid parameter name/); checks++
assert.equal(C.formatArgs({ ok_1: 2 }), 'ok_1=2'); checks++
// Unknown names and parameters, with suggestions.
assert.throws(() => C.validate('acff', {}), /Unknown analysis 'acff'\. Did you mean 'acf'\?/); checks++
assert.throws(() => C.validate('acf', { lag: 5 }), /acf has no parameter 'lag'\. Did you mean 'max_lag'\?/); checks++
assert.throws(() => C.validate('convert', {}), /Unknown analysis 'convert'/); checks++
assert.doesNotThrow(() => C.validate('rdf', { indices: [1], rmax: 6 })); checks++
assert.match(C.help(), /acf, equilibration/); assert.match(C.help('acf'), /^acf\(quantity, groups, dt/); assert.throws(() => C.help('nope'), /Unknown analysis/); checks++
// MONET IDs in calls, file indices in commands; paths and cell options never appear in a call.
const mapping = [{ monetId: 228, aseIndex: 0 }, { monetId: 227, aseIndex: 1 }, { monetId: 289, aseIndex: 2 }, { monetId: 225, aseIndex: 3 }]
const command = { action: 'acf', filename: '/secret/path/traj.xyz', quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 0.5, cell: [10, 10, 10, 90, 90, 90], pbc: [true, true, true], mic: true, atom_ids: [228, 227, 289, 225], bond_scale: 1.2, max_lag: undefined }
const { name, args } = C.toCall(command, mapping)
assert.equal(name, 'acf'); assert.deepEqual(args, { quantity: 'dihedral', groups: [[228, 227, 289, 225]], dt: 0.5 }); checks++
assert.equal(C.format(name, args).includes('secret'), false); checks++
assert.deepEqual(C.fromCall(args, mapping), { quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 0.5 }); checks++
assert.throws(() => C.fromCall({ indices: [999] }, mapping), /MONET atom 999 is not in the active trajectory/); checks++
assert.deepEqual(C.toCall({ action: 'mda_run', analysis: 'dihedral_mda', params: { quads: [[3, 2, 1, 0]] } }, mapping).args.params.quads, [[225, 289, 227, 228]]); checks++
assert.deepEqual(C.atomIds({ pairs: [[228, 227], [227, 289]], params: { quads: [[1, 2, 3, 4]] } }).sort((a, b) => a - b), [1, 2, 3, 4, 227, 228, 289]); checks++
// Every console analysis is a launcher action with allowed keys, and has key numbers for the history.
const launcher = fs.readFileSync(path.join(__dirname, '..', 'start_monet.py'), 'utf8')
const setOf = key => new Set(launcher.match(new RegExp(`^${key} = \\{([^}]*)\\}`, 'm'))[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1)))
const actions = setOf('ACTIONS'), allowed = setOf('ALLOWED')
for (const analysis of C.names()) {
  assert.ok(actions.has(analysis), `${analysis} is not a launcher action`)
  for (const key of C.parameters(analysis)) assert.ok(allowed.has(key), `${analysis}.${key} is not allowed by the launcher`)
  assert.ok(P.SUMMARY[analysis], `no key numbers for ${analysis}`)
}
assert.equal(C.names().length, 15); checks++
console.log(`PASS: ${checks} console checks (parser, formatter, whitelist, MONET IDs).`)

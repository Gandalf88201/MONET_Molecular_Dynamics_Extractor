'use strict'
// A replay.py generated from a logged session re-runs the analyses headless and matches the logged
// numbers; a changed number gives DIFF and a changed input stops the replay.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const P = require('../provenance.js')
const C = require('../console.js')
const R = require('../replaygen.js')
const root = path.resolve(__dirname, '..')
const python = path.resolve(process.env.PYTHON || 'python3')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monet-replay-'))
const env = { ...process.env, MONET_CACHE_DIR: path.join(temp, 'cache') }
let checks = 0
// 400 frames: the H atom turns about the C2–C3 bond, so the C1–C2–C3–H dihedral fluctuates.
let text = ''
for (let k = 0; k < 400; k++) {
  const phi = 1.2 * Math.sin(k / 7) + 0.3 * Math.sin(k / 2.3)
  text += `4\nframe ${k}\nC 1 0 0\nC 0 0 0\nC 0 1 0\nH ${Math.sin(phi).toFixed(6)} 1 ${Math.cos(phi).toFixed(6)}\n`
}
const traj = path.join(temp, 'torsion-long.xyz')
fs.writeFileSync(traj, text)
const bridge = command => {
  const out = execFileSync(python, [path.join(root, 'ase_bridge.py')], { input: JSON.stringify(command), env, maxBuffer: 1 << 28 }).toString()
  return out.trim().split('\n').map(line => JSON.parse(line)).find(message => message.type === 'result' || message.type === 'error')
}
// Log the steps the way renderer.js does: call with MONET IDs, params without paths.
const mapping = [1, 2, 3, 4].map((monetId, aseIndex) => ({ monetId, aseIndex }))
const s = P.create({ monet_version: '2.1.0' })
const S1 = s.addSource({ name: 'torsion-long.xyz', size: text.length, sha256: crypto.createHash('sha256').update(text).digest('hex'), format: 'XYZ', frames: 400, atoms: 4 })
s.record({ kind: 'load', source: S1, params: { name: 'torsion-long.xyz' } })
function log (kind, command, source, outputs) {
  const { name, args } = C.toCall(command, mapping)
  const params = Object.fromEntries(Object.entries(command).filter(([key]) => !['filename', 'output'].includes(key)))
  const id = s.begin({ kind, action: command.action, source, call: C.format(name, args), params, atoms: C.atomIds(args) })
  const result = bridge(command)
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 300))
  s.finish(id, result, { outputs })
  return { id, result }
}
const acf = log('analysis', { action: 'acf', filename: traj, quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 0.5, tau_int_method: 'sokal', mic: true }, S1)
assert.ok(Number.isFinite(acf.result.tau_int)); checks++
log('analysis', { action: 'equilibration', filename: traj, quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 0.5, mic: true }, S1)
const derivedFile = path.join(temp, 'derived.extxyz')
const sub = log('derive', { action: 'subsample', filename: traj, stride: 4, start: 0, output: derivedFile, mic: true }, S1, [{ file: 'torsion-long-uncorrelated.extxyz' }])
const S2 = s.addSource({ name: 'torsion-long-uncorrelated.extxyz', frames: sub.result.n_frames, atoms: 4, parent: { source: S1, step: sub.id } })
s.addOutput(sub.id, { source: S2 })
const rmsd = log('analysis', { action: 'rmsd', filename: derivedFile, frame_step: 1, align: true, mic: true }, S2)
const cleared = log('analysis', { action: 'dihedrals', filename: traj, quads: [[0, 1, 2, 3]], frame_step: 1, angle_range: '360', mic: true }, S1)
s.clear(cleared.id)
const script = R.replayScript(s.toJSON())
assert.match(script, /^S1 = s\.load\(name="torsion-long\.xyz", sha256="[0-9a-f]{64}", atoms=4, step=1\)$/m); checks++
assert.match(script, /^s\.options\(cell=None, pbc=None, mic=True, bond_scale=None\)$/m); checks++
assert.match(script, new RegExp(`^s\\.acf\\(S1, step=${acf.id}, quantity="dihedral", groups=\\[\\[1, 2, 3, 4\\]\\], dt=0\\.5, tau_int_method="sokal", expect=\\{`, 'm')); checks++
assert.match(script, new RegExp(`^S2 = s\\.derive\\(S1, "subsample", step=${sub.id}, start=0, stride=4, expect=`, 'm')); checks++
assert.match(script, new RegExp(`^s\\.rmsd\\(S2, step=${rmsd.id}, frame_step=1, align=True`, 'm')); checks++
assert.match(script, new RegExp(`^# step ${cleared.id} dihedrals: cleared in MONET$`, 'm')); assert.match(script, /^# {3}s\.dihedrals\(/m); checks++
assert.doesNotMatch(script, new RegExp(temp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); checks++
// Run it in a folder that holds a copy of the trajectory.
const work = path.join(temp, 'work')
fs.mkdirSync(work)
fs.copyFileSync(traj, path.join(work, 'torsion-long.xyz'))
fs.writeFileSync(path.join(work, 'replay.py'), script)
const run = (...extra) => spawnSync(python, ['replay.py', '--monet', root, '--out', 'out', ...extra], { cwd: work, env, encoding: 'utf8' })
let done = run()
assert.equal(done.status, 0, done.stdout + done.stderr); checks++
assert.match(done.stdout, new RegExp(`OK   step ${acf.id} acf \\(\\d+ values\\)`)); assert.match(done.stdout, new RegExp(`OK   step ${rmsd.id} rmsd`)); assert.doesNotMatch(done.stdout, /DIFF|FAIL/); checks++
assert.ok(fs.existsSync(path.join(work, 'out', `step${String(acf.id).padStart(2, '0')}_acf.json`))); checks++
// A changed number is reported as DIFF, with exit code 1.
fs.writeFileSync(path.join(work, 'replay.py'), script.replace(/"tau_int": ([-0-9.e+]+)/, (_, v) => `"tau_int": ${Number(v) * 1.5}`))
done = run()
assert.equal(done.status, 1); assert.match(done.stdout, new RegExp(`DIFF step ${acf.id} acf: tau_int: logged`)); checks++
// A different input file stops the replay unless --force is given.
fs.writeFileSync(path.join(work, 'replay.py'), script)
fs.appendFileSync(path.join(work, 'torsion-long.xyz'), '\n')
done = run()
assert.notEqual(done.status, 0); assert.match(done.stderr, /differs from the logged/); checks++
done = run('--force')
assert.match(done.stdout, /WARNING: torsion-long\.xyz: SHA-256/); checks++
fs.rmSync(temp, { recursive: true, force: true })
console.log(`PASS: ${checks} replay checks (replay.py generation, headless re-run, DIFF, checksum stop).`)

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
const rawPython = process.env.PYTHON || 'python3'
const python = rawPython.includes('/') || rawPython.includes(path.sep) ? path.resolve(rawPython) : rawPython
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
// bonds has only 'mean:<key>' results (a statistic, not a logged raw number): replay runs it but has
// nothing to compare, so it must print RAN rather than a false OK.
const bonds = log('analysis', { action: 'bonds', filename: traj, pairs: [[0, 1]], frame_step: 1, mic: true }, S1)
const cleared = log('analysis', { action: 'dihedrals', filename: traj, quads: [[0, 1, 2, 3]], frame_step: 1, angle_range: '360', mic: true }, S1)
s.clear(cleared.id)
const script = R.replayScript(s.toJSON())
assert.match(script, /^S1 = s\.load\(name="torsion-long\.xyz", sha256="[0-9a-f]{64}", atoms=4, step=1\)$/m); checks++
assert.match(script, /^s\.options\(cell=None, pbc=None, mic=True, bond_scale=None\)$/m); checks++
assert.match(script, new RegExp(`^s\\.acf\\(S1, step=${acf.id}, quantity="dihedral", groups=\\[\\[1, 2, 3, 4\\]\\], dt=0\\.5, tau_int_method="sokal", expect=\\{`, 'm')); checks++
assert.match(script, new RegExp(`^S2 = s\\.derive\\(S1, "subsample", step=${sub.id}, start=0, stride=4, expect=`, 'm')); checks++
assert.match(script, new RegExp(`^s\\.rmsd\\(S2, step=${rmsd.id}, frame_step=1, align=True`, 'm')); checks++
// bonds has no raw key to compare (only 'mean:0-1', dropped by replaygen's expected()), so no
// expect= kwarg is generated for it.
assert.match(script, new RegExp(`^s\\.bonds\\(S1, step=${bonds.id}, pairs=\\[\\[1, 2\\]\\], frame_step=1\\)$`, 'm')); checks++
assert.match(script, new RegExp(`^# step ${cleared.id} dihedrals: cleared in MONET$`, 'm')); assert.match(script, /^# {3}s\.dihedrals\(/m); checks++
assert.doesNotMatch(script, new RegExp(temp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); checks++
// A step on a source that was never assigned in the script (derived while the history was paused,
// or not logged, or in Electron mode without a filePath) must be skipped with an explanatory
// comment instead of splicing in a bare Sn that NameErrors when Python runs the line.
const gap = P.create({ monet_version: '2.1.0' })
const gapSha = crypto.createHash('sha256').update('gap').digest('hex')
const GS1 = gap.addSource({ name: 'gap.xyz', sha256: gapSha, format: 'XYZ', frames: 2, atoms: 4 })
gap.record({ kind: 'load', source: GS1, params: { name: 'gap.xyz' } })
// GS2 exists as a source (addSource is never gated by pause) but no step in this session ever
// assigned it, unlike S2 above.
const GS2 = gap.addSource({ name: 'gap-derived.xyz', sha256: null, format: 'XYZ', frames: 2, atoms: 4, parent: { source: GS1, step: null } })
const gapStepId = gap.begin({ kind: 'analysis', action: 'rmsd', source: GS2, call: 'rmsd(frame_step=1)', params: { frame_step: 1 }, atoms: [] })
gap.finish(gapStepId, { ok: true, reference_index: 0, rmsd: [0, 0.1] })
const gapScript = R.replayScript(gap.toJSON())
assert.match(gapScript, new RegExp(`^# step ${gapStepId} rmsd: source ${GS2} is not defined in this script \\(it was derived while the history was paused or not logged\\), not replayed$`, 'm')); checks++
assert.doesNotMatch(gapScript, new RegExp(`s\\.rmsd\\(${GS2}`)); checks++
const gapPath = path.join(temp, 'gap_replay.py')
fs.writeFileSync(gapPath, gapScript)
assert.doesNotThrow(() => execFileSync(python, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', gapPath], { encoding: 'utf8' })); checks++
// Regression: session files are shareable and every value in one is untrusted. Tampered values
// must never become executable Python -- only a safe literal (via C.formatValue) or a single-line
// comment with newlines stripped.
const evil = s.toJSON()
evil.steps[0].source = "S1\nimport os\nos.system('echo pwned')\nx"
const evilFailStep = evil.steps.find(step => step.action === 'equilibration')
evilFailStep.status = 'error'
evilFailStep.error = 'boom\nimport os'
evil.created = 'x"""\nimport os\n"""'
// A malicious parameter *name* (not just value): stepCode's `extract` branch used to spread
// step.params straight into C.formatArgs, so a key like this became a live Python line. It must
// now be dropped -- extract only forwards selected/frequency/compute_average/qm -- and any other
// place formatArgs sees session-controlled keys (e.g. the 'cell' comment line) must degrade to a
// comment rather than throw or emit the key as code.
const evilKey = ")\nimport os\nos.system('pwned')\n#"
// A clean source/load of its own (not S1, whose own load id was just tampered above and is
// therefore never assigned): the extract step below must still be replayed on this one, so this
// check stays about the parameter allowlist, not about step 1's source id.
evil.sources.push({ id: 'S9', name: 'evil-extra.xyz', size: 4, sha256: 'ab'.repeat(32), format: 'XYZ', frames: 1, atoms: 1, atom_ids: null, label: null, import: null, parent: null })
evil.steps.push({
  id: 900, time: s.data.updated, kind: 'load', action: null, source: 'S9', call: null,
  params: { name: 'evil-extra.xyz' }, atoms: [], result: {}, outputs: [], rerun_of: null, status: 'ok', error: null, note: '', final: false
})
evil.steps.push({
  id: 901, time: s.data.updated, kind: 'extract', action: 'extract', source: 'S9', call: null,
  params: { [evilKey]: 1, selected: [1, 2], frequency: 1 }, atoms: [], result: {}, outputs: [],
  rerun_of: null, status: 'ok', error: null, note: '', final: false
})
evil.steps.push({
  id: 902, time: s.data.updated, kind: 'cell', action: null, source: null, call: null,
  params: { [evilKey]: 1, cell: [10, 10, 10, 90, 90, 90] }, atoms: [], result: {}, outputs: [],
  rerun_of: null, status: 'ok', error: null, note: '', final: false
})
const evilScript = R.replayScript(evil)
// The fixed header legitimately has one 'import os' line (argparse needs os.environ); the
// tampered session values must not add any more of these lines, nor any 'os.system(' call.
const countLinesMatching = (text, re) => text.split('\n').filter(l => re.test(l)).length
assert.equal(countLinesMatching(evilScript, /^import os\b/), countLinesMatching(script, /^import os\b/)); checks++
assert.equal(countLinesMatching(evilScript, /^os\.system\(/), 0); checks++
// Stronger check: 'os.system(' must never appear except inside a '#' comment, anywhere on the line.
for (const l of evilScript.split('\n')) if (l.includes('os.system(')) assert.ok(l.trimStart().startsWith('#'), l); checks++
// The extract step's malicious param name was dropped, but the legitimate ones still made it in
// as real (non-comment) replay code.
assert.match(evilScript, /^s\.extract\(S9, step=901, selected=\[1, 2\], frequency=1/m); checks++
const normalPath = path.join(temp, 'normal_replay.py')
const evilPath = path.join(temp, 'evil_replay.py')
fs.writeFileSync(normalPath, script)
fs.writeFileSync(evilPath, evilScript)
assert.doesNotThrow(() => execFileSync(python, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', evilPath], { encoding: 'utf8' })); checks++
const countImports = file => execFileSync(python, ['-c', 'import ast,sys; t=ast.parse(open(sys.argv[1]).read()); print(sum(isinstance(n,(ast.Import,ast.ImportFrom)) for n in ast.walk(t)))', file], { encoding: 'utf8' }).trim()
assert.equal(countImports(evilPath), countImports(normalPath)); checks++
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
// bonds has no raw keys to compare: it ran (not skipped, not failed) but there is nothing logged to
// check it against, so it prints RAN rather than a false OK, and doesn't count toward "checked".
assert.match(done.stdout, new RegExp(`RAN  step ${bonds.id} bonds \\(no logged values to compare\\)`)); checks++
assert.match(done.stdout, /\n\d+ values compared: \d+ steps differ, \d+ failed, \d+ steps ran without logged values\. Outputs in /); checks++
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

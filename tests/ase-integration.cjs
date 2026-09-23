'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { File } = require('node:buffer')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const fileText = fs.readFileSync(path.join(root, 'examples/water.XYZ'), 'utf8')
const child = spawn(process.env.PYTHON || 'python3', [path.join(root, 'start_monet.py'), '--port', '0', '--no-browser'])
let checks = 0
async function main () {
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 10000)
    let buffer = ''
    child.on('error', reject)
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)) })
    child.stdout.on('data', chunk => {
      buffer += chunk
      const match = buffer.match(/MONET: (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
  })
  const html = await (await fetch(origin)).text()
  const token = html.match(/name="monet-api-token" content="([^"]+)"/)[1]
  assert.ok(token); checks++
  assert.equal((await fetch(origin + '/ase_bridge.py')).status, 404); checks++
  assert.equal((await fetch(origin + '/api/check', { method: 'POST', body: '{}' })).status, 403); checks++
  const cross = await fetch(origin + '/api/check', { method: 'POST', headers: { 'X-Monet-Token': token, Origin: 'https://example.com' }, body: '{}' })
  assert.equal(cross.status, 403); checks++
  let file = new File([fileText], 'water.XYZ')
  const download = async result => {
    assert.match(result.downloadURL, /^\/api\/download\/[^?]+\?token=/)
    const response = await fetch(origin + result.downloadURL)
    assert.equal(response.status, 200)
    return Buffer.from(await response.arrayBuffer())
  }
  const downloaded = { text: async () => (await download(lastResult)).toString('utf8') }
  let lastResult
  const context = {
    window: {}, MonetXYZ: require('../xyz.js'), File, Blob, TextEncoder, TextDecoder, AbortController, atob, setTimeout, clearTimeout,
    fetch: (route, options) => fetch(origin + route, options),
    URL: { createObjectURL () { throw new Error('Launcher mode must not build results in page memory.') }, revokeObjectURL () {} },
    document: {
      querySelector: () => ({ content: token }), body: { appendChild () {} },
      createElement () {
        const callbacks = {}
        return { files: [file], remove () {}, addEventListener (name, callback) { callbacks[name] = callback }, click () { callbacks.change() } }
      }
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'browser-bridge.js'), 'utf8'), context)
  const api = context.window.monet
  const rawRun = api.aseRun
  api.aseRun = async command => (lastResult = await rawRun(command))
  const status = await api.aseCheck()
  assert.equal(status.ok, true, JSON.stringify(status)); checks++
  const name = await api.selectFile()
  let result = await api.aseRun({ action: 'rmsd', filename: name, frame_step: 1 })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.ok(Math.abs(result.rmsd[1] - .1) < 1e-10); checks++
  result = await api.aseRun({ action: 'bonds', filename: name, pairs: [[0, 1]], frame_step: 1 })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.ok(Math.abs(result.series['0-1'][0] - Math.hypot(.757, .586)) < 1e-10); checks++
  result = await api.aseRun({ action: 'angles', filename: name, triplets: [[1, 0, 2]], frame_step: 1 })
  assert.equal(result.ok, true, JSON.stringify(result))
  const expectedAngle = Math.acos((-(.757 ** 2) + .586 ** 2) / (.757 ** 2 + .586 ** 2)) * 180 / Math.PI
  assert.ok(Math.abs(result.series['1-0-2'][0] - expectedAngle) < 1e-10); checks++
  result = await api.aseRun({ action: 'pdd', filename: name, elements: ['O', 'H'], nbins: 10, rmax: 3, frame_step: 1 })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.counts.reduce((a, b) => a + b, 0), 4); checks++
  for (const command of [
    { action: 'bonds', pairs: [[-1, 1]] }, { action: 'angles', triplets: [[0, 0, 1]] },
    { action: 'rmsd', frame_step: 0 }, { action: 'rmsd', frame_step: 1.5 },
    { action: 'pdd', nbins: 0 }, { action: 'bonds', pairs: [[0, 9]] }
  ]) {
    result = await api.aseRun({ filename: name, frame_step: 1, ...command })
    assert.equal(result.ok, false, JSON.stringify(command)); checks++
  }
  // Launcher mode: scan, frame and extraction run in Python on the uploaded copy.
  assert.deepEqual(JSON.parse(JSON.stringify(await api.analyzeFile(name))), { atomCount: 3, configCount: 2, format: 'XYZ', filePath: name }); checks++
  assert.deepEqual(JSON.parse(JSON.stringify((await api.readFrame(name, 1)).atoms[0])), { index: 1, element: 'O', x: .1, y: 0, z: 0 }); checks++
  assert.match((await api.readFrame(name, 5)).error, /outside/); checks++
  // The launcher's frame action returns the frame's lattice (null without one).
  assert.equal((await api.readFrame(name, 0)).lattice, null); checks++
  {
    const saved = file
    file = new File([fs.readFileSync(path.join(root, 'examples/periodic-water.xyz'), 'utf8')], 'periodic-water.xyz')
    const periodicWater = await api.selectFile()
    assert.deepEqual(JSON.parse(JSON.stringify((await api.readFrame(periodicWater, 0)).lattice)), [[10, 0, 0], [0, 10, 0], [0, 0, 10]]); checks++
    file = saved
  }
  // A malformed frame lattice (wrong count, non-numeric, broken quoting) is reported as no lattice, never as a failed frame.
  {
    const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'monet-lattice-'))
    const frame = header => `1\n${header}\nO 0 0 0\n`
    const xyz = path.join(temp, 'lattices.xyz')
    fs.writeFileSync(xyz, [
      'Lattice="10 0 0 0 10 0 0 0 10" Properties=species:S:1:pos:R:3',
      'Lattice="10 0 0 0 10" Properties=species:S:1:pos:R:3',
      'Lattice="a b c d e f g h i" Properties=species:S:1:pos:R:3',
      'Lattice="10 0 0 0 10 0 0 0 10 Properties=species:S:1:pos:R:3',
      'Lattice="10 0 0 0 10 0 0 0 nan" Properties=species:S:1:pos:R:3'
    ].map(frame).join(''))
    const out = require('node:child_process').execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import ase_bridge, monet_io
traj = monet_io.XYZTrajectory(sys.argv[2], use_cache=False)
print(json.dumps([ase_bridge._frame_lattice(traj, comment) for _, _, comment in traj.iter_frames(list(range(traj.nframes)))]))
`, root, xyz]).toString()
    assert.deepEqual(JSON.parse(out.trim().split('\n').pop()), [[[10, 0, 0], [0, 10, 0], [0, 0, 10]], null, null, null, null]); checks++
    fs.rmSync(temp, { recursive: true, force: true })
  }
  const events = []
  api.onProgress(event => events.push(event))
  const processed = await api.processTrajectory({ filePath: name, atomCount: 3, selectedAtoms: [1, 3], frequency: 1, computeAverage: true, generateGaussian: true })
  assert.equal(processed.success, true, JSON.stringify(processed)); assert.equal(processed.sampledFrames, 2); checks++
  assert.ok(events.some(event => event.status === 'done')); checks++
  const zipped = await download({ downloadURL: processed.downloadURL })
  const temp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'monet-int-'))
  fs.writeFileSync(path.join(temp, 'results.zip'), zipped)
  require('node:child_process').execFileSync(process.env.PYTHON || 'python3', ['-c', `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 names = set(z.namelist())
 assert len(names) == 10, names
 text = z.read('3-AVERAGE_STRUCTURE/GEO-AVERAGE.xyz').decode().splitlines()
 assert int(text[0]) == 3 and abs(float(text[2].split()[1]) - 0.05) < 1e-9
 assert '%chk=s0.chk' in z.read('2-SAMPLED_CONFIGURATIONS/conf1/sing.dat').decode()
 full = z.read('1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz').decode()
 assert full.splitlines()[:3] == ['2', 'frame 0', 'O  0.0000000  0.0000000  0.0000000'], full
`, path.join(temp, 'results.zip')]); checks++
  fs.rmSync(temp, { recursive: true, force: true })
  assert.equal((await fetch(origin + processed.downloadURL.replace(/token=.*/, 'token=wrong'))).status, 403); checks++
  result = await api.aseRun({ action: 'bonds', filename: 'MONET-results/1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz', pairs: [[0, 1]], frame_step: 1 })
  assert.equal(result.ok, true, JSON.stringify(result)); checks++
  // A separately selected conversion file must not replace a loaded input with the same name.
  file = new File(['1\n\nHe 0 0 0\n'], 'water.XYZ')
  const second = await api.selectFile()
  assert.notEqual(name, second); checks++
  result = await api.aseRun({ action: 'convert', input: name, output: 'water.extxyz', format: 'extxyz', first_frame_only: false })
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.n_frames, 2)
  assert.match(await downloaded.text(), /Properties=species:S:1:pos:R:3/); checks++
  result = await api.aseRun({ action: 'convert', input: name, output: 'water.gjf', format: 'gaussian-in', first_frame_only: true })
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.n_frames, 1); checks++
  result = await api.aseRun({ action: 'convert', input: name, output: 'water.gjf', format: 'gaussian-in', first_frame_only: false })
  assert.equal(result.ok, false); assert.match(result.message, /first frame/); checks++
  result = await api.aseRun({ action: 'convert', input: name, output: 'water.vasp', format: 'vasp', first_frame_only: true })
  assert.equal(result.ok, false); assert.match(result.message, /cell vectors/); checks++
  // Verify the loaded/extracted atom lists against what ASE actually reads.
  const model = require('../ase-model.js')
  const xyz = require('../xyz.js')
  const parser = new xyz.Parser()
  let firstFrame
  for (const line of fileText.split('\n')) { const frame = parser.push(line); if (frame && !firstFrame) firstFrame = frame }
  result = await api.aseRun({ action: 'read_info', filename: name })
  assert.equal(model.verifyAtoms(model.atomMap(firstFrame.atoms), result), true); checks++
  result = await api.aseRun({ action: 'read_info', filename: 'MONET-results/1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz' })
  const mapping = model.atomMap(firstFrame.atoms, [3, 1])
  assert.deepEqual(mapping.map(atom => atom.monetId), [1, 3])
  assert.equal(model.verifyAtoms(mapping, result), true); checks++
  assert.deepEqual(model.groupsFromIds('1 3', 2, mapping), [[0, 1]]); checks++
  assert.throws(() => model.groupsFromIds('1 2', 2, mapping), /not in/); checks++
  assert.throws(() => model.verifyAtoms(mapping.slice().reverse(), result), /does not match/); checks++
  file = new File([fs.readFileSync(path.join(root, 'examples/torsion.xyz'), 'utf8')], 'torsion.xyz')
  const torsionName = await api.selectFile()
  result = await api.aseRun({ action: 'dihedrals', filename: torsionName, quads: [[0, 1, 2, 3]], frame_step: 1 })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(result.series['0-1-2-3'], [270, 90]); checks++
  result = await api.aseRun({ action: 'dihedrals', filename: torsionName, quads: [[0, 1, 2, 3]], frame_step: 2 })
  assert.deepEqual(result.frame_indices, [0]); checks++
  for (const quads of [[[0, 1, 2, 2]], [[0, 1, 2, 4]]]) {
    result = await api.aseRun({ action: 'dihedrals', filename: torsionName, quads, frame_step: 1 })
    assert.equal(result.ok, false); checks++
  }
  file = new File(['4\ncollinear\nC 0 0 0\nC 1 0 0\nC 2 0 0\nH 3 0 0\n'], 'linear.xyz')
  const linearName = await api.selectFile()
  result = await api.aseRun({ action: 'dihedrals', filename: linearName, quads: [[0, 1, 2, 3]], frame_step: 1 })
  assert.equal(result.ok, false); checks++
  // Selected-atom RMSD must exclude motion of unselected atoms.
  file = new File(['2\nframe0\nC 0 0 0\nH 1 0 0\n2\nframe1\nC 0 0 0\nH 3 0 0\n'], 'subset.xyz')
  const subsetName = await api.selectFile()
  result = await api.aseRun({ action: 'rmsd', filename: subsetName, indices: [0], frame_step: 1 })
  assert.deepEqual(result.rmsd, [0, 0]); checks++
  result = await api.aseRun({ action: 'rmsd', filename: subsetName, indices: [1], frame_step: 1 })
  assert.deepEqual(result.rmsd, [0, 2]); checks++
  result = await api.aseRun({ action: 'pdd', filename: name, indices: [0, 1], nbins: 10, rmax: 3, frame_step: 1 })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.counts.reduce((sum, value) => sum + value, 0), 2); checks++
  for (const indices of [[0, 0], [], [20], [-1]]) {
    result = await api.aseRun({ action: 'rmsd', filename: name, indices, frame_step: 1 })
    assert.equal(result.ok, false); checks++
  }
  result = await api.aseRun({ action: 'pdd', filename: name, indices: [0], frame_step: 1 })
  assert.equal(result.ok, false); checks++
  // Crystal geometry, finite molecules across boundaries, and angular conventions.
  const cell = [10, 10, 10, 90, 90, 90]
  file = new File(['4\nTwo OH molecules, one across x boundary\nO .2 0 0\nH 9.4 0 0\nO 5 5 5\nH 5.8 5 5\n'], 'periodic.xyz')
  const periodicName = await api.selectFile()
  result = await api.aseRun({ action: 'read_info', filename: periodicName, cell, pbc: [true, false, false] })
  assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(result.cellpar, cell); assert.deepEqual(result.pbc, [true, false, false]); checks++
  for (const [mic, expected] of [[true, .8], [false, 9.2]]) {
    result = await api.aseRun({ action: 'bonds', filename: periodicName, pairs: [[0, 1]], cell, mic })
    assert.equal(result.ok, true, JSON.stringify(result)); assert.ok(Math.abs(result.series['0-1'][0] - expected) < 1e-9); checks++
  }
  result = await api.aseRun({ action: 'molecule', filename: periodicName, seed: 1, cell, mic: true, bond_scale: 1.2 })
  assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(result.indices, [1, 0]); checks++
  result = await api.aseRun({ action: 'molecule', filename: periodicName, seed: 1, cell, mic: false })
  assert.deepEqual(result.indices, [1]); checks++
  result = await api.aseRun({ action: 'molecule', filename: periodicName, seed: 2, cell, mic: true })
  assert.deepEqual(result.indices, [2, 3]); checks++
  // Selection tools: ASE neighbour list with the minimum image, element, sphere and bonded chains.
  result = await api.aseRun({ action: 'select_atoms', mode: 'molecules', filename: periodicName, indices: [1], cell, mic: true, bond_scale: 1.2 })
  assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(result.indices, [1, 0]); checks++
  result = await api.aseRun({ action: 'select_atoms', mode: 'neighbors', filename: periodicName, indices: [1], cell, mic: false })
  assert.deepEqual(result.indices, [1]); checks++
  result = await api.aseRun({ action: 'select_atoms', mode: 'bonds', filename: periodicName, pattern: ['*', '*'], cell, mic: true })
  assert.equal(result.ok, true, JSON.stringify(result)); assert.ok(result.groups.some(g => g.includes(0) && g.includes(1))); checks++
  result = await api.aseRun({ action: 'select_atoms', mode: 'within', filename: periodicName, indices: [0], radius: 31, cell })
  assert.equal(result.ok, false); checks++
  result = await api.aseRun({ action: 'convert', input: periodicName, output: 'crystal.extxyz', format: 'extxyz', cell, pbc: [true, false, false], first_frame_only: true })
  assert.equal(result.ok, true, JSON.stringify(result)); const cellText = await downloaded.text(); assert.match(cellText, /Lattice=/); assert.match(cellText, /pbc="T F F"/); checks++
  file = new File([cellText], 'native-cell.xyz'); const nativeCellName = await api.selectFile()
  result = await api.aseRun({ action: 'bonds', filename: nativeCellName, pairs: [[0, 1]], mic: true })
  assert.ok(Math.abs(result.series['0-1'][0] - .8) < 1e-9); checks++
  result = await api.aseRun({ action: 'convert', input: name, output: 'water.vasp', format: 'vasp', cell, first_frame_only: true })
  assert.equal(result.ok, true, JSON.stringify(result)); checks++
  for (const badCell of [[0,10,10,90,90,90], [10,10,10,1,1,179], [10,10,10,90,180,90], [10,10]]) {
    result = await api.aseRun({ action: 'read_info', filename: name, cell: badCell }); assert.equal(result.ok, false); checks++
  }
  file = new File(['1\nInfinite carbon network\nC 0 0 0\n'], 'network.xyz'); const networkName = await api.selectFile()
  result = await api.aseRun({ action: 'molecule', filename: networkName, seed: 0, cell: [1.4,10,10,90,90,90], mic: true })
  assert.equal(result.ok, false); assert.match(result.message, /periodic network/); checks++
  file = new File(['3\nDirected angle\nC 1 0 0\nC 0 0 0\nC 0 9 0\n'], 'directed.xyz'); const directedName = await api.selectFile()
  for (const [mode, normal, expected] of [['natural', [0,0,1], 90], ['360', [0,0,1], 270], ['360', [0,0,-1], 90], ['signed90', [0,0,1], -90]]) {
    result = await api.aseRun({ action: 'angles', filename: directedName, triplets: [[0,1,2]], cell, mic: true, angle_range: mode, angle_normal: normal })
    assert.equal(result.ok, true, JSON.stringify(result)); assert.ok(Math.abs(result.series['0-1-2'][0] - expected) < 1e-9); checks++
  }
  for (const normal of [[0,0,0], [1,0,0], [1,2]]) {
    result = await api.aseRun({ action: 'angles', filename: directedName, triplets: [[0,1,2]], cell, mic: true, angle_range: '360', angle_normal: normal })
    assert.equal(result.ok, false); checks++
  }
  result = await api.aseRun({ action: 'dihedrals', filename: torsionName, quads: [[0,1,2,3]], angle_range: 'signed90' })
  assert.deepEqual(result.series['0-1-2-3'], [-90,-90]); checks++
  result = await api.aseRun({ action: 'dihedrals', filename: torsionName, quads: [[0,1,2,3]], angle_range: 'fold180' })
  assert.deepEqual(result.series['0-1-2-3'], [90, 90]); checks++
  file = new File(['4\nWrapped torsion\nC 1 0 0\nC 0 0 0\nC 0 1 0\nH 10 1 1\n'], 'wrapped-torsion.xyz'); const wrappedName = await api.selectFile()
  result = await api.aseRun({ action: 'dihedrals', filename: wrappedName, quads: [[0,1,2,3]], cell, mic: true })
  assert.ok(Math.abs(result.series['0-1-2-3'][0] - 270) < 1e-8); checks++
  result = await api.aseRun({ action: 'pdd', filename: periodicName, indices: [0,1], cell, mic: true, nbins: 10, rmax: 2 })
  assert.equal(result.counts.reduce((sum, value) => sum+value, 0), 1); checks++
  // Negative backend path injection: request paths cannot be used to read local files.
  const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { 'X-Monet-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const forbidden = await post('/api/run', { action: 'rmsd', filename: '/etc/passwd' })
  assert.equal(forbidden.status, 400); checks++
  assert.equal((await post('/api/run', { action: 'rmsd', file_id: '../../etc/passwd' })).status, 400); checks++
  // Irregular layouts (blank lines between frames) use the tolerant indexer; broken files report the JS messages.
  file = new File(['\n2\na\nH 0 0 0\nH 0 0 .74\n\n\n2\nb\nH 0 0 0\nH 0 0 .8\n\n'], 'gaps.xyz'); const gapsName = await api.selectFile()
  assert.equal((await api.analyzeFile(gapsName)).configCount, 2); checks++
  result = await api.aseRun({ action: 'bonds', filename: gapsName, pairs: [[0, 1]] })
  assert.deepEqual(result.series['0-1'], [.74, .8]); checks++
  for (const [text, pattern] of [['2\n\nH 0 0 0', /Incomplete/], ['2\n\nH 0 0 0\nH 0 0 1\n3\n\n', /constant/], ['1\n\nH 0x10 0 0\n', /numeric/], ['2\n\nH 0 0 0\nH 0 0 1\n2\n\nH 0 0 0\nC 0 0 1\n', /elements/]]) {
    file = new File([text], 'broken.xyz'); const brokenName = await api.selectFile()
    assert.match((await api.analyzeFile(brokenName)).error + (await api.processTrajectory({ filePath: brokenName, atomCount: 2, selectedAtoms: [1], frequency: 1 })).error, pattern, text); checks++
  }
  // Launcher import: CPMD TRAJECTORY + reference structure, then analysis on the imported copy.
  file = new File(['1 0 0 0 0 0 0\n1 0 0 2.13 0 0 0\n2 0 0 0 0 0 0\n2 0 0 2.2 0 0 0\n'], 'TRAJECTORY'); const trajName = await api.selectFile()
  file = new File(['2\nref\nC 0 0 0\nO 0 0 1.1\n'], 'ref.xyz'); const refName = await api.selectFile()
  assert.match((await api.importFile(trajName, { format: 'auto' })).error, /reference/); checks++
  const imported = await api.importFile(trajName, { format: 'auto', reference: refName })
  assert.equal(imported.frames, 2, JSON.stringify(imported)); assert.equal(imported.sourceLabel, 'CPMD TRAJECTORY'); checks++
  assert.equal((await api.analyzeFile(imported.filePath)).configCount, 2); checks++
  result = await api.aseRun({ action: 'bonds', filename: imported.filePath, pairs: [[0, 1]] })
  assert.ok(Math.abs(result.series['0-1'][1] - 2.2 * 0.529177210903) < 1e-7, JSON.stringify(result)); checks++
  // Format list for the import menu.
  const listed = await api.listFormats()
  assert.equal(listed.ok, true); assert.ok(listed.ase.length > 50); checks++
  // Cancelling a running job stops its Python process.
  const bigFrames = Array.from({ length: 4000 }, (_, i) => `3\nframe ${i}\n` + 'C 0 0 0\nH 0 0 1.1\nH 0 1 0\n'.repeat(1)).join('')
  file = new File([bigFrames], 'long.xyz'); const longName = await api.selectFile()
  const pending = api.aseRun({ action: 'angles', filename: longName, triplets: Array.from({ length: 200 }, () => [1, 0, 2]) })
  await new Promise(resolve => setTimeout(resolve, 400))
  await api.cancel('ase')
  result = await pending
  assert.equal(result.ok, false); assert.equal(result.cancelled, true, JSON.stringify(result)); checks++
  await api.releaseFile(longName)
  result = await api.aseRun({ action: 'rmsd', filename: longName })
  assert.equal(result.ok, false); checks++
  console.log(`PASS: ${checks} live integration checks with ASE ${status.ase_version}.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => child.kill())

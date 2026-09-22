'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { File } = require('node:buffer')
const XYZ = require('../xyz.js')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'examples/water.XYZ'), 'utf8')
let checks = 0
function parse (text) {
  const parser = new XYZ.Parser()
  for (const line of text.split(/\r\n|\n|\r/)) parser.push(line)
  return parser.finish()
}
for (const [name, text, format] of [
  ['standard', source, 'XYZ'],
  ['CRLF and BOM', '\uFEFF' + source.replace(/\n/g, '\r\n'), 'XYZ'],
  ['CPMD', source.replace('Water frame 0', 'STEP = 0'), 'CPMD'],
  ['CP2K', source.replace('Water frame 0', 'i = 0, E = -12'), 'CP2K'],
  ['trailing blanks', source + '\n\n', 'XYZ']
]) {
  assert.deepEqual(parse(text), { atomCount: 3, configCount: 2, format }, name); checks++
}
for (const text of ['', '0\n\n', '1\n\nH 0x10 0 0', '1\n\nH 0b1 0 0', 'Infinity', '1\n\nH Infinity 0 0', '2\nmissing atom\nH 0 0 0', '1\n\nH NaN 0 0', '1\n\nH 1x 0 0', source + '2\n\nH 0 0 0\nH 1 0 0', source.replace('H -0.657', 'C -0.657')]) {
  assert.throws(() => parse(text)); checks++
}
const extended = new XYZ.Parser()
let frame
for (const line of ['1', 'Properties=charge:R:1:species:S:1:pos:R:3', '0 cl 1D-2 .5 -2e0']) frame = extended.push(line) || frame
assert.deepEqual(frame.atoms[0], { index: 1, element: 'Cl', x: .01, y: .5, z: -2 }); checks++

// Circular statistics used for the legends of angle plots.
const model = require('../ase-model.js')
const stat = (values, range) => model.seriesStats(values, range)
assert.ok(Math.abs(stat([1, 2, 3]).mean - 2) < 1e-12 && Math.abs(stat([1, 2, 3]).std - 1) < 1e-12); checks++
assert.ok(Math.abs(stat([350, 10], '360').mean) < 1e-9 && stat([350, 10], '360').std < 11); checks++
assert.ok(Math.abs(stat([175, 5], 'fold180').mean) < 1e-9); checks++
assert.ok(Math.abs(stat([85, -85], 'signed90').mean + 90) < 1e-9); checks++
assert.ok(Math.abs(stat([170, 10], 'natural').mean - 90) < 1e-12); checks++
assert.equal(stat([NaN]), null); checks++
const hist = model.histogram([0.5, 1.5, 1.6], 2, 0, 2)
assert.deepEqual(hist.density, [1 / 3, 2 / 3]); checks++

// Sokal τ_int (same value as monet_analysis.integrated_time) and g of configurations taken every s lags.
const expAcf = Array.from({ length: 2000 }, (_, k) => Math.exp(-k / 40))
assert.ok(Math.abs(model.tauFromAcf(expAcf) - 39.7292) < 1e-3); checks++
assert.ok(Math.abs(model.subsampleInefficiency(expAcf, 40) - (1 + 2 / (Math.E - 1))) < 1e-3); checks++
assert.equal(model.subsampleInefficiency([1, 0, 0.5], 1), 1); assert.equal(model.subsampleInefficiency(expAcf, 39.6), model.subsampleInefficiency(expAcf, 40)); checks++

// Grid bond search equals the brute-force result and scales to large systems.
{
  const { findBonds } = require('../viewer.js')
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const elements = ['C', 'H', 'O', 'N']
  const atoms = Array.from({ length: 400 }, (_, i) => ({ index: i + 1, element: elements[i % 4], x: random() * 12, y: random() * 12, z: random() * 12 }))
  const cov = { C: 0.76, H: 0.31, O: 0.66, N: 0.71 }
  const brute = []
  for (let a = 0; a < atoms.length; a++) for (let b = a + 1; b < atoms.length; b++) {
    const d = Math.hypot(atoms[a].x - atoms[b].x, atoms[a].y - atoms[b].y, atoms[a].z - atoms[b].z)
    if (d < (cov[atoms[a].element] + cov[atoms[b].element]) * 1.3 && d > 0.1) brute.push(`${a}-${b}`)
  }
  const grid = findBonds(atoms)
  const pairs = []
  for (let k = 0; k < grid.length; k += 2) pairs.push(`${grid[k]}-${grid[k + 1]}`)
  assert.deepEqual(pairs.sort(), brute.sort()); checks++
  const big = Array.from({ length: 15000 }, (_, i) => ({ index: i + 1, element: elements[i % 4], x: (i % 25) * 1.4, y: (Math.floor(i / 25) % 25) * 1.4, z: Math.floor(i / 625) * 1.4 }))
  const started = Date.now()
  const bigBonds = findBonds(big)
  assert.ok(Date.now() - started < 3000, `grid bond search took ${Date.now() - started} ms`); assert.ok(bigBonds.length > 0); checks++
}

async function run () {
  // Exercise the real browser adapter with a DOM file-input stub and native File/Blob.
  let chosenFile = new File([source], 'water.XYZ'), chosenEvent = 'change'
  const document = { body: { appendChild () {} }, createElement () {
    const events = {}
    return { files: [chosenFile], addEventListener (name, fn) { events[name] = fn }, remove () {}, click () { events[chosenEvent]() } }
  } }
  let zipBlob
  const QM = require('../qm-inputs.js')
  const context = { window: {}, document, MonetXYZ: XYZ, MonetQM: QM, TextDecoder, TextEncoder, Blob, setTimeout, URL: { createObjectURL (blob) { zipBlob = blob; return 'blob:test' }, revokeObjectURL () {} } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'browser-bridge.js'), 'utf8'), context)
  const api = context.window.monet
  assert.equal(await api.selectFile(), 'water.XYZ'); checks++
  assert.equal((await api.analyzeFile('water.XYZ')).configCount, 2); checks++
  assert.equal((await api.readFrame('water.XYZ', 1)).atoms[0].x, .1); checks++
  assert.match((await api.readFrame('water.XYZ', 99)).error, /outside/); checks++
  chosenEvent = 'cancel'; assert.equal(await api.selectFile(), null); chosenEvent = 'change'; checks++
  const options = { filePath: 'water.XYZ', atomCount: 3, selectedAtoms: [1, 3], frequency: 1, computeAverage: true, generateGaussian: true }
  const output = await api.processTrajectory(options)
  assert.equal(output.success, true); assert.equal(output.sampledFrames, 2); checks++
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monet-test-'))
  fs.writeFileSync(path.join(temp, 'results.zip'), Buffer.from(await zipBlob.arrayBuffer()))
  for (const bad of [{ frequency: 0 }, { selectedAtoms: [4] }]) {
    assert.ok((await api.processTrajectory({ ...options, ...bad })).error); checks++
  }
  chosenFile = new File(['2\n\nH 0 0 0'], 'bad.xyz'); await api.selectFile()
  assert.match((await api.analyzeFile('bad.xyz')).error, /Incomplete/); checks++
  // Chunk boundary with CRLF split exactly between the CR and LF.
  chosenFile = new File(['1\r\n' + 'x'.repeat(1024 * 1024 - 4) + '\r\nH 0 0 0\r\n'], 'boundary.xyz')
  await api.selectFile(); assert.equal((await api.analyzeFile('boundary.xyz')).configCount, 1); checks++
  // Loading the adapter in Electron must preserve the real preload bridge.
  const sentinel = {}; const desktopContext = { window: { monet: sentinel } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'browser-bridge.js'), 'utf8'), desktopContext)
  assert.equal(desktopContext.window.monet, sentinel); checks++

  // Exercise actual Electron IPC handlers without launching an Electron window.
  const handlers = new Map()
  const electron = { app: { whenReady: () => ({ then () {} }), on () {} }, ipcMain: { handle (name, fn) { handlers.set(name, fn) } } }
  const desktop = { require: name => name === 'electron' ? electron : name.startsWith('./') ? require(path.join(root, name)) : require(name), __dirname: root, console, process, Set }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), desktop)
  const filePath = path.join(root, 'examples/water.XYZ')
  assert.equal((await handlers.get('analyze-file')(null, filePath)).configCount, 2); checks++
  assert.equal((await handlers.get('read-frame')(null, filePath, 1, 3)).atoms[0].x, .1); checks++
  assert.ok((await handlers.get('analyze-file')(null, path.join(temp, 'missing.xyz'))).error); checks++
  const result = await handlers.get('process-trajectory')({ sender: { send () {} } }, { ...options, filePath, outputDir: path.join(temp, 'desktop') })
  assert.equal(result.success, true); assert.equal(result.sampledFrames, 2); checks++
  // Template-based QM inputs: same files from the desktop and browser engines.
  const qm = QM.defaultSpec(['orca', 'qe', 'vasp'])
  qm.common.multiplicities = [1]
  const withQm = { ...options, generateGaussian: false, qm }
  await handlers.get('process-trajectory')({ sender: { send () {} } }, { ...withQm, filePath, outputDir: path.join(temp, 'desktop-qm') })
  const orca = fs.readFileSync(path.join(temp, 'desktop-qm/2-SAMPLED_CONFIGURATIONS/conf2/orca/sing.inp'), 'utf8')
  assert.match(orca, /\* xyz 0 1\nO  0.1000000  0.0000000  0.0000000\nH  -0.6570000  0.5860000  0.0000000\n\*/); checks++
  assert.ok(fs.existsSync(path.join(temp, 'desktop-qm/2-SAMPLED_CONFIGURATIONS/conf1/vasp/POSCAR'))); checks++
  assert.ok(!fs.existsSync(path.join(temp, 'desktop-qm/2-SAMPLED_CONFIGURATIONS/conf1/sing.dat'))); checks++
  const local = await api.processTrajectory(withQm)
  assert.equal(local.success, true); checks++
  const localZip = path.join(temp, 'local-qm.zip')
  fs.writeFileSync(localZip, Buffer.from(await zipBlob.arrayBuffer()))
  require('node:child_process').execFileSync('python3', ['-c', `
import zipfile, sys, pathlib
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.read('2-SAMPLED_CONFIGURATIONS/conf2/orca/sing.inp').decode() == pathlib.Path(sys.argv[2]).read_text()
 assert 'qe/sing.inp' in ' '.join(z.namelist())
`, localZip, path.join(temp, 'desktop-qm/2-SAMPLED_CONFIGURATIONS/conf2/orca/sing.inp')]); checks++
  // POTCAR assembly from a local library through the desktop IPC handler (water.XYZ: O and H).
  {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'potcar-'))
    for (const [variant, zval] of [['O', 6], ['H', 1]]) {
      fs.mkdirSync(path.join(lib, variant))
      fs.writeFileSync(path.join(lib, variant, 'POTCAR'), `  PAW_PBE ${variant}\n   POMASS =   1.000; ZVAL   =    ${zval}.000    mass and valenz\nEnd of Dataset\n`)
    }
    const potcarQm = QM.defaultSpec(['vasp'])
    potcarQm.codes.vasp.potcar = { library: lib }
    potcarQm.common.multiplicities = [1]
    const potcarResult = await handlers.get('process-trajectory')({ sender: { send () {} } }, { ...options, filePath, outputDir: path.join(temp, 'desktop-potcar'), qm: potcarQm })
    assert.equal(potcarResult.success, true); checks++
    const potcarText = fs.readFileSync(path.join(temp, 'desktop-potcar/2-SAMPLED_CONFIGURATIONS/conf1/vasp/POTCAR'), 'utf8')
    assert.match(potcarText, /PAW_PBE O[\s\S]*PAW_PBE H/); checks++
  }
  const extracted = fs.readFileSync(path.join(temp, 'desktop/1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz'), 'utf8')
  assert.equal(parse(extracted).configCount, 2); assert.equal(parse(extracted).atomCount, 2); checks++
  // Python's standard ZIP reader verifies CRCs and output numerics independently.
  require('node:child_process').execFileSync('python3', ['-c', `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert len(z.namelist()) == 10
 text = z.read('3-AVERAGE_STRUCTURE/GEO-AVERAGE.xyz').decode().splitlines()
 assert int(text[0]) == 3
 assert abs(float(text[2].split()[1]) - 0.05) < 1e-9
 assert '%chk=s0.chk' in z.read('2-SAMPLED_CONFIGURATIONS/conf1/sing.dat').decode()
 assert z.read('1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz').decode().splitlines()[0] == '2'
`, path.join(temp, 'results.zip')]); checks++
  fs.rmSync(temp, { recursive: true, force: true })
  console.log(`PASS: ${checks} regression checks (XYZ parser, browser adapter, ZIP output, desktop IPC).`)
}
run().catch(error => { console.error(error); process.exitCode = 1 })

'use strict'
// Launcher:
//   - SHA-256 of uploads and derived files;
//   - versions for the report;
//   - session endpoints (autosave, find, export ZIP, open);
//   - the browser adapter's digest and session calls.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { File } = require('node:buffer')
const { spawn, execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const python = process.env.PYTHON || 'python3'
// Builds a ZIP whose session.json is a valid JSON string padded past MAX_JSON (16 MiB) with spaces, written
// with ZIP_DEFLATED so it compresses to almost nothing on disk: a zip-bomb fixture with an honest declared size.
const BUILD_BOMB = `
import json, sys, zipfile
out_path = sys.argv[1]
payload = json.dumps({'padding': ' ' * (17 * 1024 * 1024)})
with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    zf.writestr('session.json', payload)
`
// Unit-level probe for the *chunked* guard in read_session(): CPython's zipfile.ZipExtFile already truncates
// whatever read() returns to the entry's declared (and CRC-checked) file_size, so a ZIP whose header lies about
// a small file_size can never actually yield more bytes than that through the real zipfile module - lying only
// earns a CRC mismatch ("damaged"), not extra bytes. That means the early `info.file_size > MAX_JSON` check and
// the chunked-read total can never disagree via a real ZIP, so the second bound can't be exercised through the
// HTTP API. Instead, this stubs out zipfile.is_zipfile/ZipFile so read_session() sees a member that reports a
// tiny file_size (passing the fast-path check) but whose .read() keeps handing back data forever, simulating a
// decompression backend that does not self-truncate, and checks that the chunked loop still bounds it.
const CHUNKED_PROBE = `
import sys
sys.path.insert(0, ${JSON.stringify(root)})
import zipfile
import start_monet

class FakeInfo:
    file_size = 10  # lies: far under MAX_JSON, so the early fast-path check passes it through

class FakeMember:
    def read(self, n=65536):
        return b' ' * 65536  # never returns empty: an unbounded reader, unlike the real zipfile module
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return False

class FakeArchive:
    def namelist(self):
        return ['session.json']
    def getinfo(self, name):
        return FakeInfo()
    def open(self, info):
        return FakeMember()
    def __enter__(self):
        return self
    def __exit__(self, *exc):
        return False

zipfile.is_zipfile = lambda path: True
zipfile.ZipFile = lambda path: FakeArchive()

try:
    start_monet.read_session('dummy.zip')
    print('NO_ERROR')
except ValueError as error:
    print(f'VALUE_ERROR:{error}')
except Exception as error:
    print(f'OTHER_ERROR:{error.__class__.__name__}:{error}')
`
const sessions = fs.mkdtempSync(path.join(os.tmpdir(), 'monet-sessions-'))
const child = spawn(python, [path.join(root, 'start_monet.py'), '--port', '0', '--no-browser', '--sessions-dir', sessions])
const text = fs.readFileSync(path.join(root, 'examples/water.XYZ'), 'utf8')
const sha = crypto.createHash('sha256').update(text).digest('hex')
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
  const token = (await (await fetch(origin)).text()).match(/name="monet-api-token" content="([^"]+)"/)[1]
  const post = async (route, body) => {
    const response = await fetch(origin + route, { method: 'POST', headers: { 'X-Monet-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() }
  }
  const upload = async (name, data) => (await fetch(origin + '/api/upload', {
    method: 'POST', body: data, headers: { 'X-Monet-Token': token, 'Content-Type': 'application/octet-stream', 'X-Monet-Filename': encodeURIComponent(name) }
  })).json()
  const up = await upload('water.XYZ', text)
  assert.equal(up.ok, true); assert.equal(up.sha256, sha); assert.equal(up.size, Buffer.byteLength(text)); checks++
  const check = await post('/api/check', {})
  assert.match(check.body.python_version, /^3\.\d+/); assert.ok('scipy_version' in check.body); checks++
  const sub = await post('/api/run', { action: 'subsample', file_id: up.file_id, stride: 1, output: 'water' })
  assert.equal(sub.body.ok, true, JSON.stringify(sub.body)); assert.match(sub.body.sha256, /^[0-9a-f]{64}$/); checks++
  // Autosave: one file per session, written through a temporary file.
  const session = { schema: 'monet-session/1', monet_version: '2.1.0', created: '2026-09-21T10:00:00.000Z', updated: '2026-09-21T10:05:00.000Z', environment: {}, paused: false, inputs: [], sources: [{ id: 'S1', name: 'water.XYZ', sha256: sha }], steps: [{ id: 1, kind: 'load', status: 'ok' }] }
  let r = await post('/api/session/save', { session })
  assert.equal(r.body.ok, true, JSON.stringify(r.body)); assert.equal(r.body.saved, `${sha.slice(0, 12)}-water.XYZ-20260921100000.json`); checks++
  assert.deepEqual(fs.readdirSync(sessions), [r.body.saved]); checks++
  r = await post('/api/session/find', { sha256: sha })
  assert.deepEqual(r.body.session, session); checks++
  // The newest history with more than the load step wins over a history just started.
  const longer = { ...session, created: '2026-09-22T08:00:00.000Z', updated: '2026-09-22T08:00:00.000Z', steps: [...session.steps, { id: 2, kind: 'analysis', status: 'ok' }] }
  await post('/api/session/save', { session: longer })
  await post('/api/session/save', { session: { ...session, created: '2026-09-23T08:00:00.000Z', updated: '2026-09-23T08:00:00.000Z' } })
  r = await post('/api/session/find', { sha256: sha })
  assert.equal(r.body.session.created, '2026-09-22T08:00:00.000Z'); checks++
  assert.equal((await post('/api/session/find', { sha256: 'f'.repeat(64) })).body.session, null); checks++
  r = await post('/api/session/save', { session: { hello: 1 } })
  assert.equal(r.status, 400); assert.match(r.body.error, /Not a MONET session/); checks++
  r = await post('/api/session/save', { session: { ...session, schema: 'monet-session/2' } })
  assert.equal(r.status, 400); assert.match(r.body.error, /newer MONET/); checks++
  r = await post('/api/session/save', { session: { ...session, sources: [{ id: 'S1', name: 'x.xyz', sha256: null }] } })
  assert.equal(r.body.ok, false); assert.match(r.body.error, /checksum is not known/); checks++
  // Autosave name sanitising: a path-traversal source name must not escape the sessions folder.
  r = await post('/api/session/save', { session: { ...session, sources: [{ id: 'S1', name: '../../evil/x.xyz', sha256: sha }], created: '2026-09-24T08:00:00.000Z' } })
  assert.equal(r.body.ok, true, JSON.stringify(r.body))
  assert.ok(!r.body.saved.includes('/'), r.body.saved)
  assert.ok(!r.body.saved.split(/[\\/]/).includes('..'), r.body.saved)
  assert.ok(fs.existsSync(path.join(sessions, r.body.saved)), r.body.saved)
  checks++
  // Export: a ZIP with the session, the report and replay.py (methods.docx only with pandoc).
  r = await post('/api/session/export', { session, methods: '# Methods', replay: 'print(1)\n', name: 'MONET-session-water.zip' })
  assert.equal(r.body.ok, true, JSON.stringify(r.body)); checks++
  const zip = Buffer.from(await (await fetch(`${origin}/api/download/${r.body.download_id}`)).arrayBuffer())
  const zipPath = path.join(os.tmpdir(), `monet-export-${process.pid}.zip`)
  fs.writeFileSync(zipPath, zip)
  const names = execFileSync(python, ['-c', 'import sys, zipfile; print(" ".join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))', zipPath]).toString().trim().split(' ')
  fs.rmSync(zipPath)
  assert.deepEqual(names.filter(n => n !== 'methods.docx'), ['README.txt', 'methods.md', 'replay.py', 'session.json']); checks++
  // Open: the ZIP or a session.json uploaded back; damaged files are refused.
  const opened = await upload('MONET-session-water.zip', zip)
  r = await post('/api/session/read', { file_id: opened.file_id })
  assert.deepEqual(r.body.session, session); checks++
  const broken = await upload('broken.json', '{"schema": "monet-session/1", ')
  r = await post('/api/session/read', { file_id: broken.file_id })
  assert.equal(r.status, 400); assert.match(r.body.error, /damaged/); checks++
  // Zip bomb, honest declared size: session.json's own (accurate) file_size already exceeds MAX_JSON,
  // so the fast-path check rejects it before any decompression.
  const bombHonestPath = path.join(os.tmpdir(), `monet-bomb-honest-${process.pid}.zip`)
  execFileSync(python, ['-c', BUILD_BOMB, bombHonestPath])
  const bombHonest = fs.readFileSync(bombHonestPath)
  fs.rmSync(bombHonestPath)
  const bombHonestUpload = await upload('bomb-honest.zip', bombHonest)
  r = await post('/api/session/read', { file_id: bombHonestUpload.file_id })
  assert.equal(r.status, 400); assert.match(r.body.error, /too large/); checks++
  // Zip bomb, chunked-read guard: a member that reports a tiny file_size (bypassing the fast-path check) but
  // whose .read() never stops handing back data must still be bounded by read_session()'s own running total.
  const chunkedProbe = execFileSync(python, ['-c', CHUNKED_PROBE]).toString().trim()
  assert.match(chunkedProbe, /^VALUE_ERROR:.*too large/); checks++
  // The browser adapter keeps the digests of uploaded and derived files.
  const context = {
    window: {}, File, Blob, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    fetch: (route, options) => fetch(origin + route, options),
    URL: { createObjectURL () {}, revokeObjectURL () {} },
    document: {
      querySelector: () => ({ content: token }), body: { appendChild () {} },
      createElement () {
        const callbacks = {}
        return { files: [new File([text], 'water.XYZ')], remove () {}, addEventListener (name, callback) { callbacks[name] = callback }, click () { callbacks.change() } }
      }
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'browser-bridge.js'), 'utf8'), context)
  const api = context.window.monet
  const name = await api.selectFile()
  assert.equal((await api.analyzeFile(name)).configCount, 2)
  assert.deepEqual({ ...(await api.fileDigest(name)) }, { sha256: sha, size: Buffer.byteLength(text) }); checks++
  const derived = await api.aseRun({ action: 'subsample', filename: name, stride: 1, output: 'water' })
  assert.match((await api.fileDigest(derived.filePath)).sha256, /^[0-9a-f]{64}$/); checks++
  assert.equal((await api.sessionSave(longer)).ok, true); assert.equal((await api.sessionFind(sha)).session.steps.length, 2); checks++
  console.log(`PASS: ${checks} session checks (checksums, versions, autosave, find, export, open).`)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => { child.kill(); fs.rmSync(sessions, { recursive: true, force: true }) })

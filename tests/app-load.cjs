'use strict'
// Loads index.html with every <script> as a separate classic script, as a browser does, in browser
// mode and in desktop mode. The page scripts (app-*.js) share one global scope but are not hoisted
// across files, so code that runs at load time must only use what earlier files defined.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { JSDOM, VirtualConsole } = require('jsdom')
const { createCanvas } = require('@napi-rs/canvas')
const root = path.resolve(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
let checks = 0

// The page's own scripts, in index.html order.
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1])
const pageScripts = scripts.filter(name => name.startsWith('app-'))
assert.ok(pageScripts.length >= 2 && pageScripts.at(-1) === 'app-start.js', pageScripts.join(', ')); checks++
assert.ok(!fs.existsSync(path.join(root, 'renderer.js')), 'renderer.js was split into app-*.js'); checks++

const desktop = `window.monet = {
  desktop: true, canImport: true, selectFile: async () => null, selectOutputDir: async () => null,
  analyzeFile: async () => ({}), readFrame: async () => ({}), processTrajectory: async () => ({}),
  onProgress () {}, cancel: async () => true, listFormats: async () => ({ ok: false }), importFile: async () => ({}),
  aseCheck: async () => ({ ok: false, error: 'no Python in this test' }), aseRun: async () => ({ ok: false }),
  listAnalyses: async () => ({ ok: false }), aseSelectOutput: async () => null, onAseProgress: () => () => {}
}`

async function load (mode) {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error))
  let page = html.replace(/<script src="([^"]+)"><\/script>/g, (_, name) => {
    const code = fs.readFileSync(path.join(root, name), 'utf8')
    assert.ok(!code.includes('</script'), `${name} contains </script>`)
    return `<script>${code}\n</script>`
  })
  if (mode === 'desktop') page = page.replace('<head>', `<head><script>${desktop}</script>`)
  const dom = new JSDOM(page, {
    runScripts: 'dangerously', url: 'http://localhost/', virtualConsole,
    beforeParse (w) {
      const canvases = new WeakMap()
      w.HTMLCanvasElement.prototype.getContext = function () {
        if (!canvases.has(this)) canvases.set(this, createCanvas(Math.max(1, this.width), Math.max(1, this.height)))
        return canvases.get(this).getContext('2d')
      }
      Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', { get: () => 900 })
      Object.defineProperty(w.HTMLElement.prototype, 'clientHeight', { get: () => 420 })
      w.requestAnimationFrame = callback => setTimeout(callback, 0)
    }
  })
  await new Promise(resolve => setTimeout(resolve, 50))
  return { w: dom.window, errors }
}

async function main () {
  for (const mode of ['browser', 'desktop']) {
    const { w, errors } = await load(mode)
    assert.deepEqual(errors.map(e => e.message + (e.detail ? ` (${e.detail.message || e.detail})` : '')), [], `${mode} mode`); checks++
    // Start-up finished: the load handler ran and the ASE check settled.
    assert.equal(w.document.getElementById('status-msg').textContent.length > 0, true); checks++
    assert.ok(w.document.querySelector('#monet-subtabbar').children.length >= 8); checks++
    assert.equal(w.document.getElementById('ase-badge-text').textContent, 'ASE unavailable'); checks++
    w.close()
  }
  console.log(`PASS: ${checks} page-load checks (${pageScripts.length} page scripts loaded separately, browser and desktop modes).`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })

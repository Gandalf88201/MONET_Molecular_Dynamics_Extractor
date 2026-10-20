'use strict'
// Persistent `ase_bridge.py --serve` workers for the desktop (Electron) app.
// Same protocol and behaviour as the launcher pool in start_monet.py: one command per line,
// progress lines, one result or error line, then {"type": "end"} when the worker is free again.
// Idle workers never keep the process alive; a cancelled command kills its worker.
const { spawn } = require('child_process')
const readline = require('readline')

class Worker {
  constructor (python, script) {
    this.process = spawn(python, [script, '--serve'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.commands = 0
    this.exited = false
    this.stderr = []
    this.pending = null // { resolve, onProgress, result }
    this.process.stderr.on('data', data => {
      this.stderr.push(...String(data).split('\n').filter(line => line.trim()))
      this.stderr = this.stderr.slice(-20)
    })
    this.process.on('error', error => { this.exited = true; this._settle(false, error.message) })
    this.process.on('exit', () => { this.exited = true; this._settle(false) })
    readline.createInterface({ input: this.process.stdout }).on('line', line => this._line(line))
    this._hold(false)
  }

  // Busy workers keep the app alive until their result arrives; idle ones do not.
  _hold (busy) {
    for (const handle of [this.process, this.process.stdin, this.process.stdout, this.process.stderr]) {
      if (handle && typeof handle.ref === 'function') busy ? handle.ref() : handle.unref()
    }
  }

  _line (line) {
    let message
    try { message = JSON.parse(line) } catch { return }
    const job = this.pending
    if (!job) return
    if (message.type === 'progress') job.onProgress(message)
    else if (message.type === 'result' || message.type === 'error') job.result = message
    else if (message.type === 'end') this._settle(true)
  }

  _settle (reusable, error) {
    const job = this.pending
    if (!job) return
    this.pending = null
    this._hold(false)
    job.resolve({ result: job.result, reusable, error })
  }

  run (command, onProgress) {
    this.commands++
    this._hold(true)
    return new Promise(resolve => {
      this.pending = { resolve, onProgress, result: null }
      this.process.stdin.write(JSON.stringify(command) + '\n', error => { if (error) this._settle(false, error.message) })
    })
  }

  alive () { return !this.exited && this.process.exitCode === null && this.process.signalCode === null }

  kill () { if (this.alive()) this.process.kill() }

  detail () { return this.stderr[this.stderr.length - 1] || 'Check the Python installation.' }
}

function createPool ({ python, script, size = 3, recycle = 200 }) {
  const idle = []
  const running = new Map() // worker -> scope
  const cancelled = new Set()

  function acquire () {
    while (idle.length) {
      const worker = idle.pop()
      if (worker.alive()) return worker
    }
    return new Worker(python, script)
  }

  function release (worker) {
    if (worker.alive() && worker.commands < recycle && idle.length < size) idle.push(worker)
    else worker.kill()
  }

  // Run one bridge command; `scope` ('ase' or 'extraction') groups commands for cancel().
  async function run (command, onProgress = () => {}, scope = 'ase') {
    const worker = acquire()
    running.set(worker, scope)
    try {
      const { result, reusable, error } = await worker.run(command, onProgress)
      if (cancelled.has(worker)) return { ok: false, cancelled: true, error: 'Calculation cancelled.' }
      if (reusable) release(worker)
      else worker.kill()
      return result || { ok: false, error: error ? `Python could not run: ${error}` : `Python returned no result. ${worker.detail()}` }
    } finally {
      running.delete(worker)
      cancelled.delete(worker)
    }
  }

  function cancel (scope) {
    for (const [worker, owner] of running) {
      if (owner === scope) { cancelled.add(worker); worker.kill() }
    }
  }

  // Start one worker ahead of the first calculation, so it does not wait for the imports.
  function warm () { if (!idle.length) release(new Worker(python, script)) }

  function close () {
    for (const worker of idle.splice(0)) worker.kill()
    for (const worker of running.keys()) worker.kill()
  }

  return { run, cancel, warm, close }
}

module.exports = { createPool }

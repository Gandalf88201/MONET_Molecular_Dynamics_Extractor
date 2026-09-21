'use strict'

// replay.py for a MONET session: one readable line per logged step, with the console names and
// MONET atom IDs. monet_replay.py runs it headless through ase_bridge.py and compares the key numbers.
;(function (root) {
  const node = typeof module === 'object' && module.exports
  const C = node ? require('./console.js') : root.MonetConsole
  const P = node ? require('./provenance.js') : root.MonetProvenance
  // Hidden settings MONET sends with every command; replay.py sets them with s.options(...).
  const OPTIONS = ['cell', 'pbc', 'mic', 'bond_scale']
  const expected = result => Object.fromEntries(Object.entries(result || {}).filter(([key]) => !key.includes(':')))

  function header (data) {
    const gaps = data.steps.some(step => step.kind === 'pause')
    return [
      '#!/usr/bin/env python3',
      `"""Replay of a MONET analysis session (${data.schema}, created ${data.created}).`,
      '',
      'Run it in the folder that holds the input trajectories:',
      '    python replay.py --monet /path/to/MONET',
      'Each step runs the same MONET calculation without the browser, writes stepNN_<action>.json',
      'to --out and compares the key numbers with the ones MONET logged (relative tolerance --rtol).',
      'Edit it like a notebook: change a parameter, delete a line, add your own Python.',
      '"""',
      'import argparse',
      'import os',
      'import sys',
      '',
      "parser = argparse.ArgumentParser(description='Replay a MONET analysis session.')",
      "parser.add_argument('--monet', default=os.environ.get('MONET_HOME'), help='MONET folder (the one with ase_bridge.py); default: $MONET_HOME')",
      "parser.add_argument('--out', default='replay_out', help='folder for the step outputs')",
      "parser.add_argument('--rtol', type=float, default=1e-6, help='relative tolerance for the logged numbers')",
      "parser.add_argument('--force', action='store_true', help='replay even if an input checksum differs')",
      'args = parser.parse_args()',
      'if not args.monet:',
      "    sys.exit('Pass --monet /path/to/MONET (the folder with ase_bridge.py) or set MONET_HOME.')",
      'sys.path.insert(0, args.monet)',
      'from monet_replay import Session  # noqa: E402',
      '',
      's = Session(monet=args.monet, out=args.out, rtol=args.rtol, force=args.force)',
      ...(gaps ? ["print('WARNING: the MONET history was paused during this session; steps taken while paused are missing.')"] : []),
      ''
    ]
  }

  function stepCode (session, step) {
    const target = (step.outputs || []).find(output => output.source)
    const assign = target ? `${target.source} = ` : ''
    const expect = expected(step.result)
    const tail = step.status === 'ok' && Object.keys(expect).length ? { expect } : {}
    if (step.kind === 'load') {
      const source = session.source(step.source)
      if (!source) return null
      const imported = source.import || {}
      return `${source.id} = s.load(${C.formatArgs({
        name: source.name, sha256: source.sha256 ?? undefined, atoms: source.atoms ?? undefined, atom_ids: source.atom_ids ?? undefined,
        import_format: imported.format ?? undefined, reference: imported.reference ?? undefined, cell_file: imported.cell_file ?? undefined,
        cell_vectors: source.import ? imported.cell_vectors : undefined, step: step.id
      })})`
    }
    if (step.kind === 'extract') return `${assign}s.extract(${step.source}, ${C.formatArgs({ step: step.id, ...step.params, ...tail })})`
    if (!step.call) return null
    const { args } = C.parse(step.call)
    if (step.kind === 'derive') return `${assign}s.derive(${step.source}, ${C.formatValue(step.action)}, ${C.formatArgs({ step: step.id, ...args, ...tail })})`
    if (step.kind === 'analysis' && C.names().includes(step.action)) return `s.${step.action}(${step.source}, ${C.formatArgs({ step: step.id, ...args, ...tail })})`
    return null
  }

  function replayScript (data) {
    const session = P.fromJSON(data)
    const lines = header(data)
    let options = null
    for (const step of session.data.steps) {
      if (step.kind === 'pause') { lines.push('', `# step ${step.id}: history paused at ${step.time}; steps until it was resumed are not in this script`); continue }
      if (step.kind === 'resume') { lines.push(`# step ${step.id}: history resumed at ${step.time}`, ''); continue }
      if (step.kind === 'clear' || step.kind === 'logging_error') continue
      if (['time', 'cell', 'export'].includes(step.kind)) {
        lines.push(`# step ${step.id} ${step.kind}${step.action ? ' ' + step.action : ''}: ${C.formatArgs(step.params || {})} (setting or export, not replayed)`)
        continue
      }
      const code = stepCode(session, step)
      if (!code) { lines.push(`# step ${step.id} ${step.action || step.kind}: no call recorded, not replayed`); continue }
      if (step.status !== 'ok') {
        lines.push(`# step ${step.id} ${step.action || step.kind}: ${step.status === 'cleared' ? 'cleared in MONET' : `failed in MONET (${step.error})`}`, `#   ${code}`)
        continue
      }
      if (step.kind !== 'load') {
        const next = Object.fromEntries(OPTIONS.map(key => [key, step.params && step.params[key] !== undefined ? step.params[key] : null]))
        if (JSON.stringify(next) !== JSON.stringify(options)) { lines.push(`s.options(${C.formatArgs(next)})`); options = next }
      }
      lines.push(code)
    }
    lines.push('', 'sys.exit(s.report())', '')
    return lines.join('\n')
  }

  const api = { replayScript }
  if (node) module.exports = api
  else root.MonetReplay = api
})(globalThis)

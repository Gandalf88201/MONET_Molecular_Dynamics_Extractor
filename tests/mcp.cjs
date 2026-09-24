'use strict'
// MCP server (monet_mcp.py) driven by the official MCP client over stdio, as Claude or Gemini would:
// tools, MONET ID conversion, compact results, written files, derived trajectories and readable errors.
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

const script = String.raw`
import asyncio, json, sys, tempfile
from pathlib import Path
root = Path(sys.argv[1])
try:
    from mcp import ClientSession
    from mcp.client.stdio import StdioServerParameters, stdio_client
except ImportError:
    print('SKIP'); sys.exit(0)
import numpy as np

work = Path(tempfile.mkdtemp())
rng = np.random.default_rng(0)
base = np.array([[0, 0, 0], [1.52, 0, 0], [2.1, 1.4, 0], [3.5, 1.4, 0.3], [-0.5, 0.9, 0.3], [3.9, 2.3, 0.3]])
with open(work / 'mol.xyz', 'w') as fh:
    for t in range(120):
        p = base + 0.04 * rng.standard_normal(base.shape) + [0, 0, 0.002 * t]
        fh.write('6\nframe\n' + ''.join(f'{e} {x:.5f} {y:.5f} {z:.5f}\n' for e, (x, y, z) in zip('CCCOHH', p)))
out = work / 'out'
checks = 0

def payload(result):
    text = result.content[0].text if result.content else ''
    error = getattr(result, 'is_error', None)
    return (result.isError if error is None else error), text

async def main():
    global checks
    params = StdioServerParameters(command=sys.executable, args=[str(root / 'monet_mcp.py'), '--output', str(out), '--data', str(work)])
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            async def call(name, **args):
                error, text = payload(await s.call_tool(name, args))
                return error, (json.loads(text) if not error else text)
            names = {t.name for t in (await s.list_tools()).tools}
            assert names == {'open_trajectory', 'set_trajectory_options', 'list_analyses', 'run_analysis', 'get_result_data',
                             'select_atoms', 'find_bonded_groups', 'derive_trajectory'}, names
            assert [p.name for p in (await s.list_prompts()).prompts] == ['analyze_md_trajectory']
            checks += 1
            error, t = await call('open_trajectory', path=str(work / 'mol.xyz'), md_timestep_fs=0.5, steps_per_frame=2)
            assert not error and t['trajectory'] == 't1' and t['n_atoms'] == 6 and t['n_frames'] == 120 and t['time_between_frames_fs'] == 1.0, t
            assert t['elements'] == {'C': 3, 'O': 1, 'H': 2} and t['first_atoms'][:2] == ['C1', 'C2'], t
            checks += 1
            error, listed = await call('list_analyses')
            assert 'fluctuations' in listed['builtin'] and listed['builtin']['msd']['needs_time_step']
            assert any(a['analysis'] == 'custom.displacement_ellipsoids' and a['writes_file'] for a in listed['registered'])
            checks += 1
            # Atoms in and out are MONET IDs; long series are summarised, the full data stays available.
            error, f = await call('run_analysis', trajectory='t1', analysis='fluctuations', params={'quantity': 'bonds', 'indices': [1, 2, 3]})
            assert not error and f['items'] == [[1, 2], [2, 3]] and f['dt'] == 1.0, f
            assert f['series']['shape'] == [2, 120] and 'get_result_data' in f['series']['note'], f['series']
            error, full = await call('get_result_data', result_id=f['result_id'], key='series.1', start=10, count=5)
            assert full['total'] == 120 and len(full['values']) == 5
            saved = json.loads(Path(f['result_file']).read_text())
            assert full['values'] == saved['series'][1][10:15]
            checks += 1
            error, e = await call('run_analysis', trajectory='t1', analysis='custom.displacement_ellipsoids', params={'indices': [2, 3, 4]})
            assert not error and e['atoms'] == [2, 3, 4] and e['x'] == [2, 3, 4] and [row[0] for row in e['table']['rows']] == [2, 3, 4], e
            pdb = Path(e['written_file'])
            assert pdb.parent == out / 'files' and sum(l.startswith('ANISOU') for l in pdb.read_text().splitlines()) == 3
            checks += 1
            error, sel = await call('select_atoms', trajectory='t1', selection='element H')
            assert sel['monet_ids'] == [5, 6], sel
            error, chains = await call('find_bonded_groups', trajectory='t1', kind='bonds', pattern=['C', 'C'])
            assert chains['groups'] == [[1, 2], [2, 3]], chains
            checks += 1
            error, sub = await call('derive_trajectory', trajectory='t1', operation='subsample', params={'stride': 10})
            assert not error and sub['trajectory'] == 't2' and sub['n_frames'] == 12 and Path(sub['written_file']).parent == out / 'derived', sub
            checks += 1
            # Errors reach the AI as readable messages; paths and cell stay with the server.
            error, text = await call('run_analysis', trajectory='t1', analysis='rmsd', params={'filename': '/etc/passwd'})
            assert error and 'rmsd has no parameter filename' in text, text
            error, text = await call('open_trajectory', path=str(root / 'README.md'))
            assert error and 'outside the folders MONET may read' in text, text
            error, text = await call('run_analysis', trajectory='t1', analysis='rdf')
            assert error and 'complete periodic cell' in text, text
            error, text = await call('run_analysis', trajectory='t9', analysis='rmsd')
            assert error and 'Unknown trajectory' in text, text
            error, text = await call('run_analysis', trajectory='t1', analysis='fluctuations', params={'quantity': 'atoms', 'indices': [99]})
            assert error and 'MONET atom 99' in text, text
            checks += 1

asyncio.run(main())
print(checks)
`
const out = execFileSync(process.env.PYTHON || 'python3', ['-c', script, root], { encoding: 'utf8', timeout: 300000 }).trim().split('\n').pop()
if (out === 'SKIP') console.log('SKIP: MCP server checks need the MCP Python SDK (pip install "mcp>=1.2").')
else console.log(`PASS: ${Number(out)} MCP server checks (tools over stdio, MONET IDs, compact results, files, derived trajectories, errors).`)

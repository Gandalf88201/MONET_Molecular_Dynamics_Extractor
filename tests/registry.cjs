'use strict'
// Analysis registry (monet_registry.py): built-in MDAnalysis analyses, plugin discovery and errors,
// parameter checks, result checks, launcher file outputs and replay of plugin steps.
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

const script = String.raw`
import json, math, os, subprocess, sys, tempfile
from pathlib import Path
root = Path(sys.argv[1])
sys.path.insert(0, str(root))
checks = 0
python = sys.executable

def bridge(command, env=None):
    out = subprocess.run([python, str(root / 'ase_bridge.py')], input=json.dumps(command), capture_output=True, text=True, env=env)
    lines = [json.loads(l) for l in out.stdout.splitlines() if l.startswith('{')]
    return [l for l in lines if l.get('type') in ('result', 'error')][-1]

# Built-in analyses and the example plugins are listed, with their parameters.
listed = bridge({'action': 'list_analyses'})
ids = [a['id'] for a in listed['analyses']]
assert listed['ok'] and not listed['errors'], listed['errors']
assert len([i for i in ids if i.startswith('mdanalysis.')]) == 20 and 'ase.cell_volume' in ids and 'custom.radius_of_gyration' in ids, ids
rg = next(a for a in listed['analyses'] if a['id'] == 'custom.radius_of_gyration')
assert rg['source'] == 'plugins/radius_of_gyration.py' and [p['type'] for p in rg['params']] == ['atoms', 'bool'], rg
checks += 1

# A plugin folder from MONET_PLUGINS: a good plugin, a broken one and a duplicate are reported, never fatal.
folder = Path(tempfile.mkdtemp())
(folder / 'good.py').write_text('''
from monet_registry import Param, analysis, profile, table
@analysis('distance_profile', engine='custom', label='Distance from atom', params=[Param.integer('atom', 'Atom index', 0, min=0), Param.number('scale', 'Scale', 1, positive=True)])
def distance_profile(ctx, p):
    data = ctx.frames()
    import numpy as np
    d = np.linalg.norm(data.positions[0] - data.positions[0][p['atom']], axis=1) * p['scale']
    return profile(list(range(len(d))), {'d': d}, 'Atom', 'Distance (Å)', atoms=list(range(len(d))))
@analysis('writes_file', engine='ase', label='Writes a file', output={'suffix': '.txt'})
def writes_file(ctx, p):
    with open(ctx.output(), 'w') as fh:
        fh.write('hello')
    return table(['Written'], [['yes']])
@analysis('writes_trajectory', engine='custom', label='Writes a trajectory', output={'suffix': '-copy.extxyz', 'trajectory': True})
def writes_trajectory(ctx, p):
    import shutil
    shutil.copy(ctx.filename, ctx.output())
    return table(['Copied'], [['yes']])
@analysis('nan_series', engine='custom', label='NaN values')
def nan_series(ctx, p):
    return {'kind': 'series', 'x': [0, 1], 'series': [{'label': 'v', 'data': [1.0, float('nan')]}]}
@analysis('bad_length', engine='custom', label='Bad length')
def bad_length(ctx, p):
    return {'kind': 'series', 'x': [0, 1], 'series': [{'label': 'v', 'data': [1.0]}]}
''')
(folder / 'broken.py').write_text('def oops(:\n')
(folder / 'duplicate.py').write_text('''
from monet_registry import analysis, table
@analysis('radius_of_gyration', engine='custom', label='Another Rg')
def again(ctx, p):
    return table(['x'], [[1]])
''')
(folder / 'bad_atoms.py').write_text('''
from monet_registry import Param, analysis, table
@analysis('bad_atoms', engine='custom', label='Bad atoms', params=[Param('atoms_here', 'Atoms', 'atoms')])
def bad(ctx, p):
    return table(['x'], [[1]])
''')
env = {**os.environ, 'MONET_PLUGINS': str(folder)}
listed = bridge({'action': 'list_analyses'}, env)
errors = {e['source'].split('/')[-1]: e['error'] for e in listed['errors']}
assert set(errors) == {'broken.py', 'duplicate.py', 'bad_atoms.py'}, errors
assert 'SyntaxError' in errors['broken.py'] and 'already defined' in errors['duplicate.py'] and 'must be named indices' in errors['bad_atoms.py'], errors
assert 'custom.distance_profile' in [a['id'] for a in listed['analyses']]
checks += 1

water = str(root / 'examples' / 'water.XYZ')
# Parameter checks: defaults, ranges, unknown names.
r = bridge({'action': 'run_analysis', 'analysis': 'custom.distance_profile', 'filename': water, 'params': {'atom': 1, 'scale': 2}}, env)
assert r['ok'] and r['kind'] == 'profile' and r['atoms'] == [0, 1, 2] and abs(r['series'][0]['data'][1]) < 1e-12, r
r = bridge({'action': 'run_analysis', 'analysis': 'custom.distance_profile', 'filename': water, 'params': {'scale': -1}}, env)
assert not r['ok'] and 'greater than 0' in r['message'], r
r = bridge({'action': 'run_analysis', 'analysis': 'custom.distance_profile', 'filename': water, 'params': {'atom': 1.5}}, env)
assert not r['ok'] and 'whole number' in r['message'], r
r = bridge({'action': 'run_analysis', 'analysis': 'custom.distance_profile', 'filename': water, 'params': {'color': 'red'}}, env)
assert not r['ok'] and 'no parameter color' in r['message'], r
r = bridge({'action': 'run_analysis', 'analysis': 'custom.radius_of_gyration', 'filename': water, 'params': {'indices': [0, 7]}})
assert not r['ok'] and 'outside the 3 atoms' in r['message'], r
r = bridge({'action': 'run_analysis', 'analysis': 'custom.nope', 'filename': water, 'params': {}})
assert not r['ok'] and 'Unknown analysis' in r['message'], r
checks += 1

# Result checks: NaN becomes a gap, a series of the wrong length is refused.
r = bridge({'action': 'run_analysis', 'analysis': 'custom.nan_series', 'filename': water}, env)
assert r['ok'] and r['series'][0]['data'] == [1.0, None], r
r = bridge({'action': 'run_analysis', 'analysis': 'custom.bad_length', 'filename': water}, env)
assert not r['ok'] and 'as many values as x' in r['message'], r
r = bridge({'action': 'run_analysis', 'analysis': 'ase.writes_file', 'filename': water}, env)
assert not r['ok'] and 'choose where to save it' in r['message'], r
checks += 1

# Example plugins give the right numbers.
import numpy as np
from ase.io import read
frames = read(water, index=':')
masses = frames[0].get_masses()
expected = []
for atoms in frames:
    x = atoms.get_positions(); c = masses @ x / masses.sum()
    expected.append(math.sqrt(masses @ ((x - c) ** 2).sum(axis=1) / masses.sum()))
r = bridge({'action': 'run_analysis', 'analysis': 'custom.radius_of_gyration', 'filename': water, 'params': {}})
assert r['ok'] and np.allclose(r['series'][0]['data'], expected), (r, expected)
r = bridge({'action': 'run_analysis', 'analysis': 'ase.cell_volume', 'filename': str(root / 'examples' / 'periodic-water.xyz'), 'params': {'quantity': 'volume'}})
assert r['ok'] and abs(r['series'][0]['data'][0] - 1000) < 1e-9, r
checks += 1

# The MDAnalysis tab still uses mda_run with the short names; parameters are checked by the registry.
r = bridge({'action': 'mda_run', 'analysis': 'rgyr', 'filename': water, 'params': {'selection': 'all'}})
assert r['ok'] and r['analysis'] == 'mdanalysis.rgyr', r
r = bridge({'action': 'mda_run', 'analysis': 'hbonds', 'filename': water, 'params': {'d_a_cutoff': 9}})
assert not r['ok'] and 'at most 6' in r['message'], r
checks += 1

# Launcher: files written by an analysis become downloads, trajectories also become files to analyse.
os.environ['MONET_PLUGINS'] = str(folder)
import start_monet as sm
session = sm.Session()
upload = Path(session.new_dir('upload-')) / 'water.xyz'
upload.write_text(Path(water).read_text())
file_id = session.add_file(upload, 'water.xyz')
job = session.start({'action': 'run_analysis', 'analysis': 'ase.writes_file', 'file_id': file_id, 'output': '../../evil name.txt'}); job.done.wait()
assert job.result['ok'] and job.result['output'] == 'evil_name.txt', job.result
assert session.downloads[job.result['download_id']]['path'].read_text() == 'hello' and 'file_id' not in job.result
job = session.start({'action': 'run_analysis', 'analysis': 'custom.writes_trajectory', 'file_id': file_id, 'output': 'water-copy.extxyz'}); job.done.wait()
assert job.result['ok'] and job.result['file_id'] in session.files and job.result['download_id'], job.result
listed = session.start({'action': 'list_analyses'}); listed.done.wait()
assert listed.result['ok'] and 'custom.writes_trajectory' in [a['id'] for a in listed.result['analyses']]
session.close()
checks += 1

# Replay: plugin steps logged with MONET IDs run again with file indices.
from monet_replay import Session, Source
out = Path(tempfile.mkdtemp())
replay = Session(monet=str(root), out=str(out))
source = Source(water, 3, [11, 12, 13])
result = replay.run_analysis(source, analysis='custom.radius_of_gyration', params={'indices': [11, 12, 13], 'mass_weighted': True},
                             step=4, expect={'n_frames': 2})
assert result['ok'] and replay.differences == 0 and replay.failures == 0, result
checks += 1
print(checks)
`
const checks = Number(execFileSync(process.env.PYTHON || 'python3', ['-c', script, root], { encoding: 'utf8' }).trim().split('\n').pop())
console.log(`PASS: ${checks} registry checks (built-in and plugin analyses, discovery errors, parameters, results, file outputs, replay).`)

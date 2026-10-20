'use strict'
// Launcher internals (start_monet.py): persistent workers, job limit and the life of session files.
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

const script = String.raw`
import json, os, sys, tempfile, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import start_monet as sm

checks = 0
session = sm.Session()

# Workers are reused: two commands run on the same process, and a failing command does not kill it.
first = session.check(); first.done.wait()
assert first.result['ok'], first.result
pid = first.worker.process.pid
bad = session.register(sm.Job({'action': 'no_such_action'})); bad.done.wait()
assert bad.result['ok'] is False and 'Unknown action' in bad.result['message'], bad.result
again = session.check(); again.done.wait()
assert again.worker.process.pid == pid, 'the idle worker should be reused'
checks += 1

# A cancelled job kills its worker; the next job gets a fresh one.
sample = Path(session.new_dir('upload-')) / 'long.xyz'
sample.write_text(''.join(f'3\nframe {i}\nC 0 0 0\nH 0 0 1.1\nH 0 1 0\n' for i in range(4000)))
file_id = session.add_file(sample, 'long.xyz')
job = session.start({'action': 'angles', 'file_id': file_id, 'triplets': [[1, 0, 2]] * 200})
time.sleep(0.3)
job.cancel(); job.done.wait()
assert job.state == 'cancelled', job.state
time.sleep(0.2)
assert not job.worker.alive(), 'a cancelled worker must be stopped'
assert job.worker not in session.pool.idle
checks += 1

# The job limit is checked before any worker is used.
busy = [sm.Job({'action': 'check'}) for _ in range(sm.MAX_JOBS)]
for fake in busy:
    session.jobs[fake.id] = fake
refused = sm.Job({'action': 'check'})
try:
    session.register(refused)
    raise AssertionError('the limit was not applied')
except RuntimeError:
    pass
assert refused.worker is None and not refused.done.is_set()
for fake in busy:
    del session.jobs[fake.id]
checks += 1

# Session files: an upload folder goes when the page releases it.
folder = sample.parent
session.release(file_id)
assert not folder.exists()
checks += 1

# A job folder that produced nothing is deleted when the job ends.
before = set(session.dir.iterdir())
water = Path(session.new_dir('upload-')) / 'water.xyz'
water.write_text(Path(sys.argv[1], 'examples', 'water.XYZ').read_text())
water_id = session.add_file(water, 'water.xyz')
job = session.start({'action': 'rmsd', 'file_id': water_id}); job.done.wait()
assert job.result['ok'], job.result
assert set(session.dir.iterdir()) - before == {water.parent}, 'the empty job folder should be gone'
checks += 1

# A derived trajectory stays while its file or its download is referenced.
job = session.start({'action': 'unwrap', 'file_id': water_id, 'cell': [10, 10, 10, 90, 90, 90], 'pbc': [True, True, True]}); job.done.wait()
assert job.result['ok'], job.result
derived = session.files[job.result['file_id']]['path'].parent
session.release(job.result['file_id'])
assert derived.exists(), 'the download still needs the folder'
sm.MAX_DOWNLOADS = 1
session.add_download(water, 'again.xyz')
assert not derived.exists(), 'an evicted download frees its folder'
assert len(session.downloads) == 1
checks += 1

session.close()
assert not session.dir.exists()

# Every command key the bridge reads is either allowed from the page or set by the launcher itself,
# so a new parameter cannot be dropped silently in browser mode (registered analyses use 'params').
import re
source = Path(sys.argv[1], 'ase_bridge.py').read_text() + Path(sys.argv[1], 'monet_registry.py').read_text()
read = set(re.findall(r'''(?:cmd|command|self\._cmd)(?:\.get\(|\[)['"](\w+)['"]''', source))
launcher_set = {'action', 'filename', 'input', 'output', 'output_dir', 'zip', 'reference', 'cell_file'}
missing = read - sm.ALLOWED - launcher_set
assert not missing, f'add {sorted(missing)} to ALLOWED in start_monet.py'
checks += 1
print(checks)
`
const checks = Number(execFileSync(process.env.PYTHON || 'python3', ['-c', script, root], { encoding: 'utf8' }).trim().split('\n').pop())
console.log(`PASS: ${checks} launcher checks (worker reuse, cancel, job limit, session file cleanup, parameter whitelist).`)

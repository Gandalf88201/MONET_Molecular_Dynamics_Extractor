#!/usr/bin/env python3
"""Run MONET in a browser with a local, same-origin Python/ASE service.

Trajectories are uploaded once to a private session directory and referenced
by random file IDs; client paths are never used as filesystem paths.
Calculations run as background jobs that report progress and can be cancelled.
"""
import argparse
import atexit
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import parse_qs, unquote, urlsplit
import webbrowser
import zipfile

ROOT = Path(__file__).resolve().parent
STATIC = {'index.html', 'styles.css', 'theme.js', 'xyz.js', 'ase-model.js', 'fit.js', 'pbc.js', 'plot.js', 'browser-bridge.js',
          'units.js', 'qm-resolve.js', 'qm-inputs.js', 'qm-panel.js', 'viewer.js', 'renderer.js', 'provenance.js', 'console.js', 'report.js', 'replaygen.js', 'examples/water.XYZ'}
FORMATS = {'xyz', 'extxyz', 'vasp', 'cif', 'espresso-in', 'lammps-data', 'aims', 'turbomole', 'gaussian-in', 'dftb', 'json'}
ACTIONS = {'scan', 'frame', 'read_info', 'molecule', 'rmsd', 'pdd', 'bonds', 'angles', 'dihedrals', 'convert', 'extract', 'import',
           'rmsd_matrix', 'rdf', 'msd', 'vdos', 'unwrap', 'acf', 'equilibration', 'mda_select', 'mda_rmsf', 'mda_rgyr', 'mda_hbonds', 'cell_file', 'wrap', 'frames', 'subsample', 'mda_run', 'mda_align', 'topology', 'ase_structure', 'ase_coordination', 'fluctuations', 'select_atoms'}
ALLOWED = {'indices', 'quantity', 'groups', 'center', 'atom_ids', 'stride', 'start', 'fit_model', 'analysis', 'params', 'frame', 'symprec', 'frame_step', 'nbins', 'rmax', 'elements', 'pairs', 'triplets', 'quads', 'format',
           'first_frame_only', 'cell', 'pbc', 'mic', 'angle_range', 'angle_normal', 'seed', 'bond_scale',
           'index', 'selected', 'frequency', 'compute_average', 'generate_gaussian', 'atom_count', 'history', 'qm', 'source_name', 'cell_vectors',
           'align', 'unwrap', 'reference_index', 'max_frames', 'dt', 'fit_start', 'fit_end', 'remove_drift',
           'by_element', 'mass_weighted', 'smooth_cm', 'max_cm', 'quantity', 'groups', 'max_lag', 'mode', 'fit_until', 'tau_int_method',
           'selection', 'donors', 'hydrogens', 'acceptors', 'd_a_cutoff', 'angle', 'radius', 'pattern', 'restrict'}
MAX_JOBS = 3
MAX_JSON = 16 * 1024 * 1024
CHUNK = 1024 * 1024
SESSION_SCHEMA = 'monet-session/1'
SESSIONS_DIR = Path.home() / '.monet' / 'sessions'
SESSION_README = """MONET analysis session

session.json   the analysis history (schema monet-session/1); open it in MONET with History > Open session
methods.md     methods report: software versions, input checksums, steps and the reporting checklist
methods.docx   the same report for Word (only when pandoc was installed)
replay.py      re-runs the logged analyses without the browser and compares the numbers:
                 python replay.py --monet /path/to/MONET
               run it in the folder that holds the input trajectories
"""


def safe_name(name, fallback='file'):
    name = re.sub(r'[^A-Za-z0-9._-]+', '_', Path(str(name)).name).strip('._')
    return name[:120] or fallback


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(CHUNK), b''):
            digest.update(block)
    return digest.hexdigest()


def check_session(data):
    if not isinstance(data, dict) or not str(data.get('schema', '')).startswith('monet-session/'):
        raise ValueError('Not a MONET session file.')
    if data['schema'] != SESSION_SCHEMA:
        raise ValueError(f'This session uses {data["schema"]}; open it with a newer MONET.')
    if not isinstance(data.get('sources'), list) or not isinstance(data.get('steps'), list):
        raise ValueError('The session file is incomplete.')
    return data


def session_path(folder, data):
    """Autosave file of a session: checksum prefix, trajectory name, creation time. None without a checksum."""
    first = data['sources'][0] if data['sources'] and isinstance(data['sources'][0], dict) else {}
    digest = first.get('sha256')
    if not digest:
        return None
    if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise ValueError('Invalid checksum in the session.')
    stamp = re.sub(r'\D', '', str(data.get('created') or ''))[:14] or 'undated'
    return Path(folder) / f'{digest[:12]}-{safe_name(first.get("name") or "trajectory")}-{stamp}.json'


def write_atomic(path, text):
    """Write through a temporary file in the same folder, so a crash never leaves half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.tmp-', suffix='.json')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def save_session(folder, data):
    path = session_path(folder, check_session(data))
    if path is None:
        return {'ok': False, 'error': 'The trajectory checksum is not known yet; the history is kept in the page.'}
    write_atomic(path, json.dumps(data, allow_nan=False))
    return {'ok': True, 'saved': path.name}


def find_session(folder, digest):
    if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise ValueError('Invalid checksum.')
    found = []
    for path in Path(folder).glob(f'{digest[:12]}-*.json'):
        try:
            data = check_session(json.loads(path.read_text(encoding='utf-8')))
        except (OSError, ValueError):
            continue
        if data['sources'] and isinstance(data['sources'][0], dict) and data['sources'][0].get('sha256') == digest:
            found.append(data)
    # The newest history with more than the load step first; a history just started is the fallback.
    found.sort(key=lambda data: (len(data['steps']) > 1, str(data.get('updated', ''))))
    return {'ok': True, 'session': found[-1] if found else None}


def read_session(path):
    path = Path(path)
    try:
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as archive:
                names = [name for name in archive.namelist() if name.split('/')[-1] == 'session.json']
                if not names:
                    raise ValueError('The ZIP has no session.json.')
                info = archive.getinfo(names[0])
                if info.file_size > MAX_JSON:
                    raise ValueError('session.json is too large.')
                chunks = []
                total = 0
                with archive.open(info) as member:
                    while True:
                        chunk = member.read(64 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_JSON:
                            raise ValueError('session.json is too large.')
                        chunks.append(chunk)
                text = b''.join(chunks).decode('utf-8')
        else:
            if path.stat().st_size > MAX_JSON:
                raise ValueError('The session file is too large.')
            text = path.read_text(encoding='utf-8')
        data = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        raise ValueError(f'The session file is damaged ({error.__class__.__name__}).') from None
    return {'ok': True, 'session': check_session(data)}


def build_session_zip(target, data, methods, replay):
    check_session(data)
    if not isinstance(methods, str) or not isinstance(replay, str):
        raise ValueError('Invalid session export.')
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('session.json', json.dumps(data, indent=1, allow_nan=False))
        archive.writestr('methods.md', methods)
        archive.writestr('replay.py', replay)
        archive.writestr('README.txt', SESSION_README)
        pandoc = shutil.which('pandoc')
        if pandoc:
            with tempfile.TemporaryDirectory() as work:
                source, docx = Path(work) / 'methods.md', Path(work) / 'methods.docx'
                source.write_text(methods, encoding='utf-8')
                try:
                    done = subprocess.run([pandoc, str(source), '-o', str(docx)], capture_output=True, timeout=60)
                    if done.returncode == 0 and docx.exists():
                        archive.write(docx, 'methods.docx')
                except (OSError, subprocess.TimeoutExpired):
                    pass
    return target


class Job:
    """One ase_bridge.py subprocess; its progress lines are kept for polling."""

    def __init__(self, command, finish=None):
        self.id = secrets.token_urlsafe(12)
        self.command = command
        self.finish = finish
        self.state = 'running'
        self.progress = {'message': 'Starting …', 'percent': 0}
        self.result = None
        self.cancelled = False
        self.started = time.time()
        self.process = None
        self.lock = threading.Lock()
        self.done = threading.Event()
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        result, stderr = None, []
        try:
            self.process = subprocess.Popen(
                [sys.executable, str(ROOT / 'ase_bridge.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, encoding='utf-8')
            drain = threading.Thread(target=lambda: stderr.extend(self.process.stderr.readlines()[-20:]), daemon=True)
            drain.start()
            if self.cancelled:
                self.process.kill()
            try:
                self.process.stdin.write(json.dumps(self.command))
                self.process.stdin.close()
            except BrokenPipeError:
                pass
            for line in self.process.stdout:
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                if message.get('type') == 'progress':
                    self.progress = {'message': message.get('message', ''), 'percent': message.get('percent')}
                elif message.get('type') in {'result', 'error'}:
                    result = message
            self.process.wait()
            drain.join(1)
            if self.cancelled:
                result = {'ok': False, 'cancelled': True, 'error': 'Calculation cancelled.'}
            elif result is None:
                detail = ''.join(stderr).strip().splitlines()[-1:] or ['Check the Python installation.']
                result = {'ok': False, 'error': f'ASE returned no result. {detail[0]}'}
            elif result.get('ok') and self.finish:
                result = self.finish(result)
        except Exception as error:
            result = {'ok': False, 'error': str(error)}
        with self.lock:
            self.result = result
            self.state = 'cancelled' if self.cancelled else 'done' if result.get('ok') else 'error'
        self.done.set()

    def cancel(self):
        self.cancelled = True
        process = self.process
        if process and process.poll() is None:
            process.terminate()
            threading.Timer(3, lambda: process.poll() is None and process.kill()).start()

    def status(self):
        with self.lock:
            return {'ok': True, 'job_id': self.id, 'state': self.state, 'progress': self.progress,
                    'elapsed': round(time.time() - self.started, 1), 'result': self.result}


class Session:
    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix='monet-session-'))
        self.files = {}      # id -> {'path', 'name', 'size'}
        self.downloads = {}  # id -> {'path', 'name'}
        self.jobs = {}
        self.lock = threading.Lock()
        atexit.register(self.close)

    def close(self):
        for job in list(self.jobs.values()):
            job.cancel()
        shutil.rmtree(self.dir, ignore_errors=True)

    def new_dir(self, prefix):
        return Path(tempfile.mkdtemp(prefix=prefix, dir=self.dir))

    def add_file(self, path, name, sha256=None):
        file_id = secrets.token_urlsafe(16)
        digest = sha256 or sha256_file(path)
        with self.lock:
            self.files[file_id] = {'path': Path(path), 'name': name, 'size': Path(path).stat().st_size, 'sha256': digest}
        return file_id

    def add_download(self, path, name):
        download_id = secrets.token_urlsafe(16)
        with self.lock:
            self.downloads[download_id] = {'path': Path(path), 'name': safe_name(name, 'download')}
        return download_id

    def file(self, file_id):
        entry = self.files.get(file_id) if isinstance(file_id, str) else None
        if not entry or not entry['path'].exists():
            raise ValueError('Select the trajectory file again (the server no longer has it).')
        return entry

    def release(self, file_id):
        """Delete an uploaded file (not job outputs, which may still be downloaded)."""
        with self.lock:
            entry = self.files.get(file_id) if isinstance(file_id, str) else None
            if not entry or not entry['path'].parent.name.startswith('upload-'):
                return
            self.files.pop(file_id)
        shutil.rmtree(entry['path'].parent, ignore_errors=True)

    def register(self, job):
        with self.lock:
            if sum(old.state == 'running' for old in self.jobs.values()) >= MAX_JOBS:
                job.cancel()
                raise RuntimeError('Too many calculations are running. Please wait.')
            self.jobs[job.id] = job
            finished = [key for key, old in self.jobs.items() if old.state != 'running']
            for key in finished[:-50]:
                self.jobs.pop(key, None)
        return job

    def check(self):
        return self.register(Job({'action': 'check'}))

    def start(self, request):
        action = request.get('action')
        if action not in ACTIONS:
            raise ValueError('Unsupported ASE action.')
        command = {key: value for key, value in request.items() if key in ALLOWED}
        command['action'] = action
        if action == 'convert':
            source = self.file(request.get('input_id') or request.get('file_id'))
            fmt = command.get('format') or 'extxyz'
            if fmt not in FORMATS:
                raise ValueError('Choose a supported output format.')
        else:
            source = self.file(request.get('file_id'))
        workdir = self.new_dir('job-')
        command['filename'] = str(source['path'])
        if action == 'convert':
            command.update(input=str(source['path']), output=str(workdir / 'converted.out'), format=fmt)
        if action == 'extract':
            command.update(output_dir=str(workdir / 'MONET-results'), zip=str(workdir / 'MONET-results.zip'))
        if action == 'unwrap':
            command['output'] = str(workdir / 'unwrapped.extxyz')
        if action == 'wrap':
            command['output'] = str(workdir / 'wrapped.extxyz')
        if action == 'subsample':
            command['output'] = str(workdir / 'uncorrelated.extxyz')
        if action == 'mda_align':
            command['output'] = str(workdir / 'aligned.extxyz')
        if action == 'mda_run' and command.get('analysis') == 'density':
            command['output'] = str(workdir / 'density.dx')
        if action == 'import':
            command['output'] = str(workdir / 'imported.extxyz')
            for key, field in (('reference_id', 'reference'), ('cell_id', 'cell_file')):
                if request.get(key):
                    command[field] = str(self.file(request[key])['path'])

        def finish(result):
            if action == 'convert':
                output = safe_name(request.get('output') or 'converted', 'converted')
                result['output'] = output
                result['download_id'] = self.add_download(workdir / 'converted.out', output)
            elif action == 'unwrap':
                stem = Path(safe_name(request.get('output') or 'trajectory')).stem
                result['output'] = f'{stem}-unwrapped.extxyz'
                result['download_id'] = self.add_download(workdir / 'unwrapped.extxyz', result['output'])
                result['file_id'] = self.add_file(workdir / 'unwrapped.extxyz', result['output'])
            elif action == 'mda_align':
                stem = Path(safe_name(request.get('output') or 'trajectory')).stem
                result['output'] = f'{stem}.extxyz' if stem.endswith('aligned') else f'{stem}-aligned.extxyz'
                result['download_id'] = self.add_download(workdir / 'aligned.extxyz', result['output'])
                result['file_id'] = self.add_file(workdir / 'aligned.extxyz', result['output'])
            elif action == 'mda_run' and command.get('analysis') == 'density':
                result['output'] = 'density.dx'
                result['download_id'] = self.add_download(workdir / 'density.dx', 'density.dx')
            elif action == 'subsample':
                stem = Path(safe_name(request.get('output') or 'trajectory')).stem
                result['output'] = f'{stem}.extxyz' if stem.endswith('uncorrelated') else f'{stem}-uncorrelated.extxyz'
                result['download_id'] = self.add_download(workdir / 'uncorrelated.extxyz', result['output'])
                result['file_id'] = self.add_file(workdir / 'uncorrelated.extxyz', result['output'])
            elif action == 'wrap':
                stem = Path(safe_name(request.get('output') or 'trajectory')).stem
                result['output'] = f'{stem}-wrapped.extxyz'
                result['download_id'] = self.add_download(workdir / 'wrapped.extxyz', result['output'])
            elif action == 'import':
                stem = Path(safe_name(request.get('source_name') or 'trajectory')).stem
                result['file_id'] = self.add_file(workdir / 'imported.extxyz', f'{stem}.extxyz')
            elif action == 'extract':
                result['download_id'] = self.add_download(workdir / 'MONET-results.zip', 'MONET-results.zip')
                result['extracted_id'] = self.add_file(result.pop('fullTrajectory'), 'FULL_TRAJECTORY_EXTRACTED.xyz')
            # Checksums of new files, for the analysis history.
            if result.get('file_id') in self.files:
                result['sha256'] = self.files[result['file_id']]['sha256']
            if result.get('extracted_id') in self.files:
                result['extracted_sha256'] = self.files[result['extracted_id']]['sha256']
            return result

        return self.register(Job(command, finish))

    def export_session(self, request):
        folder = self.new_dir('session-')
        name = safe_name(request.get('name') or 'MONET-session.zip', 'MONET-session.zip')
        build_session_zip(folder / 'session.zip', request.get('session'), request.get('methods'), request.get('replay'))
        return {'ok': True, 'download_id': self.add_download(folder / 'session.zip', name)}


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, max_upload, sessions_dir=SESSIONS_DIR):
        super().__init__(address, Handler)
        self.token = secrets.token_urlsafe(32)
        self.session = Session()
        self.max_upload = max_upload
        self.sessions_dir = Path(sessions_dir).expanduser()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, status, data, content_type='application/json'):
        if isinstance(data, dict):
            data = json.dumps(data, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.security_headers()
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def security_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "frame-ancestors 'none'")

    def valid_host(self):
        return self.headers.get('Host') in {
            f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'
        }

    def authorized(self, token=None):
        expected_origin = 'http://' + self.headers.get('Host', '')
        supplied = self.headers.get('X-Monet-Token', '') if token is None else token
        return (self.valid_host() and self.headers.get('Origin', expected_origin) == expected_origin
                and secrets.compare_digest(supplied, self.server.token))

    def denied(self):
        self.respond(403, {'ok': False, 'error': 'Open MONET using the URL printed by the launcher.'})

    def do_GET(self):
        if not self.valid_host():
            return self.respond(403, {'ok': False, 'error': 'Invalid host.'})
        url = urlsplit(self.path)
        if url.path.startswith('/api/'):
            return self.api_get(url)
        filename = url.path.lstrip('/') or 'index.html'
        if filename not in STATIC:
            return self.respond(404, {'ok': False, 'error': 'Not found.'})
        data = (ROOT / filename).read_bytes()
        if filename == 'index.html':
            data = data.replace(b'</head>', f'<meta name="monet-api-token" content="{self.server.token}">\n</head>'.encode())
        mime = 'text/html' if filename.endswith('.html') else 'text/css' if filename.endswith('.css') else 'text/javascript' if filename.endswith('.js') else 'text/plain'
        self.respond(200, data, mime + '; charset=utf-8')

    def api_get(self, url):
        session = self.server.session
        parts = url.path.split('/')
        if url.path.startswith('/api/download/') and len(parts) == 4:
            # Plain links cannot send headers, so downloads carry the token in the query.
            if not self.authorized(parse_qs(url.query).get('token', [''])[0]):
                return self.denied()
            entry = session.downloads.get(parts[3])
            if not entry or not entry['path'].exists():
                return self.respond(404, {'ok': False, 'error': 'This download is no longer available.'})
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(entry['path'].stat().st_size))
            self.send_header('Content-Disposition', f'attachment; filename="{entry["name"]}"')
            self.security_headers()
            self.end_headers()
            try:
                with entry['path'].open('rb') as fh:
                    shutil.copyfileobj(fh, self.wfile, CHUNK)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if not self.authorized():
            return self.denied()
        if url.path.startswith('/api/jobs/') and len(parts) == 4:
            job = session.jobs.get(parts[3])
            if not job:
                return self.respond(404, {'ok': False, 'error': 'Unknown calculation.'})
            return self.respond(200, job.status())
        self.respond(404, {'ok': False, 'error': 'Not found.'})

    def do_POST(self):
        if not self.authorized():
            return self.denied()
        session = self.server.session
        try:
            length = int(self.headers.get('Content-Length', 0))
            self.connection.settimeout(120)
            if self.path == '/api/upload':
                return self.upload(length)
            if length <= 0 or length > MAX_JSON:
                return self.respond(413, {'ok': False, 'error': 'Request is empty or too large.'})
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError('Invalid request.')
            parts = self.path.split('/')
            if self.path == '/api/check':
                result = self.wait(session.check())
            elif self.path == '/api/jobs':
                result = {'ok': True, 'job_id': session.start(request).id}
            elif self.path == '/api/formats':
                result = self.wait(session.register(Job({'action': 'formats'})))
            elif self.path == '/api/run':
                result = self.wait(session.start(request))
            elif self.path == '/api/release':
                session.release(request.get('file_id'))
                result = {'ok': True}
            elif self.path == '/api/session/save':
                result = save_session(self.server.sessions_dir, request.get('session'))
            elif self.path == '/api/session/find':
                result = find_session(self.server.sessions_dir, request.get('sha256'))
            elif self.path == '/api/session/export':
                result = session.export_session(request)
            elif self.path == '/api/session/read':
                result = read_session(session.file(request.get('file_id'))['path'])
            elif self.path.startswith('/api/jobs/') and len(parts) == 5 and parts[4] == 'cancel':
                job = session.jobs.get(parts[3])
                if job:
                    job.cancel()
                result = {'ok': True}
            else:
                return self.respond(404, {'ok': False, 'error': 'Not found.'})
            self.respond(200, result)
        except RuntimeError as error:
            self.respond(409, {'ok': False, 'error': str(error)})
        except (ValueError, KeyError, TypeError) as error:
            self.respond(400, {'ok': False, 'error': str(error)})
        except Exception as error:
            self.respond(500, {'ok': False, 'error': str(error)})

    @staticmethod
    def wait(job):
        job.done.wait()
        return job.result

    def upload(self, length):
        if length <= 0:
            return self.respond(411, {'ok': False, 'error': 'Upload requires a non-empty file.'})
        if length > self.server.max_upload:
            return self.respond(413, {'ok': False, 'error': 'The file exceeds the launcher upload limit (see --max-upload-gb).'})
        session = self.server.session
        name = unquote(self.headers.get('X-Monet-Filename', 'trajectory.xyz'))
        folder = session.new_dir('upload-')
        target = folder / safe_name(name, 'trajectory.xyz')
        remaining = length
        digest = hashlib.sha256()
        try:
            with target.open('wb') as fh:
                while remaining:
                    block = self.rfile.read(min(CHUNK, remaining))
                    if not block:
                        raise ValueError('Upload interrupted.')
                    fh.write(block)
                    digest.update(block)
                    remaining -= len(block)
        except Exception:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        sha256 = digest.hexdigest()
        self.respond(200, {'ok': True, 'file_id': session.add_file(target, name, sha256), 'size': length, 'sha256': sha256})


def open_browser(url):
    """Open the default browser; failures are reported briefly instead of as AppleScript errors."""
    try:
        if sys.platform == 'darwin':
            opened = subprocess.run(['open', url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        else:
            opened = webbrowser.open(url)
    except OSError:
        opened = False
    if not opened:
        print(f'Could not open a browser automatically; open {url} yourself.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--max-upload-gb', type=float, default=200,
                        help='largest trajectory accepted from the browser (default: 200 GB)')
    parser.add_argument('--sessions-dir', default=str(SESSIONS_DIR),
                        help=f'folder for the autosaved analysis histories (default: {SESSIONS_DIR})')
    args = parser.parse_args()
    try:
        server = Server(('127.0.0.1', args.port), int(args.max_upload_gb * 1024 ** 3), args.sessions_dir)
    except OSError as error:
        print(f'Cannot start MONET: {error}. Try --port 8766.', file=sys.stderr)
        return 1
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'MONET: {url}\nKeep this terminal open. Press Ctrl+C to stop.', flush=True)
    print(f'Session files: {server.session.dir} (removed on exit)', flush=True)
    print(f'Analysis histories: {server.sessions_dir} (kept)', flush=True)
    if not args.no_browser:
        open_browser(url)

    def stop(*_):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.session.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

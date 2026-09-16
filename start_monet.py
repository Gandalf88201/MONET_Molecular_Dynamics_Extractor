#!/usr/bin/env python3
"""Run MONET in a browser with a local, same-origin Python/ASE service."""
import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent
MAX_BODY = 150 * 1024 * 1024
STATIC = {'index.html', 'styles.css', 'xyz.js', 'ase-model.js', 'plot.js', 'browser-bridge.js', 'renderer.js', 'examples/water.XYZ'}
FORMATS = {'xyz', 'extxyz', 'vasp', 'cif', 'espresso-in', 'lammps-data', 'aims', 'turbomole', 'gaussian-in', 'dftb', 'json'}


def run_bridge(command):
    completed = subprocess.run(
        [sys.executable, str(ROOT / 'ase_bridge.py')], input=json.dumps(command),
        text=True, encoding='utf-8', capture_output=True, timeout=300,
    )
    for line in reversed(completed.stdout.splitlines()):
        try:
            result = json.loads(line)
        except ValueError:
            continue
        if result.get('type') in {'result', 'error'}:
            return result
    return {'ok': False, 'error': 'ASE returned no result. Check the Python installation.'}


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address):
        super().__init__(address, Handler)
        self.token = secrets.token_urlsafe(32)
        self.job = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, status, data, content_type='application/json'):
        if isinstance(data, dict):
            data = json.dumps(data, allow_nan=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "frame-ancestors 'none'")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def valid_host(self):
        return self.headers.get('Host') in {
            f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'
        }

    def do_GET(self):
        if not self.valid_host():
            return self.respond(403, {'ok': False, 'error': 'Invalid host.'})
        filename = self.path.split('?', 1)[0].lstrip('/') or 'index.html'
        if filename not in STATIC:
            return self.respond(404, {'ok': False, 'error': 'Not found.'})
        data = (ROOT / filename).read_bytes()
        if filename == 'index.html':
            data = data.replace(b'</head>', f'<meta name="monet-api-token" content="{self.server.token}">\n</head>'.encode())
        mime = 'text/html' if filename.endswith('.html') else 'text/css' if filename.endswith('.css') else 'text/javascript' if filename.endswith('.js') else 'text/plain'
        self.respond(200, data, mime + '; charset=utf-8')

    def do_POST(self):
        expected_origin = 'http://' + self.headers.get('Host', '')
        if (not self.valid_host()
                or self.headers.get('Origin', expected_origin) != expected_origin
                or not secrets.compare_digest(self.headers.get('X-Monet-Token', ''), self.server.token)):
            return self.respond(403, {'ok': False, 'error': 'Open MONET using the URL printed by the launcher.'})
        if self.path not in {'/api/check', '/api/run'}:
            return self.respond(404, {'ok': False, 'error': 'Not found.'})
        try:
            length = int(self.headers.get('Content-Length', 0))
            if length <= 0 or length > MAX_BODY:
                return self.respond(413, {'ok': False, 'error': 'Request is empty or too large for browser ASE.'})
            self.connection.settimeout(60)
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError('Invalid request.')
            if not self.server.job.acquire(blocking=False):
                return self.respond(409, {'ok': False, 'error': 'An ASE calculation is already running. Please wait.'})
            try:
                if self.path == '/api/check':
                    result = run_bridge({'action': 'check'})
                else:
                    result = self.calculate(request)
                self.respond(200, result)
            finally:
                self.server.job.release()
        except subprocess.TimeoutExpired:
            self.respond(408, {'ok': False, 'error': 'ASE exceeded five minutes. Increase the frame step or use a smaller trajectory.'})
        except (ValueError, KeyError, TypeError) as error:
            self.respond(400, {'ok': False, 'error': str(error)})
        except Exception as error:
            self.respond(500, {'ok': False, 'error': str(error)})

    def calculate(self, request):
        action = request.get('action')
        if action not in {'read_info', 'molecule', 'rmsd', 'pdd', 'bonds', 'angles', 'dihedrals', 'convert'}:
            raise ValueError('Unsupported ASE action.')
        contents = request.get('contents')
        if not isinstance(contents, str) or not contents.strip():
            raise ValueError('Select a non-empty XYZ file first.')
        with tempfile.TemporaryDirectory(prefix='monet-ase-') as directory:
            # Client paths are never used as filesystem paths.
            source = Path(directory) / 'input.xyz'
            source.write_text(contents, encoding='utf-8')
            allowed = {'indices', 'frame_step', 'nbins', 'rmax', 'elements', 'pairs', 'triplets', 'quads', 'format', 'first_frame_only', 'cell', 'pbc', 'mic', 'angle_range', 'angle_normal', 'seed', 'bond_scale'}
            command = {key: value for key, value in request.items() if key in allowed}
            command.update(action=action, filename=str(source))
            if action == 'convert':
                fmt = command.get('format') or 'extxyz'
                if fmt not in FORMATS:
                    raise ValueError('Choose a supported output format.')
                output = Path(directory) / 'converted.out'
                command.update(input=str(source), output=str(output), format=fmt)
            result = run_bridge(command)
            if action == 'convert' and result.get('ok'):
                result['output'] = 'converted'
                result['data_base64'] = base64.b64encode(output.read_bytes()).decode('ascii')
            return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    try:
        server = Server(('127.0.0.1', args.port))
    except OSError as error:
        print(f'Cannot start MONET: {error}. Try --port 8766.', file=sys.stderr)
        return 1
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'MONET: {url}\nKeep this terminal open. Press Ctrl+C to stop.', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

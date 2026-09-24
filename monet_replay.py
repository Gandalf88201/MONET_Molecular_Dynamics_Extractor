"""Headless replay of a MONET analysis session, used by the replay.py scripts MONET writes.

Each call builds the same command the browser sends (MONET atom IDs become file indices), runs
ase_bridge.py, writes the result to the output folder and compares the logged key numbers.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

ATOM_KEYS = ('indices', 'groups', 'pairs', 'triplets', 'quads')
ANALYSES = ('rmsd', 'rmsd_matrix', 'pdd', 'rdf', 'bonds', 'angles', 'dihedrals', 'msd', 'vdos', 'acf',
            'equilibration', 'fluctuations', 'mda_run', 'run_analysis', 'ase_structure', 'ase_coordination')
DERIVED = {'subsample': 'uncorrelated.extxyz', 'mda_align': 'aligned.extxyz', 'unwrap': 'unwrapped.extxyz', 'wrap': 'wrapped.extxyz'}
# MONET sends its atom IDs (and the bond cutoff scale) to these actions only, as renderer.js does.
NEEDS_IDS = ('mda_', 'topology', 'ase_', 'fluctuations', 'run_analysis')


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for block in iter(lambda: fh.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def _get(result, path):
    for key in path.split('.'):
        if not isinstance(result, dict) or key not in result:
            return None
        result = result[key]
    return result


def _same(expected, actual, rtol):
    if isinstance(expected, bool) or isinstance(actual, bool) or isinstance(expected, str):
        return expected == actual
    if expected is None or actual is None:
        return expected is None and (actual is None or (isinstance(actual, float) and math.isnan(actual)))
    return abs(actual - expected) <= rtol * max(abs(actual), abs(expected)) + 1e-12


class Source:
    """A trajectory on disk with the MONET ID of each of its atoms (None: IDs 1…N in file order)."""

    def __init__(self, path, atoms, atom_ids=None):
        self.path, self.atoms, self.atom_ids = Path(path), atoms, atom_ids

    def index(self, monet_id):
        if self.atom_ids is None:
            if not isinstance(monet_id, int) or not 1 <= monet_id <= (self.atoms or monet_id):
                raise ValueError(f'MONET atom {monet_id} is not in {self.path.name}.')
            return monet_id - 1
        try:
            return self.atom_ids.index(monet_id)
        except ValueError:
            raise ValueError(f'MONET atom {monet_id} is not in {self.path.name}.') from None

    def ids(self):
        return list(self.atom_ids) if self.atom_ids is not None else list(range(1, (self.atoms or 0) + 1))


def _to_indices(value, source):
    return [_to_indices(item, source) for item in value] if isinstance(value, list) else source.index(value)


class Session:
    def __init__(self, monet=None, out='replay_out', rtol=1e-6, force=False):
        root = Path(monet or os.environ.get('MONET_HOME') or Path(__file__).resolve().parent)
        self.bridge = root / 'ase_bridge.py'
        if not self.bridge.exists():
            raise SystemExit(f'ase_bridge.py not found in {root}: pass --monet /path/to/MONET or set MONET_HOME.')
        self.out = Path(out)
        self.out.mkdir(parents=True, exist_ok=True)
        self.rtol, self.force = rtol, force
        self.opts = {}
        self.checked = self.differences = self.failures = self.unchecked = 0

    def load(self, name, sha256=None, atoms=None, atom_ids=None, import_format=None, reference=None,
             cell_file=None, cell_vectors='rows', step=None):
        path = Path(name)
        if not path.exists():
            raise SystemExit(f'{name} not found: run replay.py in the folder that holds it, or edit its path here.')
        if sha256:
            actual = sha256_file(path)
            if actual != sha256:
                message = f'{name}: SHA-256 {actual[:12]}… differs from the logged {sha256[:12]}… (different file).'
                if not self.force:
                    raise SystemExit(message + ' Use --force to replay anyway.')
                print('WARNING: ' + message)
        if import_format:
            output = self.out / f'step{step or 0:02d}_import.extxyz'
            command = {'action': 'import', 'filename': str(path), 'format': import_format, 'cell_vectors': cell_vectors,
                       'output': str(output), 'source_name': path.name}
            if reference:
                command['reference'] = str(Path(reference))
            if cell_file:
                command['cell_file'] = str(Path(cell_file))
            result = self._bridge(command)
            if not result.get('ok'):
                raise SystemExit(f'Import of {name} failed: {result.get("message") or result.get("error")}')
            path = output
        return Source(path, atoms, atom_ids)

    def options(self, **options):
        """Cell, PBC, minimum image and bond cutoff scale sent with every later step, as in MONET."""
        self.opts = {key: value for key, value in options.items() if value is not None}

    def _bridge(self, command):
        process = subprocess.run([sys.executable, str(self.bridge)], input=json.dumps(command),
                                 capture_output=True, text=True, encoding='utf-8')
        result = None
        for line in process.stdout.splitlines():
            try:
                message = json.loads(line)
            except ValueError:
                continue
            if message.get('type') in ('result', 'error'):
                result = message
        if result is None:
            tail = process.stderr.strip().splitlines()[-1:] or ['no output']
            result = {'ok': False, 'message': f'ASE returned no result ({tail[0]}).'}
        return result

    def _command(self, action, source, args):
        command = dict(args)
        for key in ATOM_KEYS:
            if command.get(key) is not None:
                command[key] = _to_indices(command[key], source)
        params = command.get('params')
        if isinstance(params, dict):
            command['params'] = {key: _to_indices(value, source) if key in ATOM_KEYS and value is not None else value
                                 for key, value in params.items()}
        command.update(self.opts)
        if action.startswith(NEEDS_IDS):
            command['atom_ids'] = source.ids()
        else:
            command.pop('bond_scale', None)
        command.update(action=action, filename=str(source.path))
        return command

    def _check(self, label, name, result, expect):
        (self.out / f'{name}.json').write_text(json.dumps(result, indent=1))
        if not result.get('ok'):
            return self._fail(label, result.get('message') or result.get('error') or 'failed')
        bad = []
        for key, value in (expect or {}).items():
            self.checked += 1
            actual = _get(result, key)
            if not _same(value, actual, self.rtol):
                bad.append(f'{key}: logged {value}, now {actual}')
        if bad:
            self.differences += 1
            print(f'DIFF {label}: ' + '; '.join(bad))
        elif not expect:
            # Nothing logged for this step to compare against (e.g. bond lengths, whose report
            # values are statistics, not raw numbers): it ran, but that is not the same as OK.
            self.unchecked += 1
            print(f'RAN  {label} (no logged values to compare)')
        else:
            print(f'OK   {label} ({len(expect)} values)')
        return result

    def _fail(self, label, message):
        self.failures += 1
        print(f'FAIL {label}: {message}')
        return {'ok': False, 'message': message}

    @staticmethod
    def _names(action, step):
        return (f'step {step} {action}' if step is not None else action,
                f'step{step:02d}_{action}' if step is not None else action)

    def run(self, action, source, step=None, expect=None, **args):
        label, name = self._names(action, step)
        try:
            command = self._command(action, source, args)
        except ValueError as error:
            return self._fail(label, str(error))
        if action in ('mda_run', 'run_analysis'):
            # Analyses that write a file (e.g. a density grid) write it next to the step result.
            command['output'] = str(self.out / f'{name}_output')
        return self._check(label, name, self._bridge(command), expect)

    def __getattr__(self, name):
        if name in ANALYSES:
            return lambda source, **kwargs: self.run(name, source, **kwargs)
        raise AttributeError(name)

    def derive(self, source, action, step=None, expect=None, **args):
        if action not in DERIVED:
            raise ValueError(f'Unknown derived trajectory {action!r}.')
        label, name = self._names(action, step)
        output = self.out / f'{name}_{DERIVED[action]}'
        try:
            command = self._command(action, source, args)
        except ValueError as error:
            self._fail(label, str(error))
            return source
        command['output'] = str(output)
        self._check(label, name, self._bridge(command), expect)
        return Source(output, source.atoms, source.atom_ids)

    def extract(self, source, step=None, selected=(), frequency=1, compute_average=True, qm=None, expect=None):
        label, name = self._names('extract', step)
        folder = self.out / name
        folder.mkdir(parents=True, exist_ok=True)
        command = {'action': 'extract', 'filename': str(source.path), 'selected': list(selected), 'frequency': frequency,
                   'atom_count': source.atoms, 'compute_average': bool(compute_average), 'generate_gaussian': False,
                   'output_dir': str(folder / 'MONET-results'), 'zip': str(folder / 'MONET-results.zip')}
        if qm:
            command['qm'] = qm
        result = self._check(label, name, self._bridge(command), expect)
        full = result.get('fullTrajectory') or str(folder / 'MONET-results' / '1-FULL_TRAJECTORY_EXTRACTED' / 'FULL_TRAJECTORY_EXTRACTED.xyz')
        return Source(full, len(selected), sorted(selected))

    def report(self):
        print(f'\n{self.checked} values compared: {self.differences} steps differ, {self.failures} failed, '
              f'{self.unchecked} steps ran without logged values. Outputs in {self.out}/')
        return 1 if self.differences or self.failures else 0

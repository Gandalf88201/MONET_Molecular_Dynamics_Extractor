"""Registry of MONET analyses: the built-in MDAnalysis collection and plugins.

An analysis is a Python function decorated with @analysis. It declares its parameters, and MONET
builds the form, checks the values, runs the function on the active trajectory in a worker and
plots what it returns. Adding an analysis needs no JavaScript and no launcher change.

    from monet_registry import analysis, Param, series

    @analysis('radius_of_gyration', engine='custom', label='Radius of gyration',
              params=[Param.atoms('Atoms (blank = all)')])
    def radius_of_gyration(ctx, p):
        data = ctx.frames(p['indices'])
        ...
        return series(data.frames, {'Rg': values}, x_label='Frame', y_label='Rg (Å)')

Where analyses come from (see docs/plugins.md):
  - built-in modules listed in BUILTIN (monet_analyses/…);
  - *.py files in <MONET>/plugins, in ~/.monet/plugins and in the folders of $MONET_PLUGINS;
  - installed packages that declare the entry point group "monet.analyses".
A plugin that fails to import is reported in the interface; it never stops MONET.
"""
from dataclasses import dataclass
import hashlib
import importlib
import importlib.util
import math
import os
from pathlib import Path
import re
import sys
from typing import Any, Callable, Optional

ROOT = Path(__file__).resolve().parent
ENGINES = {'ase': 'ASE', 'mdanalysis': 'MDAnalysis', 'custom': 'MONET Custom Functionalities'}
# Python modules each engine needs; an analysis may declare more with requires=(...).
ENGINE_REQUIRES = {'ase': ('ase',), 'mdanalysis': ('MDAnalysis',), 'custom': ()}
BUILTIN = ('monet_analyses.mdanalysis',)
ENTRY_POINT_GROUP = 'monet.analyses'
KINDS = ('series', 'profile', 'matrix', 'table')
PARAM_TYPES = ('number', 'integer', 'bool', 'choice', 'text', 'selection', 'lines', 'atoms', 'groups')
_NAME = re.compile(r'^[a-z][a-z0-9_]{0,47}$')
# Atom inputs use the names MONET converts between file indices and MONET IDs everywhere
# (history, console, replay scripts), so they are fixed per type.
ATOM_PARAM_NAMES = {'atoms': ('indices',), 'groups': ('pairs', 'triplets', 'quads', 'groups')}
MAX_TEXT = 2000


# ── parameters ───────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Param:
    """One input of an analysis. Build it with the class methods (Param.number, Param.atoms, …).

    Atom inputs are typed by the user as MONET IDs and reach the analysis as 0-based indices of the
    analysed file, the order of ctx.frames() positions and ctx.atoms().
    """
    name: str
    label: str
    type: str
    default: Any = None
    min: Optional[float] = None
    max: Optional[float] = None
    positive: bool = False
    choices: tuple = ()
    width: Optional[int] = None
    optional: bool = False
    help: str = ''

    def __post_init__(self):
        if not _NAME.match(self.name):
            raise ValueError(f'Parameter name {self.name!r} must be lower_case letters, digits and _.')
        if self.type not in PARAM_TYPES:
            raise ValueError(f'Parameter {self.name}: unknown type {self.type!r} (use one of {", ".join(PARAM_TYPES)}).')
        if self.type == 'choice' and self.default is not None and self.default not in self.choices:
            raise ValueError(f'Parameter {self.name}: the default {self.default!r} is not one of the choices.')
        if self.type == 'groups' and (not isinstance(self.width, int) or self.width < 1):
            raise ValueError(f'Parameter {self.name}: groups need a width (atoms per group).')
        if self.type in ATOM_PARAM_NAMES and self.name not in ATOM_PARAM_NAMES[self.type]:
            raise ValueError(f'Parameter {self.name}: {self.type} parameters must be named '
                             f'{" or ".join(ATOM_PARAM_NAMES[self.type])} (MONET stores them as MONET IDs).')

    @classmethod
    def number(cls, name, label, default=None, min=None, max=None, positive=False, help=''):
        return cls(name, label, 'number', default, min, max, positive, help=help)

    @classmethod
    def integer(cls, name, label, default=None, min=None, max=None, help=''):
        return cls(name, label, 'integer', default, min, max, help=help)

    @classmethod
    def bool(cls, name, label, default=False, help=''):
        return cls(name, label, 'bool', bool(default), help=help)

    @classmethod
    def choice(cls, name, label, choices, default=None, help=''):
        choices = tuple(choices)
        return cls(name, label, 'choice', choices[0] if default is None else default, choices=choices, help=help)

    @classmethod
    def text(cls, name, label, default='', help=''):
        return cls(name, label, 'text', default, help=help)

    @classmethod
    def selection(cls, name, label, default='all', help=''):
        """An MDAnalysis selection string (the form offers ← picked for the viewer atoms)."""
        return cls(name, label, 'selection', default, help=help)

    @classmethod
    def lines(cls, name, label, help=''):
        """Several strings, one per line (e.g. extra selections)."""
        return cls(name, label, 'lines', [], help=help)

    @classmethod
    def atoms(cls, label, optional=True, help='', name='indices'):
        """Atoms typed as MONET IDs; the analysis receives p['indices'], 0-based indices or None when left blank."""
        return cls(name, label, 'atoms', None, optional=optional, help=help)

    @classmethod
    def groups(cls, name, label, width, help=''):
        """Groups of `width` atoms typed as MONET IDs; name is pairs, triplets, quads or groups."""
        return cls(name, label, 'groups', [], width=width, help=help)

    def spec(self):
        out = {'name': self.name, 'label': self.label, 'type': self.type, 'default': self.default, 'help': self.help}
        for key in ('min', 'max', 'width'):
            if getattr(self, key) is not None:
                out[key] = getattr(self, key)
        if self.positive:
            out['positive'] = True
        if self.choices:
            out['choices'] = list(self.choices)
        if self.optional:
            out['optional'] = True
        return out

    def coerce(self, value):
        """The checked value, or ValueError naming the field as the form shows it."""
        where = f'“{self.label}”'
        if value is None or (isinstance(value, str) and not value.strip() and self.type in ('selection', 'number', 'integer')):
            if self.type in ('atoms',) and self.optional:
                return None
            if self.default is None and not self.optional:
                raise ValueError(f'{where} is required.')
            return self.default
        kind = self.type
        if kind in ('number', 'integer'):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f'{where} must be a number.')
            if kind == 'integer':
                if value != int(value):
                    raise ValueError(f'{where} must be a whole number.')
                value = int(value)
            if self.positive and value <= 0:
                raise ValueError(f'{where} must be greater than 0.')
            if self.min is not None and value < self.min:
                raise ValueError(f'{where} must be at least {self.min}.')
            if self.max is not None and value > self.max:
                raise ValueError(f'{where} must be at most {self.max}.')
            return value
        if kind == 'bool':
            if not isinstance(value, bool):
                raise ValueError(f'{where} must be true or false.')
            return value
        if kind == 'choice':
            if value not in self.choices:
                raise ValueError(f'{where} must be one of: {", ".join(map(str, self.choices))}.')
            return value
        if kind in ('text', 'selection'):
            if not isinstance(value, str) or len(value) > MAX_TEXT:
                raise ValueError(f'{where} must be text of at most {MAX_TEXT} characters.')
            value = value.strip()
            return value or (self.default if kind == 'selection' else value)
        if kind == 'lines':
            if not isinstance(value, list) or len(value) > 20 or any(not isinstance(v, str) or len(v) > MAX_TEXT for v in value):
                raise ValueError(f'{where} must be at most 20 lines of text.')
            return [v.strip() for v in value if v.strip()]
        if kind == 'atoms':
            if (not isinstance(value, list) or len(value) > 10 ** 6
                    or any(type(i) is not int or i < 0 for i in value) or len(set(value)) != len(value)):
                raise ValueError(f'{where} must list distinct atoms.')
            if not value and not self.optional:
                raise ValueError(f'{where} needs at least one atom.')
            return value or None
        if kind == 'groups':
            if (not isinstance(value, list) or len(value) > 5000
                    or any(not isinstance(g, list) or len(g) != self.width or any(type(i) is not int or i < 0 for i in g)
                           or len(set(g)) != len(g) for g in value)):
                raise ValueError(f'{where} must be groups of {self.width} distinct atoms.')
            return value
        raise ValueError(f'{where}: unsupported parameter type.')


# ── results ──────────────────────────────────────────────────────────────────
# What an analysis returns: a dict with a `kind` the interface knows how to show.
#   series  y against the analysed frames (x = frame indices); profile  y against any x;
#   matrix  a square map (e.g. frame × frame); table  rows only.
# Every kind may add `notes` (list of text) and a `table` shown under the plot.

def _series_list(y):
    items = y.items() if isinstance(y, dict) else y
    return [{'label': str(label), 'data': list(values)} for label, values in items]


def series(x, y, x_label='Frame', y_label='', notes=(), table=None, bars=False):
    """y: {label: values} (or [(label, values)]) along x, usually ctx.frames(...).frames."""
    return {'kind': 'series', 'x': list(x), 'xLabel': x_label, 'yLabel': y_label, 'series': _series_list(y),
            'notes': list(notes), 'table': table, 'bars': bool(bars)}


def profile(x, y, x_label, y_label, notes=(), table=None, bars=False, atoms=None):
    """A curve against any x (distance, lag, atom). With `atoms` (indices) x is shown as MONET IDs."""
    out = series(x, y, x_label, y_label, notes, table, bars)
    out['kind'] = 'profile'
    if atoms is not None:
        out['atoms'] = list(atoms)
    return out


def matrix(values, labels, x_label='Frame', y_label='Frame', color_label='', notes=(), table=None):
    return {'kind': 'matrix', 'matrix': [list(row) for row in values], 'labels': list(labels), 'xLabel': x_label,
            'yLabel': y_label, 'colorLabel': color_label, 'notes': list(notes), 'table': table}


def table(columns, rows, notes=(), atom_columns=()):
    """A table result. Columns listed in atom_columns hold atom indices, shown as MONET IDs."""
    return {'kind': 'table', 'table': {'columns': list(columns), 'rows': [list(r) for r in rows], 'atom_columns': list(atom_columns)},
            'notes': list(notes)}


def _plain(value):
    """JSON-ready copy: numpy arrays and scalars become lists and numbers, NaN and ±inf become None."""
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    if hasattr(value, 'tolist') and not isinstance(value, (str, bytes)):
        return _plain(value.tolist())
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if value is None or isinstance(value, (bool, int, str)):
        return value
    raise ValueError(f'The analysis returned a value that cannot be shown: {type(value).__name__}.')


def check_result(result, name):
    """Validated, JSON-ready result; ValueError with a message for the plugin author otherwise."""
    if not isinstance(result, dict):
        raise ValueError(f'Analysis {name} must return a dict (use series(), profile(), matrix() or table()).')
    result = _plain({k: v for k, v in result.items() if v is not None})
    kind = result.get('kind')
    if kind not in KINDS:
        raise ValueError(f'Analysis {name} returned kind {kind!r}; use one of {", ".join(KINDS)}.')
    if kind in ('series', 'profile'):
        x = result.get('x')
        entries = result.get('series')
        if not isinstance(x, list) or not isinstance(entries, list) or not entries:
            raise ValueError(f'Analysis {name}: a {kind} needs x and at least one series.')
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get('data'), list) or len(entry['data']) != len(x):
                raise ValueError(f'Analysis {name}: every series needs as many values as x ({len(x)}).')
    if kind == 'matrix':
        rows = result.get('matrix')
        if not isinstance(rows, list) or any(not isinstance(r, list) or len(r) != len(rows) for r in rows):
            raise ValueError(f'Analysis {name}: a matrix must be square.')
    table_ = result.get('table')
    if table_ is not None and (not isinstance(table_, dict) or not isinstance(table_.get('columns'), list)
                               or not isinstance(table_.get('rows'), list)):
        raise ValueError(f'Analysis {name}: a table needs columns and rows.')
    if kind == 'table' and table_ is None:
        raise ValueError(f'Analysis {name}: a table result needs a table.')
    return result


# ── context ──────────────────────────────────────────────────────────────────

@dataclass
class Frames:
    """Analysed frames: indices in the file, positions (F, n, 3) in Å, cells (F, 3, 3) or None, pbc."""
    frames: list
    positions: Any
    cells: Any
    pbc: Any


class Context:
    """What an analysis may use. Everything is loaded on first use and follows the MONET settings
    (frame step, crystal cell, periodic boundaries, minimum image, bond cutoff, atom IDs)."""

    def __init__(self, cmd, loader, progress):
        self._cmd = cmd
        self._loader = loader
        self._progress = progress
        self._atoms = None
        self._universe = None
        self.filename = cmd['filename']
        self.frame_step = cmd.get('frame_step', 1)
        self.mic = bool(cmd.get('mic', False))
        self.bond_scale = cmd.get('bond_scale', 1.2)
        # Time between two analysed frames in fs, or None when the time axis is not set.
        self.dt = cmd['dt'] * self.frame_step if cmd.get('dt') else None
        self.analysed_frames = None

    def progress(self, message, percent=None):
        """Status line and progress bar in the interface (percent 0–100)."""
        self._progress(message, percent)

    def frames(self, atoms=None, need_cell=False):
        """Positions of the analysed frames, for `atoms` (indices; None = all atoms)."""
        frames, positions, cells, pbc = self._loader.frame_data({**self._cmd}, atoms, need_cell=need_cell)
        self.analysed_frames = frames
        return Frames(frames, positions, cells, pbc)

    def atoms(self):
        """First frame as an ase.Atoms object, with the crystal cell and PBC settings applied."""
        if self._atoms is None:
            self._atoms = self._loader.first_atoms(self.filename, self._cmd)
        return self._atoms.copy()

    @property
    def symbols(self):
        return self.atoms().get_chemical_symbols()

    @property
    def natoms(self):
        return len(self.atoms())

    @property
    def atom_ids(self):
        """MONET ID of every atom of the analysed file (index i → ID), e.g. for labels in written files."""
        ids = self._cmd.get('atom_ids')
        if isinstance(ids, list) and len(ids) == self.natoms and all(type(i) is int for i in ids):
            return list(ids)
        return list(range(1, self.natoms + 1))

    def universe(self):
        """(frame indices, MDAnalysis Universe) of the analysed frames; atom ids are the MONET IDs."""
        if self._universe is None:
            self._universe = self._loader.universe(self._cmd)
            self.analysed_frames = self._universe[0]
        return self._universe

    def atom_properties(self):
        """Topology columns of an imported file ({'resname': […], 'resid': […], 'atomname': […]}), or {}."""
        return self._loader.atom_properties(self.filename)

    def output(self):
        """Path of the file this analysis writes (declared with output=…); MONET offers it for download."""
        path = self._cmd.get('output')
        if not path:
            raise ValueError('This analysis writes a file: choose where to save it.')
        return path


# ── analyses ─────────────────────────────────────────────────────────────────

@dataclass
class Analysis:
    id: str
    engine: str
    name: str
    label: str
    function: Callable
    description: str = ''
    category: str = ''
    params: tuple = ()
    requires: tuple = ()
    output: Optional[dict] = None
    citation: str = ''
    source: str = 'built-in'
    order: int = 0

    def missing(self):
        """Python modules this analysis needs that are not installed."""
        return [name for name in self.requires if importlib.util.find_spec(name) is None]

    def spec(self):
        missing = self.missing()
        return {'id': self.id, 'engine': self.engine, 'name': self.name, 'label': self.label,
                'description': self.description, 'category': self.category, 'params': [p.spec() for p in self.params],
                'output': self.output, 'citation': self.citation, 'source': self.source,
                'available': not missing, 'missing': missing}


REGISTRY = {}
ERRORS = []
_state = {'loaded': False, 'source': 'built-in', 'order': 0}


def analysis(name, engine, label, description='', params=(), category='', requires=(), output=None, citation=''):
    """Register the decorated function f(ctx, p) as analysis `<engine>.<name>`.

    p holds the checked parameter values; the function returns series(), profile(), matrix() or
    table(). output={'suffix': '.dx'} (plus 'trajectory': True for an extended XYZ that MONET can
    analyse next) declares a file written to ctx.output().
    """
    if engine not in ENGINES:
        raise ValueError(f'Engine must be one of {", ".join(ENGINES)}.')
    if not _NAME.match(name):
        raise ValueError(f'Analysis name {name!r} must be lower_case letters, digits and _.')
    names = [p.name for p in params]
    if len(set(names)) != len(names):
        raise ValueError(f'Analysis {name}: parameter names must be unique.')
    if output is not None and (not isinstance(output, dict) or not re.match(r'^[A-Za-z0-9_.-]{1,40}$', str(output.get('suffix', '')))):
        raise ValueError(f'Analysis {name}: output needs a file suffix such as {{"suffix": ".dx"}}.')

    def register(function):
        key = f'{engine}.{name}'
        if key in REGISTRY:
            raise ValueError(f'Analysis {key} is already defined by {REGISTRY[key].source}.')
        _state['order'] += 1
        REGISTRY[key] = Analysis(key, engine, name, label, function, description, category, tuple(params),
                                 tuple(ENGINE_REQUIRES[engine]) + tuple(requires), output, citation,
                                 _state['source'], _state['order'])
        return function
    return register


def plugin_folders():
    folders = [ROOT / 'plugins', Path.home() / '.monet' / 'plugins']
    folders += [Path(p).expanduser() for p in os.environ.get('MONET_PLUGINS', '').split(os.pathsep) if p.strip()]
    return folders


def _import(label, load):
    _state['source'] = label
    try:
        load()
    except Exception as error:  # a broken plugin is reported, never fatal
        ERRORS.append({'source': label, 'error': f'{type(error).__name__}: {error}'})
    finally:
        _state['source'] = 'built-in'


def _load_file(path):
    digest = hashlib.sha1(str(path.resolve()).encode()).hexdigest()[:10]
    module_name = f'monet_plugin_{re.sub(r"[^A-Za-z0-9_]", "_", path.stem)}_{digest}'
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)


def load():
    """Import built-in analyses and every plugin once per process."""
    if _state['loaded']:
        return
    _state['loaded'] = True
    for module in BUILTIN:
        _import('built-in', lambda module=module: importlib.import_module(module))
    seen = set()
    for folder in plugin_folders():
        files = [folder] if folder.is_file() else sorted(folder.glob('*.py')) if folder.is_dir() else []
        for path in files:
            if path.name.startswith('_') or path.resolve() in seen:
                continue
            seen.add(path.resolve())
            label = f'plugins/{path.name}' if path.parent == ROOT / 'plugins' else str(path)
            _import(label, lambda path=path: _load_file(path))
    try:
        from importlib.metadata import entry_points
        points = entry_points(group=ENTRY_POINT_GROUP)
    except Exception:
        points = []
    for point in points:
        _import(f'package {point.value}', point.load)


def specs():
    load()
    return {'analyses': [a.spec() for a in sorted(REGISTRY.values(), key=lambda a: a.order)],
            'errors': list(ERRORS), 'engines': ENGINES, 'folders': [str(f) for f in plugin_folders()]}


def get(analysis_id):
    load()
    entry = REGISTRY.get(analysis_id)
    if entry is None:
        raise ValueError(f'Unknown analysis {analysis_id!r}.')
    missing = entry.missing()
    if missing:
        raise ValueError(f'{entry.label} needs {", ".join(missing)}: python -m pip install {" ".join(missing)}')
    return entry


def check_params(entry, raw):
    """Checked parameter values (defaults filled in); unknown names are refused."""
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError('Analysis parameters must be an object.')
    known = {p.name: p for p in entry.params}
    unknown = sorted(set(raw) - set(known))
    if unknown:
        raise ValueError(f'{entry.label} has no parameter {", ".join(unknown)}.')
    return {name: param.coerce(raw.get(name)) for name, param in known.items()}


def run(analysis_id, ctx, raw_params):
    """Run one analysis; returns its checked result plus the analysed frames when known."""
    entry = get(analysis_id)
    params = check_params(entry, raw_params)
    natoms = None
    for param in entry.params:
        value = params[param.name]
        if param.type in ('atoms', 'groups') and value:
            natoms = natoms or ctx.natoms
            flat = value if param.type == 'atoms' else [i for group in value for i in group]
            if max(flat) >= natoms:
                raise ValueError(f'“{param.label}”: atom {max(flat) + 1} is outside the {natoms} atoms of the trajectory.')
    if entry.output and not ctx._cmd.get('output'):
        raise ValueError(f'{entry.label} writes a file: choose where to save it.')
    result = check_result(entry.function(ctx, params), entry.id)
    if ctx.analysed_frames is not None:
        result.setdefault('frame_indices', list(ctx.analysed_frames))
        result.setdefault('n_frames', len(ctx.analysed_frames))
    if entry.output:
        result['output_file'] = True
        result['trajectory'] = bool(entry.output.get('trajectory'))
    return result

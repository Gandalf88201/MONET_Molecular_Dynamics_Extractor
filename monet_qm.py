"""
Render per-configuration quantum-chemistry inputs from the per-code spec built
by qm-resolve.js (code-level [[slots]] already filled in the browser; only the
per-configuration {placeholders} are left). The output must match qm-inputs.js
byte for byte; tests/qm-parity.cjs checks this.

Numbers use '%.Nf' formatting. It differs from JavaScript's toFixed only for
values lying exactly halfway between two decimals (dyadic rationals), where the
last digit may differ by one unit.
"""
import math
import os
import re

BOHR = 0.529177210903
STATES = {1: ('sing', 's0', 'singlet'), 2: ('doub', 'd0', 'doublet'), 3: ('trip', 't0', 'triplet'),
          4: ('quar', 'q0', 'quartet'), 5: ('quin', 'p0', 'quintet')}
_PLACEHOLDER = re.compile(r'\{(\w+)\}')
_STATE_KEYS = re.compile(r'\{(tag|mult|state|chk)\}')
_FILE_NAME = re.compile(r'^[A-Za-z0-9_.{}-]+$')
FOLDERS = {'gaussian': '', 'orca': 'orca', 'qbox': 'qbox', 'qe': 'qe', 'vasp': 'vasp', 'cp2k': 'cp2k'}
LABELS = {'gaussian': 'Gaussian', 'orca': 'ORCA', 'qbox': 'Qbox', 'qe': 'Quantum ESPRESSO (pw.x)', 'vasp': 'VASP', 'cp2k': 'CP2K'}
PLANE_WAVE = ('qe', 'vasp', 'cp2k', 'qbox')
_SAFE = re.compile(r'^[A-Za-z0-9_.+()-]+$')
_ELEMENT = re.compile(r'^[A-Z][a-z]?$')
_DEFAULTS = (('override', None), ('isolated', None), ('species', {}), ('reference', 'u'), ('brokenSymmetry', False), ('potcar', None))


def _num(value):
    """String(value) of JavaScript for the numbers used here."""
    value = float(value)
    if value.is_integer():
        return str(int(value))
    return repr(value)


def _fixed(value, digits):
    return f'{value + 0.0:.{digits}f}'


def _memory_mb(text):
    match = re.match(r'^\s*(\d+(?:\.\d+)?)\s*(gb|mb|g|m)?\s*$', str(text), re.I)
    if not match:
        return 4000
    return float(match.group(1)) * (1000 if (match.group(2) or 'gb').lower().startswith('g') else 1)


def state_of(mult):
    tag, chk, state = STATES.get(mult, (f'mult{mult}', f'm{mult}', f'multiplicity-{mult}'))
    return {'tag': tag, 'chk': f'{chk}.chk', 'state': state}


def normalize(spec):
    """Legacy specs ({params}) -> {common, legacy}; missing per-code fields get their defaults."""
    if not isinstance(spec, dict):
        return spec
    if isinstance(spec.get('params'), dict) and 'common' not in spec:
        p = spec['params']
        spec['common'] = {'charge': p.get('charge'), 'multiplicities': p.get('multiplicities')}
        spec['legacy'] = {k: p.get(k) for k in ('nproc', 'mem', 'method', 'basis', 'padding')}
    codes = spec.get('codes')
    for entry in (codes.values() if isinstance(codes, dict) else []):
        if not isinstance(entry, dict):
            continue
        for key, value in _DEFAULTS:
            entry.setdefault(key, {} if isinstance(value, dict) else value)
    return spec


def _check_states(states, where):
    mults = states.get('multiplicities') if isinstance(states, dict) else None
    if (not isinstance(mults, list) or not mults or len(set(mults)) != len(mults)
            or any(type(m) is not int or not 1 <= m <= 11 for m in mults)):
        raise ValueError(f'{where}Enter distinct spin multiplicities between 1 and 11, e.g. "1 3".')
    if type(states.get('charge')) is not int or abs(states['charge']) > 50:
        raise ValueError(f'{where}Charge must be an integer.')


def _truthy(value):
    """JavaScript truthiness: objects and arrays are true even when empty."""
    return isinstance(value, (dict, list)) or bool(value)


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _js_string(value):
    """String(value) of JavaScript for the scalars checked here."""
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if type(value) in (int, float):
        return _num(value) if math.isfinite(value) else 'NaN'
    return str(value)


def _mass_ok(value):
    if not (isinstance(value, str) or _finite(value)):
        return False
    return re.match(r'^[0-9.]+$', _js_string(value)) is not None


def _finite_non_negative(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def validate(spec):
    if not isinstance(spec, dict) or not isinstance(spec.get('codes'), dict):
        raise ValueError('Invalid quantum-chemistry input settings.')
    normalize(spec)
    _check_states(spec.get('common'), '')
    legacy = spec.get('legacy')
    if _truthy(legacy):
        if type(legacy.get('nproc')) is not int or legacy['nproc'] < 1:
            raise ValueError('Processors must be a positive integer.')
        if not _finite_non_negative(legacy.get('padding')):
            raise ValueError('Vacuum padding must be zero or positive.')
        if any(re.search(r'[/\\\r\n]', _js_string(legacy.get(key))) for key in ('method', 'basis', 'mem')):
            raise ValueError('Method, basis and memory must not contain slashes or line breaks.')
    masses = spec.get('masses')
    if masses is not None and not (isinstance(masses, dict) and all(_mass_ok(m) for m in masses.values())):
        raise ValueError('Invalid atomic masses.')
    for code, entry in spec['codes'].items():
        if code not in FOLDERS:
            raise ValueError(f'Unknown input code {code}.')
        if not isinstance(entry, dict) or not isinstance(entry.get('files'), list):
            raise ValueError('Invalid quantum-chemistry input settings.')
        label = f'{LABELS[code]}: '
        if _truthy(entry.get('override')):
            _check_states(entry['override'], label)
        iso = entry.get('isolated')
        if _truthy(iso) and not (isinstance(iso, dict) and _finite_non_negative(iso.get('padding'))):
            raise ValueError(f'{label}Vacuum padding must be zero or positive.')
        if entry.get('reference') not in ('u', 'auto', 'r'):
            raise ValueError(f"{label}Unknown reference {entry.get('reference')}.")
        species = entry.get('species')
        if not isinstance(species, dict):
            raise ValueError(f'{label}Invalid pseudopotential table.')
        for el, value in species.items():
            # CP2K: {basis, potential, aux?}; other codes: one file name / variant per element.
            if code == 'cp2k':
                parts = [value.get('basis'), value.get('potential')] + ([value['aux']] if value.get('aux') else []) if isinstance(value, dict) else [None]
            else:
                parts = [value]
            if not _ELEMENT.match(str(el)) or any(not isinstance(part, str) or not _SAFE.match(part) for part in parts):
                raise ValueError(f'{label}Invalid pseudopotential entry for {el}.')
        potcar = entry.get('potcar')
        if _truthy(potcar) and not (isinstance(potcar, dict) and isinstance(potcar.get('library'), str) and potcar['library']):
            raise ValueError(f'{label}Choose the POTCAR library folder.')
        for item in entry['files']:
            if (not isinstance(item, dict) or not isinstance(item.get('name'), str) or not _FILE_NAME.match(item['name'])
                    or not isinstance(item.get('template'), str)):
                raise ValueError(f"Invalid file name pattern {item.get('name') if isinstance(item, dict) else None}.")
    cell = spec.get('cell')
    if cell is not None and (not isinstance(cell, list) or len(cell) != 3 or any(not isinstance(row, list) or len(row) != 3 or not all(_finite(v) for v in row) for row in cell)):
        raise ValueError('Cell must be a 3x3 matrix.')
    summary = spec.get('summary')
    if summary is not None and not (isinstance(summary, dict) and all(isinstance(text, str) for text in summary.values())):
        raise ValueError('Invalid quantum-chemistry input summary.')
    return spec


def _cell(code, entry, conf, spec):
    """Cell rows (Å), shifted positions and note for one code and configuration."""
    positions = [[float(v) for v in p] for p in conf['positions']]

    def box(padding):
        rows, shift = [], []
        for axis in range(3):
            values = [p[axis] for p in positions]
            low, high = min(values), max(values)
            side = max(high - low + padding, 1)
            row = [0.0, 0.0, 0.0]
            row[axis] = side
            rows.append(row)
            shift.append(side / 2 - (low + high) / 2)
        moved = [[v + shift[k] for k, v in enumerate(p)] for p in positions]
        return rows, moved, f'Cell: vacuum box = extent + {_num(padding)} A, configuration centred (isolated system).'
    if _truthy(entry.get('isolated')):
        return box(float(entry['isolated']['padding']))
    if _truthy(spec.get('cell')):
        return [[float(v) for v in r] for r in spec['cell']], positions, 'Cell: applied manual cell.'
    if conf.get('lattice') is not None:
        return [[float(v) for v in r] for r in conf['lattice']], positions, 'Cell: from the trajectory.'
    if _truthy(spec.get('legacy')) and code in PLANE_WAVE:
        # Legacy specs ({params}): plane-wave codes only, box not centred, old note (output as before).
        pad = float(spec['legacy']['padding'])
        rows = []
        for axis in range(3):
            values = [p[axis] for p in positions]
            row = [0.0, 0.0, 0.0]
            row[axis] = max(max(values) - min(values) + pad, 1)
            rows.append(row)
        return rows, positions, f'Cell: orthorhombic box = extent + {_num(pad)} A padding (no cell in the trajectory).'
    if code in PLANE_WAVE:
        raise ValueError(f"{LABELS[code]}: no cell for configuration {_num(conf['index'])}. Apply a crystal cell or tick “Isolated system: vacuum box”.")
    return None, positions, 'No cell (isolated cluster).'


def _hf_cutoff(rows):
    """CP2K truncation radius from the perpendicular widths (same arithmetic as qm-inputs.js); '' for a degenerate cell."""
    a, b, c = rows

    def cross(u, v):
        return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]

    def norm(v):
        return math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    bc, ca, ab = cross(b, c), cross(c, a), cross(a, b)
    volume = abs(a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2])
    norms = [norm(bc), norm(ca), norm(ab)]
    if not (math.isfinite(volume) and volume > 0) or any(not (math.isfinite(n) and n > 0) for n in norms):
        return ''
    return _fixed(min(6, min(volume / n for n in norms) / 2 - 0.1), 4)


def _kind(value):
    return value if isinstance(value, dict) else {}


def _context(code, entry, conf, spec, states, mult, runtime):
    symbols = conf['symbols']
    species = list(dict.fromkeys(symbols))
    rows, positions, note = _cell(code, entry, conf, spec)
    unpaired = mult - 1
    table = entry.get('species') or {}

    def name(s, fallback):
        value = table.get(s)
        return value if isinstance(value, str) and value else fallback
    masses = spec.get('masses') or {}
    counts = [symbols.count(s) for s in species]
    order = [i for s in species for i, x in enumerate(symbols) if x == s]
    seen = {}
    qbox_atoms = []
    for s, pos in zip(symbols, positions):
        seen[s] = seen.get(s, 0) + 1
        qbox_atoms.append(f'atom {s}{seen[s]} {s.lower()} ' + ' '.join(_fixed(v / BOHR, 8) for v in pos))
    # u: unrestricted always; auto: restricted singlet, unrestricted otherwise; r: restricted / restricted open-shell.
    reference = entry.get('reference')
    ref = 'u' if reference == 'u' else 'r' if mult == 1 else 'u' if reference == 'auto' else 'ro'
    ks = {'u': 'UKS', 'r': 'RKS', 'ro': 'ROKS'}[ref]
    charge = states['charge']
    nelect = f'# Net charge {_num(charge)}: set NELECT = (sum of ZVAL in POTCAR) - ({_num(charge)}) for charged systems.'
    potcar = runtime.get('potcar') if runtime and code == 'vasp' else None
    if _truthy(potcar):
        zval = potcar.get('zval') or {}
        for s in species:
            if not _finite(zval.get(s)):
                raise ValueError(f'VASP: no ZVAL for {s} in the POTCAR.')
        total = 0
        for s, n in zip(species, counts):
            total = total + zval[s] * n
        total = total - charge
        nelect = f'NELECT = {_num(total)}' if charge else '# NELECT: neutral system, taken from POTCAR'
    kinds = []
    for s in species:
        kind = _kind(table.get(s))
        aux = f"      BASIS_SET AUX_FIT {kind['aux']}\n" if kind.get('aux') else ''
        kinds.append(f"    &KIND {s}\n      BASIS_SET {kind.get('basis') or 'DZVP-MOLOPT-SR-GTH'}\n{aux}"
                     f"      POTENTIAL {kind.get('potential') or 'GTH-PBE'}\n    &END KIND")
    values = dict(state_of(mult))
    values.update({
        'index': _num(conf['index']), 'frame': _num(conf['frame']), 'charge': _num(charge), 'mult': _num(mult),
        'coords': ''.join(f'{s}  {_fixed(x, 7)}  {_fixed(y, 7)}  {_fixed(z, 7)}\n' for s, (x, y, z) in zip(symbols, positions)),
        'nat': _num(len(symbols)), 'ntyp': _num(len(species)),
        'nspin': '2' if unpaired else '1', 'unpaired': _num(unpaired), 'delta_spin': _num(unpaired / 2),
        'uks': '.TRUE.' if unpaired else '.FALSE.',
        'ref': ref, 'ks': ks, 'guess': ' guess=mix' if _truthy(entry.get('brokenSymmetry')) and mult == 1 else '',
        'cell_note': note,
        'cell_ang': '\n'.join('  '.join(_fixed(v, 10) for v in row) for row in rows) if rows else '',
        'qbox_cell': ' '.join(_fixed(v / BOHR, 8) for row in rows for v in row) if rows else '',
        'qbox_species': '\n'.join(f"species {s.lower()} {name(s, f'{s}_ONCV_PBE-1.0.xml')}" for s in species),
        'qbox_atoms': '\n'.join(qbox_atoms),
        'qe_species': '\n'.join(f"  {s} {_js_string(masses[s]) if _truthy(masses.get(s)) else '1.0'} {name(s, f'{s}.UPF')}" for s in species),
        'qe_magnetization': f'  tot_magnetization = {unpaired}\n' if unpaired else '',
        'vasp_species': ' '.join(species),
        'vasp_counts': ' '.join(str(n) for n in counts),
        'vasp_coords': '\n'.join('  '.join(_fixed(v, 10) for v in positions[i]) for i in order),
        'vasp_potcar_spec': '\n'.join(name(s, s) for s in species),
        'vasp_nelect': nelect,
        'cp2k_cell': '\n'.join(f"      {axis} {' '.join(_fixed(v, 10) for v in rows[k])}" for k, axis in enumerate('ABC')) if rows else '',
        'cp2k_kinds': '\n'.join(kinds),
        'cp2k_hf_cutoff': _hf_cutoff(rows) if rows else '',
    })
    legacy = spec.get('legacy')
    if _truthy(legacy):
        values.update({
            'nproc': _num(legacy['nproc']), 'mem': str(legacy['mem']), 'method': str(legacy['method']), 'basis': str(legacy['basis']),
            'maxcore': _num(math.floor(_memory_mb(legacy['mem']) / max(1, int(legacy['nproc'])))),
        })
    return values


def _fill(text, values):
    return _PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)), text)


def render(spec, conf, runtime=None):
    """Return [(relative_path, text)] for one configuration.

    runtime = {'potcar': {'text': ..., 'zval': {El: number}}} adds vasp/POTCAR and the exact NELECT.
    """
    normalize(spec)
    out = []
    for code, entry in spec['codes'].items():
        states = entry['override'] if _truthy(entry.get('override')) else spec['common']
        folder = FOLDERS[code]
        for item in entry['files']:
            per_state = bool(_STATE_KEYS.search(item['name']))
            for mult in states['multiplicities'] if per_state else states['multiplicities'][:1]:
                values = _context(code, entry, conf, spec, states, mult, runtime)
                name = _fill(item['name'], values)
                if '/' in name or name in ('', '.', '..'):
                    raise ValueError(f'Invalid output file name {name}.')
                out.append((f'{folder}/{name}' if folder else name, _fill(item['template'], values)))
        if code == 'vasp' and runtime and _truthy(runtime.get('potcar')):
            out.append(('vasp/POTCAR', runtime['potcar']['text']))
    return out


def writer(spec):
    """Callback for monet_io.extract: writes the inputs of one configuration."""
    validate(spec)

    def write(folder, index, frame, symbols, positions, lattice=None):
        conf = {'index': index, 'frame': frame, 'symbols': symbols, 'positions': positions.tolist(), 'lattice': lattice}
        for path, text in render(spec, conf):
            target = os.path.join(folder, path)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, 'w', newline='') as fh:
                fh.write(text)
    return write

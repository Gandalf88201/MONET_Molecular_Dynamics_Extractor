"""
Render per-configuration quantum-chemistry inputs from the template spec built
by qm-inputs.js (the single source of the default templates). The output must
match qm-inputs.js byte for byte; tests/qm-parity.cjs checks this.

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


def _cell(conf, spec):
    lattice = spec.get('cell') or conf.get('lattice')
    if lattice is not None:
        note = 'Cell: applied manual cell.' if spec.get('cell') else 'Cell: from the trajectory.'
        return [list(map(float, row)) for row in lattice], note
    pad = float(spec['params']['padding'])
    rows = []
    for axis in range(3):
        values = [p[axis] for p in conf['positions']]
        row = [0.0, 0.0, 0.0]
        row[axis] = max(max(values) - min(values) + pad, 1)
        rows.append(row)
    return rows, f'Cell: orthorhombic box = extent + {_num(pad)} A padding (no cell in the trajectory).'


def _context(conf, spec, mult):
    p = spec['params']
    symbols = conf['symbols']
    positions = conf['positions']
    species = list(dict.fromkeys(symbols))
    rows, note = _cell(conf, spec)
    unpaired = mult - 1
    seen = {}
    qbox_atoms = []
    for s, pos in zip(symbols, positions):
        seen[s] = seen.get(s, 0) + 1
        qbox_atoms.append(f'atom {s}{seen[s]} {s.lower()} ' + ' '.join(_fixed(v / BOHR, 8) for v in pos))
    order = [i for s in species for i, x in enumerate(symbols) if x == s]
    masses = spec.get('masses') or {}
    values = dict(state_of(mult))
    values.update({
        'index': _num(conf['index']), 'frame': _num(conf['frame']), 'charge': _num(p['charge']), 'mult': _num(mult),
        'nproc': _num(p['nproc']), 'mem': str(p['mem']), 'method': str(p['method']), 'basis': str(p['basis']),
        'maxcore': _num(math.floor(_memory_mb(p['mem']) / max(1, int(p['nproc'])))),
        'coords': ''.join(f'{s}  {_fixed(x, 7)}  {_fixed(y, 7)}  {_fixed(z, 7)}\n' for s, (x, y, z) in zip(symbols, positions)),
        'nat': _num(len(symbols)), 'ntyp': _num(len(species)),
        'nspin': '2' if unpaired else '1', 'unpaired': _num(unpaired), 'delta_spin': _num(unpaired / 2),
        'uks': '.TRUE.' if unpaired else '.FALSE.',
        'cell_note': note,
        'cell_ang': '\n'.join('  '.join(_fixed(v, 10) for v in row) for row in rows),
        'qbox_cell': ' '.join(_fixed(v / BOHR, 8) for row in rows for v in row),
        'qbox_species': '\n'.join(f'species {s.lower()} {s}_ONCV_PBE-1.0.xml' for s in species),
        'qbox_atoms': '\n'.join(qbox_atoms),
        'qe_species': '\n'.join(f"  {s} {masses.get(s, '1.0')} {s}.UPF" for s in species),
        'qe_magnetization': f'  tot_magnetization = {unpaired}\n' if unpaired else '',
        'vasp_species': ' '.join(species),
        'vasp_counts': ' '.join(str(symbols.count(s)) for s in species),
        'vasp_coords': '\n'.join('  '.join(_fixed(v, 10) for v in positions[i]) for i in order),
        'cp2k_cell': '\n'.join(f"      {axis} {' '.join(_fixed(v, 10) for v in rows[k])}" for k, axis in enumerate('ABC')),
        'cp2k_kinds': '\n'.join(f'    &KIND {s}\n      BASIS_SET DZVP-MOLOPT-SR-GTH\n      POTENTIAL GTH-PBE\n    &END KIND' for s in species),
    })
    return values


def _fill(text, values):
    return _PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)), text)


def validate(spec):
    if not isinstance(spec, dict) or not isinstance(spec.get('codes'), dict) or not isinstance(spec.get('params'), dict):
        raise ValueError('Invalid quantum-chemistry input settings.')
    p = spec['params']
    mults = p.get('multiplicities')
    if (not isinstance(mults, list) or not mults or len(set(mults)) != len(mults)
            or any(type(m) is not int or not 1 <= m <= 11 for m in mults)):
        raise ValueError('Enter distinct spin multiplicities between 1 and 11, e.g. "1 3".')
    if type(p.get('charge')) is not int or abs(p['charge']) > 50:
        raise ValueError('Charge must be an integer.')
    if type(p.get('nproc')) is not int or p['nproc'] < 1:
        raise ValueError('Processors must be a positive integer.')
    if type(p.get('padding')) not in (int, float) or not math.isfinite(p['padding']) or p['padding'] < 0:
        raise ValueError('Vacuum padding must be zero or positive.')
    for code, entry in spec['codes'].items():
        if code not in FOLDERS:
            raise ValueError(f'Unknown input code {code}.')
        # The folder is fixed per code; client-supplied folders are ignored.
        for item in entry.get('files', []):
            if not isinstance(item.get('name'), str) or not _FILE_NAME.match(item['name']) or not isinstance(item.get('template'), str):
                raise ValueError(f"Invalid file name pattern {item.get('name')}.")
    cell = spec.get('cell')
    if cell is not None and (not isinstance(cell, list) or len(cell) != 3 or any(len(row) != 3 for row in cell)):
        raise ValueError('Cell must be a 3x3 matrix.')
    return spec


def render(spec, conf):
    """Return [(relative_path, text)] for one configuration."""
    out = []
    for code, entry in spec['codes'].items():
        folder = FOLDERS[code]
        for item in entry['files']:
            per_state = bool(_STATE_KEYS.search(item['name']))
            for mult in spec['params']['multiplicities'] if per_state else spec['params']['multiplicities'][:1]:
                values = _context(conf, spec, mult)
                name = _fill(item['name'], values)
                if '/' in name or name in ('', '.', '..'):
                    raise ValueError(f'Invalid output file name {name}.')
                out.append((f'{folder}/{name}' if folder else name, _fill(item['template'], values)))
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

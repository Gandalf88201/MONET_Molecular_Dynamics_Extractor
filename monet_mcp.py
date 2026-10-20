"""MONET MCP server: MONET's analyses as tools for AI assistants (Claude Desktop, Claude Code, Gemini CLI).

    pip install "mcp>=1.2"                     # optional: only needed for this server
    python3 monet_mcp.py --output ~/MONET-mcp  # stdio; the AI client starts it (see docs/mcp.md)

The server runs MONET's Python engine (ase_bridge.py, one persistent worker) directly on trajectory files,
without the interface. Atoms are MONET IDs (1…N in file order), as in the console. Trajectories are read
only below the --data folders (default: your home folder); results and derived files are written only
into the --output folder. Full results are saved as JSON there; the tools return compact summaries
(long arrays become count, mean, SD, min, max) and get_result_data returns any part in full.
"""
import argparse
import asyncio
import functools
import itertools
import json
import math
import os
from pathlib import Path
import re
import sys
import time

try:  # mcp 2.x
    from mcp.server.mcpserver import Context, MCPServer
    from mcp.server.mcpserver.exceptions import ToolError
except ImportError:  # mcp 1.x
    try:
        from mcp.server.fastmcp import Context, FastMCP as MCPServer
        from mcp.server.fastmcp.exceptions import ToolError
    except ImportError:
        sys.exit('The MONET MCP server needs the MCP Python SDK: pip install "mcp>=1.2" (Python 3.10 or newer).')

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from monet_replay import ATOM_KEYS, NEEDS_IDS, Source, _to_indices  # noqa: E402

# Built-in analyses: the console set (console.js), with what each parameter means. Atoms are MONET IDs.
BUILTIN = {
    'rmsd': ('RMSD of every analysed frame against a reference frame (Å).',
             {'indices': 'atoms (omit = all)', 'align': 'Kabsch alignment first (default false)',
              'unwrap': 'unwrap periodic images first', 'reference_index': 'reference frame index (default: first)'}),
    'rmsd_matrix': ('Pairwise RMSD between frames (Å), for clustering and recurrence.',
                    {'indices': 'atoms (omit = all)', 'align': 'Kabsch alignment (default true)',
                     'max_frames': 'frame limit, at most 3000 (default 1000)', 'unwrap': 'unwrap periodic images first'}),
    'pdd': ('Histogram of pair distances among the chosen atoms (raw counts).',
            {'indices': 'at least 2 atoms (omit = all)', 'elements': '["O"] like pairs or ["O", "H"] an exact pair',
             'rmax': 'maximum distance, Å', 'nbins': 'bins (default 80)'}),
    'rdf': ('Radial distribution function g(r) and running coordination number; needs a complete periodic cell.',
            {'indices': 'atoms (omit = all)', 'elements': '["O"] or ["O", "H"]', 'rmax': 'Å, at most half the cell width',
             'nbins': 'bins (default 200)'}),
    'bonds': ('Bond lengths along the trajectory (Å).', {'pairs': '[[id, id], …]'}),
    'angles': ('Bond angles along the trajectory (°).',
               {'triplets': '[[id, centre id, id], …]', 'angle_range': 'natural | 360 | signed90 | fold180',
                'angle_normal': '[x, y, z] reference normal, needed with angle_range 360'}),
    'dihedrals': ('Dihedral angles along the trajectory (°, ASE 0–360 convention).',
                  {'quads': '[[id, id, id, id], …]', 'angle_range': 'natural | signed90 | fold180'}),
    'msd': ('Mean-square displacement and diffusion coefficient D (cm²/s); needs the time step.',
            {'indices': 'atoms (omit = all)', 'remove_drift': 'remove the centre-of-mass drift (default true)',
             'fit_start': 'fit window start, fs (default 10 % of the run)', 'fit_end': 'fit window end, fs (default 50 %)'}),
    'vdos': ('Vibrational density of states from the velocity autocorrelation (cm⁻¹); needs the time step.',
             {'indices': 'atoms (omit = all)', 'mass_weighted': 'default true', 'smooth_cm': 'Gaussian smoothing, cm⁻¹ (0–1000)',
              'max_cm': 'upper frequency, cm⁻¹ (default 4000)'}),
    'acf': ('Autocorrelation of bonds, angles, dihedrals or RMSD: decorrelation time (τ fit and τ_int) and the '
            'stride between uncorrelated configurations; needs the time step.',
            {'quantity': 'bond | angle | dihedral | rmsd', 'groups': '[[ids…], …] of 2, 3 or 4 atoms (one group of any size for rmsd)',
             'mode': 'linear | circular', 'fit_until': 'zero | efold | all', 'fit_model': 'exp | exp_offset',
             'tau_int_method': 'sokal | geyer | zero', 'angle_range': '360 | fold180 (dihedrals)', 'max_lag': 'frames'}),
    'equilibration': ('Equilibration time t0 that maximises the effective number of uncorrelated samples (Chodera); '
                      'needs the time step.',
                      {'quantity': 'bond | angle | dihedral | rmsd', 'groups': 'as in acf', 'mode': 'linear | circular',
                       'fit_until': 'zero | efold | all', 'fit_model': 'exp | exp_offset', 'tau_int_method': 'sokal | geyer | zero',
                       'angle_range': '360 | fold180 (dihedrals)', 'max_lag': 'frames'}),
    'fluctuations': ('Per-item statistics of atoms, bonds, angles or dihedrals: mean, SD/RMSF, range, trend with its error '
                     'and significance, drift, block SEM, dominant frequency; atoms also give the displacement tensor u '
                     '(U11 U22 U33 U12 U13 U23, Å², first-frame axes).',
                     {'quantity': 'atoms | bonds | angles | dihedrals', 'indices': 'atoms to search (omit = all)',
                      'groups': 'explicit items instead of the automatic search', 'align': 'atoms: remove global translation and rotation (default true)'}),
    'ase_structure': ('Structure of one frame: formula, masses, centre of mass, inertia, cell, density, shortest distances, '
                      'molecules, bonds per element pair, coordination, space group.',
                      {'frame': 'frame index (default 0)', 'symprec': 'symmetry tolerance, Å (default 0.001)'}),
    'ase_coordination': ('Coordination numbers along the trajectory (bond cutoff × covalent radii).', {'indices': 'atoms (omit = all)'}),
}
NEEDS_DT = ('msd', 'vdos', 'acf', 'equilibration')
DERIVE = {
    'unwrap': ('Unwrap periodic images (continuous trajectories); needs a cell.', {}),
    'wrap': ('Wrap atoms or whole molecules into the cell.', {'mode': 'molecules | atoms', 'center': 'atoms to centre (MONET IDs)'}),
    'subsample': ('Keep every stride-th frame from start (e.g. the decorrelation stride of acf), or explicit frames.',
                  {'stride': 'positive integer', 'start': 'first frame (default 0)', 'frames': 'explicit frame indices instead'}),
}
SUMMARY_LIST = 24   # longer numeric lists are summarised
TABLE_ROWS = 40     # table rows returned inline


class Bridge:
    """One persistent ase_bridge.py worker (--serve); commands run one at a time."""

    def __init__(self):
        self.process = None
        self.lock = asyncio.Lock()

    async def _start(self):
        if self.process is None or self.process.returncode is not None:
            self.process = await asyncio.create_subprocess_exec(
                sys.executable, str(ROOT / 'ase_bridge.py'), '--serve', stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, limit=1 << 30)

    async def stop(self):
        if self.process and self.process.returncode is None:
            self.process.kill()
            await self.process.wait()
        self.process = None

    async def run(self, command, progress=None):
        async with self.lock:
            await self._start()
            result = None
            try:
                self.process.stdin.write((json.dumps(command) + '\n').encode())
                await self.process.stdin.drain()
                while True:
                    line = await self.process.stdout.readline()
                    if not line:
                        await self.stop()
                        return result or {'ok': False, 'message': 'The MONET worker stopped unexpectedly.'}
                    try:
                        message = json.loads(line)
                    except ValueError:
                        continue
                    kind = message.get('type')
                    if kind == 'end':
                        return result or {'ok': False, 'message': 'The MONET worker returned no result.'}
                    if kind in ('result', 'error'):
                        result = message
                    elif kind == 'progress' and progress:
                        await progress(message.get('percent'), message.get('message'))
            except BaseException:
                # Cancelled or failed mid-command: the worker may still be busy, so start a fresh one next time.
                await self.stop()
                raise


class State:
    def __init__(self, output, data_roots):
        self.output = Path(output).expanduser().resolve()
        self.roots = [Path(r).expanduser().resolve() for r in data_roots]
        for sub in ('results', 'files', 'derived', 'imports'):
            (self.output / sub).mkdir(parents=True, exist_ok=True)
        self.trajectories = {}
        self.results = {}
        self.counter = itertools.count(1)
        self.bridge = Bridge()

    def readable(self, path):
        resolved = Path(path).expanduser().resolve()
        if not any(resolved == root or root in resolved.parents for root in self.roots + [self.output]):
            raise ValueError(f'{resolved} is outside the folders MONET may read ({", ".join(map(str, self.roots))}); '
                             'start the server with --data for that folder.')
        if not resolved.is_file():
            raise ValueError(f'{resolved} is not a file.')
        return resolved

    def trajectory(self, handle):
        if handle not in self.trajectories:
            known = ', '.join(self.trajectories) or 'none — call open_trajectory first'
            raise ValueError(f'Unknown trajectory {handle!r} (open: {known}).')
        return self.trajectories[handle]


STATE = None


def _progress(ctx):
    async def report(percent, message):
        try:
            await ctx.report_progress(float(percent or 0), 100.0, message)
        except Exception:
            pass  # a client without progress support must not break the analysis
    return report if ctx is not None else None


def _numbers(values):
    return isinstance(values, list) and len(values) > 0 and all(v is None or (isinstance(v, (int, float)) and not isinstance(v, bool)) for v in values)


def _compact(value, key=''):
    """Summary of a result: long numeric arrays and big tables are shortened, the rest is kept."""
    if isinstance(value, dict):
        if isinstance(value.get('rows'), list):
            # Tables are read row by row: keep them as they are, only shortened.
            out = {k: _compact(v, k) for k, v in value.items() if k != 'rows'}
            out['rows'] = value['rows'][:TABLE_ROWS]
            if len(value['rows']) > TABLE_ROWS:
                out['rows_note'] = f'first {TABLE_ROWS} of {len(value["rows"])} rows; get_result_data returns all'
            return out
        return {k: _compact(v, k) for k, v in value.items()}
    if _numbers(value) and len(value) > SUMMARY_LIST:
        finite = [v for v in value if v is not None and math.isfinite(v)]
        if not finite:
            return {'count': len(value), 'finite': 0}
        mean = sum(finite) / len(finite)
        sd = math.sqrt(sum((v - mean) ** 2 for v in finite) / max(len(finite) - 1, 1))
        return {'count': len(value), 'mean': mean, 'sd': sd, 'min': min(finite), 'max': max(finite),
                'first': value[0], 'last': value[-1], 'note': 'summarised; get_result_data returns the values'}
    if isinstance(value, list) and value and all(_numbers(v) for v in value) and len(value) * len(value[0]) > SUMMARY_LIST:
        flat = [x for row in value for x in row if x is not None and math.isfinite(x)]
        return {'shape': [len(value), len(value[0])], 'min': min(flat, default=None), 'max': max(flat, default=None),
                'note': 'matrix summarised; get_result_data returns the values'}
    if isinstance(value, list):
        return [_compact(v, key) for v in value[:200]] + ([f'… {len(value) - 200} more'] if len(value) > 200 else [])
    return value


def _with_ids(result, source):
    """Atom indices in a result (tables marked by atom_columns, 'atoms', 'indices', 'items') → MONET IDs."""
    ids = source.ids()
    to_id = lambda i: ids[i] if isinstance(i, int) and 0 <= i < len(ids) else i  # noqa: E731
    walk = lambda v: [walk(x) for x in v] if isinstance(v, list) else to_id(v)  # noqa: E731
    if isinstance(result.get('atoms'), list) and result.get('x') == result['atoms']:
        result['x'] = walk(result['x'])  # profiles against atoms: the x axis is the atoms too
    for key in ('atoms', 'indices', 'items', 'groups'):
        if isinstance(result.get(key), list):
            result[key] = walk(result[key])
    # Each table once: result['table'] is also one of the values.
    for table in {id(v): v for v in result.values() if isinstance(v, dict)}.values():
        if isinstance(table, dict) and table.get('atom_columns') and isinstance(table.get('rows'), list):
            for row in table['rows']:
                for column in table['atom_columns']:
                    if column < len(row):
                        row[column] = walk(row[column])
            table['atom_columns_note'] = 'atom columns are MONET IDs'
    return result


def _command(traj, action, args):
    """Bridge command as the page builds it: MONET IDs → file indices, cell/PBC/MIC options, atom IDs."""
    source = traj['source']
    command = {key: _to_indices(value, source) if key in ATOM_KEYS and value is not None else value for key, value in args.items()}
    params = command.get('params')
    if isinstance(params, dict):
        command['params'] = {k: _to_indices(v, source) if k in ATOM_KEYS and v is not None else v for k, v in params.items()}
    command.update({k: v for k, v in traj['options'].items() if v is not None})
    if action.startswith(NEEDS_IDS):
        command['atom_ids'] = source.ids()
    else:
        command.pop('bond_scale', None)
    command.update(action=action, filename=str(source.path))
    return command


def _save(name, result):
    number = next(STATE.counter)
    handle = f'r{number}'
    path = STATE.output / 'results' / f'{number:03d}_{re.sub(r"[^A-Za-z0-9_.-]", "_", name)}.json'
    path.write_text(json.dumps(result, indent=1))
    STATE.results[handle] = path
    return handle, path


async def _open(path, name, fmt, options, dt, ctx, source_ids=None):
    info = await STATE.bridge.run({'action': 'scan', 'filename': str(path)}, _progress(ctx))
    if not info.get('ok'):
        raise ValueError(info.get('message') or 'MONET could not read this trajectory.')
    handle = f't{len(STATE.trajectories) + 1}'
    source = Source(path, info['atomCount'], source_ids)
    traj = {'source': source, 'name': name, 'options': options, 'dt': dt, 'frames': info['configCount']}
    structure = await STATE.bridge.run({'action': 'read_info', 'filename': str(path), **{k: v for k, v in options.items() if k in ('cell', 'pbc', 'mic') and v is not None}})
    if not structure.get('ok'):
        raise ValueError(structure.get('message') or 'MONET could not read the first frame.')
    STATE.trajectories[handle] = traj
    symbols = info.get('symbols') or structure.get('symbols') or []
    counts = {s: symbols.count(s) for s in dict.fromkeys(symbols)}
    has_cell = bool(structure.get('cellpar')) and all(v > 0 for v in structure['cellpar'][:3])
    return {'trajectory': handle, 'file': name, 'format': fmt or info.get('format'), 'n_atoms': info['atomCount'],
            'n_frames': info['configCount'], 'formula': structure.get('formula'), 'elements': counts,
            'cell_parameters': structure.get('cellpar') if has_cell else None, 'pbc': structure.get('pbc'),
            'time_between_frames_fs': dt,
            'atoms': 'MONET IDs 1…N in file order' if source_ids is None else 'MONET IDs of the source trajectory',
            'first_atoms': [f'{s}{i}' for s, i in zip(symbols[:30], source.ids()[:30])]}


def _user_errors(function):
    """Input problems reach the AI as their message (ToolError); other exceptions stay generic crashes."""
    @functools.wraps(function)
    async def wrapper(*args, **kwargs):
        try:
            return await function(*args, **kwargs)
        except ValueError as error:
            raise ToolError(str(error)) from error
    return wrapper


def build_server(state):
    global STATE
    STATE = state
    server = MCPServer(
        'monet', instructions=(
            'MONET Molecular Dynamics Extractor: analyses of MD trajectories (ASE, MDAnalysis and MONET\'s own). '
            'Start with open_trajectory, set the MD time step there or with set_trajectory_options for time-dependent '
            'analyses (msd, vdos, acf, equilibration), call list_analyses to see every analysis with its parameters, '
            'then run_analysis. Atoms are MONET IDs (1-based). Results are summaries; get_result_data returns full '
            'arrays. Report units and caveats (equilibration, decorrelation, finite sampling) with the numbers.'))

    def tool(function):
        return server.tool()(_user_errors(function))

    @tool
    async def open_trajectory(path: str, format: str = 'auto', md_timestep_fs: float | None = None, steps_per_frame: int = 1,
                              cell: list[float] | None = None, pbc: list[bool] | None = None, minimum_image: bool = True,
                              bond_scale: float = 1.2, reference: str | None = None, cell_file: str | None = None,
                              ctx: Context = None) -> dict:
        """Open a trajectory file for analysis and return its summary and handle (t1, t2 …).

        XYZ/extended XYZ are read directly; other formats (VASP XDATCAR, CP2K, LAMMPS, GROMACS XTC/TRR + topology,
        DCD, NetCDF, PDB, ASE .traj, cp.x, CPMD, Qbox …) are imported to extended XYZ in the output folder.
        md_timestep_fs × steps_per_frame is the time between saved frames. cell = [a, b, c, α, β, γ] (Å, °)
        overrides the file cell; minimum_image uses periodic distances when a cell is present.
        reference: topology/element-order file for formats without elements; cell_file: CIF/POSCAR/.cell/.cel.
        """
        file = STATE.readable(path)
        extras = {'reference': str(STATE.readable(reference)) if reference else None,
                  'cell_file': str(STATE.readable(cell_file)) if cell_file else None}
        import monet_io
        target, fmt = file, None
        if format not in ('auto', 'xyz', 'extxyz') or not monet_io.is_xyz(str(file)) or any(extras.values()):
            target = STATE.output / 'imports' / f'{file.stem}-{int(time.time())}.extxyz'
            command = {'action': 'import', 'filename': str(file), 'format': format, 'output': str(target),
                       'source_name': file.name, **{k: v for k, v in extras.items() if v}}
            result = await STATE.bridge.run(command, _progress(ctx))
            if not result.get('ok'):
                raise ValueError(f'Import failed: {result.get("message")}')
            fmt = result.get('source_label')
        if md_timestep_fs is not None and md_timestep_fs <= 0:
            raise ValueError('md_timestep_fs must be positive.')
        options = {'cell': cell, 'pbc': pbc if pbc is not None else ([True] * 3 if cell else None),
                   'mic': bool(minimum_image), 'bond_scale': bond_scale}
        dt = md_timestep_fs * max(int(steps_per_frame), 1) if md_timestep_fs else None
        return await _open(target, file.name, fmt, options, dt, ctx)

    @tool
    async def set_trajectory_options(trajectory: str, md_timestep_fs: float | None = None, steps_per_frame: int = 1,
                                     cell: list[float] | None = None, pbc: list[bool] | None = None,
                                     minimum_image: bool | None = None, bond_scale: float | None = None) -> dict:
        """Change the time axis, crystal cell [a, b, c, α, β, γ], PBC flags, minimum image or bond cutoff scale of an open trajectory."""
        traj = STATE.trajectory(trajectory)
        if md_timestep_fs is not None:
            if md_timestep_fs <= 0:
                raise ValueError('md_timestep_fs must be positive.')
            traj['dt'] = md_timestep_fs * max(int(steps_per_frame), 1)
        if cell is not None:
            traj['options'].update(cell=cell, pbc=pbc or [True] * 3)
        elif pbc is not None:
            traj['options']['pbc'] = pbc
        if minimum_image is not None:
            traj['options']['mic'] = bool(minimum_image)
        if bond_scale is not None:
            traj['options']['bond_scale'] = bond_scale
        return {'trajectory': trajectory, 'time_between_frames_fs': traj['dt'], **traj['options']}

    @tool
    async def list_analyses(ctx: Context = None) -> dict:
        """Every analysis MONET can run, with its parameters: built-in analyses, the MDAnalysis collection and plugins."""
        registry = await STATE.bridge.run({'action': 'list_analyses'}, _progress(ctx))
        plugins = [{'analysis': a['id'], 'label': a['label'], 'description': a.get('description', ''),
                    'available': a.get('available', True), 'writes_file': bool(a.get('output')),
                    'params': {p['name']: {k: p[k] for k in ('type', 'label', 'default', 'choices', 'min', 'max') if p.get(k) is not None}
                               for p in a.get('params', [])}}
                   for a in registry.get('analyses', [])]
        return {'atoms': 'Atom parameters (indices, pairs, triplets, quads, groups) take MONET IDs (1-based).',
                'frame_step': 'Every analysis accepts frame_step (analyse every n-th frame).',
                'builtin': {name: {'description': d, 'params': p, 'needs_time_step': name in NEEDS_DT} for name, (d, p) in BUILTIN.items()},
                'registered': plugins, 'derived_trajectories': {n: {'description': d, 'params': p} for n, (d, p) in DERIVE.items()},
                'registry_errors': registry.get('errors') or []}

    @tool
    async def run_analysis(trajectory: str, analysis: str, params: dict | None = None, frame_step: int = 1,
                           ctx: Context = None) -> dict:
        """Run an analysis on an open trajectory and return a compact summary plus a result id.

        analysis: a built-in name (rmsd, rdf, msd, vdos, acf, equilibration, fluctuations, bonds, …) or a registered
        id from list_analyses (e.g. mdanalysis.rmsf, custom.displacement_ellipsoids). params: its parameters,
        atoms as MONET IDs. Files written by an analysis (PDB/CIF, density grids …) go to the output folder.
        """
        traj = STATE.trajectory(trajectory)
        params = dict(params or {})
        if frame_step < 1:
            raise ValueError('frame_step must be a positive integer.')
        if analysis in BUILTIN:
            # Only the parameters of the console: paths, cell, PBC and atom numbering are set by the server.
            unknown = sorted(set(params) - set(BUILTIN[analysis][1]))
            if unknown:
                raise ValueError(f'{analysis} has no parameter {", ".join(unknown)}; see list_analyses '
                                 '(cell, PBC and time step are set with set_trajectory_options).')
            args = {**params, 'frame_step': frame_step}
            if analysis in NEEDS_DT or analysis == 'fluctuations':
                if traj['dt']:
                    args['dt'] = traj['dt']
                elif analysis in NEEDS_DT:
                    raise ValueError(f'{analysis} needs the time axis: call set_trajectory_options with md_timestep_fs.')
            command = _command(traj, analysis, args)
        elif re.fullmatch(r'(ase|custom|mdanalysis)\.[a-z0-9_]+', analysis):
            command = _command(traj, 'run_analysis', {'analysis': analysis, 'params': params, 'frame_step': frame_step,
                                                      **({'dt': traj['dt']} if traj['dt'] else {})})
            listed = await STATE.bridge.run({'action': 'list_analyses'})
            spec = next((a for a in listed.get('analyses', []) if a['id'] == analysis), None)
            if spec is None:
                raise ValueError(f'Unknown analysis {analysis}; see list_analyses.')
            if spec.get('output'):
                stem = Path(traj['name']).stem
                command['output'] = str(STATE.output / 'files' / f'{stem}{spec["output"]["suffix"]}')
        else:
            raise ValueError(f'Unknown analysis {analysis!r}; see list_analyses.')
        started = time.time()
        result = await STATE.bridge.run(command, _progress(ctx))
        if not result.get('ok'):
            message = str(result.get('message') or result.get('error') or 'failed').strip()
            raise ValueError(message.splitlines()[-1] if message.startswith('Traceback') else message)
        result = _with_ids({k: v for k, v in result.items() if k not in ('type',)}, traj['source'])
        handle, path = _save(f'{trajectory}_{analysis}', result)
        summary = _compact(result)
        summary.update(result_id=handle, result_file=str(path), seconds=round(time.time() - started, 2))
        if command.get('output'):
            summary['written_file'] = command['output']
        return summary

    @tool
    async def get_result_data(result_id: str, key: str = '', start: int = 0, count: int = 500) -> dict:
        """Full data of a result: key is a dotted path (e.g. "series.0.data", "statistics", "table.rows", "rmsd");
        lists are returned from start, count items at a time."""
        if result_id not in STATE.results:
            raise ValueError(f'Unknown result {result_id!r}.')
        value = json.loads(STATE.results[result_id].read_text())
        for part in [p for p in key.split('.') if p]:
            if isinstance(value, list) and part.isdigit() and int(part) < len(value):
                value = value[int(part)]
            elif isinstance(value, dict) and part in value:
                value = value[part]
            else:
                raise ValueError(f'{key!r} is not in the result; top-level keys: {", ".join(json.loads(STATE.results[result_id].read_text()))}.')
        if isinstance(value, dict):
            return {'key': key, 'keys': list(value), 'value': _compact(value)}
        if isinstance(value, list):
            count = max(1, min(int(count), 5000))
            return {'key': key, 'total': len(value), 'start': start, 'values': value[start:start + count]}
        return {'key': key, 'value': value}

    @tool
    async def select_atoms(trajectory: str, selection: str, ctx: Context = None) -> dict:
        """MONET IDs of the atoms matching an MDAnalysis selection on the first frame,
        e.g. "element O", "resname SOL and name OW", "around 3.5 index 12", "not element H"."""
        traj = STATE.trajectory(trajectory)
        result = await STATE.bridge.run(_command(traj, 'mda_select', {'selection': selection}), _progress(ctx))
        if not result.get('ok'):
            raise ValueError(result.get('message') or 'Selection failed.')
        ids = traj['source'].ids()
        return {'monet_ids': [ids[i] for i in result['indices']], 'n_atoms': result['n_atoms'],
                'residues': result.get('residues'), 'n_residues': result.get('n_residues')}

    @tool
    async def find_bonded_groups(trajectory: str, kind: str, pattern: list[str], among: list[int] | None = None,
                                 ctx: Context = None) -> dict:
        """Bonded chains matching element patterns on the first frame, as MONET ID groups for acf, fluctuations,
        bonds, angles or dihedrals. kind: bonds | angles | dihedrals; pattern e.g. ["O", "H"], ["H", "O", "H"],
        ["C", "C", "O", "H"] ("*" = any element); among: restrict to these MONET IDs."""
        if kind not in ('bonds', 'angles', 'dihedrals'):
            raise ValueError('kind must be bonds, angles or dihedrals.')
        traj = STATE.trajectory(trajectory)
        args = {'mode': kind, 'pattern': pattern}
        if among:
            args['restrict'] = [traj['source'].index(i) for i in among]
        result = await STATE.bridge.run(_command(traj, 'select_atoms', args), _progress(ctx))
        if not result.get('ok'):
            raise ValueError(result.get('message') or 'Search failed.')
        ids = traj['source'].ids()
        groups = [[ids[i] for i in group] for group in result['groups']]
        return {'groups': groups[:500], 'n_groups': result['n_groups'],
                'note': f'first 500 of {len(groups)} shown' if len(groups) > 500 else None}

    @tool
    async def derive_trajectory(trajectory: str, operation: str, params: dict | None = None, ctx: Context = None) -> dict:
        """Write a derived trajectory into the output folder and open it: unwrap, wrap or subsample
        (e.g. every stride-th frame from acf, for uncorrelated configurations). Returns the new trajectory handle."""
        if operation not in DERIVE:
            raise ValueError(f'operation must be one of {", ".join(DERIVE)}.')
        traj = STATE.trajectory(trajectory)
        params = dict(params or {})
        unknown = sorted(set(params) - set(DERIVE[operation][1]))
        if unknown:
            raise ValueError(f'{operation} has no parameter {", ".join(unknown)}.')
        if 'center' in params:
            params['center'] = [traj['source'].index(i) for i in params['center']]
        command = _command(traj, operation, params)
        output = STATE.output / 'derived' / f'{Path(traj["name"]).stem}-{operation}-{int(time.time())}.extxyz'
        command['output'] = str(output)
        result = await STATE.bridge.run(command, _progress(ctx))
        if not result.get('ok'):
            raise ValueError(result.get('message') or f'{operation} failed.')
        # Derived files keep all atoms in the same order, so the MONET IDs carry over.
        opened = await _open(output, output.name, 'extxyz', dict(traj['options']), traj['dt'] if operation != 'subsample' else None,
                             ctx, traj['source'].atom_ids)
        opened.update(derived_from=trajectory, operation=operation, written_file=str(output),
                      **{k: v for k, v in result.items() if k in ('n_frames', 'source_frames', 'stride', 'start')})
        if operation == 'subsample':
            opened['time_between_frames_fs'] = None
            opened['note'] = 'Frames are no longer equally spaced in the original time axis unless a stride was used; set the time step again if needed.'
        return opened

    @server.prompt()
    def analyze_md_trajectory(path: str) -> str:
        """A guided MD analysis of one trajectory with MONET."""
        return (f'Analyse the molecular-dynamics trajectory {path} with the MONET tools.\n'
                '1. open_trajectory (ask me for the MD time step and the steps per saved frame if you do not know them); '
                'report atoms, frames, formula and cell.\n'
                '2. Check equilibration (equilibration on a relevant bond, angle, dihedral or rmsd group) and discard the '
                'transient if needed (derive_trajectory subsample with start).\n'
                '3. Decorrelation: acf on the slowest relevant coordinate; report τ and the stride between uncorrelated configurations.\n'
                '4. Structure and dynamics as relevant: rmsd, rdf (periodic), fluctuations (atoms, bonds, dihedrals: trends, '
                'RMSF, thermal ellipsoids), msd/diffusion, vdos.\n'
                '5. Summarise numbers with units, uncertainties and caveats (finite sampling, classical nuclei, unconverged '
                'quantities), and list the files written in the output folder.')

    @server.resource('monet://docs/md-analysis-workflow', mime_type='text/markdown')
    def workflow_guide() -> str:
        """MONET's MD analysis workflow and reporting checklist."""
        return (ROOT / 'docs' / 'md-analysis-workflow.md').read_text(encoding='utf-8')

    return server


def main(argv=None):
    parser = argparse.ArgumentParser(description='MONET MCP server (stdio) for Claude Desktop/Code and Gemini CLI.')
    parser.add_argument('--output', default=os.environ.get('MONET_MCP_OUTPUT', str(Path.home() / 'MONET-mcp')),
                        help='folder for results and written files (default ~/MONET-mcp or $MONET_MCP_OUTPUT)')
    parser.add_argument('--data', action='append', default=None,
                        help='folder MONET may read trajectories from; repeat for several (default: home folder)')
    args = parser.parse_args(argv)
    state = State(args.output, args.data or [str(Path.home())])
    build_server(state).run()


if __name__ == '__main__':
    main()

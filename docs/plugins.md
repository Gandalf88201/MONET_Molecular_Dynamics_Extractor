# Adding analyses to MONET (plugins)

An analysis is one Python function. It declares its inputs; MONET builds the form, checks the values, runs the function on the active trajectory in a Python worker, plots the result, logs it in the analysis history and writes it into `replay.py`. You do not touch JavaScript, the launcher or the desktop app.

The same mechanism serves every module:

| `engine` | Where it appears | Needs |
| --- | --- | --- |
| `ase` | **ASE › More analyses** | ASE |
| `mdanalysis` | **MDAnalysis › Analyses** (in the same menu as the built-in ones) | MDAnalysis |
| `custom` | **MONET Custom Functionalities › More analyses** | numpy only |

The *More analyses* tab is shown only when at least one analysis is installed for that module. The built-in MDAnalysis analyses are written this way too: see `monet_analyses/mdanalysis.py`.

## A first plugin

Save this as `~/.monet/plugins/end_to_end.py` and restart the launcher (`python3 start_monet.py`):

```python
import numpy as np
from monet_registry import Param, analysis, series

@analysis('end_to_end', engine='custom', label='End-to-end distance',
          description='Distance between the first and the last atom of each pair, in every analysed frame.',
          category='Shape',
          params=[Param.groups('pairs', 'Pairs of MONET IDs', width=2)])
def end_to_end(ctx, p):
    if not p['pairs']:
        raise ValueError('Enter at least one pair of atoms.')
    data = ctx.frames()
    values = {}
    for a, b in p['pairs']:
        d = np.linalg.norm(data.positions[:, b] - data.positions[:, a], axis=1)
        values[f'{a + 1}–{b + 1}'] = d
    return series(data.frames, values, y_label='Distance (Å)')
```

It appears under *MONET Custom Functionalities › More analyses*, with a field for the pairs and a **← picked** button that inserts the atoms selected in the viewer.

`ValueError` messages are shown to the user as they are, so write them as instructions ("Enter at least one pair of atoms."). Any other exception is reported with its traceback.

## Where MONET looks for plugins

1. `plugins/` in the MONET folder (the two examples shipped with MONET live there);
2. `~/.monet/plugins/` (your own analyses, kept when MONET is updated);
3. the folders or files listed in the environment variable `MONET_PLUGINS` (separated by `:` on macOS/Linux, `;` on Windows);
4. installed Python packages that declare the entry point group `monet.analyses`, e.g. in `pyproject.toml`:

   ```toml
   [project.entry-points."monet.analyses"]
   my_analyses = "my_package.monet_plugin"
   ```

Files whose name starts with `_` are skipped. Plugins are read once when a worker starts: **restart the launcher (or the desktop app) after adding or changing a plugin.** A plugin that cannot be imported, or that defines an analysis twice, is listed in the *More analyses* tab with its error; the other analyses keep working.

Plugins are ordinary Python code run with your user rights, like any package you install: only use plugins you trust.

## `@analysis(...)`

```python
@analysis(name, engine, label, description='', params=(), category='', requires=(), output=None, citation='')
```

| Argument | Meaning |
| --- | --- |
| `name` | lower-case identifier; the analysis id is `<engine>.<name>`, e.g. `custom.end_to_end` |
| `engine` | `ase`, `mdanalysis` or `custom` (table above) |
| `label` | menu entry |
| `description` | text above the form; say what is computed and with which convention |
| `params` | list of `Param` (below) |
| `category` | menu group (`<optgroup>`); default *Plugins* |
| `requires` | extra Python modules, e.g. `('scipy',)`; a missing one disables the entry and tells the user what to install |
| `output` | the analysis writes a file: `{'suffix': '.dx'}`; add `'trajectory': True` for an extended XYZ that MONET can analyse next |
| `citation` | shown under the description and useful for the methods report |

## Parameters

| Constructor | Form field | Value in `p` |
| --- | --- | --- |
| `Param.number(name, label, default, min=, max=, positive=)` | number | float |
| `Param.integer(name, label, default, min=, max=)` | number | int |
| `Param.bool(name, label, default)` | checkbox | bool |
| `Param.choice(name, label, choices, default=)` | menu | one of `choices` |
| `Param.text(name, label, default)` | text | str |
| `Param.selection(name, label, default='all')` | MDAnalysis selection + **← picked** | str |
| `Param.lines(name, label)` | text area | list of str (empty lines dropped) |
| `Param.atoms(label, optional=True)` | MONET IDs + **← picked** | `p['indices']`: 0-based indices, or `None` when blank |
| `Param.groups(name, label, width)` | groups of MONET IDs + **← picked** | list of index lists |

Atom inputs are always typed as **MONET IDs** and reach the function as **0-based indices of the analysed file**, the order of `ctx.frames()` and `ctx.atoms()`. So that the history, the console and `replay.py` can convert them back to MONET IDs, their names are fixed: `indices` for `Param.atoms`, and `pairs`, `triplets`, `quads` or `groups` for `Param.groups`.

Values are checked before your function runs: required fields, ranges, whole numbers, choices, atoms inside the trajectory, and unknown parameter names are refused with a message naming the field.

## The context `ctx`

Everything follows the MONET settings (frame step, crystal cell, periodic boundaries, minimum image, bond cutoff) and is loaded on first use.

| | |
| --- | --- |
| `ctx.frames(atoms=None, need_cell=False)` | `Frames(frames, positions, cells, pbc)`: frame indices, positions `(F, n, 3)` in Å, cells `(F, 3, 3)` or `None`, PBC flags. `need_cell=True` asks the user for a cell when there is none |
| `ctx.atoms()` | first frame as an `ase.Atoms` (cell and PBC applied) |
| `ctx.symbols`, `ctx.natoms` | element symbols, number of atoms |
| `ctx.universe()` | `(frames, Universe)`: in-memory MDAnalysis Universe; atom `id` = MONET ID, residues from the topology or from bonded molecules |
| `ctx.atom_properties()` | topology columns of imported files (`resname`, `resid`, `atomname`) or `{}` |
| `ctx.dt` | fs between two analysed frames (time axis × frame step), or `None` when the time axis is not set |
| `ctx.frame_step`, `ctx.mic`, `ctx.bond_scale`, `ctx.filename` | the current settings |
| `ctx.progress(message, percent)` | status line and progress bar |
| `ctx.output()` | path to write the declared output file |

## Results

Return one of these (all in `monet_registry`); numpy arrays are accepted and NaN or ±inf become gaps.

| Helper | Shown as |
| --- | --- |
| `series(x, y, x_label='Frame', y_label='', notes=(), table=None, bars=False)` | curves along the analysed frames; the legend gives mean ± SD; clicking the plot shows that frame |
| `profile(x, y, x_label, y_label, notes=(), table=None, bars=False, atoms=None)` | curves against any x (distance, lag, frequency); with `atoms` the x axis shows MONET IDs |
| `matrix(values, labels, x_label, y_label, color_label, notes=(), table=None)` | a colour map with colour-map, origin and title controls |
| `table(columns, rows, notes=(), atom_columns=())` | a table; columns in `atom_columns` hold atom indices shown as "MONET ID (element)" |

`y` is `{label: values}` (or a list of `(label, values)`); each series needs as many values as `x`. `table=` adds a table under a plot. Every plot has **Download plot PNG** and **Download data CSV**.

## Testing a plugin without the interface

The bridge reads one JSON command; atom inputs are file indices here:

```sh
echo '{"action": "list_analyses"}' | python3 ase_bridge.py
echo '{"action": "run_analysis", "analysis": "custom.end_to_end", "filename": "examples/water.XYZ",
       "params": {"pairs": [[0, 2]]}}' | python3 ase_bridge.py
```

In MONET's console (History › Console) the same call uses MONET IDs:

```
run_analysis(analysis="custom.end_to_end", params={"pairs": [[1, 3]]})
```

`tests/registry.cjs` shows how MONET tests plugin discovery, parameter checks and results.

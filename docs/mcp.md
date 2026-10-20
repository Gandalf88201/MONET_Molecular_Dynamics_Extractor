# MONET for AI assistants (MCP server)

`monet_mcp.py` is a [Model Context Protocol](https://modelcontextprotocol.io) server. It gives AI assistants such as Claude Desktop, Claude Code and Gemini CLI MONET's analyses as tools, so you can ask in plain language, for example *"open ~/runs/ethanol.xyz with a 0.5 fs time step, check whether it is equilibrated and give me the RMSF and thermal ellipsoids of the heavy atoms"*.

The server runs MONET's Python engine directly on trajectory files, without the MONET window, on your computer. The AI assistant sends tool calls and receives the numbers; your trajectory files are not uploaded as files, but the results the tools return (and anything the assistant reads) go to the assistant's provider like any other chat content.

## Install

MONET's environment (created by `start_monet.command` / `start_monet.bat` in `.venv`, or your conda environment) plus the MCP Python SDK:

```sh
cd /path/to/MONET_Molecular_Dynamics_Extractor
.venv/bin/python -m pip install "mcp>=1.2"        # Windows: .venv\Scripts\python -m pip install "mcp>=1.2"
.venv/bin/python monet_mcp.py --help
```

Use the **absolute path of that Python** in the client configuration below, so the server finds ASE and MDAnalysis. The SDK is only needed for this server; MONET itself runs without it.

Options:

| Option | Meaning |
| --- | --- |
| `--output DIR` | where results (JSON), written files (PDB/CIF, grids) and derived trajectories go; default `~/MONET-mcp` or `$MONET_MCP_OUTPUT` |
| `--data DIR` | folder the server may read trajectories from; repeat for several; default your home folder |

The server never writes outside `--output` and never reads outside the `--data` folders (and `--output`).

## Connect a client

Replace the paths with yours (on Windows use `C:\\...\\.venv\\Scripts\\python.exe`).

**Claude Code**

```sh
claude mcp add monet -s user -- /path/to/MONET/.venv/bin/python /path/to/MONET/monet_mcp.py --output ~/MONET-mcp --data ~/simulations
```

**Claude Desktop**: *Settings › Developer › Edit Config* opens `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`). Add, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "monet": {
      "command": "/path/to/MONET/.venv/bin/python",
      "args": ["/path/to/MONET/monet_mcp.py", "--output", "/Users/me/MONET-mcp", "--data", "/Users/me/simulations"]
    }
  }
}
```

**Gemini CLI**

```sh
gemini mcp add -s user --timeout 600000 monet /path/to/MONET/.venv/bin/python /path/to/MONET/monet_mcp.py --output ~/MONET-mcp --data ~/simulations
```

or in `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "monet": {
      "command": "/path/to/MONET/.venv/bin/python",
      "args": ["/path/to/MONET/monet_mcp.py", "--output", "/Users/me/MONET-mcp", "--data", "/Users/me/simulations"],
      "timeout": 600000
    }
  }
}
```

`timeout` is in milliseconds; long analyses on large trajectories need more than the 30 s some clients use by default. The server reports progress while an analysis runs.

## Tools

| Tool | What it does |
| --- | --- |
| `open_trajectory` | opens a file (XYZ/extended XYZ directly; VASP, CP2K, LAMMPS, GROMACS, DCD, NetCDF, PDB, ASE, cp.x, CPMD, Qbox … imported to extended XYZ) with the time step, cell and PBC; returns atoms, frames, formula, cell and a handle `t1`, `t2` … |
| `set_trajectory_options` | time step, cell `[a, b, c, α, β, γ]`, PBC, minimum image, bond cutoff scale |
| `list_analyses` | every analysis with its parameters: MONET's own (RMSD, RMSD matrix, pair distances, RDF, bonds, angles, dihedrals, MSD/D, VDOS, autocorrelation, equilibration, fluctuations, structure, coordination), the MDAnalysis collection and the installed plugins |
| `run_analysis` | runs one analysis; returns a compact summary (long arrays as count, mean, SD, min, max) and a result id |
| `get_result_data` | any part of a result in full, e.g. `series.0.data`, `statistics`, `table.rows`, in pages |
| `select_atoms` | MONET IDs matching an MDAnalysis selection (`element O`, `around 3.5 index 12` …) |
| `find_bonded_groups` | bonded chains by element pattern (`["H", "O", "H"]`, `["C", "C", "O", "H"]`) as groups for bonds, angles, dihedrals, autocorrelation or fluctuations |
| `derive_trajectory` | unwrap, wrap or subsample (e.g. every decorrelation stride) into a new trajectory, opened as a new handle |

There is also a prompt, `analyze_md_trajectory` (a guided analysis: equilibration, decorrelation, structure, dynamics, caveats), and the resource `monet://docs/md-analysis-workflow` (MONET's analysis workflow and reporting checklist).

Atoms are **MONET IDs**, 1…N in file order, as in the MONET console; results use them too. Every full result is saved as JSON in `--output/results/`, files written by analyses in `--output/files/`, derived trajectories in `--output/derived/`.

## Test it without an assistant

The MCP Inspector lists the tools and lets you call them by hand:

```sh
npx @modelcontextprotocol/inspector /path/to/MONET/.venv/bin/python /path/to/MONET/monet_mcp.py --output /tmp/monet-mcp
```

`tests/mcp.cjs` drives the server with the official MCP client over stdio (`PYTHON=.venv/bin/python node tests/mcp.cjs`).

## Notes

- The server works on files, independently of the MONET window: analyses run through the AI are not added to the history of an open MONET session. Open the files it writes (derived trajectories, PDB/CIF) in MONET or any viewer.
- Analyses run one at a time in one persistent MONET worker, so a large trajectory is indexed once.
- Treat the assistant's interpretation like a colleague's: the numbers come from MONET, the reading of them does not. Check units, convergence and the caveats the tools report.

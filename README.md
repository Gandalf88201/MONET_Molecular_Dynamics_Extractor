# MONET 2 — Molecular Dynamics Extractor with ASE

MONET extracts configurations every N frames from molecular-dynamics trajectories, writes quantum-chemistry inputs for each sampled configuration and analyses the trajectory with ASE. It runs in a browser (with a local Python launcher) or as an Electron desktop app, in day or night mode (☀/☾ button in the title bar).

## Start with ASE enabled (recommended)

Use **Python 3.10 or newer**. Extract the entire ZIP and open a terminal in the MONET folder.

macOS / Linux, first-time setup:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python start_monet.py
```

Windows PowerShell, first-time setup (activation is not required):

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe start_monet.py
```

The launcher opens MONET in your browser and prints its local address, normally `http://127.0.0.1:8765`. Keep the terminal open while using the app. Stop it with Ctrl+C.

For subsequent launches, run `.venv/bin/python start_monet.py` on macOS/Linux or `.venv\Scripts\python.exe start_monet.py` on Windows. If the port is occupied, add `--port 8766`.

Installing ASE needs internet access once. The app then runs locally; trajectory data is sent only to the Python service on your computer. The service listens only on loopback, requires the per-session token embedded in the page, and keeps uploaded files in a private session directory that is deleted when the launcher stops.

With the launcher, a trajectory is uploaded **once** (no size limit other than `--max-upload-gb`, default 200 GB) and every scan, frame, extraction and analysis runs as a background job with a progress bar and a **Cancel** button. Results are streamed as a ZIP download.

**Opening `index.html` directly does not start Python and cannot enable ASE.** It still supports XYZ import (up to 100 MiB), visualization, extraction, QM input generation and ZIP export in the page. To use ASE, open the address printed by `start_monet.py`.

## Use the ASE Analysis panel

1. Click **Browse**, load an XYZ file, and click **Next**. The ASE badge should show its version.
2. Open **ASE Analysis**. Analysis can run directly on the loaded XYZ; extraction is optional.
3. After a successful extraction, analysis uses the extracted trajectory instead. The panel states which source is active.
4. Enter the frame step and, for bonds/angles, MONET atom IDs. Click the calculation button.

The ASE panel displays an atom table with **MONET ID, ASE index, element, and first-frame x/y/z coordinates**. Enter the **same MONET IDs used in the viewer** in all bond, angle, and dihedral inputs. The app translates them to ASE's internal zero-based indices automatically.

After extraction, the table lists only the extracted atoms, keeping their original MONET IDs. For example, extracting MONET atoms 1 and 3 produces ASE indices 0 and 1, while inputs and plot legends still use IDs 1 and 3. The mapping is a snapshot of the completed extraction, so later selection edits do not relabel existing output. Before each calculation, the app verifies the count, elements, and first-frame coordinates against ASE (coordinate tolerance: 1e-6 Å); a mismatch stops analysis.

Example with `examples/water.XYZ`:

- Import: 2 configurations, 3 atoms per frame.
- RMSD, frame step 1: 0 and 0.1 Å.
- Bond pair `1 2`: about 0.9573 Å in both frames.
- Angle triplet `2 1 3`: about 104.51° in both frames.

### Select atoms with the ASE molecular viewer

The ASE panel now includes its own molecular viewer beside the analyses. It shows the first frame of the active trajectory with the same MONET IDs as the table and main viewer. After extraction, only the extracted atoms appear.

1. **Click atoms in the required order.** Gold highlighting and numbered badges show the selection and order. Click an atom again (or its selection chip) to remove it. Table rows also toggle selection and support Enter/Space.
2. Choose an analysis in **Use selection for** and click **Use selection**. The corresponding panel opens with the atom IDs filled in.
3. Set the frame step and other options, then click **Compute**.

For bond lengths, select groups of 2 atoms. For angles, select groups of 3; the middle atom is the vertex. For dihedrals, select groups of 4 in bond order. Enable **Append to existing atom groups** to add more pairs, triplets, or quadruplets to the same analysis.

For RMSD, select one or more atoms. For pair distances, select at least two atoms; the histogram includes pairs among that subset and also applies any element-pair filter. The RMSD and pair-distance atom fields can be edited manually; leaving them blank uses all atoms.

Drag to rotate, scroll to zoom, and click **Fit view** to reset the orientation and fit the molecule. Rotation gestures do not select atoms. For overlapping atoms, clicking picks the visible front atom; rotate to reach atoms behind it.

ASE picking is separate from the main workflow's extraction selection. **Clear selection** only clears the ASE picks; **Clear analysis** clears results. Changing the active trajectory resets the ASE picks and atom input fields so selections cannot refer to the wrong source. Use selection must be clicked again to apply changed picks to an analysis input.

### Crystal cells

Open **Crystal cell and periodic boundaries** above the ASE viewer. Choose a crystal system/setting, enter a, b, c in Å and α, β, γ in degrees, select periodic directions, then click **Apply cell**. α is the angle between b and c; β between a and c; γ between a and b. Presets enforce:

| Setting | Constraints |
| --- | --- |
| Triclinic/custom | Six independent parameters |
| Monoclinic, unique b | α = γ = 90° |
| Orthorhombic | α = β = γ = 90° |
| Tetragonal | a = b; α = β = γ = 90° |
| Hexagonal / trigonal with hexagonal axes | a = b; α = β = 90°, γ = 120° |
| Trigonal with rhombohedral axes | a = b = c; α = β = γ |
| Cubic | a = b = c; α = β = γ = 90° |

Crystal **habit** describes external morphology; it alone cannot determine lattice metrics or symmetry. These presets do not infer a space group, expand symmetry-equivalent atoms, or create supercells.

Entered cells use a along Cartesian x, b in the xy plane, and positive c-z. Cartesian atom positions are neither rotated nor rescaled, so use coordinates in this convention when manually entering a cell. The viewer draws the cell edges and labels a/b/c. Invalid or degenerate cells are rejected.

**Read cell from XYZ** inspects the active file, displays its existing vectors in their original orientation, and fills the six fields for inspection. The source cell remains active until **Apply cell** is clicked. **Use source cell** removes a manual override. Plain XYZ has no lattice: enter it manually. A manually applied cell is constant across frames and retained after extraction of the same input, but resets on loading another input. Source extXYZ cells can vary frame by frame. Core extraction drops source lattice metadata; manually apply the appropriate constant cell if needed after extraction.

The **minimum-image** checkbox controls periodic bond lengths, pair distances, angles, dihedrals, and molecule selection. Periodic directions must also be enabled in the applied or source cell. RMSD is raw Cartesian displacement unless Kabsch alignment and/or unwrapping are enabled in the RMSD tab. Editing a cell field is a draft change until **Apply cell**; applying a cell or changing the image option clears previous analyses to prevent mixing geometries.

### Select a complete molecule

Right-click an atom in the ASE viewer or its atom-table row, then choose **Select molecule containing atom …**. ASE finds the connected component using first-frame covalent radii, with the displayed cutoff multiplier (default 1.2). Periodic connectivity follows the minimum-image setting and can join atoms across a cell boundary.

Selection replaces the previous ASE picks, begins at the clicked atom, and follows graph traversal order. It is suitable for RMSD or pair-distance subsets. For angles and torsions, choose the desired atoms individually in bond order: a whole molecule’s graph order is not necessarily a valid analysis path.

Connectivity is inferred, not read as authoritative chemical bonds. Adjust the cutoff for unusual bonds or close contacts. A component connected to its own periodic copies is reported as an extended network rather than a finite molecule. Isolated atoms select just themselves. Only atoms in the active (possibly extracted) trajectory can be selected. Displayed sticks are a direct-coordinate visual estimate; periodic molecule detection uses ASE.

### Bond-angle and dihedral ranges

For an angle, select three MONET IDs, with the middle atom as the vertex. For a dihedral, select four IDs in bond order; the middle pair defines the torsion axis. Multiple groups can be entered. Choose the range, then **Compute**:

- **Bond angle 0–180°**: usual undirected spatial angle (default for bond angles).
- **0–360°**: native ASE torsions. For bond angles, specify a nonzero Cartesian **reference normal x y z**, default `0 0 1`. The spatial angle magnitude is preserved; the sign of `normal · ((r₁−r₂) × (r₃−r₂))` chooses θ or 360−θ. This is a hemisphere convention, not an angle projected onto a plane. An in-plane normal is rejected for non-collinear vectors; use a normal with a perpendicular component. Keep the reference choice physically consistent across the trajectory.
- **−90° to +90°, folded**: `((θ + 90) mod 180) − 90`, in [−90°, +90°). Thus +90° is shown as −90°, and values separated by 180° become indistinguishable. Bond angles fold the ordinary undirected 0–180° angle. This option is not a signed 360° torsion and loses orientation information.

Plots and PNG exports use the selected range, labeled axes, and breaks at wrap boundaries. Changing the convention clears the current angular result; recompute before downloading. Repeated IDs and undefined collinear torsions are rejected. `examples/torsion.xyz` produces 270° and 90° in full range, and −90° in both frames in folded mode.

The included `examples/periodic-water.xyz` contains two water molecules in a 10 Å cubic cell, one split across the x boundary. Load it, read its cell, keep minimum images enabled, and right-click atom 1 to select IDs 1, 2, and 3.

### Clear analyses and save plots

Every analysis tab has **Clear analysis** and **Download plot PNG** buttons. **Clear all analyses** removes all plotted results. Clearing removes the in-memory results and plot while retaining the trajectory, atom selection, and input settings. A cleared result stays cleared if an in-flight calculation finishes later; clearing does not terminate its Python process or delete previously downloaded files.

PNG exports include the title, active source, axes, units, legend, and data. They are rendered independently of the on-screen plot at **2400 × 1440 pixels**, with additional height for many series. Single-frame results include a visible point. Download is disabled until a result exists.

By default RMSD uses raw Cartesian coordinates; enable Kabsch alignment to remove translation/rotation and Unwrap PBC for periodic runs. Distances and angles use minimum-image corrections when enabled and when the active cell has periodic directions. Without a periodic cell, they use direct Cartesian coordinates. Pair-distance output is a histogram of counts from 0.5 Å to Rmax, not a normalized radial distribution function (use the RDF tab for g(r)). A filter such as `C N` includes exactly C–N pairs; one element selects like pairs.

## Time axis, correlation and dynamics analyses

Set the **Time axis** row at the top of the ASE panel: the MD time step of your simulation (fs, atomic units or ps) and the number of MD steps between saved frames. Nothing is assumed: MSD, VDOS and autocorrelation stay disabled until the time step is given. The frame step of each analysis is applied on top (lag spacing = time step × MD steps per frame × frame step).

### RMSD, alignment and RMSD matrix

- **RMSD**: optional **Kabsch alignment** (removes translation and rotation), optional unwrapping and a choice of reference frame (any analysed frame).
- **RMSD Matrix**: pairwise RMSD between analysed frames (up to 3000), shown as a heat map. Low off-diagonal values mean the trajectory revisits earlier states; blocks along the diagonal show distinct basins. Use a frame step close to the decorrelation stride to compare non-correlated configurations.

### RDF

Normalised g(r) and the running coordination number n(r) for an element pair (or all atoms, optionally restricted to selected IDs), averaged over frames with minimum-image distances. A complete periodic cell is required; R<sub>max</sub> is limited to half the smallest perpendicular cell width. Unlike *Pair Distances* (raw counts), g(r) → 1 for an uncorrelated liquid.

### MSD and diffusion

Positions are unwrapped with minimum-image steps (keep the frame step small enough that atoms move less than half a cell between analysed frames; a warning is shown otherwise), the centre-of-geometry drift can be removed, and MSD(t) is averaged over all time origins (FFT algorithm). D = slope / 6 from a linear fit in the chosen window (default 10–50 % of the run), reported in cm²/s and Å²/fs, for the selection and per element.

### VDOS

Fourier transform of finite-difference velocities (Hann window, optional mass weighting and Gaussian smoothing), normalised to unit area. Save frames every MD step (or few steps) for accurate high frequencies; the Nyquist limit and resolution are shown.

### Autocorrelation and decorrelation stride

Choose a dihedral, bond angle, bond length or RMSD and one or more atom groups (averaged). MONET computes

- the normalised fluctuation autocorrelation C(t) = ⟨δx(0)δx(t)⟩/⟨δx²⟩ (dihedrals are unwrapped across 0/360° first) or, for angles, the circular ⟨cos[θ(t)−θ(0)]⟩;
- τ from a fit of exp(−t/τ) (up to the first zero crossing, three 1/e times or the whole lag range) with its standard error, and the integrated τ up to the first zero;
- the probability distribution of the quantity, its (circular) mean, standard deviation and a correlation-corrected standard error.

τ is converted into MD steps and saved frames with the time axis you set; you can also type τ yourself and choose a safety factor. **Use as sampling frequency** copies the suggested stride into step 02, so the extracted configurations are statistically independent. Example: with a 0.4838 fs time step (20 a.u.) and τ = 43.6 fs, sampling every ≈ 90 MD steps gives non-correlated configurations; your own τ and time step will differ.

### Unwrap and data export

*Convert → Unwrap and download* writes an extended XYZ copy with continuous atom paths. Every plot has **Download plot PNG** (2400 px wide, current theme) and **Download data CSV**.

## Convert

Open **Convert**, browse for an XYZ input, choose the output format, and set the download filename. **Convert first frame only** is enabled by default for compatibility with formats that store one structure. Click **Convert**, then **Download converted file**.

For multi-frame extXYZ or JSON output, uncheck the first-frame option. For a plain XYZ, apply a crystal cell and enable **Apply the manual crystal cell above to this conversion input**. This is explicit because conversion may use a different file. Otherwise conversion retains the input file’s own cell. VASP requires a complete cell. Quantum ESPRESSO conversion is not implemented because this panel does not collect pseudopotential settings. Gaussian uses ASE's `gaussian-in` writer.

If ASE is unavailable, the panel shows the connection or installation error. Install dependencies using the same Python environment used by the launcher, then click **Recheck ASE connection**. If the connection disappears, restart the launcher and reload its page.

## Core extraction workflow

1. **File input** — Browse for a trajectory and choose the input format (see below). XYZ/extXYZ files are read directly; other formats are imported first.
2. **Analysis & sampling** — MONET reports frames and atoms; choose the sampling frequency (every N-th frame). The Autocorrelation tab can fill this value from the decorrelation time.
3. **Atom selection** — click atoms in the viewer or type MONET IDs.
4. **Options** — average structure and quantum-chemistry inputs.
5. **Processing** — progress, log and Cancel.
6. **Results** — download the ZIP (browser) or open the chosen folder (desktop).

Output tree: `0-HISTORY/run.json`, `1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz` (selected atoms, every frame), `2-SAMPLED_CONFIGURATIONS/` (`SAMPLED_CONFIGURATIONS.xyz` and `confN/posN.txt` plus inputs), `3-AVERAGE_STRUCTURE/GEO-AVERAGE.xyz` (all atoms, all frames, simple Cartesian average). Coordinates are written with 7 decimals; the JavaScript and Python engines produce identical files.

XYZ frames must keep a constant atom count and element order. Extended XYZ `species`/`pos` properties and `Lattice`/`pbc` are read; other per-atom properties are not carried into the extracted files.

### Performance

The Python engine indexes frame offsets once (numpy, cached in the system temp directory under `monet-index`) and then parses only the requested frames/atoms. Measured on a 66 MB trajectory (5000 frames × 292 atoms, 73 atoms selected, every 10th frame sampled, average and Gaussian inputs on):

| Task | Before | Now |
| --- | --- | --- |
| Indexing / analysing the file | 3.0 s | 0.2 s (Python) · 1.7 s (desktop) |
| Extraction | 11.8 s + 3.0 s re-analysis | 2.8 s (Python) · 3.1 s (desktop) |
| Bond-length series (2 pairs) | 7.6 s | 3.8 s |

The desktop app streams the extraction in a single pass with back-pressure, so memory use does not grow with the trajectory length.

## Input formats

| Format | Notes |
| --- | --- |
| XYZ / extended XYZ | CPMD `TRAJEC.xyz`, CP2K `*-pos-*.xyz`, ORCA `*_trj.xyz`/MD, Qbox exports … Read directly. |
| CP2K `.cell` file (optional) | Attaches a per-step lattice to an XYZ trajectory (NPT); matched by the `i =` step in the comment line, otherwise by order. |
| VASP XDATCAR, OUTCAR, vasprun.xml, POSCAR/CONTCAR | via ASE |
| Quantum ESPRESSO pw.x output | every ionic step (relax/MD), via ASE |
| Quantum ESPRESSO cp.x `.pos` (+ `.cel`) | bohr → Å; needs a reference structure; choose whether `.cel` rows or columns are the lattice vectors |
| Qbox output (`.r`/XML) | every `<iteration>`; positions and cell converted from bohr (ASE 3.29 leaves them in bohr) |
| ORCA output | every `CARTESIAN COORDINATES (ANGSTROEM)` block |
| CP2K DCD | needs a reference structure for element names |
| CPMD `TRAJECTORY` | `step x y z vx vy vz` in bohr; restart markers skipped; needs a reference structure |
| LAMMPS text dump, ASE `.traj`, CIF, Gaussian output | via ASE |

*Auto-detect* uses the file name and content. Imported data are written to extended XYZ (with `Lattice`, `pbc` and `source_step` when available) and then processed like any XYZ file. Importing needs the launcher or the desktop app with Python/ASE. The **reference structure** is any file ASE can read (e.g. the first frame as XYZ) with the same atom order as the trajectory.

## Quantum-chemistry inputs

Step 04 writes inputs for every sampled configuration for **Gaussian** (the default text is identical to MONET 1: `sing.dat`/`trip.dat`, `%chk=s0.chk`), **ORCA**, **Qbox**, **Quantum ESPRESSO pw.x**, **VASP** (POSCAR, atoms grouped by element, plus `INCAR_<state>`) and **CP2K**.

- Common settings: charge, spin multiplicities (one file per multiplicity: 1 → `sing`, 2 → `doub`, 3 → `trip`, 4 → `quar`, 5 → `quin`), processors, memory, method, basis set and vacuum padding.
- Gaussian files stay in `confN/`; other codes use `confN/orca/`, `confN/qbox/`, `confN/qe/`, `confN/vasp/`, `confN/cp2k/`.
- Periodic codes use, in order: the crystal cell applied in the ASE panel, the trajectory lattice, or an orthorhombic box of molecular extent + vacuum.
- **Edit templates** exposes every file as plain text with placeholders such as `{charge}`, `{mult}`, `{coords}`, `{cell_ang}`, `{qbox_atoms}`, `{qe_species}`, `{cp2k_kinds}` (full list in the panel). Pseudopotential and basis names in the Qbox, QE and CP2K templates are placeholders to adapt to your setup; check the `net_charge`/`delta_spin` conventions of your Qbox version.

## Electron desktop

The desktop app remains supported:

```sh
npm install
npm start
```

Activate the Python environment before launching Electron so its Python bridge can find ASE. Desktop mode uses native dialogs and writes results to the selected directory.

## Changes in MONET 2.0

- Day/night theme; plots and exports follow it.
- Fast trajectory engine (frame index, selective parsing), launcher uploads/jobs with progress and cancel, single-pass desktop extraction.
- Import of VASP, Quantum ESPRESSO (pw.x, cp.x), Qbox, ORCA, CP2K (DCD, `.cell`), CPMD `TRAJECTORY`, LAMMPS and more.
- Per-configuration inputs for Gaussian, ORCA, Qbox, QE, VASP and CP2K from editable templates.
- Kabsch RMSD, RMSD matrix, RDF, MSD/diffusion, VDOS, unwrapping, autocorrelation with τ and sampling stride; CSV export.
- Desktop Gaussian inputs now use a relative `%chk` file name, as the browser version always did.

## Validation

With the environment above active (or `PYTHON=.venv/bin/python`):

```sh
node tests/regression.cjs
node tests/qm-parity.cjs
node tests/formats.cjs
node tests/analysis.cjs
node tests/ase-integration.cjs
```

For the DOM/plot checks, install the optional test dependencies (not required by the app):

```sh
npm install --no-save jsdom @napi-rs/canvas
node tests/ase-ui.cjs
```

Current results (ASE 3.29.0, Python 3.14, Node 22): 39 regression, 20 QM-input parity, 29 format-import, 35 analysis, 84 live launcher and 82 DOM/plot checks. The analysis tests compare against synthetic trajectories with known answers (Kabsch on rigid motion, first-shell coordination of a simple cubic lattice, ideal-gas g(r), Brownian diffusion coefficient, a 1000 cm⁻¹ VDOS peak, τ of an Ornstein–Uhlenbeck torsion). The interface was also exercised in a live browser through the launcher; the packaged Electron GUI was not.

## Background (MONET v1)


The first intent of the MONET code is to be able to extract and post-process in a simple and reliable manner the trajectory of a selected set of atoms out of a trajectory file (for the moment it is compatible only with the .XYZ format from CPMD and CP2K). 

It is organized in blocks:

Block 1: it asks to select the trajectory file to process;

Block 2: it retrives the information from the file, like total # of atoms per frame and total # of configurations;

Block 2a: it asks with which frequency you want to sample the trajectory file;

Block 3: it asks if you want to compute the average structure out of the total trajectory file (NOT the sub-trajectory);

Block 4: it asks how many atom you want to extract and to enter the number of the ID atom associated with the position in the file (e.g. 1, 26, 352). These values can be found by opening the original file with a visualizer like VESTA and double-clicking on the selected atom;

Block 5: it asks if to proceed with the trajectory file extraction and subsequently it will create the folders for each frame, ranging from 1 to N, where N is equal to the # of configurations sample as defined in Block 2a from the frequency of extraction;

Block 6: finally it asks if to proceed with the formation of the correspoding Gaussian09 input files for the singlet and triplet states. 

The original idea of the code is to analyze the magnetic evolution in time of an open shell dimeric system of organic molecule-based magnets. 

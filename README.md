# MONET 2 — Molecular Dynamics Extractor with ASE and MDAnalysis

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22816521.svg)](https://doi.org/10.5281/zenodo.22816521)

MONET extracts configurations every N frames from molecular-dynamics trajectories, writes quantum-chemistry inputs for each sampled configuration and analyses the trajectory with ASE, MDAnalysis and MONET's own methods. It runs in a browser (with a local Python launcher) or as an Electron desktop app, in day or night mode (☀/☾ button in the title bar).

## Start MONET

MONET runs in your browser, with a small Python service on your own computer that provides ASE and MDAnalysis. There are no installers: download the code and start it with Python.

1. Install **Python 3.10 or newer** (<https://www.python.org/downloads/>; on Windows tick *Add python.exe to PATH*), or use conda (below).
2. Download MONET: on GitHub, **Code › Download ZIP** (or the ZIP of a release), and extract the whole folder.
3. Start it:
   - **macOS**: double-click `start_monet.command`. The first time, macOS may block a downloaded script: right-click it › **Open** › **Open**. If it does not run, open Terminal in the folder and type `bash start_monet.command`.
   - **Windows**: double-click `start_monet.bat`. If SmartScreen appears, choose **More info › Run anyway**.
   - **Linux**: run `./start_monet.command` in a terminal.

The first start creates a private environment (`.venv`) in the MONET folder and installs ASE and MDAnalysis from `requirements.txt` (internet needed once, a few minutes). Later starts open MONET at once; the requirements are reinstalled only when `requirements.txt` changes, e.g. after downloading a new version. Arguments are passed on, e.g. `start_monet.command --port 8766`; set `MONET_PYTHON` to choose a particular Python.

### With conda

```sh
conda env create -f environment.yml
conda activate monet
python start_monet.py
```

### Manual setup

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

## Analysis modules

After loading, the files are shared by four tabs, in the order of a typical study:

1. **ASE** — Structure (formula, masses, centre of mass, inertia, cell, volume, density, shortest distance, overlapping atoms, molecules, bonds per element pair, coordination numbers, space group with `spglib` if installed), bond lengths, bond angles, dihedrals, pair distances, coordination numbers along the trajectory, conversion to other formats and wrapping.
2. **MDAnalysis** — *Topology & consistency* (atom-identity check, below) and *Analyses*: `rms.RMSD` (with extra groups), pairwise RMSD matrix (`diffusionmap.DistanceMatrix` with `rms.rmsd`, optimal superposition of every pair), `rms.RMSF`, radius of gyration, `pca.PCA`, `msd.EinsteinMSD`, `gnm.GNMAnalysis`, `diffusionmap.DiffusionMap`, `align.AlignTraj` (aligned trajectory to download or to analyse in MONET), `HydrogenBondAnalysis` (occupancy table with MONET IDs), `contacts.Contacts`, `rdf.InterRDF`, centre-of-mass and minimum distances between groups, `atomicdistances`, `dihedrals.Dihedral` (−180…180°), `lineardensity`, `density.DensityAnalysis` (OpenDX file), `dihedrals.Ramachandran` and `dssp.DSSP` (proteins). Each analysis shows its own fields; **← picked** inserts the atoms selected in the viewer as `id …`.
3. **Custom analyses** — MONET's autocorrelation (decorrelation time and uncorrelated trajectory), fluctuations and trends, Kabsch RMSD, RMSD matrix, RDF, MSD/diffusion and VDOS.
4. **MONET processing** — 3D view, sampling, extraction and QM inputs.

The viewer, atom table, cell and time axis are common to the three analysis tabs.

Not included, because they need data an MD trajectory in XYZ form does not carry or tools that are not installed: ASE calculators, optimisers, MD engines and NEB (energies/forces); MDAnalysis modules that need charges, external programs, membranes or are deprecated (dielectric, HOLE2, leaflet finder, water dynamics, ENCORE/PSA, BAT, persistence length, helix and nucleic-acid analyses). Symmetry needs `spglib` (`python -m pip install spglib`).

### Atom identity across modules

The same atom has the same number everywhere: **MONET ID** (viewer, extraction, QM inputs) = ASE index + 1 in the original file = MDAnalysis `id` (`id 5 7` in selections; `index` is the 0-based position in the analysed file). After an extraction or a subsample the IDs of the original file are kept, and MDAnalysis receives them as ids. When a trajectory is loaded, *MDAnalysis › Topology & consistency* compares the MONET atom list with what ASE and MDAnalysis read from the same file (count, element, first-frame coordinates, ids) and marks any mismatch in red; residues and molecules found by MDAnalysis are added to the atom table. Topology labels (atom names, residues) come from imported files; for XYZ files each bonded molecule (bond cutoff of the viewer) is a residue named by its formula.

## Use the analysis panel

1. Click **Browse**, load an XYZ file, and click **Next**. The ASE badge should show its version.
2. The **ASE** tab opens. Analysis can run directly on the loaded XYZ; extraction is optional.
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

Drag to rotate, right-drag (or Shift-drag, handy on a trackpad) to move the structure, scroll to zoom, and click **Fit view** to reset the orientation and fit the molecule. Rotation gestures do not select atoms. For overlapping atoms, clicking picks the visible front atom; rotate to reach atoms behind it.

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

**Read cell from XYZ** inspects the active file, displays its existing vectors in their original orientation, and fills the six fields for inspection. The source cell remains active until **Apply cell** is clicked. **Use source cell** removes a manual override. Plain XYZ has no lattice: enter it manually, or use **Load cell from file (CIF …)**, which reads the six parameters from a CIF, POSCAR, PDB or the first row of a CP2K `.cell` file and applies them at once. A manually applied cell is constant across frames and retained after extraction of the same input, but resets on loading another input. Source extXYZ cells can vary frame by frame. Core extraction drops source lattice metadata; manually apply the appropriate constant cell if needed after extraction.

The **minimum-image** checkbox controls periodic bond lengths, pair distances, angles, dihedrals, and molecule selection. Periodic directions must also be enabled in the applied or source cell. RMSD is raw Cartesian displacement unless Kabsch alignment and/or unwrapping are enabled in the RMSD tab. Editing a cell field is a draft change until **Apply cell**; applying a cell or changing the image option clears previous analyses to prevent mixing geometries.

### Atoms outside the cell (e.g. CIF cell + XYZ trajectory)

A CIF only provides the cell metric: MONET builds the vectors with **a** along x and **b** in the xy plane. The XYZ coordinates keep the origin of the program that wrote them, so atoms usually lie partly outside the drawn box; the cell status reports what fraction does. This does not affect the analyses, which use the minimum image. To display the structure inside the box, use **Cell display** under the viewer:
- *wrap whole molecules*;
- *wrap atoms*;
- *centre selection*: the atoms selected when you tick it (all atoms if none) are moved to the cell centre in every frame. Picking more atoms afterwards does not move the view; untick and tick again to re-centre on a new selection.

To write the wrapped coordinates, use *Convert → Wrap and download*. If molecules still overlap after wrapping, the trajectory was written with different cell vectors (another orientation or setting). In that case, use the simulation cell (extended XYZ lattice, CP2K `.cell`) instead of the CIF metric.

### Trajectory player and dynamic analysis

The controls under the ASE viewer play the active trajectory:
- ⏮ ◀ ▶ ▶| ⏭ buttons and a frame slider;
- **Step** (show every n-th frame), **Speed** (fps) and **loop**;
- keyboard: Space plays or stops, ←/→ step; the viewer must have focus.

Frames are read in batches and cached (about 30 M numbers). Large systems (≥ 3000 atoms) keep the first-frame bonds during playback and drop the ones that stretch too far; the bonds are searched again when playback stops.

During playback:
- a dashed cursor follows the shown frame on the RMSD, bond, angle, dihedral and MDAnalysis time series, and clicking one of those plots jumps to that frame;
- with 2, 3 or 4 selected atoms, the distance, angle or dihedral of the shown frame is updated live, with the minimum image when it is enabled.

### Selection tools (both viewers)

Right-click an atom (in either viewer, or a row of the ASE atom table) for a menu; right-click empty space for the selection-only part:

- **atom**: select/deselect it, its molecule, it and its bonded neighbours, the atoms within R Å, every atom of its element;
- **selection**: add bonded neighbours, extend to whole molecules, add atoms within R Å, select all, invert, clear;
- **view**: centre on the selection, reset.

The same actions are in the toolbar under the ASE picks and in the Atom Selection step (element, All, Invert, + Bonded, + Molecules, + Within R). Connectivity and spheres come from ASE neighbour lists (`natural_cutoffs` × the molecule bond cutoff, default 1.2; minimum image when enabled, so molecules split across the cell are joined). Without ASE, the bonds drawn in the viewer and plain distances are used.

**Find bonded chains by element** (ASE panel) lists every bond, angle or dihedral whose elements match a pattern, e.g. `O H`, `H O H` (centre in the middle), `C C O H`; `*` matches any element, and each chain is reported once whichever direction matches. The groups are written to the geometry series, the autocorrelation or the fluctuation inputs, optionally only among the selected atoms.

A molecule selection replaces the previous picks, begins at the clicked atom, and follows graph traversal order. It is suitable for RMSD or pair-distance subsets. For angles and torsions, choose the desired atoms individually in bond order: a whole molecule’s graph order is not necessarily a valid analysis path.

Connectivity is inferred, not read as authoritative chemical bonds. Adjust the cutoff for unusual bonds or close contacts. A component connected to its own periodic copies (an extended network) is selected as a whole. Isolated atoms select just themselves. Only atoms in the active (possibly extracted) trajectory can be selected. Displayed sticks are a direct-coordinate visual estimate; periodic molecule detection uses ASE.

### Bond-angle and dihedral ranges

For an angle, select three MONET IDs, with the middle atom as the vertex. For a dihedral, select four IDs in bond order; the middle pair defines the torsion axis. Multiple groups can be entered. Choose the range, then **Compute**:

- **Bond angle 0–180°**: usual undirected spatial angle (default for bond angles).
- **0–360°**: native ASE torsions. For bond angles, specify a nonzero Cartesian **reference normal x y z**, default `0 0 1`. The spatial angle magnitude is preserved; the sign of `normal · ((r₁−r₂) × (r₃−r₂))` chooses θ or 360−θ. This is a hemisphere convention, not an angle projected onto a plane. An in-plane normal is rejected for non-collinear vectors; use a normal with a perpendicular component. Keep the reference choice physically consistent across the trajectory.
- **−90° to +90°, folded**: `((θ + 90) mod 180) − 90`, in [−90°, +90°). Thus +90° is shown as −90°, and values separated by 180° become indistinguishable. Bond angles fold the ordinary undirected 0–180° angle. This option is not a signed 360° torsion and loses orientation information.
- **0° to 180°, folded**: `θ mod 180`, in [0°, 180°). Same axial equivalence as above, but the edge lies at 0/180°, so torsions fluctuating around 90° (e.g. donor–acceptor twists) stay continuous. Choose the folded range whose edge is far from your values.

Plots and PNG exports use the selected range and labeled axes; when a value crosses the range edge, the trace continues from the opposite edge instead of drawing a spurious full-range line. Changing the convention clears the current angular result; recompute before downloading. Repeated IDs and undefined collinear torsions are rejected. `examples/torsion.xyz` produces 270° and 90° in full range, and −90° in both frames in folded mode.

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

### Pairwise RMSD matrices

*Custom analyses › RMSD Matrix* (Kabsch, NumPy) and *MDAnalysis › Pairwise RMSD matrix* (`DistanceMatrix`) plot the RMSD between every pair of analysed frames. Under each matrix choose the colour map (plasma, viridis, inferno, magma, coolwarm or the app theme), whether frame 0 is in the upper-left corner (as `matplotlib.imshow`) or the lower-left one, and a plot title, e.g. *S0 at 300 K (non-correlated)*. The axes show the original frame numbers. To compare non-correlated configurations, run the matrix on the uncorrelated trajectory from the autocorrelation tab, or use a frame step close to the decorrelation stride. The MDAnalysis version thins long runs to at most *Maximum frames* (500 by default) and reports the mean, SD and maximum off-diagonal RMSD; both versions agree within 0.002 Å on the test trajectories.

### Fluctuations and trends

*Custom analyses › Fluctuations & trends* maps how atoms, bonds, angles and dihedrals oscillate during the run:

- **Items**: every bond, angle or dihedral found from the first-frame connectivity (bond cutoff of the viewer) among the atoms entered (blank = all), or only the groups entered (MONET IDs, in order). *Atoms* gives the positional fluctuation of each atom after removing global translation and rotation (periodic runs are unwrapped first).
- **Statistics per item**: mean; SD (RMSF for atoms, circular SD for dihedrals); minimum and maximum; 5–95 % range; linear trend with its error and R²; drift between the second and first half of the run; standard error from five block averages; dominant oscillation frequency (cm⁻¹ with the time axis set, otherwise its period in frames) and its share of the spectral power. A trend is marked *significant* when the five block means follow a line beyond three times the error of their slope and the change over the run exceeds 10 % of the SD, so fast oscillations are not mistaken for drift.
- **Views**: a bar chart and a colour map on the molecule (atoms coloured by value, or bonds/angles/dihedrals drawn as coloured paths with a colour bar) for the chosen quantity: SD, range, |trend|, |drift|, frequency or mean. The table can be sorted by any column; clicking a row highlights the atoms and plots its time series with the mean, ±SD and the trend line. The statistics can be downloaded as CSV.

Dihedrals use the ASE 0–360° convention with circular statistics, so torsions crossing 0/360° are not split. Minimum-image geometry follows the cell settings.

### RDF

Normalised g(r) and the running coordination number n(r) for an element pair (or all atoms, optionally restricted to selected IDs), averaged over frames with minimum-image distances. A complete periodic cell is required; R<sub>max</sub> is limited to half the smallest perpendicular cell width. Unlike *Pair Distances* (raw counts), g(r) → 1 for an uncorrelated liquid.

### MSD and diffusion

Positions are unwrapped with minimum-image steps (keep the frame step small enough that atoms move less than half a cell between analysed frames; a warning is shown otherwise), the centre-of-geometry drift can be removed, and MSD(t) is averaged over all time origins (FFT algorithm). D = slope / 6 from a linear fit in the chosen window (default 10–50 % of the run), reported in cm²/s and Å²/fs, for the selection and per element.

### VDOS

Fourier transform of finite-difference velocities (Hann window, optional mass weighting and Gaussian smoothing), normalised to unit area. Save frames every MD step (or few steps) for accurate high frequencies; the Nyquist limit and resolution are shown.

### Autocorrelation and decorrelation stride

Choose a dihedral, bond angle, bond length or RMSD and one or more atom groups (averaged). MONET computes

- the normalised fluctuation autocorrelation C(t) = ⟨δx(0)δx(t)⟩/⟨δx²⟩, with dihedrals unwrapped across 0/360° first;
- or, for angles, the **circular** autocorrelation of the unit vector z = e^{ikθ} with its mean removed, Re⟨δz*(0)δz(t)⟩/⟨|δz|²⟩. It decays to zero like the linear one. The raw ⟨cos[θ(t)−θ(0)]⟩ only drops to R² for a confined torsion, so its τ is meaningless;
- **Dihedral range** *0–180° folded* uses period 180°, so jumps between equivalent orientations (θ ↔ θ+180°) do not decorrelate the signal. The distribution and statistics then also use 0–180°;
- τ from a fit of exp(−t/τ) (up to the first zero crossing, three 1/e times or the whole lag range) with its standard error, and the integrated τ_int with the chosen estimator (below);
- **τ_int estimator:**
  - *Sokal window* (default): the smallest M with M ≥ 5 τ_int(M);
  - *Geyer* initial monotone sequence;
  - *first zero crossing* (MONET ≤ 2.1).

  MONET shows τ_int ± its error, τ_int·√(2(2M+1)/N), and the window M.
- **Run length:** T in units of τ. There is a warning below 20 τ and a note below 50 τ.
- **Residual correlation of the sampled configurations:** g = 1 + 2 Σ C(j·stride), and N_eff = kept/g.
- **Block averaging** (Flyvbjerg–Petersen) under the ACF plot: SEM against block length, with its plateau and the ACF SEM for comparison.
- **Detect equilibration** (Chodera 2016): N_eff(t₀) = (N − t₀)/g(t₀) for origins in the first half of the run. The largest value gives the start of production; ✂ *Use the production window* writes it as a new active trajectory, with `source_frame` kept and ↩ Full trajectory to go back.
- the (circular) mean, standard deviation and a correlation-corrected standard error of the quantity (its distribution and fits are in the Bond / Angle / Dihedral / RMSD tabs).

The **MD time step** (fs, a.u. or ps) and the **MD steps per saved frame** can be entered at the top of the ACF, MSD and VDOS panels or in the *Time axis* row: all copies share the same value, and a missing time step is highlighted in red. **Zoom:** drag across the ACF plot (or any time series) to zoom on a lag or frame window, and double-click to show everything again. *Show lags up to (fs)* sets the window numerically, and *Reset zoom* clears it. The y axis rescales to the visible part, and the exported PNG shows the zoomed view, while the CSV always contains all points. The lag range defaults to half of the run: longer lags are averaged over too few time origins, and their noisy tail would hide the decay. *Max lag (fs)* changes that limit for the calculation itself, not only the view: the ACF is computed only up to that lag, so a shorter value speeds up long runs. It also bounds the fit window and the τ_int window (Sokal, Geyer or first zero crossing), so set it well beyond the decay, at several τ, or τ_int is underestimated. Missing inputs (time step, atom IDs) are reported inside the panel.

### Plateau of the ACF and uncorrelated trajectory

*Autocorrelation* is the first tab of the module, because the decorrelation time decides which configurations are worth analysing.

**1. Fit model.** Choose one:
- `exp(−t/τ)`, with plateau 0;
- `(1 − c)·exp(−t/τ) + c`, which fits an asymptotic plateau c (use it when the ACF levels off above zero).

**2. Plateau point.** After every calculation MONET computes where the fitted curve reaches its plateau within a tolerance ε:

t* = τ·ln(1/ε), i.e. 3.0 τ for ε = 5 %, 4.6 τ for 1 %.

t* is drawn as a dashed line on the ACF plot and shown in a validation box, together with the resulting stride in saved frames and the number of configurations that will be kept.

**3. Validation.** Check t* against the curve. You can change ε, type τ by hand, or type another t*.

**4. Accept t\* and build the uncorrelated trajectory.** This writes an extended XYZ file with one frame every ⌈t*/Δt⌉ saved frames:
- frames are copied byte for byte (lattice and atom columns kept);
- each comment line gets `source_frame=<index>`, which always refers to the original run, even when an uncorrelated file is subsampled again;
- the file can be downloaded;
- with *analyse it in MONET right away* (default), it becomes the active trajectory for every analysis and for the extraction. *MD steps per saved frame* is multiplied by the stride, so the time axis stays physical, and the extraction frequency is set to 1.

**↩ Full trajectory** (module header) switches back. *Only set the sampling frequency* copies the stride to step 02 and keeps the full trajectory.

τ is converted into MD steps and saved frames with the time axis you set; you can also type τ yourself and choose a safety factor. **Use as sampling frequency** copies the suggested stride into step 02, so the extracted configurations are statistically independent. Example: with a 0.4838 fs time step (20 a.u.) and τ = 43.6 fs, sampling every ≈ 90 MD steps gives non-correlated configurations; your own τ and time step will differ.

### Mean values and distributions

The legends of RMSD, bond-length, bond-angle and dihedral plots show the mean ± standard deviation of each series. The ± value is the **spread** of the distribution, not the uncertainty of the mean.

For periodic ranges MONET uses Mardia's circular statistics:
- the mean resultant length is R = |⟨e^{ikθ}⟩|, with k = 2π/P and P = 360° or 180° (folded ranges);
- the circular standard deviation is σ = √(−2 ln R)/k, with no n−1 correction.

The note above the plot adds R and the **standard error of the mean**, corrected for time correlation in the same way as the autocorrelation panel:
1. τ_int is the integral of the normalised ACF of the deviations from the mean, measured in analysed frames, with Sokal's self-consistent window (the smallest M with M ≥ 5 τ_int(M), lags up to half the series) — the same estimator and default lag range as the Autocorrelation panel;
2. N_eff = N/(2τ_int);
3. SEM = σ/√N_eff.

The SEM is the quantity to compare with the error on the centre of a Gaussian fitted to the probability density. That fit error ignores time correlation, so it is usually smaller. Dihedrals and directed or folded angles use circular statistics consistent with the chosen range (e.g. 350° and 10° average to 0°, not 180°). Below each RMSD, bond-length, bond-angle and dihedral time series there is a second plot, **Distribution**: the probability-density histogram (its own bins) over the angular range, with the mean in the legend and the optional fit described below.

**Fit** (distribution plot) fits each histogram by least squares. The models are:
- **Gaussian**; on angles it uses the periodic distance, so a peak across 0°/180° is handled. It also reports FWHM = 2√(2 ln 2)·σ;
- **Lorentzian**, A/[1 + ((x−μ)/γ)²], with γ the half width at half maximum (FWHM = 2γ);
- **pseudo-Voigt**, η·L + (1−η)·G with a common FWHM: η → 0 is Gaussian, η → 1 is Lorentzian;
- **von Mises**, A·exp[κ(cos k(θ−μ) − 1)], for periodic ranges; it also reports the circular σ derived from κ;
- **two Gaussians**, which also reports the weight of each component.

**Fit range** (two bin centres) restricts the fit to one peak; on angles it wraps when the first value is larger.

The fitted curve is drawn dashed and exported in the CSV. The note lists every parameter ± its error and R². The errors come from the covariance (JᵀJ)⁻¹·χ²/(n−p), as with `scipy.optimize.curve_fit`. They treat the bins as independent and ignore the time correlation of MD frames, so they are usually smaller than the correlation-corrected standard error of the mean.

Two further views show every frame as a dot:

- **Show → dot histogram** (RMSD, bonds, angles, dihedrals): the frames of each bin are stacked as dots, and a dashed line marks the mean of each series. When a column is too tall, one dot stands for several frames; the y-axis label says how many.
- **Show → polar plot** (angles and dihedrals) is the PCCP-style figure. It uses a half circle for 0–180° and for the folded ranges, and a full circle for 0–360°. The radius can be:
  - *stacked dots*: counts per angular bin;
  - *frame index*;
  - *custom values*: pasted as one value per computed frame, or as `frame value` pairs. An example is the ΔE<sub>ST</sub> of each sampled configuration, which gives the ΔE<sub>ST</sub>-vs-torsion plot of the paper.

  Dashed rays mark the circular mean of each series. **Reference** adds one or more marked directions with a label, e.g. `84.3` with the label `θExp`.

The PNG export keeps the aspect of the circle. The CSV export lists the angle, plus the radial value when there is one, for each frame.

### MDAnalysis

With [MDAnalysis](https://www.mdanalysis.org/) installed (included in `requirements.txt`), MONET uses it only for what ASE does not provide, so the two libraries never compute the same quantity:

- **Selections**: *Select with MDAnalysis syntax* (e.g. `resname SOL and name OW`, `resid 1:5`, `around 3.5 resname LIG`) fills the ASE picks with the matching MONET IDs.
- **MDAnalysis tab**: the analyses listed under *Analysis modules*, on the same trajectory, cell and frame step as the other tabs.
- Residues and atom names come from the imported topology. For XYZ trajectories each bonded molecule becomes a residue named by its formula (`resname H2O`, `resname C20H22N2O2` …). Periodic cells are passed to MDAnalysis for minimum-image distances.

### Unwrap, wrap and data export

*Convert → Unwrap and download* writes an extended XYZ copy with continuous atom paths. *Convert → Wrap and download* does the opposite, and is useful for periodic QM inputs:
- **whole molecules**: MONET rebuilds molecules split by the boundary (every atom follows its bonded neighbour by the minimum image), then moves each molecule so that its centroid lies inside the cell;
- **atoms**: every atom is moved into the cell;
- **centre on selected atoms**: optionally, the atoms picked in the viewer are first moved to the cell centre. Every plot has **Download plot PNG** (2400 px wide, current theme) and **Download data CSV**.

### Analysis history, console and replay

MONET keeps a text log of every step that changes a result. The log contains:
- the input file, with its SHA-256;
- the cell and the time axis;
- each analysis, with its parameters and key numbers;
- derived trajectories, extraction and exports.

View-only actions such as rotating, zooming or changing colours are not logged. The log stays on your computer: the launcher autosaves it in `~/.monet/sessions/` (change the folder with `--sessions-dir`), and it stores file names, never full paths.

Open **History** (Ctrl+`) for the drawer:

- **Console:**
  - Each step appears as a call, for example `acf(quantity="dihedral", groups=[[228, 227, 289, 225]], dt=0.4838, tau_int_method="sokal")`.
  - Click a line, edit it and press Enter. The analysis runs again through its panel, with the same checks as the Run button, and the new step is linked to the original.
  - `help()` lists the analyses; `help(acf)` lists the parameters of one.
  - Atoms are MONET IDs; `dt` comes from the time axis.
- **History:**
  - filters, details and parent chains (e.g. `S1 → #9 subsample → S2`);
  - a note and a ☆ *final* mark on each step;
  - *History: on / paused*: while paused, nothing is logged, and the report and `replay.py` warn about the gap.
- **Save session:** a ZIP containing:
  - `session.json`;
  - `methods.md`, and `methods.docx` when pandoc is installed. The report lists the software versions with citations, the input checksums and the steps, and pre-fills the reporting checklist of `docs/md-analysis-workflow.md` §12.
  - `replay.py`.
- **Open session:**
  - It restores a saved log read-only and never re-runs anything. While it stays read-only, no analysis runs until its trajectory is loaded.
  - Opening a session starts a fork: the restored copy gets a new creation time (`forked_from` records the one it was opened from), so it is autosaved to its own file and never overwrites the history it came from.
  - Load the trajectory with the same SHA-256 to continue it.
  - Loading a trajectory also offers its previous autosaved history.
- **replay.py:**
  - Run `python replay.py --monet /path/to/MONET` in the folder that holds the trajectory.
  - It checks the input checksums (`--force` skips this), re-runs each step headless, writes `stepNN_<action>.json` to `--out`, and compares the logged raw numbers (τ, τ_int, t₀, D, frame counts, …), printing `OK` or `DIFF` against them (`--rtol`, default 1e-6). Steps with nothing raw logged to compare (bond/angle/dihedral series, whose report values are statistics such as a mean) print `RAN` instead of a false `OK`.
  - Session files are shareable; every value in one is untrusted. replay.py embeds them only as safe literals or single-line comments, never as executable code, so a crafted or shared session file cannot inject code into the generated script.
  - Edit it like a notebook.

## Convert

Open **Convert**, browse for an XYZ input, choose the output format, and set the download filename. **Convert first frame only** is enabled by default for compatibility with formats that store one structure. Click **Convert**, then **Download converted file**.

For multi-frame extXYZ or JSON output, uncheck the first-frame option. For a plain XYZ, apply a crystal cell and enable **Apply the manual crystal cell above to this conversion input**. This is explicit because conversion may use a different file. Otherwise conversion retains the input file’s own cell. VASP requires a complete cell. Quantum ESPRESSO conversion is not implemented because this panel does not collect pseudopotential settings. Gaussian uses ASE's `gaussian-in` writer.

If ASE is unavailable, the panel shows the connection or installation error. Install dependencies using the same Python environment used by the launcher, then click **Recheck ASE connection**. If the connection disappears, restart the launcher and reload its page.

## Core extraction workflow

The structure is analysed **before** the extraction:

1. **File input** — Browse for a trajectory and choose the input format (see below). XYZ/extXYZ files are read directly; other formats are imported first.
2. **Structure analysis** — MONET reports frames and atoms and opens the ASE/MDAnalysis module. The workflow panel folds into a narrow rail so the molecular viewer and the analyses use the full window (⇥ reopens it). The Autocorrelation tab can set the sampling frequency, and atoms picked in the ASE viewer can be reused for the extraction.
3. **Sampling** — choose the sampling frequency (every N-th frame). *Extraction →* (rail, ASE header or step 02) continues here.
4. **Atom selection** — click atoms in the 3D view, type MONET IDs, or *Use atoms picked in the ASE analysis*.
5. **Options** — average structure and quantum-chemistry inputs.
6. **Processing** — progress, log and Cancel.
7. **Results** — download the ZIP (browser) or open the chosen folder (desktop).

Output tree: `0-HISTORY/run.json`, `1-FULL_TRAJECTORY_EXTRACTED/FULL_TRAJECTORY_EXTRACTED.xyz` (selected atoms, every frame), `2-SAMPLED_CONFIGURATIONS/` (`SAMPLED_CONFIGURATIONS.xyz` and `confN/posN.txt` plus inputs), `3-AVERAGE_STRUCTURE/GEO-AVERAGE.xyz` (all atoms, all frames, simple Cartesian average). Coordinates are written with 7 decimals; the JavaScript and Python engines produce identical files.

XYZ frames must keep a constant atom count and element order. Extended XYZ `species`/`pos` properties and `Lattice`/`pbc` are read; other per-atom properties are not carried into the extracted files.

### Molecular viewers

Both viewers (3D View and the ASE module) offer **Balls & sticks**, **Sticks (licorice)**, **Space-filling (vdW)**, **Lines** and **Points**; the choice is remembered per viewer. The ASE viewer size can be *Compact*, *Large* or *Full height*.

Large systems stay responsive: bonds are found with a spatial grid (linear in the number of atoms, instead of comparing every pair), atoms are drawn from cached sphere images, bonds are drawn in one batch per colour, redraws are coalesced to the display refresh, and systems above 2,500 atoms switch to a line representation while rotating. On a 14,046-atom box a full redraw takes about 50–80 ms with spheres and 3–9 ms with lines or points (Chrome, Apple silicon). Atom-ID labels are shown only for systems up to 300 atoms and for selected atoms.

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
| CIF, POSCAR, PDB … as cell file (optional) | Attaches one fixed cell to every frame of an XYZ (or CPMD/cp.x) trajectory. For a CIF only the `_cell_length_*` and `_cell_angle_*` entries are read (uncertainties in brackets are dropped), so disordered or symmetry-reduced structures work. The cell is written with a along x and b in the xy plane. |
| VASP XDATCAR, OUTCAR, vasprun.xml, POSCAR/CONTCAR | via ASE |
| Quantum ESPRESSO pw.x output | every ionic step (relax/MD), via ASE |
| Quantum ESPRESSO cp.x `.pos` (+ `.cel`) | bohr → Å; needs a reference structure; choose whether `.cel` rows or columns are the lattice vectors |
| Qbox output (`.r`/XML) | every `<iteration>`; positions and cell converted from bohr (ASE 3.29 leaves them in bohr) |
| ORCA output | every `CARTESIAN COORDINATES (ANGSTROEM)` block |
| CP2K DCD | needs a reference structure for element names |
| CPMD `TRAJECTORY` | `step x y z vx vy vz` in bohr; restart markers skipped; needs a reference structure |
| LAMMPS text dump, ASE `.traj`, CIF, Gaussian output | via ASE |
| **Any other ASE-readable format** | listed under *All ASE-readable formats* (loaded from the installed ASE) |
| GROMACS **XTC**, **TRR** | via MDAnalysis; add the topology (GRO, PDB, TPR …) as reference structure |
| CHARMM/NAMD DCD, AMBER NetCDF | via MDAnalysis with a topology (PSF, PDB, PRMTOP …); CP2K DCD files are recognised and read with ASE |
| XTC/TRR/DCD/NetCDF **without topology** | Imported with every atom as element **X**. Coordinates and cell are kept, so distances, angles, dihedrals, RMSD, MSD and unwrapping work. Masses, element-based RDF, selections by name and bonds in the viewer are not available; a warning says so after loading. |
| GROMACS GRO, multi-model PDB, LAMMPS dump, other MDAnalysis formats | via MDAnalysis |

Each selected file (trajectory, reference, cell file) has a **×** button to remove it if it was chosen by mistake.

*Auto-detect* uses the file name and content. Imported data are written to extended XYZ (with `Lattice`, `pbc` and `source_step` when available) and then processed like any XYZ file. Importing needs the launcher or the desktop app with Python/ASE. The **reference structure** is any file ASE or MDAnalysis can read (e.g. the first frame as XYZ, or a GRO/PDB/TPR topology) with the same atom order as the trajectory. Topology labels (residue name, residue id, atom name) are stored as extra extended-XYZ columns so that MDAnalysis selections keep working after the import.

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

Activate the Python environment before launching Electron so its Python bridge can find ASE. Desktop mode uses native dialogs and writes results to the selected directory. It is meant for development: no packaged desktop installers are distributed, because the analyses need a Python environment anyway.

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## Validation

With the environment above active (or `PYTHON=.venv/bin/python`):

```sh
node tests/regression.cjs
node tests/qm-parity.cjs
node tests/formats.cjs
node tests/analysis.cjs
node tests/mdanalysis.cjs
node tests/ase-integration.cjs
```

For the DOM/plot checks, install the optional test dependencies (not required by the app):

```sh
npm install --no-save jsdom @napi-rs/canvas
node tests/ase-ui.cjs
```

Current results (ASE 3.29.0, MDAnalysis 2.10.0, Python 3.14, Node 22): 48 regression, 20 QM-input parity, 38 format-import, 73 analysis, 65 MDAnalysis, 86 live launcher and 261 DOM/plot checks. The analysis tests compare against synthetic trajectories with known answers (Kabsch on rigid motion, first-shell coordination of a simple cubic lattice, ideal-gas g(r), Brownian diffusion coefficient, a 1000 cm⁻¹ VDOS peak, τ of an Ornstein–Uhlenbeck torsion). The interface was also exercised in a live browser through the launcher; the packaged Electron GUI was not.

## Citing and licences

**How to cite MONET**: GitHub shows a *Cite this repository* button generated from [`CITATION.cff`](CITATION.cff). Please cite the software — T. Francese, *MONET: Molecular Dynamics Extractor*, the version you used (shown in the title bar), Zenodo, doi:[10.5281/zenodo.22816521](https://doi.org/10.5281/zenodo.22816521) (all versions; each release also has its own DOI on the Zenodo page) — together with the PCCP 2022 article (doi:[10.1039/d2cp01147f](https://doi.org/10.1039/d2cp01147f)) and the libraries of the analyses you used, listed below.

**MONET licence**: MIT, see [`LICENSE`](LICENSE).

MONET calls ASE and MDAnalysis as separate, user-installed Python packages; it does not copy or modify their code. If results obtained with MONET are published, cite the libraries behind the analyses you used.

### ASE — Atomic Simulation Environment

- **Licence**: GNU LGPL 2.1 or later (`LGPL-2.1-or-later`). Source: <https://gitlab.com/ase/ase>.
- **Used for**: reading and writing trajectories and structures (XYZ/extXYZ, CIF, POSCAR, VASP, Quantum ESPRESSO, Qbox, ORCA, CP2K …), cells and minimum-image geometry, bond lengths, angles, dihedrals, pair distances, connectivity (`natural_cutoffs`, `neighbor_list`), structure summary, coordination numbers and format conversion.
- **Cite**: A. Hjorth Larsen *et al.*, “The atomic simulation environment — a Python library for working with atoms”, *J. Phys.: Condens. Matter* **29**, 273002 (2017), doi:[10.1088/1361-648X/aa680e](https://doi.org/10.1088/1361-648X/aa680e).
- Covalent radii used for bonds (ASE `covalent_radii`): B. Cordero *et al.*, *Dalton Trans.* 2832–2838 (2008), doi:[10.1039/B801115J](https://doi.org/10.1039/B801115J).
- Space groups (only if `spglib` is installed; BSD-3-Clause): A. Togo, K. Shinohara, I. Tanaka, *Sci. Technol. Adv. Mater.: Methods* **4**, 2384822 (2024), doi:[10.1080/27660400.2024.2384822](https://doi.org/10.1080/27660400.2024.2384822).

### MDAnalysis

- **Licence**: the package is distributed under the GNU LGPL 3 or later (`LGPLv3+`); contributions are made under LGPL 2.1 or later. MONET requires MDAnalysis ≥ 2.8, the first release under the LGPL (earlier releases were GPL 2 or later). Source: <https://github.com/MDAnalysis/mdanalysis>.
- **Used for**: XTC/TRR/DCD/NetCDF/GRO/PDB import with topologies, the selection language, the atom-identity check and every analysis in the *MDAnalysis* tab.
- **Always cite both**:
  - R. J. Gowers *et al.*, “MDAnalysis: A Python package for the rapid analysis of molecular dynamics simulations”, *Proc. 15th Python in Science Conf.* 98–105 (2016), doi:[10.25080/Majora-629e541a-00e](https://doi.org/10.25080/Majora-629e541a-00e).
  - N. Michaud-Agrawal, E. J. Denning, T. B. Woolf, O. Beckstein, “MDAnalysis: A toolkit for the analysis of molecular dynamics simulations”, *J. Comput. Chem.* **32**, 2319–2327 (2011), doi:[10.1002/jcc.21787](https://doi.org/10.1002/jcc.21787).
- **Also cite, depending on the analysis** (references declared by MDAnalysis itself):
  - RMSD, pairwise RMSD matrix, RMSF with alignment and AlignTraj (QCP superposition): D. L. Theobald, *Acta Cryst.* **A61**, 478–480 (2005), doi:[10.1107/S0108767305015266](https://doi.org/10.1107/S0108767305015266); P. Liu, D. K. Agrafiotis, D. L. Theobald, *J. Comput. Chem.* **31**, 1561–1563 (2010), doi:[10.1002/jcc.21439](https://doi.org/10.1002/jcc.21439).
  - Hydrogen bonds: P. Smith, R. M. Ziolek, E. Gazzarrini, D. M. Owen, C. D. Lorenz, *Phys. Chem. Chem. Phys.* **21**, 9285–9295 (2019), doi:[10.1039/C9CP01532A](https://doi.org/10.1039/C9CP01532A).
  - DSSP: W. Kabsch, C. Sander, *Biopolymers* **22**, 2577–2637 (1983), doi:[10.1002/bip.360221211](https://doi.org/10.1002/bip.360221211).
  - Native contacts, diffusion maps, GNM and PCA follow the methods named in the MDAnalysis documentation of each module (<https://docs.mdanalysis.org>); cite the original method papers listed there when you report those results.

### Other components

| Component | Licence | Role |
|---|---|---|
| NumPy | BSD-3-Clause (with bundled MIT/Zlib/0BSD/CC0 parts) | arrays, FFT, linear algebra — cite C. R. Harris *et al.*, *Nature* **585**, 357 (2020), doi:[10.1038/s41586-020-2649-2](https://doi.org/10.1038/s41586-020-2649-2) |
| SciPy | BSD-3-Clause | connected components, sparse graphs — cite P. Virtanen *et al.*, *Nat. Methods* **17**, 261 (2020), doi:[10.1038/s41592-019-0686-2](https://doi.org/10.1038/s41592-019-0686-2) |
| Electron (desktop app only) | MIT; bundles Chromium and Node.js under their own licences | desktop window |
| jsdom, @napi-rs/canvas | MIT | test suites only, not shipped |

MONET's own analyses (Kabsch RMSD and RMSD matrix, RDF, MSD/diffusion, VDOS, autocorrelation and decorrelation stride, fluctuations and trends, histogram fits, periodic wrapping) are implemented in this repository with NumPy/SciPy. For the decorrelation workflow, cite the study that introduced it: T. Francese, A. Kundu, F. Gygi, G. Galli, “Quantum simulations of thermally activated delayed fluorescence in an all-organic emitter”, *Phys. Chem. Chem. Phys.* **24**, 10101 (2022), doi:[10.1039/d2cp01147f](https://doi.org/10.1039/d2cp01147f).

**Licence compatibility.** MONET is distributed under the MIT licence. Using LGPL libraries as separately installed dependencies is compatible with MIT: MONET does not include their code, and users install and can replace them freely (`requirements.txt`). MONET is distributed as source code only, so no LGPL code is redistributed with it.

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

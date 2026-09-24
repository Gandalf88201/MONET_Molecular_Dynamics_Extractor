# Changelog

## Unreleased

- Fluctuations & trends:
  - Fix: the statistics table collapsed to zero height, so no row could be clicked and the time-series panel below (*Click a row of the table …*) stayed empty. The table is now shown (up to 320 px, scrollable) and clicking a row plots the time series with mean, ±SD and trend line.
  - Atoms: anisotropic displacement ellipsoids on the structure. The mean-square displacement tensor of each atom, in the axes of the first frame, is drawn as a translucent ellipsoid (50, 90 or 99 % probability, optional magnification), coloured like the map, with or without the atom colour map. U11 … U23 are added to the statistics CSV.
  - A failed calculation is reported next to the plot as well as in the status bar.
- New plugin `plugins/displacement_ellipsoids.py` (*MONET Custom Functionalities › More analyses*): thermal ellipsoids (anisotropic displacement parameters) from the trajectory, written as a PDB with `ANISOU` records (Cartesian axes of the first frame) or as a CIF with U^ij in the crystal axes (IUCr convention, P1) for Mercury, VESTA, Olex2, PyMOL or ORTEP. Table of U_eq, U_ij, principal RMS amplitudes and anisotropy.
- Plugin API: `ctx.atom_ids` gives the MONET ID of every atom, for labels in written files.
- The thermal ellipsoids plugin is self-contained: it also runs when copied into MONET 2.3.1 (it failed there with `AttributeError: module 'monet_analysis' has no attribute 'displacement_tensors'`). Long trajectories are aligned in blocks of 2000 frames.
- Failed analyses (MDAnalysis and *More analyses*) are shown in their panel: the reason in one line, the plugin file when a plugin failed, and the Python traceback folded below. The status bar gets only the one-line reason instead of the whole traceback.

## 2.3.1 (2026-09-24)

- 3D view without a trajectory: only the *Load a trajectory file to begin* message is shown. The viewer title, style menu and hints appear with the first frame, and the message no longer covers the header half-transparently.
- Fix: after switching from an analysis module back to the 3D view, the viewer could keep the resolution of the narrower layout and draw stretched atoms. Canvases and plots are now redrawn whenever the viewer area changes size.

## 2.3.0 (2026-09-24)

- Interface:
  - *MONET processing* is renamed *MONET Custom Functionalities* and holds the former *Custom analyses* tab. Its first sub-tab, *3D viewer & extraction*, is the 3D view; the other sub-tabs are the custom analyses.
  - The interface uses the system sans-serif font. Code, logs, consoles and QM input files use a monospace font, and numbers keep aligned digits.
  - The selected module tab and sub-tab are filled, bold and underlined, so the active one is clear.
- MDAnalysis PCA:
  - up to 10 principal components come back from one calculation, and the component list (variance, explained and cumulated %, mean ± std) chooses which projections are plotted; *Components plotted at first* sets how many are ticked;
  - a distribution chart shows the plotted projections on common bins;
  - configurations can be picked in three ways:
    - a projection window on one component, optionally combined with a second window on another component. Click a bar of the distribution to set it, or Shift-click to widen it;
    - the N lowest and highest projections of a component;
    - a frame list, typed or built by Shift-clicking the projection plot or with *+ shown frame*.

    A minimum spacing in frames (e.g. the ACF stride) keeps them independent. Picked frames are marked on the plot and listed; clicking a row shows that frame in the viewer.
  - *Write the selected configurations* saves them as extended XYZ, each comment line keeping `source_frame=`. *Use them for the extraction* makes them the active trajectory, and ↩ Full trajectory goes back.
- `subsample` also accepts an explicit `frames` list. It is recorded in the analysis history, in replay and in the methods report.
- A trajectory of picked, unevenly spaced frames has no time axis: MSD, VDOS and the autocorrelation ask for the full trajectory.
- Extraction from a derived trajectory (uncorrelated, cropped, PCA selection) writes `frame N source_frame=M` in FULL_TRAJECTORY_EXTRACTED.xyz and SAMPLED_CONFIGURATIONS.xyz, so every configuration can be traced to its frame in the original run. The Python, desktop and browser engines all do this; files without `source_frame=` are unchanged.
- Fix: a cell applied by hand or read from a cell file (e.g. a CIF) was dropped when a derived trajectory (uncorrelated, cropped, aligned, PCA selection) became active. It now follows the derived trajectory and comes back with ↩ Full trajectory, so plane-wave inputs (QE, VASP, CP2K, Qbox) keep it.

- Analysis registry and plugins (`monet_registry.py`, guide in `docs/plugins.md`):
  - an analysis is a Python function decorated with `@analysis`; MONET builds its form from the declared parameters, checks the values (ranges, choices, atoms inside the trajectory, unknown names), runs it on the active trajectory, plots the result (series, profile, matrix or table, with PNG/CSV export), logs it in the history and replays it with `replay.py`. No JavaScript or launcher change is needed.
  - plugins are loaded from `plugins/`, `~/.monet/plugins/`, the folders in `MONET_PLUGINS` and installed packages with the `monet.analyses` entry point; a plugin that fails to load is reported in the interface without stopping MONET.
  - ASE and MONET Custom Functionalities get a *More analyses* sub-tab when plugins are installed; two examples ship in `plugins/`: cell volume, mass density and lattice lengths per frame (ASE), and radius of gyration (Custom).
  - the MDAnalysis analyses moved into the registry (`monet_analyses/mdanalysis.py`); their form, menu and checks now come from Python, and MDAnalysis plugins join the same menu. Saved sessions and replay scripts using `mda_run` keep working.
  - new bridge actions `list_analyses` and `run_analysis`; the console accepts `run_analysis(analysis="custom.radius_of_gyration", params={...})` with MONET IDs.
  - analyses may write a file (e.g. the density grid) or a trajectory; the launcher offers it for download and, for trajectories, as the next active trajectory.
- Launcher:
  - calculations run on persistent Python workers (`ase_bridge.py --serve`): libraries and trajectory indexes stay loaded, so after the first request a frame read takes about 1 ms instead of about 0.5 s. A worker starts in the background when the launcher starts; a cancelled calculation stops its worker.
  - session files are deleted as soon as nothing uses them: released trajectories, derived copies (unwrapped, aligned, uncorrelated) once their download is gone, and job folders that produced nothing. Only the 40 newest downloads are kept.
  - the job limit is checked before a calculation starts, so a refused request no longer starts Python.
  - download links no longer contain the session token; the random download ID is the permission for that file.
- Desktop app (Electron): extraction now runs on the Python engine of the launcher (`monet_io.extract`) instead of a separate JavaScript copy, and ASE/MDAnalysis calls use the same persistent workers (`bridge-worker.js`). Gaussian inputs written by the desktop app use `%chk=s0.chk` like the other engines (they had an absolute local path). Electron is updated from 28 to 44. The desktop app needs Python 3 with numpy on PATH for extraction.
- Fixes and hardening:
  - the trajectory index cache moved from the shared temp folder to a per-user folder (`~/.cache/monet/index`, or `$MONET_CACHE_DIR`); cache files with unexpected content are ignored, and index files unused for 30 days are deleted.
  - element guessing for topologies without elements: atom names of standard residues (amino acids, nucleotides, water) use their first letter, so `CA` is a carbon, not calcium (`HG`, `NE`, `CD` likewise).
  - the aligned trajectory (MDAnalysis › Align) no longer breaks its extended-XYZ comment line when the selection contains double quotes.
  - *RMSD Matrix* no longer reports "truncated" when the trajectory has exactly the maximum number of frames.
  - module tabs and sub-tabs are announced as tabs to screen readers, with the selected one marked (`aria-selected`).
  - `renderer.js` (4,500 lines) is split into eight page scripts loaded in order (`app-core.js`, `app-workflow.js`, `app-analysis.js`, `app-geometry.js`, `app-mdanalysis.js`, `app-structure.js`, `app-history.js`, `app-start.js`); the code is moved unchanged. `tests/app-load.cjs` loads them as separate scripts, as a browser does, in browser and desktop modes. The README lists the source layout.
  - CI runs ruff (`ruff.toml`) and ESLint (`eslint.config.js`) with correctness rules only; the unused variables and imports they found are removed.
  - a test checks that the version is the same in `CITATION.cff`, `package.json`, the title bar and the changelog.
- Fix: *Remove drift* in MSD / Diffusion subtracted the centre of the selected atoms, so a single atom, ion or molecule lost the diffusion the MSD measures (MSD and D close to zero). It now subtracts the centre-of-mass motion of the whole system, with minimum-image steps across periodic boundaries. MSD and D computed earlier for small selections with this option on should be recomputed.

## 2.2.0 (2026-09-23)

- Plane-wave cards: a Cell section shows the structure cell (applied cell, cell file, trajectory lattice) and accepts a custom cell per code; the cell and positions are written in each code's native units (Qbox bohr; QE angstrom, bohr or alat, crystal positions; CP2K ABC/ALPHA_BETA_GAMMA or vectors, SCALED; VASP Direct or Cartesian).
- Fixed: a lattice from the loaded file (extended XYZ, or a CIF/cell file given at import) is now recognised on the Processing Options page without waiting for the launcher.
- Changed: CP2K writes ABC and ALPHA_BETA_GAMMA by default (vectors when the cell is not in the standard orientation).
- New units module (units.js, monet_units.py): CODATA 2018 bohr, atomic time and cell conversions shared by all QM inputs.
- QE frequencies: ph.x runs need a k-point mesh, so Γ-only becomes a 1×1×1 automatic mesh when ph.x is ticked.
- Processing Options: one settings card per quantum-chemistry code (Gaussian, ORCA, QE, VASP, CP2K, Qbox) with calculation type (SP, Opt, Opt+Freq, Freq, TD-DFT, MD, variable-cell relaxation), functional/method, basis or cutoff, dispersion, solvent, k-points and extra keywords; charge and multiplicities shared with a per-code override.
- Plane-wave codes need a cell: the applied crystal cell or the trajectory lattice, or the new "Isolated system: vacuum box" flag (configuration centred; QE assume_isolated='mt', CP2K Poisson MT, VASP dipole correction). Run is disabled otherwise.
- VASP: KPOINTS and POTCAR.spec written; POTCAR and exact NELECT assembled from a local POTCAR library (launcher, desktop app). QE: optional ph.x input for Γ phonons; input files end in .inp. CP2K: PBE0/B3LYP/HSE06 through ADMM.
- Changed: ORCA %maxcore defaults to 75 % of memory per core (was 100 %); the vacuum box is now centred on the configuration.
- Methods report: one line per quantum-chemistry code.
- Edited templates follow their file name, so changing the calculation type never moves an edit to another file.
- Equilibration: with several groups the text names the group that sets t₀ (the one that equilibrates last) and lists t₀ per group; the chart legend names it too.
- Equilibration on a derived trajectory: the text and the cropped trajectory's label give the frame number of the full trajectory, not only the frame of the active file.
- The ✂ production-window button is disabled while a calculation runs.
- Going back to step 1 and re-analysing the original file drops a derived (uncorrelated, cropped, aligned) trajectory: its time stride, sampling frequency and full-trajectory frame numbering no longer carry over.
- README: *Max lag (fs)* limits the ACF calculation and the τ fit and τ_int windows, not only the view.
- Autocorrelation: Sokal (default) and Geyer estimators of τ_int with its error; run length in units of τ with warnings; residual correlation g and N_eff of the sampled configurations.
- Changed: the default τ_int estimator is now Sokal's window (previously the first zero crossing), so τ_int, N_eff and the standard errors differ from 2.1; choose *first zero crossing* in the Autocorrelation tab to reproduce earlier results.
- Block averaging (Flyvbjerg–Petersen) chart under the ACF, with plateau detection.
- Detect equilibration (maximum N_eff, Chodera 2016) and crop to the production window.
- Plot-note SEMs use the same Sokal window as the ACF panel.
- Fix: markers, lag zoom and the player cursor now work on axes with values of 1,000 and above.
- Fix: activating the MDAnalysis aligned trajectory multiplies the MD steps per saved frame by the frame step it was written with, so later times (ACF, τ, MSD, VDOS, t₀) are no longer too small.
- Analysis history:
  - MONET keeps a text log of every step that changes a result: input files with SHA-256, cell, time axis, analyses with their parameters and key numbers, derived trajectories, extraction and exports;
  - it is autosaved in `~/.monet/sessions/` (launcher option `--sessions-dir`) and can be paused and resumed;
  - cleared analyses stay in the log, marked *cleared*.
- History drawer (History button or Ctrl+`):
  - a console shows every analysis as a readable call such as `acf(quantity="dihedral", groups=[[1, 2, 3, 4]], …)`;
  - click a line, edit it and press Enter to re-run it through its panel; the new step is linked to the original;
  - the History tab has filters, notes and a *final* mark.
- Sessions:
  - *Save session* downloads a ZIP with `session.json`, a methods report (Markdown, and Word when pandoc is installed) and `replay.py`;
  - *Open session* restores the log read-only until the trajectory with the same SHA-256 is loaded; while it stays read-only, no analysis runs;
  - opening a session starts a fork (a new creation time, `forked_from` the original), so it never overwrites the history it came from;
  - loading a trajectory offers its previous history.
- Methods report: software versions with citations, input checksums, the steps with their key numbers, and the reporting checklist of the workflow document pre-filled.
- `replay.py`: re-runs the logged analyses without the browser (`python replay.py --monet /path/to/MONET`), checks the input checksums and compares the logged raw numbers (τ, τ_int, t₀, D, frame counts, …), reporting every one that differs (`--rtol`, default 1e-6); steps without such numbers (e.g. bond lengths, whose report values are statistics) print `RAN` rather than a false `OK`. Session files are shareable and untrusted, so `replay.py` embeds their values only as safe literals or single-line comments, never as executable code.
- Fix: opening a saved session no longer overwrites the (possibly newer) autosave it was opened from once its trajectory is attached and autosave resumes — opening now forks the session first.
- Fix: an ASE step that is still running when *Open session*, a resume or a new trajectory load swaps the current session can no longer finish or fail onto an unrelated step of the newly current session; *Open session* is also disabled while an analysis is running.
- Fix: `replay.py` generation no longer splices in a source id that was never assigned in the script (e.g. a trajectory derived while the history was paused, or not logged) — the step is skipped with an explanatory comment instead of raising `NameError` when the script runs.
- Fix: bond/angle/dihedral series keys in the log and methods report are relabelled from file indices to MONET atom IDs (coordination labels keep the per-atom names from ASE).
- Fix: continuing a session (resume, or reattaching an opened session's trajectory) refreshes the logged software versions so the report reflects the current environment.

## 2.1.0

- Right-drag (or Shift-drag) moves the structure in both 3D viewers; right-click opens a selection menu instead of the browser menu.
- Selection tools in both viewers, on ASE neighbour lists when available: element, bonded neighbours, whole molecules, atoms within R Å, all, invert, centre view.
- Find bonds, angles and dihedrals by element pattern (`O H`, `H O H`, `C C O H`, `*` wildcard) and fill the geometry, autocorrelation or fluctuation inputs.
- Autocorrelation plateau: a τ typed by hand is drawn on the plot, the stride text gives t* and the effective spacing after rounding up to whole frames, and a warning appears when τ is below ~5 saved frames.
- Fix: with **centre selection** on, picking atoms no longer moves the structure; the atoms selected when the option is ticked stay centred (untick and tick again to re-centre).

## 2.0.0

First release of MONET 2 (browser app with a local Python launcher; the Electron window remains available for development).

- Day/night theme; plots and exports follow it.
- Fast trajectory engine (frame index, selective parsing), launcher uploads/jobs with progress and cancel, single-pass desktop extraction.
- Import of VASP, Quantum ESPRESSO (pw.x, cp.x), Qbox, ORCA, CP2K (DCD, `.cell`), CPMD `TRAJECTORY`, LAMMPS and more.
- Per-configuration inputs for Gaussian, ORCA, Qbox, QE, VASP and CP2K from editable templates.
- Kabsch RMSD, RMSD matrix, RDF, MSD/diffusion, VDOS, unwrapping, autocorrelation with τ and sampling stride; CSV export.
- Desktop Gaussian inputs now use a relative `%chk` file name, as the browser version always did.
- Folded 0–180° angle range; mean ± std (circular for angles) in plot legends and a distribution view.
- CIF/POSCAR/PDB files as a fixed cell for XYZ trajectories, and **Load cell from file** in the Crystal cell panel.
- Topology-free import of XTC/TRR/DCD/NetCDF (atoms as X); remove buttons for every selected file.
- Autocorrelation first; fitted plateau (optional offset c), validated decorrelation time t* and one-click uncorrelated trajectory that becomes the active one.
- Distribution plots with fits below the RMSD/bond/angle/dihedral time series.
- Trajectory player with live geometry and plot cursors; display and export wrapping of atoms or whole molecules into the cell.
- Normalised circular ACF, folded (period 180°) dihedral ACF, half-run default lag range.
- Gaussian, von Mises and two-Gaussian fits of distributions; correlation-corrected standard error of the mean and R in plot notes.
- Dot-histogram and polar (half/full circle) distribution plots with custom radial values and reference angles.
- Structure analysis step before extraction, collapsible workflow panel, larger ASE viewer; faster 3D viewers with five representation styles.
- XTC/TRR/DCD/NetCDF/GRO/PDB via MDAnalysis, every ASE-readable format, MDAnalysis selections.
- Separate ASE, MDAnalysis and custom-analysis tabs before MONET processing; ASE structure summary and coordination numbers; 20 MDAnalysis analyses including the pairwise RMSD matrix; atom-identity check across MONET, ASE and MDAnalysis.
- Fluctuations and trends of atoms, bonds, angles and dihedrals, mapped as colours on the molecule; colour maps, orientation and titles for RMSD matrices.
- Double-click launchers (`start_monet.command`, `start_monet.bat`), conda `environment.yml`, `CITATION.cff` and MIT `LICENSE`.

## 1.0.5 (2019)

Original MONET: extraction of selected atoms every N frames from CPMD/CP2K XYZ trajectories, average structure and Gaussian inputs.

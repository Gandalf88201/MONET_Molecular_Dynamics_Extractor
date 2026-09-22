# Changelog

## Unreleased

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

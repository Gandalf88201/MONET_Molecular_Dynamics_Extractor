# MONET — User manual

*Dr. T. Francese*

MONET reads a molecular-dynamics trajectory, analyses it with ASE, MDAnalysis and its own methods, and extracts the configurations you need for quantum-chemistry calculations. It runs in your browser, on your own computer. This manual follows the order in which you work: **open the trajectory → look at it and set the cell and the time axis → analyse it (geometry, autocorrelation, dynamics) → extract statistically independent configurations and write the QM inputs → keep the record of what you did**. Every step has a picture taken from the program itself.

> **Tip:** the manual is available at any time from the **Manual** button in the title bar. It opens in a new tab, so you can keep it beside the program. It is written in English and Italian (**EN / IT** at the top right of the manual); the program itself is in English, and the pictures are the same in both languages.

> **Note:** all the pictures use two small synthetic trajectories, so that you can repeat every step: an **ethanol molecule** (9 atoms, 1500 frames, with a start-up transient and a hydroxyl that rotates slowly) and a **box of 64 waters** (192 atoms, 400 frames, periodic). Write them with `python tools/manual_data.py DIRECTORY`. The numbers in the pictures illustrate the program; they are not results about real ethanol or water.

## 1. Before you start

### 1.1 Starting MONET

1. Install **Python 3.10 or newer** once ([python.org/downloads](https://www.python.org/downloads/); on Windows tick *Add python.exe to PATH*), or use conda.
2. Download MONET (**Code › Download ZIP** on GitHub, then extract the whole folder, or `git clone`).
3. Start it:
  - **macOS**: double-click `start_monet.command` (the first time: right-click › **Open** › **Open**).
  - **Windows**: double-click `start_monet.bat` (if SmartScreen appears: **More info › Run anyway**).
  - **Linux**: run `./start_monet.command` in a terminal.
4. The first start creates a private environment (the `.venv` folder) and installs ASE, MDAnalysis, spglib and networkx (internet needed once, a few minutes). Later starts are immediate.
5. Your browser shows MONET at `http://127.0.0.1:8765`. **Keep the terminal window open** while you work; `Ctrl+C` in it stops the program.

With conda: `conda env create -f environment.yml`, `conda activate monet`, `python start_monet.py`. If the port is busy, add `--port 8766`. `MONET_PYTHON` chooses a particular Python.

Everything runs on your computer. The service listens on `127.0.0.1` only, asks for a per-session token, keeps uploaded files in a private folder that is deleted when you stop it, and your trajectory data never leaves your computer (the internet is used only to install the Python packages). A trajectory is uploaded **once** (up to 200 GB, `--max-upload-gb`); every scan, analysis and extraction then runs as a background job with a progress bar and a **Cancel** button.

> **Warning:** opening `index.html` directly (a double-click on the file) shows the page but **does not start Python**: there is no ASE, no MDAnalysis and no manual. Always start MONET with the launcher.

### 1.2 The main window

![The main window of MONET with the structure analysis open, areas numbered](img/window.png "The main window after loading the ethanol trajectory. 1 Title bar · 2 Module tabs · 3 Molecular viewer · 4 Trajectory player · 5 Analysis tabs of the module · 6 Time axis.")

| Number | Area | What it is for |
|---|---|---|
| 1 | **Title bar** | The ASE / MDAnalysis status, **Manual**, **ⓘ References** (what to cite), **History** (record of every step), **☀ Day / ☾ Night**. |
| 2 | **Module tabs** | **ASE**, **MDAnalysis** and **MONET Custom Functionalities**. They share the same trajectory, viewer, atom table, cell and time axis. |
| 3 | **Molecular viewer** | The structure with the MONET atom numbers. Click atoms to pick them; the buttons at the top right orient the view. |
| 4 | **Trajectory player** | Plays the trajectory; the plots follow it. |
| 5 | **Analysis tabs** | The analyses of the chosen module, one per tab. |
| 6 | **Time axis** | MD time step and number of MD steps between saved frames. |

On the far left the **workflow panel** holds the seven steps of the extraction: *01 File input · 02 Structure analysis · 03 Sampling · 04 Atom selection · 05 Options · 06 Processing · 07 Results*. It folds into a narrow rail while you analyse; **⇥** (top left) opens it again and the blue **Extraction →** button continues to step 03.

### 1.3 Day and night

![The same window in night mode](img/night.png "Night mode (the default when your system is dark): press ☀ Day / ☾ Night in the title bar to switch. Plots and pictures follow the theme.")

The choice is remembered by your browser. The manual has the same button.

## 2. Step 1 — Open the trajectory

### 2.1 Open a file

![The File input step with a trajectory loaded](img/file_input.png "Step 01: Browse… chooses the trajectory; the format is detected automatically.")

1. Press **Browse …** and choose an XYZ or extended XYZ trajectory (CPMD, CP2K, ORCA, Qbox …).
2. Leave **Input format** on *Auto-detect* (XYZ is read directly).
3. Press **Next →**. MONET indexes the file, reports the number of configurations and atoms, and opens the **ASE** tab.

Plain XYZ frames must keep the same number of atoms and the same element order. Extended XYZ `species`/`pos` columns, `Lattice` and `pbc` are read; other per-atom columns are not carried into the extracted files. Remove the trajectory with **× Remove** if you chose the wrong file.

### 2.2 Other formats

![Choosing a GROMACS XTC file shows the reference-structure field](img/import_formats.png "Choosing a format that has no element names (here GROMACS XTC) shows the extra file it needs: the reference structure or topology.")

Other formats are imported through ASE or MDAnalysis and written as extended XYZ, then processed like any XYZ file:

| Format | What to add |
|---|---|
| VASP XDATCAR, OUTCAR, `vasprun.xml`, POSCAR/CONTCAR; Quantum ESPRESSO `pw.x` output; ORCA output; Qbox output; LAMMPS dump; ASE `.traj`; CIF; Gaussian output | nothing (via ASE) |
| Quantum ESPRESSO `cp.x` `.pos` (+ `.cel`); CP2K DCD; CPMD `TRAJECTORY` | a **reference structure** with the same atom order (any file ASE or MDAnalysis can read, e.g. the first frame as XYZ); for `.cel` say whether rows or columns are the lattice vectors |
| GROMACS XTC, TRR; CHARMM/NAMD DCD; AMBER NetCDF | a **topology** (GRO, PDB, TPR, PSF, PRMTOP …) as reference structure. Without it every atom is element **X**: distances, angles, dihedrals, RMSD, MSD and unwrapping still work, element-based analyses do not (a warning says so). |
| GROMACS GRO, multi-model PDB, any other format MDAnalysis reads | nothing |

For an XYZ trajectory you can add a **cell file** (optional): a CIF, POSCAR or PDB gives one fixed cell to every frame; a CP2K `.cell` or cp.x `.cel` gives a cell per step (NPT). Each file you choose has a **×** button to remove it. The list *All ASE-readable formats* in the format menu contains every other format your ASE installation can read. Importing needs the launcher.

### 2.3 Check that the atoms are the same everywhere

The same atom has the same number in all modules: **MONET ID** (viewer, extraction, QM inputs) = ASE index + 1 in the original file = MDAnalysis `id`. After an extraction the IDs of the original file are kept. When a trajectory is loaded, *MDAnalysis › Topology & consistency* compares what MONET, ASE and MDAnalysis read (count, elements, first-frame coordinates) and marks any mismatch in red.

![The Topology and consistency tab for the box of waters](img/mda_topology.png "MDAnalysis › Topology & consistency: the three programs agree on 192 atoms; MDAnalysis found 64 residues named by their formula (H2O1, H2O2 …) and 128 bonds.")

For XYZ files each bonded molecule becomes a residue named after its formula, so selections such as `resname H2O` work.

## 3. Step 2 — Look at the structure and set the cell and the time axis

### 3.1 The viewer

![The viewer of the box of waters with the orientation tools](img/viewer_tools.png "The viewer: x y z (and a b c) look down an axis, ⊹ axes shows the orientation axes, ▣ cell shows the cell, ⛶ expands the viewer. Under it, the trajectory player.")

* **Balls & sticks, Sticks, Space-filling, Lines, Points** and the viewer size (Compact, Large, Full height) are in the menus above the viewer; **Fit view** resets the orientation.
* **Drag** rotates, **right-drag** or **Shift-drag** moves, the **wheel** zooms. A click on an atom picks it; the picked atoms are gold, with a number that shows the order.
* **x y z** look down that Cartesian axis (click again to look from the other side); with a cell, **a b c** do the same along the cell vectors. **⊹ axes** shows or hides the axes in the corner; **▣ cell** shows or hides the cell box (display only: the analyses still use the cell). **⛶** expands the viewer to the whole window (Esc brings it back).
* Large systems stay responsive: above 2,500 atoms the viewer draws lines while you rotate.

### 3.2 Picking atoms

Click atoms in the order the analysis needs them: 2 for a bond, 3 for an angle (the middle one is the vertex), 4 for a dihedral in bond order. A row of the atom table under the viewer toggles the same atom. **Use selection for** writes the picks into the field of the analysis you choose; if the picks are not already in bonded groups, MONET finds every bond, angle or dihedral among them.

![The right-click menu on an atom](img/selection_menu.png "Right-click an atom (or a row of the atom table): select it, its molecule, its bonded neighbours, the atoms within R Å or every atom of its element; extend, invert or clear the selection; centre the view.")

Under the viewer, **Find bonded chains by element** lists every bond, angle or dihedral that matches a pattern such as `O H`, `H O H` or `C C O H` (`*` is any element) and fills the geometry or autocorrelation inputs. **Select with MDAnalysis syntax** (e.g. `resname H2O and element O`) fills the picks from an MDAnalysis selection.

### 3.3 Cell and periodic boundaries

![The Crystal cell panel](img/cell_panel.png "Crystal cell and periodic boundaries: the source cell of the file is shown; you can also type a, b, c, α, β, γ, read a CIF or POSCAR, and choose the periodic directions.")

Open **Crystal cell and periodic boundaries**. A cell that arrives with the trajectory (extended XYZ `Lattice=`, or a cell file given at import) is shown and used as it is. To use another one, choose the crystal system, type a, b, c in Å and α, β, γ in degrees, tick the periodic directions and press **Apply cell**; **Read cell from XYZ**, **Load cell from file (CIF …)** and **Use source cell** do what they say.

The **minimum-image** box under it controls periodic bond lengths, distances, angles, dihedrals and molecule selection. Applying a cell or changing this box clears the previous analyses, so geometries are never mixed. The cell convention is *a along x, b in the xy plane*: your Cartesian coordinates are neither rotated nor rescaled.

### 3.4 The time axis

In the **Time axis** row type the **MD time step** (fs, atomic units or ps) of your simulation and the number of **MD steps between saved frames**. MONET assumes nothing: MSD, VDOS and the autocorrelation stay disabled, and the field turns red, until the time step is given. In the pictures the time step is 0.5 fs and a frame is saved every 20 steps, so consecutive frames are 10 fs apart. All the copies of this field (in the ACF, MSD, VDOS and fluctuation panels) share the same value.

### 3.5 The player

![The trajectory player](img/player.png "The player: first, previous, Play, next, last and a slider; Step shows every n-th frame; Speed in fps; loop; Cell display wraps molecules or atoms into the cell for display; centre selection.")

Space plays and stops, ←/→ step (the viewer must have focus). During playback a dashed cursor follows the shown frame on the RMSD, bond, angle, dihedral and MDAnalysis time series, and a click on one of those plots jumps to that frame. With 2, 3 or 4 picked atoms the distance, angle or dihedral of the shown frame is updated live.

## 4. The ASE module

The ASE module holds structure, geometry and the analyses of the ASE library. Each tab has its own **Clear analysis**, **Download plot PNG** (2400 px wide, in the current theme) and **Download data CSV**; **Clear all analyses** empties everything and keeps your trajectory and settings.

### 4.1 Structure

![The Structure tab for the box of waters](img/structure_result.png "Analyse structure: formula, mass, centre of mass, inertia, cell, density, shortest distances, bonds per element pair, coordination numbers and the space group (spglib).")

Choose the **Frame** and press **Analyse structure**.

### 4.2 Bond lengths

![Bond lengths of the ethanol molecule](img/bonds_result.png "Bond Lengths: C–C, C–O and O–H of ethanol along the trajectory, with the mean ± SD in the legend and the distribution under the plot.")

Enter pairs of MONET IDs (`1 2  2 3  3 4`, separated by two spaces) or pick the atoms in the viewer and press **Use selection**, set the **Frame step** and press **Compute**. The legend shows the mean and the **standard deviation of the distribution**, which is not the error of the mean. Under each time series a second plot gives the probability distribution, with an optional fit (Gaussian, Lorentzian, pseudo-Voigt, von Mises or two Gaussians, over all bins or a range) and its parameters with errors; *Show → dot histogram* stacks one dot per frame.

### 4.3 Bond angles

![Bond angles of ethanol](img/angles_result.png "Bond Angles: C–C–O and C–O–H of ethanol.")

Groups of three IDs; the middle atom is the vertex (`1 2 3  2 3 4`). The range is the usual 0–180°, or 0–360° with a reference normal, or a folded range; changing it clears the result, so recompute.

### 4.4 Dihedral angles

![The torsion of the hydroxyl group of ethanol](img/dihedrals_result.png "Dihedral Angles: the C–C–O–H torsion, in the range 0–360°. The mean and standard deviation are circular (R is the mean resultant length); the note adds the standard error of the mean corrected for the correlation of the frames (N_eff, τ_int).")

Groups of four IDs in bond order; the two middle atoms define the axis. **Angle range**: 0–360° (ASE), or folded to −90…+90° or 0…180° when equivalent orientations must not be told apart. Choose a folded range whose edge is far from your values. **Show → polar plot** draws the PCCP-style circular histogram (stacked dots or frame index) with the circular mean of every series and optional **Reference** directions.

### 4.5 Pair distances

![Histogram of O–O distances](img/pdd_result.png "Pair Distances: a histogram of counts (not a normalised g(r)) of the distances between the chosen atoms, from 0.5 Å to Rmax, optionally restricted to an element pair such as O O.")

For a normalised g(r) use the **RDF** tab of MONET Custom Functionalities (section 5.6).

### 4.6 Coordination

![Coordination numbers along the trajectory](img/coordination_result.png "Coordination: the neighbours of every atom within the ASE covalent cutoffs (× the bond cutoff of the viewer) in every analysed frame: the mean per element and the first eight atoms.")

### 4.7 Convert and wrap

![The Convert / Wrap tab](img/convert_panel.png "Convert / Wrap: choose an input file, the output format and the download name; below, unwrap or wrap the active trajectory.")

* **Convert**: **Browse …** for the input file, choose the **Output format** (extended XYZ, XYZ, VASP, CIF, LAMMPS data, FHI-aims, Turbomole, Gaussian input, DFTB+ or JSON), set the download name and press **Convert**. *Convert first frame only* is on by default, for formats that hold one structure; untick it for multi-frame extended XYZ or JSON. For a plain XYZ you can apply the crystal cell of section 3.3. VASP needs a complete cell, and Quantum ESPRESSO is not offered because the pseudopotentials are not collected here.
* **Unwrap and download** gives continuous atom paths. **Wrap and download** moves *whole molecules* (rebuilt across the boundary) or *atoms* into the cell, optionally centred on the picked atoms: useful before periodic QM inputs.

### 4.8 More analyses

![ASE More analyses](img/ase_more.png "ASE › More analyses: molecules and species per frame, with the other built-in ASE analyses in the menu.")

The last tab holds further analyses of the ASE library: self-diffusion per element, energies, forces, temperature and pressure stored in the file, bonds, angles and dihedrals by type, molecules and species, bonds formed and broken, RDF, space group, dimensionality, layers, powder XRD and SAXS, Bravais lattice and Niggli cell, supercell trajectory, cell volume and density. Choose one in the menu, fill its fields (**← picked** inserts the atoms picked in the viewer) and press **Compute**. Plugins appear here too (section 10).

## 5. MONET Custom Functionalities

These are MONET's own analyses. The first tab, **3D viewer & extraction**, is used by the extraction workflow (section 8); the others analyse the trajectory.

### 5.1 Autocorrelation and the decorrelation stride

![Autocorrelation of the hydroxyl torsion](img/acf_result.png "Autocorrelation: C(t) of the dihedral (blue) and its fit (red dashed); t* (gold dashed) is where the fit reaches its plateau. Under the plot, block averaging of the standard error.")

This is the heart of the workflow: configurations that are closer in time than the correlation time carry the same information, so *how often to sample* is decided here.

1. Set the time axis (section 3.4).
2. Choose a **Quantity** (dihedral, bond angle, bond length or RMSD), type the **MONET IDs** (several groups are averaged) and press **Compute ACF**.
3. Read the box above the plot: τ from the fit (exp(−t/τ), here 727 ± 14 fs), the integrated τ_int with its error and window, the mean ± SD, N_eff, and the **run length in units of τ**. Below 20 τ MONET warns, below 50 τ it notes that τ and the stride are approximate (here the run is 20.6 τ).
4. The green box **validates the plateau**: t* = τ·ln(1/ε) (3.0 τ for ε = 5 %) is drawn on the plot. Check it against the curve, change ε, type τ or t* by hand if needed.
5. **Accept t\* and build the uncorrelated trajectory** writes an extended XYZ with one frame every ⌈t*/Δt⌉ saved frames (here every 218 frames: 7 configurations), each comment line keeping `source_frame=<index>` of the original run. With *analyse it in MONET right away* it becomes the active trajectory for all analyses and the extraction. **↩ Full trajectory** (module header) goes back. **Only set the sampling frequency** copies the stride to step 03 and keeps the full trajectory.

Other choices: *Correlation* linear or circular (for angles), *Dihedral range* 0–360° or folded 0–180°, *Fit model* with or without a plateau, *Fit up to*, *τ_int estimator* (Sokal window by default, Geyer, or the first zero crossing), *Max lag*. Drag across the plot to zoom, double-click to show everything. The *block averaging* plot (Flyvbjerg–Petersen) shows the standard error against the block length; a plateau means the error bar is reliable, and the note under the buttons says when there is none.

![Detect equilibration](img/equilibration_result.png "Detect equilibration (Chodera 2016): N_eff against the start of production t₀; the largest value (gold) is where production starts. Here the start-up transient is discarded up to 2,750 fs.")

**Detect equilibration** computes N_eff(t₀) for starting points in the first half of the run. The largest value is the start of production; **✂ Use the production window from t₀** writes it as the new active trajectory (`source_frame` is kept, and ↩ Full trajectory goes back). If no transient is found, it says so and keeps the whole run.

### 5.2 Fluctuations and trends

![Fluctuations of the bonds of ethanol](img/fluct_result.png "Fluctuations & trends: the SD of every bond (bars and table). The table gives the mean, SD, minimum, maximum, 5–95 % range, trend with its error and R², drift between the two halves, block error and the dominant frequency.")

Choose what to map (**bond lengths, angles, dihedrals or atoms**), the items (all found from the first-frame connectivity among the atoms entered, or only the groups you type) and press **Compute**. A trend is marked *significant* only if the five block averages follow a line beyond three times the error of its slope; fast oscillations are not mistaken for drift. **Colour and bars by** SD, range, |trend|, |drift|, frequency or mean paints the values on the molecule; **vibration arrows** and **displacement ellipsoids** (50, 90 or 99 %) show how atoms move. A click on a row plots its time series with the mean, ±SD and the trend line. *Download statistics CSV* saves the table.

### 5.3 RMSD (Kabsch)

![RMSD of the ethanol trajectory](img/rmsd_result.png "RMSD (Kabsch): displacement from the reference frame, here with Kabsch alignment on; the distribution is below.")

Raw Cartesian displacement from the reference frame (the first one by default); **Kabsch alignment** removes translation and rotation, **Unwrap PBC** is for periodic runs. Atoms: the ones you enter or pick (blank = all).

### 5.4 RMSD matrix

![Pairwise RMSD matrix](img/rmsdmatrix_result.png "RMSD Matrix: the RMSD between every pair of analysed frames. Blocks along the diagonal are separate states; low values far from the diagonal mean that the system revisits a state.")

Up to 3000 frames; use a frame step close to the decorrelation stride to compare non-correlated configurations. Choose the colour map, the origin and a title under the plot. The same matrix exists in MDAnalysis (`DistanceMatrix`).

### 5.5 Time axis for MSD, VDOS and ACF

MSD, VDOS and the autocorrelation need the **MD time step** and the **MD steps per saved frame** (section 3.4); each panel shows the same fields at its top.

### 5.6 RDF

![Radial distribution function O–O of the waters](img/rdf_result.png "RDF: g(r) of the O–O pair of the box of waters; the first peak is the first coordination shell. A periodic cell is required; Rmax is limited to half the smallest cell width.")

Enter an element pair (`O O`, `O H`, blank = all atoms), optionally restrict it to MONET IDs, and press **Compute RDF**. **Plot** switches between g(r) and the running coordination number n(r). Unlike *Pair Distances*, g(r) → 1 for an uncorrelated liquid.

### 5.7 MSD and diffusion

![Mean-square displacement of the waters](img/msd_result.png "MSD / Diffusion: MSD(t) of the whole system, O and H, and the linear fit (gold dashed). D = slope / 6, given in cm²/s and Å²/fs.")

Positions are unwrapped with minimum-image steps (keep the frame step small enough that atoms move less than half a cell between frames), the centre-of-mass drift can be removed, and the MSD is averaged over all time origins. Change the **fit window** (10–50 % of the lag range by default) and read D for the selection and per element.

### 5.8 VDOS

![Vibrational density of states of ethanol](img/vdos_result.png "VDOS: the Fourier transform of the finite-difference velocities (Hann window, optional mass weighting and smoothing), normalised to unit area. The Nyquist limit and the resolution are shown.")

Save frames every MD step, or every few steps, for accurate high frequencies; the maximum frequency and the resolution come from the time axis.

## 6. The MDAnalysis module

### 6.1 Running an analysis

![The MDAnalysis analysis form with the hydrogen-bond fields](img/mda_form.png "MDAnalysis › Analyses: pick the analysis in the menu; its own fields appear. ⓘ Cite shows its references.")

The *Analyses* tab runs MDAnalysis on the same trajectory, cell, frame step and MONET IDs. Selections use the MDAnalysis language (`id` is the MONET ID, `index` the 0-based position, `resname H2O`, `around 3.5 …`); **← picked** inserts the atoms picked in the viewer. Press **Compute**.

![RMSD from the MDAnalysis module](img/mda_rmsd.png "rms.RMSD: RMSD after optimal superposition, with extra groups measured after the same fit.")

![RMSF from the MDAnalysis module](img/mda_rmsf.png "rms.RMSF: root-mean-square fluctuation of each atom.")

![Principal component analysis](img/mda_pca.png "PCA: the variance of each component, the projections, and configurations picked by projection window, extremes or frame list that can be written as a trajectory for the extraction.")

![Hydrogen bonds in the box of waters](img/mda_hbonds.png "HydrogenBondAnalysis: hydrogen bonds per frame (donor–acceptor cutoff 3 Å, D–H–A angle 150°) and the occupancy table with MONET IDs.")

### 6.2 What is available

| Group | Analyses |
|---|---|
| Structure and dynamics | RMSD, pairwise RMSD matrix, RMSF, radius of gyration, PCA (with cosine content), EinsteinMSD, GNM, diffusion map, aligned trajectory, average structure, bond–angle–torsion coordinates |
| Interactions and distances | hydrogen bonds, their lifetime and autocorrelation, water bridges, contacts, contact map, InterRDF and site-specific RDF, centre-of-mass and minimum distances, atomic distances, dihedrals |
| Densities | linear density, density grid (OpenDX) |
| Membranes, polymers, dielectrics | leaflets, persistence length, dielectric constant (needs charges) |
| Proteins | Ramachandran, DSSP, Janin χ1/χ2, helix geometry |
| Nucleic acids | base-pair distances, backbone torsions and sugar pucker |

Not included: `encore`, `psa`, `waterdynamics` (deprecated), `hole2` and `legacy.x3dna` (external programs).

## 7. A complete study, step by step

The order below is the one recommended in `docs/md-analysis-workflow.md`, which gives the literature behind each step.

1. **Open** the trajectory (section 2). In *MDAnalysis › Topology & consistency* check that the atoms agree.
2. **Cell and time axis** (sections 3.3, 3.4). Without them MSD, VDOS and the autocorrelation are disabled.
3. **Look** at the structure and play the trajectory (section 3). Check that molecules are not broken and the cell is right.
4. **Is it equilibrated?** *Autocorrelation › Detect equilibration* (section 5.1), or the plot of a slow observable (a dihedral, the RMSD, the energy in *ASE › More analyses › Values stored in the file*). Use the production window.
5. **How correlated is it?** Compute the ACF of a slow coordinate and read τ, τ_int and the run length in τ. Check that the run is at least 20–50 τ.
6. **Geometry and fluctuations** (sections 4.2–4.4, 5.2) on the full-resolution run.
7. **Structure and dynamics**: RDF, MSD, VDOS, MDAnalysis analyses.
8. **Build the uncorrelated trajectory** (*Accept t\**), then **extract** and write the QM inputs on it (section 8): the configurations are statistically independent.
9. **Keep the record**: *History › Save session* (section 9) gives `methods.md` and `replay.py`; *ⓘ References* lists what to cite.

## 8. Extraction and quantum-chemistry inputs

**Extraction →** (rail, ASE header or step 02) continues to the extraction workflow.

### 8.1 3D viewer & extraction

![The 3D viewer of the extraction workflow](img/view3d.png "MONET Custom Functionalities › 3D viewer & extraction, with the workflow panel at the left: the same viewer tools as in the ASE module.")

### 8.2 Step 03 — Sampling

![The Sampling step](img/sampling.png "Sampling: one configuration every N-th frame. The number of sampled configurations is shown.")

Type the **sampling frequency**. If you built an uncorrelated trajectory it is already 1, and the panel says which trajectory is used. Otherwise use the stride suggested by the autocorrelation (**Use as sampling frequency**).

### 8.3 Step 04 — Atom selection

![The Atom selection step](img/atom_selection.png "Atom selection: click atoms in the viewer, or type MONET IDs and press Apply. Selected atoms are gold; the table lists them with their coordinates.")

Select the atoms to extract (click, IDs, or **Use atoms picked in the ASE analysis**). The toolbar has *element, All, Invert, + Bonded, + Molecules, + Within R*.

### 8.4 Step 05 — Options and quantum-chemistry codes

![The Options step](img/options.png "Options: average structure and the quantum-chemistry inputs. The electronic states (charge and multiplicities) are shared by all the codes.")

Tick **Compute average structure** for `GEO-AVERAGE.xyz` (all atoms, all frames, Cartesian average). For each configuration MONET can write inputs for **Gaussian, ORCA, Quantum ESPRESSO pw.x, VASP, CP2K and Qbox**. Set the **charge** and the **multiplicities** (one file per multiplicity: 1 → `sing`, 2 → `doub`, 3 → `trip` …).

![Cards of the quantum-chemistry codes](img/qm_codes.png "Each code has its own card: calculation type, method or functional, basis set or cutoff, dispersion, solvent, k-points and pseudopotentials, extra keywords, and a Preview of configuration 1.")

* Every card can override the charge and multiplicities, show a **Preview** of the file for configuration 1, and **Edit templates**; an edited file is marked *custom template*.
* Gaussian and ORCA need no cell. The plane-wave codes (QE, VASP, CP2K, Qbox) need one, in this order of priority: the card's *Isolated system: vacuum box* flag, the card's custom cell, the crystal cell of the structure analysis, the lattice of each frame. Without a cell the status line offers **Define cell…**.
* VASP **Build POTCAR** reads your own POTCAR library; MONET never ships POTCAR files.

### 8.5 Steps 06 and 07 — Processing and results

![Processing](img/processing.png "Processing: progress and log; Cancel stops the extraction. When it is done, Download results ZIP.")

![Results](img/results.png "Results: the summary and the folder tree. In the browser the results are one ZIP file.")

The output tree is `0-HISTORY/run.json`, `1-FULL_TRAJECTORY_EXTRACTED/` (selected atoms, every frame), `2-SAMPLED_CONFIGURATIONS/` (`SAMPLED_CONFIGURATIONS.xyz`, `confN/posN.txt` and the inputs: Gaussian in `confN/`, the others in `confN/orca/`, `confN/qe/`, `confN/vasp/`, `confN/cp2k/`, `confN/qbox/`) and `3-AVERAGE_STRUCTURE/GEO-AVERAGE.xyz`. **ASE Analysis →** goes back to the analyses on the extracted trajectory.

## 9. History, console and reports

MONET keeps a log of every step that changes a result: the file and its SHA-256, the cell and time axis, each analysis with its parameters and key numbers, derived trajectories and exports. Rotating the view or changing colours is not logged. The log stays on your computer (`~/.monet/sessions/`) and stores file names, never paths.

![The console of the history drawer](img/history_console.png "History › Console (Ctrl+`): every step is a call, e.g. acf(quantity=dihedral, groups=[[1, 2, 3, 4]], …). Click a line, edit it and press Enter to run it again; help() lists the analyses.")

![The history log](img/history_log.png "History › History: filters, details of each step and its parents, a note and a ☆ final mark. History: on / paused stops and restarts logging.")

* **Save session** writes a ZIP with `session.json`, `methods.md` (and `methods.docx` if pandoc is installed: software versions with citations, checksums, steps and a pre-filled reporting checklist) and `replay.py`.
* **Open session** restores a log read-only (it never re-runs anything) and starts a fork that does not overwrite the original; load the trajectory with the same SHA-256 to continue.
* `python replay.py --monet /path/to/MONET` re-runs every step without the window and compares the key numbers with the logged ones (`OK`, `DIFF`, or `RAN` when there is nothing raw to compare).

![The References dialog](img/references.png "ⓘ References: what to cite for MONET, ASE, MDAnalysis and every analysis you used, in Chicago or BibTeX, with Copy and Download .bib.")

## 10. Adding your own analyses (plugins)

An analysis is one Python function with the decorator `@analysis`. MONET builds the form, checks the values, runs it in the Python worker, plots the result and logs it. Save this as `~/.monet/plugins/end_to_end.py` and restart the launcher:

```python
import numpy as np
from monet_registry import Param, analysis, series

@analysis('end_to_end', engine='custom', label='End-to-end distance',
          description='Distance between the first and the last atom of each pair, in every analysed frame.',
          params=[Param.groups('pairs', 'Pairs of MONET IDs', width=2)])
def end_to_end(ctx, p):
    data = ctx.frames()
    values = {}
    for a, b in p['pairs']:
        values[f'{a + 1}–{b + 1}'] = np.linalg.norm(data.positions[:, b] - data.positions[:, a], axis=1)
    return series(data.frames, values, y_label='Distance (Å)')
```

![A plugin in More analyses](img/plugin_result.png "MONET Custom Functionalities › More analyses: the radius of gyration plugin shipped with MONET, run on the box of waters. Plugins of the three engines (ase, mdanalysis, custom) appear in the tab of their module.")

Plugins are read from `plugins/`, `~/.monet/plugins/`, the folders of `MONET_PLUGINS` and installed packages; they run with your user rights, so use only code you trust. The full reference is `docs/plugins.md`.

## 11. Working with an AI assistant (MCP)

`monet_mcp.py` connects MONET to assistants that speak the Model Context Protocol (Claude Desktop, Claude Code, Gemini CLI): you ask in plain language to open a trajectory, run any analysis or write a derived trajectory. It runs on your computer, reads only the folders you allow (`--data`) and writes only into `--output`. Install the SDK with `.venv/bin/python -m pip install "mcp>=1.2"` and follow `docs/mcp.md`. The tool results go to your assistant's provider like any chat content.

## 12. Troubleshooting

| Problem | What to do |
|---|---|
| The ASE badge in the title bar does not show the ASE version | Use the launcher (not `index.html`); press **Recheck**; if the connection is lost, stop the launcher and start it again. |
| *Cannot start MONET* / port busy | Start with `--port 8766` (or another free port). |
| macOS or Windows blocks the launcher | macOS: right-click › **Open**; Windows: **More info › Run anyway**. |
| MSD, VDOS or the autocorrelation are disabled | Enter the MD time step in the **Time axis** row. |
| Periodic distances look wrong | Define the cell (section 3.3) and tick the minimum-image box; the periodic directions must be on. |
| *Atom identity* shows red cells | MONET, ASE and MDAnalysis read different atoms (wrong reference structure or atom order): load the right topology. |
| An XTC/TRR/DCD trajectory has every atom as X | Add the topology as the reference structure. |
| A result disappears after changing the cell | Applying a cell or changing the minimum-image box clears the analyses on purpose; compute again. |
| An analysis stays at 0 % | Press **Cancel running calculation**; very long ACF lags can be limited with **Max lag**. |
| ASE or MDAnalysis analysis not offered | The module is missing from the Python environment of the launcher: reinstall `requirements.txt`. |

## 13. Keys and mouse

| Action | How |
|---|---|
| Rotate / move / zoom the viewer | drag / right-drag or Shift-drag / wheel |
| Pick or release an atom | click (or the row of the atom table) |
| Selection menu | right-click an atom or empty space |
| Play or stop, step | Space, ← / → |
| Leave the expanded viewer | Esc |
| Open the history and console | Ctrl+` |
| Zoom a plot / reset | drag across it / double-click |

## 14. Citing, licence and redrawing the pictures

Cite MONET (T. Francese, *MONET: Molecular Dynamics Extractor*, Zenodo, doi:10.5281/zenodo.22816521, with the version shown in the title bar) together with the PCCP 2022 article (doi:10.1039/d2cp01147f) and the libraries of the analyses you used; **ⓘ References** writes the list. MONET is under the MIT licence; ASE and MDAnalysis are separate packages under their own licences.

The pictures of this manual are drawn from the running program by `tools/make_manual_images.py` (it needs `pip install playwright` and Chromium). After a change of the interface run `python tools/make_manual_images.py` (or `--only window,acf_result`) and commit the new `manual/img/*.png`. The text is `manual/MANUAL.md` and `manual/MANUAL.it.md`; keep the same sections and pictures in both: a test checks it.

### Revision history

| Version | Date | Change |
|---|---|---|
| MONET 2.7.1 | 2026-10-10 | First version of the manual (English and Italian). |

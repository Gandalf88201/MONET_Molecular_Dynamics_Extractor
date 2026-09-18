# Changelog

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

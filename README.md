# MONET — browser and ASE support

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

Installing ASE needs internet access once. The app then runs locally; trajectory data is sent only to the Python service on your computer. The service listens only on loopback and processes each calculation in a temporary directory.

**Opening `index.html` directly does not start Python and cannot enable ASE.** It still supports browser XYZ import, visualization, extraction, and ZIP export. To use ASE, open the address printed by `start_monet.py`.

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

The **minimum-image** checkbox controls periodic bond lengths, pair distances, angles, dihedrals, and molecule selection. Periodic directions must also be enabled in the applied or source cell. RMSD remains raw Cartesian displacement without alignment or trajectory unwrapping. Editing a cell field is a draft change until **Apply cell**; applying a cell or changing the image option clears previous analyses to prevent mixing geometries.

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

RMSD uses raw Cartesian coordinates without fitting, removing translation/rotation, or unwrapping periodic boundaries. Distances and angles use minimum-image corrections when enabled and when the active cell has periodic directions. Without a periodic cell, they use direct Cartesian coordinates. Pair-distance output is a histogram of counts from 0.5 Å to Rmax, not a normalized radial distribution function. A filter such as `C N` includes exactly C–N pairs; one element selects like pairs.

## Convert

Open **Convert**, browse for an XYZ input, choose the output format, and set the download filename. **Convert first frame only** is enabled by default for compatibility with formats that store one structure. Click **Convert**, then **Download converted file**.

For multi-frame extXYZ or JSON output, uncheck the first-frame option. For a plain XYZ, apply a crystal cell and enable **Apply the manual crystal cell above to this conversion input**. This is explicit because conversion may use a different file. Otherwise conversion retains the input file’s own cell. VASP requires a complete cell. Quantum ESPRESSO conversion is not implemented because this panel does not collect pseudopotential settings. Gaussian uses ASE's `gaussian-in` writer.

If ASE is unavailable, the panel shows the connection or installation error. Install dependencies using the same Python environment used by the launcher, then click **Recheck ASE connection**. If the connection disappears, restart the launcher and reload its page.

## Core extraction workflow

Load an XYZ, choose the sampling frequency, select atoms, and continue to **Run**. Click **Download results ZIP** when processing completes.

Browser input limit: 100 MiB. Export retains output in memory. ASE requests time out after five minutes; increase the frame step or reduce the input for expensive calculations. XYZ frames must have a constant atom count and element order. Extended XYZ species and position properties are supported; core extraction does not preserve other properties or cell/PBC metadata. Average structures remain simple Cartesian averages over all atoms and frames.

## Electron desktop

The desktop app remains supported:

```sh
npm install
npm start
```

Activate the Python environment before launching Electron so its Python bridge can find ASE. Desktop mode uses native dialogs and writes results to the selected directory.

## Changes in this revision

- ASE molecular viewer with ordered mouse picking and stable MONET IDs after extraction.
- Selection transfer/append for bonds, angles and dihedrals; selected subsets for RMSD and pair distances.
- Crystal-system presets, validated cells, per-axis PBC, source-cell inspection, and cell visualization.
- Minimum-image distances, angles and torsions; optional cell transfer to converted files.
- Right-click molecule selection with periodic connectivity and extended-network detection.
- Full-range and folded angle conventions, matching plot scales, and PNG exports.
- Existing analysis clear controls and stale-result protection remain available.

## Validation

With the environment above active:

```sh
node tests/regression.cjs
node tests/ase-integration.cjs
```

The suite passed **30 core regression checks** plus **65 live integration checks with ASE 3.29.0**. These include validated cells, crystal conversion, native-cell preservation, boundary-crossing molecules, extended-network rejection, directed/folded angles, periodic torsions, and atom order verification after extraction, stable ID conversion, known dihedral values, frame sampling, invalid and collinear quadruplets, conversion output, selected-atom RMSD and pair-distance counts, and rejected invalid requests.

For the additional DOM/PNG checks, install the optional test dependencies (not required by the app):

```sh
npm install --no-save jsdom @napi-rs/canvas
node tests/ase-ui.cjs
```

**47 DOM/plot checks** passed for matching atom tables, snapshot stability, translated requests and labels, clearing results during calculations, valid 2400 × 1440 PNG downloads, ordered mouse picking, deselection, drag suppression, stable IDs after extraction, and transfer/append controls. Exported folded-angle and crystal-view PNGs were visually inspected. JavaScript syntax and Python compilation checks passed. The full interface was tested in a simulated DOM, not in a live browser window; the packaged Electron GUI was not exercised.

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

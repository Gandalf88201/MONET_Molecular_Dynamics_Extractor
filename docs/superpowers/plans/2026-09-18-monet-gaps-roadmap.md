# MONET roadmap: gaps from the analysis workflow document, plus analysis provenance

Source: `docs/md-analysis-workflow.md` §15 (gap IDs A1–F25), and the user's request of 2026-09-18 for an automatic record of the steps followed.

Each plan below is a separate subsystem and becomes its own implementation plan in `docs/superpowers/plans/`. Write the detailed plan when the work starts, with the writing-plans skill, against the code as it is then. Only Plan 1 is written in full now.

## Order and dependencies

| # | Plan | Gap IDs | Depends on | Status |
| --- | --- | --- | --- | --- |
| 1 | ACF statistics and equilibration | A1–A3, A5, A6, B7, B8 (+ chart-label bug fix) | – | **Done** (PR #13): `2026-09-18-acf-statistics-equilibration.md` |
| 2 | Analysis provenance log (reproducibility) | new, supports §12 of the workflow document | 1 (logs its new steps; can start in parallel) | **Done** (PR #13): spec `../specs/2026-09-21-provenance-console-design.md`, plan `2026-09-21-provenance-console.md` |
| 3 | QM loop: import QM results, running means, representativeness | C9, C10 (C11 after Plan 4) | 2 (the QM import is logged) | To write |
| 4 | Conformational analysis | D12–D17 | – | To write |
| 5 | ACF fit models | A4 | 1 | To write (small) |
| 6 | Structure and dynamics | E18–E23 | – | To write |
| 7 | Sanity checks from engine output | F24, F25 | 2 (energy files join the log) | To write |

The provenance log comes second because every later feature should log its own steps from day one. Adding it after them would mean retrofitting each one.

---

## Plan 2: Analysis provenance log

**Goal:** every step a user takes in MONET on a trajectory is recorded automatically. The record covers:
- the file, with its hash;
- the cell;
- the time axis;
- the atom selections;
- each analysis with all its parameters;
- the derived trajectories (uncorrelated, production, aligned, wrapped);
- the extraction and the QM inputs.

The user can review the record, export it, and replay it. This makes an analysis reproducible and gives the *methods/SI* text required by the checklist in §12 of the workflow document.

**Why it is cheap in MONET:**
- Every Python calculation passes through one function, `runAse(kind, command)` in `renderer.js`. It already holds the full command, the active source, the cell options and the atom mapping.
- Derived trajectories pass through `activateTrajectory(path, { label, strideFactor })`.
- The launcher sees every command in `start_monet.py`.

Recording at these points captures everything without touching each analysis.

**Proposed design** (to confirm when writing the plan):

- **Record** (`provenance.js`, a pure module tested in Node): a session object `{ monet_version, started, environment: { python, ase, mdanalysis, numpy, scipy }, sources: [...], steps: [...] }`.
  - Each source: file name, size, **SHA-256** (computed by the launcher when the file is uploaded), format, frames, atoms, cell, time step and unit, MD steps per frame.
  - Each step:
    - `{ id, time, kind, action, source_id, params (the command without file paths), atoms (MONET IDs), result_summary, outputs (derived files with their own hash and parent source), status (ok/error/cleared), note }`;
    - `result_summary` holds the key numbers only (τ, τ_int ± error, t*, stride, t₀, D, plateau, N_eff, …), not the arrays.
- **Capture:**
  - a wrapper around `runAse` that logs the command before the run and the summary after it;
  - hooks in `activateTrajectory`, the extraction, QM input generation, cell apply/load and time-axis changes;
  - one line per kind for the summary extractor, in a table `SUMMARY[kind](result)`.
- **UI:** a *Session log* panel (a sidebar tab or a drawer) with:
  - a timeline of steps: filters, click to show the parameters, per-step notes, *mark as final* (the steps that belong in the paper);
  - a provenance graph: source → derived trajectories → analyses.
- **Exports:**
  - `monet-session.json`: machine-readable, versioned schema `monet-session/1`;
  - `monet-methods.md` (and `.docx` via pandoc when available): a human-readable report. It includes the software versions with citations (MONET concept DOI 10.5281/zenodo.22816521, ASE, MDAnalysis), the input hashes, the steps in order with their parameters and key results, and the reporting checklist of workflow document §12, pre-filled with the logged values;
  - optionally, a `replay.py` script that re-runs the logged bridge commands headless: `python replay.py monet-session.json`, which checks the input hashes first.
- **Persistence:** in the launcher session directory, which is autosaved. *Save session* and *Open session* restore the log and settings; the trajectory itself is re-attached and its hash is checked.
- **Privacy:** paths are stored as file names only, the log stays local, and nothing is uploaded.

**Open questions for the user:**
1. Is logging on by default, with a way to pause it?
2. Should cleared analyses stay in the log, marked *cleared*?
3. Is replay needed from the start, or are the JSON and methods report enough for a first version?
4. Should the methods report be in English only?

**Tests:** `tests/provenance.cjs` covers record building, summaries, the export schema and the report text. In `tests/ase-ui.cjs`, a full flow (load → ACF → accept t* → extraction) must produce the expected steps and parent links. A replay test runs the logged commands through the bridge on `examples/torsion.xyz` and compares the results.

---

## Plan 3: QM loop (C9, C10; C11 after Plan 4)

- **C10, import QM results:** parse the output files of the extracted configurations and match them to their frames by `source_frame` or file name. Start with ORCA and Gaussian (energies, excitation energies, ΔE_ST); Qbox/QE/VASP/CP2K follow. Then show:
  - the running mean ± g-corrected error against the number of configurations (workflow document §11 step 4);
  - the property against any logged coordinate;
  - a polar plot (the radius input already exists).
- **C9, representativeness:** compare the distribution of each chosen coordinate between the subsample and the full or production trajectory, with a two-sample KS test (SciPy) and histogram overlap.
- **C11:** extraction of cluster representatives with population weights. It needs Plan 4.

## Plan 4: Conformational analysis (D12–D17)

- **D12:** clustering on the RMSD matrix, with the Daura cutoff and density peaks; populations with block errors; representative frames.
- **D13:** the pairwise-RMSD distribution of the first half against the second half.
- **D14:** cosine content of the principal components (Hess 2002).
- **D15:** dihedral PCA (cos/sin features).
- **D16:** symmetry-aware RMSD (Hungarian assignment per element).
- **D17:** a convergence metric for distributions (halves or blocks). The metric and threshold must be decided first in §7 of the workflow document.

## Plan 5: ACF fit models (A4)

Bi-exponential and stretched exponential exp[−(t/τ)^β] fits in `correlation_time`, reporting ⟨τ⟩ = (τ/β)Γ(1/β). The UI shows the model, and the slow component sets the stride.

## Plan 6: Structure and dynamics (E18–E23)

- **E18:** force-based g(r) (Borgis 2013) when the file has forces.
- **E19:** H-bond lifetime correlation functions (Luzar–Chandler).
- **E20:** NPT-correct unwrapping (von Bülow 2020).
- **E21:** the Yeh–Hummer correction, given the viscosity.
- **E22:** a log–log MSD with its local slope.
- **E23:** VDOS from saved velocities.

## Plan 7: Sanity checks (F24, F25)

- **F24:** a *Sanity* tab that reads CPMD `ENERGIES`, Qbox `<etotal>`, CP2K `.ener` and GROMACS `.edr` (through `panedr`, which is optional). It plots energy, T, the conserved quantity and the CP fictitious kinetic energy, with their drift.
- **F25:** kinetic-energy distribution tests (Shirts 2013).

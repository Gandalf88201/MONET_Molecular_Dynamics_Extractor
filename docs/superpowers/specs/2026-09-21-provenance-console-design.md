# Analysis history (provenance log) and side console: design

- **Date:** 2026-09-21
- **Roadmap:** Plan 2 in `docs/superpowers/plans/2026-09-18-monet-gaps-roadmap.md`
- **Supports:** §12 of `docs/md-analysis-workflow.md` (reporting checklist)
- **Status:** approved in brainstorming; the implementation plan comes next

## 1. Goal

MONET automatically keeps a **text history** of every step that changes a result on a trajectory. This is not a video or screen recording. The history covers:

- the input file, with its checksum;
- the cell and the time axis;
- each analysis, with its parameters, key numbers and atom IDs;
- derived trajectories;
- extraction and QM inputs;
- cleared analyses;
- exports.

The user can:

- read the history;
- annotate it and mark the steps that go in the paper;
- re-run any step with changed parameters from a side console;
- save and reopen the session;
- export a methods report;
- export a `replay.py` script that reproduces the numbers without the browser.

## 2. Decisions

| # | Question | Decision |
| --- | --- | --- |
| 1 | Is the history on by default? | Yes. It can be paused and resumed at any time. |
| 2 | Cleared analyses | They stay in the history with `status: "cleared"`. |
| 3 | Replay | `replay.py` is included in the first version. |
| 4 | Report language | English only. |
| 5 | Side console | Yes: readable calls, editable, Enter to re-run. MONET analyses only; a real Python terminal comes later. |
| 6 | Replay style | A readable script with one line per step, using the console names. It checks checksums, runs headless, writes CSV/JSON, reports differences from the logged numbers, and can be edited. |
| 7 | What is recorded | Everything that changes a result, listed in §1. View-only actions (rotation, zoom, colours, theme, player) are not recorded. |
| 8 | Persistence | Autosave to `~/.monet/sessions/`, plus a *Save session* / *Open session* ZIP. Opening a session never re-runs anything automatically. |
| 9 | Pausing | No steps are recorded while paused. A `pause`/`resume` pair is added to the history, and the report and replay script warn about the gap. |
| 10 | Console placement | A collapsible drawer on the right. A re-run is a **new** step linked to the original with `rerun_of`. |
| 11 | Architecture | The history lives in the browser (`provenance.js`). The launcher computes checksums and stores the files. The Python module `monet_replay.py` replays the steps. |

Wording: the UI says "History: on / paused". The words "record" or "REC" never appear in the UI.

## 3. Architecture

```
renderer.js ──hooks──▶ provenance.js (pure: session model)
     │                      │
     │                      ├─▶ console.js (call ⇄ command; parser; whitelist)
     │                      ├─▶ report.js  (methods.md text)
     │                      └─▶ replaygen.js (replay.py text)
     ▼
start_monet.py: SHA-256 on upload and derive, autosave, session ZIP (+ pandoc .docx)
     ▼
monet_replay.py: headless replay through the ase_bridge ACTIONS
```

New files:

- `provenance.js`, `console.js`, `report.js` and `replaygen.js`, all UMD like `ase-model.js`. They do not touch the DOM, so they can be tested in Node.
- `monet_replay.py`.
- `tests/provenance.cjs`, `tests/console.cjs`, `tests/report.cjs` and `tests/replay.cjs`.

Changed files:

- `renderer.js` gets the hooks and the drawer UI.
- `index.html` gets the drawer markup.
- `start_monet.py` gets checksums, the autosave endpoints and the session ZIP.
- README and CHANGELOG.

## 4. Data model (`provenance.js`, schema `monet-session/1`)

```js
session = {
  schema: "monet-session/1",
  monet_version, created, updated,
  environment: { python, ase, mdanalysis, numpy, scipy, platform },
  paused: false,
  sources: [{ id: "S1", name: "traj.xyz", size, sha256, format,
              frames, atoms, cell, dt, time_unit, md_steps_per_frame,
              parent: null | { source: "S1", step: 9 } }],
  steps: [{
    id: 7, time,
    kind: "load" | "cell" | "time" | "analysis" | "derive" | "extract" | "qm_input"
        | "export" | "pause" | "resume" | "clear" | "logging_error",
    action: "acf",
    source: "S1",
    call: 'acf(atoms=[228,227,289,225], dt=0.4838, tau_int_method="sokal")',
    params: { ... },        // the full command the bridge received, defaults filled in, file paths removed
    atoms: [228, 227, 289, 225],   // MONET 1-based IDs
    result: { tau_fit: 47.9, tau_int: 44.6, tau_int_err: 13.2 },  // key numbers only
    outputs: [{ source: "S2" } | { file: "acf.csv", sha256 }],
    rerun_of: null | 3,
    status: "ok" | "running" | "error" | "cleared",
    error: null | "message",
    note: "", final: false
  }]
}
```

Rules:

- **Paths.** Files are stored by name only; full paths are never saved. A file is identified by name, size and SHA-256.
- **Append-only.**
  - Steps are never removed.
  - Clearing an analysis sets `status: "cleared"` on the original step and adds a `clear` step that points to it.
  - A re-run is a new step with `rerun_of` set.
- **Key numbers only, no arrays.**
  - `SUMMARY[action](result)` picks the numbers to keep for each analysis.
  - An action with no entry stores `{}`.
  - A test checks that every console-allowed action has an entry.
- **Pausing.**
  - `pause()` appends a `pause` step and `resume()` appends a `resume` step.
  - While paused, `begin()` and `record()` do nothing and return `null`.
  - `hasGaps()` is true when the session contains a pause, and the report and replay warnings use it.
- **API** (pure; no DOM, no network):
  - `create(env)`, `fromJSON(obj)`, `toJSON()`;
  - `addSource(info)`, which returns a source id;
  - `begin(step)`, which returns a step id or `null`;
  - `finish(id, result)`, `fail(id, message)`;
  - `record(step)`, for steps that finish at once;
  - `clear(id)`, `pause()`, `resume()`, `annotate(id, { note, final })`, `hasGaps()`.

## 5. Capture

Hooks in `renderer.js`, one short line at each point every step already passes through:

- **`runAse(kind, command)`** (renderer.js:1590):
  - calls `begin` before sending the command, then `finish` or `fail` when the reply arrives;
  - covers every current analysis and every future one;
  - builds the `call` string from `command` with `console.js`'s formatter.
- **`activateTrajectory(path, { label, strideFactor })`** (renderer.js:336):
  - adds a `derive` step and a new source whose `parent` is the source and step it came from;
  - the launcher returns the checksum of the derived file;
  - derived trajectories come from bridge actions (`subsample`, `frames`, `wrap`, `unwrap`, `mda_align`), so the step records that action and its parameters.
- **One `P.record(...)` line each** in the code for:
  - file load;
  - cell apply/load;
  - time-axis change;
  - extraction;
  - QM input generation;
  - figure and CSV export.
- **The clear buttons** call `P.clear(stepId)`.
  - Each result panel keeps the id of the step that produced it.
- **Safety.**
  - Every hook runs inside try/catch.
  - If logging fails, the analysis still runs and a `logging_error` step is added.
  - The drawer shows a warning once.

## 6. Persistence (launcher)

- **Upload.** `/api/upload` computes the SHA-256 while it writes the file and returns `{ sha256, size }`. Derived files written by the bridge get their checksum in the same way.
- **Autosave.**
  - After each finished step, the browser posts the session to `/api/session/save`, with a 1 s debounce.
  - The launcher writes `~/.monet/sessions/<first 12 hex of sha256>-<safe_name>.json`. It writes a temp file first and then renames it, so a crash can't leave half a file.
- **Resume offer.** When a file with a known checksum is loaded, a prompt offers: *"Previous history found (N steps, date). Continue it / Start new?"*
- **Save session.** The launcher builds a ZIP containing:
  - `session.json`;
  - `methods.md`;
  - `methods.docx`, only if `pandoc` is on PATH;
  - `replay.py`;
  - `README.txt`.
- **Open session.**
  - Reads a ZIP or a `session.json`.
  - Restores the history, the cell, the time axis and the console input history.
  - Asks the user to attach the trajectory and checks name, size and SHA-256.
  - If they don't match, it warns "different file" and offers read-only mode, where the history is visible but the console is off.
  - It never re-runs anything automatically.
- **Privacy.** Nothing leaves the machine and no full paths are stored.

## 7. Console drawer

`console.js` plus a drawer on the right side. The drawer opens with a button or `Ctrl+\``.

**History area**

- One line per step:

  ```
  #7 acf(atoms=[228,227,289,225], dt=0.4838, tau_int_method="sokal") → τ_int=44.6±13.2 fs
  ```

- Cleared steps are greyed out and struck through, pauses show as divider lines, and errors show in red.

**Input**

- Clicking a line copies its call into the input line.
- Enter runs the input, ↑/↓ scroll earlier input, and Esc clears the line.
- The input is off while an analysis is running.

**Grammar**

- A call has the form `name(key=value, ...)`.
- A value is a number, a double-quoted string, `True`/`False`/`None`, or a list of those; lists can be nested.
- The parser is hand-written. It never uses `eval` or `Function`.

**Names**

- The whitelist holds the launcher `ACTIONS` that are analyses:
  - `rmsd`, `rmsd_matrix`, `pdd`, `bonds`, `angles`, `dihedrals`, `rdf`, `msd`, `vdos`, `acf`, `equilibration`, `fluctuations`;
  - `mda_rmsf`, `mda_rgyr`, `mda_hbonds`, `ase_structure`, `ase_coordination`.
- Internal actions are left out: `scan`, `frame`, `read_info`, `convert`, `import`, `extract`, `cell_file`, `frames`, `subsample`, `wrap`, `unwrap`, `mda_align`, `topology`, `molecule`, `select_atoms`, `mda_select`, `mda_run`.
- Allowed parameter keys are a subset of the launcher `ALLOWED` list.
- Internal arguments are never shown and are filled in the same way the buttons fill them. These are the file path, source, cell options and atom mapping.
- `help()` lists the names and `help(acf)` lists that action's parameters.

**Checks**

- An unknown name or parameter is rejected before anything is sent, with a "did you mean" suggestion:

  ```
  acf has no parameter 'lag'. Did you mean 'max_lag'?
  ```

- Values then go through the normal launcher and bridge validation, so the console and the buttons give the same errors.

**Running**

- A call goes through the normal `runAse`, so the result draws in the usual panel.
- That panel's controls are updated to show the parameters used.
- The new step gets `rerun_of` when the input was taken from an earlier step with the same action.

**History tab** (in the same drawer)

- A timeline with filters: analyses, derived trajectories, exports, errors, cleared.
- Step details: parameters, key numbers, and the parent chain, e.g. `S1 → #9 derive → S2 → #12 rmsd`.
- A note field and a ☆ *final* mark on each step.
- The *History: on / paused* toggle.
- Buttons: *Save session*, *Open session*, *Export methods report*, *Export replay.py*.

## 8. Methods report (`report.js`)

`methods.md` is template text only, so the same session always gives the same file. It has these sections:

1. **Warning** (only when `hasGaps()` is true): the history has untracked gaps.
2. **Software:**
   - MONET version and concept DOI 10.5281/zenodo.22816521;
   - Python, ASE, MDAnalysis, NumPy and SciPy versions, with their citations.
3. **Input data:**
   - for each source: name, size, SHA-256, format, frames, atoms, cell, Δt and MD steps per frame;
   - for derived sources: the parent chain.
4. **Analysis steps:**
   - numbered, with the *final* steps first; an export option keeps only the final steps;
   - each step gives its call, its key numbers with errors, and the note.
5. **Reporting checklist:**
   - the checklist from workflow document §12, filled with the logged values: t₀, τ_int with its method, stride and g, N_eff, block SEM, …;
   - items that were never logged are marked *not recorded*.
6. **Gaps:** pauses, errors and cleared steps.

`methods.docx` is built from `methods.md` by the launcher when `pandoc` is available.

## 9. Replay (`replaygen.js` → `replay.py`, `monet_replay.py`)

A generated `replay.py` looks like this:

```python
from monet_replay import Session
s = Session(monet=None, out="replay_out")      # MONET found via --monet or MONET_HOME
S1 = s.load("traj.xyz", sha256="9f2c…", dt=0.4838, time_unit="fs")
s.cell(S1, cell=[...], pbc=True)
s.acf(S1, atoms=[228, 227, 289, 225], tau_int_method="sokal", expect={"tau_int": 44.6})  # step 7
S2 = s.derive(S1, "subsample", stride=184)                                                # step 9
s.rmsd(S2, atoms=[...], expect={...})                                                     # step 12
# step 13 cleared: acf(...)
s.report()
```

**`monet_replay.py`**

- Builds the same commands the browser sends and calls `ase_bridge.ACTIONS[action](cmd)` directly, with no browser.
- Stops if an input checksum doesn't match; `--force` overrides.
- Writes `stepNN_<action>.json` and `.csv` to `out/`.
- Compares each result with `expect` at a relative tolerance of 1e-6 (`--rtol` changes it).
- Prints OK or DIFF with both numbers, and exits with code 1 if any DIFF.

**Derived trajectories**

- They are rebuilt with the same bridge action the browser used.
- Any derive logic that lives only in the front end moves to the bridge as part of this work, so replay and UI share one implementation.

**Special steps**

- Cleared steps, failed steps and pause/resume steps become comments that give the reason.
- When `hasGaps()` is true, the script starts with a gap warning.

## 10. Error handling

| Situation | Behaviour |
| --- | --- |
| A logging hook throws | The analysis still runs, a `logging_error` step is added, and a warning shows once in the drawer. |
| The analysis fails | The step is kept with `status: "error"` and the bridge message. `replay.py` writes it as a comment. |
| Autosave fails | A red "history not saved" badge appears. The copy in memory is kept, the next step tries again, and *Save session* still works. |
| Unknown or newer schema | Refused with "open with MONET ≥ x". The current session is not touched. |
| Broken or incomplete JSON/ZIP | Refused. The current session is not touched. |
| The attached file has a different checksum | A "different file" warning and read-only mode. |
| Console parse error, unknown name or unknown parameter | An inline error. Nothing is sent and no step is added. |
| The console call fails in the bridge | An inline red message and an `error` step. |
| Replay: checksum mismatch | Stops, unless `--force`. |
| Replay: MONET not found | A message explaining `--monet` / `MONET_HOME`. |
| Replay: a result differs | DIFF lines and exit code 1. |

## 11. Tests

- **`tests/provenance.cjs`:**
  - begin, finish, fail, record, clear, pause, resume and annotate;
  - steps recorded as paused;
  - `rerun_of` links and parent chains;
  - `hasGaps`;
  - JSON round trip;
  - schema refusal;
  - a `SUMMARY` entry exists for each console-allowed action.
- **`tests/console.cjs`:**
  - the parser, on valid and invalid input and on injection attempts (`__import__`, attribute access, bad nesting, stray code);
  - format → parse → format gives the same text;
  - "did you mean" suggestions;
  - the whitelist and parameter keys are a subset of `ACTIONS` and `ALLOWED` read from `start_monet.py`.
- **`tests/report.cjs`:**
  - a fixed session gives the stored expected `methods.md`;
  - the gap warning;
  - *not recorded* items in the checklist;
  - the final-steps-only option.
- **`tests/ase-ui.cjs`:**
  - this flow must produce the expected steps, parent links and calls: load → ACF → accept t* (derive) → RMSD on S2 → extraction → export;
  - a console re-run gives a new step with `rerun_of`;
  - pause and resume;
  - the clear button;
  - the autosave request is sent.
- **`tests/replay.cjs`:**
  - the upload response returns the SHA-256;
  - autosave writes the file (temp file, then rename) and reads it back;
  - the session ZIP contents;
  - `replay.py` generated from a logged session on `examples/torsion.xyz` runs headless and gives all OK;
  - a changed input file stops the replay with a checksum error.
- The seven existing suites must still pass.

## 12. Out of scope (version 1)

- Console commands for deriving trajectories, extraction and exports; these steps are logged but run from the buttons only.
- A real Python terminal in the console.
- A drawn provenance graph; version 1 shows parent chains as text.
- Uploading or sharing sessions.
- Video or screen recording of any kind.

## 13. Refinements made while planning

These changes came out of reading the code for the implementation plan (`docs/superpowers/plans/2026-09-21-provenance-console.md`). Where they differ from the sections above, they take precedence.

- **Console names.** The console accepts the 15 analyses the panels actually run:
  - `rmsd`, `rmsd_matrix`, `pdd`, `rdf`, `bonds`, `angles`, `dihedrals`;
  - `msd`, `vdos`, `acf`, `equilibration`, `fluctuations`;
  - `mda_run`, `ase_structure`, `ase_coordination`.

  The unused `mda_rmsf`, `mda_rgyr` and `mda_hbonds` are left out; these analyses run through `mda_run(analysis=…)`.
- **How a console run works.** The console fills the panel's controls and clicks its Run button. Validation, drawing and logging are therefore identical to the buttons. `dt` cannot be changed from the console, because it comes from the time axis.
- **QM inputs.** QM inputs are part of the `extract` step (`params.qm`); there is no separate `qm_input` kind.
- **Exports.** Figure and CSV exports record the file name only. Derived trajectories and the extracted trajectory carry a SHA-256.
- **Key numbers.**
  - A key without `:` is a dotted path into the raw bridge result, and replay compares it exactly.
  - A `stat:` key, such as `mean:rmsd` or `circmean:0-1-2-3`, is computed by MONET for display only.
- **Autosave.**
  - The file name is `<sha256[:12]>-<name>-<created, 14 digits>.json`, so a new history never overwrites an older one.
  - Looking up the history for a file returns the newest one with more than the load step.
- **Opening a different file.** Loading a file whose checksum differs from the opened session asks whether to start a new history; *Cancel* keeps the opened one read-only.
- **Replay runtime.** `monet_replay.py` runs `ase_bridge.py` as a subprocess, exactly as the launcher does.

# Cell section per plane-wave card + units module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every plane-wave card (QE, VASP, CP2K, Qbox) shows and lets the user edit the unit cell (from the applied cell / CIF / trajectory lattice, or custom), and writes it — with the atom positions — in that code's own conventions and units, through one shared Å↔bohr units module.

**Architecture:** New `units.js` (browser + Node) and `monet_units.py` hold the physical constants and cell conversions; both QM engines (`qm-inputs.js`, `monet_qm.py`) use them to render new per-configuration cell/position blocks per code. `qm-resolve.js` carries the per-card cell source, custom cell and format options into the spec; `qm-panel.js` gets a *Cell* section per plane-wave card; `renderer.js` detects the structure cell reliably (applied cell, CIF, first-frame lattice).

**Tech Stack:** Vanilla JS UMD modules, Python 3, Node test scripts.

## Background (what is wrong today)

1. `renderer.js` `qmCellInfo()` (≈ line 614) only sees `aseState.cellParameters` (applied cell) or `player.cells.get(0)`, which is filled asynchronously by the launcher's `fetchFrames`. A lattice that arrives with the trajectory (extended XYZ `Lattice="…"`, or a CIF/cell file given at import, which the importer writes into the extXYZ) is often not visible → the card shows **✖ No cell** and blocks Run, although the engines would find `conf.lattice` per frame.
2. The cards have no cell fields: the user cannot see or change a, b, c, α, β, γ, nor choose how each code writes the cell/positions.
3. Unit constants are scattered (`BOHR` in `qm-inputs.js` and `monet_qm.py`, `RY_FS`/`HA_FS` in `qm-resolve.js`).

## Decisions (user)

- Each code writes its **native default, with options**:
  - **Qbox:** cell and positions in **bohr** (fixed; Qbox requires it).
  - **QE pw.x:** `CELL_PARAMETERS angstrom` (default) | `bohr` | `alat` (with `celldm(1)` = a in bohr); positions Cartesian in the same length unit (for `alat`: `ATOMIC_POSITIONS angstrom`), or `crystal` (fractional).
  - **CP2K:** `ABC [angstrom]` + `ALPHA_BETA_GAMMA` (default) | `A/B/C [angstrom]` vectors; positions Cartesian Å, or `SCALED .TRUE.` (fractional).
  - **VASP:** POSCAR scale `1.0`, lattice vectors in Å (VASP has no bohr option); positions `Cartesian` (default) or `Direct` (fractional).
- **Cell scope: per card.** Each plane-wave card has its own cell, pre-filled from the structure, independent once edited; the Structure-analysis crystal cell is not changed.

## Global Constraints

- Tests: `PYTHON=.venv/bin/python node tests/<suite>.cjs`, each prints `PASS: …`. All existing suites + new `tests/units.cjs` pass at the end of every task.
- JS and Python engines stay **byte-identical** (`tests/qm-parity.cjs`).
- `BOHR_ANGSTROM = 0.529177210903` (CODATA 2018). `HARTREE_EV = 27.211386245988`, `RY_EV = HARTREE_EV / 2`, `AU_TIME_FS = 0.02418884326585747` (Hartree atomic unit of time), `RY_TIME_FS = 2 * AU_TIME_FS`.
- Cell convention (same as ASE and `MonetASEModel.cellVectors`): **a** along x, **b** in the xy plane, **c** completes the right-handed cell; angles α = ∠(b,c), β = ∠(a,c), γ = ∠(a,b), degrees.
- Default outputs unchanged for QE, VASP, Qbox, Gaussian, ORCA (existing parity/resolve expectations keep passing, except where a task says otherwise). CP2K's default cell block changes to `ABC`/`ALPHA_BETA_GAMMA` (new default, decided by the user).
- CP2K `ABC` form is only valid when the cell rows are in the standard orientation (a ∥ x, b in xy, tolerance 1e-6 Å); otherwise the engine writes `A/B/C` vectors and the cell note says so (never rotate the atoms silently).
- Numbers: cell lengths/vectors `toFixed(10)` (JS) / `'%.10f'` (Py); angles `toFixed(6)`; bohr positions `toFixed(8)` (as Qbox today); fractional positions `toFixed(10)`.
- English UI copy; no "record"/"REC". Commit messages end with a `Co-Authored-By` line naming the model that wrote the commit. Never commit `.claude/` or `.superpowers/`.

## File map

| File | Responsibility |
|---|---|
| `units.js` (new) | Constants; `angstromToBohr`, `bohrToAngstrom`, `cellVectors(cellpar)`, `cellParameters(rows)`, `fractional(rows, positions)`, `isStandardOrientation(rows)`. Global `MonetUnits`. |
| `monet_units.py` (new) | Same API in Python (`angstrom_to_bohr`, `cell_vectors`, `cell_parameters`, `fractional`, `is_standard_orientation`). |
| `qm-inputs.js`, `monet_qm.py` | Use the units module; per-code custom cell; new placeholders `{qe_cell_block} {qe_celldm} {qe_positions_block} {cp2k_coords} {vasp_coord_mode} {cell_bohr} {cell_abc}`; `{cp2k_cell}` honours the style. |
| `qm-resolve.js` | Settings `cellSource`, `cellCustom`, `cellUnits` (QE), `cellStyle` (CP2K), `positions`; skeletons use the new blocks; `buildSpec` passes `cell`/`format` per code; readiness/describe updated; RY/HA constants from `units.js`. |
| `qm-panel.js` | *Cell* section per plane-wave card. |
| `renderer.js` | Reliable structure-cell detection; feeds the cards. |
| `index.html`, `start_monet.py`, `tests/ase-ui.cjs`, `tests/history-ui.cjs`, `.github/workflows/tests.yml` | Load/serve/test the new module. |
| `tests/units.cjs` (new), `tests/qm-parity.cjs`, `tests/qm-resolve.cjs`, `tests/ase-ui.cjs` | Tests. |

---

### Task 1: Units module (JS + Python) and constants wiring

**Files:** Create `units.js`, `monet_units.py`, `tests/units.cjs`. Modify `qm-resolve.js` (RY_FS/HA_FS from units), `qm-inputs.js` (`BOHR` from units), `monet_qm.py` (`BOHR` from monet_units), `index.html` (script before `qm-resolve.js`), `start_monet.py` `STATIC` (+`'units.js'`), `tests/ase-ui.cjs` and `tests/history-ui.cjs` eval lists (+`'units.js'` first), `.github/workflows/tests.yml` (+`node tests/units.cjs` before qm-parity).

**Interfaces — Produces:** `MonetUnits = { BOHR_ANGSTROM, HARTREE_EV, RY_EV, AU_TIME_FS, RY_TIME_FS, angstromToBohr(x), bohrToAngstrom(x), cellVectors([a,b,c,α,β,γ]) → 3×3 Å, cellParameters(rows) → [a,b,c,α,β,γ], fractional(rows, positions) → [[f1,f2,f3]…], isStandardOrientation(rows, tol = 1e-6) → bool }`; Python mirrors with snake_case. In Node, `qm-resolve.js` / `qm-inputs.js` `require('./units.js')`; in the browser they read `globalThis.MonetUnits`.

- [ ] **Step 1: failing test** `tests/units.cjs`:

```js
'use strict'
// Units and cell conversions: JavaScript (units.js) and Python (monet_units.py) must agree.
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const U = require('../units.js')
const root = path.resolve(__dirname, '..')
let checks = 0
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`)

assert.equal(U.BOHR_ANGSTROM, 0.529177210903); checks++
close(U.angstromToBohr(1), 1.8897261246257702); close(U.bohrToAngstrom(U.angstromToBohr(3.7)), 3.7, 1e-12); checks++
close(U.RY_TIME_FS, 0.04837768653171494); close(U.RY_EV, 13.605693122994); checks++
// Cell parameters <-> vectors (ASE convention).
const cubic = U.cellVectors([10, 10, 10, 90, 90, 90])
cubic.flat().forEach((v, i) => close(v, [10, 0, 0, 0, 10, 0, 0, 0, 10][i], 1e-12)); checks++
const hex = U.cellVectors([3, 3, 5, 90, 90, 120])
close(hex[1][0], -1.5, 1e-12); close(hex[1][1], 3 * Math.sqrt(3) / 2, 1e-12); close(hex[2][2], 5, 1e-12); checks++
const tri = [10.3528, 13.029, 21.211, 96.2968, 97.439, 98.371]
U.cellParameters(U.cellVectors(tri)).forEach((v, i) => close(v, tri[i], 1e-9)); checks++
assert.equal(U.isStandardOrientation(U.cellVectors(tri)), true); assert.equal(U.isStandardOrientation([[0, 10, 0], [10, 0, 0], [0, 0, 10]]), false); checks++
// Fractional coordinates.
const frac = U.fractional(hex, [[0, 0, 0], [1.5, 3 * Math.sqrt(3) / 2 / 2, 2.5]])
close(frac[1][0], 0.75, 1e-12); close(frac[1][1], 0.5, 1e-12); close(frac[1][2], 0.5, 1e-12); checks++
assert.throws(() => U.cellParameters([[1, 0, 0], [2, 0, 0], [0, 0, 1]]), /degenerate/); checks++
// JS/Python parity.
const cases = { cellpar: tri, rows: U.cellVectors(tri), positions: [[1, 2, 3], [-0.5, 4.25, 7]] }
const js = { bohr: U.angstromToBohr(2.5), vectors: U.cellVectors(tri), params: U.cellParameters(cases.rows), frac: U.fractional(cases.rows, cases.positions), std: U.isStandardOrientation(cases.rows) }
const py = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_units as u
c = json.load(sys.stdin)
print(json.dumps({'bohr': u.angstrom_to_bohr(2.5), 'vectors': u.cell_vectors(c['cellpar']), 'params': u.cell_parameters(c['rows']), 'frac': u.fractional(c['rows'], c['positions']), 'std': u.is_standard_orientation(c['rows'])}))
`, root], { input: JSON.stringify(cases) }))
close(py.bohr, js.bohr, 1e-15); checks++
py.vectors.flat().forEach((v, i) => close(v, js.vectors.flat()[i], 1e-12)); checks++
py.params.forEach((v, i) => close(v, js.params[i], 1e-10)); checks++
py.frac.flat().forEach((v, i) => close(v, js.frac.flat()[i], 1e-12)); assert.equal(py.std, js.std); checks++
console.log(`PASS: ${checks} units checks (bohr, time, cell parameters and vectors, fractional coordinates, JS/Python).`)
```

- [ ] **Step 2:** run → FAIL (`Cannot find module '../units.js'`).

- [ ] **Step 3: implement `units.js`:**

```js
'use strict'

// Physical constants and cell conversions shared by the QM inputs (browser and Node).
// monet_units.py implements the same functions for the Python launcher.
;(function (root) {
  const BOHR_ANGSTROM = 0.529177210903 // CODATA 2018
  const HARTREE_EV = 27.211386245988
  const RY_EV = HARTREE_EV / 2
  const AU_TIME_FS = 0.02418884326585747 // ħ/E_h
  const RY_TIME_FS = 2 * AU_TIME_FS // ħ/Ry

  const angstromToBohr = x => x / BOHR_ANGSTROM
  const bohrToAngstrom = x => x * BOHR_ANGSTROM
  const RAD = Math.PI / 180
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
  const norm = v => Math.sqrt(dot(v, v))
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]

  // a along x, b in the xy plane (ASE convention).
  function cellVectors ([a, b, c, alpha, beta, gamma]) {
    const [ca, cb, cg] = [alpha, beta, gamma].map(v => Math.cos(v * RAD))
    const sg = Math.sin(gamma * RAD)
    const cy = (ca - cb * cg) / sg
    return [[a, 0, 0], [b * cg, b * sg, 0], [c * cb, c * cy, c * Math.sqrt(Math.max(0, 1 - cb * cb - cy * cy))]]
  }

  function cellParameters (rows) {
    const [a, b, c] = rows
    const volume = Math.abs(dot(a, cross(b, c)))
    const lengths = rows.map(norm)
    if (!(volume > 1e-12) || lengths.some(l => !(l > 0))) throw new Error('The cell is degenerate (zero volume).')
    const angle = (u, v) => Math.acos(Math.min(1, Math.max(-1, dot(u, v) / (norm(u) * norm(v))))) / RAD
    return [...lengths, angle(b, c), angle(a, c), angle(a, b)]
  }

  // Fractional coordinates: solve r = f · rows (rows are the cell vectors).
  function fractional (rows, positions) {
    const [a, b, c] = rows
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b)
    const volume = dot(a, bc)
    if (!(Math.abs(volume) > 1e-12)) throw new Error('The cell is degenerate (zero volume).')
    return positions.map(r => [dot(r, bc) / volume, dot(r, ca) / volume, dot(r, ab) / volume])
  }

  const isStandardOrientation = (rows, tol = 1e-6) => Math.abs(rows[0][1]) <= tol && Math.abs(rows[0][2]) <= tol && Math.abs(rows[1][2]) <= tol && rows[0][0] > 0 && rows[1][1] > 0 && rows[2][2] > 0

  const api = { BOHR_ANGSTROM, HARTREE_EV, RY_EV, AU_TIME_FS, RY_TIME_FS, angstromToBohr, bohrToAngstrom, cellVectors, cellParameters, fractional, isStandardOrientation }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetUnits = api
})(globalThis)
```

`monet_units.py`: same constants and functions (`angstrom_to_bohr`, `bohr_to_angstrom`, `cell_vectors`, `cell_parameters`, `fractional`, `is_standard_orientation`) using `math` only, identical formulas and error text (`ValueError('The cell is degenerate (zero volume).')`), returning Python lists of floats.

- [ ] **Step 4: wiring.** `qm-resolve.js`: `RY_FS = U.RY_TIME_FS`, `HA_FS = U.AU_TIME_FS` where `U = node ? require('./units.js') : root.MonetUnits` (keep the exported names `RY_FS`/`HA_FS`); `qm-inputs.js`: `BOHR = U.BOHR_ANGSTROM`; `monet_qm.py`: `from monet_units import BOHR_ANGSTROM as BOHR` (keep the name `BOHR`). `index.html`: `<script src="units.js"></script>` before `qm-resolve.js`. `start_monet.py` STATIC += `'units.js'`. Eval lists in `tests/ase-ui.cjs` and `tests/history-ui.cjs`: `'units.js'` before `'qm-resolve.js'`. CI: `node tests/units.cjs`.
  Existing expectations (`dt = 10.3353`, `set dt 20.6707`, `th_time 4134.1373`) must still pass — the more precise constants round to the same 4 decimals.

- [ ] **Step 5:** run `tests/units.cjs`, `qm-resolve.cjs`, `qm-parity.cjs`, `ase-ui.cjs`, `history-ui.cjs`, `regression.cjs` → PASS. Commit `Units module: bohr, atomic time and cell conversions shared by the QM inputs`.

---

### Task 2: Engines — per-code custom cell, native cell blocks and position modes

**Files:** `qm-inputs.js`, `monet_qm.py`, `qm-resolve.js` (skeleton edits only), `tests/qm-parity.cjs`, `tests/qm-resolve.cjs` (update skeleton-text expectations only where stated).

**Interfaces:**
- Spec per code (new optional keys, validated in both engines):
  - `cell: { rows: 3×3 Å } | null` — custom cell for this code.
  - `format: { cellUnits: 'angstrom'|'bohr'|'alat', cellStyle: 'abc'|'vectors', positions: 'cartesian'|'fractional' }` — defaults `angstrom`, `abc`, `cartesian` when missing (normalize fills them). `cellUnits` only used by QE, `cellStyle` only by CP2K.
- Cell priority per code: `isolated` → **`entry.cell` (custom)** → `spec.cell` (applied) → `conf.lattice` → legacy box (plane-wave, uncentred) → error (plane-wave) / none (molecular). New note for custom: `Cell: custom cell for this code.`
- New per-configuration placeholders (both engines, identical strings):
  - `{cell_bohr}` — rows in bohr, `toFixed(10)`, two spaces between numbers, `\n` between rows.
  - `{cell_abc}` — `a b c alpha beta gamma` (lengths `toFixed(10)`, angles `toFixed(6)`), '' without a cell.
  - `{qe_cell_block}`:
    - `angstrom`: `CELL_PARAMETERS angstrom\n` + `{cell_ang}` (unchanged text)
    - `bohr`: `CELL_PARAMETERS bohr\n` + `{cell_bohr}`
    - `alat`: `CELL_PARAMETERS alat\n` + rows divided by |a| (`toFixed(10)`)
  - `{qe_celldm}`: `alat` → `  celldm(1) = <|a| in bohr, toFixed(10)>\n`; otherwise ''.
  - `{qe_positions_block}`:
    - fractional → `ATOMIC_POSITIONS crystal\n` + lines `El  f1  f2  f3` (`toFixed(10)`, two spaces, trailing `\n`)
    - cartesian + `bohr` → `ATOMIC_POSITIONS bohr\n` + positions in bohr `toFixed(8)`
    - cartesian + `angstrom`/`alat` → `ATOMIC_POSITIONS angstrom\n` + `{coords}` (unchanged text)
  - `{cp2k_cell}`:
    - style `abc` and `isStandardOrientation(rows)` → `      ABC [angstrom] a b c\n      ALPHA_BETA_GAMMA α β γ` (lengths `toFixed(10)`, angles `toFixed(6)`)
    - otherwise (style `vectors`, or a rotated cell) → `      A [angstrom] …\n      B [angstrom] …\n      C [angstrom] …` (`toFixed(10)`, single spaces)
    - With `abc` requested but a non-standard cell, `cell_note` gains ` Cell written as vectors (not in the standard orientation).`
  - `{cp2k_coords}`: fractional → `      SCALED .TRUE.\n` + lines `El  f1  f2  f3\n`; cartesian → `{coords}`.
  - `{vasp_coord_mode}`: `Direct` | `Cartesian`; `{vasp_coords}` follows the mode (fractional `toFixed(10)`; Cartesian unchanged).
  - `{qbox_cell}` and `{qbox_atoms}` are unchanged (already bohr) but computed through `MonetUnits.angstromToBohr` / `angstrom_to_bohr`.
- Skeleton edits in `qm-resolve.js`:
  - QE: replace `CELL_PARAMETERS angstrom\n{cell_ang}\nATOMIC_POSITIONS angstrom\n{coords}` with `{qe_cell_block}\n{qe_positions_block}`, and insert `{qe_celldm}` right after `  ibrav = 0\n`. Default output text must be byte-identical to today (`{qe_celldm}` empty, blocks reproduce the old lines).
  - CP2K: `&COORD\n{coords}    &END COORD` → `&COORD\n{cp2k_coords}    &END COORD`.
  - VASP POSCAR: `Cartesian` → `{vasp_coord_mode}`.
  - Qbox: unchanged.
- Fractional positions are computed from the positions actually written (after centring for the vacuum box).

- [ ] **Step 1: parity tests.** Add cases to `tests/qm-parity.cjs` (spec built with `R.buildSpec`, then set `spec.codes.<code>.cell` / `.format` directly — Task 3 wires them from the cards):
  - QE `bohr` + cartesian with `spec.cell` 10/11/12.5 → contains `CELL_PARAMETERS bohr\n18.8972612463  0.0000000000  0.0000000000` and `ATOMIC_POSITIONS bohr\nC  0.00000000  0.00000000  0.00000000`.
  - QE `alat` → `  celldm(1) = 18.8972612463\n` after `ibrav = 0`, and `CELL_PARAMETERS alat\n1.0000000000  0.0000000000  0.0000000000\n0.0000000000  1.1000000000  0.0000000000\n0.0000000000  0.0000000000  1.2500000000`.
  - QE `crystal` → `ATOMIC_POSITIONS crystal\nC  0.0000000000  0.0000000000  0.0000000000\nO  0.1208900000  -0.0000000091  0.0000000000` (compute and paste the exact second line once from the JS engine; both engines must match).
  - CP2K default (`abc`) with the hexagonal lattice `[[9.1,0,0],[-4.55,7.881,0],[0,0,15]]` → `ABC [angstrom] 9.1000000000 9.1000000000 15.0000000000` and `ALPHA_BETA_GAMMA 90.000000 90.000000 120.000000` (check the 7.881 value gives 120.000000 to 6 decimals; if not, use the exact printed value from the JS engine in both assertions).
  - CP2K `abc` with a rotated cell `[[0,10,0],[-10,0,0],[0,0,10]]` → `A [angstrom] 0.0000000000 10.0000000000 0.0000000000` and the note ` Cell written as vectors (not in the standard orientation).`
  - CP2K fractional → `&COORD\n      SCALED .TRUE.\nC  `.
  - VASP `Direct` → POSCAR line 7 `Direct` and fractional coordinates.
  - A custom per-code cell (`spec.codes.qe.cell = { rows: [[8,0,0],[0,8,0],[0,0,8]] }`) wins over `spec.cell`, with the note `Cell: custom cell for this code.`; the isolated flag still wins over a custom cell.
  - Validation throws (both engines): unknown `cellUnits`, `cellStyle`, `positions`; a custom cell that is not 3×3 finite numbers or is degenerate.
  - Update the existing CP2K expectation `A 13.0400000000 0.0000000000` (isolated default case 0) to the new default: the vacuum box is standard → `ABC [angstrom] 13.0400000000 …` and `ALPHA_BETA_GAMMA 90.000000 90.000000 90.000000`. Update `tests/qm-resolve.cjs` skeleton strings for the CP2K/QE/VASP default templates to the new placeholders.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement in both engines (normalize defaults for `cell`/`format`, validation, cell priority, placeholders), and the skeleton edits in `qm-resolve.js`.
- [ ] **Step 4:** run `qm-parity`, `qm-resolve`, `regression`, `replay`, `ase-ui` → PASS. Legacy/default Gaussian and QE/VASP/Qbox default outputs unchanged (existing assertions). Commit `QM engines: native cell blocks, custom per-code cells and fractional positions`.

---

### Task 3: `qm-resolve.js` — card cell settings, spec, readiness, report

**Files:** `qm-resolve.js`, `tests/qm-resolve.cjs`.

**Interfaces:**
- New settings keys for plane-wave codes in `DEFAULTS` (PW common): `cellSource: 'structure'` (`'structure'|'custom'`), `cellCustom: null` (`[a,b,c,α,β,γ]` in Å/°), `positions: 'cartesian'` (qe/vasp/cp2k; qbox ignores), QE `cellUnits: 'angstrom'`, CP2K `cellStyle: 'abc'`.
- `buildSpec`: per plane-wave code `cell = s.cellSource === 'custom' && s.cellCustom ? { rows: U.cellVectors(s.cellCustom) } : null`; `format = { cellUnits, cellStyle, positions }` (defaults for codes that lack a key); molecular codes `cell: null, format: null`.
- `readiness` changes:
  - "no cell" block only when `!ctx.cell && !s.isolated && s.cellSource !== 'custom'`.
  - `custom` with invalid parameters (not 6 finite numbers, lengths ≤ 0, angles ∉ (0,180), degenerate) → block `<Label>: enter a valid custom cell (positive lengths, angles between 0° and 180°).`
  - `custom` while `ctx.cell?.source === 'trajectory'` → warning `<Label>: the custom cell replaces the trajectory lattice for every configuration.`
  - CP2K hybrid truncation radius uses the effective cell (custom rows when custom).
- `describe`: plane-wave lines add the cell: ` cell a×b×c Å (α/β/γ°)` from the effective cell when known — `describe(code, s, common, cell)` gains an optional 4th argument (rows); `buildSpec` passes custom rows when custom, else `cell` (applied) when given; omit the cell text when unknown.
- [ ] Tests first for each bullet (exact strings above), then implement; run `qm-resolve`, `qm-parity`, `report`. Commit `QM inputs: per-card cell source and custom cell in the spec and readiness checks`.

---

### Task 4: Cards — *Cell* section; renderer — reliable structure-cell detection

**Files:** `qm-panel.js`, `renderer.js`, `styles.css` (small), `tests/ase-ui.cjs`.

**Behaviour:**
- Each plane-wave card gets a *Cell* group placed right after the isolated flag (hidden while *Isolated system* is ticked, which already defines the cell):
  - `qm-<code>-cellSource` select: `structure` → label is the detected source (*Crystal cell applied*, *Cell from <CIF name>*, *Lattice from the trajectory*, or *No cell in the structure*); `custom` → *Custom cell for this code*.
  - Six inputs `qm-<code>-cell-a|b|c|alpha|beta|gamma` (Å, °), pre-filled from the structure cell via `MonetUnits.cellParameters(rows)` (6 decimals). Editing any of them switches the select to `custom`; switching back to `structure` refills them.
  - Format options: QE `qm-qe-cellUnits` (Å / bohr / alat); CP2K `qm-cp2k-cellStyle` (ABC + angles / vectors); `qm-<code>-positions` (Cartesian / fractional — labelled *crystal* for QE, *SCALED* for CP2K, *Direct* for VASP) on qe, vasp, cp2k.
  - A read-only `<pre id="qm-<code>-cell-vectors">` shows the vectors in the code's unit: QE in the chosen unit, VASP Å, CP2K Å, Qbox bohr with the note *Qbox uses bohr (1 bohr = 0.529177210903 Å).*
  - `panel.setStructureCell({ label, rows } | null)` sets the detected source for all plane-wave cards; `read()` returns `cellSource`, `cellCustom` (numbers) and the format keys.
- `renderer.js` `qmCellInfo()` detection, in order:
  1. applied cell (`aseState.cellParameters`) — label *Crystal cell applied*, or *Cell from <name>* when it came from *Load cell file* (remember the file name in `aseState.cellSourceName` in the `cell-load-file` handler; clear it on reset/apply-by-hand);
  2. first-frame lattice from the loaded file: `player.cells.get(0)`, else the lattice parsed from frame 0 of the local file (`MonetXYZ`/xyz.js already parses `Lattice="…"`, see `xyz.js:49` — use the parsed first frame the viewer loads; store it as `state.firstLattice` in `loadFrameForViewer(0)`, cleared in `clearTrajectory`) — label *Lattice from the trajectory* (the importer writes CIF/cell-file lattices into the extXYZ, so this covers a CIF given at import; say *Lattice from the trajectory (cell file <name>)* when `state.source.cellFile` is set);
  3. none.
  Call `qmPanel.setStructureCell(...)` in `updateQmUI()`.
- Card status line (existing) now reflects the effective cell: *Vacuum box (isolated)*, *Custom cell a×b×c Å*, the structure label, or **✖ No cell**.
- [ ] **Tests (ase-ui)**, written first:
  - With a trajectory whose first frame has `Lattice="10 0 0 0 11 0 0 0 12"` (use the mock loader's text in `tests/ase-ui.cjs`), ticking QE shows *Lattice from the trajectory* without any launcher frame fetch, the fields show 10/11/12/90/90/90 and Run is enabled.
  - Applying a cell by *Load cell file* (mock `cell_file` action already returns cellpar) → the QE card label *Cell from <name>*.
  - Editing `qm-qe-cell-a` to 9 switches the source to custom, the preview shows `CELL_PARAMETERS angstrom\n9.0000000000`, and `lastProcessOptions.qm.codes.qe.cell.rows[0][0] === 9` after Run.
  - QE `bohr` → vectors pre shows bohr values; preview has `CELL_PARAMETERS bohr`.
  - CP2K default preview contains `ABC [angstrom]`; `vectors` → `A [angstrom]`.
  - Qbox card shows the bohr note and `set cell 18.8972612463 …` for a 10 Å cubic cell.
  - Without any cell, custom 8/8/8/90/90/90 on VASP releases the block for VASP only.
- [ ] Implement; run `ase-ui`, `history-ui`, `qm-resolve`, `qm-parity` → PASS. Commit `Processing Options: cell section per plane-wave card, native units, reliable structure cell`.

---

### Task 5: Docs and browser check

**Files:** `README.md`, `CHANGELOG.md`.

- README (QM section): the *Cell* group, sources, per-card scope, native units per code (Qbox bohr; QE Å/bohr/alat with crystal positions; CP2K ABC+angles or vectors, SCALED; VASP Å with Direct/Cartesian), the vectors preview, and that the Structure-analysis cell is unchanged by a card's custom cell.
- CHANGELOG `## Unreleased`:
  - `- Plane-wave cards: a Cell section shows the structure cell (applied cell, cell file, trajectory lattice) and accepts a custom cell per code; the cell and positions are written in each code's native units (Qbox bohr; QE angstrom, bohr or alat, crystal positions; CP2K ABC/ALPHA_BETA_GAMMA or vectors, SCALED; VASP Direct or Cartesian).`
  - `- Fixed: a lattice from the loaded file (extended XYZ, or a CIF/cell file given at import) is now recognised on the Processing Options page without waiting for the launcher.`
  - `- Changed: CP2K writes ABC and ALPHA_BETA_GAMMA by default (vectors when the cell is not in the standard orientation).`
  - `- New units module (units.js, monet_units.py): CODATA 2018 bohr, atomic time and cell conversions shared by all QM inputs.`
- Browser check (controller): load `examples/periodic-water.xyz` (has a lattice) → QE/CP2K/VASP/Qbox cards show *Lattice from the trajectory* and the cell fields; switch QE to bohr and CP2K to vectors, check previews; run → ZIP files contain the chosen blocks.
- Run all suites; commit `Docs: cell section per plane-wave card and units module`.

## Self-review notes

- Covers: missing cell fields (T4), unreliable detection incl. CIF at import (T4), native conventions per code with options (T2), per-card scope (T3/T4), Å↔bohr module (T1), parity (T1/T2).
- Placeholder strings and priorities are defined once in Task 2 and consumed in Tasks 3–4.

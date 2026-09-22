# Per-code quantum-chemistry inputs — design

Date: 2026-09-22 · Status: approved in conversation, awaiting written-spec review

## Goal

Step 4 (*Processing Options*) currently shows one shared form (charge, multiplicities, processors, memory, method, basis, vacuum) for every code. That form only fits Gaussian and ORCA: the plane-wave templates hard-code PBE and a cutoff, ignore method/basis, write no KPOINTS, and fall back silently to an extent + vacuum box when no cell exists. Researchers need different calculations, not only singlet/triplet single points.

Replace the shared form with:

1. a shared **Electronic states** row (charge, multiplicities);
2. one **card per selected code** with the settings that code actually needs;
3. an explicit **cell check** for the plane-wave codes that **blocks Run** until a cell exists or the user flags the system as isolated in a vacuum box.

The same settings apply to every extracted configuration.

## Decisions (from the brainstorming)

| Topic | Decision |
|---|---|
| Charge / multiplicities | Shared row, used by every code; each card can override both. |
| Missing cell (QE, VASP, CP2K, Qbox) | Run blocked. The per-card flag **Isolated system: vacuum box** lifts the block and writes the isolated-system settings of that code. |
| Calculation types | Core set: SP, Opt, Opt+Freq, Freq; Gaussian/ORCA also TD-DFT (n states). Dispersion, implicit solvent (Gaussian/ORCA), free *extra keywords* line. |
| Architecture | **A**: the browser resolves code-level settings into the template; both engines fill only per-configuration placeholders. |
| QE frequencies | Optional ph.x input (Γ phonons), checkbox. |
| QE file extension | `.inp` by default (`{tag}.inp`, `ph_{tag}.inp`); names stay editable. |
| ORCA memory | `%maxcore` = memory × *maxcore %* ÷ processors; *maxcore %* editable, default 75. |
| Qbox dispersion | Not offered (extra keywords only). Qbox frequencies not offered. |
| Pseudopotentials | Editable per element on every plane-wave card. |
| Additions (review of the written spec) | MD where the code has it (all six), variable-cell relaxation for the four plane-wave codes, POTCAR assembly from a local library (launcher / desktop app), CP2K hybrids through ADMM. |

## Layout of step 4

1. *Compute average structure* (unchanged).
2. **Codes**: checkboxes Gaussian, ORCA, QE pw.x, VASP, CP2K, Qbox.
3. **Electronic states**: Charge, Multiplicities (e.g. `1 3`; one file per multiplicity per configuration: sing, trip, …).
4. **One collapsible card per checked code.** Every card starts with *Override charge and multiplicities* (checkbox revealing its own two fields) and ends with *Extra keywords*, *Preview* (configuration 1) and the existing *Edit templates* for that code.
5. Status line + **Define cell…** button (opens Structure analysis › Cell) when a plane-wave code is blocked.
6. Output directory, Run.

The old shared fields Processors, Memory, Method, Basis set and Vacuum move into the cards that use them. The old description paragraph is removed.

## Card contents and generated keywords

Defaults in *italics*. `{…}` are template placeholders.

### Gaussian (no cell)

| Field | Values → output |
|---|---|
| Calculation | *SP* (nothing) · Opt → `opt` · Opt+Freq → `opt freq` · Freq → `freq` · TD-DFT → `td=(nstates=N)`, N *10* · MD → `admp(maxpoints=<steps>,stepsize=<dt fs × 10000>)` (ADMP; NVE only, the ensemble selector is fixed to NVE with a note) |
| Reference | *Unrestricted* (`u` prefix) · Auto (`r` for multiplicity 1, `u` otherwise) · Restricted (`r`; open-shell multiplicities fall back to `u` with a warning) |
| Broken-symmetry singlet | off · on → `guess=mix` on multiplicity-1 files |
| Method, Basis | *b3lyp*, *6-31+g(d,p)* |
| Dispersion | *none* · D3BJ → `empiricaldispersion=gd3bj` · D3 → `empiricaldispersion=gd3` |
| Solvent | *none* · SMD + name → `scrf=(smd,solvent=<name>)` |
| SCF | *tight* → `scf=tight` · verytight → `scf=verytight` |
| Processors, Memory | *6*, *4gb* → `%nproc`, `%mem` |
| Extra keywords | appended to the route |

Route: `#p {u|r}{method}/{basis} {calc} maxdisk=300gb nosymm scf={scf} {dispersion} {solvent} gfinput gfoldprint pop=full {extra}` (empty items and double spaces removed). Title: `scf_{state}` for SP, `{calc}_{state}` otherwise (`opt`, `optfreq`, `freq`, `td`).
**Invariant:** the default card renders exactly the legacy `sing.dat` / `trip.dat` text (existing backward-compatibility test).

### ORCA (no cell)

| Field | Values → output |
|---|---|
| Calculation | *SP* · `Opt` · `Opt Freq` · `Freq` · TD-DFT → `%tddft nroots N end`, N *10* · MD → `! MD` + `%md Timestep <dt>_fs Initvel <T>_K [Thermostat CSVR <T>_K Timecon 100_fs] Run <steps> end` |
| Reference | *UKS* · Auto (RKS for multiplicity 1) · RKS (open-shell fall back to UKS with a warning) |
| Method, Basis | *b3lyp*, *6-31+g(d,p)* |
| Dispersion | *none* · `D3BJ` · `D4` |
| Solvent | *none* · CPCM + name → `CPCM(<name>)` |
| SCF | *TightSCF* · `VeryTightSCF` |
| Processors, Memory, maxcore % | *6*, *4gb*, *75* → `%pal nprocs`, `%maxcore = floor(MB × % / 100 / nproc)` |
| Extra keywords | appended to the `!` line |

### Gaussian / ORCA on a periodic trajectory

Warning (not blocking): the configuration is written as an isolated cluster without PBC; molecules cut by the box must be made whole first.

### QE pw.x

| Field | Values → output |
|---|---|
| Calculation | *SP* → `calculation='scf'` · Relax → `'relax'` + `&IONS /` · Freq → scf + ph.x · Relax+Freq → relax + ph.x · vc-relax → `'vc-relax'` + `&IONS /` + `&CELL cell_dofree='all', press=<GPa × 10> /` · MD → `'md'`, `dt=<fs / 0.048378>` (Ry atomic units), `nstep`, `&IONS` with NVT: `ion_temperature='svr'`, `tempw`, `nraise=<τ / dt>`; NVE: `ion_temperature='not_controlled'` |
| ph.x input | checkbox, on by default when a Freq type is chosen → `ph_{tag}.inp`: `&INPUTPH` with `prefix`, `outdir`, `fildyn='{tag}_conf{index}.dyn'`, `tr2_ph=1.0d-14`, `asr` note, then `0.0 0.0 0.0` (Γ) |
| Functional | *from pseudopotentials* (nothing) · `input_dft='pbesol'` / `'pbe0'` / `'hse'` |
| ecutwfc, ecutrho | *50* Ry, *4×* ecutwfc (norm-conserving; 8–12× for US/PAW) |
| k-points | *Γ* → `K_POINTS gamma` · grid → `K_POINTS automatic` + `n1 n2 n3 0 0 0` |
| Dispersion | *none* · D3BJ → `vdw_corr='dft-d3'`, `dftd3_version=4` |
| Pseudopotentials | table element → file, *`{El}.UPF`*; `pseudo_dir` *`./pseudo`* |
| Isolated flag | `assume_isolated='mt'` |
| File names | *`{tag}.inp`*, *`ph_{tag}.inp`* |

Spin/charge as today: `tot_charge`, `nspin`, `tot_magnetization`.

### VASP

| Field | Values → output |
|---|---|
| Calculation | *SP* → `NSW = 0` · Relax → `IBRION = 2`, `ISIF = 2`, `NSW = 200` · Freq → `IBRION = 5`, `NFREE = 2`, `POTIM = 0.015` · Relax+Freq → two INCARs (`INCAR_{tag}_relax`, `INCAR_{tag}_freq`) · vc-relax → `IBRION = 2`, `ISIF = 3`, `NSW = 200`, `PSTRESS = <GPa × 10>` · MD → `IBRION = 0`, `NSW`, `POTIM = <fs>`, `ISYM = 0`, NVT: `MDALGO = 2`, `SMASS = 0`, `TEBEG = TEEND = <T>`; NVE: `MDALGO = 1`, `ANDERSEN_PROB = 0.0`, `TEBEG = <T>` |
| Functional | *PBE* (nothing) · PBEsol → `GGA = PS` · PBE0 → `LHFCALC = .TRUE.`, `AEXX = 0.25` · HSE06 → PBE0 + `HFSCREEN = 0.2` |
| ENCUT | *500* eV |
| k-points | new `KPOINTS` file: *Γ-only* or Γ-centred grid `n1 n2 n3` |
| Dispersion | *none* · D3BJ → `IVDW = 12` · D3 → `IVDW = 11` |
| Spin, smearing | `ISPIN`, `NUPDOWN` from multiplicity; `ISMEAR = 0`, `SIGMA = 0.01` |
| Charge | comment `# NELECT = sum of ZVAL (POTCAR) - {charge}`; with an assembled POTCAR, the exact `NELECT = <Σ ZVAL × count − charge>` line instead (written only when charge ≠ 0) |
| Pseudopotentials | table element → POTCAR variant, *`{El}`* (e.g. `O_s`, `H_h`) → `POTCAR.spec`, one variant per line in POSCAR species order |
| Build POTCAR | checkbox + *POTCAR library folder* (a local folder holding `<variant>/POTCAR`, e.g. `potpaw_PBE.54`). Available with the launcher or the desktop app only (the browser cannot read local folders); the checkbox is disabled otherwise. MONET concatenates the variants in POSCAR species order into `vasp/POTCAR` of each configuration and reads `ZVAL` for `NELECT`. The files never leave the machine and are not shipped with MONET. |
| Isolated flag | `LDIPOL = .TRUE.`, `IDIPOL = 4`, `DIPOL = 0.5 0.5 0.5` (molecule centred) |

### CP2K

| Field | Values → output |
|---|---|
| Run type | *ENERGY* · `GEO_OPT` · `VIBRATIONAL_ANALYSIS` · Opt+Freq → two inputs (`{tag}_opt.inp`, `{tag}_freq.inp`) · vc-relax → `CELL_OPT` + `&MOTION &CELL_OPT EXTERNAL_PRESSURE <GPa × 10000> [bar] TYPE DIRECT_CELL_OPT &END` + `STRESS_TENSOR ANALYTICAL` in `&FORCE_EVAL` · MD → `MD` + `&MOTION &MD ENSEMBLE NVT|NVE STEPS TIMESTEP <fs> TEMPERATURE <T>` and, for NVT, `&THERMOSTAT TYPE CSVR &CSVR TIMECON 100 &END` |
| Functional | *PBE* · BLYP · revPBE (`&XC_FUNCTIONAL` with `&PBE PARAMETRIZATION REVPBE`) · PBE0 · B3LYP · HSE06 (hybrids through ADMM, below) |
| Hybrids (ADMM) | `&AUXILIARY_DENSITY_MATRIX_METHOD METHOD BASIS_PROJECTION ADMM_PURIFICATION_METHOD MO_DIAG EXCH_SCALING_MODEL NONE EXCH_CORRECTION_FUNC <PBEX for PBE0/HSE06, BECKE88X for B3LYP> &END`; each `&KIND` gets `BASIS_SET AUX_FIT <aux>` (*cFIT3*, editable per element) and `BASIS_SET_FILE_NAME BASIS_ADMM` is added. `&HF FRACTION` 0.25 (PBE0, HSE06) or 0.20 (B3LYP), `&SCREENING EPS_SCHWARZ 1.0E-10 SCREEN_ON_INITIAL_P FALSE`, `&MEMORY MAX_MEMORY <MB per process, editable, *2000*>`. Interaction potential: PBE0/B3LYP periodic → `TRUNCATED`, `CUTOFF_RADIUS <min(6, half the shortest cell width − 0.1) Å>`, `T_C_G_DATA t_c_g.dat`; PBE0/B3LYP isolated → `COULOMB`; HSE06 → `SHORTRANGE`, `OMEGA 0.11`. XC: PBE0 → `&PBE SCALE_X 0.75 SCALE_C 1.0`; B3LYP → `&B3LYP`; HSE06 → `&PBE SCALE_X 0.0 SCALE_C 1.0` + `&XWPBE SCALE_X -0.25 SCALE_X0 1.0 OMEGA 0.11`. Potentials GTH-PBE (PBE0, HSE06), GTH-BLYP (B3LYP). |
| CUTOFF, REL_CUTOFF | *400*, *60* Ry |
| k-points | *Γ* (nothing) · grid → `&KPOINTS SCHEME MONKHORST-PACK n1 n2 n3` |
| Dispersion | *none* · D3BJ → `&VDW_POTENTIAL` / `&PAIR_POTENTIAL TYPE DFTD3(BJ)`, `REFERENCE_FUNCTIONAL <functional>`, `PARAMETER_FILE_NAME dftd3.dat` |
| Pseudopotentials | table element → basis *DZVP-MOLOPT-SR-GTH*, potential *GTH-&lt;functional&gt;*; `BASIS_SET_FILE_NAME` *BASIS_MOLOPT*, `POTENTIAL_FILE_NAME` *GTH_POTENTIALS* |
| Isolated flag | `PERIODIC NONE` in `&CELL`; `&POISSON PERIODIC NONE PSOLVER MT &END POISSON` |

Spin/charge as today: `CHARGE`, `MULTIPLICITY`, `UKS`.

### Qbox

| Field | Values → output |
|---|---|
| Calculation | *SP* → `run 0 200 10` · Relax → `set atoms_dyn CG`, `run 50 20 5` · vc-relax → `set atoms_dyn CG`, `set cell_dyn SD`, `set stress ON`, `set ref_stress <P> <P> <P> 0 0 0` (GPa), `run 50 20 5` · MD → `set atoms_dyn MD`, `set dt <fs / 0.0241888>` (Hartree atomic units), NVT: `set thermostat BDP`, `set th_temp <T>`, `set th_time <100 fs in a.u.>`; `run <steps> 10`. Freq types disabled with the note "Qbox has no built-in vibrational analysis". |
| Functional | *PBE* · BLYP · PBE0 · B3LYP · HSE → `set xc` |
| ecut | *70* Ry |
| Pseudopotentials | table element → *`{El}_ONCV_PBE-1.0.xml`* → `species` lines |
| Isolated flag | box only (no Poisson correction); note in the header comment |

Spin/charge as today: `net_charge`, `nspin`, `delta_spin`.

### Shared MD and vc-relax fields

- **MD** (all six codes): ensemble *NVT* · NVE (Gaussian: NVE only), temperature *300* K, time step *0.5* fs, steps *1000*. NVT thermostats: CSVR (ORCA, CP2K), SVR (QE), Nosé–Hoover (VASP), Bussi–Donadio–Parrinello (Qbox), each with a 100 fs time constant.
- **vc-relax** (QE, VASP, CP2K, Qbox): target pressure *0* GPa. Blocked with the isolated flag (a vacuum box must not relax). Warning: raise the cutoff ~30 % to limit Pulay stress.

## Cell handling (plane-wave codes)

Source priority per configuration:

1. applied crystal cell (Structure analysis › Cell);
2. lattice of the trajectory frame (per frame, so NPT trajectories work);
3. none → **✖ blocked** unless the card's *Isolated system: vacuum box* flag is on.

With the flag on: the card shows *Vacuum (Å)* (*10*); the box is orthorhombic, extent + vacuum on each axis, and **the configuration is translated so its centre (midpoint of the extent) sits at the box centre**. Both engines centre identically. The flag is available even when a cell exists (e.g. a molecule cut from a periodic run); it then replaces that cell with the vacuum box.

Each card shows the cell status: *Crystal cell applied (a, b, c, α, β, γ)* · *Lattice from the trajectory* · *Vacuum box (isolated)* · **✖ No cell**.

## Readiness checks (before Run)

`readiness(spec, cellInfo)` returns `{ blocked: [...], warnings: [...] }`; Run is disabled while `blocked` is non-empty and the status line names each code and reason.

Blocking:
- plane-wave code, no cell, isolated flag off;
- missing pseudopotential entry for an element in the selection;
- Freq type selected for Qbox (defensive; the UI disables it);
- TD-DFT with N ≤ 0; invalid grid (any n < 1); invalid cutoff (≤ 0); maxcore % outside 1–100;
- vc-relax with the isolated flag; MD with temperature ≤ 0 (NVT), time step ≤ 0 or steps < 1;
- Build POTCAR on with no library folder, or a variant missing from the library (checked by the launcher before extraction starts);
- existing validation (multiplicities, charge, processors).

Warnings:
- isolated vacuum smaller than the configuration extent on any axis (MT / dipole corrections need a box ≥ 2× the charge density);
- Gaussian/ORCA on a periodic trajectory;
- hybrid functional with a plane-wave code (cost);
- Restricted reference with an open-shell multiplicity (falls back to unrestricted).
- vc-relax: raise the cutoff to limit Pulay stress.
- CP2K PBE0/B3LYP truncation radius below 4 Å (cell too small for the truncated Coulomb operator).

## Architecture (approach A)

**Spec** sent to both engines:

```
common:   { charge, multiplicities }
codes:    { <code>: { override: { charge, multiplicities } | null,
                      isolated: { padding } | null,
                      species:  { <El>: <entry> },
                      files:    [ { name, template } ] } }
cell:     applied crystal cell (3×3, Å) | null
masses:   (as today)
```

- `qm-inputs.js` gains `resolve(code, settings, symbols)` → `{ files, species, isolated, override }`: builds the code-level keyword text from the card fields and substitutes it into the default templates. Per-configuration placeholders (`{coords}`, `{cell_ang}`, `{charge}`, `{mult}`, `{index}`, `{frame}`, spin keys, species blocks, …) stay unfilled.
- A template edited in *Edit templates* is stored as custom and is used as-is instead of the resolved one; the card shows *custom template* and a *Reset* control.
- `render(spec, conf)` in both engines: per code, charge/multiplicities from `override` or `common`; cell from `isolated` (centred vacuum box) or `spec.cell` or `conf.lattice`; species blocks from `species`. No keyword logic in Python.
- `POTCAR.spec` and `KPOINTS` are ordinary template files of the VASP code.
- POTCAR assembly is an engine option (`spec.codes.vasp.potcar = { library }`), not a template: the Python writer (launcher) and `main.js` (desktop app) read `<library>/<variant>/POTCAR` (variant names match `^[A-Za-z0-9_.-]+$`, the resolved path must stay inside the library), concatenate them per configuration in POSCAR order and fill `{vasp_nelect}`. The browser-only bridge rejects the option.
- The Python engine rejects a plane-wave code with no cell source and no `isolated` (defence in depth).

## History and methods report

- The extraction step records the full spec; templates are stored by SHA-256 plus the full text when custom.
- `report.js` adds one line per code, e.g. "Gaussian: UB3LYP/6-31+G(d,p), single point, singlet and triplet, 120 configurations"; "QE pw.x: scf, ecutwfc 50 Ry, Γ, isolated (MT), vacuum 10 Å".

## Testing

- `tests/qm-parity.cjs`: byte-for-byte JS/Python parity for every code × calculation type, override, isolated + centring, custom template, species table, NPT lattice per frame; legacy Gaussian default output unchanged; Python rejects a plane-wave code without a cell.
- New `tests/qm-resolve.cjs`: keyword mapping of each card field (table rows above), `readiness` blocking and warnings.
- `tests/ase-ui.cjs`: cards appear per checked code; old shared fields gone; ✖ blocks Run without a cell and the flag releases it; applied cell releases it; override fields; preview updates; Qbox Freq disabled; Define cell… opens the Cell panel.
- `tests/ase-integration.cjs`: launcher extraction writes `ph_*.inp`, `KPOINTS`, `POTCAR.spec`, centred vacuum-box coordinates.
- `tests/provenance.cjs` / `report.cjs`: spec recorded; per-code report lines.

## Out of scope

NMR/properties, metallic smearing controls, POTCAR assembly in the browser-only mode, multiple calculation sets per run.

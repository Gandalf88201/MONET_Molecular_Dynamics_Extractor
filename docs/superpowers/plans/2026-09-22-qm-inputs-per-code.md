# Per-code quantum-chemistry inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared QM form of step 4 with a shared *Electronic states* row plus one settings card per code (Gaussian, ORCA, QE, VASP, CP2K, Qbox), with a cell check that blocks plane-wave inputs until a cell exists or the system is flagged isolated, and with MD, vc-relax, POTCAR assembly and CP2K hybrids.

**Architecture:** A new browser/Node module `qm-resolve.js` turns card settings into input templates (code-level `[[slot]]` values filled once) and checks readiness. The existing engines (`qm-inputs.js` for the browser/desktop app, `monet_qm.py` for the launcher) keep filling only per-configuration `{placeholders}`, now per code (charge/multiplicity override, centred vacuum box, pseudopotential tables, reference per multiplicity, POTCAR). A new `qm-panel.js` builds the cards in the DOM; `renderer.js` wires them.

**Tech Stack:** Vanilla JS (UMD-style IIFE modules, no bundler), Python 3 + NumPy (launcher), Node test scripts (`node:assert/strict`, jsdom harness in `tests/ase-ui.cjs`).

**Spec:** `docs/superpowers/specs/2026-09-22-qm-inputs-per-code-design.md` — read it; the keyword tables there are normative.

## Global Constraints

- Tests run as `PYTHON=.venv/bin/python node tests/<suite>.cjs`. Every suite prints `PASS: …` on success. All 13 existing suites plus the new `tests/qm-resolve.cjs` must pass at the end of every task.
- JS and Python engines must produce **byte-identical** files for the same spec and configuration (`tests/qm-parity.cjs`).
- **Invariant:** the default Gaussian card renders exactly the legacy text `%nproc=6\n%chk=s0.chk\n%mem=4gb\n#p ub3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight gfinput gfoldprint pop=full\n\nscf_singlet\n\n0 1\n<coords>\n` (files `sing.dat`, `trip.dat` for multiplicities `1 3`).
- Two placeholder syntaxes: `[[slot]]` = code-level, filled by `qm-resolve.js` in the browser; `{key}` = per-configuration, filled by both engines. Unknown `{key}` stay verbatim (existing behaviour).
- Per-configuration keys available to templates: `{charge} {mult} {state} {tag} {chk} {index} {frame} {coords} {nat} {ntyp} {nspin} {unpaired} {delta_spin} {uks} {ref} {ks} {guess} {cell_ang} {cell_note} {qbox_cell} {qbox_species} {qbox_atoms} {qe_species} {qe_magnetization} {vasp_species} {vasp_counts} {vasp_coords} {vasp_potcar_spec} {vasp_nelect} {cp2k_cell} {cp2k_kinds} {cp2k_hf_cutoff}`; legacy specs (with `params`) also get `{nproc} {mem} {maxcore} {method} {basis}`.
- Plane-wave codes: `qe`, `vasp`, `cp2k`, `qbox`. Molecular codes: `gaussian`, `orca`.
- Code keys, folders and labels: `gaussian` → folder `''`, label `Gaussian`; `orca` → `orca`, `ORCA`; `qe` → `qe`, `Quantum ESPRESSO (pw.x)`; `vasp` → `vasp`, `VASP`; `cp2k` → `cp2k`, `CP2K`; `qbox` → `qbox`, `Qbox`.
- Calculation keys: `sp`, `opt`, `optfreq`, `freq`, `td`, `vcrelax`, `md`. Allowed per code: gaussian/orca `sp opt optfreq freq td md`; qe/vasp/cp2k `sp opt optfreq freq vcrelax md`; qbox `sp opt vcrelax md`.
- Time units: `RY_FS = 0.048377687` (QE Rydberg a.u. of time, fs), `HA_FS = 0.0241888433` (Qbox Hartree a.u., fs).
- UI copy: English only; never use the words "record"/"REC" (history wording is "History").
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Never commit `.claude/` or `.superpowers/`.

## File map

| File | Responsibility |
|---|---|
| `qm-resolve.js` (new) | Defaults, skeleton templates, `resolve(code, settings)`, `defaultSpecies`, `buildSpec`, `describe`, `readiness`, `cellWidths`. Browser global `MonetQMResolve`; Node `module.exports`. No DOM. |
| `qm-inputs.js` | Engine: `render(spec, conf, runtime)`, `validate`, `normalize` (legacy specs), `loadPotcar`, `defaultSpec(codes)` (delegates to `qm-resolve.js`). Global `MonetQM`. |
| `monet_qm.py` | Python engine, same behaviour as `qm-inputs.js`; `writer(spec)` also assembles POTCAR. |
| `qm-panel.js` (new) | DOM cards from a field schema; `mount`, `read`, `setSpecies`. Global `MonetQMPanel`. |
| `renderer.js` | Wires panel, readiness, preview, templates editor, Run gating. |
| `index.html`, `styles.css` | Step-4 markup and card styles. |
| `main.js`, `browser-bridge.js` | Pass POTCAR runtime (desktop) / reject POTCAR building (browser-only). |
| `start_monet.py` | Serve the two new static files. |
| `report.js` | Per-code lines in the methods report. |
| `tests/qm-resolve.cjs` (new), `tests/qm-parity.cjs`, `tests/regression.cjs`, `tests/ase-ui.cjs`, `tests/report.cjs` | Tests. |
| `.github/workflows/tests.yml`, `README.md`, `CHANGELOG.md` | CI and docs. |

---

### Task 1: `qm-resolve.js` — defaults, skeletons, Gaussian and ORCA

**Files:**
- Create: `qm-resolve.js`
- Create: `tests/qm-resolve.cjs`

**Interfaces:**
- Produces (used by every later task):
  - `MonetQMResolve.LABELS`, `.PLANE_WAVE` (array), `.CALCS` (code → allowed calc keys), `.CALC_LABELS`, `.DEFAULTS` (code → settings), `.RY_FS`, `.HA_FS`
  - `settingsFor(code, partial) → settings` (deep merge of `partial` over `DEFAULTS[code]`, `md` and `grid` merged too)
  - `resolve(code, settings) → [{ name, template }]` (templates contain only `{key}` placeholders)
  - `memoryMB(text) → number`

- [ ] **Step 1: Write the failing test** — create `tests/qm-resolve.cjs`:

```js
'use strict'
// Code-level keyword mapping of the quantum-chemistry cards (qm-resolve.js).
const assert = require('node:assert/strict')
const R = require('../qm-resolve.js')
let checks = 0
const one = (code, partial) => R.resolve(code, R.settingsFor(code, partial))
const text = (code, partial, i = 0) => one(code, partial)[i].template

// Gaussian: the default card is the legacy template (engine fills {ref} = u, {guess} = '').
assert.deepEqual(one('gaussian', {}).map(f => f.name), ['{tag}.dat']); checks++
assert.equal(text('gaussian', {}), '%nproc=6\n%chk={chk}\n%mem=4gb\n#p {ref}b3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight{guess} gfinput gfoldprint pop=full\n\nscf_{state}\n\n{charge} {mult}\n{coords}\n'); checks++
assert.match(text('gaussian', { calc: 'optfreq' }), /\/6-31\+g\(d,p\) opt freq maxdisk/); assert.match(text('gaussian', { calc: 'optfreq' }), /\n\noptfreq_\{state\}\n/); checks++
assert.match(text('gaussian', { calc: 'td', nstates: 6 }), / td=\(nstates=6\) maxdisk/); checks++
assert.match(text('gaussian', { calc: 'md', md: { timestep: 0.25, steps: 500 } }), / admp\(maxpoints=500,stepsize=2500\) maxdisk/); checks++
assert.match(text('gaussian', { dispersion: 'd3bj', solvent: 'water', scf: 'verytight', extra: 'int=ultrafine' }), /scf=verytight empiricaldispersion=gd3bj scrf=\(smd,solvent=water\)\{guess\} gfinput gfoldprint pop=full int=ultrafine\n/); checks++
assert.match(text('gaussian', { nproc: 12, mem: '32gb', method: 'pbe0', basis: 'def2tzvp' }), /^%nproc=12\n%chk=\{chk\}\n%mem=32gb\n#p \{ref\}pbe0\/def2tzvp /); checks++

// ORCA
assert.deepEqual(one('orca', {}).map(f => f.name), ['{tag}.inp']); checks++
assert.equal(text('orca', {}), '! {ks} b3lyp 6-31+g(d,p) TightSCF\n%pal nprocs 6 end\n%maxcore 500\n# MONET configuration {index} (frame {frame}), {state}\n* xyz {charge} {mult}\n{coords}*\n'); checks++
assert.match(text('orca', { maxcorePct: 100, mem: '8gb', nproc: 4 }), /%maxcore 2000\n/); checks++
assert.match(text('orca', { calc: 'optfreq', dispersion: 'd4', solvent: 'water', scf: 'verytight', extra: 'RIJCOSX def2/J' }), /^! \{ks\} b3lyp 6-31\+g\(d,p\) Opt Freq D4 CPCM\(water\) VeryTightSCF RIJCOSX def2\/J\n/); checks++
assert.match(text('orca', { calc: 'td', nstates: 8 }), /%maxcore 500\n%tddft nroots 8 end\n# MONET/); checks++
assert.match(text('orca', { calc: 'md' }), /^! \{ks\} b3lyp 6-31\+g\(d,p\) MD TightSCF\n[\s\S]*%md\n  Timestep 0.5_fs\n  Initvel 300_K\n  Thermostat CSVR 300_K Timecon 100_fs\n  Run 1000\nend\n# MONET/); checks++
assert.doesNotMatch(text('orca', { calc: 'md', md: { ensemble: 'nve' } }), /Thermostat/); checks++
assert.equal(R.memoryMB('4gb'), 4000); assert.equal(R.memoryMB('500mb'), 500); assert.equal(R.memoryMB('junk'), 4000); checks++
assert.throws(() => R.resolve('gaussian', R.settingsFor('gaussian', { calc: 'vcrelax' })), /not available for Gaussian/); checks++

console.log(`PASS: ${checks} QM resolve checks (Gaussian/ORCA keywords, defaults).`)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/qm-resolve.cjs`
Expected: FAIL with `Cannot find module '../qm-resolve.js'`.

- [ ] **Step 3: Write the implementation** — create `qm-resolve.js`:

```js
'use strict'

// Code-level settings of the quantum-chemistry cards → input templates.
// resolve() fills the [[slot]] values of each code's skeleton once, in the browser; the
// {placeholders} that change per configuration are left for the engines (qm-inputs.js,
// monet_qm.py), which render every extracted configuration identically.
;(function (root) {
  const LABELS = { gaussian: 'Gaussian', orca: 'ORCA', qe: 'Quantum ESPRESSO (pw.x)', vasp: 'VASP', cp2k: 'CP2K', qbox: 'Qbox' }
  const PLANE_WAVE = ['qe', 'vasp', 'cp2k', 'qbox']
  const MOLECULAR_CALCS = ['sp', 'opt', 'optfreq', 'freq', 'td', 'md']
  const PW_CALCS = ['sp', 'opt', 'optfreq', 'freq', 'vcrelax', 'md']
  const CALCS = { gaussian: MOLECULAR_CALCS, orca: MOLECULAR_CALCS, qe: PW_CALCS, vasp: PW_CALCS, cp2k: PW_CALCS, qbox: ['sp', 'opt', 'vcrelax', 'md'] }
  const CALC_LABELS = { sp: 'Single point', opt: 'Geometry optimisation', optfreq: 'Optimisation + frequencies', freq: 'Frequencies', td: 'Excited states (TD-DFT)', vcrelax: 'Variable-cell relaxation', md: 'Molecular dynamics' }
  const RY_FS = 0.048377687
  const HA_FS = 0.0241888433
  const MD = { ensemble: 'nvt', temperature: 300, timestep: 0.5, steps: 1000 }
  const GRID = [1, 1, 1]
  const PW = { isolated: false, padding: 10, pressure: 0, kpoints: 'gamma', grid: GRID, extra: '', species: null, md: MD }
  const DEFAULTS = {
    gaussian: { calc: 'sp', nstates: 10, reference: 'u', brokenSymmetry: false, method: 'b3lyp', basis: '6-31+g(d,p)', dispersion: 'none', solvent: '', scf: 'tight', nproc: 6, mem: '4gb', extra: '', override: null, md: { ...MD, ensemble: 'nve' } },
    orca: { calc: 'sp', nstates: 10, reference: 'u', method: 'b3lyp', basis: '6-31+g(d,p)', dispersion: 'none', solvent: '', scf: 'tight', nproc: 6, mem: '4gb', maxcorePct: 75, extra: '', override: null, md: MD },
    qe: { ...PW, calc: 'sp', phx: false, functional: 'default', ecutwfc: 50, ecutrhoFactor: 4, dispersion: 'none', pseudoDir: './pseudo', override: null },
    vasp: { ...PW, calc: 'sp', functional: 'pbe', encut: 500, dispersion: 'none', buildPotcar: false, potcarLibrary: '', override: null },
    cp2k: { ...PW, calc: 'sp', functional: 'pbe', cutoff: 400, relCutoff: 60, dispersion: 'none', basisFile: 'BASIS_MOLOPT', potentialFile: 'GTH_POTENTIALS', hfMemory: 2000, override: null },
    qbox: { ...PW, calc: 'sp', functional: 'pbe', ecut: 70, override: null }
  }

  function settingsFor (code, partial = {}) {
    if (!DEFAULTS[code]) throw new Error(`Unknown input code ${code}.`)
    const base = DEFAULTS[code]
    return { ...base, ...partial, md: { ...base.md, ...(partial.md || {}) }, grid: [...(partial.grid || base.grid || GRID)] }
  }

  function memoryMB (text) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(gb|mb|g|m)?\s*$/i.exec(String(text))
    if (!match) return 4000
    return Number(match[1]) * (/^g/i.test(match[2] || 'gb') ? 1000 : 1)
  }

  const fixed = (value, digits) => (value + 0).toFixed(digits)
  const fill = (text, slots) => text.replace(/\[\[(\w+)\]\]/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(slots, key)) throw new Error(`Template slot ${key} has no value.`)
    return slots[key]
  })
  const words = text => String(text || '').trim()
  // Unit conversions such as 0.3 GPa × 10 must print 3, not 3.0000000000000004.
  const scaled = (value, factor) => String(Number((value * factor).toPrecision(12)))
  const lines = text => String(text || '').split(/[;\n]/).map(line => line.trim()).filter(Boolean)

  const SKELETONS = {
    gaussian:
`%nproc=[[nproc]]
%chk={chk}
%mem=[[mem]]
#p {ref}[[method]]/[[basis]][[calc]] maxdisk=300gb nosymm scf=[[scf]][[dispersion]][[solvent]]{guess} gfinput gfoldprint pop=full[[extra]]

[[title]]_{state}

{charge} {mult}
{coords}
`,
    orca:
`! {ks} [[method]] [[basis]][[calc]][[dispersion]][[solvent]] [[scf]][[extra]]
%pal nprocs [[nproc]] end
%maxcore [[maxcore]]
[[blocks]]# MONET configuration {index} (frame {frame}), {state}
* xyz {charge} {mult}
{coords}*
`
  }

  function checkCalc (code, s) {
    if (!CALCS[code].includes(s.calc)) throw new Error(`${CALC_LABELS[s.calc] || s.calc} is not available for ${LABELS[code]}.`)
  }

  const RESOLVERS = {
    gaussian (s) {
      const calc = { sp: '', opt: ' opt', optfreq: ' opt freq', freq: ' freq', td: ` td=(nstates=${s.nstates})`, md: ` admp(maxpoints=${s.md.steps},stepsize=${Math.round(s.md.timestep * 10000)})` }[s.calc]
      const slots = {
        nproc: String(s.nproc), mem: words(s.mem), method: words(s.method), basis: words(s.basis), calc, scf: s.scf,
        dispersion: { none: '', d3bj: ' empiricaldispersion=gd3bj', d3: ' empiricaldispersion=gd3' }[s.dispersion],
        solvent: words(s.solvent) ? ` scrf=(smd,solvent=${words(s.solvent)})` : '',
        extra: words(s.extra) ? ' ' + words(s.extra) : '',
        title: s.calc === 'sp' ? 'scf' : s.calc
      }
      return [{ name: '{tag}.dat', template: fill(SKELETONS.gaussian, slots) }]
    },
    orca (s) {
      const md = s.md
      const blocks = s.calc === 'td' ? `%tddft nroots ${s.nstates} end\n`
        : s.calc === 'md' ? `%md\n  Timestep ${md.timestep}_fs\n  Initvel ${md.temperature}_K\n${md.ensemble === 'nvt' ? `  Thermostat CSVR ${md.temperature}_K Timecon 100_fs\n` : ''}  Run ${md.steps}\nend\n` : ''
      const slots = {
        method: words(s.method), basis: words(s.basis),
        calc: { sp: '', opt: ' Opt', optfreq: ' Opt Freq', freq: ' Freq', td: '', md: ' MD' }[s.calc],
        dispersion: { none: '', d3bj: ' D3BJ', d4: ' D4' }[s.dispersion],
        solvent: words(s.solvent) ? ` CPCM(${words(s.solvent)})` : '',
        scf: s.scf === 'verytight' ? 'VeryTightSCF' : 'TightSCF',
        extra: words(s.extra) ? ' ' + words(s.extra) : '',
        nproc: String(s.nproc),
        maxcore: String(Math.floor(memoryMB(s.mem) * s.maxcorePct / 100 / Math.max(1, s.nproc))),
        blocks
      }
      return [{ name: '{tag}.inp', template: fill(SKELETONS.orca, slots) }]
    }
  }

  function resolve (code, settings) {
    checkCalc(code, settings)
    return RESOLVERS[code](settings)
  }

  const api = { LABELS, PLANE_WAVE, CALCS, CALC_LABELS, DEFAULTS, RY_FS, HA_FS, SKELETONS, settingsFor, memoryMB, resolve, fill, fixed, lines, words, scaled }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetQMResolve = api
})(globalThis)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/qm-resolve.cjs`
Expected: `PASS: 16 QM resolve checks (Gaussian/ORCA keywords, defaults).`

- [ ] **Step 5: Commit**

```bash
git add qm-resolve.js tests/qm-resolve.cjs
git commit -m "QM inputs: resolve Gaussian and ORCA card settings into templates

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `qm-resolve.js` — Quantum ESPRESSO and VASP

**Files:**
- Modify: `qm-resolve.js` (add skeletons `qe`, `ph`, `vasp_poscar`, `vasp_incar`, `vasp_kpoints`, `vasp_potcar_spec`; resolvers `qe`, `vasp`)
- Modify: `tests/qm-resolve.cjs` (append before the final `console.log`; update the PASS text to `(keywords per code, defaults)`)

**Interfaces:**
- Consumes: `settingsFor`, `fill`, `fixed`, `lines`, `RY_FS`, `SKELETONS`, `RESOLVERS` from Task 1.
- Produces: `resolve('qe', s)` → `[{name:'{tag}.inp'}]` plus `{name:'ph_{tag}.inp'}` when `s.phx && (s.calc === 'freq' || s.calc === 'optfreq')`; `resolve('vasp', s)` → `POSCAR`, `INCAR_{tag}` (or `INCAR_{tag}_relax` + `INCAR_{tag}_freq` for `optfreq`), `KPOINTS`, `POTCAR.spec`.

- [ ] **Step 1: Append the failing tests** to `tests/qm-resolve.cjs` (before `console.log`):

```js
// Quantum ESPRESSO
assert.deepEqual(one('qe', {}).map(f => f.name), ['{tag}.inp']); checks++
assert.equal(text('qe', {}), "! MONET configuration {index} (frame {frame}), {state}. {cell_note}\n&CONTROL\n  calculation = 'scf'\n  prefix = '{tag}_conf{index}'\n  pseudo_dir = './pseudo'\n  outdir = './tmp'\n/\n&SYSTEM\n  ibrav = 0\n  nat = {nat}\n  ntyp = {ntyp}\n  ecutwfc = 50\n  ecutrho = 200\n  tot_charge = {charge}\n  nspin = {nspin}\n{qe_magnetization}/\n&ELECTRONS\n  conv_thr = 1.0d-8\n/\nATOMIC_SPECIES\n{qe_species}\nCELL_PARAMETERS angstrom\n{cell_ang}\nATOMIC_POSITIONS angstrom\n{coords}K_POINTS gamma\n"); checks++
assert.deepEqual(one('qe', { calc: 'optfreq', phx: true }).map(f => f.name), ['{tag}.inp', 'ph_{tag}.inp']); checks++
assert.match(text('qe', { calc: 'optfreq', phx: true }), /calculation = 'relax'[\s\S]*\/\n&IONS\n\/\nATOMIC_SPECIES/); checks++
assert.equal(text('qe', { calc: 'freq', phx: true }, 1), "MONET configuration {index} (frame {frame}), {state}: Gamma-point phonons after pw.x (apply the acoustic sum rule with dynmat.x)\n&INPUTPH\n  prefix = '{tag}_conf{index}'\n  outdir = './tmp'\n  fildyn = '{tag}_conf{index}.dyn'\n  tr2_ph = 1.0d-14\n/\n0.0 0.0 0.0\n"); checks++
assert.deepEqual(one('qe', { calc: 'freq', phx: false }).map(f => f.name), ['{tag}.inp']); checks++
assert.match(text('qe', { calc: 'vcrelax', pressure: 1.5 }), /calculation = 'vc-relax'[\s\S]*&IONS\n\/\n&CELL\n  cell_dofree = 'all'\n  press = 15\n\/\nATOMIC_SPECIES/); checks++
assert.match(text('qe', { calc: 'vcrelax', pressure: 0.3 }), /  press = 3\n/); checks++
assert.match(text('qe', { calc: 'md' }), /calculation = 'md'\n  prefix = '\{tag\}_conf\{index\}'\n  pseudo_dir = '.\/pseudo'\n  outdir = '.\/tmp'\n  dt = 10.3353\n  nstep = 1000\n\/\n/); checks++
assert.match(text('qe', { calc: 'md' }), /&IONS\n  ion_temperature = 'svr'\n  tempw = 300\n  nraise = 200\n\/\n/); checks++
assert.match(text('qe', { calc: 'md', md: { ensemble: 'nve' } }), /&IONS\n  ion_temperature = 'not_controlled'\n\/\n/); checks++
assert.match(text('qe', { functional: 'pbe0', dispersion: 'd3bj', isolated: true, extra: 'nbnd = 40; occupations = "fixed"', ecutwfc: 60, ecutrhoFactor: 8, pseudoDir: '/pp' }), /pseudo_dir = '\/pp'[\s\S]*ecutwfc = 60\n  ecutrho = 480\n[\s\S]*\{qe_magnetization\}  input_dft = 'pbe0'\n  vdw_corr = 'dft-d3'\n  dftd3_version = 4\n  assume_isolated = 'mt'\n  nbnd = 40\n  occupations = "fixed"\n\/\n/); checks++
assert.match(text('qe', { kpoints: 'grid', grid: [4, 4, 2] }), /\{coords\}K_POINTS automatic\n4 4 2 0 0 0\n$/); checks++

// VASP
assert.deepEqual(one('vasp', {}).map(f => f.name), ['POSCAR', 'INCAR_{tag}', 'KPOINTS', 'POTCAR.spec']); checks++
assert.equal(text('vasp', {}, 0), 'MONET configuration {index} (frame {frame}); atoms grouped by element\n1.0\n{cell_ang}\n{vasp_species}\n{vasp_counts}\nCartesian\n{vasp_coords}\n'); checks++
assert.equal(text('vasp', {}, 1), 'SYSTEM = MONET configuration {index} {state}\n# {cell_note}\n{vasp_nelect}\nENCUT = 500\nISPIN = {nspin}\nNUPDOWN = {unpaired}\nISMEAR = 0\nSIGMA = 0.01\nEDIFF = 1E-6\nNSW = 0\n'); checks++
assert.equal(text('vasp', {}, 2), 'MONET k-points\n0\nGamma\n1 1 1\n0 0 0\n'); checks++
assert.equal(text('vasp', { kpoints: 'grid', grid: [3, 3, 1] }, 2), 'MONET k-points\n0\nGamma\n3 3 1\n0 0 0\n'); checks++
assert.equal(text('vasp', {}, 3), '{vasp_potcar_spec}\n'); checks++
assert.deepEqual(one('vasp', { calc: 'optfreq' }).map(f => f.name), ['POSCAR', 'INCAR_{tag}_relax', 'INCAR_{tag}_freq', 'KPOINTS', 'POTCAR.spec']); checks++
assert.match(text('vasp', { calc: 'optfreq' }, 1), /EDIFF = 1E-6\nIBRION = 2\nISIF = 2\nNSW = 200\n$/); checks++
assert.match(text('vasp', { calc: 'optfreq' }, 2), /EDIFF = 1E-6\nIBRION = 5\nNFREE = 2\nPOTIM = 0.015\nNSW = 1\n$/); checks++
assert.match(text('vasp', { calc: 'vcrelax', pressure: 2 }, 1), /IBRION = 2\nISIF = 3\nNSW = 200\nPSTRESS = 20\n$/); checks++
assert.match(text('vasp', { calc: 'md' }, 1), /IBRION = 0\nNSW = 1000\nPOTIM = 0.5\nISYM = 0\nMDALGO = 2\nSMASS = 0\nTEBEG = 300\nTEEND = 300\n$/); checks++
assert.match(text('vasp', { calc: 'md', md: { ensemble: 'nve', temperature: 250 } }, 1), /ISYM = 0\nMDALGO = 1\nANDERSEN_PROB = 0.0\nTEBEG = 250\n$/); checks++
assert.match(text('vasp', { functional: 'hse06', dispersion: 'd3bj', isolated: true, extra: 'LREAL = Auto; ALGO = All', encut: 400 }, 1), /ENCUT = 400\n[\s\S]*NSW = 0\nLHFCALC = .TRUE.\nHFSCREEN = 0.2\nIVDW = 12\nLDIPOL = .TRUE.\nIDIPOL = 4\nDIPOL = 0.5 0.5 0.5\nLREAL = Auto\nALGO = All\n$/); checks++
assert.match(text('vasp', { functional: 'pbe0' }, 1), /NSW = 0\nLHFCALC = .TRUE.\nAEXX = 0.25\n$/); checks++
assert.match(text('vasp', { functional: 'pbesol', dispersion: 'd3' }, 1), /NSW = 0\nGGA = PS\nIVDW = 11\n$/); checks++
```

- [ ] **Step 2: Run to verify failure**

Run: `node tests/qm-resolve.cjs`
Expected: FAIL (`RESOLVERS[code] is not a function` for `qe`).

- [ ] **Step 3: Implement.** In `qm-resolve.js`, add to `SKELETONS`:

```js
    qe:
`! MONET configuration {index} (frame {frame}), {state}. {cell_note}
&CONTROL
  calculation = '[[calculation]]'
  prefix = '{tag}_conf{index}'
  pseudo_dir = '[[pseudo_dir]]'
  outdir = './tmp'
[[control_extra]]/
&SYSTEM
  ibrav = 0
  nat = {nat}
  ntyp = {ntyp}
  ecutwfc = [[ecutwfc]]
  ecutrho = [[ecutrho]]
  tot_charge = {charge}
  nspin = {nspin}
{qe_magnetization}[[system_extra]]/
&ELECTRONS
  conv_thr = 1.0d-8
/
[[ions_cell]]ATOMIC_SPECIES
{qe_species}
CELL_PARAMETERS angstrom
{cell_ang}
ATOMIC_POSITIONS angstrom
{coords}[[kpoints]]`,
    ph:
`MONET configuration {index} (frame {frame}), {state}: Gamma-point phonons after pw.x (apply the acoustic sum rule with dynmat.x)
&INPUTPH
  prefix = '{tag}_conf{index}'
  outdir = './tmp'
  fildyn = '{tag}_conf{index}.dyn'
  tr2_ph = 1.0d-14
/
0.0 0.0 0.0
`,
    vasp_poscar:
`MONET configuration {index} (frame {frame}); atoms grouped by element
1.0
{cell_ang}
{vasp_species}
{vasp_counts}
Cartesian
{vasp_coords}
`,
    vasp_incar:
`SYSTEM = MONET configuration {index} {state}
# {cell_note}
{vasp_nelect}
ENCUT = [[encut]]
ISPIN = {nspin}
NUPDOWN = {unpaired}
ISMEAR = 0
SIGMA = 0.01
EDIFF = 1E-6
[[body]]`,
    vasp_kpoints: 'MONET k-points\n0\nGamma\n[[grid]]\n0 0 0\n',
    vasp_potcar_spec: '{vasp_potcar_spec}\n'
```

Add to `RESOLVERS`:

```js
    qe (s) {
      const md = s.md
      const kpoints = s.kpoints === 'grid' ? `K_POINTS automatic\n${s.grid.join(' ')} 0 0 0\n` : 'K_POINTS gamma\n'
      const system = [
        ...(s.functional !== 'default' ? [`input_dft = '${s.functional}'`] : []),
        ...(s.dispersion === 'd3bj' ? ["vdw_corr = 'dft-d3'", 'dftd3_version = 4'] : []),
        ...(s.isolated ? ["assume_isolated = 'mt'"] : []),
        ...lines(s.extra)
      ].map(line => `  ${line}\n`).join('')
      const ions = {
        opt: '&IONS\n/\n', optfreq: '&IONS\n/\n',
        vcrelax: `&IONS\n/\n&CELL\n  cell_dofree = 'all'\n  press = ${scaled(s.pressure, 10)}\n/\n`,
        md: md.ensemble === 'nvt'
          ? `&IONS\n  ion_temperature = 'svr'\n  tempw = ${md.temperature}\n  nraise = ${Math.round(100 / md.timestep)}\n/\n`
          : "&IONS\n  ion_temperature = 'not_controlled'\n/\n"
      }[s.calc] || ''
      const slots = {
        calculation: { sp: 'scf', opt: 'relax', optfreq: 'relax', freq: 'scf', vcrelax: 'vc-relax', md: 'md' }[s.calc],
        pseudo_dir: words(s.pseudoDir) || './pseudo',
        control_extra: s.calc === 'md' ? `  dt = ${fixed(md.timestep / RY_FS, 4)}\n  nstep = ${md.steps}\n` : '',
        ecutwfc: String(s.ecutwfc), ecutrho: String(s.ecutwfc * s.ecutrhoFactor),
        system_extra: system, ions_cell: ions, kpoints
      }
      const files = [{ name: '{tag}.inp', template: fill(SKELETONS.qe, slots) }]
      if (s.phx && (s.calc === 'freq' || s.calc === 'optfreq')) files.push({ name: 'ph_{tag}.inp', template: SKELETONS.ph })
      return files
    },
    vasp (s) {
      const md = s.md
      const calcLines = {
        sp: 'NSW = 0\n', opt: 'IBRION = 2\nISIF = 2\nNSW = 200\n', freq: 'IBRION = 5\nNFREE = 2\nPOTIM = 0.015\nNSW = 1\n',
        vcrelax: `IBRION = 2\nISIF = 3\nNSW = 200\nPSTRESS = ${scaled(s.pressure, 10)}\n`,
        md: `IBRION = 0\nNSW = ${md.steps}\nPOTIM = ${md.timestep}\nISYM = 0\n` + (md.ensemble === 'nvt'
          ? `MDALGO = 2\nSMASS = 0\nTEBEG = ${md.temperature}\nTEEND = ${md.temperature}\n`
          : `MDALGO = 1\nANDERSEN_PROB = 0.0\nTEBEG = ${md.temperature}\n`)
      }
      const common = [
        { pbe: '', pbesol: 'GGA = PS\n', pbe0: 'LHFCALC = .TRUE.\nAEXX = 0.25\n', hse06: 'LHFCALC = .TRUE.\nHFSCREEN = 0.2\n' }[s.functional],
        { none: '', d3bj: 'IVDW = 12\n', d3: 'IVDW = 11\n' }[s.dispersion],
        s.isolated ? 'LDIPOL = .TRUE.\nIDIPOL = 4\nDIPOL = 0.5 0.5 0.5\n' : '',
        lines(s.extra).map(line => `${line}\n`).join('')
      ].join('')
      const incar = calc => fill(SKELETONS.vasp_incar, { encut: String(s.encut), body: calcLines[calc] + common })
      const incars = s.calc === 'optfreq'
        ? [{ name: 'INCAR_{tag}_relax', template: incar('opt') }, { name: 'INCAR_{tag}_freq', template: incar('freq') }]
        : [{ name: 'INCAR_{tag}', template: incar(s.calc) }]
      return [
        { name: 'POSCAR', template: SKELETONS.vasp_poscar },
        ...incars,
        { name: 'KPOINTS', template: fill(SKELETONS.vasp_kpoints, { grid: (s.kpoints === 'grid' ? s.grid : [1, 1, 1]).join(' ') }) },
        { name: 'POTCAR.spec', template: SKELETONS.vasp_potcar_spec }
      ]
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `node tests/qm-resolve.cjs`
Expected: `PASS: 44 QM resolve checks (keywords per code, defaults).`

- [ ] **Step 5: Commit**

```bash
git add qm-resolve.js tests/qm-resolve.cjs
git commit -m "QM inputs: resolve Quantum ESPRESSO (with ph.x) and VASP card settings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `qm-resolve.js` — CP2K (with ADMM hybrids) and Qbox

**Files:**
- Modify: `qm-resolve.js` (skeletons `cp2k`, `qbox`; resolvers `cp2k`, `qbox`; export `HYBRIDS`, `isHybrid(code, functional)`)
- Modify: `tests/qm-resolve.cjs`

**Interfaces:**
- Produces: `resolve('cp2k', s)` → `[{name:'{tag}.inp'}]`, or `{tag}_opt.inp` + `{tag}_freq.inp` for `optfreq`; `resolve('qbox', s)` → `[{name:'{tag}.i'}]`; `isHybrid(code, functional) → boolean`; `HYBRIDS = { qe: ['pbe0','hse'], vasp: ['pbe0','hse06'], cp2k: ['pbe0','b3lyp','hse06'], qbox: ['pbe0','b3lyp','hse'] }`.
- Functional keys: cp2k `pbe blyp revpbe pbe0 b3lyp hse06`; qbox `pbe blyp pbe0 b3lyp hse` (written upper-case).

- [ ] **Step 1: Append failing tests:**

```js
// CP2K
assert.deepEqual(one('cp2k', {}).map(f => f.name), ['{tag}.inp']); checks++
assert.equal(text('cp2k', {}), '! MONET configuration {index} (frame {frame}), {state}. {cell_note}\n&GLOBAL\n  PROJECT {tag}_conf{index}\n  RUN_TYPE ENERGY\n&END GLOBAL\n&FORCE_EVAL\n  METHOD Quickstep\n  &DFT\n    BASIS_SET_FILE_NAME BASIS_MOLOPT\n    POTENTIAL_FILE_NAME GTH_POTENTIALS\n    CHARGE {charge}\n    MULTIPLICITY {mult}\n    UKS {uks}\n    &MGRID\n      CUTOFF 400\n      REL_CUTOFF 60\n    &END MGRID\n    &XC\n      &XC_FUNCTIONAL PBE\n      &END XC_FUNCTIONAL\n    &END XC\n  &END DFT\n  &SUBSYS\n    &CELL\n{cp2k_cell}\n      PERIODIC XYZ\n    &END CELL\n    &COORD\n{coords}    &END COORD\n{cp2k_kinds}\n  &END SUBSYS\n&END FORCE_EVAL\n'); checks++
assert.deepEqual(one('cp2k', { calc: 'optfreq' }).map(f => f.name), ['{tag}_opt.inp', '{tag}_freq.inp']); checks++
assert.match(text('cp2k', { calc: 'optfreq' }, 1), /RUN_TYPE VIBRATIONAL_ANALYSIS\n/); checks++
assert.match(text('cp2k', { calc: 'vcrelax', pressure: 1 }), /RUN_TYPE CELL_OPT\n&END GLOBAL\n&MOTION\n  &CELL_OPT\n    EXTERNAL_PRESSURE 10000\n    TYPE DIRECT_CELL_OPT\n  &END CELL_OPT\n&END MOTION\n&FORCE_EVAL\n  METHOD Quickstep\n  STRESS_TENSOR ANALYTICAL\n  &DFT\n/); checks++
assert.match(text('cp2k', { calc: 'md' }), /RUN_TYPE MD\n&END GLOBAL\n&MOTION\n  &MD\n    ENSEMBLE NVT\n    STEPS 1000\n    TIMESTEP 0.5\n    TEMPERATURE 300\n    &THERMOSTAT\n      TYPE CSVR\n      &CSVR\n        TIMECON 100\n      &END CSVR\n    &END THERMOSTAT\n  &END MD\n&END MOTION\n/); checks++
assert.doesNotMatch(text('cp2k', { calc: 'md', md: { ensemble: 'nve' } }), /THERMOSTAT/); assert.match(text('cp2k', { calc: 'md', md: { ensemble: 'nve' } }), /ENSEMBLE NVE\n/); checks++
assert.match(text('cp2k', { isolated: true, kpoints: 'grid', grid: [2, 2, 2], dispersion: 'd3bj', functional: 'blyp', extra: 'SURFACE_DIPOLE_CORRECTION F' }), /    &END MGRID\n    &POISSON\n      PERIODIC NONE\n      PSOLVER MT\n    &END POISSON\n    &KPOINTS\n      SCHEME MONKHORST-PACK 2 2 2\n    &END KPOINTS\n    &XC\n      &XC_FUNCTIONAL BLYP\n      &END XC_FUNCTIONAL\n      &VDW_POTENTIAL\n        POTENTIAL_TYPE PAIR_POTENTIAL\n        &PAIR_POTENTIAL\n          TYPE DFTD3\(BJ\)\n          PARAMETER_FILE_NAME dftd3.dat\n          REFERENCE_FUNCTIONAL BLYP\n        &END PAIR_POTENTIAL\n      &END VDW_POTENTIAL\n    &END XC\n    SURFACE_DIPOLE_CORRECTION F\n  &END DFT\n[\s\S]*PERIODIC NONE\n    &END CELL/); checks++
assert.match(text('cp2k', { functional: 'revpbe' }), /      &XC_FUNCTIONAL\n        &PBE\n          PARAMETRIZATION REVPBE\n        &END PBE\n      &END XC_FUNCTIONAL\n/); checks++
{ const pbe0 = text('cp2k', { functional: 'pbe0', hfMemory: 3000 })
  assert.match(pbe0, /    BASIS_SET_FILE_NAME BASIS_MOLOPT\n    BASIS_SET_FILE_NAME BASIS_ADMM\n    POTENTIAL_FILE_NAME GTH_POTENTIALS\n/); checks++
  assert.match(pbe0, /    &AUXILIARY_DENSITY_MATRIX_METHOD\n      METHOD BASIS_PROJECTION\n      ADMM_PURIFICATION_METHOD MO_DIAG\n      EXCH_SCALING_MODEL NONE\n      EXCH_CORRECTION_FUNC PBEX\n    &END AUXILIARY_DENSITY_MATRIX_METHOD\n    &XC\n      &XC_FUNCTIONAL\n        &PBE\n          SCALE_X 0.75\n          SCALE_C 1.0\n        &END PBE\n      &END XC_FUNCTIONAL\n      &HF\n        FRACTION 0.25\n        &SCREENING\n          EPS_SCHWARZ 1.0E-10\n          SCREEN_ON_INITIAL_P FALSE\n        &END SCREENING\n        &INTERACTION_POTENTIAL\n          POTENTIAL_TYPE TRUNCATED\n          CUTOFF_RADIUS \{cp2k_hf_cutoff\}\n          T_C_G_DATA t_c_g.dat\n        &END INTERACTION_POTENTIAL\n        &MEMORY\n          MAX_MEMORY 3000\n        &END MEMORY\n      &END HF\n    &END XC\n/); checks++ }
assert.match(text('cp2k', { functional: 'pbe0', isolated: true }), /POTENTIAL_TYPE COULOMB\n        &END INTERACTION_POTENTIAL/); checks++
{ const b3lyp = text('cp2k', { functional: 'b3lyp' })
  assert.match(b3lyp, /EXCH_CORRECTION_FUNC BECKE88X\n/); assert.match(b3lyp, /      &XC_FUNCTIONAL B3LYP\n      &END XC_FUNCTIONAL\n      &HF\n        FRACTION 0.20\n/); checks++ }
{ const hse = text('cp2k', { functional: 'hse06' })
  assert.match(hse, /        &PBE\n          SCALE_X 0.0\n          SCALE_C 1.0\n        &END PBE\n        &XWPBE\n          SCALE_X -0.25\n          SCALE_X0 1.0\n          OMEGA 0.11\n        &END XWPBE\n/); assert.match(hse, /POTENTIAL_TYPE SHORTRANGE\n          OMEGA 0.11\n/); checks++ }
assert.equal(R.isHybrid('cp2k', 'hse06'), true); assert.equal(R.isHybrid('vasp', 'pbe'), false); assert.equal(R.isHybrid('qe', 'pbe0'), true); checks++

// Qbox
assert.deepEqual(one('qbox', {}).map(f => f.name), ['{tag}.i']); checks++
assert.equal(text('qbox', {}), '# Qbox input generated by MONET: configuration {index} (frame {frame}), {state}\n# Units are bohr. {cell_note}\nset cell {qbox_cell}\n{qbox_species}\n{qbox_atoms}\nset ecut 70\nset xc PBE\nset wf_dyn PSDA\nset ecutprec 5\nset net_charge {charge}\nset nspin {nspin}\nset delta_spin {delta_spin}\nrandomize_wf\nrun 0 200 10\nsave {tag}_conf{index}.xml\n'); checks++
assert.match(text('qbox', { calc: 'opt', functional: 'pbe0', ecut: 85 }), /set ecut 85\nset xc PBE0\n[\s\S]*set delta_spin \{delta_spin\}\nset atoms_dyn CG\nrandomize_wf\nrun 50 20 5\n/); checks++
assert.match(text('qbox', { calc: 'vcrelax', pressure: 2 }), /set atoms_dyn CG\nset cell_dyn SD\nset stress ON\nset ref_stress 2 2 2 0 0 0\nrandomize_wf\nrun 50 20 5\n/); checks++
assert.match(text('qbox', { calc: 'md' }), /set atoms_dyn MD\nset dt 20.6707\nset thermostat BDP\nset th_temp 300\nset th_time 4134.1373\nrandomize_wf\nrun 1000 10\n/); checks++
assert.match(text('qbox', { isolated: true, extra: 'set scf_tol 1.e-8' }), /# Units are bohr. \{cell_note\}\n# Isolated system: Qbox applies no Poisson correction; keep the vacuum large.\nset cell[\s\S]*set delta_spin \{delta_spin\}\nset scf_tol 1.e-8\nrandomize_wf\n/); checks++
assert.throws(() => R.resolve('qbox', R.settingsFor('qbox', { calc: 'freq' })), /not available for Qbox/); checks++
```

- [ ] **Step 2: Run to verify failure**

Run: `node tests/qm-resolve.cjs` — Expected: FAIL at the first CP2K check.

- [ ] **Step 3: Implement.** Add to `SKELETONS`:

```js
    cp2k:
`! MONET configuration {index} (frame {frame}), {state}. {cell_note}
&GLOBAL
  PROJECT {tag}_conf{index}
  RUN_TYPE [[run_type]]
&END GLOBAL
[[motion]]&FORCE_EVAL
  METHOD Quickstep
[[stress]]  &DFT
    BASIS_SET_FILE_NAME [[basis_file]]
[[admm_basis_file]]    POTENTIAL_FILE_NAME [[potential_file]]
    CHARGE {charge}
    MULTIPLICITY {mult}
    UKS {uks}
    &MGRID
      CUTOFF [[cutoff]]
      REL_CUTOFF [[rel_cutoff]]
    &END MGRID
[[poisson]][[kpoints]][[admm]]    &XC
[[xc]][[vdw]][[hf]]    &END XC
[[dft_extra]]  &END DFT
  &SUBSYS
    &CELL
{cp2k_cell}
      PERIODIC [[periodic]]
    &END CELL
    &COORD
{coords}    &END COORD
{cp2k_kinds}
  &END SUBSYS
&END FORCE_EVAL
`,
    qbox:
`# Qbox input generated by MONET: configuration {index} (frame {frame}), {state}
# Units are bohr. {cell_note}
[[isolated_note]]set cell {qbox_cell}
{qbox_species}
{qbox_atoms}
set ecut [[ecut]]
set xc [[xc]]
set wf_dyn PSDA
set ecutprec 5
set net_charge {charge}
set nspin {nspin}
set delta_spin {delta_spin}
[[calc]][[extra]]randomize_wf
run [[run]]
save {tag}_conf{index}.xml
`
```

Add near the top (after `DEFAULTS`):

```js
  const HYBRIDS = { qe: ['pbe0', 'hse'], vasp: ['pbe0', 'hse06'], cp2k: ['pbe0', 'b3lyp', 'hse06'], qbox: ['pbe0', 'b3lyp', 'hse'] }
  const isHybrid = (code, functional) => (HYBRIDS[code] || []).includes(functional)
  const CP2K_XC = {
    pbe: '      &XC_FUNCTIONAL PBE\n      &END XC_FUNCTIONAL\n',
    blyp: '      &XC_FUNCTIONAL BLYP\n      &END XC_FUNCTIONAL\n',
    revpbe: '      &XC_FUNCTIONAL\n        &PBE\n          PARAMETRIZATION REVPBE\n        &END PBE\n      &END XC_FUNCTIONAL\n',
    pbe0: '      &XC_FUNCTIONAL\n        &PBE\n          SCALE_X 0.75\n          SCALE_C 1.0\n        &END PBE\n      &END XC_FUNCTIONAL\n',
    b3lyp: '      &XC_FUNCTIONAL B3LYP\n      &END XC_FUNCTIONAL\n',
    hse06: '      &XC_FUNCTIONAL\n        &PBE\n          SCALE_X 0.0\n          SCALE_C 1.0\n        &END PBE\n        &XWPBE\n          SCALE_X -0.25\n          SCALE_X0 1.0\n          OMEGA 0.11\n        &END XWPBE\n      &END XC_FUNCTIONAL\n'
  }
  const CP2K_VDW_REFERENCE = { pbe: 'PBE', blyp: 'BLYP', revpbe: 'revPBE', pbe0: 'PBE0', b3lyp: 'B3LYP', hse06: 'HSE06' }
```

Add to `RESOLVERS`:

```js
    cp2k (s) {
      const md = s.md
      const hybrid = isHybrid('cp2k', s.functional)
      const potential = s.functional === 'hse06' ? '          POTENTIAL_TYPE SHORTRANGE\n          OMEGA 0.11\n'
        : s.isolated ? '          POTENTIAL_TYPE COULOMB\n'
        : '          POTENTIAL_TYPE TRUNCATED\n          CUTOFF_RADIUS {cp2k_hf_cutoff}\n          T_C_G_DATA t_c_g.dat\n'
      const motion = {
        vcrelax: `&MOTION\n  &CELL_OPT\n    EXTERNAL_PRESSURE ${scaled(s.pressure, 10000)}\n    TYPE DIRECT_CELL_OPT\n  &END CELL_OPT\n&END MOTION\n`,
        md: `&MOTION\n  &MD\n    ENSEMBLE ${md.ensemble.toUpperCase()}\n    STEPS ${md.steps}\n    TIMESTEP ${md.timestep}\n    TEMPERATURE ${md.temperature}\n` +
          (md.ensemble === 'nvt' ? '    &THERMOSTAT\n      TYPE CSVR\n      &CSVR\n        TIMECON 100\n      &END CSVR\n    &END THERMOSTAT\n' : '') + '  &END MD\n&END MOTION\n'
      }[s.calc] || ''
      const slots = {
        motion,
        stress: s.calc === 'vcrelax' ? '  STRESS_TENSOR ANALYTICAL\n' : '',
        basis_file: words(s.basisFile), potential_file: words(s.potentialFile),
        admm_basis_file: hybrid ? '    BASIS_SET_FILE_NAME BASIS_ADMM\n' : '',
        cutoff: String(s.cutoff), rel_cutoff: String(s.relCutoff),
        poisson: s.isolated ? '    &POISSON\n      PERIODIC NONE\n      PSOLVER MT\n    &END POISSON\n' : '',
        kpoints: s.kpoints === 'grid' ? `    &KPOINTS\n      SCHEME MONKHORST-PACK ${s.grid.join(' ')}\n    &END KPOINTS\n` : '',
        admm: hybrid ? `    &AUXILIARY_DENSITY_MATRIX_METHOD\n      METHOD BASIS_PROJECTION\n      ADMM_PURIFICATION_METHOD MO_DIAG\n      EXCH_SCALING_MODEL NONE\n      EXCH_CORRECTION_FUNC ${s.functional === 'b3lyp' ? 'BECKE88X' : 'PBEX'}\n    &END AUXILIARY_DENSITY_MATRIX_METHOD\n` : '',
        xc: CP2K_XC[s.functional],
        vdw: s.dispersion === 'd3bj' ? `      &VDW_POTENTIAL\n        POTENTIAL_TYPE PAIR_POTENTIAL\n        &PAIR_POTENTIAL\n          TYPE DFTD3(BJ)\n          PARAMETER_FILE_NAME dftd3.dat\n          REFERENCE_FUNCTIONAL ${CP2K_VDW_REFERENCE[s.functional]}\n        &END PAIR_POTENTIAL\n      &END VDW_POTENTIAL\n` : '',
        hf: hybrid ? `      &HF\n        FRACTION ${s.functional === 'b3lyp' ? '0.20' : '0.25'}\n        &SCREENING\n          EPS_SCHWARZ 1.0E-10\n          SCREEN_ON_INITIAL_P FALSE\n        &END SCREENING\n        &INTERACTION_POTENTIAL\n${potential}        &END INTERACTION_POTENTIAL\n        &MEMORY\n          MAX_MEMORY ${s.hfMemory}\n        &END MEMORY\n      &END HF\n` : '',
        dft_extra: lines(s.extra).map(line => `    ${line}\n`).join(''),
        periodic: s.isolated ? 'NONE' : 'XYZ'
      }
      const RUN = { sp: 'ENERGY', opt: 'GEO_OPT', freq: 'VIBRATIONAL_ANALYSIS', vcrelax: 'CELL_OPT', md: 'MD' }
      if (s.calc === 'optfreq') {
        return [
          { name: '{tag}_opt.inp', template: fill(SKELETONS.cp2k, { ...slots, run_type: 'GEO_OPT' }) },
          { name: '{tag}_freq.inp', template: fill(SKELETONS.cp2k, { ...slots, run_type: 'VIBRATIONAL_ANALYSIS' }) }
        ]
      }
      return [{ name: '{tag}.inp', template: fill(SKELETONS.cp2k, { ...slots, run_type: RUN[s.calc] }) }]
    },
    qbox (s) {
      const md = s.md
      const P = s.pressure
      const calc = {
        opt: 'set atoms_dyn CG\n',
        vcrelax: `set atoms_dyn CG\nset cell_dyn SD\nset stress ON\nset ref_stress ${P} ${P} ${P} 0 0 0\n`,
        md: `set atoms_dyn MD\nset dt ${fixed(md.timestep / HA_FS, 4)}\n` + (md.ensemble === 'nvt'
          ? `set thermostat BDP\nset th_temp ${md.temperature}\nset th_time ${fixed(100 / HA_FS, 4)}\n` : '')
      }[s.calc] || ''
      const slots = {
        isolated_note: s.isolated ? '# Isolated system: Qbox applies no Poisson correction; keep the vacuum large.\n' : '',
        ecut: String(s.ecut), xc: s.functional.toUpperCase(), calc,
        extra: lines(s.extra).map(line => `${line}\n`).join(''),
        run: { sp: '0 200 10', opt: '50 20 5', vcrelax: '50 20 5', md: `${md.steps} 10` }[s.calc]
      }
      return [{ name: '{tag}.i', template: fill(SKELETONS.qbox, slots) }]
    }
```

Add `HYBRIDS, isHybrid` to `api`.

- [ ] **Step 4: Run to verify pass**

Run: `node tests/qm-resolve.cjs` — Expected: `PASS: 65 QM resolve checks (keywords per code, defaults).`

- [ ] **Step 5: Commit**

```bash
git add qm-resolve.js tests/qm-resolve.cjs
git commit -m "QM inputs: resolve CP2K (ADMM hybrids, MD, cell optimisation) and Qbox card settings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `qm-resolve.js` — species tables, `buildSpec`, `describe`, `readiness`

**Files:**
- Modify: `qm-resolve.js`
- Modify: `tests/qm-resolve.cjs`

**Interfaces:**
- Produces:
  - `cellWidths(rows) → [wa, wb, wc]` (Å; perpendicular widths `V / |b×c|`, `V / |c×a|`, `V / |a×b|`)
  - `hfCutoff(rows) → number` = `min(6, min(cellWidths(rows)) / 2 - 0.1)`
  - `defaultSpecies(code, symbols, settings) → { El: entry }`, unique elements in first-appearance order. Entries: qe `'<El>.UPF'`; vasp `'<El>'`; qbox `'<El>_ONCV_PBE-1.0.xml'`; cp2k `{ basis: 'DZVP-MOLOPT-SR-GTH', potential: 'GTH-BLYP' for blyp/b3lyp else 'GTH-PBE', aux: 'cFIT3' only when isHybrid }`; gaussian/orca `{}`.
  - `buildSpec({ codes, common, cards, symbols, cell, custom }) → spec` where `common = { charge, multiplicities }`, `cards = { code: partial settings }`, `cell = 3×3 | null`, `custom = { code: { fileIndex: templateText } }`. Output (consumed by engines, Task 5):
    ```
    { common: { charge, multiplicities },
      codes: { <code>: { files, override, isolated: { padding } | null, species, reference, brokenSymmetry, potcar: { library } | null } },
      cell, masses: MASSES (engine fills), summary: { <code>: string } }
    ```
    `reference`: gaussian/orca card value (`'u' | 'auto' | 'r'`), else `'u'`. `brokenSymmetry`: gaussian only. `potcar`: vasp with `buildPotcar` → `{ library: potcarLibrary.trim() }`. `override`: card `override` (`{ charge, multiplicities }` or null).
  - `describe(code, settings, common) → string` (report line; format below).
  - `readiness(codes, cards, ctx) → { blocked: [string], warnings: [string] }`, `cards` = merged settings (with `species`), `ctx = { cell: { source: 'applied' | 'trajectory', rows } | null, extent: [x, y, z] | null, symbols: [..], potcarAvailable: boolean }`.

- [ ] **Step 1: Append failing tests:**

```js
// Species tables, spec, report line, readiness
const syms = ['O', 'H', 'H', 'C']
assert.deepEqual(R.defaultSpecies('qe', syms, R.settingsFor('qe')), { O: 'O.UPF', H: 'H.UPF', C: 'C.UPF' }); checks++
assert.deepEqual(R.defaultSpecies('vasp', syms, R.settingsFor('vasp')), { O: 'O', H: 'H', C: 'C' }); checks++
assert.deepEqual(R.defaultSpecies('qbox', ['O'], R.settingsFor('qbox')), { O: 'O_ONCV_PBE-1.0.xml' }); checks++
assert.deepEqual(R.defaultSpecies('cp2k', ['O'], R.settingsFor('cp2k')), { O: { basis: 'DZVP-MOLOPT-SR-GTH', potential: 'GTH-PBE' } }); checks++
assert.deepEqual(R.defaultSpecies('cp2k', ['O'], R.settingsFor('cp2k', { functional: 'b3lyp' })), { O: { basis: 'DZVP-MOLOPT-SR-GTH', potential: 'GTH-BLYP', aux: 'cFIT3' } }); checks++
assert.deepEqual(R.cellWidths([[10, 0, 0], [0, 12, 0], [0, 0, 8]]).map(v => +v.toFixed(6)), [10, 12, 8]); checks++
assert.equal(+R.hfCutoff([[10, 0, 0], [0, 12, 0], [0, 0, 8]]).toFixed(6), 3.9); assert.equal(R.hfCutoff([[20, 0, 0], [0, 20, 0], [0, 0, 20]]), 6); checks++
{ const spec = R.buildSpec({ codes: ['gaussian', 'vasp'], common: { charge: 0, multiplicities: [1, 3] }, symbols: syms, cell: null,
    cards: { gaussian: { reference: 'auto', brokenSymmetry: true }, vasp: { isolated: true, padding: 12, buildPotcar: true, potcarLibrary: ' /pp ' } }, custom: { vasp: { 1: 'CUSTOM {mult}' } } })
  assert.deepEqual(spec.common, { charge: 0, multiplicities: [1, 3] }); checks++
  assert.equal(spec.codes.gaussian.reference, 'auto'); assert.equal(spec.codes.gaussian.brokenSymmetry, true); assert.equal(spec.codes.gaussian.isolated, null); checks++
  assert.deepEqual(spec.codes.vasp.isolated, { padding: 12 }); assert.deepEqual(spec.codes.vasp.potcar, { library: '/pp' }); assert.deepEqual(spec.codes.vasp.species, { O: 'O', H: 'H', C: 'C' }); checks++
  assert.equal(spec.codes.vasp.files[1].template, 'CUSTOM {mult}'); assert.equal(spec.codes.vasp.files[1].name, 'INCAR_{tag}'); checks++
  assert.equal(spec.summary.gaussian, 'Gaussian: b3lyp/6-31+g(d,p) (auto reference, broken-symmetry singlet), single point, singlet and triplet'); checks++
  assert.equal(spec.summary.vasp, 'VASP: PBE, ENCUT 500 eV, Γ point, single point, isolated (dipole correction, vacuum 12 Å), singlet and triplet'); checks++ }
assert.equal(R.describe('qe', R.settingsFor('qe', { calc: 'md', override: { charge: -1, multiplicities: [2] } }), { charge: 0, multiplicities: [1] }), "QE pw.x: functional from the pseudopotentials, ecutwfc 50 Ry, Γ point, molecular dynamics (NVT, 300 K, 0.5 fs × 1000 steps), charge -1, doublet"); checks++
assert.equal(R.describe('cp2k', R.settingsFor('cp2k', { functional: 'pbe0', kpoints: 'grid', grid: [2, 2, 2], calc: 'vcrelax', pressure: 1 }), { charge: 0, multiplicities: [1] }), 'CP2K: PBE0 (ADMM), CUTOFF 400 Ry, 2×2×2 k-points, variable-cell relaxation (1 GPa), singlet'); checks++

const ready = (codes, cards, ctx) => R.readiness(codes, Object.fromEntries(codes.map(code => [code, { ...R.settingsFor(code, cards[code] || {}), species: (cards[code] || {}).species || R.defaultSpecies(code, ctx.symbols, R.settingsFor(code, cards[code] || {})) }])), ctx)
const noCell = { cell: null, extent: [3, 2, 1], symbols: syms, potcarAvailable: true }
const cubic = { cell: { source: 'applied', rows: [[10, 0, 0], [0, 10, 0], [0, 0, 10]] }, extent: [3, 2, 1], symbols: syms, potcarAvailable: true }
assert.deepEqual(ready(['gaussian', 'orca'], {}, noCell), { blocked: [], warnings: [] }); checks++
assert.deepEqual(ready(['qe'], {}, noCell).blocked, ['Quantum ESPRESSO (pw.x): no cell. Apply a crystal cell (Structure analysis › Cell) or tick “Isolated system: vacuum box”.']); checks++
assert.deepEqual(ready(['qe'], { qe: { isolated: true } }, noCell), { blocked: [], warnings: [] }); checks++
assert.deepEqual(ready(['vasp'], {}, cubic).blocked, []); checks++
assert.deepEqual(ready(['qe'], { qe: { isolated: true, padding: 2 } }, noCell).warnings, ['Quantum ESPRESSO (pw.x): vacuum 2 Å is smaller than the configuration extent (3 Å); isolated-system corrections need a box at least twice the size of the molecule.']); checks++
assert.deepEqual(ready(['qe'], { qe: { species: { O: 'O.UPF', H: '', C: 'C.UPF' } } }, cubic).blocked, ['Quantum ESPRESSO (pw.x): no pseudopotential for H.']); checks++
assert.deepEqual(ready(['cp2k'], { cp2k: { species: { O: { basis: 'X', potential: '' }, H: { basis: 'X', potential: 'Y' }, C: { basis: 'X', potential: 'Y' } } } }, cubic).blocked, ['CP2K: no pseudopotential for O.']); checks++
assert.deepEqual(ready(['gaussian'], { gaussian: { calc: 'td', nstates: 0 } }, noCell).blocked, ['Gaussian: TD-DFT needs at least one excited state.']); checks++
assert.deepEqual(ready(['orca'], { orca: { maxcorePct: 120 } }, noCell).blocked, ['ORCA: maxcore % must be between 1 and 100.']); checks++
assert.deepEqual(ready(['vasp'], { vasp: { kpoints: 'grid', grid: [2, 0, 1] } }, cubic).blocked, ['VASP: k-point grid values must be integers ≥ 1.']); checks++
assert.deepEqual(ready(['qbox'], { qbox: { ecut: 0 } }, cubic).blocked, ['Qbox: the cutoff must be positive.']); checks++
assert.deepEqual(ready(['qbox'], { qbox: { calc: 'freq' } }, cubic).blocked, ['Qbox: Qbox has no built-in vibrational analysis.']); checks++
assert.deepEqual(ready(['vasp'], { vasp: { calc: 'vcrelax', isolated: true } }, noCell).blocked, ['VASP: variable-cell relaxation is not possible with a vacuum box.']); checks++
assert.deepEqual(ready(['cp2k'], { cp2k: { calc: 'md', md: { timestep: 0 } } }, cubic).blocked, ['CP2K: MD needs a positive time step, at least one step and (NVT) a positive temperature.']); checks++
assert.deepEqual(ready(['vasp'], { vasp: { buildPotcar: true } }, cubic).blocked, ['VASP: choose the POTCAR library folder or untick “Build POTCAR”.']); checks++
assert.deepEqual(ready(['vasp'], { vasp: { buildPotcar: true, potcarLibrary: '/pp' } }, { ...cubic, potcarAvailable: false }).blocked, ['VASP: building POTCAR needs the launcher or the desktop app.']); checks++
assert.deepEqual(ready(['orca'], {}, cubic).warnings, ['ORCA: the configuration is written as an isolated cluster without PBC; molecules cut by the box must be made whole first.']); checks++
assert.deepEqual(ready(['vasp'], { vasp: { functional: 'hse06', calc: 'vcrelax' } }, cubic).warnings, ['VASP: hybrid functionals are expensive with plane waves.', 'VASP: raise the cutoff by about 30 % to limit Pulay stress.']); checks++
assert.deepEqual(ready(['cp2k'], { cp2k: { functional: 'pbe0' } }, { ...cubic, cell: { source: 'applied', rows: [[7, 0, 0], [0, 7, 0], [0, 0, 7]] } }).warnings, ['CP2K: hybrid functionals are expensive with plane waves.', 'CP2K: truncation radius 3.4 Å is below 4 Å; the cell is too small for the truncated Coulomb operator.']); checks++
```

- [ ] **Step 2: Run to verify failure** — `node tests/qm-resolve.cjs` → FAIL (`R.defaultSpecies is not a function`).

- [ ] **Step 3: Implement.** Add to `qm-resolve.js`:

```js
  const STATE_NAMES = { 1: 'singlet', 2: 'doublet', 3: 'triplet', 4: 'quartet', 5: 'quintet' }
  const stateList = mults => {
    const names = mults.map(m => STATE_NAMES[m] || `multiplicity ${m}`)
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  }

  function cellWidths (rows) {
    const [a, b, c] = rows
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const norm = v => Math.hypot(v[0], v[1], v[2])
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b)
    const volume = Math.abs(a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2])
    return [volume / norm(bc), volume / norm(ca), volume / norm(ab)]
  }
  const hfCutoff = rows => Math.min(6, Math.min(...cellWidths(rows)) / 2 - 0.1)

  function defaultSpecies (code, symbols, s) {
    const out = {}
    for (const el of new Set(symbols)) {
      if (code === 'qe') out[el] = `${el}.UPF`
      else if (code === 'vasp') out[el] = el
      else if (code === 'qbox') out[el] = `${el}_ONCV_PBE-1.0.xml`
      else if (code === 'cp2k') {
        out[el] = { basis: 'DZVP-MOLOPT-SR-GTH', potential: ['blyp', 'b3lyp'].includes(s.functional) ? 'GTH-BLYP' : 'GTH-PBE' }
        if (isHybrid('cp2k', s.functional)) out[el].aux = 'cFIT3'
      }
    }
    return out
  }

  const FUNCTIONAL_LABELS = { default: 'functional from the pseudopotentials', pbe: 'PBE', pbesol: 'PBEsol', pbe0: 'PBE0', hse: 'HSE', hse06: 'HSE06', blyp: 'BLYP', revpbe: 'revPBE', b3lyp: 'B3LYP' }
  const REFERENCE_LABELS = { u: 'unrestricted', auto: 'auto reference', r: 'restricted' }
  function calcText (code, s) {
    const md = s.md
    if (s.calc === 'md') return `molecular dynamics (${code === 'gaussian' ? 'NVE' : md.ensemble.toUpperCase()}, ${md.temperature} K, ${md.timestep} fs × ${md.steps} steps)`
    if (s.calc === 'vcrelax') return `variable-cell relaxation (${s.pressure} GPa)`
    if (s.calc === 'td') return `excited states (TD-DFT, ${s.nstates} states)`
    return CALC_LABELS[s.calc].toLowerCase()
  }
  function describe (code, s, common) {
    const states = s.override || common
    const charge = states.charge ? `, charge ${states.charge}` : ''
    const kp = s.kpoints === 'grid' ? `${s.grid.join('×')} k-points` : 'Γ point'
    const iso = corr => (s.isolated ? `, isolated (${corr}, vacuum ${s.padding} Å)` : '')
    let head
    if (code === 'gaussian' || code === 'orca') {
      const notes = [REFERENCE_LABELS[s.reference], ...(code === 'gaussian' && s.brokenSymmetry ? ['broken-symmetry singlet'] : [])]
      head = `${LABELS[code]}: ${s.method}/${s.basis} (${notes.join(', ')}), ${calcText(code, s)}`
    } else if (code === 'qe') head = `QE pw.x: ${FUNCTIONAL_LABELS[s.functional]}, ecutwfc ${s.ecutwfc} Ry, ${kp}, ${calcText(code, s)}${iso('MT')}`
    else if (code === 'vasp') head = `VASP: ${FUNCTIONAL_LABELS[s.functional]}, ENCUT ${s.encut} eV, ${kp}, ${calcText(code, s)}${iso('dipole correction')}`
    else if (code === 'cp2k') head = `CP2K: ${FUNCTIONAL_LABELS[s.functional]}${isHybrid('cp2k', s.functional) ? ' (ADMM)' : ''}, CUTOFF ${s.cutoff} Ry, ${kp}, ${calcText(code, s)}${iso('MT Poisson solver')}`
    else head = `Qbox: ${FUNCTIONAL_LABELS[s.functional]}, ecut ${s.ecut} Ry, ${calcText(code, s)}${iso('no Poisson correction')}`
    return `${head}${charge}, ${stateList(states.multiplicities)}`
  }

  function buildSpec ({ codes, common, cards = {}, symbols = [], cell = null, custom = {} }) {
    const spec = { common: { charge: common.charge, multiplicities: [...common.multiplicities] }, codes: {}, cell, summary: {} }
    for (const code of codes) {
      const s = settingsFor(code, cards[code] || {})
      const files = resolve(code, s).map((file, i) => (custom[code] && Object.prototype.hasOwnProperty.call(custom[code], i) ? { ...file, template: custom[code][i] } : file))
      spec.codes[code] = {
        files,
        override: s.override ? { charge: s.override.charge, multiplicities: [...s.override.multiplicities] } : null,
        isolated: PLANE_WAVE.includes(code) && s.isolated ? { padding: s.padding } : null,
        species: s.species || defaultSpecies(code, symbols, s),
        reference: code === 'gaussian' || code === 'orca' ? s.reference : 'u',
        brokenSymmetry: code === 'gaussian' ? Boolean(s.brokenSymmetry) : false,
        potcar: code === 'vasp' && s.buildPotcar ? { library: words(s.potcarLibrary) } : null
      }
      spec.summary[code] = describe(code, s, spec.common)
    }
    return spec
  }

  function readiness (codes, cards, ctx) {
    const blocked = []
    const warnings = []
    const elements = [...new Set(ctx.symbols || [])]
    for (const code of codes) {
      const s = cards[code]
      const label = LABELS[code]
      const pw = PLANE_WAVE.includes(code)
      const block = message => blocked.push(`${label}: ${message}`)
      const warn = message => warnings.push(`${label}: ${message}`)
      if (!CALCS[code].includes(s.calc)) block(code === 'qbox' ? 'Qbox has no built-in vibrational analysis.' : `${CALC_LABELS[s.calc]} is not available.`)
      if (pw && !ctx.cell && !s.isolated) block('no cell. Apply a crystal cell (Structure analysis › Cell) or tick “Isolated system: vacuum box”.')
      if (pw) {
        for (const el of elements) {
          const entry = s.species && s.species[el]
          const missing = code === 'cp2k' ? !entry || !words(entry.basis) || !words(entry.potential) || (isHybrid('cp2k', s.functional) && !words(entry.aux)) : !words(entry)
          if (missing) block(`no pseudopotential for ${el}.`)
        }
      }
      if (s.calc === 'td' && !(Number.isInteger(s.nstates) && s.nstates >= 1)) block('TD-DFT needs at least one excited state.')
      if (code === 'orca' && !(s.maxcorePct >= 1 && s.maxcorePct <= 100)) block('maxcore % must be between 1 and 100.')
      if (pw && s.kpoints === 'grid' && !s.grid.every(n => Number.isInteger(n) && n >= 1)) block('k-point grid values must be integers ≥ 1.')
      const cutoffs = { qe: [s.ecutwfc, s.ecutrhoFactor], vasp: [s.encut], cp2k: [s.cutoff, s.relCutoff], qbox: [s.ecut] }[code] || []
      if (cutoffs.some(v => !(v > 0))) block('the cutoff must be positive.')
      if (s.calc === 'vcrelax' && s.isolated) block('variable-cell relaxation is not possible with a vacuum box.')
      if (s.calc === 'md' && !(s.md.timestep > 0 && Number.isInteger(s.md.steps) && s.md.steps >= 1 && (s.md.ensemble !== 'nvt' || code === 'gaussian' || s.md.temperature > 0))) block('MD needs a positive time step, at least one step and (NVT) a positive temperature.')
      if (code === 'vasp' && s.buildPotcar) {
        if (!words(s.potcarLibrary)) block('choose the POTCAR library folder or untick “Build POTCAR”.')
        else if (!ctx.potcarAvailable) block('building POTCAR needs the launcher or the desktop app.')
      }
      if (pw && s.isolated && ctx.extent) {
        const extent = Math.max(...ctx.extent)
        if (s.padding < extent) warn(`vacuum ${s.padding} Å is smaller than the configuration extent (${Number(extent.toFixed(2))} Å); isolated-system corrections need a box at least twice the size of the molecule.`)
      }
      if (!pw && ctx.cell) warn('the configuration is written as an isolated cluster without PBC; molecules cut by the box must be made whole first.')
      if (pw && isHybrid(code, s.functional)) warn('hybrid functionals are expensive with plane waves.')
      if (s.calc === 'vcrelax') warn('raise the cutoff by about 30 % to limit Pulay stress.')
      if (code === 'cp2k' && ['pbe0', 'b3lyp'].includes(s.functional) && !s.isolated && ctx.cell) {
        const radius = hfCutoff(ctx.cell.rows)
        if (radius < 4) warn(`truncation radius ${Number(radius.toFixed(2))} Å is below 4 Å; the cell is too small for the truncated Coulomb operator.`)
      }
    }
    return { blocked, warnings }
  }
```

Add `cellWidths, hfCutoff, defaultSpecies, buildSpec, describe, readiness` to `api`. Note the Qbox freq message: `readiness` builds `'Qbox: Qbox has no built-in vibrational analysis.'` (test expects exactly this).

- [ ] **Step 4: Run to verify pass** — `node tests/qm-resolve.cjs` → `PASS: 94 QM resolve checks (keywords per code, defaults).`

- [ ] **Step 5: Commit**

```bash
git add qm-resolve.js tests/qm-resolve.cjs
git commit -m "QM inputs: species tables, spec builder, report lines and readiness checks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Engines — per-code rendering in `qm-inputs.js` and `monet_qm.py`

**Files:**
- Modify: `qm-inputs.js` (whole engine; keep `MASSES`, `BOHR`, `STATES`, `stateOf`)
- Modify: `monet_qm.py` (mirror)
- Modify: `tests/qm-parity.cjs` (rewrite cases), `tests/regression.cjs:122-129`
- Modify: `index.html` (load `qm-resolve.js` before `qm-inputs.js`), `start_monet.py:30` (`STATIC` += `'qm-resolve.js'`), `tests/ase-ui.cjs:120` (eval `qm-resolve.js` before `qm-inputs.js`), `main.js:7` (unchanged require works because `qm-inputs.js` requires `./qm-resolve.js` lazily)

**Interfaces:**
- Consumes: `MonetQMResolve.buildSpec`, `settingsFor`, `PLANE_WAVE`, `cellWidths` (Task 4).
- Produces:
  - `MonetQM.CODES` → `{ code: { label, folder } }` (no templates any more)
  - `MonetQM.defaultSpec(codes = ['gaussian'])` → `buildSpec` with default cards, **plane-wave codes isolated** (always renderable), `common = { charge: 0, multiplicities: [1, 3] }`, `masses: MASSES`
  - `MonetQM.normalize(spec) → spec` (legacy `params` specs → new shape; idempotent)
  - `MonetQM.validate(spec) → spec` (normalizes first)
  - `MonetQM.render(spec, conf, runtime = {}) → [{ path, text }]`; `runtime.potcar = { text, zval: { El: number } }` adds `vasp/POTCAR` and exact `NELECT`
  - Python: `monet_qm.normalize`, `validate`, `render(spec, conf, runtime=None) → [(path, text)]`, `writer(spec)` (unchanged signature)

**Engine rules (both languages, identical):**

1. `normalize`: if `spec.params` exists and `spec.common` does not → `common = { charge, multiplicities }` from `params`; `legacy = { nproc, mem, method, basis, padding }`; every code entry gets `override: null, isolated: null, species: {}, reference: 'u', brokenSymmetry: false, potcar: null` when missing. Delete nothing else.
2. Per code, states = `entry.override || spec.common`; files with a `{tag|mult|state|chk}` in the name are rendered once per multiplicity, others once with the first multiplicity (unchanged rule).
3. Cell rows per code: `entry.isolated` → orthorhombic box, side `max(extent_axis + padding, 1)`, positions shifted by `side/2 - (min+max)/2` per axis; else `spec.cell`; else `conf.lattice`; else legacy `spec.legacy.padding` → same centred box; else, for plane-wave codes → error `"<label>: no cell for configuration <index>. Apply a crystal cell or tick “Isolated system: vacuum box”."`; for Gaussian/ORCA → no rows (cell keys empty strings, `cell_note` = `No cell (isolated cluster).`).
4. `cell_note`: isolated/legacy box → `Cell: vacuum box = extent + <pad> A, configuration centred (isolated system).` (`<pad>` via JS `String(n)` / Python `_num`); `spec.cell` → `Cell: applied manual cell.`; lattice → `Cell: from the trajectory.`
5. New keys: `ref` (gaussian): `reference === 'u'` → `u`; `'auto'` → mult 1 `r` else `u`; `'r'` → mult 1 `r` else `ro`. `ks` (orca): same mapping to `UKS` / `RKS` / `ROKS`. `guess`: `' guess=mix'` when `brokenSymmetry && mult === 1`, else `''`.
6. Species: `qe_species` lines `  <El> <mass> <species[El] || El + '.UPF'>`; `qbox_species` `species <el> <species[El] || El + '_ONCV_PBE-1.0.xml'>`; `cp2k_kinds` per element `    &KIND <El>\n      BASIS_SET <basis>\n` + (`aux` ? `      BASIS_SET AUX_FIT <aux>\n` : '') + `      POTENTIAL <potential>\n    &END KIND` (defaults `DZVP-MOLOPT-SR-GTH`, `GTH-PBE`), joined with `\n`; `vasp_potcar_spec` = variants (`species[El] || El`) in species order joined with `\n`.
7. `vasp_nelect`: with `runtime.potcar` → charge ≠ 0: `NELECT = <num(Σ zval[El] × count[El] − charge)>`, charge = 0: `# NELECT: neutral system, taken from POTCAR`; without → `# Net charge <charge>: set NELECT = (sum of ZVAL in POTCAR) - (<charge>) for charged systems.`
8. `cp2k_hf_cutoff`: rows present → `fixed(min(6, min(widths)/2 − 0.1), 4)`, else `''`.
9. Legacy keys (only when `spec.legacy`): `nproc mem method basis`, `maxcore = floor(memoryMB(mem) / max(1, nproc))`.
10. With `runtime.potcar` and a `vasp` entry, also emit `{ path: 'vasp/POTCAR', text: runtime.potcar.text }` once per configuration (after the vasp files).
11. `validate` additionally checks: `common` (same rules as today's multiplicities/charge), each `override` (same rules), `isolated.padding` finite ≥ 0, `reference ∈ {u, auto, r}`, species entry strings / cp2k fields match `^[A-Za-z0-9_.+()-]+$`, `potcar.library` a non-empty string (only meaningful to writers), `summary` optional object of strings. Python additionally rejects a plane-wave code without `isolated` when `spec.cell` is null **at render time** (rule 3).

- [ ] **Step 1: Rewrite `tests/qm-parity.cjs`** (keep the file header, the Python invocation pattern and the `evil` file-name test; replace the cases and assertions):

```js
'use strict'
// The JavaScript (browser/Electron) and Python (launcher) engines must write identical QM inputs.
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const QM = require('../qm-inputs.js')
const R = require('../qm-resolve.js')
const root = path.resolve(__dirname, '..')
let checks = 0

const conf = {
  index: 4, frame: 90, symbols: ['C', 'O', 'H', 'H', 'N'],
  positions: [[0, 0, 0], [1.2089, -0.0000001, 0], [-0.54, 0.93, -0.00001], [-0.54, -0.93, 1e-9], [2.5, 1.125, -3.0000005]]
}
const lattice = [[9.1, 0, 0], [-4.55, 7.881, 0], [0, 0, 15]]
const build = (codes, cards, extra = {}) => ({ ...R.buildSpec({ codes, common: { charge: 0, multiplicities: [1, 3] }, cards, symbols: conf.symbols, cell: null, ...extra }), masses: QM.MASSES })
const cases = []
// 0: every code, defaults, isolated plane-wave codes (centred box)
cases.push([QM.defaultSpec(Object.keys(QM.CODES)), conf, {}])
// 1: charged, override, restricted/auto references, broken symmetry, manual cell
cases.push([build(['gaussian', 'orca', 'qe', 'vasp', 'cp2k', 'qbox'], {
  gaussian: { reference: 'r', brokenSymmetry: true, calc: 'optfreq', override: { charge: -1, multiplicities: [1, 2] } },
  orca: { reference: 'auto', calc: 'td', nstates: 4 },
  qe: { calc: 'optfreq', phx: true, species: { C: 'C.pbe-n-kjpaw.UPF', O: 'O.UPF', H: 'H.UPF', N: 'N.UPF' } },
  vasp: { calc: 'md', species: { C: 'C', O: 'O_s', H: 'H_h', N: 'N' } },
  cp2k: { functional: 'pbe0', calc: 'vcrelax' },
  qbox: { calc: 'md' }
}, { cell: [[10, 0, 0], [0, 11, 0], [0, 0, 12.5]] }), conf, {}])
// 2: trajectory lattice (NPT frame), CP2K HSE06, VASP optfreq
cases.push([build(['vasp', 'cp2k'], { vasp: { calc: 'optfreq' }, cp2k: { functional: 'hse06' } }), { ...conf, lattice }, {}])
// 3: custom template, legacy spec shape
cases.push([build(['gaussian'], {}, { custom: { gaussian: { 0: '{unknown} {ref}{guess} {state}\n{coords}' } } }), conf, {}])
cases.push([{ codes: { gaussian: { folder: '', files: [{ name: 'conf{index}_{tag}.gjf', template: '{mem} {maxcore} {method}/{basis} {nproc}\n' }] }, qe: { folder: 'qe', files: [{ name: '{tag}.pwi', template: '{cell_note}\n{cell_ang}\n' }] } },
  params: { charge: 0, multiplicities: [1], nproc: 6, mem: '4gb', method: 'b3lyp', basis: 'sto-3g', padding: 10 }, masses: QM.MASSES, cell: null }, conf, {}])
// 5: POTCAR runtime, charged
cases.push([build(['vasp'], { vasp: { isolated: true, override: { charge: 1, multiplicities: [2] } } }), conf, { potcar: { text: 'PAW C\nPAW O\nPAW H\nPAW N\n', zval: { C: 4, O: 6, H: 1, N: 5 } } }])

const js = cases.map(([spec, c, runtime]) => QM.render(QM.validate(spec), c, runtime).map(file => [file.path, file.text]))
const py = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
cases = json.load(sys.stdin)
print(json.dumps([[list(item) for item in monet_qm.render(monet_qm.validate(spec), conf, runtime)] for spec, conf, runtime in cases]))
`, root], { input: JSON.stringify(cases) }))
for (let i = 0; i < cases.length; i++) { assert.deepEqual(py[i], js[i], `case ${i}`); checks++ }

// Legacy Gaussian text unchanged with the default card.
const positions = 'O  0.0000000  0.0000000  0.0000000\n'
const legacy = QM.render(QM.defaultSpec(), { index: 1, frame: 0, symbols: ['O'], positions: [[0, 0, 0]] })
assert.deepEqual(legacy.map(file => file.path), ['sing.dat', 'trip.dat']); checks++
assert.equal(legacy[0].text, `%nproc=6\n%chk=s0.chk\n%mem=4gb\n#p ub3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight gfinput gfoldprint pop=full\n\nscf_singlet\n\n0 1\n${positions}\n`); checks++

const text = i => Object.fromEntries(js[i])
// References, broken symmetry, override
assert.match(text(1)['sing.dat'], /#p rb3lyp\/6-31\+g\(d,p\) opt freq maxdisk=300gb nosymm scf=tight guess=mix gfinput/); checks++
assert.match(text(1)['doub.dat'], /#p rob3lyp\/[\s\S]*\n-1 2\n/); assert.equal(text(1)['trip.dat'], undefined); checks++
assert.match(text(1)['orca/sing.inp'], /^! RKS /); assert.match(text(1)['orca/trip.inp'], /^! UKS /); checks++
// Species tables, ph.x, VASP POTCAR.spec, MD
assert.match(text(1)['qe/sing.inp'], /  C 12.011 C.pbe-n-kjpaw.UPF\n/); assert.ok(text(1)['qe/ph_trip.inp']); checks++
assert.equal(text(1)['vasp/POTCAR.spec'], 'C\nO_s\nH_h\nN\n'); assert.match(text(1)['vasp/INCAR_sing'], /MDALGO = 2\n/); checks++
// Manual cell wins over nothing; CP2K truncation radius from the cell (min width 10 → 4.9)
assert.match(text(1)['cp2k/sing.inp'], /CUTOFF_RADIUS 4.9000\n/); assert.match(text(1)['cp2k/sing.inp'], /BASIS_SET AUX_FIT cFIT3\n/); checks++
assert.match(text(1)['qe/sing.inp'], /! MONET configuration 4 \(frame 90\), singlet. Cell: applied manual cell.\n/); checks++
// Isolated: centred box. Extent x: -0.54..2.5 (3.04) + 10 = 13.04, centre shift 6.52 - 0.98 = 5.54
assert.match(text(0)['cp2k/sing.inp'], /A 13.0400000000 0.0000000000 0.0000000000\n/); checks++
assert.match(text(0)['qe/sing.inp'], /ATOMIC_POSITIONS angstrom\nC  5.5400000  /); checks++
assert.match(text(0)['qe/sing.inp'], /Cell: vacuum box = extent \+ 10 A, configuration centred \(isolated system\)./); checks++
// Trajectory lattice per frame
assert.match(text(2)['vasp/POSCAR'], /-4.5500000000  7.8810000000/); assert.match(text(2)['vasp/INCAR_sing_relax'], /# Cell: from the trajectory.\n/); checks++
// Custom template and legacy shape
assert.match(text(3)['sing.dat'], /^\{unknown\} u singlet\nC  0.0000000/); checks++
assert.equal(text(4)['conf4_sing.gjf'], '4gb 666 b3lyp/sto-3g 6\n'); assert.match(text(4)['qe/sing.pwi'], /^Cell: vacuum box = extent \+ 10 A/); checks++
// POTCAR runtime and exact NELECT: 4 + 6 + 2·1 + 5 − 1 = 16
assert.equal(text(5)['vasp/POTCAR'], 'PAW C\nPAW O\nPAW H\nPAW N\n'); assert.match(text(5)['vasp/INCAR_doub'], /\nNELECT = 16\n/); checks++
assert.match(text(0)['vasp/INCAR_sing'], /\n# Net charge 0: set NELECT = \(sum of ZVAL in POTCAR\) - \(0\) for charged systems.\n/); checks++

// Plane-wave code without any cell: both engines refuse.
const bare = build(['qe'], {})
assert.throws(() => QM.render(QM.validate(bare), conf), /no cell for configuration 4/); checks++
assert.throws(() => execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
spec, conf = json.load(sys.stdin)
monet_qm.render(monet_qm.validate(spec), conf)
`, root], { input: JSON.stringify([bare, conf]), stdio: 'pipe' })); checks++

// Validation
for (const bad of [{ multiplicities: [] }, { multiplicities: [1, 1] }, { charge: 0.5 }]) {
  const spec = QM.defaultSpec(); Object.assign(spec.common, bad)
  assert.throws(() => QM.validate(spec)); checks++
}
{ const spec = QM.defaultSpec(['qe']); spec.codes.qe.species = { O: 'O.UPF\nevil' }; assert.throws(() => QM.validate(spec)); checks++ }
{ const spec = QM.defaultSpec(['gaussian']); spec.codes.gaussian.reference = 'x'; assert.throws(() => QM.validate(spec)); checks++ }
const evil = QM.defaultSpec(); evil.codes.gaussian.files[0].name = '../x'
assert.throws(() => QM.validate(evil)); checks++
console.log(`PASS: ${checks} QM input checks (JS/Python parity per code, legacy Gaussian, cells, species, POTCAR).`)
```

- [ ] **Step 2: Run to verify failure** — `PYTHON=.venv/bin/python node tests/qm-parity.cjs` → FAIL (`Cannot find module '../qm-resolve.js'` is gone after Task 1; now fails on `QM.defaultSpec(...)` shape / `render` errors).

- [ ] **Step 3: Rewrite `qm-inputs.js`:**

```js
'use strict'

// Quantum-chemistry input files for every sampled configuration.
// Templates come from qm-resolve.js with only per-configuration {placeholders} left; this engine
// fills them for each code (states, cell, species, POTCAR). monet_qm.py renders the same spec
// with identical output (tests/qm-parity.cjs).
;(function (root) {
  const node = typeof module === 'object' && module.exports
  const BOHR = 0.529177210903 // Å
  const MASSES = { /* unchanged table from the current file */ }
  const STATES = { 1: ['sing', 's0', 'singlet'], 2: ['doub', 'd0', 'doublet'], 3: ['trip', 't0', 'triplet'], 4: ['quar', 'q0', 'quartet'], 5: ['quin', 'p0', 'quintet'] }
  const CODES = {
    gaussian: { label: 'Gaussian', folder: '' }, orca: { label: 'ORCA', folder: 'orca' }, qbox: { label: 'Qbox', folder: 'qbox' },
    qe: { label: 'Quantum ESPRESSO (pw.x)', folder: 'qe' }, vasp: { label: 'VASP', folder: 'vasp' }, cp2k: { label: 'CP2K', folder: 'cp2k' }
  }
  const PLANE_WAVE = ['qe', 'vasp', 'cp2k', 'qbox']
  const SAFE = /^[A-Za-z0-9_.+()-]+$/
  const resolver = () => (node ? require('./qm-resolve.js') : root.MonetQMResolve)

  function defaultSpec (codes = ['gaussian']) {
    const R = resolver()
    const cards = Object.fromEntries(codes.map(code => [code, PLANE_WAVE.includes(code) ? { isolated: true } : {}]))
    return { ...R.buildSpec({ codes, common: { charge: 0, multiplicities: [1, 3] }, cards, symbols: [], cell: null }), masses: MASSES }
  }

  const num = value => String(value)
  const fixed = (value, digits) => (value + 0).toFixed(digits)
  function memoryMB (text) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(gb|mb|g|m)?\s*$/i.exec(String(text))
    if (!match) return 4000
    return Number(match[1]) * (/^g/i.test(match[2] || 'gb') ? 1000 : 1)
  }
  function stateOf (mult) {
    const [tag, chk, state] = STATES[mult] || [`mult${mult}`, `m${mult}`, `multiplicity-${mult}`]
    return { tag, chk: `${chk}.chk`, state }
  }

  function normalize (spec) {
    if (spec && spec.params && !spec.common) {
      const p = spec.params
      spec.common = { charge: p.charge, multiplicities: p.multiplicities }
      spec.legacy = { nproc: p.nproc, mem: p.mem, method: p.method, basis: p.basis, padding: p.padding }
    }
    for (const entry of Object.values((spec && spec.codes) || {})) {
      for (const [key, value] of [['override', null], ['isolated', null], ['species', {}], ['reference', 'u'], ['brokenSymmetry', false], ['potcar', null]]) {
        if (!Object.prototype.hasOwnProperty.call(entry, key)) entry[key] = value
      }
    }
    return spec
  }

  function checkStates (states, where) {
    const mults = states && states.multiplicities
    if (!Array.isArray(mults) || !mults.length || mults.some(m => !Number.isInteger(m) || m < 1 || m > 11) || new Set(mults).size !== mults.length) {
      throw new Error(`${where}Enter distinct spin multiplicities between 1 and 11, e.g. "1 3".`)
    }
    if (!Number.isInteger(states.charge) || Math.abs(states.charge) > 50) throw new Error(`${where}Charge must be an integer.`)
  }

  function validate (spec) {
    normalize(spec)
    if (!spec || typeof spec.codes !== 'object') throw new Error('Invalid quantum-chemistry input settings.')
    checkStates(spec.common, '')
    if (spec.legacy && (!Number.isInteger(spec.legacy.nproc) || spec.legacy.nproc < 1)) throw new Error('Processors must be a positive integer.')
    if (spec.legacy && !(Number.isFinite(spec.legacy.padding) && spec.legacy.padding >= 0)) throw new Error('Vacuum padding must be zero or positive.')
    for (const [code, entry] of Object.entries(spec.codes)) {
      if (!CODES[code]) throw new Error(`Unknown input code ${code}.`)
      const label = `${CODES[code].label}: `
      if (entry.override) checkStates(entry.override, label)
      if (entry.isolated && !(Number.isFinite(entry.isolated.padding) && entry.isolated.padding >= 0)) throw new Error(`${label}Vacuum padding must be zero or positive.`)
      if (!['u', 'auto', 'r'].includes(entry.reference)) throw new Error(`${label}Unknown reference ${entry.reference}.`)
      for (const [el, value] of Object.entries(entry.species || {})) {
        const parts = typeof value === 'object' && value !== null ? [value.basis, value.potential, ...(value.aux ? [value.aux] : [])] : [value]
        if (!/^[A-Z][a-z]?$/.test(el) || parts.some(part => typeof part !== 'string' || !SAFE.test(part))) throw new Error(`${label}Invalid pseudopotential entry for ${el}.`)
      }
      if (entry.potcar && (typeof entry.potcar.library !== 'string' || !entry.potcar.library)) throw new Error(`${label}Choose the POTCAR library folder.`)
      for (const file of entry.files) {
        if (!/^[A-Za-z0-9_.{}-]+$/.test(file.name) || typeof file.template !== 'string') throw new Error(`Invalid file name pattern ${file.name}.`)
      }
    }
    return spec
  }

  // Cell rows (Å), shifted positions and note for one code and configuration.
  function cellFor (code, entry, conf, spec) {
    const box = padding => {
      const shift = [], rows = []
      for (let axis = 0; axis < 3; axis++) {
        let low = Infinity, high = -Infinity
        for (const p of conf.positions) { low = Math.min(low, p[axis]); high = Math.max(high, p[axis]) }
        const side = Math.max(high - low + padding, 1)
        const row = [0, 0, 0]; row[axis] = side; rows.push(row)
        shift.push(side / 2 - (low + high) / 2)
      }
      return { rows, positions: conf.positions.map(p => p.map((v, k) => v + shift[k])), note: `Cell: vacuum box = extent + ${num(padding)} A, configuration centred (isolated system).` }
    }
    if (entry.isolated) return box(Number(entry.isolated.padding))
    if (spec.cell) return { rows: spec.cell, positions: conf.positions, note: 'Cell: applied manual cell.' }
    if (conf.lattice) return { rows: conf.lattice, positions: conf.positions, note: 'Cell: from the trajectory.' }
    if (spec.legacy) return box(Number(spec.legacy.padding))
    if (PLANE_WAVE.includes(code)) throw new Error(`${CODES[code].label}: no cell for configuration ${conf.index}. Apply a crystal cell or tick “Isolated system: vacuum box”.`)
    return { rows: null, positions: conf.positions, note: 'No cell (isolated cluster).' }
  }

  function widths (rows) {
    const [a, b, c] = rows
    const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const norm = v => Math.hypot(v[0], v[1], v[2])
    const bc = cross(b, c), ca = cross(c, a), ab = cross(a, b)
    const volume = Math.abs(a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2])
    return [volume / norm(bc), volume / norm(ca), volume / norm(ab)]
  }

  function context (code, entry, conf, spec, states, mult, runtime) {
    const symbols = conf.symbols
    const species = [...new Set(symbols)]
    const cell = cellFor(code, entry, conf, spec)
    const positions = cell.positions
    const rows = cell.rows
    const unpaired = mult - 1
    const table = entry.species || {}
    const counts = species.map(s => symbols.filter(x => x === s).length)
    const order = species.flatMap(s => symbols.map((x, i) => x === s ? i : -1).filter(i => i >= 0))
    const seen = {}
    const ref = entry.reference === 'u' ? 'u' : mult === 1 ? 'r' : entry.reference === 'auto' ? 'u' : 'ro'
    const ks = { u: 'UKS', r: 'RKS', ro: 'ROKS' }[ref]
    const charge = states.charge
    let nelect = `# Net charge ${num(charge)}: set NELECT = (sum of ZVAL in POTCAR) - (${num(charge)}) for charged systems.`
    if (runtime && runtime.potcar) {
      const total = species.reduce((sum, s, k) => sum + runtime.potcar.zval[s] * counts[k], 0) - charge
      nelect = charge ? `NELECT = ${num(total)}` : '# NELECT: neutral system, taken from POTCAR'
    }
    const values = {
      ...stateOf(mult),
      index: num(conf.index), frame: num(conf.frame), charge: num(charge), mult: num(mult),
      coords: symbols.map((s, i) => `${s}  ${fixed(positions[i][0], 7)}  ${fixed(positions[i][1], 7)}  ${fixed(positions[i][2], 7)}\n`).join(''),
      nat: num(symbols.length), ntyp: num(species.length),
      nspin: unpaired ? '2' : '1', unpaired: num(unpaired), delta_spin: num(unpaired / 2),
      uks: unpaired ? '.TRUE.' : '.FALSE.',
      ref, ks, guess: entry.brokenSymmetry && mult === 1 ? ' guess=mix' : '',
      cell_note: cell.note,
      cell_ang: rows ? rows.map(row => row.map(v => fixed(v, 10)).join('  ')).join('\n') : '',
      qbox_cell: rows ? rows.flat().map(v => fixed(v / BOHR, 8)).join(' ') : '',
      qbox_species: species.map(s => `species ${s.toLowerCase()} ${table[s] || `${s}_ONCV_PBE-1.0.xml`}`).join('\n'),
      qbox_atoms: symbols.map((s, i) => {
        seen[s] = (seen[s] || 0) + 1
        return `atom ${s}${seen[s]} ${s.toLowerCase()} ${positions[i].map(v => fixed(v / BOHR, 8)).join(' ')}`
      }).join('\n'),
      qe_species: species.map(s => `  ${s} ${spec.masses[s] || '1.0'} ${table[s] || `${s}.UPF`}`).join('\n'),
      qe_magnetization: unpaired ? `  tot_magnetization = ${unpaired}\n` : '',
      vasp_species: species.join(' '),
      vasp_counts: counts.join(' '),
      vasp_coords: order.map(i => positions[i].map(v => fixed(v, 10)).join('  ')).join('\n'),
      vasp_potcar_spec: species.map(s => table[s] || s).join('\n'),
      vasp_nelect: nelect,
      cp2k_cell: rows ? ['A', 'B', 'C'].map((axis, k) => `      ${axis} ${rows[k].map(v => fixed(v, 10)).join(' ')}`).join('\n') : '',
      cp2k_kinds: species.map(s => {
        const kind = table[s] || {}
        return `    &KIND ${s}\n      BASIS_SET ${kind.basis || 'DZVP-MOLOPT-SR-GTH'}\n${kind.aux ? `      BASIS_SET AUX_FIT ${kind.aux}\n` : ''}      POTENTIAL ${kind.potential || 'GTH-PBE'}\n    &END KIND`
      }).join('\n'),
      cp2k_hf_cutoff: rows ? fixed(Math.min(6, Math.min(...widths(rows)) / 2 - 0.1), 4) : ''
    }
    if (spec.legacy) {
      const p = spec.legacy
      Object.assign(values, { nproc: num(p.nproc), mem: String(p.mem), method: String(p.method), basis: String(p.basis), maxcore: num(Math.floor(memoryMB(p.mem) / Math.max(1, Number(p.nproc)))) })
    }
    return values
  }

  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match)

  // conf = { index (1-based), frame, symbols, positions: [[x,y,z]...], lattice?: 3x3 }
  function render (spec, conf, runtime = {}) {
    normalize(spec)
    const out = []
    for (const [code, entry] of Object.entries(spec.codes)) {
      const states = entry.override || spec.common
      const folder = CODES[code].folder
      for (const file of entry.files) {
        const perState = /\{(tag|mult|state|chk)\}/.test(file.name)
        for (const mult of perState ? states.multiplicities : [states.multiplicities[0]]) {
          const values = context(code, entry, conf, spec, states, mult, runtime)
          const name = fill(file.name, values)
          out.push({ path: folder ? `${folder}/${name}` : name, text: fill(file.template, values) })
        }
      }
      if (code === 'vasp' && runtime && runtime.potcar) out.push({ path: 'vasp/POTCAR', text: runtime.potcar.text })
    }
    return out
  }

  const api = { CODES, MASSES, BOHR, PLANE_WAVE, defaultSpec, normalize, render, validate, stateOf, memoryMB }
  if (node) module.exports = api
  else root.MonetQM = api
})(globalThis)
```

(Copy the `MASSES` table verbatim from the current file.)

- [ ] **Step 4: Rewrite `monet_qm.py`** with the same rules. Key functions (keep the module docstring, `_num`, `_fixed`, `_memory_mb`, `state_of`, `_PLACEHOLDER`, `_STATE_KEYS`, `_FILE_NAME`, `BOHR`, `STATES`):

```python
FOLDERS = {'gaussian': '', 'orca': 'orca', 'qbox': 'qbox', 'qe': 'qe', 'vasp': 'vasp', 'cp2k': 'cp2k'}
LABELS = {'gaussian': 'Gaussian', 'orca': 'ORCA', 'qbox': 'Qbox', 'qe': 'Quantum ESPRESSO (pw.x)', 'vasp': 'VASP', 'cp2k': 'CP2K'}
PLANE_WAVE = ('qe', 'vasp', 'cp2k', 'qbox')
_SAFE = re.compile(r'^[A-Za-z0-9_.+()-]+$')
_ELEMENT = re.compile(r'^[A-Z][a-z]?$')
_DEFAULTS = (('override', None), ('isolated', None), ('species', {}), ('reference', 'u'), ('brokenSymmetry', False), ('potcar', None))


def normalize(spec):
    if isinstance(spec, dict) and isinstance(spec.get('params'), dict) and 'common' not in spec:
        p = spec['params']
        spec['common'] = {'charge': p.get('charge'), 'multiplicities': p.get('multiplicities')}
        spec['legacy'] = {k: p.get(k) for k in ('nproc', 'mem', 'method', 'basis', 'padding')}
    for entry in (spec.get('codes') or {}).values() if isinstance(spec, dict) else []:
        for key, value in _DEFAULTS:
            entry.setdefault(key, value if not isinstance(value, dict) else {})
    return spec


def _check_states(states, where):
    mults = states.get('multiplicities') if isinstance(states, dict) else None
    if (not isinstance(mults, list) or not mults or len(set(mults)) != len(mults)
            or any(type(m) is not int or not 1 <= m <= 11 for m in mults)):
        raise ValueError(f'{where}Enter distinct spin multiplicities between 1 and 11, e.g. "1 3".')
    if type(states.get('charge')) is not int or abs(states['charge']) > 50:
        raise ValueError(f'{where}Charge must be an integer.')


def validate(spec):
    if not isinstance(spec, dict) or not isinstance(spec.get('codes'), dict):
        raise ValueError('Invalid quantum-chemistry input settings.')
    normalize(spec)
    _check_states(spec['common'], '')
    legacy = spec.get('legacy')
    if legacy is not None:
        if type(legacy.get('nproc')) is not int or legacy['nproc'] < 1:
            raise ValueError('Processors must be a positive integer.')
        pad = legacy.get('padding')
        if type(pad) not in (int, float) or not math.isfinite(pad) or pad < 0:
            raise ValueError('Vacuum padding must be zero or positive.')
    for code, entry in spec['codes'].items():
        if code not in FOLDERS:
            raise ValueError(f'Unknown input code {code}.')
        label = f'{LABELS[code]}: '
        if entry.get('override') is not None:
            _check_states(entry['override'], label)
        iso = entry.get('isolated')
        if iso is not None:
            pad = iso.get('padding') if isinstance(iso, dict) else None
            if type(pad) not in (int, float) or not math.isfinite(pad) or pad < 0:
                raise ValueError(f'{label}Vacuum padding must be zero or positive.')
        if entry.get('reference') not in ('u', 'auto', 'r'):
            raise ValueError(f"{label}Unknown reference {entry.get('reference')}.")
        for el, value in (entry.get('species') or {}).items():
            parts = [value.get('basis'), value.get('potential')] + ([value['aux']] if value.get('aux') else []) if isinstance(value, dict) else [value]
            if not _ELEMENT.match(str(el)) or any(not isinstance(part, str) or not _SAFE.match(part) for part in parts):
                raise ValueError(f'{label}Invalid pseudopotential entry for {el}.')
        potcar = entry.get('potcar')
        if potcar is not None and (not isinstance(potcar, dict) or not isinstance(potcar.get('library'), str) or not potcar['library']):
            raise ValueError(f'{label}Choose the POTCAR library folder.')
        for item in entry.get('files', []):
            if not isinstance(item.get('name'), str) or not _FILE_NAME.match(item['name']) or not isinstance(item.get('template'), str):
                raise ValueError(f"Invalid file name pattern {item.get('name')}.")
    cell = spec.get('cell')
    if cell is not None and (not isinstance(cell, list) or len(cell) != 3 or any(len(row) != 3 for row in cell)):
        raise ValueError('Cell must be a 3x3 matrix.')
    return spec


def _cell(code, entry, conf, spec):
    positions = [list(map(float, p)) for p in conf['positions']]

    def box(padding):
        rows, shift = [], []
        for axis in range(3):
            values = [p[axis] for p in positions]
            low, high = min(values), max(values)
            side = max(high - low + padding, 1)
            row = [0.0, 0.0, 0.0]
            row[axis] = side
            rows.append(row)
            shift.append(side / 2 - (low + high) / 2)
        moved = [[v + shift[k] for k, v in enumerate(p)] for p in positions]
        return rows, moved, f'Cell: vacuum box = extent + {_num(padding)} A, configuration centred (isolated system).'
    if entry.get('isolated'):
        return box(float(entry['isolated']['padding']))
    if spec.get('cell'):
        return [list(map(float, r)) for r in spec['cell']], positions, 'Cell: applied manual cell.'
    if conf.get('lattice') is not None:
        return [list(map(float, r)) for r in conf['lattice']], positions, 'Cell: from the trajectory.'
    if spec.get('legacy'):
        return box(float(spec['legacy']['padding']))
    if code in PLANE_WAVE:
        raise ValueError(f"{LABELS[code]}: no cell for configuration {conf['index']}. Apply a crystal cell or tick “Isolated system: vacuum box”.")
    return None, positions, 'No cell (isolated cluster).'


def _widths(rows):
    a, b, c = rows

    def cross(u, v):
        return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]

    def norm(v):
        return math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)
    bc, ca, ab = cross(b, c), cross(c, a), cross(a, b)
    volume = abs(a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2])
    return [volume / norm(bc), volume / norm(ca), volume / norm(ab)]
```

`_context(code, entry, conf, spec, states, mult, runtime)` mirrors the JS `context` key by key (same strings; `ref`/`ks`/`guess`, species tables with the same defaults, `vasp_nelect`, `cp2k_hf_cutoff = _fixed(min(6, min(_widths(rows)) / 2 - 0.1), 4)`, legacy keys). Use `math.hypot`-free `norm` above so JS `Math.hypot` and Python agree to the printed precision. `render(spec, conf, runtime=None)` mirrors JS `render` (keep the existing `/`-in-name check) and appends `('vasp/POTCAR', runtime['potcar']['text'])`. `writer(spec)` is unchanged in this task.

- [ ] **Step 5: Wire the new module.** `index.html`: insert `<script src="qm-resolve.js"></script>` immediately before `<script src="qm-inputs.js"></script>`. `start_monet.py` `STATIC`: add `'qm-resolve.js'`. `tests/ase-ui.cjs:120`: add `'qm-resolve.js'` before `'qm-inputs.js'` in the eval list.

- [ ] **Step 6: Update `tests/regression.cjs:122-129`:** replace `qm.params.multiplicities = [1]` with `qm.common.multiplicities = [1]` (the `defaultSpec(['orca','qe','vasp'])` spec now has isolated plane-wave codes, so POSCAR is still written).

- [ ] **Step 7: Keep the old UI working until Task 8.** In `renderer.js` `buildQmSpec()` (currently lines 603-616), build the spec through the new API with the old fields so step 4 still works:

```js
function buildQmSpec () {
  const codes = qmCodes()
  if (!codes.length) return null
  const mults = $('qm-mults').value.trim().split(/[\s,]+/).filter(Boolean).map(Number)
  const shared = { nproc: Number($('qm-nproc').value), mem: $('qm-mem').value.trim(), method: $('qm-method').value.trim(), basis: $('qm-basis').value.trim() }
  const cards = Object.fromEntries(codes.map(code => [code, MonetQMResolve.PLANE_WAVE.includes(code) ? { isolated: !aseState.cellParameters, padding: Number($('qm-padding').value) } : { ...shared }]))
  const spec = { ...MonetQMResolve.buildSpec({ codes, common: { charge: Number($('qm-charge').value), multiplicities: mults }, cards, symbols: [], cell: aseState.cellParameters ? MonetASEModel.cellVectors(aseState.cellParameters) : null, custom: qmCustom }), masses: MonetQM.MASSES }
  return MonetQM.validate(spec)
}
```

and replace the `qmTemplates` object with `const qmCustom = {}` (code → { index → text }); `updateQmUI` lists `buildQmSpec()`'s files per code for the template selector (`option.value = code:i`, text `${MonetQMResolve.LABELS[code]} — ${file.name}`); `showTemplate` shows `qmCustom[code]?.[i] ?? resolved file template`; the textarea `input` handler stores into `qmCustom[code][i]`; Reset deletes `qmCustom[code][i]`. Update `qmSummary()` to use `(spec.codes[code].override || spec.common).multiplicities`. In `tests/ase-ui.cjs:517-519` change `lastProcessOptions.qm.params.charge` → `lastProcessOptions.qm.common.charge` and `.params.multiplicities` → `.common.multiplicities`.

- [ ] **Step 8: Run all affected suites**

Run:
```
PYTHON=.venv/bin/python node tests/qm-parity.cjs
node tests/qm-resolve.cjs
PYTHON=.venv/bin/python node tests/regression.cjs
PYTHON=.venv/bin/python node tests/ase-ui.cjs
PYTHON=.venv/bin/python node tests/ase-integration.cjs
PYTHON=.venv/bin/python node tests/replay.cjs
```
Expected: each prints `PASS: …`.

- [ ] **Step 9: Commit**

```bash
git add qm-inputs.js monet_qm.py qm-resolve.js index.html start_monet.py renderer.js tests/qm-parity.cjs tests/regression.cjs tests/ase-ui.cjs
git commit -m "QM engines: per-code states, centred vacuum box, species tables, reference per multiplicity

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: POTCAR assembly (launcher and desktop app)

**Files:**
- Modify: `qm-inputs.js` (add `loadPotcar`), `monet_qm.py` (add `load_potcar`, extend `writer`), `main.js` (pass runtime), `browser-bridge.js` (reject)
- Test: `tests/qm-parity.cjs` (append), `tests/regression.cjs` (append desktop case)

**Interfaces:**
- Produces:
  - JS `MonetQM.loadPotcar(library, variants, io) → { text, zval: [number…] }`; `io = { read(file) → string, join(...parts) → string, real(file) → string, sep: string }`. Throws `Error('POTCAR variant <v> not found in <library>.')`, `Error('Invalid POTCAR variant <v>.')`, `Error('No ZVAL in POTCAR of <v>.')`.
  - Python `monet_qm.load_potcar(library, variants) → (text, [zval…])` with the same messages (`ValueError`).
  - Runtime per configuration: `{ potcar: { text, zval: { El: z } } }` built from the configuration's species order (`[...new Set(symbols)]`), variants `species[El] || El`; cached per species tuple.

- [ ] **Step 1: Append failing tests** to `tests/qm-parity.cjs` (before `console.log`):

```js
// POTCAR assembly from a local library (launcher writer and desktop helper).
{
  const fs = require('node:fs')
  const os = require('node:os')
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'potcar-'))
  for (const [variant, zval] of [['O_s', 6], ['H', 1], ['C', 4]]) {
    fs.mkdirSync(path.join(lib, variant))
    fs.writeFileSync(path.join(lib, variant, 'POTCAR'), `  PAW_PBE ${variant}\n   POMASS =   1.000; ZVAL   =    ${zval}.000    mass and valenz\nEnd of Dataset\n`)
  }
  const io = { read: f => fs.readFileSync(f, 'utf8'), join: path.join, real: f => fs.realpathSync(f), sep: path.sep }
  const js = QM.loadPotcar(lib, ['O_s', 'H', 'C'], io)
  assert.deepEqual(js.zval, [6, 1, 4]); assert.match(js.text, /PAW_PBE O_s[\s\S]*PAW_PBE H[\s\S]*PAW_PBE C/); checks++
  assert.throws(() => QM.loadPotcar(lib, ['N'], io), /POTCAR variant N not found/); checks++
  assert.throws(() => QM.loadPotcar(lib, ['../x'], io), /Invalid POTCAR variant/); checks++
  const out = JSON.parse(execFileSync(process.env.PYTHON || 'python3', ['-c', `
import json, sys
sys.path.insert(0, sys.argv[1])
import monet_qm
text, zval = monet_qm.load_potcar(sys.argv[2], ['O_s', 'H', 'C'])
print(json.dumps([text, zval]))
`, root, lib]))
  assert.deepEqual(out, [js.text, js.zval]); checks++
  // Writer end to end: extract command through ase_bridge.py writes POTCAR and NELECT per configuration.
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qm-extract-'))
  const xyz = path.join(outDir, 'w.xyz')
  fs.writeFileSync(xyz, '3\nframe 0\nO 0 0 0\nH 0.96 0 0\nH -0.24 0.93 0\n3\nframe 1\nO 0 0 0.1\nH 0.96 0 0\nH -0.24 0.93 0\n')
  const spec = { ...R.buildSpec({ codes: ['vasp', 'qe'], common: { charge: -1, multiplicities: [2] }, symbols: ['O', 'H', 'H'], cell: null,
    cards: { vasp: { isolated: true, buildPotcar: true, potcarLibrary: lib, species: { O: 'O_s', H: 'H' } }, qe: { isolated: true, calc: 'freq', phx: true } } }), masses: QM.MASSES }
  execFileSync(process.env.PYTHON || 'python3', [path.join(root, 'ase_bridge.py')], { input: JSON.stringify({ action: 'extract', filename: xyz, output_dir: path.join(outDir, 'out'), selected: [1, 2, 3], frequency: 1, compute_average: false, qm: spec }) })
  const conf1 = path.join(outDir, 'out/2-SAMPLED_CONFIGURATIONS/conf1')
  assert.match(fs.readFileSync(path.join(conf1, 'vasp/POTCAR'), 'utf8'), /PAW_PBE O_s[\s\S]*PAW_PBE H/); checks++
  assert.match(fs.readFileSync(path.join(conf1, 'vasp/INCAR_doub'), 'utf8'), /\nNELECT = 9\n/); checks++
  assert.ok(fs.existsSync(path.join(conf1, 'vasp/KPOINTS'))); assert.ok(fs.existsSync(path.join(conf1, 'vasp/POTCAR.spec'))); assert.ok(fs.existsSync(path.join(conf1, 'qe/ph_doub.inp'))); checks++
  const bad = { ...spec, codes: { ...spec.codes, vasp: { ...spec.codes.vasp, species: { O: 'O_h', H: 'H' } } } }
  const failed = execFileSync(process.env.PYTHON || 'python3', [path.join(root, 'ase_bridge.py')], { input: JSON.stringify({ action: 'extract', filename: xyz, output_dir: path.join(outDir, 'bad'), selected: [1, 2, 3], frequency: 1, compute_average: false, qm: bad }) }).toString()
  assert.match(failed, /POTCAR variant O_h not found/); assert.ok(!fs.existsSync(path.join(outDir, 'bad/2-SAMPLED_CONFIGURATIONS/conf1'))); checks++
}
```

Before writing the end-to-end part, check how `ase_bridge.py` reports errors on stdout (`main()` near line 1423) and adjust the `failed` assertion to the actual error line format if it differs (e.g. a JSON object with `"error"`); the message text must contain `POTCAR variant O_h not found`.

- [ ] **Step 2: Run to verify failure** — `PYTHON=.venv/bin/python node tests/qm-parity.cjs` → FAIL (`QM.loadPotcar is not a function`).

- [ ] **Step 3: Implement `loadPotcar` in `qm-inputs.js`:**

```js
  // POTCAR text and valences for the given variants, read from a local library (<library>/<variant>/POTCAR).
  function loadPotcar (library, variants, io) {
    const base = io.real(library)
    const parts = []
    const zval = []
    for (const variant of variants) {
      if (!/^[A-Za-z0-9_.-]+$/.test(variant) || variant === '.' || variant === '..') throw new Error(`Invalid POTCAR variant ${variant}.`)
      let file
      try { file = io.real(io.join(base, variant, 'POTCAR')) } catch (e) { throw new Error(`POTCAR variant ${variant} not found in ${library}.`) }
      if (!file.startsWith(base + io.sep)) throw new Error(`Invalid POTCAR variant ${variant}.`)
      const text = io.read(file)
      const match = /ZVAL\s*=\s*([-+0-9.Ee]+)/.exec(text)
      if (!match) throw new Error(`No ZVAL in POTCAR of ${variant}.`)
      parts.push(text.endsWith('\n') ? text : text + '\n')
      zval.push(Number(match[1]))
    }
    return { text: parts.join(''), zval }
  }
```

Add `loadPotcar` to `api`.

- [ ] **Step 4: Implement in `monet_qm.py`:**

```python
_VARIANT = re.compile(r'^[A-Za-z0-9_.-]+$')
_ZVAL = re.compile(r'ZVAL\s*=\s*([-+0-9.Ee]+)')


def load_potcar(library, variants):
    """POTCAR text and valences for the variants, read from <library>/<variant>/POTCAR."""
    base = os.path.realpath(library)
    parts, zval = [], []
    for variant in variants:
        if not _VARIANT.match(variant) or variant in ('.', '..'):
            raise ValueError(f'Invalid POTCAR variant {variant}.')
        path = os.path.realpath(os.path.join(base, variant, 'POTCAR'))
        if not path.startswith(base + os.sep):
            raise ValueError(f'Invalid POTCAR variant {variant}.')
        if not os.path.isfile(path):
            raise ValueError(f'POTCAR variant {variant} not found in {library}.')
        with open(path, encoding='utf-8', errors='replace') as fh:
            text = fh.read()
        match = _ZVAL.search(text)
        if not match:
            raise ValueError(f'No ZVAL in POTCAR of {variant}.')
        parts.append(text if text.endswith('\n') else text + '\n')
        zval.append(float(match.group(1)))
    return ''.join(parts), zval
```

Note: JSON gives `6.0` in Python and `6` in JS for `zval`; the test compares after `json.dumps`, where Python prints `6.0`. Make Python return `int(v) if float(v).is_integer() else v` for each zval so the arrays compare equal.

Extend `writer(spec)`:

```python
def writer(spec):
    """Callback for monet_io.extract: writes the inputs of one configuration."""
    validate(spec)
    vasp = spec['codes'].get('vasp')
    potcar = vasp.get('potcar') if vasp else None
    cache = {}

    def runtime_for(symbols):
        if not potcar:
            return None
        species = tuple(dict.fromkeys(symbols))
        if species not in cache:
            table = vasp.get('species') or {}
            text, zval = load_potcar(potcar['library'], [table.get(s) or s for s in species])
            cache[species] = {'potcar': {'text': text, 'zval': dict(zip(species, zval))}}
        return cache[species]

    def write(folder, index, frame, symbols, positions, lattice=None):
        conf = {'index': index, 'frame': frame, 'symbols': symbols, 'positions': positions.tolist(), 'lattice': lattice}
        for path, text in render(spec, conf, runtime_for(symbols)):
            target = os.path.join(folder, path)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with open(target, 'w', newline='') as fh:
                fh.write(text)
    return write
```

To fail **before** any configuration is written, `ase_bridge.action_extract` must trigger the POTCAR load up front: after `qm = monet_qm.writer(qm)`, call `monet_qm.preflight(cmd['qm'], traj.symbols_list(), cmd.get('selected') or [])`, defined as:

```python
def preflight(spec, symbols, selected):
    """Load the POTCARs of the selected atoms once so a missing variant stops the run before extraction."""
    vasp = spec['codes'].get('vasp')
    if vasp and vasp.get('potcar'):
        chosen = [symbols[i - 1] for i in selected] if selected else list(symbols)
        table = vasp.get('species') or {}
        load_potcar(vasp['potcar']['library'], [table.get(s) or s for s in dict.fromkeys(chosen)])
```

(`selected` holds 1-based atom indices — confirm against `monet_io.extract` and adapt the index base if it differs.)

- [ ] **Step 5: Desktop and browser bridges.** In `main.js`, where `QM.render(qm, conf)` is called (line ~199), pass a runtime built like the Python writer: cache by species key, `QM.loadPotcar(qm.codes.vasp.potcar.library, variants, { read: f => fs.readFileSync(f, 'utf8'), join: path.join, real: f => fs.realpathSync(f), sep: path.sep })`, `zval` mapped to elements; and call it once before the frame loop (after `QM.validate(qm)`, line ~138) using the selected atoms' elements so a bad library fails before writing. In `browser-bridge.js` (line ~96 destructuring), add: `if (qm && qm.codes && qm.codes.vasp && qm.codes.vasp.potcar) throw new Error('Building POTCAR needs the launcher or the desktop app.')`.

- [ ] **Step 6: Desktop regression check.** Append to `tests/regression.cjs` after the existing desktop QM block: create a temp POTCAR library as in Step 1 with `O` and `H` variants, run `handlers.get('process-trajectory')` with `qm = QM.defaultSpec(['vasp'])`, `qm.codes.vasp.potcar = { library: lib }`, `qm.common.multiplicities = [1]`, and assert `conf1/vasp/POTCAR` exists and contains both datasets (`checks++`). Adapt element names to the regression fixture's atoms (read the fixture at the top of `tests/regression.cjs`).

- [ ] **Step 7: Run** `PYTHON=.venv/bin/python node tests/qm-parity.cjs` and `PYTHON=.venv/bin/python node tests/regression.cjs` → both `PASS`.

- [ ] **Step 8: Commit**

```bash
git add qm-inputs.js monet_qm.py ase_bridge.py main.js browser-bridge.js tests/qm-parity.cjs tests/regression.cjs
git commit -m "VASP: assemble POTCAR and NELECT from a local POTCAR library (launcher, desktop app)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: `qm-panel.js` — the per-code cards

**Files:**
- Create: `qm-panel.js`
- Modify: `index.html` (step 4 markup), `styles.css` (card styles), `start_monet.py` (`STATIC` += `'qm-panel.js'`), `tests/ase-ui.cjs:120` (eval `qm-panel.js` after `qm-inputs.js`)
- Test: `tests/ase-ui.cjs` (new block, Task 8 wires the rest)

**Interfaces:**
- Consumes: `MonetQMResolve.DEFAULTS`, `settingsFor`, `CALCS`, `CALC_LABELS`, `LABELS`, `PLANE_WAVE`, `defaultSpecies`, `isHybrid`.
- Produces: `MonetQMPanel.mount(container, { onChange }) → panel` with
  - `panel.show(codes)` — renders/keeps one `<details class="qm-card" id="qm-card-<code>" open>` per code in `codes`, removes others (keeps their settings in memory);
  - `panel.read() → { <code>: settings }` (merged with defaults, numbers parsed, `species` included, `override` null unless ticked);
  - `panel.setSymbols(symbols)` — (re)builds each plane-wave species table for the unique elements, keeping user edits per element and regenerating untouched defaults when the functional changes;
  - `panel.setCellStatus(code, text, blocked)` — fills `#qm-<code>-cell` and toggles class `blocked`;
  - `panel.setPreview(code, text)` — fills `<pre id="qm-<code>-preview">`;
  - `panel.setPotcarAvailable(bool)` — enables/disables `#qm-vasp-buildPotcar`.
- DOM ids: `qm-<code>-<key>` for every field below; override: `qm-<code>-override` (checkbox), `qm-<code>-override-charge`, `qm-<code>-override-mults`; species inputs: `qm-<code>-species-<El>` (cp2k: `-basis`, `-potential`, `-aux` suffixes); MD group `qm-<code>-md-<ensemble|temperature|timestep|steps>`; grid `qm-<code>-grid` (text "n1 n2 n3").

**Field schema** (in `qm-panel.js`; `when(s)` decides visibility, evaluated on every change):

```js
  const R = globalThis.MonetQMResolve
  const opt = (value, label) => ({ value, label })
  const calcOptions = code => R.CALCS[code].map(key => opt(key, R.CALC_LABELS[key]))
  const MOLECULAR = code => [
    { key: 'calc', label: 'Calculation', type: 'select', options: calcOptions(code) },
    { key: 'nstates', label: 'Excited states', type: 'number', min: 1, step: 1, when: s => s.calc === 'td' },
    { key: 'reference', label: 'Reference', type: 'select', options: [opt('u', 'Unrestricted'), opt('auto', 'Auto (R for singlets)'), opt('r', code === 'gaussian' ? 'Restricted (RO for open shells)' : 'Restricted (ROKS for open shells)')] },
    ...(code === 'gaussian' ? [{ key: 'brokenSymmetry', label: 'Broken-symmetry singlet (guess=mix)', type: 'check' }] : []),
    { key: 'method', label: 'Method', type: 'text' },
    { key: 'basis', label: 'Basis set', type: 'text' },
    { key: 'dispersion', label: 'Dispersion', type: 'select', options: code === 'gaussian' ? [opt('none', 'None'), opt('d3bj', 'D3(BJ)'), opt('d3', 'D3')] : [opt('none', 'None'), opt('d3bj', 'D3(BJ)'), opt('d4', 'D4')] },
    { key: 'solvent', label: code === 'gaussian' ? 'Solvent (SMD, empty = gas phase)' : 'Solvent (CPCM, empty = gas phase)', type: 'text' },
    { key: 'scf', label: 'SCF convergence', type: 'select', options: [opt('tight', 'Tight'), opt('verytight', 'Very tight')] },
    { key: 'nproc', label: 'Processors', type: 'number', min: 1, step: 1 },
    { key: 'mem', label: 'Memory', type: 'text' },
    ...(code === 'orca' ? [{ key: 'maxcorePct', label: 'maxcore %', type: 'number', min: 1, max: 100, step: 1 }] : []),
    { key: 'md', type: 'md', when: s => s.calc === 'md', nveOnly: code === 'gaussian' },
    { key: 'extra', label: 'Extra keywords', type: 'text' }
  ]
  const PW_COMMON = [
    { key: 'isolated', label: 'Isolated system: vacuum box', type: 'check' },
    { key: 'padding', label: 'Vacuum (Å)', type: 'number', min: 0, step: 0.5, when: s => s.isolated },
    { key: 'pressure', label: 'Target pressure (GPa)', type: 'number', step: 0.1, when: s => s.calc === 'vcrelax' },
    { key: 'md', type: 'md', when: s => s.calc === 'md' }
  ]
  const KPOINTS = [
    { key: 'kpoints', label: 'k-points', type: 'select', options: [opt('gamma', 'Γ only'), opt('grid', 'Grid')] },
    { key: 'grid', label: 'Grid (n1 n2 n3)', type: 'grid', when: s => s.kpoints === 'grid' }
  ]
  const FIELDS = {
    gaussian: MOLECULAR('gaussian'),
    orca: MOLECULAR('orca'),
    qe: [
      { key: 'calc', label: 'Calculation', type: 'select', options: calcOptions('qe') },
      { key: 'phx', label: 'Also write ph.x input (Γ phonons)', type: 'check', when: s => s.calc === 'freq' || s.calc === 'optfreq' },
      { key: 'functional', label: 'Functional', type: 'select', options: [opt('default', 'From the pseudopotentials'), opt('pbesol', 'PBEsol'), opt('pbe0', 'PBE0'), opt('hse', 'HSE')] },
      { key: 'ecutwfc', label: 'ecutwfc (Ry)', type: 'number', min: 1, step: 5 },
      { key: 'ecutrhoFactor', label: 'ecutrho / ecutwfc', type: 'number', min: 1, step: 1 },
      ...KPOINTS,
      { key: 'dispersion', label: 'Dispersion', type: 'select', options: [opt('none', 'None'), opt('d3bj', 'D3(BJ)')] },
      { key: 'pseudoDir', label: 'pseudo_dir', type: 'text' },
      ...PW_COMMON,
      { key: 'extra', label: 'Extra &SYSTEM lines (; separated)', type: 'text' }
    ],
    vasp: [
      { key: 'calc', label: 'Calculation', type: 'select', options: calcOptions('vasp') },
      { key: 'functional', label: 'Functional', type: 'select', options: [opt('pbe', 'PBE'), opt('pbesol', 'PBEsol'), opt('pbe0', 'PBE0'), opt('hse06', 'HSE06')] },
      { key: 'encut', label: 'ENCUT (eV)', type: 'number', min: 1, step: 10 },
      ...KPOINTS,
      { key: 'dispersion', label: 'Dispersion', type: 'select', options: [opt('none', 'None'), opt('d3bj', 'D3(BJ)'), opt('d3', 'D3')] },
      { key: 'buildPotcar', label: 'Build POTCAR from a local library', type: 'check' },
      { key: 'potcarLibrary', label: 'POTCAR library folder', type: 'text', when: s => s.buildPotcar },
      ...PW_COMMON,
      { key: 'extra', label: 'Extra INCAR lines (; separated)', type: 'text' }
    ],
    cp2k: [
      { key: 'calc', label: 'Run type', type: 'select', options: calcOptions('cp2k') },
      { key: 'functional', label: 'Functional', type: 'select', options: [opt('pbe', 'PBE'), opt('blyp', 'BLYP'), opt('revpbe', 'revPBE'), opt('pbe0', 'PBE0 (ADMM)'), opt('b3lyp', 'B3LYP (ADMM)'), opt('hse06', 'HSE06 (ADMM)')] },
      { key: 'cutoff', label: 'CUTOFF (Ry)', type: 'number', min: 1, step: 10 },
      { key: 'relCutoff', label: 'REL_CUTOFF (Ry)', type: 'number', min: 1, step: 5 },
      ...KPOINTS,
      { key: 'dispersion', label: 'Dispersion', type: 'select', options: [opt('none', 'None'), opt('d3bj', 'D3(BJ)')] },
      { key: 'basisFile', label: 'BASIS_SET_FILE_NAME', type: 'text' },
      { key: 'potentialFile', label: 'POTENTIAL_FILE_NAME', type: 'text' },
      { key: 'hfMemory', label: 'HF MAX_MEMORY (MB)', type: 'number', min: 1, step: 100, when: s => R.isHybrid('cp2k', s.functional) },
      ...PW_COMMON,
      { key: 'extra', label: 'Extra &DFT lines (; separated)', type: 'text' }
    ],
    qbox: [
      { key: 'calc', label: 'Calculation', type: 'select', options: calcOptions('qbox') },
      { key: 'functional', label: 'Functional (xc)', type: 'select', options: [opt('pbe', 'PBE'), opt('blyp', 'BLYP'), opt('pbe0', 'PBE0'), opt('b3lyp', 'B3LYP'), opt('hse', 'HSE')] },
      { key: 'ecut', label: 'ecut (Ry)', type: 'number', min: 1, step: 5 },
      ...PW_COMMON,
      { key: 'extra', label: 'Extra set commands (; separated)', type: 'text' }
    ]
  }
```

Qbox shows a static note under its calculation select: "Frequencies are not offered: Qbox has no built-in vibrational analysis." Gaussian shows under the MD group: "Gaussian ADMP runs NVE only."

**Behaviour to implement:**
- Every card: first row `Override charge and multiplicities` checkbox → reveals two inputs (defaults: the shared values at the moment of ticking). `read()` returns `override: { charge: Number, multiplicities: [Number…] }` when ticked (parse like the shared field: split on spaces/commas).
- Plane-wave cards: a cell status line `<p class="qm-cell" id="qm-<code>-cell">` under the title; a species table `<table class="qm-species">` (header: Element, File/Variant; cp2k: Element, Basis, Potential, and AUX_FIT when hybrid).
- Choosing Freq or Opt+Freq in QE ticks `phx` automatically (once per change of `calc`; the user may untick).
- Numbers: `Number(input.value)`; grid: `value.trim().split(/\s+/).map(Number)`; MD: `{ ensemble, temperature, timestep, steps }` numbers; Gaussian MD ensemble select is disabled and fixed to `nve`.
- Each card ends with `<details><summary>Preview (configuration 1)</summary><pre id="qm-<code>-preview"></pre></details>`.
- Any `input`/`change` in the panel calls `onChange()`.
- Build DOM with `document.createElement` only (no `innerHTML` with user values).

- [ ] **Step 1: Replace the step-4 markup** in `index.html` (the `<fieldset class="qm-panel" id="gaussian-details">…</fieldset>` block) with:

```html
      <fieldset class="qm-panel" id="gaussian-details">
        <legend>Quantum-chemistry inputs per configuration</legend>
        <div class="qm-codes">
          <label><input type="checkbox" id="opt-gaussian" data-qm-code="gaussian" checked /> Gaussian</label>
          <label><input type="checkbox" data-qm-code="orca" /> ORCA</label>
          <label><input type="checkbox" data-qm-code="qe" /> QE pw.x</label>
          <label><input type="checkbox" data-qm-code="vasp" /> VASP</label>
          <label><input type="checkbox" data-qm-code="cp2k" /> CP2K</label>
          <label><input type="checkbox" data-qm-code="qbox" /> Qbox</label>
        </div>
        <div class="qm-states">
          <span class="qm-states-title">Electronic states</span>
          <label class="field-label">Charge<input class="field-input" id="qm-charge" type="number" step="1" value="0" /></label>
          <label class="field-label">Multiplicities<input class="field-input" id="qm-mults" value="1 3" title="One file per multiplicity per configuration (1 → sing, 3 → trip …)" /></label>
        </div>
        <div id="qm-cards"></div>
        <details class="qm-templates">
          <summary>Edit templates</summary>
          <div class="ase-ctrl-row">
            <select class="field-input" id="qm-template-file"></select>
            <button class="btn btn-sm" id="qm-template-reset">Reset</button>
          </div>
          <textarea class="field-input qm-template-text" id="qm-template-text" spellcheck="false" rows="12"></textarea>
          <p class="panel-desc">An edited template replaces the one built from the card and is marked <em>custom template</em>. Per-configuration placeholders: {charge} {mult} {state} {tag} {chk} {index} {frame} {coords} {nat} {ntyp} {nspin} {unpaired} {delta_spin} {uks} {ref} {ks} {guess} {cell_ang} {cell_note} {qbox_cell} {qbox_species} {qbox_atoms} {qe_species} {qe_magnetization} {vasp_species} {vasp_counts} {vasp_coords} {vasp_potcar_spec} {vasp_nelect} {cp2k_cell} {cp2k_kinds} {cp2k_hf_cutoff}. Templates are kept for this session.</p>
        </details>
        <p class="panel-desc" id="qm-status" aria-live="polite"></p>
        <button class="btn btn-sm hidden" id="qm-define-cell" type="button">Define cell…</button>
      </fieldset>
```

(The old Processors/Memory/Method/Basis/Vacuum fields and the old description paragraph are gone.)

- [ ] **Step 2: Styles** — append to `styles.css` using the existing tokens (inspect `.qm-panel`, `.qm-grid` for the variables in use):

```css
.qm-states { display: flex; gap: .8rem; align-items: end; flex-wrap: wrap; margin: .6rem 0; }
.qm-states-title { font-weight: 600; margin-right: .4rem; }
.qm-card { border: 1px solid var(--border); border-radius: 6px; padding: .4rem .7rem; margin: .5rem 0; }
.qm-card > summary { cursor: pointer; font-weight: 600; }
.qm-card .qm-grid { margin-top: .4rem; }
.qm-cell { margin: .3rem 0; font-size: .85em; }
.qm-cell.blocked { color: var(--danger, #c0392b); font-weight: 600; }
.qm-species { border-collapse: collapse; font-size: .85em; margin: .4rem 0; }
.qm-species td, .qm-species th { padding: .15rem .4rem; }
.qm-preview { max-height: 16rem; overflow: auto; font-size: .8em; }
.qm-custom { font-size: .8em; opacity: .8; margin-left: .4rem; }
```

If `--border`/`--danger` are not the project's token names, use the ones `styles.css` already defines for borders and errors.

- [ ] **Step 3: Write `qm-panel.js`** implementing the interface and schema above (IIFE, `root.MonetQMPanel = { mount }`). Field rendering by type: `select` → `<select class="field-input">` with options; `number` → `<input type="number" class="field-input">` with min/max/step; `text` → `<input class="field-input">`; `check` → `<label class="toggle-row"><input type="checkbox">…</label>`; `grid` → text input with value `s.grid.join(' ')`; `md` → a sub-grid with ensemble select (`nvt` NVT, `nve` NVE), temperature (K), time step (fs), steps. Labels are `<label class="field-label">Label<input …></label>` like the existing markup. Visibility: set `hidden` on the field wrapper when `when(settings)` is false.

- [ ] **Step 4: Failing UI test** — in `tests/ase-ui.cjs`, add after the existing QM block (around line 521) a block that exercises only the panel (Task 8 covers wiring):

```js
  // Per-code cards: one card per ticked code; old shared fields are gone.
  assert.equal(el('qm-nproc'), null); assert.equal(el('qm-method'), null); assert.equal(el('qm-padding'), null); checks++
  w.document.querySelector('[data-qm-code="qe"]').click()
  assert.ok(el('qm-card-gaussian')); assert.ok(el('qm-card-orca')); assert.ok(el('qm-card-qe')); assert.equal(el('qm-card-vasp'), null); checks++
  el('qm-qe-calc').value = 'freq'; el('qm-qe-calc').dispatchEvent(new w.Event('change'))
  assert.equal(el('qm-qe-phx').checked, true); checks++
  assert.equal(el('qm-qe-padding').closest('.field-label').hidden, true)
  el('qm-qe-isolated').click(); assert.equal(el('qm-qe-padding').closest('.field-label').hidden, false); checks++
  w.document.querySelector('[data-qm-code="qbox"]').click()
  assert.deepEqual([...el('qm-qbox-calc').options].map(o => o.value), ['sp', 'opt', 'vcrelax', 'md']); checks++
```

Run `PYTHON=.venv/bin/python node tests/ase-ui.cjs` → FAIL (ids missing) until Task 8 wires `mount`/`show`; to keep this task self-contained, add in `renderer.js` the minimal wiring: `const qmPanel = MonetQMPanel.mount($('qm-cards'), { onChange: updateQmUI })` and call `qmPanel.show(qmCodes())` at the top of `updateQmUI()`. The old `buildQmSpec` from Task 5 must stop reading the removed fields: take `nproc/mem/method/basis` from `qmPanel.read()` cards instead (full replacement comes in Task 8). Adjust the existing lines 508-521 of `tests/ase-ui.cjs` only where they reference removed ids.

- [ ] **Step 5: Run** `PYTHON=.venv/bin/python node tests/ase-ui.cjs` → PASS.

- [ ] **Step 6: Commit**

```bash
git add qm-panel.js index.html styles.css start_monet.py renderer.js tests/ase-ui.cjs
git commit -m "Processing Options: one settings card per quantum-chemistry code

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire cards, cell check, blocking, preview and templates in `renderer.js`

**Files:**
- Modify: `renderer.js` (QM section, currently ~lines 598-690, and the `next-4` handler, `qmSummary`)
- Test: `tests/ase-ui.cjs`

**Interfaces:**
- Consumes: `MonetQMPanel` (Task 7), `MonetQMResolve.buildSpec/readiness/PLANE_WAVE/LABELS` (Task 4), `MonetQM.validate/render/MASSES` (Task 5), `MonetASEModel.atomMap`, `MonetASEModel.cellVectors`, `aseState.cellParameters`, `player.cells` (Map frame → 3×3 lattice), `state.firstFrame`, `state.selectedAtoms`, `state.outputDir`.
- Produces (renderer-internal): `qmSymbols()`, `qmExtent()`, `qmCellInfo()`, `buildQmSpec()`, `qmReadiness()`, `updateQmUI()`; exported for tests: add `qmReadiness` to the `window.testMonet` object in `tests/ase-ui.cjs:120`.

- [ ] **Step 1: Failing UI tests** — append to the block added in Task 7:

```js
  // Cell check: a plane-wave code without a cell blocks Run; the isolated flag or an applied cell releases it.
  w.testMonet.state.outputDir = 'out'
  el('qm-qe-isolated').click() // back to not isolated
  assert.match(el('qm-status').textContent, /Quantum ESPRESSO \(pw\.x\): no cell/); assert.equal(el('next-4').disabled, true); checks++
  assert.equal(el('qm-define-cell').classList.contains('hidden'), false); assert.match(el('qm-qe-cell').textContent, /✖ No cell/); checks++
  el('qm-qe-isolated').click()
  assert.doesNotMatch(el('qm-status').textContent, /no cell/); assert.equal(el('next-4').disabled, false); assert.match(el('qm-qe-cell').textContent, /Vacuum box \(isolated\)/); checks++
  el('qm-qe-isolated').click()
  w.testMonet.aseState.cellParameters = [10, 10, 10, 90, 90, 90]; el('qm-charge').dispatchEvent(new w.Event('input'))
  assert.match(el('qm-qe-cell').textContent, /Crystal cell applied \(10, 10, 10, 90, 90, 90\)/); assert.equal(el('next-4').disabled, false); checks++
  assert.match(el('qm-status').textContent, /Gaussian: the configuration is written as an isolated cluster/); checks++
  w.testMonet.aseState.cellParameters = null
  // Override, preview, custom template marker
  el('qm-orca-override').click(); el('qm-orca-override-mults').value = '2'; el('qm-orca-override-mults').dispatchEvent(new w.Event('input'))
  assert.match(el('qm-orca-preview').textContent, /\* xyz 0 2\n/); checks++
  el('qm-template-file').value = 'orca:0'; el('qm-template-file').dispatchEvent(new w.Event('change'))
  el('qm-template-text').value = '! custom {mult}\n{coords}'; el('qm-template-text').dispatchEvent(new w.Event('input'))
  assert.match(el('qm-card-orca').querySelector('summary').textContent, /custom template/); checks++
  // Define cell… opens the Structure analysis cell panel.
  el('qm-qe-isolated').click(); el('qm-qe-isolated').click() // ensure blocked state
  el('qm-define-cell').click()
  assert.equal(el('panel-analysis').classList.contains('active'), true); checks++
```

Adapt the last assertion to how the Cell panel is shown in this app: find the element that holds `cell-apply` (Structure analysis › Cell) and the function/tab that reveals it (e.g. `goTo('analysis')` + `showViewerTab('ase')` + the ASE sub-tab for the cell); assert on that visible state instead of `panel-analysis` if needed.

Also update the existing QM assertions at `tests/ase-ui.cjs:508-521`: ORCA ticked, multiplicities `2`, charge `-1`, custom ORCA template → `lastProcessOptions.qm.codes.orca.files[0].template === '! custom {mult}\n{coords}'`, `lastProcessOptions.qm.common.charge === -1`, `lastProcessOptions.qm.common.multiplicities` → `[2]`, `lastProcessOptions.qm.summary.orca` matches `/^ORCA: b3lyp\/6-31\+g\(d,p\)/`.

- [ ] **Step 2: Run** `PYTHON=.venv/bin/python node tests/ase-ui.cjs` → FAIL on the new block.

- [ ] **Step 3: Implement** — replace the QM section of `renderer.js` with:

```js
// Quantum-chemistry inputs: shared electronic states + one card per code (qm-panel.js).
const qmCodes = () => [...$$('[data-qm-code]')].filter(input => input.checked).map(input => input.dataset.qmCode)
const qmCustom = {} // code → { file index → edited template }
const qmPanel = MonetQMPanel.mount($('qm-cards'), { onChange: () => updateQmUI() })

function qmAtoms () { return state.firstFrame ? MonetASEModel.atomMap(state.firstFrame, [...state.selectedAtoms]) : [] }
function qmSymbols () { return qmAtoms().map(atom => atom.element) }
function qmExtent () {
  const atoms = qmAtoms()
  if (!atoms.length) return null
  return ['x', 'y', 'z'].map(k => Math.max(...atoms.map(a => a[k])) - Math.min(...atoms.map(a => a[k])))
}
function qmCellInfo () {
  if (aseState.cellParameters) return { source: 'applied', rows: MonetASEModel.cellVectors(aseState.cellParameters) }
  const lattice = player.cells && player.cells.get(0)
  return lattice ? { source: 'trajectory', rows: lattice } : null
}
function qmCommon () {
  return { charge: Number($('qm-charge').value), multiplicities: $('qm-mults').value.trim().split(/[\s,]+/).filter(Boolean).map(Number) }
}
function buildQmSpec () {
  const codes = qmCodes()
  if (!codes.length) return null
  const spec = { ...MonetQMResolve.buildSpec({ codes, common: qmCommon(), cards: qmPanel.read(), symbols: qmSymbols(), cell: aseState.cellParameters ? MonetASEModel.cellVectors(aseState.cellParameters) : null, custom: qmCustom }), masses: MonetQM.MASSES }
  return MonetQM.validate(spec)
}
function qmReadiness () {
  return MonetQMResolve.readiness(qmCodes(), qmPanel.read(), { cell: qmCellInfo(), extent: qmExtent(), symbols: qmSymbols(), potcarAvailable: Boolean(aseState.available || window.monet.desktop) })
}

function updateQmUI () {
  const codes = qmCodes()
  state.opts.generateGaussian = codes.includes('gaussian')
  $('gaussian-details').classList.toggle('disabled', !codes.length)
  qmPanel.show(codes)
  qmPanel.setSymbols(qmSymbols())
  qmPanel.setPotcarAvailable(Boolean(aseState.available || window.monet.desktop))
  const cards = qmPanel.read()
  const cell = qmCellInfo()
  for (const code of codes.filter(c => MonetQMResolve.PLANE_WAVE.includes(c))) {
    const s = cards[code]
    const text = s.isolated ? `Vacuum box (isolated), ${s.padding} Å` : !cell ? '✖ No cell'
      : cell.source === 'applied' ? `Crystal cell applied (${aseState.cellParameters.join(', ')})` : 'Lattice from the trajectory'
    qmPanel.setCellStatus(code, text, !s.isolated && !cell)
  }
  let spec = null
  const messages = []
  const ready = qmReadiness()
  try { spec = buildQmSpec() } catch (error) { messages.push(error.message) }
  messages.push(...ready.blocked, ...ready.warnings.map(w => `⚠ ${w}`))
  const blocked = Boolean(codes.length) && (ready.blocked.length > 0 || !spec)
  $('qm-status').textContent = messages.length ? messages.join(' ') : codes.length ? `Inputs for: ${codes.map(code => MonetQMResolve.LABELS[code]).join(', ')}.` : 'No quantum-chemistry inputs will be written.'
  $('qm-define-cell').classList.toggle('hidden', !ready.blocked.some(m => / no cell\./.test(m)))
  $('next-4').disabled = !state.outputDir || blocked
  // Card titles mark custom templates; previews render configuration 1.
  const atoms = qmAtoms()
  for (const code of codes) {
    const summary = $(`qm-card-${code}`).querySelector('summary')
    summary.textContent = MonetQMResolve.LABELS[code] + (qmCustom[code] && Object.keys(qmCustom[code]).length ? ' · custom template' : '')
    let preview = ''
    if (spec && atoms.length) {
      try {
        const conf = { index: 1, frame: 0, symbols: atoms.map(a => a.element), positions: atoms.map(a => [a.x, a.y, a.z]), lattice: cell && cell.source === 'trajectory' ? cell.rows : undefined }
        const one = { ...spec, codes: { [code]: spec.codes[code] } }
        const files = MonetQM.render(one, conf)
        preview = files.map(file => `── ${file.path}\n${file.text}`).join('\n')
      } catch (error) { preview = error.message }
    }
    qmPanel.setPreview(code, preview)
  }
  // Template selector lists the resolved files of every selected code.
  const select = $('qm-template-file'), previous = select.value
  select.replaceChildren()
  if (spec) {
    for (const code of codes) {
      spec.codes[code].files.forEach((file, i) => {
        const option = document.createElement('option')
        option.value = `${code}:${i}`
        option.textContent = `${MonetQMResolve.LABELS[code]} — ${file.name}`
        select.appendChild(option)
      })
    }
  }
  if ([...select.options].some(option => option.value === previous)) select.value = previous
  showTemplate(spec)
}

function selectedTemplate () {
  const [code, index] = ($('qm-template-file').value || '').split(':')
  return code ? { code, index: Number(index) } : null
}
function showTemplate (spec = null) {
  const target = selectedTemplate()
  let text = ''
  if (target) {
    const custom = qmCustom[target.code] && qmCustom[target.code][target.index]
    if (custom !== undefined) text = custom
    else {
      try { text = (spec || buildQmSpec()).codes[target.code].files[target.index].template } catch (error) { text = '' }
    }
  }
  $('qm-template-text').value = text
  $('qm-template-text').disabled = !target
}
$$('[data-qm-code]').forEach(input => input.addEventListener('change', updateQmUI))
for (const id of ['qm-charge', 'qm-mults']) $(id).addEventListener('input', updateQmUI)
$('qm-template-file').addEventListener('change', () => showTemplate())
$('qm-template-text').addEventListener('input', () => {
  const target = selectedTemplate()
  if (!target) return
  ;(qmCustom[target.code] ||= {})[target.index] = $('qm-template-text').value
  updateQmUI()
})
$('qm-template-reset').addEventListener('click', () => {
  const target = selectedTemplate()
  if (!target || !qmCustom[target.code]) return
  delete qmCustom[target.code][target.index]
  updateQmUI()
})
$('qm-define-cell').addEventListener('click', () => {
  // Open Structure analysis › Cell (the panel that holds #cell-apply).
  goTo('analysis')
  showViewerTab('ase')
  $('cell-apply').scrollIntoView({ block: 'center' })
})
```

Then:
- `btn-output-dir` handler: replace `$('next-4').disabled = false` with `updateQmUI()`.
- `goTo`: when entering step 4, call `updateQmUI()` so cell status, species tables and previews reflect the current selection (add `if (String(step) === '4') updateQmUI()` at the end of `goTo`).
- `invalidateCellAnalyses()` (cell apply/reset): call `updateQmUI()` at its end so the cards follow the applied cell.
- `next-4` handler: before `goTo(5)`, `const ready = qmReadiness(); if (ready.blocked.length) { $('qm-status').textContent = ready.blocked.join(' '); return setStatus(ready.blocked[0]) }`.
- `qmSummary()`: use `(spec.codes[code].override || spec.common).multiplicities` and `MonetQM.CODES[code].folder`; files named `vasp/POTCAR` are not in `files`, so append `POTCAR` to the VASP list when `spec.codes.vasp.potcar`.
- In `preload.js`, add `desktop: true` to the exposed `monet` API object (used for `potcarAvailable`); the browser bridge leaves it undefined.
- If the Cell controls live in a sub-tab of the ASE panel, also activate that sub-tab in the `qm-define-cell` handler (find how `cell-apply`'s container is revealed).

- [ ] **Step 4: Run** `PYTHON=.venv/bin/python node tests/ase-ui.cjs` and `PYTHON=.venv/bin/python node tests/history-ui.cjs` → PASS.

- [ ] **Step 5: Verify in the browser.** Start the preview (`preview_start` name `monet`), load `examples/water.XYZ`, go to step 4, tick QE: status shows the no-cell block and Run is disabled; tick *Isolated system*: Run enabled, preview shows a centred box; tick VASP → species table `O`, `H`; switch CP2K to PBE0 → AUX_FIT column appears. Take a screenshot for the report.

- [ ] **Step 6: Commit**

```bash
git add renderer.js preload.js tests/ase-ui.cjs
git commit -m "Processing Options: cell check blocks plane-wave inputs; previews and custom templates per code

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Methods report, CI, docs

**Files:**
- Modify: `report.js`, `tests/report.cjs`, `.github/workflows/tests.yml`, `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: extract steps whose `params.qm.summary` is `{ code: string }` (Task 4) and `result.sampledFrames`.

- [ ] **Step 1: Failing report test** — in `tests/report.cjs`, add a session with an `ok` extract step `{ kind: 'extract', action: 'extract', params: { selected: [1, 2, 3], frequency: 10, qm: { summary: { gaussian: 'Gaussian: b3lyp/6-31+g(d,p) (unrestricted), single point, singlet and triplet', qe: 'QE pw.x: functional from the pseudopotentials, ecutwfc 50 Ry, Γ point, single point, isolated (MT, vacuum 10 Å), singlet and triplet' } } }, result: { totalFrames: 200, sampledFrames: 20 } }` (build it the same way the file builds its other steps) and assert:

```js
assert.match(md, /Quantum-chemistry inputs for 20 configurations:\n- Gaussian: b3lyp\/6-31\+g\(d,p\) \(unrestricted\), single point, singlet and triplet\n- QE pw\.x: functional from the pseudopotentials, ecutwfc 50 Ry, Γ point, single point, isolated \(MT, vacuum 10 Å\), singlet and triplet\n/); checks++
```

- [ ] **Step 2: Run** `node tests/report.cjs` → FAIL.

- [ ] **Step 3: Implement** in `report.js`: where the steps section writes each step line, after an `ok` step with `kind === 'extract'` and `step.params?.qm?.summary` (an object), append:

```js
const summary = step.params && step.params.qm && step.params.qm.summary
if (step.kind === 'extract' && summary && typeof summary === 'object') {
  const entries = Object.values(summary).filter(v => typeof v === 'string')
  if (entries.length) out.push(`Quantum-chemistry inputs for ${number(step.result && step.result.sampledFrames)} configurations:\n${entries.map(v => `- ${v}`).join('\n')}\n`)
}
```

(`out` stands for the array or string builder the steps section uses — follow the existing code; keep one blank line between blocks as the rest of the report does.) Session steps are untrusted data: only strings are printed.

- [ ] **Step 4: CI** — in `.github/workflows/tests.yml`, add `node tests/qm-resolve.cjs` right after `node tests/qm-parity.cjs`.

- [ ] **Step 5: Docs.** README: replace the description of the step-4 QM form (search for "Multiplicities" / "Vacuum") with a short section: shared *Electronic states*; one card per code with its settings; plane-wave codes need a cell (crystal cell, trajectory lattice) or the *Isolated system: vacuum box* flag, and Run stays disabled otherwise; MD, variable-cell relaxation, ph.x, CP2K hybrids via ADMM; *Build POTCAR* reads a local library folder (launcher/desktop app only; MONET never ships POTCARs); *Edit templates* overrides a card. CHANGELOG `## Unreleased`: add

```
- Processing Options: one settings card per quantum-chemistry code (Gaussian, ORCA, QE, VASP, CP2K, Qbox) with calculation type (SP, Opt, Opt+Freq, Freq, TD-DFT, MD, variable-cell relaxation), functional/method, basis or cutoff, dispersion, solvent, k-points and extra keywords; charge and multiplicities shared with a per-code override.
- Plane-wave codes need a cell: the applied crystal cell or the trajectory lattice, or the new "Isolated system: vacuum box" flag (configuration centred; QE assume_isolated='mt', CP2K Poisson MT, VASP dipole correction). Run is disabled otherwise.
- VASP: KPOINTS and POTCAR.spec written; POTCAR and exact NELECT assembled from a local POTCAR library (launcher, desktop app). QE: optional ph.x input for Γ phonons; input files end in .inp. CP2K: PBE0/B3LYP/HSE06 through ADMM.
- Changed: ORCA %maxcore defaults to 75 % of memory per core (was 100 %); the vacuum box is now centred on the configuration.
- Methods report: one line per quantum-chemistry code.
```

- [ ] **Step 6: Run the whole suite list:**

```
for t in tests/*.cjs; do PYTHON=.venv/bin/python node $t | tail -1; done
```

Expected: 14 lines, each starting with `PASS:`.

- [ ] **Step 7: Commit**

```bash
git add report.js tests/report.cjs .github/workflows/tests.yml README.md CHANGELOG.md
git commit -m "Methods report lists the quantum-chemistry inputs per code; docs and CI for the per-code cards

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes (for the controller)

- Spec coverage: layout (T7, T8), card keywords (T1–T3), shared MD/vc-relax fields (T1–T3, T7), cell priority + centring (T5), readiness block/warnings (T4, T8), engines/parity (T5), POTCAR (T6), history (spec with `summary` already recorded by the existing extract step; T4 adds `summary`), report (T9), tests (every task), out of scope respected.
- Expected check counts in Tasks 1–4 are the count of `checks++` in the listed tests; if an implementer merges or splits assertions, the PASS line count changes — the reviewer checks the assertions, not the number.

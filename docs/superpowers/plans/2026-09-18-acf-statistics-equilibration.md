# ACF statistics and equilibration: implementation plan (roadmap Plan 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make MONET's stride and error bars reliable. The work covers these gaps from `docs/md-analysis-workflow.md` §15:
- A1: Sokal/Geyer truncation of τ_int;
- A2: the error of τ_int;
- A3: block averaging;
- A5: g of the subsampled configurations;
- A6: the T/τ indicator;
- B7: automatic equilibration detection;
- B8: cropping to the production window.

It also fixes a chart bug found while planning (Task 0).

**Architecture:** the numerics are pure NumPy functions in `monet_analysis.py`.
- `ase_bridge.py` exposes them through the existing `acf` action, which gains extra outputs, and a new `equilibration` action.
- `renderer.js` and `index.html` show them in the *Custom analyses › Autocorrelation* tab, with two new charts: `acfblock` and `equil`.
- `ase-model.js` gets the same Sokal estimator, so the SEMs in plot notes match the ACF panel.
- Cropping reuses the existing `subsample` action (stride 1, `start` = t₀).

**Tech stack:** Python ≥ 3.10 with NumPy/SciPy (ASE is present); vanilla JS in the browser, where the charts are `MonetLineChart` in `plot.js`; Node test suites in `tests/*.cjs`, with jsdom for the UI.

## Global constraints

- Work on branch `v2-ase`. Before starting: `git fetch origin && git rebase origin/v2-ase`. Never push to `master`.
- **Ask the user before every commit and every push** (standing project rule). Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Run every suite as `PYTHON=.venv/bin/python node tests/<suite>.cjs`. All 7 suites must pass before each commit: regression, qm-parity, formats, analysis, mdanalysis, ase-integration, ase-ui.
- No new dependencies. `requirements.txt` and `environment.yml` stay unchanged. The code must run on Python 3.10 and 3.13 (the CI matrix).
- Nothing from the reference paper is hard-coded: dt, τ and strides are always user inputs. Paper values appear only in docs and tests.
- A new bridge action must be registered in **both** `ACTIONS` in `ase_bridge.py` and `ACTIONS` in `start_monet.py`. A new command key must be added to `ALLOWED` in `start_monet.py`, **otherwise the launcher silently drops it**.
- Bridge output goes through `json.dumps(allow_nan=False)`, so wrap any dict that can hold NaN with `_finite(...)`.
- UI text is English. Use fs for times and the symbols τ, τ_int, N_eff, g, t₀. Cite the method in comments (for example "Madras & Sokal 1988").

## File map

| File | Change |
| --- | --- |
| `plot.js` | Task 0: `axisValues()`; labels with thousands separators are parsed correctly |
| `monet_analysis.py` | `TAU_INT_METHODS`, `integrated_time`, `block_average`, `detect_equilibration`; `correlation_time` gains `tau_int_method`, `n_samples` |
| `ase_bridge.py` | `_acf_series` helper; `action_acf` returns τ_int details and `blocking`; new `action_equilibration`; validation |
| `start_monet.py` | `'equilibration'` in `ACTIONS`, `'tau_int_method'` in `ALLOWED` |
| `ase-model.js` | `tauFromAcf` (Sokal), `integratedTime` uses it, `subsampleInefficiency` |
| `index.html` | τ_int estimator select, run-length line, block-averaging chart block, equilibration button, result and chart |
| `renderer.js` | `acfCommand()`, τ_int/T/g_sub text, `drawAcfBlockChart`, equilibration flow and crop |
| `tests/analysis.cjs` | numerical and bridge tests |
| `tests/regression.cjs` | JS estimator tests |
| `tests/ase-ui.cjs` | mock and DOM tests |
| `README.md`, `CHANGELOG.md`, `docs/md-analysis-workflow.md` (+ `.docx`) | documentation |

---

### Task 0: Chart labels with thousands separators (bug fix)

`lineLabels` in `renderer.js` formats with `toLocaleString('en-US')`, so 1234.5 becomes `"1,234.5"`. `plot.js` then does `Number(label)`, which is NaN, in four places:
- the markers (the t* line on the ACF);
- `zoomToValues` (the *Show lags up to* field);
- `labelIndex` (the player cursor and click-to-frame).

All of them silently fail once the axis passes 999.

**Files:**
- Modify: `plot.js` (LineChart class: `labelIndex` ~l.359, `zoomToValues` ~l.392, markers ~l.614)
- Test: `tests/ase-ui.cjs`

**Interfaces:**
- Produces: `LineChart.prototype.axisValues(): number[]`, the numeric value of every label with commas removed.

- [ ] **Step 1: Write the failing test.** In `tests/ase-ui.cjs`, insert this block immediately before the line `el('acf-quantity').value = 'bond'; el('acf-quantity').dispatchEvent(new w.Event('change'))`:

```js
  // Labels formatted with thousands separators ("1,500") still map to numbers for zoom, cursor and markers.
  { const chart = w.testMonet.charts.acf
    chart.setData({ title: 't', labels: ['0', '500', '1,000', '1,500', '2,000'], datasets: [{ label: 'a', data: [1, .8, .5, .3, .1] }], markers: [{ value: 1200, label: 'm' }] })
    assert.deepEqual([...chart.axisValues()], [0, 500, 1000, 1500, 2000]); checks++
    assert.equal(chart.zoomToValues(0, 1000), true); assert.deepEqual([...chart.viewRange()], [0, 2]); checks++
    assert.equal(chart.labelIndex(1200), 2); checks++
    chart.setView(null) }
```

- [ ] **Step 2: Run it and check that it fails.**
Run: `PYTHON=.venv/bin/python node tests/ase-ui.cjs`
Expected: FAIL with `chart.axisValues is not a function`.

- [ ] **Step 3: Implement.** In `plot.js`, class `LineChart`, add the method before `labelIndex`:

```js
    // Numeric value of every x label; "1,234.5" (en-US grouping from the renderer's fmt) is 1234.5.
    axisValues () {
      return (this.data?.labels || []).map(label => Number(String(label).replace(/,/g, '')))
    }
```

Then change the three call sites:
- In `labelIndex`, replace the loop body line `const value = Number(labels[i])` with `const value = values[i]`. Declare `const values = this.axisValues()` before the loop, and use `const target = Number(String(label).replace(/,/g, ''))`.
- In `zoomToValues`, replace `const values = (this.data?.labels || []).map(Number)` with `const values = this.axisValues()`.
- In the markers loop, replace `const values = labels.map(Number)` with `const values = this.axisValues()`.

- [ ] **Step 4: Run the tests and check that they pass.**
Run: `PYTHON=.venv/bin/python node tests/ase-ui.cjs && PYTHON=.venv/bin/python node tests/regression.cjs`
Expected: both print `PASS: …`.

- [ ] **Step 5: Commit, after the user approves.**

```bash
git add plot.js tests/ase-ui.cjs
git commit -m "Fix chart markers, zoom and cursor for axis labels above 999

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 1: Integrated autocorrelation time with Sokal/Geyer windows and its error (A1, A2)

**Files:**
- Modify: `monet_analysis.py`. Add after `autocorrelation` (~l.229); change `correlation_time` (~l.232–271).
- Test: `tests/analysis.cjs`

**Interfaces:**
- Produces:
  - `TAU_INT_METHODS = ('sokal', 'geyer', 'zero')`.
  - `integrated_time(acf, dt=1.0, method='sokal', c=5.0, n_samples=None) -> dict`. Keys: `tau_int` (time units of dt), `tau_int_error`, `window` (lags), `converged` (bool), `method`.
  - `correlation_time(lags, acf, fit_until='zero', model='exp', tau_int_method='zero', n_samples=None)`. It returns the old keys plus `tau_int_error`, `tau_int_window`, `tau_int_method` and `tau_int_converged`.

- [ ] **Step 1: Write the failing tests.** In `tests/analysis.cjs`, after the line `const near = …`, add:

```js
// Run Python against monet_analysis and parse its JSON (NaN becomes null).
const py = code => JSON.parse(execFileSync(python, ['-c', `import json, math, sys
import numpy as np
sys.path.insert(0, sys.argv[1])
import monet_analysis as ma
def dump(obj):
    print(json.dumps(obj).replace('NaN', 'null'))
def ou(n, tau=40.0, sd=15.0, seed=3):
    rng = np.random.default_rng(seed); x = np.zeros(n)
    for i in range(1, n):
        x[i] = x[i - 1] * math.exp(-1 / tau) + sd * math.sqrt(1 - math.exp(-2 / tau)) * rng.normal()
    return x
${code}`, root]).toString())
```

Then, immediately before the final `fs.rmSync(temp, { recursive: true, force: true })`, add:

```js
// τ_int of an exact exponential ACF (τ = 40 lags): Sokal window (c = 5), Geyer sequence, first zero.
const tauInt = py(`
exact = math.exp(-1 / 40) ** np.arange(2000)
white = np.zeros(200); white[0] = 1
out = {m: ma.integrated_time(exact, 1.0, m, n_samples=20000) for m in ma.TAU_INT_METHODS}
out['half_dt'] = ma.integrated_time(exact, 0.5, 'sokal')
out['white'] = {m: ma.integrated_time(white, 1.0, m) for m in ma.TAU_INT_METHODS}
try:
    ma.integrated_time(exact, 1.0, 'magic'); out['bad'] = False
except ValueError:
    out['bad'] = True
t = np.arange(0, 400.0)
out['ct'] = ma.correlation_time(t, np.exp(-t / 40), 'zero', 'exp', 'sokal', 20000)
dump(out)
`)
near(tauInt.sokal.tau_int, 39.7292, 1e-3, 'Sokal τ_int'); assert.equal(tauInt.sokal.window, 199); assert.equal(tauInt.sokal.converged, true); checks++
near(tauInt.sokal.tau_int_error, 39.7292 * Math.sqrt(2 * 399 / 20000), 1e-3, 'Madras–Sokal error of τ_int'); checks++
near(tauInt.geyer.tau_int, 40.0021, 1e-3, 'Geyer τ_int'); near(tauInt.zero.tau_int, 40.0021, 1e-3, 'first-zero τ_int'); assert.equal(tauInt.zero.converged, false); checks++
near(tauInt.half_dt.tau_int, 39.7292 / 2, 1e-3, 'τ_int scales with dt'); checks++
near(tauInt.white.sokal.tau_int, 0.5, 1e-12, 'white Sokal'); near(tauInt.white.geyer.tau_int, 0.5, 1e-12, 'white Geyer'); assert.equal(tauInt.white.zero.tau_int, null); checks++
assert.equal(tauInt.bad, true); checks++
near(tauInt.ct.tau_fit, 40, 1e-6, 'fit unchanged'); near(tauInt.ct.tau_int, 39.7292, 1e-3, 'correlation_time uses the chosen estimator'); assert.equal(tauInt.ct.tau_int_method, 'sokal'); assert.equal(tauInt.ct.tau_int_window, 199); checks++
```

These expected values were checked with a prototype on 2026-09-18.

- [ ] **Step 2: Run it and check that it fails.**
Run: `PYTHON=.venv/bin/python node tests/analysis.cjs`
Expected: FAIL with `AttributeError: module 'monet_analysis' has no attribute 'TAU_INT_METHODS'`.

- [ ] **Step 3: Implement.** In `monet_analysis.py`, after `autocorrelation`, add:

```python
TAU_INT_METHODS = ('sokal', 'geyer', 'zero')


def integrated_time(acf, dt=1.0, method='sokal', c=5.0, n_samples=None):
    """Integrated autocorrelation time of a normalised ACF sampled every `dt`.

    tau_int = dt (1/2 + sum_{k=1}^{M} C(k)); the statistical inefficiency is g = 2 tau_int / dt.
    method  'sokal': smallest window M >= c tau_int(M), c = 5 (Madras & Sokal 1988; Sokal 1997);
            'geyer': initial monotone sequence of the pair sums C(2k) + C(2k+1) (Geyer 1992);
            'zero':  trapezoidal integral up to the first non-positive C (MONET <= 2.1).
    With `n_samples` = N, the error is tau_int sqrt(2 (2M + 1) / N) (Madras & Sokal 1988; Wolff 2004).
    """
    acf = np.asarray(acf, dtype=float)
    n = len(acf)
    if method not in TAU_INT_METHODS:
        raise ValueError(f'Unknown τ_int estimator {method!r}: use sokal, geyer or zero.')
    if n < 2:
        raise ValueError('The ACF needs at least two lags.')
    if method == 'zero':
        below = np.flatnonzero(acf <= 0)
        converged = bool(len(below))
        window = int(below[0]) if converged else n
        tau = float(np.sum((acf[1:window] + acf[:window - 1]) / 2)) if window > 1 else math.nan
    elif method == 'sokal':
        running = 0.5 + np.cumsum(acf[1:])
        hits = np.flatnonzero(np.arange(1, n) >= c * running)
        converged = bool(len(hits))
        window = int(hits[0]) + 1 if converged else n - 1
        tau = float(running[window - 1])
    else:
        pairs = acf[:n - n % 2].reshape(-1, 2).sum(axis=1)
        negative = np.flatnonzero(pairs <= 0)
        converged = bool(len(negative))
        stop = int(negative[0]) if converged else len(pairs)
        tau = float(np.minimum.accumulate(pairs[:stop]).sum() - 0.5) if stop else math.nan
        window = 2 * stop
    error = tau * math.sqrt(2 * (2 * window + 1) / n_samples) if n_samples and math.isfinite(tau) else math.nan
    return {'tau_int': tau * dt, 'tau_int_error': error * dt, 'window': window,
            'converged': converged, 'method': method}
```

In `correlation_time`, make these changes:
1. Change the signature to `def correlation_time(lags, acf, fit_until='zero', model='exp', tau_int_method='zero', n_samples=None):`.
2. Add one docstring line: `tau_int_method / n_samples: estimator and sample count passed to integrated_time.`
3. Replace the line that computes `tau_int = float(np.sum((acf[:zero][1:] …` with:

```python
    step = float(lags[1] - lags[0]) if len(lags) > 1 else 1.0
    integral = integrated_time(acf, step, tau_int_method, n_samples=n_samples)
    tau_int = integral['tau_int']
```

4. Extend the returned dict with `'tau_int_error': integral['tau_int_error'], 'tau_int_window': integral['window'], 'tau_int_method': tau_int_method, 'tau_int_converged': integral['converged'],`.

The default is still `'zero'`, so existing callers are unchanged.

- [ ] **Step 4: Run the tests and check that they pass.**
Run: `PYTHON=.venv/bin/python node tests/analysis.cjs`
Expected: `PASS: … analysis checks …`, with 7 more checks than before.

- [ ] **Step 5: Commit, after the user approves.**

```bash
git add monet_analysis.py tests/analysis.cjs
git commit -m "Add Sokal and Geyer estimators of tau_int with its error

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Block averaging (A3)

**Files:**
- Modify: `monet_analysis.py` (after `integrated_time`)
- Test: `tests/analysis.cjs`

**Interfaces:**
- Produces: `block_average(values, min_blocks=8) -> dict`. Keys:
  - `sizes` (frames per block: 1, 2, 4, …);
  - `sem`;
  - `sem_error`;
  - `plateau_index` (int or None);
  - `plateau_sem`;
  - `g` = N·SEM²/σ² (NaN without a plateau).

- [ ] **Step 1: Write the failing test.** Add before the final `fs.rmSync(…)` in `tests/analysis.cjs`:

```js
// Blocking (Flyvbjerg–Petersen): OU with τ = 40 (g ≈ 80, SEM ≈ 15·√(80/20000) ≈ 0.94), white noise, a too-short run.
const blocks = py(`
dump({'ou': ma.block_average(ou(20000)), 'white': ma.block_average(np.random.default_rng(5).normal(size=20000)),
      'short': ma.block_average(ou(300))})
`)
assert.deepEqual(blocks.ou.sizes.slice(0, 4), [1, 2, 4, 8]); assert.equal(blocks.ou.sizes.at(-1), 2048); checks++
assert.equal(blocks.ou.sizes[blocks.ou.plateau_index], 256); near(blocks.ou.plateau_sem, 0.943, 0.1, 'blocking SEM'); near(blocks.ou.g, 80, 12, 'blocking g'); checks++
assert.equal(blocks.white.plateau_index, 0); near(blocks.white.g, 1, 1e-9, 'white g'); checks++
assert.equal(blocks.short.plateau_index, null); assert.equal(blocks.short.g, null); checks++
```

These expected values were checked with a prototype: the plateau is at 256 frames, SEM 0.932, g 77.3.

- [ ] **Step 2: Run it and check that it fails.**
Run: `PYTHON=.venv/bin/python node tests/analysis.cjs`
Expected: FAIL with `AttributeError: … 'block_average'`.

- [ ] **Step 3: Implement.** In `monet_analysis.py`, after `integrated_time`:

```python
def block_average(values, min_blocks=8):
    """Blocking analysis of the mean of one series (Flyvbjerg & Petersen 1989).

    Block sizes double from 1 while at least `min_blocks` blocks remain. For each size the standard
    error of the mean is the scatter of the block means / sqrt(m), with error SEM / sqrt(2 (m - 1)).
    The plateau is the first size whose SEM the next two sizes do not exceed by more than their own
    error; None while the SEM keeps growing (run too short). g = N SEM^2 / sigma^2.
    """
    if min_blocks < 2:
        raise ValueError('Blocking needs at least two blocks.')
    x = np.asarray(values, dtype=float)
    n = len(x)
    sigma = float(x.std(ddof=1)) if n > 1 else 0.0
    sizes, sems, errors = [], [], []
    size = 1
    while n // size >= min_blocks:
        m = n // size
        means = x[:m * size].reshape(m, size).mean(axis=1)
        sem = float(means.std(ddof=1) / math.sqrt(m))
        sizes.append(size)
        sems.append(sem)
        errors.append(sem / math.sqrt(2 * (m - 1)))
        size *= 2
    plateau = next((i for i in range(len(sizes) - 2)
                    if sems[i + 1] <= sems[i] + errors[i + 1] and sems[i + 2] <= sems[i] + errors[i + 2]), None)
    plateau_sem = sems[plateau] if plateau is not None else math.nan
    g = n * plateau_sem ** 2 / sigma ** 2 if plateau is not None and sigma > 0 else math.nan
    return {'sizes': sizes, 'sem': sems, 'sem_error': errors, 'plateau_index': plateau,
            'plateau_sem': plateau_sem, 'g': g}
```

- [ ] **Step 4: Run the tests and check that they pass.**
Run: `PYTHON=.venv/bin/python node tests/analysis.cjs`
Expected: `PASS`.

- [ ] **Step 5: Commit, after the user approves.**

```bash
git add monet_analysis.py tests/analysis.cjs
git commit -m "Add Flyvbjerg-Petersen block averaging with plateau detection

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Equilibration detection by maximum N_eff (B7, numerics)

**Files:**
- Modify: `monet_analysis.py` (after `block_average`)
- Test: `tests/analysis.cjs`

**Interfaces:**
- Consumes: `autocorrelation`, `integrated_time`.
- Produces: `detect_equilibration(values, candidates=50, method='sokal') -> dict`. Keys: `starts` (sample indices), `g`, `n_effective`, `t0`, `g_t0`, `n_effective_t0`.

- [ ] **Step 1: Write the failing test.** Add before the final `fs.rmSync(…)`:

```js
// Equilibration (Chodera 2016): a 60° transient relaxing with τ = 200 is discarded; a stationary run keeps t₀ = 0.
const equil = py(`
t = np.arange(6000.0)
dump({'relax': ma.detect_equilibration(60 * np.exp(-t / 200) + ou(6000, seed=11)),
      'flat': ma.detect_equilibration(ou(6000, seed=12))})
`)
assert.ok(equil.relax.t0 >= 250 && equil.relax.t0 <= 1000, `t0 = ${equil.relax.t0}`); assert.ok(equil.relax.n_effective_t0 > equil.relax.n_effective[0]); checks++
assert.equal(equil.flat.t0, 0); checks++
assert.equal(equil.relax.starts[0], 0); assert.equal(equil.relax.starts.at(-1), 3000); assert.equal(equil.relax.g.length, equil.relax.starts.length); checks++
```

The prototype gave t₀ = 367 for the relaxing series and 0 for the stationary one.

- [ ] **Step 2: Run it and check that it fails.**
Run: `PYTHON=.venv/bin/python node tests/analysis.cjs`
Expected: FAIL with `AttributeError: … 'detect_equilibration'`.

- [ ] **Step 3: Implement.**

```python
def detect_equilibration(values, candidates=50, method='sokal'):
    """Start of the production window by maximum effective sample size (Chodera 2016).

    For trial origins t0 spread over the first half of the series, g(t0) = 2 tau_int of values[t0:]
    (in samples, at least 1) and N_eff(t0) = (N - t0) / g(t0); the chosen t0 maximises N_eff.
    """
    x = np.asarray(values, dtype=float)
    n = len(x)
    if n < 16:
        raise ValueError('Equilibration detection needs at least 16 frames.')
    starts = np.unique(np.linspace(0, n // 2, candidates).astype(int))
    g, n_eff = [], []
    for t0 in starts:
        segment = x[t0:]
        acf = autocorrelation(segment, 'linear', len(segment) // 2)
        tau = integrated_time(acf, 1.0, method)['tau_int']
        g0 = max(1.0, 2 * tau) if math.isfinite(tau) else 1.0
        g.append(g0)
        n_eff.append((n - t0) / g0)
    best = int(np.argmax(n_eff))
    return {'starts': starts.tolist(), 'g': g, 'n_effective': n_eff, 't0': int(starts[best]),
            'g_t0': g[best], 'n_effective_t0': n_eff[best]}
```

- [ ] **Step 4: Run the tests and check that they pass.**
Run: `PYTHON=.venv/bin/python node tests/analysis.cjs`
Expected: `PASS`.

- [ ] **Step 5: Commit, after the user approves.**

```bash
git add monet_analysis.py tests/analysis.cjs
git commit -m "Add automatic equilibration detection (maximum N_eff)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Bridge: τ_int estimator, blocking output and the `equilibration` action

**Files:**
- Modify: `ase_bridge.py`: `action_acf` (~l.699–749), new `_acf_series` and `action_equilibration`, `validate_command` (~l.1239, ~l.1271–1297), `ACTIONS` (~l.1339).
- Modify: `start_monet.py` l.29–35 (`ACTIONS`, `ALLOWED`).
- Test: `tests/analysis.cjs` (synthetic file `torsion-relax.xyz` plus bridge checks).

**Interfaces:**
- Consumes: `integrated_time`, `block_average`, `detect_equilibration`, `TAU_INT_METHODS`.
- Produces:
  - **`acf` result:** the old keys, plus `tau_int_error`, `tau_int_window`, `tau_int_method`, `tau_int_converged`, and `blocking` = {`sizes`, `times` (fs), `sem`, `sem_error`, `plateau_index`, `plateau_sem`, `g`}.
  - **`equilibration` command:** the same keys as `acf` (`filename`, `quantity`, `groups`, `dt`, `frame_step`, `angle_range`, `mode`, `tau_int_method`).
  - **`equilibration` result:** `starts`, `times` (fs), `g`, `n_effective`, `t0` (analysed-frame index), `t0_time` (fs), `t0_frame` (saved frame of the active file), `group`, `per_group_t0`, `n_frames`, `frame_step`, `dt`, `g_t0`, `n_effective_t0`, `n_effective_full`.

- [ ] **Step 1: Write the failing tests.** In the generator script at the top of `tests/analysis.cjs`, append after the `write('torsion-flip.xyz', …)` line, still inside the Python string:

```python
# 7) Torsion relaxing from 150 deg to 90 deg (tau = 200 fs) with OU noise (tau = 40 fs), dt = 1 fs.
rr = np.random.default_rng(11)
noise = np.zeros(6000)
for i in range(1, 6000):
    noise[i] = noise[i - 1] * np.exp(-1 / 40) + 15 * np.sqrt(1 - np.exp(-2 / 40)) * rr.normal()
relax = np.radians(90 + 60 * np.exp(-np.arange(6000) / 200) + noise)
write('torsion-relax.xyz', ['C', 'C', 'C', 'C'], [[[1, 0, 0], [0, 0, 0], [0, 0, 1.5], [np.cos(th), np.sin(th), 1.5]] for th in relax])
```

Before the final `fs.rmSync(…)`, add:

```js
// Bridge: default Sokal τ_int with error and window, blocking output, equilibration action, launcher whitelist.
const ou1 = { action: 'acf', filename: path.join(temp, 'torsion-ou.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1, max_lag: 300 }
r = bridge(ou1)
assert.equal(r.tau_int_method, 'sokal'); near(r.tau_int, 40, 8, 'Sokal τ_int on OU'); assert.ok(r.tau_int_error > 2 && r.tau_int_error < 15, r.tau_int_error); assert.equal(r.tau_int_converged, true); checks++
assert.ok(Number.isInteger(r.blocking.plateau_index), JSON.stringify(r.blocking)); near(r.blocking.g, 2 * r.tau_int, 0.35 * 2 * r.tau_int, 'blocking g vs 2 τ_int'); assert.equal(r.blocking.times[1], 2); checks++
r = bridge({ ...ou1, tau_int_method: 'zero' })
assert.equal(r.tau_int_method, 'zero'); assert.equal(r.tau_int_converged, true); checks++
assert.equal(bridge({ ...ou1, tau_int_method: 'magic' }).ok, false); checks++
const relax = { action: 'equilibration', filename: path.join(temp, 'torsion-relax.xyz'), quantity: 'dihedral', groups: [[0, 1, 2, 3]], dt: 1 }
r = bridge(relax)
assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300)); assert.ok(r.t0 >= 250 && r.t0 <= 1000, r.t0); assert.equal(r.t0_frame, r.t0); near(r.t0_time, r.t0, 1e-9, 't0 in fs'); checks++
assert.ok(r.n_effective_t0 > r.n_effective_full); assert.equal(r.times.length, r.n_effective.length); checks++
r = bridge({ ...relax, frame_step: 2 })
assert.equal(r.t0_frame, 2 * r.t0); near(r.t0_time, 2 * r.t0, 1e-9, 't0 with frame step'); checks++
assert.equal(bridge({ ...relax, quantity: 'volume' }).ok, false); checks++
const launcher = fs.readFileSync(path.join(root, 'start_monet.py'), 'utf8')
assert.match(launcher, /'equilibration'/); assert.match(launcher, /'tau_int_method'/); checks++
```

If `blocking.plateau_index` is not an integer for this seed, print `r.blocking` and compare it with the Task 2 behaviour before touching any tolerance.

- [ ] **Step 2: Run it and check that it fails.**
Run: `PYTHON=.venv/bin/python node tests/analysis.cjs`
Expected: FAIL at `assert.equal(r.tau_int_method, 'sokal')`, which is `undefined` at this point.

- [ ] **Step 3: Implement the helper and `action_acf`.** In `ase_bridge.py`, add above `action_acf`:

```python
def _acf_series(cmd):
    """Analysed frames, per-group series and period of the autocorrelation quantity."""
    quantity = cmd['quantity']
    frames, series = _series_for(cmd, quantity, cmd['groups'])
    if cmd.get('mode', 'linear') == 'circular' and quantity not in ('angle', 'dihedral'):
        raise ValueError('Circular autocorrelation applies to angles and dihedrals only.')
    # Folded dihedrals (0-180, period 180) treat opposite orientations as the same torsion.
    folded = quantity == 'dihedral' and cmd.get('angle_range') == 'fold180'
    period = 180.0 if folded else 360.0
    return frames, (series % 180.0 if folded else series), period
```

In `action_acf`:
1. Replace the block from `frames, series = _series_for(…)` through `series = series % 180.0` with:

```python
    frames, series, period = _acf_series(cmd)
    mode = cmd.get('mode', 'linear')
```

   Delete the now-unused `angular` variable; the circular-mode check has moved into `_acf_series`.
2. Change the `correlation_time` call to:

```python
    fit = monet_analysis.correlation_time(lags, acf, cmd.get('fit_until', 'zero'), cmd.get('fit_model', 'exp'),
                                          cmd.get('tau_int_method', 'sokal'), series.shape[1])
```

3. After the `per_group` loop, before `prog("Done", 100)`, add:

```python
    # Blocking of the first group, on deviations from its (circular) mean so torsions crossing 0/360 stay continuous.
    first = shown[0] - per_group[0]['mean']
    if quantity == 'dihedral':
        first = (first + period / 2) % period - period / 2
    blocking = monet_analysis.block_average(first)
    blocking['times'] = [size * dt for size in blocking['sizes']]
```

4. In the final `ok(…)` call, add `blocking=_finite(blocking),` and replace `**fit` with `**_finite(fit)`.

- [ ] **Step 4: Implement `action_equilibration`.** Add after `action_acf`:

```python
def action_equilibration(cmd):
    """Start of the production window of the selected quantity by maximum N_eff (Chodera 2016)."""
    if not _require_ase(): return
    step = cmd.get('frame_step', 1)
    dt = cmd['dt'] * step
    prog('Computing the quantity …', 0)
    frames, series, period = _acf_series(cmd)
    if cmd['quantity'] == 'dihedral':
        series = monet_analysis.unwrap_angles(series, period)
    method = cmd.get('tau_int_method', 'sokal')
    results = []
    for k, row in enumerate(series):
        prog(f'Scanning production origins of group {k + 1}/{len(series)} …', 10 + 80 * k / len(series))
        results.append(monet_analysis.detect_equilibration(row, method=method))
    # The latest origin over all groups: every group is equilibrated from there on.
    group = max(range(len(results)), key=lambda k: results[k]['t0'])
    chosen = results[group]
    t0 = chosen['t0']
    prog('Done', 100)
    ok(**_finite({'starts': chosen['starts'], 'times': [s * dt for s in chosen['starts']], 'g': chosen['g'],
                  'n_effective': chosen['n_effective'], 't0': t0, 't0_time': t0 * dt, 't0_frame': int(frames[t0]),
                  'group': group, 'per_group_t0': [r['t0'] for r in results], 'n_frames': len(frames),
                  'frame_step': step, 'dt': dt, 'g_t0': chosen['g_t0'], 'n_effective_t0': chosen['n_effective_t0'],
                  'n_effective_full': chosen['n_effective'][0]}))
```

Register it in `ACTIONS`: `"equilibration": action_equilibration,`.

- [ ] **Step 5: Validation and launcher.**
- In `validate_command`, change `if action in ('msd', 'vdos', 'acf'):` to `if action in ('msd', 'vdos', 'acf', 'equilibration'):`.
- Change `if action == 'acf':` (the quantity/groups block) to `if action in ('acf', 'equilibration'):`, and add at its end:

```python
        if cmd.get('tau_int_method', 'sokal') not in monet_analysis.TAU_INT_METHODS:
            raise ValueError('Unknown τ_int estimator: use sokal, geyer or zero.')
```

- In `start_monet.py`, add `'equilibration'` to `ACTIONS` and `'tau_int_method'` to `ALLOWED`.

- [ ] **Step 6: Run the tests and check that they pass.**
Run: `PYTHON=.venv/bin/python node tests/analysis.cjs && PYTHON=.venv/bin/python node tests/ase-integration.cjs`
Expected: both `PASS`. The existing check `near(r.tau_int, 40, 8, 'tau integral')` still passes with Sokal.

- [ ] **Step 7: Commit, after the user approves.**

```bash
git add ase_bridge.py start_monet.py tests/analysis.cjs
git commit -m "Bridge: tau_int estimator and error, blocking output, equilibration action

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The same Sokal estimator in the browser, and g of subsampled configurations (A5 numerics)

**Files:**
- Modify: `ase-model.js` (`integratedTime` ~l.128–141; the `api` export ~l.230)
- Test: `tests/regression.cjs`. The existing check in `tests/ase-ui.cjs` (AR(0.9): 7 < τ_int < 11) must still pass.

**Interfaces:**
- Produces:
  - `MonetASEModel.tauFromAcf(acf: number[], c = 5): number`: Sokal τ_int in lags, the same number as `integrated_time(acf, 1, 'sokal')`.
  - `MonetASEModel.subsampleInefficiency(acf: number[], lagStride: number): number`: g = 1 + 2 Σ_{j≥1} C(j·s), summed while C > 0, with s = round(lagStride) ≥ 1.

- [ ] **Step 1: Write the failing test.** In `tests/regression.cjs`, after `assert.deepEqual(hist.density, [1 / 3, 2 / 3]); checks++`:

```js
// Sokal τ_int (same value as monet_analysis.integrated_time) and g of configurations taken every s lags.
const expAcf = Array.from({ length: 2000 }, (_, k) => Math.exp(-k / 40))
assert.ok(Math.abs(model.tauFromAcf(expAcf) - 39.7292) < 1e-3); checks++
assert.ok(Math.abs(model.subsampleInefficiency(expAcf, 40) - (1 + 2 / (Math.E - 1))) < 1e-3); checks++
assert.equal(model.subsampleInefficiency([1, 0, 0.5], 1), 1); assert.equal(model.subsampleInefficiency(expAcf, 39.6), model.subsampleInefficiency(expAcf, 40)); checks++
```

1 + 2/(e − 1) = 2.164 is the stride-τ row of the table in workflow document §4.3.

- [ ] **Step 2: Run it and check that it fails.**
Run: `node tests/regression.cjs`
Expected: FAIL with `model.tauFromAcf is not a function`.

- [ ] **Step 3: Implement.** In `ase-model.js`, replace the comment and body of `integratedTime` with:

```js
  // Integrated autocorrelation time (in lags) of a normalised ACF with Sokal's self-consistent window:
  // the smallest M with M >= c·τ(M), τ(M) = 1/2 + Σ_{k=1}^{M} C(k), c = 5 (Madras & Sokal 1988),
  // the same estimator as monet_analysis.integrated_time(method='sokal').
  function tauFromAcf (acf, c = 5) {
    let running = 0.5
    for (let m = 1; m < acf.length; m++) {
      running += acf[m]
      if (m >= c * running) return running
    }
    return acf.length > 1 ? running : NaN
  }

  // τ_int (in samples) of the deviations; lags up to half the series, as in the ACF panel.
  function integratedTime (deviations) {
    const n = deviations.length
    if (n < 4) return NaN
    const sums = autocorrelationSums(deviations)
    if (!(sums[0] > 0)) return NaN
    const acf = sums.map((v, m) => (v / (n - m)) / (sums[0] / n))
    return tauFromAcf(acf.slice(0, Math.floor(n / 2) + 1))
  }

  // Statistical inefficiency of configurations taken every `lagStride` lags: g = 1 + 2 Σ_{j≥1} C(j·s),
  // summed while C > 0. g ≈ 1 means the sampled configurations are uncorrelated (workflow document §4.3).
  function subsampleInefficiency (acf, lagStride) {
    const s = Math.max(1, Math.round(lagStride))
    let g = 1
    for (let j = s; j < acf.length; j += s) {
      if (!(acf[j] > 0)) break
      g += 2 * acf[j]
    }
    return g
  }
```

Add `tauFromAcf, subsampleInefficiency` to the `api` object.

- [ ] **Step 4: Run the tests and check that they pass.**
Run: `node tests/regression.cjs && PYTHON=.venv/bin/python node tests/ase-ui.cjs`
Expected: both `PASS`. The ase-ui correlated-SEM check still gives 7 < τ_int < 11.

- [ ] **Step 5: Commit, after the user approves.**

```bash
git add ase-model.js tests/regression.cjs
git commit -m "Use the Sokal window for plot-note SEMs; add g of subsampled configurations

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: ACF panel: estimator choice, τ_int ± error, run length in τ, g of the sampled configurations (A1, A2, A5, A6 UI)

**Files:**
- Modify: `index.html`: ACF inputs after the `acf-fit` select (~l.1035–1039); `acf-result` (~l.1049).
- Modify: `renderer.js`: `acfTau`/`showAcfResult` (~l.2156–2250); the `btn-run-acf` handler (~l.2316–2347).
- Test: `tests/ase-ui.cjs`: the mock line for `acf` (~l.97) and a new block.

**Interfaces:**
- Consumes: bridge `acf` keys (Task 4), `MonetASEModel.subsampleInefficiency` (Task 5).
- Produces: `acfCommand(): object`, the full `acf` command built from the panel (Task 8 reuses it). Throws `Error` with a user message on bad input.

- [ ] **Step 1: Update the mock and write the failing test.** In `tests/ase-ui.cjs`, replace the whole `if (command.action === 'acf') return { … }` line with:

```js
    if (command.action === 'acf') return { ok: true, lags: [0, 10, 20, 30], acf: [1, .6, .3, .1], fit_curve: [1, .5, .25, .12], tau_fit: 43.6, tau_fit_error: 2.2, tau_int: 40, tau_int_error: 5, tau_int_window: 3, tau_int_converged: true, tau_int_method: command.tau_int_method, fit_end: 30, fit_points: 4, decorrelated: false, dt: command.dt * (command.frame_step || 1), frame_step: command.frame_step || 1, n_frames: 4, n_effective: 2, mode: command.mode, statistics: [{ mean: 90, std: 10, sem: 7 }], distribution: { x: [45, 135], density: [0.004, 0.007] }, frame_indices: [0, 1, 2, 3], blocking: { sizes: [1, 2], times: [command.dt, 2 * command.dt], sem: [0.5, 0.7], sem_error: [0.01, 0.05], plateau_index: null, plateau_sem: null, g: null } }
```

Insert immediately before `el('acf-quantity').value = 'bond'; el('acf-quantity').dispatchEvent(new w.Event('change'))`:

```js
  // τ_int estimator and error, run length in units of τ, residual correlation g of the sampled configurations.
  el('acf-tau-manual').value = ''; el('acf-tau-manual').dispatchEvent(new w.Event('input'))
  assert.equal(latestCommand.tau_int_method, 'sokal'); assert.match(el('acf-tau-text').textContent, /τ_int \(Sokal window, 3 lags\) = 40 ± 5 fs/); checks++
  assert.match(el('acf-length-text').textContent, /T = 9\.68 fs = 0\.222 τ/); assert.match(el('acf-length-text').textContent, /fewer than 20 τ/); checks++
  el('md-stride').value = '1'; el('md-stride').dispatchEvent(new w.Event('input'))
  el('acf-plateau-time').value = '0.5'; el('acf-plateau-time').dispatchEvent(new w.Event('input'))
  assert.match(el('acf-stride-text').textContent, /every 2 saved frames/); assert.match(el('acf-stride-text').textContent, /g ≈ 1\.6, N_eff ≈ 62\.5/); checks++
  el('acf-tauint').value = 'geyer'; await click('btn-run-acf')
  assert.equal(latestCommand.tau_int_method, 'geyer'); assert.match(el('acf-tau-text').textContent, /Geyer sequence/); checks++
  el('acf-tauint').value = 'sokal'
```

The numbers come from the test state at that point:
- `md-stride` is 5, so Δt = 5 × 0.483777 fs = 2.4189 fs, and T = 4 × 2.4189 fs = 9.676 fs, which is 0.222 of τ = 43.6 fs.
- After `md-stride` is set to 1, t* = 0.5 fs gives a stride of 2 frames, so g = 1 + 2·C(2) = 1.6.
- 100 of 200 frames are kept, so N_eff = 100/1.6 = 62.5.

- [ ] **Step 2: Run it and check that it fails.**
Run: `PYTHON=.venv/bin/python node tests/ase-ui.cjs`
Expected: FAIL at `latestCommand.tau_int_method` (`undefined`).

- [ ] **Step 3: HTML.** In `index.html`, after the `</select>` that closes `acf-fit` and before `btn-run-acf`, add:

```html
          <label class="field-label" for="acf-tauint">τ_int estimator</label>
          <select class="field-input field-input-sm acf-select" id="acf-tauint">
            <option value="sokal">Sokal window (M ≥ 5 τ_int)</option>
            <option value="geyer">Geyer initial monotone sequence</option>
            <option value="zero">integral to the first zero crossing (MONET ≤ 2.1)</option>
          </select>
```

After `<div id="acf-tau-text"></div>` add `<p class="panel-desc" id="acf-length-text"></p>`.

- [ ] **Step 4: Renderer.** In `renderer.js`:

(a) Extract the command builder from the `btn-run-acf` handler, placing it just above the handler:

```js
// The autocorrelation command built from the panel (also used by equilibration detection).
function acfCommand () {
  const quantity = $('acf-quantity').value
  const axis = requireTime()
  const groups = quantity === 'rmsd'
    ? [MonetASEModel.selectedIndices($('acf-groups').value, aseState.analysisAtoms) || aseState.analysisAtoms.map(atom => atom.aseIndex)]
    : MonetASEModel.groupsFromIds($('acf-groups').value, ACF_WIDTH[quantity], aseState.analysisAtoms)
  const maxLag = $('acf-maxlag').value.trim()
  return {
    action: 'acf', filename: extractedTrajPath(), quantity, groups, dt: axis.dt, frame_step: Number($('acf-step').value),
    mode: $('acf-mode').value, fit_until: $('acf-fit').value, fit_model: $('acf-fit-model').value, tau_int_method: $('acf-tauint').value,
    ...(quantity === 'dihedral' ? { angle_range: $('acf-range').value } : {}),
    ...(maxLag ? { max_lag: Number(maxLag) } : {})
  }
}
```

In the handler, replace the `let groups, axis` … `runAse('acf', {…})` section with:

```js
  let command
  try { command = acfCommand() } catch (error) { return acfError(error.message) }
  const { quantity, groups } = command
  const r = await runAse('acf', command)
```

Keep the rest of the handler as it is.

(b) Above `acfTau`, add `const TAU_INT_LABELS = { sokal: 'Sokal window', geyer: 'Geyer sequence', zero: 'integral to first zero' }`.

(c) In `showAcfResult`, replace the array entry that starts with `` `τ (integral to first zero) = `` with:

```js
    `τ_int (${TAU_INT_LABELS[r.tau_int_method] || 'integral'}${Number.isFinite(r.tau_int_window) ? `, ${r.tau_int_window} lags` : ''}) = ${fmt(r.tau_int, 4)} ± ${fmt(r.tau_int_error, 2)} fs` +
      (r.tau_int_converged === false ? ' (window not reached: extend the lag range or the run)' : ''),
```

(d) In `showAcfResult`, right after `const d = acfDecorrelation()`, add:

```js
  // Run length in units of τ: below ~20 τ neither τ nor the error bars are reliable (workflow document §4.2).
  const runLength = r.n_frames * r.dt
  const ratio = runLength / (d?.tau ?? r.tau_fit)
  $('acf-length-text').textContent = Number.isFinite(ratio)
    ? `Run length T = ${fmt(runLength, 3)} fs = ${fmt(ratio, 3)} τ.` + (ratio < 20
      ? ' ⚠ fewer than 20 τ: τ and the error bars are unreliable; extend the run or add replicas.'
      : ratio < 50 ? ' Fewer than 50 τ: treat τ and the stride as approximate.' : '')
    : ''
```

(e) In `showAcfResult`, in the `d.stride ?` branch of `acf-stride-text`, append this to the template string (before the `:` of the ternary):

```js
      + ` · residual correlation of the sampled configurations g ≈ ${fmt(gSub, 3)}, N_eff ≈ ${fmt(d.kept / gSub, 3)}`
```

Define `gSub` just before the `$('acf-plateau-text')` assignments:

```js
  // g of configurations taken every `stride` saved frames (the ACF lags are frame_step saved frames apart).
  const gSub = d?.stride ? MonetASEModel.subsampleInefficiency(r.acf, d.stride / (r.frame_step || 1)) : NaN
```

- [ ] **Step 5: Run the tests and check that they pass.**
Run: `PYTHON=.venv/bin/python node tests/ase-ui.cjs`
Expected: `PASS`. The existing ACF checks (`90.12 MD steps`, `every 270 saved frames`, `every 13 saved frames (65 MD steps`, and the plateau warning checks) still pass.

- [ ] **Step 6: Commit, after the user approves.**

```bash
git add index.html renderer.js tests/ase-ui.cjs
git commit -m "ACF panel: tau_int estimator and error, run length in tau, g of sampled configurations

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Block-averaging chart under the ACF (A3 UI)

**Files:**
- Modify: `index.html`: after `<div class="chart-placeholder" id="chart-acf-ph">…</div>` (~l.1085).
- Modify: `renderer.js`: the `charts` registry (~l.1381), `clearAnalysis` (~l.1536), `showAcfResult`.
- Test: `tests/ase-ui.cjs`

**Interfaces:**
- Consumes: `lastResults.acf.blocking`, `statistics[0].sem`, `n_effective`, `tau_int`, `dt`, `unit`.
- Produces: chart kind `acfblock`, with `clear-acfblock`, `download-acfblock` and `csv-acfblock` wired by the generic loop.

- [ ] **Step 1: Write the failing test.** Insert before `el('acf-quantity').value = 'bond'; …`, after the Task 6 block:

```js
  // Block averaging (Flyvbjerg–Petersen) under the ACF; cleared with it.
  assert.deepEqual([...w.testMonet.charts.acfblock.data.datasets[0].data], [0.5, 0.7]); assert.match(el('acfblock-text').textContent, /No plateau/); checks++
  await click('csv-acfblock')
  assert.equal(downloadName, 'MONET-acfblock.csv'); checks++
  await click('clear-acf')
  assert.equal(w.testMonet.charts.acfblock.data, null); assert.equal(el('acfblock-text').classList.contains('hidden'), true); checks++
```

- [ ] **Step 2: Run it and check that it fails.**
Run: `PYTHON=.venv/bin/python node tests/ase-ui.cjs`
Expected: FAIL. `charts.acfblock` is undefined.

- [ ] **Step 3: HTML.**

```html
        <div class="ase-plot-actions">
          <button class="btn btn-sm" id="clear-acfblock" disabled>Clear block analysis</button>
          <button class="btn btn-sm" id="download-acfblock" disabled>Download block-averaging PNG</button>
          <button class="btn btn-sm" id="csv-acfblock" disabled>Download block-averaging CSV</button>
        </div>
        <p class="panel-desc hidden" id="acfblock-text" aria-live="polite"></p>
        <canvas class="chart-canvas" id="chart-acfblock"></canvas>
        <div class="chart-placeholder" id="chart-acfblock-ph">Block averaging: standard error of the mean against block length (Flyvbjerg–Petersen)</div>
```

- [ ] **Step 4: Renderer.**
- In `charts`, after `acf: …`, add `acfblock: new MonetLineChart('chart-acfblock', 'chart-acfblock-ph'),`.
- In `clearAnalysis`, replace `if (kind === 'acf') $('acf-result').classList.add('hidden')` with:

```js
  if (kind === 'acf') { $('acf-result').classList.add('hidden'); clearAnalysis('acfblock', false) }
  if (kind === 'acfblock') $('acfblock-text').classList.add('hidden')
```

- Add after `drawAcfChart`:

```js
// Block averaging (Flyvbjerg & Petersen 1989): the SEM grows with the block length and levels off once
// blocks are longer than the correlation time; the plateau checks the ACF error bar independently.
function drawAcfBlockChart () {
  const r = lastResults.acf
  const b = r?.blocking
  if (!b?.sizes?.length) return clearAnalysis('acfblock', false)
  const plateau = Number.isInteger(b.plateau_index) ? b.times[b.plateau_index] : null
  const note = plateau === null
    ? 'No plateau: the standard error still grows at the longest blocks, so the run is too short for a reliable error bar.'
    : `Plateau from blocks of ${fmt(plateau, 4)} fs: SEM = ${fmt(b.plateau_sem, 3)} ${r.unit}, g = ${fmt(b.g, 3)} (ACF: g = ${fmt(2 * r.tau_int / r.dt, 3)}).`
  charts.acfblock.setData({
    title: 'Block averaging of the mean (Flyvbjerg–Petersen)', source: charts.acf.source,
    xLabel: 'Block length (fs)', yLabel: `Standard error of the mean (${r.unit})`,
    labels: b.times.map(t => String(Number(t.toPrecision(5)))),
    datasets: [
      { label: 'SEM of the block means', data: b.sem, colorIndex: 0 },
      { label: 'SEM + error', data: b.sem.map((v, i) => v + b.sem_error[i]), dash: true, colorIndex: 1 },
      { label: 'SEM − error', data: b.sem.map((v, i) => v - b.sem_error[i]), dash: true, colorIndex: 1 },
      { label: `SEM from the ACF (N_eff = ${fmt(r.n_effective, 3)})`, data: b.times.map(() => r.statistics[0].sem), dash: true, colorIndex: 2 }
    ],
    markers: plateau === null ? [] : [{ value: plateau, label: `plateau ${fmt(b.plateau_sem, 3)} ${r.unit}` }],
    notes: [note]
  })
  $('acfblock-text').textContent = note
  $('acfblock-text').classList.remove('hidden')
}
```

- Call `drawAcfBlockChart()` at the end of `showAcfResult`, after `drawAcfChart()`.

- [ ] **Step 5: Run the tests and check that they pass.**
Run: `PYTHON=.venv/bin/python node tests/ase-ui.cjs`
Expected: `PASS`.

- [ ] **Step 6: Commit, after the user approves.**

```bash
git add index.html renderer.js tests/ase-ui.cjs
git commit -m "ACF panel: block-averaging chart (Flyvbjerg-Petersen) with the ACF SEM for comparison

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Equilibration detection and cropping to the production window (B7, B8 UI)

**Files:**
- Modify: `index.html`: the ACF inputs row (button); a result box, progress row and chart block after the block-averaging chart.
- Modify: `renderer.js`: `charts`, `RUN_KINDS`, `clearAnalysis`, the quantity-change handler, new handlers.
- Test: `tests/ase-ui.cjs`

**Interfaces:**
- Consumes: `acfCommand()` (Task 6); bridge `equilibration` (Task 4); bridge `subsample` with `start`, which already exists; `activateTrajectory(path, { label })`, which already exists.
- Produces: chart kind `equil`, `lastResults.equil`.

- [ ] **Step 1: Mock and failing test.** In `tests/ase-ui.cjs`, add right after the `acf` mock line:

```js
    if (command.action === 'equilibration') { latestCommand = command; return { ok: true, starts: [0, 1, 2], times: [0, command.dt, 2 * command.dt], g: [4, 2, 2], n_effective: [1, 1.5, 0.5], t0: 1, t0_time: command.dt, t0_frame: 1, group: 0, per_group_t0: [1], n_frames: 4, frame_step: 1, dt: command.dt, g_t0: 2, n_effective_t0: 1.5, n_effective_full: 1 } }
```

Insert before `el('acf-quantity').value = 'bond'; …`, after the Task 7 block:

```js
  // Equilibration: t₀ by maximum N_eff, then crop to the production window (a new active trajectory).
  await click('btn-run-equil')
  assert.equal(latestCommand.action, 'equilibration'); assert.equal(latestCommand.tau_int_method, 'sokal'); checks++
  assert.match(el('equil-text').textContent, /Production starts at t₀ = .* \(saved frame 1\)/); assert.equal(el('equil-crop').disabled, false); checks++
  assert.equal(w.testMonet.charts.equil.data.markers.length, 1); checks++
  const beforeCrop = w.testMonet.state.filePath
  await click('equil-crop'); await tick(); await tick()
  assert.equal(latestCommand.action, 'subsample'); assert.equal(latestCommand.stride, 1); assert.equal(latestCommand.start, 1); checks++
  assert.match(el('analysis-source').textContent, /production · from frame 1/); checks++
  await click('restore-full-trajectory'); await tick()
  assert.equal(w.testMonet.state.filePath, beforeCrop); checks++
```

- [ ] **Step 2: Run it and check that it fails.**
Run: `PYTHON=.venv/bin/python node tests/ase-ui.cjs`
Expected: FAIL. `btn-run-equil` does not exist.

- [ ] **Step 3: HTML.** After `<button class="btn btn-sm btn-accent" id="btn-run-acf">Compute ACF</button>`, add:

```html
          <button class="btn btn-sm" id="btn-run-equil" title="Chodera 2016: start of production where N_eff is largest">Detect equilibration</button>
```

After the block-averaging placeholder (Task 7), add:

```html
        <div class="info-box hidden" id="equil-result" aria-live="polite">
          <span id="equil-text"></span>
          <button class="btn btn-sm btn-accent" id="equil-crop" disabled>✂ Use the production window from t₀</button>
        </div>
        <div class="ase-prog-row hidden" id="equil-prog-row">
          <div class="progress-bar"><div class="progress-fill" id="equil-prog-fill"></div></div>
          <span id="equil-prog-label">—</span>
        </div>
        <div class="ase-plot-actions">
          <button class="btn btn-sm" id="clear-equil" disabled>Clear equilibration</button>
          <button class="btn btn-sm" id="download-equil" disabled>Download equilibration PNG</button>
          <button class="btn btn-sm" id="csv-equil" disabled>Download equilibration CSV</button>
        </div>
        <canvas class="chart-canvas" id="chart-equil"></canvas>
        <div class="chart-placeholder" id="chart-equil-ph">Effective sample size N_eff against the start of production t₀ (Chodera 2016)</div>
```

- [ ] **Step 4: Renderer.**
- `charts`: add `equil: new MonetLineChart('chart-equil', 'chart-equil-ph'),`.
- `RUN_KINDS`: add `'equil'`, so `btn-run-equil` is disabled while busy.
- `clearAnalysis`: add `if (kind === 'equil') $('equil-result').classList.add('hidden')`.
- In the `acf-quantity` change handler, after `clearAnalysis('acf', false)`, add `clearAnalysis('equil', false)`.
- Add after the `btn-run-acf` handler:

```js
// Equilibration (Chodera 2016): production starts at the t₀ that maximises N_eff = (N − t₀)/g(t₀).
function showEquilibration () {
  const r = lastResults.equil
  if (!r) return
  $('equil-text').textContent = r.t0 === 0
    ? `No transient found: N_eff is largest with the whole run (N_eff ≈ ${fmt(r.n_effective_t0, 4)} of ${r.n_frames} analysed frames). Keep the full trajectory.`
    : `Production starts at t₀ = ${fmt(r.t0_time, 5)} fs (saved frame ${r.t0_frame}): discarding the transient raises N_eff from ${fmt(r.n_effective_full, 4)} to ${fmt(r.n_effective_t0, 4)} (g = ${fmt(r.g_t0, 4)} analysed frames).`
  $('equil-crop').disabled = r.t0 === 0 || !aseState.available
  $('equil-result').classList.remove('hidden')
  charts.equil.setData({
    title: 'Equilibration: effective sample size against the start of production (Chodera 2016)', source: charts.acf.source,
    xLabel: 'Start of production t₀ (fs)', yLabel: 'N_eff = (N − t₀) / g(t₀)',
    labels: r.times.map(t => String(Number(t.toPrecision(6)))),
    datasets: [{ label: 'N_eff(t₀)', data: r.n_effective, colorIndex: 0 }],
    markers: [{ value: r.t0_time, label: `t₀ = ${fmt(r.t0_time, 4)} fs` }]
  })
}

$('btn-run-equil').addEventListener('click', async () => {
  acfError('')
  if (!extractedTrajPath()) return acfError('Load a trajectory first.')
  let command
  try { command = acfCommand() } catch (error) { return acfError(error.message) }
  const r = await runAse('equil', { ...command, action: 'equilibration' })
  if (!r.ok) return acfError(r.message || r.error)
  lastResults.equil = r
  showEquilibration()
  setStatus(r.t0 === 0 ? 'Equilibration: no transient found.' : `Equilibration: production starts at t₀ = ${fmt(r.t0_time, 4)} fs.`)
})

$('equil-crop').addEventListener('click', async () => {
  const r = lastResults.equil
  const filename = extractedTrajPath()
  if (!r || !filename || r.t0_frame < 1) return
  const stem = filename.split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
  const output = await window.monet.aseSelectOutput(`${stem}-production.extxyz`)
  if (!output) return
  const s = await runAse('subsample', { action: 'subsample', filename, stride: 1, start: r.t0_frame, output })
  if (!s.ok) return acfError(s.message || s.error)
  try {
    await activateTrajectory(s.filePath || output, { label: `production · from frame ${r.t0_frame} (t₀ = ${fmt(r.t0_time, 4)} fs)` })
    setStatus(`Production window active: ${s.n_frames} frames from saved frame ${r.t0_frame}. Compute the ACF again on it (↩ Full trajectory to go back).`)
  } catch (error) { acfError('The production window was written but could not be loaded: ' + error.message) }
})
```

- [ ] **Step 5: Run the tests and check that they pass.**
Run: `PYTHON=.venv/bin/python node tests/ase-ui.cjs`
Expected: `PASS`. The existing tests that follow (bond quantity clears the ACF, RMSD matrix, …) still pass.

- [ ] **Step 6: Commit, after the user approves.**

```bash
git add index.html renderer.js tests/ase-ui.cjs
git commit -m "Autocorrelation tab: detect equilibration and crop to the production window

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation, full verification and a real-trajectory check

**Files:**
- Modify: `README.md` (section *Autocorrelation and decorrelation stride*); `CHANGELOG.md` (new `## Unreleased` section on top); `docs/md-analysis-workflow.md` (§4 and §2 MONET notes, §15 table, §16 changelog).
- Regenerate: `docs/md-analysis-workflow.docx` with `docs/build/build-docx.sh`.

- [ ] **Step 1: README.** Add these bullets to the τ list in *Autocorrelation and decorrelation stride*:
  - **τ_int estimator:**
    - *Sokal window* (default): the smallest M with M ≥ 5 τ_int(M);
    - *Geyer* initial monotone sequence;
    - *first zero crossing* (MONET ≤ 2.1).

    MONET shows τ_int ± its error, τ_int·√(2(2M+1)/N), and the window M.
  - **Run length:** T in units of τ. There is a warning below 20 τ and a note below 50 τ.
  - **Residual correlation of the sampled configurations:** g = 1 + 2 Σ C(j·stride), and N_eff = kept/g.
  - **Block averaging** (Flyvbjerg–Petersen) under the ACF plot: SEM against block length, with its plateau and the ACF SEM for comparison.
  - **Detect equilibration** (Chodera 2016): N_eff(t₀) = (N − t₀)/g(t₀) for origins in the first half of the run. The largest value gives the start of production; ✂ *Use the production window* writes it as a new active trajectory, with `source_frame` kept and ↩ Full trajectory to go back.

- [ ] **Step 2: CHANGELOG.**

```markdown
## Unreleased

- Autocorrelation: Sokal (default) and Geyer estimators of τ_int with its error; run length in units of τ with warnings; residual correlation g and N_eff of the sampled configurations.
- Block averaging (Flyvbjerg–Petersen) chart under the ACF, with plateau detection.
- Detect equilibration (maximum N_eff, Chodera 2016) and crop to the production window.
- Plot-note SEMs use the same Sokal window as the ACF panel.
- Fix: markers, lag zoom and the player cursor now work on axes with values of 1,000 and above.
```

- [ ] **Step 3: Workflow document.**
- Change the MONET notes of §2 and §4.4 from **[gap]** to implemented, naming `integrated_time`, `block_average`, `detect_equilibration` and the UI elements.
- In §15, move A1–A3, A5, A6, B7 and B8 to *Implemented*.
- Add to §16: `0.2 (YYYY-MM-DD, the date of this commit): MONET implements Sokal/Geyer τ_int with error, block averaging, g of subsamples, T/τ, equilibration detection and cropping.`
- Then run `bash docs/build/build-docx.sh`.

- [ ] **Step 4: Full suite.**
Run: `for s in regression qm-parity formats analysis mdanalysis ase-integration ase-ui; do PYTHON=.venv/bin/python node tests/$s.cjs || break; done`
Expected: seven `PASS:` lines.

- [ ] **Step 5: Check on a real trajectory in the browser.** Use the user's file `/Users/tommasofrancese/Downloads/FULL_TRAJECTORY_EXTRACTED.xyz`, dihedral 228-227-289-225, time step 20 a.u. On 2026-09-18 the known values were τ ≈ 45.9 fs and t* ≈ 105.7 fs.
  1. Start the launcher with `preview_start`. The built-in browser cannot read local files, so use a same-origin proxy that rewrites Origin to the launcher.
  2. Load the file, set the time step, compute the ACF, and check four things:
     - τ_int (Sokal) ± error, of the same order as τ;
     - a block-averaging plateau, with g close to 2τ_int/Δt;
     - T/τ;
     - g of the stride.
  3. Run *Detect equilibration*. Crop only if t₀ > 0, then return with ↩ Full trajectory.
  4. Take screenshots for the user.

- [ ] **Step 6: Commit, after the user approves.**

```bash
git add README.md CHANGELOG.md docs/md-analysis-workflow.md docs/md-analysis-workflow.docx docs/build
git commit -m "Document tau_int estimators, block averaging and equilibration detection

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

Pushing and opening a PR to `master` are separate decisions for the user.

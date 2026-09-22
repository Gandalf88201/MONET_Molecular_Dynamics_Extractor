'use strict'
// Methods report (report.js): software, input checksums, steps, reporting checklist and gaps.
const assert = require('node:assert/strict')
const P = require('../provenance.js')
const R = require('../report.js')
let checks = 0
let tick = 0
const now = () => `2026-09-21T10:${String(tick++).padStart(2, '0')}:00.000Z`
const s = P.create({ monet_version: '2.1.0', python: '3.12.1', ase: '3.23.0', mdanalysis: '2.10.0' }, { now })
const S1 = s.addSource({ name: 'torsion.xyz', size: 1234, sha256: 'ab'.repeat(32), format: 'XYZ', frames: 100, atoms: 4 })
s.record({ kind: 'load', source: S1, params: { name: 'torsion.xyz' } })
s.record({ kind: 'time', source: S1, params: { timestep: 0.5, unit: 'fs', steps_per_frame: 2, dt: 1 } })
const acf = s.begin({ kind: 'analysis', action: 'acf', source: S1, call: 'acf(quantity="dihedral", groups=[[1, 2, 3, 4]], dt=1, tau_int_method="sokal")', params: { quantity: 'dihedral', tau_int_method: 'sokal', fit_model: 'exp', fit_until: 'zero', dt: 1, frame_step: 1 } })
s.finish(acf, { tau_fit: 47.9, tau_fit_error: 2.2, tau_int: 44.6, tau_int_error: 13.2, tau_int_method: 'sokal', n_effective: 30, n_frames: 100, blocking: { plateau_sem: 0.8, g: 150 } })
const sub = s.begin({ kind: 'derive', action: 'subsample', source: S1, call: 'subsample(start=0, stride=90)' })
s.finish(sub, { n_frames: 2, stride: 90, start: 0, source_frames: 100 })
const S2 = s.addSource({ name: 'torsion-uncorrelated.extxyz', frames: 2, atoms: 4, parent: { source: S1, step: sub } })
s.addOutput(sub, { source: S2 })
const rmsd = s.begin({ kind: 'analysis', action: 'rmsd', source: S2, call: 'rmsd(frame_step=1, align=True)' })
s.finish(rmsd, { rmsd: [0, 0.2], reference_index: 0 })
s.annotate(rmsd, { note: 'uncorrelated set', final: true })
const rdf = s.begin({ kind: 'analysis', action: 'rdf', source: S1, call: 'rdf(nbins=100)' })
s.finish(rdf, { n_frames: 100, rmax: 6, r: [1, 2], g: [0, 1] })
s.clear(rdf)
const msd = s.begin({ kind: 'analysis', action: 'msd', source: S1, call: 'msd(dt=1)' })
s.fail(msd, 'Set the time axis first.')
const msdOk = s.begin({ kind: 'analysis', action: 'msd', source: S1, call: 'msd(dt=1)' })
s.finish(msdOk, { fits: { selection: { D_cm2_s: 1.5e-5 } }, fit_start: 10, fit_end: 50 })
const extract = s.begin({ kind: 'extract', action: 'extract', source: S1, params: { selected: [1, 2, 3], frequency: 10, qm: { summary: { gaussian: 'Gaussian: b3lyp/6-31+g(d,p) (unrestricted), single point, singlet and triplet', qe: 'QE pw.x: functional from the pseudopotentials, ecutwfc 50 Ry, Γ point, single point, isolated (MT, vacuum 10 Å), singlet and triplet' } } } })
s.finish(extract, { totalFrames: 200, sampledFrames: 20 })
s.pause(); s.resume()
const data = s.toJSON()
const text = R.methodsReport(data)
assert.ok(text.startsWith('# Methods: MONET analysis session\n')); checks++
assert.match(text, /> \*\*Warning:\*\* the history was paused 1 time in this session/); checks++
assert.match(text, /^- MONET 2\.1\.0 \(MONET, Zenodo concept DOI 10\.5281\/zenodo\.22816521\)$/m); checks++
assert.match(text, /^- ASE 3\.23\.0 \(A\. H\. Larsen et al\./m); assert.match(text, /^- MDAnalysis 2\.10\.0 \(N\. Michaud-Agrawal/m); assert.doesNotMatch(text, /NumPy/); checks++
assert.ok(text.includes(`| S1 | torsion.xyz | 1234 | ${'ab'.repeat(32)} | XYZ | 100 | 4 | loaded |`)); checks++
assert.ok(text.includes(`| S2 | torsion-uncorrelated.extxyz | n/a | not recorded | n/a | 2 | 4 | S1 → #${sub} subsample → S2 |`)); checks++
// Final steps come first; cleared and failed steps are not in the list but in the gaps.
const steps = text.split('## Analysis steps')[1].split('## Reporting checklist')[0]
assert.match(steps, new RegExp(`^1\\. \\*\\*#${rmsd} rmsd\\*\\* on S2 ☆ final: \`rmsd\\(frame_step=1, align=True\\)\`$`, 'm')); checks++
assert.match(steps, /^ {3}Results: reference frame = 0; mean RMSD \(Å\) = 0\.1; max RMSD \(Å\) = 0\.2\.$/m); assert.match(steps, /^ {3}Note: uncorrelated set$/m); checks++
assert.match(steps, /Results: τ \(fit, fs\) = 47\.9; τ error \(fs\) = 2\.2; τ_int \(fs\) = 44\.6; τ_int error \(fs\) = 13\.2; τ_int estimator = sokal; N_eff = 30; frames = 100; block-averaged SEM = 0\.8; g \(blocking\) = 150\./); checks++
assert.doesNotMatch(steps, /`rdf\(/); assert.doesNotMatch(steps, new RegExp(`\\*\\*#${msd} msd`)); checks++
assert.match(text, /^- \[ \] Engine, level of theory .*: not recorded$/m); checks++
assert.match(text, /^- \[x\] Time step, saving interval, total length, and the discarded equilibration with the criterion used: 1 fs between saved frames \(0\.5 fs × 2, #2\); torsion\.xyz: 100 frames$/m); checks++
assert.match(text, new RegExp(`^- \\[x\\] Observables used for the ACF.*: acf\\(.*\\) → quantity: dihedral, τ = 47\\.9 ± 2\\.2 fs \\(fit model exp, fit until zero\\), τ_int = 44\\.6 ± 13\\.2 fs \\(Sokal self-consistent window \\(c = 5\\)\\), T/τ = 2\\.24215 \\(#${acf}\\)$`, 'm')); checks++
const acfLine = text.match(/^- \[x\] Observables used for the ACF.*$/m)[0]
assert.match(acfLine, /Sokal self-consistent window \(c = 5\)/); assert.match(acfLine, /fit model exp/); assert.match(acfLine, /fit until zero/); assert.match(acfLine, /T\/τ = 2\.24215/); checks++
assert.match(text, new RegExp(`^- \\[x\\] MSD fitting window.*: fit 10–50 fs, D = 0\\.000015 cm²/s, unwrapped with minimum-image steps \\(MONET's MSD always unwraps\\), no finite-size correction \\(#${msdOk}\\)$`, 'm')); checks++
assert.match(text, new RegExp(`^- \\[x\\] Stride and the resulting number of configurations; g of the subsample: stride 90 from frame 0 → 2 configurations \\(#${sub}\\)$`, 'm')); checks++
assert.match(text, /^- \[x\] How every error bar was computed; replicas, if any: block averaging \(Flyvbjerg–Petersen\), SEM = 0\.8/m); checks++
assert.match(text, /Quantum-chemistry inputs for 20 configurations:\n- Gaussian: b3lyp\/6-31\+g\(d,p\) \(unrestricted\), single point, singlet and triplet\n- QE pw\.x: functional from the pseudopotentials, ecutwfc 50 Ry, Γ point, single point, isolated \(MT, vacuum 10 Å\), singlet and triplet\n/); checks++
const gaps = text.split('## Gaps')[1]
assert.match(gaps, new RegExp(`^- #${rdf} rdf was cleared\\.$`, 'm')); assert.match(gaps, new RegExp(`^- #${msd} msd failed: Set the time axis first\\.$`, 'm')); assert.match(gaps, /^- History paused .* → resumed .*\.$/m); checks++
// Same session, same text; final-only keeps the marked steps.
assert.equal(R.methodsReport(JSON.parse(JSON.stringify(data))), text); checks++
const finalOnly = R.methodsReport(data, { finalOnly: true })
const finalSteps = finalOnly.split('## Analysis steps (marked final)')[1].split('## Reporting checklist')[0]
assert.match(finalSteps, /rmsd\(/); assert.doesNotMatch(finalSteps, /acf\(|subsample/); checks++
// A session without pauses has no warning and "None." under gaps.
const clean = P.create({ monet_version: '2.1.0' }, { now })
clean.addSource({ name: 'a.xyz' })
assert.doesNotMatch(R.methodsReport(clean.toJSON()), /Warning/); assert.match(R.methodsReport(clean.toJSON()), /## Gaps\n\nNone\.\n/); checks++
assert.equal(R.resultText({ 'mean:0-1': 1.5, 'circmean:0-1-2-3': 10 }), 'mean of 0-1 = 1.5; circular mean of 0-1-2-3 = 10'); checks++
assert.equal(R.stepText({ kind: 'cell', action: 'apply', params: { cell: [12, 12, 12, 90, 90, 90], mic: true } }), 'cell apply (cell=[12, 12, 12, 90, 90, 90], mic=True)'); checks++
assert.equal(R.stepText({ kind: 'cell', action: 'apply', params: { 'a b': 1 } }), 'cell apply ((unreadable parameters))'); checks++
console.log(`PASS: ${checks} report checks (software, checksums, steps, checklist, gaps).`)

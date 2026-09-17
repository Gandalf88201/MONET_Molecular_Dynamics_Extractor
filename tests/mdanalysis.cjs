'use strict'
// MDAnalysis readers (XTC/TRR/DCD + topology), generic ASE formats and MDAnalysis analyses.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const python = process.env.PYTHON || 'python3'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monet-mda-'))
let checks = 0
const bridge = command => {
  const out = execFileSync(python, [path.join(root, 'ase_bridge.py')], { input: JSON.stringify(command), env: { ...process.env, MONET_CACHE_DIR: path.join(temp, 'cache') }, maxBuffer: 1 << 28 }).toString()
  return JSON.parse(out.trim().split('\n').pop())
}
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`)

const status = bridge({ action: 'check' })
if (!status.mdanalysis_version) {
  console.log('SKIP: MDAnalysis is not installed; MDAnalysis checks not run.')
  process.exit(0)
}

// Eight rigid waters (GROMACS naming) written as GRO + XTC/TRR/DCD, plus an ASE multi-model PDB.
execFileSync(python, ['-W', 'ignore', '-c', `
import sys, numpy as np
import MDAnalysis as mda
from ase import Atoms
from ase.io import write
out = sys.argv[1]
rng = np.random.default_rng(1)
n = 8
u = mda.Universe.empty(3 * n, n_residues=n, atom_resindex=np.repeat(np.arange(n), 3), trajectory=True)
u.add_TopologyAttr('names', ['OW', 'HW1', 'HW2'] * n)
u.add_TopologyAttr('resnames', ['SOL'] * n)
u.add_TopologyAttr('resids', list(range(1, n + 1)))
base = []
for i, j, k in np.ndindex(2, 2, 2):
    o = np.array([i, j, k]) * 2.9 + 2
    base += [o, o + [0.957, 0, 0], o + [-0.24, 0.927, 0]]
base = np.array(base)
u.dimensions = [12, 12, 12, 90, 90, 90]
u.atoms.positions = base
u.atoms.write(f'{out}/water.gro')
u.atoms.write(f'{out}/water.pdb')
frames = [base + [0.1 * f, 0, 0] for f in range(10)]
for ext in ('xtc', 'trr', 'dcd'):
    with mda.Writer(f'{out}/water.{ext}', n_atoms=len(u.atoms)) as w:
        for pos in frames:
            u.atoms.positions = pos
            u.dimensions = [12, 12, 12, 90, 90, 90]
            w.write(u.atoms)
write(f'{out}/models.pdb', [Atoms('OH2', positions=base[:3] + [0, 0, 0.1 * f], cell=[12, 12, 12], pbc=True) for f in range(3)], format='proteindatabank')
`, temp])

const importFile = (file, extra = {}) => {
  const output = path.join(temp, `${path.basename(file)}-${checks}.extxyz`)
  const result = bridge({ action: 'import', filename: file, output, source_name: path.basename(file), ...extra })
  result.output = output
  return result
}
const frame = (file, index) => bridge({ action: 'frame', filename: file, index }).atoms

// Without a topology, XTC/DCD are imported with element X (geometry and cell kept).
let r = importFile(path.join(temp, 'water.xtc'))
assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.frames, 10); assert.equal(r.natoms, 24); assert.match(r.warning, /element X/); assert.match(r.source_label, /atoms shown as X/); checks++
assert.match(fs.readFileSync(r.output, 'utf8').split('\n')[1], /^Lattice="12\.0000000000 .*Properties=species:S:1:pos:R:3 /); checks++
assert.equal(frame(r.output, 9)[0].element, 'X'); near(frame(r.output, 9)[0].x, 2.9, 0.011, 'XTC without topology'); checks++
const bare = r.output
r = bridge({ action: 'bonds', filename: bare, pairs: [[0, 1]] })
assert.equal(r.ok, true, JSON.stringify(r)); near(Object.values(r.series)[0][0], 0.957, 0.011, 'X bond (XTC precision)'); checks++
r = importFile(path.join(temp, 'water.dcd'))
assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.frames, 10); checks++
// With GRO the topology keeps names/residues and lattice.
r = importFile(path.join(temp, 'water.xtc'), { reference: path.join(temp, 'water.gro') })
assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.source_format, 'mda-xtc'); assert.equal(r.frames, 10); assert.equal(r.natoms, 24); checks++
const xtc = r.output
const header = fs.readFileSync(xtc, 'utf8').split('\n')
assert.match(header[1], /^Lattice="12\.0000000000 .*Properties=species:S:1:pos:R:3:resname:S:1:resid:I:1:atomname:S:1/); checks++
assert.match(header[2], /^O \S+ \S+ \S+ SOL 1 OW$/); checks++
near(frame(xtc, 9)[0].x, 2.9, 0.011, 'XTC precision'); assert.equal(frame(xtc, 9)[1].element, 'H'); checks++
assert.equal(bridge({ action: 'scan', filename: xtc }).configCount, 10); checks++
for (const [ext, format] of [['trr', 'mda-trr'], ['dcd', 'mda-dcd']]) {
  r = importFile(path.join(temp, `water.${ext}`), { reference: path.join(temp, 'water.gro') })
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.source_format, format); near(frame(r.output, 9)[0].x, 2.9, 1e-4, ext); checks++
}
r = importFile(path.join(temp, 'water.gro'))
assert.equal(r.ok, true); assert.equal(r.source_format, 'mda-gro'); assert.equal(r.frames, 1); checks++
r = importFile(path.join(temp, 'water.xtc'), { reference: path.join(temp, 'water.pdb') })
assert.equal(r.ok, true, JSON.stringify(r)); checks++

// Any ASE-readable format through ase:<name>; unknown names are rejected.
r = importFile(path.join(temp, 'models.pdb'), { format: 'ase:proteindatabank' })
assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.frames, 3); near(frame(r.output, 2)[0].z, 2.2, 1e-3, 'ase pdb'); checks++
r = importFile(path.join(temp, 'models.pdb'), { format: 'ase:not-a-format' })
assert.equal(r.ok, false); checks++
const formats = bridge({ action: 'formats' })
assert.ok(formats.ase.some(f => f.name === 'gromacs')); assert.ok(formats.mda_formats.some(f => f.key === 'mda-xtc' && f.topology)); checks++

// Selection language, RMSF, Rg and hydrogen bonds on the imported trajectory.
r = bridge({ action: 'mda_select', filename: xtc, selection: 'resname SOL and name OW' })
assert.deepEqual(r.indices, [0, 3, 6, 9, 12, 15, 18, 21]); assert.equal(r.n_residues, 8); checks++
r = bridge({ action: 'mda_select', filename: xtc, selection: 'resid 2:3' })
assert.deepEqual(r.indices, [3, 4, 5, 6, 7, 8]); checks++
r = bridge({ action: 'mda_select', filename: xtc, selection: 'resname ((' })
assert.equal(r.ok, false); assert.match(r.message, /Invalid MDAnalysis selection/); checks++
r = bridge({ action: 'mda_select', filename: path.join(root, 'examples/water.XYZ'), selection: 'resname H2O and element O' })
assert.deepEqual(r.indices, [0]); checks++
// Rigid translation: RMSF is zero after alignment, and equals the displacement spread without it.
r = bridge({ action: 'mda_rmsf', filename: xtc, selection: 'name OW', align: true })
assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(Math.max(...r.rmsf) < 0.02); checks++
r = bridge({ action: 'mda_rmsf', filename: xtc, selection: 'name OW', align: false })
near(r.rmsf[0], Math.sqrt(8.25) * 0.1, 0.02, 'unaligned RMSF'); checks++
r = bridge({ action: 'mda_rgyr', filename: xtc, selection: 'resid 1', frame_step: 3 })
assert.equal(r.rgyr.length, 4); assert.ok(r.rgyr.every(v => Math.abs(v - r.rgyr[0]) < 0.01)); checks++
r = bridge({ action: 'mda_hbonds', filename: xtc, d_a_cutoff: 3.2, angle: 120 })
assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.counts.length, 10); assert.ok(r.counts[0] > 0); assert.ok(r.pairs[0].donor >= 0); checks++
r = bridge({ action: 'mda_hbonds', filename: xtc, acceptors: 'element Xx' })
assert.equal(r.ok, false); assert.match(r.message, /acceptor selection is empty/); checks++
r = bridge({ action: 'mda_hbonds', filename: xtc, angle: 10 })
assert.equal(r.ok, false); checks++

// Generic MDAnalysis analyses (mda_run) with MONET IDs as MDAnalysis ids.
const ids = Array.from({ length: 24 }, (_, i) => i + 1)
const run = (analysis, params = {}, extra = {}) => bridge({ action: 'mda_run', filename: xtc, analysis, params, atom_ids: ids, ...extra })
r = run('rmsd', { selection: 'name OW', groups: ['resid 1'] })
assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.kind, 'series'); assert.equal(r.series.length, 2); assert.ok(Math.max(...r.series[0].data) < 0.02); checks++
// Pairwise RMSD matrix (MDAnalysis DistanceMatrix) equals MONET's Kabsch matrix on the same frames.
r = run('rmsd_matrix', { selection: 'all', superposition: true, max_frames: 5 })
assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.kind, 'matrix'); assert.equal(r.stride, 2); assert.deepEqual(r.labels, [0, 2, 4, 6, 8]); checks++
const kabsch = bridge({ action: 'rmsd_matrix', filename: xtc, frame_step: 2, align: true })
assert.ok(r.matrix.every((row, i) => row.every((v, j) => Math.abs(v - kabsch.matrix[i][j]) < 2e-3)), 'MDAnalysis vs Kabsch matrix'); checks++
r = run('rmsd_matrix', { selection: 'all', superposition: false })
assert.equal(r.matrix.length, 10); near(r.matrix[0][1], 0.1, 2e-3, 'rigid shift without superposition'); assert.match(r.notes.join(' '), /no superposition/); checks++
r = run('rmsd_matrix', { max_frames: 1 })
assert.equal(r.ok, false); checks++
r = run('rmsf', { selection: 'name OW', align: false })
assert.deepEqual(r.x, [1, 4, 7, 10, 13, 16, 19, 22]); assert.deepEqual(r.atoms, [0, 3, 6, 9, 12, 15, 18, 21]); near(r.series[0].data[0], Math.sqrt(8.25) * 0.1, 0.02, 'mda_run RMSF'); checks++
// Shifted MONET IDs (e.g. an extracted subset) are the MDAnalysis ids used by selections and labels.
r = bridge({ action: 'mda_run', filename: xtc, analysis: 'rmsf', params: { selection: 'id 101 104', align: false }, atom_ids: ids.map(i => i + 100) })
assert.deepEqual(r.x, [101, 104]); assert.deepEqual(r.atoms, [0, 3]); checks++
r = bridge({ action: 'mda_run', filename: xtc, analysis: 'rgyr', params: {}, atom_ids: ids.slice(1) })
assert.equal(r.ok, false); assert.match(r.message, /MONET atom IDs do not match/); checks++
r = bridge({ action: 'mda_run', filename: xtc, analysis: 'rgyr', params: {}, atom_ids: ids.map(() => 1) })
assert.equal(r.ok, false); checks++
r = run('interrdf', { group_a: 'name OW', group_b: 'name OW', rmax: 5, nbins: 50, exclude_same: 'atom' })
assert.equal(r.kind, 'profile'); assert.equal(r.x.length, 50); assert.ok(r.series[0].data.some(v => v > 0)); checks++
r = run('hbonds', { d_a_cutoff: 3.2, angle: 120 })
assert.equal(r.series[0].data.length, 10); assert.deepEqual(r.table.atom_columns, [0, 1, 2]); checks++
r = run('com_distance', { group_a: 'resid 1', group_b: 'resid 2' })
near(r.series[0].data[0], 2.9, 0.05, 'COM distance'); checks++
r = run('min_distance', { group_a: 'resid 1', group_b: 'resid 2' })
near(r.series[0].data[0], 2.9, 0.01, "minimum distance"); checks++
r = run('atomic_distances', { group_a: 'id 1', group_b: 'id 2' })
near(r.series[0].data[0], 0.957, 0.01, 'O–H distance'); assert.equal(r.series[0].label, '1–2'); checks++
r = run('atomic_distances', { group_a: 'id 1 4', group_b: 'id 2' })
assert.equal(r.ok, false); assert.match(r.message, /same number of atoms/); checks++
r = run('dihedral_mda', { quads: [[1, 0, 3, 4]] })
assert.equal(r.series[0].label, '2-1-4-5'); assert.ok(r.series[0].data.every(v => v >= -180 && v <= 180)); checks++
r = run('dihedral_mda', { quads: [[0, 1, 2, 99]] })
assert.equal(r.ok, false); checks++
r = run('msd', { selection: 'name OW' }, { dt: 2, frame_step: 2 })
assert.equal(r.xLabel, 'Lag time (fs)'); assert.equal(r.x[1], 4); near(r.series[0].data[1], 0.04, 0.005, 'MSD lag 1'); checks++
r = run('lineardensity', { selection: 'all', binsize: 1, axes: 'x' })
assert.equal(r.series.length, 1); assert.ok(r.series[0].data.some(v => v > 0)); checks++
r = run('pca', { selection: 'name OW' })
assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(r.series.length >= 1); assert.ok(r.table.rows.length >= 1); checks++
r = run('contacts', { group_a: 'name OW', group_b: 'name OW', radius: 3.5 })
assert.ok(r.series[0].data.every(v => v >= 0 && v <= 1)); checks++
r = run('gnm', { selection: 'name OW', cutoff: 7 })
assert.equal(r.series[0].data.length, 10); checks++
r = run('diffusionmap', { selection: 'name OW' })
assert.equal(r.kind, 'profile'); assert.equal(r.bars, true); checks++
r = run('dssp')
assert.equal(r.ok, false); assert.match(r.message, /DSSP needs a protein/); checks++
const dx = path.join(temp, 'density.dx')
r = run('density', { selection: 'name OW', delta: 1 }, { output: dx })
assert.equal(r.kind, 'table'); assert.match(fs.readFileSync(dx, 'utf8'), /object 1 class gridpositions/); checks++
r = run('nonsense')
assert.equal(r.ok, false); checks++
const aligned = path.join(temp, 'aligned.extxyz')
r = bridge({ action: 'mda_align', filename: xtc, params: { selection: 'name OW' }, atom_ids: ids, output: aligned })
assert.equal(r.n_frames, 10); checks++
const alignedFrames = fs.readFileSync(aligned, 'utf8').split('\n')
assert.match(alignedFrames[1], /source_frame=0 aligned_on="name OW"/); assert.equal(alignedFrames[26].trim(), '24'); checks++
r = bridge({ action: 'mda_rmsf', filename: aligned, selection: 'name OW', align: false })
assert.equal(r.ok, true, JSON.stringify(r))
assert.ok(Math.max(...r.rmsf) < 0.02); checks++

// Atom identity and ASE structure modules.
r = bridge({ action: 'topology', filename: xtc, atom_ids: ids })
assert.equal(r.n_atoms, 24); assert.equal(r.n_frames, 10); assert.deepEqual(r.mdanalysis.id, ids); checks++
assert.deepEqual(r.mdanalysis.element.slice(0, 3), r.symbols.slice(0, 3)); assert.equal(r.mdanalysis.resname[0], 'SOL'); assert.equal(r.mdanalysis.n_fragments, 8); checks++
assert.ok(r.positions.every((p, i) => p.every((v, j) => Math.abs(v - r.mdanalysis.positions[i][j]) < 2e-3))); checks++
r = bridge({ action: 'ase_structure', filename: xtc, frame: 0, bond_scale: 1.2 })
assert.equal(r.ok, true, JSON.stringify(r)); assert.ok(r.summary.some(([k, v]) => k === 'Formula (Hill)' && v === 'H16O8')); checks++
assert.deepEqual(r.bonds.rows[0].slice(0, 2), ['H–O', 16]); assert.equal(new Set(r.molecules).size, 8); checks++
assert.ok(r.summary.some(([k]) => /Density/.test(k))); checks++
r = bridge({ action: 'ase_structure', filename: xtc, frame: 99 })
assert.equal(r.ok, false); checks++
r = bridge({ action: 'ase_structure', filename: xtc, bond_scale: 5 })
assert.equal(r.ok, false); checks++
r = bridge({ action: 'ase_coordination', filename: xtc, indices: [0, 1], frame_step: 5 })
assert.deepEqual(r.frame_indices, [0, 5]); assert.deepEqual(r.series['O (mean of 1)'], [2, 2]); assert.deepEqual(r.series.H2, [1, 1]); checks++

fs.rmSync(temp, { recursive: true, force: true })
console.log(`PASS: ${checks} MDAnalysis checks (XTC/TRR/DCD + topology, ASE formats, selections, generic analyses, atom identity, ASE structure).`)

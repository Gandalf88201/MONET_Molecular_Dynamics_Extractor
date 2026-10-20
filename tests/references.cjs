'use strict'
// References (references.js): every built-in analysis has an entry, every key exists, the Chicago and
// BibTeX forms are well formed, the MONET version matches the release, and history steps map to references.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const R = require('../references.js')
const root = path.resolve(__dirname, '..')
let checks = 0

// Every built-in analysis of the registry is in ANALYSES and every ANALYSES id is a built-in analysis.
const listed = JSON.parse(execFileSync(process.env.PYTHON || 'python3', [path.join(root, 'ase_bridge.py')], { input: '{"action": "list_analyses"}', encoding: 'utf8' }).trim().split('\n').pop())
const builtIn = listed.analyses.filter(a => a.source === 'built-in').map(a => a.id).sort()
assert.deepEqual(Object.keys(R.ANALYSES).sort(), builtIn); checks++
// Built-in analyses keep their references here, not as free text in Python.
assert.deepEqual(listed.analyses.filter(a => a.source === 'built-in' && a.citation).map(a => a.id), []); checks++

// Every key used anywhere exists; every reference is used somewhere.
const used = new Set([...Object.values(R.ANALYSES).flat(), ...R.GROUPS.flatMap(g => [...g.always, ...g.topics.flatMap(t => t.keys)])])
for (const key of used) assert.ok(R.REFERENCES[key], `unknown reference ${key}`)
assert.deepEqual(Object.keys(R.REFERENCES).filter(key => !used.has(key)), []); checks++

// Fields: authors, year, title, and a well-formed DOI (all but the NetworkX proceedings have one).
for (const [key, ref] of Object.entries(R.REFERENCES)) {
  assert.ok(ref.authors.length && ref.authors.every(a => Array.isArray(a) && a[0]), key)
  assert.ok(Number.isInteger(ref.year) && ref.year > 1900 && ref.title, key)
  if (key !== 'hagberg2008') assert.match(ref.doi, /^10\.\d{4,9}\/\S+$/, key)
  if (!ref.type) assert.ok(ref.journal && ref.volume && ref.pages, key)
}
checks++

// Chicago author-date: first author inverted, “et al.” after seven of more than ten authors, italic journal.
assert.equal(R.chicago('flyvbjerg1989', { markdown: true }),
  'Flyvbjerg, H., and H. G. Petersen. 1989. “Error estimates on averages of correlated data.” *The Journal of Chemical Physics* 91 (1): 461–466. https://doi.org/10.1063/1.457480.')
assert.equal(R.chicago('michaud2011'),
  'Michaud-Agrawal, Naveen, Elizabeth J. Denning, Thomas B. Woolf, and Oliver Beckstein. 2011. “MDAnalysis: A toolkit for the analysis of molecular dynamics simulations.” Journal of Computational Chemistry 32 (10): 2319–2327. https://doi.org/10.1002/jcc.21787.')
assert.match(R.chicago('larsen2017'), /^Hjorth Larsen, Ask, Jens Jørgen Mortensen, .*, Jesper Friis, et al\. 2017\. “The atomic simulation environment—a Python library for working with atoms\.” Journal of Physics: Condensed Matter 29 \(27\): 273002\./)
assert.equal(R.chicago('theobald2005'),
  'Theobald, Douglas L. 2005. “Rapid calculation of RMSDs using a quaternion-based characteristic polynomial.” Acta Crystallographica Section A 61 (4): 478–480. https://doi.org/10.1107/S0108767305015266.')
assert.match(R.chicago('gowers2016'), /” In Proceedings of the 15th Python in Science Conference, edited by Sebastian Benthall and Scott Rostrup, 98–105\. Austin, TX: SciPy\. https:\/\/doi\.org\/10\.25080\/Majora-629e541a-00e\.$/)
assert.match(R.chicago('denning2012'), /^Denning, Elizabeth J\., and Alexander D\. MacKerell, Jr\. 2012\./)
assert.equal(R.chicago('monet', { version: '2.5.1' }), 'Francese, Tommaso. 2026. MONET: Molecular Dynamics Extractor. Version 2.5.1. Zenodo. https://doi.org/10.5281/zenodo.22816521.')
for (const key of Object.keys(R.REFERENCES)) assert.doesNotMatch(R.chicago(key), /\.\.|undefined|null| ,/, key)
checks++

// BibTeX: one entry per key, balanced braces, every author, "--" page ranges, the title protected.
const bib = R.bibFile(Object.keys(R.REFERENCES))
assert.equal((bib.match(/^@\w+\{/gm) || []).length, Object.keys(R.REFERENCES).length)
for (const key of Object.keys(R.REFERENCES)) {
  const entry = R.bibtex(key)
  assert.equal((entry.match(/\{/g) || []).length, (entry.match(/\}/g) || []).length, key)
  assert.match(entry, new RegExp(`^@(article|inproceedings|incollection|misc)\\{${key},\\n`), key)
  assert.equal((entry.match(/ and /g) || []).length >= R.REFERENCES[key].authors.length - 1, true, key)
  assert.doesNotMatch(entry, /undefined|pages = \{[^}]*–/, key)
}
assert.match(R.bibtex('michaud2011'), /author = \{Michaud-Agrawal, Naveen and Denning, Elizabeth J\. and Woolf, Thomas B\. and Beckstein, Oliver\}/)
assert.match(R.bibtex('michaud2011'), /title = \{\{MDAnalysis: A toolkit for the analysis of molecular dynamics simulations\}\},\n {2}journal = \{Journal of Computational Chemistry\},\n {2}volume = \{32\},\n {2}number = \{10\},\n {2}pages = \{2319--2327\}/)
assert.match(R.bibtex('denning2011'), /MacKerell, Jr\., Alexander D\.\}/)
assert.match(R.bibtex('virtanen2020'), / and \{SciPy 1\.0 Contributors\}\}/)
assert.match(R.bibtex('monet'), /^@misc\{monet,[\s\S]*note = \{Version \d+\.\d+\.\d+\}/)
assert.match(R.bibtex('sokal1997'), /editor = \{Cécile DeWitt-Morette and Pierre Cartier and Antoine Folacci\}/)
assert.equal(R.bibFile(['hess2002', 'hess2002', 'kabsch1983']).match(/^@/gm).length, 2); checks++

// The MONET entry names the version of this release.
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
assert.equal(R.REFERENCES.monet.version, version); checks++

// Analyses: library group plus method references; plugin citation text only for plugins.
assert.deepEqual(R.forAnalysis({ id: 'mdanalysis.dssp', engine: 'mdanalysis', source: 'built-in' }),
  { group: 'mdanalysis', title: 'MDAnalysis', always: ['michaud2011', 'gowers2016'], specific: ['kabsch1983'], citation: null })
assert.deepEqual(R.forAnalysis({ id: 'ase.xrd', engine: 'ase', source: 'built-in' }).specific, ['waasmaier1995'])
assert.equal(R.forAnalysis({ id: 'custom.x', engine: 'custom', source: 'plugins/x.py', citation: 'A. B., J. X. 1 (2020).' }).citation, 'A. B., J. X. 1 (2020).')
assert.equal(R.forAnalysis({ id: 'custom.x', engine: 'custom', source: 'plugins/x.py' }).group, 'monet'); checks++

// History steps → references (methods report).
assert.deepEqual(R.forStep({ action: 'mda_run', params: { analysis: 'helanal' } }), ['michaud2011', 'gowers2016', 'bansal2000', 'sugeta1967'])
assert.deepEqual(R.forStep({ action: 'mda_align', params: {} }), ['michaud2011', 'gowers2016', 'theobald2005', 'liu2010'])
assert.deepEqual(R.forStep({ action: 'run_analysis', params: { analysis: 'ase.dimensionality' } }), ['larsen2017', 'larsen2019'])
assert.deepEqual(R.forStep({ action: 'run_analysis', params: { analysis: 'custom.radius_of_gyration' } }), [])
assert.deepEqual(R.forStep({ action: 'acf', params: { tau_int_method: 'geyer' } }), ['francese2022', 'geyer1992', 'flyvbjerg1989'])
assert.deepEqual(R.forStep({ action: 'rmsd_matrix', params: {} }), ['kabsch1976'])
assert.deepEqual(R.forStep({ action: 'ase_structure', params: {} }), ['larsen2017', 'togo2024'])
assert.deepEqual(R.forStep({ action: 'mda_select', params: {} }), ['michaud2011', 'gowers2016'])
assert.deepEqual(R.forStep({ action: 'rdf', params: {} }), []); checks++

console.log(`PASS: ${checks} reference checks (${Object.keys(R.REFERENCES).length} references, ${builtIn.length} analyses, Chicago and BibTeX).`)

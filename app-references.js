'use strict'

// MONET page script, part 8 of 9: References dialog. "ⓘ References" in the title bar lists what to cite for
// MONET, ASE and MDAnalysis and for each analysis; "ⓘ Cite" next to an analysis shows only its references.
// The entries come from references.js, in Chicago (author-date) or BibTeX, with copy and .bib download.

const refsView = { spec: null, format: 'chicago', text: '', keys: [] }
try { if (localStorage.getItem('monet-refs-format') === 'bibtex') refsView.format = 'bibtex' } catch (error) { /* no storage */ }

// In-text Chicago citation: "Theobald 2005", "Flyvbjerg and Petersen 1989", "Liu, Agrafiotis, and Theobald 2010", "Harris et al. 2020".
function refsShortCite (key) {
  const ref = MonetReferences.REFERENCES[key]
  const families = ref.authors.map(author => author[0])
  const names = families.length > 3 ? `${families[0]} et al.`
    : families.length === 3 ? `${families[0]}, ${families[1]}, and ${families[2]}`
      : families.join(' and ')
  return `${names} ${ref.year}`
}

function refsEntry (key) {
  const item = document.createElement('li')
  item.className = 'refs-entry'
  for (const run of MonetReferences.chicagoRuns(MonetReferences.REFERENCES[key])) {
    const span = document.createElement(run.italic ? 'i' : 'span')
    span.textContent = run.text
    item.appendChild(span)
  }
  return item
}

// Entries of `keys` as a Chicago list or as a BibTeX block; returns the plain text for Copy.
function refsBlock (container, keys) {
  if (!keys.length) return ''
  if (refsView.format === 'bibtex') {
    const pre = document.createElement('pre')
    pre.className = 'refs-bib'
    pre.textContent = MonetReferences.bibFile(keys).trim()
    container.appendChild(pre)
    return pre.textContent
  }
  const list = document.createElement('ul')
  list.className = 'refs-list'
  for (const key of keys) list.appendChild(refsEntry(key))
  container.appendChild(list)
  return keys.map(key => MonetReferences.chicago(key)).join('\n\n')
}

function refsHeading (container, tag, text) {
  const heading = document.createElement(tag)
  heading.textContent = text
  container.appendChild(heading)
}

function refsNote (container, text) {
  const note = document.createElement('p')
  note.className = 'panel-desc'
  note.textContent = text
  container.appendChild(note)
}

// Registered analyses of an engine that have method references (labels from the Python registry
// when the launcher runs, otherwise the analysis ids).
function refsAnalysesOf (group) {
  const specs = new Map((aseState.analyses || []).map(spec => [spec.id, spec]))
  const rows = []
  for (const [id, keys] of Object.entries(MonetReferences.ANALYSES)) {
    if (!group.engines.includes(id.split('.')[0]) || !keys.length) continue
    rows.push({ label: specs.get(id)?.label || id, keys })
  }
  for (const spec of specs.values()) {
    if (group.engines.includes(spec.engine) && spec.source !== 'built-in' && spec.citation) rows.push({ label: `${spec.label} (plugin ${spec.source})`, text: spec.citation })
  }
  return rows
}

// Table "analysis → citation": in-text Chicago citations, or \cite{…} keys for LaTeX.
function refsTable (container, rows) {
  const table = document.createElement('table')
  table.className = 'atom-table refs-table'
  const head = table.createTHead().insertRow()
  for (const column of ['Analysis', refsView.format === 'bibtex' ? 'LaTeX' : 'Cite']) {
    const th = document.createElement('th')
    th.textContent = column
    head.appendChild(th)
  }
  const body = table.createTBody()
  const lines = []
  for (const row of rows) {
    const tr = body.insertRow()
    tr.insertCell().textContent = row.label
    const cite = row.text || (refsView.format === 'bibtex' ? `\\cite{${row.keys.join(',')}}` : row.keys.map(refsShortCite).join('; '))
    tr.insertCell().textContent = cite
    lines.push(`${row.label}: ${cite}`)
  }
  container.appendChild(table)
  return lines.join('\n')
}

function renderReferences () {
  const body = $('refs-body')
  body.replaceChildren()
  for (const button of document.querySelectorAll('.refs-format-btn')) button.setAttribute('aria-pressed', String(button.dataset.format === refsView.format))
  const texts = []
  let keys = []
  const spec = refsView.spec
  if (spec) {
    const refs = MonetReferences.forAnalysis(spec)
    $('refs-title').textContent = `References: ${spec.label}`
    $('refs-intro').textContent = `Cite ${refs.title} whenever you use it, and the method references of this analysis when you report its results.`
    refsHeading(body, 'h3', `${refs.title} (always)`)
    texts.push(refsBlock(body, refs.always))
    keys = [...refs.always]
    if (refs.specific.length) {
      refsHeading(body, 'h3', 'This analysis')
      texts.push(refsBlock(body, refs.specific))
      keys.push(...refs.specific)
    } else refsNote(body, 'No method reference beyond the library for this analysis.')
    if (refs.citation) {
      refsHeading(body, 'h3', 'Given by the plugin')
      refsNote(body, refs.citation)
      texts.push(refs.citation)
    }
    if (refsView.format === 'bibtex') texts.push(`\\cite{${keys.join(',')}}`)
  } else {
    $('refs-title').textContent = 'References'
    $('refs-intro').textContent = 'What to cite when you publish results obtained with MONET: MONET itself, then ASE and MDAnalysis when you use them, plus the method references of the analyses you report. The same list is in the methods report (History › Export).'
    for (const group of MonetReferences.GROUPS) {
      const section = document.createElement('section')
      section.className = 'refs-section'
      refsHeading(section, 'h3', group.title)
      refsNote(section, group.note)
      refsHeading(section, 'h4', 'Always cite')
      texts.push(`${group.title}\n\n${refsBlock(section, group.always)}`)
      keys.push(...group.always)
      const rows = [...group.topics, ...refsAnalysesOf(group)]
      if (rows.length) {
        refsHeading(section, 'h4', 'Add for particular analyses')
        texts.push(refsTable(section, rows))
        const methods = [...new Set(rows.flatMap(row => row.keys || []))].filter(key => !group.always.includes(key))
        if (methods.length) texts.push(refsBlock(section, methods))
        keys.push(...methods)
      }
      body.appendChild(section)
    }
  }
  refsView.keys = [...new Set(keys)]
  refsView.text = texts.filter(Boolean).join('\n\n')
}

function openReferences (spec = null) {
  refsView.spec = spec
  renderReferences()
  $('refs-overlay').classList.remove('hidden')
  $('refs-toggle').setAttribute('aria-pressed', String(!spec))
  $('refs-close').focus()
}

function closeReferences () {
  $('refs-overlay').classList.add('hidden')
  $('refs-toggle').setAttribute('aria-pressed', 'false')
}

$('refs-toggle').addEventListener('click', () => ($('refs-overlay').classList.contains('hidden') ? openReferences() : closeReferences()))
$('refs-close').addEventListener('click', closeReferences)
$('refs-overlay').addEventListener('click', event => { if (event.target === $('refs-overlay')) closeReferences() })
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('refs-overlay').classList.contains('hidden')) closeReferences() })
for (const button of document.querySelectorAll('.refs-format-btn')) {
  button.addEventListener('click', () => {
    refsView.format = button.dataset.format
    try { localStorage.setItem('monet-refs-format', refsView.format) } catch (error) { /* no storage */ }
    renderReferences()
  })
}
$('refs-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(refsView.text)
    setStatus(`References copied (${refsView.format === 'bibtex' ? 'BibTeX' : 'Chicago'}).`)
  } catch (error) { setStatus('The clipboard is not available: select the text and copy it.') }
})
$('refs-bib').addEventListener('click', () => {
  const blob = new Blob([MonetReferences.bibFile(refsView.keys)], { type: 'application/x-bibtex' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = refsView.spec ? `monet-${refsView.spec.id.replace(/[^A-Za-z0-9_.-]/g, '_')}.bib` : 'monet-references.bib'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
})

// "ⓘ Cite" beside the analysis menus: the MDAnalysis tab and every "More analyses" panel.
for (const kind of ['mda', ...Object.keys(REGISTRY_PANELS)]) {
  $(`${kind}-cite`)?.addEventListener('click', () => {
    const spec = registrySpec($(`${kind}-analysis`).value)
    if (!spec) return setStatus('Choose an analysis first.')
    openReferences(spec)
  })
}

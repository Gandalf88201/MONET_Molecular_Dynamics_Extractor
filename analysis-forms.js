'use strict'

// Forms of registered analyses (monet_registry.py): the fields come from the parameters each
// analysis declares, so a new analysis or plugin needs no change here.
// Also builds the "More analyses" sub-tab of an engine (ASE, MONET Custom Functionalities).
;(function (root) {
  const PICKABLE = new Set(['selection', 'atoms', 'groups'])

  // <select> options, one <optgroup> per category, in registration order.
  function fillSelect (select, analyses, fallbackCategory = 'Plugins') {
    const previous = select.value
    select.replaceChildren()
    const groups = new Map()
    for (const entry of analyses) {
      const category = entry.category || fallbackCategory
      if (!groups.has(category)) {
        const group = select.ownerDocument.createElement('optgroup')
        group.label = category
        groups.set(category, group)
        select.appendChild(group)
      }
      const option = new select.ownerDocument.defaultView.Option(entry.label + (entry.available ? '' : ' (not installed)'), entry.id)
      option.disabled = !entry.available
      groups.get(category).appendChild(option)
    }
    if (analyses.some(entry => entry.id === previous)) select.value = previous
  }

  // Description shown above the fields: the analysis text, where it comes from, and its reference.
  function describe (spec) {
    if (!spec) return ''
    const parts = [spec.description || spec.label]
    if (spec.source && spec.source !== 'built-in') parts.push(`Plugin: ${spec.source}.`)
    if (spec.citation) parts.push(`Cite: ${spec.citation}`)
    if (!spec.available) parts.push(`Needs ${spec.missing.join(', ')} (python -m pip install ${spec.missing.join(' ')}).`)
    return parts.join(' ')
  }

  // Fields of `spec` in `box`; each input has the id `${prefix}-p-${name}`.
  // picked(): the MONET IDs selected in the viewer (for "← picked").
  function build (box, spec, { prefix, picked, onMissingPick }) {
    const doc = box.ownerDocument
    box.replaceChildren()
    for (const param of spec?.params || []) {
      const wrap = doc.createElement('label')
      wrap.textContent = param.label
      if (param.help) wrap.title = param.help
      let input
      if (param.type === 'choice') {
        input = doc.createElement('select')
        for (const choice of param.choices) input.add(new doc.defaultView.Option(String(choice), String(choice)))
      } else if (param.type === 'lines') {
        input = doc.createElement('textarea')
        input.rows = 2
      } else {
        input = doc.createElement('input')
        input.type = param.type === 'bool' ? 'checkbox' : ['number', 'integer'].includes(param.type) ? 'number' : 'text'
        if (input.type === 'number') {
          input.step = param.type === 'integer' ? '1' : 'any'
          if (param.min !== undefined) input.min = String(param.min)
          if (param.max !== undefined) input.max = String(param.max)
        }
      }
      input.id = `${prefix}-p-${param.name}`
      input.dataset.param = param.name
      input.dataset.type = param.type
      if (param.width) input.dataset.width = String(param.width)
      for (const key of ['min', 'max']) if (param[key] !== undefined) input.dataset[key] = String(param[key])
      if (param.positive) input.dataset.positive = 'true'
      if (param.type === 'bool') {
        input.checked = Boolean(param.default)
        wrap.prepend(input)
      } else {
        input.className = 'field-input'
        const value = param.default
        input.value = Array.isArray(value) ? (param.type === 'lines' ? value.join('\n') : '') : value ?? ''
        if (param.type === 'atoms') input.placeholder = param.optional ? 'MONET IDs (blank = all atoms)' : 'MONET IDs, e.g. 1 2 5'
        if (param.type === 'groups') input.placeholder = `groups of ${param.width} MONET IDs, e.g. ${Array.from({ length: param.width }, (_, k) => k + 1).join(' ')}`
        if (PICKABLE.has(param.type)) {
          const row = doc.createElement('div')
          row.className = 'pick-row'
          const pick = doc.createElement('button')
          pick.type = 'button'
          pick.className = 'btn btn-sm'
          pick.textContent = '← picked'
          pick.title = 'Use the atoms selected in the viewer (MONET IDs)'
          pick.addEventListener('click', () => {
            const ids = picked()
            if (!ids.length) return onMissingPick?.()
            const text = ids.join(' ')
            if (param.type === 'selection') input.value = `id ${text}`
            else if (param.type === 'groups' && input.value.trim()) input.value = `${input.value.trim()}  ${text}`
            else input.value = text
          })
          row.append(input, pick)
          wrap.appendChild(row)
        } else wrap.appendChild(input)
      }
      if (['selection', 'lines', 'groups', 'atoms'].includes(param.type)) wrap.classList.add('mda-wide')
      box.appendChild(wrap)
    }
  }

  // Parameter values of the form. MONET IDs become indices of the analysed file through
  // indices(text) and groups(text, width); an empty number or atom list keeps the default.
  function read (box, { indices, groups }) {
    const params = {}
    for (const input of box.querySelectorAll('[data-param]')) {
      const { param, type } = input.dataset
      const label = input.closest('label')?.firstChild?.textContent || param
      const text = typeof input.value === 'string' ? input.value.trim() : ''
      if (type === 'bool') params[param] = input.checked
      else if (type === 'number' || type === 'integer') {
        if (!text) continue
        const value = Number(text)
        if (!Number.isFinite(value)) throw new Error(`Enter a number for “${label}”.`)
        if (input.dataset.positive && value <= 0) throw new Error(`Enter a positive number for “${label}”.`)
        if (input.dataset.min !== undefined && value < Number(input.dataset.min)) throw new Error(`“${label}” must be at least ${input.dataset.min}.`)
        if (input.dataset.max !== undefined && value > Number(input.dataset.max)) throw new Error(`“${label}” must be at most ${input.dataset.max}.`)
        params[param] = type === 'integer' ? Math.round(value) : value
      } else if (type === 'lines') params[param] = input.value.split('\n').map(line => line.trim()).filter(Boolean)
      else if (type === 'atoms') {
        if (text) params[param] = indices(text)
      } else if (type === 'groups') params[param] = text ? groups(text, Number(input.dataset.width)) : []
      else params[param] = text
    }
    return params
  }

  // "More analyses" sub-tab of an engine group: an analysis menu, its fields, a line chart,
  // a frame × frame map and a table, with the element ids the renderer expects for `kind`.
  function mountPanel (doc, { kind, group, title }) {
    const bar = doc.querySelector('#vtab-content-ase .ase-subtabbar')
    const tab = doc.createElement('button')
    tab.className = 'ase-stab registry-empty'
    tab.setAttribute('role', 'tab')
    tab.dataset.group = group
    tab.dataset.stab = kind
    tab.textContent = title
    tab.title = 'Analyses added as plugins (see docs/plugins.md)'
    const last = [...bar.querySelectorAll(`.ase-stab[data-group="${group}"]`)].pop()
    if (last) last.after(tab)
    else bar.appendChild(tab)
    const actions = name => `
        <button class="btn btn-sm" id="clear-${name}" disabled>Clear analysis</button>
        <button class="btn btn-sm" id="download-${name}" disabled>Download plot PNG</button>
        <button class="btn btn-sm" id="csv-${name}" disabled>Download data CSV</button>`
    const panel = doc.createElement('div')
    panel.className = 'ase-subpanel'
    panel.id = `ase-sub-${kind}`
    panel.innerHTML = `
      <p class="panel-desc" id="${kind}-availability">Analyses added as plugins appear here.</p>
      <div class="ase-ctrl-row">
        <label class="field-label" for="${kind}-analysis">Analysis</label>
        <select class="field-input acf-select" id="${kind}-analysis"></select>
        <label class="field-label" for="${kind}-step">Frame step</label>
        <input class="field-input field-input-sm" type="number" id="${kind}-step" value="1" min="1" />
        <button class="btn btn-sm btn-accent" id="btn-run-${kind}">Compute</button>
      </div>
      <p class="panel-desc" id="${kind}-description"></p>
      <div class="mda-fields" id="${kind}-fields"></div>
      <div class="ase-prog-row hidden" id="${kind}-prog-row">
        <div class="progress-bar"><div class="progress-fill" id="${kind}-prog-fill"></div></div>
        <span id="${kind}-prog-label">—</span>
      </div>
      <div class="ase-plot-actions">${actions(kind)}
        <a class="btn btn-sm hidden" id="${kind}-download" download>Download file</a>
        <button class="btn btn-sm hidden" id="${kind}-activate">Analyse this trajectory in MONET</button>
      </div>
      <canvas class="chart-canvas" id="chart-${kind}"></canvas>
      <div class="chart-placeholder" id="chart-${kind}-ph">Results of the chosen analysis</div>
      <div class="hidden" id="${kind}-matrix-block">
        <div class="ase-ctrl-row matrix-style">
          <label class="field-label" for="${kind}matrix-colormap">Colour map</label>
          <select class="field-input field-input-sm colormap-select" id="${kind}matrix-colormap">
            <option value="plasma" selected>plasma</option><option value="viridis">viridis</option><option value="inferno">inferno</option>
            <option value="magma">magma</option><option value="coolwarm">coolwarm</option><option value="theme">theme</option>
          </select>
          <label class="field-label" for="${kind}matrix-origin">Frame 0 at</label>
          <select class="field-input field-input-sm" id="${kind}matrix-origin"><option value="top" selected>top left</option><option value="bottom">bottom left</option></select>
          <label class="field-label" for="${kind}matrix-title">Title</label>
          <input class="field-input" id="${kind}matrix-title" type="text" placeholder="Plot title" />
        </div>
        <div class="ase-plot-actions">${actions(`${kind}matrix`)}</div>
        <canvas class="chart-canvas" id="chart-${kind}matrix"></canvas>
        <div class="chart-placeholder" id="chart-${kind}matrix-ph">Map</div>
      </div>
      <div class="result-tables" id="${kind}-table"></div>`
    const anchor = doc.querySelector('.ase-analysis-work')
    anchor.appendChild(panel)
    return panel
  }

  const api = { fillSelect, describe, build, read, mountPanel }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetAnalysisForms = api
})(globalThis)

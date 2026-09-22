// Step 4: one settings card per selected quantum-chemistry code (fields → qm-resolve.js settings).
;(function (root) {
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
  const NOTES = {
    qbox: { after: 'calc', text: 'Frequencies are not offered: Qbox has no built-in vibrational analysis.' },
    gaussian: { after: 'md', text: 'Gaussian ADMP runs NVE only.' }
  }
  const MD_FIELDS = [
    { key: 'temperature', label: 'Temperature (K)', min: 0, step: 10 },
    { key: 'timestep', label: 'Time step (fs)', min: 0, step: 0.1 },
    { key: 'steps', label: 'Steps', min: 1, step: 100 }
  ]
  const parseMults = text => String(text).trim().split(/[\s,]+/).filter(Boolean).map(Number)
  const parseGrid = text => String(text).trim().split(/\s+/).map(Number)

  function make (tag, props = {}, children = []) {
    const node = document.createElement(tag)
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue
      if (key === 'text') node.textContent = value
      else if (key === 'className') node.className = value
      else if (key in node && typeof value !== 'string') node[key] = value
      else node.setAttribute(key, value)
    }
    for (const child of children) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
    return node
  }
  const select = (id, options, value) => {
    const node = make('select', { className: 'field-input', id })
    for (const o of options) node.appendChild(make('option', { value: o.value, text: o.label }))
    node.value = value
    return node
  }
  const numberInput = (id, value, f) => {
    const node = make('input', { className: 'field-input', id, type: 'number', step: f.step != null ? String(f.step) : null, min: f.min != null ? String(f.min) : null, max: f.max != null ? String(f.max) : null })
    node.value = String(value)
    return node
  }
  const textInput = (id, value) => {
    const node = make('input', { className: 'field-input', id })
    node.value = value == null ? '' : String(value)
    return node
  }
  const labelled = (text, control) => make('label', { className: 'field-label' }, [text, control])
  const checkRow = (id, text, checked) => {
    const box = make('input', { type: 'checkbox', id })
    box.checked = Boolean(checked)
    return make('label', { className: 'toggle-row' }, [box, make('span', { className: 'toggle-label', text })])
  }

  function mount (container, options = {}) {
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {}
    const shared = typeof options.shared === 'function' ? options.shared : () => ({
      charge: document.getElementById('qm-charge')?.value ?? '0',
      mults: document.getElementById('qm-mults')?.value ?? '1'
    })
    const cards = {} // code → card object (kept while hidden)
    let elements = [] // unique element symbols of the selection
    let potcarAvailable = true

    function createCard (code) {
      const pw = R.PLANE_WAVE.includes(code)
      const s = R.settingsFor(code)
      const edits = {} // species: element → string (cp2k: { basis?, potential?, aux? }) typed by the user
      const id = key => `qm-${code}-${key}`
      const toggles = [] // { node, when }
      const el = make('details', { className: 'qm-card', id: `qm-card-${code}` })
      el.open = true
      el.appendChild(make('summary', { text: R.LABELS[code] }))
      // A custom template overrides the resolved one file-for-file, so some card fields (e.g. Calculation,
      // when the file name doesn't change with it) stop having any visible effect; shown next to the marker.
      const customNote = make('p', { className: 'panel-desc qm-note', id: id('custom-note'), text: 'Edited templates replace the card settings for those files.' })
      customNote.hidden = true
      el.appendChild(customNote)
      const cell = pw ? make('p', { className: 'qm-cell', id: id('cell') }) : null
      if (cell) el.appendChild(cell)

      // Override charge / multiplicities for this code only.
      const overrideRow = checkRow(id('override'), 'Override charge and multiplicities', false)
      const overrideBox = overrideRow.querySelector('input')
      const overrideCharge = make('input', { className: 'field-input', id: id('override-charge'), type: 'number', step: '1' })
      const overrideMults = make('input', { className: 'field-input', id: id('override-mults') })
      const overrideGrid = make('div', { className: 'qm-grid qm-override' }, [labelled('Charge', overrideCharge), labelled('Multiplicities', overrideMults)])
      overrideGrid.hidden = true
      function toggleOverride () {
        if (overrideBox.checked) {
          const now = shared()
          overrideCharge.value = String(now.charge)
          overrideMults.value = String(now.mults)
        }
        overrideGrid.hidden = !overrideBox.checked
      }
      el.append(overrideRow, overrideGrid)

      const grid = make('div', { className: 'qm-grid' })
      el.appendChild(grid)
      const readers = {} // key → () => value
      for (const f of FIELDS[code]) {
        let wrapper
        if (f.type === 'select') {
          const control = select(id(f.key), f.options, s[f.key])
          readers[f.key] = () => control.value
          wrapper = labelled(f.label, control)
        } else if (f.type === 'number') {
          const control = numberInput(id(f.key), s[f.key], f)
          readers[f.key] = () => Number(control.value)
          wrapper = labelled(f.label, control)
        } else if (f.type === 'text') {
          const control = textInput(id(f.key), s[f.key])
          readers[f.key] = () => control.value.trim()
          wrapper = labelled(f.label, control)
        } else if (f.type === 'grid') {
          const control = textInput(id(f.key), s.grid.join(' '))
          readers[f.key] = () => parseGrid(control.value)
          wrapper = labelled(f.label, control)
        } else if (f.type === 'check') {
          wrapper = checkRow(id(f.key), f.label, s[f.key])
          const control = wrapper.querySelector('input')
          readers[f.key] = () => control.checked
        } else if (f.type === 'md') {
          wrapper = make('div', { className: 'qm-grid qm-md' })
          const ensemble = select(id('md-ensemble'), [opt('nvt', 'NVT'), opt('nve', 'NVE')], f.nveOnly ? 'nve' : s.md.ensemble)
          ensemble.disabled = Boolean(f.nveOnly)
          wrapper.appendChild(labelled('Ensemble', ensemble))
          const inputs = {}
          for (const m of MD_FIELDS) {
            inputs[m.key] = numberInput(id(`md-${m.key}`), s.md[m.key], m)
            wrapper.appendChild(labelled(m.label, inputs[m.key]))
          }
          readers.md = () => ({ ensemble: f.nveOnly ? 'nve' : ensemble.value, temperature: Number(inputs.temperature.value), timestep: Number(inputs.timestep.value), steps: Number(inputs.steps.value) })
        }
        grid.appendChild(wrapper)
        if (f.when) toggles.push({ node: wrapper, when: f.when })
        const note = NOTES[code]
        if (note && note.after === f.key) {
          const p = make('p', { className: 'panel-desc qm-note', text: note.text })
          grid.appendChild(p)
          if (f.when) toggles.push({ node: p, when: f.when })
        }
      }

      // Species table (plane-wave codes).
      const table = pw ? make('table', { className: 'qm-species' }) : null
      if (table) el.appendChild(table)
      const cp2kParts = () => ['basis', 'potential', ...(R.isHybrid('cp2k', s.functional) ? ['aux'] : [])]
      function species () {
        if (!pw || !elements.length) return null
        const defaults = R.defaultSpecies(code, elements, s)
        const out = {}
        for (const sym of elements) {
          if (code === 'cp2k') {
            out[sym] = {}
            for (const part of cp2kParts()) out[sym][part] = edits[sym]?.[part] ?? defaults[sym][part]
          } else out[sym] = edits[sym] ?? defaults[sym]
        }
        return out
      }
      function buildTable () {
        if (!table) return
        const current = species() || {}
        const heads = code === 'cp2k' ? ['Element', 'Basis', 'Potential', ...(R.isHybrid('cp2k', s.functional) ? ['AUX_FIT'] : [])] : ['Element', 'File/Variant']
        const rows = [make('tr', {}, heads.map(text => make('th', { text })))]
        for (const sym of elements) {
          const cells = [make('td', { text: sym })]
          if (code === 'cp2k') {
            for (const part of cp2kParts()) {
              const input = textInput(id(`species-${sym}-${part}`), current[sym][part])
              input.dataset.species = sym
              input.dataset.part = part
              cells.push(make('td', {}, [input]))
            }
          } else {
            const input = textInput(id(`species-${sym}`), current[sym])
            input.dataset.species = sym
            cells.push(make('td', {}, [input]))
          }
          rows.push(make('tr', {}, cells))
        }
        table.replaceChildren(...rows)
        table.hidden = !elements.length
      }

      const preview = make('pre', { className: 'qm-preview', id: id('preview') })
      el.appendChild(make('details', {}, [make('summary', { text: 'Preview (configuration 1)' }), preview]))

      function sync () {
        for (const [key, read] of Object.entries(readers)) s[key] = read()
        const potcar = el.querySelector(`#${id('buildPotcar')}`)
        if (code === 'vasp' && potcar) potcar.disabled = !potcarAvailable
        for (const t of toggles) t.node.hidden = !t.when(s)
      }

      let lastCalc = s.calc
      let lastFunctional = s.functional
      function handle (event) {
        const target = event.target
        if (target === overrideBox && event.type === 'change') toggleOverride()
        if (target && target.dataset && target.dataset.species) {
          const sym = target.dataset.species
          if (code === 'cp2k') (edits[sym] ||= {})[target.dataset.part] = target.value.trim()
          else edits[sym] = target.value.trim()
        }
        sync()
        if (code === 'qe' && s.calc !== lastCalc && (s.calc === 'freq' || s.calc === 'optfreq')) {
          el.querySelector(`#${id('phx')}`).checked = true
          sync()
        }
        lastCalc = s.calc
        if (s.functional !== lastFunctional) { lastFunctional = s.functional; buildTable() }
        onChange()
      }
      // Capture phase: also sees events dispatched without bubbling.
      el.addEventListener('input', handle, true)
      el.addEventListener('change', handle, true)

      buildTable()
      return {
        el,
        sync,
        buildTable,
        read () {
          sync()
          const out = R.settingsFor(code, { ...s, md: { ...s.md }, grid: [...s.grid] })
          out.override = overrideBox.checked ? { charge: Number(overrideCharge.value), multiplicities: parseMults(overrideMults.value) } : null
          if (pw) out.species = species()
          return out
        },
        setCell (text, blocked) { if (cell) { cell.textContent = text; cell.classList.toggle('blocked', Boolean(blocked)) } },
        setPreview (text) { preview.textContent = text },
        setCustomNote (has) { customNote.hidden = !has }
      }
    }

    let shown = []
    const panel = {
      show (codes) {
        shown = codes.filter(code => FIELDS[code])
        for (const code of shown) if (!cards[code]) cards[code] = createCard(code)
        const wanted = shown.map(code => cards[code].el)
        const current = [...container.children]
        if (current.length !== wanted.length || current.some((node, i) => node !== wanted[i])) {
          for (const node of current) if (!wanted.includes(node)) node.remove()
          for (const node of wanted) container.appendChild(node)
        }
        for (const code of shown) cards[code].sync()
      },
      read () {
        return Object.fromEntries(shown.map(code => [code, cards[code].read()]))
      },
      setSymbols (symbols) {
        elements = [...new Set(symbols || [])]
        for (const card of Object.values(cards)) card.buildTable()
      },
      setCellStatus (code, text, blocked) { if (cards[code]) cards[code].setCell(text, blocked) },
      setPreview (code, text) { if (cards[code]) cards[code].setPreview(text) },
      setCustomNote (code, has) { if (cards[code]) cards[code].setCustomNote(has) },
      setPotcarAvailable (available) {
        potcarAvailable = Boolean(available)
        if (cards.vasp) cards.vasp.sync()
      }
    }
    return panel
  }

  root.MonetQMPanel = { mount, FIELDS }
})(globalThis)

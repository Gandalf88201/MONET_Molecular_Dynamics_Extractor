'use strict'

// Day/night theme. The choice is stored per viewer; otherwise the OS preference applies.
;(function (root) {
  const KEY = 'monet-theme'
  const doc = root.document
  const media = root.matchMedia ? root.matchMedia('(prefers-color-scheme: light)') : null

  function stored () {
    try { return root.localStorage.getItem(KEY) } catch { return null }
  }

  function current () { return doc.documentElement.dataset.theme === 'light' ? 'light' : 'dark' }

  function syncButton () {
    const button = doc.getElementById('theme-toggle')
    if (!button) return
    const light = current() === 'light'
    button.textContent = light ? '☾ Night' : '☀ Day'
    button.title = light ? 'Switch to night (dark) mode' : 'Switch to day (light) mode'
    button.setAttribute('aria-pressed', String(light))
  }

  function apply (theme, persist = false) {
    doc.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark'
    if (persist) try { root.localStorage.setItem(KEY, current()) } catch {}
    syncButton()
    root.dispatchEvent(new root.CustomEvent('monet-theme', { detail: current() }))
  }

  function toggle () { apply(current() === 'light' ? 'dark' : 'light', true) }

  // Canvas code reads the same tokens as the stylesheet; fallbacks keep headless rendering working.
  function color (name, fallback) {
    const value = root.getComputedStyle ? root.getComputedStyle(doc.documentElement).getPropertyValue(name).trim() : ''
    return value || fallback
  }

  apply(stored() || (media && media.matches ? 'light' : 'dark'))
  if (media && media.addEventListener) {
    media.addEventListener('change', event => { if (!stored()) apply(event.matches ? 'light' : 'dark') })
  }
  const wire = () => {
    doc.getElementById('theme-toggle')?.addEventListener('click', toggle)
    syncButton()
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', wire)
  else wire()

  root.MonetTheme = { current, apply, toggle, color }
})(globalThis)

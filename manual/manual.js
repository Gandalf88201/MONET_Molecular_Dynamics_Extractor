// The manual opens in the language you used last, else in the browser's language, unless the address names one (?lang=).
(function () {
  var KEY = 'monet-manual-lang'
  var body = document.body
  function stored () { try { return localStorage.getItem(KEY) } catch (e) { return null } }  // storage may be blocked
  function remember (lang) { try { localStorage.setItem(KEY, lang) } catch (e) { /* ignore */ } }
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('.m-lang a')
    if (link) remember(link.textContent.trim().toLowerCase())
  })
  if (body.dataset.explicit === '1') return
  var lang = stored() || ((navigator.language || 'en').toLowerCase().indexOf('it') === 0 ? 'it' : 'en')
  if ((lang === 'it' || lang === 'en') && lang !== body.dataset.lang) {
    location.replace('/manual?lang=' + lang + location.hash)
  }
})()

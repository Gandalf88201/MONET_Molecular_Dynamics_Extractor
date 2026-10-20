'use strict'
// The built-in user manual (monet_manual.py, manual/): reader, files, English/Italian parity and the pages served by the launcher.
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

const script = String.raw`
import re, sys, tempfile, threading, urllib.error, urllib.request
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import monet_manual as manual
import start_monet as sm

checks = 0

# --- the Markdown reader ------------------------------------------------------------------------------------------
body, toc = manual.render_body(
    '# Title\n\n## First part\n\nText with **bold**, *italic*, ` + "`code <b>`" + String.raw` and [a link](#first-part).\n\n'
    '- one\n  - nested\n- two\n\n1. step\n2. step\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n'
    '> **Warning:** careful\n\n` + "```" + String.raw`\nx = 1 < 2\n` + "```" + String.raw`\n\n### Sub\n')
assert '<h1 id="title">Title</h1>' in body and '<h2 id="first-part">' in body, body
assert toc == [(2, 'first-part', 'First part'), (3, 'sub', 'Sub')], toc
for fragment in ('<strong>bold</strong>', '<em>italic</em>', '<code>code &lt;b&gt;</code>', '<a href="#first-part">a link</a>',
                 '<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul>', '<ol><li>step</li><li>step</li></ol>',
                 '<th>a</th>', '<aside class="callout warning">', 'x = 1 &lt; 2'):
    assert fragment in body, fragment
checks += 1

# Nothing from the text becomes markup, and only pictures of the manual folder are shown.
body, _ = manual.render_body('Plain <script>alert(1)</script> and [bad](javascript:alert(1)) and ![x](http://evil/x.png)\n')
assert '<script>' not in body and 'href="javascript' not in body and '<img' not in body and '&lt;script&gt;' in body, body
body, _ = manual.render_body('![alt text](img/window.png "A long caption")\n')
assert '<figcaption>A long caption</figcaption>' in body and 'src="/manual/img/window.png"' in body, body
assert manual.inline(r'**Accept t\* now** and *Accept t\**') == '<strong>Accept t* now</strong> and <em>Accept t*</em>'
page = manual.render_page('# T\n\n## A\n\ntext\n')
assert 'MONET' in page and 'Dr. T. Francese' in page and 'href="#a"' in page and 'id="theme-toggle"' in page
checks += 1

# --- the manual files ---------------------------------------------------------------------------------------------
def prose(text):
    return re.sub(r'` + "`[^`\\n]*`" + String.raw`', '', text)

texts = {lang: (manual.MANUAL_DIR / name).read_text(encoding='utf-8') for lang, name in manual.FILES.items()}
pics = {lang: re.findall(r'!\[[^\]]*\]\(img/([\w.\-]+)', prose(text)) for lang, text in texts.items()}
for lang, names in pics.items():
    assert len(set(names)) > 30, (lang, len(names))
    assert len(names) == len(set(names)), f'{lang}: a picture is used twice'
    missing = sorted(n for n in names if manual.image_path(n) is None)
    assert not missing, (lang, missing)
    for path in (manual.MANUAL_DIR / 'img').glob('*.png'):
        assert path.name in names, f'{path.name} is not used in {manual.FILES[lang]}'
        w, h = manual.png_size(path)
        assert 200 < w < 4000 and 100 < h < 5000, (path.name, w, h)
assert pics['en'] == pics['it'], 'the two manuals must show the same pictures in the same order'
heads = {lang: [m.group(1) + ' ' + m.group(2).split(' ')[0] for m in re.finditer(r'^(#{1,4}) (.+)$', prose(text), re.M)] for lang, text in texts.items()}
numbered = lambda lst: [h for h in lst if re.fullmatch(r'#+ \d+(\.\d+)*\.?', h)]
assert numbered(heads['en']) == numbered(heads['it']) and len(heads['en']) == len(heads['it']), 'same sections in both languages'
assert texts['en'].count('\n|') == texts['it'].count('\n|'), 'same tables'
assert texts['en'].count('\n> **') == texts['it'].count('\n> **'), 'same boxes'
assert texts['en'].count('` + "```" + String.raw`') == texts['it'].count('` + "```" + String.raw`'), 'same code blocks'
for lang, text in texts.items():
    body, _ = manual.render_body(text)
    ids = set(re.findall(r'<h[1-4] id="([^"]+)"', body))
    assert all(t in ids for t in re.findall(r'href="#([^"]+)"', body)), lang
    assert body.count('<figure>') == len(pics[lang]), (lang, body.count('<figure>'))
    assert '\\*' not in re.sub(r'<code>.*?</code>|<pre>.*?</pre>', '', body, flags=re.S), f'{lang}: an escaped asterisk is shown'
assert manual.render_page(lang='it').count('<figure>') == manual.render_page().count('<figure>')
assert 'Indice' in manual.render_page(lang='it') and '<html lang="it">' in manual.render_page(lang='it')
assert [manual.pick_language(v) for v in ('it', 'IT-it', 'fr', None, '../../etc/passwd')] == ['it', 'it', 'en', 'en', 'en']
assert manual.image_path('../MANUAL.md') is None and manual.image_path('a/b.png') is None and manual.image_path('nope.png') is None
checks += 1

# --- the pages served by the launcher ------------------------------------------------------------------------------
with tempfile.TemporaryDirectory() as tmp:
    server = sm.Server(('127.0.0.1', 0), 1 << 20, tmp)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}'
    try:
        get = lambda p: urllib.request.urlopen(url + p)
        page = get('/manual').read().decode('utf-8')
        assert 'User manual' in page and 'data-explicit="0"' in page and '/manual/manual.css' in page
        it = get('/manual?lang=it').read().decode('utf-8')
        assert 'Manuale d’uso' in it and 'data-explicit="1"' in it and 'href="/manual?lang=en"' in it
        assert '<html lang="en">' in get('/manual?lang=%3Cscript%3E').read().decode('utf-8')
        img = get('/manual/img/window.png')
        assert img.headers['Content-Type'] == 'image/png' and img.read().startswith(b'\x89PNG')
        for bad in ('/manual/img/..%2FMANUAL.md', '/manual/img/nope.png', '/manual/img/', '/manual/MANUAL.md'):
            try:
                get(bad)
                raise AssertionError(bad + ' should be refused')
            except urllib.error.HTTPError as error:
                assert error.code == 404, (bad, error.code)
        for asset in ('/manual/manual.css', '/manual/manual.js', '/theme.js'):
            assert get(asset).status == 200, asset
        index = get('/').read().decode('utf-8')
        assert 'id="manual-link"' in index and 'href="/manual"' in index
        # The manual page itself never carries the session token.
        assert server.token not in page and server.token not in it
    finally:
        server.shutdown()
        server.server_close()
        server.session.close()
checks += 1
print(checks)
`
const checks = Number(execFileSync(process.env.PYTHON || 'python3', ['-c', script, root], { encoding: 'utf8' }).trim().split('\n').pop())
console.log(`PASS: ${checks} manual checks (Markdown reader, pictures, English/Italian parity, pages served by the launcher).`)

#!/usr/bin/env python3
"""Redraws the pictures of the user manual (manual/img/*.png) from the running program.

Run it after the interface or the analyses change, so that the manual shows what MONET really looks like:

    pip install playwright pillow     # development only; Chromium from `playwright install chromium`, or set CHROME
    python tools/make_manual_images.py                      # all pictures
    python tools/make_manual_images.py --only window,acf_result

It starts its own launcher (temporary sessions folder), opens it in headless Chromium with the English interface
in the day (light) theme and saves 2x screenshots. The data are two small synthetic trajectories written by
tools/manual_data.py (an ethanol molecule with a slowly rotating hydroxyl, and a box of 27 waters); nothing is
committed except the pictures. Add a picture with a function decorated @shot('name') and refer to img/name.png
in manual/MANUAL.md and manual/MANUAL.it.md.
"""
import argparse
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import manual_data  # noqa: E402

OUT = ROOT / 'manual' / 'img'
SHOTS = {}
VIEWPORT = {'width': 1500, 'height': 940}
TALL = {'width': 1500, 'height': 1250}
VERY_TALL = {'width': 1500, 'height': 2100}


def shot(name):
    def deco(fn):
        SHOTS[name] = fn
        return fn
    return deco


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


class Service:
    def __init__(self, tmp):
        self.port = free_port()
        env = dict(os.environ, HOME=str(tmp / 'home'), MONET_CACHE_DIR=str(tmp / 'cache'))
        (tmp / 'home').mkdir(exist_ok=True)
        self.proc = subprocess.Popen([sys.executable, str(ROOT / 'start_monet.py'), '--no-browser', '--port', str(self.port),
                                      '--sessions-dir', str(tmp / 'sessions')], cwd=ROOT, env=env,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.url = f'http://127.0.0.1:{self.port}/'
        for _ in range(150):
            try:
                urllib.request.urlopen(self.url, timeout=1).read()
                return
            except OSError:
                time.sleep(0.2)
        raise RuntimeError('the MONET launcher did not start')

    def stop(self):
        self.proc.terminate()
        try:
            self.proc.wait(5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def shrink(path):
    """256-colour PNG: a screenshot of the interface looks the same and the file is less than half the size (needs Pillow)."""
    try:
        from PIL import Image
    except ImportError:
        return
    with Image.open(path) as image:
        small = image.convert('RGB').quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    small.save(path, optimize=True)


class UI:
    def __init__(self, pg, url, data):
        self.pg, self.url, self.data = pg, url, data
        self.info = {}

    # -- navigation ---------------------------------------------------------------------------------
    def fresh(self, name=None, size=VIEWPORT, theme='light', ref=None, cell=None, go_analysis=True):
        pg = self.pg
        pg.set_viewport_size(size)
        pg.goto(self.url)
        pg.evaluate("t => { try { localStorage.setItem('monet-theme', t) } catch (e) {} }", theme)
        pg.reload()
        pg.wait_for_selector('#ase-badge-text:has-text("ASE 3")', timeout=60000)
        if name:
            self.load(name, go_analysis)

    def load(self, name, go_analysis=True):
        pg = self.pg
        with pg.expect_file_chooser() as fc:
            pg.click('#btn-browse')
        fc.value.set_files(str(self.data / name))
        pg.wait_for_selector('#next-1:not([disabled])')
        if go_analysis:
            pg.click('#next-1')
            pg.wait_for_selector('#ase-atom-body tr', timeout=120000)
            self.idle()

    def idle(self, extra=500):
        pg = self.pg
        pg.wait_for_function('document.querySelector("#ase-cancel").disabled', timeout=180000)
        pg.wait_for_timeout(extra)

    def tab(self, stab):
        self.pg.click(f'.ase-stab[data-stab="{stab}"]:visible, .ase-stab-link[data-stab="{stab}"]:visible')
        self.pg.wait_for_timeout(250)

    def vtab(self, group):
        self.pg.click(f'#vtab-{group}')
        self.pg.wait_for_timeout(250)

    def fill(self, selector, value):
        self.pg.fill(selector, str(value))

    def choose(self, selector, value):
        self.pg.select_option(selector, value)

    def run(self, button, extra=700):
        self.pg.click(button)
        self.pg.wait_for_timeout(300)
        self.idle(extra)

    def set_time_axis(self, dt=0.5, unit='fs', stride=20):
        self.fill('#md-timestep', dt)
        self.choose('#md-timestep-unit', unit)
        self.fill('#md-stride', stride)
        self.pg.dispatch_event('#md-stride', 'change')
        self.pg.wait_for_timeout(300)

    # -- pictures -----------------------------------------------------------------------------------
    def save(self, name, locator=None, clip=None, pad=0):
        path = OUT / f'{name}.png'
        pg = self.pg
        if locator is not None:
            box = pg.locator(locator).first.bounding_box()
            clip = {'x': box['x'] - pad, 'y': box['y'] - pad, 'width': box['width'] + 2 * pad, 'height': box['height'] + 2 * pad}
        if clip:
            clip = {k: max(0, v) for k, v in clip.items()}
            pg.screenshot(path=str(path), clip=clip)
        else:
            pg.screenshot(path=str(path))
        shrink(path)
        print('  wrote', path.relative_to(ROOT))

    def badges(self, items):
        """Number the areas of a screenshot: items = [(number, selector, 'tl'|'tr', dx, dy)] (the badge is centred on the corner + offset)."""
        self.pg.evaluate("""items => { for (const [n, sel, where, dx, dy] of items) {
            const el = document.querySelector(sel); if (!el) continue;
            const r = el.getBoundingClientRect();
            const b = document.createElement('div'); b.className = '__badge';
            b.textContent = n;
            const x = (where === 'tr' ? r.right : r.left) + dx, y = r.top + dy;
            b.style.cssText = `position:fixed;z-index:99999;left:${x - 11}px;top:${y - 11}px;width:22px;height:22px;border-radius:50%;
              background:#c8243f;color:#fff;font:700 12px/22px system-ui;text-align:center;box-shadow:0 1px 4px #0006;`;
            document.body.appendChild(b); } }""", items)

    def unbadge(self):
        self.pg.evaluate("document.querySelectorAll('.__badge').forEach(e => e.remove())")


# ------------------------------------------------------------------------------------------------ pictures
@shot('window')
def window(ui):
    ui.fresh('ethanol_md.xyz')
    ui.set_time_axis()
    ui.badges([(1, '.titlebar-sub', 'tr', 16, 0), (2, '#vtab-custom', 'tr', 18, 18), (3, '#ase-viewer-frame', 'tl', 18, 52),
               (4, '#player-play', 'tl', -26, 14), (5, '.ase-stab[data-stab="extase"]', 'tr', 12, 18), (6, '#md-dt-info', 'tr', 18, 12)])
    ui.save('window')
    ui.unbadge()


def trimmed(ui, name, container, until, pad=12, top=None):
    """A screenshot of `container` cut below the element `until`."""
    box = ui.pg.locator(container).first.bounding_box()
    end = ui.pg.locator(until).first.bounding_box()
    height = min(box['height'], end['y'] + end['height'] + pad - box['y'])
    ui.save(name, clip={'x': box['x'], 'y': box['y'], 'width': box['width'], 'height': height})


def work(ui, name, until=None, pad=0):
    """The analysis area (right column) of the ASE workspace, cut below the element `until` (blank space is not shown)."""
    box = ui.pg.locator('.ase-analysis-work').first.bounding_box()
    if until:
        end = ui.pg.locator(until).first.bounding_box()
        box['height'] = min(box['height'], end['y'] + end['height'] + 14 - box['y'])
    ui.save(name, clip={'x': box['x'] - pad, 'y': box['y'] - pad, 'width': box['width'] + 2 * pad, 'height': box['height'] + 2 * pad})


# 1 -- Start and file input
@shot('file_input')
def file_input(ui):
    ui.fresh()
    ui.load('ethanol_md.xyz', go_analysis=False)
    ui.save('file_input', '.sidebar')


@shot('import_formats')
def import_formats(ui):
    ui.fresh()
    ui.choose('#inp-format', 'mda-xtc')
    ui.pg.wait_for_timeout(300)
    ui.save('import_formats', '.sidebar')


# 2 -- Viewer, cell, time axis, player
@shot('cell_panel')
def cell_panel(ui):
    ui.fresh('ethanol_md.xyz')
    ui.pg.evaluate("document.querySelector('#cell-system').closest('details').open = true")
    ui.pg.wait_for_timeout(300)
    ui.save('cell_panel', clip={'x': 46, 'y': 72, 'width': 1454, 'height': 318})


@shot('viewer_tools')
def viewer_tools(ui):
    ui.fresh('water_box.xyz')
    ui.pg.click('#ase-fit-view')
    ui.pg.wait_for_timeout(500)
    ui.save('viewer_tools', '#ase-viewer-frame', pad=4)


@shot('player')
def player(ui):
    ui.fresh('water_box.xyz')
    ui.save('player', '#ase-player', pad=4)


@shot('selection_menu')
def selection_menu(ui):
    ui.fresh('water_box.xyz')
    ui.pg.click('#ase-fit-view')
    ui.pg.wait_for_timeout(400)
    ui.pg.click('#ase-atom-body tr:nth-child(1)')
    ui.pg.click('#ase-atom-body tr:nth-child(2)', button='right')
    ui.pg.wait_for_timeout(400)
    ui.save('selection_menu', clip={'x': 46, 'y': 120, 'width': 760, 'height': 820})


# 3 -- ASE geometry
@shot('structure_result')
def structure_result(ui):
    ui.fresh('water_box.xyz', TALL)
    ui.run('#btn-run-structure')
    work(ui, 'structure_result', '#structure-result')


@shot('bonds_result')
def bonds_result(ui):
    ui.fresh('ethanol_md.xyz', TALL)
    ui.set_time_axis()
    ui.tab('bonds')
    ui.fill('#bonds-pairs', '1 2  2 3  3 4')
    ui.run('#btn-run-bonds')
    work(ui, 'bonds_result')


@shot('angles_result')
def angles_result(ui):
    ui.fresh('ethanol_md.xyz', TALL)
    ui.tab('angles')
    ui.fill('#angles-triplets', '1 2 3  2 3 4')
    ui.run('#btn-run-angles')
    work(ui, 'angles_result')


@shot('dihedrals_result')
def dihedrals_result(ui):
    ui.fresh('ethanol_md.xyz', TALL)
    ui.tab('dihedrals')
    ui.fill('#dihedrals-quads', '1 2 3 4')
    ui.run('#btn-run-dihedrals')
    work(ui, 'dihedrals_result')


@shot('pdd_result')
def pdd_result(ui):
    ui.fresh('water_box.xyz', TALL)
    ui.tab('pdd')
    ui.fill('#pdd-elements', 'O O')
    ui.run('#btn-run-pdd')
    work(ui, 'pdd_result')


@shot('coordination_result')
def coordination_result(ui):
    ui.fresh('water_box.xyz', TALL)
    ui.tab('coordination')
    ui.run('#btn-run-coordination')
    work(ui, 'coordination_result')


@shot('convert_panel')
def convert_panel(ui):
    ui.fresh('water_box.xyz', TALL)
    ui.tab('convert')
    work(ui, 'convert_panel')


# 4 -- MONET Custom Functionalities
def custom(ui, name, stab, size=TALL, data='ethanol_md.xyz', timeaxis=True):
    ui.fresh(data, size)
    if timeaxis:
        ui.set_time_axis()
    ui.vtab('custom')
    ui.tab(stab)


@shot('acf_result')
def acf_result(ui):
    custom(ui, 'acf', 'acf', VERY_TALL)
    ui.fill('#acf-groups', '1 2 3 4')
    ui.run('#btn-run-acf', 1500)
    work(ui, 'acf_result', '#chart-acfblock')


@shot('equilibration_result')
def equilibration_result(ui):
    custom(ui, 'equil', 'acf', {'width': 1500, 'height': 3000})
    ui.fill('#acf-groups', '1 2 3 4')
    ui.run('#btn-run-acf', 1200)
    ui.run('#btn-run-equil', 1500)
    box = ui.pg.locator('#equil-result').first.bounding_box()
    end = ui.pg.locator('#chart-equil').first.bounding_box()
    ui.save('equilibration_result', clip={'x': box['x'], 'y': box['y'], 'width': box['width'], 'height': end['y'] + end['height'] + 8 - box['y']})


@shot('fluct_result')
def fluct_result(ui):
    custom(ui, 'fluct', 'fluct', VERY_TALL)
    ui.run('#btn-run-fluct', 1500)
    work(ui, 'fluct_result', '#fluct-table')


@shot('rmsd_result')
def rmsd_result(ui):
    custom(ui, 'rmsd', 'rmsd', TALL)
    ui.pg.check('#rmsd-align')
    ui.run('#btn-run-rmsd', 1000)
    work(ui, 'rmsd_result')


@shot('rmsdmatrix_result')
def rmsdmatrix_result(ui):
    custom(ui, 'rmsdmatrix', 'rmsdmatrix', TALL)
    ui.fill('#rmsdmatrix-step', 20)
    ui.run('#btn-run-rmsdmatrix', 1000)
    work(ui, 'rmsdmatrix_result')


@shot('rdf_result')
def rdf_result(ui):
    custom(ui, 'rdf', 'rdf', TALL, data='water_box.xyz', timeaxis=False)
    ui.fill('#rdf-elements', 'O O')
    ui.run('#btn-run-rdf', 1000)
    work(ui, 'rdf_result')


@shot('msd_result')
def msd_result(ui):
    custom(ui, 'msd', 'msd', TALL, data='water_box.xyz', timeaxis=False)
    ui.set_time_axis(dt=0.5, unit='fs', stride=100)
    ui.run('#btn-run-msd', 1000)
    work(ui, 'msd_result')


@shot('vdos_result')
def vdos_result(ui):
    custom(ui, 'vdos', 'vdos', TALL, data='ethanol_md.xyz', timeaxis=False)
    ui.set_time_axis(dt=0.5, unit='fs', stride=1)
    ui.run('#btn-run-vdos', 1000)
    work(ui, 'vdos_result')


# 5 -- MDAnalysis
@shot('mda_topology')
def mda_topology(ui):
    ui.fresh('water_box.xyz', {'width': 1500, 'height': 1000})
    ui.vtab('mda')
    ui.tab('topology')
    ui.pg.wait_for_timeout(1500)
    work(ui, 'mda_topology')


def mda_run(ui, name, analysis, data='ethanol_md.xyz', fields=None, until='#chart-mda', size=VERY_TALL, setup=None, extra=1500):
    ui.fresh(data, size)
    if setup:
        setup(ui)
    ui.vtab('mda')
    ui.tab('mda')
    ui.pg.wait_for_timeout(800)
    ui.choose('#mda-analysis', analysis)
    ui.pg.wait_for_timeout(500)
    for selector, value in (fields or {}).items():
        ui.fill(selector, value)
    ui.run('#btn-run-mda', extra)
    work(ui, name, until)


@shot('mda_form')
def mda_form(ui):
    ui.fresh('water_box.xyz', TALL)
    ui.vtab('mda')
    ui.tab('mda')
    ui.choose('#mda-analysis', 'mdanalysis.hbonds')
    ui.pg.wait_for_timeout(800)
    work(ui, 'mda_form', '#mda-description')


@shot('mda_rmsd')
def mda_rmsd(ui):
    mda_run(ui, 'mda_rmsd', 'mdanalysis.rmsd', size=TALL)


@shot('mda_rmsf')
def mda_rmsf(ui):
    mda_run(ui, 'mda_rmsf', 'mdanalysis.rmsf', size=TALL)


@shot('mda_pca')
def mda_pca(ui):
    mda_run(ui, 'mda_pca', 'mdanalysis.pca', size=VERY_TALL, until='#mda-pca-block')


@shot('mda_hbonds')
def mda_hbonds(ui):
    mda_run(ui, 'mda_hbonds', 'mdanalysis.hbonds', data='water_box.xyz', size=TALL, until='#mda-table')


# 6 -- More analyses and plugins
@shot('ase_more')
def ase_more(ui):
    ui.fresh('water_box.xyz', TALL)
    ui.tab('extase')
    ui.pg.wait_for_timeout(1000)
    ui.choose('#extase-analysis', 'ase.molecules')
    ui.pg.wait_for_timeout(500)
    ui.run('#btn-run-extase', 1200)
    work(ui, 'ase_more')


@shot('plugin_result')
def plugin_result(ui):
    ui.fresh('water_box.xyz', TALL)
    ui.vtab('custom')
    ui.tab('extcustom')
    ui.pg.wait_for_timeout(1000)
    ui.choose('#extcustom-analysis', 'custom.radius_of_gyration')
    ui.run('#btn-run-extcustom', 1200)
    work(ui, 'plugin_result')


# 7 -- Workflow: sampling, selection, options, results
@shot('view3d')
def view3d(ui):
    ui.fresh('ethanol_md.xyz')
    ui.pg.click('#rail-continue')
    ui.pg.click('#viewer-tools >> text=fit')
    ui.pg.wait_for_timeout(600)
    ui.save('view3d')


@shot('sampling')
def sampling(ui):
    ui.fresh('ethanol_md.xyz')
    ui.pg.click('#rail-continue')
    ui.fill('#inp-freq', 129)
    ui.pg.wait_for_timeout(500)
    ui.save('sampling', '.sidebar')


@shot('atom_selection')
def atom_selection(ui):
    ui.fresh('ethanol_md.xyz')
    ui.pg.click('#rail-continue')
    ui.pg.click('#next-2')
    ui.fill('#inp-atom-ids', '1 2 3 4')
    ui.pg.click('#btn-apply-ids')
    ui.pg.wait_for_timeout(600)
    ui.save('atom_selection')


@shot('options')
def options(ui):
    ui.fresh('ethanol_md.xyz', {'width': 1500, 'height': 1500})
    ui.pg.click('#rail-continue')
    ui.pg.click('#next-2')
    ui.fill('#inp-atom-ids', '1 2 3 4')
    ui.pg.click('#btn-apply-ids')
    ui.pg.click('#next-3')
    ui.pg.wait_for_timeout(800)
    trimmed(ui, 'options', '.sidebar', '#qm-status')


@shot('qm_codes')
def qm_codes(ui):
    ui.fresh('ethanol_md.xyz', {'width': 1500, 'height': 1900})
    ui.pg.click('#rail-continue')
    ui.pg.click('#next-2')
    ui.fill('#inp-atom-ids', '1 2 3 4')
    ui.pg.click('#btn-apply-ids')
    ui.pg.click('#next-3')
    ui.pg.check('[data-qm-code="orca"]')
    ui.pg.check('[data-qm-code="qe"]')
    ui.pg.wait_for_timeout(800)
    trimmed(ui, 'qm_codes', '.sidebar', '#qm-status')


@shot('processing')
def processing(ui):
    ui.fresh('ethanol_md.xyz', {'width': 1500, 'height': 1500})
    ui.pg.click('#rail-continue')
    ui.pg.click('#next-2')
    ui.fill('#inp-atom-ids', '1 2 3 4')
    ui.pg.click('#btn-apply-ids')
    ui.pg.click('#next-3')
    ui.pg.wait_for_timeout(500)
    ui.pg.click('#next-4')
    ui.pg.wait_for_selector('#download-results:not(.hidden)', timeout=120000)
    ui.pg.wait_for_timeout(500)
    trimmed(ui, 'processing', '.sidebar', '#download-results')


@shot('results')
def results(ui):
    ui.fresh('ethanol_md.xyz', {'width': 1500, 'height': 1500})
    ui.pg.click('#rail-continue')
    ui.pg.click('#next-2')
    ui.fill('#inp-atom-ids', '1 2 3 4')
    ui.pg.click('#btn-apply-ids')
    ui.pg.click('#next-3')
    ui.pg.click('#next-4')
    ui.pg.wait_for_selector('#download-results:not(.hidden)', timeout=120000)
    ui.pg.click('#next-5')
    ui.pg.wait_for_timeout(600)
    trimmed(ui, 'results', '.sidebar', '#result-tree')


# 8 -- History, console, references, theme
def some_history(ui):
    ui.fresh('ethanol_md.xyz', TALL)
    ui.set_time_axis()
    ui.tab('dihedrals')
    ui.fill('#dihedrals-quads', '1 2 3 4')
    ui.run('#btn-run-dihedrals')
    ui.vtab('custom')
    ui.tab('acf')
    ui.fill('#acf-groups', '1 2 3 4')
    ui.run('#btn-run-acf', 1200)


@shot('history_console')
def history_console(ui):
    some_history(ui)
    ui.pg.click('#history-toggle')
    ui.pg.wait_for_timeout(800)
    box = ui.pg.locator('#history-drawer').first.bounding_box()
    ui.save('history_console', clip={**box, 'height': 330})


@shot('history_log')
def history_log(ui):
    some_history(ui)
    ui.pg.click('#history-toggle')
    ui.pg.click('#history-tab-log')
    ui.pg.wait_for_timeout(800)
    ui.pg.click('#history-list > *:first-child')
    ui.pg.wait_for_timeout(500)
    box = ui.pg.locator('#history-drawer').first.bounding_box()
    ui.save('history_log', clip={**box, 'height': 360})


@shot('references')
def references(ui):
    ui.fresh('ethanol_md.xyz')
    ui.pg.click('#refs-toggle')
    ui.pg.wait_for_timeout(700)
    ui.save('references')


@shot('night')
def night(ui):
    ui.fresh('ethanol_md.xyz', theme='dark')
    ui.save('night')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', help='comma-separated picture names')
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright
    names = args.only.split(',') if args.only else list(SHOTS)
    unknown = [n for n in names if n not in SHOTS]
    if unknown:
        ap.error('unknown pictures: ' + ', '.join(unknown))
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        data = tmp / 'data'
        data.mkdir()
        manual_data.ethanol(data / 'ethanol_md.xyz')
        manual_data.water_box(data / 'water_box.xyz')
        service = Service(tmp)
        try:
            with sync_playwright() as p:
                chrome = os.environ.get('CHROME')
                browser = p.chromium.launch(executable_path=chrome, args=['--no-sandbox']) if chrome else p.chromium.launch(args=['--no-sandbox'])
                ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=2, accept_downloads=True, locale='en-US', bypass_csp=True)
                pg = ctx.new_page()
                pg.on('pageerror', lambda e: print('  page error:', str(e)[:200]))
                ui = UI(pg, service.url, data)
                failed = []
                for name in names:
                    print(name)
                    try:
                        SHOTS[name](ui)
                    except Exception as error:      # keep going: one broken picture should not stop the others
                        failed.append(name)
                        print('  FAILED:', str(error).splitlines()[0][:200])
                browser.close()
        finally:
            service.stop()
    if failed:
        sys.exit('failed: ' + ', '.join(failed))


if __name__ == '__main__':
    main()

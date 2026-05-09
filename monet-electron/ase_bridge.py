#!/usr/bin/env python3
"""
MONET ASE Bridge
Receives one JSON command on stdin, streams JSON progress lines,
then writes a final JSON result line to stdout.

Protocol
--------
  stdin  : one JSON object (the command)
  stdout : zero-or-more  {"type":"progress","message":"...","percent":0-100}
           followed by exactly one {"type":"result",...}
           or           {"type":"error","message":"..."}
"""
import sys, json, traceback

try:
    import numpy as np
    import ase
    import ase.io
    from ase.geometry.analysis import Analysis
    _ASE_OK = True
    _ASE_VERSION = ase.__version__
except ImportError as _e:
    _ASE_OK = False
    _ASE_VERSION = None
    _ASE_ERR = str(_e)


# ── helpers ──────────────────────────────────────────────────────────────────

def _emit(obj):
    print(json.dumps(obj), flush=True)

def prog(msg, pct=None):
    d = {"type": "progress", "message": msg}
    if pct is not None:
        d["percent"] = round(pct, 1)
    _emit(d)

def ok(**kwargs):
    _emit({"type": "result", "ok": True, **kwargs})

def err(msg):
    _emit({"type": "error", "ok": False, "message": msg})

def _require_ase():
    if not _ASE_OK:
        err(f"ASE not installed. Run:  pip install ase\n({_ASE_ERR})")
        return False
    return True

def _load_images(filename, frame_step=1, max_frames=None):
    """Generator: yield (frame_index, Atoms) respecting frame_step."""
    count = 0
    for i, atoms in enumerate(ase.io.iread(filename)):
        if i % frame_step != 0:
            continue
        yield i, atoms
        count += 1
        if max_frames and count >= max_frames:
            break


# ── actions ──────────────────────────────────────────────────────────────────

def action_check(_):
    if not _ASE_OK:
        return err(f"ASE not found. pip install ase  ({_ASE_ERR})")
    ok(ase_version=_ASE_VERSION, numpy_version=np.__version__)


def action_read_info(cmd):
    if not _require_ase(): return
    filename = cmd["filename"]
    prog("Reading structure …", 5)
    try:
        atoms = ase.io.read(filename, index=0)
        pos   = atoms.get_positions().tolist()
        syms  = list(atoms.get_chemical_symbols())
        prog("Done", 100)
        ok(
            formula   = atoms.get_chemical_formula(),
            n_atoms   = len(atoms),
            symbols   = syms,
            positions = pos,
            cell      = atoms.get_cell().tolist(),
            has_pbc   = any(atoms.get_pbc()),
        )
    except Exception:
        err(traceback.format_exc())


def action_rmsd(cmd):
    """RMSD of selected atoms vs frame-0, sampled every frame_step frames."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    indices    = cmd.get("indices")          # 0-indexed list; None = all
    frame_step = int(cmd.get("frame_step", 1))

    prog("Loading frames …", 0)
    try:
        images = []
        raw_idx = []
        for i, atoms in enumerate(ase.io.iread(filename)):
            if i % frame_step == 0:
                images.append(atoms)
                raw_idx.append(i)
            if i % 500 == 0 and i > 0:
                prog(f"Loaded {i} frames …")

        prog(f"{len(images)} frames loaded — computing RMSD …", 40)

        ref_pos = images[0].get_positions()
        if indices is not None:
            ref_pos = ref_pos[np.array(indices)]

        rmsds = []
        for img in images:
            pos = img.get_positions()
            if indices is not None:
                pos = pos[np.array(indices)]
            diff = pos - ref_pos
            rmsds.append(float(np.sqrt(np.mean(np.sum(diff ** 2, axis=1)))))

        prog("RMSD done", 100)
        ok(rmsd=rmsds, frame_indices=raw_idx)
    except Exception:
        err(traceback.format_exc())


def action_pdd(cmd):
    """Pair-distance distribution (histogram of all inter-atomic distances)."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    nbins      = int(cmd.get("nbins", 80))
    rmax       = cmd.get("rmax", None)
    frame_step = int(cmd.get("frame_step", 1))
    elements   = cmd.get("elements")        # e.g. ["C","N"] — filter by element pair

    prog("Computing pair-distance distribution …", 0)
    try:
        all_dists = []
        n_frames  = 0
        for fi, atoms in _load_images(filename, frame_step):
            pos  = atoms.get_positions()
            syms = atoms.get_chemical_symbols()
            for i in range(len(pos)):
                for j in range(i + 1, len(pos)):
                    if elements:
                        pair = {syms[i], syms[j]}
                        if not pair.issubset(set(elements)):
                            continue
                    d = float(np.linalg.norm(pos[i] - pos[j]))
                    all_dists.append(d)
            n_frames += 1
            if n_frames % 50 == 0:
                prog(f"Frame {fi} …", min(80, n_frames * 0.5))

        if not all_dists:
            return err("No distances found (check element filter).")

        _rmax = rmax if rmax else float(np.percentile(all_dists, 99))
        counts, edges = np.histogram(all_dists, bins=nbins, range=(0.5, _rmax))
        centres = ((edges[:-1] + edges[1:]) / 2).tolist()

        prog("Done", 100)
        ok(r=centres, counts=counts.tolist(), n_frames=n_frames, rmax=_rmax)
    except Exception:
        err(traceback.format_exc())


def action_bonds(cmd):
    """Bond-length time series for specified atom pairs (0-indexed)."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    pairs      = cmd["pairs"]               # [[i,j], ...]  0-indexed
    frame_step = int(cmd.get("frame_step", 1))

    prog("Computing bond lengths …", 0)
    try:
        series  = {f"{p[0]}-{p[1]}": [] for p in pairs}
        raw_idx = []
        n       = 0
        for fi, atoms in _load_images(filename, frame_step):
            for p in pairs:
                key = f"{p[0]}-{p[1]}"
                series[key].append(float(atoms.get_distance(p[0], p[1])))
            raw_idx.append(fi)
            n += 1
            if n % 100 == 0:
                prog(f"Frame {fi} …", min(90, n * 0.3))

        prog("Done", 100)
        ok(series=series, frame_indices=raw_idx)
    except Exception:
        err(traceback.format_exc())


def action_angles(cmd):
    """Bond-angle time series for specified atom triplets (0-indexed)."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    triplets   = cmd["triplets"]            # [[i,j,k], ...]
    frame_step = int(cmd.get("frame_step", 1))

    prog("Computing bond angles …", 0)
    try:
        series  = {f"{t[0]}-{t[1]}-{t[2]}": [] for t in triplets}
        raw_idx = []
        n       = 0
        for fi, atoms in _load_images(filename, frame_step):
            for t in triplets:
                key = f"{t[0]}-{t[1]}-{t[2]}"
                series[key].append(float(atoms.get_angle(t[0], t[1], t[2])))
            raw_idx.append(fi)
            n += 1
            if n % 100 == 0:
                prog(f"Frame {fi} …", min(90, n * 0.3))

        prog("Done", 100)
        ok(series=series, frame_indices=raw_idx)
    except Exception:
        err(traceback.format_exc())


def action_dihedrals(cmd):
    """Dihedral-angle time series for specified quadruplets (0-indexed)."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    quads      = cmd["quads"]              # [[i,j,k,l], ...]
    frame_step = int(cmd.get("frame_step", 1))

    prog("Computing dihedral angles …", 0)
    try:
        series  = {f"{q[0]}-{q[1]}-{q[2]}-{q[3]}": [] for q in quads}
        raw_idx = []
        n       = 0
        for fi, atoms in _load_images(filename, frame_step):
            for q in quads:
                key = f"{q[0]}-{q[1]}-{q[2]}-{q[3]}"
                series[key].append(float(atoms.get_dihedral(q[0], q[1], q[2], q[3])))
            raw_idx.append(fi)
            n += 1
            if n % 100 == 0:
                prog(f"Frame {fi} …", min(90, n * 0.3))

        prog("Done", 100)
        ok(series=series, frame_indices=raw_idx)
    except Exception:
        err(traceback.format_exc())


def action_convert(cmd):
    """Convert a trajectory file between any ASE-supported formats."""
    if not _require_ase(): return
    inp    = cmd["input"]
    out    = cmd["output"]
    fmt    = cmd.get("format")             # output format string; None = infer from ext

    prog(f"Reading {inp} …", 10)
    try:
        images = list(ase.io.iread(inp))
        prog(f"{len(images)} frames — writing {out} …", 60)
        ase.io.write(out, images, format=fmt)
        prog("Done", 100)
        ok(n_frames=len(images), output=out)
    except Exception:
        err(traceback.format_exc())


def action_average(cmd):
    """Compute average structure using ASE and write to XYZ."""
    if not _require_ase(): return
    filename   = cmd["filename"]
    output     = cmd.get("output", "GEO-AVERAGE-ASE.xyz")
    frame_step = int(cmd.get("frame_step", 1))

    prog("Loading frames …", 0)
    try:
        all_pos = []
        ref     = None
        n       = 0
        for fi, atoms in _load_images(filename, frame_step):
            if ref is None:
                ref = atoms.copy()
            all_pos.append(atoms.get_positions())
            n += 1
            if n % 200 == 0:
                prog(f"Frame {fi} …", min(80, n * 0.05))

        avg = ref.copy()
        avg.set_positions(np.mean(all_pos, axis=0))
        ase.io.write(output, avg)
        prog("Done", 100)
        ok(n_frames=n, output=output)
    except Exception:
        err(traceback.format_exc())


# ── dispatch ─────────────────────────────────────────────────────────────────

ACTIONS = {
    "check":     action_check,
    "read_info": action_read_info,
    "rmsd":      action_rmsd,
    "pdd":       action_pdd,
    "bonds":     action_bonds,
    "angles":    action_angles,
    "dihedrals": action_dihedrals,
    "convert":   action_convert,
    "average":   action_average,
}

def main():
    raw = sys.stdin.read().strip()
    if not raw:
        err("Empty command"); return
    try:
        cmd = json.loads(raw)
    except json.JSONDecodeError as e:
        err(f"JSON parse error: {e}"); return

    action = cmd.get("action")
    handler = ACTIONS.get(action)
    if not handler:
        err(f"Unknown action '{action}'. Available: {list(ACTIONS)}")
        return

    try:
        handler(cmd)
    except Exception:
        err(traceback.format_exc())

if __name__ == "__main__":
    main()

"""
Trajectory analyses for MONET (numpy/scipy; ASE supplies geometry helpers).

All lengths are in Å and times in fs. `dt` is always the time between two
*analysed* frames (file time step x frame step).
"""
import math

import numpy as np

C_CM_PER_S = 2.99792458e10
FS_TO_CM1 = 1e15 / C_CM_PER_S       # frequency in 1/fs -> wavenumber in cm^-1
A2_PER_FS_TO_CM2_PER_S = 0.1        # 1 Å^2/fs = 1e-16 cm^2 / 1e-15 s


# ── RMSD ─────────────────────────────────────────────────────────────────────

def kabsch_rmsd(frames, reference, align=True):
    """RMSD of each frame (F, n, 3) against reference (n, 3), optionally after optimal superposition."""
    frames = np.asarray(frames, dtype=float)
    reference = np.asarray(reference, dtype=float)
    if not align:
        return np.sqrt(np.mean(np.sum((frames - reference) ** 2, axis=2), axis=1))
    P = frames - frames.mean(axis=1, keepdims=True)
    Q = reference - reference.mean(axis=0)
    H = np.einsum('fni,nj->fij', P, Q)
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(np.einsum('fij,fjk->fik', U, Vt)))
    # Optimal RMSD from singular values (reflection-corrected): E = |P|^2 + |Q|^2 - 2 sum(S')
    S[:, -1] *= d
    e = np.sum(P ** 2, axis=(1, 2)) + np.sum(Q ** 2) - 2 * S.sum(axis=1)
    return np.sqrt(np.maximum(e, 0) / reference.shape[0])


def rmsd_matrix(frames, align=True, progress=None):
    """Symmetric pairwise RMSD matrix (F, F)."""
    frames = np.asarray(frames, dtype=float)
    count = len(frames)
    out = np.zeros((count, count))
    for i in range(count - 1):
        row = kabsch_rmsd(frames[i + 1:], frames[i], align)
        out[i, i + 1:] = row
        out[i + 1:, i] = row
        if progress and i % 50 == 0:
            progress(f'RMSD matrix row {i + 1:,}/{count:,}', 100 * (1 - ((count - i) / count) ** 2))
    return out


# ── periodic helpers ─────────────────────────────────────────────────────────

def minimum_image(vectors, cell, pbc):
    """Wrap displacement vectors (..., 3) into the minimum image of `cell` along periodic axes."""
    cell = np.asarray(cell, dtype=float)
    pbc = np.asarray(pbc, dtype=bool)
    if not pbc.any():
        return vectors
    fractional = np.linalg.solve(cell.T, np.reshape(vectors, (-1, 3)).T).T
    fractional[:, pbc] -= np.round(fractional[:, pbc])
    return (fractional @ cell).reshape(np.shape(vectors))


def unwrap(positions, cells, pbc):
    """Unwrap (F, n, 3) positions using minimum-image steps between consecutive frames.

    Returns the unwrapped positions and the largest fractional step seen (values
    close to 0.5 mean frames are too far apart for reliable unwrapping).
    """
    positions = np.asarray(positions, dtype=float)
    out = positions.copy()
    worst = 0.0
    for k in range(1, len(positions)):
        step = positions[k] - positions[k - 1]
        cell = cells[k]
        wrapped = minimum_image(step, cell, pbc)
        fractional = np.abs(np.linalg.solve(np.asarray(cell).T, wrapped.T).T)
        if pbc is not None and np.any(pbc):
            worst = max(worst, float(fractional[:, np.asarray(pbc, bool)].max(initial=0)))
        out[k] = out[k - 1] + wrapped
    return out, worst


# ── RDF ──────────────────────────────────────────────────────────────────────

def rdf(frames, cells, pbc, group_a, group_b, rmax, nbins, progress=None):
    """Normalised g(r) and running coordination number n(r) between two atom groups."""
    from ase.geometry import get_distances
    group_a = np.asarray(group_a)
    group_b = np.asarray(group_b)
    same = len(group_a) == len(group_b) and np.array_equal(np.sort(group_a), np.sort(group_b))
    edges = np.linspace(0.0, rmax, nbins + 1)
    shell = 4.0 / 3.0 * np.pi * (edges[1:] ** 3 - edges[:-1] ** 3)
    accumulated = np.zeros(nbins)
    density_b = 0.0
    for k, (positions, cell) in enumerate(zip(frames, cells)):
        volume = abs(np.linalg.det(cell))
        _, distances = get_distances(positions[group_a], positions[group_b], cell=cell, pbc=pbc)
        if same:
            distances = distances[np.triu_indices(len(group_a), 1)]
            pairs = len(group_a) * (len(group_a) - 1) / 2
            n_b = len(group_a) - 1
        else:
            distances = distances[distances > 1e-8]
            pairs = len(group_a) * len(group_b)
            n_b = len(group_b)
        counts, _ = np.histogram(distances, bins=edges)
        accumulated += counts * volume / pairs
        density_b += n_b / volume
        if progress and k % 100 == 0:
            progress(f'RDF frame {k + 1:,}/{len(frames):,}', 10 + 85 * k / len(frames))
    count = max(len(frames), 1)
    g = accumulated / count / shell
    density_b /= count
    # n(r) = 4 pi rho_B int g r^2 dr (for like pairs, per atom counts both partners)
    per_atom = g * shell * density_b
    return (edges[:-1] + edges[1:]) / 2, g, np.cumsum(per_atom)


def max_rdf_radius(cells):
    """Half of the smallest perpendicular cell width (valid minimum-image radius)."""
    radius = math.inf
    for cell in cells:
        cell = np.asarray(cell, dtype=float)
        volume = abs(np.linalg.det(cell))
        for i in range(3):
            j, k = (i + 1) % 3, (i + 2) % 3
            radius = min(radius, volume / np.linalg.norm(np.cross(cell[j], cell[k])) / 2)
    return radius


# ── MSD / diffusion ──────────────────────────────────────────────────────────

def _autocorrelation_sum(x):
    """sum_{t} x(t) x(t+m) for m = 0..N-1 along axis 0 (FFT, O(N log N))."""
    n = len(x)
    f = np.fft.rfft(x, n=2 * n, axis=0)
    power = f * np.conj(f)
    return np.fft.irfft(power, n=2 * n, axis=0)[:n].real


def msd(positions):
    """Time-origin averaged MSD(m) for m = 0..N-1 of (N, n, 3) unwrapped positions (FFT algorithm)."""
    x = np.asarray(positions, dtype=float)
    n = len(x)
    d = np.sum(x ** 2, axis=2)  # (N, atoms)
    d = np.concatenate([d, np.zeros((1, d.shape[1]))])
    q = 2 * d.sum(axis=0)
    s1 = np.zeros((n, x.shape[1]))
    for m in range(n):
        q = q - d[m - 1] - d[n - m]
        s1[m] = q / (n - m)
    s2 = sum(_autocorrelation_sum(x[:, :, k]) for k in range(3)) / (n - np.arange(n))[:, None]
    return (s1 - 2 * s2).mean(axis=1)


def diffusion(times, values, start, end, dimensions=3):
    """Least-squares slope of MSD in [start, end] (fs): D = slope / (2 d)."""
    mask = (times >= start) & (times <= end)
    if mask.sum() < 3:
        raise ValueError('The diffusion fit window contains fewer than three points.')
    slope, intercept = np.polyfit(times[mask], values[mask], 1)
    residual = values[mask] - (slope * times[mask] + intercept)
    ss = np.sum((values[mask] - values[mask].mean()) ** 2)
    r2 = 1 - np.sum(residual ** 2) / ss if ss > 0 else 1.0
    d = slope / (2 * dimensions)
    return {'slope': float(slope), 'intercept': float(intercept), 'r2': float(r2),
            'D_A2_fs': float(d), 'D_cm2_s': float(d * A2_PER_FS_TO_CM2_PER_S)}


# ── VDOS ─────────────────────────────────────────────────────────────────────

def vdos(positions, dt, masses=None, smooth_cm=0.0):
    """Vibrational density of states from unwrapped positions (F, n, 3), dt in fs.

    Velocities are central finite differences; the spectrum is |FFT(v)|^2 with a
    Hann window (Wiener-Khinchin), mass-weighted when masses are given, and
    normalised to unit area. Returns (wavenumbers cm^-1, intensity).
    """
    x = np.asarray(positions, dtype=float)
    if len(x) < 8:
        raise ValueError('VDOS needs at least 8 frames.')
    v = (x[2:] - x[:-2]) / (2 * dt)
    v = v - v.mean(axis=0)
    window = np.hanning(len(v))[:, None, None]
    spectrum = np.abs(np.fft.rfft(v * window, axis=0)) ** 2
    weights = np.ones(x.shape[1]) if masses is None else np.asarray(masses, dtype=float)
    intensity = np.einsum('fnk,n->f', spectrum, weights)
    freq = np.fft.rfftfreq(len(v), d=dt) * FS_TO_CM1
    if smooth_cm and smooth_cm > 0 and len(freq) > 1:
        sigma = smooth_cm / (freq[1] - freq[0])
        half = int(4 * sigma) + 1
        kernel = np.exp(-0.5 * (np.arange(-half, half + 1) / sigma) ** 2)
        intensity = np.convolve(intensity, kernel / kernel.sum(), mode='same')
    area = np.trapezoid(intensity, freq) if hasattr(np, 'trapezoid') else np.trapz(intensity, freq)
    return freq, intensity / area if area > 0 else intensity


# ── autocorrelation ──────────────────────────────────────────────────────────

def autocorrelation(series, mode='linear', max_lag=None, period=360.0):
    """Normalised autocorrelation of one or more series (groups, N).

    linear:   C(m) = <dx(t) dx(t+m)> / <dx^2>, averaged over time origins and groups.
    circular: the same for the unit vector z = exp(2 pi i x / period) of angles in degrees,
              C(m) = Re<dz*(t) dz(t+m)> / <|dz|^2> with dz = z - <z>. Removing <z> makes C decay
              to zero (the raw <cos[x(t+m) - x(t)]> only decays to R^2 for a confined angle).
    """
    x = np.atleast_2d(np.asarray(series, dtype=float))
    n = x.shape[1]
    if n < 4:
        raise ValueError('Autocorrelation needs at least four frames.')
    max_lag = n - 1 if max_lag is None else int(min(max_lag, n - 1))
    counts = n - np.arange(n)
    if mode == 'circular':
        radians = 2 * np.pi * x / period
        parts = [np.cos(radians), np.sin(radians)]
        parts = [p - p.mean(axis=1, keepdims=True) for p in parts]
        raw = sum(_autocorrelation_sum(p.T).T for p in parts) / counts  # (groups, N)
        variance = raw[:, :1]
        if np.any(variance <= 1e-15):
            raise ValueError('A selected angle is constant; its autocorrelation is undefined.')
        acf = (raw / variance).mean(axis=0)
    else:
        dx = x - x.mean(axis=1, keepdims=True)
        raw = _autocorrelation_sum(dx.T).T / counts
        variance = raw[:, :1]
        if np.any(variance <= 0):
            raise ValueError('A selected quantity is constant; its autocorrelation is undefined.')
        acf = (raw / variance).mean(axis=0)
    return acf[:max_lag + 1]


def correlation_time(lags, acf, fit_until='zero', model='exp'):
    """Fit C(t) = exp(-t/tau) (as in the MONET reference workflow) and integrate C(t).

    fit_until: 'zero' (first zero crossing), 'efold' (first C < 1/e ... x3 of it), or 'all'.
    model: 'exp' or 'exp_offset', C(t) = (1 - c) exp(-t/tau) + c with an asymptotic plateau c.
    Returns tau_fit, its standard error, tau_int, the plateau and the fitted window.
    """
    from scipy.optimize import curve_fit
    lags = np.asarray(lags, dtype=float)
    acf = np.asarray(acf, dtype=float)
    below = np.flatnonzero(acf <= 0)
    zero = int(below[0]) if len(below) else len(acf)
    if fit_until == 'all':
        end = len(acf)
    elif fit_until == 'efold':
        efold = np.flatnonzero(acf <= 1 / math.e)
        end = min(len(acf), 3 * int(efold[0]) + 1) if len(efold) else len(acf)
    else:
        end = zero
    end = max(end, 3)
    t, c = lags[:end], acf[:end]
    tau_int = float(np.sum((acf[:zero][1:] + acf[:zero][:-1]) / 2 * np.diff(lags[:zero]))) if zero > 1 else float('nan')
    guess = tau_int if math.isfinite(tau_int) and tau_int > 0 else max(t[-1], 1e-9) / 2
    plateau, plateau_error = 0.0, 0.0
    try:
        if model == 'exp_offset':
            tail = float(np.mean(c[len(c) // 2:]))
            (tau, plateau), covariance = curve_fit(lambda s, tau, off: (1 - off) * np.exp(-s / tau) + off, t, c,
                                                   p0=[guess, min(max(tail, -0.5), 0.9)],
                                                   bounds=([1e-12, -1.0], [np.inf, 0.999]), maxfev=20000)
            plateau_error = float(np.sqrt(covariance[1, 1])) if np.isfinite(covariance).all() else float('nan')
        else:
            (tau,), covariance = curve_fit(lambda s, tau: np.exp(-s / tau), t, c, p0=[guess],
                                           bounds=(1e-12, np.inf), maxfev=20000)
        error = float(np.sqrt(covariance[0, 0])) if np.isfinite(covariance).all() else float('nan')
    except (RuntimeError, ValueError):
        tau, error, plateau, plateau_error = float('nan'), float('nan'), float('nan'), float('nan')
    return {'tau_fit': float(tau), 'tau_fit_error': error, 'tau_int': tau_int, 'plateau': float(plateau),
            'plateau_error': plateau_error, 'fit_model': model,
            'fit_end': float(t[-1]), 'fit_points': int(end), 'decorrelated': bool(len(below))}


def molecule_tree(symbols, positions, cell, pbc, mult=1.2):
    """Bonded molecules (with periodic images) as a breadth-first forest: (depth levels, parents, labels)."""
    from ase import Atoms
    from ase.neighborlist import natural_cutoffs, neighbor_list
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import breadth_first_order, connected_components
    n = len(symbols)
    atoms = Atoms(symbols, positions=positions, cell=cell, pbc=pbc)
    cutoffs = [0.0 if s == 'X' else c for s, c in zip(symbols, natural_cutoffs(atoms, mult=mult))]
    i, j = neighbor_list('ij', atoms, cutoffs)
    graph = coo_matrix((np.ones(len(i)), (i, j)), shape=(n, n)).tocsr()
    count, labels = connected_components(graph, directed=False)
    parent = np.full(n, -1)
    depth = np.zeros(n, dtype=int)
    seen = np.zeros(count, dtype=bool)
    for root in range(n):
        if seen[labels[root]]:
            continue
        seen[labels[root]] = True
        order, predecessors = breadth_first_order(graph, root, directed=False, return_predecessors=True)
        for atom in order[1:]:
            parent[atom] = predecessors[atom]
            depth[atom] = depth[parent[atom]] + 1
    levels = [np.flatnonzero(depth == d) for d in range(1, depth.max() + 1)] if n else []
    return levels, parent, labels


def wrap_positions(positions, cells, mode='molecules', tree=None, center=None):
    """Positions (F, n, 3) moved into their cells, as in pbc.js.

    mode 'atoms' wraps every atom; 'molecules' first rebuilds molecules split by the boundary
    (each atom follows its bonded parent by the minimum image), then shifts whole molecules so
    their centroid lies inside the cell. `center` (atom indices) is moved to the cell centre first.
    """
    x = np.array(positions, dtype=float)
    cells = np.asarray(cells, dtype=float)
    for f in range(len(x)):
        cell = cells[f]
        inverse = np.linalg.inv(cell)
        frame = x[f]
        if mode == 'molecules' and tree is not None:
            levels, parent, _ = tree
            for level in levels:
                delta = frame[level] - frame[parent[level]]
                frac = delta @ inverse
                frame[level] = frame[parent[level]] + (frac - np.round(frac)) @ cell
        if center is not None and len(center):
            frame += 0.5 * cell.sum(axis=0) - frame[center].mean(axis=0)
        if mode == 'atoms':
            frame -= np.floor(frame @ inverse) @ cell
        elif mode == 'molecules':
            labels = tree[2] if tree is not None else np.arange(len(frame))
            count = labels.max() + 1
            sums = np.zeros((count, 3))
            np.add.at(sums, labels, frame)
            centroids = sums / np.bincount(labels, minlength=count)[:, None]
            frame -= (np.floor(centroids @ inverse) @ cell)[labels]
    return x


def unwrap_angles(series, period=360.0):
    """Remove 0/360 jumps so linear correlations of torsions are meaningful."""
    return np.unwrap(np.asarray(series, dtype=float), period=period, axis=-1)


def histogram_density(values, nbins, value_range=None):
    counts, edges = np.histogram(np.ravel(values), bins=nbins, range=value_range, density=True)
    return (edges[:-1] + edges[1:]) / 2, counts


# ── fluctuations of atoms, bonds, angles and dihedrals ──────────────────────

def _vectors(positions, cells, pbc, a, b):
    """Displacements b - a (F, G, 3), minimum image when a periodic cell is given."""
    d = positions[:, b] - positions[:, a]
    if cells is None or pbc is None or not np.any(pbc):
        return d
    return np.array([minimum_image(d[f], cells[f], pbc) for f in range(len(d))])


def geometry_series(positions, groups, cells=None, pbc=None):
    """(F, G) distances (Å), angles or dihedrals (degrees, ASE 0–360 convention) of equally sized groups."""
    positions = np.asarray(positions, dtype=float)
    g = np.asarray(groups, dtype=int)
    width = g.shape[1]
    norm = lambda v: np.linalg.norm(v, axis=-1)
    if width == 2:
        return norm(_vectors(positions, cells, pbc, g[:, 0], g[:, 1]))
    if width == 3:
        u = _vectors(positions, cells, pbc, g[:, 1], g[:, 0])
        v = _vectors(positions, cells, pbc, g[:, 1], g[:, 2])
        cosine = np.sum(u * v, axis=-1) / (norm(u) * norm(v))
        return np.degrees(np.arccos(np.clip(cosine, -1, 1)))
    if width == 4:
        v0 = _vectors(positions, cells, pbc, g[:, 0], g[:, 1])
        v1 = _vectors(positions, cells, pbc, g[:, 1], g[:, 2])
        v2 = _vectors(positions, cells, pbc, g[:, 2], g[:, 3])
        n1 = v1 / norm(v1)[..., None]
        v = -v0 + np.sum(v0 * n1, axis=-1)[..., None] * n1
        w = v2 - np.sum(v2 * n1, axis=-1)[..., None] * n1
        x = np.sum(v * w, axis=-1)
        y = np.sum(np.cross(n1, v) * w, axis=-1)
        return np.degrees(np.arctan2(y, x)) % 360.0
    raise ValueError('Groups must have 2, 3 or 4 atoms.')


def bonded_items(neighbours, kind, allowed=None, limit=5000):
    """Bonds, angles or dihedrals of a bond graph (list of neighbour sets), each listed once."""
    ok = (lambda *atoms: True) if allowed is None else (lambda *atoms: all(a in allowed for a in atoms))
    items = []
    n = len(neighbours)
    for j in range(n):
        near = sorted(neighbours[j])
        if kind == 'bonds':
            items += [[j, k] for k in near if k > j and ok(j, k)]
        elif kind == 'angles':
            items += [[i, j, k] for x, i in enumerate(near) for k in near[x + 1:] if ok(i, j, k)]
        else:
            for k in near:
                if k <= j:
                    continue
                items += [[i, j, k, l] for i in sorted(neighbours[j]) if i != k
                          for l in sorted(neighbours[k]) if l not in (j, i) and ok(i, j, k, l)]
        if len(items) > limit:
            raise ValueError(f'More than {limit} {kind} found: select a smaller set of atoms.')
    return items


def dominant_frequency(signal, dt):
    """Frequency (1/time unit of dt) and share of power of the strongest non-zero Fourier component.

    `signal` is (F,) or (F, k); the power of the k components is summed.
    """
    x = np.asarray(signal, dtype=float)
    if x.ndim == 1:
        x = x[:, None]
    n = len(x)
    if n < 8:
        return math.nan, math.nan
    t = np.arange(n)
    # Remove the mean and the linear trend, then apply a Hann window.
    coefficients = np.polyfit(t, x, 1)
    x = x - (np.outer(t, coefficients[0]) + coefficients[1])
    power = np.sum(np.abs(np.fft.rfft(x * np.hanning(n)[:, None], axis=0)) ** 2, axis=1)
    power[0] = 0
    total = power.sum()
    if not total > 0:
        return math.nan, math.nan
    k = int(np.argmax(power))
    return k / (n * dt), float(power[k] / total)


def series_statistics(values, dt=1.0, period=None, blocks=5):
    """Mean, spread, extremes, linear trend and dominant oscillation of every row (G, F).

    Angles with a `period` use circular mean and SD; extremes and trend use the
    series unwrapped around its circular mean. `dt` is the time between analysed
    frames (slopes are per time unit of dt).
    """
    values = np.asarray(values, dtype=float)
    frames = values.shape[1]
    t = np.arange(frames) * dt
    out = []
    for row in values:
        if period:
            k = 2 * math.pi / period
            s, c = np.sin(k * row).mean(), np.cos(k * row).mean()
            mean = float(math.atan2(s, c) / k % period)
            resultant = max(math.hypot(s, c), 1e-12)
            std = float(math.sqrt(-2 * math.log(resultant)) / k)
            centred = mean + (row - mean + period / 2) % period - period / 2
            trend_signal = np.unwrap(row, period=period)
        else:
            mean = float(row.mean())
            std = float(row.std(ddof=1)) if frames > 1 else 0.0
            centred = trend_signal = row
        if frames > 2:
            (slope, intercept), cov = np.polyfit(t, trend_signal, 1, cov=True)
            slope_error = float(math.sqrt(max(cov[0, 0], 0)))
            fitted = slope * t + intercept
            residual = np.sum((trend_signal - fitted) ** 2)
            spread = np.sum((trend_signal - trend_signal.mean()) ** 2)
            r2 = float(1 - residual / spread) if spread > 0 else 0.0
        else:
            slope, slope_error, r2 = 0.0, math.nan, 0.0
        # Block averages: their scatter is a correlation-aware error of the mean.
        # A trend is significant when the block means (which average out the fast oscillations)
        # follow the line beyond three times the error of their own slope.
        size = frames // blocks
        significant = False
        if size >= 2:
            signal = trend_signal[:size * blocks]
            means = signal.reshape(blocks, size).mean(axis=1)
            residuals = (signal - (slope * t[:size * blocks] + intercept)).reshape(blocks, size).mean(axis=1)
            block_sem = float(residuals.std(ddof=1) / math.sqrt(blocks))
            centres = t[:size * blocks].reshape(blocks, size).mean(axis=1)
            (block_slope, _), block_cov = np.polyfit(centres, means, 1, cov=True)
            significant = abs(block_slope) > 3 * math.sqrt(max(block_cov[0, 0], 0)) and abs(slope) * t[-1] > 0.1 * max(std, 1e-12)
        else:
            block_sem = math.nan
        half = frames // 2
        drift = float(centred[half:].mean() - centred[:half].mean()) if half else 0.0
        # A constant quantity has no oscillation (its spectrum is rounding noise).
        flat = std <= 1e-9 * max(1.0, abs(mean))
        frequency, share = (math.nan, math.nan) if flat else dominant_frequency(trend_signal, dt)
        out.append({
            'mean': mean, 'std': std, 'min': float(centred.min()), 'max': float(centred.max()),
            'range': float(centred.max() - centred.min()),
            'p5': float(np.percentile(centred, 5)), 'p95': float(np.percentile(centred, 95)),
            'slope': float(slope), 'slope_error': slope_error, 'r2': r2,
            'drift': drift, 'block_sem': block_sem,
            'trend': bool(significant),
            'frequency': frequency, 'frequency_share': share,
        })
    return out


def atomic_fluctuations(positions, cells=None, pbc=None, align=True):
    """Per-atom displacement from the average position.

    Returns (|dev| series (n, F), RMSF (n,), deviations (F, n, 3)). Periodic
    trajectories are unwrapped first; `align` removes global translation and
    rotation (Kabsch on the analysed atoms, iterated once on the average).
    """
    x = np.asarray(positions, dtype=float)
    if cells is not None and pbc is not None and np.any(pbc):
        x, _ = unwrap(x, cells, pbc)
    x = x - x.mean(axis=1, keepdims=True) if align else x
    if align and x.shape[1] >= 3:
        for _ in range(2):
            reference = x.mean(axis=0)
            reference = reference - reference.mean(axis=0)
            H = np.einsum('fni,nj->fij', x, reference)
            U, _, Vt = np.linalg.svd(H)
            d = np.sign(np.linalg.det(np.einsum('fij,fjk->fik', U, Vt)))
            U[:, :, -1] *= d[:, None]
            R = np.einsum('fij,fjk->fik', U, Vt)
            x = np.einsum('fni,fij->fnj', x, R)
    deviation = x - x.mean(axis=0)
    magnitude = np.linalg.norm(deviation, axis=2)
    rmsf = np.sqrt(np.mean(magnitude ** 2, axis=0))
    return magnitude.T, rmsf, deviation

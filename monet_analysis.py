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

def autocorrelation(series, mode='linear', max_lag=None):
    """Normalised autocorrelation of one or more series (groups, N).

    linear:   C(m) = <dx(t) dx(t+m)> / <dx^2>, averaged over time origins and groups.
    circular: C(m) = <cos(x(t+m) - x(t))> for angles in degrees (not mean-subtracted).
    """
    x = np.atleast_2d(np.asarray(series, dtype=float))
    n = x.shape[1]
    if n < 4:
        raise ValueError('Autocorrelation needs at least four frames.')
    max_lag = n - 1 if max_lag is None else int(min(max_lag, n - 1))
    counts = n - np.arange(n)
    if mode == 'circular':
        radians = np.radians(x)
        parts = [np.cos(radians), np.sin(radians)]
        total = sum(_autocorrelation_sum(p.T).T for p in parts)  # (groups, N)
        acf = (total / counts).mean(axis=0)
    else:
        dx = x - x.mean(axis=1, keepdims=True)
        raw = _autocorrelation_sum(dx.T).T / counts
        variance = raw[:, :1]
        if np.any(variance <= 0):
            raise ValueError('A selected quantity is constant; its autocorrelation is undefined.')
        acf = (raw / variance).mean(axis=0)
    return acf[:max_lag + 1]


def correlation_time(lags, acf, fit_until='zero'):
    """Fit C(t) = exp(-t/tau) (as in the MONET reference workflow) and integrate C(t).

    fit_until: 'zero' (first zero crossing), 'efold' (first C < 1/e ... x3 of it), or 'all'.
    Returns tau_fit, its standard error, tau_int and the fitted window.
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
    try:
        (tau,), covariance = curve_fit(lambda s, tau: np.exp(-s / tau), t, c, p0=[guess],
                                       bounds=(1e-12, np.inf), maxfev=20000)
        error = float(np.sqrt(covariance[0, 0])) if np.isfinite(covariance).all() else float('nan')
    except (RuntimeError, ValueError):
        tau, error = float('nan'), float('nan')
    return {'tau_fit': float(tau), 'tau_fit_error': error, 'tau_int': tau_int,
            'fit_end': float(t[-1]), 'fit_points': int(end), 'decorrelated': bool(len(below))}


def unwrap_angles(series, period=360.0):
    """Remove 0/360 jumps so linear correlations of torsions are meaningful."""
    return np.unwrap(np.asarray(series, dtype=float), period=period, axis=-1)


def histogram_density(values, nbins, value_range=None):
    counts, edges = np.histogram(np.ravel(values), bins=nbins, range=value_range, density=True)
    return (edges[:-1] + edges[1:]) / 2, counts

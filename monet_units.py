"""
Physical constants and cell conversions shared by the QM inputs (Python launcher).
units.js implements the same functions for the browser and Node.
"""
import math

BOHR_ANGSTROM = 0.529177210903  # CODATA 2018
HARTREE_EV = 27.211386245988
RY_EV = HARTREE_EV / 2
AU_TIME_FS = 0.02418884326585747  # hbar/E_h
RY_TIME_FS = 2 * AU_TIME_FS  # hbar/Ry

RAD = math.pi / 180


def angstrom_to_bohr(x):
    return x / BOHR_ANGSTROM


def bohr_to_angstrom(x):
    return x * BOHR_ANGSTROM


def _dot(u, v):
    return u[0] * v[0] + u[1] * v[1] + u[2] * v[2]


def _norm(v):
    return math.sqrt(_dot(v, v))


def _cross(u, v):
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]


def cell_vectors(cellpar):
    a, b, c, alpha, beta, gamma = cellpar
    ca, cb, cg = (math.cos(v * RAD) for v in (alpha, beta, gamma))
    sg = math.sin(gamma * RAD)
    cy = (ca - cb * cg) / sg
    return [[a, 0, 0], [b * cg, b * sg, 0], [c * cb, c * cy, c * math.sqrt(max(0, 1 - cb * cb - cy * cy))]]


def cell_parameters(rows):
    a, b, c = rows
    volume = abs(_dot(a, _cross(b, c)))
    lengths = [_norm(row) for row in rows]
    if not (volume > 1e-12) or any(not (length > 0) for length in lengths):
        raise ValueError('The cell is degenerate (zero volume).')

    def angle(u, v):
        return math.acos(min(1, max(-1, _dot(u, v) / (_norm(u) * _norm(v))))) / RAD
    return lengths + [angle(b, c), angle(a, c), angle(a, b)]


def fractional(rows, positions):
    a, b, c = rows
    bc, ca, ab = _cross(b, c), _cross(c, a), _cross(a, b)
    volume = _dot(a, bc)
    if not (abs(volume) > 1e-12):
        raise ValueError('The cell is degenerate (zero volume).')
    return [[_dot(r, bc) / volume, _dot(r, ca) / volume, _dot(r, ab) / volume] for r in positions]


def is_standard_orientation(rows, tol=1e-6):
    return (abs(rows[0][1]) <= tol and abs(rows[0][2]) <= tol and abs(rows[1][2]) <= tol
            and rows[0][0] > 0 and rows[1][1] > 0 and rows[2][2] > 0)

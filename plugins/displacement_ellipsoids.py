"""Anisotropic displacement parameters (thermal ellipsoids) from the trajectory (MONET Custom Functionalities › More analyses).

A MONET plugin: see docs/plugins.md. U = <Δr Δrᵀ> of every atom after removing global translation and
rotation (the same calculation as Fluctuations & trends › Atoms), written as PDB ANISOU records in the
Cartesian axes of the first frame, or as a CIF with U^ij referred to the crystal axes.
"""
import math

import numpy as np

from monet_registry import Param, analysis, profile

DESCRIPTION = ('Mean-square displacement tensor U = ⟨Δr Δrᵀ⟩ (Å²) of every atom about its average position, after '
               'removing global translation and rotation (Kabsch on the chosen atoms; periodic runs are unwrapped '
               'first). This is the MD counterpart of crystallographic anisotropic displacement parameters, for '
               'internal motion only: rigid-body translation and libration are removed, and classical nuclei have '
               'no zero-point motion. The file opens in Mercury, VESTA, Olex2, PyMOL or ORTEP as thermal ellipsoids.')
PARAMS = [Param.atoms('Atoms (blank = all)')]


CHUNK = 2000  # frames per block: long trajectories are aligned without extra copies of all positions


def _aligned_deviations(x):
    """Deviations (F, n, 3) from the average after removing translation and rotation, in the axes of frame 0.

    Kabsch on the chosen atoms, iterated once on the average (as Fluctuations & trends › Atoms).
    Self-contained, so the plugin also runs on MONET releases that ship an older monet_analysis.
    """
    x = x - x.mean(axis=1, keepdims=True)
    if x.shape[1] >= 3:
        first = np.eye(3)
        for _ in range(2):
            reference = x.mean(axis=0)
            reference = reference - reference.mean(axis=0)
            for start in range(0, len(x), CHUNK):
                block = x[start:start + CHUNK]
                U, _, Vt = np.linalg.svd(np.einsum('fni,nj->fij', block, reference))
                d = np.sign(np.linalg.det(np.einsum('fij,fjk->fik', U, Vt)))
                U[:, :, -1] *= d[:, None]
                R = np.einsum('fij,fjk->fik', U, Vt)
                if start == 0:
                    first = first @ R[0]
                x[start:start + CHUNK] = np.einsum('fni,fij->fnj', block, R)
        # One common rotation back to the first frame.
        x = x @ first.T
    x -= x.mean(axis=0)
    return x


def _tensors(ctx, p, need_cell=False):
    """Average positions (n, 3), tensors (n, 3, 3), first-frame cell, the atoms and the frame count."""
    import monet_analysis
    data = ctx.frames(p['indices'], need_cell=need_cell)
    if len(data.frames) < 3:
        raise ValueError('At least three analysed frames are needed; lower the frame step.')
    positions = np.asarray(data.positions, dtype=float)
    periodic = data.cells is not None and data.pbc is not None and np.any(data.pbc)
    if periodic and (ctx.mic or need_cell):
        ctx.progress('Unwrapping periodic images …', 20)
        positions, _ = monet_analysis.unwrap(positions, data.cells, data.pbc)
    ctx.progress(f'Aligning {len(positions)} frames …', 40)
    deviation = _aligned_deviations(positions.copy())
    # The aligned trajectory keeps the placement of the first frame: its average is frame 0 minus its deviation.
    mean = positions[0] - deviation[0]
    ctx.progress('Displacement tensors …', 80)
    u_cart = np.einsum('fni,fnj->nij', deviation, deviation) / len(deviation)
    chosen = p['indices'] if p['indices'] is not None else list(range(positions.shape[1]))
    cell = None if data.cells is None else np.asarray(data.cells[0], dtype=float)
    return mean, u_cart, cell, chosen, len(data.frames)


def _crystal_adp(u_cart, cell):
    """Cartesian tensors → CIF U^ij in the crystal axes: U_cart = A N U N Aᵀ (A: lattice vectors as columns,
    N = diag(|a*|, |b*|, |c*|)), with `cell` rows = lattice vectors in the axes of u_cart."""
    A = np.asarray(cell, dtype=float).T
    N = np.diag(np.linalg.norm(np.linalg.inv(A), axis=1))
    M = np.linalg.inv(A @ N)
    return np.einsum('ij,njk,lk->nil', M, u_cart, M)


def _summary(u_cart, chosen, u_file, header):
    """Bar chart of U_eq with a table of the tensors written to the file and the principal amplitudes."""
    rows, ueq = [], []
    for k, index in enumerate(chosen):
        eigen = np.clip(np.linalg.eigvalsh(u_cart[k]), 0, None)
        ueq.append(float(np.trace(u_cart[k]) / 3))
        u = u_file[k]
        rows.append([index, round(ueq[-1], 6)]
                    + [round(float(u[i, j]), 6) for i, j in ((0, 0), (1, 1), (2, 2), (0, 1), (0, 2), (1, 2))]
                    + [round(math.sqrt(eigen[2]), 4), round(math.sqrt(eigen[0]), 4),
                       round(float(eigen[0] / eigen[2]), 3) if eigen[2] > 0 else None])
    columns = ['Atom', 'U_eq (Å²)', *[f'{header}{c}' for c in ('11', '22', '33', '12', '13', '23')],
               'Largest RMS amplitude (Å)', 'Smallest RMS amplitude (Å)', 'Anisotropy (λmin/λmax)']
    return ueq, {'columns': columns, 'rows': rows, 'atom_columns': [0]}


def _labels(ctx, chosen, symbols):
    # ctx.atom_ids exists from MONET 2.3.2; older releases number the atoms of the file from 1.
    ids = getattr(ctx, 'atom_ids', None) or list(range(1, len(symbols) + 1))
    return [f'{symbols[i]}{ids[i]}' for i in chosen], [ids[i] for i in chosen]


@analysis('displacement_ellipsoids', engine='custom', label='Thermal ellipsoids (ADP) → PDB',
          description=DESCRIPTION + ' PDB: coordinates are the average positions, ANISOU in the Cartesian axes of the first frame.',
          category='Displacement', params=PARAMS, output={'suffix': '-adp.pdb'})
def displacement_ellipsoids(ctx, p):
    mean, u_cart, _, chosen, n_frames = _tensors(ctx, p)
    symbols = ctx.symbols
    _, ids = _labels(ctx, chosen, symbols)
    if max(ids) > 99999:
        raise ValueError('PDB holds atom serial numbers up to 99999: choose fewer atoms or use the CIF export.')
    lines = [f'REMARK   1 MONET anisotropic displacement parameters from {n_frames} frames of {ctx.filename.split("/")[-1][:40]}',
             'REMARK   1 Average positions; ANISOU = U (A^2 x 10^4), Cartesian axes of the first frame, aligned']
    for k, index in enumerate(chosen):
        element, serial = symbols[index], ids[k]
        name = f' {element:<3s}' if len(element) == 1 else f'{element:<4s}'
        x, y, z = mean[k]
        b = 8 * math.pi ** 2 * float(np.trace(u_cart[k]) / 3)
        lines.append(f'HETATM{serial:5d} {name} MOL A   1    {x:8.3f}{y:8.3f}{z:8.3f}{1:6.2f}{min(b, 999.99):6.2f}          {element.upper():>2s}')
        u = np.rint(u_cart[k] * 1e4).astype(int)
        lines.append(f'ANISOU{serial:5d} {name} MOL A   1  '
                     + ''.join(f'{int(u[i, j]):7d}' for i, j in ((0, 0), (1, 1), (2, 2), (0, 1), (0, 2), (1, 2)))
                     + f'      {element.upper():>2s}')
    with open(ctx.output(), 'w') as fh:
        fh.write('\n'.join(lines + ['END']) + '\n')
    ueq, table = _summary(u_cart, chosen, u_cart, 'U')
    return profile(chosen, {'U_eq': ueq}, 'Atom (MONET ID)', 'U_eq (Å²)', bars=True, atoms=chosen, table=table,
                   notes=[f'{len(chosen)} atoms · {n_frames} frames · U in the Cartesian axes of the first frame (Å²).',
                          'B = 8π² U_eq in the PDB B-factor column.'])


@analysis('displacement_ellipsoids_cif', engine='custom', label='Thermal ellipsoids (ADP) in crystal axes → CIF',
          description=DESCRIPTION + ' CIF: fractional average positions in the first-frame cell, U^ij in the crystal '
                                    'axes (IUCr convention), space group P1. Needs a crystal cell.',
          category='Displacement', params=PARAMS, output={'suffix': '-adp.cif'})
def displacement_ellipsoids_cif(ctx, p):
    mean, u_cart, cell, chosen, n_frames = _tensors(ctx, p, need_cell=True)
    if cell is None or abs(np.linalg.det(cell)) < 1e-9:
        raise ValueError('The CIF export needs a complete crystal cell: set it under Crystal cell and periodic boundaries.')
    u_cif = _crystal_adp(u_cart, cell)
    symbols = ctx.symbols
    labels, _ = _labels(ctx, chosen, symbols)
    lengths = np.linalg.norm(cell, axis=1)
    angle = lambda i, j: math.degrees(math.acos(np.clip(cell[i] @ cell[j] / (lengths[i] * lengths[j]), -1, 1)))
    fractional = mean @ np.linalg.inv(cell)
    lines = ['data_monet_adp',
             f'_audit_creation_method \'MONET: <dr dr^T> over {n_frames} frames, internal motion (aligned)\'',
             "_symmetry_space_group_name_H-M 'P 1'", '_space_group_IT_number 1',
             'loop_', '_symmetry_equiv_pos_as_xyz', "'x, y, z'",
             *[f'_cell_length_{axis} {value:.6f}' for axis, value in zip('abc', lengths)],
             f'_cell_angle_alpha {angle(1, 2):.4f}', f'_cell_angle_beta {angle(0, 2):.4f}', f'_cell_angle_gamma {angle(0, 1):.4f}',
             f'_cell_volume {abs(np.linalg.det(cell)):.4f}',
             'loop_', '_atom_site_label', '_atom_site_type_symbol', '_atom_site_fract_x', '_atom_site_fract_y',
             '_atom_site_fract_z', '_atom_site_U_iso_or_equiv', '_atom_site_adp_type', '_atom_site_occupancy']
    for k, index in enumerate(chosen):
        fx, fy, fz = fractional[k]
        lines.append(f'{labels[k]} {symbols[index]} {fx:.6f} {fy:.6f} {fz:.6f} {np.trace(u_cart[k]) / 3:.6f} Uani 1')
    lines += ['loop_', '_atom_site_aniso_label', *[f'_atom_site_aniso_U_{c}' for c in ('11', '22', '33', '12', '13', '23')]]
    for k, label in enumerate(labels):
        u = u_cif[k]
        lines.append(f'{label} ' + ' '.join(f'{u[i, j]:.6f}' for i, j in ((0, 0), (1, 1), (2, 2), (0, 1), (0, 2), (1, 2))))
    with open(ctx.output(), 'w') as fh:
        fh.write('\n'.join(lines) + '\n')
    ueq, table = _summary(u_cart, chosen, u_cif, 'U^')
    return profile(chosen, {'U_eq': ueq}, 'Atom (MONET ID)', 'U_eq (Å²)', bars=True, atoms=chosen, table=table,
                   notes=[f'{len(chosen)} atoms · {n_frames} frames · U^ij in the crystal axes (CIF convention, Å²).',
                          'U_eq = trace of the Cartesian tensor / 3.'])

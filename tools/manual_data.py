"""Synthetic trajectories for the manual pictures (`python tools/manual_data.py DIRECTORY` writes them).

* ``ethanol_md.xyz``: one ethanol molecule in an 8 Å cubic cell, 1500 frames of 0.5 fs x 20 steps, with a start-up
  transient (the hydroxyl torsion relaxes over ~120 frames) and an Ornstein-Uhlenbeck torsion, so the autocorrelation has
  a clear decay;
  the comment line of each frame carries ``Lattice=`` and the potential energy.
* ``water_box.xyz``: 64 water molecules in a 12.4 Å cubic cell, 400 frames, diffusing and rotating with a soft
  repulsion between oxygens; periodic boundaries are applied (molecules cross the cell faces), so wrapping, minimum
  image, RDF and MSD have something to do.
"""
from pathlib import Path

import numpy as np
from ase.build import molecule


def _write(path, frames, symbols, cell, extra=None):
    lat = ' '.join(f'{x:.6f}' for x in np.asarray(cell).reshape(-1))
    with open(path, 'w') as fh:
        for i, pos in enumerate(frames):
            fh.write(f'{len(symbols)}\nLattice="{lat}" Properties=species:S:1:pos:R:3 pbc="T T T"'
                     + (f' {extra(i)}' if extra else '') + '\n')
            for s, (x, y, z) in zip(symbols, pos):
                fh.write(f'{s:2s} {x:14.8f} {y:14.8f} {z:14.8f}\n')


def ethanol(path, n=1500, seed=3):
    rng = np.random.default_rng(seed)
    mol = molecule('CH3CH2OH')
    symbols = mol.get_chemical_symbols()
    o = symbols.index('O')
    c = [i for i, s in enumerate(symbols) if s == 'C']
    h_o = [i for i, s in enumerate(symbols) if s == 'H' and np.linalg.norm(mol.positions[i] - mol.positions[o]) < 1.2][0]
    c_o = min(c, key=lambda i: np.linalg.norm(mol.positions[i] - mol.positions[o]))
    c_c = [i for i in c if i != c_o][0]
    mol.center(vacuum=0)
    frames, theta = [], 0.0
    base = mol.get_dihedral(c_c, c_o, o, h_o)
    energies = []
    for i in range(n):
        theta = 0.985 * theta + rng.normal(0, 7.0)
        a = mol.copy()
        a.set_dihedral(c_c, c_o, o, h_o, base + theta + 75.0 * np.exp(-i / 120.0), indices=[h_o])
        a.positions += rng.normal(0, 0.035, a.positions.shape) + 4.0
        a.positions += 0.9 * np.exp(-i / 90.0) * np.array([0.5, -0.2, 0.3])
        frames.append(a.positions.copy())
        energies.append(-154.0 + 0.0021 * theta ** 2 / 100 + 0.04 * np.exp(-i / 90.0) + rng.normal(0, 0.0004))
    _write(path, frames, symbols, np.eye(3) * 8.0, extra=lambda i: f'energy={energies[i]:.8f} step={i * 20}')
    return dict(dihedral=[c_c + 1, c_o + 1, o + 1, h_o + 1], oxygen=o + 1, hydroxyl_h=h_o + 1, carbons=[c_c + 1, c_o + 1])


def water_box(path, n=400, seed=5, molecules=64, density=0.9982):
    """Rigid waters in a periodic cubic box: Brownian motion of the molecules with a soft repulsion between oxygens
    (so that g(r) has a first shell) and a random walk of the orientations."""
    from scipy.spatial.transform import Rotation as R
    rng = np.random.default_rng(seed)
    w = molecule('H2O')
    w.positions -= w.get_center_of_mass()
    L = (molecules * 18.015 / 0.6022 / density) ** (1 / 3)               # Angstrom
    m = round(molecules ** (1 / 3))
    grid = np.array([(i, j, k) for i in range(m) for j in range(m) for k in range(m)]) * (L / m) + L / (2 * m)
    centres = grid + rng.normal(0, 0.2, grid.shape)
    rot = [R.random(random_state=int(rng.integers(1e9))) for _ in range(molecules)]
    sigma, frames = 2.9, []
    for _ in range(n + 100):                                                # 100 steps of equilibration, not written
        for _ in range(12):
            d = centres[:, None, :] - centres[None, :, :]
            d -= L * np.round(d / L)
            r = np.linalg.norm(d, axis=2) + np.eye(molecules) * 1e6
            push = np.where(r < sigma, (sigma - r) / r, 0.0)[:, :, None] * d
            centres = centres + 0.35 * push.sum(axis=1) + rng.normal(0, 0.075, centres.shape)
        rot = [R.from_rotvec(rng.normal(0, 0.09, 3)) * q for q in rot]
        frames.append(np.concatenate([q.apply(w.positions) + c for q, c in zip(rot, centres)]) % L)
    _write(path, frames[100:], ['O', 'H', 'H'] * molecules, np.eye(3) * L)


if __name__ == '__main__':
    import sys
    folder = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
    folder.mkdir(parents=True, exist_ok=True)
    ethanol(folder / 'ethanol_md.xyz')
    water_box(folder / 'water_box.xyz')
    print(f'Wrote ethanol_md.xyz and water_box.xyz in {folder.resolve()}')

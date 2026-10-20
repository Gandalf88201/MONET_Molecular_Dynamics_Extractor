"""Radius of gyration of a group of atoms (MONET Custom Functionalities › More analyses).

A MONET plugin: see docs/plugins.md. Needs only numpy, so it also works without MDAnalysis.
"""
import numpy as np

from monet_registry import Param, analysis, series


@analysis('radius_of_gyration', engine='custom', label='Radius of gyration',
          description='Radius of gyration of the chosen atoms in every analysed frame, mass-weighted or geometric. '
                      'Periodic trajectories are unwrapped first, so molecules split by the cell boundary are kept whole.',
          category='Shape', params=[Param.atoms('Atoms (blank = all)'),
                                    Param.bool('mass_weighted', 'Mass-weighted', True)])
def radius_of_gyration(ctx, p):
    import monet_analysis
    data = ctx.frames(p['indices'])
    positions = data.positions
    if data.cells is not None and data.pbc is not None and data.pbc.any():
        positions, _ = monet_analysis.unwrap(positions, data.cells, data.pbc)
    chosen = p['indices'] if p['indices'] is not None else list(range(positions.shape[1]))
    weights = ctx.atoms().get_masses()[chosen] if p['mass_weighted'] else np.ones(len(chosen))
    if weights.sum() <= 0:
        weights = np.ones(len(chosen))
    weights = weights / weights.sum()
    centre = np.einsum('n,fnk->fk', weights, positions)
    rg = np.sqrt(np.einsum('n,fn->f', weights, np.sum((positions - centre[:, None, :]) ** 2, axis=2)))
    kind = 'mass-weighted' if p['mass_weighted'] else 'geometric'
    return series(data.frames, {f'Rg ({kind}, {len(chosen)} atoms)': rg}, y_label='Radius of gyration (Å)',
                  notes=[f'Mean {rg.mean():.4f} Å, SD {rg.std():.4f} Å.'])

"""Cell volume, mass density or lattice lengths along the trajectory (ASE module › More analyses).

A MONET plugin: see docs/plugins.md. Useful for NPT runs, where the cell changes from frame to frame.
"""
import numpy as np

from monet_registry import Param, analysis, series

AMU_PER_A3_TO_G_PER_CM3 = 1.66053906660  # 1 amu/Å³ = 1.66054 g/cm³


@analysis('cell_volume', engine='ase', label='Cell volume, density and lattice lengths',
          description='Volume, mass density or lattice lengths a, b, c of the cell in every analysed frame '
                      '(extended XYZ lattice, or the crystal cell applied in MONET).',
          category='Cell', params=[Param.choice('quantity', 'Quantity', ['volume', 'density', 'lengths'])])
def cell_volume(ctx, p):
    data = ctx.frames(need_cell=True)
    cells = np.asarray(data.cells)
    volume = np.abs(np.linalg.det(cells))
    if p['quantity'] == 'volume':
        values, label, unit = {'V': volume}, 'Volume', 'Å³'
    elif p['quantity'] == 'density':
        mass = float(ctx.atoms().get_masses().sum())
        values, label, unit = {'ρ': mass / volume * AMU_PER_A3_TO_G_PER_CM3}, 'Mass density', 'g cm⁻³'
    else:
        lengths = np.linalg.norm(cells, axis=2)
        values, label, unit = {'a': lengths[:, 0], 'b': lengths[:, 1], 'c': lengths[:, 2]}, 'Lattice length', 'Å'
    rows = [[name, f'{np.mean(v):.6g}', f'{np.std(v, ddof=1) if len(v) > 1 else 0:.3g}', f'{np.min(v):.6g}', f'{np.max(v):.6g}']
            for name, v in values.items()]
    return series(data.frames, values, y_label=f'{label} ({unit})',
                  notes=[f'{len(data.frames)} frames; a constant cell gives a flat line.'],
                  table={'columns': ['Quantity', f'Mean ({unit})', 'SD', 'Min', 'Max'], 'rows': rows})

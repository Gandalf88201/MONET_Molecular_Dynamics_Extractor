# MONET plugins

Every `*.py` file in this folder is imported when MONET starts a Python worker, and each function decorated with `@analysis` becomes an analysis in the interface:

- `cell_volume.py`: cell volume, mass density or lattice lengths per frame (*ASE › More analyses*);
- `radius_of_gyration.py`: radius of gyration of a group of atoms (*MONET Custom Functionalities › More analyses*).

Keep your own analyses in `~/.monet/plugins/` (or a folder listed in `MONET_PLUGINS`) so that they survive MONET updates, and restart the launcher after changing them. The guide is [docs/plugins.md](../docs/plugins.md).

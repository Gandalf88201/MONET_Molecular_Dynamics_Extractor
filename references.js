'use strict'

// References to cite with MONET, ASE and MDAnalysis, and with each analysis (the ⓘ buttons, the
// References dialog and the methods report). Each entry is stored once as structured fields; the
// Chicago (author-date) and BibTeX forms are generated from them. The analysis-specific entries
// follow the references each ASE and MDAnalysis module declares in its own documentation.
;(function (root) {
  const REFERENCES = {
    // ── MONET and the Python libraries it always uses ──
    monet: {
      type: 'software', authors: [['Francese', 'Tommaso']], title: 'MONET: Molecular Dynamics Extractor',
      version: '2.7.1', publisher: 'Zenodo', year: 2026, doi: '10.5281/zenodo.22816521',
      url: 'https://github.com/Gandalf88201/MONET_Molecular_Dynamics_Extractor'
    },
    francese2022: {
      authors: [['Francese', 'Tommaso'], ['Kundu', 'Arpan'], ['Gygi', 'Francois'], ['Galli', 'Giulia']],
      title: 'Quantum simulations of thermally activated delayed fluorescence in an all-organic emitter',
      journal: 'Physical Chemistry Chemical Physics', volume: '24', pages: '10101', year: 2022, doi: '10.1039/d2cp01147f'
    },
    harris2020: {
      authors: [['Harris', 'Charles R.'], ['Millman', 'K. Jarrod'], ['van der Walt', 'Stéfan J.'], ['Gommers', 'Ralf'],
        ['Virtanen', 'Pauli'], ['Cournapeau', 'David'], ['Wieser', 'Eric'], ['Taylor', 'Julian'], ['Berg', 'Sebastian'],
        ['Smith', 'Nathaniel J.'], ['Kern', 'Robert'], ['Picus', 'Matti'], ['Hoyer', 'Stephan'], ['van Kerkwijk', 'Marten H.'],
        ['Brett', 'Matthew'], ['Haldane', 'Allan'], ['Fernández del Río', 'Jaime'], ['Wiebe', 'Mark'], ['Peterson', 'Pearu'],
        ['Gérard-Marchant', 'Pierre'], ['Sheppard', 'Kevin'], ['Reddy', 'Tyler'], ['Weckesser', 'Warren'], ['Abbasi', 'Hameer'],
        ['Gohlke', 'Christoph'], ['Oliphant', 'Travis E.']],
      title: 'Array programming with NumPy', journal: 'Nature', volume: '585', issue: '7825', pages: '357–362', year: 2020,
      doi: '10.1038/s41586-020-2649-2'
    },
    virtanen2020: {
      authors: [['Virtanen', 'Pauli'], ['Gommers', 'Ralf'], ['Oliphant', 'Travis E.'], ['Haberland', 'Matt'], ['Reddy', 'Tyler'],
        ['Cournapeau', 'David'], ['Burovski', 'Evgeni'], ['Peterson', 'Pearu'], ['Weckesser', 'Warren'], ['Bright', 'Jonathan'],
        ['van der Walt', 'Stéfan J.'], ['Brett', 'Matthew'], ['Wilson', 'Joshua'], ['Millman', 'K. Jarrod'], ['Mayorov', 'Nikolay'],
        ['Nelson', 'Andrew R. J.'], ['Jones', 'Eric'], ['Kern', 'Robert'], ['Larson', 'Eric'], ['Carey', 'C J'], ['Polat', 'İlhan'],
        ['Feng', 'Yu'], ['Moore', 'Eric W.'], ['VanderPlas', 'Jake'], ['Laxalde', 'Denis'], ['Perktold', 'Josef'],
        ['Cimrman', 'Robert'], ['Henriksen', 'Ian'], ['Quintero', 'E. A.'], ['Harris', 'Charles R.'], ['Archibald', 'Anne M.'],
        ['Ribeiro', 'Antônio H.'], ['Pedregosa', 'Fabian'], ['van Mulbregt', 'Paul'], ['SciPy 1.0 Contributors']],
      title: 'SciPy 1.0: Fundamental algorithms for scientific computing in Python', journal: 'Nature Methods',
      volume: '17', issue: '3', pages: '261–272', year: 2020, doi: '10.1038/s41592-019-0686-2'
    },
    kabsch1976: {
      authors: [['Kabsch', 'Wolfgang']], title: 'A solution for the best rotation to relate two sets of vectors',
      journal: 'Acta Crystallographica Section A', volume: '32', issue: '5', pages: '922–923', year: 1976, doi: '10.1107/S0567739476001873'
    },
    flyvbjerg1989: {
      authors: [['Flyvbjerg', 'H.'], ['Petersen', 'H. G.']], title: 'Error estimates on averages of correlated data',
      journal: 'The Journal of Chemical Physics', volume: '91', issue: '1', pages: '461–466', year: 1989, doi: '10.1063/1.457480'
    },
    geyer1992: {
      authors: [['Geyer', 'Charles J.']], title: 'Practical Markov chain Monte Carlo', journal: 'Statistical Science',
      volume: '7', issue: '4', pages: '473–483', year: 1992, doi: '10.1214/ss/1177011137'
    },
    sokal1997: {
      type: 'incollection', authors: [['Sokal', 'Alan']],
      title: 'Monte Carlo methods in statistical mechanics: Foundations and new algorithms',
      booktitle: 'Functional Integration: Basics and Applications', editors: 'Cécile DeWitt-Morette, Pierre Cartier, and Antoine Folacci',
      series: 'NATO ASI Series B', volume: '361', pages: '131–192', publisher: 'Springer', address: 'Boston, MA', year: 1997,
      doi: '10.1007/978-1-4899-0319-8_6'
    },

    // ── ASE ──
    larsen2017: {
      authors: [['Hjorth Larsen', 'Ask'], ['Jørgen Mortensen', 'Jens'], ['Blomqvist', 'Jakob'], ['Castelli', 'Ivano E.'],
        ['Christensen', 'Rune'], ['Dułak', 'Marcin'], ['Friis', 'Jesper'], ['Groves', 'Michael N.'], ['Hammer', 'Bjørk'],
        ['Hargus', 'Cory'], ['Hermes', 'Eric D.'], ['Jennings', 'Paul C.'], ['Bjerre Jensen', 'Peter'], ['Kermode', 'James'],
        ['Kitchin', 'John R.'], ['Leonhard Kolsbjerg', 'Esben'], ['Kubal', 'Joseph'], ['Kaasbjerg', 'Kristen'], ['Lysgaard', 'Steen'],
        ['Bergmann Maronsson', 'Jón'], ['Maxson', 'Tristan'], ['Olsen', 'Thomas'], ['Pastewka', 'Lars'], ['Peterson', 'Andrew'],
        ['Rostgaard', 'Carsten'], ['Schiøtz', 'Jakob'], ['Schütt', 'Ole'], ['Strange', 'Mikkel'], ['Thygesen', 'Kristian S.'],
        ['Vegge', 'Tejs'], ['Vilhelmsen', 'Lasse'], ['Walter', 'Michael'], ['Zeng', 'Zhenhua'], ['Jacobsen', 'Karsten W.']],
      title: 'The atomic simulation environment—a Python library for working with atoms',
      journal: 'Journal of Physics: Condensed Matter', volume: '29', issue: '27', pages: '273002', year: 2017,
      doi: '10.1088/1361-648X/aa680e'
    },
    larsen2019: {
      authors: [['Larsen', 'Peter Mahler'], ['Pandey', 'Mohnish'], ['Strange', 'Mikkel'], ['Jacobsen', 'Karsten Wedel']],
      title: 'Definition of a scoring parameter to identify low-dimensional materials components',
      journal: 'Physical Review Materials', volume: '3', issue: '3', pages: '034003', year: 2019, doi: '10.1103/PhysRevMaterials.3.034003'
    },
    waasmaier1995: {
      authors: [['Waasmaier', 'D.'], ['Kirfel', 'A.']], title: 'New analytical scattering-factor functions for free atoms and ions',
      journal: 'Acta Crystallographica Section A', volume: '51', issue: '3', pages: '416–431', year: 1995, doi: '10.1107/S0108767394013292'
    },
    togo2024: {
      authors: [['Togo', 'Atsushi'], ['Shinohara', 'Kohei'], ['Tanaka', 'Isao']], title: 'Spglib: A software library for crystal symmetry search',
      journal: 'Science and Technology of Advanced Materials: Methods', volume: '4', issue: '1', pages: '2384822', year: 2024,
      doi: '10.1080/27660400.2024.2384822'
    },
    setyawan2010: {
      authors: [['Setyawan', 'Wahyu'], ['Curtarolo', 'Stefano']], title: 'High-throughput electronic band structure calculations: Challenges and tools',
      journal: 'Computational Materials Science', volume: '49', issue: '2', pages: '299–312', year: 2010, doi: '10.1016/j.commatsci.2010.05.010'
    },
    grosse2004: {
      authors: [['Grosse-Kunstleve', 'R. W.'], ['Sauter', 'N. K.'], ['Adams', 'P. D.']],
      title: 'Numerically stable algorithms for the computation of reduced unit cells', journal: 'Acta Crystallographica Section A',
      volume: '60', issue: '1', pages: '1–6', year: 2004, doi: '10.1107/S010876730302186X'
    },

    // ── MDAnalysis ──
    michaud2011: {
      authors: [['Michaud-Agrawal', 'Naveen'], ['Denning', 'Elizabeth J.'], ['Woolf', 'Thomas B.'], ['Beckstein', 'Oliver']],
      title: 'MDAnalysis: A toolkit for the analysis of molecular dynamics simulations', journal: 'Journal of Computational Chemistry',
      volume: '32', issue: '10', pages: '2319–2327', year: 2011, doi: '10.1002/jcc.21787'
    },
    gowers2016: {
      type: 'inproceedings',
      authors: [['Gowers', 'Richard J.'], ['Linke', 'Max'], ['Barnoud', 'Jonathan'], ['Reddy', 'Tyler J. E.'], ['Melo', 'Manuel N.'],
        ['Seyler', 'Sean L.'], ['Domański', 'Jan'], ['Dotson', 'David L.'], ['Buchoux', 'Sébastien'], ['Kenney', 'Ian M.'],
        ['Beckstein', 'Oliver']],
      title: 'MDAnalysis: A Python package for the rapid analysis of molecular dynamics simulations',
      booktitle: 'Proceedings of the 15th Python in Science Conference', editors: 'Sebastian Benthall and Scott Rostrup',
      pages: '98–105', address: 'Austin, TX', publisher: 'SciPy', year: 2016, doi: '10.25080/Majora-629e541a-00e'
    },
    theobald2005: {
      authors: [['Theobald', 'Douglas L.']], title: 'Rapid calculation of RMSDs using a quaternion-based characteristic polynomial',
      journal: 'Acta Crystallographica Section A', volume: '61', issue: '4', pages: '478–480', year: 2005, doi: '10.1107/S0108767305015266'
    },
    liu2010: {
      authors: [['Liu', 'Pu'], ['Agrafiotis', 'Dimitris K.'], ['Theobald', 'Douglas L.']],
      title: 'Fast determination of the optimal rotational matrix for macromolecular superpositions',
      journal: 'Journal of Computational Chemistry', volume: '31', issue: '7', pages: '1561–1563', year: 2010, doi: '10.1002/jcc.21439'
    },
    welford1962: {
      authors: [['Welford', 'B. P.']], title: 'Note on a method for calculating corrected sums of squares and products',
      journal: 'Technometrics', volume: '4', issue: '3', pages: '419–420', year: 1962, doi: '10.1080/00401706.1962.10490022'
    },
    amadei1993: {
      authors: [['Amadei', 'Andrea'], ['Linssen', 'Antonius B. M.'], ['Berendsen', 'Herman J. C.']], title: 'Essential dynamics of proteins',
      journal: 'Proteins: Structure, Function, and Bioinformatics', volume: '17', issue: '4', pages: '412–425', year: 1993,
      doi: '10.1002/prot.340170408'
    },
    hess2002: {
      authors: [['Hess', 'Berk']], title: 'Convergence of sampling in protein simulations', journal: 'Physical Review E',
      volume: '65', issue: '3', pages: '031910', year: 2002, doi: '10.1103/PhysRevE.65.031910'
    },
    maginn2019: {
      authors: [['Maginn', 'Edward J.'], ['Messerly', 'Richard A.'], ['Carlson', 'Daniel J.'], ['Roe', 'Daniel R.'], ['Elliott', 'J. Richard']],
      title: 'Best practices for computing transport properties 1. Self-diffusivity and viscosity from equilibrium molecular dynamics [Article v1.0]',
      journal: 'Living Journal of Computational Molecular Science', volume: '1', issue: '1', pages: '6324', year: 2019,
      doi: '10.33011/livecoms.1.1.6324'
    },
    yeh2004: {
      authors: [['Yeh', 'In-Chul'], ['Hummer', 'Gerhard']],
      title: 'System-size dependence of diffusion coefficients and viscosities from molecular dynamics simulations with periodic boundary conditions',
      journal: 'The Journal of Physical Chemistry B', volume: '108', issue: '40', pages: '15873–15879', year: 2004, doi: '10.1021/jp0477147'
    },
    hall2007: {
      authors: [['Hall', 'Benjamin A.'], ['Kaye', 'Samantha L.'], ['Pang', 'Andy'], ['Perera', 'Rafael'], ['Biggin', 'Philip C.']],
      title: 'Characterization of protein conformational states by normal-mode frequencies', journal: 'Journal of the American Chemical Society',
      volume: '129', issue: '37', pages: '11394–11401', year: 2007, doi: '10.1021/ja071797y'
    },
    coifman2006: {
      authors: [['Coifman', 'Ronald R.'], ['Lafon', 'Stéphane']], title: 'Diffusion maps', journal: 'Applied and Computational Harmonic Analysis',
      volume: '21', issue: '1', pages: '5–30', year: 2006, doi: '10.1016/j.acha.2006.04.006'
    },
    ferguson2011: {
      authors: [['Ferguson', 'Andrew L.'], ['Panagiotopoulos', 'Athanassios Z.'], ['Kevrekidis', 'Ioannis G.'], ['Debenedetti', 'Pablo G.']],
      title: 'Nonlinear dimensionality reduction in molecular simulation: The diffusion map approach', journal: 'Chemical Physics Letters',
      volume: '509', issue: '1–3', pages: '1–11', year: 2011, doi: '10.1016/j.cplett.2011.04.066'
    },
    rohrdanz2011: {
      authors: [['Rohrdanz', 'Mary A.'], ['Zheng', 'Wenwei'], ['Maggioni', 'Mauro'], ['Clementi', 'Cecilia']],
      title: 'Determination of reaction coordinates via locally scaled diffusion map', journal: 'The Journal of Chemical Physics',
      volume: '134', issue: '12', pages: '124116', year: 2011, doi: '10.1063/1.3569857'
    },
    best2013: {
      authors: [['Best', 'Robert B.'], ['Hummer', 'Gerhard'], ['Eaton', 'William A.']],
      title: 'Native contacts determine protein folding mechanisms in atomistic simulations',
      journal: 'Proceedings of the National Academy of Sciences', volume: '110', issue: '44', pages: '17874–17879', year: 2013,
      doi: '10.1073/pnas.1311599110'
    },
    franklin2007: {
      authors: [['Franklin', 'Joel'], ['Koehl', 'Patrice'], ['Doniach', 'Sebastian'], ['Delarue', 'Marc']],
      title: 'MinActionPath: Maximum likelihood trajectory for large-scale structural transitions in a coarse-grained locally harmonic energy landscape',
      journal: 'Nucleic Acids Research', volume: '35', issue: 'suppl_2', pages: 'W477–W482', year: 2007, doi: '10.1093/nar/gkm342'
    },
    smith2019: {
      authors: [['Smith', 'Paul'], ['Ziolek', 'Robert M.'], ['Gazzarrini', 'Elena'], ['Owen', 'Dylan M.'], ['Lorenz', 'Christian D.']],
      title: 'On the interaction of hyaluronic acid with synovial fluid lipid membranes', journal: 'Physical Chemistry Chemical Physics',
      volume: '21', issue: '19', pages: '9845–9857', year: 2019, doi: '10.1039/C9CP01532A'
    },
    gowers2015: {
      authors: [['Gowers', 'Richard J.'], ['Carbone', 'Paola']], title: 'A multiscale approach to model hydrogen bonding: The case of polyamide',
      journal: 'The Journal of Chemical Physics', volume: '142', issue: '22', pages: '224907', year: 2015, doi: '10.1063/1.4922445'
    },
    gregoret1991: {
      authors: [['Gregoret', 'Lydia M.'], ['Rader', 'Stephen D.'], ['Fletterick', 'Robert J.'], ['Cohen', 'Fred E.']],
      title: 'Hydrogen bonds involving sulfur atoms in proteins', journal: 'Proteins: Structure, Function, and Bioinformatics',
      volume: '9', issue: '2', pages: '99–107', year: 1991, doi: '10.1002/prot.340090204'
    },
    neumann1983: {
      authors: [['Neumann', 'Martin']], title: 'Dipole moment fluctuation formulas in computer simulations of polar systems',
      journal: 'Molecular Physics', volume: '50', issue: '4', pages: '841–858', year: 1983, doi: '10.1080/00268978300102721'
    },
    kabsch1983: {
      authors: [['Kabsch', 'Wolfgang'], ['Sander', 'Christian']],
      title: 'Dictionary of protein secondary structure: Pattern recognition of hydrogen-bonded and geometrical features',
      journal: 'Biopolymers', volume: '22', issue: '12', pages: '2577–2637', year: 1983, doi: '10.1002/bip.360221211'
    },
    ramachandran1963: {
      authors: [['Ramachandran', 'G. N.'], ['Ramakrishnan', 'C.'], ['Sasisekharan', 'V.']], title: 'Stereochemistry of polypeptide chain configurations',
      journal: 'Journal of Molecular Biology', volume: '7', issue: '1', pages: '95–99', year: 1963, doi: '10.1016/S0022-2836(63)80023-6'
    },
    janin1978: {
      authors: [['Janin', 'Joël'], ['Wodak', 'Shoshanna'], ['Levitt', 'Michael'], ['Maigret', 'Bernard']],
      title: 'Conformation of amino acid side-chains in proteins', journal: 'Journal of Molecular Biology',
      volume: '125', issue: '3', pages: '357–386', year: 1978, doi: '10.1016/0022-2836(78)90408-4'
    },
    bansal2000: {
      authors: [['Bansal', 'M.'], ['Kumar', 'S.'], ['Velavan', 'R.']], title: 'HELANAL: A program to characterize helix geometry in proteins',
      journal: 'Journal of Biomolecular Structure and Dynamics', volume: '17', issue: '5', pages: '811–819', year: 2000,
      doi: '10.1080/07391102.2000.10506570'
    },
    sugeta1967: {
      authors: [['Sugeta', 'Hiromu'], ['Miyazawa', 'Tatsuo']],
      title: 'General method for calculating helical parameters of polymer chains from bond lengths, bond angles, and internal-rotation angles',
      journal: 'Biopolymers', volume: '5', issue: '7', pages: '673–679', year: 1967, doi: '10.1002/bip.1967.360050708'
    },
    chang2003: {
      authors: [['Chang', 'Chia-En'], ['Potter', 'Michael J.'], ['Gilson', 'Michael K.']], title: 'Calculation of molecular configuration integrals',
      journal: 'The Journal of Physical Chemistry B', volume: '107', issue: '4', pages: '1048–1055', year: 2003, doi: '10.1021/jp027149c'
    },
    hikiri2016: {
      authors: [['Hikiri', 'Simon'], ['Yoshidome', 'Takashi'], ['Ikeguchi', 'Mitsunori']],
      title: 'Computational methods for configurational entropy using internal and Cartesian coordinates',
      journal: 'Journal of Chemical Theory and Computation', volume: '12', issue: '12', pages: '5990–6000', year: 2016,
      doi: '10.1021/acs.jctc.6b00563'
    },
    minh2020: {
      authors: [['Minh', 'David D. L.']],
      title: 'Alchemical Grid Dock (AlGDock): Binding free energy calculations between flexible ligands and rigid receptors',
      journal: 'Journal of Computational Chemistry', volume: '41', issue: '7', pages: '715–730', year: 2020, doi: '10.1002/jcc.26036'
    },
    denning2011: {
      authors: [['Denning', 'Elizabeth J.'], ['Priyakumar', 'U. Deva'], ['Nilsson', 'Lennart'], ['MacKerell', 'Alexander D.', 'Jr.']],
      title: 'Impact of 2′-hydroxyl sampling on the conformational properties of RNA: Update of the CHARMM all-atom additive force field for RNA',
      journal: 'Journal of Computational Chemistry', volume: '32', issue: '9', pages: '1929–1943', year: 2011, doi: '10.1002/jcc.21777'
    },
    denning2012: {
      authors: [['Denning', 'Elizabeth J.'], ['MacKerell', 'Alexander D.', 'Jr.']],
      title: 'Intrinsic contribution of the 2′-hydroxyl to RNA conformational heterogeneity', journal: 'Journal of the American Chemical Society',
      volume: '134', issue: '5', pages: '2800–2806', year: 2012, doi: '10.1021/ja211328g'
    },
    altona1972: {
      authors: [['Altona', 'C.'], ['Sundaralingam', 'M.']],
      title: 'Conformational analysis of the sugar ring in nucleosides and nucleotides. A new description using the concept of pseudorotation',
      journal: 'Journal of the American Chemical Society', volume: '94', issue: '23', pages: '8205–8212', year: 1972, doi: '10.1021/ja00778a043'
    },
    hagberg2008: {
      type: 'inproceedings', authors: [['Hagberg', 'Aric A.'], ['Schult', 'Daniel A.'], ['Swart', 'Pieter J.']],
      title: 'Exploring network structure, dynamics, and function using NetworkX',
      booktitle: 'Proceedings of the 7th Python in Science Conference', editors: 'Gaël Varoquaux, Travis Vaught, and Jarrod Millman',
      pages: '11–15', address: 'Pasadena, CA', year: 2008
    }
  }

  // Library groups of the References dialog: what to cite whenever the library is used, and what
  // to add for particular analyses. `analyses` lists registry ids; `topics` covers panels that are
  // not in the registry (MONET's own analyses and the fixed ASE panels).
  const GROUPS = [
    {
      id: 'monet', title: 'MONET', engines: ['custom'],
      note: 'Cite the software (with the version shown in the title bar) and the article that introduced the decorrelation workflow; NumPy and SciPy compute MONET’s own analyses.',
      always: ['monet', 'francese2022', 'harris2020', 'virtanen2020'],
      topics: [
        { label: 'Autocorrelation, τ_int (Sokal window or Geyer sequence) and decorrelation stride', keys: ['francese2022', 'sokal1997', 'geyer1992'] },
        { label: 'Block averaging (standard error of correlated data)', keys: ['flyvbjerg1989'] },
        { label: 'RMSD and pairwise RMSD after optimal superposition (Kabsch)', keys: ['kabsch1976'] }
      ]
    },
    {
      id: 'ase', title: 'ASE', engines: ['ase'],
      note: 'Cite ASE for every analysis of the ASE tab; add the references below for the analyses you report.',
      always: ['larsen2017'],
      topics: [{ label: 'ASE › Structure: space group (spglib)', keys: ['togo2024'] }]
    },
    {
      id: 'mdanalysis', title: 'MDAnalysis', engines: ['mdanalysis'],
      note: 'MDAnalysis asks that both papers are cited whenever it is used; add the references below for the analyses you report.',
      always: ['michaud2011', 'gowers2016'],
      topics: []
    }
  ]

  // Method references of each registered analysis (monet_registry id), in addition to its library.
  const ANALYSES = {
    'ase.diffusion': [], 'ase.stored_properties': [], 'ase.bond_types': [], 'ase.molecules': [], 'ase.bond_events': [],
    'ase.rdf': [], 'ase.space_group': ['togo2024'], 'ase.dimensionality': ['larsen2019'], 'ase.layers': [],
    'ase.xrd': ['waasmaier1995'], 'ase.saxs': ['waasmaier1995'], 'ase.lattice': ['setyawan2010', 'grosse2004'], 'ase.supercell': [],
    'mdanalysis.rmsd': ['theobald2005', 'liu2010'],
    'mdanalysis.rmsd_matrix': ['theobald2005', 'liu2010'],
    'mdanalysis.rmsf': ['welford1962'],
    'mdanalysis.rgyr': [],
    'mdanalysis.pca': ['amadei1993', 'hess2002'],
    'mdanalysis.msd': ['maginn2019', 'yeh2004'],
    'mdanalysis.gnm': ['hall2007'],
    'mdanalysis.diffusionmap': ['coifman2006', 'ferguson2011', 'rohrdanz2011', 'theobald2005'],
    'mdanalysis.align': ['theobald2005', 'liu2010'],
    'mdanalysis.average_structure': ['theobald2005', 'liu2010'],
    'mdanalysis.bat': ['chang2003', 'hikiri2016', 'minh2020'],
    'mdanalysis.hbonds': ['smith2019'],
    'mdanalysis.contacts': ['best2013', 'franklin2007'],
    'mdanalysis.interrdf': [],
    'mdanalysis.com_distance': [], 'mdanalysis.min_distance': [], 'mdanalysis.atomic_distances': [], 'mdanalysis.dihedral_mda': [],
    'mdanalysis.interrdf_s': [],
    'mdanalysis.hbond_lifetime': ['smith2019'],
    'mdanalysis.hbond_autocorrel': ['gowers2015'],
    'mdanalysis.water_bridges': ['gregoret1991'],
    'mdanalysis.contact_map': [],
    'mdanalysis.lineardensity': [], 'mdanalysis.density': [],
    'mdanalysis.leaflets': ['hagberg2008'],
    'mdanalysis.persistence_length': [],
    'mdanalysis.dielectric': ['neumann1983'],
    'mdanalysis.ramachandran': ['ramachandran1963'],
    'mdanalysis.dssp': ['kabsch1983'],
    'mdanalysis.janin': ['janin1978'],
    'mdanalysis.helanal': ['bansal2000', 'sugeta1967'],
    'mdanalysis.nucleic_pairs': ['denning2011', 'denning2012'],
    'mdanalysis.nucleic_torsions': ['denning2011', 'denning2012', 'altona1972']
  }

  // ── formatting ──
  const fullName = ([family, given, suffix]) => (given ? `${given} ${family}` : family) + (suffix ? `, ${suffix}` : '')
  const invertedName = ([family, given, suffix]) => (given ? `${family}, ${given}` : family) + (suffix ? `, ${suffix}` : '')

  // Chicago (author-date): the first author inverted; with more than ten authors the first seven
  // are listed, followed by “et al.” (Chicago Manual of Style, 17th ed., 14.76).
  function chicagoAuthors (authors) {
    const list = authors.length > 10 ? authors.slice(0, 7) : authors
    const names = list.map((a, i) => (i === 0 ? invertedName(a) : fullName(a)))
    if (authors.length > 10) return `${names.join(', ')}, et al.`
    if (names.length === 1) return names[0]
    if (names.length === 2) return `${names[0]}, and ${names[1]}`
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  }

  const endDot = text => (/[.?!]$/.test(text) ? text : `${text}.`)

  // Chicago entry as [{ text, italic }] runs, so that it can be shown (italic journal) or copied as text.
  function chicagoRuns (ref) {
    const runs = [{ text: `${endDot(chicagoAuthors(ref.authors))} ${ref.year}. ` }]
    if (ref.type === 'software') {
      runs.push({ text: ref.title, italic: true }, { text: `. ${ref.version ? `Version ${ref.version}. ` : ''}${ref.publisher}.` })
    } else if (ref.type === 'inproceedings' || ref.type === 'incollection') {
      runs.push({ text: `“${endDot(ref.title)}” In ` }, { text: ref.booktitle, italic: true })
      if (ref.editors) runs.push({ text: `, edited by ${ref.editors}` })
      runs.push({ text: `${ref.series ? `, ${ref.series} ${ref.volume}` : ''}, ${ref.pages}. ` })
      runs.push({ text: [ref.address, ref.publisher].filter(Boolean).join(': ') ? `${[ref.address, ref.publisher].filter(Boolean).join(': ')}.` : '' })
    } else {
      runs.push({ text: `“${endDot(ref.title)}” ` }, { text: ref.journal, italic: true })
      runs.push({ text: ` ${ref.volume}${ref.issue ? ` (${ref.issue})` : ''}: ${ref.pages}.` })
    }
    if (ref.doi) runs.push({ text: ` https://doi.org/${ref.doi}.` })
    else if (ref.url) runs.push({ text: ` ${ref.url}.` })
    return runs.map(run => ({ ...run, text: run.text.replace(/ {2,}/g, ' ') })).filter(run => run.text)
  }

  // version: the MONET version to name (a saved session may come from another release).
  function chicago (key, { markdown = false, version = null } = {}) {
    const ref = REFERENCES[key]
    if (!ref) throw new Error(`Unknown reference ${key}.`)
    return chicagoRuns(version && ref.version ? { ...ref, version } : ref).map(run => (markdown && run.italic ? `*${run.text}*` : run.text)).join('').trim()
  }

  // BibTeX: every author, UTF-8 text, the title in braces to keep its capitals, page ranges with --.
  function bibtex (key) {
    const ref = REFERENCES[key]
    if (!ref) throw new Error(`Unknown reference ${key}.`)
    // Software is a @misc entry (plain BibTeX has no @software type); its version goes in a note.
    const type = { software: 'misc', inproceedings: 'inproceedings', incollection: 'incollection' }[ref.type] || 'article'
    const authors = ref.authors.map(([family, given, suffix]) => (given ? `${family}, ${suffix ? `${suffix}, ` : ''}${given}` : `{${family}}`)).join(' and ')
    const fields = [['author', authors], ['title', `{${ref.title}}`]]
    if (type === 'article') fields.push(['journal', ref.journal])
    if (ref.booktitle) fields.push(['booktitle', ref.booktitle])
    if (ref.editors) fields.push(['editor', ref.editors.replace(/,? and |, /g, ' and ')])
    if (ref.series) fields.push(['series', ref.series])
    if (ref.version) fields.push(['note', `Version ${ref.version}`])
    for (const name of ['volume', 'issue', 'pages', 'publisher', 'address', 'year', 'doi', 'url']) {
      const value = ref[name]
      if (value === undefined || value === null || value === '') continue
      fields.push([name === 'issue' ? 'number' : name, name === 'pages' ? String(value).replace(/[–-]/g, '--') : String(value)])
    }
    return `@${type}{${key},\n${fields.map(([name, value]) => `  ${name} = {${value}}`).join(',\n')}\n}`
  }

  const unique = keys => [...new Set(keys)]

  // References for one registered analysis spec ({ id, engine, citation }): the library group
  // (always cited), the method references, and a plugin's own free-text citation.
  function forAnalysis (spec) {
    const group = GROUPS.find(g => g.engines.includes(spec?.engine)) || GROUPS[0]
    return {
      group: group.id, title: group.title, always: group.always, specific: unique(ANALYSES[spec?.id] || []),
      citation: spec && spec.source && spec.source !== 'built-in' && spec.citation ? spec.citation : null
    }
  }

  // Reference keys of a logged step (history / methods report), or [] for steps without one.
  function forStep (step) {
    const p = step.params || {}
    let id = null
    if (step.action === 'mda_run' && p.analysis) id = `mdanalysis.${p.analysis}`
    else if (step.action === 'mda_align') id = 'mdanalysis.align'
    else if (step.action === 'run_analysis' && p.analysis) id = p.analysis
    if (id) {
      const engine = id.split('.')[0]
      const group = GROUPS.find(g => g.engines.includes(engine))
      return unique([...(engine === 'custom' ? [] : group ? group.always : []), ...(ANALYSES[id] || [])])
    }
    if (['acf', 'equilibration', 'subsample'].includes(step.action)) {
      const keys = ['francese2022']
      if (step.action === 'acf') keys.push(p.tau_int_method === 'geyer' ? 'geyer1992' : 'sokal1997', 'flyvbjerg1989')
      return keys
    }
    if (['rmsd', 'rmsd_matrix'].includes(step.action)) return ['kabsch1976']
    if (/^(ase_|bonds$|angles$|dihedrals$|pdd$|convert$|wrap$|unwrap$|select_atoms$)/.test(step.action || '')) {
      return step.action === 'ase_structure' ? ['larsen2017', 'togo2024'] : ['larsen2017']
    }
    if (/^mda_/.test(step.action || '') || step.action === 'topology') return ['michaud2011', 'gowers2016']
    return []
  }

  // One .bib file for the given keys (in that order, without repeats).
  const bibFile = keys => unique(keys).map(bibtex).join('\n\n') + '\n'

  const api = { REFERENCES, GROUPS, ANALYSES, chicago, chicagoRuns, bibtex, bibFile, forAnalysis, forStep }
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.MonetReferences = api
})(globalThis)

# MONET_Molecular_Dynamics_Extractor

The first intent of the MONET code is to be able to extract and post-process in a simple and reliable manner the trajectory of a selected set of atoms out of a trajectory file (for the moment it is compatible only with the .XYZ format from CPMD and CP2K). 

It is organized in blocks:

Block 1: it asks to select the trajectory file to process;

Block 2: it retrives the information from the file, like total # of atoms per frame and total # of configurations;

Block 2a: it asks with which frequency you want to sample the trajectory file;

Block 3: it asks if you want to compute the average structure out of the total trajectory file (NOT the sub-trajectory);

Block 4: it asks how many atom you want to extract and to enter the number of the ID atom associated with the position in the file (e.g. 1, 26, 352). These values can be found by opening the original file with a visualizer like VESTA and double-clicking on the selected atom;

Block 5: it asks if to proceed with the trajectory file extraction and subsequently it will create the folders for each frame, ranging from 1 to N, where N is equal to the # of configurations sample as defined in Block 2a from the frequency of extraction;

Block 6: finally it asks if to proceed with the formation of the correspoding Gaussian09 input files for the singlet and triplet states. 

The original idea of the code is to analyze the magnetic evolution in time of an open shell dimeric system of organic molecule-based magnets. 






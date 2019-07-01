#!/bin/bash

clear



echo " 
     __   __  _______  __    _  _______  _______ 
    |  |_|  ||       ||  |  | ||       ||       |
    |       ||   _   ||   |_| ||    ___||_     _|
    |       ||  | |  ||       ||   |___   |   |  
    |       ||  |_|  ||  _    ||    ___|  |   |  
    | ||_|| ||       || | |   ||   |___   |   |  
    |_|   |_||_______||_|  |__||_______|  |___|  
 "                                              
                
echo "           Molecular Dynamics Extractor                   
                       v: 1.0.5
   
               AUTHOR: Dr. Tommaso Francese
           
         Pritzker School of Molecular Engineering
                The University of Chicago
                Eckhardt Research Center
               5640 S. Ellis Ave. ACC 205
                   Chicago, IL  60637
                 tfrancese@uchicago.edu
                    +1-(708) 831-1732
                   +39-(346) 975-6086

                  LIST OF CONTRIBUTORS:

                Prof. Jordi Ribas Arino 
               (AVERAGE STRUCTURE MODULE)
      
         Materials Science & Physical Chemistry
                 Faculty of Chemistry
                University of Barcelona
                 c/Martí i Franquès, 1
                Barcelona, 08028, Spain
                   j.ribas@ub.edu
                  +34-(934) 034836

"
#----------------------------------------------------------
# LIST AND INPUT OF THE TRAJECTORY FILE TO PROCESS
#----------------------------------------------------------

echo -e "\x1B[31m LIST OF THE FILES IN THE CURRENT DIRECTORY:  \x1B[0m"
echo -en '\n'
ls 
echo -en '\n'

echo -e "\x1B[31m WRITE THE NAME OF THE .XYZ FILE TO PROCESS:  \x1B[0m"
echo -en '\n'
read filename
echo -en '\n'

#-------------------------------------------------------------------
# COUNTING THE NUMBER OF OCCURENCES IN THE TRAJECTORY FILE
#-------------------------------------------------------------------

while true; do

   if  grep -q "STEP =" $filename.xyz;
    then
     echo -e "\x1B[31m THIS IS A \x1B[0m\x1B[34mCPMD\x1B[0m \x1B[31mFILE ... \x1B[0m"
     op=$(grep -o 'STEP =' $filename.xyz | wc -l)
     echo -en '\n'
     echo -e "\x1B[31m TOTAL # OF CONFIGURATIONS IN THE TRAJ FILE:\x1B[0m \x1B[32m $op \x1B[0m"
     echo -en '\n'
    break
   elif  grep -q "STEP:" $filename.xyz;
    then
     echo -e "\x1B[31m THIS IS A \x1B[0m\x1B[34mCPMD\x1B[0m \x1B[31mFILE ... \x1B[0m"
     op=$(grep -o 'STEP:' $filename.xyz | wc -l)
     echo -en '\n'
     echo -e "\x1B[31m TOTAL # OF CONFIGURATIONS IN THE TRAJ FILE:\x1B[0m \x1B[32m $op \x1B[0m"
     echo -en '\n'
    break
   elif grep -q "i =" $filename.xyz;
    then
     echo -e "\x1B[31m THIS IS A \x1B[0m\x1B[34mCP2K\x1B[31m FILE ... \x1B[0m"     
     op=$(grep -o ' i =' $filename.xyz | wc -l)
     echo -en '\n'
     echo -e "\x1B[31m TOTAL # OF CONFIGURATIONS IN THE TRAJ FILE:\x1B[0m \x1B[32m $op \x1B[0m"
     echo -en '\n'
    break
   fi

done

at=$(awk 'NR==1{print $1}' $filename.xyz)

########FILE FOR AVERAGE-MD MODULE##########
cp $filename.xyz trajec.xyz
############################################

echo -e "\x1B[31m TOTAL # OF ATOMS PER CONFIGURATION:\x1B[0m \x1B[32m $at \x1B[0m"
echo -en '\n'

echo -e "\x1B[31m DEFINE THE FREQUENCY OF THE FRAME SAMPLING (e.g. 10):  \x1B[0m"
echo -en '\n'
read freq
echo -en '\n'

div=$((op / freq ))
FLDrs=$(($div + 1))

echo -e "\x1B[31m # OF CONFIGURATIONS SAMPLED:\x1B[0m \x1B[32m $FLDrs \x1B[0m"
echo -en '\n'
echo -en '\n'


#-----------------------------------------------------------------------------------
# COMPUTING THE AVERAGE STRUCTURE FROM THE ORIGINAL .XYZ FILE
#-----------------------------------------------------------------------------------

while true; do
    read -p $'\x1B[31m DO YOU WANT TO COMPUTE THE AVERAGE STRUCTURE?\x1B[0m \x1B[34m (y/n) \x1B[0m' yn
    case $yn in
        [Yy]* )
    echo -en '\n'
    echo -e "\x1B[31m ---> CREATING EXECUTABLE ... \x1B[0m"

#######################################AVERAGE STRUCTURES SCRIPT###########################

echo "program average" >> ave.f90
echo -en "\n" >> ave.f90
echo "! declare variables" >> ave.f90
echo "implicit none" >> ave.f90
echo -en "\n" >> ave.f90
echo "integer ::  natoms, natoms2" >> ave.f90
echo "integer, parameter :: nmxatm = 10000" >> ave.f90
echo -en "\n" >> ave.f90
echo "real(kind=8), dimension(nmxatm) :: x, y, z" >> ave.f90
echo "real(kind=8), dimension(nmxatm) :: xav, yav, zav" >> ave.f90
echo -en "\n" >> ave.f90
echo "character(len=2), dimension(nmxatm) :: atname" >> ave.f90
echo -en "\n" >> ave.f90
echo "integer ::  step" >> ave.f90
echo "integer ::  i, istat" >> ave.f90
echo -en "\n" >> ave.f90
echo -en "\n" >> ave.f90
echo "! open units" >> ave.f90
echo "open (unit=10, file='trajec.xyz', status='old')" >> ave.f90
echo "open (unit=11, file='GEO-AVERAGE.xyz', status='unknown')" >> ave.f90
echo -en "\n" >> ave.f90
echo "natoms = $at" >> ave.f90
echo -en "\n" >> ave.f90
echo "do i = 1,natoms" >> ave.f90
echo "  xav(i) = 0.0" >> ave.f90
echo "  yav(i) = 0.0" >> ave.f90
echo "  zav(i) = 0.0" >> ave.f90
echo "enddo" >> ave.f90
echo -en "\n" >> ave.f90
echo "! start main loop" >> ave.f90
echo "step=0" >> ave.f90
echo -en "\n" >> ave.f90
echo "do" >> ave.f90
echo -en "\n" >> ave.f90
echo "  ! ********************* !" >> ave.f90
echo "  ! read trajec.xyz file  !" >> ave.f90
echo "  ! ********************* !" >> ave.f90
echo -en "\n" >> ave.f90
echo "  read (10,*,IOSTAT=istat) natoms2" >> ave.f90
echo "  if (istat < 0) exit" >> ave.f90
echo "  read (10,*)" >> ave.f90
echo "  do i = 1,natoms" >> ave.f90
echo "    read (10,*) atname(i), x(i), y(i), z(i)" >> ave.f90
echo "    xav(i) = xav(i) + x(i)" >> ave.f90
echo "    yav(i) = yav(i) + y(i)" >> ave.f90
echo "    zav(i) = zav(i) + z(i)" >> ave.f90
echo "  enddo" >> ave.f90
echo "    step = step + 1" >> ave.f90
echo -en "\n" >> ave.f90
echo "! The following enddo closed the main loop" >> ave.f90
echo "enddo" >> ave.f90
echo -en "\n" >> ave.f90
echo "write (6,*) 'Number of configurations read', step" >> ave.f90
echo "write (11,1000) natoms" >> ave.f90
echo "write (11,1001) 'AVERAGE'" >> ave.f90
echo -en "\n" >> ave.f90
echo "do i=1,natoms" >> ave.f90
echo " xav(i) = xav(i)/step" >> ave.f90
echo " yav(i) = yav(i)/step" >> ave.f90
echo " zav(i) = zav(i)/step" >> ave.f90
echo " write (11,1002) atname(i), xav(i), yav(i), zav(i)" >> ave.f90
echo "enddo" >> ave.f90
echo -en "\n" >> ave.f90
echo "1000 format(i10)" >> ave.f90
echo "1001 format(a10)" >> ave.f90
echo "1002 format(a2,1x,3f13.7)" >> ave.f90
echo -en "\n" >> ave.f90
echo "end program average" >> ave.f90
echo -en "\n" >> ave.f90
echo -en "\n" >> ave.f90
###################################################################                                                         
echo -en '\n'
echo -e "\x1B[31m ---> COMPILING THE PROGRAM ... \x1B[0m"
echo -en '\n'
gfortran ave.f90 -o ave.exe
echo -e "\x1B[31m ---> CALCULATING THE AVERAGE STRUCTURE ... \x1B[0m"
echo -en '\n'
./ave.exe

mkdir 3-AVERAGE_STRUCTURE
rm -f ave.f90
mv ave.exe trajec.xyz GEO-AVERAGE.xyz 3-AVERAGE_STRUCTURE/
echo -en '\n'
echo -e "\x1B[31m GEO-AVERAGE.xyz COMPUTED! \x1B[0m"; break ;;

  [Nn]* ) rm -f trajec.xyz; break;; * )
 esac
done

#--------------------END OF WHILE LOOP------------------------------


#-----------------------------------------------------------------------------------------------------
# DEFINE HOW MANY STRUCTURES TO GREP                                                        
# NUMBER OF CONFIGURATIONS = (# OF ATOMS + 2[LINES] * SAMPLING FREQUENCY [DEFAULT EVERY 10] 
#-----------------------------------------------------------------------------------------------------

sugar=$(( at + 2 ))
coffee=$(($sugar * freq)) #number of atoms to skip for matching the frequency

#------------------------------
# PROCESSING TRAJECTORY FILES
#------------------------------

echo "    {n = NR%$sugar}" >> awk1.tmp  # Header generation for tmp file for TRAVIS Analyzer
echo "    {n = NR%$coffee}" >> awk2.tmp  # Header generation for tmp file for MAGN_traj file (structures sample every 10)

###############################################################################################
echo -en '\n'
echo -e "\x1B[31m HOW MANY ATOMS DO YOU WANT TO EXTRACT? \x1B[0m \x1B[34m(TO QUIT TYPE: \x1B[95mq\x1B[0m)\x1B[0m"
echo -en '\n'
read atom_number

echo -en '\n'
echo -en '\n'

echo "n == 1 {print \"$atom_number\"; next}" >> tmp.tmp
echo "n == 2 ||" >> tmp.tmp   # this is the white space needed for XYZ mol format
counter=0
read -p "ENTER THE ATOM LIST NUMBER: " v1 
while [ "$v1" != "q"  ]
do  
    printf "n == %s  ||\n" "$v1">> tmppos.tmp
    counter=$(( $counter+1))
    read -p "ENTER THE ATOM LIST NUMBER: " v1 
done

awk '{print $1, $2, $3+2, $4}' tmppos.tmp >> partial.tmp
sed '$ s/..$//' partial.tmp >> soppmt.tmp  # this command removes || from last match in file.

################################################################################################

cat tmp.tmp  soppmt.tmp   >> partial1.tmp
cat awk1.tmp partial1.tmp >> awk1_pos.awk
cat awk2.tmp partial1.tmp >> awk2_pos.awk

rm -f tmppos.tmp partial.tmp partial1.tmp

#------------------------------------------------------------------------------
# TRAJECTORY EVOLUTION IN TIME OF THE SELECTED MOLECULE (Travis Analyzer file)
#------------------------------------------------------------------------------

awk -f awk1_pos.awk $filename.xyz >> FULL_TRAJECTORY_EXTRACTED.xyz

mkdir 1-FULL_TRAJECTORY_EXTRACTED
mv FULL_TRAJECTORY_EXTRACTED.xyz 1-FULL_TRAJECTORY_EXTRACTED

#----------------------------------------------------------------------------------------------------
# MAGNETIC EVOLUTION IN TIME OF THE SELECTED MOLECULE (To be post-processed for input file creation)   
#---------------------------------------------------------------------------------------------------- 

awk -f awk2_pos.awk $filename.xyz >> SAMPLED_CONFIGURATIONS.xyz

#sed -i '1s/^/24\n i =XXXXXX\n/' SAMPLED_CONFIGURATIONS.xyz # it adds 2 fake spaces at the beginning of the file
rm -f awk1.tmp awk2.tmp soppmt.tmp

mkdir 0-HYSTORY

mv awk1_pos.awk awk2_pos.awk tmp.tmp 0-HYSTORY

#--------------------------------------------------------------------
# PROCESSING THE SAMPLED_CONFIGURATIONS.xyz FILE
#--------------------------------------------------------------------

echo -en '\n'
  read -p $'\x1B[31m EXTRACT INFO?\x1B[0m \x1B[34m (y/n) \x1B[0m'  -r
  if [[ $REPLY =~ ^[yY]$ ]]
  then
      echo -en '\n'
      echo -e "\x1B[31m PROCEEDING ... \x1B[0m"
      echo -en '\n'
  else
      echo -en '\n'
      echo -e "\x1B[31m EXITING ... \x1B[0m"
      echo -en '\n'
      exit 0
  fi

echo -e "\x1B[31m --> PROCESSING THE DIMER TRAJECTORY FILE ... \x1B[0m"

while true; do

   if  grep -q "STEP =" SAMPLED_CONFIGURATIONS.xyz;
    then
     echo -en '\n'
     echo -e "\x1B[31m EXTRACTING THE FRAMES FROM SAMPLED_CONFIGURATIONS\x1B[0m \x1B[35m (CPMD format) \x1B[0m"
     cat SAMPLED_CONFIGURATIONS.xyz | 
       awk -v RS="STEP =" 'NR > 1 { print RS $0 > "k" (NR-1); close("k" (NR-1))}'
     echo -en '\n'
    break
   elif grep -q "STEP:" SAMPLED_CONFIGURATIONS.xyz;
    then
     echo -e "\x1B[31m EXTRACTING THE FRAMES FROM SAMPLED_CONFIGURATIONS\x1B[0m \x1B[35m (CPMD format) \x1B[0m"
     cat SAMPLED_CONFIGURATIONS.xyz |
       awk -v RS="STEP:" 'NR > 1 { print RS $0 > "k" (NR-1); close("k" (NR-1))}'
     echo -en '\n'
    break
   elif grep -q "i =" SAMPLED_CONFIGURATIONS.xyz;
    then
     echo -e "\x1B[31m EXTRACTING THE FRAMES FROM SAMPLED_CONFIGURATIONS\x1B[0m \x1B[35m (CP2K format) \x1B[0m"     
     cat SAMPLED_CONFIGURATIONS.xyz |
       awk -v RS="i =" 'NR > 1 { print RS $0 > "k" (NR-1); close("k" (NR-1))}'
     echo -en '\n'
    break
   fi

done

#-----------------------------------------------------------------------
# CREATION OF THE SINGLE CONFIGURATIONS AND CORRESPONDING FOLDERS
#-----------------------------------------------------------------------

#-------------------------------------------------------------- 
#                   EXTRACTING TIMINGS 
#-------------------------------------------------------------- 

#echo -e "\x1B[31m --> EXTRACTING TIMINGS ... \x1B[0m"

# for ((i=1;i<=$FLDrs;i++));
#  do
#     sp=$(awk '{print $6}' k$i | sed 's/,//g')
#     echo "$sp    " >> time$i.txt
#   done

#-------------------------------------------------------------- 
#                   EXTRACTING POSITIONS
#--------------------------------------------------------------
 
echo -e "\x1B[31m --> EXTRACTING POSITIONS ... \x1B[0m"

######################################################################################################################

echo "" >> k$FLDrs # IT APPENDS AN EMPTY LINE TO THE LAST FILE GENERATED: IMPORTANT FOR THE CORRECT GAUSSIAN09 INPUT

#######################################################################################################################

for ((i=1;i<=$FLDrs;i++)); # IT REMOVES THE FIRST LINE AND LAST EMPTY ONE
  do
    sed -i '1d;$d' k$i 
  done

for ((i=1;i<=$FLDrs;i++)); # IT REMOVES THE LAST LINE
  do
    sed -i '$d' k$i
  done

for ((i=1;i<=$FLDrs;i++)); # IT PRINTS THE POSITIONS ON POS.TXT
  do
   cat k$i >> pos$i.txt
 done

rm -f k* *.tmp

#-------------------------------------------------------------- 
#                   CREATING FOLDERS
#--------------------------------------------------------------

echo -e "\x1B[31m --> CREATING THE CORRESPONDING FOLDERS ... \x1B[0m"

for ((i=1;i<=$FLDrs;i++));
  do
    mkdir conf$i
#     mv time$i.txt conf$i
     mv pos$i.txt conf$i
  done

mkdir 2-SAMPLED_CONFIGURATIONS
mv conf* 2-SAMPLED_CONFIGURATIONS
mv SAMPLED_CONFIGURATIONS.xyz 2-SAMPLED_CONFIGURATIONS

#-------------------------------------------------------------- 
#                   SAVING TIMINGS
#--------------------------------------------------------------

#echo -e "\x1B[31m --> SAVING TIMINGS ... \x1B[0m"

#  for d in ./2-SAMPLED_CONFIGURATIONS/
#   do (cd "$d" &&
#       for d in ./conf*/
#           do (cd "$d" &&
#               mv time* time.txt
#            );
#        done
#       );
#   done

#-------------------------------------------------------------- 
#                   DETECTING PATHS 
#--------------------------------------------------------------


####################################
echo -e "\x1B[31m --> DETECTING PATHS' FOLDERS ... \x1B[0m"
address=$PWD
####################################


#  for d in ./2-SAMPLED_CONFIGURATIONS/
#   do (cd "$d" &&
#       for d in ./conf*/
#           do (cd "$d" &&
#            cat time.txt >> $address/2-SAMPLED_CONFIGURATIONS/t.txt
#           );
#        done
#       );
#   done

 # for d in ./2-SAMPLED_CONFIGURATIONS/
 #  do (cd "$d" &&
 #     sort -k 1 -n t.txt >> T.txt
 #     rm -f t.txt
 #     nl T.txt >> TIME.txt
 #     rm -f T.txt
 #     );
 # done
echo -en '\n'
#--------------------------------------------------------------------------------
# THE SCRIPT PREPARE THE SINGLET AND TRIPLET INPUT FILES FOR GAUSSIAN09 
#--------------------------------------------------------------------------------

  read -p $'\x1B[31m PROCEED WITH GAUSSIAN09 INPUTS?\x1B[0m \x1B[34m (y/n) \x1B[0m'  -r
  if [[ $REPLY =~ ^[yY]$ ]]
  then
      echo -en '\n'
  else
      echo -en '\n'
      echo -e "\x1B[92m BYE BYE!\x1B[0m"
      exit 0
  fi

echo -e "\x1B[31m --> STARTING ... \x1B[0m"

echo -e "\x1B[31m --> CREATING THE CONFIGURATION FILES ... \x1B[0m"

for d in ./2-SAMPLED_CONFIGURATIONS/
   do (cd "$d" &&
      for d in ./conf*/;
        do (cd "$d" &&
       cp pos*.txt conf.txt
       );
 done
 );
 done

echo -e "\x1B[31m --> CREATING THE INPUTS FOR THE SINGLET AND TRIPLET ... \x1B[0m"

#################################################################
for d in ./2-SAMPLED_CONFIGURATIONS/
   do (cd "$d" &&
     for d in ./conf*/;
        do (cd "$d" && 
     touch singlet.dat       #generation of the singlet file input
echo "%nproc=6" >> singlet.dat
echo "%chk=$PWD/conf$((add++))/s0.chk" >> singlet.dat
echo "%mem=4gb" >> singlet.dat
echo "#p ub3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight gfinput gfoldprint pop=full guess=read" >> singlet.dat
echo  "$string" >> singlet.dat
echo "scf_singlet" >> singlet.dat
echo  "$string" >> singlet.dat
echo "0 1" >> singlet.dat
awk '/ /,/ /' conf.txt >> singlet.dat
echo  "$string" >> singlet.dat
     touch triplet.dat       #generation of the triplet file input
echo "%nproc=6" >> triplet.dat
echo "%chk=$PWD/conf$((add++))/t0.chk" >> triplet.dat
echo "%mem=4gb" >> triplet.dat
echo "#p ub3lyp/6-31+g(d,p) maxdisk=300gb nosymm scf=tight gfinput gfoldprint pop=full guess=read" >> triplet.dat
echo  "$string" >> triplet.dat
echo "scf_triplet" >> triplet.dat
echo  "$string" >> triplet.dat
echo "0 3" >> triplet.dat
awk '/ /,/ /' conf.txt >> triplet.dat
echo  "$string" >> triplet.dat
  
  );
 done
);
done

##################################################################

echo -e "\x1B[31m --> CHANGING PATHS ... \x1B[0m"

for d in ./2-SAMPLED_CONFIGURATIONS/
   do (cd "$d" &&
     for d in ./conf*/;
        do (cd "$d" &&
           sed -e '2d' singlet.dat | sed "/\%nproc=6/a %chk=$PWD/s0.chk" >> sing.dat
           sed -e '2d' triplet.dat | sed "/\%nproc=6/a %chk=$PWD/t0.chk" >> trip.dat
           rm -f singlet.dat
           rm -f triplet.dat
          );
       done
      );
      done

echo -en '\n'
echo -e "\x1B[32m PROCESS COMPLETE! \x1B[0m"
echo -en '\n'
echo -e "\x1B[32m GAUSSIAN09 INPUTS READY! \x1B[0m"
echo -en '\n'

exit 0

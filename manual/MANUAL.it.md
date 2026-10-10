# MONET — Manuale d’uso

*Dr. T. Francese*

MONET legge una traiettoria di dinamica molecolare, la analizza con ASE, MDAnalysis e con metodi propri, ed estrae le configurazioni che servono per i calcoli di chimica quantistica. Funziona nel browser, sul tuo computer. Questo manuale segue l’ordine in cui si lavora: **apri la traiettoria → guardala e imposta cella e asse dei tempi → analizzala (geometria, autocorrelazione, dinamica) → estrai configurazioni statisticamente indipendenti e scrivi gli input QM → conserva la registrazione di ciò che hai fatto**. Ogni passaggio ha un’immagine presa dal programma stesso.

> **Suggerimento:** il manuale è sempre disponibile dal pulsante **Manual** nella barra del titolo. Si apre in una nuova scheda, così puoi tenerlo accanto al programma. È scritto in inglese e in italiano (**EN / IT** in alto a destra nel manuale); il programma è in inglese e le immagini sono le stesse nelle due lingue.

> **Nota:** tutte le immagini usano due piccole traiettorie sintetiche, così puoi ripetere ogni passaggio: una **molecola di etanolo** (9 atomi, 1500 frame, con un transitorio iniziale e un ossidrile che ruota lentamente) e una **scatola di 64 molecole d’acqua** (192 atomi, 400 frame, periodica). Scrivile con `python tools/manual_data.py CARTELLA`. I numeri nelle immagini illustrano il programma; non sono risultati su etanolo o acqua reali.

## 1. Prima di iniziare

### 1.1 Avviare MONET

1. Installa **Python 3.10 o più recente** una volta sola ([python.org/downloads](https://www.python.org/downloads/); su Windows spunta *Add python.exe to PATH*), oppure usa conda.
2. Scarica MONET (**Code › Download ZIP** su GitHub e poi estrai tutta la cartella, oppure `git clone`).
3. Avvialo:
  - **macOS**: doppio clic su `start_monet.command` (la prima volta: clic destro › **Apri** › **Apri**).
  - **Windows**: doppio clic su `start_monet.bat` (se compare SmartScreen: **Ulteriori informazioni › Esegui comunque**).
  - **Linux**: esegui `./start_monet.command` in un terminale.
4. Il primo avvio crea un ambiente privato (la cartella `.venv`) e installa ASE, MDAnalysis, spglib e networkx (serve internet una volta, qualche minuto). Gli avvii successivi sono immediati.
5. Il browser mostra MONET all’indirizzo `http://127.0.0.1:8765`. **Tieni aperta la finestra del terminale** mentre lavori; `Ctrl+C` la ferma.

Con conda: `conda env create -f environment.yml`, `conda activate monet`, `python start_monet.py`. Se la porta è occupata aggiungi `--port 8766`. `MONET_PYTHON` sceglie un Python particolare.

Tutto gira sul tuo computer. Il servizio ascolta solo su `127.0.0.1`, chiede un token per sessione, tiene i file caricati in una cartella privata che viene cancellata quando lo fermi, e i dati della traiettoria non lasciano mai il computer (internet serve solo per installare i pacchetti Python). Una traiettoria viene caricata **una sola volta** (fino a 200 GB, `--max-upload-gb`); ogni scansione, analisi ed estrazione gira poi come lavoro in background con barra di avanzamento e pulsante **Cancel**.

> **Attenzione:** aprire direttamente `index.html` (doppio clic sul file) mostra la pagina ma **non avvia Python**: niente ASE, niente MDAnalysis, niente manuale. Avvia sempre MONET con il launcher.

### 1.2 La finestra principale

![La finestra principale di MONET con l’analisi della struttura aperta, con le aree numerate](img/window.png "La finestra principale dopo aver caricato la traiettoria dell’etanolo. 1 Barra del titolo · 2 Schede dei moduli · 3 Visualizzatore molecolare · 4 Lettore della traiettoria · 5 Schede delle analisi del modulo · 6 Asse dei tempi.")

| Numero | Area | A cosa serve |
|---|---|---|
| 1 | **Barra del titolo** | Lo stato di ASE / MDAnalysis, **Manual**, **ⓘ References** (cosa citare), **History** (registro di ogni passaggio), **☀ Day / ☾ Night**. |
| 2 | **Schede dei moduli** | **ASE**, **MDAnalysis** e **MONET Custom Functionalities**. Condividono la stessa traiettoria, lo stesso visualizzatore, la tabella degli atomi, la cella e l’asse dei tempi. |
| 3 | **Visualizzatore molecolare** | La struttura con i numeri MONET degli atomi. Un clic sceglie un atomo; i pulsanti in alto a destra orientano la vista. |
| 4 | **Lettore della traiettoria** | Riproduce la traiettoria; i grafici la seguono. |
| 5 | **Schede delle analisi** | Le analisi del modulo scelto, una per scheda. |
| 6 | **Asse dei tempi** | Passo temporale MD e numero di passi MD tra un frame salvato e l’altro. |

All’estrema sinistra il **pannello del flusso di lavoro** contiene i sette passi dell’estrazione: *01 File input · 02 Structure analysis · 03 Sampling · 04 Atom selection · 05 Options · 06 Processing · 07 Results*. Si riduce a una stretta barra mentre analizzi; **⇥** (in alto a sinistra) lo riapre e il pulsante blu **Extraction →** prosegue al passo 03.

### 1.3 Giorno e notte

![La stessa finestra in modalità notte](img/night.png "Modalità notte (predefinita se il sistema è scuro): premi ☀ Day / ☾ Night nella barra del titolo per cambiare. Grafici e immagini seguono il tema.")

La scelta è ricordata dal browser. Il manuale ha lo stesso pulsante.

## 2. Passo 1 — Apri la traiettoria

### 2.1 Aprire un file

![Il passo File input con una traiettoria caricata](img/file_input.png "Passo 01: Browse… sceglie la traiettoria; il formato viene riconosciuto automaticamente.")

1. Premi **Browse …** e scegli una traiettoria XYZ o XYZ esteso (CPMD, CP2K, ORCA, Qbox …).
2. Lascia **Input format** su *Auto-detect* (l’XYZ si legge direttamente).
3. Premi **Next →**. MONET indicizza il file, riporta il numero di configurazioni e di atomi e apre la scheda **ASE**.

I frame XYZ semplici devono avere lo stesso numero di atomi e lo stesso ordine degli elementi. Si leggono le colonne `species`/`pos` dell’XYZ esteso, `Lattice` e `pbc`; le altre colonne per atomo non vengono portate nei file estratti. Rimuovi la traiettoria con **× Remove** se hai scelto il file sbagliato.

### 2.2 Altri formati

![Scegliendo un file GROMACS XTC compare il campo della struttura di riferimento](img/import_formats.png "Scegliendo un formato senza nomi degli elementi (qui GROMACS XTC) compare il file in più che serve: la struttura di riferimento o la topologia.")

Gli altri formati vengono importati con ASE o MDAnalysis e scritti come XYZ esteso, poi trattati come ogni file XYZ:

| Formato | Cosa aggiungere |
|---|---|
| VASP XDATCAR, OUTCAR, `vasprun.xml`, POSCAR/CONTCAR; output di Quantum ESPRESSO `pw.x`; output ORCA; output Qbox; dump LAMMPS; ASE `.traj`; CIF; output Gaussian | niente (tramite ASE) |
| Quantum ESPRESSO `cp.x` `.pos` (+ `.cel`); CP2K DCD; CPMD `TRAJECTORY` | una **struttura di riferimento** con lo stesso ordine degli atomi (qualsiasi file leggibile da ASE o MDAnalysis, per esempio il primo frame in XYZ); per `.cel` indica se i vettori del reticolo sono le righe o le colonne |
| GROMACS XTC, TRR; CHARMM/NAMD DCD; AMBER NetCDF | una **topologia** (GRO, PDB, TPR, PSF, PRMTOP …) come struttura di riferimento. Senza di essa ogni atomo è l’elemento **X**: distanze, angoli, diedri, RMSD, MSD e unwrapping funzionano ancora, le analisi per elemento no (un avviso lo segnala). |
| GROMACS GRO, PDB multi-modello, ogni altro formato letto da MDAnalysis | niente |

Per una traiettoria XYZ puoi aggiungere un **cell file** (facoltativo): un CIF, POSCAR o PDB dà una cella fissa a tutti i frame; un `.cell` di CP2K o un `.cel` di cp.x dà una cella per passo (NPT). Ogni file scelto ha un pulsante **×** per rimuoverlo. L’elenco *All ASE-readable formats* nel menu dei formati contiene tutti gli altri formati che la tua installazione di ASE sa leggere. L’importazione richiede il launcher.

### 2.3 Controlla che gli atomi siano gli stessi ovunque

Lo stesso atomo ha lo stesso numero in tutti i moduli: **MONET ID** (visualizzatore, estrazione, input QM) = indice ASE + 1 nel file originale = `id` di MDAnalysis. Dopo un’estrazione si mantengono gli ID del file originale. Quando una traiettoria è caricata, *MDAnalysis › Topology & consistency* confronta ciò che leggono MONET, ASE e MDAnalysis (numero, elementi, coordinate del primo frame) e segna in rosso ogni discrepanza.

![La scheda Topology and consistency per la scatola d’acqua](img/mda_topology.png "MDAnalysis › Topology & consistency: i tre programmi concordano su 192 atomi; MDAnalysis ha trovato 64 residui con il nome della formula (H2O1, H2O2 …) e 128 legami.")

Per i file XYZ ogni molecola legata diventa un residuo con il nome della sua formula, quindi funzionano selezioni come `resname H2O`.

## 3. Passo 2 — Guarda la struttura e imposta cella e asse dei tempi

### 3.1 Il visualizzatore

![Il visualizzatore della scatola d’acqua con gli strumenti di orientamento](img/viewer_tools.png "Il visualizzatore: x y z (e a b c) guardano lungo un asse, ⊹ axes mostra gli assi di orientamento, ▣ cell mostra la cella, ⛶ espande il visualizzatore. Sotto, il lettore della traiettoria.")

* **Balls & sticks, Sticks, Space-filling, Lines, Points** e la dimensione del visualizzatore (Compact, Large, Full height) sono nei menu sopra il visualizzatore; **Fit view** ripristina l’orientamento.
* **Trascina** per ruotare, **trascina con il tasto destro** o **Maiusc+trascina** per spostare, la **rotella** per ingrandire. Un clic su un atomo lo sceglie; gli atomi scelti sono dorati, con un numero che indica l’ordine.
* **x y z** guardano lungo quell’asse cartesiano (un secondo clic guarda dall’altro lato); con una cella, **a b c** fanno lo stesso lungo i vettori della cella. **⊹ axes** mostra o nasconde gli assi nell’angolo; **▣ cell** mostra o nasconde il riquadro della cella (solo visualizzazione: le analisi usano comunque la cella). **⛶** espande il visualizzatore a tutta finestra (Esc lo riporta indietro).
* I sistemi grandi restano fluidi: sopra 2.500 atomi il visualizzatore disegna linee mentre ruoti.

### 3.2 Scegliere gli atomi

Clicca gli atomi nell’ordine che serve all’analisi: 2 per un legame, 3 per un angolo (quello di mezzo è il vertice), 4 per un diedro in ordine di legame. Una riga della tabella degli atomi sotto il visualizzatore sceglie lo stesso atomo. **Use selection for** scrive le scelte nel campo dell’analisi che indichi; se le scelte non sono già gruppi legati, MONET trova ogni legame, angolo o diedro tra di esse.

![Il menu del clic destro su un atomo](img/selection_menu.png "Clic destro su un atomo (o su una riga della tabella): selezionalo, la sua molecola, i vicini legati, gli atomi entro R Å o tutti gli atomi del suo elemento; estendi, inverti o cancella la selezione; centra la vista.")

Sotto il visualizzatore, **Find bonded chains by element** elenca ogni legame, angolo o diedro che corrisponde a un modello come `O H`, `H O H` o `C C O H` (`*` è un elemento qualsiasi) e riempie gli input di geometria o autocorrelazione. **Select with MDAnalysis syntax** (per esempio `resname H2O and element O`) riempie la scelta da una selezione di MDAnalysis.

### 3.3 Cella e condizioni periodiche

![Il pannello Crystal cell](img/cell_panel.png "Crystal cell and periodic boundaries: viene mostrata la cella sorgente del file; puoi anche scrivere a, b, c, α, β, γ, leggere un CIF o un POSCAR e scegliere le direzioni periodiche.")

Apri **Crystal cell and periodic boundaries**. Una cella che arriva con la traiettoria (`Lattice=` dell’XYZ esteso, o un cell file dato all’importazione) viene mostrata e usata così com’è. Per usarne un’altra scegli il sistema cristallino, scrivi a, b, c in Å e α, β, γ in gradi, spunta le direzioni periodiche e premi **Apply cell**; **Read cell from XYZ**, **Load cell from file (CIF …)** e **Use source cell** fanno ciò che dicono.

La casella **minimum-image** sotto di essa controlla legami, distanze, angoli, diedri e selezione delle molecole periodici. Applicare una cella o cambiare questa casella cancella le analisi precedenti, così le geometrie non si mescolano mai. La convenzione della cella è *a lungo x, b nel piano xy*: le tue coordinate cartesiane non vengono né ruotate né scalate.

### 3.4 L’asse dei tempi

Nella riga **Time axis** scrivi il **passo temporale MD** (fs, unità atomiche o ps) della tua simulazione e il numero di **passi MD tra un frame salvato e l’altro**. MONET non assume nulla: MSD, VDOS e autocorrelazione restano disabilitati, e il campo diventa rosso, finché non indichi il passo temporale. Nelle immagini il passo è 0,5 fs e un frame è salvato ogni 20 passi, quindi due frame consecutivi distano 10 fs. Tutte le copie di questo campo (nei pannelli ACF, MSD, VDOS e fluttuazioni) condividono lo stesso valore.

### 3.5 Il lettore

![Il lettore della traiettoria](img/player.png "Il lettore: primo, precedente, Play, successivo, ultimo e uno slider; Step mostra un frame ogni n; Speed in fps; loop; Cell display riporta nella cella molecole o atomi solo per la visualizzazione; centre selection.")

Spazio avvia e ferma, ←/→ avanzano di un frame (il visualizzatore deve avere il focus). Durante la riproduzione un cursore tratteggiato segue il frame mostrato sulle serie temporali di RMSD, legami, angoli, diedri e MDAnalysis, e un clic su uno di quei grafici salta a quel frame. Con 2, 3 o 4 atomi scelti, la distanza, l’angolo o il diedro del frame mostrato si aggiorna in tempo reale.

## 4. Il modulo ASE

Il modulo ASE contiene struttura, geometria e le analisi della libreria ASE. Ogni scheda ha i propri **Clear analysis**, **Download plot PNG** (larghezza 2400 px, nel tema corrente) e **Download data CSV**; **Clear all analyses** svuota tutto e mantiene traiettoria e impostazioni.

### 4.1 Struttura

![La scheda Structure per la scatola d’acqua](img/structure_result.png "Analyse structure: formula, massa, centro di massa, inerzia, cella, densità, distanze minime, legami per coppia di elementi, numeri di coordinazione e gruppo spaziale (spglib).")

Scegli il **Frame** e premi **Analyse structure**.

### 4.2 Lunghezze di legame

![Lunghezze di legame della molecola di etanolo](img/bonds_result.png "Bond Lengths: C–C, C–O e O–H dell’etanolo lungo la traiettoria, con media ± DS in legenda e la distribuzione sotto il grafico.")

Scrivi coppie di MONET ID (`1 2  2 3  3 4`, separate da due spazi) oppure scegli gli atomi nel visualizzatore e premi **Use selection**, imposta il **Frame step** e premi **Compute**. La legenda mostra la media e la **deviazione standard della distribuzione**, che non è l’errore della media. Sotto ogni serie temporale un secondo grafico dà la distribuzione di probabilità, con un fit facoltativo (gaussiana, lorentziana, pseudo-Voigt, von Mises o due gaussiane, su tutti i bin o su un intervallo) e i suoi parametri con errori; *Show → dot histogram* impila un punto per frame.

### 4.3 Angoli di legame

![Angoli di legame dell’etanolo](img/angles_result.png "Bond Angles: C–C–O e C–O–H dell’etanolo.")

Gruppi di tre ID; l’atomo di mezzo è il vertice (`1 2 3  2 3 4`). L’intervallo è il solito 0–180°, oppure 0–360° con una normale di riferimento, oppure un intervallo ripiegato; cambiarlo cancella il risultato, quindi ricalcola.

### 4.4 Angoli diedri

![La torsione del gruppo ossidrile dell’etanolo](img/dihedrals_result.png "Dihedral Angles: la torsione C–C–O–H, nell’intervallo 0–360°. Media e deviazione standard sono circolari (R è la lunghezza media risultante); la nota aggiunge l’errore standard della media corretto per la correlazione dei frame (N_eff, τ_int).")

Gruppi di quattro ID in ordine di legame; i due atomi centrali definiscono l’asse. **Angle range**: 0–360° (ASE), oppure ripiegato in −90…+90° o 0…180° quando orientazioni equivalenti non vanno distinte. Scegli un intervallo ripiegato il cui bordo sia lontano dai tuoi valori. **Show → polar plot** disegna l’istogramma circolare in stile PCCP (punti impilati o indice del frame) con la media circolare di ogni serie e **Reference** facoltativi.

### 4.5 Distanze tra coppie

![Istogramma delle distanze O–O](img/pdd_result.png "Pair Distances: un istogramma di conteggi (non un g(r) normalizzato) delle distanze tra gli atomi scelti, da 0,5 Å a Rmax, eventualmente limitato a una coppia di elementi come O O.")

Per un g(r) normalizzato usa la scheda **RDF** di MONET Custom Functionalities (sezione 5.6).

### 4.6 Coordinazione

![Numeri di coordinazione lungo la traiettoria](img/coordination_result.png "Coordination: i vicini di ogni atomo entro i raggi covalenti di ASE (× il cutoff dei legami del visualizzatore) in ogni frame analizzato: la media per elemento e i primi otto atomi.")

### 4.7 Convert e wrap

![La scheda Convert / Wrap](img/convert_panel.png "Convert / Wrap: scegli un file di input, il formato di uscita e il nome del download; sotto, unwrap o wrap della traiettoria attiva.")

* **Convert**: **Browse …** per il file di input, scegli l’**Output format** (XYZ esteso, XYZ, VASP, CIF, LAMMPS data, FHI-aims, Turbomole, input Gaussian, DFTB+ o JSON), imposta il nome del download e premi **Convert**. *Convert first frame only* è attivo per default, per i formati che contengono una sola struttura; toglilo per l’XYZ esteso o il JSON con più frame. Per un XYZ semplice puoi applicare la cella cristallina della sezione 3.3. VASP richiede una cella completa e Quantum ESPRESSO non è offerto perché qui non si raccolgono gli pseudopotenziali.
* **Unwrap and download** dà percorsi atomici continui. **Wrap and download** porta nella cella *molecole intere* (ricostruite attraverso il bordo) o *atomi*, se vuoi centrati sugli atomi scelti: utile prima degli input QM periodici.

### 4.8 More analyses

![ASE More analyses](img/ase_more.png "ASE › More analyses: molecole e specie per frame, con le altre analisi ASE integrate nel menu.")

L’ultima scheda contiene altre analisi della libreria ASE: autodiffusione per elemento, energie, forze, temperatura e pressione memorizzate nel file, legami, angoli e diedri per tipo, molecole e specie, legami formati e rotti, RDF, gruppo spaziale, dimensionalità, strati, XRD di polveri e SAXS, reticolo di Bravais e cella di Niggli, traiettoria di supercella, volume e densità della cella. Scegline una nel menu, compila i campi (**← picked** inserisce gli atomi scelti nel visualizzatore) e premi **Compute**. Qui compaiono anche i plugin (sezione 10).

## 5. MONET Custom Functionalities

Sono le analisi proprie di MONET. La prima scheda, **3D viewer & extraction**, serve al flusso di estrazione (sezione 8); le altre analizzano la traiettoria.

### 5.1 Autocorrelazione e passo di decorrelazione

![Autocorrelazione della torsione dell’ossidrile](img/acf_result.png "Autocorrelation: C(t) del diedro (blu) e il suo fit (rosso tratteggiato); t* (oro tratteggiato) è dove il fit raggiunge il plateau. Sotto il grafico, il block averaging dell’errore standard.")

È il cuore del flusso di lavoro: configurazioni più vicine nel tempo del tempo di correlazione portano la stessa informazione, quindi *ogni quanto campionare* si decide qui.

1. Imposta l’asse dei tempi (sezione 3.4).
2. Scegli una **Quantity** (diedro, angolo di legame, lunghezza di legame o RMSD), scrivi i **MONET ID** (più gruppi vengono mediati) e premi **Compute ACF**.
3. Leggi il riquadro sopra il grafico: τ dal fit (exp(−t/τ), qui 727 ± 14 fs), il τ_int integrato con errore e finestra, media ± DS, N_eff e la **lunghezza della corsa in unità di τ**. Sotto 20 τ MONET avvisa, sotto 50 τ nota che τ e il passo sono approssimati (qui la corsa è 20,6 τ).
4. Il riquadro verde **convalida il plateau**: t* = τ·ln(1/ε) (3,0 τ per ε = 5 %) è disegnato sul grafico. Confrontalo con la curva, cambia ε, scrivi τ o t* a mano se serve.
5. **Accept t\* and build the uncorrelated trajectory** scrive un XYZ esteso con un frame ogni ⌈t*/Δt⌉ frame salvati (qui uno ogni 218 frame: 7 configurazioni); ogni riga di commento conserva `source_frame=<indice>` della corsa originale. Con *analyse it in MONET right away* diventa la traiettoria attiva per tutte le analisi e per l’estrazione. **↩ Full trajectory** (intestazione del modulo) torna indietro. **Only set the sampling frequency** copia il passo nel passo 03 e mantiene la traiettoria completa.

Altre scelte: *Correlation* lineare o circolare (per gli angoli), *Dihedral range* 0–360° o ripiegato 0–180°, *Fit model* con o senza plateau, *Fit up to*, *τ_int estimator* (finestra di Sokal per default, Geyer, o primo passaggio per zero), *Max lag*. Trascina sul grafico per ingrandire, doppio clic per mostrare tutto. Il grafico di *block averaging* (Flyvbjerg–Petersen) mostra l’errore standard in funzione della lunghezza del blocco; un plateau significa che la barra d’errore è affidabile, e la nota sotto i pulsanti dice quando non c’è.

![Detect equilibration](img/equilibration_result.png "Detect equilibration (Chodera 2016): N_eff in funzione dell’inizio della produzione t₀; il valore massimo (oro) è dove inizia la produzione. Qui il transitorio iniziale viene scartato fino a 2.750 fs.")

**Detect equilibration** calcola N_eff(t₀) per punti di partenza nella prima metà della corsa. Il valore massimo è l’inizio della produzione; **✂ Use the production window from t₀** lo scrive come nuova traiettoria attiva (`source_frame` si conserva e ↩ Full trajectory torna indietro). Se non trova un transitorio lo dice e tiene tutta la corsa.

### 5.2 Fluttuazioni e tendenze

![Fluttuazioni dei legami dell’etanolo](img/fluct_result.png "Fluctuations & trends: la DS di ogni legame (barre e tabella). La tabella dà media, DS, minimo, massimo, intervallo 5–95 %, tendenza con errore e R², deriva tra le due metà, errore a blocchi e frequenza dominante.")

Scegli cosa mappare (**legami, angoli, diedri o atomi**), gli elementi (tutti quelli trovati dalla connettività del primo frame tra gli atomi indicati, oppure solo i gruppi che scrivi) e premi **Compute**. Una tendenza è marcata *significant* solo se le cinque medie a blocchi seguono una retta oltre tre volte l’errore della sua pendenza; le oscillazioni rapide non vengono scambiate per deriva. **Colour and bars by** DS, intervallo, |tendenza|, |deriva|, frequenza o media colora i valori sulla molecola; le **frecce di vibrazione** e gli **ellissoidi di spostamento** (50, 90 o 99 %) mostrano come si muovono gli atomi. Un clic su una riga disegna la sua serie temporale con media, ±DS e retta di tendenza. *Download statistics CSV* salva la tabella.

### 5.3 RMSD (Kabsch)

![RMSD della traiettoria dell’etanolo](img/rmsd_result.png "RMSD (Kabsch): spostamento dal frame di riferimento, qui con l’allineamento di Kabsch attivo; sotto la distribuzione.")

Spostamento cartesiano grezzo dal frame di riferimento (per default il primo); l’**allineamento di Kabsch** elimina traslazione e rotazione, **Unwrap PBC** serve per le corse periodiche. Atomi: quelli che scrivi o scegli (vuoto = tutti).

### 5.4 Matrice RMSD

![Matrice RMSD a coppie](img/rmsdmatrix_result.png "RMSD Matrix: l’RMSD tra ogni coppia di frame analizzati. I blocchi lungo la diagonale sono stati distinti; valori bassi lontano dalla diagonale significano che il sistema rivisita uno stato.")

Fino a 3000 frame; usa un passo vicino al passo di decorrelazione per confrontare configurazioni non correlate. Scegli la mappa di colori, l’origine e un titolo sotto il grafico. La stessa matrice esiste in MDAnalysis (`DistanceMatrix`).

### 5.5 Asse dei tempi per MSD, VDOS e ACF

MSD, VDOS e autocorrelazione richiedono il **passo temporale MD** e i **passi MD per frame salvato** (sezione 3.4); ogni pannello mostra in alto gli stessi campi.

### 5.6 RDF

![Funzione di distribuzione radiale O–O dell’acqua](img/rdf_result.png "RDF: g(r) della coppia O–O della scatola d’acqua; il primo picco è il primo guscio di coordinazione. Serve una cella periodica; Rmax è limitato a metà della larghezza minima della cella.")

Scrivi una coppia di elementi (`O O`, `O H`, vuoto = tutti gli atomi), eventualmente limitala a certi MONET ID e premi **Compute RDF**. **Plot** passa tra g(r) e il numero di coordinazione cumulato n(r). A differenza di *Pair Distances*, g(r) → 1 per un liquido non correlato.

### 5.7 MSD e diffusione

![Spostamento quadratico medio dell’acqua](img/msd_result.png "MSD / Diffusion: MSD(t) dell’intero sistema, di O e di H, e il fit lineare (oro tratteggiato). D = pendenza / 6, in cm²/s e Å²/fs.")

Le posizioni vengono unwrappate con passi a minima immagine (tieni il passo tra frame abbastanza piccolo da far muovere gli atomi meno di mezza cella tra un frame e l’altro), la deriva del centro di massa può essere rimossa e l’MSD è mediato su tutte le origini dei tempi. Cambia la **finestra del fit** (10–50 % dell’intervallo dei lag per default) e leggi D per la selezione e per elemento.

### 5.8 VDOS

![Densità degli stati vibrazionali dell’etanolo](img/vdos_result.png "VDOS: la trasformata di Fourier delle velocità alle differenze finite (finestra di Hann, ponderazione per massa e lisciatura facoltative), normalizzata ad area unitaria. Vengono mostrati il limite di Nyquist e la risoluzione.")

Salva i frame a ogni passo MD, o ogni pochi passi, per avere alte frequenze accurate; la frequenza massima e la risoluzione derivano dall’asse dei tempi.

## 6. Il modulo MDAnalysis

### 6.1 Eseguire un’analisi

![Il modulo delle analisi MDAnalysis con i campi dei legami a idrogeno](img/mda_form.png "MDAnalysis › Analyses: scegli l’analisi nel menu; compaiono i suoi campi. ⓘ Cite mostra i suoi riferimenti.")

La scheda *Analyses* esegue MDAnalysis sulla stessa traiettoria, cella, passo tra frame e MONET ID. Le selezioni usano il linguaggio di MDAnalysis (`id` è il MONET ID, `index` la posizione da 0, `resname H2O`, `around 3.5 …`); **← picked** inserisce gli atomi scelti nel visualizzatore. Premi **Compute**.

![RMSD dal modulo MDAnalysis](img/mda_rmsd.png "rms.RMSD: RMSD dopo sovrapposizione ottimale, con gruppi extra misurati dopo lo stesso fit.")

![RMSF dal modulo MDAnalysis](img/mda_rmsf.png "rms.RMSF: fluttuazione quadratica media di ogni atomo.")

![Analisi delle componenti principali](img/mda_pca.png "PCA: la varianza di ogni componente, le proiezioni e le configurazioni scelte per finestra di proiezione, estremi o elenco di frame, che si possono scrivere come traiettoria per l’estrazione.")

![Legami a idrogeno nella scatola d’acqua](img/mda_hbonds.png "HydrogenBondAnalysis: legami a idrogeno per frame (cutoff D–A 3 Å, angolo D–H–A 150°) e la tabella delle occupazioni con i MONET ID.")

### 6.2 Cosa è disponibile

| Gruppo | Analisi |
|---|---|
| Struttura e dinamica | RMSD, matrice RMSD a coppie, RMSF, raggio di girazione, PCA (con contenuto in coseno), EinsteinMSD, GNM, diffusion map, traiettoria allineata, struttura media, coordinate legame–angolo–torsione |
| Interazioni e distanze | legami a idrogeno, loro vita media e autocorrelazione, ponti d’acqua, contatti, mappa dei contatti, InterRDF e RDF per sito, distanze tra centri di massa e minime, distanze atomiche, diedri |
| Densità | densità lineare, griglia di densità (OpenDX) |
| Membrane, polimeri, dielettrici | foglietti, lunghezza di persistenza, costante dielettrica (servono le cariche) |
| Proteine | Ramachandran, DSSP, Janin χ1/χ2, geometria dell’elica |
| Acidi nucleici | distanze tra basi appaiate, torsioni dello scheletro e pucker dello zucchero |

Non inclusi: `encore`, `psa`, `waterdynamics` (deprecati), `hole2` e `legacy.x3dna` (programmi esterni).

## 7. Uno studio completo, passo per passo

L’ordine seguente è quello raccomandato in `docs/md-analysis-workflow.md`, che riporta la letteratura dietro ogni passo.

1. **Apri** la traiettoria (sezione 2). In *MDAnalysis › Topology & consistency* controlla che gli atomi concordino.
2. **Cella e asse dei tempi** (sezioni 3.3, 3.4). Senza di essi MSD, VDOS e autocorrelazione sono disabilitati.
3. **Guarda** la struttura e riproduci la traiettoria (sezione 3). Controlla che le molecole non siano spezzate e la cella sia giusta.
4. **È equilibrata?** *Autocorrelation › Detect equilibration* (sezione 5.1), oppure il grafico di un’osservabile lenta (un diedro, l’RMSD, l’energia in *ASE › More analyses › Values stored in the file*). Usa la finestra di produzione.
5. **Quanto è correlata?** Calcola l’ACF di una coordinata lenta e leggi τ, τ_int e la lunghezza della corsa in τ. Controlla che la corsa sia almeno 20–50 τ.
6. **Geometria e fluttuazioni** (sezioni 4.2–4.4, 5.2) sulla corsa a piena risoluzione.
7. **Struttura e dinamica**: RDF, MSD, VDOS, analisi di MDAnalysis.
8. **Costruisci la traiettoria non correlata** (*Accept t\**), poi **estrai** e scrivi gli input QM su di essa (sezione 8): le configurazioni sono statisticamente indipendenti.
9. **Conserva la registrazione**: *History › Save session* (sezione 9) dà `methods.md` e `replay.py`; *ⓘ References* elenca cosa citare.

## 8. Estrazione e input di chimica quantistica

**Extraction →** (barra laterale, intestazione ASE o passo 02) prosegue al flusso di estrazione.

### 8.1 3D viewer & extraction

![Il visualizzatore 3D del flusso di estrazione](img/view3d.png "MONET Custom Functionalities › 3D viewer & extraction, con il pannello del flusso a sinistra: gli stessi strumenti del visualizzatore del modulo ASE.")

### 8.2 Passo 03 — Sampling

![Il passo Sampling](img/sampling.png "Sampling: una configurazione ogni N frame. Viene mostrato il numero di configurazioni campionate.")

Scrivi la **frequenza di campionamento**. Se hai costruito una traiettoria non correlata è già 1 e il pannello dice quale traiettoria viene usata. Altrimenti usa il passo suggerito dall’autocorrelazione (**Use as sampling frequency**).

### 8.3 Passo 04 — Atom selection

![Il passo Atom selection](img/atom_selection.png "Atom selection: clicca gli atomi nel visualizzatore, oppure scrivi i MONET ID e premi Apply. Gli atomi scelti sono dorati; la tabella li elenca con le coordinate.")

Scegli gli atomi da estrarre (clic, ID, oppure **Use atoms picked in the ASE analysis**). La barra degli strumenti ha *element, All, Invert, + Bonded, + Molecules, + Within R*.

### 8.4 Passo 05 — Options e codici di chimica quantistica

![Il passo Options](img/options.png "Options: struttura media e input di chimica quantistica. Gli stati elettronici (carica e molteplicità) sono condivisi da tutti i codici.")

Spunta **Compute average structure** per `GEO-AVERAGE.xyz` (tutti gli atomi, tutti i frame, media cartesiana). Per ogni configurazione MONET può scrivere gli input per **Gaussian, ORCA, Quantum ESPRESSO pw.x, VASP, CP2K e Qbox**. Imposta la **carica** e le **molteplicità** (un file per molteplicità: 1 → `sing`, 2 → `doub`, 3 → `trip` …).

![Le schede dei codici di chimica quantistica](img/qm_codes.png "Ogni codice ha la sua scheda: tipo di calcolo, metodo o funzionale, base o cutoff, dispersione, solvente, punti k e pseudopotenziali, parole chiave extra e una Preview della configurazione 1.")

* Ogni scheda può cambiare carica e molteplicità, mostrare una **Preview** del file della configurazione 1 e **Edit templates**; un file modificato è marcato *custom template*.
* Gaussian e ORCA non richiedono una cella. I codici a onde piane (QE, VASP, CP2K, Qbox) ne richiedono una, in questo ordine di priorità: il flag *Isolated system: vacuum box* della scheda, la cella personalizzata della scheda, la cella cristallina dell’analisi della struttura, il reticolo di ciascun frame. Senza cella la riga di stato offre **Define cell…**.
* **Build POTCAR** di VASP legge la tua libreria di POTCAR; MONET non distribuisce mai i file POTCAR.

### 8.5 Passi 06 e 07 — Processing e Results

![Processing](img/processing.png "Processing: avanzamento e registro; Cancel ferma l’estrazione. Al termine, Download results ZIP.")

![Results](img/results.png "Results: il riepilogo e l’albero delle cartelle. Nel browser i risultati sono un unico file ZIP.")

L’albero di uscita è `0-HISTORY/run.json`, `1-FULL_TRAJECTORY_EXTRACTED/` (atomi scelti, ogni frame), `2-SAMPLED_CONFIGURATIONS/` (`SAMPLED_CONFIGURATIONS.xyz`, `confN/posN.txt` e gli input: Gaussian in `confN/`, gli altri in `confN/orca/`, `confN/qe/`, `confN/vasp/`, `confN/cp2k/`, `confN/qbox/`) e `3-AVERAGE_STRUCTURE/GEO-AVERAGE.xyz`. **ASE Analysis →** torna alle analisi sulla traiettoria estratta.

## 9. Cronologia, console e rapporti

MONET tiene un registro di ogni passaggio che cambia un risultato: il file e il suo SHA-256, la cella e l’asse dei tempi, ogni analisi con i suoi parametri e i numeri chiave, le traiettorie derivate e le esportazioni. Ruotare la vista o cambiare i colori non viene registrato. Il registro resta sul tuo computer (`~/.monet/sessions/`) e memorizza i nomi dei file, mai i percorsi.

![La console del cassetto History](img/history_console.png "History › Console (Ctrl+`): ogni passaggio è una chiamata, per esempio acf(quantity=dihedral, groups=[[1, 2, 3, 4]], …). Clicca una riga, modificala e premi Invio per rieseguirla; help() elenca le analisi.")

![Il registro della cronologia](img/history_log.png "History › History: filtri, dettagli di ogni passaggio e dei suoi genitori, una nota e un segno ☆ final. History: on / paused ferma e riprende la registrazione.")

* **Save session** scrive uno ZIP con `session.json`, `methods.md` (e `methods.docx` se è installato pandoc: versioni del software con citazioni, checksum, passaggi e una lista di controllo già compilata) e `replay.py`.
* **Open session** ripristina un registro in sola lettura (non riesegue mai nulla) e avvia una copia che non sovrascrive l’originale; carica la traiettoria con lo stesso SHA-256 per continuare.
* `python replay.py --monet /percorso/di/MONET` riesegue ogni passaggio senza la finestra e confronta i numeri chiave con quelli registrati (`OK`, `DIFF`, oppure `RAN` quando non c’è nulla di grezzo da confrontare).

![La finestra References](img/references.png "ⓘ References: cosa citare per MONET, ASE, MDAnalysis e ogni analisi usata, in Chicago o BibTeX, con Copy e Download .bib.")

## 10. Aggiungere analisi proprie (plugin)

Un’analisi è una funzione Python con il decoratore `@analysis`. MONET costruisce il modulo, controlla i valori, la esegue nel worker Python, disegna il risultato e lo registra. Salva questo come `~/.monet/plugins/end_to_end.py` e riavvia il launcher:

```python
import numpy as np
from monet_registry import Param, analysis, series

@analysis('end_to_end', engine='custom', label='End-to-end distance',
          description='Distance between the first and the last atom of each pair, in every analysed frame.',
          params=[Param.groups('pairs', 'Pairs of MONET IDs', width=2)])
def end_to_end(ctx, p):
    data = ctx.frames()
    values = {}
    for a, b in p['pairs']:
        values[f'{a + 1}–{b + 1}'] = np.linalg.norm(data.positions[:, b] - data.positions[:, a], axis=1)
    return series(data.frames, values, y_label='Distance (Å)')
```

![Un plugin in More analyses](img/plugin_result.png "MONET Custom Functionalities › More analyses: il plugin del raggio di girazione fornito con MONET, eseguito sulla scatola d’acqua. I plugin dei tre motori (ase, mdanalysis, custom) compaiono nella scheda del loro modulo.")

I plugin si leggono da `plugins/`, `~/.monet/plugins/`, dalle cartelle di `MONET_PLUGINS` e dai pacchetti installati; girano con i tuoi diritti di utente, quindi usa solo codice di cui ti fidi. Il riferimento completo è `docs/plugins.md`.

## 11. Lavorare con un assistente AI (MCP)

`monet_mcp.py` collega MONET agli assistenti che parlano il Model Context Protocol (Claude Desktop, Claude Code, Gemini CLI): chiedi in linguaggio naturale di aprire una traiettoria, eseguire un’analisi o scrivere una traiettoria derivata. Gira sul tuo computer, legge solo le cartelle che permetti (`--data`) e scrive solo in `--output`. Installa l’SDK con `.venv/bin/python -m pip install "mcp>=1.2"` e segui `docs/mcp.md`. I risultati degli strumenti vanno al fornitore del tuo assistente come qualsiasi contenuto di una chat.

## 12. Risoluzione dei problemi

| Problema | Cosa fare |
|---|---|
| Il badge ASE nella barra del titolo non mostra la versione di ASE | Usa il launcher (non `index.html`); premi **Recheck**; se la connessione è persa, ferma il launcher e riavvialo. |
| *Cannot start MONET* / porta occupata | Avvia con `--port 8766` (o un’altra porta libera). |
| macOS o Windows blocca il launcher | macOS: clic destro › **Apri**; Windows: **Ulteriori informazioni › Esegui comunque**. |
| MSD, VDOS o autocorrelazione sono disabilitati | Scrivi il passo temporale MD nella riga **Time axis**. |
| Le distanze periodiche sembrano sbagliate | Definisci la cella (sezione 3.3) e spunta la casella della minima immagine; le direzioni periodiche devono essere attive. |
| *Atom identity* mostra celle rosse | MONET, ASE e MDAnalysis leggono atomi diversi (struttura di riferimento o ordine degli atomi sbagliati): carica la topologia giusta. |
| Una traiettoria XTC/TRR/DCD ha tutti gli atomi X | Aggiungi la topologia come struttura di riferimento. |
| Un risultato sparisce dopo aver cambiato la cella | Applicare una cella o cambiare la casella della minima immagine cancella le analisi di proposito; ricalcola. |
| Un’analisi resta allo 0 % | Premi **Cancel running calculation**; i lag molto lunghi dell’ACF si limitano con **Max lag**. |
| Un’analisi ASE o MDAnalysis non è offerta | Il modulo manca nell’ambiente Python del launcher: reinstalla `requirements.txt`. |

## 13. Tasti e mouse

| Azione | Come |
|---|---|
| Ruotare / spostare / ingrandire il visualizzatore | trascina / trascina con il tasto destro o Maiusc+trascina / rotella |
| Scegliere o rilasciare un atomo | clic (o la riga della tabella degli atomi) |
| Menu di selezione | clic destro su un atomo o su uno spazio vuoto |
| Avviare o fermare, avanzare | Spazio, ← / → |
| Uscire dal visualizzatore espanso | Esc |
| Aprire cronologia e console | Ctrl+` |
| Ingrandire un grafico / ripristinare | trascina su di esso / doppio clic |

## 14. Come citare, licenza e ridisegnare le immagini

Cita MONET (T. Francese, *MONET: Molecular Dynamics Extractor*, Zenodo, doi:10.5281/zenodo.22816521, con la versione mostrata nella barra del titolo) insieme all’articolo PCCP 2022 (doi:10.1039/d2cp01147f) e alle librerie delle analisi che hai usato; **ⓘ References** scrive l’elenco. MONET è sotto licenza MIT; ASE e MDAnalysis sono pacchetti separati con le loro licenze.

Le immagini di questo manuale sono disegnate dal programma in esecuzione da `tools/make_manual_images.py` (servono `pip install playwright` e Chromium). Dopo una modifica dell’interfaccia esegui `python tools/make_manual_images.py` (oppure `--only window,acf_result`) e fai il commit dei nuovi `manual/img/*.png`. Il testo è `manual/MANUAL.md` e `manual/MANUAL.it.md`; mantieni le stesse sezioni e le stesse immagini in entrambi: un test lo controlla.

### Storia delle revisioni

| Versione | Data | Modifica |
|---|---|---|
| MONET 2.7.1 | 2026-10-10 | Prima versione del manuale (inglese e italiano). |

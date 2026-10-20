# MONET — Manuale d’uso

*Dr. T. Francese*

MONET legge una traiettoria di dinamica molecolare, la analizza con ASE, MDAnalysis e con metodi propri, ed estrae le configurazioni che servono per i calcoli di chimica quantistica. Funziona nel browser, sul tuo computer. Questo manuale segue l’ordine in cui si lavora: **apri la traiettoria → controllala e imposta cella e asse dei tempi → scopri se è equilibrata e quanto è correlata → analizzala → estrai configurazioni statisticamente indipendenti e scrivi gli input QM → conserva la registrazione di ciò che hai fatto**. Ogni passaggio ha un’immagine presa dal programma stesso.

> **Suggerimento:** il manuale è sempre disponibile dal pulsante **Manual** nella barra del titolo. Si apre in una nuova scheda, così puoi tenerlo accanto al programma. È scritto in inglese e in italiano (**EN / IT** in alto a destra nel manuale); il programma è in inglese e le immagini sono le stesse nelle due lingue.

> **Nota:** tutte le immagini usano due piccole traiettorie sintetiche, così puoi ripetere ogni passaggio: una **molecola di etanolo** (9 atomi, 1500 frame, con un transitorio iniziale e un ossidrile che ruota lentamente) e una **scatola di 64 molecole d’acqua** (192 atomi, 400 frame, periodica). Scrivile con `python tools/manual_data.py CARTELLA` nella cartella di MONET. I numeri nelle immagini illustrano il programma; non sono risultati su etanolo o acqua reali.

## 1. Prima di iniziare

### 1.1 Avviare MONET

MONET è una pagina web più un piccolo servizio Python (il *launcher*) che esegue ASE e MDAnalysis sul tuo computer. Tu avvii il launcher; il launcher apre la pagina nel browser.

1. Installa **Python 3.10 o più recente** una volta sola ([python.org/downloads](https://www.python.org/downloads/); su Windows spunta *Add python.exe to PATH*), oppure usa conda.
2. Scarica MONET (**Code › Download ZIP** su GitHub e poi estrai tutta la cartella, oppure `git clone`).
3. Avvia il launcher:
  - **macOS**: doppio clic su `start_monet.command` (la prima volta: clic destro › **Apri** › **Apri**).
  - **Windows**: doppio clic su `start_monet.bat` (se compare SmartScreen: **Ulteriori informazioni › Esegui comunque**).
  - **Linux**: esegui `./start_monet.command` in un terminale.
4. Il primo avvio crea un ambiente privato (la cartella `.venv`) e installa ASE, MDAnalysis, spglib e networkx. Serve internet una volta e richiede qualche minuto; gli avvii successivi sono immediati.
5. Il browser mostra MONET all’indirizzo `http://127.0.0.1:8765`. Il badge in alto a destra mostra le versioni di ASE e MDAnalysis quando tutto è pronto.
6. **Tieni aperta la finestra del terminale** mentre lavori. Quando hai finito, premi `Ctrl+C` nel terminale per fermare MONET.

Con conda: `conda env create -f environment.yml`, `conda activate monet`, `python start_monet.py`. Se la porta è occupata aggiungi `--port 8766`; `MONET_PYTHON` sceglie un Python particolare.

Tutto gira sul tuo computer. Il launcher ascolta solo su `127.0.0.1`, chiede un token per sessione e tiene i file caricati in una cartella privata che viene cancellata quando lo fermi; la tua traiettoria non lascia mai il computer (internet serve solo per installare i pacchetti Python). Una traiettoria viene caricata **una sola volta** (fino a 200 GB, `--max-upload-gb`); ogni scansione, analisi ed estrazione gira poi come lavoro in background con barra di avanzamento e pulsante **Cancel**.

> **Attenzione:** aprire direttamente `index.html` (doppio clic sul file) mostra la pagina ma **non avvia Python**: niente ASE, niente MDAnalysis, niente manuale. Avvia sempre MONET con il launcher.

### 1.2 La finestra principale

![La finestra principale di MONET con l’analisi della struttura aperta, con le aree numerate](img/window.png "La finestra principale dopo aver caricato la traiettoria dell’etanolo. 1 Barra del titolo · 2 Schede dei moduli · 3 Visualizzatore molecolare · 4 Lettore della traiettoria · 5 Schede delle analisi del modulo · 6 Asse dei tempi.")

| Numero | Area | A cosa serve |
|---|---|---|
| 1 | **Barra del titolo** | Lo stato di ASE / MDAnalysis, **Manual**, **ⓘ References** (cosa citare), **History** (registro di ogni passaggio), **☀ Day / ☾ Night**. |
| 2 | **Schede dei moduli** | **ASE**, **MDAnalysis** e **MONET Custom Functionalities**: tre famiglie di analisi. Condividono traiettoria, visualizzatore, tabella degli atomi, cella e asse dei tempi, quindi ciò che imposti in una vale anche nelle altre. |
| 3 | **Visualizzatore molecolare** | La struttura con i numeri MONET degli atomi. Clicca gli atomi per sceglierli per un’analisi; i pulsanti in alto a destra orientano la vista. |
| 4 | **Lettore della traiettoria** | Riproduce la traiettoria; i grafici la seguono. |
| 5 | **Schede delle analisi** | Le analisi del modulo scelto, una per scheda. |
| 6 | **Asse dei tempi** | Passo temporale MD e numero di passi MD tra un frame salvato e l’altro (sezione 2.2). |

All’estrema sinistra il **pannello del flusso di lavoro** contiene i sette passi dell’estrazione: *01 File input · 02 Structure analysis · 03 Sampling · 04 Atom selection · 05 Options · 06 Processing · 07 Results*. Mentre analizzi si riduce a una stretta barra sul bordo sinistro; **⇥** lo riapre, e il pulsante blu **Extraction →** porta al passo 03 quando l’analisi è finita (sezione 9).

### 1.3 Come leggere questo manuale

La sezione 2 spiega le poche idee su cui si basa tutto il programma; leggila una volta, perché le altre sezioni la richiamano. Le sezioni 3 e 4 preparano la traiettoria. Le sezioni 5, 6 e 7 descrivono le analisi dei tre moduli, ognuna con le stesse quattro parti:

* **A cosa serve** — la grandezza e perché la calcoleresti;
* **Passaggi** — cosa cliccare e scrivere, in ordine;
* **Come leggere il risultato** — cosa significano il grafico e i numeri;
* **Attenzione** — gli errori più comuni.

La sezione 8 mette tutto nell’ordine di uno studio reale; la sezione 9 è l’estrazione; la sezione 10 la registrazione di ciò che hai fatto.

### 1.4 Giorno e notte

![La stessa finestra in modalità notte](img/night.png "Modalità notte (predefinita se il sistema è scuro): premi ☀ Day / ☾ Night nella barra del titolo per cambiare. Grafici e immagini seguono il tema.")

Premi **☀ Day / ☾ Night** nella barra del titolo. La scelta è ricordata dal browser; il manuale ha lo stesso pulsante.

## 2. Concetti chiave

### 2.1 Gli atomi si numerano una volta: il MONET ID

Ogni atomo ha un solo numero, il **MONET ID**, usato ovunque: nel visualizzatore, in ogni campo delle analisi, nelle legende dei grafici, nei file estratti e negli input QM. È la posizione dell’atomo nel file originale, contata da 1. ASE conta da 0 (indice ASE = MONET ID − 1) e MDAnalysis riceve il MONET ID come `id`, quindi `id 5 7` in una selezione di MDAnalysis indica gli atomi MONET 5 e 7 (`index` è la posizione contata da 0). Dopo un’estrazione gli atomi mantengono gli ID del file originale: se estrai gli atomi 1 e 3, si chiamano ancora 1 e 3.

Dove un campo chiede **gruppi di atomi**, separa i gruppi con due spazi: `1 2  2 3` indica le coppie 1–2 e 2–3. Raramente serve scriverli: scegli gli atomi nel visualizzatore e premi **Use selection** (sezione 4.2).

### 2.2 Frame, passo tra frame e asse dei tempi

Una traiettoria è una sequenza di **frame** (configurazioni salvate). Il tuo codice MD ha salvato un frame ogni *n* passi MD di durata Δt. MONET non può conoscere questi due numeri, quindi li scrivi nella riga **Time axis**:

* **MD time step** — il Δt della simulazione (fs, unità atomiche o ps);
* **MD steps per saved frame** — *n*.

Il loro prodotto è il tempo tra due frame salvati (0,5 fs × 20 = 10 fs nelle immagini). Senza asse dei tempi i grafici usano i numeri dei frame e le analisi che richiedono il tempo reale (autocorrelazione, MSD, VDOS) restano disabilitate.

Quasi tutte le analisi hanno anche un **Frame step**: 1 analizza ogni frame, 5 un frame su cinque. Un passo più grande è più veloce, ma il tempo tra i frame analizzati cresce di conseguenza (Δt × *n* × frame step).

### 2.3 Cella, condizioni periodiche e minima immagine

In una simulazione periodica la scatola (la **cella**) si ripete nello spazio, e un atomo che esce da una faccia rientra da quella opposta. Due conseguenze:

* **Minima immagine.** La vera distanza tra due atomi è la più corta tra tutte le copie periodiche. Con una cella e la casella della minima immagine spuntata (sezione 4.4), MONET la usa per legami, distanze, angoli, diedri e molecole; senza cella usa le semplici distanze cartesiane.
* **Coordinate riportate nella cella e coordinate continue.** I codici scrivono spesso coordinate *riportate nella cella* (wrapped: ogni atomo rimesso nella scatola), così una molecola può apparire tagliata in due e un atomo può saltare di una lunghezza della scatola tra due frame. L’*unwrapping* elimina i salti, ed è necessario per misurare quanto viaggiano gli atomi (MSD, RMSD di corse periodiche). Il *wrapping* fa il contrario, per la visualizzazione o per input QM periodici (sezione 5.7).

### 2.4 La traiettoria attiva

Tutte le analisi e l’estrazione girano sulla **traiettoria attiva**, indicata nella riga **Source** in cima all’area delle analisi. All’inizio è il file che hai caricato. Alcuni passaggi scrivono una traiettoria *derivata* e possono renderla attiva:

* **Use the production window** tiene solo i frame dopo l’equilibrazione (sezione 6.1);
* **Accept t\*** tiene un frame ogni *stride* frame, statisticamente indipendenti (sezione 6.3);
* una selezione della PCA o una traiettoria allineata di MDAnalysis (sezione 7).

![La riga Source con una traiettoria derivata attiva](img/active_trajectory.png "Dopo Accept t*: la riga Source indica la traiettoria non correlata (un frame ogni 218), compare ↩ Full trajectory e MD steps per saved frame è diventato 20 × 218 = 4360, così l’asse dei tempi resta fisico.")

Quando una traiettoria derivata diventa attiva, MONET moltiplica *MD steps per saved frame* per lo stride (l’asse dei tempi resta corretto), imposta a 1 la frequenza di campionamento del passo 03 e conserva in ogni frame il numero del frame della corsa originale (`source_frame=`). **↩ Full trajectory**, accanto alla riga Source, torna alla corsa completa. La cronologia (sezione 10) registra da quale traiettoria viene ogni risultato.

### 2.5 Dispersione ed errore: perché conta la correlazione

Per ogni serie MONET dà una media e una **deviazione standard (DS)**. La DS è la *dispersione* dei valori (quanto vibra un legame); **non** è l’incertezza della media. Quell’incertezza è l’**errore standard della media (SEM)**, e dipende da quanti valori *indipendenti* hai.

Frame MD consecutivi sono quasi copie l’uno dell’altro. Il **tempo di autocorrelazione** τ dice quanto tempo impiega il sistema a dimenticare il passato; frame più vicini di così portano la stessa informazione. Dal tempo integrato τ_int (in frame) MONET calcola il **numero effettivo di campioni indipendenti** N_eff = N / (2 τ_int) e la SEM = DS / √N_eff. Una corsa di 1500 frame può avere N_eff ≈ 10.

Per questo MONET misura τ prima di estrarre le configurazioni: configurazioni prese a pochi frame di distanza sarebbero ripetizioni, e una media QM su di esse sembrerebbe molto più precisa di quanto sia. Angoli e diedri usano la statistica circolare (350° e 10° hanno media 0°, non 180°); R, da 0 a 1, dice quanto sono concentrati gli angoli.

### 2.6 Il flusso di lavoro in breve

![Il flusso di lavoro di MONET dalla traiettoria agli input QM](img/workflow.svg "L’ordine di uno studio e le sezioni di questo manuale: preparare (a sinistra), decidere quali configurazioni sono indipendenti (al centro), estrarre (a destra); la cronologia registra tutto.")

## 3. Passo 1 — Apri la traiettoria

### 3.1 Aprire un file

![Il passo File input con una traiettoria caricata](img/file_input.png "Passo 01: Browse… sceglie la traiettoria; il formato viene riconosciuto automaticamente.")

**Passaggi.**

1. Premi **Browse …** nel passo 01 e scegli una traiettoria XYZ o XYZ esteso (CPMD, CP2K, ORCA, Qbox …).
2. Lascia **Input format** su *Auto-detect* (l’XYZ si legge direttamente).
3. Se il file non ha una cella ma la simulazione era periodica, aggiungi un **cell file** (sezione 3.2).
4. Premi **Next →**. MONET indicizza il file, mostra il numero di configurazioni e di atomi e apre la scheda **ASE** con il primo frame nel visualizzatore.

**Attenzione.** Tutti i frame devono avere gli stessi atomi nello stesso ordine. Si leggono le colonne `species`/`pos` dell’XYZ esteso, `Lattice` e `pbc`; le altre colonne per atomo non vengono portate nei file estratti. **× Remove** toglie un file scelto per errore.

### 3.2 Altri formati

![Scegliendo un file GROMACS XTC compare il campo della struttura di riferimento](img/import_formats.png "Scegliendo un formato senza nomi degli elementi (qui GROMACS XTC) compare il file in più che serve: la struttura di riferimento o la topologia.")

Gli altri formati vengono importati (tramite ASE o MDAnalysis) in un XYZ esteso, che diventa la traiettoria su cui lavora MONET. Alcuni formati memorizzano le coordinate senza i nomi degli elementi; per questi MONET chiede un secondo file:

| Formato | Cosa aggiungere |
|---|---|
| VASP XDATCAR, OUTCAR, `vasprun.xml`, POSCAR/CONTCAR; output di Quantum ESPRESSO `pw.x`; output ORCA; output Qbox; dump LAMMPS; ASE `.traj`; CIF; output Gaussian | niente (tramite ASE) |
| Quantum ESPRESSO `cp.x` `.pos` (+ `.cel`); CP2K DCD; CPMD `TRAJECTORY` | una **struttura di riferimento** con lo stesso ordine degli atomi (qualsiasi file leggibile da ASE o MDAnalysis, per esempio il primo frame in XYZ); per `.cel` indica se i vettori del reticolo sono le righe o le colonne |
| GROMACS XTC, TRR; CHARMM/NAMD DCD; AMBER NetCDF | una **topologia** (GRO, PDB, TPR, PSF, PRMTOP …) come struttura di riferimento. Senza di essa ogni atomo è l’elemento **X**: distanze, angoli, diedri, RMSD, MSD e unwrapping funzionano ancora, le analisi per elemento no (un avviso lo segnala). |
| GROMACS GRO, PDB multi-modello, ogni altro formato letto da MDAnalysis | niente |

**Passaggi.**

1. Scegli il formato in **Input format** (o lascia *Auto-detect*). Il menu *All ASE-readable formats* elenca tutti gli altri formati che il tuo ASE sa leggere.
2. Se compare un campo **Reference structure / topology**, premi il suo **Browse …** e scegli il file.
3. Per una traiettoria XYZ di una corsa periodica puoi aggiungere un **Cell file**: un CIF, POSCAR o PDB dà una cella fissa a tutti i frame; un `.cell` di CP2K o un `.cel` di cp.x dà una cella per passo (NPT).
4. Premi **Next →**. L’importazione richiede il launcher.

### 3.3 Controlla che gli atomi siano gli stessi ovunque

**A cosa serve.** A verificare che MONET, ASE e MDAnalysis abbiano letto gli stessi atomi nello stesso ordine. Altrimenti un MONET ID indicherebbe atomi diversi in moduli diversi (sezione 2.1).

![La scheda Topology and consistency per la scatola d’acqua](img/mda_topology.png "MDAnalysis › Topology & consistency: i tre programmi concordano su 192 atomi; MDAnalysis ha trovato 64 residui con il nome della formula (H2O1, H2O2 …) e 128 legami.")

**Passaggi.**

1. Apri la scheda del modulo **MDAnalysis**, poi **Topology & consistency**. Il controllo parte da solo dopo il caricamento; **Check atom identity** lo ripete.
2. Leggi il riquadro verde: numero di atomi, frame, residui e legami.
3. Scorri la tabella: per ogni atomo, l’elemento per MONET e per ASE, e nome, residuo e massa per MDAnalysis.

**Come leggere il risultato.** Un riquadro verde significa che i tre programmi concordano. Le celle rosse segnano una discrepanza (numero, elemento o coordinate del primo frame). Per i file XYZ ogni molecola legata diventa un residuo con il nome della sua formula, quindi funzionano selezioni come `resname H2O`.

**Attenzione.** Una discrepanza significa quasi sempre struttura di riferimento o topologia sbagliate (ordine degli atomi diverso): carica quella giusta prima di analizzare.

## 4. Passo 2 — Guarda la struttura e imposta cella e asse dei tempi

### 4.1 Il visualizzatore

![Il visualizzatore della scatola d’acqua con gli strumenti di orientamento](img/viewer_tools.png "Il visualizzatore: x y z (e a b c) guardano lungo un asse, ⊹ axes mostra gli assi di orientamento, ▣ cell mostra la cella, ⛶ espande il visualizzatore. Sotto, il lettore della traiettoria.")

* **Trascina** per ruotare, **trascina con il tasto destro** o **Maiusc+trascina** per spostare, la **rotella** per ingrandire; **Fit view** ripristina l’orientamento.
* I menu sopra il visualizzatore scelgono lo stile (**Balls & sticks, Sticks, Space-filling, Lines, Points**) e la dimensione (Compact, Large, Full height).
* **x y z** guardano lungo quell’asse cartesiano (un secondo clic guarda dall’altro lato); con una cella, **a b c** fanno lo stesso lungo i vettori della cella. **⊹ axes** mostra o nasconde gli assi di orientamento nell’angolo; **▣ cell** mostra o nasconde il riquadro della cella (solo visualizzazione: le analisi usano comunque la cella). **⛶** espande il visualizzatore a tutta finestra; Esc lo riporta indietro.
* I sistemi grandi restano fluidi: sopra 2.500 atomi il visualizzatore disegna linee mentre ruoti.

### 4.2 Scegliere gli atomi per un’analisi

**A cosa serve.** Invece di scrivere i MONET ID, clicchi gli atomi e MONET li scrive nell’analisi che scegli.

![Quattro atomi scelti in ordine e Use selection for Dihedrals](img/use_selection.png "In alto: gli atomi 1, 2, 3, 4 dell’etanolo scelti in ordine (dorati, numerati #1–#4); la riga del lettore mostra il loro diedro in tempo reale. In basso: le scelte in ordine, gli strumenti di selezione e Use selection for → Dihedrals — groups of 4.")

**Passaggi.**

1. Clicca gli atomi **nell’ordine che serve all’analisi**: 2 per un legame, 3 per un angolo (quello di mezzo è il vertice), 4 per un diedro in ordine di legame (qui C–C–O–H). Gli atomi scelti diventano dorati con il numero d’ordine; una riga della tabella degli atomi sotto il visualizzatore fa lo stesso.
2. Controlla le etichette sotto **Selected in order**; la **×** di un’etichetta (o un nuovo clic sull’atomo) lo toglie, **Clear selection** ricomincia.
3. In **Use selection for** scegli l’analisi (RMSD, distanze tra coppie, legami, angoli, diedri, matrice RMSD, RDF, MSD, VDOS, autocorrelazione, fluttuazioni).
4. Premi **Use selection**. MONET apre quell’analisi con gli ID già scritti; imposta le opzioni e premi il suo pulsante **Compute**.

Per aggiungere altri gruppi alla stessa analisi, scegli gli atomi successivi, spunta **Append to existing atom groups** e premi di nuovo **Use selection**. Se scegli atomi legati in un ordine qualsiasi (per esempio un carbonio e i suoi tre idrogeni), MONET scrive ogni legame, angolo o diedro tra di essi.

### 4.3 Altri modi per selezionare

![Il menu del clic destro su un atomo](img/selection_menu.png "Clic destro su un atomo (o su una riga della tabella): selezionalo, la sua molecola, i vicini legati, gli atomi entro R Å o tutti gli atomi del suo elemento; estendi, inverti o cancella la selezione; centra la vista.")

* **Clic destro** su un atomo (o su uno spazio vuoto) apre un menu: l’atomo, la sua molecola, i vicini legati, gli atomi entro R Å, tutti gli atomi del suo elemento; estendi, inverti o cancella la selezione.
* Gli **strumenti di selezione** sotto il visualizzatore fanno lo stesso con pulsanti (*Select element, + Element, All, Invert, + Bonded, + Molecules, + Within R*).
* **Find bonded chains by element** trova ogni legame, angolo o diedro che corrisponde a un modello come `O H`, `H O H` o `C C O H` (`*` è un elemento qualsiasi) e li scrive negli input di geometria, autocorrelazione o fluttuazioni (**Fill**), eventualmente solo tra gli atomi selezionati.
* **Select with MDAnalysis syntax** (per esempio `resname H2O and element O`, `around 3.5 resname LIG`) sceglie gli atomi di una selezione di MDAnalysis.

Molecole e vicini vengono dai legami del primo frame (raggi covalenti × il **cutoff dei legami**, 1,2 per default; cambialo per legami insoliti).

### 4.4 Cella e condizioni periodiche

**A cosa serve.** La cella decide quali distanze sono periodiche (sezione 2.3). Una cella che arriva con la traiettoria viene usata automaticamente; questo pannello la mostra e permette di impostarne un’altra.

![Il pannello Crystal cell](img/cell_panel.png "Crystal cell and periodic boundaries: viene mostrata la cella sorgente del file; puoi anche scrivere a, b, c, α, β, γ, leggere un CIF o un POSCAR e scegliere le direzioni periodiche.")

**Passaggi.**

1. Apri **Crystal cell and periodic boundaries** in cima al modulo ASE.
2. Leggi la riga di stato: *Using source cell* significa che il file ha una cella (`Lattice=` dell’XYZ esteso, o un cell file dato all’importazione) e MONET la usa. Puoi fermarti qui.
3. Se la cella manca o è sbagliata: scegli il sistema cristallino, scrivi a, b, c in Å e α, β, γ in gradi, spunta le direzioni periodiche e premi **Apply cell**. In alternativa **Load cell from file (CIF …)** legge i sei parametri da un CIF, POSCAR, PDB o `.cell` di CP2K.
4. Lascia spuntato **Use minimum-image distances** per i sistemi periodici.

**Attenzione.** Applicare una cella o cambiare la casella della minima immagine cancella apposta le analisi precedenti, così risultati calcolati con geometrie diverse non si mescolano mai. Le celle scritte a mano seguono la convenzione *a lungo x, b nel piano xy*; le coordinate non vengono né ruotate né scalate, quindi usa una cella scritta in quell’orientamento. **Use source cell** toglie la tua cella e torna a quella del file.

### 4.5 L’asse dei tempi

**Passaggi.**

1. Nella riga **Time axis** scrivi il **passo temporale MD** e scegli l’unità (fs, u.a. o ps).
2. Scrivi gli **MD steps per saved frame** (ogni quanti passi il tuo codice scriveva la traiettoria).
3. Controlla la riga blu accanto: *Time between saved frames: 10 fs (0.5 fs × 20)*.

Gli stessi due campi compaiono in cima ai pannelli di autocorrelazione, fluttuazioni, MSD e VDOS; sono gli stessi valori, quindi cambiarne uno li cambia tutti. Un passo temporale mancante è mostrato in rosso dove serve.

### 4.6 Il lettore

![Il lettore della traiettoria](img/player.png "Il lettore: primo, precedente, Play, successivo, ultimo e uno slider; Step mostra un frame ogni n; Speed in fps; loop; Cell display riporta nella cella molecole o atomi solo per la visualizzazione; centre selection.")

**Passaggi.**

1. Premi **▶ Play** (o Spazio quando il visualizzatore ha il focus); ←/→ avanzano di un frame.
2. **Step** salta dei frame, **Speed** imposta i frame al secondo, **loop** ricomincia alla fine.
3. **Cell display** riporta nella scatola molecole intere o atomi solo per la visualizzazione; **centre selection** tiene al centro gli atomi scelti.

Durante la riproduzione un cursore tratteggiato mostra il frame corrente sui grafici di RMSD, legami, angoli, diedri e MDAnalysis, e un clic su quei grafici salta a quel frame. Con 2, 3 o 4 atomi scelti, la riga sotto il lettore mostra la loro distanza, angolo o diedro nel frame corrente.

## 5. Il modulo ASE

Il modulo ASE contiene struttura, geometria e le analisi della libreria ASE. Ogni scheda di analisi ha **Clear analysis**, **Download plot PNG** (larghezza 2400 px, nel tema corrente) e **Download data CSV**. **Clear all analyses** svuota tutte le schede e mantiene traiettoria e impostazioni.

### 5.1 Struttura

**A cosa serve.** Un riepilogo di un frame: formula, masse, centro di massa, momenti d’inerzia, cella, volume e densità, distanze minime (e atomi sovrapposti), molecole, legami per coppia di elementi, numeri di coordinazione e gruppo spaziale. È il controllo più rapido che file, cella e legami siano quelli che ti aspetti.

![La scheda Structure per la scatola d’acqua](img/structure_result.png "Analyse structure per la scatola d’acqua: formula H128O64, 128 legami H–O con lunghezza media, minima e massima, ogni O con due vicini e ogni H con uno.")

**Passaggi.**

1. Apri **ASE › Structure**.
2. Scrivi il **Frame** (0 è il primo) e, se serve, la **Symmetry tolerance** per il gruppo spaziale.
3. Premi **Analyse structure**.

**Come leggere il risultato.** I legami per coppia di elementi e i numeri di coordinazione mostrano se le molecole sono integre (qui ogni O ha due H e ogni H un O). Una coppia di elementi inattesa o una distanza molto corta indicano elementi sbagliati o una cella mancante.

### 5.2 Lunghezze di legame

**A cosa serve.** Come cambia lungo la traiettoria la distanza tra due atomi legati, con la sua media, la dispersione e la distribuzione.

![Lunghezze di legame della molecola di etanolo](img/bonds_result.png "Bond Lengths: C–C, C–O e O–H dell’etanolo lungo la traiettoria, con media ± DS in legenda e la distribuzione sotto il grafico.")

**Passaggi.**

1. Scegli i due atomi nel visualizzatore e usa **Use selection for → Bond lengths** (sezione 4.2), oppure scrivi le coppie in **ASE › Bond Lengths** (`1 2  2 3  3 4`).
2. Imposta il **Frame step** (1 = ogni frame).
3. Premi **Compute**.

**Come leggere il risultato.** Il grafico in alto è il legame in funzione del frame; la legenda dà media ± DS (la dispersione, sezione 2.5). La nota sopra il grafico aggiunge la SEM, corretta per la correlazione dei frame. Il grafico **Distribution** sotto è l’istogramma dei valori; **Fit** adatta una gaussiana, lorentziana, pseudo-Voigt, von Mises o due gaussiane (tutti i bin o un **Fit range**) ed elenca i parametri con i loro errori. *Show → dot histogram* disegna un punto per frame.

**Attenzione.** Gli errori del fit trattano i bin come indipendenti e sono di solito più piccoli della SEM; per l’incertezza della media riporta la SEM.

### 5.3 Angoli di legame

**A cosa serve.** L’angolo su un atomo centrale (per esempio C–O–H) lungo la traiettoria.

![Angoli di legame dell’etanolo](img/angles_result.png "Bond Angles: C–C–O e C–O–H dell’etanolo.")

**Passaggi.**

1. Scegli tre atomi con il vertice in mezzo e usa **Use selection for → Bond angles**, oppure scrivi le terne (`1 2 3  2 3 4`).
2. Scegli l’**Angle range**: il solito 0–180°; 0–360° con una normale di riferimento quando conta il lato; oppure un intervallo ripiegato.
3. Premi **Compute**.

**Attenzione.** Cambiare l’intervallo cancella il risultato; ricalcola.

### 5.4 Angoli diedri

**A cosa serve.** La torsione di quattro atomi attorno al legame centrale: cambi di conformazione, rotazioni di gruppi, torsioni tra unità.

![La torsione del gruppo ossidrile dell’etanolo](img/dihedrals_result.png "Dihedral Angles: la torsione C–C–O–H, nell’intervallo 0–360°. Media e DS sono circolari (R è la lunghezza media risultante); la nota aggiunge la SEM corretta per la correlazione dei frame (N_eff, τ_int).")

**Passaggi.**

1. Scegli quattro atomi in ordine di legame (qui 1 C, 2 C, 3 O, 4 H) e usa **Use selection for → Dihedrals**, oppure scrivi `1 2 3 4`.
2. Scegli l’**Angle range**:
  - *0–360°* (convenzione di ASE) quando i due versi di rotazione sono diversi;
  - *−90…+90° folded* o *0…180° folded* quando orientazioni distanti 180° sono equivalenti (un gruppo simmetrico). Scegli l’intervallo ripiegato il cui bordo è lontano dai tuoi valori, così la traccia non salta.
3. Premi **Compute**.

**Come leggere il risultato.** Media e DS sono circolari (sezione 2.5); la nota dà R, N_eff e τ_int. **Show → polar plot** disegna l’istogramma circolare (punti impilati o indice del frame) con la media di ogni serie e direzioni di **Reference** facoltative, per esempio un angolo sperimentale.

### 5.5 Distanze tra coppie

**A cosa serve.** Un istogramma (conteggi) di tutte le distanze tra gli atomi scelti, da 0,5 Å a Rmax: uno sguardo rapido a quali distanze compaiono.

![Istogramma delle distanze O–O](img/pdd_result.png "Pair Distances: istogramma dei conteggi delle distanze O–O della scatola d’acqua.")

**Passaggi.**

1. Facoltativamente indica gli atomi (vuoto = tutti) e una **coppia di elementi** (`O O`; `C N` per le sole coppie C–N).
2. Imposta **R max**, **Bins** e **Frame step**, poi premi **Compute**.

**Attenzione.** Sono conteggi grezzi, che crescono con r solo perché lontano ci sono più atomi. Per un g(r) normalizzato usa la scheda **RDF** (sezione 6.7).

### 5.6 Coordinazione

**A cosa serve.** Quanti vicini ha ogni atomo in ogni frame: rottura e formazione di legami, cambi di coordinazione.

![Numeri di coordinazione lungo la traiettoria](img/coordination_result.png "Coordination: i vicini di ogni atomo entro i raggi covalenti di ASE (× il cutoff dei legami del visualizzatore) in ogni frame analizzato: la media per elemento e i primi otto atomi.")

**Passaggi.**

1. Facoltativamente indica gli atomi (vuoto = tutti) e il **Frame step**.
2. Premi **Compute coordination**.

**Come leggere il risultato.** Linee piatte indicano legami stabili; un gradino indica un legame che si forma o si rompe. Per l’elenco degli eventi usa *More analyses › Bonds formed and broken* (sezione 5.8).

### 5.7 Convert e wrap

**A cosa serve.** A scrivere la traiettoria in un altro formato, oppure con coordinate continue (unwrapped) o riportate nella cella (wrapped) (sezione 2.3).

![La scheda Convert / Wrap](img/convert_panel.png "Convert / Wrap: scegli un file di input, il formato di uscita e il nome del download; sotto, unwrap o wrap della traiettoria attiva.")

**Passaggi per convertire un file.**

1. Premi **Browse …** per il file di input.
2. Scegli l’**Output format** (XYZ esteso, XYZ, VASP, CIF, LAMMPS data, FHI-aims, Turbomole, input Gaussian, DFTB+ o JSON).
3. Lascia *Convert first frame only* per i formati che contengono una sola struttura; toglilo per l’XYZ esteso o il JSON con più frame. Per un XYZ semplice puoi applicare la cella della sezione 4.4.
4. Imposta il nome del download e premi **Convert**, poi scarica il file.

**Passaggi per l’unwrap o il wrap della traiettoria attiva.**

1. **Unwrap and download** scrive percorsi atomici continui (serve una cella periodica).
2. Per il wrap scegli *whole* (molecole ricostruite attraverso il bordo e portate nella cella) o *atoms* (ogni atomo portato nella cella), eventualmente **centre on selected atoms**, e premi **Wrap and download**: utile prima di input QM periodici.

**Attenzione.** VASP richiede una cella completa. Quantum ESPRESSO non è offerto qui perché non si raccolgono gli pseudopotenziali; usa invece gli input QM del passo 05 (sezione 9.4).

### 5.8 More analyses

**A cosa serve.** Le altre analisi della libreria ASE che si applicano a configurazioni esistenti: autodiffusione per elemento, energie, forze, temperatura e pressione memorizzate nel file, legami, angoli e diedri per tipo di elemento, molecole e specie, legami formati e rotti, RDF, gruppo spaziale, dimensionalità, strati, XRD di polveri e SAXS, reticolo di Bravais e cella di Niggli, traiettoria di supercella, volume e densità della cella.

![ASE More analyses](img/ase_more.png "ASE › More analyses: molecole e specie per frame della scatola d’acqua, con le altre analisi ASE integrate nel menu.")

**Passaggi.**

1. Apri **ASE › More analyses** e scegli l’analisi nel menu; compaiono la descrizione e i campi.
2. Compila i campi; **← picked** inserisce gli atomi scelti nel visualizzatore.
3. Imposta il **Frame step** e premi **Compute**. **ⓘ Cite** mostra cosa citare.

I plugin del motore ASE compaiono nello stesso menu (sezione 11).

## 6. MONET Custom Functionalities

Le analisi proprie di MONET. Sono nell’ordine di uno studio: prima decidi quale parte della corsa è utilizzabile (6.1) e quanto è correlata (6.2, 6.3), poi la analizzi (6.4–6.9). La prima scheda, **3D viewer & extraction**, appartiene all’estrazione (sezione 9).

### 6.1 La corsa è equilibrata? Detect equilibration

**A cosa serve.** L’inizio di una simulazione spesso ricorda ancora la struttura di partenza (un *transitorio*). Le medie che lo includono sono distorte. MONET trova dove inizia la parte di *produzione*.

![Detect equilibration](img/equilibration_result.png "Detect equilibration (Chodera 2016): N_eff in funzione dell’inizio della produzione t₀; il valore massimo (oro) è dove inizia la produzione. Qui il transitorio iniziale viene scartato fino a 2.750 fs.")

**Passaggi.**

1. Imposta l’asse dei tempi (sezione 4.5).
2. Apri **MONET Custom Functionalities › Autocorrelation**.
3. Scegli una **Quantity** lenta e significativa e i suoi **MONET ID** (qui il diedro `1 2 3 4`).
4. Premi **Detect equilibration**.
5. Se viene trovato un transitorio, premi **✂ Use the production window from t₀**: i frame dopo t₀ diventano la traiettoria attiva (sezione 2.4).

**Come leggere il risultato.** Per ogni possibile inizio t₀ nella prima metà della corsa, MONET calcola quanti campioni indipendenti darebbe il resto, N_eff(t₀). Tagliare il transitorio toglie frame ma toglie anche una deriva lenta, quindi N_eff prima cresce; il massimo (linea oro) è dove inizia la produzione (qui 2.750 fs, N_eff da 10,1 a 16,9). Se non trova un transitorio, MONET lo dice e tieni tutta la corsa.

**Attenzione.** La risposta dipende dalla grandezza: usane una che si rilassa lentamente. Poi ricalcola l’autocorrelazione sulla finestra di produzione.

### 6.2 Quanto è correlata? Autocorrelazione

**A cosa serve.** La **funzione di autocorrelazione** C(t) misura quanto la grandezza somiglia a se stessa dopo un tempo t: vale 1 a t = 0 e poi decade verso 0. Il tempo che impiega è il tempo di correlazione τ (sezione 2.5), e decide ogni quanto puoi campionare configurazioni indipendenti.

![Autocorrelazione della torsione dell’ossidrile](img/acf_result.png "Autocorrelation: C(t) del diedro (blu) e il suo fit (rosso tratteggiato); t* (oro tratteggiato) è dove il fit raggiunge il plateau. Sotto il grafico, il block averaging dell’errore standard.")

**Passaggi.**

1. Imposta l’asse dei tempi (sezione 4.5).
2. Scegli la **Quantity** (diedro, angolo di legame, lunghezza di legame o RMSD) e scrivi i **MONET ID**, oppure inviali con **Use selection for → Autocorrelation**. Più gruppi vengono mediati.
3. La prima volta lascia i valori predefiniti: *Normalised fluctuations*, fit *exp(−t/τ)*, fit fino al *first zero crossing*, τ_int con la *Sokal window*.
4. Premi **Compute ACF**.

**Come leggere il risultato.**

* **τ (fit)**: dal fit di exp(−t/τ) a C(t) (qui 727 ± 14 fs). **τ_int**: l’integrale di C(t), usato per N_eff e per la SEM (qui 746 fs, con il suo errore).
* **Lunghezza della corsa in τ**: T / τ. Sotto 20 τ MONET avvisa, sotto 50 τ nota che τ e lo stride sono approssimati (qui 20,6 τ: la corsa è corta).
* **Block averaging** (grafico sotto): la SEM calcolata da blocchi di lunghezza crescente. Dovrebbe raggiungere un plateau; se cresce ancora ai blocchi più lunghi (come qui), la corsa è troppo corta per una barra d’errore affidabile.

**Altre opzioni.** *Correlation → Circular* per gli angoli; *Dihedral range → 0–180° folded* quando orientazioni opposte sono equivalenti; *Fit model → (1 − c)·exp(−t/τ) + c* quando C(t) si stabilizza sopra zero; *Max lag* limita il ritardo massimo (per default metà corsa). Trascina sul grafico per ingrandire, doppio clic per ripristinare.

### 6.3 Da τ alle configurazioni indipendenti

**A cosa serve.** A trasformare τ in un passo di campionamento e a scrivere la traiettoria di configurazioni indipendenti che userà l’estrazione.

![Il riquadro di convalida del plateau dell’autocorrelazione](img/acf_plateau.png "Il riquadro di convalida: t* = τ·ln(1/ε) = 2.177 fs per ε = 5 %, arrotondato per eccesso a una configurazione ogni 218 frame salvati: 7 configurazioni indipendenti su 1500, con correlazione residua g ≈ 1,27.")

**Passaggi.**

1. Dopo **Compute ACF**, leggi il riquadro verde. La curva del fit raggiunge il plateau entro una tolleranza ε a **t\* = τ·ln(1/ε)** (3,0 τ per ε = 5 %, 4,6 τ per 1 %), disegnato come linea tratteggiata oro sul grafico.
2. Controlla che t* cada dove la curva misurata è davvero decaduta. Altrimenti cambia **Plateau tolerance ε**, scrivi τ in **Use τ**, o scrivi un altro **Decorrelation time t\***.
3. Leggi il risultato: lo stride (t* diviso il tempo tra frame, arrotondato per eccesso; qui 218 frame), quante configurazioni dà, e la correlazione residua *g* delle configurazioni campionate (vicina a 1 significa indipendenti).
4. Scegli cosa farne:
  - **Accept t\* and build the uncorrelated trajectory** scrive un XYZ esteso con un frame ogni *stride* frame. Con *analyse it in MONET right away* spuntato diventa la traiettoria attiva (sezione 2.4), e l’estrazione userà esattamente queste configurazioni;
  - **Only set the sampling frequency** copia lo stride nel passo 03 e lascia attiva la traiettoria completa.

**Attenzione.** Una corsa corta dà poche configurazioni indipendenti (qui 7). È il numero onesto: prenderne di più ripeterebbe la stessa informazione.

### 6.4 Fluttuazioni e tendenze

**A cosa serve.** Per tutti i legami, angoli, diedri o atomi insieme: quanto fluttuano, se derivano durante la corsa e a quale frequenza oscillano. Trova le parti flessibili di una molecola e controlla che nulla stia ancora cambiando.

![Fluttuazioni dei legami dell’etanolo](img/fluct_result.png "Fluctuations & trends: la DS di ogni legame (barre e tabella). La tabella dà media, DS, minimo, massimo, intervallo 5–95 %, tendenza con errore e R², deriva tra le due metà, errore a blocchi e frequenza dominante.")

**Passaggi.**

1. Scegli cosa mappare in **Map** (lunghezze di legame, angoli, diedri o atomi).
2. In **Items** scegli *all found among the atoms below* (ogni legame, angolo o diedro della connettività del primo frame tra gli atomi indicati, vuoto = tutti) o *only the groups entered below*.
3. Facoltativamente imposta l’asse dei tempi, per avere tendenze per ps e frequenze in cm⁻¹.
4. Premi **Compute**.
5. Clicca una riga della tabella per vedere quell’elemento lungo la traiettoria, con media, ±DS e retta di tendenza, e per evidenziarlo sulla molecola.

**Come leggere il risultato.** **Colour and bars by** sceglie cosa mostrano le barre e i colori sulla molecola: DS, intervallo, |tendenza|, |deriva|, frequenza o media. Una tendenza è marcata *significant* solo quando le cinque medie a blocchi seguono una retta oltre tre volte l’errore della pendenza e la variazione supera il 10 % della DS, così le oscillazioni rapide non vengono scambiate per deriva. Le **frecce di vibrazione** e gli **ellissoidi di spostamento** (atomi; 50, 90 o 99 %) mostrano come e dove si muovono gli atomi. *Download statistics CSV* salva la tabella.

### 6.5 RMSD (Kabsch)

**A cosa serve.** La **deviazione quadratica media** (RMSD) degli atomi da un frame di riferimento: quanto la struttura si è allontanata da esso. Con l’**allineamento di Kabsch** ogni frame viene prima ruotato e traslato sul riferimento, così contano solo i cambi di forma.

![RMSD della traiettoria dell’etanolo](img/rmsd_result.png "RMSD (Kabsch): spostamento dal primo frame con l’allineamento di Kabsch attivo; sotto la distribuzione.")

**Passaggi.**

1. Indica gli atomi (vuoto = tutti) o inviali con **Use selection for → RMSD**.
2. Spunta **Kabsch alignment** per togliere traslazione e rotazione; spunta **Unwrap PBC** per le corse periodiche (sezione 2.3).
3. Scegli il **Reference frame** (il primo per default) e premi **Compute RMSD**.

**Come leggere il risultato.** Un plateau significa che la struttura oscilla attorno a uno stato; un gradino che è passata a un altro. Senza allineamento l’RMSD contiene anche il moto dell’intera molecola.

### 6.6 Matrice RMSD

**A cosa serve.** L’RMSD tra ogni coppia di frame, come mappa a colori: quali frame si somigliano, e se il sistema visita più stati e ci ritorna.

![Matrice RMSD a coppie](img/rmsdmatrix_result.png "RMSD Matrix: l’RMSD tra ogni coppia di frame analizzati. I blocchi lungo la diagonale sono stati distinti; valori bassi lontano dalla diagonale significano che il sistema rivisita uno stato.")

**Passaggi.**

1. Indica gli atomi (vuoto = tutti), il **Frame step** (fino a 3000 frame analizzati) e le opzioni di allineamento.
2. Premi **Compute matrix**.
3. Scegli la mappa di colori, dove sta il frame 0 (in alto o in basso a sinistra) e un titolo sotto il grafico.

**Attenzione.** Usa un passo vicino allo stride di decorrelazione (sezione 6.3), o calcolala sulla traiettoria non correlata, per confrontare configurazioni indipendenti. MDAnalysis ha la stessa matrice (sezione 7.5).

### 6.7 RDF

**A cosa serve.** La **funzione di distribuzione radiale** g(r): quanto è probabile trovare un atomo a distanza r da un altro, rispetto a una distribuzione uniforme alla stessa densità. I picchi sono i gusci di coordinazione; in un liquido g(r) → 1 a grande distanza.

![Funzione di distribuzione radiale O–O dell’acqua](img/rdf_result.png "RDF: g(r) della coppia O–O della scatola d’acqua; il primo picco è il primo guscio di coordinazione. Serve una cella periodica; Rmax è limitato a metà della larghezza minima della cella.")

**Passaggi.**

1. Controlla che la cella sia impostata (sezione 4.4): la RDF richiede una cella periodica.
2. Scrivi una **coppia di elementi** (`O O`, `O H`; vuoto = tutti gli atomi) ed eventualmente limitala ad alcuni MONET ID.
3. Imposta **Bins** e **Frame step**; lascia vuoto **R max** per il valore massimo consentito.
4. Premi **Compute RDF**. **Plot** passa tra g(r) e il numero di coordinazione cumulato n(r).

**Come leggere il risultato.** La posizione del primo picco è la distanza tipica tra vicini; n(r) al primo minimo è il numero di vicini nel primo guscio.

### 6.8 MSD e diffusione

**A cosa serve.** Lo **spostamento quadratico medio** MSD(t) = ⟨|r(t) − r(0)|²⟩: quanto si spostano gli atomi in un tempo t. In un liquido diventa una retta, la cui pendenza dà il **coefficiente di diffusione** D = pendenza / 6.

![Spostamento quadratico medio dell’acqua](img/msd_result.png "MSD / Diffusion: MSD(t) dell’intero sistema, di O e di H, e il fit lineare (oro tratteggiato). D = pendenza / 6, in cm²/s e Å²/fs.")

**Passaggi.**

1. Imposta l’asse dei tempi (sezione 4.5).
2. Indica gli atomi (vuoto = tutti) e il **Frame step**.
3. Lascia spuntato **Remove the system centre-of-mass drift**.
4. Premi **Compute MSD**, poi regola la **finestra del fit** (da, a; per default 10–50 % dei ritardi) sulla parte rettilinea.

**Come leggere il risultato.** D è dato per la selezione e per elemento. A tempi brevi l’MSD curva verso l’alto (moto balistico); a tempi lunghi diventa rumoroso perché restano poche origini dei tempi: fai il fit nel mezzo.

**Attenzione.** Le posizioni vengono unwrappate con la minima immagine, quindi il passo tra frame deve essere abbastanza piccolo da far muovere gli atomi meno di mezza cella tra due frame analizzati (altrimenti MONET avvisa).

### 6.9 VDOS

**A cosa serve.** La **densità degli stati vibrazionali**: a quali frequenze vibrano gli atomi, dalla trasformata di Fourier delle loro velocità. È confrontabile con uno spettro IR o Raman senza intensità.

![Densità degli stati vibrazionali dell’etanolo](img/vdos_result.png "VDOS: la trasformata di Fourier delle velocità alle differenze finite (finestra di Hann, ponderazione per massa e lisciatura facoltative), normalizzata ad area unitaria. Vengono mostrati il limite di Nyquist e la risoluzione.")

**Passaggi.**

1. Imposta l’asse dei tempi (sezione 4.5). Le velocità si calcolano da frame consecutivi, quindi usa frame salvati a ogni passo MD, o ogni pochi passi.
2. Indica gli atomi (vuoto = tutti), il **Frame step**, lo **Smoothing** e la frequenza massima **Up to**.
3. Spunta **Mass-weighted** se vuoi pesare ogni atomo con la sua massa, e premi **Compute VDOS**.

**Come leggere il risultato.** La frequenza più alta misurabile (limite di Nyquist) è 1/(2 × il tempo tra frame); la risoluzione è 1/(tempo totale). Entrambe sono mostrate: frame salvati troppo di rado tagliano le alte frequenze, una corsa corta allarga i picchi.

## 7. Il modulo MDAnalysis

### 7.1 Eseguire un’analisi

**A cosa serve.** I moduli di analisi di MDAnalysis sulla stessa traiettoria, cella, passo tra frame e MONET ID: RMSD e RMSF, PCA, legami a idrogeno, contatti, densità, analisi di proteine e acidi nucleici e altro (sezione 7.5).

![Il modulo delle analisi MDAnalysis con i campi dei legami a idrogeno](img/mda_form.png "MDAnalysis › Analyses: scegli l’analisi nel menu; compaiono i suoi campi. ⓘ Cite mostra i suoi riferimenti.")

**Passaggi.**

1. Apri la scheda del modulo **MDAnalysis**, poi **Analyses**.
2. Scegli l’analisi nel menu **Analysis**; compaiono la descrizione e i campi.
3. Compila i campi. Le selezioni usano il linguaggio di MDAnalysis: `all`, `element O`, `resname H2O`, `id 1 2 3` (MONET ID), `around 3.5 resname LIG`. **← picked** inserisce gli atomi scelti nel visualizzatore.
4. Imposta il **Frame step** e premi **Compute**. **ⓘ Cite** mostra cosa citare.

### 7.2 RMSD e RMSF

**A cosa servono.** *rms.RMSD* è l’RMSD dopo la sovrapposizione ottimale (come nella sezione 6.5, con MDAnalysis), con gruppi extra misurati dopo lo stesso fit. *rms.RMSF* è la **fluttuazione quadratica media** di ogni atomo attorno alla sua posizione media: quali atomi si muovono di più.

![RMSD dal modulo MDAnalysis](img/mda_rmsd.png "rms.RMSD: RMSD dopo sovrapposizione ottimale, con gruppi extra misurati dopo lo stesso fit.")

![RMSF dal modulo MDAnalysis](img/mda_rmsf.png "rms.RMSF: fluttuazione quadratica media di ogni atomo.")

**Passaggi.**

1. Scegli *RMSD after optimal superposition* o *RMSF*.
2. Per l’RMSD scrivi la **Fit selection** (per esempio `all` o `not element H`) e gli eventuali **Extra groups** (una selezione per riga); per l’RMSF scrivi la **Selection** e lascia spuntato **Align on the selection first**.
3. Premi **Compute**.

### 7.3 Analisi delle componenti principali (PCA)

**A cosa serve.** La PCA trova i **moti collettivi** che spiegano la maggior parte della fluttuazione della struttura: la componente 1 è il più ampio. Proiettare ogni frame sulle componenti mostra dove va la traiettoria; scegliere frame lungo una componente dà configurazioni che coprono quel moto.

![Analisi delle componenti principali](img/mda_pca.png "PCA: le proiezioni sulle prime componenti, la tabella di varianza, frazione spiegata e contenuto in coseno, e la scelta delle configurazioni per finestra di proiezione, estremi o elenco di frame.")

**Passaggi.**

1. Scegli *Principal component analysis (pca.PCA)*, scrivi la **Selection** e lascia spuntato **Align on the selection first**.
2. Premi **Compute**.
3. Nella tabella **Principal components** spunta le componenti da disegnare.
4. Sotto **Select configurations** scegli come prenderle: una **finestra di proiezione** (clicca una barra della distribuzione, o scrivi l’intervallo), gli **estremi** di una componente, o un **elenco di frame**. Imposta **Minimum spacing (frames)** allo stride di decorrelazione (sezione 6.3), così le scelte sono indipendenti, e premi **Select**.
5. Premi **Write the selected configurations**, poi **Use them for the extraction** per renderle la traiettoria attiva.

**Come leggere il risultato.** *Explained* è la quota della fluttuazione totale di ogni componente. Un **contenuto in coseno** vicino a 1 significa che la componente somiglia a una diffusione casuale: il moto non è campionato abbastanza per avere significato.

### 7.4 Legami a idrogeno

**A cosa serve.** Quali terne donatore–idrogeno···accettore formano legami a idrogeno, quanti ce ne sono in ogni frame, e per quale frazione del tempo esiste ciascuno (**occupazione**).

![Legami a idrogeno nella scatola d’acqua](img/mda_hbonds.png "HydrogenBondAnalysis: legami a idrogeno per frame (cutoff D–A 3 Å, angolo D–H–A 150°) e la tabella delle occupazioni con i MONET ID.")

**Passaggi.**

1. Scegli *Hydrogen bonds (HydrogenBondAnalysis)*.
2. Scrivi le selezioni di **Donors**, **Hydrogens** e **Acceptors** (predefinite: `element O N F` ed `element H`).
3. Imposta il **D–A cutoff** (3 Å) e l’**angolo minimo D–H–A** (150°), poi premi **Compute**.

**Come leggere il risultato.** Il grafico è il numero di legami a idrogeno per frame; la tabella elenca ogni legame con i suoi MONET ID e l’occupazione. Per quanto a lungo sopravvive un legame usa *Hydrogen-bond lifetime* o *Hydrogen-bond autocorrelation* nello stesso menu.

### 7.5 Cosa è disponibile

| Gruppo | Analisi |
|---|---|
| Struttura e dinamica | RMSD, matrice RMSD a coppie, RMSF, raggio di girazione, PCA (con contenuto in coseno), EinsteinMSD, GNM, diffusion map, traiettoria allineata, struttura media, coordinate legame–angolo–torsione |
| Interazioni e distanze | legami a idrogeno, loro vita media e autocorrelazione, ponti d’acqua, contatti, mappa dei contatti, InterRDF e RDF per sito, distanze tra centri di massa e minime, distanze atomiche, diedri |
| Densità | densità lineare, griglia di densità (OpenDX) |
| Membrane, polimeri, dielettrici | foglietti, lunghezza di persistenza, costante dielettrica (servono le cariche) |
| Proteine | Ramachandran, DSSP, Janin χ1/χ2, geometria dell’elica |
| Acidi nucleici | distanze tra basi appaiate, torsioni dello scheletro e pucker dello zucchero |

Non inclusi: `encore`, `psa`, `waterdynamics` (deprecati), `hole2` e `legacy.x3dna` (programmi esterni). Le analisi che scrivono una traiettoria (traiettoria allineata, struttura media, selezione della PCA) offrono un pulsante per renderla la traiettoria attiva.

## 8. Uno studio completo, passo per passo

È l’ordine raccomandato in `docs/md-analysis-workflow.md`, che riporta la letteratura dietro ogni passo. Ogni passo indica la sezione che lo spiega.

1. **Apri** la traiettoria, con cella o topologia se servono (sezioni 3.1, 3.2).
2. **Controlla gli atomi** in *MDAnalysis › Topology & consistency* (sezione 3.3) e **analizza la struttura** del primo frame (sezione 5.1): molecole integre, distanze sensate, cella giusta.
3. **Imposta cella e asse dei tempi** (sezioni 4.4, 4.5). Senza di essi distanze periodiche, MSD, VDOS e autocorrelazione sono sbagliate o disabilitate.
4. **Guarda** la traiettoria con il lettore (sezione 4.6): niente che esplode, molecole non spezzate.
5. **È equilibrata?** *Detect equilibration* su una grandezza lenta (sezione 6.1); se trova un transitorio, usa la finestra di produzione. L’energia memorizzata nel file (*ASE › More analyses › Values stored in the file*) è un altro controllo.
6. **Quanto è correlata?** Calcola l’autocorrelazione della stessa grandezza lenta sulla finestra di produzione (sezione 6.2). Controlla che la corsa duri almeno 20–50 τ e che il block averaging raggiunga un plateau.
7. **Analizza la corsa a piena risoluzione**: geometria e distribuzioni (sezioni 5.2–5.4), fluttuazioni (6.4), RDF, MSD, VDOS (6.7–6.9), MDAnalysis (7). Come incertezza di una media riporta la SEM, non la DS (sezione 2.5).
8. **Costruisci la traiettoria non correlata** con *Accept t\** (sezione 6.3): diventa la traiettoria attiva.
9. **Estrai** le configurazioni e scrivi gli input QM (sezione 9). Poiché è attiva la traiettoria non correlata, la frequenza di campionamento è già 1.
10. **Conserva la registrazione**: *History › Save session* (sezione 10.2) e *ⓘ References* (sezione 10.3).

## 9. Estrazione e input di chimica quantistica

L’estrazione scrive, per gli atomi che scegli, la traiettoria completa di quegli atomi, le configurazioni campionate e un insieme di input QM per configurazione. Gira sulla traiettoria attiva (sezione 2.4).

### 9.1 Aprire l’estrazione

![Il visualizzatore 3D del flusso di estrazione](img/view3d.png "MONET Custom Functionalities › 3D viewer & extraction, con il pannello del flusso a sinistra: gli stessi strumenti del visualizzatore del modulo ASE.")

**Passaggi.** Premi **Extraction →** (nella barra a sinistra, nell’intestazione ASE o nel passo 02). Il pannello del flusso si apre al passo 03 e il visualizzatore passa a **3D viewer & extraction**, dove scegli gli atomi da estrarre.

### 9.2 Passo 03 — Sampling

**A cosa serve.** A scegliere quali configurazioni estrarre: una ogni N frame della traiettoria attiva.

![Il passo Sampling dopo Accept t*](img/sampling.png "Sampling dopo Accept t*: il passo indica la traiettoria non correlata, la frequenza è già 1 e verranno estratte le 7 configurazioni indipendenti.")

**Passaggi.**

1. Leggi la prima riga: quale traiettoria viene campionata e quante configurazioni ha.
2. Imposta la **Sampling frequency**:
  - se hai accettato t* (sezione 6.3) è attiva la traiettoria non correlata e la frequenza è già **1**: ogni frame è indipendente;
  - se hai usato *Only set the sampling frequency*, contiene già lo stride;
  - altrimenti scrivi tu lo stride.
3. Controlla **Sampled configurations** e premi **Next →**.

### 9.3 Passo 04 — Atom selection

**A cosa serve.** A scegliere gli atomi da tenere nelle configurazioni estratte, per esempio la molecola che calcolerai con la QM e il suo primo guscio di solvatazione.

![Il passo Atom selection](img/atom_selection.png "Atom selection: clicca gli atomi nel visualizzatore, oppure scrivi i MONET ID e premi Apply. Gli atomi scelti sono dorati; la tabella li elenca con le coordinate.")

**Passaggi.**

1. Clicca gli atomi nel visualizzatore 3D, oppure scrivi i MONET ID (`1 5 12 23`) e premi **Apply**, oppure premi **Use atoms picked in the ASE analysis** per riusare le scelte della sezione 4.2.
2. Estendi la selezione con la barra degli strumenti (*element, All, Invert, + Bonded, + Molecules, + Within R*) o con il menu del clic destro (sezione 4.3).
3. Controlla il numero sotto **Selected** e premi **Next →**.

### 9.4 Passo 05 — Options e codici di chimica quantistica

**A cosa serve.** A scegliere cosa scrive l’estrazione oltre alle coordinate: la struttura media e gli input di uno o più codici QM.

![Il passo Options](img/options.png "Options: struttura media e input di chimica quantistica. Gli stati elettronici (carica e molteplicità) sono condivisi da tutti i codici.")

**Passaggi.**

1. Spunta **Compute average structure** per avere `GEO-AVERAGE.xyz` (tutti gli atomi, semplice media cartesiana su tutti i frame).
2. Spunta i codici che ti servono: **Gaussian, ORCA, QE pw.x, VASP, CP2K, Qbox**.
3. Imposta la **Charge** e le **Multiplicities** (un file per molteplicità: 1 → `sing`, 2 → `doub`, 3 → `trip` …).
4. Apri la scheda di ogni codice e impostane le opzioni (sotto); premi **Preview (configuration 1)** per vedere il file che scriverà.
5. Leggi la riga di stato sotto le schede, poi premi **Run →**.

![Le schede dei codici di chimica quantistica](img/qm_codes.png "Ogni codice ha la sua scheda: tipo di calcolo, metodo o funzionale, base o cutoff, dispersione, solvente, punti k e pseudopotenziali, parole chiave extra e una Preview della configurazione 1.")

* Ogni scheda imposta il tipo di calcolo (single point, ottimizzazione, frequenze, TD-DFT, MD …), metodo o funzionale, base o cutoff, dispersione, solvente, punti k, pseudopotenziali e parole chiave extra, e può cambiare carica e molteplicità.
* **Edit templates** sostituisce un file generato con un testo tuo (con segnaposto come `{coords}`, `{charge}`, `{mult}`); la scheda mostra allora *custom template*.
* Gaussian e ORCA non richiedono una cella. I codici a onde piane (QE, VASP, CP2K, Qbox) ne richiedono una, presa in quest’ordine: il flag *Isolated system: vacuum box* della scheda, la cella personalizzata della scheda, la cella della sezione 4.4, la cella di ogni frame. Senza cella **Run** resta disabilitato e **Define cell…** porta al pannello della cella.
* **Build POTCAR** di VASP legge la tua libreria di POTCAR (solo con il launcher); MONET non distribuisce mai i file POTCAR.

### 9.5 Passi 06 e 07 — Processing e Results

![Processing](img/processing.png "Processing: avanzamento e registro; Cancel ferma l’estrazione. Al termine, Download results ZIP.")

**Passaggi.**

1. Il passo 06 mostra l’avanzamento e un registro; **Cancel extraction** lo ferma.
2. Al termine premi **Download results ZIP** (nell’app desktop i file vanno nella cartella scelta).
3. **Results →** mostra il riepilogo e l’albero delle cartelle.

![Results](img/results.png "Results: il riepilogo e l’albero delle cartelle. Nel browser i risultati sono un unico file ZIP.")

**Come leggere il risultato.** Lo ZIP contiene:

* `0-HISTORY/run.json` — le impostazioni dell’estrazione;
* `1-FULL_TRAJECTORY_EXTRACTED/` — gli atomi scelti in ogni frame;
* `2-SAMPLED_CONFIGURATIONS/` — `SAMPLED_CONFIGURATIONS.xyz` e, per ogni configurazione, `confN/posN.txt` con i suoi input QM (Gaussian in `confN/`, gli altri in `confN/orca/`, `confN/qe/`, `confN/vasp/`, `confN/cp2k/`, `confN/qbox/`);
* `3-AVERAGE_STRUCTURE/GEO-AVERAGE.xyz` — la struttura media, se richiesta.

**ASE Analysis →** torna alle analisi, ora sulla traiettoria estratta; **New Run** avvia un’altra estrazione.

## 10. Cronologia, console e rapporti

### 10.1 La cronologia e la console

**A cosa serve.** MONET registra ogni passaggio che cambia un risultato: il file e il suo checksum (SHA-256), la cella e l’asse dei tempi, ogni analisi con i suoi parametri e i numeri chiave, le traiettorie derivate e le esportazioni. Ruotare la vista o cambiare i colori non viene registrato. Il registro resta sul tuo computer (`~/.monet/sessions/`, salvato automaticamente) e memorizza i nomi dei file, mai i percorsi. Ti permette di riportare esattamente cosa hai fatto e di ripeterlo.

![La console del cassetto History](img/history_console.png "History › Console (Ctrl+`): ogni passaggio è una chiamata, per esempio acf(quantity=dihedral, groups=[[1, 2, 3, 4]], …). Clicca una riga, modificala e premi Invio per rieseguirla; help() elenca le analisi.")

**Passaggi per ripetere un passaggio con altri parametri.**

1. Premi **History** nella barra del titolo (o Ctrl+`) e apri la scheda **Console**.
2. Clicca una riga: viene copiata nel campo di inserimento in basso.
3. Cambia un parametro (per esempio `frame_step=5`) e premi Invio. L’analisi riparte dal suo pannello, con gli stessi controlli del suo pulsante; il nuovo passaggio è collegato all’originale.
4. Scrivi `help()` per l’elenco delle analisi, `help(acf)` per i parametri di una.

![Il registro della cronologia](img/history_log.png "History › History: filtri, dettagli di ogni passaggio e dei suoi genitori, una nota e un segno ☆ final. History: on / paused ferma e riprende la registrazione.")

**Passaggi per annotare il registro.** Nella scheda **History** clicca un passaggio per vederne i dettagli e i genitori; scrivi una **Note**, spunta **☆ final** per i risultati che pubblicherai. **History: on / paused** sospende la registrazione per un po’ (il rapporto segnala poi l’interruzione).

### 10.2 Salvare, riaprire e rieseguire

**Passaggi.**

1. **Save session** scrive uno ZIP con `session.json`, `methods.md` (e `methods.docx` se è installato pandoc) e `replay.py`. `methods.md` elenca le versioni del software con le citazioni, i checksum degli input, ogni passaggio e una lista di controllo già compilata. **Export methods report** ed **Export replay.py** scrivono solo quei due file; con *final steps only* spuntato il rapporto tiene solo i passaggi ☆.
2. **Open session** ripristina un registro salvato in sola lettura (non riesegue mai nulla). Carica la traiettoria con lo stesso checksum per continuare a lavorarci; il registro riaperto è una copia e non sovrascrive mai l’originale.
3. Per ripetere tutta l’analisi senza la finestra, esegui `python replay.py --monet /percorso/di/MONET` nella cartella che contiene la traiettoria. Controlla i checksum, riesegue ogni passaggio e confronta i numeri chiave con quelli registrati: `OK`, `DIFF`, oppure `RAN` quando non c’è nulla di grezzo da confrontare.

### 10.3 Cosa citare

![La finestra References](img/references.png "ⓘ References: cosa citare per MONET, ASE, MDAnalysis e ogni analisi usata, in Chicago o BibTeX, con Copy e Download .bib.")

**Passaggi.** Premi **ⓘ References** nella barra del titolo (o **ⓘ Cite** accanto a un’analisi per quella sola), scegli **Chicago** o **BibTeX**, poi **Copy** o **Download .bib**.

## 11. Aggiungere analisi proprie (plugin)

**A cosa serve.** Un’analisi tua, scritta come una funzione Python, con lo stesso modulo, grafico, cronologia e replay di quelle integrate.

Un plugin è una funzione decorata con `@analysis`: dichiara i suoi campi (`params`), riceve i frame della traiettoria attiva (`ctx.frames()`) e restituisce una serie da disegnare. Questo misura la distanza tra coppie di atomi:

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

**Passaggi.**

1. Salva il codice qui sopra come `~/.monet/plugins/end_to_end.py` (crea la cartella se serve).
2. Ferma il launcher (Ctrl+C) e riavvialo: i plugin si leggono all’avvio.
3. Apri la scheda *More analyses* del modulo (`engine='custom'` → MONET Custom Functionalities, `'ase'` → ASE, `'mdanalysis'` → il menu di MDAnalysis), scegli la tua analisi, compila i campi e premi **Compute**.

![Un plugin in More analyses](img/plugin_result.png "MONET Custom Functionalities › More analyses: il plugin del raggio di girazione fornito con MONET, eseguito sulla scatola d’acqua.")

I plugin si leggono da `plugins/`, `~/.monet/plugins/`, dalle cartelle di `MONET_PLUGINS` e dai pacchetti installati. Girano con i tuoi diritti di utente: usa solo codice di cui ti fidi. Un plugin che non si carica viene elencato con il suo errore; gli altri continuano a funzionare. Il riferimento completo è `docs/plugins.md`.

## 12. Lavorare con un assistente AI (MCP)

**A cosa serve.** `monet_mcp.py` permette a un assistente AI che parla il Model Context Protocol (Claude Desktop, Claude Code, Gemini CLI) di usare MONET per te: chiedi in linguaggio naturale di aprire una traiettoria, eseguire un’analisi o scrivere una traiettoria derivata, senza la finestra di MONET.

**Passaggi.**

1. Installa l’SDK nell’ambiente di MONET: `.venv/bin/python -m pip install "mcp>=1.2"` (Windows: `.venv\Scripts\python -m pip install "mcp>=1.2"`).
2. Registra il server nel tuo assistente, con il percorso assoluto di quel Python, le cartelle che può leggere (`--data`) e quella in cui scrive (`--output`); `docs/mcp.md` dà il comando o la configurazione esatti per ogni assistente.
3. Chiedi, per esempio: *apri ~/runs/ethanol.xyz con un passo di 0,5 fs e dimmi se è equilibrata*.

Il server gira sul tuo computer e non legge mai fuori da `--data` né scrive fuori da `--output`; i risultati che restituisce vanno al fornitore del tuo assistente come qualsiasi contenuto di una chat.

## 13. Risoluzione dei problemi

| Problema | Cosa fare |
|---|---|
| Il badge ASE nella barra del titolo non mostra la versione di ASE | Usa il launcher (non `index.html`); premi **Recheck**; se la connessione è persa, ferma il launcher e riavvialo. |
| *Cannot start MONET* / porta occupata | Avvia con `--port 8766` (o un’altra porta libera). |
| macOS o Windows blocca il launcher | macOS: clic destro › **Apri**; Windows: **Ulteriori informazioni › Esegui comunque**. |
| MSD, VDOS o autocorrelazione sono disabilitati | Scrivi il passo temporale MD nella riga **Time axis** (sezione 4.5). |
| Le distanze periodiche sembrano sbagliate | Definisci la cella (sezione 4.4) e spunta la casella della minima immagine; le direzioni periodiche devono essere attive. |
| *Atom identity* mostra celle rosse | MONET, ASE e MDAnalysis leggono atomi diversi (struttura di riferimento o ordine degli atomi sbagliati): carica la topologia giusta (sezione 3.3). |
| Una traiettoria XTC/TRR/DCD ha tutti gli atomi X | Aggiungi la topologia come struttura di riferimento (sezione 3.2). |
| Un risultato sparisce dopo aver cambiato la cella | Applicare una cella o cambiare la casella della minima immagine cancella le analisi di proposito; ricalcola. |
| Le analisi girano su meno frame del previsto | È attiva una traiettoria derivata (sezione 2.4): leggi la riga Source, premi **↩ Full trajectory** per tornare indietro. |
| Un’analisi resta allo 0 % | Premi **Cancel running calculation**; i lag molto lunghi dell’ACF si limitano con **Max lag**. |
| Un’analisi ASE o MDAnalysis non è offerta | Il modulo manca nell’ambiente Python del launcher: reinstalla `requirements.txt`. |

## 14. Tasti e mouse

| Azione | Come |
|---|---|
| Ruotare / spostare / ingrandire il visualizzatore | trascina / trascina con il tasto destro o Maiusc+trascina / rotella |
| Scegliere o rilasciare un atomo | clic (o la riga della tabella degli atomi) |
| Menu di selezione | clic destro su un atomo o su uno spazio vuoto |
| Avviare o fermare, avanzare | Spazio, ← / → |
| Uscire dal visualizzatore espanso | Esc |
| Aprire cronologia e console | Ctrl+` |
| Ingrandire un grafico / ripristinare | trascina su di esso / doppio clic |

## 15. Come citare, licenza e ridisegnare le immagini

Cita MONET (T. Francese, *MONET: Molecular Dynamics Extractor*, Zenodo, doi:10.5281/zenodo.22816521, con la versione mostrata nella barra del titolo) insieme all’articolo PCCP 2022 (doi:10.1039/d2cp01147f) e alle librerie delle analisi che hai usato; **ⓘ References** scrive l’elenco (sezione 10.3). MONET è sotto licenza MIT; ASE e MDAnalysis sono pacchetti separati con le loro licenze.

Le immagini di questo manuale sono disegnate dal programma in esecuzione da `tools/make_manual_images.py` (servono `pip install playwright pillow` e Chromium). Dopo una modifica dell’interfaccia esegui `python tools/make_manual_images.py` (oppure `--only window,acf_result`) e fai il commit dei nuovi `manual/img/*.png`; il diagramma del flusso `manual/img/workflow.svg` è disegnato a mano. Il testo è `manual/MANUAL.md` e `manual/MANUAL.it.md`; mantieni le stesse sezioni e le stesse immagini in entrambi: un test lo controlla.

### Storia delle revisioni

| Versione | Data | Modifica |
|---|---|---|
| MONET 2.7.1 | 2026-10-10 | Prima versione del manuale (inglese e italiano). |
| MONET 2.7.1 | 2026-10-10 | Concetti chiave (MONET ID, asse dei tempi, minima immagine, traiettoria attiva, DS e SEM) e un diagramma del flusso di lavoro; ogni analisi spiegata con a cosa serve, passaggi, come leggere il risultato e a cosa fare attenzione; nuove immagini di Use selection, della traiettoria attiva e della convalida del plateau. |

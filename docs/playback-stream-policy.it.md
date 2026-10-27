# Limiti di qualità e recupero dei flussi in diretta

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Proprietà del decoder](device-media-backend.md)

Il lettore HTML5/HLS/Shaka gestito mantiene un solo diritto di riproduzione mentre recupera da una sorgente guasta. Può inoltre usare fino a tre URL di riserva configurati esplicitamente per un canale in diretta. Non scopre, indovina o sostituisce mai un canale in base al titolo.

![Recupero: un diritto di riproduzione, tentativi finiti e riserve esplicite](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Impostare un limite di qualità

Aprire **Impostazioni → Impostazioni interfaccia** e impostare **Altezza video massima (HLS/Shaka)** e/o **Bitrate massimo del flusso (HLS/Shaka)**. I due vincoli si applicano insieme. **Automatico** rimuove il vincolo corrispondente. Le scelte supportate sono 360/480/720/1080/2160 pixel e 1/2/4/8/16 Mbps. Le impostazioni sono salvate localmente, seguono il normale flusso salva/annulla e si applicano al successivo avvio della riproduzione, incluso un riavvio di recupero.

Sono limiti superiori, non impostazioni di transcodifica. Un flusso disponibile solo in 1080p non diventa 720p. Se nessuna variante dichiarata soddisfa i limiti, il lettore segnala **No stream meets the quality limits** e smette di ritentare la richiesta. Altezza/bitrate sconosciuti non dimostrano che una variante HLS rispetti il vincolo.

Il filtraggio delle varianti HLS precede il caricamento dei frammenti. L'hls.js attuale elimina le varianti non idonee; le vecchie versioni senza `removeLevel` possono conservare solo un prefisso contiguo sicuro e rifiutare un manifesto con varianti successive altrimenti idonee. Shaka usa i vincoli applicativi `maxHeight`/`maxBandwidth`. L'adattamento automatico continua fra le varianti rimaste.

Le impostazioni valgono per i motori HLS e Shaka gestiti. HTML5 semplice, decoder nativi di piattaforma e motori TV/STB mantenuti non espongono gli stessi controlli. Auto può scegliere la riproduzione nativa; l'impostazione non la forza a MSE. Il lettore non sposta una richiesta HLS già vincolata su una riproduzione nativa senza limiti solo per aggirare un errore di decodifica. Non sono impliciti un transcodificatore nativo, un benchmark hardware automatico o una garanzia di uscita fisica a 720p.

<a id="configure-explicit-backups"></a>

## Configurare riserve esplicite

1. Avviare il canale in diretta desiderato.
2. Aprire **Informazioni → Flussi di riserva**.
3. Selezionare lo spazio 1, 2 o 3 e inserire un URL multimediale HTTP/HTTPS completo.
4. Riaprire uno spazio occupato per **Modificare** o **Eliminare**. Avviare di nuovo il canale per usare l'elenco aggiornato.

Ogni spazio appartiene al namespace di archiviazione del provider corrente e alla coppia esatta `sourceId`/`channelId`. La generazione di riproduzione e la configurazione della sorgente correnti delimitano l'editor. Cambiare sorgente con un dialogo aperto impedisce a quel dialogo di salvare nella sorgente sostitutiva. Una modifica concorrente allo stesso spazio viene rifiutata invece di sovrascritta.

Il primo URL rimane la sorgente ordinaria del canale. Gli spazi duplicati e vuoti vengono saltati. Si accettano al massimo 256 record di canale e 256 KiB di configurazione. Si rifiutano URL con credenziali user-info, spazi bianchi, caratteri di controllo, barre inverse o porta non valida. I token di query del provider possono comunque far parte di un URL multimediale: queste impostazioni sono configurazione locale della sorgente, non un meccanismo per condividere o pubblicare credenziali.

Le riserve valgono **solo per la diretta**. Le richieste archivio e VOD non usano mai un'alternativa in diretta: registrazione, origine temporale, diritti e semantica di ricerca possono differire. Il proprietario deve fornire endpoint live equivalenti e autorizzati. Un titolo di canale uguale non prova l'equivalenza. Identità salvata del canale, preferiti e associazione EPG restano invariati quando cambia l'endpoint di trasporto.

<a id="recovery-guarantees"></a>

## Garanzie di recupero

- La richiesta ha al massimo **due tentativi transitori differiti sullo stesso URL in totale** e al massimo un avanzamento verso ciascuno dei tre spazi di riserva: non più di cinque ricreazioni dopo l'avvio iniziale. Una nuova istanza del decoder o un manifesto riuscito non azzerano il budget. Il recupero HLS limitato di rete e decodifica interno al motore precede questa politica esterna.
- Errori di analisi di manifesto/livello HLS consentono al massimo una riconnessione allo stesso URL per richiesta, conteggiata nello stesso totale di due tentativi. Un nuovo decoder o endpoint di riserva non azzera questo limite.
- Errori di rete senza stato, HTTP 408/429 e 5xx possono usare il budget transitorio. Altri HTTP 4xx possono avanzare a un'alternativa configurata, ma non ritentano lo stesso URL. **HTTP 401/403 ed errori di accesso alla sorgente terminano la richiesta**, senza provare credenziali alternative o endpoint di riserva.
- Errori di decodifica possono avanzare a una riserva esplicita. Limiti di qualità impossibili terminano la richiesta. Non si torna ciclicamente alla sorgente primaria.
- Il ritardo è 500 ms, 1 s, 1.5 s, poi al massimo 2 s. Le callback ripetute vengono accorpate.
- Pause rimuove il timer pianificato mantenendo il tentativo in attesa; Resume lo pianifica di nuovo. Stop, standby e sostituzione di sorgente o canale invalidano le callback differite. Una richiesta fallita definitivamente richiede una nuova selezione esplicita, non la riproduzione automatica del decoder ritirato.
- Errori di caricamento Shaka ed eventi di errore critici condividono questo percorso; gli errori di annullamento vengono ignorati. Il ricollegamento attende la distruzione asincrona di Shaka.
- Il recupero risolve nuovamente un riferimento opaco Stalker e prepara di nuovo l'accesso protetto alla sorgente. Non riutilizza URL loopback iOS scaduti. La posizione VOD/archivio viene rilevata prima dello smontaggio; le riserve live partono dal loro limite attuale della diretta.

Il recupero facoltativo basato sull'orologio multimediale della diretta è descritto di seguito. Il recupero esistente di kiosk, Auto/native e HLS mantiene i propri ambiti e il comportamento dei motori.

<a id="verification-and-observability"></a>

## Verifica e osservabilità

`window.__ottStreamPolicy.snapshot()` espone nome del motore, limiti richiesti, capacità/disponibilità, numero di tentativi, indice dell'endpoint e stato di recupero. Non contiene URL del flusso né credenziali del provider. L'indice zero indica la sorgente ordinaria; i successivi le alternative uniche non vuote. È stato diagnostico, non un'API stabile di controllo remoto.

Eseguire:

```sh
node tests/test_stream_policy.cjs
node tests/test_port_engine_lifecycle.cjs
node tests/test_settings_parity.cjs
node tests/test_media_backend.cjs
npm run test:localization
npm run typecheck
npm run build:server
node scripts/check-es5.cjs --server-only
```

I test esercitano filtraggio di qualità con ordine non monotono delle varianti, metadati indisponibili, modifica per sorgente, conflitti degli spazi, errori duplicati, budget limitati, errori di autorizzazione HTTP, annullamento per pausa/stop/sorgente, smontaggio Shaka e mantenimento della posizione VOD. Le cinque nuove etichette di riproduzione sono tradotte negli 88 pacchetti linguistici inclusi; la parità automatica non è revisione di madrelingua. La riproduzione fisica TV/D1 e i manifesti specifici dei provider richiedono ancora verifica sul dispositivo. [Sorgente modificabile del diagramma](diagrams/stream-recovery.mmd).

<a id="live-stall-recovery"></a>

## Recupero di una diretta bloccata

In **Impostazioni → Impostazioni interfaccia**, selezionare **Tentativi di recupero della diretta** (0–5) e **Timeout del blocco della diretta, s** (10/15/20/30). I valori predefiniti sono 0 tentativi e 15 secondi. Zero disattiva solo questo controllo; il recupero esistente degli errori del motore rimane invariato. Le impostazioni utilizzano il normale flusso Salva/Annulla.

Dopo un avanzamento verificato della riproduzione, l'arresto dell'orologio multimediale della diretta principale richiama il `backend.restart()` esistente. Pausa, ricerca di posizione, pagine nascoste, stato offline e kiosk sospendono l'osservazione; archivio, VOD e flusso PiP sono esclusi. Il PiP nativo nasconde l'OSD HTML. I cambiamenti di canale, sorgente o generazione annullano l'osservazione precedente. Una riproduzione iniziale che non avanza mai rimane soggetta alla gestione esistente di avvio ed errori. La sostituzione del decoder e un breve avanzamento non ripristinano il numero di tentativi disponibili: lo fanno dieci secondi di avanzamento continuo. Esaurito il limite, il controllo non effettua altri riavvii per quel blocco. Un recupero del motore in attesa ha priorità; gli errori terminali di autorizzazione, DRM o qualità non possono essere aggirati. Si osserva il tempo multimediale, non la visualizzazione fisica dell'immagine né i fotogrammi congelati mentre l'orologio multimediale continua ad avanzare.

Per una prova di base senza abbonamento, scegliere **Prova demo**. Una volta avviata la riproduzione, impostare temporaneamente `document.getElementById("video").playbackRate = 0` nei DevTools della scheda di prova; poi ripristinare il valore 1. La pausa è intenzionalmente esclusa dal recupero dei blocchi.

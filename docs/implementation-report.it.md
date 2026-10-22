# Dall'elenco delle funzionalità al comportamento verificato

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Contratti delle funzionalità](roadmap-delivery.it.md) · [Misure delle dimensioni](roadmap-size.it.md)

Questo rapporto documenta implementazione e consolidamento, non annuncia una release. Lo snapshot misurato del lettore è `652726f8`; quello Android nativo, compilato separatamente, è `be0d800`. CI, merge e promozione della release restano controlli distinti. Commit successivi di sola documentazione o test non trasformano una verifica locale nella prova che un dispositivo installato sia stato aggiornato. Gli stati seguenti appartengono a quegli snapshot storici; non sono un monitoraggio delle release in tempo reale. Le build pubblicate si trovano in [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases).

![Processo di implementazione e controlli di accettazione](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Come è stato verificato il lavoro

La richiesta iniziale è stata divisa in 13 parti funzionali utilizzabili tra lettore classico, servizio di controllo/CLI e applicazione Android nativa indipendente. Le responsabilità sono state assegnate per componente per revisionare e integrare modifiche simultanee senza sostituire il lavoro di un altro componente. La nuova interfaccia ha riutilizzato etichette tradotte esistenti o aggiunto voci ai cataloghi di tutte le 88 lingue; le guide tecniche complete erano originariamente in inglese e russo. Ora il manuale principale e le guide funzionali abbinate hanno edizioni complete in [24 lingue di documentazione](manual-translations.md).

L'implementazione è stata seguita da revisioni incrociate indipendenti e test di regressione eseguibili. Prima di cambiare codice, ogni problema segnalato è stato confrontato con il percorso effettivo di callback, decoder, archiviazione o focus. I fallimenti dei test sono stati distinti tra regressioni del comportamento e selettori obsoleti. Per esempio, il passaggio delle righe classiche da `button` a `option` richiedeva nuovi selettori, non giustificava l'indebolimento del comportamento di clic atteso.

Build di produzione pulite hanno poi controllato gli artefatti ES5 emessi e il costo JavaScript totale, inclusi i moduli opzionali dei provider. I test mirati del browser usavano loader, bundle e adattatori dei dispositivi distribuiti. Android nativo ha ricevuto un'esecuzione separata di test Gradle, lint e pacchettizzazione. Controlli dei PR e discussioni di revisione vengono ricontrollati dopo il push; una build locale riuscita non li sostituisce.

<a id="what-changed-during-review"></a>

## Cosa è cambiato durante la revisione

![Cinque comportamenti corretti e costo JavaScript misurato](diagrams/implementation-results.svg)

- **Parsing HLS e tentativi:** gli errori di parsing inizialmente condividevano la classificazione generica di rete. Ora consentono al massimo una riconnessione allo stesso URL nel limite di due tentativi per errori transitori; nuovi decoder e URL di backup non lo azzerano. Un errore terminale di autenticazione/DRM annulla anche un tentativo transitorio già in coda.
- **Fallback nativo Auto:** la gestione degli errori nativi poteva ritirare la richiesta quando Auto possedeva già un fallback. Ora il proprietario esistente mantiene quella transizione; l'annullamento continua a invalidarne i callback ritardati.
- **Invio nei modali:** il focus automatico sul primo pulsante Annulla trasformava Invio nella finestra di attesa Plex in annullamento. Ora i dialoghi iniziano con il focus sul dialogo stesso. Tab raggiunge esplicitamente i pulsanti; i normali dialoghi informativi e di conferma mantengono il comportamento di Invio ed Esc/Indietro.
- **Selezione col puntatore su PC:** il focus del mouse cambiava la selezione prima del gestore del clic, trasformando il primo clic in attivazione. Il focus causato dal puntatore non preseleziona più la riga. Il PC continua a selezionare e poi attivare; LG mantiene il singolo clic. Il focus della tastiera segue ancora la selezione.
- **Tracce Android:** una selezione senza etichetta dell'elemento corrente poteva essere cancellata dalla propria conferma Auto o dall'aggiornamento di una preferenza dei sottotitoli, oppure passare a un altro elemento con `TrackGroup` uguale. Ora sopravvive alle scritture ritardate solo per l'elemento corrente. Le preferenze semantiche usano lingua/ruolo/etichetta; ViewModel gestisce la persistenza, quindi chiudere il pannello non annulla la scrittura.

Le 13 parti consegnate sono: campione A/V; configurazione Local/Home riprendibile; recupero limitato; tetti di qualità; preferenze tracce Android; chiavi di controllo con ambito; associazioni XMLTV; film/serie Xtream; accessibilità classica; esiti durevoli dei comandi; passaggio esplicito; flussi di backup; lotti di impostazioni recuperabili. La [guida alle funzionalità](roadmap-delivery.it.md) definisce ambito e limiti di ciascuna.

<a id="evidence-and-remaining-gates"></a>

## Evidenze e controlli rimanenti

Per `652726f8` sono passati i cinque scenari mirati nel browser: navigazione col puntatore LG webOS, navigazione col puntatore LG NetCast, doppio clic PC, semantica da tastiera dei dialoghi e raccolta/risoluzione/annullamento/nuovo tentativo Plex. Sono passati TypeScript, fixture unitaria di accessibilità, lint mirato, ES5 e budget dei bundle. L'intera esecuzione nel browser su questa build ha concluso con **194 test riusciti e uno saltato**: HLS nativo richiede WebKit, mentre l'esecuzione usava Chromium. CI ospitata e sequenza di merge concordata restano controlli separati.

La catena rimanente `test:port` e `test:unified` è stata completata in segmenti ripresi dopo aver corretto fixture isolate. Ogni obiettivo fallito è stato rieseguito con successo e i comandi rimanenti sono riusciti; non si afferma un'unica esecuzione ininterrotta di `npm test`. Anche l'esatto passo CI del bridge Android, composto da nove comandi, è passato localmente.

Per Android `be0d800` sono passati localmente **101 test dell'app e 62 del nucleo condiviso**, oltre a lint debug/release, assemblaggio APK Debug/Release/Full, bundle di release e compilazione dell'APK androidTest. Compilare l'APK dei test strumentati non significa eseguirlo su un dispositivo. I tre rilievi confermati della revisione hanno ricevuto risposta e sono stati risolti in [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68). Il PR ha superato i controlli ed è stato unito come `5b644b94`; la CI post-merge è seguita separatamente. Il diagramma lascia in sospeso il controllo complessivo CI/release del lettore.

Il JavaScript web completo è passato da **964,459 / 305,344** byte grezzi/gzip a **995,858 / 315,207**: **+31,399 / +9,863 byte** (circa 3.26% / 3.23%). Il candidato funzionale era 995,587 / 315,103; il consolidamento successivo ha aggiunto 271 / 104. L'entry point principale finale di quello snapshot è 875,197 / 270,425. Vedere la [misura iniziale](evidence/roadmap-size-20261015.json), la [misura dell'artefatto finale](evidence/roadmap-final-size-20261015.json) e il [metodo di misura](roadmap-size.it.md). Le virgole in questi conteggi di byte separano le migliaia.

Sono costi storici in byte JavaScript, **non miglioramenti di velocità misurati**. I totali escludono motori multimediali, dizionari, CSS, immagini e video. I pacchetti di quello snapshot includevano separatamente il clip A/V da 464,652 byte. Dopo il [cambio di hosting](audio-video-check.it.md), `diagnostics/av-v1.mp4` resta nel repository con generatore e verificatore per la riproducibilità, ma è escluso dai pacchetti Web/OTTPlay Server, Tauri, Capacitor e Docker. Il lettore lo scarica da here.now solo per il controllo A/V esplicito, che richiede internet; la riproduzione all'avvio non lo scarica. Rimuovere 464,652 byte multimediali grezzi non stabilisce il risparmio negli installer compressi né modifica le misure storiche JavaScript. Tempo di avvio, regolarità dei fotogrammi, memoria, esperienza con lettore di schermo, audio HDMI reale e comportamento dei provider richiedono proprie misure sui dispositivi di destinazione. Il rapporto non afferma nuovi risultati su dispositivi fisici né una release beta. La [lista di accettazione fisica](roadmap-delivery.it.md#physical-acceptance-before-promotion) e la [strategia delle release](../RELEASING.md) restano i criteri di promozione.

<a id="post-beta-integration-and-review"></a>

## Integrazione e revisione dopo la beta

Dopo la pubblicazione di beta.4, il sorgente `39287792` è stato integrato in questo ramo. La revisione runtime `9663b681` corregge anche il ripristino al margine live sotto limiti di qualità HLS e consente di recuperare un journal delle impostazioni danneggiato prima dell'avvio normale. La schermata di recupero blocca l'idratazione parziale degli account, supporta nuovo tentativo e ripristino confermato, conserva cookie estranei e impedisce il ritorno delle vecchie impostazioni nei cookie dopo il ripristino. Vedere il [processo di recupero](settings-recovery.it.md) e il relativo diagramma SVG.

![Confronto JavaScript completo dopo la beta](diagrams/post-beta-size.svg)

Riprodurre entrambi i sorgenti con Node 26.8.2, Rollup 4.64.5 e Terser 5.51.2 produce **964,876 / 305,452** byte grezzi/gzip per il sorgente beta.4 e **1,000,388 / 316,600** per l'integrazione: **+35,512 / +11,148 byte** (3.68% / 3.65%). I totali includono tutti i provider opzionali: sette nella base e otto nell'integrazione. Il nuovo entry point è 879,533 / 271,761. È un confronto distinto dai grafici precedenti congelati.

Entrambe le build locali di produzione rigenerano cinque file runtime tracciati e omettono la dichiarazione di una revisione sorgente pulita. I rapporti registrano questo limite anziché identificare i file locali come artefatti pubblicati: [base](evidence/post-beta-baseline-size-20261015.json) e [integrazione](evidence/post-beta-candidate-size-20261015.json). La build integrata e i controlli ES5/nativi passano. Passano anche sei controlli mirati nel browser: recupero/ripristino del journal, tastiera dei dialoghi, puntatore LG webOS e NetCast, selezione PC a due clic e attesa Plex con proprietario.

<a id="browser-gate-integration"></a>

## Integrazione del controllo browser

![Risultati confermati della verifica locale dei browser](diagrams/browser-verification-results.svg)

Il sorgente `c52f4d07` incorpora PR 779 da main `1ecbc0e7`. Sono preservati comandi di test, verifiche di recupero e asserzioni sui dialoghi Plex di entrambi i rami. Passano TypeScript, lint, documentazione, contratti di packaging/linker, build di produzione e controlli completi dei bundle compilati. Tutti i 27 file JavaScript generati di lettore/provider restano identici byte per byte agli artefatti misurati sopra. La suite completa browser/dispositivi su quella build termina con **196 test riusciti e un'esclusione prevista su Chromium** per HLS nativo, che richiede WebKit.

L'esatto archivio confezionato Mode A è stato estratto solo dopo averne verificato sorgente, checksum e inventario dei bundle/provider. Chromium 156.0.8078.4, Firefox 157.0 e WebKit 27.2 hanno superato ciascuno tutti i cinque scenari di profilo senza esclusioni o nuovi tentativi: **15 successi locali** con Playwright 1.64.0. L'host effettivo era macOS 26.7.1, non il runner `macos-15` nominato nei profili scelti. Le ricevute registrano esplicitamente questa differenza e **non sono una qualifica della matrice ospitata o della release**. Vedere il [riepilogo locale](evidence/post779-local-acceptance/summary.json) e la [procedura riproducibile](evidence/post779-local-acceptance/reproduce.sh), che richiede una build di produzione esistente e rifiuta di sostituire una directory di candidato estratto.

La [politica browser](browser-compatibility.it.md) richiede cinque obiettivi ospitati e 25 esecuzioni di scenari per PR/beta; il RC completo prevede 35 obiettivi e 166 esecuzioni. Sono requisiti configurati, non copertura misurata.

![Come la verifica del candidato produce evidenze](diagrams/candidate-verification-flow.svg)

La [pipeline beta](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) separata per main `1ecbc0e7` è riuscita. Non include questo PR. L'integrazione richiede ancora una propria CI ospitata riuscita e una revisione, poi il coordinamento della release; i risultati locali sopra non affermano che questi controlli di consegna siano passati.

<a id="delivery"></a>

## Consegna

- [Lettore, documentazione e i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Server di controllo e CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Preferenze tracce Android — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

Questi PR riportano lo stato attuale di CI e merge. La modifica del lettore segue le correzioni Plex attuali concordate e la loro beta come un'ondata di consegna separata.

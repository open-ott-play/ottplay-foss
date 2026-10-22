# Miglioramenti di affidabilità e riproduzione

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.it.md) · [Architettura](architecture.md)

Questa guida descrive l'implementazione nella revisione sorgente di questa pagina, non le capacità di una versione precedente installata. Il lettore, il servizio di controllo/CLI e l'app Android nativa sono artefatti separati. Aggiornarne uno non aggiorna gli altri.

![Responsabilità e confini di fiducia](diagrams/roadmap-components.svg)

Vedere il [costo misurato in byte e il grafico comparativo](roadmap-size.it.md); velocità di esecuzione e riproduzione sui dispositivi richiedono verifiche di accettazione separate.

<a id="what-is-implemented"></a>

## Funzionalità implementate

1. **Un campione audio/video noto.** [Informazioni → Audio](audio-video-check.it.md) riproduce un filmato di otto secondi da here.now (Internet necessario), con toni sinistro/destro e lampi corrispondenti. Viene scaricato solo dopo **Riproduci**, mai all'avvio; il file multimediale non è incluso nei pacchetti del lettore. Usa temporaneamente il decoder HTML5 principale solo in inattività o durante la TV in diretta. Non scrive nella cronologia di visione. [Specifica del campione](../diagnostics/README.md).
2. **Configurazione Local/Home riprendibile.** La CLI di controllo può pianificare, applicare, riprendere e verificare un preset. Confronta le impostazioni salvate prima di ripetere una scrittura dall'esito incerto. [Procedura di controllo](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Recupero limitato della riproduzione.** Gli errori transitori HLS/Shaka condividono una politica di recupero finita. Autenticazione fallita e DRM non supportato sono terminali. Stop, cambio canale e sostituzione della sorgente annullano le operazioni obsolete.
4. **Limiti di qualità salvati.** Altezza e bitrate massimi limitano la selezione adattiva; il ripiego su un motore nativo non deve aggirare silenziosamente un limite attivo.
5. **Preferenze delle tracce Android native.** L'app Android indipendente ricorda l'intenzione in base a lingua/ruolo/etichetta, inclusi Auto e sottotitoli disattivati, invece di riportare l'indice di una traccia da un altro flusso.
6. **Operatori di comando con ambito limitato.** Il controller può consentire a una credenziale dispositivi/azioni precisi senza consegnare la credenziale amministrativa.
7. **Associazioni XMLTV esplicite.** Un canale nell'ambito di una playlist può essere associato a un feed e un ID XMLTV specifici. [Associazioni della guida e accessibilità](guide-binding-accessibility.it.md).
8. **Film e serie Xtream.** La libreria carica su richiesta il catalogo selezionato, poi gli episodi di una serie. [Contratto della libreria](xtream-media.it.md).
9. **Controlli classici accessibili.** Le liste canali espongono la semantica di selezione; le finestre modali mantengono e ripristinano il focus da tastiera; gli avvisi hanno una regione dinamica.
10. **Esiti dei comandi persistenti.** Un registro facoltativo e limitato del controller conserva i metadati di deduplicazione e degli esiti. Un riavvio non ripete mai ciecamente i comandi.
11. **Passaggio esplicito a un dispositivo.** I riferimenti diretta/archivio passano a un lettore con la stessa sorgente configurata. Il destinatario risolve il proprio URL. [Contratto](remote-handoff.it.md).
12. **Flussi di riserva espliciti.** I canali in diretta possono usare alternative configurate nella stessa politica di recupero finita. [Limiti, recupero e riserve](playback-stream-policy.it.md).
13. **Lotti di impostazioni recuperabili.** Il localStorage nativo usa un registro di annullamento per le scritture supportate su più chiavi. [Garanzie di archiviazione](settings-recovery.it.md).

<a id="language-and-compatibility-coverage"></a>

## Lingue e compatibilità

Il lettore include 88 cataloghi di traduzione. Le sette nuove etichette di qualità/media sono tradotte in ogni catalogo; gli altri nuovi menu riutilizzano etichette già tradotte. I controlli dei cataloghi coprono parità delle chiavi, segnaposto ed eccezioni esaminate. Le guide tecniche abbinate spiegano gli stessi limiti implementativi in [24 lingue della documentazione](manual-translations.md). I [punti di ingresso localizzati](readme/README.md) sono guide introduttive rapide, non una dichiarazione che ogni documento tecnico storico abbia 88 traduzioni complete.

L'output classico mantiene la sintassi ES5. Non significa che ogni dispositivo supporti tutti i codec, API Web, garanzie di archiviazione o integrazioni native. L'anteprima A/V è limitata al percorso HTML5 principale gestito; i motori sostitutivi dei dispositivi, come PC2/Video.js e quelli nativi, sono esclusi. Le associazioni esplicite della guida usano l'implementazione XMLTV ospitata o nativa; i protocolli companion esterni facoltativi potrebbero non supportarle. L'accettazione specifica del dispositivo richiede ancora il dispositivo reale.

<a id="reproduce-the-checks"></a>

## Riprodurre le verifiche

```sh
npm ci
npm run typecheck
npm run test:localization
npm test
npm run build:server
npm run check:es5
npm run check:size
python3 scripts/check-av-diagnostic.py diagnostics/av-v1.mp4
```

Il verificatore multimediale richiede FFmpeg/FFprobe. Decodifica entrambi i canali audio e ne controlla energia, separazione e silenzio; la sola presenza di una traccia AAC non dimostra contenuto udibile. I normali test JavaScript esercitano annullamento, scritture fallite, recupero dopo riavvio, cambi di sorgente e input non validi. I controlli finali del bundle includono le famiglie di provider facoltative, non solo l'ingresso principale.

Nel controller eseguire `go test -race ./...`, `go vet ./...` e `python3 -m unittest discover -s tests`. In Android nativo eseguire i test unitari delle preferenze delle tracce e dei backup delle impostazioni e assemblare l'APK di debug. La CI di ogni repository è autorevole per il commit corrispondente, non per un albero modificato in seguito.

<a id="physical-acceptance-before-promotion"></a>

## Accettazione fisica prima della promozione

- Sulla TV di destinazione, eseguire il controllo A/V e confermare audio sinistro/destro, lampi visibili, Stop e ritorno alla diretta. I test del decoder non dimostrano audio HDMI o fluidità.
- Provare flussi consentiti/negati, una riserva guasta e un cambio canale durante un tentativo in attesa. Confermare il limite di qualità scelto sul backend effettivo.
- Provare il focus di liste/dialoghi con tastiera, telecomando e un lettore di schermo disponibile.
- Associare due nomi di canale simili a ID XMLTV distinti e verificare i programmi.
- Interrompere l'applicazione di un preset di prova, riavviare il controller, riprendere e verificare. Passare la riproduzione a sorgenti configurate sia corrispondenti sia non corrispondenti.
- In Android nativo, cambiare flussi con un ordine diverso delle tracce, riavviare l'app e confermare Auto/Off espliciti e la lingua preferita.

Invio riuscito, impostazioni salvate, campioni decodificati e test unitari superati sono prove diverse. La promozione di una versione deve preservare questa distinzione; vedere la [strategia di rilascio](../RELEASING.md).

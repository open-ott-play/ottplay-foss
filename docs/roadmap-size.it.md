<a id="measured-javascript-cost"></a>

# Costo JavaScript misurato

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Guida alle funzionalità](roadmap-delivery.it.md) · [Dati grezzi](evidence/roadmap-size-20261015.json)

![Confronto di tutto il JavaScript del lettore con la stessa catena di strumenti](diagrams/roadmap-size.svg)

Questa pagina conserva le misurazioni JavaScript degli snapshot del codice indicati sotto. Non misurano la revisione attuale, i pacchetti d’installazione o il traffico di rete.

Nel confronto iniziale, l’entry point principale più tutte le famiglie di provider opzionali sono cresciuti di **31 128 byte non compressi / 9 759 byte gzip**: circa **3.23% / 3.20%**. È un aumento del costo delle funzionalità, non un miglioramento dichiarato di dimensione o velocità di esecuzione. Xtream resta caricato su richiesta; spostarlo fuori dall’entry point non lo elimina dal totale.

La misurazione confronta gli archivi sorgente puliti `bbf9ca7b` e `cae971da`, entrambi versione 1.1.55, con Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 e zlib 1.2.12. Usa l’assemblatore ES5 di produzione, l’ottimizzatore, la politica dei nomi e la corretta identità del sorgente pulito. Il livello gzip 9 è applicato separatamente a ogni risorsa generata.

- Entry point web: 848 092 / 262 392 → 874 926 / 270 321 byte non compressi/gzip.
- Entry point web + tutti i provider: 964 459 / 305 344 → 995 587 / 315 103.
- Entry point nativo: 848 050 / 262 460 → 874 884 / 270 372.
- Entry point nativo + tutti i provider: 964 417 / 305 412 → 995 545 / 315 154.
- M3U opzionale cresce di 184 byte non compressi / 82 gzip; il nuovo Xtream occupa 4 110 / 1 748. Le altre sei famiglie opzionali sono identiche byte per byte.

Prima del trasferimento del filmato su here.now, modificarne l’URL in un percorso locale dalla radice aggiunse un byte JavaScript non compresso in questa sequenza storica. Non è una misura del successivo URL ospitato. La correzione dei tentativi limitati di parsing HLS aggiunge 37 byte non compressi / 36 gzip in un confronto isolato dello stesso snapshot ([evidenza](evidence/parse-recovery-size-20261015.json)). La correzione della titolarità del passaggio Auto nativo aggiunge altri 101 byte non compressi / 39 gzip ([evidenza](evidence/auto-recovery-size-20261015.json)). Il totale non compresso prima delle correzioni delle regressioni di accessibilità è 995 726 byte; identità della build e byte gzip possono cambiare nel commit finale. I risultati finali di `build/reports/classic-bundle.json` e `npm run check:size` restano il riferimento per l’esatta revisione distribuita. La successiva build pulita `652726f8`, con le correzioni del focus del puntatore e dei dialoghi, misura **995 858 byte non compressi / 315 207 gzip** per il lettore web completo ([evidenza dell’artefatto finale](evidence/roadmap-final-size-20261015.json)). L’entry point è 875 197 / 270 425; i totali nativi sono 995 816 / 315 259. I limiti di quello snapshot mantenevano il precedente margine per nativo/Node/suffisso di rilascio: 875 300 non compressi / 271 600 gzip per l’entry point; 996 100 / 316 400 per entry point + provider.

<a id="post-beta-integration"></a>

## Integrazione dopo la beta

![JavaScript completo dopo l’integrazione di beta.4](diagrams/post-beta-size.svg)

Il confronto successivo riproduce il sorgente beta.4 `39287792` rispetto al runtime `9663b681`, inclusi integrazione Plex e recupero delle impostazioni danneggiate, con gli stessi Node 26.8.2, Rollup 4.64.5 e Terser 5.51.2:

- Entry point web: 848 315 / 262 443 → 879 533 / 271 761 byte non compressi/gzip.
- Entry point web + tutti i provider: 964 876 / 305 452 → 1 000 388 / 316 600.
- Entry point nativo + tutti i provider: 964 834 / 305 520 → 1 000 346 / 316 654.
- Aumento del payload web completo: **35 512 / 11 148 byte (3.68% / 3.65%)**.

La base conta sette famiglie di provider; l’integrazione otto, incluso Xtream su richiesta. I limiti dell’entry point di quello snapshot erano 879 900 / 273 000; quelli totali 1 000 800 / 317 800, preservando margine per nativo, Node e identità del rilascio. Entrambe le build locali di produzione rigenerano cinque file runtime versionati e omettono l’indicazione di revisione sorgente pulita. Sono artefatti riprodotti localmente, non i binari beta pubblicati. Versioni degli strumenti, hash e questa limitazione sono registrati nelle [evidenze della base](evidence/post-beta-baseline-size-20261015.json) e [dell’integrazione](evidence/post-beta-candidate-size-20261015.json). Il [rapporto d’implementazione](implementation-report.it.md#post-beta-integration-and-review) spiega correzioni e validazione.

**Ambito:** questi totali JavaScript escludono motori multimediali esterni, dizionari linguistici, CSS, immagini e video. I pacchetti storici contenevano anche un **filmato A/V di 464 652 byte**, escluso dai totali sopra. La sua distribuzione attuale è separata da quelle misure:

- **Repository:** `diagnostics/av-v1.mp4` resta insieme al generatore e al verificatore per la riproducibilità. Conservare un file sorgente non significa includerlo in un pacchetto.
- **Pacchetti:** Web/OTTPlay Server, Tauri, Capacitor e Docker escludono il filmato. Si rimuovono 464 652 byte multimediali non compressi, non una riduzione misurata di 464 652 byte in un installer compresso. Formato dell’archivio e altre modifiche di build influiscono sulla dimensione.
- **Rete:** il lettore scarica il filmato da here.now solo quando l’utente avvia il [controllo A/V](audio-video-check.it.md). Il controllo richiede Internet; il filmato non viene scaricato per la riproduzione iniziale.

Le misure storiche JavaScript sopra restano invariate. Misurare l’effetto dell’URL ospitato su JavaScript o su un installer attuale richiede un nuovo confronto. Gli 88 README localizzati sono documentazione del repository, non payload del lettore. Questo confronto di byte non dimostra prestazioni di avvio, frame rate, memoria o scalabilità del catalogo. Servono misure separate sui dispositivi di destinazione.

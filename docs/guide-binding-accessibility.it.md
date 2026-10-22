<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Associazione XMLTV manuale e accessibilità da tastiera

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Architettura della guida](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Correggere la guida di un canale senza modificare la playlist

Riprodurre il canale M3U interessato, aprire **Information → EPG**, quindi modificare l'URL della sorgente EPG e l'**XMLTV ID**. Inserire l'ID esatto di `<channel id="…">` nel file XMLTV, non il nome visualizzato. Scegliere **Set** per salvare l'associazione e ricaricare la playlist. **Automatic** rimuove la sostituzione per quel canale e ricarica l'associazione originale. Muoversi con le frecce da solo non salva né azzera mai un'associazione. Indietro lascia invariata l'associazione salvata.

L'editor è disponibile nella distribuzione browser ospitata e nei contenitori XMLTV nativi (Tauri e Capacitor). Non sostituisce guide del fornitore, endpoint JSON espliciti `=source` o server di supporto esterni. Un normale browser legacy che usa un server di supporto remoto mantiene il suo protocollo di corrispondenza esistente. La prima versione accetta un ID esatto; non scarica né mostra un elenco ricercabile di tutti i canali XMLTV.

![Un'associazione manuale collega la sorgente della playlist e il canale stabile a un feed XMLTV e a un ID esatto; altrimenti resta attiva la corrispondenza normale.](images/guide-binding.svg)

Un'associazione conserva l'impronta della sorgente della playlist, la chiave stabile del canale, l'URL esplicito del feed e l'ID XMLTV. Rinominare un'etichetta o cambiare l'ordine delle righe non modifica l'associazione se l'identità del canale resta uguale. Sostituire URL/account della playlist cambia lo spazio dei nomi della sorgente. Per voci M3U legacy senza `itemId` si usa l'ID esistente derivato dall'URL; cambiare quell'URL cambia l'identità.

Il canale selezionato mantiene nome visualizzato e URL di riproduzione. La ricerca nella guida usa un solo feed esplicito senza ripiego sul nome: un ID mancante non prende quindi silenziosamente i programmi di un altro canale. Gli scostamenti regionali automatici dedotti dal nome non si applicano a questa associazione esatta; il `tvg-shift` esplicito della playlist resta valido. Impostare l'ID XMLTV regionale corretto. Se un feed HTTPS personalizzato non è leggibile per CORS o regole sui contenuti misti, la normale diagnostica EPG segnala l'errore.

Il record locale è limitato a 500 associazioni e 512 KiB per sorgente; viene analizzato una volta per caricamento della playlist, non per canale. Le scritture confrontano il valore precedente e rileggono il risultato memorizzato prima di ricaricare. Un callback tardivo dell'editor non può salvare in una sorgente sostitutiva. È una preferenza locale, non una sincronizzazione tra dispositivi. Gli URL dei feed possono contenere credenziali: evitare di pubblicare esportazioni dell'archivio.

<a id="accessible-classic-controls"></a>

## Controlli classici accessibili

- L'elenco principale virtualizzato espone una listbox con nome, l'opzione selezionata, il conteggio totale degli elementi e la posizione assoluta. Solo la riga visibile selezionata è una fermata di Tab. Le frecce aggiornano selezione visiva e stato semantico; il focus segue un elenco già focalizzato al cambio pagina.
- I normali dialoghi informativi/di conferma, l'editor e i pannelli About espongono ruoli modali e nomi localizzati. Tab e Maiusc+Tab scorrono nel modale in primo piano. Chiudere un modale annidato ripristina un controllo padre ancora visibile; aperture pianificate obsolete non possono rubare il focus dopo la chiusura.
- I messaggi informativi e di conferma descrivono i loro dialoghi. Gli avvisi temporanei usano una regione di stato con annunci non invasivi.
- I cataloghi di traduzione esistenti forniscono tutte le etichette aggiunte. XMLTV e ID sono identificatori di protocollo; nomi dei canali e host dei feed restano metadati della sorgente.

L'applicazione mantiene i percorsi del telecomando e la sintassi ES5. Le verifiche semantiche del DOM non costituiscono una certificazione WCAG completa: focus specifico del dispositivo, voce VoiceOver/TalkBack e comportamento dei browser TV richiedono ancora prove fisiche.

<a id="verification"></a>

## Verifica

Eseguire:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Eseguire anche le normali verifiche di build/ES5/dimensione del bundle sul ramo integrato. I test browser devono coprire un elenco lungo attraverso più pagine, una conferma annidata, la sostituzione della sorgente durante la modifica, un'associazione corretta, mancante e rimossa, e un errore di download EPG. Le preferenze semantiche delle tracce dell'applicazione Android nativa sono implementate nel suo repository separato e sono indipendenti da questi controlli classici.

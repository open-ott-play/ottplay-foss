<a id="explicit-playback-handoff"></a>

# Passaggio esplicito della riproduzione

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Miglioramenti](roadmap-delivery.it.md)

Con il lettore e la CLI di controllo aggiornati, eseguire `ott handoff SOURCE TARGET`. La sorgente continua a riprodurre. La destinazione richiede la stessa sorgente/account configurata e un ID di canale stabile e univoco. I riferimenti ai canali sono impronte locali con versione, mai ID grezzi degli elementi del fornitore. Le righe M3U classiche usano l'URL esatto del flusso solo come input dell'hash locale. Gli URL firmati o riscritti indipendentemente non vengono quindi associati, per sicurezza. Non si effettuano corrispondenze approssimative per nome e non si trasferiscono credenziali o URL riproducibili. La versione 1 supporta diretta/archivio per M3U, Xtream e Stalker; VOD/serie e sincronizzazione continua della cronologia non sono supportati.

`playback_handoff_export` accetta parametri vuoti e restituisce `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

I riferimenti all'archivio usano `kind: "archive"` e un `archive_start` intero (punto di riproduzione corrente in secondi Unix). `playback_handoff_import` accetta solo `{"handoff": ...}`. Prima di inoltrare il comando, la destinazione verifica identità del catalogo, disponibilità dell'archivio, regole parentali/chiosco e titolarità corrente del controllo. Risolve i flussi tramite il proprio fornitore. Un'importazione accettata restituisce `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. L'inoltro non conferma né la decodifica video né un suono HDMI udibile.

I rifiuti espongono soltanto un codice di errore: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. I riferimenti hanno limiti; il ricevitore rifiuta campi aggiuntivi. Usare autorizzazioni di operatore limitate per esportazione/importazione e proteggere la connessione al controller. L'identità della sorgente è una chiave opaca di corrispondenza, non una credenziale di accesso trasferibile.

Eseguire `node tests/test_remote_handoff.cjs`. Consultare la [guida al controllo](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) per autenticazione, esiti e comportamento del TTL dei comandi.

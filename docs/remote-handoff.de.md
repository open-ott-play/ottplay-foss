<a id="explicit-playback-handoff"></a>

# Explizite Übergabe der Wiedergabe

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Verbesserungen](roadmap-delivery.de.md)

Führen Sie mit aktualisiertem Player und aktualisierter Steuerungs-CLI `ott handoff SOURCE TARGET` aus. Die Quelle spielt weiter. Das Ziel benötigt dieselbe konfigurierte Quelle bzw. dasselbe Konto und eine eindeutige, stabile Kanal-ID. Kanalreferenzen sind versionierte lokale Fingerabdrücke, niemals rohe Element-IDs des Anbieters. Bei klassischen M3U-Zeilen dient die exakte Stream-URL ausschließlich als lokale Hash-Eingabe. Unabhängig signierte oder umgeschriebene URLs lassen sich daher aus Sicherheitsgründen nicht zuordnen. Es werden weder unscharfe Namensvergleiche verwendet noch Zugangsdaten oder abspielbare URLs übertragen. Version 1 unterstützt Live-TV und Archiv für M3U, Xtream und Stalker; VOD/Serien und eine laufende Synchronisierung des Wiedergabeverlaufs werden nicht unterstützt.

`playback_handoff_export` akzeptiert leere Parameter und gibt `data.handoff` zurück:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Archivreferenzen verwenden `kind: "archive"` und eine ganzzahlige `archive_start` (aktuelle Wiedergabeposition in Unix-Sekunden). `playback_handoff_import` akzeptiert ausschließlich `{"handoff": ...}`. Das Ziel prüft Katalogidentität, Archivverfügbarkeit, Jugendschutz-/Kioskregeln und die aktuelle Zuständigkeit, bevor es den Befehl auslöst. Es ermittelt Streams über seinen eigenen Anbieter. Ein akzeptierter Import gibt `{"status":"ok","data":{"dispatched":true,"kind":"live"}}` zurück. Das Auslösen bestätigt weder dekodiertes Video noch hörbaren HDMI-Ton.

Ablehnungen geben nur einen Fehlercode aus: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Referenzen sind größenbegrenzt; der Empfänger weist zusätzliche Felder zurück. Verwenden Sie eingeschränkte Operatorberechtigungen für Export/Import und schützen Sie die Controllerverbindung. Die Quellidentität ist ein opaker Zuordnungsschlüssel, kein übertragbarer Zugangsnachweis.

Führen Sie `node tests/test_remote_handoff.cjs` aus. Informationen zu Authentifizierung, Ergebnissen und dem TTL-Verhalten von Befehlen finden Sie im [Steuerungsleitfaden](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md).

<a id="explicit-playback-handoff"></a>

# Expliciete overdracht van afspelen

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Verbeteringen](roadmap-delivery.nl.md)

Voer met de bijgewerkte speler en besturings-CLI `ott handoff SOURCE TARGET` uit. De bron blijft afspelen. Het doel heeft dezelfde ingestelde bron/account en een unieke, stabiele kanaal-ID nodig. Kanaalverwijzingen zijn lokale vingerafdrukken met een versie, nooit ruwe item-ID's van de provider. Klassieke M3U-rijen gebruiken de exacte stream-URL alleen als invoer voor een lokale hash. Onafhankelijk ondertekende of herschreven URL's worden daarom uit veiligheid niet gekoppeld. Er wordt niet bij benadering op naam gezocht en er worden geen inloggegevens of afspeelbare URL's overgedragen. Versie 1 ondersteunt live/archief voor M3U, Xtream en Stalker; VOD/series en doorlopende synchronisatie van de kijkgeschiedenis worden niet ondersteund.

`playback_handoff_export` accepteert lege parameters en retourneert `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Archiefverwijzingen gebruiken `kind: "archive"` en een gehele `archive_start` (huidige afspeelpositie in Unix-seconden). `playback_handoff_import` accepteert alleen `{"handoff": ...}`. Het doel controleert vóór verzending de catalogusidentiteit, archiefbeschikbaarheid, ouderlijk toezicht/kioskbeleid en de huidige eigenaar van de besturing. Het zoekt streams op via zijn eigen provider. Een geaccepteerde import retourneert `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. Verzending bevestigt geen gedecodeerd beeld of hoorbaar HDMI-geluid.

Afwijzingen tonen alleen een foutcode: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Verwijzingen zijn begrensd; de ontvanger weigert extra velden. Gebruik afgebakende operatorrechten voor export/import en beveilig de verbinding met de controller. De bronidentiteit is een ondoorzichtige koppelingssleutel, geen overdraagbaar toegangsbewijs.

Voer `node tests/test_remote_handoff.cjs` uit. Zie de [besturingshandleiding](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) voor authenticatie, resultaten en het TTL-gedrag van opdrachten.

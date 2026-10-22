<a id="explicit-playback-handoff"></a>

# Výslovné předání přehrávání

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Vylepšení](roadmap-delivery.cs.md)

S aktualizovaným přehrávačem a řídicím CLI spusťte `ott handoff SOURCE TARGET`. Zdroj pokračuje v přehrávání. Cíl potřebuje stejně nastavený zdroj/účet a jedinečné stabilní ID kanálu. Odkazy na kanály jsou verzované místní otisky, nikdy nezpracovaná ID položek poskytovatele. Klasické řádky M3U používají přesnou URL streamu pouze jako vstup místního hashe. Nezávisle podepsané nebo přepsané URL se proto z bezpečnostních důvodů nespárují. Nepoužívá se přibližné porovnávání názvů a nepřenášejí se přihlašovací údaje ani přehratelné URL. Verze 1 podporuje živé vysílání/archiv pro M3U, Xtream a Stalker; VOD/seriály a průběžná synchronizace historie sledování podporovány nejsou.

`playback_handoff_export` přijímá prázdné parametry a vrací `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Odkazy na archiv používají `kind: "archive"` a celočíselné `archive_start` (aktuální bod přehrávání v unixových sekundách). `playback_handoff_import` přijímá pouze `{"handoff": ...}`. Cíl před odesláním příkazu ověří identitu katalogu, dostupnost archivu, rodičovská/kiosková pravidla a aktuální vlastnictví řízení. Streamy vyhledá prostřednictvím vlastního poskytovatele. Přijatý import vrací `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. Odeslání nepotvrzuje dekódované video ani slyšitelný zvuk přes HDMI.

Odmítnutí zveřejní pouze chybový kód: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Odkazy mají stanovené meze; příjemce odmítá další pole. Pro export/import používejte omezená oprávnění operátora a chraňte spojení s řadičem. Identita zdroje je neprůhledný párovací klíč, nikoli přenositelný přístupový údaj.

Spusťte `node tests/test_remote_handoff.cjs`. Podrobnosti o ověřování, výsledcích a chování TTL příkazů uvádí [průvodce řízením](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md).

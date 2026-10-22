<a id="explicit-playback-handoff"></a>

# Jawne przekazanie odtwarzania

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Ulepszenia](roadmap-delivery.pl.md)

Po zaktualizowaniu odtwarzacza i CLI sterowania uruchom `ott handoff SOURCE TARGET`. Źródło nadal odtwarza. Cel wymaga tak samo skonfigurowanego źródła/konta i unikalnego, stabilnego ID kanału. Odwołania do kanałów są wersjonowanymi lokalnymi odciskami, nigdy surowymi ID elementów dostawcy. Klasyczne wiersze M3U używają dokładnego URL strumienia wyłącznie jako danych wejściowych lokalnego skrótu. Niezależnie podpisane lub przepisane URL nie są zatem dopasowywane, ze względów bezpieczeństwa. Nie stosuje się przybliżonego dopasowania nazw ani nie przesyła danych logowania lub odtwarzalnych URL. Wersja 1 obsługuje transmisję na żywo/archiwum dla M3U, Xtream i Stalker; nie obsługuje VOD/seriali ani ciągłej synchronizacji historii oglądania.

`playback_handoff_export` przyjmuje puste parametry i zwraca `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Odwołania do archiwum używają `kind: "archive"` oraz całkowitego `archive_start` (bieżący punkt odtwarzania w sekundach uniksowych). `playback_handoff_import` przyjmuje tylko `{"handoff": ...}`. Przed wysłaniem polecenia cel sprawdza tożsamość katalogu, dostępność archiwum, zasady kontroli rodzicielskiej/kiosku i bieżącą własność sterowania. Rozwiązuje strumienie przez własnego dostawcę. Przyjęty import zwraca `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. Wysłanie nie potwierdza zdekodowanego obrazu ani słyszalnego dźwięku HDMI.

Odmowy ujawniają tylko kod błędu: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Odwołania mają ograniczenia; odbiorca odrzuca dodatkowe pola. Używaj ograniczonych uprawnień operatora do eksportu/importu i zabezpiecz połączenie ze sterownikiem. Tożsamość źródła jest nieprzezroczystym kluczem dopasowania, a nie przenośnym poświadczeniem dostępu.

Uruchom `node tests/test_remote_handoff.cjs`. Informacje o uwierzytelnianiu, wynikach i zachowaniu TTL poleceń zawiera [przewodnik sterowania](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md).

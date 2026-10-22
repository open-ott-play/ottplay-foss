<a id="explicit-playback-handoff"></a>

# Явне передавання відтворення

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Поліпшення](roadmap-delivery.uk.md)

З оновленими плеєром і CLI керування виконайте `ott handoff SOURCE TARGET`. Джерело продовжує відтворення. На цілі мають бути налаштовані те саме джерело/обліковий запис і унікальний стабільний ID каналу. Посилання на канали — це версійовані локальні відбитки, а не сирі ID елементів провайдера. Класичні рядки M3U використовують точну URL-адресу потоку лише як вхід локального хешування. Тому незалежно підписані або переписані URL з міркувань безпеки не зіставляються. Нечітке зіставлення назв не застосовується; облікові дані та придатні для відтворення URL не передаються. Версія 1 підтримує ефір/архів для M3U, Xtream і Stalker; VOD/серіали та постійну синхронізацію історії перегляду не підтримує.

`playback_handoff_export` приймає порожні параметри й повертає `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Архівні посилання використовують `kind: "archive"` та ціле `archive_start` (поточна точка відтворення в секундах Unix). `playback_handoff_import` приймає лише `{"handoff": ...}`. Перед надсиланням команди ціль перевіряє ідентичність каталогу, доступність архіву, батьківські/кіоскові правила та поточне володіння керуванням. Потоки вона визначає через власного провайдера. Прийнятий імпорт повертає `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. Надсилання не підтверджує декодоване відео чи чутний звук через HDMI.

Відмови показують лише код помилки: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Посилання мають обмеження; отримувач відхиляє додаткові поля. Для експорту/імпорту використовуйте обмежені дозволи оператора й захищайте з'єднання з контролером. Ідентичність джерела — це непрозорий ключ зіставлення, а не облікові дані, що передають право доступу.

Виконайте `node tests/test_remote_handoff.cjs`. Відомості про автентифікацію, результати та TTL команд наведено в [посібнику з керування](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md).

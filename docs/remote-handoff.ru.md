<a id="explicit-playback-handoff"></a>

# Явная передача воспроизведения

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Улучшения](roadmap-delivery.ru.md)

С обновлёнными плеером и CLI управления выполните `ott handoff SOURCE TARGET`. Источник продолжает воспроизведение. На цели должны быть настроены тот же источник/аккаунт и уникальный стабильный ID канала. Ссылки на каналы — это версионированные локальные отпечатки, а не исходные ID элементов провайдера. Классические строки M3U используют точный URL потока только как вход локального хеширования. Поэтому независимо подписанные или переписанные URL безопасно отклоняются при сопоставлении. Нечёткое сопоставление имён не используется; учётные данные и воспроизводимые URL не передаются. Версия 1 поддерживает эфир/архив для M3U, Xtream и Stalker; VOD/сериалы и непрерывная синхронизация истории просмотра не поддерживаются.

`playback_handoff_export` принимает пустые параметры и возвращает `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Архивные ссылки используют `kind: "archive"` и целочисленный `archive_start` (текущая точка воспроизведения в секундах Unix). `playback_handoff_import` принимает только `{"handoff": ...}`. Перед отправкой команды цель проверяет идентичность каталога, доступность архива, родительские/киосковые правила и текущего владельца управления. Потоки она разрешает через собственного провайдера. Принятый импорт возвращает `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. Отправка не подтверждает декодированное видео или слышимый звук HDMI.

Отказы раскрывают только код ошибки: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Ссылки ограничены по размеру; получатель отклоняет дополнительные поля. Используйте ограниченные разрешения оператора для экспорта/импорта и защищайте соединение с контроллером. Идентичность источника — непрозрачный ключ сопоставления, а не передаваемые учётные данные доступа.

Выполните `node tests/test_remote_handoff.cjs`. Об аутентификации, результатах и поведении TTL команд см. [руководство по управлению](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md).

<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Ручная привязка XMLTV и доступность с клавиатуры

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Архитектура телепрограммы](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Исправление телепрограммы канала без редактирования плейлиста

Включите нужный канал M3U, откройте **Information → EPG**, затем измените URL источника EPG и **XMLTV ID**. Введите точный ID из `<channel id="…">` файла XMLTV, а не отображаемое имя. Выберите **Set**, чтобы сохранить привязку и перезагрузить плейлист. **Automatic** удаляет переопределение этого канала и загружает исходное сопоставление плейлиста. Само перемещение стрелками никогда не сохраняет и не сбрасывает привязку. Назад оставляет сохранённую привязку без изменений.

Редактор доступен в размещённой браузерной версии и нативных XMLTV-оболочках (Tauri и Capacitor). Он не переопределяет телепрограммы провайдера, явные JSON-эндпоинты `=source` и внешние вспомогательные серверы. Обычный старый браузер с удалённым вспомогательным сервером сохраняет существующий протокол сопоставления. Первая версия принимает точный ID; она не загружает и не показывает список всех XMLTV-каналов с поиском.

![Ручная привязка связывает источник плейлиста и стабильный канал с одним источником XMLTV и точным ID; иначе действует обычное сопоставление.](images/guide-binding.svg)

Привязка хранит отпечаток источника плейлиста, стабильный ключ канала, явный URL телепрограммы и XMLTV ID. Изменение отображаемого имени или порядка строк не меняет привязку, пока идентичность канала прежняя. Замена URL/аккаунта плейлиста меняет пространство имён источника. Для старых M3U-записей без `itemId` используется существующий ID канала, полученный из URL; изменение этого URL меняет идентичность.

Выбранный канал сохраняет отображаемое имя и URL воспроизведения. Поиск телепрограммы использует один явный источник без запасного сопоставления по имени, поэтому отсутствующий ID не подставляет молча программу другого канала. Автоматические региональные сдвиги, выведенные из имени канала, не применяются к этой точной привязке; явный `tvg-shift` плейлиста продолжает действовать. Укажите правильный региональный XMLTV ID. Если собственный HTTPS-источник нельзя прочитать из-за CORS или правил смешанного содержимого, обычная диагностика EPG сообщит об ошибке.

Локальная запись ограничена 500 привязками и 512 KiB на источник; она разбирается один раз при загрузке плейлиста, а не для каждого канала. Запись сравнивает прежнее значение и перечитывает сохранённый результат перед перезагрузкой. Запоздалый callback редактора не может сохранить данные в заменивший прежний источник. Это локальная настройка, а не синхронизация между устройствами. URL источников могут содержать учётные данные; не публикуйте экспорты хранилища.

<a id="accessible-classic-controls"></a>

## Доступные классические элементы управления

- Виртуализированный основной список предоставляет именованный listbox, выбранный вариант, полное количество элементов и абсолютную позицию. Только выбранная видимая строка является остановкой Tab. Стрелки обновляют визуальный выбор и семантическое состояние; фокус следует за уже сфокусированным списком при замене страницы.
- Стандартные диалоги информации/подтверждения, редактор и панели About предоставляют модальные роли и локализованные имена. Tab и Shift+Tab циклически перемещаются внутри переднего модального окна. Закрытие вложенного окна восстанавливает всё ещё видимый родительский элемент; устаревшие запланированные открытия не могут похитить фокус после закрытия.
- Информационные сообщения и подтверждения описывают свои диалоги. Временные уведомления используют область состояния с ненавязчивым озвучиванием.
- Существующие каталоги переводов предоставляют все добавленные подписи. XMLTV и ID — идентификаторы протокола; имена каналов и хостов источников остаются метаданными источника.

Приложение сохраняет маршруты пульта и синтаксис ES5. Семантические проверки DOM не означают полной сертификации WCAG: специфичный для устройства фокус, речь VoiceOver/TalkBack и поведение TV-браузеров всё ещё требуют физических тестов.

<a id="verification"></a>

## Проверка

Выполните:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

На интегрированной ветке также выполните обычные проверки сборки/ES5/размера пакета. Браузерные проверки должны охватить длинный список через границы страниц, вложенное подтверждение, замену источника при редактировании, правильную, отсутствующую и удалённую привязку и ошибку загрузки EPG. Семантические настройки дорожек нативного Android-приложения реализованы в его отдельном репозитории и независимы от этих классических элементов управления.

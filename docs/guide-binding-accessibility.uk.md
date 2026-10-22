<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Ручна прив'язка XMLTV і доступність клавіатури

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Архітектура телепрограми](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Виправлення телепрограми каналу без редагування плейлиста

Увімкніть потрібний канал M3U, відкрийте **Information → EPG**, потім змініть URL джерела EPG та **XMLTV ID**. Введіть точний ID із `<channel id="…">` файла XMLTV, а не його відображувану назву. Виберіть **Set**, щоб зберегти прив'язку й перезавантажити плейлист. **Automatic** прибирає перевизначення цього каналу й завантажує початкове зіставлення плейлиста. Сам рух стрілками ніколи не зберігає та не скидає прив'язку. Назад залишає збережену прив'язку незмінною.

Цей редактор доступний у розміщеній браузерній версії та нативних оболонках XMLTV (Tauri й Capacitor). Він не перевизначає телепрограми провайдера, явні JSON-кінцеві точки `=source` чи зовнішні допоміжні сервери. Звичайний старий браузер із віддаленим допоміжним сервером зберігає свій протокол зіставлення. Перша версія приймає точний ID; вона не завантажує й не показує список усіх каналів XMLTV із пошуком.

![Ручна прив'язка з'єднує джерело плейлиста й стабільний канал з одним XMLTV-джерелом та точним ID; інакше працює звичайне зіставлення.](images/guide-binding.svg)

Прив'язка зберігає відбиток джерела плейлиста, стабільний ключ каналу, явний URL телепрограми та XMLTV ID. Зміна відображуваної назви чи порядку рядків не змінює прив'язку, якщо ідентичність каналу стала. Заміна URL/облікового запису плейлиста змінює простір імен джерела. Для старих записів M3U без `itemId` використовується наявний ID каналу, утворений із URL; зміна цього URL змінює ідентичність.

Вибраний канал зберігає відображувану назву та URL відтворення. Пошук телепрограми використовує одне явне джерело без резервного зіставлення за назвою, тому відсутній ID не підставляє мовчки програму іншого каналу. Автоматичні регіональні зсуви, виведені з назви каналу, не застосовуються до цієї точної прив'язки; явний `tvg-shift` плейлиста залишається чинним. Установіть правильний регіональний XMLTV ID. Якщо власне HTTPS-джерело не читається через CORS чи правила змішаного вмісту, звичайна діагностика EPG повідомить про помилку.

Локальний запис обмежено 500 прив'язками та 512 KiB на джерело; він розбирається один раз на завантаження плейлиста, а не для кожного каналу. Запис порівнює попереднє значення й перечитує збережений результат перед перезавантаженням. Запізнілий callback редактора не може зберегти дані в джерело, що замінило попереднє. Це локальна перевага, а не синхронізація між пристроями. URL джерел можуть містити облікові дані; не поширюйте експорт сховища публічно.

<a id="accessible-classic-controls"></a>

## Доступні класичні елементи керування

- Віртуалізований основний список надає названий listbox, вибраний варіант, повну кількість елементів та абсолютну позицію. Лише вибраний видимий рядок є зупинкою Tab. Навігація стрілками оновлює візуальний вибір і семантичний стан; фокус слідує за вже сфокусованим списком під час заміни сторінки.
- Стандартні діалоги інформації/підтвердження, редактор і панелі About надають модальні ролі та локалізовані назви. Tab і Shift+Tab циклічно переміщуються всередині переднього модального вікна. Закриття вкладеного вікна відновлює досі видимий батьківський елемент; застарілі заплановані відкриття не можуть перехопити фокус після закриття.
- Інформаційні повідомлення й підтвердження описують свої діалоги. Тимчасові сповіщення використовують область стану з ненав'язливим озвученням.
- Наявні каталоги перекладів надають усі додані підписи. XMLTV та ID — ідентифікатори протоколу; назви каналів і хостів джерел залишаються метаданими джерела.

Застосунок зберігає маршрути пульта та синтаксис ES5. Семантичні перевірки DOM не є повною сертифікацією WCAG: специфічний для пристрою фокус, мовлення VoiceOver/TalkBack і поведінка TV-браузерів усе ще потребують фізичних тестів.

<a id="verification"></a>

## Перевірка

Виконайте:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

На інтегрованій гілці також виконайте звичайні перевірки збірки/ES5/розміру пакета. Браузерні перевірки мають охопити довгий список через межі сторінок, вкладене підтвердження, заміну джерела під час редагування, правильну, відсутню й видалену прив'язку та помилку завантаження EPG. Семантичні налаштування доріжок нативного Android-застосунку реалізовано в його окремому репозиторії; вони незалежні від цих класичних елементів керування.

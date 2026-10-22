<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# اتصال دستی XMLTV و دسترس‌پذیری صفحه‌کلید

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

<div lang="fa" dir="rtl">

[معماری راهنمای برنامه‌ها](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## اصلاح راهنمای یک کانال بدون ویرایش فهرست پخش

کانال M3U موردنظر را پخش کنید، **اطلاعات → EPG** را باز کنید و سپس URL منبع EPG و **شناسهٔ XMLTV** را ویرایش کنید. شناسهٔ دقیقِ `<channel id="…">` در فایل XMLTV را وارد کنید، نه نام نمایشی آن را. برای ذخیرهٔ اتصال و بارگیری دوبارهٔ فهرست پخش، **تنظیم** را انتخاب کنید. **خودکار** بازنویسی اختصاصی این کانال را حذف و نگاشت اصلی فهرست پخش را دوباره بارگیری می‌کند. حرکت با کلیدهای جهت به‌تنهایی اتصال را ذخیره یا بازنشانی نمی‌کند. بازگشت، اتصال ذخیره‌شده را تغییر نمی‌دهد.

این ویرایشگر در استقرار میزبانی‌شدهٔ مرورگر و پوسته‌های بومی XMLTV یعنی Tauri وCapacitor موجود است. راهنماهای تحت کنترل ارائه‌دهنده، نقاط پایانی صریح JSON با `=source` یا سرورهای همراه خارجی را بازنویسی نمی‌کند. مرورگر قدیمی معمولی که از همراه راه‌دور استفاده می‌کند، پروتکل تطبیق موجود خود را نگه می‌دارد. نسخهٔ نخست شناسهٔ دقیق می‌پذیرد؛ فهرست قابل‌جست‌وجوی تمام کانال‌های XMLTV را بارگیری یا نمایش نمی‌دهد.

![اتصال دستی، منبع فهرست پخش و کانال پایدار را به یک خوراک XMLTV و شناسهٔ دقیق وصل می‌کند؛ در غیر این صورت تطبیق عادی فعال می‌ماند.](images/guide-binding.svg)

اتصال، اثرانگشت منبع فهرست پخش، کلید پایدار کانال، URL صریح خوراک و شناسهٔ XMLTV را ذخیره می‌کند. تا وقتی هویت کانال ثابت باشد، تغییر نام برچسب نمایشی یا ترتیب ردیف‌ها اتصال را تغییر نمی‌دهد. جایگزینی URL یا حساب فهرست پخش، فضای نام منبع را تغییر می‌دهد. برای ورودی‌های قدیمی M3U بدون `itemId`، شناسهٔ موجود کانال که از URL ساخته شده استفاده می‌شود؛ تغییر آن URL هویت را عوض می‌کند.

نام نمایشی و URL پخش کانال انتخاب‌شده حفظ می‌شوند. جست‌وجوی راهنما فقط از یک خوراک صریح استفاده می‌کند و به تطبیق نام برنمی‌گردد؛ بنابراین نبودن شناسه باعث استفادهٔ بی‌صدای برنامهٔ کانال دیگر نمی‌شود. اختلاف‌های زمانی منطقه‌ای که خودکار از نام کانال استنباط می‌شوند بر این اتصال دقیق اعمال نمی‌شوند؛ ولی `tvg-shift` صریح فهرست پخش همچنان اعمال می‌شود. شناسهٔ منطقه‌ای صحیح XMLTV را تنظیم کنید. اگر خوراک سفارشی میزبانی‌شده با HTTPS به‌علت قواعد CORS یا محتوای مختلط قابل‌خواندن نباشد، عیب‌یابی عادی EPG این شکست را گزارش می‌کند.

رکورد محلی برای هر منبع به 500 اتصال و512 KiB محدود است؛ در هر بار بارگیری فهرست پخش یک‌بار تجزیه می‌شود، نه برای هر کانال. نوشتن‌ها مقدار قبلی را مقایسه می‌کنند و پیش از بارگیری دوباره، نتیجهٔ ذخیره‌شده را بازخوانی می‌کنند. فراخوانی دیررس ویرایشگر نمی‌تواند در منبع جایگزین ذخیره کند. این یک ترجیح محلی است، نه همگام‌سازی بین دستگاه‌ها. URL خوراک ممکن است حاوی اطلاعات ورود باشد؛ خروجی ذخیره‌سازی را عمومی به اشتراک نگذارید.

<a id="accessible-classic-controls"></a>

## کنترل‌های کلاسیک دسترس‌پذیر

- فهرست اصلی مجازی‌شده، جعبه‌فهرست نام‌دار، گزینهٔ انتخاب‌شده، تعداد کل موارد و موقعیت مطلق هر مورد را ارائه می‌دهد. فقط ردیف مرئی انتخاب‌شده توقفگاه Tab است. حرکت با جهت‌ها هم انتخاب بصری و هم حالت معنایی را به‌روز می‌کند؛ اگر فهرست از قبل فوکوس داشته باشد، هنگام جایگزینی صفحه فوکوس آن را دنبال می‌کند.
- پنجره‌های معمول اطلاعات/تأیید، ویرایشگر و پنل‌های درباره، نقش‌های مودال و نام‌های ترجمه‌شده ارائه می‌کنند. Tab وShift+Tab داخل مودال پیش‌زمینه گردش می‌کنند. بستن مودال تودرتو فوکوس را به کنترل والدِ هنوز مرئی برمی‌گرداند؛ درخواست‌های قدیمی زمان‌بندی‌شدهٔ بازشدن پس از بسته‌شدن نمی‌توانند فوکوس را بربایند.
- پیام‌های اطلاعات و تأیید پنجره‌های خود را توصیف می‌کنند. اعلان‌های موقت از ناحیهٔ وضعیت با اعلام غیرمزاحم استفاده می‌کنند.
- همهٔ برچسب‌های افزوده از کاتالوگ‌های ترجمهٔ موجود می‌آیند. XMLTV وID شناسه‌های پروتکل‌اند؛ نام کانال‌ها و نام میزبان خوراک‌ها فرادادهٔ منبع باقی می‌مانند.

برنامه مسیرهای کنترل از راه دور و نحو ES5 را حفظ می‌کند. بررسی‌های معنایی DOM به معنای گواهی کامل WCAG نیستند: فوکوس ویژهٔ دستگاه، گفتار VoiceOver/TalkBack و رفتار مرورگر تلویزیون همچنان باید روی سخت‌افزار واقعی آزمایش شوند.

<a id="verification"></a>

## راستی‌آزمایی

اجرا کنید:

<div dir="ltr">

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

</div>

بررسی‌های معمول ساخت، ES5 و اندازهٔ بسته را نیز روی شاخهٔ یکپارچه اجرا کنید. بررسی مرورگر باید فهرست بلندی با عبور از مرز صفحه‌ها، تأیید تودرتو، جایگزینی منبع هنگام ویرایش، اتصال درست و گم‌شده و حذف‌شده، و شکست بارگیری EPG را پوشش دهد. ترجیحات معنایی ترک‌های برنامهٔ بومی Android در مخزن جداگانهٔ آن پیاده‌سازی شده‌اند و مستقل از این کنترل‌های کلاسیک هستند.

</div>

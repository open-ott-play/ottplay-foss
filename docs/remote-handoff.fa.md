<a id="explicit-playback-handoff"></a>

# واگذاری صریح پخش

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

<div lang="fa" dir="rtl">

[بهبودها](roadmap-delivery.fa.md)

با پخش‌کننده و CLI کنترلِ به‌روز، `ott handoff SOURCE TARGET` را اجرا کنید. مبدأ به پخش ادامه می‌دهد. مقصد به همان منبع/حساب پیکربندی‌شده و یک شناسهٔ کانال یکتا و پایدار نیاز دارد. ارجاع‌های کانال اثرانگشت‌های محلی نسخه‌دار هستند، نه شناسه‌های خام آیتم‌های ارائه‌دهنده. ردیف‌های M3U کلاسیک URL دقیق جریان را فقط به‌عنوان ورودی هش محلی به کار می‌برند. بنابراین URLهایی که جداگانه امضا یا بازنویسی شده‌اند، برای ایمنی تطبیق داده نمی‌شوند. تطبیق تقریبی نام انجام نمی‌شود و اطلاعات ورود یا URL قابل پخش انتقال نمی‌یابد. نسخهٔ 1 از پخش زنده/آرشیو برای M3U، Xtream و Stalker پشتیبانی می‌کند؛ VOD/سریال و همگام‌سازی پیوستهٔ سابقهٔ تماشا پشتیبانی نمی‌شوند.

`playback_handoff_export` پارامترهای خالی را می‌پذیرد و `data.handoff` را برمی‌گرداند:

<div dir="ltr">

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

</div>

ارجاع‌های آرشیو از `kind: "archive"` و عدد صحیح `archive_start` (نقطهٔ فعلی پخش برحسب ثانیهٔ Unix) استفاده می‌کنند. `playback_handoff_import` فقط `{"handoff": ...}` را می‌پذیرد. مقصد پیش از ارسال فرمان، هویت فهرست، دسترس‌پذیری آرشیو، سیاست والدین/کیوسک و مالکیت فعلی کنترل را بررسی می‌کند. جریان‌ها را از طریق ارائه‌دهندهٔ خودش پیدا می‌کند. واردکردنِ پذیرفته‌شده `{"status":"ok","data":{"dispatched":true,"kind":"live"}}` را برمی‌گرداند. ارسال فرمان تأیید نمی‌کند که ویدئو رمزگشایی شده یا صدای HDMI شنیده می‌شود.

رد درخواست فقط یک کد خطا نشان می‌دهد: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. ارجاع‌ها محدودند؛ گیرنده فیلدهای اضافی را رد می‌کند. برای صدور/ورود از مجوزهای اپراتور با دامنهٔ محدود استفاده کنید و اتصال به کنترل‌کننده را محافظت کنید. هویت منبع یک کلید تطبیقِ مبهم است، نه اطلاعات ورودِ قابل انتقال برای دسترسی.

`node tests/test_remote_handoff.cjs` را اجرا کنید. برای احراز هویت، نتیجه‌ها و رفتار TTL فرمان‌ها به [راهنمای کنترل](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) مراجعه کنید.

</div>

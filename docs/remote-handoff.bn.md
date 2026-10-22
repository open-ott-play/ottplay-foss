<a id="explicit-playback-handoff"></a>

# সুস্পষ্ট প্লেব্যাক হস্তান্তর

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[উন্নতি](roadmap-delivery.bn.md)

আপডেট করা প্লেয়ার ও নিয়ন্ত্রণ CLI দিয়ে `ott handoff SOURCE TARGET` চালান। উৎসে প্লেব্যাক চলতে থাকে। গন্তব্যে একই উৎস/অ্যাকাউন্ট কনফিগার করা এবং অনন্য, স্থিতিশীল চ্যানেল ID থাকা প্রয়োজন। চ্যানেলের রেফারেন্স হলো সংস্করণযুক্ত স্থানীয় ফিঙ্গারপ্রিন্ট, কখনোই প্রদানকারীর আইটেমের কাঁচা ID নয়। ক্লাসিক M3U সারি কেবল স্থানীয় হ্যাশের ইনপুট হিসেবে স্ট্রিমের হুবহু URL ব্যবহার করে। তাই আলাদাভাবে স্বাক্ষরিত বা পুনর্লিখিত URL নিরাপত্তার কারণে মেলে না। নামের আনুমানিক মিল খোঁজা হয় না; শংসাপত্র বা চালানো যায় এমন URL-ও পাঠানো হয় না। সংস্করণ 1 M3U, Xtream ও Stalker-এর লাইভ/আর্কাইভ সমর্থন করে; VOD/সিরিজ এবং দেখার ইতিহাসের অবিরাম সিঙ্ক সমর্থিত নয়।

`playback_handoff_export` খালি প্যারামিটার গ্রহণ করে এবং `data.handoff` ফেরত দেয়:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

আর্কাইভ রেফারেন্সে `kind: "archive"` এবং পূর্ণসংখ্যার `archive_start` (Unix সেকেন্ডে বর্তমান প্লেব্যাকের অবস্থান) ব্যবহৃত হয়। `playback_handoff_import` শুধু `{"handoff": ...}` গ্রহণ করে। নির্দেশ পাঠানোর আগে গন্তব্য ক্যাটালগের পরিচয়, আর্কাইভের প্রাপ্যতা, অভিভাবকীয়/কিয়স্ক নীতি এবং বর্তমান নিয়ন্ত্রণের মালিকানা যাচাই করে। এটি নিজস্ব প্রদানকারীর মাধ্যমে স্ট্রিম নির্ধারণ করে। গৃহীত ইম্পোর্ট `{"status":"ok","data":{"dispatched":true,"kind":"live"}}` ফেরত দেয়। নির্দেশ পাঠানো মানেই ভিডিও ডিকোড হয়েছে বা HDMI-তে শব্দ শোনা যাচ্ছে—এমন নিশ্চিতকরণ নয়।

প্রত্যাখ্যানের ক্ষেত্রে শুধু ত্রুটির কোড প্রকাশ করা হয়: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`। রেফারেন্সের সীমা আছে; প্রাপক অতিরিক্ত ফিল্ড প্রত্যাখ্যান করে। এক্সপোর্ট/ইম্পোর্টের জন্য সীমিত পরিসরের অপারেটর অনুমতি ব্যবহার করুন এবং কন্ট্রোলারের সংযোগ সুরক্ষিত রাখুন। উৎসের পরিচয় মেলানোর একটি অস্বচ্ছ কী, হস্তান্তরযোগ্য প্রবেশাধিকারের শংসাপত্র নয়।

`node tests/test_remote_handoff.cjs` চালান। প্রমাণীকরণ, ফলাফল এবং কমান্ডের TTL আচরণের জন্য [নিয়ন্ত্রণ নির্দেশিকা](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) দেখুন।

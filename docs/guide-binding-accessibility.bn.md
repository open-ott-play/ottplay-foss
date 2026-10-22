<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# ম্যানুয়াল XMLTV বাঁধন ও কীবোর্ড অ্যাক্সেসিবিলিটি

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[গাইডের স্থাপত্য](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## প্লেলিস্ট সম্পাদনা না করেই চ্যানেলের গাইড ঠিক করুন

সমস্যাযুক্ত M3U চ্যানেল চালান, **তথ্য → EPG** খুলুন, তারপর EPG উৎস URL এবং **XMLTV ID** সম্পাদনা করুন। XMLTV ফাইলের `<channel id="…">` থেকে হুবহু ID দিন, প্রদর্শিত নাম নয়। বাঁধন সংরক্ষণ ও প্লেলিস্ট আবার লোড করতে **সেট করুন** বেছে নিন। **স্বয়ংক্রিয়** এই চ্যানেলের ওভাররাইড সরিয়ে প্লেলিস্টের মূল ম্যাপিং আবার লোড করে। শুধু তীরচিহ্নের কী দিয়ে সরলে বাঁধন সংরক্ষণ বা রিসেট হয় না। ফিরে গেলে সংরক্ষিত বাঁধন অপরিবর্তিত থাকে।

এই সম্পাদক হোস্ট করা ব্রাউজার ডিপ্লয়মেন্ট ও নেটিভ XMLTV শেলে (Tauri এবং Capacitor) পাওয়া যায়। এটি সরবরাহকারীর নিয়ন্ত্রিত গাইড, স্পষ্টভাবে নির্ধারিত `=source` JSON এন্ডপয়েন্ট বা বাইরের কম্প্যানিয়ন সার্ভার ওভাররাইড করে না। দূরবর্তী কম্প্যানিয়ন ব্যবহারকারী সাধারণ পুরোনো ব্রাউজার তার বিদ্যমান মিল খোঁজার প্রোটোকলই রাখে। প্রথম সংস্করণ হুবহু ID গ্রহণ করে; সব XMLTV চ্যানেলের অনুসন্ধানযোগ্য তালিকা ডাউনলোড বা প্রদর্শন করে না।

![ম্যানুয়াল বাঁধন প্লেলিস্টের উৎস ও স্থায়ী চ্যানেলকে একটি XMLTV ফিড ও হুবহু ID-র সঙ্গে যুক্ত করে; অন্যথায় স্বাভাবিক মিল খোঁজা চালু থাকে।](images/guide-binding.svg)

বাঁধনে প্লেলিস্ট উৎসের ফিঙ্গারপ্রিন্ট, স্থায়ী চ্যানেল কী, নির্দিষ্ট ফিড URL ও XMLTV ID রাখা হয়। চ্যানেলের পরিচয় একই থাকলে প্রদর্শিত লেবেলের নাম বা সারির ক্রম পাল্টালেও বাঁধন বদলায় না। প্লেলিস্ট URL/অ্যাকাউন্ট বদলালে উৎসের নেমস্পেস বদলায়। `itemId` ছাড়া পুরোনো M3U আইটেমে URL থেকে তৈরি বিদ্যমান চ্যানেল ID ব্যবহৃত হয়; সেই URL পাল্টালে তার পরিচয়ও পাল্টায়।

নির্বাচিত চ্যানেলের প্রদর্শিত নাম ও প্লেব্যাক URL অপরিবর্তিত থাকে। গাইড খোঁজার সময় একটি নির্দিষ্ট ফিড ব্যবহৃত হয়, নামের ভিত্তিতে ফলব্যাক নয়; তাই ID না পেলে নীরবে অন্য চ্যানেলের অনুষ্ঠান নেওয়া হয় না। চ্যানেলের নাম থেকে অনুমান করা স্বয়ংক্রিয় আঞ্চলিক সময়ের ব্যবধান এই নির্ভুল বাঁধনে প্রযোজ্য নয়; প্লেলিস্টে স্পষ্টভাবে দেওয়া `tvg-shift` তবু প্রযোজ্য থাকে। সঠিক আঞ্চলিক XMLTV ID দিন। CORS বা মিশ্র কনটেন্টের নিয়মের কারণে কাস্টম HTTPS-হোস্ট করা ফিড পড়া না গেলে সাধারণ EPG সমস্যা নির্ণয় সেই ব্যর্থতার কথা জানায়।

স্থানীয় রেকর্ডের সীমা প্রতি উৎসে 500টি বাঁধন ও 512 KiB; প্লেলিস্ট লোডের সময় এটি একবার পার্স হয়, প্রত্যেক চ্যানেলের জন্য নয়। লেখার সময় আগের মানের সঙ্গে তুলনা করা হয় এবং পুনরায় লোডের আগে সংরক্ষিত ফল আবার পড়ে যাচাই করা হয়। দেরিতে আসা সম্পাদক কলব্যাক প্রতিস্থাপিত উৎসে সংরক্ষণ করতে পারে না। এটি স্থানীয় পছন্দ, একাধিক ডিভাইসের মধ্যে সিঙ্ক্রোনাইজেশন নয়। ফিড URL-এ প্রবেশের গোপন তথ্য থাকতে পারে; স্টোরেজ এক্সপোর্ট প্রকাশ্যে শেয়ার করবেন না।

<a id="accessible-classic-controls"></a>

## অ্যাক্সেসযোগ্য ক্লাসিক নিয়ন্ত্রণ

- ভার্চুয়ালাইজড প্রধান তালিকা নামযুক্ত লিস্টবক্স, নির্বাচিত অপশন, মোট আইটেম সংখ্যা ও আইটেমের পরম অবস্থান প্রকাশ করে। শুধু নির্বাচিত দৃশ্যমান সারিটি Tab স্টপ হয়। তীরচিহ্নের কী দিয়ে নেভিগেশন দৃশ্যমান নির্বাচন ও অর্থগত অবস্থা দুটোই বদলায়; তালিকায় আগে থেকেই ফোকাস থাকলে পৃষ্ঠা বদলালেও ফোকাস তালিকার সঙ্গে থাকে।
- সাধারণ তথ্য/নিশ্চিতকরণ ডায়ালগ, সম্পাদক ও পরিচিতি প্যানেল মোডাল ভূমিকা এবং অনূদিত নাম প্রকাশ করে। Tab ও Shift+Tab সামনের মোডালের ভেতরে ঘুরে চলে। ভেতরের মোডাল বন্ধ হলে এখনও দৃশ্যমান প্যারেন্ট নিয়ন্ত্রণে ফোকাস ফেরে; মেয়াদোত্তীর্ণ নির্ধারিত খোলার অনুরোধ বন্ধ হওয়ার পরে ফোকাস কেড়ে নিতে পারে না।
- তথ্য ও নিশ্চিতকরণ বার্তা তাদের ডায়ালগের বিবরণ দেয়। সাময়িক বিজ্ঞপ্তি ভদ্র ঘোষণার স্ট্যাটাস অঞ্চল ব্যবহার করে।
- যোগ করা সব লেবেল বিদ্যমান অনুবাদ ক্যাটালগ থেকে আসে। XMLTV ও ID প্রোটোকলের শনাক্তকারী; চ্যানেলের নাম ও ফিডের হোস্টনাম উৎসের মেটাডেটাই থাকে।

অ্যাপ তার রিমোট-কন্ট্রোল পথ ও ES5 সিনট্যাক্স বজায় রাখে। অর্থগত DOM পরীক্ষা পূর্ণ WCAG সনদ নয়: ডিভাইসভেদে ফোকাস, VoiceOver/TalkBack-এর কথা বলা এবং টিভি ব্রাউজারের আচরণ এখনও বাস্তব যন্ত্রে পরীক্ষা করতে হয়।

<a id="verification"></a>

## যাচাই

চালান:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

সমন্বিত ব্রাঞ্চে স্বাভাবিক বিল্ড, ES5 ও বান্ডলের আকারের পরীক্ষাও চালান। ব্রাউজার পরীক্ষায় পৃষ্ঠা পেরিয়ে যাওয়া দীর্ঘ তালিকা; ভেতরের নিশ্চিতকরণ; সম্পাদনার সময় উৎস প্রতিস্থাপন; সঠিক, অনুপস্থিত ও সরানো বাঁধন; এবং EPG ডাউনলোড ব্যর্থতা থাকতে হবে। নেটিভ Android অ্যাপের অর্থগত ট্র্যাক পছন্দ তার আলাদা রিপোজিটরিতে বাস্তবায়িত এবং এই ক্লাসিক নিয়ন্ত্রণ থেকে স্বাধীন।

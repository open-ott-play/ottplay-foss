<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# ربط XMLTV يدويًا وإتاحة الاستخدام بلوحة المفاتيح

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

<div lang="ar" dir="rtl">

[بنية دليل البرامج](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## إصلاح دليل قناة دون تعديل قائمة التشغيل

شغّل قناة M3U المتأثرة، وافتح **المعلومات → EPG**، ثم عدّل عنوان URL لمصدر EPG و**معرّف XMLTV**. أدخل المعرّف المطابق تمامًا لما في `<channel id="…">` بملف XMLTV، وليس اسم العرض. اختر **تعيين** لحفظ الربط وإعادة تحميل قائمة التشغيل. يزيل **تلقائي** التجاوز الخاص بهذه القناة ويعيد تحميل ربط قائمة التشغيل الأصلي. التنقل بالأسهم وحده لا يحفظ الربط ولا يعيد ضبطه. الرجوع يترك الربط المحفوظ دون تغيير.

يتوفر هذا المحرر في النشر المستضاف بالمتصفح وفي أغلفة XMLTV الأصلية (Tauri وCapacitor). ولا يتجاوز الأدلة التي يديرها المزوّد أو نقاط JSON الصريحة `=source` أو الخوادم المرافقة الخارجية. يظل المتصفح القديم العادي الذي يستخدم خدمة مرافقة بعيدة على بروتوكول المطابقة الحالي. يقبل الإصدار الأول معرّفًا دقيقًا؛ ولا ينزّل أو يعرض قائمة قابلة للبحث بجميع قنوات XMLTV.

![يربط الربط اليدوي مصدر قائمة التشغيل والقناة المستقرة بتغذية XMLTV واحدة ومعرّف دقيق؛ وإلا تبقى المطابقة العادية فعّالة.](images/guide-binding.svg)

يخزّن الربط بصمة مصدر قائمة التشغيل ومفتاح القناة المستقر وعنوان URL الصريح للتغذية ومعرّف XMLTV. لا تؤثر إعادة تسمية عنوان العرض أو تغيير ترتيب الصفوف في الربط ما دامت هوية القناة ثابتة. يؤدي استبدال عنوان قائمة التشغيل أو حسابها إلى تغيير نطاق أسماء المصدر. تستخدم إدخالات M3U القديمة التي لا تحتوي على `itemId` معرّف القناة الحالي المشتق من URL؛ وتغيير هذا العنوان يغيّر هويتها.

تحتفظ القناة المحددة باسم العرض وعنوان التشغيل. يستخدم البحث في الدليل تغذية صريحة واحدة دون رجوع إلى المطابقة بالاسم، كي لا يستعير المعرّف المفقود برنامج قناة أخرى بصمت. لا تنطبق فروق التوقيت الإقليمية المستنتجة تلقائيًا من اسم القناة على هذا الربط الدقيق؛ لكن `tvg-shift` المحدد صراحة في قائمة التشغيل يبقى ساريًا. اضبط معرّف XMLTV الإقليمي الصحيح. إذا تعذرت قراءة تغذية مخصصة مستضافة عبر HTTPS بسبب قواعد CORS أو المحتوى المختلط، فستبلغ تشخيصات EPG المعتادة عن هذا الفشل.

يقتصر السجل المحلي على 500 ربط و512 KiB لكل مصدر؛ ويُحلّل مرة واحدة عند تحميل قائمة التشغيل، لا مرة لكل قناة. تقارن عمليات الكتابة القيمة السابقة وتقرأ النتيجة المخزّنة للتحقق منها قبل إعادة التحميل. لا يستطيع استدعاء محرر متأخر الحفظ في مصدر بديل. هذا تفضيل محلي وليس مزامنة بين الأجهزة. قد تتضمن عناوين التغذية بيانات اعتماد؛ لذا تجنّب مشاركة ملفات تصدير التخزين علنًا.

<a id="accessible-classic-controls"></a>

## عناصر التحكم التقليدية الميسّرة

- تعرض القائمة الرئيسية الافتراضية صندوق قائمة ذا اسم والخيار المحدد والعدد الكامل للعناصر والموضع المطلق للعنصر. وحده الصف المرئي المحدد يدخل تسلسل Tab. يحدّث التنقل بالأسهم التحديد المرئي والحالة الدلالية معًا؛ ويتبع التركيز القائمة عند تبديل الصفحة إن كانت مركّزة مسبقًا.
- تعرض حوارات المعلومات والتأكيد القياسية والمحرر ولوحات «حول» أدوارًا نمطية وأسماء مترجمة. يتنقل Tab وShift+Tab داخل النافذة النمطية الأمامية. يعيد إغلاق نافذة نمطية متداخلة التركيز إلى عنصر أب لا يزال مرئيًا؛ ولا تستطيع عمليات الفتح المجدولة القديمة انتزاع التركيز بعد الإغلاق.
- تصف رسائل المعلومات والتأكيد حواراتها. تستخدم الإشعارات المؤقتة منطقة حالة ذات إعلان غير مقاطع.
- تأتي جميع التسميات المضافة من كتالوجات الترجمة الحالية. XMLTV وID معرّفان للبروتوكول؛ وتبقى أسماء القنوات ومضيفي التغذيات بيانات وصفية من المصدر.

يحافظ التطبيق على مسارات جهاز التحكم عن بُعد وصياغة ES5. لا تمثل اختبارات DOM الدلالية اعتمادًا كاملًا وفق WCAG: لا يزال التركيز الخاص بالجهاز ونطق VoiceOver/TalkBack وسلوك متصفح التلفزيون بحاجة إلى اختبار على أجهزة فعلية.

<a id="verification"></a>

## التحقق

شغّل:

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

شغّل أيضًا اختبارات البناء وES5 وحجم الحزمة المعتادة على الفرع المدمج. ينبغي أن تغطي اختبارات المتصفح قائمة طويلة تعبر حدود الصفحات؛ وتأكيدًا متداخلًا؛ واستبدال المصدر أثناء التحرير؛ وربطًا صحيحًا وآخر مفقودًا وآخر محذوفًا؛ وفشل تنزيل EPG. تُنفّذ تفضيلات المسارات الدلالية لتطبيق Android الأصلي في مستودعه المنفصل، وهي مستقلة عن عناصر التحكم التقليدية هذه.

</div>

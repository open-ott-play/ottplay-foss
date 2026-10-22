<a id="explicit-playback-handoff"></a>

# نقل التشغيل بشكل صريح

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

<div lang="ar" dir="rtl">

[التحسينات](roadmap-delivery.ar.md)

باستخدام المشغّل وواجهة سطر أوامر التحكم المحدّثَين، شغّل `ott handoff SOURCE TARGET`. يواصل المصدر التشغيل. تحتاج الوجهة إلى إعداد المصدر/الحساب نفسه وإلى معرّف قناة فريد وثابت. مراجع القنوات بصمات محلية ذات إصدار، وليست أبدًا معرّفات عناصر المزوّد الخام. تستخدم صفوف M3U التقليدية عنوان URL الدقيق للبث فقط كمدخل للتجزئة المحلية. لذلك لا تُطابَق عناوين URL الموقّعة أو المعاد كتابتها بصورة مستقلة حفاظًا على الأمان. لا توجد مطابقة تقريبية للأسماء، ولا تُنقل بيانات اعتماد أو عناوين URL قابلة للتشغيل. يدعم الإصدار 1 البث المباشر/الأرشيف لـ M3U وXtream وStalker؛ ولا يدعم الفيديو عند الطلب/المسلسلات أو المزامنة المستمرة لسجل المشاهدة.

يقبل `playback_handoff_export` معاملات فارغة ويعيد `data.handoff`:

<div dir="ltr">

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

</div>

تستخدم مراجع الأرشيف `kind: "archive"` والعدد الصحيح `archive_start` (موضع التشغيل الحالي بثواني Unix). لا يقبل `playback_handoff_import` سوى `{"handoff": ...}`. تتحقق الوجهة من هوية الفهرس وتوافر الأرشيف وسياسة الرقابة الأبوية/الكشك وملكية التحكم الحالية قبل إرسال الأمر. وتحدّد البث عبر مزوّدها الخاص. يعيد الاستيراد المقبول `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. إرسال الأمر لا يؤكد فك ترميز الفيديو أو سماع صوت HDMI.

لا يكشف الرفض إلا رمز خطأ: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. للمراجع حدود، ويرفض المستقبِل الحقول الإضافية. استخدم صلاحيات مشغّل محدودة النطاق للتصدير/الاستيراد واحمِ الاتصال بوحدة التحكم. هوية المصدر مفتاح مطابقة معتم وليست بيانات اعتماد وصول قابلة للنقل.

شغّل `node tests/test_remote_handoff.cjs`. راجع [دليل التحكم](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) للمصادقة والنتائج وسلوك مدة صلاحية الأوامر TTL.

</div>

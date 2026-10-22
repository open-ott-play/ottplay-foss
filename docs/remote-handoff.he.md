<a id="explicit-playback-handoff"></a>

# העברה מפורשת של הניגון

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

<div lang="he" dir="rtl">

[שיפורים](roadmap-delivery.he.md)

עם נגן ו־CLI שליטה מעודכנים, הריצו `ott handoff SOURCE TARGET`. המקור ממשיך לנגן. היעד זקוק לאותו מקור/חשבון מוגדר ולמזהה ערוץ ייחודי ויציב. הפניות לערוצים הן טביעות אצבע מקומיות בעלות גרסה, ולעולם אינן מזהי הפריטים הגולמיים של הספק. שורות M3U הקלאסיות משתמשות בכתובת הזרם המדויקת רק כקלט לגיבוב מקומי. לכן כתובות שנחתמו או נכתבו מחדש בנפרד אינן מותאמות, מטעמי בטיחות. אין התאמת שמות מקורבת, ולא מועברים פרטי הזדהות או כתובות שניתן לנגן. גרסה 1 תומכת בשידור חי/ארכיון עבור M3U, Xtream ו־Stalker; היא אינה תומכת ב־VOD/סדרות או בסנכרון רציף של היסטוריית הצפייה.

`playback_handoff_export` מקבל פרמטרים ריקים ומחזיר `data.handoff`:

<div dir="ltr">

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

</div>

הפניות לארכיון משתמשות ב־`kind: "archive"` ובמספר השלם `archive_start` (נקודת הניגון הנוכחית בשניות Unix). `playback_handoff_import` מקבל רק `{"handoff": ...}`. לפני שליחת הפקודה, היעד בודק את זהות הקטלוג, זמינות הארכיון, מדיניות בקרת ההורים/קיוסק והבעלות הנוכחית על השליטה. הוא מאתר זרמים דרך הספק שלו. ייבוא שהתקבל מחזיר `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. השליחה אינה מאשרת פענוח וידאו או צליל HDMI שניתן לשמוע.

דחיות חושפות רק קוד שגיאה: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. להפניות יש גבולות; המקבל דוחה שדות נוספים. השתמשו בהרשאות מפעיל מוגבלות בהיקפן לייצוא/ייבוא והגנו על החיבור לבקר. זהות המקור היא מפתח התאמה אטום, ולא אמצעי הזדהות להעברת גישה.

הריצו `node tests/test_remote_handoff.cjs`. ראו את [מדריך השליטה](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) למידע על אימות, תוצאות והתנהגות TTL של פקודות.

</div>

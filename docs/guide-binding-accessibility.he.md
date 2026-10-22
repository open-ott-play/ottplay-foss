<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# שיוך XMLTV ידני ונגישות מקלדת

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

<div lang="he" dir="rtl">

[ארכיטקטורת מדריך התוכניות](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## תיקון מדריך של ערוץ ללא עריכת רשימת ההשמעה

הפעילו את ערוץ ה־M3U הרלוונטי, פתחו **מידע → EPG**, וערכו את כתובת מקור ה־EPG ואת **מזהה ה־XMLTV**. הזינו את המזהה המדויק מתוך `<channel id="…">` בקובץ XMLTV, ולא את שם התצוגה. בחרו **הגדרה** כדי לשמור את השיוך ולטעון מחדש את רשימת ההשמעה. **אוטומטי** מסיר את העקיפה של ערוץ זה וטוען מחדש את המיפוי המקורי של הרשימה. תנועה בחצים בלבד אינה שומרת או מאפסת שיוך. חזרה לא משנה את השיוך השמור.

העורך זמין בפריסת הדפדפן המתארחת ובמעטפות XMLTV המקוריות, Tauri ו־Capacitor. הוא אינו עוקף מדריכים שבשליטת ספק, נקודות קצה מפורשות של JSON מסוג `=source` או שרתי ליווי חיצוניים. דפדפן ישן רגיל המשתמש בשירות ליווי מרוחק שומר על פרוטוקול ההתאמה הקיים שלו. הגרסה הראשונה מקבלת מזהה מדויק; היא אינה מורידה או מציגה רשימה ניתנת לחיפוש של כל ערוצי XMLTV.

![שיוך ידני מחבר את מקור רשימת ההשמעה ואת הערוץ היציב להזנת XMLTV אחת ולמזהה מדויק; אחרת ההתאמה הרגילה נשארת פעילה.](images/guide-binding.svg)

השיוך שומר טביעת אצבע של מקור הרשימה, מפתח ערוץ יציב, כתובת מפורשת של ההזנה ומזהה XMLTV. שינוי שם התווית או סדר השורות אינו משנה שיוך כל עוד זהות הערוץ נשמרת. החלפת כתובת הרשימה או החשבון משנה את מרחב השמות של המקור. ברשומות M3U ישנות ללא `itemId` נעשה שימוש במזהה הערוץ הקיים שנגזר מהכתובת; שינוי כתובת זו משנה את זהותו.

הערוץ הנבחר שומר על שם התצוגה ועל כתובת הניגון. חיפוש המדריך משתמש בהזנה מפורשת אחת ללא חזרה להתאמה לפי שם, כך שמזהה חסר לא גורם ללקיחת תוכנית מערוץ אחר בשקט. הפרשי זמן אזוריים שהוסקו אוטומטית משם הערוץ אינם חלים על שיוך מדויק זה; `tvg-shift` מפורש ברשימת ההשמעה עדיין חל. הגדירו את מזהה ה־XMLTV האזורי הנכון. אם כללי CORS או תוכן מעורב מונעים קריאת הזנה מותאמת המתארחת ב־HTTPS, אבחון ה־EPG הרגיל מדווח על הכשל.

הרשומה המקומית מוגבלת ל־500 שיוכים ול־512 KiB לכל מקור; היא מפוענחת פעם אחת בטעינת רשימה, ולא פעם לכל ערוץ. הכתיבות משוות לערך הקודם וקוראות בחזרה את התוצאה השמורה לפני טעינה מחדש. קריאה חוזרת מאוחרת של העורך אינה יכולה לשמור במקור שהוחלף. זו העדפה מקומית, לא סנכרון בין מכשירים. כתובות הזנה עשויות להכיל פרטי התחברות; הימנעו משיתוף ציבורי של ייצוא האחסון.

<a id="accessible-classic-controls"></a>

## פקדים קלאסיים נגישים

- הרשימה הראשית הווירטואלית חושפת תיבת רשימה בעלת שם, אפשרות נבחרת, מספר פריטים כולל ומיקום מוחלט של הפריט. רק השורה הנבחרת הגלויה היא תחנת Tab. ניווט בחצים מעדכן גם את הבחירה החזותית וגם את המצב הסמנטי; כשהרשימה כבר ממוקדת, המיקוד עוקב אחריה בהחלפת עמוד.
- תיבות מידע ואישור רגילות, העורך ולוחות האודות חושפים תפקידים מודאליים ושמות מקומיים. Tab ו־Shift+Tab נעים במחזור בתוך המודאל שבחזית. סגירת מודאל מקונן מחזירה את המיקוד לפקד האב שעדיין גלוי; פתיחות מתוזמנות שהתיישנו אינן יכולות לגנוב מיקוד לאחר סגירה.
- הודעות המידע והאישור מתארות את תיבות הדו־שיח שלהן. הודעות זמניות משתמשות באזור מצב עם הכרזה לא מפריעה.
- כל התוויות שנוספו מגיעות מקטלוגי התרגום הקיימים. XMLTV ו־ID הם מזהי פרוטוקול; שמות ערוצים ושמות מארחי הזנות נשארים מטא־נתוני מקור.

היישום שומר על מסלולי השלט הרחוק ועל תחביר ES5. בדיקות DOM סמנטיות אינן הסמכת WCAG מלאה: מיקוד ייחודי למכשיר, דיבור VoiceOver/TalkBack והתנהגות דפדפני טלוויזיה עדיין דורשים בדיקה במכשירים פיזיים.

<a id="verification"></a>

## אימות

הריצו:

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

הריצו גם בדיקות רגילות של בנייה, ES5 וגודל החבילה בענף המשולב. בדיקות הדפדפן צריכות לכלול רשימה ארוכה החוצה גבולות עמודים; אישור מקונן; החלפת מקור בזמן עריכה; שיוך תקין, חסר ומוסר; וכשל בהורדת EPG. העדפות הרצועות הסמנטיות של יישום Android המקורי ממומשות במאגר הנפרד שלו ואינן תלויות בפקדים הקלאסיים האלה.

</div>

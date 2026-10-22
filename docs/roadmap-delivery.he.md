<div lang="he" dir="rtl">

# שיפורים באמינות ובמדיה

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[ויקי](wiki/Home.he.md) · [ארכיטקטורה](architecture.md)

מדריך זה מתאר את המימוש בגרסת המקור של הדף, ולא את יכולותיו של שחרור ישן שמותקן. הנגן, שירות הבקרה/CLI ויישום Android המקורי הם תוצרים נפרדים. עדכון אחד אינו מעדכן את האחרים.

![תחומי אחריות וגבולות אמון](diagrams/roadmap-components.svg)

ראו את [עלות הבתים שנמדדה ותרשים ההשוואה](roadmap-size.he.md); מהירות הביצוע והניגון במכשירים הם בדיקות קבלה נפרדות.

<a id="what-is-implemented"></a>

## מה מומש

1. **דגימת אודיו/וידאו מוכרת.** [מידע ← אודיו](audio-video-check.he.md) מנגן קטע בן שמונה שניות מ-here.now (נדרש אינטרנט), עם צלילים שמאליים/ימניים והבזקים תואמים. הוא נשלף רק אחרי **ניגון**, לעולם לא בהפעלה; קובץ המדיה אינו כלול בחבילות הנגן. הוא משתמש זמנית במפענח HTML5 הראשי רק במצב סרק או בצפייה בטלוויזיה חיה. הוא אינו כותב היסטוריית צפייה. [מפרט הדגימה](../diagnostics/README.md).
2. **הגדרת Local/Home שניתנת להמשך.** CLI הבקרה יכול לתכנן, להחיל, להמשיך ולאמת הגדרה מוקדמת. הוא משווה הגדרות שמורות לפני ניסיון חוזר של כתיבה שתוצאתה אינה ודאית. [תהליך הבקרה](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **שחזור ניגון מוגבל.** כשלים זמניים ב-HLS/Shaka חולקים מדיניות שחזור סופית. שגיאות אימות ו-DRM שאינו נתמך הן סופיות. Stop, החלפת ערוץ והחלפת מקור מבטלים עבודה שהתיישנה.
4. **מגבלות איכות שמורות.** הגובה וקצב הסיביות המרביים מגבילים בחירה אדפטיבית; מעבר לניגון מקורי אינו רשאי לעקוף בשקט תקרה פעילה.
5. **העדפות רצועות ב-Android המקורי.** יישום Android העצמאי זוכר כוונה לפי שפה/תפקיד/תווית, כולל Auto וכיבוי כתוביות, במקום להעביר אינדקס רצועה מזרם אחר.
6. **מפעילי פקודות בהרשאות מוגדרות.** הבקר יכול להעניק לפרטי גישה הרשאה למכשירים/פעולות מדויקים בלי למסור פרטי מנהל.
7. **קישורי XMLTV מפורשים.** ערוץ בתחום רשימת השמעה יכול להיות מקושר להזנה ולמזהה XMLTV מסוימים. [קישורי מדריך ונגישות](guide-binding-accessibility.he.md).
8. **סרטים וסדרות Xtream.** ספריית המדיה טוענת לפי הצורך את הקטלוג הנבחר ולאחריו את פרקי הסדרה. [חוזה הספרייה](xtream-media.he.md).
9. **פקדים קלאסיים נגישים.** רשימות ערוצים חושפות את משמעות הבחירה; תיבות דו-שיח מודאליות שומרות ומשחזרות את מיקוד המקלדת; הודעות כוללות אזור חי.
10. **תוצאות פקודות עמידות.** יומן בקר אופציונלי ומוגבל שומר מטא-נתונים של מניעת כפילות ושל תוצאות. הפעלה מחדש לעולם אינה מריצה פקודות שוב באופן עיוור.
11. **העברה מפורשת למכשיר.** הפניות לשידור חי/ארכיון עוברות לנגן שהוגדר עם אותו מקור. היעד פותר בעצמו את ה-URL שלו. [חוזה](remote-handoff.he.md).
12. **זרמי גיבוי מפורשים.** ערוצים חיים יכולים להשתמש בחלופות מוגדרות במסגרת אותה מדיניות שחזור סופית. [מגבלות, שחזור וגיבויים](playback-stream-policy.he.md).
13. **אצוות הגדרות ניתנות לשחזור.** localStorage מקורי משתמש ביומן ביטול עבור כתיבות נתמכות של כמה מפתחות. [הבטחות האחסון](settings-recovery.he.md).

<a id="language-and-compatibility-coverage"></a>

## כיסוי שפות ותאימות

הנגן כולל 88 קטלוגי תרגום. שבע תוויות האיכות/מדיה החדשות מתורגמות בכל קטלוג; תפריטים חדשים אחרים משתמשים בתוויות מתורגמות קיימות. בדיקות הקטלוג מכסות התאמת מפתחות, מצייני מקום וחריגים שנבדקו. המדריכים ההנדסיים המקבילים מסבירים את אותן מגבלות מימוש ב-[24 שפות תיעוד](manual-translations.md). [נקודות הכניסה המתורגמות](readme/README.md) הן מדריכי התחלה מהירה, לא טענה שלכל מסמך הנדסי היסטורי יש 88 תרגומים מלאים.

הפלט הקלאסי נשאר בתחביר ES5. אין פירוש הדבר שכל מכשיר תומך בכל קודק, Web API, הבטחת אחסון או שילוב מקורי. תצוגת A/V מוגבלת לנתיב HTML5 הראשי המנוהל; מנועי מכשיר שמחליפים אותו, כמו PC2/Video.js ומנועים מקוריים, אינם כלולים. קישורי מדריך מפורשים משתמשים במימוש XMLTV מתארח או מקורי; פרוטוקולי companion חיצוניים ואופציונליים עלולים שלא לתמוך בהם. קבלה ייעודית למכשיר עדיין מחייבת את המכשיר עצמו.

<a id="reproduce-the-checks"></a>

## שחזור הבדיקות

<div dir="ltr">

```sh
npm ci
npm run typecheck
npm run test:localization
npm test
npm run build:server
npm run check:es5
npm run check:size
python3 scripts/check-av-diagnostic.py diagnostics/av-v1.mp4
```

</div>

מאמת המדיה דורש FFmpeg/FFprobe. הוא מפענח את שני ערוצי האודיו ובודק אנרגיה, הפרדה ושקט; עצם קיומה של רצועת AAC אינו ראיה לתוכן נשמע. בדיקות JavaScript הרגילות בוחנות ביטול, כתיבות שנכשלו, שחזור לאחר הפעלה מחדש, החלפות מקור וקלט לא תקין. בדיקות החבילה הסופיות כוללות משפחות ספקים אופציונליות, ולא רק את נקודת הכניסה הראשית.

בבקר הריצו `go test -race ./...`,‏ `go vet ./...` ו-`python3 -m unittest discover -s tests`. ב-Android המקורי הריצו בדיקות יחידה להעדפות רצועות ולגיבוי הגדרות ובנו APK לניפוי שגיאות. ה-CI של כל מאגר תקף ל-commit המתאים, ולא לעץ ששונה לאחר מכן.

<a id="physical-acceptance-before-promotion"></a>

## קבלה פיזית לפני קידום

- בטלוויזיית היעד הריצו את בדיקת A/V ואמתו אודיו שמאל/ימין, הבזקים נראים, Stop וחזרה לטלוויזיה חיה. בדיקות מפענח אינן מוכיחות צליל HDMI או חלקות.
- בדקו זרמים מותרים/נדחים, גיבוי שנכשל והחלפת ערוץ בזמן ניסיון חוזר ממתין. אמתו את מגבלת האיכות הנבחרת במנוע בפועל.
- בדקו מיקוד רשימות/דו-שיח עם מקלדת, שלט וקורא מסך זמין.
- קשרו שני שמות ערוצים דומים למזהי XMLTV נפרדים ואמתו את נתוני התוכניות.
- קטעו החלת הגדרה מוקדמת לבדיקה, הפעילו מחדש את הבקר, המשיכו ואמתו. העבירו ניגון גם למקור מוגדר תואם וגם לכזה שאינו תואם.
- ב-Android המקורי החליפו זרמים שסדר הרצועות שלהם שונה, הפעילו מחדש את היישום ואמתו Auto/Off מפורשים והתנהגות שפה מועדפת.

שליחה מוצלחת, הגדרות שמורות, דגימות מפוענחות ובדיקות יחידה שעברו הן ראיות שונות. קידום שחרור חייב לשמור על הבחנה זו; ראו [אסטרטגיית השחרור](../RELEASING.md).

</div>

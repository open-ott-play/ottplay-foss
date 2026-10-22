<a id="measured-javascript-cost"></a>

# עלות JavaScript שנמדדה

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

<div lang="he" dir="rtl">

[מדריך תכונות](roadmap-delivery.he.md) · [ראיות גולמיות](evidence/roadmap-size-20261015.json)

![השוואת כל קוד ה־JavaScript של הנגן באמצעות אותה שרשרת כלים](diagrams/roadmap-size.svg)

עמוד זה משמר את מדידות JavaScript מתמונות המצב של המקור המופיעות להלן. הן אינן מודדות את הגרסה הנוכחית, חבילות התקנה או תעבורת רשת.

בהשוואה הראשונית, נקודת הכניסה הראשית יחד עם כל משפחות הספקים האופציונליות גדלו ב־**31 128 בתים גולמיים / 9 759 בתי gzip**, כ־**3.23% / 3.20%**. זו עלייה בעלות התכונות, לא טענה לשיפור בגודל או במהירות הביצוע. Xtream עדיין נטען לפי דרישה; הוצאתו מנקודת הכניסה אינה מוציאה אותו מהסכום הכולל.

המדידה משווה את ארכיוני המקור הנקיים `bbf9ca7b` ו־`cae971da`, שניהם בגרסה 1.1.55, עם Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 ו־zlib 1.2.12. היא משתמשת במרכיב ES5 לייצור, בממטב, במדיניות השמות ובזהות הנכונה של המקור הנקי. gzip ברמה 9 מופעל בנפרד על כל משאב שנוצר.

- כניסת web: 848 092 / 262 392 → 874 926 / 270 321 בתים גולמיים/gzip.
- כניסת web + כל הספקים: 964 459 / 305 344 → 995 587 / 315 103.
- כניסה מקורית: 848 050 / 262 460 → 874 884 / 270 372.
- כניסה מקורית + כל הספקים: 964 417 / 305 412 → 995 545 / 315 154.
- M3U האופציונלי גדל ב־184 בתים גולמיים / 82 gzip; Xtream החדש הוא 4 110 / 1 748. שש המשפחות האופציונליות האחרות זהות בית לבית.

לפני שהסרטון הועבר ל־here.now, שינוי ה־URL שלו לנתיב מקומי מהשורש הוסיף בית JavaScript גולמי אחד ברצף ההיסטורי הזה. זו אינה מדידה של הכתובת המתארחת המאוחרת יותר. תיקון הניסיונות החוזרים המוגבלים לפענוח HLS מוסיף 37 בתים גולמיים / 36 gzip בהשוואה מבודדת של אותה תמונת מצב ([ראיה](evidence/parse-recovery-size-20261015.json)). תיקון הבעלות על העברת Auto המקורית מוסיף עוד 101 בתים גולמיים / 39 gzip ([ראיה](evidence/auto-recovery-size-20261015.json)). הסכום הגולמי לפני תיקוני נסיגות הנגישות הוא 995 726 בתים; זהות הבנייה ובתי gzip עשויים להשתנות ב־commit הסופי. `build/reports/classic-bundle.json` הסופי ו־`npm run check:size` נשארים הסמכות לגבי הגרסה המדויקת שסופקה. הבנייה הנקייה הבאה `652726f8`, הכוללת תיקוני מיקוד מצביע/דו־שיח, מודדת **995 858 בתים גולמיים / 315 207 gzip** לנגן ה־web המלא ([ראיית התוצר הסופי](evidence/roadmap-final-size-20261015.json)). הכניסה שלה היא 875 197 / 270 425; הסכומים המקוריים הם 995 816 / 315 259. התקרות של תמונת המצב שמרו את המרווח הקודם למקורי/Node/סיומת שחרור: 875 300 גולמי / 271 600 gzip לכניסה; 996 100 / 316 400 לכניסה + ספקים.

<a id="post-beta-integration"></a>

## שילוב לאחר הבטא

![JavaScript מלא לאחר שילוב beta.4](diagrams/post-beta-size.svg)

ההשוואה המאוחרת משחזרת את מקור beta.4 `39287792` מול סביבת הריצה `9663b681`, כולל שילוב Plex ושחזור הגדרות פגומות, באותם Node 26.8.2, Rollup 4.64.5 ו־Terser 5.51.2:

- כניסת web: 848 315 / 262 443 → 879 533 / 271 761 בתים גולמיים/gzip.
- כניסת web + כל הספקים: 964 876 / 305 452 → 1 000 388 / 316 600.
- כניסה מקורית + כל הספקים: 964 834 / 305 520 → 1 000 346 / 316 654.
- גידול במטען ה־web המלא: **35 512 / 11 148 בתים (3.68% / 3.65%)**.

קו הבסיס סופר שבע משפחות ספקים; השילוב סופר שמונה, כולל Xtream בטעינה לפי דרישה. תקרות הכניסה באותה תמונת מצב היו 879 900 / 273 000; התקרות הכוללות היו 1 000 800 / 317 800, תוך שמירת מקום למקורי, Node וזהות השחרור. שתי בניות הייצור המקומיות מייצרות מחדש חמישה קובצי זמן ריצה מנוהלי גרסאות ומשמיטות את הטענה לגרסת מקור נקייה. אלה תוצרים ששוחזרו מקומית, לא קובצי הבטא הבינריים שפורסמו. גרסאות כלים, ערכי גיבוב והמגבלה הזו מתועדים ב[ראיות קו הבסיס](evidence/post-beta-baseline-size-20261015.json) וב[ראיות השילוב](evidence/post-beta-candidate-size-20261015.json). [דוח המימוש](implementation-report.he.md#post-beta-integration-and-review) מסביר את התיקונים והאימות.

**היקף:** סכומי JavaScript האלה אינם כוללים מנועי מדיה חיצוניים, מילוני שפות, CSS, תמונות או וידאו. חבילות הנגן ההיסטוריות כללו גם **סרטון A/V של 464 652 בתים**, מחוץ לסכומים לעיל. אספקתו הנוכחית נפרדת ממדידות אלה:

- **מאגר:** `diagnostics/av-v1.mp4` נשאר עם המחולל והמאמת שלו לצורך שחזור. שמירת קובץ מקור אינה כוללת אותו בחבילה.
- **חבילות:** Web/OTTPlay Server, Tauri, Capacitor ו־Docker אינם כוללים את הסרטון. הדבר מסיר 464 652 בתי מדיה גולמיים, ולא ירידה שנמדדה בגודל 464 652 בתים במתקין דחוס. פורמט הארכיון ושינויי בנייה אחרים משפיעים על הגודל הזה.
- **רשת:** הנגן מביא את הסרטון מ־here.now רק כשהמשתמש מתחיל [בדיקת A/V](audio-video-check.he.md). הבדיקה דורשת אינטרנט; הסרטון אינו נשלף לצורך ניגון בעת ההפעלה.

מדידות JavaScript ההיסטוריות לעיל נשארות ללא שינוי. מדידת השפעת ה־URL המתארח על JavaScript או מתקין נוכחי דורשת השוואה חדשה. 88 קובצי README המתורגמים הם תיעוד המאגר, לא מטען הנגן. השוואת הבתים אינה מבססת טענה על זמן הפעלה, קצב פריימים, זיכרון או ביצועים בהיקף קטלוג. אלה דורשים מדידות נפרדות במכשירי היעד.

</div>

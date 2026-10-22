<a id="explicit-playback-handoff"></a>

# การส่งต่อการเล่นอย่างชัดเจน

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[การปรับปรุง](roadmap-delivery.th.md)

เมื่ออัปเดตตัวเล่นและ CLI ควบคุมแล้ว ให้เรียกใช้ `ott handoff SOURCE TARGET` ต้นทางจะเล่นต่อไป ปลายทางต้องกำหนดค่าแหล่งที่มา/บัญชีเดียวกัน และมี ID ช่องที่ไม่ซ้ำและคงที่ การอ้างอิงช่องเป็นลายนิ้วมือภายในเครื่องที่มีเวอร์ชัน ไม่ใช่ ID ดิบของรายการจากผู้ให้บริการ แถว M3U แบบคลาสสิกใช้ URL สตรีมที่ตรงทุกตัวอักษรเป็นเพียงข้อมูลเข้าของแฮชภายในเครื่อง ดังนั้น URL ที่ลงนามหรือเขียนใหม่แยกกันจะไม่ถูกจับคู่เพื่อความปลอดภัย ไม่มีการจับคู่ชื่อแบบประมาณ และไม่มีการส่งข้อมูลรับรองหรือ URL ที่เล่นได้ เวอร์ชัน 1 รองรับรายการสด/ย้อนหลังสำหรับ M3U, Xtream และ Stalker แต่ไม่รองรับ VOD/ซีรีส์หรือการซิงก์ประวัติการรับชมอย่างต่อเนื่อง

`playback_handoff_export` รับพารามิเตอร์ว่างและส่งคืน `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

การอ้างอิงรายการย้อนหลังใช้ `kind: "archive"` และจำนวนเต็ม `archive_start` (ตำแหน่งการเล่นปัจจุบันเป็นวินาที Unix) `playback_handoff_import` รับเฉพาะ `{"handoff": ...}` ก่อนส่งคำสั่ง ปลายทางจะตรวจสอบตัวตนของแค็ตตาล็อก ความพร้อมของรายการย้อนหลัง นโยบายผู้ปกครอง/คีออสก์ และความเป็นเจ้าของการควบคุมในปัจจุบัน ปลายทางหาสตรีมผ่านผู้ให้บริการของตนเอง การนำเข้าที่ได้รับการยอมรับจะส่งคืน `{"status":"ok","data":{"dispatched":true,"kind":"live"}}` การส่งคำสั่งไม่ใช่การยืนยันว่าถอดรหัสวิดีโอได้หรือได้ยินเสียง HDMI

เมื่อปฏิเสธ จะเปิดเผยเพียงรหัสข้อผิดพลาด: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed` การอ้างอิงมีขอบเขตจำกัด และผู้รับจะปฏิเสธฟิลด์เพิ่มเติม ใช้สิทธิ์ผู้ปฏิบัติงานที่จำกัดขอบเขตสำหรับการส่งออก/นำเข้า และป้องกันการเชื่อมต่อกับตัวควบคุม ตัวตนของแหล่งที่มาเป็นคีย์ทึบแสงสำหรับการจับคู่ ไม่ใช่ข้อมูลรับรองการเข้าถึงที่โอนให้กันได้

เรียกใช้ `node tests/test_remote_handoff.cjs` ดู [คู่มือการควบคุม](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) สำหรับการยืนยันตัวตน ผลลัพธ์ และพฤติกรรม TTL ของคำสั่ง

<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# การผูก XMLTV ด้วยตนเองและการเข้าถึงด้วยแป้นพิมพ์

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[สถาปัตยกรรมผังรายการ](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## แก้ผังรายการของช่องโดยไม่ต้องแก้เพลย์ลิสต์

เล่นช่อง M3U ที่มีปัญหา เปิด **ข้อมูล → EPG** แล้วแก้ URL ของแหล่ง EPG และ **XMLTV ID** ป้อน ID ที่ตรงกับ `<channel id="…">` ในไฟล์ XMLTV ทุกตัว ไม่ใช่ชื่อที่แสดง เลือก **ตั้งค่า** เพื่อบันทึกการผูกและโหลดเพลย์ลิสต์ใหม่ **อัตโนมัติ** จะลบค่าทับเฉพาะช่องนี้และโหลดการจับคู่เดิมของเพลย์ลิสต์อีกครั้ง การเคลื่อนด้วยปุ่มลูกศรอย่างเดียวจะไม่บันทึกหรือรีเซ็ตการผูก การย้อนกลับจะไม่เปลี่ยนการผูกที่บันทึกไว้

ตัวแก้ไขนี้ใช้ได้ในการติดตั้งเบราว์เซอร์แบบโฮสต์และเชลล์ XMLTV แบบเนทีฟ (Tauri และ Capacitor) โดยไม่ทับผังรายการที่ผู้ให้บริการควบคุม ปลายทาง JSON แบบระบุชัดเจน `=source` หรือเซิร์ฟเวอร์คู่หูภายนอก เบราว์เซอร์รุ่นเก่าทั่วไปที่ใช้คู่หูระยะไกลยังคงใช้โปรโตคอลจับคู่เดิม รุ่นแรกยอมรับ ID ที่ตรงทุกตัว โดยไม่ดาวน์โหลดหรือแสดงรายการช่อง XMLTV ทั้งหมดที่ค้นหาได้

![การผูกด้วยตนเองเชื่อมแหล่งเพลย์ลิสต์และช่องที่มีอัตลักษณ์คงที่เข้ากับฟีด XMLTV หนึ่งฟีดและ ID ที่ตรงกัน หากไม่มีการผูกจะยังใช้การจับคู่ปกติ](images/guide-binding.svg)

การผูกเก็บลายนิ้วมือของแหล่งเพลย์ลิสต์ คีย์ช่องที่คงที่ URL ฟีดที่ระบุชัดเจน และ XMLTV ID การเปลี่ยนป้ายชื่อที่แสดงหรือลำดับแถวไม่เปลี่ยนการผูกหากอัตลักษณ์ของช่องยังเหมือนเดิม การเปลี่ยน URL หรือบัญชีของเพลย์ลิสต์จะเปลี่ยนเนมสเปซของแหล่ง สำหรับรายการ M3U รุ่นเก่าที่ไม่มี `itemId` จะใช้ ID ช่องเดิมที่สร้างจาก URL การเปลี่ยน URL นั้นจึงเปลี่ยนอัตลักษณ์ด้วย

ช่องที่เลือกยังคงชื่อที่แสดงและ URL เล่นเดิม การค้นผังรายการใช้ฟีดที่ระบุชัดเจนเพียงหนึ่งฟีดและไม่ย้อนกลับไปจับคู่ด้วยชื่อ ดังนั้นเมื่อไม่มี ID จึงไม่แอบใช้รายการของช่องอื่น ค่าเวลาชดเชยตามภูมิภาคที่อนุมานอัตโนมัติจากชื่อช่องจะไม่ใช้กับการผูกแบบตรงนี้ แต่ `tvg-shift` ที่ระบุชัดเจนในเพลย์ลิสต์ยังมีผล ตั้ง XMLTV ID ของภูมิภาคให้ถูกต้อง หากอ่านฟีด HTTPS ที่กำหนดเองไม่ได้เพราะกฎ CORS หรือเนื้อหาแบบผสม ระบบวินิจฉัย EPG ปกติจะรายงานความล้มเหลวนั้น

ข้อมูลภายในเครื่องจำกัดไว้ที่ 500 การผูกและ 512 KiB ต่อแหล่ง โดยแยกวิเคราะห์ครั้งเดียวเมื่อโหลดเพลย์ลิสต์ ไม่ใช่ครั้งละช่อง การเขียนจะเปรียบเทียบค่าก่อนหน้าและอ่านผลที่เก็บไว้กลับมาก่อนโหลดใหม่ คอลแบ็กจากตัวแก้ไขที่มาช้าไม่สามารถบันทึกลงแหล่งที่ถูกเปลี่ยนแล้ว นี่คือค่ากำหนดภายในเครื่อง ไม่ใช่การซิงก์ข้ามอุปกรณ์ URL ฟีดอาจมีข้อมูลรับรอง จึงควรหลีกเลี่ยงการเผยแพร่ไฟล์ส่งออกจากพื้นที่จัดเก็บต่อสาธารณะ

<a id="accessible-classic-controls"></a>

## ตัวควบคุมแบบคลาสสิกที่เข้าถึงได้

- รายการหลักแบบเสมือนเปิดเผยกล่องรายการที่มีชื่อ ตัวเลือกที่เลือก จำนวนรายการทั้งหมด และตำแหน่งสัมบูรณ์ของรายการ เฉพาะแถวที่เลือกและมองเห็นเท่านั้นที่เป็นจุดหยุด Tab การนำทางด้วยลูกศรปรับทั้งการเลือกที่มองเห็นและสถานะเชิงความหมาย หากรายการมีโฟกัสอยู่แล้ว โฟกัสจะตามรายการไปเมื่อเปลี่ยนหน้า
- กล่องข้อมูล/ยืนยันมาตรฐาน ตัวแก้ไข และแผงเกี่ยวกับเปิดเผยบทบาทโมดัลและชื่อที่แปลแล้ว Tab และ Shift+Tab วนอยู่ภายในโมดัลด้านหน้า เมื่อปิดโมดัลซ้อน โฟกัสจะกลับไปยังตัวควบคุมแม่ที่ยังมองเห็น การเปิดที่ตั้งเวลาไว้แต่หมดอายุจะไม่แย่งโฟกัสหลังปิด
- ข้อความข้อมูลและยืนยันอธิบายกล่องโต้ตอบของตน การแจ้งเตือนชั่วคราวใช้บริเวณสถานะที่ประกาศอย่างไม่ขัดจังหวะ
- ป้ายชื่อที่เพิ่มทั้งหมดมาจากแค็ตตาล็อกคำแปลเดิม XMLTV และ ID เป็นตัวระบุโปรโตคอล ส่วนชื่อช่องและชื่อโฮสต์ของฟีดยังคงเป็นเมทาดาทาจากแหล่ง

แอปยังคงเส้นทางควบคุมด้วยรีโมตและไวยากรณ์ ES5 การตรวจ DOM เชิงความหมายไม่ใช่การรับรอง WCAG แบบครบถ้วน โฟกัสเฉพาะอุปกรณ์ เสียง VoiceOver/TalkBack และพฤติกรรมเบราว์เซอร์ทีวียังต้องทดสอบด้วยอุปกรณ์จริง

<a id="verification"></a>

## การตรวจสอบ

เรียกใช้:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

เรียกการตรวจบิลด์ ES5 และขนาดบันเดิลตามปกติบนสาขาที่รวมงานแล้วด้วย การตรวจในเบราว์เซอร์ควรครอบคลุมรายการยาวข้ามหน้า การยืนยันแบบซ้อน การเปลี่ยนแหล่งขณะแก้ไข การผูกที่ถูกต้อง สูญหาย และถูกลบ และการดาวน์โหลด EPG ที่ล้มเหลว ค่ากำหนดแทร็กเชิงความหมายของแอป Android เนทีฟพัฒนาในที่เก็บแยกต่างหาก และเป็นอิสระจากตัวควบคุมคลาสสิกเหล่านี้

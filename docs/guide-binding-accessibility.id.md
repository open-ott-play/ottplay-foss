<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Pengikatan XMLTV manual dan aksesibilitas keyboard

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Arsitektur panduan](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Memperbaiki panduan kanal tanpa mengedit daftar putar

Putar kanal M3U yang bermasalah, buka **Information → EPG**, lalu edit URL sumber EPG dan **XMLTV ID**. Masukkan ID persis dari `<channel id="…">` pada berkas XMLTV, bukan nama tampilannya. Pilih **Set** untuk menyimpan pengikatan dan memuat ulang daftar putar. **Automatic** menghapus penggantian khusus kanal ini dan memuat ulang pemetaan asli daftar putar. Bergerak dengan tombol panah saja tidak pernah menyimpan atau mereset pengikatan. Kembali membiarkan pengikatan tersimpan tetap sama.

Editor ini tersedia pada penerapan browser yang di-host dan pembungkus XMLTV native (Tauri dan Capacitor). Editor tidak menggantikan panduan milik penyedia, endpoint JSON eksplisit `=source`, atau server pendamping eksternal. Browser lama biasa yang memakai pendamping jarak jauh mempertahankan protokol pencocokannya. Versi pertama menerima ID persis; tidak mengunduh atau menampilkan daftar seluruh kanal XMLTV yang dapat dicari.

![Pengikatan manual menghubungkan sumber daftar putar dan kanal stabil dengan satu feed XMLTV dan ID persis; selain itu pencocokan normal tetap aktif.](images/guide-binding.svg)

Pengikatan menyimpan sidik jari sumber daftar putar, kunci kanal stabil, URL feed eksplisit, dan ID XMLTV. Mengganti label tampilan atau urutan baris tidak mengubah pengikatan selama identitas kanal sama. Mengganti URL/akun daftar putar mengubah ruang nama sumber. Untuk entri M3U lama tanpa `itemId`, digunakan ID kanal turunan URL yang sudah ada; mengubah URL itu mengubah identitasnya.

Kanal terpilih mempertahankan nama tampilan dan URL pemutaran. Pencarian panduan memakai satu feed eksplisit tanpa fallback nama, sehingga ID yang tidak ada tidak diam-diam meminjam program kanal lain. Pergeseran waktu regional otomatis dari nama kanal tidak berlaku pada pengikatan persis ini; `tvg-shift` eksplisit pada daftar putar tetap berlaku. Tetapkan ID XMLTV regional yang benar. Jika feed HTTPS khusus tidak dapat dibaca karena CORS atau aturan konten campuran, diagnostik EPG biasa melaporkan kegagalan itu.

Catatan lokal dibatasi hingga 500 pengikatan dan 512 KiB per sumber; diparsing sekali setiap pemuatan daftar putar, bukan sekali per kanal. Penulisan membandingkan nilai sebelumnya dan membaca kembali hasil tersimpan sebelum memuat ulang. Callback editor yang terlambat tidak dapat menyimpan ke sumber pengganti. Ini preferensi lokal, bukan sinkronisasi lintas perangkat. URL feed dapat mengandung kredensial; hindari membagikan ekspor penyimpanan secara publik.

<a id="accessible-classic-controls"></a>

## Kontrol klasik yang dapat diakses

- Daftar utama tervirtualisasi menyediakan listbox bernama, opsi terpilih, jumlah total item, dan posisi item absolut. Hanya baris terlihat yang terpilih menjadi perhentian Tab. Navigasi panah memperbarui pilihan visual dan status semantik; fokus mengikuti daftar yang sudah memiliki fokus saat halaman diganti.
- Dialog informasi/konfirmasi standar, editor, dan panel About menyediakan peran modal dan nama terlokalisasi. Tab dan Shift+Tab berputar di dalam modal terdepan. Menutup modal bersarang memulihkan kontrol induk yang masih terlihat; pembukaan terjadwal yang sudah usang tidak dapat mencuri fokus setelah ditutup.
- Pesan informasi dan konfirmasi mendeskripsikan dialognya. Pemberitahuan sementara memakai wilayah status dengan pengumuman yang tidak mengganggu.
- Katalog terjemahan yang sudah ada menyediakan semua label tambahan. XMLTV dan ID adalah pengenal protokol; nama kanal dan nama host feed tetap merupakan metadata sumber.

Aplikasi mempertahankan jalur remote control dan sintaks ES5. Pemeriksaan DOM semantik bukan sertifikasi WCAG lengkap: fokus khusus perangkat, ucapan VoiceOver/TalkBack, dan perilaku browser TV tetap memerlukan pengujian fisik.

<a id="verification"></a>

## Verifikasi

Jalankan:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Jalankan juga pemeriksaan build/ES5/ukuran bundle biasa pada cabang terintegrasi. Pemeriksaan browser perlu mencakup daftar panjang lintas batas halaman, konfirmasi bersarang, penggantian sumber saat mengedit, pengikatan benar, tidak ada dan dihapus, serta kegagalan unduhan EPG. Preferensi trek semantik aplikasi Android native diimplementasikan dalam repositorinya sendiri dan tidak bergantung pada kontrol klasik ini.

# Dari daftar fitur menuju perilaku yang terverifikasi

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Kontrak fitur](roadmap-delivery.id.md) · [Bukti ukuran](roadmap-size.id.md)

Laporan ini mencatat implementasi dan penguatan, bukan pengumuman rilis. Snapshot pemutar yang diukur adalah `652726f8`; snapshot Android native yang dibangun terpisah adalah `be0d800`. CI, penggabungan, dan promosi rilis tetap menjadi gerbang terpisah. Commit berikutnya yang hanya mengubah dokumentasi atau pengujian tidak mengubah pemeriksaan lokal menjadi bukti bahwa perangkat terpasang sudah diperbarui. Status gerbang di bawah milik snapshot historis tersebut, bukan pelacak rilis langsung. Lihat [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases) untuk build yang diterbitkan.

![Proses implementasi dan gerbang penerimaan](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Cara pekerjaan diperiksa

Permintaan awal dibagi menjadi 13 bagian fitur yang dapat digunakan di pemutar klasik, layanan kontrol/CLI, dan aplikasi Android native mandiri. Kepemilikan ditetapkan per komponen agar perubahan bersamaan dapat ditinjau dan diintegrasikan tanpa mengganti pekerjaan komponen lain. UI baru memakai kembali label terjemahan yang ada atau menambahkan entri katalog untuk seluruh 88 bahasa; panduan teknis lengkap awalnya ditulis dalam bahasa Inggris dan Rusia. Manual utama dan panduan fitur berpasangan kini memiliki edisi lengkap dalam [24 bahasa dokumentasi](manual-translations.md).

Implementasi diikuti tinjauan silang independen dan uji regresi yang dapat dijalankan. Masalah yang dilaporkan diperiksa terhadap jalur callback, dekoder, penyimpanan, atau fokus yang sebenarnya sebelum kode diubah. Kegagalan pengujian dipisahkan menjadi regresi perilaku dan selector usang. Misalnya, mengubah baris klasik dari `button` menjadi `option` memerlukan pembaruan selector, bukan alasan melonggarkan perilaku klik yang diharapkan.

Build produksi bersih kemudian memeriksa artefak ES5 yang dihasilkan dan biaya JavaScript lengkap, termasuk modul penyedia opsional. Uji browser terarah memakai loader, bundle, dan adaptor perangkat yang dikirim. Android native menjalani pengujian Gradle, lint, dan pengemasan terpisah. Pemeriksaan PR dan utas tinjauan diperiksa kembali setelah push; build lokal yang lulus bukan penggantinya.

<a id="what-changed-during-review"></a>

## Perubahan selama tinjauan

![Lima perilaku yang diperbaiki dan biaya JavaScript terukur](diagrams/implementation-results.svg)

- **Penguraian HLS dan percobaan ulang:** kegagalan penguraian semula memakai klasifikasi jaringan umum. Kini hanya boleh satu kali menyambung ulang ke URL yang sama dalam anggaran dua percobaan ulang sementara; dekoder baru dan URL cadangan tidak meresetnya. Kegagalan autentikasi/DRM terminal juga membatalkan percobaan sementara yang sudah dijadwalkan.
- **Fallback native Auto:** penanganan kesalahan native dapat menghentikan permintaan saat Auto sudah memiliki fallback. Pemilik yang ada kini mempertahankan transisi tersebut; pembatalan tetap membatalkan keabsahan callback tertundanya.
- **Enter pada modal:** fokus otomatis pada tombol Batal pertama mengubah Enter dalam dialog tunggu Plex menjadi pembatalan. Dialog kini dimulai dengan fokus pada dialog itu sendiri. Tab secara eksplisit mencapai tombol; dialog informasi dan konfirmasi biasa mempertahankan perilaku Enter dan Escape/Kembali.
- **Pemilihan penunjuk PC:** fokus mouse mengubah pilihan sebelum handler klik sehingga klik pertama mengaktifkan. Fokus akibat penunjuk tidak lagi memilih baris terlebih dahulu. PC tetap memilih lalu mengaktifkan; LG mempertahankan perilaku satu klik. Fokus keyboard tetap mengikuti pilihan.
- **Trek Android:** pilihan item aktif tanpa label dapat terhapus oleh konfirmasi Auto sendiri atau pembaruan preferensi subtitel, atau bocor ke item lain dengan `TrackGroup` yang sama. Kini pilihan itu bertahan terhadap penulisan tertunda hanya untuk item aktifnya. Preferensi semantik menggunakan bahasa/peran/label; ViewModel memiliki persistensi sehingga menutup panel tidak membatalkan penulisan.

Ke-13 bagian yang dikirim ialah: sampel A/V; pengaturan Local/Home yang dapat dilanjutkan; pemulihan terbatas; batas kualitas; preferensi trek Android; kunci kontrol dengan lingkup; ikatan XMLTV; film/serial Xtream; aksesibilitas klasik; hasil perintah tahan lama; serah-terima eksplisit; stream cadangan; batch pengaturan yang dapat dipulihkan. [Panduan fitur](roadmap-delivery.id.md) menetapkan lingkup dan batas masing-masing.

<a id="evidence-and-remaining-gates"></a>

## Bukti dan gerbang yang tersisa

Untuk `652726f8`, lima skenario browser terarah lulus: navigasi penunjuk LG webOS, navigasi penunjuk LG NetCast, perilaku dua klik PC, semantik keyboard dialog, dan koleksi/resolusi/batal/coba lagi Plex. TypeScript, fixture unit aksesibilitas, lint terbatas, ES5, serta pemeriksaan anggaran bundle lulus. Seluruh pengujian browser pada build ini selesai dengan **194 lulus dan satu dilewati**: HLS native membutuhkan WebKit, sedangkan pengujian ini memakai Chromium. CI yang dihosting dan urutan penggabungan yang disepakati tetap gerbang terpisah.

Rangkaian `test:port` dan `test:unified` yang tersisa diselesaikan dalam segmen lanjutan setelah fixture tertentu diperbaiki. Setiap target yang gagal dijalankan ulang dengan sukses dan perintah sisanya berhasil; ini bukan klaim satu pelaksanaan `npm test` tanpa jeda. Langkah CI jembatan Android yang persis terdiri atas sembilan perintah juga lulus lokal.

Untuk Android `be0d800`, **101 tes aplikasi dan 62 tes inti bersama** lulus lokal, begitu pula lint debug/release, perakitan APK Debug/Release/Full, bundle rilis, dan kompilasi APK androidTest. Kompilasi APK pengujian berinstrumen bukan eksekusi pada perangkat. Tiga temuan tinjauan yang terkonfirmasi dijawab dan diselesaikan dalam [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68). PR tersebut lulus pemeriksaan dan digabung sebagai `5b644b94`; CI pascapenggabungan dilacak terpisah. Diagram membiarkan gerbang keseluruhan CI/rilis pemutar masih menunggu.

Jumlah JavaScript web lengkap berubah dari **964,459 / 305,344** byte mentah/gzip menjadi **995,858 / 315,207**: **+31,399 / +9,863 byte** (sekitar 3.26% / 3.23%). Kandidat fitur sebesar 995,587 / 315,103; penguatan berikutnya menambah 271 / 104. Entri utama akhir pada snapshot itu adalah 875,197 / 270,425. Lihat [pengukuran dasar](evidence/roadmap-size-20261015.json), [pengukuran artefak akhir](evidence/roadmap-final-size-20261015.json), dan [metode pengukuran](roadmap-size.id.md). Koma pada jumlah byte ini memisahkan ribuan.

Ini biaya byte JavaScript historis, **bukan peningkatan kecepatan yang terukur**. Jumlah tersebut mengecualikan mesin media, kamus, CSS, gambar, dan video. Paket pemutar snapshot itu membawa klip A/V 464,652 byte secara terpisah. Setelah [perubahan hosting](audio-video-check.id.md), `diagnostics/av-v1.mp4` tetap di repositori bersama generator dan pemeriksanya demi reproduktibilitas, tetapi dikecualikan dari paket Web/OTTPlay Server, Tauri, Capacitor, dan Docker. Pemutar mengambilnya dari here.now hanya untuk pemeriksaan A/V eksplisit yang membutuhkan internet; pemutaran awal tidak mengambilnya. Menghapus 464,652 byte media mentah tidak menetapkan penghematan pada pemasang terkompresi atau mengubah pengukuran JavaScript historis. Waktu mulai, keteraturan bingkai, memori, pengalaman pembaca layar, audio HDMI nyata, dan perilaku penyedia memerlukan pengukuran tersendiri pada perangkat target. Laporan ini tidak mengklaim hasil perangkat fisik baru atau rilis beta. [Daftar penerimaan fisik](roadmap-delivery.id.md#physical-acceptance-before-promotion) dan [strategi rilis](../RELEASING.md) tetap kriteria promosi.

<a id="post-beta-integration-and-review"></a>

## Integrasi dan tinjauan setelah beta

Setelah beta.4 diterbitkan, sumber `39287792` diintegrasikan ke cabang ini. Revisi runtime `9663b681` juga memperbaiki pemulihan ke ujung siaran langsung di bawah batas kualitas HLS dan memungkinkan jurnal pengaturan rusak dipulihkan sebelum startup normal. Layar pemulihan memblokir hidrasi akun parsial, mendukung coba lagi dan reset terkonfirmasi, mempertahankan cookie tak terkait, serta mencegah pengaturan cookie lama kembali setelah reset. Lihat [proses pemulihan](settings-recovery.id.md) dan diagram SVG-nya.

![Perbandingan JavaScript lengkap setelah beta](diagrams/post-beta-size.svg)

Mereproduksi kedua sumber dengan Node 26.8.2, Rollup 4.64.5, dan Terser 5.51.2 menghasilkan **964,876 / 305,452** byte mentah/gzip untuk sumber beta.4 dan **1,000,388 / 316,600** untuk integrasi: **+35,512 / +11,148 byte** (3.68% / 3.65%). Jumlah ini mencakup semua penyedia opsional: tujuh pada dasar dan delapan pada integrasi. Entri baru berukuran 879,533 / 271,761. Ini perbandingan terpisah dari grafik lama yang dibekukan di atas.

Kedua build produksi lokal membuat ulang lima berkas runtime terlacak dan menghilangkan klaim revisi sumber bersih. Laporan mencatat batasan ini, bukan menyatakan berkas lokal sebagai artefak rilis yang diterbitkan: [dasar](evidence/post-beta-baseline-size-20261015.json) dan [integrasi](evidence/post-beta-candidate-size-20261015.json). Build integrasi dan pemeriksaan ES5/native lulus. Enam pemeriksaan browser terarah juga lulus: pemulihan/reset jurnal, keyboard dialog, penunjuk LG webOS dan NetCast, pemilihan dua klik PC, dan penantian Plex dengan pemilik.

<a id="browser-gate-integration"></a>

## Integrasi gerbang browser

![Hasil verifikasi browser lokal yang terkonfirmasi](diagrams/browser-verification-results.svg)

Sumber `c52f4d07` memasukkan PR 779 dari main `1ecbc0e7`. Perintah pengujian, pemeriksaan pemulihan, dan asersi dialog Plex kedua cabang dipertahankan. TypeScript, lint, dokumentasi, kontrak pengemasan/linker, build produksi, dan seluruh pemeriksaan bundle terkompilasi lulus. Semua 27 berkas JavaScript pemutar/penyedia yang dihasilkan tetap identik byte demi byte dengan artefak terukur di atas. Suite perangkat-browser lengkap pada build itu selesai dengan **196 lulus dan satu kasus Chromium dilewati sesuai harapan** untuk HLS native yang membutuhkan WebKit.

Arsip Mode A terkemas yang tepat diekstrak hanya setelah sumber, checksum, dan inventaris bundle/penyedianya diperiksa. Chromium 156.0.8078.4, Firefox 157.0, dan WebKit 27.2 masing-masing lulus seluruh lima skenario profil tanpa melewati atau mengulang: **15 kelulusan lokal** dengan Playwright 1.64.0. Host sebenarnya macOS 26.7.1, bukan runner `macos-15` dalam profil terpilih. Catatan bukti secara eksplisit menyebut perbedaan itu dan **bukan kualifikasi matriks yang dihosting atau rilis**. Lihat [ringkasan lokal](evidence/post779-local-acceptance/summary.json) dan [resep reproduksi](evidence/post779-local-acceptance/reproduce.sh), yang mengharapkan build produksi tersedia dan menolak mengganti direktori kandidat yang sudah diekstrak.

[Kebijakan browser](browser-compatibility.id.md) mensyaratkan lima target yang dihosting dan 25 pelaksanaan skenario untuk pemeriksaan PR/beta; RC lengkap memiliki 35 target dan 166 pelaksanaan. Ini persyaratan konfigurasi, bukan cakupan terukur.

![Cara verifikasi kandidat menghasilkan bukti](diagrams/candidate-verification-flow.svg)

[Pipeline beta](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) terpisah untuk main `1ecbc0e7` selesai dengan sukses. Pipeline itu tidak mencakup PR ini. Integrasi masih memerlukan CI yang dihosting dan tinjauan sendiri yang berhasil, dilanjutkan koordinasi rilis; hasil lokal di atas tidak mengklaim gerbang pengiriman tersebut sudah lulus.

<a id="delivery"></a>

## Pengiriman

- [Pemutar, dokumentasi, dan i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Server kontrol dan CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Preferensi trek Android — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

PR tersebut membawa status CI dan penggabungan saat ini. Perubahan pemutar mengikuti perbaikan Plex saat ini yang disepakati beserta beta-nya sebagai gelombang pengiriman terpisah.

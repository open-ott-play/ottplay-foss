<a id="measured-javascript-cost"></a>

# Biaya JavaScript yang diukur

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Panduan fitur](roadmap-delivery.id.md) · [Bukti mentah](evidence/roadmap-size-20261015.json)

![Perbandingan seluruh JavaScript pemutar dengan toolchain yang sama](diagrams/roadmap-size.svg)

Halaman ini menyimpan pengukuran JavaScript dari snapshot sumber di bawah. Pengukuran tersebut tidak mengukur revisi saat ini, paket instalasi, atau lalu lintas jaringan.

Dalam perbandingan awal, entri utama beserta seluruh keluarga penyedia opsional bertambah **31 128 byte mentah / 9 759 byte gzip**, sekitar **3.23% / 3.20%**. Ini kenaikan biaya fitur, bukan klaim pengurangan ukuran atau peningkatan kecepatan eksekusi. Xtream tetap dimuat sesuai kebutuhan; memindahkannya dari entri tidak menghapusnya dari total.

Pengukuran membandingkan arsip sumber bersih `bbf9ca7b` dan `cae971da`, keduanya versi 1.1.55, dengan Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2, dan zlib 1.2.12. Pengukuran memakai perakit ES5 produksi, pengoptimal, kebijakan nama, dan identitas sumber bersih yang benar. Gzip level 9 diterapkan secara terpisah pada setiap aset keluaran.

- Entri web: 848 092 / 262 392 → 874 926 / 270 321 byte mentah/gzip.
- Entri web + semua penyedia: 964 459 / 305 344 → 995 587 / 315 103.
- Entri native: 848 050 / 262 460 → 874 884 / 270 372.
- Entri native + semua penyedia: 964 417 / 305 412 → 995 545 / 315 154.
- M3U opsional bertambah 184 byte mentah / 82 gzip; Xtream baru berukuran 4 110 / 1 748. Enam keluarga opsional lainnya identik byte demi byte.

Sebelum klip dipindahkan ke here.now, mengubah URL-nya menjadi jalur lokal dari root menambah satu byte JavaScript mentah dalam urutan historis ini. Itu bukan pengukuran URL yang dihosting kemudian. Perbaikan percobaan ulang parsing HLS yang dibatasi menambah 37 byte mentah / 36 gzip dalam perbandingan terisolasi pada snapshot yang sama ([bukti](evidence/parse-recovery-size-20261015.json)). Perbaikan kepemilikan handoff Auto native menambah lagi 101 byte mentah / 39 gzip ([bukti](evidence/auto-recovery-size-20261015.json)). Total mentah sebelum perbaikan regresi aksesibilitas menjadi 995 726 byte; identitas build dan byte gzip dapat berubah pada commit akhir. Hasil akhir `build/reports/classic-bundle.json` dan `npm run check:size` tetap menjadi acuan bagi revisi tepat yang dikirim. Build bersih berikutnya `652726f8`, termasuk perbaikan fokus pointer/dialog, mengukur **995 858 byte mentah / 315 207 gzip** untuk pemutar web lengkap ([bukti artefak akhir](evidence/roadmap-final-size-20261015.json)). Entrinya 875 197 / 270 425; total native 995 816 / 315 259. Batas snapshot tersebut mempertahankan kelonggaran native/Node/akhiran rilis sebelumnya: 875 300 mentah / 271 600 gzip untuk entri; 996 100 / 316 400 untuk entri + penyedia.

<a id="post-beta-integration"></a>

## Integrasi setelah beta

![JavaScript lengkap setelah integrasi beta.4](diagrams/post-beta-size.svg)

Perbandingan berikutnya mereproduksi sumber beta.4 `39287792` terhadap runtime `9663b681`, termasuk integrasi Plex dan pemulihan pengaturan rusak, dengan Node 26.8.2, Rollup 4.64.5, dan Terser 5.51.2 yang sama:

- Entri web: 848 315 / 262 443 → 879 533 / 271 761 byte mentah/gzip.
- Entri web + semua penyedia: 964 876 / 305 452 → 1 000 388 / 316 600.
- Entri native + semua penyedia: 964 834 / 305 520 → 1 000 346 / 316 654.
- Pertambahan muatan web lengkap: **35 512 / 11 148 byte (3.68% / 3.65%)**.

Baseline menghitung tujuh keluarga penyedia; integrasi menghitung delapan, termasuk Xtream yang dimuat sesuai kebutuhan. Batas entri snapshot tersebut 879 900 / 273 000; batas total 1 000 800 / 317 800, dengan ruang untuk native, Node, dan identitas rilis. Kedua build produksi lokal menghasilkan ulang lima berkas runtime terlacak dan menghilangkan klaim revisi sumber bersih. Ini artefak yang direproduksi secara lokal, bukan biner beta yang diterbitkan. Versi alat, hash, dan batasan itu dicatat dalam [bukti baseline](evidence/post-beta-baseline-size-20261015.json) dan [bukti integrasi](evidence/post-beta-candidate-size-20261015.json). [Laporan implementasi](implementation-report.id.md#post-beta-integration-and-review) menjelaskan perbaikan serta validasi.

**Cakupan:** total JavaScript ini tidak memasukkan mesin media eksternal, kamus bahasa, CSS, gambar, dan video. Paket pemutar historis juga membawa **klip A/V sebesar 464 652 byte**, di luar total di atas. Distribusinya saat ini terpisah dari pengukuran tersebut:

- **Repositori:** `diagnostics/av-v1.mp4` tetap disimpan bersama generator dan pemeriksanya demi reproduksibilitas. Menyimpan berkas sumber tidak memasukkannya ke paket.
- **Paket:** Web/OTTPlay Server, Tauri, Capacitor, dan Docker mengecualikan klip. Ini menghapus 464 652 byte aset media mentah, bukan pengurangan terukur sebesar 464 652 byte dalam pemasang terkompresi. Format arsip dan perubahan build lainnya memengaruhi ukuran itu.
- **Jaringan:** pemutar mengambil klip dari here.now hanya saat pengguna memulai [pemeriksaan A/V](audio-video-check.id.md). Pemeriksaan membutuhkan internet; klip tidak diambil untuk pemutaran saat startup.

Pengukuran JavaScript historis di atas tetap sama. Mengukur pengaruh URL yang dihosting terhadap JavaScript atau pemasang saat ini memerlukan perbandingan baru. Sebanyak 88 README terlokalisasi adalah dokumentasi repositori, bukan muatan pemutar. Perbandingan byte ini tidak mendasari klaim waktu startup, frame rate, memori, atau kinerja berskala katalog. Itu memerlukan pengukuran terpisah pada perangkat sasaran.

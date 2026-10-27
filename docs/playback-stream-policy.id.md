# Batas kualitas dan pemulihan aliran langsung

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Kepemilikan dekoder](device-media-backend.md)

Pemutar HTML5/HLS/Shaka yang dikelola mempertahankan satu hak pemutaran saat pulih dari sumber yang gagal. Pemutar juga dapat memakai hingga tiga URL cadangan yang dikonfigurasi secara eksplisit untuk saluran langsung. Pemutar tidak pernah menemukan, menebak, atau mengganti saluran berdasarkan judulnya.

![Pemulihan: satu hak, percobaan terbatas, dan cadangan eksplisit](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Menetapkan batas atas kualitas

Buka **Pengaturan → Pengaturan antarmuka** dan atur **Tinggi video maksimum (HLS/Shaka)** dan/atau **Bitrate aliran maksimum (HLS/Shaka)**. Kedua batas berlaku bersama. **Otomatis** menghapus batas tersebut. Pilihan yang didukung adalah 360/480/720/1080/2160 piksel dan 1/2/4/8/16 Mbps. Pengaturan disimpan lokal, mengikuti alur simpan/batal biasa, dan berlaku pada awal pemutaran berikutnya, termasuk mulai ulang pemulihan.

Ini batas atas, bukan pengaturan transcoding. Aliran yang hanya 1080p tidak dapat menjadi 720p. Jika tidak ada varian yang diumumkan memenuhi syarat, pemutar menampilkan **No stream meets the quality limits** dan berhenti mencoba ulang permintaan itu. Tinggi/bitrate yang tidak diketahui tidak membuktikan bahwa varian HLS memenuhi batas.

Penyaringan varian HLS terjadi sebelum pemuatan fragmen. hls.js saat ini membuang varian tidak layak; build lama tanpa `removeLevel` hanya dapat mempertahankan awalan berurutan yang aman dan dapat menolak manifest dengan varian layak di bagian akhir. Shaka memakai batas aplikasi `maxHeight`/`maxBandwidth`. Adaptasi otomatis berlanjut di antara varian yang tersisa.

Pengaturan berlaku pada mesin HLS dan Shaka yang dikelola. HTML5 biasa, dekoder platform native, dan mesin TV/STB yang dipertahankan tidak mengekspos kontrol yang sama. Auto dapat memilih pemutaran native; pengaturan tidak memaksanya ke MSE. Pemutar tidak akan memindahkan permintaan HLS yang sudah dibatasi ke pemutaran native tanpa batas hanya demi menghindari kesalahan decoding. Tidak tersirat transcoder native, benchmark perangkat keras otomatis, atau klaim keluaran fisik 720p.

<a id="configure-explicit-backups"></a>

## Mengonfigurasi cadangan eksplisit

1. Mulai saluran langsung yang dimaksud.
2. Buka **Informasi → Aliran cadangan**.
3. Pilih slot 1, 2, atau 3 dan masukkan URL media HTTP/HTTPS lengkap.
4. Buka lagi slot terisi untuk **Edit** atau **Hapus**. Mulai saluran lagi untuk memakai daftar yang diperbarui.

Setiap slot milik namespace penyimpanan penyedia saat ini dan pasangan tepat `sourceId`/`channelId`. Generasi pemutaran dan konfigurasi sumber saat ini membatasi editor. Mengganti sumber ketika dialog terbuka mencegah dialog itu menyimpan ke sumber pengganti. Perubahan bersamaan pada slot yang sama ditolak, bukan ditimpa.

URL pertama tetap sumber biasa saluran. Slot duplikat dan kosong dilewati. Maksimum 256 rekaman saluran dan konfigurasi 256 KiB diterima. URL dengan kredensial user-info, spasi putih, karakter kontrol, garis miring terbalik, atau port tidak valid ditolak. Token kueri dari penyedia masih bisa menjadi bagian URL media: pengaturan cadangan adalah konfigurasi sumber lokal, bukan mekanisme berbagi kredensial atau menjadikannya publik.

Cadangan **hanya untuk siaran langsung**. Permintaan arsip dan VOD tidak pernah memakai alternatif langsung: rekaman, titik awal waktu, hak, dan semantik pencarian posisi dapat berbeda. Pemilik harus menyediakan endpoint langsung yang setara dan diotorisasi. Judul saluran sama bukan bukti kesetaraan. Identitas saluran tersimpan, favorit, dan pengikatan EPG tidak berubah ketika endpoint transportasinya berubah.

<a id="recovery-guarantees"></a>

## Jaminan pemulihan

- Permintaan memiliki paling banyak **dua percobaan ulang transien tertunda ke URL yang sama secara total**, dan paling banyak satu langkah maju ke masing-masing dari tiga slot cadangan: maksimum lima pembuatan ulang setelah awal pertama. Instansi dekoder baru atau manifest berhasil tidak mereset anggaran. Pemulihan jaringan dan decoding HLS berbatas yang sudah ada di dalam mesin berjalan sebelum kebijakan luar ini.
- Kegagalan parsing manifest/level HLS mengizinkan paling banyak satu koneksi ulang ke URL yang sama per permintaan, dihitung dalam total dua percobaan tersebut. Dekoder atau endpoint cadangan baru tidak mereset batas.
- Kegagalan jaringan tanpa status, HTTP 408/429, dan 5xx dapat memakai anggaran transien. HTTP 4xx lain dapat maju ke alternatif terkonfigurasi tetapi tidak mengulangi URL yang sama. **HTTP 401/403 dan kesalahan masuk ke sumber mengakhiri permintaan**, tanpa mencoba kredensial alternatif atau endpoint cadangan.
- Kegagalan decoding dapat maju ke cadangan eksplisit. Batas kualitas yang mustahil mengakhiri permintaan. Tidak ada putaran kembali ke sumber utama.
- Jeda adalah 500 ms, 1 s, 1.5 s, lalu paling banyak 2 s. Callback berulang digabung.
- Pause menghapus timer terjadwal sambil mempertahankan percobaan ulang tertunda; Resume menjadwalkannya lagi. Stop, standby, penggantian sumber dan saluran membatalkan validitas callback tertunda. Permintaan yang gagal terminal memerlukan pemilihan ulang eksplisit, bukan memutar otomatis dekoder yang sudah dihentikan.
- Kegagalan pemuatan Shaka dan peristiwa kesalahan kritis berbagi jalur ini; kesalahan pembatalan diabaikan. Pemasangan ulang menunggu penghancuran Shaka yang asinkron.
- Pemulihan menyelesaikan ulang referensi Stalker yang buram dan menyiapkan lagi akses sumber terlindungi. URL loopback iOS kedaluwarsa tidak dipakai ulang. Posisi VOD/arsip diambil sebelum pembongkaran; cadangan langsung mulai pada ujung siaran langsungnya.

Pemulihan opsional berdasarkan waktu media siaran langsung dijelaskan di bawah. Pemulihan kiosk, Auto/native, dan HLS yang sudah ada tetap mempertahankan cakupan dan perilaku mesinnya masing-masing.

<a id="verification-and-observability"></a>

## Verifikasi dan observabilitas

`window.__ottStreamPolicy.snapshot()` mengekspos nama mesin, batas yang diminta, kemampuan/ketersediaan, jumlah percobaan, indeks endpoint, dan status pemulihan. Tidak memuat URL aliran atau kredensial penyedia. Indeks nol berarti sumber biasa; indeks berikutnya mengacu ke alternatif unik yang tidak kosong. Ini status diagnostik, bukan API kendali jarak jauh yang stabil.

Jalankan:

```sh
node tests/test_stream_policy.cjs
node tests/test_port_engine_lifecycle.cjs
node tests/test_settings_parity.cjs
node tests/test_media_backend.cjs
npm run test:localization
npm run typecheck
npm run build:server
node scripts/check-es5.cjs --server-only
```

Tes menguji penyaringan kualitas dengan urutan varian tidak monoton, metadata tidak tersedia, pengeditan bercakupan sumber, konflik slot, kesalahan duplikat, anggaran berbatas, kegagalan otorisasi HTTP, pembatalan pause/stop/sumber, pembongkaran Shaka, dan pemeliharaan posisi VOD. Lima label pemutaran baru diterjemahkan dalam seluruh 88 paket bahasa yang disertakan; kesetaraan otomatis bukan tinjauan penutur asli. Pemutaran fisik TV/D1 dan manifest khusus penyedia masih memerlukan validasi perangkat. [Sumber diagram yang dapat diedit](diagrams/stream-recovery.mmd).

<a id="live-stall-recovery"></a>

## Pemulihan siaran langsung yang macet

Di **Pengaturan → Pengaturan antarmuka**, pilih **Percobaan pemulihan siaran langsung** (0–5) dan **Batas waktu macet siaran langsung, dtk** (10/15/20/30). Nilai bawaan adalah 0 percobaan dan 15 detik. Nol hanya menonaktifkan pemantau ini; pemulihan kesalahan mesin yang sudah ada tidak berubah. Pengaturan menggunakan alur Simpan/Batal seperti biasa.

Setelah kemajuan pemutaran terverifikasi, berhentinya waktu media siaran langsung utama memanggil `backend.restart()` yang sudah ada. Jeda, pencarian posisi, halaman tersembunyi, keadaan luring, dan kiosk menangguhkan pengamatan; arsip, VOD, dan jalur PiP dikecualikan. PiP native menyembunyikan OSD HTML. Perubahan saluran, sumber, atau generasi membatalkan pengamatan lama. Pemutaran awal yang tidak pernah maju tetap ditangani oleh mekanisme awal pemutaran dan kesalahan yang sudah ada. Penggantian dekoder dan kemajuan singkat tidak memperbarui jatah percobaan: sepuluh detik kemajuan terus-menerus yang memperbaruinya. Setelah batas habis, pemantau tidak melakukan mulai ulang tambahan untuk kemacetan tersebut. Pemulihan mesin yang tertunda mendapat prioritas; kesalahan final otorisasi, DRM, atau kualitas tidak dapat dilewati. Yang diamati adalah waktu media, bukan penayangan gambar secara fisik atau bingkai beku saat waktu media terus berjalan.

Untuk pengujian dasar tanpa langganan, pilih **Coba demo**. Setelah pemutaran dimulai, atur sementara `document.getElementById("video").playbackRate = 0` di DevTools tab pengujian; lalu kembalikan ke 1. Jeda sengaja dikecualikan dari pemulihan kemacetan.

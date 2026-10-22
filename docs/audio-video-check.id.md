# Pemeriksaan audio/video manual

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Pemulihan aliran](playback-stream-policy.id.md) · [Spesifikasi sampel](../diagnostics/README.md)

Gunakan **menu pemutar → Informasi → Audio → Putar** untuk memeriksa gambar dan suara dengan klip delapan detik yang diketahui. Inilah pemeriksaan A/V bersuara; demo pola bergerak saat pengenalan tidak bersuara.

![Pemeriksaan A/V: sumber repositori, klip yang dihosting, dan pemutaran eksplisit](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## Memulai pemeriksaan

1. Atur televisi, speaker, atau headphone ke volume yang nyaman. Pemeriksaan memakai volume pemutar saat ini dan sementara membuka bisu videonya; volume sistem televisi tidak dinaikkan.
2. Buka menu pemutar, pilih **Informasi**, lalu **Audio**, lalu **Putar**. Membuka menu saja tidak mengunduh atau memutar klip.
3. Perhatikan layar dan dengarkan urutan di bawah. Untuk mengakhiri lebih awal, gunakan **Informasi → Audio → Hentikan**.

Pemeriksaan menggunakan jalur pemutaran inti HTML5 yang dikelola ketika pemutar idle, atau ketika TV langsung diputar atau dijeda. Permintaan VOD/arsip aktif, permintaan langsung yang masih memuat, dan standby ditolak. Pemeriksaan juga tidak tersedia ketika adaptor perangkat mengganti mesin inti, termasuk **PC2/Video.js** dan penggantian mesin native; memakai elemen video HTML5 saja tidak membuat adaptor memenuhi syarat. Penolakan tidak mengganti pemutaran yang ada. Hentikan permintaan saat ini dahulu jika ingin menguji dari idle; ini tidak mengaktifkan pemeriksaan pada adaptor tersebut. Label menu mengikuti bahasa antarmuka yang dipilih.

<a id="what-you-should-see-and-hear"></a>

## Yang seharusnya terlihat dan terdengar

Latar belakang berupa pola uji bergerak. Penanda putih singkat berkedip di separuh kiri atau kanan atas, seirama dengan pulsa suara pelan sekitar 150 ms:

- **0–2 detik:** pulsa 440 Hz di saluran kiri setiap detik, dengan penanda kiri berkedip.
- **2–4 detik:** pulsa 880 Hz di saluran kanan, dengan penanda kanan.
- **4–6 detik:** kedua saluran berpulsa, dengan kedua penanda.
- **6–8 detik:** pola terus bergerak tanpa suara. Keheningan ini disengaja.

Televisi mono atau downmix dapat mereproduksi kedua saluran melalui satu speaker. Periksa sendiri layar fisik dan keluaran audio. Pemutar tidak mengukur keluaran speaker atau menghasilkan putusan A/V lulus/gagal otomatis.

<a id="where-the-clip-comes-from"></a>

## Asal klip

Pemutar memakai alamat HTTPS absolut ini:

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Klip diminta hanya saat memilih **Putar**, tidak pernah sebagai pramuat saat mulai. Berkas berukuran **464 652 byte**, dengan video H.264 baseline 640×360 / 25 fps dan audio stereo AAC. Berkas tidak disertakan dalam paket Web, OTTPlay Server, Tauri, Capacitor, atau kontainer. [Berkas sumber](../diagnostics/av-v1.mp4), generator, dan verifikator tetap berada di repositori; semuanya bukan cadangan offline di pemutar yang terpasang.

Diperlukan akses internet dan koneksi HTTPS yang berfungsi ke host itu. Tidak ada cadangan bawaan atau URL diagnostik alternatif. Membuka tautan di atas pada browser dapat memeriksa ketersediaan berkas, tetapi tidak menguji kepemilikan dekoder atau perilaku kembali ke saluran milik pemutar. Layanan hosting menerima informasi koneksi biasa; lihat [rincian privasi](privacy-policy.md#optional-hosted-audio-video-check).

<a id="how-playback-returns"></a>

## Cara pemutaran kembali

Pemeriksaan memakai dekoder utama dan sementara mengganti gambar langsung. Pemeriksaan selesai di akhir klip, setelah **Audio → Hentikan**, atau ketika terjadi kesalahan media. **Batas aman 15 detik dimulai saat pemeriksaan diterima** dan juga mencakup pemuatan; unduhan lambat karena itu dapat berakhir sebelum delapan detik penuh dimainkan.

Pada jalur tersebut, pemutar mencoba memulihkan permintaan langsung yang direkam ke ujung siaran langsung, termasuk status jedanya, hanya jika permintaan masih milik sumber saat ini dan belum diambil alih pemutaran pengganti. URL langsung diselesaikan ulang; pemulihannya tetap bergantung pada penyedia dan jaringan. Pemeriksaan dari idle kembali ke idle.

Perintah pemutaran biasa **Stop**, standby, atau memilih saluran lain membatalkan pemeriksaan tanpa memulai ulang saluran yang direkam. Mengubah sumber atau sesinya juga mencegah pemulihan kedaluwarsa. Pemeriksaan mengembalikan perubahan buka-bisu sementara saat keluar; jika Anda membisukan saat berjalan, bisu itu tetap berlaku. Pemeriksaan tidak mengubah preferensi mesin tersimpan, menulis detik uji ke riwayat saluran, atau memublikasikan penyelesaian saluran palsu maupun metadata uji ke OS.

<a id="if-the-result-is-unexpected"></a>

## Jika hasilnya tidak sesuai harapan

- **Pemeriksaan tidak dapat dimulai:** pastikan pemutar idle atau berada di saluran langsung yang sudah diputar/dijeda menggunakan jalur inti HTML5 yang dikelola, tanpa penggantian mesin perangkat. Status tidak didukung atau kesalahan media dapat menampilkan **“Stream could not be played”**.
- **Tidak ada yang memuat atau pemeriksaan cepat menutup:** periksa internet dan tautan HTTPS langsung. Kesalahan jaringan atau batas waktu bukan bukti bahwa dekoder atau speaker rusak. Pulihkan koneksi sebelum memilih Putar lagi.
- **Gambar ada, suara tidak:** dua detik terakhir memang hening. Selama enam detik pertama, periksa bisu/volume pemutar, volume televisi, keluaran audio yang dipilih, dan sambungan speaker/headphone.
- **Hanya satu speaker fisik berbunyi:** periksa dahulu apakah televisi memakai keluaran mono atau downmix sebelum menganggapnya kegagalan perutean saluran.

Ini pemeriksaan singkat MP4 yang diketahui melalui jalur gambar/audio inti HTML5 yang dikelola. Pemeriksaan tidak membuktikan bahwa aliran penyedia, HLS/DASH, DRM, audio multisaluran, atau resolusi lebih tinggi akan bekerja, dan tidak mengukur kapasitas jaringan atau latensi sinkronisasi. Batas kualitas dan pengaturan aliran cadangan langsung tidak mengubah klip diagnostik ini.

Perilaku kepemilikan dan pembersihan diuji oleh [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) serta [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs). Pemeriksaan decoding dan siklus hidup otomatis tidak menggantikan melihat dan mendengar pada perangkat nyata; panduan ini tidak mengklaim hasil perangkat fisik yang baru.

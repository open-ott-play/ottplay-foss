# Peningkatan keandalan dan media

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.id.md) · [Arsitektur](architecture.md)

Panduan ini menjelaskan implementasi pada revisi sumber halaman ini, bukan kemampuan rilis lama yang terpasang. Pemutar, layanan kontrol/CLI, dan aplikasi Android native adalah artefak terpisah. Memperbarui salah satunya tidak memperbarui yang lain.

![Tanggung jawab dan batas kepercayaan](diagrams/roadmap-components.svg)

Lihat [biaya byte terukur dan grafik perbandingan](roadmap-size.id.md); kecepatan eksekusi dan pemutaran di perangkat merupakan pemeriksaan penerimaan tersendiri.

<a id="what-is-implemented"></a>

## Yang telah diimplementasikan

1. **Sampel audio/video yang diketahui.** [Informasi → Audio](audio-video-check.id.md) memutar klip delapan detik dari here.now (memerlukan internet), dengan nada kiri/kanan dan kilatan yang sesuai. Klip hanya diambil setelah **Putar**, tidak pernah saat mulai; berkas media tidak disertakan dalam paket pemutar. Klip meminjam dekoder HTML5 utama hanya saat idle atau menonton TV langsung. Riwayat tontonan tidak ditulis. [Spesifikasi sampel](../diagnostics/README.md).
2. **Penyiapan Local/Home yang dapat dilanjutkan.** CLI kontrol dapat merencanakan, menerapkan, melanjutkan, dan memverifikasi preset. Pengaturan tersimpan dibandingkan sebelum mencoba ulang penulisan dengan hasil tidak pasti. [Alur kontrol](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Pemulihan pemutaran berbatas.** Kegagalan sementara HLS/Shaka berbagi kebijakan pemulihan terbatas. Kegagalan autentikasi dan DRM yang tidak didukung bersifat terminal. Stop, pergantian saluran, dan penggantian sumber membatalkan pekerjaan kedaluwarsa.
4. **Batas kualitas tersimpan.** Tinggi maksimum dan bitrate membatasi pemilihan adaptif; fallback native tidak boleh diam-diam melewati batas aktif.
5. **Preferensi trek Android native.** Aplikasi Android mandiri mengingat maksud berdasarkan bahasa/peran/label, termasuk Auto dan takarir Off, bukan membawa indeks trek dari aliran lain.
6. **Operator perintah dengan cakupan terbatas.** Pengontrol dapat memberi kredensial izin ke perangkat/tindakan tertentu tanpa menyerahkan kredensial administrator.
7. **Pengikatan XMLTV eksplisit.** Saluran dalam cakupan daftar putar dapat diikat ke umpan dan ID XMLTV tertentu. [Pengikatan panduan dan aksesibilitas](guide-binding-accessibility.id.md).
8. **Film dan serial Xtream.** Pustaka media mengambil katalog yang dipilih sesuai kebutuhan, lalu episode suatu serial. [Kontrak pustaka](xtream-media.id.md).
9. **Kontrol klasik yang aksesibel.** Daftar saluran mengekspos semantik pemilihan; dialog modal mempertahankan dan memulihkan fokus keyboard; pemberitahuan memiliki wilayah live.
10. **Hasil perintah yang tahan lama.** Jurnal pengontrol opsional berbatas menyimpan metadata deduplikasi dan hasil. Mulai ulang tidak pernah memutar ulang perintah secara membabi buta.
11. **Pengalihan perangkat eksplisit.** Referensi langsung/arsip dipindahkan ke pemutar dengan sumber terkonfigurasi yang sama. Tujuan menyelesaikan URL-nya sendiri. [Kontrak](remote-handoff.id.md).
12. **Aliran cadangan eksplisit.** Saluran langsung dapat menggunakan alternatif terkonfigurasi dalam kebijakan pemulihan terbatas yang sama. [Batas, pemulihan, dan cadangan](playback-stream-policy.id.md).
13. **Batch pengaturan yang dapat dipulihkan.** localStorage native memakai jurnal pembatalan untuk penulisan multikunci yang didukung. [Jaminan penyimpanan](settings-recovery.id.md).

<a id="language-and-compatibility-coverage"></a>

## Cakupan bahasa dan kompatibilitas

Pemutar menyertakan 88 katalog terjemahan. Tujuh label kualitas/media baru diterjemahkan di setiap katalog; menu baru lainnya menggunakan kembali label terjemahan yang ada. Pemeriksaan katalog mencakup kesetaraan kunci, placeholder, dan pengecualian yang ditinjau. Panduan teknis berpasangan menjelaskan batas implementasi yang sama dalam [24 bahasa dokumentasi](manual-translations.md). [Halaman masuk terlokalisasi](readme/README.md) adalah panduan mulai cepat, bukan klaim bahwa setiap dokumen teknis historis memiliki 88 terjemahan lengkap.

Keluaran klasik tetap memakai sintaks ES5. Ini tidak berarti setiap perangkat mendukung semua codec, Web API, jaminan penyimpanan, atau integrasi native. Pratinjau A/V dibatasi pada jalur HTML5 utama yang dikelola; pengganti mesin perangkat seperti PC2/Video.js dan mesin native dikecualikan. Pengikatan panduan eksplisit memakai implementasi XMLTV hosted atau native; protokol companion eksternal opsional mungkin tidak mendukungnya. Penerimaan khusus perangkat tetap memerlukan perangkat nyata.

<a id="reproduce-the-checks"></a>

## Mereproduksi pemeriksaan

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

Verifikator media memerlukan FFmpeg/FFprobe. Ia mendekode kedua saluran audio dan memeriksa energi, pemisahan, serta keheningannya; adanya trek AAC saja tidak membuktikan konten terdengar. Pengujian JavaScript reguler menguji pembatalan, penulisan gagal, pemulihan setelah mulai ulang, perubahan sumber, dan masukan tidak valid. Pemeriksaan bundle akhir mencakup keluarga penyedia opsional, bukan hanya entri utama.

Di pengontrol, jalankan `go test -race ./...`, `go vet ./...`, dan `python3 -m unittest discover -s tests`. Pada Android native, jalankan uji unit preferensi trek dan cadangan pengaturan serta rakit APK debug. CI setiap repositori berlaku untuk commit terkait, bukan pohon yang diubah setelahnya.

<a id="physical-acceptance-before-promotion"></a>

## Penerimaan fisik sebelum promosi

- Pada TV tujuan, jalankan pemeriksaan A/V dan pastikan audio kiri/kanan, kilatan terlihat, Stop, serta kembali ke TV langsung. Uji dekoder tidak membuktikan suara HDMI atau kelancaran.
- Uji aliran yang diizinkan/ditolak, cadangan gagal, dan pergantian saluran ketika percobaan ulang tertunda. Pastikan batas kualitas terpilih pada backend sebenarnya.
- Uji fokus daftar/dialog dengan keyboard, remote, dan pembaca layar yang tersedia.
- Ikat dua nama saluran yang mirip ke ID XMLTV berbeda dan verifikasi data acara.
- Hentikan penerapan preset uji di tengah proses, mulai ulang pengontrol, lanjutkan, dan verifikasi. Alihkan ke sumber terkonfigurasi yang cocok maupun tidak cocok.
- Pada Android native, berganti aliran dengan urutan trek berbeda, mulai ulang aplikasi, dan pastikan perilaku Auto/Off eksplisit serta bahasa pilihan.

Pengiriman berhasil, pengaturan tersimpan, sampel terdekode, dan uji unit lulus adalah bukti berbeda. Promosi rilis harus mempertahankan perbedaan itu; lihat [strategi rilis](../RELEASING.md).

<a id="explicit-playback-handoff"></a>

# Serah terima pemutaran secara eksplisit

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Peningkatan](roadmap-delivery.id.md)

Dengan pemutar dan CLI kontrol yang telah diperbarui, jalankan `ott handoff SOURCE TARGET`. Sumber tetap memutar. Tujuan memerlukan sumber/akun terkonfigurasi yang sama dan ID kanal yang unik serta stabil. Referensi kanal adalah sidik jari lokal berversi, bukan ID mentah item penyedia. Baris M3U klasik menggunakan URL aliran yang persis sama hanya sebagai masukan hash lokal. Karena itu, URL yang ditandatangani atau ditulis ulang secara terpisah tidak dicocokkan demi keamanan. Tidak ada pencocokan nama secara perkiraan, dan kredensial maupun URL yang dapat diputar tidak dikirimkan. Versi 1 mendukung siaran langsung/arsip untuk M3U, Xtream, dan Stalker; VOD/serial dan sinkronisasi riwayat tontonan berkelanjutan tidak didukung.

`playback_handoff_export` menerima parameter kosong dan mengembalikan `data.handoff`:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Referensi arsip menggunakan `kind: "archive"` dan bilangan bulat `archive_start` (posisi pemutaran saat ini dalam detik Unix). `playback_handoff_import` hanya menerima `{"handoff": ...}`. Sebelum mengirim perintah, tujuan memeriksa identitas katalog, ketersediaan arsip, kebijakan orang tua/kios, dan kepemilikan kendali saat ini. Tujuan memperoleh aliran melalui penyedianya sendiri. Impor yang diterima mengembalikan `{"status":"ok","data":{"dispatched":true,"kind":"live"}}`. Pengiriman tidak memastikan video berhasil didekode atau suara HDMI terdengar.

Penolakan hanya menampilkan kode kesalahan: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Referensi memiliki batas; penerima menolak kolom tambahan. Gunakan izin operator dengan cakupan terbatas untuk ekspor/impor dan lindungi koneksi pengontrol. Identitas sumber adalah kunci pencocokan opak, bukan kredensial akses yang dapat dipindahkan.

Jalankan `node tests/test_remote_handoff.cjs`. Lihat [panduan kontrol](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) untuk autentikasi, hasil, dan perilaku TTL perintah.

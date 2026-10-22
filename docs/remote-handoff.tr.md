<a id="explicit-playback-handoff"></a>

# Açık oynatma devri

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[İyileştirmeler](roadmap-delivery.tr.md)

Güncel oynatıcı ve kontrol CLI'siyle `ott handoff SOURCE TARGET` komutunu çalıştırın. Kaynak oynatmayı sürdürür. Hedefte aynı kaynak/hesap yapılandırılmış olmalı ve benzersiz, sabit bir kanal kimliği bulunmalıdır. Kanal başvuruları sürümlü yerel parmak izleridir; sağlayıcının ham öğe kimlikleri değildir. Klasik M3U satırları, akış URL'sinin tam halini yalnızca yerel karma girdisi olarak kullanır. Bu nedenle bağımsız olarak imzalanan veya yeniden yazılan URL'ler güvenlik gereği eşleştirilmez. Yaklaşık ad eşleştirmesi yapılmaz; kimlik bilgileri veya oynatılabilir URL'ler aktarılmaz. Sürüm 1, M3U, Xtream ve Stalker için canlı/arşiv oynatmayı destekler; VOD/diziler ve izleme geçmişinin sürekli eşitlenmesi desteklenmez.

`playback_handoff_export` boş parametreleri kabul eder ve `data.handoff` döndürür:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

Arşiv başvuruları `kind: "archive"` ve tamsayı `archive_start` kullanır (Unix saniyesi olarak geçerli oynatma konumu). `playback_handoff_import` yalnızca `{"handoff": ...}` kabul eder. Hedef, komutu göndermeden önce katalog kimliğini, arşiv kullanılabilirliğini, ebeveyn/kiosk ilkelerini ve mevcut kontrol sahipliğini doğrular. Akışları kendi sağlayıcısı üzerinden çözümler. Kabul edilen içe aktarma `{"status":"ok","data":{"dispatched":true,"kind":"live"}}` döndürür. Gönderim, videonun çözüldüğünü veya HDMI sesinin duyulduğunu doğrulamaz.

Ret yanıtları yalnızca bir hata kodu gösterir: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`. Başvurular sınırlandırılmıştır; alıcı ek alanları reddeder. Dışa/içe aktarma için kapsamı sınırlı operatör izinleri kullanın ve denetleyici bağlantısını koruyun. Kaynak kimliği, aktarılabilir erişim bilgisi değil, içeriği yorumlanmayan bir eşleştirme anahtarıdır.

`node tests/test_remote_handoff.cjs` komutunu çalıştırın. Kimlik doğrulama, sonuçlar ve komut TTL davranışı için [kontrol kılavuzuna](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) bakın.

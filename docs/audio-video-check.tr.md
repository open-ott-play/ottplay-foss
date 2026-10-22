# Elle ses ve görüntü kontrolü

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Akış kurtarma](playback-stream-policy.tr.md) · [Test örneği tanımı](../diagnostics/README.md)

Bilinen sekiz saniyelik bir kliple görüntü ve sesi kontrol etmek için **oynatıcı menüsü → Bilgi → Ses → Oynat** yolunu kullanın. Sesli A/V kontrolü budur; ilk kullanımda gösterilen hareketli desen demosu sessizdir.

![A/V kontrolü: depo kaynağı, barındırılan klip ve açık oynatma](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## Kontrolü başlatma

1. Televizyonu, hoparlörleri veya kulaklığı rahat bir ses düzeyine ayarlayın. Kontrol oynatıcının mevcut sesini kullanır ve videosunun sesini geçici olarak açar; televizyonun sistem sesini yükseltmez.
2. Oynatıcı menüsünü açın; **Bilgi**, ardından **Ses**, ardından **Oynat** seçin. Yalnızca menüyü açmak klibi indirmez veya oynatmaz.
3. Ekranı izleyip aşağıdaki sırayı dinleyin. Erken bitirmek için **Bilgi → Ses → Durdur** kullanın.

Kontrol, oynatıcı boşta veya canlı TV oynuyor ya da duraklatılmışken yönetilen temel HTML5 oynatma yolunu kullanır. Etkin VOD/arşiv isteğini, hâlâ yüklenen canlı isteği ve bekleme durumunu reddeder. **PC2/Video.js** ve yerel motor geçersiz kılmaları dahil, cihaz adaptörü temel motorun yerine geçtiğinde de kullanılamaz; yalnızca HTML5 video öğesi kullanmak adaptörü uygun yapmaz. Ret, mevcut oynatmayı değiştirmez. Boştan test etmek için önce mevcut isteği durdurun; bu, söz konusu adaptörlerde kontrolü etkinleştirmez. Menü etiketleri seçilen arayüz dilini izler.

<a id="what-you-should-see-and-hear"></a>

## Görmeniz ve duymanız gerekenler

Arka planda hareketli bir test deseni vardır. Kısa beyaz işaretler üst sol veya sağ yarıda, yaklaşık 150 ms uzunluğundaki hafif ses darbeleriyle eşzamanlı yanıp söner:

- **0–2 saniye:** her saniye sol kanalda 440 Hz darbe ve sol işaretin yanıp sönmesi.
- **2–4 saniye:** sağ kanalda 880 Hz darbe ve sağ işaret.
- **4–6 saniye:** iki kanalda darbe ve iki işaret.
- **6–8 saniye:** desen sessiz hareket etmeyi sürdürür. Bu sessizlik kasıtlıdır.

Mono televizyon veya downmix, iki kanalı tek hoparlörden verebilir. Fiziksel ekranı ve ses çıkışını kendiniz kontrol edin. Oynatıcı hoparlör çıkışını ölçmez ve otomatik A/V geçti/kaldı kararı üretmez.

<a id="where-the-clip-comes-from"></a>

## Klibin kaynağı

Oynatıcı şu mutlak HTTPS adresini kullanır:

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Klibi yalnızca **Oynat** seçildiğinde ister; başlangıçta ön yükleme yapmaz. Dosya **464 652 bayttır**; 640×360 / 25 fps H.264 baseline video ve AAC stereo ses içerir. Web, OTTPlay Server, Tauri, Capacitor ve kapsayıcı paketlerinden çıkarılmıştır. [Kaynak dosya](../diagnostics/av-v1.mp4), üretici ve doğrulayıcı depoda kalır; kurulu oynatıcıda çevrimdışı yedek değildir.

İnternet erişimi ve o sunucuya çalışan bir HTTPS bağlantısı gerekir. Paketlenmiş yedek veya alternatif tanılama URL'si yoktur. Yukarıdaki bağlantıyı tarayıcıda açmak dosyanın erişilebilirliğini kontrol etmeye yardımcı olur ancak oynatıcının kod çözücü sahipliğini veya kanala dönüş davranışını sınamaz. Barındırma hizmeti normal bağlantı bilgilerini alır; [gizlilik ayrıntılarına](privacy-policy.md#optional-hosted-audio-video-check) bakın.

<a id="how-playback-returns"></a>

## Oynatmaya dönüş

Kontrol ana kod çözücüyü kullanır ve canlı görüntüyü geçici olarak değiştirir. Klip bitince, **Ses → Durdur** sonrasında veya medya hatasında sona erer. **15 saniyelik güvenlik süresi kontrol kabul edildiğinde başlar** ve yüklemeyi de kapsar; bu nedenle yavaş indirme sekiz saniyenin tamamı oynatılmadan sona erebilir.

Bu durumlarda oynatıcı, yakalanan canlı isteği duraklatma durumu dahil canlı uçta geri yüklemeye çalışır; ancak istek hâlâ mevcut kaynağa ait olmalı ve yerine başka oynatma geçmemiş olmalıdır. Canlı URL yeniden çözülür; geri yükleme yine sağlayıcıya ve ağa bağlıdır. Boşta başlatılan kontrol boşta duruma döner.

Normal oynatma **Stop** komutu, bekleme veya başka kanal seçme, yakalanan kanalı yeniden başlatmadan kontrolü iptal eder. Kaynağı veya oturumunu değiştirmek de eskimiş geri yüklemeyi önler. Kontrol çıkışta kendi geçici ses açma işlemini geri alır; çalışırken sesi kapatırsanız kapalı kalır. Kaydedilmiş motor tercihini değiştirmez, test saniyelerini kanal geçmişine yazmaz veya işletim sistemine sahte kanal tamamlanması ya da test meta verisi yayımlamaz.

<a id="if-the-result-is-unexpected"></a>

## Sonuç beklenmedikse

- **Kontrol başlayamıyor:** oynatıcının boşta veya yönetilen temel HTML5 yolunu kullanan, zaten oynayan/duraklatılmış canlı kanalda olduğunu doğrulayın; cihaz motoru geçersiz kılınmamalıdır. Desteklenmeyen durum veya medya hatası **“Stream could not be played”** gösterebilir.
- **Hiçbir şey yüklenmiyor veya kontrol erken kapanıyor:** internet erişimini ve doğrudan HTTPS bağlantısını kontrol edin. Ağ hatası veya süre bitimi, kod çözücünün ya da hoparlörün bozuk olduğunu kanıtlamaz. Yeniden Oynat seçmeden bağlantıyı düzeltin.
- **Görüntü var, ses yok:** son iki saniye kasıtlı olarak sessizdir. İlk altı saniyede oynatıcı sessiz/ses ayarını, televizyon sesini ve seçilen çıkışı, hoparlör/kulaklık bağlantısını kontrol edin.
- **Yalnızca bir fiziksel hoparlör çalıyor:** kanal yönlendirme arızası saymadan önce televizyonun mono çıkış veya downmix kullanıp kullanmadığını kontrol edin.

Bu, bilinen bir MP4'ün yönetilen temel HTML5 görüntü/ses yolunda kısa kontrolüdür. Sağlayıcı akışı, HLS/DASH, DRM, çok kanallı ses veya daha yüksek çözünürlüğün çalışacağını göstermez; ağ kapasitesini veya eşzamanlama gecikmesini ölçmez. Kalite sınırları ve canlı yedek akış ayarları bu tanılama klibini değiştirmez.

Sahiplik ve temizleme davranışı [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) ile [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs) tarafından sınanır. Otomatik kod çözme ve yaşam döngüsü kontrolleri gerçek cihazda izleyip dinlemenin yerini tutmaz; bu kılavuz yeni bir fiziksel cihaz sonucu iddia etmez.

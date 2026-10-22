# Güvenilirlik ve medya iyileştirmeleri

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.tr.md) · [Mimari](architecture.md)

Bu kılavuz eski bir kurulu sürümün yeteneklerini değil, bu sayfanın kaynak revizyonundaki uygulamayı açıklar. Oynatıcı, denetim hizmeti/CLI ve yerel Android uygulaması ayrı çıktılardır. Birini güncellemek diğerlerini güncellemez.

![Sorumluluklar ve güven sınırları](diagrams/roadmap-components.svg)

[Ölçülen bayt maliyeti ve karşılaştırma grafiğine](roadmap-size.tr.md) bakın; çalışma hızı ve cihazda oynatma ayrı kabul kontrolleridir.

<a id="what-is-implemented"></a>

## Uygulanan özellikler

1. **Bilinen bir ses/video örneği.** [Bilgi → Ses](audio-video-check.tr.md), here.now üzerinden sol/sağ tonları ve eşleşen yanıp sönmeleri olan sekiz saniyelik bir klip oynatır (internet gerekir). Yalnızca **Oynat** sonrasında alınır, başlangıçta asla alınmaz; medya dosyası oynatıcı paketlerinde bulunmaz. Ana HTML5 kod çözücüyü yalnızca boşta veya canlı TV izlenirken geçici olarak kullanır. İzleme geçmişi yazmaz. [Örnek tanımı](../diagnostics/README.md).
2. **Sürdürülebilir Local/Home kurulumu.** Denetim CLI'si bir ön ayarı planlayabilir, uygulayabilir, sürdürebilir ve doğrulayabilir. Sonucu belirsiz bir yazmayı yeniden denemeden önce kaydedilen ayarları karşılaştırır. [Denetim iş akışı](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Sınırlı oynatma kurtarma.** HLS/Shaka geçici hataları sonlu bir kurtarma politikasını paylaşır. Kimlik doğrulama hataları ve desteklenmeyen DRM sonlandırıcıdır. Stop, kanal değişikliği ve kaynak değiştirme eski işlemleri iptal eder.
4. **Kaydedilen kalite sınırları.** En yüksek yükseklik ve bit hızı uyarlanabilir seçimi sınırlar; yerel oynatmaya geçiş etkin bir üst sınırı sessizce aşmamalıdır.
5. **Yerel Android iz tercihleri.** Bağımsız Android uygulaması başka akışın iz indeksini taşımak yerine Auto ve altyazıların kapalı olması dahil dil/rol/etiket niyetini hatırlar.
6. **Kapsamı sınırlı komut operatörleri.** Denetleyici yönetici kimlik bilgisini vermeden bir kimlik bilgisine belirli cihazlar/eylemler için izin verebilir.
7. **Açık XMLTV bağlamaları.** Oynatma listesi kapsamındaki bir kanal belirli bir besleme ve XMLTV kimliğine bağlanabilir. [Rehber bağlamaları ve erişilebilirlik](guide-binding-accessibility.tr.md).
8. **Xtream filmleri ve dizileri.** Medya kitaplığı seçilen kataloğu, ardından dizinin bölümlerini ihtiyaç halinde getirir. [Kitaplık sözleşmesi](xtream-media.tr.md).
9. **Erişilebilir klasik kontroller.** Kanal listeleri seçim anlamını sunar; modal iletişim kutuları klavye odağını korur ve geri yükler; bildirimler canlı bölgeye sahiptir.
10. **Kalıcı komut sonuçları.** İsteğe bağlı, sınırlı bir denetleyici günlüğü yinelenenleri ayıklama ve sonuç meta verilerini saklar. Yeniden başlatma komutları asla körlemesine tekrarlamaz.
11. **Açık cihaz devri.** Canlı/arşiv başvuruları aynı kaynak yapılandırmasına sahip oynatıcıya geçer. Hedef kendi URL'sini çözer. [Sözleşme](remote-handoff.tr.md).
12. **Açık yedek akışlar.** Canlı kanallar aynı sonlu kurtarma politikası içinde yapılandırılan alternatifleri kullanabilir. [Sınırlar, kurtarma ve yedekler](playback-stream-policy.tr.md).
13. **Kurtarılabilir ayar grupları.** Yerel localStorage, desteklenen çok anahtarlı yazmalar için geri alma günlüğü kullanır. [Depolama güvenceleri](settings-recovery.tr.md).

<a id="language-and-compatibility-coverage"></a>

## Dil ve uyumluluk kapsamı

Oynatıcı 88 çeviri kataloğuyla gelir. Yedi yeni kalite/medya etiketi her katalogda çevrilmiştir; diğer yeni menüler mevcut çevrilmiş etiketleri kullanır. Katalog kontrolleri anahtar eşitliğini, yer tutucuları ve gözden geçirilmiş istisnaları kapsar. Eşleştirilmiş mühendislik kılavuzları aynı uygulama sınırlarını [24 dokümantasyon dilinde](manual-translations.md) açıklar. [Yerelleştirilmiş giriş sayfaları](readme/README.md) hızlı başlangıç kılavuzlarıdır; geçmişteki her mühendislik belgesinin 88 tam çevirisi olduğu iddiası değildir.

Klasik çıktı ES5 sözdizimini korur. Bu, her cihazın her codec'i, Web API'sini, depolama güvencesini veya yerel entegrasyonu desteklediği anlamına gelmez. A/V önizlemesi ana yönetilen HTML5 yoluyla sınırlıdır; PC2/Video.js ve yerel motorlar gibi bunun yerine geçen cihaz motorları hariçtir. Açık rehber bağlamaları barındırılan veya yerel XMLTV uygulamasını kullanır; isteğe bağlı harici companion protokolleri bunları desteklemeyebilir. Cihaza özgü kabul hâlâ gerçek cihaz gerektirir.

<a id="reproduce-the-checks"></a>

## Kontrolleri yeniden üretme

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

Medya doğrulayıcı FFmpeg/FFprobe gerektirir. İki ses kanalını da çözer; enerjilerini, ayrımını ve sessizliğini kontrol eder. Yalnızca bir AAC izinin varlığı duyulabilir içerik kanıtı değildir. Olağan JavaScript testleri iptal, başarısız yazma, yeniden başlatma sonrası kurtarma, kaynak değişimi ve geçersiz girdileri sınar. Son paket kontrolleri yalnızca ana giriş noktasını değil, isteğe bağlı sağlayıcı ailelerini de içerir.

Denetleyicide `go test -race ./...`, `go vet ./...` ve `python3 -m unittest discover -s tests` çalıştırın. Yerel Android'de iz tercihleri ve ayar yedeği birim testlerini çalıştırıp hata ayıklama APK'sını derleyin. Her deponun CI'si daha sonra değiştirilmiş ağacı değil, ilgili commit'i doğrular.

<a id="physical-acceptance-before-promotion"></a>

## Terfi öncesi fiziksel kabul

- Hedef TV'de A/V kontrolünü çalıştırın; sol/sağ sesi, görünür yanıp sönmeleri, Stop'u ve canlı TV'ye dönüşü doğrulayın. Kod çözücü testleri HDMI sesi veya akıcılığı kanıtlamaz.
- İzin verilen/reddedilen akışları, başarısız bir yedeği ve bekleyen yeniden deneme sırasında kanal değişimini sınayın. Seçilen kalite sınırını gerçek arka uçta doğrulayın.
- Liste/iletişim kutusu odağını klavye, kumanda ve mevcut ekran okuyucuyla test edin.
- İki benzer kanal adını farklı XMLTV kimliklerine bağlayıp program verilerini doğrulayın.
- Test ön ayarının uygulanmasını kesin, denetleyiciyi yeniden başlatın, sürdürün ve doğrulayın. Hem eşleşen hem eşleşmeyen yapılandırılmış kaynağa devir yapın.
- Yerel Android'de iz sıraları farklı akışlar arasında geçiş yapın, uygulamayı yeniden başlatın ve açık Auto/Off ile tercih edilen dil davranışını doğrulayın.

Başarılı gönderim, kaydedilmiş ayarlar, çözülmüş örnekler ve geçen birim testleri farklı kanıtlardır. Sürüm terfisi bu ayrımı korumalıdır; [sürüm stratejisine](../RELEASING.md) bakın.

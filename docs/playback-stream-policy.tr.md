# Kalite sınırları ve canlı akış kurtarma

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Kod çözücü sahipliği](device-media-backend.md)

Yönetilen HTML5/HLS/Shaka oynatıcı, arızalı bir kaynaktan kurtulurken tek oynatma sahipliğini korur. Canlı kanal için açıkça yapılandırılmış en fazla üç yedek URL de kullanabilir. Kanalı adına göre asla keşfetmez, tahmin etmez veya değiştirmez.

![Kurtarma: tek sahiplik, sonlu yeniden denemeler, açık yedekler](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Kalite üst sınırı belirleme

**Ayarlar → Arayüz ayarları** bölümünde **En yüksek video yüksekliği (HLS/Shaka)** ve/veya **En yüksek akış bit hızı (HLS/Shaka)** belirleyin. İki kısıt birlikte uygulanır. **Otomatik**, ilgili kısıtı kaldırır. 360/480/720/1080/2160 piksel ve 1/2/4/8/16 Mbps desteklenir. Ayarlar yerel saklanır, normal kaydet/iptal akışına katılır ve kurtarma yeniden başlatması dahil bir sonraki oynatma başlangıcında geçerli olur.

Bunlar üst sınırlardır, kod dönüştürme ayarları değildir. Yalnızca 1080p sunan akış 720p olamaz. Bildirilen hiçbir varyant uygun değilse oynatıcı **No stream meets the quality limits** gösterir ve isteği yeniden denemeyi bırakır. Bilinmeyen yükseklik/bit hızı, kısıtlanmış HLS varyantının uygunluğunu kanıtlayamaz.

HLS varyantları parçalar yüklenmeden önce filtrelenir. Güncel hls.js uygun olmayan varyantları kaldırır; `removeLevel` olmayan eski sürümler yalnızca güvenli, kesintisiz bir başlangıç bölümünü tutabilir ve daha ileride uygun varyantları olsa bile manifesti reddedebilir. Shaka uygulama `maxHeight`/`maxBandwidth` kısıtlarını kullanır. Otomatik uyarlama kalan varyantlar arasında devam eder.

Ayarlar yönetilen HLS ve Shaka motorlarına uygulanır. Düz HTML5, yerel platform kod çözücüleri ve korunan TV/STB motorları aynı kontrolleri sunmaz. Auto yerel oynatma seçebilir; ayar bunu MSE'ye zorlamaz. Oynatıcı, zaten kısıtlı bir HLS isteğini yalnızca kod çözme hatasından kaçmak için sınırsız yerel oynatmaya geçirmez. Yerel kod dönüştürücü, otomatik donanım testi veya fiziksel 720p çıkışı iddiası yoktur.

<a id="configure-explicit-backups"></a>

## Açık yedekler yapılandırma

1. İstenen canlı kanalı başlatın.
2. **Bilgi → Yedek akışlar** bölümünü açın.
3. Yuva 1, 2 veya 3'ü seçip tam bir HTTP/HTTPS medya URL'si girin.
4. Dolu yuvayı **Düzenle** veya **Sil** için tekrar açın. Güncellenmiş listeyi kullanmak için kanalı yeniden başlatın.

Her yuva, mevcut sağlayıcının depolama ad alanına ve tam `sourceId`/`channelId` çiftine aittir. Mevcut oynatma nesli ve kaynak yapılandırması düzenleyiciyi sınırlar. İletişim kutusu açıkken kaynak değiştirmek, o kutunun yeni kaynağa kaydetmesini engeller. Aynı yuvaya eşzamanlı değişiklik, üzerine yazılmak yerine reddedilir.

İlk URL kanalın normal kaynağı olarak kalır. Yinelenen ve boş yuvalar atlanır. En fazla 256 kanal kaydı ve 256 KiB yapılandırma kabul edilir. user-info kimlik bilgisi, boşluk, denetim karakteri, ters eğik çizgi veya geçersiz port içeren URL'ler reddedilir. Sağlayıcının sorgu tokenları yine medya URL'sinin parçası olabilir: yedek ayarları yerel kaynak yapılandırmasıdır, kimlik bilgilerini paylaşma veya herkese açma mekanizması değildir.

Yedekler **yalnızca canlı yayın** içindir. Arşiv ve VOD istekleri canlı alternatifi asla kullanmaz: kayıt, zaman başlangıcı, haklar ve arama anlamı farklı olabilir. Sahip, eşdeğer ve yetkili canlı uç noktalar sağlamalıdır. Aynı kanal adı eşdeğerlik kanıtı değildir. Taşıma uç noktası değiştiğinde kayıtlı kanal kimliği, favoriler ve EPG bağı değişmez.

<a id="recovery-guarantees"></a>

## Kurtarma güvenceleri

- İstek toplamda en fazla **aynı URL'ye iki gecikmeli geçici yeniden deneme** ve üç yedek yuvasının her birine en fazla bir ileri geçiş yapar: ilk başlangıçtan sonra en fazla beş yeniden oluşturma. Yeni kod çözücü örneği veya başarılı manifest bu bütçeyi sıfırlamaz. Motor içindeki mevcut sınırlı HLS ağ/kod çözme kurtarması bu dış politikadan önce çalışır.
- HLS manifest/seviye ayrıştırma hataları istek başına aynı URL'ye en fazla bir yeniden bağlantıya izin verir; bu, aynı toplam iki deneme limitine dahildir. Yeni kod çözücü veya yedek uç nokta sınırı sıfırlamaz.
- Durumsuz ağ hataları, HTTP 408/429 ve 5xx geçici bütçeyi kullanabilir. Diğer HTTP 4xx yapılandırılan alternatife geçebilir ama aynı URL'yi yeniden denemez. **HTTP 401/403 ve kaynak oturum açma hataları isteği bitirir**; alternatif kimlik bilgisi veya yedek uç nokta denenmez.
- Kod çözme hataları açık yedeğe ilerleyebilir. İmkânsız kalite sınırları sonlandırır. Ana kaynağa dönen döngü yoktur.
- Gecikme 500 ms, 1 s, 1.5 s, sonra en fazla 2 s'dir. Tekrarlanan geri çağrılar birleştirilir.
- Pause bekleyen yeniden denemeyi koruyarak zamanlanmış zamanlayıcıyı kaldırır; Resume yeniden zamanlar. Stop, bekleme, kaynak ve kanal değiştirme gecikmeli geri çağrıları geçersiz kılar. Kesin olarak başarısız istek, emekliye ayrılan kod çözücüyü otomatik oynatmak yerine açık yeniden seçim gerektirir.
- Shaka yükleme hataları ve kritik hata olayları aynı yolu paylaşır; iptal hataları yok sayılır. Yeniden bağlanma, Shaka'nın eşzamansız yok edilmesini bekler.
- Kurtarma opak Stalker başvurusunu tekrar çözer ve korunan kaynak erişimini yeniden hazırlar. Süresi geçmiş iOS loopback URL'sini kullanmaz. VOD/arşiv konumu sökümden önce alınır; canlı yedekler kendi canlı ucundan başlar.

Politika donmuş kareler için ikinci bir gözcü eklemez. Mevcut kiosk, Auto/native ve HLS kurtarmaları kendi gözlenen hata durumlarını karşılamayı sürdürür. Mevcut algılayıcılardan hiçbiri hata bildirmeden sessizce takılan akış ayrı tanı gerektirir.

<a id="verification-and-observability"></a>

## Doğrulama ve gözlemlenebilirlik

`window.__ottStreamPolicy.snapshot()` motor adını, istenen sınırları, yetenek/kullanılabilirliği, deneme sayısını, uç nokta indeksini ve kurtarma durumunu sunar. Akış URL'si veya sağlayıcı kimlik bilgisi içermez. Sıfır normal kaynaktır; sonraki indeksler boş olmayan benzersiz alternatiflerdir. Bu tanı durumudur, kararlı bir uzaktan kontrol API'si değildir.

Çalıştırın:

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

Testler monoton olmayan varyant sırasıyla kalite filtrelemesini, bulunmayan meta veriyi, kaynak kapsamlı düzenlemeyi, yuva çakışmalarını, yinelenen hataları, sınırlı bütçeleri, HTTP yetkilendirme hatalarını, pause/stop/kaynak iptalini, Shaka sökümünü ve VOD konumu korumasını sınar. Beş yeni oynatma etiketi dağıtılan 88 dil paketinin tümünde çevrilmiştir; otomatik eşitlik, anadili konuşan incelemesi değildir. Fiziksel TV/D1 oynatma ve sağlayıcıya özel manifestler hâlâ cihaz doğrulaması gerektirir. [Düzenlenebilir diyagram kaynağı](diagrams/stream-recovery.mmd).

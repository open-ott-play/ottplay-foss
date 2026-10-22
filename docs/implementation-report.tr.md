# Özellik listesinden doğrulanmış davranışa

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Özellik sözleşmeleri](roadmap-delivery.tr.md) · [Boyut kanıtları](roadmap-size.tr.md)

Bu rapor bir sürüm duyurusu değil, uygulama ve sağlamlaştırma sürecinin kaydıdır. Ölçülen oynatıcı anlık görüntüsü `652726f8`, ayrı derlenen yerel Android anlık görüntüsü `be0d800`'dür. CI, birleştirme ve sürüm yükseltme ayrı kontrol kapılarıdır. Daha sonraki yalnızca belge veya test commit'leri, yerel bir kontrolü kurulu cihazın güncellendiğinin kanıtına dönüştürmez. Aşağıdaki durumlar bu tarihsel görüntülere aittir; canlı sürüm takibi değildir. Yayımlanmış derlemeler için [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases) sayfasına bakın.

![Uygulama süreci ve kabul kapıları](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Çalışma nasıl denetlendi

İlk istek klasik oynatıcı, kontrol hizmeti/CLI ve bağımsız yerel Android uygulamasında 13 kullanılabilir özellik parçasına ayrıldı. Eşzamanlı değişikliklerin başka bir bileşenin çalışmasının yerine geçmeden incelenip bütünleştirilmesi için sahiplik bileşenlere göre atandı. Yeni arayüz mevcut çevrilmiş etiketleri kullandı veya 88 dilin tümünde katalog girdileri ekledi; tam mühendislik kılavuzları başlangıçta İngilizce ve Rusçaydı. Ana kılavuz ve eşleşen özellik kılavuzları artık [24 belge dilinde](manual-translations.md) tam sürümlere sahiptir.

Uygulamayı bağımsız çapraz inceleme ve çalıştırılabilir regresyon testleri izledi. Bildirilen bir sorun, kod değiştirilmeden önce gerçek geri çağrı, çözücü, depolama veya odak yolunda denetlendi. Test hataları davranış regresyonları ve eskimiş test seçicileri olarak ayrıldı. Örneğin klasik satırları `button` yerine `option` yapmak seçicileri güncellemeyi gerektirdi; beklenen tıklama davranışını zayıflatmayı haklı çıkarmadı.

Ardından temiz üretim derlemeleri üretilen ES5 eserlerini ve isteğe bağlı sağlayıcı modülleri dahil tüm JavaScript maliyetini denetledi. Hedefli tarayıcı testleri dağıtılan yükleyiciyi, paketi ve cihaz adaptörlerini kullandı. Yerel Android için ayrı Gradle test, lint ve paketleme çalışması yapıldı. Gönderimden sonra PR kontrolleri ve inceleme konuları tekrar kontrol edilir; yerel derlemenin geçmesi bunların yerine geçmez.

<a id="what-changed-during-review"></a>

## İnceleme sırasında neler değişti

![Düzeltilen beş davranış ve ölçülen JavaScript maliyeti](diagrams/implementation-results.svg)

- **HLS ayrıştırma ve yeniden deneme:** ayrıştırma hataları başlangıçta genel ağ sınıflandırmasını paylaşıyordu. Artık iki geçici yeniden deneme bütçesi içinde aynı URL'ye en fazla bir yeniden bağlantı hakkı var; yeni çözücüler ve yedek URL'ler bunu sıfırlamıyor. Sonlandırıcı kimlik doğrulama/DRM hatası, sıraya alınmış geçici denemeyi de iptal ediyor.
- **Yerel Auto geri dönüşü:** yerel hata işleme, Auto zaten bir yedek geçişin sahibiyken isteği emekliye ayırabiliyordu. Mevcut sahip artık bu geçişi koruyor; iptal yine gecikmiş geri çağrılarını geçersiz kılıyor.
- **Modal Enter:** ilk İptal düğmesine otomatik odaklanma, Plex bekleme iletişim kutusunda Enter'ı iptale dönüştürüyordu. İletişim kutuları artık odağı kendilerinde tutarak başlıyor. Tab düğmelere açıkça ulaşıyor; normal bilgi ve onay kutuları Enter ve Escape/Geri davranışını koruyor.
- **PC işaretçi seçimi:** fare odağı tıklama işleyicisinden önce seçimi değiştirip ilk tıklamayı etkinleştirmeye dönüştürüyordu. İşaretçinin oluşturduğu odak artık satırı önceden seçmiyor. PC yine önce seçiyor, sonra etkinleştiriyor; LG tek tıklamalı davranışını koruyor. Klavye odağı seçimi izlemeyi sürdürüyor.
- **Android izleri:** mevcut öğenin etiketsiz seçimi kendi Auto onayı veya altyazı tercihi güncellemesiyle silinebiliyor ya da eşit `TrackGroup` taşıyan başka öğeye sızabiliyordu. Artık gecikmiş yazımlara yalnızca mevcut öğesi için dayanıyor. Anlamsal tercihler dil/rol/etiket kullanıyor; kalıcı kaydın sahibi ViewModel olduğundan paneli kapatmak yazımı iptal etmiyor.

Teslim edilen 13 parça: A/V örneği; sürdürülebilir Local/Home kurulumu; sınırlı kurtarma; kalite tavanları; Android iz tercihleri; kapsamı sınırlı kontrol anahtarları; XMLTV bağları; Xtream film/dizileri; klasik erişilebilirlik; kalıcı komut sonuçları; açık devir; yedek akışlar; kurtarılabilir ayar grupları. [Özellik kılavuzu](roadmap-delivery.tr.md) her birinin kapsamını ve sınırlarını tanımlar.

<a id="evidence-and-remaining-gates"></a>

## Kanıtlar ve kalan kapılar

`652726f8` için beş hedefli tarayıcı senaryosu geçti: LG webOS işaretçi gezinmesi, LG NetCast işaretçi gezinmesi, PC iki tıklama davranışı, iletişim kutusu klavye anlamları ve Plex koleksiyon/çözümleme/iptal/yeniden deneme. TypeScript, erişilebilirlik birim test düzeneği, kapsamı sınırlı lint, ES5 ve paket bütçesi kontrolleri geçti. Bu derlemedeki tam tarayıcı çalışması **194 geçti ve bir atlandı** sonucuyla bitti: yerel HLS WebKit gerektirirken bu çalışma Chromium kullandı. Barındırılan CI ve kararlaştırılan birleştirme sırası ayrı kapılardır.

Kalan `test:port` ve `test:unified` zinciri, yalıtılmış test düzenekleri düzeltildikten sonra sürdürülen bölümler halinde tamamlandı. Başarısız her hedef yeniden çalıştırılıp geçti, kalan komutlar da başarıyla bitti; bu, kesintisiz tek bir `npm test` çalışması iddiası değildir. Android köprüsünün dokuz komutlu tam CI adımı da yerelde geçti.

Android `be0d800` için **101 uygulama testi ve 62 paylaşılan çekirdek testi** yerelde geçti; debug/release lint, Debug/Release/Full APK oluşturma, sürüm paketi ve androidTest APK derlemesi de geçti. Enstrümante test APK'sını derlemek cihazda çalıştırmak değildir. Doğrulanan üç inceleme bulgusu [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68) içinde yanıtlanıp çözüldü. PR kontrolleri geçti ve `5b644b94` olarak birleştirildi; birleştirme sonrası CI ayrı izlenir. Diyagram genel oynatıcı CI/sürüm kapısını beklemede bırakır.

Tam web JavaScript toplamı ham/gzip **964,459 / 305,344** bayttan **995,858 / 315,207** bayta çıktı: **+31,399 / +9,863 bayt** (yaklaşık %3.26 / %3.23). Özellik adayı 995,587 / 315,103'tü; sonraki sağlamlaştırma 271 / 104 ekledi. O görüntüdeki son ana giriş 875,197 / 270,425'tir. [Başlangıç ölçümü](evidence/roadmap-size-20261015.json), [son eser ölçümü](evidence/roadmap-final-size-20261015.json) ve [ölçüm yöntemine](roadmap-size.tr.md) bakın. Bu bayt sayılarındaki virgüller binlik ayırıcıdır.

Bunlar tarihsel JavaScript bayt maliyetleridir, **ölçülmüş hız iyileştirmeleri değildir**. Toplamlar medya motorlarını, sözlükleri, CSS'yi, resimleri ve videoyu dışlar. Bu görüntünün oynatıcı paketleri 464,652 baytlık A/V klibini ayrıca taşıyordu. [Barındırma değişikliğinden](audio-video-check.tr.md) sonra `diagnostics/av-v1.mp4`, yeniden üretilebilirlik için üreticisi ve doğrulayıcısıyla depoda kalır, ancak Web/OTTPlay Server, Tauri, Capacitor ve Docker paketlerinden çıkarılır. Oynatıcı yalnızca internet gerektiren açık A/V kontrolü için here.now'dan indirir; başlangıç oynatımı indirmez. 464,652 ham medya baytını kaldırmak, sıkıştırılmış yükleyicilerdeki kazancı belirlemez ve tarihsel JavaScript ölçümlerini değiştirmez. Başlangıç süresi, kare düzeni, bellek, ekran okuyucu deneyimi, gerçek HDMI sesi ve sağlayıcı davranışı hedef cihazlarda ayrı ölçüm ister. Bu rapor yeni fiziksel cihaz sonucu veya beta yayını iddia etmez. [Fiziksel kabul listesi](roadmap-delivery.tr.md#physical-acceptance-before-promotion) ve [sürüm stratejisi](../RELEASING.md) yükseltme ölçütleridir.

<a id="post-beta-integration-and-review"></a>

## Beta sonrası bütünleştirme ve inceleme

beta.4 yayımlandıktan sonra `39287792` kaynağı bu dala katıldı. Çalışma zamanı revizyonu `9663b681`, HLS kalite sınırları altında canlı kenara dönüşü düzeltir ve bozuk ayar günlüğünü normal başlangıçtan önce kurtarılabilir yapar. Kurtarma ekranı kısmi hesap durumunun yüklenmesini engeller, yeniden deneme ve onaylı sıfırlama sunar, ilgisiz çerezleri korur ve sıfırlama sonrası eski çerez ayarlarının geri gelmesini önler. [Kurtarma sürecine](settings-recovery.tr.md) ve SVG diyagramına bakın.

![Beta sonrası tam JavaScript karşılaştırması](diagrams/post-beta-size.svg)

İki kaynağı Node 26.8.2, Rollup 4.64.5 ve Terser 5.51.2 ile yeniden üretmek, beta.4 kaynağı için ham/gzip **964,876 / 305,452**, bütünleştirme için **1,000,388 / 316,600** bayt verir: **+35,512 / +11,148 bayt** (%3.68 / %3.65). Toplamlar tüm isteğe bağlı sağlayıcıları içerir: başlangıçta yedi, bütünleştirmede sekiz. Yeni giriş 879,533 / 271,761'dir. Bu, yukarıdaki eski dondurulmuş grafiklerden ayrı bir karşılaştırmadır.

Her iki yerel üretim derlemesi izlenen beş çalışma zamanı dosyasını yeniden üretir ve temiz kaynak revizyonu iddiasını çıkarır. Raporlar yerel dosyaları yayımlanmış sürüm eserleri diye tanımlamak yerine bu sınırı kaydeder: [başlangıç](evidence/post-beta-baseline-size-20261015.json) ve [bütünleştirme](evidence/post-beta-candidate-size-20261015.json). Bütünleştirme derlemesi ve ES5/yerel kontroller geçer. Altı hedefli tarayıcı kontrolü de geçer: günlük kurtarma/sıfırlama, iletişim kutusu klavyesi, LG webOS ve NetCast işaretçisi, PC iki tıklamalı seçim ve sahipli Plex beklemesi.

<a id="browser-gate-integration"></a>

## Tarayıcı kapısının bütünleştirilmesi

![Doğrulanan yerel tarayıcı kontrol sonuçları](diagrams/browser-verification-results.svg)

`c52f4d07` kaynağı, main `1ecbc0e7` üzerindeki PR 779'u içerir. İki dalın test komutları, kurtarma kontrolleri ve Plex iletişim kutusu doğrulamaları korunur. TypeScript, lint, belgeler, paketleme/bağlayıcı sözleşmeleri, üretim derlemesi ve derlenmiş paketlerin tam kontrolleri geçer. Üretilen 27 oynatıcı/sağlayıcı JavaScript dosyasının tümü yukarıda ölçülen eserlerle bayt bayt aynı kalır. Bu derlemedeki tam cihaz-tarayıcı takımı **196 geçti ve beklenen bir Chromium atlaması** ile biter; atlanan yerel HLS durumu WebKit gerektirir.

Tam paketlenmiş Mode A arşivi ancak kaynağı, sağlama toplamı ve paket/sağlayıcı envanteri kontrol edildikten sonra açıldı. Chromium 156.0.8078.4, Firefox 157.0 ve WebKit 27.2, beş profil senaryosunun tümünü atlama veya yeniden deneme olmadan ayrı ayrı geçti: Playwright 1.64.0 ile **15 yerel başarı**. Gerçek konak macOS 26.7.1 idi, seçilen profillerde adı geçen `macos-15` çalıştırıcısı değildi. Kayıtlar bu farkı açıkça belirtir ve **barındırılan matris veya sürüm yeterliliği değildir**. Mevcut üretim derlemesini bekleyen ve açılmış aday dizinini değiştirmeyi reddeden [yerel özete](evidence/post779-local-acceptance/summary.json) ve [yeniden üretim tarifine](evidence/post779-local-acceptance/reproduce.sh) bakın.

[Tarayıcı politikası](browser-compatibility.tr.md) PR/beta kontrollerinde beş barındırılan hedef ve 25 senaryo yürütmesi ister; tam RC 35 hedef ve 166 yürütme içerir. Bunlar yapılandırılmış gereksinimlerdir, ölçülmüş kapsam değildir.

![Aday doğrulamasının kanıt üretmesi](diagrams/candidate-verification-flow.svg)

main `1ecbc0e7` için ayrı [beta işlem hattı](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) başarıyla tamamlandı. Bu PR'yi içermez. Bütünleştirmenin hâlâ kendi başarılı barındırılan CI ve incelemesine, ardından sürüm koordinasyonuna ihtiyacı vardır; yukarıdaki yerel sonuçlar bu teslim kapılarının geçildiğini iddia etmez.

<a id="delivery"></a>

## Teslim

- [Oynatıcı, belgeler ve i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Kontrol sunucusu ve CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Android iz tercihleri — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

Bu PR'ler güncel CI ve birleştirme durumunu taşır. Oynatıcı değişikliği, kararlaştırılan mevcut Plex düzeltmelerini ve onların beta sürümünü ayrı bir teslim dalgası olarak izler.

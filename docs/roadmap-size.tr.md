<a id="measured-javascript-cost"></a>

# Ölçülen JavaScript maliyeti

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Özellik kılavuzu](roadmap-delivery.tr.md) · [Ham kanıtlar](evidence/roadmap-size-20261015.json)

![Aynı araç zinciriyle tüm oynatıcı JavaScript’inin karşılaştırması](diagrams/roadmap-size.svg)

Bu sayfa aşağıdaki kaynak anlık görüntülerinin JavaScript ölçümlerini korur. Bunlar güncel revizyonu, kurulum paketlerini veya ağ trafiğini ölçmez.

İlk karşılaştırmada ana giriş ile tüm isteğe bağlı sağlayıcı aileleri toplamda **31 128 ham bayt / 9 759 gzip baytı**, yaklaşık **3.23% / 3.20%** büyüdü. Bu, özellik maliyetindeki artıştır; boyut veya yürütme hızı iyileşmesi iddiası değildir. Xtream hâlâ gerektiğinde yüklenir; girişten çıkarılması onu toplamdan çıkarmaz.

Ölçüm, ikisi de 1.1.55 sürümündeki temiz kaynak arşivleri `bbf9ca7b` ve `cae971da` üzerinde Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 ve zlib 1.2.12 kullanır. Üretim ES5 birleştiricisi, iyileştirici, adlandırma politikası ve doğru temiz kaynak kimliği kullanılır. Gzip düzey 9, üretilen her varlığa ayrı ayrı uygulanır.

- Web girişi: 848 092 / 262 392 → 874 926 / 270 321 ham/gzip bayt.
- Web girişi + tüm sağlayıcılar: 964 459 / 305 344 → 995 587 / 315 103.
- Yerel giriş: 848 050 / 262 460 → 874 884 / 270 372.
- Yerel giriş + tüm sağlayıcılar: 964 417 / 305 412 → 995 545 / 315 154.
- İsteğe bağlı M3U, 184 ham / 82 gzip bayt büyür; yeni Xtream 4 110 / 1 748’dir. Diğer altı isteğe bağlı aile bayt düzeyinde aynıdır.

Klip here.now’a taşınmadan önce URL’nin kökten başlayan yerel yola çevrilmesi, bu tarihsel dizide bir ham JavaScript baytı ekledi. Bu, sonraki barındırılan URL’nin ölçümü değildir. Sınırlı HLS ayrıştırma yeniden denemesi düzeltmesi, aynı anlık görüntünün yalıtılmış karşılaştırmasında 37 ham / 36 gzip bayt ekler ([kanıt](evidence/parse-recovery-size-20261015.json)). Yerel Auto aktarım sahipliği düzeltmesi 101 ham / 39 gzip bayt daha ekler ([kanıt](evidence/auto-recovery-size-20261015.json)). Erişilebilirlik gerilemeleri düzeltilmeden önceki ham toplam 995 726 bayttır; derleme kimliği ve gzip baytları son commit’te değişebilir. Son `build/reports/classic-bundle.json` ve `npm run check:size` teslim edilen kesin revizyon için belirleyicidir. İşaretçi/iletişim kutusu odak düzeltmelerini içeren sonraki temiz derleme `652726f8`, tüm web oynatıcısı için **995 858 ham / 315 207 gzip bayt** ölçer ([son çıktı kanıtı](evidence/roadmap-final-size-20261015.json)). Girişi 875 197 / 270 425; yerel toplamlar 995 816 / 315 259’dur. Bu anlık görüntünün sınırları önceki yerel/Node/sürüm soneki payını korudu: giriş için 875 300 ham / 271 600 gzip; giriş + sağlayıcılar için 996 100 / 316 400.

<a id="post-beta-integration"></a>

## Beta sonrası entegrasyon

![beta.4 entegrasyonu sonrası tüm JavaScript](diagrams/post-beta-size.svg)

Sonraki karşılaştırma, Plex entegrasyonu ve bozulmuş ayar kurtarması dahil beta.4 kaynağı `39287792` ile çalışma zamanı `9663b681`’yı aynı Node 26.8.2, Rollup 4.64.5 ve Terser 5.51.2 ile yeniden üretir:

- Web girişi: 848 315 / 262 443 → 879 533 / 271 761 ham/gzip bayt.
- Web girişi + tüm sağlayıcılar: 964 876 / 305 452 → 1 000 388 / 316 600.
- Yerel giriş + tüm sağlayıcılar: 964 834 / 305 520 → 1 000 346 / 316 654.
- Toplam web yükündeki artış: **35 512 / 11 148 bayt (3.68% / 3.65%)**.

Temel sürüm yedi sağlayıcı ailesi; entegrasyon, gerektiğinde yüklenen Xtream dahil sekiz aile sayar. Bu anlık görüntünün giriş sınırları 879 900 / 273 000; toplam sınırları 1 000 800 / 317 800’dür ve yerel, Node ve sürüm kimliği için pay bırakır. Her iki yerel üretim derlemesi izlenen beş çalışma zamanı dosyasını yeniden üretir ve temiz kaynak revizyonu iddiasını atlar. Bunlar yerelde yeniden üretilen çıktılardır, yayımlanmış beta ikilileri değildir. Araç sürümleri, karmalar ve bu kısıt [temel kanıtta](evidence/post-beta-baseline-size-20261015.json) ve [entegrasyon kanıtında](evidence/post-beta-candidate-size-20261015.json) kayıtlıdır. [Uygulama raporu](implementation-report.tr.md#post-beta-integration-and-review) düzeltmeleri ve doğrulamayı açıklar.

**Kapsam:** bu JavaScript toplamları haricî medya motorlarını, dil sözlüklerini, CSS’yi, görselleri ve videoyu içermez. Eski oynatıcı paketleri yukarıdaki toplamların dışında **464 652 baytlık bir A/V klibi** de taşıyordu. Klipin güncel dağıtımı bu ölçümlerden ayrıdır:

- **Depo:** `diagnostics/av-v1.mp4` yeniden üretilebilirlik için üreticisi ve doğrulayıcısıyla kalır. Kaynak dosyanın saklanması onun pakete eklenmesi anlamına gelmez.
- **Paketler:** Web/OTTPlay Server, Tauri, Capacitor ve Docker klibi hariç tutar. Bu, 464 652 ham medya baytını kaldırır; sıkıştırılmış kurucuda ölçülmüş 464 652 baytlık azalma değildir. Arşiv biçimi ve diğer derleme değişiklikleri boyutu etkiler.
- **Ağ:** oynatıcı klibi here.now’dan yalnızca kullanıcı [A/V kontrolünü](audio-video-check.tr.md) başlattığında alır. Kontrol internet gerektirir; başlangıç oynatımı için klip alınmaz.

Yukarıdaki tarihsel JavaScript ölçümleri değişmez. Barındırılan URL’nin JavaScript’e veya güncel bir kurucuya etkisini ölçmek yeni bir karşılaştırma gerektirir. 88 yerelleştirilmiş README depo belgesidir, oynatıcı yükü değildir. Bu bayt karşılaştırması başlangıç süresi, kare hızı, bellek veya katalog ölçeğinde performans iddiası doğurmaz. Bunlar hedef cihazlarda ayrı ölçümler gerektirir.

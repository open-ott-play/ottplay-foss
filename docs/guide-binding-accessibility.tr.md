<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Elle XMLTV eşleştirmesi ve klavye erişilebilirliği

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Program rehberi mimarisi](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Oynatma listesini düzenlemeden kanal rehberini düzeltme

İlgili M3U kanalını oynatın, **Information → EPG** bölümünü açın; EPG kaynak URL'sini ve **XMLTV ID** değerini düzenleyin. XMLTV dosyasındaki `<channel id="…">` içinden tam kimliği girin; görünen adı değil. Eşleştirmeyi kaydetmek ve listeyi yeniden yüklemek için **Set** seçin. **Automatic**, bu kanalın geçersiz kılmasını kaldırır ve listenin özgün eşleştirmesini yeniden yükler. Yalnızca oklarla hareket etmek eşleştirmeyi asla kaydetmez veya sıfırlamaz. Geri, kayıtlı eşleştirmeyi değiştirmez.

Bu düzenleyici barındırılan tarayıcı dağıtımında ve yerel XMLTV kabuklarında (Tauri ve Capacitor) kullanılabilir. Sağlayıcıya ait rehberleri, açık `=source` JSON uç noktalarını veya harici yardımcı sunucuları geçersiz kılmaz. Uzak yardımcı kullanan sıradan eski bir tarayıcı mevcut eşleştirme protokolünü korur. İlk sürüm tam kimliği kabul eder; tüm XMLTV kanallarının aranabilir bir listesini indirmez veya göstermez.

![Elle eşleştirme, oynatma listesi kaynağını ve kararlı kanalı tek bir XMLTV akışına ve tam kimliğe bağlar; aksi halde normal eşleştirme sürer.](images/guide-binding.svg)

Eşleştirme; liste kaynağı parmak izini, kararlı kanal anahtarını, açık besleme URL'sini ve XMLTV kimliğini saklar. Görünen etiketi veya satır sırasını değiştirmek, kanal kimliği aynı kaldığında eşleştirmeyi değiştirmez. Liste URL'sini/hesabını değiştirmek kaynak ad alanını değiştirir. `itemId` içermeyen eski M3U girdilerinde URL'den türetilen mevcut kanal kimliği kullanılır; URL değişirse kimlik de değişir.

Seçilen kanal görünen adını ve oynatma URL'sini korur. Rehber araması tek açık besleme kullanır ve ada göre yedek arama yapmaz; eksik kimlik sessizce başka kanalın programını almaz. Kanal adından çıkarılan otomatik bölgesel zaman kaydırmaları bu kesin eşleştirmeye uygulanmaz; listenin açık `tvg-shift` değeri yine uygulanır. Doğru bölgesel XMLTV kimliğini ayarlayın. Özel HTTPS beslemesi CORS veya karma içerik kuralları nedeniyle okunamıyorsa normal EPG tanısı bu hatayı bildirir.

Yerel kayıt kaynak başına 500 eşleştirme ve 512 KiB ile sınırlıdır; kanal başına değil, liste yüklemesi başına bir kez ayrıştırılır. Yazmalar önceki değeri karşılaştırır ve yeniden yüklemeden önce kaydedilen sonucu geri okur. Düzenleyicinin geciken geri çağrısı değiştirilmiş kaynağa kaydedemez. Bu yerel bir tercihtir, cihazlar arası eşitleme değildir. Besleme URL'leri kimlik bilgileri içerebilir; depolama dışa aktarımlarını herkese açık paylaşmayın.

<a id="accessible-classic-controls"></a>

## Erişilebilir klasik kontroller

- Sanallaştırılmış ana liste; adlandırılmış bir liste kutusu, seçili seçenek, toplam öğe sayısı ve mutlak öğe konumu sunar. Yalnızca seçili görünür satır bir Tab durağıdır. Oklarla gezinme görsel seçimi ve anlamsal durumu günceller; sayfa değiştiğinde odak, zaten odaklanmış listeyi izler.
- Standart bilgi/onay iletişim kutuları, düzenleyici ve About panelleri modal roller ve yerelleştirilmiş adlar sunar. Tab ve Shift+Tab ön plandaki modal içinde dolaşır. İç içe modal kapanınca hâlâ görünen üst kontrol geri yüklenir; eskimiş planlı açılışlar kapatmadan sonra odağı çalamaz.
- Bilgi ve onay iletileri kendi iletişim kutularını tanımlar. Geçici bildirimler rahatsız etmeyen duyurular yapan bir durum bölgesi kullanır.
- Mevcut çeviri katalogları eklenen tüm etiketleri sağlar. XMLTV ve ID protokol tanımlayıcılarıdır; kanal adları ve besleme ana makine adları kaynak meta verisi olarak kalır.

Uygulama kumanda yollarını ve ES5 sözdizimini korur. Anlamsal DOM kontrolleri tam WCAG sertifikası sayılmaz: cihaza özel odak, VoiceOver/TalkBack konuşması ve TV tarayıcısı davranışı hâlâ fiziksel test gerektirir.

<a id="verification"></a>

## Doğrulama

Çalıştırın:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Entegre dalda normal derleme/ES5/paket boyutu kontrollerini de çalıştırın. Tarayıcı kontrolleri sayfa sınırlarını aşan uzun listeyi, iç içe onayı, düzenlerken kaynak değişimini, doğru, eksik ve kaldırılmış eşleştirmeyi ve EPG indirme hatasını kapsamalıdır. Yerel Android uygulamasının anlamsal parça tercihleri kendi ayrı deposunda uygulanır ve bu klasik kontrollerden bağımsızdır.

<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# मैन्युअल XMLTV बाइंडिंग और कीबोर्ड अभिगम्यता

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[गाइड की संरचना](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## प्लेलिस्ट बदले बिना किसी चैनल की गाइड ठीक करें

प्रभावित M3U चैनल चलाएँ, **जानकारी → EPG** खोलें, फिर EPG स्रोत URL और **XMLTV ID** बदलें। XMLTV फ़ाइल के `<channel id="…">` में दिया सटीक ID डालें, उसका प्रदर्शन नाम नहीं। बाइंडिंग सहेजने और प्लेलिस्ट दोबारा लोड करने के लिए **सेट करें** चुनें। **स्वचालित** इस चैनल का ओवरराइड हटाता है और प्लेलिस्ट की मूल मैपिंग दोबारा लोड करता है। केवल तीर कुंजियों से चलने पर बाइंडिंग सहेजी या रीसेट नहीं होती। वापस जाने से सहेजी बाइंडिंग नहीं बदलती।

यह संपादक होस्ट किए गए ब्राउज़र डिप्लॉयमेंट और नेटिव XMLTV शेल (Tauri और Capacitor) में उपलब्ध है। यह प्रदाता-नियंत्रित गाइड, स्पष्ट `=source` JSON एंडपॉइंट या बाहरी कम्पैनियन सर्वर को ओवरराइड नहीं करता। दूरस्थ कम्पैनियन इस्तेमाल करने वाला सामान्य पुराना ब्राउज़र अपना मौजूदा मिलान प्रोटोकॉल बनाए रखता है। पहला संस्करण सटीक ID स्वीकार करता है; वह सभी XMLTV चैनलों की खोजने योग्य सूची डाउनलोड या प्रदर्शित नहीं करता।

![मैन्युअल बाइंडिंग प्लेलिस्ट स्रोत और स्थिर चैनल को एक XMLTV फ़ीड तथा सटीक ID से जोड़ती है; अन्यथा सामान्य मिलान चालू रहता है।](images/guide-binding.svg)

बाइंडिंग में प्लेलिस्ट स्रोत का फ़िंगरप्रिंट, स्थिर चैनल कुंजी, स्पष्ट फ़ीड URL और XMLTV ID संग्रहीत होते हैं। चैनल की पहचान समान रहने पर प्रदर्शन लेबल या पंक्तियों का क्रम बदलने से बाइंडिंग नहीं बदलती। प्लेलिस्ट URL/खाता बदलने से स्रोत का नेमस्पेस बदलता है। `itemId` के बिना पुराने M3U आइटम में मौजूदा URL-आधारित चैनल ID इस्तेमाल होता है; वह URL बदलने से उसकी पहचान बदलती है।

चुने गए चैनल का प्रदर्शन नाम और प्लेबैक URL बना रहता है। गाइड खोज केवल एक स्पष्ट फ़ीड इस्तेमाल करती है और नाम के आधार पर फ़ॉलबैक नहीं करती, इसलिए ID न मिलने पर चुपचाप दूसरे चैनल का कार्यक्रम नहीं लिया जाता। चैनल के नाम से अनुमानित स्वचालित क्षेत्रीय समय-अंतर इस सटीक बाइंडिंग पर लागू नहीं होते; प्लेलिस्ट में स्पष्ट रूप से दिया `tvg-shift` फिर भी लागू होता है। सही क्षेत्रीय XMLTV ID सेट करें। यदि CORS या मिश्रित सामग्री के नियमों के कारण कस्टम HTTPS-होस्टेड फ़ीड पढ़ी नहीं जा सकती, तो सामान्य EPG निदान उस विफलता की सूचना देता है।

स्थानीय रिकॉर्ड प्रति स्रोत 500 बाइंडिंग और 512 KiB तक सीमित है; प्लेलिस्ट लोड होने पर इसे एक बार पार्स किया जाता है, हर चैनल के लिए नहीं। लिखते समय पुराने मान की तुलना की जाती है और दोबारा लोड करने से पहले सहेजे गए परिणाम को पढ़कर जाँचा जाता है। देर से आया संपादक कॉलबैक बदले हुए स्रोत में सहेज नहीं सकता। यह स्थानीय प्राथमिकता है, अलग-अलग उपकरणों के बीच सिंक्रोनाइज़ेशन नहीं। फ़ीड URL में क्रेडेंशियल हो सकते हैं; स्टोरेज एक्सपोर्ट सार्वजनिक रूप से साझा न करें।

<a id="accessible-classic-controls"></a>

## सुलभ क्लासिक नियंत्रण

- वर्चुअलाइज़्ड मुख्य सूची नामयुक्त लिस्टबॉक्स, चुना विकल्प, कुल आइटम संख्या और आइटम की निरपेक्ष स्थिति बताती है। केवल चुनी हुई दृश्य पंक्ति Tab स्टॉप होती है। तीर कुंजियों से नेविगेशन दृश्य चयन और अर्थगत स्थिति दोनों बदलता है; सूची पर पहले से फ़ोकस हो तो पृष्ठ बदलने पर फ़ोकस उसी सूची के साथ रहता है।
- मानक जानकारी/पुष्टि संवाद, संपादक और परिचय पैनल मोडल भूमिकाएँ और स्थानीयकृत नाम उपलब्ध कराते हैं। Tab और Shift+Tab अग्रभूमि मोडल के भीतर घूमते हैं। नेस्टेड मोडल बंद करने पर अभी भी दिख रहे पैरेंट नियंत्रण पर फ़ोकस लौटता है; पुराने निर्धारित ओपन अनुरोध बंद किए जाने के बाद फ़ोकस नहीं छीन सकते।
- जानकारी और पुष्टि संदेश अपने संवादों का वर्णन करते हैं। अस्थायी सूचनाएँ विनम्र घोषणा वाले स्टेटस क्षेत्र का उपयोग करती हैं।
- सभी नए लेबल मौजूदा अनुवाद कैटलॉग से आते हैं। XMLTV और ID प्रोटोकॉल पहचानकर्ता हैं; चैनल नाम और फ़ीड होस्टनाम स्रोत मेटाडेटा ही रहते हैं।

ऐप अपने रिमोट-कंट्रोल मार्ग और ES5 सिंटैक्स बनाए रखता है। अर्थगत DOM जाँच पूर्ण WCAG प्रमाणन नहीं है: उपकरण-विशिष्ट फ़ोकस, VoiceOver/TalkBack वाणी और टीवी ब्राउज़र व्यवहार के लिए अभी भी वास्तविक उपकरणों पर परीक्षण आवश्यक है।

<a id="verification"></a>

## सत्यापन

चलाएँ:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

एकीकृत शाखा पर सामान्य बिल्ड, ES5 और बंडल-आकार की जाँच भी चलाएँ। ब्राउज़र जाँच में पृष्ठ-सीमाओं को पार करती लंबी सूची; नेस्टेड पुष्टि; संपादन के दौरान स्रोत बदलना; सही, गुम और हटाई गई बाइंडिंग; तथा EPG डाउनलोड विफलता शामिल हों। नेटिव Android ऐप की अर्थगत ट्रैक प्राथमिकताएँ उसके अलग रिपॉज़िटरी में लागू हैं और इन क्लासिक नियंत्रणों से स्वतंत्र हैं।

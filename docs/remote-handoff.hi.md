<a id="explicit-playback-handoff"></a>

# स्पष्ट प्लेबैक हस्तांतरण

<!-- language-navigation:start -->
<p dir="ltr">
<a href="remote-handoff.md" lang="en" dir="ltr">English</a> · <a href="remote-handoff.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="remote-handoff.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="remote-handoff.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="remote-handoff.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="remote-handoff.es.md" lang="es" dir="ltr">Español</a> · <a href="remote-handoff.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="remote-handoff.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="remote-handoff.he.md" lang="he" dir="rtl">עברית</a> · <a href="remote-handoff.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="remote-handoff.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="remote-handoff.it.md" lang="it" dir="ltr">Italiano</a> · <a href="remote-handoff.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="remote-handoff.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="remote-handoff.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="remote-handoff.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="remote-handoff.pt.md" lang="pt" dir="ltr">Português</a> · <a href="remote-handoff.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="remote-handoff.th.md" lang="th" dir="ltr">ไทย</a> · <a href="remote-handoff.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="remote-handoff.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="remote-handoff.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="remote-handoff.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="remote-handoff.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[सुधार](roadmap-delivery.hi.md)

अपडेट किए गए प्लेयर और नियंत्रण CLI के साथ `ott handoff SOURCE TARGET` चलाएँ। स्रोत पर प्लेबैक जारी रहता है। लक्ष्य पर वही स्रोत/खाता कॉन्फ़िगर होना चाहिए और चैनल की ID अद्वितीय तथा स्थिर होनी चाहिए। चैनल संदर्भ संस्करण वाले स्थानीय फ़िंगरप्रिंट हैं, प्रदाता के आइटम की कच्ची ID कभी नहीं। क्लासिक M3U पंक्तियाँ स्ट्रीम के सटीक URL का उपयोग केवल स्थानीय हैश के इनपुट के रूप में करती हैं। इसलिए अलग-अलग हस्ताक्षरित या दोबारा लिखे गए URL सुरक्षा के लिए मेल नहीं खाते। नामों का अनुमानित मिलान नहीं होता और न ही क्रेडेंशियल या चलाए जा सकने वाले URL भेजे जाते हैं। संस्करण 1 M3U, Xtream और Stalker के लिए लाइव/आर्काइव का समर्थन करता है; VOD/सीरीज़ और देखने के इतिहास का निरंतर सिंक्रनाइज़ेशन समर्थित नहीं है।

`playback_handoff_export` खाली पैरामीटर स्वीकार करता है और `data.handoff` लौटाता है:

```json
{"version":1,"provider":"m3u","source_id":"opaque-source-id","item_id":"channel-v1:01234567.89abcdef","kind":"live"}
```

आर्काइव संदर्भ `kind: "archive"` और पूर्णांक `archive_start` (Unix सेकंड में वर्तमान प्लेबैक बिंदु) का उपयोग करते हैं। `playback_handoff_import` केवल `{"handoff": ...}` स्वीकार करता है। कमांड भेजने से पहले लक्ष्य कैटलॉग की पहचान, आर्काइव की उपलब्धता, अभिभावकीय/कियोस्क नीतियों और वर्तमान नियंत्रण स्वामित्व की जाँच करता है। वह अपने प्रदाता के माध्यम से स्ट्रीम ढूँढता है। स्वीकार किया गया इंपोर्ट `{"status":"ok","data":{"dispatched":true,"kind":"live"}}` लौटाता है। कमांड भेजना वीडियो डिकोड होने या HDMI की आवाज़ सुनाई देने की पुष्टि नहीं है।

अस्वीकृति में केवल त्रुटि कोड दिखता है: `unsupported`, `invalid_request`, `no_current_item`, `source_mismatch`, `item_unavailable`, `ambiguous_item`, `policy_denied`, `busy`, `playback_failed`, `context_changed`। संदर्भों की सीमाएँ हैं; प्राप्तकर्ता अतिरिक्त फ़ील्ड अस्वीकार करता है। एक्सपोर्ट/इंपोर्ट के लिए सीमित दायरे वाली ऑपरेटर अनुमतियाँ प्रयोग करें और नियंत्रक कनेक्शन सुरक्षित रखें। स्रोत की पहचान मिलान के लिए एक अपारदर्शी कुंजी है, हस्तांतरणीय एक्सेस क्रेडेंशियल नहीं।

`node tests/test_remote_handoff.cjs` चलाएँ। प्रमाणीकरण, परिणाम और कमांड TTL के व्यवहार के लिए [नियंत्रण मार्गदर्शिका](https://github.com/open-ott-play/ottplay-control-server/blob/main/docs/reliable-control.md) देखें।

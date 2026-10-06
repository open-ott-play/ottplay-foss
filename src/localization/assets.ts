/**
 * Persisted language identifiers and their selector labels. The leading English
 * language name is also the lowercase asset basename; validate this contract in
 * localization-catalog.cjs before packaging. Keep IDs, labels and order stable.
 */
export var languageNames: { [code: string]: string } = {
    _ara: "Arabic - العربية",
    _arm: "Armenian - Հայերեն",
    _aze: "Azerbaijani - Azərbaycanca",
    _bel: "Belarusian - Беларуская",
    _ben: "Bengali - বাংলা",
    _bul: "Bulgarian - Български",
    _bur: "Burmese - မြန်မာ",
    _chi: "Chinese - 简体中文",
    _cze: "Czech - Čeština",
    _dan: "Danish - Dansk",
    _dut: "Dutch - Nederlands",
    _eng: "English",
    _est: "Estonian - Eesti",
    _fil: "Filipino",
    _fin: "Finnish - Suomi",
    _fra: "French - Français",
    _ger: "German - Deutsch",
    _gre: "Greek - Ελληνικά",
    _guj: "Gujarati - ગુજરાતી",
    _heb: "Hebrew - עברית",
    _hin: "Hindi - हिन्दी",
    _hrv: "Croatian - Hrvatski",
    _hun: "Hungarian - Magyar",
    _ind: "Indonesian - Bahasa Indonesia",
    _ita: "Italian - Italiano",
    _jpn: "Japanese - 日本語",
    _kan: "Kannada - ಕನ್ನಡ",
    _kaz: "Kazakh - Қазақша",
    _khm: "Khmer - ខ្មែរ",
    _kor: "Korean - 한국어",
    _lat: "Latvian - Latviski",
    _lit: "Lithuanian - Lietuvių",
    _mal: "Malayalam - മലയാളം",
    _mar: "Marathi - मराठी",
    _may: "Malay - Bahasa Melayu",
    _nep: "Nepali - नेपाली",
    _nor: "Norwegian - Norsk bokmål",
    _pan: "Punjabi - ਪੰਜਾਬੀ",
    _per: "Persian - فارسی",
    _pol: "Polish - Polski",
    _por: "Portuguese - Português",
    _rou: "Romanian - Română",
    _rus: "Russian - Русский",
    _sin: "Sinhala - සිංහල",
    _slo: "Slovak - Slovenčina",
    _slv: "Slovenian - Slovenščina",
    _spa: "Spanish - Español",
    _srp: "Serbian - Српски",
    _swa: "Swahili - Kiswahili",
    _swe: "Swedish - Svenska",
    _tam: "Tamil - தமிழ்",
    _tel: "Telugu - తెలుగు",
    _tha: "Thai - ไทย",
    _tur: "Turkish - Türkçe",
    _ukr: "Ukrainian - Українська",
    _urd: "Urdu - اردو",
    _uzb: "Uzbek - O'zbekcha",
    _vie: "Vietnamese - Tiếng Việt",
};

/** Return the shipped language asset, falling back to English for unknown codes. */
export function languageAssetPath(code: string): string {
    var label = languageNames[code];
    return (
        "/locales/" +
        (typeof label === "string" ? label : "English")
            .split(" ")[0]
            .toLowerCase() +
        ".js"
    );
}

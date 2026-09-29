/**
 * Persisted language identifiers and their selector labels. The leading English
 * language name is also the lowercase asset basename; validate this contract in
 * localization-catalog.cjs before packaging. Keep IDs, labels and order stable.
 */
export var languageNames: { [code: string]: string } = {
    _arm: "Armenian - Հայերեն",
    _aze: "Azerbaijani - Azərbaycanca",
    _bel: "Belarusian - Беларуская",
    _bul: "Bulgarian - Български",
    _cze: "Czech - Čeština",
    _dut: "Dutch - Nederlands",
    _eng: "English",
    _fra: "French - Français",
    _ger: "German - Deutsch",
    _gre: "Greek - Ελληνικά",
    _heb: "Hebrew - עברית",
    _hun: "Hungarian - Magyar",
    _ind: "Indonesian - Bahasa Indonesia",
    _ita: "Italian - Italiano",
    _kaz: "Kazakh - Қазақша",
    _lat: "Latvian - Latviski",
    _lit: "Lithuanian - Lietuvių",
    _may: "Malay - Bahasa Melayu",
    _pol: "Polish - Polski",
    _por: "Portuguese - Português",
    _rou: "Romanian - Română",
    _rus: "Russian - Русский",
    _spa: "Spanish - Español",
    _swe: "Swedish - Svenska",
    _tur: "Turkish - Türkçe",
    _ukr: "Ukrainian - Українська",
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

# Interface languages and on-screen keyboard alphabets

## Translation catalog

`stbPlayer/_eng.js` is the canonical 616-key dictionary. The other 27 language
packs contain the same keys; `lang` and the historical `alhabet` spelling are
locale metadata. Existing language codes and the first 20 selector positions
are preserved. Translations were completed with AI assistance and checked for
key and formatting consistency; these checks do not replace native-speaker
editorial review.

`scripts/localization-catalog.cjs` derives keys from translation calls, settings
labels, menu definitions, provider schemas and shipped device/provider scripts.
`scripts/localization-dynamic.json` records the reviewed boundaries for dynamic
values such as provider names and EPG metadata. New unresolved expressions fail
the audit instead of silently becoming an untracked fallback. English remains
the readable fallback for runtime data that is not a fixed UI key.

Run `npm run test:localization` for key/placeholder/HTML/whitespace parity and
keyboard alphabet checks. `npm run check:bundle` repeats keyboard behavior
against the actual ES5 bundle and verifies that server, Tauri and Capacitor
packages retain every dictionary and the Unicode license. Browser tests in
`npm run test:native:ui` cover remote/pointer paging and layout across Classic,
PLi-HD and Studio, list densities 10/25/30, and 640×360 through 3840×2160.

## Alphabet contract and source

The versioned fixture in
[`tests/fixtures/locale-alphabets.json`](../tests/fixtures/locale-alphabets.json)
records the keyboard alphabet and required characters for every interface
language. Its source is **Unicode CLDR 48**, pinned to release commit
[`acd6d88ae493633240e19a87a721076a8a75c310`](https://github.com/unicode-org/cldr/tree/acd6d88ae493633240e19a87a721076a8a75c310).
Each entry links directly to that locale's original XML file and preserves its
main exemplar expression for review.

`alphabet` is the ordered lowercase string for the historical `alhabet`
translation key. `requiredCharacters` is an independent coverage set: every
character must be available through the localized lowercase/uppercase layouts
or the built-in Latin layout. It includes uppercase dotted `İ` where CLDR
explicitly requires it; that character belongs on the uppercase layout.
`requiredUppercase`, where present, records additional case-sensitive checks.
The English interface deliberately retains Russian as its secondary layout;
the built-in English layout already supplies `a` through `z`.

The contract covers CLDR's main exemplar for the selected writing system,
including precomposed accents, plus the explicit additions documented below.
CLDR's braces represent sequences such as Czech `ch`, Hungarian `dzs` and
Uzbek `oʻ`: users enter those with successive letter keys. Existing extra
letters are retained. The fixture is not a claim to support every historical
spelling, foreign proper name or auxiliary character in Unicode. The
[LDML character specification](https://www.unicode.org/reports/tr35/tr35-general.html#Character_Elements)
defines the distinction between main and auxiliary exemplars.

Specific additions and input details:

- Armenian includes the customary ligature `և`, present in CLDR's auxiliary
  exemplar. The canonical alphabet order is retained.
- Belarusian and Ukrainian include the modifier-letter apostrophe `ʼ`
  (U+02BC). ASCII `'` remains available in punctuation.
- Bulgarian includes the accented pronoun `ѝ` from the auxiliary exemplar.
- German includes `ä` and `ß`; Hebrew includes all five final letters
  `ך ם ן ף ץ`; Portuguese includes `ò`.
- Greek includes final sigma and every modern accent/diaeresis combination
  in its main exemplar.
- Uzbek distinguishes `ʻ` (U+02BB) in `oʻ` and `gʻ` from `ʼ` (U+02BC), and
  provides `c` so `ch` can be entered without switching layouts.
- Dutch includes U+0301 COMBINING ACUTE ACCENT to enter `íj́`: Unicode has no
  precomposed accented `j`. The keyboard label can show a dotted circle as a
  visual aid, while the inserted text must contain only the combining mark.
- Vietnamese includes all 89 main-exemplar characters, including every
  precomposed tone-marked vowel and `đ`. The Latin layout supplies the auxiliary
  `f`, `j`, `w` and `z` used in foreign words.

## Case changes must preserve key identity

Always derive a case change from the unchanged lowercase alphabet. Do not
recreate lowercase keys by lowercasing the uppercase output. Unicode case
mapping can expand one key into several code points or map several distinct
keys to the same uppercase text:

- German `ß` normally uppercases to `SS`.
- Armenian `և` uppercases to `ԵՒ`.
- Greek `ΐ` and `ΰ` uppercase to a capital vowel plus combining marks; both
  `σ` and `ς` uppercase to `Σ`.
- Turkish and Azerbaijani require the two distinct pairs `i`/`İ` and `ı`/`I`.

A key may insert a multi-codepoint string without changing the number or
identity of keys. Returning to lowercase must recover exactly the original
alphabet. These rules follow the
[Unicode 17 special-casing data](https://www.unicode.org/Public/17.0.0/ucd/SpecialCasing.txt);
locale-sensitive Turkish/Azerbaijani casing is necessary even when the browser's
ambient locale is English.

The keyboard offers `ẞ` on the uppercase German layout. Long alphabets use
pages of at most 40 letter cells, plus digit and control rows. The previously
unused control cell now shows a page counter and advances to the next page;
the final page wraps to the first. Both cell width and available panel height
constrain the rendered keys. The input preview scrolls to its caret without
changing stored font or list-density preferences.

## Additional interface languages

The new entries are appended after the existing languages: Indonesian,
Vietnamese, Malay, Dutch, Czech, Swedish, Azerbaijani and Kazakh. Existing
language positions remain stable. Malay uses Latin Rumi, Azerbaijani uses Latin,
and Kazakh uses Cyrillic, matching the selected CLDR main exemplars. These
choices do not claim support for Malay Jawi or an alternative Kazakh script.

The countries are sizeable enough to make these useful additions, with 2024
populations of approximately 283.5 million (Indonesia), 101.0 million
(Viet Nam), 35.6 million (Malaysia), 18.0 million (Netherlands), 10.9 million
(Czechia), 10.6 million (Sweden), 10.2 million (Azerbaijan), and 20.6 million
(Kazakhstan). These are country populations, not counts of speakers or users.
The source is the World Bank population indicator `SP.POP.TOTL`, queried on
2026-09-26: [Indonesia](https://api.worldbank.org/v2/country/ID/indicator/SP.POP.TOTL?date=2024&format=json),
[Viet Nam](https://api.worldbank.org/v2/country/VN/indicator/SP.POP.TOTL?date=2024&format=json),
[Malaysia](https://api.worldbank.org/v2/country/MY/indicator/SP.POP.TOTL?date=2024&format=json),
[Netherlands](https://api.worldbank.org/v2/country/NL/indicator/SP.POP.TOTL?date=2024&format=json),
[Czechia](https://api.worldbank.org/v2/country/CZ/indicator/SP.POP.TOTL?date=2024&format=json),
[Sweden](https://api.worldbank.org/v2/country/SE/indicator/SP.POP.TOTL?date=2024&format=json),
[Azerbaijan](https://api.worldbank.org/v2/country/AZ/indicator/SP.POP.TOTL?date=2024&format=json),
and [Kazakhstan](https://api.worldbank.org/v2/country/KZ/indicator/SP.POP.TOTL?date=2024&format=json).

## Unicode attribution

Alphabet coverage data is derived from Unicode CLDR 48.
Copyright © 1991–2025 Unicode, Inc. The upstream license also carries
Copyright © 2004–2025 Unicode, Inc. The complete, unchanged
[Unicode License V3](../js/licenses/Unicode-3.0.txt) accompanies the fixture and
alphabet data. SPDX identifier: `Unicode-3.0`.

The upstream data remains under its own license; the project's MIT license does
not replace that notice. Unicode provides character data, not an endorsement of
OTTplay FOSS or a review of its translations.

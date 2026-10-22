<a id="measured-javascript-cost"></a>

# Změřené náklady JavaScriptu

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Průvodce funkcemi](roadmap-delivery.cs.md) · [Surové podklady](evidence/roadmap-size-20261015.json)

![Srovnání veškerého JavaScriptu přehrávače se stejnou sadou nástrojů](diagrams/roadmap-size.svg)

Tato stránka uchovává měření JavaScriptu z níže uvedených snímků zdrojového kódu. Neměří aktuální revizi, instalační balíčky ani síťový provoz.

V počátečním srovnání narostl hlavní vstup spolu se všemi volitelnými rodinami poskytovatelů o **31 128 nekomprimovaných bajtů / 9 759 bajtů gzip**, tedy asi **3.23% / 3.20%**. Jde o náklady přidaných funkcí, nikoli o tvrzení o zmenšení nebo zrychlení běhu. Xtream se nadále načítá až na požádání; jeho přesun mimo vstup jej neodstraňuje z celkového součtu.

Měření porovnává čisté zdrojové archivy `bbf9ca7b` a `cae971da`, oba ve verzi 1.1.55, s Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 a zlib 1.2.12. Používá produkční sestavovač ES5, optimalizátor, pravidla pojmenování a správnou identitu čistých zdrojů. Gzip úrovně 9 se aplikuje samostatně na každý vytvořený soubor.

- Webový vstup: 848 092 / 262 392 → 874 926 / 270 321 nekomprimovaných/gzip bajtů.
- Webový vstup + všichni poskytovatelé: 964 459 / 305 344 → 995 587 / 315 103.
- Nativní vstup: 848 050 / 262 460 → 874 884 / 270 372.
- Nativní vstup + všichni poskytovatelé: 964 417 / 305 412 → 995 545 / 315 154.
- Volitelné M3U narůstá o 184 nekomprimovaných / 82 gzip bajtů; nové Xtream má 4 110 / 1 748. Ostatních šest volitelných rodin je bajtově shodných.

Před přesunem klipu na here.now přidala změna jeho URL na místní cestu od kořene v této historické posloupnosti jeden nekomprimovaný bajt JavaScriptu. Nejde o měření pozdější hostované URL. Oprava omezených opakovaných pokusů o parsování HLS přidává v izolovaném porovnání stejného snímku 37 nekomprimovaných / 36 gzip bajtů ([podklady](evidence/parse-recovery-size-20261015.json)). Oprava vlastnictví nativního předání Auto přidává dalších 101 nekomprimovaných / 39 gzip bajtů ([podklady](evidence/auto-recovery-size-20261015.json)). Výsledný nekomprimovaný součet před opravami regresí přístupnosti je 995 726 bajtů; identita sestavení a počet gzip bajtů se mohou v konečném commitu změnit. Pro přesnou dodanou revizi zůstávají směrodatné konečný `build/reports/classic-bundle.json` a `npm run check:size`. Následující čisté sestavení `652726f8` včetně oprav fokusu ukazatele a dialogů měří **995 858 nekomprimovaných / 315 207 gzip bajtů** pro celý webový přehrávač ([podklady konečného artefaktu](evidence/roadmap-final-size-20261015.json)). Vstup má 875 197 / 270 425; nativní součty jsou 995 816 / 315 259. Limity tohoto snímku zachovaly předchozí rezervu pro nativní prostředí/Node/příponu vydání: 875 300 nekomprimovaných / 271 600 gzip pro vstup; 996 100 / 316 400 pro vstup + poskytovatele.

<a id="post-beta-integration"></a>

## Integrace po betě

![Úplný JavaScript po integraci beta.4](diagrams/post-beta-size.svg)

Pozdější srovnání reprodukuje zdroje beta.4 `39287792` vůči runtime `9663b681`, včetně integrace Plex a obnovy poškozených nastavení, se stejnými Node 26.8.2, Rollup 4.64.5 a Terser 5.51.2:

- Webový vstup: 848 315 / 262 443 → 879 533 / 271 761 nekomprimovaných/gzip bajtů.
- Webový vstup + všichni poskytovatelé: 964 876 / 305 452 → 1 000 388 / 316 600.
- Nativní vstup + všichni poskytovatelé: 964 834 / 305 520 → 1 000 346 / 316 654.
- Nárůst celého webového obsahu: **35 512 / 11 148 bajtů (3.68% / 3.65%)**.

Základ počítá sedm rodin poskytovatelů; integrace osm včetně líně načítaného Xtream. Limity vstupu tohoto snímku byly 879 900 / 273 000; celkové limity 1 000 800 / 317 800, s rezervou pro nativní prostředí, Node a identitu vydání. Obě místní produkční sestavení znovu generují pět verzovaných runtime souborů a vynechávají tvrzení o revizi čistých zdrojů. Jde o místně reprodukované artefakty, nikoli publikované beta binární soubory. Verze nástrojů, hashe a toto omezení jsou v [podkladech základu](evidence/post-beta-baseline-size-20261015.json) a [integrace](evidence/post-beta-candidate-size-20261015.json). [Zpráva o implementaci](implementation-report.cs.md#post-beta-integration-and-review) vysvětluje opravy a ověření.

**Rozsah:** tyto součty JavaScriptu nezahrnují externí mediální enginy, jazykové slovníky, CSS, obrázky ani video. Historické balíčky přehrávače obsahovaly také **A/V klip o 464 652 bajtech**, který není v součtech výše. Jeho dnešní distribuce je od těchto měření oddělena:

- **Repozitář:** `diagnostics/av-v1.mp4` zůstává s generátorem a ověřovačem kvůli reprodukovatelnosti. Uchování zdrojového souboru jej nezařazuje do balíčku.
- **Balíčky:** Web/OTTPlay Server, Tauri, Capacitor a Docker klip vynechávají. Odstraňuje to 464 652 nekomprimovaných mediálních bajtů, nikoli změřené zmenšení komprimovaného instalátoru o 464 652 bajtů. Formát archivu a další změny sestavení velikost ovlivňují.
- **Síť:** přehrávač načte klip z here.now jen při spuštění [A/V kontroly](audio-video-check.cs.md) uživatelem. Kontrola vyžaduje internet; klip se nenačítá pro přehrávání při startu.

Historická měření JavaScriptu výše zůstávají beze změny. Vliv hostované URL na JavaScript či aktuální instalátor vyžaduje nové srovnání. 88 lokalizovaných README jsou dokumentací repozitáře, nikoli obsahem přehrávače. Z tohoto bajtového srovnání neplyne nic o době startu, snímkové frekvenci, paměti ani výkonu při velkých katalozích. To vyžaduje samostatná měření na cílových zařízeních.

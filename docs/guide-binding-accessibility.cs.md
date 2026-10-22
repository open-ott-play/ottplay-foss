<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Ruční přiřazení XMLTV a přístupnost klávesnicí

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Architektura programového průvodce](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Oprava průvodce kanálu bez úpravy playlistu

Přehrajte dotčený kanál M3U, otevřete **Information → EPG** a upravte URL zdroje EPG a **XMLTV ID**. Zadejte přesné ID z `<channel id="…">` souboru XMLTV, nikoli zobrazovaný název. Volba **Set** uloží přiřazení a znovu načte playlist. **Automatic** odstraní přepsání tohoto kanálu a načte původní mapování playlistu. Samotný pohyb šipkami nikdy přiřazení neuloží ani neresetuje. Zpět ponechá uložené přiřazení beze změny.

Editor je dostupný v hostovaném prohlížečovém nasazení a nativních XMLTV prostředích (Tauri a Capacitor). Nepřepisuje průvodce poskytovatele, explicitní JSON endpointy `=source` ani externí doprovodné servery. Běžný starší prohlížeč používající vzdálený doprovodný server zachovává svůj dosavadní protokol párování. První verze přijímá přesné ID; nestahuje ani nezobrazuje prohledávatelný seznam všech XMLTV kanálů.

![Ruční přiřazení spojuje zdroj playlistu a stabilní kanál s jedním XMLTV zdrojem a přesným ID; jinak zůstává aktivní běžné párování.](images/guide-binding.svg)

Přiřazení ukládá otisk zdroje playlistu, stabilní klíč kanálu, explicitní URL zdroje a XMLTV ID. Přejmenování zobrazovaného popisku nebo změna pořadí řádků přiřazení nezmění, zůstane-li identita kanálu stejná. Výměna URL/účtu playlistu mění jmenný prostor zdroje. U starších M3U položek bez `itemId` se používá stávající ID kanálu odvozené z URL; změna této URL změní identitu.

Vybraný kanál si ponechá zobrazovaný název a URL přehrávání. Hledání průvodce používá jediný explicitní zdroj bez náhradního hledání podle názvu, takže chybějící ID nepřevezme potichu program jiného kanálu. Automatické regionální posuny odvozené z názvu kanálu se na toto přesné přiřazení nevztahují; explicitní `tvg-shift` playlistu zůstává platné. Nastavte správné regionální XMLTV ID. Pokud vlastní HTTPS zdroj nelze číst kvůli CORS nebo pravidlům smíšeného obsahu, běžná diagnostika EPG ohlásí chybu.

Místní záznam je omezen na 500 přiřazení a 512 KiB na zdroj; zpracuje se jednou při načtení playlistu, nikoli pro každý kanál. Zápisy porovnají původní hodnotu a před opětovným načtením přečtou uložený výsledek. Pozdní callback editoru nemůže uložit data do nahrazeného zdroje. Jde o místní předvolbu, ne synchronizaci mezi zařízeními. URL zdrojů mohou obsahovat přihlašovací údaje; nezveřejňujte exporty úložiště.

<a id="accessible-classic-controls"></a>

## Přístupné klasické ovládací prvky

- Virtualizovaný hlavní seznam zpřístupňuje pojmenovaný listbox, vybranou možnost, celkový počet položek a absolutní pozici položky. Pouze vybraný viditelný řádek je zastávkou klávesy Tab. Navigace šipkami aktualizuje vizuální výběr i sémantický stav; při výměně stránky fokus sleduje již zaměřený seznam.
- Standardní informační/potvrzovací dialogy, editor a panely About poskytují modální role a lokalizované názvy. Tab a Shift+Tab cyklují uvnitř modálního okna v popředí. Zavření vnořeného okna obnoví stále viditelný rodičovský ovládací prvek; zastaralá naplánovaná otevření po zavření nemohou ukrást fokus.
- Informační a potvrzovací zprávy popisují své dialogy. Dočasná oznámení používají stavovou oblast s nevtíravým oznamováním.
- Stávající překladové katalogy dodávají všechny nové popisky. XMLTV a ID jsou identifikátory protokolu; názvy kanálů a hostitelů zdrojů zůstávají metadaty zdroje.

Aplikace zachovává cesty dálkového ovládání a syntaxi ES5. Sémantické kontroly DOM nepředstavují úplnou certifikaci WCAG: fokus specifický pro zařízení, řeč VoiceOver/TalkBack a chování TV prohlížečů stále vyžadují fyzické testy.

<a id="verification"></a>

## Ověření

Spusťte:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Na integrované větvi spusťte také běžné kontroly sestavení/ES5/velikosti balíčku. Prohlížečové kontroly mají zahrnout dlouhý seznam přes hranice stránek, vnořené potvrzení, výměnu zdroje během úprav, správné, chybějící a odstraněné přiřazení a chybu stahování EPG. Sémantické předvolby stop nativní aplikace Android jsou implementovány v jejím samostatném repozitáři a jsou nezávislé na těchto klasických ovládacích prvcích.

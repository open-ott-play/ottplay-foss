<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Handmatige XMLTV-koppeling en toetsenbordtoegankelijkheid

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Architectuur van de programmagids](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## De gids van een kanaal herstellen zonder de afspeellijst te bewerken

Speel het betreffende M3U-kanaal af, open **Information → EPG** en bewerk de EPG-bron-URL en de **XMLTV ID**. Voer de exacte ID uit `<channel id="…">` in het XMLTV-bestand in, niet de zichtbare naam. Kies **Set** om de koppeling op te slaan en de afspeellijst opnieuw te laden. **Automatic** verwijdert de overschrijving van dit kanaal en laadt de oorspronkelijke lijstkoppeling opnieuw. Alleen bewegen met pijlen slaat nooit een koppeling op en wist die ook niet. Terug laat de opgeslagen koppeling ongewijzigd.

Deze editor is beschikbaar in de gehoste browseruitvoering en native XMLTV-omgevingen (Tauri en Capacitor). Hij overschrijft geen providergidsen, expliciete `=source`-JSON-eindpunten of externe begeleidende servers. Een gewone oudere browser die een externe begeleidende server gebruikt, behoudt zijn bestaande koppelingsprotocol. De eerste versie accepteert een exacte ID; er wordt geen doorzoekbare lijst van alle XMLTV-kanalen gedownload of getoond.

![Een handmatige koppeling verbindt de lijstbron en het stabiele kanaal met één XMLTV-feed en exacte ID; anders blijft normale koppeling actief.](images/guide-binding.svg)

Een koppeling bewaart de vingerafdruk van de lijstbron, de stabiele kanaalsleutel, de expliciete feed-URL en XMLTV-ID. De zichtbare naam of rijvolgorde wijzigen verandert de koppeling niet zolang de kanaalidentiteit gelijk blijft. Vervanging van lijst-URL/account verandert de bronnaamruimte. Voor oude M3U-items zonder `itemId` wordt de bestaande, van de URL afgeleide kanaal-ID gebruikt; die URL veranderen verandert de identiteit.

Het gekozen kanaal behoudt zijn zichtbare naam en afspeel-URL. De gidszoekactie gebruikt één expliciete feed zonder terugval op naam; een ontbrekende ID neemt dus niet stilzwijgend het programma van een ander kanaal over. Automatische regionale tijdverschuivingen op basis van de kanaalnaam gelden niet voor deze exacte koppeling; een expliciete `tvg-shift` van de lijst blijft gelden. Stel de juiste regionale XMLTV-ID in. Als een eigen HTTPS-feed door CORS of regels voor gemengde inhoud niet leesbaar is, meldt de gewone EPG-diagnose die fout.

Het lokale record is beperkt tot 500 koppelingen en 512 KiB per bron; het wordt eenmaal per lijstlading geparseerd, niet eenmaal per kanaal. Schrijfacties vergelijken de vorige waarde en lezen het opgeslagen resultaat terug voordat ze herladen. Een late editorcallback kan niet opslaan in een vervangende bron. Dit is een lokale voorkeur, geen synchronisatie tussen apparaten. Feed-URL's kunnen inloggegevens bevatten; deel opslagexports niet openbaar.

<a id="accessible-classic-controls"></a>

## Toegankelijke klassieke bediening

- De gevirtualiseerde hoofdlijst biedt een benoemde keuzelijst, de geselecteerde optie, het totale aantal items en de absolute itempositie. Alleen de geselecteerde zichtbare rij is een Tab-stop. Pijlnavigatie werkt de zichtbare selectie en semantische toestand bij; de focus volgt een al gefocuste lijst bij paginawisselingen.
- Gewone informatie-/bevestigingsdialogen, de editor en About-panelen bieden modale rollen en vertaalde namen. Tab en Shift+Tab doorlopen het voorste modale venster. Een genest venster sluiten herstelt een nog zichtbaar bovenliggend bedieningselement; verouderde geplande openingen kunnen na het sluiten geen focus stelen.
- Informatie- en bevestigingsmeldingen beschrijven hun dialogen. Tijdelijke berichten gebruiken een statusgebied met niet-opdringerige aankondigingen.
- Bestaande vertaalcatalogi leveren alle nieuwe labels. XMLTV en ID zijn protocolaanduidingen; kanaalnamen en feedhostnamen blijven bronmetadata.

De toepassing behoudt de afstandsbedieningsroutes en ES5-syntaxis. Semantische DOM-controles vormen geen volledige WCAG-certificering: apparaatspecifieke focus, VoiceOver-/TalkBack-spraak en TV-browsergedrag moeten nog op echte apparaten worden getest.

<a id="verification"></a>

## Verificatie

Voer uit:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Voer ook de gewone build-/ES5-/bundelgroottecontroles uit op de geïntegreerde branch. Browsercontroles moeten een lange lijst over paginagrenzen, een geneste bevestiging, bronvervanging tijdens bewerken, een correcte, ontbrekende en verwijderde koppeling en een mislukte EPG-download omvatten. De semantische trackvoorkeuren van de native Android-app zijn geïmplementeerd in haar eigen repository en staan los van deze klassieke bediening.

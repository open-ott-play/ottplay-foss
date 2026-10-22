# Van functielijst naar geverifieerd gedrag

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Functiecontracten](roadmap-delivery.nl.md) · [Bewijs van omvang](roadmap-size.nl.md)

Dit rapport beschrijft de implementatie en versteviging, geen releaseaankondiging. De gemeten playersnapshot is `652726f8`; de afzonderlijk gebouwde native Android-snapshot is `be0d800`. CI, samenvoegen en releasepromotie blijven afzonderlijke controles. Latere commits met alleen documentatie of tests maken van een lokale controle geen bewijs dat een geïnstalleerd apparaat is bijgewerkt. De onderstaande controlestatussen horen bij die historische snapshots; dit is geen actuele releasetracker. Gepubliceerde builds staan onder [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases).

![Implementatieproces en acceptatiecontroles](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Hoe het werk is gecontroleerd

Het oorspronkelijke verzoek is verdeeld in 13 bruikbare functieonderdelen voor de klassieke player, de besturingsdienst/CLI en de onafhankelijke native Android-applicatie. Verantwoordelijkheden werden per component toegewezen, zodat gelijktijdige wijzigingen konden worden beoordeeld en geïntegreerd zonder het werk van een ander component te vervangen. De nieuwe interface hergebruikte bestaande vertaalde labels of voegde catalogusitems toe voor alle 88 talen; volledige technische handleidingen waren oorspronkelijk in het Engels en Russisch geschreven. De hoofdhandleiding en gekoppelde functiehandleidingen hebben nu volledige edities in [24 documentatietalen](manual-translations.md).

Na de implementatie volgden onafhankelijke kruisbeoordeling en uitvoerbare regressietests. Een gemeld probleem werd vóór een codewijziging getoetst aan het werkelijke callback-, decoder-, opslag- of focuspad. Testfouten werden onderscheiden in gedragsregressies en verouderde testselectors. Het wijzigen van klassieke rijen van `button` naar `option` vereiste bijvoorbeeld bijgewerkte selectors; het rechtvaardigde geen afzwakking van het verwachte klikgedrag.

Schone productiebuilds controleerden vervolgens de uitgegeven ES5-artefacten en de volledige JavaScript-omvang, inclusief optionele providermodules. Gerichte browsertests gebruikten de meegeleverde loader, bundle en apparaatadapters. Native Android kreeg een afzonderlijke uitvoering van Gradle-tests, lint en pakketbouw. PR-controles en reviewgesprekken worden na het pushen opnieuw gecontroleerd; een geslaagde lokale build vervangt die niet.

<a id="what-changed-during-review"></a>

## Wat tijdens de beoordeling veranderde

![Vijf gecorrigeerde gedragingen en gemeten JavaScript-omvang](diagrams/implementation-results.svg)

- **HLS-parsing en herpogingen:** parsefouten deelden aanvankelijk de algemene netwerkclassificatie. Ze krijgen nu maximaal één herverbinding met dezelfde URL binnen het budget van twee tijdelijke herpogingen; nieuwe decoders en back-up-URL's resetten dat niet. Een terminale authenticatie-/DRM-fout annuleert ook een al ingeplande tijdelijke herpoging.
- **Native Auto-terugval:** native foutafhandeling kon het verzoek beëindigen terwijl Auto al eigenaar van een terugval was. De bestaande eigenaar behoudt nu die overgang; annulering maakt de vertraagde callbacks nog steeds ongeldig.
- **Enter in modale vensters:** automatisch focussen op de eerste knop Annuleren veranderde Enter in een Plex-wachtdialoog in annulering. Dialogen beginnen nu met focus op de dialoog zelf. Tab bereikt expliciet de knoppen; normale informatie- en bevestigingsdialogen behouden het gedrag van Enter en Escape/Terug.
- **Aanwijzerselectie op pc:** muisfocus wijzigde de selectie vóór de klikhandler, waardoor de eerste klik activeerde. Focus door de aanwijzer selecteert de rij niet meer vooraf. De pc selecteert nog steeds eerst en activeert daarna; LG behoudt gedrag met één klik. Toetsenbordfocus blijft de selectie volgen.
- **Android-tracks:** een ongelabelde selectie voor het huidige item kon worden gewist door de eigen Auto-bevestiging of een ondertitelvoorkeur, of doorlekken naar een ander item met dezelfde `TrackGroup`. Deze overleeft vertraagde schrijfacties nu alleen voor het huidige item. Semantische voorkeuren gebruiken taal/rol/label; het ViewModel beheert opslag, zodat het sluiten van het paneel de schrijfactie niet annuleert.

De 13 geleverde onderdelen zijn: A/V-voorbeeld; hervatbare Local/Home-configuratie; begrensd herstel; kwaliteitsplafonds; Android-trackvoorkeuren; besturingssleutels met bereik; XMLTV-koppelingen; Xtream-films/-series; klassieke toegankelijkheid; duurzame opdrachtresultaten; expliciete overdracht; back-upstreams; herstelbare instellingenbatches. De [functiehandleiding](roadmap-delivery.nl.md) definieert bereik en beperkingen van elk onderdeel.

<a id="evidence-and-remaining-gates"></a>

## Bewijs en resterende controles

Voor `652726f8` slaagden de vijf gerichte browserscenario's: LG-webOS-aanwijzernavigatie, LG-NetCast-aanwijzernavigatie, pc-gedrag met twee klikken, toetsenbordsemantiek van dialogen en Plex-verzameling/resolutie/annulering/herpoging. TypeScript, de toegankelijkheidsunitfixture, gerichte lint, ES5 en bundlebudgetcontroles slaagden. De volledige browseruitvoering op deze build eindigde met **194 geslaagde en één overgeslagen test**: native HLS vereist WebKit, terwijl deze uitvoering Chromium gebruikte. Gehoste CI en de afgesproken samenvoegvolgorde blijven aparte controles.

De resterende keten `test:port` en `test:unified` werd in hervatte segmenten afgerond na correctie van afzonderlijke testfixtures. Elk mislukt doel is succesvol opnieuw uitgevoerd en de resterende opdrachten slaagden; dit beweert niet dat één ononderbroken `npm test`-uitvoering plaatsvond. De exacte Android-bridge-CI-stap met negen opdrachten slaagde ook lokaal.

Voor Android `be0d800` slaagden lokaal **101 app-tests en 62 gedeelde-kerntests**, evenals debug/release-lint, Debug/Release/Full-APK-bouw, de releasebundle en het compileren van het androidTest-APK. Compilatie van het APK voor geïnstrumenteerde tests is geen uitvoering op een apparaat. De drie bevestigde reviewbevindingen zijn beantwoord en opgelost in [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68). Die PR slaagde voor de controles en is samengevoegd als `5b644b94`; CI na samenvoegen wordt apart gevolgd. Het diagram laat de algemene player-CI-/releasecontrole open.

Het volledige web-JavaScript-totaal veranderde van **964,459 / 305,344** bytes ruw/gzip naar **995,858 / 315,207**: **+31,399 / +9,863 bytes** (ongeveer 3.26% / 3.23%). De functiekandidaat was 995,587 / 315,103; verdere versteviging voegde 271 / 104 toe. Het uiteindelijke hoofdingangspunt van die snapshot is 875,197 / 270,425. Zie de [basismeting](evidence/roadmap-size-20261015.json), [meting van het definitieve artefact](evidence/roadmap-final-size-20261015.json) en [meetmethode](roadmap-size.nl.md). De komma's in deze byteaantallen scheiden duizendtallen.

Dit zijn historische JavaScript-bytekosten, **geen gemeten snelheidsverbeteringen**. De totalen sluiten media-engines, woordenboeken, CSS, afbeeldingen en video uit. De playerpakketten van die snapshot bevatten apart de A/V-clip van 464,652 bytes. Na de [hostingwijziging](audio-video-check.nl.md) blijft `diagnostics/av-v1.mp4` met generator en verifier in de repository voor reproduceerbaarheid, maar is het uitgesloten van Web/OTTPlay Server-, Tauri-, Capacitor- en Docker-pakketten. De player haalt het alleen van here.now voor de expliciete A/V-controle, waarvoor internet nodig is; afspelen bij opstarten haalt het niet op. Het verwijderen van 464,652 ruwe mediabytes bewijst geen besparing in gecomprimeerde installatiepakketten en verandert de historische JavaScript-metingen niet. Opstarttijd, frameregelmaat, geheugengebruik, schermlezerervaring, echte HDMI-audio en providergedrag vereisen eigen metingen op doelapparaten. Dit rapport claimt geen nieuw fysiek apparaatresultaat of bètarelease. De [fysieke acceptatielijst](roadmap-delivery.nl.md#physical-acceptance-before-promotion) en [releasestrategie](../RELEASING.md) blijven promotiecriteria.

<a id="post-beta-integration-and-review"></a>

## Integratie en beoordeling na de bèta

Na publicatie van beta.4 is bronversie `39287792` in deze branch geïntegreerd. Runtimerevisie `9663b681` herstelt ook terugkeer naar de liverand onder HLS-kwaliteitsgrenzen en maakt een beschadigd instellingenjournaal herstelbaar vóór normaal opstarten. Het herstelscherm blokkeert gedeeltelijke accounthydratatie, ondersteunt herpoging en bevestigde reset, bewaart niet-gerelateerde cookies en voorkomt terugkeer van oude cookie-instellingen na reset. Zie het [herstelproces](settings-recovery.nl.md) en het SVG-diagram.

![Volledige JavaScript-vergelijking na de bèta](diagrams/post-beta-size.svg)

Reproductie van beide bronnen met Node 26.8.2, Rollup 4.64.5 en Terser 5.51.2 geeft **964,876 / 305,452** bytes ruw/gzip voor de beta.4-bron en **1,000,388 / 316,600** voor de integratie: **+35,512 / +11,148 bytes** (3.68% / 3.65%). Deze totalen bevatten alle optionele providers: zeven in de basis en acht in de integratie. Het nieuwe ingangspunt is 879,533 / 271,761. Dit is een aparte vergelijking, los van de eerdere vastgelegde grafieken.

Beide lokale productiebuilds genereren vijf gevolgde runtimebestanden opnieuw en laten de claim van een schone bronrevisie weg. De rapporten vermelden die beperking in plaats van deze lokale bestanden aan te duiden als gepubliceerde releaseartefacten: [basis](evidence/post-beta-baseline-size-20261015.json) en [integratie](evidence/post-beta-candidate-size-20261015.json). Integratiebuild en ES5-/native controles slagen. Zes gerichte browsercontroles slagen ook: journaalherstel/reset, toetsenbordgedrag van dialogen, LG-webOS- en NetCast-aanwijzerinvoer, pc-selectie met twee klikken en de Plex-wachtstatus met eigenaar.

<a id="browser-gate-integration"></a>

## Integratie van de browsercontrole

![Bevestigde resultaten van lokale browserverificatie](diagrams/browser-verification-results.svg)

Bronversie `c52f4d07` neemt PR 779 uit main `1ecbc0e7` op. Testopdrachten, herstelcontroles en Plex-dialoogasserties van beide branches blijven behouden. TypeScript, lint, documentatie, pakket-/linkercontracten, productiebuild en volledige controles van gecompileerde bundles slagen. Alle 27 uitgegeven JavaScript-bestanden van player/providers blijven byte-identiek aan de hierboven gemeten artefacten. De volledige apparaat-browsersuite op die build eindigt met **196 geslaagde tests en één verwachte Chromium-overslag** voor native HLS, waarvoor WebKit nodig is.

Het exacte verpakte Mode A-archief werd pas uitgepakt na controle van bron, checksum en bundle-/providerinventaris. Chromium 156.0.8078.4, Firefox 157.0 en WebKit 27.2 slaagden elk voor alle vijf profielscenario's, zonder overslaan of herpogingen: **15 lokale successen** met Playwright 1.64.0. De werkelijke host was macOS 26.7.1, niet de runner `macos-15` genoemd in de gekozen profielen. De bewijzen leggen dit verschil expliciet vast en zijn **geen kwalificatie van gehoste matrix of release**. Zie de [lokale samenvatting](evidence/post779-local-acceptance/summary.json) en [reproductie-instructie](evidence/post779-local-acceptance/reproduce.sh), die een bestaande productiebuild verwacht en weigert een uitgepakte kandidaatmap te vervangen.

Het [browserbeleid](browser-compatibility.nl.md) vereist vijf gehoste doelen en 25 scenario-uitvoeringen voor PR-/bètacontroles; de volledige RC heeft 35 doelen en 166 uitvoeringen. Dit zijn ingestelde eisen, geen gemeten dekking.

![Hoe kandidaatverificatie bewijs oplevert](diagrams/candidate-verification-flow.svg)

De aparte [bètapipeline](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) voor main `1ecbc0e7` is succesvol afgerond. Deze bevat deze PR niet. De integratie vereist nog eigen geslaagde gehoste CI en beoordeling, gevolgd door releasecoördinatie; de bovenstaande lokale resultaten claimen niet dat die leveringscontroles zijn geslaagd.

<a id="delivery"></a>

## Levering

- [Player, documentatie en i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Besturingsserver en CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Android-trackvoorkeuren — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

Deze PR's bevatten de huidige CI- en samenvoegstatus. De playerwijziging volgt op de afgesproken huidige Plex-oplossingen en hun bètarelease als een afzonderlijke leveringsronde.

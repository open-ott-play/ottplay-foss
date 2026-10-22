# Kwaliteitslimieten en herstel van livestreams

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Decodereigenaarschap](device-media-backend.md)

De beheerde HTML5/HLS/Shaka-speler behoudt één afspeelrecht tijdens herstel van een defecte bron. Hij kan ook maximaal drie expliciet ingestelde reserve-URL's voor een livezender gebruiken. Hij ontdekt, raadt of vervangt nooit een zender op basis van de titel.

![Herstel: één afspeelrecht, eindige herhalingen en expliciete reserves](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Een kwaliteitsplafond instellen

Open **Instellingen → Interface-instellingen** en stel **Maximale videohoogte (HLS/Shaka)** en/of **Maximale streambitrate (HLS/Shaka)** in. De twee beperkingen gelden samen. **Automatisch** verwijdert de betreffende beperking. Ondersteund zijn 360/480/720/1080/2160 pixels en 1/2/4/8/16 Mbps. De instellingen worden lokaal opgeslagen, volgen het normale opslaan/annuleren en gelden bij de volgende afspeelstart, inclusief een herstart voor herstel.

Dit zijn plafonds, geen transcodeerinstellingen. Een stream met alleen 1080p kan niet in 720p veranderen. Als geen aangekondigde variant past, meldt de speler **No stream meets the quality limits** en stopt het herhalen van die aanvraag. Onbekende hoogte/bitrate bewijst niet dat een beperkte HLS-variant past.

HLS-varianten worden vóór het laden van fragmenten gefilterd. De huidige hls.js verwijdert ongeschikte varianten; oudere builds zonder `removeLevel` kunnen alleen een veilig aaneengesloten begin behouden en kunnen een manifest afwijzen dat later wel geschikte varianten bevat. Shaka gebruikt toepassingslimieten `maxHeight`/`maxBandwidth`. Automatische aanpassing gaat door tussen de overgebleven varianten.

Deze instellingen gelden voor de beheerde HLS- en Shaka-engines. Gewone HTML5, native platformdecoders en behouden TV/STB-engines bieden niet dezelfde bediening. Auto kan native afspelen kiezen; de instelling dwingt dat niet naar MSE. De speler verplaatst een reeds beperkte HLS-aanvraag niet naar onbeperkte native weergave om een decoderingsfout te omzeilen. Dit impliceert geen native transcoder, automatische hardwarebenchmark of fysieke 720p-uitvoer.

<a id="configure-explicit-backups"></a>

## Expliciete reserves instellen

1. Start de gewenste livezender.
2. Open **Informatie → Reservestreams**.
3. Selecteer positie 1, 2 of 3 en voer een volledige HTTP/HTTPS-media-URL in.
4. Open een bezette positie opnieuw om te **Bewerken** of **Verwijderen**. Start de zender opnieuw om de bijgewerkte lijst te gebruiken.

Elke positie hoort bij de huidige opslagnaamruimte van de provider en het exacte paar `sourceId`/`channelId`. De huidige afspeelgeneratie en bronconfiguratie begrenzen de editor. Bronwisselen terwijl een dialoog openstaat voorkomt dat die dialoog naar de vervangende bron opslaat. Een gelijktijdige wijziging van dezelfde positie wordt geweigerd in plaats van overschreven.

De eerste URL blijft de normale zenderbron. Dubbele en lege posities worden overgeslagen. Maximaal 256 zenderrecords en 256 KiB configuratie worden geaccepteerd. URL's met toegangsgegevens in user-info, witruimte, besturingstekens, backslashes of een ongeldige poort worden afgewezen. Querytokens van de provider kunnen nog wel in een media-URL staan: reserve-instellingen zijn lokale bronconfiguratie, geen manier om toegangsgegevens te delen of openbaar te maken.

Reserves zijn **alleen voor live**. Archief- en VOD-aanvragen gebruiken nooit een live-alternatief: opname, tijdsoorsprong, rechten en zoeksemantiek kunnen verschillen. De eigenaar moet gelijkwaardige, geautoriseerde live-eindpunten opgeven. Een gelijke zendertitel bewijst geen gelijkwaardigheid. De opgeslagen zenderidentiteit, favorieten en EPG-koppeling blijven gelijk wanneer het transportadres verandert.

<a id="recovery-guarantees"></a>

## Herstelgaranties

- De aanvraag heeft in totaal maximaal **twee vertraagde tijdelijke herhalingen van dezelfde URL**, en maximaal één stap vooruit naar elk van de drie reserveposities: hoogstens vijf nieuwe aanmaken na de eerste start. Een nieuwe decoderinstantie of geslaagd manifest zet dit budget niet terug. Bestaand begrensd HLS-netwerk- en decoderherstel binnen de engine vindt vóór dit buitenste beleid plaats.
- HLS-manifest-/levelparsefouten laten maximaal één herverbinding naar dezelfde URL per aanvraag toe, binnen hetzelfde totaal van twee pogingen. Een nieuwe decoder of reserve-eindpunt zet die limiet niet terug.
- Netwerkfouten zonder status, HTTP 408/429 en 5xx mogen het tijdelijke budget gebruiken. Andere HTTP 4xx mogen naar een ingesteld alternatief gaan, maar proberen dezelfde URL niet opnieuw. **HTTP 401/403 en aanmeldfouten bij de bron beëindigen de aanvraag**, zonder andere toegangsgegevens of reserve-eindpunten te proberen.
- Decoderingsfouten mogen vooruit naar een expliciete reserve. Onmogelijke kwaliteitslimieten beëindigen de aanvraag. Er is geen kringloop terug naar de hoofdbron.
- De vertraging is 500 ms, 1 s, 1.5 s en daarna maximaal 2 s. Herhaalde callbacks worden samengevoegd.
- Pause verwijdert de geplande timer maar behoudt de wachtende herhaling; Resume plant hem opnieuw. Stop, stand-by, bron- en zendervervanging maken vertraagde callbacks ongeldig. Een definitief mislukte aanvraag vereist expliciete herselectie in plaats van automatisch afspelen met de buiten gebruik gestelde decoder.
- Shaka-laadfouten en kritieke foutgebeurtenissen delen dit pad; annuleringsfouten worden genegeerd. Opnieuw koppelen wacht op de asynchrone vernietiging van Shaka.
- Herstel lost een ondoorzichtige Stalker-verwijzing opnieuw op en bereidt beschermde brontoegang opnieuw voor. Het hergebruikt geen verlopen iOS-loopback-URL. De VOD-/archiefpositie wordt vóór het afbreken vastgelegd; live-reserves beginnen op hun actuele livepunt.

Het beleid introduceert geen tweede bewaker voor stilstaande frames. Bestaand kiosk-, Auto/native- en HLS-herstel blijft de eigen waargenomen fouten dekken. Een stream die stil vastloopt zonder foutmelding door een bestaande detector heeft aparte diagnose nodig.

<a id="verification-and-observability"></a>

## Verificatie en waarneembaarheid

`window.__ottStreamPolicy.snapshot()` toont enginenaam, gevraagde limieten, mogelijkheden/beschikbaarheid, herhaalnummer, eindpuntindex en herstelstatus. Het bevat geen stream-URL of providertoegangsgegevens. Index nul betekent normale bron; volgende indices verwijzen naar niet-lege unieke alternatieven. Dit is diagnosestatus, geen stabiele afstandsbedienings-API.

Voer uit:

```sh
node tests/test_stream_policy.cjs
node tests/test_port_engine_lifecycle.cjs
node tests/test_settings_parity.cjs
node tests/test_media_backend.cjs
npm run test:localization
npm run typecheck
npm run build:server
node scripts/check-es5.cjs --server-only
```

De tests controleren kwaliteitsfiltering bij niet-monotone variantvolgorde, ontbrekende metadata, brongebonden bewerking, positieconflicten, dubbele fouten, begrensde budgetten, HTTP-autorisatiefouten, annuleren via pauze/stop/bron, Shaka-afbouw en behoud van VOD-positie. De vijf nieuwe afspeellabels zijn vertaald in alle 88 meegeleverde taalpakketten; automatische gelijkheidscontrole is geen beoordeling door moedertaalsprekers. Fysieke TV/D1-weergave en providerspecifieke manifesten vereisen nog apparaatvalidatie. [Bewerkbare diagrambron](diagrams/stream-recovery.mmd).

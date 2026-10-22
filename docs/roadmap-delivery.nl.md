# Verbeteringen voor betrouwbaarheid en media

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.nl.md) · [Architectuur](architecture.md)

Deze handleiding beschrijft de implementatie in de bronrevisie van deze pagina, niet de mogelijkheden van een oudere geïnstalleerde versie. De speler, besturingsdienst/CLI en native Android-app zijn aparte artefacten. Een update van één werkt de andere niet bij.

![Verantwoordelijkheden en vertrouwensgrenzen](diagrams/roadmap-components.svg)

Zie de [gemeten bytekosten en vergelijkingsgrafiek](roadmap-size.nl.md); uitvoeringssnelheid en afspelen op apparaten vereisen aparte acceptatiecontroles.

<a id="what-is-implemented"></a>

## Geïmplementeerde functies

1. **Een bekend audio-/videofragment.** [Informatie → Audio](audio-video-check.nl.md) streamt een fragment van acht seconden vanaf here.now (internet vereist), met linker-/rechtertonen en bijbehorende flitsen. Het wordt alleen na **Afspelen** opgehaald, nooit bij het opstarten; het mediabestand zit niet in de spelerpakketten. Het gebruikt tijdelijk de hoofd-HTML5-decoder, alleen bij inactiviteit of live-tv. Het schrijft geen kijkgeschiedenis. [Specificatie van het fragment](../diagnostics/README.md).
2. **Hervatbare Local/Home-configuratie.** De besturings-CLI kan een voorinstelling plannen, toepassen, hervatten en controleren. Vóór het herhalen van een schrijfopdracht met onzekere uitkomst vergelijkt hij de opgeslagen instellingen. [Besturingsproces](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Begrensd afspeelherstel.** Tijdelijke HLS/Shaka-fouten delen een eindig herstelbeleid. Authenticatiefouten en niet-ondersteunde DRM beëindigen de aanvraag. Stop, zenderwisseling en bronvervanging annuleren verouderde bewerkingen.
4. **Opgeslagen kwaliteitslimieten.** Maximale hoogte en bitrate begrenzen de adaptieve selectie; een native terugval mag een actieve bovengrens niet ongemerkt omzeilen.
5. **Trackvoorkeuren voor native Android.** De zelfstandige Android-app onthoudt de bedoeling op basis van taal/rol/label, inclusief Auto en ondertiteling uit, in plaats van een trackindex uit een andere stream over te nemen.
6. **Opdrachtoperators met beperkte rechten.** De controller kan toegangsgegevens toestaan voor specifieke apparaten/acties zonder beheerdersgegevens af te geven.
7. **Expliciete XMLTV-koppelingen.** Een zender binnen een afspeellijst kan aan een specifieke feed en XMLTV-ID worden gekoppeld. [Gidskoppelingen en toegankelijkheid](guide-binding-accessibility.nl.md).
8. **Xtream-films en -series.** De mediabibliotheek haalt de geselecteerde catalogus pas op verzoek op en daarna de afleveringen van een serie. [Bibliotheekcontract](xtream-media.nl.md).
9. **Toegankelijke klassieke bediening.** Zenderlijsten bieden selectiesemantiek; modale dialogen houden toetsenbordfocus vast en herstellen die; meldingen hebben een live-regio.
10. **Duurzame opdrachtresultaten.** Een optioneel begrensd controllerjournaal bewaart metadata voor deduplicatie en resultaten. Een herstart voert opdrachten nooit blind opnieuw uit.
11. **Expliciete apparaatoverdracht.** Live-/archiefverwijzingen gaan naar een speler met dezelfde ingestelde bron. Het doel lost zijn eigen URL op. [Contract](remote-handoff.nl.md).
12. **Expliciete reservestreams.** Livezenders kunnen ingestelde alternatieven gebruiken binnen hetzelfde eindige herstelbeleid. [Limieten, herstel en reserves](playback-stream-policy.nl.md).
13. **Herstelbare instellingenbatches.** Native localStorage gebruikt een terugdraai-journaal voor ondersteunde schrijfbewerkingen met meerdere sleutels. [Opslaggaranties](settings-recovery.nl.md).

<a id="language-and-compatibility-coverage"></a>

## Talen en compatibiliteit

De speler bevat 88 vertaalcatalogi. De zeven nieuwe kwaliteits-/medialabels zijn in elke catalogus vertaald; andere nieuwe menu's hergebruiken bestaande vertaalde labels. Cataloguscontroles omvatten sleutelgelijkheid, invulvelden en beoordeelde uitzonderingen. De bijbehorende technische handleidingen beschrijven dezelfde implementatiegrenzen in [24 documentatietalen](manual-translations.md). [Gelokaliseerde instappagina's](readme/README.md) zijn snelstartgidsen, geen bewering dat ieder historisch technisch document 88 volledige vertalingen heeft.

De klassieke uitvoer blijft ES5-syntaxis. Dit betekent niet dat elk apparaat iedere codec, web-API, opslaggarantie of native integratie ondersteunt. Het A/V-voorbeeld is beperkt tot het beheerde hoofd-HTML5-pad; vervangende apparaatengines zoals PC2/Video.js en native engines zijn uitgesloten. Expliciete gidskoppelingen gebruiken de gehoste of native XMLTV-implementatie; optionele externe companion-protocollen ondersteunen dit mogelijk niet. Apparaatspecifieke acceptatie vereist nog steeds het werkelijke apparaat.

<a id="reproduce-the-checks"></a>

## Controles reproduceren

```sh
npm ci
npm run typecheck
npm run test:localization
npm test
npm run build:server
npm run check:es5
npm run check:size
python3 scripts/check-av-diagnostic.py diagnostics/av-v1.mp4
```

De mediaverificatie vereist FFmpeg/FFprobe. Beide audiokanalen worden gedecodeerd en gecontroleerd op energie, scheiding en stilte; alleen de aanwezigheid van een AAC-track bewijst geen hoorbare inhoud. De reguliere JavaScript-tests behandelen annuleren, mislukte schrijfbewerkingen, herstel na herstart, bronwisselingen en ongeldige invoer. Eindcontroles van de bundel omvatten optionele providerfamilies, niet alleen het hoofdstartpunt.

Voer in de controller `go test -race ./...`, `go vet ./...` en `python3 -m unittest discover -s tests` uit. Voer in native Android de unittests voor trackvoorkeuren en instellingenback-ups uit en bouw de debug-APK. De CI van elke repository geldt voor de bijbehorende commit, niet voor een later gewijzigde boom.

<a id="physical-acceptance-before-promotion"></a>

## Fysieke acceptatie vóór promotie

- Voer op de doel-tv de A/V-controle uit en bevestig links-/rechtsaudio, zichtbare flitsen, Stop en terugkeer naar live-tv. Decodertests bewijzen geen HDMI-geluid of vloeiende weergave.
- Test toegestane/geweigerde streams, een defecte reserve en zenderwisseling tijdens een wachtende herhaling. Bevestig de gekozen kwaliteitslimiet op de werkelijke backend.
- Test lijst-/dialoogfocus met toetsenbord, afstandsbediening en beschikbare schermlezer.
- Koppel twee gelijkende zendernamen aan verschillende XMLTV-ID's en controleer de programmagegevens.
- Onderbreek het toepassen van een testvoorinstelling, herstart de controller, hervat en controleer. Draag over naar zowel een overeenkomend als een afwijkend ingestelde bron.
- Wissel in native Android tussen streams met verschillende trackvolgorde, herstart de app en bevestig expliciete Auto/Off en de voorkeurstaal.

Geslaagde verzending, opgeslagen instellingen, gedecodeerde voorbeelden en geslaagde unittests zijn verschillende bewijzen. Releasepromotie moet dit onderscheid behouden; zie de [releasestrategie](../RELEASING.md).

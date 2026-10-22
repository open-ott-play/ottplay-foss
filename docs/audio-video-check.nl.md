# Handmatige audio-/videocontrole

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Streamherstel](playback-stream-policy.nl.md) · [Specificatie van het testbestand](../diagnostics/README.md)

Gebruik **spelermenu → Informatie → Audio → Afspelen** om beeld en geluid te controleren met een bekend fragment van acht seconden. Dit is de hoorbare A/V-controle; de demonstratie met het bewegende patroon tijdens de introductie is stil.

![A/V-controle: bron in de repository, gehost fragment en expliciet afspelen](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## De controle starten

1. Zet televisie, luidsprekers of hoofdtelefoon op een comfortabel volume. De controle gebruikt het huidige spelervolume en heft het dempen van zijn video tijdelijk op; het systeemvolume van de televisie wordt niet verhoogd.
2. Open het spelermenu en selecteer **Informatie**, dan **Audio**, dan **Afspelen**. Alleen het menu openen downloadt of speelt het fragment niet af.
3. Kijk naar het scherm en luister naar de onderstaande volgorde. Gebruik **Informatie → Audio → Stoppen** om eerder te eindigen.

De controle gebruikt het beheerde centrale HTML5-afspeelpad als de speler inactief is of live-tv afspeelt of pauzeert. Een actieve VOD-/archiefaanvraag, een nog ladende live-aanvraag en stand-by worden geweigerd. De controle is ook niet beschikbaar wanneer een apparaatadapter de centrale engine vervangt, waaronder **PC2/Video.js** en native engine-overrides; alleen een HTML5-video-element gebruiken maakt een adapter niet geschikt. Een weigering vervangt de bestaande weergave niet. Stop eerst de huidige aanvraag om vanuit inactiviteit te testen; dit schakelt de controle op die adapters niet in. Menulabels volgen de gekozen interfacetaal.

<a id="what-you-should-see-and-hear"></a>

## Wat u moet zien en horen

De achtergrond is een bewegend testpatroon. Korte witte markeringen flitsen in de linker- of rechterbovenhelft tegelijk met zachte geluidspulsen van ongeveer 150 ms:

- **0–2 seconden:** elke seconde een puls van 440 Hz in het linkerkanaal, met een flits van de linkermarkering.
- **2–4 seconden:** een puls van 880 Hz in het rechterkanaal, met de rechtermarkering.
- **4–6 seconden:** beide kanalen pulseren, met beide markeringen.
- **6–8 seconden:** het patroon blijft bewegen zonder geluid. Deze stilte is bedoeld.

Een monotelevisie of downmix kan beide kanalen via één luidspreker weergeven. Controleer het fysieke scherm en de audio-uitvoer zelf. De speler meet geen luidsprekeruitvoer en geeft geen automatisch A/V-oordeel geslaagd/mislukt.

<a id="where-the-clip-comes-from"></a>

## Waar het fragment vandaan komt

De speler gebruikt dit absolute HTTPS-adres:

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Hij vraagt het fragment alleen op wanneer u **Afspelen** kiest, nooit als vooraf laden bij het starten. Het bestand is **464 652 bytes**, met H.264-baselinevideo van 640×360 / 25 fps en AAC-stereogeluid. Het is uitgesloten van de Web-, OTTPlay Server-, Tauri-, Capacitor- en containerpakketten. Het [bronbestand](../diagnostics/av-v1.mp4), de generator en de verificatie blijven in de repository; ze zijn geen offline terugval in de geïnstalleerde speler.

Internettoegang en een werkende HTTPS-verbinding met die host zijn vereist. Er is geen meegeleverde terugval of alternatieve diagnose-URL. De link openen in een browser kan de beschikbaarheid controleren, maar test niet het decodereigenaarschap van de speler of de terugkeer naar een zender. De hostingdienst ontvangt normale verbindingsinformatie; zie de [privacydetails](privacy-policy.md#optional-hosted-audio-video-check).

<a id="how-playback-returns"></a>

## Hoe het afspelen terugkeert

De controle gebruikt de hoofddecoder en vervangt tijdelijk het livebeeld. Ze eindigt aan het einde van het fragment, na **Audio → Stoppen** of bij een mediafout. Een **veiligheidslimiet van 15 seconden begint zodra de controle is geaccepteerd** en omvat ook het laden; een langzame download kan dus eindigen voordat alle acht seconden zijn afgespeeld.

In die gevallen probeert de speler de vastgelegde live-aanvraag bij het actuele livepunt te herstellen, inclusief de pauzestand, uitsluitend wanneer de aanvraag nog bij de huidige bron hoort en geen vervangende weergave het heeft overgenomen. De live-URL wordt opnieuw opgelost; herstel blijft afhankelijk van provider en netwerk. Een controle vanuit inactiviteit keert terug naar inactiviteit.

Het gewone afspeelcommando **Stop**, stand-by of het kiezen van een andere zender annuleert de controle zonder de vastgelegde zender opnieuw te starten. Ook het wijzigen van bron of bronsessie voorkomt verouderd herstel. De controle maakt bij afsluiten haar tijdelijke opheffing van dempen ongedaan; als u tijdens de controle dempt, blijft dat dempen actief. Ze wijzigt de opgeslagen enginevoorkeur niet, schrijft geen testseconden in de zendergeschiedenis en publiceert geen onjuiste zenderbeëindiging of testmetadata aan het besturingssysteem.

<a id="if-the-result-is-unexpected"></a>

## Bij een onverwacht resultaat

- **De controle start niet:** controleer of de speler inactief is of een al spelende/gepauzeerde livezender gebruikt via het beheerde centrale HTML5-pad, zonder apparaatengine-override. Een niet-ondersteunde toestand of mediafout kan **“Stream could not be played”** tonen.
- **Niets laadt of de controle sluit vroeg:** controleer internettoegang en de directe HTTPS-link. Een netwerkfout of tijdslimiet bewijst niet dat decoder of luidsprekers defect zijn. Herstel de verbinding voordat u opnieuw afspeelt.
- **Beeld zonder geluid:** de laatste twee seconden zijn bewust stil. Controleer tijdens de eerste zes seconden dempen/volume van de speler, televisievolume, gekozen audio-uitvoer en de aansluiting van luidsprekers/hoofdtelefoon.
- **Slechts één fysieke luidspreker speelt:** controleer eerst of de televisie mono-uitvoer of downmix gebruikt voordat u een kanaalrouteringsfout aanneemt.

Dit is een korte controle van een bekende MP4 via het beheerde centrale HTML5-beeld-/geluidspad. Ze bewijst niet dat een providerstream, HLS/DASH, DRM, meerkanaalsgeluid of hogere resolutie werkt en meet geen netwerkcapaciteit of synchronisatielatentie. Kwaliteitsplafonds en instellingen voor live-reservestreams veranderen dit diagnosefragment niet.

Eigenaarschap en opruimgedrag worden getest in [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) en [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs). Automatische decoderings- en levenscycluscontroles vervangen kijken en luisteren op het werkelijke apparaat niet; deze gids claimt geen nieuw resultaat op fysieke apparaten.

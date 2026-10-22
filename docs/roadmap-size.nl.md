<a id="measured-javascript-cost"></a>

# Gemeten JavaScript-kosten

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Functiegids](roadmap-delivery.nl.md) · [Ruwe meetgegevens](evidence/roadmap-size-20261015.json)

![Vergelijking van alle JavaScript van de speler met dezelfde toolchain](diagrams/roadmap-size.svg)

Deze pagina bewaart de JavaScript-metingen van de onderstaande broncodeversies. Ze meten niet de huidige revisie, installatiepakketten of netwerkverkeer.

In de eerste vergelijking groeiden het hoofdingangspunt en alle optionele providerfamilies samen met **31 128 ongecomprimeerde bytes / 9 759 gzip-bytes**: ongeveer **3.23% / 3.20%**. Dit zijn extra kosten voor functies, geen beweerde verbetering van omvang of uitvoeringssnelheid. Xtream blijft op aanvraag laden; het uit het ingangspunt halen verwijdert het niet uit het totaal.

De meting vergelijkt de schone bronarchieven `bbf9ca7b` en `cae971da`, beide versie 1.1.55, met Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 en zlib 1.2.12. Ze gebruikt de ES5-assembler voor productie, optimizer, naamgevingsregels en de juiste identiteit van de schone broncode. Gzip-niveau 9 wordt apart op elk geproduceerd bestand toegepast.

- Webingangspunt: 848 092 / 262 392 → 874 926 / 270 321 ongecomprimeerde/gzip-bytes.
- Webingangspunt + alle providers: 964 459 / 305 344 → 995 587 / 315 103.
- Native ingangspunt: 848 050 / 262 460 → 874 884 / 270 372.
- Native ingangspunt + alle providers: 964 417 / 305 412 → 995 545 / 315 154.
- Optionele M3U groeit met 184 ongecomprimeerde / 82 gzip-bytes; nieuwe Xtream is 4 110 / 1 748. De andere zes optionele families zijn byte voor byte gelijk.

Voordat de clip naar here.now verhuisde, voegde het veranderen van de URL naar een lokaal pad vanaf de root één ongecomprimeerde JavaScript-byte toe in deze historische reeks. Dat meet niet de latere gehoste URL. De correctie voor begrensde herhaalde HLS-parsing voegt 37 ongecomprimeerde / 36 gzip-bytes toe in een geïsoleerde vergelijking van dezelfde bronversie ([bewijs](evidence/parse-recovery-size-20261015.json)). De correctie van eigenaarschap bij native Auto-overdracht voegt nog 101 ongecomprimeerde / 39 gzip-bytes toe ([bewijs](evidence/auto-recovery-size-20261015.json)). Het resulterende ongecomprimeerde totaal vóór de correcties voor toegankelijkheidsregressies is 995 726 bytes; buildidentiteit en gzip-bytes kunnen in de definitieve commit veranderen. De definitieve `build/reports/classic-bundle.json` en `npm run check:size` blijven bepalend voor de exact geleverde revisie. De daaropvolgende schone build `652726f8`, met correcties voor aanwijzer- en dialoogfocus, meet **995 858 ongecomprimeerde / 315 207 gzip-bytes** voor de volledige webspeler ([bewijs van het definitieve artefact](evidence/roadmap-final-size-20261015.json)). Het ingangspunt is 875 197 / 270 425; native totalen zijn 995 816 / 315 259. De grenzen voor die versie behielden de eerdere marge voor native/Node/releasesuffix: 875 300 ongecomprimeerd / 271 600 gzip voor het ingangspunt; 996 100 / 316 400 voor ingangspunt + providers.

<a id="post-beta-integration"></a>

## Integratie na de bèta

![Volledige JavaScript na integratie van beta.4](diagrams/post-beta-size.svg)

De latere vergelijking reproduceert beta.4-broncode `39287792` tegenover runtime `9663b681`, inclusief Plex-integratie en herstel van beschadigde instellingen, met dezelfde Node 26.8.2, Rollup 4.64.5 en Terser 5.51.2:

- Webingangspunt: 848 315 / 262 443 → 879 533 / 271 761 ongecomprimeerde/gzip-bytes.
- Webingangspunt + alle providers: 964 876 / 305 452 → 1 000 388 / 316 600.
- Native ingangspunt + alle providers: 964 834 / 305 520 → 1 000 346 / 316 654.
- Groei volledige webpayload: **35 512 / 11 148 bytes (3.68% / 3.65%)**.

De basis telt zeven providerfamilies; de integratie acht, inclusief Xtream dat op aanvraag laadt. De ingangspuntgrenzen van die versie waren 879 900 / 273 000; de totale grenzen 1 000 800 / 317 800, met ruimte voor native, Node en release-identiteit. Beide lokale productiebuilds genereren vijf gevolgde runtimebestanden opnieuw en laten de vermelding van een schone bronrevisie weg. Dit zijn lokaal gereproduceerde artefacten, niet de gepubliceerde bètabestanden. Toolversies, hashes en die beperking staan in het [basisbewijs](evidence/post-beta-baseline-size-20261015.json) en [integratiebewijs](evidence/post-beta-candidate-size-20261015.json). Het [implementatieverslag](implementation-report.nl.md#post-beta-integration-and-review) licht correcties en validatie toe.

**Reikwijdte:** deze JavaScript-totalen sluiten externe media-engines, taalwoordenboeken, CSS, afbeeldingen en video uit. De historische spelerpakketten bevatten ook een **A/V-clip van 464 652 bytes**, buiten bovenstaande totalen. De huidige levering daarvan staat los van die metingen:

- **Repository:** `diagnostics/av-v1.mp4` blijft met generator en controleprogramma bewaard voor reproduceerbaarheid. Een bronbestand bewaren neemt het niet op in een pakket.
- **Pakketten:** Web/OTTPlay Server, Tauri, Capacitor en Docker sluiten de clip uit. Dit verwijdert 464 652 ongecomprimeerde mediabytes, niet een gemeten afname van 464 652 bytes in een gecomprimeerd installatieprogramma. Het archiefformaat en andere buildwijzigingen beïnvloeden die omvang.
- **Netwerk:** de speler haalt de clip pas van here.now op wanneer de gebruiker de [A/V-controle](audio-video-check.nl.md) start. Daarvoor is internet nodig; de clip wordt niet voor het afspelen bij opstarten opgehaald.

De historische JavaScript-metingen hierboven blijven gelijk. Het effect van de gehoste URL op JavaScript of een huidige installer meten vraagt een nieuwe vergelijking. De 88 vertaalde README-bestanden zijn repositorydocumentatie, geen spelerpayload. Deze bytevergelijking onderbouwt geen uitspraken over opstarttijd, beeldsnelheid, geheugen of prestaties bij grote catalogi. Daarvoor zijn aparte metingen op doelapparaten nodig.

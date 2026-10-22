<a id="measured-javascript-cost"></a>

# Gemessener JavaScript-Aufwand

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Funktionsleitfaden](roadmap-delivery.de.md) · [Rohdaten](evidence/roadmap-size-20261015.json)

![Vergleich des gesamten Player-JavaScripts mit derselben Werkzeugkette](diagrams/roadmap-size.svg)

Diese Seite bewahrt die JavaScript-Messungen der unten genannten Quellcode-Stände. Sie messen weder die aktuelle Revision noch Installationspakete oder Netzwerkverkehr.

Im ersten Vergleich wuchsen der Haupteinstieg und alle optionalen Anbieterfamilien zusammen um **31 128 unkomprimierte Bytes / 9 759 gzip-Bytes**: etwa **3.23% / 3.20%**. Das ist zusätzlicher Funktionsaufwand, keine behauptete Verbesserung der Größe oder Ausführungsgeschwindigkeit. Xtream wird weiterhin bei Bedarf geladen; das Auslagern aus dem Einstieg entfernt es nicht aus der Gesamtsumme.

Verglichen werden die sauberen Quellarchive `bbf9ca7b` und `cae971da`, beide Version 1.1.55, mit Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 und zlib 1.2.12. Verwendet werden der produktive ES5-Assembler, Optimierer, die Namensregeln und die korrekte Identität des sauberen Quellstands. Gzip-Stufe 9 wird auf jede ausgegebene Datei einzeln angewandt.

- Web-Einstieg: 848 092 / 262 392 → 874 926 / 270 321 unkomprimierte/gzip-Bytes.
- Web-Einstieg + alle Anbieter: 964 459 / 305 344 → 995 587 / 315 103.
- Nativer Einstieg: 848 050 / 262 460 → 874 884 / 270 372.
- Nativer Einstieg + alle Anbieter: 964 417 / 305 412 → 995 545 / 315 154.
- Optionales M3U wächst um 184 unkomprimierte / 82 gzip-Bytes; das neue Xtream umfasst 4 110 / 1 748. Die anderen sechs optionalen Familien sind bytegleich.

Bevor der Clip zu here.now wechselte, fügte die Änderung seiner URL in einen lokalen Pfad ab der Wurzel in dieser historischen Folge ein unkomprimiertes JavaScript-Byte hinzu. Das misst nicht die spätere gehostete URL. Die Korrektur für begrenzte Wiederholungen beim HLS-Parsen ergänzt im isolierten Vergleich desselben Quellstands 37 unkomprimierte / 36 gzip-Bytes ([Nachweis](evidence/parse-recovery-size-20261015.json)). Die Korrektur der Zuständigkeit bei der nativen Auto-Übergabe ergänzt weitere 101 unkomprimierte / 39 gzip-Bytes ([Nachweis](evidence/auto-recovery-size-20261015.json)). Vor den Korrekturen der Barrierefreiheitsregressionen ergibt das insgesamt 995 726 unkomprimierte Bytes; Build-Identität und gzip-Größe können sich im endgültigen Commit ändern. Maßgeblich für die exakt ausgelieferte Revision bleiben das endgültige `build/reports/classic-bundle.json` und `npm run check:size`. Der anschließende saubere Build `652726f8` einschließlich der Zeiger-/Dialogfokus-Korrekturen misst **995 858 unkomprimierte / 315 207 gzip-Bytes** für den vollständigen Web-Player ([Nachweis des finalen Artefakts](evidence/roadmap-final-size-20261015.json)). Sein Einstieg umfasst 875 197 / 270 425; die nativen Summen betragen 995 816 / 315 259. Die Grenzen dieses Stands behielten den bisherigen Spielraum für nativ/Node/Release-Suffix bei: 875 300 unkomprimiert / 271 600 gzip für den Einstieg; 996 100 / 316 400 für Einstieg + Anbieter.

<a id="post-beta-integration"></a>

## Integration nach der Beta

![Vollständiges JavaScript nach der Integration von beta.4](diagrams/post-beta-size.svg)

Der spätere Vergleich reproduziert den beta.4-Quellstand `39287792` gegenüber der Laufzeit `9663b681`, einschließlich Plex-Integration und Wiederherstellung beschädigter Einstellungen, mit denselben Versionen Node 26.8.2, Rollup 4.64.5 und Terser 5.51.2:

- Web-Einstieg: 848 315 / 262 443 → 879 533 / 271 761 unkomprimierte/gzip-Bytes.
- Web-Einstieg + alle Anbieter: 964 876 / 305 452 → 1 000 388 / 316 600.
- Nativer Einstieg + alle Anbieter: 964 834 / 305 520 → 1 000 346 / 316 654.
- Zunahme des gesamten Web-Payloads: **35 512 / 11 148 Bytes (3.68% / 3.65%)**.

Die Basis umfasst sieben Anbieterfamilien, die Integration acht einschließlich des bedarfsgeladenen Xtream. Die Einstiegsgrenzen dieses Stands lagen bei 879 900 / 273 000, die Gesamtgrenzen bei 1 000 800 / 317 800; Spielraum für nativ, Node und Release-Identität blieb erhalten. Beide lokalen Produktionsbuilds erzeugen fünf versionierte Laufzeitdateien neu und verzichten auf die Kennzeichnung als sauberer Quellstand. Es sind lokal reproduzierte Artefakte, nicht die veröffentlichten Beta-Binärdateien. Werkzeugversionen, Hashes und diese Einschränkung stehen im [Basisnachweis](evidence/post-beta-baseline-size-20261015.json) und [Integrationsnachweis](evidence/post-beta-candidate-size-20261015.json). Der [Implementierungsbericht](implementation-report.de.md#post-beta-integration-and-review) erläutert Korrekturen und Validierung.

**Umfang:** Diese JavaScript-Summen enthalten keine externen Medien-Engines, Sprachwörterbücher, CSS, Bilder oder Videos. Historische Player-Pakete enthielten außerdem einen **464 652 Byte großen A/V-Clip**, der nicht zu den obigen Summen gehört. Seine heutige Auslieferung ist davon getrennt:

- **Repository:** `diagnostics/av-v1.mp4` bleibt mit Generator und Prüfer zur Reproduzierbarkeit erhalten. Eine Quelldatei aufzubewahren bedeutet nicht, sie in ein Paket aufzunehmen.
- **Pakete:** Web/OTTPlay Server, Tauri, Capacitor und Docker schließen den Clip aus. Das entfernt 464 652 unkomprimierte Medien-Bytes, ist aber keine gemessene Reduktion eines komprimierten Installers um 464 652 Bytes. Archivformat und andere Build-Änderungen beeinflussen dessen Größe.
- **Netzwerk:** Der Player lädt den Clip erst von here.now, wenn der Benutzer den [A/V-Test](audio-video-check.de.md) startet. Der Test erfordert Internetzugang; für die Wiedergabe beim Start wird der Clip nicht geladen.

Die obigen historischen JavaScript-Messungen bleiben unverändert. Um den Einfluss der gehosteten URL auf JavaScript oder einen aktuellen Installer zu messen, ist ein neuer Vergleich nötig. Die 88 lokalisierten README-Dateien sind Repository-Dokumentation, kein Player-Payload. Dieser Byte-Vergleich erlaubt keine Aussage über Startzeit, Bildrate, Speicherbedarf oder Leistung bei großen Katalogen. Dafür sind separate Messungen auf Zielgeräten erforderlich.

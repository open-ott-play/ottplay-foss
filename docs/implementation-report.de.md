# Von der Funktionsliste zu überprüftem Verhalten

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Funktionsverträge](roadmap-delivery.de.md) · [Größennachweise](roadmap-size.de.md)

Dieser Bericht dokumentiert Implementierung und Stabilisierung, keine Release-Ankündigung. Der gemessene Player-Stand ist `652726f8`; der separat gebaute native Android-Stand ist `be0d800`. CI, Merge und Release-Freigabe bleiben eigenständige Prüfstufen. Spätere reine Dokumentations- oder Test-Commits machen eine lokale Prüfung nicht zum Nachweis, dass ein installiertes Gerät aktualisiert wurde. Die folgenden Prüfstufen beziehen sich auf diese historischen Stände; sie sind kein laufender Release-Tracker. Veröffentlichte Builds stehen unter [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases).

![Implementierungsprozess und Abnahmeprüfungen](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Wie die Arbeit geprüft wurde

Die ursprüngliche Anforderung wurde in 13 nutzbare Funktionsbereiche für den klassischen Player, Steuerdienst/CLI und die unabhängige native Android-Anwendung aufgeteilt. Verantwortlichkeiten wurden nach Komponenten vergeben, damit parallele Änderungen geprüft und integriert werden konnten, ohne die Arbeit einer anderen Komponente zu ersetzen. Die neue Oberfläche verwendete vorhandene übersetzte Beschriftungen oder ergänzte Katalogeinträge in allen 88 Sprachen; vollständige technische Anleitungen wurden ursprünglich auf Englisch und Russisch verfasst. Das Haupthandbuch und die gepaarten Funktionsanleitungen liegen nun vollständig in [24 Dokumentationssprachen](manual-translations.md) vor.

Auf die Implementierung folgten unabhängige gegenseitige Reviews und ausführbare Regressionstests. Ein gemeldetes Problem wurde vor einer Codeänderung am tatsächlichen Callback-, Decoder-, Speicher- oder Fokuspfad geprüft. Testfehler wurden in Verhaltensregressionen und veraltete Testselektoren aufgeteilt. Beispielsweise erforderte die Umstellung klassischer Zeilen von `button` auf `option` neue Selektoren; sie rechtfertigte keine Abschwächung des erwarteten Klickverhaltens.

Saubere Produktionsbuilds prüften anschließend die erzeugten ES5-Artefakte und den gesamten JavaScript-Umfang einschließlich optionaler Provider-Module. Gezielte Browsertests nutzten den ausgelieferten Loader, das Bundle und die Geräteadapter. Für natives Android gab es einen separaten Gradle-Test-, Lint- und Paketdurchlauf. PR-Prüfungen und Review-Threads werden nach dem Push erneut kontrolliert; ein bestandener lokaler Build ist kein Ersatz.

<a id="what-changed-during-review"></a>

## Änderungen während des Reviews

![Fünf korrigierte Verhaltensweisen und gemessener JavaScript-Umfang](diagrams/implementation-results.svg)

- **HLS-Parsing und Wiederholungen:** Parsingfehler teilten zunächst die allgemeine Netzwerkkategorie. Nun erlauben sie höchstens eine erneute Verbindung zur gleichen URL innerhalb des Budgets von zwei Wiederholungen bei vorübergehenden Fehlern; neue Decoder und Backup-URLs setzen es nicht zurück. Ein endgültiger Authentifizierungs-/DRM-Fehler verwirft außerdem eine bereits eingeplante vorübergehende Wiederholung.
- **Nativer Auto-Fallback:** Die Behandlung nativer Fehler konnte die Anfrage beenden, obwohl Auto bereits einen Fallback besaß. Der vorhandene Eigentümer behält diesen Übergang nun; ein Abbruch macht seine verzögerten Callbacks weiterhin ungültig.
- **Enter im modalen Dialog:** Automatischer Fokus auf die erste Abbrechen-Schaltfläche ließ Enter im Plex-Wartedialog zum Abbruch werden. Dialoge starten jetzt mit Fokus auf dem Dialog selbst. Tab erreicht ihre Schaltflächen ausdrücklich; normale Informations- und Bestätigungsdialoge behalten ihr Enter- und Escape/Zurück-Verhalten.
- **Zeigerauswahl am PC:** Mausfokus änderte die Auswahl vor dem Klick-Handler und machte den ersten Klick zur Aktivierung. Zeigerbedingter Fokus wählt die Zeile nicht mehr vorab aus. Am PC wird weiterhin erst ausgewählt, dann aktiviert; LG behält sein Ein-Klick-Verhalten. Tastaturfokus folgt weiterhin der Auswahl.
- **Android-Spuren:** Eine unbeschriftete Auswahl des aktuellen Elements konnte durch ihre eigene Auto-Bestätigung oder eine Untertitelpräferenz überschrieben werden oder auf ein anderes Element mit gleichem `TrackGroup` übergehen. Verzögerte Schreibvorgänge übersteht sie nun nur für ihr aktuelles Element. Semantische Präferenzen verwenden Sprache/Rolle/Beschriftung; das ViewModel verwaltet die Persistenz, sodass das Schließen des Bereichs den Schreibvorgang nicht abbricht.

Die 13 gelieferten Bereiche sind: A/V-Beispiel; fortsetzbare Local/Home-Einrichtung; begrenzte Wiederherstellung; Qualitätsobergrenzen; Android-Spurpräferenzen; eingeschränkte Steuerschlüssel; XMLTV-Zuordnungen; Xtream-Filme/-Serien; klassische Barrierefreiheit; dauerhafte Befehlsergebnisse; ausdrückliche Übergabe; Backup-Streams; wiederherstellbare Einstellungsstapel. Der [Funktionsleitfaden](roadmap-delivery.de.md) definiert Umfang und Grenzen jedes Bereichs.

<a id="evidence-and-remaining-gates"></a>

## Nachweise und verbleibende Prüfstufen

Für `652726f8` bestanden die fünf gezielten Browserszenarien: LG-webOS-Zeigernavigation, LG-NetCast-Zeigernavigation, Zwei-Klick-Verhalten am PC, Dialog-Tastatursemantik und Plex-Sammlung/Auflösung/Abbruch/Wiederholung. TypeScript, die Barrierefreiheits-Unit-Fixture, gezieltes Linting sowie ES5- und Bundle-Budget-Prüfungen bestanden. Der vollständige Browserlauf dieses Builds endete mit **194 bestandenen und einem übersprungenen Test**: Natives HLS benötigt WebKit, während dieser Lauf Chromium nutzte. Gehostete CI und die vereinbarte Merge-Reihenfolge bleiben eigene Prüfstufen.

Die verbleibende Kette aus `test:port` und `test:unified` wurde nach Korrektur einzelner Test-Fixtures in fortgesetzten Abschnitten abgeschlossen. Jedes fehlgeschlagene Ziel wurde erfolgreich wiederholt, auch die restlichen Befehle waren erfolgreich; dies behauptet keinen einzigen ununterbrochenen `npm test`-Lauf. Der exakte Android-Bridge-CI-Schritt aus neun Befehlen bestand ebenfalls lokal.

Für Android `be0d800` bestanden lokal **101 App-Tests und 62 Shared-Core-Tests**, ebenso Debug/Release-Linting, Debug/Release/Full-APK-Erstellung, das Release-Bundle und die Kompilierung des androidTest-APKs. Das Kompilieren eines instrumentierten Test-APKs ist keine Ausführung auf einem Gerät. Die drei bestätigten Review-Befunde wurden in [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68) beantwortet und erledigt. Dieser PR bestand seine Prüfungen und wurde als `5b644b94` gemergt; die CI nach dem Merge wird separat verfolgt. Im Diagramm bleibt die übergreifende Player-CI-/Release-Stufe offen.

Die vollständige Web-JavaScript-Summe änderte sich von **964,459 / 305,344** Raw/Gzip-Bytes auf **995,858 / 315,207**: **+31,399 / +9,863 Bytes** (etwa 3.26% / 3.23%). Der Funktionskandidat lag bei 995,587 / 315,103; nachfolgende Stabilisierung ergänzte 271 / 104. Der endgültige Haupteinstieg dieses Stands beträgt 875,197 / 270,425. Siehe [Basismessung](evidence/roadmap-size-20261015.json), [Messung des endgültigen Artefakts](evidence/roadmap-final-size-20261015.json) und [Messmethode](roadmap-size.de.md). Kommas in diesen Bytezahlen sind Tausendertrennzeichen.

Dies sind historische JavaScript-Byteumfänge, **keine gemessenen Geschwindigkeitsverbesserungen**. Medien-Engines, Wörterbücher, CSS, Bilder und Video sind nicht enthalten. Die Player-Pakete dieses Stands enthielten separat den A/V-Clip mit 464,652 Bytes. Nach der [Hosting-Änderung](audio-video-check.de.md) bleibt `diagnostics/av-v1.mp4` mit Generator und Prüfer zur Reproduzierbarkeit im Repository, wird aber aus Web/OTTPlay Server-, Tauri-, Capacitor- und Docker-Paketen ausgeschlossen. Der Player lädt ihn nur für die ausdrücklich gestartete A/V-Prüfung von here.now; dafür ist Internet erforderlich. Die Startwiedergabe lädt ihn nicht. Das Entfernen von 464,652 unkomprimierten Medienbytes belegt weder die Ersparnis in komprimierten Installern noch ändert es die historischen JavaScript-Messungen. Startzeit, Frame-Pacing, Speicherverbrauch, Screenreader-Erlebnis, echtes HDMI-Audio und Provider-Verhalten erfordern eigene Messungen auf Zielgeräten. Dieser Bericht behauptet weder ein neues Ergebnis auf physischer Hardware noch einen Beta-Release. Die [physische Abnahmeliste](roadmap-delivery.de.md#physical-acceptance-before-promotion) und die [Release-Strategie](../RELEASING.md) bleiben Freigabekriterien.

<a id="post-beta-integration-and-review"></a>

## Integration und Review nach der Beta

Nach Veröffentlichung von beta.4 wurde Quellstand `39287792` in diesen Branch integriert. Laufzeitrevision `9663b681` korrigiert zudem die Rückkehr zur Live-Kante unter HLS-Qualitätsgrenzen und macht ein beschädigtes Einstellungsjournal vor dem normalen Start wiederherstellbar. Der Wiederherstellungsbildschirm blockiert teilweise Kontoinitialisierung, unterstützt Wiederholung und bestätigtes Zurücksetzen, bewahrt nicht zugehörige Cookies und verhindert, dass alte Cookie-Einstellungen nach dem Zurücksetzen zurückkehren. Siehe [Wiederherstellungsprozess](settings-recovery.de.md) und sein SVG-Diagramm.

![Vollständiger JavaScript-Vergleich nach der Beta](diagrams/post-beta-size.svg)

Die Reproduktion beider Quellstände mit Node 26.8.2, Rollup 4.64.5 und Terser 5.51.2 ergibt **964,876 / 305,452** Raw/Gzip-Bytes für den beta.4-Quellstand und **1,000,388 / 316,600** für die Integration: **+35,512 / +11,148 Bytes** (3.68% / 3.65%). Enthalten sind alle optionalen Provider: sieben in der Basis und acht in der Integration. Der neue Einstieg beträgt 879,533 / 271,761. Dieser Vergleich ist von den zuvor eingefrorenen Diagrammen getrennt.

Beide lokalen Produktionsbuilds generieren fünf versionierte Laufzeitdateien neu und lassen die Angabe eines sauberen Quellstands weg. Die Berichte dokumentieren diese Einschränkung, statt diese lokalen Dateien als veröffentlichte Release-Artefakte auszugeben: [Basis](evidence/post-beta-baseline-size-20261015.json) und [Integration](evidence/post-beta-candidate-size-20261015.json). Integrationsbuild und ES5-/Native-Prüfungen bestehen. Sechs gezielte Browserprüfungen bestehen ebenfalls: Journal-Wiederherstellung/-Reset, Dialog-Tastaturverhalten, LG-webOS- und NetCast-Zeigereingabe, PC-Zwei-Klick-Auswahl und der Plex-Wartezustand mit eindeutigem Eigentümer.

<a id="browser-gate-integration"></a>

## Integration der Browser-Prüfstufe

![Bestätigte lokale Browser-Prüfergebnisse](diagrams/browser-verification-results.svg)

Quellstand `c52f4d07` enthält PR 779 aus main `1ecbc0e7`. Testbefehle, Wiederherstellungsprüfungen und Plex-Dialog-Assertions beider Branches bleiben erhalten. TypeScript, Linting, Dokumentation, Paketierungs-/Linker-Verträge, Produktionsbuild und vollständige Prüfungen kompilierter Bundles bestehen. Alle 27 erzeugten Player-/Provider-JavaScript-Dateien bleiben byteidentisch zu den oben gemessenen Artefakten. Die vollständige Geräte-Browser-Suite dieses Builds endet mit **196 bestandenen Tests und einem erwarteten Chromium-Skip** für natives HLS, das WebKit erfordert.

Das genaue paketierte Mode-A-Archiv wurde erst nach Prüfung von Quelle, Prüfsumme und Bundle-/Provider-Inventar entpackt. Chromium 156.0.8078.4, Firefox 157.0 und WebKit 27.2 bestanden jeweils alle fünf Profilszenarien ohne Auslassungen oder Wiederholungen: **15 lokale Erfolge** mit Playwright 1.64.0. Der tatsächliche Host war macOS 26.7.1, nicht der in den gewählten Profilen benannte Runner `macos-15`. Die Belege vermerken diesen Unterschied ausdrücklich und sind **keine gehostete Matrix- oder Release-Qualifikation**. Siehe [lokale Zusammenfassung](evidence/post779-local-acceptance/summary.json) und [Reproduktionsanleitung](evidence/post779-local-acceptance/reproduce.sh), die einen vorhandenen Produktionsbuild erwartet und ein entpacktes Kandidatenverzeichnis nicht ersetzt.

Die [Browser-Richtlinie](browser-compatibility.de.md) verlangt fünf gehostete Ziele und 25 Szenarioausführungen für PR-/Beta-Prüfungen; der vollständige RC hat 35 Ziele und 166 Ausführungen. Dies sind konfigurierte Anforderungen, keine gemessene Abdeckung.

![Wie Kandidatenprüfung Nachweise erzeugt](diagrams/candidate-verification-flow.svg)

Die separate [Beta-Pipeline](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) für main `1ecbc0e7` war erfolgreich. Sie enthält diesen PR nicht. Die Integration benötigt weiterhin eigene erfolgreiche gehostete CI und Review, gefolgt von Release-Koordination; die lokalen Ergebnisse oben behaupten nicht, dass diese Lieferstufen bestanden sind.

<a id="delivery"></a>

## Auslieferung

- [Player, Dokumentation und i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Steuerserver und CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Android-Spurpräferenzen — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

Diese PRs enthalten den aktuellen CI- und Merge-Stand. Die Player-Änderung folgt den vereinbarten aktuellen Plex-Korrekturen und ihrem Beta-Release als separate Auslieferungswelle.

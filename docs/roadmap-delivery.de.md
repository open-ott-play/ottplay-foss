# Verbesserungen bei Zuverlässigkeit und Medien

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.de.md) · [Architektur](architecture.md)

Diese Anleitung beschreibt die Implementierung im Quellstand dieser Seite, nicht die Fähigkeiten einer älteren installierten Version. Player, Steuerdienst/CLI und native Android-App sind getrennte Artefakte. Das Aktualisieren eines davon aktualisiert die anderen nicht.

![Zuständigkeiten und Vertrauensgrenzen](diagrams/roadmap-components.svg)

Siehe [gemessene Byte-Kosten und Vergleichsdiagramm](roadmap-size.de.md); Ausführungsgeschwindigkeit und Gerätewiedergabe sind gesonderte Abnahmeprüfungen.

<a id="what-is-implemented"></a>

## Implementierter Umfang

1. **Bekanntes Audio-/Videobeispiel.** [Information → Audio](audio-video-check.de.md) streamt einen achtsekündigen Clip von here.now (Internet erforderlich) mit Links-/Rechtstönen und passenden Lichtsignalen. Er wird ausschließlich nach **Play**, niemals beim Start geladen; die Mediendatei ist nicht in den Player-Paketen enthalten. Der Clip belegt den Haupt-HTML5-Decoder vorübergehend nur im Leerlauf oder beim Live-TV. Er schreibt keinen Wiedergabeverlauf. [Spezifikation der Testdatei](../diagnostics/README.md).
2. **Fortsetzbare Local/Home-Einrichtung.** Die Steuer-CLI kann eine Voreinstellung planen, anwenden, fortsetzen und prüfen. Vor dem Wiederholen eines Schreibvorgangs mit ungewissem Ausgang vergleicht sie gespeicherte Einstellungen. [Steuerungsablauf](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Begrenzte Wiedergabewiederherstellung.** Vorübergehende HLS/Shaka-Fehler teilen sich eine endliche Wiederherstellungsrichtlinie. Authentifizierungsfehler und nicht unterstütztes DRM sind endgültig. Stop, Kanalwechsel und Quellenaustausch verwerfen überholte Arbeit.
4. **Gespeicherte Qualitätsgrenzen.** Maximale Höhe und Bitrate begrenzen die adaptive Auswahl; ein nativer Rückfall darf eine aktive Obergrenze nicht unbemerkt umgehen.
5. **Spurpräferenzen für natives Android.** Die eigenständige Android-App merkt sich die Absicht nach Sprache/Rolle/Bezeichnung, einschließlich Auto und ausgeschalteter Untertitel, statt einen Spurindex aus einem anderen Stream zu übernehmen.
6. **Befehlsnutzer mit begrenzten Rechten.** Der Controller kann Zugangsdaten exakt bestimmte Geräte/Aktionen erlauben, ohne Administrator-Zugangsdaten weiterzugeben.
7. **Explizite XMLTV-Zuordnungen.** Ein zur Wiedergabeliste gehörender Kanal kann einem bestimmten Feed und einer XMLTV-ID zugeordnet werden. [Programmzuordnungen und Barrierefreiheit](guide-binding-accessibility.de.md).
8. **Xtream-Filme und -Serien.** Die Mediathek lädt den gewählten Katalog bei Bedarf und danach die Episoden einer Serie. [Mediatheksvertrag](xtream-media.de.md).
9. **Barrierefreie klassische Bedienelemente.** Kanallisten vermitteln die Auswahlsemantik; modale Dialoge halten den Tastaturfokus und stellen ihn wieder her; Hinweise besitzen eine Live-Region.
10. **Dauerhafte Befehlsergebnisse.** Ein optionales begrenztes Controller-Journal bewahrt Metadaten zur Deduplizierung und zu Ergebnissen auf. Ein Neustart wiederholt Befehle nie blind.
11. **Explizite Geräteübergabe.** Live-/Archivreferenzen werden an einen Player mit derselben konfigurierten Quelle übergeben. Das Ziel löst seine URL selbst auf. [Vertrag](remote-handoff.de.md).
12. **Explizite Ersatzstreams.** Live-Kanäle können konfigurierte Alternativen innerhalb derselben endlichen Wiederherstellungsrichtlinie nutzen. [Grenzen, Wiederherstellung und Ersatzquellen](playback-stream-policy.de.md).
13. **Wiederherstellbare Einstellungspakete.** Natives localStorage verwendet für unterstützte Schreibvorgänge über mehrere Schlüssel ein Undo-Journal. [Speichergarantien](settings-recovery.de.md).

<a id="language-and-compatibility-coverage"></a>

## Sprach- und Kompatibilitätsabdeckung

Der Player enthält 88 Übersetzungskataloge. Die sieben neuen Qualitäts-/Medienbeschriftungen sind in jedem Katalog übersetzt; andere neue Menüs verwenden vorhandene übersetzte Beschriftungen. Katalogprüfungen erfassen Schlüsselgleichheit, Platzhalter und geprüfte Ausnahmen. Die zugehörigen technischen Anleitungen erläutern dieselben Implementierungsgrenzen in [24 Dokumentationssprachen](manual-translations.md). [Lokalisierte Einstiegsseiten](readme/README.md) sind Kurzanleitungen, keine Behauptung, dass jedes historische technische Dokument 88 vollständige Übersetzungen besitzt.

Die klassische Ausgabe bleibt ES5-Syntax. Das bedeutet nicht, dass jedes Gerät jeden Codec, jede Web-API, jede Speichergarantie oder native Integration unterstützt. Die A/V-Vorschau ist auf den verwalteten Haupt-HTML5-Pfad beschränkt; ersetzende Geräte-Engines wie PC2/Video.js und native Engines sind ausgeschlossen. Explizite Programmzuordnungen verwenden die gehostete oder native XMLTV-Implementierung; optionale externe Companion-Protokolle unterstützen sie möglicherweise nicht. Gerätespezifische Abnahme benötigt weiterhin das tatsächliche Gerät.

<a id="reproduce-the-checks"></a>

## Prüfungen reproduzieren

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

Die Medienprüfung benötigt FFmpeg/FFprobe. Sie decodiert beide Audiokanäle und prüft Energie, Trennung und Stille; das bloße Vorhandensein einer AAC-Spur belegt keinen hörbaren Inhalt. Reguläre JavaScript-Tests prüfen Abbruch, fehlgeschlagene Schreibvorgänge, Wiederherstellung nach Neustart, Quellenwechsel und ungültige Eingaben. Die abschließenden Bundle-Prüfungen erfassen optionale Anbieterfamilien, nicht nur den Haupteinstieg.

Im Controller `go test -race ./...`, `go vet ./...` und `python3 -m unittest discover -s tests` ausführen. Unter nativem Android die Unit-Tests für Spurpräferenzen und Einstellungssicherungen ausführen und das Debug-APK bauen. Die CI jedes Repositorys gilt für den entsprechenden Commit, nicht für einen später geänderten Baum.

<a id="physical-acceptance-before-promotion"></a>

## Physische Abnahme vor der Hochstufung

- Auf dem Ziel-TV die A/V-Prüfung ausführen und Links-/Rechtsaudio, sichtbare Lichtsignale, Stop und Rückkehr zum Live-TV bestätigen. Decoder-Tests belegen weder HDMI-Ton noch flüssige Wiedergabe.
- Erlaubte/verweigerte Streams, eine ausgefallene Ersatzquelle und Kanalwechsel während einer ausstehenden Wiederholung prüfen. Die gewählte Qualitätsgrenze am tatsächlich verwendeten Backend bestätigen.
- Listen-/Dialogfokus mit Tastatur, Fernbedienung und verfügbarem Screenreader prüfen.
- Zwei ähnliche Kanalnamen unterschiedlichen XMLTV-IDs zuordnen und die Programmdaten prüfen.
- Das Anwenden einer Testvoreinstellung unterbrechen, den Controller neu starten, fortsetzen und prüfen. An übereinstimmend und abweichend konfigurierte Quellen übergeben.
- Unter nativem Android zwischen Streams mit unterschiedlicher Spurreihenfolge wechseln, die App neu starten und explizites Auto/Off sowie die bevorzugte Sprache bestätigen.

Erfolgreicher Versand, gespeicherte Einstellungen, decodierte Beispiele und bestandene Unit-Tests sind verschiedene Nachweise. Bei der Release-Hochstufung muss diese Unterscheidung erhalten bleiben; siehe [Release-Strategie](../RELEASING.md).

# Qualitätsgrenzen und Wiederherstellung von Livestreams

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Decoder-Zuständigkeit](device-media-backend.md)

Der verwaltete HTML5/HLS/Shaka-Player behält während der Wiederherstellung nach einem Quellfehler eine einzige Wiedergabeberechtigung. Für einen Live-Kanal kann er außerdem bis zu drei ausdrücklich konfigurierte Ersatz-URLs nutzen. Er entdeckt, errät oder ersetzt einen Kanal niemals anhand seines Titels.

![Wiederherstellung: eine Berechtigung, begrenzte Wiederholungen, explizite Ersatzquellen](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Qualitätsobergrenze einstellen

Öffnen Sie **Einstellungen → Oberflächeneinstellungen** und setzen Sie **Maximale Videohöhe (HLS/Shaka)** und/oder **Maximale Stream-Bitrate (HLS/Shaka)**. Beide Grenzen gelten gemeinsam. **Automatisch** entfernt die jeweilige Grenze. Unterstützt werden 360/480/720/1080/2160 Pixel und 1/2/4/8/16 Mbps. Die Einstellungen werden lokal gespeichert, nehmen am normalen Speichern/Abbrechen der Einstellungen teil und gelten ab dem nächsten Wiedergabestart, einschließlich eines Wiederherstellungsstarts.

Dies sind Obergrenzen, keine Transcodierungseinstellungen. Ein Stream mit ausschließlich 1080p wird nicht zu 720p. Passt keine angekündigte Variante, meldet der Player **No stream meets the quality limits** und beendet die Wiederholungen dieser Anfrage. Unbekannte Höhe/Bitrate belegen nicht, dass eine beschränkte HLS-Variante passt.

Die HLS-Variantenfilterung erfolgt vor dem Laden der Fragmente. Aktuelles hls.js entfernt ungeeignete Varianten; ältere Builds ohne `removeLevel` können nur einen sicheren zusammenhängenden Anfangsbereich behalten und lehnen möglicherweise ein Manifest mit ansonsten geeigneten späteren Varianten ab. Shaka verwendet die Anwendungsgrenzen `maxHeight`/`maxBandwidth`. Die automatische Anpassung läuft zwischen den verbleibenden Varianten weiter.

Diese Einstellungen gelten für die verwalteten HLS- und Shaka-Engines. Reines HTML5, native Plattformdecoder und beibehaltene TV/STB-Engines bieten nicht dieselben Regler. Auto kann native Wiedergabe wählen; die Einstellung erzwingt kein MSE. Der Player wechselt eine bereits beschränkte HLS-Anfrage nicht zu unbeschränkter nativer Wiedergabe, nur um einen Decodierungsfehler zu umgehen. Weder ein nativer Transcoder noch ein automatischer Hardwarebenchmark oder eine Aussage über physische 720p-Ausgabe ist damit verbunden.

<a id="configure-explicit-backups"></a>

## Explizite Ersatzquellen konfigurieren

1. Starten Sie den gewünschten Live-Kanal.
2. Öffnen Sie **Informationen → Ersatzstreams**.
3. Wählen Sie Platz 1, 2 oder 3 und geben Sie eine vollständige HTTP/HTTPS-Medien-URL ein.
4. Öffnen Sie einen belegten Platz erneut zum **Bearbeiten** oder **Löschen**. Starten Sie den Kanal erneut, um die aktualisierte Liste zu verwenden.

Jeder Platz gehört zum aktuellen Speichernamensraum des Anbieters und zum exakten Paar `sourceId`/`channelId`. Die aktuelle Wiedergabegeneration und Quellenkonfiguration begrenzen den Editor. Ein Quellenwechsel bei geöffnetem Dialog verhindert, dass dieser Dialog in die Ersatzquelle speichert. Eine gleichzeitige Änderung desselben Platzes wird abgewiesen statt überschrieben.

Die erste URL bleibt die normale Quelle des Kanals. Doppelte und leere Plätze werden übersprungen. Maximal 256 Kanaleinträge und 256 KiB Konfiguration werden akzeptiert. URLs mit Zugangsdaten im user-info-Teil, Leerraum, Steuerzeichen, Rückwärtsschrägstrichen oder ungültigem Port werden abgelehnt. Vom Anbieter gelieferte Query-Token dürfen weiterhin Teil einer Medien-URL sein: Ersatzeinstellungen sind lokale Quellenkonfiguration, kein Verfahren zum Teilen oder Veröffentlichen von Zugangsdaten.

Ersatzquellen gelten **nur für Live-TV**. Archiv- und VOD-Anfragen nutzen niemals eine Live-Alternative: Aufnahme, Zeitursprung, Rechte und Suchsemantik können abweichen. Der Eigentümer muss gleichwertige, autorisierte Live-Endpunkte angeben. Ein gleicher Kanaltitel beweist keine Gleichwertigkeit. Gespeicherte Kanalidentität, Favoriten und EPG-Zuordnung bleiben bei einem Wechsel des Transportendpunkts unverändert.

<a id="recovery-guarantees"></a>

## Wiederherstellungsgarantien

- Eine Anfrage hat insgesamt höchstens **zwei verzögerte vorübergehende Wiederholungen derselben URL** und höchstens einen Vorwärtsschritt zu jedem ihrer drei Ersatzplätze: maximal fünf Neuerstellungen nach dem ersten Start. Eine neue Decoderinstanz oder ein erfolgreiches Manifest setzt das Budget nicht zurück. Die bestehende begrenzte HLS-Netzwerk- und Decoderwiederherstellung innerhalb der Engine läuft vor dieser äußeren Richtlinie.
- Fehler beim Parsen von HLS-Manifesten/-Levels erlauben höchstens eine erneute Verbindung zur selben URL je Anfrage, innerhalb desselben Gesamtlimits von zwei Wiederholungen. Ein neuer Decoder oder Ersatzendpunkt setzt diese Grenze nicht zurück.
- Netzwerkfehler ohne Status sowie HTTP 408/429 und 5xx dürfen das vorübergehende Budget nutzen. Andere HTTP 4xx dürfen zur konfigurierten Alternative wechseln, wiederholen aber nicht dieselbe URL. **HTTP 401/403 und Anmeldefehler der Quelle beenden die Anfrage**, ohne alternative Zugangsdaten oder Ersatzendpunkte auszuprobieren.
- Decoderfehler dürfen vorwärts zu einer expliziten Ersatzquelle wechseln. Unerfüllbare Qualitätsgrenzen beenden die Anfrage. Es gibt keinen zyklischen Rücksprung zur Hauptquelle.
- Die Verzögerung beträgt 500 ms, 1 s, 1.5 s, dann höchstens 2 s. Wiederholte Rückrufe werden zusammengefasst.
- Pause entfernt den geplanten Timer, behält aber die ausstehende Wiederholung; Resume plant ihn neu. Stop, Standby, Quellen- und Kanalersatz machen verzögerte Rückrufe ungültig. Eine endgültig fehlgeschlagene Anfrage erfordert eine ausdrückliche Neuauswahl, statt den stillgelegten Decoder automatisch abzuspielen.
- Shaka-Ladefehler und kritische Fehlerereignisse teilen diesen Pfad; Abbruchfehler werden ignoriert. Erneutes Anbinden wartet auf die asynchrone Zerstörung von Shaka.
- Die Wiederherstellung löst eine undurchsichtige Stalker-Referenz erneut auf und bereitet den geschützten Quellenzugriff neu vor. Sie verwendet keine abgelaufene iOS-Loopback-URL wieder. Die VOD-/Archivposition wird vor dem Abbau erfasst; Live-Ersatzquellen beginnen an ihrem aktuellen Live-Rand.

Die Richtlinie führt keinen zweiten Wächter für eingefrorene Bilder ein. Die bestehende kiosk-, Auto/native- und HLS-Wiederherstellung deckt weiterhin ihre eigenen beobachteten Fehlerfälle ab. Ein Stream, der stillsteht, ohne dass ein vorhandener Detektor einen Fehler meldet, braucht eine separate Diagnose.

<a id="verification-and-observability"></a>

## Prüfung und Beobachtbarkeit

`window.__ottStreamPolicy.snapshot()` zeigt Engine-Name, angeforderte Grenzen, Fähigkeiten/Verfügbarkeit, Wiederholungszahl, Endpunktindex und Wiederherstellungszustand. Es enthält weder Stream-URL noch Anbieter-Zugangsdaten. Index null bedeutet normale Quelle; spätere Indizes beziehen sich auf nichtleere eindeutige Alternativen. Dies ist Diagnosezustand, keine stabile Fernsteuerungs-API.

Ausführen:

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

Die Tests prüfen Qualitätsfilter bei nichtmonotoner Variantenreihenfolge, fehlende Metadaten, quellengebundene Bearbeitung, Platzkonflikte, doppelte Fehler, begrenzte Budgets, HTTP-Autorisierungsfehler, Abbruch durch Pause/Stop/Quellenwechsel, Shaka-Abbau und Erhalt der VOD-Position. Die fünf neuen Wiedergabelabels sind in allen 88 mitgelieferten Sprachpaketen übersetzt; automatischer Gleichheitsabgleich ersetzt keine muttersprachliche Prüfung. Physische TV/D1-Wiedergabe und anbieterspezifische Manifeste erfordern weiterhin Gerätevalidierung. [Bearbeitbare Diagrammquelle](diagrams/stream-recovery.mmd).

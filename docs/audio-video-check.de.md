# Manuelle Audio-/Videoprüfung

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Stream-Wiederherstellung](playback-stream-policy.de.md) · [Spezifikation der Testdatei](../diagnostics/README.md)

Mit **Player-Menü → Informationen → Audio → Wiedergabe** prüfen Sie Bild und Ton anhand eines bekannten achtsekündigen Clips. Dies ist die hörbare A/V-Prüfung; die Demo mit bewegtem Muster bei der Einführung ist stumm.

![A/V-Prüfung: Repository-Quelle, gehosteter Clip und ausdrücklicher Start](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## Prüfung starten

1. Stellen Sie Fernseher, Lautsprecher oder Kopfhörer auf eine angenehme Lautstärke. Die Prüfung verwendet die aktuelle Player-Lautstärke und hebt die Stummschaltung seines Videos vorübergehend auf; die Systemlautstärke des Fernsehers wird nicht erhöht.
2. Öffnen Sie das Player-Menü, wählen Sie **Informationen**, dann **Audio**, dann **Wiedergabe**. Das bloße Öffnen des Menüs lädt den Clip weder herunter noch spielt es ihn ab.
3. Beobachten Sie den Bildschirm und hören Sie auf die folgende Abfolge. Zum vorzeitigen Beenden wählen Sie **Informationen → Audio → Stopp**.

Die Prüfung verwendet den verwalteten zentralen HTML5-Wiedergabepfad, wenn der Player untätig ist oder Live-TV läuft beziehungsweise pausiert ist. Eine aktive VOD-/Archivanfrage, eine noch ladende Live-Anfrage und Standby werden abgelehnt. Die Prüfung ist auch nicht verfügbar, wenn ein Geräteadapter die zentrale Engine ersetzt, einschließlich **PC2/Video.js** und nativer Engine-Overrides; allein ein HTML5-video-Element macht einen Adapter nicht geeignet. Eine Ablehnung ersetzt die laufende Wiedergabe nicht. Stoppen Sie die aktuelle Anfrage zuerst, um aus dem Leerlauf zu testen; dies aktiviert die Prüfung auf den genannten Adaptern nicht. Die Menütexte folgen der gewählten Oberflächensprache.

<a id="what-you-should-see-and-hear"></a>

## Erwartetes Bild und erwarteter Ton

Im Hintergrund bewegt sich ein Testmuster. Kurze weiße Markierungen blitzen in der oberen linken oder rechten Hälfte synchron zu leisen, ungefähr 150 ms langen Tonimpulsen auf:

- **0–2 Sekunden:** jede Sekunde ein 440-Hz-Impuls im linken Kanal, mit linker Markierung.
- **2–4 Sekunden:** ein 880-Hz-Impuls im rechten Kanal, mit rechter Markierung.
- **4–6 Sekunden:** beide Kanäle geben Impulse aus, beide Markierungen blitzen.
- **6–8 Sekunden:** das Muster bewegt sich ohne Ton weiter. Diese Stille ist beabsichtigt.

Ein Monofernseher oder Downmix kann beide Kanäle über einen Lautsprecher wiedergeben. Prüfen Sie den physischen Bildschirm und die Audioausgabe selbst. Der Player misst keine Lautsprecherausgabe und erstellt kein automatisches A/V-Bestanden/Nicht-bestanden-Ergebnis.

<a id="where-the-clip-comes-from"></a>

## Herkunft des Clips

Der Player verwendet diese absolute HTTPS-Adresse:

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Er fordert den Clip nur bei **Wiedergabe** an, niemals als Vorladen beim Start. Die Datei umfasst **464 652 Bytes**, mit H.264-Baseline-Video bei 640×360 / 25 fps und AAC-Stereoton. Sie ist aus Web-, OTTPlay-Server-, Tauri-, Capacitor- und Container-Paketen ausgeschlossen. [Quelldatei](../diagnostics/av-v1.mp4), Generator und Prüfer bleiben im Repository; sie sind kein Offline-Ersatz im installierten Player.

Internetzugang und eine funktionierende HTTPS-Verbindung zu diesem Host sind erforderlich. Es gibt keinen mitgelieferten Ersatz und keine alternative Diagnose-URL. Das Öffnen des Links im Browser kann die Dateiverfügbarkeit prüfen, testet aber weder die Decoder-Zuständigkeit des Players noch die Rückkehr zum Kanal. Der Hostingdienst erhält gewöhnliche Verbindungsdaten; siehe [Datenschutzdetails](privacy-policy.md#optional-hosted-audio-video-check).

<a id="how-playback-returns"></a>

## Rückkehr zur Wiedergabe

Die Prüfung nutzt den Hauptdecoder und ersetzt vorübergehend das Live-Bild. Sie endet am Clipende, nach **Audio → Stopp** oder bei einem Medienfehler. Eine **Sicherheitsfrist von 15 Sekunden beginnt mit der Annahme der Prüfung** und umfasst das Laden; ein langsamer Download kann daher vor Ablauf der gesamten acht Wiedergabesekunden enden.

In diesen Fällen versucht der Player, die erfasste Live-Anfrage am aktuellen Live-Rand einschließlich ihres Pausenzustands wiederherzustellen, aber nur, wenn sie noch zur aktuellen Quelle gehört und keine Ersatzwiedergabe übernommen hat. Die Live-URL wird neu aufgelöst; die Wiederherstellung hängt weiterhin von Anbieter und Netzwerk ab. Eine Prüfung aus dem Leerlauf kehrt in den Leerlauf zurück.

Der gewöhnliche Wiedergabebefehl **Stop**, Standby oder die Auswahl eines anderen Kanals bricht die Prüfung ab, ohne den erfassten Kanal neu zu starten. Änderungen der Quelle oder ihrer Sitzung verhindern ebenfalls eine veraltete Wiederherstellung. Die Prüfung nimmt ihre vorübergehende Aufhebung der Stummschaltung beim Beenden zurück; schalten Sie währenddessen stumm, bleibt diese Stummschaltung wirksam. Sie ändert keine gespeicherte Engine-Präferenz, schreibt keine Testsekunden in den Kanalverlauf und meldet dem Betriebssystem weder ein falsches Kanalende noch Testmetadaten.

<a id="if-the-result-is-unexpected"></a>

## Bei unerwartetem Ergebnis

- **Die Prüfung startet nicht:** Stellen Sie sicher, dass der Player untätig ist oder ein bereits laufender/pausierter Live-Kanal den verwalteten zentralen HTML5-Pfad verwendet, ohne Geräte-Engine-Override. Ein nicht unterstützter Zustand oder Medienfehler kann **“Stream could not be played”** anzeigen.
- **Nichts lädt oder die Prüfung endet früh:** Prüfen Sie Internetzugang und direkten HTTPS-Link. Ein Netzwerkfehler oder Fristablauf belegt keinen defekten Decoder oder Lautsprecher. Stellen Sie die Verbindung vor erneuter Wiedergabe wieder her.
- **Bild ohne Ton:** Die letzten zwei Sekunden sind absichtlich stumm. Prüfen Sie in den ersten sechs Sekunden Stummschaltung/Lautstärke des Players, Fernsehlautstärke, gewählten Audioausgang sowie Lautsprecher-/Kopfhöreranschluss.
- **Nur ein physischer Lautsprecher spielt:** Prüfen Sie zuerst, ob der Fernseher Monoausgabe oder Downmix verwendet, bevor Sie einen Fehler der Kanalzuordnung annehmen.

Dies ist eine kurze Prüfung eines bekannten MP4 über den verwalteten zentralen HTML5-Bild-/Tonpfad. Sie beweist nicht, dass Anbieterstreams, HLS/DASH, DRM, Mehrkanalton oder höhere Auflösungen funktionieren, und misst weder Netzwerkkapazität noch Synchronisationslatenz. Qualitätsobergrenzen und Einstellungen für Live-Ersatzstreams verändern diesen Diagnoseclip nicht.

Zuständigkeit und Bereinigung werden durch [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) und [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs) geprüft. Automatische Decoder- und Lebenszyklusprüfungen ersetzen nicht das Sehen und Hören am tatsächlichen Gerät; diese Anleitung behauptet kein neues Ergebnis an physischen Geräten.

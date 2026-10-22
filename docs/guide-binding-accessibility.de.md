<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Manuelle XMLTV-Zuordnung und Tastaturzugänglichkeit

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Programmführer-Architektur](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Den Programmführer eines Kanals ohne Playliständerung korrigieren

Spielen Sie den betroffenen M3U-Kanal ab, öffnen Sie **Information → EPG** und bearbeiten Sie die EPG-Quell-URL sowie die **XMLTV ID**. Geben Sie die exakte ID aus `<channel id="…">` der XMLTV-Datei ein, nicht den Anzeigenamen. **Set** speichert die Zuordnung und lädt die Playlist neu. **Automatic** entfernt die Überschreibung dieses Kanals und lädt die ursprüngliche Playlistzuordnung neu. Pfeiltastenbewegungen allein speichern oder löschen niemals eine Zuordnung. Zurück lässt die gespeicherte Zuordnung unverändert.

Dieser Editor ist in der gehosteten Browserbereitstellung und nativen XMLTV-Shells (Tauri und Capacitor) verfügbar. Er überschreibt keine anbietereigenen Programmführer, expliziten `=source`-JSON-Endpunkte oder externen Begleitserver. Ein gewöhnlicher älterer Browser mit entferntem Begleitserver behält sein bisheriges Zuordnungsprotokoll. Die erste Version akzeptiert eine exakte ID; sie lädt oder zeigt keine durchsuchbare Liste sämtlicher XMLTV-Kanäle.

![Eine manuelle Zuordnung verbindet Playlistquelle und stabilen Kanal mit einem XMLTV-Feed und einer exakten ID; andernfalls bleibt die normale Zuordnung aktiv.](images/guide-binding.svg)

Eine Zuordnung speichert den Fingerabdruck der Playlistquelle, den stabilen Kanalschlüssel, die explizite Feed-URL und die XMLTV-ID. Umbenennen eines Anzeigetexts oder Umordnen der Zeilen ändert die Zuordnung nicht, solange die Kanalidentität gleich bleibt. Ein Wechsel von Playlist-URL/Konto ändert den Quellnamensraum. Für ältere M3U-Einträge ohne `itemId` wird die bestehende, aus der URL abgeleitete Kanal-ID verwendet; ein Wechsel dieser URL ändert die Identität.

Der ausgewählte Kanal behält seinen Anzeigenamen und seine Wiedergabe-URL. Die Programmführersuche nutzt genau einen expliziten Feed ohne Namensfallback; eine fehlende ID übernimmt daher nicht unbemerkt das Programm eines anderen Kanals. Automatische regionale Zeitverschiebungen aus dem Kanalnamen gelten für diese exakte Zuordnung nicht; ein explizites `tvg-shift` der Playlist gilt weiterhin. Geben Sie die richtige regionale XMLTV-ID an. Kann ein eigener HTTPS-Feed wegen CORS oder Mixed-Content-Regeln nicht gelesen werden, meldet die normale EPG-Diagnose diesen Fehler.

Der lokale Datensatz ist auf 500 Zuordnungen und 512 KiB je Quelle begrenzt; er wird einmal pro Playlistladevorgang geparst, nicht pro Kanal. Schreibvorgänge vergleichen den vorherigen Wert und lesen das gespeicherte Ergebnis vor dem Neuladen zurück. Ein verspäteter Editor-Callback kann nicht in eine ausgetauschte Quelle speichern. Dies ist eine lokale Einstellung, keine geräteübergreifende Synchronisierung. Feed-URLs können Zugangsdaten enthalten; teilen Sie Speicherexporte nicht öffentlich.

<a id="accessible-classic-controls"></a>

## Zugängliche klassische Bedienelemente

- Die virtualisierte Hauptliste bietet eine benannte Listbox, die ausgewählte Option, die vollständige Elementanzahl und die absolute Elementposition. Nur die ausgewählte sichtbare Zeile ist per Tab erreichbar. Pfeilnavigation aktualisiert die sichtbare Auswahl und den semantischen Zustand; bei Seitenwechseln folgt der Fokus einer bereits fokussierten Liste.
- Standardmäßige Informations-/Bestätigungsdialoge, der Editor und die About-Bereiche bieten modale Rollen und lokalisierte Namen. Tab und Umschalt+Tab wechseln innerhalb des vordersten modalen Dialogs. Nach dem Schließen eines verschachtelten Dialogs wird ein noch sichtbares übergeordnetes Bedienelement wieder fokussiert; veraltete geplante Öffnungen können nach dem Schließen keinen Fokus stehlen.
- Informations- und Bestätigungsmeldungen beschreiben ihre Dialoge. Vorübergehende Hinweise verwenden eine zurückhaltend angekündigte Statusregion.
- Vorhandene Übersetzungskataloge liefern alle neuen Beschriftungen. XMLTV und ID sind Protokollbezeichner; Kanalnamen und Feed-Hostnamen bleiben Quellmetadaten.

Die Anwendung behält ihre Fernbedienungswege und ES5-Syntax. Semantische DOM-Prüfungen stellen keine vollständige WCAG-Zertifizierung dar: gerätespezifischer Fokus, VoiceOver-/TalkBack-Ausgabe und das Verhalten von TV-Browsern erfordern weiterhin Tests an echten Geräten.

<a id="verification"></a>

## Überprüfung

Ausführen:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Führen Sie außerdem die üblichen Build-/ES5-/Bundlegrößenprüfungen auf dem integrierten Branch aus. Browsertests sollten eine lange Liste über Seitengrenzen, eine verschachtelte Bestätigung, Quellenwechsel während der Bearbeitung, eine korrekte, fehlende und entfernte Zuordnung sowie einen EPG-Downloadfehler abdecken. Die semantischen Spurpräferenzen der nativen Android-Anwendung sind in deren separatem Repository implementiert und von diesen klassischen Bedienelementen unabhängig.

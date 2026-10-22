# Zlepšení spolehlivosti a přehrávání médií

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.cs.md) · [Architektura](architecture.md)

Tento průvodce popisuje implementaci v revizi zdrojů této stránky, nikoli možnosti starší nainstalované verze. Přehrávač, řídicí služba/CLI a nativní aplikace Android jsou samostatné artefakty. Aktualizace jednoho neaktualizuje ostatní.

![Odpovědnosti a hranice důvěry](diagrams/roadmap-components.svg)

Viz [naměřená velikost v bajtech a srovnávací graf](roadmap-size.cs.md); rychlost běhu a přehrávání na zařízeních jsou samostatné přejímací kontroly.

<a id="what-is-implemented"></a>

## Co je implementováno

1. **Známá zvuková a obrazová ukázka.** [Informace → Zvuk](audio-video-check.cs.md) přehrává osm sekund dlouhý klip z here.now (vyžaduje internet) s levými/pravými tóny a odpovídajícími záblesky. Stahuje se pouze po volbě **Přehrát**, nikdy při spuštění; mediální soubor není součástí balíčků přehrávače. Hlavní dekodér HTML5 si dočasně vypůjčuje jen v nečinnosti nebo při živé televizi. Nezapisuje historii sledování. [Specifikace ukázky](../diagnostics/README.md).
2. **Obnovitelné nastavení Local/Home.** Řídicí CLI dokáže předvolbu naplánovat, použít, obnovit a ověřit. Před opakováním zápisu s nejistým výsledkem porovná uložená nastavení. [Postup řízení](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Omezená obnova přehrávání.** Přechodné chyby HLS/Shaka sdílejí konečná pravidla obnovy. Selhání autentizace a nepodporované DRM jsou konečné. Stop, změna kanálu a výměna zdroje ruší zastaralé operace.
4. **Uložené limity kvality.** Maximální výška a datový tok omezují adaptivní výběr; přechod na nativní přehrávání nesmí potichu obejít aktivní limit.
5. **Předvolby stop v nativním Androidu.** Samostatná aplikace Android si pamatuje záměr podle jazyka/role/popisku, včetně Auto a vypnutých titulků, místo přenášení indexu stopy z jiného streamu.
6. **Operátoři příkazů s omezeným oprávněním.** Řadič může povolit přihlašovacím údajům konkrétní zařízení/akce bez předání administrátorských údajů.
7. **Výslovné vazby XMLTV.** Kanál v rámci seznamu lze svázat s konkrétním zdrojem a ID XMLTV. [Vazby programu a přístupnost](guide-binding-accessibility.cs.md).
8. **Filmy a seriály Xtream.** Mediální knihovna načte vybraný katalog až na vyžádání a poté epizody seriálu. [Kontrakt knihovny](xtream-media.cs.md).
9. **Přístupné klasické ovládání.** Seznamy kanálů zpřístupňují význam výběru; modální dialogy udržují a obnovují fokus klávesnice; oznámení mají živou oblast.
10. **Trvalé výsledky příkazů.** Volitelný omezený žurnál řadiče uchovává metadata deduplikace a výsledků. Restart nikdy slepě neopakuje příkazy.
11. **Výslovné předání zařízení.** Odkazy na živé vysílání/archiv se předávají přehrávači se stejným nakonfigurovaným zdrojem. Cíl si vyřeší vlastní URL. [Kontrakt](remote-handoff.cs.md).
12. **Výslovné záložní streamy.** Živé kanály mohou používat nakonfigurované alternativy v rámci stejných konečných pravidel obnovy. [Limity, obnova a zálohy](playback-stream-policy.cs.md).
13. **Obnovitelné dávky nastavení.** Nativní localStorage používá žurnál vrácení změn pro podporované zápisy více klíčů. [Záruky úložiště](settings-recovery.cs.md).

<a id="language-and-compatibility-coverage"></a>

## Jazykové pokrytí a kompatibilita

Přehrávač obsahuje 88 překladových katalogů. Sedm nových popisků kvality/médií je přeloženo v každém katalogu; ostatní nová menu používají existující překlady. Kontroly katalogů ověřují shodu klíčů, zástupné parametry a posouzené výjimky. Párové technické průvodce vysvětlují stejné limity implementace ve [24 jazycích dokumentace](manual-translations.md). [Lokalizované vstupní stránky](readme/README.md) jsou stručné příručky pro začátek, nikoli tvrzení, že každý historický technický dokument má 88 úplných překladů.

Klasický výstup zachovává syntaxi ES5. To neznamená, že každé zařízení podporuje všechny kodeky, webová API, záruky úložiště nebo nativní integrace. Ukázka A/V je omezena na hlavní spravovanou cestu HTML5; nahrazující zařízeníové enginy jako PC2/Video.js a nativní enginy jsou vyloučeny. Výslovné vazby programu používají hostovanou nebo nativní implementaci XMLTV; volitelné externí protokoly companion je nemusí podporovat. Přejímka pro konkrétní zařízení nadále vyžaduje skutečné zařízení.

<a id="reproduce-the-checks"></a>

## Zopakování kontrol

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

Mediální ověřovač vyžaduje FFmpeg/FFprobe. Dekóduje oba zvukové kanály a kontroluje jejich energii, oddělení a ticho; samotná existence stopy AAC nedokazuje slyšitelný obsah. Běžné testy JavaScriptu ověřují rušení, neúspěšné zápisy, obnovu po restartu, změny zdroje a neplatné vstupy. Závěrečné kontroly balíčku zahrnují volitelné rodiny poskytovatelů, nejen hlavní vstupní soubor.

V řadiči spusťte `go test -race ./...`, `go vet ./...` a `python3 -m unittest discover -s tests`. V nativním Androidu spusťte jednotkové testy předvoleb stop a záloh nastavení a sestavte ladicí APK. CI každého repozitáře platí pro příslušný commit, nikoli pro později změněný strom.

<a id="physical-acceptance-before-promotion"></a>

## Fyzická přejímka před povýšením verze

- Na cílovém televizoru spusťte kontrolu A/V a potvrďte levý/pravý zvuk, viditelné záblesky, Stop a návrat k živému vysílání. Testy dekodéru nedokazují zvuk HDMI ani plynulost.
- Vyzkoušejte povolené/odmítnuté streamy, nefunkční zálohu a změnu kanálu během čekajícího opakování. Potvrďte zvolený limit kvality na skutečném backendu.
- Otestujte fokus seznamů/dialogů klávesnicí, dálkovým ovladačem a dostupnou čtečkou obrazovky.
- Přiřaďte dva podobné názvy kanálů k různým ID XMLTV a ověřte programová data.
- Přerušte použití testovací předvolby, restartujte řadič, pokračujte a ověřte výsledek. Předejte přehrávání shodně i odlišně nakonfigurovanému zdroji.
- V nativním Androidu přepněte mezi streamy s jiným pořadím stop, restartujte aplikaci a potvrďte výslovné Auto/Off a preferovaný jazyk.

Úspěšné odeslání, uložená nastavení, dekódované ukázky a úspěšné jednotkové testy jsou různé důkazy. Povýšení vydání musí toto rozlišení zachovat; viz [strategie vydávání](../RELEASING.md).

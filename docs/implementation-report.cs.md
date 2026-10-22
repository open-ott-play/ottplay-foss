# Od seznamu funkcí k ověřenému chování

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Smlouvy funkcí](roadmap-delivery.cs.md) · [Podklady k velikosti](roadmap-size.cs.md)

Tato zpráva zaznamenává implementaci a zpevnění řešení, neoznamuje vydání. Měřený snímek přehrávače je `652726f8`; samostatně sestavený snímek nativního Androidu je `be0d800`. CI, sloučení a povýšení vydání zůstávají samostatnými kontrolními kroky. Pozdější commity pouze s dokumentací nebo testy nemění místní kontrolu v důkaz aktualizace nainstalovaného zařízení. Níže uvedené stavy patří k těmto historickým snímkům; nejde o živé sledování vydání. Publikované sestavení najdete v [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases).

![Proces implementace a přejímací kontroly](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Jak se práce kontrolovala

Původní požadavek byl rozdělen do 13 použitelných funkčních částí v klasickém přehrávači, řídicí službě/CLI a nezávislé nativní aplikaci pro Android. Odpovědnost byla přidělena podle komponent, aby bylo možné souběžné změny revidovat a integrovat bez přepisování práce jiné komponenty. Nové rozhraní znovu používalo existující přeložené popisky nebo přidávalo položky do katalogů všech 88 jazyků; úplné technické návody vznikaly původně anglicky a rusky. Hlavní příručka a párové návody k funkcím mají nyní úplná vydání ve [24 jazycích dokumentace](manual-translations.md).

Po implementaci následovala nezávislá křížová revize a spustitelné regresní testy. Nahlášený problém byl před změnou kódu ověřen ve skutečné cestě callbacku, dekodéru, úložiště nebo fokusu. Selhání testů se rozdělila na regrese chování a zastaralé selektory. Například změna klasických řádků z `button` na `option` vyžadovala úpravu selektorů, ale neopravňovala ke zmírnění očekávaného chování kliknutí.

Čistá produkční sestavení poté ověřila vytvořené artefakty ES5 a celý objem JavaScriptu včetně volitelných modulů poskytovatelů. Cílené testy prohlížeče používaly dodávaný loader, balík a adaptéry zařízení. Nativní Android měl samostatný běh testů Gradle, lintu a sestavení balíků. Kontroly PR a diskuse revize se po odeslání změn znovu kontrolují; úspěšné místní sestavení je nenahrazuje.

<a id="what-changed-during-review"></a>

## Co se při revizi změnilo

![Pět opravených chování a změřený objem JavaScriptu](diagrams/implementation-results.svg)

- **Parsování HLS a opakování:** chyby parsování původně sdílely obecnou síťovou klasifikaci. Nyní umožňují nejvýše jedno opětovné připojení ke stejné URL v rámci limitu dvou opakování přechodných chyb; nové dekodéry ani záložní URL jej neresetují. Konečná chyba autentizace/DRM také ruší již naplánované opakování přechodné chyby.
- **Nativní náhradní cesta Auto:** obsluha nativní chyby mohla ukončit požadavek, když Auto již vlastnilo náhradní přechod. Stávající vlastník nyní tento přechod zachovává; zrušení dál zneplatňuje jeho odložené callbacky.
- **Enter v modálním dialogu:** automatický fokus na prvním tlačítku Zrušit měnil Enter v čekacím dialogu Plex na zrušení. Dialogy nyní začínají s fokusem na samotném dialogu. Tab výslovně přejde na tlačítka; běžné informační a potvrzovací dialogy zachovávají chování Enter a Escape/Zpět.
- **Výběr ukazatelem na PC:** fokus myši měnil výběr před obsluhou kliknutí a měnil první kliknutí na aktivaci. Fokus vyvolaný ukazatelem už řádek předem nevybírá. PC dál nejprve vybírá a potom aktivuje; LG zachovává jednoklikové chování. Fokus klávesnice dál sleduje výběr.
- **Stopy Androidu:** neoznačený výběr aktuální položky mohl být smazán vlastním potvrzením Auto či změnou preference titulků nebo přejít na jinou položku se shodným `TrackGroup`. Nyní přežije odložené zápisy pouze pro aktuální položku. Sémantické preference používají jazyk/roli/popisek; ukládání vlastní ViewModel, takže zavření panelu zápis nezruší.

Dodáno bylo 13 částí: ukázka A/V; obnovitelné nastavení Local/Home; omezená obnova; stropy kvality; preference stop Androidu; řídicí klíče s omezeným rozsahem; vazby XMLTV; filmy/seriály Xtream; klasická přístupnost; trvalé výsledky příkazů; výslovné předání; záložní streamy; obnovitelné dávky nastavení. [Průvodce funkcemi](roadmap-delivery.cs.md) vymezuje rozsah a omezení každé části.

<a id="evidence-and-remaining-gates"></a>

## Důkazy a zbývající kontroly

Pro `652726f8` prošlo pět cílených scénářů prohlížeče: navigace ukazatelem LG webOS, navigace LG NetCast, dvouklikové chování PC, klávesnicová sémantika dialogů a kolekce/rozlišení/zrušení/opakování Plex. Prošly TypeScript, jednotková fixture přístupnosti, cílený lint, ES5 a kontrola rozpočtu balíků. Úplný běh v prohlížeči nad tímto sestavením skončil s **194 úspěšnými testy a jedním přeskočeným**: nativní HLS vyžaduje WebKit, zatímco tento běh používal Chromium. Hostované CI a dohodnuté pořadí sloučení zůstávají oddělenými kroky.

Zbývající řetězec `test:port` a `test:unified` byl dokončen v navazujících úsecích po opravě jednotlivých testovacích fixtures. Každý neúspěšný cíl byl úspěšně spuštěn znovu a zbývající příkazy doběhly úspěšně; nejde o tvrzení, že proběhl jeden nepřerušený běh `npm test`. Přesný krok CI mostu Android s devíti příkazy také prošel místně.

Pro Android `be0d800` místně prošlo **101 testů aplikace a 62 testů sdíleného jádra**, stejně jako lint debug/release, sestavení APK Debug/Release/Full, vydávaného bundlu a kompilace APK androidTest. Kompilace APK instrumentovaných testů neznamená jejich spuštění na zařízení. Tři potvrzené připomínky revize byly zodpovězeny a vyřešeny v [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68). Tento PR prošel kontrolami a byl sloučen jako `5b644b94`; CI po sloučení se sleduje zvlášť. Diagram ponechává celkový krok CI/vydání přehrávače otevřený.

Celkový webový JavaScript se změnil z **964,459 / 305,344** bajtů raw/gzip na **995,858 / 315,207**: **+31,399 / +9,863 bajtů** (asi 3.26% / 3.23%). Funkční kandidát měl 995,587 / 315,103; následné zpevnění přidalo 271 / 104. Konečný hlavní vstupní soubor tohoto snímku má 875,197 / 270,425. Viz [výchozí měření](evidence/roadmap-size-20261015.json), [měření konečného artefaktu](evidence/roadmap-final-size-20261015.json) a [metoda měření](roadmap-size.cs.md). Čárky v těchto počtech bajtů oddělují tisíce.

Jde o historické bajtové náklady JavaScriptu, **nikoli změřené zrychlení**. Součty neobsahují multimediální enginy, slovníky, CSS, obrázky ani video. Balíky daného snímku zvlášť obsahovaly A/V klip o 464,652 bajtech. Po [změně hostingu](audio-video-check.cs.md) zůstává `diagnostics/av-v1.mp4` v repozitáři s generátorem a ověřovačem kvůli reprodukovatelnosti, ale je vyřazen z balíků Web/OTTPlay Server, Tauri, Capacitor a Docker. Přehrávač jej stahuje z here.now pouze pro výslovnou kontrolu A/V, která potřebuje internet; při zahájení běžného přehrávání jej nestahuje. Odstranění 464,652 nekomprimovaných mediálních bajtů neurčuje úsporu v komprimovaných instalátorech ani nemění historická měření JavaScriptu. Doba spuštění, pravidelnost snímků, paměť, práce čtečky obrazovky, skutečný zvuk HDMI a chování poskytovatelů potřebují vlastní měření na cílových zařízeních. Zpráva netvrdí nový výsledek na fyzickém zařízení ani vydání bety. [Seznam fyzické přejímky](roadmap-delivery.cs.md#physical-acceptance-before-promotion) a [strategie vydávání](../RELEASING.md) zůstávají kritérii povýšení.

<a id="post-beta-integration-and-review"></a>

## Integrace a revize po betě

Po vydání beta.4 byl do této větve integrován zdroj `39287792`. Běhová revize `9663b681` také opravuje návrat na živý okraj při omezeních kvality HLS a umožňuje obnovu poškozeného žurnálu nastavení před normálním startem. Obnovovací obrazovka blokuje částečné načtení stavu účtu, umožňuje opakování a potvrzený reset, zachovává nesouvisející cookies a brání návratu starých nastavení z cookies po resetu. Viz [proces obnovy](settings-recovery.cs.md) a jeho diagram SVG.

![Úplné porovnání JavaScriptu po betě](diagrams/post-beta-size.svg)

Reprodukce obou zdrojů pomocí Node 26.8.2, Rollup 4.64.5 a Terser 5.51.2 dává **964,876 / 305,452** bajtů raw/gzip pro zdroj beta.4 a **1,000,388 / 316,600** pro integraci: **+35,512 / +11,148 bajtů** (3.68% / 3.65%). Součty zahrnují všechny volitelné poskytovatele: sedm ve výchozí verzi a osm v integraci. Nový vstup má 879,533 / 271,761. Jde o samostatné porovnání odlišné od výše zmrazených grafů.

Obě místní produkční sestavení znovu generují pět sledovaných běhových souborů a neuvádějí tvrzení o čisté zdrojové revizi. Zprávy toto omezení zaznamenávají místo vydávání těchto místních souborů za publikované artefakty: [výchozí stav](evidence/post-beta-baseline-size-20261015.json) a [integrace](evidence/post-beta-candidate-size-20261015.json). Integrační sestavení i kontroly ES5/nativního kódu procházejí. Prochází také šest cílených kontrol prohlížeče: obnova/reset žurnálu, klávesnicové chování dialogů, ukazatel LG webOS a NetCast, dvouklikový výběr PC a čekání Plex s vlastníkem.

<a id="browser-gate-integration"></a>

## Integrace prohlížečových kontrol

![Potvrzené výsledky místního ověření prohlížečů](diagrams/browser-verification-results.svg)

Zdroj `c52f4d07` obsahuje PR 779 z main `1ecbc0e7`. Zachovány jsou testovací příkazy, kontroly obnovy a tvrzení dialogů Plex z obou větví. Procházejí TypeScript, lint, dokumentace, smlouvy balení/linkeru, produkční sestavení a úplné kontroly zkompilovaných balíků. Všech 27 vytvořených JavaScriptových souborů přehrávače/poskytovatelů zůstává bajtově shodných s výše měřenými artefakty. Úplná sada testů zařízení/prohlížečů končí s **196 úspěšnými testy a jedním očekávaným přeskočením v Chromium** pro nativní HLS, které vyžaduje WebKit.

Přesný zabalený archiv Mode A byl rozbalen až po kontrole zdroje, kontrolního součtu a inventáře balíků/poskytovatelů. Chromium 156.0.8078.4, Firefox 157.0 a WebKit 27.2 každý zvládl všech pět profilových scénářů bez přeskakování a opakování: **15 místních úspěchů** s Playwright 1.64.0. Skutečný hostitel měl macOS 26.7.1, nikoli runner `macos-15` uvedený ve zvolených profilech. Protokoly tento rozdíl výslovně zaznamenávají a **nejsou kvalifikací hostované matice ani vydání**. Viz [místní souhrn](evidence/post779-local-acceptance/summary.json) a [návod k reprodukci](evidence/post779-local-acceptance/reproduce.sh), který očekává existující produkční sestavení a odmítá přepsat adresář rozbaleného kandidáta.

[Pravidla prohlížečů](browser-compatibility.cs.md) vyžadují pět hostovaných cílů a 25 provedení scénářů pro kontroly PR/bety; úplný RC má 35 cílů a 166 provedení. Jde o nastavené požadavky, nikoli změřené pokrytí.

![Jak ověření kandidáta vytváří důkazy](diagrams/candidate-verification-flow.svg)

Samostatná [beta pipeline](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) pro main `1ecbc0e7` skončila úspěšně. Tento PR neobsahuje. Integrace stále potřebuje vlastní úspěšné hostované CI a revizi, poté koordinaci vydání; uvedené místní výsledky netvrdí, že tyto dodací kontroly prošly.

<a id="delivery"></a>

## Dodání

- [Přehrávač, dokumentace a i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Řídicí server a CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Preference stop Androidu — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

Tyto PR nesou aktuální stav CI a sloučení. Změna přehrávače následuje po dohodnutých současných opravách Plex a jejich betě jako samostatná vlna dodání.

# Ruční kontrola zvuku a obrazu

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Obnova streamu](playback-stream-policy.cs.md) · [Specifikace vzorku](../diagnostics/README.md)

Pomocí **nabídka přehrávače → Informace → Zvuk → Přehrát** ověřte obraz a zvuk na známém osmivteřinovém klipu. Toto je zvuková kontrola A/V; ukázka pohyblivého vzoru při úvodním seznámení je tichá.

![Kontrola A/V: zdroj v repozitáři, hostovaný klip a výslovné přehrání](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## Spuštění kontroly

1. Nastavte televizi, reproduktory nebo sluchátka na příjemnou hlasitost. Kontrola používá aktuální hlasitost přehrávače a dočasně zapne zvuk jeho videa; nezvyšuje systémovou hlasitost televize.
2. Otevřete nabídku přehrávače, zvolte **Informace**, potom **Zvuk** a **Přehrát**. Samotné otevření nabídky klip nestahuje ani nepřehrává.
3. Sledujte obrazovku a poslouchejte níže uvedenou sekvenci. Pro dřívější ukončení použijte **Informace → Zvuk → Zastavit**.

Kontrola používá spravovanou hlavní cestu HTML5, když je přehrávač nečinný nebo se živá televize přehrává či je pozastavena. Odmítne aktivní požadavek VOD/archivu, dosud načítaný živý požadavek a pohotovostní režim. Není dostupná ani tehdy, když adaptér zařízení nahrazuje hlavní engine, včetně **PC2/Video.js** a nativních náhrad enginu; pouhé použití prvku HTML5 video nezajišťuje způsobilost adaptéru. Odmítnutí nenahradí probíhající přehrávání. Pro test z nečinnosti nejdříve zastavte aktuální požadavek; tím kontrolu na těchto adaptérech nezpřístupníte. Popisky nabídek odpovídají zvolenému jazyku rozhraní.

<a id="what-you-should-see-and-hear"></a>

## Co byste měli vidět a slyšet

Na pozadí se pohybuje testovací vzor. Krátké bílé značky blikají v horní levé nebo pravé polovině v rytmu tichých zvukových impulzů dlouhých přibližně 150 ms:

- **0–2 sekundy:** každou sekundu impulz 440 Hz v levém kanálu s bliknutím levé značky.
- **2–4 sekundy:** impulz 880 Hz v pravém kanálu s pravou značkou.
- **4–6 sekund:** pulzují oba kanály s oběma značkami.
- **6–8 sekund:** vzor se dál pohybuje beze zvuku. Toto ticho je záměrné.

Monofonní televize nebo sloučení kanálů může přehrát oba kanály jedním reproduktorem. Fyzickou obrazovku a zvukový výstup zkontrolujte sami. Přehrávač neměří výstup reproduktorů ani nevydává automatický výsledek A/V uspěl/neuspěl.

<a id="where-the-clip-comes-from"></a>

## Odkud klip pochází

Přehrávač používá tuto absolutní adresu HTTPS:

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Klip požaduje pouze po volbě **Přehrát**, nikdy jako přednačítání při spuštění. Soubor má **464 652 bajtů**, video H.264 baseline 640×360 / 25 fps a stereofonní zvuk AAC. Je vyloučen z balíčků Web, OTTPlay Server, Tauri, Capacitor a kontejnerů. [Zdrojový soubor](../diagnostics/av-v1.mp4), generátor a ověřovač zůstávají v repozitáři; nejsou offline náhradou v nainstalovaném přehrávači.

Je nutný internet a funkční spojení HTTPS s tímto hostitelem. Není přibalena záloha ani alternativní diagnostické URL. Otevření odkazu v prohlížeči může ověřit dostupnost souboru, ale netestuje vlastnictví dekodéru přehrávače ani návrat ke kanálu. Hostingová služba dostává běžné údaje o spojení; viz [podrobnosti o soukromí](privacy-policy.md#optional-hosted-audio-video-check).

<a id="how-playback-returns"></a>

## Jak se přehrávání vrací

Kontrola používá hlavní dekodér a dočasně nahrazuje živý obraz. Končí na konci klipu, po **Zvuk → Zastavit** nebo při chybě média. **Bezpečnostní limit 15 sekund začíná přijetím kontroly** a zahrnuje načítání; pomalé stahování tak může skončit dříve, než se přehraje všech osm sekund.

V těchto případech se přehrávač pokusí obnovit zachycený živý požadavek na aktuálním živém okraji včetně stavu pozastavení, pouze pokud požadavek stále patří aktuálnímu zdroji a nepřevzalo jej jiné přehrávání. Živé URL se znovu vyřeší; obnova stále závisí na poskytovateli a síti. Kontrola z nečinnosti se vrací do nečinnosti.

Běžný příkaz přehrávání **Stop**, pohotovostní režim nebo výběr jiného kanálu kontrolu zruší bez opětovného spuštění zachyceného kanálu. Změna zdroje nebo jeho relace také brání zastaralé obnově. Při ukončení kontrola vrátí své dočasné zapnutí zvuku; pokud zvuk během ní ztlumíte, ztlumení zůstane účinné. Nemění uloženou předvolbu enginu, nezapisuje testovací sekundy do historie kanálu ani neodesílá operačnímu systému falešné ukončení kanálu nebo testovací metadata.

<a id="if-the-result-is-unexpected"></a>

## Pokud je výsledek neočekávaný

- **Kontrolu nelze spustit:** ověřte, že přehrávač je nečinný nebo na již přehrávaném/pozastaveném živém kanálu se spravovanou hlavní cestou HTML5 bez náhrady enginu zařízením. Nepodporovaný stav nebo chyba média může zobrazit **“Stream could not be played”**.
- **Nic se nenačte nebo kontrola končí brzy:** ověřte internet a přímý odkaz HTTPS. Síťová chyba nebo vypršení limitu není důkazem poruchy dekodéru či reproduktorů. Před novým přehráním obnovte spojení.
- **Obraz bez zvuku:** poslední dvě sekundy jsou záměrně tiché. Během prvních šesti sekund ověřte ztlumení/hlasitost přehrávače, hlasitost televize, zvolený zvukový výstup a připojení reproduktorů/sluchátek.
- **Hraje jen jeden fyzický reproduktor:** nejdříve ověřte, zda televize nepoužívá mono výstup nebo sloučení kanálů, než to označíte za chybu směrování kanálů.

Jde o krátkou kontrolu známého MP4 přes spravovanou hlavní obrazovou/zvukovou cestu HTML5. Nedokazuje funkčnost streamu poskytovatele, HLS/DASH, DRM, vícekanálového zvuku ani vyššího rozlišení a neměří kapacitu sítě nebo zpoždění synchronizace. Kvalitativní stropy a nastavení živých záložních streamů tento diagnostický klip nemění.

Vlastnictví a úklid ověřují [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) a [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs). Automatické kontroly dekódování a životního cyklu nenahrazují sledování a poslech na skutečném zařízení; tento průvodce netvrdí žádný nový výsledek z fyzického zařízení.

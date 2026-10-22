# Limity kvality a obnova živých streamů

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Vlastnictví dekodéru](device-media-backend.md)

Spravovaný přehrávač HTML5/HLS/Shaka si při obnově po chybě zdroje ponechává jediné oprávnění k přehrávání. Pro živý kanál může využít také až tři výslovně nastavené záložní URL. Kanál nikdy nevyhledává, neodhaduje ani nenahrazuje podle názvu.

![Obnova: jedno oprávnění, konečný počet pokusů a výslovné zálohy](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Nastavení horního limitu kvality

Otevřete **Nastavení → Nastavení rozhraní** a nastavte **Maximální výšku videa (HLS/Shaka)** a/nebo **Maximální datový tok streamu (HLS/Shaka)**. Obě omezení platí současně. **Automaticky** příslušné omezení odstraní. Podporovány jsou hodnoty 360/480/720/1080/2160 pixelů a 1/2/4/8/16 Mbps. Nastavení se ukládají místně, účastní se běžného postupu uložit/zrušit a projeví se při příštím spuštění přehrávání včetně restartu při obnově.

Jde o stropy, nikoli nastavení překódování. Stream pouze v 1080p se nemůže změnit na 720p. Pokud žádná oznámená varianta nevyhovuje, přehrávač zobrazí **No stream meets the quality limits** a přestane požadavek opakovat. Neznámá výška/datový tok nedokazují, že omezená varianta HLS vyhovuje.

Filtrování variant HLS probíhá před načítáním fragmentů. Aktuální hls.js nevhodné varianty odstraňuje; starší sestavení bez `removeLevel` mohou zachovat pouze bezpečný souvislý začátek a mohou odmítnout manifest s jinak vhodnými pozdějšími variantami. Shaka používá aplikační omezení `maxHeight`/`maxBandwidth`. Automatické přizpůsobování pokračuje mezi zbývajícími variantami.

Nastavení platí pro spravované enginy HLS a Shaka. Prosté HTML5, nativní dekodéry platformy a zachované enginy TV/STB neposkytují stejné ovládání. Auto může zvolit nativní přehrávání; nastavení je nenutí do MSE. Přehrávač nepřevede již omezený požadavek HLS na neomezené nativní přehrávání jen proto, aby obešel chybu dekódování. Neznamená to nativní transkodér, automatický hardwarový benchmark ani tvrzení o fyzickém výstupu 720p.

<a id="configure-explicit-backups"></a>

## Nastavení výslovných záloh

1. Spusťte požadovaný živý kanál.
2. Otevřete **Informace → Záložní streamy**.
3. Vyberte pozici 1, 2 nebo 3 a zadejte úplné HTTP/HTTPS URL média.
4. Obsazenou pozici znovu otevřete pro **Úpravu** nebo **Odstranění**. Pro použití nového seznamu kanál znovu spusťte.

Každá pozice patří aktuálnímu jmennému prostoru úložiště poskytovatele a přesné dvojici `sourceId`/`channelId`. Editor je omezen aktuální generací přehrávání a konfigurací zdroje. Přepnutí zdroje při otevřeném dialogu zabrání tomu, aby dialog uložil data do nového zdroje. Souběžná změna stejné pozice je odmítnuta, nikoli přepsána.

První URL zůstává běžným zdrojem kanálu. Duplicitní a prázdné pozice se přeskočí. Přijímá se maximálně 256 záznamů kanálů a 256 KiB konfigurace. URL s přihlašovacími údaji v user-info, bílými znaky, řídicími znaky, zpětnými lomítky nebo neplatným portem jsou odmítnuta. Tokeny poskytovatele v parametrech dotazu mohou stále být součástí URL média: zálohy jsou místní konfigurací zdroje, nikoli mechanismem sdílení nebo zveřejnění přihlašovacích údajů.

Zálohy platí **jen pro živé vysílání**. Archivní požadavky a VOD nikdy nepoužijí živou alternativu: nahrávka, časový počátek, práva a význam posunu se mohou lišit. Vlastník musí dodat rovnocenné autorizované živé adresy. Shodný název kanálu není důkazem rovnocennosti. Uložená identita kanálu, oblíbené a vazba EPG zůstávají při změně transportního koncového bodu beze změny.

<a id="recovery-guarantees"></a>

## Záruky obnovy

- Požadavek má celkem nanejvýš **dva odložené přechodné pokusy na stejném URL** a nejvýše jeden postup vpřed ke každé ze tří záložních pozic: maximálně pět nových vytvoření po počátečním spuštění. Nová instance dekodéru ani úspěšný manifest tento rozpočet nevynulují. Existující omezená síťová a dekódovací obnova uvnitř HLS probíhá před touto vnější politikou.
- Chyby parsování manifestu/úrovně HLS dovolují nanejvýš jedno opětovné připojení ke stejnému URL na požadavek, započtené do stejného limitu dvou pokusů. Nový dekodér ani záložní koncový bod limit nevynulují.
- Síťové chyby bez statusu, HTTP 408/429 a 5xx mohou využít přechodný rozpočet. Jiné HTTP 4xx mohou přejít k nastavené alternativě, ale neopakují stejné URL. **HTTP 401/403 a chyby přihlášení ke zdroji požadavek ukončí**, bez zkoušení alternativních údajů nebo záložních bodů.
- Chyby dekódování mohou postoupit k výslovné záloze. Nesplnitelné limity kvality požadavek ukončí. Nedochází k cyklickému návratu k hlavnímu zdroji.
- Prodleva je 500 ms, 1 s, 1.5 s a poté nejvýše 2 s. Opakované callbacky se slučují.
- Pause odstraní naplánovaný časovač, ale zachová čekající pokus; Resume jej naplánuje znovu. Stop, pohotovostní režim a výměna zdroje nebo kanálu zneplatní odložené callbacky. Konečně neúspěšný požadavek vyžaduje výslovný opětovný výběr namísto automatického přehrávání vyřazeným dekodérem.
- Chyby načítání Shaka a kritické chybové události sdílejí tuto cestu; chyby zrušení se ignorují. Opětovné připojení čeká na asynchronní zničení Shaka.
- Obnova znovu přeloží neprůhledný odkaz Stalker a připraví chráněný přístup ke zdroji. Nepoužívá znovu prošlé iOS loopback URL. Pozice VOD/archivu se zachytí před odstraněním; živé zálohy začínají na aktuálním živém okraji.

Politika nepřidává druhý dohled nad zastavenými snímky. Existující obnova kiosk, Auto/native a HLS nadále řeší vlastní pozorované chyby. Stream, který se tiše zastaví, aniž některý existující detektor oznámí chybu, potřebuje samostatnou diagnostiku.

<a id="verification-and-observability"></a>

## Ověření a pozorovatelnost

`window.__ottStreamPolicy.snapshot()` zpřístupňuje název enginu, požadovaná omezení, možnosti/dostupnost, počet pokusů, index koncového bodu a stav obnovy. Neobsahuje URL streamu ani přihlašovací údaje poskytovatele. Index nula označuje běžný zdroj; vyšší indexy neprázdné jedinečné alternativy. Jde o diagnostický stav, ne stabilní API vzdáleného ovládání.

Spusťte:

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

Testy ověřují filtrování kvality s nemonotónním pořadím variant, nedostupná metadata, editaci omezenou zdrojem, konflikty pozic, duplicitní chyby, omezené rozpočty, chyby HTTP autorizace, zrušení pauzou/zastavením/zdrojem, odstranění Shaka a zachování pozice VOD. Pět nových popisků přehrávání je přeloženo ve všech 88 dodávaných jazykových balíčcích; automatická shoda není revize rodilým mluvčím. Fyzické přehrávání TV/D1 a manifesty konkrétních poskytovatelů stále vyžadují ověření na zařízení. [Upravitelný zdroj diagramu](diagrams/stream-recovery.mmd).

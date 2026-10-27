# Limity jakości i odzyskiwanie transmisji na żywo

<!-- language-navigation:start -->
<p dir="ltr">
<a href="playback-stream-policy.md" lang="en" dir="ltr">English</a> · <a href="playback-stream-policy.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="playback-stream-policy.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="playback-stream-policy.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="playback-stream-policy.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="playback-stream-policy.es.md" lang="es" dir="ltr">Español</a> · <a href="playback-stream-policy.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="playback-stream-policy.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="playback-stream-policy.he.md" lang="he" dir="rtl">עברית</a> · <a href="playback-stream-policy.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="playback-stream-policy.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="playback-stream-policy.it.md" lang="it" dir="ltr">Italiano</a> · <a href="playback-stream-policy.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="playback-stream-policy.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="playback-stream-policy.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="playback-stream-policy.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="playback-stream-policy.pt.md" lang="pt" dir="ltr">Português</a> · <a href="playback-stream-policy.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="playback-stream-policy.th.md" lang="th" dir="ltr">ไทย</a> · <a href="playback-stream-policy.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="playback-stream-policy.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="playback-stream-policy.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="playback-stream-policy.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="playback-stream-policy.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Własność dekodera](device-media-backend.md)

Zarządzany odtwarzacz HTML5/HLS/Shaka zachowuje jedno uprawnienie do odtwarzania podczas odzyskiwania po awarii źródła. Może również korzystać z maksymalnie trzech jawnie skonfigurowanych zapasowych URL dla kanału na żywo. Nigdy nie wyszukuje, nie odgaduje ani nie zastępuje kanału na podstawie jego tytułu.

![Odzyskiwanie: jedno uprawnienie, skończone próby i jawne zapasy](diagrams/stream-recovery.svg)

<a id="set-a-quality-ceiling"></a>

## Ustawienie limitu jakości

Otwórz **Ustawienia → Ustawienia interfejsu** i ustaw **Maksymalną wysokość wideo (HLS/Shaka)** i/lub **Maksymalną przepływność strumienia (HLS/Shaka)**. Oba ograniczenia obowiązują razem. **Automatycznie** usuwa dane ograniczenie. Obsługiwane wartości to 360/480/720/1080/2160 pikseli i 1/2/4/8/16 Mbps. Ustawienia zapisują się lokalnie, podlegają zwykłemu zapisywaniu/anulowaniu i działają od następnego rozpoczęcia odtwarzania, także po restarcie odzyskiwania.

To górne limity, a nie ustawienia transkodowania. Strumień dostępny tylko w 1080p nie zmieni się w 720p. Jeśli żaden zgłoszony wariant nie pasuje, odtwarzacz wyświetla **No stream meets the quality limits** i przestaje ponawiać żądanie. Nieznana wysokość/przepływność nie dowodzi, że ograniczony wariant HLS spełnia warunki.

Filtrowanie wariantów HLS następuje przed ładowaniem fragmentów. Obecny hls.js usuwa nieodpowiednie warianty; starsze kompilacje bez `removeLevel` mogą zachować tylko bezpieczny ciągły prefiks i mogą odrzucić manifest z pasującymi wariantami w dalszej części. Shaka stosuje ograniczenia aplikacji `maxHeight`/`maxBandwidth`. Automatyczna adaptacja trwa wśród pozostałych wariantów.

Ustawienia dotyczą zarządzanych silników HLS i Shaka. Zwykły HTML5, natywne dekodery platform i zachowane silniki TV/STB nie udostępniają takich samych elementów sterowania. Auto może wybrać odtwarzanie natywne; ustawienie nie wymusza MSE. Odtwarzacz nie przeniesie już ograniczonego żądania HLS do nieograniczonego odtwarzania natywnego tylko po to, by ominąć błąd dekodowania. Nie oznacza to natywnego transkodera, automatycznego benchmarku sprzętu ani zapewnienia fizycznego wyjścia 720p.

<a id="configure-explicit-backups"></a>

## Konfiguracja jawnych zapasów

1. Uruchom wybrany kanał na żywo.
2. Otwórz **Informacje → Strumienie zapasowe**.
3. Wybierz pozycję 1, 2 lub 3 i wpisz pełny URL multimedialny HTTP/HTTPS.
4. Otwórz zajętą pozycję ponownie, aby **Edytować** lub **Usunąć**. Uruchom kanał ponownie, aby użyć nowej listy.

Każda pozycja należy do bieżącej przestrzeni przechowywania dostawcy i dokładnej pary `sourceId`/`channelId`. Bieżąca generacja odtwarzania i konfiguracja źródła ograniczają edytor. Zmiana źródła przy otwartym oknie uniemożliwia zapis z tego okna do nowego źródła. Równoczesna zmiana tej samej pozycji jest odrzucana zamiast nadpisywana.

Pierwszy URL pozostaje zwykłym źródłem kanału. Powtórzone i puste pozycje są pomijane. Akceptuje się maksymalnie 256 rekordów kanałów i 256 KiB konfiguracji. Odrzucane są URL z poświadczeniami w user-info, białymi znakami, znakami sterującymi, odwrotnymi ukośnikami lub nieprawidłowym portem. Tokeny dostawcy w zapytaniu mogą nadal należeć do URL mediów: ustawienia zapasowe to lokalna konfiguracja źródła, nie mechanizm udostępniania lub publikowania poświadczeń.

Zapasy działają **tylko na żywo**. Żądania archiwalne i VOD nigdy nie używają alternatywy na żywo: nagranie, początek osi czasu, prawa i semantyka przewijania mogą się różnić. Właściciel musi podać równoważne autoryzowane punkty na żywo. Taki sam tytuł kanału nie dowodzi równoważności. Zapisana tożsamość kanału, ulubione i powiązanie EPG nie zmieniają się przy zmianie punktu transportowego.

<a id="recovery-guarantees"></a>

## Gwarancje odzyskiwania

- Żądanie ma łącznie najwyżej **dwie opóźnione próby przejściowe tego samego URL** i najwyżej jedno przejście naprzód do każdej z trzech pozycji zapasowych: maksymalnie pięć odtworzeń po pierwszym uruchomieniu. Nowa instancja dekodera lub poprawny manifest nie zerują budżetu. Istniejące ograniczone odzyskiwanie sieci i dekodowania wewnątrz HLS następuje przed tą zewnętrzną polityką.
- Błędy analizy manifestu/poziomu HLS pozwalają na najwyżej jedno ponowne połączenie do tego samego URL na żądanie, wliczone do łącznego limitu dwóch prób. Nowy dekoder lub punkt zapasowy nie zerują limitu.
- Błędy sieci bez statusu, HTTP 408/429 i 5xx mogą użyć budżetu przejściowego. Inne HTTP 4xx mogą przejść do skonfigurowanej alternatywy, ale nie ponawiają tego samego URL. **HTTP 401/403 i błędy logowania do źródła kończą żądanie**, bez prób alternatywnych poświadczeń ani punktów zapasowych.
- Błędy dekodowania mogą przejść naprzód do jawnego zapasu. Niemożliwe limity jakości kończą żądanie. Nie ma cyklicznego powrotu do głównego źródła.
- Opóźnienie wynosi 500 ms, 1 s, 1.5 s, a następnie najwyżej 2 s. Powtarzające się wywołania zwrotne są scalane.
- Pause usuwa zaplanowany timer, zachowując oczekującą próbę; Resume planuje go ponownie. Stop, czuwanie i zmiana źródła lub kanału unieważniają opóźnione wywołania. Żądanie zakończone ostateczną porażką wymaga jawnego ponownego wyboru, a nie automatycznego uruchomienia wycofanego dekodera.
- Błędy ładowania Shaka i krytyczne zdarzenia błędów korzystają z tej samej ścieżki; błędy anulowania są ignorowane. Ponowne podłączenie czeka na asynchroniczne zniszczenie Shaka.
- Odzyskiwanie ponownie rozwiązuje nieprzejrzyste odwołanie Stalker i przygotowuje dostęp do chronionego źródła. Nie używa ponownie wygasłego URL loopback iOS. Pozycja VOD/archiwum jest próbkowana przed demontażem; zapasy na żywo zaczynają w swoim bieżącym punkcie transmisji.

Opcjonalne odzyskiwanie na podstawie zegara multimediów transmisji na żywo opisano poniżej. Istniejące mechanizmy odzyskiwania kiosk, Auto/native i HLS zachowują własny zakres i zachowanie silnika.

<a id="verification-and-observability"></a>

## Weryfikacja i obserwowalność

`window.__ottStreamPolicy.snapshot()` pokazuje nazwę silnika, żądane limity, możliwości/dostępność, liczbę prób, indeks punktu i stan odzyskiwania. Nie zawiera URL strumienia ani poświadczeń dostawcy. Indeks zero oznacza zwykłe źródło; kolejne odnoszą się do niepustych unikalnych alternatyw. To stan diagnostyczny, nie stabilne API zdalnego sterowania.

Uruchom:

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

Testy sprawdzają filtrowanie jakości przy niemonotonicznej kolejności wariantów, niedostępne metadane, edycję w zakresie źródła, konflikty pozycji, zduplikowane błędy, ograniczone budżety, błędy autoryzacji HTTP, anulowanie przez pauzę/stop/źródło, demontaż Shaka i zachowanie pozycji VOD. Pięć nowych etykiet odtwarzania przetłumaczono we wszystkich 88 dostarczanych pakietach językowych; automatyczna zgodność nie jest korektą przez rodzimych użytkowników języka. Fizyczne odtwarzanie TV/D1 i manifesty konkretnych dostawców nadal wymagają walidacji na urządzeniu. [Edytowalne źródło diagramu](diagrams/stream-recovery.mmd).

<a id="live-stall-recovery"></a>

## Odzyskiwanie zatrzymanej transmisji na żywo

W **Ustawienia → Ustawienia interfejsu** wybierz **Próby odzyskiwania transmisji na żywo** (0–5) oraz **Limit czasu zatrzymania transmisji, s** (10/15/20/30). Domyślne wartości to 0 prób i 15 sekund. Zero wyłącza tylko ten mechanizm nadzoru; istniejące odzyskiwanie po błędach silnika pozostaje bez zmian. Ustawienia korzystają ze zwykłego trybu Zapisz/Anuluj.

Po potwierdzeniu postępu odtwarzania zatrzymanie zegara multimediów głównej transmisji na żywo wywołuje istniejące `backend.restart()`. Pauza, zmiana pozycji, ukryte strony, stan offline i kiosk wstrzymują obserwację; archiwum, VOD i ścieżka PiP są wykluczone. Natywne PiP ukrywa HTML OSD. Zmiany kanału, źródła lub generacji anulują poprzednią obserwację. Początkowe odtwarzanie, które nigdy nie postępuje, nadal podlega istniejącej obsłudze uruchamiania i błędów. Wymiana dekodera i krótki postęp nie odnawiają puli prób: odnawia ją dziesięć sekund nieprzerwanego postępu. Wyczerpanie limitu zatrzymuje dalsze restarty nadzoru dla tego zastoju. Oczekujące odzyskiwanie silnika ma pierwszeństwo; nie można omijać ostatecznych błędów autoryzacji, DRM ani jakości. Obserwowany jest czas multimediów, a nie fizyczne wyświetlanie obrazu czy zamrożone klatki, gdy zegar multimediów nadal postępuje.

Do podstawowego testu bez abonamentu wybierz **Wypróbuj demo**. Po rozpoczęciu odtwarzania tymczasowo ustaw `document.getElementById("video").playbackRate = 0` w DevTools karty testowej; następnie przywróć wartość 1. Pauza jest celowo wykluczona z odzyskiwania po zatrzymaniu.

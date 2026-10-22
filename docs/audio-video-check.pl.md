# Ręczna kontrola dźwięku i obrazu

<!-- language-navigation:start -->
<p dir="ltr">
<a href="audio-video-check.md" lang="en" dir="ltr">English</a> · <a href="audio-video-check.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="audio-video-check.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="audio-video-check.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="audio-video-check.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="audio-video-check.es.md" lang="es" dir="ltr">Español</a> · <a href="audio-video-check.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="audio-video-check.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="audio-video-check.he.md" lang="he" dir="rtl">עברית</a> · <a href="audio-video-check.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="audio-video-check.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="audio-video-check.it.md" lang="it" dir="ltr">Italiano</a> · <a href="audio-video-check.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="audio-video-check.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="audio-video-check.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="audio-video-check.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="audio-video-check.pt.md" lang="pt" dir="ltr">Português</a> · <a href="audio-video-check.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="audio-video-check.th.md" lang="th" dir="ltr">ไทย</a> · <a href="audio-video-check.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="audio-video-check.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="audio-video-check.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="audio-video-check.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="audio-video-check.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Odzyskiwanie strumienia](playback-stream-policy.pl.md) · [Specyfikacja próbki](../diagnostics/README.md)

Wybierz **menu odtwarzacza → Informacje → Dźwięk → Odtwórz**, aby sprawdzić obraz i dźwięk przy użyciu znanego ośmiosekundowego klipu. To słyszalna kontrola A/V; demonstracja ruchomego wzoru podczas wprowadzenia jest bezgłośna.

![Kontrola A/V: źródło w repozytorium, hostowany klip i jawne odtwarzanie](diagrams/av-check-flow.svg)

<a id="start-the-check"></a>

## Rozpoczęcie kontroli

1. Ustaw komfortową głośność telewizora, głośników lub słuchawek. Kontrola używa aktualnej głośności odtwarzacza i tymczasowo włącza dźwięk jego wideo; nie zwiększa systemowej głośności telewizora.
2. Otwórz menu odtwarzacza, wybierz **Informacje**, potem **Dźwięk** i **Odtwórz**. Samo otwarcie menu nie pobiera ani nie odtwarza klipu.
3. Obserwuj ekran i słuchaj sekwencji opisanej poniżej. Aby skończyć wcześniej, wybierz **Informacje → Dźwięk → Zatrzymaj**.

Kontrola korzysta z głównej zarządzanej ścieżki HTML5, gdy odtwarzacz jest bezczynny albo telewizja na żywo jest odtwarzana lub wstrzymana. Odrzuca aktywne żądanie VOD/archiwum, wciąż ładujące się żądanie transmisji na żywo oraz stan czuwania. Jest też niedostępna, gdy adapter urządzenia zastępuje główny silnik, w tym **PC2/Video.js** i natywne zamienniki; samo użycie elementu wideo HTML5 nie czyni adaptera zgodnym. Odrzucenie nie zastępuje bieżącego odtwarzania. Aby testować z bezczynności, najpierw zatrzymaj obecne żądanie; nie włącza to kontroli na wymienionych adapterach. Nazwy menu odpowiadają wybranemu językowi interfejsu.

<a id="what-you-should-see-and-hear"></a>

## Co powinno być widoczne i słyszalne

Tłem jest ruchomy wzór testowy. Krótkie białe znaczniki błyskają w górnej lewej lub prawej połowie w rytmie cichych impulsów dźwiękowych o długości około 150 ms:

- **0–2 sekundy:** co sekundę impuls 440 Hz w lewym kanale i błysk lewego znacznika.
- **2–4 sekundy:** impuls 880 Hz w prawym kanale z prawym znacznikiem.
- **4–6 sekund:** impulsy w obu kanałach z oboma znacznikami.
- **6–8 sekund:** wzór nadal porusza się bez dźwięku. Cisza jest zamierzona.

Telewizor mono lub miksowanie w dół może odtwarzać oba kanały z jednego głośnika. Samodzielnie sprawdź fizyczny ekran i wyjście audio. Odtwarzacz nie mierzy sygnału głośników i nie wydaje automatycznego werdyktu zaliczenia/niezaliczenia A/V.

<a id="where-the-clip-comes-from"></a>

## Skąd pochodzi klip

Odtwarzacz korzysta z tego bezwzględnego adresu HTTPS:

[`https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4`](https://mantra-basin-76mq.here.now/diagnostics/av-v1.mp4)

Żąda klipu tylko po wybraniu **Odtwórz**, nigdy jako wstępnego ładowania przy uruchamianiu. Plik ma **464 652 bajty**, wideo H.264 baseline 640×360 / 25 fps i dźwięk stereo AAC. Jest wyłączony z pakietów Web, OTTPlay Server, Tauri, Capacitor i kontenerów. [Plik źródłowy](../diagnostics/av-v1.mp4), generator i weryfikator pozostają w repozytorium; nie są zapasową wersją offline w zainstalowanym odtwarzaczu.

Wymagane są internet i działające połączenie HTTPS z tym hostem. Nie ma wbudowanego zapasu ani alternatywnego URL diagnostycznego. Otwarcie powyższego linku w przeglądarce pomaga sprawdzić dostępność pliku, ale nie testuje własności dekodera odtwarzacza ani powrotu do kanału. Usługa hostingowa otrzymuje zwykłe dane połączenia; zobacz [szczegóły prywatności](privacy-policy.md#optional-hosted-audio-video-check).

<a id="how-playback-returns"></a>

## Powrót do odtwarzania

Kontrola używa głównego dekodera, tymczasowo zastępując obraz na żywo. Kończy się z końcem klipu, po **Dźwięk → Zatrzymaj** lub przy błędzie multimediów. **Limit bezpieczeństwa 15 sekund zaczyna się przy przyjęciu kontroli** i obejmuje ładowanie; powolne pobieranie może więc zakończyć ją przed odtworzeniem wszystkich ośmiu sekund.

Na tych ścieżkach odtwarzacz próbuje przywrócić zapisane żądanie transmisji na żywo do aktualnego punktu emisji wraz ze stanem pauzy, tylko jeśli żądanie nadal należy do bieżącego źródła i nie przejęło go inne odtwarzanie. URL transmisji jest rozwiązywany ponownie; przywrócenie wciąż zależy od dostawcy i sieci. Kontrola z bezczynności wraca do bezczynności.

Zwykłe polecenie odtwarzania **Stop**, czuwanie lub wybór innego kanału anulują kontrolę bez ponownego uruchomienia zapisanego kanału. Zmiana źródła lub jego sesji również zapobiega nieaktualnemu przywróceniu. Przy wyjściu kontrola cofa swoje tymczasowe włączenie dźwięku; jeżeli wyciszysz ją w trakcie, wyciszenie pozostaje. Nie zmienia zapisanej preferencji silnika, nie zapisuje sekund testowych w historii kanału ani nie przekazuje systemowi operacyjnemu fałszywego zakończenia kanału lub metadanych testu.

<a id="if-the-result-is-unexpected"></a>

## Gdy wynik jest nieoczekiwany

- **Nie można rozpocząć kontroli:** upewnij się, że odtwarzacz jest bezczynny lub na już odtwarzanym/wstrzymanym kanale na żywo z główną zarządzaną ścieżką HTML5, bez zamiany silnika przez urządzenie. Nieobsługiwany stan lub błąd multimediów może pokazać **“Stream could not be played”**.
- **Nic się nie ładuje albo kontrola kończy się wcześnie:** sprawdź internet i bezpośredni link HTTPS. Błąd sieci lub upływ limitu nie dowodzi awarii dekodera ani głośników. Przywróć łączność przed ponownym odtworzeniem.
- **Obraz bez dźwięku:** ostatnie dwie sekundy są celowo ciche. W pierwszych sześciu sprawdź wyciszenie/głośność odtwarzacza, głośność telewizora, wybrane wyjście audio i połączenie głośników/słuchawek.
- **Gra tylko jeden fizyczny głośnik:** najpierw sprawdź, czy telewizor używa wyjścia mono lub miksowania w dół, zanim uznasz to za błąd routingu kanałów.

To krótka kontrola znanego MP4 przez główną zarządzaną ścieżkę obrazu/dźwięku HTML5. Nie dowodzi działania strumienia dostawcy, HLS/DASH, DRM, dźwięku wielokanałowego ani wyższej rozdzielczości i nie mierzy przepustowości sieci ani opóźnienia synchronizacji. Limity jakości i ustawienia zapasowych strumieni na żywo nie zmieniają tego klipu diagnostycznego.

Własność i sprzątanie sprawdzają [`tests/test_media_backend.cjs`](../tests/test_media_backend.cjs) oraz [`tests/test_port_engine_lifecycle.cjs`](../tests/test_port_engine_lifecycle.cjs). Automatyczne kontrole dekodowania i cyklu życia nie zastępują patrzenia i słuchania na rzeczywistym urządzeniu; ten przewodnik nie zgłasza nowych wyników na urządzeniach fizycznych.

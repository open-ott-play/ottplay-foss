# Od listy funkcji do zweryfikowanego zachowania

<!-- language-navigation:start -->
<p dir="ltr">
<a href="implementation-report.md" lang="en" dir="ltr">English</a> · <a href="implementation-report.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="implementation-report.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="implementation-report.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="implementation-report.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="implementation-report.es.md" lang="es" dir="ltr">Español</a> · <a href="implementation-report.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="implementation-report.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="implementation-report.he.md" lang="he" dir="rtl">עברית</a> · <a href="implementation-report.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="implementation-report.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="implementation-report.it.md" lang="it" dir="ltr">Italiano</a> · <a href="implementation-report.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="implementation-report.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="implementation-report.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="implementation-report.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="implementation-report.pt.md" lang="pt" dir="ltr">Português</a> · <a href="implementation-report.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="implementation-report.th.md" lang="th" dir="ltr">ไทย</a> · <a href="implementation-report.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="implementation-report.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="implementation-report.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="implementation-report.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="implementation-report.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Kontrakty funkcji](roadmap-delivery.pl.md) · [Dane o rozmiarze](roadmap-size.pl.md)

Raport opisuje implementację i utwardzanie rozwiązania, a nie ogłasza wydania. Zmierzony stan odtwarzacza to `652726f8`; osobno zbudowany stan natywnego Androida to `be0d800`. CI, scalanie i promowanie wydania pozostają osobnymi bramkami. Późniejsze commity dotyczące wyłącznie dokumentacji lub testów nie zmieniają lokalnego sprawdzenia w dowód aktualizacji zainstalowanego urządzenia. Poniższe stany bramek odnoszą się do tych historycznych wersji; nie jest to bieżący tracker wydań. Opublikowane kompilacje są w [GitHub Releases](https://github.com/open-ott-play/ottplay-foss/releases).

![Proces implementacji i bramki odbioru](diagrams/implementation-process.svg)

<a id="how-the-work-was-checked"></a>

## Jak sprawdzano pracę

Pierwotne zlecenie podzielono na 13 użytecznych zakresów funkcjonalnych obejmujących klasyczny odtwarzacz, usługę sterowania/CLI i niezależną natywną aplikację Android. Odpowiedzialność przypisano według komponentów, aby równoległe zmiany można było oceniać i integrować bez zastępowania pracy innego komponentu. Nowy interfejs wykorzystywał istniejące przetłumaczone etykiety albo dodawał wpisy do katalogów wszystkich 88 języków; pełne instrukcje techniczne pierwotnie powstały po angielsku i rosyjsku. Główny podręcznik i sparowane przewodniki funkcji mają teraz pełne wydania w [24 językach dokumentacji](manual-translations.md).

Po implementacji nastąpił niezależny przegląd krzyżowy i wykonywalne testy regresji. Przed zmianą kodu zgłoszony problem sprawdzano na rzeczywistej ścieżce callbacku, dekodera, magazynu danych lub fokusu. Niepowodzenia testów dzielono na regresje zachowania i przestarzałe selektory. Przykładowo zmiana klasycznych wierszy z `button` na `option` wymagała aktualizacji selektorów, lecz nie uzasadniała osłabiania oczekiwanego zachowania kliknięcia.

Czyste kompilacje produkcyjne następnie sprawdzały wynikowe artefakty ES5 i pełny koszt JavaScriptu, w tym opcjonalne moduły dostawców. Ukierunkowane testy przeglądarkowe korzystały z dostarczanego loadera, pakietu i adapterów urządzeń. Natywny Android miał osobny przebieg testów Gradle, lint i pakowania. Kontrole PR i wątki przeglądu są ponownie sprawdzane po wypchnięciu zmian; poprawna kompilacja lokalna ich nie zastępuje.

<a id="what-changed-during-review"></a>

## Co zmieniło się podczas przeglądu

![Pięć naprawionych zachowań i zmierzony koszt JavaScriptu](diagrams/implementation-results.svg)

- **Parsowanie HLS i ponawianie:** błędy parsowania początkowo dzieliły ogólną klasyfikację sieciową. Teraz dopuszczają najwyżej jedno ponowne połączenie z tym samym URL w limicie dwóch prób dla błędów przejściowych; nowe dekodery i zapasowe URL go nie resetują. Końcowy błąd uwierzytelniania/DRM anuluje też już zaplanowaną próbę przejściową.
- **Natywny fallback Auto:** obsługa błędu natywnego mogła wycofać żądanie, gdy Auto już posiadało fallback. Istniejący właściciel zachowuje teraz to przejście; anulowanie nadal unieważnia jego opóźnione callbacki.
- **Enter w oknie modalnym:** automatyczny fokus na pierwszym przycisku Anuluj zmieniał Enter w oknie oczekiwania Plex w anulowanie. Okna zaczynają teraz z fokusem na samym oknie. Tab jawnie dochodzi do przycisków; zwykłe okna informacji i potwierdzenia zachowują działanie Enter i Escape/Wstecz.
- **Wybór wskaźnikiem na PC:** fokus myszy zmieniał zaznaczenie przed handlerem kliknięcia, przez co pierwszy klik aktywował. Fokus wywołany wskaźnikiem nie zaznacza już wiersza wstępnie. PC nadal najpierw wybiera, potem aktywuje; LG zachowuje działanie jednym kliknięciem. Fokus klawiatury nadal podąża za zaznaczeniem.
- **Ścieżki Androida:** wybór bez etykiety dla bieżącego elementu mógł zostać usunięty przez własne potwierdzenie Auto lub aktualizację preferencji napisów albo przejść do innego elementu z równym `TrackGroup`. Teraz przetrwa opóźnione zapisy tylko dla bieżącego elementu. Preferencje semantyczne używają języka/roli/etykiety; trwałością zarządza ViewModel, więc zamknięcie panelu nie anuluje zapisu.

Dostarczone 13 zakresów to: próbka A/V; wznawialna konfiguracja Local/Home; ograniczone odzyskiwanie; pułapy jakości; preferencje ścieżek Androida; klucze sterowania o określonym zakresie; powiązania XMLTV; filmy/seriale Xtream; klasyczna dostępność; trwałe wyniki poleceń; jawne przekazanie; strumienie zapasowe; odzyskiwalne partie ustawień. [Przewodnik funkcji](roadmap-delivery.pl.md) określa zakres i ograniczenia każdej części.

<a id="evidence-and-remaining-gates"></a>

## Dowody i pozostałe bramki

Dla `652726f8` przeszło pięć ukierunkowanych scenariuszy przeglądarkowych: nawigacja wskaźnikiem LG webOS, nawigacja LG NetCast, zachowanie dwóch kliknięć na PC, semantyka klawiatury w oknach oraz kolekcja/rozwiązywanie/anulowanie/ponawianie Plex. Przeszły TypeScript, jednostkowa fixture dostępności, lint w wybranym zakresie, ES5 i kontrole budżetu pakietu. Pełny przebieg przeglądarkowy tej kompilacji zakończył się wynikiem **194 zaliczone i jeden pominięty**: natywny HLS wymaga WebKit, a ten przebieg korzystał z Chromium. Hostowane CI i uzgodniona kolejność scalania pozostają osobnymi bramkami.

Pozostały łańcuch `test:port` i `test:unified` ukończono we wznowionych segmentach po poprawieniu pojedynczych fixtures. Każdy nieudany cel ponowiono z powodzeniem, a reszta poleceń zakończyła się poprawnie; nie jest to twierdzenie o jednym nieprzerwanym przebiegu `npm test`. Dokładny krok CI mostu Android, zawierający dziewięć poleceń, także przeszedł lokalnie.

Dla Androida `be0d800` lokalnie przeszło **101 testów aplikacji i 62 testy wspólnego rdzenia**, a także lint debug/release, budowanie APK Debug/Release/Full, pakietu wydania i kompilacja APK androidTest. Kompilacja APK testów instrumentalnych nie jest ich wykonaniem na urządzeniu. Trzy potwierdzone uwagi przeglądu otrzymały odpowiedzi i rozwiązano je w [Android PR 68](https://github.com/open-ott-play/ottplay-android/pull/68). PR przeszedł kontrole i scalono go jako `5b644b94`; CI po scaleniu jest śledzone osobno. Diagram pozostawia ogólną bramkę CI/wydania odtwarzacza jako oczekującą.

Pełny webowy JavaScript zmienił się z **964,459 / 305,344** bajtów raw/gzip na **995,858 / 315,207**: **+31,399 / +9,863 bajtów** (około 3.26% / 3.23%). Kandydat funkcjonalny miał 995,587 / 315,103; późniejsze utwardzanie dodało 271 / 104. Ostateczny główny plik wejściowy tego stanu ma 875,197 / 270,425. Zobacz [pomiar bazowy](evidence/roadmap-size-20261015.json), [pomiar końcowego artefaktu](evidence/roadmap-final-size-20261015.json) i [metodę pomiaru](roadmap-size.pl.md). Przecinki w tych liczbach bajtów oddzielają tysiące.

To historyczne koszty JavaScriptu w bajtach, **nie zmierzone przyspieszenia**. Sumy wykluczają silniki multimedialne, słowniki, CSS, obrazy i wideo. Pakiety tego stanu osobno zawierały klip A/V o rozmiarze 464,652 bajtów. Po [zmianie hostingu](audio-video-check.pl.md) plik `diagnostics/av-v1.mp4` pozostaje w repozytorium z generatorem i weryfikatorem dla odtwarzalności, ale jest wykluczony z pakietów Web/OTTPlay Server, Tauri, Capacitor i Docker. Odtwarzacz pobiera go z here.now tylko dla jawnego testu A/V wymagającego internetu; odtwarzanie przy starcie go nie pobiera. Usunięcie 464,652 surowych bajtów multimediów nie określa oszczędności w skompresowanych instalatorach ani nie zmienia historycznych pomiarów JavaScriptu. Czas startu, regularność klatek, pamięć, praca czytnika ekranu, rzeczywisty dźwięk HDMI i zachowanie dostawców wymagają własnych pomiarów na docelowych urządzeniach. Raport nie stwierdza nowego wyniku na fizycznym urządzeniu ani wydania bety. [Lista odbioru fizycznego](roadmap-delivery.pl.md#physical-acceptance-before-promotion) i [strategia wydań](../RELEASING.md) pozostają kryteriami promocji.

<a id="post-beta-integration-and-review"></a>

## Integracja i przegląd po becie

Po opublikowaniu beta.4 do tej gałęzi włączono źródła `39287792`. Rewizja wykonawcza `9663b681` naprawia też powrót do krawędzi transmisji na żywo przy limitach jakości HLS i umożliwia odzyskanie uszkodzonego dziennika ustawień przed zwykłym startem. Ekran odzyskiwania blokuje częściowe wczytanie stanu konta, obsługuje ponowienie i potwierdzony reset, zachowuje niezwiązane cookies oraz zapobiega powrotowi starych ustawień cookies po resecie. Zobacz [proces odzyskiwania](settings-recovery.pl.md) i diagram SVG.

![Pełne porównanie JavaScriptu po becie](diagrams/post-beta-size.svg)

Odtworzenie obu źródeł z Node 26.8.2, Rollup 4.64.5 i Terser 5.51.2 daje **964,876 / 305,452** bajtów raw/gzip dla źródeł beta.4 oraz **1,000,388 / 316,600** dla integracji: **+35,512 / +11,148 bajtów** (3.68% / 3.65%). Sumy obejmują wszystkich opcjonalnych dostawców: siedmiu w bazie i ośmiu w integracji. Nowy plik wejściowy ma 879,533 / 271,761. To porównanie odrębne od wcześniejszych zamrożonych wykresów.

Obie lokalne kompilacje produkcyjne odtwarzają pięć śledzonych plików wykonawczych i pomijają deklarację czystej rewizji źródłowej. Raporty zapisują to ograniczenie zamiast oznaczać lokalne pliki jako opublikowane artefakty wydania: [baza](evidence/post-beta-baseline-size-20261015.json) i [integracja](evidence/post-beta-candidate-size-20261015.json). Kompilacja integracyjna oraz kontrole ES5/natywne przechodzą. Przechodzi też sześć ukierunkowanych kontroli przeglądarkowych: odzyskanie/reset dziennika, klawiatura okien, wskaźnik LG webOS i NetCast, wybór dwoma kliknięciami na PC oraz oczekiwanie Plex z właścicielem.

<a id="browser-gate-integration"></a>

## Integracja bramki przeglądarek

![Potwierdzone wyniki lokalnej weryfikacji przeglądarek](diagrams/browser-verification-results.svg)

Źródła `c52f4d07` zawierają PR 779 z main `1ecbc0e7`. Zachowano polecenia testowe, kontrole odzyskiwania i asercje okien Plex obu gałęzi. Przechodzą TypeScript, lint, dokumentacja, kontrakty pakowania/linkera, kompilacja produkcyjna i pełne kontrole skompilowanych pakietów. Wszystkie 27 wynikowych plików JavaScript odtwarzacza/dostawców pozostaje bajtowo identycznych z wcześniej zmierzonymi artefaktami. Pełny zestaw urządzenie/przeglądarka tej kompilacji kończy się z **196 testami zaliczonymi i jednym oczekiwanym pominięciem Chromium** dla natywnego HLS wymagającego WebKit.

Dokładne spakowane archiwum Mode A rozpakowano dopiero po sprawdzeniu źródła, sumy kontrolnej i spisu pakietów/dostawców. Chromium 156.0.8078.4, Firefox 157.0 i WebKit 27.2 przeszły po pięć scenariuszy profilowych bez pominięć i ponowień: **15 lokalnych sukcesów** z Playwright 1.64.0. Rzeczywisty host miał macOS 26.7.1, a nie runner `macos-15` wskazany w wybranych profilach. Potwierdzenia jawnie zapisują tę różnicę i **nie są kwalifikacją hostowanej macierzy ani wydania**. Zobacz [lokalne podsumowanie](evidence/post779-local-acceptance/summary.json) i [przepis odtworzenia](evidence/post779-local-acceptance/reproduce.sh), który oczekuje istniejącej kompilacji produkcyjnej i odmawia zastąpienia katalogu rozpakowanego kandydata.

[Polityka przeglądarek](browser-compatibility.pl.md) wymaga pięciu hostowanych celów i 25 wykonań scenariuszy dla kontroli PR/beta; pełny RC ma 35 celów i 166 wykonań. To skonfigurowane wymagania, a nie zmierzone pokrycie.

![Jak weryfikacja kandydata tworzy dowody](diagrams/candidate-verification-flow.svg)

Osobny [pipeline beta](https://github.com/open-ott-play/ottplay-foss/actions/runs/38856793467) dla main `1ecbc0e7` zakończył się sukcesem. Nie zawiera tego PR. Integracja nadal wymaga własnego udanego hostowanego CI i przeglądu, a potem koordynacji wydania; powyższe lokalne wyniki nie twierdzą, że bramki dostarczenia zostały zaliczone.

<a id="delivery"></a>

## Dostarczenie

- [Odtwarzacz, dokumentacja i i18n — PR 781](https://github.com/open-ott-play/ottplay-foss/pull/781).
- [Serwer sterowania i CLI — PR 106](https://github.com/open-ott-play/ottplay-control-server/pull/106).
- [Preferencje ścieżek Androida — PR 68](https://github.com/open-ott-play/ottplay-android/pull/68).

Te PR przedstawiają bieżący stan CI i scalania. Zmiana odtwarzacza następuje po uzgodnionych obecnych poprawkach Plex i ich becie jako osobna fala dostarczenia.

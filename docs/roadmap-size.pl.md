<a id="measured-javascript-cost"></a>

# Zmierzony koszt JavaScriptu

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-size.md" lang="en" dir="ltr">English</a> · <a href="roadmap-size.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-size.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-size.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-size.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-size.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-size.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-size.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-size.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-size.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-size.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-size.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-size.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-size.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-size.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-size.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-size.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-size.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-size.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-size.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-size.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-size.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-size.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-size.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Przewodnik po funkcjach](roadmap-delivery.pl.md) · [Surowe dane](evidence/roadmap-size-20261015.json)

![Porównanie całego JavaScriptu odtwarzacza przy użyciu tych samych narzędzi](diagrams/roadmap-size.svg)

Ta strona zachowuje pomiary JavaScriptu z poniższych migawek kodu. Nie mierzą one bieżącej rewizji, pakietów instalacyjnych ani ruchu sieciowego.

W początkowym porównaniu główny punkt wejścia i wszystkie opcjonalne rodziny dostawców urosły o **31 128 bajtów bez kompresji / 9 759 bajtów gzip**, czyli około **3.23% / 3.20%**. To wzrost kosztu funkcji, nie deklaracja zmniejszenia rozmiaru lub przyspieszenia wykonania. Xtream nadal ładuje się na żądanie; przeniesienie go poza punkt wejścia nie usuwa go z sumy.

Pomiar porównuje czyste archiwa źródeł `bbf9ca7b` i `cae971da`, oba w wersji 1.1.55, z Node 26.8.2, TypeScript 5.9.3, Terser 5.51.2 i zlib 1.2.12. Używa produkcyjnego narzędzia składania ES5, optymalizatora, zasad nazewnictwa i poprawnej tożsamości czystych źródeł. Poziom gzip 9 stosuje się osobno do każdego wygenerowanego zasobu.

- Wejście webowe: 848 092 / 262 392 → 874 926 / 270 321 bajtów bez kompresji/gzip.
- Wejście webowe + wszyscy dostawcy: 964 459 / 305 344 → 995 587 / 315 103.
- Wejście natywne: 848 050 / 262 460 → 874 884 / 270 372.
- Wejście natywne + wszyscy dostawcy: 964 417 / 305 412 → 995 545 / 315 154.
- Opcjonalne M3U rośnie o 184 bajty bez kompresji / 82 gzip; nowe Xtream ma 4 110 / 1 748. Pozostałe sześć opcjonalnych rodzin jest identycznych bajt po bajcie.

Przed przeniesieniem klipu do here.now zmiana jego URL na lokalną ścieżkę od katalogu głównego dodała w tej historycznej sekwencji jeden bajt JavaScriptu bez kompresji. Nie mierzy to późniejszego hostowanego URL. Poprawka ograniczonych ponowień parsowania HLS dodaje 37 bajtów bez kompresji / 36 gzip w izolowanym porównaniu tej samej migawki ([dowód](evidence/parse-recovery-size-20261015.json)). Poprawka własności natywnego przekazania Auto dodaje kolejne 101 bajtów bez kompresji / 39 gzip ([dowód](evidence/auto-recovery-size-20261015.json)). Wynikowa suma przed poprawkami regresji dostępności wynosi 995 726 bajtów bez kompresji; tożsamość kompilacji i bajty gzip mogą się zmienić w końcowym commicie. Ostateczne `build/reports/classic-bundle.json` i `npm run check:size` pozostają miarodajne dla dokładnej dostarczonej rewizji. Kolejna czysta kompilacja `652726f8`, obejmująca poprawki fokusu wskaźnika i dialogów, mierzy **995 858 bajtów bez kompresji / 315 207 gzip** dla całego odtwarzacza webowego ([dowód końcowego artefaktu](evidence/roadmap-final-size-20261015.json)). Wejście ma 875 197 / 270 425; sumy natywne to 995 816 / 315 259. Limity tej migawki zachowały poprzedni zapas dla środowiska natywnego/Node/przyrostka wydania: 875 300 bez kompresji / 271 600 gzip dla wejścia; 996 100 / 316 400 dla wejścia + dostawców.

<a id="post-beta-integration"></a>

## Integracja po becie

![Cały JavaScript po integracji beta.4](diagrams/post-beta-size.svg)

Późniejsze porównanie odtwarza źródła beta.4 `39287792` względem runtime `9663b681`, wraz z integracją Plex i odzyskiwaniem uszkodzonych ustawień, używając tych samych Node 26.8.2, Rollup 4.64.5 i Terser 5.51.2:

- Wejście webowe: 848 315 / 262 443 → 879 533 / 271 761 bajtów bez kompresji/gzip.
- Wejście webowe + wszyscy dostawcy: 964 876 / 305 452 → 1 000 388 / 316 600.
- Wejście natywne + wszyscy dostawcy: 964 834 / 305 520 → 1 000 346 / 316 654.
- Wzrost pełnego ładunku webowego: **35 512 / 11 148 bajtów (3.68% / 3.65%)**.

Wersja bazowa liczy siedem rodzin dostawców; integracja osiem, w tym Xtream ładowane na żądanie. Limity wejścia tej migawki wynosiły 879 900 / 273 000, a sumy 1 000 800 / 317 800, z zapasem dla środowiska natywnego, Node i tożsamości wydania. Obie lokalne kompilacje produkcyjne regenerują pięć śledzonych plików runtime i pomijają deklarację czystej rewizji źródeł. To lokalnie odtworzone artefakty, nie opublikowane binaria beta. Wersje narzędzi, hashe i to ograniczenie zapisano w [dowodach bazowych](evidence/post-beta-baseline-size-20261015.json) oraz [integracji](evidence/post-beta-candidate-size-20261015.json). [Raport z implementacji](implementation-report.pl.md#post-beta-integration-and-review) wyjaśnia poprawki i walidację.

**Zakres:** sumy JavaScriptu wykluczają zewnętrzne silniki multimedialne, słowniki językowe, CSS, obrazy i wideo. Historyczne pakiety odtwarzacza zawierały też **klip A/V o rozmiarze 464 652 bajtów**, poza powyższymi sumami. Jego dzisiejsza dystrybucja jest oddzielona od tych pomiarów:

- **Repozytorium:** `diagnostics/av-v1.mp4` pozostaje z generatorem i weryfikatorem dla odtwarzalności. Zachowanie pliku źródłowego nie włącza go do pakietu.
- **Pakiety:** Web/OTTPlay Server, Tauri, Capacitor i Docker pomijają klip. Usuwa to 464 652 bajty multimediów bez kompresji, a nie zmierzone 464 652 bajty ze skompresowanego instalatora. Format archiwum i inne zmiany kompilacji wpływają na ten rozmiar.
- **Sieć:** odtwarzacz pobiera klip z here.now tylko, gdy użytkownik uruchomi [test A/V](audio-video-check.pl.md). Test wymaga internetu; klip nie jest pobierany do odtwarzania przy starcie.

Historyczne pomiary JavaScriptu powyżej nie zmieniają się. Pomiar wpływu hostowanego URL na JavaScript lub obecny instalator wymaga nowego porównania. 88 zlokalizowanych README to dokumentacja repozytorium, nie ładunek odtwarzacza. To porównanie bajtów nie uzasadnia twierdzeń o czasie startu, liczbie klatek, pamięci czy wydajności dużych katalogów. Wymaga to oddzielnych pomiarów na urządzeniach docelowych.

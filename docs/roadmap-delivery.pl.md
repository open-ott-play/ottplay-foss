# Ulepszenia niezawodności i obsługi multimediów

<!-- language-navigation:start -->
<p dir="ltr">
<a href="roadmap-delivery.md" lang="en" dir="ltr">English</a> · <a href="roadmap-delivery.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="roadmap-delivery.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="roadmap-delivery.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="roadmap-delivery.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="roadmap-delivery.es.md" lang="es" dir="ltr">Español</a> · <a href="roadmap-delivery.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="roadmap-delivery.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="roadmap-delivery.he.md" lang="he" dir="rtl">עברית</a> · <a href="roadmap-delivery.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="roadmap-delivery.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="roadmap-delivery.it.md" lang="it" dir="ltr">Italiano</a> · <a href="roadmap-delivery.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="roadmap-delivery.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="roadmap-delivery.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="roadmap-delivery.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="roadmap-delivery.pt.md" lang="pt" dir="ltr">Português</a> · <a href="roadmap-delivery.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="roadmap-delivery.th.md" lang="th" dir="ltr">ไทย</a> · <a href="roadmap-delivery.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="roadmap-delivery.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="roadmap-delivery.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="roadmap-delivery.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="roadmap-delivery.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Wiki](wiki/Home.pl.md) · [Architektura](architecture.md)

Ten przewodnik opisuje implementację w rewizji źródeł tej strony, a nie możliwości starszego zainstalowanego wydania. Odtwarzacz, usługa sterowania/CLI i natywna aplikacja Android są oddzielnymi artefaktami. Aktualizacja jednego nie aktualizuje pozostałych.

![Odpowiedzialności i granice zaufania](diagrams/roadmap-components.svg)

Zobacz [zmierzony koszt w bajtach i wykres porównawczy](roadmap-size.pl.md); szybkość działania i odtwarzanie na urządzeniach wymagają odrębnych kontroli odbiorczych.

<a id="what-is-implemented"></a>

## Zaimplementowane funkcje

1. **Znana próbka audio/wideo.** [Informacje → Dźwięk](audio-video-check.pl.md) odtwarza ośmiosekundowy klip z here.now (wymagany internet), z tonami lewego/prawego kanału i odpowiadającymi im błyskami. Jest pobierany wyłącznie po **Odtwórz**, nigdy przy uruchamianiu; plik nie jest dołączony do pakietów odtwarzacza. Tymczasowo korzysta z głównego dekodera HTML5 tylko podczas bezczynności lub telewizji na żywo. Nie zapisuje historii oglądania. [Specyfikacja próbki](../diagnostics/README.md).
2. **Wznawialna konfiguracja Local/Home.** CLI sterowania potrafi zaplanować, zastosować, wznowić i zweryfikować profil. Przed ponowieniem zapisu o niepewnym wyniku porównuje zapisane ustawienia. [Proces sterowania](https://github.com/open-ott-play/ottplay-control-server/blob/9b28c08eefca3948c78336e7e16a45e6fc492e31/docs/reliable-control.md).
3. **Ograniczone odzyskiwanie odtwarzania.** Przejściowe błędy HLS/Shaka współdzielą skończoną politykę odzyskiwania. Błędy uwierzytelnienia i nieobsługiwany DRM są końcowe. Stop, zmiana kanału i zastąpienie źródła anulują nieaktualne operacje.
4. **Zapisane limity jakości.** Maksymalna wysokość i przepływność ograniczają wybór adaptacyjny; przejście na silnik natywny nie może po cichu omijać aktywnego limitu.
5. **Preferencje ścieżek w natywnym Androidzie.** Niezależna aplikacja Android zapamiętuje zamiar według języka/roli/etykiety, w tym Auto i wyłączone napisy, zamiast przenosić indeks ścieżki z innego strumienia.
6. **Operatorzy poleceń z ograniczonymi uprawnieniami.** Kontroler może przyznać poświadczeniu dostęp do konkretnych urządzeń/działań bez przekazywania poświadczenia administratora.
7. **Jawne powiązania XMLTV.** Kanał należący do listy można powiązać z określonym źródłem i identyfikatorem XMLTV. [Powiązania programu i dostępność](guide-binding-accessibility.pl.md).
8. **Filmy i seriale Xtream.** Biblioteka multimediów pobiera wybrany katalog na żądanie, a następnie odcinki serialu. [Kontrakt biblioteki](xtream-media.pl.md).
9. **Dostępne klasyczne elementy sterowania.** Listy kanałów udostępniają semantykę wyboru; okna modalne utrzymują i przywracają fokus klawiatury; powiadomienia mają region na żywo.
10. **Trwałe wyniki poleceń.** Opcjonalny ograniczony dziennik kontrolera zachowuje metadane deduplikacji i wyników. Restart nigdy nie odtwarza poleceń w ciemno.
11. **Jawne przekazanie do urządzenia.** Odwołania do transmisji na żywo/archiwum trafiają do odtwarzacza z tym samym skonfigurowanym źródłem. Cel sam rozwiązuje swój URL. [Kontrakt](remote-handoff.pl.md).
12. **Jawne strumienie zapasowe.** Kanały na żywo mogą korzystać ze skonfigurowanych alternatyw w ramach tej samej skończonej polityki odzyskiwania. [Limity, odzyskiwanie i zapasy](playback-stream-policy.pl.md).
13. **Odzyskiwalne partie ustawień.** Natywny localStorage używa dziennika cofania dla obsługiwanych zapisów wielu kluczy. [Gwarancje przechowywania](settings-recovery.pl.md).

<a id="language-and-compatibility-coverage"></a>

## Języki i zgodność

Odtwarzacz zawiera 88 katalogów tłumaczeń. Siedem nowych etykiet jakości/multimediów jest przetłumaczonych w każdym katalogu; inne nowe menu używają istniejących przetłumaczonych etykiet. Kontrole katalogów obejmują zgodność kluczy, parametry zastępcze i przejrzane wyjątki. Powiązane przewodniki techniczne opisują te same granice implementacji w [24 językach dokumentacji](manual-translations.md). [Zlokalizowane strony wejściowe](readme/README.md) są skróconymi przewodnikami startowymi, a nie zapewnieniem, że każdy historyczny dokument techniczny ma 88 pełnych tłumaczeń.

Klasyczny wynik kompilacji pozostaje zgodny ze składnią ES5. Nie oznacza to, że każde urządzenie obsługuje wszystkie kodeki, interfejsy Web API, gwarancje przechowywania czy integracje natywne. Podgląd A/V ograniczono do głównej zarządzanej ścieżki HTML5; zastępujące ją silniki urządzeń, takie jak PC2/Video.js i silniki natywne, są wykluczone. Jawne powiązania programu korzystają z hostowanej lub natywnej implementacji XMLTV; opcjonalne zewnętrzne protokoły companion mogą ich nie obsługiwać. Odbiór dla konkretnego urządzenia nadal wymaga rzeczywistego urządzenia.

<a id="reproduce-the-checks"></a>

## Odtworzenie kontroli

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

Weryfikator multimediów wymaga FFmpeg/FFprobe. Dekoduje oba kanały audio i sprawdza ich energię, rozdzielenie oraz ciszę; samo istnienie ścieżki AAC nie dowodzi słyszalnej treści. Zwykłe testy JavaScript sprawdzają anulowanie, nieudane zapisy, odzyskiwanie po restarcie, zmiany źródła i nieprawidłowe dane wejściowe. Końcowe kontrole pakietu obejmują opcjonalne rodziny dostawców, a nie tylko główny punkt wejścia.

W kontrolerze uruchom `go test -race ./...`, `go vet ./...` i `python3 -m unittest discover -s tests`. W natywnym Androidzie uruchom testy jednostkowe preferencji ścieżek i kopii ustawień oraz zbuduj debug APK. CI każdego repozytorium jest miarodajne dla odpowiedniego commitu, a nie później zmienionego drzewa.

<a id="physical-acceptance-before-promotion"></a>

## Odbiór na urządzeniach przed promocją

- Na docelowym telewizorze uruchom kontrolę A/V i potwierdź lewy/prawy dźwięk, widoczne błyski, Stop i powrót do transmisji na żywo. Testy dekodera nie dowodzą dźwięku HDMI ani płynności.
- Sprawdź dozwolone/odrzucone strumienie, niesprawny zapas i zmianę kanału podczas oczekującej próby. Potwierdź wybrany limit jakości na rzeczywistym silniku.
- Sprawdź fokus list/okien klawiaturą, pilotem i dostępnym czytnikiem ekranu.
- Powiąż dwie podobne nazwy kanałów z odrębnymi ID XMLTV i sprawdź program.
- Przerwij stosowanie testowego profilu, zrestartuj kontroler, wznów i zweryfikuj. Przekaż odtwarzanie do źródeł zarówno zgodnych, jak i niezgodnych z konfiguracją.
- W natywnym Androidzie przełącz strumienie o różnej kolejności ścieżek, uruchom aplikację ponownie i potwierdź jawne Auto/Off oraz preferowany język.

Udane wysłanie, zapisane ustawienia, zdekodowane próbki i zaliczone testy jednostkowe są różnymi dowodami. Promocja wydania musi zachować to rozróżnienie; zobacz [strategię wydań](../RELEASING.md).

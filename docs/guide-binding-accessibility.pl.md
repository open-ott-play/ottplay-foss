<a id="manual-xmltv-binding-and-keyboard-accessibility"></a>

# Ręczne przypisanie XMLTV i dostępność klawiatury

<!-- language-navigation:start -->
<p dir="ltr">
<a href="guide-binding-accessibility.md" lang="en" dir="ltr">English</a> · <a href="guide-binding-accessibility.ar.md" lang="ar" dir="rtl">العربية</a> · <a href="guide-binding-accessibility.bn.md" lang="bn" dir="ltr">বাংলা</a> · <a href="guide-binding-accessibility.cs.md" lang="cs" dir="ltr">Čeština</a> · <a href="guide-binding-accessibility.de.md" lang="de" dir="ltr">Deutsch</a> · <a href="guide-binding-accessibility.es.md" lang="es" dir="ltr">Español</a> · <a href="guide-binding-accessibility.fa.md" lang="fa" dir="rtl">فارسی</a> · <a href="guide-binding-accessibility.fr.md" lang="fr" dir="ltr">Français</a>
<br>
<a href="guide-binding-accessibility.he.md" lang="he" dir="rtl">עברית</a> · <a href="guide-binding-accessibility.hi.md" lang="hi" dir="ltr">हिन्दी</a> · <a href="guide-binding-accessibility.id.md" lang="id" dir="ltr">Bahasa Indonesia</a> · <a href="guide-binding-accessibility.it.md" lang="it" dir="ltr">Italiano</a> · <a href="guide-binding-accessibility.ja.md" lang="ja" dir="ltr">日本語</a> · <a href="guide-binding-accessibility.ko.md" lang="ko" dir="ltr">한국어</a> · <a href="guide-binding-accessibility.nl.md" lang="nl" dir="ltr">Nederlands</a> · <a href="guide-binding-accessibility.pl.md" lang="pl" dir="ltr">Polski</a>
<br>
<a href="guide-binding-accessibility.pt.md" lang="pt" dir="ltr">Português</a> · <a href="guide-binding-accessibility.ru.md" lang="ru" dir="ltr">Русский</a> · <a href="guide-binding-accessibility.th.md" lang="th" dir="ltr">ไทย</a> · <a href="guide-binding-accessibility.tr.md" lang="tr" dir="ltr">Türkçe</a> · <a href="guide-binding-accessibility.uk.md" lang="uk" dir="ltr">Українська</a> · <a href="guide-binding-accessibility.vi.md" lang="vi" dir="ltr">Tiếng Việt</a> · <a href="guide-binding-accessibility.zh-Hans.md" lang="zh-Hans" dir="ltr">简体中文</a> · <a href="guide-binding-accessibility.zh-Hant.md" lang="zh-Hant" dir="ltr">繁體中文</a>
</p>
<!-- language-navigation:end -->

[Architektura przewodnika](guide-architecture.md)

<a id="fix-a-channels-guide-without-editing-the-playlist"></a>

## Naprawa przewodnika kanału bez edycji playlisty

Odtwórz dany kanał M3U, otwórz **Information → EPG**, a następnie zmień URL źródła EPG i **XMLTV ID**. Wpisz dokładne ID z `<channel id="…">` pliku XMLTV, nie nazwę wyświetlaną. Wybierz **Set**, aby zapisać przypisanie i przeładować playlistę. **Automatic** usuwa nadpisanie tego kanału i wczytuje pierwotne mapowanie playlisty. Samo poruszanie się strzałkami nigdy nie zapisuje ani nie resetuje przypisania. Wstecz pozostawia zapisane przypisanie bez zmian.

Edytor jest dostępny we wdrożeniu przeglądarkowym z hostingiem i natywnych powłokach XMLTV (Tauri i Capacitor). Nie nadpisuje przewodników dostawcy, jawnych endpointów JSON `=source` ani zewnętrznych serwerów towarzyszących. Zwykła starsza przeglądarka korzystająca ze zdalnego serwera towarzyszącego zachowuje dotychczasowy protokół dopasowania. Pierwsza wersja przyjmuje dokładne ID; nie pobiera ani nie wyświetla przeszukiwalnej listy wszystkich kanałów XMLTV.

![Ręczne przypisanie łączy źródło playlisty i stabilny kanał z jednym kanałem danych XMLTV oraz dokładnym ID; w przeciwnym razie działa zwykłe dopasowanie.](images/guide-binding.svg)

Przypisanie zapisuje odcisk źródła playlisty, stabilny klucz kanału, jawny URL danych i XMLTV ID. Zmiana etykiety lub kolejności wierszy nie zmienia przypisania, jeśli tożsamość kanału jest stała. Zastąpienie URL/konta playlisty zmienia przestrzeń nazw źródła. Starsze wpisy M3U bez `itemId` używają istniejącego ID kanału wyprowadzonego z URL; zmiana tego URL zmienia tożsamość.

Wybrany kanał zachowuje nazwę wyświetlaną i URL odtwarzania. Wyszukiwanie przewodnika używa jednego jawnego źródła bez awaryjnego dopasowania po nazwie, więc brak ID nie powoduje cichego przejęcia programu innego kanału. Automatyczne przesunięcia regionalne wywnioskowane z nazwy nie dotyczą tego dokładnego przypisania; jawne `tvg-shift` playlisty nadal obowiązuje. Ustaw właściwe regionalne XMLTV ID. Jeśli własne źródło HTTPS jest nieczytelne z powodu CORS lub reguł mieszanej zawartości, zwykła diagnostyka EPG zgłasza błąd.

Lokalny rekord ma limit 500 przypisań i 512 KiB na źródło; jest analizowany raz na wczytanie playlisty, nie raz na kanał. Zapisy porównują poprzednią wartość i odczytują zapisany wynik przed przeładowaniem. Spóźnione wywołanie zwrotne edytora nie może zapisać do źródła zastępczego. To lokalna preferencja, nie synchronizacja między urządzeniami. URL źródeł mogą zawierać dane logowania; nie udostępniaj eksportów magazynu publicznie.

<a id="accessible-classic-controls"></a>

## Dostępne klasyczne elementy sterowania

- Wirtualizowana lista główna udostępnia nazwaną listę wyboru, zaznaczoną opcję, pełną liczbę elementów i bezwzględną pozycję. Tylko zaznaczony widoczny wiersz jest przystankiem Tab. Strzałki aktualizują wybór wizualny i stan semantyczny; fokus podąża za już aktywną listą podczas zmiany strony.
- Standardowe dialogi informacyjne/potwierdzające, edytor i panele About udostępniają role modalne oraz zlokalizowane nazwy. Tab i Shift+Tab krążą wewnątrz modalu na pierwszym planie. Zamknięcie zagnieżdżonego modalu przywraca nadal widoczny nadrzędny element; nieaktualne zaplanowane otwarcia nie mogą ukraść fokusu po zamknięciu.
- Komunikaty informacyjne i potwierdzające opisują swoje dialogi. Tymczasowe powiadomienia używają regionu stanu z nienarzucającymi się komunikatami.
- Istniejące katalogi tłumaczeń dostarczają wszystkie dodane etykiety. XMLTV i ID są identyfikatorami protokołu; nazwy kanałów i hostów źródeł pozostają metadanymi źródła.

Aplikacja zachowuje ścieżki pilota i składnię ES5. Semantyczne kontrole DOM nie oznaczają pełnej certyfikacji WCAG: fokus właściwy urządzeniu, mowa VoiceOver/TalkBack i zachowanie przeglądarek TV nadal wymagają testów fizycznych.

<a id="verification"></a>

## Weryfikacja

Uruchom:

```sh
node tests/test_classic_accessibility.cjs
node tests/test_guide_bindings.cjs
node tests/test_screen_ownership.cjs
node tests/test_guide_integration.cjs
node tests/test_m3u_provider_driver.cjs
node tests/test_localization_catalog.cjs
npm run typecheck
```

Na zintegrowanej gałęzi uruchom też zwykłe kontrole kompilacji/ES5/rozmiaru pakietu. Kontrole przeglądarkowe powinny objąć długą listę przekraczającą strony, zagnieżdżone potwierdzenie, zmianę źródła podczas edycji, poprawne, brakujące i usunięte przypisanie oraz błąd pobierania EPG. Semantyczne preferencje ścieżek natywnej aplikacji Android są zaimplementowane w jej oddzielnym repozytorium i niezależne od tych klasycznych elementów sterowania.

[English](README.md) | Polski

# RadioHost.cloud Studio

![Zrzut ekranu interfejsu RadioHost.cloud](http://radiohost.cloud/wp-content/uploads/2025/08/CleanShot-2025-08-30-at-19.01.34@2x.png)

**RadioHost.cloud Studio** to nowoczesna, internetowa aplikacja do automatyzacji radia internetowego, zaprojektowana, aby pomagać nadawcom w łatwym planowaniu, zarządzaniu i tworzeniu treści.

## Podstawowe Koncepcje

Aplikacja opiera się na elastycznej architekturze, która obsługuje dwa odrębne tryby działania:

1.  **Tryb DEMO (PWA):** Działa w całości w przeglądarce, wykorzystując IndexedDB do przechowywania wszystkich danych i mediów. Jest to w pełni funkcjonalna, działająca w trybie offline Progresywna Aplikacja Webowa (PWA), idealna dla pojedynczych użytkowników, do testowania lub demonstracji.
2.  **Tryb HOST (Klient-Serwer):** Łączy się z dedykowanym serwerem backendowym Node.js. Ten tryb jest przeznaczony dla środowisk wieloosobowych, umożliwiając współdzieloną bibliotekę mediów, synchronizację playlisty w czasie rzeczywistym oraz w pełni autonomiczny silnik odtwarzania 24/7.

## ✨ Kluczowe Funkcje

### 🎛️ Zaawansowany Silnik Audio i Mikser
*   **Wielokanałowy Mikser:** Kontroluj głośność, wyciszanie i routing dla Głównego Odtwarzacza, Mikrofonu, Kartoteki (Cartwall) i Zdalnych Prezenterów.
*   **Wiele Szyn Wyjściowych:** Oddzielne wyjścia "Main" (emisyjne) i "Monitor/PFL" z możliwością wyboru fizycznego urządzenia audio.
*   **Auto-Ducking:** Automatycznie obniża głośność muzyki, gdy mikrofon lub kartoteka są aktywne.
*   **Przetwarzanie Master:** Wbudowany Kompresor (Normalizacja) i 3-pasmowy Korektor (Equalizer) z presetami do kształtowania sygnału wyjściowego.
*   **Wskaźniki Poziomu na Żywo:** Mierniki poziomu sygnału audio w czasie rzeczywistym dla wszystkich źródeł i szyn.

### 🎼 Inteligentna Oś Czasu i Playlista
*   **Interfejs Przeciągnij i Upuść:** Łatwo buduj i zmieniaj kolejność elementów w swojej audycji dzięki obliczeniom czasu rozpoczęcia w czasie rzeczywistym.
*   **Auto-Fill (Ochrona przed Ciszą):** Automatycznie dodaje utwory z określonego folderu lub tagu, aby zapobiec ciszy na antenie, gdy playlista się kończy.
*   **Znaczniki Czasu (Twarde i Miękkie):** Planuj precyzyjne przejścia, wymuszając skok do konkretnego elementu o dokładnym czasie (Twardy) lub po zakończeniu bieżącego utworu (Miękki).

### 🎙️ Profesjonalne Nagrywanie Voice Tracków
*   **Edytor Liniowy:** Nagrywaj i miksuj zapowiedzi głosowe bezpośrednio między utworami, nie opuszczając osi czasu.
*   **Wizualny Miks:** Dostosuj czas, płynne przejścia (fades) i przycinaj poziomy audio, przeciągając fale dźwiękowe, aby uzyskać idealne przejście.
*   **Zdalne VT:** Prezenterzy mogą nagrywać i przesyłać voice tracki do studia za pomocą interfejsu mobilnego.

### 📡 Transmisja na Żywo i Współpraca (Tryb HOST)
*   **Autonomiczne Odtwarzanie 24/7:** Serwer zarządza odtwarzaniem bezpośrednio, co oznacza, że stacja pozostaje na antenie, nawet jeśli przeglądarka studia jest zamknięta.
*   **Tryb Zdalnego Prezentera (WebRTC):** Zaproś współprowadzących do połączenia się ze studiem z dowolnego miejsca. Dźwięk z ich mikrofonu jest przesyłany strumieniowo bezpośrednio do dedykowanego kanału w mikserze.
*   **Publiczny Streaming:** Serwer nadaje główne wyjście audio na publiczny adres URL ze stroną odtwarzacza przyjazną dla urządzeń mobilnych.
*   **Czat na Żywo ze Słuchaczami:** Komunikuj się ze swoją publicznością w czasie rzeczywistym za pomocą widżetu czatu na publicznej stronie odtwarzacza.
*   **Zarządzanie Użytkownikami:** Przypisuj role użytkownikom, wyznaczając ich jako operatorów "Studia" z pełną kontrolą lub "Prezenterów" ze zdalnym dostępem.

### 🗂️ Biblioteka Mediów i Zarządzanie
*   **Centralne i Lokalne Przechowywanie:** Przesyłaj pliki na centralny serwer (Tryb HOST) lub przechowuj je lokalnie w przeglądarce (Tryb DEMO).
*   **Organizacja:** Używaj folderów i tagów do kategoryzacji wszystkich zasobów. Tagowanie folderu stosuje tagi do całej jego zawartości.
*   **Zaawansowany Import:** Przesyłaj pojedyncze pliki lub importuj całą strukturę folderów ze swojego komputera.
*   **Metadane i Okładki:** Automatyczne parsowanie tagów ID3 i pobieranie okładek z API iTunes.
*   **PFL (Odsłuch przed Emisją):** Podglądaj utwory z biblioteki na wyjściu monitorowym bez emitowania ich na antenę.

### ⚙️ Planowanie i Automatyzacja
*   **Harmonogram Audycji:** Planuj audycje z wyprzedzeniem. Twórz audycje z określonym czasem rozpoczęcia, powtarzalnymi harmonogramami (codziennie, tygodniowo, miesięcznie) i dedykowaną playlistą. Audycje są automatycznie ładowane na oś czasu, gdy nadchodzi ich pora.
*   **Zarządzanie Danymi:** Eksportuj całą swoją konfigurację (bibliotekę, playlisty, ustawienia) do jednego pliku JSON w celu tworzenia kopii zapasowych lub migracji.
*   **Automatyczne Kopie Zapasowe:** Skonfiguruj aplikację tak, aby automatycznie zapisywała pliki kopii zapasowych w lokalnym folderze w określonych odstępach czasu lub przy uruchomieniu.

### 📱 Nowoczesny Interfejs Użytkownika
*   **Elastyczny Układ:** W pełni konfigurowalny interfejs, w którym możesz przeciągać, aby zmieniać rozmiar wszystkich kolumn i głównego nagłówka.
*   **Dwa Widoki Nagłówka:** Kompaktowy nagłówek dla maksymalnej przestrzeni roboczej, który rozszerza się do widoku z trzema odtwarzaczami, pokazując "Teraz Odtwarzane", "Następny" i "Kolejny" z dużymi okładkami.
*   **Kartoteka (Cartwall):** Siatka do natychmiastowego odtwarzania dżingli, efektów dźwiękowych i reklam z wieloma konfigurowalnymi stronami.
*   **Integracja z Last.fm:** Przeglądaj biografie artystów, podobnych wykonawców i informacje o aktualnie odtwarzanym utworze. Wymaga darmowego klucza API Last.fm.
*   **Interfejs Mobilny:** Dedykowany, przyjazny dla dotyku interfejs dla prezenterów, pozwalający na prowadzenie audycji na żywo, nagrywanie voice tracków i czatowanie z urządzeń mobilnych.
*   **Progresywna Aplikacja Webowa (PWA):** Zainstaluj aplikację na swoim pulpicie, aby uzyskać doświadczenie zbliżone do natywnej aplikacji, działającej również w trybie offline.

## 🚀 Pierwsze Kroki

Aplikacja najpierw poprosi Cię o wybór trybu.

### Tryb DEMO (Lokalna PWA)

Nie wymaga konfiguracji. Po prostu wybierz "Tryb DEMO", a aplikacja będzie działać jako samodzielna aplikacja w Twojej przeglądarce, przechowując wszystkie dane lokalnie. Możesz ją zainstalować jako PWA, aby uzyskać doświadczenie zbliżone do aplikacji desktopowej.

### Tryb HOST (Konfiguracja Serwera)

Aby uruchomić aplikację w trybie HOST, musisz uruchomić dostarczony serwer backendowy.

#### Wymagania wstępne

*   [Node.js](https://nodejs.org/) (zalecana wersja LTS)
*   [npm](https://www.npmjs.com/) lub [yarn](https://yarnpkg.com/)

#### Konfiguracja Serwera Backendowego

Serwer backendowy obsługuje konta użytkowników, dane i przechowywanie plików.

1.  **Sklonuj repozytorium:**
    ```bash
    git clone https://github.com/radiohost-cloud/radiohost.cloud.git
    cd radiohost.cloud
    ```

2.  **Zainstaluj zależności:**
    ```bash
    npm install
    ```

3.  **Uruchom serwer backendowy:**
    ```bash
    npm run server
    ```
    Serwer uruchomi się domyślnie na `http://localhost:3000`. W głównym folderze projektu utworzy plik `db.json` na dane oraz foldery `Media/` i `Artwork/` na przesłane pliki.

#### Konfiguracja Frontendu

1.  **Uruchom serwer deweloperski frontendu (w nowym terminalu):**
    ```bash
    npm start
    ```

2.  **Uruchom aplikację:**
    *   Otwórz przeglądarkę pod adresem `http://localhost:5173` (lub na porcie podanym przez Vite).
    *   Na ekranie startowym wybierz **Tryb HOST**.
    *   Aplikacja będzie teraz komunikować się z Twoim lokalnym serwerem backendowym działającym na porcie 3000.

## 🛠️ Stos Technologiczny

*   **Framework:** React 19
*   **Język:** TypeScript
*   **Narzędzie Budowania:** Vite
*   **Backend (dla trybu HOST):** Node.js, Express, Multer, LowDB
*   **Komunikacja w Czasie Rzeczywistym:** WebSockets, WebRTC
*   **Stylizacja:** Tailwind CSS
*   **Przechowywanie Danych (tryb DEMO):** IndexedDB (za pomocą biblioteki `idb`)
*   **Audio:** Web Audio API

## 🤝 Współpraca

Wkład w rozwój projektu jest mile widziany! Prosimy o utworzenie forka repozytorium, stworzenie nowej gałęzi (feature branch) i przesłanie Pull Request.

## 📄 Licencja

Ten projekt jest objęty licencją MIT. Szczegóły znajdują się w pliku `LICENSE`.

## 📬 Kontakt

Masz pytania lub sugestie? Skontaktuj się z nami pod adresem [contact@radiohost.cloud](mailto:contact@radiohost.cloud).
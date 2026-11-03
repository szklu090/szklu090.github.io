# STOL-KOS — baza na serwerze (Google Apps Script)

Aplikacja nie ma własnego serwera. Dane wysyła do **Google Apps Script**,
który zapisuje je w arkuszu **STOL-KOS Sync** w Twoim Google Drive.

## 1. Utwórz skrypt

1. Wejdź na **https://script.google.com** → **Nowy projekt**.
2. Usuń domyślny kod i wklej całość z pliku **`Code.gs`**.
3. Zapisz (Ctrl+S).

## 2. Ustaw sekret

1. **Projekt → Ustawienia projektu → Właściwości skryptu**.
2. **Dodaj właściwość**:
   - Nazwa: `SECRET`
   - Wartość: np. `stol-kos-2026` (wymyśl swoje)
3. (opcjonalnie) **Dodaj właściwość**:
   - Nazwa: `OWNER_EMAIL`
   - Wartość: Twój adres e-mail
   - Dzięki temu dostaniesz e-mail, gdy z bazą połączy się **nowe urządzenie**.
4. Zapisz.

## 3. Wdróż jako aplikację internetową

1. **Wdróż → Nowe wdrożenie**.
2. Typ: **Aplikacja internetowa**.
3. **Wykonaj jako**: `Ja`.
4. **Kto ma dostęp**: `Każdy`.
5. **Wdróż** → zezwól na dostęp → skopiuj adres kończący się **`/exec`**.

## 4. Podłącz w aplikacji

1. W STOL-KOS: **Ustawienia → Baza na serwerze (Google)**.
2. Wklej adres `/exec` i ten sam sekret.
3. Zaznacz „Wysyłaj automatycznie”.
4. **Zapisz** → **Test**.

## 5. Konta na serwerze (logowanie)

Od wersji 3.7 konta są wspólne dla wszystkich urządzeń i trzymane w bazie:

1. Po aktualizacji `Code.gs` otwórz aplikację — pojawi się ekran
   **„Utwórz konto właściciela”** (wymaga sekretu bazy).
2. Kolejne konta dodasz w **Ustawienia → Użytkownicy** (właściciel):
   nazwa, hasło i rola (użytkownik / właściciel).
3. Logowanie zwraca token sesji ważny 30 dni; hasła są hashowane
   po stronie serwera (SHA-256 z solą, 500 powtórzeń).
4. **Nie pamiętasz hasła?** Na ekranie logowania kliknij
   „Nie pamiętasz hasła?” i podaj sekret bazy + nowe hasło.
5. Gdy w aplikacji pojawi się komunikat „Serwer wymaga aktualizacji”,
   wgraj nowy `Code.gs` i zrób
   **Wdróż → Zarządzaj wdrożeniami → Edytuj → Nowa wersja**.

## Jak to działa

- Po każdej zmianie aplikacja (po ~4 s) wysyła cały stan jako JSON.
- Każdy zapis to nowy wiersz w arkuszu — starsze wersje zostają jako historia.
- **Pobierz z serwera** wczytuje ostatni zapis na innym urządzeniu.
- Gdy zmienisz kod skryptu, zrób **Wdróż → Zarządzaj wdrożeniami → Edytuj → Nowa wersja**.

## Powiadomienia

- **Dzwonek 🔔** w nagłówku pokazuje historię zdarzeń: zapisy, odczyty, błędy,
  zastosowanie linku konfiguracyjnego.
- **Powiadomienia systemowe** (przeglądarka/telefon) włączysz przyciskiem w panelu
  dzwonka lub w Ustawieniach. Wymagają zgody przeglądarki.
- **Dźwięk** towarzyszy ważnym zdarzeniom (np. zastosowaniu linku, błędowi zapisu).
- **E-mail do właściciela**: ustaw `OWNER_EMAIL`, a przy pierwszym połączeniu
  nowego urządzenia skrypt wyśle wiadomość. Listę znanych urządzeń czyści
  funkcja `resetSeenDevices()` uruchomiona ręcznie w edytorze Apps Script.
  Test e-maila: uruchom ręcznie `testEmail()`.

## Uwagi

- Arkusz jest prywatny — tylko Ty masz do niego dostęp.
- Konta są zapisane we **Właściwościach skryptu** (`USERS`), sesje w `SESS_…`.
  Nie trafiają do arkusza ani do zwykłej synchronizacji danych.
- Sekret chroni przed przypadkowym zapisem przez obcą osobę, a także pozwala
  utworzyć pierwszego właściciela i odzyskać hasło.
- Adres `/exec` nie jest tajny, ale bez sekretu nic nie zapisze.
- Limit Google: ok. 20 000 znaków JSON na jeden wiersz arkusza jest dzielone
  automatycznie na kawałki, więc rozmiar nie jest problemem.
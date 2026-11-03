/* ============================================================
   stol-kos — google.js
   Integracja z Google: Kalendarz (wydarzenia z wpisów) oraz
   Skoroszyt Google (miesięczna suma godzin w zakładce miesiąca).

   Uwierzytelnianie: Google Identity Services (GIS) — token OAuth
   w przeglądarce, bez backendu i bez sekretu. Token trzymany
   osobno w localStorage (nie trafia do eksportu danych).

   Czyste funkcje pomocnicze (testowalne bez sieci) są na końcu
   w SK.google.
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const C = SK.compute;
  const S = SK.store;

  const TOKEN_KEY = 'stol-kos-v3-google';
  const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/spreadsheets';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

  /* ============================================================
     Ustawienia skrótowe
     ============================================================ */
  function gcfg() { return (S.get().settings || {}).google || {}; }

  function projectName(id) {
    const p = S.projectById(id);
    return p ? p.name : 'Bez projektu';
  }
  function timezone() {
    try {
      if (root.Intl && root.Intl.DateTimeFormat) {
        return root.Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Warsaw';
      }
    } catch (e) { /* ignore */ }
    return 'Europe/Warsaw';
  }

  /* ============================================================
     Token (localStorage — poza eksportem danych)
     ============================================================ */
  function loadToken() {
    try {
      const t = JSON.parse(root.localStorage.getItem(TOKEN_KEY) || 'null');
      if (t && t.access_token) return t;
    } catch (e) { /* ignore */ }
    return null;
  }
  function saveToken(t) {
    try {
      if (t) root.localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
      else root.localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
    return t;
  }
  function isExpired(t) {
    if (!t || !t.access_token) return true;
    if (!t.expires_at) return false;
    return Date.now() > (t.expires_at - 60000);
  }

  /* ============================================================
     Ładowanie GIS + logowanie
     ============================================================ */
  function loadGis() {
    return new Promise(function (resolve, reject) {
      const g = root.google;
      if (g && g.accounts && g.accounts.oauth2) return resolve(g);
      const doc = root.document;
      if (!doc) return reject(new Error('Brak dokumentu — nie można wczytać Google Identity Services.'));
      const existing = doc.getElementById('sk-gis');
      if (existing) {
        existing.addEventListener('load', function () { resolve(root.google); });
        existing.addEventListener('error', function () { reject(new Error('Nie udało się wczytać Google Identity Services.')); });
        return;
      }
      const s = doc.createElement('script');
      s.id = 'sk-gis';
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = function () { resolve(root.google); };
      s.onerror = function () { reject(new Error('Nie udało się wczytać Google Identity Services (sprawdź internet).')); };
      (doc.head || doc.body).appendChild(s);
    });
  }

  let tokenClient = null;
  let tokenClientId = null;
  let connecting = null;

  function makeClient(clientId) {
    if (tokenClient && tokenClientId === clientId) return tokenClient;
    tokenClient = root.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: function () { /* nadpisane w connect() */ },
    });
    tokenClientId = clientId;
    return tokenClient;
  }

  /* ============================================================
     Wykrywanie trybu natywnego (APK) i natywne logowanie Google
     ============================================================ */
  function isNative() {
    return !!(root.Capacitor && typeof root.Capacitor.isNativePlatform === 'function' && root.Capacitor.isNativePlatform());
  }
  /**
   * Wywołuje natywną wtyczkę SkGoogle. Najpierw próbuje proxy pluginów,
   * a gdy niedostępne — niskopoziomowe Capacitor.nativePromise (wstrzykiwane
   * przez native-bridge, więc nie wymaga ładowania @capacitor/core).
   */
  function nativeCall(method, data) {
    const cap = root.Capacitor;
    if (!cap) return Promise.reject(new Error('Brak środowiska Capacitor.'));
    const plugin = cap.Plugins && cap.Plugins.SkGoogle;
    if (plugin && typeof plugin[method] === 'function') {
      try { return Promise.resolve(plugin[method](data || {})); }
      catch (e) { return Promise.reject(e); }
    }
    if (typeof cap.nativePromise === 'function') {
      return cap.nativePromise('SkGoogle', method, data || {});
    }
    return Promise.reject(new Error('Natywne logowanie Google niedostępne w tej wersji aplikacji.'));
  }

  /** Loguje i zwraca token. Wymaga gestu użytkownika przy pierwszym razie. */
  function connect() {
    if (connecting) return connecting;
    connecting = isNative() ? doNativeConnect() : doConnect();
    const clear = function () { connecting = null; };
    connecting.then(clear, clear);
    return connecting;
  }

  /**
   * Natywne logowanie w APK — Google Authorization API (play-services-auth).
   * Działa dla dowolnych scope (Kalendarz, Skoroszyt), bez WebView i bez GIS.
   */
  function doNativeConnect() {
    if (!isNative()) return Promise.reject(new Error('Natywne logowanie Google dostępne tylko w aplikacji.'));
    return nativeCall('authorize', { scopes: SCOPE.split(' ') }).then(function (res) {
      if (!res || !res.accessToken) throw new Error('Google nie zwróciło tokenu dostępu.');
      const t = {
        access_token: res.accessToken,
        expires_at: Date.now() + 55 * 60 * 1000,
        scope: (res.scopes || []).join(' ') || SCOPE,
        at: new Date().toISOString(),
        native: true,
      };
      saveToken(t);
      return t;
    });
  }

  function doConnect() {
    const clientId = String(gcfg().clientId || '').trim();
    if (!clientId) return Promise.reject(new Error('Najpierw wpisz Client ID Google w Ustawieniach.'));
    return loadGis().then(function () {
      if (!root.google || !root.google.accounts || !root.google.accounts.oauth2) {
        throw new Error('Google Identity Services niedostępne.');
      }
      return new Promise(function (resolve, reject) {
        const client = makeClient(clientId);
        client.callback = function (resp) {
          if (resp && resp.access_token) {
            const t = {
              access_token: resp.access_token,
              expires_at: Date.now() + Number(resp.expires_in || 3600) * 1000,
              scope: resp.scope || SCOPE,
              at: new Date().toISOString(),
            };
            saveToken(t);
            resolve(t);
          } else {
            reject(new Error((resp && (resp.error_description || resp.error)) || 'Nie udało się zalogować do Google.'));
          }
        };
        client.error_callback = function (err) {
          reject(new Error((err && (err.message || err.type)) || 'Błąd logowania Google.'));
        };
        try { client.requestAccessToken({ prompt: '' }); }
        catch (e) { reject(e); }
      });
    });
  }

  function disconnect() {
    try {
      if (isNative()) {
        try { nativeCall('signOut', {}).catch(function () { /* ignore */ }); } catch (e) { /* ignore */ }
      }
      const t = loadToken();
      if (t && t.access_token && root.google && root.google.accounts && root.google.accounts.oauth2) {
        try { root.google.accounts.oauth2.revoke(t.access_token, function () {}); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* ignore */ }
    saveToken(null);
    return true;
  }

  function status() {
    const g = gcfg();
    const t = loadToken();
    return {
      connected: !isExpired(t),
      hasToken: !!t,
      expiresAt: t ? t.expires_at : null,
      clientId: String(g.clientId || '').trim(),
      spreadsheetId: String(g.spreadsheetId || '').trim(),
      sheetName: String(g.sheetName || '').trim(),
      autoCalendar: g.autoCalendar !== false,
      notify: !!g.notify,
      ready: isNative() || !!String(g.clientId || '').trim(),
      native: isNative(),
    };
  }

  /* ============================================================
     Wywołania REST
     ============================================================ */
  function api(url, opts, retried) {
    if (typeof root.fetch !== 'function') return Promise.reject(new Error('Brak połączenia (fetch niedostępny).'));
    const t = loadToken();
    const auth = isExpired(t) ? connect() : Promise.resolve(t);
    return auth.then(function (tok) {
      const o = Object.assign({}, opts || {});
      o.headers = Object.assign({ Authorization: 'Bearer ' + tok.access_token }, o.headers || {});
      return root.fetch(url, o).then(function (res) {
        if (res.status === 401 && !retried) {
          saveToken(null);
          return connect().then(function () { return api(url, opts, true); });
        }
        if (!res.ok) {
          return res.text().then(function (txt) {
            let msg = res.status + ' ' + res.statusText;
            try { const j = JSON.parse(txt); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* ignore */ }
            throw new Error(msg);
          });
        }
        if (res.status === 204) return null;
        return res.text().then(function (txt) { return txt ? JSON.parse(txt) : null; });
      });
    });
  }

  /* ============================================================
     KALENDARZ
     ============================================================ */
  /** Tworzy lub aktualizuje wydarzenie dla wpisu. Nic nie robi bez autoCalendar. */
  function pushEntry(entry) {
    const g = gcfg();
    if (!entry || g.autoCalendar === false) return Promise.resolve(null);
    if (C.durationMin(entry) <= 0) return Promise.resolve(null);
    if (!isNative() && !String(g.clientId || '').trim()) return Promise.resolve(null);

    const ev = entryToEvent(entry, projectName(entry.projectId));
    const headers = { 'Content-Type': 'application/json' };

    if (entry.gcalEventId) {
      return api(CAL_BASE + '/' + encodeURIComponent(entry.gcalEventId), {
        method: 'PATCH', headers: headers, body: JSON.stringify(ev),
      }).then(function () { return entry.gcalEventId; })
        .catch(function () {
          // Wydarzenie mogło zniknąć — utwórz nowe.
          return createEvent(entry, ev, headers);
        });
    }
    return createEvent(entry, ev, headers);
  }

  function createEvent(entry, ev, headers) {
    return api(CAL_BASE, { method: 'POST', headers: headers, body: JSON.stringify(ev) })
      .then(function (created) {
        if (created && created.id) { S.setEntryGcal(entry.id, created.id); return created.id; }
        return null;
      });
  }

  function removeEvent(eventId) {
    if (!eventId) return Promise.resolve(false);
    return api(CAL_BASE + '/' + encodeURIComponent(eventId), { method: 'DELETE' })
      .then(function () { return true; })
      .catch(function () { return false; });
  }

  /** Synchronizacja w tle — nie przerywa pracy aplikacji. */
  function autoPush(entry) {
    if (!entry) return;
    pushEntry(entry).catch(function (e) {
      if (SK.ui && SK.ui.toast) SK.ui.toast('Kalendarz Google: ' + e.message, 'err');
    });
  }
  function autoRemove(eventId) {
    if (!eventId) return;
    removeEvent(eventId).catch(function () { /* ignore */ });
  }

  /* ============================================================
     SKOROSZYT GOOGLE
     ============================================================ */
  function requireSheet() {
    const g = gcfg();
    const id = extractSpreadsheetId(g.spreadsheetId);
    if (!id) throw new Error('Najpierw wpisz link lub ID Skoroszytu w Ustawieniach.');
    if (!isNative() && !String(g.clientId || '').trim()) throw new Error('Najpierw wpisz Client ID Google w Ustawieniach.');
    return id;
  }

  function sheetTitles(id) {
    return api(SHEETS_BASE + '/' + id + '?fields=properties.title,sheets.properties.title')
      .then(function (meta) {
        return {
          title: meta && meta.properties ? meta.properties.title : '',
          sheets: ((meta && meta.sheets) || []).map(function (s) { return s.properties.title; }),
        };
      });
  }

  function addSheet(id, title) {
    return api(SHEETS_BASE + '/' + id + ':batchUpdate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: title } } }] }),
    });
  }

  function batchUpdateValues(id, data) {
    return api(SHEETS_BASE + '/' + id + '/values:batchUpdate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data: data }),
    });
  }

  function quoteSheet(title) { return "'" + String(title).replace(/'/g, "''") + "'"; }

  /** 0 -> A, 2 -> C, 25 -> Z, 26 -> AA. */
  function columnLetter(index) {
    let n = Number(index) + 1;
    if (!(n > 0)) return 'A';
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /** Czyta wartości zakładki (do wykrycia rzeczywistego układu dni i formuł). */
  function readValues(id, range) {
    return api(SHEETS_BASE + '/' + id + '/values/' + encodeURIComponent(range) +
      '?majorDimension=ROWS&valueRenderOption=FORMULA')
      .then(function (res) { return (res && res.values) || []; });
  }

  /** Data z numeru seryjnego Google Sheets (epoka 1899-12-30). */
  function dayFromSerial(serial, monthKey) {
    const ms = Math.round((serial - 25569) * 86400000);
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return dayFromParts(d.getUTCMonth() + 1, d.getUTCDate(), monthKey);
  }

  /** Formuła „ilość godz" dla wiersza dnia — liczy arkusz, nie aplikacja. */
  function hoursFormula(row, startCol, endCol) {
    // (do - od + (do < od)) * 24 — obsługuje też zmianę przez północ;
    // bez argumentów funkcji, więc działa w każdym locale arkusza.
    const a = columnLetter(startCol == null ? 2 : startCol) + row;
    const b = columnLetter(endCol == null ? 3 : endCol) + row;
    return '=(' + b + '-' + a + '+(' + b + '<' + a + '))*24';
  }

  /** Tekst nagłówka bez wielkości liter i polskich znaków. */
  function headerKey(value) {
    return String(value == null ? '' : value).toLowerCase()
      .replace(/ł/g, 'l')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function dayFromParts(month, day, monthKey) {
    if (!(day >= 1 && day <= 31) || !(month >= 1 && month <= 12)) return null;
    if (monthKey && month !== Number(String(monthKey).slice(5, 7))) return null;
    return day;
  }

  /** Numer dnia z komórki A: 5, "5", "2026-11-05", "05.11.2026", "5.11". */
  function dayNumber(value, monthKey) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const n = Math.floor(value);
      if (n >= 1 && n <= 31) return n;
      if (n > 31 && n < 100000) return dayFromSerial(n, monthKey);
      return null;
    }
    const s = String(value == null ? '' : value).trim();
    if (!s) return null;
    if (/^\d{1,2}$/.test(s)) {
      const n = Number(s);
      return n >= 1 && n <= 31 ? n : null;
    }
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
    if (m) return dayFromParts(Number(m[2]), Number(m[3]), monthKey);
    m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})(?:\s.*)?$/.exec(s);
    if (m) return dayFromParts(Number(m[2]), Number(m[1]), monthKey);
    m = /^(\d{1,2})[.\/-](\d{1,2})$/.exec(s);
    if (m) return dayFromParts(Number(m[2]), Number(m[1]), monthKey);
    return null;
  }

  /**
   * Wykrywa, w których wierszach arkusza są dni 1–31.
   * Najpierw szuka nagłówka „od / do" (także gdy ktoś przesunął tabelę),
   * potem dopasowuje numery/daty z kolumny A. Gdy się nie uda — standardowy
   * układ: nagłówek w wierszu 4, dni 1–31 w wierszach 5–35.
   */
  function detectLayout(values, monthKey) {
    const rows = values || [];
    let header = -1;
    let startCol = 2, endCol = 3, hoursCol = 4;
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const cells = (rows[r] || []).map(headerKey);
      const iOd = cells.indexOf('od');
      const iDo = cells.indexOf('do');
      const iDay = cells.findIndex(function (c) { return c === 'dzien' || c === 'data' || c === 'date'; });
      if (iDay >= 0 && header < 0) header = r;
      if (iOd >= 0 && iDo >= 0) {
        header = r;
        startCol = iOd;
        endCol = iDo;
        const iHours = cells.findIndex(function (c) { return /^ilosc/.test(c); });
        if (iHours >= 0) hoursCol = iHours;
        break;
      }
    }
    if (header < 0) header = 3;

    const dayRows = {};
    for (let r = header + 1; r < Math.min(rows.length, header + 63); r++) {
      const d = dayNumber((rows[r] || [])[0], monthKey);
      if (d && dayRows[d] == null) dayRows[d] = r + 1;
    }
    // Brakujące dni (pusta zakładka albo nietypowy układ) uzupełniamy
    // kolejnymi wierszami poniżej nagłówka — bez nadpisywania innych dni.
    const used = {};
    Object.keys(dayRows).forEach(function (d) { used[dayRows[d]] = true; });
    for (let d = 1; d <= 31; d++) {
      if (dayRows[d] != null) continue;
      const r = header + 1 + d;
      if (!used[r]) { dayRows[d] = r; used[r] = true; }
    }
    return { headerRow: header + 1, startCol: startCol, endCol: endCol, hoursCol: hoursCol, dayRows: dayRows };
  }

  function isBlankSheet(values) {
    return !(values || []).some(function (row) {
      return (row || []).some(function (cell) { return String(cell == null ? '' : cell).trim() !== ''; });
    });
  }

  /** Godziny „od" i „do" pogrupowane po dniu miesiąca (jeden wiersz = jeden dzień). */
  function dayTimes(monthKey) {
    const st = S.get();
    const out = {};
    (st.entries || []).forEach(function (e) {
      const raw = String(e.date || '');
      // Daty ISO muszą zgadzać się z miesiącem (rok ma znaczenie tylko tutaj).
      const iso = /^(\d{4})-(\d{1,2})/.exec(raw);
      if (iso && (iso[1] + '-' + String(Number(iso[2])).padStart(2, '0')) !== monthKey) return;
      const d = dayNumber(raw, monthKey);
      if (!d) return;
      const t = out[d] || (out[d] = { startMin: null, endMin: null });
      const s = C.toMin(e.start);
      const en = C.toMin(e.end);
      if (s != null && (t.startMin == null || s < t.startMin)) t.startMin = s;
      if (en != null && (t.endMin == null || en > t.endMin)) t.endMin = en;
    });
    const res = {};
    Object.keys(out).forEach(function (d) {
      res[d] = {
        start: out[d].startMin == null ? '' : C.fromMin(out[d].startMin),
        end: out[d].endMin == null ? '' : C.fromMin(out[d].endMin),
      };
    });
    return res;
  }

  /** Wiersze dni z wpisami: dla każdego dnia tylko „od" i „do". */
  function dayTimeRows(monthKey) {
    const times = dayTimes(monthKey);
    return Object.keys(times).map(Number).sort(function (a, b) { return a - b; })
      .map(function (d) { return { row: 4 + d, day: d, start: times[d].start, end: times[d].end }; });
  }

  /**
   * Wysyła do zakładki miesiąca TYLKO godziny „od" i „do".
   * Każdy dzień trafia do wiersza odpowiadającego jego dacie — dni bez wpisów
   * są czyszczone, więc stare godziny nie zostają na innych datach.
   * Ilość godzin i sumy liczą formuły arkusza — aplikacja ich nie nadpisuje.
   * extraHours — godziny dopisane w oknie rozliczenia (tylko do podsumowania w aplikacji).
   */
  function exportMonth(monthKey, extraHours) {
    let id;
    try { id = requireSheet(); } catch (e) { return Promise.reject(e); }

    const stats = monthStats(monthKey, extraHours);
    const cfg = gcfg();
    const forced = String(cfg.sheetName || '').trim();
    const target = forced || stats.label; // domyślnie polska nazwa miesiąca (jak w Skoroszycie)
    let exists = false;

    return sheetTitles(id).then(function (info) {
      exists = info.sheets.indexOf(target) >= 0;
      const q = quoteSheet(target);
      if (!exists) {
        // Nowa zakładka: najpierw pełny szablon (nagłówki, dni, formuły sum).
        const tpl = sheetTemplate(stats);
        return addSheet(id, target)
          .then(function () {
            return batchUpdateValues(id, [{ range: q + '!A1:E40', values: tpl }]);
          })
          .then(function () { return tpl; });
      }
      // Istniejąca zakładka: czytamy układ, żeby trafić w właściwe wiersze dat.
      return readValues(id, q + '!A1:J60');
    }).then(function (sheetValues) {
      const q = quoteSheet(target);
      if (exists && isBlankSheet(sheetValues)) {
        // Pusta zakładka o właściwej nazwie — wypełniamy szablonem.
        const tpl = sheetTemplate(stats);
        return batchUpdateValues(id, [{ range: q + '!A1:E40', values: tpl }])
          .then(function () { return tpl; });
      }
      return sheetValues || [];
    }).then(function (sheetValues) {
      const q = quoteSheet(target);
      const layout = detectLayout(sheetValues, monthKey);
      const times = dayTimes(monthKey);
      const data = [];
      for (let day = 1; day <= 31; day++) {
        const row = layout.dayRows[day];
        if (!row) continue;
        const t = times[day] || { start: '', end: '' };
        // Zawsze zapisujemy obie komórki — także puste, żeby usunąć stare godziny.
        data.push({
          range: q + '!' + columnLetter(layout.startCol) + row,
          values: [[t.start || '']],
        });
        data.push({
          range: q + '!' + columnLetter(layout.endCol) + row,
          values: [[t.end || '']],
        });
        // Formułę „ilość godz" uzupełniamy tylko w pustej komórce;
        // istniejących formuł użytkownika nie nadpisujemy.
        const current = String((sheetValues[row - 1] || [])[layout.hoursCol] == null
          ? '' : (sheetValues[row - 1] || [])[layout.hoursCol]).trim();
        // Formuła zostaje; pustą lub starą wartość liczbową zastępujemy formułą.
        if (!exists || !current || current.charAt(0) !== '=') {
          data.push({
            range: q + '!' + columnLetter(layout.hoursCol) + row,
            values: [[hoursFormula(row, layout.startCol, layout.endCol)]],
          });
        }
      }
      return batchUpdateValues(id, data);
    }).then(function () {
      const url = 'https://docs.google.com/spreadsheets/d/' + id;
      S.markMonthExported(monthKey, {
        label: stats.label, hours: stats.hours, amount: stats.amount, url: url,
        row: 39,
      });
      S.removeNotified(monthKey);
      return { ok: true, created: !exists, title: target, stats: stats, url: url };
    });
  }

  /** Test połączenia: zwraca tytuł i liczbę zakładek. */
  function testSheet() {
    let id;
    try { id = requireSheet(); } catch (e) { return Promise.reject(e); }
    return sheetTitles(id).then(function (info) {
      return { ok: true, title: info.title, sheets: info.sheets.length, names: info.sheets };
    });
  }

  /* ============================================================
     PRZYPOMNIENIA O ZAMKNIĘTYM MIESIĄCU
     ============================================================ */
  function dueMonths() {
    const st = S.get();
    const current = C.dateKey(new Date()).slice(0, 7);
    const map = {};
    st.entries.forEach(function (e) {
      const k = String(e.date || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(k)) return;
      if (k >= current) return;
      map[k] = (map[k] || 0) + C.durationMin(e);
    });
    return Object.keys(map).sort().map(function (k) {
      return {
        key: k,
        label: monthLabel(k),
        labelUpper: monthLabelUpper(k),
        hours: Math.round(map[k] / 60 * 100) / 100,
        minutes: map[k],
        exported: !!st.sheetsExported[k],
      };
    }).filter(function (m) { return m.minutes > 0 && !m.exported; });
  }

  /**
   * Pokazuje powiadomienie systemowe (raz na miesiąc), jeśli włączone.
   * Zwraca listę miesięcy, o których poinformowano.
   */
  function notifyDue() {
    const g = gcfg();
    if (!g.notify) return [];
    const pending = dueMonths().filter(function (m) {
      return S.get().notifiedMonths.indexOf(m.key) < 0;
    });
    if (!pending.length) return [];
    const m = pending[pending.length - 1];
    if (root.Notification && root.Notification.permission === 'granted') {
      try {
        const n = new root.Notification('STOL-KOS — rozlicz ' + m.label, {
          body: 'Masz ' + formatHours(m.hours) + ' h w ' + m.label + '. Wyślij godziny do Skoroszytu Google.',
          tag: 'stol-kos-' + m.key,
        });
        n.onclick = function () {
          try { root.focus(); } catch (e) { /* ignore */ }
          try { root.dispatchEvent(new CustomEvent('sk:open-month', { detail: { month: m.key } })); } catch (e) { /* ignore */ }
        };
      } catch (e) { /* ignore */ }
    }
    pending.forEach(function (x) { S.addNotified(x.key); });
    return pending;
  }

  function requestNotify() {
    if (!root.Notification) return Promise.resolve(false);
    if (root.Notification.permission === 'granted') return Promise.resolve(true);
    return Promise.resolve(root.Notification.requestPermission()).then(function (p) { return p === 'granted'; });
  }

  /* ============================================================
     CZYSTE FUNKCJE POMOCNICZE
     ============================================================ */
  /** Wyciąga ID arkusza z linku lub zwraca wpisany identyfikator. */
  function extractSpreadsheetId(input) {
    const s = String(input == null ? '' : input).trim();
    if (!s) return '';
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    const m2 = s.match(/[?#]id=([a-zA-Z0-9-_]+)/);
    if (m2) return m2[1];
    return s.replace(/[?#].*$/, '').trim();
  }

  /** "2026-11" -> "Listopad" */
  function monthLabel(monthKey) {
    const m = Number(String(monthKey).slice(5, 7));
    if (!m) return String(monthKey);
    return C.monthName(m - 1);
  }
  function monthLabelUpper(monthKey) { return String(monthLabel(monthKey)).toUpperCase(); }

  /** Początek/koniec ISO dla wpisu (obsługa zmian przez północ). */
  function eventTimes(entry) {
    const tz = timezone();
    const startDate = String(entry.date);
    const sMin = C.toMin(entry.start), eMin = C.toMin(entry.end);
    let endDate = startDate;
    if (sMin != null && eMin != null && eMin <= sMin) {
      endDate = C.dateKey(C.addDays(C.parseDateKey(startDate), 1));
    }
    return {
      start: { dateTime: startDate + 'T' + entry.start + ':00', timeZone: tz },
      end: { dateTime: endDate + 'T' + entry.end + ':00', timeZone: tz },
    };
  }

  /** Buduje obiekt wydarzenia Google dla wpisu. */
  function entryToEvent(entry, name) {
    const t = eventTimes(entry);
    const title = (name ? name + ' — ' : '') + (entry.note || 'Praca');
    const dur = C.durationMin(entry);
    return {
      summary: title,
      description: 'STOL-KOS\n' + (name || 'Bez projektu') +
        (entry.note ? '\n' + entry.note : '') +
        '\nCzas: ' + C.fmtHM(dur),
      start: t.start,
      end: t.end,
    };
  }

  /**
   * Szablon zakładki miesiąca — jak w Skoroszycie:
   * MIESIĄC / IMIĘ / godziny / tabela dni / wiersze sum.
   * Kolumna „ilość godz" to FORMULA liczona przez arkusz z „od" i „do".
   * Zwraca macierz 40 wierszy × 5 kolumn (A..E).
   */
  function sheetTemplate(stats) {
    const labelUpper = stats && stats.labelUpper ? stats.labelUpper : monthLabelUpper(stats && stats.key);
    const amount = stats ? stats.amount : 0;
    const rows = [];
    rows.push(['MIESIĄC', labelUpper, '', '', '']);
    rows.push(['IMIĘ', '', '', '', '']);
    rows.push(['', '', 'godziny', '=D39', '']);
    rows.push(['Dzień', 'Miejsce pracy', 'od', 'do', 'ilość godz']);
    for (let d = 1; d <= 31; d++) {
      const r = 4 + d;
      rows.push([d, '', '', '', hoursFormula(r)]);
    }
    rows.push(['', '', '', 'Suma Godzin', '=SUM(E5:E35)']); // wiersz 36
    rows.push(['', '', '', '', '']);                        // 37
    rows.push(['', '', '', '', '']);                        // 38
    rows.push(['', 'SUMA GODZIN', '', '=SUM(E5:E35)', 'godzin']); // 39
    rows.push(['', 'Do Wypłaty', '', amount, 'zł']);        // 40
    return rows;
  }

  /** Statystyki miesiąca (z opcjonalnymi godzinami dopisanymi). */
  function monthStats(monthKey, extraHours) {
    const st = S.get();
    const entries = (st.entries || []).filter(function (e) { return String(e.date).slice(0, 7) === monthKey; });
    const baseMin = C.totalMin(entries);
    const extraMin = Math.max(0, Math.round((Number(extraHours) || 0) * 60));
    const minutes = baseMin + extraMin;
    const hours = Math.round(minutes / 60 * 100) / 100;
    const baseAmount = C.sumAmount(entries, S.rateOf, st.settings);
    const extraAmount = (extraMin / 60) * (st.profile.rate || 0);
    const amount = Math.round((baseAmount + extraAmount) * 100) / 100;
    return {
      key: monthKey, label: monthLabel(monthKey), labelUpper: monthLabelUpper(monthKey),
      year: Number(String(monthKey).slice(0, 4)), monthIndex: Number(String(monthKey).slice(5, 7)) - 1,
      entries: entries.length, baseMin: baseMin, extraMin: extraMin,
      minutes: minutes, hours: hours, amount: amount,
    };
  }

  function prevMonthKey(fromKey) {
    const base = fromKey ? C.parseDateKey(fromKey + '-01') : new Date();
    return C.dateKey(new Date(base.getFullYear(), base.getMonth() - 1, 1)).slice(0, 7);
  }

  function formatHours(h) {
    return Number(h || 0).toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  SK.google = {
    TOKEN_KEY, SCOPE,
    // stan / auth
    loadToken, saveToken, isExpired, loadGis, connect, disconnect, status, requestNotify,
    isNative, nativeCall,
    // kalendarz
    pushEntry, removeEvent, autoPush, autoRemove,
    // skoroszyt
    testSheet, exportMonth, sheetTitles, extractSpreadsheetId,
    dayTimeRows, dayTimes, hoursFormula, detectLayout, dayNumber,
    // przypomnienia
    dueMonths, notifyDue,
    // czyste helpery (testy)
    monthLabel, monthLabelUpper, eventTimes, entryToEvent, sheetTemplate, monthStats,
    prevMonthKey, formatHours, projectName, timezone,
  };
})(typeof window !== 'undefined' ? window : globalThis);

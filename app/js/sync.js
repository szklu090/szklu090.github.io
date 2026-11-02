/* ============================================================
   stol-kos — sync.js
   Synchronizacja danych z serwerem: Google Apps Script + Arkusz.
   Aplikacja wysyła cały stan (JSON) przez POST, a odczytuje przez GET.
   Konfiguracja: Ustawienia → „Baza na serwerze (Google)”.
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const S = SK.store;

  const STATUS_KEY = 'stol-kos-sync-status';
  const DEVICE_KEY = 'stol-kos-device';

  function settings() { return (S.get() || {}).settings || {}; }
  function cfg() { return settings().sync || {}; }
  function url() { return String(cfg().url || '').trim(); }
  function token() { return String(cfg().token || ''); }
  function autoEnabled() { return cfg().auto !== false; }

  /* ---------------- status (poza stanem aplikacji) ---------------- */
  function readStatus() {
    try {
      const o = JSON.parse(root.localStorage.getItem(STATUS_KEY) || 'null');
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }
  function writeStatus(patch) {
    const s = Object.assign(readStatus(), patch || {});
    try { root.localStorage.setItem(STATUS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
    return s;
  }
  function status() {
    const s = readStatus();
    return {
      url: url(), token: token(), auto: autoEnabled(),
      ready: !!url(),
      lastAt: s.lastAt || '',
      lastError: s.lastError || '',
      lastDir: s.lastDir || '',
    };
  }

  function deviceName() {
    try {
      let id = root.localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = 'dev-' + Math.random().toString(36).slice(2, 10);
        root.localStorage.setItem(DEVICE_KEY, id);
      }
      const ua = (root.navigator && root.navigator.userAgent) || '';
      let label = 'Urządzenie';
      if (/Android/i.test(ua)) label = 'Android';
      else if (/iPhone|iPad|iPod/i.test(ua)) label = 'iPhone/iPad';
      else if (/Windows/i.test(ua)) label = 'Windows';
      else if (/Mac/i.test(ua)) label = 'Mac';
      return label + ' · ' + id;
    } catch (e) { return 'Urządzenie'; }
  }

  /* ---------------- dane ---------------- */
  /** Kopia stanu do wysyłki — bez konfiguracji synchronizacji (URL/sekret). */
  function payload() {
    const st = S.get() || {};
    const settingsCopy = Object.assign({}, st.settings || {});
    delete settingsCopy.sync;
    return {
      app: 'stol-kos', version: 3, exportedAt: new Date().toISOString(),
      profile: st.profile, settings: settingsCopy, projects: st.projects,
      entries: st.entries, settlements: st.settlements, templates: st.templates,
      sheetsExported: st.sheetsExported, notifiedMonths: st.notifiedMonths,
    };
  }

  function parse(text) {
    try { return JSON.parse(text); }
    catch (e) { throw new Error('Serwer nie zwrócił JSON — sprawdź adres Web App (/exec).'); }
  }

  function post(body) {
    if (typeof root.fetch !== 'function') return Promise.reject(new Error('Brak połączenia (fetch).'));
    const opts = {
      method: 'POST',
      // text/plain unika preflightu CORS; Apps Script czyta e.postData.contents
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    };
    return root.fetch(url(), opts)
      .then(
        function (r) { return r.text(); },
        function () { return null; } // błąd sieci / CORS
      )
      .then(function (text) {
        if (text === null) {
          // Awaryjnie: wyślij bez odczytu odpowiedzi (gdy przeglądarka blokuje CORS).
          return root.fetch(url(), Object.assign({ mode: 'no-cors' }, opts))
            .then(function () { return { ok: true, opaque: true }; });
        }
        return parse(text);
      });
  }

  /* ---------------- wysyłka ---------------- */
  let saving = null;
  function push() {
    if (!url()) return Promise.reject(new Error('Najpierw wpisz adres Web App (URL) w Ustawieniach.'));
    if (saving) return saving;
    saving = post({ action: 'save', secret: token(), device: deviceName(), data: payload() })
      .then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.error) || 'Serwer odrzucił zapis.');
        writeStatus({ lastAt: new Date().toISOString(), lastError: '', lastDir: 'push' });
        return res;
      })
      .catch(function (e) {
        writeStatus({ lastError: (e && e.message) ? e.message : String(e) });
        throw e;
      });
    const clear = function () { saving = null; };
    saving.then(clear, clear);
    return saving;
  }

  /* ---------------- odczyt ---------------- */
  function pull() {
    if (!url()) return Promise.reject(new Error('Najpierw wpisz adres Web App (URL) w Ustawieniach.'));
    const sep = url().indexOf('?') >= 0 ? '&' : '?';
    const base = url() + sep + 'action=load&secret=' + encodeURIComponent(token()) + '&_=' + Date.now();
    const finish = function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'Serwer odrzucił odczyt.');
      if (!res.data) throw new Error('Na serwerze nie ma jeszcze danych.');
      return res.data;
    };

    if (typeof root.fetch !== 'function') return jsonpLoad().then(finish);
    return root.fetch(base)
      .then(
        function (r) { return r.text(); },
        function () { return null; } // błąd sieci / CORS
      )
      .then(function (text) {
        if (text === null) return jsonpLoad();
        try { return JSON.parse(text); }
        catch (e) { return jsonpLoad(); }
      })
      .then(finish);
  }

  /** Odczyt przez JSONP — działa nawet gdy przeglądarka blokuje CORS. */
  function jsonpLoad() {
    return new Promise(function (resolve, reject) {
      const doc = root.document;
      if (!doc || !doc.createElement) { reject(new Error('Brak dokumentu (JSONP).')); return; }
      const cb = 'skSyncCb' + Math.random().toString(36).slice(2);
      const sep = url().indexOf('?') >= 0 ? '&' : '?';
      const s = doc.createElement('script');
      let timer = null;
      const cleanup = function () {
        if (timer) root.clearTimeout(timer);
        try { delete root[cb]; } catch (e) { root[cb] = undefined; }
        if (s && s.parentNode) s.parentNode.removeChild(s);
      };
      timer = root.setTimeout(function () {
        cleanup();
        reject(new Error('Serwer nie odpowiedział (timeout).'));
      }, 20000);
      root[cb] = function (res) { cleanup(); resolve(res); };
      s.onerror = function () { cleanup(); reject(new Error('Nie udało się pobrać danych (JSONP).')); };
      s.src = url() + sep + 'action=load&secret=' + encodeURIComponent(token()) +
        '&callback=' + cb + '&_=' + Date.now();
      (doc.head || doc.body).appendChild(s);
    });
  }

  /** Wstawia dane z serwera, zachowując lokalną konfigurację synchronizacji. */
  function applyRemote(data) {
    const keep = Object.assign({ url: '', token: '', auto: true }, cfg());
    if (timer) { root.clearTimeout(timer); timer = null; }
    suspended = true;
    try {
      S.importData(data);
      const st = S.get();
      st.settings.sync = Object.assign({ url: '', token: '', auto: true }, keep);
      S.save();
    } finally {
      suspended = false;
    }
    writeStatus({ lastAt: new Date().toISOString(), lastError: '', lastDir: 'pull' });
    return S.get();
  }

  /* ---------------- automatyczny zapis ---------------- */
  let timer = null;
  let suspended = false;

  function schedule() {
    if (suspended || !url() || !autoEnabled()) return;
    if (timer) root.clearTimeout(timer);
    timer = root.setTimeout(function () {
      timer = null;
      push().catch(function () { /* błąd trafia do statusu */ });
    }, 4000);
  }

  function init() {
    if (!S || typeof S.onSave !== 'function') return false;
    S.onSave(schedule);
    return true;
  }

  SK.sync = {
    status: status, payload: payload, push: push, pull: pull, applyRemote: applyRemote,
    schedule: schedule, init: init, url: url, deviceName: deviceName,
    suspend: function (v) { suspended = !!v; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
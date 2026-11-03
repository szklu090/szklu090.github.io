/* ============================================================
   stol-kos — auth.js
   Logowanie NA SERWERZE (Google Apps Script + arkusz STOL-KOS Sync).

   Konta, hasła i sesje są wspólne dla wszystkich urządzeń:
   • pierwsze konto (właściciel) tworzy się raz, przez setupOwner,
   • logowanie zwraca token sesji (ważny 30 dni),
   • panel właściciela dodaje/zmienia konta przez API serwera,
   • hasła są hashowane po stronie serwera (SHA-256 + sól).

   Gdy serwer nie ma jeszcze nowej wersji Code.gs, aplikacja pokazuje
   ekran „serwer wymaga aktualizacji” z możliwością wejścia bez kont.
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const S = SK.store;
  const U = SK.ui;
  const doc = root.document;

  const SESSION_KEY = 'stol-kos-session';

  let session = null;          // { token, user } albo { legacy: true, user }
  let lockedFlag = true;
  let mode = 'loading';        // loading | setup | login | recover | legacy | offline | app
  let lastError = '';
  let info = { auth: false, hasUsers: false };
  let usersCache = [];
  let usersLoadedFlag = false;
  let lastModeKey = '';
  const listeners = [];

  function cfg() { return (S && S.get().settings || {}).sync || {}; }
  function url() { return String(cfg().url || '').trim(); }
  function secret() { return String(cfg().token || ''); }

  function hostLabel() {
    try { return new root.URL(url()).host || 'serwer'; } catch (e) { return 'serwer'; }
  }

  /* ============================================================
     HTTP
     ============================================================ */
  function api(body) {
    return new Promise(function (resolve, reject) {
      if (!url()) { reject(new Error('Brak adresu bazy — Ustawienia → Baza na serwerze.')); return; }
      if (typeof root.fetch !== 'function') { reject(new Error('Brak połączenia (fetch).')); return; }
      let done = false;
      const timer = root.setTimeout(function () {
        if (!done) { done = true; reject(new Error('Serwer nie odpowiada (timeout).')); }
      }, 20000);
      const opts = {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      };
      root.fetch(url(), opts).then(
        function (r) { return r.text(); },
        function () { return null; }
      ).then(function (text) {
        if (done) return;
        done = true;
        try { root.clearTimeout(timer); } catch (e) { /* ignore */ }
        if (text === null) { reject(new Error('Brak połączenia z serwerem.')); return; }
        let obj;
        try { obj = JSON.parse(text); } catch (e) { reject(new Error('Serwer zwrócił nieprawidłową odpowiedź.')); return; }
        resolve(obj);
      }).catch(function (e) {
        if (done) return;
        done = true;
        try { root.clearTimeout(timer); } catch (err) { /* ignore */ }
        reject(e);
      });
    });
  }

  /* ============================================================
     Sesja
     ============================================================ */
  function readSession() {
    const sources = [root.localStorage, root.sessionStorage];
    for (let i = 0; i < sources.length; i++) {
      try {
        const raw = JSON.parse(sources[i].getItem(SESSION_KEY) || 'null');
        if (raw && (raw.token || raw.legacy)) return raw;
      } catch (e) { /* ignore */ }
    }
    return null;
  }
  function writeSession(s, remember) {
    try {
      if (!s) {
        root.localStorage.removeItem(SESSION_KEY);
        root.sessionStorage.removeItem(SESSION_KEY);
        return;
      }
      const str = JSON.stringify(s);
      if (remember === false) {
        root.sessionStorage.setItem(SESSION_KEY, str);
        root.localStorage.removeItem(SESSION_KEY);
      } else {
        root.localStorage.setItem(SESSION_KEY, str);
        root.sessionStorage.removeItem(SESSION_KEY);
      }
    } catch (e) { /* ignore */ }
  }

  function user() { return session ? session.user : null; }
  function locked() { return lockedFlag; }
  function isOwner() { return !!(session && session.user && session.user.role === 'owner'); }
  function serverAuth() { return !!info.auth; }
  function list() { return usersCache.slice(); }
  function usersLoaded() { return usersLoadedFlag; }
  function needsSetup() { return mode === 'setup'; }

  function emit() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
  }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); return fn; }

  /* ============================================================
     Start / sprawdzenie serwera
     ============================================================ */
  function checkServer() {
    return api({ action: 'authInfo' }).then(function (res) {
      if (res && res.ok && res.auth) info = { auth: true, hasUsers: !!res.hasUsers };
      else info = { auth: false, hasUsers: false };
      return info;
    });
  }

  function enter(userData, token, remember) {
    session = token
      ? { token: token, user: userData, at: new Date().toISOString() }
      : { legacy: true, user: userData };
    writeSession(session, remember);
    lockedFlag = false;
    mode = 'app';
    lastError = '';
    if (token && userData && userData.role === 'owner') loadUsers();
    render(); emit();
  }

  function init() {
    session = readSession();
    lockedFlag = true;
    mode = 'loading';
    lastError = '';
    usersCache = [];
    usersLoadedFlag = false;
    render();
    return checkServer().then(function (i) {
      if (!i.auth) {
        // Stara wersja Code.gs — brak obsługi kont na serwerze.
        if (session && session.legacy) { lockedFlag = false; mode = 'app'; }
        else mode = 'legacy';
        render(); emit();
        return;
      }
      if (session && session.token) {
        return api({ action: 'me', token: session.token }).then(function (res) {
          if (res && res.ok && res.user) {
            session.user = res.user;
            writeSession(session, true);
            lockedFlag = false;
            mode = 'app';
            if (res.user.role === 'owner') loadUsers();
          } else {
            session = null;
            writeSession(null);
            mode = i.hasUsers ? 'login' : 'setup';
            if (res && res.error) lastError = res.error;
          }
          render(); emit();
        }).catch(function (e) {
          // Offline — ufamy ostatniej zapisanej sesji.
          if (session.user) { lockedFlag = false; mode = 'app'; }
          else { mode = i.hasUsers ? 'login' : 'setup'; lastError = e.message; }
          render(); emit();
        });
      }
      mode = i.hasUsers ? 'login' : 'setup';
      render(); emit();
    }).catch(function (e) {
      info = { auth: false, hasUsers: false };
      lastError = e.message;
      if (session && session.user) { lockedFlag = false; mode = 'app'; }
      else mode = 'offline';
      render(); emit();
    });
  }

  function retry() { return init(); }

  /* ============================================================
     Logowanie / konfiguracja / odzyskiwanie
     ============================================================ */
  function setup(name, password) {
    if (!secret()) return Promise.resolve({ ok: false, error: 'Wpisz sekret bazy, żeby utworzyć konto właściciela.' });
    return api({ action: 'setupOwner', secret: secret(), name: name, password: password }).then(function (res) {
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Nie udało się utworzyć konta.' };
      info.hasUsers = true;
      enter(res.user, res.token, true);
      return { ok: true, user: res.user };
    }).catch(function (e) { return { ok: false, error: e.message }; });
  }

  function login(name, password, remember) {
    return api({ action: 'login', name: name, password: password }).then(function (res) {
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Nie udało się zalogować.' };
      enter(res.user, res.token, remember !== false);
      return { ok: true, user: res.user };
    }).catch(function (e) { return { ok: false, error: e.message }; });
  }

  function recover(name, password) {
    if (!secret()) return Promise.resolve({ ok: false, error: 'Wpisz sekret bazy, żeby zmienić hasło.' });
    return api({ action: 'recover', secret: secret(), name: name, password: password }).then(function (res) {
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Nie udało się zmienić hasła.' };
      return { ok: true };
    }).catch(function (e) { return { ok: false, error: e.message }; });
  }

  function logout() {
    const token = session && session.token;
    const done = function () {
      session = null;
      usersCache = [];
      usersLoadedFlag = false;
      writeSession(null);
      lockedFlag = true;
      mode = info.auth ? (info.hasUsers ? 'login' : 'setup') : 'legacy';
      render(); emit();
    };
    if (!token) { done(); return Promise.resolve(); }
    return api({ action: 'logout', token: token }).then(done, done);
  }

  /** Wejście bez kont — gdy serwer nie ma jeszcze nowej wersji Code.gs. */
  function legacyEnter() {
    enter({ id: 'legacy', name: 'Bez konta', role: 'owner' }, null, true);
  }

  /* ============================================================
     Panel właściciela (na serwerze)
     ============================================================ */
  function loadUsers() {
    if (!session || !session.token) return Promise.resolve([]);
    return api({ action: 'users', token: session.token }).then(function (res) {
      if (res && res.ok && res.users) {
        usersCache = res.users;
        usersLoadedFlag = true;
        emit();
      } else if (res && res.error) {
        lastError = res.error;
      }
      return usersCache;
    }).catch(function () { return usersCache; });
  }

  function saveUserCall(data) {
    if (!session || !session.token) return Promise.resolve({ ok: false, error: 'Brak sesji.' });
    return api({ action: 'saveUser', token: session.token, user: data }).then(function (res) {
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Nie udało się zapisać konta.' };
      return loadUsers().then(function () { return { ok: true, user: res.user }; });
    }).catch(function (e) { return { ok: false, error: e.message }; });
  }

  function addUser(name, password, role) { return saveUserCall({ name: name, password: password, role: role }); }
  function renameUser(id, name) { return saveUserCall({ id: id, name: name }); }
  function setPassword(id, password) { return saveUserCall({ id: id, password: password }); }
  function setRole(id, role) { return saveUserCall({ id: id, role: role }); }

  function removeUser(id) {
    if (!session || !session.token) return Promise.resolve({ ok: false, error: 'Brak sesji.' });
    return api({ action: 'deleteUser', token: session.token, id: id }).then(function (res) {
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Nie udało się usunąć konta.' };
      return loadUsers().then(function () { return { ok: true }; });
    }).catch(function (e) { return { ok: false, error: e.message }; });
  }

  function changeOwnPassword(current, next) {
    if (!session || !session.token) return Promise.resolve({ ok: false, error: 'Brak sesji.' });
    return api({ action: 'changePassword', token: session.token, current: current, next: next }).then(function (res) {
      if (!res || !res.ok) return { ok: false, error: (res && res.error) || 'Nie udało się zmienić hasła.' };
      return { ok: true };
    }).catch(function (e) { return { ok: false, error: e.message }; });
  }

  /* ============================================================
     Ekrany
     ============================================================ */
  function icon(name) { return U ? U.icon(name) : ''; }

  function brandHTML() {
    return '<div class="auth-brand"><div class="brand-logo">' + icon('clock-3') + '</div>' +
      '<div><div class="brand-title">STOL-KOS</div><div class="brand-sub">time · money</div></div></div>';
  }
  function field(label, input) {
    return '<div class="field"><label>' + label + '</label>' + input + '</div>';
  }
  function passInput(name, autocomplete) {
    return '<div class="auth-pass">' +
      '<input class="input" type="password" name="' + name + '" autocomplete="' + autocomplete + '" required />' +
      '<button type="button" class="btn btn-icon btn-ghost" data-action="auth:show-pass" title="Pokaż hasło">' + icon('eye') + '</button>' +
      '</div>';
  }
  function errorBox() { return '<div class="auth-error"' + (lastError ? '' : ' hidden') + '>' + (lastError || '') + '</div>'; }
  function serverHint() {
    return '<p class="auth-hint">Konta są zapisane na serwerze (' + hostLabel() + ') — działają na każdym urządzeniu.</p>';
  }
  function secretField() {
    if (secret()) return '';
    return field('Sekret bazy', '<input class="input" name="secret" autocomplete="off" placeholder="ten sam co w Apps Script" />');
  }

  function setupHTML() {
    return '<div class="auth-card">' + brandHTML() +
      '<h2 class="auth-title">Utwórz konto właściciela</h2>' +
      '<p class="auth-sub">Konto powstanie na serwerze — zalogujesz się nim na telefonie i komputerze.</p>' +
      '<form data-form="auth-setup" class="stack">' +
        field('Nazwa użytkownika', '<input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required />') +
        field('Hasło', passInput('password', 'new-password')) +
        field('Powtórz hasło', passInput('password2', 'new-password')) +
        secretField() +
        errorBox() +
        '<button class="btn btn-primary btn-block" type="submit">' + icon('user-plus') + ' Utwórz i zaloguj</button>' +
      '</form>' + serverHint() +
    '</div>';
  }

  function loginHTML() {
    return '<div class="auth-card">' + brandHTML() +
      '<h2 class="auth-title">Zaloguj się</h2>' +
      '<p class="auth-sub">Wpisz nazwę użytkownika i hasło, żeby wejść do STOL-KOS.</p>' +
      '<form data-form="auth-login" class="stack">' +
        field('Nazwa użytkownika', '<input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required />') +
        field('Hasło', passInput('password', 'current-password')) +
        '<label class="auth-remember"><input type="checkbox" name="remember" checked /> <span>Zapamiętaj mnie na tym urządzeniu</span></label>' +
        errorBox() +
        '<button class="btn btn-primary btn-block" type="submit">' + icon('log-in') + ' Zaloguj</button>' +
      '</form>' +
      '<div class="auth-foot"><button type="button" class="link" data-action="auth:recover">Nie pamiętasz hasła?</button></div>' +
      serverHint() +
    '</div>';
  }

  function recoverHTML() {
    return '<div class="auth-card">' + brandHTML() +
      '<h2 class="auth-title">Nowe hasło</h2>' +
      '<p class="auth-sub">Podaj nazwę użytkownika i nowe hasło. Potrzebny jest sekret bazy (klucz administratora).</p>' +
      '<form data-form="auth-recover" class="stack">' +
        field('Nazwa użytkownika', '<input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required />') +
        field('Nowe hasło', passInput('password', 'new-password')) +
        field('Powtórz hasło', passInput('password2', 'new-password')) +
        secretField() +
        errorBox() +
        '<button class="btn btn-primary btn-block" type="submit">' + icon('key-round') + ' Zmień hasło</button>' +
      '</form>' +
      '<div class="auth-foot"><button type="button" class="link" data-action="auth:show-login">Wróć do logowania</button></div>' +
    '</div>';
  }

  function legacyHTML() {
    return '<div class="auth-card">' + brandHTML() +
      '<h2 class="auth-title">Serwer wymaga aktualizacji</h2>' +
      '<p class="auth-sub">Baza odpowiada, ale nie ma jeszcze obsługi kont. Wgraj nową wersję <b>Code.gs</b> w Apps Script (Wdróż → Zarządzaj wdrożeniami → Edytuj → Nowa wersja), a potem kliknij „Sprawdź ponownie”.</p>' +
      errorBox() +
      '<div class="stack">' +
        '<button type="button" class="btn btn-primary btn-block" data-action="auth:retry">' + icon('refresh-cw') + ' Sprawdź ponownie</button>' +
        '<button type="button" class="btn btn-ghost btn-block" data-action="auth:legacy">' + icon('log-in') + ' Wejdź bez logowania (tymczasowo)</button>' +
      '</div>' +
      '<p class="auth-hint">Do czasu aktualizacji serwera aplikacja działa jak wcześniej — dane lokalne i synchronizacja z sekretem.</p>' +
    '</div>';
  }

  function offlineHTML() {
    return '<div class="auth-card">' + brandHTML() +
      '<h2 class="auth-title">Brak połączenia z serwerem</h2>' +
      '<p class="auth-sub">Logowanie wymaga internetu. Sprawdź połączenie i spróbuj ponownie.</p>' +
      errorBox() +
      '<button type="button" class="btn btn-primary btn-block" data-action="auth:retry">' + icon('refresh-cw') + ' Spróbuj ponownie</button>' +
      serverHint() +
    '</div>';
  }

  function loadingHTML() {
    return '<div class="auth-card auth-loading">' + brandHTML() +
      '<p class="auth-sub">Sprawdzam połączenie z serwerem…</p>' +
      '<div class="auth-spinner"></div>' +
    '</div>';
  }

  function screenHTML() {
    if (mode === 'setup') return setupHTML();
    if (mode === 'login') return loginHTML();
    if (mode === 'recover') return recoverHTML();
    if (mode === 'legacy') return legacyHTML();
    if (mode === 'offline') return offlineHTML();
    return loadingHTML();
  }

  function render() {
    const el = doc && doc.getElementById ? doc.getElementById('auth-root') : null;
    if (!el) return;
    const show = lockedFlag || mode !== 'app';
    el.classList.toggle('open', show);
    if (doc.body && doc.body.classList) doc.body.classList.toggle('auth-locked', show);
    if (!show) {
      if (el.innerHTML) { el.innerHTML = ''; el.removeAttribute('data-mode'); }
      lastModeKey = '';
      return;
    }
    const key = mode + '|' + lastError;
    if (key !== lastModeKey) {
      lastModeKey = key;
      el.setAttribute('data-mode', mode);
      el.innerHTML = screenHTML();
      if (U) U.refresh();
      const inp = el.querySelector('input');
      if (inp) {
        try { root.setTimeout(function () { try { inp.focus(); } catch (e) { /* ignore */ } }, 40); } catch (e) { /* ignore */ }
      }
    }
  }

  function showError(msg) { lastError = String(msg || 'Błąd'); render(); }
  function showRecover() { mode = 'recover'; lastError = ''; render(); }
  function showLogin() { mode = 'login'; lastError = ''; render(); }

  SK.auth = {
    // stan
    init, retry, render, locked, user, isOwner, list, needsSetup,
    serverAuth, usersLoaded,
    // sesja
    setup, login, recover, logout, legacyEnter,
    // panel właściciela
    loadUsers, addUser, renameUser, setPassword, setRole, removeUser, changeOwnPassword,
    // ekrany / pomocnicze
    showError, showRecover, showLogin, onChange,
  };
})(typeof window !== 'undefined' ? window : globalThis);

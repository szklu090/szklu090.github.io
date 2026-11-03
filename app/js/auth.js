/* ============================================================
   stol-kos — auth.js
   Logowanie lokalne: konta (nazwa użytkownika + hasło), sesja
   oraz panel właściciela (dodawanie, zmiana nazw i haseł).

   Konta są zapisane w localStorage TEGO urządzenia i nie trafiają
   do arkusza ani synchronizacji. Hasła: SHA-256 z losową solą
   i 10 000 powtórzeń — hasło nie jest przechowywane jawnie.
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const C = SK.compute;
  const U = SK.ui;
  const doc = root.document;

  const USERS_KEY = 'stol-kos-users';
  const SESSION_KEY = 'stol-kos-session';
  const ITER = 10000;

  let users = [];
  let session = null;
  let lockedFlag = true;
  const listeners = [];

  /* ============================================================
     SHA-256 (czysty JS — działa też bez WebCrypto / offline)
     ============================================================ */
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  function utf8Bytes(str) {
    const s = String(str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const c2 = s.charCodeAt(++i);
        const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function toHex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    return s;
  }

  function sha256Bytes(bytes) {
    const len = bytes.length;
    const bitLenHi = Math.floor(len / 536870912);
    const bitLenLo = (len * 8) >>> 0;
    const total = (((len + 9) + 63) >> 6) << 6;
    const msg = new Uint8Array(total);
    msg.set(bytes);
    msg[len] = 0x80;
    msg[total - 8] = (bitLenHi >>> 24) & 255;
    msg[total - 7] = (bitLenHi >>> 16) & 255;
    msg[total - 6] = (bitLenHi >>> 8) & 255;
    msg[total - 5] = bitLenHi & 255;
    msg[total - 4] = (bitLenLo >>> 24) & 255;
    msg[total - 3] = (bitLenLo >>> 16) & 255;
    msg[total - 2] = (bitLenLo >>> 8) & 255;
    msg[total - 1] = bitLenLo & 255;

    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Array(64);
    const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) {
        w[i] = ((msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) |
          (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }
    const out = new Uint8Array(32);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach(function (v, i) {
      out[i * 4] = (v >>> 24) & 255;
      out[i * 4 + 1] = (v >>> 16) & 255;
      out[i * 4 + 2] = (v >>> 8) & 255;
      out[i * 4 + 3] = v & 255;
    });
    return out;
  }

  function sha256Hex(str) { return toHex(sha256Bytes(Uint8Array.from(utf8Bytes(str)))); }

  /** Hasło -> skrót z solą i wielokrotnym SHA-256. */
  function hashPassword(password, salt, iter) {
    const n = Math.max(1, Number(iter) || ITER);
    let hex = toHex(sha256Bytes(Uint8Array.from(utf8Bytes(String(salt) + '\u0000' + String(password)))));
    for (let i = 0; i < n; i++) {
      hex = toHex(sha256Bytes(Uint8Array.from(utf8Bytes(hex + '\u0000' + String(salt) + '\u0000' + i))));
    }
    return hex;
  }

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') root.crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
    return toHex(a);
  }

  /* ============================================================
     Dane kont i sesja
     ============================================================ */
  function uid() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function nowISO() { return new Date().toISOString(); }
  function normName(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' '); }
  function nameKey(s) { return normName(s).toLowerCase(); }
  function findByName(name) {
    const k = nameKey(name);
    return users.filter(function (u) { return nameKey(u.name) === k; })[0] || null;
  }
  function findById(id) { return users.filter(function (u) { return u.id === id; })[0] || null; }
  function owners() { return users.filter(function (u) { return u.role === 'owner'; }); }

  function readUsers() {
    try {
      const raw = JSON.parse(root.localStorage.getItem(USERS_KEY) || 'null');
      if (raw && Array.isArray(raw.users)) {
        return raw.users.filter(function (u) { return u && u.id && u.name && u.hash && u.salt; });
      }
    } catch (e) { /* ignore */ }
    return [];
  }
  function writeUsers() {
    try { root.localStorage.setItem(USERS_KEY, JSON.stringify({ v: 1, users: users })); } catch (e) { /* ignore */ }
  }

  function sessionStore() {
    try { return JSON.parse(root.sessionStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
  }
  function readSession() {
    try {
      const raw = JSON.parse(root.localStorage.getItem(SESSION_KEY) || 'null');
      if (raw && raw.userId) return raw;
    } catch (e) { /* ignore */ }
    return sessionStore();
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

  function publicUser(u) {
    if (!u) return null;
    return {
      id: u.id, name: u.name, role: u.role,
      createdAt: u.createdAt || '', lastLoginAt: u.lastLoginAt || '',
    };
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
  }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); return fn; }

  /* ============================================================
     Walidacja
     ============================================================ */
  function validateName(name, ignoreId) {
    const n = normName(name);
    if (n.length < 2) return 'Nazwa musi mieć co najmniej 2 znaki.';
    if (n.length > 32) return 'Nazwa może mieć maksymalnie 32 znaki.';
    if (!/^[A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż ._-]+$/.test(n)) {
      return 'Dozwolone są litery, cyfry, spacja, kropka, podkreślenie i myślnik.';
    }
    const ex = findByName(n);
    if (ex && ex.id !== ignoreId) return 'Taka nazwa już istnieje.';
    return null;
  }
  function validatePassword(password) {
    const p = String(password == null ? '' : password);
    if (p.length < 4) return 'Hasło musi mieć co najmniej 4 znaki.';
    if (p.length > 64) return 'Hasło może mieć maksymalnie 64 znaki.';
    return null;
  }

  function makeAccount(name, password, role) {
    const salt = randomHex(16);
    return {
      id: uid(),
      name: normName(name),
      role: role === 'owner' ? 'owner' : 'user',
      alg: 'sha256', iter: ITER, salt: salt,
      hash: hashPassword(password, salt, ITER),
      createdAt: nowISO(), updatedAt: nowISO(), lastLoginAt: null,
    };
  }

  /* ============================================================
     Logowanie / sesja
     ============================================================ */
  function load() {
    users = readUsers();
    session = readSession();
    if (session && !findById(session.userId)) { session = null; writeSession(null, true); }
    lockedFlag = !session;
    return lockedFlag;
  }

  function needsSetup() { return users.length === 0; }
  function locked() { return lockedFlag; }
  function user() { return session ? publicUser(findById(session.userId)) : null; }
  function isOwner() { return !!(session && session.role === 'owner'); }
  function list() {
    return users.map(publicUser).sort(function (a, b) {
      if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
      return a.name.localeCompare(b.name, 'pl');
    });
  }

  function startSession(u, remember) {
    session = { userId: u.id, name: u.name, role: u.role, at: nowISO(), remember: remember !== false };
    writeSession(session, remember !== false);
    lockedFlag = false;
  }

  function setup(name, password, remember) {
    if (users.length) return Promise.resolve({ ok: false, error: 'Konto właściciela już istnieje.' });
    const err = validateName(name) || validatePassword(password);
    if (err) return Promise.resolve({ ok: false, error: err });
    const owner = makeAccount(name, password, 'owner');
    users.push(owner);
    writeUsers();
    startSession(owner, remember);
    render(); emit();
    return Promise.resolve({ ok: true, user: publicUser(owner) });
  }

  function login(name, password, remember) {
    const u = findByName(name);
    if (!u) return Promise.resolve({ ok: false, error: 'Nie ma takiego użytkownika.' });
    if (hashPassword(password, u.salt, u.iter) !== u.hash) {
      return Promise.resolve({ ok: false, error: 'Błędne hasło.' });
    }
    u.lastLoginAt = nowISO();
    writeUsers();
    startSession(u, remember);
    render(); emit();
    return Promise.resolve({ ok: true, user: publicUser(u) });
  }

  function logout() {
    session = null;
    writeSession(null, true);
    lockedFlag = true;
    render(); emit();
  }

  function resetAll() {
    users = [];
    session = null;
    lockedFlag = true;
    try {
      root.localStorage.removeItem(USERS_KEY);
      root.localStorage.removeItem(SESSION_KEY);
      root.sessionStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
    render(); emit();
  }

  /* ============================================================
     Panel właściciela
     ============================================================ */
  function addUser(name, password, role) {
    const err = validateName(name) || validatePassword(password);
    if (err) return { ok: false, error: err };
    const acc = makeAccount(name, password, role);
    users.push(acc);
    writeUsers(); emit();
    return { ok: true, user: publicUser(acc) };
  }

  function renameUser(id, name) {
    const u = findById(id);
    if (!u) return { ok: false, error: 'Nie ma takiego konta.' };
    const err = validateName(name, id);
    if (err) return { ok: false, error: err };
    u.name = normName(name);
    u.updatedAt = nowISO();
    writeUsers();
    if (session && session.userId === id) { session.name = u.name; writeSession(session, session.remember); }
    emit();
    return { ok: true, user: publicUser(u) };
  }

  function setPassword(id, password) {
    const u = findById(id);
    if (!u) return { ok: false, error: 'Nie ma takiego konta.' };
    const err = validatePassword(password);
    if (err) return { ok: false, error: err };
    u.salt = randomHex(16);
    u.hash = hashPassword(password, u.salt, u.iter || ITER);
    u.updatedAt = nowISO();
    writeUsers(); emit();
    return { ok: true, user: publicUser(u) };
  }

  function setRole(id, role) {
    const u = findById(id);
    if (!u) return { ok: false, error: 'Nie ma takiego konta.' };
    const next = role === 'owner' ? 'owner' : 'user';
    if (next === 'user' && u.role === 'owner' && owners().length <= 1) {
      return { ok: false, error: 'Musi zostać co najmniej jeden właściciel.' };
    }
    u.role = next;
    u.updatedAt = nowISO();
    writeUsers();
    if (session && session.userId === id) { session.role = next; writeSession(session, session.remember); }
    emit();
    return { ok: true, user: publicUser(u) };
  }

  function removeUser(id) {
    const u = findById(id);
    if (!u) return { ok: false, error: 'Nie ma takiego konta.' };
    if (session && session.userId === id) return { ok: false, error: 'Nie możesz usunąć konta, na którym jesteś zalogowany.' };
    if (u.role === 'owner' && owners().length <= 1) {
      return { ok: false, error: 'Musi zostać co najmniej jeden właściciel.' };
    }
    users = users.filter(function (x) { return x.id !== id; });
    writeUsers(); emit();
    return { ok: true };
  }

  function changeOwnPassword(current, next) {
    if (!session) return { ok: false, error: 'Nie jesteś zalogowany.' };
    const u = findById(session.userId);
    if (!u) return { ok: false, error: 'Nie ma takiego konta.' };
    if (hashPassword(current, u.salt, u.iter) !== u.hash) {
      return { ok: false, error: 'Aktualne hasło jest błędne.' };
    }
    return setPassword(u.id, next);
  }

  /* ============================================================
     Ekran logowania / konfiguracji
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

  function setupHTML() {
    return '<div class="auth-card">' + brandHTML() +
      '<h2 class="auth-title">Utwórz konto właściciela</h2>' +
      '<p class="auth-sub">Pierwsze uruchomienie na tym urządzeniu. Konto zapisze się lokalnie — kolejne osoby dodasz w Ustawieniach.</p>' +
      '<form data-form="auth-setup" class="stack">' +
        field('Nazwa użytkownika', '<input class="input" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required />') +
        field('Hasło', passInput('password', 'new-password')) +
        field('Powtórz hasło', passInput('password2', 'new-password')) +
        '<label class="auth-remember"><input type="checkbox" name="remember" checked /> <span>Zapamiętaj mnie na tym urządzeniu</span></label>' +
        '<div class="auth-error" hidden></div>' +
        '<button class="btn btn-primary btn-block" type="submit">' + icon('user-plus') + ' Utwórz i zaloguj</button>' +
      '</form>' +
      '<p class="auth-hint">Hasło zapisujemy jako skrót SHA-256 z solą (10 000 powtórzeń) — nigdy jawnie.</p>' +
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
        '<div class="auth-error" hidden></div>' +
        '<button class="btn btn-primary btn-block" type="submit">' + icon('log-in') + ' Zaloguj</button>' +
      '</form>' +
      '<div class="auth-foot"><button type="button" class="link" data-action="auth:reset">Nie pamiętasz hasła? Zresetuj konta</button></div>' +
    '</div>';
  }

  function render() {
    const el = doc && doc.getElementById ? doc.getElementById('auth-root') : null;
    if (!el) return;
    const needSetup = users.length === 0;
    const show = lockedFlag || needSetup;
    const mode = needSetup ? 'setup' : 'login';
    el.classList.toggle('open', show);
    if (doc.body && doc.body.classList) doc.body.classList.toggle('auth-locked', show);
    if (!show) {
      if (el.innerHTML) { el.innerHTML = ''; el.removeAttribute('data-mode'); }
      return;
    }
    if (el.getAttribute('data-mode') !== mode) {
      el.innerHTML = needSetup ? setupHTML() : loginHTML();
      el.setAttribute('data-mode', mode);
      if (U) U.refresh();
      const inp = el.querySelector('input');
      if (inp) { try { setTimeout(function () { inp.focus(); }, 40); } catch (e) { /* ignore */ } }
    }
  }

  function showError(msg) {
    const el = doc && doc.getElementById ? doc.getElementById('auth-root') : null;
    const box = el ? el.querySelector('.auth-error') : null;
    if (!box) { try { if (U) U.toast(msg, 'err'); } catch (e) { /* ignore */ } return; }
    box.textContent = msg;
    box.hidden = false;
  }

  function init() { load(); render(); return lockedFlag; }

  SK.auth = {
    // stan
    init, load, render, locked, user, isOwner, list, needsSetup,
    // sesja
    setup, login, logout, resetAll,
    // panel właściciela
    addUser, renameUser, setPassword, setRole, removeUser, changeOwnPassword,
    // pomocnicze (testy)
    onChange, showError, validateName, validatePassword, hashPassword, sha256Hex, ITER,
  };
})(typeof window !== 'undefined' ? window : globalThis);

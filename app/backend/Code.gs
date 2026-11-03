/**
 * STOL-KOS — backend synchronizacji
 * Google Apps Script + Arkusz Google
 *
 * Jak wdrożyć:
 *  1. script.google.com → Nowy projekt
 *  2. Wklej cały ten plik do Code.gs
 *  3. Projekt → Ustawienia projektu → Właściwości skryptu
 *     dodaj właściwość:  SECRET = twój-sekret
 *  4. Wdróż → Nowe wdrożenie → typ: Aplikacja internetowa
 *     - Wykonaj jako: Ja
 *     - Kto ma dostęp: Każdy
 *  5. Skopiuj adres kończący się /exec i wklej go w aplikacji.
 *
 * Dane zapisują się w arkuszu „STOL-KOS Sync" (tworzony automatycznie)
 * w Twoim Google Drive. Każdy zapis to jeden wiersz; pełny JSON jest
 * dzielony na kawałki po 45 000 znaków (limit komórki Google).
 */

var SHEET_NAME = 'STOL-KOS Sync';
var CHUNK = 45000;

/* ---------------- HTTP ---------------- */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var action = p.action || 'ping';
  var cb = p.callback || '';

  if (action === 'ping') {
    return out({
      ok: true, app: 'stol-kos', auth: true,
      hasUsers: readUsers_().length > 0,
      ts: new Date().toISOString(),
    }, cb);
  }

  var check = verify(p.secret || '');
  if (!check.ok) return out(check, cb);

  if (action === 'load') {
    var data = loadLatest();
    return out({ ok: true, data: data, ts: new Date().toISOString() }, cb);
  }

  return out({ ok: false, error: 'Nieznana akcja: ' + action }, cb);
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json({ ok: false, error: 'Nieprawidłowy JSON' });
  }

  // Konta i logowanie (sesje) — bez sekretu, ale z tokenem sesji / sekretem
  // wymaganym tylko do utworzenia właściciela i odzyskania hasła.
  var auth = handleAuth_(body);
  if (auth) return json(auth);

  var check = verify(body.secret || '');
  if (!check.ok) return json(check);

  if (body.action === 'save') {
    var info = saveState(body.data || {}, body.device || '');
    var mailed = false;
    try { mailed = notifyOwner(body.device || '', body.data || {}); } catch (err) { mailed = false; }
    return json({ ok: true, savedAt: info.savedAt, entries: info.entries, projects: info.projects, mailed: mailed });
  }

  if (body.action === 'ping') {
    return json({ ok: true, app: 'stol-kos', ts: new Date().toISOString() });
  }

  return json({ ok: false, error: 'Nieznana akcja: ' + body.action });
}

/* ---------------- weryfikacja sekretu ---------------- */

function verify(secret) {
  var expected = PropertiesService.getScriptProperties().getProperty('SECRET') || '';
  if (!expected) return { ok: true }; // brak sekretu = dostęp otwarty (nie zalecane)
  if (String(secret) !== String(expected)) return { ok: false, error: 'Zły sekret' };
  return { ok: true };
}

/* ---------------- e-mail do właściciela bazy ---------------- */

/**
 * Wysyła e-mail, gdy z bazą połączy się NOWE urządzenie.
 * Adres odbiorcy: właściwość skryptu OWNER_EMAIL, a gdy jej brak —
 * e-mail właściciela skryptu (Session.getEffectiveUser()).
 * Lista znanych urządzeń: właściwość SEEN_DEVICES.
 */
function notifyOwner(device, data) {
  device = String(device || '').trim();
  if (!device) return false;

  var props = PropertiesService.getScriptProperties();
  var seenRaw = props.getProperty('SEEN_DEVICES') || '';
  var seen = seenRaw ? seenRaw.split('\n') : [];
  if (seen.indexOf(device) >= 0) return false;

  var email = props.getProperty('OWNER_EMAIL') || '';
  if (!email) {
    try {
      var u = Session.getEffectiveUser();
      email = u ? u.getEmail() : '';
    } catch (err) { email = ''; }
  }

  // Zapisz urządzenie nawet bez e-maila, żeby nie próbować w kółko.
  seen.push(device);
  props.setProperty('SEEN_DEVICES', seen.join('\n'));

  if (!email) return false;

  try {
    var entries = (data && data.entries) ? data.entries.length : 0;
    MailApp.sendEmail({
      to: email,
      subject: 'STOL-KOS — nowe urządzenie połączone z bazą',
      body:
        'Nowe urządzenie połączyło się z bazą STOL-KOS.\n\n' +
        'Urządzenie: ' + device + '\n' +
        'Data: ' + new Date().toLocaleString('pl-PL') + '\n' +
        'Wpisów w bazie: ' + entries + '\n\n' +
        'Jeśli to nie Ty — zmień SEKRET w Ustawieniach projektu Apps Script.\n',
    });
    return true;
  } catch (err) {
    return false;
  }
}

/** Uruchom raz ręcznie, aby sprawdzić e-mail i wyczyścić listę urządzeń. */
function testEmail() {
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty('OWNER_EMAIL') || Session.getEffectiveUser().getEmail();
  if (!email) { Logger.log('Brak OWNER_EMAIL i nie udało się odczytać adresu.'); return; }
  MailApp.sendEmail(email, 'STOL-KOS — test e-mail', 'To jest test powiadomień z bazy STOL-KOS.');
  Logger.log('Wysłano test na: ' + email);
}

/** Czyści listę znanych urządzeń (następne połączenie znów wyśle e-mail). */
function resetSeenDevices() {
  PropertiesService.getScriptProperties().deleteProperty('SEEN_DEVICES');
  Logger.log('Lista urządzeń wyczyszczona.');
}

/* ---------------- konta użytkowników (logowanie) ---------------- */

var AUTH_ITER = 500;        // liczba powtórzeń SHA-256 przy hashowaniu hasła
var SESSION_DAYS = 30;      // ważność sesji (dni)
var MAX_FAILS = 5;          // nieudane logowania z rzędu
var FAIL_WINDOW_MS = 60000; // blokada po przekroczeniu (ms)

function authProps_() { return PropertiesService.getScriptProperties(); }

/** Konta trzymamy w kawałkach po 8000 znaków (limit właściwości to 9 kB). */
var USERS_CHUNK = 8000;

function readUsers_() {
  var props = authProps_();
  var raw = '';
  var n = Number(props.getProperty('USERS_CHUNKS') || 0);
  if (n > 0) {
    for (var i = 1; i <= n; i++) raw += props.getProperty('USERS_' + i) || '';
  } else {
    raw = props.getProperty('USERS') || '';
  }
  if (!raw) return [];
  try {
    var o = JSON.parse(raw);
    return (o && o.users && o.users.length) ? o.users : [];
  } catch (err) { return []; }
}

function writeUsers_(users) {
  var props = authProps_();
  var json = JSON.stringify({ v: 1, users: users || [] });
  var old = Number(props.getProperty('USERS_CHUNKS') || 0);
  var n = Math.max(1, Math.ceil(json.length / USERS_CHUNK));
  for (var i = 1; i <= n; i++) {
    props.setProperty('USERS_' + i, json.slice((i - 1) * USERS_CHUNK, i * USERS_CHUNK));
  }
  for (var j = n + 1; j <= old; j++) props.deleteProperty('USERS_' + j);
  props.setProperty('USERS_CHUNKS', String(n));
  props.deleteProperty('USERS');
}

function toHex_(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

/** Hasło -> skrót SHA-256 z losową solą i wielokrotnym powtórzeniem. */
function hashPassword_(password, salt, iter) {
  var n = Math.max(1, Number(iter) || AUTH_ITER);
  var hex = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    String(salt) + ':' + String(password), Utilities.Charset.UTF_8));
  for (var i = 0; i < n; i++) {
    hex = toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      hex + ':' + String(salt) + ':' + i, Utilities.Charset.UTF_8));
  }
  return hex;
}

function randomToken_() {
  return Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function normName_(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
function nameKey_(s) { return normName_(s).toLowerCase(); }

function findUserByName_(users, name) {
  var k = nameKey_(name);
  for (var i = 0; i < users.length; i++) {
    if (nameKey_(users[i].name) === k) return users[i];
  }
  return null;
}

function findUserById_(users, id) {
  for (var i = 0; i < users.length; i++) {
    if (users[i].id === id) return users[i];
  }
  return null;
}

function countOwners_(users) {
  var n = 0;
  for (var i = 0; i < users.length; i++) {
    if (users[i].role === 'owner') n++;
  }
  return n;
}

function validateName_(users, name, ignoreId) {
  var n = normName_(name);
  if (n.length < 2) return 'Nazwa musi mieć co najmniej 2 znaki.';
  if (n.length > 32) return 'Nazwa może mieć maksymalnie 32 znaki.';
  if (!/^[A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż ._-]+$/.test(n)) {
    return 'Dozwolone są litery, cyfry, spacja, kropka, podkreślenie i myślnik.';
  }
  var ex = findUserByName_(users, n);
  if (ex && ex.id !== ignoreId) return 'Taka nazwa już istnieje.';
  return null;
}

function validatePassword_(password) {
  var p = String(password == null ? '' : password);
  if (p.length < 4) return 'Hasło musi mieć co najmniej 4 znaki.';
  if (p.length > 64) return 'Hasło może mieć maksymalnie 64 znaki.';
  return null;
}

function publicUser_(u) {
  return {
    id: u.id, name: u.name, role: u.role,
    createdAt: u.createdAt || '', updatedAt: u.updatedAt || '', lastLoginAt: u.lastLoginAt || '',
  };
}

function createSession_(user) {
  var token = randomToken_();
  authProps_().setProperty('SESS_' + token, JSON.stringify({
    uid: user.id,
    exp: Date.now() + SESSION_DAYS * 86400000,
    at: new Date().toISOString(),
  }));
  return token;
}

function getSession_(token) {
  var t = String(token || '').replace(/[^A-Za-z0-9]/g, '');
  if (!t) return null;
  var raw = authProps_().getProperty('SESS_' + t);
  if (!raw) return null;
  var s = null;
  try { s = JSON.parse(raw); } catch (err) { s = null; }
  if (!s || !s.uid || !s.exp || Number(s.exp) < Date.now()) {
    try { authProps_().deleteProperty('SESS_' + t); } catch (err) { /* ignore */ }
    return null;
  }
  return { token: t, uid: s.uid };
}

function requireUser_(body) {
  var s = getSession_(body && body.token);
  if (!s) return { ok: false, error: 'Sesja wygasła — zaloguj się ponownie.' };
  var users = readUsers_();
  var u = findUserById_(users, s.uid);
  if (!u) return { ok: false, error: 'Konto nie istnieje.' };
  return { ok: true, user: u, users: users, token: s.token };
}

function requireOwner_(body) {
  var r = requireUser_(body);
  if (!r.ok) return r;
  if (r.user.role !== 'owner') return { ok: false, error: 'Wymagane uprawnienia właściciela.' };
  return r;
}

function readFails_() {
  try { return JSON.parse(authProps_().getProperty('AUTH_FAILS') || '{}'); } catch (err) { return {}; }
}

function failsBlocked_(key) {
  var fails = readFails_();
  var f = fails[key];
  if (!f || !f.until) return false;
  if (Number(f.until) < Date.now()) {
    delete fails[key];
    authProps_().setProperty('AUTH_FAILS', JSON.stringify(fails));
    return false;
  }
  return true;
}

function recordFail_(key) {
  var fails = readFails_();
  var now = Date.now();
  var f = fails[key] || { n: 0, until: 0 };
  if (f.until && Number(f.until) < now) f = { n: 0, until: 0 };
  f.n = Number(f.n || 0) + 1;
  if (f.n >= MAX_FAILS) { f.until = now + FAIL_WINDOW_MS; f.n = 0; }
  fails[key] = f;
  authProps_().setProperty('AUTH_FAILS', JSON.stringify(fails));
}

function clearFails_(key) {
  var fails = readFails_();
  if (fails[key]) {
    delete fails[key];
    authProps_().setProperty('AUTH_FAILS', JSON.stringify(fails));
  }
}

/**
 * Obsługuje akcje logowania i kont. Zwraca obiekt odpowiedzi albo null,
 * gdy akcja nie dotyczy kont (wtedy doPost leci dalej ze sekretem).
 */
function handleAuth_(body) {
  var action = body && body.action;
  if (!action) return null;
  var now = new Date().toISOString();

  if (action === 'authInfo') {
    return { ok: true, auth: true, hasUsers: readUsers_().length > 0 };
  }

  if (action === 'setupOwner') {
    var chk = verify(body.secret || '');
    if (!chk.ok) return chk;
    var users0 = readUsers_();
    if (users0.length) return { ok: false, error: 'Konto właściciela już istnieje.' };
    var err0 = validateName_(users0, body.name) || validatePassword_(body.password);
    if (err0) return { ok: false, error: err0 };
    var salt0 = randomToken_();
    var u0 = {
      id: 'u' + randomToken_().slice(0, 10),
      name: normName_(body.name), role: 'owner',
      salt: salt0, iter: AUTH_ITER,
      hash: hashPassword_(body.password, salt0, AUTH_ITER),
      createdAt: now, updatedAt: now, lastLoginAt: now,
    };
    users0.push(u0);
    writeUsers_(users0);
    return { ok: true, token: createSession_(u0), user: publicUser_(u0) };
  }

  if (action === 'login') {
    var key = nameKey_(body.name);
    if (failsBlocked_(key)) return { ok: false, error: 'Za dużo prób — odczekaj minutę.' };
    var users = readUsers_();
    var u = findUserByName_(users, body.name);
    var good = false;
    if (u) {
      try { good = (hashPassword_(body.password || '', u.salt, u.iter || AUTH_ITER) === u.hash); }
      catch (err) { good = false; }
    }
    if (!good) {
      recordFail_(key);
      return { ok: false, error: 'Błędna nazwa użytkownika lub hasło.' };
    }
    clearFails_(key);
    u.lastLoginAt = now;
    writeUsers_(users);
    return { ok: true, token: createSession_(u), user: publicUser_(u) };
  }

  if (action === 'me') {
    var r = requireUser_(body);
    if (!r.ok) return r;
    return { ok: true, user: publicUser_(r.user) };
  }

  if (action === 'logout') {
    var t = String(body.token || '').replace(/[^A-Za-z0-9]/g, '');
    if (t) { try { authProps_().deleteProperty('SESS_' + t); } catch (err) { /* ignore */ } }
    return { ok: true };
  }

  if (action === 'users') {
    var ro = requireOwner_(body);
    if (!ro.ok) return ro;
    var outUsers = [];
    for (var i = 0; i < ro.users.length; i++) outUsers.push(publicUser_(ro.users[i]));
    return { ok: true, users: outUsers };
  }

  if (action === 'saveUser') {
    var rw = requireOwner_(body);
    if (!rw.ok) return rw;
    var usersW = rw.users;
    var input = body.user || {};
    if (input.id) {
      var ex = findUserById_(usersW, input.id);
      if (!ex) return { ok: false, error: 'Nie ma takiego konta.' };
      var errN = validateName_(usersW, input.name == null ? ex.name : input.name, ex.id);
      if (errN) return { ok: false, error: errN };
      if (input.name != null) ex.name = normName_(input.name);
      if (input.role) {
        var next = input.role === 'owner' ? 'owner' : 'user';
        if (next === 'user' && ex.role === 'owner' && countOwners_(usersW) <= 1) {
          return { ok: false, error: 'Musi zostać co najmniej jeden właściciel.' };
        }
        ex.role = next;
      }
      if (input.password) {
        var errP = validatePassword_(input.password);
        if (errP) return { ok: false, error: errP };
        ex.salt = randomToken_();
        ex.iter = AUTH_ITER;
        ex.hash = hashPassword_(input.password, ex.salt, AUTH_ITER);
      }
      ex.updatedAt = now;
      writeUsers_(usersW);
      return { ok: true, user: publicUser_(ex) };
    }
    var errNew = validateName_(usersW, input.name) || validatePassword_(input.password);
    if (errNew) return { ok: false, error: errNew };
    var saltN = randomToken_();
    var acc = {
      id: 'u' + randomToken_().slice(0, 10),
      name: normName_(input.name),
      role: input.role === 'owner' ? 'owner' : 'user',
      salt: saltN, iter: AUTH_ITER,
      hash: hashPassword_(input.password, saltN, AUTH_ITER),
      createdAt: now, updatedAt: now, lastLoginAt: '',
    };
    usersW.push(acc);
    writeUsers_(usersW);
    return { ok: true, user: publicUser_(acc) };
  }

  if (action === 'deleteUser') {
    var rd = requireOwner_(body);
    if (!rd.ok) return rd;
    var usersD = rd.users;
    var target = findUserById_(usersD, body.id);
    if (!target) return { ok: false, error: 'Nie ma takiego konta.' };
    if (target.id === rd.user.id) return { ok: false, error: 'Nie możesz usunąć konta, na którym jesteś zalogowany.' };
    if (target.role === 'owner' && countOwners_(usersD) <= 1) {
      return { ok: false, error: 'Musi zostać co najmniej jeden właściciel.' };
    }
    var kept = [];
    for (var k = 0; k < usersD.length; k++) {
      if (usersD[k].id !== target.id) kept.push(usersD[k]);
    }
    writeUsers_(kept);
    return { ok: true };
  }

  if (action === 'changePassword') {
    var rc = requireUser_(body);
    if (!rc.ok) return rc;
    if (hashPassword_(body.current || '', rc.user.salt, rc.user.iter || AUTH_ITER) !== rc.user.hash) {
      return { ok: false, error: 'Aktualne hasło jest błędne.' };
    }
    var errC = validatePassword_(body.next);
    if (errC) return { ok: false, error: errC };
    var usersC = rc.users;
    var me = findUserById_(usersC, rc.user.id);
    me.salt = randomToken_();
    me.iter = AUTH_ITER;
    me.hash = hashPassword_(body.next, me.salt, AUTH_ITER);
    me.updatedAt = now;
    writeUsers_(usersC);
    return { ok: true, user: publicUser_(me) };
  }

  if (action === 'recover') {
    var chr = verify(body.secret || '');
    if (!chr.ok) return chr;
    var usersR = readUsers_();
    var ur = findUserByName_(usersR, body.name);
    if (!ur) return { ok: false, error: 'Nie ma takiego konta.' };
    var errR = validatePassword_(body.password);
    if (errR) return { ok: false, error: errR };
    ur.salt = randomToken_();
    ur.iter = AUTH_ITER;
    ur.hash = hashPassword_(body.password, ur.salt, AUTH_ITER);
    ur.updatedAt = now;
    writeUsers_(usersR);
    return { ok: true };
  }

  return null;
}

/* ---------------- arkusz ---------------- */

function sheet_() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    var id = props.getProperty('SPREADSHEET_ID');
    if (id) {
      try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; }
    }
    if (!ss) {
      ss = SpreadsheetApp.create('STOL-KOS Sync');
      props.setProperty('SPREADSHEET_ID', ss.getId());
    }
  }

  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['Zapisano', 'Urządzenie', 'Wpisy', 'Projekty', 'JSON']);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ---------------- zapis / odczyt ---------------- */

function saveState(state, device) {
  var sh = sheet_();
  var jsonText = JSON.stringify(state || {});
  var chunks = [];
  for (var i = 0; i < jsonText.length; i += CHUNK) {
    chunks.push(jsonText.slice(i, i + CHUNK));
  }
  if (!chunks.length) chunks = [''];

  var row = [
    new Date(),
    String(device || ''),
    (state.entries || []).length,
    (state.projects || []).length,
  ].concat(chunks);

  sh.appendRow(row);

  // Wymuś format tekstowy dla kolumn z JSON-em (bez zamiany na liczby).
  var last = sh.getLastRow();
  sh.getRange(last, 5, 1, chunks.length).setNumberFormat('@');

  return {
    savedAt: new Date().toISOString(),
    entries: (state.entries || []).length,
    projects: (state.projects || []).length,
  };
}

function loadLatest() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return null;

  var width = Math.max(5, sh.getLastColumn());
  var values = sh.getRange(last, 1, 1, width).getValues()[0];
  var jsonText = values.slice(4).join('');
  if (!jsonText) return null;

  try {
    return JSON.parse(jsonText);
  } catch (err) {
    return null;
  }
}

/* ---------------- narzędzia ---------------- */

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** JSON lub JSONP (gdy podano callback — obejście CORS). */
function out(obj, callback) {
  var text = JSON.stringify(obj);
  if (callback) {
    var safe = String(callback).replace(/[^A-Za-z0-9_$]/g, '');
    return ContentService
      .createTextOutput(safe + '(' + text + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json(obj);
}

/** Uruchom raz ręcznie, aby utworzyć arkusz i sprawdzić konfigurację. */
function testSetup() {
  var sh = sheet_();
  Logger.log('Arkusz: ' + sh.getParent().getName());
  Logger.log('URL: https://docs.google.com/spreadsheets/d/' + sh.getParent().getId());
  Logger.log('Sekret ustawiony: ' + (!!PropertiesService.getScriptProperties().getProperty('SECRET')));
}
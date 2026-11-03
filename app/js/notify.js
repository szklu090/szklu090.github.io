/* ============================================================
   stol-kos — notify.js
   Powiadomienia: dziennik zdarzeń (dzwonek), dźwięk, powiadomienia
   systemowe przeglądarki oraz komunikaty w aplikacji.
   Zdarzenia trzymane są lokalnie (localStorage), poza stanem danych.
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const doc = root.document;

  const STORE_KEY = 'stol-kos-events';
  const SEEN_KEY = 'stol-kos-events-seen';
  const MAX = 60;

  const ICONS = {
    ok: 'check-circle-2',
    err: 'alert-circle',
    sync: 'refresh-cw',
    link: 'link',
    info: 'info',
    google: 'cloud',
  };

  function lsGet(k, d) {
    try { const v = root.localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  }
  function lsSet(k, v) { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  function read() { const a = lsGet(STORE_KEY, []); return Array.isArray(a) ? a : []; }
  function write(a) { lsSet(STORE_KEY, a.slice(-MAX)); }
  function uid() { return 'ev' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function unread() {
    const seen = Number(lsGet(SEEN_KEY, 0)) || 0;
    return read().filter(function (e) { return (e.at || 0) > seen; }).length;
  }
  function markSeen() { lsSet(SEEN_KEY, Date.now()); paintBadge(); }
  function clear() { write([]); lsSet(SEEN_KEY, Date.now()); paintBadge(); renderPanel(); }
  function list() { return read().slice().reverse(); }

  /* ---------------- dźwięk (Web Audio, bez plików) ---------------- */
  let audioCtx = null;
  function sound(kind) {
    try {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();
      const now = audioCtx.currentTime;
      const seq = kind === 'err' ? [[520, 0], [360, 0.16]] : [[660, 0], [880, 0.13]];
      seq.forEach(function (p) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = p[0];
        g.gain.setValueAtTime(0.0001, now + p[1]);
        g.gain.exponentialRampToValueAtTime(0.12, now + p[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + p[1] + 0.22);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(now + p[1]); o.stop(now + p[1] + 0.24);
      });
    } catch (e) { /* ignore */ }
  }

  /* ---------------- powiadomienia systemowe ---------------- */
  function permission() { return root.Notification ? root.Notification.permission : 'unsupported'; }
  function requestPermission() {
    if (!root.Notification) return Promise.resolve(false);
    if (root.Notification.permission === 'granted') return Promise.resolve(true);
    try {
      return Promise.resolve(root.Notification.requestPermission()).then(function (p) { return p === 'granted'; });
    } catch (e) { return Promise.resolve(false); }
  }
  function system(title, body, force) {
    try {
      if (!root.Notification || root.Notification.permission !== 'granted') return;
      if (!force && doc && doc.visibilityState === 'visible') return;
      const n = new root.Notification(title, { body: body || '', tag: 'stol-kos-' + Date.now() });
      n.onclick = function () { try { root.focus(); } catch (e) { /* ignore */ } };
    } catch (e) { /* ignore */ }
  }

  /* ---------------- log zdarzenia ---------------- */
  /** Dodaje zdarzenie. opts: { silent, toast, sound, system, force } */
  function add(type, title, detail, opts) {
    const opt = opts || {};
    const ev = {
      id: uid(), at: Date.now(), type: type || 'info',
      title: String(title == null ? '' : title),
      detail: String(detail == null ? '' : detail),
    };
    const a = read(); a.push(ev); write(a);
    paintBadge();
    if (isOpen()) renderPanel();

    if (!opt.silent) {
      if (opt.toast !== false && SK.ui && SK.ui.toast) {
        const tt = ev.type === 'err' ? 'err' : ev.type === 'ok' ? 'ok' : 'info';
        SK.ui.toast(ev.title + (ev.detail ? ' · ' + ev.detail : ''), tt);
      }
      if (opt.sound !== false) sound(ev.type === 'err' ? 'err' : 'ok');
      if (opt.system !== false) system(ev.title, ev.detail, !!opt.force);
    }
    return ev;
  }

  /** Zapisuje zdarzenie bez komunikatu/dźwięku (tylko do dziennika). */
  function log(type, title, detail) { return add(type, title, detail, { silent: true }); }

  /* ---------------- panel ---------------- */
  function rootEl() { return doc ? doc.getElementById('notify-root') : null; }
  function isOpen() { const el = rootEl(); return !!el && el.classList.contains('open'); }
  function panel() { return doc ? doc.getElementById('notify-panel') : null; }

  function when(ts) {
    try {
      const d = new Date(ts);
      const now = Date.now();
      const diff = Math.round((now - ts) / 60000);
      if (diff < 1) return 'teraz';
      if (diff < 60) return diff + ' min temu';
      if (diff < 60 * 24) return Math.round(diff / 60) + ' godz. temu';
      return d.toLocaleDateString('pl-PL') + ' ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function renderPanel() {
    const p = panel();
    if (!p || !SK.ui) return;
    const icon = SK.ui.icon;
    const esc = SK.ui.esc || function (s) { return String(s == null ? '' : s); };
    const items = list();

    const perm = permission();
    const enable = perm === 'granted'
      ? '<span class="badge ok">' + icon('check') + ' Powiadomienia systemowe: włączone</span>'
      : perm === 'unsupported'
        ? '<span class="badge warn">' + icon('x') + ' Brak wsparcia w przeglądarce</span>'
        : '<button class="btn btn-sm" data-action="notify:enable">' + icon('bell') + ' Włącz powiadomienia systemowe</button>';

    const body = items.length
      ? '<div class="notify-list">' + items.map(function (e) {
        return '<div class="notify-item ' + esc(e.type) + '">' +
          '<i data-lucide="' + (ICONS[e.type] || ICONS.info) + '"></i>' +
          '<div class="ni-body"><div class="ni-title">' + esc(e.title) + '</div>' +
          (e.detail ? '<div class="ni-detail">' + esc(e.detail) + '</div>' : '') +
          '<div class="ni-time">' + esc(when(e.at)) + '</div></div></div>';
      }).join('') + '</div>'
      : '<p class="hint" style="margin:8px 4px">Brak zdarzeń. Tu pojawią się zapisy na serwerze, połączenia i błędy.</p>';

    p.innerHTML =
      '<div class="notify-head"><div class="row" style="gap:8px">' + icon('bell') + '<b>Powiadomienia</b></div>' +
      '<div class="row" style="gap:6px">' +
      (items.length ? '<button class="btn btn-sm btn-ghost" data-action="notify:clear">' + icon('trash-2') + ' Wyczyść</button>' : '') +
      '<button class="btn btn-icon btn-ghost" data-action="notify:close" aria-label="Zamknij">' + icon('x') + '</button>' +
      '</div></div>' +
      '<div class="notify-enable">' + enable + '</div>' +
      body;

    if (SK.ui.refresh) SK.ui.refresh();
  }

  function openPanel() {
    const el = rootEl();
    if (!el) return;
    renderPanel();
    el.classList.add('open');
    markSeen();
  }
  function closePanel() { const el = rootEl(); if (el) el.classList.remove('open'); }
  function togglePanel() { isOpen() ? closePanel() : openPanel(); }

  /* ---------------- odznaka ---------------- */
  function paintBadge() {
    if (!doc) return;
    const n = unread();
    ['notify-badge', 'm-notify-badge'].forEach(function (id) {
      const b = doc.getElementById(id);
      if (!b) return;
      b.textContent = n > 99 ? '99+' : String(n);
      if (n > 0) b.removeAttribute('hidden'); else b.setAttribute('hidden', '');
    });
    const btns = ['notify-btn', 'm-notify'];
    btns.forEach(function (id) {
      const el = doc.getElementById(id);
      if (el) el.classList.toggle('has-unread', n > 0);
    });
  }

  /* ---------------- init ---------------- */
  function init() {
    if (!doc) return false;
    paintBadge();
    const wire = function (id) {
      const b = doc.getElementById(id);
      if (b) b.addEventListener('click', function (e) { e.preventDefault(); togglePanel(); });
    };
    wire('notify-btn');
    wire('m-notify');
    const el = rootEl();
    if (el) el.addEventListener('click', function (e) { if (e.target === el) closePanel(); });
    return true;
  }

  SK.notify = {
    add: add, log: log, list: list, unread: unread, clear: clear,
    markSeen: markSeen, sound: sound, system: system,
    permission: permission, requestPermission: requestPermission,
    open: openPanel, close: closePanel, toggle: togglePanel,
    render: renderPanel, badge: paintBadge, init: init,
  };
})(typeof window !== 'undefined' ? window : globalThis);

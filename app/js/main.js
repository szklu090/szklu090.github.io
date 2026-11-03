/* ============================================================
   stol-kos — main.js
   Router, nawigacja, paleta poleceń, skróty, PWA, start aplikacji.
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const C = SK.compute;
  const U = SK.ui;
  const S = SK.store;
  const V = SK.views;
  const A = SK.actions;
  const doc = root.document;
  const icon = U.icon;
  const esc = C.escapeHtml;

  let current = 'dashboard';
  let deferredPrompt = null;

  /* ============================================================
     Render / chrome
     ============================================================ */
  function render(page) {
    const el = doc.getElementById('page-' + page);
    if (!el) return;
    el.innerHTML = V.render(page);
    U.refresh();
    if (page === 'add') setTimeout(V.updateAddPreview, 0);
  }

  function updateChrome() {
    const st = S.get();
    const meta = V.meta[current] || { title: '', sub: '' };
    const t = doc.getElementById('page-title');
    const s = doc.getElementById('page-sub');
    if (t) t.textContent = meta.title;
    if (s) s.textContent = meta.sub;

    const nc = doc.getElementById('nav-count-entries');
    if (nc) nc.textContent = st.entries.length ? String(st.entries.length) : '';

    try {
      const bytes = new Blob([localStorage.getItem(S.KEY) || '']).size;
      const label = (bytes / 1024).toFixed(1) + ' kB';
      const a = doc.getElementById('storage-info');
      const b = doc.getElementById('storage-info2');
      if (a) a.textContent = label;
      if (b) b.textContent = label + ' · localStorage';
    } catch (e) { /* ignore */ }

    const pwa = doc.getElementById('pwa-install');
    if (pwa) pwa.style.display = deferredPrompt ? '' : 'none';
  }

  function refresh() {
    render(current);
    updateChrome();
    if (current === 'dashboard') tick();
  }

  function go(page, opts) {
    if (!V.meta[page]) page = 'dashboard';
    current = page;
    doc.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + page); });
    doc.querySelectorAll('[data-page]').forEach(function (b) { b.classList.toggle('active', b.dataset.page === page); });
    refresh();
    if (!opts || !opts.silent) {
      try { history.replaceState(null, '', '#' + page); } catch (e) { /* ignore */ }
    }
    try { root.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { root.scrollTo(0, 0); }
  }

  /* ============================================================
     Zegar stopera
     ============================================================ */
  function tick() {
    const st = S.get();
    if (!st.timer) return;
    const el = doc.getElementById('timer-big');
    if (!el) return;
    const sec = Math.max(0, Math.floor((Date.now() - st.timer.start) / 1000));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    el.textContent = h + ':' + C.pad2(m) + ':' + C.pad2(s);
  }

  /* ============================================================
     Filtry (data-filter)
     ============================================================ */
  function setFilter(el) {
    const path = el.dataset.filter;
    if (!path) return;
    const parts = path.split('.');
    const vs = SK.viewState[parts[0]];
    if (!vs) return;
    vs[parts[1]] = el.value;
    const group = parts[0];
    if (!V.meta[group]) return;
    const saved = current;
    current = group;
    render(group);
    updateChrome();
    current = saved;
    if (el.id) {
      const again = doc.getElementById(el.id);
      if (again) {
        again.focus();
        try { again.setSelectionRange(again.value.length, again.value.length); } catch (e) { /* ignore */ }
      }
    }
  }

  /* ============================================================
     Paleta poleceń
     ============================================================ */
  let paletteOpen = false;
  let paletteSel = 0;
  let paletteFiltered = [];

  function paletteItems() {
    const items = [
      { label: 'Pulpit', ico: 'layout-dashboard', hint: 'strona', run: function () { go('dashboard'); } },
      { label: 'Wpisy', ico: 'list-checks', hint: 'strona', run: function () { go('entries'); } },
      { label: 'Kalendarz', ico: 'calendar-days', hint: 'strona', run: function () { go('calendar'); } },
      { label: 'Dodaj wpis', ico: 'plus-circle', hint: 'strona', run: function () { go('add'); } },
      { label: 'Statystyki', ico: 'bar-chart-3', hint: 'strona', run: function () { go('stats'); } },
      { label: 'Rozliczenia', ico: 'receipt', hint: 'strona', run: function () { go('settlements'); } },
      { label: 'Projekty', ico: 'folder-kanban', hint: 'strona', run: function () { go('projects'); } },
      { label: 'Ustawienia', ico: 'settings-2', hint: 'strona', run: function () { go('settings'); } },
      { label: 'Uruchom stoper', ico: 'play', hint: 'akcja', run: function () { S.startTimer(null, 'Stoper'); go('dashboard'); U.toast('Stoper uruchomiony', 'ok'); } },
      { label: 'Zatrzymaj stoper', ico: 'square', hint: 'akcja', run: function () { A.run('timer:stop'); } },
      { label: 'Przełącz motyw', ico: 'moon', hint: 'akcja', run: function () { U.toggleTheme(); } },
      { label: 'Kopia zapasowa JSON', ico: 'download', hint: 'dane', run: function () { A.run('data:export-json'); } },
      { label: 'Raport CSV', ico: 'file-spreadsheet', hint: 'dane', run: function () { A.run('data:export-csv'); } },
      { label: 'Wyślij miesiąc do Skoroszytu', ico: 'send', hint: 'google', run: function () { A.run('sheets:send'); } },
      { label: 'Połącz z Google', ico: 'cloud', hint: 'google', run: function () { A.run('google:connect'); } },
      { label: 'Dane demonstracyjne', ico: 'wand-2', hint: 'dane', run: function () { A.run('data:demo'); } },
      { label: 'Wyczyść dane', ico: 'trash-2', hint: 'dane', run: function () { A.run('data:clear'); } },
    ];
    S.get().entries.slice(-40).reverse().forEach(function (e) {
      items.push({
        label: (e.note || V.projectName(e.projectId)) + ' · ' + e.date + ' ' + e.start + '–' + e.end,
        ico: 'clock', hint: 'wpis',
        run: function () {
          SK.viewState.entries.mode = 'all';
          SK.viewState.entries.query = e.note || '';
          go('entries');
        },
      });
    });
    return items;
  }

  function paletteRender(q) {
    const query = (q || '').toLowerCase();
    paletteFiltered = paletteItems().filter(function (it) {
      return it.label.toLowerCase().indexOf(query) >= 0 || (it.hint || '').toLowerCase().indexOf(query) >= 0;
    }).slice(0, 40);
    if (paletteSel >= paletteFiltered.length) paletteSel = 0;
    const list = doc.getElementById('palette-list');
    if (!list) return;
    list.innerHTML = paletteFiltered.length
      ? paletteFiltered.map(function (it, i) {
          return '<div class="palette-item' + (i === paletteSel ? ' sel' : '') + '" data-i="' + i + '">' +
            icon(it.ico) + '<span>' + esc(it.label) + '</span><span class="k">' + esc(it.hint || '') + '</span></div>';
        }).join('')
      : '<div class="palette-item" style="cursor:default">Brak wyników</div>';
    U.refresh();
    list.querySelectorAll('[data-i]').forEach(function (el) {
      el.addEventListener('mousedown', function (ev) {
        ev.preventDefault();
        paletteSel = Number(el.dataset.i);
        choosePalette();
      });
    });
  }

  function openPalette() {
    paletteOpen = true;
    paletteSel = 0;
    doc.getElementById('palette-root').classList.add('open');
    const inp = doc.getElementById('palette-input');
    if (inp) { inp.value = ''; setTimeout(function () { inp.focus(); }, 20); }
    paletteRender('');
  }
  function closePalette() {
    paletteOpen = false;
    doc.getElementById('palette-root').classList.remove('open');
  }
  function movePalette(d) {
    if (!paletteFiltered.length) return;
    paletteSel = (paletteSel + d + paletteFiltered.length) % paletteFiltered.length;
    paletteRender(doc.getElementById('palette-input').value);
  }
  function choosePalette() {
    const it = paletteFiltered[paletteSel];
    if (!it) return;
    closePalette();
    it.run();
  }

  /* ============================================================
     PWA install
     ============================================================ */
  function installPwa() {
    if (!deferredPrompt) { U.toast('Instalacja niedostępna w tej przeglądarce', 'err'); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function (res) {
      if (res && res.outcome === 'accepted') U.toast('Aplikacja zainstalowana', 'ok');
      deferredPrompt = null;
      updateChrome();
    });
  }

  /* ============================================================
     Zdarzenia
     ============================================================ */
  function wire() {
    // nawigacja + akcje
    doc.addEventListener('click', function (e) {
      const pageBtn = e.target.closest('[data-page]');
      if (pageBtn) { e.preventDefault(); go(pageBtn.dataset.page); return; }

      const act = e.target.closest('[data-action]');
      if (act) {
        e.preventDefault();
        const name = act.dataset.action;
        if (name === 'pwa:install') { installPwa(); return; }
        A.run(name, act, e);
        return;
      }

      // klik w tło palety zamyka
      if (e.target && e.target.id === 'palette-root') closePalette();
    });

    // formularze
    doc.addEventListener('submit', function (e) {
      const form = e.target.closest('form[data-form]');
      if (!form) return;
      e.preventDefault();
      A.submit(form.dataset.form, form, e);
    });

    // filtry (select/date/month) i podgląd formularza
    doc.addEventListener('change', function (e) {
      const f = e.target.closest('[data-filter]');
      if (f) { setFilter(f); return; }
      if (e.target.closest && e.target.closest('form[data-form="add"]')) V.updateAddPreview();
    });
    doc.addEventListener('input', function (e) {
      const live = e.target.closest('[data-filter][data-live]');
      if (live) { setFilter(live); return; }
      if (e.target.closest && e.target.closest('form[data-form="add"]')) V.updateAddPreview();
    });

    // klawiatura
    doc.addEventListener('keydown', function (e) {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
      if (paletteOpen) {
        if (e.key === 'Escape') closePalette();
        else if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); choosePalette(); }
        return;
      }
      if (e.key === 'Escape') { try { if (SK.notify) SK.notify.close(); } catch (err) { /* ignore */ } U.closeModal(); return; }
      if (!typing && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); go('add'); }
      if (!typing && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); go('calendar'); }
      if (!typing && e.key === '/') { e.preventDefault(); openPalette(); }
    });

    // paleta: input
    const pin = doc.getElementById('palette-input');
    if (pin) pin.addEventListener('input', function () { paletteSel = 0; paletteRender(pin.value); });
    const pbtn = doc.getElementById('palette-btn');
    if (pbtn) pbtn.addEventListener('click', openPalette);
    const msearch = doc.getElementById('m-search');
    if (msearch) msearch.addEventListener('click', openPalette);

    // motyw
    ['theme-toggle', 'm-theme-toggle'].forEach(function (id) {
      const b = doc.getElementById(id);
      if (b) b.addEventListener('click', function () { U.toggleTheme(); });
    });

    // routing hash
    root.addEventListener('hashchange', function () {
      const h = (root.location.hash || '').replace('#', '');
      if (h && V.meta[h] && h !== current) go(h, { silent: true });
    });

    // otwarcie miesiąca z banera przypomnienia
    root.addEventListener('sk:open-month', function (e) {
      const m = e && e.detail && e.detail.month;
      if (m) SK.viewState.settlements.month = m;
      go('settlements');
    });

    // instalacja PWA
    root.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      updateChrome();
    });
    root.addEventListener('appinstalled', function () { deferredPrompt = null; updateChrome(); });
  }

  /* ============================================================
     Start
     ============================================================ */
  function applySyncFromUrl() {
    try {
      const q = new root.URLSearchParams(root.location.search || '');
      const u = q.get('sync') || q.get('syncUrl');
      if (!u) return null;
      const st = S.get();
      st.settings.sync = st.settings.sync || {};
      st.settings.sync.url = String(u).trim();
      if (q.get('secret') != null) st.settings.sync.token = q.get('secret');
      st.settings.sync.auto = q.get('auto') !== '0';
      S.save();
      try {
        root.history.replaceState(null, '', root.location.pathname + (root.location.hash || ''));
      } catch (e) { /* ignore */ }
      return String(u).trim();
    } catch (e) { return null; }
  }

  /** Komunikat + powiadomienie po zastosowaniu konfiguracji z linku. */
  function announceSyncLink(linkedUrl) {
    let host = linkedUrl;
    try { host = new root.URL(linkedUrl).host || linkedUrl; } catch (e) { /* ignore */ }
    try {
      if (SK.notify && SK.notify.add) {
        SK.notify.add('ok', 'Zastosowano konfigurację bazy', 'Podłączono do: ' + host, { system: true, force: true, sound: true });
        if (SK.notify.permission && SK.notify.permission() === 'default') {
          SK.notify.requestPermission().then(function (ok) {
            if (ok && SK.notify.system) SK.notify.system('STOL-KOS', 'Powiadomienia systemowe włączone', true);
          });
        }
      } else {
        U.toast('Zastosowano konfigurację bazy · ' + host, 'ok');
      }
    } catch (e) { /* ignore */ }
  }

  function init() {
    const st = S.load();
    U.applyTheme(st.profile.theme || 'dark');
    const linkedUrl = applySyncFromUrl();

    const h = (root.location.hash || '').replace('#', '');
    current = V.meta[h] ? h : 'dashboard';

    doc.querySelectorAll('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + current); });
    doc.querySelectorAll('[data-page]').forEach(function (b) { b.classList.toggle('active', b.dataset.page === current); });

    wire();
    refresh();

    // powiadomienia (dzwonek, dziennik zdarzeń)
    try { if (SK.notify && SK.notify.init) SK.notify.init(); } catch (e) { /* ignore */ }

    // komunikat, gdy baza została ustawiona z linku (?sync=...)
    if (linkedUrl) announceSyncLink(linkedUrl);

    // synchronizacja z serwerem (auto-zapis po zmianie)
    try { if (SK.sync && SK.sync.init) SK.sync.init(); } catch (e) { /* ignore */ }

    // przypomnienie o zamkniętym miesiącu (opcjonalne powiadomienie)
    try { if (SK.google && SK.google.notifyDue) SK.google.notifyDue(); } catch (e) { /* ignore */ }

    // żywy zegar stopera
    setInterval(tick, 1000);

    // service worker (offline)
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      root.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
      });
    }

    document.documentElement.classList.add('ready');
  }

  SK.main = {
    go: go,
    render: render,
    refresh: refresh,
    tick: tick,
    openPalette: openPalette,
    installPwa: installPwa,
    get current() { return current; },
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================
   stol-kos — actions.js
   Obsługa akcji interfejsu (data-action) i formularzy (data-form).
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const C = SK.compute;
  const U = SK.ui;
  const S = SK.store;
  const V = SK.views;
  const icon = U.icon;
  const esc = C.escapeHtml;
  const doc = root.document;

  function refresh() { SK.main.refresh(); }
  function go(p) { SK.main.go(p); }
  const money = function (v) { return C.money(v, S.get().profile.currency); };

  /** Kopiowanie do schowka bez Clipboard API (starsze przeglądarki / http). */
  function copyFallback(text) {
    try {
      const ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      doc.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = doc.execCommand && doc.execCommand('copy');
      doc.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }

  /* ============================================================
     Kalendarz
     ============================================================ */
  function shiftCal(delta) {
    const f = SK.viewState.calendar;
    const d = C.parseDateKey((f.month || C.dateKey(new Date()).slice(0, 7)) + '-01');
    const nd = new Date(d.getFullYear(), d.getMonth() + delta, 1);
    f.month = C.dateKey(nd).slice(0, 7);
    refresh();
  }

  function openDay(dateKey) {
    const st = S.get();
    const d = C.parseDateKey(dateKey);
    const list = st.entries.filter(function (e) { return e.date === dateKey; })
      .sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); });
    const min = C.totalMin(list);
    const amt = C.sumAmount(list, S.rateOf, st.settings);
    const body = (list.length
      ? '<div class="stack">' + list.map(entryCard).join('') + '</div>' +
        '<div class="row between mt"><span class="muted">Razem</span><b class="accent">' + C.fmtHM(min) + ' · ' + money(amt) + '</b></div>'
      : '<p class="muted" style="margin:0">Brak wpisów w tym dniu.</p>');
    U.openModal({
      title: C.dayName(d) + ', ' + C.fullDate(d),
      body: body,
      footer: '<button class="btn btn-ghost" data-close>Zamknij</button>' +
        '<button class="btn btn-primary" data-action="cal:add" data-date="' + dateKey + '">' + icon('plus') + ' Dodaj wpis</button>',
    });
  }

  /** Karta pojedynczego wpisu w modalu dnia (z akcjami edycji/usuwania). */
  function entryCard(e) {
    return '<div class="entry" style="margin:0">' +
      '<div class="time nowrap"><b>' + esc(e.start) + '</b> — ' + esc(e.end) + '</div>' +
      '<div style="min-width:0"><div class="note">' + esc(e.note || V.projectName(e.projectId)) + '</div>' +
      '<div class="meta"><span class="tag">' + esc(V.projectName(e.projectId)) + '</span>' +
      '<span>' + C.fmtMinLong(C.durationMin(e)) + '</span>' +
      (e.breakMin > 0 ? '<span>przerwa ' + e.breakMin + ' min</span>' : '') +
      (e.gcalEventId ? '<span class="badge gcal">GCal</span>' : '') + '</div></div>' +
      '<div class="amount mono">' + money(S.amountOf(e)) + '</div>' +
      '<div class="tools">' +
      '<button class="btn btn-icon btn-ghost btn-sm" data-action="entry:edit" data-id="' + e.id + '" title="Edytuj">' + icon('pencil') + '</button>' +
      '<button class="btn btn-icon btn-ghost btn-sm" data-action="entry:delete" data-id="' + e.id + '" title="Usuń">' + icon('trash-2') + '</button>' +
      '</div></div>';
  }

  function fillAddForm(f) {
    const form = doc.querySelector('form[data-form="add"]');
    if (!form) return;
    ['date', 'start', 'end', 'breakMin', 'note', 'rate', 'projectId'].forEach(function (k) {
      if (form.elements[k] && f[k] != null) form.elements[k].value = f[k];
    });
    V.updateAddPreview();
  }

  /* ============================================================
     Wpisy
     ============================================================ */
  function validateEntry(f) {
    if (!f.date) return 'Podaj datę.';
    if (!f.start || !f.end) return 'Podaj godzinę rozpoczęcia i zakończenia.';
    const dur = C.durationMin({ start: f.start, end: f.end, breakMin: f.breakMin });
    if (dur <= 0) return 'Czas trwania musi być większy niż 0 (sprawdź godziny i przerwę).';
    return null;
  }

  function handleAdd(form) {
    const f = U.formToObject(form);
    const err = validateEntry(f);
    if (err) { U.toast(err, 'err'); return; }
    const entry = S.addEntry(f);
    if (SK.google) SK.google.autoPush(entry);
    const dur = C.durationMin(entry);
    U.toast('Dodano: ' + C.fmtMinLong(dur) + ' · ' + money(S.amountOf(entry)), 'ok', {
      actionLabel: 'Cofnij',
      onAction: function () {
        S.deleteEntry(entry.id);
        if (SK.google && entry.gcalEventId) SK.google.autoRemove(entry.gcalEventId);
        refresh();
      },
    });
    form.reset();
    go('entries');
  }

  function openEntryEditor(id) {
    const e = S.entryById(id);
    if (!e) return;
    U.openModal({
      title: 'Edytuj wpis',
      body: '<form data-form="edit" data-id="' + id + '">' + V.entryFields(e) +
        '<div class="row mt" style="justify-content:flex-end">' +
        '<button type="button" class="btn btn-ghost" data-close>Anuluj</button>' +
        '<button type="submit" class="btn btn-primary">' + icon('save') + ' Zapisz</button></div></form>',
    });
  }

  function handleEdit(form) {
    const id = form.dataset.id;
    const f = U.formToObject(form);
    const err = validateEntry(f);
    if (err) { U.toast(err, 'err'); return; }
    S.updateEntry(id, f);
    const updated = S.entryById(id);
    if (updated && SK.google) SK.google.autoPush(updated);
    U.closeModal();
    U.toast('Zapisano zmiany', 'ok');
    refresh();
  }

  function prefillAddForm() {
    const form = doc.querySelector('form[data-form="add"]');
    if (!form) return;
    const st = S.get();
    if (form.elements.projectId) {
      form.elements.projectId.innerHTML = V.projectOptions(form.elements.projectId.value, true);
    }
  }

  /* ============================================================
     Stoper
     ============================================================ */
  function handleTimerStart(form) {
    const f = U.formToObject(form);
    S.startTimer(f.projectId || null, f.note || 'Stoper');
    U.toast('Stoper uruchomiony', 'ok');
    refresh();
    SK.main.tick();
  }
  function timerStop() {
    const res = S.stopTimer();
    if (res && res.entry) {
      if (SK.google) SK.google.autoPush(res.entry);
      U.toast('Zapisano ' + C.fmtMinLong(C.durationMin(res.entry)) + ' · ' + money(S.amountOf(res.entry)), 'ok');
    }
    refresh();
  }

  /* ============================================================
     Projekty
     ============================================================ */
  function openProjectEditor(project) {
    const p = project || {};
    const st = S.get();
    const sym = C.symbol(st.profile.currency);
    U.openModal({
      title: p.id ? 'Edytuj projekt' : 'Nowy projekt',
      body: '<form data-form="project" data-id="' + (p.id || '') + '">' +
        '<div class="form-grid">' +
        '<div class="field full"><label>Nazwa</label><input class="input" name="name" value="' + esc(p.name || '') + '" placeholder="np. Montaż – hala A" required /></div>' +
        '<div class="field"><label>Kolor</label><input class="input" type="color" name="color" value="' + (p.color || '#84cc16') + '" style="height:44px;padding:5px" /></div>' +
        '<div class="field"><label>Stawka (' + sym + ')</label><input class="input" type="number" min="0" step="0.5" name="rate" value="' + (p.rate == null ? '' : p.rate) + '" placeholder="' + st.profile.rate + '" /></div>' +
        '<div class="field full"><label>Budżet (' + sym + ')</label><input class="input" type="number" min="0" step="10" name="budget" value="' + (p.budget || 0) + '" /></div>' +
        '</div>' +
        '<div class="row mt" style="justify-content:flex-end">' +
        '<button type="button" class="btn btn-ghost" data-close>Anuluj</button>' +
        '<button type="submit" class="btn btn-primary">' + icon('save') + ' Zapisz</button></div></form>',
    });
  }

  function handleProject(form) {
    const id = form.dataset.id;
    const f = U.formToObject(form);
    if (!f.name) { U.toast('Podaj nazwę projektu', 'err'); return; }
    if (id) S.updateProject(id, f); else S.addProject(f);
    U.closeModal();
    U.toast(id ? 'Projekt zapisany' : 'Projekt dodany', 'ok');
    refresh();
  }

  function deleteProject(id) {
    const p = S.projectById(id);
    if (!p) return;
    const used = S.get().entries.filter(function (e) { return e.projectId === id; }).length;
    U.confirmDialog('Usunąć projekt „' + p.name + '”? ' + (used ? used + ' wpisów straci przypisanie do projektu.' : ''), {
      title: 'Usuń projekt', danger: true, confirmLabel: 'Usuń',
    }).then(function (ok) {
      if (!ok) return;
      S.deleteProject(id);
      U.toast('Projekt usunięty', 'ok');
      refresh();
    });
  }

  /* ============================================================
     Rozliczenia
     ============================================================ */
  function settleToggle(el) {
    const month = SK.viewState.settlements.month;
    const pid = el.dataset.project || null;
    const paid = !!(S.settlement(month, pid) || {}).paid;
    S.setSettlement(month, pid, !paid);
    refresh();
  }

  function settleAll() {
    const month = SK.viewState.settlements.month;
    const d = C.parseDateKey(month + '-01');
    const list = C.filterRange(S.get().entries, C.startOfMonth(d), C.endOfMonth(d));
    const ids = {};
    list.forEach(function (e) { ids[e.projectId || ''] = true; });
    Object.keys(ids).forEach(function (k) { S.setSettlement(month, k || null, true); });
    U.toast('Oznaczono jako rozliczone', 'ok');
    refresh();
  }

  /* ============================================================
     CSV / dane
     ============================================================ */
  function csvCell(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
  function numCsv(n) { return String(Math.round(n * 100) / 100).replace('.', ','); }

  function buildCsv(entries) {
    const st = S.get();
    const rows = [['Data', 'Dzień', 'Od', 'Do', 'Przerwa (min)', 'Projekt', 'Godziny', 'Stawka', 'Mnożnik', 'Kwota', 'Waluta', 'Notatka']];
    entries.forEach(function (e) {
      rows.push([
        e.date, C.dayName(C.parseDateKey(e.date)), e.start, e.end, e.breakMin || 0,
        V.projectName(e.projectId), numCsv(C.durationMin(e) / 60), numCsv(S.rateOf(e)),
        String(C.multiplierFor(e, st.settings)), numCsv(S.amountOf(e)), st.profile.currency, e.note || '',
      ]);
    });
    const totalM = C.totalMin(entries);
    const totalA = C.sumAmount(entries, S.rateOf, st.settings);
    rows.push([]);
    rows.push(['RAZEM', '', '', '', '', '', numCsv(totalM / 60), '', '', numCsv(totalA), st.profile.currency, '']);
    return '\ufeff' + rows.map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
  }

  function exportCsvAll() {
    const entries = S.get().entries.slice().sort(function (a, b) { return a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''); });
    if (!entries.length) { U.toast('Brak wpisów do eksportu', 'err'); return; }
    U.download('stol-kos-raport-' + C.dateKey(new Date()) + '.csv', buildCsv(entries), 'text/csv;charset=utf-8');
    U.toast('Wyeksportowano ' + entries.length + ' wpisów', 'ok');
  }

  function exportFilteredCsv() {
    const list = V.entriesFiltered();
    if (!list.length) { U.toast('Brak wpisów w filtrze', 'err'); return; }
    const f = SK.viewState.entries;
    const tag = f.mode === 'month' ? f.month
      : f.mode === 'week' ? 'tydzien-' + f.week
        : f.mode === 'range' ? ((f.from || 'od') + '_' + (f.to || 'do'))
          : 'wszystkie';
    U.download('stol-kos-raport-' + tag + '.csv', buildCsv(list), 'text/csv;charset=utf-8');
    U.toast('CSV: ' + list.length + ' wpisów', 'ok');
  }

  function exportSettleCsv() {
    const month = SK.viewState.settlements.month;
    const d = C.parseDateKey(month + '-01');
    const list = C.filterRange(S.get().entries, C.startOfMonth(d), C.endOfMonth(d));
    if (!list.length) { U.toast('Brak wpisów w tym miesiącu', 'err'); return; }
    U.download('stol-kos-rozliczenie-' + month + '.csv', buildCsv(list), 'text/csv;charset=utf-8');
    U.toast('Wyeksportowano rozliczenie ' + month, 'ok');
  }

  function exportJson() {
    const data = S.exportData();
    U.download('stol-kos-kopia-' + C.dateKey(new Date()) + '.json', JSON.stringify(data, null, 2), 'application/json');
    S.markBackup();
    U.toast('Kopia zapasowa zapisana', 'ok');
  }

  function importJson() {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const obj = JSON.parse(String(reader.result));
          S.importData(obj);
          U.toast('Wczytano kopię (' + S.get().entries.length + ' wpisów)', 'ok');
          refresh();
        } catch (e) {
          U.toast('Nie udało się wczytać pliku: ' + (e.message || 'błąd'), 'err');
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function normalizeCsvDate(v) {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
    if (m) return m[3] + '-' + C.pad2(m[2]) + '-' + C.pad2(m[1]);
    return null;
  }
  function normalizeCsvTime(v) {
    const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) return null;
    return C.pad2(h) + ':' + C.pad2(mi);
  }
  function csvSplit(line, sep) {
    const out = []; let cur = ''; let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
        } else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  /** Czyta CSV wygenerowany przez stol-kos (lub dowolny o tych kolumnach). */
  function parseCsv(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    const lines = clean.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) throw new Error('Plik CSV jest pusty');
    const first = lines[0];
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
    const header = csvSplit(first, sep).map(function (h) { return h.trim().toLowerCase(); });
    const col = function (names) {
      for (let i = 0; i < names.length; i++) { const k = header.indexOf(names[i]); if (k >= 0) return k; }
      return -1;
    };
    const iDate = col(['data', 'date']);
    const iStart = col(['od', 'start', 'from']);
    const iEnd = col(['do', 'end', 'to']);
    if (iDate < 0 || iStart < 0 || iEnd < 0) throw new Error('CSV musi mieć kolumny: Data, Od, Do');
    const iBreak = col(['przerwa (min)', 'przerwa', 'break']);
    const iProj = col(['projekt', 'project']);
    const iNote = col(['notatka', 'note', 'opis']);
    const iRate = col(['stawka', 'rate']);
    const numAt = function (c, i) {
      if (i < 0) return null;
      const v = String(c[i] == null ? '' : c[i]).replace(',', '.').trim();
      return v === '' ? null : Number(v);
    };
    const rows = [];
    for (let k = 1; k < lines.length; k++) {
      const c = csvSplit(lines[k], sep);
      if (String(c[0] || '').trim().toUpperCase() === 'RAZEM') continue;
      const date = normalizeCsvDate(c[iDate]);
      const start = normalizeCsvTime(c[iStart]);
      const end = normalizeCsvTime(c[iEnd]);
      if (!date || !start || !end) continue;
      const brk = numAt(c, iBreak);
      const rate = numAt(c, iRate);
      rows.push({
        date: date, start: start, end: end,
        breakMin: Math.max(0, Number(brk) || 0),
        projectName: iProj >= 0 ? String(c[iProj] || '').trim() : '',
        note: iNote >= 0 ? String(c[iNote] || '').trim() : '',
        rate: rate != null && rate > 0 ? rate : null,
      });
    }
    return rows;
  }

  function applyCsvImport(rows) {
    const st = S.get();
    const byName = {};
    st.projects.forEach(function (p) { byName[p.name.trim().toLowerCase()] = p.id; });
    const seen = {};
    st.entries.forEach(function (e) { seen[e.date + '|' + e.start + '|' + e.end + '|' + (e.note || '')] = true; });
    let added = 0, skipped = 0, createdProjects = 0;
    rows.forEach(function (r) {
      const key = r.date + '|' + r.start + '|' + r.end + '|' + (r.note || '');
      if (seen[key]) { skipped++; return; }
      let pid = null;
      if (r.projectName) {
        const k = r.projectName.toLowerCase();
        if (byName[k]) pid = byName[k];
        else {
          const p = S.addProject({ name: r.projectName, color: '#84cc16' });
          byName[k] = p.id; pid = p.id; createdProjects++;
        }
      }
      S.addEntry({ date: r.date, start: r.start, end: r.end, breakMin: r.breakMin, projectId: pid, note: r.note, rate: r.rate });
      seen[key] = true; added++;
    });
    U.toast('Import CSV: +' + added + ' wpisów' + (skipped ? ' · pominięto ' + skipped + ' duplikatów' : '') +
      (createdProjects ? ' · nowe projekty: ' + createdProjects : ''), added ? 'ok' : 'info');
    refresh();
  }

  function importCsv() {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,text/plain';
    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        let rows;
        try { rows = parseCsv(String(reader.result)); }
        catch (e) { U.toast(e.message || 'Nie udało się odczytać CSV', 'err'); return; }
        if (!rows.length) { U.toast('Brak poprawnych wierszy w CSV', 'err'); return; }
        U.confirmDialog('Zaimportować ' + rows.length + ' wpisów z pliku „' + file.name + '”? Duplikaty zostaną pominięte.', {
          title: 'Import CSV', confirmLabel: 'Importuj',
        }).then(function (ok) { if (ok) applyCsvImport(rows); });
      };
      reader.readAsText(file, 'utf-8');
    });
    input.click();
  }

  function demoData() {
    U.confirmDialog('Zastąpić obecne dane przykładowymi (30 dni, 3 projekty)?', { title: 'Dane demo', confirmLabel: 'Wstaw demo' })
      .then(function (ok) {
        if (!ok) return;
        S.seedDemo();
        U.toast('Wstawiono dane demonstracyjne', 'ok');
        go('dashboard');
      });
  }

  function clearData() {
    U.confirmDialog('Usunąć WSZYSTKIE dane? Tej operacji nie można cofnąć. Zalecamy najpierw kopię JSON.', {
      title: 'Wyczyść dane', danger: true, confirmLabel: 'Usuń wszystko',
    }).then(function (ok) {
      if (!ok) return;
      S.clearAll();
      U.toast('Dane wyczyszczone', 'ok');
      go('dashboard');
    });
  }

  /* ============================================================
     Logowanie i konta (SK.auth — konta na serwerze)
     ============================================================ */
  /** Zapisuje sekret bazy, gdy użytkownik wpisał go na ekranie logowania. */
  function authSaveSecret(f) {
    if (!f || !f.secret) return;
    const st = S.get();
    st.settings.sync = st.settings.sync || {};
    st.settings.sync.token = String(f.secret);
    S.save();
  }

  function authLogin(form) {
    if (!SK.auth) return;
    const f = U.formToObject(form);
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    SK.auth.login(f.username, f.password, !!f.remember).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) {
        SK.auth.showError(r.error);
        const p = form.elements.password;
        if (p) { p.value = ''; try { p.focus(); } catch (e) { /* ignore */ } }
        return;
      }
      U.toast('Zalogowano jako ' + r.user.name, 'ok');
      refresh();
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      SK.auth.showError(e.message || 'Błąd logowania');
    });
  }

  function authSetup(form) {
    if (!SK.auth) return;
    const f = U.formToObject(form);
    if (f.password !== f.password2) { SK.auth.showError('Hasła nie są takie same.'); return; }
    authSaveSecret(f);
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    SK.auth.setup(f.username, f.password).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) { SK.auth.showError(r.error); return; }
      U.toast('Konto właściciela utworzone na serwerze', 'ok');
      refresh();
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      SK.auth.showError(e.message || 'Błąd');
    });
  }

  function authRecover(form) {
    if (!SK.auth) return;
    const f = U.formToObject(form);
    if (f.password !== f.password2) { SK.auth.showError('Hasła nie są takie same.'); return; }
    authSaveSecret(f);
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    SK.auth.recover(f.username, f.password).then(function (r) {
      if (btn) btn.disabled = false;
      if (!r.ok) { SK.auth.showError(r.error); return; }
      U.toast('Hasło zmienione — zaloguj się', 'ok');
      SK.auth.showLogin();
    }).catch(function (e) {
      if (btn) btn.disabled = false;
      SK.auth.showError(e.message || 'Błąd');
    });
  }

  function openUserAdd() {
    U.openModal({
      title: 'Dodaj użytkownika',
      body: '<form data-form="auth-user-add" class="stack">' +
        '<div class="field"><label>Nazwa użytkownika</label><input class="input" name="username" autocomplete="off" required /></div>' +
        '<div class="field"><label>Hasło</label><input class="input" type="password" name="password" autocomplete="new-password" required /></div>' +
        '<div class="field"><label>Rola</label><select class="select" name="role"><option value="user">Użytkownik</option><option value="owner">Właściciel</option></select></div>' +
        '<div class="row mt" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-close>Anuluj</button>' +
        '<button type="submit" class="btn btn-primary">' + icon('user-plus') + ' Dodaj</button></div>' +
        '</form>',
    });
  }

  function openUserRename(u) {
    U.openModal({
      title: 'Zmień nazwę użytkownika',
      body: '<form data-form="auth-user-name" data-id="' + u.id + '" class="stack">' +
        '<div class="field"><label>Nazwa użytkownika</label><input class="input" name="username" value="' + esc(u.name) + '" required /></div>' +
        '<div class="row mt" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-close>Anuluj</button>' +
        '<button type="submit" class="btn btn-primary">' + icon('save') + ' Zapisz</button></div>' +
        '</form>',
    });
  }

  function openUserPassword(u) {
    U.openModal({
      title: 'Nowe hasło — ' + u.name,
      body: '<form data-form="auth-user-pass" data-id="' + u.id + '" class="stack">' +
        '<div class="field"><label>Nowe hasło</label><input class="input" type="password" name="password" autocomplete="new-password" required /></div>' +
        '<div class="field"><label>Powtórz hasło</label><input class="input" type="password" name="password2" autocomplete="new-password" required /></div>' +
        '<div class="row mt" style="justify-content:flex-end"><button type="button" class="btn btn-ghost" data-close>Anuluj</button>' +
        '<button type="submit" class="btn btn-primary">' + icon('key-round') + ' Zmień hasło</button></div>' +
        '</form>',
    });
  }

  function authUserAdd(form) {
    const f = U.formToObject(form);
    U.toast('Zapisuję konto na serwerze…');
    SK.auth.addUser(f.username, f.password, f.role).then(function (r) {
      if (!r.ok) { U.toast(r.error, 'err'); return; }
      U.closeModal();
      U.toast('Dodano użytkownika ' + r.user.name, 'ok');
      refresh();
    });
  }
  function authUserName(form) {
    const f = U.formToObject(form);
    SK.auth.renameUser(form.dataset.id, f.username).then(function (r) {
      if (!r.ok) { U.toast(r.error, 'err'); return; }
      U.closeModal();
      U.toast('Nazwa zmieniona', 'ok');
      refresh();
    });
  }
  function authUserPass(form) {
    const f = U.formToObject(form);
    if (f.password !== f.password2) { U.toast('Hasła nie są takie same', 'err'); return; }
    SK.auth.setPassword(form.dataset.id, f.password).then(function (r) {
      if (!r.ok) { U.toast(r.error, 'err'); return; }
      U.closeModal();
      U.toast('Hasło zmienione', 'ok');
      refresh();
    });
  }
  function authSelfPass(form) {
    const f = U.formToObject(form);
    if (f.next !== f.next2) { U.toast('Nowe hasła nie są takie same', 'err'); return; }
    SK.auth.changeOwnPassword(f.current, f.next).then(function (r) {
      if (!r.ok) { U.toast(r.error, 'err'); return; }
      form.reset();
      U.toast('Hasło zmienione', 'ok');
    });
  }

  /* ============================================================
     Formularze ustawień
     ============================================================ */
  function saveProfile(form) {
    const f = U.formToObject(form);
    const st = S.get();
    st.profile.name = f.name || '';
    st.profile.rate = Number(f.rate) || 0;
    if (C.CURRENCIES[f.currency]) st.profile.currency = f.currency;
    S.save();
    U.toast('Profil zapisany', 'ok');
    refresh();
  }
  function saveGoals(form) {
    const f = U.formToObject(form);
    const st = S.get();
    st.profile.goalDaily = Math.max(0, Number(f.goalDaily) || 0);
    st.profile.goalWeekly = Math.max(0, Number(f.goalWeekly) || 0);
    st.profile.goalMonthly = Math.max(0, Number(f.goalMonthly) || 0);
    S.save();
    U.toast('Cele zapisane', 'ok');
    refresh();
  }
  function saveWork(form) {
    const st = S.get();
    const el = form.elements;
    st.settings.applyWeekend = !!el.applyWeekend.checked;
    st.settings.weekendMultiplier = Math.max(1, Number(el.weekendMultiplier.value) || 1);
    st.settings.nightMultiplier = Math.max(1, Number(el.nightMultiplier.value) || 1);
    st.settings.nightStart = C.clamp(Number(el.nightStart.value) || 0, 0, 23);
    st.settings.nightEnd = C.clamp(Number(el.nightEnd.value) || 0, 0, 23);
    st.settings.autoBreak = Math.max(0, Number(el.autoBreak.value) || 0);
    st.settings.otAfter = Math.max(0, Number(el.otAfter.value) || 0);
    st.settings.otMultiplier = Math.max(1, Number(el.otMultiplier.value) || 1);
    st.settings.roundTo = [0, 5, 10, 15, 30].indexOf(Number(el.roundTo.value)) >= 0 ? Number(el.roundTo.value) : 0;
    st.profile.weekStartsMonday = el.weekStartsMonday.value === '1';
    S.save();
    U.toast('Ustawienia pracy zapisane', 'ok');
    refresh();
  }

  function saveGoogle(form) {
    const f = U.formToObject(form);
    const st = S.get();
    st.settings.google.clientId = String(f.clientId || '').trim();
    st.settings.google.spreadsheetId = String(f.spreadsheetId || '').trim();
    st.settings.google.sheetName = String(f.sheetName || '').trim();
    st.settings.google.autoCalendar = !!(form.elements.autoCalendar && form.elements.autoCalendar.checked);
    st.settings.google.notify = !!(form.elements.notify && form.elements.notify.checked);
    S.save();
    if (st.settings.google.notify && SK.google) SK.google.requestNotify();
    U.toast('Ustawienia Google zapisane', 'ok');
    refresh();
  }

  /** Wyciąga adres i sekret z pełnego linku konfiguracyjnego (?sync=...&secret=...). */
  function parseSyncLink(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const qi = s.indexOf('?');
    const hi = s.indexOf('sync=');
    if (qi < 0 && hi < 0) return null;
    try {
      const qs = s.slice(qi >= 0 ? qi + 1 : hi);
      const q = new root.URLSearchParams(qs);
      const u = q.get('sync') || q.get('syncUrl');
      if (!u) return null;
      return { url: String(u).trim(), secret: q.get('secret'), auto: q.get('auto') !== '0' };
    } catch (e) { return null; }
  }

  function saveSync(form) {
    const f = U.formToObject(form);
    const st = S.get();
    st.settings.sync = st.settings.sync || {};
    const pasted = parseSyncLink(f.syncLink);
    if (pasted) {
      st.settings.sync.url = pasted.url;
      if (pasted.secret != null) st.settings.sync.token = pasted.secret;
      st.settings.sync.auto = pasted.auto && !!(form.elements.syncAuto && form.elements.syncAuto.checked);
    } else {
      st.settings.sync.url = String(f.syncUrl || '').trim();
      st.settings.sync.token = String(f.syncToken || '');
      st.settings.sync.auto = !!(form.elements.syncAuto && form.elements.syncAuto.checked);
    }
    S.save();
    U.toast(pasted ? 'Zastosowano link konfiguracyjny' : 'Ustawienia bazy zapisane', 'ok');
    if (pasted && SK.notify) {
      try { SK.notify.log('link', 'Zastosowano link konfiguracyjny', 'Podłączono do bazy'); } catch (e) { /* ignore */ }
    }
    // Serwer = źródło prawdy: po zapisaniu ustawień wczytaj dane (albo wyślij lokalne).
    if (SK.sync && SK.sync.bootstrap) {
      SK.sync.bootstrap({ loud: true }).then(function () { refresh(); });
    } else {
      refresh();
    }
  }

  /* ============================================================
     Google — akcje i wysyłka miesiąca
     ============================================================ */
  function sendMonth(month) {
    const G = SK.google;
    if (!G) { U.toast('Integracja Google niedostępna', 'err'); return; }
    const st = S.get();
    const key = month || (SK.viewState.settlements && SK.viewState.settlements.month) || C.dateKey(new Date()).slice(0, 7);
    const extraEl = doc.getElementById('sheet-extra');
    const extra = extraEl ? (Number(extraEl.value) || 0) : 0;
    U.toast('Wysyłam ' + G.monthLabel(key) + ' do Skoroszytu…');
    G.exportMonth(key, extra).then(function (res) {
      U.toast('Wysłano: ' + res.title + ' · ' + G.formatHours(res.stats.hours) + ' h', 'ok');
      refresh();
    }).catch(function (e) {
      U.toast('Błąd wysyłki: ' + e.message, 'err');
    });
  }

  function openMonth(month) {
    if (month) SK.viewState.settlements.month = month;
    go('settlements');
  }

  /* ============================================================
     Rejestr akcji
     ============================================================ */
  const ACTIONS = {
    'theme:toggle': function () { U.toggleTheme(); },
    'theme:set': function (el) {
      const st = S.get();
      st.profile.theme = el.dataset.value === 'light' ? 'light' : 'dark';
      S.save();
      U.applyTheme(st.profile.theme);
      refresh();
    },

    'timer:stop': timerStop,
    'timer:discard': function () {
      U.confirmDialog('Odrzucić bieżący pomiar stopera?', { title: 'Odrzuć pomiar', danger: true, confirmLabel: 'Odrzuć' })
        .then(function (ok) { if (!ok) return; S.get().timer = null; S.save(); refresh(); });
    },

    'entry:edit': function (el) { openEntryEditor(el.dataset.id); },
    'entry:delete': function (el) {
      const e = S.entryById(el.dataset.id);
      if (!e) return;
      U.confirmDialog('Usunąć wpis „' + (e.note || V.projectName(e.projectId)) + '” z ' + C.fullDate(C.parseDateKey(e.date)) + '?', {
        title: 'Usuń wpis', danger: true, confirmLabel: 'Usuń',
      }).then(function (ok) {
        if (!ok) return;
        S.deleteEntry(e.id);
        if (e.gcalEventId && SK.google) SK.google.autoRemove(e.gcalEventId);
        U.toast('Wpis usunięty', 'ok', {
          actionLabel: 'Cofnij',
          onAction: function () {
            S.restoreEntry(e);
            if (SK.google) SK.google.autoPush(e);
            refresh();
          },
        });
        refresh();
      });
    },
    'entry:duplicate': function (el) {
      const copy = S.duplicateEntry(el.dataset.id);
      if (copy) {
        if (SK.google) SK.google.autoPush(copy);
        U.toast('Zduplikowano wpis', 'ok');
      }
      refresh();
    },

    'entries:mode': function (el) {
      const f = SK.viewState.entries;
      f.mode = el.dataset.value;
      if (f.mode === 'range' && !f.from && !f.to) {
        f.from = C.dateKey(C.addDays(new Date(), -30));
        f.to = C.dateKey(new Date());
      }
      refresh();
    },

    'entries:csv': exportFilteredCsv,
    'app:print': function () {
      try { root.print(); } catch (e) { U.toast('Druk niedostępny', 'err'); }
    },

    'add:preset': function (el) {
      const form = doc.querySelector('form[data-form="add"]');
      if (!form) return;
      if (form.elements.start) form.elements.start.value = el.dataset.from;
      if (form.elements.end) form.elements.end.value = el.dataset.to;
      V.updateAddPreview();
    },

    'stats:scope': function (el) { SK.viewState.stats.scope = el.dataset.value; refresh(); },

    'cal:prev': function () { shiftCal(-1); },
    'cal:next': function () { shiftCal(1); },
    'cal:today': function () { SK.viewState.calendar.month = C.dateKey(new Date()).slice(0, 7); refresh(); },
    'cal:day': function (el) { openDay(el.dataset.date); },
    'cal:add': function (el) {
      U.closeModal();
      SK.viewState.add.date = el.dataset.date || C.dateKey(new Date());
      go('add');
    },

    'add:template': function (el) {
      const t = S.templateById(el.dataset.id);
      const form = doc.querySelector('form[data-form="add"]');
      if (!t || !form) return;
      const set = function (name, val) { if (form.elements[name]) form.elements[name].value = val; };
      set('start', t.start); set('end', t.end); set('breakMin', t.breakMin); set('note', t.note);
      set('projectId', t.projectId || '');
      set('rate', t.rate == null ? '' : t.rate);
      V.updateAddPreview();
      U.toast('Wstawiono: ' + t.name, 'ok');
    },
    'add:save-template': function () {
      const form = doc.querySelector('form[data-form="add"]');
      if (!form) return;
      const f = U.formToObject(form);
      if (!f.start || !f.end) { U.toast('Uzupełnij godziny, żeby zapisać szablon', 'err'); return; }
      U.promptDialog({ title: 'Nowy szablon', label: 'Nazwa szablonu', value: f.note || 'Mój szablon', confirmLabel: 'Zapisz' })
        .then(function (name) {
          if (name == null || String(name).trim() === '') return;
          S.addTemplate({ name: name, start: f.start, end: f.end, breakMin: f.breakMin, projectId: f.projectId || null, note: f.note || '', rate: f.rate || null });
          U.toast('Szablon zapisany', 'ok');
          refresh();
          fillAddForm(f);
        });
    },
    'tpl:delete': function (el) {
      const t = S.templateById(el.dataset.id);
      if (!t) return;
      const form = doc.querySelector('form[data-form="add"]');
      const keep = form ? U.formToObject(form) : null;
      U.confirmDialog('Usunąć szablon „' + t.name + '”?', { title: 'Usuń szablon', danger: true, confirmLabel: 'Usuń' })
        .then(function (ok) {
          if (!ok) return;
          S.deleteTemplate(t.id);
          U.toast('Szablon usunięty', 'ok');
          refresh();
          if (keep) fillAddForm(keep);
        });
    },

    'project:add': function () { openProjectEditor(null); },
    'project:edit': function (el) { openProjectEditor(S.projectById(el.dataset.id)); },
    'project:delete': function (el) { deleteProject(el.dataset.id); },
    'project:archive': function (el) {
      const p = S.projectById(el.dataset.id);
      if (!p) return;
      S.updateProject(p.id, { archived: !p.archived });
      U.toast(p.archived ? 'Projekt przywrócony' : 'Projekt zarchiwizowany', 'ok');
      refresh();
    },

    'settle:toggle': settleToggle,
    'settle:all': settleAll,
    'settle:export': exportSettleCsv,

    // Google / Skoroszyt
    'google:connect': function () {
      if (!SK.google) return;
      U.toast('Łączę z Google…');
      SK.google.connect().then(function () {
        U.toast('Połączono z Google', 'ok');
        refresh();
      }).catch(function (e) { U.toast(e.message, 'err'); });
    },
    'google:disconnect': function () {
      if (SK.google) SK.google.disconnect();
      U.toast('Rozłączono z Google', 'ok');
      refresh();
    },
    'google:test': function () {
      if (!SK.google) return;
      U.toast('Sprawdzam połączenie…');
      SK.google.testSheet().then(function (r) {
        U.toast('Skoroszyt „' + r.title + '” · ' + r.sheets + ' zakładek', 'ok');
      }).catch(function (e) { U.toast('Błąd: ' + e.message, 'err'); });
    },
    'sheets:send': function (el) { sendMonth(el && el.dataset.month); },
    'sheets:open': function () {
      const id = SK.google ? SK.google.extractSpreadsheetId(S.get().settings.google.spreadsheetId) : '';
      if (!id) { U.toast('Brak Skoroszytu w Ustawieniach', 'err'); return; }
      try { root.open('https://docs.google.com/spreadsheets/d/' + id, '_blank'); }
      catch (e) { U.toast('Nie można otworzyć Skoroszytu', 'err'); }
    },
    'sheets:recalc': function () { refresh(); },
    'sk:open-month': function (el) { openMonth(el && el.dataset.month); },

    // Baza na serwerze (Google Apps Script)
    'sync:push': function () {
      if (!SK.sync) return;
      U.toast('Wysyłam dane na serwer...');
      SK.sync.push().then(function (r) {
        U.toast('Zapisano na serwerze · ' + (r.entries || 0) + ' wpisów', 'ok');
        refresh();
      }).catch(function (e) { U.toast('Błąd: ' + e.message, 'err'); });
    },
    'sync:pull': function () {
      if (!SK.sync) return;
      U.confirmDialog('Pobrać dane z serwera? Obecne dane w aplikacji zostaną zastąpione.', {
        title: 'Pobierz z serwera', confirmLabel: 'Pobierz',
      }).then(function (ok) {
        if (!ok) return;
        U.toast('Pobieram z serwera...');
        SK.sync.pull().then(function (data) {
          SK.sync.applyRemote(data);
          U.toast('Pobrano dane z serwera', 'ok');
          refresh();
        }).catch(function (e) { U.toast('Błąd: ' + e.message, 'err'); });
      });
    },
    'sync:test': function () {
      if (!SK.sync) return;
      const c = (S.get().settings || {}).sync || {};
      if (!String(c.url || '').trim()) { U.toast('Najpierw wpisz adres Web App', 'err'); return; }
      U.toast('Sprawdzam serwer...');
      SK.sync.push().then(function () {
        U.toast('Serwer odpowiada i zapisał dane', 'ok');
        refresh();
      }).catch(function (e) { U.toast('Błąd: ' + e.message, 'err'); });
    },
    'sync:link': function () {
      const c = (S.get().settings || {}).sync || {};
      const u = String(c.url || '').trim();
      if (!u) { U.toast('Najpierw wpisz adres Web App i zapisz', 'err'); return; }
      const q = new root.URLSearchParams();
      q.set('v', '42');
      q.set('sync', u);
      if (c.token) q.set('secret', c.token);
      if (c.auto === false) q.set('auto', '0');
      const link = root.location.origin + root.location.pathname + '?' + q.toString();

      const done = function () { U.toast('Link skopiowany — wyślij go na inne urządzenie', 'ok'); };
      const fail = function () { copyFallback(link) ? done() : U.toast('Nie udało się skopiować. Skopiuj ręcznie: ' + link, 'err'); };
      try {
        if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
          root.navigator.clipboard.writeText(link).then(done, fail);
        } else { fail(); }
      } catch (e) { fail(); }
    },

    // Powiadomienia (dzwonek)
    'notify:open': function () { if (SK.notify) SK.notify.open(); },
    'notify:close': function () { if (SK.notify) SK.notify.close(); },
    'notify:clear': function () {
      if (!SK.notify) return;
      SK.notify.clear();
      U.toast('Wyczyszczono powiadomienia', 'ok');
    },
    'notify:enable': function () {
      if (!SK.notify) return;
      SK.notify.requestPermission().then(function (ok) {
        if (ok) {
          U.toast('Powiadomienia systemowe włączone', 'ok');
          SK.notify.system('STOL-KOS', 'Powiadomienia systemowe są włączone', true);
        } else {
          U.toast('Przeglądarka nie zgodziła się na powiadomienia', 'err');
        }
        SK.notify.render();
      });
    },

    // Logowanie / konta (serwer)
    'auth:logout': function () {
      if (!SK.auth) return;
      U.confirmDialog('Wylogować się?', { title: 'Wyloguj', confirmLabel: 'Wyloguj' }).then(function (ok) {
        if (!ok) return;
        SK.auth.logout().then(function () { U.toast('Wylogowano', 'ok'); });
      });
    },
    'auth:recover': function () { if (SK.auth) SK.auth.showRecover(); },
    'auth:show-login': function () { if (SK.auth) SK.auth.showLogin(); },
    'auth:retry': function () {
      if (!SK.auth) return;
      U.toast('Sprawdzam serwer…');
      SK.auth.retry();
    },
    'auth:legacy': function () {
      if (!SK.auth) return;
      SK.auth.legacyEnter();
      U.toast('Wejście bez kont (serwer bez obsługi logowania)', 'info');
    },
    'auth:users-refresh': function () {
      if (!SK.auth) return;
      SK.auth.loadUsers().then(function () { refresh(); });
    },
    'auth:show-pass': function (el) {
      const wrap = el.closest('.auth-pass');
      const input = wrap ? wrap.querySelector('input') : null;
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      el.innerHTML = icon(show ? 'eye-off' : 'eye');
      U.refresh();
    },
    'auth:user-add': openUserAdd,
    'auth:user-name': function (el) {
      const u = (SK.auth.list() || []).filter(function (x) { return x.id === el.dataset.id; })[0];
      if (u) openUserRename(u);
    },
    'auth:user-pass': function (el) {
      const u = (SK.auth.list() || []).filter(function (x) { return x.id === el.dataset.id; })[0];
      if (u) openUserPassword(u);
    },
    'auth:user-role': function (el) {
      const id = el.dataset.id;
      const u = (SK.auth.list() || []).filter(function (x) { return x.id === id; })[0];
      if (!u) return;
      const next = u.role === 'owner' ? 'user' : 'owner';
      SK.auth.setRole(id, next).then(function (r) {
        if (!r.ok) { U.toast(r.error, 'err'); return; }
        U.toast(next === 'owner' ? 'Nadano uprawnienia właściciela' : 'Odebrano uprawnienia właściciela', 'ok');
        refresh();
      });
    },
    'auth:user-del': function (el) {
      const id = el.dataset.id;
      const u = (SK.auth.list() || []).filter(function (x) { return x.id === id; })[0];
      if (!u) return;
      U.confirmDialog('Usunąć konto „' + u.name + '”?', { title: 'Usuń konto', danger: true, confirmLabel: 'Usuń' })
        .then(function (ok) {
          if (!ok) return;
          SK.auth.removeUser(id).then(function (r) {
            if (!r.ok) { U.toast(r.error, 'err'); return; }
            U.toast('Konto usunięte', 'ok');
            refresh();
          });
        });
    },

    'data:export-json': exportJson,
    'data:import-json': importJson,
    'data:import-csv': importCsv,
    'data:export-csv': exportCsvAll,
    'data:restore-snapshot': function () {
      const info = S.snapshotInfo();
      if (!info) { U.toast('Brak kopii awaryjnej', 'err'); return; }
      U.confirmDialog('Przywrócić dane z kopii z ' + C.fullDate(new Date(info.at)) + ' (' + info.entries + ' wpisów)? Obecne dane zostaną zastąpione.', {
        title: 'Przywróć kopię', confirmLabel: 'Przywróć',
      }).then(function (ok) {
        if (!ok) return;
        if (S.restoreSnapshot()) { U.toast('Przywrócono kopię awaryjną', 'ok'); go('dashboard'); }
        else U.toast('Nie udało się przywrócić kopii', 'err');
      });
    },
    'data:demo': demoData,
    'data:clear': clearData,
  };

  const SUBMITS = {
    add: handleAdd,
    edit: handleEdit,
    timer: handleTimerStart,
    project: handleProject,
    profile: saveProfile,
    goals: saveGoals,
    work: saveWork,
    google: saveGoogle,
    sync: saveSync,
    'auth-login': authLogin,
    'auth-setup': authSetup,
    'auth-recover': authRecover,
    'auth-user-add': authUserAdd,
    'auth-user-name': authUserName,
    'auth-user-pass': authUserPass,
    'auth-self-pass': authSelfPass,
  };

  function run(name, el, event) {
    const fn = ACTIONS[name];
    if (!fn) return false;
    fn(el, event);
    return true;
  }

  function submit(name, form, event) {
    const fn = SUBMITS[name];
    if (!fn) return false;
    fn(form, event);
    return true;
  }

  SK.actions = {
    run: run,
    submit: submit,
    openEntryEditor: openEntryEditor,
    openProjectEditor: openProjectEditor,
    buildCsv: buildCsv,
    parseCsv: parseCsv,
    applyCsvImport: applyCsvImport,
    prefillAddForm: prefillAddForm,
  };
})(typeof window !== 'undefined' ? window : globalThis);

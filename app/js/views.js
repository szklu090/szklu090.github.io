/* ============================================================
   stol-kos — views.js
   Renderowanie widoków. Czyste funkcje: (stan) -> HTML.
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const C = SK.compute;
  const U = SK.ui;
  const S = SK.store;
  const icon = U.icon;
  const esc = C.escapeHtml;

  const now0 = new Date();
  const START_OF_TODAY = C.dateKey(now0);

  /* Opcjonalny miesiąc z adresu (?month=RRRR-MM) — np. do udostępniania widoku. */
  const URL_MONTH = (function () {
    try {
      if (typeof location === 'undefined' || !location.search) return '';
      const m = new URLSearchParams(location.search).get('month') || '';
      return /^\d{4}-\d{2}$/.test(m) ? m : '';
    } catch (e) { return ''; }
  })();

  /* Stan filtrów widoków (mutowany przez akcje, nie jest zapisywany). */
  SK.viewState = {
    entries: { mode: 'month', month: START_OF_TODAY.slice(0, 7), week: START_OF_TODAY, from: '', to: '', projectId: '', query: '' },
    stats: { scope: 'month', month: START_OF_TODAY.slice(0, 7), year: String(now0.getFullYear()) },
    settlements: { month: START_OF_TODAY.slice(0, 7) },
    calendar: { month: URL_MONTH || START_OF_TODAY.slice(0, 7) },
    add: { date: null },
  };

  const cur = () => S.get().profile.currency;
  const money = (v) => C.money(v, cur());

  /* ============================================================
     Komponenty pomocnicze
     ============================================================ */
  function card(title, ico, body, opts) {
    const o = opts || {};
    return '<div class="card' + (o.cls ? ' ' + o.cls : '') + '">' +
      (title
        ? '<div class="card-title">' + (ico ? icon(ico) : '') + '<span>' + esc(title) + '</span>' +
          (o.right ? '<span class="row" style="margin-left:auto;gap:8px">' + o.right + '</span>' : '') + '</div>'
        : '') +
      body + '</div>';
  }

  function kpi(label, value, sub, ico, cls) {
    return '<div class="card kpi' + (cls ? ' ' + cls : '') + '">' +
      (ico ? '<div class="kpi-ico">' + icon(ico) + '</div>' : '') +
      '<div class="kpi-label">' + (ico ? icon(ico) : '') + '<span>' + esc(label) + '</span></div>' +
      '<div class="kpi-value">' + value + '</div>' +
      (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') +
      '</div>';
  }

  function seg(action, items, active) {
    return '<div class="seg">' + items.map(function (it) {
      return '<button data-action="' + action + '" data-value="' + esc(it.value) + '"' +
        (it.value === active ? ' class="active"' : '') + '>' + esc(it.label) + '</button>';
    }).join('') + '</div>';
  }

  function barChart(items, opts) {
    const o = opts || {};
    const max = Math.max(1, Math.max.apply(null, items.map(function (i) { return i.value || 0; })));
    return '<div class="bars' + (o.tall ? ' bars-year' : '') + '">' + items.map(function (it) {
      const h = Math.round(((it.value || 0) / max) * 100);
      return '<div class="bar-wrap' + (it.today ? ' today' : '') + '">' +
        '<div class="bar-val">' + (it.sub || '') + '</div>' +
        '<div class="bar-track"><div class="bar' + (it.value > 0 ? '' : ' zero') + '" style="height:' + h + '%"></div></div>' +
        '<div class="bar-label">' + esc(it.label || '') + '</div>' +
        '</div>';
    }).join('') + '</div>';
  }

  function ring(pct, big, small) {
    const r = 40, c = 2 * Math.PI * r;
    const p = C.clamp(pct, 0, 100);
    const off = c * (1 - p / 100);
    return '<div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle class="track" cx="50" cy="50" r="' + r + '" fill="none" stroke-width="9" />' +
      '<circle class="bar" cx="50" cy="50" r="' + r + '" fill="none" stroke-width="9" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" />' +
      '</svg><div class="ring-mid"><div><strong>' + big + '</strong><br><span>' + esc(small) + '</span></div></div></div>';
  }

  function donut(segments, centerBig, centerSmall) {
    const list = (segments || []).filter(function (s) { return s.value > 0; });
    const total = list.reduce(function (a, s) { return a + s.value; }, 0);
    let acc = 0;
    const stops = list.map(function (s) {
      const a = (acc / total) * 360; acc += s.value;
      const b = (acc / total) * 360;
      return s.color + ' ' + a.toFixed(1) + 'deg ' + b.toFixed(1) + 'deg';
    });
    const bg = stops.length ? 'conic-gradient(' + stops.join(',') + ')' : 'var(--border)';
    return '<div class="donut" style="background:' + bg + '">' +
      '<div class="donut-mid"><div><strong>' + centerBig + '</strong><br><span>' + esc(centerSmall) + '</span></div></div></div>';
  }

  function heatmap(entries, weeks) {
    const map = {};
    (entries || []).forEach(function (e) { map[e.date] = (map[e.date] || 0) + C.durationMin(e); });
    const today = C.startOfDay(new Date());
    const end = C.startOfWeek(today, true);
    const start = C.addDays(end, -((weeks || 26) - 1) * 7);
    const cells = [];
    for (let w = 0; w < (weeks || 26); w++) {
      for (let d = 0; d < 7; d++) {
        const day = C.addDays(start, w * 7 + d);
        const key = C.dateKey(day);
        const v = map[key] || 0;
        let lvl = 0;
        if (v >= 540) lvl = 4; else if (v >= 420) lvl = 3; else if (v >= 240) lvl = 2; else if (v > 0) lvl = 1;
        const future = day.getTime() > today.getTime();
        cells.push('<div class="cell' + (future ? '' : ' l' + lvl) + '" title="' + key + ' · ' + C.fmtMinLong(v) + '"></div>');
      }
    }
    return '<div class="heat">' + cells.join('') + '</div>';
  }

  function empty(ico, title, text, actionHtml) {
    return '<div class="empty"><div class="ico">' + icon(ico) + '</div><h4>' + esc(title) + '</h4>' +
      '<p>' + esc(text || '') + '</p>' + (actionHtml || '') + '</div>';
  }

  function projectOptions(selected, allowNone) {
    const st = S.get();
    let out = allowNone ? '<option value="">— brak —</option>' : '';
    st.projects.filter(function (p) { return !p.archived; }).forEach(function (p) {
      out += '<option value="' + p.id + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    });
    return out;
  }
  function projectDot(projectId) {
    const p = projectId ? S.projectById(projectId) : null;
    return p ? '<span class="dot" style="background:' + p.color + '"></span>' : '';
  }
  function projectName(projectId) {
    const p = projectId ? S.projectById(projectId) : null;
    return p ? p.name : 'Bez projektu';
  }
  function multBadge(entry) {
    const st = S.get();
    const m = C.multiplierFor(entry, st.settings);
    if (m <= 1) return '';
    const night = C.overlapsNight(entry, st.settings) && Number(st.settings.nightMultiplier) > 1;
    const weekend = C.isWeekend(entry.date);
    const why = night && weekend ? 'noc + weekend' : night ? 'noc' : 'weekend';
    return '<span class="badge info">×' + m + ' ' + why + '</span>';
  }
  function otBadge(entry) {
    const ot = C.overtimeMin(entry, S.get().settings);
    if (ot <= 0) return '';
    const m = Math.max(1, Number(S.get().settings.otMultiplier) || 1);
    return '<span class="badge warn">+' + C.fmtHM(ot) + ' nadgodzin ×' + m + '</span>';
  }

  function gcalBadge(entry) {
    if (!entry || !entry.gcalEventId) return '';
    return '<span class="badge gcal" title="Wydarzenie w Kalendarzu Google">' + icon('calendar-check') + ' GCal</span>';
  }

  /* ============================================================
     Meta stron
     ============================================================ */
  const META = {
    dashboard: { title: 'Pulpit', sub: 'Przegląd Twojej pracy' },
    entries: { title: 'Wpisy', sub: 'Ewidencja czasu pracy' },
    calendar: { title: 'Kalendarz', sub: 'Miesiąc w jednym rzucie oka' },
    add: { title: 'Dodaj wpis', sub: 'Ręcznie lub stoperm' },
    stats: { title: 'Statystyki', sub: 'Analiza czasu i zarobków' },
    settlements: { title: 'Rozliczenia', sub: 'Miesięczne podsumowania projektów' },
    projects: { title: 'Projekty', sub: 'Zarządzaj projektami i stawkami' },
    settings: { title: 'Ustawienia', sub: 'Profil, cele i dane' },
  };

  /* ============================================================
     PULPIT
     ============================================================ */
  function timerCard() {
    const st = S.get();
    const t = st.timer;
    if (t) {
      const started = new Date(t.start);
      return card('Stoper', 'timer', '<div class="row wrap between">' +
        '<div><div class="timer-live"><span class="pulse"></span> Nagrywanie</div>' +
        '<div class="timer-big mono" id="timer-big">0:00:00</div>' +
        '<div class="muted" style="font-size:.78rem">Start ' + C.pad2(started.getHours()) + ':' + C.pad2(started.getMinutes()) +
        ' · ' + esc(t.note || 'Stoper') + (t.projectId ? ' · ' + esc(projectName(t.projectId)) : '') + '</div></div>' +
        '<div class="stack">' +
        '<button class="btn btn-danger" data-action="timer:stop">' + icon('square') + ' Zatrzymaj i zapisz</button>' +
        '<button class="btn btn-ghost btn-sm" data-action="timer:discard">' + icon('trash-2') + ' Odrzuć</button>' +
        '</div></div>');
    }
    return card('Stoper', 'timer', '<form data-form="timer" class="stack">' +
      '<div class="form-grid">' +
      '<div class="field"><label>Projekt</label><select class="select" name="projectId">' + projectOptions(null, false) + '</select></div>' +
      '<div class="field"><label>Opis</label><input class="input" name="note" placeholder="np. Montaż" /></div>' +
      '</div><button class="btn btn-primary btn-block" type="submit">' + icon('play') + ' Start</button></form>');
  }

  function goalCard(monthMin, monthAmt) {
    const st = S.get();
    const todayKey = C.dateKey(new Date());
    const todayAmt = C.sumAmount(st.entries.filter(function (e) { return e.date === todayKey; }), S.rateOf, st.settings);
    const mPct = C.percent(monthAmt, st.profile.goalMonthly);
    const rings = [];
    if (st.profile.goalDaily > 0) {
      const dPct = C.percent(todayAmt, st.profile.goalDaily);
      rings.push(ring(dPct, Math.round(dPct) + '%', 'dziś'));
    }
    if (st.profile.goalMonthly > 0) rings.push(ring(mPct, Math.round(mPct) + '%', 'miesiąc'));
    if (st.profile.goalWeekly > 0) {
      const ws = C.startOfWeek(new Date(), st.profile.weekStartsMonday);
      const weekAmt = C.sumAmount(C.filterRange(st.entries, ws, C.addDays(ws, 6)), S.rateOf, st.settings);
      rings.push(ring(C.percent(weekAmt, st.profile.goalWeekly), Math.round(C.percent(weekAmt, st.profile.goalWeekly)) + '%', 'tydzień'));
    }
    if (!rings.length) {
      return card('Cele', 'target', '<p class="muted" style="margin:0 0 12px;font-size:.85rem">Nie ustawiono celów finansowych.</p>' +
        '<button class="btn btn-sm" data-page="settings">' + icon('settings-2') + ' Ustaw cele</button>');
    }
    let foot;
    if (st.profile.goalMonthly > 0) {
      const left = st.profile.goalMonthly - monthAmt;
      foot = left > 0
        ? '<div class="kpi-sub mt-sm">Do celu miesiąca brakuje <b class="accent">' + money(left) + '</b> · ' + esc(C.fmtMinLong(monthMin)) + '</div>'
        : '<div class="kpi-sub mt-sm"><span class="badge ok">' + icon('check') + ' Cel miesiąca osiągnięty</span></div>';
    }
    return card('Cele', 'target', '<div class="ring-row">' + rings.join('') + '</div>' + (foot || ''));
  }

  /* Baner przypomnienia o zamkniętym miesiącu (Google Skoroszyt). */
  function reminderBanner() {
    const G = SK.google;
    if (!G || typeof G.dueMonths !== 'function') return '';
    let due = [];
    try { due = G.dueMonths(); } catch (e) { return ''; }
    if (!due.length) return '';
    const m = due[due.length - 1];
    const ready = G.status().ready;
    return '<div class="reminder">' + icon('bell-ring') +
      '<div class="rm-text"><b>Rozlicz ' + esc(m.label) + '</b>' +
      '<span>Masz ' + C.fmtHours(m.minutes) + ' h w ' + esc(m.label) + '. Wyślij godziny do Skoroszytu Google.</span></div>' +
      '<div class="rm-actions">' +
      '<button class="btn btn-ghost btn-sm" data-action="sk:open-month" data-month="' + m.key + '">Szczegóły</button>' +
      (ready
        ? '<button class="btn btn-primary btn-sm" data-action="sheets:send" data-month="' + m.key + '">' + icon('send') + ' Wyślij</button>'
        : '<button class="btn btn-primary btn-sm" data-page="settings">' + icon('settings-2') + ' Skonfiguruj</button>') +
      '</div></div>';
  }

  function dashboard() {
    const st = S.get();
    const entries = st.entries;
    const now = new Date();
    const todayKey = C.dateKey(now);
    const ws = C.startOfWeek(now, st.profile.weekStartsMonday);
    const wFrom = C.dateKey(ws), wTo = C.dateKey(C.addDays(ws, 6));
    const mFrom = C.dateKey(C.startOfMonth(now)), mTo = C.dateKey(C.endOfMonth(now));

    const todayMin = C.totalMin(entries.filter(function (e) { return e.date === todayKey; }));
    const weekMin = C.totalMin(entries.filter(function (e) { return e.date >= wFrom && e.date <= wTo; }));
    const monthEntries = entries.filter(function (e) { return e.date >= mFrom && e.date <= mTo; });
    const monthMin = C.totalMin(monthEntries);
    const monthAmt = C.sumAmount(monthEntries, S.rateOf, st.settings);
    const weekAmt = C.sumAmount(entries.filter(function (e) { return e.date >= wFrom && e.date <= wTo; }), S.rateOf, st.settings);
    const todayAmt = C.sumAmount(entries.filter(function (e) { return e.date === todayKey; }), S.rateOf, st.settings);
    const streak = C.currentStreak(entries);

    let html = reminderBanner() + '<div class="grid g-4">' +
      kpi('Dzisiaj', C.fmtHM(todayMin), money(todayAmt) + ' · ' + C.fmtHours(todayMin) + ' h', 'sun', 'up') +
      kpi('Ten tydzień', C.fmtHM(weekMin), money(weekAmt), 'calendar-days') +
      kpi('Ten miesiąc', C.fmtHM(monthMin), money(monthAmt), 'calendar-range') +
      kpi('Seria', streak + ' dni', entries.length + ' wpisów łącznie', 'flame') +
      '</div>';

    html += '<div class="grid g-2 mt">' + timerCard() + goalCard(monthMin, monthAmt) + '</div>';

    // 7 ostatnich dni
    const bars = [];
    for (let i = 6; i >= 0; i--) {
      const d = C.addDays(now, -i);
      const k = C.dateKey(d);
      const m = C.totalMin(entries.filter(function (e) { return e.date === k; }));
      bars.push({ label: C.dayShort(d), value: m, sub: m ? C.fmtHours(m) : '', today: k === todayKey });
    }

    // projekty w miesiącu
    const pj = C.byProject(monthEntries, S.rateOf, st.settings).slice(0, 6);
    const palette = ['#84cc16', '#22d3ee', '#a78bfa', '#f59e0b', '#f43f5e', '#3b82f6'];
    const donutSeg = pj.map(function (p, i) {
      return { value: p.min, color: p.projectId ? (S.projectById(p.projectId) || {}).color || palette[i % palette.length] : '#64748b' };
    });
    const legend = pj.length
      ? '<div class="legend">' + pj.map(function (p, i) {
          const color = p.projectId ? (S.projectById(p.projectId) || {}).color || palette[i % palette.length] : '#64748b';
          return '<div class="li"><span class="dot" style="background:' + color + '"></span><span style="flex:1" class="truncate">' + esc(projectName(p.projectId)) + '</span><b>' + C.fmtHM(p.min) + '</b></div>';
        }).join('') + '</div>'
      : '<p class="muted" style="font-size:.84rem">Brak wpisów w tym miesiącu.</p>';

    html += '<div class="grid g-2 mt">' +
      card('Ostatnie 7 dni', 'bar-chart-3', barChart(bars)) +
      card('Projekty (miesiąc)', 'pie-chart', '<div class="donut-wrap">' + donut(donutSeg, C.fmtHM(monthMin), 'łącznie') + legend + '</div>') +
      '</div>';

    // ostatnie wpisy
    const recent = entries.slice().sort(function (a, b) { return (b.date + b.start).localeCompare(a.date + a.start); }).slice(0, 8);
    const recBody = recent.length
      ? recent.map(function (e) {
          return '<div class="rec">' + projectDot(e.projectId) +
            '<span class="r-time nowrap">' + C.shortDate(C.parseDateKey(e.date)) + ' ' + esc(e.start) + '–' + esc(e.end) + '</span>' +
            '<span class="r-note">' + esc(e.note || projectName(e.projectId)) + '</span>' +
            '<span class="r-amt mono">' + money(S.amountOf(e)) + '</span></div>';
        }).join('')
      : empty('inbox', 'Brak wpisów', 'Zacznij od dodania pierwszego wpisu.',
          '<button class="btn btn-primary btn-sm" data-page="add">' + icon('plus') + ' Dodaj wpis</button>');

    html += '<div class="grid mt">' + card('Ostatnie wpisy', 'history', recBody,
      { right: '<button class="btn btn-ghost btn-sm" data-page="entries">Wszystkie ' + icon('arrow-right') + '</button>' }) + '</div>';

    return html;
  }

  /* ============================================================
     WPISY
     ============================================================ */
  function entriesFiltered() {
    const f = SK.viewState.entries;
    let list = S.get().entries.slice();
    if (f.mode === 'month' && f.month) {
      list = list.filter(function (e) { return e.date.slice(0, 7) === f.month; });
    } else if (f.mode === 'week' && f.week) {
      const s = C.dateKey(C.startOfWeek(C.parseDateKey(f.week), true));
      const e2 = C.dateKey(C.addDays(C.parseDateKey(s), 6));
      list = list.filter(function (e) { return e.date >= s && e.date <= e2; });
    } else if (f.mode === 'range') {
      if (f.from) list = list.filter(function (e) { return e.date >= f.from; });
      if (f.to) list = list.filter(function (e) { return e.date <= f.to; });
    }
    if (f.projectId) list = list.filter(function (e) { return (e.projectId || '') === f.projectId; });
    if (f.query) {
      const q = f.query.toLowerCase();
      list = list.filter(function (e) {
        return ((e.note || '') + ' ' + projectName(e.projectId) + ' ' + e.date).toLowerCase().indexOf(q) >= 0;
      });
    }
    return list;
  }

  function entryFields(e) {
    e = e || {};
    const st = S.get();
    const today = C.dateKey(new Date());
    return '<div class="form-grid">' +
      '<div class="field"><label>Data</label><input class="input" type="date" name="date" value="' + esc(e.date || today) + '" required /></div>' +
      '<div class="field"><label>Przerwa (min)</label><input class="input" type="number" name="breakMin" min="0" step="5" value="' + (e.breakMin == null ? st.settings.autoBreak : e.breakMin) + '" /></div>' +
      '<div class="field"><label>Od</label><input class="input" type="time" name="start" value="' + esc(e.start || '') + '" required /></div>' +
      '<div class="field"><label>Do</label><input class="input" type="time" name="end" value="' + esc(e.end || '') + '" required /></div>' +
      '<div class="field"><label>Projekt</label><select class="select" name="projectId">' + projectOptions(e.projectId, true) + '</select></div>' +
      '<div class="field"><label>Stawka własna (' + C.symbol(st.profile.currency) + ')</label><input class="input" type="number" name="rate" min="0" step="0.5" placeholder="' + st.profile.rate + '" value="' + (e.rate == null ? '' : e.rate) + '" /></div>' +
      '<div class="field full"><label>Notatka</label><input class="input" name="note" value="' + esc(e.note || '') + '" placeholder="np. Prace montażowe" /></div>' +
      '</div>';
  }

  function entryRow(e) {
    const amt = S.amountOf(e);
    return '<div class="entry">' +
      '<div class="time nowrap"><b>' + esc(e.start) + '</b> — ' + esc(e.end) + '</div>' +
      '<div style="min-width:0">' +
      '<div class="note">' + projectDot(e.projectId) + '<span class="truncate">' + esc(e.note || projectName(e.projectId)) + '</span></div>' +
      '<div class="meta"><span class="tag">' + projectDot(e.projectId) + esc(projectName(e.projectId)) + '</span>' +
      '<span>' + C.fmtMinLong(C.durationMin(e)) + '</span>' +
      (e.breakMin > 0 ? '<span>przerwa ' + e.breakMin + ' min</span>' : '') +
      '<span>' + money(S.rateOf(e)) + '/h</span>' + otBadge(e) + multBadge(e) + gcalBadge(e) + '</div>' +
      '</div>' +
      '<div class="amount mono">' + money(amt) + '</div>' +
      '<div class="tools">' +
      '<button class="btn btn-icon btn-ghost btn-sm" data-action="entry:edit" data-id="' + e.id + '" title="Edytuj">' + icon('pencil') + '</button>' +
      '<button class="btn btn-icon btn-ghost btn-sm" data-action="entry:duplicate" data-id="' + e.id + '" title="Duplikuj">' + icon('copy') + '</button>' +
      '<button class="btn btn-icon btn-ghost btn-sm" data-action="entry:delete" data-id="' + e.id + '" title="Usuń">' + icon('trash-2') + '</button>' +
      '</div></div>';
  }

  function entries() {
    const f = SK.viewState.entries;
    const list = entriesFiltered();
    const totalM = C.totalMin(list);
    const totalA = C.sumAmount(list, S.rateOf, S.get().settings);

    let controls = '<div class="card">' +
      '<div class="row wrap between">' +
      seg('entries:mode', [
        { value: 'month', label: 'Miesiąc' },
        { value: 'week', label: 'Tydzień' },
        { value: 'range', label: 'Zakres' },
        { value: 'all', label: 'Wszystkie' },
      ], f.mode) +
      '</div><div class="row wrap mt-sm">';

    if (f.mode === 'month') controls += '<input class="input" style="max-width:180px" type="month" data-filter="entries.month" value="' + esc(f.month) + '" />';
    if (f.mode === 'week') controls += '<input class="input" style="max-width:180px" type="date" data-filter="entries.week" value="' + esc(f.week) + '" />';
    if (f.mode === 'range') controls += '<input class="input" style="max-width:160px" type="date" data-filter="entries.from" value="' + esc(f.from) + '" />' +
      '<span class="dim">do</span><input class="input" style="max-width:160px" type="date" data-filter="entries.to" value="' + esc(f.to) + '" />';

    controls += '<select class="select" style="max-width:220px" data-filter="entries.projectId">' +
      '<option value="">Wszystkie projekty</option>' +
      S.get().projects.map(function (p) { return '<option value="' + p.id + '"' + (f.projectId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') +
      '</select>' +
      '<input class="input" id="entries-search" style="flex:1;min-width:160px" data-filter="entries.query" data-live="1" value="' + esc(f.query) + '" placeholder="Szukaj w notatkach..." />' +
      '<button class="btn btn-sm" data-action="entries:csv">' + icon('file-spreadsheet') + ' CSV</button>' +
      '<button class="btn btn-primary" data-page="add">' + icon('plus') + ' Nowy</button>' +
      '</div></div>';

    let body;
    if (!list.length) {
      body = '<div class="grid mt">' + card('', null, empty('search-x', 'Brak wyników', 'Zmień filtry lub dodaj nowy wpis.',
        '<button class="btn btn-primary btn-sm" data-page="add">' + icon('plus') + ' Dodaj wpis</button>')) + '</div>';
    } else {
      const groups = {};
      list.forEach(function (e) { (groups[e.date] = groups[e.date] || []).push(e); });
      const dates = Object.keys(groups).sort().reverse();
      body = '<div class="mt">' + dates.map(function (d) {
        const dayEntries = groups[d].sort(function (a, b) { return (a.start || '').localeCompare(b.start || ''); });
        const dm = C.totalMin(dayEntries);
        const da = C.sumAmount(dayEntries, S.rateOf, S.get().settings);
        return '<div class="day-head">' +
          '<span class="d">' + esc(C.dayName(C.parseDateKey(d))) + '</span>' +
          '<span class="w">' + esc(C.fullDate(C.parseDateKey(d))) + ' · tydz. ' + C.weekNumber(C.parseDateKey(d)) + '</span>' +
          '<span class="tot"><span>' + C.fmtHM(dm) + '</span><span>' + money(da) + '</span></span>' +
          '</div>' + dayEntries.map(entryRow).join('');
      }).join('') + '</div>';
    }

    const foot = '<div class="grid mt">' + card('', null, '<div class="row wrap between">' +
      '<span class="muted">' + list.length + ' wpisów · ' + C.fmtMinLong(totalM) + ' (' + C.fmtHours(totalM) + ' h)</span>' +
      '<b class="accent" style="font-size:1.05rem">' + money(totalA) + '</b></div>') + '</div>';

    return controls + body + foot;
  }

  /* ============================================================
     KALENDARZ
     ============================================================ */
  function calLevel(min) {
    if (min >= 540) return 4;
    if (min >= 420) return 3;
    if (min >= 240) return 2;
    if (min > 0) return 1;
    return 0;
  }

  function calendar() {
    const st = S.get();
    const monthKey = SK.viewState.calendar.month || START_OF_TODAY.slice(0, 7);
    const d0 = C.parseDateKey(monthKey + '-01');
    const y = d0.getFullYear(), m = d0.getMonth();
    const mondayFirst = st.profile.weekStartsMonday !== false;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const firstDow = new Date(y, m, 1).getDay();
    const pad = mondayFirst ? (firstDow + 6) % 7 : firstDow;
    const cells = Math.ceil((pad + daysInMonth) / 7) * 7;

    const byDate = {};
    st.entries.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });

    const monthKeyFrom = C.dateKey(new Date(y, m, 1));
    const monthKeyTo = C.dateKey(new Date(y, m + 1, 0));
    const monthEntries = st.entries.filter(function (e) { return e.date >= monthKeyFrom && e.date <= monthKeyTo; });
    const monthMin = C.totalMin(monthEntries);
    const monthAmt = C.sumAmount(monthEntries, S.rateOf, st.settings);
    const workDays = new Set(monthEntries.map(function (e) { return e.date; })).size;

    const weekLabels = mondayFirst ? ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'] : ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];

    const head = '<div class="card"><div class="row wrap between">' +
      '<div class="row wrap cal-nav">' +
      '<button class="btn btn-icon btn-ghost btn-sm" data-action="cal:prev" title="Poprzedni miesiąc" aria-label="Poprzedni miesiąc">' + icon('chevron-left') + '</button>' +
      '<b class="cal-month">' + esc(C.monthName(m) + ' ' + y) + '</b>' +
      '<button class="btn btn-icon btn-ghost btn-sm" data-action="cal:next" title="Następny miesiąc" aria-label="Następny miesiąc">' + icon('chevron-right') + '</button>' +
      '<button class="btn btn-sm" data-action="cal:today">' + icon('calendar-check') + ' Dziś</button>' +
      '</div>' +
      '<div class="row wrap">' +
      '<input class="input" style="width:190px;max-width:190px;flex:0 0 190px" type="month" data-filter="calendar.month" value="' + esc(monthKey) + '" />' +
      '<button class="btn btn-primary btn-sm" data-page="add">' + icon('plus') + ' Nowy wpis</button>' +
      '</div></div></div>';

    let grid = '<div class="cal-grid cal-head">' +
      weekLabels.map(function (l) { return '<div class="cal-dow">' + l + '</div>'; }).join('') + '</div>' +
      '<div class="cal-grid">';

    for (let i = 0; i < cells; i++) {
      const dayNum = i - pad + 1;
      if (dayNum < 1 || dayNum > daysInMonth) { grid += '<div class="cal-cell blank"></div>'; continue; }
      const date = new Date(y, m, dayNum);
      const key = C.dateKey(date);
      const list = byDate[key] || [];
      const min = C.totalMin(list);
      const amt = C.sumAmount(list, S.rateOf, st.settings);
      const lvl = calLevel(min);
      const isToday = key === START_OF_TODAY;
      const dots = list.slice(0, 3).map(function (e) {
        const p = e.projectId ? S.projectById(e.projectId) : null;
        return '<i style="background:' + (p ? p.color : '#64748b') + '"></i>';
      }).join('');
      grid += '<button type="button" class="cal-cell l' + lvl + (isToday ? ' today' : '') + (list.length ? '' : ' no-work') +
        '" data-action="cal:day" data-date="' + key + '" aria-label="' + esc(C.fullDate(date) + ', ' + C.fmtMinLong(min)) + '">' +
        '<span class="cal-top"><span class="cal-num">' + dayNum + '</span>' +
        (min ? '<span class="cal-h">' + C.fmtHM(min) + '</span>' : '') + '</span>' +
        '<span class="cal-dots">' + dots + '</span>' +
        (min ? '<span class="cal-amt">' + money(amt) + '</span>' : '<span class="cal-amt dim">—</span>') +
        '</button>';
    }
    grid += '</div>';

    const body = '<div class="grid g-2 mt">' + card('Kalendarz', 'calendar-days', grid) +
      card('Podsumowanie', 'chart-pie', '<div class="grid g-2">' +
        kpi('Godziny', C.fmtHM(monthMin), C.fmtHours(monthMin) + ' h', 'clock') +
        kpi('Zarobek', money(monthAmt), 'w tym miesiącu', 'banknote', 'up') +
        kpi('Dni z pracą', String(workDays), 'na ' + daysInMonth + ' dni', 'calendar-check') +
        kpi('Średnio / dzień', C.fmtHM(workDays ? monthMin / workDays : 0), 'w dniach pracy', 'activity') +
        '</div>' +
        '<div class="heat-legend mt-sm"><span>mniej</span><span class="cell" style="width:12px;height:12px"></span>' +
        '<span class="cell l1" style="width:12px;height:12px"></span><span class="cell l2" style="width:12px;height:12px"></span>' +
        '<span class="cell l3" style="width:12px;height:12px"></span><span class="cell l4" style="width:12px;height:12px"></span><span>więcej</span></div>') +
      '</div>';

    return head + body;
  }

  /* ============================================================
     DODAJ
     ============================================================ */
  function add() {
    const st = S.get();
    const presetDate = SK.viewState.add && SK.viewState.add.date;
    if (SK.viewState.add) SK.viewState.add.date = null;
    const presets = [
      { label: '8–16', from: '08:00', to: '16:00' },
      { label: '7–15', from: '07:00', to: '15:00' },
      { label: 'Noc 22–06', from: '22:00', to: '06:00' },
      { label: '6h 9–15', from: '09:00', to: '15:00' },
    ];
    const tplList = st.templates || [];
    const tplChips = tplList.length
      ? tplList.map(function (t) {
          return '<span class="chip"><button type="button" class="chip-main" data-action="add:template" data-id="' + t.id + '" title="Wstaw szablon">' +
            icon('bookmark') + esc(t.name) + '</button>' +
            '<button type="button" class="chip-x" data-action="tpl:delete" data-id="' + t.id + '" title="Usuń szablon" aria-label="Usuń szablon">' + icon('x') + '</button></span>';
        }).join('')
      : '<span class="hint">brak — zapisz bieżący wpis jako szablon</span>';

    return '<div class="grid g-2">' +
      card('Nowy wpis', 'plus-circle', '<form data-form="add">' +
        entryFields(presetDate ? { date: presetDate } : {}) +
        '<div class="row wrap mt-sm">' + presets.map(function (p) {
          return '<button type="button" class="btn btn-sm" data-action="add:preset" data-from="' + p.from + '" data-to="' + p.to + '">' + esc(p.label) + '</button>';
        }).join('') + '</div>' +
        '<div class="row wrap mt-sm" style="align-items:center;gap:6px"><span class="dim" style="font-size:.72rem">Szablony:</span>' + tplChips + '</div>' +
        '<div class="card mt" style="background:var(--panel-2);box-shadow:none" id="add-preview"></div>' +
        '<div class="row wrap mt" style="justify-content:space-between;gap:8px">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="add:save-template">' + icon('bookmark-plus') + ' Zapisz jako szablon</button>' +
        '<div class="row"><button type="reset" class="btn btn-ghost">' + icon('rotate-ccw') + ' Wyczyść</button>' +
        '<button type="submit" class="btn btn-primary">' + icon('save') + ' Zapisz wpis</button></div>' +
        '</div></form>') +
      '<div class="stack">' + timerCard() +
      card('Wskazówki', 'lightbulb', '<ul class="muted" style="font-size:.84rem;line-height:1.7;padding-left:18px;margin:0">' +
        '<li>Praca nocna: wpisz <b>22:00</b> → <b>06:00</b> — system policzy przez północ.</li>' +
        '<li>Przerwa odejmowana jest od czasu netto.</li>' +
        '<li>Stawka własna nadpisuje stawkę projektu i profilu.</li>' +
        '<li>Weekend, noc i nadgodziny mnożą stawkę (Ustawienia → Praca).</li>' +
        '<li>Stoper zapisuje wpis automatycznie po zatrzymaniu.</li>' +
        '</ul>') + '</div></div>';
  }

  function updateAddPreview() {
    const el = root.document.getElementById('add-preview');
    if (!el) return;
    const form = root.document.querySelector('form[data-form="add"]');
    if (!form) return;
    const f = U.formToObject(form);
    const dur = C.durationMin({ start: f.start, end: f.end, breakMin: f.breakMin });
    const st = S.get();
    let rate = st.profile.rate;
    if (f.rate) rate = Number(f.rate);
    else if (f.projectId) { const p = S.projectById(f.projectId); if (p && p.rate != null) rate = p.rate; }
    const preview = { start: f.start, end: f.end, breakMin: f.breakMin, date: f.date || C.dateKey(new Date()), projectId: f.projectId || null };
    const mult = C.multiplierFor(preview, st.settings);
    const amount = C.amountFor(preview, rate, st.settings);
    const billable = C.billableMin(preview, st.settings);
    const ot = C.overtimeMin(preview, st.settings);
    const night = f.start && f.end && f.start > f.end;
    el.innerHTML = '<div class="row wrap between">' +
      '<div><div class="kpi-label">' + icon('hourglass') + '<span>Czas netto</span></div>' +
      '<div class="kpi-value mono">' + C.fmtHM(dur) + '</div></div>' +
      '<div><div class="kpi-label">' + icon('banknote') + '<span>Kwota</span></div>' +
      '<div class="kpi-value accent mono">' + money(amount) + '</div></div>' +
      '<div><div class="kpi-label">' + icon('percent') + '<span>Stawka</span></div>' +
      '<div class="kpi-value mono">' + money(rate) + '<span class="muted" style="font-size:.6em">/h</span></div></div>' +
      '</div>' +
      (night ? '<div class="hint mt-sm">' + icon('moon') + ' Zmiana przez północ — koniec liczony następnego dnia.</div>' : '') +
      (billable !== dur ? '<div class="hint mt-sm">' + icon('timer-reset') + ' Rozliczany czas po zaokrągleniu: ' + C.fmtHM(billable) + '.</div>' : '') +
      (ot > 0 ? '<div class="hint mt-sm">' + icon('trending-up') + ' Nadgodziny: ' + C.fmtMinLong(ot) + ' × ' + Math.max(1, Number(st.settings.otMultiplier) || 1) + '.</div>' : '') +
      (mult > 1 ? '<div class="hint mt-sm">' + icon('sparkles') + ' Mnożnik ' + mult + '× (weekend / noc).</div>' : '');
    U.refresh();
  }

  /* ============================================================
     STATYSTYKI
     ============================================================ */
  function statsRange() {
    const f = SK.viewState.stats;
    const st = S.get();
    if (f.scope === 'month') {
      const d = C.parseDateKey(f.month + '-01');
      return { from: C.startOfMonth(d), to: C.endOfMonth(d), label: C.monthName(d.getMonth()) + ' ' + d.getFullYear() };
    }
    if (f.scope === 'year') {
      const y = Number(f.year) || new Date().getFullYear();
      return { from: new Date(y, 0, 1), to: new Date(y, 11, 31), label: 'Rok ' + y };
    }
    // all
    const list = st.entries;
    if (!list.length) return { from: new Date(), to: new Date(), label: 'Całość' };
    let min = list[0].date, max = list[0].date;
    list.forEach(function (e) { if (e.date < min) min = e.date; if (e.date > max) max = e.date; });
    return { from: C.parseDateKey(min), to: C.parseDateKey(max), label: 'Całość' };
  }

  function longestStreak(entries) {
    const days = Array.from(new Set(entries.map(function (e) { return e.date; }))).sort();
    let best = 0, run = 0, prev = null;
    days.forEach(function (d) {
      if (prev && C.dateKey(C.addDays(C.parseDateKey(prev), 1)) === d) run++;
      else run = 1;
      if (run > best) best = run;
      prev = d;
    });
    return best;
  }

  function stats() {
    const f = SK.viewState.stats;
    const st = S.get();
    const R = statsRange();
    const list = C.filterRange(st.entries, R.from, R.to);
    const totalM = C.totalMin(list);
    const totalA = C.sumAmount(list, S.rateOf, st.settings);
    const daysSpan = Math.max(1, Math.round((R.to - R.from) / 86400000) + 1);

    let html = '<div class="card"><div class="row wrap between">' +
      seg('stats:scope', [
        { value: 'month', label: 'Miesiąc' },
        { value: 'year', label: 'Rok' },
        { value: 'all', label: 'Całość' },
      ], f.scope) +
      '<div class="row wrap">' +
      (f.scope === 'month' ? '<input class="input" style="max-width:180px" type="month" data-filter="stats.month" value="' + esc(f.month) + '" />' : '') +
      (f.scope === 'year' ? '<input class="input" style="max-width:130px" type="number" min="2000" max="2100" data-filter="stats.year" value="' + esc(f.year) + '" />' : '') +
      '<span class="kbd">' + esc(R.label) + '</span>' +
      '<button class="btn btn-sm" data-action="app:print">' + icon('printer') + ' Drukuj / PDF</button></div>' +
      '</div></div>';

    html += '<div class="grid g-4 mt">' +
      kpi('Godziny', C.fmtHM(totalM), C.fmtHours(totalM) + ' h', 'clock') +
      kpi('Zarobek', money(totalA), 'w wybranym okresie', 'banknote', 'up') +
      kpi('Średnio / dzień', C.fmtHM(totalM / daysSpan), 'przez ' + daysSpan + ' dni', 'activity') +
      kpi('Wpisy', String(list.length), 'średnio ' + money(list.length ? totalA / list.length : 0) + ' / wpis', 'list') +
      '</div>';

    // wykres główny
    let chart;
    if (f.scope === 'month') {
      const d = C.parseDateKey(f.month + '-01');
      const last = C.endOfMonth(d).getDate();
      const items = [];
      for (let i = 1; i <= last; i++) {
        const k = C.dateKey(new Date(d.getFullYear(), d.getMonth(), i));
        const m = C.totalMin(list.filter(function (e) { return e.date === k; }));
        items.push({ label: (i === 1 || i % 5 === 0) ? String(i) : '', value: m, sub: m ? C.fmtHours(m) : '', today: k === START_OF_TODAY });
      }
      chart = barChart(items, { tall: true });
    } else if (f.scope === 'year') {
      const arr = C.byMonthOfYear(list, Number(f.year) || new Date().getFullYear(), S.rateOf, st.settings);
      chart = barChart(arr.map(function (b) { return { label: C.MONTHS_PL[b.month].slice(0, 3), value: b.min, sub: b.min ? C.fmtHours(b.min) : '' }; }), { tall: true });
    } else {
      const byMonth = {};
      list.forEach(function (e) { byMonth[e.date.slice(0, 7)] = (byMonth[e.date.slice(0, 7)] || 0) + C.durationMin(e); });
      const keys = Object.keys(byMonth).sort().slice(-12);
      chart = barChart(keys.map(function (k) { const m = byMonth[k]; return { label: C.monthName(Number(k.slice(5, 7)) - 1).slice(0, 3) + ' ' + k.slice(2, 4), value: m, sub: m ? C.fmtHours(m) : '' }; }), { tall: true });
    }
    html += '<div class="grid g-2 mt">' +
      card('Rozkład czasu', 'bar-chart-3', chart) +
      card('Dni tygodnia', 'calendar-days', barChart(weekdayItems(list, st.profile.weekStartsMonday))) +
      '</div>';

    // projekty
    const pj = C.byProject(list, S.rateOf, st.settings);
    const palette = ['#84cc16', '#22d3ee', '#a78bfa', '#f59e0b', '#f43f5e', '#3b82f6', '#14b8a6'];
    const segs = pj.map(function (p, i) { return { value: p.min, color: p.projectId ? (S.projectById(p.projectId) || {}).color || palette[i % palette.length] : '#64748b' }; });
    const legend = pj.length
      ? '<div class="legend" style="flex:1;min-width:200px">' + pj.map(function (p, i) {
          const color = p.projectId ? (S.projectById(p.projectId) || {}).color || palette[i % palette.length] : '#64748b';
          return '<div class="li"><span class="dot" style="background:' + color + '"></span>' +
            '<span style="flex:1" class="truncate">' + esc(projectName(p.projectId)) + '</span>' +
            '<span class="muted">' + p.count + '×</span><b>' + C.fmtHM(p.min) + '</b><b class="accent">' + money(p.amount) + '</b></div>';
        }).join('') + '</div>'
      : '<p class="muted">Brak danych.</p>';
    html += '<div class="grid g-2 mt">' +
      card('Podział na projekty', 'pie-chart', '<div class="donut-wrap">' + donut(segs, C.fmtHM(totalM), 'łącznie') + legend + '</div>') +
      card('Aktywność', 'flame', activityStats(st, list, R)) +
      '</div>';

    html += '<div class="grid mt">' + card('Mapa aktywności (26 tygodni)', 'calendar-heat', heatmap(st.entries, 26) +
      '<div class="heat-legend mt-sm"><span>mniej</span><span class="cell" style="width:12px;height:12px"></span><span class="cell l1" style="width:12px;height:12px"></span><span class="cell l2" style="width:12px;height:12px"></span><span class="cell l3" style="width:12px;height:12px"></span><span class="cell l4" style="width:12px;height:12px"></span><span>więcej</span></div>') + '</div>';

    return html;
  }

  function weekdayItems(entries, mondayFirst) {
    const v = C.byWeekday(entries);
    const idx = mondayFirst === false ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
    const labels = mondayFirst === false ? ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'] : ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
    return idx.map(function (i, k) { return { label: labels[k], value: v[i], sub: v[i] ? C.fmtHM(v[i]) : '' }; });
  }

  function activityStats(st, list, R) {
    const best = C.bestDay(list, S.rateOf, st.settings);
    const longest = longestStreak(list);
    const cur = C.currentStreak(st.entries);
    const avgEntry = list.length ? C.totalMin(list) / list.length : 0;
    return '<div class="stack">' +
      statLine('flame', 'Aktualna seria', cur + ' dni') +
      statLine('award', 'Najdłuższa seria', longest + ' dni') +
      statLine('trophy', 'Najlepszy dzień', best ? esc(C.fullDate(C.parseDateKey(best.date))) + ' · ' + money(best.amount) : '—') +
      statLine('clock', 'Średnia długość wpisu', C.fmtMinLong(avgEntry)) +
      statLine('calendar', 'Dni z pracą', String(new Set(list.map(function (e) { return e.date; })).size)) +
      '</div>';
  }
  function statLine(ico, label, value) {
    return '<div class="row between" style="padding:10px 0;border-bottom:1px dashed var(--border)">' +
      '<span class="muted row" style="gap:8px">' + icon(ico) + esc(label) + '</span><b>' + value + '</b></div>';
  }

  /* ============================================================
     ROZLICZENIA
     ============================================================ */
  /* Karta wysyłki miesiąca do Skoroszytu Google. */
  function sheetSendCard(month) {
    const st = S.get();
    const G = SK.google;
    const g = (st.settings || {}).google || {};
    const stats = G ? G.monthStats(month, 0) : { hours: 0, label: '' };
    const exp = S.monthExport ? S.monthExport(month) : null;
    const ready = G ? G.status().ready : false;
    const connected = G ? G.status().connected : false;

    let statusHtml;
    if (exp) {
      statusHtml = '<div class="hint">' + icon('check-circle-2') + ' Wysłano ' + esc(C.fullDate(new Date(exp.at))) +
        ' · ' + formatHoursLabel(exp.hours) + ' h' + (exp.url ? ' · <a href="' + esc(exp.url) + '" target="_blank" rel="noopener">otwórz Skoroszyt</a>' : '') + '</div>';
    } else if (!ready) {
      statusHtml = '<div class="hint">Uzupełnij Client ID i Skoroszyt w <b>Ustawieniach</b>, aby wysyłać godziny.</div>';
    } else {
      statusHtml = '<div class="hint">Zakładka miesiąca zostanie utworzona automatycznie, jeśli jej nie ma.</div>';
    }

    return card('Skoroszyt Google', 'file-spreadsheet',
      '<div class="stack">' +
      '<div class="row wrap between">' +
      '<div><b>' + esc(stats.label) + ' ' + (stats.key ? stats.key.slice(0, 4) : '') + '</b>' +
      '<div class="hint">' + formatHoursLabel(stats.hours) + ' h · ' + money(stats.amount) + (stats.entries ? ' · ' + stats.entries + ' wpisów' : '') + '</div></div>' +
      (exp ? '<span class="badge ok">' + icon('check') + ' wysłano</span>' : '<span class="badge">do wysłania</span>') +
      '</div>' +
      '<div class="form-grid">' +
      '<div class="field"><label>Miesiąc</label><input class="input" type="month" data-filter="settlements.month" value="' + esc(month) + '" /></div>' +
      '</div>' +
      '<div class="row wrap">' +
      '<button class="btn btn-primary btn-sm" data-action="sheets:send" data-month="' + esc(month) + '"' + (ready ? '' : ' disabled') + '>' + icon('send') + ' Wyślij do Skoroszytu</button>' +
      (connected ? '<button class="btn btn-sm" data-action="google:test">' + icon('plug-zap') + ' Testuj</button>' : '') +
      '<button class="btn btn-ghost btn-sm" data-action="sheets:open">' + icon('external-link') + ' Otwórz Skoroszyt</button>' +
      '</div>' +
      '<div class="hint">Do arkusza trafiają tylko godziny <b>od</b> i <b>do</b> — ilość godzin i sumy liczy formuła arkusza.</div>' +
      statusHtml +
      '</div>');
  }

  function formatHoursLabel(h) {
    const v = Number(h || 0);
    return v.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function settlements() {
    const st = S.get();
    const month = SK.viewState.settlements.month;
    const d = C.parseDateKey(month + '-01');
    const from = C.startOfMonth(d), to = C.endOfMonth(d);
    const list = C.filterRange(st.entries, from, to);

    const rows = [];
    const projIds = [];
    st.projects.forEach(function (p) {
      const has = list.some(function (e) { return e.projectId === p.id; });
      if (!p.archived || has) projIds.push(p.id);
    });
    if (list.some(function (e) { return !e.projectId; })) projIds.push(null);

    let grandMin = 0, grandAmt = 0, allPaid = true, any = false;
    projIds.forEach(function (pid) {
      const items = list.filter(function (e) { return (e.projectId || null) === pid; });
      if (!items.length) return;
      any = true;
      const m = C.totalMin(items);
      const amt = C.sumAmount(items, S.rateOf, st.settings);
      const rate = items.length ? S.rateOf(items[0]) : st.profile.rate;
      const paid = !!(S.settlement(month, pid) || {}).paid;
      if (!paid) allPaid = false;
      grandMin += m; grandAmt += amt;
      rows.push('<tr>' +
        '<td><span class="row" style="gap:8px">' + projectDot(pid) + esc(projectName(pid)) + '</span></td>' +
        '<td class="num">' + C.fmtHM(m) + '</td>' +
        '<td class="num">' + money(rate) + '</td>' +
        '<td class="num"><b>' + money(amt) + '</b></td>' +
        '<td class="num"><button class="btn btn-sm ' + (paid ? 'btn-primary' : 'btn-ghost') + '" data-action="settle:toggle" data-project="' + (pid || '') + '">' +
        icon(paid ? 'check-circle-2' : 'circle') + (paid ? 'Zapłacone' : 'Oznacz') + '</button></td>' +
        '</tr>');
    });

    const head = '<div class="card"><div class="row wrap between">' +
      '<div class="row wrap"><input class="input" style="max-width:180px" type="month" data-filter="settlements.month" value="' + esc(month) + '" />' +
      '<span class="kbd">' + esc(C.monthName(d.getMonth()) + ' ' + d.getFullYear()) + '</span></div>' +
      '<div class="row wrap">' +
      '<button class="btn btn-sm" data-action="settle:export">' + icon('download') + ' CSV</button>' +
      '<button class="btn btn-sm btn-primary" data-action="settle:all">' + icon('check-check') + ' Oznacz wszystko</button>' +
      '</div></div></div>';

    const body = any
      ? '<table class="tbl"><thead><tr><th>Projekt</th><th class="num">Godziny</th><th class="num">Stawka</th><th class="num">Kwota</th><th class="num">Płatność</th></tr></thead><tbody>' +
        rows.join('') +
        '<tr><td><b>Razem</b></td><td class="num"><b>' + C.fmtHM(grandMin) + '</b></td><td></td>' +
        '<td class="num"><b class="accent" style="font-size:1.05rem">' + money(grandAmt) + '</b></td>' +
        '<td class="num">' + (allPaid ? '<span class="badge ok">' + icon('check') + ' rozliczone</span>' : '<span class="badge warn">' + icon('clock') + ' do zapłaty</span>') + '</td></tr>' +
        '</tbody></table>'
      : empty('receipt', 'Brak danych', 'Brak wpisów w ' + C.monthNameGen(d.getMonth()) + ' ' + d.getFullYear() + '.');

    const sum = '<div class="grid g-3 mt">' +
      kpi('Godziny', C.fmtHM(grandMin), 'łącznie', 'clock') +
      kpi('Do rozliczenia', money(grandAmt), any && !allPaid ? 'są nieopłacone pozycje' : 'wszystko rozliczone', 'wallet', allPaid ? '' : 'up') +
      kpi('Projekty', String(projIds.filter(function (p) { return list.some(function (e) { return (e.projectId || null) === p; }); }).length), 'w miesiącu', 'folder-kanban') +
      '</div>';

    return head + sum + '<div class="grid mt">' + sheetSendCard(month) + '</div>' +
      '<div class="grid mt">' + card('Szczegóły', 'table-2', body) + '</div>';
  }

  /* ============================================================
     PROJEKTY
     ============================================================ */
  function projects() {
    const st = S.get();
    const now = new Date();
    const mFrom = C.dateKey(C.startOfMonth(now)), mTo = C.dateKey(C.endOfMonth(now));

    const cards = st.projects.map(function (p) {
      const items = st.entries.filter(function (e) { return e.projectId === p.id; });
      const monthItems = items.filter(function (e) { return e.date >= mFrom && e.date <= mTo; });
      const totalM = C.totalMin(items);
      const monthM = C.totalMin(monthItems);
      const amount = C.sumAmount(items, S.rateOf, st.settings);
      const rate = p.rate != null ? p.rate : st.profile.rate;
      const budgetPct = p.budget > 0 ? C.percent(amount, p.budget) : 0;
      return '<div class="card' + (p.archived ? '' : '') + '" style="' + (p.archived ? 'opacity:.55' : '') + '">' +
        '<div class="row between">' +
        '<div class="row" style="gap:10px"><span class="dot" style="width:14px;height:14px;border-radius:5px;background:' + p.color + '"></span>' +
        '<b>' + esc(p.name) + '</b>' + (p.archived ? '<span class="badge">archiwum</span>' : '') + '</div>' +
        '<div class="tools row" style="gap:2px">' +
        '<button class="btn btn-icon btn-ghost btn-sm" data-action="project:edit" data-id="' + p.id + '" title="Edytuj">' + icon('pencil') + '</button>' +
        '<button class="btn btn-icon btn-ghost btn-sm" data-action="project:archive" data-id="' + p.id + '" title="Archiwum">' + icon(p.archived ? 'archive-restore' : 'archive') + '</button>' +
        '<button class="btn btn-icon btn-ghost btn-sm" data-action="project:delete" data-id="' + p.id + '" title="Usuń">' + icon('trash-2') + '</button>' +
        '</div></div>' +
        '<div class="meta muted" style="font-size:.76rem;margin:6px 0 12px">Stawka ' + money(rate) + '/h · ' + items.length + ' wpisów</div>' +
        '<div class="row between" style="font-size:.84rem"><span class="muted">Ten miesiąc</span><b>' + C.fmtHM(monthM) + '</b></div>' +
        '<div class="row between" style="font-size:.84rem;margin-top:4px"><span class="muted">Łącznie</span><b>' + C.fmtHM(totalM) + ' · ' + money(amount) + '</b></div>' +
        (p.budget > 0 ? '<div style="margin-top:12px">' +
          '<div class="row between" style="font-size:.74rem"><span class="dim">Budżet</span><span>' + money(amount) + ' / ' + money(p.budget) + '</span></div>' +
          '<div style="height:8px;border-radius:99px;background:var(--border);overflow:hidden;margin-top:6px"><div style="height:100%;width:' + budgetPct + '%;background:linear-gradient(90deg,var(--accent),var(--accent-2))"></div></div>' +
          '</div>' : '') +
        '</div>';
    }).join('');

    const header = '<div class="card"><div class="row wrap between">' +
      '<div><b>' + st.projects.length + '</b> <span class="muted">projektów</span></div>' +
      '<button class="btn btn-primary btn-sm" data-action="project:add">' + icon('plus') + ' Nowy projekt</button>' +
      '</div></div>';

    return header + '<div class="grid g-3 mt">' + (cards || empty('folder-plus', 'Brak projektów', 'Dodaj pierwszy projekt.', '<button class="btn btn-primary btn-sm" data-action="project:add">' + icon('plus') + ' Nowy projekt</button>')) + '</div>';
  }

  /* ============================================================
     USTAWIENIA
     ============================================================ */
  function backupHint(st, snap) {
    const parts = ['Dane zapisywane lokalnie w przeglądarce.'];
    if (st.lastBackupAt) {
      const days = Math.max(0, Math.floor((Date.now() - new Date(st.lastBackupAt).getTime()) / 86400000));
      parts.push(days === 0 ? 'Ostatnia kopia: dziś.' : 'Ostatnia kopia: ' + days + ' dni temu.');
      if (days > 14) parts.push('Zrób nową kopię — minęło sporo czasu.');
    } else {
      parts.push('Nie masz jeszcze kopii zapasowej.');
    }
    if (snap) parts.push('Kopia awaryjna z ' + C.fullDate(new Date(snap.at)) + ' (' + snap.entries + ' wpisów).');
    return parts.join(' ');
  }

  function googleCard() {
    const st = S.get();
    const g = (st.settings || {}).google || {};
    const G = SK.google;
    const s = G ? G.status() : {};
    const connected = !!s.connected;

    const onoff = function (name, checked, label) {
      return '<div class="row between"><span>' + label + '</span><label class="switch"><input type="checkbox" name="' + name + '"' + (checked ? ' checked' : '') + ' /><span class="sl"></span></label></div>';
    };

    const instr = '<details class="instr"><summary>' + icon('help-circle') + ' Jak podłączyć Google (krok po kroku)</summary>' +
      '<ol>' +
      '<li>Wejdź na <b>console.cloud.google.com</b> i utwórz projekt.</li>' +
      '<li>W <b>Bibliotece</b> włącz <b>Google Calendar API</b> oraz <b>Google Sheets API</b>.</li>' +
      '<li>W <b>Ekranie zgody OAuth</b> (Odbiorcy) kliknij <b>Opublikuj aplikację</b> — dzięki temu nie trzeba logować się co 7 dni.</li>' +
      '<li>W <b>Danych logowania</b> → „Utwórz dane logowania” → <b>Identyfikator klienta OAuth</b> → typ <b>Aplikacja internetowa</b>.</li>' +
      '<li>W „Autoryzowanych źródłach JavaScript” dodaj: <span class="kbd">https://szklu090.github.io</span></li>' +
      '<li>Client ID jest już wpisany w aplikacji — nie musisz go podawać.</li>' +
      '<li>Kliknij <b>Połącz z Google</b> i zaakceptuj dostęp do Kalendarza i Skoroszytu.</li>' +
      '</ol>' +
      '<p class="hint">Aplikacja działa w przeglądarce (PWA) pod adresem <span class="kbd">https://szklu090.github.io/app/</span>. Wpisy trafiają do Kalendarza jako wydarzenie z godziną „od” i „do” — czas trwania liczy sam Kalendarz.</p>' +
      '</details>';

    const notReady = !!s.autoCalendar && !s.ready;

    return card('Google (Kalendarz i Skoroszyt)', 'cloud', '<form data-form="google" class="stack">' +
      '<div class="row between"><span class="muted">Status</span>' +
      (connected ? '<span class="badge ok">' + icon('check') + ' Połączono</span>' : '<span class="badge warn">' + icon('x') + ' Nie połączono</span>') + '</div>' +
      (notReady ? '<div class="hint" style="color:var(--warn,#f59e0b)">' + icon('alert-triangle') + ' Dodawanie do Kalendarza jest włączone, ale Google nie jest podłączone — wpisy NIE trafią do Kalendarza, dopóki nie klikniesz „Połącz z Google”.</div>' : '') +
      (s.native ? '<div class="hint">' + icon('smartphone') + ' Tryb aplikacji Android — logowanie natywne (bez WebView).</div>' : '') +
      '<div class="field full"><label>Client ID Google (aplikacja internetowa)</label><input class="input" name="clientId" value="' + esc(g.clientId || '') + '" placeholder="np. 1234567890-abcd.apps.googleusercontent.com" /><div class="hint" style="margin-top:4px">Wpisany domyślnie — możesz zostawić bez zmian.</div></div>' +
      '<div class="field full"><label>Link / ID Skoroszytu</label><input class="input" name="spreadsheetId" value="' + esc(g.spreadsheetId || '') + '" placeholder="https://docs.google.com/spreadsheets/d/..." /></div>' +
      '<div class="field full"><label>Nazwa zakładki (opcjonalnie)</label><input class="input" name="sheetName" value="' + esc(g.sheetName || '') + '" placeholder="Zostaw puste = nazwy miesięcy (Listopad, Grudzień...)" /></div>' +
      onoff('autoCalendar', g.autoCalendar !== false, 'Dodawaj wpisy do Kalendarza Google') +
      onoff('notify', !!g.notify, 'Powiadamiaj o zamkniętym miesiącu') +
      '<div class="row wrap">' +
      '<button class="btn btn-primary btn-sm" type="submit">' + icon('save') + ' Zapisz</button>' +
      (connected ? '<button type="button" class="btn btn-sm" data-action="google:disconnect">' + icon('unplug') + ' Rozłącz</button>'
                 : '<button type="button" class="btn btn-sm" data-action="google:connect">' + icon('log-in') + ' Połącz z Google</button>') +
      '<button type="button" class="btn btn-sm" data-action="google:test">' + icon('plug-zap') + ' Testuj połączenie</button>' +
      '<button type="button" class="btn btn-sm" data-action="sheets:send">' + icon('send') + ' Wyślij ten miesiąc</button>' +
      '</div>' +
      '<div class="hint">Do arkusza trafiają tylko godziny <b>od</b> i <b>do</b> — ilość godzin i sumy liczy formuła arkusza. Zakładka miesiąca zostanie utworzona, jeśli jej nie ma.</div>' +
      instr +
      '</form>');
  }

  function syncCard() {
    const st = S.get();
    const c = (st.settings || {}).sync || {};
    const Y = SK.sync;
    const s = Y ? Y.status() : { ready: false, lastAt: '', lastError: '', auto: true };
    let last = '—';
    if (s.lastAt) {
      try {
        const d = new Date(s.lastAt);
        last = C.fullDate(d) + ' ' + d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      } catch (e) { last = s.lastAt; }
    }

    const instr = '<details class="instr"><summary>' + icon('help-circle') + ' Jak włączyć bazę na serwerze (krok po kroku)</summary>' +
      '<ol>' +
      '<li>Wejdź na <b>script.google.com</b> → <b>Nowy projekt</b>.</li>' +
      '<li>Wklej kod z pliku <span class="kbd">Code.gs</span> (dostałeś go razem z aplikacją).</li>' +
      '<li><b>Projekt → Ustawienia projektu → Właściwości skryptu</b> → dodaj <span class="kbd">SECRET</span> = Twój sekret.</li>' +
      '<li>(opcjonalnie) dodaj <span class="kbd">OWNER_EMAIL</span> = Twój e-mail — dostaniesz powiadomienie, gdy połączy się nowe urządzenie.</li>' +
      '<li><b>Wdróż → Nowe wdrożenie</b> → typ <b>Aplikacja internetowa</b>.</li>' +
      '<li>„Wykonaj jako”: <b>Ja</b>; „Kto ma dostęp”: <b>Każdy</b> → wdróż i skopiuj adres <span class="kbd">/exec</span>.</li>' +
      '<li>Adres bazy jest już wpisany — wpisz tylko sekret (jeśli go ustawiłeś), zapisz i kliknij <b>Test</b>.</li>' +
      '</ol>' +
      '<p class="hint">Dane trafiają do arkusza <b>STOL-KOS Sync</b> w Twoim Google Drive. Aplikacja wysyła je automatycznie po każdej zmianie. Zdarzenia synchronizacji znajdziesz pod dzwonkiem 🔔 w nagłówku.</p>' +
      '</details>';

    return card('Baza na serwerze (Google)', 'cloud-upload', '<form data-form="sync" class="stack">' +
      '<div class="row between"><span class="muted">Status</span>' +
      (s.ready ? '<span class="badge ok">' + icon('check') + ' Skonfigurowano</span>' : '<span class="badge warn">' + icon('x') + ' Nie skonfigurowano</span>') + '</div>' +
      (s.ready && !c.token ? '<div class="hint" style="color:var(--warn,#f59e0b)">' + icon('key-round') + ' Adres bazy jest już wpisany. Wpisz sekret, jeśli ustawiłeś go w Apps Script.</div>' : '') +
      '<div class="field full"><label>Masz link do konfiguracji? Wklej go tutaj</label><input class="input" name="syncLink" placeholder="https://.../?sync=...&secret=..." /></div>' +
      '<div class="field full"><label>Adres Web App (URL)</label><input class="input" name="syncUrl" value="' + esc(c.url || '') + '" placeholder="https://script.google.com/macros/s/.../exec" /></div>' +
      '<div class="field full"><label>Sekret (opcjonalnie)</label><input class="input" name="syncToken" value="' + esc(c.token || '') + '" placeholder="np. moj-sekret-123" /></div>' +
      '<div class="row between"><span>Wysyłaj automatycznie po zmianie</span><label class="switch"><input type="checkbox" name="syncAuto"' + (c.auto !== false ? ' checked' : '') + ' /><span class="sl"></span></label></div>' +
      '<div class="row wrap">' +
      '<button class="btn btn-primary btn-sm" type="submit">' + icon('save') + ' Zapisz</button>' +
      '<button type="button" class="btn btn-sm" data-action="sync:push">' + icon('upload-cloud') + ' Wyślij teraz</button>' +
      '<button type="button" class="btn btn-sm" data-action="sync:pull">' + icon('download-cloud') + ' Pobierz z serwera</button>' +
      '<button type="button" class="btn btn-sm" data-action="sync:test">' + icon('plug-zap') + ' Test</button>' +
      '<button type="button" class="btn btn-sm" data-action="sync:link"' + (s.ready ? '' : ' disabled') + '>' + icon('link') + ' Kopiuj link do konfiguracji</button>' +
      '</div>' +
      '<div class="hint">Otwórz ten link na innym urządzeniu (telefon, drugi komputer) — baza ustawi się sama, bez wpisywania adresu i sekretu.</div>' +
      '<div class="hint">Ostatni zapis: <b>' + esc(last) + '</b>' + (s.lastError ? ' · <span style="color:var(--danger,#ef4444)">błąd: ' + esc(s.lastError) + '</span>' : '') + '</div>' +
      instr +
      '</form>');
  }

  /** Karta zalogowanego użytkownika (widoczna po zalogowaniu). */
  function accountCard() {
    const A = SK.auth;
    if (!A) return '';
    const u = A.user();
    if (!u) return '';
    return card('Konto', 'shield-check', '<div class="stack">' +
      '<div class="row between" style="gap:12px">' +
        '<div style="min-width:0"><b>' + esc(u.name) + '</b>' +
        '<div class="hint">' + (u.role === 'owner' ? 'Właściciel' : 'Użytkownik') + ' · konto na tym urządzeniu</div></div>' +
        '<button class="btn btn-sm" data-action="auth:logout">' + icon('log-out') + ' Wyloguj</button>' +
      '</div>' +
      '<form data-form="auth-self-pass" class="stack">' +
        '<div class="form-grid">' +
          '<div class="field full"><label>Aktualne hasło</label><input class="input" type="password" name="current" autocomplete="current-password" required /></div>' +
          '<div class="field"><label>Nowe hasło</label><input class="input" type="password" name="next" autocomplete="new-password" required /></div>' +
          '<div class="field"><label>Powtórz nowe</label><input class="input" type="password" name="next2" autocomplete="new-password" required /></div>' +
        '</div>' +
        '<div class="row" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" type="submit">' + icon('key-round') + ' Zmień hasło</button></div>' +
      '</form></div>');
  }

  /** Panel właściciela: lista kont, dodawanie, zmiana nazw i haseł. */
  function usersCard() {
    const A = SK.auth;
    if (!A || !A.isOwner()) return '';
    const list = A.list() || [];
    return card('Użytkownicy', 'users', '<div class="stack">' +
      '<p class="hint" style="margin:0">Właściciel może dodawać konta, zmieniać nazwy i hasła. Konta są zapisane tylko na tym urządzeniu.</p>' +
      '<div class="stack">' + list.map(function (u) {
        return '<div class="user-row">' +
          '<div class="user-ava">' + esc(String(u.name || '?').slice(0, 1).toUpperCase()) + '</div>' +
          '<div class="user-info"><b>' + esc(u.name) + '</b>' +
          '<div class="hint">' + (u.role === 'owner' ? 'Właściciel' : 'Użytkownik') + '</div></div>' +
          '<div class="row" style="gap:4px">' +
            '<button class="btn btn-icon btn-ghost btn-sm" data-action="auth:user-name" data-id="' + u.id + '" title="Zmień nazwę">' + icon('pencil') + '</button>' +
            '<button class="btn btn-icon btn-ghost btn-sm" data-action="auth:user-pass" data-id="' + u.id + '" title="Zmień hasło">' + icon('key-round') + '</button>' +
            '<button class="btn btn-icon btn-ghost btn-sm" data-action="auth:user-role" data-id="' + u.id + '" title="Zmień rolę">' + icon('shield') + '</button>' +
            '<button class="btn btn-icon btn-ghost btn-sm" data-action="auth:user-del" data-id="' + u.id + '" title="Usuń konto">' + icon('trash-2') + '</button>' +
          '</div></div>';
      }).join('') + '</div>' +
      '<button class="btn btn-primary btn-sm" data-action="auth:user-add">' + icon('user-plus') + ' Dodaj użytkownika</button>' +
    '</div>');
  }

  function settings() {
    const st = S.get();
    const sym = C.symbol(st.profile.currency);
    const snap = S.snapshotInfo();
    const currencies = Object.keys(C.CURRENCIES).map(function (k) {
      return '<option value="' + k + '"' + (st.profile.currency === k ? ' selected' : '') + '>' + k + ' · ' + C.CURRENCIES[k].symbol + '</option>';
    }).join('');

    const profile = card('Profil', 'user', '<form data-form="profile" class="stack">' +
      '<div class="form-grid">' +
      '<div class="field full"><label>Imię / nazwa</label><input class="input" name="name" value="' + esc(st.profile.name) + '" placeholder="np. Szymon" /></div>' +
      '<div class="field"><label>Domyślna stawka (' + sym + ')</label><input class="input" type="number" min="0" step="0.5" name="rate" value="' + st.profile.rate + '" /></div>' +
      '<div class="field"><label>Waluta</label><select class="select" name="currency">' + currencies + '</select></div>' +
      '</div><div class="row" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" type="submit">' + icon('save') + ' Zapisz</button></div></form>');

    const goals = card('Cele', 'target', '<form data-form="goals" class="stack">' +
      '<div class="form-grid">' +
      '<div class="field"><label>Cel dzienny (' + sym + ')</label><input class="input" type="number" min="0" step="10" name="goalDaily" value="' + st.profile.goalDaily + '" /></div>' +
      '<div class="field"><label>Cel tygodniowy (' + sym + ')</label><input class="input" type="number" min="0" step="50" name="goalWeekly" value="' + st.profile.goalWeekly + '" /></div>' +
      '<div class="field full"><label>Cel miesięczny (' + sym + ')</label><input class="input" type="number" min="0" step="100" name="goalMonthly" value="' + st.profile.goalMonthly + '" /></div>' +
      '</div><div class="hint">0 = cel wyłączony.</div>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" type="submit">' + icon('save') + ' Zapisz</button></div></form>');

    const work = card('Praca i premie', 'briefcase', '<form data-form="work" class="stack">' +
      '<div class="row between"><span>Dodatek weekendowy</span><label class="switch"><input type="checkbox" name="applyWeekend"' + (st.settings.applyWeekend ? ' checked' : '') + ' /><span class="sl"></span></label></div>' +
      '<div class="form-grid">' +
      '<div class="field"><label>Mnożnik weekend</label><input class="input" type="number" min="1" step="0.05" name="weekendMultiplier" value="' + st.settings.weekendMultiplier + '" /></div>' +
      '<div class="field"><label>Mnożnik noc</label><input class="input" type="number" min="1" step="0.05" name="nightMultiplier" value="' + st.settings.nightMultiplier + '" /></div>' +
      '<div class="field"><label>Noc od (godz.)</label><input class="input" type="number" min="0" max="23" name="nightStart" value="' + st.settings.nightStart + '" /></div>' +
      '<div class="field"><label>Noc do (godz.)</label><input class="input" type="number" min="0" max="23" name="nightEnd" value="' + st.settings.nightEnd + '" /></div>' +
      '<div class="field"><label>Domyślna przerwa (min)</label><input class="input" type="number" min="0" step="5" name="autoBreak" value="' + st.settings.autoBreak + '" /></div>' +
      '<div class="field"><label>Tydzień od</label><select class="select" name="weekStartsMonday"><option value="1"' + (st.profile.weekStartsMonday ? ' selected' : '') + '>Poniedziałek</option><option value="0"' + (st.profile.weekStartsMonday ? '' : ' selected') + '>Niedziela</option></select></div>' +
      '<div class="field"><label>Nadgodziny po (h)</label><input class="input" type="number" min="0" step="0.5" name="otAfter" value="' + (Number(st.settings.otAfter) || 0) + '" /></div>' +
      '<div class="field"><label>Mnożnik nadgodzin</label><input class="input" type="number" min="1" step="0.05" name="otMultiplier" value="' + (Number(st.settings.otMultiplier) || 1.5) + '" /></div>' +
      '<div class="field"><label>Zaokrąglanie czasu</label><select class="select" name="roundTo">' +
      [0, 5, 10, 15, 30].map(function (v) { return '<option value="' + v + '"' + (st.settings.roundTo === v ? ' selected' : '') + '>' + (v ? v + ' min' : 'bez zaokrąglania') + '</option>'; }).join('') +
      '</select></div>' +
      '</div><div class="hint">Nadgodziny liczone powyżej progu w obrębie jednego wpisu (0 = wyłączone). Zaokrąglanie dotyczy tylko wyliczanej kwoty.</div>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn btn-primary btn-sm" type="submit">' + icon('save') + ' Zapisz</button></div></form>');

    const appearance = card('Wygląd', 'palette', '<div class="stack">' +
      '<div class="row between"><span>Motyw</span>' + seg('theme:set', [{ value: 'dark', label: 'Ciemny' }, { value: 'light', label: 'Jasny' }], st.profile.theme) + '</div>' +
      '<div class="row between"><span>Instalacja jako aplikacja</span><button class="btn btn-sm" id="pwa-install" data-action="pwa:install" style="display:none">' + icon('download') + ' Zainstaluj</button><span class="badge ok">PWA</span></div>' +
      '</div>');

    const templates = card('Szablony wpisów', 'bookmark', (st.templates || []).length
      ? '<div class="stack">' + (st.templates || []).map(function (t) {
          return '<div class="row between" style="gap:10px">' +
            '<div style="min-width:0"><b>' + esc(t.name) + '</b>' +
            '<div class="hint">' + esc(t.start) + '–' + esc(t.end) + ' · przerwa ' + t.breakMin + ' min' +
            (t.projectId ? ' · ' + esc(projectName(t.projectId)) : '') + '</div></div>' +
            '<button class="btn btn-icon btn-ghost btn-sm" data-action="tpl:delete" data-id="' + t.id + '" title="Usuń szablon">' + icon('trash-2') + '</button>' +
            '</div>';
        }).join('') + '</div>'
      : '<p class="hint" style="margin:0">Brak szablonów. W widoku „Dodaj wpis” wypełnij formularz i kliknij „Zapisz jako szablon”.</p>');

    const data = card('Dane', 'database', '<div class="stack">' +
      '<div class="row wrap">' +
      '<button class="btn btn-sm" data-action="data:export-json">' + icon('download') + ' Kopia JSON</button>' +
      '<button class="btn btn-sm" data-action="data:import-json">' + icon('upload') + ' Wczytaj JSON</button>' +
      '<button class="btn btn-sm" data-action="data:import-csv">' + icon('file-up') + ' Import CSV</button>' +
      '<button class="btn btn-sm" data-action="data:export-csv">' + icon('file-spreadsheet') + ' Raport CSV</button>' +
      (snap ? '<button class="btn btn-sm" data-action="data:restore-snapshot">' + icon('history') + ' Przywróć kopię</button>' : '') +
      '<button class="btn btn-sm" data-action="data:demo">' + icon('wand-2') + ' Dane demo</button>' +
      '<button class="btn btn-sm btn-danger" data-action="data:clear">' + icon('trash-2') + ' Wyczyść wszystko</button>' +
      '</div>' +
      '<div class="hint">' + backupHint(st, snap) + '</div>' +
      '</div>');

    const about = card('O aplikacji', 'info', '<div class="stack" style="font-size:.86rem">' +
      '<div class="row between"><span class="muted">Wersja</span><b>STOL-KOS 3.6</b></div>' +
      '<div class="row between"><span class="muted">Magazyn</span><b id="storage-info2">localStorage</b></div>' +
      '<div class="row between"><span class="muted">Tryb</span><b>offline-first (PWA)</b></div>' +
      '<div class="hint">Skróty: <span class="kbd">Ctrl K</span> paleta · <span class="kbd">N</span> nowy wpis · <span class="kbd">Esc</span> zamknij.</div>' +
      '</div>');

    return '<div class="grid g-2">' + profile + accountCard() + usersCard() + goals + work + googleCard() + syncCard() + templates + appearance + data + about + '</div>';
  }

  /* ============================================================
     Eksport widoków
     ============================================================ */
  const RENDER = {
    dashboard: dashboard,
    entries: entries,
    calendar: calendar,
    add: add,
    stats: stats,
    settlements: settlements,
    projects: projects,
    settings: settings,
  };

  function render(page) {
    const fn = RENDER[page] || RENDER.dashboard;
    return fn();
  }

  SK.views = {
    meta: META,
    render: render,
    entryFields: entryFields,
    projectOptions: projectOptions,
    projectName: projectName,
    updateAddPreview: updateAddPreview,
    entriesFiltered: entriesFiltered,
    weekdayItems: weekdayItems,
    money: money,
    cur: cur,
  };
})(typeof window !== 'undefined' ? window : globalThis);

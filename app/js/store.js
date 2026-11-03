/* ============================================================
   stol-kos — store.js
   Stan aplikacji, trwałość (localStorage), migracja, CRUD.
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const C = SK.compute;
  const KEY = 'stol-kos-v3';
  const LEGACY = ['stol-kos-v2', 'stol-kos-v1'];
  const DEFAULT_PROJECT = { name: 'Ogólny', color: '#84cc16' };
  // Domyślny Client ID OAuth (aplikacja internetowa) — wpisany na stałe,
  // żeby nie trzeba było go podawać na każdym urządzeniu.
  const DEFAULT_GOOGLE_CLIENT_ID = '842623869384-64u6uvii79jl4ph7cif2i28m3sa1ngjo.apps.googleusercontent.com';
  const saveHooks = [];

  function defaults() {
    return {
      version: 3,
      profile: {
        name: '', rate: 45, currency: 'PLN',
        goalDaily: 0, goalWeekly: 0, goalMonthly: 5000,
        weekStartsMonday: true, theme: 'dark',
      },
      settings: {
        applyWeekend: true, weekendMultiplier: 1.5,
        nightMultiplier: 1, nightStart: 22, nightEnd: 6,
        autoBreak: 30,
        otAfter: 0, otMultiplier: 1.5,
        roundTo: 0,
        google: {
          clientId: DEFAULT_GOOGLE_CLIENT_ID, spreadsheetId: '', sheetName: '',
          autoCalendar: true, notify: false,
        },
        sync: { url: '', token: '', auto: true },
      },
      projects: [],
      entries: [],
      settlements: [],
      templates: [],
      sheetsExported: {},
      notifiedMonths: [],
      lastBackupAt: null,
      timer: null,
      createdAt: new Date().toISOString(),
    };
  }

  let state = defaults();

  function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function str(v, d) { return typeof v === 'string' ? v : d; }

  function normalize(raw) {
    const s = defaults();
    if (!raw || typeof raw !== 'object') return s;

    const p = raw.profile || {};
    s.profile = {
      name: str(p.name, ''),
      rate: num(p.rate, s.profile.rate),
      currency: SK.compute.CURRENCIES[p.currency] ? p.currency : 'PLN',
      goalDaily: num(p.goalDaily, 0),
      goalWeekly: num(p.goalWeekly, 0),
      goalMonthly: num(p.goalMonthly, 5000),
      weekStartsMonday: p.weekStartsMonday !== false,
      theme: p.theme === 'light' ? 'light' : 'dark',
    };

    const st = raw.settings || {};
    s.settings = {
      applyWeekend: st.applyWeekend !== false,
      weekendMultiplier: num(st.weekendMultiplier, 1.5),
      nightMultiplier: num(st.nightMultiplier, 1),
      nightStart: num(st.nightStart, 22),
      nightEnd: num(st.nightEnd, 6),
      autoBreak: num(st.autoBreak, 30),
      otAfter: Math.max(0, num(st.otAfter, 0)),
      otMultiplier: Math.max(1, num(st.otMultiplier, 1.5)),
      roundTo: Math.max(0, num(st.roundTo, 0)),
      google: (function () {
        const g = st.google || {};
        return {
          clientId: str(g.clientId, '') || DEFAULT_GOOGLE_CLIENT_ID,
          spreadsheetId: str(g.spreadsheetId, ''),
          sheetName: str(g.sheetName, ''),
          autoCalendar: g.autoCalendar !== false,
          notify: !!g.notify,
        };
      })(),
      sync: (function () {
        const y = st.sync || {};
        return {
          url: str(y.url, ''),
          token: str(y.token, ''),
          auto: y.auto !== false,
        };
      })(),
    };

    const projs = Array.isArray(raw.projects) ? raw.projects : [];
    s.projects = projs.map((pr, i) => ({
      id: str(pr.id, 'p' + i),
      name: str(pr.name, 'Projekt ' + (i + 1)),
      color: str(pr.color, '#84cc16'),
      rate: pr.rate == null || pr.rate === '' ? null : num(pr.rate, null),
      budget: num(pr.budget, 0),
      archived: !!pr.archived,
      createdAt: str(pr.createdAt, new Date().toISOString()),
    }));

    const ents = Array.isArray(raw.entries) ? raw.entries : [];
    s.entries = ents
      .filter(e => e && typeof e === 'object' && e.date && e.start && e.end)
      .map((e, i) => ({
        id: str(e.id, 'e' + i),
        date: str(e.date, C.dateKey(new Date())),
        start: str(e.start, '00:00'),
        end: str(e.end, '00:00'),
        breakMin: num(e.breakMin, 0),
        rate: e.rate == null || e.rate === '' ? null : num(e.rate, null),
        projectId: e.projectId || null,
        note: str(e.note, ''),
        gcalEventId: str(e.gcalEventId, '') || null,
        createdAt: str(e.createdAt, new Date().toISOString()),
        editedAt: str(e.editedAt, e.createdAt || new Date().toISOString()),
      }));

    const sets = Array.isArray(raw.settlements) ? raw.settlements : [];
    s.settlements = sets.filter(x => x && x.month).map((x, i) => ({
      id: str(x.id, 's' + i),
      month: str(x.month, ''),
      projectId: x.projectId || null,
      paid: !!x.paid,
      note: str(x.note, ''),
      updatedAt: str(x.updatedAt, new Date().toISOString()),
    }));

    s.timer = raw.timer && raw.timer.start ? {
      start: num(raw.timer.start, Date.now()),
      projectId: raw.timer.projectId || null,
      note: str(raw.timer.note, 'Stoper'),
    } : null;

    const tpl = Array.isArray(raw.templates) ? raw.templates : [];
    s.templates = tpl.filter(t => t && typeof t === 'object' && t.start && t.end).map((t, i) => ({
      id: str(t.id, 't' + i),
      name: str(t.name, 'Szablon ' + (i + 1)),
      start: str(t.start, '08:00'),
      end: str(t.end, '16:00'),
      breakMin: Math.max(0, num(t.breakMin, 0)),
      projectId: t.projectId || null,
      note: str(t.note, ''),
      rate: t.rate == null || t.rate === '' ? null : num(t.rate, null),
    }));
    s.lastBackupAt = typeof raw.lastBackupAt === 'string' ? raw.lastBackupAt : null;

    const se = raw.sheetsExported && typeof raw.sheetsExported === 'object' ? raw.sheetsExported : {};
    s.sheetsExported = {};
    Object.keys(se).forEach(function (k) {
      const v = se[k] || {};
      s.sheetsExported[k] = {
        at: str(v.at, ''), label: str(v.label, ''),
        hours: num(v.hours, 0), amount: num(v.amount, 0),
        row: v.row == null ? null : v.row, url: str(v.url, ''),
      };
    });
    s.notifiedMonths = (Array.isArray(raw.notifiedMonths) ? raw.notifiedMonths : []).filter(function (m) { return typeof m === 'string'; });

    if (!s.projects.length) s.projects = [makeDefaultProject()];
    return s;
  }

  function makeDefaultProject() {
    return {
      id: C.uid(), name: DEFAULT_PROJECT.name, color: DEFAULT_PROJECT.color,
      rate: null, budget: 0, archived: false, createdAt: new Date().toISOString(),
    };
  }

  function migrateLegacy(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = defaults();
    out.profile.rate = num(raw.rate, out.profile.rate);
    out.profile.currency = SK.compute.CURRENCIES[raw.currency] ? raw.currency : 'PLN';
    out.profile.goalMonthly = num(raw.goalMonthly, out.profile.goalMonthly);
    if (raw.settings) {
      out.settings.nightStart = num(raw.settings.nightStart, 22);
      out.settings.nightEnd = num(raw.settings.nightEnd, 6);
      out.settings.applyWeekend = raw.settings.weekendOvertime !== false;
    }
    out.projects = (Array.isArray(raw.projects) ? raw.projects : []).map((p, i) => ({
      id: p.id || ('p' + i), name: p.name || ('Projekt ' + (i + 1)),
      color: '#84cc16', rate: p.rate == null ? null : num(p.rate, null),
      budget: 0, archived: false, createdAt: new Date().toISOString(),
    }));
    out.entries = (Array.isArray(raw.entries) ? raw.entries : []).map((e, i) => ({
      id: e.id || ('e' + i), date: e.date, start: e.start, end: e.end,
      breakMin: num(e.breakMin, 0), rate: e.rate == null ? null : num(e.rate, null),
      projectId: e.projectId || null, note: e.note || '',
      createdAt: e.createdAt || new Date().toISOString(),
      editedAt: e.editedAt || e.createdAt || new Date().toISOString(),
    }));
    out.timer = raw.timer && raw.timer.start ? { start: raw.timer.start, projectId: null, note: 'Stoper' } : null;
    return out;
  }

  function load() {
    try {
      const v3 = localStorage.getItem(KEY);
      if (v3) { state = normalize(JSON.parse(v3)); return state; }
    } catch (e) { /* ignore */ }
    for (const k of LEGACY) {
      try {
        const raw = localStorage.getItem(k);
        if (raw) { state = normalize(migrateLegacy(JSON.parse(raw))); save(); return state; }
      } catch (e) { /* ignore */ }
    }
    state = defaults();
    if (!state.projects.length) state.projects = [makeDefaultProject()];
    save();
    return state;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error('save failed', e); }
    for (let i = 0; i < saveHooks.length; i++) {
      try { saveHooks[i](state); } catch (e) { /* ignore */ }
    }
  }
  function onSave(fn) { if (typeof fn === 'function') saveHooks.push(fn); return fn; }

  function get() { return state; }
  function replace(next) { state = normalize(next); save(); return state; }

  function projectById(id) { return state.projects.find(p => p.id === id) || null; }
  function rateOf(entry) {
    if (!entry) return state.profile.rate;
    if (entry.rate != null && Number(entry.rate) > 0) return Number(entry.rate);
    const p = projectById(entry.projectId);
    if (p && p.rate != null && Number(p.rate) > 0) return Number(p.rate);
    return state.profile.rate;
  }
  function amountOf(entry) { return C.amountFor(entry, rateOf(entry), state.settings); }

  /* ---- entries ---- */
  function addEntry(data) {
    const entry = {
      id: C.uid(),
      date: data.date,
      start: data.start,
      end: data.end,
      breakMin: Math.max(0, num(data.breakMin, 0)),
      rate: data.rate == null || data.rate === '' ? null : num(data.rate, null),
      projectId: data.projectId || null,
      note: str(data.note, ''),
      createdAt: new Date().toISOString(),
      editedAt: new Date().toISOString(),
    };
    state.entries.push(entry);
    sortEntries();
    save();
    return entry;
  }
  function updateEntry(id, data) {
    const e = state.entries.find(x => x.id === id);
    if (!e) return null;
    if (data.date != null) e.date = data.date;
    if (data.start != null) e.start = data.start;
    if (data.end != null) e.end = data.end;
    if (data.breakMin != null) e.breakMin = Math.max(0, num(data.breakMin, 0));
    if (data.rate !== undefined) e.rate = data.rate == null || data.rate === '' ? null : num(data.rate, null);
    if (data.projectId !== undefined) e.projectId = data.projectId || null;
    if (data.note != null) e.note = str(data.note, '');
    e.editedAt = new Date().toISOString();
    sortEntries(); save();
    return e;
  }
  function deleteEntry(id) {
    const idx = state.entries.findIndex(x => x.id === id);
    if (idx < 0) return null;
    const [removed] = state.entries.splice(idx, 1);
    save();
    return removed;
  }
  function restoreEntry(entry) { if (entry) { state.entries.push(entry); sortEntries(); save(); } }
  function duplicateEntry(id) {
    const e = state.entries.find(x => x.id === id);
    if (!e) return null;
    return addEntry({ ...e, date: e.date, note: e.note ? e.note + ' (kopia)' : '(kopia)' });
  }
  function sortEntries() {
    state.entries.sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  }
  function entryById(id) { return state.entries.find(e => e.id === id) || null; }
  function setEntryGcal(id, eventId) {
    const e = state.entries.find(x => x.id === id);
    if (!e) return null;
    e.gcalEventId = eventId || null;
    save();
    return e;
  }

  /* ---- Google / Skoroszyt: śledzenie wysyłek i przypomnień ---- */
  function monthExport(month) { return state.sheetsExported[month] || null; }
  function markMonthExported(month, info) {
    const i = info || {};
    state.sheetsExported[month] = {
      at: new Date().toISOString(),
      label: str(i.label, ''),
      hours: num(i.hours, 0),
      amount: num(i.amount, 0),
      row: i.row == null ? null : i.row,
      url: str(i.url, ''),
    };
    save();
    return state.sheetsExported[month];
  }
  function clearMonthExport(month) {
    if (state.sheetsExported[month]) { delete state.sheetsExported[month]; save(); }
    return null;
  }
  function addNotified(month) {
    if (state.notifiedMonths.indexOf(month) < 0) { state.notifiedMonths.push(month); save(); }
    return state.notifiedMonths;
  }
  function removeNotified(month) {
    state.notifiedMonths = state.notifiedMonths.filter(m => m !== month);
    save();
    return state.notifiedMonths;
  }

  /* ---- projects ---- */
  function addProject(data) {
    const p = {
      id: C.uid(), name: str(data.name, 'Projekt').trim() || 'Projekt',
      color: str(data.color, '#84cc16'),
      rate: data.rate == null || data.rate === '' ? null : num(data.rate, null),
      budget: num(data.budget, 0), archived: false,
      createdAt: new Date().toISOString(),
    };
    state.projects.push(p); save(); return p;
  }
  function updateProject(id, data) {
    const p = projectById(id); if (!p) return null;
    if (data.name != null) p.name = str(data.name, p.name).trim() || p.name;
    if (data.color != null) p.color = str(data.color, p.color);
    if (data.rate !== undefined) p.rate = data.rate == null || data.rate === '' ? null : num(data.rate, null);
    if (data.budget != null) p.budget = num(data.budget, 0);
    if (data.archived != null) p.archived = !!data.archived;
    save(); return p;
  }
  function deleteProject(id) {
    const p = projectById(id); if (!p) return false;
    state.projects = state.projects.filter(x => x.id !== id);
    state.entries.forEach(e => { if (e.projectId === id) e.projectId = null; });
    state.settlements.forEach(s => { if (s.projectId === id) s.projectId = null; });
    save(); return true;
  }

  /* ---- settlements ---- */
  function settlement(month, projectId) {
    return state.settlements.find(s => s.month === month && (s.projectId || null) === (projectId || null)) || null;
  }
  function setSettlement(month, projectId, paid) {
    let s = settlement(month, projectId);
    if (!s) {
      s = { id: C.uid(), month, projectId: projectId || null, paid: false, note: '', updatedAt: new Date().toISOString() };
      state.settlements.push(s);
    }
    s.paid = !!paid; s.updatedAt = new Date().toISOString();
    save(); return s;
  }

  /* ---- szablony wpisów ---- */
  function templateById(id) { return state.templates.find(t => t.id === id) || null; }
  function addTemplate(data) {
    const t = {
      id: C.uid(),
      name: str(data.name, '').trim() || 'Szablon',
      start: str(data.start, '08:00'),
      end: str(data.end, '16:00'),
      breakMin: Math.max(0, num(data.breakMin, 0)),
      projectId: data.projectId || null,
      note: str(data.note, ''),
      rate: data.rate == null || data.rate === '' ? null : num(data.rate, null),
    };
    state.templates.push(t); save(); return t;
  }
  function deleteTemplate(id) {
    const before = state.templates.length;
    state.templates = state.templates.filter(t => t.id !== id);
    if (state.templates.length !== before) { save(); return true; }
    return false;
  }

  /* ---- timer ---- */
  function startTimer(projectId, note) {
    state.timer = { start: Date.now(), projectId: projectId || null, note: note || 'Stoper' };
    save(); return state.timer;
  }
  function stopTimer() {
    if (!state.timer) return null;
    const started = new Date(state.timer.start);
    const elapsedMin = Math.max(1, Math.round((Date.now() - started.getTime()) / 60000));
    const endDate = new Date(started.getTime() + elapsedMin * 60000);
    const entry = addEntry({
      date: C.dateKey(started),
      start: C.pad2(started.getHours()) + ':' + C.pad2(started.getMinutes()),
      end: C.pad2(endDate.getHours()) + ':' + C.pad2(endDate.getMinutes()),
      breakMin: 0,
      rate: null,
      projectId: state.timer.projectId,
      note: state.timer.note || 'Stoper',
    });
    state.timer = null; save();
    return { entry, elapsedMin };
  }
  function timerElapsedMin() {
    if (!state.timer) return 0;
    return Math.max(0, Math.floor((Date.now() - state.timer.start) / 60000));
  }

  /* ---- dane ---- */
  const SNAP_KEY = 'stol-kos-v3-snapshot';

  /** Zapisuje jedną kopię bezpieczeństwa przed ryzykowną operacją. */
  function snapshot(reason) {
    try {
      localStorage.setItem(SNAP_KEY, JSON.stringify({
        at: new Date().toISOString(), reason: reason || '', data: exportData(),
      }));
      return true;
    } catch (e) { return false; }
  }
  function snapshotInfo() {
    try {
      const raw = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
      return raw && raw.data ? { at: raw.at, reason: raw.reason, entries: (raw.data.entries || []).length } : null;
    } catch (e) { return null; }
  }
  function restoreSnapshot() {
    try {
      const raw = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
      if (!raw || !raw.data) return false;
      replace(raw.data);
      return true;
    } catch (e) { return false; }
  }
  function markBackup() { state.lastBackupAt = new Date().toISOString(); save(); }

  function exportData() {
    return {
      app: 'stol-kos', version: 3, exportedAt: new Date().toISOString(),
      profile: state.profile, settings: state.settings, projects: state.projects,
      entries: state.entries, settlements: state.settlements, templates: state.templates,
      sheetsExported: state.sheetsExported, notifiedMonths: state.notifiedMonths,
    };
  }
  function importData(obj) {
    if (!obj || !Array.isArray(obj.entries)) throw new Error('Nieprawidłowy plik kopii zapasowej');
    snapshot('import');
    replace(obj);
    return state;
  }
  function clearAll() {
    snapshot('clear');
    state = defaults();
    state.projects = [makeDefaultProject()];
    save(); return state;
  }
  function seedDemo() {
    snapshot('demo');
    const today = new Date();
    const projs = [
      { name: 'Montaż – hala A', color: '#84cc16', rate: 55 },
      { name: 'Serwis – klient X', color: '#22d3ee', rate: 70 },
      { name: 'Biuro / dokumentacja', color: '#a78bfa', rate: null },
    ].map(p => ({ ...p, id: C.uid(), budget: 0, archived: false, createdAt: new Date().toISOString() }));
    const entries = [];
    for (let i = 0; i < 30; i++) {
      const d = C.addDays(today, -i);
      if (C.isWeekend(d) && i % 3 !== 0) continue;
      const p = projs[i % projs.length];
      const startH = 7 + (i % 3);
      const dur = 7 + (i % 4);
      entries.push({
        id: C.uid(), date: C.dateKey(d),
        start: C.pad2(startH) + ':00', end: C.pad2((startH + dur) % 24) + ':00',
        breakMin: 30, rate: null, projectId: p.id,
        note: ['Prace montażowe', 'Przegląd', 'Dokumentacja', 'Poprawki'][i % 4],
        createdAt: new Date().toISOString(), editedAt: new Date().toISOString(),
      });
    }
    state = defaults();
    state.projects = projs;
    state.entries = entries;
    save();
    return state;
  }

  SK.store = {
    KEY, SNAP_KEY, load, save, get, replace, defaults, normalize, onSave,
    projectById, rateOf, amountOf,
    addEntry, updateEntry, deleteEntry, restoreEntry, duplicateEntry, entryById, sortEntries, setEntryGcal,
    addProject, updateProject, deleteProject,
    settlement, setSettlement,
    templateById, addTemplate, deleteTemplate,
    startTimer, stopTimer, timerElapsedMin,
    exportData, importData, clearAll, seedDemo,
    snapshot, snapshotInfo, restoreSnapshot, markBackup,
    monthExport, markMonthExported, clearMonthExport, addNotified, removeNotified,
  };
})(typeof window !== 'undefined' ? window : globalThis);
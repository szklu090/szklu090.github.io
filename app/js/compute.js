/* ============================================================
   stol-kos — compute.js
   Czysta logika (bez DOM). Łatwa do testów w Node.
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});

  const CURRENCIES = {
    PLN: { symbol: 'zł', label: 'Polski złoty' },
    EUR: { symbol: '€', label: 'Euro' },
    USD: { symbol: '$', label: 'Dolar amerykański' },
    CZK: { symbol: 'Kč', label: 'Korona czeska' },
    GBP: { symbol: '£', label: 'Funt brytyjski' },
  };

  const MONTHS_PL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
  const MONTHS_PL_GEN = ['stycznia','lutego','marca','kwietnia','maja','czerwca','lipca','sierpnia','września','października','listopada','grudnia'];
  const DAYS_PL = ['Niedziela','Poniedziałek','Wtorek','Środa','Czwartek','Piątek','Sobota'];
  const DAYS_PL_SHORT = ['Nd','Pn','Wt','Śr','Cz','Pt','So'];

  const pad2 = (n) => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function toMin(hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return null;
    const parts = hhmm.split(':');
    if (parts.length < 2) return null;
    const h = Number(parts[0]); const m = Number(parts[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }
  function fromMin(min) {
    const m = ((Math.round(min) % 1440) + 1440) % 1440;
    return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
  }
  function fmtHM(min) {
    const v = Math.max(0, Math.round(min || 0));
    return Math.floor(v / 60) + ':' + pad2(v % 60);
  }
  function fmtMinLong(min) {
    const v = Math.max(0, Math.round(min || 0));
    const h = Math.floor(v / 60), m = v % 60;
    return h + 'h ' + pad2(m) + 'm';
  }
  function fmtHours(min) {
    return (Math.max(0, min || 0) / 60).toFixed(2);
  }

  function money(value, currency) {
    const c = CURRENCIES[currency] || CURRENCIES.PLN;
    const n = Number(value || 0);
    return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + c.symbol;
  }
  function symbol(currency) { return (CURRENCIES[currency] || CURRENCIES.PLN).symbol; }

  /* ---------- daty (lokalne, bez przesunięć UTC) ---------- */
  function dateKey(d) {
    const x = d instanceof Date ? d : new Date(d);
    return x.getFullYear() + '-' + pad2(x.getMonth() + 1) + '-' + pad2(x.getDate());
  }
  function parseDateKey(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function startOfWeek(d, mondayFirst) {
    const x = startOfDay(d);
    const day = x.getDay(); // 0=nd
    const diff = mondayFirst ? ((day === 0 ? 7 : day) - 1) : day;
    x.setDate(x.getDate() - diff);
    return x;
  }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
  function isWeekend(d) { const day = (d instanceof Date ? d : parseDateKey(d)).getDay(); return day === 0 || day === 6; }
  function monthName(monthIndex) { return MONTHS_PL[((monthIndex % 12) + 12) % 12]; }
  function monthNameGen(monthIndex) { return MONTHS_PL_GEN[((monthIndex % 12) + 12) % 12]; }
  function dayName(d) { return DAYS_PL[(d instanceof Date ? d : parseDateKey(d)).getDay()]; }
  function dayShort(d) { return DAYS_PL_SHORT[(d instanceof Date ? d : parseDateKey(d)).getDay()]; }
  function weekNumber(d) {
    const x = startOfDay(d);
    const target = new Date(x.valueOf());
    const dayNr = (x.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const diff = target - firstThursday;
    return 1 + Math.round(diff / 604800000);
  }
  function shortDate(d) { const x = d instanceof Date ? d : parseDateKey(d); return pad2(x.getDate()) + '.' + pad2(x.getMonth() + 1); }
  function fullDate(d) { const x = d instanceof Date ? d : parseDateKey(d); return pad2(x.getDate()) + '.' + pad2(x.getMonth() + 1) + '.' + x.getFullYear(); }

  /* ---------- czas wpisu ---------- */
  function durationMin(entry) {
    if (!entry) return 0;
    const s = toMin(entry.start), e = toMin(entry.end);
    if (s === null || e === null) return 0;
    // Równe godziny = 0 (NIE 24h). Ujemne = przez północ.
    if (s === e) return Math.max(0, 0 - (entry.breakMin || 0));
    let dur = e - s;
    if (dur < 0) dur += 1440;
    return Math.max(0, dur - (entry.breakMin || 0));
  }

  /* Czas rozliczany — opcjonalne zaokrąglanie do pełnych minut (np. 15). */
  function billableMin(entry, settings) {
    const d = durationMin(entry);
    const step = Math.max(0, Number((settings || {}).roundTo) || 0);
    if (!step || d <= 0) return d;
    return Math.max(step, Math.round(d / step) * step);
  }

  /* Nadgodziny: część wpisu powyżej progu dobowego (w ramach jednego wpisu). */
  function overtimeMin(entry, settings) {
    const st = settings || {};
    const after = Math.max(0, Number(st.otAfter) || 0);
    if (!after) return 0;
    return Math.max(0, billableMin(entry, st) - after * 60);
  }

  function toIntervals(s, e) {
    if (s === null || e === null) return [];
    if (e > s) return [[s, e]];
    if (e < s) return [[s, 1440], [0, e]];
    return [];
  }
  function nightIntervals(ns, ne) {
    if (ns === ne) return [];
    if (ns < ne) return [[ns, ne]];
    return [[ns, 1440], [0, ne]];
  }
  function overlapsNight(entry, settings) {
    const s = toMin(entry.start), e = toMin(entry.end);
    if (s === null || e === null) return false;
    const shift = toIntervals(s, e);
    if (!shift.length) return false;
    const ns = (settings.nightStart ?? 22) * 60;
    const ne = (settings.nightEnd ?? 6) * 60;
    const night = nightIntervals(ns, ne);
    return shift.some(([a, b]) => night.some(([c, d]) => a < d && c < b));
  }

  function multiplierFor(entry, settings) {
    const st = settings || {};
    let mult = 1;
    if (st.applyWeekend !== false && isWeekend(entry.date)) {
      mult = Math.max(mult, Number(st.weekendMultiplier ?? 1.5));
    }
    const nightMult = Number(st.nightMultiplier ?? 1);
    if (nightMult > 1 && overlapsNight(entry, st)) {
      mult = Math.max(mult, nightMult);
    }
    return mult;
  }

  function amountFor(entry, rate, settings) {
    if (!entry) return 0;
    const st = settings || {};
    const r = Number(rate || 0);
    const bm = billableMin(entry, st);
    if (bm <= 0 || r <= 0) return 0;
    const ot = overtimeMin(entry, st);
    const mult = multiplierFor(entry, st);
    const otMul = Math.max(1, Number(st.otMultiplier) || 1);
    return ((bm - ot) / 60) * r * mult + (ot / 60) * r * mult * otMul;
  }

  /* ---------- agregacje ---------- */
  function totalMin(entries) { return (entries || []).reduce((a, e) => a + durationMin(e), 0); }

  function sumAmount(entries, rateOf, settings) {
    return (entries || []).reduce((a, e) => a + amountFor(e, rateOf(e), settings), 0);
  }

  function inRange(entry, fromKey, toKey) { return entry.date >= fromKey && entry.date <= toKey; }
  function filterRange(entries, from, to) {
    const f = dateKey(from), t = dateKey(to);
    return (entries || []).filter(e => e.date >= f && e.date <= t);
  }

  function groupByDate(entries) {
    const map = {};
    (entries || []).forEach(e => { (map[e.date] = map[e.date] || []).push(e); });
    return map;
  }

  function byMonthOfYear(entries, year, rateOf, settings) {
    const out = Array.from({ length: 12 }, (_, i) => ({ month: i, min: 0, amount: 0, count: 0 }));
    (entries || []).forEach(e => {
      const d = parseDateKey(e.date);
      if (d.getFullYear() !== year) return;
      const b = out[d.getMonth()];
      b.min += durationMin(e); b.amount += amountFor(e, rateOf(e), settings); b.count++;
    });
    return out;
  }

  function byWeekday(entries) {
    const out = Array.from({ length: 7 }, () => 0);
    (entries || []).forEach(e => { out[parseDateKey(e.date).getDay()] += durationMin(e); });
    return out;
  }

  function byProject(entries, rateOf, settings) {
    const map = new Map();
    (entries || []).forEach(e => {
      const key = e.projectId || '__none__';
      const cur = map.get(key) || { projectId: e.projectId || null, min: 0, amount: 0, count: 0 };
      cur.min += durationMin(e); cur.amount += amountFor(e, rateOf(e), settings); cur.count++;
      map.set(key, cur);
    });
    return [...map.values()].sort((a, b) => b.min - a.min);
  }

  function currentStreak(entries) {
    const days = new Set((entries || []).map(e => e.date));
    let streak = 0; let d = startOfDay(new Date());
    while (days.has(dateKey(d))) { streak++; d = addDays(d, -1); }
    return streak;
  }

  function bestDay(entries, rateOf, settings) {
    const map = groupByDate(entries);
    let best = null;
    Object.keys(map).forEach(k => {
      const amt = sumAmount(map[k], rateOf, settings);
      if (!best || amt > best.amount) best = { date: k, amount: amt, min: totalMin(map[k]) };
    });
    return best;
  }

  function percent(part, whole) { return whole > 0 ? clamp((part / whole) * 100, 0, 100) : 0; }
  function uid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  SK.compute = {
    CURRENCIES, MONTHS_PL, MONTHS_PL_GEN, DAYS_PL, DAYS_PL_SHORT,
    pad2, clamp, toMin, fromMin, fmtHM, fmtMinLong, fmtHours, money, symbol,
    dateKey, parseDateKey, addDays, startOfDay, startOfWeek, startOfMonth, endOfMonth, startOfYear,
    isWeekend, monthName, monthNameGen, dayName, dayShort, weekNumber, shortDate, fullDate,
    durationMin, billableMin, overtimeMin, toIntervals, nightIntervals, overlapsNight, multiplierFor, amountFor,
    totalMin, sumAmount, inRange, filterRange, groupByDate, byMonthOfYear, byWeekday, byProject,
    currentStreak, bestDay, percent, uid, escapeHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
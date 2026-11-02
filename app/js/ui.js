/* ============================================================
   stol-kos — ui.js
   Pomocnicze UI: ikony, toasty, modale, potwierdzenia, motyw.
   ============================================================ */
(function (root) {
  const SK = (root.SK = root.SK || {});
  const C = SK.compute;
  const doc = root.document;

  function refresh() {
    try { if (root.lucide && typeof root.lucide.createIcons === 'function') root.lucide.createIcons(); } catch (e) {}
  }
  function icon(name, cls) { return '<i data-lucide="' + name + '"' + (cls ? ' class="' + cls + '"' : '') + '></i>'; }
  function qs(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function qsa(sel, ctx) { return Array.from((ctx || doc).querySelectorAll(sel)); }
  function esc(s) { return C.escapeHtml(s); }

  /* ---------------- Toast ---------------- */
  function toast(msg, type, opts) {
    const opt = opts || {};
    const rootEl = doc.getElementById('toast-root');
    if (!rootEl) return;
    const el = doc.createElement('div');
    el.className = 'toast ' + (type || 'info');
    const ic = type === 'ok' ? 'check-circle-2' : type === 'err' ? 'alert-circle' : 'info';
    el.innerHTML = icon(ic) + '<span style="flex:1">' + esc(msg) + '</span>' +
      (opt.actionLabel ? '<button class="undo">' + esc(opt.actionLabel) + '</button>' : '');
    rootEl.appendChild(el);
    refresh();
    const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
    if (opt.actionLabel && typeof opt.onAction === 'function') {
      el.querySelector('.undo').addEventListener('click', () => { try { opt.onAction(); } catch (e) {} remove(); });
    }
    const ttl = opt.duration || (opt.actionLabel ? 6000 : 3200);
    setTimeout(remove, ttl);
  }

  /* ---------------- Modal ---------------- */
  let modalCleanup = null;
  function closeModal() {
    const rootEl = doc.getElementById('modal-root');
    if (!rootEl) return;
    rootEl.classList.remove('open');
    rootEl.innerHTML = '';
    if (modalCleanup) { try { modalCleanup(); } catch (e) {} modalCleanup = null; }
    doc.body.style.overflow = '';
  }
  function openModal(cfg) {
    const rootEl = doc.getElementById('modal-root');
    if (!rootEl) return;
    const wide = cfg.wide ? ' wide' : '';
    rootEl.innerHTML =
      '<div class="modal' + wide + '" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><h3>' + esc(cfg.title || '') + '</h3>' +
          '<button class="btn btn-icon btn-ghost" data-close style="margin-left:auto" aria-label="Zamknij">' + icon('x') + '</button></div>' +
        '<div class="modal-body">' + (cfg.body || '') + '</div>' +
        (cfg.footer ? '<div class="modal-foot">' + cfg.footer + '</div>' : '') +
      '</div>';
    rootEl.classList.add('open');
    doc.body.style.overflow = 'hidden';
    rootEl.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
    rootEl.addEventListener('click', (e) => { if (e.target === rootEl) closeModal(); });
    refresh();
    if (typeof cfg.onOpen === 'function') cfg.onOpen(rootEl.querySelector('.modal'));
    modalCleanup = () => {};
    return closeModal;
  }

  /* ---------------- Confirm ---------------- */
  function confirmDialog(message, opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      openModal({
        title: o.title || 'Potwierdzenie',
        body: '<p style="margin:0;color:var(--text-2);line-height:1.6">' + esc(message) + '</p>',
        footer:
          '<button class="btn btn-ghost" data-no>Anuluj</button>' +
          '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-yes>' + esc(o.confirmLabel || 'Potwierdź') + '</button>',
        onOpen(modal) {
          modal.querySelector('[data-no]').addEventListener('click', () => { closeModal(); resolve(false); });
          modal.querySelector('[data-yes]').addEventListener('click', () => { closeModal(); resolve(true); });
        },
      });
    });
  }

  /* ---------------- Prompt ---------------- */
  function promptDialog(cfg) {
    const o = cfg || {};
    return new Promise((resolve) => {
      openModal({
        title: o.title || 'Wprowadź wartość',
        body:
          '<div class="field"><label>' + esc(o.label || '') + '</label>' +
          '<input class="input" id="prompt-input" type="' + (o.type || 'text') + '" value="' + esc(o.value == null ? '' : o.value) + '" ' +
          (o.min != null ? 'min="' + o.min + '" ' : '') + (o.step != null ? 'step="' + o.step + '" ' : '') + 'placeholder="' + esc(o.placeholder || '') + '" /></div>' +
          (o.hint ? '<p class="hint" style="margin-top:8px">' + esc(o.hint) + '</p>' : ''),
        footer:
          '<button class="btn btn-ghost" data-no>Anuluj</button>' +
          '<button class="btn btn-primary" data-yes>' + esc(o.confirmLabel || 'Zapisz') + '</button>',
        onOpen(modal) {
          const input = modal.querySelector('#prompt-input');
          setTimeout(() => input && input.focus(), 30);
          const done = (ok) => { const v = input ? input.value : ''; closeModal(); resolve(ok ? v : null); };
          modal.querySelector('[data-no]').addEventListener('click', () => done(false));
          modal.querySelector('[data-yes]').addEventListener('click', () => done(true));
          if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); });
        },
      });
    });
  }

  /* ---------------- Motyw ---------------- */
  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    doc.documentElement.dataset.theme = t;
    const meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#eef2f7' : '#070b14');
    qsa('#theme-toggle i, #m-theme-toggle i').forEach(i => i.setAttribute('data-lucide', t === 'light' ? 'sun' : 'moon'));
    refresh();
  }
  function toggleTheme() {
    const st = SK.store.get();
    st.profile.theme = st.profile.theme === 'light' ? 'dark' : 'light';
    SK.store.save();
    applyTheme(st.profile.theme);
    return st.profile.theme;
  }

  /* ---------------- utils ---------------- */
  function debounce(fn, ms) {
    let t; return function () { const a = arguments, c = this; clearTimeout(t); t = setTimeout(() => fn.apply(c, a), ms || 200); };
  }
  function formToObject(form) {
    const o = {};
    new FormData(form).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
    return o;
  }
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url; a.download = filename;
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function confirmClose(html, onOpen) {
    return openModal({ title: 'Potwierdzenie', body: html, footer: '<button class="btn btn-ghost" data-close>Anuluj</button>', onOpen });
  }

  SK.ui = { refresh, icon, qs, qsa, esc, toast, openModal, closeModal, confirmDialog, promptDialog, applyTheme, toggleTheme, debounce, formToObject, download };
})(typeof window !== 'undefined' ? window : globalThis);
/* Small shared helpers: DOM, formatting, dates, units. */

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
export const sum = (arr) => arr.reduce((a, b) => a + (+b || 0), 0);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const num = (n, d = 2) => { const x = +n || 0; return Number.isInteger(x) ? x : +x.toFixed(d); };
export const round = (n) => Math.round(+n || 0);
export const fmtInt = (n) => round(n).toLocaleString();
export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------- Dates ---------- */
export const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = (d) => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); }; // Monday
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const todayKey = () => dayKey(new Date());
export const isToday = (d) => dayKey(d) === todayKey();

export function periodStart(p, d) { return p === 'day' ? startOfDay(d) : p === 'week' ? startOfWeek(d) : startOfMonth(d); }
export function nextPeriodStart(p, s) { return p === 'day' ? addDays(s, 1) : p === 'week' ? addDays(s, 7) : new Date(s.getFullYear(), s.getMonth() + 1, 1); }
export function prevPeriodStart(p, s) { return p === 'day' ? addDays(s, -1) : p === 'week' ? addDays(s, -7) : new Date(s.getFullYear(), s.getMonth() - 1, 1); }
export function periodLength(p, s) { return p === 'day' ? 1 : p === 'week' ? 7 : new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate(); }
export function periodKey(p, d) {
  const s = periodStart(p, d);
  if (p === 'day') return dayKey(s);
  if (p === 'week') return 'W' + dayKey(s);
  return `${s.getFullYear()}-${pad(s.getMonth() + 1)}`;
}
export function daysInPeriod(p, d) {
  const s = periodStart(p, d), n = periodLength(p, s), out = [];
  for (let i = 0; i < n; i++) out.push(addDays(s, i));
  return out;
}
export const fmtShort = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const fmtLong = (d) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
export const fmtTime = (hhmm) => {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};
export const nowHHMM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/* ---------- Units ---------- */
export const KG_PER_LB = 0.45359237;
export const kgToLb = (kg) => kg / KG_PER_LB;
export const lbToKg = (lb) => lb * KG_PER_LB;
export const cmToIn = (cm) => cm / 2.54;
export const inToCm = (i) => i * 2.54;

/* ---------- Toast ---------- */
let toastTimer;
// A polite live region, so screen readers announce each message. It stays up long enough to read:
// at least 4 seconds, longer for longer messages.
export function toast(msg, ms) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast'; el.className = 'toast';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    ($('#content') || document.body).appendChild(el);
  }
  ms = ms || Math.max(4000, 1500 + String(msg).length * 60);
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/* ---------- Modal ---------- */
// Opens a <dialog> with given inner HTML; returns the dialog element. Closes on backdrop click / Esc.
export function modal(html, { wide = false, onClose } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal' + (wide ? ' wide' : '');
  dlg.innerHTML = html;
  // Name the dialog after its first heading, so it's announced as e.g. "Log a workout, dialog".
  const h = dlg.querySelector('h1, h2, h3');
  if (h) { h.id ||= 'dlg-title-' + Math.random().toString(36).slice(2, 8); dlg.setAttribute('aria-labelledby', h.id); }
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.showModal();
  return dlg;
}

/* ---------- Image compression (photo → small JPEG data URL) ---------- */
export function compressImage(file, maxSide = 720, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

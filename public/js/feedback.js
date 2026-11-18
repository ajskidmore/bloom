/* Feedback: a "Send feedback" box in Settings for everyone, and a Feedback inbox that only appears for
   admin accounts (listed in Firestore at admins/{uid}). Firestore rules enforce who can read it.   */
import { S, store, emit, onChange } from './state.js';
import { $, esc, toast, fmtShort } from './util.js';
import { bellEvent } from './social.js';
import { icon } from './icons.js';

const VERSION = '2026-11-15';
const KINDS = { bug: 'Bug', idea: 'Idea', other: 'Other' };
const KIND_ICON = { bug: 'bug', idea: 'lightbulb', other: 'message-square' };

const fb = () => (store?.mode === 'cloud' && S.user && !S.user.local ? store.feedback : null);

let admin = false, items = null, loadError = null, unsub = null, filter = 'new', checkId = 0;
let draft = { kind: 'idea', text: '', email: true };
const SEEN = 'bloom-fb-seen';
const seenSet = () => { try { return new Set(JSON.parse(localStorage.getItem(SEEN) || '[]')); } catch { return new Set(); } };
const saveSeen = (s) => { try { localStorage.setItem(SEEN, JSON.stringify([...s].slice(-500))); } catch {} };

/* ---------- admin inbox listener ---------- */
function stopWatch() { unsub?.(); unsub = null; items = null; loadError = null; admin = false; }
async function startWatch() {
  stopWatch();
  const id = ++checkId;
  if (!fb()) { emit('feedback'); return; }
  const ok = await fb().isAdmin();
  if (id !== checkId || !ok) return;
  admin = true;
  let primed = false;
  unsub = fb().watch((list, err) => {
    if (err) { loadError = err.code || err.message; emit('feedback'); return; }
    loadError = null;
    items = list;
    const seen = seenSet();
    list.filter((f) => f.status === 'new' && !seen.has(f.id)).forEach((f) => {
      seen.add(f.id);
      // Feedback already waiting when the inbox first loads is counted, not announced one by one.
      if (primed) bellEvent({ id: 'fb:' + f.id, at: Date.now(), icon: '📬', text: `New feedback: <b>${esc(KINDS[f.kind] || f.kind)}</b> ${esc(f.text.slice(0, 80))}${f.text.length > 80 ? '…' : ''}` }, 'New Bloom feedback', f.text.slice(0, 120));
    });
    if (!primed) {
      const waiting = list.filter((f) => f.status === 'new').length;
      if (waiting) bellEvent({ id: 'fb-open:' + new Date().toDateString(), at: Date.now(), icon: '📬', text: `<b>${waiting}</b> open feedback item${waiting === 1 ? '' : 's'} in Settings` }, 'Bloom feedback', `${waiting} open item${waiting === 1 ? '' : 's'}`);
    }
    saveSeen(seen);
    primed = true;
    emit('feedback');
  });
  emit('feedback');
}

/* ---------- rendering (called from Settings) ---------- */
function sendHTML() {
  if (!fb()) return `<section class="card sbox"><h2>Send feedback</h2><p class="muted small">Sign in to send feedback.</p></section>`;
  const email = S.user?.email;
  return `<section class="card sbox" id="feedback">
    <h2>Send feedback</h2>
    <p class="muted small">Found a bug or have an idea? It goes straight to the person who builds Bloom.</p>
    <form data-fb-form class="form">
      <div class="seg" data-fb-kind role="group" aria-label="Type of feedback">${Object.entries(KINDS).map(([k, l]) => `<button type="button" data-v="${k}" class="${draft.kind === k ? 'on' : ''}">${icon(KIND_ICON[k], { size: 16 })} ${l}</button>`).join('')}</div>
      <label class="field"><span>Your message</span><textarea name="text" rows="4" maxlength="2000" placeholder="What happened, or what would make Bloom better?">${esc(draft.text)}</textarea></label>
      ${email ? `<label class="check-row"><input type="checkbox" name="email" ${draft.email ? 'checked' : ''}><span>Include my email so I can get a reply</span></label>` : ''}
      <div class="dlg-actions"><span class="muted small">Your device type and the screen you were on are included to help fix bugs.</span><span class="spacer"></span><button class="btn primary" type="submit">${icon('send', { size: 16 })}Send feedback</button></div>
    </form>
  </section>`;
}
function device(ua = '') {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Other';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' ');
}
function inboxHTML() {
  if (!admin) return '';
  if (loadError) return `<section class="card sbox"><h2>Feedback inbox</h2><p class="small">Couldn't load feedback (${esc(loadError)}).</p></section>`;
  if (!items) return `<section class="card sbox"><h2>Feedback inbox</h2><p class="muted small">Loading…</p></section>`;
  const open = items.filter((f) => f.status !== 'done').length;
  const shown = items.filter((f) => filter === 'all' || (filter === 'done' ? f.status === 'done' : f.status !== 'done'));
  return `<section class="card sbox fb-inbox">
    <h2>Feedback inbox ${open ? `<span class="pill warn">${open} open</span>` : '<span class="pill">all done</span>'}</h2>
    <p class="muted small">Only your account can see this.</p>
    <div class="seg" data-fb-filter role="group" aria-label="Show">${[['new', 'Open'], ['done', 'Done'], ['all', 'All']].map(([k, l]) => `<button type="button" data-v="${k}" class="${filter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${shown.length ? shown.map((f) => {
      const d = new Date(f.at);
      return `<article class="fb-item ${f.status === 'done' ? 'done' : ''}" data-fb-id="${esc(f.id)}">
      <div class="fb-meta"><span class="pill ${f.kind === 'bug' ? 'warn' : ''}">${icon(KIND_ICON[f.kind] || 'message-square', { size: 13 })} ${esc(KINDS[f.kind] || f.kind)}</span>
        <b>${esc(f.name || 'Someone')}</b>${f.email ? ` <a href="mailto:${esc(f.email)}">${esc(f.email)}</a>` : ' <span class="muted small">(no email)</span>'}
        <span class="muted small">· ${esc(fmtShort(d))} ${esc(d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))}</span></div>
      <p class="fb-text">${esc(f.text)}</p>
      <div class="fb-foot"><span class="muted small">${esc([f.page, device(f.ua), f.version].filter(Boolean).join(' · '))}</span><span class="spacer"></span>
        <button class="btn small ${f.status === 'done' ? '' : 'primary'}" data-fb-toggle>${f.status === 'done' ? 'Reopen' : 'Mark done'}</button>
        <button class="btn small ghost danger" data-fb-delete>Delete</button></div>
    </article>`;
    }).join('') : `<p class="muted small">${filter === 'done' ? 'Nothing marked done yet.' : filter === 'all' ? 'No feedback yet.' : 'No open feedback.'}</p>`}
  </section>`;
}
export const feedbackHTML = () => inboxHTML() + sendHTML();

/* ---------- events ---------- */
export function bindFeedback() {
  const root = $('#settingsView');
  root.addEventListener('input', (e) => { if (e.target.matches('[data-fb-form] textarea')) draft.text = e.target.value; });
  root.addEventListener('change', (e) => { if (e.target.matches('[data-fb-form] [name=email]')) draft.email = e.target.checked; });
  root.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-fb-kind] button');
    if (k) { draft.kind = k.dataset.v; k.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === k)); return; }
    const fl = e.target.closest('[data-fb-filter] button');
    if (fl) { filter = fl.dataset.v; emit('feedback'); return; }
    const item = e.target.closest('[data-fb-id]');
    if (!item || !fb()) return;
    const id = item.dataset.fbId, f = items?.find((x) => x.id === id);
    if (e.target.closest('[data-fb-toggle]')) { await fb().setStatus(id, f?.status === 'done' ? 'new' : 'done').catch(() => toast("Couldn't update it.")); return; }
    const del = e.target.closest('[data-fb-delete]');
    if (del) {
      if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
      await fb().remove(id).catch(() => toast("Couldn't delete it."));
    }
  });
  root.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-fb-form]');
    if (!form) return;
    e.preventDefault();
    const text = form.text.value.trim();
    if (!text) { form.text.focus(); return; }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await fb().send({
        kind: draft.kind, text: text.slice(0, 2000), email: !!form.email?.checked,
        name: (S.main.settings.publicName || S.user?.displayName || '').slice(0, 40),
        ua: navigator.userAgent.slice(0, 300), page: 'settings', version: VERSION,
      });
      draft = { kind: 'idea', text: '', email: draft.email };
      toast('Thanks! Your feedback was sent.');
      emit('feedback');
    } catch (err) { console.error(err); toast("Couldn't send feedback. Try again."); btn.disabled = false; }
  });
  onChange((what) => { if (what === 'user') startWatch(); });
}

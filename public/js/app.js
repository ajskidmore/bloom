/* Bloom — app shell: boot, auth screens, routing, date navigation, flower animation. */
import { FIREBASE_CONFIG } from '../firebase-config.js';
import { S, setStore, store, onChange, emit } from './state.js';
import { localStore, firebaseStore, resolveConfig } from './store.js';
import { $, $$, esc, dayKey, fromKey, addDays, startOfDay, isToday, fmtLong, toast } from './util.js';
import { flowerSVG } from './flower.js';
import { renderToday, bindToday, flowerHealth, updateGarden, resetStage } from './habits.js';
import { renderFood, bindFood, openMealModal } from './food.js';
import { renderHealth, bindHealth } from './health.js';
import { renderTrends, bindTrends } from './trends.js';
import { renderSettings, bindSettings } from './settings.js';
import { renderFriends, initSocial, setSocialView } from './social.js';
import { bindFeedback } from './feedback.js';

const TABS = {
  today: { el: '#tab-today', render: renderToday, dated: true },
  food: { el: '#tab-food', render: renderFood, dated: true },
  health: { el: '#tab-health', render: renderHealth, dated: true },
  trends: { el: '#tab-trends', render: renderTrends },
  feed: { el: '#tab-friends', render: renderFriends },
  settings: { el: '#tab-settings', render: renderSettings },
};

/* ---------- flower animation ---------- */
let shownH = 0.45, targetH = 0.5;
function loop(time) {
  shownH += (targetH - shownH) * 0.04;
  if (S.tab === 'today' && !$('#main').hidden) {
    const svg = $('#flower');
    if (svg) svg.innerHTML = flowerSVG(shownH, time);
  }
  requestAnimationFrame(loop);
}
function refreshFlower() {
  targetH = flowerHealth(new Date());
  updateGarden(targetH);
  $('#miniFlower').innerHTML = flowerSVG(targetH, 0);
  $('#miniPct').textContent = Math.round(targetH * 100) + '%';
}

/* ---------- rendering with focus guard ---------- */
let pending = false;
function renderCurrent() {
  const tab = TABS[S.tab];
  const container = $(tab.el);
  const a = document.activeElement;
  if (a && container.contains(a) && a.matches('input, textarea, select') && !a.matches('[type=checkbox], [type=file]')) {
    pending = true; // don't yank the field out from under the user; re-render on blur
    refreshFlower();
    return;
  }
  pending = false;
  try {
    tab.render();
    refreshFlower();
    renderDateNav();
  } catch (err) {
    console.error(err);
    $(tab.el).insertAdjacentHTML('afterbegin', `<div class="card render-fail"><b>Something went wrong showing this screen.</b><pre>${esc(err?.message || String(err))}</pre><button class="btn small" onclick="window.__bloomReloadFresh && window.__bloomReloadFresh()">Reload</button></div>`);
  }
}
document.addEventListener('focusout', () => setTimeout(() => { if (pending && !document.activeElement?.matches?.('input, textarea, select')) renderCurrent(); }, 0));

/* ---------- routing ---------- */
function go(tab) {
  // #friends opens the Feed tab on its Friends view (invite links and older links use it).
  if (tab === 'friends' || tab === 'feed') { setSocialView(tab); tab = 'feed'; }
  if (!TABS[tab]) tab = 'today';
  S.tab = tab;
  Object.entries(TABS).forEach(([k, t]) => { $(t.el).hidden = k !== tab; });
  $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  $('#dateNav').hidden = !TABS[tab].dated;
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
  window.scrollTo({ top: 0 });
  renderCurrent();
}
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
$$('[data-tab]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); go(b.dataset.tab); }));

/* ---------- date navigation ---------- */
function renderDateNav() {
  const d = S.viewDate;
  $('#dateLabel').textContent = isToday(d) ? `Today · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : fmtLong(d);
  $('#dateInput').value = dayKey(d);
  $('#dateInput').max = dayKey(new Date());
  $('#dateNext').disabled = isToday(d) || d > new Date();
  $('#dateToday').hidden = isToday(d);
}
function setDate(d) { S.viewDate = startOfDay(d); resetStage(); renderCurrent(); }
$('#datePrev').onclick = () => setDate(addDays(S.viewDate, -1));
$('#dateNext').onclick = () => { if (!isToday(S.viewDate)) setDate(addDays(S.viewDate, 1)); };
$('#dateToday').onclick = () => setDate(new Date());
$('#dateInput').addEventListener('change', (e) => { if (e.target.value) setDate(fromKey(e.target.value)); });
$('#dateLabel').onclick = () => { try { $('#dateInput').showPicker(); } catch { $('#dateInput').focus(); } };

/* ---------- auth screen ---------- */
function renderAuth(mode = 'signin', msg = '') {
  const google = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  $('#auth').innerHTML = `
    <svg class="signin-flower" viewBox="0 0 200 260" aria-hidden="true">${flowerSVG(0.95, 0)}</svg>
    <h1>${mode === 'signup' ? 'Plant your garden' : mode === 'reset' ? 'Reset your password' : 'Welcome back'}</h1>
    <p class="muted">${mode === 'reset' ? "We'll email you a link to set a new password." : 'Habits, food, sleep, workouts, and a flower that keeps you honest.'}</p>
    <form class="form auth-form" novalidate>
      ${mode === 'signup' ? '<label class="field"><span>Name</span><input name="name" autocomplete="name" placeholder="What should we call you?"></label>' : ''}
      <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
      ${mode !== 'reset' ? `<label class="field"><span>Password</span><input name="password" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="6" required></label>` : ''}
      <p class="form-error">${esc(msg)}</p>
      <button class="btn primary big" type="submit">${mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}</button>
    </form>
    ${mode !== 'reset' ? `<div class="or"><span>or</span></div><button class="btn google" data-google>${google} Continue with Google</button>` : ''}
    <div class="auth-links">
      ${mode === 'signin' ? '<a href="#" data-mode="signup">Create an account</a><a href="#" data-mode="reset">Forgot password?</a>' : '<a href="#" data-mode="signin">← Back to sign in</a>'}
    </div>`;
  const form = $('#auth form');
  const err = (m) => { $('#auth .form-error').textContent = m; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const email = form.email.value.trim(), pw = form.password?.value || '';
    if (!email) return err('Enter your email.');
    if (mode !== 'reset' && pw.length < 6) return err('Password needs at least 6 characters.');
    btn.disabled = true;
    try {
      if (mode === 'signup') await store.auth.signUp(form.name.value.trim(), email, pw);
      else if (mode === 'reset') { await store.auth.reset(email); renderAuth('signin', ''); toast('Check your email for a reset link.'); }
      else await store.auth.signIn(email, pw);
    } catch (ex) { err(ex.message); btn.disabled = false; }
  });
  $('#auth [data-google]')?.addEventListener('click', async () => { try { await store.auth.google(); } catch (ex) { err(ex.message); } });
  $$('#auth [data-mode]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); renderAuth(a.dataset.mode); }));
}

function onUser() {
  const signedIn = !!S.user;
  $('#auth').hidden = signedIn;
  $('#main').hidden = !signedIn;
  $('#tabbar').hidden = !signedIn;
  const area = $('#userArea');
  if (signedIn && !S.user.local) {
    const name = S.user.displayName || S.user.email || '';
    const initial = (name[0] || '?').toUpperCase();
    area.innerHTML = S.user.photoURL
      ? `<a href="#settings" class="avatar" title="${esc(name)}"><img src="${esc(S.user.photoURL)}" alt="" referrerpolicy="no-referrer"></a>`
      : `<a href="#settings" class="avatar" title="${esc(name)}">${esc(initial)}</a>`;
  } else area.innerHTML = '';
  if (!signedIn) renderAuth();
  else go(location.hash.slice(1) || 'today');
}

/* ---------- boot ---------- */
// Phones (especially home-screen apps) can keep an old copy of index.html. If the page is missing
// parts this code needs, reload once with fresh files instead of failing to a blank screen.
const PAGE_PARTS = ['#bellBtn', '#tab-friends', '[data-tab="feed"]', '#friendsView'];
function pageIsStale() { return PAGE_PARTS.some((s) => !document.querySelector(s)); }
async function boot() {
  if (pageIsStale()) {
    let tried = false;
    try { tried = sessionStorage.getItem('bloom-fresh') === '1'; sessionStorage.setItem('bloom-fresh', '1'); } catch {}
    if (!tried) {
      const u = new URL(location.href);
      u.searchParams.set('r', Date.now().toString(36));
      location.replace(u.toString());
      return;
    }
    throw new Error('This page is out of date (' + PAGE_PARTS.filter((s) => !document.querySelector(s)).join(', ') + ' missing).');
  }
  try { sessionStorage.removeItem('bloom-fresh'); } catch {}
  const forceLocal = new URLSearchParams(location.search).has('local');
  const cfg = forceLocal ? null : await resolveConfig(FIREBASE_CONFIG);
  let s;
  if (cfg) {
    try { s = await firebaseStore(cfg); }
    catch (err) { console.error(err); s = localStore(); showBanner("Couldn't load Firebase, so you're in local mode for now."); }
  } else {
    s = localStore();
    showBanner('Preview / local mode: data stays in this browser. Deploy to Firebase for accounts and sync.');
  }
  setStore(s);
  bindToday(); bindFood(); bindHealth(); bindTrends(); bindSettings(); initSocial(); bindFeedback();
  onChange((what) => {
    if (what.startsWith?.('error:')) { toast(what.slice(6)); return; }
    if (what === 'user') { onUser(); return; }
    if (what === 'social') { if (S.user && S.tab === 'feed') renderCurrent(); return; }
    if (S.user) renderCurrent();
  });
  $('#fab').onclick = () => openMealModal({ date: dayKey(S.viewDate) });
  s.start();
  window.__bloomStarted = true;
  requestAnimationFrame(loop);

  let lastDay = dayKey(new Date());
  const tick = () => {
    const k = dayKey(new Date());
    if (k !== lastDay) { if (dayKey(S.viewDate) === lastDay) S.viewDate = startOfDay(new Date()); lastDay = k; resetStage(); if (S.user) renderCurrent(); }
  };
  setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
}
function showBanner(text) { $('#bannerText').textContent = text; $('#banner').hidden = false; }
$('#bannerClose').onclick = () => { $('#banner').hidden = true; };

boot().catch((err) => {
  console.error(err);
  const msg = err?.message || String(err);
  if (window.__bloomBootFail) { window.__bloomBootFail(msg); return; }
  // An old cached page without the safety net: show the error and a way out anyway.
  const box = document.createElement('div');
  box.className = 'boot-fail';
  box.innerHTML = '<h2>Bloom didn’t start</h2><p>Tap Reload to load the latest version.</p><pre></pre><button type="button" class="btn primary big">Reload</button>';
  box.querySelector('pre').textContent = msg;
  box.querySelector('button').onclick = () => { const u = new URL(location.href); u.searchParams.set('r', Date.now().toString(36)); location.replace(u.toString()); };
  box.style.cssText = 'position:fixed;inset:0;z-index:2000;background:#f6f1e7;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;font-family:system-ui,sans-serif';
  document.body.appendChild(box);
});

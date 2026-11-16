/* Friends & notifications.
   - Friends: friend codes + invite links, requests, and a progress snapshot friends can see
     (flower, today's habits done, streak, and optionally which habits). Food, weight, photos,
     sleep and the journal are never shared.
   - Notifications (free plan, no server): a bell in the app, plus device notifications and a daily
     habit reminder while Bloom is open or running in the background on this device.            */
import { S, store, emit, onChange } from './state.js';
import { $, esc, addDays, startOfDay, todayKey, toast, modal, debounce, nowHHMM } from './util.js';
import { flowerSVG, stageOf, STAGE_LABEL } from './flower.js';
import { flowerHealth, passed, valueFor } from './habits.js';

export const SOC = { incoming: [], outgoing: [], friends: {}, friendIds: [], inbox: [], code: null, ready: false };
const social = () => (store?.mode === 'cloud' && S.user && !S.user.local ? store.social : null);

/* ---------- small per-device storage ---------- */
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('bloom-n-' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('bloom-n-' + k, JSON.stringify(v)); } catch {} },
};
const DAY = 86400000;

/* ================= What friends see ================= */
const myName = () => (S.main.settings.publicName || S.user?.displayName || 'A Bloom friend').slice(0, 40);
const myPhoto = () => S.user?.photoURL || '';
const shareNames = () => S.main.settings.shareHabitNames !== false;
function dailyTasksOn(d) {
  const end = addDays(startOfDay(d), 1).getTime();
  return S.main.tasks.filter((t) => t.period === 'day' && (t.createdAt || 0) < end);
}
/** Days in a row with every daily habit done (today counts once it's complete). */
export function streakOf(now = new Date()) {
  let n = 0;
  for (let i = 0; i < 366; i++) {
    const d = addDays(startOfDay(now), -i), ts = dailyTasksOn(d);
    if (!ts.length) break;
    if (ts.every((t) => passed(t, valueFor(t, d)))) n++;
    else if (i > 0) break;
  }
  return n;
}
function snapshot() {
  const now = new Date(), today = dailyTasksOn(now);
  const done = today.filter((t) => passed(t, valueFor(t, now)));
  return {
    name: myName(), photo: myPhoto(),
    flower: Math.round(flowerHealth(now) * 100) / 100,
    flowerName: (S.main.settings.flowerName || 'Bloom').slice(0, 20),
    day: todayKey(), done: done.length, total: today.length, streak: streakOf(now),
    finished: shareNames() ? done.slice(0, 20).map((t) => `${t.emoji || '🌱'} ${t.name}`.slice(0, 60)) : [],
  };
}
let lastPublished = '';
const publish = debounce(() => {
  const so = social();
  if (!so || !S.mainReady) return;
  const snap = snapshot(), key = JSON.stringify(snap);
  if (key === lastPublished) return;
  lastPublished = key;
  so.publish(snap);
}, 1500);

/* ================= Device notifications ================= */
export const notifSupported = () => 'Notification' in window && 'serviceWorker' in navigator;
const deviceOn = () => notifSupported() && Notification.permission === 'granted' && LS.get('device', false);
let swReg = null;
async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { swReg = await navigator.serviceWorker.register('/sw.js'); } catch (e) { console.warn('sw', e); }
  return swReg;
}
/** Shows a device notification when Bloom is in the background; a toast when it's on screen. */
async function notify(title, body, { tag, url = '/#friends' } = {}) {
  if (!document.hidden) { toast(`${title} · ${body}`, 3600); return; }
  if (!deviceOn()) return;
  try {
    const reg = swReg || (await navigator.serviceWorker.getRegistration());
    const opts = { body, tag, icon: '/apple-touch-icon.png', badge: '/apple-touch-icon.png', data: { url } };
    if (reg) await reg.showNotification(title, opts); else new Notification(title, opts);
  } catch (e) { console.warn('notify', e); }
}
async function enableDevice() {
  if (!notifSupported()) { toast(isIOS() ? 'On iPhone, add Bloom to your Home Screen first, then turn this on there.' : "This browser doesn't support notifications."); return; }
  const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (p !== 'granted') { toast('Notifications are blocked. Allow them in your browser settings for this site.'); LS.set('device', false); return; }
  await registerSW();
  LS.set('device', true);
  toast('Notifications are on for this device');
  notify('Bloom', 'Notifications are working 🌼', { tag: 'test', url: '/#today' });
}
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

/* ================= The bell ================= */
// Local events (friend finished their day, streak milestones, reminders) live on this device for 7 days.
function addEvent(e) {
  const list = LS.get('events', []).filter((x) => x.at > Date.now() - 7 * DAY && x.id !== e.id);
  list.unshift(e); LS.set('events', list.slice(0, 40));
}
function bellItems() {
  const items = [];
  SOC.incoming.forEach((r) => items.push({ id: 'req:' + r.id, at: r.at, icon: '👋', photo: r.fromPhoto, text: `<b>${esc(r.fromName || 'Someone')}</b> wants to be friends`, req: r }));
  SOC.inbox.forEach((m) => items.push({
    id: 'in:' + m.id, at: m.at, inbox: m.id, photo: m.fromPhoto,
    icon: m.type === 'cheer' ? '💧' : '🤝',
    text: m.type === 'cheer' ? `<b>${esc(m.fromName || 'A friend')}</b> sent you a cheer` : `<b>${esc(m.fromName || 'Someone')}</b> accepted your friend request`,
  }));
  LS.get('events', []).filter((x) => x.at > Date.now() - 7 * DAY).forEach((e) => items.push({ ...e, local: true }));
  return items.sort((a, b) => b.at - a.at);
}
const unread = () => bellItems().filter((i) => i.at > LS.get('seen', 0)).length;
export function renderBell() {
  const b = $('#bellBtn');
  if (!b) return;
  b.hidden = !S.user;
  const n = unread();
  const badge = $('#bellBadge');
  badge.textContent = n > 9 ? '9+' : n;
  badge.hidden = !n;
  b.setAttribute('aria-label', n ? `Notifications, ${n} new` : 'Notifications');
}
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
const avatar = (photo, name, cls = '') => photo
  ? `<span class="f-avatar ${cls}"><img src="${esc(photo)}" alt="" referrerpolicy="no-referrer"></span>`
  : `<span class="f-avatar ${cls}">${esc((name || '?')[0].toUpperCase())}</span>`;

let bellDlg = null;
function bellHTML() {
  const seen = LS.get('seen', 0), items = bellItems();
  return `<div class="dlg-head"><h2>Notifications</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
  <div class="bell-list">${items.length ? items.map((i) => `
    <div class="bell-item ${i.at > seen ? 'new' : ''}">
      <span class="bell-ico">${i.icon}</span>
      <div class="bell-text"><div>${i.text}</div><small class="muted">${ago(i.at)}</small>
        ${i.req ? `<div class="btn-row"><button class="btn small primary" data-accept="${esc(i.req.id)}">Accept</button><button class="btn small ghost" data-decline="${esc(i.req.id)}">Decline</button></div>` : ''}</div>
    </div>`).join('') : '<p class="muted empty-bell">Nothing yet. Friend requests, cheers and reminders show up here.</p>'}</div>
  <div class="dlg-actions">${SOC.inbox.length || LS.get('events', []).length ? '<button class="btn ghost" data-clear>Clear all</button>' : ''}<span class="spacer"></span><a class="btn" href="#friends" data-close>Friends</a></div>`;
}
function openBell() {
  bellDlg = modal(bellHTML(), { onClose: () => { bellDlg = null; LS.set('seen', Date.now()); renderBell(); } });
  bellDlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { bellDlg?.close(); return; }
    const acc = e.target.closest('[data-accept]'), dec = e.target.closest('[data-decline]');
    if (acc) await acceptReq(acc.dataset.accept);
    if (dec) await declineReq(dec.dataset.decline);
    if (e.target.closest('[data-clear]')) {
      await social()?.clearInbox(SOC.inbox.map((m) => m.id));
      LS.set('events', []);
    }
    if (bellDlg && (acc || dec || e.target.closest('[data-clear]'))) bellDlg.innerHTML = bellHTML();
  });
}

/* ================= Watching friends & inbox ================= */
let primed = false;
function onSocial(next) {
  Object.assign(SOC, next);
  const pushed = new Set(LS.get('pushed', []));
  const fresh = (id, at) => !pushed.has(id) && at > Date.now() - DAY;
  const mark = (id) => pushed.add(id);
  if (primed) {
    SOC.incoming.forEach((r) => { if (fresh('req:' + r.id, r.at)) { mark('req:' + r.id); notify('New friend request', `${r.fromName || 'Someone'} wants to be friends on Bloom`, { tag: 'req' }); } });
    SOC.inbox.forEach((m) => {
      if (!fresh('in:' + m.id, m.at)) return;
      mark('in:' + m.id);
      if (m.type === 'cheer') notify('💧 A cheer from ' + (m.fromName || 'a friend'), 'They watered your flower. Keep going!', { tag: 'cheer', url: '/#today' });
      else notify('Friend request accepted', `You and ${m.fromName || 'your friend'} are now friends`, { tag: 'acc' });
    });
  } else if (SOC.ready) {
    // First load on this device: don't replay old items as notifications.
    SOC.incoming.forEach((r) => mark('req:' + r.id)); SOC.inbox.forEach((m) => mark('in:' + m.id));
    primed = true;
  }
  if (S.main.settings.notifyFriends !== false) {
    const today = todayKey();
    Object.entries(SOC.friends).forEach(([fid, p]) => {
      if (!p || p.hidden || p.day !== today || !p.total) return;
      const nm = p.name || 'A friend';
      if (p.done >= p.total && !pushed.has(`done:${fid}:${today}`)) {
        mark(`done:${fid}:${today}`);
        addEvent({ id: `done:${fid}:${today}`, at: Date.now(), icon: '🌸', photo: p.photo, text: `<b>${esc(nm)}</b> finished all their habits today` });
        notify('🌸 ' + nm + ' finished their day', 'All habits done. Send them a cheer!');
      }
      if ([7, 14, 30, 50, 100, 200, 365].includes(p.streak) && !pushed.has(`streak:${fid}:${p.streak}`)) {
        mark(`streak:${fid}:${p.streak}`);
        addEvent({ id: `streak:${fid}:${p.streak}`, at: Date.now(), icon: '🔥', photo: p.photo, text: `<b>${esc(nm)}</b> hit a ${p.streak}-day streak` });
        notify(`🔥 ${nm}: ${p.streak}-day streak`, 'Send them a cheer!');
      }
    });
  }
  LS.set('pushed', [...pushed].slice(-300));
  renderBell();
  if (bellDlg) bellDlg.innerHTML = bellHTML();
  emit('social');
}

/* ================= Daily reminder ================= */
function checkReminder() {
  const r = S.main.settings.reminder;
  if (!S.user || !S.mainReady || !r?.on || !r.time) return;
  const today = todayKey();
  if (LS.get('reminded', '') === today || nowHHMM() < r.time) return;
  const ts = dailyTasksOn(new Date());
  if (!ts.length) return;
  const left = ts.filter((t) => !passed(t, valueFor(t, new Date())));
  LS.set('reminded', today);
  if (!left.length) return;
  const body = left.length === 1 ? `One habit left today: ${left[0].emoji || '🌱'} ${left[0].name}` : `${left.length} habits left today. Your flower is thirsty 💧`;
  addEvent({ id: 'remind:' + today, at: Date.now(), icon: '⏰', text: esc(body) });
  renderBell();
  notify('Time to water your flower', body, { tag: 'reminder', url: '/#today' });
}

/* ================= Friends tab ================= */
const fmtCode = (c) => (c ? `${c.slice(0, 3)}-${c.slice(3)}` : '······');
const inviteLink = () => `${location.origin}/?add=${SOC.code}`;
function friendCard(p) {
  const fid = p.uid, today = todayKey();
  if (p.hidden) return '';
  const active = p.day === today, h = typeof p.flower === 'number' ? p.flower : 0.5;
  const pct = active && p.total ? Math.round((p.done / p.total) * 100) : 0;
  const cheered = LS.get('cheered', {})[fid] === today;
  return `<article class="card friend" data-fid="${esc(fid)}">
    <svg class="friend-flower" viewBox="0 0 200 260" aria-hidden="true">${flowerSVG(h, 0)}</svg>
    <div class="friend-body">
      <div class="friend-top">${avatar(p.photo, p.name, 'sm')}<b>${esc(p.name || 'Friend')}</b>
        <span class="pill ${h >= 0.55 ? '' : 'warn'}">${p.flowerName ? esc(p.flowerName) + ' · ' : ''}${STAGE_LABEL[stageOf(h)]}</span></div>
      ${p.day ? `<div class="friend-stats">
        <span><b>${active ? `${p.done}/${p.total}` : '0/' + (p.total || 0)}</b> today</span>
        <span>🔥 <b>${p.streak || 0}</b> day streak</span>
        ${!active ? '<span class="muted">Not active yet today</span>' : ''}</div>
        <div class="meter"><div style="width:${pct}%;background:var(--green)"></div></div>
        ${active && p.finished?.length ? `<div class="chips">${p.finished.map((f) => `<span class="chip static">${esc(f)}</span>`).join('')}</div>` : ''}`
        : '<p class="muted small">No progress shared yet.</p>'}
      <div class="btn-row">
        <button class="btn small ${cheered ? 'ghost' : 'primary'}" data-cheer ${cheered ? 'disabled' : ''}>${cheered ? 'Cheered today ✓' : '💧 Send a cheer'}</button>
        <span class="spacer"></span><button class="btn small ghost danger" data-unfriend>Remove</button>
      </div>
    </div>
  </article>`;
}
export function renderFriends() {
  const el = $('#friendsView');
  if (!social()) {
    el.innerHTML = `<div class="card empty"><p>Friends need an account. Sign in to share progress with friends.</p></div>`;
    return;
  }
  const friends = SOC.friendIds.map((id) => SOC.friends[id] || { uid: id }).filter((p) => !p.hidden);
  const pendingAdd = sessionGet();
  el.innerHTML = `
  <div class="friends">
    <section class="card sbox">
      <h3>Your friend code</h3>
      <div class="code-row"><span class="friend-code">${fmtCode(SOC.code)}</span>
        <div class="btn-row"><button class="btn small" data-copy ${SOC.code ? '' : 'disabled'}>Copy code</button><button class="btn small primary" data-invite ${SOC.code ? '' : 'disabled'}>Share invite link</button></div></div>
      <p class="muted small">Friends see your flower, how many habits you've done today and your streak${shareNames() ? ', plus the names of habits you finished' : ''}. Food, weight, photos, sleep and your journal stay private.</p>
    </section>

    <section class="card sbox">
      <h3>Add a friend</h3>
      <form class="row add-friend" data-add novalidate>
        <input name="code" placeholder="Friend code" autocomplete="off" autocapitalize="characters" maxlength="9" value="${esc(pendingAdd ? fmtCode(pendingAdd) : '')}" aria-label="Friend code">
        <button class="btn primary" type="submit">Send request</button>
      </form>
      ${pendingAdd ? '<p class="small hint-add">You opened an invite link. Tap <b>Send request</b> to add them.</p>' : ''}
    </section>

    ${SOC.incoming.length || SOC.outgoing.length ? `<section class="card sbox">
      <h3>Requests</h3>
      ${SOC.incoming.map((r) => `<div class="req">${avatar(r.fromPhoto, r.fromName)}<span class="grow"><b>${esc(r.fromName || 'Someone')}</b> wants to be friends</span>
        <button class="btn small primary" data-accept="${esc(r.id)}">Accept</button><button class="btn small ghost" data-decline="${esc(r.id)}">Decline</button></div>`).join('')}
      ${SOC.outgoing.map((r) => `<div class="req"><span class="f-avatar">⏳</span><span class="grow">Waiting for <b>${esc(fmtCode(r.toCode))}</b> to accept</span>
        <button class="btn small ghost" data-cancel="${esc(r.id)}">Cancel</button></div>`).join('')}
    </section>` : ''}

    <div class="list-head"><h2>Friends</h2><small class="muted">${friends.length || ''}</small></div>
    ${friends.length ? `<div class="friend-list">${friends.map(friendCard).join('')}</div>`
      : '<div class="card empty"><p>No friends yet. Share your invite link, or enter a friend\'s code above.</p></div>'}

    <section class="card sbox">
      <h3>What you share</h3>
      <label class="pref"><span>Your name for friends</span><input data-pubname value="${esc(myName())}" maxlength="40" class="w-160"></label>
      <label class="pref check-row"><input type="checkbox" data-sharenames ${shareNames() ? 'checked' : ''}><span>Show friends the names of habits I finished</span></label>
    </section>
  </div>`;
}

/* ---------- actions ---------- */
const sessionGet = () => { try { return sessionStorage.getItem('bloom-add') || ''; } catch { return ''; } };
const sessionSet = (v) => { try { v ? sessionStorage.setItem('bloom-add', v) : sessionStorage.removeItem('bloom-add'); } catch {} };
async function acceptReq(id) {
  const r = SOC.incoming.find((x) => x.id === id);
  if (!r) return;
  try { await social().accept(r, myName(), myPhoto()); toast(`You and ${r.fromName || 'your friend'} are now friends 🌼`); }
  catch (e) { console.error(e); toast("Couldn't accept. Try again."); }
}
async function declineReq(id) {
  const r = SOC.incoming.find((x) => x.id === id) || SOC.outgoing.find((x) => x.id === id);
  if (r) await social().dropRequest(r).catch(() => toast("Couldn't update the request."));
}
async function share(text, url) {
  if (navigator.share) { try { await navigator.share({ title: 'Bloom', text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Invite link copied'); } catch { toast(url, 6000); }
}

export function bindFriends() {
  const root = $('#friendsView');
  root.addEventListener('click', async (e) => {
    const so = social();
    if (!so) return;
    if (e.target.closest('[data-copy]')) { try { await navigator.clipboard.writeText(fmtCode(SOC.code)); toast('Code copied'); } catch { toast(fmtCode(SOC.code)); } return; }
    if (e.target.closest('[data-invite]')) { share(`Be my friend on Bloom and let's keep our flowers alive 🌼 My code is ${fmtCode(SOC.code)}.`, inviteLink()); return; }
    const acc = e.target.closest('[data-accept]'); if (acc) { acc.disabled = true; await acceptReq(acc.dataset.accept); return; }
    const dec = e.target.closest('[data-decline]') || e.target.closest('[data-cancel]');
    if (dec) { dec.disabled = true; await declineReq(dec.dataset.decline || dec.dataset.cancel); return; }
    const card = e.target.closest('[data-fid]');
    if (!card) return;
    const fid = card.dataset.fid, p = SOC.friends[fid] || {};
    const ch = e.target.closest('[data-cheer]');
    if (ch) {
      ch.disabled = true;
      try {
        await so.cheer(fid, myName(), myPhoto());
        const c = LS.get('cheered', {}); c[fid] = todayKey(); LS.set('cheered', c);
        toast(`Cheer sent to ${p.name || 'your friend'} 💧`); emit('social');
      } catch (err) { console.error(err); ch.disabled = false; toast("Couldn't send the cheer."); }
      return;
    }
    const un = e.target.closest('[data-unfriend]');
    if (un) {
      if (un.dataset.armed !== '1') { un.dataset.armed = '1'; un.textContent = `Remove ${p.name || 'friend'}?`; return; }
      try { await so.removeFriend(fid); toast('Friend removed'); } catch { toast("Couldn't remove friend."); }
    }
  });
  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.closest('[data-add]'), so = social();
    if (!f || !so) return;
    const btn = f.querySelector('button');
    btn.disabled = true;
    try {
      const r = await so.sendRequest(f.code.value, myName(), myPhoto());
      sessionSet('');
      f.code.value = '';
      toast(r === 'accepted' ? "They'd already asked you, so you're now friends 🌼" : 'Friend request sent');
      emit('social');
    } catch (err) { toast(err.message || "Couldn't send the request."); }
    btn.disabled = false;
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-pubname]')) { S.main.settings.publicName = t.value.trim().slice(0, 40); store.saveMain({ settings: S.main.settings }); publish(); }
    if (t.matches('[data-sharenames]')) { S.main.settings.shareHabitNames = t.checked; store.saveMain({ settings: S.main.settings }); publish(); emit('social'); }
  });
}

/* ================= Notification settings (shown in Settings) ================= */
export function notifSettingsHTML() {
  const r = S.main.settings.reminder || {};
  const perm = notifSupported() ? Notification.permission : 'unsupported';
  const status = perm === 'unsupported'
    ? (isIOS() ? 'On iPhone, add Bloom to your Home Screen (Share → Add to Home Screen), open it from there, then turn this on.' : "This browser doesn't support notifications.")
    : perm === 'denied' ? 'Blocked. Allow notifications for this site in your browser settings.'
    : deviceOn() ? 'On for this device.' : 'Off for this device.';
  return `<section class="card sbox">
    <h3>Notifications</h3>
    <div class="pref"><span>Device notifications<br><small class="muted">${status}</small></span>
      ${perm !== 'unsupported' && perm !== 'denied' ? (deviceOn() ? '<button class="btn small ghost" data-n-off>Turn off</button>' : '<button class="btn small primary" data-n-on>Turn on</button>') : ''}</div>
    <label class="pref check-row"><input type="checkbox" data-n-remind ${r.on ? 'checked' : ''}><span>Remind me if habits are still left at</span>
      <input type="time" data-n-time value="${esc(r.time || '20:00')}" class="w-110"></label>
    <label class="pref check-row"><input type="checkbox" data-n-friends ${S.main.settings.notifyFriends !== false ? 'checked' : ''}><span>Tell me when friends finish their day or hit a streak</span></label>
    <p class="muted small">Friend requests and cheers always appear under the bell. Bloom is on Firebase's free plan, which can't send notifications to a closed app, so reminders and alerts arrive while Bloom is open or running in the background on this device.</p>
  </section>`;
}
function bindNotifSettings() {
  const root = $('#settingsView');
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-n-on]')) { await enableDevice(); emit('all'); }
    if (e.target.closest('[data-n-off]')) { LS.set('device', false); toast('Notifications are off for this device'); emit('all'); }
  });
  root.addEventListener('change', (e) => {
    const t = e.target, st = S.main.settings;
    if (t.matches('[data-n-remind], [data-n-time]')) {
      st.reminder = { on: root.querySelector('[data-n-remind]').checked, time: root.querySelector('[data-n-time]').value || '20:00' };
      LS.set('reminded', '');
      store.saveMain({ settings: st });
      if (st.reminder.on && !deviceOn() && notifSupported() && Notification.permission === 'default') enableDevice();
      toast(st.reminder.on ? `Reminder set for ${st.reminder.time}` : 'Reminder off');
    }
    if (t.matches('[data-n-friends]')) { st.notifyFriends = t.checked; store.saveMain({ settings: st }); }
  });
}

/* ================= Boot ================= */
export function initSocial() {
  // Invite links look like /?add=ABC123 — remember the code until the person is signed in.
  const params = new URLSearchParams(location.search);
  const add = (params.get('add') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (add.length === 6) {
    sessionSet(add);
    params.delete('add');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + '#friends');
  }
  if (deviceOn()) registerSW();
  $('#bellBtn').addEventListener('click', openBell);
  bindFriends();
  bindNotifSettings();
  store.social?.subscribe(onSocial);
  onChange((what) => {
    if (what === 'user') { primed = false; lastPublished = ''; renderBell(); if (S.user && sessionGet() && location.hash !== '#friends') location.hash = '#friends'; return; }
    if (what === 'social' || what.startsWith?.('error:')) return;
    if (S.user) publish();
  });
  setInterval(() => { checkReminder(); if (S.user) publish(); }, 30_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminder(); renderBell(); } });
  renderBell();
}

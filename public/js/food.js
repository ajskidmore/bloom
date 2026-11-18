/* Food tab + meal logger (photo + description → editable macro estimate). */
import { S, store, emit, goals, mealsOn, mealTotals, dayTotals, burnedOn } from './state.js';
import { $, esc, num, round, uid, dayKey, fromKey, addDays, nowHHMM, fmtTime, debounce, modal, toast, compressImage, clamp, sum } from './util.js';
import { parseMeal, unitOptions, itemFromFood, recomputeItem, findFood, searchFoods } from './foodParse.js';
import { reactAround } from './habits.js';
import { icon } from './icons.js';

export const MEAL_TYPES = [
  { id: 'breakfast', label: 'Breakfast', emoji: '🍳', icon: 'sunrise' },
  { id: 'lunch', label: 'Lunch', emoji: '🥪', icon: 'sandwich' },
  { id: 'dinner', label: 'Dinner', emoji: '🍝', icon: 'utensils-crossed' },
  { id: 'snack', label: 'Snacks', emoji: '🍎', icon: 'apple' },
];
const TYPE_BY_ID = Object.fromEntries(MEAL_TYPES.map((t) => [t.id, t]));
function typeForTime(hhmm) {
  const [h, m] = (hhmm || nowHHMM()).split(':').map(Number);
  const t = h + m / 60;
  if (t >= 4 && t < 10.75) return 'breakfast';
  if (t >= 10.75 && t < 15) return 'lunch';
  if (t >= 16.5 && t < 21.5) return 'dinner';
  return 'snack';
}
const PORTIONS = [{ v: 0.75, label: 'Light' }, { v: 1, label: 'Normal' }, { v: 1.25, label: 'Hearty' }, { v: 1.5, label: 'Big' }];

/* ================= Food tab ================= */
function ring(eaten, budget) {
  const r = 52, c = 2 * Math.PI * r;
  const frac = budget ? clamp(eaten / budget, 0, 1) : 0;
  const over = eaten > budget;
  return `<svg viewBox="0 0 132 132" class="ring" role="img" aria-label="${fmtK(eaten)} of ${fmtK(budget)} calories eaten, ${fmtK(Math.abs(budget - eaten))} ${over ? 'over' : 'left'}">
    <circle cx="66" cy="66" r="${r}" fill="none" stroke="var(--track)" stroke-width="12"/>
    <circle cx="66" cy="66" r="${r}" fill="none" stroke="${over ? 'var(--bad)' : 'var(--green)'}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${(c * frac).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 66 66)"/>
    <text x="66" y="62" text-anchor="middle" class="ring-big">${fmtK(Math.abs(budget - eaten))}</text>
    <text x="66" y="82" text-anchor="middle" class="ring-small">${over ? 'kcal over' : 'kcal left'}</text>
  </svg>`;
}
const fmtK = (n) => round(n).toLocaleString();

function macroBar(label, val, goal, unit = 'g', cls = '') {
  const pct = goal ? clamp((val / goal) * 100, 0, 100) : 0;
  return `<div class="macro ${cls}"><div class="macro-top"><span>${label}</span><span><b>${round(val)}</b> / ${round(goal)}${unit}</span></div><div class="progress" aria-hidden="true"><div style="width:${pct}%"></div></div></div>`;
}

export function renderFood() {
  const key = dayKey(S.viewDate);
  const g = goals();
  const t = dayTotals(key);
  const burned = burnedOn(key);
  const budget = g.calories + (S.main.settings.addExercise ? burned : 0);
  const meals = mealsOn(key);
  const noProfile = !S.main.profile?.sex;

  $('#foodView').innerHTML = `
  <section class="card food-summary">
    ${ring(t.kcal, budget)}
    <div class="food-stats">
      <div class="kcal-line">
        <span><small>Budget</small><b>${fmtK(g.calories)}</b></span>
        <span class="op">−</span><span><small>Eaten</small><b>${fmtK(t.kcal)}</b></span>
        ${S.main.settings.addExercise ? `<span class="op">+</span><span><small>Exercise</small><b>${fmtK(burned)}</b></span>` : ''}
        <span class="op">=</span><span><small>${t.kcal > budget ? 'Over' : 'Left'}</small><b class="${t.kcal > budget ? 'bad-t' : 'good-t'}">${fmtK(Math.abs(budget - t.kcal))}</b></span>
      </div>
      ${macroBar('Protein', t.p, g.protein, 'g', 'm-p')}
      ${macroBar('Carbs', t.c, g.carbs, 'g', 'm-c')}
      ${macroBar('Fat', t.f, g.fat, 'g', 'm-f')}
      ${macroBar('Fiber', t.fiber, g.fiber, 'g', 'm-fi')}
      ${!S.main.settings.addExercise && burned ? `<p class="muted small">${icon('flame', { size: 15 })} ${fmtK(burned)} kcal burned in workouts (not added to your budget; change this in Settings)</p>` : ''}
      ${noProfile ? `<p class="muted small">Using default targets. <a href="#settings">Set up your goals</a> for personalized calories & macros.</p>` : ''}
    </div>
  </section>

  <div class="list-head"><h2>Meals</h2><button class="btn primary" data-action="log-meal">${icon('camera', { size: 18 })}Log a meal</button></div>
  <div class="meal-groups">
    ${MEAL_TYPES.map((mt) => {
      const ms = meals.filter((m) => m.type === mt.id);
      const kc = sum(ms.map((m) => mealTotals(m).kcal));
      return `<section class="meal-group">
        <div class="period-head"><h3>${icon(mt.icon, { size: 16 })} ${mt.label}</h3><small>${ms.length ? fmtK(kc) + ' kcal' : ''}</small>
          <button class="icon-btn" data-action="log-meal" data-type="${mt.id}" aria-label="Add to ${mt.label.toLowerCase()}">${icon('plus', { size: 18 })}</button></div>
        ${ms.length ? ms.map(mealCard).join('') : `<button class="meal-empty" data-action="log-meal" data-type="${mt.id}">${icon('plus', { size: 16 })} Add ${mt.label.toLowerCase()}</button>`}
      </section>`;
    }).join('')}
  </div>`;
  loadThumbs($('#foodView'));
}

function mealCard(m) {
  const t = mealTotals(m);
  const title = m.description?.trim() || (m.items || []).map((i) => i.name).join(', ') || 'Meal';
  return `<button class="meal card" data-meal="${m.id}">
    <span class="thumb" aria-hidden="true" ${m.hasPhoto ? `data-photo="${m.id}"` : ''}>${m.hasPhoto ? '' : icon(TYPE_BY_ID[m.type]?.icon || 'utensils', { size: 22 })}</span>
    <span class="meal-main"><span class="meal-title">${esc(title)}</span>
      <span class="meal-meta">${m.time ? fmtTime(m.time) + ' · ' : ''}P ${round(t.p)}g · C ${round(t.c)}g · F ${round(t.f)}g</span></span>
    <span class="meal-kcal">${fmtK(t.kcal)}<small> kcal</small></span><span class="sr-only">. Edit meal</span>
  </button>`;
}

async function loadThumbs(root) {
  for (const el of root.querySelectorAll('[data-photo]')) {
    const id = el.dataset.photo;
    const data = await store.getPhoto(id);
    if (data && el.isConnected) el.style.backgroundImage = `url("${data}")`;
    else if (el.isConnected) el.innerHTML = icon('utensils', { size: 22 });
  }
}

export function bindFood() {
  $('#foodView').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action="log-meal"]');
    if (b) { openMealModal({ date: dayKey(S.viewDate), type: b.dataset.type }); return; }
    const m = e.target.closest('[data-meal]');
    if (m) openMealModal({ meal: S.meals[m.dataset.meal] });
  });
}

/* ================= Meal modal ================= */
function recentMeals(limit = 8) {
  const seen = new Set(), out = [];
  const cutoff = dayKey(addDays(new Date(), -45));
  for (const m of Object.values(S.meals).filter((x) => x.date >= cutoff).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))) {
    const k = (m.description || '').trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(m);
    if (out.length >= limit) break;
  }
  return out;
}

export function openMealModal({ date, type, meal } = {}) {
  const editing = !!meal;
  const time = meal?.time || (date && date !== dayKey(new Date()) ? '12:00' : nowHHMM());
  const m = meal ? structuredClone(meal) : {
    id: uid('m'), date: date || dayKey(new Date()), time, type: type || typeForTime(time),
    description: '', items: [], portion: 1, hasPhoto: false,
  };
  let photoData = null, photoRemoved = false, dirty = editing, unknown = [];

  const recents = editing ? [] : recentMeals();
  const favs = S.main.customFoods || [];
  const dlg = modal(`
  <form class="form meal-form" novalidate>
    <h3>${editing ? 'Edit meal' : 'Log a meal'}</h3>
    <div class="meal-top">
      <label class="photo-drop">
        <input type="file" accept="image/*" capture="environment" class="sr-only" data-photo-input aria-label="Add a meal photo">
        <img alt="Meal photo" hidden data-photo-img>
        <span class="photo-ph" data-photo-ph aria-hidden="true">${icon('image-plus', { size: 28 })}<small>Add photo</small></span>
        <button type="button" class="photo-x" data-photo-remove hidden aria-label="Remove photo">${icon('x', { size: 16 })}</button>
      </label>
      <div class="meal-meta-fields">
        <div class="seg seg-wrap" data-name="type" role="group" aria-label="Meal">${MEAL_TYPES.map((t) => `<button type="button" data-v="${t.id}">${icon(t.icon, { size: 16 })} ${t.label.replace('Snacks', 'Snack')}</button>`).join('')}</div>
        <div class="row">
          <label class="field grow"><span>Date</span><input type="date" name="date"></label>
          <label class="field grow"><span>Time</span><input type="time" name="time"></label>
        </div>
      </div>
    </div>
    <label class="field"><span>What did you eat?</span>
      <textarea name="desc" rows="2" placeholder="e.g. 2 scrambled eggs, 2 slices wheat toast with butter, black coffee"></textarea></label>
    ${recents.length || favs.length ? `<div class="chips quick">${favs.slice(0, 6).map((f) => `<button type="button" class="chip fav" data-fav="${f.id}">${icon('star', { size: 14 })} ${esc(f.name)}<span class="sr-only"> (favorite)</span></button>`).join('')}${recents.map((r) => `<button type="button" class="chip" data-recent="${r.id}">${icon('rotate-cw', { size: 14 })}<span class="sr-only">Log again: </span> ${esc(r.description.slice(0, 34))}${r.description.length > 34 ? '…' : ''}</button>`).join('')}</div>` : ''}
    <div class="field"><span id="portion-lbl">Portion size <em class="muted">(look at your photo: how big was it?)</em></span>
      <div class="seg" data-name="portion" role="group" aria-labelledby="portion-lbl">${PORTIONS.map((p) => `<button type="button" data-v="${p.v}">${p.label}${p.v !== 1 ? ` ×${p.v}` : ''}</button>`).join('')}</div></div>
    <div class="items-head"><span>Estimate <em class="muted">· edit anything</em></span><button type="button" class="btn ghost small" data-reestimate hidden>${icon('rotate-cw', { size: 14 })}Re-estimate from description</button></div>
    <div class="items" data-items role="list" aria-label="Foods in this meal"></div>
    <div class="unknown" data-unknown></div>
    <div class="add-food"><input type="search" placeholder="+ Add a food… (search e.g. “avocado”)" data-search autocomplete="off" aria-label="Add a food: search"><div class="suggest" data-suggest></div></div>
    <div class="totals" data-totals aria-live="polite"></div>
    <label class="check-row"><input type="checkbox" data-savefav> <span>Save as a favorite (one tap to log it again, and the parser will recognize its name)</span></label>
    <div class="dlg-actions">
      ${editing ? '<button type="button" class="btn ghost danger" data-delete>Delete</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn ghost" data-cancel>Cancel</button>
      <button type="submit" class="btn primary">Save meal</button>
    </div>
  </form>`, { wide: true });
  const form = dlg.querySelector('form');
  const q = (s) => form.querySelector(s);
  const setSeg = (n, v) => form.querySelectorAll(`.seg[data-name="${n}"] button`).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));

  form.date.value = m.date; form.time.value = m.time; form.desc.value = m.description || '';
  setSeg('type', m.type); setSeg('portion', m.portion || 1);

  /* ----- photo ----- */
  const showPhoto = (data) => {
    q('[data-photo-img]').src = data || ''; q('[data-photo-img]').hidden = !data;
    q('[data-photo-ph]').hidden = !!data; q('[data-photo-remove]').hidden = !data;
  };
  if (m.hasPhoto) store.getPhoto(m.id).then((d) => d && showPhoto(d));
  q('[data-photo-input]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { photoData = await compressImage(file); photoRemoved = false; showPhoto(photoData); }
    catch { toast("Couldn't read that image."); }
  });
  q('[data-photo-remove]').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); photoData = null; photoRemoved = true; showPhoto(null); });

  /* ----- items ----- */
  const renderItems = () => {
    const box = q('[data-items]');
    box.setAttribute('role', m.items.length ? 'list' : 'group');
    if (!m.items.length) box.innerHTML = `<p class="muted small empty-items">Describe your meal above and the estimate will appear here. Or add foods one by one.</p>`;
    else box.innerHTML = m.items.map((it, i) => {
      const food = it.foodId ? findFood(it.foodId) : null;
      const opts = food ? unitOptions(food) : [it.unit || 'serving'];
      if (!opts.includes(it.unit)) opts.unshift(it.unit);
      const nm = esc(it.name || `food ${i + 1}`);
      return `<div class="item-row ${it.manual ? 'manual' : ''}" data-i="${i}" role="listitem">
        <input class="it-name" data-f="name" value="${esc(it.name)}" aria-label="Food ${i + 1} name">
        <input class="it-qty" data-f="qty" type="number" step="any" min="0" inputmode="decimal" value="${it.qty}" aria-label="${nm}: quantity">
        <select class="it-unit" data-f="unit" aria-label="${nm}: unit">${opts.map((u) => `<option ${u === it.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
        <label class="it-n"><input data-f="kcal" type="number" step="1" inputmode="numeric" value="${round(it.kcal)}" aria-label="${nm}: calories"><span aria-hidden="true">kcal</span></label>
        <label class="it-n"><input data-f="p" type="number" step="any" inputmode="decimal" value="${num(it.p, 1)}" aria-label="${nm}: protein grams"><span aria-hidden="true">P</span></label>
        <label class="it-n"><input data-f="c" type="number" step="any" inputmode="decimal" value="${num(it.c, 1)}" aria-label="${nm}: carbs grams"><span aria-hidden="true">C</span></label>
        <label class="it-n"><input data-f="f" type="number" step="any" inputmode="decimal" value="${num(it.f, 1)}" aria-label="${nm}: fat grams"><span aria-hidden="true">F</span></label>
        <button type="button" class="icon-btn it-x" data-remove aria-label="Remove ${nm}">${icon('x', { size: 16 })}</button>
        ${it.size ? `<span class="it-note">${it.size}</span>` : ''}${!it.foodId ? '<span class="it-note">custom</span>' : ''}
      </div>`;
    }).join('');
    renderTotals();
  };
  const renderTotals = () => {
    const t = mealTotals(m);
    q('[data-totals]').innerHTML = `<span class="tot-k"><b>${fmtK(t.kcal)}</b> kcal</span><span>Protein <b>${num(t.p, 1)}g</b></span><span>Carbs <b>${num(t.c, 1)}g</b></span><span>Fat <b>${num(t.f, 1)}g</b></span><span>Fiber <b>${num(t.fiber, 1)}g</b></span>`;
  };
  const renderUnknown = () => {
    q('[data-unknown]').innerHTML = unknown.length
      ? `<span>Didn't recognize:</span> ${unknown.map((u) => `<button type="button" class="chip warn" data-add-unknown="${esc(u)}">${icon('plus', { size: 14 })} ${esc(u)}<span class="sr-only"> (add manually)</span></button>`).join('')} <em class="muted small">Tap to add it and type in the calories.</em>`
      : '';
  };
  const estimate = () => {
    const r = parseMeal(form.desc.value);
    const p = m.portion || 1;
    m.items = r.items.map((it) => (p === 1 ? it : recomputeItem({ ...it, qty: num(it.qty * p) })));
    unknown = r.unknown;
    dirty = false; q('[data-reestimate]').hidden = true;
    renderItems(); renderUnknown();
  };
  const markDirty = () => { dirty = true; q('[data-reestimate]').hidden = !form.desc.value.trim(); };

  form.desc.addEventListener('input', debounce(() => { if (!dirty) estimate(); else q('[data-reestimate]').hidden = false; }, 350));
  q('[data-reestimate]').addEventListener('click', estimate);
  renderItems();

  q('[data-items]').addEventListener('change', (e) => {
    const row = e.target.closest('[data-i]'); if (!row) return;
    const i = +row.dataset.i, f = e.target.dataset.f, prev = m.items[i];
    let it = { ...prev };
    if (f === 'name') it.name = e.target.value;
    else if (f === 'qty' || f === 'unit') {
      it[f] = f === 'qty' ? Math.max(0, +e.target.value || 0) : e.target.value;
      if (f === 'unit') it.size = null;
      it = recomputeItem(it, prev);
    } else { it[f] = Math.max(0, +e.target.value || 0); it.manual = true; }
    m.items[i] = it;
    markDirty();
    if (f === 'qty' || f === 'unit') renderItems(); else renderTotals();
  });
  q('[data-items]').addEventListener('click', (e) => {
    const x = e.target.closest('[data-remove]'); if (!x) return;
    m.items.splice(+x.closest('[data-i]').dataset.i, 1); markDirty(); renderItems();
  });

  /* ----- portion ----- */
  form.querySelector('.seg[data-name="portion"]').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const nv = +b.dataset.v, ov = m.portion || 1;
    if (nv === ov) return;
    m.items = m.items.map((it) => recomputeItem({ ...it, qty: num(it.qty * nv / ov) }, it));
    m.portion = nv; setSeg('portion', nv); renderItems();
  });
  form.querySelector('.seg[data-name="type"]').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (b) { m.type = b.dataset.v; setSeg('type', m.type); }
  });

  /* ----- quick chips ----- */
  form.addEventListener('click', (e) => {
    const r = e.target.closest('[data-recent]');
    if (r) {
      const src = S.meals[r.dataset.recent];
      form.desc.value = src.description; m.portion = src.portion || 1; setSeg('portion', m.portion);
      m.items = (src.items || []).map((it) => ({ ...it, id: uid('i') }));
      dirty = true; unknown = []; renderItems(); renderUnknown(); q('[data-reestimate]').hidden = false;
    }
    const f = e.target.closest('[data-fav]');
    if (f) {
      const food = findFood(f.dataset.fav);
      if (food) { m.items.push(itemFromFood(food, 1, 'serving')); if (!form.desc.value.trim()) form.desc.value = food.name; markDirty(); renderItems(); }
    }
    const u = e.target.closest('[data-add-unknown]');
    if (u) {
      m.items.push({ id: uid('i'), foodId: null, name: u.dataset.addUnknown, qty: 1, unit: 'serving', kcal: 0, p: 0, c: 0, f: 0, fiber: 0, manual: true });
      unknown = unknown.filter((x) => x !== u.dataset.addUnknown);
      markDirty(); renderItems(); renderUnknown();
      setTimeout(() => q(`[data-i="${m.items.length - 1}"] [data-f="kcal"]`)?.select(), 20);
    }
  });

  /* ----- food search ----- */
  const search = q('[data-search]'), sug = q('[data-suggest]');
  const showSug = () => {
    const res = searchFoods(search.value);
    sug.innerHTML = res.map((f) => {
      const g = itemFromFood(f, f.def.qty, f.def.unit);
      return `<button type="button" data-food="${f.id}"><b>${esc(f.name)}</b><span>${num(f.def.qty)} ${f.def.unit} · ${g.kcal} kcal</span></button>`;
    }).join('') + (search.value.trim() ? `<button type="button" data-custom><b>+ “${esc(search.value.trim())}”</b><span>enter calories myself</span></button>` : '');
  };
  search.addEventListener('input', showSug);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sug.querySelector('button')?.click(); } });
  sug.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.food) { const f = findFood(b.dataset.food); m.items.push(itemFromFood(f, f.def.qty, f.def.unit)); }
    else m.items.push({ id: uid('i'), foodId: null, name: search.value.trim(), qty: 1, unit: 'serving', kcal: 0, p: 0, c: 0, f: 0, fiber: 0, manual: true });
    search.value = ''; sug.innerHTML = '';
    markDirty(); renderItems();
    if (b.dataset.custom !== undefined) setTimeout(() => q(`[data-i="${m.items.length - 1}"] [data-f="kcal"]`)?.select(), 20);
  });

  /* ----- actions ----- */
  q('[data-cancel]').onclick = () => dlg.close();
  const del = q('[data-delete]');
  let armed = false;
  if (del) del.onclick = () => {
    if (!armed) { armed = true; del.textContent = 'Tap again to delete'; return; }
    reactAround(() => { store.deleteMeal(m.id); emit('food'); });
    dlg.close();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!m.items.length && !form.desc.value.trim() && !photoData) { form.desc.focus(); return; }
    if (!m.items.length && form.desc.value.trim()) {
      m.items.push({ id: uid('i'), foodId: null, name: form.desc.value.trim().slice(0, 60), qty: 1, unit: 'serving', kcal: 0, p: 0, c: 0, f: 0, fiber: 0, manual: true });
    }
    m.date = form.date.value || m.date; m.time = form.time.value || m.time; m.description = form.desc.value.trim();
    if (photoData) m.hasPhoto = true;
    if (photoRemoved && !photoData) m.hasPhoto = false;
    m.updatedAt = Date.now();
    const ref = fromKey(m.date);
    reactAround(() => {
      store.saveMeal({ ...m });
      if (photoData) store.savePhoto(m.id, photoData);
      else if (photoRemoved) store.deletePhoto(m.id);
      emit('food');
    }, ref);
    if (q('[data-savefav]').checked) {
      const t = mealTotals(m);
      const name = (m.description || m.items.map((i) => i.name).join(', ')).slice(0, 48);
      S.main.customFoods = [...(S.main.customFoods || []), { id: uid('c'), name, aliases: '', kcal: round(t.kcal), p: num(t.p, 1), c: num(t.c, 1), f: num(t.f, 1), fiber: num(t.fiber, 1) }];
      store.saveMain({ customFoods: S.main.customFoods });
      emit('food');
    }
    dlg.close();
    toast(editing ? 'Meal updated' : `Logged ${fmtK(mealTotals(m).kcal)} kcal`);
  });
  if (!editing) setTimeout(() => form.desc.focus(), 40);
}

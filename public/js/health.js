/* Health tab: weight, sleep, water, mood & energy, steps, workouts, body measurements, journal. */
import { S, store, emit, goals, units, day, latestWeight, weightSeries, workoutsOn } from './state.js';
import { $, esc, num, round, uid, dayKey, addDays, fromKey, kgToLb, lbToKg, cmToIn, inToCm, modal, toast, clamp, sum } from './util.js';
import { icon, WORKOUT_ICON } from './icons.js';

export const weightUnit = () => (units() === 'metric' ? 'kg' : 'lb');
export const toDisplayWeight = (kg) => (kg == null ? null : num(units() === 'metric' ? kg : kgToLb(kg), 1));
export const fromDisplayWeight = (v) => (units() === 'metric' ? v : lbToKg(v));
export const weightInputValue = (kg) => (kg == null ? '' : toDisplayWeight(kg));
export function saveWeightFromInput(v, key) { store.saveDay(key, { weight: num(fromDisplayWeight(v), 3) }); }

/* ---------- Workouts ---------- */
export const WORKOUTS = [
  { id: 'walk', label: 'Walk', emoji: '🚶', met: 3.5 },
  { id: 'run', label: 'Run', emoji: '🏃', met: 9.8 },
  { id: 'strength', label: 'Strength', emoji: '🏋️', met: 5 },
  { id: 'cycle', label: 'Cycling', emoji: '🚴', met: 7.5 },
  { id: 'hiit', label: 'HIIT', emoji: '🔥', met: 8 },
  { id: 'yoga', label: 'Yoga / stretch', emoji: '🧘', met: 2.8 },
  { id: 'swim', label: 'Swim', emoji: '🏊', met: 7 },
  { id: 'hike', label: 'Hike', emoji: '🥾', met: 6 },
  { id: 'sports', label: 'Sports', emoji: '⚽', met: 7 },
  { id: 'elliptical', label: 'Elliptical / cardio', emoji: '🫀', met: 5.5 },
  { id: 'dance', label: 'Dance', emoji: '💃', met: 5 },
  { id: 'other', label: 'Other', emoji: '✨', met: 4 },
];
const W_BY_ID = Object.fromEntries(WORKOUTS.map((w) => [w.id, w]));
const INTENSITY = { light: 0.8, moderate: 1, vigorous: 1.25 };
export function estimateBurn(type, minutes, intensity, kg) {
  const met = (W_BY_ID[type]?.met || 4) * (INTENSITY[intensity] || 1);
  return round(met * (kg || 75) * (minutes / 60));
}

const shareDefault = () => { try { return localStorage.getItem('bloom-share-workouts') !== '0'; } catch { return true; } };
export function openWorkoutModal(dateKey, existing) {
  const kg = latestWeight(dateKey) || 75;
  const w = existing || { type: 'strength', minutes: 45, intensity: 'moderate' };
  const dlg = modal(`
  <form class="form" novalidate>
    <h2>${existing ? 'Edit workout' : 'Log a workout'}</h2>
    <div class="chips type-chips" role="group" aria-label="Workout type">${WORKOUTS.map((x) => `<button type="button" class="chip ${x.id === w.type ? 'on' : ''}" data-type="${x.id}" aria-pressed="${x.id === w.type}">${icon(WORKOUT_ICON[x.id], { size: 16 })} ${x.label}</button>`).join('')}</div>
    <div class="row">
      <label class="field"><span>Minutes</span><input name="minutes" type="number" min="1" step="1" inputmode="numeric" value="${w.minutes}" class="w-110"></label>
      <div class="field grow"><span id="intensity-lbl">Intensity</span>
        <div class="seg" data-name="intensity" role="group" aria-labelledby="intensity-lbl">${Object.keys(INTENSITY).map((k) => `<button type="button" data-v="${k}" class="${k === w.intensity ? 'on' : ''}" aria-pressed="${k === w.intensity}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      </div>
    </div>
    <div class="row">
      <label class="field"><span>Calories burned</span><input name="kcal" type="number" min="0" step="1" inputmode="numeric" class="w-110"></label>
      <label class="field grow"><span>Note (optional)</span><input name="note" placeholder="e.g. legs day, 5k" value="${esc(w.note || '')}"></label>
    </div>
    <p class="hint" data-hint aria-live="polite"></p>
    ${store.social ? `<label class="check-row share-row"><input type="checkbox" name="share" ${(existing ? existing.share !== false : shareDefault()) ? 'checked' : ''}><span>Share to my feed <small class="muted">(friends see the type, time, calories and note)</small></span></label>` : ''}
    <div class="dlg-actions">
      ${existing ? '<button type="button" class="btn ghost danger" data-delete>Delete</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn ghost" data-cancel>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
  </form>`);
  const form = dlg.querySelector('form');
  let type = w.type, kcalTouched = !!existing?.kcalManual;
  form.kcal.value = existing?.kcal ?? '';
  const intensity = () => form.querySelector('.seg .on')?.dataset.v || 'moderate';
  const recalc = () => {
    const est = estimateBurn(type, +form.minutes.value || 0, intensity(), kg);
    if (!kcalTouched) form.kcal.value = est;
    form.querySelector('[data-hint]').textContent = `Estimate: ~${est} kcal from activity type, time, intensity and your weight (${toDisplayWeight(kg)} ${weightUnit()}). Edit it if your watch says otherwise.`;
  };
  recalc();
  form.addEventListener('click', (e) => {
    const c = e.target.closest('[data-type]');
    if (c) { type = c.dataset.type; form.querySelectorAll('[data-type]').forEach((b) => { b.classList.toggle('on', b === c); b.setAttribute('aria-pressed', b === c); }); recalc(); }
    const s = e.target.closest('.seg button');
    if (s) { form.querySelectorAll('.seg button').forEach((b) => { b.classList.toggle('on', b === s); b.setAttribute('aria-pressed', b === s); }); recalc(); }
  });
  form.minutes.addEventListener('input', recalc);
  form.kcal.addEventListener('input', () => { kcalTouched = true; });
  form.querySelector('[data-cancel]').onclick = () => dlg.close();
  const list = () => [...workoutsOn(dateKey)];
  form.querySelector('[data-delete]')?.addEventListener('click', () => {
    store.saveDay(dateKey, { workouts: list().filter((x) => x.id !== existing.id) });
    dlg.close(); emit('health');
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const minutes = +form.minutes.value;
    if (!(minutes > 0)) { form.minutes.focus(); return; }
    const entry = { id: existing?.id || uid('w'), type, minutes, intensity: intensity(), kcal: round(+form.kcal.value || 0), kcalManual: kcalTouched, note: form.note.value.trim() };
    if (form.share) { entry.share = form.share.checked; try { localStorage.setItem('bloom-share-workouts', entry.share ? '1' : '0'); } catch {} }
    entry.loggedAt = existing?.loggedAt || Date.now();
    const ws = list();
    const i = ws.findIndex((x) => x.id === entry.id);
    if (i >= 0) ws[i] = entry; else ws.push(entry);
    const before = workoutsOn(dateKey).length;
    store.saveDay(dateKey, { workouts: ws });
    dlg.close(); emit('health');
    if (ws.length > before) { toast('Nice! Workout logged.'); import('./habits.js').then((m) => m.water()); }
  });
}

/* ---------- Rendering ---------- */
const MOODS = ['😞', '🙁', '😐', '🙂', '😄'];
const MOOD_NAMES = ['Rough', 'Low', 'Okay', 'Good', 'Great'];
const ENERGY = ['🪫', '😴', '🙂', '💪', '⚡'];
const ENERGY_NAMES = ['Drained', 'Tired', 'Okay', 'Strong', 'Energized'];
const SLEEPQ = ['Awful', 'Poor', 'OK', 'Good', 'Great'];

// A 1-5 rating. Each button says its meaning ("Mood: Good, 4 of 5") and whether it's selected.
function scale(name, current, faces, labels, groupLabel) {
  return `<div class="scale" data-field="${name}" role="group" aria-label="${groupLabel}">${faces.map((f, i) => {
    const on = current === i + 1;
    return `<button type="button" class="${on ? 'on' : ''}" data-v="${i + 1}" title="${labels[i]}" aria-pressed="${on}" aria-label="${labels[i]}, ${i + 1} of 5"><span aria-hidden="true">${f}</span></button>`;
  }).join('')}</div>`;
}

function weightCard(key) {
  const d = day(key);
  const cur = d.weight ?? null;
  const last = latestWeight(key);
  const weekAgo = weightSeries(dayKey(addDays(fromKey(key), -10)), dayKey(addDays(fromKey(key), -5))).pop();
  const delta = last && weekAgo ? toDisplayWeight(last) - toDisplayWeight(weekAgo.v) : null;
  const p = S.main.profile;
  const bmi = last && p.heightCm ? num(last / (p.heightCm / 100) ** 2, 1) : null;
  return `<article class="card hcard">
    <header><span class="h-ico">${icon('scale', { size: 18 })}</span><h2>Weight</h2></header>
    <div class="amount big"><input type="number" step="0.1" inputmode="decimal" data-weight value="${weightInputValue(cur)}" placeholder="${last ? toDisplayWeight(last) : weightUnit()}" aria-label="Weight in ${weightUnit()}"><span class="unit">${weightUnit()}</span><button class="add" data-action="save-weight">Save<span class="sr-only"> weight</span></button></div>
    <p class="muted small">${cur ? 'Logged for this day.' : last ? `Last: ${toDisplayWeight(last)} ${weightUnit()}` : 'Weigh in to track your trend.'}
    ${delta != null ? ` · <b class="${delta <= 0 ? 'good-t' : 'warn-t'}">${delta > 0 ? '+' : ''}${num(delta, 1)} ${weightUnit()}</b> vs last week` : ''}${bmi ? ` · BMI ${bmi}` : ''}</p>
  </article>`;
}

export function renderHealth() {
  const key = dayKey(S.viewDate);
  const d = day(key), g = goals();
  const water = d.water || 0;
  const ws = d.workouts || [];
  const burned = sum(ws.map((w) => w.kcal)), mins = sum(ws.map((w) => w.minutes));
  const glasses = Array.from({ length: Math.max(g.water, water) }, (_, i) => `<span class="glass ${i < water ? 'full' : ''}">${icon('droplet', { size: 20 })}</span>`).join('');
  const stepPct = clamp(((d.steps || 0) / (g.steps || 8000)) * 100, 0, 100);
  const sleepPct = clamp(((d.sleep || 0) / (g.sleep || 8)) * 100, 0, 100);
  const metric = units() === 'metric';

  $('#healthView').innerHTML = `
  <div class="hgrid">
    ${weightCard(key)}

    <article class="card hcard">
      <header><span class="h-ico">${icon('moon', { size: 18 })}</span><h2>Sleep</h2><small>goal ${g.sleep} hrs</small></header>
      <div class="amount big"><input type="number" step="0.25" min="0" max="24" inputmode="decimal" data-num="sleep" value="${d.sleep ?? ''}" placeholder="hrs" aria-label="Hours slept"><span class="unit">hrs</span></div>
      <div class="progress" aria-hidden="true"><div style="width:${sleepPct}%"></div></div>
      <div class="field-inline"><span class="muted small" aria-hidden="true">Quality</span>${scale('sleepQ', d.sleepQ, ['1', '2', '3', '4', '5'], SLEEPQ, 'Sleep quality')}</div>
    </article>

    <article class="card hcard">
      <header><span class="h-ico">${icon('droplet', { size: 18 })}</span><h2>Water</h2><small>goal ${g.water} glasses</small></header>
      <div class="water-row"><div class="glasses" aria-hidden="true">${glasses}</div>
        <div class="counter"><button data-action="water-dec" aria-label="One less glass">${icon('minus', { size: 18 })}</button><span aria-live="polite"><span class="sr-only">Water: </span>${water}<span class="sr-only"> of ${g.water} glasses</span></span><button data-action="water-inc" aria-label="One more glass">${icon('plus', { size: 18 })}</button></div></div>
      <p class="muted small">1 glass = 8 oz / 240 ml</p>
    </article>

    <article class="card hcard">
      <header><span class="h-ico">${icon('smile', { size: 18 })}</span><h2>Mood & energy</h2></header>
      <div class="field-inline"><span class="muted small" aria-hidden="true">Mood</span>${scale('mood', d.mood, MOODS, MOOD_NAMES, 'Mood')}</div>
      <div class="field-inline"><span class="muted small" aria-hidden="true">Energy</span>${scale('energy', d.energy, ENERGY, ENERGY_NAMES, 'Energy')}</div>
    </article>

    <article class="card hcard">
      <header><span class="h-ico">${icon('footprints', { size: 18 })}</span><h2>Steps</h2><small>goal ${(g.steps || 8000).toLocaleString()}</small></header>
      <div class="amount big"><input type="number" step="1" min="0" inputmode="numeric" data-num="steps" value="${d.steps ?? ''}" placeholder="steps" aria-label="Steps"><span class="unit">steps</span></div>
      <div class="progress" aria-hidden="true"><div style="width:${stepPct}%"></div></div>
    </article>

    <article class="card hcard wide">
      <header><span class="h-ico">${icon('dumbbell', { size: 18 })}</span><h2>Workouts</h2><small>${ws.length ? `${mins} min · ~${burned} kcal burned` : ''}</small>
        <button class="btn small primary push" data-action="add-workout">${icon('plus', { size: 16 })}Log workout</button></header>
      ${ws.length ? `<ul class="wlist">${ws.map((w) => `<li data-wid="${w.id}"><span class="w-ico">${icon(WORKOUT_ICON[w.type] || 'sparkles', { size: 20 })}</span>
        <span class="w-main"><b>${W_BY_ID[w.type]?.label || 'Workout'}</b> <span class="muted">${w.minutes} min · ${w.intensity}${w.note ? ' · ' + esc(w.note) : ''}</span></span>
        <span class="w-kcal">${w.kcal} kcal</span><button class="icon-btn" data-action="edit-workout" aria-label="Edit ${esc(W_BY_ID[w.type]?.label || 'workout')}, ${w.minutes} minutes">${icon('pencil', { size: 18 })}</button></li>`).join('')}</ul>`
    : '<p class="muted small">Nothing logged yet. Walks count too!</p>'}
    </article>

    <article class="card hcard">
      <header><span class="h-ico">${icon('ruler', { size: 18 })}</span><h2>Body</h2><small>optional</small></header>
      <div class="mini-fields">
        <label><span>Body fat %</span><input type="number" step="0.1" data-num="bodyFat" value="${d.bodyFat ?? ''}" inputmode="decimal"></label>
        <label><span>Waist (${metric ? 'cm' : 'in'})</span><input type="number" step="0.1" data-waist value="${d.waistCm != null ? num(metric ? d.waistCm : cmToIn(d.waistCm), 1) : ''}" inputmode="decimal"></label>
        <label><span>Resting HR</span><input type="number" step="1" data-num="rhr" value="${d.rhr ?? ''}" inputmode="numeric"></label>
      </div>
    </article>

    <article class="card hcard wide">
      <header><span class="h-ico">${icon('notebook-pen', { size: 18 })}</span><h2 id="journal-h">Journal</h2><small data-saved aria-live="polite"></small></header>
      <textarea data-notes rows="3" aria-labelledby="journal-h" placeholder="How did today go? Anything you want to remember?">${esc(d.notes || '')}</textarea>
    </article>
  </div>`;
}

export function bindHealth() {
  const root = $('#healthView');
  const key = () => dayKey(S.viewDate);
  const save = (partial, react = true) => {
    const snap = S.main.tasks.filter((t) => t.source);
    store.saveDay(key(), partial);
    emit('health');
    if (react && snap.length) import('./habits.js').then((m) => m.say?.('Thanks for checking in! 🌱'));
  };
  root.addEventListener('click', (e) => {
    const s = e.target.closest('.scale button');
    if (s) {
      const field = s.parentElement.dataset.field, v = +s.dataset.v;
      save({ [field]: day(key())[field] === v ? null : v }, false);
      return;
    }
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const d = day(key());
    switch (b.dataset.action) {
      case 'water-inc': save({ water: (d.water || 0) + 1 }, false); import('./habits.js').then((m) => m.water()); break;
      case 'water-dec': save({ water: Math.max(0, (d.water || 0) - 1) }, false); break;
      case 'save-weight': {
        const v = parseFloat(root.querySelector('[data-weight]').value);
        if (!isFinite(v) || v <= 0) return root.querySelector('[data-weight]').focus();
        saveWeightFromInput(v, key()); emit('health'); toast('Weight saved'); break;
      }
      case 'add-workout': openWorkoutModal(key()); break;
      case 'edit-workout': {
        const id = b.closest('[data-wid]').dataset.wid;
        openWorkoutModal(key(), (d.workouts || []).find((w) => w.id === id)); break;
      }
    }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-num]')) { const v = t.value === '' ? null : num(+t.value, 2); save({ [t.dataset.num]: v }); }
    if (t.matches('[data-waist]')) { const v = t.value === '' ? null : num(units() === 'metric' ? +t.value : inToCm(+t.value), 1); save({ waistCm: v }, false); }
    if (t.matches('[data-notes]')) { save({ notes: t.value }, false); }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-weight]')) root.querySelector('[data-action="save-weight"]').click();
    if (e.key === 'Enter' && e.target.matches('input[data-num], input[data-waist]')) e.target.blur();
  });
}

/* Today tab: flower + habits (manual or auto-tracked from food/health logs). */
import { S, store, emit, SOURCES, goals } from './state.js';
import {
  $, esc, clamp, avg, num, uid, dayKey, startOfDay, addDays, periodStart, nextPeriodStart, prevPeriodStart,
  periodLength, periodKey, daysInPeriod, fmtShort, isToday, modal, toast, todayKey,
} from './util.js';
import { flowerSVG, stageOf, STAGE_LABEL, MESSAGES, pick, mix3 } from './flower.js';
import { openMealModal } from './food.js';
import { icon } from './icons.js';
import { openWorkoutModal, weightInputValue, saveWeightFromInput, weightUnit } from './health.js';

/* ================= Values & scoring ================= */
const GOAL_KEY = { calories: 'calories', protein: 'protein', water: 'water', sleep: 'sleep', steps: 'steps' };
/** Effective target: auto-tracked habits can follow your daily targets from Settings. */
export const tgt = (t) => (t.useGoal && GOAL_KEY[t.source] ? goals()[GOAL_KEY[t.source]] : t.target);
export function valueFor(t, ref) {
  if (t.source && SOURCES[t.source]) {
    const src = SOURCES[t.source];
    const today = todayKey();
    return num(daysInPeriod(t.period, ref).map(dayKey).filter((k) => k <= today).reduce((a, k) => a + (src.day(k) || 0), 0), 1);
  }
  return S.main.logs?.[t.id]?.[periodKey(t.period, ref)] ?? 0;
}
const needsLog = (t) => t.source && SOURCES[t.source]?.requireLog;
export function passed(t, v) {
  if (needsLog(t) && !v) return false;
  if (t.type === 'check') return v >= 1;
  if (t.type === 'atLeast') return v >= tgt(t);
  return v < tgt(t);
}
/** 0..1 — how the habit is going for the period containing `ref`, judged at `now`. */
export function scoreFor(t, ref, now = new Date()) {
  const ps = periodStart(t.period, ref);
  const ended = nextPeriodStart(t.period, ps) <= startOfDay(now);
  const v = valueFor(t, ref);
  if (ended) return passed(t, v) ? 1 : 0;
  if (t.period === 'day') {
    if (needsLog(t) && !v) return 0.5;
    if (t.type === 'check') return v >= 1 ? 1 : 0.5;
    if (t.type === 'atLeast') return Math.min(1, 0.5 + 0.5 * v / tgt(t));
    return v < tgt(t) ? 1 : 0;
  }
  const len = periodLength(t.period, ps);
  const el = Math.round((startOfDay(now) - ps) / 86400000) + 1;
  if (t.type === 'check') return v >= 1 ? 1 : 1 - 0.6 * ((el - 1) / len);
  if (t.type === 'atLeast') {
    if (v >= tgt(t)) return 1;
    const e = (el - 1) / len;
    return e === 0 ? 1 : clamp((v / tgt(t)) / e, 0, 1);
  }
  if (v >= tgt(t)) return 0;
  const r = v / tgt(t), e = el / len;
  return r <= e ? 1 : clamp(1 - 0.6 * (r - e) / (1 - e + 1e-6), 0.4, 1);
}

export function flowerHealth(now = new Date()) {
  const tasks = S.main.tasks;
  if (!tasks.length) return 0.6;
  const cur = avg(tasks.map((t) => scoreFor(t, now, now)));
  const daily = tasks.filter((t) => t.period === 'day');
  let w = 0, s = 0;
  for (let i = 1; i <= 6; i++) {
    const d = addDays(startOfDay(now), -i), end = addDays(d, 1).getTime();
    const ts = daily.filter((t) => (t.createdAt || 0) < end);
    if (!ts.length) continue;
    const wt = 7 - i;
    s += wt * avg(ts.map((t) => (passed(t, valueFor(t, d)) ? 1 : 0)));
    w += wt;
  }
  return w ? 0.55 * cur + 0.45 * (s / w) : cur;
}

/* ================= Formatting ================= */
const unitOf = (t) => (t.source ? SOURCES[t.source]?.unit || '' : t.unit || '');
function fmtAmt(t, n) {
  const u = unitOf(t);
  if (!u) return `${num(n)}`;
  if (u === '$') return `$${num(n).toLocaleString()}`;
  return `${num(n).toLocaleString()} ${u}`;
}
export function describeTask(t) {
  if (t.type === 'check') return t.period === 'day' ? 'Every day' : `Once a ${t.period}`;
  const amt = unitOf(t) ? fmtAmt(t, tgt(t)) : `${num(tgt(t))}×`;
  return `${t.type === 'atLeast' ? 'At least' : 'Less than'} ${amt} ${t.period === 'day' ? 'a day' : 'per ' + t.period}`;
}
function statusOf(t, v, ref) {
  const ps = periodStart(t.period, ref);
  const ended = nextPeriodStart(t.period, ps) <= startOfDay(new Date());
  if (ended) return passed(t, v) ? ['Passed ✓', 'good', 'done'] : [needsLog(t) && !v ? 'Not logged' : 'Missed', 'bad', 'bad'];
  const sc = scoreFor(t, ref);
  if (t.type === 'check') return v >= 1 ? ['Done ✓', 'good', 'done'] : ['To do', '', ''];
  if (needsLog(t) && !v) return ['Not logged yet', '', ''];
  if (t.type === 'atLeast') {
    if (v >= tgt(t)) return ['Goal hit 🎉', 'good', 'done'];
    if (t.period === 'day') return [`${fmtAmt(t, tgt(t) - v)} to go`, '', ''];
    return sc >= 0.8 ? ['On track', 'good', 'good'] : ['Behind', 'warn', ''];
  }
  if (v >= tgt(t)) return ['Over limit', 'bad', 'bad'];
  return sc >= 1 ? ['Under limit', 'good', 'good'] : ['Careful', 'warn', ''];
}

/* ================= Garden ================= */
let lastStage = null;
export const say = (msg) => { const b = $('#bubble'); if (b) b.textContent = msg; };
export function water() {
  const wrap = $('#flowerWrap'), drops = $('#drops');
  if (!wrap) return;
  for (let i = 0; i < 7; i++) {
    const d = document.createElement('span');
    d.style.left = 60 + Math.random() * 80 + 'px';
    d.style.animationDelay = i * 70 + 'ms';
    drops.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }
  wrap.classList.remove('bounce'); void wrap.offsetWidth; wrap.classList.add('bounce');
  say(pick(MESSAGES.water));
}
export function updateGarden(h) {
  const pct = Math.round(h * 100);
  const fill = $('#meterFill');
  if (!fill) return;
  fill.style.width = pct + '%';
  fill.style.background = h >= 0.55 ? 'var(--brand)' : h >= 0.3 ? 'var(--warn)' : 'var(--bad)';
  $('#pct').textContent = pct + '% watered';
  const st = S.main.tasks.length ? stageOf(h) : 'happy';
  $('#stage').textContent = STAGE_LABEL[st];
  if (!S.main.tasks.length) { say(MESSAGES.empty[0]); lastStage = null; return; }
  if (st !== lastStage) { say(pick(MESSAGES[st])); lastStage = st; }
  const ni = $('#flowerName');
  if (ni && document.activeElement !== ni) ni.value = S.main.settings.flowerName || 'Bloom';
}
export const resetStage = () => { lastStage = null; };

/* ================= Rendering ================= */
const PERIODS = ['day', 'week', 'month'];
function periodHeading(p, ref) {
  const now = new Date();
  const s = periodStart(p, ref), cur = periodStart(p, now).getTime() === s.getTime();
  const len = periodLength(p, s);
  const left = len - (Math.round((startOfDay(now) - s) / 86400000) + 1) + 1;
  const leftTxt = cur && p !== 'day' ? ` · ${left} day${left === 1 ? '' : 's'} left` : '';
  if (p === 'day') return [isToday(ref) ? 'Today' : 'That day', ref.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })];
  if (p === 'week') return [cur ? 'This week' : 'That week', `${fmtShort(s)} – ${fmtShort(addDays(s, 6))}${leftTxt}`];
  return [cur ? 'This month' : 'That month', `${s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}${leftTxt}`];
}

function historyDots(t, ref) {
  const created = t.createdAt || 0;
  let cur = periodStart(t.period, ref);
  const dots = [];
  let ok = 0, miss = 0;
  for (let i = 0; i < 6; i++) {
    const prev = prevPeriodStart(t.period, cur);
    const label = t.period === 'day' ? prev.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      : t.period === 'week' ? `Week of ${fmtShort(prev)}` : prev.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (cur.getTime() <= created) dots.unshift(`<i class="dot" title="${label}: not tracked yet"></i>`);
    else {
      const v = valueFor(t, prev), pass = passed(t, v);
      if (pass) ok++; else miss++;
      dots.unshift(`<i class="dot ${pass ? 'ok' : 'miss'}" title="${label}: ${t.type === 'check' ? (v ? 'done' : 'missed') : fmtAmt(t, v)}"></i>`);
    }
    cur = prev;
  }
  const v = valueFor(t, ref);
  dots.push(`<i class="dot now ${t.type !== 'under' && passed(t, v) ? 'ok' : ''}" title="Current period"></i>`);
  const unit = { day: 'days', week: 'weeks', month: 'months' }[t.period];
  const summary = ok + miss ? `Last ${ok + miss} ${unit}: ${ok} passed, ${miss} missed` : 'No history yet';
  return `<span class="sr-only">${summary}</span><span class="dots" aria-hidden="true">${dots.join('')}</span>`;
}

function controlsFor(t, v) {
  if (t.source) {
    const src = SOURCES[t.source];
    switch (t.source) {
      case 'water': return `<div class="counter"><button data-action="src-dec" aria-label="One less glass">${icon('minus', { size: 18 })}</button><span aria-live="polite">${num(S.days[dayKey(S.viewDate)]?.water || 0)}<span class="sr-only"> glasses</span></span><button data-action="src-inc" aria-label="One more glass">${icon('plus', { size: 18 })}</button></div>`;
      case 'sleep': case 'steps': return `<div class="amount"><input type="number" step="any" inputmode="decimal" placeholder="${src.unit}" aria-label="${src.label}"><button class="add" data-action="src-set">Set<span class="sr-only"> ${src.label.toLowerCase()}</span></button></div>`;
      case 'weighins': return `<div class="amount"><input type="number" step="0.1" inputmode="decimal" placeholder="${weightUnit()}" aria-label="Weight"><button class="add" data-action="src-weight">Save<span class="sr-only"> weight</span></button></div>`;
      case 'workouts': case 'activeMin': return `<button class="btn small" data-action="src-workout">${icon('plus', { size: 16 })}Log workout</button>`;
      default: return `<button class="btn small" data-action="src-meal">${icon('plus', { size: 16 })}Log meal</button>`;
    }
  }
  if (t.type === 'check') return '';
  return t.unit
    ? `<div class="amount"><input type="number" step="any" inputmode="decimal" placeholder="${t.unit === '$' ? '$' : esc(t.unit)}" aria-label="Amount for ${esc(t.name)}"><button class="add" data-action="add">Add</button><button data-action="set" aria-label="Set total (replaces it)">Set</button></div>`
    : `<div class="counter"><button data-action="dec" aria-label="${esc(t.name)}: minus one">${icon('minus', { size: 18 })}</button><span aria-live="polite">${num(v)}</span><button data-action="inc" aria-label="${esc(t.name)}: plus one">${icon('plus', { size: 18 })}</button></div>`;
}

function taskHTML(t, ref) {
  const v = valueFor(t, ref);
  const [label, cls, cardCls] = statusOf(t, v, ref);
  const checkBtn = t.type === 'check' && !t.source ? `<button class="check ${v >= 1 ? 'on' : ''}" data-action="toggle" aria-pressed="${v >= 1}" aria-label="${esc(t.name)} done">${icon('check', { size: 22, stroke: 3 })}</button>` : '';
  let progress = '';
  if (t.type !== 'check') {
    const pct = clamp((v / tgt(t)) * 100, 0, 100);
    const pcls = t.type === 'under' ? (v >= tgt(t) ? 'bad' : cls === 'warn' ? 'warn' : '') : '';
    const amt = t.type === 'atLeast' ? `${fmtAmt(t, v)} / ${fmtAmt(t, tgt(t))}` : `${fmtAmt(t, v)} of ${fmtAmt(t, tgt(t))}`;
    progress = `<div class="progress-row"><div class="progress ${pcls}" aria-hidden="true"><div style="width:${pct}%"></div></div><span class="amt">${amt}</span></div>`;
  }
  const auto = t.source ? `<span class="auto-tag" title="Filled in automatically from your ${SOURCES[t.source].tab === 'food' ? 'food log' : 'health log'}">${icon('zap', { size: 12 })} auto<span class="sr-only">-tracked</span></span>` : '';
  return `
  <article class="task card ${cardCls}" data-id="${t.id}">
    <div class="task-main">
      <div class="task-emoji" aria-hidden="true">${esc(t.emoji || '🌱')}</div>
      <div class="task-text">
        <h4 class="task-name">${esc(t.name)}</h4>
        <div class="task-desc">${esc(describeTask(t))} ${auto} <span class="status ${cls}">${label}</span></div>
      </div>
      ${checkBtn}
      <button class="icon-btn" data-action="edit" aria-label="Edit ${esc(t.name)}">${icon('pencil', { size: 18 })}</button>
    </div>
    ${progress}
    <div class="task-foot"><div class="history">${historyDots(t, ref)}</div><div class="controls">${controlsFor(t, v)}</div></div>
  </article>`;
}

export function renderToday() {
  const el = $('#sections');
  const ref = S.viewDate;
  if (!S.main.tasks.length) {
    el.innerHTML = `<div class="card empty"><p>No habits yet. Pick a starter or make your own.</p><div class="chips" style="justify-content:center">${templateChips()}</div></div>`;
    return;
  }
  el.innerHTML = PERIODS.map((p) => {
    const ts = S.main.tasks.filter((t) => t.period === p);
    if (!ts.length) return '';
    const [h, sub] = periodHeading(p, ref);
    return `<section class="period"><div class="period-head"><h3>${h}</h3><small>${sub}</small></div><div class="tasks">${ts.map((t) => taskHTML(t, ref)).join('')}</div></section>`;
  }).join('');
}

/* ================= Logging ================= */
function setManual(t, newVal) {
  const ref = S.viewDate, key = periodKey(t.period, ref);
  const oldVal = valueFor(t, ref), before = scoreFor(t, ref);
  newVal = Math.max(0, num(newVal));
  (S.main.logs[t.id] ??= {})[key] = newVal;
  store.setLog(t.id, key, newVal);
  emit('habits');
  reactTo(t, oldVal, newVal, before);
}
export function reactTo(t, oldVal, newVal, before) {
  const after = scoreFor(t, S.viewDate);
  if (t.type === 'under') { if (after < before) say(pick(MESSAGES.ouch)); }
  else if (newVal > oldVal) water();
}

/** Run a change to food/health data and let the flower react if an auto-tracked habit moved. */
export function reactAround(fn, ref = S.viewDate) {
  const snap = S.main.tasks.filter((t) => t.source).map((t) => [t, valueFor(t, ref), scoreFor(t, ref)]);
  fn();
  let reacted = false;
  for (const [t, o, b] of snap) {
    const n = valueFor(t, ref);
    if (n !== o) { reactTo(t, o, n, b); reacted = true; break; }
  }
  return reacted;
}
function setDayField(field, value) {
  reactAround(() => { store.saveDay(dayKey(S.viewDate), { [field]: value }); emit('health'); });
}

export function bindToday() {
  const el = $('#sections');
  el.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-template]');
    if (chip) { openTaskDialog(null, TEMPLATES()[+chip.dataset.template]); return; }
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const card = b.closest('[data-id]');
    const t = S.main.tasks.find((x) => x.id === card?.dataset.id);
    if (!t) return;
    const v = valueFor(t, S.viewDate);
    const input = card.querySelector('.amount input');
    const n = input ? parseFloat(input.value) : NaN;
    switch (b.dataset.action) {
      case 'toggle': setManual(t, v >= 1 ? 0 : 1); break;
      case 'inc': setManual(t, v + 1); break;
      case 'dec': if (v > 0) setManual(t, v - 1); break;
      case 'add': case 'set':
        if (!isFinite(n)) { input.focus(); return; }
        setManual(t, b.dataset.action === 'add' ? v + n : n); break;
      case 'edit': openTaskDialog(t); break;
      case 'src-inc': case 'src-dec': {
        const w = S.days[dayKey(S.viewDate)]?.water || 0;
        setDayField('water', Math.max(0, w + (b.dataset.action === 'src-inc' ? 1 : -1))); break;
      }
      case 'src-set': if (!isFinite(n)) { input.focus(); return; } setDayField(t.source, num(n)); break;
      case 'src-weight': if (!isFinite(n)) { input.focus(); return; } saveWeightFromInput(n, dayKey(S.viewDate)); emit('health'); water(); break;
      case 'src-workout': openWorkoutModal(dayKey(S.viewDate)); break;
      case 'src-meal': openMealModal({ date: dayKey(S.viewDate) }); break;
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.amount input')) e.target.parentElement.querySelector('button.add')?.click();
  });
  const ni = $('#flowerName');
  ni.addEventListener('change', () => {
    S.main.settings.flowerName = ni.value.trim() || 'Bloom';
    ni.value = S.main.settings.flowerName;
    store.saveMain({ settings: S.main.settings });
  });
  ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') ni.blur(); });
  $('#addBtn').onclick = () => openTaskDialog(null);
}

/* ================= Add / edit dialog ================= */
const TEMPLATES = () => {
  const g = goals();
  return [
    { emoji: '🏋️', name: 'Work out', period: 'week', type: 'atLeast', target: 3, source: 'workouts' },
    { emoji: '🍔', name: 'Eat out', period: 'week', type: 'under', target: 5, unit: '' },
    { emoji: '💸', name: 'Spending', period: 'month', type: 'under', target: 500, unit: '$' },
    { emoji: '📱', name: 'Phone screen time', period: 'day', type: 'under', target: 3, unit: 'hrs' },
    { emoji: '🌿', name: 'Touch grass', period: 'day', type: 'check', target: 1 },
    { emoji: '👯', name: 'Hang out with friends', period: 'week', type: 'check', target: 1 },
    { emoji: '💧', name: 'Drink water', period: 'day', type: 'atLeast', target: g.water || 8, source: 'water', useGoal: true },
    { emoji: '🥩', name: 'Hit protein goal', period: 'day', type: 'atLeast', target: g.protein, source: 'protein', useGoal: true },
    { emoji: '🍽️', name: 'Stay under calorie goal', period: 'day', type: 'under', target: g.calories, source: 'calories', useGoal: true },
    { emoji: '😴', name: 'Sleep 7+ hours', period: 'day', type: 'atLeast', target: 7, source: 'sleep' },
    { emoji: '👟', name: 'Walk 8k steps', period: 'day', type: 'atLeast', target: g.steps || 8000, source: 'steps', useGoal: true },
    { emoji: '📸', name: 'Log my meals', period: 'day', type: 'atLeast', target: 3, source: 'meals' },
    { emoji: '⚖️', name: 'Weigh in', period: 'week', type: 'atLeast', target: 1, source: 'weighins' },
    { emoji: '📚', name: 'Read', period: 'week', type: 'atLeast', target: 3, unit: 'hrs' },
  ];
};
const templateChips = () => TEMPLATES().map((t, i) => `<button type="button" class="chip" data-template="${i}">${t.emoji} ${esc(t.name)}</button>`).join('');
const SOURCE_DEFAULTS = (src) => {
  const g = goals();
  return ({
    calories: { type: 'under', target: g.calories, period: 'day' }, protein: { type: 'atLeast', target: g.protein, period: 'day' },
    meals: { type: 'atLeast', target: 3, period: 'day' }, water: { type: 'atLeast', target: g.water, period: 'day' },
    sleep: { type: 'atLeast', target: g.sleep, period: 'day' }, steps: { type: 'atLeast', target: g.steps, period: 'day' },
    workouts: { type: 'atLeast', target: 3, period: 'week' }, activeMin: { type: 'atLeast', target: 150, period: 'week' },
    weighins: { type: 'atLeast', target: 1, period: 'week' },
  })[src];
};

export function openTaskDialog(task, template) {
  const dlg = modal(`
  <form class="form" id="taskForm" novalidate>
    <h3>${task ? 'Edit habit' : 'New habit'}</h3>
    ${task ? '' : `<div class="chips">${templateChips()}</div>`}
    <div class="row">
      <label class="field emoji-field"><span>Icon</span><input name="emoji" maxlength="4"></label>
      <label class="field grow"><span>Name</span><input name="name" placeholder="e.g. Work out" autocomplete="off"></label>
    </div>
    <label class="field"><span>Track with</span>
      <select name="source">
        <option value="">Manual: I'll check it off myself</option>
        <optgroup label="Automatic, from your logs">
          ${Object.entries(SOURCES).map(([k, s]) => `<option value="${k}">${s.label}${s.tab === 'food' ? ' (Food)' : ' (Health)'}</option>`).join('')}
        </optgroup>
      </select>
    </label>
    <div class="field"><span>How often</span>
      <div class="seg" data-name="period"><button type="button" data-v="day">Daily</button><button type="button" data-v="week">Weekly</button><button type="button" data-v="month">Monthly</button></div>
    </div>
    <div class="field"><span>Goal type</span>
      <div class="seg" data-name="type"><button type="button" data-v="check">Check off</button><button type="button" data-v="atLeast">At least</button><button type="button" data-v="under">Less than</button></div>
    </div>
    <div class="row" data-target-row>
      <label class="field"><span>Amount</span><input name="target" type="number" min="0" step="any" inputmode="decimal" class="w-110"></label>
      <label class="field grow"><span>Unit (optional)</span><input name="unit" placeholder="blank = times · $ · hrs · glasses" list="unitList" autocomplete="off"></label>
      <datalist id="unitList"><option value="$"></option><option value="hrs"></option><option value="mins"></option><option value="glasses"></option><option value="miles"></option><option value="pages"></option></datalist>
    </div>
    <label class="check-row" data-usegoal-row hidden><input type="checkbox" name="useGoal"> <span data-usegoal-label>Follow my daily target from Settings</span></label>
    <p class="preview" data-preview></p>
    <p class="form-error" data-error></p>
    <div class="dlg-actions">
      ${task ? '<button type="button" class="btn ghost danger" data-delete>Delete</button>' : ''}
      <span class="spacer"></span>
      <button type="button" class="btn ghost" data-cancel>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
  </form>`);
  const form = dlg.querySelector('form');
  const segVal = (n) => form.querySelector(`.seg[data-name="${n}"] .on`)?.dataset.v;
  const setSeg = (n, v) => form.querySelectorAll(`.seg[data-name="${n}"] button`).forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  const read = () => {
    let unit = form.unit.value.trim();
    if (/^(times?|x|×)$/i.test(unit)) unit = '';
    const source = form.source.value || null;
    const type = segVal('type');
    return {
      emoji: form.emoji.value.trim() || '🌱', name: form.name.value.trim(), period: segVal('period'), type,
      target: type === 'check' ? 1 : parseFloat(form.target.value), unit: type === 'check' || source ? '' : unit, source,
      useGoal: !!(source && GOAL_KEY[source] && form.useGoal.checked),
    };
  };
  const sync = () => {
    const f = read();
    const src = f.source && SOURCES[f.source];
    form.querySelector('[data-target-row]').hidden = f.type === 'check';
    form.unit.disabled = !!src;
    const gk = f.source && GOAL_KEY[f.source];
    form.querySelector('[data-usegoal-row]').hidden = !gk || f.type === 'check';
    if (gk) form.querySelector('[data-usegoal-label]').textContent = `Follow my daily ${gk} target from Settings (currently ${goals()[gk].toLocaleString()} ${src.unit})`;
    form.target.disabled = !!(gk && form.useGoal.checked);
    if (gk && form.useGoal.checked) form.target.value = goals()[gk];
    if (src) form.unit.value = src.unit;
    form.querySelector('.seg[data-name="type"] [data-v="check"]').disabled = !!src;
    ['week', 'month'].forEach((p) => { form.querySelector(`.seg[data-name="period"] [data-v="${p}"]`).disabled = !!src?.dailyOnly; });
    const ok = f.type === 'check' || (isFinite(f.target) && f.target > 0);
    form.querySelector('[data-preview]').textContent = `${f.emoji} ${f.name || 'Your habit'}: ${ok ? describeTask(f).toLowerCase() : '…'}${src ? ` · tracked automatically from your ${src.tab === 'food' ? 'food log' : 'health log'}` : ''}`;
  };
  const fill = (t) => {
    form.emoji.value = t.emoji || '🌱';
    form.name.value = t.name || '';
    form.source.value = t.source || '';
    setSeg('period', t.period || 'day');
    setSeg('type', t.type || 'check');
    form.target.value = t.type === 'check' ? 3 : t.target ?? 3;
    form.unit.value = t.unit || '';
    form.useGoal.checked = !!t.useGoal;
    sync();
  };
  fill(task || template || { emoji: '🌱', period: 'day', type: 'check' });
  if (!template && !task) setTimeout(() => form.name.focus(), 30);

  form.addEventListener('click', (e) => {
    const sb = e.target.closest('.seg button');
    if (sb && !sb.disabled) { setSeg(sb.parentElement.dataset.name, sb.dataset.v); sync(); }
    const chip = e.target.closest('[data-template]');
    if (chip) fill(TEMPLATES()[+chip.dataset.template]);
  });
  form.source.addEventListener('change', () => {
    const d = SOURCE_DEFAULTS(form.source.value);
    if (d) { setSeg('type', d.type); setSeg('period', d.period); form.target.value = d.target; form.useGoal.checked = !!GOAL_KEY[form.source.value]; if (!form.name.value) form.name.value = SOURCES[form.source.value].label; }
    sync();
  });
  form.addEventListener('input', sync);
  form.querySelector('[data-cancel]').onclick = () => dlg.close();
  let armed = false;
  const del = form.querySelector('[data-delete]');
  if (del) del.onclick = () => {
    if (!armed) { armed = true; del.textContent = 'Tap again to delete'; return; }
    S.main.tasks = S.main.tasks.filter((t) => t.id !== task.id);
    delete S.main.logs[task.id];
    store.saveMain({ tasks: S.main.tasks });
    store.deleteLogs(task.id);
    dlg.close(); emit('habits');
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = read(), err = form.querySelector('[data-error]');
    if (!f.name) { err.textContent = 'Give it a name.'; return; }
    if (f.useGoal) f.target = goals()[GOAL_KEY[f.source]];
    if (f.type !== 'check' && !(f.target > 0)) { err.textContent = 'Amount must be more than 0.'; return; }
    if (task) Object.assign(task, f);
    else S.main.tasks.push({ id: uid('t'), ...f, createdAt: Date.now() });
    store.saveMain({ tasks: S.main.tasks });
    dlg.close(); emit('habits');
    if (!task) toast(`Planted “${f.name}” 🌱`);
  });
}

export { flowerSVG };

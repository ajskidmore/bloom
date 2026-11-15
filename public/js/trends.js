/* Trends tab: stat tiles + simple single-series SVG charts with hover tooltips. */
import { S, goals, dayTotals, day, lastNDays, workoutsOn, fromKey } from './state.js';
import { $, esc, num, round, avg, sum, fmtShort, periodStart, prevPeriodStart, nextPeriodStart, startOfDay, addDays } from './util.js';
import { toDisplayWeight, weightUnit } from './health.js';
import { valueFor, passed } from './habits.js';

let range = 30;
const charts = new Map();

/* ---------- chart primitives ---------- */
const W = 640, H = 190, PL = 44, PR = 12, PT = 14, PB = 26;
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function axisLabels(keys) {
  const n = keys.length, step = Math.max(1, Math.ceil(n / 7));
  const xw = (W - PL - PR) / n;
  return keys.map((k, i) => (i % step === 0 || i === n - 1) && !(i !== n - 1 && n - 1 - i < step * 0.6)
    ? `<text x="${PL + xw * (i + 0.5)}" y="${H - 8}" text-anchor="middle" class="ax">${fmtShort(fromKey(k))}</text>` : '').join('');
}
function grid(min, max, fmt) {
  let out = '';
  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) * i) / 3, y = PT + (H - PT - PB) * (1 - i / 3);
    out += `<line x1="${PL}" x2="${W - PR}" y1="${y}" y2="${y}" class="gl"/><text x="${PL - 6}" y="${y + 4}" text-anchor="end" class="ax">${fmt(v)}</text>`;
  }
  return out;
}

function barChart(id, { keys, values, goal, fmt = (v) => round(v).toLocaleString(), unit = '' }) {
  const vmax = Math.max(...values.filter((v) => v != null), goal || 0);
  const max = niceMax(vmax * 1.08), n = keys.length;
  const xw = (W - PL - PR) / n, bw = Math.max(2, Math.min(28, xw - 2));
  const y = (v) => PT + (H - PT - PB) * (1 - v / max);
  const r = Math.min(4, bw / 2);
  const bars = values.map((v, i) => {
    if (v == null || v <= 0) return '';
    const x = PL + xw * i + (xw - bw) / 2, top = y(v), base = y(0), h = base - top;
    const rr = Math.min(r, h);
    return `<path class="bar" data-i="${i}" d="M${x} ${base} V${top + rr} Q${x} ${top} ${x + rr} ${top} H${x + bw - rr} Q${x + bw} ${top} ${x + bw} ${top + rr} V${base} Z"/>`;
  }).join('');
  const goalLine = goal ? `<line x1="${PL}" x2="${W - PR}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/><text x="${W - PR}" y="${y(goal) - 5}" text-anchor="end" class="goal-t">goal ${fmt(goal)}</text>` : '';
  charts.set(id, { keys, rows: values.map((v) => [v == null ? '—' : fmt(v) + (unit ? ' ' + unit : '')]), kind: 'bar', xw });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" data-chart="${id}" role="img">${grid(0, max, fmt)}${goalLine}${bars}${axisLabels(keys)}<line class="xh" x1="0" x2="0" y1="${PT}" y2="${H - PB}" visibility="hidden"/></svg>`;
}

function lineChart(id, { keys, values, fmt = (v) => num(v, 1), unit = '', domain }) {
  const vals = values.filter((v) => v != null);
  let lo = domain ? domain[0] : Math.min(...vals), hi = domain ? domain[1] : Math.max(...vals);
  if (!domain) { const pad = Math.max((hi - lo) * 0.2, 1); lo = Math.floor(lo - pad); hi = Math.ceil(hi + pad); }
  const n = keys.length, xw = (W - PL - PR) / n;
  const x = (i) => PL + xw * (i + 0.5), y = (v) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo || 1));
  let d = '', pen = false;
  values.forEach((v, i) => { if (v == null) return; d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; pen = true; });
  const dots = values.map((v, i) => (v == null ? '' : `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${n > 45 ? 2.5 : 4}"/>`)).join('');
  charts.set(id, { keys, rows: values.map((v) => [v == null ? '—' : fmt(v) + (unit ? ' ' + unit : '')]), kind: 'line', xw });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" data-chart="${id}" role="img">${grid(lo, hi, fmt)}<path d="${d}" class="ln"/>${dots}${axisLabels(keys)}<line class="xh" x1="0" x2="0" y1="${PT}" y2="${H - PB}" visibility="hidden"/></svg>`;
}

function chartCard(title, sub, svg, empty) {
  return `<article class="card chart-card"><header><h3>${title}</h3><small>${sub || ''}</small></header>
    ${empty ? `<p class="muted small chart-empty">${empty}</p>` : `<div class="chart-wrap">${svg}<div class="tip" hidden></div></div>`}</article>`;
}

/* ---------- tab ---------- */
export function renderTrends() {
  charts.clear();
  const keys = lastNDays(range);
  const g = goals();
  const tot = keys.map((k) => dayTotals(k));
  const logged = tot.map((t, i) => [t, keys[i]]).filter(([t]) => t.count);
  const kcal = tot.map((t) => (t.count ? t.kcal : null));
  const prot = tot.map((t) => (t.count ? t.p : null));
  const wts = keys.map((k) => (day(k).weight ? toDisplayWeight(day(k).weight) : null));
  const sleep = keys.map((k) => day(k).sleep ?? null);
  const steps = keys.map((k) => day(k).steps ?? null);
  const water = keys.map((k) => day(k).water ?? null);
  const mood = keys.map((k) => day(k).mood ?? null);
  const energy = keys.map((k) => day(k).energy ?? null);
  const ws = keys.flatMap((k) => workoutsOn(k));
  const wVals = wts.filter((v) => v != null);
  const wChange = wVals.length >= 2 ? num(wVals[wVals.length - 1] - wVals[0], 1) : null;
  const nn = (arr) => arr.filter((v) => v != null);

  // habit success over the range
  const now = new Date(), start = fromKey(keys[0]);
  const habitRows = S.main.tasks.map((t) => {
    let ok = 0, total = 0, s = periodStart(t.period, now);
    while (s >= periodStart(t.period, start)) {
      const ended = nextPeriodStart(t.period, s) <= startOfDay(now);
      if (ended && nextPeriodStart(t.period, s).getTime() > (t.createdAt || 0)) { total++; if (passed(t, valueFor(t, s))) ok++; }
      s = prevPeriodStart(t.period, s);
    }
    return { t, ok, total, pct: total ? Math.round((ok / total) * 100) : null };
  });
  const hp = habitRows.filter((r) => r.total);
  const habitPct = hp.length ? Math.round((sum(hp.map((r) => r.ok)) / sum(hp.map((r) => r.total))) * 100) : null;

  const tile = (label, value, sub) => `<div class="tile"><small>${label}</small><b>${value}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const fmtNull = (v, f) => (v == null || Number.isNaN(v) ? '—' : f(v));

  $('#trendsView').innerHTML = `
  <div class="filters"><div class="seg" data-range>${[7, 30, 90].map((r) => `<button type="button" data-v="${r}" class="${r === range ? 'on' : ''}">${r} days</button>`).join('')}</div></div>
  <div class="tiles">
    ${tile('Avg calories', fmtNull(logged.length ? avg(logged.map(([t]) => t.kcal)) : null, (v) => round(v).toLocaleString()), logged.length ? `${logged.length} days logged · goal ${g.calories.toLocaleString()}` : 'no meals logged')}
    ${tile('Avg protein', fmtNull(logged.length ? avg(logged.map(([t]) => t.p)) : null, (v) => round(v) + ' g'), `goal ${g.protein} g`)}
    ${tile('Weight change', fmtNull(wChange, (v) => (v > 0 ? '+' : '') + v + ' ' + weightUnit()), wVals.length ? `${wVals.length} weigh-ins` : 'no weigh-ins')}
    ${tile('Avg sleep', fmtNull(nn(sleep).length ? avg(nn(sleep)) : null, (v) => num(v, 1) + ' hrs'), `goal ${g.sleep} hrs`)}
    ${tile('Workouts', ws.length, ws.length ? `${sum(ws.map((w) => w.minutes))} min · ${sum(ws.map((w) => w.kcal)).toLocaleString()} kcal` : '')}
    ${tile('Avg steps', fmtNull(nn(steps).length ? avg(nn(steps)) : null, (v) => round(v).toLocaleString()), `goal ${(g.steps || 0).toLocaleString()}`)}
    ${tile('Habit success', fmtNull(habitPct, (v) => v + '%'), hp.length ? 'of finished days/weeks/months' : '')}
    ${tile('Avg mood', fmtNull(nn(mood).length ? avg(nn(mood)) : null, (v) => ['😞', '🙁', '😐', '🙂', '😄'][Math.round(v) - 1] + ' ' + num(v, 1)), 'out of 5')}
  </div>
  <div class="chart-grid">
    ${chartCard('Calories', `daily total vs goal`, barChart('kcal', { keys, values: kcal, goal: g.calories, unit: 'kcal' }), logged.length ? '' : 'Log meals on the Food tab to see this chart.')}
    ${chartCard(`Weight (${weightUnit()})`, 'each weigh-in', lineChart('wt', { keys, values: wts, unit: weightUnit() }), wVals.length ? '' : 'Weigh in on the Health tab to see your trend.')}
    ${chartCard('Protein', 'grams per day vs goal', barChart('prot', { keys, values: prot, goal: g.protein, unit: 'g' }), logged.length ? '' : 'Log meals to see protein.')}
    ${chartCard('Sleep', 'hours per night vs goal', barChart('sleep', { keys, values: sleep, goal: g.sleep, fmt: (v) => num(v, 1), unit: 'hrs' }), nn(sleep).length ? '' : 'Add sleep on the Health tab.')}
    ${chartCard('Steps', 'per day vs goal', barChart('steps', { keys, values: steps, goal: g.steps, unit: 'steps' }), nn(steps).length ? '' : 'Add steps on the Health tab.')}
    ${chartCard('Water', 'glasses per day vs goal', barChart('water', { keys, values: water, goal: g.water, unit: 'glasses' }), nn(water).length ? '' : 'Track water on the Health tab.')}
    ${chartCard('Mood', '1 = rough · 5 = great', lineChart('mood', { keys, values: mood, domain: [1, 5], fmt: (v) => num(v, 0) }), nn(mood).length ? '' : 'Check in your mood on the Health tab.')}
    ${chartCard('Energy', '1 = drained · 5 = energized', lineChart('energy', { keys, values: energy, domain: [1, 5], fmt: (v) => num(v, 0) }), nn(energy).length ? '' : 'Check in your energy on the Health tab.')}
  </div>
  <article class="card habit-table">
    <header><h3>Habits</h3><small>finished periods passed in the last ${range} days</small></header>
    ${habitRows.length ? `<table><thead><tr><th>Habit</th><th>Passed</th><th class="bar-col">Rate</th></tr></thead><tbody>
      ${habitRows.map((r) => `<tr><td>${esc(r.t.emoji || '🌱')} ${esc(r.t.name)}</td><td>${r.total ? `${r.ok} / ${r.total}` : '—'}</td>
      <td class="bar-col">${r.pct == null ? '<span class="muted small">not enough data yet</span>' : `<div class="progress ${r.pct < 50 ? 'bad' : r.pct < 80 ? 'warn' : ''}"><div style="width:${r.pct}%"></div></div><span class="pct">${r.pct}%</span>`}</td></tr>`).join('')}
    </tbody></table>` : '<p class="muted small">Add habits on the Today tab.</p>'}
  </article>`;
}

export function bindTrends() {
  const root = $('#trendsView');
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-range] button');
    if (b) { range = +b.dataset.v; renderTrends(); }
  });
  root.addEventListener('pointermove', (e) => {
    const svg = e.target.closest('svg[data-chart]');
    root.querySelectorAll('.tip').forEach((t) => { if (!svg || t.previousElementSibling !== svg) t.hidden = true; });
    if (!svg) return;
    const c = charts.get(svg.dataset.chart);
    const rect = svg.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.max(0, Math.min(c.keys.length - 1, Math.floor((sx - PL) / c.xw)));
    const xh = svg.querySelector('.xh');
    const cx = PL + c.xw * (i + 0.5);
    xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('visibility', 'visible');
    svg.querySelectorAll('.bar').forEach((b) => b.classList.toggle('hot', +b.dataset.i === i));
    const tip = svg.nextElementSibling;
    tip.hidden = false;
    tip.textContent = '';
    const v = document.createElement('b'); v.textContent = c.rows[i][0];
    const d = document.createElement('span'); d.textContent = fromKey(c.keys[i]).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    tip.append(v, d);
    const left = (cx / W) * rect.width;
    tip.style.left = Math.min(Math.max(left, 50), rect.width - 50) + 'px';
  });
  root.addEventListener('pointerleave', () => hideAll(root), true);
  function hideAll(r) {
    r.querySelectorAll('.tip').forEach((t) => (t.hidden = true));
    r.querySelectorAll('.xh').forEach((x) => x.setAttribute('visibility', 'hidden'));
    r.querySelectorAll('.bar.hot').forEach((b) => b.classList.remove('hot'));
  }
  root.addEventListener('pointerout', (e) => { if (e.target.closest?.('svg[data-chart]') && !e.relatedTarget?.closest?.('svg[data-chart]')) hideAll(root); });
}

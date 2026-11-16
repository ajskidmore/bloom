/* Settings tab: profile & goals calculator, preferences, favorite foods, data, account. */
import { S, store, emit, goals, units, latestWeight, computeTargets, ACTIVITY, GOAL_OPTS, DEFAULT_GOALS } from './state.js';
import { $, esc, num, round, uid, dayKey, cmToIn, inToCm, toast } from './util.js';
import { toDisplayWeight, fromDisplayWeight, weightUnit } from './health.js';
import { notifSettingsHTML } from './social.js';
import { feedbackHTML } from './feedback.js';

export function renderSettings() {
  const p = S.main.profile || {}, g = goals(), metric = units() === 'metric';
  const w = latestWeight();
  const t = computeTargets(p, w);
  const hIn = p.heightCm ? cmToIn(p.heightCm) : null;
  const user = S.user;

  $('#settingsView').innerHTML = `
  <div class="settings">
    <section class="card sbox">
      <h3>You & your goals</h3>
      <p class="muted small">Used to estimate your daily calories (Mifflin–St Jeor) and macro targets. Everything stays editable.</p>
      <form data-profile class="form">
        <div class="row wrap">
          <div class="field"><span>Sex</span><div class="seg" data-name="sex">
            <button type="button" data-v="female" class="${p.sex === 'female' ? 'on' : ''}">Female</button>
            <button type="button" data-v="male" class="${p.sex === 'male' ? 'on' : ''}">Male</button></div></div>
          <label class="field"><span>Birth year</span><input name="birthYear" type="number" min="1920" max="${new Date().getFullYear()}" value="${p.birthYear || ''}" class="w-110" inputmode="numeric"></label>
          ${metric
            ? `<label class="field"><span>Height (cm)</span><input name="cm" type="number" step="0.5" value="${p.heightCm ? num(p.heightCm, 1) : ''}" class="w-110" inputmode="decimal"></label>`
            : `<div class="field"><span>Height</span><div class="row tight"><input name="ft" type="number" min="3" max="8" value="${hIn ? Math.floor(hIn / 12) : ''}" class="w-70" placeholder="ft" inputmode="numeric" aria-label="Feet"><input name="in" type="number" min="0" max="11.9" step="0.5" value="${hIn ? num(hIn % 12, 1) : ''}" class="w-70" placeholder="in" inputmode="decimal" aria-label="Inches"></div></div>`}
          <label class="field"><span>Weight (${weightUnit()})</span><input name="weight" type="number" step="0.1" value="${w ? toDisplayWeight(w) : ''}" class="w-110" inputmode="decimal"></label>
        </div>
        <div class="row wrap">
          <label class="field grow"><span>Activity</span><select name="activity">${ACTIVITY.map((a) => `<option value="${a.v}" ${+p.activity === a.v ? 'selected' : ''}>${a.label} (${a.hint})</option>`).join('')}</select></label>
          <label class="field grow"><span>Goal</span><select name="goal">${GOAL_OPTS.map((o) => `<option value="${o.v}" ${(+p.goal || 0) === o.v ? 'selected' : ''}>${o.label}</option>`).join('')}</select></label>
        </div>
        <div class="calc">${t
          ? `<span>BMR <b>${t.bmr.toLocaleString()}</b></span><span>Maintenance <b>${t.tdee.toLocaleString()}</b> kcal</span><span>Suggested <b>${t.calories.toLocaleString()} kcal</b> · P ${t.protein}g · C ${t.carbs}g · F ${t.fat}g</span>`
          : '<span class="muted">Fill in sex, birth year, height and weight to get suggested targets.</span>'}</div>
        <div class="dlg-actions"><span class="spacer"></span><button class="btn primary" type="submit">Save profile${t ? ' & update targets' : ''}</button></div>
      </form>
    </section>

    <section class="card sbox">
      <h3>Daily targets ${g.auto ? '<span class="pill">auto</span>' : '<span class="pill warn">custom</span>'}</h3>
      <form data-goals class="form">
        <div class="goal-grid">
          ${[['calories', 'Calories', 'kcal'], ['protein', 'Protein', 'g'], ['carbs', 'Carbs', 'g'], ['fat', 'Fat', 'g'], ['fiber', 'Fiber', 'g'], ['water', 'Water', 'glasses'], ['sleep', 'Sleep', 'hrs'], ['steps', 'Steps', '']]
            .map(([k, l, u]) => `<label class="field"><span>${l}${u ? ` (${u})` : ''}</span><input name="${k}" type="number" step="any" min="0" value="${g[k] ?? ''}" inputmode="decimal"></label>`).join('')}
        </div>
        <div class="dlg-actions">${t ? '<button type="button" class="btn ghost" data-reset-goals>Use suggested</button>' : ''}<span class="spacer"></span><button class="btn primary" type="submit">Save targets</button></div>
      </form>
    </section>

    <section class="card sbox">
      <h3>Preferences</h3>
      <div class="pref"><span>Units</span><div class="seg" data-units>
        <button type="button" data-v="imperial" class="${!metric ? 'on' : ''}">lb · ft · in</button>
        <button type="button" data-v="metric" class="${metric ? 'on' : ''}">kg · cm</button></div></div>
      <label class="pref"><span>Flower name</span><input data-flower value="${esc(S.main.settings.flowerName || 'Bloom')}" maxlength="20" class="w-160"></label>
      <label class="pref check-row"><input type="checkbox" data-addex ${S.main.settings.addExercise ? 'checked' : ''}><span>Add workout calories back to my daily calorie budget</span></label>
    </section>

    ${notifSettingsHTML()}

    <section class="card sbox">
      <h3>Favorite foods & meals</h3>
      <p class="muted small">Saved items show up as one-tap chips when logging, and the description parser recognizes their names (e.g. “my usual smoothie”).</p>
      <ul class="favs">${(S.main.customFoods || []).map((f) => `<li><span><b>${esc(f.name)}</b> <span class="muted small">${round(f.kcal)} kcal · P ${num(f.p, 1)} · C ${num(f.c, 1)} · F ${num(f.f, 1)}</span></span><button class="icon-btn" data-delfav="${f.id}" aria-label="Delete ${esc(f.name)}">✕</button></li>`).join('') || '<li class="muted small">None yet.</li>'}</ul>
      <form data-newfav class="form">
        <div class="row wrap">
          <label class="field grow"><span>Name</span><input name="name" placeholder="e.g. My usual smoothie" required></label>
          <label class="field grow"><span>Other names (optional)</span><input name="aliases" placeholder="e.g. morning smoothie, green smoothie"></label>
        </div>
        <div class="row wrap">
          ${[['kcal', 'kcal'], ['p', 'Protein g'], ['c', 'Carbs g'], ['f', 'Fat g'], ['fiber', 'Fiber g']].map(([k, l]) => `<label class="field"><span>${l}</span><input name="${k}" type="number" step="any" min="0" class="w-90" inputmode="decimal"></label>`).join('')}
        </div>
        <div class="dlg-actions"><span class="spacer"></span><button class="btn" type="submit">+ Add favorite</button></div>
      </form>
    </section>

    <section class="card sbox">
      <h3>Your data</h3>
      <p class="muted small">${store.mode === 'cloud' ? 'Synced to your account and private to you.' : 'Saved in this browser only (local mode).'} Meal photos are stored compressed (about 50 KB each).</p>
      <div class="btn-row">
        <button class="btn" data-export>⬇ Export backup (.json)</button>
        <label class="btn">⬆ Import backup<input type="file" accept="application/json,.json" hidden data-import></label>
        <button class="btn ghost danger" data-wipe>Delete all my data</button>
      </div>
    </section>

    ${feedbackHTML()}

    <section class="card sbox">
      <h3>Account</h3>
      ${store.mode === 'cloud' && user
        ? `<p>Signed in as <b>${esc(user.displayName || user.email || 'you')}</b>${user.email && user.displayName ? ` <span class="muted">(${esc(user.email)})</span>` : ''}</p>
           <div class="btn-row">${user.email ? '<button class="btn" data-pwreset>Email me a password reset link</button>' : ''}<button class="btn" data-signout>Sign out</button></div>`
        : '<p class="muted small">Local mode: no account. Deploy to Firebase to sign in and sync across devices.</p>'}
    </section>

    <section class="card sbox about">
      <h3>About the estimates</h3>
      <p class="muted small">Food estimates come from a built-in list of about 230 common foods and restaurant dishes (approximate USDA-style values), matched against your description. There's no AI and no image recognition. The photo is your visual record, and the portion buttons let you scale the estimate by eye. Calorie burn uses standard MET values. Treat every number as a starting point and edit it.</p>
    </section>
  </div>`;
}

export function bindSettings() {
  const root = $('#settingsView');
  root.addEventListener('click', async (e) => {
    const seg = e.target.closest('.seg[data-name="sex"] button');
    if (seg) { seg.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === seg)); return; }
    const u = e.target.closest('[data-units] button');
    if (u) { S.main.settings.units = u.dataset.v; store.saveMain({ settings: S.main.settings }); emit('all'); return; }
    if (e.target.closest('[data-reset-goals]')) {
      const t = computeTargets(S.main.profile, latestWeight());
      if (t) { S.main.goals = { ...goals(), auto: true, calories: t.calories, protein: t.protein, carbs: t.carbs, fat: t.fat, fiber: t.fiber }; store.saveMain({ goals: S.main.goals }); emit('all'); toast('Targets updated'); }
      return;
    }
    const df = e.target.closest('[data-delfav]');
    if (df) { S.main.customFoods = S.main.customFoods.filter((f) => f.id !== df.dataset.delfav); store.saveMain({ customFoods: S.main.customFoods }); emit('all'); return; }
    if (e.target.closest('[data-export]')) { exportData(); return; }
    const wipe = e.target.closest('[data-wipe]');
    if (wipe) {
      if (wipe.dataset.armed !== '1') { wipe.dataset.armed = '1'; wipe.textContent = 'Tap again to permanently delete everything'; return; }
      await store.resetAll(); toast('All data deleted'); emit('all'); return;
    }
    if (e.target.closest('[data-signout]')) { store.auth.signOut(); return; }
    if (e.target.closest('[data-pwreset]')) { try { await store.auth.reset(S.user.email); toast('Reset link sent to ' + S.user.email); } catch (err) { toast(err.message); } }
  });

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.matches('[data-profile]')) {
      const metric = units() === 'metric';
      const sex = f.querySelector('.seg .on')?.dataset.v || null;
      const heightCm = metric ? (+f.cm.value || null) : (+f.ft.value || +f.in.value ? inToCm((+f.ft.value || 0) * 12 + (+f.in.value || 0)) : null);
      S.main.profile = { sex, birthYear: +f.birthYear.value || null, heightCm: heightCm ? num(heightCm, 1) : null, activity: +f.activity.value, goal: +f.goal.value };
      const wv = parseFloat(f.weight.value);
      if (isFinite(wv) && wv > 0) {
        const kg = fromDisplayWeight(wv), last = latestWeight();
        if (!last || Math.abs(last - kg) > 0.05) store.saveDay(dayKey(new Date()), { weight: num(kg, 3) });
      }
      const t = computeTargets(S.main.profile, isFinite(wv) && wv > 0 ? fromDisplayWeight(wv) : latestWeight());
      const fields = { profile: S.main.profile };
      if (t && goals().auto !== false) { S.main.goals = { ...goals(), auto: true, calories: t.calories, protein: t.protein, carbs: t.carbs, fat: t.fat, fiber: t.fiber }; fields.goals = S.main.goals; }
      store.saveMain(fields); emit('all');
      toast(t ? `Saved · ${t.calories.toLocaleString()} kcal/day target` : 'Profile saved');
    }
    if (f.matches('[data-goals]')) {
      const g = { ...DEFAULT_GOALS, ...goals(), auto: false };
      ['calories', 'protein', 'carbs', 'fat', 'fiber', 'water', 'sleep', 'steps'].forEach((k) => { const v = parseFloat(f[k].value); if (isFinite(v) && v >= 0) g[k] = num(v, 2); });
      S.main.goals = g; store.saveMain({ goals: g }); emit('all'); toast('Targets saved');
    }
    if (f.matches('[data-newfav]')) {
      const name = f.name.value.trim();
      if (!name) return;
      const fav = { id: uid('c'), name, aliases: f.aliases.value.trim(), kcal: +f.kcal.value || 0, p: +f.p.value || 0, c: +f.c.value || 0, f: +f.f.value || 0, fiber: +f.fiber.value || 0 };
      S.main.customFoods = [...(S.main.customFoods || []), fav];
      store.saveMain({ customFoods: S.main.customFoods }); emit('all'); toast(`Added “${name}”`);
    }
  });

  root.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.matches('[data-flower]')) { S.main.settings.flowerName = t.value.trim() || 'Bloom'; store.saveMain({ settings: S.main.settings }); emit('all'); }
    if (t.matches('[data-addex]')) { S.main.settings.addExercise = t.checked; store.saveMain({ settings: S.main.settings }); emit('all'); }
    if (t.matches('[data-import]')) {
      const file = t.files?.[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data.main) throw new Error('Not a Bloom backup');
        await store.importAll(data); toast('Backup imported'); emit('all');
      } catch (err) { toast('Import failed: ' + err.message); }
    }
  });
}

function exportData() {
  const data = { app: 'bloom', version: 2, exportedAt: new Date().toISOString(), main: S.main, days: S.days, meals: S.meals };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bloom-backup-${dayKey(new Date())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup downloaded');
}

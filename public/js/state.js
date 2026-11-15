/* App state, change bus, and derived selectors shared by every tab. */
import { dayKey, startOfDay, sum, fromKey, round, addDays } from './util.js';

export const DEFAULT_GOALS = { auto: true, calories: 2000, protein: 130, carbs: 220, fat: 65, fiber: 30, water: 8, sleep: 8, steps: 8000 };

export function defaultMain() {
  return {
    tasks: [],
    logs: {},
    settings: { flowerName: 'Bloom', units: 'imperial', addExercise: false },
    profile: {},          // { sex, birthYear, heightCm, activity, goal }
    goals: { ...DEFAULT_GOALS },
    customFoods: [],      // [{ id, name, aliases, kcal, p, c, f, fiber, serving }]
  };
}

export const S = {
  main: defaultMain(),
  days: {},     // 'YYYY-MM-DD' -> { weight(kg), sleep(h), sleepQ(1-5), water(glasses), mood(1-5), energy(1-5), steps, workouts:[...], notes, bodyFat, waistCm, rhr }
  meals: {},    // id -> { id, date, time, type, description, items:[...], portion, hasPhoto }
  viewDate: startOfDay(new Date()),
  tab: 'today',
  user: null,
};

export let store = null;
export function setStore(s) { store = s; }

/* ---------- change bus ---------- */
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const emit = (what = 'all') => listeners.forEach((fn) => fn(what));

export function setMain(d) {
  const base = defaultMain();
  S.main = {
    ...base,
    ...(d || {}),
    settings: { ...base.settings, ...(d?.settings || {}) },
    goals: { ...base.goals, ...(d?.goals || {}) },
    profile: { ...(d?.profile || {}) },
    tasks: d?.tasks || [],
    logs: d?.logs || {},
    customFoods: d?.customFoods || [],
  };
}

/* ---------- selectors ---------- */
export const goals = () => S.main.goals;
export const units = () => S.main.settings.units || 'imperial';
export const day = (key) => S.days[key] || {};

export function mealsOn(key) {
  return Object.values(S.meals).filter((m) => m.date === key).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
}
export function mealTotals(m) {
  const it = m.items || [];
  return { kcal: sum(it.map((i) => i.kcal)), p: sum(it.map((i) => i.p)), c: sum(it.map((i) => i.c)), f: sum(it.map((i) => i.f)), fiber: sum(it.map((i) => i.fiber)) };
}
export function dayTotals(key) {
  const ms = mealsOn(key);
  const t = { kcal: 0, p: 0, c: 0, f: 0, fiber: 0, count: ms.length };
  for (const m of ms) { const x = mealTotals(m); t.kcal += x.kcal; t.p += x.p; t.c += x.c; t.f += x.f; t.fiber += x.fiber; }
  return t;
}
export function workoutsOn(key) { return day(key).workouts || []; }
export const burnedOn = (key) => sum(workoutsOn(key).map((w) => w.kcal));
export const activeMinOn = (key) => sum(workoutsOn(key).map((w) => w.minutes));

/** Most recent weight (kg) on or before key. */
export function latestWeight(key = dayKey(new Date())) {
  const keys = Object.keys(S.days).filter((k) => k <= key && S.days[k].weight).sort();
  return keys.length ? S.days[keys[keys.length - 1]].weight : null;
}
export function weightSeries(fromK, toK) {
  return Object.keys(S.days).filter((k) => k >= fromK && k <= toK && S.days[k].weight).sort().map((k) => ({ key: k, v: S.days[k].weight }));
}

/* ---------- Goal calculator (Mifflin–St Jeor) ---------- */
export const ACTIVITY = [
  { v: 1.2, label: 'Sedentary', hint: 'desk job, little exercise' },
  { v: 1.375, label: 'Lightly active', hint: '1–3 workouts/week' },
  { v: 1.55, label: 'Active', hint: '3–5 workouts/week' },
  { v: 1.725, label: 'Very active', hint: '6–7 workouts/week' },
  { v: 1.9, label: 'Athlete', hint: 'hard training or physical job' },
];
export const GOAL_OPTS = [
  { v: -500, label: 'Lose 1 lb/week' },
  { v: -250, label: 'Lose ½ lb/week' },
  { v: 0, label: 'Maintain' },
  { v: 250, label: 'Gain ½ lb/week' },
  { v: 500, label: 'Gain 1 lb/week' },
];
export function computeTargets(profile, weightKg) {
  const { sex, birthYear, heightCm, activity = 1.375, goal = 0 } = profile || {};
  if (!sex || !birthYear || !heightCm || !weightKg) return null;
  const age = new Date().getFullYear() - birthYear;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
  const tdee = bmr * activity;
  const calories = Math.max(sex === 'male' ? 1500 : 1200, round((tdee + goal) / 10) * 10);
  const protein = round(weightKg * (goal < 0 ? 2.0 : 1.8));        // g
  const fat = round((calories * 0.28) / 9);
  const carbs = Math.max(50, round((calories - protein * 4 - fat * 9) / 4));
  return { bmr: round(bmr), tdee: round(tdee), calories, protein, fat, carbs, fiber: round(calories / 1000 * 14) };
}

/* ---------- Habit sources (auto-tracked habits) ---------- */
// day(key) -> number. requireLog: an empty day counts as "not logged", not as a pass.
export const SOURCES = {
  calories: { label: 'Calories eaten', unit: 'kcal', tab: 'food', dailyOnly: true, requireLog: true, day: (k) => round(dayTotals(k).kcal) },
  protein: { label: 'Protein eaten', unit: 'g', tab: 'food', dailyOnly: true, requireLog: true, day: (k) => round(dayTotals(k).p) },
  meals: { label: 'Meals logged', unit: '', tab: 'food', day: (k) => mealsOn(k).length },
  water: { label: 'Water', unit: 'glasses', tab: 'health', day: (k) => day(k).water || 0 },
  sleep: { label: 'Sleep', unit: 'hrs', tab: 'health', dailyOnly: true, requireLog: true, day: (k) => day(k).sleep || 0 },
  steps: { label: 'Steps', unit: 'steps', tab: 'health', day: (k) => day(k).steps || 0 },
  workouts: { label: 'Workouts', unit: '', tab: 'health', day: (k) => workoutsOn(k).length },
  activeMin: { label: 'Active minutes', unit: 'mins', tab: 'health', day: (k) => activeMinOn(k) },
  weighins: { label: 'Weigh-ins', unit: '', tab: 'health', day: (k) => (day(k).weight ? 1 : 0) },
};

export function lastNDays(n, end = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(addDays(startOfDay(end), -i)));
  return out;
}
export { fromKey };

/* Demo mode: try Bloom without an account (open /?demo or tap "Try the demo" on the sign-in screen).
   - About four weeks of believable sample data that always ends on today, kept in this browser only
     under its own keys (it never touches a real account or the regular local mode).
   - A Feed with clearly fictional sample friends, kudos, a cheer and a pending friend request, all
     simulated in memory. Workouts you log in the demo get kudos from the sample friends.            */
import { localStore } from './store.js';
import { dayKey, addDays, startOfDay } from './util.js';

const KEYS = { main: 'bloom-demo-main', days: 'bloom-demo-days', meals: 'bloom-demo-meals', seeded: 'bloom-demo-seeded' };
const FLAG = 'bloom-demo';
export const DEMO_USER = { demo: true, uid: 'demo-you', displayName: 'Alex', email: '' };

export function demoRequested() {
  if (new URLSearchParams(location.search).has('demo')) return true;
  try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; }
}
export function enterDemo() {
  try { sessionStorage.setItem(FLAG, '1'); } catch {}
  location.href = location.pathname + '?demo#today';
}
export function exitDemo(toSignup = false) {
  try { sessionStorage.removeItem(FLAG); Object.values(KEYS).forEach((k) => localStorage.removeItem(k)); } catch {}
  location.href = location.pathname + (toSignup ? '#signup' : '');
}

/* ================= Sample data ================= */
// A small deterministic random so the demo looks the same for everyone on a given day.
function rng(seed) { let x = seed >>> 0; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
const r1 = (n) => Math.round(n * 10) / 10;
const LB = 0.45359237;

const MEALS = {
  breakfast: [
    ['Greek yogurt with berries and granola', '07:40', [['Greek yogurt', 1, 'cup', 150, 20, 9, 4, 0], ['Mixed berries', 0.75, 'cup', 55, 1, 13, 0, 4], ['Granola', 0.25, 'cup', 120, 3, 18, 4, 2]]],
    ['2 eggs and toast with avocado', '08:05', [['Egg', 2, 'large', 144, 12, 1, 10, 0], ['Whole wheat toast', 1, 'slice', 80, 4, 14, 1, 2], ['Avocado', 0.5, '', 120, 1.5, 6, 11, 5]]],
    ['Oatmeal with banana and peanut butter', '07:20', [['Oatmeal', 1, 'cup', 160, 6, 28, 3, 4], ['Banana', 1, 'medium', 105, 1, 27, 0, 3], ['Peanut butter', 1, 'tbsp', 95, 4, 3, 8, 1]]],
  ],
  lunch: [
    ['Chicken burrito bowl', '12:30', [['Chicken burrito bowl', 1, 'bowl', 650, 42, 70, 20, 12]]],
    ['Turkey sandwich and an apple', '12:10', [['Turkey sandwich', 1, 'sandwich', 420, 28, 44, 13, 5], ['Apple', 1, 'medium', 95, 0.5, 25, 0.3, 4]]],
    ['Salmon salad with quinoa', '13:00', [['Salmon', 4, 'oz', 233, 25, 0, 14, 0], ['Quinoa', 0.75, 'cup', 166, 6, 29, 3, 4], ['Mixed greens with vinaigrette', 1, 'bowl', 120, 2, 7, 10, 3]]],
  ],
  dinner: [
    ['Spaghetti with meat sauce', '19:00', [['Spaghetti with meat sauce', 1.5, 'cup', 590, 30, 72, 18, 6], ['Side salad', 1, 'bowl', 90, 2, 8, 6, 3]]],
    ['Chicken stir fry with rice', '18:45', [['Chicken stir fry', 1.5, 'cup', 380, 34, 18, 18, 4], ['White rice', 1, 'cup', 205, 4, 45, 0.4, 0.6]]],
    ['Steak, potatoes and green beans', '19:20', [['Sirloin steak', 6, 'oz', 340, 46, 0, 16, 0], ['Roasted potatoes', 1, 'cup', 220, 4, 34, 8, 4], ['Green beans', 1, 'cup', 44, 2, 10, 0, 4]]],
  ],
  snack: [
    ['Protein bar', '15:30', [['Protein bar', 1, 'bar', 210, 20, 22, 7, 3]]],
    ['Apple with peanut butter', '16:00', [['Apple', 1, 'medium', 95, 0.5, 25, 0.3, 4], ['Peanut butter', 2, 'tbsp', 190, 8, 6, 16, 2]]],
  ],
};
const meal = (id, date, type, [desc, time, items]) => ({
  id, date, time, type, description: desc, portion: 1, hasPhoto: false,
  items: items.map(([name, qty, unit, kcal, p, c, f, fiber]) => ({ name, qty, unit, kcal, p, c, f, fiber, manual: true })),
});

function buildSampleData(today = new Date()) {
  const rand = rng(Number(dayKey(today).replace(/-/g, '')));
  const t0 = addDays(startOfDay(today), -30).getTime();
  const tasks = [
    { id: 'd-water', name: 'Drink water', emoji: '💧', period: 'day', type: 'atLeast', source: 'water', useGoal: true, target: 8, createdAt: t0 },
    { id: 'd-steps', name: 'Walk 8k steps', emoji: '👟', period: 'day', type: 'atLeast', source: 'steps', useGoal: true, target: 8000, createdAt: t0 },
    { id: 'd-read', name: 'Read before bed', emoji: '📚', period: 'day', type: 'check', target: 1, createdAt: t0 },
    { id: 'd-screen', name: 'Phone screen time', emoji: '📱', period: 'day', type: 'under', target: 3, unit: 'hrs', createdAt: t0 },
    { id: 'd-work', name: 'Work out', emoji: '🏋️', period: 'week', type: 'atLeast', source: 'workouts', target: 3, createdAt: t0 },
    { id: 'd-eatout', name: 'Eat out', emoji: '🍔', period: 'week', type: 'under', target: 3, unit: '', createdAt: t0 },
  ];
  const logs = { 'd-read': {}, 'd-screen': {}, 'd-eatout': {} };
  const days = {}, meals = {};
  const workoutPlan = [
    ['run', 32, 'moderate', 'Easy 5k around the park'], ['strength', 45, 'moderate', 'Upper body'], ['yoga', 25, 'light', 'Morning stretch'],
    ['cycle', 50, 'vigorous', 'Hill repeats'], ['strength', 40, 'moderate', 'Legs day'], ['walk', 45, 'light', 'Long walk with podcast'], ['hiit', 20, 'vigorous', '20-minute circuit'],
  ];
  let w = 0;
  for (let i = 27; i >= 0; i--) {
    const d = addDays(startOfDay(today), -i), k = dayKey(d), isToday = i === 0;
    const good = rand() > 0.22;
    days[k] = {
      water: isToday ? 5 : Math.round(5 + rand() * 4 + (good ? 1 : 0)),
      steps: isToday ? 5480 : Math.round(5200 + rand() * 6800 + (good ? 900 : 0)),
      sleep: r1(6.2 + rand() * 2.1), sleepQ: 2 + Math.round(rand() * 3),
      mood: Math.min(5, 2 + Math.round(rand() * 2 + (good ? 1 : 0))), energy: Math.min(5, 2 + Math.round(rand() * 3)),
    };
    if (isToday) { delete days[k].mood; delete days[k].energy; }
    if (i % 3 === 0) days[k].weight = r1((183.5 - (27 - i) * 0.13 + (rand() - 0.5) * 0.8) * LB * 1000) / 1000; // lb trend → kg
    if (i % 7 === 0) days[k].notes = ['Felt great after the run. Sleeping better this week.', 'Busy day, but got my steps in on lunch break.', 'Tired, went to bed early.', 'Meal prepped for the week.'][i / 7 % 4];
    // Workouts about 4 times a week, not today (so you can log one and see it post).
    if (!isToday && [1, 3, 5, 6].includes(i % 7)) {
      const [type, minutes, intensity, note] = workoutPlan[w++ % workoutPlan.length];
      const met = { run: 9.8, strength: 5, yoga: 2.8, cycle: 7.5, walk: 3.5, hiit: 8 }[type] * ({ light: 0.8, moderate: 1, vigorous: 1.25 }[intensity]);
      days[k].workouts = [{ id: `dw${i}`, type, minutes, intensity, kcal: Math.round(met * 82 * minutes / 60), kcalManual: false, note: i < 7 ? note : '', share: true, loggedAt: d.getTime() + (17 + (i % 3)) * 3600e3 }];
    }
    if (!isToday) {
      if (good || rand() > 0.5) logs['d-read'][k] = 1;
      logs['d-screen'][k] = r1(good ? 1.8 + rand() : 2.6 + rand() * 1.5);
    } else logs['d-screen'][k] = 1.4;
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    meals[`dm-b${i}`] = meal(`dm-b${i}`, k, 'breakfast', pick(MEALS.breakfast));
    meals[`dm-l${i}`] = meal(`dm-l${i}`, k, 'lunch', pick(MEALS.lunch));
    if (!isToday) {
      meals[`dm-d${i}`] = meal(`dm-d${i}`, k, 'dinner', pick(MEALS.dinner));
      if (rand() > 0.45) meals[`dm-s${i}`] = meal(`dm-s${i}`, k, 'snack', pick(MEALS.snack));
    }
  }
  // Eating out, counted per week.
  for (let i = 0; i < 4; i++) logs['d-eatout']['W' + dayKey(addDays(startOfDay(today), -7 * i - ((today.getDay() + 6) % 7)))] = [1, 2, 3, 2][i];
  const main = {
    tasks, logs,
    settings: { flowerName: 'Sunny', units: 'imperial', addExercise: false, publicName: 'Alex', reminder: { on: false, time: '20:00' } },
    profile: { sex: 'female', birthYear: 1994, heightCm: 168, activity: 1.55, goal: -250 },
    goals: { auto: true, calories: 2050, protein: 125, carbs: 230, fat: 64, fiber: 29, water: 8, sleep: 8, steps: 8000 },
    customFoods: [{ id: 'dc1', name: 'My usual smoothie', aliases: 'morning smoothie', kcal: 310, p: 24, c: 38, f: 7, fiber: 6 }],
  };
  return { main, days, meals };
}

/** Writes fresh sample data when there's none, or when it was made on an earlier day. */
function seed({ read, write, keys }) {
  const today = dayKey(new Date());
  if (read(keys.seeded) === today && read(keys.main)) return;
  const { main, days, meals } = buildSampleData();
  write(keys.main, main); write(keys.days, days); write(keys.meals, meals); write(keys.seeded, today);
}

/* ================= Sample friends & feed (in memory) ================= */
function demoSocial() {
  const now = new Date(), today = dayKey(now), at = (daysAgo, h, m = 0) => addDays(startOfDay(now), -daysAgo).getTime() + (h * 60 + m) * 60e3;
  const friend = (uid, name, flower, done, total, streak, finished, flowerName) => ({ uid, name, photo: '', flower, flowerName, day: today, done, total, streak, finished });
  const post = (uid, id, daysAgo, h, data, kudos = {}) => ({ uid, id, at: at(daysAgo, h), day: dayKey(addDays(now, -daysAgo)), kudos, ...data });
  const W = (workout, title, minutes, kcal, intensity, note) => ({ kind: 'workout', workout, title, emoji: '', minutes, kcal, intensity, note });
  const soc = {
    ready: true, code: 'TRY4ME', inbox: [], outgoing: [], myPosts: [], myPostsReady: true,
    friendIds: ['demo-maya', 'demo-jordan', 'demo-sam'],
    friends: {
      'demo-maya': friend('demo-maya', 'Maya (sample)', 0.92, 4, 5, 12, ['💧 Drink water', '🧘 Stretch', '📚 Read 20 min', '👟 Walk 8k steps'], 'Fern'),
      'demo-jordan': friend('demo-jordan', 'Jordan (sample)', 0.74, 3, 4, 7, ['🥩 Hit protein goal', '😴 Sleep 7+ hours', '💧 Drink water'], 'Basil'),
      'demo-sam': friend('demo-sam', 'Sam (sample)', 0.41, 1, 4, 0, ['☕ No coffee after 2pm'], 'Pip'),
    },
    posts: {
      'demo-maya': [
        post('demo-maya', 'mp1', 0, 6.7, W('run', 'Run', 48, 520, 'moderate', 'Sunrise loop by the lake'), { 'demo-jordan': 'Jordan (sample)', 'demo-sam': 'Sam (sample)' }),
        post('demo-maya', 'mp2', 1, 19, W('yoga', 'Yoga / stretch', 30, 95, 'light', 'Evening flow'), { 'demo-jordan': 'Jordan (sample)' }),
        post('demo-maya', 'mp3', 3, 18, W('strength', 'Strength', 45, 300, 'moderate', 'Full body')),
      ],
      'demo-jordan': [
        post('demo-jordan', 'jp1', 1, 8, W('cycle', 'Cycling', 62, 610, 'vigorous', 'Commute + hill repeats'), { 'demo-maya': 'Maya (sample)', 'demo-you': 'Alex' }),
        post('demo-jordan', 'jp2', 2, 21, { kind: 'streak', title: '7-day streak', emoji: '', streak: 7 }, { 'demo-maya': 'Maya (sample)', 'demo-sam': 'Sam (sample)' }),
        post('demo-jordan', 'jp3', 2, 7, W('hiit', 'HIIT', 25, 280, 'vigorous', '')),
      ],
      'demo-sam': [
        post('demo-sam', 'sp1', 0, 12.5, W('walk', 'Walk', 40, 150, 'light', 'Lunch walk with the dog'), { 'demo-maya': 'Maya (sample)' }),
        post('demo-sam', 'sp2', 4, 17, W('swim', 'Swim', 35, 340, 'moderate', 'First swim in months')),
      ],
    },
    incoming: [{ id: 'demo-riley_demo-you', from: 'demo-riley', to: 'demo-you', fromName: 'Riley (sample)', fromPhoto: '', at: Date.now() - 50 * 60e3 }],
  };
  soc.inbox = [{ id: 'demo-cheer', type: 'cheer', from: 'demo-maya', fromName: 'Maya (sample)', fromPhoto: '', at: Date.now() - 2 * 3600e3 }];
  let fn = null;
  const push = () => fn?.({ ...soc });
  const later = (ms, f) => setTimeout(() => { f(); push(); }, ms);
  const needsAccount = () => Promise.reject(new Error("The demo doesn't connect to real people. Create a free account to add friends."));
  return {
    subscribe(f) { fn = f; push(); },
    publish: () => {},
    // Your own posts come from the shared sync in social.js; the sample friends react to new ones.
    savePost(id, data, isNew) {
      const i = soc.myPosts.findIndex((p) => p.id === id);
      // Your older sample posts already have a few kudos, so the feed looks lived-in.
      const past = isNew && data.at < Date.now() - 3600e3;
      const n = past ? [...id].reduce((a, c) => a + c.charCodeAt(0), 0) % 3 : 0;
      const seeded = Object.fromEntries([['demo-maya', 'Maya (sample)'], ['demo-jordan', 'Jordan (sample)'], ['demo-sam', 'Sam (sample)']].slice(0, n));
      const p = { ...(i >= 0 ? soc.myPosts[i] : { kudos: seeded }), ...data, id, uid: 'demo-you' };
      if (i >= 0) soc.myPosts[i] = p; else soc.myPosts.unshift(p);
      soc.myPosts.sort((a, b) => b.at - a.at);
      push();
      if (isNew && p.at > Date.now() - 3600e3) {
        later(4000, () => { const q = soc.myPosts.find((x) => x.id === id); if (q) q.kudos = { ...q.kudos, 'demo-maya': 'Maya (sample)' }; });
        later(9000, () => { const q = soc.myPosts.find((x) => x.id === id); if (q) q.kudos = { ...q.kudos, 'demo-jordan': 'Jordan (sample)' }; });
      }
      return Promise.resolve();
    },
    deletePost(id) { soc.myPosts = soc.myPosts.filter((p) => p.id !== id); push(); return Promise.resolve(); },
    kudos(owner, id, name, on) {
      const q = (soc.posts[owner] || []).find((p) => p.id === id);
      if (q) { q.kudos = { ...q.kudos }; if (on) q.kudos['demo-you'] = name; else delete q.kudos['demo-you']; }
      push(); return Promise.resolve();
    },
    cheer: () => Promise.resolve(),
    sendRequest: needsAccount,
    accept(r) {
      soc.incoming = soc.incoming.filter((x) => x.id !== r.id);
      soc.friendIds = [...soc.friendIds, r.from];
      soc.friends[r.from] = friend(r.from, r.fromName, 0.66, 2, 3, 3, ['💧 Drink water', '👟 Walk 8k steps'], 'Clover');
      soc.posts[r.from] = [post(r.from, 'rp1', 0, 9, W('hike', 'Hike', 75, 480, 'moderate', 'Trail with a view'))];
      push(); return Promise.resolve();
    },
    dropRequest(r) { soc.incoming = soc.incoming.filter((x) => x.id !== r.id); soc.outgoing = soc.outgoing.filter((x) => x.id !== r.id); push(); return Promise.resolve(); },
    removeFriend(fid) { soc.friendIds = soc.friendIds.filter((x) => x !== fid); delete soc.friends[fid]; delete soc.posts[fid]; push(); return Promise.resolve(); },
    clearInbox() { soc.inbox = []; push(); return Promise.resolve(); },
  };
}

/** The demo's store: browser-only storage with sample data, plus the simulated Feed. */
export function demoStore() {
  const s = localStore({ keys: KEYS, mode: 'demo', user: DEMO_USER, seed });
  s.social = demoSocial();
  return s;
}

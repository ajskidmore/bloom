/* Turns a free-text meal description into estimated food items — no AI, just a
   food dictionary + quantity/unit parsing.  "2 scrambled eggs, 2 slices wheat toast w/ butter"  */
import { FOODS } from './foodDb.js';
import { S } from './state.js';
import { uid, num } from './util.js';

/* ---------- vocabulary ---------- */
const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, quarter: 0.25, couple: 2, few: 3, several: 3, dozen: 12, single: 1, double: 2, triple: 3, some: 1 };
const UNIT_WORDS = {
  cup: 'cup', c: 'cup', tablespoon: 'tbsp', tbsp: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', teaspoon: 'tsp', tsp: 'tsp',
  ounce: 'oz', oz: 'oz', gram: 'g', g: 'g', gr: 'g', kg: 'kg', kilogram: 'kg', lb: 'lb', pound: 'lb',
  ml: 'ml', milliliter: 'ml', l: 'l', liter: 'l', litre: 'l', floz: 'floz',
  slice: 'slice', piece: 'piece', pc: 'piece', scoop: 'scoop', serving: 'serving', portion: 'serving',
  bowl: 'bowl', plate: 'plate', handful: 'handful', can: 'can', bottle: 'bottle', glass: 'glass', mug: 'mug',
  bar: 'bar', bag: 'bag', stick: 'stick', strip: 'strip', link: 'link', patty: 'patty', fillet: 'fillet', filet: 'fillet',
  order: 'order', container: 'container', pack: 'package', packet: 'packet', package: 'package', shot: 'shot', pint: 'pint',
  square: 'square', spear: 'spear', stalk: 'stalk', ear: 'ear', block: 'block', box: 'box', pat: 'pat', basket: 'basket', footlong: 'footlong',
};
const COUNTABLE = new Set(['each', 'slice', 'link', 'piece', 'bar', 'can', 'bottle', 'fillet', 'patty', 'roll', 'stalk', 'spear', 'square', 'scoop', 'shot', 'glass', 'handful', 'serving', 'plate', 'bowl', 'mug', 'strip']);
const SIZE_WORDS = { small: 'small', little: 'small', mini: 'small', medium: 'medium', regular: 'medium', large: 'large', big: 'large', jumbo: 'large', huge: 'large', grande: 'medium', venti: 'large', tall: 'small', xl: 'large' };
const FILLER = new Set(['of', 'the', 'and', 'with', 'w', 'plus', 'on', 'in', 'side', 'my', 'for', 'at', 'from', 'to', 'some', 'had', 'ate', 'i', 'about', 'around', 'approx', 'like', 'x', 'extra', 'bit', 'little', 'lot', 'lots',
  'grilled', 'fried', 'baked', 'roasted', 'steamed', 'boiled', 'scrambled', 'raw', 'fresh', 'plain', 'toasted', 'sliced', 'diced', 'chopped', 'cooked', 'hot', 'cold', 'iced', 'homemade', 'leftover', 'frozen', 'organic',
  'breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'meal', 'today', 'morning', 'afternoon', 'night', 'tonight', 'quick', 'healthy', 'yummy', 'delicious', 'just', 'also', 'then', 'or', 'it', 'was', 'a', 'an', 'very', 'really', 'super',
  'chipotle', 'starbucks', 'mcdonalds', 'mcdonald', 'panera', 'wendys', 'wendy', 'dunkin', 'costco', 'sweetgreen', 'qdoba', 'popeyes', 'kfc', 'arbys', 'sonic', 'dominos', 'chilis', 'applebees', 'restaurant', 'takeout', 'fast', 'food', 'drive', 'thru', 'store', 'bought',
  'unsweetened', 'sweetened', 'low', 'fat', 'free', 'nonfat', 'lean', 'whole', 'light', 'size', 'sized', 'cut', 'mixed', 'top', 'topped', 'over', 'into', 'piece', 'pieces']);
// words that describe a dish ("chicken" in "chicken burrito") and should not be counted twice
const DESCRIPTORS = new Set(['chicken', 'beef', 'steak', 'pork', 'shrimp', 'fish', 'turkey', 'tuna', 'salmon', 'veggie', 'vegetable', 'bean', 'cheese', 'egg', 'bacon', 'sausage', 'ham', 'tofu', 'carnitas', 'barbacoa', 'al', 'pastor', 'buffalo', 'bbq', 'spicy', 'crispy', 'cajun', 'teriyaki', 'pepperoni', 'mushroom', 'spinach', 'avocado', 'black', 'pinto', 'rice', 'breakfast', 'ground']);

/* ---------- normalization ---------- */
const FRACS = { '½': ' 1/2', '⅓': ' 1/3', '⅔': ' 2/3', '¼': ' 1/4', '¾': ' 3/4', '⅛': ' 1/8' };
export function singular(w) {
  if (w.length <= 3 || /ss$|us$|is$/.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(ches|shes|xes|oes)$/.test(w)) return w.slice(0, -2);
  if (/ves$/.test(w)) return w.slice(0, -3) + 'f';
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}
function normalize(text) {
  let s = String(text || '').toLowerCase();
  s = s.replace(/[½⅓⅔¼¾⅛]/g, (m) => FRACS[m]);
  s = s.replace(/&/g, ' and ').replace(/\bw\/\s?/g, ' with ').replace(/\bfl\.?\s?oz\b/g, ' floz ');
  s = s.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');       // 200g → 200 g
  s = s.replace(/(\d)\s*-\s*(\d)/g, '$1to$2');                                      // 2-3 → 2to3
  s = s.replace(/[’'`]/g, '');
  return s;
}
const SPLIT = /[,;\n.+()[\]]+(?!\d)|\s+(?:then|also)\s+/g;
function tokenize(seg) {
  return seg.split(/[^a-z0-9/.]+/).filter(Boolean).map((w) => w.replace(/\.$/, '')).filter(Boolean);
}

/* ---------- alias index ---------- */
let INDEX = null, INDEX_KEY = '';
function buildIndex() {
  const custom = S.main.customFoods || [];
  const key = custom.map((c) => c.id + c.name + (c.aliases || '')).join('|');
  if (INDEX && INDEX_KEY === key) return INDEX;
  const entries = [];
  const add = (food, alias) => {
    const toks = tokenize(normalize(alias)).map(singular);
    if (toks.length) entries.push({ food, toks });
  };
  for (const c of custom) {
    const food = customAsFood(c);
    add(food, c.name);
    (c.aliases || '').split(/[|,]/).map((a) => a.trim()).filter(Boolean).forEach((a) => add(food, a));
  }
  for (const f of FOODS) { add(f, f.name); f.aliases.forEach((a) => add(f, a)); }
  // longest aliases first; custom foods win ties (added first)
  entries.sort((a, b) => b.toks.length - a.toks.length);
  const byFirst = new Map();
  for (const e of entries) {
    if (!byFirst.has(e.toks[0])) byFirst.set(e.toks[0], []);
    byFirst.get(e.toks[0]).push(e);
  }
  INDEX = byFirst; INDEX_KEY = key;
  return INDEX;
}
export function customAsFood(c) {
  return {
    id: c.id, name: c.name, custom: true,
    kcal: c.kcal, p: c.p, c: c.c, f: c.f, fiber: c.fiber || 0,
    units: { serving: 100 }, def: { unit: 'serving', qty: 1 }, dish: true,   // per-serving macros stored as "per 100 g" with a 100 g serving
  };
}

/* ---------- units → grams ---------- */
export function gramsFor(food, unit, qty, size) {
  const u = food.units || {};
  const defGrams = () => (food.def.unit === 'serving' && !u.serving ? 100 : gramsFor(food, food.def.unit, food.def.qty));
  const vol = (cupFactor) => (u.cup ? u.cup * cupFactor : null);
  let g;
  switch (unit) {
    case 'g': g = 1; break;
    case 'kg': g = 1000; break;
    case 'oz': g = 28.35; break;
    case 'lb': g = 453.6; break;
    case 'cup': g = u.cup ?? u.glass ?? defGrams(); break;
    case 'tbsp': g = u.tbsp ?? vol(1 / 16) ?? 15; break;
    case 'tsp': g = u.tsp ?? (u.tbsp ? u.tbsp / 3 : null) ?? vol(1 / 48) ?? 5; break;
    case 'ml': g = u.cup ? u.cup / 240 : 1; break;
    case 'l': g = (u.cup ? u.cup / 240 : 1) * 1000; break;
    case 'floz': g = (u.cup ? u.cup / 240 : 1) * 29.57; break;
    case 'pint': g = u.pint ?? (u.cup ? u.cup * 2 : 473); break;
    case 'glass': g = u.glass ?? u.cup ?? u.each ?? defGrams(); break;
    case 'mug': g = u.mug ?? (u.cup ? u.cup * 1.25 : defGrams()); break;
    case 'serving': g = u.serving ?? defGrams(); break;
    case 'bowl': g = u.bowl ?? (u.cup ? u.cup * 1.5 : defGrams() * 1.5); break;
    case 'plate': g = u.plate ?? (u.cup ? u.cup * 2 : defGrams() * 2); break;
    case 'handful': g = u.handful ?? 30; break;
    case 'scoop': g = u.scoop ?? (u.cup ? u.cup / 2 : 30); break;
    case 'slice': g = u.slice ?? u.piece ?? u.each ?? defGrams(); break;
    case 'piece': g = u.piece ?? u.each ?? u.slice ?? defGrams(); break;
    case 'each': g = u.each ?? u.piece ?? u.slice ?? u.serving ?? u.bar ?? u.can ?? u.bottle ?? defGrams(); break;
    default: g = u[unit] ?? u.each ?? defGrams();
  }
  if (size && ['each', 'piece', 'slice', 'serving', 'cup', 'bowl', 'plate', 'bar', 'can', 'bottle', 'glass', 'mug', 'order'].includes(unit)) {
    if (u[size] && ['each', 'serving', 'order', 'glass', 'cup'].includes(unit)) g = u[size];
    else if (size === 'small') g *= 0.75;
    else if (size === 'large') g *= 1.3;
  }
  return g * (qty ?? 1);
}

export function unitOptions(food) {
  const u = food.units || {};
  const out = new Set();
  if (food.custom) return ['serving', 'g'];
  Object.keys(u).filter((k) => !['small', 'medium', 'large'].includes(k)).forEach((k) => out.add(k));
  if (u.cup) { out.add('tbsp'); out.add('tsp'); }
  ['g', 'oz', 'serving'].forEach((k) => out.add(k));
  return [...out];
}

export function itemFromFood(food, qty, unit, size, extra = {}) {
  const grams = gramsFor(food, unit, qty, size);
  const k = grams / 100;
  return {
    id: uid('i'), foodId: food.id, name: food.name, qty: num(qty), unit, size: size || null, grams: Math.round(grams),
    kcal: Math.round(food.kcal * k), p: num(food.p * k, 1), c: num(food.c * k, 1), f: num(food.f * k, 1), fiber: num(food.fiber * k, 1),
    manual: false, ...extra,
  };
}

export function findFood(id) {
  const c = (S.main.customFoods || []).find((x) => x.id === id);
  if (c) return customAsFood(c);
  return FOODS.find((f) => f.id === id) || null;
}

/** Recompute an item after qty/unit change. Manual items scale proportionally. */
export function recomputeItem(item, prev) {
  const food = item.foodId ? findFood(item.foodId) : null;
  if (food && !item.manual) return { ...itemFromFood(food, item.qty, item.unit, item.size), id: item.id };
  if (prev && prev.qty > 0 && prev.unit === item.unit) {
    const r = item.qty / prev.qty;
    return { ...item, kcal: Math.round(prev.kcal * r), p: num(prev.p * r, 1), c: num(prev.c * r, 1), f: num(prev.f * r, 1), fiber: num(prev.fiber * r, 1) };
  }
  return item;
}

/* ---------- parsing ---------- */
function parseNumber(tok) {
  if (tok in NUM_WORDS) return NUM_WORDS[tok];
  let m = tok.match(/^(\d+)to(\d+)$/);
  if (m) return (+m[1] + +m[2]) / 2;
  m = tok.match(/^(\d+)\/(\d+)$/);
  if (m && +m[2]) return +m[1] / +m[2];
  if (/^\d*\.?\d+$/.test(tok)) return parseFloat(tok);
  return null;
}

/** Read qty / unit / size from a token span (before or after a food). */
function readQuantity(toks) {
  let qty = null, unit = null, size = null, used = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const n = parseNumber(t);
    if (n != null) {
      if (qty == null) qty = n;
      else if (/\//.test(t) && n < 1) qty += n;          // "1 1/2"
      else if (t === 'half') qty *= 0.5;                 // "a half"
      else if (t !== 'a' && t !== 'an' && t !== 'some') qty = n;
      used = true; continue;
    }
    if (UNIT_WORDS[t] || UNIT_WORDS[singular(t)]) { unit = UNIT_WORDS[t] || UNIT_WORDS[singular(t)]; used = true; continue; }
    if (SIZE_WORDS[t]) { size = SIZE_WORDS[t]; used = true; continue; }
  }
  return { qty, unit, size, used };
}

/**
 * parseMeal(text) → { items: [...], unknown: ['kombucha', ...] }
 */
export function parseMeal(text) {
  const index = buildIndex();
  const items = [], unknown = [];
  const segments = normalize(text).split(SPLIT).map((s) => s.trim()).filter(Boolean);

  for (const seg of segments) {
    const raw = tokenize(seg);
    const toks = raw.map(singular);
    const taken = new Array(toks.length).fill(false);
    let matches = [];

    // 1) longest alias matches, left to right
    for (let i = 0; i < toks.length; i++) {
      if (taken[i]) continue;
      const cands = index.get(toks[i]) || [];
      for (const e of cands) {
        const L = e.toks.length;
        if (i + L > toks.length) continue;
        let ok = true;
        for (let j = 0; j < L; j++) if (toks[i + j] !== e.toks[j] || taken[i + j]) { ok = false; break; }
        if (!ok) continue;
        // a single-word match that is really a unit ("shot of espresso", "cup of soup") → skip
        if (L === 1 && UNIT_WORDS[toks[i]]) {
          let k = i + 1; while (k < toks.length && FILLER.has(toks[k])) k++;
          if (k < toks.length && (index.get(toks[k]) || []).length) continue;
        }
        matches.push({ start: i, end: i + L, food: e.food });
        for (let j = 0; j < L; j++) taken[i + j] = true;
        i += L - 1;
        break;
      }
    }
    // second pass for longer aliases that start later (handled above); now sort
    matches.sort((a, b) => a.start - b.start);

    // 2) dishes absorb preceding descriptor matches ("chicken burrito", "steak taco")
    for (let m = matches.length - 1; m > 0; m--) {
      const cur = matches[m], prev = matches[m - 1];
      if (!cur.food.dish) continue;
      const between = toks.slice(prev.end, cur.start);
      const prevIsDescriptor = toks.slice(prev.start, prev.end).every((t) => DESCRIPTORS.has(t) || FILLER.has(t));
      if (prevIsDescriptor && between.every((t) => DESCRIPTORS.has(t) || FILLER.has(t) || SIZE_WORDS[t])) {
        cur.label = raw.slice(prev.start, cur.end).join(' ');
        cur.start = prev.start;
        matches.splice(m - 1, 1);
      }
    }

    // 3) quantities: tokens between previous match end and this match start (or right after)
    let cursor = 0;
    matches.forEach((m, idx) => {
      const before = toks.slice(cursor, m.start);
      const nextStart = idx + 1 < matches.length ? matches[idx + 1].start : toks.length;
      let q = readQuantity(before.slice(-4));
      const hadExplicit = q.qty != null || q.unit != null;
      if (!hadExplicit) {
        // quantity after the food: "chicken 6 oz", "eggs x2"
        const after = toks.slice(m.end, Math.min(m.end + 3, nextStart));
        const qa = readQuantity(after.filter((t) => !FILLER.has(t) || t === 'x'));
        if (qa.qty != null || qa.unit) {
          q = { ...q, qty: qa.qty ?? q.qty, unit: qa.unit ?? q.unit, size: q.size ?? qa.size };
          // mark consumed so they don't become "unknown"
          for (let k = m.end; k < Math.min(m.end + 3, nextStart); k++) if (parseNumber(toks[k]) != null || UNIT_WORDS[toks[k]]) taken[k] = true;
        }
      }
      // consume leading quantity tokens
      for (let k = cursor; k < m.start; k++) if (parseNumber(toks[k]) != null || UNIT_WORDS[toks[k]] || UNIT_WORDS[singular(toks[k])] || SIZE_WORDS[toks[k]]) taken[k] = true;

      const food = m.food;
      let unit = q.unit, qty = q.qty;
      if (!unit && qty == null) { unit = food.def.unit; qty = food.def.qty; }
      else if (!unit) unit = COUNTABLE.has(food.def.unit) ? food.def.unit : (food.units.each ? 'each' : food.def.unit);
      else if (qty == null) qty = 1;
      // "a large coffee", "small fries": a size on its own means 1 of that size
      const item = itemFromFood(food, qty, unit, q.size, { text: raw.slice(m.start, m.end).join(' ') });
      if (m.label) item.text = m.label;
      items.push(item);
      cursor = m.end;
    });

    // 4) leftover meaningful words → unknown phrases
    let phrase = [];
    const flush = () => { if (phrase.length) unknown.push(phrase.join(' ')); phrase = []; };
    toks.forEach((t, i) => {
      if (taken[i]) { flush(); return; }
      if (FILLER.has(t) || parseNumber(t) != null || UNIT_WORDS[t] || SIZE_WORDS[t] || t.length < 2) { flush(); return; }
      phrase.push(raw[i]);
    });
    flush();
  }
  return { items, unknown: [...new Set(unknown)] };
}

/** Search the food list (built-in + custom) for an "add item" box. */
export function searchFoods(q, limit = 8) {
  q = normalize(q).trim();
  if (!q) return [];
  const qt = tokenize(q).map(singular);
  const custom = (S.main.customFoods || []).map(customAsFood);
  const all = [...custom, ...FOODS];
  const scored = [];
  for (const f of all) {
    const names = [f.name, ...(f.aliases || [])].map((n) => normalize(n));
    let best = 0;
    for (const n of names) {
      const nt = tokenize(n).map(singular);
      if (n === q) best = Math.max(best, 100);
      else if (n.startsWith(q)) best = Math.max(best, 80);
      else if (qt.every((t) => nt.some((w) => w.startsWith(t)))) best = Math.max(best, 60 - nt.length);
    }
    if (best) scored.push([best + (f.custom ? 5 : 0), f]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}

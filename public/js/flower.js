/* The flower mascot: pure SVG drawn from a health value 0..1. */
import { clamp } from './util.js';

const STOPS = {
  petal: ['#a8906c', '#f4a6c0', '#ff5d8f'],
  petal2: ['#bfa784', '#ffd0df', '#ffb3cb'],
  center: ['#7d6440', '#e9b949', '#ffc93c'],
  stem: ['#8f8a57', '#5aa469', '#3f9a5a'],
  leaf: ['#a39b62', '#6dbb73', '#4fae62'],
};
const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export function mix3(stops, h) {
  const [a, b, c] = stops.map(hex);
  const [x, y, t] = h < 0.5 ? [a, b, h / 0.5] : [b, c, (h - 0.5) / 0.5];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}

export function flowerSVG(h, time = 0) {
  h = clamp(h, 0, 1);
  const sway = Math.sin(time / 1100) * (0.8 + 2.4 * h);
  const angDeg = (1 - h) * 100 + sway;
  const ang = (angDeg * Math.PI) / 180;
  const hx = 100 + 52 * Math.sin(ang), hy = 132 - 52 * Math.cos(ang);
  const cy = 98 + (1 - h) * 18;
  const bz = (t) => ({ x: (1 - t) ** 2 * 100 + 2 * t * (1 - t) * 100 + t * t * hx, y: (1 - t) ** 2 * 218 + 2 * t * (1 - t) * cy + t * t * hy });
  const L1 = bz(0.22), L2 = bz(0.42);
  const petal = mix3(STOPS.petal, h), petal2 = mix3(STOPS.petal2, h), center = mix3(STOPS.center, h);
  const stem = mix3(STOPS.stem, h), leaf = mix3(STOPS.leaf, h);

  const n = h < 0.12 ? 5 : h < 0.22 ? 6 : h < 0.32 ? 7 : 8;
  const pl = 12 + 12 * h, pw = 7 + 4 * h, pd = 15 + 5 * h;
  let petals = '';
  for (let i = 0; i < n; i++) petals += `<ellipse cx="0" cy="${-pd}" rx="${pw}" ry="${pl}" transform="rotate(${i * 45 + (8 - n) * 14})" fill="${petal}"/>`;
  let inner = '';
  if (h > 0.55) {
    const op = ((h - 0.55) / 0.45).toFixed(2);
    for (let i = 0; i < 8; i++) inner += `<ellipse cx="0" cy="-15" rx="5.5" ry="11" transform="rotate(${i * 45 + 22.5})" fill="${petal2}" opacity="${op}"/>`;
  }
  const m = (h - 0.45) * 14;
  const eyes = h < 0.22
    ? `<path d="M-8 -3 q3 2.5 6 0 M2 -3 q3 2.5 6 0" stroke="#3b2f22" stroke-width="1.8" fill="none" stroke-linecap="round"/>`
    : `<circle cx="-5" cy="-3" r="2.1" fill="#3b2f22"/><circle cx="5" cy="-3" r="2.1" fill="#3b2f22"/><circle cx="-4.3" cy="-3.8" r=".7" fill="#fff"/><circle cx="5.7" cy="-3.8" r=".7" fill="#fff"/>`;
  const bo = ((h - 0.6) / 0.4 * 0.7).toFixed(2);
  const blush = h > 0.6 ? `<ellipse cx="-9.5" cy="2.5" rx="3" ry="1.8" fill="#ff8fab" opacity="${bo}"/><ellipse cx="9.5" cy="2.5" rx="3" ry="1.8" fill="#ff8fab" opacity="${bo}"/>` : '';
  const sweat = h < 0.35 ? `<path d="M11 -12 q2.5 4 0 6 q-2.5 -2 0 -6z" fill="#7cc4f0"/>` : '';
  const face = `<g transform="rotate(${(-angDeg * 0.75).toFixed(1)})">${eyes}${blush}<path d="M-5 4.5 Q0 ${(4.5 + m).toFixed(1)} 5 4.5" stroke="#3b2f22" stroke-width="1.8" fill="none" stroke-linecap="round"/>${sweat}</g>`;
  const leafPath = 'M0 0 C 10 -13, 28 -13, 38 0 C 28 8, 10 8, 0 0Z';
  const lRot = -150 - (1 - h) * 55 + sway * 0.6, rRot = -30 + (1 - h) * 55 + sway * 0.6;

  let sparkles = '';
  if (h > 0.75) {
    const k = (h - 0.75) / 0.25;
    [[-40, -30], [42, -18], [-30, 34]].forEach(([dx, dy], i) => {
      const op = (0.5 + 0.5 * Math.sin(time / 380 + i * 2.1)) * k;
      sparkles += `<path transform="translate(${(hx + dx).toFixed(1)} ${(hy + dy).toFixed(1)}) scale(${(0.8 + 0.3 * Math.sin(time / 500 + i)).toFixed(2)})" d="M0 -5 L1.3 -1.3 L5 0 L1.3 1.3 L0 5 L-1.3 1.3 L-5 0 L-1.3 -1.3Z" fill="#ffc93c" opacity="${op.toFixed(2)}"/>`;
    });
  }
  let falling = '';
  if (h < 0.3 && time) {
    const ph = (time % 4200) / 4200;
    const fx = hx + 8 + ph * 26 + Math.sin(ph * 12) * 6, fy = hy + 12 + ph * (214 - hy - 12);
    falling = `<ellipse rx="4" ry="7" fill="${petal}" opacity="${(1 - ph).toFixed(2)}" transform="translate(${fx.toFixed(1)} ${fy.toFixed(1)}) rotate(${(ph * 400).toFixed(0)})"/>`;
  }
  return `
    <ellipse cx="100" cy="257" rx="52" ry="4" fill="#000" opacity=".06"/>
    <path d="M100 218 Q 100 ${cy.toFixed(1)} ${hx.toFixed(1)} ${hy.toFixed(1)}" stroke="${stem}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <path d="${leafPath}" fill="${leaf}" transform="translate(${L1.x.toFixed(1)} ${L1.y.toFixed(1)}) rotate(${lRot.toFixed(1)})"/>
    <path d="${leafPath}" fill="${leaf}" transform="translate(${L2.x.toFixed(1)} ${L2.y.toFixed(1)}) rotate(${rRot.toFixed(1)})"/>
    <path d="M60 216 H140 L132 255 H68 Z" fill="#d9825b"/>
    <path d="M64 232 H136" stroke="#c8704b" stroke-width="2" opacity=".6"/>
    <rect x="55" y="207" width="90" height="14" rx="5" fill="#e8946a"/>
    <ellipse cx="100" cy="209" rx="40" ry="3.5" fill="#6b4a33"/>
    <g transform="translate(${hx.toFixed(1)} ${hy.toFixed(1)}) rotate(${angDeg.toFixed(1)})">
      ${petals}${inner}<circle r="${(13 + 2 * h).toFixed(1)}" fill="${center}"/>${face}
    </g>${sparkles}${falling}`;
}

export function stageOf(h) {
  if (h >= 0.8) return 'thriving';
  if (h >= 0.55) return 'happy';
  if (h >= 0.3) return 'thirsty';
  return 'wilting';
}
export const STAGE_LABEL = { thriving: 'Thriving 🌸', happy: 'Happy 🌱', thirsty: 'Thirsty 💧', wilting: 'Wilting 🥀' };
export const MESSAGES = {
  thriving: ["I'm absolutely blooming! 🌸", 'Look at us go!', 'Sunshine and good habits ☀️', 'Best. Gardener. Ever.'],
  happy: ['Feeling good! Keep the water coming.', 'Nice and green over here 🌿', "We're doing alright, you and me."],
  thirsty: ['A little thirsty over here…', "Could use a sip. What's one thing you can check off?", 'My leaves are getting droopy…'],
  wilting: ["I'm wilting… 🥀 Let's get one win today.", 'Water… please… one small habit?', "It's not too late to turn this around!"],
  water: ['Ahh, refreshing! 💧', 'Glug glug glug 💦', 'That hit the spot!', 'Ooh, I felt that one 🌱', 'More please!'],
  ouch: ['Oof, that one stung.', 'Uh oh… careful with that one.', "We'll bounce back."],
  empty: ['Hi! Plant your first habit and water me by checking it off.'],
};
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

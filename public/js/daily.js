// Daily challenges: three a day - one easy, one medium, one hard - picked from the date, so everyone
// gets the same three, and replaced at local midnight. Progress is counted from what actually happens
// on the road (main.js reports it), and a finished challenge pays out on the spot.
import { P, save, earn, addXp } from "./profile.js";

// kind "sum" adds up over the day; "max" keeps the best single value (a run's score, a streak, a speed)
const TEMPLATES = [
  { id: "closeCalls", kind: "sum", n: [15, 30, 50], text: (n) => `Get ${n} close calls` },
  { id: "insane", kind: "sum", n: [3, 6, 10], text: (n) => `Pull off ${n} INSANE passes` },
  { id: "needle", kind: "sum", n: [2, 4, 7], text: (n) => `Thread the needle ${n} times` },
  { id: "streak", kind: "max", n: [5, 8, 12], text: (n) => `Reach a x${n} close-call streak` },
  { id: "score", kind: "max", n: [1500, 3500, 7000], text: (n) => `Score ${n.toLocaleString()} in one run` },
  { id: "miles", kind: "sum", n: [5, 12, 25], text: (n) => `Drive ${n} miles`, dec: 1 },
  { id: "mph", kind: "max", n: [140, 165, 190], text: (n) => `Hit ${n} mph` },
  { id: "honks", kind: "sum", n: [3, 6, 10], text: (n) => `Cut people off until ${n} of them honk` },
  { id: "dodged", kind: "sum", n: [2, 4, 7], text: (n) => `Dodge ${n} cars changing lanes` },
  { id: "bigrig", kind: "sum", n: [4, 8, 14], text: (n) => `Close-call ${n} trucks or buses` },
  { id: "flames", kind: "sum", n: [30, 80, 160], text: (n) => `Spit ${n} exhaust flames` },
];
export const DAILY_TIERS = ["EASY", "MEDIUM", "HARD"];
const REWARD = [{ coins: 500, xp: 60 }, { coins: 1000, xp: 120 }, { coins: 2000, xp: 250 }];
export const DAILY_BONUS = { coins: 1500, xp: 150 };   // for finishing all three

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// a small seeded generator, so the same date always deals the same three
function rng(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
let dealt = null;
function deal(day) {
  if (dealt?.day === day) return dealt.list;
  const r = rng("hd-daily-" + day), pool = [...TEMPLATES], list = [];
  for (let tier = 0; tier < 3; tier++) {
    const t = pool.splice(Math.floor(r() * pool.length), 1)[0];
    list.push({ id: t.id, kind: t.kind, tier, target: t.n[tier], text: t.text(t.n[tier]), dec: t.dec || 0, reward: REWARD[tier] });
  }
  dealt = { day, list };
  return list;
}
// today's saved progress, started fresh when the date has moved on
function state() {
  const day = dayKey();
  if (P.daily?.day !== day) P.daily = { day, prog: {}, done: {}, bonus: false };
  return P.daily;
}

// Today's three, with where each one stands.
export function todaysDaily() {
  const s = state();
  return deal(s.day).map((c) => ({ ...c, prog: Math.min(c.target, s.prog[c.id] || 0), done: !!s.done[c.id] }));
}
export const dailyBonusDone = () => !!state().bonus;
export function msToDailyReset() { const n = new Date(), m = new Date(n); m.setHours(24, 0, 0, 0); return m - n; }

// Set by main.js: called with the challenge just finished, and whether that finished all three.
export const dailyHooks = { onComplete: null };
let dirty = false, lastSave = 0;
function add(id, value, max) {
  const s = state(), c = deal(s.day).find((x) => x.id === id);
  if (!c || s.done[id]) return;
  const before = s.prog[id] || 0;
  s.prog[id] = max ? Math.max(before, value) : before + value;
  if (s.prog[id] === before) return;
  dirty = true;
  if (s.prog[id] < c.target) return;
  s.done[id] = true;
  earn(c.reward.coins); addXp(c.reward.xp);
  const all = deal(s.day).every((x) => s.done[x.id]);
  if (all && !s.bonus) { s.bonus = true; earn(DAILY_BONUS.coins); addXp(DAILY_BONUS.xp); }
  save(); dirty = false; lastSave = performance.now();
  dailyHooks.onComplete?.(c, all);
}
export const dailyTrack = (id, amount = 1) => add(id, amount, false);   // "sum" challenges
export const dailyBest = (id, value) => add(id, value, true);          // "max" challenges
// progress is saved every few seconds rather than on every close call
export function dailyFlush(force = false) {
  if (!dirty || (!force && performance.now() - lastSave < 5000)) return;
  dirty = false; lastSave = performance.now(); save();
}

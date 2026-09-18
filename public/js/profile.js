// Local progression + settings. Saved to localStorage, mirrored into a long-lived cookie so a
// browser that drops site data (or an origin change) can't wipe the garage.
import { store } from "./net.js";
import { CARS, specOf } from "./cars.js";
import { normalizeTune, defaultTune, audioConfig, PARTS } from "./tuning.js";
import { carPrice, partPrice, TUNING_PRICES, COSMETIC_PRICES, stylePrice } from "./economy.js";

export const MEDALS = [
  { at: 500, name: "Bronze", icon: "🥉", color: "#c47a3a" },
  { at: 1200, name: "Silver", icon: "🥈", color: "#aab4c0" },
  { at: 2500, name: "Gold", icon: "🥇", color: "#e8b830" },
  { at: 4800, name: "Pearl", icon: "💠", color: "#d9d2f0" },
  { at: 8500, name: "Sapphire", icon: "🔷", color: "#2f8bff" },
  { at: 14000, name: "Emerald", icon: "💚", color: "#1fbf6a" },
  { at: 22500, name: "Ruby", icon: "❤️‍🔥", color: "#e0283a" },
  { at: 35000, name: "Diamond", icon: "💎", color: "#7fe8ff" },
];
export const HEART_PACKS = [
  { n: 1, price: 150 }, { n: 5, price: 650 }, { n: 15, price: 1800 }, { n: 50, price: 5500 },
];
export const xpForLevel = (lvl) => 200 + (lvl - 1) * 60;

const DEFAULTS = {
  name: "", colors: {}, styles: {}, tunes: {}, parts: {}, ecu: {}, painted: {}, coins: 500, hearts: 3, owned: ["b330i", "a4", "c300"], equipped: "b330i", best: 0, level: 1, xp: 0, medals: 0, sv: 0,
  settings: { hour: 18.6, flow: false, sky: "Aurora", weather: "Clear", traffic: "Heavy", volMaster: .8, volEngine: .9, volFx: .9, volWind: .35, driveMode: "sport", manual: false, shadows: true, res: 1, hideNames: false },
};

// ---------------- persistence ----------------
// The cookie only carries progression (it has to stay under ~4 KB); localStorage keeps everything.
const COOKIE = "hd_save";
const cookie = {
  get(k) { const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; },
  set(k, v) { document.cookie = `${k}=${encodeURIComponent(v)}; max-age=${60 * 60 * 24 * 400}; path=/; SameSite=Lax`; },
};
function readCookieSave() {
  try { const raw = cookie.get(COOKIE); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function loadProfile() {
  const local = store.get("hd_profile", null);
  const backup = readCookieSave();
  // whichever copy was written last wins, so a cleared localStorage restores from the cookie
  if (backup && (!local || (backup.sv || 0) > (local.sv || 0) + 1000)) return { ...DEFAULTS, ...local, ...backup };
  return { ...DEFAULTS, ...(local || {}) };
}

export const P = loadProfile();
P.settings = { ...DEFAULTS.settings, ...(P.settings || {}) };
// removed cars drop out of the garage; the free starters are always owned
if (!Array.isArray(P.owned)) P.owned = [];
P.owned = [...new Set([...P.owned.filter((id) => CARS.some((c) => c.id === id)), "b330i", "a4", "c300"])];
if (!CARS.some((c) => c.id === P.equipped)) P.equipped = "b330i";
if (!P.name) P.name = "Driver" + Math.floor(1000 + Math.random() * 9000);
delete P.sounds; // engine sounds are locked to the car now

export function save() {
  P.sv = Date.now();
  store.set("hd_profile", P);
  try {
    cookie.set(COOKIE, JSON.stringify({ name: P.name, coins: P.coins, hearts: P.hearts, owned: P.owned, equipped: P.equipped, best: P.best, level: P.level, xp: P.xp, medals: P.medals, sv: P.sv }));
  } catch { /* cookie disabled */ }
}
// last-ditch saves: some browsers never fire unload, so cover every exit path
for (const ev of ["pagehide", "beforeunload", "blur"]) addEventListener(ev, () => save());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(); });

export const PAINTS = [0xe8c547, 0xc2241f, 0xff6a1a, 0x22b573, 0x4cc3ff, 0x2c55b8, 0x7b3fe4, 0xff4fa0, 0xf2f2f2, 0x9aa1aa, 0x1c1c28, 0x0d5c4a];
export const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];
export const carColor = (id) => P.colors?.[id] ?? carById(id).color;
// The engine sound belongs to the car: there is no swap option any more.
export const carSound = (id) => { const c = carById(id); return c.sound || specOf(c).sound || "i4"; };
// A tune may only use parts that have actually been bought for that car, so nothing can be fitted
// for free by editing a saved tune.
export function carTune(id) {
  const t = normalizeTune(carById(id), P.tunes?.[id]);
  for (const kind of Object.keys(PARTS)) if (!ownsPart(id, kind, t[kind])) t[kind] = "stock";
  if (!P.ecu?.[id]) Object.assign(t, mapDefaults(id)); // no ECU access: the engine map stays stock
  return t;
}
const MAP_KEYS = ["boost", "wastegate", "timing", "afr", "revLimit", "final", "gearing"];
function mapDefaults(id) {
  const d = defaultTune(carById(id)), out = {};
  for (const k of MAP_KEYS) out[k] = d[k];
  return out;
}
export const carTuneDefault = (id) => defaultTune(carById(id));
export const carAudio = (id) => audioConfig(carById(id), carTune(id));
export function setTune(id, patch) { P.tunes[id] = { ...carTune(id), ...patch }; save(); return carTune(id); }
export function resetTune(id) { delete P.tunes[id]; save(); }
export const isMapKey = (k) => MAP_KEYS.includes(k);

// ---------------- economy ----------------
// Every coin that leaves the wallet goes through spend(). The UI never deducts coins itself.
export function spend(amount) {
  const cost = Math.max(0, Math.round(amount));
  if (cost === 0) return { ok: true, coins: P.coins };
  if (P.coins < cost) return { ok: false, short: cost - P.coins, coins: P.coins };
  P.coins -= cost;
  save();
  return { ok: true, coins: P.coins, spent: cost };
}
export function earn(amount) { P.coins += Math.max(0, Math.round(amount)); save(); return P.coins; }
export const ownsPart = (carId, kind, option) => option === "stock" || (P.parts?.[carId]?.[kind] || []).includes(option);
export const ownsEcu = (carId) => !!P.ecu?.[carId];
export const priceOfCar = (id) => carPrice(carById(id));
export function buyPart(carId, kind, option) {
  if (ownsPart(carId, kind, option)) return { ok: true, already: true };
  const r = spend(partPrice(kind, option));
  if (!r.ok) return r;
  walletHooks.buy?.(kind, option);
  ((P.parts[carId] ||= {})[kind] ||= []).push(option);
  save();
  return { ok: true, price: partPrice(kind, option) };
}
export function buyEcu(carId) {
  if (ownsEcu(carId)) return { ok: true, already: true };
  const r = spend(TUNING_PRICES.ecu);
  if (!r.ok) return r;
  P.ecu[carId] = true; save();
  walletHooks.buy?.("ecu", carId);
  return { ok: true, price: TUNING_PRICES.ecu };
}
export function payTuneSession(carId) {
  if (!ownsEcu(carId)) return { ok: false, needEcu: true };
  const r = spend(TUNING_PRICES.session);
  if (r.ok) walletHooks.buy?.("session", carId);
  return r;
}
export function payPaint(carId) {
  if (P.painted?.[carId]) return { ok: true, already: true };
  const r = spend(COSMETIC_PRICES.paint);
  if (!r.ok) return r;
  P.painted[carId] = true; save();
  walletHooks.buy?.("paint", carId);
  return { ok: true, price: COSMETIC_PRICES.paint };
}

export const carStyle = (id) => ({ finish: "gloss", tint: "dark", stance: "stock", rim: null, caliper: null, glow: null, ...(P.styles?.[id] || {}) });
// A style option is paid for once per car; after that it can be switched back to for free.
// Whatever a car is already wearing counts as paid for.
export function ownsStyle(id, key, val) {
  if (stylePrice(key, val) === 0) return true;
  if (carStyle(id)[key] === val) return true;
  return !!P.styleOwned?.[id]?.[key + ":" + val];
}
// What saving these changes would cost: only options that are new AND not already paid for.
export function styleCost(id, draft) {
  let total = 0;
  for (const [key, val] of Object.entries(draft || {})) if (!ownsStyle(id, key, val)) total += stylePrice(key, val);
  return total;
}
// The only place styling costs money: one charge for everything in the draft, then it's saved.
export function saveStyle(id, draft) {
  const cost = styleCost(id, draft);
  const r = spend(cost);
  if (!r.ok) return r;
  const owned = ((P.styleOwned ||= {})[id] ||= {});
  for (const [key, val] of Object.entries(draft)) if (stylePrice(key, val) > 0) owned[key + ":" + val] = true;
  (P.styles ||= {})[id] = { ...carStyle(id), ...draft };
  save();
  return { ok: true, price: cost };
}
export function medalCount(best) { return MEDALS.filter((m) => best >= m.at).length; }
export function addXp(amount) {
  P.xp += amount;
  let ups = 0;
  while (P.xp >= xpForLevel(P.level)) { P.xp -= xpForLevel(P.level); P.level++; ups++; }
  return ups;
}
save();

// When this page is served by the project's own Node server, that server owns the wallet: these
// hooks report each transaction so it can validate and reconcile. On static hosting (the public
// site) there is no game server, so the wallet lives here in the browser.
export const walletHooks = { buy: null, payout: null };

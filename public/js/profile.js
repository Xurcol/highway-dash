// Local progression + settings. Saved to localStorage, mirrored into a long-lived cookie so a
// browser that drops site data (or an origin change) can't wipe the garage.
import { store } from "./net.js";
import { CARS, specOf } from "./cars.js";
import { normalizeTune, defaultTune, audioConfig } from "./tuning.js";

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
  name: "", colors: {}, tunes: {}, coins: 250, hearts: 3, owned: ["pebble"], equipped: "pebble", best: 0, level: 1, xp: 0, medals: 0, sv: 0,
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
if (!Array.isArray(P.owned) || !P.owned.length) P.owned = ["pebble"];
if (!CARS.some((c) => c.id === P.equipped)) P.equipped = "pebble";
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
export const carTune = (id) => normalizeTune(carById(id), P.tunes?.[id]);
export const carTuneDefault = (id) => defaultTune(carById(id));
export const carAudio = (id) => audioConfig(carById(id), carTune(id));
export function setTune(id, patch) { P.tunes[id] = { ...carTune(id), ...patch }; save(); return carTune(id); }
export function resetTune(id) { delete P.tunes[id]; save(); }

export function medalCount(best) { return MEDALS.filter((m) => best >= m.at).length; }
export function addXp(amount) {
  P.xp += amount;
  let ups = 0;
  while (P.xp >= xpForLevel(P.level)) { P.xp -= xpForLevel(P.level); P.level++; ups++; }
  return ups;
}
save();

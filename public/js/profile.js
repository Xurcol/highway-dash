// Local progression + settings persisted in localStorage.
import { store } from "./net.js";
import { CARS, specOf } from "./cars.js";
import { DEFAULT_TUNE } from "./engine-dsp.js";

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
  name: "", colors: {}, sounds: {}, tunes: {}, coins: 250, hearts: 3, owned: ["pebble"], equipped: "pebble", best: 0, level: 1, xp: 0, medals: 0,
  settings: { hour: 18.6, flow: false, sky: "Aurora", weather: "Clear", traffic: "Heavy", volMaster: .8, volEngine: .9, volFx: .9, volWind: .35, driveMode: "sport", manual: false, mph: false, shadows: true, res: 1 },
};

export const P = { ...DEFAULTS, ...store.get("hd_profile", {}) };
P.settings = { ...DEFAULTS.settings, ...(P.settings || {}) };
if (!CARS.some((c) => c.id === P.equipped)) P.equipped = "pebble";
if (!P.name) P.name = "Driver" + Math.floor(1000 + Math.random() * 9000);

export const PAINTS = [0xe8c547, 0xc2241f, 0xff6a1a, 0x22b573, 0x4cc3ff, 0x2c55b8, 0x7b3fe4, 0xff4fa0, 0xf2f2f2, 0x9aa1aa, 0x1c1c28, 0x0d5c4a];
export const carColor = (id) => P.colors?.[id] ?? carById(id).color;
export const carSound = (id) => P.sounds?.[id] || carById(id).sound || specOf(carById(id)).sound;
export const TUNE_DEFAULT = { ...DEFAULT_TUNE, engineBrake: 1 };
export const carTune = (id) => ({ ...TUNE_DEFAULT, ...(P.tunes?.[id] || {}) });
export function save() { store.set("hd_profile", P); }
export const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];
export function medalCount(best) { return MEDALS.filter((m) => best >= m.at).length; }
export function addXp(amount) {
  P.xp += amount;
  let ups = 0;
  while (P.xp >= xpForLevel(P.level)) { P.xp -= xpForLevel(P.level); P.level++; ups++; }
  return ups;
}
save();

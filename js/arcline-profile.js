// ARCLINE keeps its own saves while importing the hero progress already earned in Highway Rush.
import { store } from "./net.js?v=mvq292b7";

const KEY = "arc_profile", ACCTS = "arc_accounts", ACTIVE = "arc_active", KEEP = "arc_keep";
const DEFAULTS = {
  name: "", coins: 500, sv: 0,
  hero: { suit: "arcline", owned: ["arcline"], xp: 0, level: 1, best: 0, score: 0, skills: {}, points: 0 },
  settings: { heroMode: "arcline", music: false, volMusic: .35, fpsLimit: "0", graphics: "medium", hour: 17.5, flow: false, sky: "Natural", weather: "Clear", volMaster: .8, volFx: .8, volWind: .3, ambience: .65, hideNames: false },
};
const cookie = {
  get() { try { const m = document.cookie.match(/(?:^|; )arc_save=([^;]*)/); return m ? JSON.parse(decodeURIComponent(m[1])) : null; } catch { return null; } },
  set(data) { try { document.cookie = `arc_save=${encodeURIComponent(JSON.stringify(data))}; max-age=34560000; path=/; SameSite=Lax`; } catch { } },
};
function profile(data = {}) {
  const p = structuredClone(DEFAULTS);
  p.name = String(data.name || "Hero" + Math.floor(1000 + Math.random() * 9000));
  p.coins = Number.isFinite(data.coins) ? Math.max(0, data.coins) : 500;
  p.sv = Number.isFinite(data.sv) ? data.sv : 0;
  Object.assign(p.settings, data.settings || {});
  if (!["low", "medium", "high"].includes(p.settings.graphics)) p.settings.graphics = "medium";
  Object.assign(p.hero, structuredClone(data.hero || {}));
  return p;
}
const local = store.get(KEY, null), backup = cookie.get();
export const P = profile(backup && (!local || backup.sv > local.sv) ? backup : local || store.get("hd_profile", {}));
// Copy credentials once; the backup game continues to own its original accounts and saved garage.
if (store.get(ACCTS, null) === null) {
  store.set(ACCTS, store.get("hd_accounts", {}));
  store.set(ACTIVE, store.get("hd_active", null));
  store.set(KEEP, store.get("hd_keep", false));
}
const accounts = () => store.get(ACCTS, {}) || {};
const idOf = name => String(name || "").trim().toLowerCase();
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
const unhex = s => new Uint8Array((s.match(/../g) || []).map(h => parseInt(h, 16)));
async function hashPass(pass, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 150000 }, key, 256)));
}
export const hasAccounts = () => Object.keys(accounts()).length > 0;
export function currentAccount() { const id = store.get(ACTIVE, null), a = id && accounts()[id]; return a ? { id, name: a.name } : null; }
export const keptAccount = () => store.get(KEEP, false) ? currentAccount() : null;
export const lastUsername = () => currentAccount()?.name || "";
function useSave(id, name, data) {
  const old = store.get(ACTIVE, null);
  if (old && old !== id) store.set("arc_save:" + old, P);
  const next = profile(data || {});
  for (const k of Object.keys(P)) delete P[k];
  Object.assign(P, next, { name });
  store.set(ACTIVE, id);
  save();
}
function accountSave(id) {
  return store.get("arc_save:" + id, null) || store.get("hd_save:" + id, null);
}
export async function register(name, pass, keep) {
  name = String(name || "").trim();
  if (!/^[A-Za-z0-9_.-]{3,16}$/.test(name)) throw new Error("Username: 3 to 16 letters, numbers, _ . or -");
  if (String(pass || "").length < 6) throw new Error("Password: at least 6 characters");
  const all = accounts(), id = idOf(name), first = !Object.keys(all).length;
  if (all[id]) throw new Error("That username is already taken on this device");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  all[id] = { name, salt: hex(salt), hash: await hashPass(pass, salt), created: Date.now() };
  store.set(ACCTS, all);
  useSave(id, name, first ? P : null);
  store.set(KEEP, !!keep);
  return name;
}
export async function login(name, pass, keep) {
  const id = idOf(name), a = accounts()[id];
  if (!a || !pass || await hashPass(pass, unhex(a.salt)) !== a.hash) throw new Error("Wrong username or password");
  useSave(id, a.name, accountSave(id));
  store.set(KEEP, !!keep);
  return a.name;
}
// A separate local save slot keeps guest progress away from account saves.
export function playGuest(name) {
  name = String(name || "").trim();
  if (!/^[A-Za-z0-9_. -]{1,16}$/.test(name) || !/[A-Za-z0-9]/.test(name)) throw new Error("Name: 1 to 16 letters, numbers, spaces, _ . or -");
  useSave("@guest", name, store.get("arc_save:@guest", null));
  store.set(KEEP, false);
  return name;
}
export const lastGuestName = () => store.get("arc_save:@guest", null)?.name || "";
export function resume() {
  const a = keptAccount();
  if (!a) return null;
  useSave(a.id, a.name, accountSave(a.id) || P);
  return a.name;
}
export function save() {
  P.sv = Date.now(); store.set(KEY, P);
  const id = store.get(ACTIVE, null);
  if (id) store.set("arc_save:" + id, P);
  cookie.set({ name: P.name, coins: P.coins, hero: P.hero, sv: P.sv });
}
export function signOut() { save(); store.set(KEEP, false); store.set(ACTIVE, null); }
export function spend(amount) {
  const cost = Math.max(0, Math.round(Number(amount) || 0));
  if (P.coins < cost) return { ok: false, short: cost - P.coins, coins: P.coins };
  P.coins -= cost; save(); return { ok: true, coins: P.coins, spent: cost };
}
export function earn(amount) { P.coins += Math.max(0, Math.round(Number(amount) || 0)); save(); return P.coins; }
for (const event of ["pagehide", "beforeunload"]) addEventListener(event, save);
document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });

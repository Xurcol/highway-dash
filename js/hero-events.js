// Hero mode: what happens in the city. A director keeps a few crimes and emergencies going near the
// heroes - store robberies, gang fights, muggings, hostages held on a rooftop, getaway cars with the
// police behind them, a worker hanging off a crane, a fire with people trapped at a window - each with
// a marker, an objective, a police response, and a reward when it's dealt with.
//
// Solo, this machine runs the director. Online, the host does: the event list is plain data that goes
// out with the enemy snapshots, and everyone draws the same markers, the same civilians, the same fire.
import * as THREE from "three";
import { HeroRig, OUTFITS, poseBody, HIP_H } from "./hero-rig.js?v=mvkadte1";
import { roadAt } from "./city-map.js?v=mvkadte1";

const V = THREE.Vector3;
export const EVENT_TYPES = {
  robbery: { name: "Store Robbery", goal: "Stop the robbers", xp: 240, coins: 260, crime: true },
  gang: { name: "Gang Fight", goal: "Break up the gang", xp: 300, coins: 300, crime: true },
  mugging: { name: "Mugging", goal: "Save the victim", xp: 160, coins: 180, crime: true },
  hostage: { name: "Rooftop Hostage", goal: "Take down the gunmen on the roof", xp: 380, coins: 420, crime: true },
  chase: { name: "Car Chase", goal: "Stop the getaway car (web it, or land on it and hit it)", xp: 360, coins: 380, crime: true },
  crane: { name: "Crane Rescue", goal: "Grab the worker (E near them) and bring them down", xp: 260, coins: 240, rescue: true },
  fire: { name: "Building Fire", goal: "Carry the trapped people down to the street", xp: 320, coins: 320, rescue: true },
  boss: { name: "VANTA", goal: "Defeat VANTA and the crew", xp: 1500, coins: 2500, crime: true, boss: true },
};
const KEYS = Object.keys(EVENT_TYPES).filter((k) => k !== "boss");
let EID = 1;

export class Events {
  constructor(hero) {
    this.hero = hero;
    this.list = [];          // active events (plain data)
    this.civs = new Map();   // civilian rigs by id
    this.nextT = 8;          // seconds until the director looks for something new
    this.done = 0;
  }
  get W() { return this.hero.W; }
  get M() { return this.hero.W.M; }
  rnd() { return Math.random(); }

  // ------------------------------------------------------------------ the director (authority only)
  direct(dt, players) {
    this.nextT -= dt;
    const live = this.list.filter((e) => e.state !== "done" && e.state !== "failed");
    if (this.nextT > 0 || live.length >= Math.min(4, 1 + players.length)) return;
    this.nextT = 35 + Math.random() * 40;
    const p = players[(Math.random() * players.length) | 0];
    const kind = KEYS[(Math.random() * KEYS.length) | 0];
    this.start(kind, p);
  }
  start(kind, near, force) {
    const e = { id: EID++, kind, state: "pending", t: 0, group: 0, civs: [], x: 0, y: 0, z: 0 };
    const ok = this["place_" + kind]?.(e, near, force);
    if (!ok) return null;
    e.group = 1000 + e.id;
    this.list.push(e);
    this.hero.onEvent?.("new", e);
    return e;
  }
  // somewhere near (but not on top of) a hero
  ring(near, r0, r1) { const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0); return [near.x + Math.cos(a) * r, near.z + Math.sin(a) * r]; }
  // a spot on a sidewalk near (x, z)
  sidewalk(x, z, r = 60) {
    let best = null, bd = 1e9;
    for (const s of this.M.slabs) {
      if (s.kind !== "walk" || x < s.x0 - r || x > s.x1 + r || z < s.z0 - r || z > s.z1 + r) continue;
      const qx = Math.max(s.x0 + 1, Math.min(s.x1 - 1, x)), qz = Math.max(s.z0 + 1, Math.min(s.z1 - 1, z));
      // not inside a building footprint
      if (this.W.topAt(qx, qz, 50) > 1) continue;
      const d = Math.hypot(qx - x, qz - z);
      if (d < bd) { bd = d; best = { x: qx, z: qz, y: s.h }; }
    }
    return best;
  }
  place_robbery(e, near) {
    // in front of a shop: a lit sign over a door on a downtown street
    const signs = this.M.shopSigns.filter((s) => { const d = Math.hypot(s.x - near.x, s.z - near.z); return d > 90 && d < 380; });
    if (!signs.length) return this.place_gang(e, near);
    const s = signs[(Math.random() * signs.length) | 0];
    const w = this.sidewalk(s.x, s.z, 12) || { x: s.x, z: s.z, y: .15 };
    Object.assign(e, { x: w.x, y: w.y, z: w.z, enemies: ["thug", "thug", "bat", "gunner"].concat(Math.random() < .4 ? ["thug"] : []), props: ["crate", "bin", "canister"], police: true });
    return true;
  }
  place_gang(e, near) {
    const [x, z] = this.ring(near, 120, 420), w = this.sidewalk(x, z, 80);
    if (!w) return false;
    Object.assign(e, { x: w.x, y: w.y, z: w.z, enemies: ["thug", "thug", "bat", "thug", "gunner", "brute"].concat(Math.random() < .5 ? ["rifle", "thug"] : []), props: ["barrel", "crate", "canister", "bin"], police: Math.random() < .5 });
    return true;
  }
  place_mugging(e, near) {
    const [x, z] = this.ring(near, 80, 300), w = this.sidewalk(x, z, 60);
    if (!w) return false;
    Object.assign(e, { x: w.x, y: w.y, z: w.z, enemies: ["thug", "bat"], civs: [{ id: e.id * 10, x: w.x + 1.5, z: w.z + .5, y: w.y, pose: "cower" }] });
    return true;
  }
  place_hostage(e, near) {
    // the roof of a mid-rise building
    const cands = this.W.solids.filter((s) => s.kind === "bldg" && s.y1 > 25 && s.y1 < 90 && s.x1 - s.x0 > 18 && s.z1 - s.z0 > 18 && Math.hypot((s.x0 + s.x1) / 2 - near.x, (s.z0 + s.z1) / 2 - near.z) < 400 && Math.hypot((s.x0 + s.x1) / 2 - near.x, (s.z0 + s.z1) / 2 - near.z) > 100);
    if (!cands.length) return this.place_gang(e, near);
    const b = cands[(Math.random() * cands.length) | 0], x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2, y = this.W.topAt(x, z, b.y1 + 2);
    Object.assign(e, { x, y, z, roof: true, enemies: ["gunner", "rifle", "thug", "thug", "bat"], civs: [{ id: e.id * 10, x: x + 2, z: z + 1.5, y, pose: "kneel" }, { id: e.id * 10 + 1, x: x - 2, z: z + 2, y, pose: "kneel" }] });
    return true;
  }
  place_chase(e, near) {
    const traffic = this.hero.ctx.city.traffic;
    const cars = traffic?.cars.filter((c) => { const d = Math.hypot(c.x - near.x, c.z - near.z); return d > 80 && d < 260 && c.link.kind !== "hwy" && c.body !== "bus" && c.body !== "truck" && !c.ev; }) || [];
    if (!cars.length) return false;
    const c = cars[(Math.random() * cars.length) | 0];
    c.wild = true; c.k = 2.1; c.chase = e.id; c.ev = null; c.color = 0x7a1f2b;
    const m = this.hero.ctx.city.meshes.get(c); m?.children[0]?.userData?.setColor?.(c.color);
    Object.assign(e, { car: c.id, carRef: c, hp: 6, x: c.x, y: c.y, z: c.z, timer: 150 });
    return true;
  }
  // the boss: an open plaza or a wide roof near whoever challenged, with a crew
  place_boss(e, near) {
    const spots = [];
    for (const s of this.M.slabs) if ((s.kind === "park" || s.kind === "walk") && s.x1 - s.x0 > 30 && s.z1 - s.z0 > 30) { const x = (s.x0 + s.x1) / 2, z = (s.z0 + s.z1) / 2, d = Math.hypot(x - near.x, z - near.z); if (d > 60 && d < 500 && this.W.topAt(x, z, 40) < 1) spots.push({ x, z, y: s.h }); }
    const w = spots.length ? spots[(Math.random() * spots.length) | 0] : this.sidewalk(near.x + 120, near.z, 200);
    if (!w) return false;
    Object.assign(e, { x: w.x, y: w.y, z: w.z, enemies: ["boss", "thug", "thug", "gunner", "bat", "rifle", "brute"], props: ["canister", "canister", "barrel", "crate"], police: true });
    return true;
  }
  place_crane(e, near) {
    const cr = this.M.hx?.cranes.filter((c) => Math.hypot(c.x - near.x, c.z - near.z) < 600) || [];
    if (!cr.length) return this.place_fire(e, near);
    const c = cr[(Math.random() * cr.length) | 0], ux = Math.cos(c.ang), uz = Math.sin(c.ang);
    const hx = c.x + ux * c.jib * .7, hz = c.z + uz * c.jib * .7, y = c.h - c.hook;
    Object.assign(e, { x: hx, y, z: hz, civs: [{ id: e.id * 10, x: hx + 1.2, z: hz, y: y - .4, pose: "hang" }] });
    return true;
  }
  place_fire(e, near) {
    const cands = this.W.solids.filter((s) => s.kind === "bldg" && s.y0 < .3 && s.y1 > 30 && s.y1 < 140 && Math.hypot((s.x0 + s.x1) / 2 - near.x, (s.z0 + s.z1) / 2 - near.z) < 420 && Math.hypot((s.x0 + s.x1) / 2 - near.x, (s.z0 + s.z1) / 2 - near.z) > 80);
    if (!cands.length) return false;
    const b = cands[(Math.random() * cands.length) | 0];
    // a window on a face that looks onto open space
    const faces = [[b.x0, (b.z0 + b.z1) / 2, -1, 0], [b.x1, (b.z0 + b.z1) / 2, 1, 0], [(b.x0 + b.x1) / 2, b.z0, 0, -1], [(b.x0 + b.x1) / 2, b.z1, 0, 1]];
    const f = faces.find(([x, z, nx, nz]) => this.W.topAt(x + nx * 6, z + nz * 6, 20) < 1) || faces[0];
    const y = Math.min(b.y1 - 6, 18 + Math.random() * 22);
    const civs = [0, 1].map((k) => ({ id: e.id * 10 + k, x: f[0] + f[2] * .8 + (f[3] ? (k - .5) * 4 : 0), z: f[1] + f[3] * .8 + (f[2] ? (k - .5) * 4 : 0), y, pose: "wave", ledge: true }));
    Object.assign(e, { x: f[0] + f[2] * .5, y, z: f[1] + f[3] * .5, nx: f[2], nz: f[3], civs, fire: true });
    return true;
  }

  // ------------------------------------------------------------------ running them (authority)
  step(dt, players) {
    const H = this.hero;
    for (const e of this.list) {
      e.t += dt;
      const near = Math.min(...players.map((p) => Math.hypot(p.x - e.x, p.z - e.z)));
      if (e.state === "pending" && near < (e.kind === "chase" ? 260 : 170)) this.activate(e);
      if (e.state === "active") {
        if (e.kind === "chase") this.stepChase(e, dt, players);
        else if (EVENT_TYPES[e.kind].crime) {
          const mine = H.sim.list.filter((q) => q.group === e.group);
          const left = mine.filter((q) => H.sim.alive(q)).length;
          e.left = left;
          if (e.spawned && left === 0) this.finish(e);
        } else {
          e.left = e.civs.filter((c) => !c.saved).length;
          if (e.left === 0) this.finish(e);
        }
      }
      if ((e.state === "pending" && e.t > 300) || (e.state === "active" && e.t > 420)) { e.state = "failed"; e.t = 0; H.onEvent?.("failed", e); }
    }
    // tidy away the finished ones a little later
    for (let i = this.list.length - 1; i >= 0; i--) { const e = this.list[i]; if ((e.state === "done" || e.state === "failed") && e.t > 12) { this.cleanup(e); this.list.splice(i, 1); } }
  }
  activate(e) {
    const H = this.hero;
    e.state = "active"; e.t = 0;
    if (e.enemies) {
      H.spawnGang(e.x, e.z, e.enemies, { group: e.group, props: e.props, y: e.y, guard: e.roof ? 6 : 10 });
      e.spawned = true;
    }
    if (e.police) {
      // a car pulled up across the street, officers covering the scene
      let spot = null;
      for (let k = 0; k < 24 && !spot; k++) { const a = k * .7, r = 9 + (k % 4) * 3, px = e.x + Math.cos(a) * r, pz = e.z + Math.sin(a) * r; if (roadAt(this.M, px, pz) && this.W.topAt(px, pz, 3) < .2) spot = { x: px, z: pz }; }
      if (spot) e.parked = H.life?.emergency.park(spot.x, spot.z, Math.atan2(e.x - spot.x, e.z - spot.z) + Math.PI / 2);
    }
    H.onEvent?.("active", e);
  }
  stepChase(e, dt, players) {
    const c = e.carRef;
    if (!c || c.dead) { e.state = "failed"; e.t = 0; this.hero.onEvent?.("failed", e); return; }
    e.x = c.x; e.y = c.y; e.z = c.z;
    if (e.hp > 0) {
      e.timer -= dt;
      const near = Math.min(...players.map((p) => Math.hypot(p.x - c.x, p.z - c.z)));
      if (e.timer <= 0 || near > 520) { e.state = "failed"; e.t = 0; c.wild = false; c.k = 1; this.hero.onEvent?.("failed", e); }
    } else if (!e.stopped) {
      // stopped: the crew bail out and fight
      e.stopped = true; c.wild = false; c.k = 0; c.v = 0;
      this.hero.spawnGang(c.x, c.z, ["thug", "bat", "gunner"], { group: e.group, y: c.y });
      e.spawned = true;
      this.hero.onEvent?.("stopped", e);
    } else {
      c.v = 0;
      const left = this.hero.sim.list.filter((q) => q.group === e.group && this.hero.sim.alive(q)).length;
      e.left = left;
      if (left === 0) this.finish(e);
    }
  }
  // the getaway car was hit (by a web shot, an impact web, a punch from its roof)
  hitCar(carId, n = 1) {
    const e = this.list.find((q) => q.kind === "chase" && q.car === carId && q.state === "active");
    if (!e || e.hp <= 0) return false;
    e.hp = Math.max(0, e.hp - n);
    const c = e.carRef;
    if (c) c.k = Math.max(.4, c.k - .25 * n);
    this.hero.onEvent?.("carhit", e);
    return true;
  }
  finish(e) {
    e.state = "done"; e.t = 0; this.done++;
    this.hero.onEvent?.("done", e);
  }
  cleanup(e) {
    if (e.parked) { this.hero.life?.emergency.unpark(e.parked); e.parked = null; }
    if (e.carRef) { e.carRef.wild = false; e.carRef.k = 1; e.carRef.chase = null; }
    for (const c of e.civs) this.dropCiv(c.id);
  }
  clear() { for (const e of this.list) this.cleanup(e); this.list.length = 0; }

  // ------------------------------------------------------------------ civilians to save
  // the civilian a hero is near enough to grab
  grabbable(p) {
    for (const e of this.list) {
      if (e.state !== "active" || !e.civs) continue;
      if (EVENT_TYPES[e.kind].crime && e.kind !== "mugging") continue;
      for (const c of e.civs) if (!c.saved && !c.carried && Math.hypot(c.x - p.x, c.y + .9 - p.y, c.z - p.z) < 3.4) return { e, c };
    }
    return null;
  }
  // the mugging's victim is safe once the muggers are down
  // (and a carried civilian is saved when set down on the street)
  setDown(e, c, x, y, z) {
    c.carried = null; c.x = x; c.y = y; c.z = z;
    if (y < 1.5 && !this.W.underAt?.(x, z)) { c.saved = true; c.pose = "cheer"; this.hero.onEvent?.("saved", e, c); }
  }

  // ------------------------------------------------------------------ drawing (every machine)
  draw(dt, T, glows, parts) {
    const seen = new Set();
    for (const e of this.list) {
      for (const c of e.civs || []) {
        seen.add(c.id);
        let r = this.civs.get(c.id);
        if (!r) { r = { rig: new HeroRig(OUTFITS.civ), t: Math.random() * 5 }; const U = r.rig.mat.userData.u; U.uBase.value.setHex([0x4a5a70, 0x7a3a2a, 0x2e5d3a, 0xc8b88a][c.id % 4]); this.hero.ctx.scene.add(r.rig.group); this.civs.set(c.id, r); }
        r.t += dt;
        const pose = c.carried ? "carried" : c.pose;
        let y = c.y + HIP_H;
        if (pose === "hang") y = c.y - .2;
        if (pose === "kneel") y = c.y + .55;
        if (c.carried) { const hp = this.hero.carryPoint?.(c); if (hp) { c.x = hp.x; c.y = hp.y - HIP_H; c.z = hp.z; y = hp.y; } }
        _p.set(c.x, y, c.z);
        const yaw = c.yaw ?? (e.nx !== undefined ? Math.atan2(e.nx, e.nz) : 0);
        r.rig.place(_p, _u.set(0, 1, 0), _f.set(Math.sin(yaw), 0, Math.cos(yaw)), null, dt, 8);
        const a = { state: pose === "hang" ? "ledge" : "ground", hs: 0, speed: 0, vy: 0, phase: 0, t: r.t, landT: 9, attack: null };
        if (pose === "cower" || pose === "kneel") { a.crouch = true; }
        if (pose === "wave") a.attack = { kind: "emote", id: 0, t: r.t, k: .5 };
        if (pose === "cheer") a.attack = { kind: "emote", id: 4, t: r.t, k: .5 };
        if (pose === "carried") { a.state = "air"; a.vy = -2; }
        const rr = poseBody(r.rig, a);
        r.rig.apply(dt, rr);
      }
      // the fire: flames and smoke out of the window, glowing at night
      if (e.fire && e.state !== "done") {
        for (let k = 0; k < 3; k++) parts.emit({ x: e.x + (Math.random() - .5) * 6 * Math.abs(e.nz || 1), y: e.y + 1 + Math.random(), z: e.z + (Math.random() - .5) * 6 * Math.abs(e.nx || 1), vx: (e.nx || 0) * 2, vy: 3, vz: (e.nz || 0) * 2, spread: 1, n: 1, life: .8, size: .9, grow: 1.5, drag: 1, r: 2.6, gg: 1.1, b: .25, a: .9, glow: true });
        if (Math.random() < .6) parts.emit({ x: e.x + (Math.random() - .5) * 5, y: e.y + 3, z: e.z, vx: (e.nx || 0) * 1.5, vy: 4, vz: (e.nz || 0) * 1.5, spread: 1.2, n: 1, life: 3, size: 2, grow: 4, drag: .6, r: .12, gg: .11, b: .1, a: .55 });
        glows.add(e.x + (e.nx || 0) * .5, e.y + 1.5, e.z + (e.nz || 0) * .5, 3, 1.3, .3, 6);
      }
    }
    for (const [id, r] of this.civs) if (!seen.has(id)) { this.hero.ctx.scene.remove(r.rig.group); r.rig.dispose(); this.civs.delete(id); }
  }
  dropCiv(id) { const r = this.civs.get(id); if (r) { this.hero.ctx.scene.remove(r.rig.group); r.rig.dispose(); this.civs.delete(id); } }
  // the panel text for the event that matters most to this hero, and markers for the map
  nearest(p) {
    let best = null, bd = 1e9;
    for (const e of this.list) { if (e.state === "done" || e.state === "failed") continue; const d = Math.hypot(e.x - p.x, e.z - p.z); if (d < bd) { bd = d; best = e; } }
    return best ? { e: best, d: bd } : null;
  }
  // plain data for the network
  snapshot() {
    return this.list.map((e) => ({ id: e.id, kind: e.kind, state: e.state, x: Math.round(e.x * 10) / 10, y: Math.round(e.y * 10) / 10, z: Math.round(e.z * 10) / 10, left: e.left ?? null, hp: e.hp ?? null, nx: e.nx, nz: e.nz, fire: !!e.fire,
      civs: (e.civs || []).map((c) => ({ id: c.id, x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, z: Math.round(c.z * 10) / 10, pose: c.pose, saved: !!c.saved, carried: c.carried || null })) }));
  }
  // what the host sent (clients only): keep our civilians' rigs, take the host's positions
  apply(list) {
    if (!Array.isArray(list)) return;
    const prev = new Map(this.list.map((e) => [e.id, e]));
    this.list = list.slice(0, 12).map((s) => {
      const e = prev.get(s.id) || {};
      if (!prev.has(s.id)) this.hero.onEvent?.("new", s);
      else if (e.state !== s.state) this.hero.onEvent?.(s.state, s);
      const civs = (s.civs || []).slice(0, 4).map((c) => { const old = e.civs?.find((o) => o.id === c.id); return old && old.carried === this.hero.meId() ? old : { ...c }; });
      return { ...e, ...s, civs };
    });
  }
}
const _p = new V(), _u = new V(), _f = new V();

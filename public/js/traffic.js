// Deterministic traffic: every car's position is a pure function of (seed, time), so all
// players in a party see identical traffic without syncing it. Some cars signal and swerve
// into the neighbouring lane; the swerve only happens when that lane is provably clear.
import * as THREE from "three";
import { makeTrafficCar, BODIES } from "./cars.js";
import { hash, laneX, oppLaneX, LANES } from "./world.js";

export const TRAFFIC_LEVELS = { Chill: .24, Normal: .38, Heavy: .5, Insane: .64 };
const SAME_V = [118, 106, 96, 86, 74].map((k) => k / 3.6);
const OPP_V = [84, 95, 106, 115, 124].map((k) => k / 3.6);
const S = 34;
const PALETTE = [0xf2f2f2, 0x1d1f24, 0x9aa1aa, 0xc62828, 0x1e5bd8, 0xf2c230, 0x2e7d4f, 0x6d3fb0, 0xe0701c, 0x7a1f2b, 0x5b6f86, 0xd8cbb0];
const SMALL = ["hatch", "sedan", "sedan", "suv", "sedan", "hatch", "pickup", "van", "suv", "coupe", "muscle", "sedan", "suv", "hatch", "m340i", "q50", "x5m", "charger", "golfr", "c63", "rs6", "x3m"];
const SWERVE_TARGET = { 0: 1, 2: 3 }; // each receiving lane has one source lane, so swerves can't collide
const WIN = 8.6;
// A lane change: signal for OUT_AT seconds, pull across, sit there, signal again, come back.
const OUT_AT = 2.2, OUT_LEN = 1.5, BACK_AT = 5.8, BACK_LEN = 1.6;
// A swerving car will not pull into a lane a driver is using. The window has to cover the whole
// maneuver, not just this instant: a player closing at 250 km/h on 100 km/h traffic covers ~390 m
// while the lane change plays out, so anything nearer than this would be a cut-off with no warning.
export const SWERVE_CLEAR = { lane: 3.4, ahead: 150, behind: 420 };
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class Traffic {
  constructor(scene) {
    this.scene = scene;
    this.seed = 1; this.base = TRAFFIC_LEVELS.Heavy; this.ramp = true;
    this.pool = new Map();
    this.active = new Map();
    this.cars = [];
    this.bumped = new Map();
    this.lightPool = [];
    this.players = [];        // every driver in the session, so nobody gets cut off
    this.blocked = new Map(); // maneuver id -> true, latched so a decision never flickers
  }
  // main.js hands us the local player plus every remote one each frame
  setPlayers(list) { this.players = list; }
  setSeed(seed, level = "Heavy", ramp = true) {
    this.seed = seed | 0;
    this.base = TRAFFIC_LEVELS[level] ?? TRAFFIC_LEVELS.Heavy;
    this.ramp = ramp;
    for (const [, m] of this.active) this.release(m);
    this.active.clear(); this.bumped.clear(); this.blocked.clear();
  }
  density(j) { return this.base + (this.ramp ? Math.min(.22, Math.max(0, -j * S) / 26000) : .08); }

  raw(dir, lane, j) {
    const k = dir * 1000 + lane, seed = this.seed;
    if (hash(seed, k, j) > this.density(j)) return null;
    const h = (i) => hash(seed + i * 7919, k, j);
    let body;
    if (lane >= 3 && h(4) < .22) body = h(5) < .3 ? "bus" : "truck";
    else body = SMALL[(h(6) * SMALL.length) | 0];
    const v = (dir > 0 ? SAME_V : OPP_V)[lane];
    const z0 = j * S + (h(1) - .5) * (body === "bus" || body === "truck" ? 3 : 10);
    const ph = h(2) * 6.283;
    return { key: `${dir}:${lane}:${j}`, h, body, dir, lane, j, v, z0, ph, L: BODIES[body].L, W: BODIES[body].W, color: PALETTE[(h(7) * PALETTE.length) | 0] };
  }
  zAt(c, t) { return (c.dir > 0 ? c.z0 - c.v * t : c.z0 + c.v * t) + Math.sin(t * .12 + c.ph) * 1.5; }

  // can car c occupy target lane during [t0, t1] without meeting anyone there?
  swerveSafe(c, target, t0, t1) {
    const vt = SAME_V[target];
    const za = this.zAt(c, t0), zb = this.zAt(c, t1);
    const lo = Math.min(za + vt * t0, zb + vt * t1) - 60, hi = Math.max(za + vt * t0, zb + vt * t1) + 60;
    for (let j = Math.floor(lo / S); j <= Math.ceil(hi / S); j++) {
      const o = this.raw(1, target, j);
      if (!o) continue;
      const d0 = this.zAt(o, t0) - za, d1 = this.zAt(o, t1) - zb, need = (c.L + o.L) / 2 + 9;
      if (Math.sign(d0) !== Math.sign(d1) || Math.abs(d0) < need || Math.abs(d1) < need) return false;
    }
    return true;
  }
  // Would pulling into `target` put this car on top of a driver? Decided once per maneuver and
  // latched, so a borderline case can't flicker (and so every client in a party agrees).
  playerClear(c, target, mid, tl) {
    if (this.blocked.has(mid)) return !this.blocked.get(mid);
    // a car that scrolled into view already half-way across finishes the move: yanking it back
    // would look like a teleport, and it is not the cut-off case we are guarding against
    if (tl > OUT_AT) { this.blocked.set(mid, false); return true; }
    const tx = laneX(target);
    let ok = true;
    for (const p of this.players) {
      if (Math.abs(p.x - tx) > SWERVE_CLEAR.lane) continue;
      if (p.z > c.z - SWERVE_CLEAR.ahead && p.z < c.z + SWERVE_CLEAR.behind) { ok = false; break; }
    }
    if (this.blocked.size > 400) this.blocked.clear();
    this.blocked.set(mid, !ok);
    return ok;
  }
  resolve(c, T) {
    c.z = this.zAt(c, T);
    const baseX = c.dir > 0 ? laneX(c.lane) : oppLaneX(c.lane);
    c.x = baseX + Math.sin(T * .27 + c.ph * 1.7) * .2;
    c.sig = 0;
    const target = SWERVE_TARGET[c.lane];
    if (c.dir > 0 && target !== undefined && c.h(8) < .45 && c.body !== "bus") {
      const P = 15 + c.h(9) * 14, phase = T + c.h(10) * P, tl = ((phase % P) + P) % P;
      if (tl < WIN) {
        const T0 = T - tl;
        if (this.swerveSafe(c, target, T0 + 1, T0 + WIN) && this.playerClear(c, target, `${c.key}:${Math.floor(phase / P)}`, tl)) {
          const k = smooth((tl - OUT_AT) / OUT_LEN) * (1 - smooth((tl - BACK_AT) / BACK_LEN));
          c.x += (laneX(target) - baseX) * k;
          // +1 while pulling across, -1 while coming back: the indicator has to follow the direction
          // the car is actually moving, not the lane it started in
          if (tl < OUT_AT + .4) c.sig = 1;
          else if (tl > BACK_AT - .6 && tl < BACK_AT + BACK_LEN) c.sig = -1;
        }
      }
    }
    return c;
  }
  query(T, zAhead, zBehind, dirs = [1, -1]) {
    const out = [];
    for (const dir of dirs) for (let lane = 0; lane < LANES; lane++) {
      const v = (dir > 0 ? SAME_V : OPP_V)[lane];
      const shift = dir > 0 ? v * T : -v * T;
      const j0 = Math.ceil((zAhead + shift - 12) / S), j1 = Math.floor((zBehind + shift + 12) / S);
      for (let j = j0; j <= j1; j++) {
        const c = this.raw(dir, lane, j);
        if (!c) continue;
        this.resolve(c, T);
        if (c.z >= zAhead && c.z <= zBehind) out.push(c);
      }
    }
    return out;
  }
  // true when no same-direction car occupies lane space around z
  laneClear(T, x, z, ahead = 45, behind = 25) {
    return !this.query(T, z - ahead - 20, z + behind + 20, [1]).some((c) => Math.abs(c.x - x) < 3.4 && c.z > z - ahead && c.z < z + behind);
  }
  release(m) { m.visible = false; const p = this.pool.get(m.userData.body) || []; p.push(m); this.pool.set(m.userData.body, p); }
  acquire(body, color) {
    const p = this.pool.get(body);
    let m = p && p.pop();
    if (!m) { m = makeTrafficCar(body, color); this.scene.add(m); }
    m.children[0].userData.setColor(color);
    m.visible = true;
    return m;
  }
  // Knocked cars are shared: the crashing player broadcasts (key, speed, side, kick) so that
  // everyone in the party sees the same car spin off, not just the one who hit it.
  bump(car, impactV, sideSign, kick = null) {
    if (this.bumped.has(car.key)) return null;
    const k = kick || { vx: sideSign * (2 + Math.random() * 3), vr: sideSign * (1 + Math.random() * 2) };
    this.bumped.set(car.key, { dx: 0, dz: 0, vx: k.vx, vz: -impactV * .35, rot: 0, vr: k.vr, t: 0 });
    return { key: car.key, v: impactV, ...k };
  }
  // same impulse, wound forward by however long the message took to arrive
  bumpRemote(key, impactV, kick, age = 0) {
    if (this.bumped.has(key) || !/^-?\d+:\d+:-?\d+$/.test(key)) return;
    this.bump({ key }, impactV, Math.sign(kick.vx) || 1, kick);
    const b = this.bumped.get(key), lane = +key.split(":")[1], cv = SAME_V[Math.min(SAME_V.length - 1, lane)] || 30;
    for (let t = 0; t < Math.min(3, age); t += .05) {
      b.t += .05; b.vx *= Math.exp(-.1); b.vz *= Math.exp(-.075); b.vr *= Math.exp(-.1);
      b.dx += b.vx * .05; b.dz += b.vz * .05 + cv * .05 * Math.min(1, b.t); b.rot += b.vr * .05;
    }
  }
  // cheap fingerprint of the traffic around z, for checking that a party really is in sync
  stateHash(T, z) {
    let h = 0;
    for (const c of this.query(T, z - 400, z + 60)) h = (h * 31 + Math.round(c.z * 4) + Math.round(c.x * 8) * 7919) | 0;
    return h;
  }
  // Fingerprint of the SIMULATION itself over a fixed slice of road, independent of where anyone is
  // standing: seed, density, which slots spawned, lane, direction, model, colour and position at
  // time T. Two clients in a party exchange this; if it ever differs they are not running the same
  // traffic and the receiver re-seeds from the room. The swerve offset is deliberately left out -
  // it depends on where the drivers are, which is the one thing that legitimately differs.
  worldHash(T) {
    let h = Math.round(this.base * 1000) ^ (this.seed | 0) ^ (this.ramp ? 1 : 0);
    for (let j = -20; j < 20; j++) for (const dir of [1, -1]) for (let lane = 0; lane < LANES; lane++) {
      const c = this.raw(dir, lane, j);
      if (!c) continue;
      h = (h * 31 + Math.round(this.zAt(c, T) * 4) + c.color + c.lane * 7 + c.dir * 3 + c.body.charCodeAt(0) * 13 + Math.round(c.v * 10)) | 0;
    }
    return h;
  }
  update(dt, T, focusZ, night, glows, lights, camPos, hidden = null) {
    const cars = this.query(T, focusZ - 900, focusZ + 80);
    const seen = new Set();
    this.cars.length = 0;
    let lightN = 0;
    const blink = Math.floor(T * 2.8) % 2 === 0;
    for (const c of cars) {
      seen.add(c.key);
      let m = this.active.get(c.key);
      if (!m) { m = this.acquire(c.body, c.color); this.active.set(c.key, m); }
      let rot = c.dir > 0 ? 0 : Math.PI;
      const b = this.bumped.get(c.key);
      if (b) {
        b.t += dt; b.vx *= Math.exp(-dt * 2); b.vz *= Math.exp(-dt * 1.5); b.vr *= Math.exp(-dt * 2);
        b.dx += b.vx * dt; b.dz += b.vz * dt + c.v * dt * Math.min(1, b.t); b.rot += b.vr * dt;
        c.x += b.dx; c.z += b.dz; rot += b.rot; c.sig = 0;
      }
      m.position.set(c.x, 0, c.z);
      m.rotation.y = rot;
      this.cars.push(c);
      m.visible = !(hidden && hidden.has(c.key));
      if (!m.visible) continue;

      const B = BODIES[c.body], hw = c.W / 2 - .3;
      if (c.sig && blink && Math.abs(c.z - focusZ) < 300) {
        const side = (SWERVE_TARGET[c.lane] > c.lane ? 1 : -1) * c.sig;
        glows.add(c.x + side * hw, B.tl[1], c.z + c.L / 2 + .05, 1, .55, .05, 1.2);
        glows.add(c.x + side * hw, B.hl[1], c.z - c.L / 2 - .05, 1, .55, .05, 1.0);
      }
      if (night) {
        if (c.dir > 0) {
          for (const s of [-1, 1]) glows.add(c.x + s * hw, B.tl[1], c.z + c.L / 2 + .05, 1, .08, .05, .9);
          if (lightN < 8 && c.z < camPos.z && c.z > camPos.z - 160) {
            const L = this.lightPool[lightN++] ||= { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -.12, -1).normalize(), color: new THREE.Color(1, .95, .85), intensity: 4, range: 45, cosOuter: Math.cos(.5), cosInner: Math.cos(.22) };
            L.pos.set(c.x, B.hl[1] + .1, c.z - c.L / 2 - .3);
            lights.push(L);
          }
        } else {
          for (const s of [-1, 1]) glows.add(c.x + s * hw, B.hl[1], c.z + c.L / 2 + .05, 1, .95, .8, 1.6);
        }
      }
    }
    for (const [key, m] of this.active) if (!seen.has(key)) { this.release(m); this.active.delete(key); this.bumped.delete(key); }
  }
}

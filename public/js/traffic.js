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
const WIN = 7.5;
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
  }
  setSeed(seed, level = "Heavy", ramp = true) {
    this.seed = seed | 0;
    this.base = TRAFFIC_LEVELS[level] ?? TRAFFIC_LEVELS.Heavy;
    this.ramp = ramp;
    for (const [, m] of this.active) this.release(m);
    this.active.clear(); this.bumped.clear();
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
  resolve(c, T) {
    c.z = this.zAt(c, T);
    const baseX = c.dir > 0 ? laneX(c.lane) : oppLaneX(c.lane);
    c.x = baseX + Math.sin(T * .27 + c.ph * 1.7) * .2;
    c.sig = 0;
    const target = SWERVE_TARGET[c.lane];
    if (c.dir > 0 && target !== undefined && c.h(8) < .45 && c.body !== "bus") {
      const P = 15 + c.h(9) * 14, tl = (((T + c.h(10) * P) % P) + P) % P;
      if (tl < WIN) {
        const T0 = T - tl;
        if (this.swerveSafe(c, target, T0 + 1, T0 + WIN)) {
          const k = smooth((tl - 1.2) / 1.5) * (1 - smooth((tl - 5.6) / 1.6));
          c.x += (laneX(target) - baseX) * k;
          if (tl < 2.7) c.sig = 1;
          else if (tl > 5 && tl < 7.2) c.sig = -1;
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
  bump(car, impactV, sideSign) {
    if (this.bumped.has(car.key)) return;
    this.bumped.set(car.key, { dx: 0, dz: 0, vx: sideSign * (2 + Math.random() * 3), vz: -impactV * .35, rot: 0, vr: sideSign * (1 + Math.random() * 2), t: 0 });
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
        const side = SWERVE_TARGET[c.lane] > c.lane ? 1 : -1;
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

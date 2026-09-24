// Deterministic traffic: every car's position is a pure function of (seed, time), so all
// players in a party see identical traffic without syncing it. Some cars signal and swerve
// into the neighbouring lane; the swerve only happens when that lane is provably clear.
import * as THREE from "three";
import { makeTrafficCar, makeTrafficBike, BODIES } from "./cars.js";
import { hash, laneX, LANES, LW, ROAD_HALF, tunnelAmount } from "./world.js";

export const TRAFFIC_LEVELS = { Chill: .24, Normal: .38, Heavy: .5, Insane: .64 };
// Each lane cruises at its own speed, fastest on the inside (the yellow-line side) and slowest on
// the outside, 60 to 80 mph. Cars in a lane average their lane's speed, so spacing inside a lane only
// breathes by a few metres (see DRIFT_*); the difference between lanes is what breaks up a row of cars
// that spawned side by side.
export const LANE_MPH = [80, 75, 70, 65, 60];
const MPH = 0.44704;                       // metres per second per mile per hour
const SAME_V = LANE_MPH.map((m) => m * MPH);
// Slot pitch. Slots roll independently, so at 34m and up to 86% full a lane was a near-continuous
// chain of cars 20-odd metres apart, and five lanes of it read as a wall.
const S = 42;
const PALETTE = [0xf2f2f2, 0x1d1f24, 0x9aa1aa, 0xc62828, 0x1e5bd8, 0xf2c230, 0x2e7d4f, 0x6d3fb0, 0xe0701c, 0x7a1f2b, 0x5b6f86, 0xd8cbb0];
const SMALL = ["hatch", "sedan", "sedan", "suv", "sedan", "hatch", "pickup", "van", "suv", "coupe", "muscle", "sedan", "suv", "hatch", "m340i", "q50", "x5m", "charger", "golfr", "c63", "rs6", "x3m", "bike", "bike"];
// Roadside scenes on the right shoulder, one chance every SCENE_S metres: a police stop (a car pulled
// over with a cruiser behind it, light bar going) or a breakdown with its hazards on. They stand
// still, sit clear of the slow lane, and are a pure function of the seed like everything else here.
const SCENE_S = 560, SCENE_P = .3, SCENE_X = ROAD_HALF + .9;
const PARKED = ["sedan", "hatch", "suv", "pickup", "van", "coupe", "muscle", "sedan", "suv"];
const ONE = [0], TWO = [-1, 1];
// Emergency vehicles. They come up behind the player down an emergency corridor opened between the
// two left lanes: the leftmost lane moves left, every other lane moves right, less the further from
// the gap (YIELD_X, metres per lane). The biggest thing in lanes 0-1 is 2 m wide, so a fully open
// corridor is ~4.2 m for a vehicle of at most 2.45 m. model: the pooled mesh, body: its size.
const CORRIDOR_X = laneX(0) + LW / 2;
const YIELD_X = [-1.15, 1.1, .7, .35, .1];
export const EV_TYPES = {
  police: { model: "cop", body: "sedan", color: 0x121418, name: "Police" },
  ambulance: { model: "amb", body: "van", color: 0xf2f2f2, name: "Ambulance" },
  fire: { model: "fire", body: "truck", color: 0xb81c1c, name: "Fire engine" },
};
// where each model's light bar sits along the roof (z, metres, + = rearward) and its two colours
const BARS = { cop: { z: .35, a: [3, .06, .08], b: [.06, .12, 3] }, amb: { z: -.5, a: [3, .06, .08], b: [2.4, 2.4, 2.4] }, fire: { z: -2.2, a: [3, .06, .06], b: [3, .25, .05] } };
// how much a car has moved over for an emergency vehicle d metres behind it (d < 0: already past)
const yieldK = (d) => (d > 250 ? 0 : d > 150 ? smooth((250 - d) / 100) : d > -25 ? 1 : d > -60 ? smooth((d + 60) / 35) : 0);
// Following a driver who is holding the lane up (an intelligent-driver model): a comfortable pull
// away and a comfortable brake, a hard limit for emergencies, a standstill gap and a time gap.
const IDM = { a: 2.2, b: 3.5, bMax: 9, s0: 4, th: 1.0, catchUp: 4 };
// How far a driver drifts ahead of or behind their slot while easing on and off the throttle (see
// raw()). Two cars in adjacent slots of one lane are at least 26.7 m bumper to bumper (42 m pitch,
// minus spawn jitter, minus half of each car's length - two 5.3 m cars is the tightest pair; a bus
// behind a car still leaves 27.4 m), so drifting up to 8 m each can never close that gap: the worst
// case still leaves 10.7 m.
const DRIFT_CAR = 8, DRIFT_HEAVY = 4;
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
    this.reacts = new Map();  // key -> { t, flash }: drivers you just cut off (local only, cosmetic)
    this.bikeX = new Map();   // last x of each motorbike, for its lean
    this.copLights = [];
    // Cars held up by a player: key -> { z, v, acc, dir, lane, j, honkT }. A held car has left its
    // schedule and drives itself (see step()) until it has caught back up with it.
    this.held = new Map();
    // emergency vehicles on the road right now (local to this client), and the spawn clock
    this.evs = []; this.evOn = false; this.evNext = 40 + Math.random() * 30; this.evN = 0;
  }
  // Drives the emergency vehicles: now and then one sets off ~320 m behind the local player at a
  // speed that catches them, runs down the corridor, follows whatever is in the gap (a player who
  // hasn't moved over gets the air horn), and leaves once well past. Returns events for main.js:
  // spawn, horn, passed, gone.
  stepEmergency(dt, T) {
    const out = [];
    if (!(dt > 0)) return out;
    const me = this.players.find((p) => p.me && p.block);
    if (this.evOn && me && !this.evs.length && (this.evNext -= dt) <= 0) {
      this.evNext = 55 + Math.random() * 65;
      const kind = ["police", "police", "police", "ambulance", "ambulance", "fire"][(Math.random() * 6) | 0], d = EV_TYPES[kind], B = BODIES[d.body];
      const e = { key: `8:${this.evN++ % 1000}:0`, ev: true, kind, model: d.model, body: d.body, color: d.color, L: B.L, W: B.W, dir: 8, lane: -1, sig: 0,
        x: CORRIDOR_X, z: me.z + 280, v: Math.max(34, me.v || 0), blockedT: 0, hornT: 0, passed: false, announced: false };
      this.evs.push(e);
      out.push({ type: "spawn", e });
    }
    for (const e of [...this.evs]) {
      if (this.bumped.has(e.key)) {                       // knocked: it rolls to a stop, siren off
        e.v = Math.max(0, e.v - 12 * dt); e.z -= e.v * dt; e.dead = true;
      } else {
        // the nearest thing in its path: a car that hasn't cleared the gap yet, or a player in it
        let gap = Infinity, lead = null;
        for (const c of this.query(T, e.z - 160, e.z - .1)) {
          if (c.parked || c.ev || Math.abs(c.x - e.x) > (c.W + e.W) / 2 + .25) continue;
          const g = (e.z - e.L / 2) - (c.z + c.L / 2);
          if (g < gap) { gap = g; lead = { z: c.z, L: c.L, v: c.held ? c.held.v : this.vAt(c, T), p: null }; }
        }
        for (const p of this.players) {
          if (!p.block || Math.abs(p.x - e.x) > ((p.W || 1.9) + e.W) / 2 + .25) continue;
          const g = (e.z - e.L / 2) - (p.z + (p.L || 4.6) / 2);
          if (g > -1 && g < gap) { gap = g; lead = { z: p.z, L: p.L || 4.6, v: Math.max(0, p.v || 0), p }; }
        }
        // fast enough to catch whoever it is behind; once past them, on its way
        const want = me && e.z > me.z - 5 ? Math.min(64, Math.max(48, (me.v || 0) + 14)) : 52;
        let acc = 3 * (1 - (e.v / want) ** 4);
        if (lead) acc -= 3 * ((5 + Math.max(0, e.v * .9 + (e.v * (e.v - lead.v)) / (2 * Math.sqrt(15)))) / Math.max(.5, gap)) ** 2;
        e.v = Math.max(0, e.v + Math.max(-10, Math.min(3, acc)) * dt);
        e.z -= e.v * dt;
        if (lead) e.z = Math.max(e.z, lead.z + (lead.L + e.L) / 2 + 1);
        // held up by a player sitting in the corridor: air horn until they move
        if (lead?.p && gap < 45 && e.v < want * .75) {
          e.blockedT += dt;
          if ((e.hornT -= dt) <= 0) { e.hornT = .9 + Math.random() * 1.1; out.push({ type: "horn", e, me: !!lead.p.me }); }
        }
      }
      if (me && !e.passed && e.z < me.z - 8) { e.passed = true; out.push({ type: "passed", e }); }
      if (!me || e.z < me.z - 700 || e.z > me.z + 500) { this.evs.splice(this.evs.indexOf(e), 1); out.push({ type: "gone", e }); }
    }
    return out;
  }
  // a car's scheduled forward speed at time T (its lane speed plus its own easing on and off)
  vAt(c, T) { return c.v - c.amp * c.w * Math.cos(T * c.w + c.ph); }

  // Traffic behind a slow or stopped player backs up behind them, and anyone stuck behind leans on
  // the horn. Every car runs to its schedule until something in its lane - a player going slower than
  // it, or a car already queued behind one - is too close to keep that schedule. From then on it
  // drives itself: brakes, queues nose to tail, pulls away when the lane clears, and runs a little
  // quicker than its lane until it is back on schedule, when it rejoins it exactly. Every client runs
  // this for every player, so a party sees the same queues. Returns this frame's horn blasts.
  step(dt, T) {
    const ev = [];
    if (!(dt > 0)) return ev;
    if (!this.players.length) { this.held.clear(); return ev; }
    let z0 = Infinity, z1 = -Infinity;
    for (const p of this.players) { z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const bands = Array.from({ length: LANES }, () => []);
    for (const c of this.query(T, z0 - 300, z1 + 600)) {
      if (c.parked || c.ev || this.bumped.has(c.key)) continue;
      const li = Math.max(0, Math.min(LANES - 1, Math.round((c.x - laneX(0)) / LW)));
      bands[li].push({ c, z: c.z, v: c.held ? c.held.v : this.vAt(c, T), L: c.L });
    }
    for (const p of this.players) {
      if (!p.block) continue;
      for (let li = 0; li < LANES; li++) if (Math.abs(p.x - laneX(li)) < LW / 2 + (p.W || 1.9) / 2 - .4) bands[li].push({ p, z: p.z, v: Math.max(0, p.v || 0), L: p.L || 4.6 });
    }
    const seen = new Set();
    for (const band of bands) {
      band.sort((a, b) => a.z - b.z);              // front of the lane first (forward is -z)
      let lead = null;
      for (const e of band) {
        if (e.c) { this.follow(e, lead, T, dt, ev); seen.add(e.c.key); }
        lead = e;
      }
    }
    // anyone who fell out of range is far behind everyone and out of sight: back onto the schedule
    for (const k of this.held.keys()) if (!seen.has(k)) this.held.delete(k);
    return ev;
  }
  follow(e, lead, T, dt, ev) {
    const c = e.c, zDet = c.zDet, vDet = this.vAt(c, T);
    let hs = c.held;
    // who is holding this lane up: a player directly ahead, or the queue in front of one
    e.player = lead ? lead.p || lead.player || null : null;
    e.depth = lead ? (lead.p ? 1 : (lead.depth || 0) + 1) : 0;
    const accel = (z, v, v0) => {
      let a = IDM.a * (1 - Math.pow(v / Math.max(1, v0), 4));
      if (lead) {
        const gap = Math.max(.1, (z - c.L / 2) - (lead.z + lead.L / 2));
        const s = IDM.s0 + Math.max(0, v * IDM.th + (v * (v - lead.v)) / (2 * Math.sqrt(IDM.a * IDM.b)));
        a -= IDM.a * (s / gap) ** 2;
      }
      return Math.max(-IDM.bMax, Math.min(IDM.a, a));
    };
    if (!hs) {
      // on schedule: only step off it when keeping it would mean closing in on a player or on a car
      // that is already held up. A car part-way through a lane change finishes it on schedule.
      if (!lead || !(lead.p || lead.c?.held) || c.sig || Math.abs(c.swerve || 0) > .6 || accel(zDet, vDet, vDet) > -1.2) return;
      const [dir, lane, j] = c.key.split(":").map(Number);
      hs = { z: zDet, v: vDet, acc: 0, dir, lane, j, honkT: .5 + Math.random() };
      this.held.set(c.key, hs);
      c.held = hs;
    }
    const v0 = hs.z > zDet + 1 ? vDet + IDM.catchUp : vDet;
    hs.acc = accel(hs.z, hs.v, v0);
    hs.v = Math.max(0, Math.min(v0, hs.v + hs.acc * dt));
    hs.z -= hs.v * dt;
    // never ahead of its own schedule, and never into the vehicle in front
    hs.z = Math.max(hs.z, zDet);
    if (lead) hs.z = Math.max(hs.z, lead.z + (lead.L + c.L) / 2 + 1.2);
    c.z = e.z = hs.z; e.v = hs.v;
    // held up by a slow player: horn. The car right behind keeps at it; further back, now and then.
    const p = e.player;
    if (p && hs.v < vDet * .6 && (p.v || 0) < vDet * .75) {
      if ((hs.honkT -= dt) <= 0) {
        ev.push({ key: c.key, x: c.x, z: hs.z, heavy: c.body === "truck" || c.body === "bus", me: !!p.me, depth: e.depth, flash: e.depth === 1 && Math.random() < .3 });
        hs.honkT = e.depth === 1 ? .9 + Math.random() * 1.5 : 2.5 + Math.random() * 4.5;
      }
    } else hs.honkT = Math.max(hs.honkT, .4 + Math.random() * .6);
    // caught back up with the schedule and nothing ahead in the way: rejoin it exactly
    if (hs.z - zDet < .3 && hs.acc > -.3) { this.held.delete(c.key); c.held = null; }
  }
  // A driver you cut off: brake lights, and maybe a flash of the headlights. Cosmetic and local -
  // their position stays deterministic.
  react(key, flash) { this.reacts.set(key, { t: 0, flash }); }
  // main.js hands us the local player plus every remote one each frame
  setPlayers(list) { this.players = list; }
  setSeed(seed, level = "Heavy", ramp = true) {
    this.seed = seed | 0;
    this.base = TRAFFIC_LEVELS[level] ?? TRAFFIC_LEVELS.Heavy;
    this.ramp = ramp;
    for (const [, m] of this.active) this.release(m);
    this.active.clear(); this.bumped.clear(); this.blocked.clear(); this.reacts.clear(); this.bikeX.clear(); this.held.clear();
    this.evs.length = 0; this.evNext = 40 + Math.random() * 30;
  }
  // Capped well below full: even on Insane a lane keeps real gaps in it.
  density(j) { return Math.min(.62, this.base + (this.ramp ? Math.min(.16, Math.max(0, -j * S) / 30000) : .06)); }

  // dir is always 1: the road is one carriageway now. It is kept in the key and the signature so the
  // deterministic hash (and therefore every party member) keeps agreeing on which slots spawn.
  raw(dir, lane, j) {
    const k = dir * 1000 + lane, seed = this.seed;
    if (hash(seed, k, j) > this.density(j)) return null;
    const h = (i) => hash(seed + i * 7919, k, j);
    // Right behind an occupied slot, only half of them are allowed to fill. This is what stops a run
    // of three or four cars nose to tail: whether the previous slot is occupied is a plain hash test,
    // not a recursive call, so it stays deterministic and every party member agrees.
    if (hash(seed, k, j - 1) <= this.density(j - 1) && h(11) > .5) return null;
    let body;
    if (lane >= 3 && h(4) < .22) body = h(5) < .3 ? "bus" : "truck";
    else body = SMALL[(h(6) * SMALL.length) | 0];
    // Every car in a lane averages the lane's speed, and each driver eases on and off the throttle on
    // their own rhythm (18-40 s), so gaps open and close and nobody moves in lockstep. It has to be a
    // zero-average drift rather than a different steady speed per car: with steady speeds a quicker
    // car simply drove through the one ahead of it in the lane (the gap shrank every second, forever).
    // A bus/truck driver is a steadier hand than the rest.
    const steady = body === "bus" || body === "truck";
    const v = SAME_V[lane];
    const amp = (steady ? DRIFT_HEAVY * (.5 + h(12) * .5) : DRIFT_CAR * (.35 + h(12) * .65));
    const w = 6.2832 / (18 + h(15) * 22);
    const z0 = j * S + (h(1) - .5) * (body === "bus" || body === "truck" ? 3 : 10);
    const ph = h(2) * 6.283;
    return { key: `${dir}:${lane}:${j}`, h, body, dir, lane, j, v, amp, w, z0, ph, L: BODIES[body].L, W: BODIES[body].W, color: PALETTE[(h(7) * PALETTE.length) | 0] };
  }
  zAt(c, t) { return c.z0 - c.v * t + Math.sin(t * c.w + c.ph) * c.amp; }

  // can car c occupy target lane during [t0, t1] without meeting anyone there? Both cars drift, so
  // their gap is not a straight line through the window: it is checked at five points across it and
  // must keep one sign and stay clear at every one.
  swerveSafe(c, target, t0, t1) {
    const vt = SAME_V[target];
    const za = this.zAt(c, t0), zb = this.zAt(c, t1);
    const lo = Math.min(za + vt * t0, zb + vt * t1) - 60 - DRIFT_CAR, hi = Math.max(za + vt * t0, zb + vt * t1) + 60 + DRIFT_CAR;
    for (let j = Math.floor(lo / S); j <= Math.ceil(hi / S); j++) {
      const o = this.raw(1, target, j);
      if (!o) continue;
      const need = (c.L + o.L) / 2 + 9;
      let sign = 0;
      for (let q = 0; q <= 4; q++) {
        const t = t0 + (t1 - t0) * q / 4, d = this.zAt(o, t) - this.zAt(c, t);
        if (Math.abs(d) < need) return false;
        if (sign && Math.sign(d) !== sign) return false;
        sign = Math.sign(d);
      }
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
    // where its schedule puts it, and where it really is if it is held up (see step())
    c.zDet = this.zAt(c, T);
    const hs = this.held.get(c.key);
    c.held = hs || null;
    c.z = hs ? hs.z : c.zDet;
    const baseX = laneX(c.lane);
    // a driver's own hand on the wheel: some track the lane dead straight, others drift a bit more
    const bike = c.body === "bike";
    const wobA = (bike ? .2 : .08) + c.h(13) * (bike ? .3 : .18), wobF = .16 + c.h(14) * .22;
    c.x = baseX + Math.sin(T * wobF + c.ph * 1.7) * wobA;
    c.sig = 0; c.swerve = 0;
    let k = 0;
    for (const e of this.evs) k = Math.max(k, yieldK(e.z - c.z));
    c.yieldK = k;
    if (k) c.x += YIELD_X[c.lane] * k;
    const target = SWERVE_TARGET[c.lane];
    if (!hs && !k && target !== undefined && c.h(8) < .45 && c.body !== "bus") {
      const P = 15 + c.h(9) * 14, phase = T + c.h(10) * P, tl = ((phase % P) + P) % P;
      if (tl < WIN) {
        const T0 = T - tl;
        if (this.swerveSafe(c, target, T0 + 1, T0 + WIN) && this.playerClear(c, target, `${c.key}:${Math.floor(phase / P)}`, tl)) {
          const k = smooth((tl - OUT_AT) / OUT_LEN) * (1 - smooth((tl - BACK_AT) / BACK_LEN));
          c.swerve = (laneX(target) - baseX) * k;
          c.x += c.swerve;
          // +1 while pulling across, -1 while coming back: the indicator has to follow the direction
          // the car is actually moving, not the lane it started in
          if (tl < OUT_AT + .4) c.sig = 1;
          else if (tl > BACK_AT - .6 && tl < BACK_AT + BACK_LEN) c.sig = -1;
        }
      }
    }
    return c;
  }
  query(T, zAhead, zBehind, dirs = [1]) {
    const out = [];
    for (const dir of dirs) for (let lane = 0; lane < LANES; lane++) {
      const v = SAME_V[lane];
      // a car is never more than one drift (plus its spawn jitter) away from where its lane speed puts it
      const j0 = Math.ceil((zAhead + v * T - 12 - DRIFT_CAR) / S), j1 = Math.floor((zBehind + v * T + 12 + DRIFT_CAR) / S);
      for (let j = j0; j <= j1; j++) {
        const c = this.raw(dir, lane, j);
        if (!c) continue;
        this.resolve(c, T);
        if (c.z >= zAhead && c.z <= zBehind) out.push(c);
      }
    }
    // a held car can be far behind its schedule, outside the slots searched above
    for (const [key, hs] of this.held) {
      if (hs.z < zAhead || hs.z > zBehind || out.some((o) => o.key === key)) continue;
      const c = this.raw(hs.dir, hs.lane, hs.j);
      if (c) { this.resolve(c, T); out.push(c); }
    }
    for (let j = Math.floor((zAhead - 40) / SCENE_S); j <= Math.ceil((zBehind + 40) / SCENE_S); j++) {
      const sc = this.rawScene(j);
      if (sc) for (const c of sc) if (c.z >= zAhead && c.z <= zBehind) out.push(c);
    }
    // emergency vehicles (a copy each: callers move what they are given, e.g. a knocked car's slide)
    for (const e of this.evs) if (e.z >= zAhead && e.z <= zBehind) out.push({ ...e });
    return out;
  }
  // The keys look like lane keys ("9:n:j") so a knocked one goes round the party like any other car.
  rawScene(j) {
    const seed = this.seed, h = (i) => hash(seed + 31337 + i * 7919, 9, j);
    if (h(0) > SCENE_P) return null;
    const z = j * SCENE_S + (h(1) - .5) * 200;
    if (tunnelAmount(z) > 0 || tunnelAmount(z + 20) > 0) return null;
    const body = PARKED[(h(3) * PARKED.length) | 0], stop = h(2) < .55;
    const car = (i, b, dz, extra) => ({ key: `9:${i}:${j}`, h, body: b, dir: 9, lane: -1, j, v: 0, amp: 0, w: 0, x: SCENE_X, z: z + dz, sig: 0,
      L: BODIES[b].L, W: BODIES[b].W, color: PALETTE[(h(4 + i) * PALETTE.length) | 0], parked: true, ...extra });
    const out = [car(0, body, 0, { hazard: !stop })];
    // the cruiser stops a car length behind (+z is behind)
    if (stop) out.push(car(1, "sedan", BODIES[body].L / 2 + 2.4 + BODIES.sedan.L / 2, { model: "cop", color: 0x121418, cop: true }));
    return out;
  }
  // true when no same-direction car occupies lane space around z
  laneClear(T, x, z, ahead = 45, behind = 25) {
    return !this.query(T, z - ahead - 20, z + behind + 20, [1]).some((c) => Math.abs(c.x - x) < 3.4 && c.z > z - ahead && c.z < z + behind);
  }
  // put every car away (City Drive has its own traffic)
  hideAll() {
    for (const m of this.active.values()) this.release(m);
    this.active.clear(); this.cars.length = 0; this.bumped.clear();
  }
  release(m) { m.visible = false; m.rotation.z = 0; const p = this.pool.get(m.userData.body) || []; p.push(m); this.pool.set(m.userData.body, p); }
  acquire(model, color) {
    const p = this.pool.get(model);
    let m = p && p.pop();
    if (!m) { m = model === "bike" ? makeTrafficBike(color) : BARS[model] ? this.makeEmergency(model) : makeTrafficCar(model, color); this.scene.add(m); }
    if (!BARS[model]) m.children[0].userData.setColor(color);
    m.visible = true;
    return m;
  }
  // A cruiser (the roadside stops use it too), an ambulance or a fire engine: the body in its livery
  // with a light bar on the roof whose two halves the update loop strobes. The ambulance gets a red
  // band down each side.
  makeEmergency(model) {
    const d = Object.values(EV_TYPES).find((t) => t.model === model), B = BODIES[d.body], bar = new THREE.Group();
    const m = makeTrafficCar(d.body, d.color);
    const red = new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false }), blue = new THREE.MeshBasicMaterial({ color: 0x2050ff, toneMapped: false });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, .09, .3), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    const r = new THREE.Mesh(new THREE.BoxGeometry(.5, .1, .26), red), b = new THREE.Mesh(new THREE.BoxGeometry(.5, .1, .26), blue);
    r.position.set(-.27, .07, 0); b.position.set(.27, .07, 0);
    bar.add(base, r, b); bar.position.set(0, B.top + .04, BARS[model].z);
    m.add(bar);
    if (model === "amb") {
      const band = new THREE.Mesh(new THREE.BoxGeometry(B.W + .02, .22, B.L * .78), new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: .5 }));
      band.position.set(0, 1.05, .15);
      m.add(band);
    }
    m.userData.body = model; m.userData.bar = { red, blue, z: BARS[model].z };
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
    const b = this.bumped.get(key), lane = +key.split(":")[1], cv = key.startsWith("9:") ? 0 : SAME_V[Math.min(SAME_V.length - 1, lane)] || 30;
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
  // Memoised: T is quantised to half a second by the sender, so everyone in the party asks for the
  // same handful of values. Without this, one full scan ran per incoming config packet per peer.
  worldHash(T) {
    if (this.whT === T && this.whSeed === this.seed && this.whBase === this.base) return this.whVal;
    const h = this.computeWorldHash(T);
    this.whT = T; this.whSeed = this.seed; this.whBase = this.base; this.whVal = h;
    return h;
  }
  computeWorldHash(T) {
    let h = Math.round(this.base * 1000) ^ (this.seed | 0) ^ (this.ramp ? 1 : 0);
    for (let j = -20; j < 20; j++) { const dir = 1; for (let lane = 0; lane < LANES; lane++) {
      const c = this.raw(dir, lane, j);
      if (!c) continue;
      h = (h * 31 + Math.round(this.zAt(c, T) * 4) + c.color + c.lane * 7 + c.dir * 3 + c.body.charCodeAt(0) * 13 + Math.round(c.v * 10)) | 0;
    } }
    return h;
  }
  update(dt, T, focusZ, night, glows, lights, camPos, hidden = null) {
    const cars = this.query(T, focusZ - 900, focusZ + 80);
    const seen = new Set();
    this.cars.length = 0;
    let lightN = 0, copN = 0;
    const blink = Math.floor(T * 2.8) % 2 === 0, strobe = Math.floor(T * 7) % 2 === 0;
    for (const [k, r] of this.reacts) if ((r.t += dt) > 1.6) this.reacts.delete(k);
    for (const c of cars) {
      seen.add(c.key);
      let m = this.active.get(c.key);
      if (!m) { m = this.acquire(c.model || c.body, c.color); this.active.set(c.key, m); }
      let rot = 0;
      const b = this.bumped.get(c.key);
      if (b) {
        b.t += dt; b.vx *= Math.exp(-dt * 2); b.vz *= Math.exp(-dt * 1.5); b.vr *= Math.exp(-dt * 2);
        b.dx += b.vx * dt; b.dz += b.vz * dt + c.v * dt * Math.min(1, b.t); b.rot += b.vr * dt;
        c.x += b.dx; c.z += b.dz; rot += b.rot; c.sig = 0;
      }
      m.position.set(c.x, 0, c.z);
      m.rotation.y = rot;
      if (c.body === "bike") {
        // riders lean into their weave
        const last = this.bikeX.get(c.key), vx = last === undefined || dt <= 0 ? 0 : (c.x - last) / dt;
        this.bikeX.set(c.key, c.x);
        m.rotation.z += (Math.max(-.35, Math.min(.35, -vx * .3)) - m.rotation.z) * Math.min(1, dt * 5);
      }
      this.cars.push(c);
      m.visible = !(hidden && hidden.has(c.key));
      if (!m.visible) continue;

      const B = BODIES[c.body], one = c.body === "bike", hw = one ? 0 : c.W / 2 - .3, sides = one ? ONE : TWO;
      const tz = c.z + c.L / 2 + .05, fz = c.z - c.L / 2 - .05;
      if (c.sig && blink && Math.abs(c.z - focusZ) < 300) {
        const side = (SWERVE_TARGET[c.lane] > c.lane ? 1 : -1) * c.sig, sx = one ? .22 : hw;
        glows.add(c.x + side * sx, B.tl[1], tz, 1, .55, .05, 1.2);
        glows.add(c.x + side * sx, B.hl[1], fz, 1, .55, .05, 1.0);
      }
      if (c.parked) {
        // hazards on a breakdown; a light bar going on a cruiser, bright enough to see from far off
        if (c.hazard && blink) for (const s of sides) { glows.add(c.x + s * hw, B.tl[1], tz, 1, .55, .05, 1.2); glows.add(c.x + s * hw, B.hl[1], fz, 1, .55, .05, 1.0); }
        if (!c.cop) continue;
      }
      if ((c.cop || c.ev) && m.userData.bar) {
        // the two halves of the bar take turns, bright enough to see from far off, and light the road
        const bar = m.userData.bar, S = BARS[c.model || "cop"], y = B.top + .14, bz = c.z + (bar.z ?? .35), dim = .05;
        const A = strobe ? S.a : S.a.map((v) => v * dim), Bc = strobe ? S.b.map((v) => v * dim) : S.b;
        bar.red.color.setRGB(A[0], A[1], A[2]); bar.blue.color.setRGB(Bc[0], Bc[1], Bc[2]);
        glows.add(c.x - .3, y, bz, A[0] / 3, A[1] / 3, A[2] / 3, 2.4);
        glows.add(c.x + .3, y, bz, Bc[0] / 3, Bc[1] / 3, Bc[2] / 3, 2.4);
        // on the move, the headlights wig-wag too
        if (c.ev && !c.dead) glows.add(c.x + (strobe ? -1 : 1) * (c.W / 2 - .35), B.hl[1], fz, 1, .97, .9, 2.2);
        if (copN < 2 && Math.abs(c.z - camPos.z) < 220) {
          const L = this.copLights[copN++] ||= { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(), intensity: 6, range: 16, cosOuter: -2, cosInner: -1.9 };
          const lc = strobe ? S.a : S.b;
          L.pos.set(c.x, y + .5, bz); L.color.setRGB(lc[0] / 3, lc[1] / 3, lc[2] / 3);
          lights.push(L);
        }
        continue;
      }
      // brake lights: drivers brake as they ease back in their slot (the strongest part of each slow-down),
      // and anyone you have just cut off stands on the brakes
      const r = this.reacts.get(c.key);
      const braking = !b && (c.held ? c.held.acc < -.4 || c.held.v < 1.5 : c.amp * c.w * c.w > .06 && Math.sin(T * c.w + c.ph) < -.72 || (r && r.t < 1.1) || (c.yieldK > .02 && c.yieldK < .98));
      if (braking) for (const s of sides) glows.add(c.x + s * hw, B.tl[1], tz, 1, .07, .05, one ? 1.1 : 1.35);
      else if (night) for (const s of sides) glows.add(c.x + s * hw, B.tl[1], tz, 1, .08, .05, .9);
      // ...and flashes its headlights at you, twice
      if (r?.flash && r.t < .62 && r.t % .31 < .17) for (const s of sides) glows.add(c.x + s * (one ? 0 : c.W / 2 - .35), B.hl[1], fz, 1, .97, .9, 2.6);
      if (night) {
        if (lightN < 8 && c.z < camPos.z && c.z > camPos.z - 160) {
          const L = this.lightPool[lightN++] ||= { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -.12, -1).normalize(), color: new THREE.Color(1, .95, .85), intensity: 4, range: 45, cosOuter: Math.cos(.5), cosInner: Math.cos(.22) };
          L.pos.set(c.x, B.hl[1] + .1, c.z - c.L / 2 - .3);
          lights.push(L);
        }
      }
    }
    for (const [key, m] of this.active) if (!seen.has(key)) { this.release(m); this.active.delete(key); this.bumped.delete(key); this.bikeX.delete(key); }
  }
}

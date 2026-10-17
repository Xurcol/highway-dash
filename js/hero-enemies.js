// Hero mode enemies: thugs with fists and bats, gunmen, brutes, and a boss. EnemySim is the truth -
// it runs on one machine (solo: here; online: the host) and moves, thinks and takes hits - and
// EnemyView draws whatever state it is given (straight from the sim, or from the host's snapshots).
//
// Fights are built for being surrounded: enemies share out attack tokens so only a couple swing at
// any one hero at a time while the rest circle and wait their turn; every attack is telegraphed
// before it lands (the hero's sense picks it up) and can be dodged; gunmen keep their distance and
// paint you with a sight before they fire; brutes can't be juggled and hit through combos.
import * as THREE from "three";
import { HeroRig, OUTFITS, poseBody, HIP_H } from "./hero-rig.js?v=mvbqx7dj";

const V = THREE.Vector3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export const KINDS = {
  thug: { hp: 60, speed: 4.8, reach: 2, dmg: 8, windup: .48, cool: [1.2, 2.4], name: "Thug", weapon: null, armor: 0, r: .38 },
  bat: { hp: 70, speed: 4.6, reach: 2.4, dmg: 12, windup: .55, cool: [1.4, 2.6], name: "Bruiser", weapon: "bat", armor: 0, r: .38, outfit: "thug" },
  gunner: { hp: 50, speed: 4.2, reach: 22, dmg: 7, windup: .95, cool: [1.8, 3], name: "Gunman", weapon: "pistol", armor: 0, r: .38, ranged: true },
  rifle: { hp: 55, speed: 4, reach: 32, dmg: 9, windup: 1.2, cool: [2.4, 3.6], name: "Rifleman", weapon: "rifle", armor: 0, r: .38, ranged: true, outfit: "gunner" },
  brute: { hp: 220, speed: 3.6, reach: 2.8, dmg: 22, windup: .85, cool: [2, 3], name: "Brute", weapon: null, armor: 1, r: .55, scale: 1.28 },
  boss: { hp: 1400, speed: 5.4, reach: 3.2, dmg: 26, windup: .7, cool: [1.1, 1.9], name: "VANTA", weapon: null, armor: 2, r: .55, scale: 1.18 },
};
let NID = 1;
export const ST = ["idle", "chase", "circle", "windup", "attack", "recover", "hit", "air", "down", "webbed", "pinned", "ko", "aim", "flee", "getup", "taunt"];
const STI = Object.fromEntries(ST.map((s, i) => [s, i]));

// ------------------------------------------------------------------ simulation
export class EnemySim {
  constructor(W) {
    this.W = W;
    this.list = []; this.byId = new Map();
    this.shots = [];        // gunfire in flight: { id, x, y, z, vx, vy, vz, t, from, dmg }
    this.props = [];        // throwables: { id, kind, x, y, z, vx, vy, vz, held, rest }
    this.events = [];       // what happened this step (for effects / the network)
    this.tokens = new Map(); // player id -> Set of enemy ids allowed to swing
    this.attackGap = new Map();
    this.res = { contacts: [] };
  }
  ev(type, o) { o.type = type; this.events.push(o); return o; }
  spawn(kind, x, z, o = {}) {
    const K = KINDS[kind] || KINDS.thug;
    const y = this.W.topAt(x, z, (o.y ?? 2) + 2);
    const e = {
      id: o.id || NID++, kind, x, y: y + HIP_H, z, vx: 0, vy: 0, vz: 0, yaw: o.yaw ?? Math.random() * 6.28,
      hp: K.hp * (o.hpK || 1), max: K.hp * (o.hpK || 1), st: "idle", t: 0, cool: 1 + Math.random(), web: 0, target: null,
      weapon: K.weapon, group: o.group || 0, aggro: new Map(), atk: null, phase: Math.random() * 6, home: { x, z }, guard: o.guard ?? 9,
      hitT: 0, air: false, alert: false, ko: 0, waitT: 0, stagger: 0, circleDir: Math.random() < .5 ? -1 : 1, kidx: 0, boss: kind === "boss" ? { phase: 1, slamT: 6 } : null,
    };
    this.list.push(e); this.byId.set(e.id, e);
    return e;
  }
  remove(e) { const i = this.list.indexOf(e); if (i >= 0) this.list.splice(i, 1); this.byId.delete(e.id); }
  clear() { this.list.length = 0; this.byId.clear(); this.shots.length = 0; this.props.length = 0; this.tokens.clear(); this.attackGap.clear(); this.events.length = 0; }
  alive(e) { return e.st !== "ko" && e.st !== "pinned" && !(e.st === "webbed" && !e.air && e.t > 2); }
  get active() { return this.list.filter((e) => this.alive(e)); }
  set(e, st, t = 0) { e.st = st; e.t = t; }
  stats(e) { const K = KINDS[e.kind] || KINDS.thug; return K.ranged && !e.weapon ? KINDS.thug : K; }
  canAttack(e, p) {
    if ((this.attackGap.get(p.id) || 0) > 0) return false;
    return this.list.filter((o) => o !== e && o.target === p.id && ["windup", "aim", "attack"].includes(o.st)).length < 2;
  }
  warn(e, p, kind, duration) {
    this.attackGap.set(p.id, kind === "slam" ? .65 : .3);
    e.waitT = 0;
    this.ev("windup", { e: e.id, target: p.id, kind, t: duration });
  }

  // players: [{ id, x, y, z, vx, vz, state, dodge (i-frames left), hp, local }]
  // events pile up (from hits between steps too) until whoever runs the sim takes them
  step(dt, players) {
    this.lastPlayers = players;
    const livePlayers = new Set(players.filter((p) => !p.down).map((p) => p.id));
    for (const [id, gap] of this.attackGap) { if (!livePlayers.has(id)) this.attackGap.delete(id); else this.attackGap.set(id, Math.max(0, gap - dt)); }
    for (const id of this.tokens.keys()) if (!livePlayers.has(id)) this.tokens.delete(id);
    // Recovering enemies give up their turn, and waiting enemies gradually move up the queue.
    for (const p of players) {
      let set = this.tokens.get(p.id);
      if (!set) this.tokens.set(p.id, (set = new Set()));
      for (const id of set) {
        const e = this.byId.get(id);
        if (!e || !this.alive(e) || e.target !== p.id || !["chase", "circle", "windup", "attack"].includes(e.st)
          || e.cool > .35 && e.st !== "windup" && e.st !== "attack" || Math.abs(e.y - p.y) > 3.5) set.delete(id);
      }
      const max = 2;
      if (set.size < max) {
        let best = null, bd = 1e9;
        for (const e of this.list) {
          if (e.target !== p.id || set.has(e.id) || this.stats(e).ranged || !this.alive(e) || !["circle", "chase"].includes(e.st) || e.cool > .35 || Math.abs(e.y - p.y) > 3.5) continue;
          const d = Math.hypot(e.x - p.x, e.z - p.z) - Math.min(6, e.waitT);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) set.add(best.id);
      }
    }
    for (const e of this.list) this.think(e, dt, players);
    for (const e of this.list) this.move(e, dt);
    this.stepShots(dt, players);
    this.stepProps(dt);
    // the knocked out are cleared away after a while, out of sight
    for (let i = this.list.length - 1; i >= 0; i--) { const e = this.list[i]; if (!this.alive(e)) { e.ko += dt; if (e.ko > 25) this.remove(e); } }
  }
  near(e, players) {
    let best = null, bd = 1e9;
    for (const p of players) {
      if (p.down) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z) - (e.aggro.get(p.id) || 0) * 4;
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { p: best, d: Math.hypot(best.x - e.x, best.z - e.z), dy: best.y - e.y } : null;
  }
  think(e, dt, players) {
    const K = this.stats(e);
    e.t += dt; e.cool -= dt; e.hitT = Math.max(0, e.hitT - dt);
    e.stagger = Math.max(0, e.stagger - dt * .5);
    if (e.st === "circle" || e.st === "chase") e.waitT += dt;
    const st = e.st;
    if (st === "ko" || st === "pinned") return;
    if (st === "webbed") { if (e.t > 9 && !e.air) { this.set(e, "getup"); e.web = 0; } return; }
    if (st === "hit") { if (e.t > (e.stun || .45)) this.set(e, "circle"); return; }
    if (st === "air") return;                       // ballistic: move() lands it
    if (st === "down") { if (e.t > (e.downT || 1.8)) this.set(e, "getup"); return; }
    if (st === "getup") { if (e.t > .6) this.set(e, "circle"); return; }
    const committed = ["windup", "attack", "aim"].includes(st) && players.find((p) => p.id === e.target && !p.down);
    const T = committed ? { p: committed, d: Math.hypot(committed.x - e.x, committed.z - e.z), dy: committed.y - e.y } : this.near(e, players);
    if (["windup", "aim"].includes(st) && !committed) { this.set(e, "recover"); e.cool = Math.max(.6, e.cool); e.vx = e.vz = 0; return; }
    // waking up: something close, a hit, or a friend in trouble
    if (!e.alert) {
      if (T && (T.d < e.guard + 10 && Math.abs(T.dy) < 12 || e.hitT > 0)) { e.alert = true; this.ev("alert", { e: e.id }); }
      else { e.yaw += Math.sin(e.t * .7 + e.phase) * dt * .4; return; }
    }
    // gone, or too far away to chase: back to where they were
    if (!T || T.d > 70 || Math.hypot(e.x - e.home.x, e.z - e.home.z) > 90) {
      e.target = null;
      const hx = e.home.x - e.x, hz = e.home.z - e.z, hd = Math.hypot(hx, hz);
      if (hd > 3) { e.vx += (hx / hd * K.speed - e.vx) * Math.min(1, dt * 4); e.vz += (hz / hd * K.speed - e.vz) * Math.min(1, dt * 4); e.yaw = Math.atan2(hx, hz); this.set(e, "chase", e.t); }
      else { e.vx *= .8; e.vz *= .8; this.set(e, "idle"); e.alert = false; }
      return;
    }
    e.target = T.p.id;
    const p = T.p, dx = p.x - e.x, dz = p.z - e.z, d = Math.max(.001, T.d), face = Math.atan2(dx, dz);
    const turn = (rate) => { e.yaw += clamp(wrapA(face - e.yaw), -rate * dt, rate * dt); };
    // the hero is up a wall or on a rooftop out of reach: gunmen shoot, the rest shout and wait
    const unreachable = Math.abs(T.dy) > 3.5;
    // ---- ranged ----
    if (K.ranged) {
      if (st !== "aim" || e.t < K.windup * .65) turn(6);
      if (st === "aim") {
        // Commit the sight before firing so a late dodge can beat the shot.
        if (e.t < K.windup * .65) {
          const lead = Math.min(.18, d / 140);
          e.aim = { x: p.x + (p.vx || 0) * lead, y: p.y + .2, z: p.z + (p.vz || 0) * lead };
        }
        if (e.t > K.windup) {
          const aim = e.aim || p;
          this.fire(e, aim.x, aim.y, aim.z, K.dmg);
          this.set(e, "recover"); e.cool = K.cool[0] + Math.random() * (K.cool[1] - K.cool[0]);
        }
        return;
      }
      if (st === "recover" && e.t < .4) return;
      const want = e.kind === "rifle" ? 20 : 13;
      let mx = 0, mz = 0;
      if (d > want + 5) { mx = dx / d; mz = dz / d; }
      else if (d < want - 5) { mx = -dx / d; mz = -dz / d; }
      else { mx = -dz / d * e.circleDir * .6; mz = dx / d * e.circleDir * .6; if (Math.random() < dt * .3) e.circleDir *= -1; }
      e.vx += (mx * K.speed - e.vx) * Math.min(1, dt * 5); e.vz += (mz * K.speed - e.vz) * Math.min(1, dt * 5);
      if (e.cool <= 0 && d < K.reach && this.canAttack(e, p) && this.W.clear(e.x, e.y + .5, e.z, p.x, p.y, p.z, 2, .4)) { this.set(e, "aim"); e.aim = { x: p.x, y: p.y + .2, z: p.z }; this.warn(e, p, "shot", K.windup); e.vx = e.vz = 0; }
      else if (st !== "chase") this.set(e, "chase", e.t);
      return;
    }
    // ---- melee ----
    if (st === "windup") {
      const duration = e.atk?.kind === "slam" ? K.windup + .3 : K.windup;
      if (e.t < duration * .55) turn(e.kind === "brute" ? 2.5 : 5);
      e.vx *= Math.exp(-dt * 14); e.vz *= Math.exp(-dt * 14);
      if (e.t >= duration) {
        this.set(e, "attack");
        if (e.boss && e.atk?.kind === "slam") { e.atk.airborne = true; e.vy = 10; e.air = true; }
        else this.strike(e, players);
      }
      return;
    }
    if (st === "attack") { if (!e.atk?.airborne && e.t > .25) this.set(e, "recover"); return; }
    if (st === "recover") { if (e.t > .5) this.set(e, "circle"); e.vx *= .85; e.vz *= .85; return; }
    turn(7);
    const tok = this.tokens.get(p.id)?.has(e.id);
    // the boss: its own repertoire
    if (e.boss) return this.thinkBoss(e, T, dt, players);
    let mx = 0, mz = 0, sp = K.speed;
    if (tok && !unreachable) {
      // my turn: close in and swing
      if (d > K.reach - .3) { mx = dx / d; mz = dz / d; sp = K.speed * 1.25; }
      else if (d < 1.35) { mx = -dx / d * .8; mz = -dz / d * .8; }
      if (d < K.reach + .2 && e.cool <= 0 && this.canAttack(e, p) && this.W.clear(e.x, e.y + .3, e.z, p.x, p.y + .3, p.z, 2, .25)) {
        this.set(e, "windup");
        e.atk = { kind: e.weapon === "bat" ? "hook" : ["jab", "cross", "hook", "kick"][e.kidx++ % 4], heavy: e.kind === "brute" };
        this.warn(e, p, e.kind === "brute" ? "heavy" : "melee", K.windup);
        e.cool = K.cool[0] + Math.random() * (K.cool[1] - K.cool[0]);
        return;
      }
      this.set(e, "chase", st === "chase" ? e.t : 0);
    } else {
      // waiting: keep 3.5-5.5 m away and drift round the target, mostly facing it
      const ring = unreachable ? 6 : 4.5 + (e.id % 3) * .6;
      if (d > ring + 1.5) { mx = dx / d; mz = dz / d; }
      else if (d < ring - 1) { mx = -dx / d * .7; mz = -dz / d * .7; }
      mx += -dz / d * e.circleDir * .55; mz += dx / d * e.circleDir * .55;
      sp = K.speed * .55;
      if (Math.random() < dt * .25) e.circleDir *= -1;
      if (unreachable && Math.random() < dt * .3) this.ev("taunt", { e: e.id });
      if (st !== "circle") this.set(e, "circle");
    }
    // never inside the hero
    if (d < 1.2) { mx -= dx / d * (1.2 - d) * 2; mz -= dz / d * (1.2 - d) * 2; }
    const L = Math.hypot(mx, mz);
    if (L > 1) { mx /= L; mz /= L; }
    // keep apart from each other
    for (const o of this.list) {
      if (o === e || !this.alive(o)) continue;
      const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz);
      if (od < 1.4 && od > .01) { mx += ox / od * (1.4 - od); mz += oz / od * (1.4 - od); }
    }
    e.vx += (mx * sp - e.vx) * Math.min(1, dt * 6); e.vz += (mz * sp - e.vz) * Math.min(1, dt * 6);
  }
  thinkBoss(e, T, dt, players) {
    const K = KINDS.boss, B = e.boss, p = T.p, d = Math.max(.001, T.d);
    B.slamT -= dt;
    if (e.hp < e.max * .5 && B.phase === 1) { B.phase = 2; this.ev("bossphase", { e: e.id, phase: 2 }); }
    const sp = K.speed * (B.phase === 2 ? 1.3 : 1);
    if (B.slamT <= 0 && d < 9 && !e.air && this.canAttack(e, p)) {
      // ground slam: a jump and a shockwave that knocks down anyone near the landing
      B.slamT = B.phase === 2 ? 5 : 8;
      this.set(e, "windup"); e.atk = { kind: "slam", heavy: true, aoe: 7 };
      this.warn(e, p, "slam", K.windup + .3 + 10 / 11);
      e.vx = e.vz = 0;
      return;
    }
    if (d > K.reach - .2) { e.vx += (p.x - e.x) / d * sp * dt * 6; e.vz += (p.z - e.z) / d * sp * dt * 6; const s = Math.hypot(e.vx, e.vz); if (s > sp) { e.vx *= sp / s; e.vz *= sp / s; } }
    else if (e.cool <= 0 && Math.abs(T.dy) <= 3.5 && this.canAttack(e, p) && this.W.clear(e.x, e.y + .3, e.z, p.x, p.y + .3, p.z, 2, .25)) {
      this.set(e, "windup");
      e.atk = { kind: ["hook", "uppercut", "roundhouse", "cross"][e.kidx++ % 4], heavy: e.kidx % 3 === 0 };
      this.warn(e, p, e.atk.heavy ? "heavy" : "melee", K.windup);
      e.cool = K.cool[0] + Math.random() * (K.cool[1] - K.cool[0]) * (B.phase === 2 ? .7 : 1);
    }
  }
  // the moment a melee attack connects: anyone in reach in front of it (or round it, for a slam)
  strike(e, players) {
    const K = this.stats(e), a = e.atk || {};
    for (const p of players) {
      if (p.down) continue;
      const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz), dy = Math.abs(p.y - e.y);
      if (dy > (a.aoe ? 1.8 : 2.5) || !this.W.clear(e.x, e.y + .3, e.z, p.x, p.y + .3, p.z, 2, .25)) continue;
      if (a.aoe) { if (d > a.aoe) continue; }
      else {
        if (d > K.reach + .6) continue;
        const ang = Math.abs(wrapA(Math.atan2(dx, dz) - e.yaw));
        if (ang > 1.1) continue;
      }
      this.ev("strike", { e: e.id, target: p.id, dmg: K.dmg * (a.heavy ? 1.5 : 1), heavy: !!a.heavy, kx: dx / (d || 1), kz: dz / (d || 1), kind: a.kind });
    }
  }
  fire(e, tx, ty, tz, dmg) {
    const ox = e.x + Math.sin(e.yaw) * .5, oy = e.y + .45, oz = e.z + Math.cos(e.yaw) * .5;
    const dx = tx - ox, dy = ty - oy, dz = tz - oz, L = Math.hypot(dx, dy, dz) || 1, sp = e.kind === "rifle" ? 160 : 110;
    // not quite perfect aim
    const j = .025 * L;
    const s = { id: NID++, x: ox, y: oy, z: oz, vx: dx / L * sp + (Math.random() - .5) * j, vy: dy / L * sp + (Math.random() - .5) * j, vz: dz / L * sp + (Math.random() - .5) * j, t: 0, from: e.id, dmg };
    this.shots.push(s);
    this.ev("fire", { e: e.id, x: ox, y: oy, z: oz, vx: s.vx, vy: s.vy, vz: s.vz, id: s.id });
  }
  stepShots(dt, players) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt, nz = s.z + s.vz * dt;
      let gone = s.t > 1.5;
      for (const p of players) {
        if (p.down) continue;
        // closest approach of this step's segment to the player's chest
        const ax = p.x - s.x, ay = p.y + .2 - s.y, az = p.z - s.z, sx = nx - s.x, sy = ny - s.y, sz = nz - s.z, L2 = sx * sx + sy * sy + sz * sz;
        const k = clamp((ax * sx + ay * sy + az * sz) / (L2 || 1), 0, 1), cx = s.x + sx * k - p.x, cy = s.y + sy * k - p.y - .2, cz = s.z + sz * k - p.z;
        if (cx * cx + cy * cy + cz * cz < .55 * .55 && this.W.clear(s.x, s.y, s.z, p.x, p.y + .2, p.z, 2, .05)) { this.ev("shot", { target: p.id, dmg: s.dmg, x: p.x, y: p.y, z: p.z, kx: s.vx, kz: s.vz, id: s.id }); gone = true; break; }
      }
      if (!gone) {
        const h = this.W.raycast(s.x, s.y, s.z, s.vx, s.vy, s.vz, Math.hypot(nx - s.x, ny - s.y, nz - s.z), 2, _h);
        if (h) { this.ev("ricochet", { x: h.x, y: h.y, z: h.z }); gone = true; }
      }
      s.x = nx; s.y = ny; s.z = nz;
      if (gone) this.shots.splice(i, 1);
    }
  }
  // ---- physics ----
  move(e, dt) {
    const W = this.W, K = KINDS[e.kind];
    if (e.st === "ko" && !e.air) { e.vx *= .8; e.vz *= .8; }
    if (e.st === "webbed" && !e.air) { e.vx = e.vz = 0; }
    if (e.air) {
      e.vy -= 22 * dt;
      // a juggled body hangs in the air while it's being hit
      if (e.juggle > 0) { e.juggle -= dt; e.vy = Math.max(e.vy, -2); }
    }
    const sp = Math.hypot(e.vx, e.vz);
    e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
    if (e.thrown) {
      for (const o of this.list) {
        if (e.hitIds.has(o.id) || !this.alive(o)) continue;
        if ((o.x - e.x) ** 2 + (o.y - e.y) ** 2 + (o.z - e.z) ** 2 < 2.4 ** 2) { e.hitIds.add(o.id); this.damage(o, 30, "throw", e.vx / (sp || 1), e.vz / (sp || 1), { heavy: true, from: e.thrown }); this.ev("bodyhit", { e: o.id, x: o.x, y: o.y, z: o.z }); }
      }
      if (!e.air) { e.thrown = null; this.damage(e, 15, "throw", 0, 0, { heavy: true }); }
    }
    _p.set(e.x, e.y, e.z);
    if (W.collide(_p, K.r, this.res)) {
      for (const c of this.res.contacts) {
        if (Math.abs(c.ny) < .5 && (e.air || sp > 9)) {
          // thrown into a wall: webbed bodies stick to it, the rest take a heavy knock
          if (e.web > .5 || e.st === "webbed") { this.set(e, "pinned"); e.air = false; e.vx = e.vy = e.vz = 0; e.wallN = { x: c.nx, z: c.nz }; this.ev("pinned", { e: e.id, x: e.x, y: e.y, z: e.z }); }
          else if (sp > 8) { this.damage(e, 12 + sp, "wall", 0, 0); this.ev("wallslam", { e: e.id, x: e.x, y: e.y, z: e.z }); e.vx *= -.2; e.vz *= -.2; }
        }
      }
      e.x = _p.x; e.y = _p.y; e.z = _p.z;
    }
    if (e.st === "pinned") return;
    const fy = W.topAt(e.x, e.z, e.y - HIP_H + .6) + HIP_H;
    if (e.y <= fy + .02) {
      if (e.air && e.vy <= 0) {
        e.air = false;
        const v = -e.vy;
        e.vy = 0; e.y = fy;
        if (e.st === "air") { this.set(e, e.hp <= 0 ? "ko" : v > 14 || e.slam ? "down" : "down"); e.downT = v > 14 ? 2.4 : 1.6; this.ev("land", { e: e.id, v, x: e.x, y: e.y, z: e.z }); if (e.slam) { this.damage(e, 18, "slam", 0, 0); e.slam = false; } }
        if (e.boss && e.atk?.airborne && e.st === "attack") {
          e.atk.airborne = false;
          this.strike(e, this.lastPlayers || []);
          this.ev("shockwave", { e: e.id, x: e.x, y: e.y - HIP_H, z: e.z, r: 7 });
          this.set(e, "recover"); e.cool = Math.max(e.cool, 1.2);
        }
      } else if (!e.air) e.y += (fy - e.y) * Math.min(1, dt * 12);
      if (!e.air) { const k = e.st === "down" || e.st === "ko" ? Math.exp(-dt * 5) : 1; e.vx *= k; e.vz *= k; }
    } else if (!e.air && e.y > fy + .5) { e.air = true; }
    if (e.y < -20) { e.y = W.topAt(e.home.x, e.home.z, 50) + HIP_H; e.x = e.home.x; e.z = e.home.z; }
  }

  // ---- taking hits (from any hero) ----
  // h: { from (player id), dmg, kind, kx, kz (direction), launch, web, pull, x, y, z }
  hit(id, h) {
    const e = this.byId.get(id);
    if (!e || !this.alive(e)) return null;
    const K = KINDS[e.kind];
    e.alert = true; e.hitT = 2;
    e.aggro.set(h.from, (e.aggro.get(h.from) || 0) + 1);
    // webbing builds up; full means cocooned
    if (h.web) {
      e.web = Math.min(1.2, e.web + h.web / (1 + K.armor * .8));
      if (e.web >= 1 && e.st !== "webbed") { this.set(e, "webbed"); this.ev("webbed", { e: e.id }); if (e.air) e.vy = Math.min(e.vy, 2); }
    }
    if (h.disarm && e.weapon) { const w = e.weapon; e.weapon = null; this.ev("disarm", { e: e.id, weapon: w, from: h.from }); }
    if (h.pull) { const dx = h.x - e.x, dz = h.z - e.z, d = Math.hypot(dx, dz) || 1; const k = Math.min(16, d * 2.4) / (1 + K.armor); e.vx = dx / d * k; e.vz = dz / d * k; e.vy = 4 / (1 + K.armor); e.air = true; if (e.st !== "webbed") this.set(e, "hit"); e.stun = .7; }
    if (h.dmg) this.damage(e, h.dmg, h.kind, h.kx || 0, h.kz || 0, h);
    return e;
  }
  damage(e, dmg, kind, kx, kz, h = {}) {
    const K = KINDS[e.kind];
    const mult = e.st === "webbed" || e.st === "down" ? 1.5 : 1;
    e.hp -= dmg * mult;
    this.ev("hurt", { e: e.id, dmg: Math.round(dmg * mult), kind, x: e.x, y: e.y, z: e.z, from: h.from, heavy: !!h.heavy });
    if (e.hp <= 0) {
      e.hp = 0;
      this.set(e, "ko"); this.ev("ko", { e: e.id, from: h.from, kind, x: e.x, y: e.y, z: e.z, boss: !!e.boss });
      if (kx || kz) { e.vx = kx * 9; e.vz = kz * 9; e.vy = 5; e.air = true; }
      return;
    }
    if (e.st === "webbed" || e.st === "pinned") return;
    // armour: brutes and the boss shrug off light hits and can't be launched
    const heavy = h.heavy || kind === "wall" || kind === "slam" || kind === "throw" || kind === "finisher";
    if (K.armor) {
      e.stagger += heavy ? 1.4 : .45;
      const broken = e.stagger >= (K.armor === 2 ? 4.8 : 3);
      if (broken) { e.stagger = 0; this.set(e, "hit"); e.stun = K.armor === 2 ? .8 : 1.15; e.vx = kx * 3; e.vz = kz * 3; return; }
      if (!heavy || K.armor === 2) { e.hitT = 1; return; }
    }
    if (h.launch && !K.armor) {
      e.vy = h.launch / (1 + K.armor * .6); e.air = true; this.set(e, "air");
      e.vx = kx * 2; e.vz = kz * 2;
      return;
    }
    if (h.slam) { e.vy = -18; e.slam = true; e.air = true; this.set(e, "air"); return; }
    if (e.air || e.st === "air") {
      // juggled: knocked a little higher and held up for the next hit
      e.vy = Math.max(e.vy, 3.5); e.juggle = .35; e.vx = kx * 2.5; e.vz = kz * 2.5; this.set(e, "air");
      return;
    }
    const kb = (h.knock ?? (heavy ? 9 : 3.2)) / (1 + K.armor);
    e.vx = kx * kb; e.vz = kz * kb;
    if (heavy && K.armor < 2) { e.vy = 4; e.air = true; this.set(e, "air"); return; }
    this.set(e, "hit"); e.stun = heavy ? .7 : .38;
  }

  // a stunned enemy swung on a line and thrown: it flies, and anyone it hits goes down too
  throwEnemy(id, x, y, z, vx, vy, vz, from) {
    const e = this.byId.get(id);
    if (!e) return;
    e.x = x; e.y = y; e.z = z; e.vx = vx; e.vy = vy; e.vz = vz; e.air = true; e.thrown = from || "?"; e.hitIds = new Set([e.id]);
    if (e.st !== "webbed") this.set(e, "air");
  }
  // being swung round on a line
  holdEnemy(id, x, y, z) { const e = this.byId.get(id); if (!e) return; e.x = x; e.y = y; e.z = z; e.vx = e.vy = e.vz = 0; e.air = true; e.juggle = .2; if (e.st !== "webbed") this.set(e, "air"); }
  // ---- throwables ----
  addProp(kind, x, z, y) {
    const p = { id: NID++, kind, x, y: (y ?? this.W.topAt(x, z, 60)) + .45, z, vx: 0, vy: 0, vz: 0, held: null, rest: true, rot: Math.random() * 6, spin: 0, by: null };
    this.props.push(p);
    return p;
  }
  stepProps(dt) {
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i];
      if (p.held || p.rest) continue;
      p.vy -= 22 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.rot += p.spin * dt;
      // smash into enemies on the way
      for (const e of this.list) {
        if (!this.alive(e) || p.hitIds?.has(e.id)) continue;
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 + (e.z - p.z) ** 2 < 2.2 ** 2) {
          (p.hitIds ||= new Set()).add(e.id);
          const sp = Math.hypot(p.vx, p.vz) || 1;
          this.damage(e, p.kind === "canister" ? 30 : 35, "throw", p.vx / sp, p.vz / sp, { from: p.by, heavy: true });
          if (p.kind === "canister") { this.explode(p); break; }
        }
      }
      if (!this.props.includes(p)) continue;
      _p.set(p.x, p.y, p.z);
      const fy = this.W.topAt(p.x, p.z, p.y + .5);
      const hitWall = this.W.collide(_p, .4, this.res) && this.res.contacts.some((c) => Math.abs(c.ny) < .6);
      if (p.y < fy + .4 || hitWall) {
        if (p.kind === "canister" && Math.hypot(p.vx, p.vy, p.vz) > 6) { this.explode(p); continue; }
        if (Math.hypot(p.vx, p.vy, p.vz) > 6) this.ev("smash", { x: p.x, y: p.y, z: p.z, kind: p.kind });
        p.x = _p.x; p.z = _p.z; p.y = Math.max(fy + .4, _p.y);
        p.vx *= .3; p.vz *= .3; p.vy = 0; p.spin *= .3;
        if (Math.hypot(p.vx, p.vz) < .5) { p.rest = true; p.hitIds = null; }
      }
    }
  }
  explode(p) {
    this.ev("explode", { x: p.x, y: p.y, z: p.z });
    for (const e of this.list) {
      if (!this.alive(e)) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz, e.y - p.y);
      if (d < 6) this.damage(e, 45 * (1 - d / 8), "blast", dx / (d || 1), dz / (d || 1), { heavy: true, from: p.by });
    }
    this.props.splice(this.props.indexOf(p), 1);
  }

  // ---- the network: a compact snapshot of everything, and applying one ----
  snapshot() {
    const r = (v) => Math.round(v * 100) / 100;
    return {
      e: this.list.map((e) => [e.id, KINDS[e.kind] ? Object.keys(KINDS).indexOf(e.kind) : 0, r(e.x), r(e.y), r(e.z), r(e.vx), r(e.vy), r(e.vz), Math.round(e.yaw * 100) / 100, Math.round(e.hp), STI[e.st] ?? 0, Math.round(e.t * 100) / 100, Math.round(e.web * 100) / 100, e.weapon === "bat" ? 1 : e.weapon === "pistol" ? 2 : e.weapon === "rifle" ? 3 : 0, e.air ? 1 : 0, ["jab", "cross", "hook", "kick", "uppercut", "roundhouse", "slam"].indexOf(e.atk?.kind ?? "jab"), e.target || "", Math.round(e.max)]),
      p: this.props.map((p) => [p.id, ["barrel", "crate", "bin", "canister", "cone"].indexOf(p.kind), r(p.x), r(p.y), r(p.z), r(p.rot), p.held || ""]),
    };
  }
}
const _p = new V(), _h = {};
export const KIND_LIST = Object.keys(KINDS);
export const ATK_LIST = ["jab", "cross", "hook", "kick", "uppercut", "roundhouse", "slam"];
export const PROP_KINDS = ["barrel", "crate", "bin", "canister", "cone"];

// ------------------------------------------------------------------ drawing
// One rig per enemy (reused from a pool), with a weapon in the hand and a web cocoon over it when
// webbed. Draw states come from the sim (solo/host) or the host's snapshots (everyone else).
export class EnemyView {
  constructor(scene) {
    this.scene = scene;
    this.rigs = new Map(); this.pool = [];
    this.webMat = webMaterial();
    this.warningGeo = new THREE.RingGeometry(.88, 1, 48).rotateX(-Math.PI / 2);
    this.weapons = {
      bat: new THREE.Mesh(new THREE.CylinderGeometry(.035, .02, .85, 8).translate(0, -.3, .02), new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: .6 })),
      pistol: new THREE.Mesh(new THREE.BoxGeometry(.05, .13, .2).translate(0, -.08, .07), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: .4, metalness: .7 })),
      rifle: new THREE.Mesh(new THREE.BoxGeometry(.06, .1, .75).translate(0, -.06, .22), new THREE.MeshStandardMaterial({ color: 0x202224, roughness: .4, metalness: .6 })),
    };
    this.propMeshes = new Map();
    this.propGeo = {
      barrel: new THREE.CylinderGeometry(.32, .32, .9, 14), crate: new THREE.BoxGeometry(.8, .8, .8), bin: new THREE.CylinderGeometry(.3, .26, .95, 12),
      canister: new THREE.CylinderGeometry(.22, .22, .8, 12), cone: new THREE.ConeGeometry(.22, .7, 12),
    };
    this.propMat = {
      barrel: new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: .5, metalness: .4 }), crate: new THREE.MeshStandardMaterial({ color: 0x8c6a3e, roughness: .85 }),
      bin: new THREE.MeshStandardMaterial({ color: 0x2b3a2e, roughness: .6, metalness: .3 }), canister: new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: .4, metalness: .5, emissive: 0x220000 }),
      cone: new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: .6 }),
    };
  }
  rigFor(e) {
    let r = this.rigs.get(e.id);
    if (r) return r;
    const kind = e.kind, K = KINDS[kind] || KINDS.thug;
    const outfit = OUTFITS[K.outfit || kind] || OUTFITS.thug;
    r = this.pool.pop() || { rig: new HeroRig(outfit), weapon: null, web: null };
    r.rig.setLook(outfit);
    // a little variety: tint the jacket per enemy
    const U = r.rig.mat.userData.u, h = (e.id * 0.137) % 1;
    U.uBase.value.setHex(outfit.base).offsetHSL(h * .1 - .05, 0, (h - .5) * .12);
    r.rig.group.scale.setScalar(K.scale || 1);
    r.rig.group.visible = true;
    if (!r.warning) {
      r.warning = new THREE.Mesh(this.warningGeo, new THREE.MeshBasicMaterial({ color: 0xffbc5a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      r.warning.frustumCulled = false; this.scene.add(r.warning);
    }
    if (!r.rig.group.parent) this.scene.add(r.rig.group);
    r.anim = { t: Math.random() * 10, phase: 0 };
    r.kind = kind; r.weaponKind = null;
    this.rigs.set(e.id, r);
    return r;
  }
  release(id) {
    const r = this.rigs.get(id);
    if (!r) return;
    r.rig.group.visible = false;
    r.warning.visible = false;
    if (r.weapon) { r.weapon.parent?.remove(r.weapon); r.weapon = null; }
    if (r.web) r.web.visible = false;
    this.rigs.delete(id);
    if (this.pool.length < 24) this.pool.push(r); else { this.scene.remove(r.rig.group); this.scene.remove(r.warning); r.warning.material.dispose(); r.rig.dispose(); }
  }
  // list: enemy draw states { id, kind, x, y, z, vx, vz, yaw, st, t, web, weapon, air, atk, hp, max }
  draw(dt, list, cam) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.id);
      const r = this.rigFor(e), rig = r.rig, a = r.anim;
      const d2 = (e.x - cam.x) ** 2 + (e.z - cam.z) ** 2;
      rig.group.visible = d2 < 260 * 260;
      const warning = e.st === "windup" || e.st === "aim";
      r.warning.visible = warning && rig.group.visible;
      if (r.warning.visible) {
        const K = KINDS[e.kind] || KINDS.thug, slam = (typeof e.atk === "string" ? e.atk : e.atk?.kind) === "slam";
        const duration = K.windup + (slam ? .3 : 0), progress = clamp(e.t / duration, 0, 1);
        const radius = slam ? 7 : K.ranged && e.weapon ? 1.15 : K.reach + .35;
        r.warning.position.set(e.x, e.y - HIP_H + .055, e.z);
        r.warning.scale.setScalar(radius * (.86 + progress * .14));
        r.warning.material.color.setHex(K.armor || slam ? 0xff3959 : e.st === "aim" ? 0xff8750 : 0xffc367);
        r.warning.material.opacity = .2 + progress * .45 + Math.sin(e.t * 23) * .08;
      }
      if (!rig.group.visible) continue;
      a.t += dt;
      const hs = Math.hypot(e.vx, e.vz);
      a.phase += hs * dt / (1.1 + hs * .07) * Math.PI;
      // orientation: upright, lying down, or tumbling in the air
      let up = _u.set(0, 1, 0), fwd = _f.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)), rate = 12;
      const lying = e.st === "down" || e.st === "ko" && !e.air;
      if (lying) { up.set(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)); fwd.set(0, 1, 0); rate = 6; }
      if (e.st === "air" || (e.st === "ko" && e.air)) { up.set(-Math.sin(e.yaw) * .6, .8, -Math.cos(e.yaw) * .6).normalize(); fwd.set(Math.sin(e.yaw), .3, Math.cos(e.yaw)).normalize(); rate = 5; }
      if (e.st === "pinned" && e.wallN) { up.set(0, 1, 0); fwd.set(e.wallN.x, 0, e.wallN.z); }
      _pp.set(e.x, lying ? e.y - HIP_H + .25 : e.y, e.z);
      rig.place(_pp, up, fwd, null, dt, r.placed ? rate : 0);
      r.placed = true;
      // pose
      const an = { state: "ground", hs, speed: hs, vy: e.vy, phase: a.phase, t: a.t, landT: 9, slide: 0, roll: 0, hard: 0 };
      let attack = null;
      const atkKind = (typeof e.atk === "string" ? e.atk : e.atk?.kind) || "jab";
      switch (e.st) {
        case "idle": attack = null; an.hs = hs; break;
        case "windup": attack = { kind: atkKind, k: Math.min(.3, e.t / (KINDS[e.kind]?.ranged && !e.weapon ? KINDS.thug.windup : (KINDS[e.kind]?.windup || .5) + (atkKind === "slam" ? .3 : 0)) * .3), side: -1 }; break;
        case "attack": attack = { kind: atkKind, k: .3 + Math.min(.7, e.t / .25 * .3), side: -1 }; break;
        case "recover": attack = { kind: atkKind, k: Math.min(1, .6 + e.t), side: -1 }; break;
        case "hit": attack = { kind: "hit", k: Math.min(1, e.t / .45) }; break;
        case "air": an.state = "air"; an.vy = e.vy; break;
        case "down": case "ko": attack = { kind: "down", k: .5 }; break;
        case "getup": attack = { kind: "down", k: 1 - e.t / .6 }; break;
        case "webbed": case "pinned": attack = { kind: "webbed", t: a.t }; break;
        case "aim": attack = { kind: "aim", k: .5 }; break;
      }
      if (e.st === "ko" && e.air) { an.state = "air"; attack = null; }
      // circling / chasing: a guard stance with fists up over the walk
      if (!attack && (e.st === "circle" || e.st === "chase" || e.st === "idle") && hs < 6 && e.alert !== false && e.st !== "idle") attack = { kind: "guard" };
      an.attack = attack && attack.kind !== "guard" ? attack : null;
      const rr = poseBody(rig, an);
      if (attack?.kind === "guard") guardArms(rig);
      rig.apply(dt, rr);
      // the weapon in the right hand
      const wk = e.weapon || null;
      if (wk !== r.weaponKind) {
        if (r.weapon) { r.weapon.parent?.remove(r.weapon); r.weapon = null; }
        if (wk && this.weapons[wk]) { r.weapon = this.weapons[wk].clone(); rig.b.handR.add(r.weapon); }
        r.weaponKind = wk;
      }
      // the cocoon
      const webbed = e.web > .05 || e.st === "webbed" || e.st === "pinned";
      if (webbed) {
        if (!r.web) { r.web = new THREE.SkinnedMesh(rig.mesh.geometry, this.webMat); r.web.bind(rig.mesh.skeleton, rig.mesh.bindMatrix); r.web.frustumCulled = false; rig.mesh.add(r.web); r.web.material = this.webMat.clone(); r.web.material.onBeforeCompile = this.webMat.onBeforeCompile; r.web.material.customProgramCacheKey = this.webMat.customProgramCacheKey; }
        r.web.visible = true;
        r.web.material.opacity = Math.min(1, e.st === "webbed" || e.st === "pinned" ? 1 : e.web);
      } else if (r.web) r.web.visible = false;
      // hit flash
      const U = rig.mat.userData.u;
      U.uHit.value = Math.max(0, (U.uHit.value || 0) - dt * 5);
      if (e.flash) { U.uHit.value = 1; e.flash = 0; }
    }
    for (const id of [...this.rigs.keys()]) if (!seen.has(id)) this.release(id);
  }
  drawProps(list) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let m = this.propMeshes.get(p.id);
      if (!m) { m = new THREE.Mesh(this.propGeo[p.kind] || this.propGeo.crate, this.propMat[p.kind] || this.propMat.crate); m.castShadow = true; this.scene.add(m); this.propMeshes.set(p.id, m); }
      m.position.set(p.x, p.y, p.z);
      m.rotation.set(p.rest ? 0 : p.rot, p.rot * .7, 0);
    }
    for (const [id, m] of this.propMeshes) if (!seen.has(id)) { this.scene.remove(m); this.propMeshes.delete(id); }
  }
  hideAll() { for (const id of [...this.rigs.keys()]) this.release(id); for (const [id, m] of this.propMeshes) { this.scene.remove(m); } this.propMeshes.clear(); }
}
const _u = new V(), _f = new V(), _pp = new V();
// fists up, elbows in, on top of whatever the legs are doing
function guardArms(rig) {
  const e = new THREE.Euler(), D = Math.PI / 180;
  rig.target[6].setFromEuler(e.set(-60 * D, 10 * D, 22 * D)); rig.target[7].setFromEuler(e.set(-115 * D, 0, 0));
  rig.target[9].setFromEuler(e.set(-55 * D, -10 * D, -22 * D)); rig.target[10].setFromEuler(e.set(-118 * D, 0, 0));
}
// white strands over the body: the same skinned geometry pushed out a little, with a web pattern
function webMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: .8, transparent: true, opacity: 1, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWebP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += objectNormal * .035; vWebP = position * 9.;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vWebP;")
      .replace("#include <alphatest_fragment>", `#include <alphatest_fragment>
        { vec3 q = vWebP; float a = abs(sin(q.x + q.y * .7) * sin(q.y * 1.3 - q.z) * sin(q.z * 1.1 + q.x * .5));
          float s = smoothstep(.12, .0, a) + smoothstep(.85, 1., abs(sin(q.x * .5 + q.z * .9)));
          diffuseColor.a *= clamp(s, .0, 1.) * .95 + .08; }`);
  };
  m.customProgramCacheKey = () => "heroweb1";
  return m;
}

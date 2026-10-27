// Hero mode combat, the hero's side: picking a target (and switching), lunging combos of punches and
// kicks, a launcher and air combos, slams, dodges (a well-timed one is a perfect dodge with a counter),
// the web gadgets - shots, pull/disarm, launch, bombs, traps, impact webs - throwing props and stunned
// enemies, finishers, healing, and taking hits. Hits land on the enemy simulation directly when this
// machine runs it (solo, or the host), and are sent to the host otherwise, with the reaction shown here
// at once so nothing waits on the network.
import * as THREE from "three";
import { KINDS } from "./hero-enemies.js?v=mvq292b7";
import { HIP_H } from "./hero-rig.js?v=mvq292b7";

const V = THREE.Vector3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// The ground string is deliberately longer than a simple punch loop.  Each branch has a
// different silhouette, so the player can read where the chain is going before the hit lands.
const COMBO = ["jab", "cross", "hook", "uppercut", "kick", "roundhouse", "spin"];
const FINISHERS = ["hook", "kick", "uppercut", "roundhouse", "spin"];
export const GADGETS = [
  null,
  { id: "shot", name: "Web Shot", key: "E / 1", cool: 0, ammo: 10 },
  { id: "pull", name: "Web Pull", key: "2", cool: 1.4 },
  { id: "launch", name: "Web Launch", key: "3", cool: 3 },
  { id: "bomb", name: "Web Bomb", key: "4", cool: 14 },
  { id: "trap", name: "Web Trap", key: "5", cool: 8 },
  { id: "impact", name: "Impact Web", key: "6", cool: 6 },
];
// The arc abilities: big moves on long cooldowns, for when a fight turns against the hero.
export const ABILITIES = [
  null,
  { id: "burst", name: "Arc Burst", key: "7", cool: 18, note: "A shockwave that throws everyone nearby into the air" },
  { id: "tether", name: "Tether Storm", key: "8", cool: 22, note: "Lines to every enemy in reach, yanked together and webbed" },
  { id: "overcharge", name: "Overcharge", key: "9", cool: 28, note: "Nine seconds of heavy, guard-breaking hits" },
];

export class HeroCombat {
  constructor(hero) {
    this.hero = hero;
    this.hp = 1; this.focus = 0; this.combo = 0; this.comboT = 0; this.bestCombo = 0;
    this.action = null; this.target = null; this.lock = null;
    this.cool = [0, 0, 0, 0, 0, 0, 0]; this.ammo = 10;
    this.dodgeT = 0; this.dodgeStart = -9; this.counterT = 0; this.iframes = 0;
    this.shots = [];      // the hero's web projectiles: { x, y, z, vx, vy, vz, t, kind, side }
    this.bombs = [];      // { x, y, z, vx, vy, vz, t }
    this.traps = [];      // { x, y, z, nx, ny, nz, t }
    this.held = null;     // a prop or an enemy on the end of a line, being swung round to throw
    this.senses = [];     // incoming attacks: { e, t, kind }
    this.regenT = 0; this.downT = 0; this.healT = 0;
    this.slow = 1; this.slowT = 0; this.stopT = 0;
    this.kills = 0;
    this.chain = 0; this.attackHeldT = 0; this.launchQueued = false;
    this.dodgeCool = 0; this.hurtGrace = 0; this.perfectDodge = false;
    this.pendingHits = [];
    this.acool = [0, 0, 0, 0]; this.overT = 0; this.parryT = 0; this.parryCool = 0;
  }
  get H() { return this.hero.H; }
  reset() {
    this.dropHeld();
    this.hp = 1; this.focus = 0; this.combo = 0; this.comboT = 0; this.chain = 0;
    this.action = this.target = this.lock = this.buf = this.held = null;
    this.cool.fill(0); this.ammo = 10;
    this.dodgeT = this.dodgeCool = this.counterT = this.iframes = this.hurtGrace = 0;
    this.regenT = this.downT = this.healT = this.stopT = this.slowT = this.attackHeldT = 0;
    this.dodgeStart = -9; this.perfectDodge = this.launchQueued = false;
    this.shots.length = this.bombs.length = this.traps.length = this.senses.length = this.pendingHits.length = 0;
    this.acool.fill(0); this.overT = this.parryT = this.parryCool = 0;
    this.H.combatLock = 0;
  }
  // the enemies as they are drawn here (sim on this machine, else the host's snapshots)
  get list() { return this.hero.enemyList(); }
  alive(e) { return e && e.st !== "ko" && e.st !== "pinned" && e.hp > 0; }
  near(r = 18) { const H = this.H; return this.list.filter((e) => this.alive(e) && Math.hypot(e.x - H.p.x, e.z - H.p.z) < r && Math.abs(e.y - H.p.y) < 8); }
  get inCombat() {
    const p = this.H.p;
    return this.list.some(e => this.alive(e) && e.alert !== false && e.st !== "idle"
      && Math.abs(e.y - p.y) < 8 && (e.x - p.x) ** 2 + (e.z - p.z) ** 2 < 484);
  }
  visible(e) { const p = this.H.p; return this.hero.W.clear(p.x, p.y + .25, p.z, e.x, e.y + .25, e.z, 2, .35); }
  threatening(s) {
    const e = this.byId(s.e);
    return this.alive(e) && !["hit", "down", "getup", "webbed"].includes(e.st)
      && (e.st !== "air" || s.kind === "slam") && this.dist(e) < (s.kind === "shot" ? 42 : s.kind === "slam" ? 8 : 6);
  }

  // ------------------------------------------------------------------ targeting
  pickTarget(inp, range = 25) {
    const H = this.H;
    if (this.lock && this.alive(this.byId(this.lock)) && this.dist(this.byId(this.lock)) < 36 && this.visible(this.byId(this.lock))) return this.byId(this.lock);
    this.lock = null;
    const m = Math.hypot(inp.mx, inp.mz);
    let px = m > .2 ? inp.mx : inp.look.x, pz = m > .2 ? inp.mz : inp.look.z;
    const L = Math.hypot(px, pz) || 1; px /= L; pz /= L;
    let best = null, bs = Infinity;
    for (const e of this.list) {
      if (!this.alive(e)) continue;
      const dx = e.x - H.p.x, dz = e.z - H.p.z, d = Math.hypot(dx, dz);
      if (d > range || Math.abs(e.y - H.p.y) > 9) continue;
      const ang = Math.acos(clamp((dx * px + dz * pz) / (d || 1), -1, 1));
      if (d > 4 && ang > 1.8) continue;
      const s = ang * 3.8 + d * .15 - (e.st === "windup" ? .8 : 0) - (this.target === e.id ? .65 : 0);
      if (s < bs && this.visible(e)) { bs = s; best = e; }
    }
    return best;
  }
  byId(id) { return this.list.find((e) => e.id === id) || null; }
  dist(e) { return e ? Math.hypot(e.x - this.H.p.x, e.z - this.H.p.z) : 1e9; }
  cycleTarget(dir) {
    const H = this.H, list = this.near(28).filter((e) => this.visible(e));
    if (!list.length) return;
    const ang = (e) => Math.atan2(e.x - H.p.x, e.z - H.p.z);
    list.sort((a, b) => ang(a) - ang(b));
    const cur = list.findIndex((e) => e.id === (this.lock || this.target));
    const nx = list[((cur < 0 ? 0 : cur + dir) % list.length + list.length) % list.length];
    this.lock = nx.id; this.target = nx.id;
  }

  // ------------------------------------------------------------------ per frame (before the body moves)
  pre(dt, inp) {
    const H = this.H;
    this.comboT -= dt; if (this.comboT <= 0) { this.bestCombo = Math.max(this.bestCombo, this.combo); this.combo = 0; this.chain = 0; }
    for (let i = 1; i < 7; i++) this.cool[i] = Math.max(0, this.cool[i] - dt);
    for (let i = 1; i < 4; i++) this.acool[i] = Math.max(0, this.acool[i] - dt);
    this.overT = Math.max(0, this.overT - dt); this.parryT = Math.max(0, this.parryT - dt); this.parryCool = Math.max(0, this.parryCool - dt);
    this.ammo = Math.min(10, this.ammo + dt * 1.1);
    this.dodgeT = Math.max(0, this.dodgeT - dt); this.iframes = Math.max(0, this.iframes - dt); this.counterT = Math.max(0, this.counterT - dt);
    this.dodgeCool = Math.max(0, this.dodgeCool - dt); this.hurtGrace = Math.max(0, this.hurtGrace - dt);
    if (this.downT > 0) return;
    // heal: hold the finisher key with a bar of focus
    if (inp.finisherHeld && !this.action && this.focus >= 1 && this.hp < 1) { this.healT += dt; if (this.healT > .5) { this.healT = 0; this.focus -= 1; this.hp = Math.min(1, this.hp + .45); this.hero.onCombat("heal"); } }
    else if (!inp.finisherHeld) this.healT = 0;
    // health comes back slowly once out of the fight
    this.regenT = this.inCombat ? 0 : this.regenT + dt;
    if (this.regenT > 5) this.hp = Math.min(1, this.hp + dt * .1);
    if (inp.cycle) this.cycleTarget(inp.cycle);
    if (inp.lockTarget) { const t = this.pickTarget(inp, 30); this.lock = this.lock ? null : t?.id || null; }
    const tgt = this.pickTarget(inp);
    this.target = tgt?.id ?? null;
    if (inp.attackDown) { this.attackHeldT = 0; this.launchQueued = false; }
    if (inp.attackHeld) this.attackHeldT += dt;
    // A press in the middle of a move isn't lost: it's held for a moment and happens when the move
    // ends (that's what lets combos flow). A dodge cancels anything but another dodge.
    // the pad's B is also crouch: it only parries when there is a fight to parry in
    const parry = inp.parry && (inp.parryKey || this.inCombat || this.senses.length);
    const press = inp.dodge ? "dodge" : parry ? "parry" : inp.ability ? "a" + inp.ability : inp.strike ? "strike" : inp.finisher ? "finisher" : inp.throwObj ? "throw" : inp.gadget ? "g" + inp.gadget
      : inp.attackDown ? "attack" : null;
    if (press && (press !== "dodge" || this.dodgeCool <= 0)) this.buf = { cmd: press, t: .42, inp: { mx: inp.mx, mz: inp.mz, look: inp.look.clone(), camPos: inp.camPos.clone(), crouch: inp.crouch, ix: inp.ix, iy: inp.iy } };
    if (this.buf && (this.buf.t -= dt) <= 0) this.buf = null;
    const a = this.action;
    const cancel = a && ((this.buf?.cmd === "dodge" || this.buf?.cmd === "parry") && a.kind !== "dodge" && a.kind !== "parry" && a.kind !== "finisher"
      || this.buf && a.done && a.t >= Math.max(a.hitAt + .06, a.dur * .62) && ["jab", "cross", "hook", "uppercut", "kick", "roundhouse", "spin", "air", "launch"].includes(a.kind));
    if (this.action && !cancel) return;
    if (cancel) { this.action = null; H.combatLock = 0; }
    const air = H.state === "air" || H.state === "swing" || H.state === "zip";
    // hold to launch (on the ground, someone in reach)
    if (inp.attackHeld && this.attackHeldT > .4 && !this.launchQueued && !air && tgt && this.dist(tgt) < 6) { this.launchQueued = true; this.buf = null; return this.start({ kind: "launch", dur: .42, hitAt: .17, target: tgt.id, lunge: true }); }
    const b = this.buf;
    if (!b) return;
    this.buf = null;
    const I = b.inp;
    switch (b.cmd) {
      case "dodge": if (H.state === "ground" || this.inCombat && H.state === "air") this.dodge(I); break;
      case "strike": if (tgt && this.dist(tgt) < 34) this.start({ kind: "webstrike", dur: 2, target: tgt.id, fly: true }); else this.hero.onCombat("deny"); break;
      case "finisher": if (tgt && this.dist(tgt) < 9 && this.focus >= 1) {
        this.focus -= 1;
        // Context changes the finisher silhouette: the current chain chooses the family, while the
        // target's height selects an aerial-looking kick or an uppercut when they are grounded.
        const style = tgt.air ? 1 : this.chain % FINISHERS.length;
        this.start({ kind: "finisher", style, dur: .9, target: tgt.id, hitAt: .63, lunge: true });
      } else this.hero.onCombat("deny"); break;
      case "throw": this.grab(I, tgt); break;
      case "attack": this.attack(I, tgt, air); break;
      case "parry": if (this.parryCool <= 0) this.parry(); break;
      default: if (b.cmd[0] === "a") this.ability(+b.cmd.slice(1), I, tgt); else this.gadget(+b.cmd.slice(1), I, tgt);
    }
  }
  attack(inp, tgt, air) {
    const H = this.H;
    const reach = air ? 10 : 9;
    const t = tgt && this.dist(tgt) < reach && Math.abs(tgt.y - H.p.y) < (air ? 6 : 2.5) ? tgt : null;
    if (air) {
      // diving in with the crouch held: a slam into the ground below
      if (inp.crouch && H.heightAbove() > 2) return this.start({ kind: "slam", dur: 1.2, hitAt: 9, slamDown: true });
      if (t || this.inCombat) return this.start({ kind: "air", dur: .3, hitAt: .12, target: t?.id, lunge: !!t, n: this.combo });
      return;
    }
    // standing on a getaway car: hit the car
    if (this.H.riding?.car?.chase) { this.start({ kind: COMBO[this.combo % COMBO.length], dur: .34, hitAt: .14, side: 1 }); this.hero.punchCar?.(this.H.riding.car); return; }
    if (this.counterT > 0 && t) { this.counterT = 0; return this.start({ kind: "roundhouse", dur: .42, hitAt: .17, target: t.id, lunge: true, counter: true }); }
    // downed enemies get a ground pound
    if (t && (t.st === "down" || t.st === "webbed")) return this.start({ kind: "slam", dur: .45, hitAt: .22, target: t.id, lunge: true, ground: true });
    const kind = COMBO[this.chain % COMBO.length];
    const heavy = ["roundhouse", "spin"].includes(kind);
    this.start({ kind, dur: heavy ? .44 : kind === "kick" ? .36 : kind === "uppercut" ? .34 : .29, hitAt: heavy ? .17 : .12, target: t?.id, lunge: !!t });
  }
  start(a) {
    const H = this.H;
    a.t = 0; a.done = false; a.side = this.side = -(this.side || 1);
    this.action = a;
    H.combatLock = a.dur;
    if (a.target && (H.state === "swing" || H.state === "zip")) { H.releaseWebs("combat"); H.zip = null; H.toAir(); }
    const tg = a.target ? this.byId(a.target) : null;
    if (tg) {
      const dx = tg.x - H.p.x, dz = tg.z - H.p.z, d = Math.hypot(dx, dz) || 1;
      H.face.set(dx / d, 0, dz / d); a.dist0 = d;
      if (a.lunge && a.hitAt < a.dur) {
        // Keep nearby punches quick, but let the body cross a real gap before checking the hit.
        const standOff = (KINDS[tg.kind]?.r || .4) + 1.05;
        const travel = clamp((d - standOff) / 26 - a.hitAt + .025, 0, .24);
        a.hitAt += travel; a.dur += travel;
        H.combatLock = a.dur;
      }
    }
    this.hero.onCombat("swing", a);
  }
  dodge(inp) {
    const H = this.H;
    let dx = inp.mx, dz = inp.mz;
    // with no direction, step away from whoever is about to hit us (or back)
    if (Math.hypot(dx, dz) < .2) {
      const s = this.senses[0] && this.byId(this.senses[0].e);
      if (s) { dx = H.p.x - s.x; dz = H.p.z - s.z; } else { dx = -H.face.x; dz = -H.face.z; }
    }
    const L = Math.hypot(dx, dz) || 1;
    H.v.x = dx / L * 14; H.v.z = dz / L * 14; if (H.state === "air") H.v.y = Math.max(H.v.y, 3);
    this.dodgeT = .38; this.iframes = .31; this.dodgeCool = .47; this.dodgeStart = this.hero.clock; this.perfectDodge = false;
    const side = Math.sign(dx * H.face.z - dz * H.face.x) || 1;
    this.action = { kind: "dodge", t: 0, dur: .38, dir: side };
    H.combatLock = .3;
    this.hero.onCombat("dodge");
    // Reward the timing even when moving clear makes the warned attack miss completely.
    if (this.senses.some((s) => s.t >= -.04 && s.t <= .22 && this.threatening(s))) this.perfect("sense");
  }
  // Parry: a guard raised for a moment. A blow that lands inside it is turned aside, the attacker is
  // staggered, and the next attack is a counter.
  parry() {
    this.parryT = .3; this.parryCool = .55;
    this.action = { kind: "parry", t: 0, dur: .42, hitAt: 99 };
    this.H.combatLock = .26;
    this.hero.onCombat("guard");
  }
  parried(kx, kz, fromId) {
    const H = this.H;
    let e = fromId != null ? this.byId(fromId) : null;
    if (!this.alive(e)) {
      // the attacker stands where the blow came from
      let bd = 30;
      e = null;
      for (const q of this.list) { if (!this.alive(q)) continue; const d = (q.x - H.p.x) ** 2 + (q.z - H.p.z) ** 2; if (d < bd) { bd = d; e = q; } }
    }
    this.parryT = 0; this.counterT = 1.8; this.slowT = .3; this.comboT = Math.max(this.comboT, 3);
    this.focus = Math.min(3, this.focus + .4 * (this.focusK || 1));
    if (this.action?.kind === "parry") this.action.riposte = true;
    if (e) {
      const dx = e.x - H.p.x, dz = e.z - H.p.z, d = Math.hypot(dx, dz) || 1;
      H.face.set(dx / d, 0, dz / d);
      this.applyHit(e, { dmg: 7, kind: "hook", kx: dx / d, kz: dz / d, heavy: true, knock: 5 });
    }
    this.hero.onCombat("parry", { e });
  }
  // the arc abilities (7 / 8 / 9)
  ability(n, inp, tgt) {
    const A = ABILITIES[n], H = this.H;
    if (!A || this.acool[n] > 0) return this.hero.onCombat("deny");
    if (A.id === "burst") this.start({ kind: "burst", dur: .6, hitAt: .24 });
    else if (A.id === "tether") {
      const list = this.near(26).filter((e) => this.visible(e)).sort((a, b) => this.dist(a) - this.dist(b)).slice(0, 6);
      if (!list.length) return this.hero.onCombat("deny");
      const fx = H.p.x + H.face.x * 2.2, fz = H.p.z + H.face.z * 2.2;
      list.forEach((e, i) => {
        const dx = fx - e.x, dz = fz - e.z, d = Math.hypot(dx, dz) || 1;
        this.applyHit(e, { dmg: 9, kind: "pull", pull: 1, web: .6, x: fx, z: fz, kx: dx / d, kz: dz / d });
        this.hero.onCombat("line", { to: new V(e.x, e.y + .3, e.z), side: i % 2 ? 1 : -1, yank: true });
      });
      this.start({ kind: "web", dur: .55, hitAt: 99 });
      this.combo += list.length; this.comboT = 3;
    } else if (A.id === "overcharge") this.overT = 9;
    this.acool[n] = A.cool * (this.coolK || 1);
    this.hero.onCombat("ability", { id: A.id, name: A.name });
  }
  perfect(kind) {
    if (this.perfectDodge) return;
    this.perfectDodge = true;
    this.focus = Math.min(3, this.focus + .35 * (this.focusK || 1));
    this.counterT = 1.6; this.slowT = .32; this.comboT = Math.max(this.comboT, 2.8);
    this.hero.onCombat("perfect", { kind });
  }

  // ------------------------------------------------------------------ after the body has moved
  post(dt) {
    const H = this.H, a = this.action;
    this.updateShots(dt); this.updateBombs(dt); this.updateTraps(dt); this.updateHeld(dt);
    this.senses = this.senses.filter((s) => (s.t -= dt) > -.18 && this.threatening(s)).sort((a, b) => a.t - b.t);
    for (let i = this.pendingHits.length - 1; i >= 0; i--) {
      const h = this.pendingHits[i];
      if ((h.t -= dt) > 0) continue;
      this.pendingHits.splice(i, 1);
      const e = this.byId(h.id);
      if (this.downT <= 0 && this.alive(e) && this.visible(e)) this.applyHit(e, h.hit);
    }
    if (!a) return;
    a.t += dt * (this.hero.flash?.on && ["jab", "cross", "hook", "uppercut", "kick", "roundhouse", "air"].includes(a.kind) ? 1.6 : 1);
    const tg = a.target ? this.byId(a.target) : null;
    // the lunge: close the gap to the target over the first part of the move
    if (a.lunge && tg && this.alive(tg) && a.t < (a.hitAt ?? .2)) {
      const dx = tg.x - H.p.x, dz = tg.z - H.p.z, d = Math.hypot(dx, dz) || 1, want = (KINDS[tg.kind]?.r || .4) + 1.05;
      if (d > want) {
        const sp = Math.min(26, (d - want) / Math.max(.04, (a.hitAt ?? .2) - a.t + .02));
        H.v.x = dx / d * sp; H.v.z = dz / d * sp;
        if (H.state === "air" || a.kind === "air") H.v.y = (tg.y + .1 - H.p.y) * 6;
      } else { H.v.x *= .3; H.v.z *= .3; }
      H.face.set(dx / d, 0, dz / d);
    }
    // air combos: the hero hangs in the air with the target
    if (a.kind === "air" || a.kind === "launch" && a.t > a.hitAt && a.follow) { if (H.state === "air") H.v.y = Math.max(H.v.y, -.6); }
    if (a.kind === "webstrike") return this.webStrike(dt, a, tg);
    if (a.kind === "slam" && a.slamDown) {
      H.v.y = Math.min(H.v.y, -34); H.v.x *= .9; H.v.z *= .9;
      if (H.state !== "air" || a.t > 1.1) { this.impact(H.p.x, H.p.y, H.p.z, 5.5, 22, { slam: true, heavy: true }); this.hero.onCombat("slamland"); this.action = null; H.combatLock = 0; }
      return;
    }
    if (!a.done && a.t >= (a.hitAt ?? .15)) {
      a.done = true;
      this.land(a, tg);
    }
    if (a.t >= a.dur) { this.action = null; H.combatLock = 0; }
  }
  // the moment a blow lands
  land(a, tg) {
    const H = this.H, f = H.face;
    if (a.kind === "burst") {
      this.impact(H.p.x, H.p.y, H.p.z, 9.5, 24 * (this.dmgK || 1), { launch: 10, knock: 9 });
      this.combo += 1; this.comboT = 3; this.stopT = .1;
      this.hero.onCombat("burst");
      return;
    }
    const base = { jab: 9, cross: 11, hook: 13, uppercut: 15, kick: 14, roundhouse: 18, spin: 20, air: 11, launch: 10, slam: 20, finisher: 999 }[a.kind] || 10;
    const over = this.overT > 0;
    const dmg = base * (a.counter ? 2 : 1) * (1 + Math.min(1, this.combo / 30) * .5) * (this.dmgK || 1) * (over ? 1.7 : 1);
    const opts = { heavy: over || ["roundhouse", "spin"].includes(a.kind) || a.counter || a.kind === "finisher", launch: a.kind === "launch" ? 12 : a.kind === "uppercut" ? 9 : 0, slam: false, knock: ["kick", "spin"].includes(a.kind) ? 6 : undefined };
    if (a.kind === "air" && this.combo % 5 === 4) opts.slam = true;            // the last hit of an air string sends them down
    const hits = [];
    const reach = ["roundhouse", "spin"].includes(a.kind) ? 2.8 : 2.3;
    for (const e of this.list) {
      if (!this.alive(e)) continue;
      const dx = e.x - H.p.x, dz = e.z - H.p.z, d = Math.hypot(dx, dz), dy = Math.abs(e.y - H.p.y);
      const front = (dx * f.x + dz * f.z) / (d || 1);
      const isT = tg && e.id === tg.id;
      if (dy > 2.5 || d > reach + (isT ? .7 : 0) || !this.visible(e)) continue;
      if (!isT && (front < (["roundhouse", "spin"].includes(a.kind) ? -.2 : .5) || a.kind === "finisher")) continue;
      hits.push(e);
    }
    if (!hits.length) { this.hero.onCombat("whiff", a); return; }
    for (const e of hits) {
      const dx = e.x - H.p.x, dz = e.z - H.p.z, d = Math.hypot(dx, dz) || 1;
      this.applyHit(e, { dmg: e === tg || !tg ? dmg : dmg * .6, kind: a.kind, kx: dx / d, kz: dz / d, ...opts, finisher: a.kind === "finisher" });
    }
    this.combo += hits.length; this.comboT = 3; this.chain++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.focus = Math.min(3, this.focus + (.07 * hits.length + (a.counter ? .3 : 0)) * (this.focusK || 1));
    // launching: jump after them
    if (a.kind === "launch") { a.follow = true; H.v.y = 12.5; H.toAir(); H.combatLock = .25; }
    // Light hits keep the string moving; heavy finishers get a more deliberate impact pause.
    this.stopT = a.kind === "finisher" ? .1 : opts.heavy ? .055 : .022;
    this.hero.onCombat("hit", { a, n: hits.length, e: hits[0], heavy: opts.heavy });
  }
  // send a hit where the enemy simulation is (and show it here straight away)
  applyHit(e, h) {
    h.from = this.hero.meId();
    if (this.hero.flash?.on && h.dmg && h.kind !== "lightning" && h.kind !== "slam") h.dmg *= 1.35;
    e.flash = 1;
    this.hero.hitEnemy(e.id, h);
  }
  impact(x, y, z, r, dmg, o) {
    for (const e of this.list) {
      if (!this.alive(e)) continue;
      const dx = e.x - x, dz = e.z - z, d = Math.hypot(dx, dz);
      if (d < r && Math.abs(e.y - y) < 3 && this.hero.W.clear(x, y + .3, z, e.x, e.y + .3, e.z, 2, .25)) this.applyHit(e, { dmg: dmg * (1 - d / r * .5), kind: "slam", kx: dx / (d || 1), kz: dz / (d || 1), heavy: true, ...o, slam: false });
    }
  }
  webStrike(dt, a, tg) {
    const H = this.H;
    if (!tg || !this.alive(tg) || !this.visible(tg)) { this.action = null; H.combatLock = 0; return; }
    if (a.t < .05) { this.hero.onCombat("line", { to: new V(tg.x, tg.y + .3, tg.z), side: 1 }); return; }
    const dx = tg.x - H.p.x, dy = tg.y + .2 - H.p.y, dz = tg.z - H.p.z, d = Math.hypot(dx, dy, dz) || .001;
    H.v.set(dx / d * 34, dy / d * 34 + 2, dz / d * 34);
    if (H.state !== "air") H.toAir();
    H.face.set(dx, 0, dz).normalize();
    a.flyLine = true;
    if (d < 1.8) {
      this.action = { kind: "kick", t: .12, dur: .4, hitAt: .14, target: tg.id, lunge: false, done: false, side: 1 };
      H.v.multiplyScalar(.15);
      this.land({ kind: "kick", counter: true }, tg);
      this.action.done = true;
      this.hero.onCombat("webstrike");
    }
    if (a.t > 1.4) { this.action = null; H.combatLock = 0; }
  }

  // ------------------------------------------------------------------ gadgets
  gadget(n, inp, tgt) {
    const G = GADGETS[n], H = this.H;
    if (!G) return;
    if (this.cool[n] > 0 || (G.id === "shot" && this.ammo < 1)) return this.hero.onCombat("deny");
    const aim = this.aimPoint(inp, tgt);
    const side = this.side = -(this.side || 1);
    const hand = this.hero.handPos(side);
    switch (G.id) {
      case "shot": case "impact": {
        const sp = G.id === "shot" ? 95 : 75;
        const dx = aim.x - hand.x, dy = aim.y - hand.y, dz = aim.z - hand.z, L = Math.hypot(dx, dy, dz) || 1;
        this.shots.push({ x: hand.x, y: hand.y, z: hand.z, vx: dx / L * sp, vy: dy / L * sp + 1, vz: dz / L * sp, t: 0, kind: G.id, side, target: tgt?.id });
        if (G.id === "shot") this.ammo -= 1; else this.cool[n] = G.cool * (this.coolK || 1);
        break;
      }
      case "pull": case "launch": {
        if (!tgt || this.dist(tgt) > 30) return this.hero.onCombat("deny");
        this.cool[n] = G.cool * (this.coolK || 1);
        this.hero.onCombat("line", { to: new V(tgt.x, tgt.y + .3, tgt.z), side, yank: true });
        // A distant or airborne pull becomes a web-zip strike.  This preserves the close-range
        // yank for grounded enemies while letting the player cross a fight quickly and keep a combo
        // moving instead of stopping at the end of the line.
        if (G.id === "pull" && (this.dist(tgt) > 11 || tgt.air || ["down", "webbed"].includes(tgt.st))) {
          this.start({ kind: "webstrike", dur: 1.45, target: tgt.id, fly: true });
          return;
        }
        const hit = G.id === "pull" ? tgt.weapon ? { disarm: true, kind: "pull", dmg: 2 } : { pull: true, x: H.p.x, z: H.p.z, kind: "pull", dmg: 4 }
          : { launch: 12, dmg: 6, kind: "launch", kx: 0, kz: 0 };
        this.pendingHits.push({ id: tgt.id, t: .12, hit });
        break;
      }
      case "bomb": {
        this.cool[n] = G.cool * (this.coolK || 1);
        const dx = aim.x - hand.x, dz = aim.z - hand.z, d = Math.hypot(dx, dz), tt = clamp(d / 22, .35, 1.1);
        this.bombs.push({ x: hand.x, y: hand.y, z: hand.z, vx: dx / tt, vy: (aim.y - hand.y) / tt + 11 * tt, vz: dz / tt, t: 0 });
        break;
      }
      case "trap": {
        const h = this.hero.W.raycast(inp.camPos.x, inp.camPos.y, inp.camPos.z, inp.look.x, inp.look.y, inp.look.z, 40, 2, {});
        const at = h || { x: H.p.x + H.face.x * 3, y: H.p.y - HIP_H, z: H.p.z + H.face.z * 3, nx: 0, ny: 1, nz: 0 };
        this.cool[n] = G.cool * (this.coolK || 1);
        if (this.traps.length >= 3) this.traps.shift();
        this.traps.push({ x: at.x, y: at.y, z: at.z, nx: at.nx, ny: at.ny, nz: at.nz, t: 0 });
        this.hero.onCombat("trapset", { x: at.x, y: at.y, z: at.z });
        break;
      }
    }
    this.action = { kind: "web", t: 0, dur: .32, hitAt: 99, side };
    H.combatLock = Math.max(H.combatLock, .12);
    this.hero.onCombat("gadget", { id: G.id, side, to: aim });
  }
  aimPoint(inp, tgt) {
    if (tgt && this.dist(tgt) < 40) return new V(tgt.x, tgt.y + .3, tgt.z);
    const h = this.hero.W.raycast(inp.camPos.x, inp.camPos.y, inp.camPos.z, inp.look.x, inp.look.y, inp.look.z, 60, 2, {});
    return h ? new V(h.x, h.y, h.z) : new V().copy(inp.camPos).addScaledVector(inp.look, 40);
  }
  updateShots(dt) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt; s.vy -= 3 * dt;
      const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt, nz = s.z + s.vz * dt;
      let gone = s.t > 1.2;
      if (this.hero.carHit?.(s, nx, ny, nz)) gone = true;
      if (!gone) for (const e of this.list) {
        if (!this.alive(e)) continue;
        const ax = e.x - s.x, ay = e.y + .2 - s.y, az = e.z - s.z, sx = nx - s.x, sy = ny - s.y, sz = nz - s.z, L2 = sx * sx + sy * sy + sz * sz;
        const k = clamp((ax * sx + ay * sy + az * sz) / (L2 || 1), 0, 1), cx = s.x + sx * k - e.x, cy = s.y + sy * k - e.y - .2, cz = s.z + sz * k - e.z;
        if (cx * cx + cy * cy + cz * cz < .75 * .75 && this.hero.W.clear(s.x, s.y, s.z, e.x, e.y + .2, e.z, 2, .05)) {
          const sp = Math.hypot(s.vx, s.vz) || 1;
          if (s.kind === "shot") this.applyHit(e, { web: .34, dmg: 2, kind: "webshot", kx: s.vx / sp, kz: s.vz / sp, knock: 1 });
          else this.applyHit(e, { web: .65, dmg: 14, kind: "impact", kx: s.vx / sp, kz: s.vz / sp, heavy: true, knock: 13 });
          this.hero.onCombat("webhit", { x: e.x, y: e.y + .2, z: e.z, kind: s.kind });
          gone = true; break;
        }
      }
      if (!gone) {
        const h = this.hero.W.raycast(s.x, s.y, s.z, s.vx, s.vy, s.vz, Math.hypot(nx - s.x, ny - s.y, nz - s.z), 2, _h);
        if (h) { this.hero.onCombat("webhit", { x: h.x, y: h.y, z: h.z, kind: "wall" }); gone = true; }
      }
      s.x = nx; s.y = ny; s.z = nz;
      if (gone) this.shots.splice(i, 1);
    }
  }
  updateBombs(dt) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t += dt; b.vy -= 22 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      const fy = this.hero.W.topAt(b.x, b.z, b.y + 1);
      if (b.y < fy + .2) { b.y = fy + .2; b.vx *= .4; b.vz *= .4; b.vy = Math.abs(b.vy) * .25; }
      if (b.t > 1.05) {
        this.bombs.splice(i, 1);
        for (const e of this.list) { if (!this.alive(e)) continue; const d = Math.hypot(e.x - b.x, e.y - b.y, e.z - b.z); if (d < 6.5) this.applyHit(e, { web: 1.3, dmg: 6, kind: "webbomb" }); }
        this.hero.onCombat("bomb", { x: b.x, y: b.y, z: b.z });
      }
    }
  }
  updateTraps(dt) {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const t = this.traps[i];
      t.t += dt;
      if (t.t > 90) { this.traps.splice(i, 1); continue; }
      for (const e of this.list) {
        if (!this.alive(e) || e.st === "webbed") continue;
        if (Math.hypot(e.x - t.x, e.y - HIP_H - t.y, e.z - t.z) < 3.6) {
          this.applyHit(e, { web: 1.3, pull: true, x: t.x, z: t.z, dmg: 4, kind: "trap" });
          this.hero.onCombat("trap", { x: t.x, y: t.y, z: t.z, e: e.id });
          this.traps.splice(i, 1);
          break;
        }
      }
    }
  }
  // web throw: a stunned enemy, else the nearest loose prop, swung round on a line and thrown
  grab(inp, tgt) {
    const H = this.H;
    if (this.held) return;
    let pick = null;
    if (tgt && this.dist(tgt) < 18 && ["webbed", "down", "hit", "air"].includes(tgt.st) && (KINDS[tgt.kind]?.armor || 0) < 2) pick = { enemy: tgt.id };
    else {
      let best = null, bd = 18;
      for (const p of this.hero.propList()) { if (p.held) continue; const d = Math.hypot(p.x - H.p.x, p.y - H.p.y, p.z - H.p.z); if (d < bd) { bd = d; best = p; } }
      if (best) pick = { prop: best.id };
    }
    if (!pick) return this.hero.onCombat("deny");
    // throw it at the target (or another enemy if the target is what we're throwing), else where we look
    const others = this.near(30).filter((e) => e.id !== pick.enemy);
    const at = (pick.enemy ? others.sort((a, b) => this.dist(a) - this.dist(b))[0] : tgt) || null;
    this.held = { ...pick, t: 0, at: at?.id || null, dir: inp.look.clone() };
    this.action = { kind: "throw", t: 0, dur: .6, hitAt: 99, side: 1 };
    H.combatLock = .5;
    this.hero.onCombat("grab", pick);
  }
  updateHeld(dt) {
    const h = this.held, H = this.H;
    if (!h) return;
    h.t += dt;
    // swing it round overhead
    const ang = h.t * 14, r = 3.2;
    const pos = new V(H.p.x + Math.cos(ang) * r, H.p.y + 1.6 + Math.sin(h.t * 7) * .6, H.p.z + Math.sin(ang) * r);
    this.hero.holdAt(h, pos);
    if (h.t > .55) {
      const tg = h.at ? this.byId(h.at) : null;
      let dx, dy, dz;
      if (tg) { dx = tg.x - pos.x; dy = tg.y - pos.y + .3; dz = tg.z - pos.z; } else { dx = h.dir.x; dy = h.dir.y + .1; dz = h.dir.z; }
      const L = Math.hypot(dx, dy, dz) || 1, sp = 28;
      this.hero.throwHeld(h, pos, dx / L * sp, dy / L * sp + 3, dz / L * sp);
      this.held = null;
      this.hero.onCombat("throw");
    }
  }
  dropHeld() {
    if (this.held?.prop) {
      const p = this.hero.propList().find((e) => e.id === this.held.prop);
      if (p) { p.held = null; p.rest = false; p.vx = p.vz = 0; p.vy = -1; }
    }
    this.held = null;
    if (this.hero.lines) this.hero.lines = this.hero.lines.filter((l) => !l.hold);
  }

  // ------------------------------------------------------------------ being hit
  // dmg in hit points (the hero has 100); k: direction it came from
  takeHit(dmg, kx, kz, heavy, kind, fromId) {
    const H = this.H;
    if (this.downT > 0) return "down";
    if (this.hero.flash?.on && this.hero.flash.phase > 0) return "dodged";
    if (this.hurtGrace > 0 || this.action?.kind === "finisher") return "dodged";
    if (this.parryT > 0 && kind !== "shot") { this.parried(kx, kz, fromId); return "dodged"; }
    // dodging through it
    if (this.iframes > 0) {
      const perfect = this.hero.clock - this.dodgeStart < .18;
      if (perfect) this.perfect(kind);
      else this.hero.onCombat("dodged", { kind });
      return "dodged";
    }
    this.hp -= dmg / 100 * (this.armorK || 1);
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.combo = 0; this.chain = 0; this.regenT = 0; this.hurtGrace = heavy ? .7 : .48; this.buf = null;
    this.dropHeld();
    const kl = Math.hypot(kx, kz) || 1;
    H.v.x += kx / kl * (heavy ? 10 : 4); H.v.z += kz / kl * (heavy ? 10 : 4);
    if (heavy && H.state === "ground") { H.v.y = 5; H.toAir(); }
    if (H.state === "swing" && heavy) H.releaseWebs("hit");
    this.action = { kind: "hit", t: 0, dur: heavy ? .5 : .3, hitAt: 99 };
    H.combatLock = heavy ? .45 : .2;
    if (this.hp <= 0) { this.hp = 0; this.downT = 3.5; this.hero.onCombat("down"); return "down"; }
    this.hero.onCombat("hurt", { dmg, heavy, kind });
    return "hit";
  }
  // an incoming attack has started: the sense lets the player know
  sense(e, t, kind) { this.senses = this.senses.filter((s) => s.e !== e.id); this.senses.push({ e: e.id, t, kind }); this.senses.sort((a, b) => a.t - b.t); this.hero.onCombat("sense", { e, kind }); }
  // the pose the rig should show for the current action
  attackPose() {
    const a = this.action;
    if (!a) return null;
    if (a.kind === "webstrike") return { kind: "kick", k: .5, side: 1 };
    if (a.kind === "parry") return { kind: "parry", k: clamp(a.t / a.dur, 0, 1), riposte: !!a.riposte, side: a.side || 1 };
    if (a.kind === "burst") return { kind: "burst", k: clamp(a.t / a.dur, 0, 1), impact: a.hitAt / a.dur };
    if (a.kind === "slam" && a.slamDown) return { kind: "slam", k: .4 };
    const k = clamp(a.t / a.dur, 0, 1);
    const impact = a.hitAt < a.dur ? clamp(a.hitAt / a.dur, .15, .85) : undefined;
    if (a.kind === "air") return { kind: "air", k, side: a.side, n: a.n || 0, impact };
    if (a.kind === "launch") return { kind: "uppercut", k, side: a.side, impact };
    if (a.kind === "finisher") {
      const n = FINISHERS[a.style == null ? 0 : a.style % FINISHERS.length];
      return { kind: n, k, side: a.side, impact };
    }
    return { kind: a.kind, k, side: a.side, dir: a.dir, impact };
  }
}
const _h = {};

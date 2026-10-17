// Hero mode online. Every player is the authority on their own hero: it moves here with no delay and
// goes out 20 times a second (position, velocity, the body's full orientation including flips, the
// animation state, the lines and where they're anchored, the move in progress). Everyone else draws it
// a little in the past - far enough back that there are snapshots on both sides of the moment being
// drawn - on a smooth curve through the reported positions and velocities, with the buffer sized from
// that player's measured packet spacing and jitter. A late packet that contradicts a guess is absorbed
// over a few frames instead of jumping; only a real discontinuity (a teleport) snaps.
//
// The shared world - enemies, props, crimes, rescues, races - belongs to the host (the first player in
// the room). The host runs it and sends snapshots; other players send the host their hits, grabs and
// throws, and show their own hits at once. If the host leaves, the next player in line takes over from
// the last snapshot.
import * as THREE from "three";
import { HeroRig, SUITS, poseBody, HIP_H, EMOTES } from "./hero-rig.js";
import { KIND_LIST, ATK_LIST, PROP_KINDS } from "./hero-enemies.js";
import { makeTrafficCar } from "./cars.js";
import { OBB } from "./hero-world.js";

const V = THREE.Vector3, Q = THREE.Quaternion;
export const ST_NAMES = ["ground", "air", "swing", "zip", "wall", "ledge", "perch", "water"];
const SHAPES = ["tuck", "layout", "pike", "spread", "corkscrew", "superman", "split"];
const ATKS = ["jab", "cross", "hook", "kick", "roundhouse", "air", "uppercut", "slam", "dodge", "web", "throw", "hit", "down", "emote", "launch", "finisher"];
const F = { dive: 1, glide: 2, slide: 4, crouch: 8, wallrun: 16, ceiling: 32, carry: 64, down: 128, roll: 256, hard: 512, dash: 1024, vault: 2048, climb: 4096 };
const COLORS = ["#3dd6ff", "#ff5ad1", "#e8f04a", "#7dff5a", "#5b8cff", "#b27dff", "#ff4a55", "#4dffc3", "#ffb12a", "#ffffff", "#9ad1ff", "#ff9ae0", "#c2ff8a", "#ffd18a", "#8affea", "#d48aff"];
const NET = { minDelay: .09, maxDelay: .5, extrapolate: .35, errorDecay: 6, snap: 40 };
const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;

export class HeroNet {
  constructor(hero) {
    this.hero = hero;
    this.views = new Map();
    this.snapT = 0; this.fx = [];
    this.remoteEnemies = []; this.enemyMap = new Map(); this.props = [];
    this.chaseCar = null; this.carState = null;
    this.wasHost = this.everClient = false;
    this.idT = 0; this.suitSent = null;
    const net = hero.ctx.net;
    net.addEventListener("world", (e) => { if (this.hero.on && this.hero.online) this.onWorld(e.detail.from, e.detail.w); });
    net.addEventListener("peerLeft", (e) => this.drop(e.detail));
    net.addEventListener("room", () => this.roster());
  }
  get net() { return this.hero.ctx.net; }
  get me() { return this.hero.meId(); }

  // ------------------------------------------------------------------ what this player sends
  state(T, now, round) {
    const h = this.hero, H = h.H, q = h.rig.group.quaternion, cb = h.combat;
    let fl = 0;
    if (H.dive) fl |= F.dive; if (H.glide) fl |= F.glide; if (H.slideT > 0) fl |= F.slide; if (h.anim.crouch) fl |= F.crouch;
    if (H.state === "wall" && H.wallMode === "run") fl |= F.wallrun; if (H.ceiling) fl |= F.ceiling; if (h.carry) fl |= F.carry;
    if (cb.downT > 0) fl |= F.down; if (H.rollT > 0) fl |= F.roll; if (H.hardT > 0) fl |= F.hard; if (h.dashT > 0) fl |= F.dash;
    if (H.move?.kind === "vault") fl |= F.vault; if (H.move && H.move.kind !== "vault") fl |= F.climb;
    const wb = H.webs.map((w) => { const pts = [w.side]; for (let i = w.pivots.length - 1; i >= 0 && pts.length < 10; i--) pts.push(r2(w.pivots[i].x), r2(w.pivots[i].y), r2(w.pivots[i].z)); pts.push(r2(w.a.x), r2(w.a.y), r2(w.a.z)); return pts; });
    const tr = h.tricks.shape(), at = h.anim.attack;
    const out = {
      T: r3(T), x: r2(H.p.x), y: r2(H.p.y), z: r2(H.p.z), vx: r2(H.v.x), vz: r2(H.v.z), v: r2(H.speed), ry: r3(Math.atan2(H.face.x, H.face.z)),
      w: Math.round(now), rd: round, tp: h.tpN | 0, sc: Math.floor(h.tricks.score), cr: 0,
      h: {
        st: Math.max(0, ST_NAMES.indexOf(H.state)), vy: r2(H.v.y), ph: r2(h.anim.phase % 1e6), fl, sw: (H.webs[0]?.side || H.lastSide) > 0 ? 1 : -1,
        q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)],
        wb: wb.length ? wb : undefined, zp: H.state === "zip" && H.zip ? [r2(H.zip.x), r2(H.zip.y), r2(H.zip.z)] : undefined,
        tr: tr ? [SHAPES.indexOf(tr.shape) + 1, r2(tr.k)] : undefined,
        at: at ? [ATKS.indexOf(at.kind), r2(at.k || 0), at.side || 1, at.kind === "emote" ? at.id : at.n || 0] : undefined,
        em: h.emote ? h.emote.id + 1 : 0, su: h.suitId, hp: r2(cb.hp), cb: h.tricks.combo ? Math.round(h.tricks.combo.pts * h.tricks.combo.mult) : 0, sy: Math.floor(h.tricks.score), lv: h.profile().level || 1,
        rc: h.activities?.raceProgress?.(),
      },
    };
    // identity: twice a second (and at once when the suit changes) the same block the cars use
    if ((this.idT = (this.idT || 0) - 1) <= 0 || this.suitSent !== h.suitId) { this.idT = 10; this.suitSent = h.suitId; out.c = { car: "hero" }; }
    return out;
  }

  // ------------------------------------------------------------------ the other heroes
  update(dt, T) {
    const net = this.net, h = this.hero, seen = new Set(), cam = h.ctx.camera.position;
    for (const [id, peer] of net.peers) {
      const b = peer.buf;
      if (!b?.length || !b[b.length - 1].h) continue;
      if (performance.now() - (peer.last || 0) > 6000) continue;
      seen.add(id);
      let v = this.views.get(id);
      if (!v) v = this.make(id, peer);
      // the render delay follows this peer's packet spacing, jitter and lag
      const newest = b[b.length - 1], behind = Math.max(0, T - newest.T);
      peer.behind = Math.max(behind, (peer.behind || 0) - dt * .35);
      const want = Math.min(NET.maxDelay, Math.max(NET.minDelay, peer.behind + (peer.gap || .05) * .75 + (peer.jit || 0) * 2));
      v.delay += (want - v.delay) * Math.min(1, dt * (want > v.delay ? 6 : .7));
      const s = sample(b, T - v.delay, v.s);
      if (!s) continue;
      // absorb only the part of each jump that the velocity doesn't explain
      if (!v.init) { v.disp.set(s.x, s.y, s.z); v.err.set(0, 0, 0); v.init = true; }
      const ex = (s.x - v.disp.x) - s.vx * dt, ey = (s.y - v.disp.y) - s.vy * dt, ez = (s.z - v.disp.z) - s.vz * dt;
      v.disp.set(s.x, s.y, s.z);
      if (Math.hypot(ex, ey, ez) > NET.snap || (s.tp | 0) !== v.tp) { v.err.set(0, 0, 0); v.tp = s.tp | 0; }
      else { v.err.x -= ex; v.err.y -= ey; v.err.z -= ez; v.err.clampLength(0, 8).multiplyScalar(Math.exp(-dt * NET.errorDecay)); }
      v.pos.set(s.x + v.err.x, s.y + v.err.y, s.z + v.err.z);
      v.vel.set(s.vx, s.vy, s.vz);
      v.data = s;
      this.draw(v, s, dt, cam);
    }
    for (const id of [...this.views.keys()]) if (!seen.has(id)) this.drop(id);
  }
  make(id, peer) {
    const h = this.hero, idx = Math.max(0, (this.net.room?.players || []).findIndex((p) => p.id === id));
    const v = { id, rig: new HeroRig(SUITS.arcline), suit: "arcline", delay: .15, disp: new V(), err: new V(), pos: new V(), vel: new V(), s: { h: {} }, init: false, tp: 0, color: COLORS[idx % COLORS.length], anim: { t: 0, phase: 0 }, tag: null, lastAnchor: null };
    h.ctx.scene.add(v.rig.group);
    v.tag = nameTag(peer.name || "Hero", v.color);
    h.ctx.scene.add(v.tag);
    this.views.set(id, v);
    return v;
  }
  drop(id) {
    const v = this.views.get(id);
    if (!v) return;
    const sc = this.hero.ctx.scene;
    sc.remove(v.rig.group); v.rig.dispose(); sc.remove(v.tag); v.tag.material.map.dispose(); v.tag.material.dispose();
    this.views.delete(id);
  }
  clear() {
    for (const id of this.views.keys()) this.drop(id);
    this.remoteEnemies.length = 0; this.enemyMap.clear(); this.props.length = 0;
    if (this.chaseCar) { this.hero.ctx.scene.remove(this.chaseCar); this.chaseCar = null; }
    this.carState = null;
    // A new city must not inherit the last room's effects, host history or send timers.
    this.fx.length = 0; this.snapT = 0;
    this.wasHost = this.everClient = false;
    this.idT = 0; this.suitSent = null;
  }
  draw(v, s, dt, cam) {
    const h = this.hero, H = s.h || {}, rig = v.rig;
    if (H.su && H.su !== v.suit && SUITS[H.su]) { v.suit = H.su; rig.setLook(SUITS[H.su]); }
    const d2 = v.pos.distanceToSquared(cam);
    rig.group.visible = d2 < 900 * 900;
    v.tag.visible = rig.group.visible && !h.ctx.P.settings.hideNames;
    if (!rig.group.visible) return;
    // the whole-body orientation came over the wire (flips and all)
    if (H.q) _q.set(H.q[0], H.q[1], H.q[2], H.q[3]).normalize(); else _q.setFromAxisAngle(_y, s.ry || 0);
    rig.group.quaternion.copy(_q);
    _o.set(0, HIP_H, 0).applyQuaternion(_q);
    const st = ST_NAMES[H.st | 0] || "air";
    // on a wall the hips stand off it a little, as on this machine
    rig.group.position.copy(v.pos).sub(_o);
    // the limbs: the same pose function, fed from the packet
    const a = v.anim, fl = H.fl | 0, hs = Math.hypot(s.vx, s.vz);
    a.t += dt; a.phase = H.ph ?? a.phase;
    Object.assign(a, { state: st, speed: Math.hypot(hs, s.vy), hs, vy: s.vy, slide: fl & F.slide ? .5 : 0, roll: fl & F.roll ? .3 : 0, hard: fl & F.hard ? .2 : 0, landT: 9, crouch: !!(fl & F.crouch), dive: !!(fl & F.dive), glide: !!(fl & F.glide), wallMode: fl & F.wallrun ? "run" : "crawl", move: null, trick: null, attack: null, anchorLocal: null, anchor2Local: null, swingSide: H.sw || 1, shootLocal: null, swingPhase: 0, dash: fl & F.dash ? 1 : 0 });
    if (st === "wall") a.wallMove = { x: hs, y: s.vy };
    if (fl & (F.vault | F.climb)) a.move = { kind: fl & F.vault ? "vault" : "climb", t: .1, dur: .3 };
    if (H.tr && H.tr[0] > 0) a.trick = { shape: SHAPES[H.tr[0] - 1], k: H.tr[1] };
    if (H.at && H.at[0] >= 0) a.attack = { kind: ATKS[H.at[0]], k: H.at[1], side: H.at[2], n: H.at[3], id: H.at[3], t: a.t };
    if (fl & F.down) a.attack = { kind: "down", k: .5 };
    if (H.em && !a.attack) a.attack = { kind: "emote", id: H.em - 1, t: a.t, k: .5 };
    const wb = H.wb || [];
    if (wb[0]?.length >= 4) a.anchorLocal = toBody(rig, _p.set(wb[0][1], wb[0][2], wb[0][3]), wb[0][0]);
    if (wb[1]?.length >= 4) a.anchor2Local = toBody(rig, _p.set(wb[1][1], wb[1][2], wb[1][3]), wb[1][0]);
    if (H.zp) a.anchorLocal = toBody(rig, _p.set(H.zp[0], H.zp[1], H.zp[2]), H.sw || 1);
    const rate = poseBody(rig, a);
    rig.apply(dt, rate);
    // their name, over their head
    v.tag.position.copy(v.pos).add(_o.set(0, 1.3, 0));
    const dist = Math.sqrt(d2);
    v.tag.scale.set(.9 + dist * .012, (.9 + dist * .012) / 4, 1);
    // a new line from them: the sound of it, quieter the further away
    const anchor = wb[0] ? wb[0][wb[0].length - 3] + "," + wb[0][wb[0].length - 1] : null;
    if (anchor && anchor !== v.lastAnchor && dist < 90) h.thwip(Math.max(.15, 1 - dist / 90) * .7);
    v.lastAnchor = anchor;
  }
  // the other heroes' lines, drawn with ours
  drawWebs(webs, col, clock) {
    for (const v of this.views.values()) {
      const H = v.data?.h;
      if (!H || !v.rig.group.visible) continue;
      for (const w of H.wb || []) {
        if (w.length < 4) continue;
        const hand = v.rig.handPos(w[0], new V());
        const pts = [hand];
        for (let i = 1; i + 2 < w.length; i += 3) pts.push(new V(w[i], w[i + 1], w[i + 2]));
        webs.line(pts, col, 1, 0, 0, clock);
      }
      if (H.zp) { const hand = v.rig.handPos(H.sw || 1, new V()); webs.line([hand, new V(H.zp[0], H.zp[1], H.zp[2])], col, 1, 0, 0, clock); }
    }
  }
  // the other heroes as the enemies (and the map) see them
  list() {
    const out = [];
    for (const v of this.views.values()) if (v.data) out.push({ id: v.id, x: v.pos.x, y: v.pos.y, z: v.pos.z, vx: v.vel.x, vz: v.vel.z, down: !!((v.data.h?.fl | 0) & F.down), color: v.color, name: this.net.peers.get(v.id)?.name || "Hero", style: v.data.h?.sy || 0, combo: v.data.h?.cb || 0, rc: v.data.h?.rc, suit: v.suit });
    return out;
  }

  // ------------------------------------------------------------------ the shared world
  send(w) { this.net.send({ t: "world", w }); }
  // host: the snapshot, 7 times a second, with whatever happened since the last one
  tick(dt, T) {
    const h = this.hero;
    if (!h.online || !this.net.room) return;
    const host = h.authority();
    if (host && !this.wasHost && this.everClient) this.takeOver();
    this.wasHost = host;
    if (!host) { this.everClient = true; return; }
    if ((this.snapT -= dt) > 0) return;
    this.snapT = 1 / 7;
    const snap = h.sim.snapshot();
    const ev = h.events.snapshot();
    // the getaway car lives in the host's traffic: send where it is so everyone can see (and hit) it
    const chase = h.events.list.find((e) => e.kind === "chase" && e.state === "active" && e.carRef);
    this.send({ k: "snap", T: r3(T), e: snap.e, p: snap.p, ev, car: chase ? [chase.car, r2(chase.carRef.x), r2(chase.carRef.y), r2(chase.carRef.z), r3(chase.carRef.yaw), r2(chase.carRef.v)] : null, fx: this.fx.splice(0, 40), act: h.activities?.snapshot?.() });
  }
  // something the host's enemies did that everyone should see (or that hits a particular player)
  relay(e) {
    const h = this.hero;
    if (!h.online || !this.net.room || !h.authority()) return;
    if (e.type === "strike" || e.type === "shot") return this.send({ k: e.type, target: e.target, dmg: e.dmg, kx: r2(e.kx || 0), kz: r2(e.kz || 0), heavy: e.heavy ? 1 : 0, kind: e.kind });
    if (e.type === "windup") return this.send({ k: "sense", target: e.target, e: e.e, t: r2(e.t), kind: e.kind });
    const keep = ["hurt", "ko", "webbed", "pinned", "wallslam", "bodyhit", "land", "fire", "ricochet", "explode", "smash", "shockwave", "disarm", "bossphase"];
    if (!keep.includes(e.type)) return;
    const o = {};
    for (const [k, v] of Object.entries(e)) o[k] = typeof v === "number" ? r2(v) : v;
    this.fx.push(o);
  }
  onWorld(from, w) {
    const h = this.hero, me = this.me, host = h.authority();
    switch (w.k) {
      // ---- from the host ----
      case "snap": if (!host) this.applySnap(w); break;
      case "strike": case "shot": if (w.target === me) h.combat.takeHit(+w.dmg || 5, +w.kx || 0, +w.kz || 0, !!w.heavy, String(w.kind || "")); break;
      case "sense": if (w.target === me) { const e = this.enemyMap.get(w.e); if (e) h.combat.sense(e, +w.t || .5, String(w.kind || "")); } break;
      // ---- to the host ----
      case "hit": if (host && w.h && typeof w.h === "object") h.sim.hit(+w.id, cleanHit(w.h, from)); break;
      case "hold": if (host) h.sim.holdEnemy(+w.id, +w.x, +w.y, +w.z); break;
      case "throwe": if (host) h.sim.throwEnemy(+w.id, +w.x, +w.y, +w.z, clamp(+w.vx, 40), clamp(+w.vy, 40), clamp(+w.vz, 40), from); break;
      case "throwp": if (host) { const p = h.sim.props.find((q) => q.id === +w.id); if (p) Object.assign(p, { x: +w.x, y: +w.y, z: +w.z, vx: clamp(+w.vx, 40), vy: clamp(+w.vy, 40), vz: clamp(+w.vz, 40), held: null, rest: false, spin: 9, by: from, hitIds: null }); } break;
      case "grab": if (host) { const e = h.events.list.find((q) => q.id === +w.ev), c = e?.civs.find((q) => q.id === +w.civ); if (c && !c.carried) c.carried = from; } break;
      case "setdown": if (host) { const e = h.events.list.find((q) => q.id === +w.ev), c = e?.civs.find((q) => q.id === +w.civ); if (c) h.events.setDown(e, c, +w.x, +w.y, +w.z); } break;
      case "carhit": if (host) h.events.hitCar(+w.car, Math.min(2, +w.n || 1)); break;
      // ---- activities: races and trick contests ----
      default: h.activities?.onWorld?.(from, w, host);
    }
  }
  // the host's snapshot: enemies (eased between snapshots), props, events, the getaway car
  applySnap(w) {
    const now = performance.now(), seen = new Set();
    for (const r of Array.isArray(w.e) ? w.e.slice(0, 60) : []) {
      if (!Array.isArray(r) || r.length < 18) continue;
      const id = +r[0];
      seen.add(id);
      let e = this.enemyMap.get(id);
      if (!e) { e = { id, x: +r[2], y: +r[3], z: +r[4], from: null, to: null }; this.enemyMap.set(id, e); }
      e.from = { x: e.x, y: e.y, z: e.z, yaw: e.yaw ?? +r[8] };
      e.to = { x: +r[2], y: +r[3], z: +r[4], yaw: +r[8] };
      e.t0 = now;
      Object.assign(e, { kind: KIND_LIST[r[1] | 0] || "thug", vx: +r[5], vy: +r[6], vz: +r[7], hp: +r[9], st: ["idle", "chase", "circle", "windup", "attack", "recover", "hit", "air", "down", "webbed", "pinned", "ko", "aim", "flee", "getup", "taunt"][r[10] | 0] || "idle", t: +r[11], web: +r[12], weapon: [null, "bat", "pistol", "rifle"][r[13] | 0], air: !!r[14], atk: ATK_LIST[r[15] | 0] || "jab", target: String(r[16] || ""), max: +r[17] || 60, alert: true });
    }
    for (const id of [...this.enemyMap.keys()]) if (!seen.has(id)) this.enemyMap.delete(id);
    this.remoteEnemies = [...this.enemyMap.values()];
    this.props = (Array.isArray(w.p) ? w.p.slice(0, 40) : []).map((r) => ({ id: +r[0], kind: PROP_KINDS[r[1] | 0] || "crate", x: +r[2], y: +r[3], z: +r[4], rot: +r[5], held: r[6] || null, rest: true }));
    this.hero.events.apply(w.ev);
    for (const e of Array.isArray(w.fx) ? w.fx.slice(0, 40) : []) if (e && typeof e === "object") this.hero.enemyFx({ ...e, type: String(e.type) });
    this.hero.activities?.applySnap?.(w.act);
    // the getaway car, drawn here and solid here
    const car = Array.isArray(w.car) ? w.car : null, sc = this.hero.ctx.scene;
    if (car && !this.chaseCar) { this.chaseCar = makeTrafficCar("sedan", 0x7a1f2b); sc.add(this.chaseCar); }
    if (!car && this.chaseCar) { sc.remove(this.chaseCar); this.chaseCar = null; }
    if (car) { this.carState = { id: +car[0], x: +car[1], y: +car[2], z: +car[3], yaw: +car[4], v: +car[5], t0: now }; }
  }
  // between snapshots: enemies glide from where they were to where the snapshot put them
  lerpEnemies(dt) {
    const now = performance.now();
    for (const e of this.remoteEnemies) {
      if (!e.to) continue;
      const k = Math.min(1, (now - e.t0) / (1000 / 7));
      e.x = e.from.x + (e.to.x - e.from.x) * k; e.y = e.from.y + (e.to.y - e.from.y) * k; e.z = e.from.z + (e.to.z - e.from.z) * k;
      let dy = e.to.yaw - e.from.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      e.yaw = e.from.yaw + dy * k;
    }
    const c = this.carState;
    if (c && this.chaseCar) {
      const t = Math.min(.4, (now - c.t0) / 1000), x = c.x - Math.sin(c.yaw) * c.v * t, z = c.z - Math.cos(c.yaw) * c.v * t;
      this.chaseCar.position.set(x, c.y, z); this.chaseCar.rotation.y = c.yaw;
      const W = this.hero.W, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw), by = Math.atan2(cy, -sy), c2 = Math.cos(by), s2 = Math.sin(by);
      W.dyn.push({ t: OBB, cx: x, cz: z, hx: 2.3, hz: .95, c: c2, s: s2, x0: x - 2.5, x1: x + 2.5, z0: z - 2.5, z1: z + 2.5, y0: c.y, y1: c.y + 1.45, kind: "vehicle", solid: true, web: true, vx: -sy * c.v, vz: -cy * c.v, dyn: true, car: { id: c.id, chase: true } });
    }
  }
  // the host left and this machine is next: carry on from the last snapshot
  takeOver() {
    const h = this.hero, sim = h.sim;
    sim.clear();
    for (const e of this.remoteEnemies) {
      if (e.hp <= 0) continue;
      const n = sim.spawn(e.kind, e.x, e.z, { id: e.id, y: e.y - HIP_H });
      Object.assign(n, { hp: e.hp, max: e.max, alert: true, web: e.web, weapon: e.weapon, st: e.st === "ko" ? "ko" : "circle" });
    }
    for (const p of this.props) { const q = sim.addProp(p.kind, p.x, p.z, p.y - .45); q.id = p.id; }
    this.remoteEnemies = []; this.enemyMap.clear();
    h.hud.center("YOU'RE THE HOST NOW", "The city's events run on your machine", 2.2, "small");
  }
  roster() { if (!this.net.room) this.clear(); }
}

// ---- helpers ----
function sample(b, T, out) {
  if (!b.length) return null;
  let i = b.length - 1;
  while (i > 0 && b[i].T > T) i--;
  const a = b[i], c = b[i + 1];
  const vyA = a.h?.vy ?? 0;
  if (T <= b[0].T) { fill(out, b[0], b[0].x, b[0].y, b[0].z, vyA); return out; }
  if (c && c.T > a.T) {
    const span = c.T - a.T, k = Math.min(1, (T - a.T) / span), k2 = k * k, k3 = k2 * k;
    const h0 = 2 * k3 - 3 * k2 + 1, h1 = (k3 - 2 * k2 + k) * span, h2 = -2 * k3 + 3 * k2, h3 = (k3 - k2) * span;
    const vyC = c.h?.vy ?? 0;
    const x = h0 * a.x + h1 * (a.vx || 0) + h2 * c.x + h3 * (c.vx || 0);
    const y = h0 * a.y + h1 * vyA + h2 * c.y + h3 * vyC;
    const z = h0 * a.z + h1 * (a.vz || 0) + h2 * c.z + h3 * (c.vz || 0);
    fill(out, k < .5 ? a : c, x, y, z, vyA + (vyC - vyA) * k);
    out.vx = (a.vx || 0) + ((c.vx || 0) - (a.vx || 0)) * k; out.vz = (a.vz || 0) + ((c.vz || 0) - (a.vz || 0)) * k;
    // the body's orientation: the shortest way round between the two
    if (a.h?.q && c.h?.q) { _qa.fromArray(a.h.q); _qb.fromArray(c.h.q); if (_qa.dot(_qb) < 0) _qb.set(-_qb.x, -_qb.y, -_qb.z, -_qb.w); _qa.slerp(_qb, k); out.h = { ...(k < .5 ? a.h : c.h), q: [_qa.x, _qa.y, _qa.z, _qa.w], ph: (a.h.ph ?? 0) + ((c.h.ph ?? 0) - (a.h.ph ?? 0)) * k }; }
    return out;
  }
  // past the newest: carry on along the last velocity for a moment
  const dt = Math.min(NET.extrapolate, T - a.T);
  fill(out, a, a.x + (a.vx || 0) * dt, a.y + vyA * dt, a.z + (a.vz || 0) * dt, vyA);
  return out;
}
function fill(out, s, x, y, z, vy) { out.x = x; out.y = y; out.z = z; out.vx = s.vx || 0; out.vy = vy; out.vz = s.vz || 0; out.ry = s.ry || 0; out.tp = s.tp | 0; out.sc = s.sc || 0; out.h = s.h || {}; }
function toBody(rig, pt, side) {
  _t2.set(side > 0 ? .2 : -.2, HIP_H + .45, 0).applyQuaternion(rig.group.quaternion).add(rig.group.position);
  return _t3.subVectors(pt, _t2).applyQuaternion(_qi.copy(rig.group.quaternion).invert()).normalize().clone();
}
function nameTag(name, color) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const g = c.getContext("2d");
  g.font = "700 30px 'Barlow Condensed', Arial"; const w = Math.min(240, g.measureText(name).width + 28);
  g.fillStyle = "rgba(10,10,12,.72)"; g.fillRect((256 - w) / 2, 10, w, 44);
  g.fillStyle = color; g.fillRect((256 - w) / 2, 10, 4, 44);
  g.fillStyle = "#f4f4f0"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(name, 130, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.renderOrder = 20;
  return s;
}
const clamp = (v, m) => (Number.isFinite(v) ? Math.max(-m, Math.min(m, v)) : 0);
// a hit sent by another player: numbers clamped, nothing it shouldn't carry
function cleanHit(h, from) {
  const n = (v, m) => clamp(+v, m);
  return { from, dmg: Math.max(0, Math.min(60, +h.dmg || 0)), kind: String(h.kind || "hit").slice(0, 12), kx: n(h.kx, 1), kz: n(h.kz, 1), web: Math.max(0, Math.min(1.5, +h.web || 0)), launch: Math.max(0, Math.min(14, +h.launch || 0)), slam: !!h.slam, heavy: !!h.heavy, pull: !!h.pull, disarm: !!h.disarm, x: n(h.x, 6000), z: n(h.z, 6000), knock: h.knock === undefined ? undefined : Math.max(0, Math.min(15, +h.knock)), finisher: !!h.finisher };
}
const _q = new Q(), _qa = new Q(), _qb = new Q(), _qi = new Q(), _o = new V(), _p = new V(), _y = new V(0, 1, 0), _t2 = new V(), _t3 = new V();

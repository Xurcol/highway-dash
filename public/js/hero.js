// Hero mode: ARCLINE. An original masked hero who fires energy lines from emitters in their wrists,
// loose in New Meridian - the City Drive city grown into a skyline of towers. This is the mode's
// controller: it owns the hero's body (hero-move), the character (hero-rig), the camera, the controls,
// the tricks, the effects and the HUD, and plugs them into the game's shared renderer, sky, city,
// audio and network from main.js.
import * as THREE from "three";
import { HeroWorld } from "./hero-world.js";
import { HeroBody, TUNE } from "./hero-move.js";
import { HeroRig, SUITS, poseBody, EMOTES, HIP_H } from "./hero-rig.js";
import { HeroCam } from "./hero-cam.js";
import { HeroInput } from "./hero-input.js";
import { Tricks } from "./hero-tricks.js";
import { WebLines, Particles, SpeedLines, Trails, Rings, Tracers } from "./hero-fx.js";
import { EnemySim, EnemyView, KINDS } from "./hero-enemies.js";
import { HeroCombat, GADGETS } from "./hero-combat.js";
import { HeroHud } from "./hero-hud.js";

const V = THREE.Vector3, Q = THREE.Quaternion;
const UP = new V(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const STATE_LABEL = { swing: "SWINGING", zip: "WEB ZIP", wall: "WALL", ledge: "LEDGE", perch: "PERCHED", water: "SWIMMING" };

export class HeroMode {
  constructor(ctx) {
    this.ctx = ctx;           // { renderer, scene, camera, sky, city, audio, net, ui, P, save }
    this.on = false;
    this.input = new HeroInput(ctx.renderer.domElement);
    this.hud = new HeroHud();
    this.clock = 0;
    this.suitId = ctx.P.hero?.suit && SUITS[ctx.P.hero.suit] ? ctx.P.hero.suit : "arcline";
  }
  get P() { return this.ctx.P; }
  profile() { return (this.P.hero ||= { suit: "arcline", owned: ["arcline"], xp: 0, level: 1, best: 0, score: 0 }); }

  // ------------------------------------------------------------------ setup
  build() {
    if (this.H) return;
    const { scene, camera } = this.ctx;
    this.H = new HeroBody(null);
    this.rig = new HeroRig(SUITS[this.suitId]);
    scene.add(this.rig.group);
    this.cam = new HeroCam(camera, null);
    this.tricks = new Tricks();
    this.webs = new WebLines(scene);
    this.parts = new Particles(scene);
    this.speedLines = new SpeedLines(scene);
    this.trails = new Trails(scene, 4, 16);
    this.rings = new Rings(scene);
    this.webCol = new THREE.Color(SUITS[this.suitId].glow).lerp(new THREE.Color(1, 1, 1), .55);
    this.anim = { phase: 0, t: 0 };
    this.anchorPreview = null; this.previewT = 0;
    this.enemyView = new EnemyView(scene);
    this.tracers = new Tracers(scene);
    this.combat = new HeroCombat(this);
    this.lines = [];      // short-lived combat lines: { side, to, t, life, follow }
  }
  // the hero's city: the tall variant of the City Drive map, and the solids built from it
  world() {
    const city = this.ctx.city;
    city.setVariant("hero");
    city.show(true);
    if (!this.W || this.W.M !== city.M) this.W = new HeroWorld(city.M);
    return this.W;
  }
  setVisible(on) {
    if (!this.H) return;
    this.rig.group.visible = on;
    for (const S of this.parts.sets) S.pts.visible = on;
    this.trails.mesh.visible = on;
    if (!on) { this.speedLines.lines.visible = false; this.webs.begin(this.ctx.camera.position); this.webs.end(0); }
  }
  enter(opt = {}) {
    this.build();
    const W = this.world();
    this.H.W = W; this.cam.W = W;
    if (!this.sim || this.sim.W !== W) this.sim = new EnemySim(W);
    this.combat.hp = 1; this.combat.downT = 0;
    this.on = true;
    this.setVisible(true);
    this.input.activate(true);
    this.hud.show(true);
    const sp = opt.spawn || this.spawnPoint(opt.index || 0);
    this.H.reset(sp.x, sp.y, sp.z);
    this.H.face.set(Math.sin(sp.yaw || 0), 0, Math.cos(sp.yaw || 0));
    this.H.state = sp.perch ? "perch" : "ground";
    this.cam.yaw = Math.atan2(-this.H.face.x, -this.H.face.z); this.cam.pitch = -.1; this.cam.snapNext = true;
    this.rig.place(this.H.p, UP, this.H.face, null, 0, 0);
    this.tricks.score = this.profile().score || 0;
    this.tricks.best = this.profile().best || 0;
    this.hud.center("NEW MERIDIAN", "Hold right mouse to swing · H for controls", 3.4);
    this.firstFrames = 3;
  }
  exit() {
    if (!this.on) return;
    this.on = false;
    this.input.activate(false);
    this.hud.show(false);
    this.setVisible(false);
    this.enemyView?.hideAll();
    this.sim?.clear();
    this.saveProfile();
  }
  saveProfile() {
    if (!this.tricks) return;
    const pr = this.profile();
    pr.score = Math.max(pr.score || 0, this.tricks.score); pr.best = Math.max(pr.best || 0, this.tricks.best);
    pr.suit = this.suitId;
    this.ctx.save();
  }
  // somewhere good to start: on top of a mid-height downtown building, looking up a street
  spawnPoint(i = 0) {
    const W = this.W, cands = W.perches.filter((p) => p.kind === "corner" && p.y > 45 && p.y < 110 && Math.hypot(p.x, p.z) < 260);
    cands.sort((a, b) => Math.hypot(a.x, a.z - 120) - Math.hypot(b.x, b.z - 120));
    const p = cands[i % Math.max(1, cands.length)] || { x: 0, y: 1, z: 40, nx: 0, nz: -1 };
    // stand a step in from the corner, facing out over the street
    const x = p.x - p.nx * 3, z = p.z - p.nz * 3, y = W.topAt(x, z, p.y + 2);
    return { x, y: y + HIP_H, z, yaw: Math.atan2(p.nx, p.nz) };
  }
  toggleHelp() { this.hud.toggleKeys(); }

  // ------------------------------------------------------------------ per frame
  // dt: simulation step (0 while paused); real: wall-clock step
  update(dt, real, T) {
    if (!this.on || !this.H) return;
    const H = this.H, cam = this.cam, camera = this.ctx.camera;
    this.clock += dt;
    H.clock = this.clock;
    // ---- input ----
    const look = cam.look, inp = this.input.read(cam.yaw, look, camera.position);
    if (dt <= 0) { inp.mdx = inp.mdy = 0; }
    if (inp.help) this.hud.toggleKeys();
    this.hud.emotes(inp.emoteMenu, EMOTES);
    // ---- the body ----
    if (dt > 0) {
      const cb = this.combat;
      // knocked down: no control until the hero gets back up (somewhere safe)
      let I = inp;
      if (cb.downT > 0) { cb.downT -= dt; I = idle(inp); if (cb.downT <= 0) this.respawn(); }
      if (H.state === "wall" && I.trickDown) { I.jump = true; I.trickDown = false; this.wallFlip = true; }
      // hit-stop on a landed blow, slow motion after a perfect dodge
      let bdt = dt;
      if (cb.stopT > 0) { cb.stopT -= dt; bdt = dt * .08; }
      if (cb.slowT > 0) { cb.slowT -= dt; bdt *= .4; }
      cb.pre(bdt, I);
      const sub = bdt > 1 / 45 ? 2 : 1;
      const sdt = bdt / sub;
      this.frameEvents = [];
      for (let k = 0; k < sub; k++) {
        H.step(sdt, k === 0 ? I : { ...I, jump: false, swingDown: false, zip: false, crouchDown: false, dodge: false, trickDown: false });
        for (const e of H.events) this.frameEvents.push({ ...e });
      }
      cb.post(bdt);
      // the enemies: simulated here when this machine is in charge of them
      if (this.authority()) { this.sim.step(dt, this.players()); this.simEvents(this.sim.events); }
      // the fight frames the camera
      const near = cb.inCombat ? cb.near(20) : [];
      if (near.length) {
        let x = 0, z = 0, d = 0;
        for (const e of near) { x += e.x; z += e.z; }
        x /= near.length; z /= near.length;
        for (const e of near) d = Math.max(d, Math.hypot(e.x - x, e.z - z));
        cam.combat = { x: (x + H.p.x) / 2, z: (z + H.p.z) / 2, d };
      } else cam.combat = null;
      // tricks start in the air (and on lines, on zips), never mid-vault; on a wall the trick key flips off it
      const airborne = (H.state === "air" || H.state === "swing" || H.state === "zip") && !H.move;
      if (this.wallFlip && H.state === "air") this.tricks.start("wallFlip", H);
      this.wallFlip = false;
      this.tricks.input(dt, H, inp, airborne);
      this.tricks.onEvents(H, this.frameEvents);
      for (const e of this.frameEvents) if (e.type === "attach" || e.type === "land") this.tricks.diveEnd(H);
      this.tricks.update(dt, H);
      this.handleEvents(this.frameEvents);
    }
    // ---- camera ----
    cam.update(real, H, inp);
    // ---- the character ----
    this.animate(dt > 0 ? dt : 0, inp);
    // ---- enemies and props, as this machine sees them ----
    this.enemyView.draw(real, this.enemyList(), camera.position);
    this.enemyView.drawProps(this.propList());
    this.tracers.update(dt);
    // ---- effects ----
    this.drawWebs(real);
    this.trailsUpdate();
    this.parts.update(dt, this.ctx.renderer.domElement.height);
    this.speedLines.update(real, camera.position, H.v);
    this.rings.update(dt);
    // ---- HUD ----
    this.updateHud(real, inp);
    this.trickEvents = this.tricks.events.splice(0);
    for (const e of this.trickEvents) this.trickSound(e);
    if (this.firstFrames > 0) this.firstFrames--;
  }
  // what main.js needs to know
  get focus() { return this.H.p; }
  get speed() { return this.H.speed; }
  // for the city's traffic: give way to the hero standing in the road
  trafficPlayers() {
    const H = this.H;
    if (!H || H.p.y - HIP_H > 2.5) return [];
    return [{ x: H.p.x, y: H.p.y - HIP_H, z: H.p.z, vx: H.v.x, vz: H.v.z, L: .6, W: .7 }];
  }

  // ------------------------------------------------------------------ animation
  animate(dt, inp) {
    const H = this.H, rig = this.rig, a = this.anim;
    a.t += dt;
    const hs = Math.hypot(H.v.x, H.v.z);
    // stride phase: one full cycle per two steps, longer strides the faster
    const stride = 1.15 + hs * .075;
    if (H.state === "ground" || H.state === "wall") a.phase += (H.state === "wall" ? H.speed : hs) * dt / stride * Math.PI;
    // which way is the body pointing?
    const up = _up.set(0, 1, 0), fwd = _fw.copy(H.face);
    let rate = 12;
    const P = H.webs[0]?.pivot();
    if (H.state === "swing" && P) {
      up.subVectors(P, H.p).normalize();
      fwd.copy(H.v).addScaledVector(up, -H.v.dot(up));
      if (fwd.lengthSq() < .1) fwd.copy(H.face);
      fwd.normalize();
      // tip the head back a little from the rope so the body hangs naturally
      up.lerp(UP, .25).normalize();
      rate = 9;
    } else if (H.state === "wall") {
      up.copy(H.n);
      const vm = _t.copy(H.v).addScaledVector(H.n, -H.v.dot(H.n));
      if (vm.lengthSq() > 1) fwd.copy(vm).normalize();
      else if (H.ceiling) fwd.copy(H.face);
      else { fwd.set(0, 1, 0).addScaledVector(H.n, -H.n.y).normalize(); }
      rate = 14;
    } else if (H.state === "air" && H.dive && H.speed > 8) {
      up.copy(H.v).normalize();
      fwd.set(0, -1, 0).addScaledVector(up, up.y).normalize();
      if (fwd.lengthSq() < .1) fwd.copy(H.face);
      rate = 6;
    } else if (H.state === "air" && H.glide) {
      up.set(H.v.x, Math.max(-.2, H.v.y * .02), H.v.z).normalize();
      fwd.set(0, -1, 0).addScaledVector(up, up.y).normalize();
      // bank into turns
      const yawRate = this.prevHeading !== undefined ? ((Math.atan2(H.v.x, H.v.z) - this.prevHeading + 9.42) % 6.283 - 3.14) / Math.max(dt, 1e-3) : 0;
      _qb.setFromAxisAngle(up, clamp(-yawRate * .35, -.7, .7));
      fwd.applyQuaternion(_qb);
      a.bank = clamp(yawRate, -1, 1);
      rate = 6;
    } else if (H.state === "zip" && H.zip) {
      const d = _t.set(H.zip.x - H.p.x, H.zip.y - H.p.y, H.zip.z - H.p.z).normalize();
      up.set(0, 1, 0).lerp(d, .55).normalize();
      fwd.copy(H.face).addScaledVector(up, -H.face.dot(up)).normalize();
      rate = 12;
    } else if (H.state === "ground") {
      // lean into acceleration and turns
      const acc = this.prevV ? _t.subVectors(H.v, this.prevV).divideScalar(Math.max(dt, 1e-3)) : _t.set(0, 0, 0);
      acc.y = 0;
      up.addScaledVector(acc, .006).normalize();
      if (H.slideT > 0) up.addScaledVector(H.face, -.35).normalize();
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      a.accel = acc.dot(H.face);
      rate = 14;
    } else if (H.state === "air") {
      up.addScaledVector(_t.set(H.v.x, 0, H.v.z), .006).normalize();
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      rate = 7;
    } else if (H.state === "ledge" || H.state === "perch" || H.state === "water") rate = 10;
    this.prevV = (this.prevV || new V()).copy(H.v);
    this.prevHeading = Math.atan2(H.v.x, H.v.z);
    if (this.H.prevState !== H.state && H.stateT < .05) rate = Math.min(rate, 8);
    // roll: a forward tumble about the hips on a roll landing
    let extra = this.tricks.rot;
    if (H.rollT > 0) { _qa.setFromAxisAngle(_x, (1 - H.rollT / .45) * Math.PI * 2); extra = _qe.copy(extra).multiply(_qa); }
    // on a wall the hips sit out from it by how the limbs are set: close for a crawl, further for a run
    const pr = H.state === "wall" ? _pr.copy(H.p).addScaledVector(H.n, H.wallMode === "run" ? .32 : .06) : H.p;
    rig.place(pr, up, fwd, extra, dt, this.firstFrames > 0 ? 0 : rate);
    // limb pose
    a.state = H.state; a.speed = H.speed; a.hs = hs; a.vy = H.v.y; a.slide = H.slideT; a.roll = H.rollT; a.hard = H.hardT; a.landT = H.landT;
    a.crouch = inp.crouch && H.state === "ground" && hs < 5; a.dive = H.dive; a.glide = H.glide; a.dash = H.dashUsed && H.state === "air" && this.dashT > 0 ? 1 : 0;
    a.move = H.move; a.wallMode = H.wallMode; a.trick = this.tricks.shape();
    a.turn = 0;
    if (H.state === "wall") { const r = _t.set(-H.n.z, 0, H.n.x); a.wallMove = { x: H.v.dot(r), y: H.v.y }; }
    // the arm holding a line points at its anchor; the swing's phase decides the legs
    a.anchorLocal = null; a.anchor2Local = null; a.swingSide = H.webs[0]?.side || H.lastSide;
    if (H.state === "swing" && P) {
      a.anchorLocal = this.toBody(P, a.swingSide);
      if (H.webs[1]) a.anchor2Local = this.toBody(H.webs[1].pivot(), -a.swingSide);
      const ox = H.p.x - P.x, oz = H.p.z - P.z, hv = Math.max(1, hs);
      a.swingPhase = clamp((ox * H.v.x + oz * H.v.z) / hv / Math.max(5, H.webs[0].L * .7), -1, 1);
    } else if (H.state === "zip" && H.zip) a.anchorLocal = this.toBody(_t.set(H.zip.x, H.zip.y, H.zip.z), a.swingSide);
    a.shootLocal = null;
    if (this.shootFlash > 0) { this.shootFlash -= dt; a.shootLocal = this.toBody(this.shootAt, this.shootSide); a.shootSide = this.shootSide; }
    a.attack = this.combat.downT > 0 ? { kind: "down", k: .5 } : this.combat.attackPose() || (this.emote ? { kind: "emote", id: this.emote.id, t: this.emote.t, k: .5 } : null);
    if (inp.emote && !this.combat.inCombat) this.emote = { id: inp.emote - 1, t: 0 };
    if (this.emote) { this.emote.t += dt; if (H.speed > 1.5 || H.state !== "ground" || this.emote.t > 8) this.emote = null; }
    const r = poseBody(rig, a);
    rig.apply(this.combat.stopT > 0 ? dt * .1 : dt, this.firstFrames > 0 ? 1000 : r);
    const Uh = rig.mat.userData.u;
    Uh.uHit.value = Math.max(0, Uh.uHit.value - dt * 4);
    if (this.firstFrames > 0) rig.snap();
    // the wrist emitters flare when a line goes out
    const U = rig.mat.userData.u;
    U.uShoot.value.x *= Math.exp(-dt * 6); U.uShoot.value.y *= Math.exp(-dt * 6);
    for (const w of H.webs) if (w.side > 0) U.uShoot.value.x = Math.max(U.uShoot.value.x, .5); else U.uShoot.value.y = Math.max(U.uShoot.value.y, .5);
  }
  // a world point as a direction from the shoulder, in the rig's own frame
  toBody(pt, side) {
    const rig = this.rig;
    _t2.set(side > 0 ? .2 : -.2, HIP_H + .45, 0).applyQuaternion(rig.group.quaternion).add(rig.group.position);
    return _t3.subVectors(pt, _t2).applyQuaternion(_qi.copy(rig.group.quaternion).invert()).normalize().clone();
  }

  // ------------------------------------------------------------------ webs and trails
  drawWebs(dt) {
    const H = this.H, rig = this.rig, cam = this.ctx.camera.position;
    this.webs.begin(cam);
    for (const w of H.webs) {
      const hand = rig.handPos(w.side, _h1).clone();
      const pts = [hand];
      for (let i = w.pivots.length - 1; i >= 0; i--) pts.push(w.pivots[i]);
      pts.push(w.a);
      const d = H.p.distanceTo(w.pivot());
      const slack = Math.max(0, w.L - d);
      this.webs.line(pts, this.webCol, 1, Math.max(0, .25 - w.t) * 3, Math.min(3, slack * .4), this.clock);
      w.t += dt;
    }
    for (const s of H.shots) {
      const hand = rig.handPos(s.side, _h1).clone(), k = Math.min(1, s.t / s.travel);
      const tip = hand.clone().lerp(s.to, k);
      this.webs.line([hand, tip], this.webCol, 1, .8, 0, this.clock);
    }
    // combat lines: a pull, a launch, a web strike, a throw on the end of a line, web shots in flight
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.t += dt;
      if (l.t > l.life) { this.lines.splice(i, 1); continue; }
      const hand = rig.handPos(l.side, _h1).clone(), to = l.follow ? l.follow() : l.to;
      if (!to) { this.lines.splice(i, 1); continue; }
      const k = Math.min(1, l.t / .06);
      this.webs.line([hand, hand.clone().lerp(to, k)], this.webCol, 1 - Math.max(0, (l.t - l.life + .1) / .1), k < 1 ? .6 : 0, 0, this.clock);
    }
    for (const s of this.combat.shots) this.webs.line([_t.set(s.x - s.vx * .05, s.y - s.vy * .05, s.z - s.vz * .05).clone(), new V(s.x, s.y, s.z)], this.webCol, 1, 0, 0, this.clock);
    for (const t of this.combat.traps) if (Math.random() < .3) this.parts.energy(t.x + t.nx * .2, t.y + t.ny * .2, t.z + t.nz * .2, 1, this.glowRGB());
    for (const b of this.combat.bombs) this.parts.energy(b.x, b.y, b.z, 1, [1, 1, 1]);
    if (H.state === "zip" && H.zip) {
      const hand = rig.handPos(H.lastSide, _h1).clone(), z = H.zip, k = Math.min(1, z.t / z.travel);
      this.webs.line([hand, hand.clone().lerp(_t.set(z.x, z.y, z.z), k)], this.webCol, 1, k < 1 ? .8 : .1, 0, this.clock);
    }
    this.webs.end(dt);
  }
  trailsUpdate() {
    const H = this.H, rig = this.rig, on = this.tricks.active ? 1 : H.speed > 38 ? .45 : 0;
    const col = this.webCol;
    rig.mesh.updateMatrixWorld(true);
    ["handL", "handR", "footL", "footR"].forEach((b, i) => this.trails.push(i, rig.bonePos(b, _h2), on, col));
    this.trails.update(this.ctx.camera.position);
  }

  // ------------------------------------------------------------------ events -> effects and sound
  handleEvents(list) {
    const H = this.H, fx = this.parts, A = this.ctx.audio;
    for (const e of list) {
      switch (e.type) {
        case "shoot": this.thwip(e.second ? .7 : 1); this.shootAt = new V(e.x, e.y, e.z); this.shootSide = e.side; this.shootFlash = .18; break;
        case "attach": { const w = H.webs[H.webs.length - 1]; if (w) fx.puff(w.a.x, w.a.y, w.a.z, 8, w.n.x, w.n.y, w.n.z); this.sfx("attach"); break; }
        case "letgo": case "release": if (e.type === "letgo") { this.sfx(e.jump ? "launch" : "release", e.jump ? 1 : e.quality + 1); if (e.quality === 2) this.hud.center("PERFECT RELEASE", "", .9, "small"); } this.dropWebs(); break;
        case "snap": this.sfx("snap"); this.dropWebs(); break;
        case "land": {
          const p = H.p, power = clamp(-e.vy / 30, .2, 1.4);
          fx.dust(p.x, p.y - HIP_H, p.z, Math.round(8 + power * 18), power);
          if (e.kind === "hard") { this.rings.spawn(p.x, p.y - HIP_H + .05, p.z, 5 + power * 4, 0xffffff, .6); this.cam.shake(.5 * power); this.cam.punch(0, -.35 * power, 0); this.sfx("hardland", power); }
          else { this.cam.shake(.12 * power); this.sfx("land", power); }
          break;
        }
        case "walljump": fx.puff(H.p.x - H.n.x * .5, H.p.y, H.p.z - H.n.z * .5, 6); this.sfx("jump"); break;
        case "jump": this.sfx("jump", e.big ? 1.5 : 1); if (e.big) fx.dust(H.p.x, H.p.y - HIP_H, H.p.z, 16, 1.2); break;
        case "launch": case "rooflaunch": fx.energy(H.p.x, H.p.y, H.p.z, 16, this.glowRGB()); this.sfx("launch", 1.3); this.cam.shake(.15); break;
        case "zipgo": this.sfx("zip"); break;
        case "perch": this.sfx("land", .4); break;
        case "wall": this.sfx("land", .3); break;
        case "vault": case "mantle": case "climb": this.sfx("vault"); break;
        case "slide": this.sfx("slide"); break;
        case "dive": this.sfx("dive"); break;
        case "glide": this.sfx("glide"); break;
        case "airdash": this.dashT = .25; fx.energy(H.p.x, H.p.y, H.p.z, 10, this.glowRGB()); this.sfx("dash"); break;
        case "splash": fx.splash(H.p.x, e.y, H.p.z, 40); this.sfx("splash"); break;
        case "noweb": case "nozip": this.sfx("deny"); break;
        case "skim": fx.dust(H.p.x, H.p.y - HIP_H, H.p.z, 10, .8); break;
        case "bound": this.hud.center("EDGE OF THE CITY", "Turn back", 1.5, "small"); break;
      }
    }
    this.dashT = Math.max(0, (this.dashT || 0) - .016);
  }
  dropWebs() {
    const rig = this.rig;
    for (const w of this.lastWebs || []) this.webs.drop(rig.handPos(w.side, _h1), w.a, this.webCol);
    this.lastWebs = [];
  }
  glowRGB() { const c = new THREE.Color(SUITS[this.suitId].glow); return [c.r, c.g, c.b]; }
  // keep a copy of the attached lines so a let-go can draw them falling away
  noteWebs() { this.lastWebs = this.H.webs.map((w) => ({ side: w.side, a: w.a.clone() })); }

  // ------------------------------------------------------------------ HUD
  updateHud(dt, inp) {
    const H = this.H, hud = this.hud, cam = this.ctx.camera;
    if (H.webs.length) this.noteWebs();
    // where would a swing line go? (a ghost marker, refreshed a few times a second)
    if ((this.previewT -= dt) <= 0 && H.state !== "swing") {
      this.previewT = .12;
      this.anchorPreview = H.state === "air" || H.state === "ground" || H.state === "wall" || H.state === "perch" ? H.findAnchor({ ...inp, look: this.cam.look }) : null;
      this.zipPreview = H.zipTarget({ ...inp, look: this.cam.look, camPos: cam.position });
    }
    const W = innerWidth, Hh = innerHeight;
    const proj = (x, y, z) => { _t.set(x, y, z).project(cam); return _t.z < 1 && Math.abs(_t.x) < 1.2 && Math.abs(_t.y) < 1.2 ? [(_t.x * .5 + .5) * W, (-_t.y * .5 + .5) * Hh] : null; };
    const zp = this.zipPreview && proj(this.zipPreview.x, this.zipPreview.y, this.zipPreview.z);
    hud.mark("hhZip", zp?.[0] || 0, zp?.[1] || 0, !!zp, (m) => m.classList.toggle("perch", this.zipPreview.kind === "perch"));
    const ap = this.anchorPreview && H.state !== "swing" && proj(this.anchorPreview.x, this.anchorPreview.y, this.anchorPreview.z);
    hud.mark("hhAnchor", ap?.[0] || 0, ap?.[1] || 0, !!ap);
    const alt = H.p.y - HIP_H;
    hud.update(dt, {
      speed: H.speed, alt, stateLabel: H.dive ? "DIVE" : H.glide ? "WEB WINGS" : H.state === "wall" ? (H.ceiling ? "CEILING" : H.wallMode === "run" ? "WALL RUN" : "WALL CRAWL") : STATE_LABEL[H.state] || "",
      tricks: this.tricks, trickEvents: this.trickEvents, hp: this.combat.hp, focus: this.combat.focus, noWeb: H.noWebT,
      gadgets: this.gadgetBar(), hits: this.combat.combo, sense: this.senseHud(),
    });
    // the target: a ring, its name and its health
    const cb = this.combat, tg = cb.target != null ? cb.byId(cb.target) : null;
    const tp = tg && cb.alive(tg) && (cb.inCombat || cb.lock) && proj(tg.x, tg.y + 1.15 * (KINDS[tg.kind]?.scale || 1), tg.z);
    hud.mark("hhTarget", tp?.[0] || 0, tp?.[1] || 0, !!tp, (m) => {
      const name = (KINDS[tg.kind]?.name || "") + (cb.lock === tg.id ? " (LOCKED)" : "");
      if (m.dataset.n !== name) { m.dataset.n = name; m.querySelector("b").textContent = name; }
      m.querySelector("i").style.width = Math.max(0, tg.hp / (tg.max || 1)) * 100 + "%";
    });
    if ((this.distT = (this.distT || 0) - dt) <= 0) {
      this.distT = .5;
      // street-level names, except when actually standing on the expressway deck
      const onDeck = H.state === "ground" && alt > 6 && alt < 10 && this.W.topAt(H.p.x, H.p.z, H.p.y) > 6 && Math.abs(Math.max(Math.abs(H.p.x), Math.abs(H.p.z)) - 720) < 40;
      hud.district(this.ctx.city.district?.(H.p.x, H.p.z, onDeck ? 8 : 0));
    }
  }

  // ------------------------------------------------------------------ sound
  thwip(k = 1) {
    const A = this.ctx.audio;
    if (!A.ready) return;
    const p = .9 + Math.random() * .25;
    A.noiseShot({ type: "bandpass", f0: 5200 * p, f1: 1800 * p, q: 1.6, a: .002, d: .09, peak: .22 * k });
    A.noiseShot({ type: "highpass", f0: 7000, f1: 3000, q: .7, a: .001, d: .05, peak: .12 * k });
    A.tone({ type: "triangle", f0: 1900 * p, f1: 900 * p, a: .002, d: .07, peak: .05 * k });
  }
  sfx(kind, k = 1) {
    const A = this.ctx.audio;
    if (!A.ready) return;
    k = Math.max(.1, k || 0);
    switch (kind) {
      case "attach": A.noiseShot({ type: "lowpass", f0: 900, f1: 200, q: .8, a: .002, d: .07, peak: .18 }); break;
      case "release": A.noiseShot({ type: "bandpass", f0: 2600, f1: 900, q: 1.2, a: .002, d: .08, peak: .07 + (k > 1 ? .05 : 0) }); if (k > 2) A.tone({ type: "triangle", f0: 1320, f1: 1980, d: .18, peak: .07 }); break;
      case "launch": A.whoosh(0, true); A.tone({ type: "sine", f0: 140, f1: 70, d: .25, peak: .2 * Math.min(1.5, k) }); break;
      case "snap": A.noiseShot({ type: "highpass", f0: 3000, q: 2, a: .001, d: .05, peak: .15 }); break;
      case "jump": A.noiseShot({ type: "lowpass", f0: 500, f1: 150, q: .7, a: .004, d: .12, peak: .12 * k, buf: A.brownBuf }); break;
      case "land": A.noiseShot({ type: "lowpass", f0: 400, f1: 80, q: .7, a: .003, d: .16 + k * .1, peak: .25 * k, buf: A.brownBuf }); break;
      case "hardland": A.noiseShot({ type: "lowpass", f0: 1400, f1: 60, q: .7, a: .002, d: .8, peak: .7 * Math.min(1.2, k), buf: A.brownBuf }); A.tone({ f0: 60, f1: 28, a: .002, d: .5, peak: .5 }); A.musicHit?.(); break;
      case "zip": A.noiseShot({ type: "bandpass", f0: 1500, f1: 4500, q: 2, a: .02, d: .25, peak: .12 }); break;
      case "vault": A.noiseShot({ type: "lowpass", f0: 700, f1: 200, q: .8, a: .003, d: .1, peak: .1 }); break;
      case "slide": A.noiseShot({ type: "bandpass", f0: 1200, f1: 500, q: .8, a: .02, d: .5, peak: .1 }); break;
      case "dive": A.whoosh(0, true); break;
      case "glide": A.noiseShot({ type: "bandpass", f0: 600, f1: 1200, q: .6, a: .05, d: .4, peak: .1 }); break;
      case "dash": A.whoosh(0, false); break;
      case "splash": A.noiseShot({ type: "lowpass", f0: 2000, f1: 300, q: .6, a: .005, d: .7, peak: .4 }); break;
      case "deny": A.deny(); break;
      case "trick": A.whoosh((Math.random() - .5) * .6, false); break;
      case "whoosh": A.noiseShot({ type: "bandpass", f0: 700, f1: 1800 * k, q: .9, a: .02, d: .14, peak: .09 * k }); break;
      case "punch": A.noiseShot({ type: "lowpass", f0: 1600, f1: 120, q: .8, a: .001, d: .12, peak: .32 * k, buf: A.brownBuf }); A.noiseShot({ type: "bandpass", f0: 2400, f1: 900, q: 1.5, a: .001, d: .05, peak: .14 * k }); break;
      case "ko": A.tone({ type: "triangle", f0: 520, f1: 780, d: .16, peak: .06 }); break;
      case "thud": A.noiseShot({ type: "lowpass", f0: 600, f1: 70, q: .7, a: .002, d: .3, peak: .3 * k, buf: A.brownBuf }); break;
      case "gun": A.noiseShot({ type: "highpass", f0: 1800, f1: 600, q: .7, a: .001, d: .09, peak: .3 * k }); A.noiseShot({ type: "lowpass", f0: 900, f1: 90, q: .7, a: .001, d: .22, peak: .25 * k, buf: A.brownBuf }); break;
      case "boom": A.noiseShot({ type: "lowpass", f0: 1200, f1: 40, q: .6, a: .003, d: 1.3, peak: .8 * k, buf: A.brownBuf }); A.tone({ f0: 70, f1: 25, a: .002, d: .9, peak: .5 * k }); break;
      case "webhit": A.noiseShot({ type: "bandpass", f0: 1100, f1: 400, q: .9, a: .002, d: .12, peak: .16 * k }); break;
      case "bomb": A.noiseShot({ type: "bandpass", f0: 800, f1: 2400, q: .7, a: .005, d: .4, peak: .3 }); break;
      case "hurt": A.noiseShot({ type: "lowpass", f0: 900, f1: 200, q: 1, a: .002, d: .18, peak: .3 * k, buf: A.brownBuf }); A.tone({ type: "sawtooth", f0: 160, f1: 110, d: .12, peak: .04 }); break;
      case "sense": A.tone({ type: "sine", f0: 1760 * (k > 1.2 ? .75 : 1), f1: 2200, d: .12, peak: .07 }); A.tone({ type: "sine", f0: 2640, d: .08, peak: .03, delay: .05 }); break;
      case "perfect": A.tone({ type: "triangle", f0: 880, f1: 1760, d: .3, peak: .08 }); A.tone({ type: "sine", f0: 2640, d: .25, peak: .04, delay: .06 }); break;
    }
  }
  trickSound(e) {
    const A = this.ctx.audio;
    if (!A.ready) return;
    if (e.type === "trick") this.sfx("trick");
    if (e.type === "banked") { const base = 660 * Math.min(2, 1 + e.mult / 15); [1, 1.25, 1.5, 2].forEach((m, i) => A.tone({ type: "triangle", f0: base * m, d: .14, peak: .07, delay: i * .06 })); }
    if (e.type === "bail") { A.tone({ type: "sawtooth", f0: 180, f1: 90, d: .35, peak: .08 }); }
  }
  // continuous: the wind past the hero
  windSpeed() { return this.H ? this.H.speed * 3.6 * 1.6 : 0; }

  // ------------------------------------------------------------------ the fight
  // Is this machine running the enemies? Solo always; online, the host (first in the room's list).
  authority() {
    const net = this.ctx.net, room = net.room;
    if (!room || !this.online) return true;
    return room.players?.[0]?.id === this.meId();
  }
  meId() { const me = this.ctx.net.me; return me?.id ?? me?.code ?? "me"; }
  enemyList() { return this.authority() ? this.sim.list : this.remoteEnemies || []; }
  propList() { return this.authority() ? this.sim.props : this.remoteProps || []; }
  // everyone the enemies can see and hit: this hero, and (online) the other heroes
  players() {
    const H = this.H, out = [{ id: this.meId(), x: H.p.x, y: H.p.y, z: H.p.z, vx: H.v.x, vz: H.v.z, down: this.combat.downT > 0, local: true }];
    for (const r of this.remoteHeroes?.() || []) out.push(r);
    return out;
  }
  hitEnemy(id, h) {
    if (this.authority()) this.sim.hit(id, h);
    else this.sendWorld?.({ k: "hit", id, h: { dmg: h.dmg || 0, kind: h.kind, kx: +(h.kx || 0).toFixed(2), kz: +(h.kz || 0).toFixed(2), web: h.web || 0, launch: h.launch || 0, slam: h.slam ? 1 : 0, heavy: h.heavy ? 1 : 0, pull: h.pull ? 1 : 0, disarm: h.disarm ? 1 : 0, x: h.x, z: h.z, knock: h.knock, finisher: h.finisher ? 1 : 0 } });
  }
  holdAt(h, pos) {
    if (h.prop) { const p = this.propList().find((q) => q.id === h.prop); if (p) { p.x = pos.x; p.y = pos.y; p.z = pos.z; p.held = this.meId(); p.rest = false; p.vx = p.vy = p.vz = 0; } }
    else if (this.authority()) this.sim.holdEnemy(h.enemy, pos.x, pos.y, pos.z);
    else this.sendWorld?.({ k: "hold", id: h.enemy, x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) });
    const to = pos.clone();
    if (!this.lines.some((l) => l.hold)) this.lines.push({ side: 1, t: .1, life: .62, hold: true, follow: () => this.combat.held ? to.copy(pos) : null });
    else this.lines.find((l) => l.hold).follow = () => this.combat.held ? to.copy(pos) : null;
  }
  throwHeld(h, pos, vx, vy, vz) {
    if (h.prop) {
      const p = this.propList().find((q) => q.id === h.prop);
      if (p) { p.held = null; p.rest = false; p.vx = vx; p.vy = vy; p.vz = vz; p.spin = 9; p.by = this.meId(); p.hitIds = null; }
      if (!this.authority()) this.sendWorld?.({ k: "throwp", id: h.prop, x: pos.x, y: pos.y, z: pos.z, vx, vy, vz });
    } else if (this.authority()) this.sim.throwEnemy(h.enemy, pos.x, pos.y, pos.z, vx, vy, vz, this.meId());
    else this.sendWorld?.({ k: "throwe", id: h.enemy, x: pos.x, y: pos.y, z: pos.z, vx, vy, vz });
    this.lines = this.lines.filter((l) => !l.hold);
  }
  handPos(side) { return this.rig.handPos(side, new V()); }
  // a gang near a point (for crimes, missions and testing)
  spawnGang(x, z, kinds, o = {}) {
    const out = [];
    kinds.forEach((k, i) => {
      const a = (i / kinds.length) * Math.PI * 2, r = 2.5 + Math.random() * 3.5;
      out.push(this.sim.spawn(k, x + Math.cos(a) * r, z + Math.sin(a) * r, { group: o.group || 0, y: o.y, guard: o.guard, hpK: o.hpK }));
    });
    for (const p of o.props || []) this.sim.addProp(p, x + (Math.random() - .5) * 10, z + (Math.random() - .5) * 10, o.y !== undefined ? this.W.topAt(x, z, o.y + 2) : undefined);
    return out;
  }
  // back on your feet after being knocked out: a rooftop near where it happened
  respawn() {
    const H = this.H, W = this.W;
    let best = null, bd = 1e9;
    for (const p of W.perches) { if (p.kind !== "corner" || p.y < 25 || p.y > 140) continue; const d = Math.hypot(p.x - H.p.x, p.z - H.p.z); if (d > 60 && d < bd) { bd = d; best = p; } }
    if (best) { const x = best.x - best.nx * 2.5, z = best.z - best.nz * 2.5; H.reset(x, W.topAt(x, z, best.y + 2) + HIP_H, z); H.state = "ground"; }
    this.combat.hp = 1; this.combat.focus = 0;
    this.cam.snapNext = true;
    this.hud.center("BACK ON YOUR FEET", "", 1.6, "small");
  }
  // what the enemy simulation reported: hits on this hero, warnings, effects
  simEvents(list) {
    const me = this.meId(), cb = this.combat, fx = this.parts;
    for (const e of list) {
      switch (e.type) {
        case "windup": if (e.target === me) { const en = this.sim.byId.get(e.e); if (en) cb.sense(en, e.t, e.kind); } else this.relay?.(e); break;
        case "strike": if (e.target === me) { const r = cb.takeHit(e.dmg, e.kx, e.kz, e.heavy, e.kind); if (r === "hit" || r === "down") fx.sparks(this.H.p.x, this.H.p.y + .3, this.H.p.z, 10, [1, .4, .2]); } else this.relay?.(e); break;
        case "shot": if (e.target === me) cb.takeHit(e.dmg, e.kx / 100, e.kz / 100, false, "shot"); else this.relay?.(e); break;
        default: this.enemyFx(e); this.relay?.(e);
      }
    }
    list.length = 0;
  }
  // the look and sound of what happens to enemies (on every machine)
  enemyFx(e) {
    const fx = this.parts, en = e.e !== undefined ? this.enemyList().find((q) => q.id === e.e) : null;
    switch (e.type) {
      case "hurt": fx.sparks(e.x, e.y + .3, e.z, e.heavy ? 14 : 7, [1, .85, .5], e.heavy ? 1.3 : .8); if (en) en.flash = 1; this.sfx("punch", e.heavy ? 1.4 : 1); break;
      case "ko": fx.sparks(e.x, e.y + .3, e.z, 18, [1, 1, 1]); if (e.from === this.meId()) { this.tricks.link(e.boss ? "finisher" : "takedown"); this.combat.focus = Math.min(3, this.combat.focus + .15); this.combat.kills++; this.onKo?.(e); } this.sfx("ko"); break;
      case "webbed": if (en) fx.puff(en.x, en.y, en.z, 14); this.sfx("webhit"); break;
      case "pinned": fx.puff(e.x, e.y, e.z, 20); this.tricks.link("wallpin"); this.sfx("webhit", 1.4); this.cam.shake(.15); break;
      case "wallslam": case "bodyhit": fx.dust(e.x, e.y - .6, e.z, 12, 1); fx.debris(e.x, e.y, e.z, 8); this.cam.shake(.12); this.sfx("thud"); break;
      case "land": if (e.v > 8) { fx.dust(e.x, e.y - .9, e.z, 10, .9); this.sfx("thud", .6); } break;
      case "fire": this.tracers.add(e.x, e.y, e.z, e.vx, e.vy, e.vz); this.sfx("gun", Math.max(.2, 1 - Math.hypot(e.x - this.H.p.x, e.z - this.H.p.z) / 80)); break;
      case "ricochet": fx.sparks(e.x, e.y, e.z, 5, [1, .8, .4], .5); break;
      case "explode": fx.sparks(e.x, e.y, e.z, 40, [1, .55, .2], 2); fx.dust(e.x, e.y, e.z, 30, 2.2); this.rings.spawn(e.x, e.y, e.z, 9, 0xffa040, .6); this.cam.shake(.4); this.sfx("boom"); break;
      case "smash": fx.debris(e.x, e.y, e.z, 14, [.55, .45, .3]); this.sfx("thud", .8); break;
      case "shockwave": this.rings.spawn(e.x, e.y + .05, e.z, e.r * 1.4, 0xff3048, .7); fx.dust(e.x, e.y, e.z, 30, 2); this.cam.shake(.5); this.sfx("boom", .7); break;
      case "disarm": if (e.from === this.meId()) { this.tricks.link("throw"); this.hud.center("DISARMED", "", .9, "small"); } this.sfx("snap"); break;
      case "bossphase": this.hud.center("VANTA IS ENRAGED", "Phase two", 2.4); break;
      case "taunt": break;
    }
  }
  // combat moments on this hero's side
  onCombat(type, d = {}) {
    const H = this.H, fx = this.parts;
    switch (type) {
      case "swing": this.sfx("whoosh", d.kind === "roundhouse" || d.kind === "launch" ? 1.3 : .8); break;
      case "whiff": break;
      case "hit": this.cam.shake(d.heavy ? .22 : .08); this.cam.punch(H.face.x * .12, 0, H.face.z * .12); if (H.state === "air") this.tricks.link("aircombo"); if (d.a?.kind === "finisher") this.tricks.link("finisher"); break;
      case "dodge": this.sfx("dash"); break;
      case "perfect": this.hud.center("PERFECT DODGE", "Counter now", .9, "small"); this.tricks.link("perfectdodge"); this.sfx("perfect"); break;
      case "dodged": break;
      case "hurt": this.rig.mat.userData.u.uHit.value = 1; this.cam.shake(d.heavy ? .45 : .2); this.sfx("hurt", d.heavy ? 1.3 : 1); break;
      case "down": this.hud.center("DOWN", "Getting back up...", 3, "bail"); this.tricks.bail("KNOCKED DOWN"); this.sfx("hardland", 1); break;
      case "sense": this.sfx("sense", d.kind === "heavy" || d.kind === "slam" ? 1.4 : 1); break;
      case "line": this.lines.push({ side: d.side || 1, to: d.to, t: 0, life: d.yank ? .3 : .25 }); this.thwip(.8); break;
      case "gadget": this.thwip(1.1); this.shootAt = d.to; this.shootSide = d.side; this.shootFlash = .2; break;
      case "webhit": fx.puff(d.x, d.y, d.z, d.kind === "impact" ? 16 : 6); this.sfx("webhit", d.kind === "impact" ? 1.3 : .7); break;
      case "bomb": fx.puff(d.x, d.y, d.z, 40); this.rings.spawn(d.x, d.y + .1, d.z, 7, 0xffffff, .5); this.sfx("bomb"); break;
      case "trapset": fx.energy(d.x, d.y, d.z, 10, this.glowRGB()); this.sfx("snap"); break;
      case "trap": fx.puff(d.x, d.y + .5, d.z, 18); this.sfx("webhit", 1.2); break;
      case "grab": this.thwip(1); break;
      case "throw": this.sfx("whoosh", 1.5); this.tricks.link("throw"); break;
      case "webstrike": this.tricks.link("webstrike"); this.cam.shake(.25); break;
      case "slamland": fx.dust(H.p.x, H.p.y - HIP_H, H.p.z, 40, 2); this.rings.spawn(H.p.x, H.p.y - HIP_H + .05, H.p.z, 8, 0xffffff, .55); this.cam.shake(.5); this.tricks.link("slam"); this.sfx("hardland", 1.2); break;
      case "heal": fx.energy(H.p.x, H.p.y, H.p.z, 24, [.4, 1, .6]); this.hud.center("HEALED", "", .8, "small"); this.sfx("perfect"); break;
      case "deny": this.sfx("deny"); break;
    }
  }
  gadgetBar() {
    const cb = this.combat;
    const k = GADGETS.slice(1).map((G, i) => {
      const n = i + 1, c = cb.cool[n], ready = G.id === "shot" ? cb.ammo >= 1 : c <= 0;
      const fill = G.id === "shot" ? cb.ammo / 10 : G.cool ? 1 - c / G.cool : 1;
      return `<span class="${ready ? "ready" : ""}">${G.key} ${G.name.replace("Web ", "")}<i style="width:${Math.round(fill * 100)}%"></i></span>`;
    }).join("");
    return k;
  }
  senseHud() {
    const s = this.combat.senses[0];
    if (!s) return null;
    const e = this.enemyList().find((q) => q.id === s.e);
    if (!e) return null;
    const dx = e.x - this.H.p.x, dz = e.z - this.H.p.z, f = this.cam.look;
    const rel = Math.atan2(dx, dz) - Math.atan2(f.x, f.z);
    return { ang: -rel, t: Math.max(0, s.t), heavy: s.kind === "heavy" || s.kind === "slam" || s.kind === "shot" };
  }
}
// an input with the player's hands off the controls
function idle(inp) { return { ...inp, mx: 0, mz: 0, ix: 0, iy: 0, jump: false, jumpHeld: false, sprint: false, swing: false, swingDown: false, zip: false, crouch: false, crouchDown: false, trick: false, trickDown: false, attack: false, attackHeld: false, attackDown: false, attackUp: false, dodge: false, strike: false, gadget: 0, throwObj: false, finisher: false, finisherHeld: false }; }
const _pr = new V(), _up = new V(), _fw = new V(), _t = new V(), _t2 = new V(), _t3 = new V(), _h1 = new V(), _h2 = new V();
const _qa = new Q(), _qb = new Q(), _qe = new Q(), _qi = new Q(), _x = new V(1, 0, 0);

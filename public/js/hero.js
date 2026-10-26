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
import { HeroCombat, GADGETS, ABILITIES } from "./hero-combat.js";
import { Crowd, Trains, Emergency, trafficSolids, WeatherClock, heroDistrict } from "./hero-life.js";
import { Events, EVENT_TYPES } from "./hero-events.js";
import { HeroNet } from "./hero-net.js";
import { Activities } from "./hero-activities.js";
import { Progress } from "./hero-progress.js";
import { earn } from "./arcline-profile.js";
import { HeroHud } from "./hero-hud.js";
import { Winds, WindView } from "./hero-wind.js";
import { Caches } from "./hero-caches.js";
import { PhotoMode } from "./hero-photo.js";
import { WorldMap } from "./hero-map.js";
import { SkyLife } from "./hero-skylife.js";

const V = THREE.Vector3, Q = THREE.Quaternion;
const UP = new V(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const STATE_LABEL = { ground: "ON FOOT", air: "AIRBORNE", swing: "SWINGING", zip: "WEB ZIP", wall: "WALL", ledge: "LEDGE", perch: "PERCHED", water: "SWIMMING" };
const TRAIL_BONES = ["handL", "handR", "footL", "footR"];
const WHITE = [1, 1, 1];
const EMPTY = [];
const IDLE_INPUT = { mx: 0, mz: 0, ix: 0, iy: 0, jump: false, jumpHeld: false, sprint: false, swing: false, swingDown: false, zip: false, crouch: false, crouchDown: false, trick: false, trickDown: false, attack: false, attackHeld: false, attackDown: false, attackUp: false, dodge: false, strike: false, gadget: 0, throwObj: false, finisher: false, finisherHeld: false, sling: false, parry: false, parryKey: false, ability: 0 };

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
    this.netx = new HeroNet(this);
    this.activities = new Activities(this);
    this.progress = new Progress(this);
    this.caches = new Caches(this);
    this.photo = new PhotoMode(this);
    this.worldMap = new WorldMap(this);
    this.slingPts = [new V(), new V()]; this.swingStyle = 0; this.overFxT = 0;
    this.fallFxT = 0;
    this.fxFrame = 0; this.fxStride = 1; this.enemyFrame = 0;
    this.traversalFxT = 0;
    this.lines = [];      // short-lived combat lines: { side, to, t, life, follow }
    this.frameEvents = []; this.stepInput = {}; this.idleInput = {};
    this.webPoints = []; this.webPair = [new V(), new V()];
    this.posePoints = [new V(), new V(), new V()];
    this.lastWebPool = [{ side: 0, a: new V() }, { side: 0, a: new V() }];
    this.lastWebs = []; this.tracerQueue = []; this.trickEvents = [];
    this.cameraEnemies = []; this.cameraFrame = { x: 0, z: 0, d: 0 }; this.inCombat = false;
    this.visibleEnemies = []; this.visibleProps = [];
    this.viewFrustum = new THREE.Frustum(); this.viewMatrix = new THREE.Matrix4(); this.viewSphere = new THREE.Sphere();
    this.crowdThreats = []; this.threatPool = []; this.threatT = 0;
    this.emergencyBefore = new Set(); this.visualSolids = [];
    this.crowdHero = { x: 0, y: 0, z: 0, show: 0 };
    this.sirenListener = { right: { x: 1, z: 0 }, velocity: this.H.v, audible: false };
    this.policeTarget = (x, z) => {
      let best = null, distance = 900;
      for (const e of this.enemyList()) {
        if (e.hp <= 0 || e.st === "ko") continue;
        const d = (e.x - x) ** 2 + (e.z - z) ** 2;
        if (d < distance) { distance = d; best = e; }
      }
      return best;
    };
    this.trafficActor = { x: 0, y: 0, z: 0, vx: 0, vz: 0, L: .6, W: .7 };
    this.trafficActors = [this.trafficActor];
    this.localPlayer = { id: "", x: 0, y: 0, z: 0, vx: 0, vz: 0, down: false, local: true }; this.playerStates = [];
    this.previewInput = {}; this.anchorOrigin = new V(); this.anchorLook = new V();
    this.wallUp = new V(0, 1, 0); this.cameraOptions = { tricking: false };
    this.poseClearT = 0; this.poseClearance = 30;
    this.zipPreviewT = 0; this.anchorAge = 1; this.hudState = {}; this.gadgetT = 0;
    this.hudProjection = [0, 0];
    this.projectHud = (x, y, z) => {
      _t.set(x, y, z).project(this.ctx.camera);
      if (_t.z >= 1 || Math.abs(_t.x) >= 1.2 || Math.abs(_t.y) >= 1.2) return null;
      this.hudProjection[0] = (_t.x * .5 + .5) * innerWidth; this.hudProjection[1] = (-_t.y * .5 + .5) * innerHeight;
      return this.hudProjection;
    };
    this.zipMarker = (m) => m.classList.toggle("perch", this.zipPreview.kind === "perch");
    this.targetMarker = (m) => {
      const tg = this.hudTarget, cb = this.combat;
      const name = (KINDS[tg.kind]?.name || "") + (cb.lock === tg.id ? " (LOCKED)" : "");
      if (m.dataset.n !== name) { m.dataset.n = name; m.querySelector("b").textContent = name; }
      m.querySelector("i").style.width = Math.max(0, tg.hp / (tg.max || 1)) * 100 + "%";
    };
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
    this.windView?.setVisible(on); this.caches?.setVisible(on); this.skyLife?.setVisible(on);
    for (const S of this.parts.sets) S.pts.visible = on;
    this.trails.mesh.visible = on;
    if (!on) { this.speedLines.lines.visible = false; this.webs.begin(this.ctx.camera.position); this.webs.end(0); }
  }
  enter(opt = {}) {
    this.build();
    const W = this.world();
    this.H.W = W; this.cam.W = W;
    if (!this.sim || this.sim.W !== W) this.sim = new EnemySim(W);
    if (!this.life || this.life.W !== W) {
      const sc = this.ctx.scene;
      if (this.life) { sc.remove(this.life.crowd.mesh); sc.remove(this.life.trains.group); this.life.emergency.clear(); }
      this.life = { W, crowd: new Crowd(sc, W), trains: new Trains(sc), emergency: new Emergency(sc), weather: new WeatherClock() };
    }
    this.life.crowd.setVisible(true); this.life.trains.setVisible(true);
    // the air currents, the caches and the life in the sky belong to this city
    const sc = this.ctx.scene;
    if (!this.winds || this.winds.W !== W) {
      if (this.windView) sc.remove(this.windView.mesh);
      this.winds = new Winds(W); this.windView = new WindView(sc, this.winds);
    }
    this.H.winds = this.winds;
    this.caches.build(W, sc); this.caches.refresh();
    if (!this.skyLife || this.skyLife.W !== W) { if (this.skyLife) this.skyLife.setVisible(false); this.skyLife = new SkyLife(sc, W); }
    this.events ||= new Events(this);
    this.carry = null;
    this.online = !!opt.online;
    this.progress.apply();
    this.combat.reset();
    this.on = true;
    this.setVisible(true);
    this.input.activate(true);
    this.hud.show(true);
    const sp = opt.spawn || this.spawnPoint(opt.index || 0);
    this.H.reset(sp.x, sp.y, sp.z);
    this.tricks.reset(); this.poseClearT = 0; this.anim.state = null;
    this.prevV = null; this.prevHeading = undefined; this.emote = null;
    this.anchorPreview = null; this.zipPreview = null; this.previewT = 0;
    this.zipPreviewT = 0; this.anchorAge = 1; this.gadgetT = 0; this.threatT = 0;
    this.inCombat = false; this.cam.combat = null;
    this.lastWebs.length = 0; this.lines.length = 0; this.shootFlash = 0; this.dashT = 0;
    this.H.face.set(Math.sin(sp.yaw || 0), 0, Math.cos(sp.yaw || 0));
    this.H.state = sp.perch ? "perch" : "ground";
    this.cam.yaw = Math.atan2(-this.H.face.x, -this.H.face.z); this.cam.pitch = -.1; this.cam.snapNext = true;
    this.rig.place(this.H.p, UP, this.H.face, null, 0, 0);
    this.tricks.score = this.profile().score || 0;
    this.tricks.best = this.profile().best || 0;
    this.hud.center("NEW MERIDIAN", "Shift swings · F web wings · Tab world map · P first person", 4);
    this.firstFrames = 3;
  }
  exit() {
    this.activities.endWaves("SURVIVAL ENDED");
    if (!this.on) return;
    this.photo?.close(); this.worldMap?.close();
    this.on = false;
    this.input.activate(false);
    this.hud.show(false);
    this.setVisible(false);
    this.enemyView?.hideAll();
    this.sim?.clear();
    this.events?.clear();
    this.netx?.clear(); this.activities?.clear();
    if (this.life) { this.life.crowd.setVisible(false); this.life.trains.setVisible(false); this.life.emergency.clear(); this.ctx.audio.evSirens?.([]); }
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
    // stand a step in from the corner, facing out over the street, where the camera behind has a clear
    // view of the hero and the hero a clear view out (no water tank or roof plant in the way)
    const ok = (p) => {
      const x = p.x - p.nx * 3, z = p.z - p.nz * 3, y = W.topAt(x, z, p.y + 2) + HIP_H;
      const cx = x - p.nx * 6, cz = z - p.nz * 6, cy = y + 1.6;
      return W.clear(cx, cy, cz, x, y + .5, z, 0, .2) && W.clear(x, y + 1.2, z, x + p.nx * 30, y + 1.2, z + p.nz * 30, 0, .5) && Math.abs(W.topAt(cx, cz, y + 1) - (y - HIP_H)) < 1.5
        // water tank legs aren't solid, but they still block the view
        && !W.M.waterTowers.some((t) => Math.abs(t.y + HIP_H - y) < 6 && (Math.hypot(t.x - x, t.z - z) < 7 || Math.hypot(t.x - cx, t.z - cz) < 7 || Math.hypot(t.x - (x + cx) / 2, t.z - (z + cz) / 2) < 6));
    };
    const good = cands.filter(ok);
    const list = good.length ? good : cands;
    const p = list[i % Math.max(1, list.length)] || { x: 0, y: 1, z: 40, nx: 0, nz: -1 };
    const x = p.x - p.nx * 3, z = p.z - p.nz * 3, y = W.topAt(x, z, p.y + 2);
    return { x, y: y + HIP_H, z, yaw: Math.atan2(p.nx, p.nz) };
  }
  toggleHelp() { this.hud.toggleKeys(); }

  // ------------------------------------------------------------------ per frame
  // dt: simulation step (0 while paused); real: wall-clock step
  update(dt, real, T) {
    if (!this.on || !this.H) return;
    const H = this.H, cam = this.cam, camera = this.ctx.camera, W = this.W;
    this.clock += dt;
    this.frameDt = dt;
    H.clock = this.clock;
    // ---- input ----
    const look = cam.look, inp = this.input.read(cam.yaw, look, camera.position, real);
    if (inp.viewToggle) {
      cam.firstPerson = !cam.firstPerson; cam.snapNext = true;
      for (const trail of this.trails.t) trail.ready = false;
      this.hud.center(cam.firstPerson ? "FIRST PERSON" : "THIRD PERSON", "P · Switch camera", 1.5, "small");
    }
    inp.aimWeb = !!cam.firstPerson;
    if (inp.wings && H.state === "air") {
      const target = this.combat.pickTarget(inp);
      if (!target || this.combat.dist(target) >= 34) inp.strike = false;
      else inp.wings = false;
    }
    if ((H.state === "ground" || H.state === "perch") && (inp.sling || H.sling)) {
      inp.jump = inp.swing = inp.swingDown = false;
    }
    if (!inp.pad && H.state === "air" && inp.jump && H.airT > .15) {
      inp.airZip = true; inp.jump = false;
    }
    // Spider-Man 2 uses Square + a direction for air tricks.  Keep the keyboard T/F shortcut,
    // but let a standard controller use the same face button without starting an air punch.
    const padAirTrick = inp.pad && inp.attackHeld && (H.state === "air" || H.state === "swing" || H.state === "zip")
      && Math.hypot(inp.ix, inp.iy) > .2;
    if (padAirTrick) { inp.trick = true; inp.trickX = inp.ix; inp.trickY = inp.iy; inp.attack = inp.attackDown = false; }
    if (dt <= 0) { inp.mdx = inp.mdy = 0; }
    if (inp.help) this.hud.toggleKeys();
    if (inp.activities) this.activities.toggleMenu();
    if (inp.photo) { this.photo.open(); return; }
    if (inp.map) { this.worldMap.open(); return; }
    this.hud.emotes(inp.emoteMenu, EMOTES);
    // ---- the body ----
    if (dt > 0) {
      const cb = this.combat;
      // knocked down: no control until the hero gets back up (somewhere safe)
      let I = inp;
      if (cb.downT > 0) { cb.downT -= dt; I = idle(inp, this.idleInput); if (cb.downT <= 0) this.respawn(); }
      if (H.state === "wall" && I.trickDown) { I.jump = true; I.trickDown = false; this.wallFlip = true; }
      // hit-stop on a landed blow, slow motion after a perfect dodge
      let bdt = dt;
      if (cb.stopT > 0) { cb.stopT -= dt; bdt = dt * .08; }
      if (cb.slowT > 0) { cb.slowT -= dt; bdt *= .4; }
      // the moving things the body can touch this frame: traffic near the hero, the trains
      W.dyn.length = 0;
      if (this.ctx.city.traffic) trafficSolids(this.ctx.city.traffic, null, H.p, W.dyn);
      this.life.trains.update(T, null, W.dyn);
      if (this.online) this.netx.lerpEnemies(dt);
      // E next to someone in trouble picks them up (instead of zipping)
      if (I.zip && !this.carry) { const g = this.events.grabbable(H.p); if (g) { this.grabCiv(g.e, g.c); I.zip = false; } }
      cb.pre(bdt, I);
      // Small traversal steps keep rope catches, collision response and jumps consistent at low frame rates.
      const sub = Math.min(8, Math.max(1, Math.ceil(bdt * 120)));
      const sdt = bdt / sub;
      this.frameEvents.length = 0;
      const held = Object.assign(this.stepInput, I);
      held.jump = held.swingDown = held.zip = held.crouchDown = held.dodge = held.trickDown = false;
      held.wings = held.airZip = false;
      for (let k = 0; k < sub; k++) {
        H.step(sdt, k === 0 ? I : held);
        for (const e of H.events) this.frameEvents.push(e);
      }
      cb.post(bdt);
      // the enemies and the city's events: run here when this machine is in charge of them
      if (this.authority()) {
        const pl = this.players();
        // Solo bullet time slows the whole fight; online rooms retain the host's shared world clock.
        this.sim.step(this.online ? dt : bdt, pl); this.simEvents(this.sim.events);
        this.events.direct(dt, pl); this.events.step(dt, pl);
      }
      this.updateCarry(dt);
      this.caches.update(dt, this.clock, H, this.parts);
      this.activities.update(dt);
      if (this.online) this.netx.tick(dt, T);
      this.updateCombatFrame();
      // tricks start in the air (and on lines, on zips), never mid-vault; on a wall the trick key flips off it
      const airborne = (H.state === "air" || H.state === "swing" || H.state === "zip") && !H.move && cb.downT <= 0 && H.combatLock <= 0;
      if (this.wallFlip && H.state === "air") this.tricks.start("wallFlip", H);
      this.wallFlip = false;
      this.tricks.input(dt, H, inp, airborne);
      this.tricks.onEvents(H, this.frameEvents);
      for (const e of this.frameEvents) if (e.type === "attach" || e.type === "land") this.tricks.diveEnd(H);
      this.tricks.update(dt, H);
      this.handleEvents(this.frameEvents);
    }
    // ---- camera ----
    this.cameraOptions.tricking = this.tricks.active && (H.state === "air" || H.state === "swing" || H.state === "zip") && !H.move && this.combat.downT <= 0 && H.combatLock <= 0;
    this.cameraOptions.dashing = this.dashT > 0;
    cam.update(real, H, inp, this.cameraOptions);
    // ---- the character ----
    this.animate(dt > 0 ? dt : 0, inp);
    this.rig.mesh.visible = !cam.firstPerson;
    // ---- the other heroes ----
    if (this.online) this.netx.update(real, T);
    // ---- enemies and props, as this machine sees them ----
    // Keep gameplay at full rate, but let cosmetic work step down on slower machines.
    this.fxStride = real > .024 ? 2 : 1;
    this.fxFrame = (this.fxFrame + 1) % this.fxStride;
    this.enemyElapsed = (this.enemyElapsed || 0) + real;
    if (this.fxStride === 1 || this.enemyFrame++ % 2 === 0) {
      this.drawEnemies(this.enemyElapsed); this.enemyElapsed = 0;
    }
    this.fxElapsed = (this.fxElapsed || 0) + dt;
    const fxDt = this.fxStride === 1 || this.fxFrame === 0 ? this.fxElapsed : 0;
    if (fxDt > 0) this.fxElapsed = 0;
    if (fxDt > 0) this.tracers.update(fxDt);
    // ---- effects ----
    this.drawWebs(real);
    this.trails.mesh.visible = !cam.firstPerson;
    if (fxDt > 0 && !cam.firstPerson) this.trailsUpdate(fxDt);
    if (fxDt > 0) this.parts.update(fxDt, this.ctx.renderer.domElement.height);
    this.speedLines.update(real, camera.position, H.v);
    this.traversalFxT -= real;
    if (this.traversalFxT <= 0 && H.state === "wall" && H.speed > 3) {
      this.traversalFxT = H.wallMode === "run" ? .055 : .12;
      const bx = H.p.x - H.n.x * .35, by = H.p.y - .35, bz = H.p.z - H.n.z * .35;
      if (H.wallMode === "run") this.parts.sparks(bx, by, bz, 2, [1, .55, .2], .35);
      else this.parts.puff(bx, by, bz, 2, -H.n.x, 0, -H.n.z);
    }
    // A fast fall gets its own readable visual beat instead of looking like a normal jump.
    if (H.state === "air" && H.v.y < -18 && !H.glide && !this.tricks.active) {
      this.fallFxT -= real;
      if (this.fallFxT <= 0) {
        const power = clamp((-H.v.y - 18) / 45, .2, 1);
        this.fallFxT = .075;
        this.parts.energy(H.p.x, H.p.y - HIP_H * .25, H.p.z, 2 + Math.round(power * 3), this.glowRGB());
        this.parts.sparks(H.p.x, H.p.y - HIP_H * .2, H.p.z, 2 + Math.round(power * 3), [1, .35, .9], .45 + power * .35);
      }
    } else this.fallFxT = 0;
    if (fxDt > 0) this.rings.update(fxDt);
    this.windView.update(this.clock, this.ctx.sky.night || 0);
    if (this.combat.overT > 0 && (this.overFxT -= real) <= 0) {
      this.overFxT = .05;
      for (const s of [1, -1]) { const p = this.rig.handPos(s, _h1); this.parts.energy(p.x, p.y, p.z, 1, this.glowRGB()); }
    }
    // ---- HUD ----
    this.updateHud(real, inp);
    this.trickEvents.length = 0;
    for (const e of this.tricks.events) this.trickEvents.push(e);
    this.tricks.events.length = 0;
    for (const e of this.trickEvents) this.trickSound(e);
    if (this.firstFrames > 0) this.firstFrames--;
  }
  updateCombatFrame() {
    const H = this.H, cb = this.combat, near = this.cameraEnemies;
    near.length = 0;
    let fighting = false, x = 0, z = 0;
    for (const e of this.enemyList()) {
      if (!cb.alive(e) || Math.abs(e.y - H.p.y) >= 8) continue;
      const d2 = (e.x - H.p.x) ** 2 + (e.z - H.p.z) ** 2;
      if (d2 < 484 && e.alert !== false && e.st !== "idle") fighting = true;
      if (d2 < 400) { near.push(e); x += e.x; z += e.z; }
    }
    this.inCombat = fighting;
    if (!fighting || !near.length) { this.cam.combat = null; return; }
    x /= near.length; z /= near.length;
    let d2 = 0;
    for (const e of near) d2 = Math.max(d2, (e.x - x) ** 2 + (e.z - z) ** 2);
    const frame = this.cameraFrame;
    frame.x = (x + H.p.x) / 2; frame.z = (z + H.p.z) / 2; frame.d = Math.sqrt(d2);
    this.cam.combat = frame;
  }
  drawEnemies(dt) {
    const camera = this.ctx.camera, pos = camera.position, H = this.H, cb = this.combat;
    camera.updateMatrixWorld();
    this.viewFrustum.setFromProjectionMatrix(this.viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const enemies = this.visibleEnemies, props = this.visibleProps, sphere = this.viewSphere;
    enemies.length = props.length = 0;
    // Cull before asking for a rig, while keeping the whole nearby fight available behind the camera.
    for (const e of this.enemyList()) {
      const nearby = (e.x - H.p.x) ** 2 + (e.y - H.p.y) ** 2 + (e.z - H.p.z) ** 2 < 2025;
      const tracked = e.id === cb.target || e.id === cb.lock || e.id === cb.held?.enemy;
      if (!nearby && !tracked) {
        if ((e.x - pos.x) ** 2 + (e.y - pos.y) ** 2 + (e.z - pos.z) ** 2 > 67600) continue;
        sphere.center.set(e.x, e.y, e.z); sphere.radius = 4 * (KINDS[e.kind]?.scale || 1);
        if (!this.viewFrustum.intersectsSphere(sphere)) continue;
      }
      enemies.push(e);
    }
    for (const p of this.propList()) {
      if ((p.x - H.p.x) ** 2 + (p.y - H.p.y) ** 2 + (p.z - H.p.z) ** 2 >= 1225) {
        if ((p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 + (p.z - pos.z) ** 2 > 48400) continue;
        sphere.center.set(p.x, p.y, p.z); sphere.radius = 3;
        if (!this.viewFrustum.intersectsSphere(sphere)) continue;
      }
      props.push(p);
    }
    this.enemyView.draw(dt, enemies, pos);
    this.enemyView.drawProps(props);
  }
  // after the city has moved its traffic: the life on the streets, lights, sirens, the events' look
  afterCity(dt, T, glows, lights) {
    if (!this.on || !this.life) return;
    const L = this.life, city = this.ctx.city, cam = this.ctx.camera.position, sky = this.ctx.sky, H = this.H;
    const alarm = this.events.list.some((e) => e.state === "active" && EVENT_TYPES[e.kind].crime);
    if (city.traffic) {
      const before = this.emergencyBefore;
      before.clear();
      for (const id of L.emergency.marked.keys()) before.add(id);
      L.emergency.tag(city.traffic, alarm);
      for (const c of city.traffic.cars) if (c.ev && !before.has(c.id)) city.meshes.get(c)?.children[0]?.userData?.setColor?.(c.color);
      const siren = this.sirenListener, elements = this.ctx.camera.matrixWorld.elements;
      siren.right.x = elements[0]; siren.right.z = elements[2]; siren.audible = dt > 0;
      this.ctx.audio.evSirens?.(L.emergency.lights(city.traffic, T, glows, cam, alarm || this.events.list.some((e) => e.kind === "chase" && e.state === "active"), siren));
    }
    // officers at a scene cover the nearest robber
    L.emergency.updateParked(dt, T, glows, this.W, this.policeTarget);
    this.visualSolids.length = 0;
    L.trains.update(T, glows, this.visualSolids);
    // the crowd runs from fights and gunfire, and stops to watch the hero
    const threats = this.crowdThreats;
    if ((this.threatT -= dt) <= 0) {
      this.threatT = .15; threats.length = 0;
      for (const e of this.events.list) if (e.state === "active" && EVENT_TYPES[e.kind].crime) this.addCrowdThreat(e.x, e.z, 32);
      for (const e of this.enemyList()) if (e.alert && e.hp > 0 && e.st !== "ko") { this.addCrowdThreat(e.x, e.z, 18); if (threats.length > 12) break; }
    }
    const show = H.state === "perch" || H.landT < 1.5 && H.landT > 0 || this.emote ? 22 : 0;
    const hero = this.crowdHero;
    hero.x = H.p.x; hero.y = H.p.y - HIP_H; hero.z = H.p.z; hero.show = show;
    L.crowd.update(dt, cam, hero, threats, glows, sky.night > .5);
    this.skyLife?.update(dt, T, cam, hero, sky.night || 0, glows);
    this.events.draw(dt, T, glows, this.parts);
    for (const t of this.tracerQueue || []) this.tracers.add(...t);
    this.tracerQueue.length = 0;
    // the weather turns over the hours (unless the server fixed it)
    const fixed = this.online && this.ctx.net.room?.weather;
    const w = L.weather.update(dt, sky, fixed);
    if (w) this.hud.center(w.toUpperCase(), "The weather is turning", 2, "small");
  }
  addCrowdThreat(x, z, r) {
    const i = this.crowdThreats.length;
    const threat = this.threatPool[i] || (this.threatPool[i] = { x: 0, z: 0, r: 0 });
    threat.x = x; threat.z = z; threat.r = r;
    this.crowdThreats.push(threat);
  }
  eventColor(e) { return EVENT_TYPES[e.kind]?.crime ? "#ff5a3c" : "#7fe9ff"; }
  mapDots() {
    const out = [], H = this.H;
    if (H) {
      this.caches.near(H.p.x, H.p.z, 330, out);
      for (const w of this.winds?.tunnels || []) for (const t of [.15, .5, .85]) { const x = w.ax + (w.bx - w.ax) * t, z = w.az + (w.bz - w.az) * t; if ((x - H.p.x) ** 2 + (z - H.p.z) ** 2 < 330 * 330) out.push({ x, z, color: "#bfe9ff" }); }
    }
    for (const e of this.events?.list || []) if (e.state !== "done" && e.state !== "failed") out.push({ x: e.x, z: e.z, color: EVENT_TYPES[e.kind].crime ? "#ff5a3c" : "#7fe9ff" });
    for (const r of this.remoteHeroes?.() || []) out.push({ x: r.x, z: r.z, color: r.color || "#ffffff" });
    return out;
  }
  // ---- the city's events: what to say and pay ----
  onEvent(type, e, c) {
    const D = EVENT_TYPES[e.kind];
    if (!D) return;
    switch (type) {
      case "new": if (this.on) this.ctx.ui?.toast(`${D.crime ? "Crime reported" : "Emergency"}: ${D.name}`, [], D.crime ? "warn" : "info"); break;
      case "active": break;
      case "stopped": this.hud.center("CAR STOPPED", "Take down the crew", 1.6, "small"); break;
      case "carhit": this.sfx("thud", 1.2); this.cam.shake(.15); break;
      case "saved": this.hud.center("RESCUED", "", 1.2, "small"); this.tricks.link("takedown", 120); break;
      case "failed": this.hud.center(D.crime && e.kind === "chase" ? "THEY GOT AWAY" : "TOO LATE", D.name, 2, "bail"); break;
      case "done": {
        this.hud.center(D.crime ? "CRIME STOPPED" : "EVERYONE SAFE", `${D.name} · +${D.xp} XP · +${D.coins} coins`, 2.6);
        this.reward?.(D.xp, D.coins, D.name);
        this.sfx("perfect");
        break;
      }
    }
  }
  reward(xp, coins, why) {
    const pr = this.profile();
    pr.xp = (pr.xp || 0) + xp;
    while (pr.xp >= heroXpFor(pr.level || 1)) { pr.xp -= heroXpFor(pr.level || 1); pr.level = (pr.level || 1) + 1; pr.points = (pr.points || 0) + 1; this.hud.center(`LEVEL ${pr.level}`, "A skill point to spend (K)", 2.6); this.onLevel?.(pr.level); }
    if (coins) earn(coins);
    this.ctx.save();
  }
  // ---- civilians: picked up with E, carried, set down on the street ----
  grabCiv(e, c) {
    if (c.carried) return;
    c.carried = this.meId(); this.carry = { e, c, still: 0 };
    this.thwip(1);
    this.hud.center("GOT YOU", "Bring them down to the street", 1.4, "small");
    if (!this.authority()) this.sendWorld?.({ k: "grab", ev: e.id, civ: c.id });
  }
  carryPoint(c) {
    if (!this.carry || this.carry.c.id !== c.id) return null;
    const H = this.H;
    return _cp.set(H.p.x + H.face.x * .45, H.p.y + .1, H.p.z + H.face.z * .45);
  }
  updateCarry(dt) {
    const k = this.carry, H = this.H;
    if (!k) { const g = this.events.grabbable(H.p); this.hud.prompt(g ? "<kbd>C</kbd> Grab" : this.H.riding?.car?.chase ? "<kbd>LMB</kbd> Hit the car" : ""); return; }
    this.hud.prompt("Carrying - land on the street to set them down");
    k.still = H.state === "ground" && H.speed < 2.5 ? k.still + dt : 0;
    if (k.still > .5) {
      const p = this.carryPoint(k.c);
      if (this.authority()) this.events.setDown(k.e, k.c, p.x, H.p.y - HIP_H, p.z);
      else this.sendWorld?.({ k: "setdown", ev: k.e.id, civ: k.c.id, x: p.x, y: H.p.y - HIP_H, z: p.z });
      k.c.carried = null; this.carry = null;
    }
  }
  // ---- the getaway car ----
  carHit(s, nx, ny, nz) {
    for (const d of this.W.dyn) {
      const c = d.car;
      if (!c?.chase) continue;
      if (nx < d.x0 - .5 || nx > d.x1 + .5 || nz < d.z0 - .5 || nz > d.z1 + .5 || ny < d.y0 - .5 || ny > d.y1 + .5) continue;
      this.parts.puff(nx, ny, nz, 10);
      if (this.authority()) this.events.hitCar(c.id, s.kind === "impact" ? 2 : 1);
      else this.sendWorld?.({ k: "carhit", car: c.id, n: s.kind === "impact" ? 2 : 1 });
      return true;
    }
    return false;
  }
  punchCar(c) {
    this.parts.sparks(this.H.p.x, this.H.p.y - .8, this.H.p.z, 10, [1, .8, .5]);
    if (this.authority()) this.events.hitCar(c.id, 1); else this.sendWorld?.({ k: "carhit", car: c.id, n: 1 });
  }

  // what main.js needs to know
  get focus() { return this.H.p; }
  get speed() { return this.H.speed; }
  // for the city's traffic: give way to the hero standing in the road
  trafficPlayers() {
    const H = this.H;
    if (!H || H.p.y - HIP_H > 2.5) return EMPTY;
    const actor = this.trafficActor;
    actor.x = H.p.x; actor.y = H.p.y - HIP_H; actor.z = H.p.z; actor.vx = H.v.x; actor.vz = H.v.z;
    return this.trafficActors;
  }

  // ------------------------------------------------------------------ animation
  animate(dt, inp) {
    const H = this.H, rig = this.rig, a = this.anim;
    a.t += dt;
    const hs = Math.hypot(H.v.x, H.v.z);
    a.dt = dt; a.stateT = H.stateT; a.airT = H.airT; a.ceiling = H.ceiling;
    if (H.state === "air" && (this.poseClearT -= dt) <= 0) {
      this.poseClearT = .2; this.poseClearance = Math.max(0, H.heightAbove());
    } else if (H.state !== "air") this.poseClearT = 0;
    a.heightAbove = H.state === "ground" ? 0 : this.poseClearance;
    // stride phase: one full cycle per two steps, longer strides the faster
    const stride = H.state === "wall" ? H.wallMode === "run" ? Math.max(.75, H.speed / 8) : Math.max(.36, H.speed / 6) : 1.15 + hs * .075;
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
    } else if (H.state === "wall" && !H.move) {
      const vm = _t.copy(H.v).addScaledVector(H.n, -H.v.dot(H.n));
      if (vm.lengthSq() > .05) up.copy(vm);
      else if (a.state === "wall" && this.wallUp) up.copy(this.wallUp);
      else up.copy(H.ceiling ? H.face : UP);
      up.addScaledVector(H.n, -up.dot(H.n));
      if (up.lengthSq() < .01) up.copy(H.ceiling ? H.face : UP).addScaledVector(H.n, -up.dot(H.n));
      up.normalize();
      // Turn within the surface plane, keeping the chest against it even during catches and reversals.
      this.wallUp.addScaledVector(H.n, -this.wallUp.dot(H.n));
      if (a.state !== "wall" || this.wallUp.lengthSq() < .01) this.wallUp.copy(up);
      else {
        this.wallUp.normalize();
        const angle = Math.atan2(_t2.crossVectors(this.wallUp, up).dot(H.n), clamp(this.wallUp.dot(up), -1, 1));
        this.wallUp.applyAxisAngle(H.n, angle * (1 - Math.exp(-dt * 9)));
      }
      // Rotate the whole frame: a runner's feet face the wall and chest faces travel.
      // A crawler's chest faces the wall. Use the same blend as the limb pose.
      const wantRun = H.wallMode === "run" ? 1 : 0;
      const oldBlend = rig.wasOnWall ? rig.wallRunBlend : wantRun;
      const blend = oldBlend + clamp(wantRun - oldBlend, -Math.min(dt, .1) / .24, Math.min(dt, .1) / .24);
      const angle = blend * blend * (3 - 2 * blend) * Math.PI / 2;
      up.copy(this.wallUp).multiplyScalar(Math.cos(angle)).addScaledVector(H.n, Math.sin(angle)).normalize();
      fwd.copy(this.wallUp).multiplyScalar(Math.sin(angle)).addScaledVector(H.n, -Math.cos(angle)).normalize();
      // Bank onto the wall-side shoulder, keeping the upper body toward world-up on sideways runs.
      const bankSide = _t2.crossVectors(this.wallUp, H.n).dot(UP) >= 0 ? 1 : -1;
      up.applyAxisAngle(fwd, bankSide * .85 * blend * blend * (3 - 2 * blend));
      rate = 0;
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
      const falling = clamp((-H.v.y - 3) / 28, 0, 1) * clamp((a.heightAbove - 4) / 18, 0, 1);
      up.addScaledVector(_t.set(H.v.x, 0, H.v.z), .006).addScaledVector(H.face, falling * .3).normalize();
      fwd.addScaledVector(up, -fwd.dot(up)).normalize();
      rate = 7;
    } else if (H.state === "ledge" || H.state === "perch" || H.state === "water") rate = 10;
    this.prevV = (this.prevV || new V()).copy(H.v);
    this.prevHeading = Math.atan2(H.v.x, H.v.z);
    if (this.H.prevState !== H.state && H.stateT < .05) rate = Math.min(rate, 8);
    // roll: a forward tumble about the hips on a roll landing
    const airborne = (H.state === "air" || H.state === "swing" || H.state === "zip") && !H.move && this.combat.downT <= 0 && H.combatLock <= 0;
    let extra = airborne ? this.tricks.rot : null;
    if (H.rollT > 0) { _qa.setFromAxisAngle(_x, (1 - H.rollT / .45) * Math.PI * 2); extra = _qe.copy(extra || _qi.identity()).multiply(_qa); }
    // Keep the hips at the physics position so the planted pose also lines up for other players.
    rig.place(H.p, up, fwd, extra, dt, this.firstFrames > 0 ? 0 : rate);
    // limb pose
    a.state = H.state; a.speed = H.speed; a.hs = hs; a.vy = H.v.y; a.slide = H.slideT; a.roll = H.rollT; a.hard = H.hardT; a.landT = H.landT;
    a.crouch = inp.crouch && H.state === "ground" && hs < 5; a.dive = H.dive; a.glide = H.glide; a.dash = H.dashUsed && H.state === "air" && this.dashT > 0 ? 1 : 0;
    a.move = H.move; a.wallMode = H.wallMode; a.trick = airborne ? this.tricks.shape() : null;
    a.sling = H.sling ? H.sling.charge : null; a.swingStyle = this.swingStyle;
    a.turn = clamp(H.turnRate || 0, -1, 1);
    a.combat = this.inCombat;
    a.releaseT = H.releaseT; a.releaseQuality = H.releaseQuality;
    if (H.state === "wall") {
      const wallMove = a.wallMove || (a.wallMove = { x: 0, y: 0 });
      _t.copy(H.v).applyQuaternion(_qi.copy(rig.group.quaternion).invert());
      wallMove.x = _t.x; wallMove.y = _t.y; a.wallDistance = TUNE.r + .02;
      (a.wallNormal || (a.wallNormal = new V())).copy(H.n).applyQuaternion(_qi);
    }
    // the arm holding a line points at its anchor; the swing's phase decides the legs
    a.anchorLocal = null; a.anchor2Local = null; a.swingSide = H.webs[0]?.side || H.lastSide;
    if (H.state === "swing" && P) {
      a.anchorLocal = this.toBody(P, a.swingSide, this.posePoints[0]);
      if (H.webs[1]) a.anchor2Local = this.toBody(H.webs[1].pivot(), -a.swingSide, this.posePoints[1]);
      const ox = H.p.x - P.x, oz = H.p.z - P.z, hv = Math.max(1, hs);
      a.swingPhase = clamp((ox * H.v.x + oz * H.v.z) / hv / Math.max(5, H.webs[0].L * .7), -1, 1);
    } else if (H.state === "zip" && H.zip) a.anchorLocal = this.toBody(_t.set(H.zip.x, H.zip.y, H.zip.z), a.swingSide, this.posePoints[0]);
    a.swingT = H.swingT || 0; a.catch = H.state === "swing" ? Math.max(0, 1 - a.swingT / .4) : 0;
    a.load = H.state === "swing" && H.webs[0]?.taut ? clamp(H.speed * H.speed / Math.max(1, H.webs[0].L * 80), 0, 1) : 0;
    a.shootLocal = null;
    if (this.shootFlash > 0) { this.shootFlash -= dt; a.shootLocal = this.toBody(this.shootAt, this.shootSide, this.posePoints[2]); a.shootSide = this.shootSide; }
    a.attack = this.combat.downT > 0 ? { kind: "down", k: .5 } : this.combat.attackPose() || (this.emote ? { kind: "emote", id: this.emote.id, t: this.emote.t, k: .5 } : null);
    if (inp.emote && !this.inCombat) this.emote = { id: inp.emote - 1, t: 0 };
    if (this.emote) { this.emote.t += dt; if (H.speed > 1.5 || H.state !== "ground" || this.emote.t > 8) this.emote = null; }
    const r = poseBody(rig, a);
    // the mask's lenses: narrowed in a fight or when pulling a slingshot, and a quick blink every few seconds
    const Um = rig.mat.userData.u;
    this.blinkT = (this.blinkT ?? 3) - dt;
    if (this.blinkT < -.13) this.blinkT = 2.5 + Math.random() * 4;
    const squint = this.blinkT < 0 ? 1 : (this.inCombat || this.combat.action ? .5 : 0) + (H.sling ? .35 : 0) + (H.dive ? .3 : 0);
    Um.uSquint.value += (Math.min(1, squint) - Um.uSquint.value) * Math.min(1, dt * (this.blinkT < 0 ? 40 : 10));
    // overcharged: the whole suit runs hot
    if (this.combat.overT > 0) rig.mat.userData.u.uGlowAmt.value += .9 + Math.sin(a.t * 18) * .15;
    if (this.combat.hp < .3 && this.combat.downT <= 0) rig.mat.userData.u.uGlowAmt.value += .2 + Math.sin(a.t * 12) * .12;
    rig.apply(this.combat.stopT > 0 ? dt * .1 : dt, this.firstFrames > 0 ? 1000 : r);
    const Uh = rig.mat.userData.u;
    Uh.uHit.value = Math.max(0, Uh.uHit.value - dt * 4);
    if (this.firstFrames > 0) rig.snap();
    // the wrist emitters flare when a line goes out
    const U = rig.mat.userData.u;
    U.uShoot.value.x *= Math.exp(-dt * 6); U.uShoot.value.y *= Math.exp(-dt * 6);
    for (const w of H.webs) if (w.side > 0) U.uShoot.value.x = Math.max(U.uShoot.value.x, .5); else U.uShoot.value.y = Math.max(U.uShoot.value.y, .5);
    if (H.sling || this.combat.overT > 0) U.uShoot.value.set(1, 1);
  }
  // a world point as a direction from the shoulder, in the rig's own frame
  toBody(pt, side, out = new V()) {
    const rig = this.rig;
    _t2.set(side > 0 ? .2 : -.2, HIP_H + .45, 0).applyQuaternion(rig.group.quaternion).add(rig.group.position);
    return out.subVectors(pt, _t2).applyQuaternion(_qi.copy(rig.group.quaternion).invert()).normalize();
  }

  // ------------------------------------------------------------------ webs and trails
  drawWebs(dt) {
    const H = this.H, rig = this.rig, cam = this.ctx.camera.position;
    const pts = this.webPoints, pair = this.webPair;
    this.webs.begin(cam);
    for (const w of H.webs) {
      pts.length = 0;
      pts.push(rig.handPos(w.side, pair[0]));
      for (let i = w.pivots.length - 1; i >= 0; i--) pts.push(w.pivots[i]);
      pts.push(w.a);
      const d = H.p.distanceTo(w.pivot());
      const slack = Math.max(0, w.L - d);
      const tensionPulse = 1 + Math.sin(this.clock * 20 + w.side) * clamp(H.speed / 90, 0, .14);
      this.webs.line(pts, this.webCol, tensionPulse, Math.max(0, .25 - w.t) * 3, Math.min(3, slack * .4), this.clock);
      w.t += dt;
    }
    // the slingshot's two lines, drawn tighter the harder it is pulled
    if (H.sling) for (let i = 0; i < 2; i++) {
      rig.handPos(i ? -1 : 1, pair[0]); pair[1].copy(this.slingPts[i]);
      this.webs.line(pair, this.webCol, 1, Math.max(0, .2 - H.sling.t) * 4, Math.max(0, .6 - H.sling.charge) * 1.5, this.clock);
    }
    for (const s of H.shots) {
      rig.handPos(s.side, pair[0]);
      pair[1].copy(pair[0]).lerp(s.to, Math.min(1, s.t / s.travel));
      this.webs.line(pair, this.webCol, 1, .8, 0, this.clock);
    }
    // combat lines: a pull, a launch, a web strike, a throw on the end of a line, web shots in flight
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.t += dt;
      if (l.t > l.life) { this.lines.splice(i, 1); continue; }
      const to = l.follow ? l.follow() : l.to;
      if (!to) { this.lines.splice(i, 1); continue; }
      rig.handPos(l.side, pair[0]);
      const k = Math.min(1, l.t / .06);
      pair[1].copy(pair[0]).lerp(to, k);
      this.webs.line(pair, this.webCol, 1 - Math.max(0, (l.t - l.life + .1) / .1), k < 1 ? .6 : 0, 0, this.clock);
    }
    if (this.online) this.netx.drawWebs(this.webs, this.webCol, this.clock);
    for (const s of this.combat.shots) {
      pair[0].set(s.x - s.vx * .05, s.y - s.vy * .05, s.z - s.vz * .05); pair[1].set(s.x, s.y, s.z);
      this.webs.line(pair, this.webCol, 1, 0, 0, this.clock);
    }
    for (const t of this.combat.traps) if (Math.random() < .3) this.parts.energy(t.x + t.nx * .2, t.y + t.ny * .2, t.z + t.nz * .2, 1, this.glowRGB());
    for (const b of this.combat.bombs) this.parts.energy(b.x, b.y, b.z, 1, WHITE);
    if (H.state === "zip" && H.zip) {
      const z = H.zip, k = Math.min(1, z.t / z.travel);
      rig.handPos(H.lastSide, pair[0]); pair[1].copy(pair[0]).lerp(_t.set(z.x, z.y, z.z), k);
      this.webs.line(pair, this.webCol, 1, k < 1 ? .8 : .1, 0, this.clock);
    }
    this.webs.end(dt);
  }
  trailsUpdate(dt) {
    const H = this.H, rig = this.rig;
    const on = this.dashT > 0 ? 1 : this.tricks.active ? 1 : H.state === "wall" && H.wallMode === "run" ? .55 : H.state === "swing" && H.speed > 25 ? .3 : H.speed > 38 ? .45 : 0;
    const col = this.webCol;
    rig.mesh.updateMatrixWorld(true);
    for (let i = 0; i < TRAIL_BONES.length; i++) this.trails.push(i, rig.bonePos(TRAIL_BONES[i], _h2), on, col);
    this.trails.update(this.ctx.camera.position, dt);
  }

  // ------------------------------------------------------------------ events -> effects and sound
  handleEvents(list) {
    const H = this.H, fx = this.parts, A = this.ctx.audio;
    for (const e of list) {
      switch (e.type) {
        case "shoot": {
          this.thwip(e.second ? .7 : 1); this.shootAt = new V(e.x, e.y, e.z); this.shootSide = e.side; this.shootFlash = .18;
          const hand = this.rig.handPos(e.side, _h1); fx.energy(hand.x, hand.y, hand.z, 4, this.glowRGB());
          break;
        }
        case "slingstart": this.slingAnchors(); this.thwip(1); this.thwip(.8); break;
        case "slingcancel": this.sfx("release"); break;
        case "slingshot": {
          fx.energy(H.p.x, H.p.y, H.p.z, 24, this.glowRGB()); fx.dust(H.p.x, H.p.y - HIP_H, H.p.z, 18, 1.2);
          this.rings.spawn(H.p.x, H.p.y - HIP_H + .05, H.p.z, 5, 0xffffff, .45);
          this.sfx("launch", 1.4 + e.charge); this.cam.shake(.25 + e.charge * .2); this.tricks.link("slingshot", Math.round(e.charge * 100));
          for (const p of this.slingPts) this.webs.drop(this.rig.handPos(1, _h1), p, this.webCol);
          break;
        }
        case "windin": this.sfx("glide"); this.tricks.link(e.kind === "tunnel" ? "wind" : "updraft"); break;
        case "attach": {
          this.swingStyle = (this.swingStyle + 1 + (Math.random() < .4 ? 1 : 0)) % 3;
          const w = H.webs[H.webs.length - 1];
          if (w) { fx.puff(w.a.x, w.a.y, w.a.z, 10, w.n.x, w.n.y, w.n.z); fx.sparks(w.a.x, w.a.y, w.a.z, 8, [1, .65, 1], .55); this.rings.spawn(w.a.x, w.a.y, w.a.z, 1.8, 0xffffff, .28, w.n); }
          this.sfx("attach"); break;
        }
        case "letgo": case "release": if (e.type === "letgo") { this.sfx(e.jump ? "launch" : "release", e.jump ? 1 : e.quality + 1); if (e.quality === 2) this.hud.center("PERFECT RELEASE", "", .9, "small"); } this.dropWebs(); break;
        case "snap": this.sfx("snap"); this.dropWebs(); break;
        case "land": {
          const p = H.p, power = clamp(-e.vy / 30, .2, 1.4);
          fx.dust(p.x, p.y - HIP_H, p.z, Math.round(8 + power * 18), power);
          if (e.kind === "hard") {
            const y = p.y - HIP_H + .05;
            this.rings.spawn(p.x, y, p.z, 5 + power * 4, 0xffffff, .6);
            this.rings.spawn(p.x, y + .04, p.z, 2.5 + power * 2.5, SUITS[this.suitId].glow, .38);
            fx.sparks(p.x, y + .1, p.z, Math.round(12 + power * 18), [1, .55, .2], .7 + power * .3);
            fx.energy(p.x, y + .2, p.z, Math.round(6 + power * 8), this.glowRGB());
            this.cam.shake(.5 * power); this.cam.punch(0, -.35 * power, 0); this.sfx("hardland", power);
          }
          else { this.cam.shake(.12 * power); this.sfx("land", power); }
          break;
        }
        case "walljump": fx.puff(H.p.x - H.n.x * .5, H.p.y, H.p.z - H.n.z * .5, 10); fx.sparks(H.p.x - H.n.x * .4, H.p.y, H.p.z - H.n.z * .4, 12, [1, .65, 1], .7); this.cam.shake(.14); this.cam.punch(0, .12, 0); this.sfx("jump"); break;
        case "jump": this.sfx("jump", e.big ? 1.5 : 1); if (e.big) fx.dust(H.p.x, H.p.y - HIP_H, H.p.z, 16, 1.2); break;
        case "launch": case "rooflaunch": fx.energy(H.p.x, H.p.y, H.p.z, 16, this.glowRGB()); this.sfx("launch", 1.3); this.cam.shake(.15); break;
        case "zipgo":
          fx.energy(H.p.x, H.p.y, H.p.z, 8, this.glowRGB());
          fx.sparks(H.p.x, H.p.y, H.p.z, 8, [1, .65, 1], .5);
          this.rings.spawn(H.p.x, H.p.y, H.p.z, 1.6, 0xffffff, .22);
          this.sfx("zip"); break;
        case "perch": this.sfx("land", .4); break;
        case "wall":
          if (e.mode === "run") { fx.sparks(H.p.x - H.n.x * .35, H.p.y, H.p.z - H.n.z * .35, 6, [1, .55, .2], .45); fx.puff(H.p.x - H.n.x * .25, H.p.y, H.p.z - H.n.z * .25, 4); }
          else fx.puff(H.p.x - H.n.x * .3, H.p.y, H.p.z - H.n.z * .3, 5);
          this.sfx("land", .3); break;
        case "corner": fx.sparks(H.p.x, H.p.y, H.p.z, 5, [1, .65, 1], .4); this.sfx("whoosh", .35); break;
        case "vault": case "mantle": case "climb":
          fx.dust(H.p.x, H.p.y - HIP_H, H.p.z, e.type === "vault" ? 8 : 12, .65);
          fx.sparks(H.p.x, H.p.y - .25, H.p.z, 5, [1, .55, .2], .35);
          this.rings.spawn(H.p.x, H.p.y - HIP_H + .03, H.p.z, e.type === "vault" ? 1.4 : 1.9, 0xffffff, .2);
          this.sfx("vault"); break;
        case "slide": this.sfx("slide"); break;
        case "dive": fx.energy(H.p.x, H.p.y, H.p.z, 6, this.glowRGB()); this.sfx("dive"); break;
        case "glide": this.sfx("glide"); break;
        case "airdash": this.dashT = .25; fx.energy(H.p.x, H.p.y, H.p.z, 10, this.glowRGB()); this.rings.spawn(H.p.x, H.p.y, H.p.z, 1.7, SUITS[this.suitId].glow, .22); this.sfx("dash"); break;
        case "splash": fx.splash(H.p.x, e.y, H.p.z, 40); this.sfx("splash"); break;
        case "noweb": case "nozip": this.sfx("deny"); break;
        case "skim": fx.dust(H.p.x, H.p.y - HIP_H, H.p.z, 10, .8); break;
        case "bound": this.hud.center("EDGE OF THE CITY", "Turn back", 1.5, "small"); break;
      }
    }
    this.dashT = Math.max(0, (this.dashT || 0) - (this.frameDt || 0));
  }
  // the slingshot's anchors: whatever is ahead and to each side, or a point in the air if nothing is
  slingAnchors() {
    const H = this.H, W = this.W, f = H.face, hit = this.slingHit || (this.slingHit = {});
    for (let i = 0; i < 2; i++) {
      const s = i ? -1 : 1, a = Math.atan2(f.x, f.z) + s * .6, dx = Math.sin(a), dz = Math.cos(a);
      const r = W.raycast(H.p.x, H.p.y + .6, H.p.z, dx, .12, dz, 26, 1, hit);
      if (r) this.slingPts[i].set(r.x, r.y, r.z);
      else this.slingPts[i].set(H.p.x + dx * 9, H.p.y + 1.6, H.p.z + dz * 9);
    }
  }
  dropWebs() {
    const rig = this.rig;
    for (const w of this.lastWebs || []) this.webs.drop(rig.handPos(w.side, _h1), w.a, this.webCol);
    this.lastWebs.length = 0;
  }
  glowRGB() {
    if (this.glowSuit !== this.suitId) {
      const c = new THREE.Color(SUITS[this.suitId].glow);
      this.glowColor = [c.r, c.g, c.b]; this.glowSuit = this.suitId;
    }
    return this.glowColor;
  }
  // keep a copy of the attached lines so a let-go can draw them falling away
  noteWebs() {
    const webs = this.H.webs;
    this.lastWebs.length = webs.length;
    for (let i = 0; i < webs.length; i++) {
      const snapshot = this.lastWebPool[i];
      snapshot.side = webs[i].side; snapshot.a.copy(webs[i].a);
      this.lastWebs[i] = snapshot;
    }
  }

  // ------------------------------------------------------------------ HUD
  updateHud(dt, inp) {
    const H = this.H, hud = this.hud, cam = this.ctx.camera;
    if (H.webs.length) this.noteWebs();
    const preview = this.previewInput, enabled = this.frameDt > 0 && this.input.wantLock;
    const canSwing = H.state === "air" || H.state === "ground" || H.state === "wall" || H.state === "perch";
    this.anchorAge += dt;
    // Previews are advisory; the real shot still chooses its anchor immediately when the player acts.
    if (enabled && canSwing && !this.inCombat && !inp.swing && !H.shots.length && !H.move) {
      if ((this.previewT -= dt) <= 0) {
        this.previewT = .35;
        if (this.anchorAge >= .9 || this.anchorOrigin.distanceToSquared(H.p) > 4 || this.anchorLook.dot(this.cam.look) < .995) {
          Object.assign(preview, inp); preview.look = this.cam.look; preview.camPos = cam.position;
          this.anchorPreview = H.findAnchor(preview);
          this.anchorOrigin.copy(H.p); this.anchorLook.copy(this.cam.look); this.anchorAge = 0;
        }
      }
    } else { this.anchorPreview = null; this.previewT = 0; this.anchorAge = 1; }
    if (enabled && !H.move) {
      if ((this.zipPreviewT -= dt) <= 0) {
        this.zipPreviewT = .25;
        Object.assign(preview, inp); preview.look = this.cam.look; preview.camPos = cam.position;
        this.zipPreview = H.zipTarget(preview);
      }
    } else { this.zipPreview = null; this.zipPreviewT = 0; }
    if ((this.gadgetT -= dt) <= 0) {
      this.gadgetT = .1; this.gadgetHtml = this.gadgetBar(); this.abilityHtml = this.abilityBar();
    }
    const W = innerWidth, Hh = innerHeight;
    const proj = this.projectHud;
    const zp = this.zipPreview && proj(this.zipPreview.x, this.zipPreview.y, this.zipPreview.z);
    hud.mark("hhZip", zp?.[0] || 0, zp?.[1] || 0, !!zp, this.zipMarker);
    const ap = this.anchorPreview && H.state !== "swing" && proj(this.anchorPreview.x, this.anchorPreview.y, this.anchorPreview.z);
    hud.mark("hhAnchor", ap?.[0] || 0, ap?.[1] || 0, !!ap);
    const alt = H.p.y - HIP_H;
    const state = this.hudState, releaseReady = this.releaseReady();
    state.speed = H.speed; state.alt = alt;
    state.stateLabel = H.sling ? `SLINGSHOT ${Math.round(H.sling.charge * 100)}%` : H.inWind === "tunnel" ? "WIND TUNNEL" : H.inWind === "draft" ? "UPDRAFT" : H.dive ? "DIVE" : H.glide ? "WEB WINGS" : H.state === "wall" ? (H.ceiling ? "CEILING" : H.wallMode === "run" ? "WALL RUN" : "WALL CRAWL") : STATE_LABEL[H.state] || "";
    if ((H.state === "air" || H.state === "swing" || H.state === "zip") && this.tricks.active) state.stateLabel = this.tricks.cur?.d?.name?.toUpperCase() || "AIR TRICK";
    state.level = this.profile().level || 1; state.suit = SUITS[this.suitId].name;
    state.traversal = this.traversalHint(inp, releaseReady); state.releaseReady = releaseReady; state.anchorReady = !!this.anchorPreview;
    state.tricks = this.tricks; state.trickEvents = this.trickEvents; state.hp = this.combat.hp; state.focus = this.combat.focus; state.noWeb = H.noWebT;
    state.gadgets = this.gadgetHtml; state.abilities = this.abilityHtml; state.over = this.combat.overT; state.hits = this.combat.combo; state.sense = this.senseHud(); state.mission = hud.missionHtml || ""; state.race = this.activities.raceHtml || "";
    hud.update(dt, state);
    // the nearest event: the panel, and an arrow to it
    const near = this.activities.target ? { e: { ...this.activities.target, kind: "race" }, d: H.p.distanceTo(_t2.set(this.activities.target.x, this.activities.target.y, this.activities.target.z)) } : this.events?.nearest(H.p);
    if (near && near.e.kind === "race") {
      hud.missionHtml = "";
      const e = near.e, wp = proj(e.x, e.y, e.z), way = hud.$("hhWay");
      let sx, sy;
      if (wp) { sx = wp[0]; sy = wp[1]; } else { const dx = e.x - H.p.x, dz = e.z - H.p.z, f = this.cam.look, rel = Math.atan2(dx, dz) - Math.atan2(f.x, f.z); sx = W / 2 - Math.sin(rel) * W * .42; sy = Hh / 2 - Math.cos(rel) * Hh * .38; }
      way.hidden = false; way.classList.add("rescue");
      way.style.transform = `translate(${sx.toFixed(0)}px,${sy.toFixed(0)}px)`;
      const label = `${Math.round(near.d)} m`;
      if (way.dataset.l !== label) { way.dataset.l = label; way.querySelector("b").textContent = label; }
    } else if (near) {
      const e = near.e, D = EVENT_TYPES[e.kind];
      const extra = e.kind === "chase" && e.state === "active" ? (e.hp > 0 ? `Car damage ${6 - e.hp}/6 · ${Math.max(0, Math.round(e.timer ?? 0))} s` : `${e.left ?? "?"} left`) : e.left != null && e.state === "active" ? `${e.left} left` : "";
      hud.missionHtml = `<h4>${D.name}</h4><p>${D.goal}</p><p>${Math.round(near.d)} m${extra ? " · " + extra : ""}</p>`;
      const wp = proj(e.x, e.y + 3, e.z), way = hud.$("hhWay");
      let sx, sy;
      if (wp) { sx = wp[0]; sy = wp[1] - 26; } else {
        // off screen: pin it to the edge in its direction
        const dx = e.x - H.p.x, dz = e.z - H.p.z, f = this.cam.look, rel = Math.atan2(dx, dz) - Math.atan2(f.x, f.z);
        sx = W / 2 - Math.sin(rel) * W * .42; sy = Hh / 2 - Math.cos(rel) * Hh * .38;
      }
      way.hidden = false; way.classList.toggle("rescue", !D.crime);
      way.style.transform = `translate(${sx.toFixed(0)}px,${sy.toFixed(0)}px)`;
      const label = `${Math.round(near.d)} m`;
      if (way.dataset.l !== label) { way.dataset.l = label; way.querySelector("b").textContent = label; }
    } else { hud.missionHtml = ""; hud.$("hhWay").hidden = true; }
    // the target: a ring, its name and its health
    const cb = this.combat, tg = cb.target != null ? cb.byId(cb.target) : null;
    const tp = tg && cb.alive(tg) && (this.inCombat || cb.lock) && proj(tg.x, tg.y + 1.15 * (KINDS[tg.kind]?.scale || 1), tg.z);
    this.hudTarget = tg;
    hud.mark("hhTarget", tp?.[0] || 0, tp?.[1] || 0, !!tp, this.targetMarker);
    if ((this.distT = (this.distT || 0) - dt) <= 0) {
      this.distT = .5;
      // street-level names, except when actually standing on the expressway deck
      const onDeck = H.state === "ground" && alt > 6 && alt < 10 && this.W.topAt(H.p.x, H.p.z, H.p.y) > 6 && Math.abs(Math.max(Math.abs(H.p.x), Math.abs(H.p.z)) - 720) < 40;
      hud.district(heroDistrict(this.W.M, this.W, H.p.x, onDeck ? 8 : H.p.y - HIP_H < -1 ? -5 : 0, H.p.z));
    }
  }

  releaseReady() {
    const H = this.H, P = H.webs[0]?.pivot();
    if (H.state !== "swing" || !P || H.speed <= 22 || H.v.y <= 0) return false;
    const dx = H.p.x - P.x, dy = H.p.y - P.y, dz = H.p.z - P.z;
    const angle = Math.acos(clamp(-dy / Math.max(.01, Math.hypot(dx, dy, dz)), -1, 1));
    return dx * H.v.x + dz * H.v.z > 0 && angle > .75 && angle < 1.25;
  }
  traversalHint(inp, releaseReady = this.releaseReady()) {
    const H = this.H, cb = this.combat, pad = inp.pad;
    const jump = pad ? "A" : "Space", swing = pad ? "RT" : "Shift", zip = pad ? "LB" : "C";
    if (cb.downT > 0) return "Recovering";
    if (H.sling) return `${pad ? "Release LB + RB" : "Release right mouse or Space"} · Launch (${Math.round(H.sling.charge * 100)}%)`;
    if (cb.senses.length) return `${pad ? "B" : "R"} · Dodge   ${pad ? "LB" : "V"} · Parry`;
    if (this.inCombat) return cb.focus >= 1 ? `${pad ? "X" : "Left mouse"} · Combo   ${pad ? "Y" : "F"} · Web strike` : `${pad ? "X" : "Left mouse"} · Attack   ${pad ? "B" : "R"} · Dodge`;
    if (inp.trick && (H.state === "air" || H.state === "swing")) return `${pad ? "RB + stick" : "X + WASD / arrows"} · Change trick direction   ${pad ? "Release RB" : "Release X"} · Recover`;
    if (H.state === "swing") return releaseReady ? `${jump} · Perfect launch now` : `${jump} · Launch   WASD / stick · Steer`;
    if (H.state === "zip") return `${jump} · Time a point launch on arrival`;
    if (H.state === "wall") return `${pad ? "L3" : "Shift / Alt"} · Run   release to crawl   ${jump} · Leap off`;
    if (H.state === "water") return `${jump} · Jump out   ${swing} · Swing away`;
    if (H.dive) return `${swing} · Catch a line and carry your speed`;
    if (H.inWind) return `Steer to ride the ${H.inWind === "tunnel" ? "current" : "updraft"}   ${swing} · Swing out`;
    if (H.glide) return `${pad ? "B" : "Ctrl"} · Dive   ${swing} · Swing`;
    if (H.state === "air" && this.cam.firstPerson) return "Aim at a building · Hold right mouse to swing · P · Third person";
    if (H.state === "air") return `${swing} · Swing   ${zip} · Zip   ${pad ? "B" : "Ctrl"} · Dive`;
    if (H.state === "perch") return `${jump} · Point launch   ${pad ? "Hold LB + RB" : "Right mouse + Space"} · Slingshot`;
    return `${swing} · Swing   ${jump} · Jump   ${pad ? "Hold LB + RB" : "Right mouse + Space"} · Slingshot`;
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
  // ---- online glue ----
  netState(T, now, round) { return this.H ? this.netx.state(T, now, round) : null; }
  remoteHeroes() { return this.online ? this.netx.list() : EMPTY; }
  relay(e) { this.netx.relay(e); }
  sendWorld(w) { if (this.online) this.netx.send(w); }
  playerRows() {
    const me = this.meId(), rows = [], R = this.netx.list();
    for (const p of this.ctx.net.room?.players || []) {
      const isMe = p.id === me, v = R.find((q) => q.id === p.id);
      rows.push({ id: p.id, me: isMe, name: p.name, car: isMe ? `${SUITS[this.suitId]?.name || ""} · lvl ${this.profile().level || 1}` : v ? `${SUITS[v.suit]?.name || "Hero"} · style ${(v.style || 0).toLocaleString()}` : "Hero", dist: isMe ? 0 : v ? Math.hypot(v.x - this.H.p.x, v.y - this.H.p.y, v.z - this.H.p.z) : null });
    }
    return rows;
  }
  // next to a friend: just above and behind them, in the air
  teleportTo(id) {
    const v = this.netx.views.get(id);
    if (!v || !v.data) return { ok: false, text: "They aren't sending a position right now." };
    const H = this.H, f = v.vel.lengthSq() > 1 ? v.vel.clone().setY(0).normalize() : new V(0, 0, 1);
    H.reset(v.pos.x - f.x * 6, v.pos.y + 3, v.pos.z - f.z * 6); H.state = "air";
    H.v.copy(v.vel).multiplyScalar(.8);
    this.cam.snapNext = true; this.tpN = (this.tpN | 0) + 1;
    const name = this.ctx.net.peers.get(id)?.name || "them";
    return { ok: true, text: `Teleported to ${name}.` };
  }
  emoteByName(name) {
    const i = EMOTES.findIndex((e) => e.toLowerCase().startsWith(String(name || "").toLowerCase()));
    if (i < 0) return { ok: false, text: "Emotes: " + EMOTES.join(", ").toLowerCase() };
    if (this.H.state !== "ground") return { ok: false, text: "Stand on something first." };
    this.emote = { id: i, t: 0 };
    return { ok: true, text: EMOTES[i] };
  }
  startActivity(kind, arg) { return this.activities.start(kind, arg); }
  setSuit(id) {
    if (!SUITS[id]) return;
    this.suitId = id;
    this.rig?.setLook(SUITS[id]);
    this.webCol = new THREE.Color(SUITS[id].glow).lerp(new THREE.Color(1, 1, 1), .55);
    this.profile().suit = id; this.ctx.save();
  }
  onLevel() { this.progress.apply(); }

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
  enemyList() { return this.authority() ? this.sim.list : this.netx.remoteEnemies; }
  propList() { return this.authority() ? this.sim.props : this.netx.props; }
  // everyone the enemies can see and hit: this hero, and (online) the other heroes
  players() {
    const H = this.H, out = this.playerStates, local = this.localPlayer;
    local.id = this.meId(); local.x = H.p.x; local.y = H.p.y; local.z = H.p.z;
    local.vx = H.v.x; local.vz = H.v.z; local.down = this.combat.downT > 0;
    out.length = 0; out.push(local);
    for (const r of this.remoteHeroes()) out.push(r);
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
    let line = this.lines.find((l) => l.hold);
    if (!line) {
      line = { side: 1, t: .1, life: .62, hold: true, to: new V() };
      line.follow = () => this.combat.held ? line.to : null;
      this.lines.push(line);
    }
    line.to.copy(pos);
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
  // after a fast travel: the same clean slate as a respawn, without moving the hero again
  afterTeleport() {
    this.tricks.reset(); this.poseClearT = 0; this.anim.state = null;
    this.prevV = null; this.prevHeading = undefined; this.emote = null;
    this.lastWebs.length = 0; this.lines.length = 0; this.shootFlash = 0; this.dashT = 0;
    this.anchorPreview = null; this.zipPreview = null; this.previewT = 0; this.firstFrames = 3;
    this.zipPreviewT = 0; this.anchorAge = 1; this.threatT = 0; this.tpN = (this.tpN | 0) + 1;
  }
  respawn() {
    const H = this.H, W = this.W;
    let best = null, bd = 1e9;
    for (const p of W.perches) { if (p.kind !== "corner" || p.y < 25 || p.y > 140) continue; const d = Math.hypot(p.x - H.p.x, p.z - H.p.z); if (d > 60 && d < bd) { bd = d; best = p; } }
    if (best) { const x = best.x - best.nx * 2.5, z = best.z - best.nz * 2.5; H.reset(x, W.topAt(x, z, best.y + 2) + HIP_H, z); }
    else { const sp = this.spawnPoint(); H.reset(sp.x, sp.y, sp.z); }
    H.state = "ground";
    this.tricks.reset(); this.poseClearT = 0; this.anim.state = null;
    this.combat.reset();
    this.prevV = null; this.prevHeading = undefined; this.emote = null;
    this.lastWebs.length = 0; this.lines.length = 0; this.shootFlash = 0; this.dashT = 0;
    this.anchorPreview = null; this.zipPreview = null; this.previewT = 0; this.firstFrames = 3;
    this.zipPreviewT = 0; this.anchorAge = 1; this.gadgetT = 0; this.threatT = 0;
    this.inCombat = false; this.cam.combat = null;
    this.cam.snapNext = true;
    this.hud.center("BACK ON YOUR FEET", "", 1.6, "small");
  }
  // what the enemy simulation reported: hits on this hero, warnings, effects
  simEvents(list) {
    const me = this.meId(), cb = this.combat, fx = this.parts;
    for (const e of list) {
      switch (e.type) {
        case "windup": if (e.target === me) { const en = this.sim.byId.get(e.e); if (en) cb.sense(en, e.t, e.kind); } else this.relay?.(e); break;
        case "strike": if (e.target === me) { const r = cb.takeHit(e.dmg, e.kx, e.kz, e.heavy, e.kind, e.e); if (r === "hit" || r === "down") fx.sparks(this.H.p.x, this.H.p.y + .3, this.H.p.z, 10, [1, .4, .2]); } else this.relay?.(e); break;
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
      case "ko": fx.sparks(e.x, e.y + .3, e.z, 18, [1, 1, 1]); this.rings.spawn(e.x, e.y, e.z, e.boss ? 5 : 2.5, e.boss ? 0xffa040 : 0xffffff, e.boss ? .5 : .25); if (e.from === this.meId()) { this.tricks.link(e.boss ? "finisher" : "takedown"); this.combat.focus = Math.min(3, this.combat.focus + .15); this.combat.kills++; this.onKo?.(e); } this.sfx("ko"); break;
      case "webbed": if (en) { fx.puff(en.x, en.y, en.z, 14); fx.energy(en.x, en.y + .35, en.z, 5, this.glowRGB()); this.rings.spawn(en.x, en.y, en.z, 1.8, 0xffffff, .24); } this.sfx("webhit"); break;
      case "pinned": fx.puff(e.x, e.y, e.z, 20); fx.sparks(e.x, e.y + .35, e.z, 10, [1, .65, 1], .6); this.rings.spawn(e.x, e.y, e.z, 3.2, 0xffffff, .3); this.tricks.link("wallpin"); this.sfx("webhit", 1.4); this.cam.shake(.15); break;
      case "wallslam": case "bodyhit": fx.dust(e.x, e.y - .6, e.z, 12, 1); fx.debris(e.x, e.y, e.z, 8); this.rings.spawn(e.x, e.y, e.z, 2.5, 0xffa040, .25); this.cam.shake(.12); this.sfx("thud"); break;
      case "land": if (e.v > 8) { fx.dust(e.x, e.y - .9, e.z, 10, .9); this.sfx("thud", .6); } break;
      case "fire": this.tracers.add(e.x, e.y, e.z, e.vx, e.vy, e.vz); this.sfx("gun", Math.max(.2, 1 - Math.hypot(e.x - this.H.p.x, e.z - this.H.p.z) / 80)); break;
      case "ricochet": fx.sparks(e.x, e.y, e.z, 5, [1, .8, .4], .5); break;
      case "explode": fx.sparks(e.x, e.y, e.z, 40, [1, .55, .2], 2); fx.dust(e.x, e.y, e.z, 30, 2.2); this.rings.spawn(e.x, e.y, e.z, 9, 0xffa040, .6); this.cam.shake(.4); this.sfx("boom"); break;
      case "smash": fx.debris(e.x, e.y, e.z, 14, [.55, .45, .3]); this.sfx("thud", .8); break;
      case "shockwave": this.rings.spawn(e.x, e.y + .05, e.z, e.r * 1.4, 0xff3048, .7); fx.dust(e.x, e.y, e.z, 30, 2); this.cam.shake(.5); this.sfx("boom", .7); break;
      case "disarm": fx.sparks(e.x, e.y + .4, e.z, 10, [1, .85, .45], .7); if (e.from === this.meId()) { this.tricks.link("throw"); this.hud.center("DISARMED", "", .9, "small"); } this.sfx("snap"); break;
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
      case "hit": fx.sparks(d.e?.x ?? H.p.x + H.face.x * .5, (d.e?.y ?? H.p.y) + .35, d.e?.z ?? H.p.z + H.face.z * .5, d.heavy ? 12 : 5, d.heavy ? [1, .55, .2] : [1, .85, .55], d.heavy ? 1.1 : .55); if (d.a?.kind === "finisher") { this.rings.spawn(H.p.x, H.p.y - HIP_H + .1, H.p.z, 3.5, SUITS[this.suitId].glow, .3); fx.energy(H.p.x, H.p.y, H.p.z, 12, this.glowRGB()); } this.cam.shake(d.heavy ? .22 : .08); this.cam.punch(H.face.x * .12, 0, H.face.z * .12); if (H.state === "air") this.tricks.link("aircombo"); if (d.a?.kind === "finisher") this.tricks.link("finisher"); break;
      case "dodge": fx.energy(H.p.x, H.p.y, H.p.z, 6, this.glowRGB()); fx.puff(H.p.x, H.p.y - HIP_H * .5, H.p.z, 5); this.sfx("dash"); break;
      case "guard": this.sfx("whoosh", .6); break;
      case "parry": {
        const p = d.e ? _h2.set(d.e.x, d.e.y + .4, d.e.z).lerp(H.p, .5) : _h2.copy(H.p);
        fx.sparks(p.x, p.y, p.z, 22, [1, .9, .55], 1.3); this.rings.spawn(p.x, p.y, p.z, 2.5, 0xffffff, .3);
        this.hud.center("PARRY", "Counter now", .9, "small"); this.tricks.link("parry");
        this.sfx("punch", 1.3); this.sfx("perfect"); this.cam.shake(.2);
        break;
      }
      case "ability": this.hud.center(d.name.toUpperCase(), "", 1, "small"); this.tricks.link("ability"); if (d.id === "overcharge") { fx.energy(H.p.x, H.p.y, H.p.z, 40, this.glowRGB()); this.sfx("launch", 1.2); } if (d.id === "tether") this.cam.shake(.2); break;
      case "burst": {
        const y = H.p.y - HIP_H + .1;
        this.rings.spawn(H.p.x, y, H.p.z, 14, SUITS[this.suitId].glow, .7); this.rings.spawn(H.p.x, y + .6, H.p.z, 9, 0xffffff, .5);
        fx.energy(H.p.x, H.p.y, H.p.z, 60, this.glowRGB()); fx.dust(H.p.x, y, H.p.z, 40, 2.2);
        this.cam.shake(.6); this.sfx("boom", .8); this.sfx("launch", 1.4);
        break;
      }
      case "perfect": this.hud.center("PERFECT DODGE", "Counter now", .9, "small"); this.tricks.link("perfectdodge"); this.sfx("perfect"); break;
      case "dodged": break;
      case "hurt": this.rig.mat.userData.u.uHit.value = 1; fx.sparks(H.p.x, H.p.y + .5, H.p.z, d.heavy ? 16 : 8, [1, .2, .12], d.heavy ? 1.2 : .7); this.cam.shake(d.heavy ? .45 : .2); this.sfx("hurt", d.heavy ? 1.3 : 1); break;
      case "down": this.hud.center("DOWN", "Getting back up...", 3, "bail"); this.tricks.bail("KNOCKED DOWN"); this.sfx("hardland", 1); break;
      case "sense": this.sfx("sense", d.kind === "heavy" || d.kind === "slam" ? 1.4 : 1); break;
      case "line": this.lines.push({ side: d.side || 1, to: d.to, t: 0, life: d.yank ? .3 : .25 }); this.thwip(.8); break;
      case "gadget": this.thwip(1.1); this.shootAt = d.to; this.shootSide = d.side; this.shootFlash = .2; break;
      case "webhit": fx.puff(d.x, d.y, d.z, d.kind === "impact" ? 16 : 6); if (d.kind === "impact") { fx.sparks(d.x, d.y, d.z, 8, [1, .65, 1], .7); this.rings.spawn(d.x, d.y, d.z, 2.2, 0xffffff, .25); } this.sfx("webhit", d.kind === "impact" ? 1.3 : .7); break;
      case "bomb": fx.puff(d.x, d.y, d.z, 40); this.rings.spawn(d.x, d.y + .1, d.z, 7, 0xffffff, .5); this.sfx("bomb"); break;
      case "trapset": fx.energy(d.x, d.y, d.z, 10, this.glowRGB()); this.sfx("snap"); break;
      case "trap": fx.puff(d.x, d.y + .5, d.z, 18); this.sfx("webhit", 1.2); break;
      case "grab": this.thwip(1); break;
      case "throw": this.sfx("whoosh", 1.5); this.tricks.link("throw"); break;
        case "webstrike": fx.energy(H.p.x, H.p.y, H.p.z, 12, this.glowRGB()); fx.sparks(H.p.x, H.p.y, H.p.z, 8, [1, .65, 1], .7); this.tricks.link("webstrike"); this.cam.shake(.25); break;
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
  abilityBar() {
    const cb = this.combat;
    return ABILITIES.slice(1).map((A, i) => {
      const n = i + 1, c = cb.acool[n], fill = 1 - c / (A.cool * (cb.coolK || 1));
      const live = A.id === "overcharge" && cb.overT > 0;
      return `<span class="${c <= 0 ? "ready" : ""}${live ? " live" : ""}"><kbd>${A.key}</kbd><b>${A.name}</b><i style="--f:${Math.max(0, Math.min(1, fill)).toFixed(3)}"></i></span>`;
    }).join("");
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
const _cp = new V();
// how much XP each hero level takes
export const heroXpFor = (lvl) => 500 + (lvl - 1) * 250;
// an input with the player's hands off the controls
function idle(inp, out) { return Object.assign(out, inp, IDLE_INPUT); }
const _up = new V(), _fw = new V(), _t = new V(), _t2 = new V(), _h1 = new V(), _h2 = new V();
const _qa = new Q(), _qb = new Q(), _qe = new Q(), _qi = new Q(), _x = new V(1, 0, 0);

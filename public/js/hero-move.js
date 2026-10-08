// Hero mode: how the hero moves. One body, one state at a time - on the ground, in the air, swinging
// on one or two lines, zipping to a point, running or crawling on a wall or a ceiling, hanging from a
// ledge, perched, swimming - and the rules for getting from each one to the others. The lines are
// real ropes: they attach where a ray from the wrist actually hits something, they constrain the body
// to a sphere round the point they hit, they catch on corners on the way round, and gravity, momentum
// and the player's steering do the rest. Pure logic (three.js only for its vector maths), so it runs
// headless under Node for the movement tests.
import * as THREE from "three";

const V = THREE.Vector3;
export const TUNE = {
  g: 22, r: .42, hip: .98,
  walk: 4, run: 9.5, sprint: 15.5, sprintMax: 21, sprintRamp: 1.8,
  accel: 58, brake: 42, airAccel: 11, airMax: 14, airSteer: 1.5,
  jumpV: 9.8, superJumpV: 25, coyote: .13, stepUp: .55,
  drag: .0011, diveDrag: .00042, diveG: 17, maxFall: 85,
  swingMax: 46, swingPump: 9, swingSteer: 16, webRange: 110, webSpeed: 700, swingG: 24,
  releaseBoost: 4, swingJumpV: 8,
  wallRun: 16, wallCrawl: 4.2, wallAccel: 45,
  zipSpeed: 60, launchFwd: 26, launchUp: 15.5,
  glideG: 4.5, glideMin: 15, glideMax: 34,
  dash: 13,
};
const UP = new V(0, 1, 0);
const _a = new V(), _b = new V(), _c = new V(), _d = new V(), _e = new V(), _f = new V();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// a line from a wrist: shot, attached, then released
class Web {
  constructor(side, a, n, s, L) {
    this.side = side; this.a = a; this.n = n; this.s = s;        // anchor point, surface normal, solid
    this.pivots = [];                                              // corners it has caught on, in order
    this.L = L; this.L0 = L; this.t = 0; this.taut = false;
  }
  pivot() { return this.pivots.length ? this.pivots[this.pivots.length - 1] : this.a; }
}

export class HeroBody {
  constructor(world) {
    this.W = world;
    this.p = new V(); this.v = new V(); this.prevP = new V();
    this.state = "air"; this.stateT = 0;
    this.face = new V(0, 0, -1);        // horizontal facing
    this.n = new V(0, 0, 1);            // the surface normal while on a wall / ceiling
    this.webs = [];                     // attached lines
    this.shots = [];                    // lines in flight: { side, from, to, t, travel, then }
    this.zip = null; this.ledge = null; this.move = null;  // scripted moves: vault, mantle, climb
    this.events = [];
    this.res = { contacts: [] };
    this.reset(0, 2, 0);
  }
  reset(x, y, z) {
    this.p.set(x, y, z); this.prevP.copy(this.p); this.v.set(0, 0, 0);
    this.state = "air"; this.stateT = 0; this.airT = 0; this.groundY = 0; this.coyote = 0;
    this.webs.length = 0; this.shots.length = 0; this.zip = null; this.ledge = null; this.move = null;
    this.sprintT = 0; this.slideT = 0; this.crouchT = 0; this.landT = 9; this.hardT = 0; this.rollT = 0;
    this.dashUsed = false; this.glide = false; this.dive = false; this.diveT = 0;
    this.wallMode = "crawl"; this.wallT = 0; this.ceiling = false; this.lastSide = 1; this.noWebT = 0;
    this.launchWindow = 0; this.perchAt = null; this.jumpBuf = 0; this.grounded = false; this.skim = 0;
    this.speed = 0; this.height = 0; this.fallStart = y; this.lastWall = null; this.wallCool = 0; this.combatLock = 0;
    this.webCool = 0;
  }
  ev(type, o = {}) { o.type = type; this.events.push(o); return o; }
  setState(s) { if (s !== this.state) { this.prevState = this.state; this.state = s; this.stateT = 0; } }

  // ------------------------------------------------------------------ the frame
  // inp: { mx, mz (world move intent, 0..1), look (unit camera direction), jump, jumpHeld, sprint,
  //        swing (held), swingDown, swingUp, zip, crouch, crouchDown, dodge }
  step(dt, inp) {
    this.events.length = 0;
    this.prevP.copy(this.p);
    this.stateT += dt;
    this.webCool = Math.max(0, this.webCool - dt);
    this.wallCool = Math.max(0, this.wallCool - dt);
    this.noWebT = Math.max(0, this.noWebT - dt);
    this.combatLock = Math.max(0, this.combatLock - dt);
    this.jumpBuf = inp.jump ? .14 : Math.max(0, this.jumpBuf - dt);
    this.landT += dt; this.hardT = Math.max(0, this.hardT - dt); this.rollT = Math.max(0, this.rollT - dt);
    this.launchWindow = Math.max(0, this.launchWindow - dt);
    this.updateShots(dt, inp);
    if (this.move) return this.stepMove(dt, inp);
    switch (this.state) {
      case "ground": this.ground(dt, inp); break;
      case "air": this.air(dt, inp); break;
      case "swing": this.swing(dt, inp); break;
      case "zip": this.zipStep(dt, inp); break;
      case "wall": this.wall(dt, inp); break;
      case "ledge": this.ledgeStep(dt, inp); break;
      case "perch": this.perchStep(dt, inp); break;
      case "water": this.water(dt, inp); break;
    }
    this.keepInBounds();
    this.speed = this.v.length();
  }

  // ------------------------------------------------------------------ helpers
  moveDir(inp, out) {
    const m = Math.hypot(inp.mx, inp.mz);
    if (m < .08) return out.set(0, 0, 0);
    return out.set(inp.mx / Math.max(1, m), 0, inp.mz / Math.max(1, m));
  }
  turnFace(dx, dz, rate, dt) {
    const L = Math.hypot(dx, dz);
    if (L < 1e-3) return;
    const cur = Math.atan2(this.face.x, this.face.z), want = Math.atan2(dx, dz), d = wrapA(want - cur);
    const a = cur + clamp(d, -rate * dt, rate * dt);
    this.face.set(Math.sin(a), 0, Math.cos(a));
  }
  // integrate p with sub-steps and push out of everything solid; returns the contacts of the last sub-step
  integrate(dt, upper = true) {
    const dist = this.v.length() * dt, n = Math.min(10, Math.max(1, Math.ceil(dist / .28)));
    const h = dt / n, W = this.W, r = TUNE.r, C = this.contacts || (this.contacts = []);
    C.length = 0;
    for (let i = 0; i < n; i++) {
      this.p.addScaledVector(this.v, h);
      if (W.collide(this.p, r, this.res)) for (const c of this.res.contacts) this.contact(c, C);
      if (upper) {
        _a.set(this.p.x, this.p.y + .52, this.p.z);
        if (W.collide(_a, .3, this.res)) { this.p.x = _a.x; this.p.y = _a.y - .52; this.p.z = _a.z; for (const c of this.res.contacts) this.contact(c, C); }
      }
    }
    return C;
  }
  // a contact takes the velocity going into the surface away (and remembers the surface)
  contact(c, C) {
    const vn = this.v.x * c.nx + this.v.y * c.ny + this.v.z * c.nz;
    c.vn = vn;
    if (vn < 0) { this.v.x -= c.nx * vn; this.v.y -= c.ny * vn; this.v.z -= c.nz * vn; }
    if (C.length < 8) C.push({ nx: c.nx, ny: c.ny, nz: c.nz, s: c.s, vn });
  }
  feet() { return this.p.y - TUNE.hip; }
  floorBelow(reach = TUNE.stepUp) { return this.W.groundUnder(this.p.x, this.feet(), this.p.z, .22, reach); }
  // The floor to land on: the highest top that the feet are at or have passed this frame. Falling
  // fast, the feet can go through a roof's top between two checks; measuring from where they were
  // at the start of the frame still finds it.
  landFloor() { const f = Math.max(this.feet(), this.prevP.y - TUNE.hip); return this.W.groundUnder(this.p.x, f, this.p.z, .22, .06); }
  heightAbove() { return this.feet() - this.W.groundUnder(this.p.x, this.feet(), this.p.z, 0, .1); }
  keepInBounds() {
    const B = this.W.bound;
    if (Math.abs(this.p.x) > B) { this.p.x = Math.sign(this.p.x) * B; this.v.x *= -.3; this.ev("bound"); }
    if (Math.abs(this.p.z) > B) { this.p.z = Math.sign(this.p.z) * B; this.v.z *= -.3; this.ev("bound"); }
    if (this.p.y < -30) { this.reset(this.p.x, 40, this.p.z); this.ev("respawn"); }
    if (this.p.y > 900) { this.p.y = 900; this.v.y = Math.min(0, this.v.y); }
  }
  // the first wall among the contacts, if any
  wallContact(C) {
    let best = null;
    for (const c of C) if (Math.abs(c.ny) < .45 && c.s && c.s.kind !== "car" && c.s.kind !== "bench" && c.s.kind !== "edgewall" && (!best || c.vn < best.vn)) best = c;
    return best;
  }
  ceilContact(C) { for (const c of C) if (c.ny < -.7) return c; return null; }

  // ------------------------------------------------------------------ ground
  ground(dt, inp) {
    const T = TUNE, md = this.moveDir(inp, _d), m = Math.hypot(md.x, md.z);
    const hs = Math.hypot(this.v.x, this.v.z);
    const sprinting = inp.sprint && m > .1;
    this.sprintT = sprinting ? this.sprintT + dt : Math.max(0, this.sprintT - dt * 3);
    this.crouchT = inp.crouch ? this.crouchT + dt : 0;
    this.dashUsed = false; this.glide = false; this.dive = false;
    if (this.combatLock > 0) {
      // a punch, a lunge, a dodge: the fight moves the body; it slows on the ground by itself
      const k = Math.exp(-dt * 4);
      this.v.x *= k; this.v.z *= k;
    } else if (this.slideT > 0) {
      // sliding: little friction, a little steering, a jump out of it carries extra speed
      this.slideT -= dt;
      const k = Math.max(0, 1 - 5.5 * dt / Math.max(1, hs));
      this.v.x *= k; this.v.z *= k;
      if (m > .1 && hs > 1) { const a = Math.atan2(this.v.x, this.v.z), w = Math.atan2(md.x, md.z), d = clamp(wrapA(w - a), -1.4 * dt, 1.4 * dt); const s = Math.hypot(this.v.x, this.v.z); this.v.x = Math.sin(a + d) * s; this.v.z = Math.cos(a + d) * s; }
      if (!inp.crouch && this.slideT < .55 || hs < 3.5) this.slideT = 0;
      this.turnFace(this.v.x, this.v.z, 8, dt);
    } else {
      const target = m < .1 ? 0 : inp.crouch ? T.walk * .8 : sprinting ? T.sprint + (T.sprintMax - T.sprint) * Math.min(1, this.sprintT / T.sprintRamp) : T.run;
      let ax = md.x * target - this.v.x, az = md.z * target - this.v.z;
      const aL = Math.hypot(ax, az), braking = target < hs - .5 || (hs > 6 && md.x * this.v.x + md.z * this.v.z < 0);
      const lim = (braking ? T.brake : T.accel) * (this.hardT > 0 ? .25 : 1) * dt;
      if (aL > lim) { ax *= lim / aL; az *= lim / aL; }
      this.v.x += ax; this.v.z += az;
      if (m > .1) this.turnFace(md.x, md.z, hs > 12 ? 7 : 13, dt);
      if (inp.crouchDown && hs > 7) { this.slideT = 1.1; this.ev("slide"); }
    }
    this.v.y = 0;
    // jump (a crouch held first charges it into a super jump)
    if (this.jumpBuf > 0 && this.hardT <= 0) {
      this.jumpBuf = 0;
      const charge = Math.min(1, this.crouchT / .55);
      const vy = charge > .15 ? T.jumpV + (T.superJumpV - T.jumpV) * charge : T.jumpV + Math.min(3, hs * .12);
      this.v.y = vy;
      if (this.slideT > 0) { const s = Math.max(1, hs); this.v.x += this.v.x / s * 4; this.v.z += this.v.z / s * 4; this.slideT = 0; }
      this.toAir();
      this.ev("jump", { charge, big: charge > .5 });
      return;
    }
    if (this.tryWebOrZip(inp)) return;
    // parkour: vault low things, climb chest-high ones, run up anything taller when sprinting
    if (hs > 3.5 || sprinting) if (this.parkour(inp, sprinting, md)) return;
    const C = this.integrate(dt);
    const w = sprinting && hs > 5 ? this.wallContact(C) : null;
    if (w && this.wallCool <= 0 && -(w.nx * md.x + w.nz * md.z) > .5) { this.toWall(w, "run"); this.v.y = Math.max(this.v.y, 9); return; }
    // stay on the floor; walking off something is a fall (or, sprinting, a leap)
    const fy = this.floorBelow(T.stepUp), drop = this.feet() - fy;
    if (drop > .7) {
      if (sprinting && hs > 8 && drop > 2) { this.v.y = 6.5; this.v.x *= 1.08; this.v.z *= 1.08; this.toAir(); this.ev("leap"); return; }
      this.coyote = T.coyote; this.toAir(); return;
    }
    this.p.y += (fy + T.hip - this.p.y) * Math.min(1, dt * 25);
    if (Math.abs(fy + T.hip - this.p.y) < .02) this.p.y = fy + T.hip;
    this.groundY = fy;
    // a car roof, a train: it carries you along (and you can run on it)
    const S = this.W.underFoot;
    this.riding = S && S.dyn ? S : null;
    if (this.riding) { this.p.x += (S.vx || 0) * dt; this.p.z += (S.vz || 0) * dt; }
    this.checkWater();
  }
  toAir() { this.setState("air"); this.airT = 0; this.fallStart = this.p.y; this.grounded = false; }
  // what the player is running into: low (vault over), chest high (climb up), tall (wall run)
  parkour(inp, sprinting, md) {
    const W = this.W, f = this.face, hs = Math.hypot(this.v.x, this.v.z);
    const dx = hs > 1 ? this.v.x / hs : f.x, dz = hs > 1 ? this.v.z / hs : f.z;
    const reach = .55 + hs * .06, feet = this.feet();
    const hit = W.raycast(this.p.x, feet + .5, this.p.z, dx, 0, dz, reach + TUNE.r, 2, _hit);
    if (!hit || Math.abs(hit.ny) > .3) return false;
    // the top of whatever is in front, just past its face
    const px = hit.x + dx * .3, pz = hit.z + dz * .3, top = W.topAt(px, pz, feet + 3.2);
    const h = top - feet;
    if (h < .3) return false;
    if (h <= 1.6 && (sprinting || hs > 6.5)) {
      // vault: over it and down the far side, whatever is there (a roof edge's parapet means a leap)
      let depth = .4;
      for (; depth < 3; depth += .3) if (W.topAt(px + dx * depth, pz + dz * depth, top + .2) < top - .3) break;
      const ex = px + dx * (depth + .5), ez = pz + dz * (depth + .5), land = W.topAt(ex, ez, top + .5);
      const dur = clamp((depth + 1.2) / Math.max(6, hs), .22, .45);
      this.move = { kind: "vault", t: 0, dur, a: this.p.clone(), b: new V(ex, Math.max(land, top - 1.2) + TUNE.hip, ez), peak: top + TUNE.hip + .15, keep: this.v.clone(), drop: top - land > 2 };
      this.ev("vault", { h });
      return true;
    }
    if (h <= 2.6 && (sprinting || md.x * dx + md.z * dz > .7)) {
      this.move = { kind: "mantle", t: 0, dur: .32 + h * .06, a: this.p.clone(), b: new V(px + dx * .35, top + TUNE.hip, pz + dz * .35), peak: top + TUNE.hip + .1, keep: this.v.clone().multiplyScalar(sprinting ? .85 : .3) };
      this.ev("mantle", { h });
      return true;
    }
    return false;
  }
  // scripted moves: vault, mantle, ledge climb - an arc from a to b, peaking at `peak`
  stepMove(dt, inp) {
    const mv = this.move;
    mv.t += dt;
    const k = Math.min(1, mv.t / mv.dur), e = k * k * (3 - 2 * k);
    const x = mv.a.x + (mv.b.x - mv.a.x) * e, z = mv.a.z + (mv.b.z - mv.a.z) * e;
    const yUp = mv.a.y + (mv.peak - mv.a.y) * Math.min(1, k / .55), y = k < .55 ? yUp : mv.peak + (mv.b.y - mv.peak) * ((k - .55) / .45) ** 2;
    this.v.set((x - this.p.x) / dt, (y - this.p.y) / dt, (z - this.p.z) / dt);
    this.p.set(x, y, z);
    if (Math.hypot(mv.keep.x, mv.keep.z) > .5) this.turnFace(mv.keep.x, mv.keep.z, 10, dt);
    if (k >= 1) {
      this.move = null;
      this.v.set(mv.keep.x, 0, mv.keep.z);
      const drop = this.feet() - this.floorBelow(.3);
      if (mv.drop || drop > .7) { this.v.y = mv.kind === "vault" ? 4.5 : 0; this.toAir(); this.ev("leap"); }
      else { this.setState("ground"); this.grounded = true; }
    }
    this.speed = this.v.length();
  }

  // ------------------------------------------------------------------ air
  air(dt, inp) {
    const T = TUNE, md = this.moveDir(inp, _d), m = Math.hypot(md.x, md.z);
    this.airT += dt; this.coyote = Math.max(0, this.coyote - dt);
    if (this.p.y > this.fallStart) this.fallStart = this.p.y;
    if (this.jumpBuf > 0 && this.coyote > 0) { this.jumpBuf = 0; this.coyote = 0; this.v.y = T.jumpV; this.ev("jump", { charge: 0 }); }
    if (this.combatLock > 0) {
      // in the middle of an air attack: no steering, no dive or glide - the fight holds the body
      this.v.y -= TUNE.g * dt;
      const C = this.integrate(dt);
      if (this.v.y <= .5) { const fy = this.landFloor(); if (this.feet() <= fy + .03) { this.land(fy, inp); return; } }
      return;
    }
    if (this.tryWebOrZip(inp)) return;
    const hAbove = this.heightAbove();
    // dive: head first, heavier and slicker
    const wasDive = this.dive;
    this.dive = inp.crouch && this.airT > .12 && hAbove > 5 && !this.glide;
    if (this.dive && !wasDive) { this.diveT = 0; this.ev("dive"); }
    if (this.dive) this.diveT += dt;
    // web wings: hold jump while falling
    if (!this.glide && inp.jumpHeld && this.v.y < -4 && this.airT > .3 && hAbove > 6 && this.jumpBuf <= 0) { this.glide = true; this.ev("glide"); }
    if (this.glide && (!inp.jumpHeld || hAbove < 1.5)) this.glide = false;
    // air dash
    if (inp.dodge && !this.dashUsed && this.combatLock <= 0) {
      this.dashUsed = true;
      const dx = m > .1 ? md.x : inp.look.x, dz = m > .1 ? md.z : inp.look.z, L = Math.hypot(dx, dz) || 1;
      this.v.x += dx / L * T.dash; this.v.z += dz / L * T.dash; this.v.y = Math.max(this.v.y, 0) + 3;
      this.ev("airdash");
    }
    if (this.glide) this.glideStep(dt, inp, md);
    else {
      // steering: accelerate towards the stick and swing the heading round to it
      const hs = Math.hypot(this.v.x, this.v.z);
      if (m > .1) {
        const along = this.v.x * md.x + this.v.z * md.z;
        if (along < T.airMax) { this.v.x += md.x * T.airAccel * dt; this.v.z += md.z * T.airAccel * dt; }
        if (hs > 3) {
          const a = Math.atan2(this.v.x, this.v.z), w = Math.atan2(md.x, md.z), d = wrapA(w - a);
          if (Math.abs(d) < 2.5) {
            const rot = clamp(d, -1, 1) * T.airSteer * (this.dive ? 1.7 : 1) * dt * (1 + Math.min(1, hs / 30));
            const s = Math.hypot(this.v.x, this.v.z);
            this.v.x = Math.sin(a + rot) * s; this.v.z = Math.cos(a + rot) * s;
          } else { const k = Math.max(0, 1 - 6 * dt / Math.max(1, hs)); this.v.x *= k; this.v.z *= k; }
        }
      }
      let g = T.g + (this.dive ? T.diveG : 0);
      // pulling out of a dive: speed turns forward instead of down
      if (wasDive && !this.dive && this.v.y < -20 && m > .1) {
        const s = this.v.length(), hsn = Math.max(1, Math.hypot(this.v.x, this.v.z));
        this.v.set(this.v.x / hsn * s * .78, this.v.y * .35, this.v.z / hsn * s * .78);
        this.ev("pullup");
      }
      this.v.y -= g * dt;
      const k = this.dive ? T.diveDrag : T.drag, sp = this.v.length();
      this.v.multiplyScalar(Math.max(0, 1 - k * sp * dt));
      if (this.v.y < -T.maxFall) this.v.y = -T.maxFall;
    }
    if (this.v.x * this.v.x + this.v.z * this.v.z > .5) this.turnFace(this.v.x, this.v.z, this.dive ? 6 : 4, dt);
    const C = this.integrate(dt);
    if (this.airContacts(C, inp, dt)) return;
    this.checkLedge(inp);
    this.checkWater();
  }
  glideStep(dt, inp, md) {
    const T = TUNE, hs = Math.max(.1, Math.hypot(this.v.x, this.v.z));
    let hx = this.v.x / hs, hz = this.v.z / hs;
    // bank towards the stick
    const side = md.x * hz - md.z * hx;   // + is to the left
    const a = Math.atan2(hx, hz) + clamp(side, -1, 1) * 1.6 * dt;
    hx = Math.sin(a); hz = Math.cos(a);
    const pitch = -(md.x * hx + md.z * hz);   // pulling back climbs (and bleeds speed)
    let s = clamp(hs + (-pitch * 9 - 1.5) * dt, T.glideMin * .7, T.glideMax);
    this.v.x = hx * s; this.v.z = hz * s;
    const sink = T.glideG * (1.2 - Math.min(1, s / T.glideMax) * .6) + Math.max(0, -pitch) * -5;
    this.v.y += (-sink - this.v.y) * Math.min(1, dt * 2.5) + (pitch > 0 ? pitch * 6 * dt * Math.min(1, s / 20) : 0);
    if (s < T.glideMin * .75) this.v.y -= T.g * .5 * dt;
  }
  // what touching something in the air means: a floor is a landing, a wall is a wall run, a ceiling
  // under an overhang can be crawled
  airContacts(C, inp, dt) {
    const T = TUNE;
    const w = this.wallContact(C);
    if (w && this.wallCool <= 0 && !inp.crouch) { this.toWall(w, inp.sprint || this.speed > 9 ? "run" : "crawl"); return true; }
    const ce = this.ceilContact(C);
    if (ce && (inp.sprint || this.zip)) { this.toCeiling(ce); return true; }
    if (this.v.y <= .5) {
      const fy = this.landFloor();
      if (this.feet() <= fy + .03) { this.land(fy, inp); return true; }
    }
    return false;
  }
  land(fy, inp) {
    const T = TUNE, vy = this.v.y, hs = Math.hypot(this.v.x, this.v.z), fall = this.fallStart - this.p.y;
    this.p.y = fy + T.hip; this.groundY = fy;
    const md = this.moveDir(inp, _e), fwd = md.x * this.v.x + md.z * this.v.z > 0;
    let kind = "soft";
    if (vy < -15 && (inp.crouch || (fwd && hs > 7))) { kind = "roll"; this.rollT = .45; const k = .92; this.v.x *= k; this.v.z *= k; }
    else if (vy < -24 || (vy < -18 && fall > 20)) { kind = "hard"; this.hardT = .32; this.v.x *= .25; this.v.z *= .25; }
    else { const k = vy < -12 ? .8 : .95; this.v.x *= k; this.v.z *= k; }
    this.v.y = 0;
    this.webs.length = 0; this.glide = false; this.dive = false;
    this.setState("ground"); this.grounded = true; this.landT = 0;
    this.ev("land", { vy, kind, fall, hs });
  }

  // ------------------------------------------------------------------ webs: aiming and attaching
  tryWebOrZip(inp) {
    if (inp.zip && this.webCool <= 0) {
      const t = this.zipTarget(inp);
      if (t) { this.startZip(t); return true; }
      this.ev("nozip");
    }
    // Holding the swing button keeps swinging: past the top of each arc the next line goes out by itself.
    const chain = inp.swing && !this.shots.length && ((this.state === "air" && this.airT > .16 && this.v.y < 1.5) || (this.state === "ground" && this.stateT > .25));
    if ((inp.swingDown || chain) && this.webCool <= 0 && this.combatLock <= 0) {
      const ok = this.shootSwing(inp, !inp.swingDown);
      if (!ok) { this.webCool = chain ? .35 : .15; return false; }
      if (this.state === "ground") {
        // from the street: a hop up into the swing
        this.v.y = Math.max(this.v.y, 7); this.toAir(); this.ev("jump", { charge: 0, web: true });
        return true;
      }
    }
    return false;
  }
  // How much room there is to each side, along the way we're heading (the street we're swinging down):
  // distances to the walls on the left and right, measured at our height and a little ahead.
  corridor(fx, fz) {
    const W = this.W, p = this.p, rx = -fz, rz = fx, out = _hit3;
    let dl = 60, dr = 60;
    for (const ah of [0, 8]) {
      const ox = p.x + fx * ah, oz = p.z + fz * ah;
      const hl = W.raycast(ox, p.y, oz, -rx, 0, -rz, 60, 2, out); if (hl) dl = Math.min(dl, hl.t);
      const hr = W.raycast(ox, p.y, oz, rx, 0, rz, 60, 2, out); if (hr) dr = Math.min(dr, hr.t);
    }
    return { dl, dr, rx, rz, canyon: dl < 45 && dr < 45 };
  }
  // the way the player wants to go: the stick (camera relative), else the camera, blended with momentum
  travelDir(inp, out) {
    const hv = Math.hypot(this.v.x, this.v.z), md = this.moveDir(inp, _a);
    let fx = Math.hypot(md.x, md.z) > .1 ? md.x : inp.look.x, fz = Math.hypot(md.x, md.z) > .1 ? md.z : inp.look.z;
    let L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L;
    if (hv > 6) { const k = Math.min(.5, hv / 70); fx = fx * (1 - k) + this.v.x / hv * k; fz = fz * (1 - k) + this.v.z / hv * k; L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L; }
    out.x = fx; out.z = fz;
    return out;
  }
  // Where would a swing line go right now? The best-scoring point that a ray from the wrist actually
  // hits. Good anchors are high and well ahead, so the arc runs along the way we're going rather than
  // into the building the line is stuck to; in a street canyon the side with more room is preferred,
  // which swings us back towards the middle; and lines alternate hands.
  findAnchor(inp, avoidSide = 0, wantSide = 0, relaxed = false) {
    const T = TUNE, W = this.W, p = this.p;
    const hv = Math.hypot(this.v.x, this.v.z);
    const f = this.travelDir(inp, _tdir), fx = f.x, fz = f.z;
    const cor = this.corridor(fx, fz);
    const ground = this.W.groundUnder(p.x, p.y - T.hip, p.z, 0, .2);
    const idealD = 30 + Math.min(hv, 50) * .45;
    let best = null, bs = -Infinity;
    const out = _hit2;
    for (const az of relaxed ? AZ_WIDE : AZ) {
      const side = az < 0 ? -1 : az > 0 ? 1 : 0;
      if (avoidSide && side === avoidSide) continue;
      if (wantSide && side !== wantSide) continue;
      const c = Math.cos(az), s = Math.sin(az), dx = fx * c - fz * s, dz = fx * s + fz * c;   // turned by az (+ = to the right)
      for (const el of EL) {
        const ce = Math.cos(el), dirx = dx * ce, diry = Math.sin(el), dirz = dz * ce;
        const h = W.raycast(p.x, p.y + .9, p.z, dirx, diry, dirz, T.webRange, 1, out);
        if (!h || h.kind === "ground") continue;
        const up = h.y - p.y;
        if (up < (relaxed ? 3 : 5)) continue;
        const rx = h.x - p.x, rz = h.z - p.z, dist = h.t;
        const ahead = rx * fx + rz * fz, lat = rx * cor.rx + rz * cor.rz;   // + = to the right
        if (ahead < (relaxed ? -2 : 4)) continue;
        const low = h.y - dist * .95;
        const elev = Math.asin(Math.min(1, up / dist));
        let sc = 0;
        sc -= Math.abs(lat) / dist * 4.5;                          // a line out to the side swings us sideways
        sc -= Math.abs(elev - .82) * 1.3;                          // about 47 degrees up makes the best arc
        sc -= Math.abs(dist - idealD) * .045;                      // longer lines the faster we go
        if (low < ground + 1) sc -= (ground + 1 - low) * .07;       // it would scrape (the skim assist fixes most)
        // a good arc dips well below where we are and comes back up: one whose bottom is level with us
        // only carries us higher and higher
        const dip = p.y - Math.max(low, ground + 1.5);
        sc -= Math.abs(dip - clamp((p.y - ground) * .45, 4, 22)) * .045;
        if (h.kind === "tree" || h.kind === "lamphead" || h.kind === "mastarm") sc -= 1.4;
        const lside = lat < -1.5 ? -1 : lat > 1.5 ? 1 : 0;
        // in a canyon, the side with more room pulls us back towards the middle
        if (cor.canyon && lside) sc += clamp(((lside > 0 ? cor.dr : cor.dl) - (lside > 0 ? cor.dl : cor.dr)) / 12, -1, 1) * .9;
        // a wall we're about to run into is a bad thing to swing on
        if (lside && (lside > 0 ? cor.dr : cor.dl) < 4) sc -= 1.2;
        if (wantSide && lside === wantSide) sc += 1;
        else if (lside && lside === -this.lastSide) sc += .35;            // left hand, right hand
        if (sc > bs) { bs = sc; best = { x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz, s: h.s, dist, side: lside || side || -this.lastSide, low, ground, cor }; }
      }
    }
    if (!best && !relaxed && !avoidSide && !wantSide) return this.findAnchor(inp, 0, 0, true);
    return best;
  }
  shootSwing(inp, quiet = false) {
    const a = this.findAnchor(inp);
    if (!a) { if (!quiet) { this.noWebT = .5; this.ev("noweb"); } return false; }
    this.webCool = .12;
    this.lastSide = a.side;
    this.shots.push({ side: a.side, to: new V(a.x, a.y, a.z), n: new V(a.nx, a.ny, a.nz), s: a.s, t: 0, travel: Math.max(.03, a.dist / TUNE.webSpeed), kind: "swing", ground: a.ground });
    this.ev("shoot", { side: a.side, x: a.x, y: a.y, z: a.z, kind: "swing" });
    // a second line into the facing wall, in a street canyon at speed: a steadier, faster double swing
    if (this.speed > 16 && !this.webs.length && a.cor?.canyon) {
      const b = this.findAnchor(inp, a.side, -a.side);
      if (b && Math.abs(b.y - a.y) < 14 && b.dist > a.dist * .6 && b.dist < a.dist * 1.6 && Math.hypot(b.x - a.x, b.z - a.z) > 12) {
        this.shots.push({ side: b.side, to: new V(b.x, b.y, b.z), n: new V(b.nx, b.ny, b.nz), s: b.s, t: 0, travel: Math.max(.03, b.dist / TUNE.webSpeed), kind: "swing", ground: b.ground, second: true });
        this.ev("shoot", { side: b.side, x: b.x, y: b.y, z: b.z, kind: "swing", second: true });
      }
    }
    return true;
  }
  updateShots(dt, inp) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      if (s.t < s.travel) continue;
      this.shots.splice(i, 1);
      if (s.kind === "swing") {
        if (!inp.swing && !s.second) continue;       // let go before it arrived
        if (s.second && !this.webs.length && !this.shots.length) continue;
        this.attach(s);
      }
    }
  }
  attach(s) {
    const d = this.p.distanceTo(s.to);
    if (d < 3) return;
    if (this.state === "wall" || this.state === "ledge" || this.state === "perch" || this.state === "ground") {
      if (this.state === "wall") { this.v.addScaledVector(this.n, 5); this.wallCool = .35; }
      this.toAir();
    }
    if (this.state === "zip") { this.zip = null; this.toAir(); }
    const w = new Web(s.side, s.to.clone(), s.n.clone(), s.s, d * .97);
    w.ground = s.ground ?? 0;
    this.webs.push(w);
    if (this.webs.length > 2) this.webs.shift();
    this.setState("swing"); this.glide = false; this.dive = false;
    this.dashUsed = false;
    this.swingT = 0; this.skim = 0;
    this.ev("attach", { side: s.side, second: !!s.second, d });
  }
  releaseWebs(reason = "let go") {
    if (!this.webs.length) return;
    this.webs.length = 0;
    this.ev("release", { reason });
  }

  // ------------------------------------------------------------------ swinging
  swing(dt, inp) {
    const T = TUNE, md = this.moveDir(inp, _d), m = Math.hypot(md.x, md.z);
    this.swingT += dt;
    if (!inp.swing && !this.shots.length) return this.letGo(inp, false);
    if (inp.jump) return this.letGo(inp, true);
    if (inp.zip) { const t = this.zipTarget(inp); if (t) { this.releaseWebs("zip"); this.startZip(t); return; } }
    if (!this.webs.length) { this.toAir(); return; }
    // the rope after this frame's wrapping
    this.wrapWebs();
    if (!this.webs.length) { this.toAir(); return; }
    const w0 = this.webs[0], P = w0.pivot();
    // reel in a touch right after the catch: that tug is what makes each swing feel like it grabs
    if (this.swingT < .25) for (const w of this.webs) w.L = Math.max(4, w.L - w.L0 * .26 * dt);
    // ground skim: never let the bottom of the arc go into the street - shorten the line so it passes
    // just over it (lower still while diving)
    const skimH = inp.crouch ? .55 : 1.25;
    for (const w of this.webs) {
      const pv = w.pivot(), floor = Math.max(w.ground ?? 0, this.W.groundUnder(this.p.x, this.p.y - TUNE.hip, this.p.z, 0, .5));
      const maxL = pv.y - floor - TUNE.hip * .2 - skimH;
      if (w.L > maxL && maxL > 3) w.L = Math.max(maxL, w.L - 30 * dt);
    }
    // forces: gravity, pumping through the bottom, steering across the swing, a little drag
    const rx = this.p.x - P.x, ry = this.p.y - P.y, rz = this.p.z - P.z, rl = Math.hypot(rx, ry, rz) || 1;
    const nx = rx / rl, ny = ry / rl, nz = rz / rl;
    const vn = this.v.x * nx + this.v.y * ny + this.v.z * nz;
    let tx = this.v.x - nx * vn, ty = this.v.y - ny * vn, tz = this.v.z - nz * vn;
    const tl = Math.hypot(tx, ty, tz);
    if (tl > .5) { tx /= tl; ty /= tl; tz /= tl; } else { tx = this.face.x; ty = 0; tz = this.face.z; }
    this.v.y -= T.swingG * dt;
    // keep off the walls: a gentle pull towards the middle of the street we're swinging down, unless
    // the player is steering across it themselves
    if ((this.corT = (this.corT || 0) - dt) <= 0) {
      this.corT = .12;
      const hv = Math.hypot(this.v.x, this.v.z);
      this.cor = hv > 6 ? this.corridor(this.v.x / hv, this.v.z / hv) : null;
    }
    const cor = this.cor, latIn = cor ? md.x * cor.rx + md.z * cor.rz : 0;
    if (cor && cor.canyon && Math.abs(latIn) < .35) {
      // A line stuck to a wall at the side of the street pulls the arc across into that wall. The hero
      // leans out against it - most of the rope's sideways pull is cancelled - and drifts back towards
      // the middle of the street.
      let a = clamp((cor.dr - cor.dl) * .5 * .9, -8, 8);
      if (w0.taut) {
        const tension = T.swingG * Math.max(0, -ny) + (tl * tl) / Math.max(4, w0.L);
        a -= tension * (-(nx * cor.rx + nz * cor.rz)) * .8;
      }
      this.v.x += cor.rx * a * dt; this.v.z += cor.rz * a * dt;
    }
    if (m > .1) {
      const fwd = md.x * tx + md.z * tz;
      // below the anchor and heading forward: pump
      if (ny < -.15 && fwd > 0 && this.speed < T.swingMax) {
        const k = T.swingPump * fwd * (-ny) * dt;
        this.v.x += tx * k; this.v.y += ty * k; this.v.z += tz * k;
      }
      // steering: the part of the stick across the swing plane (horizontal) turns it
      let px = ny * tz - nz * ty, pz = nx * ty - ny * tx;   // (n x t) projected
      const pl = Math.hypot(px, pz);
      if (pl > .1) {
        px /= pl; pz /= pl;
        const lat = md.x * px + md.z * pz;
        this.v.x += px * lat * T.swingSteer * dt; this.v.z += pz * lat * T.swingSteer * dt;
      }
      if (fwd < -.5 && this.speed > 8) this.v.multiplyScalar(1 - .6 * dt);
    }
    const sp = this.v.length();
    this.v.multiplyScalar(Math.max(0, 1 - T.drag * .6 * sp * dt));
    // integrate, then hold the body on the rope's sphere (one or two ropes)
    const C = this.integrate(dt);
    for (let it = 0; it < (this.webs.length > 1 ? 3 : 1); it++) for (const w of this.webs) this.constrain(w);
    if (this.webs.length > 1) this.v.multiplyScalar(1 + .25 * dt);   // the double line slings you on
    if (this.speed > T.swingMax * 1.15) this.v.multiplyScalar(1 - .8 * dt);
    if (this.v.x * this.v.x + this.v.z * this.v.z > 1) this.turnFace(this.v.x, this.v.z, 6, dt);
    // touching things: a wall is a wall run, the street at speed is a skim, slow is a landing
    const wc = this.wallContact(C);
    if (wc && this.wallCool <= 0 && Math.abs(wc.vn) > 2) { this.releaseWebs("wall"); this.toWall(wc, "run"); return; }
    const fy = this.landFloor();
    if (this.feet() <= fy + .05 && this.v.y <= .5) {
      const hs = Math.hypot(this.v.x, this.v.z);
      if (hs > 11) { this.p.y = fy + TUNE.hip; this.v.y = Math.max(this.v.y, 0); if (!this.skim) this.ev("skim"); this.skim = .2; }
      else { this.releaseWebs("ground"); this.land(fy, inp); return; }
    } else this.skim = Math.max(0, this.skim - dt);
    // swung up level with the anchor: the line goes slack
    if (this.p.y > P.y - .5 && this.v.y > 0 && this.swingT > .3) return this.letGo(inp, false, true);
    // Holding on: out past the anchor, at the top of the arc, let go - the next line goes out by itself
    // as we start to fall (see tryWebOrZip). That's what keeps a held swing flowing forward instead of
    // swinging back and forth on one line.
    const P2 = this.webs[0].pivot(), ox = this.p.x - P2.x, oz = this.p.z - P2.z;
    const oh = Math.hypot(ox, oz), rlen = Math.max(1, this.p.distanceTo(P2));
    if (this.swingT > .45 && ox * this.v.x + oz * this.v.z > 0 && (oh / rlen > .66 && this.v.y > 0 || oh / rlen > .5 && this.v.y < .6)) return this.letGo(inp, false, true);
    this.checkWater();
  }
  constrain(w) {
    const P = w.pivot(), dx = this.p.x - P.x, dy = this.p.y - P.y, dz = this.p.z - P.z, d = Math.hypot(dx, dy, dz);
    w.taut = d >= w.L - .05;
    if (d <= w.L || d < 1e-6) return;
    const nx = dx / d, ny = dy / d, nz = dz / d;
    this.p.set(P.x + nx * w.L, P.y + ny * w.L, P.z + nz * w.L);
    const vr = this.v.x * nx + this.v.y * ny + this.v.z * nz;
    if (vr > 0) { this.v.x -= nx * vr; this.v.y -= ny * vr; this.v.z -= nz * vr; }
  }
  // the rope catches on whatever comes between the body and its pivot (a corner on the way round),
  // and lets go of the corner again when the body swings back past it
  wrapWebs() {
    const W = this.W;
    for (let i = this.webs.length - 1; i >= 0; i--) {
      const w = this.webs[i], P = w.pivot();
      if (!W.clear(this.p.x, this.p.y, this.p.z, P.x, P.y, P.z, 2, .4)) {
        // search between last frame's (clear) position and this one for the grazing line
        let lo = 0, hi = 1, hit = null;
        for (let k = 0; k < 7; k++) {
          const t = (lo + hi) / 2;
          _b.lerpVectors(this.prevP, this.p, t);
          const dx = P.x - _b.x, dy = P.y - _b.y, dz = P.z - _b.z, L = Math.hypot(dx, dy, dz);
          const h = W.raycast(_b.x, _b.y, _b.z, dx, dy, dz, L - .4, 2, _hit3);
          if (h) { hi = t; hit = { x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz }; } else lo = t;
        }
        if (!hit) { _b.copy(this.prevP); const h = W.raycast(this.p.x, this.p.y, this.p.z, P.x - this.p.x, P.y - this.p.y, P.z - this.p.z, this.p.distanceTo(P) - .4, 2, _hit3); if (h) hit = { x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz }; }
        if (!hit || w.pivots.length >= 4) { this.webs.splice(i, 1); this.ev("snap"); continue; }
        const np = new V(hit.x + hit.nx * .12, hit.y + hit.ny * .12, hit.z + hit.nz * .12);
        const seg = np.distanceTo(P);
        if (w.L - seg < 2.5) { this.webs.splice(i, 1); this.ev("snap"); continue; }
        np.side = Math.sign((this.p.x - P.x) * (np.z - P.z) - (this.p.z - P.z) * (np.x - P.x)) || 1;
        w.pivots.push(np); w.L -= seg;
        this.ev("wrap", { x: np.x, y: np.y, z: np.z });
      } else if (w.pivots.length) {
        // unwrap: the line to the pivot before this one is clear again, and we're back on its side
        const cur = w.pivots[w.pivots.length - 1], prev = w.pivots.length > 1 ? w.pivots[w.pivots.length - 2] : w.a;
        const side = Math.sign((this.p.x - prev.x) * (cur.z - prev.z) - (this.p.z - prev.z) * (cur.x - prev.x)) || 1;
        if (side !== cur.side && W.clear(this.p.x, this.p.y, this.p.z, prev.x, prev.y, prev.z, 2, .5)) {
          w.pivots.pop(); w.L += cur.distanceTo(prev);
        }
      }
    }
  }
  // letting go: momentum carries on; timing it on the up-swing adds a kick, and jump adds a big one
  letGo(inp, jump, slack = false) {
    const T = TUNE, P = this.webs[0]?.pivot();
    let quality = 0;
    if (P) {
      const rx = this.p.x - P.x, ry = this.p.y - P.y, rz = this.p.z - P.z, rl = Math.hypot(rx, ry, rz) || 1;
      const ang = Math.acos(clamp(-ry / rl, -1, 1));           // 0 = hanging straight down
      const away = (rx * this.v.x + rz * this.v.z) > 0;          // swinging out past the anchor
      if (this.v.y > 0 && away && ang > .45 && ang < 1.45) quality = ang > .75 && ang < 1.25 && this.speed > 22 ? 2 : 1;
    }
    this.releaseWebs(jump ? "jump" : slack ? "slack" : "let go");
    this.toAir();
    const hs = Math.max(.1, Math.hypot(this.v.x, this.v.z));
    if (quality) {
      const k = quality === 2 ? .12 : .06;
      this.v.x *= 1 + k; this.v.z *= 1 + k; this.v.y += quality === 2 ? 4 : 2.5;
    }
    if (jump) {
      this.v.y = Math.max(this.v.y, 0) + T.swingJumpV;
      this.v.x += this.v.x / hs * 3.5; this.v.z += this.v.z / hs * 3.5;
    }
    this.ev("letgo", { quality, jump, speed: this.v.length() });
  }

  // ------------------------------------------------------------------ zip / point launch
  // what E zips to: a perch (roof corner, ledge, pole, lamp) near the aim, else whatever surface the aim hits
  zipTarget(inp) {
    const W = this.W, cam = inp.camPos || this.p, L = inp.look;
    // a vehicle under the aim (they move, so they're checked first)
    let bestV = null, bv = .14;
    for (const s of W.dyn) {
      if (s.kind !== "vehicle" && s.kind !== "train") continue;
      const cx = s.cx ?? (s.x0 + s.x1) / 2, cz = s.cz ?? (s.z0 + s.z1) / 2, vx = cx - cam.x, vy = s.y1 - cam.y, vz = cz - cam.z, vd = Math.hypot(vx, vy, vz);
      if (vd < 4 || vd > 80) continue;
      const ang = Math.acos(Math.min(1, (vx * L.x + vy * L.y + vz * L.z) / vd));
      if (ang < bv) { bv = ang; bestV = s; }
    }
    if (bestV) return { x: bestV.cx ?? (bestV.x0 + bestV.x1) / 2, y: bestV.y1, z: bestV.cz ?? (bestV.z0 + bestV.z1) / 2, nx: 0, nz: 0, kind: "top", dyn: bestV };
    const pr = W.perchNear(cam.x, cam.y, cam.z, L.x, L.y, L.z, 95, .16, this.p, this.perchAt);
    if (pr) return { x: pr.x, y: pr.y, z: pr.z, nx: pr.nx, nz: pr.nz, kind: "perch", perch: pr };
    const h = W.raycast(cam.x, cam.y, cam.z, L.x, L.y, L.z, 95, 2, _hit2);
    if (!h || this.p.distanceTo(_c.set(h.x, h.y, h.z)) < 4) return null;
    if (!W.clear(this.p.x, this.p.y + .5, this.p.z, h.x, h.y, h.z, 2, 1.2)) return null;
    if (h.ny > .7) return { x: h.x, y: h.y, z: h.z, nx: 0, nz: 0, kind: "top" };
    if (Math.abs(h.ny) < .5) return { x: h.x + h.nx * (TUNE.r + .05), y: h.y, z: h.z + h.nz * (TUNE.r + .05), nx: h.nx, ny: h.ny, nz: h.nz, kind: "wall", s: h.s };
    return null;
  }
  startZip(t) {
    this.releaseWebs("zip");
    this.webCool = .2;
    const d = Math.hypot(t.x - this.p.x, t.y - this.p.y, t.z - this.p.z);
    this.zip = { ...t, t: 0, travel: Math.max(.03, d / 950), d0: d, sp: Math.max(this.speed, 18) };
    this.setState("zip");
    this.perchAt = null;
    this.ev("shoot", { side: this.lastSide = -this.lastSide, x: t.x, y: t.y, z: t.z, kind: "zip" });
  }
  zipStep(dt, inp) {
    const z = this.zip, T = TUNE;
    if (!z) return this.toAir();
    z.t += dt;
    if (z.t < z.travel) { this.v.y -= T.g * dt * .5; this.integrate(dt); return; }    // line still on its way
    if (z.t - dt < z.travel) this.ev("zipgo");
    // cancels: jump, a swing, a trick (handled by the caller) all keep the momentum
    if (inp.jump && z.t > z.travel + .06) {
      const near = Math.hypot(z.x - this.p.x, z.y - this.p.y, z.z - this.p.z);
      if (near > 3) { this.zip = null; this.toAir(); this.v.multiplyScalar(.85); this.v.y += 6; this.ev("zipjump"); return; }
      this.launchWindow = .3;   // pressed just before arriving: launch on arrival
    }
    if (inp.swingDown) { const ok = this.shootSwing(inp); if (ok) { this.zip = null; this.toAir(); return; } }
    // pull towards the point, coming in over the top of a perch
    if (z.dyn) { const c = z.dyn; z.x = c.cx ?? (c.x0 + c.x1) / 2; z.z = c.cz ?? (c.z0 + c.z1) / 2; z.y = c.y1; }
    const over = z.kind === "perch" || z.kind === "top" ? 1.4 : 0;
    const tx = z.x, ty = z.y + over + (z.kind === "perch" || z.kind === "top" ? TUNE.hip * .6 : 0), tz = z.z;
    let dx = tx - this.p.x, dy = ty - this.p.y, dz = tz - this.p.z;
    const d = Math.hypot(dx, dy, dz);
    z.sp = Math.min(T.zipSpeed, z.sp + 140 * dt);
    const s = Math.min(z.sp, d / Math.max(dt, .016) * .9 + 2);
    dx /= d || 1; dy /= d || 1; dz /= d || 1;
    const k = 1 - Math.exp(-dt * 14);
    this.v.x += (dx * s - this.v.x) * k; this.v.y += (dy * s - this.v.y) * k; this.v.z += (dz * s - this.v.z) * k;
    this.turnFace(dx, dz, 12, dt);
    this.p.addScaledVector(this.v, dt);
    if (this.W.collide(this.p, TUNE.r * .8, this.res) && d > 2.5) {
      const c = this.res.contacts[0];
      if (Math.abs(c.ny) < .5 && z.kind !== "wall") { this.zip = null; this.toWall({ nx: c.nx, ny: c.ny, nz: c.nz, s: c.s, vn: -5 }, "crawl"); return; }
    }
    if (d < Math.max(.9, s * dt * 1.6) || z.t > z.travel + 3) this.arriveZip(inp);
  }
  arriveZip(inp) {
    const z = this.zip, T = TUNE;
    this.zip = null;
    const launch = this.jumpBuf > 0 || this.launchWindow > 0 || inp.jumpHeld && inp.sprint;
    if (z.kind === "wall") { this.v.set(0, 0, 0); this.toWall({ nx: z.nx, ny: z.ny || 0, nz: z.nz, s: z.s, vn: -1 }, "crawl"); return; }
    const top = this.W.topAt(z.x, z.z, z.y + 1.5);
    this.p.set(z.x, Math.max(top, z.y) + T.hip * .75, z.z);
    if (launch) return this.pointLaunch();
    this.v.set(0, 0, 0);
    this.perchAt = z.perch || null;
    this.setState(z.kind === "top" ? "ground" : "perch");
    this.launchWindow = .32;
    this.ev("perch", { kind: z.perch?.kind || "top" });
  }
  pointLaunch() {
    const T = TUNE, f = this.face;
    this.v.set(f.x * T.launchFwd, T.launchUp, f.z * T.launchFwd);
    this.perchAt = null; this.jumpBuf = 0; this.launchWindow = 0;
    this.toAir(); this.dashUsed = false;
    this.ev("launch");
  }
  perchStep(dt, inp) {
    const md = this.moveDir(inp, _d), m = Math.hypot(md.x, md.z);
    this.v.set(0, 0, 0);
    if (m > .1) this.turnFace(md.x, md.z, 6, dt);
    else this.turnFace(inp.look.x, inp.look.z, 3, dt);
    if (this.jumpBuf > 0) { this.jumpBuf = 0; return this.launchWindow > 0 || inp.sprint ? this.pointLaunch() : (this.v.set(this.face.x * 6, TUNE.jumpV, this.face.z * 6), this.toAir(), this.ev("jump", { charge: 0 })); }
    if (this.tryWebOrZip(inp)) return;
    if (m > .1 && this.stateT > .25) { this.v.set(md.x * 5, 3, md.z * 5); this.toAir(); this.perchAt = null; this.ev("stepoff"); }
    if (inp.crouchDown) { this.v.set(0, -2, 0); this.toAir(); this.perchAt = null; }
  }

  // ------------------------------------------------------------------ walls and ceilings
  toWall(c, mode) {
    const n = this.n.set(c.nx, this.ceiling ? c.ny : 0, c.nz);
    if (n.lengthSq() < 1e-4) return;
    n.normalize();
    this.ceiling = false;
    this.wallSolid = c.s;
    const vn = this.v.dot(n);
    this.v.addScaledVector(n, -vn);
    // momentum along the wall carries into the run; a straight-on hit turns into running up it
    if (mode === "run" && -vn > 4) this.v.y = Math.max(this.v.y, Math.min(14, -vn * .6));
    this.wallMode = mode;
    this.webs.length = 0; this.glide = false; this.dive = false; this.dashUsed = false;
    this.setState("wall"); this.wallT = 0;
    this.snapWall(1.5);
    this.ev("wall", { mode, speed: this.v.length() });
  }
  toCeiling(c) {
    this.n.set(0, -1, 0);
    this.ceiling = true;
    this.v.y = 0;
    this.webs.length = 0; this.glide = false; this.dive = false;
    this.setState("wall"); this.wallT = 0; this.wallMode = "crawl";
    this.ev("ceiling");
  }
  // find the wall behind us again (it may have turned a little: a curved tower, a ramp's side)
  snapWall(reach = .9) {
    const n = this.n, W = this.W;
    const h = W.raycast(this.p.x + n.x * .2, this.p.y + n.y * .2, this.p.z + n.z * .2, -n.x, -n.y, -n.z, reach + .2 + TUNE.r, 2, _hit3);
    if (!h) return false;
    if (this.ceiling ? h.ny > -.7 : Math.abs(h.ny) > .5) return false;
    n.set(h.nx, this.ceiling ? h.ny : 0, h.nz).normalize();
    this.p.set(h.x + n.x * (TUNE.r + .02), h.y + n.y * (TUNE.r + .02), h.z + n.z * (TUNE.r + .02));
    this.wallSolid = h.s;
    return true;
  }
  wall(dt, inp) {
    const T = TUNE, n = this.n, md = this.moveDir(inp, _d), m = Math.hypot(md.x, md.z);
    this.wallT += dt;
    // the swing button held on a wall runs it, like sprint: a swing into a building carries on as a run
    const run = inp.sprint || inp.swing;
    this.wallMode = run ? "run" : "crawl";
    // the wall's own axes: up it, and along it to the right as you face it
    let ux, uy, uz, rx, ry, rz;
    if (this.ceiling) { ux = inp.look.x; uy = 0; uz = inp.look.z; const l = Math.hypot(ux, uz) || 1; ux /= l; uz /= l; rx = -uz; ry = 0; rz = ux; }
    else { ux = 0; uy = 1; uz = 0; rx = -n.z; ry = 0; rz = n.x; }   // right = up x n
    // the stick: into the wall means up it, along the wall means along it
    let inR, inU;
    if (this.ceiling) { inR = md.x * rx + md.z * rz; inU = md.x * ux + md.z * uz; }
    else {
      inR = md.x * rx + md.z * rz; inU = -(md.x * n.x + md.z * n.z);
      if (m > .1 && inp.look.y > .55 && inU > -.3) inU = Math.max(inU, .8);      // looking up the wall
      if (m > .1 && inp.look.y < -.6 && inU < .3) inU = Math.min(inU, -.8);      // looking down it
    }
    const il = Math.hypot(inR, inU);
    const spd = (run ? T.wallRun : T.wallCrawl) * Math.min(1, m);
    const tR = il > .05 ? inR / il * spd : 0, tU = il > .05 ? inU / il * spd : 0;
    const want = _e.set(rx * tR + ux * tU, ry * tR + uy * tU, rz * tR + uz * tU);
    // keep the momentum we arrived with while running, settle to the stick's speed
    const acc = (run ? T.wallAccel * (this.wallT < .35 && this.v.length() > spd ? .25 : 1) : 30) * dt;
    _f.subVectors(want, this.v); const fl = _f.length();
    if (fl > acc) _f.multiplyScalar(acc / fl);
    this.v.add(_f);
    // a run with no stick bleeds into a slow slide down; a crawl just holds on
    if (run && il < .05 && !this.ceiling) this.v.y -= 6 * dt;
    this.v.addScaledVector(n, -this.v.dot(n));
    // jump off: away from the wall, up, and towards where the camera points
    if (this.jumpBuf > 0) {
      this.jumpBuf = 0;
      if (this.ceiling) { this.v.set(this.v.x, -4, this.v.z); this.ceiling = false; this.toAir(); this.wallCool = .3; this.ev("drop"); return; }
      const lx = inp.look.x - n.x * (inp.look.x * n.x + inp.look.z * n.z), lz = inp.look.z - n.z * (inp.look.x * n.x + inp.look.z * n.z);
      this.v.set(n.x * 10.5 + lx * 7 + this.v.x * .4, 9.5 + Math.max(0, this.v.y * .45), n.z * 10.5 + lz * 7 + this.v.z * .4);
      this.toAir(); this.wallCool = .28; this.lastWall = this.wallSolid;
      this.face.set(this.v.x, 0, this.v.z).normalize();
      this.ev("walljump");
      return;
    }
    if (inp.crouchDown) { this.v.addScaledVector(n, 3); this.ceiling = false; this.toAir(); this.wallCool = .4; this.ev("drop"); return; }
    if (inp.swingDown && this.webCool <= 0) { if (this.shootSwing(inp)) return; }
    if (inp.zip && this.webCool <= 0) { const t = this.zipTarget(inp); if (t) { this.startZip(t); return; } }
    this.p.addScaledVector(this.v, dt);
    const along = this.v.x * rx + this.v.z * rz;
    if (Math.abs(along) > .5 && !this.ceiling) this.face.set(rx * Math.sign(along), 0, rz * Math.sign(along));
    else if (!this.ceiling) this.face.set(-n.x, 0, -n.z);
    // something in the way along the wall (an inside corner): turn onto it
    if (this.W.collide(this.p, T.r * .9, this.res)) for (const c of this.res.contacts) {
      if (!this.ceiling && Math.abs(c.ny) < .45 && c.nx * n.x + c.nz * n.z < .5) {
        // an inside corner: carry on along the new wall, away from the old one (along the old normal)
        const sp = Math.hypot(this.v.x, this.v.z), ox = n.x, oz = n.z;
        n.set(c.nx, 0, c.nz).normalize();
        let wx = ox - n.x * (ox * n.x + oz * n.z), wz = oz - n.z * (ox * n.x + oz * n.z);
        const wl = Math.hypot(wx, wz) || 1;
        wx /= wl; wz /= wl;
        if (Math.abs(along) > 1.5) { this.v.x = wx * sp; this.v.z = wz * sp; }
        this.ev("corner", { inside: true });
        break;
      }
      if (c.ny > .7 && this.v.y < 0 && !this.ceiling) { const fy = this.floorBelow(.1); this.land(fy, inp); return; }
      if (!this.ceiling && c.ny < -.7 && run) { this.toCeiling(c); return; }
    }
    // at the top: over onto the roof (sprinting into it launches you off the lip instead)
    if (!this.ceiling && this.v.y > .5) {
      const hy = this.W.raycast(this.p.x + n.x * .3, this.p.y + .9, this.p.z + n.z * .3, -n.x, 0, -n.z, 1.4, 2, _hit3);
      if (!hy) {
        const top = this.W.topAt(this.p.x - n.x * .9, this.p.z - n.z * .9, this.p.y + 1.8);
        if (top > this.p.y - 1.5) {
          if (run && (this.v.y > 9 || inp.jumpHeld)) {
            this.p.y = Math.max(this.p.y, top + T.hip);
            this.v.set(-n.x * 5 + this.v.x * .5, Math.min(17, 8 + this.v.y * .55), -n.z * 5 + this.v.z * .5);
            this.toAir(); this.wallCool = .3; this.ev("rooflaunch"); return;
          }
          this.move = { kind: "climb", t: 0, dur: .3, a: this.p.clone(), b: new V(this.p.x - n.x * 1.1, top + T.hip, this.p.z - n.z * 1.1), peak: top + T.hip + .25, keep: new V(-n.x * (run ? 7 : 2), 0, -n.z * (run ? 7 : 2)) };
          this.face.set(-n.x, 0, -n.z);
          this.ev("climb");
          return;
        }
      }
    }
    // hold onto the surface; if it has gone (the corner of a building), try round the corner, else let go
    if (!this.snapWall()) {
      if (!this.ceiling && Math.abs(along) > 2) {
        const dir = Math.sign(along), ax = rx * dir, az = rz * dir;
        // from just past the corner, look back at the building for the face round the corner
        const ox = this.p.x + ax * .6 - n.x * (T.r + .6), oz = this.p.z + az * .6 - n.z * (T.r + .6);
        const h = this.W.raycast(ox + ax * 1.2, this.p.y, oz + az * 1.2, -ax, 0, -az, 2.5, 2, _hit3);
        if (h && Math.abs(h.ny) < .4 && h.nx * ax + h.nz * az > .7) {
          // an outside corner: round onto the next face, still running - the way on is the old face's
          // inward normal (round the back of the building)
          const sp = Math.hypot(this.v.x, this.v.z), ox = n.x, oz = n.z;
          n.set(h.nx, 0, h.nz).normalize();
          this.p.set(h.x + n.x * (T.r + .02), this.p.y, h.z + n.z * (T.r + .02));
          this.v.x = -ox * sp * .95; this.v.z = -oz * sp * .95;
          this.ev("corner", { inside: false });
          return;
        }
      }
      this.ceiling = false;
      this.v.addScaledVector(n, 2);
      this.toAir(); this.wallCool = .25; this.ev("offwall");
      return;
    }
    // reached the street going down
    if (!this.ceiling && this.v.y <= 0) {
      const fy = this.floorBelow(.05);
      if (this.feet() <= fy + .1) { this.p.y = fy + T.hip; this.p.addScaledVector(n, .2); this.land(fy, inp); }
    }
  }

  // ------------------------------------------------------------------ ledges
  checkLedge(inp) {
    if (this.v.y > 1.5 || this.wallCool > 0 || inp.crouch) return;
    const W = this.W, f = this.face;
    // something solid at chest height in front, and a top surface just above the hands
    const h = W.raycast(this.p.x, this.p.y + .35, this.p.z, f.x, 0, f.z, TUNE.r + .5, 2, _hit3);
    if (!h || Math.abs(h.ny) > .3) return;
    const nx = h.nx, nz = h.nz;
    const top = W.topAt(h.x - nx * .35, h.z - nz * .35, this.p.y + 1.25);
    if (top < this.p.y + .45 || top > this.p.y + 1.25) return;
    // room to climb into
    if (!W.clear(h.x - nx * .3, top + .3, h.z - nz * .3, h.x - nx * .3, top + 1.6, h.z - nz * .3, 2, 0)) return;
    if (inp.sprint) {
      this.move = { kind: "climb", t: 0, dur: .28, a: this.p.clone(), b: new V(h.x - nx * .8, top + TUNE.hip, h.z - nz * .8), peak: top + TUNE.hip + .2, keep: new V(-nx * 6, 0, -nz * 6) };
      this.ev("climb"); return;
    }
    this.ledge = { top, nx, nz };
    this.n.set(nx, 0, nz);
    this.p.set(h.x + nx * (TUNE.r + .05), top - .85, h.z + nz * (TUNE.r + .05));
    this.v.set(0, 0, 0);
    this.face.set(-nx, 0, -nz);
    this.setState("ledge");
    this.ev("ledge");
  }
  ledgeStep(dt, inp) {
    const L = this.ledge, md = this.moveDir(inp, _d), m = Math.hypot(md.x, md.z), T = TUNE;
    if (!L) return this.toAir();
    const rx = -L.nz, rz = L.nx;
    const inU = -(md.x * L.nx + md.z * L.nz), inR = md.x * rx + md.z * rz;
    if (this.jumpBuf > 0 || (m > .1 && inU > .6 && this.stateT > .15)) {
      this.jumpBuf = 0;
      this.move = { kind: "climb", t: 0, dur: .34, a: this.p.clone(), b: new V(this.p.x - L.nx * 1.1, L.top + T.hip, this.p.z - L.nz * 1.1), peak: L.top + T.hip + .25, keep: new V(-L.nx * 3, 0, -L.nz * 3) };
      this.ledge = null; this.ev("climb"); return;
    }
    if (inp.crouchDown || (m > .1 && inU < -.6)) { this.ledge = null; this.v.set(L.nx * 2, -1, L.nz * 2); this.toAir(); this.wallCool = .35; return; }
    if (this.tryWebOrZip(inp)) { this.ledge = null; return; }
    // shimmy along the edge while there is one
    if (Math.abs(inR) > .3) {
      const s = Math.sign(inR) * 2.2 * dt, nxp = this.p.x + rx * s, nzp = this.p.z + rz * s;
      const top = this.W.topAt(nxp - L.nx * (T.r + .4), nzp - L.nz * (T.r + .4), L.top + .3);
      if (Math.abs(top - L.top) < .3) { this.p.x = nxp; this.p.z = nzp; this.v.set(rx * Math.sign(inR) * 2.2, 0, rz * Math.sign(inR) * 2.2); }
      else this.v.set(0, 0, 0);
    } else this.v.set(0, 0, 0);
  }

  // ------------------------------------------------------------------ water
  checkWater() {
    const wy = this.W.waterAt(this.p.x, this.p.z);
    if (wy > -Infinity && this.p.y < wy + .3 && this.state !== "water") { this.webs.length = 0; this.setState("water"); this.v.multiplyScalar(.3); this.ev("splash", { y: wy }); }
  }
  water(dt, inp) {
    const md = this.moveDir(inp, _d), wy = this.W.waterAt(this.p.x, this.p.z);
    if (wy === -Infinity) { this.toAir(); return; }
    this.v.x += (md.x * 3.2 - this.v.x) * Math.min(1, dt * 3); this.v.z += (md.z * 3.2 - this.v.z) * Math.min(1, dt * 3);
    this.v.y += ((wy + .1 - this.p.y) * 6 - this.v.y) * Math.min(1, dt * 4);
    if (Math.hypot(md.x, md.z) > .1) this.turnFace(md.x, md.z, 5, dt);
    if (this.jumpBuf > 0) { this.jumpBuf = 0; this.v.y = 11; this.p.y = wy + .5; this.toAir(); this.ev("jump", { charge: 0 }); return; }
    if (this.tryWebOrZip(inp)) return;
    const C = this.integrate(dt, false);
    const w = this.wallContact(C);
    if (w) { this.p.y = Math.max(this.p.y, wy + .2); this.toWall(w, "crawl"); }
  }
}
const _hit = {}, _hit2 = {}, _hit3 = {}, _tdir = { x: 0, z: 0 };
const AZ = [0, -.2, .2, -.4, .4, -.6, .6, -.85, .85, -1.1, 1.1], AZ_WIDE = [...AZ, -1.4, 1.4, -1.7, 1.7], EL = [.42, .56, .7, .86, 1.02, 1.2, 1.36];

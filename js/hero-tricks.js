// Hero mode tricks and style. Holding T (or F/RB) continuously rotates in the selected direction.
// Direction and pose changes blend immediately without resetting the live orientation or waiting
// for an animation to finish. Completed rotations and stylish movement (a perfect release, a wall run, a point
// launch, skimming the street, swinging round a corner) feeds one running combo: points times a
// multiplier that grows with variety, kept alive in the air and on walls, banked on a clean landing
// and lost if you land halfway through a flip.
import * as THREE from "three";

const Q = THREE.Quaternion, V = THREE.Vector3;
// rot: turns about the body's own axes [pitch (x, + = forward), yaw (y), roll (z)]
export const TRICKS = {
  spin: { name: "Spin", pts: 100, dur: .5, rot: [0, 1, 0], shape: "spread" },
  front: { name: "Front Flip", pts: 150, dur: .55, rot: [1, 0, 0], shape: "tuck" },
  back: { name: "Backflip", pts: 150, dur: .55, rot: [-1, 0, 0], shape: "tuck" },
  sideL: { name: "Left Side Flip", pts: 175, dur: .68, rot: [0, 0, -1], shape: "layout" },
  sideR: { name: "Right Side Flip", pts: 175, dur: .68, rot: [0, 0, 1], shape: "layout" },
  corkL: { name: "Forward Left Corkscrew", pts: 260, dur: .78, rot: [1, .65, -.75], shape: "corkscrew" },
  corkR: { name: "Forward Right Corkscrew", pts: 260, dur: .78, rot: [1, -.65, .75], shape: "corkscrew" },
  twistL: { name: "Back Left Twist", pts: 260, dur: .8, rot: [-1, .65, -.75], shape: "corkscrew" },
  twistR: { name: "Back Right Twist", pts: 260, dur: .8, rot: [-1, -.65, .75], shape: "corkscrew" },
  supermanSpin: { name: "Superman Spin", pts: 190, dur: .75, rot: [0, 1, 0], shape: "superman" },
  layoutFront: { name: "Front Layout", pts: 210, dur: .72, rot: [1, 0, 0], shape: "layout" },
  layoutBack: { name: "Back Layout", pts: 210, dur: .74, rot: [-1, 0, 0], shape: "layout" },
  barrelL: { name: "Left Barrel Roll", pts: 220, dur: .7, rot: [0, 0, -1], shape: "superman" },
  barrelR: { name: "Right Barrel Roll", pts: 220, dur: .7, rot: [0, 0, 1], shape: "superman" },
  rocketL: { name: "Left Rocket Corkscrew", pts: 300, dur: .86, rot: [1, 1.2, -.6], shape: "superman" },
  rocketR: { name: "Right Rocket Corkscrew", pts: 300, dur: .86, rot: [1, -1.2, .6], shape: "superman" },
  reverseL: { name: "Left Reverse Corkscrew", pts: 300, dur: .88, rot: [-1, 1.2, -.6], shape: "corkscrew" },
  reverseR: { name: "Right Reverse Corkscrew", pts: 300, dur: .88, rot: [-1, -1.2, .6], shape: "corkscrew" },
  splitSpin: { name: "Air Splits Spin", pts: 190, dur: .74, rot: [0, 1, 0], shape: "split" },
  pikeFront: { name: "Front Pike", pts: 220, dur: .66, rot: [1, 0, 0], shape: "pike" },
  pikeBack: { name: "Back Pike", pts: 220, dur: .68, rot: [-1, 0, 0], shape: "pike" },
  scissorL: { name: "Left Scissor Roll", pts: 240, dur: .76, rot: [0, 0, -1], shape: "split" },
  scissorR: { name: "Right Scissor Roll", pts: 240, dur: .76, rot: [0, 0, 1], shape: "split" },
  tuckedCorkL: { name: "Left Tucked Corkscrew", pts: 290, dur: .8, rot: [1, .45, -.9], shape: "tuck" },
  tuckedCorkR: { name: "Right Tucked Corkscrew", pts: 290, dur: .8, rot: [1, -.45, .9], shape: "tuck" },
  mistyL: { name: "Left Misty Flip", pts: 310, dur: .86, rot: [-1, .8, -.9], shape: "pike" },
  mistyR: { name: "Right Misty Flip", pts: 310, dur: .86, rot: [-1, -.8, .9], shape: "pike" },
  barrel: { name: "Barrel Roll", pts: 200, dur: .6, rot: [0, 0, 1], shape: "layout" },
  superman: { name: "Superman", pts: 140, dur: .9, rot: [0, 0, 0], shape: "superman" },
  split: { name: "Air Splits", pts: 140, dur: .7, rot: [0, 0, 0], shape: "split" },
  // on a line: round the rope, over the top of it
  aroundL: { name: "Around the World", pts: 220, dur: .7, rot: [0, 1, 0], shape: "spread", swing: true },
  aroundR: { name: "Around the World", pts: 220, dur: .7, rot: [0, -1, 0], shape: "spread", swing: true },
  swingFlip: { name: "Swing Flip", pts: 240, dur: .7, rot: [1, 0, 0], shape: "pike", swing: true },
  swingKick: { name: "Rope Kick", pts: 120, dur: .5, rot: [0, 0, 0], shape: "split", swing: true },
  wallFlip: { name: "Wall Flip", pts: 220, dur: .6, rot: [-1, 0, 0], shape: "tuck" },
};
const MULTI = ["", "Double ", "Triple ", "Quad "];
const DIRECTIONS = { "": "spin", F: "front", B: "back", L: "sideL", R: "sideR", FL: "corkL", FR: "corkR", BL: "twistL", BR: "twistR" };
const LAYOUTS = { "": "supermanSpin", F: "layoutFront", B: "layoutBack", L: "barrelL", R: "barrelR", FL: "rocketL", FR: "rocketR", BL: "reverseL", BR: "reverseR" };
const PIKES = { "": "splitSpin", F: "pikeFront", B: "pikeBack", L: "scissorL", R: "scissorR", FL: "tuckedCorkL", FR: "tuckedCorkR", BL: "mistyL", BR: "mistyR" };
// little things worth points and a bit of multiplier
export const LINKS = {
  release: ["Release", 50, .25], perfect: ["Perfect Release", 120, .5], swingjump: ["Swing Jump", 80, .25],
  wallrun: ["Wall Run", 40, .25], walljump: ["Wall Jump", 60, .25], corner: ["Corner Run", 50, .25], rooflaunch: ["Roof Launch", 140, .5],
  launch: ["Point Launch", 110, .5], zip: ["Web Zip", 25, .1], dive: ["Dive", 60, .25], glide: ["Web Wings", 40, .25],
  skim: ["Street Skim", 90, .5], wrap: ["Corner Swing", 70, .25], vault: ["Vault", 30, .1], slide: ["Slide", 25, .1], leap: ["Parkour Leap", 50, .25],
  airdash: ["Air Dash", 20, .1], double: ["Double Web", 50, .25], under: ["Under Pass", 160, .5], close: ["Close Call", 70, .25],
  freefall: ["Freefall", 0, .25], aircombo: ["Air Combo", 60, .25], wallpin: ["Wall Pin", 150, .5], perfectdodge: ["Perfect Dodge", 120, .5],
  webstrike: ["Web Strike", 80, .25], finisher: ["Finisher", 250, .5], takedown: ["Takedown", 100, .25], throw: ["Web Throw", 90, .25], slam: ["Ground Slam", 120, .25], roll: ["Roll", 60, .1], pullup: ["Pull Up", 80, .25], ceiling: ["Ceiling Run", 60, .25], ledge: ["Ledge Grab", 20, .1],
  slingshot: ["Slingshot", 120, .5], wind: ["Wind Tunnel", 80, .25], updraft: ["Updraft", 60, .25], parry: ["Parry", 140, .5], ability: ["Arc Ability", 100, .25], cache: ["Signal Cache", 200, .5],
};

const _q = new Q(), _axis = new V(), _up = new V(), IDENTITY = new Q();
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

export class Tricks {
  constructor() {
    this.cur = null; this.queue = null; this.free = 0;
    this.combo = null; this.score = 0; this.best = 0; this.bestCombo = 0;
    this.feed = [];              // [{ text, pts, t, kind }] for the HUD
    this.events = [];            // banked / bail / trick for sounds and effects
    this.rot = new Q();          // the body rotation the rig adds
    this.velocity = new V(); this.goal = new V(); this.axis = new V();
    this.holding = false; this.heldIntent = false; this.allowed = false; this.poseWeight = 0; this.transitionT = .18;
    this.previousPose = { shape: "spread", k: .5, side: 1, dirX: 0, dirY: 0, blend: 0 };
    this.descriptor = { shape: "spread", k: 0, blend: 0, side: 1, dirX: 0, dirY: 0, turns: 0, previous: null, transition: 1 };
    this.hasPrevious = false; this.lastDone = Infinity;
    this.groundT = 0;
  }
  clearMotion() {
    this.cur = this.queue = null; this.free = 0; this.holding = false; this.heldIntent = false; this.allowed = false;
    this.rot.identity(); this.velocity.set(0, 0, 0); this.goal.set(0, 0, 0);
    this.poseWeight = 0; this.hasPrevious = false; this.transitionT = .18;
  }
  reset() {
    this.clearMotion(); this.combo = null; this.feed.length = 0; this.events.length = 0;
    this.groundT = 0; this.lastDone = Infinity; this.cleanLand = false; this.diveFrom = undefined;
  }
  ev(type, o = {}) { o.type = type; this.events.push(o); }
  // ---- the combo ----
  open() { if (!this.combo) this.combo = { pts: 0, mult: 1, n: 0, seen: new Map(), links: new Map(), t: 0, dist: 0, top: 0 }; return this.combo; }
  add(text, pts, mult, kind = "trick", key = text) {
    const c = this.open();
    const seen = c.seen.get(key) || 0;
    c.seen.set(key, seen + 1);
    // repeats are worth less each time; something new grows the multiplier
    const rep = seen === 0 ? 1 : seen === 1 ? .5 : seen === 2 ? .25 : .1;
    const p = Math.round(pts * rep * (this.styleK || 1));
    c.pts += p; c.n++;
    if (seen === 0) c.mult = Math.min(15, c.mult + mult);
    else c.mult = Math.min(15, c.mult + mult * .2);
    this.feed.unshift({ text, pts: p, t: 0, kind, rep: seen > 0 });
    if (this.feed.length > 7) this.feed.pop();
    return p;
  }
  link(kind, extra = 0) {
    const L = LINKS[kind];
    if (!L) return;
    const c = this.open(), n = c.links.get(kind) || 0;
    c.links.set(kind, n + 1);
    if (n > 6 && L[1] < 100) return;      // the 20th zip in one combo is not worth announcing
    this.add(L[0], L[1] + extra, L[2], "link");
  }
  bank(bonusText, bonus = 0) {
    const c = this.combo;
    if (!c) return 0;
    this.combo = null;
    if (bonusText) { c.pts += bonus; this.feed.unshift({ text: bonusText, pts: bonus, t: 0, kind: "bonus" }); }
    const total = Math.round(c.pts * c.mult);
    if (total <= 0) return 0;
    this.score += total;
    this.best = Math.max(this.best, total);
    this.bestCombo = Math.max(this.bestCombo, c.n);
    this.ev("banked", { total, mult: c.mult, n: c.n, pts: c.pts });
    return total;
  }
  bail(why = "BAILED") {
    if (!this.combo && !this.cur) { this.clearMotion(); return; }
    const lost = this.combo ? Math.round(this.combo.pts * this.combo.mult) : 0;
    this.combo = null; this.clearMotion();
    this.feed.unshift({ text: why, pts: -lost, t: 0, kind: "bail" });
    this.ev("bail", { lost });
  }

  // ---- input -> tricks ----
  // H: the hero body; inp: the frame's input; air: can a trick start (airborne, swinging, zipping)
  start(id, H, continuous = false, dirX = 0, dirY = 0) {
    const d = TRICKS[id];
    if (!d) return;
    this.allowed = (H.state === "air" || H.state === "swing" || H.state === "zip") && !H.move;
    if (this.cur?.id === id && continuous && !this.cur.releasing) {
      this.cur.dirX = dirX; this.cur.dirY = dirY; this.cur.side = Math.sign(dirX) || 1;
      this.cur.auto = false;
      return;
    }
    if (this.cur && this.poseWeight > .01) {
      const c = this.cur, p = this.previousPose;
      p.shape = c.d.shape; p.k = c.k; p.side = c.side; p.dirX = c.dirX; p.dirY = c.dirY; p.blend = this.poseWeight;
      this.hasPrevious = true; this.transitionT = 0;
    } else { this.hasPrevious = false; this.transitionT = .18; }
    // A new direction resets only its scoring progress. The orientation and angular velocity carry on.
    this.cur = { id, d, t: 0, k: 0, dur: d.dur, mult: 1, turns: 0, angle: 0, settle: 0,
      auto: !continuous, releasing: false, dirX, dirY, side: Math.sign(dirX) || 1, startT: H.clock || 0 };
    this.axis.set(...d.rot).normalize();
    this.goal.copy(this.axis).multiplyScalar(TAU / d.dur);
    this.cleanLand = false;
    this.ev("trick", { id });
  }
  input(dt, H, inp, airborne) {
    this.heldIntent = !!inp.trick; this.allowed = !!airborne;
    this.holding = this.heldIntent && this.allowed;
    if (!airborne) { this.goal.set(0, 0, 0); return; }
    if (this.holding) {
      const ix = clamp(Number.isFinite(inp.trickX) ? inp.trickX : inp.ix || 0, -1, 1);
      const iy = clamp(Number.isFinite(inp.trickY) ? inp.trickY : inp.iy || 0, -1, 1);
      const dir = Math.abs(iy) > .3 ? iy > 0 ? "F" : "B" : "";
      const side = Math.abs(ix) > .3 ? ix > 0 ? "R" : "L" : "";
      const style = inp.trickStyle || (inp.crouch ? "pike" : inp.sprint ? "layout" : "base");
      this.fire(dir + side, H, style, ix, iy);
    } else if (this.cur && !this.cur.auto) {
      this.cur.releasing = true;
      this.goal.set(0, 0, 0);
    }
  }
  fire(key, H, style = "base", dirX = 0, dirY = 0) {
    const map = style === "pike" ? PIKES : style === "layout" ? LAYOUTS : DIRECTIONS;
    this.start(map[key] || map[""], H, true, dirX, dirY);
  }
  completed(c) {
    c.turns++; c.mult = Math.min(4, c.turns);
    const text = c.turns <= 4 ? MULTI[c.turns - 1] + c.d.name : c.turns + "x " + c.d.name;
    // The same trick keeps its repetition key even when the HUD calls it a double or triple.
    this.add(text, c.d.pts, .5, "trick", c.d.name);
    this.ev("done", { id: c.id, mult: c.mult });
    this.lastDone = 0;
  }

  // ---- per frame ----
  // returns the rotation quaternion the rig should add (identity when no trick runs)
  update(dt, H) {
    for (const f of this.feed) f.t += dt;
    while (this.feed.length && this.feed[this.feed.length - 1].t > 4) this.feed.pop();
    const air = H.state === "air" || H.state === "swing" || H.state === "zip";
    if (this.combo) {
      this.combo.t += dt;
      this.combo.top = Math.max(this.combo.top, H.speed);
      // the combo waits a moment on the ground, so a landing straight into the next jump keeps it going
      if (H.state === "ground" || H.state === "water") {
        this.groundT += dt;
        if (this.groundT > (H.state === "water" ? .3 : 1.4)) this.bank(this.groundT < 2 && this.cleanLand ? "Clean Landing" : null, this.cleanLand ? Math.round(this.combo.pts * .1) : 0);
      } else this.groundT = 0;
      if (this.combo) this.combo.grace = H.state === "ground" ? 1 - this.groundT / 1.4 : 1;
    }
    this.lastDone += dt;
    if (!air || H.move || !this.allowed) { this.clearMotion(); return this.rot; }
    const c = this.cur;
    if (!c || !(dt > 0)) return this.rot;
    c.t += dt; c.settle += dt;
    if (c.auto && this.axis.lengthSq() < .5 && c.t >= c.dur) { c.auto = false; c.releasing = true; this.goal.set(0, 0, 0); }
    const running = this.holding || c.auto;
    this.velocity.lerp(this.goal, 1 - Math.exp(-dt * 14));
    const speed = this.velocity.length();
    if (speed > .001) {
      _axis.copy(this.velocity).multiplyScalar(1 / speed);
      // Use the untricked body's axes, so switching to a backflip stays backward even while sideways.
      this.rot.premultiply(_q.setFromAxisAngle(_axis, speed * dt)).normalize();
      // A new axis must settle before it earns progress, so quick direction taps cannot farm points.
      if (running && c.settle > .1 && _axis.dot(this.axis) > .94) {
        c.angle += Math.max(0, this.velocity.dot(this.axis)) * dt;
        while (c.angle >= TAU) {
          c.angle -= TAU; this.completed(c);
          if (c.auto) { c.auto = false; c.releasing = true; this.goal.set(0, 0, 0); break; }
        }
      }
    }
    c.k = clamp(c.angle / TAU, 0, 1);
    this.transitionT = Math.min(.18, this.transitionT + dt);
    this.poseWeight += ((running ? 1 : 0) - this.poseWeight) * (1 - Math.exp(-dt * 12));
    if (!running) {
      this.rot.slerp(IDENTITY, 1 - Math.exp(-dt * 10)).normalize();
      if (this.poseWeight < .01 && this.rot.angleTo(IDENTITY) < .015) this.clearMotion();
    }
    return this.rot;
  }
  // the movement reported what happened this frame
  onEvents(H, list) {
    for (const e of list) {
      switch (e.type) {
        case "letgo": if (e.jump) this.link("swingjump"); else if (e.quality === 2) this.link("perfect"); else if (e.quality === 1) this.link("release"); break;
        case "attach": if (e.second) this.link("double"); else this.open(); break;
        case "wall": this.clearMotion(); if (e.mode === "run" && e.speed > 8) this.link("wallrun"); else this.open(); break;
        case "walljump": this.link("walljump"); break;
        case "corner": this.link("corner"); break;
        case "rooflaunch": this.link("rooflaunch"); break;
        case "launch": this.link("launch"); break;
        case "zipgo": this.link("zip"); break;
        case "dive": this.diveFrom = H.p.y; break;
        case "pullup": this.link("pullup"); break;
        case "glide": this.link("glide"); break;
        case "skim": this.link("skim"); break;
        case "wrap": this.link("wrap"); break;
        case "vault": this.clearMotion(); if (this.combo || H.speed > 9) this.link("vault"); break;
        case "slide": this.link("slide"); break;
        case "leap": this.link("leap"); break;
        case "airdash": this.link("airdash"); break;
        case "ceiling": this.clearMotion(); this.link("ceiling"); break;
        case "ledge": this.clearMotion(); this.link("ledge"); break;
        case "perch": case "mantle": case "climb": this.clearMotion(); break;
        case "respawn": this.reset(); break;
        case "jump": if (e.big) this.link("leap"); break;
        case "land": this.landed(H, e); break;
      }
    }
  }
  landed(H, e) {
    const c = this.cur;
    this.cleanLand = true;
    const upsideDown = _up.set(0, 1, 0).applyQuaternion(this.rot).y < -.2;
    // Only an actual inverted hard landing bails. An unfinished rotation never awards partial points.
    if (c && this.heldIntent && !c.releasing && upsideDown && e.kind === "hard") {
      this.bail("BAILED");
      this.cleanLand = false;
      return "bail";
    }
    this.clearMotion();
    if (!this.combo) return "none";
    if (e.kind === "roll") { this.link("roll"); return "roll"; }
    if (e.kind === "hard" && e.fall > 25) { this.bank("Superhero Landing", 250); return "hero"; }
    if (this.lastDone < .25) { this.combo.pts += Math.round(this.combo.pts * .2); this.feed.unshift({ text: "Perfect Landing", pts: 0, t: 0, kind: "bonus" }); }
    return "land";
  }
  // a dive that ends in a swing or a landing scores by the height dropped
  diveEnd(H) {
    if (this.diveFrom === undefined) return;
    const drop = this.diveFrom - H.p.y;
    if (drop > 15) this.link("dive", Math.round(drop * 2));
    this.diveFrom = undefined;
  }
  get active() { return !!this.cur && (!this.cur.releasing || this.poseWeight > .02); }
  shape() {
    const c = this.cur;
    if (!c || this.poseWeight < .002) return null;
    const pose = this.descriptor;
    pose.shape = c.d.shape; pose.k = c.k; pose.blend = clamp(this.poseWeight, 0, 1);
    pose.side = c.side; pose.dirX = c.dirX; pose.dirY = c.dirY; pose.turns = c.turns;
    pose.transition = ease(this.transitionT / .18);
    pose.previous = this.hasPrevious && pose.transition < 1 ? this.previousPose : null;
    return pose;
  }
}

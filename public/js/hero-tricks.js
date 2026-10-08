// Hero mode tricks and style. The player picks each trick: hold the trick key (F) and press a
// direction - front flip, backflip, side flips, corkscrews, back twists - or press it alone for a
// spin; dragging the mouse sideways while it is held twists the body freely. Pressing the same
// direction again early in a trick doubles (then triples) it; a different direction queues the next
// one so they chain. Every trick and every stylish movement (a perfect release, a wall run, a point
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
  sideL: { name: "Side Flip", pts: 175, dur: .6, rot: [0, 0, -1], shape: "layout" },
  sideR: { name: "Side Flip", pts: 175, dur: .6, rot: [0, 0, 1], shape: "layout" },
  corkL: { name: "Corkscrew", pts: 260, dur: .75, rot: [1, 1, 0], shape: "corkscrew" },
  corkR: { name: "Corkscrew", pts: 260, dur: .75, rot: [1, -1, 0], shape: "corkscrew" },
  twistL: { name: "Back Twist", pts: 260, dur: .75, rot: [-1, 1, 0], shape: "corkscrew" },
  twistR: { name: "Back Twist", pts: 260, dur: .75, rot: [-1, -1, 0], shape: "corkscrew" },
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
// little things worth points and a bit of multiplier
export const LINKS = {
  release: ["Release", 50, .25], perfect: ["Perfect Release", 120, .5], swingjump: ["Swing Jump", 80, .25],
  wallrun: ["Wall Run", 40, .25], walljump: ["Wall Jump", 60, .25], corner: ["Corner Run", 50, .25], rooflaunch: ["Roof Launch", 140, .5],
  launch: ["Point Launch", 110, .5], zip: ["Web Zip", 25, .1], dive: ["Dive", 60, .25], glide: ["Web Wings", 40, .25],
  skim: ["Street Skim", 90, .5], wrap: ["Corner Swing", 70, .25], vault: ["Vault", 30, .1], slide: ["Slide", 25, .1], leap: ["Parkour Leap", 50, .25],
  airdash: ["Air Dash", 20, .1], double: ["Double Web", 50, .25], under: ["Under Pass", 160, .5], close: ["Close Call", 70, .25],
  freefall: ["Freefall", 0, .25], aircombo: ["Air Combo", 60, .25], wallpin: ["Wall Pin", 150, .5], perfectdodge: ["Perfect Dodge", 120, .5],
  webstrike: ["Web Strike", 80, .25], finisher: ["Finisher", 250, .5], takedown: ["Takedown", 100, .25], throw: ["Web Throw", 90, .25], slam: ["Ground Slam", 120, .25], roll: ["Roll", 60, .1], pullup: ["Pull Up", 80, .25], ceiling: ["Ceiling Run", 60, .25], ledge: ["Ledge Grab", 20, .1],
};

const _q = new Q(), _q2 = new Q(), _x = new V(1, 0, 0), _y = new V(0, 1, 0), _z = new V(0, 0, 1);
const ease = (k) => (k < .5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k));

export class Tricks {
  constructor() {
    this.cur = null; this.queue = null; this.free = 0; this.freeT = 0; this.freeShown = 0;
    this.combo = null; this.score = 0; this.best = 0; this.bestCombo = 0;
    this.feed = [];              // [{ text, pts, t, kind }] for the HUD
    this.events = [];            // banked / bail / trick for sounds and effects
    this.rot = new Q();          // the body rotation the rig adds
    this.groundT = 0;
  }
  ev(type, o = {}) { o.type = type; this.events.push(o); }
  // ---- the combo ----
  open() { if (!this.combo) this.combo = { pts: 0, mult: 1, n: 0, seen: new Map(), links: new Map(), t: 0, dist: 0, top: 0 }; return this.combo; }
  add(text, pts, mult, kind = "trick") {
    const c = this.open();
    const seen = c.seen.get(text) || 0;
    c.seen.set(text, seen + 1);
    // repeats are worth less each time; something new grows the multiplier
    const rep = seen === 0 ? 1 : seen === 1 ? .5 : seen === 2 ? .25 : .1;
    const p = Math.round(pts * rep);
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
    if (!this.combo && !this.cur) return;
    const lost = this.combo ? Math.round(this.combo.pts * this.combo.mult) : 0;
    this.combo = null; this.cur = null; this.queue = null; this.free = 0;
    this.feed.unshift({ text: why, pts: -lost, t: 0, kind: "bail" });
    this.ev("bail", { lost });
  }

  // ---- input -> tricks ----
  // H: the hero body; inp: the frame's input; air: can a trick start (airborne, swinging, zipping)
  start(id, H) {
    const d = TRICKS[id];
    if (!d) return;
    if (this.cur && this.cur.id === id && this.cur.k < .6 && this.cur.mult < 3) {
      // same direction again, early: make it a double (or triple)
      const c = this.cur;
      c.mult++; c.dur = d.dur * (1 + .62 * (c.mult - 1)); c.turns = c.mult;
      c.t = c.k * c.dur;
      return;
    }
    if (this.cur) { if (!this.queue && this.cur.k > .25) this.queue = id; return; }
    this.cur = { id, d, t: 0, k: 0, dur: d.dur, mult: 1, turns: 1, startT: H.clock || 0 };
    this.ev("trick", { id });
  }
  input(dt, H, inp, airborne) {
    // the direction pressed, relative to the camera's view, as left/right/forward/back
    const iy = inp.iy || 0, ix = inp.ix || 0;
    const dir = Math.abs(iy) > .5 ? (iy > 0 ? "F" : "B") : "", side = Math.abs(ix) > .5 ? (ix > 0 ? "R" : "L") : "";
    if (!inp.trick) { this.pending = 0; this.armed = false; }
    if (!airborne) { this.pending = 0; return; }
    if (inp.trickDown) { this.pending = .1; this.armed = true; this.lastDirKey = dir + side; }
    if (this.armed && inp.trick) {
      const key = dir + side;
      // a direction pressed (or changed) while the trick key is held fires that trick at once
      if (key && key !== this.lastDirKey) { this.fire(key, H); this.pending = 0; this.lastDirKey = key; }
      else if (key && this.pending > 0) { this.fire(key, H); this.pending = 0; this.lastDirKey = key; }
      else if (!key) this.lastDirKey = "";
      if (this.pending > 0) { this.pending -= dt; if (this.pending <= 0 && !key) this.fire("", H); }
      // mouse sideways while held: a free twist, scored per half turn
      if (Math.abs(inp.mdx || 0) > 0) {
        this.free += (inp.mdx || 0) * .006;
        this.freeT = .5;
      }
    }
  }
  fire(key, H) {
    const sw = H.state === "swing";
    const dive = H.dive;
    let id;
    if (sw) id = key.includes("F") ? "swingFlip" : key.includes("L") ? "aroundL" : key.includes("R") ? "aroundR" : key.includes("B") ? "swingKick" : "aroundL";
    else if (H.state === "wall") id = "wallFlip";
    else if (dive) id = key.includes("B") ? "superman" : "barrel";
    else switch (key) {
      case "F": id = "front"; break;
      case "B": id = "back"; break;
      case "L": id = "sideL"; break;
      case "R": id = "sideR"; break;
      case "FL": id = "corkL"; break;
      case "FR": id = "corkR"; break;
      case "BL": id = "twistL"; break;
      case "BR": id = "twistR"; break;
      default: id = this.cur?.id === "spin" ? "split" : "spin";
    }
    this.start(id, H);
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
    this.rot.identity();
    const c = this.cur;
    if (c) {
      c.t += dt;
      c.k = Math.min(1, c.t / c.dur);
      const e = ease(c.k), r = c.d.rot, T = Math.PI * 2 * c.turns * e;
      if (r[1]) this.rot.multiply(_q.setFromAxisAngle(_y, r[1] * T));
      if (r[0]) this.rot.multiply(_q.setFromAxisAngle(_x, r[0] * T));
      if (r[2]) this.rot.multiply(_q.setFromAxisAngle(_z, r[2] * T));
      if (c.k >= 1) {
        // landed it in the air: score it
        const name = MULTI[c.mult - 1] + c.d.name;
        this.add(name, Math.round(c.d.pts * (c.mult === 1 ? 1 : c.mult === 2 ? 2.4 : 4)), c.mult > 1 ? 1 : .5);
        this.ev("done", { id: c.id, mult: c.mult });
        this.cur = null;
        this.lastDone = 0;
        if (this.queue && air) { const q = this.queue; this.queue = null; this.start(q, H); this.add("Chain", 50, .25, "link"); }
        else this.queue = null;
      }
    }
    this.lastDone = (this.lastDone ?? 9) + dt;
    // the free twist eases back to square once the mouse stops, scoring each half turn on the way
    if (Math.abs(this.free) > .01) {
      const halves = Math.floor(Math.abs(this.free) / Math.PI);
      if (halves > this.freeShown) { this.freeShown = halves; }
      this.freeT -= dt;
      if (this.freeT <= 0 || !air) {
        const snapTo = Math.round(this.free / Math.PI) * Math.PI;
        if (this.freeShown >= 1 && air) { const deg = this.freeShown * 180; this.add(deg + " Twist", 40 * this.freeShown + (deg >= 720 ? 200 : 0), .25); }
        this.freeShown = 0;
        this.free += (snapTo - this.free) * Math.min(1, dt * 10);
        if (Math.abs(this.free - snapTo) < .02) this.free = 0;
      }
      this.rot.premultiply(_q2.setFromAxisAngle(_y, this.free));
    }
    return this.rot;
  }
  // the movement reported what happened this frame
  onEvents(H, list) {
    for (const e of list) {
      switch (e.type) {
        case "letgo": if (e.jump) this.link("swingjump"); else if (e.quality === 2) this.link("perfect"); else if (e.quality === 1) this.link("release"); break;
        case "attach": if (e.second) this.link("double"); else this.open(); break;
        case "wall": if (e.mode === "run" && e.speed > 8) this.link("wallrun"); else this.open(); break;
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
        case "vault": if (this.combo || H.speed > 9) this.link("vault"); break;
        case "slide": this.link("slide"); break;
        case "leap": this.link("leap"); break;
        case "airdash": this.link("airdash"); break;
        case "ceiling": this.link("ceiling"); break;
        case "jump": if (e.big) this.link("leap"); break;
        case "land": this.landed(H, e); break;
      }
    }
  }
  landed(H, e) {
    const c = this.cur;
    this.cleanLand = true;
    if (c && c.k < .8) {
      this.bail("BAILED");
      this.cleanLand = false;
      return "bail";
    }
    if (c) { this.cur = null; this.add(MULTI[c.mult - 1] + c.d.name, Math.round(c.d.pts * (c.mult === 1 ? 1 : c.mult === 2 ? 2.4 : 4)), .5); }
    if (Math.abs(this.free) > .6 && Math.abs(this.free % Math.PI) > .6) { this.free = 0; this.bail("BAILED"); this.cleanLand = false; return "bail"; }
    this.free = 0; this.queue = null;
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
  get active() { return !!this.cur || Math.abs(this.free) > .2; }
  shape() { return this.cur ? { shape: this.cur.d.shape, k: this.cur.k } : Math.abs(this.free) > .3 ? { shape: "spread", k: .5 } : null; }
}

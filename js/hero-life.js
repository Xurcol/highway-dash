// New Meridian's life: people on the sidewalks (one instanced, vertex-animated crowd) who stop to
// watch the hero land, take pictures, cheer, and scatter from a fight; police cars and ambulances in
// the traffic with their lights and sirens; the subway trains (on a timetable from the shared clock,
// so every player sees the same train); the traffic and the trains as moving solids the hero can be
// hit by, stand on and ride; the weather turning over the hours; and the names of the places.
import * as THREE from "three";
import { patchLit } from "./lights.js?v=mvkadte1";
import { makeTrafficCar } from "./cars.js?v=mvkadte1";
import { HeroRig, OUTFITS, poseBody, HIP_H } from "./hero-rig.js?v=mvkadte1";
import { BOX, OBB } from "./hero-world.js?v=mvkadte1";
import { TUNNEL, RIVER, onBridge } from "./hero-extras-map.js?v=mvkadte1";
import { districtAt } from "./city-map.js?v=mvkadte1";

const V = THREE.Vector3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ------------------------------------------------------------------ the crowd
const SHIRTS = [0x2b4c7e, 0x8c1d1d, 0xe8e6e0, 0x2e7d4f, 0xd6a22a, 0x5b6f86, 0x1d1f24, 0x7a4a8c, 0xc8622a, 0x9aa1aa, 0x3d6b6b, 0xb8556a];
const PANTS = [0x1d2230, 0x3a3d44, 0x5a4a3c, 0x22262c, 0x6b6e73, 0x2b3a5a, 0x111214];
const SKINS = [0xf1c8a8, 0xd8a47e, 0xb67a54, 0x8a5636, 0x5e3a24, 0xe8b896];
function personGeometry() {
  const pos = [], nor = [], seg = [], cp = [], idx = [];
  // a box from (x0,y0,z0) to (x1,y1,z1): segment s (0 body, 1/2 legs, 3/4 arms), colour part c
  const box = (x0, y0, z0, x1, y1, z1, s, c) => {
    const b = pos.length / 3;
    const F = [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]]];
    F.forEach((f, k) => {
      for (let i = 0; i < 4; i++) { pos.push(...f[i]); nor.push(...f[4]); seg.push(s); cp.push(c); }
      const o = b + k * 4; idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    });
  };
  box(-.19, 1.0, -.11, .19, 1.52, .11, 0, 0);       // torso
  box(-.17, .88, -.1, .17, 1.04, .1, 0, 1);          // hips
  box(-.06, 1.5, -.06, .06, 1.58, .06, 0, 2);        // neck
  box(-.1, 1.56, -.11, .1, 1.79, .1, 0, 2);          // head
  box(-.105, 1.74, -.12, .105, 1.81, .08, 0, 3);     // hair
  for (const [s, x] of [[1, .095], [2, -.095]]) { box(x - .075, .06, -.08, x + .075, .92, .08, s, 1); box(x - .075, 0, -.08, x + .075, .07, .14, s, 3); }
  for (const [s, x] of [[3, .255], [4, -.255]]) { box(x - .055, .96, -.06, x + .055, 1.5, .06, s, 0); box(x - .045, .9, -.05, x + .045, .98, .05, s, 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("seg", new THREE.Float32BufferAttribute(seg, 1));
  g.setAttribute("cpart", new THREE.Float32BufferAttribute(cp, 1));
  g.setIndex(idx);
  return g;
}
function crowdMaterial() {
  const m = patchLit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .8 }), (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        attribute float seg; attribute float cpart; attribute vec3 iShirt; attribute vec3 iPants; attribute vec3 iSkin; attribute vec4 iAnim;
        varying vec3 vPcol;
        vec3 limb(vec3 p, float s, float a, vec2 piv) { vec2 q = p.yz - piv; float c = cos(a), sn = sin(a); p.yz = piv + vec2(q.x * c - q.y * sn, q.x * sn + q.y * c); return p; }
        vec3 armOut(vec3 p, float side, float a, vec2 piv) { vec2 q = p.xy - piv; float c = cos(a * side), sn = sin(a * side); p.xy = piv + vec2(q.x * c - q.y * sn, q.x * sn + q.y * c); return p; }`)
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        { float ph = iAnim.x, amp = iAnim.y, raise = iAnim.z;
          if (seg > .5 && seg < 2.5) { float s = seg < 1.5 ? 1. : -1.; transformed = limb(transformed, s, sin(ph) * amp * s, vec2(.92, 0.)); }
          if (seg > 2.5) { float s = seg < 3.5 ? -1. : 1.; float side = seg < 3.5 ? 1. : -1.;
            transformed = limb(transformed, s, sin(ph) * amp * s * .9 - raise * 2.6, vec2(1.48, 0.));
            transformed = armOut(transformed, side, raise * .35, vec2(.25 * side, 1.48)); }
          transformed *= iAnim.w;
          vPcol = cpart < .5 ? iShirt : cpart < 1.5 ? iPants : cpart < 2.5 ? iSkin : vec3(.06, .05, .05); }`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vPcol;").replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vPcol;");
  });
  m.customProgramCacheKey = () => "lampscrowd1";
  return m;
}

export class Crowd {
  constructor(scene, W, n = 220) {
    this.W = W; this.n = n;
    this.geo = personGeometry();
    this.mesh = new THREE.InstancedMesh(this.geo, crowdMaterial(), n);
    const A = (k, s) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * s), s); a.setUsage(THREE.DynamicDrawUsage); this.geo.setAttribute(k, a); return a; };
    this.aShirt = A("iShirt", 3); this.aPants = A("iPants", 3); this.aSkin = A("iSkin", 3); this.aAnim = A("iAnim", 4);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.peds = [];
    this.paths = this.buildPaths(W.M);
    this.flash = [];
    this.simT = 0; this.forceUpdate = true;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new V(1, 1, 1); this.e = new THREE.Euler();
  }
  // straight walks: down the middle of every sidewalk strip, and round the edge of every block
  buildPaths(M) {
    const P = [], grid = new Map(), C = 40;
    const add = (ax, az, bx, bz, y) => {
      const p = { ax, az, bx, bz, y, L: Math.hypot(bx - ax, bz - az) };
      if (p.L < 6) return;
      P.push(p);
      const k = Math.floor((ax + bx) / 2 / C) + "," + Math.floor((az + bz) / 2 / C);
      (grid.get(k) || grid.set(k, []).get(k)).push(p);
    };
    for (const s of M.slabs) {
      if (s.kind !== "walk") continue;
      const w = s.x1 - s.x0, d = s.z1 - s.z0, y = s.h;
      if (Math.min(w, d) < 7) { if (w > d) add(s.x0 + 1, (s.z0 + s.z1) / 2, s.x1 - 1, (s.z0 + s.z1) / 2, y); else add((s.x0 + s.x1) / 2, s.z0 + 1, (s.x0 + s.x1) / 2, s.z1 - 1, y); }
      else { const o = 2.2; add(s.x0 + o, s.z0 + o, s.x1 - o, s.z0 + o, y); add(s.x0 + o, s.z1 - o, s.x1 - o, s.z1 - o, y); add(s.x0 + o, s.z0 + o, s.x0 + o, s.z1 - o, y); add(s.x1 - o, s.z0 + o, s.x1 - o, s.z1 - o, y); }
    }
    this.pgrid = grid; this.pC = C;
    return P;
  }
  near(x, z, r) {
    const out = [], C = this.pC;
    for (let i = Math.floor((x - r) / C); i <= Math.floor((x + r) / C); i++) for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) { const a = this.pgrid.get(i + "," + j); if (a) out.push(...a); }
    return out;
  }
  spawn(p, cam, initial) {
    const list = this.near(cam.x, cam.z, 130);
    for (let tries = 0; tries < 8 && list.length; tries++) {
      const path = list[(Math.random() * list.length) | 0], t = Math.random();
      const x = path.ax + (path.bx - path.ax) * t, z = path.az + (path.bz - path.az) * t, d = Math.hypot(x - cam.x, z - cam.z);
      if (d > 125 || (!initial && d < 45)) continue;
      const r = Math.random;
      Object.assign(p, { path, t, dir: r() < .5 ? 1 : -1, x, z, y: path.y, yaw: 0, speed: 1.1 + r() * .6, side: (r() - .5) * 1.4, state: r() < .12 ? 0 : 1, st: r() * 6, phase: r() * 6.28, raise: 0, scale: .92 + r() * .16, look: null, alive: true, shirt: SHIRTS[(r() * SHIRTS.length) | 0], pants: PANTS[(r() * PANTS.length) | 0], skin: SKINS[(r() * SKINS.length) | 0], cool: 0 });
      return true;
    }
    p.alive = false;
    return false;
  }
  // threats: points the crowd runs from ({ x, z, r }); show: where the hero is doing something to watch
  update(dt, cam, hero, threats, glows, night) {
    this.simT += Math.max(0, dt);
    if (this.forceUpdate || this.simT >= 1 / 30) {
      const step = this.simT; this.simT = 0; this.forceUpdate = false;
      this.simulate(step, cam, hero, threats, night);
    }
    // Camera flashes still enter the glow buffer on every rendered frame.
    for (let i = this.flash.length - 1; i >= 0; i--) { const f = this.flash[i]; f[3] -= dt; if (f[3] <= 0) this.flash.splice(i, 1); else glows.add(f[0], f[1], f[2], 1, 1, 1, 2.5); }
  }
  simulate(dt, cam, hero, threats, night) {
    if (!this.paths.length) return;
    while (this.peds.length < this.n) { const p = {}; this.spawn(p, cam, true); this.peds.push(p); }
    const hx = hero.x, hz = hero.z, hy = hero.y;
    for (let i = 0; i < this.n; i++) {
      const p = this.peds[i];
      if (!p.alive || Math.hypot(p.x - cam.x, p.z - cam.z) > 150) { this.spawn(p, cam, false); if (!p.alive) continue; }
      // ---- deciding ----
      p.cool -= dt;
      let flee = null;
      for (const t of threats) { const d = Math.hypot(p.x - t.x, p.z - t.z); if (d < t.r) { flee = t; break; } }
      const dh = Math.hypot(p.x - hx, p.z - hz);
      if (flee) { p.state = 2; p.st = 0; p.fx = p.x - flee.x; p.fz = p.z - flee.z; }
      else if (p.state === 2 && (p.st += dt) > 4) { p.state = 1; this.rejoin(p); }
      else if (hero.show && dh < hero.show && Math.abs(hy - p.y) < 6 && p.cool <= 0 && p.state < 2) { p.state = Math.random() < .5 ? 3 : 4; p.st = 0; p.cool = 8; }
      // ---- moving ----
      const P = p.path, ux = (P.bx - P.ax) / P.L, uz = (P.bz - P.az) / P.L;
      let mvx = 0, mvz = 0, sp = 0;
      if (p.state === 1) {
        p.t += p.dir * p.speed * dt / P.L;
        if (p.t > 1 || p.t < 0) {
          // at the end: carry on along a path that starts near here, or turn round
          const ex = p.t > 1 ? P.bx : P.ax, ez = p.t > 1 ? P.bz : P.az;
          const next = this.near(ex, ez, 8).filter((q) => q !== P && (Math.hypot(q.ax - ex, q.az - ez) < 7 || Math.hypot(q.bx - ex, q.bz - ez) < 7));
          if (next.length && Math.random() < .85) { const q = next[(Math.random() * next.length) | 0]; p.path = q; const fromA = Math.hypot(q.ax - ex, q.az - ez) < Math.hypot(q.bx - ex, q.bz - ez); p.t = fromA ? 0 : 1; p.dir = fromA ? 1 : -1; }
          else { p.t = clamp(p.t, 0, 1); p.dir *= -1; }
          if (Math.random() < .15) { p.state = 0; p.st = 0; }
        }
        const Q = p.path, qx = (Q.bx - Q.ax) / Q.L, qz = (Q.bz - Q.az) / Q.L;
        // the hero in the way: step to the side of the walk and slow a little - never backwards
        const lat = (hx - (Q.ax + (Q.bx - Q.ax) * p.t)) * -qz + (hz - (Q.az + (Q.bz - Q.az) * p.t)) * qx;
        const along = ((hx - p.x) * qx + (hz - p.z) * qz) * p.dir;
        p.home ??= p.side;
        const want = dh < 3 && along > -1.2 && Math.abs(hy - p.y) < 2.5 ? lat - Math.sign(lat - p.side || 1) * 1.6 : p.home;
        p.side = clamp(p.side + clamp(want - p.side, -2.2 * dt, 2.2 * dt), -3, 3);
        if (dh < 1.2) p.t -= p.dir * p.speed * dt * .6 / Q.L;
        const tx = Q.ax + (Q.bx - Q.ax) * p.t - qz * p.side, tz = Q.az + (Q.bz - Q.az) * p.t + qx * p.side;
        mvx = tx - p.x; mvz = tz - p.z; sp = p.speed;
        p.x = tx; p.z = tz; p.y = Q.y;
        p.yaw = Math.atan2(qx * p.dir, qz * p.dir);
      } else if (p.state === 0) { if ((p.st += dt) > 3 + (i % 5)) p.state = 1; }
      else if (p.state === 2) {
        const L = Math.hypot(p.fx, p.fz) || 1;
        const vx = p.fx / L * 5.2, vz = p.fz / L * 5.2, nx = p.x + vx * dt, nz = p.z + vz * dt;
        if (this.W.topAt(nx, nz, p.y + .5) < p.y + .4 && this.W.topAt(nx, nz, p.y + .5) > p.y - .4) { p.x = nx; p.z = nz; }
        else { const f = p.fx; p.fx = -p.fz; p.fz = f; }
        p.yaw = Math.atan2(vx, vz); sp = 5.2;
      } else if (p.state >= 3) {
        // watching the hero: turn to them, cheer or hold up a phone
        p.yaw = Math.atan2(hx - p.x, hz - p.z);
        if ((p.st += dt) > 5) p.state = 1;
        if (p.state === 4 && night && Math.random() < dt * .8) this.flash.push([p.x + Math.sin(p.yaw) * .3, p.y + 1.6, p.z + Math.cos(p.yaw) * .3, .12]);
      }
      p.phase += sp * dt * (p.state === 2 ? 2.2 : 3.4);
      const amp = sp > .1 ? (p.state === 2 ? .9 : .45) : 0;
      p.raise += ((p.state === 3 ? 1 : p.state === 4 ? .55 : 0) - p.raise) * Math.min(1, dt * 5);
      // ---- drawing ----
      this.q.setFromEuler(this.e.set(0, p.yaw, 0));
      this.m4.compose(_v.set(p.x, p.y, p.z), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
      _c.setHex(p.shirt); this.aShirt.setXYZ(i, _c.r, _c.g, _c.b);
      _c.setHex(p.pants); this.aPants.setXYZ(i, _c.r, _c.g, _c.b);
      _c.setHex(p.skin); this.aSkin.setXYZ(i, _c.r, _c.g, _c.b);
      this.aAnim.setXYZW(i, p.phase, amp, p.raise, p.scale);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of [this.aShirt, this.aPants, this.aSkin, this.aAnim]) a.needsUpdate = true;
  }
  // back on the path from wherever running took them: the nearest point on it, keeping their offset
  rejoin(p) {
    const P = p.path, ux = (P.bx - P.ax) / P.L, uz = (P.bz - P.az) / P.L;
    p.t = clamp(((p.x - P.ax) * ux + (p.z - P.az) * uz) / P.L, 0, 1);
    p.side = clamp((p.x - P.ax) * -uz + (p.z - P.az) * ux, -3, 3);
  }
  setVisible(on) { this.mesh.visible = on; this.simT = 0; this.forceUpdate = on; if (!on) this.flash.length = 0; }
}
const _v = new V(), _c = new THREE.Color();

// ------------------------------------------------------------------ subway trains
// Two trains, one each way, on a timetable from the shared clock: wait at a station, run the tunnel,
// wait, run back. Three cars each.
const TRAIN = { cars: 3, L: 19, gap: 1, w: 2.9, h: 3.5, cycle: 92, dwell: 14, run: 32 };
export function trainState(k, T) {
  const t = ((T + k * TRAIN.cycle / 2) % TRAIN.cycle + TRAIN.cycle) % TRAIN.cycle;
  const xw = -350, xe = 350;
  const ease = (u) => (u < .5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
  let x, v = 0;
  if (t < TRAIN.dwell) x = xw;
  else if (t < TRAIN.dwell + TRAIN.run) { const u = (t - TRAIN.dwell) / TRAIN.run; x = xw + (xe - xw) * ease(u); v = (xe - xw) / TRAIN.run * (u < .5 ? 4 * u : 4 * (1 - u)); }
  else if (t < TRAIN.dwell * 2 + TRAIN.run) x = xe;
  else { const u = (t - TRAIN.dwell * 2 - TRAIN.run) / TRAIN.run; x = xe + (xw - xe) * ease(u); v = -(xe - xw) / TRAIN.run * (u < .5 ? 4 * u : 4 * (1 - u)); }
  return { x, z: k ? TUNNEL.z1 - 3 : TUNNEL.z0 + 3, v };
}
export class Trains {
  constructor(scene) {
    this.group = new THREE.Group();
    const body = patchLit(new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: .35, metalness: .6 }));
    const stripe = new THREE.MeshStandardMaterial({ color: 0x1f5fbf, roughness: .5 });
    const win = new THREE.MeshBasicMaterial({ color: 0xffe9c4, toneMapped: false });
    const cg = new THREE.BoxGeometry(TRAIN.L, TRAIN.h, TRAIN.w).translate(0, TRAIN.h / 2 + .4, 0);
    this.trains = [0, 1].map(() => {
      const g = new THREE.Group();
      for (let i = 0; i < TRAIN.cars; i++) {
        const c = new THREE.Mesh(cg, body); c.position.x = (i - 1) * (TRAIN.L + TRAIN.gap); c.castShadow = true; g.add(c);
        for (const s of [-1, 1]) {
          const st = new THREE.Mesh(new THREE.BoxGeometry(TRAIN.L * .98, .35, .02), stripe); st.position.set(c.position.x, 1.4, s * (TRAIN.w / 2 + .01)); g.add(st);
          for (let w = 0; w < 5; w++) { const wm = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1), win); wm.position.set(c.position.x - TRAIN.L / 2 + 2.5 + w * 3.6, 2.6, s * (TRAIN.w / 2 + .02)); wm.rotation.y = s > 0 ? 0 : Math.PI; g.add(wm); }
        }
      }
      this.group.add(g);
      return g;
    });
    scene.add(this.group);
  }
  // the solids for the world, and the train's position this frame
  update(T, glows, dyn) {
    this.trains.forEach((g, k) => {
      const s = trainState(k, T);
      g.position.set(s.x, TUNNEL.floor, s.z);
      const len = TRAIN.cars * (TRAIN.L + TRAIN.gap);
      dyn.push({ t: BOX, x0: s.x - len / 2, x1: s.x + len / 2, z0: s.z - TRAIN.w / 2, z1: s.z + TRAIN.w / 2, y0: TUNNEL.floor + .4, y1: TUNNEL.floor + .4 + TRAIN.h, kind: "train", solid: true, web: true, vx: s.v, vz: 0, dyn: true });
      const fx = s.v >= 0 ? 1 : -1;
      if (glows) for (const o of [-.9, .9]) glows.add(s.x + fx * len / 2, TUNNEL.floor + 1.2, s.z + o, 1, .95, .85, 1.6);
    });
  }
  setVisible(on) { this.group.visible = on; }
}

// ------------------------------------------------------------------ police, ambulances and fire engines
// Some of the city's traffic are emergency vehicles: dark police cruisers and white ambulances, light
// bars flashing, sirens on when there's trouble about.
export class Emergency {
  constructor(scene) { this.scene = scene; this.marked = new Map(); this.parked = []; this.officers = []; this.poseT = 0; }
  // tag new traffic cars as emergency vehicles now and then
  tag(traffic, alarm) {
    for (const c of traffic.cars) {
      if (this.marked.has(c.id)) continue;
      const r = (c.id * 2654435761 >>> 0) % 1000 / 1000;
      const kind = r < (alarm ? .14 : .05) ? "police" : r < (alarm ? .18 : .07) ? "ambulance" : null;
      this.marked.set(c.id, kind);
      if (kind) { c.color = kind === "police" ? 0x101216 : 0xf2f2f2; c.ev = kind; c.k = Math.max(c.k, 1.15); }
    }
    if (this.marked.size > 4000) this.marked.clear();
  }
  // the light bars, and the sirens that are near enough to hear
  // cam may be a camera or its position. A listener can supply camera right, velocity and audible.
  lights(traffic, T, glows, cam, alarm, listener = {}) {
    const pos = cam.position || cam, matrix = cam.matrixWorld?.elements;
    const right = listener.right || { x: matrix?.[0] ?? 1, z: matrix?.[2] ?? 0 };
    const rl = Math.hypot(right.x, right.z) || 1, velocity = listener.velocity || {};
    const sirens = [];
    for (const c of traffic.cars) {
      if (!c.ev) continue;
      const dx = c.x - pos.x, dz = c.z - pos.z, flat = Math.hypot(dx, dz);
      if (flat > 240) continue;
      const on = Math.floor(T * 6 + c.id) % 2, sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
      for (const s of [-1, 1]) {
        const x = c.x + s * .45 * cy, z = c.z - s * .45 * sy, lit = (s > 0) === !!on;
        if (c.ev === "police") glows.add(x, c.y + 1.6, z, lit ? 3 : .1, .1, lit ? .1 : 3, 1.4);
        else glows.add(x, c.y + 2.4, z, 3, lit ? .3 : 2.6, lit ? .2 : 2.6, 1.3);
      }
      if (!alarm || listener.audible === false) continue;
      const dy = (c.y || 0) + 1.5 - (pos.y || 0), distance = Math.hypot(dx, dy, dz);
      if (distance >= 85) continue;
      // Street noise drops off quickly above the street instead of following the hero onto rooftops.
      const edge = 1 - distance / 85;
      const level = Math.min(1, 1.4 * edge * edge * Math.pow(14 / Math.max(14, distance), 1.3)) * Math.exp(-Math.abs(dy) / 18);
      if (level < .003) continue;
      const ux = dx / Math.max(1, distance), uy = dy / Math.max(1, distance), uz = dz / Math.max(1, distance);
      const toward = (velocity.x || 0) * ux + (velocity.y || 0) * uy + (velocity.z || 0) * uz;
      const away = (-sy * ux - cy * uz) * (c.v || 0);
      sirens.push({ key: "ev" + c.id, kind: c.ev, level, distance,
        pan: Math.max(-1, Math.min(1, (dx * right.x + dz * right.z) / (Math.max(1, flat) * rl))),
        dop: Math.max(.85, Math.min(1.2, (343 + toward) / Math.max(200, 343 + away))), yelp: distance < 28 });
    }
    return sirens.sort((a, b) => a.distance - b.distance).slice(0, 2);
  }
  // a police car stopped at a crime scene, lights going, two officers behind it
  park(x, z, yaw) {
    const car = makeTrafficCar("sedan", 0x101216);
    car.position.set(x, .05, z); car.rotation.y = yaw;
    this.scene.add(car);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, .12, .3), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    bar.position.set(0, 1.5, 0); car.add(bar);
    const ofc = [];
    for (const s of [-1, 1]) {
      const rig = new HeroRig(OUTFITS.cop);
      this.scene.add(rig.group);
      const ox = x + Math.cos(yaw) * s * 1.6 - Math.sin(yaw) * 2.6, oz = z - Math.sin(yaw) * s * 1.6 - Math.cos(yaw) * 2.6;
      ofc.push({ rig, x: ox, z: oz, yaw: yaw + Math.PI, t: Math.random() * 3 });
    }
    const p = { car, x, z, yaw, ofc, t: 0, fresh: true };
    this.parked.push(p);
    return p;
  }
  unpark(p) {
    this.scene.remove(p.car);
    for (const o of p.ofc) { this.scene.remove(o.rig.group); o.rig.dispose(); }
    this.parked.splice(this.parked.indexOf(p), 1);
  }
  updateParked(dt, T, glows, W, aimAt) {
    this.poseT += Math.max(0, dt);
    const pose = this.poseT >= 1 / 30, step = this.poseT;
    if (pose) this.poseT = 0;
    for (const p of this.parked) {
      p.t += dt;
      const on = Math.floor(T * 6) % 2, cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
      for (const s of [-1, 1]) { const lit = (s > 0) === !!on; glows.add(p.x + s * .45 * cy, 1.6, p.z - s * .45 * sy, lit ? 3 : .1, .1, lit ? .1 : 3, 1.5); }
      if (!pose && !p.fresh) continue;
      p.fresh = false;
      for (const o of p.ofc) {
        o.t += step;
        const tgt = aimAt?.(o.x, o.z);
        if (tgt) o.yaw = Math.atan2(tgt.x - o.x, tgt.z - o.z);
        _p.set(o.x, W.topAt(o.x, o.z, 3) + HIP_H, o.z);
        o.rig.place(_p, _u.set(0, 1, 0), _f.set(Math.sin(o.yaw), 0, Math.cos(o.yaw)), null, step, 10);
        const r = poseBody(o.rig, { state: "ground", hs: 0, speed: 0, vy: 0, phase: 0, t: o.t, landT: 9, attack: tgt ? { kind: "aim", k: .5 } : null });
        o.rig.apply(step, r);
      }
    }
  }
  clear() { while (this.parked.length) this.unpark(this.parked[0]); this.marked.clear(); this.officers.length = 0; this.poseT = 0; }
}
const _p = new V(), _u = new V(), _f = new V();

// ------------------------------------------------------------------ moving solids
// The traffic near the hero as turned boxes the hero can be bumped by, land on and ride.
export function trafficSolids(traffic, sizes, cam, dyn, r = 70) {
  for (const c of traffic.cars) {
    if (Math.abs(c.x - cam.x) > r || Math.abs(c.z - cam.z) > r) continue;
    const L = c.L || 4.6, Wd = c.W || 1.9, H = c.body === "bus" ? 3.1 : c.body === "truck" ? 3.4 : c.body === "van" || c.body === "suv" ? 1.85 : 1.45;
    const yaw = c.yaw, cy = Math.cos(yaw), sy = Math.sin(yaw);
    // the car's long axis is along its heading: local x of the box = (sin yaw, cos yaw) -> box yaw = atan2(-cos, sin)
    const by = Math.atan2(cy, -sy), c2 = Math.cos(by), s2 = Math.sin(by);
    const ex = Math.abs(c2) * L / 2 + Math.abs(s2) * Wd / 2, ez = Math.abs(s2) * L / 2 + Math.abs(c2) * Wd / 2;
    dyn.push({ t: OBB, cx: c.x, cz: c.z, hx: L / 2, hz: Wd / 2, c: c2, s: s2, x0: c.x - ex, x1: c.x + ex, z0: c.z - ez, z1: c.z + ez, y0: c.y, y1: c.y + H, kind: "vehicle", solid: true, web: true, vx: -sy * c.v, vz: -cy * c.v, dyn: true, car: c });
  }
}

// ------------------------------------------------------------------ weather over the hours
const CYCLE = ["Clear", "Clear", "Cloudy", "Rain", "Storm", "Rain", "Cloudy", "Clear", "Fog", "Clear"];
export class WeatherClock {
  constructor() { this.t = 120 + Math.random() * 120; this.i = (Math.random() * CYCLE.length) | 0; }
  update(dt, sky, fixed) {
    if (fixed) return null;
    if ((this.t -= dt) > 0) return null;
    this.t = 240 + Math.random() * 240;
    this.i = (this.i + 1) % CYCLE.length;
    const w = CYCLE[this.i];
    if (w !== sky.weatherName) { sky.setWeather(w); return w; }
    return null;
  }
}

// ------------------------------------------------------------------ place names
export function heroDistrict(M, W, x, y, z) {
  const hx = M.hx;
  if (hx) {
    for (const b of hx.bridges) if (onBridge(b, x, z, 2)) return b.dz ? "SOUTHGATE BRIDGE" : b.dx > 0 ? "MERIDIAN BRIDGE" : "WEST NARROWS BRIDGE";
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m > RIVER.outer) return "THE MAINLAND";
    if (m > RIVER.inner) return z < -RIVER.inner && Math.abs(x) < 900 ? "PORT OF MERIDIAN" : "THE NARROWS";
    for (const p of hx.pits) if (x > p.x0 - 20 && x < p.x1 + 20 && z > p.z0 - 20 && z < p.z1 + 20) return `${p.name} STATION`;
    if (y < -1) return "MERIDIAN TRANSIT";
    for (const d of hx.dirt) if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1) return "CONSTRUCTION SITE";
    if (Math.hypot(x - 100, z - 100) < 70) return "MERIDIAN SQUARE";
  }
  return districtAt(x, z, y);
}

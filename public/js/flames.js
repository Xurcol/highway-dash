// Exhaust flames. Every pop and bang the engine voice actually plays is reported back from the audio
// thread (engine-worklet.js), and each one fires a jet out of the tailpipes, so what you see and what
// you hear are the same event: a crackle flickers a short tongue, a bang throws a fat fireball,
// anti-lag keeps the pipes lit.
//
// A jet is a short burst of particles fired back out of every tip at exhaust speed, on top of the
// car's own motion. They lose that speed to the air quickly, rise a little (hot gas), cool from a
// blue-white core through yellow and orange to a dull red, and swell as they go. Additive, with the
// core bright enough to catch the bloom. A lit emitter also throws a flickering orange light on the
// road and the car around it.
import * as THREE from "three";

// colour over a particle's life, [at, r, g, b]: blue-white at the pipe, then yellow, orange, red
const COOL = [[0, .55, .7, 1], [.1, 1, .92, .72], [.3, 1, .62, .22], [.62, 1, .3, .06], [1, .32, .05, .01]];
const _c = [0, 0, 0];
function cool(u) {
  let i = 1;
  while (i < COOL.length - 1 && u > COOL[i][0]) i++;
  const a = COOL[i - 1], b = COOL[i], k = Math.min(1, Math.max(0, (u - a[0]) / (b[0] - a[0])));
  _c[0] = a[1] + (b[1] - a[1]) * k; _c[1] = a[2] + (b[2] - a[2]) * k; _c[2] = a[3] + (b[3] - a[3]) * k;
  return _c;
}

// One car's tailpipes. pose() it every frame; fire() it whenever the engine pops.
class Emitter {
  constructor() {
    this.tips = [];                 // world [x, y, z] of each tip
    this.back = [0, 1];             // unit vector out of the back of the car (x, z)
    this.side = [1, 0];             // across the car
    this.vel = [0, 0];              // the car's own velocity (x, z)
    this.jets = [];
    this.heat = 0;
    this.light = { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, .42, .1), intensity: 0, range: 7, cosOuter: -2, cosInner: -1.9 };
  }
}

export class Flames {
  constructor(scene, cap = 1400) {
    this.cap = cap;
    this.P = Array.from({ length: cap }, () => ({ life: 0, age: 1 }));
    this.head = 0;
    this.gain = 1;                  // overall brightness (the showroom has no HDR buffer to hold it)
    this.emitters = new Set();
    const max = cap + 64;           // + one flash per tip
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.seed = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("seed", new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 800 } },
      vertexShader: `attribute float size; attribute vec3 color; attribute float seed; varying vec3 vC; varying float vS; uniform float scale;
        void main(){ vC = color; vS = seed; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * scale / -mv.z, 0.0, 384.0); gl_Position = projectionMatrix * mv; }`,
      // a soft ball with a ragged edge (the seed turns the lobes), so a stream of them reads as licks
      // of flame rather than a string of beads
      fragmentShader: `varying vec3 vC; varying float vS;
        void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float ang = atan(p.y, p.x);
          float r = length(p) * (1.0 + .16 * sin(ang * 5.0 + vS * 40.0) + .09 * sin(ang * 3.0 - vS * 23.0));
          if (r > 1.0) discard;
          float a = pow(1.0 - r, 1.5) + exp(-r * r * 16.0) * .7;
          gl_FragColor = vec4(vC * a, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 11;
    scene.add(this.points);
  }
  emitter() { const e = new Emitter(); this.emitters.add(e); return e; }
  remove(e) { this.emitters.delete(e); }
  // Where the pipes are this frame. tips are the body's exhaust points ([along, up, across]); the
  // flame leaves from just behind the bumper at each one, the same spot the chrome is drawn.
  pose(e, x, z, yaw, vx, vz, B, y0 = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw), tips = B.exhaust || [[-B.L / 2, .3, .45]], lz = B.L / 2 + .05;
    e.tips.length = tips.length;
    for (let i = 0; i < tips.length; i++) {
      const lx = (tips[i][2] || 0) * .92;
      const t = e.tips[i] || (e.tips[i] = [0, 0, 0]);
      t[0] = x + lx * c + lz * s; t[1] = y0 + (tips[i][1] || .3); t[2] = z - lx * s + lz * c;
    }
    e.back[0] = s; e.back[1] = c; e.side[0] = c; e.side[1] = -s;
    e.vel[0] = vx; e.vel[1] = vz;
  }
  // amp is the pop's level as the engine voice played it; big marks a bang
  fire(e, amp, big = false) {
    if (!(amp >= .3)) return;
    const n = Math.min(1, (amp - .25) / 5) ** .7;
    if (e.jets.length >= 6) e.jets.shift();
    const dur = .03 + n * .06 + (big ? .05 : 0);
    e.jets.push({ t: 0, dur, n, big, count: 4 + n * 16 + (big ? 10 : 0), acc: 0 });
  }
  spawn(e, tip, j, dt) {
    const p = this.P[this.head]; this.head = (this.head + 1) % this.cap;
    const n = j.n, R = Math.random, spread = .1 + n * .12;
    const sp = (9 + R() * 16) * (.75 + n * .5);                 // m/s out of the pipe, relative to the car
    const a = (R() - .5) * 2 * spread;
    const dx = e.back[0] + e.side[0] * a, dz = e.back[1] + e.side[1] * a, dy = .05 + (R() - .5) * spread;
    p.vx = e.vel[0] + dx * sp; p.vy = dy * sp; p.vz = e.vel[1] + dz * sp;
    // the air right behind a moving car is dragged along with it, so the flame trails rather than
    // being left hanging in the road
    p.ax = e.vel[0] * .7; p.az = e.vel[1] * .7;
    p.life = (.05 + R() * .06) * (1 + n * 1.2) * (j.big ? 1.4 : 1);
    p.s0 = .07 + n * .08; p.s1 = (.22 + n * .45) * (j.big ? 1.35 : 1) * (.8 + R() * .4);
    p.br = 2.2 + n * 4 + (j.big ? 1.5 : 0);
    p.seed = R();
    const f = R() * dt;                                        // spread the frame's batch along its path
    p.age = f; p.x = tip[0] + p.vx * f; p.y = tip[1] + p.vy * f; p.z = tip[2] + p.vz * f;
  }
  // scale: the camera's pixels per metre at 1 m (see pxScale in main.js)
  update(dt, lights, scale) {
    let m = 0;
    const pos = this.pos, col = this.col, size = this.size, seed = this.seed, room = size.length;
    const put = (x, y, z, r, g, b, s, sd) => {
      if (m >= room) return;
      pos[m * 3] = x; pos[m * 3 + 1] = y; pos[m * 3 + 2] = z;
      col[m * 3] = r; col[m * 3 + 1] = g; col[m * 3 + 2] = b; size[m] = s; seed[m] = sd; m++;
    };
    for (const e of this.emitters) {
      let heat = 0, flash = 0;
      for (let k = e.jets.length - 1; k >= 0; k--) {
        const j = e.jets[k];
        if (dt > 0) {
          j.t += dt;
          j.acc += j.count * Math.min(dt, j.dur) / j.dur;
          const c = Math.floor(j.acc); j.acc -= c;
          for (const tip of e.tips) for (let i = 0; i < c; i++) this.spawn(e, tip, j, dt);
        }
        const env = Math.max(0, 1 - j.t / j.dur);
        heat = Math.max(heat, (.35 + j.n) * env);
        flash = Math.max(flash, j.n);
        if (j.t >= j.dur) e.jets.splice(k, 1);
      }
      e.heat = heat > e.heat ? heat : e.heat * Math.exp(-dt * 18);
      if (e.heat > .03) {
        // the flash at the mouth of each pipe, blue-white while the jet is still coming out
        const fl = e.heat * this.gain * (.8 + Math.random() * .4), s = .16 + flash * .3;
        for (const t of e.tips) put(t[0] + e.back[0] * .06, t[1], t[2] + e.back[1] * .06, 2.4 * fl, 2.3 * fl, 2.6 * fl, s, Math.random());
        if (lights && e.tips.length) {
          const L = e.light;
          L.pos.set(0, 0, 0);
          for (const t of e.tips) { L.pos.x += t[0]; L.pos.z += t[2]; }
          L.pos.x = L.pos.x / e.tips.length + e.back[0] * .5; L.pos.z = L.pos.z / e.tips.length + e.back[1] * .5; L.pos.y = e.tips[0][1] + .25;
          L.intensity = e.heat * 7 * (.75 + Math.random() * .5); L.range = 5 + e.heat * 4;
          lights.push(L);
        }
      }
    }
    const kd = 1 - Math.exp(-9 * dt);
    for (const p of this.P) {
      if (p.age >= p.life) continue;
      if (dt > 0) {
        p.age += dt;
        if (p.age >= p.life) continue;
        p.vx += (p.ax - p.vx) * kd; p.vz += (p.az - p.vz) * kd; p.vy += -p.vy * kd + 1.8 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
      const u = p.age / p.life, c = cool(u), b = p.br * this.gain * (1 - u) ** 1.3 * (.85 + Math.random() * .3);
      put(p.x, p.y, p.z, c[0] * b, c[1] * b, c[2] * b, p.s0 + (p.s1 - p.s0) * Math.sqrt(u), p.seed);
    }
    const g = this.points.geometry;
    g.setDrawRange(0, m);
    for (const k of ["position", "color", "size", "seed"]) g.attributes[k].needsUpdate = true;
    this.mat.uniforms.scale.value = scale;
  }
}

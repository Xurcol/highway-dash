// Hero mode: the wind over New Meridian. Air currents run straight down the long avenues between the
// towers and carry anyone on web wings along them at speed; updrafts rise off a few tall roofs and lift
// a glider back up. They are placed from a fixed seed against the city's own roads and solids, so every
// player flies the same currents. Winds is pure JS (the body asks it where the air is moving each glide
// step); WindView draws the streaming streaks, entirely on the GPU.
import * as THREE from "three";

export const WIND = { speed: 54, pull: 2.6, hold: 2.2, lift: 15 };

function rng(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class Winds {
  constructor(W) {
    this.W = W;
    this.tunnels = []; this.drafts = [];
    this.hit = { kind: "", w: null, t: 0, cx: 0, cy: 0, cz: 0 };
    this.build();
  }
  // is a fat line clear of the city? the centre and four lines round it
  tube(ax, ay, az, bx, by, bz, r) {
    const W = this.W, dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, px = -dz / L * r, pz = dx / L * r;
    const offsets = [[0, 0, 0], [px, 0, pz], [-px, 0, -pz], [0, r, 0], [0, -r, 0]];
    for (const [ox, oy, oz] of offsets) if (!W.clear(ax + ox, ay + oy, az + oz, bx + ox, by + oy, bz + oz, 2, 0)) return false;
    return true;
  }
  // towers on both sides make it a canyon worth a current, not a gust over open ground
  walled(cx, cz, alongX, y) {
    let a = false, b = false;
    for (const s of this.W.M.buildings) {
      if (s.y1 < y + 8) continue;
      const mx = (s.x0 + s.x1) / 2, mz = (s.z0 + s.z1) / 2;
      const along = alongX ? Math.abs(mx - cx) : Math.abs(mz - cz), across = alongX ? mz - cz : mx - cx;
      if (along > 140 || Math.abs(across) > 70) continue;
      if (across > 0) a = true; else b = true;
      if (a && b) return true;
    }
    return false;
  }
  build() {
    const W = this.W, M = W.M, rnd = rng(1407), lim = 920;
    const roads = (M.roads || []).map((r) => r.rect).filter((q) => q && Math.max(q.x1 - q.x0, q.z1 - q.z0) > 200);
    // shuffle with the fixed seed, then try avenue after avenue
    for (let i = roads.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [roads[i], roads[j]] = [roads[j], roads[i]]; }
    for (const q of roads) {
      if (this.tunnels.length >= 11) break;
      const alongX = q.x1 - q.x0 > q.z1 - q.z0, cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2;
      const roadLen = alongX ? q.x1 - q.x0 : q.z1 - q.z0, len = Math.min(520, roadLen * .9);
      if (Math.max(Math.abs(cx), Math.abs(cz)) > lim) continue;
      if (this.tunnels.some((t) => Math.hypot(t.cx - cx, t.cz - cz) < 260)) continue;
      for (let k = 0; k < 3; k++) {
        const y = 34 + rnd() * 52, sgn = rnd() < .5 ? 1 : -1;
        const dx = alongX ? sgn : 0, dz = alongX ? 0 : sgn;
        const ax = cx - dx * len / 2, az = cz - dz * len / 2, bx = cx + dx * len / 2, bz = cz + dz * len / 2;
        if (!this.walled(cx, cz, alongX, y) || !this.tube(ax, y, az, bx, y, bz, 6)) continue;
        this.add(ax, y, az, bx, y, bz);
        break;
      }
    }
    // a few high currents over the skyline, so there is always one in reach
    for (let tries = 0; tries < 300 && this.tunnels.length < 15; tries++) {
      const a = rnd() * Math.PI * 2, len = 380 + rnd() * 300, y = 120 + rnd() * 50;
      const cx = (rnd() * 2 - 1) * 700, cz = (rnd() * 2 - 1) * 700, dx = Math.cos(a), dz = Math.sin(a);
      const ax = cx - dx * len / 2, az = cz - dz * len / 2, bx = cx + dx * len / 2, bz = cz + dz * len / 2;
      if (Math.max(Math.abs(ax), Math.abs(az), Math.abs(bx), Math.abs(bz)) > lim) continue;
      if (this.tunnels.some((t) => Math.hypot(t.cx - cx, t.cz - cz) < 300)) continue;
      if (!this.tube(ax, y, az, bx, y, bz, 7)) continue;
      this.add(ax, y, az, bx, y, bz);
    }
    // updrafts off the tallest roofs, spread out
    const tall = M.buildings.filter((b) => b.solid !== false && b.y1 > 60 && Math.max(Math.abs(b.x0), Math.abs(b.z0)) < lim).sort((a, b) => b.y1 - a.y1);
    for (const b of tall) {
      if (this.drafts.length >= 12) break;
      const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2;
      if (this.drafts.some((d) => Math.hypot(d.x - x, d.z - z) < 180) || rnd() < .35) continue;
      this.drafts.push({ x, z, y0: b.y1 + 1, y1: b.y1 + 85, r: 8 });
    }
  }
  add(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    this.tunnels.push({ ax, ay, az, bx, by, bz, dx: dx / len, dy: dy / len, dz: dz / len, len, r: 10, cx: (ax + bx) / 2, cz: (az + bz) / 2 });
  }
  // the moving air at a point (or null): which current, how far along, and its centre line there
  at(p) {
    const h = this.hit;
    for (const w of this.tunnels) {
      const ox = p.x - w.ax, oy = p.y - w.ay, oz = p.z - w.az;
      const t = ox * w.dx + oy * w.dy + oz * w.dz;
      if (t < 0 || t > w.len) continue;
      const cx = w.ax + w.dx * t, cy = w.ay + w.dy * t, cz = w.az + w.dz * t;
      if ((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2 > w.r * w.r) continue;
      h.kind = "tunnel"; h.w = w; h.t = t / w.len; h.cx = cx; h.cy = cy; h.cz = cz;
      return h;
    }
    for (const d of this.drafts) {
      if (p.y < d.y0 - 2 || p.y > d.y1 || (p.x - d.x) ** 2 + (p.z - d.z) ** 2 > d.r * d.r) continue;
      h.kind = "draft"; h.w = d; h.t = (p.y - d.y0) / (d.y1 - d.y0); h.cx = d.x; h.cy = p.y; h.cz = d.z;
      return h;
    }
    return null;
  }
  // the nearest current's entry (for the HUD and the map)
  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const w of this.tunnels) { const d = Math.hypot(w.ax - x, w.az - z); if (d < bd) { bd = d; best = w; } }
    return best ? { w: best, d: bd } : null;
  }
}

// ------------------------------------------------------------------ the look
// Every streak is a camera-facing quad that the vertex shader slides along its current and twists
// round it, so the whole field animates with a single uniform.
const VERT = `
attribute vec3 aA; attribute vec3 aD; attribute vec4 aP; attribute vec2 corner;
uniform float uTime;
varying float vA; varying vec2 vC;
void main() {
  float L = length(aD); vec3 d = aD / L;
  float s = fract(aP.x + uTime * aP.w / L);
  vec3 up = abs(d.y) > .9 ? vec3(1., 0., 0.) : vec3(0., 1., 0.);
  vec3 r1 = normalize(cross(d, up)), r2 = cross(r1, d);
  float ang = aP.y + s * 7. + uTime * .5;
  vec3 c = aA + aD * s + (r1 * cos(ang) + r2 * sin(ang)) * aP.z;
  vec3 tangent = normalize(d + (-r1 * sin(ang) + r2 * cos(ang)) * aP.z * 7. / L);
  float dist = distance(c, cameraPosition);
  vec3 p = c - tangent * (5. + aP.w * .1) * corner.x;
  vec3 side = normalize(cross(tangent, normalize(p - cameraPosition)));
  p += side * corner.y * (.09 + dist * .0025);
  vA = sin(s * 3.14159) * (1. - smoothstep(420., 900., dist)) * smoothstep(2., 10., dist);
  vC = corner;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;
const FRAG = `
uniform vec3 uColor; uniform float uAlpha;
varying float vA; varying vec2 vC;
void main() {
  float a = vA * uAlpha * (1. - vC.x * .85) * (1. - abs(vC.y));
  if (a < .003) discard;
  gl_FragColor = vec4(uColor, a);
}`;

export class WindView {
  constructor(scene, winds) {
    const per = [], add = (ax, ay, az, dx, dy, dz, n, rad, speed) => per.push({ ax, ay, az, dx, dy, dz, n, rad, speed });
    for (const w of winds.tunnels) add(w.ax, w.ay, w.az, w.bx - w.ax, w.by - w.ay, w.bz - w.az, 230, w.r * .85, WIND.speed);
    for (const d of winds.drafts) add(d.x, d.y0, d.z, 0, d.y1 - d.y0, 0, 70, d.r * .8, 20);
    const total = per.reduce((s, q) => s + q.n, 0);
    const A = new Float32Array(total * 12), Dv = new Float32Array(total * 12), Pv = new Float32Array(total * 16), C = new Float32Array(total * 8);
    const idx = new Uint32Array(total * 6);
    const rnd = rng(77);
    let q = 0;
    for (const s of per) for (let i = 0; i < s.n; i++, q++) {
      const t0 = rnd(), ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * s.rad, sp = s.speed * (.7 + rnd() * .6);
      for (let v = 0; v < 4; v++) {
        const o = q * 4 + v;
        A.set([s.ax, s.ay, s.az], o * 3); Dv.set([s.dx, s.dy, s.dz], o * 3); Pv.set([t0, ang, rad, sp], o * 4);
        C.set([v < 2 ? 0 : 1, v % 2 ? 1 : -1], o * 2);
      }
      idx.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3], q * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 12), 3));
    g.setAttribute("aA", new THREE.BufferAttribute(A, 3)); g.setAttribute("aD", new THREE.BufferAttribute(Dv, 3));
    g.setAttribute("aP", new THREE.BufferAttribute(Pv, 4)); g.setAttribute("corner", new THREE.BufferAttribute(C, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(.85, .95, 1) }, uAlpha: { value: .5 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }
  update(t, night) {
    this.mat.uniforms.uTime.value = t;
    // brighter against the night sky, softer by day so it never washes out the street
    this.mat.uniforms.uAlpha.value = .38 + night * .3;
  }
  setVisible(on) { this.mesh.visible = on; }
}

// Hero mode effects: the web lines (camera-facing ribbons with a glow, wobbling out of the wrist,
// taut while they hold, sagging and falling away when let go), pooled particles (web puffs, dust,
// sparks, water, glass, debris), speed streaks round the camera, ribbon trails off the hands and feet
// during tricks, and shockwave rings for big landings.
import * as THREE from "three";

const V = THREE.Vector3;

// ------------------------------------------------------------------ web lines
const SEG = 18;
export class WebLines {
  constructor(scene, cap = 40) {
    this.cap = cap; this.lines = [];
    const mk = (width, glow) => {
      const g = new THREE.BufferGeometry();
      const n = cap * (SEG + 1) * 2;
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute("side", new THREE.BufferAttribute(new Float32Array(n), 1));
      const idx = [];
      for (let l = 0; l < cap; l++) for (let i = 0; i < SEG; i++) { const a = (l * (SEG + 1) + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      g.setIndex(idx);
      const side = g.attributes.side.array;
      for (let i = 0; i < n; i++) side[i] = i % 2 ? 1 : -1;
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
        uniforms: { glow: { value: glow ? 1 : 0 } },
        vertexShader: `attribute vec4 color; attribute float side; varying vec4 vC; varying float vS;
          void main(){ vC = color; vS = side; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
        fragmentShader: `varying vec4 vC; varying float vS; uniform float glow;
          void main(){ float e = 1. - abs(vS); float a = glow > .5 ? e * e : smoothstep(0., .55, e);
            gl_FragColor = vec4(vC.rgb * (glow > .5 ? 1. : 1.), vC.a * a); }`,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false; mesh.renderOrder = 6;
      scene.add(mesh);
      return { g, mesh, width };
    };
    this.core = mk(.03, false);
    this.halo = mk(.16, true);
    this.dead = [];   // let-go lines falling away
  }
  // start a frame's list; line(points[], color, alpha, wobble)
  begin(cam) { this.n = 0; this.cam = cam; }
  // pts: world points from the wrist to the far end; wob: 0..1 wave along it (a line just shot);
  // sag: metres of droop at the middle (slack)
  line(pts, col, alpha = 1, wob = 0, sag = 0, t = 0) {
    if (this.n >= this.cap || pts.length < 2) return;
    const i = this.n++;
    this.write(this.core, i, pts, col, alpha, wob, sag, t, 1);
    this.write(this.halo, i, pts, col, alpha * .32, wob, sag, t, 1);
  }
  write(L, li, pts, col, alpha, wob, sag, t) {
    const pos = L.g.attributes.position.array, cc = L.g.attributes.color.array, cam = this.cam;
    // total length, to walk the polyline evenly
    let tot = 0;
    for (let k = 1; k < pts.length; k++) tot += pts[k].distanceTo(pts[k - 1]);
    let seg = 1, acc = 0;
    for (let s = 0; s <= SEG; s++) {
      const u = s / SEG, want = u * tot;
      while (seg < pts.length - 1 && acc + pts[seg].distanceTo(pts[seg - 1]) < want) { acc += pts[seg].distanceTo(pts[seg - 1]); seg++; }
      const a = pts[seg - 1], b = pts[seg], sl = a.distanceTo(b) || 1, f = Math.min(1, Math.max(0, (want - acc) / sl));
      _p.lerpVectors(a, b, f);
      // droop and wave (both zero at the ends)
      const env = Math.sin(Math.PI * u);
      _p.y -= sag * env;
      if (wob > 0) { const w = Math.sin(u * 22 - t * 40) * wob * env * .35; _p.x += w * .7; _p.y += w; _p.z -= w * .5; }
      // the ribbon faces the camera
      _d.subVectors(b, a).normalize();
      _c.subVectors(cam, _p);
      _s.crossVectors(_d, _c).normalize().multiplyScalar(L.width * (1 + .002 * _c.length()));
      const o = ((li * (SEG + 1)) + s) * 2;
      pos[o * 3] = _p.x - _s.x; pos[o * 3 + 1] = _p.y - _s.y; pos[o * 3 + 2] = _p.z - _s.z;
      pos[o * 3 + 3] = _p.x + _s.x; pos[o * 3 + 4] = _p.y + _s.y; pos[o * 3 + 5] = _p.z + _s.z;
      for (const q of [o, o + 1]) { cc[q * 4] = col.r; cc[q * 4 + 1] = col.g; cc[q * 4 + 2] = col.b; cc[q * 4 + 3] = alpha * (u > .96 ? 1 - (u - .96) * 10 : 1); }
    }
  }
  // a line that has been let go of: it springs loose and falls, fading out
  drop(a, b, col) {
    if (this.dead.length > 12) this.dead.shift();
    this.dead.push({ a: a.clone(), b: b.clone(), va: new V((Math.random() - .5) * 3, -2, (Math.random() - .5) * 3), t: 0, col: col.clone() });
  }
  end(dt) {
    for (let i = this.dead.length - 1; i >= 0; i--) {
      const d = this.dead[i];
      d.t += dt;
      if (d.t > .7) { this.dead.splice(i, 1); continue; }
      d.va.y -= 18 * dt; d.a.addScaledVector(d.va, dt);
      this.line([d.a, d.b], d.col, (1 - d.t / .7) * .8, 0, d.t * 6 + 1.5);
    }
    for (const L of [this.core, this.halo]) {
      // collapse unused lines
      const pos = L.g.attributes.position.array;
      for (let i = this.n * (SEG + 1) * 2 * 3; i < this.cap * (SEG + 1) * 2 * 3; i++) pos[i] = 0;
      L.g.attributes.position.needsUpdate = true; L.g.attributes.color.needsUpdate = true;
      L.g.setDrawRange(0, this.n * SEG * 6);
    }
  }
}
const _p = new V(), _d = new V(), _c = new V(), _s = new V();

// ------------------------------------------------------------------ particles
// Two pooled point clouds: soft (normal blending: puffs, dust, water, debris) and glow (additive: sparks,
// energy). Each particle: position, velocity, gravity, drag, size growth, colour, life.
export class Particles {
  constructor(scene, cap = 1600) {
    this.sets = [this.make(scene, cap, false), this.make(scene, Math.floor(cap * .6), true)];
  }
  make(scene, N, glow) {
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 4), size = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 700 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = clamp(size * scale / -mv.z, 0., 300.); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: glow
        ? `varying vec4 vC; void main(){ vec2 c = gl_PointCoord * 2. - 1.; float r = dot(c, c); if (r > 1.) discard; gl_FragColor = vec4(vC.rgb * (exp(-r * 3.) + exp(-r * 18.)) * vC.a, 1.); }`
        : `varying vec4 vC; void main(){ vec2 c = gl_PointCoord - .5; float d = dot(c, c); if (d > .25) discard; gl_FragColor = vec4(vC.rgb, vC.a * (1. - d * 4.)); }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false; pts.renderOrder = glow ? 8 : 5;
    scene.add(pts);
    const P = Array.from({ length: N }, () => ({ life: 0 }));
    return { N, pos, col, size, g, m, P, head: 0, pts };
  }
  // o: { x, y, z, vx, vy, vz, spread, n, life, size, grow, g, drag, r, gg, b, a, glow }
  emit(o) {
    const S = this.sets[o.glow ? 1 : 0], n = o.n || 1;
    for (let i = 0; i < n; i++) {
      const p = S.P[S.head]; S.head = (S.head + 1) % S.N;
      const sp = o.spread || 0, rnd = () => (Math.random() * 2 - 1);
      p.x = o.x + rnd() * (o.jitter || 0); p.y = o.y + rnd() * (o.jitter || 0); p.z = o.z + rnd() * (o.jitter || 0);
      p.vx = (o.vx || 0) + rnd() * sp; p.vy = (o.vy || 0) + rnd() * sp * (o.flat ? .3 : 1) + (o.up || 0) * Math.random(); p.vz = (o.vz || 0) + rnd() * sp;
      p.life = 1; p.max = (o.life || .8) * (.7 + Math.random() * .6);
      p.s = (o.size || .3) * (.7 + Math.random() * .6); p.grow = o.grow ?? 1;
      p.g = o.g ?? 0; p.drag = o.drag ?? 1.5;
      p.r = o.r ?? 1; p.gg = o.gg ?? 1; p.b = o.b ?? 1; p.a = o.a ?? .8;
      p.floor = o.floor ?? -1e9;
    }
  }
  update(dt, heightPx) {
    for (const S of this.sets) {
      for (let i = 0; i < S.N; i++) {
        const p = S.P[i];
        if (p.life > 0) {
          p.life -= dt / p.max;
          const k = Math.exp(-p.drag * dt);
          p.vx *= k; p.vy = p.vy * k - p.g * dt; p.vz *= k;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          if (p.y < p.floor) { p.y = p.floor; p.vy *= -.25; p.vx *= .6; p.vz *= .6; }
        }
        const o = i * 3, c = i * 4, on = p.life > 0;
        S.pos[o] = on ? p.x : 0; S.pos[o + 1] = on ? p.y : -1e4; S.pos[o + 2] = on ? p.z : 0;
        S.size[i] = on ? p.s * (1 + (1 - p.life) * p.grow) : 0;
        const fade = on ? Math.min(1, p.life * 2.5) : 0;
        S.col[c] = p.r; S.col[c + 1] = p.gg; S.col[c + 2] = p.b; S.col[c + 3] = p.a * fade;
      }
      S.g.attributes.position.needsUpdate = S.g.attributes.color.needsUpdate = S.g.attributes.size.needsUpdate = true;
      S.m.uniforms.scale.value = heightPx * .55;
    }
  }
  // ---- recipes ----
  puff(x, y, z, n = 10, nx = 0, ny = 0, nz = 0) { this.emit({ x, y, z, vx: nx * 3, vy: ny * 3, vz: nz * 3, spread: 2.2, n, life: .55, size: .35, grow: 2.2, drag: 4, r: .95, gg: .97, b: 1, a: .75 }); }
  dust(x, y, z, n = 14, power = 1) { this.emit({ x, y: y + .1, z, spread: 3 * power, flat: true, up: 1.2, n, life: .9, size: .5 * power, grow: 3, drag: 2.5, r: .62, gg: .6, b: .56, a: .45, jitter: .4 }); }
  sparks(x, y, z, n = 12, col = [1, .75, .3], power = 1) { this.emit({ x, y, z, spread: 7 * power, n, life: .35, size: .12, grow: -.5, g: 12, drag: 2, r: col[0] * 3, gg: col[1] * 3, b: col[2] * 3, a: 1, glow: true }); }
  energy(x, y, z, n = 10, col = [.4, .9, 1]) { this.emit({ x, y, z, spread: 2, n, life: .45, size: .25, grow: 1, drag: 3, r: col[0] * 2, gg: col[1] * 2, b: col[2] * 2, a: 1, glow: true }); }
  splash(x, y, z, n = 30) { this.emit({ x, y, z, spread: 2.5, up: 6, n, life: .9, size: .18, grow: .5, g: 18, drag: .5, r: .75, gg: .85, b: .95, a: .7, floor: y - .2 }); }
  glass(x, y, z, n = 24) { this.emit({ x, y, z, spread: 4, up: 2, n, life: 1.4, size: .1, grow: 0, g: 18, drag: .3, r: .8, gg: .95, b: 1, a: .9, floor: 0.02 }); }
  debris(x, y, z, n = 16, col = [.5, .48, .45]) { this.emit({ x, y, z, spread: 5, up: 5, n, life: 1.4, size: .14, grow: 0, g: 20, drag: .4, r: col[0], gg: col[1], b: col[2], a: 1, floor: 0.02 }); }
  rainSplash(x, y, z) { this.emit({ x, y, z, spread: .6, up: 1.4, n: 2, life: .25, size: .06, grow: .5, g: 10, drag: 1, r: .7, gg: .78, b: .86, a: .45 }); }
}

// ------------------------------------------------------------------ speed streaks
// Thin lines that rush past the camera when going fast: a cylinder of them along the direction of
// travel, recycled as they fall behind.
export class SpeedLines {
  constructor(scene, n = 90) {
    this.n = n;
    this.p = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0, len: 1, a: 0 }));
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 8);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.g = g;
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: "attribute vec4 color; varying vec4 vC; void main(){ vC = color; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }",
      fragmentShader: "varying vec4 vC; void main(){ gl_FragColor = vec4(vC.rgb * vC.a, 1.); }" });
    this.lines = new THREE.LineSegments(g, m);
    this.lines.frustumCulled = false; this.lines.renderOrder = 9;
    scene.add(this.lines);
    this.amt = 0;
  }
  update(dt, cam, vel) {
    const sp = vel.length();
    this.amt += ((sp > 26 ? Math.min(1, (sp - 26) / 30) : 0) - this.amt) * Math.min(1, dt * 4);
    this.lines.visible = this.amt > .02;
    if (!this.lines.visible) return;
    const d = _d.copy(vel).normalize();
    // a basis across the travel direction
    const a = Math.abs(d.y) < .9 ? _c.set(0, 1, 0) : _c.set(1, 0, 0);
    const u = _s.crossVectors(d, a).normalize(), w = _p.crossVectors(d, u);
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      // relative to the camera, along the travel direction
      let rel = (p.x - cam.x) * d.x + (p.y - cam.y) * d.y + (p.z - cam.z) * d.z;
      if (p.a <= 0 || rel < -6) {
        const ang = Math.random() * Math.PI * 2, r = 2.2 + Math.random() * 5, ahead = 18 + Math.random() * 30;
        p.x = cam.x + d.x * ahead + (u.x * Math.cos(ang) + w.x * Math.sin(ang)) * r;
        p.y = cam.y + d.y * ahead + (u.y * Math.cos(ang) + w.y * Math.sin(ang)) * r;
        p.z = cam.z + d.z * ahead + (u.z * Math.cos(ang) + w.z * Math.sin(ang)) * r;
        p.len = 1.5 + Math.random() * 3; p.a = .2 + Math.random() * .5;
        rel = ahead;
      }
      // they stand still in the world: the camera flies past them
      const o = i * 6, L = p.len * (.5 + this.amt);
      this.pos[o] = p.x; this.pos[o + 1] = p.y; this.pos[o + 2] = p.z;
      this.pos[o + 3] = p.x - d.x * L; this.pos[o + 4] = p.y - d.y * L; this.pos[o + 5] = p.z - d.z * L;
      const al = p.a * this.amt * Math.min(1, rel / 10);
      for (const q of [0, 4]) { this.col[i * 8 + q] = .85; this.col[i * 8 + q + 1] = .92; this.col[i * 8 + q + 2] = 1; this.col[i * 8 + q + 3] = Math.max(0, al) * (q ? .2 : .8); }
    }
    this.g.attributes.position.needsUpdate = this.g.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ trails
// Ribbons off the hands and feet while doing tricks or going very fast. Each trail keeps its recent
// points and draws them as a camera-facing strip that thins and fades towards the tail.
export class Trails {
  constructor(scene, count = 6, len = 18) {
    this.count = count; this.len = len;
    this.t = Array.from({ length: count }, () => ({ pts: [], on: 0, col: new THREE.Color(1, 1, 1) }));
    const n = count * len * 2;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let k = 0; k < count; k++) for (let i = 0; i < len - 1; i++) { const a = (k * len + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.g = g;
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: "attribute vec4 color; varying vec4 vC; void main(){ vC = color; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }",
      fragmentShader: "varying vec4 vC; void main(){ gl_FragColor = vec4(vC.rgb * vC.a, 1.); }" });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 7;
    scene.add(this.mesh);
  }
  // feed point i of trail k this frame; on: 0..1 how strongly it is drawn
  push(k, p, on, col) {
    const T = this.t[k];
    T.on += (on - T.on) * .25;
    if (col) T.col.copy(col);
    T.pts.unshift(p.clone());
    if (T.pts.length > this.len) T.pts.pop();
  }
  update(cam) {
    for (let k = 0; k < this.count; k++) {
      const T = this.t[k];
      for (let i = 0; i < this.len; i++) {
        const a = T.pts[Math.min(i, T.pts.length - 1)], b = T.pts[Math.min(i + 1, T.pts.length - 1)];
        const o = (k * this.len + i) * 2;
        if (!a) { for (const q of [o, o + 1]) { this.pos[q * 3] = this.pos[q * 3 + 1] = this.pos[q * 3 + 2] = 0; this.col[q * 4 + 3] = 0; } continue; }
        _d.subVectors(a, b); if (_d.lengthSq() < 1e-8) _d.set(0, 1, 0);
        _c.subVectors(cam, a);
        const f = 1 - i / (this.len - 1), w = .09 * f;
        _s.crossVectors(_d, _c).normalize().multiplyScalar(w);
        this.pos[o * 3] = a.x - _s.x; this.pos[o * 3 + 1] = a.y - _s.y; this.pos[o * 3 + 2] = a.z - _s.z;
        this.pos[o * 3 + 3] = a.x + _s.x; this.pos[o * 3 + 4] = a.y + _s.y; this.pos[o * 3 + 5] = a.z + _s.z;
        for (const q of [o, o + 1]) { this.col[q * 4] = T.col.r; this.col[q * 4 + 1] = T.col.g; this.col[q * 4 + 2] = T.col.b; this.col[q * 4 + 3] = T.on * f * f * .9; }
      }
    }
    this.g.attributes.position.needsUpdate = this.g.attributes.color.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ rings (landing shockwaves, hits)
export class Rings {
  constructor(scene, n = 10) {
    this.list = [];
    this.geo = new THREE.RingGeometry(.85, 1, 48).rotateX(-Math.PI / 2);
    this.pool = Array.from({ length: n }, () => {
      const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.visible = false; m.renderOrder = 7; scene.add(m);
      return m;
    });
    this.i = 0;
  }
  spawn(x, y, z, size = 4, col = 0xffffff, life = .5, up = null) {
    const m = this.pool[this.i++ % this.pool.length];
    m.position.set(x, y, z); m.visible = true; m.material.color.setHex(col);
    m.quaternion.identity();
    if (up) m.quaternion.setFromUnitVectors(_c.set(0, 1, 0), up);
    m.userData = { t: 0, life, size };
    this.list.push(m);
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i], u = m.userData;
      u.t += dt;
      const k = u.t / u.life;
      if (k >= 1) { m.visible = false; this.list.splice(i, 1); continue; }
      m.scale.setScalar(.3 + u.size * (1 - (1 - k) ** 3));
      m.material.opacity = (1 - k) * .55;
    }
  }
}

// ------------------------------------------------------------------ tracers (gunfire)
export class Tracers {
  constructor(scene, n = 40) {
    this.n = n; this.list = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 6); this.col = new Float32Array(n * 8);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.g = g;
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: "attribute vec4 color; varying vec4 vC; void main(){ vC = color; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }",
      fragmentShader: "varying vec4 vC; void main(){ gl_FragColor = vec4(vC.rgb * vC.a, 1.); }" });
    this.lines = new THREE.LineSegments(g, m);
    this.lines.frustumCulled = false; this.lines.renderOrder = 9;
    scene.add(this.lines);
  }
  // a bullet: from where, which way, how fast
  add(x, y, z, vx, vy, vz, col = [3, 2.2, 1.2]) { if (this.list.length >= this.n) this.list.shift(); this.list.push({ x, y, z, vx, vy, vz, t: 0, col }); }
  // a laser sight: a still line for one frame
  sight(ax, ay, az, bx, by, bz, a) { this.list.push({ x: ax, y: ay, z: az, bx, by, bz, t: 0, col: [3, .1, .1], beam: a }); }
  update(dt) {
    let k = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.beam !== undefined) {
        if (k < this.n) this.write(k++, s.x, s.y, s.z, s.bx, s.by, s.bz, s.col, s.beam, s.beam * .4);
        this.list.splice(i, 1);
        continue;
      }
      s.t += dt;
      if (s.t > .45) { this.list.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const L = .045;
      if (k < this.n) this.write(k++, s.x, s.y, s.z, s.x - s.vx * L, s.y - s.vy * L, s.z - s.vz * L, s.col, 1, 0);
    }
    for (let i = k; i < this.n; i++) for (let j = 0; j < 6; j++) this.pos[i * 6 + j] = 0;
    this.g.attributes.position.needsUpdate = this.g.attributes.color.needsUpdate = true;
  }
  write(i, ax, ay, az, bx, by, bz, c, a0, a1) {
    const o = i * 6;
    this.pos[o] = ax; this.pos[o + 1] = ay; this.pos[o + 2] = az; this.pos[o + 3] = bx; this.pos[o + 4] = by; this.pos[o + 5] = bz;
    const q = i * 8;
    this.col[q] = c[0]; this.col[q + 1] = c[1]; this.col[q + 2] = c[2]; this.col[q + 3] = a0;
    this.col[q + 4] = c[0]; this.col[q + 5] = c[1]; this.col[q + 6] = c[2]; this.col[q + 7] = a1;
  }
}

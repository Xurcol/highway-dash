// City Drive, drawn. The map (city-map.js) is built the first time the mode opens and turned into a
// few dozen merged and instanced meshes; after that only the traffic, the signals, the lamps and the
// minimap change from frame to frame. Nothing here is synced: every player runs the same map, the
// same signal clock, and their own traffic.
import * as THREE from "three";
import { patchLit } from "./lights.js";
import { makeTrafficCar, BODIES } from "./cars.js";
import {
  buildCity, CityTraffic, CITY_BODIES, signalAt, heightAt, groundAt, pushCircle, insideSolid, districtAt, ringSD, offsetPts, hash,
  DOWN, RING, DECK_Y, DECK_HW, DECK_T, RAMP_HW, EDGE, CURB, BRANDS,
} from "./city-map.js";

// ---------------------------------------------------------------- textures
function canvasTex(size, draw) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
// per-pixel grain tiles by itself
function speckle(g, S, n, spread, size = 1) {
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - .5) * spread;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect((Math.random() * S) | 0, (Math.random() * S) | 0, size, size);
  }
}
// soft stains, drawn wrapped round the edges so the tile has no seams
function blotches(g, S, n, col, rmin, rmax) {
  for (let i = 0; i < n; i++) {
    const r = rmin + Math.random() * (rmax - rmin), x = Math.random() * S, y = Math.random() * S, c = col();
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const cx = x + ox, cy = y + oy;
      if (cx + r < 0 || cx - r > S || cy + r < 0 || cy - r > S) continue;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, c); grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
}
const TILE = { road: 8, walk: 3, grass: 6, gravel: 4 };   // metres per texture repeat
const asphaltTex = () => canvasTex(512, (g, S) => {
  g.fillStyle = "#3b3e43"; g.fillRect(0, 0, S, S);
  blotches(g, S, 26, () => (Math.random() < .55 ? "rgba(18,20,24,.32)" : "rgba(96,98,102,.16)"), 30, 150);
  speckle(g, S, S * S * .6, .2);
  speckle(g, S, 2200, .32, 2);
  g.strokeStyle = "rgba(12,12,14,.45)"; g.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    let x = 120 + Math.random() * 272, y = 120 + Math.random() * 272;
    g.beginPath(); g.moveTo(x, y);
    for (let j = 0; j < 8; j++) { x += (Math.random() - .5) * 36; y += (Math.random() - .5) * 36; g.lineTo(x, y); }
    g.stroke();
  }
});
const pavingTex = () => canvasTex(256, (g, S) => {
  g.fillStyle = "#aeaba4"; g.fillRect(0, 0, S, S);
  blotches(g, S, 10, () => (Math.random() < .5 ? "rgba(60,58,54,.12)" : "rgba(255,255,255,.08)"), 20, 70);
  speckle(g, S, S * S * .5, .16);
  g.fillStyle = "rgba(58,56,52,.55)";
  for (const p of [0, S / 2]) { g.fillRect(p, 0, 2, S); g.fillRect(0, p, S, 2); }
});
const grassTex = () => canvasTex(256, (g, S) => {
  g.fillStyle = "#5c6d3e"; g.fillRect(0, 0, S, S);
  blotches(g, S, 18, () => (Math.random() < .5 ? "rgba(36,48,22,.4)" : "rgba(128,136,78,.25)"), 20, 90);
  speckle(g, S, S * S * .8, .25);
});
const gravelTex = () => canvasTex(256, (g, S) => {
  g.fillStyle = "#6a665f"; g.fillRect(0, 0, S, S);
  blotches(g, S, 12, () => "rgba(30,28,26,.25)", 20, 80);
  speckle(g, S, S * S * .9, .4);
});
const concreteTex = () => canvasTex(256, (g, S) => {
  g.fillStyle = "#b9b5ac"; g.fillRect(0, 0, S, S);
  blotches(g, S, 14, () => (Math.random() < .6 ? "rgba(70,66,60,.14)" : "rgba(255,255,255,.1)"), 20, 90);
  speckle(g, S, S * S * .4, .12);
});
// an exit sign: green board, white border, the exit tab and two lines of destinations
function signTex(tab, a, b) {
  const c = document.createElement("canvas"); c.width = 768; c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#12603a"; g.fillRect(0, 0, 768, 256);
  g.strokeStyle = "#eef2ee"; g.lineWidth = 8; g.strokeRect(12, 12, 744, 232);
  g.fillStyle = "#eef2ee"; g.fillRect(560, 12, 196, 58);
  g.fillStyle = "#12603a"; g.font = "bold 40px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(tab, 658, 42);
  g.fillStyle = "#eef2ee"; g.textAlign = "left"; g.font = "bold 76px sans-serif"; g.fillText(a, 44, 116);
  g.font = "bold 50px sans-serif"; g.fillText(b, 44, 196);
  // the arrow down to the right lane
  g.lineWidth = 14; g.beginPath(); g.moveTo(620, 110); g.lineTo(690, 190); g.stroke();
  g.beginPath(); g.moveTo(700, 200); g.lineTo(650, 196); g.lineTo(696, 150); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// one canvas, drawn once, as a texture that is not tiled
function picture(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
// lane arrows, painted white on a transparent ground: a stem, and a head for each way the lane may go
const arrowTex = (type) => picture(160, 320, (g) => {
  g.fillStyle = g.strokeStyle = "#fff"; g.lineWidth = 16; g.lineJoin = "round";
  const head = (x, y, ang) => { g.save(); g.translate(x, y); g.rotate(ang); g.beginPath(); g.moveTo(0, -28); g.lineTo(24, 6); g.lineTo(-24, 6); g.closePath(); g.fill(); g.restore(); };
  g.beginPath(); g.moveTo(80, 318); g.lineTo(80, 150); g.stroke();
  if (type.includes("S")) { g.beginPath(); g.moveTo(80, 152); g.lineTo(80, 56); g.stroke(); head(80, 36, 0); }
  if (type.includes("L")) { g.beginPath(); g.moveTo(80, 176); g.quadraticCurveTo(80, 120, 44, 120); g.stroke(); head(34, 120, -Math.PI / 2); }
  if (type.includes("R")) { g.beginPath(); g.moveTo(80, 176); g.quadraticCurveTo(80, 120, 116, 120); g.stroke(); head(126, 120, Math.PI / 2); }
});
// a signal lens: a round light, or a left arrow
const lensTex = (arrow) => picture(64, 64, (g) => {
  g.fillStyle = "#fff"; g.beginPath();
  if (arrow) { g.fillRect(26, 26, 30, 12); g.moveTo(6, 32); g.lineTo(30, 10); g.lineTo(30, 54); g.closePath(); }
  else g.arc(32, 32, 30, 0, Math.PI * 2);
  g.fill();
});
// every sign face, by key: street names, lane and turn rules, speed limits, fuel prices, tower logos
const PRICES = { VOLTA: ["3.49", "3.89", "4.29"], NORTHSTAR: ["3.45", "3.85", "4.25"], APEX: ["3.39", "3.79", "4.19"] };
function signFace(key, brands) {
  const i = key.indexOf(":"), kind = i < 0 ? key : key.slice(0, i), arg = i < 0 ? "" : key.slice(i + 1);
  const plate = (w, h, draw) => picture(w, h, (g) => { g.fillStyle = "#f4f4f0"; g.fillRect(0, 0, w, h); g.strokeStyle = "#141414"; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20); g.fillStyle = "#141414"; g.textAlign = "center"; g.textBaseline = "middle"; draw(g, w, h); });
  if (kind === "street") return picture(640, 130, (g, w, h) => {
    g.fillStyle = "#17643a"; g.fillRect(0, 0, w, h); g.strokeStyle = "#f4f4f0"; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = "#f4f4f0"; g.font = "bold 72px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(arg, w / 2, h / 2 + 3);
  });
  if (kind === "leftonly") return plate(250, 320, (g, w) => {
    g.font = "bold 56px sans-serif"; g.fillText("LEFT", w / 2, 62); g.fillText("ONLY", w / 2, 268);
    g.lineWidth = 22; g.beginPath(); g.moveTo(150, 220); g.lineTo(150, 160); g.quadraticCurveTo(150, 140, 120, 140); g.lineTo(100, 140); g.stroke();
    g.beginPath(); g.moveTo(60, 140); g.lineTo(104, 106); g.lineTo(104, 174); g.closePath(); g.fill();
  });
  if (kind === "notor") return plate(250, 320, (g, w) => { g.font = "bold 62px sans-serif"; g.fillText("NO", w / 2, 82); g.fillText("TURN", w / 2, 160); g.font = "bold 50px sans-serif"; g.fillText("ON RED", w / 2, 238); });
  if (kind === "speed30" || kind === "speed45") return plate(250, 330, (g, w) => {
    g.font = "bold 42px sans-serif"; g.fillText("SPEED", w / 2, 58); g.fillText("LIMIT", w / 2, 104); g.font = "bold 128px sans-serif"; g.fillText(kind.slice(5), w / 2, 222);
  });
  if (kind === "price") return picture(320, 400, (g, w, h) => {
    const b = brands.find((x) => x.name === arg), col = "#" + b.col.toString(16).padStart(6, "0"), p = PRICES[arg] || PRICES.APEX;
    g.fillStyle = "#16171a"; g.fillRect(0, 0, w, h);
    g.fillStyle = col; g.fillRect(0, 0, w, 120);
    g.fillStyle = "#fff"; g.font = "bold 58px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(arg, w / 2, 64);
    g.textAlign = "left"; g.font = "bold 26px sans-serif"; g.fillStyle = "#d8d8d4";
    ["REGULAR", "PLUS", "PREMIUM"].forEach((t, k) => g.fillText(t, 22, 172 + k * 82));
    g.textAlign = "right"; g.font = "bold 54px monospace"; g.fillStyle = "#ffb12a";
    p.forEach((t, k) => g.fillText(t, w - 18, 174 + k * 82));
  });
  // a tower's name: white letters on nothing, lit from inside at night
  return picture(1024, 222, (g, w, h) => {
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    let size = 170; g.font = `bold ${size}px sans-serif`;
    while (g.measureText(arg).width > w * .92 && size > 40) { size -= 8; g.font = `bold ${size}px sans-serif`; }
    g.fillText(arg, w / 2, h / 2 + 6);
  });
}

// ---------------------------------------------------------------- facades
// Five looks, each a window grid laid on in world space so any box becomes a building: stone,
// blue glass, bronze glass, brick, industrial panels. The ground floor is shop fronts (tall glass,
// lit warm at night); roofs are darker; windows reflect the sky and light up at random after dark.
const cityGlow = { value: 0 };
const FACADES = [
  { cw: 3.2, ch: 3.6, fx: .2, y0: .26, y1: .8, glass: [.05, .07, .09], lit: .45, r: .85, shop: true },
  { cw: 1.6, ch: 3.6, fx: .05, y0: .07, y1: .93, glass: [.04, .08, .12], lit: .34, r: .5, shop: true },
  { cw: 2.2, ch: 3.9, fx: .06, y0: .1, y1: .9, glass: [.09, .07, .05], lit: .3, r: .5, shop: true },
  { cw: 2.8, ch: 3.4, fx: .24, y0: .28, y1: .78, glass: [.05, .06, .07], lit: .5, r: .92, shop: true },
  { cw: 7, ch: 8, fx: .12, y0: .62, y1: .8, glass: [.12, .14, .16], lit: .18, r: .8, shop: false },
];
function facadeMaterial(i) {
  const F = FACADES[i], f = (v) => v.toFixed(3), v3 = (a) => `vec3(${a.map(f).join(",")})`;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: F.r, metalness: .05 });
  const extra = (shader) => {
    shader.uniforms.cityGlow = cityGlow;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;")
      .replace("#include <begin_vertex>", [
        "#include <begin_vertex>",
        "mat4 wm_ = modelMatrix;",
        "#ifdef USE_INSTANCING",
        "wm_ = modelMatrix * instanceMatrix;",
        "#endif",
        "vWPos = (wm_ * vec4(transformed, 1.0)).xyz;",
        "vWNorm = normalize(mat3(wm_) * objectNormal);",
      ].join("\n"));
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm; uniform float cityGlow; float winMask; float winRnd; float shopM;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        { vec3 an = abs(vWNorm); float wall = step(an.y, .5);
          vec2 q = an.x > an.z ? vWPos.zy : vWPos.xy;
          shopM = ${F.shop ? "step(vWPos.y, 5.3) * wall" : "0.0"};
          vec2 cs = mix(vec2(${f(F.cw)}, ${f(F.ch)}), vec2(4.4, 5.2), shopM);
          vec2 cell = floor(q / cs); vec2 fr = fract(q / cs);
          float fx = mix(${f(F.fx)}, .07, shopM), wy0 = mix(${f(F.y0)}, .12, shopM), wy1 = mix(${f(F.y1)}, .93, shopM);
          winMask = step(fx, fr.x) * step(fr.x, 1. - fx) * step(wy0, fr.y) * step(fr.y, wy1) * wall * step(.75, vWPos.y);
          winRnd = fract(sin(dot(cell + floor(vWPos.xz / 37.0) * 13.0, vec2(12.9898, 78.233))) * 43758.5453);
          diffuseColor.rgb *= mix(.55, 1., wall) * (.78 + .22 * smoothstep(0., 24., vWPos.y));
          diffuseColor.rgb = mix(diffuseColor.rgb, ${v3(F.glass)}, winMask * .93); }`)
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .06, winMask); metalnessFactor = mix(metalnessFactor, .9, winMask);")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += winMask * step(1. - mix(${f(F.lit)}, .8, shopM), winRnd) * cityGlow
          * mix(mix(vec3(1., .72, .42), vec3(.62, .8, 1.), step(.86, winRnd)), vec3(1., .85, .6), shopM) * mix(1.4, 2.2, shopM);`);
  };
  extra.key = "cityfac" + i;
  return patchLit(m, extra);
}

// ---------------------------------------------------------------- geometry helpers
// Flat-shaded triangles with world-space texture coordinates, so the tile scale is the same on every
// surface and coplanar pieces (a ramp landing on an avenue) look like one road.
class GB {
  constructor(tile = 1) { this.t = tile; this.p = []; this.n = []; this.u = []; }
  tri(a, b, c, want, uv) {
    let e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2], e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (nx * want[0] + ny * want[1] + nz * want[2] < 0) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    const L = Math.hypot(nx, ny, nz) || 1;
    for (const v of [a, b, c]) {
      this.p.push(v[0], v[1], v[2]); this.n.push(nx / L, ny / L, nz / L);
      const [u, w] = uv ? uv(v) : Math.abs(ny) > .5 * L ? [v[0] / this.t, v[2] / this.t] : [(v[0] + v[2]) / this.t, v[1] / this.t];
      this.u.push(u, w);
    }
  }
  quad(a, b, c, d, want, uv) { this.tri(a, b, c, want, uv); this.tri(a, c, d, want, uv); }
  // a quad with texture coordinates of its own (a sign, a decal): uvs in the same order as the corners
  quadUV(a, b, c, d, uvs, want) { const at = new Map([[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [d, uvs[3]]]); this.quad(a, b, c, d, want, (v) => at.get(v)); }
  // an axis-aligned box's top and four sides
  slab(x0, z0, x1, z1, y0, y1, top = true, sides = null) {
    if (top) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]);
    const S = sides || this;
    S.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]);
    S.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    S.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    S.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0]);
  }
  mesh(mat, parent, { shadow = false, receive = true } = {}) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow; m.receiveShadow = receive;
    parent.add(m);
    return m;
  }
}
// instanced boxes (or any shape) with per-instance colour
class Inst {
  constructor(parent, geo, mat, cap, { shadow = true, colors = false } = {}) {
    this.cap = Math.max(1, cap);
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.castShadow = shadow; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    if (colors) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.n = 0;
    parent.add(this.mesh);
  }
  static m = new THREE.Matrix4(); static q = new THREE.Quaternion(); static e = new THREE.Euler(); static p = new THREE.Vector3(); static s = new THREE.Vector3(); static c = new THREE.Color();
  static X = new THREE.Vector3(); static Y = new THREE.Vector3(); static Z = new THREE.Vector3();
  add(x, y, z, sx, sy, sz, rotY = 0, color) {
    if (this.n >= this.cap) return;
    Inst.q.setFromEuler(Inst.e.set(0, rotY, 0));
    Inst.m.compose(Inst.p.set(x, y, z), Inst.q, Inst.s.set(sx, sy, sz));
    this.put(color);
  }
  // a box laid from a to b (any slope): its x along the run, y up, z across
  span(ax, ay, az, bx, by, bz, sy, sz, color) {
    if (this.n >= this.cap) return;
    const X = Inst.X.set(bx - ax, by - ay, bz - az), L = X.length();
    if (L < 1e-4) return;
    X.divideScalar(L);
    const Y = Inst.Y.set(0, 1, 0).addScaledVector(X, -X.y).normalize(), Z = Inst.Z.crossVectors(X, Y);
    Inst.m.makeBasis(X, Y, Z).scale(Inst.s.set(L + .04, sy, sz)).setPosition((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    this.put(color);
  }
  put(color) {
    this.mesh.setMatrixAt(this.n, Inst.m);
    if (color !== undefined && this.mesh.instanceColor) this.mesh.setColorAt(this.n, typeof color === "object" ? color : Inst.c.set(color));
    this.n++;
  }
  begin() { this.n = 0; }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
const BOXC = new THREE.BoxGeometry(1, 1, 1);

// ---------------------------------------------------------------- the city
export class City {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.group = null; this.M = null; this.traffic = null;
    this.pool = new Map(); this.meshes = new Map();
    this.lightPool = []; this.carLights = [];
    this.mapEl = null;
  }
  get ready() { return !!this.M; }
  show(on) {
    if (on && !this.M) this.build();
    if (this.group) this.group.visible = on;
    if (this.mapEl) this.mapEl.hidden = !on;
    if (!on && this.traffic) { this.traffic.clear(); this.releaseAll(); }
  }

  build() {
    const M = this.M = buildCity();
    const G = this.group = new THREE.Group();
    this.scene.add(G);
    const lit = (o) => patchLit(new THREE.MeshStandardMaterial(o));
    const tex = { road: asphaltTex(), walk: pavingTex(), grass: grassTex(), gravel: gravelTex(), concrete: concreteTex() };
    const mat = this.mat = {
      road: lit({ map: tex.road, roughness: .9 }),
      walk: lit({ map: tex.walk, roughness: .95 }),
      curb: lit({ map: tex.concrete, color: 0xd6d2c8, roughness: .9 }),
      grass: lit({ map: tex.grass, roughness: 1 }),
      gravel: lit({ map: tex.gravel, roughness: 1 }),
      concrete: lit({ map: tex.concrete, roughness: .88 }),
      white: lit({ color: 0xe8e8e2, roughness: .65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      yellow: lit({ color: 0xd6a22a, roughness: .65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      metal: lit({ color: 0x4d5258, roughness: .45, metalness: .65 }),
      housing: lit({ color: 0x1b1d20, roughness: .55, metalness: .3 }),
      trunk: lit({ color: 0x57412e, roughness: .95 }),
      crown: lit({ color: 0xffffff, roughness: .9, flatShading: true }),
      roof: lit({ color: 0xffffff, roughness: .75, metalness: .25 }),
      rail: lit({ color: 0xb4b9bf, roughness: .35, metalness: .75 }),
      head: new THREE.MeshBasicMaterial({ color: 0xfff0d0, toneMapped: false }),
      lens: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    };
    tex.road.repeat.set(1, 1);

    // ---- ground: grass everywhere, gravel under the ring ----
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200).rotateX(-Math.PI / 2), mat.grass);
    ground.geometry.attributes.uv.array.forEach((v, i, a) => (a[i] = v * 4200 / TILE.grass));
    ground.position.y = -.03; ground.receiveShadow = true;
    G.add(ground);
    const gravel = new GB(TILE.gravel), C = M.ring, L14 = offsetPts(C, -14.6, true), R14 = offsetPts(C, 14.6, true);
    for (let i = 0; i < C.length - 1; i++) {
      if (Math.min(Math.abs(C[i].x), Math.abs(C[i].z)) < 15) continue;   // the avenues pass under here
      gravel.quad([L14[i].x, .005, L14[i].z], [R14[i].x, .005, R14[i].z], [R14[i + 1].x, .005, R14[i + 1].z], [L14[i + 1].x, .005, L14[i + 1].z], [0, 1, 0]);
    }
    gravel.mesh(mat.gravel, G);

    // ---- roads: street rectangles, the ring deck, the ramps ----
    const road = new GB(TILE.road), sides = new GB(3);
    for (const r of M.roads) { const { x0, z0, x1, z1 } = r.rect; road.quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, 1, 0]); }
    const ribbon = (pts, hw, closed, bottomOf, caps) => {
      const Lp = offsetPts(pts, -hw, closed), Rp = offsetPts(pts, hw, closed);
      const sideUV = (v) => [(v[0] + v[2]) / 3, v[1] / 3];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = Lp[i], b = Rp[i], c = Rp[i + 1], d = Lp[i + 1], ya = pts[i].y, yb = pts[i + 1].y, ba = bottomOf(ya), bb = bottomOf(yb);
        road.quad([a.x, ya, a.z], [b.x, ya, b.z], [c.x, yb, c.z], [d.x, yb, d.z], [0, 1, 0]);
        const nx = pts[i + 1].z - pts[i].z, nz = -(pts[i + 1].x - pts[i].x);     // left of travel
        if (ya > .02 || yb > .02) {
          sides.quad([a.x, ya, a.z], [d.x, yb, d.z], [d.x, bb, d.z], [a.x, ba, a.z], [nx, 0, nz], sideUV);
          sides.quad([b.x, ya, b.z], [c.x, yb, c.z], [c.x, bb, c.z], [b.x, ba, b.z], [-nx, 0, -nz], sideUV);
        }
        if (ba > 0 && bb > 0) sides.quad([a.x, ba - .02, a.z], [b.x, ba - .02, b.z], [c.x, bb - .02, c.z], [d.x, bb - .02, d.z], [0, -1, 0]);
        // where an embankment becomes a viaduct, close its end
        if (caps && (ba > 0) !== (bb > 0)) {
          const [p, q, y] = ba > 0 ? [c, d, yb] : [a, b, ya], k = ba > 0 ? -1 : 1;   // it faces the open side
          sides.quad([p.x, 0, p.z], [q.x, 0, q.z], [q.x, y, q.z], [p.x, y, p.z], [k * (pts[i + 1].x - pts[i].x), 0, k * (pts[i + 1].z - pts[i].z)], sideUV);
        }
      }
    };
    ribbon(C, DECK_HW, true, (y) => y - DECK_T);
    for (const r of M.ramps) ribbon(r.pts, RAMP_HW, false, (y) => (y > 5 ? y - DECK_T : 0), true);
    road.mesh(mat.road, G);
    sides.mesh(mat.concrete, G, { shadow: true });

    // ---- sidewalks, lots, parks, parking ----
    const walk = new GB(TILE.walk), curb = new GB(3), park = new GB(TILE.grass), lot = new GB(TILE.road);
    for (const s of M.slabs) {
      const top = s.kind === "park" ? park : s.kind === "parking" ? lot : walk;
      top.quad([s.x0, s.h, s.z0], [s.x1, s.h, s.z0], [s.x1, s.h, s.z1], [s.x0, s.h, s.z1], [0, 1, 0]);
      curb.slab(s.x0, s.z0, s.x1, s.z1, 0, s.h, false);
    }
    walk.mesh(mat.walk, G); curb.mesh(mat.curb, G); park.mesh(mat.grass, G); lot.mesh(mat.road, G);

    // ---- road markings ----
    const white = new GB(1), yellow = new GB(1);
    for (const k of M.marks) {
      const dx = k.bx - k.ax, dz = k.bz - k.az, L = Math.hypot(dx, dz);
      if (L < 1e-3) continue;
      const px = (-dz / L) * k.w / 2, pz = (dx / L) * k.w / 2, ya = k.ay + .018, yb = k.by + .018;
      (k.c ? yellow : white).quad([k.ax - px, ya, k.az - pz], [k.ax + px, ya, k.az + pz], [k.bx + px, yb, k.bz + pz], [k.bx - px, yb, k.bz - pz], [0, 1, 0], () => [0, 0]);
    }
    white.mesh(mat.white, G); yellow.mesh(mat.yellow, G);
    const arrowsBy = new Map();
    for (const a of M.arrows) {
      let b = arrowsBy.get(a.type);
      if (!b) arrowsBy.set(a.type, (b = new GB(1)));
      const rx = -a.dz * 1.1, rz = a.dx * 1.1, fx = a.dx * 2.2, fz = a.dz * 2.2, y = .02;
      b.quadUV([a.x - rx - fx, y, a.z - rz - fz], [a.x + rx - fx, y, a.z + rz - fz], [a.x + rx + fx, y, a.z + rz + fz], [a.x - rx + fx, y, a.z - rz + fz], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);
    }
    for (const [type, b] of arrowsBy) b.mesh(lit({ map: arrowTex(type), alphaTest: .5, color: 0xe8e8e2, roughness: .65, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), G);

    // ---- buildings, with a far skyline beyond the wall ----
    const byLook = [[], [], [], [], []];
    for (const b of M.buildings) byLook[b.v].push(b);
    const sky = [];
    for (let i = 0; i < 110; i++) {
      const a = hash(i, 5, 99) * Math.PI * 2, d = 900 + hash(i, 6, 99) * 700, w = 30 + hash(i, 7, 99) * 40, dd = 30 + hash(i, 8, 99) * 40;
      const cl = Math.pow(Math.max(0, Math.cos(a * 3 + 1)), 3), h = 25 + hash(i, 9, 99) * 70 + cl * 180, v = h > 110 ? 1 + (i % 2) : i % 3 === 0 ? 3 : 0;
      sky.push({ x0: Math.cos(a) * d - w / 2, z0: Math.sin(a) * d - dd / 2, x1: Math.cos(a) * d + w / 2, z1: Math.sin(a) * d + dd / 2, y0: 0, y1: h, v, col: 0x8a9098 });
    }
    for (const b of sky) byLook[b.v].push(b);
    this.bldg = byLook.map((list, v) => {
      const I = new Inst(G, BOX, facadeMaterial(v), list.length, { colors: true });
      for (const b of list) I.add((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2, b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0, 0, b.col);
      I.end();
      return I;
    });
    const roofs = new Inst(G, BOX, mat.roof, M.roofs.length, { colors: true });
    for (const r of M.roofs) roofs.add(r.x, r.y, r.z, r.sx, r.sy, r.sz, 0, r.col);
    roofs.end();

    // ---- the ring's structure: piers, caps, barriers, the rail on top ----
    const pier = new Inst(G, new THREE.CylinderGeometry(1, 1, 1, 14).translate(0, .5, 0), mat.concrete, M.pillars.length);
    for (const p of M.pillars) pier.add(p.x, 0, p.z, p.r, p.y1, p.r);
    pier.end();
    const caps = new Inst(G, BOXC, mat.concrete, M.caps.length);
    for (const c of M.caps) caps.add(c.x, c.y, c.z, c.sx, c.sy, c.sz, c.rotY);
    caps.end();
    const jersey = new Inst(G, BOX, mat.concrete, M.barriers.length, { shadow: false });
    const rail = new Inst(G, BOX, mat.rail, M.barriers.length, { shadow: false });
    for (const b of M.barriers) {
      jersey.span(b.ax, b.ay, b.az, b.bx, b.by, b.bz, .95, .42);
      rail.span(b.ax, b.ay + .95, b.az, b.bx, b.by + .95, b.bz, .12, .2);
    }
    jersey.end(); rail.end();

    // ---- street lamps ----
    this.heads = [];
    const poles = new Inst(G, new THREE.CylinderGeometry(.09, .14, 1, 8).translate(0, .5, 0), mat.metal, M.lamps.length, { shadow: false });
    const arms = new Inst(G, BOXC, mat.metal, M.lamps.length * 2, { shadow: false });
    const lampHeads = new Inst(G, BOXC, mat.head, M.lamps.length * 2, { shadow: false });
    const C0 = M.ring;
    for (const L of M.lamps) {
      const base = L.base || groundAt(M, L.x, L.z);
      poles.add(L.x, base, L.z, 1, L.y - base, 1);
      let dirs = [[L.ax, L.az]];
      if (L.twin) {
        // on the ring's median: one arm over each carriageway
        let bi = 0, bd = 1e9;
        for (let i = 0; i < C0.length - 1; i += 4) { const d = (C0[i].x - L.x) ** 2 + (C0[i].z - L.z) ** 2; if (d < bd) { bd = d; bi = i; } }
        const a = C0[bi], b = C0[bi + 1] || C0[1], dx = b.x - a.x, dz = b.z - a.z, n = Math.hypot(dx, dz) || 1;
        dirs = [[-dz / n, dx / n], [dz / n, -dx / n]];
      }
      for (const [ax, az] of dirs) {
        const hx = L.x + ax * 1.9, hz = L.z + az * 1.9;
        arms.span(L.x, L.y - .05, L.z, hx, L.y - .05, hz, .1, .1);
        lampHeads.add(hx, L.y - .12, hz, .75, .16, .75);
        this.heads.push({ x: hx, y: L.y - .25, z: hz });
      }
    }
    poles.end(); arms.end(); lampHeads.end();

    // ---- signals ----
    const props = new Inst(G, BOXC, mat.metal, M.props.length, { shadow: false });
    for (const p of M.props) props.add(p.x, p.y === 0 ? p.sy / 2 : p.y, p.z, p.sx, p.sy, p.sz, 0);   // poles stand on the ground; arms hang at their height
    props.end();
    const housings = new Inst(G, BOXC, mat.housing, M.heads.length * 5, { shadow: false });
    const lensMat = (arrow) => new THREE.MeshBasicMaterial({ map: lensTex(arrow), alphaTest: .4, toneMapped: false });
    const LENS_GEO = new THREE.PlaneGeometry(.27, .27);
    const nArrow = M.heads.filter((h) => h.arrow).length, nRound = M.heads.length - nArrow;
    const off = [new Inst(G, LENS_GEO, lensMat(false), nRound * 3, { shadow: false, colors: true }), new Inst(G, LENS_GEO, lensMat(true), nArrow * 3, { shadow: false, colors: true })];
    const dim = [new THREE.Color(.01, .13, .07), new THREE.Color(.17, .1, .01), new THREE.Color(.18, .025, .02)];
    for (const h of M.heads) {
      h.rot = Math.atan2(h.fx, h.fz);
      housings.add(h.x, h.y, h.z, .42, 1.16, .34, h.rot);                                                   // the head
      housings.add(h.x - h.fx * .19, h.y, h.z - h.fz * .19, .82, 1.5, .03, h.rot);                         // its backplate
      for (const [dy, k] of [[-.36, 0], [0, 1], [.36, 2]]) {
        housings.add(h.x + h.fx * .3, h.y + dy + .16, h.z + h.fz * .3, .34, .035, .26, h.rot);             // a visor over each lens
        off[h.arrow ? 1 : 0].add(h.x + h.fx * .175, h.y + dy, h.z + h.fz * .175, 1, 1, 1, h.rot, dim[k]);
      }
    }
    housings.end(); off[0].end(); off[1].end();
    this.lensOn = [new Inst(G, LENS_GEO, lensMat(false), nRound, { shadow: false, colors: true }), new Inst(G, LENS_GEO, lensMat(true), nArrow, { shadow: false, colors: true })];
    this.LENS = [new THREE.Color(.25, 3.4, 1.7), new THREE.Color(4, 2.2, .12), new THREE.Color(4.2, .28, .16)];

    // ---- signs: street names, LEFT ONLY, NO TURN ON RED, speed limits, fuel prices, tower names ----
    const faces = new Map(), backs = new GB(1);
    for (const s of M.signs) {
      let b = faces.get(s.tex);
      if (!b) faces.set(s.tex, (b = new GB(1)));
      const rx = s.fz * s.w / 2, rz = -s.fx * s.w / 2, h = s.h / 2, o = .02;   // right, as you look at the face
      const c = (sx, sy, k) => [s.x + rx * sx + s.fx * o * k, s.y + h * sy, s.z + rz * sx + s.fz * o * k];
      b.quadUV(c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1), [[0, 0], [1, 0], [1, 1], [0, 1]], [s.fx, 0, s.fz]);
      if (!s.tex.startsWith("logo:")) backs.quad(c(-1, -1, -1), c(1, -1, -1), c(1, 1, -1), c(-1, 1, -1), [-s.fx, 0, -s.fz]);
    }
    this.glowFaces = []; this.logoFaces = [];
    for (const [key, b] of faces) {
      const map = signFace(key, BRANDS);
      if (key.startsWith("logo:")) {
        const m = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
        b.mesh(m, G);
        this.logoFaces.push(m);
      } else {
        const m = new THREE.MeshStandardMaterial({ map, roughness: .55, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0 });
        b.mesh(m, G);
        this.glowFaces.push({ m, k: key.startsWith("price:") ? 1.2 : .45 });
      }
    }
    backs.mesh(mat.metal, G);

    // ---- gas stations: canopies, lit fascias, columns, islands, pumps ----
    const byMat = (k) => M.parts.filter((p) => p.mat === k);
    const partI = (k, material, opts) => {
      const list = byMat(k), I = new Inst(G, BOX, material, list.length, opts);
      for (const p of list) I.add((p.x0 + p.x1) / 2, p.y0, (p.z0 + p.z1) / 2, p.x1 - p.x0, p.y1 - p.y0, p.z1 - p.z0, 0, p.col);
      I.end();
      return I;
    };
    partI("canopy", lit({ color: 0xf2f2ee, roughness: .5 }));
    partI("column", lit({ color: 0xdcdcd6, roughness: .45, metalness: .2 }), { shadow: true });
    partI("island", mat.curb, { shadow: false });
    partI("pump", lit({ color: 0xeeeeea, roughness: .35, metalness: .1 }), { shadow: false });
    this.bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    partI("band", this.bandMat, { shadow: false, colors: true });
    this.stationLights = [];

    // ---- street furniture: hydrants, benches, bins, bus shelters, manholes, tree pits ----
    const F = M.furniture, cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 10).translate(0, h / 2, 0);
    const hyd = new Inst(G, cyl(.16, .72), lit({ color: 0xb3261e, roughness: .5 }), F.hydrants.length);
    for (const h of F.hydrants) hyd.add(h.x, CURB, h.z, 1, 1, 1);
    hyd.end();
    const bins = new Inst(G, cyl(.28, .95), lit({ color: 0x2b3a2e, roughness: .6, metalness: .3 }), F.bins.length);
    for (const b of F.bins) bins.add(b.x, CURB, b.z, 1, 1, 1);
    bins.end();
    const wood = new Inst(G, BOXC, lit({ color: 0x6b4a2c, roughness: .85 }), F.benches.length * 2 + F.shelters.length);
    const iron = new Inst(G, BOXC, mat.metal, F.benches.length * 2 + F.shelters.length * 5, { shadow: false });
    const glass = new Inst(G, BOXC, new THREE.MeshStandardMaterial({ color: 0xbfd6e0, roughness: .05, metalness: .2, transparent: true, opacity: .28, depthWrite: false }), F.shelters.length * 3, { shadow: false });
    for (const b of F.benches) {
      const r = Math.atan2(b.fx, b.fz), at = (o, y) => [b.x - b.fx * o, CURB + y, b.z - b.fz * o];
      wood.add(...at(0, .45), 1.8, .07, .46, r); wood.add(...at(.24, .75), 1.8, .42, .06, r);
      for (const s of [-1, 1]) { const rx = b.fz * s * .8, rz = -b.fx * s * .8; iron.add(b.x + rx, CURB + .22, b.z + rz, .06, .44, .42, r); }
    }
    for (const s of F.shelters) {
      const r = Math.atan2(s.fx, s.fz), at = (o, y) => [s.x - s.fx * o, CURB + y, s.z - s.fz * o];
      iron.add(...at(.1, 2.55), 4.4, .1, 1.9, r);                                                        // roof
      for (const e of [-1, 1]) for (const o of [-.75, .75]) iron.add(s.x + s.ux * e * 2.1 - s.fx * o, CURB + 1.25, s.z + s.uz * e * 2.1 - s.fz * o, .07, 2.5, .07, r);
      glass.add(...at(.82, 1.3), 4.15, 2.1, .04, r);                                                     // back panel
      for (const e of [-1, 1]) glass.add(s.x + s.ux * e * 2.1 - s.fx * .1, CURB + 1.3, s.z + s.uz * e * 2.1 - s.fz * .1, .04, 2.1, 1.45, r);
      wood.add(...at(.55, .45), 3.2, .07, .42, r);
    }
    wood.end(); iron.end(); glass.end();
    const man = new Inst(G, cyl(.45, .02), lit({ color: 0x2a2b2e, roughness: .6, metalness: .5 }), F.manholes.length, { shadow: false });
    for (const m of F.manholes) man.add(m.x, .004, m.z, 1, 1, 1);
    man.end();
    const pits = new Inst(G, BOX, lit({ color: 0x2e2923, roughness: 1 }), F.pits.length, { shadow: false });
    for (const p of F.pits) pits.add(p.x, CURB, p.z, 1.25, .02, 1.25);
    pits.end();

    // ---- shop fronts: awnings over the windows, signs above them that light up at night ----
    const awn = new Inst(G, BOXC, lit({ color: 0xffffff, roughness: .9 }), M.awnings.length, { colors: true });
    for (const a of M.awnings) awn.add(a.x, a.y, a.z, a.sx, a.sy, a.sz, 0, a.col);
    awn.end();
    this.shopMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const shops = new Inst(G, BOXC, this.shopMat, M.shopSigns.length, { shadow: false, colors: true });
    for (const s of M.shopSigns) shops.add(s.x, s.y, s.z, s.sx, s.sy, s.sz, 0, s.col);
    shops.end();

    // ---- trees ----
    const trunks = new Inst(G, new THREE.CylinderGeometry(.13, .2, 1, 6).translate(0, .5, 0), mat.trunk, M.trees.length);
    const crowns = new Inst(G, new THREE.IcosahedronGeometry(1, 1), mat.crown, M.trees.length, { colors: true });
    const GREENS = [0x3f6a2e, 0x4c7a34, 0x36602a, 0x5a843c, 0x2f5626];
    for (const t of M.trees) {
      const y = groundAt(M, t.x, t.z), s = t.s, th = 2.2 + s * 1.4;
      trunks.add(t.x, y, t.z, s, th, s);
      crowns.add(t.x, y + th + 1.3 * s, t.z, 2.3 * s, 2.7 * s, 2.3 * s, hash(t.x * 10, t.z * 10) * 6, GREENS[Math.floor(hash(t.x * 7, t.z * 7) * GREENS.length)]);
    }
    trunks.end(); crowns.end();

    // ---- exit signs over the ring ----
    const signs = { down: signTex("EXIT 1", "Downtown", "City Centre  Midtown"), out: signTex("EXIT 2", "Outer Blvd", "Warehouse District") };
    const postI = new Inst(G, BOXC, mat.metal, M.gantries.length * 3, { shadow: false });
    for (const g of M.gantries) {
      const rx = -g.dz, rz = g.dx;   // right of travel
      for (const o of [1.2, 13.9]) postI.add(g.x + rx * o, DECK_Y + 3.6, g.z + rz * o, .35, 7.2, .35, 0);
      postI.add(g.x + rx * 7.55, DECK_Y + 7.1, g.z + rz * 7.55, Math.abs(rx) > .5 ? 13.2 : .3, .3, Math.abs(rx) > .5 ? .3 : 13.2, 0);
      const face = new THREE.MeshStandardMaterial({ map: signs[g.text], roughness: .6, emissiveMap: signs[g.text], emissive: 0xffffff, emissiveIntensity: 0 });
      const edge = new THREE.MeshStandardMaterial({ color: 0x0f4a2e, roughness: .7 });
      const board = new THREE.Mesh(BOXC, [edge, edge, edge, edge, face, edge]);
      board.scale.set(9.5, 3.2, .2);
      board.position.set(g.x + rx * 7.4, DECK_Y + 5.8, g.z + rz * 7.4);
      board.rotation.y = Math.atan2(-g.dx, -g.dz);   // face the traffic coming at it
      G.add(board);
      (this.signFaces ||= []).push(face);
    }
    postI.end();

    // ---- the wall round the edge ----
    const W = EDGE - 3, wallI = new Inst(G, BOX, mat.curb, 4 * Math.ceil((W * 2) / 6), { shadow: false });
    for (let k = 0; k < 4; k++) for (let u = -W + 3; u < W; u += 6) {
      const [x, z] = k === 0 ? [u, -W] : k === 1 ? [W, u] : k === 2 ? [-u, W] : [-W, -u];
      wallI.add(x, 0, z, k % 2 ? .4 : 6.02, 5.5, k % 2 ? 6.02 : .4, 0);
    }
    wallI.end();

    // ---- parked cars ----
    this.parked = M.parked.map((p) => {
      const col = [0xf2f2f2, 0x1d1f24, 0x9aa1aa, 0xc62828, 0x1e5bd8, 0x5b6f86, 0xd8cbb0, 0x3a3d44][p.ci % 8];
      const m = makeTrafficCar(p.body, col);
      m.position.set(p.x, .05, p.z); m.rotation.y = p.yaw;
      G.add(m);
      return m;
    });

    // ---- traffic ----
    const sizes = {};
    for (const b of CITY_BODIES) sizes[b] = { L: BODIES[b].L, W: BODIES[b].W };
    this.traffic = new CityTraffic(M, sizes);
    this.buildMinimap();
  }
  // ---------------------------------------------------------------- traffic meshes
  acquire(body, color) {
    const p = this.pool.get(body);
    let m = p && p.pop();
    if (!m) { m = makeTrafficCar(body, color); m.rotation.order = "YXZ"; this.group.add(m); }
    else m.children[0].userData.setColor(color);
    m.visible = true;
    return m;
  }
  release(m) { m.visible = false; const p = this.pool.get(m.userData.body) || []; p.push(m); this.pool.set(m.userData.body, p); }
  releaseAll() { for (const m of this.meshes.values()) this.release(m); this.meshes.clear(); }

  // ---------------------------------------------------------------- per frame
  resetTraffic(focus, count) {
    if (!this.traffic) return;
    this.traffic.clear(); this.releaseAll();
    this.traffic.target = count;
    this.traffic.populate(focus, true);
  }
  // drop any traffic within r of (x, z), so a player never spawns inside a car
  clearAround(x, z, r) {
    for (const c of this.traffic.cars) if ((c.x - x) ** 2 + (c.z - z) ** 2 < r * r) this.traffic.drop(c);
    this.traffic.cars = this.traffic.cars.filter((c) => !c.dead);
  }
  spawnPoint(i, others = []) {
    const S = this.M.spawns;
    for (let k = 0; k < S.length; k++) { const s = S[(i + k) % S.length]; if (!others.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 12)) return s; }
    return S[i % S.length];
  }
  heightAt(x, z, y) { return heightAt(this.M, x, z, y); }
  // the gas station whose canopy (x, z) is under, if any
  stationAt(x, z, y) {
    if (!this.M || y > 1.5) return null;
    return this.M.stations.find((s) => x > s.zone.x0 && x < s.zone.x1 && z > s.zone.z0 && z < s.zone.z1) || null;
  }
  nearestStation(x, z) {
    let best = null, bd = Infinity;
    for (const s of this.M?.stations || []) { const d = Math.hypot(s.cx - x, s.cz - z); if (d < bd) { bd = d; best = s; } }
    return best ? { s: best, d: bd } : null;
  }
  pushCircle(x, z, y, r, res) { return pushCircle(this.M, x, z, y, r, res); }
  insideSolid(x, y, z) { return insideSolid(this.M, x, y, z); }
  district(x, z, y) { return districtAt(x, z, y); }
  // how the place sounds: slap-back off the buildings, the boom under the ring, the reverb
  envAt(x, y, z) {
    if (y > 3) return { env: .3, boost: 0, tunnel: 0, reverb: .06 };
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (Math.abs(ringSD(x, z)) < DECK_HW + 1) return { env: 1, boost: .5, tunnel: .42, reverb: .14 };
    // a touch of the tunnel's flutter echo between the towers
    if (m < DOWN + 12) return { env: 1, boost: 1, tunnel: .12, reverb: .24 };
    if (m < RING) return { env: .75, boost: .4, tunnel: .05, reverb: .15 };
    return { env: .4, boost: 0, tunnel: 0, reverb: .08 };
  }

  // players: [{ x, y, z, vx, vz, L, W }] for the traffic to give way to; view: where the camera looks.
  // Returns the horns the traffic sounded.
  update(dt, T, focus, camera, sky, glows, lights, players) {
    if (!this.M) return [];
    const M = this.M, night = sky.lampsOn, nk = sky.night, cam = camera.position;
    cityGlow.value = nk;
    const wet = sky.w?.wet || 0;
    this.mat.road.roughness = .9 - wet * .72; this.mat.road.color.setScalar(1 - wet * .4);
    this.mat.head.color.setRGB(.6 + night * 2.4, .55 + night * 1.9, .45 + night * 1.2);
    for (const f of this.signFaces || []) f.emissiveIntensity = nk * .55;
    for (const f of this.glowFaces) f.m.emissiveIntensity = nk * f.k;
    for (const m of this.logoFaces) m.color.setScalar(.8 + nk * 1.6);
    this.shopMat.color.setScalar(.55 + nk * 1.5);
    this.bandMat.color.setScalar(.85 + nk * .9);
    const fwd = camera.getWorldDirection(_v);
    const honks = this.traffic.step(dt, T, players, { x: focus.x, y: focus.y, z: focus.z, fx: fwd.x, fz: fwd.z });

    // ---- traffic ----
    const seen = _seen; seen.clear();
    const blink = Math.floor(T * 2.8) % 2 === 0;
    let hl = 0;
    for (const c of this.traffic.cars) {
      seen.add(c);
      let m = this.meshes.get(c);
      if (!m) { m = this.acquire(c.body, c.color); this.meshes.set(c, m); }
      m.position.set(c.x, c.y, c.z);
      m.rotation.set(c.pitch, c.yaw, 0);
      const d2 = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2;
      if (d2 > 380 * 380) continue;
      const B = BODIES[c.body], cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      const pt = (lx, lz, h) => _pt.set(c.x + lx * cy + lz * sy, c.y + h, c.z - lx * sy + lz * cy);
      const braking = c.acc < -1.2 || c.v < .4, hw = c.W / 2 - .3;
      for (const s of [-1, 1]) {
        const t = pt(s * hw, c.L / 2 + .05, B.tl[1]);
        if (braking) glows.add(t.x, t.y, t.z, 1, .07, .05, 1.3);
        else if (night) glows.add(t.x, t.y, t.z, 1, .08, .05, .85);
        if (c.sig === s && blink) { glows.add(t.x, t.y, t.z, 1, .55, .05, 1.1); const f = pt(s * hw, -c.L / 2 - .05, B.hl[1]); glows.add(f.x, f.y, f.z, 1, .55, .05, 1); }
        if (night) { const h = pt(s * (c.W / 2 - .35), -c.L / 2 - .05, B.hl[1]); glows.add(h.x, h.y, h.z, 1, .96, .86, 1.5); }
      }
      if (night && hl < 6 && d2 < 140 * 140) {
        const L = this.carLights[hl++] ||= { pos: new THREE.Vector3(), dir: new THREE.Vector3(), color: new THREE.Color(1, .95, .85), intensity: 4, range: 42, cosOuter: Math.cos(.5), cosInner: Math.cos(.22) };
        const h = pt(0, -c.L / 2 - .3, B.hl[1] + .1);
        L.pos.set(h.x, h.y, h.z); L.dir.set(-sy, -.12, -cy).normalize();
        lights.push(L);
      }
    }
    for (const [c, m] of this.meshes) if (!seen.has(c)) { this.release(m); this.meshes.delete(c); }

    // ---- signals: one lit lens per head ----
    for (const L of this.lensOn) L.begin();
    for (const h of M.heads) {
      const st = signalAt(h.n, h.axis, h.left, T), dy = st === 0 ? -.36 : st === 1 ? 0 : .36;
      const x = h.x + h.fx * .18, y = h.y + dy, z = h.z + h.fz * .18;
      this.lensOn[h.arrow ? 1 : 0].add(x, y, z, 1, 1, 1, h.rot, this.LENS[st]);
      const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2;
      if (d2 < 280 * 280) { const c = this.LENS[st]; glows.add(x + h.fx * .05, y, z + h.fz * .05, c.r / 4, c.g / 4, c.b / 4, night ? 1.3 : .55); }
    }
    for (const L of this.lensOn) L.end();
    // the gas stations' canopies light the forecourt after dark
    if (night) {
      let si = 0;
      for (const s of M.stations) {
        if ((s.cx - cam.x) ** 2 + (s.cz - cam.z) ** 2 > 220 * 220) continue;
        for (const [x, z] of s.lamps) {
          glows.add(x, 5.25, z, 1, .97, .92, 2.2);
          const P = this.stationLights[si++] ||= { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, .97, .92), intensity: 6, range: 14, cosOuter: Math.cos(1.25), cosInner: Math.cos(.7) };
          P.pos.set(x, 5.2, z);
          lights.push(P);
        }
      }
    }

    // ---- lamps ----
    if (night) {
      let li = 0;
      for (const h of this.heads) {
        const d2 = (h.x - cam.x) ** 2 + (h.z - cam.z) ** 2;
        if (d2 > 420 * 420) continue;
        glows.add(h.x, h.y, h.z, 1, .82, .55, 3);
        if (d2 < 130 * 130 && li < 26) {
          const P = this.lightPool[li++] ||= { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, .8, .55), intensity: 5, range: 30, cosOuter: Math.cos(1.2), cosInner: Math.cos(.55) };
          P.pos.set(h.x, h.y - .1, h.z);
          lights.push(P);
        }
      }
    }
    // warning lights on the tallest towers, and the parked cars only when near
    if (Math.floor(T * 1.1) % 2 === 0) for (const b of M.beacons) glows.add(b.x, b.y, b.z, 1, .06, .05, night ? 5 : 2.5);
    if ((this.pk = (this.pk || 0) + 1) % 15 === 0) for (const m of this.parked) m.visible = (m.position.x - cam.x) ** 2 + (m.position.z - cam.z) ** 2 < 260 * 260;
    return honks;
  }

  // ---------------------------------------------------------------- minimap
  buildMinimap() {
    const M = this.M, S = 700, k = S / (EDGE * 2);
    const c = document.createElement("canvas"); c.width = c.height = S;
    const g = c.getContext("2d"), X = (v) => (v + EDGE) * k;
    g.fillStyle = "#101114"; g.fillRect(0, 0, S, S);
    g.fillStyle = "#1a2418";
    for (const s of M.slabs) if (s.kind === "park") g.fillRect(X(s.x0), X(s.z0), (s.x1 - s.x0) * k, (s.z1 - s.z0) * k);
    g.fillStyle = "#26282d";
    for (const b of M.buildings) if (b.solid) g.fillRect(X(b.x0), X(b.z0), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
    g.fillStyle = "#5d6168";
    for (const r of M.roads) { const q = r.rect; g.fillRect(X(q.x0), X(q.z0), (q.x1 - q.x0) * k, (q.z1 - q.z0) * k); }
    const stroke = (pts, w, col) => { g.strokeStyle = col; g.lineWidth = w * k; g.lineJoin = "round"; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p.x), X(p.z)) : g.moveTo(X(p.x), X(p.z)))); g.stroke(); };
    for (const r of M.ramps) stroke(r.pts, RAMP_HW * 2, "#8d9199");
    stroke(M.ring, DECK_HW * 2, "#9ca0a8");
    stroke(M.ring, .8, "#e0b43a");
    this.mapCanvas = c; this.mapK = k;
    const el = this.mapEl = document.createElement("canvas");
    el.className = "city-map"; el.hidden = true;
    el.width = el.height = 400;
    (document.getElementById("hud") || document.body).appendChild(el);
    this.mapCtx = el.getContext("2d");
  }
  // heading-up, 170 m round the car; dots: [{ x, z, color }]
  drawMinimap(x, z, yaw, dots, fuelLow = false) {
    if (!this.mapCtx || this.mapEl.hidden) return;
    const g = this.mapCtx, W = this.mapEl.width, R = W / 2, k = this.mapK, s = (R / 170) / k;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(R, R, R - 3, 0, Math.PI * 2); g.clip();
    g.fillStyle = "#101114"; g.fillRect(0, 0, W, W);
    g.translate(R, R); g.rotate(yaw); g.scale(s, s);
    g.drawImage(this.mapCanvas, -(x + EDGE) * k, -(z + EDGE) * k);
    g.fillStyle = "#c9ccd2";
    for (const c of this.traffic?.cars || []) {
      const dx = (c.x - x) * k, dz = (c.z - z) * k;
      if (dx * dx + dz * dz < (190 * k) ** 2) g.fillRect(dx - 1.1, dz - 1.1, 2.2, 2.2);
    }
    for (const d of dots) { g.fillStyle = d.color; g.beginPath(); g.arc((d.x - x) * k, (d.z - z) * k, 4 / s * 1.6, 0, Math.PI * 2); g.fill(); }
    g.restore();
    // you: an arrow in the middle, pointing up the screen
    g.fillStyle = "#ffffff";
    g.beginPath(); g.moveTo(R, R - 16); g.lineTo(R + 10, R + 11); g.lineTo(R, R + 5); g.lineTo(R - 10, R + 11); g.closePath(); g.fill();
    // gas stations: a pump on the map, and the nearest one pinned to the rim when the tank is low
    const cy = Math.cos(yaw), sy = Math.sin(yaw), near = fuelLow ? this.nearestStation(x, z)?.s : null;
    for (const st of this.M.stations) {
      const dx = (st.cx - x) * k * s, dz = (st.cz - z) * k * s;
      let px = dx * cy - dz * sy, pz = dx * sy + dz * cy;
      const d = Math.hypot(px, pz), lim = R - 26;
      if (d > lim) { if (st !== near) continue; px *= lim / d; pz *= lim / d; }
      const cx = R + px, cz = R + pz;
      g.fillStyle = st === near ? "#ffb12a" : "#f4f4f0";
      g.beginPath(); g.roundRect(cx - 15, cz - 15, 30, 30, 7); g.fill();
      g.fillStyle = "#16171a";
      g.fillRect(cx - 7, cz - 8, 9, 17); g.fillStyle = st === near ? "#ffb12a" : "#f4f4f0"; g.fillRect(cx - 5, cz - 6, 5, 5);
      g.fillStyle = "#16171a"; g.fillRect(cx + 3, cz - 6, 3, 11); g.fillRect(cx + 2, cz - 8, 5, 3);
    }
    g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 3; g.beginPath(); g.arc(R, R, R - 3, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "rgba(255,255,255,.75)"; g.font = "bold 22px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    // north marker on the rim
    const na = -Math.PI / 2 + yaw;
    g.fillText("N", R + Math.cos(na) * (R - 22), R + Math.sin(na) * (R - 22));
  }
}
const _v = new THREE.Vector3(), _pt = new THREE.Vector3(), _seen = new Set();

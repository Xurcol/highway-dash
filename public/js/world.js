// Road, zone-based scenery (city -> highway -> city ...), street lamps.
import * as THREE from "three";
import { patchLit } from "./lights.js";

// One carriageway, all lanes running the player's way. The road spans x -11.5..11.5 (5 lanes plus
// shoulders) and every piece of roadside furniture below is mirrored about x = 0.
export const LANES = 5, LW = 4, ROAD_HALF = 10, SHOULDER = 1.5;
export const laneX = (i) => -ROAD_HALF + LW / 2 + i * LW;
export const ROAD_EDGE = 11.5;    // outer edge of the paved surface, both sides
const SEG = 48, TILE = 48, CYCLE = 16000;   // TILE doubled: the road texture repeats half as often

export function hash(a, b = 0, c = 0) {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1440662683)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
export function cityAt(z) {
  const m = (((-z) % CYCLE) + CYCLE) % CYCLE;
  if (m < 3200) return 1;
  if (m < 4000) return 1 - (m - 3200) / 800;
  if (m < CYCLE - 800) return 0;
  return (m - (CYCLE - 800)) / 800;
}
// tunnels: deterministic from z so every player in a party drives through the same ones
const TBLOCK = 1440;
export function tunnelSpan(z) {
  const b = Math.floor(-z / TBLOCK);
  if (b < 2 || hash(b, 4242) > .55) return null;
  const len = Math.round((260 + hash(b, 99) * 440) / SEG) * SEG;
  const off = Math.round((120 + hash(b, 17) * (TBLOCK - len - 240)) / SEG) * SEG;
  const s = -(b * TBLOCK + off), e = s - len; // entrance (larger z) -> exit
  return z <= s && z >= e ? [s, e] : null;
}
export function tunnelAmount(z) {
  const sp = tunnelSpan(z) || tunnelSpan(z - 30) || tunnelSpan(z + 30);
  if (!sp) return 0;
  return Math.max(0, Math.min(1, Math.min(sp[0] - z, z - sp[1]) / 30 + .5));
}

// The road surface, baked once. 23m across by TILE metres along, so everything here is authored in
// metres and converted at the end. It carries the things you actually see on a highway: aggregate,
// the darker polished strips the wheels have worn, longitudinal paving seams, cracks, patched
// repairs, rubber, dirt washed to the edges, and the markings - all slightly imperfect.
function roadTexture(renderer) {
  const W = 1024, H = 2048;                       // 23m x TILE m
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  const pxm = W / 23, pyz = H / TILE;             // pixels per metre, across and along
  const mx = (m) => m * pxm, mz = (m) => m * pyz;
  const rnd = (() => { let sd = 20240917; return () => (sd = (sd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();

  // ---- base asphalt, with broad tonal drift so it is never a flat colour ----
  g.fillStyle = "#31353f"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    const r = 120 + rnd() * 380, x = rnd() * W, y = rnd() * H;
    const v = rnd() < .5 ? -8 : 8;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${49 + v},${53 + v},${63 + v},.5)`);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // aggregate: the stones in the mix
  for (let i = 0; i < 90000; i++) {
    const v = 26 + rnd() * 52, a = rnd() * .5;
    g.fillStyle = `rgba(${v},${v + 3},${v + 10},${a})`;
    g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }

  // ---- the shoulders are a coarser, dirtier mix than the running lanes ----
  for (const sx of [0, 23 - SHOULDER]) {
    g.fillStyle = "rgba(44,40,34,.5)"; g.fillRect(mx(sx), 0, mx(SHOULDER), H);
    for (let i = 0; i < 6000; i++) {
      const v = 40 + rnd() * 40;
      g.fillStyle = `rgba(${v},${v - 4},${v - 14},${rnd() * .45})`;
      g.fillRect(mx(sx) + rnd() * mx(SHOULDER), rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3);
    }
  }
  // dirt washed in from the verge, heaviest right at the edge
  for (const [sx, dir] of [[0, 1], [23, -1]]) {
    const grd = g.createLinearGradient(mx(sx), 0, mx(sx + dir * 2.6), 0);
    grd.addColorStop(0, "rgba(86,74,54,.42)"); grd.addColorStop(1, "rgba(86,74,54,0)");
    g.fillStyle = grd; g.fillRect(mx(Math.min(sx, sx + dir * 2.6)), 0, mx(2.6), H);
  }

  // ---- longitudinal paving seams: each paver lays one lane width at a time ----
  for (let l = 0; l <= LANES; l++) {
    const x = mx(SHOULDER + l * LW);
    g.fillStyle = "rgba(20,22,28,.5)"; g.fillRect(x - 1.5, 0, 3, H);
    g.fillStyle = "rgba(70,74,84,.18)"; g.fillRect(x + 1.5, 0, 2, H);
  }

  // ---- wheel paths: two polished, rubber-darkened strips per lane ----
  for (let l = 0; l < LANES; l++) {
    const cx = SHOULDER + LW / 2 + l * LW;
    for (const o of [-.88, .88]) {
      const grd = g.createLinearGradient(mx(cx + o - .5), 0, mx(cx + o + .5), 0);
      grd.addColorStop(0, "rgba(14,16,20,0)"); grd.addColorStop(.5, "rgba(14,16,20,.3)"); grd.addColorStop(1, "rgba(14,16,20,0)");
      g.fillStyle = grd; g.fillRect(mx(cx + o - .5), 0, mx(1), H);
    }
    // and the lighter, unpolished strip the wheels straddle
    g.fillStyle = "rgba(120,124,134,.05)"; g.fillRect(mx(cx - .35), 0, mx(.7), H);
  }

  // ---- repairs: a patch is a different batch of asphalt, cut in with a saw ----
  for (let i = 0; i < 7; i++) {
    const pw = mx(1.2 + rnd() * 3.5), ph = mz(1.5 + rnd() * 5);
    const px = mx(SHOULDER) + rnd() * mx(23 - 2 * SHOULDER) - pw / 2, py = rnd() * H;
    const v = rnd() < .5 ? 20 : -14;
    g.fillStyle = `rgba(${44 + v},${47 + v},${55 + v},.75)`;
    g.fillRect(px, py, pw, ph);
    g.strokeStyle = "rgba(16,18,22,.75)"; g.lineWidth = 2.5; g.strokeRect(px, py, pw, ph);
    // sealant bleeding out of the joint
    g.strokeStyle = "rgba(24,24,26,.5)"; g.lineWidth = 5; g.strokeRect(px - 1, py - 1, pw + 2, ph + 2);
  }
  // crack sealant: black snakes of bitumen
  g.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    let x = rnd() * W, y = rnd() * H;
    g.strokeStyle = `rgba(18,19,23,${.35 + rnd() * .4})`; g.lineWidth = 2 + rnd() * 4;
    g.beginPath(); g.moveTo(x, y);
    const steps = 3 + (rnd() * 5 | 0), dx = (rnd() - .5) * 70, dy = (rnd() - .5) * 260;
    for (let j = 0; j < steps; j++) { x += dx + (rnd() - .5) * 40; y += dy / steps; g.lineTo(x, y); }
    g.stroke();
  }
  // transverse joints, every few metres, as on a concrete-based highway
  for (let zm = 0; zm < TILE; zm += 6) {
    g.fillStyle = "rgba(22,24,30,.3)";
    g.fillRect(mx(SHOULDER), mz(zm) + (rnd() - .5) * 6, mx(23 - 2 * SHOULDER), 2.5);
  }

  // ---- rumble strips, milled into both shoulders ----
  for (const sx of [SHOULDER - .95, 23 - SHOULDER + .35]) {
    for (let zm = 0; zm < TILE; zm += .28) {
      g.fillStyle = "rgba(16,18,22,.62)"; g.fillRect(mx(sx), mz(zm), mx(.6), mz(.13));
      g.fillStyle = "rgba(128,132,140,.13)"; g.fillRect(mx(sx), mz(zm) + mz(.13), mx(.6), mz(.05));
    }
  }

  // ---- markings. Painted, then worn: never a clean rectangle ----
  const paint = (x, z, w, len, col, wear) => {
    g.fillStyle = col; g.fillRect(mx(x), mz(z), mx(w), mz(len));
    // scuff the paint back off in patches
    for (let i = 0; i < len * 22; i++) {
      if (rnd() > wear) continue;
      g.fillStyle = `rgba(48,52,62,${.25 + rnd() * .5})`;
      g.fillRect(mx(x) + rnd() * mx(w), mz(z) + rnd() * mz(len), 1 + rnd() * mx(.08), 1 + rnd() * mz(.25));
    }
  };
  const WHITE = "#e8e9e4", YELLOW = "#e6b829";
  // edge lines: yellow down the median side, white down the shoulder side
  paint(SHOULDER - .05, 0, .16, TILE, YELLOW, .28);
  paint(23 - SHOULDER - .11, 0, .16, TILE, WHITE, .3);
  // lane dashes: 3m of paint, 9m of gap
  for (let l = 1; l < LANES; l++) {
    for (let z0 = 0; z0 < TILE; z0 += 12) paint(SHOULDER + l * LW - .08, z0 + 1, .16, 3, WHITE, .34);
  }
  g.globalAlpha = 1;

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.repeat.set(1, 1400 / TILE);
  return t;
}

function noiseTexture(renderer, base, spread, size = 256) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"); g.fillStyle = base; g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * .4; i++) {
    const v = (Math.random() - .5) * spread;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(Math.random() * size | 0, Math.random() * size | 0, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

const windowGlow = { value: 0 };
function buildingMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .85, metalness: .05 });
  const extra = (shader) => {
    shader.uniforms.windowGlow = windowGlow;
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
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm; uniform float windowGlow; float winMask; float winRnd;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        { vec3 an = abs(vWNorm); float wall = step(an.y, .5);
          vec2 q = an.x > an.z ? vWPos.zy : vWPos.xy;
          vec2 cs = vec2(3.2, 3.6); vec2 cell = floor(q / cs); vec2 f = fract(q / cs);
          winMask = step(.16,f.x)*step(f.x,.84)*step(.22,f.y)*step(f.y,.82)*wall*step(3.2, vWPos.y);
          winRnd = fract(sin(dot(cell + floor(vWPos.xz / 40.0) * 13.0, vec2(12.9898,78.233))) * 43758.5453);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.05,.07,.1), winMask * .9); }`)
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .12, winMask); metalnessFactor = mix(metalnessFactor, .7, winMask);")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        totalEmissiveRadiance += winMask * step(.52, winRnd) * windowGlow * mix(vec3(1.,.72,.4), vec3(.6,.8,1.), step(.86, winRnd)) * 1.6;`);
  };
  extra.key = "bldg";
  return patchLit(m, extra);
}

// ---------------------------------------------------------------- sign faces
// Every sign is drawn on a 2:1 or 1:1 canvas and mapped onto a thin box, so the face reads from the
// road and the edge still catches the light. Kept deliberately low-res: they are seen at speed.
function signCanvas(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const SIGN_ART = {
  // big green destination board
  guide: () => signCanvas(512, 256, (g, w, h) => {
    g.fillStyle = "#12603a"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#f2f4f0"; g.lineWidth = 7; g.strokeRect(11, 11, w - 22, h - 22);
    g.fillStyle = "#f2f4f0"; g.font = "bold 62px sans-serif"; g.textBaseline = "middle";
    g.fillText("NORTH", 40, 70); g.font = "bold 74px sans-serif"; g.fillText("Rosewood", 40, 150);
    g.font = "bold 44px sans-serif"; g.fillText("14 MI", 40, 212);
    g.beginPath(); g.moveTo(w - 70, 96); g.lineTo(w - 30, 136); g.lineTo(w - 70, 176); g.closePath(); g.fill();
  }),
  guide2: () => signCanvas(512, 256, (g, w, h) => {
    g.fillStyle = "#12603a"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#f2f4f0"; g.lineWidth = 7; g.strokeRect(11, 11, w - 22, h - 22);
    g.fillStyle = "#f2f4f0"; g.textBaseline = "middle";
    g.font = "bold 52px sans-serif"; g.fillText("WEST", 36, 60);
    g.font = "bold 66px sans-serif"; g.fillText("Kestrel Bay", 36, 128);
    g.font = "bold 40px sans-serif"; g.fillText("Milltown  27", 36, 196);
    g.fillStyle = "#f2f4f0"; g.fillRect(w - 96, 60, 8, 140);
    g.beginPath(); g.moveTo(w - 122, 196); g.lineTo(w - 92, 226); g.lineTo(w - 62, 196); g.closePath(); g.fill();
  }),
  // exit tab
  exit: () => signCanvas(256, 256, (g, w, h) => {
    g.fillStyle = "#12603a"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#f2f4f0"; g.lineWidth = 6; g.strokeRect(9, 9, w - 18, h - 18);
    g.fillStyle = "#f2f4f0"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 56px sans-serif"; g.fillText("EXIT", w / 2, 80);
    g.font = "bold 92px sans-serif"; g.fillText("47B", w / 2, 170);
  }),
  // speed limit
  speed: () => signCanvas(256, 320, (g, w, h) => {
    g.fillStyle = "#f4f4f0"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#1a1a1a"; g.lineWidth = 9; g.strokeRect(13, 13, w - 26, h - 26);
    g.fillStyle = "#1a1a1a"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 44px sans-serif"; g.fillText("SPEED", w / 2, 66); g.fillText("LIMIT", w / 2, 112);
    g.font = "bold 128px sans-serif"; g.fillText("70", w / 2, 218);
  }),
  // yellow warning diamond, drawn square and rotated by the mesh
  warn: () => signCanvas(256, 256, (g, w, h) => {
    g.fillStyle = "#e8b41f"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#1a1a1a"; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = "#1a1a1a"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 150px sans-serif"; g.fillText("!", w / 2, h / 2 + 6);
  }),
  // orange construction board
  work: () => signCanvas(256, 256, (g, w, h) => {
    g.fillStyle = "#e2661c"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#1a1a1a"; g.lineWidth = 8; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = "#1a1a1a"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 40px sans-serif"; g.fillText("ROAD", w / 2, 100); g.fillText("WORK", w / 2, 150);
  }),
  // route shield
  shield: () => signCanvas(256, 256, (g, w, h) => {
    g.fillStyle = "#f4f4f0"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#1c3f94"; g.beginPath(); g.moveTo(40, 40); g.lineTo(216, 40); g.lineTo(216, 150);
    g.quadraticCurveTo(128, 232, 40, 150); g.closePath(); g.fill();
    g.fillStyle = "#f4f4f0"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 84px sans-serif"; g.fillText("41", w / 2, 132);
  }),
  // mile marker
  mile: () => signCanvas(128, 256, (g, w, h) => {
    g.fillStyle = "#14532b"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#f2f4f0"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 40px sans-serif"; g.fillText("MILE", w / 2, 70);
    g.font = "bold 76px sans-serif"; g.fillText("182", w / 2, 160);
  }),
};
const BILLBOARD_ART = [
  (g, w, h) => { const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, "#ff3b6b"); grd.addColorStop(1, "#7a1fd0");
    g.fillStyle = grd; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 96px sans-serif"; g.fillText("DRIVE", w / 2, h * .38); g.font = "bold 58px sans-serif"; g.fillText("FASTER", w / 2, h * .66); },
  (g, w, h) => { g.fillStyle = "#101820"; g.fillRect(0, 0, w, h); g.fillStyle = "#ffd12a"; g.fillRect(0, h - 26, w, 26);
    g.fillStyle = "#ffd12a"; g.textAlign = "left"; g.textBaseline = "middle"; g.font = "bold 84px sans-serif"; g.fillText("FUEL", 44, h * .36);
    g.fillStyle = "#e8e9e4"; g.font = "bold 46px sans-serif"; g.fillText("NEXT EXIT", 44, h * .64); },
  (g, w, h) => { g.fillStyle = "#f4f1e8"; g.fillRect(0, 0, w, h); g.fillStyle = "#c8102e";
    g.beginPath(); g.arc(w * .26, h * .5, h * .3, 0, 7); g.fill();
    g.fillStyle = "#1a1a1a"; g.textAlign = "left"; g.textBaseline = "middle"; g.font = "bold 72px sans-serif"; g.fillText("DINER", w * .46, h * .42);
    g.font = "bold 40px sans-serif"; g.fillText("OPEN 24H", w * .46, h * .66); },
  (g, w, h) => { const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, "#1b6ec2"); grd.addColorStop(1, "#0b3a6b");
    g.fillStyle = grd; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "bold 70px sans-serif"; g.fillText("MOTEL", w / 2, h * .4); g.fillStyle = "#ffd12a"; g.font = "bold 44px sans-serif"; g.fillText("VACANCY", w / 2, h * .68); },
];

class Batch {
  constructor(scene, geo, mat, cap, { shadow = true, colors = false } = {}) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.castShadow = shadow; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    if (colors) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.cap = cap; this.n = 0;
    scene.add(this.mesh);
  }
  static m = new THREE.Matrix4(); static q = new THREE.Quaternion(); static s = new THREE.Vector3(); static p = new THREE.Vector3(); static e = new THREE.Euler(); static c = new THREE.Color();
  add(x, y, z, sx, sy, sz, color, rotY = 0) {
    if (this.n >= this.cap) return;
    Batch.q.setFromEuler(Batch.e.set(0, rotY, 0));
    Batch.m.compose(Batch.p.set(x, y, z), Batch.q, Batch.s.set(sx, sy, sz));
    this.mesh.setMatrixAt(this.n, Batch.m);
    if (color !== undefined && this.mesh.instanceColor) this.mesh.setColorAt(this.n, Batch.c.set(color));
    this.n++;
  }
  begin() { this.n = 0; }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const BLDG_COLORS = [0x8f8a86, 0xa89f94, 0x6f7a86, 0x5c6470, 0xb8b0a2, 0x7d6f64, 0x4e5866, 0x9aa6b0, 0xc2b8a8, 0x6a5e58];
const NEON = [0xff2d95, 0x28e0ff, 0xffd12a, 0x7cff5a, 0xa05bff];
const ROCK = [[0xc9763f, 0xe0955a], [0xb8663a, 0xd98a52], [0xa95b36, 0xcf7e4a]];
const SNOW_ROCK = [[0x8a9098, 0xc4cdd4], [0x7c848c, 0xb0bac2], [0x6e777f, 0x9ea8b0]];

// Four stretches of highway, picked by a coin toss every CYCLE metres (see biomeAt below). Each one
// carries every colour and density knob the scenery code below reads, so a new biome is just a new
// entry here rather than a change scattered through highwayScenery/rebuild.
const BIOME = {
  desert: {
    hillCol: 0xc9763f, ridge: 0xc2a068, ground: 0xe2b875,
    tuft: [0x9c8a52, 0xab9760, 0x8a7a48, 0xb8a672], tuftTall: .7,
    horizon: [0xb07a4a, 0x9c7a63, 0x8c8090], rock: ROCK, plantDensity: 8, leafy: false,
  },
  green: {
    hillCol: 0x5e9a48, ridge: 0x53823c, ground: 0x7fae5a,
    tuft: [0x4a7c34, 0x568a3c, 0x3f6e2e, 0x6b9445], tuftTall: 1.1,
    horizon: [0x4a7340, 0x51707a, 0x5d7486], rock: null, plantDensity: 11, leafy: true,
    leaf: { conifer: [0x2c6633, 0x27592c], broad: 0x4a9a3e, scrub: [0x3f8a3a, 0x55a347] },
  },
  snow: {
    hillCol: 0xb7c1c8, ridge: 0xaab4bc, ground: 0xd9e1e6,
    tuft: [0xc7ced4, 0xb3bcc4, 0x9ea8b0, 0xd6dde2], tuftTall: .6,
    horizon: [0x8a97a6, 0x9aa6b4, 0xb0bcc8], rock: SNOW_ROCK, rockCap: 0xeef3f6, plantDensity: 7, leafy: true,
    leaf: { conifer: [0x223c2c, 0x1c3226], broad: 0x2e4a38, scrub: [0x2a4232, 0x35513e] },
  },
  plains: {
    hillCol: 0xc4ac4e, ridge: 0xbfa858, ground: 0xd8c26a,
    tuft: [0xc9b357, 0xd6c268, 0xb89f45, 0xe0cd7c], tuftTall: .85,
    horizon: [0xb89a52, 0xa89868, 0x9c9070], rock: null, plantDensity: 3, leafy: true,
    leaf: { conifer: [0x6a7a34, 0x5c6c2c], broad: 0x8a9a4a, scrub: [0x7a8a40, 0x94a456] },
  },
};
const BIOME_NAMES = Object.keys(BIOME);
// A biome runs for a whole CYCLE-metre stretch, picked by a hash so every player in a party sees the
// same one. Block 0 (the spawn) is always desert, so the run always opens the same way.
export const biomeAt = (z) => {
  const b = Math.floor(-z / CYCLE);
  return b === 0 ? "desert" : BIOME_NAMES[Math.floor(hash(b, 77) * BIOME_NAMES.length)];
};

export class World {
  constructor(renderer, scene) {
    this.scene = scene;
    const lit = (o) => patchLit(new THREE.MeshStandardMaterial(o));
    this.roadMat = lit({ map: roadTexture(renderer), roughness: .9, metalness: 0 });
    this.road = new THREE.Mesh(new THREE.PlaneGeometry(23, 1400).rotateX(-Math.PI / 2), this.roadMat);
    this.sandTex = noiseTexture(renderer, "#ffffff", .25);
    this.sandTex.repeat.set(400, 400);
    this.groundMat = lit({ color: 0xe2b875, map: this.sandTex, roughness: 1 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), this.groundMat);
    this.ground.position.y = -.03;
    for (const m of [this.road, this.ground]) { m.receiveShadow = true; scene.add(m); }

    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
    const concrete = lit({ color: 0xd8d4cc, roughness: .9 });
    const white = lit({ color: 0xffffff, roughness: .8, metalness: .1 });
    const metal = lit({ color: 0x9aa3ad, roughness: .45, metalness: .6 });
    const flat = lit({ color: 0xffffff, roughness: .95, flatShading: true });
    this.lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, toneMapped: false });
    const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.neonMat = neonMat;

    this.b = {
      rail: new Batch(scene, box, metal, 120),
      post: new Batch(scene, box, metal, 1300, { shadow: false }),
      pole: new Batch(scene, box, metal, 200),
      arm: new Batch(scene, box, metal, 300, { shadow: false }),
      head: new Batch(scene, box, this.lampHeadMat, 300, { shadow: false }),
      sidewalk: new Batch(scene, box, lit({ color: 0xb9b5ad, roughness: .95 }), 120, { shadow: false }),
      curb: new Batch(scene, box, concrete, 120, { shadow: false }),
      building: new Batch(scene, box, buildingMaterial(), 900, { colors: true }),
      roofBox: new Batch(scene, box, white, 400, { colors: true }),
      neon: new Batch(scene, box, neonMat, 120, { shadow: false, colors: true }),
      rock: new Batch(scene, box, flat, 1400, { colors: true }),
      cactus: new Batch(scene, box, lit({ color: 0x4f9e3a, roughness: .9, flatShading: true }), 900),
      bush: new Batch(scene, new THREE.DodecahedronGeometry(1, 0), lit({ color: 0x3f8f3a, roughness: .9, flatShading: true }), 500),
      trunk: new Batch(scene, box, lit({ color: 0x6b4a2e, roughness: .9 }), 500),
      crown: new Batch(scene, new THREE.IcosahedronGeometry(1, 0), lit({ color: 0xffffff, roughness: .9, flatShading: true }), 500, { colors: true }),
      sign: new Batch(scene, box, lit({ color: 0x1f7a3f, roughness: .96 }), 30),
      tWall: new Batch(scene, box, lit({ color: 0xd9d4c8, roughness: .65 }), 90),
      tBand: new Batch(scene, box, lit({ color: 0x2c3036, roughness: .5, metalness: .2 }), 90, { shadow: false }),
      tCeil: new Batch(scene, box, lit({ color: 0x6f7176, roughness: .9 }), 45),
      tPillar: new Batch(scene, box, concrete, 200),
      tLight: new Batch(scene, box, (this.tunnelLightMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false })), 1000, { shadow: false }),
      tPortal: new Batch(scene, box, lit({ color: 0xa9a49a, roughness: .95 }), 30),
      hill: new Batch(scene, new THREE.IcosahedronGeometry(1, 1), lit({ color: 0xffffff, roughness: 1, flatShading: true }), 320, { colors: true, shadow: false }),

      // ---- highway furniture ----
      // W-beam guardrail: two corrugation ribs on a post, which is what reads as a rail at speed
      gbeam: new Batch(scene, box, lit({ color: 0xb6bcc4, roughness: .38, metalness: .75 }), 900, { shadow: false }),
      gpost: new Batch(scene, box, lit({ color: 0x8d949c, roughness: .5, metalness: .55 }), 1800, { shadow: false }),
      // concrete: jersey barriers, bridge parapets, culvert headwalls
      jersey: new Batch(scene, box, lit({ color: 0xb9b5ac, roughness: .92 }), 900),
      // a reflector is unlit on purpose so it stays bright when everything else goes dark
      reflect: new Batch(scene, box, (this.reflectMat = new THREE.MeshBasicMaterial({ color: 0xffb020, toneMapped: false })), 2600, { shadow: false, colors: true }),
      // white delineator posts down both shoulders
      delin: new Batch(scene, box, lit({ color: 0xe8e6df, roughness: .8 }), 700, { shadow: false }),
      // grey posts for everything that needs a leg
      spost: new Batch(scene, box, lit({ color: 0x9aa1a9, roughness: .5, metalness: .5 }), 700, { shadow: false }),
      // chain-link fence panels and their posts
      fence: new Batch(scene, box, lit({ color: 0x7e858c, roughness: .7, metalness: .35, transparent: true, opacity: .45 }), 700, { shadow: false }),
      // transmission pylons and their wires
      pylon: new Batch(scene, box, lit({ color: 0x8f969e, roughness: .6, metalness: .5 }), 800, { shadow: false }),
      // grass tufts and scrub, scattered thickly near the verge
      tuft: new Batch(scene, new THREE.ConeGeometry(1, 1, 4).translate(0, .5, 0), lit({ color: 0xffffff, roughness: 1, flatShading: true }), 2600, { shadow: false, colors: true }),
      // distant ridge silhouettes that close off the horizon
      ridge: new Batch(scene, new THREE.IcosahedronGeometry(1, 1), lit({ color: 0xffffff, roughness: 1, flatShading: true }), 420, { colors: true, shadow: false }),
      // bridge decks and their piers
      deck: new Batch(scene, box, lit({ color: 0xc2beb4, roughness: .9 }), 220),
      pier: new Batch(scene, box, lit({ color: 0xb2aea5, roughness: .92 }), 220),
      // sign faces: one batch per design, each a single draw call
      sgGuide: new Batch(scene, box, lit({ map: SIGN_ART.guide(), roughness: .96 }), 60, { shadow: false }),
      sgGuide2: new Batch(scene, box, lit({ map: SIGN_ART.guide2(), roughness: .96 }), 60, { shadow: false }),
      sgExit: new Batch(scene, box, lit({ map: SIGN_ART.exit(), roughness: .96 }), 60, { shadow: false }),
      sgSpeed: new Batch(scene, box, lit({ map: SIGN_ART.speed(), roughness: .96 }), 60, { shadow: false }),
      sgWarn: new Batch(scene, box, lit({ map: SIGN_ART.warn(), roughness: .96 }), 60, { shadow: false }),
      sgWork: new Batch(scene, box, lit({ map: SIGN_ART.work(), roughness: .96 }), 60, { shadow: false }),
      sgShield: new Batch(scene, box, lit({ map: SIGN_ART.shield(), roughness: .96 }), 60, { shadow: false }),
      sgMile: new Batch(scene, box, lit({ map: SIGN_ART.mile(), roughness: .96 }), 80, { shadow: false }),
      sgBoard: BILLBOARD_ART.map((d, i) => new Batch(scene, box, lit({ map: signCanvas(512, 256, d), roughness: .96 }), 14, { shadow: false })),
      // road-surface decals: patches, rubber, repairs - laid flat, offset out of the road's depth
      decal: new Batch(scene, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        lit({ color: 0xffffff, roughness: .95, transparent: true, opacity: .55, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -6 }),
        900, { shadow: false, colors: true }),
    };
    // the per-design billboard batches live in an array, so flatten them for begin()/end()
    this.batchList = Object.values(this.b).flat();
    // every sign face, so they can be lifted together at night
    this.signMats = ["sgGuide", "sgGuide2", "sgExit", "sgSpeed", "sgWarn", "sgWork", "sgShield", "sgMile"]
      .map((n) => this.b[n].mesh.material).concat(this.b.sgBoard.map((b) => b.mesh.material));
    for (const m of this.signMats) { m.emissiveMap = m.map; m.emissive.set(0xffffff); m.emissiveIntensity = 0; }
    this.density = 1;            // scenery density multiplier, driven by the graphics setting
    this.viewDist = 1;           // how far back the world is built, as a fraction of the default
    this.lastK = null;
    this.lampList = [];   // {pos, dir} world-space lamp heads in range
    this.tunnelLamps = []; this.tunnelPool = []; this.tunnel = 0;
    this.lightPool = [];
  }

  rebuild(k0) {
    const B = this.b;
    this.batchList.forEach((b) => b.begin());
    this.lampList.length = 0;
    this.tunnelLamps.length = 0;
    const kFrom = k0 - Math.round(30 * this.viewDist), kTo = k0 + 3;
    for (let k = kFrom; k <= kTo; k++) {
      const z = k * SEG + SEG / 2, c = cityAt(z), biome = biomeAt(z);
      const r = (i) => hash(k, i, 911);
      const tun = tunnelSpan(z);
      if (tun) {
        const hillCol = c >= .5 ? 0x8a8780 : BIOME[biome].hillCol;
        for (const [wx, face] of [[13.8, 1], [-13.8, -1]]) {
          B.tWall.add(wx, 0, z, .8, 9, SEG + .02);
          B.tBand.add(wx - face * .42, 0, z, .04, 1.25, SEG + .02);
          B.tBand.add(wx - face * .42, 7.2, z, .04, .25, SEG + .02);
        }
        B.tCeil.add(0, 9, z, 28.4, .8, SEG + .02);
        // The mountain is built from three masses that all stay OUTSIDE the bore (walls at x ±13.8,
        // ceiling at y 9.8). hill instances are ellipsoids whose x/y/z are semi-axes, so a single big
        // one centred on the road would reach eye height and black out the tunnel.
        B.hill.add(0, 18.4, z, 30, 8.6, SEG * .6, hillCol);
        B.hill.add(36, 2, z, 22, 17, SEG * .6, hillCol);
        B.hill.add(-36, 2, z, 22, 17, SEG * .6, hillCol);
        for (let p = 0; p < 6; p++) {
          const lz = k * SEG + p * 8 + 4;
          for (const lx of [-4.5, 4.5]) { B.tLight.add(lx, 8.93, lz, .45, .07, 2.8); if (p % 2 === 0) this.tunnelLamps.push({ x: lx, y: 8.75, z: lz }); }
        }
        for (const pz of tun) if (pz >= k * SEG - .01 && pz <= (k + 1) * SEG + .01) {
          B.tPortal.add(0, 9, pz, 32, 8, 2.4);
          B.tPortal.add(19, 0, pz, 10, 17, 4);
          B.tPortal.add(-19, 0, pz, 10, 17, 4);
          const off = pz === tun[0] ? 16 : -16; // the hillside the portal is cut into, just outside the mouth
          B.hill.add(0, 19, pz + off, 34, 9.4, 20, hillCol);
          B.hill.add(38, 2, pz + off, 24, 18, 20, hillCol);
          B.hill.add(-38, 2, pz + off, 24, 18, 20, hillCol);
        }
        continue;
      }
      // Street lighting: poles alternate sides down the road with the arm reaching over the lanes,
      // which is how a single carriageway is actually lit (the old layout hung them off the median).
      {
        const s = (k & 1) ? 1 : -1, px = s * 12.8, hx = s * 7.4;
        B.pole.add(px, .95, z, .3, 10, .3);
        B.arm.add((px + hx) / 2, 10.6, z, Math.abs(px - hx) + .4, .18, .18);
        B.head.add(hx, 10.35, z, 1.1, .22, .45);
        this.lampList.push({ x: hx, y: 10.2, z });
      }

      if (c >= .5) {
        // ---- city ----
        const cityK = c;
        B.sidewalk.add(16.2, 0, z, 8, .18, SEG); B.curb.add(12.3, 0, z, .3, .22, SEG);
        B.sidewalk.add(-16.2, 0, z, 8, .18, SEG); B.curb.add(-12.3, 0, z, .3, .22, SEG);
        // sidewalk lamps + trees
        for (const [px, hx] of [[12.9, 11.2], [-12.9, -11.2]]) {
          const lz = z - SEG / 2;
          B.pole.add(px, 0, lz, .22, 8, .22);
          B.arm.add((px + hx) / 2, 8, lz, Math.abs(px - hx) + .2, .12, .12);
          B.head.add(hx, 7.85, lz, .8, .18, .35);
          this.lampList.push({ x: hx, y: 7.7, z: lz });
        }
        for (const tx of [18.5, -18.5]) for (const tz of [z - 12, z + 12]) {
          const s = .8 + hash(k, tx, tz) * .5;
          B.trunk.add(tx, 0, tz, .3, 2.2 * s, .3);
          B.crown.add(tx, 3.2 * s, tz, 1.6 * s, 1.5 * s, 1.6 * s, 0x3f8a3a);
        }
        // buildings, both sides
        for (const side of [1, -1]) {
          let zz = k * SEG;
          let i = 0;
          while (zz < (k + 1) * SEG - 6) {
            const len = 10 + r(side * 10 + i) * 16;
            const gap = 1.5 + r(side * 20 + i) * 3;
            const depth = 14 + r(side * 30 + i) * 22;
            const tall = r(side * 40 + i);
            const h = (8 + tall * tall * 105 + r(side * 50 + i) * 12) * (.35 + .65 * cityK);
            const x0 = side > 0 ? 21.5 : -21.5;
            const x = x0 + side * depth / 2;
            const zc = zz + Math.min(len, (k + 1) * SEG - zz) / 2;
            const L = Math.min(len, (k + 1) * SEG - zz);
            const col = BLDG_COLORS[(r(side * 60 + i) * BLDG_COLORS.length) | 0];
            B.building.add(x, 0, zc, depth, h, L, col);
            if (r(side * 70 + i) < .45) B.roofBox.add(x + (r(i + 7) - .5) * depth * .4, h, zc, depth * .3, 2 + r(i) * 3, L * .3, 0x9aa0a6);
            if (r(side * 80 + i) < .35 && h > 14) {
              const sy = 5 + r(i + 3) * Math.min(20, h - 10);
              B.neon.add(side > 0 ? x0 - .3 : x0 + .3, sy, zc, .3, 1.2 + r(i + 4) * 2, L * .6, NEON[(r(i + 5) * NEON.length) | 0]);
            }
            zz += L + gap; i++;
          }
          // skyline row
          for (let j = 0; j < 2; j++) {
            const h = (30 + r(side * 90 + j) ** 2 * 170) * cityK;
            const d = 20 + r(side * 95 + j) * 25;
            B.building.add(side * (75 + r(side + j) * 80), 0, k * SEG + (j + .5) * SEG / 2, d, h, 18 + r(j + 11) * 10, BLDG_COLORS[(r(side * 99 + j) * BLDG_COLORS.length) | 0]);
          }
        }
      } else {
        // ---- highway ----
        const openK = 1 - c;
        this.highwayFurniture(B, k, z, openK, biome);
        this.highwayScenery(B, k, z, openK, biome, this.density);
        if (BIOME[biome].rock) {
          // canyon walls, broken up so the same block never repeats down the road
          const { rock: pal0, rockCap } = BIOME[biome];
          for (const side of [1, -1]) {
            let zz = k * SEG, i = 0;
            while (zz < (k + 1) * SEG) {
              const len = 12 + r(side * 200 + i) * 26, dep = 22 + r(side * 210 + i) * 44;
              const h = (10 + r(side * 220 + i) * 38) * openK;
              const x = side * (78 + r(side * 230 + i) * 46 + dep / 2);
              const pal = pal0[(r(side * 240 + i) * pal0.length) | 0];
              const yaw = (r(side * 260 + i) - .5) * .5;
              B.rock.add(x, 0, zz + len / 2, dep, h * .55, len, pal[0], yaw);
              B.rock.add(x + side * dep * .12, h * .55, zz + len / 2, dep * .8, h * .45, len * .9, pal[1], yaw);
              // a snow-capped peak shows up more often than the plain rocky spur other biomes get
              if (r(side * 250 + i) < (rockCap ? .7 : .45)) B.rock.add(x + side * dep * .2, h, zz + len / 2, dep * .45, h * .3, len * .6, rockCap || pal[0], yaw * 1.6);
              zz += len; i++;
            }
          }
        }
      }
    }
    this.batchList.forEach((b) => b.end());
  }

  // Everything that lives beside a running lane. Driven entirely by hash(k, ...) so the same
  // stretch of road is built identically for every player in a party, and so nothing lands on a
  // fixed interval - the point is that no two segments look the same.
  highwayFurniture(B, k, z, openK, biome) {
    const r = (i) => hash(k, i, 911);
    const z0 = k * SEG;
    const kind = hash(k >> 2, 61);                    // barrier type, held over several segments
    const jerseySide = kind < .22, wire = kind > .82; // concrete stretch / high-tension cable stretch

    // ---- barriers, both shoulders ----
    for (const [rx, face] of [[12.3, 1], [-12.3, -1]]) {
      if (jerseySide) {
        // concrete: a sloped base and a narrower top, in 4m castings with a visible joint
        for (let p = 0; p < SEG / 4; p++) {
          const bz = z0 + p * 4 + 2;
          B.jersey.add(rx, 0, bz, .62, .5, 3.9);
          B.jersey.add(rx, .5, bz, .38, .42, 3.9);
          if (p % 3 === 0) B.reflect.add(rx - face * .2, .82, bz, .1, .1, .06, 0xffd24a);
        }
      } else {
        // W-beam: two ribs and a post line, with a reflector every fourth post
        B.gbeam.add(rx, .52, z, .1, .16, SEG);
        B.gbeam.add(rx, .74, z, .1, .16, SEG);
        B.gbeam.add(rx, .64, z, .13, .06, SEG);
        for (let p = 0; p < 12; p++) {
          const pz = z0 + p * 4 + 2;
          B.gpost.add(rx + face * .1, 0, pz, .1, .72, .12);
          if (p % 4 === 1) B.reflect.add(rx - face * .16, .78, pz, .09, .12, .05, face > 0 ? 0xffb020 : 0xff5a3c);
        }
        if (wire) for (let p = 0; p < 6; p++) B.gpost.add(rx + face * .1, .86, z0 + p * 8 + 3, .06, .5, .06);
      }
      // delineator posts just off the paved edge, every 16m
      for (let p = 0; p < 3; p++) {
        const dz = z0 + p * 16 + 6;
        B.delin.add(rx + face * 1.4, 0, dz, .07, 1.05, .07);
        B.reflect.add(rx + face * 1.4 - face * .05, .88, dz, .07, .16, .04, face > 0 ? 0xffb020 : 0xff5a3c);
      }
    }

    // ---- signs beside the road ----
    const sg = hash(k, 31);
    if (sg < .13) {                                   // speed limit
      const side = r(2) < .5 ? 1 : -1, sx = side * 15.5;
      B.spost.add(sx, 0, z + 8, .13, 2.6, .13);
      B.sgSpeed.add(sx, 3.35, z + 8, 1.5, 1.9, .09, undefined, side > 0 ? Math.PI : 0);
    } else if (sg < .22) {                            // route shield
      const side = r(3) < .5 ? 1 : -1, sx = side * 15.5;
      B.spost.add(sx, 0, z + 20, .13, 2.4, .13);
      B.sgShield.add(sx, 3.1, z + 20, 1.4, 1.4, .09, undefined, side > 0 ? Math.PI : 0);
    } else if (sg < .30) {                            // warning diamond, turned 45 degrees
      const side = r(4) < .5 ? 1 : -1, sx = side * 15.5;
      B.spost.add(sx, 0, z + 14, .13, 2.5, .13);
      B.sgWarn.add(sx, 3.3, z + 14, 1.45, 1.45, .09, undefined, side > 0 ? Math.PI : 0);
    }
    // mile markers, small and frequent, always on the right
    if ((k & 3) === 0) {
      B.spost.add(13.9, 0, z + 30, .07, 1.2, .07);
      B.sgMile.add(13.9, 1.75, z + 30, .5, 1, .06, undefined, Math.PI);
    }

    // ---- overhead gantry: a real truss with legs, not a bar ----
    if (hash(k, 5, 5) < .14 && openK > .85) {
      const gz = z + 6;
      for (const px of [-13.4, 13.4]) {
        B.spost.add(px, 0, gz, .42, 8.6, .42);
        B.spost.add(px, 0, gz - .9, .3, 8.2, .3);
        for (let d = 0; d < 5; d++) B.spost.add(px, 1.4 + d * 1.6, gz - .45, .26, .1, 1.1, undefined, .5);
      }
      // the truss itself: top and bottom chords plus a zigzag web
      for (const yy of [8.25, 8.95]) B.spost.add(0, yy, gz, 27.2, .16, .16);
      for (const yy of [8.25, 8.95]) B.spost.add(0, yy, gz - .9, 27.2, .16, .16);
      for (let d = -8; d <= 8; d++) B.spost.add(d * 1.6, 8.6, gz - .45, .12, .9, .12);
      // boards hung under it
      const exitHere = hash(k, 71) < .5, flip = hash(k, 73) < .5;
      const left = flip ? B.sgGuide : B.sgGuide2, right = flip ? B.sgGuide2 : B.sgGuide;
      left.add(-5.2, 6.1, gz, 8.4, 4.2, .16);
      if (exitHere) { B.sgExit.add(5.4, 7.3, gz, 2.6, 2.6, .16); right.add(5.4, 5.1, gz, 7, 3.5, .16); }
      else right.add(5.4, 6.1, gz, 7, 4.2, .16);
      // gantry lighting, so the boards read at night
      for (const lx of [-5.2, 5]) B.reflect.add(lx, 8.1, gz + .5, .5, .07, .2, 0xfff0cc);
    }

    // ---- billboards, set well back and angled at the driver ----
    if (hash(k, 9, 3) < .1 && openK > .8) {
      const side = r(6) < .5 ? 1 : -1, bx = side * (30 + r(7) * 14), bz = z + r(8) * SEG;
      const art = B.sgBoard[(r(9) * B.sgBoard.length) | 0];
      const sc = .85 + r(10) * .5, yaw = side > 0 ? Math.PI - .22 : .22;
      for (const o of [-2.6, 2.6]) B.spost.add(bx + Math.cos(yaw) * o, 0, bz - Math.sin(yaw) * o, .26, 6.2, .26);
      art.add(bx, 6.2, bz, 9 * sc, 4.5 * sc, .2, undefined, yaw);
    }

    // ---- roadworks: a warning board and a barrier at the head of the closure ----
    if (hash(k, 13, 7) < .07 && openK > .9) {
      const side = r(11) < .5 ? 1 : -1;
      const edge = side * (ROAD_HALF - LW * .5);
      B.spost.add(side * 14.5, 0, z0 - 6, .12, 2.2, .12);
      B.sgWork.add(side * 14.5, 3, z0 - 6, 1.5, 1.5, .09, undefined, side > 0 ? Math.PI : 0);
      // a barrier board and a parked works truck at the head of the taper
      B.jersey.add(edge - side * 2.4, 0, z0 + 46, 1.6, .9, .7);
      B.reflect.add(edge - side * 2.4, .95, z0 + 46, 1.5, .1, .1, 0xff8a1e);
    }

    // ---- roadside odds and ends: emergency phone, cabinets, culvert headwalls ----
    if (hash(k, 17) < .12) {
      const side = r(12) < .5 ? 1 : -1;
      B.spost.add(side * 15, 0, z + 12, .12, 1.5, .12);
      B.reflect.add(side * 15, 1.6, z + 12, .34, .42, .2, 0xff7a2a);
    }
    if (hash(k, 19) < .18) {
      const side = r(13) < .5 ? 1 : -1;
      B.jersey.add(side * (16 + r(14) * 3), 0, z + r(15) * SEG, .9, .8, .7);
    }
    // culvert headwalls where a drain passes under the road
    if (hash(k, 23) < .16) for (const side of [1, -1]) B.jersey.add(side * 14.6, 0, z + 24, 2.2, .5, .5);

    // ---- fence line, following the boundary ----
    if (hash(k >> 1, 29) < .55) for (const side of [1, -1]) {
      const fx = side * (22 + hash(k >> 1, 33) * 6);
      B.fence.add(fx, .7, z, .06, 1.4, SEG);
      for (let p = 0; p < 8; p++) B.gpost.add(fx, 0, z0 + p * 6 + 3, .08, 1.5, .08);
    }

    // ---- power line marching alongside ----
    if ((k & 3) === 1) {
      const side = hash(k >> 2, 37) < .5 ? 1 : -1, px = side * (46 + hash(k, 39) * 20);
      const h = 15 + hash(k, 41) * 7;
      B.pylon.add(px, 0, z, .7, h, .7);
      B.pylon.add(px, h * .62, z, 5.6, .22, .22);
      B.pylon.add(px, h * .82, z, 4.2, .22, .22);
      B.pylon.add(px, h, z, 2.6, .22, .22);
      // the catenary between this tower and the next, as three shallow spans
      for (const [yy, ww] of [[h * .62, 5.6], [h * .82, 4.2]]) for (const o of [-ww / 2, ww / 2])
        B.pylon.add(px + o, yy - .5, z + SEG * 2, .05, .05, SEG * 4);
    }
    return true;
  }

  // Ground cover, terrain and the far horizon. Split out from the furniture so the density of the
  // cheap, numerous things can be turned down on its own for weaker hardware.
  highwayScenery(B, k, z, openK, biome, density) {
    const r = (i) => hash(k, i, 613);
    const z0 = k * SEG;
    const bio = BIOME[biome], leafy = bio.leafy;

    // ---- the verge: a graded embankment either side, so the road is not laid on a flat plane ----
    for (const side of [1, -1]) {
      const bh = .5 + hash(k, side * 7) * 1.1;
      const halfW = 9;                                   // semi-axis, so this spans 18m across
      B.ridge.add(side * (16 + halfW), -bh * .55, z, halfW, bh, SEG * .34, bio.ridge);
    }

    // ---- grass and scrub, thickest at the verge and thinning outwards ----
    const n = Math.round(46 * openK * density);
    for (let i = 0; i < n; i++) {
      const side = r(i) < .5 ? 1 : -1;
      // bias towards the road so the verge is dense and the distance is sparse
      const t = r(i + 200) ** 2;
      const x = side * (14.5 + t * 85);
      const zz = z0 + r(i + 400) * SEG;
      const sc = .4 + r(i + 600) * .9;
      B.tuft.add(x, 0, zz, sc * .7, sc * bio.tuftTall, sc * .7,
        bio.tuft[(r(i + 800) * bio.tuft.length) | 0], r(i + 1000) * 6.283);
    }

    // ---- bigger plants: never the same size, never the same angle, never evenly spaced ----
    const pn = Math.round(bio.plantDensity * openK * density);
    for (let i = 0; i < pn; i++) {
      const side = r(i + 30) < .5 ? 1 : -1;
      const x = side * (18 + r(i + 50) ** 1.6 * 70);
      const zz = z0 + r(i + 70) * SEG;
      const sc = .7 + r(i + 90) * 1.5;
      const yaw = r(i + 110) * 6.283;
      if (leafy) {
        if (r(i + 130) < .68) {                       // tree, three silhouettes
          const kind = r(i + 150), leaf = bio.leaf;
          B.trunk.add(x, 0, zz, .3 * sc, 2.4 * sc, .3 * sc, undefined, yaw);
          if (kind < .4) {                            // tall conifer
            B.crown.add(x, 3.4 * sc, zz, 1.5 * sc, 3.2 * sc, 1.5 * sc, leaf.conifer[0], yaw);
            B.crown.add(x, 5.2 * sc, zz, 1 * sc, 2 * sc, 1 * sc, leaf.conifer[1], yaw);
          } else if (kind < .78) {                    // broad round crown
            B.crown.add(x, 3.6 * sc, zz, 2.4 * sc, 2.1 * sc, 2.4 * sc, leaf.broad, yaw);
          } else {                                    // scrubby, two lobes
            B.crown.add(x - .5 * sc, 3 * sc, zz, 1.6 * sc, 1.5 * sc, 1.6 * sc, leaf.scrub[0], yaw);
            B.crown.add(x + .6 * sc, 3.4 * sc, zz, 1.3 * sc, 1.3 * sc, 1.3 * sc, leaf.scrub[1], yaw);
          }
        } else {
          B.bush.add(x, sc * .3, zz, sc, sc * .6, sc, undefined, yaw);
        }
      } else {
        if (r(i + 130) < .42) {                       // saguaro, arms at random heights
          const h = 2.4 + r(i + 170) * 3.4;
          B.cactus.add(x, 0, zz, .62, h, .62, undefined, yaw);
          if (r(i + 190) < .75) { B.cactus.add(x + .72, h * .42, zz, .46, h * .34, .46); B.cactus.add(x + .42, h * .42, zz, .68, .36, .36); }
          if (r(i + 210) < .5) { B.cactus.add(x - .72, h * .3, zz, .46, h * .3, .46); B.cactus.add(x - .42, h * .3, zz, .68, .36, .36); }
        } else if (r(i + 230) < .6) {
          B.bush.add(x, sc * .25, zz, sc * 1.1, sc * .45, sc * 1.1, undefined, yaw);
        } else {                                      // a boulder, sunk into the ground
          const rc = ROCK[(r(i + 250) * ROCK.length) | 0];
          B.rock.add(x, -sc * .2, zz, sc * 2.2, sc * 1.3, sc * 1.8, rc[0], yaw);
        }
      }
    }

    // ---- road-surface decals: nothing here repeats with the texture ----
    const dn = Math.round(5 * density);
    for (let i = 0; i < dn; i++) {
      const dz = z0 + r(i + 300) * SEG;
      const roll = r(i + 320);
      if (roll < .4) {                                 // a resurfaced patch
        const w = 1.4 + r(i + 340) * 3.4, l = 2 + r(i + 360) * 6;
        B.decal.add((r(i + 380) - .5) * 17, .012, dz, w, 1, l, 0x1b1e26, (r(i + 400) - .5) * .12);
      } else if (roll < .72) {                         // a smear of rubber where somebody braked
        B.decal.add(laneX((r(i + 420) * LANES) | 0) + (r(i + 440) - .5) * 1.4, .012, dz, .5, 1, 3 + r(i + 460) * 7, 0x15171c);
      } else {                                         // dust and grit drifted off the shoulder
        const side = r(i + 480) < .5 ? 1 : -1;
        B.decal.add(side * (9.6 + r(i + 500) * 1.6), .012, dz, 1.6, 1, 5 + r(i + 520) * 9, 0x6b5c42);
      }
    }

    // ---- an overpass crossing above, with piers set back off the shoulder ----
    if (hash(k, 47) < .09 && openK > .9) {
      const bz = z + 10, deckY = 7.4 + hash(k, 49) * 1.2;
      B.deck.add(0, deckY, bz, 74, 1.1, 9);            // the deck, running across the road
      B.deck.add(0, deckY + 1.1, bz - 4.3, 74, .8, .45); // parapets
      B.deck.add(0, deckY + 1.1, bz + 4.3, 74, .8, .45);
      for (const px of [-15.5, 15.5, -30, 30]) {        // piers, clear of the carriageway
        B.pier.add(px, 0, bz, 1.7, deckY, 2.2);
        B.pier.add(px, deckY - .5, bz, 2.6, .5, 3.2);   // pier cap
      }
      // the embankment each end of the bridge
      for (const side of [1, -1]) B.ridge.add(side * 46, -2.5, bz, 12, 5.5, 7, bio.ridge);
    }

    // ---- the far horizon: layered ridges so the sky never meets flat ground ----
    if ((k & 1) === 0) {
      for (const side of [1, -1]) {
        for (let band = 0; band < 3; band++) {
          const wid = 80 + hash(k, side * 80 + band) * 120;          // semi-axis
          const inner = 150 + band * 300 + hash(k, side * 60 + band) * 110;
          const dist = inner + wid;                                   // placed by its near edge
          const hgt = (30 + hash(k, side * 70 + band) * 62) * (1 - band * .1);
          // each band further out is hazier, which reads as depth
          B.ridge.add(side * dist, -hgt * .45, z + hash(k, band) * SEG, wid, hgt, SEG * 1.1, bio.horizon[band]);
        }
      }
      // and something man-made out there, so it is not all landscape
      if (hash(k, 91) < .28) {
        const side = hash(k, 93) < .5 ? 1 : -1, dx = side * (260 + hash(k, 95) * 220);
        const kind = hash(k, 97);
        if (kind < .4) {                                // silo cluster
          for (let i = 0; i < 3; i++) B.pier.add(dx + i * 9, 0, z + 20, 6, 22 + hash(k, 99 + i) * 10, 6);
        } else if (kind < .7) {                         // warehouse
          B.deck.add(dx, 0, z + 30, 60, 12, 34);
        } else {                                        // radio mast
          B.pylon.add(dx, 0, z, 1.4, 52 + hash(k, 101) * 26, 1.4);
        }
      }
    }
  }

  update(focus, sky, glows, lights, dt) {
    const k0 = Math.floor(focus.z / SEG);
    if (k0 !== this.lastK) { this.lastK = k0; this.rebuild(k0); }
    const snap = Math.round(focus.z / TILE) * TILE;
    this.road.position.z = snap - 500;
    this.ground.position.set(Math.round(focus.x / 50) * 50, -.03, Math.round(focus.z / 50) * 50);
    this.sandTex.offset.set(this.ground.position.x / 15, -this.ground.position.z / 15);

    const c = cityAt(focus.z), bioGround = BIOME[biomeAt(focus.z)].ground;
    const gcol = new THREE.Color(bioGround).lerp(new THREE.Color(0x8a8780), c);
    this.groundMat.color.lerp(gcol, Math.min(1, dt * 1.5));

    const wet = sky.w.wet;
    this.roadMat.roughness = .88 - wet * .72;
    this.roadMat.color.setScalar(1 - wet * .45);
    const night = sky.lampsOn;
    windowGlow.value = sky.night;
    this.lampHeadMat.color.setRGB(.6 + night * 2.4, .55 + night * 1.9, .45 + night * 1.2);
    // Reflectors are unlit geometry, so they would be just as bright at noon. Scale them with the
    // dark instead: barely there by day, and the first thing you pick up in the headlights at night.
    this.reflectMat.color.setScalar(.5 + sky.night * 1.9);
    // Highway signs are retroreflective sheeting - at night they come back at you rather than
    // falling dark with everything else, so they get a low emissive lift once the sun is down.
    const signGlow = sky.night * .55;
    for (const m of this.signMats) m.emissiveIntensity = signGlow;
    this.neonMat.color.setScalar(.5 + sky.night * 1.8);

    this.tunnel = tunnelAmount(focus.z);
    this.tunnelLightMat.color.setScalar(1.8);
    let ti = 0;
    for (const l of this.tunnelLamps) {
      if (l.z > focus.z + 40 || l.z < focus.z - 260) continue;
      const L = this.tunnelPool[ti++] ||= { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, .93, .8), intensity: 4.5, range: 17, cosOuter: Math.cos(1.25), cosInner: Math.cos(.6) };
      L.pos.set(l.x, l.y, l.z);
      lights.push(L);
      glows.add(l.x, l.y + .05, l.z, 1, .92, .78, 1.2);
    }
    if (night) {
      let li = 0;
      for (const l of this.lampList) {
        if (l.z > focus.z + 80 || l.z < focus.z - 420) continue;
        const L = this.lightPool[li] ||= { pos: new THREE.Vector3(), dir: new THREE.Vector3(), color: new THREE.Color(1, .78, .5), intensity: 5, range: 30, cosOuter: Math.cos(1.2), cosInner: Math.cos(.55) };
        L.pos.set(l.x, l.y - .3, l.z); L.dir.set(0, -1, 0);
        lights.push(L); li++;
        glows.add(l.x, l.y - .25, l.z, 1, .82, .55, 3.2);
      }
    }
  }
}

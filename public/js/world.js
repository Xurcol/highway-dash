// Road, zone-based scenery (city -> highway -> city ...), street lamps.
import * as THREE from "three";
import { patchLit } from "./lights.js";

export const LANES = 5, LW = 4, ROAD_HALF = 10, SHOULDER = 1.5;
export const laneX = (i) => -ROAD_HALF + LW / 2 + i * LW;
export const OPP_CENTER = -28;
export const oppLaneX = (i) => -20 - i * LW;
const SEG = 48, TILE = 24, CYCLE = 16000;

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
export const biomeAt = (z) => (hash(Math.floor(-z / CYCLE), 77) < .5 || Math.floor(-z / CYCLE) === 0 ? "desert" : "green");

function roadTexture(renderer, opposite) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 512;
  const g = c.getContext("2d"), pxm = 512 / 23, pyz = 512 / TILE;
  g.fillStyle = "#2a2e38"; g.fillRect(0, 0, 512, 512);
  g.fillStyle = "#30343e"; g.fillRect(0, 0, SHOULDER * pxm, 512); g.fillRect(512 - SHOULDER * pxm, 0, SHOULDER * pxm, 512);
  for (let i = 0; i < 9000; i++) {
    const v = 30 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v + 3},${v + 10},${Math.random() * .5})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  // tire tracks
  g.fillStyle = "rgba(15,17,22,.18)";
  for (let l = 0; l < LANES; l++) for (const o of [-.9, .9]) g.fillRect((SHOULDER + LW / 2 + l * LW + o - .35) * pxm, 0, .7 * pxm, 512);
  g.fillStyle = "#e9e9e4";
  for (const x of [SHOULDER, 23 - SHOULDER]) g.fillRect((x - .1) * pxm, 0, .2 * pxm, 512);
  for (let l = 1; l < LANES; l++) for (const y of [0, 12]) g.fillRect((SHOULDER + l * LW - .08) * pxm, y * pyz, .16 * pxm, 3.2 * pyz);
  if (opposite) { g.fillStyle = "#e0b530"; g.fillRect((23 - SHOULDER - .35) * pxm, 0, .12 * pxm, 512); }
  else { g.fillStyle = "#e0b530"; g.fillRect((SHOULDER + .2) * pxm, 0, .12 * pxm, 512); }
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

export class World {
  constructor(renderer, scene) {
    this.scene = scene;
    const lit = (o) => patchLit(new THREE.MeshStandardMaterial(o));
    this.roadMat = lit({ map: roadTexture(renderer, false), roughness: .9, metalness: 0 });
    this.oppMat = lit({ map: roadTexture(renderer, true), roughness: .9, metalness: 0 });
    const roadGeo = new THREE.PlaneGeometry(23, 1400).rotateX(-Math.PI / 2);
    this.road = new THREE.Mesh(roadGeo, this.roadMat);
    this.opp = new THREE.Mesh(roadGeo, this.oppMat);
    this.opp.position.x = OPP_CENTER;
    this.sandTex = noiseTexture(renderer, "#ffffff", .25);
    this.sandTex.repeat.set(400, 400);
    this.groundMat = lit({ color: 0xe2b875, map: this.sandTex, roughness: 1 });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), this.groundMat);
    this.ground.position.y = -.03;
    this.medianMat = lit({ color: 0xcfc6b0, roughness: .95 });
    this.median = new THREE.Mesh(new THREE.PlaneGeometry(5, 1400).rotateX(-Math.PI / 2), this.medianMat);
    this.median.position.set(-14, .01, 0);
    for (const m of [this.road, this.opp, this.ground, this.median]) { m.receiveShadow = true; scene.add(m); }

    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
    const concrete = lit({ color: 0xd8d4cc, roughness: .9 });
    const white = lit({ color: 0xffffff, roughness: .8, metalness: .1 });
    const metal = lit({ color: 0x9aa3ad, roughness: .45, metalness: .6 });
    const flat = lit({ color: 0xffffff, roughness: .95, flatShading: true });
    this.lampHeadMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, toneMapped: false });
    const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.neonMat = neonMat;

    this.b = {
      barrier: new Batch(scene, box, concrete, 60),
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
      sign: new Batch(scene, box, lit({ color: 0x1f7a3f, roughness: .6 }), 30),
      tWall: new Batch(scene, box, lit({ color: 0xd9d4c8, roughness: .65 }), 90),
      tBand: new Batch(scene, box, lit({ color: 0x2c3036, roughness: .5, metalness: .2 }), 90, { shadow: false }),
      tCeil: new Batch(scene, box, lit({ color: 0x6f7176, roughness: .9 }), 45),
      tPillar: new Batch(scene, box, concrete, 200),
      tLight: new Batch(scene, box, (this.tunnelLightMat = new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false })), 1000, { shadow: false }),
      tPortal: new Batch(scene, box, lit({ color: 0xa9a49a, roughness: .95 }), 30),
      hill: new Batch(scene, new THREE.IcosahedronGeometry(1, 1), lit({ color: 0xffffff, roughness: 1, flatShading: true }), 320, { colors: true, shadow: false }),
    };
    this.lastK = null;
    this.lampList = [];   // {pos, dir} world-space lamp heads in range
    this.tunnelLamps = []; this.tunnelPool = []; this.tunnel = 0;
    this.lightPool = [];
  }

  rebuild(k0) {
    const B = this.b;
    Object.values(B).forEach((b) => b.begin());
    this.lampList.length = 0;
    this.tunnelLamps.length = 0;
    const kFrom = k0 - 30, kTo = k0 + 3;
    // long median barrier pieces
    for (let k = kFrom; k <= kTo; k++) {
      const z = k * SEG + SEG / 2, c = cityAt(z), biome = biomeAt(z);
      const r = (i) => hash(k, i, 911);
      B.barrier.add(-14, 0, z, .7, .95, SEG);
      const tun = tunnelSpan(z);
      if (tun) {
        const hillCol = c >= .5 ? 0x8a8780 : biome === "green" ? 0x5e9a48 : 0xc9763f;
        for (const [wx, face] of [[13.8, 1], [-41.6, -1]]) {
          B.tWall.add(wx, 0, z, .8, 9, SEG + .02);
          B.tBand.add(wx - face * .42, 0, z, .04, 1.25, SEG + .02);
          B.tBand.add(wx - face * .42, 7.2, z, .04, .25, SEG + .02);
        }
        B.tCeil.add(-13.9, 9, z, 56.2, .8, SEG + .02);
        B.hill.add(-14, -10, z, 90, 26, SEG * .9, hillCol);
        for (let p = 0; p < 4; p++) B.tPillar.add(-14, .95, k * SEG + p * 12 + 6, .7, 8.05, .7);
        for (let p = 0; p < 6; p++) {
          const lz = k * SEG + p * 8 + 4;
          for (const lx of [-4.5, 4.5, -23.5, -32.5]) B.tLight.add(lx, 8.93, lz, .45, .07, 2.8);
          if (p % 2 === 0) for (const lx of [-4.5, 4.5]) this.tunnelLamps.push({ x: lx, y: 8.75, z: lz });
        }
        for (const pz of tun) if (pz >= k * SEG - .01 && pz <= (k + 1) * SEG + .01) {
          B.tPortal.add(-13.9, 9, pz, 60, 8, 2.4);
          B.tPortal.add(19, 0, pz, 10, 17, 4);
          B.tPortal.add(-47, 0, pz, 11, 17, 4);
          B.hill.add(-14, -6, pz + (pz === tun[0] ? -18 : 18), 80, 26, 40, hillCol);
        }
        continue;
      }
      // median lamps (every segment), heads over both carriageways
      B.pole.add(-14, .95, z, .3, 10, .3);
      for (const s of [1, -1]) {
        B.arm.add(-14 + s * 2.6, 10.6, z, 5.2, .18, .18);
        const hx = -14 + s * 5;
        B.head.add(hx, 10.35, z, 1.1, .22, .45);
        this.lampList.push({ x: hx, y: 10.2, z });
      }

      if (c >= .5) {
        // ---- city ----
        const cityK = c;
        B.sidewalk.add(16.2, 0, z, 8, .18, SEG); B.curb.add(12.3, 0, z, .3, .22, SEG);
        B.sidewalk.add(-44.5, 0, z, 8, .18, SEG); B.curb.add(-40.3, 0, z, .3, .22, SEG);
        // sidewalk lamps + trees
        for (const [px, hx] of [[12.9, 11.2], [-40.9, -39.2]]) {
          const lz = z - SEG / 2;
          B.pole.add(px, 0, lz, .22, 8, .22);
          B.arm.add((px + hx) / 2, 8, lz, Math.abs(px - hx) + .2, .12, .12);
          B.head.add(hx, 7.85, lz, .8, .18, .35);
          this.lampList.push({ x: hx, y: 7.7, z: lz });
        }
        for (const tx of [18.5, -46.8]) for (const tz of [z - 12, z + 12]) {
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
            const x0 = side > 0 ? 21.5 : -50.5;
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
            B.building.add(side > 0 ? 75 + r(side + j) * 80 : -110 - r(side + j) * 80, 0, k * SEG + (j + .5) * SEG / 2, d, h, 18 + r(j + 11) * 10, BLDG_COLORS[(r(side * 99 + j) * BLDG_COLORS.length) | 0]);
          }
        }
      } else {
        // ---- highway ----
        const openK = 1 - c;
        for (const [rx, face] of [[12.3, 1], [-40.3, -1]]) {
          B.rail.add(rx, .55, z, .12, .32, SEG);
          for (let p = 0; p < 12; p++) B.post.add(rx + face * .12, 0, k * SEG + p * 4, .12, .75, .12);
        }
        if (hash(k, 5, 5) < .05 && openK > .9) { // overhead sign gantry
          for (const px of [-11.8, 12.6]) B.pole.add(px, 0, z, .35, 8.5, .35);
          B.arm.add(.4, 8.3, z, 24.8, .35, .35);
          B.sign.add(-4, 6.2, z, 7, 3, .25); B.sign.add(5, 6.2, z, 5, 3, .25);
        }
        if (biome === "desert") {
          for (let i = 0; i < 7 * openK; i++) {
            const side = r(i) < .5 ? 1 : -1;
            const x = side > 0 ? 16 + r(i + 20) * 45 : -45 - r(i + 20) * 45;
            const zz = k * SEG + r(i + 40) * SEG;
            if (r(i + 60) < .55) {
              const h = 2.5 + r(i + 80) * 3.5;
              B.cactus.add(x, 0, zz, .7, h, .7);
              B.cactus.add(x + .75, h * .45, zz, .5, h * .35, .5);
              B.cactus.add(x + .45, h * .45, zz, .7, .4, .4);
              if (r(i + 90) < .5) { B.cactus.add(x - .75, h * .3, zz, .5, h * .3, .5); B.cactus.add(x - .45, h * .3, zz, .7, .4, .4); }
            } else { const s = 1 + r(i + 100) * 1.8; B.bush.add(x, s * .3, zz, s, s * .55, s); }
          }
          // canyon walls
          for (const side of [1, -1]) {
            let zz = k * SEG, i = 0;
            while (zz < (k + 1) * SEG) {
              const len = 14 + r(side * 200 + i) * 20, dep = 25 + r(side * 210 + i) * 40;
              const h = (12 + r(side * 220 + i) * 34) * openK;
              const x = side > 0 ? 70 + r(side * 230 + i) * 30 + dep / 2 : -95 - r(side * 230 + i) * 30 - dep / 2;
              const pal = ROCK[(r(side * 240 + i) * ROCK.length) | 0];
              B.rock.add(x, 0, zz + len / 2, dep, h * .55, len, pal[0]);
              B.rock.add(x + side * dep * .12, h * .55, zz + len / 2, dep * .8, h * .45, len * .9, pal[1]);
              if (r(side * 250 + i) < .4) B.rock.add(x + side * dep * .2, h, zz + len / 2, dep * .45, h * .25, len * .6, pal[0]);
              zz += len; i++;
            }
          }
        } else {
          for (let i = 0; i < 8 * openK; i++) {
            const side = r(i) < .5 ? 1 : -1;
            const x = side > 0 ? 17 + r(i + 20) * 60 : -46 - r(i + 20) * 60;
            const zz = k * SEG + r(i + 40) * SEG, s = .9 + r(i + 50) * .9;
            B.trunk.add(x, 0, zz, .35 * s, 2.5 * s, .35 * s);
            B.crown.add(x, 3.8 * s, zz, 2 * s, 2.6 * s, 2 * s, r(i + 70) < .3 ? 0x2f6e35 : 0x4a9a3e);
          }
          for (const side of [1, -1]) {
            const s = 40 + r(side * 300) * 50;
            B.hill.add(side > 0 ? 110 + r(side * 310) * 60 : -140 - r(side * 310) * 60, -s * .55, z, s * 1.4, s, s, r(side * 320) < .5 ? 0x5e9a48 : 0x6fa852);
          }
        }
      }
    }
    Object.values(B).forEach((b) => b.end());
  }

  update(focus, sky, glows, lights, dt) {
    const k0 = Math.floor(focus.z / SEG);
    if (k0 !== this.lastK) { this.lastK = k0; this.rebuild(k0); }
    const snap = Math.round(focus.z / TILE) * TILE;
    this.road.position.z = this.opp.position.z = this.median.position.z = snap - 500;
    this.ground.position.set(Math.round(focus.x / 50) * 50, -.03, Math.round(focus.z / 50) * 50);
    this.sandTex.offset.set(this.ground.position.x / 15, -this.ground.position.z / 15);

    const c = cityAt(focus.z), green = biomeAt(focus.z) === "green";
    const gcol = new THREE.Color(green ? 0x7fae5a : 0xe2b875).lerp(new THREE.Color(0x8a8780), c);
    this.groundMat.color.lerp(gcol, Math.min(1, dt * 1.5));
    this.medianMat.color.set(c > .5 ? 0x9a978f : 0xcfc6b0);

    const wet = sky.w.wet;
    for (const m of [this.roadMat, this.oppMat]) {
      m.roughness = .88 - wet * .72;
      m.color.setScalar(1 - wet * .45);
    }
    const night = sky.lampsOn;
    windowGlow.value = sky.night;
    this.lampHeadMat.color.setRGB(.6 + night * 2.4, .55 + night * 1.9, .45 + night * 1.2);
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

// New Meridian's own structures, drawn (the data is in hero-extras-map.js). Built once into the city's
// group when the hero city is built, as a handful of merged and instanced meshes; after that only the
// river, the square's screens and the night lights change.
import * as THREE from "three";
import { patchLit } from "./lights.js?v=mvbqx7dj";
import { RIVER, TUNNEL, DECK, ADS, deckY } from "./hero-extras-map.js?v=mvbqx7dj";

const lit = (o) => patchLit(new THREE.MeshStandardMaterial(o));
const BOX = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
const BOXC = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10).translate(0, .5, 0);
const CYLC = new THREE.CylinderGeometry(1, 1, 1, 8).rotateZ(Math.PI / 2);   // along x, centred

// instanced boxes in batches of a few hundred, colour per instance
class Batch {
  constructor(parent, geo, mat, { shadow = true } = {}) { this.parent = parent; this.geo = geo; this.mat = mat; this.ops = []; this.shadow = shadow; }
  box(x, y, z, sx, sy, sz, col, rotY = 0) { this.ops.push([0, x, y, z, sx, sy, sz, col, rotY]); }
  span(ax, ay, az, bx, by, bz, sy, sz, col) { this.ops.push([1, ax, ay, az, bx, by, bz, sy, sz, col]); }
  end() {
    if (!this.ops.length) return;
    const m = new THREE.InstancedMesh(this.geo, this.mat, this.ops.length);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.ops.length * 3), 3);
    const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    this.ops.forEach((o, i) => {
      if (o[0] === 0) { q.setFromEuler(e.set(0, o[8], 0)); M4.compose(p.set(o[1], o[2], o[3]), q, s.set(o[4], o[5], o[6])); m.setColorAt(i, c.set(o[7])); }
      else {
        X.set(o[4] - o[1], o[5] - o[2], o[6] - o[3]); const L = X.length() || 1e-4; X.divideScalar(L);
        Y.set(0, 1, 0); if (Math.abs(X.y) > .95) Y.set(1, 0, 0); Y.addScaledVector(X, -Y.dot(X)).normalize(); Z.crossVectors(X, Y);
        M4.makeBasis(X, Y, Z).scale(s.set(L, o[7], o[8])).setPosition((o[1] + o[4]) / 2, (o[2] + o[5]) / 2, (o[3] + o[6]) / 2);
        m.setColorAt(i, c.set(o[9]));
      }
      m.setMatrixAt(i, M4);
    });
    m.castShadow = this.shadow; m.receiveShadow = true;
    m.computeBoundingSphere();
    this.parent.add(m);
    return m;
  }
}

function canvas(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
// a truss: see-through lattice for crane masts and jibs
function trussTex() {
  return canvas(128, 128, (g, w) => {
    g.clearRect(0, 0, w, w); g.strokeStyle = "#fff"; g.lineWidth = 10;
    g.strokeRect(5, 5, w - 10, w - 10);
    g.beginPath(); g.moveTo(5, 5); g.lineTo(w - 5, w - 5); g.moveTo(w - 5, 5); g.lineTo(5, w - 5); g.stroke();
  });
}
// one billboard's face
function adCanvas(a, g, x, y, w, h) {
  g.save(); g.translate(x, y);
  g.fillStyle = a.bg; g.fillRect(0, 0, w, h);
  // a bold shape behind the type, different per brand
  g.globalAlpha = .18; g.fillStyle = a.fg;
  const k = a.t.length % 4;
  if (k === 0) { g.beginPath(); g.arc(w * .82, h * .5, h * .55, 0, 7); g.fill(); }
  else if (k === 1) { for (let i = 0; i < 6; i++) g.fillRect(w * .6 + i * w * .07, 0, w * .03, h); }
  else if (k === 2) { g.beginPath(); g.moveTo(w * .55, h); g.lineTo(w, 0); g.lineTo(w, h); g.fill(); }
  else { g.fillRect(0, h * .78, w, h * .08); }
  g.globalAlpha = 1;
  g.fillStyle = a.fg; g.textBaseline = "middle";
  let fs = h * .36; g.font = `italic 800 ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  while (g.measureText(a.t).width > w * .86 && fs > 10) { fs -= 2; g.font = `italic 800 ${fs}px "Barlow Condensed", "Arial Narrow", sans-serif`; }
  g.fillText(a.t, w * .06, h * .42);
  g.font = `600 ${h * .12}px "Barlow", Arial, sans-serif`; g.globalAlpha = .9;
  g.fillText(a.s.toUpperCase(), w * .065, h * .74);
  g.restore();
}

// kit: things city.js already made that are worth sharing (its concrete and road materials)
export function buildHeroExtras(M, G, kit) {
  const hx = M.hx, out = { screens: [], water: null, lights: [], glows: [] };
  const E = RIVER.inner, O = RIVER.outer, T = TUNNEL;
  const conc = kit.mat.concrete, road = kit.mat.road, metal = lit({ color: 0xffffff, roughness: .5, metalness: .55 });
  const solid = new Batch(G, BOX, lit({ color: 0xffffff, roughness: .8, metalness: .1 }));
  const steel = new Batch(G, BOX, metal);
  const thin = new Batch(G, BOXC, metal, { shadow: false });
  const pipes = new Batch(G, CYL, metal);
  const K = { conc: 0xb9b5ac, dark: 0x3a3d42, steel: 0x6d737c, yellow: 0xe8b419, rail: 0x8d9299, white: 0xe8e8e2, red: 0x8c1d1d, grate: 0x2f3236 };

  // ---- the river ----
  const waterMat = lit({ color: 0x173642, roughness: .2, metalness: .12, envMapIntensity: .9 });
  const wU = { t: { value: 0 } };
  waterMat.onBeforeCompile = ((orig) => (sh) => {
    orig(sh);
    sh.uniforms.wT = wU.t;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vWP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float wT; varying vec3 vWP;")
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        { vec2 p = vWP.xz * .18; float t = wT;
          vec2 d = vec2(sin(p.x * 1.7 + t * 1.3) + sin(p.y * 2.3 - t * .9 + p.x * .7), cos(p.y * 1.9 + t * 1.1) + sin(p.x * 2.9 + p.y * 1.3 - t * 1.6))
                 + vec2(sin(p.x * 7.1 + t * 3.), cos(p.y * 6.3 - t * 2.7)) * .012;
          normal = normalize(normal + (viewMatrix * vec4(d.x, 0., d.y, 0.)).xyz); }`);
  })(waterMat.onBeforeCompile);
  waterMat.customProgramCacheKey = () => "lampsriver1";
  for (const w of hx.water) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w.x1 - w.x0, w.z1 - w.z0).rotateX(-Math.PI / 2), waterMat);
    m.position.set((w.x0 + w.x1) / 2, RIVER.y, (w.z0 + w.z1) / 2); m.receiveShadow = true;
    G.add(m);
  }
  out.water = wU;
  // quay walls and the river bed under the water (dark, so the depth reads)
  for (const [x0, z0, x1, z1] of [[-E, -E - 1, E, -E], [-E, E, E, E + 1], [-E - 1, -E, -E, E], [E, -E, E + 1, E], [-O, -O, O, -O + 1], [-O, O - 1, O, O], [-O, -O, -O + 1, O], [O - 1, -O, O, O]])
    solid.box((x0 + x1) / 2, -7, (z0 + z1) / 2, x1 - x0, 7.15, z1 - z0, K.conc);
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(O * 2 + 40, O * 2 + 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a1418 }));
  bed.position.y = -7; G.add(bed);
  // the mainland's ground: four big strips round the river
  const far = 3600;
  for (const [x0, z0, x1, z1] of [[-far, -far, far, -O], [-far, O, far, far], [-far, -O, -O, O], [O, -O, far, O]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), kit.mat.grass);
    m.geometry.attributes.uv.array.forEach((v, i, a) => (a[i] = v * (i % 2 ? (z1 - z0) : (x1 - x0)) / 6));
    m.position.set((x0 + x1) / 2, -.03, (z0 + z1) / 2); m.receiveShadow = true;
    G.add(m);
  }
  // a promenade along the mainland quay
  for (const [x0, z0, x1, z1] of [[-O, -O - 14, O, -O], [-O, O, O, O + 14], [-O - 14, -O, -O, O], [O, -O, O + 14, O]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), kit.mat.walk);
    m.geometry.attributes.uv.array.forEach((v, i, a) => (a[i] = v * (i % 2 ? (z1 - z0) : (x1 - x0)) / 3));
    m.position.set((x0 + x1) / 2, .02, (z0 + z1) / 2); m.receiveShadow = true; G.add(m);
  }

  // ---- the subway: pits, platforms, tracks, the tunnel and its lights ----
  const tile = lit({ color: 0xd9d6cf, roughness: .5, metalness: .05 });
  for (const P of hx.pits) {
    // walls (with the tunnel mouths left open), the trench, the platforms
    for (const [x0, z0, x1, z1] of [[P.x0 - .5, P.z0 - .5, P.x1 + .5, P.z0], [P.x0 - .5, P.z1, P.x1 + .5, P.z1 + .5]]) solid.box((x0 + x1) / 2, T.floor - .8, (z0 + z1) / 2, x1 - x0, .95 - T.floor, z1 - z0, K.conc);
    for (const [xa, xb] of [[P.x0 - .5, P.x0], [P.x1, P.x1 + .5]]) {
      solid.box((xa + xb) / 2, T.floor - .8, (P.z0 + T.z0) / 2, .5, .95 - T.floor, T.z0 - P.z0, K.conc);
      solid.box((xa + xb) / 2, T.floor - .8, (T.z1 + P.z1) / 2, .5, .95 - T.floor, P.z1 - T.z1, K.conc);
      solid.box((xa + xb) / 2, T.ceil, (T.z0 + T.z1) / 2, .5, .15 - T.ceil, T.z1 - T.z0, K.conc);
    }
    const bedM = new THREE.Mesh(new THREE.BoxGeometry(P.x1 - P.x0, .6, T.z1 - T.z0), conc);
    bedM.position.set((P.x0 + P.x1) / 2, T.floor - .3, (T.z0 + T.z1) / 2); bedM.receiveShadow = true; G.add(bedM);
    // a sign over the plaza
    out.lights.push({ x: (P.x0 + P.x1) / 2, y: T.floor + 5.5, z: (P.z0 + P.z1) / 2, r: 30 });
  }
  for (const p of hx.platforms) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(p.x1 - p.x0, p.y - (T.floor - .6), p.z1 - p.z0), tile);
    m.position.set((p.x0 + p.x1) / 2, (p.y + T.floor - .6) / 2, (p.z0 + p.z1) / 2); m.receiveShadow = true; G.add(m);
    // the yellow safety line along the edge
    const edge = p.z0 === T.z1 ? p.z0 + .35 : p.z1 - .35;
    thin.box((p.x0 + p.x1) / 2, p.y + .01, edge, p.x1 - p.x0, .02, .4, K.yellow);
  }
  // the tunnel: floor, walls, roof, two tracks the length of it, lamps every 16 m
  {
    const L = T.x1 - T.x0 + 112, cx = (T.x0 + T.x1) / 2, cz = (T.z0 + T.z1) / 2;
    solid.box(cx, T.floor - .6, cz, T.x1 - T.x0, .6, T.z1 - T.z0, K.dark);
    solid.box(cx, T.floor - .6, T.z0 - .3, T.x1 - T.x0, -.25 - T.floor + .6, .6, K.dark);
    solid.box(cx, T.floor - .6, T.z1 + .3, T.x1 - T.x0, -.25 - T.floor + .6, .6, K.dark);
    solid.box(cx, T.ceil, cz, T.x1 - T.x0, .2, T.z1 - T.z0 + 1.2, 0x2a2c30);
    for (const tz of [T.z0 + 3, T.z1 - 3]) for (const o of [-.72, .72]) thin.box(cx, T.floor + .08, tz + o, L, .12, .1, K.rail);
    for (let x = T.x0 - 50; x <= T.x1 + 50; x += 2.2) for (const tz of [T.z0 + 3, T.z1 - 3]) thin.box(x, T.floor + .02, tz, .3, .06, 2.4, 0x4a4036);
    for (let x = T.x0 + 8; x < T.x1; x += 16) { thin.box(x, T.ceil - .08, cz, 1.6, .1, .3, 0xfff4dc); out.glows.push([x, T.ceil - .2, cz, 1, .92, .75, 1.2]); out.lights.push({ x, y: T.ceil - .3, z: cz, r: 16 }); }
  }
  // stairs down into each pit: steps on the ramp, with a rail each side
  for (const s of hx.stairs) {
    const n = Math.ceil(Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z) / .9);
    for (let i = 0; i < n; i++) { const t = (i + .5) / n, x = s.a.x + (s.b.x - s.a.x) * t, y = s.a.y + (s.b.y - s.a.y) * t, z = s.a.z + (s.b.z - s.a.z) * t; solid.box(x, y - .5, z, 1, .52, s.hw * 2, 0xc9c5bc); }
    for (const o of [-s.hw, s.hw]) thin.span(s.a.x, s.a.y + 1, s.a.z + o, s.b.x, s.b.y + 1, s.b.z + o, .06, .06, K.rail);
  }
  for (const c of hx.canopies) { steel.box((c.x0 + c.x1) / 2, c.y, (c.z0 + c.z1) / 2, c.x1 - c.x0, .25, c.z1 - c.z0, 0x2b3440); for (const [x, z] of [[c.x0 + .5, c.z0 + .5], [c.x1 - .5, c.z0 + .5], [c.x0 + .5, c.z1 - .5], [c.x1 - .5, c.z1 - .5]]) steel.box(x, 0, z, .2, c.y, .2, K.dark); }
  for (const s of hx.signs) {
    const tex = canvas(512, 96, (g, w, h) => {
      g.fillStyle = "#123a6b"; g.fillRect(0, 0, w, h); g.fillStyle = "#fff"; g.font = "italic 800 46px 'Barlow Condensed', Arial"; g.textBaseline = "middle"; g.fillText(s.text, 22, h * .42);
      g.font = "600 18px Barlow, Arial"; g.globalAlpha = .8; g.fillText(s.sub, 24, h * .8); g.globalAlpha = 1; g.fillStyle = "#f2c230"; g.beginPath(); g.arc(w - 50, h / 2, 30, 0, 7); g.fill();
      g.fillStyle = "#123a6b"; g.font = "800 38px Arial"; g.textAlign = "center"; g.fillText("M", w - 50, h / 2 + 2);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: .3, roughness: .6 }));
    m.position.set(s.x, s.y, s.z); m.rotation.y = Math.atan2(s.fx, s.fz); G.add(m);
    out.signMats = (out.signMats || []).concat(m.material);
  }

  // ---- construction sites ----
  const dirt = lit({ color: 0x7a6a55, roughness: 1, map: kit.tex?.gravel });
  for (const d of hx.dirt) { const m = new THREE.Mesh(new THREE.PlaneGeometry(d.x1 - d.x0, d.z1 - d.z0).rotateX(-Math.PI / 2), dirt); m.position.set((d.x0 + d.x1) / 2, .17, (d.z0 + d.z1) / 2); m.receiveShadow = true; G.add(m); }
  for (const f of hx.fences) { const L = Math.hypot(f.bx - f.ax, f.bz - f.az); solid.box((f.ax + f.bx) / 2, 0, (f.az + f.bz) / 2, f.ax === f.bx ? .1 : L, f.h, f.ax === f.bx ? L : .1, 0x2d4a34); }
  for (const f of hx.frames) {
    for (let y = f.y0 + f.fh; y <= f.y1 + .01; y += f.fh) solid.box((f.x0 + f.x1) / 2, y - .32, (f.z0 + f.z1) / 2, f.x1 - f.x0, .32, f.z1 - f.z0, 0xa8a49c);
    for (const c of f.cols) steel.box(c.x, f.y0 - .5, c.z, .64, f.y1 - f.y0 + .5, .64, 0x8a5a3a);
    // the edge of each slab gets a safety rail on the top floors
    out.beacons = (out.beacons || []).concat([[(f.x0 + f.x1) / 2, f.y1 + .6, (f.z0 + f.z1) / 2]]);
  }
  const truss = trussTex();
  const trussMat = lit({ color: 0xe8b419, roughness: .55, metalness: .4, map: truss, alphaTest: .5, side: THREE.DoubleSide });
  const lattice = new Batch(G, BOX, trussMat);
  for (const c of hx.cranes) {
    const ux = Math.cos(c.ang), uz = Math.sin(c.ang), rot = -c.ang;
    lattice.box(c.x, 0, c.z, 2, c.h, 2, 0xffffff);
    lattice.box(c.x + ux * (c.jib / 2), c.h, c.z + uz * (c.jib / 2), c.jib + 2, 1.8, 1.8, 0xffffff, rot);
    lattice.box(c.x - ux * (c.counter / 2), c.h, c.z - uz * (c.counter / 2), c.counter + 2, 1.6, 2.2, 0xffffff, rot);
    const cwx = c.x - ux * (c.counter - 3), cwz = c.z - uz * (c.counter - 3);
    solid.box(cwx, c.h - 3.2, cwz, 3.6, 3.2, 3.6, 0x6b6e73, rot);
    solid.box(c.x + ux * 2.2, c.h - 2.6, c.z + uz * 2.2, 2.2, 2.4, 2.2, 0xe8e6e0, rot);   // the cab
    lattice.box(c.x, c.h + 1.8, c.z, .8, 9.2, .8, 0xffffff);                         // the apex
    // the ties from the apex to the jib tip and the counterweight
    thin.span(c.x, c.h + 11, c.z, c.x + ux * c.jib, c.h + 1.8, c.z + uz * c.jib, .07, .07, 0x2a2a2a);
    thin.span(c.x, c.h + 11, c.z, cwx, c.h + 1.6, cwz, .07, .07, 0x2a2a2a);
    const hxp = c.x + ux * (c.jib * .7), hzp = c.z + uz * (c.jib * .7);
    thin.span(hxp, c.h, hzp, hxp, c.h - c.hook, hzp, .05, .05, 0x1a1a1a);
    steel.box(hxp, c.h - c.hook - 1, hzp, 6, .9, .8, 0xb2462a, rot);
    out.beacons = (out.beacons || []).concat([[c.x, c.h + 11.4, c.z], [c.x + ux * c.jib, c.h + 2, c.z + uz * c.jib]]);
  }
  for (const s of hx.stacks) {
    if (s.kind === "pipes") for (let k = 0; k < 6; k++) pipes.box(s.x, .15 + (k % 3) * .32, s.z + (Math.floor(k / 3) - .5) * .6, .16, s.w, .16, 0x5a5e64, s.rot + Math.PI / 2);
    else if (s.kind === "girders") steel.box(s.x, .15, s.z, s.rot ? s.d : s.w, s.h, s.rot ? s.w : s.d, 0x8a5a3a);
  }

  // ---- the port ----
  for (const p of hx.piers) { solid.box((p.x0 + p.x1) / 2, -6, (p.z0 + p.z1) / 2, p.x1 - p.x0, p.y + 6, p.z1 - p.z0, 0xa8a49c); for (let z = p.z0 + 6; z < p.z1; z += 12) for (const x of [p.x0 + .6, p.x1 - .6]) pipes.box(x, p.y, z, .35, .7, .35, 0x2a2b2e); }
  const box = lit({ color: 0xffffff, roughness: .6, metalness: .35, map: corrugated() });
  const cont = new Batch(G, BOX, box);
  for (const c of hx.containers) cont.box(c.x, c.y, c.z, c.sx - .04, c.sy - .04, c.sz, c.col);
  for (const g of hx.gantries) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) steel.box(g.x + sx * g.span / 2, 1.2, g.z + sz * 7, 1.8, g.h - 1.2, 1.8, 0x2c5f9e);
    for (const sz of [-1, 1]) steel.box(g.x, g.h - 3, g.z + sz * 7, g.span + 1.8, 3, 1.8, 0x2c5f9e);
    steel.box(g.x, g.h - 5, g.z - (g.boom - g.back) / 2, 3.2, 2, g.boom + g.back, 0x2c5f9e);
    steel.box(g.x, g.h - 8, g.z - g.boom * .45, 4, 3, 3, 0xe8e6e0);
    out.beacons = (out.beacons || []).concat([[g.x, g.h + .4, g.z], [g.x, g.h - 2.6, g.z - g.boom + 1]]);
  }
  for (const s of hx.ships) {
    const hull = new THREE.Mesh(shipHull(s.w, s.L, s.y1 - s.y0), lit({ color: 0x5a1a16, roughness: .55, metalness: .3 }));
    hull.position.set(s.x, s.y0, s.z); hull.castShadow = hull.receiveShadow = true; G.add(hull);
    solid.box(s.x, s.y1 - .3, s.z, s.w - .4, .3, s.L - 8, 0x3a3d42);
    const b = s.bridge;
    solid.box(s.x, s.y1, b.z1 - b.L / 2, s.w - 4, b.h, b.L, 0xeceae4);
    solid.box(s.x, s.y1 + b.h, b.z1 - b.L / 2 - 4, 3, 9, 3, 0x2a2b2e);
    for (let k = 0; k < 6; k++) for (let n = 0; n < 2 + (k % 3); n++) cont.box(s.x + (k % 2 ? -6 : 6), s.y1 + n * 2.6, s.z - s.L / 2 + 14 + Math.floor(k / 2) * 14, 2.4, 2.56, 12.2, [0xb81c1c, 0x1f5fbf, 0xd6a22a, 0x2e7d4f][(k + n) % 4]);
  }

  // ---- bridges ----
  const deckTop = new Batch(G, BOXC, road), deckSide = new Batch(G, BOX, conc), deckSpan = new Batch(G, BOXC, conc);
  const cableMat = new Batch(G, BOXC, lit({ color: 0x3c4148, roughness: .45, metalness: .7 }), { shadow: false });
  for (const b of hx.bridges) {
    const W = (u, w) => [b.ox + b.dx * u - b.dz * w, b.oz + b.dz * u + b.dx * w];
    const rot = Math.atan2(-b.dz, b.dx);   // turns local x onto the run
    for (let u = b.u0; u < b.u1; u += 4) {
      const y0 = deckY(u) + .15, y1 = deckY(u + 4) + .15, [x, z] = W(u + 2, 0), [ax, az] = W(u, 0), [bx, bz] = W(u + 4, 0);
      deckTop.span(ax, y0 - .02, az, bx, y1 - .02, bz, .04, b.hw * 2, 0xffffff);
      if (y0 > .6 || y1 > .6) deckSpan.span(ax, y0 - 1.25, az, bx, y1 - 1.25, bz, 2.4, b.hw * 2 + .4, K.conc);
      for (const s of [-1, 1]) { const [rx, rz] = W(u, s * (b.hw - .2)), [qx, qz] = W(u + 4, s * (b.hw - .2)); thin.span(rx, y0 + 1.05, rz, qx, y1 + 1.05, qz, .12, .12, K.rail); thin.span(rx, y0 + .5, rz, qx, y1 + .5, qz, .7, .3, 0x9aa0a6); }
      if (Math.round(u) % 24 === 0) for (const s of [-1, 1]) { const [lx, lz] = W(u, s * (b.hw - .5)); thin.box(lx, y0 + 4, lz, .18, 8, .18, K.steel); out.glows.push([lx - b.dz * s * -1.2, y0 + 7.8, lz + b.dx * s * -1.2, 1, .85, .6, 2.4]); }
    }
    for (const t of b.towers) {
      if (t.a) {
        for (const s of [-1, 1]) { const [ax, az] = W(t.u, s * 12), [bx, bz] = W(t.u, 0); deckSpan.span(ax, -6, az, bx, t.top, bz, 4, 4, 0xc9ccd2); }
        out.beacons = (out.beacons || []).concat([[W(t.u, 0)[0], t.top + 1, W(t.u, 0)[1]]]);
      } else {
        for (const s of [-1, 1]) { const [x, z] = W(t.u, s * 11.5); deckSide.box(x, -6, z, 3.4, t.top + 6, 3.4, 0xc9ccd2, rot); out.beacons = (out.beacons || []).concat([[x, t.top + .6, z]]); }
        for (const y of [13, 72, t.top - 4]) { const [x, z] = W(t.u, 0); deckSide.box(x, y, z, b.dz ? 23 : 3, 3, b.dz ? 3 : 23, 0xc9ccd2); }
      }
    }
    for (const c of b.cables) for (let i = 0; i < c.length - 1; i++) cableMat.span(c[i].x, c[i].y, c[i].z, c[i + 1].x, c[i + 1].y, c[i + 1].z, .9, .9, 0x3c4148);
    for (const h of b.hangers) cableMat.span(h.a.x, h.a.y, h.a.z, h.b.x, h.b.y, h.b.z, .12, .12, 0x3c4148);
    for (const s of b.stays) cableMat.span(s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z, .22, .22, 0xd9dce0);
  }

  // ---- billboards ----
  const AW = 512, AH = 256, cols = 4, rows = Math.ceil(ADS.length / cols);
  const adTex = canvas(AW * cols, AH * rows, (g) => ADS.forEach((a, i) => adCanvas(a, g, (i % cols) * AW, Math.floor(i / cols) * AH, AW, AH)));
  const adMat = new THREE.MeshStandardMaterial({ map: adTex, emissiveMap: adTex, emissive: 0xffffff, emissiveIntensity: .05, roughness: .5 });
  const adGeo = [];
  for (const b of hx.boards) {
    const u0 = (b.ad % cols) / cols, v1 = 1 - Math.floor(b.ad / cols) / rows, u1 = u0 + 1 / cols, v0 = v1 - 1 / rows;
    const g = new THREE.PlaneGeometry(b.w, b.h);
    const uv = g.attributes.uv.array; uv.set([u0, v1, u1, v1, u0, v0, u1, v0]);
    g.rotateY(Math.atan2(b.fx, b.fz)); g.translate(b.x + b.fx * .27, b.y, b.z + b.fz * .27);
    adGeo.push(g);
    steel.box(b.x, b.y - b.h / 2 - .3, b.z, b.fx ? .5 : b.w + .6, b.h + .6, b.fx ? b.w + .6 : .5, 0x1c1d20);
    if (b.legs !== undefined) for (const s of [-.4, .4]) steel.box(b.x - b.fz * b.w * s, b.legs, b.z + b.fx * b.w * s, .4, b.y - b.h / 2 - b.legs, .4, K.dark);
    // two lamps on arms over the top
    for (const s of [-.3, .3]) out.glows.push([b.x - b.fz * b.w * s + b.fx * 1.4, b.y + b.h / 2 + .5, b.z + b.fx * b.w * s + b.fz * 1.4, 1, .95, .85, 1.6]);
  }
  if (adGeo.length) { const m = new THREE.Mesh(mergeGeos(adGeo), adMat); m.receiveShadow = true; G.add(m); }
  out.adMat = adMat;

  // ---- Meridian Square's screens: one canvas, redrawn a few times a second ----
  if (hx.screens.length) {
    const SW = 256, SH = 384, n = hx.screens.length;
    const c = document.createElement("canvas"); c.width = SW * n; c.height = SH;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const geos = hx.screens.map((s, i) => {
      const g = new THREE.PlaneGeometry(s.w, s.h), uv = g.attributes.uv.array, u0 = i / n, u1 = (i + 1) / n, v0 = s.ticker ? .9 : 0;
      uv.set([u0, 1, u1, 1, u0, v0, u1, v0]);
      g.rotateY(Math.atan2(s.fx, s.fz)); g.translate(s.x + s.fx * .32, s.y, s.z + s.fz * .32);
      steel.box(s.x, s.y - s.h / 2 - .4, s.z, s.fx ? .5 : s.w + .8, s.h + .8, s.fx ? s.w + .8 : .5, 0x111214);
      return g;
    });
    const m = new THREE.Mesh(mergeGeos(geos), mat); G.add(m);
    out.screens = { c, g: c.getContext("2d"), tex, mat, list: hx.screens, SW, SH, t: 0 };
  }

  // ---- fire escapes ----
  for (const e of hx.escapes) {
    const ex = e.nx ? e.d : e.w, ez = e.nx ? e.w : e.d;
    let flip = 1;
    for (let y = e.y0; y <= e.y1; y += 3.4) {
      thin.box(e.x, y - .06, e.z, ex, .1, ez, K.grate);
      // the rail on the outside edge, and the stair down to the landing below
      const ox = e.x + e.nx * e.d / 2, oz = e.z + e.nz * e.d / 2;
      thin.box(ox, y + .5, oz, e.nx ? .05 : e.w, 1, e.nx ? e.w : .05, K.grate);
      if (y > e.y0) {
        const ax = e.x - e.nz * (e.w / 2 - .5) * flip, az = e.z + e.nx * (e.w / 2 - .5) * flip;
        const bx = e.x + e.nz * (e.w / 2 - .5) * flip, bz = e.z - e.nx * (e.w / 2 - .5) * flip;
        thin.span(ax, y, az, bx, y - 3.4, bz, .08, .6, K.grate);
      }
      flip = -flip;
    }
  }

  solid.end(); steel.end(); thin.end(); pipes.end(); lattice.end(); cont.end(); deckTop.end(); deckSide.end(); deckSpan.end(); cableMat.end();
  return out;
}

// per frame: the river moves, the square's screens play, the night lights come on
export function updateHeroExtras(X, dt, T, nk, glows, lights, cam) {
  if (!X) return;
  X.water && (X.water.t.value += dt);
  if (X.adMat) X.adMat.emissiveIntensity = .05 + nk * .9;
  for (const m of X.signMats || []) m.emissiveIntensity = .3 + nk * 1.2;
  const S = X.screens;
  if (S && S.list && (S.t -= dt) <= 0) {
    S.t = 1 / 8;
    const g = S.g, n = S.list.length;
    for (let i = 0; i < n; i++) drawScreen(g, i * S.SW, 0, S.SW, S.SH, S.list[i], T);
    S.tex.needsUpdate = true;
  }
  for (const [x, y, z, r, gg, b, s] of X.glows) if ((x - cam.x) ** 2 + (z - cam.z) ** 2 < 300 * 300 && (nk > .2 || y < 0)) glows.add(x, y, z, r, gg, b, s);
  if (nk > .1 || true) for (const L of X.lights) {
    if ((L.x - cam.x) ** 2 + (L.z - cam.z) ** 2 > 90 * 90) continue;
    const P = L.P ||= { pos: new THREE.Vector3(L.x, L.y, L.z), dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, .9, .75), intensity: 5, range: L.r, cosOuter: Math.cos(1.3), cosInner: Math.cos(.6) };
    if (L.y < 0 || nk > .2) lights.push(P);
  }
  if (Math.floor(T * 1.1) % 2 === 0) for (const b of X.beacons || []) glows.add(b[0], b[1], b[2], 1, .06, .05, nk > .3 ? 4 : 2);
}
// a screen's picture: brand loops, a city news ticker, abstract light shows
function drawScreen(g, x, y, w, h, s, T) {
  g.save(); g.translate(x, y); g.beginPath(); g.rect(0, 0, w, h); g.clip();
  if (s.ticker) {
    g.fillStyle = "#050608"; g.fillRect(0, 0, w, h);
    const msg = "  BYTE NEWS 24 · ARCLINE SEEN OVER 9TH AVE · TRANSIT: WEST LINE ON TIME · MERIDIAN BANK +2.4% · STORM WARNING TONIGHT · DAILY MERIDIAN: HERO OR MENACE?  ";
    g.font = "700 30px 'Barlow Condensed', Arial"; g.fillStyle = "#ffd23b"; g.textBaseline = "middle";
    const tw = g.measureText(msg).width, off = (T * 60 + s.seed * 37) % tw;
    for (let k = -1; k < 3; k++) g.fillText(msg, k * tw - off, h * .95);
    g.restore(); return;
  }
  const mode = Math.floor((T / 7 + s.seed * .37)) % 3, a = ADS[(Math.floor(T / 7) + s.seed) % ADS.length];
  if (mode === 0) {
    adCanvas(a, g, 0, h * .25, w, h * .5);
    g.fillStyle = a.bg; g.globalAlpha = .5; g.fillRect(0, 0, w, h * .25); g.fillRect(0, h * .75, w, h * .25); g.globalAlpha = 1;
  } else if (mode === 1) {
    for (let i = 0; i < 12; i++) { g.fillStyle = `hsl(${(T * 40 + i * 30 + s.seed * 50) % 360},90%,${45 + 15 * Math.sin(T * 2 + i)}%)`; g.fillRect(0, (i / 12) * h, w, h / 12 + 1); }
    g.fillStyle = "#fff"; g.font = "italic 800 52px 'Barlow Condensed', Arial"; g.textAlign = "center"; g.fillText("MERIDIAN", w / 2, h * .48); g.font = "600 22px Barlow, Arial"; g.fillText("SQUARE", w / 2, h * .58); g.textAlign = "left";
  } else {
    g.fillStyle = "#0b0d12"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { const px = (Math.sin(i * 12.9 + T * .7) * .5 + .5) * w, py = ((i * 37 + T * 40) % h); g.fillStyle = `rgba(127,233,255,${.3 + .7 * ((i * 7) % 10) / 10})`; g.fillRect(px, py, 3, 14); }
    g.fillStyle = "#7fe9ff"; g.font = "italic 800 40px 'Barlow Condensed', Arial"; g.textAlign = "center"; g.fillText("ARCLINE", w / 2, h * .5); g.font = "600 16px Barlow, Arial"; g.fillStyle = "#fff"; g.fillText("CALL 911 · NOT THE HERO", w / 2, h * .58); g.textAlign = "left";
  }
  g.restore();
}
// a ship's hull: a box with a pointed bow
function shipHull(w, L, h) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -L / 2); s.lineTo(w / 2, -L / 2); s.lineTo(w / 2, L / 2 - 18); s.quadraticCurveTo(w / 2, L / 2 - 2, 0, L / 2 + 6); s.quadraticCurveTo(-w / 2, L / 2 - 2, -w / 2, L / 2 - 18); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); g.rotateY(Math.PI);
  return g;
}
function corrugated() {
  return canvas(64, 64, (g, w) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? "#e8e8e8" : "#ffffff"; g.fillRect(i * 4, 0, 4, w); } const t = g.getImageData(0, 0, 1, 1); void t; });
}
function mergeGeos(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2);
    for (const i of g.index.array) idx.push(i + o);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3)); out.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

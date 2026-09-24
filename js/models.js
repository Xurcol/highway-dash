// Real 3D car models. Drop a glTF binary at public/models/<car id>.glb (e.g. m4.glb) and that car
// uses it everywhere (garage, your car, friends' cars); cars without a model fall back to the
// procedural body. Optional per-car settings live in public/models/models.json.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { BODIES, CARS, DetailedCar, FINISHES, TINTS, STANCES } from "./cars.js?v=muew3v7x";
import { patchLit } from "./lights.js?v=muew3v7x";
import { contactShadow } from "./carmesh.js?v=muew3v7x";

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath("/vendor/three/examples/jsm/libs/draco/gltf/");
loader.setDRACOLoader(draco);

export const MODELS = {};
const re = (v, fallback) => new RegExp(Array.isArray(v) ? v.join("|") : v || fallback, "i");
const FRONT = { "+z": Math.PI, "-z": 0, "+x": Math.PI / 2, "-x": -Math.PI / 2 };

// Models load on demand (the garage car, your car, friends' cars) and only a few stay in memory:
// loading every car up front used enough memory to crash the tab.
let manifest = {};
const loading = new Map(), users = new Map(), recent = [];
const KEEP = 4;
export async function loadModels() {
  try { const r = await fetch("/models/models.json", { cache: "no-cache" }); if (r.ok) manifest = await r.json(); } catch { }
  return manifest.available || [];
}
export const hasModel = (id) => (manifest.available || []).includes(id);
// Car files are kept in the browser's Cache Storage after the first download, so a car never has to
// come over the network twice. Bumping "rev" in models.json invalidates the cache.
const cacheName = () => "hd-models-" + (manifest.rev || 1);
const modelUrl = (id) => `/models/${manifest[id]?.file || id + ".glb"}`;
const openCache = async () => { try { return await caches.open(cacheName()); } catch { return null; } };
export async function missingModels() {
  const c = await openCache();
  if (!c) return [];
  // drop caches from older model revisions
  try { for (const k of await caches.keys()) if (k.startsWith("hd-models-") && k !== cacheName()) caches.delete(k); } catch { }
  const out = [];
  for (const id of manifest.available || []) if (!(await c.match(modelUrl(id)))) out.push(id);
  return out;
}
// download with byte-level progress: onProgress(doneBytes, totalBytes, filesDone, filesTotal)
export async function downloadModels(ids, onProgress) {
  const c = await openCache();
  if (!c) return;
  let done = 0, total = 0, files = 0;
  const heads = await Promise.all(ids.map(async (id) => { try { const r = await fetch(modelUrl(id), { method: "HEAD", cache: "no-cache" }); return +r.headers.get("content-length") || 8e6; } catch { return 8e6; } }));
  total = heads.reduce((a, b) => a + b, 0);
  for (const id of ids) {
    try {
      const res = await fetch(modelUrl(id), { cache: "no-cache" });
      if (!res.ok || !res.body) continue;
      const reader = res.body.getReader(), parts = [];
      for (;;) { const { done: end, value } = await reader.read(); if (end) break; parts.push(value); done += value.length; onProgress(done, total, files, ids.length); }
      await c.put(modelUrl(id), new Response(new Blob(parts), { headers: { "Content-Type": "model/gltf-binary" } }));
    } catch (e) { console.warn("download failed", id, e); }
    files++;
    onProgress(done, total, files, ids.length);
  }
}
async function modelBytes(id) {
  const c = await openCache(), url = modelUrl(id);
  let res = c && (await c.match(url));
  if (!res) { res = await fetch(url, { cache: "no-cache" }); if (c && res.ok) c.put(url, res.clone()).catch(() => {}); }
  return res.arrayBuffer();
}
export function ensureModel(id) {
  if (MODELS[id]) { touch(id); return Promise.resolve(true); }
  if (!hasModel(id)) return Promise.resolve(false);
  if (!loading.has(id)) {
    const car = CARS.find((c) => c.id === id), cfg = manifest[id] || {};
    loading.set(id, modelBytes(id).then((buf) => loader.parseAsync(buf, "/models/"))
      .then((gltf) => { MODELS[id] = prepare(gltf.scene, car, cfg); touch(id); evict(); return true; })
      .catch((e) => { console.warn(`Model for ${id} failed to load`, e); return false; })
      .finally(() => loading.delete(id)));
  }
  return loading.get(id);
}
function touch(id) { const i = recent.indexOf(id); if (i >= 0) recent.splice(i, 1); recent.push(id); }
function evict() {
  while (recent.length > KEEP) {
    const id = recent.find((x) => !(users.get(x) > 0));
    if (!id) break;
    recent.splice(recent.indexOf(id), 1);
    MODELS[id].root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap"]) m[k]?.dispose(); m.dispose(); }
    });
    delete MODELS[id];
  }
}

let cfgPolygonOffset = false;
function upgrade(m, cache) {
  const role = m.userData.role;
  if (role !== "paint" && role !== "glass") return m;
  if (cache.has(m)) return cache.get(m);
  const n = role === "paint"
    ? new THREE.MeshPhysicalMaterial({ color: m.color?.clone() || new THREE.Color(0xffffff), map: m.map || null, normalMap: m.normalMap || null, metalness: .55, roughness: .3, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1.4, sheenColor: new THREE.Color(0xffffff), sheenRoughness: .35 })
    : new THREE.MeshPhysicalMaterial({ color: 0x080b10, metalness: .3, roughness: .03, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.2, transparent: true, opacity: .9 });
  n.name = m.name; n.userData.role = role; n.side = m.side;
  if (m.vertexColors) n.vertexColors = true;   // models that bake their colour into COLOR_0
  // A model built from overlapping shells puts its paint at the same depth as the layer beneath,
  // which z-fights into black speckles along every crease. Nudging the paint forward in depth
  // settles it without moving a single vertex.
  if (role === "paint" && cfgPolygonOffset) { n.polygonOffset = true; n.polygonOffsetFactor = -2; n.polygonOffsetUnits = -4; }
  patchLit(n);
  cache.set(m, n);
  return n;
}
// Fuse meshes that share one material into a single mesh, baking each one's transform into the
// space of `space` (an ancestor). Some downloaded models are thousands of tiny nodes (a rim alone can be
// hundreds of pieces); every node is a separate draw call, which is what made those cars lag.
const MERGE_ATTRS = ["position", "normal", "uv"];
function fuseMeshes(meshes, space) {
  space.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(space.matrixWorld).invert(), m = new THREE.Matrix4(), nm = new THREE.Matrix3();
  let verts = 0;
  const geos = meshes.map((o) => { const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry; verts += g.attributes.position.count; return g; });
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
  const v = new THREE.Vector3();
  let w = 0;
  meshes.forEach((o, i) => {
    const g = geos[i], p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    o.updateWorldMatrix(true, false);
    m.multiplyMatrices(inv, o.matrixWorld); nm.getNormalMatrix(m);
    for (let k = 0; k < p.count; k++, w++) {
      v.fromBufferAttribute(p, k).applyMatrix4(m); pos[w * 3] = v.x; pos[w * 3 + 1] = v.y; pos[w * 3 + 2] = v.z;
      if (n) { v.fromBufferAttribute(n, k).applyMatrix3(nm).normalize(); nor[w * 3] = v.x; nor[w * 3 + 1] = v.y; nor[w * 3 + 2] = v.z; }
      if (t) { uv[w * 2] = t.getX(k); uv[w * 2 + 1] = t.getY(k); }
    }
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(out, meshes[0].material);
  mesh.castShadow = meshes[0].castShadow; mesh.receiveShadow = meshes[0].receiveShadow;
  return mesh;
}
// group meshes by material and fuse each group of 2+ into one mesh under `space`
function fuseByMaterial(list, space, flags = {}) {
  const groups = new Map();
  for (const o of list) { if (!groups.has(o.material)) groups.set(o.material, []); groups.get(o.material).push(o); }
  const out = [];
  for (const g of groups.values()) {
    if (g.length < 2) { out.push(g[0]); continue; }
    const f = fuseMeshes(g, space);
    Object.assign(f.userData, flags);
    for (const o of g) { o.parent?.remove(o); o.geometry.dispose(); }
    space.add(f);
    out.push(f);
  }
  return out;
}
// Cut one mesh into pieces by where each triangle sits (world-space centroid -> bucket index).
// Returns [{ mesh, bucket }]; a mesh whose triangles all land in one bucket is returned untouched.
function splitMesh(o, classify) {
  const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, pos = g.attributes.position;
  o.updateWorldMatrix(true, false);
  const tris = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < pos.count / 3; t++) {
    a.fromBufferAttribute(pos, t * 3).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, t * 3 + 1).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, t * 3 + 2).applyMatrix4(o.matrixWorld);
    const k = classify(a.add(b).add(c).multiplyScalar(1 / 3));
    if (!tris.has(k)) tris.set(k, []);
    tris.get(k).push(t);
  }
  if (tris.size <= 1) return [{ mesh: o, bucket: tris.size ? [...tris.keys()][0] : 0 }];
  const out = [];
  for (const [bucket, list] of tris) {
    const ng = new THREE.BufferGeometry();
    for (const [name, at] of Object.entries(g.attributes)) {
      const arr = new at.array.constructor(list.length * 3 * at.itemSize);
      let w = 0;
      for (const t of list) for (let v = 0; v < 3; v++) for (let i = 0; i < at.itemSize; i++) arr[w++] = [at.getX, at.getY, at.getZ, at.getW][i].call(at, t * 3 + v);
      ng.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize, at.normalized));
    }
    const m = new THREE.Mesh(ng, o.material);
    m.name = o.name; m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
    m.userData = { ...o.userData }; m.castShadow = o.castShadow; m.receiveShadow = o.receiveShadow; m.visible = o.visible;
    out.push({ mesh: m, bucket });
  }
  const parent = o.parent;
  for (const p of out) parent.add(p.mesh);
  parent.remove(o);
  o.geometry.dispose();
  return out;
}
// normalise orientation (front toward -z), real-world length, grounding, and tag paint/lights/wheels
function prepare(scene, car, cfg) {
  const inner = new THREE.Group();
  inner.add(scene);
  scene.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3());
  const front = cfg.front || (size.x > size.z ? "+x" : "+z");
  inner.rotation.y = FRONT[front] ?? Math.PI;
  inner.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner); size = box.getSize(new THREE.Vector3());
  const k = (cfg.length || BODIES[car.body].L) / size.z;
  inner.scale.setScalar(k);
  inner.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner);
  const c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y + (cfg.yOffset || 0), -c.z);
  inner.updateMatrixWorld(true);
  const carH = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3()).y;
  const lens = new Map();

  const paintRe = re(cfg.paint, "paint|carpaint|body|exterior|coat|shell");
  const notPaint = /glass|window|tyre|tire|rim|wheel|light|lamp|chrome|interior|seat|black|rubber|plastic|brake|caliper|grille|mirror_glass|plate|carbon/i;
  // lights glow, so they are only ever the materials named in the car config - a guess here would
  // light up whatever shares a texture sheet with the lamps (windows, mirrors, trim)
  const tailRe = cfg.tail ? re(cfg.tail) : null;
  const headRe = cfg.head ? re(cfg.head) : null;
  const wheelRe = re(cfg.wheels, "wheel|tyre|tire|rim");
  const glassRe = re(cfg.glass, "glass|window|windscreen|windshield");
  const rimRe = re(cfg.rim, "rim|jante|alloy");
  const caliperRe = re(cfg.caliper, "caliper|frein|brake(?!.?light)");
  const hideRe = cfg.hide ? re(cfg.hide) : null;
  // Some downloads ship trim in the wrong colour - a white mirror where the car has gloss black
  // Shadowline, say. "tint" recolours named materials in place: { "<name regex>": "#16181c" } or
  // { "<name regex>": { color, metalness, roughness } }. It runs before roles are assigned, so a
  // tinted material can still be picked up as paint, glass, a rim and so on.
  cfgPolygonOffset = !!cfg.depthFix;
  // Some exports mark every material double-sided. On a car body - a closed shell, often with an
  // inner skin right behind the outer one - that renders the back faces too, and the two sets land
  // on the same depth and fight, which is what speckles the panels. A closed body only ever needs
  // its front faces; glass is left alone so you can still see through it from inside.
  const singleSide = !!cfg.singleSide;
  const autoDark = !!cfg.autoDark;
  const tints = Object.entries(cfg.tint || {}).map(([k, v]) => [new RegExp(k, "i"), typeof v === "string" ? { color: v } : v]);
  const wheelMatRe = cfg.wheelMats ? re(cfg.wheelMats) : null;
  const upgraded = new Map();
  inner.traverse((o) => {
    if (wheelRe.test(o.name) && !(o.parent && o.parent.userData.wheel)) o.userData.wheel = true;
    if (!o.isMesh) return;
    // cars cast shadows but don't receive their own: self-shadowing on glossy paint shows up as stripes
    o.castShadow = true; o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      // with an explicit config, match material names only (node names are unreliable)
      const name = cfg.paint ? (m.name || "") : `${m.name} ${o.name}`;
      if (singleSide && m.side === THREE.DoubleSide && !glassRe.test(m.name || "")) m.side = THREE.FrontSide;
      if (tints.length && !m.userData.tinted) {
        for (const [rx, t] of tints) if (rx.test(m.name || "")) {
          m.userData.tinted = true;
          if (t.color != null) m.color?.set(t.color);
          if (t.metalness != null) m.metalness = t.metalness;
          if (t.roughness != null) m.roughness = t.roughness;
          if (t.opacity != null) { m.opacity = t.opacity; m.transparent = t.opacity < 1; }
          break;
        }
      }
      if (m.isMeshStandardMaterial) patchLit(m);
      if (paintRe.test(name) && (cfg.paint || !notPaint.test(name))) m.userData.role = "paint";
      else if (tailRe?.test(name)) m.userData.role = "tail";
      else if (headRe?.test(name)) m.userData.role = "head";
      else if (glassRe.test(name) && !/light|lamp|signal/i.test(name)) m.userData.role = "glass";
      else if (rimRe.test(name)) m.userData.role = "rim";
      else if (caliperRe.test(name)) m.userData.role = "caliper";
      // Brightwork the model never described. A lot of these downloads ship their grilles, vents and
      // carbon panels as a bare near-white material with no texture behind it, which renders as
      // white chrome - hence grilles and "carbon" parts coming out pale. Anything left without a
      // role, without a texture and near white is that, so it goes gloss black.
      if (autoDark && !m.userData.role && !m.map && !m.userData.tinted && m.color) {
        const lum = m.color.r * .3 + m.color.g * .59 + m.color.b * .11;
        if (lum > .5 && !m.transparent) {
          m.color.setHex(0x17191d);
          if (m.metalness != null) m.metalness = Math.min(.85, (m.metalness || 0) + .25);
          if (m.roughness != null) m.roughness = .32;
          m.userData.tinted = true;
        }
      }
    }
    if (hideRe && mats.some((m) => hideRe.test(`${m.name} ${o.name}`))) o.visible = false;
    // wheel parts identified by material: each becomes its own spinning piece
    if (wheelMatRe && mats.some((m) => wheelMatRe.test(m.name || "")) && !(o.parent && o.parent.userData.wheel)) o.userData.wheel = true;
    // swap paint and glass for proper car-paint / glass materials, keeping any texture maps
    o.material = Array.isArray(o.material) ? o.material.map((m) => upgrade(m, upgraded)) : upgrade(o.material, upgraded);
    // glass that sits entirely below the beltline is a lamp lens, not a window: keep it clear and
    // out of the tint so headlights and taillights never get tinted
    if (!Array.isArray(o.material) && o.material.userData.role === "glass" && new THREE.Box3().setFromObject(o).max.y < carH * .6) {
      const g = o.material;
      if (!lens.has(g)) { const l = new THREE.MeshPhysicalMaterial({ color: 0x20242c, metalness: .1, roughness: .02, clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: .42, envMapIntensity: 2.4 }); l.name = g.name + "_lens"; l.userData.role = "lens"; patchLit(l); lens.set(g, l); }
      o.material = lens.get(g);
    }
  });
  // wheels welded into one mesh (a whole axle, or all four) can't spin or lower: cut them into one mesh per wheel
  const Wd = BODIES[car.body].W, carL = new THREE.Box3().setFromObject(inner).getSize(new THREE.Vector3()).z;
  const merged = [];
  inner.updateMatrixWorld(true);
  // a wheel's centre is one tyre-radius off the ground; anything flagged higher up is body, not wheel
  inner.traverse((o) => { if (o.isMesh && o.userData.wheel && new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).y > carH * .4) o.userData.wheel = false; });
  inner.traverse((o) => { if (o.isMesh && o.userData.wheel && !Array.isArray(o.material)) merged.push(o); });
  for (const o of merged) {
    const bx = new THREE.Box3().setFromObject(o), sz = bx.getSize(new THREE.Vector3()), ce = bx.getCenter(new THREE.Vector3());
    const wide = sz.x > Wd * .45, long = sz.z > 1.1;
    if (sz.y > 1.1 || (!wide && !long)) continue;
    for (const p of splitMesh(o, (v) => (wide ? (v.x > ce.x ? 1 : 0) : 0) + (long ? (v.z > ce.z ? 2 : 0) : 0))) p.mesh.userData.wheel = true;
  }
  // a window and a headlight/taillight are often one glass mesh: cut the lamp end off so tint only touches the windows
  const glassMeshes = [];
  inner.traverse((o) => { if (o.isMesh && !Array.isArray(o.material) && o.material.userData.role === "glass") glassMeshes.push(o); });
  for (const o of glassMeshes) {
    const g = o.material;
    if (!lens.has(g)) { const l = new THREE.MeshPhysicalMaterial({ color: 0x20242c, metalness: .1, roughness: .02, clearcoat: 1, clearcoatRoughness: 0, transparent: true, opacity: .42, envMapIntensity: 2.4 }); l.name = g.name + "_lens"; l.userData.role = "lens"; patchLit(l); lens.set(g, l); }
    for (const p of splitMesh(o, (v) => (Math.abs(v.z) > carL / 2 - .8 && v.y < carH * .72 ? 1 : 0))) if (p.bucket === 1) p.mesh.material = lens.get(g);
  }
  // ---- draw-call diet ----
  inner.updateMatrixWorld(true);
  const inWheel = (o) => { for (let p = o; p; p = p.parent) if (p.userData.wheel) return true; return false; };
  const simple = (o) => o.isMesh && !Array.isArray(o.material) && o.geometry.attributes.position && !o.isSkinnedMesh && o.visible;
  // 1. wheel parts: gather each physical wheel's pieces and fuse them per material
  const wheelMeshes = [];
  inner.traverse((o) => { if (simple(o) && o.userData.wheel) wheelMeshes.push(o); });
  if (wheelMeshes.length > 12) {
    const clusters = [];
    for (const o of wheelMeshes) {
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      const g = clusters.find((q) => Math.hypot(q.c.x - c.x, q.c.z - c.z) < .4 && Math.abs(q.c.y - c.y) < .4);
      if (g) g.list.push(o); else clusters.push({ c, list: [o] });
    }
    for (const g of clusters) fuseByMaterial(g.list, inner, { wheel: true });
  }
  // 1b. some exports flag a whole wheel as one group node whose hundreds of spoke and tyre pieces are
  // plain children (so none of them is flagged itself): fuse each such group's pieces per material
  const wheelGroups = [];
  inner.traverse((o) => { if (!o.isMesh && o.userData.wheel) wheelGroups.push(o); });
  for (const g of wheelGroups) {
    const pieces = [];
    g.traverse((o) => { if (simple(o)) pieces.push(o); });
    if (pieces.length > 6) fuseByMaterial(pieces, g);
  }
  // 2. everything else that never moves: one mesh per material
  const still = [];
  inner.traverse((o) => { if (simple(o) && !inWheel(o)) still.push(o); });
  if (still.length > 40) fuseByMaterial(still, inner);
  const root = new THREE.Group();
  root.add(inner);
  // sharper textures at glancing angles (paint decals, tyre sidewalls, badges)
  root.traverse((o) => { if (!o.isMesh) return; for (const mt of Array.isArray(o.material) ? o.material : [o.material]) for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"]) if (mt[k]) mt[k].anisotropy = 8; });
  return { root, cfg };
}

export class ModelCar {
  constructor(carId, color) {
    const tpl = MODELS[carId], def = CARS.find((c) => c.id === carId);
    this.carId = carId; users.set(carId, (users.get(carId) || 0) + 1); this.isModel = true;
    this.B = BODIES[def.body];
    this.group = new THREE.Group();
    this.bodyGroup = tpl.root.clone(true);
    this.group.add(this.bodyGroup, contactShadow(this.B.L, this.B.W));
    this.paint = []; this.tails = []; this.heads = []; this.glass = []; this.rims = []; this.calipers = []; this.lenses = [];
    const cloned = new Map();
    this.bodyGroup.traverse((o) => {
      if (!o.isMesh) return;
      const own = (m) => {
        if (!m.userData.role) return m;
        if (!cloned.has(m)) { const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; cloned.set(m, c); }
        const c = cloned.get(m);
        const list = { paint: this.paint, tail: this.tails, head: this.heads, glass: this.glass, rim: this.rims, caliper: this.calipers, lens: this.lenses }[m.userData.role];
        if (!list.includes(c)) list.push(c);
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    });
    // wheels: re-pivot each wheel node around its own centre so it can spin and steer
    this.wheels = [];
    const wheelNodes = [];
    this.bodyGroup.traverse((o) => { if (o.userData.wheel) wheelNodes.push(o); });
    this.bodyGroup.updateMatrixWorld(true);
    // one spin/steer pivot per physical wheel: rims, tyres and brakes that are separate nodes (or dozens of spoke
    // pieces) are grouped by where they sit so they turn together
    const parts = [];
    for (const w of wheelNodes) {
      const box = new THREE.Box3().setFromObject(w);
      if (box.isEmpty()) continue;
      // a "wheel" that spans the car is really all four wheels merged together - it can't spin on its own
      const sz = box.getSize(new THREE.Vector3());
      if (sz.x > this.B.W * .45 || sz.z > 1.1 || sz.y > 1.1) continue;
      parts.push({ w, box, c: box.getCenter(new THREE.Vector3()) });
    }
    const clusters = [];
    for (const p of parts) {
      const g = clusters.find((q) => Math.hypot(q.c.x - p.c.x, q.c.z - p.c.z) < .4 && Math.abs(q.c.y - p.c.y) < .4);
      const dia = p.box.getSize(new THREE.Vector3()); p.dia = Math.max(dia.y, dia.z);
      if (g) { g.list.push(p); g.box.union(p.box); if (p.dia > g.dia) { g.dia = p.dia; g.c = p.c.clone(); } } else clusters.push({ list: [p], box: p.box.clone(), c: p.c.clone(), dia: p.dia });
    }
    for (const g of clusters) {
      const centre = g.c;
      const steer = new THREE.Group(), spin = new THREE.Group();
      this.group.add(steer); steer.add(spin);
      steer.position.copy(centre);
      steer.updateMatrixWorld(true);
      for (const p of g.list) spin.attach(p.w);
      this.wheels.push({ w: spin, front: centre.z < 0, holder: steer, side: Math.sign(centre.x) || 1, baseX: centre.x, baseY: centre.y });
    }
    // some files ship with the front wheels already turned: measure each wheel's real yaw and cancel it
    if (tpl.cfg?.alignWheels) {
      // tyre, rim and brake are separate nodes: group the ones sharing a wheel and turn them together about one pivot
      const groups = [];
      for (const wh of this.wheels) {
        const g = groups.find((q) => Math.hypot(q.c.x - wh.holder.position.x, q.c.z - wh.holder.position.z) < .3);
        if (g) g.list.push(wh); else groups.push({ c: wh.holder.position.clone(), list: [wh] });
      }
      for (const g of groups) {
        const pts = [];
        for (const wh of g.list) wh.w.traverse((o) => { if (!o.isMesh) return; const p = o.geometry.attributes.position, step = Math.max(1, Math.floor(p.count / 300)); o.updateWorldMatrix(true, false); for (let i = 0; i < p.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld)); });
        const P = g.c;
        let best = 0, bw = 1e9;
        for (let a = -45; a <= 45; a += .5) {
          const c = Math.cos(a * Math.PI / 180), sn = Math.sin(a * Math.PI / 180); let lo = 1e9, hi = -1e9;
          for (const q of pts) { const x = (q.x - P.x) * c + (q.z - P.z) * sn; if (x < lo) lo = x; if (x > hi) hi = x; }
          if (hi - lo < bw) { bw = hi - lo; best = a; }
        }
        const r = best * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
        for (const wh of g.list) {
          const dx = wh.holder.position.x - P.x, dz = wh.holder.position.z - P.z;
          wh.holder.position.x = P.x + dx * c + dz * sn; wh.holder.position.z = P.z - dx * sn + dz * c;
          wh.baseX = wh.holder.position.x; wh.base = r; wh.holder.rotation.y = r;
        }
      }
    }
    this.rimBase = this.rims.map((m) => m.color.clone());
    this.calBase = this.calipers.map((m) => m.color.clone());
    // underglow pool, same as the built-in cars
    const ug = document.createElement("canvas"); ug.width = ug.height = 64;
    const gg = ug.getContext("2d"), rg = gg.createRadialGradient(32, 32, 4, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,255,255,1)"); rg.addColorStop(1, "rgba(255,255,255,0)"); gg.fillStyle = rg; gg.fillRect(0, 0, 64, 64);
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(this.B.W * 1.9, this.B.L * 1.25).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(ug), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    this.glow.position.y = .03; this.glow.visible = false; this.group.add(this.glow);
    this.spin = 0;
    if (color !== undefined) this.setColor(color);
  }
  setColor(c) { for (const m of this.paint) m.color.set(c); }
  // same styling as the built-in cars: finish, wheel/caliper colour, tint, fitment, underglow, DRLs
  applyStyle(st = {}) {
    const f = FINISHES[st.finish] || FINISHES.gloss;
    for (const m of this.paint) { m.metalness = f.metalness; m.roughness = f.roughness; m.clearcoat = f.clearcoat; m.clearcoatRoughness = f.clearcoatRoughness; m.sheen = f.sheen; m.needsUpdate = true; }
    this.rims.forEach((m, i) => m.color.copy(st.rim != null ? new THREE.Color(st.rim) : this.rimBase[i]));
    this.calipers.forEach((m, i) => m.color.copy(st.caliper != null ? new THREE.Color(st.caliper) : this.calBase[i]));
    const t = TINTS[st.tint] || TINTS.dark;
    for (const m of this.glass) { m.color.set(t.c); m.opacity = t.o; m.transparent = t.o < 1; }
    // lamp lenses stay clear unless "tint lights" is on; the DRL glow still shows through either way
    for (const m of this.lenses) { if (st.lightTint) { m.color.set(t.c); m.opacity = Math.min(.9, Math.max(.22, t.o)); } else { m.color.set(0xffffff); m.opacity = .22; } }
    // lowering sinks the body over the wheels, so it only works when the wheels are separate parts
    const drop = this.wheels.length >= 4 ? (st.drop != null ? st.drop : (STANCES[st.stance] || STANCES.stock).drop) : 0;
    this.bodyGroup.position.y = -drop;
    const off = st.offset || 0, cam = (st.camber || 0) * Math.PI / 180, ws = st.wsize || 1;
    for (const w of this.wheels) {
      w.holder.position.x = w.baseX + w.side * off;
      w.holder.position.y = w.baseY * ws;
      w.holder.rotation.z = -w.side * cam;
      w.w.scale.setScalar(ws);
    }
    this.glow.visible = st.glow != null;
    if (st.glow != null) { this.glow.material.color.set(st.glow); this.glow.material.opacity = .9; }
  }
  setLights(brake, left, right, night) {
    for (const m of this.tails) if (m.emissive) { m.emissive.setRGB(1, .05, .05); m.emissiveIntensity = brake ? 3 : .6 + night; }
    // headlamps: a soft glow by day, properly lit once it is dark
    for (const m of this.heads) if (m.emissive) { m.emissive.setRGB(1, .97, .9); m.emissiveIntensity = .6 + night * 2; }
  }
  update(dist, steer) {
    this.spin -= dist / this.B.r;
    for (const { w, front, base } of this.wheels) {
      w.rotation.x = this.spin;
      w.parent.rotation.y = (base || 0) + (front ? -steer * .35 : 0);
    }
  }
  dispose() {
    for (const m of [...this.paint, ...this.tails, ...this.heads, ...this.glass, ...this.lenses, ...this.rims, ...this.calipers]) m.dispose();
    users.set(this.carId, Math.max(0, (users.get(this.carId) || 1) - 1));
  }
}

export function makeCar(carId, color) {
  if (MODELS[carId]) return new ModelCar(carId, color);
  const def = CARS.find((c) => c.id === carId) || CARS[0];
  const old = new DetailedCar(def.body, color);
  // cars that have a real model never show the old built-in shape: hidden until the model swaps in
  if (hasModel(carId)) old.group.traverse((o) => { if (o.isMesh) o.visible = false; });
  return old;
}

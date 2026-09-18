// Real 3D car models. Drop a glTF binary at public/models/<car id>.glb (e.g. m4.glb) and that car
// uses it everywhere (garage, your car, friends' cars); cars without a model fall back to the
// procedural body. Optional per-car settings live in public/models/models.json.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { BODIES, CARS, DetailedCar, FINISHES, TINTS, STANCES } from "./cars.js";
import { patchLit } from "./lights.js";
import { contactShadow } from "./carmesh.js";

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
  const heads = await Promise.all(ids.map(async (id) => { try { const r = await fetch(modelUrl(id), { method: "HEAD" }); return +r.headers.get("content-length") || 8e6; } catch { return 8e6; } }));
  total = heads.reduce((a, b) => a + b, 0);
  for (const id of ids) {
    try {
      const res = await fetch(modelUrl(id));
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
  if (!res) { res = await fetch(url); if (c && res.ok) c.put(url, res.clone()).catch(() => {}); }
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

function upgrade(m, cache) {
  const role = m.userData.role;
  if (role !== "paint" && role !== "glass") return m;
  if (cache.has(m)) return cache.get(m);
  const n = role === "paint"
    ? new THREE.MeshPhysicalMaterial({ color: m.color?.clone() || new THREE.Color(0xffffff), map: m.map || null, normalMap: m.normalMap || null, metalness: .55, roughness: .3, clearcoat: 1, clearcoatRoughness: .04, envMapIntensity: 1.4, sheenColor: new THREE.Color(0xffffff), sheenRoughness: .35 })
    : new THREE.MeshPhysicalMaterial({ color: 0x080b10, metalness: .3, roughness: .03, clearcoat: 1, clearcoatRoughness: 0, envMapIntensity: 2.2, transparent: true, opacity: .9 });
  n.name = m.name; n.userData.role = role; n.side = m.side;
  patchLit(n);
  cache.set(m, n);
  return n;
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
      if (m.isMeshStandardMaterial) patchLit(m);
      if (paintRe.test(name) && (cfg.paint || !notPaint.test(name))) m.userData.role = "paint";
      else if (tailRe?.test(name)) m.userData.role = "tail";
      else if (headRe?.test(name)) m.userData.role = "head";
      else if (glassRe.test(name) && !/light|lamp|signal/i.test(name)) m.userData.role = "glass";
      else if (rimRe.test(name)) m.userData.role = "rim";
      else if (caliperRe.test(name)) m.userData.role = "caliper";
    }
    if (hideRe && mats.some((m) => hideRe.test(`${m.name} ${o.name}`))) o.visible = false;
    // wheel parts identified by material: each becomes its own spinning piece
    if (wheelMatRe && mats.some((m) => wheelMatRe.test(m.name || "")) && !(o.parent && o.parent.userData.wheel)) o.userData.wheel = true;
    // swap paint and glass for proper car-paint / glass materials, keeping any texture maps
    o.material = Array.isArray(o.material) ? o.material.map((m) => upgrade(m, upgraded)) : upgrade(o.material, upgraded);
  });
  const root = new THREE.Group();
  root.add(inner);
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
    this.paint = []; this.tails = []; this.heads = []; this.glass = []; this.rims = []; this.calipers = [];
    const cloned = new Map();
    this.bodyGroup.traverse((o) => {
      if (!o.isMesh) return;
      const own = (m) => {
        if (!m.userData.role) return m;
        if (!cloned.has(m)) { const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; cloned.set(m, c); }
        const c = cloned.get(m);
        const list = { paint: this.paint, tail: this.tails, head: this.heads, glass: this.glass, rim: this.rims, caliper: this.calipers }[m.userData.role];
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
    for (const w of wheelNodes) {
      const box = new THREE.Box3().setFromObject(w);
      if (box.isEmpty()) continue;
      // a "wheel" that spans the car is really all four wheels merged together - it can't spin on its own
      const sz = box.getSize(new THREE.Vector3());
      if (sz.x > this.B.W * .45 || sz.z > 1.1 || sz.y > 1.1) continue;
      const centre = box.getCenter(new THREE.Vector3());
      const steer = new THREE.Group(), spin = new THREE.Group();
      this.group.add(steer); steer.add(spin);
      steer.position.copy(centre);
      steer.updateMatrixWorld(true);
      spin.attach(w);
      this.wheels.push({ w: spin, front: centre.z < 0, holder: steer, side: Math.sign(centre.x) || 1, baseX: centre.x, baseY: centre.y });
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
    this.drl = st.drl != null ? new THREE.Color(st.drl) : null;
  }
  setLights(brake, left, right, night) {
    for (const m of this.tails) if (m.emissive) { m.emissive.setRGB(1, .05, .05); m.emissiveIntensity = brake ? 3 : .6 + night; }
    for (const m of this.heads) if (m.emissive) { if (this.drl) m.emissive.copy(this.drl); else m.emissive.setRGB(1, .97, .9); m.emissiveIntensity = (this.drl ? 1.4 : .6) + night * 2; }
  }
  update(dist, steer) {
    this.spin -= dist / this.B.r;
    for (const { w, front } of this.wheels) {
      w.rotation.x = this.spin;
      w.parent.rotation.y = front ? -steer * .35 : 0;
    }
  }
  dispose() {
    for (const m of [...this.paint, ...this.tails, ...this.heads, ...this.glass, ...this.rims, ...this.calipers]) m.dispose();
    users.set(this.carId, Math.max(0, (users.get(this.carId) || 1) - 1));
  }
}

export function makeCar(carId, color) {
  if (MODELS[carId]) return new ModelCar(carId, color);
  const def = CARS.find((c) => c.id === carId) || CARS[0];
  return new DetailedCar(def.body, color);
}

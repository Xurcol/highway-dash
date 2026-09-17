// Real 3D car models. Drop a glTF binary at public/models/<car id>.glb (e.g. m4.glb) and that car
// uses it everywhere (garage, your car, friends' cars); cars without a model fall back to the
// procedural body. Optional per-car settings live in public/models/models.json.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { BODIES, CARS, DetailedCar } from "./cars.js";
import { patchLit } from "./lights.js";
import { contactShadow } from "./carmesh.js";

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath("/vendor/three/examples/jsm/libs/draco/gltf/");
loader.setDRACOLoader(draco);

export const MODELS = {};
const re = (v, fallback) => new RegExp(Array.isArray(v) ? v.join("|") : v || fallback, "i");
const FRONT = { "+z": Math.PI, "-z": 0, "+x": Math.PI / 2, "-x": -Math.PI / 2 };

export async function loadModels() {
  let manifest = {};
  try { const r = await fetch("/models/models.json", { cache: "no-cache" }); if (r.ok) manifest = await r.json(); } catch { }
  const ids = manifest.available || [];
  await Promise.all(CARS.filter((car) => ids.includes(car.id)).map(async (car) => {
    const cfg = manifest[car.id] || {};
    const url = `/models/${cfg.file || car.id + ".glb"}`;
    try {
      const gltf = await loader.loadAsync(url);
      MODELS[car.id] = prepare(gltf.scene, car, cfg);
    } catch (e) { console.warn(`Model for ${car.id} failed to load`, e); }
  }));
  return Object.keys(MODELS);
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
  const tailRe = re(cfg.tail, "tail|brake.?light|rear.?(lamp|light)|stop.?lamp");
  const headRe = re(cfg.head, "head.?(lamp|light)|front.?(lamp|light)|drl");
  const wheelRe = re(cfg.wheels, "wheel|tyre|tire|rim");
  inner.traverse((o) => {
    if (wheelRe.test(o.name) && !(o.parent && o.parent.userData.wheel)) o.userData.wheel = true;
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const name = `${m.name} ${o.name}`;
      if (m.isMeshStandardMaterial) patchLit(m);
      if (paintRe.test(name) && !notPaint.test(name)) m.userData.role = "paint";
      else if (tailRe.test(name)) m.userData.role = "tail";
      else if (headRe.test(name)) m.userData.role = "head";
    }
  });
  const root = new THREE.Group();
  root.add(inner);
  return { root, cfg };
}

export class ModelCar {
  constructor(carId, color) {
    const tpl = MODELS[carId], def = CARS.find((c) => c.id === carId);
    this.B = BODIES[def.body];
    this.group = new THREE.Group();
    this.bodyGroup = tpl.root.clone(true);
    this.group.add(this.bodyGroup, contactShadow(this.B.L, this.B.W));
    this.paint = []; this.tails = []; this.heads = [];
    const cloned = new Map();
    this.bodyGroup.traverse((o) => {
      if (!o.isMesh) return;
      const own = (m) => {
        if (!m.userData.role) return m;
        if (!cloned.has(m)) { const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; cloned.set(m, c); }
        const c = cloned.get(m);
        ({ paint: this.paint, tail: this.tails, head: this.heads })[m.userData.role].includes(c) || ({ paint: this.paint, tail: this.tails, head: this.heads })[m.userData.role].push(c);
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
      const centre = box.getCenter(new THREE.Vector3());
      const steer = new THREE.Group(), spin = new THREE.Group();
      this.group.add(steer); steer.add(spin);
      steer.position.copy(centre);
      steer.updateMatrixWorld(true);
      spin.attach(w);
      this.wheels.push({ w: spin, front: centre.z < 0 });
    }
    this.spin = 0;
    if (color !== undefined) this.setColor(color);
  }
  setColor(c) { for (const m of this.paint) m.color.set(c); }
  setLights(brake, left, right, night) {
    for (const m of this.tails) if (m.emissive) { m.emissive.setRGB(1, .05, .05); m.emissiveIntensity = brake ? 3 : .6 + night; }
    for (const m of this.heads) if (m.emissive) { m.emissive.setRGB(1, .97, .9); m.emissiveIntensity = .6 + night * 2; }
  }
  update(dist, steer) {
    this.spin -= dist / this.B.r;
    for (const { w, front } of this.wheels) {
      w.rotation.x = this.spin;
      w.parent.rotation.y = front ? -steer * .35 : 0;
    }
  }
  dispose() { for (const m of [...this.paint, ...this.tails, ...this.heads]) m.dispose(); }
}

export function makeCar(carId, color) {
  if (MODELS[carId]) return new ModelCar(carId, color);
  const def = CARS.find((c) => c.id === carId) || CARS[0];
  return new DetailedCar(def.body, color);
}

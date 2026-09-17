// Standalone car viewer for inspecting models: /viewer.html?car=m4&yaw=0.7&pitch=0.15&dist=1
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CARS, BODIES } from "./cars.js";
import { loadModels, makeCar } from "./models.js";

const q = new URLSearchParams(location.search);
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c8);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x505050, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(5, 9, 4); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: .85 }));
ground.receiveShadow = true;
scene.add(ground);

const camera = new THREE.PerspectiveCamera(35, 1, .05, 200);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, .6, 0);

let car = null;
function show(id) {
  if (car) scene.remove(car.group);
  const def = CARS.find((c) => c.id === id) || CARS[0];
  car = makeCar(def.id, def.color);
  car.group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  scene.add(car.group);
  const L = BODIES[def.body].L, d = (2.2 + L) * (+q.get("dist") || 1);
  const yaw = +(q.get("yaw") ?? .7), pitch = +(q.get("pitch") ?? .15);
  camera.position.set(Math.sin(yaw) * d * Math.cos(pitch), .6 + Math.sin(pitch) * d, -Math.cos(yaw) * d * Math.cos(pitch));
  controls.update();
  [...bar.children].forEach((b) => b.classList.toggle("on", b.dataset.id === def.id));
}
const bar = document.getElementById("bar");
for (const c of CARS) {
  const b = document.createElement("button");
  b.textContent = c.name.replace(/\(.*\)/, ""); b.dataset.id = c.id;
  b.onclick = () => show(c.id);
  bar.appendChild(b);
}
if (q.has("nobar")) bar.hidden = true;
await loadModels();
show(q.get("car") || "m4");

function frame() {
  const w = innerWidth, h = innerHeight;
  if (canvas.width !== w * devicePixelRatio) { renderer.setPixelRatio(devicePixelRatio); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
window.__render = () => { renderer.render(scene, camera); };

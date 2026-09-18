import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SkySystem, TIME_PRESETS, SKY_STYLES, WEATHERS } from "./sky.js";
import { World, laneX, ROAD_HALF, SHOULDER, cityAt } from "./world.js";
import { Traffic } from "./traffic.js";
import { CARS, BODIES, specOf, DetailedCar } from "./cars.js";
import { Drivetrain } from "./vehicle.js";
import { AudioManager } from "./audio.js";
import { Glows, uploadLights, lampUniforms } from "./lights.js";
import { createNet, RemoteView, NET } from "./net.js";
import { P, save, carById, carColor, carSound, carTune, carAudio, earn, walletHooks, MEDALS, addXp, medalCount } from "./profile.js";
import { runReward } from "./economy.js";
import { tunedSpec } from "./tuning.js";
import { UI } from "./ui.js";
import { loadModels, makeCar } from "./models.js";

// ---------------- renderer / scenes ----------------
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000);
const sky = new SkySystem(renderer, scene);
const world = new World(renderer, scene);
const traffic = new Traffic(scene);
const glows = new Glows(scene);
// Tyre smoke: a pooled, soft, lit-by-nothing particle cloud that grows and fades as it drifts back.
const smoke = (() => {
  const N = 260, pos = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N), P = [];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("size", new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { scale: { value: 700 } },
    vertexShader: "attribute float size; attribute float alpha; varying float vA; uniform float scale; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }",
    fragmentShader: "varying float vA; void main(){ vec2 c = gl_PointCoord - .5; float d = dot(c,c); if (d > .25) discard; gl_FragColor = vec4(vec3(.82,.83,.86), vA * (1. - d * 4.)); }",
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
  for (let i = 0; i < N; i++) P.push({ life: 0 });
  let head = 0;
  return {
    emit(x, y, z, amt, vx, vz) {
      if (Math.random() > amt * 1.2) return;
      const p = P[head]; head = (head + 1) % N;
      Object.assign(p, { x: x + (Math.random() - .5) * .3, y, z, vx: vx + (Math.random() - .5) * 1.5, vy: .6 + Math.random() * .8, vz: vz + Math.random() * 2, life: 1, max: 1.4 + Math.random(), s: .8 + amt });
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        const p = P[i];
        if (p.life > 0) { p.life -= dt / p.max; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= .97; p.vy *= .98; }
        pos[i * 3] = p.x || 0; pos[i * 3 + 1] = p.y || -50; pos[i * 3 + 2] = p.z || 0;
        size[i] = p.life > 0 ? p.s * (1 + (1 - p.life) * 3.5) : 0;
        alpha[i] = p.life > 0 ? Math.min(.5, p.life * .55) : 0;
      }
      g.attributes.position.needsUpdate = g.attributes.size.needsUpdate = g.attributes.alpha.needsUpdate = true;
    },
  };
})();
const audio = new AudioManager();
const net = await createNet();

function resize() {
  renderer.setPixelRatio(Math.min(2.5, Math.min(2, devicePixelRatio) * P.settings.res));
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// showroom (garage preview + thumbnails)
const show = new THREE.Scene();
const showCam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
{
  const pm = new THREE.PMREMGenerator(renderer);
  show.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  show.environmentIntensity = 0.9;
  show.add(new THREE.HemisphereLight(0xdfe8ff, 0x303030, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(4, 8, 5); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
  show.add(key);
}
const showDeco = new THREE.Group();
show.add(showDeco);
{
  const M = (c, r = .8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), M(0x3a3f47, .9)); floor.receiveShadow = true;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, .08, 64), M(0xcfd3d8, .35, .6)); disc.position.y = .04; disc.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.45, .05, 8, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb020 })); ring.position.y = .09;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 10, .5), M(0x4a4f58, .9)); wall.position.set(0, 5, -9);
  const wall2 = wall.clone(); wall2.rotation.y = Math.PI / 2; wall2.position.set(-9, 5, 0);
  const stripeTex = (() => { const c = document.createElement("canvas"); c.width = 256; c.height = 32; const g = c.getContext("2d");
    for (let i = -2; i < 20; i++) { g.fillStyle = i % 2 ? "#1b1b1b" : "#f0c020"; g.beginPath(); g.moveTo(i * 20, 32); g.lineTo(i * 20 + 20, 32); g.lineTo(i * 20 + 36, 0); g.lineTo(i * 20 + 16, 0); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.x = 8; return t; })();
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(40, .8, .1), new THREE.MeshStandardMaterial({ map: stripeTex })); stripe.position.set(0, 8.6, -8.7);
  showDeco.add(floor, disc, ring, wall, wall2, stripe);
  const crateM = M(0x8a6a44, .9);
  [[-5.5, 0, -6.5, 1.6], [-4, 0, -7, 1.2], [-5.2, 1.6, -6.6, 1.1], [5.5, 0, -7, 1.5], [6.5, 0, -5.5, 1.1], [-7, 0, -3, 1.4]].forEach(([x, y, z, s]) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateM); c.position.set(x, y + s / 2, z); c.rotation.y = x * .3; c.castShadow = c.receiveShadow = true; showDeco.add(c);
  });
}
let showCar = null, showCarId = null, showSpin = -0.6, dragging = false;
function setShowCar(id) {
  if (showCarId === id) return;
  if (showCar) { show.remove(showCar.group); showCar.dispose(); }
  const def = carById(id);
  showCar = makeCar(def.id, carColor(id));
  showCar.group.traverse((o) => (o.castShadow = true));
  show.add(showCar.group);
  showCarId = id;
}
const previewEl = document.getElementById("preview");
previewEl.addEventListener("pointerdown", (e) => {
  if (e.target.closest("button")) return;
  dragging = true; previewEl.setPointerCapture(e.pointerId);
});
previewEl.addEventListener("pointermove", (e) => { if (dragging) showSpin += e.movementX * 0.01; });
previewEl.addEventListener("pointerup", () => (dragging = false));

function frameShowCam(body, aspect, turn = 0) {
  const L = BODIES[body].L, d = 2.4 + L * .95;
  showCam.aspect = aspect;
  showCam.position.set(Math.sin(.75 + turn) * d, 1.5 + L * .12, Math.cos(.75 + turn) * d);
  const target = new THREE.Vector3(0, .65 + (BODIES[body].top - 1) * .3, 0);
  const right = new THREE.Vector3().subVectors(target, showCam.position).normalize().cross(new THREE.Vector3(0, 1, 0));
  showCam.lookAt(target.addScaledVector(right, aspect > 1.6 ? 1.1 : .2));
  showCam.updateProjectionMatrix();
}
function renderShowroom(rect) {
  const saved = lampUniforms.lampCount.value;
  lampUniforms.lampCount.value = 0;
  renderer.setScissorTest(true);
  const y = innerHeight - rect.bottom;
  renderer.setViewport(rect.left, y, rect.width, rect.height);
  renderer.setScissor(rect.left, y, rect.width, rect.height);
  renderer.setClearColor(0x2b3038, 1);
  renderer.clear();
  renderer.render(show, showCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  lampUniforms.lampCount.value = saved;
}
function makeThumbs(ids = CARS.map((c) => c.id)) {
  const out = {}, w = 240, h = 130, pr = renderer.getPixelRatio();
  const c2 = document.createElement("canvas"); c2.width = w * 2; c2.height = h * 2;
  const g = c2.getContext("2d");
  showDeco.visible = false;
  const saved = lampUniforms.lampCount.value; lampUniforms.lampCount.value = 0;
  for (const def of CARS.filter((c) => ids.includes(c.id))) {
    const car = makeCar(def.id, carColor(def.id));
    show.add(car.group);
    frameShowCam(def.body, w / h, .35);
    showCam.position.multiplyScalar(.82); showCam.lookAt(0, .7, 0);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
    renderer.setClearColor(0x000000, 0); renderer.clear();
    renderer.render(show, showCam);
    g.clearRect(0, 0, c2.width, c2.height);
    g.drawImage(canvas, 0, canvas.height - h * pr, w * pr, h * pr, 0, 0, c2.width, c2.height);
    out[def.id] = c2.toDataURL("image/png");
    show.remove(car.group); car.dispose();
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  lampUniforms.lampCount.value = saved;
  showDeco.visible = true;
  return out;
}

// ---------------- input ----------------
const keys = {};
const typing = () => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) && document.activeElement.type !== "range" && document.activeElement.type !== "checkbox";
addEventListener("keydown", (e) => {
  if (typing()) {
    if (e.code === "Enter" && document.activeElement.id === "chatInput") sendChat();
    if (e.code === "Escape") document.activeElement.blur();
    return;
  }
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  onKey(e.code);
  if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => {
  keys[e.code] = false;
  if (e.code === "KeyH") audio.horn(false);
});
addEventListener("blur", () => { for (const k in keys) keys[k] = false; audio.horn(false); });
// no browser context menu on the game (text fields keep theirs so paste still works)
addEventListener("contextmenu", (e) => { if (!["INPUT", "TEXTAREA"].includes(e.target?.tagName)) e.preventDefault(); });
const held = (...codes) => codes.some((c) => keys[c]);

// Every car runs its performance configuration; there is no mode switch.
P.settings.driveMode = "sport";
// ---------------- game state ----------------
let state = "home";       // home | ready | drive | crashed | over
let paused = false;
let mode = "solo";        // solo | online
let soloT = 0;
let camMode = 0;
const G = {
  def: carById(P.equipped), car: null, dt: null, engine: null,
  x: 0, z: 0, vx: 0, yaw: 0, steer: 0, thr: 0, brk: 0,
  score: 0, dist: 0, combo: 0, comboT: 0, closeCalls: 0, revives: 0, ghostT: 0, god: false,
  sigL: 0, sigR: 0, sigT: 0, sigOn: false, slowT: 0,
  crashT: 0, thrown: null, readyRpm: 900, prevDz: new Map(), scraping: false,
  runStartBest: 0, sendT: 0,
};
const getT = () => (mode === "online" && net.room ? (net.now() - net.room.epoch) / 1000 : soloT);

function makeDrivetrain() {
  const d = new Drivetrain(tunedSpec(G.def.id, carTune(G.def.id)));
  d.manual = P.settings.manual;
  d.mode = P.settings.driveMode;
  d.engineBrake = carTune(G.def.id).engineBrake;
  return d;
}
// A tune change rebuilds the physics view of the car (torque curve, boost curve, gearing, limiter)
// and hands the audio side the derived character - never an unrelated engine.
function applyTune() {
  const tune = carTune(G.def.id);
  G.engine?.tune(carAudio(G.def.id), P.settings.driveMode);
  if (G.dt) {
    const s = tunedSpec(G.def.id, tune);
    Object.assign(G.dt.s, s);
    G.dt.peak = s.peakTorque;
    G.dt.baseVmax = s.vmax;
    G.dt.gear = Math.min(G.dt.gear, s.ratios.length);
    G.cfgDirty = 1;
    G.dt.mode = P.settings.driveMode;
    G.dt.engineBrake = tune.engineBrake;
  }
}
// Traffic near the spawn point can't hit you for 2 s, and stays harmless until it's clear of you.
// Solo it is also hidden; in a party it stays visible, because everyone has to see the same cars.
function shieldSpawn() {
  const T = getT();
  G.shield = new Set(traffic.query(T, G.z - 120, G.z + 90, [1]).map((c) => c.key));
  G.shieldT = 2;
}
const shieldHidden = () => (mode === "online" ? null : G.shield);
function buildPlayerCar() {
  if (G.car) { scene.remove(G.car.group); G.car.dispose(); }
  G.def = carById(P.equipped);
  G.car = makeCar(G.def.id, carColor(G.def.id));
  scene.add(G.car.group);
  G.dt = makeDrivetrain();
  G.cfgDirty = 1;
  if (G.engine) G.engine.setProfile(carSound(G.def.id));
}

function pickSpawn(T, z) {
  for (const i of [2, 1, 3, 0, 4]) if (traffic.laneClear(T, laneX(i), z, 70, 45)) return laneX(i);
  return laneX(2);
}
function setSpeed(kmh) {
  const d = G.dt;
  d.v = kmh / 3.6;
  d.gear = 1;
  while (d.gear < d.s.ratios.length && d.rpmFor(d.v) > d.s.redline * .62) d.gear++;
}

async function ensureAudio() {
  await audio.init();
  audio.vol = { master: P.settings.volMaster, engine: P.settings.volEngine, fx: P.settings.volFx };
  audio.applyVolumes();
  if (!G.engine) G.engine = audio.engine(carSound(G.def.id));
}

function enterReady(asMode) {
  mode = asMode;
  buildPlayerCar();
  if (mode === "online" && net.room) {
    traffic.setSeed(net.room.seed, net.room.traffic || "Heavy", false);
    const others = [...remotes.values()].filter((r) => r.s && !r.s.cr);
    G.z = others.length ? others.reduce((a, r) => a + r.s.z, 0) / others.length + 30 : 0;
  } else {
    traffic.setSeed((Math.random() * 2 ** 31) | 0, P.settings.traffic, true);
    soloT = 0; G.z = 0;
  }
  G.x = pickSpawn(getT(), G.z);
  Object.assign(G, { vx: 0, yaw: 0, steer: 0, score: 0, dist: 0, combo: 0, comboT: 0, closeCalls: 0, revives: 0, ghostT: G.god ? 1e9 : 0, sigL: 0, sigR: 0, crashT: 0, thrown: null, slowT: 0, shield: null, shieldT: 0, prevThrIn: 0, awarded: false, bestCombo: 0, slide: 0, driftYaw: 0, slideDir: 0, flameT: 0, catch: 0, catchOn: false, release: 0, liftLoad: 0 });
  G.prevDz.clear();
  G.dt.v = 0; G.readyRpm = G.dt.s.idle;
  G.car.group.position.set(G.x, 0, G.z); G.car.group.rotation.set(0, 0, 0);
  G.runStartBest = P.best;
  state = "ready"; paused = false;
  ui.show("ready");
  ensureAudio().then(() => { G.engine.setProfile(carSound(G.def.id)); applyTune(); });
}
function startDriving() {
  if (state !== "ready") return;
  setSpeed(95);
  if (!(mode === "online" && partyRound && getT() < 1)) G.x = pickSpawn(getT(), G.z);
  G.car.group.position.x = G.x;
  shieldSpawn();
  G.ghostT = 0;
  state = "drive";
  ui.show("hud");
  G.engine?.event("downshift");
}
function crash(hitCar) {
  if (state !== "drive") return;
  state = "crashed";
  const v = G.dt.v, side = Math.sign(G.x - (hitCar?.x ?? G.x)) || (Math.random() < .5 ? -1 : 1);
  G.thrown = {
    pos: new THREE.Vector3(G.x, 0, G.z),
    vel: new THREE.Vector3(side * (3 + Math.random() * 4) + G.vx * .5, 6 + Math.min(10, v * .12), -v * .55),
    rot: new THREE.Euler(0, G.yaw, 0),
    ang: new THREE.Vector3((Math.random() - .5) * 8, (Math.random() - .5) * 10, side * (4 + Math.random() * 5)),
    bounces: 0,
  };
  const kick = hitCar ? traffic.bump(hitCar, v, -side) : null;
  // tell the party which traffic car got knocked, so everyone sees the same wreck
  if (kick && mode === "online" && net.room) net.send({ t: "event", kind: "bump", v: Math.round(v), d: `${kick.key}|${kick.vx.toFixed(2)}|${kick.vr.toFixed(2)}|${getT().toFixed(2)}` });
  audio.crash(Math.min(1, v / 50));
  G.crashT = 0; G.shake = 1;
  G.engine?.params(G.dt.s.idle, 0, 0);
  if (mode === "online" && partyRound) { const res = awardRun(); ui.toast(`🪙 +${res.coins.toLocaleString()} coins`); G.awarded = true; net.send({ t: "crash", round: partyRound, score: Math.floor(G.score) }); }
  else net.send({ t: "event", kind: "crash", v: Math.floor(G.score) });
}
function awardRun(opts = {}) {
  const score = Math.floor(G.score);
  const prevBest = P.best;
  if (score > P.best) P.best = score;
  const prevMedals = medalCount(prevBest), nowMedals = medalCount(P.best);
  P.medals = nowMedals;
  const levelUps = addXp(Math.floor(score / 4) + 25);
  // payouts all come from economy.js so the whole economy can be balanced in one place
  const best = [...remotes.values()].map((r) => r.s?.sc || 0);
  const reward = runReward({
    score, closeCalls: G.closeCalls, distance: G.dist, bestCombo: G.bestCombo || 0,
    newBest: score > prevBest && score > 0, newMedals: nowMedals - prevMedals, levelUps,
    survivor: !!opts.survivor,
    partyWin: mode === "online" && partyRound > 0 && best.length > 0 && best.every((s) => score >= s),
  });
  earn(reward.coins);
  save();
  net.send({ t: "score", score, level: P.level });
  net.send({ t: "runEnd", run: { score, closeCalls: G.closeCalls, distance: G.dist, bestCombo: G.bestCombo || 0, newBest: score > prevBest && score > 0, newMedals: nowMedals - prevMedals, levelUps, survivor: !!opts.survivor } });
  return { score, prevBest, coins: reward.coins, extras: reward.extras, closeCalls: G.closeCalls, newMedals: nowMedals - prevMedals, levelUps, revives: G.revives };
}
function finishRun() {
  if (state !== "crashed") return;
  state = "over";
  if (G.awarded) { G.awarded = false; return; }
  const result = awardRun();
  if (mode === "online" && partyRound) return ui.toast(`🪙 +${result.coins.toLocaleString()} coins`); // party: results banner comes from the server
  ui.showOver(result);
}

// ---------------- party rounds ----------------
// Everyone in a party starts together on the same seed + clock; the first crash ends the round for all.
let partyRound = 0, lastResults = null;
const LANE_ORDER = [2, 1, 3, 0, 4];
function enterPartyRound() {
  const room = net.room;
  if (!room || !room.round) return;
  partyRound = room.round;
  for (const p of net.peers.values()) p.buf.length = 0;
  ui.hideRoundResults();
  enterReady("online");
  if (room.roundState === "running" && getT() > 1) return startDriving(); // late joiner drops in beside the pack
  const idx = Math.max(0, room.players.findIndex((p) => p.id === net.me?.id));
  G.z = 0; G.x = laneX(LANE_ORDER[idx % LANE_ORDER.length]);
  G.car.group.position.set(G.x, 0, G.z);
}
function partyDrive() {
  const r = net.room;
  if (!r) return ui.openModal("online");
  audio.init();
  if (r.roundState === "lobby") net.send({ t: "startRound" });
  else if (r.roundState === "ended") ui.toast("Next round is about to start…");
  else enterPartyRound();
}
function roundOver() { // someone else crashed: our run stops where we are
  if (state !== "drive") return;
  state = "ended";
  audio.horn(false);
  const result = awardRun({ survivor: true });
  ui.toast(`🪙 +${result.coins.toLocaleString()} coins`);
}
net.addEventListener("room", () => {
  const r = net.room;
  if (!r || !r.round || r.round === partyRound || r.roundState !== "countdown") return;
  const wait = r.epoch - net.now() - 3000;
  const go = () => { if (net.room && net.room.round === r.round && r.round !== partyRound) enterPartyRound(); };
  if (mode === "online" && state !== "home" || state === "home" && ui.onlineSelected) wait > 0 ? setTimeout(go, wait) : go();
  else ui.toast(`🏁 Party round ${r.round} starting`, [{ label: "JOIN", run: enterPartyRound }]);
});
net.addEventListener("roundEnd", (e) => {
  const m = e.detail;
  if (mode !== "online" || m.round !== partyRound || state === "home") return;
  roundOver();
  lastResults = m;
});
function revive() {
  if (state !== "over" || G.revives >= 3 || P.hearts <= 0) return false;
  P.hearts--; G.revives++; save();
  const T = getT();
  G.x = pickSpawn(T, G.z);
  G.thrown = null; G.vx = 0; G.yaw = 0;
  G.car.group.rotation.set(0, 0, 0); G.car.group.position.set(G.x, 0, G.z);
  G.dt = makeDrivetrain();
  shieldSpawn();
  setSpeed(100);
  G.ghostT = 2.5; G.combo = 0; G.prevDz.clear();
  state = "drive";
  ui.show("hud");
  return true;
}
function goHome() {
  state = "home"; paused = false;
  G.engine?.params(900, 0, 0);
  audio.horn(false);
  ui.show("home");
  ui.renderHome();
}

// ---------------- keys ----------------
function onKey(code) {
  if (ui.anyModalOpen()) { if (code === "Escape") ui.closeModals(); return; }
  if (code === "KeyL" && state !== "home") return ui.toggleModal("leader");
  if (code === "KeyJ" && state !== "home") return ui.toggleModal("media");
  if (state === "ready" && (code === "Space" || code === "Enter")) return mode === "online" && partyRound ? null : startDriving();
  if (!["drive", "crashed", "over"].includes(state)) return;
  switch (code) {
    case "KeyR": if (mode === "online" && partyRound) ui.toast("Party rounds restart automatically"); else if (state !== "crashed") enterReady(mode), startDriving(); break;
    case "KeyP": case "Escape": togglePause(); break;
    case "KeyC": camMode = (camMode + 1) % 3; break;
    case "KeyT": { const names = Object.keys(TIME_PRESETS); const i = (names.findIndex((n) => Math.abs(TIME_PRESETS[n] - sky.hour) < .3) + 1) % names.length; P.settings.hour = sky.hour = TIME_PRESETS[names[i]]; save(); ui.toast(`🕒 ${names[i]}`); break; }
    case "KeyB": { const names = Object.keys(WEATHERS); const i = (names.indexOf(sky.weatherName) + 1) % names.length; sky.setWeather(names[i]); P.settings.weather = names[i]; save(); ui.toast(`🌦 ${names[i]}`); break; }
    case "KeyV": { const i = (SKY_STYLES.indexOf(sky.style) + 1) % SKY_STYLES.length; sky.setStyle(SKY_STYLES[i]); P.settings.sky = SKY_STYLES[i]; save(); ui.toast(`✨ ${SKY_STYLES[i]} sky`); break; }
    case "Enter": if (mode === "online" && net.room) { ui.chatInput.hidden = false; ui.chatInput.focus(); } break;
  }
  if (state !== "drive" || paused) return;
  const d = G.dt;
  switch (code) {
    case "KeyM": d.manual = !d.manual; ui.toast(d.manual ? "⚙️ MANUAL — Q / E to shift" : "🅰 AUTOMATIC"); break;
    case "KeyE": if (d.manual) d.shiftUp(); else ui.toast("Press M for manual mode"); break;
    case "KeyQ": if (d.manual) d.shiftDown(); else ui.toast("Press M for manual mode"); break;
    case "KeyZ": G.sigL = G.sigL ? 0 : 6; G.sigR = 0; G.sigT = 0; G.sigOn = false; break;
    case "KeyX": G.sigR = G.sigR ? 0 : 6; G.sigL = 0; G.sigT = 0; G.sigOn = false; break;
    case "KeyH": audio.horn(true); break;
  }
}
function togglePause() {
  if (state === "over") return;
  if (mode === "online") return ui.toast("Can't pause during online play");
  paused = !paused;
  ui.setPaused(paused);
  if (paused) { G.engine?.params(900, 0, 0); audio.horn(false); }
}
function sendChat() {
  const text = ui.chatInput.value.trim();
  if (text) net.send({ t: "chat", text });
  ui.chatInput.value = ""; ui.chatInput.hidden = true; ui.chatInput.blur();
}

// ---------------- remote players ----------------
const remotes = new Map();
const PLAYER_COLORS = ["#3dd6ff", "#ff5ad1", "#ffd23d", "#7dff5a", "#ff8a3d", "#b27dff", "#ff4a55", "#4dffc3"];
function nameTag(name, color) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 128;
  const g = c.getContext("2d");
  g.font = "700 60px Fredoka, sans-serif";
  const w = Math.min(496, g.measureText(name).width + 70);
  const x0 = 256 - w / 2;
  g.fillStyle = "rgba(10,14,24,.88)"; g.strokeStyle = color; g.lineWidth = 8;
  g.beginPath(); g.roundRect(x0, 14, w, 92, 46); g.fill(); g.stroke();
  g.fillStyle = color; g.beginPath(); g.arc(x0 + 38, 60, 12, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(name, 256 + 14, 62);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.renderOrder = 22;
  return s;
}
let glowTexture = null;
function glowTex() {
  if (glowTexture) return glowTexture;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,.9)"); grd.addColorStop(.5, "rgba(255,255,255,.35)"); grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return (glowTexture = new THREE.CanvasTexture(c));
}
function syncRemote(id, peer) {
  let r = remotes.get(id);
  const newest = peer.buf.at(-1);
  if (newest?.c && !newest._cfg) { newest._cfg = 1; peer.cfg = newest.c; peer.cfgN = (peer.cfgN || 0) + 1; } // identity/tune block, a couple of times a second
  const last = peer.cfg || {};
  const def = carById(last.car || CARS[0].id);
  if (!r || r.carId !== def.id) {
    if (r) { scene.remove(r.car.group); r.car.dispose(); }
    const car = makeCar(def.id, last.col ?? def.color);
    const color = PLAYER_COLORS[[...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % PLAYER_COLORS.length];
    const B = BODIES[def.body];
    const tag = nameTag(peer.name, color);
    tag.position.set(0, B.top + 2.1, 0);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(.32, .7, 4).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: .95 }));
    arrow.renderOrder = 21; arrow.position.set(0, B.top + 1.15, 0);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(B.W * 2, B.L * 1.35).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .8 }));
    glow.position.y = .04; glow.renderOrder = 2;
    car.group.add(tag, arrow, glow);
    scene.add(car.group);
    r = { car, tag, arrow, glow, color, carId: def.id, col: last.col, snd: null, voice: r?.voice || null, s: null, name: peer.name, view: r?.view || new RemoteView() };
    remotes.set(id, r);
  }
  if (last.col !== undefined && last.col !== r.col) { r.col = last.col; r.car.setColor(last.col); }
  if (last.a) { r.cfgA = last.a; if (r.voice && r.aN !== peer.cfgN) { r.aN = peer.cfgN; r.voice.tune(last.a, last.md ? "comfort" : "sport"); } }
  if (last.th !== undefined && r.thN !== peer.cfgN) { r.thN = peer.cfgN; checkTrafficSync(last.tq, last.th); }
  return r;
}
// Their traffic fingerprint against ours at the same moment. Identical = the two clients really are
// running one simulation, not two that merely look alike. A mismatch re-seeds us from the room.
let syncBad = 0, syncOk = 0;
function checkTrafficSync(tq, th) {
  if (state === "home" || !net.room || typeof tq !== "number") return;
  if (traffic.worldHash(tq) === th) { syncOk++; syncBad = 0; return; }
  if (++syncBad < 3) return;                     // one stale packet across a round change is normal
  syncBad = 0;
  traffic.setSeed(net.room.seed, net.room.traffic || "Heavy", false);
  ui.toast("🔄 Resynced traffic with the party");
}
net.addEventListener("peerLeft", (e) => {
  const r = remotes.get(e.detail);
  if (!r) return;
  scene.remove(r.car.group); r.car.dispose(); r.voice?.params(900, 0, 0);
  remotes.delete(e.detail);
});
function updateRemotes(T, dt) {
  const listener = new THREE.Vector3(G.x, 0, G.z);
  const list = [];
  const hideNames = !!P.settings.hideNames;
  for (const [id, peer] of net.peers) {
    if (!peer.buf.length || performance.now() - (peer.last || 0) > 5000) continue;
    const r = syncRemote(id, peer);
    // snapshot interpolation: drawn a beat in the past so there is always a snapshot either side
    const s = r.view.update(peer, T, dt);
    if (!s) continue;
    r.s = s;
    const cfg = peer.cfg || {};
    const g = r.car.group;
    g.visible = mode === "online" && state !== "home";
    const prevZ = g.position.z;
    g.position.set(s.x, s.y || 0, s.z);
    g.rotation.set(s.pitch || 0, s.ry || 0, s.roll || 0);
    r.car.update(Math.max(0, prevZ - s.z), 0);
    r.car.setLights(s.brk, s.sl, s.sr, sky.night);
    const dist = listener.distanceTo(g.position);
    const ts = 2.6 + dist * .018;
    r.tag.visible = !hideNames;
    r.tag.scale.set(ts, ts / 4, 1);
    const B = BODIES[carById(cfg.car || r.carId).body];
    r.arrow.position.y = B.top + 1.15 + Math.sin(performance.now() / 250) * .15;
    r.arrow.scale.setScalar(1 + dist * .006);
    r.glow.material.opacity = s.cr ? 0 : .55 + Math.sin(performance.now() / 300) * .2;
    list.push({ r, dist, s, id });
    if (sky.lampsOn && !s.cr) {
      for (const k of [-1, 1]) {
        glows.add(s.x + k * (B.W / 2 - .35), B.tl[1], s.z + B.L / 2, 1, s.brk ? .15 : .05, .05, s.brk ? 1.4 : .8);
        glows.add(s.x + k * (B.W / 2 - .35), B.hl[1], s.z - B.L / 2, 1, .95, .85, 1.5);
      }
    }
  }
  // engine sounds for the two closest party members, voiced locally from their synced engine state
  list.sort((a, b) => a.dist - b.dist);
  list.forEach(({ r, dist, s }, i) => {
    if (!audio.ready || mode !== "online") return;
    const cfg = r.cfgA || null;
    if (i < 2 && dist < 140 && !s.cr) {
      const snd = cfg?.engine || carSound(r.carId);
      if (!r.voice) r.voice = audio.engine(snd);
      if (r.snd !== snd) { r.snd = snd; r.voice.setProfile(snd); }
      r.voice.params({
        rpm: s.rpm || 900, throttle: s.thr || 0, gain: .8, load: s.ld ?? s.thr ?? 0,
        boostNorm: (s.bo ?? 0) / 100, gear: s.g || 1, redline: cfg?.redline || 7000,
      });
      r.voice.setPan((s.x - G.x) / 20, Math.max(0, 1 - dist / 140) ** 2 * .7);
    } else r.voice?.params({ rpm: 900, throttle: 0, gain: 0, load: 0 });
  });
  ui.renderPartyHud(list.map(({ r, s }) => ({ name: r.name, dz: G.z - s.z, score: s.sc || 0, crashed: s.cr, color: r.color })));
  // screen-edge markers for players that are off-screen or far away
  const markers = [];
  if (state !== "home") for (const { r, dist, id, s } of list) {
    const p = tmpV.set(s.x, 1.5, s.z).project(camera);
    const behind = p.z > 1;
    let sx = (p.x * .5 + .5) * innerWidth, sy = (-p.y * .5 + .5) * innerHeight;
    const onScreen = !behind && sx > 30 && sx < innerWidth - 30 && sy > 90 && sy < innerHeight - 30;
    if (onScreen && dist < 160) continue;
    if (behind) { sx = innerWidth - sx; sy = innerHeight - 40; }
    sx = Math.max(70, Math.min(innerWidth - 70, sx)); sy = Math.max(110, Math.min(innerHeight - 40, sy));
    const dz = Math.round(G.z - s.z);
    markers.push({ id, name: r.name, color: r.color, x: sx, y: sy, text: `${behind ? "▼" : "▲"} ${hideNames ? "" : r.name + " "}${dz >= 0 ? "+" : ""}${dz}m` });
  }
  ui.renderPeerMarkers(markers);
  return list;
}

// ---------------- multiplayer catch-up ----------------
// When you fall a long way behind the pack the car gets a gentle, gradual power boost - no
// teleporting and no rubber-band snap. Three thresholds keep it from flickering on and off:
// it arms past `on`, is at full strength down to `full`, fades out to nothing at `off`.
// Tweak live through window.__game.CATCHUP.
const CATCHUP = { on: 500, full: 300, off: 150, maxPower: .35, maxKmh: 25, rampUp: .5, rampDown: 1.2 };
function updateCatchUp(dt, list) {
  const d = G.dt;
  if (!d) return;
  const alive = mode === "online" && state === "drive" && list && list.some((x) => !x.s.cr);
  if (!alive) { G.catchOn = false; G.catch = Math.max(0, (G.catch || 0) - dt * CATCHUP.rampDown); }
  else {
    const lead = Math.min(...list.filter((x) => !x.s.cr).map((x) => x.s.z));
    const gap = G.z - lead;                       // positive: the pack is ahead of us
    if (gap > CATCHUP.on) G.catchOn = true;
    if (gap < CATCHUP.off) G.catchOn = false;
    const want = G.catchOn ? Math.max(0, Math.min(1, (gap - CATCHUP.off) / (CATCHUP.full - CATCHUP.off))) : 0;
    const step = dt * (want > (G.catch || 0) ? CATCHUP.rampUp : CATCHUP.rampDown);
    G.catch = Math.max(0, Math.min(1, (G.catch || 0) + Math.max(-step, Math.min(step, want - (G.catch || 0)))));
  }
  d.assist = 1 + G.catch * CATCHUP.maxPower;
  if (d.baseVmax) d.s.vmax = d.baseVmax + G.catch * CATCHUP.maxKmh;
}
// every driver in the session, so traffic knows not to change lanes into any of us
function allPlayers() {
  const out = state === "home" ? [] : [{ x: G.x, z: G.z }];
  if (mode === "online") for (const r of remotes.values()) if (r.s && !r.s.cr) out.push({ x: r.s.x, z: r.s.z });
  return out;
}

// ---------------- simulation ----------------
const tmpV = new THREE.Vector3();
const lights = [];
const playerLight = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), color: new THREE.Color(1, .97, .9), intensity: 7, range: 70, cosOuter: Math.cos(.42), cosInner: Math.cos(.16) };

function updateDrive(dt, T) {
  const d = G.dt, def = G.def, B = BODIES[def.body];
  const thrIn = held("KeyW", "ArrowUp") ? 1 : 0, brkIn = held("KeyS", "ArrowDown", "Space") ? 1 : 0;
  const prevThr = G.thr;
  G.thr += (thrIn - G.thr) * Math.min(1, dt * (thrIn > G.thr ? 14 : 12));
  // everything the burble model needs: how hard it was pulling, how fast the pedal came up, boost
  const evInfo = () => ({ rpm: d.rpm, load: G.liftLoad ?? d.load, boost: d.s.boostMax ? d.boost / d.s.boostMax : 0, gear: d.gear, release: G.release || 0 });
  if (thrIn) { G.release = 0; G.liftLoad = d.load; }
  else { G.liftLoad = Math.max(d.load, (G.liftLoad || 0) * Math.exp(-dt * .7)); G.release = (G.release || 0) * Math.exp(-dt * 1.2); }
  if (G.prevThrIn && !thrIn) { G.release = 10; G.engine?.event("lift", evInfo()); if (d.rpm > d.s.redline * .55) G.flameT = .6 + (d.s.antiLag ? .8 : 0); } // snap lift: flutter + overrun burble
  G.prevThrIn = thrIn;
  G.brk += (brkIn - G.brk) * Math.min(1, dt * 12);
  const events = d.update(dt, G.thr, G.brk);
  for (const ev of events) {
    if (ev === "upshift" || ev === "autoUp") {
      G.engine?.event(G.thr > .3 ? "upshift" : "limiter", evInfo()); if (ev === "upshift") audio.shiftClunk(true);
      if ((d.s.eth || 0) >= .3 && G.thr > .3) { G.flameT = Math.max(G.flameT || 0, .25 + d.s.eth * .45); G.engine?.event("pop", { v: .6 + d.s.eth }); }
    }
    else if (ev === "downshift" || ev === "autoDown") { G.engine?.event("downshift", evInfo()); if (ev === "downshift") audio.shiftClunk(false); }
    else if (ev === "limiter" || ev === "lift") G.engine?.event(ev, evInfo());
    else if (ev === "deny") audio.deny();
    else if (ev === "launchArm") { G.engine?.event("launchArm"); ui.toast("LAUNCH CONTROL ARMED — release brake"); }
    else if (ev === "launch") G.engine?.event("launch");
  }
  if (G.brk > .5 && !thrIn && d.v < .5 && !G.launchHint) { G.launchHint = 1; ui.toast("Hold brake + throttle for launch control"); }
  const v = d.v, kmh = v * 3.6;
  d.surface = 1 - (sky.w?.rain || 0) * .22; // wet road

  // steering
  const steerIn = (held("KeyD", "ArrowRight") ? 1 : 0) - (held("KeyA", "ArrowLeft") ? 1 : 0);
  G.steer += (steerIn - G.steer) * Math.min(1, dt * 9);
  const hMul = d.s.handlingMul || 1;
  const maxLat = (4.5 + def.handling * .07) * hMul * Math.min(1, v / 14);
  // lateral acceleration the driver is asking for vs what the tyres can give (friction circle)
  const mu = (d.s.grip || 1) * d.surface * (.92 + hMul * .08) * (1 - Math.min(.15, (d.s.mass - 1500) / 8000));
  const longUse = Math.min(.9, Math.abs(d.accel) / (9.81 * mu));
  const latAvail = 9.81 * mu * Math.sqrt(Math.max(.05, 1 - longUse * longUse)) * 1.05;
  const latDemand = Math.abs(G.steer) * v * v / Math.max(18, 26 + v * .9);
  let over = Math.max(0, latDemand / latAvail - 1);
  // power oversteer: spinning rear tyres lose side grip. AWD shares it, FWD pushes wide instead.
  const spin = d.wheelspin || 0;
  if (d.drive === "rwd") over += spin * Math.abs(G.steer) * 1.6;
  else if (d.drive === "awd") over += spin * Math.abs(G.steer) * .6;
  G.slide = (G.slide || 0) + (Math.min(1.2, over) - (G.slide || 0)) * Math.min(1, dt * (over > G.slide ? 4 : 1.6));
  const grip = 1 - Math.min(.75, G.slide * (d.drive === "fwd" ? .9 : .7));
  G.vx += (G.steer * maxLat * grip - G.vx) * Math.min(1, dt * (3.5 + def.handling * .05) * hMul * grip);
  // the rear steps out: extra body angle while sliding, countersteer (opposite input) catches it
  const counter = G.steer * (G.slideDir || 0) < -.2 ? 3 : 1;
  if (G.slide > .08 && d.drive !== "fwd") G.slideDir = G.slideDir || Math.sign(G.steer || G.vx);
  if (G.slide < .04) G.slideDir = 0;
  G.driftYaw = (G.driftYaw || 0) + ((G.slideDir || 0) * Math.min(.45, G.slide * .5) - (G.driftYaw || 0)) * Math.min(1, dt * 3 * counter);
  if (G.slide > .05) d.v *= 1 - dt * G.slide * .22; // scrubbing speed
  G.x += G.vx * dt;
  const lim = ROAD_HALF + SHOULDER - B.W / 2 - .1;
  G.scraping = false;
  if (Math.abs(G.x) > lim) {
    G.x = Math.sign(G.x) * lim; G.vx *= -.2; G.scraping = v > 5;
    d.v *= 1 - dt * .6;
    if (G.scraping) for (let i = 0; i < 3; i++) glows.add(G.x + Math.sign(G.x) * B.W / 2, .3 + Math.random() * .4, G.z + (Math.random() - .5) * 2, 1, .6 + Math.random() * .3, .2, .4 + Math.random() * .5);
  }
  G.z -= v * dt;
  G.dist += v * dt;
  G.yaw += (-Math.atan2(G.vx, Math.max(v, 6)) * .9 - (G.driftYaw || 0) - G.yaw) * Math.min(1, dt * 10);
  // tyre smoke, squeal and exhaust flames
  const smokeAmt = Math.max(G.slide > .15 ? G.slide : 0, spin > .15 ? spin : 0);
  if (smokeAmt > 0) for (const k of [-1, 1]) smoke.emit(G.x + k * (B.W / 2 - .3), .35, G.z + B.L * .32, smokeAmt, G.vx * .3, -v * .15);
  audio.tires?.(G.slide || 0, spin, kmh);
  if (G.flameT > 0) {
    G.flameT -= dt;
    if (Math.random() < .35) for (const e of (B.exhaust || [[-B.L / 2, .3, .45]])) glows.add(G.x + (e[2] || 0) * .9, (e[1] || .3), G.z + B.L / 2 + .15, 1, .55 + Math.random() * .3, .15, .6 + Math.random() * .9);
  }

  // score
  if (kmh >= 80) G.score += (v * dt) / 10 * Math.max(1, kmh / 130);
  G.slowT = kmh < 80 ? G.slowT + dt : 0;
  G.comboT -= dt;
  if (G.comboT <= 0) G.combo = 0;
  if (G.ghostT > 0) G.ghostT -= dt;
  if (G.shieldT > 0) G.shieldT -= dt;

  // traffic interaction
  const near = traffic.query(T, G.z - 60, G.z + 30, [1]);
  const seen = new Set();
  for (const c of near) {
    seen.add(c.key);
    if (traffic.bumped.has(c.key)) continue;
    if (G.shield?.has(c.key)) {
      if (G.shieldT > 0 || Math.abs(c.z - G.z) < 35 || Math.abs(c.x - G.x) < 2.5 && Math.abs(c.z - G.z) < 60) continue;
      G.shield.delete(c.key);
    }
    const dx = c.x - G.x, dz = c.z - G.z;
    if (G.ghostT <= 0 && Math.abs(dx) < (c.W + B.W) / 2 - .12 && Math.abs(dz) < (c.L + B.L) / 2 - .2) return crash(c);
    const prev = G.prevDz.get(c.key);
    G.prevDz.set(c.key, dz);
    if (prev !== undefined && prev < 0 && dz >= 0) {
      const gap = Math.abs(dx) - (c.W + B.W) / 2;
      if (gap < 3.2) audio.whoosh(Math.sign(dx) * .7, c.body === "truck" || c.body === "bus");
      if (gap < 1.35 && kmh > 90 && G.ghostT <= 0) {
        G.combo = G.comboT > 0 ? G.combo + 1 : 1;
        G.comboT = 2.5; G.closeCalls++; G.bestCombo = Math.max(G.bestCombo || 0, G.combo);
        G.score += 20 + (G.combo - 1) * 10;
        ui.closeCall(G.combo);
        audio.closeCall(G.combo);
        if ((c.body === "truck" || c.body === "bus") && Math.random() < .35) audio.truckHorn(Math.sign(dx) * .6);
        if (G.combo % 5 === 0) net.send({ t: "event", kind: "combo", v: G.combo });
      }
    }
  }
  for (const k of G.prevDz.keys()) if (!seen.has(k)) G.prevDz.delete(k);

  G.car.group.position.set(G.x, 0, G.z);
  G.car.group.rotation.set(0, G.yaw, 0);
  G.car.bodyGroup.rotation.set(-G.brk * .012 + G.thr * .006, 0, -G.vx * .006);
  G.car.group.visible = G.ghostT <= 0 || G.ghostT > 5 || Math.floor(G.ghostT * 10) % 2 === 0;
  G.car.update(v * dt, G.steer);
}

function updateThrown(dt) {
  const t = G.thrown;
  if (!t) return;
  G.crashT += dt;
  if (state === "crashed" && G.crashT > 1.15) finishRun();
  t.vel.y -= 22 * dt;
  t.pos.addScaledVector(t.vel, dt);
  t.rot.x += t.ang.x * dt; t.rot.y += t.ang.y * dt; t.rot.z += t.ang.z * dt;
  if (t.pos.y < 0) {
    t.pos.y = 0;
    if (Math.abs(t.vel.y) > 3 && t.bounces < 4) { audio.ready && audio.noiseShot({ type: "lowpass", f0: 900, f1: 120, d: .25, peak: Math.min(.8, Math.abs(t.vel.y) * .06), buf: audio.brownBuf }); t.bounces++; }
    t.vel.y = -t.vel.y * .32; t.vel.x *= .6; t.vel.z *= .6; t.ang.multiplyScalar(.55);
    if (Math.abs(t.vel.y) < 1) { t.rot.x += (Math.round(t.rot.x / Math.PI) * Math.PI - t.rot.x) * Math.min(1, dt * 6); t.rot.z += (Math.round(t.rot.z / Math.PI) * Math.PI - t.rot.z) * Math.min(1, dt * 6); }
  }
  const lim = 11.5;
  if (Math.abs(t.pos.x) > lim) { t.pos.x = Math.sign(t.pos.x) * lim; t.vel.x *= -.4; }
  G.x = t.pos.x; G.z = t.pos.z;
  G.car.group.position.copy(t.pos);
  G.car.group.rotation.copy(t.rot);
  G.car.group.visible = true;
  if (G.crashT < .4) for (let i = 0; i < 4; i++) glows.add(t.pos.x + (Math.random() - .5) * 2, .5 + Math.random(), t.pos.z + (Math.random() - .5) * 3, 1, .7, .3, .5 + Math.random());
}

function updateSignals(dt) {
  if (!G.sigL && !G.sigR) { G.sigOn = false; return; }
  G.sigT -= dt;
  if (G.sigT <= 0) {
    G.sigT = .36;
    G.sigOn = !G.sigOn;
    audio.tick(G.sigOn);
    if (G.sigL) G.sigL--; if (G.sigR) G.sigR--;
    if (!G.sigL && !G.sigR) G.sigOn = false;
  }
}

function updateCamera(dt) {
  const v = G.dt ? G.dt.v : 0, kmh = v * 3.6;
  const target = new THREE.Vector3(), look = new THREE.Vector3();
  const B = BODIES[G.def.body];
  if (state === "ready") {
    const a = performance.now() * .00012 + .9;
    const R = 8.5 + B.L * .4;
    target.set(G.x - Math.sin(a) * R, 1.9, G.z - Math.cos(a) * R);
    look.set(G.x + 1.2, .8, G.z);
    camera.position.lerp(target, Math.min(1, dt * 3));
    camera.lookAt(look);
    camera.fov = 45;
  } else {
    const far = camMode === 1;
    const hood = camMode === 2;
    if (hood) {
      target.set(G.x, B.top * .8 + .25, G.z - B.L * .1);
      camera.position.copy(target);
      look.set(G.x + G.vx * .2, B.top * .75, G.z - 30);
    } else {
      const tall = camera.aspect < 1.1 ? 1.5 : 0;
      const back = (far ? 12 : 8) + tall + B.L * .35 + kmh * .01;
      target.set(G.x * .9, (far ? 4.4 : 2.7) + B.top * .45 + tall * .3, G.z + back);
      if (state === "drive") camera.position.lerp(target, Math.min(1, dt * 7)); else camera.position.lerp(tmpV.set(G.x * .8, target.y + 2, G.z + back + 4), Math.min(1, dt * 2));
      camera.position.z = state === "drive" ? Math.min(camera.position.z, G.z + back + 2) : camera.position.z;
      look.set(G.x, 1.6 + tall * .4, G.z - 30);
      if (state !== "drive") look.set(G.x, .8, G.z);
    }
    if (G.shake > 0) { G.shake -= dt * 1.4; camera.position.x += (Math.random() - .5) * G.shake * .5; camera.position.y += (Math.random() - .5) * G.shake * .5; }
    if (state === "drive" && kmh > 200) { const s = (kmh - 200) / 6000; camera.position.x += (Math.random() - .5) * s; camera.position.y += (Math.random() - .5) * s; }
    camera.lookAt(look);
    camera.fov = hood ? 70 + Math.min(18, kmh * .05) : 58 + Math.min(20, kmh * .065);
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function updateEngineSound(dt) {
  if (!G.engine) return;
  const d = G.dt;
  if (state === "ready") {
    const thr = held("KeyW", "ArrowUp") ? 1 : 0;
    const target = d.s.idle + thr * d.s.redline * .72;
    const before = G.readyRpm;
    G.readyRpm += (target - G.readyRpm) * Math.min(1, dt * (thr ? 5 : 2.2));
    if (G.readyRpm > d.s.redline * .7 && thr) { G.readyRpm -= 500; G.engine.event("limiter"); }
    if (G.prevReadyThr && !thr && before > 3500) G.engine.event("lift", { rpm: before, load: 1, release: 10, boost: .8, gear: 1 });
    G.prevReadyThr = thr;
    G.engine.params({ rpm: G.readyRpm, throttle: thr, gain: .85, load: thr * .9, boostNorm: thr * Math.min(1, G.readyRpm / 4000), gear: 1, redline: d.s.redline, warmth: d.warmth });
  } else if (state === "drive" && !paused) {
    G.engine.params(d.audioState(d.shiftT > 0 && G.thr > .3 ? .1 : G.thr, camMode === 1 ? .7 : camMode === 2 ? .95 : .85));
  } else if (state !== "home") {
    G.engine.params({ rpm: d.s.idle * .6, throttle: 0, gain: 0, load: 0, boostNorm: 0 });
  }
}

// ---------------- HUD ----------------
const MPH = 0.621371; // speeds are shown in mph everywhere
const tachCtx = document.getElementById("tach").getContext("2d");
function drawTach(rpm, redline, manual) {
  const g = tachCtx, cx = 130, cy = 130, R = 104;
  g.clearRect(0, 0, 260, 260);
  const a0 = Math.PI * .75, span = Math.PI * 1.5, maxR = Math.ceil(redline / 1000) * 1000 + 1000;
  g.lineCap = "round";
  g.beginPath(); g.arc(cx, cy, R, a0, a0 + span); g.lineWidth = 16; g.strokeStyle = "rgba(10,14,24,.75)"; g.stroke();
  g.beginPath(); g.arc(cx, cy, R, a0 + span * redline / maxR, a0 + span); g.lineWidth = 16; g.strokeStyle = "rgba(255,40,60,.55)"; g.stroke();
  const f = Math.min(1, rpm / maxR);
  const hot = rpm > redline * .92;
  const grad = g.createLinearGradient(0, 260, 260, 0);
  grad.addColorStop(0, "#3fb8ff"); grad.addColorStop(.7, "#ffc629"); grad.addColorStop(1, "#ff3b3b");
  g.beginPath(); g.arc(cx, cy, R, a0, a0 + span * f); g.lineWidth = 12; g.strokeStyle = hot && manual && Math.floor(performance.now() / 70) % 2 ? "#ff2a2a" : grad; g.stroke();
  g.fillStyle = "#fff"; g.font = "700 15px Fredoka, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  for (let k = 0; k <= maxR / 1000; k++) {
    const a = a0 + span * (k * 1000 / maxR);
    g.fillText(k, cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26));
  }
}
let hudCache = {};
function setText(el, v) { if (hudCache[el.id] !== v) { hudCache[el.id] = v; el.textContent = v; } }
function updateHud() {
  if (state !== "drive" && state !== "crashed" && state !== "ended") return;
  const d = G.dt, kmh = d.v * 3.6;
  setText(ui.el.score, Math.floor(G.score).toLocaleString());
  setText(ui.el.best, "BEST " + Math.max(P.best, Math.floor(G.score)).toLocaleString());
  setText(ui.el.speed, `${Math.round(kmh * MPH)} MPH`);
  setText(ui.el.dist, `${(G.dist / 1609.34).toFixed(1)}Mi`);
  setText(ui.el.gear, d.shiftT > 0 ? "-" : String(d.gear));
  setText(ui.el.gearMode, d.manual ? "MANUAL" : "AUTO");
  ui.el.gearMode.classList.toggle("man", d.manual);
  ui.el.sigL.classList.toggle("on", !!G.sigL && G.sigOn);
  ui.el.sigR.classList.toggle("on", !!G.sigR && G.sigOn);
  ui.el.speedUp.classList.toggle("on", state === "drive" && G.slowT > 1.2);
  ui.el.ghost.hidden = !(G.ghostT > 0 && state === "drive");
  if (G.god && !ui.el.ghost.hidden) ui.el.ghost.textContent = "GOD MODE";
  ui.el.catchUp.hidden = !((G.catch || 0) > .05 && state === "drive");
  if (G.comboT <= 0) ui.el.combo.classList.remove("on");
  drawTach(d.rpm, d.s.redline, d.manual);
}

// ---------------- main loop ----------------
let last = performance.now(), thumbsReady = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;

  if (!thumbsReady && canvas.width >= 480 && canvas.height >= 260) {
    thumbsReady = true;
    ui.thumbs = makeThumbs();
    if (state === "home") ui.renderHome();
  }
  if (canvas.width !== Math.floor(innerWidth * renderer.getPixelRatio())) resize();

  if (state === "home") {
    renderer.setClearColor(0x0b0f19, 1);
    renderer.clear();
    const rect = previewEl.getBoundingClientRect();
    if (rect.width > 10 && !ui.anyModalOpen()) {
      if (!dragging) showSpin += dt * .25;
      if (showCar) {
        showCar.group.rotation.y = showSpin;
        frameShowCam(carById(showCarId).body, rect.width / rect.height);
      }
      renderShowroom(rect);
    }
    audio.update(0, 0, false);
    return;
  }

  const simDt = paused ? 0 : dt;
  if (mode === "solo" && (state === "drive" || state === "crashed" || state === "over")) soloT += simDt;
  const T = getT();
  glows.begin();
  lights.length = 0;
  traffic.setPlayers(allPlayers());

  if (state === "ready" && mode === "online" && partyRound) {
    const recap = lastResults && lastResults.round === partyRound - 1 ? `💥 ${lastResults.by} crashed — ${lastResults.scores.map((p) => `${p.name} ${p.score.toLocaleString()}`).join(" · ")}` : net.room ? net.room.players.map((p) => p.name).join(" · ") : "";
    ui.setReady(`ROUND ${partyRound}`, recap, T < 0 ? String(Math.ceil(-T)) : "GO!");
    if (T >= 0) startDriving();
  }
  if (state === "ended") { // coast to a stop after the round ended
    G.dt.v *= Math.exp(-simDt * 1.4); G.z -= G.dt.v * simDt;
    G.car.group.position.set(G.x, 0, G.z); G.car.update(G.dt.v * simDt, 0);
  }
  if (state === "drive" && !paused) updateDrive(simDt, T);
  else if (state === "crashed" || state === "over") updateThrown(simDt);
  if (!paused) updateSignals(simDt);

  // player car lights
  if (G.car) {
    const night = sky.lampsOn ? 1 : 0, B = BODIES[G.def.body];
    const braking = state === "drive" && G.brk > .3;
    G.car.setLights(braking, !!G.sigL && G.sigOn, !!G.sigR && G.sigOn, sky.night);
    if (state === "drive" || state === "ready") {
      const cos = Math.cos(G.yaw), sin = Math.sin(G.yaw);
      const fwd = tmpV.set(-sin, 0, -cos);
      if (night) {
        playerLight.pos.set(G.x, B.hl[1] + .15, G.z).addScaledVector(fwd, B.L / 2 + .2);
        playerLight.dir.copy(fwd).setY(-.1).normalize();
        lights.push(playerLight);
      }
      for (const k of [-1, 1]) {
        const sx = G.x + cos * k * (B.W / 2 - .35), rz = G.z + B.L / 2 * cos, fz = G.z - B.L / 2 * cos;
        if (night || braking) glows.add(sx - sin * B.L / 2, B.tl[1], rz, 1, braking ? .12 : .04, .04, braking ? 1.6 : .7);
        if (night) glows.add(sx + sin * B.L / 2, B.hl[1], fz, 1, .96, .85, 1.6);
        if (G.sigOn && ((k < 0 && G.sigL) || (k > 0 && G.sigR))) { glows.add(sx - sin * B.L / 2, B.tl[1], rz + .02, 1, .55, .05, 1.1); glows.add(sx + sin * B.L / 2, B.hl[1], fz, 1, .55, .05, 1.1); }
      }
    }
  }

  updateCamera(dt);
  const focus = tmpV.set(G.x, 0, G.z).clone();
  sky.update(dt, camera, focus, state === "drive" ? G.dt.v : 0, audio);
  world.update(focus, sky, glows, lights, dt);
  sky.tunnel = world.tunnel;
  if (audio.ready) audio.setTunnel(state === "home" ? 0 : world.tunnel);
  traffic.update(simDt, T, G.z, sky.lampsOn, glows, lights, camera.position, state === "home" ? null : shieldHidden());
  const peerList = mode === "online" ? updateRemotes(T, dt) : null;
  if (!paused) updateCatchUp(simDt, peerList);
  uploadLights(lights, camera);
  glows.end(renderer.domElement.height);
  smoke.update(paused ? 0 : dt);
  updateEngineSound(dt);
  audio.update(state === "drive" && !paused ? G.dt.v * 3.6 : 0, sky.w.rain, G.scraping && state === "drive");
  if (audio.ready) audio.setReverb(.05 + cityAt(G.z) * .16);
  updateHud();

  // network
  if (mode === "online" && net.room && G.dt) {
    G.sendT -= dt;
    if (G.sendT <= 0) {
      G.sendT = 1 / (net.sendRate || NET.sendRate);
      const t = G.thrown, gp = G.car.group, d = G.dt;
      // Lean, high-rate packet: only what can't be derived. Engine audio is rebuilt on each client
      // from rpm/throttle/load/boost/gear, so no audio data is ever streamed.
      const s = {
        T: +T.toFixed(3), x: +G.x.toFixed(2), z: +G.z.toFixed(2), y: +(t ? t.pos.y : 0).toFixed(2),
        ry: +gp.rotation.y.toFixed(3), pitch: +gp.rotation.x.toFixed(3), roll: +gp.rotation.z.toFixed(3),
        w: Math.round(net.now()), rd: partyRound, vx: +G.vx.toFixed(2), v: +d.v.toFixed(2),
        rpm: Math.round(d.rpm), thr: +G.thr.toFixed(2), ld: +d.load.toFixed(2), g: d.gear, sh: d.shiftT > 0 ? 1 : 0,
        bo: Math.round((d.s.boostMax ? d.boost / d.s.boostMax : 0) * 100),
        brk: G.brk > .3 ? 1 : 0, sl: G.sigL && G.sigOn ? 1 : 0, sr: G.sigR && G.sigOn ? 1 : 0,
        cr: state !== "drive" ? 1 : 0, sc: Math.floor(G.score),
      };
      // identity + engine character: twice a second, and right away when something changes
      if ((G.cfgTick = (G.cfgTick || 0) - 1) <= 0 || G.cfgDirty) {
        G.cfgTick = 10; G.cfgDirty = 0;
        const tq = Math.round(T * 2) / 2; // a time both clients can hash at
        s.c = { car: G.def.id, col: carColor(G.def.id), md: P.settings.driveMode === "sport" ? 0 : 1, a: carAudio(G.def.id), tq, th: traffic.worldHash(tq) };
      }
      net.send({ t: "state", s });
    }
  }

  renderer.setClearColor(0x000000, 1);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.shadowMap.enabled = P.settings.shadows;
  renderer.render(scene, camera);
}

// ---------------- settings ----------------
function applySettings() {
  const s = P.settings;
  sky.hour = s.hour; sky.flow = s.flow; sky.setStyle(s.sky); sky.setWeather(s.weather);
  audio.vol = { master: s.volMaster, engine: s.volEngine, fx: s.volFx };
  audio.applyVolumes();
  resize();
  save();
}
setInterval(() => { if (sky.flow) { P.settings.hour = sky.hour; save(); ui.syncTime?.(sky.hour); } }, 2000);

// ---------------- garage engine preview ----------------
let paintTimer = 0, revVoice = null;
// rev only while the button is held: climbs to the limiter, lift-off burbles/flutter on release
const rev = { hold: false, rpm: 900, timer: null, spec: null, idleT: 0 };
async function revHold(sound, carId = P.equipped, on = true) {
  await audio.init();
  audio.vol = { master: P.settings.volMaster, engine: P.settings.volEngine, fx: P.settings.volFx, wind: P.settings.volWind };
  audio.applyVolumes();
  if (!revVoice) revVoice = audio.engine(sound);
  if (on) {
    revVoice.setProfile(sound);
    revVoice.tune(carAudio(carId), P.settings.driveMode);
    rev.spec = tunedSpec(carId, carTune(carId));
    if (!rev.timer) rev.rpm = rev.spec.idle;
  } else if (rev.hold) revVoice.event("lift", { rpm: rev.rpm, load: 1, release: 10, boost: 1, gear: 2 });
  rev.hold = on; rev.idleT = 0;
  if (!rev.timer && rev.spec) rev.timer = setInterval(revTick, 25);
}
function revTick() {
  const sp = rev.spec, dt = .025;
  rev.rpm += ((rev.hold ? sp.redline * 1.02 : sp.idle) - rev.rpm) * Math.min(1, dt * (rev.hold ? 3.4 : 2.6));
  if (rev.hold && rev.rpm >= sp.redline * .985) { rev.rpm -= sp.redline * .05; revVoice.event("limiter"); }
  const boostN = rev.hold ? Math.min(1, Math.max(0, (rev.rpm - 1600) / 2600)) : 0;
  revVoice.params({ rpm: rev.rpm, throttle: rev.hold ? 1 : 0, gain: .85, load: rev.hold ? .85 : 0, boostNorm: boostN, gear: 2, redline: sp.redline, warmth: 1 });
  if (!rev.hold && (rev.idleT += dt) > 3.5) { revVoice.params({ rpm: sp.idle, throttle: 0, gain: 0, load: 0 }); clearInterval(rev.timer); rev.timer = null; }
}
function revPreview(sound, carId) { revHold(sound, carId, true); setTimeout(() => revHold(sound, carId, false), 650); }

// ---------------- boot ----------------
const ui = new UI({
  net, audio, sky,
  thumbs: {},
  selectCar: setShowCar,
  paintCar: (id, hex) => {
    P.colors[id] = hex; save();
    if (showCarId === id) showCar.setColor(hex);
    clearTimeout(paintTimer);
    paintTimer = setTimeout(() => { Object.assign(ui.thumbs, makeThumbs([id])); if (state === "home") ui.renderHome(); }, 250);
  },
  revPreview,
  revHold,
  applyTune,
  play: (asMode) => { audio.init(); if (asMode === "online") partyDrive(); else { partyRound = 0; enterReady(asMode); } },
  revive, restart: () => { enterReady(mode); startDriving(); }, home: goHome,
  resume: () => togglePause(), applySettings,
  toggleGod: () => { G.god = !G.god; G.ghostT = G.god ? 1e9 : 0; return G.god; },
  state: () => state, mode: () => mode, revivesUsed: () => G.revives,
});
const clickStart = () => { if (state === "ready" && !(mode === "online" && partyRound)) startDriving(); };
canvas.addEventListener("pointerdown", clickStart);
document.getElementById("ready").addEventListener("pointerdown", clickStart);
// With the project's own server running, IT owns the wallet: purchases are reported for
// validation and its balance is authoritative. On static hosting there is no server and the wallet
// stays local to the browser.
walletHooks.buy = (kind, id) => net.send({ t: "buy", kind, id });
net.addEventListener("wallet", (e) => {
  const m = e.detail;
  if (typeof m.coins === "number" && m.coins !== P.coins) { P.coins = m.coins; save(); ui.renderTop(); if (!document.getElementById("tune").hidden) ui.renderTune(); }
  if (m.denied) ui.toast(`Purchase refused by the server — ${m.reason}`);
});
net.addEventListener("chat", (e) => ui.chat(e.detail.name, e.detail.text));
net.addEventListener("event", (e) => {
  const m = e.detail;
  if (m.kind === "crash") ui.toast(`💥 ${m.name} crashed at ${m.v.toLocaleString()}`);
  if (m.kind === "combo") ui.toast(`🔥 ${m.name} is on a x${m.v} close-call streak`);
  if (m.kind === "bump" && m.d) {
    const [key, vx, vr, tt] = String(m.d).split("|");
    traffic.bumpRemote(key, m.v, { vx: +vx || 0, vr: +vr || 0 }, Math.max(0, getT() - (+tt || 0)));
  }
});

applySettings();
await loadModels();
sky.update(0.016, camera, new THREE.Vector3(), 0);
world.update(new THREE.Vector3(), sky, glows, lights, 1);
setShowCar(P.equipped);
ui.show("home");
ui.renderHome();
net.connect(P.name, P.equipped);
requestAnimationFrame(frame);

window.__ui = ui;
window.__game = {
  G, sky, traffic, net, world, renderer, scene, camera, glows, frame, remotes, NET, CATCHUP,
  get state() { return state; }, get mode() { return mode; },
  // quick sync check: two clients in the same party must print the same numbers
  trafficHash: () => traffic.stateHash(getT(), G.z),
  worldHash: (T) => traffic.worldHash(T ?? Math.round(getT() * 2) / 2),
  syncStats: () => ({ ok: syncOk, bad: syncBad }),
};

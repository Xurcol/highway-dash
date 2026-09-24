import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SkySystem, TIME_PRESETS, SKY_STYLES, WEATHERS } from "./sky.js";
import { World, laneX, ROAD_HALF, SHOULDER, cityAt } from "./world.js";
import { Traffic, EV_TYPES } from "./traffic.js";
import { CARS, BODIES, specOf, DetailedCar } from "./cars.js";
import { Drivetrain } from "./vehicle.js";
import { AudioManager } from "./audio.js";
import { Glows, uploadLights, lampUniforms, setLampBudget } from "./lights.js";
import { Flames } from "./flames.js";
import { createNet, RemoteView, NET } from "./net.js";
import { carStyle } from "./profile.js";
import { P, save, carById, carColor, carSound, carTune, carAudio, earn, walletHooks, MEDALS, addXp, medalCount } from "./profile.js";
import { burbleIntensity } from "./engine-dsp.js";
import { runReward } from "./economy.js";
import { tunedSpec, peakHp, PARTS } from "./tuning.js";
import { UI } from "./ui.js";
import { dailyTrack, dailyBest, dailyFlush, dailyHooks } from "./daily.js";
import { signIn } from "./auth.js";
import { youtubeAPI } from "./media.js";
import { City } from "./city.js";
import { loadModels, makeCar, ensureModel, hasModel, MODELS, missingModels, downloadModels } from "./models.js";

// ---------------- renderer / scenes ----------------
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = true;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4000);
const sky = new SkySystem(renderer, scene);
const world = new World(renderer, scene);
const traffic = new Traffic(scene);
const city = new City(renderer, scene);   // City Drive: built the first time the mode is opened
const glows = new Glows(scene, 2600);
// exhaust flames on the road (yours and other drivers'); the garage turntable has its own set
const flames = new Flames(scene), playerFlame = flames.emitter();
// Point sprites are sized in pixels, so they need the camera's pixels-per-metre: this matches the
// glow sprites' .9 x height at the game camera's 62 degrees, and scales for any other lens.
const pxScale = (hPx, cam) => hPx * .54 / Math.tan(cam.fov * Math.PI / 360);
// a daily challenge finished mid-drive: say so, and pay (daily.js already credited it)
dailyHooks.onComplete = (c, all) => {
  audio.coin();
  ui.toast(`Daily done: ${c.text} · +${c.reward.coins.toLocaleString()} coins`, [], "success");
  if (all) ui.toast("All three dailies done! +1,500 bonus coins", [], "success");
  ui.renderTop();
};
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

// adaptive resolution: renders a little softer when the frame rate dips and sharpens again when there is headroom
let resScale = 1, emaDt = .016, resTick = 0;
function adaptRes(dt) {
  emaDt += (dt - emaDt) * .05;
  if (++resTick < 90) return;
  resTick = 0;
  if (emaDt > .024 && resScale > .6) { resScale = Math.max(.6, resScale - .1); resize(); }
  else if (emaDt < .0175 && resScale < 1) { resScale = Math.min(1, resScale + .05); resize(); }
}
// ---------------- post-processing ----------------
// One HDR pass with bloom on top. The scene renders linear into a half-float target, bloom picks
// out anything above the threshold, and OutputPass does the ACES tone map and the sRGB convert at
// the end - so tone mapping happens once, after the glow is added, not before it.
// UnrealBloomPass thresholds the LINEAR HDR buffer, not the tone-mapped picture. A normally
// exposed sky already sits well above 1.0 there, so the usual sub-1 threshold catches everything:
// at .82 it was lifting 44% of the frame. 2.0 keeps the glow on things that actually emit.
// Threshold was tuned against a daylit scene. At night the lamp heads, windows and neon are all
// driven much brighter AND the exposure is lifted, so far more of the frame cleared the old bar and
// every street light smeared into a blob. Measured on a night city frame, the old settings added
// 2.8 points of mid-bright pixels over no bloom; these add 1.4, which is where the curve flattens.
const BLOOM = { strength: .42, radius: .4, threshold: 3.0 };
// and it comes down further as the sun goes, because that is when the count of bright sources jumps
const bloomNightFalloff = (night) => 1 - night * .3;
let composer = null, bloomPass = null;
async function initPost() {
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
    import("three/addons/postprocessing/EffectComposer.js"),
    import("three/addons/postprocessing/RenderPass.js"),
    import("three/addons/postprocessing/UnrealBloomPass.js"),
    import("three/addons/postprocessing/OutputPass.js"),
  ]);
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  resize();
}
initPost().catch((e) => console.warn("post-processing unavailable, falling back to a direct render", e));
const bloomOn = () => !!(composer && P.settings.bloom);

function resize() {
  // A tab that is still laying out reports innerWidth 0. Sizing the drawing buffer to that leaves a
  // 0x0 canvas, and anything that later reads pixels out of it (the garage thumbnails) throws.
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  renderer.setPixelRatio(Math.min(2.5, Math.min(2, devicePixelRatio) * P.settings.res) * resScale);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
}
addEventListener("resize", resize);
resize();

// showroom (garage preview + thumbnails)
const show = new THREE.Scene();
const showCam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
// the showroom draws straight to the screen with no bloom or HDR buffer, so the flames go in dimmer
// there or every colour clips to white
const showFlames = new Flames(show, 400), showFlame = showFlames.emitter();
let showFlamePreview = null;   // { id, flame } while a flame colour is being previewed in the style panel
showFlames.gain = .35;
{
  const pm = new THREE.PMREMGenerator(renderer);
  show.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  show.environmentIntensity = 0.42;
  show.add(new THREE.HemisphereLight(0xc8d6ff, 0x14171c, 0.3));
  const key = new THREE.DirectionalLight(0xfff2e0, 1.15); key.position.set(4, 8, 5); key.castShadow = true;
  const rim = new THREE.DirectionalLight(0x8fb4ff, .55); rim.position.set(-6, 4.5, -7);
  const fill = new THREE.DirectionalLight(0xffd9b0, .16); fill.position.set(-3, .8, 6);
  show.add(rim, fill);
  show.background = (() => {
    const c = document.createElement("canvas"); c.width = 4; c.height = 256;
    const g = c.getContext("2d"), grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, "#212734"); grd.addColorStop(.55, "#161a22"); grd.addColorStop(1, "#0d0f14");
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = .02; Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 });
  show.add(key);
}
const showDeco = new THREE.Group();
show.add(showDeco);
{
  const M = (c, r = .8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), M(0x15181d, .95)); floor.receiveShadow = true;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, .08, 64), M(0x5c6169, .45, .5)); disc.position.y = .04; disc.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.45, .05, 8, 64).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffb020 })); ring.position.y = .09;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(40, 10, .5), M(0x1a1e25, .96)); wall.position.set(0, 5, -9);
  const wall2 = wall.clone(); wall2.rotation.y = Math.PI / 2; wall2.position.set(-9, 5, 0);
  const stripeTex = (() => { const c = document.createElement("canvas"); c.width = 256; c.height = 32; const g = c.getContext("2d");
    for (let i = -2; i < 20; i++) { g.fillStyle = i % 2 ? "#1b1b1b" : "#f0c020"; g.beginPath(); g.moveTo(i * 20, 32); g.lineTo(i * 20 + 20, 32); g.lineTo(i * 20 + 36, 0); g.lineTo(i * 20 + 16, 0); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.x = 8; return t; })();
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(40, .8, .1), new THREE.MeshStandardMaterial({ map: stripeTex })); stripe.position.set(0, 8.6, -8.7);
  showDeco.add(floor, disc, ring, wall, wall2, stripe);
  const crateM = M(0x3c3a36, .95);
  [[-5.5, 0, -6.5, 1.6], [-4, 0, -7, 1.2], [-5.2, 1.6, -6.6, 1.1], [5.5, 0, -7, 1.5], [6.5, 0, -5.5, 1.1], [-7, 0, -3, 1.4]].forEach(([x, y, z, s]) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateM); c.position.set(x, y + s / 2, z); c.rotation.y = x * .3; c.castShadow = c.receiveShadow = true; showDeco.add(c);
  });
}
const DISC_TOP = .085;   // top face of the turntable: cars stand on this, not on y = 0
let showCar = null, showCarId = null, showSpin = -0.6, dragging = false;
// showCarId is the car the garage is SHOWING OR ABOUT TO SHOW (paint and style edits go to it);
// shownId is the one actually on the turntable. They differ for the moment a newly picked car's
// shaders are compiling in the background.
let shownId = null, pendingShow = null;
// Picking a car used to freeze the game for up to a second. Measured: building the car takes ~5 ms and
// parsing its model ~100 ms, but the first frame that draws it had to compile 3-8 shader programs on the
// main thread (~300-600 ms), and every switch paid it again because the previous car's materials - and
// with them its shaders - were thrown away. Now the new car's shaders compile in the background
// (renderer.compileAsync uses KHR_parallel_shader_compile) while the old car stays on the turntable,
// and the two are swapped once the new one can be drawn without stalling.
function setShowCar(id) {
  if (showCarId === id) return;
  showCarId = id;
  if (pendingShow) { pendingShow.car?.dispose(); pendingShow = null; }   // superseded by a newer click
  const build = () => {
    const car = makeCar(id, carColor(id));
    car.applyStyle?.(carStyle(id));
    car.group.traverse((o) => (o.castShadow = true));
    car.group.position.y = DISC_TOP;
    return car;
  };
  const swapIn = (car) => {
    if (showCar) { show.remove(showCar.group); showCar.dispose(); }
    showCar = car; shownId = id; show.add(car.group);
  };
  if (!showCar) return swapIn(build());   // the very first car has nothing to stand in for it
  // the old car stays on the turntable until the new one is loaded AND its shaders are ready
  const p = pendingShow = { car: null };
  (hasModel(id) && !MODELS[id] ? ensureModel(id) : Promise.resolve(true)).then(() => {
    if (pendingShow !== p) return;
    // the picture is normally cached already; re-rendering it compiled a second full set of
    // shaders (the thumbnail setup lights the car differently) for a picture nobody needed
    if (hasModel(id) && MODELS[id] && !thumbCache.get(id)) { Object.assign(ui.thumbs, makeThumbs([id])); if (state === "home") ui.renderHome(); }
    p.car = build();
    return warmCar(p.car, showCam, show).then(() => {
      if (pendingShow !== p) return;     // a later click replaced it (and disposed it)
      pendingShow = null;
      swapIn(p.car);
    });
  });
}
// Gets a car ready to be drawn without stalling: shaders compile in the background, then its textures
// go up to the GPU one per tick (uploading a freshly loaded model's 13-30 textures in the first frame
// that draws it was the last ~100-200 ms hitch).
async function warmCar(car, cam, target) {
  await renderer.compileAsync(car.group, cam, target).catch(() => {});
  const seen = new Set();
  car.group.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) for (const k of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap"]) if (m[k]) seen.add(m[k]); });
  for (const t of seen) { renderer.initTexture(t); await new Promise((res) => setTimeout(res, 0)); }
}
// the garage car edits should go to: the one about to appear if a switch is in flight
const showTarget = () => pendingShow?.car || showCar;
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
const SHOW_EXPOSURE = 1.0;
function renderShowroom(rect) {
  const saved = lampUniforms.lampCount.value;
  const savedExposure = renderer.toneMappingExposure;
  renderer.toneMappingExposure = SHOW_EXPOSURE;
  lampUniforms.lampCount.value = 0;
  renderer.setScissorTest(true);
  const y = innerHeight - rect.bottom;
  renderer.setViewport(rect.left, y, rect.width, rect.height);
  renderer.setScissor(rect.left, y, rect.width, rect.height);
  renderer.setClearColor(0x181c22, 1);
  renderer.clear();
  renderer.render(show, showCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  lampUniforms.lampCount.value = saved;
  renderer.toneMappingExposure = savedExposure;
}

// ---------------- custom camera preview ----------------
// The camera editor shows what the camera it is building would see: the garage car on a stretch of
// road with a few cars ahead of it, drawn from the camera's own position, height, tilt and field
// of view. It is rendered into an offscreen target and copied into a plain 2D canvas in the editor,
// rather than drawn into the main canvas, because the editor is a modal with a blurred backdrop and
// anything drawn behind it would just be smeared into the background.
const previewCam = new THREE.PerspectiveCamera(60, 16 / 9, .1, 500);
let previewRig = null, previewSky = null, previewRT = null, previewBuf = null, previewImg = null;
function buildPreviewRig() {
  previewRig = new THREE.Group(); previewRig.visible = false;
  // asphalt, laid out exactly like the game's road so the lanes line up with the numbers in the editor
  const c = document.createElement("canvas"); c.width = 256; c.height = 512;
  const g = c.getContext("2d"), pxm = 256 / 23, pyz = 512 / 46;
  g.fillStyle = "#2d3138"; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 2600; i++) { const v = 34 + Math.random() * 26; g.fillStyle = "rgba(" + v + "," + v + "," + (v + 6) + ",.5)"; g.fillRect(Math.random() * 256, Math.random() * 512, 2, 2); }
  g.fillStyle = "#e6b829"; g.fillRect((1.5 - .08) * pxm, 0, .16 * pxm, 512);
  g.fillStyle = "#e8e9e4"; g.fillRect((21.5 - .08) * pxm, 0, .16 * pxm, 512);
  for (let l = 1; l < 5; l++) for (let z0 = 0; z0 < 46; z0 += 12) g.fillRect((1.5 + l * 4 - .08) * pxm, (z0 + 1) * pyz, .16 * pxm, 3 * pyz);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(1, 500 / 46);
  tex.anisotropy = 8;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(23, 500).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: .92 }));
  road.position.set(0, .002, -230); road.receiveShadow = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a9a62, roughness: 1 }));
  ground.position.y = -.03;
  previewRig.add(ground, road);
  // some traffic ahead, so distance reads as distance
  const cols = [0xc62828, 0x1e5bd8, 0xe8e6df, 0x2b2f36, 0xf2c230, 0x2e7d4f];
  [[-8, -20], [4, -26], [-4, -38], [8, -46], [0, -58], [-8, -74], [4, -90], [-4, -110]].forEach(([x, z], i) => {
    const car = new THREE.Group(), col = cols[i % cols.length];
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, .7, 4.6), new THREE.MeshStandardMaterial({ color: col, roughness: .4, metalness: .3 }));
    body.position.y = .62;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, .55, 2.3), new THREE.MeshStandardMaterial({ color: 0x1a222c, roughness: .25, metalness: .4 }));
    cab.position.set(0, 1.2, .1);
    car.add(body, cab); car.position.set(x, 0, z); car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    previewRig.add(car);
  });
  show.add(previewRig);
  // daylight sky and a hazy horizon
  const sc = document.createElement("canvas"); sc.width = 4; sc.height = 256;
  const sg = sc.getContext("2d"), grd = sg.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#4f86cf"); grd.addColorStop(.55, "#9fc3e6"); grd.addColorStop(.62, "#d6e4ee"); grd.addColorStop(.63, "#8a9a62"); grd.addColorStop(1, "#6d7d4a");
  sg.fillStyle = grd; sg.fillRect(0, 0, 4, 256);
  previewSky = new THREE.CanvasTexture(sc); previewSky.colorSpace = THREE.SRGBColorSpace;
}
// Draws the preview for cam = { dist, height, pitch, fov } into a 2D canvas. Returns false when
// there is no car in the garage yet to point the camera at.
function renderCamPreview(canvas, cam) {
  if (!canvas || !showCar || !showCarId) return false;
  const w = canvas.width, h = canvas.height;
  if (!previewRig) buildPreviewRig();
  if (!previewRT || previewRT.width !== w || previewRT.height !== h) {
    previewRT?.dispose();
    previewRT = new THREE.WebGLRenderTarget(w, h, { samples: 4 });
    previewRT.texture.colorSpace = THREE.SRGBColorSpace;
    previewBuf = new Uint8Array(w * h * 4); previewImg = new ImageData(w, h);
  }
  const car = showCar.group;
  const saved = { rot: car.rotation.y, y: car.position.y, bg: show.background, deco: showDeco.visible, lamps: lampUniforms.lampCount.value };
  showDeco.visible = false; previewRig.visible = true; show.background = previewSky;
  car.rotation.y = 0; car.position.y = 0;                 // facing down the road, on the road
  lampUniforms.lampCount.value = 0;
  // the same numbers the game camera uses: sits dist behind and height above the car, and looks at a
  // point 30m ahead that is pitch degrees lower than the camera
  previewCam.aspect = w / h; previewCam.fov = cam.fov;
  previewCam.position.set(0, cam.height, cam.dist);
  previewCam.lookAt(0, customLookY(cam), -30);
  previewCam.updateProjectionMatrix(); previewCam.updateMatrixWorld();
  renderer.setRenderTarget(previewRT);
  renderer.render(show, previewCam);
  renderer.setRenderTarget(null);
  renderer.readRenderTargetPixels(previewRT, 0, 0, w, h, previewBuf);
  // put everything back exactly as it was, so the garage never notices
  car.rotation.y = saved.rot; car.position.y = saved.y; show.background = saved.bg;
  showDeco.visible = saved.deco; previewRig.visible = false; lampUniforms.lampCount.value = saved.lamps;
  // a render target is stored bottom-up; a canvas is top-down
  const row = w * 4;
  for (let y = 0; y < h; y++) previewImg.data.set(previewBuf.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  canvas.getContext("2d").putImageData(previewImg, 0, 0);
  return true;
}

function makeThumbs(ids = CARS.map((c) => c.id)) {
  const out = {}, w = 240, h = 130, pr = renderer.getPixelRatio();
  if (canvas.width < w * pr || canvas.height < h * pr) return out;   // window not sized yet
  const c2 = document.createElement("canvas"); c2.width = w * 2; c2.height = h * 2;
  const g = c2.getContext("2d");
  showDeco.visible = false;
  if (showCar) showCar.group.visible = false; // the garage car must not appear in every thumbnail
  const saved = lampUniforms.lampCount.value; lampUniforms.lampCount.value = 0;
  for (const def of CARS.filter((c) => ids.includes(c.id))) {
    const car = makeCar(def.id, carColor(def.id));
    car.applyStyle?.(carStyle(def.id));
    show.add(car.group);
    frameShowCam(def.body, w / h, .35);
    showCam.position.multiplyScalar(.82); showCam.lookAt(0, .7, 0);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
    renderer.setClearColor(0x161920, 1); renderer.clear();
    renderer.render(show, showCam);
    g.fillStyle = "#161920"; g.fillRect(0, 0, c2.width, c2.height);
    g.drawImage(canvas, 0, canvas.height - h * pr, w * pr, h * pr, 0, 0, c2.width, c2.height);
    out[def.id] = c2.toDataURL("image/jpeg", .85);
    if (MODELS[def.id]) thumbCache.put(def.id, out[def.id]);
    show.remove(car.group); car.dispose();
  }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  lampUniforms.lampCount.value = saved;
  showDeco.visible = true;
  if (showCar) showCar.group.visible = true;
  return out;
}

// Garage pictures of the real models, stored per car + paint + style so they are only redrawn when
// the car's look changes.
const thumbCache = {
  sig: (id) => `${carColor(id)}|${JSON.stringify(carStyle(id))}`,
  read() { try { return JSON.parse(localStorage.getItem("hd_thumbs2") || "{}"); } catch { return {}; } },
  get(id) { const e = this.read()[id]; return e && e.sig === this.sig(id) ? e.url : null; },
  all() { const r = this.read(), o = {}; for (const [id, e] of Object.entries(r)) if (e.sig === this.sig(id)) o[id] = e.url; return o; },
  put(id, url) { const r = this.read(); r[id] = { sig: this.sig(id), url }; try { localStorage.setItem("hd_thumbs2", JSON.stringify(r)); } catch { } },
};
// First visit: download every car once (with a progress screen), then draw each one's garage picture.
// ---------------- startup screen ----------------
// One screen for the whole boot, not just first-timers: it is already on screen in the markup, so the
// menu is never visible half-built, and it reports whichever stage is actually running.
const LOADER_TIPS = [
  "Hold SPACE to swing the camera round and look back down the road.",
  "Q and E work the gear lever — N and D, even in automatic.",
  "Press M to switch between automatic and manual shifting.",
  "Threading a gap at speed pays a close-call bonus. Chain them for a combo.",
  "The closer the pass, the bigger the bonus: under a foot of air is INSANE.",
  "Split two cars at once to thread the needle, or dodge a car changing lanes for a bonus.",
  "Hold S against full W while rolling to trigger anti-lag: the revs bounce off the limiter and the car holds its speed.",
  "C cycles the cameras: chase, far, hood and bumper.",
  "Every car in the garage has its own engine, gearbox and tuning options.",
];
const loader = (() => {
  const el = document.getElementById("loader");
  const bar = document.getElementById("loaderBar"), barBox = bar.parentElement;
  const title = document.getElementById("loaderTitle"), sub = document.getElementById("loaderSub");
  const tip = document.getElementById("loaderTip");
  let tipTimer = 0;
  const showTip = () => { tip.textContent = LOADER_TIPS[(Math.random() * LOADER_TIPS.length) | 0]; };
  showTip();
  tipTimer = setInterval(showTip, 4200);
  document.getElementById("loaderVer").textContent = (document.documentElement.dataset.ver || "dev") + " build";
  // The loading music, looping for as long as the screen is up. Browsers only allow sound after the
  // player has interacted with the page, so if the first try is refused it starts on the first click
  // or key press instead. Missing files (the public build ships without them) just mean no music/video.
  const video = document.getElementById("loaderVideo");
  // the website version ships without the clip and song files: it plays the clip from YouTube instead
  const videoMissing = () => { if (video.hidden) return; video.hidden = true; startYouTube(); };
  video.addEventListener("error", videoMissing);
  const SONG_VOL = .55;
  let songLevel = SONG_VOL;                    // where the song sits now (the account screen ducks it)
  // ---- the website version: the clip from YouTube ----
  // The website ships without the clip file, so the clip comes from YouTube through its own embedded
  // player: it covers the screen under the scrim and jumps back to its start just before the end so
  // its end screen never shows. It is muted until the first click or key press (browsers allow no
  // sound before one); then its own sound is the loading music, ducked on the sign-in screen and faded
  // out with everything else, like the song file locally. If YouTube can't play it, the screen stays.
  const BG_ID = "zYCtcTwk4bw";            // Yeat - EARNËD IT (official music video)
  const ytPlayer = (slot, videoId, playerVars, events) => youtubeAPI().then((YT) => new YT.Player(slot, {
    videoId, host: "https://www.youtube-nocookie.com", events,
    playerVars: { controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, rel: 0, playsinline: 1, modestbranding: 1, ...playerVars },
  }));
  let bg = null, bgHost = null, bgLoop = 0, bgVol = SONG_VOL, heard = false;
  function startYouTube() {
    if (bgHost) return;
    bgHost = document.createElement("div"); bgHost.className = "loader-yt";
    const slot = document.createElement("div"); bgHost.appendChild(slot);
    video.after(bgHost);
    ytPlayer(slot, BG_ID, { autoplay: 1, mute: 1 }, {
      onReady: (e) => {
        bg = e.target; bg.mute(); bg.playVideo();
        if (heard) bgSong.play().catch(() => { });
        bgLoop = setInterval(() => { const d = bg?.getDuration?.() || 0, t = bg?.getCurrentTime?.() || 0; if (d > 1 && t > d - .35) bg.seekTo(0, true); }, 100);
      },
      onStateChange: (e) => { if (e.data === 0) { e.target.seekTo(0, true); e.target.playVideo(); } },
      onError: stopYouTube,
    }).catch(stopYouTube);
  }
  function stopYouTube() { clearInterval(bgLoop); try { bg?.destroy(); } catch { /* already gone */ } bgHost?.remove(); bgHost = null; bg = null; }
  // the clip's sound standing in for the song file: the same play / pause / volume / release the loader uses
  const bgSong = {
    get paused() { return !heard; },
    get volume() { return bgVol; },
    set volume(v) { bgVol = v; if (bg && heard) bg.setVolume(Math.round(v * 100)); },
    play() {
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return Promise.reject(new DOMException("needs a gesture", "NotAllowedError"));
      heard = true;
      if (bg) { bg.unMute(); bg.setVolume(Math.round(bgVol * 100)); bg.playVideo(); }
      return Promise.resolve();
    },
    pause() { bg?.pauseVideo(); },
    removeAttribute() { stopYouTube(); },
    load() {},
  };
  // the local build's own song (loader-media/song.mp3); the website version ships without it and uses the clip's sound
  let song = new Audio("loader-media/song.mp3");
  song.loop = true; song.preload = "auto"; song.volume = SONG_VOL;
  song.addEventListener("error", () => { song = bgSong; });
  const startSong = () => { if (!song) return; song.volume = songLevel; song.play().then(() => { if (video.paused) video.play().catch(() => { }); }).catch(() => { }); };
  const onGesture = () => startSong();
  const gestures = ["pointerdown", "keydown", "touchstart"];
  song.play().catch(() => gestures.forEach((ev) => addEventListener(ev, onGesture, { once: true, capture: true })));
  // A time-based fade (not requestAnimationFrame, which a background tab pauses), on an ease-out
  // curve so the tail doesn't drop off a cliff. It only touches the volume, so it is the same smooth
  // fade wherever the looping song happens to be.
  const fadeSong = (to, ms) => new Promise((resolve) => {
    songLevel = to;
    if (!song || song.paused) { if (song) song.volume = to; return resolve(); }
    const v0 = song.volume, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      song.volume = to + (v0 - to) * Math.pow(Math.cos(k * Math.PI / 2), 1.6);
      if (k < 1) setTimeout(step, 16); else { song.volume = to; resolve(); }
    };
    step();
  });
  // The <video> starts fetching as soon as the page is parsed, so on the website its "not found" can
  // come before this code runs and the error event is long gone: check for that too.
  if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) videoMissing();
  // everything stopped and released once the screen is gone
  const unload = () => {
    if (song) { song.pause(); song.removeAttribute("src"); song.load(); song = null; }
    video.pause(); video.removeAttribute("src"); video.load(); video.remove();
    stopYouTube();
  };
  return {
    // The account screen: the loading panel steps aside, the video keeps playing, the song drops to a
    // fifth of its level, and this resolves once someone has signed in.
    async signIn() {
      this.stage("Ready", "", 1);
      clearInterval(tipTimer);
      document.querySelector(".loader-box").classList.add("away");
      el.classList.add("signing");
      // no clip to play behind the card (the public build ships none): the screen turns see-through
      // and the real garage - the car turning on its stand - becomes the background, under a blur
      if (video.hidden && !bgHost) el.classList.add("live");
      fadeSong(SONG_VOL * .2, 900);
      await signIn();
    },
    // progress 0..1, or null when there is nothing real to measure (the bar sweeps instead of lying)
    stage(text, detail = "", progress = null) {
      title.textContent = text;
      sub.textContent = detail;
      barBox.classList.toggle("idle", progress === null);
      if (progress !== null) bar.style.width = (Math.max(0, Math.min(1, progress)) * 100).toFixed(1) + "%";
    },
    // Lets the browser paint between stages so the status text actually changes on screen. It races
    // a timer against the frame callback on purpose: a background tab suspends requestAnimationFrame
    // entirely, and waiting on it alone would leave the game stuck on the loading screen forever.
    breathe: () => new Promise((r) => {
      let done = false;
      const go = () => { if (!done) { done = true; r(); } };
      requestAnimationFrame(() => setTimeout(go, 0));
      setTimeout(go, 60);
    }),
    // The exit: the song fades out over 2.4 s while the screen - clip, scrim and text together -
    // fades over 3 s onto the garage, which is already drawn behind it. So the music is silent before
    // the screen is gone, and there is never a black frame between the two.
    async finish() {
      clearInterval(tipTimer);
      gestures.forEach((ev) => removeEventListener(ev, onGesture, { capture: true }));
      el.classList.add("out");
      const faded = fadeSong(0, 2400);
      setTimeout(async () => { await faded; el.hidden = true; unload(); }, 3050);
    },
  };
})();
// Downloads every car once and pre-renders its garage picture. Both stages report real progress.
async function loadCarAssets() {
  const missing = await missingModels();
  const needThumbs = CARS.filter((c) => hasModel(c.id) && !thumbCache.get(c.id)).map((c) => c.id);
  if (missing.length) {
    loader.stage("Downloading cars", "Starting…", 0);
    await downloadModels(missing, (b, t, f, n) => {
      loader.stage("Downloading cars", `${(b / 1e6).toFixed(0)} / ${(t / 1e6).toFixed(0)} MB · car ${Math.min(n, f + 1)} of ${n}`, b / Math.max(1, t));
    });
  }
  if (!needThumbs.length) return;
  for (let i = 0; i < needThumbs.length; i++) {
    loader.stage("Preparing garage", `${carById(needThumbs[i]).name} (${i + 1} of ${needThumbs.length})`, i / needThumbs.length);
    await loader.breathe();
    // one bad picture is not worth failing the whole startup over - the frame loop redraws it later
    try { if (await ensureModel(needThumbs[i])) makeThumbs([needThumbs[i]]); }
    catch (e) { console.warn("thumbnail failed", needThumbs[i], e); }
  }
}

// ---------------- input ----------------
const keys = {};
const typing = () => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) && document.activeElement.type !== "range" && document.activeElement.type !== "checkbox";
// Rebindable keys. The game reads fixed "logical" codes (KeyH, KeyE ...); the player's choices map a
// physical key onto the logical one, so nothing else in the game has to know about rebinding.
const KEY_ACTIONS = { KeyN: "Sport / comfort", KeyH: "Horn", KeyE: "Shift up", KeyQ: "Shift down", KeyM: "Manual / automatic", KeyC: "Camera", Space: "Look back", KeyT: "Next time of day", KeyV: "Next sky", KeyB: "Next weather", KeyP: "Pause", KeyR: "Restart", KeyZ: "Left signal", KeyX: "Right signal", KeyL: "Leaderboard" };
const keyOf = (act) => P.settings.binds?.[act] || act;
const logicalKey = (phys) => {
  const b = P.settings.binds; if (!b) return phys;
  for (const act in b) if (b[act] === phys) return act;
  return act_isRebound(phys) ? null : phys;   // a default key that now belongs to another action does nothing
};
const act_isRebound = (phys) => !!P.settings.binds?.[phys] && P.settings.binds[phys] !== phys;
addEventListener("keydown", (e) => {
  if (typing()) {
    if (e.code === "Enter" && document.activeElement.id === "chatInput") sendChat();
    if (e.code === "Escape") { if (document.activeElement.id === "chatInput") closeChat(); else document.activeElement.blur(); }
    return;
  }
  const code = logicalKey(e.code);
  if (!code) return;
  if (e.repeat) { keys[code] = true; return; }
  keys[code] = true;
  onKey(code);
  if (["Space", "ArrowUp", "ArrowDown"].includes(e.code) || (e.code === "Tab" && state !== "home" && !ui.anyModalOpen() && !typing())) e.preventDefault();
});
addEventListener("keyup", (e) => {
  const code = logicalKey(e.code);
  if (!code) return;
  keys[code] = false;
  if (code === "KeyH") audio.horn(false);
});
addEventListener("blur", () => { for (const k in keys) keys[k] = false; audio.horn(false); });
// no browser context menu on the game (text fields keep theirs so paste still works)
addEventListener("contextmenu", (e) => { if (!["INPUT", "TEXTAREA"].includes(e.target?.tagName)) e.preventDefault(); });
const held = (...codes) => codes.some((c) => keys[c]);

// N switches every car between Sport (valves open, burbles and pops) and Comfort (valves shut, no
// burbles, quieter, early relaxed upshifts). Anything else in an old save means Sport.
if (P.settings.driveMode !== "comfort") P.settings.driveMode = "sport";
// ---------------- game state ----------------
let state = "home";       // home | ready | drive | crashed | over
let paused = false;
let mode = "solo";        // solo | online
let soloT = 0;
// Game modes. Solo: classic (one life), freedrive (no run to lose - just drive), city (City Drive: free
// roam in 3D - downtown, the ring expressway and its ramps), police (outrun the cops), timeattack
// (2 minutes, crashes cost score).
// Party: crash (first crash ends the round), target (first to a score), timed (highest score when time's up).
const SOLO_MODES = { classic: "Classic", freedrive: "Free Drive", city: "City Drive", police: "Police Chase", timeattack: "Time Attack" };
const PARTY_MODES = { free: "Free Drive", city: "City Drive", crash: "Last One Standing", target: "First To Score", timed: "Timed Battle" };
const TIME_ATTACK = 120;
const soloMode = () => (SOLO_MODES[P.settings.soloMode] ? P.settings.soloMode : "classic");
const partyMode = () => (mode === "online" && net.room ? net.room.mode || "crash" : null);
// crashes respawn you (with a score penalty) instead of ending the run in these modes
const respawnMode = () => (mode === "online" ? partyMode() !== "crash" : soloMode() === "timeattack" || soloMode() === "freedrive" || soloMode() === "city");
// Free Drive, solo or in a server: no rounds, no finish, crashes cost nothing
const freeMode = () => (mode === "online" ? partyMode() === "free" || partyMode() === "city" : mode === "solo" && (soloMode() === "freedrive" || soloMode() === "city"));
// City Drive: the 3D city instead of the endless highway. Latched into G.city when a session starts, so
// nothing can switch worlds under a car mid-drive.
const cityMode = () => (mode === "online" ? partyMode() === "city" : soloMode() === "city");
const inCity = () => state !== "home" && !!G.city;
// how many cars the city keeps around you, by the traffic setting
const CITY_TRAFFIC = { Chill: 28, Normal: 40, Heavy: 52, Insane: 70 };
// chase / far / hood / bumper - the drive camera, cycled with C and remembered between sessions
const CAMS = ["CHASE CAM", "FAR CHASE", "HOOD CAM", "BUMPER CAM", "CUSTOM CAM"];
const CUSTOM_CAM = 4;
const customLookY = (cc) => cc.height - Math.tan(cc.pitch * Math.PI / 180) * (cc.dist + 30);
// The camera the player builds in the editor: how far behind, how high, how far it tips down, and
// how wide it sees. Clamped on the way out, so a stale or hand-edited save cannot put it underground.
const customCam = () => {
  const c = P.settings.customCam || {};
  return {
    dist: Math.min(22, Math.max(3, +c.dist || 9)), height: Math.min(9, Math.max(.8, +c.height || 3.4)),
    pitch: Math.min(14, Math.max(-8, c.pitch ?? 4)), fov: Math.min(100, Math.max(40, +c.fov || 60)),
  };
};
let camMode = Math.min(CAMS.length - 1, Math.max(0, P.settings.cam | 0));
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
  G.audioCfg = null;   // the burble model reads this, so drop it when the tune changes
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
    G.dt.drive = s.drive;          // an AWD conversion changes which wheels the Drivetrain drives
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
// prebuilt: a car whose shaders were already compiled in the background (see switchCar)
function buildPlayerCar(prebuilt = null) {
  if (G.car) { scene.remove(G.car.group); G.car.dispose(); }
  G.def = carById(P.equipped);
  G.car = prebuilt || makeCar(G.def.id, carColor(G.def.id));
  if (!prebuilt) G.car.applyStyle?.(carStyle(G.def.id));
  scene.add(G.car.group);
  G.dt = makeDrivetrain();
  G.cfgDirty = 1;
  if (G.engine) G.engine.setProfile(carSound(G.def.id));
  const id = G.def.id;
  if (hasModel(id) && !MODELS[id]) ensureModel(id).then((ok) => {
    if (!ok || G.def.id !== id || !G.car || G.car.isModel) return;
    const old = G.car;
    G.car = makeCar(id, carColor(id)); G.car.applyStyle?.(carStyle(id));
    G.car.group.position.copy(old.group.position); G.car.group.rotation.copy(old.group.rotation);
    scene.remove(old.group); old.dispose(); scene.add(G.car.group);
  });
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
  if (!G.engine) {
    G.engine = audio.engine(carSound(G.def.id));
    G.engine.onFire = (amp, big) => {
      if (state !== "drive" && state !== "ended") return;
      flames.fire(playerFlame, amp, big);
      if (amp >= .3 && state === "drive") dailyTrack("flames");
    };
  }
}

let joinHint = null;   // where the other drivers were when we entered a running server
function enterReady(asMode) {
  cashIn(true);   // whatever the last run banked is paid before this one starts
  mode = asMode;
  buildPlayerCar();
  if (mode === "online" && net.room) {
    traffic.setSeed(net.room.seed, net.room.traffic || "Heavy", false);
    const others = (joinHint || livePeers()).filter((o) => !o.cr);
    G.z = others.length ? others.reduce((a, o) => a + o.z, 0) / others.length + 30 : 0;
  } else {
    traffic.setSeed((Math.random() * 2 ** 31) | 0, P.settings.traffic, true);
    soloT = 0; G.z = 0;
  }
  G.x = pickSpawn(getT(), G.z);
  // joining a server that is already running: land on a clear bit of road, not on top of anyone
  if (mode === "online" && net.room) {
    const seen = (joinHint || livePeers()).filter((o) => !o.cr);
    joinHint = null;
    if (seen.length) { const sp = safeSpotNear(seen.reduce((a, o) => a + o.z, 0) / seen.length, getT(), seen); G.z = sp.z; G.x = sp.x; }
  }
  Object.assign(G, { y: 0, vy: 0, vyS: 0, pitch: 0, roll: 0, vr: 0, rv: 0, rev: false, revT: 0, air: false, Vx: 0, Vz: 0, cy: undefined, hitT: 0, latA: 0, vx: 0, yaw: 0, steer: 0, score: 0, dist: 0, combo: 0, comboT: 0, closeCalls: 0, revives: 0, ghostT: G.god ? 1e9 : 0, sigL: 0, sigR: 0, crashT: 0, thrown: null, slowT: 0, shield: null, shieldT: 0, prevThrIn: 0, awarded: false, sentWin: false, bestCombo: 0, slide: 0, driftYaw: 0, slideDir: 0, flameT: 0, cutKeys: new Set(), cutT: -9, catch: 0, catchOn: false, release: 0, liftLoad: 0 });
  G.prevDz.clear();
  G.city = cityMode();
  world.setVisible(!G.city); city.show(G.city); shadowReach(G.city ? 55 : 26);
  if (G.city) enterCity();
  G.dt.v = 0; G.readyRpm = G.dt.s.idle;
  G.car.group.position.set(G.x, 0, G.z); G.car.group.rotation.set(0, G.yaw, 0);
  G.runStartBest = P.best;
  state = "ready"; paused = false;
  police.reset(mode === "solo" && soloMode() === "police");
  bots.reset();
  ui.show("ready");
  ensureAudio().then(() => { G.engine.setProfile(carSound(G.def.id)); applyTune(); });
}
// City Drive starts downtown, on a spawn of its own, with the highway's traffic, sirens and cops put away
function enterCity() {
  traffic.hideAll(); traffic.evs.length = 0; audio.evSirens?.([]);
  const others = mode === "online" ? livePeers().filter((o) => !o.cr) : [];
  const idx = mode === "online" && net.room ? Math.max(0, net.room.players.findIndex((p) => p.id === net.me?.id)) : 0;
  const sp = city.spawnPoint(idx, others);
  G.x = sp.x; G.z = sp.z; G.y = 0; G.yaw = G.cy = sp.yaw;
  const lvl = (mode === "online" && net.room ? net.room.traffic : P.settings.traffic) || "Heavy";
  city.resetTraffic({ x: G.x, y: 0, z: G.z }, CITY_TRAFFIC[lvl] ?? 52);
  city.clearAround(G.x, G.z, 24);
}
// The sun's shadow covers a box round the car: tight on the highway (crisp car shadows), wider in the
// city so the towers throw theirs across the street.
function shadowReach(r) {
  const c = sky.sun?.shadow?.camera;
  if (!c || c.right === r) return;
  Object.assign(c, { left: -r, right: r, top: r, bottom: -r });
  c.updateProjectionMatrix();
}
function startDriving() {
  if (state !== "ready") return;
  if (G.city) {   // from a standstill, where you are
    setSpeed(0); G.snapCam = true;
    state = "drive"; ui.show("hud");
    G.engine?.event("downshift");
    return;
  }
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
  audio.musicHit?.();
  G.crashT = 0; G.shake = 1;
  G.engine?.params(G.dt.s.idle, 0, 0);
  if (respawnMode()) { if (!freeMode()) { G.score *= .9; ui.toast("Crashed — respawning (-10% score)", [], "warn"); } else ui.toast("Respawning", [], "info"); G.combo = 0; if (mode === "online") net.send({ t: "event", kind: "crash", v: Math.floor(G.score) }); return; }
  if (mode === "online" && partyRound) { const res = awardRun(); ui.toast(`+${res.coins.toLocaleString()} coins`); G.awarded = true; net.send({ t: "crash", round: partyRound, score: Math.floor(G.score) }); }
  else net.send({ t: "event", kind: "crash", v: Math.floor(G.score) });
}
function awardRun(opts = {}) {
  const score = Math.floor(G.score);
  const prevBest = P.best;
  if (score > P.best) P.best = score;
  const prevMedals = medalCount(prevBest), nowMedals = medalCount(P.best);
  P.medals = nowMedals;
  const levelUps = addXp(Math.floor(score / 4) + 25);
  dailyBest("score", score); dailyFlush(true);
  // payouts all come from economy.js so the whole economy can be balanced in one place
  const best = [...remotes.values()].map((r) => r.s?.sc || 0);
  const reward = runReward({
    score, closeCalls: G.closeCalls, distance: G.dist, bestCombo: G.bestCombo || 0,
    newBest: score > prevBest && score > 0, newMedals: nowMedals - prevMedals, levelUps,
    survivor: !!opts.survivor,
    // party rooms fix their own traffic level; a solo run uses the one in settings
    traffic: (mode === "online" && net.room ? net.room.traffic : P.settings.traffic) || "Heavy",
    partyWin: mode === "online" && partyRound > 0 && best.length > 0 && best.every((s) => score >= s),
  });
  // Held, not paid. Crashing used to credit the coins immediately, which meant a run could buy its
  // own revives and never really end. They land when the run is finished and you leave, or when you
  // start the next one.
  G.pending = (G.pending || 0) + reward.coins;
  save();
  net.send({ t: "score", score, level: P.level });
  net.send({ t: "runEnd", run: { score, closeCalls: G.closeCalls, distance: G.dist, bestCombo: G.bestCombo || 0, newBest: score > prevBest && score > 0, newMedals: nowMedals - prevMedals, levelUps, survivor: !!opts.survivor } });
  return { score, prevBest, coins: reward.coins, extras: reward.extras, closeCalls: G.closeCalls, newMedals: nowMedals - prevMedals, levelUps, revives: G.revives };
}
// back on the road after a crash in a respawn mode: no hearts spent, short invulnerability
function respawn() {
  G.x = pickSpawn(getT(), G.z);
  G.thrown = null; G.vx = 0; G.yaw = 0; G.slide = 0; G.driftYaw = 0;
  G.car.group.rotation.set(0, 0, 0); G.car.group.position.set(G.x, 0, G.z);
  G.dt = makeDrivetrain(); applyTune();
  shieldSpawn(); setSpeed(100);
  G.ghostT = 2.5; G.prevDz.clear();
  state = "drive";
}
// end a run that wasn't ended by a crash (time up, busted, a party round decided)
function endRunNow(reason) {
  if (state !== "drive" && state !== "crashed") return;
  state = "over";
  audio.horn(false);
  const result = awardRun();
  result.reason = reason;
  ui.showOver(result);
}
function finishRun() {
  if (state !== "crashed") return;
  if (respawnMode()) return respawn();
  state = "over";
  if (G.awarded) { G.awarded = false; return; }
  const result = awardRun();
  if (mode === "online" && partyRound) return ui.toast(`+${result.coins.toLocaleString()} coins`); // party: results banner comes from the server
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
  joinHint = livePeers();                 // remember where everyone is before the round change clears the buffers
  for (const p of net.peers.values()) p.buf.length = 0;
  // a server can fix the time and weather for everyone; otherwise everyone keeps their own
  if (typeof room.hour === "number") { sky.hour = room.hour; sky.flow = false; }
  if (room.weather && WEATHERS[room.weather]) sky.setWeather(room.weather);
  ui.hideRoundResults();
  enterReady("online");
  if (room.roundState === "running" && getT() > 1) return startDriving(); // late joiner drops in beside the pack
  if (G.city) return;   // City Drive: enterReady already gave everyone a spawn of their own
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
  ui.toast(`+${result.coins.toLocaleString()} coins`);
}
net.addEventListener("room", () => {
  const r = net.room;
  if (!r || !r.round || r.round === partyRound || r.roundState !== "countdown") return;
  const wait = r.epoch - net.now() - 3000;
  const go = () => { if (net.room && net.room.round === r.round && r.round !== partyRound) enterPartyRound(); };
  if (mode === "online" && state !== "home" || state === "home" && ui.onlineSelected) wait > 0 ? setTimeout(go, wait) : go();
  else ui.toast(`Party round ${r.round} starting`, [{ label: "JOIN", run: enterPartyRound }]);
});
net.addEventListener("roundEnd", (e) => {
  const m = e.detail;
  if (mode !== "online" || m.round !== partyRound || state === "home") return;
  if (m.win) ui.toast(m.byId === (net.me?.id ?? net.me?.code) ? "You won the round!" : `${m.by} won the round`);
  if (state === "crashed") { state = "drive"; G.thrown = null; }
  roundOver();
  lastResults = m;
});
function revive() {
  if (state !== "over" || G.revives >= 3 || P.hearts <= 0) return false;
  P.hearts--; G.revives++; G.pending = 0; save();   // the extended run is paid for once, at its end
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
function cashIn(quiet) {
  const c = G.pending || 0;
  G.pending = 0;
  if (c > 0) { earn(c); save(); if (!quiet) ui.toast(`+${c.toLocaleString()} coins banked`, [], "success"); }
  return c;
}
function goHome() {
  // frame() returns early while we are home, so the tunnel send has to be closed here or it keeps
  // whatever it had at the moment of the crash - which is why dying in a tunnel left the whole
  // lobby drenched in reverb.
  if (audio.ready) { audio.setTunnel(0); audio.setReverb(.05); }
  // leaving a free-drive session cashes in what you earned in it, since it has no results screen
  if (state === "drive" && freeMode() && G.score > 0 && !G.awarded) {
    const res = awardRun();
    ui.toast(`Session paid out +${res.coins.toLocaleString()} coins`, [], "success");
  }
  cashIn();
  menuOpen = false; ui.setPaused(false);
  sky.hour = P.settings.hour; sky.flow = P.settings.flow; sky.setWeather(P.settings.weather);
  state = "home"; paused = false;
  G.city = false; world.setVisible(true); city.show(false); shadowReach(26);
  audio.tires?.(0, 0, 0);
  G.engine?.params(900, 0, 0);
  audio.horn(false);
  ui.show("home");
  ui.renderHome();
}

// ---------------- keys ----------------
function onKey(code) {
  if (ui.anyModalOpen()) { if (code === "Escape") ui.closeModals(); return; }
  if (code === "KeyN") return toggleDriveMode();
  if (code === "KeyL" && state !== "home") return ui.toggleModal("leader");
  if (code === "KeyJ" && state !== "home") return ui.toggleModal("media");
  if (state === "ready" && (code === "Space" || code === "Enter")) return mode === "online" && partyRound ? null : startDriving();
  if (!["drive", "crashed", "over"].includes(state)) return;
  switch (code) {
    case "KeyR": if (mode === "online" && partyRound) ui.toast("Party rounds restart automatically"); else if (state !== "crashed") enterReady(mode), startDriving(); break;
    case "KeyP": case "Escape": togglePause(); break;
    case "KeyC": camMode = (camMode + 1) % CAMS.length; ui.toast(CAMS[camMode], [], "info"); P.settings.cam = camMode; save(); break;
    case "KeyT": { const names = Object.keys(TIME_PRESETS); const i = (names.findIndex((n) => Math.abs(TIME_PRESETS[n] - sky.hour) < .3) + 1) % names.length; P.settings.hour = sky.hour = TIME_PRESETS[names[i]]; save(); ui.toast(`${names[i]}`); break; }
    case "KeyB": { const names = Object.keys(WEATHERS); const i = (names.indexOf(sky.weatherName) + 1) % names.length; sky.setWeather(names[i]); P.settings.weather = names[i]; save(); ui.toast(`${names[i]}`); break; }
    case "KeyV": { const i = (SKY_STYLES.indexOf(sky.style) + 1) % SKY_STYLES.length; sky.setStyle(SKY_STYLES[i]); P.settings.sky = SKY_STYLES[i]; save(); ui.toast(`${SKY_STYLES[i]} sky`); break; }
    case "Enter": if (mode === "online" && net.room) openChat(); break;
    case "KeyG": ui.openModal("vehicles"); break;
    case "Tab": if (mode === "online" && net.room) ui.togglePlayers(); break;
  }
  if (state !== "drive" || paused) return;
  const d = G.dt;
  switch (code) {
    case "KeyM": d.manual = !d.manual; if (!d.manual && d.gear < 1) d.selectGear(1); ui.toast(d.manual ? "MANUAL — Q / E to shift" : "AUTOMATIC", [], "info"); break;
    // Sequential lever: N - 1 - 2 ... In automatic the driver still picks N and D by hand
    // (exactly like the lever in a real auto); the box only chooses between the forward gears.
    case "KeyE": if (d.manual || d.gear <= 0) d.shiftUp(); else ui.toast("Press M for manual shifting"); break;
    case "KeyQ": if (d.manual || d.gear <= 1) d.shiftDown(); else ui.toast("Press M for manual shifting"); break;
    case "KeyZ": G.sigL = G.sigL ? 0 : 6; G.sigR = 0; G.sigT = 0; G.sigOn = false; break;
    case "KeyX": G.sigR = G.sigR ? 0 : 6; G.sigL = 0; G.sigT = 0; G.sigOn = false; break;
    case "KeyH": audio.horn(true); break;
  }
}
// Sport <-> Comfort. The drivetrain and the engine voice both take it from applyTune, and the next
// state packet tells the other players' clients, so they hear the change too.
function toggleDriveMode() {
  P.settings.driveMode = P.settings.driveMode === "comfort" ? "sport" : "comfort";
  save();
  applyTune();
  G.cfgDirty = 1;
  ui.toast(P.settings.driveMode === "comfort" ? "COMFORT — quiet exhaust, no burbles" : "SPORT — valves open, burbles on", [], "info");
}
let menuOpen = false;
function togglePause() {
  if (state === "over") return;
  if (mode === "online") { menuOpen = !menuOpen; ui.setPaused(menuOpen, true); return; }
  paused = !paused;
  ui.setPaused(paused);
  if (paused) { G.engine?.params(900, 0, 0); audio.horn(false); audio.tires?.(0, 0, 0); }
}
function openChat() { ui.chatInput.hidden = false; ui.chatInput.focus(); ui.chatOpen(true); }
function closeChat() { ui.chatInput.value = ""; ui.chatInput.hidden = true; ui.chatInput.blur(); ui.chatOpen(false); }
function sendChat() {
  const text = ui.chatInput.value.trim().slice(0, 120);
  if (text) { if (text.startsWith("/")) chatCommand(text); else net.send({ t: "chat", text }); }
  closeChat();
}

// ---------------- players, teleporting and switching cars ----------------
// Who is in the server, how far away, and what they drive. Distances come from the interpolated
// positions the renderer already has, so this costs nothing extra.
// Where a player is right now, from the newest snapshot. This works the moment a packet has arrived,
// before their car has ever been drawn, and ignores anyone we have not heard from for 5 s (they left or froze).
function peerNow(id) {
  const p = net.peers.get(id), l = p?.buf.at(-1);
  if (!l || performance.now() - (p.last || 0) > 5000) return null;
  return { id, x: l.x, z: l.z, v: l.v || 0, cr: !!l.cr, name: String(p.name || "") };
}
const livePeers = () => [...net.peers.keys()].map(peerNow).filter(Boolean);
function playerRows() {
  const me = net.me?.id ?? net.me?.code, rows = [];
  for (const p of net.room?.players || []) {
    const isMe = p.id === me, pn = isMe ? null : peerNow(p.id);
    rows.push({ id: p.id, me: isMe, name: p.name, car: carById((isMe ? G.def.id : p.build?.car || p.car) || CARS[0].id).name, dist: isMe ? 0 : pn ? Math.abs(pn.z - G.z) : null });
  }
  return rows;
}
// exact name first, then a prefix, then anywhere in the name - so /tp al finds "Alex"
function findPeer(q) {
  q = q.trim().toLowerCase();
  if (!q) return null;
  const all = [...net.peers.entries()].map(([id, p]) => ({ id, name: String(p.name || "") }));
  return all.find((x) => x.name.toLowerCase() === q) || all.find((x) => x.name.toLowerCase().startsWith(q)) || all.find((x) => x.name.toLowerCase().includes(q)) || null;
}
// A spot beside or behind the target: clear of traffic (the same test used for spawning), clear of every
// other player, on the road, and never inside the car being visited. The target drives towards -z, so a
// positive offset is "behind" them; the last few entries are ahead of them as a fallback.
function safeSpotNear(tz, T, others = livePeers()) {
  const clear = (x, z) => traffic.laneClear(T, x, z, 70, 45) && !others.some((o) => Math.abs(o.x - x) < 3.8 && Math.abs(o.z - z) < 16);
  for (const dz of [30, 44, 60, 80, -34, -56, 110]) for (const i of LANE_ORDER) if (clear(laneX(i), tz + dz)) return { x: laneX(i), z: tz + dz };
  return { x: laneX(2), z: tz + 140 };
}
// returns { ok, text } so the chat and the player list can both show the result
function teleportTo(query) {
  if (mode !== "online" || !net.room) return { ok: false, text: "Teleporting only works inside an online server." };
  if (!freeMode()) return { ok: false, text: "Teleporting is only allowed in Free Drive servers." };
  if (state !== "drive") return { ok: false, text: "Start driving first." };
  const p = findPeer(query);
  if (!p) return { ok: false, text: "Player not found." };
  const s = peerNow(p.id);
  if (!s) return { ok: false, text: `${p.name} isn't sending position right now.` };
  if (G.city) {
    // in the city: a few car lengths behind them, pointing the same way
    const yaw = s.ry || 0;
    G.x = s.x + Math.sin(yaw) * 14; G.z = s.z + Math.cos(yaw) * 14;
    G.y = city.heightAt(G.x, G.z, (s.y || 0) + .5); G.vy = 0; G.air = false;
    G.yaw = G.cy = yaw; G.vr = 0; G.rv = 0; G.rev = false;
    city.clearAround(G.x, G.z, 10);
    setSpeed(Math.max(0, Math.min(200, (s.v || 0) * 3.6 * .9)));
    G.car.group.position.set(G.x, G.y, G.z);
    G.tpN = (G.tpN | 0) + 1; G.snapCam = true; G.sendT = 0;
    return { ok: true, text: `Teleported behind ${p.name}.` };
  }
  const spot = safeSpotNear(s.z, getT());
  G.z = spot.z; G.x = spot.x; G.vx = 0; G.yaw = 0; G.thrown = null;
  G.car.group.position.set(G.x, 0, G.z); G.car.group.rotation.set(0, 0, 0);
  setSpeed(Math.max(60, Math.min(220, s.v * 3.6 * .92)));   // roll in at about their pace, not from a standstill
  shieldSpawn(); G.ghostT = 2.5; G.prevDz.clear(); G.combo = 0;
  G.tpN = (G.tpN | 0) + 1; G.snapCam = true; G.sendT = 0;   // tell everyone this was a jump, right now
  return { ok: true, text: `Teleported near ${p.name}.` };
}
function chatCommand(text) {
  const [cmd, ...rest] = text.slice(1).trim().split(/\s+/), arg = rest.join(" ");
  const say = (t, k = "info") => ui.chatSys(t, k);
  switch ((cmd || "").toLowerCase()) {
    case "players": case "list": case "who": {
      if (!net.room) return say("You're not in a server.", "err");
      const rows = playerRows();
      say(`Players (${rows.length}/${net.room.max || 8}):`);
      for (const r of rows) say(`  ${r.name}${r.me ? " (you)" : ""} - ${r.car}${r.me || r.dist === null ? "" : " - " + Math.round(r.dist) + " m"}`);
      return;
    }
    case "tp": case "teleport": case "goto": {
      if (!arg) return say("Usage: /tp <player>", "err");
      const res = teleportTo(arg);
      return say(res.text, res.ok ? "ok" : "err");
    }
    case "help": case "?": return say("Commands: /players, /tp <player> (also /teleport, /goto), /help");
    default: return say(`Unknown command "/${cmd}". Try /help`, "err");
  }
}
// Swap the car under you without leaving the run or the server: same place, same speed, same session.
// Other players see it because the identity block in the state stream (and the build broadcast) carries
// the new car, and their client rebuilds that one remote car in place - no second car is ever created.
// Mid-drive, the new car's shaders are compiled in the background first, so the swap never freezes
// the game while you are driving; you keep the old car for the moment that takes.
let switching = null;
function switchCar(id) {
  if (!CARS.some((c) => c.id === id) || !P.owned.includes(id)) return ui.toast("You don't own that car yet", [], "warn");
  if (id === G.def.id || switching === id) return;
  if (!["ready", "drive"].includes(state)) return ui.toast("Can't switch cars right now", [], "warn");
  switching = id;
  (hasModel(id) && !MODELS[id] ? ensureModel(id) : Promise.resolve(true)).then(() => {
    if (switching !== id) return;
    const car = makeCar(id, carColor(id));
    car.applyStyle?.(carStyle(id));
    return warmCar(car, camera, scene).then(() => {
      if (switching !== id || !["ready", "drive"].includes(state)) { if (switching === id) switching = null; car.dispose(); return; }
      switching = null;
      finishSwitch(id, car);
    });
  });
}
function finishSwitch(id, car) {
  const pos = G.car.group.position.clone(), rot = G.car.group.rotation.clone(), kmh = Math.max(0, G.dt.v * 3.6), manual = G.dt.manual;
  P.equipped = id; save();
  buildPlayerCar(car);                   // removes the old car, uses the new one + drivetrain + engine voice
  G.car.group.position.copy(pos); G.car.group.rotation.copy(rot);
  G.dt.manual = manual;
  if (state === "drive") { setSpeed(kmh); shieldSpawn(); G.ghostT = Math.max(G.ghostT, 2); }
  applyTune();
  G.cfgDirty = 1; G.sendT = 0;
  net.send({ t: "setCar", car: id });
  ui.toast(`Now driving the ${G.def.name}`, [], "success");
}
function leaveServer() {
  menuOpen = false; ui.setPaused(false);
  partyRound = 0;
  net.send({ t: "roomLeave" });
}

// a point on the car (lx sideways, lz along it; +z is the rear) in world space, for any heading
const carPt = (x, z, yaw, lx, lz) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [x + lx * c + lz * s, z - lx * s + lz * c]; };

// ---------------- collision shape ----------------
// A car is not a box. Laying a row of circles down its centre line gives it the rounded corners a
// car actually has, and - because the row turns with the car - an angled car presents its real
// width instead of the width of the box around it. That is the difference between threading a
// closing gap and being killed by a corner that was never there.
// Circles are spaced so consecutive ones always overlap, so nothing can slip between them.
const HIT_R = .43;          // circle radius as a fraction of width: a touch inside the bodywork
// The body leans into a swerve by up to ~16 degrees, which is a lean for looks more than a change
// of heading - the car is still travelling roughly down the lane. Turning the collision shape by
// the full render angle would make you widest exactly when you are threading a closing gap, so it
// follows a fraction of it: rounded corners and real width, without punishing the swerve itself.
const HIT_YAW = .45;
const hitScratch = [];
function hitShape(x, z, yaw, L, W, out) {
  out.length = 0;
  const r = W * HIT_R;
  const span = Math.max(0, L / 2 - r);
  const n = Math.max(2, Math.ceil(span / (r * .85)) + 1);
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) * 2 - 1) * span;      // -span (tail) .. +span (nose), along the car
    out.push(x - sn * t, z - c * t);
  }
  return r;
}
// do two circle rows touch? squared distances only, no roots
function hitOverlap(a, ra, b, rb, slack) {
  const rr = (ra + rb - slack) ** 2;
  for (let i = 0; i < a.length; i += 2) for (let j = 0; j < b.length; j += 2) {
    const dx = a[i] - b[j], dz = a[i + 1] - b[j + 1];
    if (dx * dx + dz * dz < rr) return true;
  }
  return false;
}
const hitA = [], hitB = [];

// ---------------- remote players ----------------
const remotes = new Map();
const PLAYER_COLORS = ["#3dd6ff", "#ff5ad1", "#e8f04a", "#7dff5a", "#5b8cff", "#b27dff", "#ff4a55", "#4dffc3"];
function nameTag(name, color) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 128;
  const g = c.getContext("2d");
  g.font = "700 60px 'Barlow Condensed', sans-serif";
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
  if (hasModel(def.id) && !MODELS[def.id]) ensureModel(def.id);
  if (!r || r.carId !== def.id || (!r.car.isModel && MODELS[def.id])) {
    if (r) { scene.remove(r.car.group); r.car.dispose(); }
    const car = makeCar(def.id, last.col ?? def.color);
    if (last.st) car.applyStyle?.(last.st);
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
  if (last.st && r.stN !== peer.cfgN) { r.stN = peer.cfgN; r.car.applyStyle?.(last.st); }
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
  ui.toast("Resynced traffic with the party");
}
net.addEventListener("peerLeft", (e) => {
  const r = remotes.get(e.detail);
  if (!r) return;
  scene.remove(r.car.group); r.car.dispose(); r.voice?.params(900, 0, 0);
  if (r.flame) flames.remove(r.flame);
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
    const prevZ = g.position.z, prevX = g.position.x;
    g.position.set(s.x, s.y || 0, s.z);
    g.rotation.order = G.city ? "YXZ" : "XYZ";   // in the city pitch and roll are the car's own, on any heading
    g.rotation.set(s.pitch || 0, s.ry || 0, s.roll || 0);
    r.car.update(G.city ? Math.hypot(s.x - prevX, s.z - prevZ) : Math.max(0, prevZ - s.z), 0);
    r.car.setLights(s.brk, s.sl, s.sr, sky.night);
    const dist = listener.distanceTo(g.position);
    const ts = Math.min(4.2, 2.2 + dist * .006);
    r.tag.visible = !hideNames && dist < 260;
    r.tag.material.opacity = Math.max(0, Math.min(1, (260 - dist) / 140));
    r.tag.scale.set(ts, ts / 4, 1);
    const B = BODIES[carById(cfg.car || r.carId).body];
    r.arrow.position.y = B.top + 1.15 + Math.sin(performance.now() / 250) * .15;
    r.arrow.scale.setScalar(1 + dist * .006);
    r.glow.material.opacity = s.cr ? 0 : .55 + Math.sin(performance.now() / 300) * .2;
    if (!r.flame) r.flame = flames.emitter();
    flames.pose(r.flame, s.x, s.z, s.ry || 0, s.vx || 0, s.vz ?? -(s.v || 0), B, s.y || 0);
    r.flame.style = typeof cfg.st?.flame === "string" ? cfg.st.flame : null;
    list.push({ r, dist, s, id });
    if (sky.lampsOn && !s.cr) {
      const gy = s.y || 0;
      for (const k of [-1, 1]) {
        const tp = carPt(s.x, s.z, s.ry || 0, k * (B.W / 2 - .35), B.L / 2), hp = carPt(s.x, s.z, s.ry || 0, k * (B.W / 2 - .35), -B.L / 2);
        glows.add(tp[0], gy + B.tl[1], tp[1], 1, s.brk ? .15 : .05, .05, s.brk ? 1.4 : .8);
        glows.add(hp[0], gy + B.hl[1], hp[1], 1, .95, .85, 1.5);
        if ((k < 0 && s.sl) || (k > 0 && s.sr)) { glows.add(tp[0], gy + B.tl[1], tp[1], 1, .55, .05, 1.1); glows.add(hp[0], gy + B.hl[1], hp[1], 1, .55, .05, 1.1); }
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
      r.voice.onFire = (amp, big) => { if (remotes.get(id) === r && r.car.group.visible && !r.s?.cr) flames.fire(r.flame, amp, big); };
      // a snap lift off the throttle is what sets an exhaust crackling; their synced pedal shows it
      const thrNow = s.thr || 0;
      if ((r.thrWas ?? 0) > .5 && thrNow < .15) r.voice.event("lift", { rpm: s.rpm || 900, load: r.ldWas ?? 1, gear: s.g || 1, boost: (s.bo ?? 0) / 100, release: 10 });
      r.thrWas = thrNow; r.ldWas = s.ld ?? thrNow;
      // Doppler: an engine closing on you sounds higher, one pulling away lower. Everyone drives
      // towards -z; u points from you to them.
      const dx = s.x - G.x, dz = s.z - G.z, dd = Math.max(1, Math.hypot(dx, dz)), ux = dx / dd, uz = dz / dd;
      const toThem = G.city ? G.Vx * ux + G.Vz * uz : -(G.dt?.v || 0) * uz;
      const toMe = G.city ? -((s.vx || 0) * ux + (s.vz || 0) * uz) : (s.v || 0) * uz - (s.vx || 0) * ux;
      const dop = Math.max(.8, Math.min(1.25, (343 + toThem) / (343 - toMe)));
      r.dop = r.dop ? r.dop + (dop - r.dop) * .2 : dop;
      r.voice.setDistance(dist);
      r.voice.params({
        rpm: (s.rpm || 900) * r.dop, throttle: s.thr || 0, gain: .8, load: s.ld ?? s.thr ?? 0,
        boostNorm: (s.bo ?? 0) / 100, gear: s.g || 1, redline: cfg?.redline || 7000,
      });
      r.voice.setPan((s.x - G.x) / 20, Math.max(0, 1 - dist / 140) ** 2 * .7);
    } else r.voice?.params({ rpm: 900, throttle: 0, gain: 0, load: 0 });
  });
  // renderPartyHud only redraws a few times a second; building its array every frame was pure garbage
  if (ui.partyHudDue()) ui.renderPartyHud(list.map(({ r, s }) => ({ name: r.name, dz: G.z - s.z, score: s.sc || 0, crashed: s.cr, color: r.color })));
  // screen-edge markers for players that are off-screen or far away
  const markers = [];
  if (state !== "home") for (const { r, dist, id, s } of list) {
    const p = tmpV.set(s.x, 1.5, s.z).project(camera);
    const behind = p.z > 1;
    let sx = (p.x * .5 + .5) * innerWidth, sy = (-p.y * .5 + .5) * innerHeight;
    const onScreen = !behind && sx > 30 && sx < innerWidth - 30 && sy > 90 && sy < innerHeight - 30;
    if (onScreen) continue;
    if (behind) { sx = innerWidth - sx; sy = innerHeight - 40; }
    sx = Math.max(70, Math.min(innerWidth - 70, sx)); sy = behind ? innerHeight - 40 : 100;
    const dz = Math.round(G.z - s.z);
    const away = G.city ? `${Math.round(dist)}m` : `${dz >= 0 ? "+" : ""}${dz}m`;
    markers.push({ id, name: r.name, color: r.color, x: sx, y: sy, text: `${behind ? "▼" : "▲"} ${hideNames ? "" : r.name + " "}${away}` });
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
  const alive = mode === "online" && !freeMode() && state === "drive" && list && list.some((x) => !x.s.cr);
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
// Every driver on the road, for the traffic: where they are, how fast they are going and how big
// their car is. block = they are actually in the lane (not crashed), so traffic queues behind them.
// ---------------- emergency vehicles ----------------
// Now and then a police car, ambulance or fire engine comes up behind you with its siren going, and
// the traffic opens a corridor between the two left lanes for it (traffic.js). Sit in that gap and it
// stays behind you on the air horn; move over and it goes by, and you get a bonus. Not in a police
// chase - that has its own cops.
function updateEmergency(dt, T) {
  traffic.evOn = state === "drive" && !(mode === "solo" && soloMode() === "police");
  for (const e of traffic.stepEmergency(dt, T)) {
    const d = EV_TYPES[e.e.kind];
    if (e.type === "horn") {
      const dist = Math.hypot(e.e.x - G.x, e.e.z - G.z);
      audio.honk?.(Math.max(-1, Math.min(1, (e.e.x - G.x) / 12)), true, Math.min(1, 18 / Math.max(6, dist)) * (e.me ? 1 : .5));
    } else if (e.type === "passed" && state === "drive" && !e.e.dead) {
      if (e.e.blockedT < 1) { G.score += 150; ui.toast(`Moved over for the ${d.name.toLowerCase()} · +150`, [], "success"); }
      else ui.toast(`You held up the ${d.name.toLowerCase()}`, [], "warn");
    }
  }
  // warn once it's close enough to hear, and voice every siren
  const sirens = [];
  for (const e of traffic.evs) {
    const dx = e.x - G.x, dz = e.z - G.z, dist = Math.max(1, Math.hypot(dx, dz));
    if (!e.announced && state === "drive" && dz > 0 && dz < 230) {
      e.announced = true;
      const d = EV_TYPES[e.kind];
      ui.toast(`${d.name} coming through behind you - move over`, [], "warn");
    }
    if (e.dead || dist > 650) continue;
    // Doppler from both speeds along the line between you (everyone drives towards -z)
    const ux = dx / dist, uz = dz / dist;
    const vL = G.vx * ux - (G.dt?.v || 0) * uz, vS = -e.v * uz;
    sirens.push({ key: e.key, kind: e.kind, level: Math.min(1, (40 / Math.max(20, dist)) ** 1.1) * (paused ? .4 : 1),
      pan: dx / 18, dop: (343 + vL) / (343 + vS), yelp: dist < 70 });
  }
  audio.evSirens?.(sirens);
}

function allPlayers() {
  const out = [];
  if (state !== "home") {
    const B = BODIES[G.def.body];
    out.push({ x: G.x, z: G.z, v: G.dt?.v || 0, L: B.L, W: B.W, block: state === "drive" || state === "ended", me: true });
  }
  if (mode === "online") for (const r of remotes.values()) if (r.s && !r.s.cr) {
    const B = BODIES[carById(r.carId).body] || BODIES.sedan;
    out.push({ x: r.s.x, z: r.s.z, v: r.s.v || 0, L: B.L, W: B.W, block: true });
  }
  return out;
}

// ---------------- police chase ----------------
// Cops are local AI (solo only): they spawn behind you, run you down through traffic, and try to box
// you in. Touching one fills the BUSTED meter; being slow near one fills it too. Get far enough ahead
// for long enough and you escape - the heat goes up and the next wave is bigger.
const police = (() => {
  const P2 = { on: false, cops: [], heat: 1, bounty: 0, meter: 0, escapeT: 0, next: 0, flash: 0 };
  function lightBar(car) {
    const B = car.B || BODIES.charger, bar = new THREE.Group();
    const red = new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false }), blue = new THREE.MeshBasicMaterial({ color: 0x2050ff, toneMapped: false });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, .09, .3), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    const r = new THREE.Mesh(new THREE.BoxGeometry(.5, .1, .26), red), b = new THREE.Mesh(new THREE.BoxGeometry(.5, .1, .26), blue);
    r.position.x = -.27; b.position.x = .27; r.position.y = b.position.y = .07;
    bar.add(base, r, b); bar.position.set(0, (B.top || 1.45) + .05, 0);
    car.bodyGroup.add(bar);
    return { red, blue };
  }
  function spawn() {
    const car = makeCar("m340i", 0x0d0f14);
    car.applyStyle?.({ finish: "gloss", tint: "dark", rim: 0x16181c });
    // white doors, cop livery
    const l = lightBar(car);
    scene.add(car.group);
    // spawn in a lane that is actually clear, so a cop never appears inside a traffic car
    const z = G.z + 160 + Math.random() * 60, T = getT();
    const lanes = [0, 1, 2, 3, 4].sort(() => Math.random() - .5);
    const lane = lanes.find((i) => traffic.laneClear(T, laneX(i), z, 40, 20)) ?? lanes[0];
    P2.cops.push({ car, l, x: laneX(lane), z, v: G.dt.v + 8, vx: 0, down: false, age: 0 });
    if (P2.cops.length === 1) ui.toast("Police pursuit! Outrun them or get busted");
  }
  function clear() { for (const c of P2.cops) { scene.remove(c.car.group); c.car.dispose(); } P2.cops.length = 0; audio.siren?.(0, 0); }
  return {
    get state() { return P2; },
    reset(on) { clear(); Object.assign(P2, { on, heat: 1, bounty: 0, meter: 0, escapeT: 0, next: 6 }); },
    update(dt, T) {
      if (!P2.on) return;
      P2.flash += dt;
      if (state !== "drive") { audio.siren?.(0, 0); return; }
      if (!P2.cops.length) { P2.next -= dt; if (P2.next <= 0) for (let i = 0; i < Math.min(4, P2.heat); i++) spawn(); }
      else { P2.bounty += dt * 18 * P2.heat; G.score += dt * 6 * P2.heat; }
      const d = G.dt, B = BODIES[G.def.body];
      let nearest = 1e9, allFar = P2.cops.length > 0;
      for (const c of P2.cops) {
        if (c.down) continue;
        c.age += dt;
        const behind = c.z - G.z;                         // + = the cop is behind you
        const want = Math.min(95, Math.max(20, d.v + Math.max(-12, Math.min(28, behind * .08)) + 2));
        c.v += Math.max(-14, Math.min(11, want - c.v)) * dt;
        // steer: at your lane when close, around traffic otherwise
        let tx = Math.abs(behind) < 45 ? G.x : c.x;
        const ahead = traffic.query(T, c.z - 32, c.z - 2, [1]).filter((t) => Math.abs(t.x - c.x) < 2.6);
        if (ahead.length) { for (const lx of [c.x - 4, c.x + 4]) if (Math.abs(lx) < 9 && traffic.laneClear(T, lx, c.z, 30, 6)) { tx = lx; break; } }
        c.vx += (Math.max(-7, Math.min(7, (tx - c.x) * 2.2)) - c.vx) * Math.min(1, dt * 5);
        c.x = Math.max(-8.8, Math.min(8.8, c.x + c.vx * dt));
        c.z -= c.v * dt;
        // cops that hit traffic are out of the chase
        if (c.age > 1.5) for (const t of traffic.query(T, c.z - 6, c.z + 6, [1])) if (Math.abs(t.x - c.x) < 1.9 && Math.abs(t.z - c.z) < 4.2 && !traffic.bumped.has(t.key)) {
          traffic.bump(t, c.v, Math.sign(t.x - c.x) || 1); c.v *= .75; c.age = 0; audio.crash(.3);
        }
        c.car.group.position.set(c.x, 0, c.z);
        c.car.group.rotation.set(0, -Math.atan2(c.vx, Math.max(c.v, 6)) * .9, 0);
        c.car.update(c.v * dt, 0);
        const on = Math.floor(P2.flash * 6) % 2 === 0;
        c.l.red.color.setScalar(on ? 2.5 : .15).multiply(new THREE.Color(1, .12, .15));
        c.l.blue.color.setScalar(on ? .15 : 2.5).multiply(new THREE.Color(.12, .3, 1));
        glows.add(c.x + (on ? -.3 : .3), 1.7, c.z, on ? 1 : .15, on ? .1 : .3, on ? .15 : 1, 1.8);
        // contact and boxing in
        const dx = Math.abs(c.x - G.x), dz = Math.abs(c.z - G.z);
        if (G.ghostT <= 0 && dx < (B.W + 1.9) / 2 && dz < (B.L + 5) / 2) { P2.meter += dt * 1.4; d.v *= 1 - dt * .9; G.shake = Math.max(G.shake || 0, .25); }
        else if (d.v < 14 && dz < 16) P2.meter += dt * .6;
        nearest = Math.min(nearest, Math.hypot(dx, dz));
        if (behind < 380) allFar = false;
      }
      P2.meter = Math.max(0, P2.meter - dt * .25);
      audio.siren?.(Math.max(0, 1 - nearest / 260) * .5, 0);
      if (P2.meter >= 1) { ui.toast(`BUSTED — bounty ${Math.floor(P2.bounty).toLocaleString()} lost`); P2.bounty = 0; clear(); endRunNow("busted"); return; }
      if (P2.cops.length && (allFar || P2.cops.every((c) => c.down))) {
        P2.escapeT += dt;
        if (P2.escapeT > 5) {
          const won = Math.floor(P2.bounty);
          G.score += won / 4; ui.toast(`ESCAPED! +${won.toLocaleString()} bounty — heat ${P2.heat + 1}`);
          clear(); P2.heat++; P2.bounty = 0; P2.escapeT = 0; P2.next = 10;
        }
      } else P2.escapeT = 0;
    },
  };
})();
// ---------------- offline bots ----------------
// AI drivers for solo play: they weave through the same traffic, and never crash out.
const BOT_NAMES = ["Nova", "Blaze", "Kestrel", "Vex", "Rogue", "Sable"];
const bots = (() => {
  const list = [];
  const count = () => (mode === "solo" ? Math.max(0, Math.min(5, P.settings.bots | 0)) : 0);
  function spawn(i) {
    const def = CARS[(Math.random() * CARS.length) | 0];
    const car = makeCar(def.id, def.color);
    const B = BODIES[def.body], color = PLAYER_COLORS[i % PLAYER_COLORS.length];
    const tag = nameTag(BOT_NAMES[i % BOT_NAMES.length], color);
    tag.position.set(0, B.top + 2.1, 0);
    car.group.add(tag);
    scene.add(car.group);
    const T = getT(), z = G.z + (Math.random() < .5 ? -1 : 1) * (60 + Math.random() * 160);
    const lane = [0, 1, 2, 3, 4].sort(() => Math.random() - .5).find((l) => traffic.laneClear(T, laneX(l), z, 40, 30)) ?? 2;
    list.push({ car, tag, x: laneX(lane), z, v: 35 + Math.random() * 30, vx: 0, top: 45 + Math.random() * 30, tx: laneX(lane) });
  }
  function clear() { for (const b of list) { scene.remove(b.car.group); b.car.dispose(); } list.length = 0; }
  return {
    reset() { clear(); },
    update(dt, T) {
      const n = state === "drive" ? count() : 0;
      if (!n) { if (list.length) clear(); return; }
      while (list.length < n) spawn(list.length);
      for (const b of list) {
        const ahead = traffic.query(T, b.z - 40, b.z - 2, [1]).filter((t) => Math.abs(t.x - b.x) < 2.6);
        b.v += (Math.min(b.top, ahead.length ? 22 : b.top) - b.v) * Math.min(1, dt * 1.2);
        if (ahead.length) for (const lx of [b.x - 4, b.x + 4]) if (Math.abs(lx) < 9 && traffic.laneClear(T, lx, b.z, 40, 8)) { b.tx = lx; break; }
        b.vx += (Math.max(-6, Math.min(6, (b.tx - b.x) * 2)) - b.vx) * Math.min(1, dt * 4);
        b.x += b.vx * dt; b.z -= b.v * dt;
        b.car.group.position.set(b.x, 0, b.z);
        b.car.group.rotation.set(0, -Math.atan2(b.vx, Math.max(b.v, 6)) * .9, 0);
        b.car.update(b.v * dt, 0);
        const dist = Math.abs(b.z - G.z);
        b.tag.scale.setScalar(Math.min(4.2, 2.2 + dist * .006)); b.tag.scale.y /= 4;
        b.tag.material.opacity = Math.max(0, Math.min(1, (260 - dist) / 140));
        // fell too far behind or ran too far ahead: put it back near the action
        if (b.z - G.z > 320 || G.z - b.z > 420) { b.z = G.z - 220 - Math.random() * 100; b.x = laneX((Math.random() * 5) | 0); b.tx = b.x; }
      }
    },
  };
})();
function updateModeHud(T) {
  const el = document.getElementById("modeHud");
  let txt = "";
  if (state === "drive" || state === "crashed") {
    if (G.city) txt = `CITY DRIVE · ${city.district(G.x, G.z, G.y)}${mode === "online" && net.room ? ` · ${net.room.players.length} PLAYER${net.room.players.length === 1 ? "" : "S"}` : ""}`;
    else if (freeMode()) txt = mode === "online" ? `FREE DRIVE · ${net.room.players.length} PLAYER${net.room.players.length === 1 ? "" : "S"}` : `FREE DRIVE · ${(G.dist / 1609.34).toFixed(1)} MI`;
    else if (mode === "solo" && soloMode() === "timeattack") txt = `TIME ${Math.max(0, Math.ceil(TIME_ATTACK - T))}s`;
    else if (mode === "solo" && soloMode() === "police") {
      const p = police.state;
      txt = p.cops.length ? `HEAT ${p.heat} · BOUNTY ${Math.floor(p.bounty).toLocaleString()} · BUSTED ${"▮".repeat(Math.round(p.meter * 5))}${"▯".repeat(5 - Math.round(p.meter * 5))}${p.escapeT > 0 ? " · ESCAPING " + Math.ceil(5 - p.escapeT) : ""}` : `HEAT ${p.heat} · cops in ${Math.max(0, Math.ceil(p.next))}s`;
    } else if (partyMode() === "target") txt = `FIRST TO ${(net.room.target || 10000).toLocaleString()} · ${Math.floor(G.score).toLocaleString()}`;
    else if (partyMode() === "timed") txt = `TIMED · ${Math.max(0, Math.ceil((net.room.dur || 120) - T))}s LEFT`;
  }
  if (el.textContent !== txt) el.textContent = txt;
  el.hidden = !txt;
}

// ---------------- simulation ----------------
const tmpV = new THREE.Vector3();
const lights = [];

// Close calls are graded by how much air was left between the cars, and a pass can pick up tags for
// how it was done. Each grade has a handful of words so a long streak doesn't keep printing the same
// line. gap is metres of daylight, side to side; mul scales the base points.
const CC_TIERS = [
  { gap: .3, mul: 3.5, words: ["INSANE!", "PAINT SWAP!", "HAIR'S BREADTH!", "MIRROR KISS!", "NO WAY!"] },
  { gap: .6, mul: 2.25, words: ["RAZOR CLOSE!", "INCHES!", "WHISKER!", "TIGHT!", "SO CLOSE!"] },
  { gap: .95, mul: 1.5, words: ["CLOSE CALL!", "SLICK!", "NICE!", "CLEAN!", "SMOOTH!"] },
  { gap: 1.35, mul: 1, words: ["NEAR MISS", "CLOSE ONE", "SQUEEZED BY", "NICE PASS", "SLIPPED BY"] },
];
// Streak names, shown on the pass that reaches them; past 50 every tenth pass is a HIGHWAY GOD.
const CC_STREAKS = { 5: "ON FIRE", 10: "UNSTOPPABLE", 15: "RAMPAGE", 20: "GODLIKE", 25: "LEGENDARY", 30: "UNREAL", 40: "ABSOLUTE MADNESS", 50: "HIGHWAY GOD" };
let ccLastWord = "";
function gradeCloseCall(c, gap, dx, kmh, T, B) {
  const i = CC_TIERS.findIndex((t) => gap < t.gap), tier = CC_TIERS[i];
  const pool = tier.words.filter((w) => w !== ccLastWord);
  const word = ccLastWord = pool[(Math.random() * pool.length) | 0];
  const tags = [];
  let bonus = 0;
  const tag = (name, pts) => { tags.push(name); bonus += pts; };
  // a car on the other side went by in the same breath: you split the pair
  const other = T - (G.passAt[dx > 0 ? "l" : "r"] ?? -1e9);
  if (other >= 0 && other < .5) tag("THREAD THE NEEDLE", 40);
  // half a second ago you were pointed straight at it
  if (Math.abs(G.xLag - c.x) < (c.W + B.W) / 2 - .15) tag("LAST SECOND", 25);
  if (c.sig) tag("DODGED", 25);                                  // it was pulling across lanes
  if (c.body === "truck" || c.body === "bus") tag("BIG RIG", 10);
  if (Math.abs(G.x) > ROAD_HALF) tag("SHOULDER RUN", 15);                // more than half the car off the road
  if (kmh >= 250) tag("HIGH SPEED", 15);
  if ((sky.w?.rain || 0) > .4) tag("IN THE WET", 10);
  const n = G.combo;
  const streak = CC_STREAKS[n] || (n > 50 && n % 10 === 0 ? "HIGHWAY GOD" : "");
  const pts = Math.round(20 * tier.mul) + bonus + (n - 1) * 10;
  return { word, tier: CC_TIERS.length - 1 - i, combo: n, pts, tags, streak };
}

// The pedals, the gearbox and everything the exhaust does about them - the same on the highway and in
// the city.
function pedals(dt, thrIn, brkIn) {
  const d = G.dt;
  G.thr += (thrIn - G.thr) * Math.min(1, dt * (thrIn > G.thr ? 14 : 12));
  // everything the burble model needs: how hard it was pulling, how fast the pedal came up, boost
  const evInfo = () => ({ rpm: d.rpm, load: G.liftLoad ?? d.load, boost: d.s.boostMax ? d.boost / d.s.boostMax : 0, gear: Math.max(1, d.gear), release: G.release || 0 });
  // how hard the exhaust is burbling right now, on the same terms the engine voice uses
  const burbleNow = (release) => {
    const ac = G.audioCfg || (G.audioCfg = carAudio(G.def.id));
    return burbleIntensity({
      rpm: d.rpm, load: G.liftLoad ?? d.load, release,
      boost: d.s.boostMax ? d.boost / d.s.boostMax : 0, gear: Math.max(1, d.gear),
      warmth: d.warmth, redline: ac.redline || d.s.redline, burbleRpm: ac.burbleRpm || 3000,
      burble: ac.burble ?? .75, crackle: 1, sport: P.settings.driveMode !== "comfort",
    });
  };
  if (thrIn) { G.release = 0; G.liftLoad = d.load; }
  else { G.liftLoad = Math.max(d.load, (G.liftLoad || 0) * Math.exp(-dt * .7)); G.release = (G.release || 0) * Math.exp(-dt * 1.2); }
  if (G.prevThrIn && !thrIn) {
    G.release = 10; G.engine?.event("lift", evInfo());
    // a single-bang tune spits one short, fat flame; a long burble trails a smaller one
    const oneShot = (d.s.decay ?? 1.1) <= .12;
    const I = burbleNow(10);
    G.flameSize = (oneShot ? 2 : 1) * Math.min(1.4, .55 + I);
    // no burble, no flame - and a weak burble only throws a short one
    if (I > .18) G.flameT = (oneShot ? .3 : .6) * Math.min(1.5, .5 + I) + (d.s.antiLag ? .8 : 0);
  } // snap lift: flutter + overrun burble
  G.prevThrIn = thrIn;
  G.brk += (brkIn - G.brk) * Math.min(1, dt * 12);
  const events = d.update(dt, G.thr, G.brk);
  for (const ev of events) {
    if (ev === "upshift" || ev === "autoUp") {
      G.engine?.event(G.thr > .3 ? "upshift" : "limiter", evInfo()); if (ev === "upshift") audio.shiftClunk(true);
      // the shift fart only lights up when the exhaust is actually cracking off
      const Iu = burbleNow(9);
      if ((d.s.eth || 0) >= .3 && G.thr > .3 && Iu > .18) { G.flameT = Math.max(G.flameT || 0, .25 + d.s.eth * .45); G.engine?.event("pop", { v: .6 + d.s.eth }); }
    }
    else if (ev === "downshift" || ev === "autoDown") { G.engine?.event("downshift", evInfo()); if (ev === "downshift") audio.shiftClunk(false); }
    else if (ev === "limiter" || ev === "lift") {
      G.engine?.event(ev, evInfo());
      if (ev === "limiter" && d.antilag) { const Ia = burbleNow(8); G.flameSize = Math.min(1.6, .7 + Ia); G.flameT = Math.max(G.flameT || 0, .18); }
    }
    else if (ev === "deny") audio.deny();
    else if (ev === "antilagOn") { G.engine?.event("antilagOn"); ui.toast("ROLLING ANTI-LAG — speed locked, revs free"); }
    else if (ev === "antilagOff") G.engine?.event("antilagOff");
  }
}
function updateDrive(dt, T) {
  const d = G.dt, def = G.def, B = BODIES[def.body];
  const thrIn = held("KeyW", "ArrowUp") ? 1 : 0, brkIn = held("KeyS", "ArrowDown") ? 1 : 0;   // Space is look-back now
  pedals(dt, thrIn, brkIn);
  const v = d.v, kmh = v * 3.6;
  d.surface = 1 - (sky.w?.rain || 0) * .22; // wet road

  // steering
  const steerIn = (held("KeyD", "ArrowRight") ? 1 : 0) - (held("KeyA", "ArrowLeft") ? 1 : 0);
  G.steer += (steerIn - G.steer) * Math.min(1, dt * 9);
  const hMul = d.s.handlingMul || 1;
  const maxLat = (4.5 + def.handling * .07) * hMul * Math.min(1, v / 14);
  // grip-driven steering, no sliding: the car goes where it is pointed
  G.vx += (G.steer * maxLat - G.vx) * Math.min(1, dt * (3.5 + def.handling * .05) * hMul);
  G.x += G.vx * dt;
  const lim = ROAD_HALF + SHOULDER - B.W / 2 - .1;
  G.scraping = false;
  if (Math.abs(G.x) > lim) {
    G.x = Math.sign(G.x) * lim; G.vx *= -.2; G.scraping = v > 5;
    d.v *= 1 - dt * .6;
    if (G.scraping) for (let i = 0; i < 3; i++) glows.add(G.x + Math.sign(G.x) * B.W / 2, .3 + Math.random() * .4, G.z + (Math.random() - .5) * 2, 1, .6 + Math.random() * .3, .2, .4 + Math.random() * .5);
  }
  G.z -= v * dt;
  G.dist += Math.max(0, v) * dt;   // reversing does not rack up distance
  dailyTrack("miles", Math.max(0, v) * dt / 1609.344);
  dailyBest("mph", Math.round(kmh * .621371));
  G.yaw += (-Math.atan2(G.vx, Math.max(v, 6)) * .9 - G.yaw) * Math.min(1, dt * 10);
  // exhaust flames (the tyres never slip, so there is no tyre smoke or squeal). The engine voice
  // fires them itself, one per pop it plays (G.engine.onFire); this only keeps the pipes where the
  // car is. With no audio running there are no pops to follow, so the burble model fires them.
  audio.tires?.(0, 0, kmh);
  flames.pose(playerFlame, G.x, G.z, G.yaw, G.vx, -v, B);
  playerFlame.style = carStyle(def.id).flame ?? null;
  if (G.flameT > 0) {
    G.flameT -= dt;
    if (!audio.ready && Math.random() < dt * 14) flames.fire(playerFlame, 1 + (G.flameSize || 1) * 1.5, (G.flameSize || 1) > 1.5);
  }

  // score
  if (kmh >= 80) G.score += (v * dt) / 10 * Math.max(1, kmh / 130);
  if (partyMode() === "target" && partyRound && !G.sentWin && G.score >= (net.room.target || 10000)) {
    G.sentWin = true;
    net.send({ t: "crash", round: partyRound, score: Math.floor(G.score), win: true });
  }
  G.slowT = kmh < 80 ? G.slowT + dt : 0;
  G.comboT -= dt;
  if (G.comboT <= 0) G.combo = 0;
  if (G.ghostT > 0) G.ghostT -= dt;
  if (G.shieldT > 0) G.shieldT -= dt;

  // where the car was about half a second ago (snapped across respawns and teleports)
  if (G.xLag === undefined || Math.abs(G.x - G.xLag) > 6) G.xLag = G.x;
  G.xLag += (G.x - G.xLag) * Math.min(1, dt / .45);
  G.passAt ||= {};
  G.cutKeys ||= new Set();

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
    // cheap reject first: nothing this far away can touch, whatever the angles
    if (G.ghostT <= 0 && Math.abs(dx) < (c.W + B.W) / 2 + 1 && Math.abs(dz) < (c.L + B.L) / 2 + 1) {
      const ra = hitShape(G.x, G.z, G.yaw * HIT_YAW, B.L, B.W, hitA);
      const rb = hitShape(c.x, c.z, 0, c.L, c.W, hitB);   // traffic runs straight down the lane
      if (hitOverlap(hitA, ra, hitB, rb, .15)) return crash(c);
    }
    const prev = G.prevDz.get(c.key);
    G.prevDz.set(c.key, dz);
    if (prev !== undefined && prev < 0 && dz >= 0) {
      const gap = Math.abs(dx) - (c.W + B.W) / 2;
      if (gap < 3.2) audio.whoosh(Math.sign(dx) * .7, c.body === "truck" || c.body === "bus");
      if (gap < 1.35 && kmh > 90 && G.ghostT <= 0 && !c.parked) {
        G.combo = G.comboT > 0 ? G.combo + 1 : 1;
        G.comboT = 2.5; G.closeCalls++; G.bestCombo = Math.max(G.bestCombo || 0, G.combo);
        const cc = gradeCloseCall(c, gap, dx, kmh, T, B);
        dailyTrack("closeCalls"); dailyBest("streak", G.combo);
        if (cc.tier === 3) dailyTrack("insane");
        if (cc.tags.includes("THREAD THE NEEDLE")) dailyTrack("needle");
        if (cc.tags.includes("DODGED")) dailyTrack("dodged");
        if (cc.tags.includes("BIG RIG")) dailyTrack("bigrig");
        G.score += cc.pts;
        ui.closeCall(cc);
        audio.closeCall(G.combo, cc.tier, !!cc.streak);
        if ((c.body === "truck" || c.body === "bus") && Math.random() < .35) audio.truckHorn(Math.sign(dx) * .6);
        if (G.combo % 5 === 0) net.send({ t: "event", kind: "combo", v: G.combo });
      }
      if (gap < 2.2) G.passAt[dx > 0 ? "r" : "l"] = T;
    }
    // Cutting in just in front of someone: you are in their lane now, you weren't half a second ago,
    // and they are close behind. Most drivers lean on the horn, flash their lights, or both.
    if (!c.parked && dz > 0 && G.ghostT <= 0 && !G.cutKeys.has(c.key) && T - G.cutT > 1.1) {
      const reach = (c.W + B.W) / 2, gapBehind = dz - (c.L + B.L) / 2;
      if (gapBehind < 14 && Math.abs(dx) < reach - .25 && Math.abs(G.xLag - c.x) > reach + .2) {
        G.cutKeys.add(c.key); G.cutT = T;
        if (gapBehind < 7 || Math.random() < .7) {
          const r = Math.random(), honk = r < .75;
          traffic.react(c.key, r > .45);
          if (honk) audio.honk?.(Math.max(-1, Math.min(1, dx / 10)), c.body === "truck" || c.body === "bus", Math.min(1, 14 / Math.max(5, dz)));
          if (honk) dailyTrack("honks");
        }
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

// ---------------- City Drive ----------------
// Free steering in three dimensions. The yaw comes from a bicycle model (wheelbase, a steering lock
// that closes up with speed, a ceiling on how hard the tyres can corner), the pull from the same
// drivetrain as the highway. Grip holds the car to where it points; the handbrake (Shift) lets the
// rear go so it slides. The car rides the height and slope of whatever is under it - curbs, ramps,
// the ring - drops when there is nothing there, and is pushed out of walls, pillars, buildings and
// traffic, which it shoves aside. Hold S at a standstill to reverse; W takes it out of reverse.
const _hit = { x: 0, z: 0, nx: 0, nz: 0, d: 0 }, _ccSeen = new Set();
function updateCityDrive(dt, T) {
  const d = G.dt, def = G.def, B = BODIES[def.body];
  const up = held("KeyW", "ArrowUp") ? 1 : 0, down = held("KeyS", "ArrowDown") ? 1 : 0, hb = held("ShiftLeft", "ShiftRight") ? 1 : 0;
  if (!G.rev && d.v < .35 && down && !up) { G.revT += dt; if (G.revT > .3) { G.rev = true; G.rv = 0; } }
  else if (!down) G.revT = 0;
  if (G.rev && up && G.rv > -.6) { G.rev = false; G.revT = 0; }
  // in reverse the engine only revs - the speed backwards is set here, not by the gearbox
  pedals(dt, G.rev ? down * .45 : up, G.rev ? up : down);
  if (G.rev) {
    d.v = 0;
    if (up) G.rv = Math.min(0, G.rv + 9 * dt);
    else if (down) G.rv = Math.max(-8, G.rv - 3.4 * dt);
    else G.rv = Math.min(0, G.rv + 1.5 * dt);
  }
  d.surface = 1 - (sky.w?.rain || 0) * .22;
  const vf = G.rev ? G.rv : d.v, sp = Math.abs(vf);

  // ---- steering ----
  // The steering feels like a road car whatever the build: tyres, suspension and aero add a little
  // cornering grip (0.92 g stock, never more than 1.1 g), never a quicker rack. Full lock at a crawl;
  // at speed the lock narrows so that full input asks for about what the tyres can hold, and the
  // wheel turns in more gently the faster you go.
  const steerIn = (held("KeyD", "ArrowRight") ? 1 : 0) - (held("KeyA", "ArrowLeft") ? 1 : 0);
  G.steer += (steerIn - G.steer) * Math.min(1, dt * (steerIn ? 5 - 2.5 * Math.min(1, sp / 40) : 7));
  const hMul = d.s.handlingMul || 1, wb = B.L * .6;
  const grip = 9.81 * Math.min(1.1, .92 + ((d.s.grip || 1) - 1) * .25 + (hMul - 1) * .15);
  const lock = Math.min(.55, Math.atan((grip * 1.05 * wb) / Math.max(1, sp * sp)));
  let yawRate = (vf * Math.tan(G.steer * lock)) / wb;
  const aMax = grip * (hb ? 1.5 : 1);
  if (Math.abs(yawRate) * sp > aMax) yawRate = (Math.sign(yawRate) * aMax) / Math.max(1, sp);
  if (hb && sp > 5) yawRate *= 1.3;
  // the velocity carries through the turn: whatever no longer points along the car becomes slide,
  // which the tyres then scrub off - quickly with grip, slowly with the handbrake up
  const c0 = Math.cos(G.yaw), s0 = Math.sin(G.yaw);
  let Vx = -s0 * vf + c0 * G.vr, Vz = -c0 * vf - s0 * G.vr;
  G.yaw -= yawRate * dt;
  const c1 = Math.cos(G.yaw), s1 = Math.sin(G.yaw), fx = -s1, fz = -c1;
  let nf = Vx * fx + Vz * fz, nr = Vx * c1 - Vz * s1;
  nr *= Math.exp(-dt * (hb ? 1.4 : 10 + (def.handling || 0) * .04));
  if (hb) nf -= Math.sign(nf) * Math.min(Math.abs(nf), 5 * dt);   // the rear wheels are locked
  const setV = () => { if (G.rev) G.rv = Math.min(0, nf); else d.v = Math.max(0, nf); G.vr = nr; };
  setV();
  let vNow = G.rev ? G.rv : d.v;
  Vx = fx * vNow + c1 * G.vr; Vz = fz * vNow - s1 * G.vr;
  G.x += Vx * dt; G.z += Vz * dt;

  // ---- what it hits ----
  let impact = 0, inx = 0, inz = 0;
  G.scraping = false;
  const reach = B.L / 2 - B.W / 2;
  for (let it = 0; it < 2; it++) for (const o of [reach, 0, -reach]) {
    if (!city.pushCircle(G.x + fx * o, G.z + fz * o, G.y, B.W * .5, _hit)) continue;
    G.x += _hit.x; G.z += _hit.z;
    const vn = Vx * _hit.nx + Vz * _hit.nz;
    if (vn < 0) {
      Vx -= 1.35 * vn * _hit.nx; Vz -= 1.35 * vn * _hit.nz;
      Vx *= .985; Vz *= .985;
      if (-vn > impact) { impact = -vn; inx = _hit.nx; inz = _hit.nz; }
    }
    if (Math.hypot(Vx, Vz) > 4) G.scraping = true;
  }
  for (const c of city.traffic.cars) {
    const dx = c.x - G.x, dz = c.z - G.z;
    if (dx * dx + dz * dz > 144 || Math.abs(c.y - G.y) > 1.6) continue;
    const cfx = -Math.sin(c.yaw), cfz = -Math.cos(c.yaw), cr = c.L / 2 - c.W / 2, m = (B.W + c.W) * .5 * .95;
    let best = 0, bnx = 0, bnz = 0;
    for (const o of [reach, 0, -reach]) for (const q of [cr, 0, -cr]) {
      const ex = G.x + fx * o - (c.x + cfx * q), ez = G.z + fz * o - (c.z + cfz * q), dd = Math.hypot(ex, ez);
      if (dd < m && dd > 1e-4 && m - dd > best) { best = m - dd; bnx = ex / dd; bnz = ez / dd; }
    }
    if (!best) continue;
    G.x += bnx * best; G.z += bnz * best;
    const vn = (Vx - cfx * c.v) * bnx + (Vz - cfz * c.v) * bnz;
    if (vn < 0) {
      Vx -= 1.25 * vn * bnx; Vz -= 1.25 * vn * bnz;
      city.traffic.shove(c, -bnx, -bnz, -vn);
      if (-vn > impact) { impact = -vn; inx = bnx; inz = bnz; }
      // they are not happy about it
      if (-vn > 3 && c.honkT <= 0) { c.honkT = 3; audio.honk?.(Math.max(-1, Math.min(1, -(bnx * c1 - bnz * s1))), c.body === "bus" || c.body === "truck", .9); }
    }
  }
  G.hitT = Math.max(0, G.hitT - dt);
  if (impact > 2.5 && G.hitT <= 0) {
    G.hitT = .25;
    audio.crash(Math.min(1, impact / 30));
    if (impact > 12) audio.musicHit?.();
    G.shake = Math.max(G.shake || 0, Math.min(1, impact / 14));
    for (let i = 0; i < Math.min(14, impact); i++) glows.add(G.x - inx * B.W * .5 + (Math.random() - .5), G.y + .4 + Math.random() * .5, G.z - inz * B.W * .5 + (Math.random() - .5), 1, .65, .25, .4 + Math.random() * .5);
  }
  nf = Vx * fx + Vz * fz; nr = Vx * c1 - Vz * s1;
  setV();
  vNow = G.rev ? G.rv : d.v;
  G.Vx = Vx; G.Vz = Vz;

  // ---- the ground under it ----
  const ground = city.heightAt(G.x, G.z, G.y);
  if (!G.air && ground < G.y - .35) { G.air = true; G.vy = Math.max(-8, Math.min(8, G.vyS || 0)); }
  if (G.air) {
    G.vy -= 22 * dt; G.y += G.vy * dt;
    if (G.y <= ground) {
      const hard = -G.vy;
      G.y = ground; G.vy = 0; G.air = false;
      if (hard > 5) { audio.crash(Math.min(.7, hard / 22)); G.shake = Math.max(G.shake || 0, Math.min(1, hard / 14)); }
    }
  } else { G.vyS = (ground - G.y) / Math.max(dt, 1e-3); G.y = ground; }
  if (!G.air) {
    const hl = B.L * .42, hw = B.W * .42, yr = G.y + .3;
    const hF = city.heightAt(G.x + fx * hl, G.z + fz * hl, yr), hR = city.heightAt(G.x - fx * hl, G.z - fz * hl, yr);
    const hRt = city.heightAt(G.x + c1 * hw, G.z - s1 * hw, yr), hLt = city.heightAt(G.x - c1 * hw, G.z + s1 * hw, yr);
    G.pitch += (Math.atan2(hF - hR, 2 * hl) - G.pitch) * Math.min(1, dt * 14);
    G.roll += (Math.atan2(hRt - hLt, 2 * hw) - G.roll) * Math.min(1, dt * 14);
  } else G.pitch *= Math.exp(-dt * .5);
  // lost off the map somehow: back to a spawn
  if (G.y < -4 || !Number.isFinite(G.x + G.z + G.y)) {
    const sp0 = city.spawnPoint(0);
    Object.assign(G, { x: sp0.x, z: sp0.z, y: 0, vy: 0, air: false, yaw: sp0.yaw, cy: sp0.yaw, vr: 0, rv: 0, rev: false, Vx: 0, Vz: 0, pitch: 0, roll: 0 });
    d.v = 0; G.snapCam = true;
  }

  // ---- score, slides, near misses ----
  const kmh = Math.abs(vNow) * 3.6;
  G.dist += Math.max(0, vNow) * dt;
  dailyTrack("miles", Math.max(0, vNow) * dt / 1609.344);
  dailyBest("mph", Math.round(kmh * .621371));
  if (kmh >= 60 && !G.rev) G.score += ((vNow * dt) / 10) * Math.max(1, kmh / 130);
  const slide = Math.abs(G.vr);
  if (slide > 2.5 && Math.abs(vNow) > 8) G.score += slide * dt * 4;
  audio.tires?.(Math.min(1, Math.max(0, (slide - 1.5) / 6)), 0, kmh);
  if (slide > 3 && !G.air) for (const k of [-1, 1]) smoke.emit(G.x - fx * B.L * .35 + c1 * k * B.W * .4, G.y + .2, G.z - fz * B.L * .35 - s1 * k * B.W * .4, Math.min(1, (slide - 3) / 6), Vx * .3, Vz * .3);
  G.comboT -= dt;
  if (G.comboT <= 0) G.combo = 0;
  _ccSeen.clear();
  for (const c of city.traffic.cars) {
    const dx = c.x - G.x, dz = c.z - G.z;
    if (dx * dx + dz * dz > 900 || Math.abs(c.y - G.y) > 2) continue;
    _ccSeen.add(c.id);
    const along = dx * fx + dz * fz, lat = dx * c1 - dz * s1, prev = G.prevDz.get(c.id);
    G.prevDz.set(c.id, along);
    if (prev === undefined || prev <= 0 || along > 0) continue;
    const gap = Math.abs(lat) - (c.W + B.W) / 2;
    if (gap > 3.2 || gap < -.2) continue;
    const cfx = -Math.sin(c.yaw), cfz = -Math.cos(c.yaw);
    audio.whoosh(Math.sign(lat) * .7, c.body === "truck" || c.body === "bus");
    const rel = Math.hypot(Vx - cfx * c.v, Vz - cfz * c.v);
    if (gap < 1.35 && kmh > 70 && rel > 12) cityCloseCall(c, gap, kmh, cfx * fx + cfz * fz < -.5);
  }
  for (const k of G.prevDz.keys()) if (!_ccSeen.has(k)) G.prevDz.delete(k);

  // ---- the car itself ----
  G.car.group.rotation.order = "YXZ";
  G.car.group.position.set(G.x, G.y, G.z);
  G.car.group.rotation.set(G.pitch, G.yaw, G.roll);
  G.latA += (yawRate * vNow - G.latA) * Math.min(1, dt * 6);   // cornering force: the body leans out of the turn
  G.car.bodyGroup.rotation.set(-G.brk * .012 + G.thr * .006, 0, Math.max(-.06, Math.min(.06, G.latA * .004)));
  G.car.group.visible = true;
  G.car.update(vNow * dt, G.steer);
  flames.pose(playerFlame, G.x, G.z, G.yaw, Vx, Vz, B, G.y);
  playerFlame.style = carStyle(def.id).flame ?? null;
  if (G.flameT > 0) {
    G.flameT -= dt;
    if (!audio.ready && Math.random() < dt * 14) flames.fire(playerFlame, 1 + (G.flameSize || 1) * 1.5, (G.flameSize || 1) > 1.5);
  }
}
// A pass in the city, graded like the highway's: how close, and how it was done.
function cityCloseCall(c, gap, kmh, oncoming) {
  G.combo = G.comboT > 0 ? G.combo + 1 : 1;
  G.comboT = 2.5; G.closeCalls++; G.bestCombo = Math.max(G.bestCombo || 0, G.combo);
  const i = Math.max(0, CC_TIERS.findIndex((t) => gap < t.gap)), tier = CC_TIERS[i];
  const pool = tier.words.filter((w) => w !== ccLastWord);
  const word = ccLastWord = pool[(Math.random() * pool.length) | 0];
  const tags = [];
  let bonus = 0;
  const tag = (name, pts) => { tags.push(name); bonus += pts; };
  if (oncoming) tag("ONCOMING", 30);
  if (c.link.kind === "conn") tag("JUNCTION", 20);
  if (Math.abs(G.vr) > 3) tag("SIDEWAYS", 25);
  if (c.body === "truck" || c.body === "bus") tag("BIG RIG", 10);
  if (kmh >= 200) tag("HIGH SPEED", 15);
  if ((sky.w?.rain || 0) > .4) tag("IN THE WET", 10);
  const n = G.combo, streak = CC_STREAKS[n] || (n > 50 && n % 10 === 0 ? "HIGHWAY GOD" : "");
  const cc = { word, tier: CC_TIERS.length - 1 - i, combo: n, pts: Math.round(20 * tier.mul) + bonus + (n - 1) * 10, tags, streak };
  G.score += cc.pts;
  dailyTrack("closeCalls"); dailyBest("streak", n);
  if (cc.tier === 3) dailyTrack("insane");
  if (tags.includes("BIG RIG")) dailyTrack("bigrig");
  ui.closeCall(cc);
  audio.closeCall(n, cc.tier, !!streak);
  if (n % 5 === 0) net.send({ t: "event", kind: "combo", v: n });
}
// everyone the city's traffic has to give way to
function cityPlayers() {
  const out = [];
  if (state === "drive" || state === "ready") { const B = BODIES[G.def.body]; out.push({ x: G.x, y: G.y, z: G.z, vx: G.Vx, vz: G.Vz, L: B.L, W: B.W }); }
  if (mode === "online") for (const r of remotes.values()) if (r.s && !r.s.cr && r.car.group.visible) {
    const B = BODIES[carById(r.carId).body] || BODIES.sedan;
    out.push({ x: r.s.x, y: r.s.y || 0, z: r.s.z, vx: r.s.vx || 0, vz: r.s.vz ?? -(r.s.v || 0), L: B.L, W: B.W });
  }
  return out;
}
// The city cameras. The chase cameras swing round behind the car as it turns (with a little lag, more
// at low speed) and are walked in towards the car whenever a building would be in the way; the hood and
// bumper cameras are fixed to the car and pitch with it.
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function updateCityCamera(dt) {
  const B = BODIES[G.def.body], v = Math.abs(G.rev ? G.rv : G.dt.v), kmh = v * 3.6, y0 = G.y || 0;
  if (G.cy === undefined || G.snapCam || state === "ready") G.cy = G.yaw;
  G.cy += Math.atan2(Math.sin(G.yaw - G.cy), Math.cos(G.yaw - G.cy)) * Math.min(1, dt * (2.5 + Math.min(4.5, v * .12)));
  const fx = -Math.sin(G.cy), fz = -Math.cos(G.cy), tall = camera.aspect < 1.1 ? 1.5 : 0;
  const lookBack = state === "drive" && held("Space");
  const hood = (camMode === 2 || camMode === 3) && !lookBack;
  const cc = camMode === CUSTOM_CAM ? customCam() : null;
  if (hood) {
    const bumper = camMode === 3, hx = -Math.sin(G.yaw), hz = -Math.cos(G.yaw), up = Math.tan(G.pitch || 0);
    const along = bumper ? B.L * .48 : B.L * .1, h = bumper ? .55 : B.top * .8 + .25;
    camera.position.set(G.x + hx * along, y0 + h + up * along, G.z + hz * along);
    camLook.set(G.x + hx * 30, y0 + (bumper ? .5 : B.top * .75) + up * 30, G.z + hz * 30);
    G.snapCam = false;
  } else {
    const far = camMode === 1, s = lookBack ? -1 : 1;
    const back = cc ? cc.dist : (far ? 12 : 8) + tall + B.L * .35 + kmh * .01;
    const h = cc ? cc.height : (far ? 4.4 : 2.7) + B.top * .45 + tall * .3;
    camPos.set(G.x - fx * back * s, y0 + h, G.z - fz * back * s);
    for (let i = 0; i < 10 && city.insideSolid(camPos.x, camPos.y, camPos.z); i++) camPos.lerp(tmpV.set(G.x, y0 + h, G.z), .2);
    if (G.snapCam || state === "ready" || lookBack) camera.position.copy(camPos);
    else camera.position.lerp(camPos, Math.min(1, dt * 8));
    G.snapCam = false;
    camLook.set(G.x + fx * 30 * s, y0 + (cc ? customLookY(cc) : 1.6 + tall * .4) + Math.tan(G.pitch || 0) * 18 * s, G.z + fz * 30 * s);
  }
  if (G.shake > 0) { G.shake -= dt * 1.4; camera.position.x += (Math.random() - .5) * G.shake * .5; camera.position.y += (Math.random() - .5) * G.shake * .5; }
  if (state === "drive" && kmh > 200) { const k = (kmh - 200) / 6000; camera.position.x += (Math.random() - .5) * k; camera.position.y += (Math.random() - .5) * k; }
  const view = lookBack || camMode === 3 ? "front" : camMode === 2 ? "interior" : camMode === 1 ? "far" : "exterior";
  if (G.engine && G.engine.lastView !== view) { G.engine.lastView = view; G.engine.event("view", { view }); }
  camera.lookAt(camLook);
  camera.fov = lookBack ? (cc ? Math.min(100, cc.fov + 8) : 70) : cc ? cc.fov + Math.min(14, kmh * .045) : hood ? (camMode === 3 ? 76 : 70) + Math.min(18, kmh * .05) : 58 + Math.min(20, kmh * .065);
}

function updateThrown(dt) {
  const t = G.thrown;
  if (!t) return;
  G.crashT += dt;
  if (state === "crashed" && G.crashT > (respawnMode() ? 1.3 : 1.15)) finishRun();
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
  if (inCity()) { updateCityCamera(dt); camera.updateProjectionMatrix(); camera.updateMatrixWorld(); return; }
  const v = G.dt ? G.dt.v : 0, kmh = v * 3.6;
  const target = new THREE.Vector3(), look = new THREE.Vector3();
  const B = BODIES[G.def.body];
  if (state === "ready") {
    // Sit exactly where the drive camera will be, so pressing PLAY / starting does not glide anywhere.
    const cc = camMode === CUSTOM_CAM ? customCam() : null;
    const back = cc ? cc.dist : 8 + B.L * .35, tall = camera.aspect < 1.1 ? 1.5 : 0;
    camera.position.set(G.x * .9, cc ? cc.height : 2.7 + B.top * .45 + tall * .3, G.z + back);
    look.set(G.x, cc ? customLookY(cc) : 1.6 + tall * .4, G.z - 30);
    camera.lookAt(look);
    camera.fov = cc ? cc.fov : 58;
  } else {
    const far = camMode === 1;
    const hood = camMode === 2 || camMode === 3;
    if (hood) {
      // bumper sits low and at the nose; hood sits on the scuttle just behind it
      const bumper = camMode === 3;
      target.set(G.x, bumper ? .55 : B.top * .8 + .25, G.z - (bumper ? B.L * .48 : B.L * .1));
      camera.position.copy(target);
      look.set(G.x + G.vx * .2, bumper ? .5 : B.top * .75, G.z - 30);
    } else {
      const tall = camera.aspect < 1.1 ? 1.5 : 0;
      const cc = camMode === CUSTOM_CAM ? customCam() : null;
      // a custom camera sits exactly where it was set: no speed pull-back, no per-car offset
      const back = cc ? cc.dist : (far ? 12 : 8) + tall + B.L * .35 + kmh * .01;
      target.set(G.x * .9, cc ? cc.height : (far ? 4.4 : 2.7) + B.top * .45 + tall * .3, G.z + back);
      if (G.snapCam) { camera.position.copy(target); G.snapCam = false; }
      else if (state === "drive") camera.position.lerp(target, Math.min(1, dt * 7)); else camera.position.lerp(tmpV.set(G.x * .8, target.y + 2, G.z + back + 4), Math.min(1, dt * 2));
      camera.position.z = state === "drive" ? Math.min(camera.position.z, G.z + back + (cc ? 0 : 2)) : camera.position.z;
      look.set(G.x, cc ? customLookY(cc) : 1.6 + tall * .4, G.z - 30);
      if (state !== "drive") look.set(G.x, .8, G.z);
    }
    if (G.shake > 0) { G.shake -= dt * 1.4; camera.position.x += (Math.random() - .5) * G.shake * .5; camera.position.y += (Math.random() - .5) * G.shake * .5; }
    if (state === "drive" && kmh > 200) { const s = (kmh - 200) / 6000; camera.position.x += (Math.random() - .5) * s; camera.position.y += (Math.random() - .5) * s; }
    // Hold Space: the chase camera swings round to the front of the car and looks back down the
    // road, so you see your own car with the traffic behind it - rather than dropping you into the
    // cabin, which is a different camera entirely.
    const lookBack = state === "drive" && held("Space");
    if (lookBack) {
      const tall = camera.aspect < 1.1 ? 1.5 : 0;
      const lc = camMode === CUSTOM_CAM ? customCam() : null;
      const ahead = lc ? lc.dist : (camMode === 1 ? 12 : 8) + tall + B.L * .35 + kmh * .01;
      camera.position.set(G.x * .9, lc ? lc.height : (camMode === 1 ? 4.4 : 2.9) + B.top * .45 + tall * .3, G.z - ahead);
      look.set(G.x, 1.5 + tall * .4, G.z + 30);
    }
    // where the listener is, for the engine mix (engine-dsp VIEWS): hood cam = cabin, bumper cam and
    // the look-back swing = in front of the car, far chase = further back, the rest = behind the car
    const view = lookBack || camMode === 3 ? "front" : camMode === 2 ? "interior" : camMode === 1 ? "far" : "exterior";
    if (G.engine && G.engine.lastView !== view) { G.engine.lastView = view; G.engine.event("view", { view }); }
    camera.lookAt(look);
    const fovCc = camMode === CUSTOM_CAM ? customCam() : null;
    camera.fov = lookBack ? (fovCc ? Math.min(100, fovCc.fov + 8) : 70) : fovCc ? fovCc.fov + Math.min(14, kmh * .045) : hood ? (camMode === 3 ? 76 : 70) + Math.min(18, kmh * .05) : 58 + Math.min(20, kmh * .065);
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
    G.engine.params(d.audioState(d.shiftT > 0 && G.thr > .3 ? .1 : G.thr, camMode === 1 ? .7 : camMode === 2 ? .95 : camMode === 3 ? 1 : .85));
  } else if (state !== "home") {
    G.engine.params({ rpm: d.s.idle * .6, throttle: 0, gain: 0, load: 0, boostNorm: 0 });
  }
}

// ---------------- HUD ----------------
const MPH = 0.621371; // speeds are shown in mph everywhere
const tachCtx = document.getElementById("tach").getContext("2d");
// The gauge face (dial, ticks, numbers) only changes with the car's redline, so it is drawn once into
// an offscreen canvas; each frame just copies it and draws the rev fill on top.
const TACH = 360, T_C = TACH / 2, T_R = 150, T_A0 = Math.PI * .75, T_SPAN = Math.PI * 1.5;
let tachFace = null, tachFaceKey = "";
function tachFaceFor(redline) {
  const maxR = Math.ceil(redline / 1000) * 1000 + 1000, key = String(maxR);
  if (tachFaceKey === key) return { face: tachFace, maxR };
  tachFaceKey = key;
  tachFace ||= Object.assign(document.createElement("canvas"), { width: TACH, height: TACH });
  const g = tachFace.getContext("2d");
  g.clearRect(0, 0, TACH, TACH);
  // dark disc so the gauge reads on a bright sky or a white car
  const bg = g.createRadialGradient(T_C, T_C, T_R * .35, T_C, T_C, T_R + 22);
  bg.addColorStop(0, "rgba(10,10,11,.82)"); bg.addColorStop(.82, "rgba(10,10,11,.72)"); bg.addColorStop(1, "rgba(10,10,11,0)");
  g.fillStyle = bg; g.beginPath(); g.arc(T_C, T_C, T_R + 22, 0, Math.PI * 2); g.fill();
  g.lineCap = "round";
  // track
  g.beginPath(); g.arc(T_C, T_C, T_R, T_A0, T_A0 + T_SPAN); g.lineWidth = 10; g.strokeStyle = "rgba(255,255,255,.07)"; g.stroke();
  // red zone as a thin outer band, not a heavy block
  g.beginPath(); g.arc(T_C, T_C, T_R + 11, T_A0 + T_SPAN * redline / maxR, T_A0 + T_SPAN); g.lineWidth = 3; g.strokeStyle = "rgba(255,69,58,.9)"; g.stroke();
  // ticks: long every 1000, short every 500
  for (let r = 0; r <= maxR; r += 500) {
    const a = T_A0 + T_SPAN * (r / maxR), major = r % 1000 === 0, red = r >= redline;
    const r0 = T_R - (major ? 24 : 18), r1 = T_R - 12;
    g.beginPath(); g.moveTo(T_C + Math.cos(a) * r0, T_C + Math.sin(a) * r0); g.lineTo(T_C + Math.cos(a) * r1, T_C + Math.sin(a) * r1);
    g.lineWidth = major ? 3 : 1.5; g.strokeStyle = red ? "rgba(255,69,58,.85)" : major ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.22)"; g.stroke();
  }
  g.font = "700 20px 'Barlow Condensed', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  for (let k = 0; k <= maxR / 1000; k++) {
    const a = T_A0 + T_SPAN * (k * 1000 / maxR), rr = T_R - 38;
    g.fillStyle = k * 1000 >= redline ? "#ff6b62" : "rgba(255,255,255,.7)";
    g.fillText(k, T_C + Math.cos(a) * rr, T_C + Math.sin(a) * rr);
  }
  return { face: tachFace, maxR };
}
function drawTach(rpm, redline, manual) {
  const g = tachCtx, { face, maxR } = tachFaceFor(redline);
  g.clearRect(0, 0, TACH, TACH);
  g.drawImage(face, 0, 0);
  const f = Math.max(0, Math.min(1, rpm / maxR)), end = T_A0 + T_SPAN * f;
  const shift = rpm > redline * .9;                 // shift light: the arc warms up, then flashes in manual
  const flash = shift && manual && Math.floor(performance.now() / 80) % 2 === 0;
  const grad = g.createConicGradient(T_A0, T_C, T_C);
  grad.addColorStop(0, "#8a8a85"); grad.addColorStop(.55, "#f4f4f0"); grad.addColorStop(.78, "#ff453a"); grad.addColorStop(1, "#ff453a");
  g.lineCap = "round";
  g.save();
  if (shift) { g.shadowColor = "rgba(255,69,58,.8)"; g.shadowBlur = 18; }
  g.beginPath(); g.arc(T_C, T_C, T_R, T_A0, Math.max(T_A0 + .001, end)); g.lineWidth = 10;
  g.strokeStyle = flash ? "#ffffff" : grad; g.stroke();
  g.restore();
  // bright tip where the fill ends
  g.beginPath(); g.arc(T_C + Math.cos(end) * T_R, T_C + Math.sin(end) * T_R, 6.5, 0, Math.PI * 2);
  g.fillStyle = shift ? "#fff" : "#f4f4f0"; g.fill();
}
let hudCache = {};
const driveModeEl = document.getElementById("driveMode");
function setText(el, v) { if (hudCache[el.id] !== v) { hudCache[el.id] = v; el.textContent = v; } }
const gearLabel = (g) => (g === 0 ? "N" : String(g));
function updateHud() {
  dailyFlush();
  if (state !== "drive" && state !== "crashed" && state !== "ended") return;
  const d = G.dt, kmh = (G.city ? Math.abs(G.rev ? G.rv : d.v) : d.v) * 3.6;
  setText(ui.el.score, Math.floor(G.score).toLocaleString());
  setText(ui.el.best, "BEST " + Math.max(P.best, Math.floor(G.score)).toLocaleString());
  const mph = Math.round(Math.abs(kmh) * MPH);
  setText(ui.el.speed, String(mph));
  setText(ui.el.dist, `${(G.dist / 1609.34).toFixed(1)} Mi`);
  setText(ui.el.gear, G.city && G.rev ? "R" : d.shiftT > 0 ? "-" : gearLabel(d.gear));
  setText(ui.el.gearMode, d.manual ? "MANUAL" : "AUTO");
  const comfort = P.settings.driveMode === "comfort";
  setText(driveModeEl, comfort ? "COMFORT" : "SPORT");
  driveModeEl.classList.toggle("comfort", comfort);
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
const playerLight = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), color: new THREE.Color(1, .97, .9), intensity: 7, range: 70, cosOuter: Math.cos(.42), cosInner: Math.cos(.16) };

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  if (state === "drive" && !paused && !document.hidden) adaptRes(dt);
  document.body.classList.toggle("cine-active", !!P.settings.cinematic && (state === "drive" || state === "crashed" || state === "ended"));

  if (!thumbsReady && canvas.width >= 480 && canvas.height >= 260) {
    thumbsReady = true;
    // real-model pictures come from the cache; everything else is drawn now
    ui.thumbs = { ...makeThumbs(CARS.filter((c) => !thumbCache.get(c.id)).map((c) => c.id)), ...thumbCache.all() };
    if (state === "home") ui.renderHome();
  }
  if (canvas.width !== Math.floor(innerWidth * renderer.getPixelRatio())) resize();

  if (state === "home") {
    renderer.setClearColor(0x0b0f19, 1);
    renderer.clear();
    const rect = previewEl.getBoundingClientRect();
    if (rect.width > 10 && !ui.anyModalOpen()) {
      if (!dragging && P.settings.spin !== false) showSpin += dt * .25;
      if (showCar) {
        showCar.group.rotation.y = showSpin;
        const sid = shownId || showCarId;
        showFlames.pose(showFlame, 0, 0, showSpin, 0, 0, BODIES[carById(sid).body] || BODIES.charger, DISC_TOP);
        showFlame.style = showFlamePreview?.id === sid ? showFlamePreview.flame : carStyle(sid).flame ?? null;
        showCar.setLights?.(0, false, false, 0);   // headlights and DRLs stay lit so the look can be previewed
        frameShowCam(carById(shownId || showCarId).body, rect.width / rect.height);
      }
      showFlames.update(dt, null, pxScale(rect.height * renderer.getPixelRatio(), showCam));
      renderShowroom(rect);
    }
    audio.update(0, 0, false);
    audio.musicEnv?.({ home: true, on: P.settings.musicFx !== false });
    if (traffic.evs.length) traffic.evs.length = 0;
    audio.evSirens?.([]);
    ui.music.setDuck(1);
    return;
  }

  const simDt = paused ? 0 : dt;
  const cityOn = inCity();
  // the city's signals keep cycling on the start line too
  if (mode === "solo" && (state === "drive" || state === "crashed" || state === "over" || (cityOn && state === "ready"))) soloT += simDt;
  const T = getT();
  glows.begin();
  lights.length = 0;
  if (cityOn) {
    // no highway traffic, emergency vehicles, police or bots in the city
    if (traffic.active.size) traffic.hideAll();
    if (traffic.evs.length) traffic.evs.length = 0;
    audio.evSirens?.([]);
  } else {
    traffic.setPlayers(allPlayers());
    // cars stuck behind a slow driver lean on the horn - loudest right behind you
    for (const h of traffic.step(simDt, T)) {
      const d = Math.hypot(h.x - G.x, h.z - G.z);
      if (d > 150) continue;
      audio.honk?.(Math.max(-1, Math.min(1, (h.x - G.x) / 12)), h.heavy, Math.min(1, 16 / Math.max(6, d)) * (h.me ? 1 : .6));
      if (h.flash) traffic.react(h.key, true);
    }
    updateEmergency(simDt, T);
  }

  if (state === "ready" && mode === "online" && partyRound) {
    const recap = lastResults && lastResults.round === partyRound - 1 ? `${lastResults.win ? "" + lastResults.by + " wins" : "" + lastResults.by + " crashed"} — ${lastResults.scores.map((p) => `${p.name} ${p.score.toLocaleString()}`).join(" · ")}` : net.room ? net.room.players.map((p) => p.name).join(" · ") : "";
    ui.setReady(`ROUND ${partyRound} · ${PARTY_MODES[partyMode()] || ""}${partyMode() === "target" ? " " + (net.room.target || 10000).toLocaleString() : ""}`, recap, T < 0 ? String(Math.ceil(-T)) : "GO!");
    if (T >= 0) startDriving();
  }
  if (state === "ended") { // coast to a stop after the round ended
    G.dt.v *= Math.exp(-simDt * 1.4); G.z -= G.dt.v * simDt;
    G.car.group.position.set(G.x, 0, G.z); G.car.update(G.dt.v * simDt, 0);
    flames.pose(playerFlame, G.x, G.z, G.yaw, 0, -G.dt.v, BODIES[G.def.body]);
  }
  if (state === "drive" && !paused) cityOn ? updateCityDrive(simDt, T) : updateDrive(simDt, T);
  if (!paused && !cityOn && (state === "drive" || state === "crashed")) police.update(simDt, T);
  if (!paused && !cityOn) bots.update(simDt, T);
  if (state === "drive" && mode === "solo" && soloMode() === "timeattack" && T >= TIME_ATTACK) endRunNow("time");
  if (state === "drive" && partyMode() === "timed" && partyRound && T >= (net.room.dur || 120)) {
    if (!G.sentWin && net.room.players?.[0]?.id === (net.me?.id ?? net.me?.code)) { G.sentWin = true; net.send({ t: "crash", round: partyRound, score: Math.floor(G.score), win: true, timed: true }); }
  }
  updateModeHud(T);
  if (state === "crashed" || state === "over") updateThrown(simDt);
  if (!paused) updateSignals(simDt);

  // player car lights
  if (G.car) {
    const night = sky.lampsOn ? 1 : 0, B = BODIES[G.def.body];
    const braking = state === "drive" && G.brk > .3;
    G.car.setLights(braking, !!G.sigL && G.sigOn, !!G.sigR && G.sigOn, sky.night);
    if (state === "drive" || state === "ready") {
      const cos = Math.cos(G.yaw), sin = Math.sin(G.yaw), gy = G.y || 0;
      const fwd = tmpV.set(-sin, Math.sin(G.pitch || 0), -cos);
      if (night) {
        playerLight.pos.set(G.x, gy + B.hl[1] + .15, G.z).addScaledVector(fwd, B.L / 2 + .2);
        playerLight.dir.copy(fwd).setY(fwd.y - .1).normalize();
        lights.push(playerLight);
      }
      for (const k of [-1, 1]) {
        const tp = carPt(G.x, G.z, G.yaw, k * (B.W / 2 - .35), B.L / 2), hp = carPt(G.x, G.z, G.yaw, k * (B.W / 2 - .35), -B.L / 2);
        if (night || braking) glows.add(tp[0], gy + B.tl[1], tp[1], 1, braking ? .12 : .04, .04, braking ? 1.6 : .7);
        if (G.city && G.rev) glows.add(tp[0], gy + B.tl[1] - .08, tp[1], .9, .9, .88, .8);   // reversing lights
        if (night) glows.add(hp[0], gy + B.hl[1], hp[1], 1, .96, .85, 1.6);
        if (G.sigOn && ((k < 0 && G.sigL) || (k > 0 && G.sigR))) { glows.add(tp[0], gy + B.tl[1], tp[1] + .02, 1, .55, .05, 1.1); glows.add(hp[0], gy + B.hl[1], hp[1], 1, .55, .05, 1.1); }
      }
    }
  }

  updateCamera(dt);
  const focus = tmpV.set(G.x, cityOn ? G.y : 0, G.z).clone();
  const speedNow = state === "drive" ? (cityOn ? Math.abs(G.rev ? G.rv : G.dt.v) : G.dt.v) : 0;
  sky.update(dt, camera, focus, speedNow, audio);
  let cityEnv = null;
  if (cityOn) {
    // the city's own traffic, signals and lamps; its drivers' horns come back to be voiced here
    for (const h of city.update(simDt, T, focus, camera, sky, glows, lights, cityPlayers())) {
      const c = h.c, dist = Math.hypot(c.x - G.x, c.z - G.z);
      if (dist > 150) continue;
      const side = (c.x - G.x) * Math.cos(G.yaw) - (c.z - G.z) * Math.sin(G.yaw);
      audio.honk?.(Math.max(-1, Math.min(1, side / 12)), h.heavy, Math.min(1, 16 / Math.max(6, dist)));
    }
    if ((G.mapT = (G.mapT || 0) - dt) <= 0) {
      G.mapT = 1 / 30;
      const dots = [];
      for (const r of remotes.values()) if (r.s && !r.s.cr && r.car.group.visible) dots.push({ x: r.s.x, z: r.s.z, color: r.color });
      city.drawMinimap(G.x, G.z, G.yaw, dots);
    }
    cityEnv = city.envAt(G.x, G.y, G.z);
    sky.tunnel = 0;
  } else {
    world.update(focus, sky, glows, lights, dt);
    sky.tunnel = world.tunnel;
  }
  // what the surroundings do to the sound: the ring's underside booms like a tunnel, downtown slaps back
  const tun = cityEnv ? cityEnv.tunnel : world.tunnel, env = cityEnv ? cityEnv.env : cityAt(G.z);
  if (audio.ready) {
    audio.setTunnel(state === "home" ? 0 : tun); audio.setEnv(state === "home" ? 0 : env, cityEnv ? cityEnv.boost : 0);
    audio.musicEnv?.({ tunnel: tun, city: env, view: G.engine?.lastView || "exterior", paused, on: P.settings.musicFx !== false });
    ui.music.setDuck(paused && P.settings.musicFx !== false ? .5 : 1);   // a streamed track can only be dipped, not filtered
  }
  if (!cityOn) traffic.update(simDt, T, G.z, sky.lampsOn, glows, lights, camera.position, state === "home" ? null : shieldHidden());
  const peerList = mode === "online" ? updateRemotes(T, dt) : null;
  if (!paused) updateCatchUp(simDt, peerList);
  flames.update(simDt, lights, pxScale(renderer.domElement.height, camera));
  uploadLights(lights, camera);
  glows.end(renderer.domElement.height);
  smoke.update(paused ? 0 : dt);
  updateEngineSound(dt);
  audio.update(state === "drive" && !paused ? speedNow * 3.6 : 0, sky.w.rain, G.scraping && state === "drive");
  if (audio.ready) audio.setReverb(cityEnv ? cityEnv.reverb : .05 + cityAt(G.z) * .16);
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
        T: +T.toFixed(3), x: +G.x.toFixed(2), z: +G.z.toFixed(2), y: +(t ? t.pos.y : G.city ? G.y : 0).toFixed(2),
        ry: +gp.rotation.y.toFixed(3), pitch: +gp.rotation.x.toFixed(3), roll: +gp.rotation.z.toFixed(3),
        w: Math.round(net.now()), rd: partyRound, tp: G.tpN | 0,
        // world velocity: in the city a car can point anywhere, so both components are sent
        vx: +(G.city ? G.Vx : G.vx).toFixed(2), vz: +(G.city ? G.Vz : -d.v).toFixed(2), v: +(G.city ? Math.abs(G.rev ? G.rv : d.v) : d.v).toFixed(2),
        rpm: Math.round(d.rpm), thr: +G.thr.toFixed(2), ld: +d.load.toFixed(2), g: d.gear, sh: d.shiftT > 0 ? 1 : 0,
        bo: Math.round((d.s.boostMax ? d.boost / d.s.boostMax : 0) * 100),
        brk: G.brk > .3 ? 1 : 0, sl: G.sigL && G.sigOn ? 1 : 0, sr: G.sigR && G.sigOn ? 1 : 0,
        cr: state !== "drive" ? 1 : 0, sc: Math.floor(G.score),
      };
      // identity + engine character: twice a second, and right away when something changes
      if ((G.cfgTick = (G.cfgTick || 0) - 1) <= 0 || G.cfgDirty) {
        G.cfgTick = 10; G.cfgDirty = 0;
        const tq = Math.round(T * 2) / 2; // a time both clients can hash at
        s.c = { car: G.def.id, col: carColor(G.def.id), st: carStyle(G.def.id), md: P.settings.driveMode === "sport" ? 0 : 1, a: carAudio(G.def.id), tq, th: traffic.worldHash(tq) };
      }
      net.send({ t: "state", s });
    }
  }

  renderer.setClearColor(0x000000, 1);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.shadowMap.enabled = P.settings.shadows;
  if (bloomPass) bloomPass.strength = P.settings.bloom ? BLOOM.strength * bloomNightFalloff(sky.night) : 0;
  if (bloomOn()) composer.render(); else renderer.render(scene, camera);
}

// ---------------- settings ----------------
// How many lamps the per-pixel lighting loop sees at night. It is the loop that costs, not the
// lamps: measured, 32 lamps cost 13.1ms a frame against 10.3 for the nearest 20, and the dropped
// ones are the farthest and dimmest. The default is the middle option.
const LAMP_BUDGETS = [10, 20, 32];
// Graphics Quality bundles every other graphics setting into one pick. Picking one overwrites the
// individual sliders (same idea as the time-of-day presets); leaving it on Custom leaves them alone.
// Shadow map size and reflection sharpness have no sliders of their own - only a preset sets them.
const GFX_TIERS = [
  { name: "Low", shadows: false, shadowSize: 1024, res: .75, scenery: .5, view: .5, bloom: false, nightLights: 0, reflSize: 48, reflInterval: 3.5 },
  { name: "Medium", shadows: true, shadowSize: 1536, res: 1, scenery: .75, view: .75, bloom: true, nightLights: 1, reflSize: 80, reflInterval: 2.2 },
  { name: "High", shadows: true, shadowSize: 2048, res: 1, scenery: 1, view: 1, bloom: true, nightLights: 1, reflSize: 128, reflInterval: 1.5 },
  { name: "Ultra", shadows: true, shadowSize: 3072, res: 1.25, scenery: 1.25, view: 1.1, bloom: true, nightLights: 2, reflSize: 192, reflInterval: 1 },
  { name: "RTX", shadows: true, shadowSize: 4096, res: 1.5, scenery: 1.5, view: 1.25, bloom: true, nightLights: 2, reflSize: 256, reflInterval: .6 },
];
function applyGfxTier(i) {
  const t = GFX_TIERS[i]; if (!t) { P.settings.gfx = -1; save(); return; }
  Object.assign(P.settings, { gfx: i, shadows: t.shadows, res: t.res, scenery: t.scenery, viewDist: t.view, bloom: t.bloom, nightLights: t.nightLights });
  applySettings();
}
function applySettings() {
  const s = P.settings;
  setLampBudget(LAMP_BUDGETS[s.nightLights ?? 1] ?? 20);
  // scenery density and view distance rebuild the world, so nudge it to notice
  world.density = s.scenery ?? 1;
  world.viewDist = s.viewDist ?? 1;
  world.lastK = null;
  if (bloomPass) bloomPass.strength = s.bloom ? BLOOM.strength * bloomNightFalloff(sky.night || 0) : 0;
  sky.hour = s.hour; sky.flow = s.flow; sky.setStyle(s.sky); sky.setWeather(s.weather);
  const t = GFX_TIERS[s.gfx];
  sky.setReflQuality(t ? t.reflSize : 128, t ? t.reflInterval : 1.5);
  sky.setShadowSize(t ? t.shadowSize : 3072);
  audio.vol = { master: s.volMaster, engine: s.volEngine, fx: s.volFx };
  audio.applyVolumes();
  resize();
  save();
}
setInterval(() => { if (sky.flow) { P.settings.hour = sky.hour; save(); ui.syncTime?.(sky.hour); } }, 2000);

// ---------------- show off: my build goes to the party, theirs can be viewed in the garage ----------------
function myBuild() {
  const id = P.equipped, t = carTune(id), car = carById(id);
  const parts = Object.entries(PARTS).filter(([k]) => t[k] && t[k] !== "stock").map(([k, d]) => d.opts[t[k]].label);
  return { car: id, col: carColor(id), st: carStyle(id), hp: peakHp(car, t), parts: parts.slice(0, 12) };
}
let lastBuild = "";
setInterval(() => {
  const b = myBuild(), key = JSON.stringify(b);
  if (key !== lastBuild && net.me) { lastBuild = key; net.send({ t: "setBuild", build: b }); }
}, 2000);
let showOffKey = null;
function showOffCar(b) {
  if (!b || !CARS.some((c) => c.id === b.car)) return false;
  if (hasModel(b.car) && !MODELS[b.car]) ensureModel(b.car).then((ok) => { if (ok && showOffKey === JSON.stringify(b)) showOffCar(b); });
  if (pendingShow) { pendingShow.car?.dispose(); pendingShow = null; }
  if (showCar) { show.remove(showCar.group); showCar.dispose(); }
  showCar = makeCar(b.car, b.col ?? carById(b.car).color);
  if (b.st) showCar.applyStyle?.(b.st);
  showCar.group.traverse((o) => (o.castShadow = true));
  showCar.group.position.y = DISC_TOP;
  show.add(showCar.group);
  showCarId = shownId = b.car; showOffKey = JSON.stringify(b);
  return true;
}
function endShowOff() { if (!showOffKey) return; showOffKey = null; const id = showCarId; showCarId = null; setShowCar(ui.view || P.equipped); }

// ---------------- garage engine preview ----------------
let paintTimer = 0, revVoice = null;
// rev only while the button is held: climbs to the limiter, lift-off burbles/flutter on release
const rev = { hold: false, rpm: 900, timer: null, spec: null, idleT: 0 };
async function revHold(sound, carId = P.equipped, on = true) {
  await audio.init();
  audio.vol = { master: P.settings.volMaster, engine: P.settings.volEngine, fx: P.settings.volFx, wind: P.settings.volWind };
  audio.applyVolumes();
  if (!revVoice) {
    revVoice = audio.engine(sound);
    revVoice.onFire = (amp, big) => { if (state === "home") showFlames.fire(showFlame, amp, big); };
  }
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

// ---------------- workshop dyno pull ----------------
// A full-throttle pull on the rollers in fourth: from 2,000 rpm the revs climb only as fast as the
// engine's torque at each rpm can spin the drum up - a turbo engine surges once its boost arrives -
// then it bounces off the limiter, lifts, and crackles back down to idle. onTick(rpm, phase) lets
// the workshop trace the curve as it happens; resolves once the engine is back at idle.
let dynoBusy = false;
async function dynoPull(sound, carId, onTick) {
  if (dynoBusy) return;
  dynoBusy = true;
  await audio.init();
  audio.vol = { master: P.settings.volMaster, engine: P.settings.volEngine, fx: P.settings.volFx, wind: P.settings.volWind };
  audio.applyVolumes();
  if (!revVoice) {
    revVoice = audio.engine(sound);
    revVoice.onFire = (amp, big) => { if (state === "home") showFlames.fire(showFlame, amp, big); };
  }
  revVoice.setProfile(sound);
  revVoice.tune(carAudio(carId), P.settings.driveMode);
  clearInterval(rev.timer); rev.timer = null; rev.hold = false;       // the hold-to-rev loop hands over
  const sp = tunedSpec(carId, carTune(carId)), lim = sp.redline, idle = sp.idle, start = Math.max(idle + 300, 2000);
  let peak = 1;
  for (let r = start; r <= lim; r += 100) peak = Math.max(peak, sp.torqueAt(r));
  const boostN = (r) => (sp.boostMax ? Math.min(1, Math.max(0, sp.boostAt(r) / sp.boostMax)) : 0);
  let rpm = idle, phase = "spool", t = 0, limT = 0, nextCut = 0;
  const dt = .025;
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      t += dt;
      let thr = 1, load = 1;
      if (phase === "spool") {                 // settle onto the rollers at the start of the pull
        rpm += (start - rpm) * Math.min(1, dt * 4); thr = .35; load = .3;
        if (t > .8) phase = "pull";
      } else if (phase === "pull") {
        // drum inertia set so a typical engine takes about five seconds from 2,000 rpm to the limiter
        rpm += Math.max(.15, sp.torqueAt(rpm) / peak) * (lim - start) / 4.6 * dt;
        if (rpm >= lim) { rpm = lim; phase = "limit"; }
      } else if (phase === "limit") {          // held flat against the limiter for a moment
        limT += dt;
        if ((nextCut -= dt) <= 0) { revVoice.event("limiter"); nextCut = .11; }
        rpm = lim * (.975 + .02 * Math.random());
        if (limT > .8) { phase = "lift"; revVoice.event("lift", { rpm: lim, load: 1, release: 10, boost: boostN(lim), gear: 4 }); }
      } else {                                 // off the throttle: burble back down to idle
        thr = 0; load = 0;
        rpm += (idle - rpm) * Math.min(1, dt * 1.5);
        if (rpm < idle * 1.06) phase = "done";
      }
      revVoice.params({ rpm, throttle: thr, gain: .9, load, boostNorm: boostN(rpm) * load, gear: 4, redline: lim, warmth: 1 });
      onTick?.(rpm, phase);
      if (phase === "done") { clearInterval(timer); resolve(); }
    }, 25);
  });
  dynoBusy = false;
  // quiet again after a moment at idle, as after holding the rev button
  setTimeout(() => { if (!rev.timer && !dynoBusy) revVoice.params({ rpm: idle, throttle: 0, gain: 0, load: 0 }); }, 2500);
}

// ---------------- boot ----------------
const ui = new UI({
  net, audio, sky,
  thumbs: {},
  selectCar: (id) => { if (!showOffKey) setShowCar(id); },
  showOff: showOffCar, endShowOff,
  keyActions: KEY_ACTIONS, keyOf,
  setGfxTier: applyGfxTier,
  // custom camera editor
  renderCamPreview,
  getCustomCam: () => customCam(),
  useCustomCam: () => { camMode = CUSTOM_CAM; P.settings.cam = camMode; G.snapCam = true; save(); ui.toast(CAMS[camMode], [], "info"); },
  SOLO_MODES, PARTY_MODES,
  // preview: shown on the garage car only, nothing saved or charged
  previewStyle: (id, style) => { if (showCarId === id) showTarget()?.applyStyle?.(style); showFlamePreview = { id, flame: style.flame ?? null }; },
  styleCar: (id) => {
    showFlamePreview = null;
    if (showCarId === id) showTarget()?.applyStyle?.(carStyle(id));
    if (G.car && G.def.id === id) G.car.applyStyle?.(carStyle(id));
    G.cfgDirty = 1;
    clearTimeout(paintTimer);
    paintTimer = setTimeout(() => { Object.assign(ui.thumbs, makeThumbs([id])); if (state === "home") ui.renderHome(); }, 250);
  },
  paintCar: (id, hex) => {
    P.colors[id] = hex; save();
    if (showCarId === id) showTarget()?.setColor(hex);
    clearTimeout(paintTimer);
    paintTimer = setTimeout(() => { Object.assign(ui.thumbs, makeThumbs([id])); if (state === "home") ui.renderHome(); }, 250);
  },
  revPreview,
  revHold,
  dynoPull,
  applyTune,
  currentCar: () => G.def.id, switchCar, leaveServer, playerRows, teleportTo, freeMode,
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
  if (m.kind === "crash") ui.toast(`${m.name} crashed at ${m.v.toLocaleString()}`);
  if (m.kind === "combo") ui.toast(`${m.name} is on a x${m.v} close-call streak`);
  if (m.kind === "bump" && m.d) {
    const [key, vx, vr, tt] = String(m.d).split("|");
    traffic.bumpRemote(key, m.v, { vx: +vx || 0, vr: +vr || 0 }, Math.max(0, getT() - (+tt || 0)));
  }
});

applySettings();
loader.stage("Building the world", "Roads, scenery and lighting");
await loader.breathe();
sky.update(0.016, camera, new THREE.Vector3(), 0);
world.update(new THREE.Vector3(), sky, glows, lights, 1);
loader.stage("Loading cars", "Reading the garage list");
await loadModels();
try { await loadCarAssets(); } catch (e) { console.warn("car assets", e); }
loader.stage("Almost there", "Fitting your car");
await ensureModel(P.equipped);
setShowCar(P.equipped);
// the pictures the loader just drew are already cached, so the garage is complete when it appears
ui.thumbs = { ...ui.thumbs, ...thumbCache.all() };
ui.show("home");
ui.renderHome();
requestAnimationFrame(frame);
// Sign in over the loading video. The account may bring a different save - its own garage, car and
// settings - so everything built from the save is refreshed before the screen fades away.
await loader.signIn();
applySettings();
await ensureModel(P.equipped);
setShowCar(P.equipped);
ui.view = P.equipped;
ui.renderHome();
net.connect(P.name, P.equipped);
await loader.finish();

window.__ui = ui;
window.__game = {
  G, sky, traffic, net, world, renderer, scene, camera, glows, frame, remotes, NET, CATCHUP,
  get composer() { return composer; }, get bloomPass() { return bloomPass; },
  audio, get pending() { return G.pending || 0; },
  get state() { return state; }, get mode() { return mode; },
  // quick sync check: two clients in the same party must print the same numbers
  trafficHash: () => traffic.stateHash(getT(), G.z),
  worldHash: (T) => traffic.worldHash(T ?? Math.round(getT() * 2) / 2),
  syncStats: () => ({ ok: syncOk, bad: syncBad }),
};

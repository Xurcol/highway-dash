// ARCLINE boots only the hero city; Highway Rush has its own preserved project and Git branch.
import * as THREE from "three";
import { SkySystem, SKY_STYLES, WEATHERS } from "./sky.js?v=mvq292b7";
import { City } from "./city.js?v=mvq292b7";
import { Glows, uploadLights, setLampBudget } from "./lights.js?v=mvq292b7";
import { AudioManager } from "./audio.js?v=mvq292b7";
import { createNet } from "./net.js?v=mvq292b7";
import { HeroMode } from "./hero.js?v=mvq292b7";
import { P, save, signOut } from "./arcline-profile.js?v=mvq292b7";
import { signIn } from "./auth.js?v=mvq292b7";
import { GameMusic } from "./game-music.js?v=mvq292b7";
import { StartupScene } from "./startup-scene.js?v=mvq292b7";
import { ArclineUI } from "./arcline-ui.js?v=mvq292b7";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const FPS_CAPS = [30, 60, 90, 120, 144, 165, 240];
const QUALITY = {
  low: { dpr: .85, lamps: 8, traffic: 36, shadows: false, shadowSize: 512, reflections: 32, view: .8 },
  medium: { dpr: 1.25, lamps: 12, traffic: 68, shadows: false, shadowSize: 1024, reflections: 48, view: 1 },
  high: { dpr: 1.5, lamps: 20, traffic: 96, shadows: true, shadowSize: 1024, reflections: 80, view: 1.35, post: true },
  ultra: { dpr: 2, lamps: 24, traffic: 120, shadows: true, shadowSize: 2048, reflections: 96, view: 1.6, post: true, city: "high" },
};
// Speed: the frame smears outwards from the middle and the very edges fringe, only once the hero is
// really moving (uRush comes from the hero's speed).
const RUSH = {
  uniforms: { tDiffuse: { value: null }, uRush: { value: 0 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uRush; varying vec2 vUv;
    void main() {
      vec2 d = vUv - .5; float k = uRush * smoothstep(.1, .72, length(d));
      vec4 c = texture2D(tDiffuse, vUv);
      if (k > .002) {
        vec4 acc = c;
        for (int i = 1; i < 6; i++) acc += texture2D(tDiffuse, vUv - d * k * .03 * float(i));
        c = acc / 6.;
        c.r = mix(c.r, texture2D(tDiffuse, vUv - d * k * .014).r, .7);
        c.b = mix(c.b, texture2D(tDiffuse, vUv + d * k * .014).b, .7);
      }
      gl_FragColor = c;
    }`,
};
const unit = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;

export async function bootArcline() {
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("c"), antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x8b99aa, 60, 1100);
  const camera = new THREE.PerspectiveCamera(66, 1, .1, 2200);
  const sky = new SkySystem(renderer, scene), city = new City(renderer, scene), glows = new Glows(scene, 1200);
  const startup = new StartupScene();
  const audio = new AudioManager(), net = await createNet(); net.sendRate = 15;
  let ui, active = false, online = false, paused = true, entering = false, wantsOnline = false, pendingPractice = false, roomCode = null, soloTime = 0;
  const music = new GameMusic(P.settings, save, () => active ? "game" : "lobby");
  let composer = null, bloom = null, rush = null;
  let scale = 1, slowT = 0, quality = QUALITY.medium, sendT = 0, mapT = 0, envT = 0, lifeT = 0, adaptiveT = 0, avgDt = 1 / 60;
  const lights = [], ambience = { night: 0, height: 0, rain: 0, traffic: .6, wind: 0, enabled: false };
  const hero = new HeroMode({ renderer, scene, camera, sky, city, audio, net, P, save, get ui() { return ui; } });
  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.dpr) * scale);
    renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / Math.max(1, innerHeight); camera.updateProjectionMatrix();
    if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); }
  }
  // Bloom and the speed smear: a post-processing chain on High and Ultra (the plain render otherwise)
  function setPost(on) {
    if (on && !composer) {
      try {
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .42, .5, .92);
        composer.addPass(bloom);
        rush = new ShaderPass(RUSH); composer.addPass(rush);
        composer.addPass(new OutputPass());
      } catch (error) { console.warn("Post-processing unavailable", error); composer?.dispose(); composer = null; }
    } else if (!on && composer) { composer.dispose(); composer = bloom = rush = null; }
  }
  function renderFrame() {
    if (!active) { startup.render(renderer, camera.aspect); return; }
    if (composer) {
      const night = sky.night || 0;
      bloom.strength = .32 + night * .3; bloom.threshold = .95 - night * .12;
      rush.uniforms.uRush.value = active && !hero.photo?.on ? Math.max(0, Math.min(1, (hero.speed - 26) / 34)) : 0;
      composer.render();
    } else renderer.render(scene, camera);
  }
  hero.ctx.renderFrame = renderFrame;
  function applySettings(key) {
    const settings = P.settings;
    if (key === "heroMode") hero.flash?.set(settings.heroMode === "flash");
    if (!key || key === "graphics" || key === "noPost") {
      quality = QUALITY[settings.graphics] || QUALITY.medium;
      city.setDetail(quality.city || settings.graphics || "medium"); setLampBudget(quality.lamps);
      setPost(!!quality.post && !settings.noPost);
      renderer.shadowMap.enabled = quality.shadows; sky.setShadowSize(quality.shadowSize); sky.viewDist = quality.view; slowT = 0;
      sky.setReflQuality(quality.reflections, 4); sky.envKey = null;
      // Let traffic replenish at the new budget without deleting cars involved in an active mission.
      if (city.traffic) city.traffic.target = quality.traffic;
      scale = 1; resize();
    }
    if (!key || ["hour", "flow", "sky", "weather"].includes(key)) {
      sky.hour = Number.isFinite(Number(settings.hour)) ? Number(settings.hour) : 17.5; sky.flow = !!settings.flow;
      sky.setStyle(SKY_STYLES.includes(settings.sky) ? settings.sky : "Natural");
      sky.setWeather(WEATHERS[settings.weather] ? settings.weather : "Clear");
    }
    audio.vol = { master: unit(settings.volMaster, .8), engine: 0, fx: unit(settings.volFx, .8), wind: unit(settings.volWind, .3) };
    audio.applyVolumes();
    music.settings = P.settings;
    if (!key || key === "music") music.configure();
  }
  function pause(on) {
    paused = on;
    if (on) { hero.activities?.closeMenu(); hero.worldMap?.close(); hero.photo?.close(); hero.input.unlock(); audio.cityAmbience(0); audio.update(0, 0, false, 0); }
    hero.input.wantLock = active && !on;
  }
  async function enter(asOnline) {
    if (!asOnline) {
      wantsOnline = false;
      if (net.room) { online = false; net.send({ t: "roomLeave" }); }
    }
    if (entering) { if (!asOnline) pendingPractice = true; return; }
    if (asOnline && (!wantsOnline || net.gotInfo === false)) return;
    if (asOnline && (!net.room || net.room.mode !== "hero")) return ui.open("lobby");
    const nextCode = asOnline ? net.room.code : null;
    if (active && online === asOnline && roomCode === nextCode) return ui.close();
    entering = true; ui.loading("ENTERING NEW MERIDIAN", "Preparing the city and your hero…");
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (asOnline && (!wantsOnline || !net.connected || net.room?.code !== nextCode || net.gotInfo === false)) { ui.loaded(); return; }
      if (hero.on) hero.exit();
      hero.enter({ online: asOnline, index: asOnline ? Math.max(0, net.room.players.findIndex(player => player.id === net.me?.id)) : 0 });
      active = true; online = asOnline; roomCode = nextCode; soloTime = 0;
      city.resetTraffic(hero.focus, quality.traffic);
      document.getElementById("hud").hidden = false; document.getElementById("arcBar").hidden = false;
      lifeT = sendT = mapT = envT = 0; ui.close(); ui.render(); ui.loaded();
    } catch (error) {
      try { hero.exit(); } catch { }
      active = online = wantsOnline = false; roomCode = null; city.show(false); audio.cityAmbience(0);
      document.getElementById("hud").hidden = document.getElementById("arcBar").hidden = true;
      if (asOnline && net.room?.code === nextCode) net.send({ t: "roomLeave" });
      ui.loaded(); ui.toast(error.message || "The city could not start.", [], "error"); ui.open("lobby");
    } finally {
      entering = false;
      if (pendingPractice) { pendingPractice = false; queueMicrotask(() => enter(false)); }
      else if (wantsOnline && net.connected && net.room?.mode === "hero" && net.gotInfo !== false && net.room.code !== roomCode) queueMicrotask(() => enter(true));
    }
  }
  function roomChanged(fresh) {
    if (net.room && net.gotInfo === false) return;
    if (net.room?.mode === "hero") {
      if (active && online && roomCode === net.room.code) {
        if (typeof net.room.hour === "number") { sky.hour = net.room.hour; sky.flow = false; }
        if (WEATHERS[net.room.weather]) sky.setWeather(net.room.weather);
        return;
      }
      if (wantsOnline && (fresh || !active || !online || roomCode !== net.room.code)) enter(true);
    } else if (active && online) {
      hero.exit(); active = online = false; roomCode = null; city.show(false); audio.cityAmbience(0);
      document.getElementById("hud").hidden = document.getElementById("arcBar").hidden = true;
      ui.open("lobby");
    }
  }
  function activities() { if (active) { ui.close(); hero.activities.toggleMenu(); } }
  function chat(text) {
    if (text.startsWith("/")) {
      const [command, ...args] = text.slice(1).split(/\s+/), arg = args.join(" ");
      let result;
      if (command === "race") result = hero.startActivity("race", arg);
      else if (command === "tricks") result = hero.startActivity("tricks");
      else if (command === "emote" || command === "e") result = hero.emoteByName(arg);
      else if (command === "players") return ui.togglePlayers();
      else if (command === "tp" || command === "visit") {
        const target = hero.playerRows().find(player => !player.me && player.name.toLowerCase().startsWith(arg.toLowerCase()));
        result = target ? hero.teleportTo(target.id) : { ok: false, text: "Hero not found in this city." };
      } else return ui.chatLine("Controls", "/players · /visit name · /race · /tricks · /emote name");
      ui.toast(result?.text || "Done"); return;
    }
    if (online && net.room) net.send({ t: "chat", text: text.slice(0, 120) });
  }
  ui = new ArclineUI({ net, hero, P, save, applySettings, enter, pause, active: () => active, roomChanged, activities, chat,
    requestOnline(on = true) { wantsOnline = on; if (on) pendingPractice = false; },
    signOut() { pause(true); hero.exit(); signOut(); location.reload(); },
  });
  applySettings();
  addEventListener("resize", resize);
  const startAudio = () => { music.gesture(); audio.init({ hero: true }).catch(() => {}); };
  document.addEventListener("pointerdown", startAudio, { passive: true });
  document.addEventListener("keydown", event => {
    if (!active || event.repeat) return;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (event.code === "Escape") {
      event.preventDefault();
      if (!document.getElementById("arcChatForm").hidden) return ui.closeChat();
      if (!document.getElementById("arcPlayers").hidden) return ui.togglePlayers();
      if (hero.activities.menuEl && !hero.activities.menuEl.hidden) return hero.activities.closeMenu();
      return ui.menuOpen ? ui.close() : ui.open();
    }
    if (typing) return;
    if (event.code === "KeyK" && hero.activities.menuEl && !hero.activities.menuEl.hidden) { event.preventDefault(); hero.activities.closeMenu(); return; }
    if (event.code === "Enter") { event.preventDefault(); ui.openChat(); }
    if (event.code === "Tab") event.preventDefault(); // HeroInput opens the map.
    // P belongs to HeroInput's camera toggle; Escape handles the city menu.
    startAudio();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { music.suspend(); audio.cityAmbience(0); audio.update(0, 0, false, 0); hero.input.clear(); save(); }
    lastFrame = performance.now();
  });
  renderer.domElement.addEventListener("webglcontextlost", event => { event.preventDefault(); pause(true); ui.toast("Graphics paused. Reload the page to recover.", [], "warn"); });

  let lastFrame = performance.now();
  let fpsFrames = 0, fpsElapsed = 0, measuredFps = 0, nextFrame = 0, previousCap = -1;
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { lastFrame = now; nextFrame = 0; fpsFrames = 0; fpsElapsed = 0; return; }
    music.update(now);
    // Keep a separate render deadline: discarded fractions otherwise lower the effective cap.
    const cap = FPS_CAPS.includes(Number(P.settings.fpsLimit)) ? Number(P.settings.fpsLimit) : 0;
    if (cap !== previousCap) { nextFrame = now; previousCap = cap; }
    if (cap) {
      const interval = 1000 / cap;
      if (now + .25 < nextFrame) return;
      nextFrame += interval;
      if (nextFrame <= now) nextFrame += (Math.floor((now - nextFrame) / interval) + 1) * interval;
    }
    const elapsed = Math.max(.001, (now - lastFrame) / 1000);
    const dt = Math.min(.05, elapsed); lastFrame = now;
    // Count rendered frames with real elapsed time, not the capped physics timestep.
    if (active) {
      fpsFrames++; fpsElapsed += elapsed;
      if (fpsElapsed >= .5) {
        measuredFps = Math.round(fpsFrames / fpsElapsed);
        hero.hud.set("hhFps", `${measuredFps} FPS · ${cap ? "CAP " + cap : "UNCAPPED"}`);
        fpsFrames = 0; fpsElapsed = 0;
      }
    } else { fpsFrames = 0; fpsElapsed = 0; }
    glows.begin(); lights.length = 0;
    if (active) {
      const simDt = online || !paused ? dt : 0;
      if (!online) soloTime += simDt;
      const T = online && net.room ? Math.max(0, (net.now() - (Number.isFinite(net.room.epoch) ? net.room.epoch : net.now())) / 1000) : soloTime;
      const hear = !paused && hero.input.wantLock;
      ambience.enabled = hear; ambience.night = sky.night || 0; ambience.height = Math.max(0, hero.focus.y - .98);
      ambience.rain = sky.w.rain; ambience.wind = unit(hero.speed / 65, 0);
      audio.cityAmbience(hear ? unit(P.settings.ambience, .65) : 0, ambience);
      // photo mode freezes this hero (and, playing alone, the street) under a free camera
      // photo mode freezes this hero under a free camera; alone, the map and photo mode stop the street too
      const photo = hero.photo?.on, still = (photo || hero.worldMap?.on) && !online, worldDt = still ? 0 : simDt;
      if (photo) hero.photo.update(dt); else hero.update(still ? 0 : simDt, dt, T);
      const focus = hero.focus; sky.update(worldDt, camera, focus, hero.speed, audio);
      const honks = city.update(worldDt, T, focus, camera, sky, glows, lights, hero.trafficPlayers());
      if (hear) for (const honk of honks) {
        const distance = Math.hypot(honk.c.x - focus.x, honk.c.y - focus.y, honk.c.z - focus.z);
        if (distance < 48) audio.honk(0, honk.heavy, (1 - distance / 48) ** 2 * .35);
      }
      hero.afterCity(worldDt, T, glows, lights);
      mapT -= dt; envT -= dt; lifeT += dt;
      if (mapT <= 0) { mapT = .1; city.drawMinimap(focus.x, focus.z, hero.cam.yaw, hero.mapDots(), false); if (hero.worldMap.on) hero.worldMap.draw(); }
      if (envT <= 0) {
        envT = .2; const env = city.envAt(focus.x, focus.y - 1, focus.z);
        audio.setTunnel(env.tunnel * .35); audio.setEnv(env.env, env.boost); audio.setReverb(env.reverb * .7);
      }
      audio.update(hear ? hero.speed * 3.6 : 0, hear ? sky.w.rain : 0, false, 0);
      if (online && net.room && net.connected && (sendT -= dt) <= 0) {
        sendT = 1 / net.sendRate; const state = hero.netState(T, net.now(), net.room.round || 0);
        if (state) net.send({ t: "state", s: state });
      }
      if (lifeT >= 1) {
        lifeT = 0; ui.renderStatus(); if (!document.getElementById("arcPlayers").hidden) ui.renderPlayers();
        document.getElementById("arcPerf").textContent = `${measuredFps} FPS · ${P.settings.graphics || "medium"}`;
      }
      // A deliberate low cap must not trigger automatic quality reductions.
      const budget = Math.max(1 / 60, cap ? 1 / cap : 0);
      avgDt += (elapsed * ((1 / 60) / budget) - avgDt) * .04; adaptiveT += dt;
      if (adaptiveT > 2 && !paused) {
        adaptiveT = 0; const next = avgDt > .03 ? Math.max(.6, scale - .14) : avgDt > .024 ? Math.max(.6, scale - .08) : avgDt < .018 ? Math.min(1, scale + .025) : scale;
        if (next !== scale) { scale = next; resize(); }
        // Resolution alone could not hold 40 FPS: bloom, then shadows, are the next most expensive passes,
        // so they are dropped for this session.
        slowT = scale <= .6 && avgDt > .025 ? slowT + 1 : 0;
        if (slowT >= 3 && composer) { slowT = 0; setPost(false); ui.toast("Bloom turned off to keep the game smooth."); }
        else if (slowT >= 3 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; ui.toast("Shadows turned off to keep the game smooth."); }
      }
    } else sky.update(dt, camera, camera.position, 0, audio);
    camera.updateMatrixWorld(); uploadLights(lights, camera); glows.end(renderer.domElement.height);
    renderFrame();
  }
  requestAnimationFrame(frame);
  ui.loading("ARCLINE ONLINE", "Sign in or enter a guest name to join New Meridian.");
  await signIn();
  const savedSuit = P.hero?.suit || "arcline"; hero.suitId = "arcline"; hero.setSuit(savedSuit);
  applySettings(); net.connect(P.name, "hero"); ui.loaded(); ui.open("home");
  window.__game = { hero, city, sky, renderer, scene, camera, audio, net, get state() { return active ? "hero" : "lobby"; }, get mode() { return online ? "online" : "practice"; } };
  window.__ui = ui;
}

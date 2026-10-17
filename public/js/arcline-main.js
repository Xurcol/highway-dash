// ARCLINE boots only the hero city; Highway Rush has its own preserved project and Git branch.
import * as THREE from "three";
import { SkySystem, SKY_STYLES, WEATHERS } from "./sky.js";
import { City } from "./city.js";
import { Glows, uploadLights, setLampBudget } from "./lights.js";
import { AudioManager } from "./audio.js";
import { createNet } from "./net.js";
import { HeroMode } from "./hero.js";
import { P, save, signOut } from "./arcline-profile.js";
import { signIn } from "./auth.js";
import { ArclineUI } from "./arcline-ui.js";

const QUALITY = {
  low: { dpr: .85, lamps: 8, traffic: 20, shadows: false, shadowSize: 512, reflections: 32, view: .8 },
  medium: { dpr: 1.25, lamps: 12, traffic: 32, shadows: false, shadowSize: 1024, reflections: 48, view: 1 },
  high: { dpr: 1.5, lamps: 20, traffic: 48, shadows: true, shadowSize: 1024, reflections: 80, view: 1.35 },
};
const unit = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback;

export async function bootArcline() {
  const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById("c"), antialias: false, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x8b99aa, 60, 1100);
  const camera = new THREE.PerspectiveCamera(66, 1, .1, 2200);
  const sky = new SkySystem(renderer, scene), city = new City(renderer, scene), glows = new Glows(scene, 1200);
  const audio = new AudioManager(), net = await createNet(); net.sendRate = 15;
  let ui, active = false, online = false, paused = true, entering = false, wantsOnline = false, pendingPractice = false, roomCode = null, soloTime = 0;
  let scale = 1, slowT = 0, quality = QUALITY.medium, sendT = 0, mapT = 0, envT = 0, lifeT = 0, adaptiveT = 0, avgDt = 1 / 60;
  const lights = [], ambience = { night: 0, height: 0, rain: 0, traffic: .6, wind: 0, enabled: false };
  const hero = new HeroMode({ renderer, scene, camera, sky, city, audio, net, P, save, get ui() { return ui; } });
  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality.dpr) * scale);
    renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / Math.max(1, innerHeight); camera.updateProjectionMatrix();
  }
  function applySettings(key) {
    const settings = P.settings;
    if (!key || key === "graphics") {
      quality = QUALITY[settings.graphics] || QUALITY.medium;
      city.setDetail(settings.graphics || "medium"); setLampBudget(quality.lamps);
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
  }
  function pause(on) {
    paused = on;
    if (on) { hero.activities?.closeMenu(); hero.input.unlock(); audio.cityAmbience(0); audio.update(0, 0, false, 0); }
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
  const startAudio = () => { audio.init({ hero: true }).catch(() => {}); };
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
    if (event.code === "Tab") { event.preventDefault(); ui.togglePlayers(); }
    if (event.code === "KeyP") { event.preventDefault(); ui.menuOpen ? ui.close() : ui.open(); }
    if (event.code === "KeyM") { event.preventDefault(); if (city.mapEl) city.mapEl.classList.toggle("large"); }
    startAudio();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { audio.cityAmbience(0); audio.update(0, 0, false, 0); hero.input.clear(); save(); }
    lastFrame = performance.now();
  });
  renderer.domElement.addEventListener("webglcontextlost", event => { event.preventDefault(); pause(true); ui.toast("Graphics paused. Reload the page to recover.", [], "warn"); });

  let lastFrame = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) { lastFrame = now; return; }
    // The city is capped at 60 rendered frames; faster displays no longer render the same world hundreds of times.
    if (now - lastFrame < 1000 / 60 - .5) return;
    const dt = Math.min(.05, Math.max(.001, (now - lastFrame) / 1000)); lastFrame = now;
    glows.begin(); lights.length = 0;
    if (active) {
      const simDt = online || !paused ? dt : 0;
      if (!online) soloTime += simDt;
      const T = online && net.room ? Math.max(0, (net.now() - (Number.isFinite(net.room.epoch) ? net.room.epoch : net.now())) / 1000) : soloTime;
      const hear = !paused && hero.input.wantLock;
      ambience.enabled = hear; ambience.night = sky.night || 0; ambience.height = Math.max(0, hero.focus.y - .98);
      ambience.rain = sky.w.rain; ambience.wind = unit(hero.speed / 65, 0);
      audio.cityAmbience(hear ? unit(P.settings.ambience, .65) : 0, ambience);
      hero.update(simDt, dt, T);
      const focus = hero.focus; sky.update(simDt, camera, focus, hero.speed, audio);
      const honks = city.update(simDt, T, focus, camera, sky, glows, lights, hero.trafficPlayers());
      if (hear) for (const honk of honks) {
        const distance = Math.hypot(honk.c.x - focus.x, honk.c.y - focus.y, honk.c.z - focus.z);
        if (distance < 48) audio.honk(0, honk.heavy, (1 - distance / 48) ** 2 * .35);
      }
      hero.afterCity(simDt, T, glows, lights);
      mapT -= dt; envT -= dt; lifeT += dt;
      if (mapT <= 0) { mapT = .1; city.drawMinimap(focus.x, focus.z, hero.cam.yaw, hero.mapDots(), false); }
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
        document.getElementById("arcPerf").textContent = `${Math.round(1 / avgDt)} FPS · ${P.settings.graphics || "medium"}`;
      }
      avgDt += (dt - avgDt) * .04; adaptiveT += dt;
      if (adaptiveT > 2 && !paused) {
        adaptiveT = 0; const next = avgDt > .03 ? Math.max(.6, scale - .14) : avgDt > .024 ? Math.max(.6, scale - .08) : avgDt < .018 ? Math.min(1, scale + .025) : scale;
        if (next !== scale) { scale = next; resize(); }
        // Resolution alone could not hold 40 FPS: shadows are the next most expensive pass, so drop them for this session.
        slowT = scale <= .6 && avgDt > .025 ? slowT + 1 : 0;
        if (slowT >= 3 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; ui.toast("Shadows turned off to keep the game smooth."); }
      }
    } else sky.update(dt, camera, camera.position, 0, audio);
    camera.updateMatrixWorld(); uploadLights(lights, camera); glows.end(renderer.domElement.height);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
  ui.loading("ARCLINE ONLINE", "Sign in to join New Meridian.");
  await signIn();
  const savedSuit = P.hero?.suit || "arcline"; hero.suitId = "arcline"; hero.setSuit(savedSuit);
  applySettings(); net.connect(P.name, "hero"); ui.loaded(); ui.open("lobby");
  window.__game = { hero, city, sky, renderer, scene, camera, audio, net, get state() { return active ? "hero" : "lobby"; }, get mode() { return online ? "online" : "practice"; } };
  window.__ui = ui;
}

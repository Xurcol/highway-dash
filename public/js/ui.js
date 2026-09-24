// DOM side: garage, HUD helpers, game-over popup, leaderboards, online + settings panels.
import { CARS, RARITY_COLORS, specOf, carStats } from "./cars.js";
import { P, save, carById, carColor, carSound, carTune, setTune, resetTune, PAINTS, MEDALS, HEART_PACKS, xpForLevel, medalCount,
  ownsPart, ownsEcu, buyPart, buyEcu, payTuneSession, payPaint, spend, earn, priceOfCar, walletHooks, carStyle, ownsStyle, styleCost, saveStyle,
  currentAccount, signOut } from "./profile.js";
import { FINISHES, TINTS, STANCES, FITMENT } from "./cars.js";
import { stylePrice, STYLE_PRICES } from "./economy.js";
import { SOUND_LABELS } from "./engine-dsp.js";
import { ENGINES, PARTS, TUNE_RANGE, engineOf, isBoosted, isForced, summary, summaryCache, defaultTune, maxBoostFor, peakHp, stageMap, DRIVE_LAYOUT,
  normalizeTune, partOpt, driveOf } from "./tuning.js";
import { partPrice, TUNING_PRICES, COSMETIC_PRICES, fmtCoins, CAR_PRICES } from "./economy.js";
import { TIME_PRESETS, SKY_STYLES, WEATHERS } from "./sky.js";
import { TRAFFIC_LEVELS } from "./traffic.js";
import { MusicPlayer, parseLink } from "./media.js";
import { FLAME_COLORS } from "./flames.js";
import { todaysDaily, dailyBonusDone, msToDailyReset, DAILY_TIERS, DAILY_BONUS } from "./daily.js";

const $ = (id) => document.getElementById(id);
const MPH = 0.621371; // the game shows mph only
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// the coin and the icon set (index.html's sprite), for markup built here
const COIN = '<i class="coin" aria-hidden="true"></i>';
const icon = (id, cls = "") => `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0).replace(/\.0$/, "") + "K" : String(n));

// one line of plain English per solo mode, shown under the picker
const SOLO_BLURB = {
  classic: "One life. One crash ends the run.",
  freedrive: "No timer and no run to lose — crash and you just respawn.",
  city: "Free roam in 3D: downtown, traffic lights, and the ring expressway with its on and off ramps. Shift is the handbrake; hold S to reverse.",
  police: "Outrun the cops. Escape to raise the heat and the bounty.",
  timeattack: "Two minutes. Crashes cost you 10% of your score.",
};
const TOAST_KINDS = ["info", "success", "warn", "error"];
// ---------- workshop layout ----------
// The sections down the left of the workshop. The parts sections list the PARTS kinds they hold.
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const WS_ICONS = {
  engine: svg('<path d="M3 10h2V8h3l2-2h5l2 3h2v2h2v6h-2v2h-3l-2 2H9l-2-2H5v-3H3z"/><path d="M10 12h4"/>'),
  drive: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'),
  chassis: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21"/>'),
  ecu: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2.5v3.5M14.5 2.5v3.5M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/><path d="M10 10h4v4h-4z"/>'),
  sound: svg('<path d="M4 9.5v5h4l5 4v-13l-5 4z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>'),
  looks: svg('<path d="M12 3s6 6.4 6 10.8A6 6 0 0 1 6 13.8C6 9.4 12 3 12 3z"/><path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.5"/>'),
};
const WS_SECTIONS = [
  { id: "engine", label: "Engine", kinds: ["intake", "exhaust", "catalyst", "turbo", "intercooler", "fuel", "remap", "internals"],
    blurb: "Parts that make power. Pick one to see it on the dyno before you buy it." },
  { id: "drive", label: "Drivetrain", kinds: ["transmission", "drivetrain", "diff", "tires"],
    blurb: "How the power gets to the road: shift speed, traction and the launch." },
  { id: "chassis", label: "Chassis", kinds: ["suspension", "brakes", "aero", "weight"],
    blurb: "Turn-in, stopping power and weight." },
  { id: "ecu", label: "ECU map" },
  { id: "sound", label: "Exhaust sound" },
  { id: "looks", label: "Paint & style" },
];
const PART_BLURB = {
  intake: "More air in: a little power and a sharper induction sound.",
  exhaust: "Freer flow, less back-pressure and a louder tailpipe.",
  catalyst: "Fewer restrictions after the turbo. More pops, hotter exhaust gas.",
  turbo: "Sets the boost ceiling. A bigger turbo makes more power but spools later.",
  intercooler: "Cooler charge air, so high boost doesn't knock.",
  fuel: "Higher octane and ethanol resist knock, so the map can run harder.",
  remap: "The factory calibration, up to a full race map.",
  internals: "Forged parts take more boost and timing before the engine knocks.",
  transmission: "Quicker gearchanges: less time without drive between gears.",
  drivetrain: "Drive all four wheels. The biggest single gain off the line.",
  diff: "Stops the inside wheel spinning away the power.",
  tires: "Grip. Launches and corners both need it.",
  suspension: "Sharper turn-in and less body roll.",
  brakes: "Stopping power.",
  aero: "More grip through the turns, at the cost of a little drag.",
  weight: "Less mass: quicker everywhere, including the launch.",
};
// sliders in the workshop fill up to their thumb (see .ws input[type=range] in style.css)
const fillRange = (r) => r.style.setProperty("--p", ((+r.value - +r.min) / ((+r.max - +r.min) || 1)) * 100 + "%");
// round a chart axis to a readable step
const niceStep = (v) => [25, 50, 100, 200, 250, 500, 1000].find((s) => s >= v) || 1000;

export class UI {
  constructor(ctx) {
    this.ctx = ctx; this.initSettingsTabs();
    this.net = ctx.net;
    this.thumbs = {};
    this.view = P.equipped;
    this.filter = "all";
    this.boardTab = "top";
    this.board = null;
    this.onlineSelected = false;
    this.el = {
      score: $("score"), best: $("best"), speed: $("speed"), dist: $("dist"), gear: $("gear"), gearMode: $("gearMode"),
      sigL: $("sigL"), sigR: $("sigR"), speedUp: $("speedUp"), ghost: $("ghostNote"), combo: $("combo"), catchUp: $("catchUp"),
      ccWord: $("ccWord"), ccSub: $("ccSub"), ccStreak: $("ccStreak"), ccTags: $("ccTags"),
    };
    this.chatInput = $("chatInput");
    this.wireCommon();
    this.wireHome();
    this.wireOver();
    this.wireOnline();
    this.wireSettings();
    this.wireTune();
    this.wireNet();
    this.music = new MusicPlayer();
    // the audio engine picks the music up when it starts, so tracks play in the game's acoustics;
    // starting a track also starts (or wakes) the audio, which needs this user gesture
    ctx.audio.musicEl = this.music.audio;
    this.music.onPlay = () => ctx.audio.init?.();
    this.wireMedia();
    this.wireAdmin();
  }

  // ---------- generic ----------
  show(name) {
    if (name === "ready") { this.setReady("HIGHWAY DASH", "Five lanes. Thread the needle.", "CLICK TO START"); this.renderReadyKeys(); }
    for (const id of ["home", "ready", "hud", "over"]) $(id).hidden = id !== name;
    $("pause").hidden = true;
    if (name !== "hud") this.chatInput.hidden = true;
  }
  // live = the multiplayer session menu: the world keeps running, so it offers Leave Server instead of a plain exit
  setPaused(p, live = false) {
    $("pause").hidden = !p;
    $("pauseSub").textContent = p && live ? "The server keeps running while this is open." : "";
    $("pausePlayers").hidden = !(p && live);
    $("pauseLeave").hidden = !(p && live);
    $("pauseHome").hidden = !!(p && live);
  }
  // the key hints along the bottom of the start screen, showing whatever keys are bound right now
  renderReadyKeys() {
    const k = (act) => this.ctx.keyOf(act).replace(/^Key/, "");
    const hint = [
      [["W", "S"], "Gas / brake"], [["A", "D"], "Steer"], [[k("KeyQ"), k("KeyE")], "Gears"], [[k("KeyM")], "Manual"],
      [[k("Space")], "Look back"], [[k("KeyC")], "Camera"], [[k("KeyH")], "Horn"],
    ];
    $("readyKeys").innerHTML = hint.map(([ks, label]) => `<span class="rk">${ks.map((x) => `<kbd>${esc(x)}</kbd>`).join("")}<i>${label}</i></span>`).join("");
  }
  setReady(title, sub, click) {
    if (this.readyCache === title + sub + click) return;
    this.readyCache = title + sub + click;
    $("readyTitle").textContent = title; $("readySub").textContent = sub; $("readyClick").textContent = click;
  }
  showRoundResults(m, myId, seconds) {
    const el = $("roundBanner");
    clearInterval(this.roundTimer);
    let left = seconds;
    const render = () => {
      el.innerHTML = `<h2>${esc(m.by)} crashed</h2><ol>${m.scores.map((p, i) => `<li class="${p.id === myId ? "me" : ""} ${p.id === m.byId ? "crashed" : ""}"><span>${i + 1}. ${esc(p.name)}</span><span>${p.score.toLocaleString()}</span></li>`).join("")}</ol><div class="next">Next round in ${Math.max(0, left)}s</div>`;
    };
    render();
    el.hidden = false;
    this.roundTimer = setInterval(() => { left--; render(); if (left <= 0) clearInterval(this.roundTimer); }, 1000);
  }
  hideRoundResults() { clearInterval(this.roundTimer); $("roundBanner").hidden = true; }
  anyModalOpen() { return [...document.querySelectorAll(".modal")].some((m) => !m.hidden); }
  // one confirmation, then a clean exit: main.js drops the party state, the relay clears our presence
  leaveServer() {
    if (!this.net.room) return;
    if (!confirm(`Leave ${this.net.room.name || "this server"}?`)) return;
    this.ctx.leaveServer();
  }
  openModal(id) {
    this.closeModals();
    $(id).hidden = false;
    if (id === "vehicles") this.renderVehicles();
    if (id === "leader") { this.net.send({ t: "leaderboard" }); this.renderBoard($("leaderBoard")); }
    if (id === "online") { this.renderOnline(); if ((this.onlineTab || "public") === "public") this.net.send?.({ t: "publicRefresh" }); }
    if (id === "settings") this.renderSettings();
    if (id === "camEdit") this.renderCamEdit();
    if (id === "tune") { this.pick = null; this.renderTune(); }
    if (id === "daily") this.renderDaily();
    this.ctx.audio.ui();
  }
  toggleModal(id) { if (!$(id).hidden) this.closeModals(); else this.openModal(id); }
  // settings tabs
  initSettingsTabs() {
    document.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-stab]"); if (!b) return;
      document.querySelectorAll("[data-stab]").forEach((x) => x.classList.toggle("on", x === b));
      document.querySelectorAll("[data-spane]").forEach((x) => x.classList.toggle("on", x.dataset.spane === b.dataset.stab));
      if (b.dataset.stab === "keys") this.renderBinds();
    });
  }
  // keybinds tab: click an action, press its new key
  renderBinds() {
    const list = $("bindList"); if (!list) return;
    const binds = () => (P.settings.binds ||= {});
    const name = (c) => c.replace(/^Key/, "").replace(/^Digit/, "").replace("Space", "Space");
    const taken = (code) => Object.entries(this.ctx.keyActions).find(([act]) => this.ctx.keyOf(act) === code)?.[0];
    const draw = () => {
      list.innerHTML = "";
      for (const [act, label] of Object.entries(this.ctx.keyActions)) {
        const row = document.createElement("div"); row.className = "bind-row";
        row.innerHTML = "<span></span><button class='bind-key'></button>";
        row.firstChild.textContent = label;
        const btn = row.lastChild; btn.textContent = name(this.ctx.keyOf(act));
        btn.onclick = () => {
          btn.textContent = "press a key..."; btn.classList.add("wait");
          const on = (e) => {
            e.preventDefault(); e.stopPropagation();
            removeEventListener("keydown", on, true);
            if (e.code !== "Escape" && !/^(Key[WASD]|Arrow.*)$/.test(e.code) && e.code !== "Enter") {
              const other = taken(e.code);
              if (other && other !== act) binds()[other] = this.ctx.keyOf(act);   // swap
              binds()[act] = e.code; save();
            }
            draw();
          };
          addEventListener("keydown", on, true);
        };
        list.appendChild(row);
      }
    };
    $("bindReset").onclick = () => { P.settings.binds = {}; save(); draw(); };
    draw();
  }
  closeModals() { document.querySelectorAll(".modal").forEach((m) => (m.hidden = true)); clearInterval(this.camTimer); this.camTimer = null; }
  // ---------- custom camera editor ----------
  // Four sliders and a live picture of what they do. The picture is drawn by the game (it owns the
  // renderer and the garage car); this only has to say when to redraw it.
  renderCamEdit() {
    const cam = { ...this.ctx.getCustomCam() };
    const box = $("camPreview");
    // match the game window's proportions, so the horizontal view in the preview is the one you get
    const asp = Math.min(2.2, Math.max(1.1, innerWidth / Math.max(1, innerHeight)));
    box.width = 480; box.height = Math.round(480 / asp);
    const rows = [
      ["camDist", "camDistV", "dist", (v) => v.toFixed(1) + " m"],
      ["camHeight", "camHeightV", "height", (v) => v.toFixed(1) + " m"],
      ["camPitch", "camPitchV", "pitch", (v) => (v > 0 ? v.toFixed(1) + "° down" : v < 0 ? Math.abs(v).toFixed(1) + "° up" : "level")],
      ["camFov", "camFovV", "fov", (v) => Math.round(v) + "°"],
    ];
    const draw = () => {
      const ok = this.ctx.renderCamPreview(box, cam);
      $("camPreviewNote").textContent = ok ? "Live preview: what this camera sees, behind your car." : "Open the garage first - the preview needs a car to look at.";
    };
    const commit = () => { P.settings.customCam = { ...cam }; save(); };
    for (const [id, out, key, fmt] of rows) {
      const el = $(id);
      el.value = cam[key]; $(out).textContent = fmt(+cam[key]);
      el.oninput = () => { cam[key] = +el.value; $(out).textContent = fmt(cam[key]); commit(); draw(); };
    }
    $("camReset").onclick = () => {
      Object.assign(cam, { dist: 9, height: 3.4, pitch: 4, fov: 60 });
      for (const [id, out, key, fmt] of rows) { $(id).value = cam[key]; $(out).textContent = fmt(cam[key]); }
      commit(); draw(); this.ctx.audio.ui();
    };
    $("camUse").onclick = () => { commit(); this.ctx.useCustomCam(); this.ctx.audio.ui(); this.closeModals(); };
    // the garage car can still be loading when the editor opens, so keep redrawing while it is up
    draw();
    clearInterval(this.camTimer);
    this.camTimer = setInterval(() => { if ($("camEdit").hidden) { clearInterval(this.camTimer); this.camTimer = null; } else draw(); }, 350);
  }
  // Notifications. kind is info (default) | success | warn | error and only changes the accent and
  // icon, so every call site stays a one-liner. Repeats of the same message inside a second are
  // folded into a counter instead of stacking, and the column is capped so nothing can flood it.
  toast(msg, actions = [], kind = "info") {
    const box = $("toasts"), now = performance.now();
    const last = box.lastElementChild;
    if (!actions.length && last && last.dataset.msg === msg && now - +last.dataset.t < 1000) {
      const n = (+last.dataset.n || 1) + 1;
      last.dataset.n = n; last.dataset.t = now;
      last.querySelector(".t-count").textContent = "x" + n;
      clearTimeout(+last.dataset.timer);
      last.dataset.timer = setTimeout(() => last.remove(), 3200);
      return;
    }
    const t = document.createElement("div");
    t.className = "toast t-" + (TOAST_KINDS.includes(kind) ? kind : "info");
    t.dataset.msg = msg; t.dataset.t = now; t.dataset.n = 1;
    t.innerHTML = `<i class="t-dot"></i><span>${esc(msg)}</span><b class="t-count"></b>`;
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = "btn " + (a.cls || "green"); b.textContent = a.label;
      b.onclick = () => { a.run(); t.remove(); };
      t.appendChild(b);
    }
    box.appendChild(t);
    while (box.childElementCount > 4) box.firstElementChild.remove();
    t.dataset.timer = setTimeout(() => t.remove(), actions.length ? 12000 : 3200);
  }
  notify(msg, kind) { this.toast(msg, [], kind); }
  // tier 0 (a near miss) .. 3 (insane) sets the colour and size; tags are the extras the pass earned
  closeCall({ word, tier, combo, pts, tags, streak }) {
    const e = this.el, c = e.combo;
    c.dataset.tier = tier;
    e.ccWord.textContent = word;
    e.ccSub.textContent = `x${combo}  ·  +${pts}`;
    e.ccStreak.textContent = streak;
    e.ccStreak.hidden = !streak;
    e.ccTags.replaceChildren(...tags.map((t) => { const s = document.createElement("span"); s.textContent = t; return s; }));
    c.classList.remove("on"); void c.offsetWidth; c.classList.add("on");
  }
  // Keeps the last 60 lines. Closed, only the newest few show and they fade; with the input open the
  // whole history is visible and scrollable. kind is "" for a player message, or info | ok | err for the game.
  chat(name, text, kind = "") {
    const d = document.createElement("div");
    if (kind) { d.className = "sys " + (kind === "info" ? "" : kind); d.textContent = text; }
    else d.innerHTML = `<b>${esc(name)}:</b> ${esc(text)}`;
    const log = $("chatLog");
    log.appendChild(d);
    while (log.children.length > 60) log.firstChild.remove();
    if (log.classList.contains("open")) log.scrollTop = log.scrollHeight;
  }
  chatSys(text, kind = "info") { this.chat("", text, kind); }
  chatOpen(open) { const log = $("chatLog"); log.classList.toggle("open", open); if (open) log.scrollTop = log.scrollHeight; }

  // ---------- vehicle switcher ----------
  renderVehicles() {
    const grid = $("vehicleGrid"), cur = this.ctx.currentCar();
    grid.innerHTML = "";
    const mine = CARS.filter((c) => P.owned.includes(c.id));
    for (const c of mine) {
      const b = document.createElement("button");
      b.className = "veh" + (c.id === cur ? " cur" : "");
      b.innerHTML = `<img src="${this.thumbs[c.id] || ""}" alt=""><b>${esc(c.name)}</b><small>${c.id === cur ? "In use" : esc(c.rarity)}</small>`;
      if (c.id !== cur) b.onclick = () => { this.ctx.audio.ui(); this.closeModals(); this.ctx.switchCar(c.id); };
      grid.appendChild(b);
    }
    $("vehiclesNote").textContent = mine.length < CARS.length
      ? "Pick one of your cars. You keep your place, your session and your customization. Buy more in the garage."
      : "Pick a car. You keep your place, your session and your customization.";
  }

  // ---------- player list ----------
  togglePlayers(force) {
    const p = $("playerPanel"), show = force ?? p.hidden;
    p.hidden = !show;
    if (show) this.refreshPlayers();
  }
  refreshPlayers() {
    const online = this.ctx.mode() === "online" && !!this.net.room;
    $("hudPlayers").hidden = !online;
    const panel = $("playerPanel");
    if (panel.hidden) return;
    if (!online) { panel.hidden = true; return; }
    const rows = this.ctx.playerRows(), free = this.ctx.freeMode();
    panel.innerHTML = `<h4>PLAYERS · ${rows.length}/${this.net.room.max || 8}</h4>`;
    for (const r of rows) {
      const d = document.createElement("div");
      d.className = "pl-row";
      d.innerHTML = `<div><b>${esc(r.name)}${r.me ? " (you)" : ""}</b><small>${esc(r.car)}</small></div><span class="dist">${r.me ? "" : r.dist === null ? "—" : r.dist < 1000 ? Math.round(r.dist) + " m" : (r.dist / 1000).toFixed(1) + " km"}</span>`;
      if (!r.me && free) d.appendChild(this.mini("TP", "primary", () => { const m = this.ctx.teleportTo(r.name); this.chatSys(m.text, m.ok ? "ok" : "err"); }));
      else d.appendChild(document.createElement("span"));
      panel.appendChild(d);
    }
  }
  // Marker elements are cached by id. This runs every frame, so the old attribute-selector lookup
  // (one DOM query per peer per frame) and the colour write have both been taken out of the loop.
  renderPeerMarkers(list) {
    const box = $("peerMarkers");
    const cache = (this.markerEls ||= new Map());
    const seen = this.markerSeen ||= new Set();
    seen.clear();
    for (const m of list) {
      seen.add(m.id);
      let el = cache.get(m.id);
      if (!el || !el.isConnected) {
        el = document.createElement("div"); el.className = "peer-marker"; el.dataset.id = m.id;
        box.appendChild(el); cache.set(m.id, el); el._col = null;
      }
      if (el._col !== m.color) { el._col = m.color; el.style.borderColor = m.color; }
      el.style.transform = `translate(${m.x}px, ${m.y}px) translate(-50%, -50%)`;
      if (el.textContent !== m.text) el.textContent = m.text;
    }
    for (const [id, el] of cache) if (!seen.has(id)) { el.remove(); cache.delete(id); }
  }
  // main.js asks first so it can skip building the list on frames that would be thrown away
  partyHudDue() { return performance.now() - (this.partyHudT || 0) >= 250; }
  renderPartyHud(list) {
    const now = performance.now();
    if (now - (this.partyHudT || 0) < 250) return;
    this.partyHudT = now;
    $("partyList").innerHTML = list.map((p) => {
      const dz = Math.round(p.dz);
      return `<div class="${p.crashed ? "crashed" : ""}" style="border-color:${p.color || "#3dff6a"}">${esc(p.name)} · ${dz >= 0 ? "+" : ""}${dz}m · ${p.score.toLocaleString()}</div>`;
    }).join("");
  }
  wireCommon() {
    document.addEventListener("click", (e) => {
      const open = e.target.closest("[data-open]");
      if (open) return this.openModal(open.dataset.open);
      if (e.target.closest("[data-close]") || e.target.classList.contains("modal")) this.closeModals();
    });
    $("hudHome").onclick = () => this.ctx.home();
    $("hudPause").onclick = () => this.ctx.resume();
    $("hudRestart").onclick = () => this.ctx.restart();
    $("resumeBtn").onclick = () => this.ctx.resume();
    $("pauseHome").onclick = () => this.ctx.home();
    $("pauseLeave").onclick = () => this.leaveServer();
    $("pausePlayers").onclick = () => { this.ctx.resume(); this.togglePlayers(true); };
    $("hudPlayers").onclick = () => this.togglePlayers();
    setInterval(() => this.refreshPlayers(), 500);
  }

  // ---------- home / garage ----------
  wireHome() {
    document.querySelectorAll(".mode").forEach((b) => b.onclick = () => {
      this.ctx.audio.ui();
      if (b.dataset.mode === "online") { this.onlineSelected = true; this.openModal("online"); }
      else { this.onlineSelected = false; }
      this.renderHome();
    });
    document.querySelectorAll(".filter").forEach((b) => b.onclick = () => { this.filter = b.dataset.f; this.renderHome(); });
    // picking one of your own cars ends a show-off view
    $("cards").addEventListener("click", () => { if (!$("showOff").hidden) { $("showOff").hidden = true; this.ctx.endShowOff(); } }, true);
    $("playBtn").onclick = () => {
      this.discardStyle();
      if (!$("showOff").hidden) { $("showOff").hidden = true; this.ctx.endShowOff(); }
      if (this.onlineSelected && !this.net.room) return this.openModal("online");
      this.ctx.play(this.onlineSelected && this.net.room ? "online" : "solo");
    };
    $("ciAction").onclick = () => this.buyOrEquip(this.view, () => this.renderHome());
    // The wheel only browses: it scrolls the car strip sideways. Nothing is selected until you click a car.
    $("home").addEventListener("wheel", (e) => {
      if (document.querySelector(".modal:not([hidden])") || !$("showOff").hidden || e.target.closest(".carinfo, .modal, input")) return;
      const strip = $("cards");
      if (!strip || strip.scrollWidth <= strip.clientWidth) return;
      e.preventDefault();
      strip.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
    }, { passive: false });
    $("paintPick").oninput = (e) => this.paint(parseInt(e.target.value.slice(1), 16));
    this.holdToRev($("revBtn"));
    $("tuneBtn").onclick = () => this.openModal("tune");
    $("spinBtn").onclick = () => { P.settings.spin = P.settings.spin === false; save(); this.renderHome(); };
  }
  holdToRev(btn) {
    const start = (e) => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); this.ctx.revHold(carSound(this.view), this.view, true); };
    const stop = () => this.ctx.revHold(carSound(this.view), this.view, false);
    btn.addEventListener("pointerdown", start);
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) btn.addEventListener(ev, stop);
    btn.title = "Hold to rev";
  }
  paint(hex) {
    // the first respray on a car costs money; after that its paint booth is yours
    if (hex !== carById(this.view).color && !P.painted?.[this.view]) {
      const r = payPaint(this.view);
      if (!r.ok) return this.notEnough(r.short);
      if (!r.already) { this.ctx.audio.coin(); this.toast(`Paint booth unlocked — ${fmtCoins(COSMETIC_PRICES.paint)} coins`); this.renderTop(); }
    }
    this.ctx.paintCar(this.view, hex);
    [...$("swatches").children].forEach((b) => b.classList.toggle("on", +b.dataset.c === hex));
    $("paintPick").value = "#" + hex.toString(16).padStart(6, "0");
  }
  buyOrEquip(id, after) {
    const car = carById(id);
    if (P.equipped === id) return;
    if (P.owned.includes(id)) { P.equipped = id; this.ctx.audio.ui(); }
    else if (spend(priceOfCar(id)).ok) { walletHooks.buy?.("car", id); P.owned.push(id); P.equipped = id; this.ctx.audio.coin(); this.toast(`${car.name} unlocked!`); }
    else { this.ctx.audio.deny?.(); return this.notEnough(priceOfCar(id) - P.coins); }
    save();
    this.net.send({ t: "setCar", car: id });
    after?.();
  }
  renderTop() {
    $("hLevel").textContent = P.level;
    const need = xpForLevel(P.level);
    $("hXp").style.width = (P.xp / need) * 100 + "%";
    $("hXpText").textContent = `${P.xp}/${need}`;
    $("hMedals").textContent = `${medalCount(P.best)}/${MEDALS.length}`;
    $("hCoins").textContent = P.coins.toLocaleString();
    $("hHearts").textContent = P.hearts;
    // how many of today's challenges are still open, on the garage button
    const left = todaysDaily().filter((c) => !c.done).length, dot = $("dailyDot");
    dot.textContent = left; dot.hidden = !left;
  }
  // ---------- daily challenges ----------
  renderDaily() {
    const list = todaysDaily(), ms = msToDailyReset(), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    $("dailyReset").textContent = `New ones in ${h}h ${m}m`;
    $("dailyList").innerHTML = list.map((c) => {
      const f = (v) => (c.dec ? v.toFixed(c.dec) : Math.floor(v).toLocaleString()), pct = Math.min(100, (c.prog / c.target) * 100);
      return `<div class="dc t${c.tier}${c.done ? " done" : ""}">
        <div class="dc-top"><span class="dc-tier">${DAILY_TIERS[c.tier]}</span><span class="dc-rew">${COIN}${c.reward.coins.toLocaleString()} · ${c.reward.xp} XP</span></div>
        <b class="dc-text">${esc(c.text)}</b>
        <div class="dc-bar"><i style="width:${pct}%"></i></div>
        <small>${c.done ? "✓ Done — paid" : `${f(c.prog)} / ${f(c.target)}`}</small></div>`;
    }).join("");
    const n = list.filter((c) => c.done).length;
    $("dailyBonus").className = "daily-bonus" + (dailyBonusDone() ? " done" : "");
    $("dailyBonus").innerHTML = `<div><b>Finish all three</b><small>${dailyBonusDone() ? "Bonus paid — see you tomorrow" : `${n} of 3 done`}</small></div><span>${COIN}${DAILY_BONUS.coins.toLocaleString()} · ${DAILY_BONUS.xp} XP</span>`;
  }
  renderHome() {
    this.renderTop();
    const car = carById(this.view), st = carStats(car), spec = specOf(car);
    this.ctx.selectCar(this.view);
    for (const [k, v] of [["Spd", st.speed], ["Acc", st.accel], ["Han", st.handling]]) { $("st" + k).style.width = v + "%"; $("st" + k + "N").textContent = v; }
    // the badge tints itself off --rar; see .rarity in style.css
    const r = $("ciRarity"); r.textContent = car.rarity; r.style.setProperty("--rar", RARITY_COLORS[car.rarity]);
    $("ciName").textContent = car.name;
    $("ciName").style.fontSize = car.name.length > 20 ? "26px" : car.name.length > 12 ? "32px" : "";
    $("ciSpec").textContent = `${SOUND_LABELS[carSound(car.id)] || ""} · ${spec.ratios.length}-speed`;
    const col = carColor(car.id);
    $("swatches").innerHTML = [car.color, ...PAINTS.filter((c) => c !== car.color)].slice(0, 12).map((c) => `<button data-c="${c}" class="${c === col ? "on" : ""}" style="background:#${c.toString(16).padStart(6, "0")}" title="${c === car.color ? "Factory" : ""}"></button>`).join("");
    [...$("swatches").children].forEach((b) => (b.onclick = () => this.paint(+b.dataset.c)));
    $("paintPick").value = "#" + col.toString(16).padStart(6, "0");
    this.renderStyle(car);
    $("ciEngine").textContent = engineOf(car).label; // the engine belongs to the car - no swapping
    const sumNow = summaryCache(car, carTune(car.id));
    $("ciTop").textContent = `${Math.round(sumNow.hp)} hp · ${Math.round(sumNow.nm)} Nm · 0-60 ${sumNow.zeroTo60.toFixed(1)} s`;
    const a = $("ciAction");
    if (P.equipped === car.id) { a.textContent = "EQUIPPED"; a.className = "btn gray wide"; }
    else if (P.owned.includes(car.id)) { a.textContent = "EQUIP"; a.className = "btn blue wide"; }
    else { const pr = priceOfCar(car.id), can = P.coins >= pr; a.innerHTML = can ? `BUY · ${COIN}${fmtCoins(pr)}` : `NEED ${COIN}${fmtCoins(pr - P.coins)} MORE`; a.className = `btn ${can ? "accent" : "ghost"} wide`; a.disabled = !can; }

    const owned = CARS.filter((c) => P.owned.includes(c.id));
    $("fAll").textContent = CARS.length; $("fOwned").textContent = owned.length; $("fLocked").textContent = CARS.length - owned.length;
    document.querySelectorAll(".filter").forEach((b) => b.classList.toggle("on", b.dataset.f === this.filter));
    const list = CARS.filter((c) => this.filter === "all" || (this.filter === "owned") === P.owned.includes(c.id));
    const cards = $("cards");
    cards.innerHTML = "";
    for (const c of list) {
      const d = document.createElement("div");
      d.className = "card" + (c.id === this.view ? " sel" : "");
      const own = P.owned.includes(c.id);
      const price = priceOfCar(c.id);
      const label = c.id === P.equipped ? "EQUIPPED" : own ? "OWNED" : `${COIN}${fmtCoins(price)}`;
      d.style.setProperty("--rar", RARITY_COLORS[c.rarity]); // the card's edge, bar and glow all follow it
      d.innerHTML = `<div class="r" style="color:var(--rar)">${c.rarity}</div><img src="${this.thumbs[c.id] || ""}" alt=""><div class="n">${esc(c.name)}</div>
        <div class="p ${c.id === P.equipped ? "eq" : own ? "own" : P.coins < price ? "poor" : ""}">${label}</div>`;
      d.onclick = () => { this.view = c.id; this.ctx.audio.ui(); this.renderHome(); };
      cards.appendChild(d);
    }
    document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("on", (b.dataset.mode === "online") === this.onlineSelected));
    $("onlineDot").classList.toggle("on", this.net.connected);
    const pb = $("partyBadge");
    pb.hidden = !this.net.room;
    if (this.net.room) pb.textContent = `Party ${this.net.room.code} · ${this.net.room.players.length} driver${this.net.room.players.length > 1 ? "s" : ""}`;
    $("playBtn").textContent = this.onlineSelected ? (this.net.room ? "PLAY ONLINE" : "FIND PARTY") : "PLAY";
    const ms = $("modeSelect");
    if (this.onlineSelected) ms.innerHTML = this.net.room ? `<span class="ms-label">PARTY MODE</span><b>${this.ctx.PARTY_MODES[this.net.room.mode || "crash"]}</b>` : "";
    else {
      const cur = this.ctx.SOLO_MODES[P.settings.soloMode] ? P.settings.soloMode : "classic";
      // One <select> per setting. Four rows of chips took most of the preview to say four things.
      const sel = (label, key, options, current) =>
        `<label class="ms-row"><span class="ms-label">${label}</span><select class="ms-select" data-sel="${key}">` +
          options.map(([v, text]) => `<option value="${v}"${String(v) === String(current) ? " selected" : ""}>${text}</option>`).join("") +
        `</select></label>`;
      const bots = (P.settings.bots | 0);
      const rows = [sel("MODE", "mode", Object.entries(this.ctx.SOLO_MODES), cur)];
      // the bots race the highway; City Drive has its own traffic instead
      if (cur !== "city") rows.push(sel("BOTS", "bots", [0, 1, 2, 3, 4, 5].map((n) => [n, n ? String(n) : "Off"]), bots));
      // Free Drive is the open-ended mode, so the two things worth changing before you set off get
      // their own row here rather than being buried in Settings.
      if (cur === "freedrive" || cur === "city") {
        // the time is a slider elsewhere, so it can sit between two presets; show that honestly
        const presets = Object.entries(TIME_PRESETS).map(([label, h]) => [h, label]);
        const near = presets.find(([h]) => Math.abs(P.settings.hour - h) < .05);
        if (!near) presets.unshift([P.settings.hour, "Custom"]);
        rows.push(
          sel("TRAFFIC", "traffic", Object.keys(TRAFFIC_LEVELS).map((k) => [k, k]), P.settings.traffic),
          sel("TIME", "hour", presets, near ? near[0] : P.settings.hour));
      }
      ms.innerHTML = rows.join("") + `<p class="ms-note">${SOLO_BLURB[cur] || ""}</p>`;
      ms.querySelectorAll("select").forEach((el) => el.onchange = () => {
        const v = el.value;
        switch (el.dataset.sel) {
          case "bots": P.settings.bots = +v; break;
          case "traffic": P.settings.traffic = v; break;
          case "hour": P.settings.hour = +v; this.ctx.applySettings?.(); break;
          default: P.settings.soloMode = v;
        }
        save(); this.ctx.audio.ui(); this.renderHome();
      });
      
    }
    $("spinBtn").classList.toggle("on", P.settings.spin !== false);
  }

  // ---------- show off ----------
  viewBuild(p) {
    if (!this.ctx.showOff(p.build)) return this.toast("Can't show that car");
    this.closeModals();
    if (this.ctx.state() !== "home") return;
    const b = p.build, car = carById(b.car), st = b.st || {};
    const bits = [
      st.finish && st.finish !== "gloss" ? FINISHES[st.finish]?.label : null,
      st.drop ? "-" + Math.round(st.drop * 100) + " cm" : null, st.offset ? "+" + Math.round(st.offset * 100) + " cm poke" : null,
      st.camber ? "-" + st.camber + "° camber" : null, st.glow != null ? "underglow" : null,
    ].filter(Boolean);
    const el = $("showOff");
    el.innerHTML = `<div><b>${esc(p.name)}'s ${esc(car.name)}</b><small>${b.hp} hp${bits.length ? " · " + bits.join(" · ") : ""}</small>
      ${b.parts?.length ? `<div class="so-parts">${b.parts.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}</div>
      <button class="btn ghost" id="showOffBack">BACK TO MY GARAGE</button>`;
    el.hidden = false;
    $("showOffBack").onclick = () => { el.hidden = true; this.ctx.endShowOff(); this.renderHome(); };
  }

  // ---------- styling ----------
  // clicking an option only previews it; nothing is charged until Save
  discardStyle() {
    if (!this.styleDraft) return;
    const id = this.styleDraft.id;
    this.styleDraft = null;
    this.ctx.previewStyle(id, carStyle(id));
  }
  styleRows() {
    const COLORS = [0x16181c, 0xe8e8ea, 0x9aa0a8, 0xc9a24a, 0xd41f1f, 0x1f5fd6, 0x22b573, 0xff6a1a, 0xb84cff];
    const hex = (c) => "#" + c.toString(16).padStart(6, "0");
    const sw = (list) => list.map((c) => ({ v: c, sw: hex(c) }));
    return [
      ["finish", "Finish", Object.entries(FINISHES).map(([k, v]) => ({ v: k, label: v.label }))],
      ["rim", "Wheels", [{ v: null, label: "Stock" }, ...sw(COLORS)]],
      ["caliper", "Calipers", [{ v: null, label: "Stock" }, ...sw([0xd41f1f, 0xf2c230, 0x1f5fd6, 0x22b573, 0xff6a1a, 0x16181c])]],
      ["tint", "Window tint", Object.entries(TINTS).map(([k, v]) => ({ v: k, label: v.label }))],
      ["lightTint", "Tint lights", [{ v: false, label: "Off" }, { v: true, label: "On" }]],
      ["glow", "Underglow", [{ v: null, label: "Off" }, ...sw([0x3dd6ff, 0xff2d95, 0x7cff5a, 0xb27dff, 0xffd12a, 0xff4a55])]],
      // exhaust flame colour: each swatch is drawn hot-white in the middle, like the flame itself
      ["flame", "Flames", [{ v: null, label: "Stock" }, ...Object.entries(FLAME_COLORS).map(([k, f]) => ({ v: k, label: f.label,
        sw: f.rgb ? `radial-gradient(circle at 38% 38%,#fff 0 16%,rgb(${f.rgb.map((x) => Math.round(x * 255))}) 58%,rgb(${f.rgb.map((x) => Math.round(x * 110))}))`
          : "conic-gradient(#ff4040,#ffd23b,#3bff6a,#3bd8ff,#6a4bff,#ff3bd8,#ff4040)" }))]],
    ];
  }
  setStyleDraft(car, key, val) {
    const patch = { ...(this.styleDraft?.id === car.id ? this.styleDraft.patch : {}), [key]: val };
    const saved = carStyle(car.id)[key];
    if (patch[key] === saved || (typeof val === "number" && typeof saved === "number" && Math.abs(val - saved) < 1e-6)) delete patch[key];
    this.styleDraft = Object.keys(patch).length ? { id: car.id, patch } : null;
    this.ctx.previewStyle(car.id, { ...carStyle(car.id), ...(this.styleDraft?.patch || {}) });
  }
  renderStyle(car) {
    if (this.styleDraft && this.styleDraft.id !== car.id) this.discardStyle();
    const draft = this.styleDraft?.patch || {};
    const st = { ...carStyle(car.id), ...draft }, box = $("styleBox");
    const own = P.owned.includes(car.id), rows = this.styleRows();
    const chipRows = rows.map(([key, label, opts]) => `<div class="style-row"><span>${label}</span><div class="style-opts">${opts.map((o, i) => {
      const on = st[key] === o.v, pr = stylePrice(key, o.v), paid = ownsStyle(car.id, key, o.v);
      const tip = `${o.label || ""}${pr ? (paid ? " — owned" : " — " + fmtCoins(pr) + " coins") : ""}`;
      return o.sw ? `<button class="sw ${on ? "on" : ""}" data-k="${key}" data-i="${i}" title="${tip}" style="background:${o.sw}"></button>`
        : `<button class="${on ? "on" : ""}" data-k="${key}" data-i="${i}" title="${tip}">${o.label}</button>`;
    }).join("")}</div></div>`).join("");
    // fitment sliders: ride height, poke, camber, wheel size
    const cur = (k) => (k === "drop" ? (st.drop != null ? st.drop : (STANCES[st.stance] || STANCES.stock).drop) : st[k] ?? FITMENT[k].def);
    const fitRows = Object.entries(FITMENT).map(([k, f]) => {
      const paid = ownsStyle(car.id, k, cur(k) === f.def ? f.def + 1 : cur(k)), pr = STYLE_PRICES[k];
      return `<label class="style-row fit"><span>${f.label}</span><div class="fit-ctl"><input type="range" data-fit="${k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${cur(k)}" ${own ? "" : "disabled"}><b>${f.fmt(+cur(k))}</b></div>
        <small class="fit-price">${paid ? "kit owned" : fmtCoins(pr) + " coins"}</small></label>`;
    }).join("");
    box.innerHTML = chipRows + `<div class="custom-label" style="margin-top:4px">FITMENT</div>` + fitRows +
      (own ? "" : `<div class="muted small">Buy this car to style it.</div>`) + `<div id="styleSaveBar"></div>`;
    box.querySelectorAll(".style-opts button").forEach((btn) => btn.onclick = () => {
      if (!own) return this.toast("Buy this car first");
      const opts = rows.find((r) => r[0] === btn.dataset.k)[2];
      this.setStyleDraft(car, btn.dataset.k, opts[+btn.dataset.i].v);
      this.renderStyle(car);
    });
    // sliders only refresh their own readout and the save bar, so dragging isn't interrupted
    box.querySelectorAll("input[type=range]").forEach(fillRange);
    box.querySelectorAll("input[data-fit]").forEach((inp) => inp.oninput = () => {
      const k = inp.dataset.fit, v = +inp.value;
      this.setStyleDraft(car, k, v);
      inp.parentElement.querySelector("b").textContent = FITMENT[k].fmt(v);
      this.renderStyleSave(car);
    });
    this.renderStyleSave(car);
  }
  // pending changes: what they cost and the only button that takes money
  renderStyleSave(car) {
    const bar = $("styleSaveBar");
    if (!bar) return;
    const draft = this.styleDraft?.id === car.id ? this.styleDraft.patch : {};
    const changed = Object.keys(draft);
    if (!changed.length) { bar.innerHTML = ""; return; }
    const cost = styleCost(car.id, draft), can = P.coins >= cost;
    bar.innerHTML = `<div class="style-save"><div><b>${changed.length} change${changed.length > 1 ? "s" : ""} previewed</b><small>${cost ? "Total " + fmtCoins(cost) + " coins" : "Already owned — free"}</small></div>
      <button class="btn ghost" id="styleCancel">CANCEL</button>
      <button class="btn ${can ? "accent" : "ghost"}" id="styleSave" ${can ? "" : "disabled"}>${can ? (cost ? "SAVE — " + fmtCoins(cost) : "SAVE") : "NEED " + fmtCoins(cost - P.coins)}</button></div>`;
    $("styleCancel").onclick = () => { this.discardStyle(); this.renderStyle(car); };
    $("styleSave").onclick = () => {
      const r = saveStyle(car.id, draft);
      if (!r.ok) return this.notEnough(r.short);
      this.styleDraft = null;
      if (r.price) { this.ctx.audio.coin(); this.toast(`Saved — ${fmtCoins(r.price)} coins`); walletHooks.buy?.("style", car.id); }
      else this.toast("Saved");
      this.ctx.styleCar(car.id);
      this.renderTop(); this.renderStyle(car);
    };
  }

  // ---------- game over ----------
  wireOver() {
    $("reviveBtn").onclick = () => { if (!this.ctx.revive()) this.toast(P.hearts <= 0 ? "No revives left — buy some below" : "Max 3 revives per run"); };
    $("restartBtn").onclick = () => this.ctx.restart();
    $("homeBtn").onclick = () => this.ctx.home();
  }
  showOver(r) {
    this.show("over");
    document.querySelector("#over .go-title").textContent = r.reason === "busted" ? "BUSTED" : r.reason === "time" ? "TIME UP" : "GAME OVER";
    // restart pop animations
    document.querySelectorAll("#over .pop").forEach((p) => { p.style.animation = "none"; void p.offsetWidth; p.style.animation = ""; });
    const scoreEl = $("goScore"), t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 1100), e = 1 - Math.pow(1 - k, 3);
      scoreEl.textContent = Math.floor(r.score * e).toLocaleString();
      $("goCoins").textContent = "+" + Math.floor(r.coins * e).toLocaleString();
      if (k < 1) requestAnimationFrame(tick); else if (r.coins) this.ctx.audio.coin();
    };
    requestAnimationFrame(tick);
    $("goRewards").innerHTML = (r.extras || []).map((x) => `<div><span>${esc(x.label)}</span><b>+${fmtCoins(x.coins)}</b></div>`).join("");
    $("goBest").textContent = "BEST " + P.best.toLocaleString();
    $("goNewBest").hidden = !(r.score > r.prevBest && r.score > 0);
    $("goCoinFill").style.width = "0%";
    setTimeout(() => ($("goCoinFill").style.width = Math.min(100, 12 + r.coins / 4) + "%"), 150);

    const got = medalCount(P.best);
    $("medals").innerHTML = MEDALS.map((m, i) => {
      const has = i < got, isNew = has && i >= got - r.newMedals;
      return `<div class="medal ${has ? "got" : ""} ${isNew ? "new" : ""}"><i style="${has ? `background:${m.color};border-color:${m.color}` : ""}">${ROMAN[i]}</i><span style="${has ? `color:${m.color}` : ""}">${fmtK(m.at)}</span></div>`;
    }).join("");
    const next = MEDALS[got];
    $("medalNext").textContent = next ? `NEXT ${next.name.toUpperCase()} — ${fmtK(next.at)}` : "ALL MEDALS EARNED!";
    if (r.newMedals) this.toast(`New medal: ${MEDALS[got - 1].name}!`);
    if (r.levelUps) this.toast(`Level up! You're level ${P.level}`);
    this.renderReviveBtn(r.revives);
    this.renderOverShop();
    this.renderLevel();
    this.board = this.board || null;
    this.renderBoard($("goBoard"));
  }
  renderReviveBtn(revives) {
    const b = $("reviveBtn");
    const left = 3 - revives;
    b.disabled = left <= 0 || P.hearts <= 0;
    b.innerHTML = left <= 0 ? "NO REVIVES LEFT" : P.hearts <= 0 ? "GET REVIVES" : `REVIVE ${revives}/3 · 1 ${icon("heart")}`;
    $("goHearts").textContent = P.hearts;
  }
  renderLevel() {
    $("goLevel").textContent = P.level;
    const need = xpForLevel(P.level);
    $("goXp").style.width = "0%";
    setTimeout(() => ($("goXp").style.width = (P.xp / need) * 100 + "%"), 200);
    $("goXpText").textContent = `${P.xp}/${need}`;
  }
  renderOverShop() {
    const shop = $("goShop");
    shop.innerHTML = "";
    for (const c of CARS) {
      const st = carStats(c), own = P.owned.includes(c.id), eq = P.equipped === c.id;
      const d = document.createElement("div");
      d.className = "shop-item";
      d.innerHTML = `<div class="chipsrow"><span>SPD ${st.speed}</span><span>ACC ${st.accel}</span><span>HAN ${st.handling}</span></div>
        <img src="${this.thumbs[c.id] || ""}" alt=""><button class="btn ${eq ? "ghost" : own ? "primary" : "accent"}">${eq ? "EQUIPPED" : own ? "EQUIP" : COIN + fmtCoins(priceOfCar(c.id))}</button>`;
      d.querySelector("button").onclick = () => this.buyOrEquip(c.id, () => { this.renderOverShop(); this.toast(`${c.name} equipped — restart to drive it`); });
      shop.appendChild(d);
    }
    const hs = $("heartShop");
    hs.innerHTML = "";
    for (const pack of HEART_PACKS) {
      const b = document.createElement("button");
      b.className = "btn red";
      b.innerHTML = `${pack.n} REVIVE${pack.n > 1 ? "S" : ""}<small>${COIN}${pack.price.toLocaleString()}</small>`;
      b.disabled = P.coins < pack.price;
      b.onclick = () => {
        if (P.coins < pack.price) return;
        if (!spend(pack.price).ok) return this.notEnough(pack.price - P.coins);
        walletHooks.buy?.("hearts", pack.n);
        P.hearts += pack.n; save();
        this.ctx.audio.coin();
        this.renderOverShop();
        this.renderReviveBtn(this.ctx.revivesUsed?.() ?? 0);
      };
      hs.appendChild(b);
    }
    $("goHearts").textContent = P.hearts;
  }

  // ---------- leaderboard ----------
  renderBoard(el) {
    const data = this.board;
    const tab = this.boardTab;
    const rows = !data ? [{ name: P.name, best: P.best, level: P.level, me: true }] : tab === "top" ? data.top : data.friends;
    const medal = (i) => String(i + 1);
    el.innerHTML = `<div class="board-head">${icon("trophy")}${tab === "top" ? "TOP 200" : "FRIENDS"}</div>
      <div class="board-rows">${rows.length ? rows.map((r, i) => `<div class="brow ${r.me ? "me" : ""} ${i < 3 ? "r" + (i + 1) : ""}">
        <div class="star lv"><b>${r.level || 1}</b></div><div class="nm">${esc(r.name)}</div><div class="sc">${(r.best || 0).toLocaleString()}</div><div class="rk">${medal(i)}</div></div>`).join("")
        : `<div class="board-empty">No scores yet — go set one!</div>`}</div>
      <div class="board-foot">${!this.net.connected ? "Offline — start the server to see global scores" : `Your rank: ${data?.rank ? "#" + data.rank : "200+"}`}</div>
      <div class="board-tabs"><button class="btn ${tab === "top" ? "gold" : "gray"}" data-tab="top">TOP 200</button><button class="btn ${tab === "friends" ? "gold" : "gray"}" data-tab="friends">FRIENDS</button></div>`;
    el.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { this.boardTab = b.dataset.tab; this.renderBoard(el); });
  }

  // ---------- online ----------
  wireOnline() {
    const n = this.net;
    $("nameSave").onclick = () => {
      const v = $("nameInput").value.trim().slice(0, 16);
      if (!v) return;
      P.name = v; save(); n.send({ t: "setName", name: v }); this.toast("Name saved");
    };
    $("copyCode").onclick = () => n.me && navigator.clipboard?.writeText(n.me.code).then(() => this.toast("Friend code copied"));
    $("copyParty").onclick = () => n.room && navigator.clipboard?.writeText(n.room.code).then(() => this.toast("Party code copied"));
    $("addFriend").onclick = () => { const c = $("friendCode").value.trim(); if (c) { n.send({ t: "friendAdd", code: c }); $("friendCode").value = ""; } };
    $("createParty").onclick = () => n.send({ t: "roomCreate", traffic: P.settings.traffic });
    $("quickPlay").onclick = () => n.send({ t: "quickPlay" });
    $("joinParty").onclick = () => { const c = $("joinCode").value.trim(); if (c) n.send({ t: "roomJoin", code: c }); };
    $("leaveParty").onclick = () => n.send({ t: "roomLeave" });
    $("driveParty").onclick = () => { this.closeModals(); this.onlineSelected = true; this.ctx.play("online"); };
    // --- tabs + public server browser ---
    this.onlineTab = "public";
    $("onlineTabs").querySelectorAll("[data-otab]").forEach((b) => b.onclick = () => {
      this.onlineTab = b.dataset.otab; this.ctx.audio.ui(); this.renderOnline();
      if (this.onlineTab === "public") n.send({ t: "publicRefresh" });
    });
    $("srvRefresh").onclick = () => { this.ctx.audio.ui(); n.send({ t: "publicRefresh" }); };
    this.createOpts = { name: "", max: 8, mode: "free", traffic: P.settings.traffic || "Heavy", hour: undefined, weather: undefined, visibility: "public" };
    this.renderCreateForm();
  }
  renderCreateForm() {
    const n = this.net, o = this.createOpts, box = $("createForm");
    const chip = (k, v, label) => `<button data-k="${k}" data-v="${v}" class="${String(o[k] ?? "") === String(v) ? "on" : ""}">${label}</button>`;
    const blurb = { free: "Free Drive: no rounds, no finish line. Drive, chat and teleport to each other. Players can join and leave any time.",
      crash: "Last One Standing: the first crash ends the round for everyone.", target: "First To Score: the first driver to reach the score target wins the round.", timed: "Timed Battle: highest score when the clock runs out wins." };
    box.innerHTML = `
      <div class="cf-row"><span>Server name</span><input type="text" id="cfName" maxlength="24" placeholder="${esc(n.me?.name || "My")}'s server" value="${esc(o.name)}"></div>
      <div class="cf-row"><span>Visibility</span><div class="chips">${chip("visibility", "public", "Public")}${chip("visibility", "private", "Private (code only)")}</div></div>
      <div class="cf-row"><span>Max players</span><div class="chips">${[2, 4, 6, 8].map((v) => chip("max", v, v)).join("")}</div></div>
      <div class="cf-row"><span>Game mode</span><div class="chips wrap">${Object.entries(this.ctx.PARTY_MODES).map(([k, v]) => chip("mode", k, v)).join("")}</div></div>
      <div class="cf-row"><span>Traffic</span><div class="chips">${Object.keys(TRAFFIC_LEVELS).map((k) => chip("traffic", k, k)).join("")}</div></div>
      <div class="cf-row"><span>Time of day</span><div class="chips wrap">${chip("hour", "", "Each player's own")}${Object.entries(TIME_PRESETS).map(([k, h]) => chip("hour", h, k)).join("")}</div></div>
      <div class="cf-row"><span>Weather</span><div class="chips wrap">${chip("weather", "", "Each player's own")}${Object.keys(WEATHERS).map((k) => chip("weather", k, k)).join("")}</div></div>
      <button class="btn green big2" id="cfCreate">CREATE SERVER</button>
      <p class="muted small">${blurb[o.mode] || ""}</p>`;
    box.querySelectorAll("button[data-k]").forEach((b) => b.onclick = () => {
      const k = b.dataset.k, v = b.dataset.v;
      o[k] = k === "max" ? +v : k === "hour" ? (v === "" ? undefined : +v) : k === "weather" ? (v === "" ? undefined : v) : v;
      this.ctx.audio.ui(); this.renderCreateForm();
    });
    $("cfName").oninput = (e) => { o.name = e.target.value; };
    $("cfCreate").onclick = () => {
      if (!n.connected) return this.toast("Not connected to the multiplayer network yet", [], "warn");
      if (n.room) return this.toast("Leave your current server first", [], "warn");
      this.autoDrive = true;
      n.send({ t: "roomCreate", name: o.name.trim(), max: o.max, mode: o.mode, traffic: o.traffic, hour: o.hour, weather: o.weather, public: o.visibility === "public" });
    };
    this.syncCreateButton();
  }
  syncCreateButton() {
    const b = $("cfCreate");
    if (!b) return;
    const ok = this.net.connected;
    b.disabled = !ok; b.textContent = ok ? "CREATE SERVER" : "CONNECTING…";
  }
  // the server you are currently in, on top of every tab
  renderCurrentServer() {
    const n = this.net, box = $("currentServer");
    if (!n.room) { box.hidden = true; return; }
    const r = n.room;
    box.hidden = false;
    box.innerHTML = `<div class="cs-info"><small>YOU'RE IN</small><b>${esc(r.name || "Party " + r.code)}</b>
      <small>${esc(this.ctx.PARTY_MODES[r.mode || "crash"] || "")} · ${r.players.length}/${r.max || 8} players · ${r.public ? "Public" : "Private"} · code ${esc(r.code)}</small></div>`;
    box.appendChild(this.mini("DRIVE", "green", () => { this.closeModals(); this.onlineSelected = true; this.ctx.play("online"); }));
    box.appendChild(this.mini("LEAVE SERVER", "red", () => this.leaveServer()));
  }
  renderPublic() {
    const n = this.net, list = $("srvList");
    if (!n.publicServers) {
      $("srvStatus").textContent = ""; $("srvPing").textContent = "";
      list.innerHTML = `<div class="srv-empty"><b>Public servers need the online relay</b><span>They aren't available in this connection mode.</span></div>`;
      return;
    }
    const servers = n.publicServers(), st = n.listState;
    const searching = !n.connected ? st !== "offline" : st === "loading";
    $("srvStatus").textContent = !n.connected ? (st === "offline" ? "Can't reach the multiplayer network" : "Connecting to the multiplayer network…")
      : searching ? "Searching for servers…" : `${servers.length} server${servers.length === 1 ? "" : "s"} online`;
    $("srvPing").textContent = n.connected && n.ping != null ? `· relay ping ${Math.round(n.ping)} ms` : "";
    list.innerHTML = "";
    if (!servers.length) {
      list.innerHTML = searching
        ? `<div class="srv-empty"><i class="srv-spin"></i><span>Looking for servers…</span></div>`
        : n.connected
          ? `<div class="srv-empty"><b>No public servers right now</b><span>Be the first: open the Create Server tab, or use Quick Play under Private &amp; Friends.</span></div>`
          : `<div class="srv-empty"><b>Not connected</b><span>Check your internet connection, then press Refresh.</span></div>`;
      return;
    }
    for (const s of servers) {
      const d = document.createElement("div");
      d.className = "srv-row" + (s.full ? " full" : "");
      d.innerHTML = `<div class="nm"><b>${esc(s.name)}</b><small>host ${esc(s.host)} · #${esc(s.code)}</small></div>
        <div>${esc(this.ctx.PARTY_MODES[s.mode] || s.mode)}</div><div>${esc(s.traffic)}</div><div class="cnt">${s.players}/${s.max}</div><div></div>`;
      const btn = this.mini(s.mine ? "JOINED" : s.full ? "FULL" : "JOIN", s.mine ? "ghost" : s.full ? "ghost" : "green", () => {
        if (!n.connected) return this.toast("Not connected to the multiplayer network", [], "warn");
        this.autoDrive = true; this.toast(`Joining ${s.name}…`, [], "info");
        n.send({ t: "roomJoin", code: s.code });
      });
      if (s.mine || s.full) btn.disabled = true;
      d.lastElementChild.appendChild(btn);
      list.appendChild(d);
    }
  }
  renderOnline() {
    const n = this.net;
    $("offlineNote").hidden = n.connected || n.listState !== "offline";
    const tab = this.onlineTab || "public";
    $("onlineTabs").querySelectorAll("[data-otab]").forEach((b) => b.classList.toggle("on", b.dataset.otab === tab));
    document.querySelectorAll("#online .opane").forEach((p) => { p.hidden = p.dataset.pane !== tab; });
    this.renderCurrentServer();
    if (tab === "public") this.renderPublic();
    if (tab === "create") this.syncCreateButton();
    if (n.relayStatus) $("relayStatus").textContent = "Relays: " + n.relayStatus().map((r) => `${r.name} ${r.up ? "✓" : "✗"}`).join(" · ");
    if (document.activeElement !== $("nameInput")) $("nameInput").value = P.name;
    $("myCode").textContent = n.me?.code || "------";
    $("requests").innerHTML = "";
    for (const r of n.incoming) {
      const d = document.createElement("div");
      d.className = "friend";
      d.innerHTML = `<div class="nm">${esc(r.name)}<small>wants to be friends</small></div><button class="btn green">ACCEPT</button><button class="btn red">✕</button>`;
      const [acc, dec] = d.querySelectorAll("button");
      acc.onclick = () => n.send({ t: "friendAccept", id: r.id });
      dec.onclick = () => n.send({ t: "friendDecline", id: r.id });
      $("requests").appendChild(d);
    }
    const fl = $("friendList");
    fl.innerHTML = n.friends.length ? "" : `<div class="muted">No friends yet — share your code!</div>`;
    const sorted = [...n.friends].sort((a, b) => b.online - a.online);
    for (const f of sorted) {
      const d = document.createElement("div");
      d.className = "friend";
      const inMine = n.room && f.room === n.room.code;
      d.innerHTML = `<span class="dot ${f.online ? "on" : ""}"></span><div class="nm">${esc(f.name)}<small>${f.online ? (f.room ? (inMine ? "In your party" : "In a party") : "Online") : "Offline"} · best ${f.best.toLocaleString()}</small></div>`;
      if (f.online && f.room && !inMine) d.appendChild(this.mini("JOIN", "green", () => n.send({ t: "joinFriend", id: f.id })));
      if (f.online && n.room && !inMine) d.appendChild(this.mini("INVITE", "blue", () => n.send({ t: "invite", id: f.id })));
      d.appendChild(this.mini("✕", "gray", () => { if (confirm(`Remove ${f.name} from friends?`)) n.send({ t: "friendRemove", id: f.id }); }));
      fl.appendChild(d);
    }
    $("partyNone").hidden = !!n.room;
    $("partyIn").hidden = !n.room;
    if (n.room) {
      $("partyCode").textContent = n.room.code;
      this.renderPartySettings();
      const members = $("partyMembers");
      members.innerHTML = "";
      for (const p of n.room.players) {
        const b = p.build, me = p.id === n.me?.id || p.id === n.me?.code;
        const d = document.createElement("div");
        d.className = "friend build";
        const host = n.room.players[0]?.id === p.id;
        d.innerHTML = `<span class="dot on"></span><div class="nm">${host ? '<span class="host">HOST</span>' : ""}${esc(p.name)}${me ? " (you)" : ""}
          <small>${esc(carById(b?.car || p.car).name || "")}${b?.hp ? " · " + b.hp + " hp" : ""}${b?.parts?.length ? " · " + b.parts.length + " mods" : ""}</small></div>`;
        if (b && !me) d.appendChild(this.mini("VIEW", "primary", () => this.viewBuild(p)));
        members.appendChild(d);
      }
    }
  }
  renderPartySettings() {
    const n = this.net, r = n.room, box = $("partySettings");
    const isHost = r.players[0]?.id === (n.me?.id ?? n.me?.code) || r.players[0]?.id === n.me?.code;
    const locked = !isHost || r.roundState === "running";
    const set = (patch) => n.send({ t: "roomSettings", mode: r.mode, target: r.target, dur: r.dur, traffic: r.traffic, ...patch });
    const chip = (group, val, label, cur) => `<button data-g="${group}" data-v="${val}" class="${String(cur) === String(val) ? "on" : ""}" ${locked ? "disabled" : ""}>${label}</button>`;
    box.innerHTML = `<div class="ps-row"><span>Mode</span><div class="chips">${Object.entries(this.ctx.PARTY_MODES).map(([k, v]) => chip("mode", k, v, r.mode || "crash")).join("")}</div></div>
      ${(r.mode || "crash") === "target" ? `<div class="ps-row"><span>Target</span><div class="chips">${[5000, 10000, 25000, 50000].map((v) => chip("target", v, (v / 1000) + "K", r.target || 10000)).join("")}</div></div>` : ""}
      ${r.mode === "timed" ? `<div class="ps-row"><span>Time</span><div class="chips">${[60, 120, 180, 300].map((v) => chip("dur", v, v / 60 + " min", r.dur || 120)).join("")}</div></div>` : ""}
      <div class="ps-row"><span>Traffic</span><div class="chips">${Object.keys(TRAFFIC_LEVELS).map((k) => chip("traffic", k, k, r.traffic || "Heavy")).join("")}</div></div>
      <div class="muted small">${isHost ? (r.roundState === "running" ? "Settings unlock between rounds." : "You're the host — settings apply to the next round.") : "Only the host can change these."}</div>`;
    box.querySelectorAll("button[data-g]").forEach((b) => b.onclick = () => set({ [b.dataset.g]: b.dataset.g === "target" || b.dataset.g === "dur" ? +b.dataset.v : b.dataset.v }));
  }
  mini(label, cls, run) { const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = label; b.onclick = run; return b; }

  wireNet() {
    const n = this.net;
    const refresh = () => { if (!$("online").hidden) this.renderOnline(); if (this.ctx.state() === "home") this.renderHome(); };
    n.addEventListener("status", () => {
      refresh();
      if (n.connected && !$("online").hidden && (this.onlineTab || "public") === "public" && n.listState !== "ready") n.send({ t: "publicRefresh" });
      if (n.me && P.name !== n.me.name && n.connected) n.send({ t: "setName", name: P.name });
      if (n.me) { n.send({ t: "leaderboard" }); if (P.best > (n.me.best || 0)) n.send({ t: "score", score: P.best, level: P.level }); }
    });
    n.addEventListener("social", refresh);
    n.addEventListener("room", (e) => {
      refresh();
      if (n.room && e.detail.fresh) {
        this.onlineSelected = true;
        this.toast(`Joined ${n.room.name || "party " + n.room.code}`, [], "success");
        // joining or creating from a list goes straight to the road
        if (this.autoDrive) { this.autoDrive = false; this.closeModals(); this.ctx.play("online"); }
      }
      if (!n.room) {
        this.autoDrive = false;
        // leaving mid-drive returns you to the multiplayer menu rather than dropping you at the garage
        if (this.ctx.mode() === "online" && this.ctx.state() !== "home") {
          this.toast("You left the server", [], "info"); this.ctx.home();
          this.onlineTab = "public"; this.openModal("online"); n.send({ t: "publicRefresh" });
        }
      }
    });
    n.addEventListener("publicList", () => { if (!$("online").hidden && (this.onlineTab || "public") === "public") this.renderPublic(); });
    n.addEventListener("ping", () => { if (!$("online").hidden) $("srvPing").textContent = n.ping != null ? `· relay ping ${Math.round(n.ping)} ms` : ""; });
    n.addEventListener("error", (e) => { this.autoDrive = false; this.toast(e.detail.msg, [], "error"); });
    n.addEventListener("toast", (e) => this.toast(e.detail.msg));
    n.addEventListener("friendRequest", (e) => {
      const r = e.detail;
      this.toast(`${r.name} sent you a friend request`, [{ label: "ACCEPT", run: () => n.send({ t: "friendAccept", id: r.id }) }, { label: "✕", cls: "gray", run: () => n.send({ t: "friendDecline", id: r.id }) }]);
    });
    n.addEventListener("invite", (e) => {
      const m = e.detail;
      this.toast(`${m.from} invited you to their party`, [{ label: "JOIN", run: () => n.send({ t: "roomJoin", code: m.room }) }, { label: "✕", cls: "gray", run: () => {} }]);
    });
    n.addEventListener("leaderboard", (e) => {
      this.board = e.detail;
      if (!$("over").hidden) this.renderBoard($("goBoard"));
      if (!$("leader").hidden) this.renderBoard($("leaderBoard"));
    });
  }

  // ---------- tuning + upgrade shop ----------
  // Every control here feeds the simulation in tuning.js and every price comes from economy.js.
  // Nothing is randomised, and nothing is free: parts are bought per car, the engine map needs ECU
  // access, and committing a new map costs a dyno session.
  wireTune() {
    this.ENGINE_CONTROLS = [
      { key: "boost", group: "Boost", label: "Target boost", fmt: (v) => v.toFixed(1) + " psi", boosted: true, hint: "Air pressure the ECU aims for. More boost = more torque, more heat, more stress." },
      { key: "wastegate", group: "Boost", label: "Wastegate duty", fmt: (v) => Math.round(v * 100) + "%", boosted: true, hint: "Holding the gate shut spools earlier and holds boost up top, but overshoots more." },
      { key: "timing", group: "Ignition & fuel", label: "Ignition timing", fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "°", hint: "Advance makes power until it knocks - then the ECU pulls timing and you lose power." },
      { key: "afr", group: "Ignition & fuel", label: "Target AFR", fmt: (v) => v.toFixed(1) + ":1", hint: "Richer is safer and cooler; leaner makes a little more power until it knocks." },
      { key: "revLimit", group: "Revs & gearing", label: "Rev limit", fmt: (v) => Math.round(v).toLocaleString() + " rpm", hint: "Keeps a gear alive longer, but the curve is already falling up there." },
      { key: "final", group: "Revs & gearing", label: "Final drive", fmt: (v) => v.toFixed(2), hint: "Shorter (higher number) = more wheel torque and a quicker launch, lower top speed." },
      { key: "gearing", group: "Revs & gearing", label: "Gear spread", fmt: (v) => v.toFixed(2) + "x " + (v > 1.005 ? "shorter" : v < .995 ? "taller" : "stock"), hint: "Scales every gear. Above 1 = shorter: more pull, less speed per 1000 rpm." },
    ];
    this.EXHAUST_CONTROLS = [
      { key: "burble", group: "Overrun", label: "Decel fuel cut", fmt: (v) => Math.round(v * 100) + "%", hint: "How much fuel the engine keeps firing off the throttle: how often it pops." },
      { key: "burbleVol", group: "Overrun", label: "Burble loudness", fmt: (v) => Math.round(v * 100) + "%", hint: "How loud the pops and bangs are." },
      { key: "decay", group: "Overrun", label: "Burble length", fmt: (v) => (v <= .12 ? "single bang" : v.toFixed(1) + " s"), hint: "How long it keeps crackling after you lift. All the way down: one big bang." },
      { key: "mix", group: "Overrun", label: "Pop style", fmt: (v) => (v < .35 ? "burble" : v > .65 ? "crackle" : "mixed"), hint: "Deep, round burble or sharp, snapping crackle." },
      { key: "aggr", group: "Character", label: "Aggressiveness", fmt: (v) => (v < .5 ? "Docile" : v < .9 ? "Mild" : v < 1.2 ? "Stock" : v < 1.6 ? "Angry" : "Unhinged"), hint: "Drive and rasp in the exhaust note." },
      { key: "engineBrake", group: "Character", label: "Engine braking", fmt: (v) => Math.round(v * 100) + "%", hint: "How hard the car slows when you come off the throttle." },
    ];
    this.tuneSec = "engine";
    this.pick = null;
    this.draft = null;
    this.holdToRev($("tuneRev"));
    $("tuneDyno").onclick = () => this.runDyno();
    $("tBrap").onchange = (e) => this.editTune({ brap: e.target.checked });
    $("tuneReset").onclick = () => {
      if (!confirm("Reset this car's tune to stock? Parts you bought stay in the garage.")) return;
      this.tunePrev = summary(carById(this.view), carTune(this.view));
      resetTune(this.view); this.draft = null; this.pick = null; this.afterTune();
    };
    $("tRelease").innerHTML = "";
    for (const [val, label] of [["flutter", "Turbo flutter"], ["bov", "Blow-off valve"], ["off", "Off"]]) {
      const b = document.createElement("button"); b.textContent = label; b.dataset.v = val;
      b.onclick = () => this.editTune({ release: val });
      $("tRelease").appendChild(b);
    }
    $("tune").addEventListener("input", (e) => { if (e.target.type === "range") fillRange(e.target); });
    // the dyno chart is drawn at the size it is shown
    addEventListener("resize", () => { if (!$("tune").hidden) this.renderTune(); });
  }
  // the tune the player is looking at: what's fitted, plus anything they've dialled in but not paid for
  effTune() { return { ...carTune(this.view), ...(this.draft || {}) }; }
  editTune(patch) {
    this.draft = { ...(this.draft || {}), ...patch };
    this.renderTune();
  }
  applyDraft() {
    if (!this.draft) return;
    const r = payTuneSession(this.view);
    if (r.needEcu) return this.toast("You need ECU access on this car first");
    if (!r.ok) return this.notEnough(r.short);
    this.tunePrev = summary(carById(this.view), carTune(this.view));
    setTune(this.view, this.draft);
    this.draft = null;
    this.ctx.audio.coin();
    this.afterTune();
  }
  notEnough(short) { this.toast(`Not enough coins — ${fmtCoins(short)} short`); this.ctx.audio.deny?.(); }
  afterTune() {
    if (this.view === P.equipped) this.ctx.applyTune();
    this.tuneStamp = performance.now();
    this.renderTune();
    this.renderTop();
  }
  buyPartUI(kind, option) {
    const price = partPrice(kind, option);
    if (!ownsPart(this.view, kind, option)) {
      const r = buyPart(this.view, kind, option);
      if (!r.ok) return this.notEnough(r.short);
      this.ctx.audio.coin();
      this.toast(`Fitted ${PARTS[kind].opts[option].label} — ${fmtCoins(price)} coins`);
    }
    this.tunePrev = summary(carById(this.view), carTune(this.view));
    setTune(this.view, { [kind]: option });     // fitting something you own is free
    this.afterTune();
  }
  // the best (last) option of every part this car can take: what it would cost and what changes
  bestPlan() {
    const car = carById(this.view), cur = carTune(this.view), e = engineOf(car), boosted = isForced(e, cur), plan = [];
    let total = 0;
    for (const [kind, def] of Object.entries(PARTS)) {
      if (def.forcedOnly && (!boosted || e.induction === "super")) continue;
      const keys = Object.keys(def.opts).filter((k) => this.optFits(kind, k, e));
      const best = keys[keys.length - 1];
      if (!best) continue;
      if (cur[kind] === best) continue;
      const price = ownsPart(car.id, kind, best) ? 0 : partPrice(kind, best);
      plan.push({ kind, best, price }); total += price;
    }
    return { plan, total };
  }
  applyBest() {
    const { plan, total } = this.bestPlan();
    if (!plan.length) return;
    if (P.coins < total) return this.notEnough(total - P.coins);
    for (const p of plan) if (!ownsPart(this.view, p.kind, p.best)) { const r = buyPart(this.view, p.kind, p.best); if (!r.ok) return this.notEnough(r.short); }
    this.tunePrev = summary(carById(this.view), carTune(this.view));
    setTune(this.view, Object.fromEntries(plan.map((p) => [p.kind, p.best])));
    this.ctx.audio.coin();
    this.toast(total ? `Best parts fitted — ${fmtCoins(total)} coins` : "Best parts fitted");
    this.afterTune();
  }
  buyEcuUI() {
    const r = buyEcu(this.view);
    if (!r.ok) return this.notEnough(r.short);
    this.ctx.audio.coin();
    this.toast(`ECU unlocked — ${fmtCoins(TUNING_PRICES.ecu)} coins`);
    this.afterTune();
  }

  // unsaved ECU/exhaust edits that differ from what is flashed
  draftKeys(fitted) { return this.draft ? Object.keys(this.draft).filter((k) => fitted[k] !== this.draft[k]) : []; }

  renderTune() {
    const car = carById(this.view), e = engineOf(car);
    const fitted = carTune(this.view), t = this.effTune(), boosted = isForced(e, t), hasEcu = ownsEcu(this.view);
    if (this.pick && (this.pick.car !== car.id || t[this.pick.kind] === this.pick.key)) this.pick = null;
    // The dyno compares the build as it stands with where it is heading: a part picked in the shop,
    // or map changes not flashed yet.
    const next = this.pick ? normalizeTune(car, { ...t, [this.pick.kind]: this.pick.key }) : this.draftKeys(fitted).length ? t : null;
    $("tuneCar").textContent = car.name;
    $("tuneCoins").textContent = fmtCoins(P.coins);
    const ind = isBoosted(e) ? (e.induction === "super" ? "supercharged" : e.turbos > 1 ? "twin-turbo" : "turbo") : boosted ? "turbo conversion" : "naturally aspirated";
    $("tuneEngine").innerHTML = `<b>${esc(e.label)}</b> · ${e.disp.toFixed(1)} L ${e.cyl}-cyl · ${ind}`;

    this.renderTuneNav(fitted, e, hasEcu);
    const sec = WS_SECTIONS.find((s) => s.id === this.tuneSec) || WS_SECTIONS[0];
    $("paneParts").hidden = !sec.kinds;
    $("paneEcu").hidden = sec.id !== "ecu";
    $("paneSound").hidden = sec.id !== "sound";
    $("paneLooks").hidden = sec.id !== "looks";
    if (sec.kinds) this.renderParts(car, t, boosted, e, sec);
    if (sec.id === "ecu") this.renderEcu(car, t, boosted, hasEcu, fitted);
    if (sec.id === "sound") {
      this.mrows("tuneExhaust", this.EXHAUST_CONTROLS, t, false, fitted, car, true);
      $("tBrap").checked = t.brap;
      [...$("tRelease").children].forEach((b) => b.classList.toggle("on", b.dataset.v === t.release));
    }
    this.renderApplyBar(fitted);
    this.renderDyno(car, fitted, next);
    $("tune").querySelectorAll("input[type=range]").forEach(fillRange);
  }

  // the section list, each with how far along that part of the build is
  renderTuneNav(fitted, e, hasEcu) {
    const boosted = isForced(e, fitted), dirty = this.draftKeys(fitted);
    const html = WS_SECTIONS.map((s, i) => {
      let sub, frac = null;
      if (s.kinds) {
        const kinds = s.kinds.filter((k) => this.kindOpen(k, e, boosted));
        let done = 0, lvl = 0;
        for (const k of kinds) {
          const keys = Object.keys(PARTS[k].opts).filter((o) => this.optFits(k, o, e)), at = Math.max(0, keys.indexOf(fitted[k]));
          if (at > 0) done++;
          lvl += at / (keys.length - 1);
        }
        sub = `${done} of ${kinds.length} upgraded`;
        frac = kinds.length ? lvl / kinds.length : 0;
      } else if (s.id === "ecu") sub = !hasEcu ? "Locked" : this.ENGINE_CONTROLS.some((c) => dirty.includes(c.key)) ? "Unsaved changes" : "Custom map";
      else if (s.id === "sound") sub = this.EXHAUST_CONTROLS.some((c) => dirty.includes(c.key)) || dirty.includes("brap") || dirty.includes("release") ? "Unsaved changes" : "Burble & crackle";
      else sub = "Paint, wheels, stance";
      const cls = (s.id === this.tuneSec ? " on" : "") + (s.id === "ecu" && !hasEcu ? " lock" : "") + (sub === "Unsaved changes" ? " dirty" : "");
      return (i === 3 ? '<div class="nav-sep"></div>' : "") +
        `<button class="nv${cls}" data-sec="${s.id}">${WS_ICONS[s.id]}<b>${s.label}</b><small>${sub}</small>${frac !== null ? `<span class="nv-bar"><i style="width:${Math.round(frac * 100)}%"></i></span>` : ""}</button>`;
    }).join("");
    const nav = $("tuneNav");
    nav.innerHTML = html;
    nav.querySelectorAll(".nv").forEach((b) => b.onclick = () => {
      if (this.tuneSec === b.dataset.sec) return;
      this.tuneSec = b.dataset.sec; this.pick = null;
      $("tuneMain").scrollTop = 0;
      this.ctx.audio.ui();
      this.renderTune();
    });
  }
  // can this car take anything but the stock part of this kind?
  kindOpen(kind, e, boosted) {
    if (PARTS[kind].forcedOnly && (!boosted || e.induction === "super")) return false;
    return Object.keys(PARTS[kind].opts).filter((k) => this.optFits(kind, k, e)).length > 1;
  }

  renderEcu(car, t, boosted, hasEcu, fitted) {
    const gate = $("ecuGate");
    gate.hidden = hasEcu;
    if (!hasEcu) {
      const can = P.coins >= TUNING_PRICES.ecu;
      gate.innerHTML = `<div class="gate-body">${WS_ICONS.ecu}<div><b>ECU access locked</b><p>Boost, timing, fuel, rev limit and gearing need a flashed ECU on this car.</p></div>
        <button class="btn ${can ? "accent" : "ghost"}" id="ecuBuy" ${can ? "" : "disabled"}>${can ? `UNLOCK · ${COIN}${fmtCoins(TUNING_PRICES.ecu)}` : `NEED ${fmtCoins(TUNING_PRICES.ecu - P.coins)} MORE`}</button></div>`;
      $("ecuBuy").onclick = () => this.buyEcuUI();
    }
    // one-click stage maps, computed from this car's parts and fuel (still a paid dyno session to apply)
    $("tunePresets").innerHTML = hasEcu ? [[1, "Street", "Plenty of knock margin"], [2, "Fast road", "Most of the headroom"], [3, "On the edge", "Right up to knock"]]
      .map(([s, a, b]) => `<button class="stage" data-s="${s}"><small>AUTO-MAP</small><b>STAGE ${s}</b><span>${a}</span><small>${b}</small></button>`).join("") : "";
    $("tunePresets").querySelectorAll("button").forEach((b) => b.onclick = () => { this.editTune(stageMap(car, t, +b.dataset.s)); this.toast(`Stage ${b.dataset.s} map loaded — flash it to keep it`); });
    this.mrows("tuneSliders", this.ENGINE_CONTROLS, t, !hasEcu, fitted, car, boosted);
  }

  // A column of labelled sliders, grouped. While one is being dragged the rows are not rebuilt
  // (that would drop the drag) - only their readouts are refreshed.
  mrows(hostId, list, t, disabled, fitted, car, boosted) {
    const host = $(hostId), active = document.activeElement;
    if (active?.type === "range" && host.contains(active) && host.querySelector(".mrow")) {
      host.querySelectorAll(".mrow").forEach((row) => {
        const c = list.find((x) => x.key === row.dataset.k);
        row.querySelector(".mv").textContent = c.fmt(+t[c.key]);
        row.classList.toggle("chg", fitted[c.key] !== t[c.key]);
      });
      return;
    }
    let html = "", group = null;
    for (const c of list) {
      if (c.boosted && !boosted) continue;
      if (c.group !== group) { group = c.group; html += `<h4>${group}</h4>`; }
      const [lo, hi, step] = this.tuneRange(car, c.key);
      html += `<label class="mrow${disabled ? " off" : ""}${fitted[c.key] !== t[c.key] ? " chg" : ""}" data-k="${c.key}">
        <span class="mrow-l"><b>${c.label}</b><small>${c.hint}</small></span>
        <input type="range" min="${lo}" max="${hi}" step="${step}" value="${t[c.key]}" ${disabled ? "disabled" : ""}>
        <b class="mv">${c.fmt(+t[c.key])}</b></label>`;
    }
    host.innerHTML = html;
    host.querySelectorAll(".mrow input").forEach((inp) => inp.oninput = () => this.editTune({ [inp.closest(".mrow").dataset.k]: +inp.value }));
  }

  // pending map/exhaust changes: what they cost and the only button that takes money for them
  renderApplyBar(fitted) {
    const bar = $("tuneApplyBar"), n = this.draftKeys(fitted).length;
    bar.hidden = !n;
    if (!n) return;
    const canPay = P.coins >= TUNING_PRICES.session;
    bar.innerHTML = `<div><b>${n} unsaved change${n > 1 ? "s" : ""}</b><small>Flashing is a dyno session · ${fmtCoins(TUNING_PRICES.session)} coins</small></div>
      <button class="btn ghost" id="tuneRevert">REVERT</button>
      <button class="btn ${canPay ? "primary" : "ghost"}" id="tuneApply" ${canPay ? "" : "disabled"}>${canPay ? `FLASH · ${COIN}${fmtCoins(TUNING_PRICES.session)}` : "NOT ENOUGH COINS"}</button>`;
    $("tuneRevert").onclick = () => { this.draft = null; this.renderTune(); };
    $("tuneApply").onclick = () => this.applyDraft();
  }

  // ---- the dyno: power, the curves, the numbers that matter, and how hard the engine is working ----
  renderDyno(car, fitted, next) {
    const e = engineOf(car), cur = summaryCache(car, fitted), stock = summaryCache(car, defaultTune(car));
    const nx = next ? summaryCache(car, next) : null;
    const f0 = (v) => Math.round(v).toLocaleString();
    // just bought something: say what it did for a few seconds
    const was = performance.now() - (this.tuneStamp || 0) < 6000 ? this.tunePrev : null;
    const dHp = nx ? nx.hp - cur.hp : 0, dWas = was ? cur.hp - was.hp : 0;
    const sgn = (d) => (d > 0 ? "+" : "−") + f0(Math.abs(d));
    const sub = nx && dHp ? `<em class="${dHp < 0 ? "down" : ""}">${sgn(dHp)} hp</em> with this change`
      : dWas ? `<em class="${dWas < 0 ? "down" : ""}">${sgn(dWas)} hp</em> from your last change`
      : cur.hp - stock.hp >= 1 ? `<em>+${f0(cur.hp - stock.hp)} hp</em> over stock` : "Factory power";
    $("dyPower").innerHTML = `<div class="dy-k">PEAK POWER</div>
      <div class="dy-big"><b>${f0(cur.hp)}</b>${nx && dHp ? `<span class="ar">→</span><b class="nx${dHp < 0 ? " worse" : ""}">${f0(nx.hp)}</b>` : ""}<span class="u">hp</span></div>
      <div class="dy-sub">${sub} · ${f0((nx || cur).hpRpm)} rpm</div>`;

    // dir: 1 = higher is better, -1 = lower is better, 0 = neither
    const mass = (tt) => specOf(car).mass * partOpt("weight", tt.weight).mass;
    const tiles = [
      ["Torque", cur.nm, nx?.nm, (v) => `${f0(v)} Nm`, 1, "nm"],
      ["0-60 mph", cur.zeroTo60, nx?.zeroTo60, (v) => `${v.toFixed(2)} s`, -1, "zeroTo60"],
      ["Top speed", cur.topKmh * MPH, nx && nx.topKmh * MPH, (v) => `${f0(v)} mph`, 1, "topKmh"],
      isForced(e, next || fitted) ? ["Peak boost", cur.peakBoost, nx?.peakBoost, (v) => `${v.toFixed(1)} psi`, 0, "peakBoost"]
        : ["Rev limit", fitted.revLimit, next?.revLimit, (v) => `${f0(v)} rpm`, 0],
      ["Weight", mass(fitted), next && mass(next), (v) => `${f0(v)} kg`, -1],
      ["Driven wheels", driveOf(car, fitted).toUpperCase(), next && driveOf(car, next).toUpperCase(), (v) => v, 0],
    ];
    $("dyStats").innerHTML = tiles.map(([label, v, nv, fmt, dir, key]) => {
      const show = nv != null && fmt(nv) !== fmt(v);
      const cls = !show || !dir || typeof nv !== "number" ? "" : dir * (nv - v) > 0 ? "up" : "down";
      const chg = was && key && fmt(key === "topKmh" ? was[key] * MPH : was[key]) !== fmt(v);
      return `<div class="ds${chg ? " chg" : ""}"><span>${label}</span><b>${fmt(v)}</b>${show ? `<em class="${cls}">→ ${fmt(nv)}</em>` : ""}</div>`;
    }).join("");

    const lv = ["Low", "Medium", "High", "Extreme"], at = lv.indexOf(cur.stress), to = nx ? lv.indexOf(nx.stress) : at;
    const st = $("dyStress");
    st.className = "dy-stress " + lv[to].toLowerCase();
    st.innerHTML = `<div class="st-top"><span>ENGINE STRESS</span><b>${cur.stress}${to !== at ? ` → ${nx.stress}` : ""}</b></div>
      <div class="st-bar">${lv.map((_, j) => `<i class="${j <= to ? "on" : ""}"></i>`).join("")}</div>`;

    const s = nx || cur, msgs = [];
    if (s.pulled > 0.5) msgs.push(`Knock: the ECU is pulling ${s.pulled}° of timing. Richer fuel, less boost or a better intercooler gives the power back.`);
    if (s.egt > 950) msgs.push(`EGT ${s.egt}°C is very high — richen the AFR.`);
    if (s.stress === "Extreme") msgs.push("This tune is way past what the block was built for.");
    const warn = $("tuneWarn");
    warn.hidden = !msgs.length;
    warn.innerHTML = msgs.map((m) => `<div>${m}</div>`).join("");

    // only offered when you can afford every upgrade it would buy
    const bp = this.bestPlan(), ab = $("applyBest");
    ab.hidden = !bp.plan.length || P.coins < bp.total;
    ab.innerHTML = bp.total ? `UPGRADE EVERYTHING · ${COIN}${fmtCoins(bp.total)}` : "FIT THE BEST PARTS YOU OWN";
    ab.onclick = () => this.applyBest();

    $("dyLegNext").hidden = !nx;
    this.lastSeries = { stock: { c: stock.curve, lim: defaultTune(car).revLimit }, cur: { c: cur.curve, lim: fitted.revLimit } };
    if (this.dynoLive) return this.renderDynoLive();
    this.drawDyno(this.lastSeries.stock, this.lastSeries.cur, nx && { c: nx.curve, lim: next.revLimit });
  }

  // ---- dyno run: a full pull on the rollers, the curve traced as the revs climb ----
  runDyno() {
    if (this.dynoLive) return;
    const car = carById(this.view), cur = summaryCache(car, carTune(this.view)), btn = $("tuneDyno");
    this.dynoLive = { rpm: 0, now: 0, phase: "spool", cur };
    btn.disabled = true; btn.textContent = "ON THE ROLLERS…"; $("tuneRev").disabled = true;
    this.ctx.dynoPull(carSound(this.view), this.view, (rpm, phase) => {
      const L = this.dynoLive;
      if (!L) return;
      if (phase === "pull" || phase === "limit") L.rpm = Math.max(L.rpm, rpm);
      L.phase = phase; L.now = rpm;
      if (!$("tune").hidden) this.renderDynoLive();
    }).then(() => {
      const L = this.dynoLive;
      this.dynoLive = null;
      btn.disabled = false; btn.textContent = "▶ RUN DYNO"; $("tuneRev").disabled = false;
      if (L) this.toast(`Dyno: ${Math.round(L.cur.hp).toLocaleString()} hp at ${L.cur.hpRpm.toLocaleString()} rpm · ${Math.round(L.cur.nm).toLocaleString()} Nm at ${L.cur.nmRpm.toLocaleString()} rpm`, [], "success");
      if (!$("tune").hidden) this.renderTune();
    });
  }
  // while it pulls: power and torque at the revs the rollers are turning, the curve drawn up to them
  renderDynoLive() {
    const L = this.dynoLive, s = this.lastSeries;
    if (!L || !s) return;
    const pulling = L.phase === "spool" || L.phase === "pull";
    const at = (r) => L.cur.curve.reduce((a, p) => (Math.abs(p.rpm - r) < Math.abs(a.rpm - r) ? p : a), L.cur.curve[0]);
    const p = pulling ? at(Math.min(L.now, s.cur.lim)) : { hp: L.cur.hp, nm: L.cur.nm, boost: L.cur.peakBoost };
    const live = L.rpm > 0;
    $("dyPower").innerHTML = `<div class="dy-k">${pulling ? "ON THE DYNO" : "PEAK"} · ${Math.round(L.now).toLocaleString()} RPM</div>
      <div class="dy-big"><b>${live ? Math.round(p.hp).toLocaleString() : "—"}</b><span class="u">hp</span></div>
      <div class="dy-sub">${live ? `${Math.round(p.nm).toLocaleString()} Nm${p.boost > .5 ? ` · ${p.boost.toFixed(1)} psi` : ""}` : "Strapping down…"}</div>`;
    this.drawDyno(s.stock, s.cur, null, live ? L.rpm : 1000);
  }

  // A factory-turbo upgrade only bolts to an engine that already has a turbo; a conversion kit
  // only makes sense on one that does not.
  optFits(kind, key, e) {
    if (kind === "drivetrain") return key === "stock" || (DRIVE_LAYOUT[this.view] || "rwd") !== "awd";
    if (kind !== "turbo") return true;
    const o = PARTS.turbo.opts[key] || {};
    if (e.induction === "super") return key === "stock";
    if (o.factoryOnly) return isBoosted(e);
    if (o.convert) return !isBoosted(e);
    return true;
  }

  // ---- upgrade shop: one card per part, its options laid out as levels ----
  // Picking a level previews it on the dyno; the card then offers to buy or fit it.
  renderParts(car, t, boosted, e, sec) {
    const host = $("paneParts"), baseHp = peakHp(car, t);
    let html = `<div class="pane-head"><h3>${sec.label.toUpperCase()}</h3><p>${sec.blurb}</p></div>`;
    for (const kind of sec.kinds) {
      const def = PARTS[kind], keys = Object.keys(def.opts).filter((k) => this.optFits(kind, k, e));
      const locked = def.forcedOnly && (!boosted || e.induction === "super");
      const onKey = keys.includes(t[kind]) ? t[kind] : keys[0];
      const nm = (k) => { const o = def.opts[k]; return kind === "turbo" && !isBoosted(e) && o.naLabel ? o.naLabel : o.label; };
      const sel = !locked && this.pick?.kind === kind ? this.pick.key : null;
      const blurb = kind === "turbo" && !isBoosted(e) ? "Bolt a turbo onto the engine. Unlocks boost, the intercooler and anti-lag." :
        kind === "drivetrain" && keys.length < 2 ? "This car already drives all four wheels." : PART_BLURB[kind];
      const n = keys.length;
      const tiles = keys.map((k, i) => {
        const price = partPrice(kind, k), owned = ownsPart(car.id, kind, k), on = k === onKey, fx = this.tierEffect(kind, k, car, t, baseHp);
        const status = on ? "FITTED" : !price ? "Included" : owned ? "Owned" : `${COIN}${fmtCoins(price)}`;
        const pips = n > 2 ? `<span class="pips">${Array.from({ length: n - 1 }, (_, j) => `<i class="${j < i ? "on" : ""}"></i>`).join("")}</span>` : "";
        const cls = (on ? " fitted" : "") + (k === sel ? " sel" : "") + (owned && price && !on ? " owned" : "");
        const tp = on ? "" : !price || owned ? " have" : P.coins >= price ? " cost" : " poor";
        return `<button class="tier${cls}" data-k="${k}" ${locked ? "disabled" : ""}>${pips}<span class="tn">${esc(nm(k))}</span><span class="te ${fx.cls}">${fx.text}</span><span class="tp${tp}">${status}</span></button>`;
      }).join("");
      let act = "";
      if (sel) {
        const price = partPrice(kind, sel), owned = ownsPart(car.id, kind, sel) || !price, afford = P.coins >= price;
        act = `<div class="pc-act"><div><b>${esc(nm(sel))}</b><small>${this.partEffect(kind, sel, car, t, baseHp) || "&nbsp;"}</small></div>
          <button class="btn ghost" data-cancel>CANCEL</button>
          <button class="btn ${owned ? "primary" : afford ? "accent" : "ghost"}" data-buy ${owned || afford ? "" : "disabled"}>${owned ? "FIT IT" : afford ? `BUY &amp; FIT · ${COIN}${fmtCoins(price)}` : `NEED ${fmtCoins(price - P.coins)} MORE`}</button></div>`;
      }
      html += `<div class="pc${locked ? " locked" : ""}${sel ? " sel" : ""}" data-kind="${kind}">
        <div class="pc-head"><b>${def.label}</b><span class="pc-now">${locked ? "Needs a turbo" : `Fitted: <em>${esc(nm(onKey))}</em>`}</span></div>
        <p class="pc-blurb">${blurb}</p><div class="tiers">${tiles}</div>${act}</div>`;
    }
    host.innerHTML = html;
    host.querySelectorAll(".pc").forEach((card) => {
      const kind = card.dataset.kind;
      card.querySelectorAll(".tier").forEach((b) => b.onclick = () => {
        const k = b.dataset.k;
        this.pick = t[kind] === k || (this.pick?.kind === kind && this.pick.key === k) ? null : { car: car.id, kind, key: k };
        this.ctx.audio.ui();
        this.renderTune();
      });
      card.querySelector("[data-cancel]")?.addEventListener("click", () => { this.pick = null; this.renderTune(); });
      card.querySelector("[data-buy]")?.addEventListener("click", () => { const k = this.pick.key; this.pick = null; this.buyPartUI(kind, k); });
    });
  }
  // the short line on a level tile: what it does against what is fitted now
  tierEffect(kind, key, car, t, baseHp) {
    const o = PARTS[kind].opts[key];
    if (kind === "drivetrain") {
      if (!o.drive) return { text: `Factory ${(DRIVE_LAYOUT[car.id] || "rwd").toUpperCase()}`, cls: "" };
      return { text: `0-60 ${summaryCache(car, { ...t, drivetrain: key }).zeroTo60.toFixed(2)} s`, cls: "up" };
    }
    if (o.drag === undefined && (o.flow !== undefined || o.maxBoost !== undefined || o.eff !== undefined || o.knock !== undefined || o.power !== undefined)) {
      if (t[kind] === key) return { text: `${baseHp} hp`, cls: "" };
      const d = peakHp(car, { ...t, [kind]: key }) - baseHp;
      // fuel, internals and the intercooler buy knock headroom: the power comes when the map uses it
      if (!d) return { text: o.knock > 1 || o.eff ? "More knock headroom" : "No change", cls: "" };
      return { text: `${d > 0 ? "+" : "−"}${Math.abs(d)} hp`, cls: d > 0 ? "up" : "down" };
    }
    const txt = this.partEffect(kind, key, car, t, baseHp);
    return { text: txt, cls: /^(Standard|Factory)/.test(txt) ? "" : "up" };
  }
  // what a part actually does, computed from the same model the physics uses
  partEffect(kind, key, car, t, baseHp) {
    const o = PARTS[kind].opts[key];
    if (o.drag !== undefined) return o.drag === 1 && o.handling === 1 ? "Standard aero" : `+${Math.round((o.handling - 1) * 100)}% turn-in · +${Math.round((o.drag - 1) * 100)}% drag`;
    if (o.flow !== undefined || o.maxBoost !== undefined || o.eff !== undefined || o.knock !== undefined || o.power !== undefined) {
      const hp = peakHp(car, { ...t, [kind]: key });
      const d = hp - baseHp;
      return `${baseHp} → ${hp} hp (${d >= 0 ? "+" : ""}${d})`;
    }
    if (o.grip !== undefined) return o.grip === 1 ? "Standard grip" : `+${Math.round((o.grip - 1) * 100)}% grip`;
    if (o.brake !== undefined) return o.brake === 1 ? "Standard braking" : `+${Math.round((o.brake - 1) * 100)}% braking`;
    if (o.handling !== undefined) return o.handling === 1 ? "Standard response" : `+${Math.round((o.handling - 1) * 100)}% turn-in`;
    if (o.shift !== undefined) return o.shift === 1 ? "Standard shifts" : `${Math.round((1 - o.shift) * 100)}% quicker shifts`;
    if (o.mass !== undefined) return o.mass === 1 ? "Standard weight" : `−${Math.round(specOf(car).mass * (1 - o.mass))} kg`;
    // drivetrain: show what it does to the launch, from the same estimate the stats panel uses
    if (kind === "drivetrain") {
      if (!o.drive) return `Factory ${(DRIVE_LAYOUT[car.id] || "rwd").toUpperCase()}`;
      const a = summaryCache(car, { ...t, drivetrain: "stock" }).zeroTo60, b = summaryCache(car, { ...t, drivetrain: key }).zeroTo60;
      return `All four wheels driven · 0-60 ${a.toFixed(2)} → ${b.toFixed(2)} s`;
    }
    return "";
  }
  // Power and torque against revs: stock dashed and dim, the build solid, a previewed change dashed white.
  // upTo: during a dyno run, the build's curve is only drawn as far as the revs have reached so far
  drawDyno(stock, cur, next, upTo = Infinity) {
    const cv = $("dyChart"), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const series = [stock, cur, next].filter(Boolean), x0 = 1000;
    const x1 = Math.max(...series.map((s) => s.lim));
    let top = 0;
    for (const s of series) for (const p of s.c) if (p.rpm <= s.lim) top = Math.max(top, p.hp, p.nm);
    const step = niceStep(top / 4), yMax = Math.ceil((top * 1.06) / step) * step;
    const L = 34, R = 8, T = 10, B = 18;
    const X = (r) => L + ((r - x0) / (x1 - x0)) * (w - L - R), Y = (v) => T + (1 - v / yMax) * (h - T - B);
    g.font = "600 10px Barlow, sans-serif";
    g.lineWidth = 1;
    for (let v = 0; v <= yMax; v += step) {
      const y = Math.round(Y(v)) + .5;
      g.strokeStyle = "rgba(255,255,255,.06)"; g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke();
      g.fillStyle = "#6d6d69"; g.textAlign = "right"; g.fillText(String(v), L - 6, y + 3);
    }
    for (let r = 2000; r <= x1; r += 2000) {
      const x = Math.round(X(r)) + .5;
      g.strokeStyle = "rgba(255,255,255,.04)"; g.beginPath(); g.moveTo(x, T); g.lineTo(x, h - B); g.stroke();
      g.fillStyle = "#6d6d69"; g.textAlign = "center"; g.fillText(r / 1000 + "k", x, h - 5);
    }
    const pts = (s) => s.c.filter((p) => p.rpm >= x0 && p.rpm <= s.lim);
    if (upTo < Infinity) cur = { c: cur.c, lim: Math.min(cur.lim, upTo) };
    const line = (s, key, color, width, dash = []) => {
      const P = pts(s);
      if (!P.length) return;
      g.beginPath(); g.moveTo(X(P[0].rpm), Y(P[0][key]));
      for (const p of P) g.lineTo(X(p.rpm), Y(p[key]));
      g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash); g.lineJoin = "round"; g.stroke(); g.setLineDash([]);
    };
    // the build's power curve sits on a soft fill
    const C = pts(cur);
    if (C.length) {
      const grd = g.createLinearGradient(0, T, 0, h - B);
      grd.addColorStop(0, "rgba(255,255,255,.14)"); grd.addColorStop(1, "rgba(255,255,255,0)");
      g.beginPath(); g.moveTo(X(C[0].rpm), Y(0));
      for (const p of C) g.lineTo(X(p.rpm), Y(p.hp));
      g.lineTo(X(C[C.length - 1].rpm), Y(0)); g.closePath(); g.fillStyle = grd; g.fill();
    }
    line(stock, "nm", "rgba(138,138,133,.35)", 1.2, [3, 3]);
    line(stock, "hp", "rgba(168,168,162,.45)", 1.2, [3, 3]);
    line(cur, "nm", "#8a8a85", 1.8);
    line(cur, "hp", "#f4f4f0", 2.4);
    if (next) { line(next, "nm", "rgba(200,200,195,.7)", 1.6, [5, 3]); line(next, "hp", "#ffffff", 1.8, [5, 3]); }
    // during a run: a cursor at the revs the rollers are turning, and the reading at its tip
    if (upTo < Infinity) {
      const x = Math.round(X(Math.min(upTo, x1))) + .5, tip = C[C.length - 1];
      g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x, T); g.lineTo(x, h - B); g.stroke();
      if (tip) { g.fillStyle = "#ffffff"; g.beginPath(); g.arc(X(tip.rpm), Y(tip.hp), 3.5, 0, Math.PI * 2); g.fill(); g.fillStyle = "#8a8a85"; g.beginPath(); g.arc(X(tip.rpm), Y(tip.nm), 3, 0, Math.PI * 2); g.fill(); }
      return;
    }
    // mark the peak
    const pk = (next ? pts(next) : C).reduce((a, p) => (p.hp > a.hp ? p : a), { hp: -1 });
    if (pk.hp > 0) {
      const x = X(pk.rpm), y = Y(pk.hp);
      g.fillStyle = "#ffffff"; g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#f4f4f0"; g.textAlign = x > w - 70 ? "right" : "left";
      g.fillText(`${Math.round(pk.hp)} hp`, x + (x > w - 70 ? -7 : 7), Math.max(T + 8, y - 6));
    }
  }

  // per-car limits: the block decides the rev ceiling, the turbo decides the boost ceiling
  tuneRange(car, key) {
    const [lo, hi, step] = TUNE_RANGE[key], s = specOf(car), e = engineOf(car), t = this.effTune();
    if (key === "revLimit") return [Math.round(s.redline * .8), Math.round(e.maxRev || s.redline), 50];
    if (key === "boost") return [4, Math.round(maxBoostFor(e, t)), .5];
    if (key === "final") return [+(s.final * .75).toFixed(2), +(s.final * 1.45).toFixed(2), .01];
    return [lo, hi, step];
  }
  // ---------- music ----------
  // A browser cannot read what Spotify or the OS is playing - no web API exposes that. What it CAN
  // do is play files the player adds, read their real tags, and hand control to the OS media keys
  // through the Media Session API. That is exactly what this does; nothing is mocked.
  wireMedia() {
    const m = this.music;
    m.ytHost = $("ytHost"); m.spHost = $("spHost");
    // pasted Spotify / YouTube links
    const addLink = async (text) => {
      const btn = $("mediaLinkAdd");
      btn.disabled = true;
      try { const t = await m.addLink(text); $("mediaLink").value = ""; this.toast(`Added ${t.title}`); }
      catch (e) { this.toast(e.message || "Couldn't add that link", [], "warn"); }
      btn.disabled = false;
    };
    $("mediaLinkAdd").onclick = () => { const v = $("mediaLink").value.trim(); if (v) addLink(v); };
    $("mediaLink").onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") $("mediaLinkAdd").click(); };
    // with the music panel open, pasting a link anywhere adds it
    addEventListener("paste", (e) => {
      if ($("media").hidden || e.target.closest?.("input, textarea")) return;
      const text = e.clipboardData?.getData("text") || "";
      if (parseLink(text)) { e.preventDefault(); addLink(text); }
    });
    m.addEventListener("error", (e) => this.toast(e.detail, [], "warn"));
    m.addEventListener("dock", () => this.renderDock());
    $("mediaAdd").onclick = () => $("mediaFiles").click();
    $("mediaFiles").onchange = async (e) => {
      const n = await m.add([...e.target.files]);
      e.target.value = "";
      this.toast(n ? `Added ${n} track${n > 1 ? "s" : ""}` : "No playable audio in that selection");
    };
    $("mediaPlay").onclick = () => m.toggle();
    $("mediaNext").onclick = () => m.next();
    $("mediaPrev").onclick = () => m.prev();
    $("mwPlay").onclick = () => m.toggle();
    $("mwNext").onclick = () => m.next();
    $("mwPrev").onclick = () => m.prev();
    $("mediaVol").value = m.audio.volume;
    $("mediaFx").checked = P.settings.musicFx !== false;
    $("mediaFx").onchange = (e) => { P.settings.musicFx = e.target.checked; save(); };
    $("mediaVol").oninput = (e) => m.setVolume(+e.target.value);
    $("mediaBar").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); m.seek((e.clientX - r.left) / r.width); };
    for (const ev of ["track", "state", "list"]) m.addEventListener(ev, () => this.renderMedia());
    m.addEventListener("time", () => this.renderMediaTime());
    // drop audio files anywhere on the page
    addEventListener("dragover", (e) => { const ty = e.dataTransfer?.types; if (ty?.includes("Files") || ty?.includes("text/uri-list")) e.preventDefault(); });
    addEventListener("drop", async (e) => {
      const dropped = e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "";
      if (!e.dataTransfer?.files?.length && parseLink(dropped)) { e.preventDefault(); return addLink(dropped); }
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      const n = await m.add([...e.dataTransfer.files]);
      if (n) this.toast(`Added ${n} track${n > 1 ? "s" : ""}`);
    });
    $("mediaNote").textContent = m.hasSession
      ? "Your keyboard's media keys control this player. Browsers can't read Spotify or system audio, so add your own files here."
      : "Browsers can't read Spotify or system audio, so add your own files here.";
    this.renderMedia();
  }
  renderMedia() {
    const m = this.music, t = m.track;
    const art = $("mediaArt");
    art.innerHTML = t?.art ? `<img src="${t.art}" alt="">` : icon("music");
    $("mediaTitle").textContent = t ? t.title : "Nothing playing";
    $("mediaArtist").textContent = t ? (t.artist || { spotify: "On Spotify", youtube: "On YouTube" }[t.kind] || "Unknown artist") : "Add your own tracks to get started";
    $("mediaAlbum").textContent = t?.album || "";
    $("mediaPlay").innerHTML = icon(m.playing ? "pause" : "play", "fill");
    $("mediaPrev").disabled = $("mediaNext").disabled = m.tracks.length < 2;
    $("mediaPlay").disabled = !t;
    const list = $("mediaList");
    list.innerHTML = "";
    m.tracks.forEach((tr, i) => {
      const row = document.createElement("div");
      row.className = "media-row" + (i === m.index ? " on" : "");
      row.innerHTML = `<div class="mr-art">${tr.art ? `<img src="${tr.art}" alt="">` : icon("music")}</div>
        <div class="mr-text"><b>${esc(tr.title)}</b><small>${esc(tr.artist || (tr.kind === "file" ? "Unknown artist" : ""))}${tr.kind === "youtube" ? '<span class="mr-src yt">YouTube</span>' : tr.kind === "spotify" ? '<span class="mr-src sp">Spotify</span>' : ""}</small></div>
        <button class="mr-x" title="Remove">${icon("x")}</button>`;
      row.onclick = (e) => { if (!e.target.closest(".mr-x")) m.play(i); };
      row.querySelector(".mr-x").onclick = () => m.remove(i);
      list.appendChild(row);
    });
    // a link's own player already shows the song, so under it the widget is just the controls
    const w = $("musicWidget"), streaming = !!m.dockKind;
    w.hidden = !t || this.ctx.state() === "home";
    w.classList.toggle("streaming", streaming);
    if (t) {
      $("mwArt").innerHTML = t.art ? `<img src="${t.art}" alt="">` : icon("music");
      $("mwTitle").textContent = t.title;
      $("mwArtist").textContent = streaming ? `Playing on ${t.kind === "spotify" ? "Spotify" : "YouTube"}` : t.artist || "Unknown artist";
      $("mwPlay").innerHTML = icon(m.playing ? "pause" : "play", "fill");
    }
    this.renderMediaTime();
  }
  renderMediaTime() {
    const m = this.music;
    const fmt = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
    $("mediaNow").textContent = fmt(m.time);
    $("mediaDur").textContent = fmt(m.duration);
    this.renderDock();
    const pct = (m.progress * 100).toFixed(1) + "%";
    $("mediaBar").firstElementChild.style.width = pct;
    $("mwBar").style.width = pct;
    const w = $("musicWidget");
    if (m.track && this.ctx.state() !== "home" && w.hidden) w.hidden = false;
    if (this.ctx.state() === "home" && !w.hidden) w.hidden = true;
  }

  // The embedded player for a link. In game it sits on the music widget as one card (player on top,
  // the game's controls under it); in the garage it sits above the car strip.
  renderDock() {
    const k = this.music.dockKind, dock = $("streamDock");
    dock.hidden = !k;
    if (!k) return;
    dock.dataset.kind = k;
    const home = this.ctx.state() === "home", w = $("musicWidget"), joined = !home && !w.hidden;
    dock.classList.toggle("joined", joined);
    dock.style.bottom = (home ? (document.querySelector("#home .cardbar")?.offsetHeight || 150) + 24 : joined ? 16 + w.offsetHeight - 1 : 16) + "px";
  }

  // ---------- admin ----------
  // Local developer tools behind a code. They only touch this browser's save.
  wireAdmin() {
    const CODE = "xurcolol";
    const show = (on) => { $("adminLocked").hidden = on; $("adminTools").hidden = !on; };
    show(sessionStorage.getItem("hd_admin") === "1");
    const tryUnlock = () => {
      if ($("adminCode").value !== CODE) { $("adminCode").value = ""; return this.toast("Wrong code"); }
      sessionStorage.setItem("hd_admin", "1");
      $("adminCode").value = "";
      show(true);
      this.toast("Admin panel unlocked");
    };
    $("adminUnlock").onclick = tryUnlock;
    $("adminCode").onkeydown = (e) => { if (e.key === "Enter") tryUnlock(); };
    $("adminLock").onclick = () => { sessionStorage.removeItem("hd_admin"); show(false); };
    const num = (id) => Math.max(0, Math.floor(+$(id).value || 0));
    $("adminSetCoins").onclick = () => { P.coins = num("adminCoins"); save(); this.afterAdmin(`Coins set to ${fmtCoins(P.coins)}`); };
    $("adminSetHearts").onclick = () => { P.hearts = num("adminHearts"); save(); this.afterAdmin(`Revives set to ${P.hearts}`); };
    $("adminSetBest").onclick = () => { P.best = num("adminBest"); P.medals = medalCount(P.best); save(); this.afterAdmin(`Best set to ${fmtCoins(P.best)}`); };
    $("adminUnlockCars").onclick = () => { P.owned = CARS.map((c) => c.id); save(); this.afterAdmin("All cars unlocked"); };
    $("adminUnlockParts").onclick = () => {
      for (const c of CARS) {
        P.ecu[c.id] = true;
        P.parts[c.id] = Object.fromEntries(Object.entries(PARTS).map(([kind, def]) => [kind, Object.keys(def.opts)]));
      }
      save(); this.afterAdmin("All upgrades unlocked");
    };
    $("adminClearTunes").onclick = () => { P.tunes = {}; save(); this.ctx.applyTune(); this.afterAdmin("Tunes cleared"); };
    $("adminGod").onclick = (e) => { const on = this.ctx.toggleGod(); e.target.textContent = `GOD MODE: ${on ? "ON" : "OFF"}`; };
    $("signOut").onclick = () => {
      if (!confirm("Sign out? Your progress stays saved with your account.")) return;
      signOut();
      location.reload();
    };
    $("resetAll").onclick = () => {
      if (!confirm("Reset ALL your data?\n\nLevel, coins, cars, tunes, styles, best scores and settings will be erased. This cannot be undone.")) return;
      if (!confirm("Last chance - really erase everything and start over?")) return;
      for (const k of Object.keys(localStorage)) if (k.startsWith("hd_")) localStorage.removeItem(k);
      document.cookie = "hd_save=; max-age=0; path=/";
      location.reload();
    };
    $("adminWipe").onclick = () => {
      if (!confirm("Wipe the whole profile? Cars, coins, tunes and settings all go back to new.")) return;
      localStorage.removeItem("hd_profile");
      document.cookie = "hd_save=; max-age=0; path=/";
      location.reload();
    };
  }
  afterAdmin(msg) { this.toast(msg); this.renderTop(); this.renderHome(); if (!$("tune").hidden) this.renderTune(); }

  // ---------- settings ----------
  wireSettings() {
    const s = P.settings, apply = () => { save(); this.ctx.applySettings(); };
    $("timeSlider").oninput = (e) => { s.hour = +e.target.value; this.ctx.sky.hour = s.hour; this.syncTime(s.hour); save(); };
    $("timeFlow").onchange = (e) => { s.flow = e.target.checked; this.ctx.sky.flow = s.flow; save(); };
    const chips = (el, items, get, set) => {
      $(el).innerHTML = "";
      for (const name of items) {
        const b = document.createElement("button"); b.textContent = name;
        b.onclick = () => { set(name); save(); this.renderSettings(); };
        $(el).appendChild(b);
      }
      this.chipSync = this.chipSync || [];
      this.chipSync.push(() => [...$(el).children].forEach((b) => b.classList.toggle("on", get(b.textContent))));
    };
    chips("timePresets", Object.keys(TIME_PRESETS), (n) => Math.abs(TIME_PRESETS[n] - s.hour) < .05, (n) => { s.hour = TIME_PRESETS[n]; this.ctx.sky.hour = s.hour; });
    chips("skyStyles", SKY_STYLES, (n) => s.sky === n, (n) => { s.sky = n; this.ctx.sky.setStyle(n); });
    chips("weathers", Object.keys(WEATHERS), (n) => s.weather === n, (n) => { s.weather = n; this.ctx.sky.setWeather(n); });
    chips("trafficLevels", Object.keys(TRAFFIC_LEVELS), (n) => s.traffic === n, (n) => { s.traffic = n; });
    for (const [id, key] of [["volMaster", "volMaster"], ["volEngine", "volEngine"], ["volFx", "volFx"], ["volWind", "volWind"], ["optRes", "res"], ["optScenery", "scenery"], ["optView", "viewDist"]]) $(id).oninput = (e) => { s[key] = +e.target.value; apply(); };
    for (const [id, key] of [["optManual", "manual"], ["optShadows", "shadows"], ["optBloom", "bloom"], ["optHideNames", "hideNames"], ["optCinematic", "cinematic"]]) $(id).onchange = (e) => { s[key] = e.target.checked; apply(); if (this.ctx.state() === "home") this.renderHome(); };
    // a graphics-quality pick overwrites shadows/res/scenery/view/bloom/nightLights, so the sliders
    // need to redraw with whatever it just set them to
    $("optGfx").onchange = (e) => { this.ctx.setGfxTier(+e.target.value); this.renderSettings(); };
  }
  syncTime(hour) {
    const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    $("timeLabel").textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (document.activeElement !== $("timeSlider")) $("timeSlider").value = hour;
    this.chipSync?.[0]?.();
  }
  renderSettings() {
    $("acctName").textContent = currentAccount()?.name || P.name;
    const s = P.settings;
    s.hour = this.ctx.sky.hour;
    this.syncTime(s.hour);
    $("timeFlow").checked = s.flow;
    $("volMaster").value = s.volMaster; $("volEngine").value = s.volEngine; $("volFx").value = s.volFx; $("volWind").value = s.volWind; $("optRes").value = s.res;
    $("optScenery").value = s.scenery ?? 1; $("optView").value = s.viewDist ?? 1; $("optNight").value = s.nightLights ?? 1;
    $("optNight").onchange = (e) => { s.nightLights = +e.target.value; apply(); };
    $("optManual").checked = s.manual; $("optShadows").checked = s.shadows; $("optBloom").checked = s.bloom !== false; $("optHideNames").checked = !!s.hideNames;
    $("optCinematic").checked = !!s.cinematic; $("optGfx").value = s.gfx ?? -1;
    this.chipSync?.forEach((f) => f());
  }
}

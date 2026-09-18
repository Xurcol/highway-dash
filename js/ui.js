// DOM side: garage, HUD helpers, game-over popup, leaderboards, online + settings panels.
import { CARS, RARITY_COLORS, specOf, carStats } from "./cars.js?v=mu6adgwj";
import { P, save, carById, carColor, carSound, carTune, setTune, resetTune, PAINTS, MEDALS, HEART_PACKS, xpForLevel, medalCount,
  ownsPart, ownsEcu, buyPart, buyEcu, payTuneSession, payPaint, spend, earn, priceOfCar, walletHooks, carStyle, ownsStyle, styleCost, saveStyle } from "./profile.js?v=mu6adgwj";
import { FINISHES, TINTS, STANCES, FITMENT } from "./cars.js?v=mu6adgwj";
import { stylePrice, STYLE_PRICES } from "./economy.js?v=mu6adgwj";
import { SOUND_LABELS } from "./engine-dsp.js?v=mu6adgwj";
import { ENGINES, PARTS, TUNE_RANGE, engineOf, isBoosted, summary, defaultTune, maxBoostFor, peakHp, stageMap } from "./tuning.js?v=mu6adgwj";
import { partPrice, TUNING_PRICES, COSMETIC_PRICES, fmtCoins, CAR_PRICES } from "./economy.js?v=mu6adgwj";
import { TIME_PRESETS, SKY_STYLES, WEATHERS } from "./sky.js?v=mu6adgwj";
import { TRAFFIC_LEVELS } from "./traffic.js?v=mu6adgwj";
import { MusicPlayer } from "./media.js?v=mu6adgwj";

const $ = (id) => document.getElementById(id);
const MPH = 0.621371; // the game shows mph only
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0).replace(/\.0$/, "") + "K" : String(n));

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
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
    this.wireMedia();
    this.wireAdmin();
  }

  // ---------- generic ----------
  show(name) {
    if (name === "ready") this.setReady("HIGHWAY DASH", "Five lanes. Thread the needle.", "CLICK TO START");
    for (const id of ["home", "ready", "hud", "over"]) $(id).hidden = id !== name;
    $("pause").hidden = true;
    if (name !== "hud") this.chatInput.hidden = true;
  }
  setPaused(p) { $("pause").hidden = !p; }
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
      el.innerHTML = `<h2>💥 ${esc(m.by)} crashed!</h2><ol>${m.scores.map((p, i) => `<li class="${p.id === myId ? "me" : ""} ${p.id === m.byId ? "crashed" : ""}"><span>${i + 1}. ${esc(p.name)}</span><span>${p.score.toLocaleString()}</span></li>`).join("")}</ol><div class="next">Next round in ${Math.max(0, left)}s</div>`;
    };
    render();
    el.hidden = false;
    this.roundTimer = setInterval(() => { left--; render(); if (left <= 0) clearInterval(this.roundTimer); }, 1000);
  }
  hideRoundResults() { clearInterval(this.roundTimer); $("roundBanner").hidden = true; }
  anyModalOpen() { return [...document.querySelectorAll(".modal")].some((m) => !m.hidden); }
  openModal(id) {
    this.closeModals();
    $(id).hidden = false;
    if (id === "leader") { this.net.send({ t: "leaderboard" }); this.renderBoard($("leaderBoard")); }
    if (id === "online") this.renderOnline();
    if (id === "settings") this.renderSettings();
    if (id === "tune") this.renderTune();
    this.ctx.audio.ui();
  }
  toggleModal(id) { if (!$(id).hidden) this.closeModals(); else this.openModal(id); }
  closeModals() { document.querySelectorAll(".modal").forEach((m) => (m.hidden = true)); }
  toast(msg, actions = []) {
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `<span>${esc(msg)}</span>`;
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = "btn " + (a.cls || "green"); b.textContent = a.label;
      b.onclick = () => { a.run(); t.remove(); };
      t.appendChild(b);
    }
    $("toasts").appendChild(t);
    setTimeout(() => t.remove(), actions.length ? 12000 : 3200);
  }
  closeCall(combo) {
    const c = this.el.combo;
    c.textContent = `CLOSE CALL! x${combo}`;
    c.classList.remove("on"); void c.offsetWidth; c.classList.add("on");
  }
  chat(name, text) {
    const d = document.createElement("div");
    d.innerHTML = `<b>${esc(name)}:</b> ${esc(text)}`;
    const log = $("chatLog");
    log.appendChild(d);
    while (log.children.length > 8) log.firstChild.remove();
  }
  renderPeerMarkers(list) {
    const box = $("peerMarkers");
    const seen = new Set();
    for (const m of list) {
      seen.add(m.id);
      let el = box.querySelector(`[data-id="${m.id}"]`);
      if (!el) { el = document.createElement("div"); el.className = "peer-marker"; el.dataset.id = m.id; box.appendChild(el); }
      el.style.borderColor = m.color; el.style.transform = `translate(${m.x}px, ${m.y}px) translate(-50%, -50%)`;
      if (el.textContent !== m.text) el.textContent = m.text;
    }
    for (const el of [...box.children]) if (!seen.has(el.dataset.id)) el.remove();
  }
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
  }
  renderHome() {
    this.renderTop();
    const car = carById(this.view), st = carStats(car), spec = specOf(car);
    this.ctx.selectCar(this.view);
    for (const [k, v] of [["Spd", st.speed], ["Acc", st.accel], ["Han", st.handling]]) { $("st" + k).style.width = v + "%"; $("st" + k + "N").textContent = v; }
    const r = $("ciRarity"); r.textContent = car.rarity; r.style.background = RARITY_COLORS[car.rarity];
    $("ciName").textContent = car.name;
    $("ciName").style.fontSize = car.name.length > 20 ? "26px" : car.name.length > 12 ? "32px" : "";
    $("ciSpec").textContent = `${SOUND_LABELS[carSound(car.id)] || ""} · ${spec.ratios.length}-speed`;
    const col = carColor(car.id);
    $("swatches").innerHTML = [car.color, ...PAINTS.filter((c) => c !== car.color)].slice(0, 12).map((c) => `<button data-c="${c}" class="${c === col ? "on" : ""}" style="background:#${c.toString(16).padStart(6, "0")}" title="${c === car.color ? "Factory" : ""}"></button>`).join("");
    [...$("swatches").children].forEach((b) => (b.onclick = () => this.paint(+b.dataset.c)));
    $("paintPick").value = "#" + col.toString(16).padStart(6, "0");
    this.renderStyle(car);
    $("ciEngine").textContent = engineOf(car).label; // the engine belongs to the car - no swapping
    $("ciTop").textContent = `Top speed ${Math.round(st.top * MPH)} mph · ${spec.torque} Nm`;
    const a = $("ciAction");
    if (P.equipped === car.id) { a.textContent = "EQUIPPED"; a.className = "btn gray wide"; }
    else if (P.owned.includes(car.id)) { a.textContent = "EQUIP"; a.className = "btn blue wide"; }
    else { const pr = priceOfCar(car.id), can = P.coins >= pr; a.textContent = can ? `BUY — 🪙 ${fmtCoins(pr)}` : `NEED 🪙 ${fmtCoins(pr - P.coins)} MORE`; a.className = `btn ${can ? "accent" : "ghost"} wide`; a.disabled = !can; }

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
      const label = c.id === P.equipped ? "EQUIPPED" : own ? "OWNED" : `🪙 ${fmtCoins(price)}`;
      d.innerHTML = `<div class="r" style="color:${RARITY_COLORS[c.rarity]}">${c.rarity}</div><img src="${this.thumbs[c.id] || ""}" alt=""><div class="n">${esc(c.name)}</div>
        <div class="p ${c.id === P.equipped ? "eq" : own ? "own" : P.coins < price ? "poor" : ""}">${label}</div>`;
      d.onclick = () => { this.view = c.id; this.ctx.audio.ui(); this.renderHome(); };
      cards.appendChild(d);
    }
    document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("on", (b.dataset.mode === "online") === this.onlineSelected));
    $("onlineDot").classList.toggle("on", this.net.connected);
    const pb = $("partyBadge");
    pb.hidden = !this.net.room;
    if (this.net.room) pb.textContent = `🟢 Party ${this.net.room.code} · ${this.net.room.players.length} driver${this.net.room.players.length > 1 ? "s" : ""}`;
    $("playBtn").textContent = this.onlineSelected ? (this.net.room ? "PLAY ONLINE" : "FIND PARTY") : "PLAY";
    const ms = $("modeSelect");
    if (this.onlineSelected) ms.innerHTML = this.net.room ? `<span class="ms-label">PARTY MODE</span><b>${this.ctx.PARTY_MODES[this.net.room.mode || "crash"]}</b>` : "";
    else {
      const cur = this.ctx.SOLO_MODES[P.settings.soloMode] ? P.settings.soloMode : "classic";
      ms.innerHTML = `<span class="ms-label">MODE</span>` + Object.entries(this.ctx.SOLO_MODES).map(([k, v]) => `<button data-m="${k}" class="${k === cur ? "on" : ""}">${v}</button>`).join("");
      ms.querySelectorAll("button").forEach((b) => b.onclick = () => { P.settings.soloMode = b.dataset.m; save(); this.ctx.audio.ui(); this.renderHome(); });
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
      st.camber ? "-" + st.camber + "° camber" : null, st.glow != null ? "underglow" : null, st.drl != null ? "custom DRLs" : null,
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
      ["drl", "DRLs", [{ v: null, label: "Stock" }, ...sw([0xffffff, 0x9fdcff, 0x3d8bff, 0xffd84a, 0xff9a2a, 0x7cff5a, 0xb27dff, 0xff5ad1, 0xff3040])]],
      ["glow", "Underglow", [{ v: null, label: "Off" }, ...sw([0x3dd6ff, 0xff2d95, 0x7cff5a, 0xb27dff, 0xffd12a, 0xff4a55])]],
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
      return `<div class="medal ${has ? "got" : ""} ${isNew ? "new" : ""}"><i style="${has ? `background:${m.color};border-color:#fff8` : ""}">${has ? m.icon : "?"}</i><span style="${has ? `color:${m.color}` : ""}">${fmtK(m.at)}</span></div>`;
    }).join("");
    const next = MEDALS[got];
    $("medalNext").textContent = next ? `NEXT ${next.name.toUpperCase()} — ${fmtK(next.at)}` : "ALL MEDALS EARNED!";
    if (r.newMedals) this.toast(`🏅 New medal: ${MEDALS[got - 1].name}!`);
    if (r.levelUps) this.toast(`⭐ Level up! You're level ${P.level}`);
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
    b.textContent = left <= 0 ? "NO REVIVES LEFT" : P.hearts <= 0 ? "GET REVIVES →" : `REVIVE ${revives}/3 — 1 ❤️`;
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
        <img src="${this.thumbs[c.id] || ""}" alt=""><button class="btn ${eq ? "ghost" : own ? "primary" : "accent"}">${eq ? "EQUIPPED" : own ? "EQUIP" : "🪙 " + fmtCoins(priceOfCar(c.id))}</button>`;
      d.querySelector("button").onclick = () => this.buyOrEquip(c.id, () => { this.renderOverShop(); this.toast(`${c.name} equipped — restart to drive it`); });
      shop.appendChild(d);
    }
    const hs = $("heartShop");
    hs.innerHTML = "";
    for (const pack of HEART_PACKS) {
      const b = document.createElement("button");
      b.className = "btn red";
      b.innerHTML = `${pack.n} REVIVE${pack.n > 1 ? "S" : ""}<small>🪙 ${pack.price.toLocaleString()}</small>`;
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
    const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "#" + (i + 1));
    el.innerHTML = `<div class="board-head">🏆 ${tab === "top" ? "TOP 200" : "FRIENDS"}</div>
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
  }
  renderOnline() {
    const n = this.net;
    $("offlineNote").hidden = n.connected;
    if (n.relayStatus) $("relayStatus").textContent = "Relays: " + n.relayStatus().map((r) => `${r.name} ${r.up ? "✓" : "✗"}`).join(" · ");
    if (document.activeElement !== $("nameInput")) $("nameInput").value = P.name;
    $("myCode").textContent = n.me?.code || "------";
    $("requests").innerHTML = "";
    for (const r of n.incoming) {
      const d = document.createElement("div");
      d.className = "friend";
      d.innerHTML = `<div class="nm">📨 ${esc(r.name)}<small>wants to be friends</small></div><button class="btn green">ACCEPT</button><button class="btn red">✕</button>`;
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
      if (n.me && P.name !== n.me.name && n.connected) n.send({ t: "setName", name: P.name });
      if (n.me) { n.send({ t: "leaderboard" }); if (P.best > (n.me.best || 0)) n.send({ t: "score", score: P.best, level: P.level }); }
    });
    n.addEventListener("social", refresh);
    n.addEventListener("room", (e) => {
      refresh();
      if (n.room && e.detail.fresh) { this.onlineSelected = true; this.toast(`🟢 Joined party ${n.room.code}`); }
      if (!n.room && this.ctx.mode() === "online" && this.ctx.state() !== "home") { this.toast("You left the party"); this.ctx.home(); }
    });
    n.addEventListener("error", (e) => this.toast("⚠️ " + e.detail.msg));
    n.addEventListener("toast", (e) => this.toast(e.detail.msg));
    n.addEventListener("friendRequest", (e) => {
      const r = e.detail;
      this.toast(`👋 ${r.name} sent you a friend request`, [{ label: "ACCEPT", run: () => n.send({ t: "friendAccept", id: r.id }) }, { label: "✕", cls: "gray", run: () => n.send({ t: "friendDecline", id: r.id }) }]);
    });
    n.addEventListener("invite", (e) => {
      const m = e.detail;
      this.toast(`🎮 ${m.from} invited you to their party`, [{ label: "JOIN", run: () => n.send({ t: "roomJoin", code: m.room }) }, { label: "✕", cls: "gray", run: () => {} }]);
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
      { key: "boost", label: "Target boost", fmt: (v) => v.toFixed(1) + " psi", boosted: true, hint: "Air pressure the ECU aims for. More boost = more torque, more heat, more stress." },
      { key: "wastegate", label: "Wastegate duty", fmt: (v) => Math.round(v * 100) + "%", boosted: true, hint: "Higher duty holds the gate shut: spools earlier, overshoots more, holds boost up top." },
      { key: "timing", label: "Ignition timing", fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "°", hint: "Advance makes power until it knocks - then the ECU pulls timing and you LOSE power." },
      { key: "afr", label: "Target AFR", fmt: (v) => v.toFixed(1) + ":1", hint: "Richer is safer and cooler, leaner makes a little more power until it knocks." },
      { key: "revLimit", label: "Rev limit", fmt: (v) => Math.round(v) + " rpm", hint: "Raising it keeps a gear alive longer, but the curve is already falling up there." },
      { key: "final", label: "Final drive", fmt: (v) => v.toFixed(2), hint: "Shorter (higher number) = more wheel torque, lower top speed." },
      { key: "gearing", label: "Gear spread", fmt: (v) => v.toFixed(2) + "x " + (v > 1.005 ? "shorter" : v < .995 ? "taller" : "stock"), hint: "Scales every gear. Above 1 = shorter: more wheel torque and revs, less speed per 1000 rpm." },
    ];
    this.AID_CONTROLS = [
      { key: "tc", label: "Traction control", fmt: (v) => ["Off", "Low", "Medium", "High"][Math.round(v)] },
      { key: "launchRpm", label: "Launch RPM", fmt: (v) => Math.round(v * 100) + "% of limit" },
    ];
    this.EXHAUST_CONTROLS = [
      { key: "burble", label: "Decel fuel cut", fmt: (v) => Math.round(v * 100) + "%" },
      { key: "decay", label: "Burble length", fmt: (v) => v.toFixed(1) + "s" },
      { key: "mix", label: "Pop style", fmt: (v) => (v < .35 ? "burble" : v > .65 ? "crackle" : "mixed") },
      { key: "engineBrake", label: "Engine braking", fmt: (v) => Math.round(v * 100) + "%" },
    ];
    this.tuneTab = "map";
    this.draft = null;
    this.holdToRev($("tuneRev"));
    $("tBrap").onchange = (e) => this.editTune({ brap: e.target.checked });
    $("tuneReset").onclick = () => {
      if (!confirm("Reset this car's tune to stock? Parts you bought stay in the garage.")) return;
      this.tunePrev = summary(carById(this.view), carTune(this.view));
      resetTune(this.view); this.draft = null; this.afterTune();
    };
    document.querySelectorAll("#tune .tab").forEach((b) => b.onclick = () => { this.tuneTab = b.dataset.tab; this.renderTune(); });
    $("tRelease").innerHTML = "";
    for (const [val, label] of [["flutter", "Turbo flutter"], ["bov", "Blow-off valve"], ["off", "Off"]]) {
      const b = document.createElement("button"); b.textContent = label; b.dataset.v = val;
      b.onclick = () => this.editTune({ release: val });
      $("tRelease").appendChild(b);
    }
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
  buyEcuUI() {
    const r = buyEcu(this.view);
    if (!r.ok) return this.notEnough(r.short);
    this.ctx.audio.coin();
    this.toast(`ECU unlocked — ${fmtCoins(TUNING_PRICES.ecu)} coins`);
    this.afterTune();
  }

  renderTune() {
    const car = carById(this.view), t = this.effTune(), e = engineOf(car), boosted = isBoosted(e);
    const fitted = carTune(this.view), hasEcu = ownsEcu(this.view);
    const sum = summary(car, t), stock = summary(car, defaultTune(car));
    $("tuneCar").textContent = car.name;
    $("tuneCoins").textContent = fmtCoins(P.coins);
    $("tuneEngine").innerHTML = `<b>${esc(e.label)}</b><small>${e.disp.toFixed(1)}L · ${e.cyl} cyl · ${boosted ? (e.induction === "super" ? "supercharged" : e.turbos > 1 ? "twin-turbo" : "turbo") : "naturally aspirated"} · audio locked to this engine</small>`;
    document.querySelectorAll("#tune .tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === this.tuneTab));
    $("tabMap").hidden = this.tuneTab !== "map";
    $("tabParts").hidden = this.tuneTab !== "parts";

    // headline numbers, with the previous value beside anything that just changed
    const fresh = performance.now() - (this.tuneStamp || 0) < 6000 ? this.tunePrev : null;
    const cell = (label, val, prev, fmt) => {
      const changed = fresh && Math.abs(prev - val) > Math.max(.01, Math.abs(val) * .002);
      return `<div class="tnum ${changed ? "chg" : ""}"><span>${label}</span><b>${changed ? `<i>${fmt(prev)}</i> → ` : ""}${fmt(val)}</b></div>`;
    };
    const f0 = (v) => Math.round(v).toLocaleString(), f1 = (v) => v.toFixed(1);
    $("tuneNums").innerHTML =
      cell("Power", sum.hp, fresh?.hp, (v) => `${f0(v)} hp`) +
      cell("Torque", sum.nm, fresh?.nm, (v) => `${f0(v)} Nm`) +
      (boosted ? cell("Peak boost", sum.peakBoost, fresh?.peakBoost, (v) => `${f1(v)} psi`) : "") +
      cell("Top speed", sum.topKmh, fresh?.topKmh, (v) => `${f0(v * MPH)} mph`) +
      cell("0-100", sum.zeroTo100, fresh?.zeroTo100, (v) => `${v.toFixed(2)} s`) +
      `<div class="tnum stress ${sum.stress.toLowerCase()}"><span>Engine stress</span><b>${sum.stress}</b></div>` +
      `<div class="tnum"><span>vs stock</span><b>${sum.hp >= stock.hp ? "+" : ""}${f0(sum.hp - stock.hp)} hp</b></div>`;

    const warn = $("tuneWarn"), msgs = [];
    if (sum.pulled > 0.5) msgs.push(`Knock: the ECU is pulling ${sum.pulled}° of timing. Richer fuel, less boost or a better intercooler will give the power back.`);
    if (sum.egt > 950) msgs.push(`EGT ${sum.egt}°C is very high — richen the AFR.`);
    if (sum.stress === "Extreme") msgs.push("This tune is way past what the block was built for.");
    warn.hidden = !msgs.length;
    warn.innerHTML = msgs.map((m) => `<div>${m}</div>`).join("");

    // ---- engine map ----
    const gate = $("ecuGate");
    gate.hidden = hasEcu;
    if (!hasEcu) gate.innerHTML = `<div class="gate-body"><b>ECU access locked</b><p class="muted small">Boost, timing, fuel, rev limit and gearing need a flashed ECU on this car.</p>
      <button class="btn ${P.coins >= TUNING_PRICES.ecu ? "accent" : "ghost"}" id="ecuBuy" ${P.coins >= TUNING_PRICES.ecu ? "" : "disabled"}>${P.coins >= TUNING_PRICES.ecu ? `UNLOCK — ${fmtCoins(TUNING_PRICES.ecu)}` : `NEED ${fmtCoins(TUNING_PRICES.ecu - P.coins)} MORE`}</button></div>`;
    if (!hasEcu) $("ecuBuy").onclick = () => this.buyEcuUI();

    const rows = (host, list, tune, disabled) => {
      // while a slider is being dragged, rebuilding the rows would drop the drag - just refresh the readouts
      const active = document.activeElement;
      if (active?.type === "range" && $(host).contains(active) && $(host).children.length) {
        let i = 0;
        for (const c of list) {
          if (c.boosted && !boosted) continue;
          const row = $(host).children[i++];
          if (row) row.querySelector("b").textContent = c.fmt(+tune[c.key]);
        }
        return;
      }
      $(host).innerHTML = "";
      for (const c of list) {
        if (c.boosted && !boosted) continue;
        const [lo, hi, step] = this.tuneRange(car, c.key);
        const row = document.createElement("label");
        row.className = "slider tune-slider" + (disabled ? " off" : "");
        row.innerHTML = `<span title="${esc(c.hint || "")}">${c.label}</span><input type="range" min="${lo}" max="${hi}" step="${step}" value="${tune[c.key]}" ${disabled ? "disabled" : ""}><b>${c.fmt(+tune[c.key])}</b>`;
        row.querySelector("input").oninput = (ev) => this.editTune({ [c.key]: +ev.target.value });
        $(host).appendChild(row);
      }
    };
    rows("tuneSliders", this.ENGINE_CONTROLS, t, !hasEcu);
    rows("tuneExhaust", this.EXHAUST_CONTROLS, t, false);
    // driver aids apply straight away and cost nothing
    rows("tuneAids", this.AID_CONTROLS, t, false);
    $("tuneAids").querySelectorAll("input").forEach((inp, i) => inp.oninput = (ev) => { setTune(this.view, { [this.AID_CONTROLS[i].key]: +ev.target.value }); this.afterTune(); });
    // one-click stage maps, computed from this car's parts and fuel (still a paid dyno session to apply)
    $("tunePresets").innerHTML = hasEcu ? `<span>AUTO-MAP</span>${[1, 2, 3].map((s) => `<button data-s="${s}">STAGE ${s}</button>`).join("")}<small>Safe maps for your parts &amp; fuel</small>` : "";
    $("tunePresets").querySelectorAll("button").forEach((b) => b.onclick = () => { this.editTune(stageMap(car, t, +b.dataset.s)); this.toast(`Stage ${b.dataset.s} map loaded — press APPLY to flash it`); });
    $("tBrap").checked = t.brap;
    [...$("tRelease").children].forEach((b) => b.classList.toggle("on", b.dataset.v === t.release));

    // ---- pending map changes ----
    const bar = $("tuneApplyBar");
    const dirty = this.draft && Object.keys(this.draft).some((k) => fitted[k] !== this.draft[k]);
    bar.hidden = !dirty;
    if (dirty) {
      const canPay = P.coins >= TUNING_PRICES.session;
      bar.innerHTML = `<div><b>Unsaved map</b><small>Dyno session — ${fmtCoins(TUNING_PRICES.session)} coins</small></div>
        <button class="btn ghost" id="tuneRevert">REVERT</button>
        <button class="btn ${canPay ? "primary" : "ghost"}" id="tuneApply" ${canPay ? "" : "disabled"}>${canPay ? `APPLY — ${fmtCoins(TUNING_PRICES.session)}` : "NOT ENOUGH COINS"}</button>`;
      $("tuneRevert").onclick = () => { this.draft = null; this.renderTune(); };
      $("tuneApply").onclick = () => this.applyDraft();
    }

    this.renderShop(car, t, boosted, e);
    this.renderFitted(t);
    this.drawCharts(sum, stock, t, boosted);
  }

  // ---- upgrade shop: price, what it does, what it costs, and whether you can afford it ----
  renderShop(car, t, boosted, e) {
    const host = $("tabParts");
    host.innerHTML = "";
    const baseHp = peakHp(car, t);
    for (const [kind, def] of Object.entries(PARTS)) {
      const locked = def.boostedOnly && (!boosted || e.induction === "super");
      const group = document.createElement("div");
      group.className = "shop-group" + (locked ? " locked" : "");
      group.innerHTML = `<div class="shop-head"><b>${def.label}</b>${locked ? `<span class="muted small">not available on this engine</span>` : ""}</div>`;
      for (const [key, opt] of Object.entries(def.opts)) {
        const price = partPrice(kind, key);
        const owned = ownsPart(car.id, kind, key), on = t[kind] === key;
        const afford = P.coins >= price;
        const effect = this.partEffect(kind, key, car, t, baseHp);
        const row = document.createElement("div");
        row.className = "shop-row" + (on ? " on" : "") + (locked ? " off" : "");
        row.innerHTML = `<div class="sr-main"><b>${esc(opt.label)}</b><span class="sr-effect">${effect}</span></div>
          <div class="sr-buy">${price ? `<span class="price">🪙 ${fmtCoins(price)}</span>` : `<span class="price free">Included</span>`}
          <button class="btn ${on ? "ghost" : owned ? "primary" : afford ? "accent" : "ghost"}" ${on || locked || (!owned && !afford) ? "disabled" : ""}>${on ? "FITTED" : owned ? "FIT" : afford ? "BUY" : "NEED " + fmtCoins(price - P.coins)}</button></div>`;
        if (!on && !locked && (owned || afford)) row.querySelector("button").onclick = () => this.buyPartUI(kind, key);
        group.appendChild(row);
      }
      host.appendChild(group);
    }
  }
  // what a part actually does, computed from the same model the physics uses
  partEffect(kind, key, car, t, baseHp) {
    const o = PARTS[kind].opts[key];
    if (o.flow !== undefined || o.maxBoost !== undefined || o.eff !== undefined || o.knock !== undefined) {
      const hp = peakHp(car, { ...t, [kind]: key });
      const d = hp - baseHp;
      return `${baseHp} → ${hp} hp (${d >= 0 ? "+" : ""}${d})`;
    }
    if (o.grip !== undefined) return o.grip === 1 ? "Standard grip" : `+${Math.round((o.grip - 1) * 100)}% grip`;
    if (o.brake !== undefined) return o.brake === 1 ? "Standard braking" : `+${Math.round((o.brake - 1) * 100)}% braking`;
    if (o.handling !== undefined) return o.handling === 1 ? "Standard response" : `+${Math.round((o.handling - 1) * 100)}% turn-in`;
    if (o.shift !== undefined) return o.shift === 1 ? "Standard shifts" : `${Math.round((1 - o.shift) * 100)}% quicker shifts`;
    if (o.mass !== undefined) return o.mass === 1 ? "Standard weight" : `−${Math.round(specOf(car).mass * (1 - o.mass))} kg`;
    return "";
  }
  renderFitted(t) {
    $("tuneFitted").innerHTML = Object.entries(PARTS)
      .filter(([kind]) => t[kind] && t[kind] !== "stock")
      .map(([kind, def]) => `<div class="fit-row"><span>${def.label}</span><b>${esc(def.opts[t[kind]].label)}</b></div>`).join("")
      || `<div class="muted small">Everything is standard. Open the upgrade shop to fit parts.</div>`;
  }

  // per-car limits: the block decides the rev ceiling, the turbo decides the boost ceiling
  tuneRange(car, key) {
    const [lo, hi, step] = TUNE_RANGE[key], s = specOf(car), e = engineOf(car), t = this.effTune();
    if (key === "revLimit") return [Math.round(s.redline * .8), Math.round(e.maxRev || s.redline), 50];
    if (key === "boost") return [4, Math.round(maxBoostFor(e, t)), .5];
    if (key === "final") return [+(s.final * .75).toFixed(2), +(s.final * 1.3).toFixed(2), .01];
    return [lo, hi, step];
  }
  // ---------- charts ----------
  chart(id, series, opts = {}) {
    const cv = $(id), g = cv.getContext("2d"), W = cv.width, H = cv.height;
    const padL = 42, padR = 46, padT = 14, padB = 22;
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#0d121c"; g.fillRect(0, 0, W, H);
    const xs = series[0].pts.map((p) => p[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const px = (x) => padL + ((x - x0) / Math.max(1, x1 - x0)) * (W - padL - padR);
    g.strokeStyle = "#1e2636"; g.lineWidth = 1; g.font = "600 11px Barlow, sans-serif"; g.fillStyle = "#6b7689";
    for (let r = Math.ceil(x0 / 1000) * 1000; r <= x1; r += 1000) {
      g.beginPath(); g.moveTo(px(r), padT); g.lineTo(px(r), H - padB); g.stroke();
      g.textAlign = "center"; g.fillText(r / 1000 + "k", px(r), H - 7);
    }
    if (opts.mark) {
      g.strokeStyle = "#e04b5a"; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(px(opts.mark), padT); g.lineTo(px(opts.mark), H - padB); g.stroke();
      g.setLineDash([]);
    }
    for (const s of series) {
      const vals = s.pts.map((p) => p[1]);
      const lo = s.min !== undefined ? s.min : Math.min(0, ...vals), hi = s.max !== undefined ? s.max : Math.max(...vals) * 1.1 || 1;
      const py = (v) => H - padB - ((v - lo) / Math.max(1e-6, hi - lo)) * (H - padT - padB);
      g.beginPath();
      s.pts.forEach((p, i) => (i ? g.lineTo(px(p[0]), py(p[1])) : g.moveTo(px(p[0]), py(p[1]))));
      g.strokeStyle = s.color; g.lineWidth = s.dash ? 1.5 : 2.5;
      g.setLineDash(s.dash || []);
      g.stroke(); g.setLineDash([]);
      if (s.label) {
        g.fillStyle = s.color; g.textAlign = s.right ? "left" : "right";
        g.fillText(s.label, s.right ? W - padR + 4 : padL - 5, py(s.pts[s.pts.length - 1][1]) + 4);
      }
    }
  }
  drawCharts(sum, stock, t, boosted) {
    const c = sum.curve, sc = stock.curve, mark = t.revLimit;
    const pick = (arr, f) => arr.map((p) => [p.rpm, f(p)]);
    const hpMax = Math.max(...c.map((p) => p.hp), ...sc.map((p) => p.hp)) * 1.12;
    const nmMax = Math.max(...c.map((p) => p.nm), ...sc.map((p) => p.nm)) * 1.12;
    this.chart("chartDyno", [
      { pts: pick(sc, (p) => p.hp), color: "#3a5675", dash: [5, 4], max: hpMax, min: 0 },
      { pts: pick(sc, (p) => p.nm), color: "#6b4a2e", dash: [5, 4], max: nmMax, min: 0 },
      { pts: pick(c, (p) => p.hp), color: "#3fb8ff", max: hpMax, min: 0, label: "hp" },
      { pts: pick(c, (p) => p.nm), color: "#b89bff", max: nmMax, min: 0, label: "Nm", right: true },
    ], { mark });
    const bMax = Math.max(2, ...c.map((p) => Math.max(p.boost, p.target))) * 1.2;
    this.chart("chartBoost", boosted ? [
      { pts: pick(c, (p) => p.target), color: "#7d879b", dash: [4, 4], max: bMax, min: 0, label: "target" },
      { pts: pick(c, (p) => p.boost), color: "#3dff6a", max: bMax, min: 0, label: "psi" },
    ] : [{ pts: pick(c, () => 0), color: "#3a4256", max: 1, min: 0, label: "naturally aspirated" }], { mark });
    this.chart("chartFuel", [
      { pts: pick(c, (p) => p.afr), color: "#3ee0ff", min: 10, max: 15, label: "AFR" },
      { pts: pick(c, (p) => p.timing), color: "#b27dff", min: -8, max: 12, label: "timing", right: true },
    ], { mark });
    this.chart("chartTemp", [
      { pts: pick(c, (p) => p.egt), color: "#ff4a55", min: 200, max: 1100, label: "EGT" },
      { pts: pick(c, (p) => p.oil), color: "#e8f04a", min: 20, max: 1100 },
      { pts: pick(c, (p) => p.coolant), color: "#4dffc3", min: 20, max: 1100 },
      { pts: pick(c, (p) => p.iat), color: "#3dd6ff", min: 20, max: 1100, label: "IAT", right: true },
    ], { mark });
  }

  // ---------- music ----------
  // A browser cannot read what Spotify or the OS is playing - no web API exposes that. What it CAN
  // do is play files the player adds, read their real tags, and hand control to the OS media keys
  // through the Media Session API. That is exactly what this does; nothing is mocked.
  wireMedia() {
    const m = this.music;
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
    $("mediaVol").oninput = (e) => m.setVolume(+e.target.value);
    $("mediaBar").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); m.seek((e.clientX - r.left) / r.width); };
    for (const ev of ["track", "state", "list"]) m.addEventListener(ev, () => this.renderMedia());
    m.addEventListener("time", () => this.renderMediaTime());
    // drop audio files anywhere on the page
    addEventListener("dragover", (e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
    addEventListener("drop", async (e) => {
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
    art.innerHTML = t?.art ? `<img src="${t.art}" alt="">` : `<span>♪</span>`;
    $("mediaTitle").textContent = t ? t.title : "Nothing playing";
    $("mediaArtist").textContent = t ? (t.artist || "Unknown artist") : "Add your own tracks to get started";
    $("mediaAlbum").textContent = t?.album || "";
    $("mediaPlay").textContent = m.playing ? "❚❚" : "▶";
    $("mediaPrev").disabled = $("mediaNext").disabled = m.tracks.length < 2;
    $("mediaPlay").disabled = !t;
    const list = $("mediaList");
    list.innerHTML = "";
    m.tracks.forEach((tr, i) => {
      const row = document.createElement("div");
      row.className = "media-row" + (i === m.index ? " on" : "");
      row.innerHTML = `<div class="mr-art">${tr.art ? `<img src="${tr.art}" alt="">` : "♪"}</div>
        <div class="mr-text"><b>${esc(tr.title)}</b><small>${esc(tr.artist || "Unknown artist")}</small></div>
        <button class="mr-x" title="Remove">✕</button>`;
      row.onclick = (e) => { if (!e.target.closest(".mr-x")) m.play(i); };
      row.querySelector(".mr-x").onclick = () => m.remove(i);
      list.appendChild(row);
    });
    const w = $("musicWidget");
    w.hidden = !t || this.ctx.state() === "home";
    if (t) {
      $("mwArt").innerHTML = t.art ? `<img src="${t.art}" alt="">` : "♪";
      $("mwTitle").textContent = t.title;
      $("mwArtist").textContent = t.artist || "Unknown artist";
      $("mwPlay").textContent = m.playing ? "❚❚" : "▶";
    }
    this.renderMediaTime();
  }
  renderMediaTime() {
    const m = this.music, a = m.audio;
    const fmt = (s) => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");
    $("mediaNow").textContent = fmt(a.currentTime);
    $("mediaDur").textContent = fmt(a.duration);
    const pct = (m.progress * 100).toFixed(1) + "%";
    $("mediaBar").firstElementChild.style.width = pct;
    $("mwBar").style.width = pct;
    const w = $("musicWidget");
    if (m.track && this.ctx.state() !== "home" && w.hidden) w.hidden = false;
    if (this.ctx.state() === "home" && !w.hidden) w.hidden = true;
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
    for (const [id, key] of [["volMaster", "volMaster"], ["volEngine", "volEngine"], ["volFx", "volFx"], ["volWind", "volWind"], ["optRes", "res"]]) $(id).oninput = (e) => { s[key] = +e.target.value; apply(); };
    for (const [id, key] of [["optManual", "manual"], ["optShadows", "shadows"], ["optHideNames", "hideNames"]]) $(id).onchange = (e) => { s[key] = e.target.checked; apply(); if (this.ctx.state() === "home") this.renderHome(); };
  }
  syncTime(hour) {
    const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
    $("timeLabel").textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (document.activeElement !== $("timeSlider")) $("timeSlider").value = hour;
    this.chipSync?.[0]?.();
  }
  renderSettings() {
    const s = P.settings;
    s.hour = this.ctx.sky.hour;
    this.syncTime(s.hour);
    $("timeFlow").checked = s.flow;
    $("volMaster").value = s.volMaster; $("volEngine").value = s.volEngine; $("volFx").value = s.volFx; $("volWind").value = s.volWind; $("optRes").value = s.res;
    $("optManual").checked = s.manual; $("optShadows").checked = s.shadows; $("optHideNames").checked = !!s.hideNames;
    this.chipSync?.forEach((f) => f());
  }
}

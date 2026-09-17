// DOM side: garage, HUD helpers, game-over popup, leaderboards, online + settings panels.
import { CARS, RARITY_COLORS, specOf, carStats } from "./cars.js";
import { P, save, carById, carColor, carSound, carTune, TUNE_DEFAULT, PAINTS, MEDALS, HEART_PACKS, xpForLevel, medalCount } from "./profile.js";
import { SOUND_LABELS } from "./engine-dsp.js";
import { TIME_PRESETS, SKY_STYLES, WEATHERS } from "./sky.js";
import { TRAFFIC_LEVELS } from "./traffic.js";

const $ = (id) => document.getElementById(id);
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
      driveMode: $("driveMode"), sigL: $("sigL"), sigR: $("sigR"), speedUp: $("speedUp"), ghost: $("ghostNote"), combo: $("combo"),
    };
    this.chatInput = $("chatInput");
    this.wireCommon();
    this.wireHome();
    this.wireOver();
    this.wireOnline();
    this.wireSettings();
    this.wireTune();
    this.wireNet();
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
  renderPartyHud(list) {
    const now = performance.now();
    if (now - (this.partyHudT || 0) < 250) return;
    this.partyHudT = now;
    $("partyList").innerHTML = list.map((p) => {
      const dz = Math.round(p.dz);
      return `<div class="${p.crashed ? "crashed" : ""}">${esc(p.name)} · ${dz >= 0 ? "+" : ""}${dz}m · ${p.score.toLocaleString()}</div>`;
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
    $("playBtn").onclick = () => {
      if (this.onlineSelected && !this.net.room) return this.openModal("online");
      this.ctx.play(this.onlineSelected && this.net.room ? "online" : "solo");
    };
    $("ciAction").onclick = () => this.buyOrEquip(this.view, () => this.renderHome());
    $("paintPick").oninput = (e) => this.paint(parseInt(e.target.value.slice(1), 16));
    const sp = $("soundPick");
    sp.innerHTML = Object.entries(SOUND_LABELS).map(([k, label]) => `<option value="${k}">${label}</option>`).join("");
    sp.onchange = () => { P.sounds[this.view] = sp.value; save(); this.ctx.revPreview(sp.value, this.view); if (this.view === P.equipped) this.ctx.applyTune(); };
    this.holdToRev($("revBtn"));
    $("tuneBtn").onclick = () => this.openModal("tune");
  }
  holdToRev(btn) {
    const start = (e) => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); this.ctx.revHold(carSound(this.view), this.view, true); };
    const stop = () => this.ctx.revHold(carSound(this.view), this.view, false);
    btn.addEventListener("pointerdown", start);
    for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) btn.addEventListener(ev, stop);
    btn.title = "Hold to rev";
  }
  paint(hex) {
    this.ctx.paintCar(this.view, hex);
    [...$("swatches").children].forEach((b) => b.classList.toggle("on", +b.dataset.c === hex));
    $("paintPick").value = "#" + hex.toString(16).padStart(6, "0");
  }
  buyOrEquip(id, after) {
    const car = carById(id);
    if (P.equipped === id) return;
    if (P.owned.includes(id)) { P.equipped = id; this.ctx.audio.ui(); }
    else if (P.coins >= car.price) { P.coins -= car.price; P.owned.push(id); P.equipped = id; this.ctx.audio.coin(); this.toast(`🎉 ${car.name} unlocked!`); }
    else { this.ctx.audio.deny?.(); return this.toast(`Need ${(car.price - P.coins).toLocaleString()} more coins`); }
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
    $("soundPick").value = carSound(car.id);
    $("ciTop").textContent = `Top speed ${Math.round(P.settings.mph ? st.top * .6214 : st.top)} ${P.settings.mph ? "mph" : "km/h"} · ${spec.torque} Nm`;
    const a = $("ciAction");
    if (P.equipped === car.id) { a.textContent = "EQUIPPED"; a.className = "btn gray wide"; }
    else if (P.owned.includes(car.id)) { a.textContent = "EQUIP"; a.className = "btn blue wide"; }
    else { a.textContent = `BUY 🪙 ${car.price.toLocaleString()}`; a.className = "btn green wide"; a.disabled = false; }

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
      const label = c.id === P.equipped ? "EQUIPPED" : own ? "OWNED" : `🪙 ${c.price.toLocaleString()}`;
      d.innerHTML = `<div class="r" style="color:${RARITY_COLORS[c.rarity]}">${c.rarity}</div><img src="${this.thumbs[c.id] || ""}" alt=""><div class="n">${esc(c.name)}</div>
        <div class="p ${c.id === P.equipped ? "eq" : own ? "own" : P.coins < c.price ? "poor" : ""}">${label}</div>`;
      d.onclick = () => { this.view = c.id; this.ctx.audio.ui(); this.renderHome(); };
      cards.appendChild(d);
    }
    document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("on", (b.dataset.mode === "online") === this.onlineSelected));
    $("onlineDot").classList.toggle("on", this.net.connected);
    const pb = $("partyBadge");
    pb.hidden = !this.net.room;
    if (this.net.room) pb.textContent = `🟢 Party ${this.net.room.code} · ${this.net.room.players.length} driver${this.net.room.players.length > 1 ? "s" : ""}`;
    $("playBtn").textContent = this.onlineSelected ? (this.net.room ? "PLAY ONLINE" : "FIND PARTY") : "PLAY";
  }

  // ---------- game over ----------
  wireOver() {
    $("reviveBtn").onclick = () => { if (!this.ctx.revive()) this.toast(P.hearts <= 0 ? "No revives left — buy some below" : "Max 3 revives per run"); };
    $("restartBtn").onclick = () => this.ctx.restart();
    $("homeBtn").onclick = () => this.ctx.home();
  }
  showOver(r) {
    this.show("over");
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
      d.innerHTML = `<div class="chipsrow"><span>⚡${st.speed}</span><span>🚀${st.accel}</span><span>🎯${st.handling}</span></div>
        <img src="${this.thumbs[c.id] || ""}" alt=""><button class="btn ${eq ? "gray" : own ? "blue" : "green"}">${eq ? "EQUIPPED" : own ? "EQUIP" : "🪙 " + c.price.toLocaleString()}</button>`;
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
        P.coins -= pack.price; P.hearts += pack.n; save();
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
      $("partyMembers").innerHTML = n.room.players.map((p) => `<div class="friend"><span class="dot on"></span><div class="nm">${esc(p.name)}${p.id === n.me?.id ? " (you)" : ""}<small>${esc(carById(p.car).name || "")}</small></div></div>`).join("");
    }
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

  // ---------- tuning ----------
  wireTune() {
    const sliders = { tBurble: ["burble", (v) => Math.round(v * 100) + "%"], tDecay: ["decay", (v) => v.toFixed(1) + "s"], tMix: ["mix", (v) => (v < .35 ? "burble" : v > .65 ? "crackle" : "mixed")],
      tRasp: ["rasp", (v) => Math.round(v * 100) + "%"], tExhaust: ["exhaust", (v) => Math.round(v * 100) + "%"], tTurbo: ["turbo", (v) => Math.round(v * 100) + "%"], tEngineBrake: ["engineBrake", (v) => Math.round(v * 100) + "%"] };
    this.tuneSliders = sliders;
    const setTune = (patch) => {
      P.tunes[this.view] = { ...carTune(this.view), ...patch }; save();
      if (this.view === P.equipped) this.ctx.applyTune();
      this.renderTune();
    };
    for (const [id, [key]] of Object.entries(sliders)) $(id).oninput = (e) => setTune({ [key]: +e.target.value });
    $("tBrap").onchange = (e) => setTune({ brap: e.target.checked });
    this.holdToRev($("tuneRev"));
    $("tuneReset").onclick = () => { delete P.tunes[this.view]; save(); this.ctx.applyTune(); this.renderTune(); };
    $("tRelease").innerHTML = ""; $("tuneMode").innerHTML = "";
    for (const [val, label] of [["flutter", "Turbo flutter"], ["bov", "Blow-off valve"], ["off", "Off"]]) {
      const b = document.createElement("button"); b.textContent = label; b.dataset.v = val;
      b.onclick = () => setTune({ release: val });
      $("tRelease").appendChild(b);
    }
    for (const [val, label] of [["sport", "🔥 Sport"], ["comfort", "🍃 Comfort"]]) {
      const b = document.createElement("button"); b.textContent = label; b.dataset.v = val;
      b.onclick = () => { P.settings.driveMode = val; save(); this.ctx.applyTune(); this.renderTune(); };
      $("tuneMode").appendChild(b);
    }
  }
  renderTune() {
    const t = carTune(this.view);
    $("tuneCar").textContent = carById(this.view).name;
    for (const [id, [key, fmt]] of Object.entries(this.tuneSliders)) {
      if (document.activeElement !== $(id)) $(id).value = t[key];
      $(id + "V").textContent = fmt(+t[key]);
    }
    $("tBrap").checked = t.brap;
    [...$("tRelease").children].forEach((b) => b.classList.toggle("on", b.dataset.v === t.release));
    [...$("tuneMode").children].forEach((b) => b.classList.toggle("on", b.dataset.v === P.settings.driveMode));
  }

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
    for (const [id, key] of [["optManual", "manual"], ["optMph", "mph"], ["optShadows", "shadows"]]) $(id).onchange = (e) => { s[key] = e.target.checked; apply(); if (this.ctx.state() === "home") this.renderHome(); };
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
    $("optManual").checked = s.manual; $("optMph").checked = s.mph; $("optShadows").checked = s.shadows;
    this.chipSync?.forEach((f) => f());
  }
}

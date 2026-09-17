// DOM side: garage, HUD helpers, game-over popup, leaderboards, online + settings panels.
import { CARS, RARITY_COLORS, specOf, carStats } from "./cars.js";
import { P, save, carById, carColor, carSound, carTune, setTune, resetTune, PAINTS, MEDALS, HEART_PACKS, xpForLevel, medalCount } from "./profile.js";
import { SOUND_LABELS } from "./engine-dsp.js";
import { ENGINES, PARTS, TUNE_RANGE, engineOf, isBoosted, summary, defaultTune, maxBoostFor } from "./tuning.js";
import { TIME_PRESETS, SKY_STYLES, WEATHERS } from "./sky.js";
import { TRAFFIC_LEVELS } from "./traffic.js";

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
      driveMode: $("driveMode"), sigL: $("sigL"), sigR: $("sigR"), speedUp: $("speedUp"), ghost: $("ghostNote"), combo: $("combo"), catchUp: $("catchUp"),
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
    $("playBtn").onclick = () => {
      if (this.onlineSelected && !this.net.room) return this.openModal("online");
      this.ctx.play(this.onlineSelected && this.net.room ? "online" : "solo");
    };
    $("ciAction").onclick = () => this.buyOrEquip(this.view, () => this.renderHome());
    $("paintPick").oninput = (e) => this.paint(parseInt(e.target.value.slice(1), 16));
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
    $("ciEngine").textContent = engineOf(car).label; // the engine belongs to the car - no swapping
    $("ciTop").textContent = `Top speed ${Math.round(st.top * MPH)} mph · ${spec.torque} Nm`;
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

  // ---------- tuning ----------
  // Every control here feeds the simulation in tuning.js, and every number shown is computed from
  // it. Nothing is randomised: the same tune always gives the same curve and the same performance.
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
    this.EXHAUST_CONTROLS = [
      { key: "burble", label: "Decel fuel cut", fmt: (v) => Math.round(v * 100) + "%" },
      { key: "decay", label: "Burble length", fmt: (v) => v.toFixed(1) + "s" },
      { key: "mix", label: "Pop style", fmt: (v) => (v < .35 ? "burble" : v > .65 ? "crackle" : "mixed") },
      { key: "engineBrake", label: "Engine braking", fmt: (v) => Math.round(v * 100) + "%" },
    ];
    this.holdToRev($("tuneRev"));
    $("tBrap").onchange = (e) => this.setTune({ brap: e.target.checked });
    $("tuneReset").onclick = () => { this.tunePrev = summary(carById(this.view), carTune(this.view)); resetTune(this.view); this.afterTune(); };
    $("tRelease").innerHTML = ""; $("tuneMode").innerHTML = "";
    for (const [val, label] of [["flutter", "Turbo flutter"], ["bov", "Blow-off valve"], ["off", "Off"]]) {
      const b = document.createElement("button"); b.textContent = label; b.dataset.v = val;
      b.onclick = () => this.setTune({ release: val });
      $("tRelease").appendChild(b);
    }
    for (const [val, label] of [["sport", "🔥 Sport"], ["comfort", "🍃 Comfort"]]) {
      const b = document.createElement("button"); b.textContent = label; b.dataset.v = val;
      b.onclick = () => { P.settings.driveMode = val; save(); this.ctx.applyTune(); this.renderTune(); };
      $("tuneMode").appendChild(b);
    }
  }
  setTune(patch) {
    this.tunePrev = summary(carById(this.view), carTune(this.view)); // for the before -> after readout
    setTune(this.view, patch);
    this.afterTune();
  }
  afterTune() {
    if (this.view === P.equipped) this.ctx.applyTune();
    this.tuneStamp = performance.now();
    this.renderTune();
  }
  renderTune() {
    const car = carById(this.view), t = carTune(this.view), e = engineOf(car), boosted = isBoosted(e);
    const sum = summary(car, t), stock = summary(car, defaultTune(car));
    $("tuneCar").textContent = car.name;
    $("tuneEngine").innerHTML = `<b>${esc(e.label)}</b><small>${e.disp.toFixed(1)}L · ${e.cyl} cyl · ${boosted ? (e.induction === "super" ? "supercharged" : e.turbos > 1 ? "twin-turbo" : "turbo") : "naturally aspirated"} · audio locked to this engine</small>`;

    // headline numbers, with the previous tune's value beside anything that just changed
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

    const warn = $("tuneWarn");
    const msgs = [];
    if (sum.pulled > 0.5) msgs.push(`⚠️ Knock: the ECU is pulling ${sum.pulled}° of timing. Richer fuel, less boost or a better intercooler will give the power back.`);
    if (sum.egt > 950) msgs.push(`🌡️ EGT ${sum.egt}°C is very high - richen the AFR.`);
    if (sum.stress === "Extreme") msgs.push("💀 This tune is way past what the block was built for.");
    warn.hidden = !msgs.length;
    warn.innerHTML = msgs.map((m) => `<div>${m}</div>`).join("");

    // sliders
    const rows = (host, list, tune) => {
      $(host).innerHTML = "";
      for (const c of list) {
        if (c.boosted && !boosted) continue;
        const [lo, hi, step] = this.tuneRange(car, c.key);
        const row = document.createElement("label");
        row.className = "slider tune-slider";
        row.innerHTML = `<span title="${esc(c.hint || "")}">${c.label}</span><input type="range" min="${lo}" max="${hi}" step="${step}" value="${tune[c.key]}"><b>${c.fmt(+tune[c.key])}</b>`;
        row.querySelector("input").oninput = (ev) => this.setTune({ [c.key]: +ev.target.value });
        $(host).appendChild(row);
      }
    };
    rows("tuneSliders", this.ENGINE_CONTROLS, t);
    rows("tuneExhaust", this.EXHAUST_CONTROLS, t);

    // parts
    const parts = $("tuneParts");
    parts.innerHTML = "";
    for (const [kind, def] of Object.entries(PARTS)) {
      const locked = def.boostedOnly && (!boosted || e.induction === "super");
      const wrap = document.createElement("div");
      wrap.className = "part-row" + (locked ? " locked" : "");
      wrap.innerHTML = `<div class="part-label">${def.label}${locked ? ` <small>· not available on this engine</small>` : ""}</div>`;
      const chips = document.createElement("div");
      chips.className = "chips";
      for (const [key, opt] of Object.entries(def.opts)) {
        const b = document.createElement("button");
        b.textContent = opt.label;
        b.className = t[kind] === key ? "on" : "";
        b.disabled = locked;
        b.onclick = () => this.setTune({ [kind]: key });
        chips.appendChild(b);
      }
      wrap.appendChild(chips);
      parts.appendChild(wrap);
    }

    $("tBrap").checked = t.brap;
    [...$("tRelease").children].forEach((b) => b.classList.toggle("on", b.dataset.v === t.release));
    [...$("tuneMode").children].forEach((b) => b.classList.toggle("on", b.dataset.v === P.settings.driveMode));
    this.drawCharts(sum, stock, t, boosted);
  }
  // per-car limits: the block decides the rev ceiling, the turbo decides the boost ceiling
  tuneRange(car, key) {
    const [lo, hi, step] = TUNE_RANGE[key], s = specOf(car), e = engineOf(car), t = carTune(car.id);
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
    g.fillStyle = "#11151f"; g.fillRect(0, 0, W, H);
    const xs = series[0].pts.map((p) => p[0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const px = (x) => padL + ((x - x0) / Math.max(1, x1 - x0)) * (W - padL - padR);
    g.strokeStyle = "#232a3a"; g.lineWidth = 1; g.font = "11px Fredoka, sans-serif"; g.fillStyle = "#7d879b";
    for (let r = Math.ceil(x0 / 1000) * 1000; r <= x1; r += 1000) {
      g.beginPath(); g.moveTo(px(r), padT); g.lineTo(px(r), H - padB); g.stroke();
      g.textAlign = "center"; g.fillText(r / 1000 + "k", px(r), H - 7);
    }
    if (opts.mark) { // rev limiter
      g.strokeStyle = "#ff4a55"; g.setLineDash([4, 4]);
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
      { pts: pick(c, (p) => p.nm), color: "#ffc629", max: nmMax, min: 0, label: "Nm", right: true },
    ], { mark });
    const bMax = Math.max(2, ...c.map((p) => Math.max(p.boost, p.target))) * 1.2;
    this.chart("chartBoost", boosted ? [
      { pts: pick(c, (p) => p.target), color: "#7d879b", dash: [4, 4], max: bMax, min: 0, label: "target" },
      { pts: pick(c, (p) => p.boost), color: "#3dff6a", max: bMax, min: 0, label: "psi" },
    ] : [{ pts: pick(c, () => 0), color: "#3a4256", max: 1, min: 0, label: "naturally aspirated" }], { mark });
    this.chart("chartFuel", [
      { pts: pick(c, (p) => p.afr), color: "#ff8a3d", min: 10, max: 15, label: "AFR" },
      { pts: pick(c, (p) => p.timing), color: "#b27dff", min: -8, max: 12, label: "timing", right: true },
    ], { mark });
    this.chart("chartTemp", [
      { pts: pick(c, (p) => p.egt), color: "#ff4a55", min: 200, max: 1100, label: "EGT" },
      { pts: pick(c, (p) => p.oil), color: "#ffd23d", min: 20, max: 1100 },
      { pts: pick(c, (p) => p.coolant), color: "#4dffc3", min: 20, max: 1100 },
      { pts: pick(c, (p) => p.iat), color: "#3dd6ff", min: 20, max: 1100, label: "IAT", right: true },
    ], { mark });
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

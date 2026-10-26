// The online city, friends and hero settings are independent of the saved driving game.
import { HERO_KEYS } from "./hero-input.js";
const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export class ArclineUI {
  constructor(ctx) {
    this.ctx = ctx; this.net = ctx.net; this.panel = "lobby"; this.joining = false;
    // Share the help screen's bindings so menu controls cannot drift out of date.
    document.querySelector(".arc-controls>div").innerHTML = HERO_KEYS.map(([key, action]) => `<span><kbd>${esc(key)}</kbd>${esc(action)}</span>`).join("");
    document.addEventListener("click", event => {
      const button = event.target.closest("[data-arc-action]");
      if (button) this.action(button.dataset.arcAction, button.dataset.code);
      const tab = event.target.closest("[data-arc-panel]");
      if (tab) this.open(tab.dataset.arcPanel);
    });
    $("arcJoinForm").onsubmit = event => { event.preventDefault(); this.join($("arcJoinCode").value); };
    $("arcCreateForm").onsubmit = event => { event.preventDefault(); this.create(); };
    $("arcFriendForm").onsubmit = event => { event.preventDefault(); this.net.send({ t: "friendAdd", code: $("arcFriendCode").value.trim().toUpperCase() }); };
    $("arcChatForm").onsubmit = event => {
      event.preventDefault(); const text = $("arcChatInput").value.trim();
      if (text) this.ctx.chat(text);
      this.closeChat();
    };
    for (const input of document.querySelectorAll("[data-arc-setting]")) input.addEventListener("change", () => {
      const key = input.dataset.arcSetting;
      this.ctx.P.settings[key] = input.type === "checkbox" ? input.checked : input.type === "range" ? Number(input.value) : input.value;
      this.ctx.save(); this.ctx.applySettings(key);
    });
    const n = this.net;
    n.addEventListener("status", () => { this.render(); if (!n.room) this.ctx.roomChanged(false); if (this.waitingForConnection && n.connected) { this.waitingForConnection = false; this.quickPlay(); } });
    n.addEventListener("ping", () => this.renderStatus());
    n.addEventListener("publicList", () => this.renderServers());
    n.addEventListener("social", () => this.renderFriends());
    n.addEventListener("room", event => {
      if (n.room && n.gotInfo === false) return;
      this.joining = false; clearTimeout(this.joinTimer);
      if (n.room && n.room.mode !== "hero") { n.send({ t: "roomLeave" }); this.toast("This city is for ARCLINE heroes.", [], "warn"); return; }
      this.ctx.roomChanged(!!event.detail?.fresh);
      this.render();
    });
    n.addEventListener("error", event => { this.joining = false; this.waitingForConnection = false; clearTimeout(this.joinTimer); this.renderStatus(); this.toast(event.detail?.msg || "Could not connect to that city.", [], "error"); });
    n.addEventListener("toast", event => this.toast(event.detail?.msg || ""));
    n.addEventListener("chat", event => this.chatLine(event.detail?.name, event.detail?.text));
    n.addEventListener("invite", event => this.toast(`${event.detail.from} invited you to their city`, [{ label: "Join", run: () => this.join(event.detail.room) }]));
    n.addEventListener("friendRequest", event => this.toast(`${event.detail.name} sent a friend request`, [{ label: "Accept", run: () => n.send({ t: "friendAccept", id: event.detail.id }) }]));
    this.renderSettings();
  }
  action(action, code) {
    switch (action) {
      case "menu": this.open(); break;
      case "continue": if (this.ctx.active()) this.close(); else { this.cancelJoining(); this.ctx.enter(false); } break;
      case "resume": this.close(); break;
      case "quick": this.quickPlay(); break;
      case "practice": this.cancelJoining(); this.ctx.enter(false); break;
      case "refresh": this.net.send({ t: "publicRefresh" }); break;
      case "join": this.join(code); break;
      case "leave": this.cancelJoining(); this.ctx.requestOnline(false); this.net.send({ t: "roomLeave" }); break;
      case "activities": this.ctx.activities(); break;
      case "players": this.togglePlayers(); break;
      case "invite": this.net.send({ t: "invite", id: code }); break;
      case "join-friend": this.ctx.requestOnline(); this.joining = true; this.armJoinTimeout(); this.net.send({ t: "joinFriend", id: code }); break;
      case "accept": this.net.send({ t: "friendAccept", id: code }); break;
      case "signout": this.ctx.signOut(); break;
    }
  }
  loading(title, sub = "") { $("loader").hidden = false; $("loaderTitle").textContent = title; $("loaderSub").textContent = sub; }
  loaded() { $("loader").hidden = true; }
  open(panel = "home") {
    this.panel = panel; $("arcMenu").dataset.panel = panel;
    const inGame = this.ctx.active();
    $("arcMenu").dataset.session = inGame ? "game" : "lobby";
    document.body.classList.toggle("arc-game-menu", inGame);
    $("arcMenu").querySelector(".arc-start-label").textContent = inGame ? "GAME MENU" : "MAIN MENU";
    $("arcContinue").textContent = this.ctx.active() ? "Continue" : "Start patrol";
    this.closeChat(); $("arcPlayers").hidden = true;
    this.ctx.pause(true); $("arcMenu").hidden = false;
    for (const button of document.querySelectorAll("[data-arc-panel]")) button.classList.toggle("on", button.dataset.arcPanel === panel);
    for (const section of document.querySelectorAll("[data-arc-section]")) section.hidden = section.dataset.arcSection !== panel;
    $("arcResume").hidden = $("arcClose").hidden = !this.ctx.active();
    this.render(); this.renderSettings();
    if (panel === "lobby" && this.net.connected) this.net.send({ t: "publicRefresh" });
  }
  close() {
    if (!this.ctx.active()) return;
    $("arcMenu").hidden = true; $("arcPlayers").hidden = true; document.body.classList.remove("arc-game-menu"); this.ctx.pause(false);
  }
  get menuOpen() { return !$("arcMenu").hidden; }
  cancelJoining() { clearTimeout(this.searchTimer); clearTimeout(this.joinTimer); this.joining = this.waitingForConnection = false; }
  armJoinTimeout() {
    clearTimeout(this.joinTimer);
    this.joinTimer = setTimeout(() => { if (!this.joining) return; this.joining = false; this.toast("That city did not respond. Refresh the list or create a city.", [], "warn"); this.renderStatus(); }, 16000);
  }
  quickPlay() {
    if (this.joining) return;
    this.ctx.requestOnline();
    if (this.net.room?.mode === "hero") return this.ctx.enter(true);
    if (!this.net.connected) { this.waitingForConnection = true; this.toast("Connecting to the online city network…"); return; }
    this.joining = true; this.armJoinTimeout(); this.net.send({ t: "publicRefresh" }); this.renderStatus();
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      if (!this.joining) return;
      const room = (this.net.publicServers?.() || []).find(s => s.mode === "hero" && !s.full && s.players > 0);
      if (room) this.net.send({ t: "roomJoin", code: room.code });
      else this.net.send({ t: "roomCreate", mode: "hero", name: "New Meridian", public: true, max: 8, traffic: "Normal" });
    }, 1500);
  }
  join(code) {
    if (!this.net.connected) return this.toast("The city network is connecting. Try again in a moment.", [], "warn");
    code = String(code || "").trim();
    if (!/^\d{6}$/.test(code)) return this.toast("Enter a six-digit city code.", [], "warn");
    this.ctx.requestOnline();
    clearTimeout(this.searchTimer); this.joining = true; this.armJoinTimeout(); this.renderStatus();
    this.net.send({ t: "roomJoin", code });
  }
  create() {
    if (!this.net.connected) return this.toast("Connect to the city network first.", [], "warn");
    this.ctx.requestOnline();
    clearTimeout(this.searchTimer); this.joining = true; this.armJoinTimeout(); this.renderStatus();
    this.net.send({ t: "roomCreate", mode: "hero", name: $("arcRoomName").value.trim() || "New Meridian", public: !$("arcPrivate").checked, max: Number($("arcCapacity").value), traffic: "Normal" });
  }
  render() { this.renderStatus(); this.renderServers(); this.renderFriends(); this.renderRoom(); }
  renderStatus() {
    const n = this.net, text = this.joining ? "Finding your city…" : n.connected ? `Online${n.ping != null ? " · " + Math.round(n.ping) + " ms relay" : ""}` : "Connecting to the city network…";
    $("arcStatus").textContent = text; $("arcNetLabel").textContent = n.room ? `${n.room.players.length}/${n.room.max || 8} heroes` : this.ctx.active() ? "Practice" : text;
    $("arcQuick").disabled = this.joining;
    $("arcPlayerName").textContent = this.ctx.P.name;
    $("arcHeroCode").textContent = n.me?.code || "Connecting…";
  }
  renderServers() {
    const rooms = (this.net.publicServers?.() || []).filter(room => room.mode === "hero");
    $("arcServers").innerHTML = rooms.length ? rooms.map(room => `<div class="arc-server"><div><b>${esc(room.name || "New Meridian")}</b><small>${room.players}/${room.max} heroes · ${esc(room.code)}</small></div><button class="btn ${room.full ? "gray" : "accent"}" data-arc-action="join" data-code="${esc(room.code)}" ${room.full ? "disabled" : ""}>${room.full ? "Full" : "Join"}</button></div>`).join("") : `<p class="arc-empty">${this.net.connected ? "No public cities yet. Join online to start one for other heroes." : "Cities appear once the network connects. You can explore alone while you wait."}</p>`;
  }
  renderRoom() {
    const room = this.net.room;
    $("arcRoom").hidden = !room;
    if (room) $("arcRoom").innerHTML = `<span>YOUR CITY</span><b>${esc(room.name || "New Meridian")}</b><small>Code ${esc(room.code)} · ${room.players.length}/${room.max || 8} heroes</small><button class="btn gray" data-arc-action="leave">Leave city</button>`;
    $("arcSessionLabel").textContent = room?.name || "NEW MERIDIAN";
  }
  renderFriends() {
    const n = this.net;
    const incoming = (n.incoming || []).map(friend => `<div class="arc-server"><div><b>${esc(friend.name)}</b><small>Friend request</small></div><button class="btn accent" data-arc-action="accept" data-code="${esc(friend.id)}">Accept</button></div>`).join("");
    const friends = (n.friends || []).map(friend => `<div class="arc-server"><div><b>${esc(friend.name)}</b><small>${friend.online ? friend.room ? "In a city" : "Online" : "Offline"}</small></div>${friend.room ? `<button class="btn accent" data-arc-action="join-friend" data-code="${esc(friend.id)}">Join</button>` : n.room && friend.online ? `<button class="btn gray" data-arc-action="invite" data-code="${esc(friend.id)}">Invite</button>` : ""}</div>`).join("");
    $("arcFriends").innerHTML = incoming + friends || '<p class="arc-empty">Add a friend using their six-character hero code.</p>';
  }
  renderSettings() {
    for (const input of document.querySelectorAll("[data-arc-setting]")) {
      const value = this.ctx.P.settings[input.dataset.arcSetting];
      if (input.type === "checkbox") input.checked = !!value; else input.value = value;
    }
  }
  togglePlayers() {
    if (!this.ctx.active()) return;
    const el = $("arcPlayers"); el.hidden = !el.hidden;
    if (!el.hidden) { this.closeChat(); this.ctx.hero.activities.closeMenu(); this.ctx.hero.input.unlock(); this.ctx.hero.input.wantLock = false; this.renderPlayers(); }
    else if (!this.menuOpen && $("arcChatForm").hidden) this.ctx.hero.input.wantLock = true;
  }
  renderPlayers() {
    const rows = this.ctx.hero.playerRows();
    $("arcPlayersList").innerHTML = rows.length ? rows.map(row => `<div class="arc-server"><div><b>${esc(row.name)}${row.me ? " · YOU" : ""}</b><small>${esc(row.car)}</small></div>${!row.me ? `<button class="btn gray" data-arc-action="teleport" data-code="${esc(row.id)}">Visit</button>` : ""}</div>`).join("") : '<p class="arc-empty">You are exploring New Meridian alone.</p>';
    for (const button of $("arcPlayersList").querySelectorAll('[data-arc-action="teleport"]')) button.onclick = () => { const result = this.ctx.hero.teleportTo(button.dataset.code); this.toast(result.text); };
  }
  openChat() { if (!this.net.room || this.menuOpen) return; $("arcPlayers").hidden = true; this.ctx.hero.activities.closeMenu(); this.ctx.hero.input.unlock(); this.ctx.hero.input.wantLock = false; $("arcChatForm").hidden = false; $("arcChatInput").focus(); }
  closeChat() { $("arcChatInput").value = ""; $("arcChatInput").blur(); $("arcChatForm").hidden = true; if (this.ctx.active() && !this.menuOpen && $("arcPlayers").hidden) this.ctx.hero.input.wantLock = true; }
  chatLine(name, text) {
    const line = document.createElement("p"), b = document.createElement("b"); b.textContent = `${name || "City"}: `;
    line.append(b, document.createTextNode(String(text || ""))); $("arcChatLines").appendChild(line);
    while ($("arcChatLines").children.length > 5) $("arcChatLines").firstChild.remove();
    setTimeout(() => line.remove(), 14000);
  }
  toast(text, actions = [], kind = "info") {
    if (!text) return;
    const el = document.createElement("div"); el.className = "arc-toast " + kind;
    const label = document.createElement("span"); label.textContent = text; el.appendChild(label);
    for (const action of actions) { const button = document.createElement("button"); button.textContent = action.label; button.onclick = () => { action.run(); el.remove(); }; el.appendChild(button); }
    $("arcToasts").appendChild(el); while ($("arcToasts").children.length > 4) $("arcToasts").firstChild.remove();
    setTimeout(() => el.remove(), actions.length ? 10000 : 4500);
  }
}

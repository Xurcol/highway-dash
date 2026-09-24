// Serverless multiplayer over a public MQTT relay. No accounts: a player is a name plus a random
// driver code kept in a cookie. Same interface as the WebSocket Net in net.js.
//
// Topics (all under ROOT):
//   presence/<code>        retained  {name, best, level, car, room, joinT, t} — last-will marks offline
//   req/<to>/<from>        retained  friend request   (cleared when answered)
//   acc/<to>/<from>        retained  friend accepted  (cleared when seen)
//   inbox/<code>                     invites
//   room/<code>/info       retained  {round, seed, epoch, traffic, public, prevEnd}
//   room/<code>/s/<from>             player state stream (~10 Hz)
//   room/<code>/c | /e               chat | events
//   public/<code>          retained  {traffic, t} listing for quick play
import mqtt from "/vendor/mqtt.esm.js";
import { store, pushState } from "./net.js";

// ?root=... points a client at a private topic namespace, so tests never touch the real lobby.
const ROOT = (() => { const r = new URLSearchParams(location.search).get("root"); return r && /^[\w\-\/]{3,60}$/.test(r) ? r.replace(/\/?$/, "/") : "xurcoxyz/hdash/v1/"; })();
// Every player connects to all relays at once and publishes to each, so two players can never end up
// on different relays (a slow or blocked relay just drops out). Duplicate deliveries are filtered by id.
const BROKERS = [
  { name: "HiveMQ", url: "wss://broker.hivemq.com:8884/mqtt" },
  { name: "EMQX", url: "wss://broker.emqx.io:8084/mqtt" },
  { name: "Mosquitto", url: "wss://test.mosquitto.org:8081" },
];
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ROOM = 8, MIN_ROOM = 2;
const ROOM_MODES = ["crash", "target", "timed", "free", "city"];
const LISTING_TTL = 3 * 60 * 1000;      // a listing nobody has refreshed for this long is dead
const cleanText = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const num = (v, lo, hi, d = 0) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
// Every state packet comes from a stranger over a public broker, so nothing in it is trusted: numbers are
// clamped to plausible ranges and unknown fields are dropped before they can reach the renderer.
function sanitizeState(m) {
  if (!m || typeof m !== "object" || !Number.isFinite(+m.T) || !Number.isFinite(+m.x) || !Number.isFinite(+m.z)) return null;
  const o = {
    T: +m.T, x: num(m.x, -40, 40), z: num(m.z, -1e7, 1e7), y: num(m.y, -5, 200), ry: num(m.ry, -7, 7), pitch: num(m.pitch, -7, 7), roll: num(m.roll, -7, 7),
    w: num(m.w, 0, 1e15), rd: num(m.rd, 0, 1e9), tp: num(m.tp, 0, 1e9), vx: num(m.vx, -80, 80), v: num(m.v, -80, 220),
    rpm: num(m.rpm, 0, 20000), thr: num(m.thr, 0, 1), ld: num(m.ld, 0, 2), g: num(m.g, -1, 20) | 0, sh: m.sh ? 1 : 0, bo: num(m.bo, 0, 200),
    brk: m.brk ? 1 : 0, sl: m.sl ? 1 : 0, sr: m.sr ? 1 : 0, cr: m.cr ? 1 : 0, sc: num(m.sc, 0, 1e9) | 0,
  };
  if (m.c && typeof m.c === "object") {
    const c = m.c;
    o.c = { car: cleanText(c.car, 24), col: c.col === undefined ? undefined : num(c.col, 0, 0xffffff) | 0, st: typeof c.st === "object" ? c.st : undefined, md: c.md ? 1 : 0, a: typeof c.a === "object" ? c.a : undefined };
    // the traffic fingerprint pair is only meaningful when both halves are present
    if (Number.isFinite(+c.tq) && Number.isFinite(+c.th)) { o.c.tq = num(c.tq, 0, 1e7); o.c.th = num(c.th, -2147483648, 2147483647) | 0; }
  }
  return o;
}
const STALE = 3 * 60 * 1000; // presence older than this counts as offline (tab closed without a clean disconnect)
const live = (p) => p && !p.offline && Date.now() - (p.t || 0) < STALE;

// A relay whose socket is closing still reports connected for a moment. Publishing into it made the
// browser log an error for every packet (20 a second) until the library noticed, so check the socket.
const linkOpen = (l) => l.client.connected && (l.client.stream?.socket?.readyState ?? 1) === 1;

const cookie = {
  get(k) { const m = document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; },
  set(k, v) { document.cookie = `${k}=${encodeURIComponent(v)}; max-age=${60 * 60 * 24 * 400}; path=/; SameSite=Lax`; },
};
const randCode = (n = 6) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
const cleanName = (s) => String(s || "").replace(/[^\w .\-]/g, "").trim().slice(0, 16) || "Driver";

export class RelayNet extends EventTarget {
  constructor() {
    super();
    this.client = null; this.connected = false;
    this.me = null; this.room = null; this.roomInfo = null;
    this.friends = []; this.incoming = [];
    this.peers = new Map();
    this.players = new Map();     // code -> presence
    this.publicRooms = new Map(); // code -> listing
    this.friendCodes = new Set(store.get("hd_friends", []));
    this.incomingMap = new Map();
    this.myScore = 0; this.lastRound = 0;
    this.clockOffset = 0; this.clockSamples = []; // everyone in a party follows the host's clock
    this.links = [];
    this.seen = new Map(); // message id -> time, for de-duplicating the same message arriving via several relays
    this.fastSeen = new Map(); // sender -> ring of recent payload hashes, for the 20 Hz state stream
    this.ping = null; this.pingSent = new Map();   // relay round-trip time, ms
    this.chatIn = new Map(); this.chatOut = [];    // chat rate limiting (incoming per sender, outgoing for us)
    this.listState = "idle";                       // idle | loading | ready | offline
    this.joinTimer = 0; this.gotInfo = false;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  now() { return Date.now() + this.clockOffset; }
  // Samples of (host's synced clock at send) - (our clock at receive) = offset - latency; the largest
  // recent sample is the least-delayed one, so it's the best estimate of the true offset.
  clockSample(from, w) {
    const host = this.room?.players?.[0]?.id;
    if (!host || host === this.me.code) { this.clockOffset = 0; this.clockSamples.length = 0; return; }
    if (from !== host) return;
    const now = Date.now();
    this.clockSamples.push({ v: w - now, t: now });
    while (this.clockSamples.length > 200 || (this.clockSamples.length && now - this.clockSamples[0].t > 15000)) this.clockSamples.shift();
    const vals = this.clockSamples.map((s) => s.v).sort((a, b) => a - b);
    const med = vals[vals.length >> 1];
    // the largest recent sample is the least-delayed one, but a single wild packet must not latch
    const ok = vals.filter((v) => Math.abs(v - med) < 1500);
    const target = (ok.length ? ok[ok.length - 1] : med) + 20;
    this.clockOffset += (target - this.clockOffset) * (Math.abs(target - this.clockOffset) > 400 ? 1 : .15);
  }
  t(topic) { return ROOT + topic; }
  pub(topic, obj, retain = false) {
    const payload = obj === null ? "" : JSON.stringify({ ...obj, _m: randCode(10) });
    for (const l of this.links) if (linkOpen(l)) l.client.publish(this.t(topic), payload, { qos: retain ? 1 : 0, retain });
  }
  // state stream: no de-dup id needed per relay copy beyond T ordering, keep payloads small
  pubFast(topic, obj) {
    const payload = JSON.stringify(obj);
    for (const l of this.links) if (linkOpen(l)) l.client.publish(this.t(topic), payload, { qos: 0 });
  }
  relayStatus() { return this.links.map((l) => ({ name: l.name, up: l.client.connected })); }

  connect(name, car) {
    let code = cookie.get("hd_code") || store.get("hd_code", null);
    if (!code || !/^[A-Z2-9]{6}$/.test(code)) code = randCode();
    cookie.set("hd_code", code); store.set("hd_code", code);
    const storedName = cookie.get("hd_name") || name;
    this.me = { id: code, code, name: cleanName(storedName), best: 0, level: 1 };
    cookie.set("hd_name", this.me.name);
    this.car = car; this.joinT = 0;
    this.open();
  }
  open() {
    clearInterval(this.beat);
    this.beat = setInterval(() => { this.publishPresence(); this.pruneSeen(); this.publishListing(); }, 60000);
    clearInterval(this.pingBeat);
    this.pingBeat = setInterval(() => this.pingRelay(), 20000);
    for (const b of BROKERS) {
      const will = { topic: this.t(`presence/${this.me.code}`), payload: JSON.stringify({ ...this.presence(true), t: 0 }), qos: 1, retain: true };
      const client = mqtt.connect(b.url, { clientId: `hd_${this.me.code}_${randCode(4)}`, keepalive: 30, reconnectPeriod: 4000, connectTimeout: 15000, clean: true, will });
      const link = { name: b.name, client };
      this.links.push(link);
      client.on("connect", () => {
        const c = this.me.code;
        client.subscribe([this.t("presence/+"), this.t(`req/${c}/+`), this.t(`acc/${c}/+`), this.t(`inbox/${c}`), this.t("public/+"), this.t(`ping/${c}`)], { qos: 0 });
        if (this.room) client.subscribe(this.roomTopics(this.room.code), { qos: 0 });
        client.publish(this.t(`presence/${c}`), JSON.stringify({ ...this.presence(false), _m: randCode(10) }), { qos: 1, retain: true });
        this.linkChanged();
      });
      client.on("close", () => this.linkChanged());
      client.on("error", () => { });
      client.on("message", (topic, payload) => this.onMessage(topic.slice(ROOT.length), payload.toString()));
    }
  }
  linkChanged() {
    const up = this.links.some((l) => l.client.connected);
    if (up !== this.connected) { this.connected = up; }
    this.emit("status");
  }
  pruneSeen() { const cut = Date.now() - 120000; for (const [k, t] of this.seen) if (t < cut) this.seen.delete(k); }

  presence(offline = false) {
    return { name: this.me.name, best: this.me.best || 0, level: this.me.level || 1, car: this.car, build: this.build || null, room: offline ? null : this.room?.code || null, joinT: this.joinT, offline, t: Date.now() };
  }
  publishPresence() { if (this.connected) this.pub(`presence/${this.me.code}`, this.presence(false), true); }

  // Every message is published to all three relays, so each one arrives three times. Ordinary
  // messages carry an _m id and are de-duplicated after parsing, which is fine at their rate. The
  // 20 Hz state stream is a different story: a full party meant ~420 JSON.parse calls a second, two
  // thirds of them thrown straight away. Duplicates are byte-identical, so hashing the raw string
  // rejects them before any parsing happens.
  fastDupe(from, raw) {
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619); }
    let ring = this.fastSeen.get(from);
    if (!ring) this.fastSeen.set(from, (ring = { a: new Int32Array(8), i: 0 }));
    if (ring.a.includes(h)) return true;
    ring.a[ring.i = (ring.i + 1) & 7] = h;
    return false;
  }
  onMessage(topic, raw) {
    const parts = topic.split("/");
    if (parts[0] === "room" && parts[2] === "s" && raw) {
      if (parts[3] === this.me.code || this.fastDupe(parts[3], raw)) return;
    }
    let m = null;
    if (raw) { try { m = JSON.parse(raw); } catch { return; } }
    if (m && m._m) { // same message via another relay (or a retained re-delivery)
      const key = topic + "|" + m._m;
      if (this.seen.has(key)) return;
      this.seen.set(key, Date.now());
    }
    switch (parts[0]) {
      case "presence": {
        const code = parts[1];
        const prev = this.players.get(code);
        if (!m) this.players.delete(code);
        else if (!prev || (m.t || 0) >= (prev.t || 0)) this.players.set(code, { ...m, code, name: cleanName(m.name) });
        if (code === this.me.code && m) { this.me.best = Math.max(this.me.best, m.best || 0); }
        this.socialSoon();
        if (this.room) this.roomSoon();
        break;
      }
      case "public":
        if (m && typeof m === "object") this.publicRooms.set(parts[1], { ...m, rx: Date.now() });
        else this.publicRooms.delete(parts[1]);
        if (this.listState !== "idle") this.listSoon();
        break;
      case "ping": {
        const sent = this.pingSent.get(m?.k);
        if (sent) { this.pingSent.delete(m.k); const rtt = Math.round(performance.now() - sent); this.ping = this.ping === null ? rtt : Math.min(this.ping * .5 + rtt * .5, rtt + 200); this.emit("ping"); }
        break;
      }
      case "req": {
        const from = parts[2];
        if (m && !this.friendCodes.has(from) && !this.incomingMap.has(from)) this.emit("friendRequest", { id: from, name: cleanName(m.name) });
        if (m && !this.friendCodes.has(from)) this.incomingMap.set(from, cleanName(m.name));
        else this.incomingMap.delete(from);
        if (m && this.friendCodes.has(from)) this.pub(`req/${this.me.code}/${from}`, null, true); // already friends
        this.socialSoon();
        break;
      }
      case "acc": {
        if (!m) break;
        const from = parts[2];
        this.addFriend(from);
        this.pub(`acc/${this.me.code}/${from}`, null, true);
        this.emit("toast", { msg: `${cleanName(m.name)} accepted your friend request` });
        break;
      }
      case "inbox": if (m?.type === "invite") this.emit("invite", { from: cleanName(m.from), fromId: m.fromId, room: m.room }); break;
      case "room": {
        if (!this.room || parts[1] !== this.room.code) break;
        const kind = parts[2];
        if (kind === "info") this.applyInfo(m);
        else if (kind === "s" && m) {
          const from = parts[3];
          if (from === this.me.code || !/^[A-Z2-9]{6}$/.test(from)) break;
          let peer = this.peers.get(from);
          // a party is small: a stranger publishing into the room topic cannot conjure dozens of cars
          if (!peer && this.peers.size >= MAX_ROOM + 3) break;
          const st = sanitizeState(m);
          if (!st) break;
          if (!peer) { peer = { buf: [], name: this.players.get(from)?.name || "Driver", car: st.c?.car }; this.peers.set(from, peer); this.roomSoon(); }
          if (typeof st.w === "number") this.clockSample(from, st.w);
          pushState(peer, st);
          peer.last = performance.now(); if (st.c?.car) peer.car = st.c.car;
        } else if (kind === "c" && m) {
          const from = cleanName(m.name), text = cleanText(m.text, 120);
          if (!text || this.chatLimited(from)) break;
          this.emit("chat", { name: from, text });
        }
        else if (kind === "e" && m && m.id !== this.me.code) this.emit("event", { id: m.id, name: cleanName(m.name), kind: String(m.kind), v: m.v | 0, d: m.d ? String(m.d).slice(0, 48) : undefined });
        break;
      }
    }
  }

  // ---------- friends ----------
  addFriend(code) { this.friendCodes.add(code); store.set("hd_friends", [...this.friendCodes]); this.incomingMap.delete(code); this.socialSoon(); }
  socialSoon() {
    clearTimeout(this.socialT);
    this.socialT = setTimeout(() => {
      this.friends = [...this.friendCodes].map((code) => {
        const p = this.players.get(code) || {};
        return { id: code, code, name: p.name || code, best: p.best || 0, online: live(p), room: live(p) ? p.room || null : null };
      });
      this.incoming = [...this.incomingMap].map(([id, name]) => ({ id, name, code: id }));
      this.emit("social");
    }, 150);
  }

  // ---------- rooms ----------
  roomTopics(code) { return [this.t(`room/${code}/info`), this.t(`room/${code}/s/+`), this.t(`room/${code}/c`), this.t(`room/${code}/e`)]; }
  subRoom(code) { for (const l of this.links) if (l.client.connected) l.client.subscribe(this.roomTopics(code), { qos: 0 }); }
  unsubRoom(code) { for (const l of this.links) if (l.client.connected) l.client.unsubscribe(this.roomTopics(code)); }
  joinRoom(code, info) {
    if (this.room?.code === code) return this.roomSoon(true);
    const count = [...this.players.values()].filter((p) => p.room === code && live(p)).length;
    const cap = this.publicRooms.get(code)?.max || MAX_ROOM;
    if (!info && count >= cap) return this.emit("error", { msg: "That server is full" });
    if (this.room) this.leaveRoom(true);
    this.joinT = Date.now();
    this.roomInfo = info || { round: 0, seed: 1, epoch: Date.now(), traffic: "Heavy", public: false };
    // joining someone else's room: if nothing answers in a few seconds it is closed or never existed
    clearTimeout(this.joinTimer); this.gotInfo = !!info;
    if (!info) this.joinTimer = setTimeout(() => {
      if (this.room?.code === code && !this.gotInfo) { this.emit("error", { msg: "Couldn't find that server — it may have closed." }); this.leaveRoom(); }
    }, 7000);
    this.room = { code, players: [], ...this.roomInfo };
    this.subRoom(code);
    if (info) this.pub(`room/${code}/info`, info, true);
    this.publishPresence();
    this.freshRoom = true;
    this.roomSoon(true);
  }
  leaveRoom(silent = false) {
    if (!this.room) return;
    const code = this.room.code;
    // the last player out takes the listing down so the browser never shows an empty ghost server
    if (this.roomInfo?.public && this.room.players.length <= 1) this.pub(`public/${code}`, null, true);
    clearTimeout(this.joinTimer);
    this.unsubRoom(code);
    for (const id of this.peers.keys()) this.emit("peerLeft", id);
    this.peers.clear(); this.fastSeen.clear();
    this.room = null; this.roomInfo = null;
    this.publishPresence();
    if (!silent) this.emit("room", { fresh: true });
  }
  applyInfo(info) {
    if (!info || !this.room) return;
    const prev = this.roomInfo || {};
    this.roomInfo = info;
    this.gotInfo = true; clearTimeout(this.joinTimer);
    if (info.prevEnd && info.round > (prev.round || 0) && info.prevEnd.round === prev.round) this.emit("roundEnd", info.prevEnd);
    this.roomSoon();
  }
  roomSoon(fresh = false) {
    if (fresh) this.freshRoom = true;
    clearTimeout(this.roomT);
    this.roomT = setTimeout(() => {
      if (!this.room) return;
      const info = this.roomInfo || {};
      const players = [...this.players.entries()]
        .filter(([code, p]) => (p.room === this.room.code && live(p)) || code === this.me.code)
        .sort((a, b) => (a[1].joinT || 0) - (b[1].joinT || 0))
        .map(([id, p]) => ({ id, name: id === this.me.code ? this.me.name : p.name, car: id === this.me.code ? this.car : p.car, build: id === this.me.code ? this.build : p.build || null }));
      for (const id of this.peers.keys()) if (!players.some((p) => p.id === id)) { this.emit("peerLeft", id); this.peers.delete(id); this.fastSeen.delete(id); }
      for (const p of players) { const peer = this.peers.get(p.id); if (peer) { peer.name = p.name; peer.car = p.car || peer.car; } }
      const now = this.now();
      const roundState = !info.round ? "lobby" : now < info.epoch ? "countdown" : "running";
      this.room = { code: this.room.code, seed: info.seed ?? 1, epoch: info.epoch ?? now, round: info.round || 0, roundState, traffic: info.traffic || "Heavy", public: !!info.public, mode: ROOM_MODES.includes(info.mode) ? info.mode : "crash", target: info.target || 10000, dur: info.dur || 120, name: info.name || "", max: info.max || MAX_ROOM, hour: info.hour, weather: info.weather, players };
      this.publishListing();
      const fresh = this.freshRoom; this.freshRoom = false;
      if (!fresh && this.prevPlayers) for (const p of players) if (p.id !== this.me.code && !this.prevPlayers.has(p.id)) this.emit("toast", { msg: `🟢 ${p.name} joined the party` });
      this.prevPlayers = new Set(players.map((p) => p.id));
      this.emit("room", { fresh });
    }, 120);
    // round state flips countdown -> running on its own clock
    if (this.roomInfo?.epoch > this.now()) { clearTimeout(this.flipT); this.flipT = setTimeout(() => this.roomSoon(), this.roomInfo.epoch - this.now() + 30); }
  }
  newRoundInfo(extra = {}) {
    const info = this.roomInfo || {};
    return { round: (info.round || 0) + 1, seed: (Math.random() * 2 ** 31) | 0, epoch: this.now() + 3000, traffic: info.traffic || "Heavy", public: !!info.public, mode: info.mode || "crash", target: info.target || 10000, dur: info.dur || 120, name: info.name || "", max: info.max || MAX_ROOM, hour: info.hour, weather: info.weather, ...extra };
  }

  // ---------- public servers ----------
  // Normalises whatever the create form (or quick play) sends into a complete, safe room description.
  roomOpts(m = {}) {
    return {
      name: cleanText(m.name, 24) || `${this.me.name}'s server`,
      max: Math.round(num(m.max, MIN_ROOM, MAX_ROOM, MAX_ROOM)),
      mode: ROOM_MODES.includes(m.mode) ? m.mode : "crash",
      target: Math.round(num(m.target, 1000, 100000, 10000)), dur: Math.round(num(m.dur, 30, 600, 120)),
      traffic: ["Chill", "Normal", "Heavy", "Insane"].includes(m.traffic) ? m.traffic : "Heavy",
      public: !!m.public,
      hour: m.hour === undefined ? undefined : num(m.hour, 0, 24, 12), weather: m.weather === undefined ? undefined : cleanText(m.weather, 12),
    };
  }
  // The host of a public room keeps its retained listing fresh (and up to date after a settings change).
  // If the host leaves, whoever becomes first in the roster picks the job up on the next room update.
  publishListing() {
    const r = this.room, info = this.roomInfo;
    if (!r || !info?.public || r.players[0]?.id !== this.me.code) return;
    this.pub(`public/${r.code}`, { name: info.name || "Public server", mode: r.mode, max: info.max || MAX_ROOM, traffic: r.traffic, host: this.me.name, t: Date.now() }, true);
  }
  // Live entries only: a listing counts if people are actually in the room, or it was published a moment ago.
  publicServers() {
    const now = Date.now(), counts = new Map();
    for (const p of this.players.values()) if (p.room && live(p)) counts.set(p.room, (counts.get(p.room) || 0) + 1);
    const out = [];
    for (const [code, l] of this.publicRooms) {
      const n = counts.get(code) || 0;
      if (!n && now - (l.t || 0) > 20000) continue;
      if (now - (l.t || 0) > LISTING_TTL && !n) continue;
      const max = l.max || MAX_ROOM;
      out.push({ code, name: cleanText(l.name, 24) || "Public server", mode: ROOM_MODES.includes(l.mode) ? l.mode : "crash", players: n, max, traffic: l.traffic || "Heavy", host: cleanName(l.host), full: n >= max, mine: this.room?.code === code });
    }
    return out.sort((a, b) => (a.full - b.full) || b.players - a.players || a.name.localeCompare(b.name));
  }
  // Re-subscribing makes the broker replay every retained listing, which is the actual "query".
  refreshPublic() {
    this.listState = this.connected ? "loading" : "offline";
    this.emit("publicList");
    if (!this.connected) return;
    for (const l of this.links) if (l.client.connected) { l.client.unsubscribe(this.t("public/+")); l.client.subscribe(this.t("public/+"), { qos: 0 }); }
    this.pingRelay();
    clearTimeout(this.listT);
    this.listT = setTimeout(() => { this.listState = this.connected ? "ready" : "offline"; this.emit("publicList"); }, 1300);
  }
  listSoon() { clearTimeout(this.listRedraw); this.listRedraw = setTimeout(() => this.emit("publicList"), 250); }
  // Round trip to the relay we are connected through. It says nothing about a particular host's latency
  // (there is no direct connection to one), so the UI labels it as the relay ping.
  pingRelay() {
    if (!this.me) return;
    const k = randCode(6);
    this.pingSent.set(k, performance.now());
    if (this.pingSent.size > 20) this.pingSent.delete(this.pingSent.keys().next().value);
    this.pubFast(`ping/${this.me.code}`, { k });
  }
  chatLimited(from) {
    const now = performance.now(), a = (this.chatIn.get(from) || []).filter((t) => now - t < 5000);
    a.push(now); this.chatIn.set(from, a);
    if (this.chatIn.size > 64) this.chatIn.delete(this.chatIn.keys().next().value);
    return a.length > 8;
  }

  // ---------- leaderboard ----------
  leaderboard() {
    const all = [...this.players.entries()].filter(([, p]) => p.best > 0).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.best - a.best);
    const row = (x) => ({ name: x.id === this.me.code ? this.me.name : x.name, best: x.best, level: x.level || 1, me: x.id === this.me.code });
    const rank = all.findIndex((x) => x.id === this.me.code);
    const friends = [{ id: this.me.code, name: this.me.name, best: this.me.best, level: this.me.level }, ...[...this.friendCodes].map((c) => ({ id: c, ...(this.players.get(c) || { name: c, best: 0 }) }))].sort((a, b) => (b.best || 0) - (a.best || 0));
    this.emit("leaderboard", { top: all.slice(0, 200).map(row), rank: rank < 0 ? null : rank + 1, friends: friends.map(row) });
  }

  // ---------- outgoing (same message shapes as the WebSocket server) ----------
  send(m) {
    if (!this.me) return;
    const c = this.me.code;
    switch (m.t) {
      case "setName": this.me.name = cleanName(m.name); cookie.set("hd_name", this.me.name); this.publishPresence(); this.emit("status"); if (this.room) this.roomSoon(); break;
      case "setCar": this.car = m.car; this.publishPresence(); break;
      case "setBuild": this.build = m.build; this.publishPresence(); if (this.room) this.roomSoon(); break;
      case "friendAdd": {
        const code = String(m.code || "").toUpperCase().trim();
        if (code === c) return this.emit("error", { msg: "That's your own code. Your friend needs to open the game on their own device or browser." });
        if (!/^[A-Z2-9]{6}$/.test(code)) return this.emit("error", { msg: "Driver codes are 6 letters/numbers" });
        if (this.friendCodes.has(code)) return this.emit("error", { msg: "Already friends" });
        if (this.incomingMap.has(code)) return this.send({ t: "friendAccept", id: code });
        this.pub(`req/${code}/${c}`, { name: this.me.name }, true);
        this.addFriend(code);
        this.emit("toast", { msg: `Friend request sent to ${this.players.get(code)?.name || code}` });
        break;
      }
      case "friendAccept":
        this.addFriend(m.id);
        this.pub(`acc/${m.id}/${c}`, { name: this.me.name }, true);
        this.pub(`req/${c}/${m.id}`, null, true);
        break;
      case "friendDecline": this.incomingMap.delete(m.id); this.pub(`req/${c}/${m.id}`, null, true); this.socialSoon(); break;
      case "friendRemove": this.friendCodes.delete(m.id); store.set("hd_friends", [...this.friendCodes]); this.socialSoon(); break;
      case "roomCreate": {
        const o = this.roomOpts(m);
        this.joinRoom(String(100000 + Math.floor(Math.random() * 900000)), { round: 0, seed: 1, epoch: Date.now(), ...o });
        break;
      }
      case "quickPlay": {
        const pick = this.publicServers().find((s) => !s.full && s.players > 0)?.code;
        if (pick) this.joinRoom(pick);
        else {
          const code = String(100000 + Math.floor(Math.random() * 900000));
          this.joinRoom(code, { round: 0, seed: 1, epoch: Date.now(), ...this.roomOpts({ name: `${this.me.name}'s server`, public: true }) });
        }
        break;
      }
      case "roomJoin": { const code = String(m.code || "").trim(); if (!/^\d{6}$/.test(code)) return this.emit("error", { msg: "Party not found" }); this.joinRoom(code); break; }
      case "joinFriend": { const p = this.players.get(m.id); if (!p?.room || !live(p)) return this.emit("error", { msg: "Friend isn't in a party" }); this.joinRoom(p.room); break; }
      case "invite": if (this.room) { this.pub(`inbox/${m.id}`, { type: "invite", from: this.me.name, fromId: c, room: this.room.code }); this.emit("toast", { msg: "Invite sent" }); } break;
      case "roomLeave": this.leaveRoom(); break;
      case "state": if (this.room) { this.myScore = m.s.sc || 0; this.pubFast(`room/${this.room.code}/s/${c}`, m.s); } break;
      case "chat": {
        if (!this.room) break;
        const text = cleanText(m.text, 120), now = performance.now();
        if (!text) break;
        // at most 4 messages in any 5 seconds
        this.chatOut = this.chatOut.filter((t) => now - t < 5000);
        if (this.chatOut.length >= 4) return this.emit("error", { msg: "You're sending messages too fast" });
        this.chatOut.push(now);
        this.pub(`room/${this.room.code}/c`, { name: this.me.name, text });
        break;
      }
      case "publicRefresh": this.refreshPublic(); break;
      case "event": if (this.room) this.pub(`room/${this.room.code}/e`, { id: c, name: this.me.name, kind: m.kind, v: m.v, d: m.d }); break;
      case "score": {
        const s = Math.floor(Number(m.score) || 0);
        if (s > this.me.best) this.me.best = s;
        if (m.level) this.me.level = m.level;
        this.publishPresence();
        this.leaderboard();
        break;
      }
      case "leaderboard": this.leaderboard(); break;
      // the host (first to join) sets the party's mode, score target, time and traffic between rounds
      case "roomSettings": {
        if (!this.room || this.room.players?.[0]?.id !== c || this.room.roundState === "running") return;
        const info = { ...(this.roomInfo || {}), mode: ROOM_MODES.includes(m.mode) ? m.mode : "crash", target: Math.max(1000, Math.min(100000, m.target | 0 || 10000)), dur: Math.max(30, Math.min(600, m.dur | 0 || 120)), traffic: m.traffic || this.roomInfo?.traffic || "Heavy" };
        this.pub(`room/${this.room.code}/info`, info, true);
        break;
      }
      case "startRound": if (this.room && !this.room.round) this.pub(`room/${this.room.code}/info`, this.newRoundInfo(), true); break;
      case "crash": {
        if (!this.room || m.round !== this.room.round) return;
        const scores = this.room.players.map((p) => ({ id: p.id, name: p.name, score: p.id === c ? Math.max(this.myScore, m.score | 0) : this.peers.get(p.id)?.buf.at(-1)?.sc || 0 })).sort((a, b) => b.score - a.score);
        // "win" rounds (first to a score / time up) name the winner; crash rounds name who crashed
        const top = scores[0] || { name: this.me.name, id: c };
        const prevEnd = m.win ? { round: this.room.round, by: m.timed ? top.name : this.me.name, byId: m.timed ? top.id : c, scores, win: true } : { round: this.room.round, by: this.me.name, byId: c, scores };
        this.pub(`room/${this.room.code}/info`, this.newRoundInfo({ epoch: this.now() + 3000, prevEnd }), true);
        break;
      }
    }
  }
}

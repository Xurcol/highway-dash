// Highway Dash server: static files + WebSocket for accounts, friends, parties and leaderboards.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const THREE_DIR = path.join(ROOT, "node_modules", "three");
const DATA_FILE = path.join(ROOT, "data", "db.json");
const MAX_ROOM = 8;

// ---------- persistence ----------
let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DATA_FILE);
  }, 500);
}
const byToken = new Map(), byCode = new Map();
for (const u of Object.values(db.users)) { byToken.set(u.token, u); byCode.set(u.code, u); }

// The price tables are shared with the client rather than duplicated here, so there is exactly one
// place to change a price. When this server is running it owns the wallet: the client may ask to
// buy something, but only the ledger below decides whether it can afford it.
let ECONOMY = null;
import("./public/js/economy.js").then((m) => (ECONOMY = m)).catch((e) => console.warn("economy tables unavailable:", e.message));
const priceOf = (kind, id) => {
  if (!ECONOMY) return null;
  if (kind === "car") return ECONOMY.CAR_PRICES[id] ?? null;
  if (kind === "ecu") return ECONOMY.TUNING_PRICES.ecu;
  if (kind === "session") return ECONOMY.TUNING_PRICES.session;
  if (kind === "paint") return ECONOMY.COSMETIC_PRICES.paint;
  if (kind === "hearts") return { 1: 150, 5: 650, 15: 1800, 50: 5500 }[id] ?? null;
  return ECONOMY.PART_PRICES[kind]?.[id] ?? null;
};
const wallet = (ws, u, extra = {}) => send(ws, { t: "wallet", coins: u.coins | 0, ...extra });

const rid = (n) => crypto.randomBytes(n).toString("hex");
function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c;
  do { c = Array.from({ length: 6 }, () => A[crypto.randomInt(A.length)]).join(""); } while (byCode.has(c));
  return c;
}
const cleanCar = (s) => String(s || "").replace(/[^a-z0-9]/g, "").slice(0, 24);
const cleanName = (s) => String(s || "").replace(/[^\w .\-]/g, "").trim().slice(0, 16) || "Driver";

// ---------- static ----------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".jpg": "image/jpeg", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  let base = PUBLIC;
  if (url.startsWith("/vendor/three/")) { base = THREE_DIR; url = url.slice("/vendor/three".length); }
  if (url === "/") url = "/index.html";
  const file = path.normalize(path.join(base, url));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
});

// ---------- realtime ----------
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 8192 });
const online = new Map(); // userId -> ws
const rooms = new Map();  // code -> {code, seed, epoch, members:Set<userId>, public}

const send = (ws, m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
const toUser = (id, m) => send(online.get(id), m);

function friendView(u) {
  const ws = online.get(u.id);
  return { id: u.id, name: u.name, code: u.code, best: u.best || 0, online: !!ws, room: ws && ws.room ? ws.room : null };
}
function pushSocial(u) {
  toUser(u.id, {
    t: "social",
    friends: u.friends.map((f) => db.users[f]).filter(Boolean).map(friendView),
    incoming: u.incoming.map((f) => db.users[f]).filter(Boolean).map((x) => ({ id: x.id, name: x.name, code: x.code })),
  });
}
const notifyFriends = (u) => u.friends.forEach((f) => db.users[f] && pushSocial(db.users[f]));

function roomInfo(r) {
  return { t: "room", code: r.code, seed: r.seed, epoch: r.epoch, round: r.round, roundState: r.roundState, public: r.public, traffic: r.traffic,
    players: [...r.members].map((id) => ({ id, name: db.users[id].name, car: online.get(id)?.car || "" })) };
}
function leaveRoom(ws) {
  const r = rooms.get(ws.room);
  ws.room = null;
  if (!r) return;
  r.members.delete(ws.user.id);
  if (!r.members.size) { clearTimeout(r.timer); rooms.delete(r.code); }
  else r.members.forEach((id) => toUser(id, roomInfo(r)));
}
function joinRoom(ws, r) {
  if (ws.room === r.code) return send(ws, roomInfo(r));
  if (r.members.size >= MAX_ROOM) return send(ws, { t: "error", msg: "That party is full" });
  if (ws.room) leaveRoom(ws);
  r.members.add(ws.user.id);
  ws.room = r.code;
  r.members.forEach((id) => toUser(id, roomInfo(r)));
  notifyFriends(ws.user);
}
const LEVELS = ["Chill", "Normal", "Heavy", "Insane"];
// ---- party rounds: everyone starts together on the same seed; the first crash ends the round for all ----
const COUNTDOWN = 3000, RESULTS = 0;
function startRound(r, delay = COUNTDOWN) {
  clearTimeout(r.timer);
  r.round++;
  r.seed = crypto.randomInt(1, 2 ** 31);
  r.epoch = Date.now() + delay;
  r.roundState = "countdown";
  const round = r.round;
  r.timer = setTimeout(() => { if (rooms.get(r.code) === r && r.round === round) { r.roundState = "running"; } }, delay);
  r.members.forEach((id) => { const w = online.get(id); if (w) w.lastScore = 0; toUser(id, roomInfo(r)); });
}
function endRound(r, crasher) {
  if (r.roundState !== "running") return;
  r.roundState = "ended";
  const scores = [...r.members].map((id) => ({ id, name: db.users[id].name, score: online.get(id)?.lastScore || 0 })).sort((a, b) => b.score - a.score);
  r.members.forEach((id) => toUser(id, { t: "roundEnd", round: r.round, by: crasher.name, byId: crasher.id, scores }));
  clearTimeout(r.timer);
  r.timer = setTimeout(() => { if (rooms.get(r.code) === r && r.members.size) startRound(r); }, RESULTS);
}
function makeRoom(isPublic, traffic) {
  let code;
  do { code = String(crypto.randomInt(100000, 999999)); } while (rooms.has(code));
  const r = { code, seed: crypto.randomInt(1, 2 ** 31), epoch: Date.now(), round: 0, roundState: "lobby", members: new Set(), public: isPublic, traffic: LEVELS.includes(traffic) ? traffic : "Heavy" };
  rooms.set(code, r);
  return r;
}
function leaderboard(u) {
  const all = Object.values(db.users).filter((x) => x.best > 0).sort((a, b) => b.best - a.best);
  const row = (x) => ({ name: x.name, best: x.best, level: x.level || 1, me: x.id === u.id });
  const rank = all.findIndex((x) => x.id === u.id);
  const friends = [u, ...u.friends.map((f) => db.users[f]).filter(Boolean)].sort((a, b) => (b.best || 0) - (a.best || 0));
  return { t: "leaderboard", top: all.slice(0, 200).map(row), rank: rank < 0 ? null : rank + 1, friends: friends.map(row) };
}

wss.on("connection", (ws) => {
  ws.rate = 0;
  const rateTimer = setInterval(() => (ws.rate = 0), 1000);
  ws.on("close", () => {
    clearInterval(rateTimer);
    if (!ws.user) return;
    if (ws.room) leaveRoom(ws);
    if (online.get(ws.user.id) === ws) online.delete(ws.user.id);
    notifyFriends(ws.user);
  });
  ws.on("message", (raw) => {
    if (++ws.rate > 60) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.t === "ping") return send(ws, { t: "pong", c: m.c, s: Date.now() });

    if (m.t === "hello") {
      let u = byToken.get(m.token);
      if (!u) {
        u = { id: rid(8), token: rid(24), code: newCode(), name: cleanName(m.name), friends: [], incoming: [], best: 0, level: 1, coins: 1500 };
        db.users[u.id] = u; byToken.set(u.token, u); byCode.set(u.code, u); save();
      }
      const prev = online.get(u.id);
      if (prev && prev !== ws) { send(prev, { t: "error", msg: "Signed in from another tab" }); prev.close(); }
      ws.user = u; ws.car = cleanCar(m.car); online.set(u.id, ws);
      if (u.coins === undefined) u.coins = 1500;
      send(ws, { t: "welcome", id: u.id, token: u.token, code: u.code, name: u.name, best: u.best, coins: u.coins, s: Date.now() });
      pushSocial(u); notifyFriends(u);
      return;
    }
    const u = ws.user;
    if (!u) return;

    switch (m.t) {
      case "setName": u.name = cleanName(m.name); save(); send(ws, { t: "name", name: u.name }); notifyFriends(u); break;
      case "setCar": ws.car = cleanCar(m.car); if (ws.room) rooms.get(ws.room).members.forEach((id) => toUser(id, roomInfo(rooms.get(ws.room)))); break;
      case "friendAdd": {
        const other = byCode.get(String(m.code || "").toUpperCase().trim());
        if (!other || other.id === u.id) return send(ws, { t: "error", msg: "No driver with that code" });
        if (u.friends.includes(other.id)) return send(ws, { t: "error", msg: "Already friends" });
        if (u.incoming.includes(other.id)) { // they already asked us: accept
          u.incoming = u.incoming.filter((x) => x !== other.id);
          u.friends.push(other.id); other.friends.push(u.id);
        } else if (!other.incoming.includes(u.id)) other.incoming.push(u.id);
        save(); pushSocial(u); pushSocial(other);
        send(ws, { t: "toast", msg: other.friends.includes(u.id) ? `You and ${other.name} are now friends` : `Friend request sent to ${other.name}` });
        toUser(other.id, { t: "toast", msg: `${u.name} sent you a friend request` });
        break;
      }
      case "friendAccept": case "friendDecline": {
        const other = db.users[m.id];
        if (!other || !u.incoming.includes(other.id)) return;
        u.incoming = u.incoming.filter((x) => x !== other.id);
        if (m.t === "friendAccept") { u.friends.push(other.id); other.friends.push(u.id); toUser(other.id, { t: "toast", msg: `${u.name} accepted your request` }); }
        save(); pushSocial(u); pushSocial(other);
        break;
      }
      case "friendRemove": {
        const other = db.users[m.id];
        if (!other) return;
        u.friends = u.friends.filter((x) => x !== other.id);
        other.friends = other.friends.filter((x) => x !== u.id);
        save(); pushSocial(u); pushSocial(other);
        break;
      }
      case "roomCreate": joinRoom(ws, makeRoom(false, m.traffic)); break;
      case "quickPlay": {
        const r = [...rooms.values()].find((x) => x.public && x.members.size < MAX_ROOM) || makeRoom(true, "Heavy");
        joinRoom(ws, r);
        break;
      }
      case "roomJoin": {
        const r = rooms.get(String(m.code || "").trim());
        if (!r) return send(ws, { t: "error", msg: "Party not found" });
        joinRoom(ws, r);
        break;
      }
      case "joinFriend": {
        const f = online.get(m.id);
        if (!u.friends.includes(m.id) || !f || !f.room) return send(ws, { t: "error", msg: "Friend isn't in a party" });
        joinRoom(ws, rooms.get(f.room));
        break;
      }
      case "invite": {
        if (!u.friends.includes(m.id) || !ws.room) return;
        toUser(m.id, { t: "invite", from: u.name, fromId: u.id, room: ws.room });
        send(ws, { t: "toast", msg: "Invite sent" });
        break;
      }
      case "roomLeave": if (ws.room) { leaveRoom(ws); notifyFriends(u); send(ws, { t: "roomLeft" }); } break;
      case "state": {
        const r = rooms.get(ws.room);
        if (!r || typeof m.s !== "object") return;
        if (typeof m.s.sc === "number") ws.lastScore = Math.max(0, Math.floor(m.s.sc));
        const msg = JSON.stringify({ t: "state", id: u.id, s: m.s });
        r.members.forEach((id) => { if (id !== u.id) { const o = online.get(id); o && o.readyState === 1 && o.send(msg); } });
        break;
      }
      case "chat": {
        const r = rooms.get(ws.room);
        const text = String(m.text || "").slice(0, 120).trim();
        if (!r || !text) return;
        r.members.forEach((id) => toUser(id, { t: "chat", name: u.name, text }));
        break;
      }
      case "startRound": {
        const r = rooms.get(ws.room);
        if (r && (r.roundState === "lobby" || r.roundState === "running" && m.force)) startRound(r);
        else if (r) send(ws, roomInfo(r));
        break;
      }
      case "crash": {
        const r = rooms.get(ws.room);
        if (!r || m.round !== r.round) return;
        ws.lastScore = Math.max(ws.lastScore || 0, Math.floor(Number(m.score) || 0));
        endRound(r, u);
        break;
      }
      case "event": { // close calls, crashes: shown to party
        const r = rooms.get(ws.room);
        if (!r) return;
        r.members.forEach((id) => id !== u.id && toUser(id, { t: "event", id: u.id, name: u.name, kind: String(m.kind).slice(0, 20), v: m.v | 0, d: m.d === undefined ? undefined : String(m.d).slice(0, 48) }));
        break;
      }
      case "score": {
        const s = Math.floor(Number(m.score) || 0);
        if (s > 0 && s < 1e8 && s > (u.best || 0)) { u.best = s; save(); notifyFriends(u); }
        if (m.level) u.level = Math.max(1, Math.min(999, m.level | 0));
        send(ws, leaderboard(u));
        break;
      }
      case "leaderboard": send(ws, leaderboard(u)); break;
      // ---- wallet: this server is the authority while it is connected ----
      case "wallet": wallet(ws, u); break;
      case "buy": {
        const price = priceOf(String(m.kind || ""), String(m.id || ""));
        if (price === null) return wallet(ws, u, { denied: true, reason: "unknown item" });
        if ((u.coins | 0) < price) return wallet(ws, u, { denied: true, reason: "not enough coins", need: price - (u.coins | 0) });
        u.coins = (u.coins | 0) - price;
        save();
        wallet(ws, u, { bought: `${m.kind}:${m.id}` });
        break;
      }
      case "runEnd": {
        // the server pays out from the same table the client shows, with sane caps
        if (!ECONOMY) return;
        const r = m.run || {};
        const run = {
          score: Math.max(0, Math.min(1e7, Math.floor(r.score) || 0)),
          closeCalls: Math.max(0, Math.min(5000, r.closeCalls | 0)),
          distance: Math.max(0, Math.min(1e6, +r.distance || 0)),
          bestCombo: Math.max(0, Math.min(500, r.bestCombo | 0)),
          newBest: !!r.newBest, newMedals: Math.max(0, Math.min(8, r.newMedals | 0)),
          levelUps: Math.max(0, Math.min(20, r.levelUps | 0)), survivor: !!r.survivor, partyWin: !!r.partyWin,
        };
        const now = Date.now();
        if (now - (u.lastPayout || 0) < 3000) return wallet(ws, u); // no payout spamming
        u.lastPayout = now;
        u.coins = (u.coins | 0) + ECONOMY.runReward(run).coins;
        save();
        wallet(ws, u);
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Highway Dash running:  http://localhost:${PORT}`);
  const nets = require("os").networkInterfaces();
  for (const list of Object.values(nets)) for (const n of list) if (n.family === "IPv4" && !n.internal) console.log(`  on your network:      http://${n.address}:${PORT}`);
});

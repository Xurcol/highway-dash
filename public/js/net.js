// WebSocket client: identity, friends, parties, player state relay, clock sync.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};
export { store };

// Multiplayer transport: the public relay (no server needed, works on static hosting) unless the page
// is served by this project's own Node server and asks for it with ?server=1.
export async function createNet() {
  if (new URLSearchParams(location.search).has("server")) return new Net();
  const { RelayNet } = await import("./net-relay.js");
  RelayNet.prototype.sample = Net.prototype.sample;
  const n = new RelayNet();
  n.sendRate = 10;
  return n;
}

export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null; this.connected = false;
    this.me = null; this.room = null;
    this.friends = []; this.incoming = [];
    this.offset = 0; this.bestRtt = Infinity;
    this.peers = new Map(); // id -> {name, car, buf:[{T, s}]}
    this.retry = 1000;
  }
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  now() { return Date.now() + this.offset; }

  connect(name, car) {
    if (location.protocol === "file:") return;
    this.pendingName = name; this.pendingCar = car;
    const ws = (this.ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`));
    ws.onopen = () => {
      this.connected = true; this.retry = 1000;
      this.send({ t: "hello", token: store.get("hd_token", null), name: this.pendingName, car: this.pendingCar });
      this.bestRtt = Infinity;
      for (let i = 0; i < 6; i++) setTimeout(() => this.send({ t: "ping", c: performance.now() }), 200 + i * 250);
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: "ping", c: performance.now() }), 10000);
    };
    ws.onclose = () => {
      this.connected = false; this.room = null; this.peers.clear();
      clearInterval(this.pingTimer);
      this.emit("status");
      setTimeout(() => this.connect(this.pendingName, this.pendingCar), this.retry);
      this.retry = Math.min(15000, this.retry * 1.6);
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data));
  }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  onMessage(m) {
    switch (m.t) {
      case "pong": {
        const rtt = performance.now() - m.c;
        if (rtt < this.bestRtt) { this.bestRtt = rtt; this.offset = m.s + rtt / 2 - Date.now(); }
        break;
      }
      case "welcome":
        store.set("hd_token", m.token);
        this.me = { id: m.id, code: m.code, name: m.name, best: m.best };
        this.emit("status");
        break;
      case "name": if (this.me) this.me.name = m.name; this.emit("status"); break;
      case "social": this.friends = m.friends; this.incoming = m.incoming; this.emit("social"); break;
      case "room": {
        const fresh = !this.room || this.room.code !== m.code;
        this.room = m;
        const ids = new Set(m.players.map((p) => p.id));
        for (const id of this.peers.keys()) if (!ids.has(id)) { this.emit("peerLeft", id); this.peers.delete(id); }
        for (const p of m.players) {
          if (p.id === this.me?.id) continue;
          const peer = this.peers.get(p.id) || { buf: [] };
          peer.name = p.name; peer.car = p.car;
          this.peers.set(p.id, peer);
        }
        this.emit("room", { fresh });
        break;
      }
      case "roomLeft": this.room = null; for (const id of this.peers.keys()) this.emit("peerLeft", id); this.peers.clear(); this.emit("room", { fresh: true }); break;
      case "state": {
        const peer = this.peers.get(m.id);
        if (!peer) return;
        peer.buf.push(m.s);
        if (peer.buf.length > 30) peer.buf.shift();
        peer.last = performance.now();
        break;
      }
      default: this.emit(m.t, m);
    }
  }

  // interpolated remote state at shared time T (seconds)
  sample(peer, T) {
    const b = peer.buf;
    if (!b.length) return null;
    if (T <= b[0].T) return b[0];
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].T <= T) {
        const a = b[i], c = b[i + 1];
        if (!c) { // extrapolate a little
          const dt = Math.min(.25, T - a.T);
          return { ...a, z: a.z - a.v * dt };
        }
        const k = (T - a.T) / Math.max(1e-3, c.T - a.T);
        const out = { ...c };
        for (const f of ["x", "z", "ry", "v", "rpm", "thr", "roll", "pitch", "y"]) if (typeof a[f] === "number") out[f] = a[f] + (c[f] - a[f]) * k;
        return out;
      }
    }
    return b[0];
  }
}

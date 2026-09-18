// WebSocket client: identity, friends, parties, player state relay, clock sync.
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
};
export { store };

// How remote cars are rendered. Tunable at runtime through window.__game.NET.
export const NET = {
  sendRate: 20,      // state packets per second we publish
  minDelay: .08,     // s - never render a remote car less than this far in the past
  maxDelay: .45,     // s - cap, so a terrible connection doesn't drag cars minutes behind
  extrapolate: .35,  // s - how long we dead-reckon when packets stop arriving
  errorDecay: 6,     // 1/s - how fast a visual correction is absorbed (lower = smoother, laggier)
  snap: 45,          // m - beyond this we teleport instead of sliding
};

// Insert a remote state keeping the buffer ordered by round time; a new round clears it.
// Also tracks the packet spacing, which sets how big an interpolation buffer this peer needs.
export function pushState(peer, m) {
  const b = peer.buf;
  if (b.length && b[b.length - 1].rd !== m.rd) { b.length = 0; peer.gap = 0; peer.jit = 0; peer.behind = 0; }
  let j = b.length;
  while (j > 0 && b[j - 1].T > m.T) j--;
  if (j > 0 && b[j - 1].T === m.T) return;
  const prev = b[b.length - 1];
  if (prev && m.T > prev.T) {
    const g = Math.min(1, m.T - prev.T);
    peer.gap = peer.gap ? peer.gap + (g - peer.gap) * .15 : g;
    peer.jit = (peer.jit || 0) + (Math.abs(g - peer.gap) - (peer.jit || 0)) * .2;
  }
  b.splice(j, 0, m);
  if (b.length > 60) b.shift();
}

// Remote car state at round time T. Between updates: cubic Hermite on position using the reported
// velocities (no corners at each packet). Past the newest update: dead-reckon forward so the car is
// drawn where it is now, not where it was ~150 ms ago.
export function sampleState(peer, T) {
  const b = peer.buf;
  if (!b.length) return null;
  if (T <= b[0].T) return { ...b[0] };
  let i = b.length - 1;
  while (i > 0 && b[i].T > T) i--;
  const a = b[i], c = b[i + 1];
  if (c) {
    const span = Math.max(1e-3, c.T - a.T), k = (T - a.T) / span, k2 = k * k, k3 = k2 * k;
    const h = (p0, p1, v0, v1) => (2 * k3 - 3 * k2 + 1) * p0 + (k3 - 2 * k2 + k) * span * v0 + (-2 * k3 + 3 * k2) * p1 + (k3 - k2) * span * v1;
    const out = { ...c };
    out.z = a.cr || c.cr ? a.z + (c.z - a.z) * k : h(a.z, c.z, -a.v, -c.v);
    out.x = a.cr || c.cr ? a.x + (c.x - a.x) * k : h(a.x, c.x, a.vx || 0, c.vx || 0);
    for (const f of ["ry", "v", "vx", "rpm", "thr", "roll", "pitch", "y"]) if (typeof a[f] === "number" && typeof c[f] === "number") out[f] = a[f] + (c[f] - a[f]) * k;
    return out;
  }
  const dt = Math.min(NET.extrapolate, T - a.T), out = { ...a };
  if (!a.cr) {
    out.z = a.z - a.v * dt;
    out.x = a.x + (a.vx || 0) * dt * Math.max(0, 1 - dt * 1.5);
  }
  out.stale = T - a.T;
  return out;
}

// One remote car's view of another player.
//
// Instead of drawing the newest packet the moment it lands (which is what made remote cars look like
// they ran at 10 fps), we draw every peer a little way in the PAST - far enough back that there is
// almost always a snapshot on each side of the render time, so the car is interpolated along a
// continuous curve at our own frame rate. The delay adapts to that peer's measured packet spacing,
// jitter and latency. When packets genuinely stop arriving we dead-reckon from the last known
// velocity, and when a late packet then contradicts the guess, the difference is absorbed smoothly
// (err decays away) instead of teleporting the car.
export class RemoteView {
  constructor() { this.delay = .15; this.ex = 0; this.ez = 0; this.disp = null; this.yaw = 0; this.roll = 0; this.pitch = 0; }
  update(peer, T, dt) {
    const b = peer.buf;
    if (!b.length) return null;
    const newest = b[b.length - 1];
    // how far behind "now" the newest snapshot is, as a decaying maximum over the last ~2 s
    const behindNow = Math.max(0, T - newest.T);
    peer.behind = Math.max(behindNow, (peer.behind || 0) - dt * .35);
    const want = Math.min(NET.maxDelay, Math.max(NET.minDelay, peer.behind + (peer.gap || 1 / NET.sendRate) * .75 + (peer.jit || 0) * 2));
    // move the render clock gently: grow fast (avoid starving), shrink slowly (avoid time warps)
    this.delay += (want - this.delay) * Math.min(1, dt * (want > this.delay ? 6 : .7));
    const s = sampleState(peer, T - this.delay);
    if (!s) return null;
    if (!this.disp) { this.disp = { x: s.x, z: s.z }; this.ex = this.ez = 0; this.yaw = s.ry || 0; }
    // Only a DISCONTINUITY is corrected. While the interpolated target moves the way its own
    // velocity says it should, the error stays where it is, so there is no steady-state lag; when a
    // late packet contradicts a dead-reckoned guess, that unexplained jump is absorbed and decays.
    const excessX = (s.x - this.disp.x) - (s.vx || 0) * dt;
    const excessZ = (s.z - this.disp.z) + (s.v || 0) * dt;
    this.disp.x = s.x; this.disp.z = s.z;
    if (Math.abs(excessZ) > NET.snap || Math.abs(excessX) > 12) this.ex = this.ez = 0; // respawn / new round
    else {
      this.ex = Math.max(-12, Math.min(12, this.ex - excessX));
      this.ez = Math.max(-NET.snap, Math.min(NET.snap, this.ez - excessZ));
      const k = Math.exp(-dt * NET.errorDecay);
      this.ex *= k; this.ez *= k;
    }
    const yawK = Math.min(1, dt * 14);
    this.yaw += ((s.ry || 0) - this.yaw) * yawK;
    this.pitch += ((s.pitch || 0) - this.pitch) * yawK;
    this.roll += ((s.roll || 0) - this.roll) * yawK;
    return { ...s, x: s.x + this.ex, z: s.z + this.ez, ry: this.yaw, pitch: this.pitch, roll: this.roll, delay: this.delay };
  }
}

// Multiplayer transport: the public relay (no server needed, works on static hosting) unless the page
// is served by this project's own Node server and asks for it with ?server=1.
export async function createNet() {
  if (new URLSearchParams(location.search).has("server")) { const n = new Net(); n.sendRate = NET.sendRate; return n; }
  const { RelayNet } = await import("./net-relay.js?v=mu6adgwj");
  const n = new RelayNet();
  n.sendRate = NET.sendRate;
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
        pushState(peer, m.s);
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

// User-selected YouTube tracks stay in visible official players; no audio is copied to the site.
const TRACKS = { lobby: "lFWRS4Hfuew", game: "-7Vj7RQF7xk" };
let apiPromise;
function youtubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => { apiPromise = null; reject(new Error("YouTube did not load. Check your connection and press Play.")); }, 15000);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); previous?.(); resolve(window.YT); };
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => { clearTimeout(timer); script.remove(); apiPromise = null; reject(new Error("YouTube is blocked or offline. Press Play to retry.")); };
    document.head.appendChild(script);
  });
  return apiPromise;
}
export class GameMusic {
  constructor(settings, save, mode) {
    this.settings = settings; this.save = save; this.mode = mode; this.slots = [];
    this.enabled = false; this.loading = false; this.intent = null; this.last = 0;
    this.el = document.createElement("aside"); this.el.className = "arc-music"; this.el.hidden = true;
    this.el.setAttribute("aria-label", "YouTube game music");
    this.el.innerHTML = '<header><b>MUSIC</b><button type="button" data-music="play">Play</button><button type="button" data-music="off">Off</button></header><p role="status">Loading music…</p><div class="arc-music-players"></div>';
    document.body.appendChild(this.el); this.status = this.el.querySelector("p");
    this.el.querySelector('[data-music="play"]').onclick = () => this.gesture(true);
    this.el.querySelector('[data-music="off"]').onclick = () => {
      this.settings.music = false; this.save(); this.configure();
      const toggle = document.querySelector('[data-arc-setting="music"]'); if (toggle) toggle.checked = false;
    };
  }
  configure() {
    this.enabled = !!this.settings.music;
    if (!this.enabled) { this.suspend(); this.el.hidden = true; }
    else { this.el.hidden = false; this.gesture(); }
  }
  async gesture(retry = false) {
    if (!this.enabled || document.hidden) return;
    if (retry) { this.intent = null; for (const s of this.slots) { s.failed = false; s.requested = false; } }
    if (!this.slots.length && !this.loading) {
      this.loading = true;
      try {
        const YT = await youtubeAPI();
        for (const name of Object.keys(TRACKS)) {
          const host = document.createElement("div"), mount = document.createElement("div");
          host.hidden = name !== this.mode(); host.appendChild(mount); this.el.querySelector(".arc-music-players").appendChild(host);
          const slot = {name, host, ready:false, gain:0, playing:false, failed:false, requested:false, random:false, volume:-1};
          this.slots.push(slot);
          slot.player = new YT.Player(mount, { width: 240, height: 200, videoId: TRACKS[name],
            playerVars: { playsinline:1, controls:1, origin:location.origin, rel:0 },
            events: {
              onReady: e => { slot.ready = true; e.target.setVolume(0); if (this.enabled && !document.hidden) this.start(slot); },
              onStateChange: e => {
                slot.playing = e.data === 1;
                if (slot.playing) {
                  if (!this.enabled || document.hidden) { slot.player.pauseVideo(); return; }
                  if (slot.random) this.randomize(slot);
                  if (slot.name === this.mode()) this.status.textContent = slot.name === "game" ? "Gameplay soundtrack" : "Lobby soundtrack";
                }
                if (e.data === 0 && this.enabled && !document.hidden && slot.name === this.mode()) { slot.player.seekTo(0, true); slot.player.playVideo(); }
              },
              onAutoplayBlocked: () => { this.status.textContent = "Press Play here or in the video to start music."; },
              onError: () => { slot.failed = true; slot.playing = false; slot.gain = 0; this.status.textContent = "This video cannot play here. Try Play, or turn music off."; }
            }
          });
        }
      } catch (e) { this.status.textContent = e.message; }
      finally { this.loading = false; }
    }
    for (const s of this.slots) if (s.ready && s.name === this.mode() && !s.failed) this.start(s);
  }
  randomize(s) {
    const duration = s.player.getDuration();
    if (Number.isFinite(duration) && duration > 1) {
      s.random = false;
      // Leave room before the end so a fresh entry doesn't immediately loop.
      s.player.seekTo(Math.random() * Math.max(0, duration - Math.min(30, duration * .2)), true);
    }
  }
  start(s) {
    if (!s.ready || s.failed || s.requested || s.name !== this.mode() || !this.enabled || document.hidden) return;
    s.host.hidden = false; s.requested = true; s.random = s.name === "game";
    s.player.unMute(); s.player.playVideo();
    if (s.random) this.randomize(s);
  }
  suspend() {
    this.intent = null;
    for (const s of this.slots) {
      if (s.ready) { s.player.setVolume(0); s.player.pauseVideo(); }
      s.gain = 0; s.volume = 0; s.playing = false; s.requested = false;
    }
  }
  update(now) {
    if (now - this.last < 80) return;
    const dt = Math.min(.2, (now - this.last) / 1000); this.last = now;
    if (!this.enabled || document.hidden || !this.slots.length) return;
    const mode = this.mode();
    if (this.intent !== mode) {
      this.intent = mode;
      for (const s of this.slots) if (s.name === mode) { s.requested = false; this.start(s); }
    }
    const incoming = this.slots.find(s => s.name === mode);
    if (incoming?.random && incoming.ready) this.randomize(incoming);
    const volume = Math.max(0, Math.min(1, Number(this.settings.volMusic) || 0)) * Math.max(0, Math.min(1, Number(this.settings.volMaster) || 0));
    for (const s of this.slots) {
      if (!s.ready) continue;
      // Keep the old track audible while the next one buffers; crossfade over 2.5 seconds.
      const target = s.name === mode ? (s.playing ? 1 : 0) : incoming?.playing ? 0 : s.gain;
      s.gain += Math.max(-dt / 2.5, Math.min(dt / 2.5, target - s.gain));
      const next = Math.round(Math.sin(s.gain * Math.PI / 2) * volume * 100);
      if (next !== s.volume) { s.volume = next; s.player.setVolume(next); }
      if (s.name !== mode && s.gain === 0) { if (s.requested) s.player.pauseVideo(); s.requested = false; s.host.hidden = true; }
      else s.host.hidden = false;
    }
  }
}

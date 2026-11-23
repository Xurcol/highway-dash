// In-game music player.
//
// What a browser can and cannot do here, honestly: there is NO web API that reads what Spotify,
// Apple Music or the OS is playing. The Media Session API only works the other way round - a page
// publishes what IT is playing so the OS, keyboard media keys and the browser's own media widget can
// control it. So this plays audio files the player adds, reads their real ID3 tags (title, artist,
// album, cover art), and registers with Media Session so the hardware media keys drive it. Nothing
// is faked: controls that the platform can't back are not shown.
const ID3_FRAMES = { TIT2: "title", TPE1: "artist", TALB: "album", TIT1: "title", TPE2: "artist" };

function readSyncSafe(v, o) { return (v[o] << 21) | (v[o + 1] << 14) | (v[o + 2] << 7) | v[o + 3]; }
function decodeText(bytes) {
  const enc = bytes[0];
  const body = bytes.subarray(1);
  try {
    if (enc === 1 || enc === 2) return new TextDecoder(enc === 1 ? "utf-16" : "utf-16be").decode(body).replace(/\0+$/, "");
    return new TextDecoder(enc === 3 ? "utf-8" : "iso-8859-1").decode(body).replace(/\0+$/, "");
  } catch { return ""; }
}
// Minimal ID3v2.3/2.4 reader: enough for the tags a music player actually shows.
export async function readTags(file) {
  const out = { title: file.name.replace(/\.[^.]+$/, ""), artist: "", album: "", art: null };
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (String.fromCharCode(head[0], head[1], head[2]) !== "ID3") return out;
    const size = readSyncSafe(head, 6);
    const buf = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
    let o = 0;
    while (o + 10 < buf.length) {
      const id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const v4 = head[3] >= 4;
      const len = v4 ? readSyncSafe(buf, o + 4) : (buf[o + 4] << 24) | (buf[o + 5] << 16) | (buf[o + 6] << 8) | buf[o + 7];
      const data = buf.subarray(o + 10, o + 10 + len);
      if (ID3_FRAMES[id] && len > 1) out[ID3_FRAMES[id]] = decodeText(data) || out[ID3_FRAMES[id]];
      if (id === "APIC" && len > 10) {
        let p = 1;
        while (p < data.length && data[p] !== 0) p++;       // mime type
        const mime = new TextDecoder().decode(data.subarray(1, p));
        p += 2;                                              // null + picture type
        while (p < data.length && data[p] !== 0) p++;        // description
        p++;
        if (p < data.length) out.art = new Blob([data.subarray(p)], { type: mime || "image/jpeg" });
      }
      o += 10 + len;
      if (len <= 0) break;
    }
  } catch { /* not a tagged file: filename it is */ }
  return out;
}

// ---------- streamed tracks: Spotify and YouTube links ----------
// A link can't be turned into an audio file in the browser (and pulling audio out of YouTube is
// against its terms), so a pasted link plays through the service's own official embedded player,
// driven from here: play, pause, next, seek, progress and end-of-track all work from the game's
// controls. The player stays visible while it's in use (YouTube requires a 200x200 player). Spotify
// plays full songs when you're logged in to Spotify in this browser and 30-second previews when not.
// Neither can be routed through the game's acoustics - their audio never reaches this page.

// Recognises a Spotify or YouTube link (or a spotify: URI). Returns null for anything else.
export function parseLink(text) {
  const s = String(text || "").trim();
  let m = s.match(/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(track|album|playlist|episode|show)\/([A-Za-z0-9]{10,})/i)
    || s.match(/^spotify:(track|album|playlist|episode|show):([A-Za-z0-9]{10,})$/i);
  if (m) {
    const type = m[1].toLowerCase();
    return { kind: "spotify", type, id: m[2], uri: `spotify:${type}:${m[2]}`, url: `https://open.spotify.com/${type}/${m[2]}` };
  }
  let u;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s); } catch { return null; }
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (!/^(youtube\.com|music\.youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) return null;
  m = host === "youtu.be" ? u.pathname.match(/^\/([\w-]{11})/) : u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
  const v = u.searchParams.get("v"), id = m ? m[1] : v && /^[\w-]{11}$/.test(v) ? v : null, list = u.searchParams.get("list");
  if (!id && !list) return null;
  const start = parseInt(u.searchParams.get("t") || u.searchParams.get("start") || "0", 10) || 0;
  return id ? { kind: "youtube", id, start, url: `https://www.youtube.com/watch?v=${id}` } : { kind: "youtube", list, url: `https://www.youtube.com/playlist?list=${list}` };
}
// Title, artist and cover from the service's public oEmbed (both allow calls from any page).
async function linkMeta(link) {
  const q = encodeURIComponent(link.url);
  const api = link.kind === "spotify" ? `https://open.spotify.com/oembed?url=${q}` : `https://www.youtube.com/oembed?format=json&url=${q}`;
  try {
    const r = await fetch(api);
    if (r.ok) { const j = await r.json(); if (j.title) return { title: j.title, artist: j.author_name || "", art: j.thumbnail_url || null }; }
  } catch { /* offline or blocked: fall back to a plain label */ }
  return {
    title: link.kind === "spotify" ? `Spotify ${link.type}` : link.id ? "YouTube video" : "YouTube playlist",
    artist: "", art: link.id ? `https://i.ytimg.com/vi/${link.id}/hqdefault.jpg` : null,
  };
}
// the services' player APIs, loaded the first time they're needed
function loadScript(src) {
  return new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = src; s.async = true; s.onerror = reject; s.onload = resolve; document.head.appendChild(s); });
}
let ytApi = null, spApi = null;
export const youtubeAPI = () => (ytApi ||= new Promise((resolve, reject) => {
  if (window.YT?.Player) return resolve(window.YT);
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
  loadScript("https://www.youtube.com/iframe_api").catch((e) => { ytApi = null; reject(e); });
}));
const spotifyAPI = () => (spApi ||= new Promise((resolve, reject) => {
  window.onSpotifyIframeApiReady = (api) => resolve(api);
  loadScript("https://open.spotify.com/embed/iframe-api/v1").catch((e) => { spApi = null; reject(e); });
}));
const YT_ERRORS = { 2: "That YouTube link isn't valid", 5: "YouTube couldn't play that video here", 100: "That YouTube video is gone or private", 101: "The owner doesn't allow that video to play outside YouTube", 150: "The owner doesn't allow that video to play outside YouTube" };
const LINKS_KEY = "hd_music_links";

export class MusicPlayer extends EventTarget {
  constructor() {
    super();
    this.tracks = [];
    this.index = -1;
    this.audio = new Audio();
    this.audio.preload = "metadata";
    this.audio.volume = 0.6;
    this.audio.addEventListener("ended", () => this.next());
    this.audio.addEventListener("play", () => this.emit("state"));
    this.audio.addEventListener("pause", () => this.emit("state"));
    this.audio.addEventListener("timeupdate", () => this.emit("time"));
    // streamed playback state (the file player keeps its own in the <audio> element)
    this.ext = { playing: false, time: 0, dur: 0 };
    this.yt = null; this.sp = null; this.spUri = ""; this.duck = 1;
    this.ytHost = null; this.spHost = null;           // set by the UI: where the embedded players go
    setInterval(() => { if (this.track?.kind === "youtube" && this.yt?.getCurrentTime) { this.ext.time = this.yt.getCurrentTime() || 0; this.ext.dur = this.yt.getDuration() || 0; this.emit("time"); } }, 500);
    this.restoreLinks();
    this.setupMediaSession();
  }
  emit(t, detail) { this.dispatchEvent(new CustomEvent(t, { detail })); }
  get track() { return this.tracks[this.index] || null; }
  // which embedded player is showing, if the current track is a link
  get dockKind() { const k = this.track?.kind; return k === "youtube" || k === "spotify" ? k : null; }
  get playing() { const t = this.track; return !!t && (t.kind === "file" ? !this.audio.paused : this.ext.playing); }
  get time() { return this.track?.kind === "file" || !this.track ? this.audio.currentTime : this.ext.time; }
  get duration() { return this.track?.kind === "file" || !this.track ? this.audio.duration : this.ext.dur; }
  get progress() { const d = this.duration; return d > 0 && isFinite(d) ? Math.min(1, this.time / d) : 0; }

  async add(files) {
    const added = [];
    for (const file of files) {
      if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|ogg|wav|flac|opus|aac)$/i.test(file.name)) continue;
      const tags = await readTags(file);
      added.push({ kind: "file", file, url: URL.createObjectURL(file), art: tags.art ? URL.createObjectURL(tags.art) : null, ...tags });
    }
    this.tracks.push(...added);
    this.emit("list");
    if (this.index < 0 && added.length) this.play(this.tracks.length - added.length);
    return added.length;
  }
  // A pasted Spotify or YouTube link. Resolves to the new track; throws a readable message if the
  // text isn't a link we can play.
  async addLink(text) {
    const link = parseLink(text);
    if (!link) throw new Error("Paste a Spotify or YouTube link");
    const dup = this.tracks.findIndex((t) => t.kind === link.kind && (t.id || t.list) === (link.id || link.list) && t.uri === link.uri);
    if (dup >= 0) { this.play(dup); return this.tracks[dup]; }
    const t = { ...link, ...(await linkMeta(link)) };
    this.tracks.push(t);
    this.saveLinks();
    this.emit("list");
    this.play(this.tracks.length - 1);
    return t;
  }
  play(i = this.index) {
    if (!this.tracks.length) return;
    const wrap = ((i % this.tracks.length) + this.tracks.length) % this.tracks.length, changed = wrap !== this.index;
    this.index = wrap;
    const t = this.track;
    this.onPlay?.();
    // only one source plays at a time
    if (t.kind !== "file") this.audio.pause();
    if (t.kind !== "youtube") this.yt?.pauseVideo?.();
    if (t.kind !== "spotify" && this.spUri) this.sp?.pause();
    if (t.kind !== "file") { this.ext.playing = false; this.ext.time = 0; this.ext.dur = 0; }
    if (t.kind === "file") { if (changed || this.audio.src !== t.url) this.audio.src = t.url; this.audio.play().catch(() => { }); }
    else if (t.kind === "youtube") this.playYouTube(t, changed);
    else this.playSpotify(t, changed);
    if (changed) this.emit("track");
    this.emit("dock");
    this.publish();
  }
  async playYouTube(t, changed) {
    let YT;
    try { YT = await youtubeAPI(); } catch { return this.emit("error", "YouTube's player couldn't load"); }
    if (this.track !== t || !this.ytHost) return;
    const load = () => {
      const c = this.track;
      if (c?.kind !== "youtube") return;
      if (c.id) this.yt.loadVideoById({ videoId: c.id, startSeconds: c.start || 0 });
      else this.yt.loadPlaylist({ list: c.list, listType: "playlist" });
      this.ytLoaded = c;
    };
    if (!this.yt) {
      this.yt = new YT.Player(this.ytHost, {
        width: 200, height: 200,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => { this.yt.ready = true; this.yt.setVolume(Math.round(this.audio.volume * 100 * this.duck)); load(); },
          onStateChange: (e) => {
            this.ext.playing = e.data === 1 || e.data === 3;
            if (e.data === 0 && this.track?.kind === "youtube") this.next();
            this.emit("state");
          },
          onError: (e) => { this.emit("error", YT_ERRORS[e.data] || "YouTube couldn't play that"); if (this.tracks.length > 1) setTimeout(() => this.next(), 1200); },
        },
      });
      return;
    }
    if (!this.yt.ready) return;                     // onReady will load whatever is current
    if (changed || this.ytLoaded !== t) load(); else this.yt.playVideo();
  }
  async playSpotify(t, changed) {
    let api;
    try { api = await spotifyAPI(); } catch { return this.emit("error", "Spotify's player couldn't load"); }
    if (this.track !== t || !this.spHost) return;
    if (!this.sp) {
      this.spUri = t.uri;
      api.createController(this.spHost, { uri: t.uri, width: "100%", height: 80 }, (ctl) => {
        this.sp = ctl;
        ctl.addListener("ready", () => { if (this.track?.kind === "spotify") ctl.play(); });
        ctl.addListener("playback_update", (e) => this.spotifyUpdate(e.data || {}));
      });
      return;
    }
    // a new track loads and starts; the same one carries on from where it was paused
    if (changed || this.spUri !== t.uri) { this.spUri = t.uri; this.spStarted = false; this.sp.loadUri(t.uri); this.sp.play(); }
    else this.sp.resume();
  }
  spotifyUpdate(d) {
    if (this.track?.kind !== "spotify") return;
    this.ext.playing = !d.isPaused;
    this.ext.time = (d.position || 0) / 1000; this.ext.dur = (d.duration || 0) / 1000;
    if (!d.isPaused && d.position > 0) this.spStarted = true;
    // a single track stops at its end (an album or playlist moves on by itself): go to the next one
    if (this.spStarted && d.isPaused && d.duration > 0 && d.position >= d.duration - 1200) { this.spStarted = false; this.next(); }
    this.emit("state"); this.emit("time");
  }
  pause() {
    const k = this.track?.kind;
    if (k === "file") this.audio.pause(); else if (k === "youtube") this.yt?.pauseVideo?.(); else if (k === "spotify") this.sp?.pause();
  }
  toggle() {
    const t = this.track;
    if (!t) return;
    if (t.kind === "file") return this.audio.paused ? this.play() : this.audio.pause();
    if (t.kind === "youtube") { if (!this.yt?.ready) return this.play(); return this.ext.playing ? this.yt.pauseVideo() : this.yt.playVideo(); }
    if (!this.sp) return this.play();
    this.onPlay?.();
    this.sp.togglePlay();
  }
  next() { if (this.tracks.length) this.play(this.index + 1); }
  prev() { if (this.time > 3) { this.seek(0); return; } if (this.tracks.length) this.play(this.index - 1); }
  seek(f) {
    const k = this.track?.kind, d = this.duration;
    if (!(d > 0) || !isFinite(d)) return;
    if (k === "youtube") this.yt?.seekTo?.(f * d, true);
    else if (k === "spotify") this.sp?.seek(f * d);
    else this.audio.currentTime = f * d;
  }
  // Spotify's player has no volume control; YouTube's follows the slider
  setVolume(v) {
    this.audio.volume = Math.max(0, Math.min(1, v));
    if (this.yt?.ready) this.yt.setVolume(Math.round(this.audio.volume * 100 * this.duck));
    this.emit("state");
  }
  // The game dips a streamed track behind the pause menu. Only YouTube's volume can be set from here.
  setDuck(k) {
    if (Math.abs(k - this.duck) < .01) return;
    this.duck = k;
    if (this.yt?.ready && this.track?.kind === "youtube") this.yt.setVolume(Math.round(this.audio.volume * 100 * k));
  }
  remove(i) {
    const t = this.tracks[i];
    if (!t) return;
    if (t.kind === "file") { URL.revokeObjectURL(t.url); if (t.art) URL.revokeObjectURL(t.art); }
    if (i === this.index) { this.pause(); this.ext.playing = false; }
    this.tracks.splice(i, 1);
    if (i === this.index) { this.index = -1; if (this.tracks.length) this.play(Math.min(i, this.tracks.length - 1)); }
    else if (i < this.index) this.index--;
    if (t.kind !== "file") this.saveLinks();
    this.emit("list"); this.emit("dock");
  }
  // links survive a reload (files can't: the browser only lends them for the session)
  saveLinks() {
    const keep = this.tracks.filter((t) => t.kind !== "file").map(({ kind, type, id, list, start, uri, url, title, artist, art }) => ({ kind, type, id, list, start, uri, url, title, artist, art }));
    try { localStorage.setItem(LINKS_KEY, JSON.stringify(keep)); } catch { /* storage full or blocked */ }
  }
  restoreLinks() {
    try {
      const saved = JSON.parse(localStorage.getItem(LINKS_KEY) || "[]");
      if (Array.isArray(saved)) this.tracks.push(...saved.filter((t) => t && (t.kind === "youtube" || t.kind === "spotify") && (t.id || t.list))
        .map((t) => (t.artist === "Spotify" || t.artist === "YouTube" ? { ...t, artist: "" } : t)));
    } catch { /* nothing saved */ }
  }
  // tell the OS what we're playing so the hardware media keys and the browser widget work
  setupMediaSession() {
    this.hasSession = "mediaSession" in navigator;
    if (!this.hasSession) return;
    const ms = navigator.mediaSession;
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* unsupported action */ } };
    set("play", () => this.play());
    set("pause", () => this.pause());
    set("nexttrack", () => this.next());
    set("previoustrack", () => this.prev());
    set("seekto", (d) => { if (d.seekTime != null && this.duration > 0) this.seek(d.seekTime / this.duration); });
  }
  publish() {
    if (!this.hasSession || !this.track) return;
    const t = this.track;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist || "Unknown artist", album: t.album || "",
      artwork: t.art ? [{ src: t.art, sizes: "512x512", type: "image/jpeg" }] : [],
    });
  }
}

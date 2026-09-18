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
    this.setupMediaSession();
  }
  emit(t) { this.dispatchEvent(new Event(t)); }
  get track() { return this.tracks[this.index] || null; }
  get playing() { return !this.audio.paused && !!this.track; }
  get progress() { return this.audio.duration ? this.audio.currentTime / this.audio.duration : 0; }

  async add(files) {
    const added = [];
    for (const file of files) {
      if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|ogg|wav|flac|opus|aac)$/i.test(file.name)) continue;
      const tags = await readTags(file);
      added.push({ file, url: URL.createObjectURL(file), art: tags.art ? URL.createObjectURL(tags.art) : null, ...tags });
    }
    this.tracks.push(...added);
    this.emit("list");
    if (this.index < 0 && added.length) this.play(this.tracks.length - added.length);
    return added.length;
  }
  play(i = this.index) {
    if (!this.tracks.length) return;
    const wrap = ((i % this.tracks.length) + this.tracks.length) % this.tracks.length;
    if (wrap !== this.index) { this.index = wrap; this.audio.src = this.track.url; this.emit("track"); }
    this.audio.play().catch(() => { });
    this.publish();
  }
  toggle() { if (!this.track) return; this.audio.paused ? this.play() : this.audio.pause(); }
  next() { if (this.tracks.length) this.play(this.index + 1); }
  prev() { if (this.audio.currentTime > 3) { this.audio.currentTime = 0; return; } if (this.tracks.length) this.play(this.index - 1); }
  seek(f) { if (this.audio.duration) this.audio.currentTime = f * this.audio.duration; }
  setVolume(v) { this.audio.volume = Math.max(0, Math.min(1, v)); this.emit("state"); }
  remove(i) {
    const t = this.tracks[i];
    if (!t) return;
    URL.revokeObjectURL(t.url); if (t.art) URL.revokeObjectURL(t.art);
    this.tracks.splice(i, 1);
    if (i === this.index) { this.audio.pause(); this.index = -1; if (this.tracks.length) this.play(Math.min(i, this.tracks.length - 1)); }
    else if (i < this.index) this.index--;
    this.emit("list");
  }
  // tell the OS what we're playing so the hardware media keys and the browser widget work
  setupMediaSession() {
    this.hasSession = "mediaSession" in navigator;
    if (!this.hasSession) return;
    const ms = navigator.mediaSession;
    const set = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* unsupported action */ } };
    set("play", () => this.play());
    set("pause", () => this.audio.pause());
    set("nexttrack", () => this.next());
    set("previoustrack", () => this.prev());
    set("seekto", (d) => { if (d.seekTime != null) this.audio.currentTime = d.seekTime; });
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

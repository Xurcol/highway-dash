// Loading-screen music made on the spot: an eight-bar synthwave loop (four-on-the-floor kick, gated
// snare, hats, octave-jumping bass, a detuned pad and an echoing arpeggio over Am - F - C - G) built
// from Web Audio oscillators and noise. It stands in for a music file where there isn't one (the
// public build ships none), so it copies the bits of <audio> the loader uses: play() / pause(),
// paused, volume, and removeAttribute("src") / load() to release it.
const BPM = 96, STEP = 60 / BPM / 4;                        // one sixteenth
const CHORDS = [                                            // [bass root, chord tones] as MIDI notes
  [45, [57, 60, 64]], [41, [53, 57, 60]], [48, [55, 60, 64]], [43, [55, 59, 62]],
];
const hz = (n) => 440 * 2 ** ((n - 69) / 12);

export function synthSong() {
  let ctx = null, out = null, verb = null, echo = null, noise = null, timer = 0, step = 0, next = 0, vol = .55, playing = false;
  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    out = ctx.createGain(); out.gain.value = vol;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    out.connect(comp).connect(ctx.destination);
    // a long, dark hall for the pad and snare, and a dotted-eighth echo for the arpeggio
    verb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6; }
    verb.buffer = ir;
    const verbOut = ctx.createGain(); verbOut.gain.value = .32; verb.connect(verbOut).connect(out);
    echo = ctx.createDelay(1); echo.delayTime.value = STEP * 3;
    const fb = ctx.createGain(), lp = ctx.createBiquadFilter();
    fb.gain.value = .38; lp.frequency.value = 2400;
    echo.connect(lp).connect(fb).connect(echo); lp.connect(out); lp.connect(verb);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(.0001, t + a + d); };
  function tone(t, type, f, a, peak, d, dest, filt) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    let head = o;
    if (filt) { const lp = ctx.createBiquadFilter(); lp.frequency.value = filt; head = o.connect(lp); }
    head.connect(g); env(g, t, a, peak, d);
    for (const x of [].concat(dest)) g.connect(x);
    o.start(t); o.stop(t + a + d + .05);
    return o;
  }
  function hit(t, type, f0, f1, peak, d, dest) {           // filtered noise: snare body, hats
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + d);
    s.connect(f).connect(g); env(g, t, .002, peak, d);
    for (const x of [].concat(dest)) g.connect(x);
    s.start(t, Math.random() * .5); s.stop(t + d + .05);
  }
  function play16(i, t) {
    const bar = Math.floor(i / 16) % 8, s = i % 16, [root, chord] = CHORDS[bar % 4], late = bar >= 4;
    if (s % 4 === 0) {                                      // kick: a falling sine thump every beat
      const o = tone(t, "sine", 120, .002, .9, .28, out); o.frequency.exponentialRampToValueAtTime(42, t + .16);
    }
    if (s === 4 || s === 12) { hit(t, "bandpass", 1800, 900, .45, .2, [out, verb]); tone(t, "triangle", 190, .001, .25, .09, out); }
    if (s % 2 === 0) hit(t, "highpass", 7000, 6000, s % 4 === 2 ? .12 : .06, s % 4 === 2 ? .09 : .04, out);
    if (s % 2 === 0) tone(t, "sawtooth", hz(root + (s % 4 === 2 ? 12 : 0)), .005, .16, STEP * 1.7, out, 700);   // octave bass
    if (s === 0) for (const n of chord) for (const det of [-7, 7]) {                                            // pad, one chord a bar
      const o = tone(t, "sawtooth", hz(n), .5, .035, STEP * 16, [out, verb], 1500); o.detune.value = det;
    }
    const arp = [0, 1, 2, 1, 2, 0, 1, 2][s % 8], lift = late ? 24 : 12;                                          // arpeggio into the echo
    tone(t, "square", hz(chord[arp] + lift - (s % 8 === 7 ? 12 : 0)), .003, .045, STEP * .9, [out, echo], 3000);
  }
  function tick() {
    while (next < ctx.currentTime + .15) { play16(step++, next); next += STEP; }
  }
  const song = {
    loop: true, preload: "auto",
    get paused() { return !playing; },
    get volume() { return vol; },
    set volume(v) { vol = Math.max(0, Math.min(1, v)); if (out) out.gain.setTargetAtTime(vol, ctx.currentTime, .02); },
    // Browsers won't start sound before the first click or key press: refuse until then, the way
    // <audio> does, so the loader waits for that gesture and calls play() again.
    play() {
      if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return Promise.reject(new DOMException("needs a gesture", "NotAllowedError"));
      if (!ctx) build();
      return ctx.resume().then(() => {
        if (playing) return;
        playing = true; next = ctx.currentTime + .05;
        timer = setInterval(tick, 25); tick();
      });
    },
    pause() { playing = false; clearInterval(timer); ctx?.suspend(); },
    removeAttribute() { this.pause(); ctx?.close(); ctx = null; },
    load() {},
    addEventListener() {},
  };
  return song;
}

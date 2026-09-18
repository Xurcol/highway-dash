// Sky dome (gradient, sun, moon, stars, aurora, clouds), time of day, weather, precipitation.
import * as THREE from "three";

const KEYS = [ // hour, zenith, horizon, sun color, sun intensity, ambient
  [0, 0x02040c, 0x0a1226, 0x8aa0ff, 0, .05],
  [4.8, 0x050a1c, 0x1a2140, 0x8aa0ff, 0, .06],
  [5.8, 0x243a70, 0xd9745a, 0xff9a5c, .5, .25],
  [6.8, 0x4a7fc8, 0xf2b98a, 0xffc890, 1.6, .5],
  [9, 0x3d86d8, 0xc3dcf0, 0xfff1dc, 2.6, .75],
  [12, 0x2f7fd9, 0xbfdcf2, 0xffffff, 3.0, .85],
  [16, 0x3b84d4, 0xd6dcd0, 0xfff0d8, 2.6, .75],
  [17.8, 0x4a64a8, 0xf0a870, 0xffb070, 1.6, .5],
  [18.7, 0x3a3f80, 0xff6a3a, 0xff7040, .8, .32],
  [19.4, 0x1a1c48, 0x9c4a6a, 0xff6040, .15, .15],
  [20.3, 0x060a1e, 0x1c1c3c, 0x8aa0ff, 0, .07],
  [24, 0x02040c, 0x0a1226, 0x8aa0ff, 0, .05],
];
export const TIME_PRESETS = { Sunrise: 6.3, Noon: 12, Sunset: 18.6, Dusk: 19.5, Night: 23 };
export const SKY_STYLES = ["Natural", "Aurora", "Galaxy", "Synthwave"];
export const WEATHERS = {
  Clear: { cloud: .15, rain: 0, snow: 0, fog: 1, dark: 0, wet: 0 },
  Cloudy: { cloud: .65, rain: 0, snow: 0, fog: .8, dark: .25, wet: 0 },
  Rain: { cloud: .85, rain: .8, snow: 0, fog: .55, dark: .45, wet: 1 },
  Storm: { cloud: 1, rain: 1, snow: 0, fog: .45, dark: .65, wet: 1, lightning: true },
  Fog: { cloud: .5, rain: 0, snow: 0, fog: .18, dark: .3, wet: .3 },
  Snow: { cloud: .8, rain: 0, snow: 1, fog: .45, dark: .3, wet: .2 },
};

const skyVert = `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const skyFrag = /* glsl */`
uniform vec3 zenith, horizon, sunColor, sunDir, moonDir;
uniform float time, night, cloud, dark, style, aurora, flash, sunVis;
varying vec3 vDir;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float h31(vec3 p){ p = fract(p*vec3(.1031,.1030,.0973)); p += dot(p,p.yxz+33.33); return fract((p.x+p.y)*p.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
float fbm3(vec2 p){ float s=0., a=.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=p*2.1+vec2(3.1,1.7); a*=.5; } return s; }

vec3 stars(vec3 d, float density){
  vec3 acc = vec3(0.);
  for (int l=0; l<2; l++){
    float sc = l==0 ? 180. : 420.;
    vec3 p = d*sc; vec3 c = floor(p);
    float r = h31(c + float(l)*17.);
    if (r > 1. - density*(l==0?.05:.12)) {
      vec3 jit = vec3(h31(c+1.3), h31(c+7.1), h31(c+3.7));
      float dd = length(p - c - jit);
      float tw = .6 + .4*sin(time*(2.+r*6.) + r*100.);
      float b = smoothstep(.35, 0., dd) * tw * (l==0?1.4:.7);
      vec3 tint = mix(vec3(.7,.8,1.), vec3(1.,.85,.7), h31(c+9.));
      acc += tint * b;
    }
  }
  return acc;
}
vec3 auroraCol(vec3 d){
  vec3 acc = vec3(0.);
  if (d.y < .02) return acc;
  for (int i=0; i<18; i++){
    float fi = float(i);
    vec2 p = d.xz / d.y * (1. + fi*.06) * .9;
    float t = time*.025;
    float w = fbm3(p*.45 + vec2(t, -t*.6));
    float band = sin(p.x*.9 + p.y*.35 + w*6.5 + t*3.);
    float curtain = exp(-abs(band)*5.);
    float rays = .45 + .55*vnoise(vec2(p.x*9. + w*12., t*12. + fi*.1));
    float f = 1. - fi/18.;
    vec3 c = mix(vec3(.15,1.,.55), vec3(.55,.25,1.), pow(fi/18., .8));
    acc += c * curtain * rays * f * f * .075;
  }
  return acc * smoothstep(.02, .3, d.y) * smoothstep(1., .55, d.y);
}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 zen = zenith, hor = horizon;
  if (style > 2.5) { // synthwave
    zen = mix(vec3(.05,.0,.12), zen, .25); hor = mix(vec3(1.,.25,.55), hor, .3);
  }
  vec3 col = mix(hor, zen, pow(clamp(h,0.,1.), .45));
  col = mix(col, hor*.55, smoothstep(0., -.2, h));
  float overcast = cloud*cloud*dark;
  col = mix(col, vec3(dot(col, vec3(.3,.5,.2)))*.8, overcast*.8);

  float sd = max(dot(d, sunDir), 0.);
  col += sunColor * (pow(sd, 900.)*30. + pow(sd, 16.)*.35 + pow(sd, 4.)*.12) * sunVis * (1. - overcast*.85);
  if (style > 2.5 && h > -.05) { // retro sun stripes
    float sdd = dot(d, sunDir);
    float stripes = step(.5, fract((d.y - sunDir.y)*60.)) + step(0., d.y - sunDir.y);
    col += mix(vec3(1.,.2,.5), vec3(1.,.85,.2), clamp((d.y-sunDir.y)*8.+.5,0.,1.)) * smoothstep(.985,.987,sdd) * min(stripes,1.) * .9;
  }
  float md = dot(d, moonDir);
  col += vec3(.95,.95,1.) * smoothstep(.99955, .9997, md) * night * (1. - overcast);
  col += vec3(.3,.35,.5) * pow(max(md,0.), 80.) * .35 * night;

  if (h > 0.) {
    float sDen = style > 1.5 && style < 2.5 ? 2.5 : 1.;
    col += stars(d, sDen) * night * smoothstep(0., .15, h) * (1. - cloud*.9);
    if (style > 1.5 && style < 2.5) { // milky way
      vec3 axis = normalize(vec3(.4, .2, -1.));
      float band = exp(-pow(dot(d, normalize(cross(axis, vec3(0,1,0)))) * 4., 2.));
      float neb = fbm(d.xz/(d.y+.3)*3.);
      col += (vec3(.35,.3,.6)*neb + vec3(.9,.5,.8)*pow(neb,4.)*.8) * band * night * .55;
    }
    if (aurora > 0.) col += auroraCol(d) * aurora * night * (1. - cloud*.8);
    // clouds
    vec2 cp = d.xz / (h + .08) * .9 + vec2(time*.004, time*.002);
    float n = fbm(cp);
    float cov = smoothstep(1. - cloud*.85 - .1, 1.05 - cloud*.5, n + .25);
    vec3 lit = mix(vec3(.12,.13,.17), vec3(1.), clamp(sunDir.y*2.+.2, 0., 1.));
    vec3 cc = mix(lit, sunColor*.9, pow(sd, 6.)*.6*sunVis) * (1. - dark*.6);
    cc = mix(cc, hor*.8, .25) + vec3(.05,.06,.09)*night;
    col = mix(col, cc, cov * smoothstep(0., .12, h) * .92);
  }
  col += vec3(.75,.8,1.) * flash * smoothstep(-.1, .4, h);
  gl_FragColor = vec4(col, 1.);
  #include <colorspace_fragment>
}`;

const lerpHex = (a, b, t, out) => out.set(a).lerp(new THREE.Color(b), t);

export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.hour = 18.6; this.flow = false; this.style = "Natural"; this.weatherName = "Clear";
    this.w = { ...WEATHERS.Clear }; this.target = WEATHERS.Clear;
    this.uniforms = {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3() }, moonDir: { value: new THREE.Vector3() },
      time: { value: 0 }, night: { value: 0 }, cloud: { value: 0 }, dark: { value: 0 }, style: { value: 0 },
      aurora: { value: 0 }, flash: { value: 0 }, sunVis: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.dome.scale.setScalar(1500); this.dome.renderOrder = -10; this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 300 });
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xffffff, 100, 900);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(this.dome.geometry, mat);
    this.envDome.scale.setScalar(100);
    this.envScene.add(this.envDome);
    this.envTimer = 0; this.envRT = null;

    this.precip = this.makePrecip();
    scene.add(this.precip);
    this.lightningT = 3; this.flashV = 0;
    this.night = 0; this.lampsOn = 0;
    this.c = { zen: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color() };
  }

  setWeather(name) { this.weatherName = name; this.target = WEATHERS[name]; }
  setStyle(name) { this.style = name; }

  makePrecip() {
    const N = 9000, pos = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 90, y = Math.random() * 40, z = Math.random() * 110;
      for (let k = 0; k < 2; k++) { pos.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("end", new THREE.BufferAttribute(end, 1));
    this.precipU = { cam: { value: new THREE.Vector3() }, time: { value: 0 }, speed: { value: 0 }, amount: { value: 0 }, snow: { value: 0 }, color: { value: new THREE.Color() } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.precipU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float end; uniform vec3 cam; uniform float time, speed, amount, snow; varying float vA;
        void main(){
          vec3 p = position;
          float fall = mix(22., 2.5, snow);
          p.y = mod(p.y - time*fall, 40.);
          vec3 w = vec3(cam.x + mod(p.x - cam.x, 90.) - 45., cam.y - 12. + p.y, cam.z + mod(p.z - cam.z, 110.) - 80.);
          w.x += snow * sin(time*.8 + position.z) * 1.5;
          if (end > .5) { w.y += mix(.9, .06, snow); w.z -= speed * mix(.018, .002, snow); }
          vA = step(fract(position.x*7.13+position.z*3.1), amount) * (end > .5 ? .15 : mix(.5, 1., snow));
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
        }`,
      fragmentShader: `uniform vec3 color; varying float vA; void main(){ if (vA <= 0.) discard; gl_FragColor = vec4(color * vA, 1.); }`,
    });
    const lines = new THREE.LineSegments(g, m);
    lines.frustumCulled = false; lines.renderOrder = 5;
    return lines;
  }

  sample(hour) {
    let i = 0;
    while (i < KEYS.length - 2 && hour >= KEYS[i + 1][0]) i++;
    const a = KEYS[i], b = KEYS[i + 1], t = (hour - a[0]) / (b[0] - a[0]);
    lerpHex(a[1], b[1], t, this.c.zen); lerpHex(a[2], b[2], t, this.c.hor); lerpHex(a[3], b[3], t, this.c.sun);
    return { sunI: a[4] + (b[4] - a[4]) * t, amb: a[5] + (b[5] - a[5]) * t };
  }

  update(dt, camera, focus, speedMs, audio) {
    if (this.flow) this.hour = (this.hour + dt / 60) % 24; // one in-game hour per real minute
    const k = 1 - Math.exp(-dt * 0.6);
    for (const key of ["cloud", "rain", "snow", "fog", "dark", "wet"]) this.w[key] += (this.target[key] - this.w[key]) * k;
    const W = this.w, U = this.uniforms;
    const { sunI, amb } = this.sample(this.hour);

    const ang = ((this.hour - 6) / 12) * Math.PI;
    U.sunDir.value.set(Math.cos(ang) * .55, Math.sin(ang), -.75).normalize();
    U.moonDir.value.set(-Math.cos(ang) * .45, Math.max(.25, -Math.sin(ang) * .8), -.8).normalize();
    const elev = U.sunDir.value.y;
    this.night = THREE.MathUtils.smoothstep(-elev, -.02, .18);
    const style = SKY_STYLES.indexOf(this.style);
    U.zenith.value.copy(this.c.zen); U.horizon.value.copy(this.c.hor); U.sunColor.value.copy(this.c.sun);
    U.time.value += dt; U.night.value = this.night; U.cloud.value = W.cloud; U.dark.value = W.dark;
    U.style.value = style; U.aurora.value = this.style === "Aurora" ? 1 : this.style === "Galaxy" ? .25 : 0;
    U.sunVis.value = THREE.MathUtils.smoothstep(elev, -.08, .05);

    // lightning
    this.flashV *= Math.exp(-dt * 9);
    if (this.target.lightning) {
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.flashV = 1.5; this.lightningT = 4 + Math.random() * 9;
        setTimeout(() => (this.flashV = Math.max(this.flashV, 1)), 120);
        audio?.thunder(0.4 + Math.random() * 1.8);
      }
    }
    U.flash.value = this.flashV * .6;

    // lights
    const dim = 1 - W.dark * .7;
    this.sun.color.copy(this.night > .5 ? new THREE.Color(0x8aa0ff) : this.c.sun);
    const tun = this.tunnel || 0;
    this.sun.intensity = (Math.max(sunI * dim, this.night * .25) + this.flashV * 1.5) * (1 - .93 * tun);
    const ld = elev > -.05 ? U.sunDir.value : U.moonDir.value;
    this.sun.position.copy(focus).addScaledVector(ld, 150);
    this.sun.target.position.copy(focus);
    this.hemi.color.copy(this.c.zen).lerp(new THREE.Color(0xffffff), .5);
    this.hemi.groundColor.copy(this.c.hor).multiplyScalar(.35);
    this.hemi.intensity = ((amb * 1.6 + .12) * (1 - W.dark * .35) + this.flashV) * (1 - .82 * tun);
    if (style === 3) this.hemi.color.lerp(new THREE.Color(0xff4fa0), .35);

    const fogCol = this.c.hor.clone().lerp(this.c.zen, .15);
    fogCol.lerp(new THREE.Color(fogCol.getHex()).multiplyScalar(.6).add(new THREE.Color(.25, .26, .28).multiplyScalar(1 - this.night)), W.dark * .6);
    if (style === 3) fogCol.lerp(new THREE.Color(0x3a1050), .5);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.near = 60 * W.fog; this.scene.fog.far = 1100 * W.fog;
    this.lampsOn = Math.max(this.night, W.dark * .8, (1 - W.fog) * .6, tun) > .35 ? 1 : 0;
    this.renderer.toneMappingExposure = 1.0 + this.night * .35 + tun * .3;

    this.dome.position.copy(camera.position);
    const pu = this.precipU;
    pu.cam.value.copy(camera.position); pu.time.value += dt; pu.speed.value = speedMs;
    pu.amount.value = Math.max(W.rain, W.snow); pu.snow.value = W.snow > W.rain ? 1 : 0;
    pu.color.value.setRGB(.55, .6, .7).multiplyScalar(W.snow > W.rain ? 1.4 : .6 + (1 - this.night) * .5);
    this.precip.visible = pu.amount.value > .02;

    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 1.5;
      this.envDome.position.set(0, 0, 0);
      const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200, { size: 128 });
      this.scene.environment = rt.texture;
      this.scene.environmentIntensity = .35 + (1 - this.night) * .65;
      this.envRT?.dispose(); this.envRT = rt;
    }
  }
}

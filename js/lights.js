// Many cheap spot lights (street lamps, headlights) injected into standard materials,
// plus additive glow sprites for bulbs and car lights.
import * as THREE from "three";

export const LAMP_MAX = 32;
const U = {
  lampPos: { value: Array.from({ length: LAMP_MAX }, () => new THREE.Vector3()) },
  lampDir: { value: Array.from({ length: LAMP_MAX }, () => new THREE.Vector3(0, -1, 0)) },
  lampColor: { value: Array.from({ length: LAMP_MAX }, () => new THREE.Vector3()) },
  lampParams: { value: Array.from({ length: LAMP_MAX }, () => new THREE.Vector4()) },
  lampCount: { value: 0 },
};
export const lampUniforms = U;

const DECL = /* glsl */`
#define LAMP_MAX ${LAMP_MAX}
uniform vec3 lampPos[LAMP_MAX];
uniform vec3 lampDir[LAMP_MAX];
uniform vec3 lampColor[LAMP_MAX];
uniform vec4 lampParams[LAMP_MAX];
uniform int lampCount;
`;
const APPLY = /* glsl */`
{
  vec3 fpos = -vViewPosition;
  vec3 V = normalize(vViewPosition);
  vec3 accD = vec3(0.0), accS = vec3(0.0);
  for (int i = 0; i < LAMP_MAX; i++) {
    if (i >= lampCount) break;
    vec3 Lv = lampPos[i] - fpos;
    float d = length(Lv);
    vec4 pr = lampParams[i];
    if (d > pr.x) continue;
    vec3 L = Lv / d;
    float att = 1.0 - d / pr.x; att *= att;
    float cone = smoothstep(pr.y, pr.z, dot(-L, lampDir[i]));
    float k = att * cone;
    if (k <= 0.0) continue;
    accD += lampColor[i] * k * max(dot(normal, L), 0.0);
    accS += lampColor[i] * k * pow(max(dot(normalize(L + V), normal), 0.0), 48.0);
  }
  outgoingLight += diffuseColor.rgb * accD + accS * (1.0 - roughnessFactor) * 1.5;
}
`;

// `extra` lets callers chain their own onBeforeCompile edits
export function patchLit(material, extra) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + DECL)
      .replace("#include <opaque_fragment>", APPLY + "\n#include <opaque_fragment>");
    if (extra) extra(shader);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => "lamps" + (extra ? extra.key || extra.toString().length : "") + (key ? key() : "");
  return material;
}

const _v = new THREE.Vector3(), _d = new THREE.Vector3();
// lights: [{pos:Vector3, dir:Vector3, color:Color, intensity, range, cosOuter, cosInner}]
export function uploadLights(lights, camera) {
  const view = camera.matrixWorldInverse;
  const cp = camera.position;
  lights.sort((a, b) => a.pos.distanceToSquared(cp) - b.pos.distanceToSquared(cp));
  const n = Math.min(LAMP_MAX, lights.length);
  for (let i = 0; i < n; i++) {
    const l = lights[i];
    U.lampPos.value[i].copy(_v.copy(l.pos).applyMatrix4(view));
    U.lampDir.value[i].copy(_d.copy(l.dir).transformDirection(view));
    U.lampColor.value[i].set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity);
    U.lampParams.value[i].set(l.range, l.cosOuter, l.cosInner, 0);
  }
  U.lampCount.value = n;
}

// ---------- glow sprites ----------
export class Glows {
  constructor(scene, cap = 1500) {
    this.cap = cap;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.size = new Float32Array(cap);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 800 } },
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(size * scale / -mv.z, 0.0, 256.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC;
        void main(){ vec2 p = gl_PointCoord*2.0-1.0; float r = dot(p,p); if (r>1.0) discard;
          float a = exp(-r*4.0) + exp(-r*30.0)*1.5; gl_FragColor = vec4(vC*a, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.n = 0;
  }
  begin() { this.n = 0; }
  add(x, y, z, r, g, b, size) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size;
  }
  end(heightPx) {
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    for (const k of ["position", "color", "size"]) g.attributes[k].needsUpdate = true;
    this.mat.uniforms.scale.value = heightPx * 0.9;
  }
}

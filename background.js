import * as THREE from "three";

// A page-wide, hypnotic-but-quiet animated backdrop, deliberately kept
// decoupled from the wheel scene/logic in script.js — it's a full-viewport
// fixed canvas rendered behind everything, driven by its own tiny
// renderer/scene/shader. It has no opinion about the wheel at all.

const canvas = document.getElementById("bg-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.Camera(); // unused by the shader (see vertex shader), kept for renderer.render()'s signature

const uniforms = {
  uTime: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uSpeed: { value: 0.6 },
  uIntensity: { value: 0.55 },
  uMode: { value: 0 },
};

const vertexShader = `
  void main() {
    // Full-screen triangle/quad: pass clip-space position straight through,
    // ignoring camera matrices entirely.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  uniform float uTime;
  uniform vec2 uResolution;
  uniform float uSpeed;
  uniform float uIntensity;
  uniform int uMode;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  // Deliberately restrained palette — a dark base with two muted accents
  // (violet, teal), never the full hue wheel. Keeps things ambient rather
  // than a rainbow light show.
  const vec3 DARK = vec3(0.035, 0.03, 0.055);
  const vec3 VIOLET = vec3(0.16, 0.09, 0.26);
  const vec3 TEAL = vec3(0.03, 0.14, 0.17);

  vec3 plasma(vec2 uv, float t) {
    float v = 0.0;
    v += sin((uv.x * 3.0 + t * 0.35) + sin(uv.y * 4.0 - t * 0.25) * 1.6);
    v += sin((uv.y * 3.4 - t * 0.28) + cos(uv.x * 2.6 + t * 0.18) * 1.6);
    v += sin(length(uv) * 5.0 - t * 0.4);
    v *= 0.333;
    float m = v * 0.5 + 0.5;
    vec3 col = mix(DARK, VIOLET, smoothstep(0.15, 0.75, m));
    col = mix(col, TEAL, smoothstep(0.55, 1.0, m) * 0.7);
    return col;
  }

  vec3 aurora(vec2 uv, float t) {
    float n = 0.0;
    n += noise(vec2(uv.x * 2.2 + t * 0.12, uv.y * 1.4)) * 0.6;
    n += noise(vec2(uv.x * 4.5 - t * 0.08, uv.y * 2.8 + 3.1)) * 0.4;
    float band = smoothstep(0.15, 0.85, n);
    float vertical = 1.0 - smoothstep(0.35, 1.1, abs(uv.y) * 2.0);
    vec3 col = mix(DARK, TEAL, band);
    col = mix(col, VIOLET, smoothstep(0.5, 1.0, n) * 0.6);
    col *= clamp(vertical * 1.1 + 0.1, 0.0, 1.0);
    return col;
  }

  vec3 radialPulse(vec2 uv, float t) {
    float dist = length(uv);
    float angle = atan(uv.y, uv.x);
    float rings = sin(dist * 14.0 - t * 1.4) * 0.5 + 0.5;
    float spokes = sin(angle * 6.0 + t * 0.3) * 0.5 + 0.5;
    float v = mix(rings, spokes, 0.25);
    vec3 col = mix(DARK, VIOLET, smoothstep(0.2, 0.8, v));
    col = mix(col, TEAL, smoothstep(0.6, 1.0, v + dist * 0.2) * 0.6);
    col *= smoothstep(1.2, 0.3, dist) * 0.5 + 0.15;
    return col;
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy / uResolution.xy - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
    float t = uTime * uSpeed;

    vec3 color;
    if (uMode == 1) {
      color = aurora(uv, t);
    } else if (uMode == 2) {
      color = radialPulse(uv, t);
    } else {
      color = plasma(uv, t);
    }

    color *= uIntensity;
    gl_FragColor = vec4(color, 1.0);
  }
`;

const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
scene.add(quad);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  uniforms.uResolution.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
}
window.addEventListener("resize", resize);
resize();

function loop(t) {
  requestAnimationFrame(loop);
  uniforms.uTime.value = t / 1000;
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);

// --- Debug controls -------------------------------------------------------

const modeSelect = document.getElementById("bg-mode");
const speedSlider = document.getElementById("bg-speed");
const intensitySlider = document.getElementById("bg-intensity");
const outSpeed = document.getElementById("out-bg-speed");
const outIntensity = document.getElementById("out-bg-intensity");

modeSelect.addEventListener("change", () => {
  uniforms.uMode.value = Number(modeSelect.value);
});

speedSlider.addEventListener("input", () => {
  uniforms.uSpeed.value = Number(speedSlider.value);
  outSpeed.textContent = speedSlider.value;
});

intensitySlider.addEventListener("input", () => {
  uniforms.uIntensity.value = Number(intensitySlider.value);
  outIntensity.textContent = intensitySlider.value;
});

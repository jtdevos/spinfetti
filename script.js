import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// ---------------------------------------------------------------------------
// State + persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = "wheel-of-fortune-entries";

const DEFAULT_ENTRIES = [
  "Reese's Cups",
  "Kit Kat",
  "Skittles",
  "Snickers",
  "Sour Patch Kids",
  "Candy Corn",
  "Twix",
  "M&Ms",
];

const PALETTE = [
  "#e63946", "#f1a208", "#2a9d8f", "#457b9d",
  "#8338ec", "#ff006e", "#06d6a0", "#ffbe0b",
  "#3a86ff", "#fb5607",
];

function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    // ignore corrupt storage
  }
  return DEFAULT_ENTRIES.map((text, i) => ({ text, color: PALETTE[i % PALETTE.length] }));
}

function saveEntries() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

let entries = loadEntries();
let nextColorIndex = entries.length;

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

const entryListEl = document.getElementById("entry-list");
const addForm = document.getElementById("add-form");
const addInput = document.getElementById("add-input");
const bulkText = document.getElementById("bulk-text");
const bulkApplyBtn = document.getElementById("bulk-apply");
const spinBtn = document.getElementById("spin-btn");
const winnerOverlay = document.getElementById("winner-overlay");
const winnerNameEl = document.getElementById("winner-name");
const winnerCloseBtn = document.getElementById("winner-close");

function renderEntryList() {
  entryListEl.innerHTML = "";
  entries.forEach((entry, i) => {
    const li = document.createElement("li");

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = entry.color;

    const text = document.createElement("span");
    text.className = "entry-text";
    text.textContent = entry.text;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove";
    removeBtn.addEventListener("click", () => {
      entries.splice(i, 1);
      onEntriesChanged();
    });

    li.append(swatch, text, removeBtn);
    entryListEl.appendChild(li);
  });
}

function onEntriesChanged() {
  saveEntries();
  renderEntryList();
  rebuildWheelTexture();
  spinBtn.disabled = entries.length < 2;
}

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = addInput.value.trim();
  if (!value) return;
  entries.push({ text: value, color: PALETTE[nextColorIndex % PALETTE.length] });
  nextColorIndex++;
  addInput.value = "";
  onEntriesChanged();
});

bulkApplyBtn.addEventListener("click", () => {
  const lines = bulkText.value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  entries = lines.map((text, i) => ({ text, color: PALETTE[i % PALETTE.length] }));
  nextColorIndex = entries.length;
  bulkText.value = "";
  onEntriesChanged();
});

winnerCloseBtn.addEventListener("click", () => {
  winnerOverlay.classList.add("hidden");
});

renderEntryList();

// ---------------------------------------------------------------------------
// Three.js scene setup
// ---------------------------------------------------------------------------

const container = document.getElementById("wheel-container");

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
const CAMERA_DISTANCE = 14;

// Camera tilt is constrained to a single arc (around the X axis, at a fixed
// distance) rather than a free orbit: 0° is dead face-on, positive angles
// tilt the camera up so we look slightly down at the wheel. This is the
// "forced perspective" knob — enough angle to read the rim thickness and
// catch highlight motion without turning it into a true 3D orbit.
function setCameraTilt(degrees) {
  const rad = (degrees * Math.PI) / 180;
  camera.position.set(0, CAMERA_DISTANCE * Math.sin(rad), CAMERA_DISTANCE * Math.cos(rad));
  camera.lookAt(0, 0, 0);
}
setCameraTilt(6);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const hemiLight = new THREE.HemisphereLight(0xfff6e0, 0x201830, 1.1);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(3, 5, 6);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0xffb703, 1.2, 20);
rimLight.position.set(-4, -2, 4);
scene.add(rimLight);

// ---------------------------------------------------------------------------
// Screen filters: a post-processing pass over the wheel's own render,
// mimicking old-video artifacts (CRT curvature/scanlines, chromatic
// aberration, posterize/pixelation standing in for compression blockiness,
// static noise). Every knob defaults to "off" (0) — the baseline render is
// untouched until a debug control turns one on.
// ---------------------------------------------------------------------------

const filterUniforms = {
  tDiffuse: { value: null },
  uTime: { value: 0 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uScanlines: { value: 0 },
  uCurvature: { value: 0 },
  uVignette: { value: 0 },
  uChroma: { value: 0 },
  uPosterize: { value: 0 },
  uPixelate: { value: 0 },
  uNoise: { value: 0 },
};

const retroFilterShader = {
  uniforms: filterUniforms,
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uScanlines;
    uniform float uCurvature;
    uniform float uVignette;
    uniform float uChroma;
    uniform float uPosterize;
    uniform float uPixelate;
    uniform float uNoise;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    vec2 barrel(vec2 uv, float amt) {
      vec2 cc = uv - 0.5;
      float dist2 = dot(cc, cc);
      return uv + cc * dist2 * amt;
    }

    void main() {
      vec2 uv = uCurvature > 0.0 ? barrel(vUv, uCurvature) : vUv;

      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }

      if (uPixelate > 1.0) {
        vec2 blocks = uResolution / uPixelate;
        uv = floor(uv * blocks) / blocks;
      }

      vec3 color;
      float alpha = texture2D(tDiffuse, uv).a;
      if (uChroma > 0.0) {
        color.r = texture2D(tDiffuse, uv + vec2(uChroma, 0.0)).r;
        color.g = texture2D(tDiffuse, uv).g;
        color.b = texture2D(tDiffuse, uv - vec2(uChroma, 0.0)).b;
      } else {
        color = texture2D(tDiffuse, uv).rgb;
      }

      if (uPosterize > 1.0) {
        color = floor(color * uPosterize + 0.5) / uPosterize;
      }

      if (uScanlines > 0.0) {
        // Fixed line density (independent of actual pixel resolution/DPR) so
        // this reads as clean bands instead of aliasing into static. Squared
        // cosine sharpens the dark troughs while leaving bright bands at
        // full brightness, for real scanline contrast rather than a wash.
        const float LINES = 100.0;
        float scan = 0.5 + 0.5 * cos(uv.y * LINES * 6.28318 - uTime * 6.0);
        scan = scan * scan;
        color *= 1.0 - uScanlines * (1.0 - scan);
      }

      if (uNoise > 0.0) {
        float n = rand(uv * uResolution.xy + fract(uTime) * 120.0);
        color += (n - 0.5) * uNoise;
      }

      if (uVignette > 0.0) {
        float d = distance(uv, vec2(0.5));
        float vig = smoothstep(0.85, 0.25, d);
        color *= mix(1.0, vig, uVignette);
      }

      gl_FragColor = vec4(color, alpha);
    }
  `,
};

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Built as a real THREE.ShaderMaterial (rather than handing ShaderPass a
// plain {uniforms, vertexShader, fragmentShader} object) specifically so it
// uses filterUniforms *by reference* — ShaderPass clones plain shader defs
// internally, which would silently disconnect the debug sliders from what
// the shader actually reads.
const filterMaterial = new THREE.ShaderMaterial(retroFilterShader);
const filterPass = new ShaderPass(filterMaterial);
composer.addPass(filterPass);
composer.addPass(new OutputPass());

function resizeRenderer() {
  const size = container.clientWidth;
  const pixelRatio = renderer.getPixelRatio();
  renderer.setSize(size, size);
  composer.setSize(size, size);
  filterUniforms.uResolution.value.set(size * pixelRatio, size * pixelRatio);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resizeRenderer);

// ---------------------------------------------------------------------------
// Wheel geometry: a flat "poker chip" — front face (textured), rim, back.
//
// We use CircleGeometry for the front face because its UV mapping is a
// direct orthographic projection of local (x, y): u = (x/r + 1) / 2,
// v = (y/r + 1) / 2. That means the *local* angle we spin the wheel by
// (pivot.rotation.z, measured the standard math way — counter-clockwise
// from +x) is exactly the angle we use to place slices when drawing the
// canvas texture. No implicit mapping to reverse-engineer.
// ---------------------------------------------------------------------------

const WHEEL_RADIUS = 3;
const WHEEL_THICKNESS = 0.6;
const RIM_BEVEL = 0.14;
const FACE_RADIUS = WHEEL_RADIUS - RIM_BEVEL;
const TEXTURE_SIZE = 1024;

const wheelPivot = new THREE.Group();
scene.add(wheelPivot);

const canvas = document.createElement("canvas");
canvas.width = TEXTURE_SIZE;
canvas.height = TEXTURE_SIZE;
const ctx = canvas.getContext("2d");
const wheelTexture = new THREE.CanvasTexture(canvas);
wheelTexture.colorSpace = THREE.SRGBColorSpace;

const frontMaterial = new THREE.MeshStandardMaterial({
  map: wheelTexture,
  roughness: 0.55,
  metalness: 0.05,
});
const frontDisc = new THREE.Mesh(
  new THREE.CircleGeometry(FACE_RADIUS, 96),
  frontMaterial
);
frontDisc.position.z = WHEEL_THICKNESS / 2;
wheelPivot.add(frontDisc);

const backMaterial = new THREE.MeshStandardMaterial({
  color: 0x161320,
  roughness: 0.8,
  side: THREE.DoubleSide,
});
const backDisc = new THREE.Mesh(new THREE.CircleGeometry(FACE_RADIUS, 96), backMaterial);
backDisc.position.z = -WHEEL_THICKNESS / 2;
wheelPivot.add(backDisc);

const rimMaterial = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  roughness: 0.3,
  metalness: 0.8,
});

// Rounded rim: a revolved (Lathe) profile instead of a flat-walled cylinder
// — a quarter-circle bevel from each flat face down to a short straight
// wall, so the disc reads as a real beveled object instead of a flat
// cutout. Revolved around Y by LatheGeometry, then rotated onto our wheel's
// Z spin axis the same way the old cylinder rim was.
const halfThickness = WHEEL_THICKNESS / 2;
const bevelCenterZ = halfThickness - RIM_BEVEL;
const RIM_ARC_SEGMENTS = 12;
const rimProfile = [];
for (let i = 0; i <= RIM_ARC_SEGMENTS; i++) {
  const phi = (Math.PI / 2) * (1 - i / RIM_ARC_SEGMENTS); // 90deg -> 0deg
  rimProfile.push(new THREE.Vector2(
    FACE_RADIUS + RIM_BEVEL * Math.cos(phi),
    bevelCenterZ + RIM_BEVEL * Math.sin(phi)
  ));
}
for (let i = 0; i <= RIM_ARC_SEGMENTS; i++) {
  const phi = -(Math.PI / 2) * (i / RIM_ARC_SEGMENTS); // 0deg -> -90deg
  rimProfile.push(new THREE.Vector2(
    FACE_RADIUS + RIM_BEVEL * Math.cos(phi),
    -bevelCenterZ + RIM_BEVEL * Math.sin(phi)
  ));
}
const rim = new THREE.Mesh(new THREE.LatheGeometry(rimProfile, 96), rimMaterial);
rim.rotation.x = Math.PI / 2;
wheelPivot.add(rim);

const hub = new THREE.Mesh(
  new THREE.CylinderGeometry(0.25, 0.25, WHEEL_THICKNESS + 0.08, 32),
  rimMaterial
);
hub.rotation.x = Math.PI / 2;
wheelPivot.add(hub);

// Pointer: fixed at the top of the wheel, does not spin.
const pointerGroup = new THREE.Group();
const pointerShape = new THREE.Shape();
pointerShape.moveTo(-0.28, 0.4);
pointerShape.lineTo(0.28, 0.4);
pointerShape.lineTo(0, -0.2);
pointerShape.closePath();
const pointerMesh = new THREE.Mesh(
  new THREE.ExtrudeGeometry(pointerShape, { depth: 0.2, bevelEnabled: false }),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1 })
);
// Positioned so the whole shape's y-extent stays above WHEEL_RADIUS (clear of
// the disc's silhouette) and its z sits in front of the front face.
pointerMesh.position.set(0, WHEEL_RADIUS + 0.3, 0.25);
pointerGroup.add(pointerMesh);
scene.add(pointerGroup);

// ---------------------------------------------------------------------------
// Texture drawing
//
// Local angle convention: 0 = +x axis, increasing counter-clockwise (the
// same convention as wheelPivot.rotation.z). To place local angle `phi` on
// the canvas (y-down pixel space) we use (cx + r*cos(phi), cy - r*sin(phi)).
// ---------------------------------------------------------------------------

function localAngleToCanvasPoint(phi, radius) {
  const cx = TEXTURE_SIZE / 2;
  const cy = TEXTURE_SIZE / 2;
  return [cx + radius * Math.cos(phi), cy - radius * Math.sin(phi)];
}

function rebuildWheelTexture() {
  const n = entries.length;
  ctx.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  const cx = TEXTURE_SIZE / 2;
  const cy = TEXTURE_SIZE / 2;
  const R = TEXTURE_SIZE / 2 - 4;

  if (n === 0) {
    wheelTexture.needsUpdate = true;
    return;
  }

  const sliceAngle = (2 * Math.PI) / n;

  for (let i = 0; i < n; i++) {
    const startPhi = i * sliceAngle;
    const endPhi = startPhi + sliceAngle;

    // Canvas arc() sweeps in the canvas's own (visually clockwise) sense,
    // so convert our CCW local-angle slice into the equivalent canvas arc
    // by drawing from -endPhi to -startPhi.
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, -endPhi, -startPhi);
    ctx.closePath();
    ctx.fillStyle = entries[i].color;
    ctx.fill();

    // Label, oriented radially, reading outward from the hub.
    const midPhi = startPhi + sliceAngle / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-midPhi);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${n > 16 ? 22 : 30}px 'Segoe UI', sans-serif`;
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 4;
    const label = entries[i].text.length > 22 ? entries[i].text.slice(0, 20) + "…" : entries[i].text;
    ctx.fillText(label, R - 24, 0);
    ctx.restore();
  }

  // Thin slice-divider lines for polish.
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 3;
  for (let i = 0; i < n; i++) {
    const [x, y] = localAngleToCanvasPoint(i * sliceAngle, R);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  wheelTexture.needsUpdate = true;
}

rebuildWheelTexture();

// ---------------------------------------------------------------------------
// Spin logic
// ---------------------------------------------------------------------------

const POINTER_WORLD_ANGLE = Math.PI / 2; // "up" on screen, standard math angle

// Physics knobs, live-tunable from the debug panel. The spin is a genuine
// angular-velocity simulation (constant linear drag), not a canned easing
// curve — top speed sets how fast it launches, drag sets how hard it
// decelerates, and how far it travels (and where it lands) falls out of
// those two numbers instead of being pre-selected.
const settings = {
  topSpeed: 14, // rad/s
  drag: 2.5, // rad/s^2
};

let spinning = false;
let angularVelocity = 0;
let lastFrameTime = 0;

function currentWinnerIndex() {
  const n = entries.length;
  const sliceAngle = (2 * Math.PI) / n;
  // Local angle currently sitting under the pointer.
  let localAtPointer = POINTER_WORLD_ANGLE - wheelPivot.rotation.z;
  localAtPointer = ((localAtPointer % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.floor(localAtPointer / sliceAngle) % n;
}

function spin() {
  if (spinning || entries.length < 2) return;
  spinning = true;
  spinBtn.disabled = true;

  // +/-10% launch jitter so identical settings don't always land the same
  // number of slices away.
  angularVelocity = settings.topSpeed * (0.9 + Math.random() * 0.2);
  lastFrameTime = performance.now();
  requestAnimationFrame(stepSpin);
}

function stepSpin(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05); // guard against tab-throttle spikes
  lastFrameTime = now;

  angularVelocity = Math.max(0, angularVelocity - settings.drag * dt);
  wheelPivot.rotation.z += angularVelocity * dt;

  if (angularVelocity > 0.001) {
    requestAnimationFrame(stepSpin);
  } else {
    spinning = false;
    spinBtn.disabled = false;
    announceWinner();
  }
}

function announceWinner() {
  const idx = currentWinnerIndex();
  const winner = entries[idx];
  if (!winner) return;
  winnerNameEl.textContent = winner.text;
  winnerOverlay.classList.remove("hidden");
  triggerCelebration();
}

spinBtn.addEventListener("click", spin);
spinBtn.disabled = entries.length < 2;

// ---------------------------------------------------------------------------
// Celebration burst: tumbling 3D confetti chips + stars flying outward and
// toward the camera, plus a quick light flash. Built as InstancedMesh (not
// THREE.Points) specifically so each piece can tumble in 3D — flat point
// sprites can't rotate individually.
// ---------------------------------------------------------------------------

const CONFETTI_COUNT = 90;
const STAR_COUNT = 26;
const CELEBRATION_LIFETIME = 2.0; // seconds
const CELEBRATION_ORIGIN = new THREE.Vector3(0, WHEEL_RADIUS * 0.1, WHEEL_THICKNESS / 2 + 0.15);
const GRAVITY = -3.2;

function createStarGeometry() {
  const shape = new THREE.Shape();
  const points = 5;
  const outerR = 0.13;
  const innerR = 0.055;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: false });
  geometry.center();
  return geometry;
}

const confettiGeometry = new THREE.BoxGeometry(0.16, 0.1, 0.015);
const confettiMaterial = new THREE.MeshStandardMaterial({
  // Per-instance color comes from InstancedMesh.setColorAt (an instance
  // attribute), not per-vertex geometry colors — these geometries have no
  // `color` vertex attribute, so `vertexColors: true` would make the
  // renderer sample a nonexistent attribute (WebGL defaults it to black),
  // stomping the instance color to solid black. Leave it false/unset.
  roughness: 0.5,
  metalness: 0.1,
  transparent: true,
  side: THREE.DoubleSide,
});
const confettiMesh = new THREE.InstancedMesh(confettiGeometry, confettiMaterial, CONFETTI_COUNT);
confettiMesh.visible = false;
scene.add(confettiMesh);

const starGeometry = createStarGeometry();
const starMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.25,
  metalness: 0.7,
  transparent: true,
  side: THREE.DoubleSide,
});
const starMesh = new THREE.InstancedMesh(starGeometry, starMaterial, STAR_COUNT);
starMesh.visible = false;
scene.add(starMesh);

const flashLight = new THREE.PointLight(0xfff2c8, 0, 16);
flashLight.position.set(0, 0.5, 4);
scene.add(flashLight);

const celebrationDummy = new THREE.Object3D();
let celebrationParticles = [];
let celebrationActive = false;
let celebrationStartTime = 0;

function makeParticle(mesh, index) {
  const angle = Math.random() * Math.PI * 2;
  const outward = 1.4 + Math.random() * 3.2;
  const towardCamera = Math.random() < 0.8; // most fly at the viewer, some drift away/sideways
  const color = new THREE.Color();
  color.setHSL(Math.random(), 0.75, 0.6);
  mesh.setColorAt(index, color);

  return {
    mesh,
    index,
    velocity: new THREE.Vector3(
      Math.cos(angle) * outward,
      1.2 + Math.random() * 3,
      towardCamera ? 1.5 + Math.random() * 4.5 : (Math.random() - 0.5) * 2
    ),
    angVel: new THREE.Vector3(
      (Math.random() - 0.5) * 12,
      (Math.random() - 0.5) * 12,
      (Math.random() - 0.5) * 12
    ),
    rotation: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI),
    scale: 0.7 + Math.random() * 0.7,
  };
}

function triggerCelebration() {
  celebrationParticles = [];
  for (let i = 0; i < CONFETTI_COUNT; i++) celebrationParticles.push(makeParticle(confettiMesh, i));
  for (let i = 0; i < STAR_COUNT; i++) celebrationParticles.push(makeParticle(starMesh, i));

  confettiMesh.instanceColor.needsUpdate = true;
  starMesh.instanceColor.needsUpdate = true;
  confettiMaterial.opacity = 1;
  starMaterial.opacity = 1;
  confettiMesh.visible = true;
  starMesh.visible = true;
  flashLight.intensity = 6;

  celebrationActive = true;
  celebrationStartTime = performance.now();
}

function updateCelebration() {
  if (!celebrationActive) return;
  const elapsed = (performance.now() - celebrationStartTime) / 1000;

  for (const p of celebrationParticles) {
    celebrationDummy.position.set(
      CELEBRATION_ORIGIN.x + p.velocity.x * elapsed,
      CELEBRATION_ORIGIN.y + p.velocity.y * elapsed + 0.5 * GRAVITY * elapsed * elapsed,
      CELEBRATION_ORIGIN.z + p.velocity.z * elapsed
    );
    celebrationDummy.rotation.set(
      p.rotation.x + p.angVel.x * elapsed,
      p.rotation.y + p.angVel.y * elapsed,
      p.rotation.z + p.angVel.z * elapsed
    );
    celebrationDummy.scale.setScalar(p.scale);
    celebrationDummy.updateMatrix();
    p.mesh.setMatrixAt(p.index, celebrationDummy.matrix);
  }
  confettiMesh.instanceMatrix.needsUpdate = true;
  starMesh.instanceMatrix.needsUpdate = true;

  const fade = Math.max(0, 1 - elapsed / CELEBRATION_LIFETIME);
  confettiMaterial.opacity = fade;
  starMaterial.opacity = fade;
  flashLight.intensity = Math.max(0, 6 * (1 - elapsed / 0.35));

  if (elapsed > CELEBRATION_LIFETIME) {
    celebrationActive = false;
    confettiMesh.visible = false;
    starMesh.visible = false;
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  updateCelebration();
  filterUniforms.uTime.value = (now ?? performance.now()) / 1000;
  composer.render();
}

// ---------------------------------------------------------------------------
// Debug controls
// ---------------------------------------------------------------------------

const DEFAULTS = { cameraTilt: 6, topSpeed: settings.topSpeed, drag: settings.drag };

const dbgCameraTilt = document.getElementById("dbg-camera-tilt");
const dbgTopSpeed = document.getElementById("dbg-top-speed");
const dbgDrag = document.getElementById("dbg-drag");
const outCameraTilt = document.getElementById("out-camera-tilt");
const outTopSpeed = document.getElementById("out-top-speed");
const outDrag = document.getElementById("out-drag");
const dbgResetBtn = document.getElementById("dbg-reset");

dbgCameraTilt.addEventListener("input", () => {
  const deg = Number(dbgCameraTilt.value);
  outCameraTilt.textContent = `${deg}°`;
  setCameraTilt(deg);
});

dbgTopSpeed.addEventListener("input", () => {
  settings.topSpeed = Number(dbgTopSpeed.value);
  outTopSpeed.textContent = settings.topSpeed;
});

dbgDrag.addEventListener("input", () => {
  settings.drag = Number(dbgDrag.value);
  outDrag.textContent = settings.drag;
});

dbgResetBtn.addEventListener("click", () => {
  dbgCameraTilt.value = DEFAULTS.cameraTilt;
  dbgTopSpeed.value = DEFAULTS.topSpeed;
  dbgDrag.value = DEFAULTS.drag;
  dbgCameraTilt.dispatchEvent(new Event("input"));
  dbgTopSpeed.dispatchEvent(new Event("input"));
  dbgDrag.dispatchEvent(new Event("input"));
});

// ---------------------------------------------------------------------------
// Screen filter controls
// ---------------------------------------------------------------------------

const FILTER_SLIDERS = [
  { id: "flt-scanlines", uniform: "uScanlines" },
  { id: "flt-curvature", uniform: "uCurvature" },
  { id: "flt-vignette", uniform: "uVignette" },
  { id: "flt-chroma", uniform: "uChroma" },
  { id: "flt-posterize", uniform: "uPosterize", offLabel: true },
  { id: "flt-pixelate", uniform: "uPixelate", offLabel: true },
  { id: "flt-noise", uniform: "uNoise" },
];

const filterEls = {};
for (const { id, uniform, offLabel } of FILTER_SLIDERS) {
  const input = document.getElementById(id);
  const output = document.getElementById(`out-${id}`);
  filterEls[id] = input;
  input.addEventListener("input", () => {
    const value = Number(input.value);
    filterUniforms[uniform].value = value;
    output.textContent = offLabel && value === 0 ? "0 (off)" : String(value);
    clearActivePreset();
  });
}

const presetButtons = document.querySelectorAll(".preset-btn");
const FILTER_PRESETS = {
  none: { "flt-scanlines": 0, "flt-curvature": 0, "flt-vignette": 0, "flt-chroma": 0, "flt-posterize": 0, "flt-pixelate": 0, "flt-noise": 0 },
  crt: { "flt-scanlines": 0.4, "flt-curvature": 0.15, "flt-vignette": 0.5, "flt-chroma": 0.003, "flt-posterize": 0, "flt-pixelate": 0, "flt-noise": 0.04 },
  vhs: { "flt-scanlines": 0.25, "flt-curvature": 0.05, "flt-vignette": 0.3, "flt-chroma": 0.008, "flt-posterize": 0, "flt-pixelate": 0, "flt-noise": 0.14 },
  jpeg: { "flt-scanlines": 0, "flt-curvature": 0, "flt-vignette": 0.1, "flt-chroma": 0.002, "flt-posterize": 6, "flt-pixelate": 6, "flt-noise": 0.02 },
};

function clearActivePreset() {
  presetButtons.forEach((btn) => btn.classList.remove("active"));
}

presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = FILTER_PRESETS[btn.dataset.preset];
    for (const [id, value] of Object.entries(preset)) {
      filterEls[id].value = value;
      filterEls[id].dispatchEvent(new Event("input"));
    }
    presetButtons.forEach((b) => b.classList.toggle("active", b === btn));
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

resizeRenderer();
loop();

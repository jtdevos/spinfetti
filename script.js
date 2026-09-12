import * as THREE from "three";

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

function resizeRenderer() {
  const size = container.clientWidth;
  renderer.setSize(size, size);
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
const WHEEL_THICKNESS = 0.35;
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
  new THREE.CircleGeometry(WHEEL_RADIUS, 96),
  frontMaterial
);
frontDisc.position.z = WHEEL_THICKNESS / 2;
wheelPivot.add(frontDisc);

const backMaterial = new THREE.MeshStandardMaterial({
  color: 0x161320,
  roughness: 0.8,
  side: THREE.DoubleSide,
});
const backDisc = new THREE.Mesh(new THREE.CircleGeometry(WHEEL_RADIUS, 96), backMaterial);
backDisc.position.z = -WHEEL_THICKNESS / 2;
wheelPivot.add(backDisc);

const rimMaterial = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  roughness: 0.3,
  metalness: 0.8,
});
const rim = new THREE.Mesh(
  new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_THICKNESS, 96, 1, true),
  rimMaterial
);
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
  burstConfetti();
}

spinBtn.addEventListener("click", spin);
spinBtn.disabled = entries.length < 2;

// ---------------------------------------------------------------------------
// Confetti flourish
// ---------------------------------------------------------------------------

let confetti = null;

function burstConfetti() {
  if (confetti) {
    scene.remove(confetti);
    confetti.geometry.dispose();
    confetti.material.dispose();
  }

  const count = 160;
  const positions = new Float32Array(count * 3);
  const velocities = [];
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < count; i++) {
    positions[i * 3] = 0;
    positions[i * 3 + 1] = WHEEL_RADIUS * 0.2;
    positions[i * 3 + 2] = 1;

    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    velocities.push({
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed + 2,
      z: (Math.random() - 0.5) * 2,
    });

    color.setHSL(Math.random(), 0.8, 0.6);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.12,
    vertexColors: true,
    transparent: true,
    opacity: 1,
  });

  confetti = new THREE.Points(geometry, material);
  confetti.userData.velocities = velocities;
  confetti.userData.startTime = performance.now();
  scene.add(confetti);
}

function updateConfetti() {
  if (!confetti) return;
  const elapsed = (performance.now() - confetti.userData.startTime) / 1000;
  const gravity = -4;
  const positions = confetti.geometry.attributes.position.array;
  const velocities = confetti.userData.velocities;

  for (let i = 0; i < velocities.length; i++) {
    const v = velocities[i];
    positions[i * 3] = v.x * elapsed * 0.3;
    positions[i * 3 + 1] = WHEEL_RADIUS * 0.2 + v.y * elapsed * 0.3 + 0.5 * gravity * elapsed * elapsed;
    positions[i * 3 + 2] = 1 + v.z * elapsed * 0.3;
  }
  confetti.geometry.attributes.position.needsUpdate = true;
  confetti.material.opacity = Math.max(0, 1 - elapsed / 2.2);

  if (elapsed > 2.2) {
    scene.remove(confetti);
    confetti.geometry.dispose();
    confetti.material.dispose();
    confetti = null;
  }
}

function loop() {
  requestAnimationFrame(loop);
  updateConfetti();
  renderer.render(scene, camera);
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
// Boot
// ---------------------------------------------------------------------------

resizeRenderer();
loop();

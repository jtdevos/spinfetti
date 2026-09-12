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
// Slight offset + tilt: "forced perspective" — mostly face-on, but enough
// angle to read the wheel's rim thickness and catch some highlight motion.
camera.position.set(0, 1.5, 14);
camera.lookAt(0, 0, 0);

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

let spinning = false;
let spinStart = 0;
let spinFrom = 0;
let spinTo = 0;
const SPIN_DURATION_MS = 5200;

function easeOutQuint(t) {
  return 1 - Math.pow(1 - t, 5);
}

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

  const n = entries.length;
  const sliceAngle = (2 * Math.PI) / n;
  const targetIndex = Math.floor(Math.random() * n);

  // We want currentWinnerIndex() === targetIndex at the end, landing at a
  // random point within that slice (not dead center, for realism).
  const jitter = (Math.random() - 0.5) * sliceAngle * 0.7;
  const targetLocalAtPointer = targetIndex * sliceAngle + sliceAngle / 2 + jitter;
  const extraSpins = 6 + Math.floor(Math.random() * 4); // 6-9 full turns

  // rotation.z = POINTER_WORLD_ANGLE - localAtPointer (mod 2π), plus full turns.
  const baseTarget = POINTER_WORLD_ANGLE - targetLocalAtPointer;
  const currentRot = wheelPivot.rotation.z;
  // Find a target >= currentRot that matches baseTarget mod 2π, then add spins.
  const twoPi = Math.PI * 2;
  let delta = ((baseTarget - currentRot) % twoPi + twoPi) % twoPi;
  spinFrom = currentRot;
  spinTo = currentRot + delta + extraSpins * twoPi;
  spinStart = performance.now();

  requestAnimationFrame(stepSpin);
}

function stepSpin(now) {
  const elapsed = now - spinStart;
  const t = Math.min(elapsed / SPIN_DURATION_MS, 1);
  const eased = easeOutQuint(t);
  wheelPivot.rotation.z = spinFrom + (spinTo - spinFrom) * eased;

  if (t < 1) {
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
// Boot
// ---------------------------------------------------------------------------

resizeRenderer();
loop();

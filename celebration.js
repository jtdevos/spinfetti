import * as THREE from "three";

// Full-viewport confetti/star celebration burst. Deliberately decoupled from
// the wheel's own scene/camera (script.js) — that scene is only as big as
// the 500x500 wheel canvas, so particles rendered there can never travel
// past its edges no matter how fast we send them. This module owns its own
// full-window canvas, camera, and lights, and listens for "wheel:winner" /
// "wheel:winner-closed" events rather than being imported directly,
// matching the pattern background.js uses to stay independent of the
// wheel code.

const canvas = document.getElementById("celebration-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xfff6e0, 0x201830, 1.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
keyLight.position.set(2, 4, 6);
scene.add(keyLight);

const flashLight = new THREE.PointLight(0xfff2c8, 0, 24);
flashLight.position.set(0, 1, 5);
scene.add(flashLight);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// ---------------------------------------------------------------------------
// Geometry / materials
// ---------------------------------------------------------------------------

function createStarGeometry() {
  const shape = new THREE.Shape();
  const points = 5;
  const outerR = 0.22;
  const innerR = 0.09;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  geometry.center();
  return geometry;
}

// Multiple bursts can be alive at once (a staggered opening flurry, plus a
// steady drip while the winner card is open), each with its own origin and
// start time. Rather than one global animation, every particle carries its
// own — a fixed-size pool that spawnBurst() claims slots from round-robin,
// so bursts can overlap freely without needing per-burst mesh objects.
const CONFETTI_PER_BURST = 45;
const STAR_PER_BURST = 12;
const BURST_POOL_HEADROOM = 4; // how many concurrent bursts the pool comfortably covers
const CONFETTI_COUNT = CONFETTI_PER_BURST * BURST_POOL_HEADROOM;
const STAR_COUNT = STAR_PER_BURST * BURST_POOL_HEADROOM;
const PARTICLE_LIFETIME = 2.2; // seconds
const GRAVITY = -5;
const FLASH_DURATION = 350; // ms

const confettiGeometry = new THREE.BoxGeometry(0.26, 0.16, 0.02);
const confettiMaterial = new THREE.MeshStandardMaterial({
  // Per-instance color comes from InstancedMesh.setColorAt, not per-vertex
  // geometry colors — these geometries have no `color` vertex attribute, so
  // `vertexColors: true` would sample a nonexistent attribute (WebGL
  // defaults it to black) and stomp every instance to solid black. Leave it
  // unset; instance colors work without it.
  roughness: 0.5,
  metalness: 0.1,
  side: THREE.DoubleSide,
});
const confettiMesh = new THREE.InstancedMesh(confettiGeometry, confettiMaterial, CONFETTI_COUNT);
scene.add(confettiMesh);

const starGeometry = createStarGeometry();
const starMaterial = new THREE.MeshStandardMaterial({
  roughness: 0.25,
  metalness: 0.7,
  side: THREE.DoubleSide,
});
const starMesh = new THREE.InstancedMesh(starGeometry, starMaterial, STAR_COUNT);
scene.add(starMesh);

const dummy = new THREE.Object3D();

function makeSlot(mesh, index) {
  return {
    mesh,
    index,
    origin: new THREE.Vector3(),
    startTime: -Infinity, // "expired" sentinel so unused slots render hidden (scale 0)
    velocity: new THREE.Vector3(),
    angVel: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    baseScale: 1,
  };
}

const confettiSlots = Array.from({ length: CONFETTI_COUNT }, (_, i) => makeSlot(confettiMesh, i));
const starSlots = Array.from({ length: STAR_COUNT }, (_, i) => makeSlot(starMesh, i));
const allSlots = [...confettiSlots, ...starSlots];
let confettiCursor = 0;
let starCursor = 0;
const recentFlashes = []; // start times (ms) of flashes still fading, for overlapping bursts

// Converts a screen-space pixel coordinate into this camera's world space
// at a given world Z, so a burst spawned at an arbitrary point on screen
// lands in the right spot regardless of window size.
function screenToWorld(clientX, clientY, targetZ) {
  const ndcX = (clientX / window.innerWidth) * 2 - 1;
  const ndcY = -(clientY / window.innerHeight) * 2 + 1;
  const point = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
  const direction = point.sub(camera.position).normalize();
  const distance = (targetZ - camera.position.z) / direction.z;
  return camera.position.clone().addScaledVector(direction, distance);
}

function configureSlot(slot, origin, startTime) {
  const angle = Math.random() * Math.PI * 2;
  const outward = 2.5 + Math.random() * 6;
  // Camera-ward bias without a hard coin-flip: taking the max of two uniform
  // samples skews the distribution toward 1 (mean ~0.67 instead of 0.5), so
  // most pieces still lean toward the viewer but every value in between is
  // possible — some head straight at the camera, others drift past or away.
  const cameraBias = Math.max(Math.random(), Math.random());
  const zVelocity = -2 + cameraBias * 9; // roughly -2 .. 7, skewed positive

  slot.origin.copy(origin);
  slot.startTime = startTime;
  slot.velocity.set(Math.cos(angle) * outward, 2 + Math.random() * 5, zVelocity);
  slot.angVel.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
  slot.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  slot.baseScale = 0.7 + Math.random() * 0.7;

  const color = new THREE.Color();
  color.setHSL(Math.random(), 0.75, 0.6);
  slot.mesh.setColorAt(slot.index, color);
}

// One explosion: a batch of confetti + stars from a random point anywhere
// on screen (not tied to the wheel's position) so successive bursts don't
// all cluster in the same corner. Claims the next round-robin slots from
// the shared pool rather than allocating anything, so any number of bursts
// can be spawned over time.
function spawnBurst() {
  const cx = Math.random() * window.innerWidth;
  const cy = Math.random() * window.innerHeight;
  const origin = screenToWorld(cx, cy, 0);
  const startTime = performance.now();

  for (let i = 0; i < CONFETTI_PER_BURST; i++) {
    configureSlot(confettiSlots[confettiCursor], origin, startTime);
    confettiCursor = (confettiCursor + 1) % CONFETTI_COUNT;
  }
  for (let i = 0; i < STAR_PER_BURST; i++) {
    configureSlot(starSlots[starCursor], origin, startTime);
    starCursor = (starCursor + 1) % STAR_COUNT;
  }
  confettiMesh.instanceColor.needsUpdate = true;
  starMesh.instanceColor.needsUpdate = true;

  recentFlashes.push(startTime);
}

function update() {
  const now = performance.now();

  for (const slot of allSlots) {
    const elapsed = (now - slot.startTime) / 1000;
    if (elapsed < 0 || elapsed > PARTICLE_LIFETIME) {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0);
    } else {
      const fade = 1 - elapsed / PARTICLE_LIFETIME;
      dummy.position.set(
        slot.origin.x + slot.velocity.x * elapsed,
        slot.origin.y + slot.velocity.y * elapsed + 0.5 * GRAVITY * elapsed * elapsed,
        slot.origin.z + slot.velocity.z * elapsed
      );
      dummy.rotation.set(
        slot.rotation.x + slot.angVel.x * elapsed,
        slot.rotation.y + slot.angVel.y * elapsed,
        slot.rotation.z + slot.angVel.z * elapsed
      );
      // Fading via scale (not material opacity) because opacity is a single
      // value shared by the whole InstancedMesh — it can't represent many
      // independently-aged bursts at once, but each instance's transform can.
      dummy.scale.setScalar(slot.baseScale * fade);
    }
    dummy.updateMatrix();
    slot.mesh.setMatrixAt(slot.index, dummy.matrix);
  }
  confettiMesh.instanceMatrix.needsUpdate = true;
  starMesh.instanceMatrix.needsUpdate = true;

  // Light flash per burst; overlapping bursts combine via max() rather than
  // one flash stomping another.
  let flashIntensity = 0;
  for (let i = recentFlashes.length - 1; i >= 0; i--) {
    const age = now - recentFlashes[i];
    if (age > FLASH_DURATION) {
      recentFlashes.splice(i, 1);
      continue;
    }
    flashIntensity = Math.max(flashIntensity, 8 * (1 - age / FLASH_DURATION));
  }
  flashLight.intensity = flashIntensity;
}

function loop() {
  requestAnimationFrame(loop);
  update();
  renderer.render(scene, camera);
}
loop();

// ---------------------------------------------------------------------------
// Session scheduling: an opening flurry of 2-3 staggered bursts within about
// a second, then a steady drip of one every 1-2s until the winner card
// closes.
// ---------------------------------------------------------------------------

let sessionActive = false;
let pendingTimeouts = [];

function scheduleNextDrip() {
  if (!sessionActive) return;
  const delay = 1000 + Math.random() * 1000;
  pendingTimeouts.push(
    setTimeout(() => {
      spawnBurst();
      scheduleNextDrip();
    }, delay)
  );
}

function startSession() {
  pendingTimeouts.forEach(clearTimeout);
  pendingTimeouts = [];
  sessionActive = true;

  spawnBurst(); // first explosion, immediately
  const extraBursts = 1 + Math.floor(Math.random() * 2); // 1 or 2 more, so 2-3 total
  for (let i = 0; i < extraBursts; i++) {
    const delay = 250 + Math.random() * 700; // all land within ~1s
    pendingTimeouts.push(setTimeout(spawnBurst, delay));
  }

  pendingTimeouts.push(setTimeout(scheduleNextDrip, 1200 + Math.random() * 800));
}

function stopSession() {
  sessionActive = false;
  pendingTimeouts.forEach(clearTimeout);
  pendingTimeouts = [];
}

window.addEventListener("wheel:winner", startSession);
window.addEventListener("wheel:winner-closed", stopSession);

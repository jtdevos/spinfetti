import * as THREE from "three";

// Full-viewport confetti/star celebration burst. Deliberately decoupled from
// the wheel's own scene/camera (script.js) — that scene is only as big as
// the 500x500 wheel canvas, so particles rendered there can never travel
// past its edges no matter how fast we send them. This module owns its own
// full-window canvas, camera, and lights, and listens for a "wheel:winner"
// event rather than being imported directly, matching the pattern
// background.js uses to stay independent of the wheel code.

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

const CONFETTI_COUNT = 160;
const STAR_COUNT = 40;
const CELEBRATION_LIFETIME = 2.2; // seconds
const GRAVITY = -5;

const confettiGeometry = new THREE.BoxGeometry(0.26, 0.16, 0.02);
const confettiMaterial = new THREE.MeshStandardMaterial({
  // Per-instance color comes from InstancedMesh.setColorAt, not per-vertex
  // geometry colors — these geometries have no `color` vertex attribute, so
  // `vertexColors: true` would sample a nonexistent attribute (WebGL
  // defaults it to black) and stomp every instance to solid black. Leave it
  // unset; instance colors work without it.
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

const dummy = new THREE.Object3D();
let particles = [];
let active = false;
let startTime = 0;
const origin = new THREE.Vector3();

// Converts a screen-space pixel coordinate (e.g. the wheel-container's
// on-page center) into this camera's world space at a given world Z, so the
// burst can start exactly where the wheel visually sits regardless of page
// layout or window size.
function screenToWorld(clientX, clientY, targetZ) {
  const ndcX = (clientX / window.innerWidth) * 2 - 1;
  const ndcY = -(clientY / window.innerHeight) * 2 + 1;
  const point = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
  const direction = point.sub(camera.position).normalize();
  const distance = (targetZ - camera.position.z) / direction.z;
  return camera.position.clone().addScaledVector(direction, distance);
}

function makeParticle(mesh, index) {
  const angle = Math.random() * Math.PI * 2;
  const outward = 2.5 + Math.random() * 6;
  const towardCamera = Math.random() < 0.8; // most fly at the viewer, some drift away/sideways
  const color = new THREE.Color();
  color.setHSL(Math.random(), 0.75, 0.6);
  mesh.setColorAt(index, color);

  return {
    mesh,
    index,
    velocity: new THREE.Vector3(
      Math.cos(angle) * outward,
      2 + Math.random() * 5,
      towardCamera ? 2 + Math.random() * 6 : (Math.random() - 0.5) * 3
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

function trigger() {
  const wheelContainer = document.getElementById("wheel-container");
  const rect = wheelContainer?.getBoundingClientRect();
  origin.copy(rect ? screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2, 0) : new THREE.Vector3(0, 0, 0));

  particles = [];
  for (let i = 0; i < CONFETTI_COUNT; i++) particles.push(makeParticle(confettiMesh, i));
  for (let i = 0; i < STAR_COUNT; i++) particles.push(makeParticle(starMesh, i));

  confettiMesh.instanceColor.needsUpdate = true;
  starMesh.instanceColor.needsUpdate = true;
  confettiMaterial.opacity = 1;
  starMaterial.opacity = 1;
  confettiMesh.visible = true;
  starMesh.visible = true;
  flashLight.intensity = 8;

  active = true;
  startTime = performance.now();
}

function update() {
  if (!active) return;
  const elapsed = (performance.now() - startTime) / 1000;

  for (const p of particles) {
    dummy.position.set(
      origin.x + p.velocity.x * elapsed,
      origin.y + p.velocity.y * elapsed + 0.5 * GRAVITY * elapsed * elapsed,
      origin.z + p.velocity.z * elapsed
    );
    dummy.rotation.set(
      p.rotation.x + p.angVel.x * elapsed,
      p.rotation.y + p.angVel.y * elapsed,
      p.rotation.z + p.angVel.z * elapsed
    );
    dummy.scale.setScalar(p.scale);
    dummy.updateMatrix();
    p.mesh.setMatrixAt(p.index, dummy.matrix);
  }
  confettiMesh.instanceMatrix.needsUpdate = true;
  starMesh.instanceMatrix.needsUpdate = true;

  const fade = Math.max(0, 1 - elapsed / CELEBRATION_LIFETIME);
  confettiMaterial.opacity = fade;
  starMaterial.opacity = fade;
  flashLight.intensity = Math.max(0, 8 * (1 - elapsed / 0.35));

  if (elapsed > CELEBRATION_LIFETIME) {
    active = false;
    confettiMesh.visible = false;
    starMesh.visible = false;
  }
}

function loop() {
  requestAnimationFrame(loop);
  update();
  renderer.render(scene, camera);
}
loop();

window.addEventListener("wheel:winner", trigger);

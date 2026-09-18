# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SpinFetti — a customizable 3D prize wheel for the browser (Three.js), with
physics-based spin, a confetti/fireworks celebration, procedurally
synthesized sound effects, and retro screen-filter/background shader
experiments.

## Commands

Dependency-free static site — no `npm install`, no build step, no bundler.
Three.js loads from a CDN via an import map in `index.html`.

Run locally (must be a real HTTP server, not `file://`, since it uses ES
module imports):

```bash
python3 -m http.server 8123
```

Then open `http://localhost:8123`.

Deploy to Cloudflare Pages:

```bash
npx wrangler pages deploy .
```

`wrangler.toml` already sets the project name and output dir (`.`), so this
needs no extra flags. (There is also a dashboard-based deploy option with no
build command — see README.md.)

There is no test suite, linter, or type checker in this repo.

## Architecture

Four independent ES modules, each loaded directly by `index.html` as a
`<script type="module">`, communicating only through `window` `CustomEvent`s
(never direct imports between them). When adding a feature, keep this
decoupling — a new module should listen for events rather than reaching into
another module's state.

- **`script.js`** — the core app: entry list + localStorage persistence, the
  Three.js wheel scene (its own renderer/camera/lights), spin physics, and
  the retro screen-filter post-processing pass. Owns `#wheel-container` and
  all the debug-panel wiring in `index.html`. Dispatches `wheel:tick` (each
  slice boundary crossed while spinning), `wheel:winner` (spin settled, with
  `detail.winner`), and listens for the close button to dispatch
  `wheel:winner-closed`.
- **`background.js`** — full-viewport animated shader backdrop
  (`#bg-canvas`), entirely self-contained with its own tiny renderer/scene.
  Has no awareness of the wheel at all.
- **`celebration.js`** — full-viewport confetti/star burst
  (`#celebration-canvas`), with its own camera so particles can fly across
  the whole page (the wheel's own scene is clipped to its small square
  canvas). Uses a fixed-size round-robin `InstancedMesh` pool per particle
  type so overlapping bursts never allocate. Listens for `wheel:winner`
  (starts a staggered opening flurry + a steady drip of bursts) and
  `wheel:winner-closed` (stops the drip); dispatches `celebration:burst` per
  explosion.
- **`audio.js`** — all sound effects synthesized on the fly via the Web
  Audio API (no audio asset files). Listens for `wheel:tick`, `wheel:winner`,
  and `celebration:burst`.

### Wheel geometry and angle conventions (script.js)

Worth understanding before touching the wheel: it's a flat "poker chip" —
`CircleGeometry` front/back faces plus a rounded rim built as a revolved
(`LatheGeometry`) bevel profile, not a plain cylinder.

- Local angle convention: 0 = +x axis, increasing counter-clockwise — the
  same convention as `wheelPivot.rotation.z`. `CircleGeometry`'s UV mapping
  is a direct orthographic projection of local (x, y), so the canvas texture
  drawn in `rebuildWheelTexture()` uses that exact angle with no reverse
  mapping needed. Canvas `arc()` sweeps the opposite (visually clockwise)
  sense, so slice drawing negates start/end angles to compensate.
  `localAngleToCanvasPoint()` is the reusable local-angle → canvas-pixel
  conversion.
- The spin is a genuine angular-velocity simulation (top speed + constant
  drag deceleration), not a canned easing curve — `settings.topSpeed` /
  `settings.drag`, both live-tunable from the debug panel. Distance
  traveled and landing slice fall out of the physics rather than being
  pre-selected. `currentWinnerIndex()` derives the winning slice from the
  pointer's fixed world angle vs. the wheel's current rotation.
- The camera is constrained to a single tilt arc (rotate around X at a
  fixed distance via `setCameraTilt()`), not a free orbit.

### Screen filters and background shaders

Both `script.js`'s retro filter pass (CRT/VHS/JPEG-style presets: scanlines,
barrel-distortion curvature, chromatic aberration, posterize, pixelation,
vignette, noise) and `background.js`'s ambient shader backdrop (plasma /
aurora / radial-pulse modes) are plain GLSL uniforms wired to debug-panel
sliders in `index.html`, all defaulting to off/baseline. When adding a new
filter or background mode, follow the existing pattern: add the uniform,
add the slider markup, wire an `input`/`change` listener.

Note the `ShaderMaterial` wrapper in `script.js`'s filter pass: `ShaderPass`
clones a plain `{uniforms, vertexShader, fragmentShader}` object internally,
which would silently disconnect debug sliders from the shader. The filter
uniforms are wrapped in a real `THREE.ShaderMaterial` first so they're used
by reference.

### Entries and persistence

Entries are `{ text, color }` objects, colors cycled from the fixed
`PALETTE` array, persisted to `localStorage` under `spinfetti-entries`.
`onEntriesChanged()` is the single choke point after any mutation
(add/remove/bulk-replace): it saves, re-renders the list, and rebuilds the
wheel's canvas texture.

# SpinFetti

```
          ▽
        .-----.
       ( *  *  )
       (  **   )
       ( *  *  )
        '-----'
       S P I N F E T T I
```

A customizable 3D prize wheel for the browser. Type in your own entries —
names, prizes, Halloween candy, whatever — spin a real physics-driven wheel,
and get a burst of confetti and fireworks when it lands.

## Features

- **Your own entries** — add, remove, or bulk-paste a list; saved to your
  browser automatically.
- **A real 3D wheel**, not a flat canvas drawing — built in Three.js with a
  rounded, beveled rim for actual depth.
- **Physics-based spin** — a genuine angular-velocity simulation (top speed +
  drag), not a canned animation, with live debug sliders to tune the feel.
- **Multi-burst confetti celebration** — 2-3 staggered explosions on a win,
  then more bursts every second or two from random spots on screen for as
  long as the winner card stays open.
- **Experimental extras** — hypnotic animated shader backgrounds, and retro
  screen filters (CRT, VHS, JPEG-artifact presets) as a post-processing pass
  over the wheel.

## Running locally

This is a dependency-free static site — no build step, no `npm install`.
It just needs a real HTTP server (not a `file://` double-click) because it
uses ES module imports:

```bash
python3 -m http.server 8123
```

Then open `http://localhost:8123`.

## Deploying to Cloudflare Pages

**Option A — dashboard:** connect this repo in the Cloudflare Pages
dashboard with no build command and `/` as the output directory.

**Option B — CLI:**

```bash
npx wrangler pages deploy .
```

A `wrangler.toml` is already set up with the project name and output
directory, so this should work with no extra flags.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgements

Built with vanilla JavaScript and [Three.js](https://threejs.org). No
build step, no bundler — modules load straight from a CDN via an import
map. Designed and written with the help of
[Claude Code](https://claude.ai/code) (Anthropic).

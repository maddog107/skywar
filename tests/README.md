# SKYWAR tests

Plain `node:test` + `node:assert`, no dependencies, no build step.

```
node --test tests/     # everything, in one process (via tests/index.js)
node --test            # everything, one process per test file
npm test               # same as the first
node --test tests/flight.test.mjs   # one file
```

Whole suite runs in about 2 s once three.js is cached.

## How three.js resolves under Node

The game imports `three` / `three/addons/...` through the browser import map. `helpers/three-hooks.mjs`
registers module hooks that map those to three.js 0.186.1 files (a local `node_modules/three` if there
is one, otherwise downloaded from jsDelivr on first use into `tests/.cache/`, which is gitignored).
After the first run everything works offline.

`helpers/dom-stub.mjs` installs a no-op `document`/`window`/canvas so modules that build canvas
textures at import time can load. Nothing is rendered.

Test files must `import { src } from './helpers/setup.mjs'` first and load game modules with
`await src('world.js')` (a dynamic import), because static imports are resolved before the hooks run.

## What's covered

| file | covers |
|---|---|
| `flight.test.mjs` | Every aircraft built headlessly and flown level at full throttle with `Aircraft.updateFlight` until speed settles, at sea level and 11 km. Prints a top-speed table. Checks: `refSpeeds` stall < takeoff < approach < top speed; sea-level top speed near `flight.speed`; fitted wave-drag strength > 0; 11 km top speed within 0.03 Mach of the type's MMAX. |
| `missions.test.mjs` | `dailyMission`: deterministic per date, valid mission/fighter/time, varies over a year, never `f35n`, no subsonic jet for non-strike missions. |
| `convoy.test.mjs` | `pickConvoyBridge`: empty/null lists, missing paths, not enough road, direction choice, picks among the top three. |
| `world.test.mjs` | `baseToWorld`/`worldToBase` round trip for every base; `runwayNumbers` gives 01-36 designators, reciprocal ends, L/R only on parallels, no duplicates; `terrainHeight` finite and deterministic over a 60 km grid; airfields flattened; `isOnRunway` at runway centres and ends. |
| `damage.test.mjs` | `segmentModel` bucketing into nose / tail / wingL / wingR / center (tests the private `regionOf` through it), world positions kept. |
| `postfx.test.mjs` | `DynamicResolution` (adaptive render scale) against a synthetic GPU with 60 Hz vsync: climbs to the top level when there's headroom, settles at the level that fits for heavy scenes without thrashing (failed probes back off), ignores CPU-bound frames, copes with no / over-reading GPU timer. Quality presets sanity. |
| `smoke.test.mjs` | Every `src/*.js` imports without throwing, each in a fresh process: first with no browser globals, then with the DOM stub. Lists the modules that need the DOM at import time. `main.js` is skipped (it creates a WebGLRenderer). |

Known problems are marked `todo` rather than hidden (they show as `# TODO` and don't fail the run),
e.g. the MiG-29 wave-drag fit (see `KNOWN_BAD_WAVE_FIT` in `flight.test.mjs`). Remove the entry once fixed.

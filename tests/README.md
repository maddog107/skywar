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
| `flight.test.mjs` | Every aircraft built headlessly and flown level at full throttle with `Aircraft.updateFlight` until speed settles, at sea level, 5 km and 11 km (plus military power at 11 km). Prints a table of top speeds, the fitted drag/thrust terms (`flightCalibration`), climb rate, takeoff roll and approach speed. Checks: sea-level top speed within 0.03 Mach of `flight.speed` and 11 km top within 0.03 Mach of `flight.mach` (the two calibration points in `config.js`); 5 km in between; calibration terms sane; no supercruise-like mil-power top; takes off within 2.6 km; sane climb rate per category; `refSpeeds` ordering; approach speed below the touchdown limit. |
| `stall.test.mjs` | Types without an AoA limiter stall when pulled at the stall speed (post-stall depth, wing drop, STALL warning) and recover when the stick is eased; a full-stick turn at 1.4x stall speed doesn't stall; fly-by-wire types never post-stall. |
| `ai.test.mjs` | AI in a headless arena (real `Aircraft`/`Pilot`/`Weapons` over the real terrain, seeded `Math.random`): `steerToward` settles 30° turns without overshoot for fighters, transports and a Cessna; low-level fights among the mountains never end in the ground; the look-ahead climbs over a tall building and pulls out of a steep dive in time; an ace beats a rookie and hits a larger share of his rounds; a veteran decoys roughly a quarter of rear-aspect heat seekers with one flare salvo each; the escort C-130 circles at its route altitude within 2.4 km; at most two hostiles make gun runs on an ejected pilot (canopy and on the ground) without crashing. |
| `framerate.test.mjs` | The same stick program (and the same AI steering) at 30, 60 and 120 fps ends within 20 m, 1% speed and 0.5° of heading. |
| `missions.test.mjs` | `dailyMission`: deterministic per date, valid mission/fighter/time, varies over a year, never `f35n`, no subsonic jet for non-strike missions. |
| `convoy.test.mjs` | `pickConvoyBridge`: empty/null lists, missing paths, not enough road, direction choice, picks among the top three. |
| `world.test.mjs` | `baseToWorld`/`worldToBase` round trip for every base; `runwayNumbers` gives 01-36 designators, reciprocal ends, L/R only on parallels, no duplicates; `terrainHeight` finite and deterministic over a 60 km grid; airfields flattened; `isOnRunway` at runway centres and ends. |
| `damage.test.mjs` | `segmentModel` bucketing into nose / tail / wingL / wingR / center (tests the private `regionOf` through it), world positions kept. |
| `smoke.test.mjs` | Every `src/*.js` imports without throwing, each in a fresh process: first with no browser globals, then with the DOM stub. Lists the modules that need the DOM at import time. `main.js` is skipped (it creates a WebGLRenderer). |

Known problems are marked `todo` rather than hidden (they show as `# TODO` and don't fail the run).

`helpers/flight.mjs` builds headless aircraft (a stub game with nothing to hit, or a flat runway) and a
re-levelled level-flight harness. `helpers/arena.mjs` is a headless combat arena (no-op effects/wreckage,
box buildings with the `buildings.js` interface, `seeded()` for reproducible AI statistics).

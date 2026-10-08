# Frame-time benchmark

`bench.mjs` runs the real game in a GPU headless Chromium (Metal) and times the same AI-flown circle in each
scenario: simulation time (`game.update` and each war plug-in), the whole frame p50 / p95, draw calls and
triangles per frame (every pass: shadows, scene, post), and the JS heap.

```
node server.mjs &                        # or PORT=8190 node server.mjs in another checkout
node tools/perf/bench.mjs --scenarios dogfight,war,naval,war-night,town-low,storm --sync --out after.json
node tools/perf/bench.mjs --url http://localhost:8190/ --scenarios dogfight,war --sync --out before.json
```

- `--sync` waits for the GPU every frame (a 1-pixel `readPixels`), so frame times include the GPU's work.
  Without it they measure only what the CPU submits.
- `--quality low|medium|high|ultra`, `--size 1600x900`, `--frames 600`, `--warmup 60` (seconds of game time
  flown before timing, so streaming settles and the war develops).
- Scenarios: `dogfight`, `strike`, `naval`, `war`, `war-night`, `town-low` (low over the harbour town),
  `storm`. Their settings are in `SCENARIOS` at the top of the script.
- `Math.random` is seeded (`--seed <n>`, `--seed off`), so both builds fly into the same enemies, ejections and
  traffic; the heap is read after a full GC (`heapRawMB` in `--out` is the reading before it); `boot s` is the
  time from navigation to the menu.
- Other agents and apps share the GPU, so compare runs made back to back, and repeat a surprising one.
- Needs playwright-core: set `PLAYWRIGHT_CORE` to its `index.mjs` if it isn't installed locally (the script
  also looks in `~/git/flight-tool`). Pages read settings from a stubbed `localStorage.getItem` and never
  write it.

## Keeping it fast (conventions)

Every draw call costs the CPU about the same (three.js uniform uploads, state; ~10 µs here) whatever it draws, and
every typed array lives in the JS heap. What the performance pass settled on, for new systems:

- **Static models: merge and weld.** `meshmerge.js` `mergeStaticModel` / `mergeInPlace` give one mesh per material
  (plain materials share one, colours per vertex) and weld the result (`weldGeometry`: duplicate vertices shared
  through an index, a third to a half of the memory, the same image). Building your own merge, finish it with
  `weldGeometry` (or `mergeWelded` for a mix of indexed and non-indexed parts).
- **Transparent two-sided materials** (glass, smoke ribbons): three draws them back faces then front faces,
  switching the material's side and re-resolving its program twice a draw. Use `splitTwoSided(mesh)` (two meshes,
  same image) or let the merge do it.
- **Size on screen decides the level of detail.** Jets: `Aircraft.updateLod` (the far version under ~12 px, farmodel.js).
  Ships: near / far / very far (`Ship.updateLod`). Cars: `CarSet.commit` (the far version beyond `CAR_LOD_NEAR`).
  Small parts: `cullSmallParts(root, camPos, skip)` for moving objects, airbase.js `cullSmall` for static ones
  (`sightDistance`: a part is drawn out to where it spans ~1.4 px). Work out pixels from the camera's field of
  view, so the targeting pod's zoom still gets the real model.
- **Don't flip programs in a frame.** A material shared by meshes that differ in receiveShadow, instancing,
  instance colours or skinning re-resolves its shader program at each switch; main.js sorts the opaque queue to group
  them, but a material per variant is better still. Never set `material.needsUpdate` every frame.
- **No GL readbacks** (`getParameter`, `readPixels`, three's `copyTextureToTexture`, which reads unpack state) in the
  frame: each is a round trip to the GPU process.
- **Boot:** anything that can wait for the menu should (background loads, `warmUploadStep`, precut surfaces); the
  boot marks (`boot:terrain`, `boot:models`, `boot:towns`, …, `boot:menu`) show where the time goes.

- **Sun shadows** (shadows.js): every cascade is a shadow pass over the scene. A new shadow caster should be a merged
  mesh with a sane bounding sphere; a huge instanced one (a forest tile) can carry a tight `geometry.boundingBox` with
  `geometry.userData.shadowBox = true` so cascades hung in the air round a jet skip it. `node tools/perf/cascades.mjs`
  prints each quality's cascades (size, texel, update period, filter); `CSM.info[3] = 1` tints the scene by cascade.

To see where draws, triangles and heap go, the useful probes are: `renderer.renderBufferDirect` wrapped to count
draws per object (label objects by where they hang in the game graph), attribute bytes per allocation site
(wrap `BufferGeometry.setAttribute`, keep `WeakRef`s to the arrays, GC, sum what's alive), a CPU profile through
CDP `Profiler`, and ablations on a frozen view (photo mode: the same frame every time) — timer queries on
ANGLE / Metal don't give usable per-pass GPU times.

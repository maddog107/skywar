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
- Other agents and apps share the GPU, so compare runs made back to back, and repeat a surprising one.
- Needs playwright-core: set `PLAYWRIGHT_CORE` to its `index.mjs` if it isn't installed locally (the script
  also looks in `~/git/flight-tool`). Pages read settings from a stubbed `localStorage.getItem` and never
  write it.

# SKYWAR — notes for Claude

## Git workflow
- Commit and push after every major change (a new feature, a bug-fix sweep, a refactor), so there is
  always a known-good version to go back to if something breaks. Don't let big batches of work sit
  uncommitted.
- Work on the `skywar-2` branch. After committing, push it (`git push origin skywar-2`), then
  fast-forward `main` to it and push `main` too.
- Before committing, check every source file parses (`for f in src/*.js; do node --check $f; done`),
  the test suite passes (`node --test tests/`, see tests/README.md) and the game starts in the browser
  without console errors.
- Write a short, descriptive commit message listing what changed.

## Engine
- three.js 0.186.1 via the import map in index.html (no build step). Uses a reversed float depth buffer
  (see src/main.js); custom shaders that write clip-space z must handle `USE_REVERSED_DEPTH_BUFFER`, and
  polygonOffset units go through `offsetUnits()` in src/util.js.

## Running
- `node server.mjs`, then open http://localhost:8080.

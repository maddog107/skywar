# SKYWAR: where we left off (2026-11-21)

Live at https://maddog107.com/skywar/ (deploy: `tools/deploy.sh main`; target in the untracked `.deploy.env`).
`main` = `skywar-2` = 03c899c, all pushed and deployed. Tests: 1,539, 1,538 pass, 1 skipped.

## Live now (done this session)
- Multiplayer (rooms, PvP guns/missiles/flares, co-op AI bandits with N, host migration, Tab / SCORE scoreboard), and
  since protocol 2: bombs, rockets and their impacts seen by everyone, town buildings destroyed alike for all, late
  joiners get the ruins. Relay: sandboxed systemd service behind nginx (docs/MULTIPLAYER.md, "Production").
- Fireball explosions from baked fire simulations (models/fx, src/flipbook.js).
- Weapons drawn on the jets' pylons and released from them (src/pylons.js).
- Physical sky, sunlight and haze (src/atmosphere.js, docs/ATMOSPHERE.md).
- Redone town buildings: procedural facades, roofs, lots, night lighting (src/facades.js, src/towns.js).

## 1. Finish the clouds (next up)
Unmerged work on the local branch **`clouds-wip`** (3bc7213; also checked out in the worktree
`.claude/worktrees/agent-a193892ecb34891c4`). Branched from 367a0ea, so it lacks the towns and multiplayer merges:
merge it into `skywar-2`, don't rebase. Files: src/clouds.js, src/cloudnoise.js, src/weather.js (cloud parameters),
src/ocean.js (6 lines), src/world.js (2 lines), tests/clouds.test.mjs, docs/ATMOSPHERE.md ("Clouds"), tests/README.md.

What it does: cumulus with crisp growing tops and ragged evaporating sides, flat darker bases, light by which way the
surface faces, sky light from the atmosphere, a high cirrus/altocumulus layer in its own cheap pass, thunderstorm cells
(trunk, turreted walls, anvil), storm cost cuts (empty-space skipping by an anvil map), sea reflection of clouds.

Still to do before merging:
- `for f in src/*.js; do node --check $f; done` and `node --test tests/` on the merged result.
- Before/after contact sheets (old = main, new = branch) with tools/shots/harness.mjs: clear / cloudy / rain / storm x
  day / dusk (+ night), from 300 m looking up, beside a big cumulus at cloud level, above the tops at 4,000 m, inside a
  cloud edge, straight up at the high cloud. Look at them: no blobs, no "popcorn" (the owner's word for the old ones).
- Check the known bug: at dusk the clouds' image on the sea broke into stacks of horizontal pink stripes, one per
  cloud (main build, 300 m over the big city looking across the bay). The branch's later commits fixed stripe/ladder
  artefacts in the shadow map and in tower flanks: confirm it is gone.
- Temporal stability (camera passing a cloud at 250 m/s: no boiling or flicker), cloud shadows lining up with clouds
  from straight above.
- Cost: `node tools/perf/bench.mjs --scenarios dogfight,war --sync --frames 300` old vs new on a quiet machine; no
  camera more than ~5% slower, 'low' as cheap as before.
- What AI, missile seekers and sensors can see through cloud must not change by accident (CPU copy of the field must
  match the shader; tests/nightweather.test.mjs, tests/clouds.test.mjs).
- Then: push `skywar-2`, fast-forward and push `main`, `tools/deploy.sh main`, remove the worktree and `clouds-wip`.

## 2. Small fixes worth doing
- **Bomb aiming (CCIP pipper)**: `predictBomb` in src/weapons.js starts from the old belly release point
  (`ac.pos` 2.2 m down), but bombs now leave from a pylon station (src/pylons.js `releaseStore`): a few metres off.
  Predict from the station the next bomb will use (a "peek" that doesn't release it).
- **Multiplayer**: the X-100 is allowed in PvP (probably should not be); career XP accrues from multiplayer kills;
  bridges and airbase buildings are indestructible in multiplayer; no ejecting in multiplayer; partial building damage
  is not sent to late joiners (only fallen buildings).
- **Dusk/dawn** ground about 10% darker since the physical sky; lens flare weaker at dusk. Check against photos.
- **Fireballs**: atlases use ~128 MB of GPU memory on high/ultra (consider smaller atlases on medium); slightly soft
  close up; a short gap at night after the fireball burns out and before the smoke reads.
- **Towns**: street level costs +5-9% (levers: narrow the near-window range, drop balcony shadows); lit windows stay
  lit while a building falls; terrain can poke through block ground patches on rough ground; airbase buildings still
  use the old plain shader.

## 3. Bigger ideas (not started)
- Per-panel wing flight model (lift per wing section: realistic stalls, spins, asymmetric damage).

## How to check a change (from CLAUDE.md and this session)
- `node --check` every src file, `node --test tests/`, the game starts with no console errors
  (`node tools/shots/harness.mjs out.png '{"mode":"dogfight"}'`).
- Multiplayer: `node tools/net/e2e.mjs --url http://localhost:8080/` (restart `node server.mjs` first if relay.mjs or
  the protocol changed), and after deploying `node tools/net/e2e.mjs --url https://maddog107.com/skywar/`.
- The bench numbers swing 20-40% when other heavy work runs on the machine: compare on a quiet machine.

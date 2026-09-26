# SKYWAR: the living war (design and conventions)

The goal: SKYWAR grows from "take off, dogfight, land" into a military aviation sandbox where the player
is one pilot in a larger conflict. Aircraft, ships, missile batteries, radars, drones, ground forces and
command centres all operate at once and affect each other. The loop to support is:

**reconnaissance → detection → identification → planning → defence suppression → strike → air combat →
damage assessment → consequences on the battlefield.**

Systems must interact rather than sit as decoration:
- A radar that's destroyed shrinks the enemy's detection.
- A dropped bridge stops the convoy behind it.
- A TEL found before it fires never launches.
- Damage persists for the rest of the war.

This file is the shared contract for everyone working on it: the owner's request, how the work is split,
and the conventions every part follows. Read it before touching the war systems.

## The owner's request, in short

- **Strategic strikes:** find a target, mark it, transmit it, request a strike, and watch the missile
  launch from somewhere else and fly to the target. Never just spawn an explosion.
  - Launch sources: missile bases and silos, SCUD-style TELs, destroyers and cruisers (VLS), submarines,
    coastal batteries, forward and temporary positions, rocket artillery and friendly aircraft.
  - Strike types: cruise, hardened-target (penetrator), naval, air, rocket artillery, anti-ship, runway
    attack and multi-target.
  - A missile camera with follow, rear chase, side, target-facing and impact views. The player can leave it
    at any time.
- **Mobile forces:**
  - TELs that drive, hide, deploy their stabilisers, raise the missile, fire, lower it and relocate. They
    hide in forests, valleys, tunnels and camouflaged compounds.
  - Mobile SAM groups (radar, command, launchers, support) that relocate when discovered.
  - Rocket artillery (MLRS, HIMARS, Grad and Smerch style).
  - Convoys that really travel between bases.
- **Naval:**
  - Carrier strike groups with carrier, destroyers, cruisers, a supply ship and a nearby submarine. The
    escorts fight.
  - Working VLS: the cell opens, the missile rises vertically, climbs, turns and accelerates away.
  - Submarine launches that break the surface.
  - Carrier operations: launches, recoveries, deck crews and elevators.
  - Layered naval air defence.
- **Air support:**
  - AWACS, which gives a radar picture and radio calls with bearings.
  - Tankers flying orbits, with aerial refuelling.
  - Reconnaissance aircraft and drones that reveal targets.
  - EW aircraft that jam radars and suppress SAMs.
  - Enemy bombers.
- **Bases:**
  - Airbases that feel alive.
  - Alert states: normal, alert, attack, damaged.
  - Components with real functions: runway, taxiway, tower, radar, shelters, fuel, ammunition.
  - Ground missile installations.
  - Underground mountain complexes with several entrances, blast doors, and aircraft that taxi out of the
    mountain.
- **Radar and electronic warfare:** coverage zones that matter, and gaps where radars are destroyed.
- **Intelligence:** the player builds knowledge gradually, from unknown facility to possible missile
  storage to confirmed underground missile facility.
- **Tactical map:** shows only what is known. Unknown areas stay unknown.
- **Command and tasks:** dynamic tasks generated from what is happening, which the player can accept or
  ignore. Support requests. Wingman commands (attack my target, cover me, engage fighters, attack ground,
  RTB, hold, escort).
- **Damage assessment:** after a strike, fly over the target and take sensor imagery to assess it.
- **Front line:** ground forces gain or lose territory, and the player's missions move it.
- **Night and weather:**
  - Missile exhaust lights the clouds.
  - Launch flashes, burning targets, searchlights and runway lights.
  - Clouds hide targets, storms cut visibility, and fog makes low flying harder.
- **Sandbox (Free Play):** spawn aircraft, ships, bases, TELs, SAMs and convoys. Choose a faction. Change the
  weather and time. Set patrol routes and missions. Designate targets, request strikes, and watch the AI
  fight a war you set up.
- **On foot and inside:**
  - Enter a TEL truck, an intelligence and command building, a submarine (reached by a small military
    boat) and an aircraft carrier. Each has interactive screens and buttons for launching missiles
    yourself.
  - A better AK-47, plus a Desert Eagle, a pistol, a rocket launcher and more, with different damage.
  - Enemy soldiers to fight, and cars to blow up.
- **Water:** real water, and a seaplane that lands on the sea and on lakes.
- **Quality:** as detailed as possible. Use real reference, and online models where good licensed ones
  exist.

## How the work is split

- **Phase A (parallel):**
  - Water and seaplane.
  - Infantry weapons and enemy soldiers.
  - Model sourcing: ground vehicles, naval vessels, support aircraft.
- **Phase B (core):**
  - The war layer.
  - Registry, intel, radio, command menu, designation.
  - Strike manager and strategic missiles.
  - Missile camera.
- **Phase C (plug-ins, in waves):**
  - Mobile forces.
  - Naval operations.
  - Air support and EW.
  - Airbases alive.
  - Underground bases.
  - Interiors and boats.
  - Tactical map and sensors.
  - Tasks, wingmen, BDA and front line.
  - Sandbox tools.
  - Night and weather drama.

## Conventions (everyone)

- **Factions:** `'blue'` is the player's side, `'red'` the enemy, `'neutral'` civilians. This is the
  existing `team` field.
- **World space:**
  - Metres, y up, sea level at y = 0.
  - Sea and lakes are one water plane at y = 0: a lake is terrain below 0.
  - `terrainHeight(x, z)` gives the true ground. `game.surfaceAt(x, z)` gives the drawn ground, including
    towns, bridges, craters and ship decks.
- **Units:** anything military that matters (a vehicle, a site, a ship, an aircraft, a soldier, a facility)
  follows the duck-typed interface the existing code already uses:
  - `pos` (a live `THREE.Vector3`), `team`, `alive`, `name`, `radius` and `hitRadius`;
  - `damage(amount, source, kind)`, `isGround` or `isShip` as appropriate;
  - plus, for the war layer, `cls` (a class string; see below), optionally `hardened` (0..1, how much a
    normal warhead is resisted) and optionally `conceal` (0..1, how hard it is to spot).

  Units register with the war layer (`game.war.add(unit)`, Phase B); until then, keep them in your
  system's own list.
- **Class strings (`cls`):** `sam`, `sam-radar`, `radar`, `aaa`, `tel`, `artillery`, `command`, `vehicle`,
  `convoy`, `tank`, `infantry`, `ship`, `carrier`, `sub`, `aircraft`, `helicopter`, `airbase`, `runway`,
  `hangar`, `shelter`, `fuel`, `ammo`, `tower`, `bunker`, `facility`, `entrance`, `silo`, `bridge`.
- **Systems plug in, they don't sprawl.** New gameplay lives in its own module (`src/<name>.js`). The game
  creates it and calls optional hooks: `start(mode, opts)`, `update(dt)`, `clear()`, `onAction(a)` (return
  true if consumed), `drawHud(ctx, hud)`, `drawMap(ctx, map)` and `commands()`. The registry is
  `src/systems.js`, one line per system. Keep edits to shared files (game.js, hud.js, input.js, main.js,
  config.js) small and surgical.
- **Performance:** the game runs at 2–4 ms CPU per frame; keep it there.
  - Anything numerous is instanced or merged.
  - Anything far away is simulated coarsely (a position moving along a route, no mesh) and gets a mesh near
    the camera.
  - No per-frame allocation in hot paths.
  - Measure before and after, and say what it cost.
- **Tests:** every `src/*.js` must pass `node --check`, and `node --test tests/` must pass (see
  tests/README.md). Add tests for logic that can be tested headless.

## Model conventions

- **Format and scale:** a GLB in `models/<group>/` (`vehicles`, `ships`, `aircraft`, `weapons`), at
  real-world size in metres. Facing −Z, +Y up, wheels or keel at y = 0 (ships: waterline at y = 0).
- **Sources:**
  - Online models only with CC0 or CC BY licences; no NC and no ND. Sketchfab CC BY via the Objaverse
    mirror works well; see tools/aircraft/IMPORTS.md for the pipeline and licence checks.
  - Credit every model in the folder's CREDITS.md and in the game's credits list (`buildCredits` in
    src/main.js).
  - Where nothing good exists, build it in Blender (`/opt/homebrew/bin/blender -b -P …`) from real
    drawings and dimensions (tools/aircraft_kit.py and tools/ships/ are examples), detailed enough to
    stand next to the online models.
- **Moving parts:** separate named nodes with their origin on the pivot, so code can animate them.
  - `erector`: rotates about +x to raise the missile.
  - `missile`, `missile_1..n`, `canister_1..n`.
  - `jack_fl`, `jack_fr`, `jack_rl`, `jack_rr`: move down −y to deploy.
  - `turret` (about y), `launcher` (about x), `antenna` (about y).
  - `door_*`, `hatch_*`, `vls_<n>` (cell doors), `elevator_*`, `boom` (tanker).
  - Empties (Object3D) mark muzzles, exhausts and seats: `muzzle_1..n`, `exhaust`, `seat_driver`,
    `hatch_entry`.
- **Budgets and textures:** typical budgets are 10–30k triangles for a vehicle or aircraft and 60–150k for a
  big ship. JPEG/WebP textures up to 1024 (2048 for a hero model), one or two materials. Keep glass and
  paint material names meaningful; liveries skip `glass|canopy|tyre|wheel|…`.

## The war layer (Phase B), for plug-ins

Filled in as it's built: `src/war.js` (registry, intel, radio, designations), `src/strikes.js` (strike
requests, launch sources, strategic missiles, missile camera), `src/command.js` (the in-flight command
menu).

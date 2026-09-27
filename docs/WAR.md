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
  true if consumed), `drawHud(ctx, hud)`, `drawMap(ctx, map)`, `mapActions(sel)`, `mapInfo(sel)`,
  `mapPick(x, y, map)`, `commands()`, `updateCamera(cam, dt)` and `flyJet(dt, jet, stick, mouse)`. The registry is
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

## Ground vehicles (`src/vehicles.js`)

Rigged military vehicles built by `tools/vehicles/` (Blender scripts, `models/vehicles/*.glb`, CC0). The
`VEHICLES` table gives each one's real name, `cls`, team, paint, real dimensions, crew, armament, its rig `parts`
and its `deploy` sequence (the pose groups to run, in order, from travel to firing).

- Loading: main.js starts `preloadVehicles({ background: true })` after the boot's preloads; `await
  vehiclesReady()` before `createVehicle(id, { paint })`, which returns `{ object, rig }` (geometry and materials
  shared, so copies are cheap). `staticVehicle(object)` merges a posed copy into a few draw calls for parked or
  distant vehicles.
- Posing (every input 0..1 unless noted; nothing allocates): `pose(rig, group, k)` for any group, with
  `deployJacks`, `deployPad`, `raise` (erector / mast / lifting frame), `openDoors`, `openHatches`;
  `aim(rig, yaw, pitch)` (radians: + yaw left, + pitch up; clamped to the joint limits); `spin(rig, dt)` (radar
  antennas at their own rpm); `roll(rig, metres[, metresRight])` and `steer(rig, angle)` (wheels, track
  scroll); `stow(rig)`. Hydraulic rams follow on their own.
- Launch points: `muzzleWorld(rig, i, pos, dir)` for tube / rail / canister `i` (the `muzzle_n` empties, −z along
  the launch direction). TEL missiles are nodes (`rig.missile`, `missile_n`): hide or reparent them at launch;
  `nozzle` empties mark their exhausts.

### Aircraft rigs (support aircraft, `src/rigparts.js`)

Aircraft models are cut into damage sections when loaded, which merges every mesh, so an aircraft's moving
parts are pulled out first and every instance gets its own copy, hung on the section it rides on:
`ac.rig.parts` maps each node name to that instance's node.
- **Nodes:** `rotodome` (turns about its own +y); `boom` (flying boom, hinge at its origin, lying along +z) >
  `boom_ext` (telescope) > `boom_nozzle` (empty at the tip); `drogue_l` / `drogue_r` / `drogue_c` (hose exit) >
  `hose_*` (1 m long, stretched) and `basket_*` (the coupling); `rig_*` for anything else. Node custom
  properties arrive as `userData` (boom: `pitchMin`/`pitchMax`/`yawMax` in degrees; `boom_ext.travel` and
  `drogue_*.hose` in metres).
- **Helpers:** `setBoom(rig, pitch, yaw, ext)` (radians down / right, metres out), `stowBoom(rig)`,
  `trailDrogue(rig, 'l' | 'r' | 'c', k)` (0 reeled in … 1 trailed), `spinRotodome(rig, dt, rpm)` and
  `rigPoint(ac, name, out)` (a node's world position). The rotodome turns by itself while the aircraft is alive
  (its `userData.rpm`, 6 by default, airborne; ¼ rpm on the ground; `ac.radarRpm` overrides).
- **The types:** E-3G and A-50U (`rotodome`); KC-135R (`boom` and wing drogues `l`/`r`); Il-78M (drogues `l`, `r`
  and `c`, the centre one on the rear fuselage, 26 m of hose); MQ-9A (a spinning pusher) and RQ-4B; B-52H and
  Tu-95MS (eight contra-rotating props: a MODEL_FILES prop's `dir: -1` turns it the other way); EA-18G Growler
  (a fighter in the support group), U-2S and RC-135W (no moving parts beyond flaps; receivers carry `refuel`).
  `tests/supportac.test.mjs` lists each type's rig nodes.
- **Receivers:** `REFUEL` in rigparts.js gives each receiver an empty named `refuel`: the boom receptacle
  (`userData.kind === 'boom'`) or the extended probe's tip (`'probe'`).
- **Categories:** `support` (AWACS, tankers, reconnaissance and EW) and `drone` join `fighter`, `bomber`,
  `racer` and `civil`; `hasEjectionSeat(spec)` in config.js says who can eject. A type's `group` lists it
  under another hangar heading (the EA-18G is a fighter listed with the support types), and `maxBank` (rad)
  caps the AI's bank for it (the heavies fly at about 35°).
- **Frozen models:** a model frozen with `freezeLocal()` must pass its rig parts as `moving`.

## The war layer (Phase B), for plug-ins

### Controls
- **Tactical map:** backtick or F2.
- **Command menu:** backslash or F3. 1–9 choose, 0 goes back, Esc closes.
- **Mark target:** comma. It marks the HUD's locked target, or the ground under the nose (the crosshair on foot).
- **Targeting pod:** period (src/sensors.js; its keys are below).
- **Missile camera:** K. While it's on, V cycles the view: chase, follow, side, target, impact.

### `game.war` (src/war.js), always present
- **Registry:**
  - `war.add(unit, { cls, name, known, conceal, hardened, value, contactName })` returns the record `{ id,
    unit, cls, team, name, contactName, known, lastPos, lastSeen, source, conceal, hardened }`.
  - `war.remove(unit)`, `war.rec(unit)`, `war.known(unit)`.
  - Ground targets, ships and aircraft are picked up automatically every 0.5 s (`sync`). Plug-ins add
    their own units directly. Dead units stay registered, so damage persists and BDA can check them. A
    unit with `removed = true` is dropped.
- **Queries:** `war.near(pos, r, { cls, team, minKnown })` returns `[{ u, rec, d2 }]`, nearest first.
  `war.label(unit)` gives what the player's side calls it: its real name once IDENTIFIED, the contact name
  before.
- **Intel:**
  - `INTEL.UNKNOWN (0) → CONTACT (1) → IDENTIFIED (2) → CONFIRMED (3)`.
  - `war.reveal(unit, level, source)` only ever raises the level. Sensors call it: the TGP, AWACS,
    drones, recon aircraft and radar.
  - The player's eyes and air-to-air radar are built in (`updateSensors`). They take into account range
    by size, daylight, weather, the view cone, terrain line of sight, and a unit's `conceal`. A unit whose
    `firingT` (war.time) was in the last 3 s is easy to spot.
  - New contacts and identifications are announced on the radio and emitted as `warContact` and
    `warIdentified`.
- **Intel reports (search areas):** `war.report({ text, center, radius, unit, cls })`. It's resolved
  automatically when `unit` is identified: the radio says "TARGET IDENTIFIED" and `warReportResolved` is
  emitted.
- **Marks:**
  - `war.designate(unitOr{x, z}, source)` returns `{ id, unit, pos, fixed, label, grid, transmitted }`.
    A point gets the ground's height. Marking a unit confirms it.
  - `war.undesignate(d)`, `war.transmit(list)`. At most 8 marks.
- **Radio:** `war.radio(from, text, { color, say, priority })` goes to the HUD feed, the log
  (`war.radioLog`) and speech, and emits `radio`.
- **Geography:**
  - `war.grid(x, z)` gives a reference like "KD 412 883". `war.describePos(pos)` gives
    "7.2 KM BRG 045 · GRID …". `war.parseGrid(ref)` (also exported as `parseGrid`) is the inverse:
    "KD 412 883", "kd412883" or "KD 41 88" (1-4 digits a side) → `{ x, z, size }`, the centre of the square
    it names, or null.
  - `war.sideAt(x, z)` returns 'red' or 'blue' from the front line (`war.front`: points west to east;
    change it with `war.setFront(points)`, which emits `warFront`).
- **The player's radar** looks along the jet's nose (not the camera: the head or the targeting pod may look
  elsewhere).
- **Radar coverage:** `war.coverage(team, pos)` returns 0..1 for that team's radar network, from units of
  class `radar`, `sam-radar` or `awacs`, or any with `radarRange`. It accounts for the radar horizon,
  terrain masking and `jammed` (war.time until jamming ends).
- **Clearings:** `war.addClearing(x, z, r)` keeps an installation's ground free of trees and replants
  nearby tiles.

### `game.strikes` (src/strikes.js)
- **Missiles:** `MISSILES` (tlam, kalibr, harpoon, atacms, penetrator, scud, gmlrs, grad) and
  `STRIKE_TYPES` (cruise, naval, hardened, ballistic, rocket, antiship, runway, multi, air). Each strike
  type says which launcher kinds can fly it.
- **Requests:**
  - `strikes.request(type, marks, team)` finds the nearest sources with stock and range, and queues their
    launches. The shooter reports on the radio.
  - The result is known only when someone sees it (`observed`). Otherwise a BDA request waits until the
    player looks at it within about 6 km for 2 s. Plug-ins can push watcher functions (`pos → bool`) to
    `strikes.watchers`, e.g. drones.
  - Events: `strikeRequested`, `strategicLaunch`, `strategicImpact`, `strikeDone`, `bda`.
- **Launch sources:** register with `strikes.addSource(src)`. Each keeps a stock and runs its launch
  sequence.
  - `new ShipVLS(mgr, ship, { stock, cells })`: set `cellOpen(cell, k)` to animate real VLS doors.
  - `new SiloSite(mgr, {x, z}, { stock, count })`.
  - `new GroundLauncher(mgr, vehicle, { kind: 'launcher' | 'artillery' | 'battery', stock, elev, muzzle,
    prepare })`: `prepare` is the hook to erect a TEL's launcher before firing.
  - `new SubLauncher(mgr, sub, { stock, tubes })`.
  - Or subclass `LaunchSource`: `launchFrame(out, dir, q)`, `prepTime(specKey)`, `launchEffects`.
- **Strategic missiles:** they have `pos`, `vel`, `team`, `alive`, `hp` and `damage(amount)`, so air
  defences can shoot them down (`intercepted`). `strikes.missiles` lists those in flight.
- **Already in place:** a blue escort destroyer (USS Mason, 8 TLAM and 4 Harpoon) with the home carrier,
  and a blue missile field near the home base (TLAM, ATACMS, penetrators). The Phase C plug-ins replace or
  extend these.

### `game.command` (src/command.js) and `game.tacmap` (src/tacmap.js)
- **Command menu:** plug-ins add entries through `commands()`: `[{ path: ['SUPPORT'], label, hint,
  enabled, run, keepOpen, badge }]`. Categories are listed in a fixed order: TASKS, TACTICAL SUPPORT,
  DESIGNATION, SUPPORT, WINGMEN, MISSILE CAMERA, SANDBOX, then any others.
- **Tactical map:** plug-ins draw with `drawMap(ctx, map)` (`map.toScreen(x, z)`, `map.scale` in px/m)
  and add panel buttons for the selection with `mapActions(sel)`. `sel` is `{ kind: 'unit' | 'mark' |
  'report' | 'point', … }`.

### `game.sensors` (src/sensors.js) and `game.mapkit` (src/mapkit.js)
- **Targeting pod (Sniper / LITENING style):** period brings its video up full screen; the main camera becomes
  the pod's (no second render pass), graded by `SensorPass` in src/postfx.js while `game.sensorView` is set.
  - Keys with the video up: mouse or arrows slew; wheel or +/- field of view (WIDE 4°, MED 1.5°, NARO
    0.5°); T, Tab or left click track (POINT on a unit in the gate, else AREA on the ground); right click or
    M break the track (POINT → AREA → snowplow); C slaves to the steerpoint, else the newest mark; V (or I)
    cycles WHOT / BHOT / TV; space fires the laser (exact range, `L` on the display); comma marks the unit in
    the gate or the SPI (`war.designate(…, 'tgp')`); H toggles the autopilot's orbit round the SPI.
  - Track modes: `SP` (snowplow: the ground ahead), `AREA`, `POINT`, `RATES` (space-stabilised, above the
    horizon), `INR` (a point track coasting on the unit's last velocity while it's hidden; after 8 s it
    settles into AREA).
  - The gimbal stops 25° short of straight aft; the airframe masks it (`podMask`, `maskDepression`: the
    pod hangs under the right side of the intake); clouds on the line of sight blind it
    (`sensors.transmittance(a, b)`, from the clouds' own density field).
  - With the video up it identifies what's in the picture at pod ranges (`podIdentRange`: ~25 km in NARO on
    a clear day, less in WIDE, at night on TV, in rain; hot engines help the FLIR) through
    `war.reveal(u, level, 'tgp')`.
  - `sensors.pod` is its state: `{ on, mode, unit, spi, hasSpi, los, fov, sensor, lasing, masked, limit,
    cloud, range }`. `sensors.slaveTo(unitOrPoint)` points it (the map's SLAVE TGP HERE and the command
    menu's TARGETING POD entries use it). Closed, it keeps its track and the HUD shows a TGP box on the SPI.
  - Heat for the FLIR comes from `sensors.heatOf(unit, rec)` (running engines, firing, fires); a unit can
    set its own later if needed. Vehicles on roads are drawn with the road's distance lift, so the pod aims
    at `drawnPos(u)`.
- **Pod autopilot (`flyJet`):** while the video is up the jet holds altitude, attitude (wings level holds the
  heading) and speed; A/D roll to a new bank that's held, W/S move the held altitude, Z/Shift the held speed;
  H flies a right-hand orbit round the SPI. When the video goes down it keeps holding until the pilot
  touches the controls. game.js calls `flyJet(dt, jet, stick, mouse)` on every system after the stick is
  mapped, so a system can take the controls.
- **Helmet sight:** with the head (cockpit) or the camera (chase) turned off the nose, a JHMCS-style aiming
  cross shows what's under it; comma marks it (`'hmcs'`).
- **Radar picture:** `sensors.tracks` (a Map unit → `{ vel, alt, speed, t }`): air contacts as a sensor last
  had them. The map draws their heading and altitude; the HUD's scope shows only what the war layer knows.
- **BDA imagery:** the pod pushes a watcher onto `strikes.watchers`; when a `bda` result comes in while the pod
  (or the pilot) is looking, the frame is kept: `sensors.imagery` entries `{ canvas, pos, result, grid,
  clock, source ('TGP' | 'HUD'), strike, aim, mark, unit }`, also set as `aim.imagery`; `bdaImagery` is
  emitted.
- **Map kit:** a tool strip (LEGEND, RULER, MARK BY COORDINATES, layer toggles in `tacmap.layers`: threats,
  intel, roads, units, labels), the cursor's grid and bearing/range, SET STEERPOINT (`game.navTarget`,
  `{ pos, label, steer: true }`) and SLAVE TGP HERE on any selection.
- **Map hooks for plug-ins:** `mapInfo(sel)` returns panel lines `{ text, color, font }` or pictures
  `{ image, caption }`; `mapPick(x, y, map)` returns a selection of the plug-in's own (tried after units and
  marks); the panel shows plug-in info for kinds it doesn't know. The close-zoom background is a tile pyramid
  (src/maptiles.js) painted by a pool of map workers.

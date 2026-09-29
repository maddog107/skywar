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
  `hangar`, `shelter`, `fuel`, `ammo`, `tower`, `bunker`, `facility`, `entrance`, `silo`, `bridge`, `taxiway`,
  `power`.
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
  'report' | 'point', … }`. A system can also put clickable buttons anywhere on the map from `drawMap` by
  pushing `{ x, y, w, h, run }` (screen px) onto `map.buttons` (tasks.js does this for its task list).
- **Town names:** `mapName` on each town; front.js names them all at the start of a war (`nameTowns`), in
  the same scheme the map uses, so radio calls and the map agree.


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

## The living war (Phase C: director, front, tasks, wingmen)

### The LIVING WAR mode (`'war'`)
- The full dynamic war, on the mode cards after MISSIONS. Infinite jets: a new one at the friendly airfield
  or the carrier nearest where the last went down (the `respawnPoint()` system hook in game.js), without
  resetting anything. The enemy airbase and its defences are live (`GroundForces.spawnEnemyBase`), so is
  the enemy carrier group, and everything below runs. No soft boundary.
- The HUD objective line shows the war: how far the front has moved (km, mean), the balance, tasks done.
  COMMAND › SORTIE › END SORTIE banks the score (full career XP) once you're stopped on a friendly pad.
- **Sandbox** runs the same war, shaped by the sandbox toolkit (below: `game.sandbox`). **Free Flight** stays peaceful (marks and
  strikes only). The other modes don't run any of it; wingmen take orders wherever there are wingmen.
- Damage persists for the whole session: nothing destroyed is rebuilt (radars stay down, SAM sites stay
  dead, bridges stay down and keep cutting supply), and destroyed fuel and ammunition keep burning.

### `game.front` (src/front.js): the front line and the ground war
- **Sectors:** the fighting stretch of `war.front` (x −32…+36 km) is resampled into control points every
  2 km and split into ~12 km sectors (`front.sectors`: `{ name, center, normal (into red), blue, red,
  supply: { blue, red }, off (m moved, + = into red), vel (m/s), intensity (0..1), contested, offensive }`).
  The ends stay put; `war.setFront` is called as it moves (every 2 s at most). `war.sideAt` is a polygon
  test now, so a front that bends back on itself still answers correctly.
- **Fighting:** every second each side loses strength in proportion to the other's (artillery alive in a
  sector adds to red's fire) and rebuilds toward 100 at a rate set by its supply. Past a 45/55 balance the
  line moves at up to 6 m/s, never within 5.5 km of an airbase of the side giving ground, and at most 7 km
  from where the war started. Offensives (random, more often near the player; `front.offensive(sector,
  team)`) add strength and firepower for a few minutes.
- **What moves it:** any red or blue unit destroyed within 30 km of the line weakens its side's sector by
  what it's worth (artillery 9, command 10, tank 5, SAM 5, radar 4, AAA 3, vehicle 2, +1 for a convoy
  vehicle), less the deeper behind the line it was. A bridge down within 16 km of a sector cuts the supply
  of the side it's on; destroyed fuel and ammunition, and the enemy command bunker, cut it too, for as long
  as they stay destroyed. Convoys that arrive add supply (`front.deliver(pos, team, amount)`).
  `front.hit(sector, team, amount, why)` is the raw lever.
- **Near the camera:** shell impacts and muzzle flashes, rumble, smoke from burning wrecks, tracer across
  the line; engagement zones of real ground units (ground.js tanks and Shilkas, BTR-80s against Abrams,
  Strykers and Humvees) in the one or two sectors nearest the player, which trade fire, get reinforced from
  behind, move with the line, and go away when the player leaves (`front.zoneUnits(sector, team)`). Their own
  fire uses the source `{ isFront: true }`, which scores nothing and isn't counted twice in the strengths.
  Stretches of front over the sea (`sector.sea`) stay quiet.
- **Artillery:** red BM-21 Grad batteries (three launchers, war class `artillery`) 4–7 km behind the line in
  two or three sectors; they ripple-fire every 11–19 s (`firingT`, so they're easy to spot), their rockets
  land on our side, and a new battery comes up every ~10 minutes if some were destroyed.
- **Vehicles:** ground targets wear the rigged models from `src/vehicles.js` once they've loaded
  (`dress(unit, id, { onRig })` in src/dressing.js keeps the target and swaps its stand-in mesh): the Grads,
  the APCs, the convoys' Urals / HEMTTs / SA-8, the stand-in Scud TEL and our Patriot launcher.
- **Map:** sector ticks and names with a blue/red strength bar, push arrows, contested stretches glowing,
  engagement zones (orange crosses), and the war's starting line (faint dots).
- **Events:** `frontPush` (sector, { team }), `frontOffensive` (sector, { team }), `townCaptured` (town,
  { team }), and war's `warFront`.

### `game.director` (src/director.js): the war around the player
- **Flights** (`director.flights`): `{ team, role, callsign, types, hp[], bombs[], pos, vel, route, loiter,
  target, home, members, state, detected }`. Roles: `cap`, `raid`, `escort`, `recon`, `intercept`,
  `strike` (our packages), `cas`. Far away a flight is a point moving along its route; within 18 km of the
  player it becomes real jets (`members`, Aircraft + Pilot, configured by role: CAPs leashed to their
  station, raiders flying their route and releasing bombs over the target, CAS strafing ground targets
  through a Pilot brain); past 27 km (and not in a fight) it goes back to abstract, keeping its damage.
  A budget keeps the real jets to 5 / 6 / 8 (rookie / veteran / ace) and the enemy fighters around the
  player to 2 / 3 / 4; the rest wait, abstract.
  Out of sight, fights between flights and SAMs against flights are settled by odds.
  `director.spawnFlight(opts)` adds one (opts as the fields above plus `speed`, `skill`, `escortOf`).
- **Enemy:** CAP stations over their ground; radar-directed scrambles when their radars (`war.coverage`)
  hold the player near or over their ground (no radars, no scrambles; no airfield, they come from the
  carrier or from far away); raids on our airfields, radars, the carrier or a town near the front, formed up
  40–50 km out, some low under the radar, with escorts from veteran up; recon flights over the carrier or the
  base (one that gets home makes the carrier a missile target); supply convoys on the road network toward
  the front; the carrier group moving; missile strikes through `strikes.request(type, marks, 'red')` —
  half of them announced first ("TEL PREPARING A LAUNCH"), a chance to find and kill the launcher in time.
- **Launcher:** until the mobile-forces plug-in adds real TELs, a stand-in SCUD TEL (the rigged 9P117: jacks,
  pad and erector run before each launch, the rail stays empty for 90 s after; war class `tel`, conceal 0.6)
  hides 12–22 km behind the line, relocates a few minutes after firing when nobody's watching (event
  `telRelocated`), and a new one comes up ten minutes after it's destroyed. It isn't made if another plug-in
  has added red `launcher` sources (in the war and sandbox, the mobile forces' SCUD brigade does).
- **Friendly:** a CAP over our side, strike packages (HAMMER) against high-value targets the player
  identified and left alone, convoys to the front that draw enemy attack aircraft, and calls for help.
  An AN/TPS-75 radar at the home base and at Miramar, a Patriot battery at home and the carriers'
  `radarRange` give our side a radar picture: `director.airPicture()` reveals enemy aircraft they see, and a
  new enemy flight gets a MAGIC call.
- **Convoys** (`director.convoys`): `{ team, path, sign, callsign, vehicles, total, arrived, state,
  destPos, destName }`; vehicles are ground.js targets with `convoyOf`. A downed bridge ahead stops a convoy
  short of the gap; after 45 s it turns back.
- **Radio:** `director.say(from, text, opts)` — war.radio with pacing (3.5 s between calls, lines older
  than `opts.ttl` (25 s) dropped, `priority` goes straight out) and each speaker's voice (`voiceFor`).
  Other plug-ins should talk through it.
- **Events:** `raidDetected`, `reconDetected`, `flightDetected` (flight), `raidHit` (flight, { target, hit }),
  `flightDown` (flight), `flightDone` (flight, { why: 'destroyed' | 'landed' }), `convoyStarted`,
  `convoyUnderAttack` (convoy, { flight }), `convoyArrived`, `convoyLost`, `supportRequest` (flight,
  { attackers }), `packageTasked` (flight, { unit }), `telPreparing` (unit, { launchAt, target }).

### `game.tasks` (src/tasks.js): dynamic tasks
- Offered on the radio and the HUD ("NEW TASK AVAILABLE"), accepted in COMMAND › TASKS (with a badge) or
  on the tactical map (the task list's ACCEPT buttons, or a task's marker or target). The active task gets
  a HUD line (distance, progress, time left), brackets on its targets, a map marker and the steer cue
  (`game.navTarget`, which the war modes own while a task is active).
- Built in: SAM site detected, silence the artillery in a sector, attack the enemy convoy, destroy the TEL
  before it fires, missile launch → find the launcher, intercept the raid, unknown aircraft approaching,
  support a friendly flight, protect / escort our convoy, SEAD for a strike package, battle damage
  assessment, re-strike a damaged target (accepting fires the same strike again), investigate an unknown
  contact, recon a search area, close air support where an offensive is on.
- Paced: a routine offer at most every ~2 minutes (by difficulty), urgent ones 15 s apart, three waiting
  at most (an urgent one pushes out the oldest routine one). A finished task pays its reward in score (so
  career XP); one finished before it was accepted pays half, and only if the player or a wingman had a hand.
- **API:** `game.tasks.addGenerator(fn)` — `fn(tasks, game)` is called every 5 s while a war runs and may
  return a spec or call `tasks.offer(spec)`; check `tasks.canOffer(urgent)` before setting anything up.
  `game.tasks.offer(spec, { force })` returns the task or null (paced, full, or a duplicate `key`). A spec:
  - `type`, `key` (duplicates of a live task are ignored), `title`, `brief`, `from` ('COMMAND'), `label`
    (the steer cue's), `reward` (400), `urgent`, `expires` (s the offer stands), `limit` (s to do it once
    accepted, 0 = none);
  - where: `pos` (a Vector3 or a function), `units` (the targets: done when `need` of them (all) are dead,
    failed if they get away — `removed` while alive), `area` ({ center, radius } drawn on the map),
    `report` (a war.report it goes with);
  - `check(task, game)` → `'done[:how]'`, `'failed[:why]'`, `'expired'` or null (checked twice a second);
    `progress(task)` → text for the HUD; `onOffer`, `onAccept`, `onKill(task, unit, source, mine)`,
    `onDone`, `onFail`, `onEnd` (any ending) callbacks; `data` for your own state.
  - Events: `taskOffered`, `taskAccepted`, `taskDone` (task, { points, assigned }), `taskFailed`.
- Later plug-ins should add generators for their own situations (a recon drone losing contact, an
  underground facility found, an airbase under attack, a tanker needing an escort…).

### `game.wingmen` (src/wingmen.js): orders
- COMMAND › WINGMEN: ATTACK MY TARGET (the lock, else the newest mark), COVER ME, ENGAGE FIGHTERS (free CAP,
  30 km), ATTACK GROUND TARGETS (the newest mark, else known enemies within 9 km of the player — armour and
  guns before SAMs), HOLD POSITION (orbit here), ESCORT AIRCRAFT (the nearest friendly), RETURN TO BASE; to
  all, or to one (WINGMEN › BOLT). Each is acknowledged on the radio in the wingman's own voice.
- An order is a `WingBrain` on the pilot (`pilot.brain`): ai.js asks `brain.pick(pilot)` for the target
  (a target, null for none, undefined for the usual choice) and `brain.steer(pilot, dt)` → `{ dir,
  throttle }` for where to fly with none. A ground target gets gun runs (the same `strafe()` the AI uses on
  an ejected pilot) and, from the wingmen system, rocket pairs. No brain: exactly the old behaviour.
- The Living War starts wingmen on COVER ME with rockets. Badly hit (25%) they RTB by themselves; one that
  lands, or is shot down, is replaced by a fresh jet after 75 / 150 s in the war modes.
- Other plug-ins can give any AI pilot a brain the same way (director.js does for enemy CAS).
- A brain with `fly(pilot, dt)` that returns true flies the jet itself that frame (the hook in ai.js
  `Pilot.update`); the air-support plug-in flies its support aircraft and refuelling receivers that way.

### `game.forces` (src/forces.js, also `game.mobile`): mobile forces
TELs, mobile SAM groups, rocket artillery, convoys and a coastal missile battery, all real vehicles with the
rigged models from src/vehicles.js. Files: `forces.js` (the system, the spawn API, LOD, tasking, the search
and destroy op), `forcesunits.js` (`ForceVehicle`, `VehicleLauncher`), `forcesgroups.js` (`TelUnit`,
`SamGroup`, `RocketBattery`, `Convoy`, `CoastalBattery`), `forcesnav.js` (road graph, routes, hide-site
finders), `forcesites.js` (compound and shelter meshes). Runs in every mode but rings, practice and mission;
the blue HIMARS / M270 batteries are placed wherever strikes run, everything else only in `'war'` and
`'sandbox'`.
- **Order of battle (war / sandbox):** a SCUD brigade (2 TELs, 3 on ace; 12–22 km behind the line) with
  forest, valley and roadside hides, a camouflaged compound (sheds, nets, a crane truck and a command
  vehicle: the reload point), a hardened shelter they back into, and firing points 0.5–1.7 km from each hide;
  an S-300 group, a Buk battery and an Osa platoon covering the enemy's rear; a Patriot battery at the home
  base and at Miramar; a Bastion coastal battery; a Smerch battery; the front's Grad batteries (below); blue GMLRS (2× HIMARS + M270, `ROCKET
  ARTILLERY STRIKE`) and ATACMS (HIMARS + M270, `BALLISTIC` / `HARDENED`, callsign STEEL RAIN).
- **Spawn API** (each takes `(team, …, pos)` or `(pos, team, …)`; `pos` is `{ x, z, heading? }`; returns the
  unit's controller, or null if nothing fits there):
  - `forces.spawnTEL(team, pos, { vehicle: 'scud', loaded, site, sourceName })` → `TelUnit` (on its own it
    finds a few hides and firing points round `pos`). Registers a red (or blue) `launcher` source, so
    `strikes.request('ballistic', marks, 'red')` and the director use it, and the director's stand-in TEL isn't made.
  - `forces.spawnSAM(team, 's300' | 'buk' | 'osa' | 'patriot', pos, { launchers, deployed, emcon:
    'search' | 'ambush', support, relocateEvery, fixed })` → `SamGroup` (`fixed`: a base's point defence, which
    stays put and radiates instead of shooting and scooting; our Patriots are placed that way).
  - `forces.spawnArtillery(team, 'grad' | 'smerch' | 'himars' | 'm270' | 'gmlrs' | 'atacms', pos, { count,
    name, support, command })` → `RocketBattery` (`'gmlrs'` is our mixed battery, kind `artillery`;
    `'atacms'` is kind `launcher` with ATACMS and penetrators).
  - `forces.spawnConvoy(team, from, to, composition, { callsign, destName, cap, spacing, quiet })` → `Convoy`.
    `from` / `to` are points near a road, a `BASES` id or a town; `composition` a list of vehicle ids or an
    index into `CONVOYS[team]`. The column plans over the road graph (Dijkstra, downed bridges avoided).
  - `forces.spawnCoastal(team, pos, { shore })` → `CoastalBattery` (2 Bastion launchers, P-18, command post).
  - `forces.startSearch()` → the search-and-destroy op (below); `forces.spawnVehicle(vid, team, pos)` for a
    bare vehicle.
- **Commands:**
  - `forces.fireMission(who, target, { n, label, missile })`: `who` is a group or one of its vehicles; `target`
    a unit, a war mark or `{ x, z }`. A rocket battery lays and ripples its launchers (only that vehicle when
    given one), a TEL drives to a firing point, sets up and launches, a coastal battery sorties and fires at
    a ship. Returns the launches ordered. Our side's missions get a strike record (HUD, BDA); the enemy's don't.
  - `forces.relocate(who, to?)`: a SAM group packs up and moves (to a new site if none given), a TEL goes to
    another hide, rocket launchers scoot.
  - The map panel on one of ours adds FIRE MISSION ON MARK n and RELOCATE; COMMAND › SANDBOX › GROUND
    FORCES spawns any of them near the player, and START SEARCH AND DESTROY.
- **Behaviour:**
  - TEL: hide → drive (roads, then off-road; slows for turns, grades and rough ground, dust off-road) →
    jacks, pad, erector → prep (40–60 s) → launch → erector down, jacks up → away to another hide, or to the
    compound to reload (crane animation) if it has reserves. Driving with a jet close, it stops and sits still
    (25 s after the last threat); a hit during set-up aborts the launch. `tel.prepEstimate()` gives the
    seconds to launch from the real route and the remaining set-up (`op.eta()` for the search op). Half the orders are announced (`telPreparing`, war.report, a task
    "DESTROY THE TEL BEFORE IT FIRES"); the launch itself is detected (`strategicLaunch`, the missile's origin
    is known).
  - SAM group: radar(s), command post, launchers. Set-up and pack-up are timed by the rig's animations. The
    engagement radar sees within its range, above `altMin` and over the radar horizon, with terrain line of
    sight; the launchers fire `weapons.fireMissile(…, 'sam')` with the type's range, lock time, salvo and
    ammunition, then reload (a support truck quickens it). Radar dead: S-300 and Patriot are blind; Buk and
    Osa fall back to their launchers' own radars (Buk shorter and slower). They move after they've been seen
    or fired a few times (shoot and scoot), and `emcon: 'ambush'` groups stay silent until a target is in
    reach. Their radars feed `war.coverage` while emitting and give the RWR spike on entering their reach.
  - Rocket battery: lay (elevation from range), ripple from each muzzle (Grad 0.5 s, Smerch 2.6 s, GMLRS
    1.2 s), stow, reload, scoot 0.4–1.5 km. Far from the camera (>12 km) salvos are simulated (impacts only).
    Counter-battery: an enemy salvo within reach of our GMLRS gets a FIREFINDER call and a reply 30–60 s later.
  - Convoy: a column on the road network at the posted speed, spaced ~48 m; attacked, it halts, scatters
    50–110 m off the road on alternate sides, APCs dismount infantry (`game.infantry`), an SA-8 in it sets up
    as an escort; it regroups and drives on after the threat's gone. A downed bridge ahead stops it; it turns back.
- **With the other plug-ins:** every real launcher is one strikes source: the brigade's TELs and the Bastions here,
  the Kamenny Log garage's TELs (underground.js `UgLauncher`), the captured Scud at the JOC (commandrooms.js,
  blue, a ground.js truck) and the navy's ships; `strikes.request` picks among them by range and stock, and the
  director's stand-in TEL isn't made while any red `launcher` exists. All TELs are war class `tel`, SAM launchers
  `sam`, fire-control radars `sam-radar`, search radars `radar`. Red cruise strikes on the carrier fly from the
  navy's Kalibr ships (navalops.js), not from the TELs.
- **Hooks the Phase C systems use:** `front.addBattery` gets its Grad batteries from `forces.frontBattery(s,
  site, face)` (same `{ sector, units, at, t }` record, plus `forces`: the `RocketBattery`, which fires on the
  front itself); `director.startConvoy` gets columns from `forces.directorConvoy(team, director)` (director
  convoy fields, `managed: true`: forces.js drives it and ends it through `director.endConvoy`). Radio goes
  through `director.say`, tasks through `game.tasks.offer`.
- **Search and destroy:** a TEL with an Osa escort enters 3–7 km from a firing point in the enemy's rear
  ("ENEMY TEL ENTERING <place>"), drives to it and fires on the countdown shown on the task. SUPPORT › RECON
  DRONE (or 30–42% into the countdown on its own) narrows the search area to 1.6 km and reveals a contact;
  the escort's radar comes on and it fights once the player is within 9 km or the TEL is identified. Marking
  the TEL and calling BALLISTIC works on the move: our ballistic missiles aimed at a unit steer to it on the
  way down (`StrategicMissile.tracked`). Events `searchStarted`, `searchEnded` (op, { why }).
- **Unit interface:** each vehicle (`ForceVehicle`) is in `ground.targets` and `war`: `pos`, `center`, `vel`,
  `heading`, `radius`, `hp`, `alive`, `team`, `cls` (tel, sam, radar, command, artillery, vehicle, apc…),
  `type`, `conceal` (the site's: shelter 0.97, forest 0.85, compound 0.8… firing 0.15), `hardened`,
  `firingT`, `route` (while it drives), `ctrl` (its group), `damage(amount, source, kind)`. `hidden` is true
  for an enemy nobody has found and for our vehicles more than 4 km from the camera (the HUD and target
  cycling skip them). SAM radars have `radarRange` and `emitting` (war.coverage and SIGINT ignore `emitting ===
  false`) and their own `sigint` signature (ew.js: 30N6 FLAP LID, P-18 SPOON REST, SA-11 FIRE DOME, SA-8 LAND
  ROLL, AN/MPQ-65, SENTINEL), launchers `samRange`. Destroyed, a vehicle burns, cooks off by what it carries (missile, rockets, fuel),
  may throw its turret or erector, and emits `groundKilled`.
- **Events:** `telPreparing` (tel, { launchAt, target }), `telLaunched`, `telRelocated`, `samReady`,
  `samActive`, `samBlind`, `samRelocating` (group, { to }), `salvoOrdered`, `convoyStarted`, `convoyScattered`,
  `convoyArrived`, `convoyLost`, `searchStarted`, `searchEnded`.
- **Levels of detail:** far vehicles are points on their route; within ~7 km (by size, down to 2.5 km for
  small ones) a merged static copy of the rig in its current pose (2–4 draw calls, templates built one per
  frame and shared); up to 5 live rigs for vehicles that are close and moving, or animating within 3.8 km.
  `forces.lodFocus` (a Vector3) overrides the camera for tools and stills. `forces.stats` has `{ units,
  meshed, live, ms }`; a full war costs ~0.02–0.15 ms of CPU a frame.
- **Switches:** `forces.auto` = `{ tel, search, artillery, counterBattery, coastal, convoys }` turns the
  scheduler's own orders off one by one (the units stay); `start(mode, { forces: false })` or mode `'test'`
  places nothing.

## Air support and electronic warfare (`game.air`, src/airsupport.js)

### What flies
- **Support flights** (`air.flights`, `SupportFlight`): real `Aircraft`, flown by a brain. Tasks: a racetrack, an
  orbit, a goto, a photo run, an escort, retrograde, RTB. Far from the camera (> 24 km, real again < 18 km) and
  with no fight near it, a flight is **coarse**: its jet leaves the scene and moves along its path without the
  flight model. A real one more than ~3 km away is drawn with its **far version** (src/farmodel.js: the model
  vertex-clustered into one vertex-coloured mesh, 5–7k triangles, one draw call; built once per type). Each
  support aircraft carries `ac.support` (its flight).
- **Where**: `ORBITS` — racetracks well behind each side's lines: AWACS at 9–9.4 km, tankers at 6.1–6.5 km, the
  RC-135 at 10 km, the B-52 at 10.5 km. Our E-3 and KC-135 fly in every combat mode and Free Flight. The enemy's
  A-50U and Il-78M fly in strike, naval, war and sandbox. The RC-135 flies in strike, war and sandbox, the B-52 in
  war and sandbox. `start(mode, { airSupport: false })` turns it all off.
- **Threats**: a bandit targeting a support aircraft, or close and pointing at it, sends it home at full speed
  ("DEFENSIVE, RETROGRADING"); it comes back on station when clear. The task board offers "PROTECT <callsign>", and
  a lost drone gives "FINISH <callsign>'S SEARCH". Losing the AWACS: "MAGIC IS DOWN"; the picture goes. In war and
  sandbox a replacement AWACS comes on station after 6 minutes, and a replacement tanker after 5.

### AWACS (src/awacs.js, src/brevity.js)
- The E-3G ("MAGIC") and the A-50U have `radarRange` (250 / 220 km), so `war.coverage` counts them. That count
  includes the radar horizon from their altitude, terrain masking (`war.radarLOS`, sampled finer near the target)
  and jamming (`war.jamFactor`).
- Our AWACS sweeps with the rotodome (6 rpm). A target is held when all of these are true:
  - it is inside the reach for its size (stealth: F-22 ×0.12, Su-57 / J-20 ×0.3);
  - it is above the horizon and not masked;
  - it is not jammed below burn-through;
  - it is not in the Doppler notch (low and beaming).

  A held target gets `war.reveal(u, CONTACT, 'awacs')`. Enemy cruise missiles get `detected`: the map shows them,
  and the player can lock them.
- **Calls**, in brevity (through `director.say` while a war runs):
  - POPUP, NEW GROUP (bullseye), THREAT and MERGED (armed groups only), FADED, and a PICTURE now and then;
  - cruise missiles inbound, and the director's new flights (`director.announce` asks `air.announceFlight(f)`
    first).

  BRAA is bearing / range in NM / altitude / aspect (HOT, FLANK, BEAM <dir>, DRAG), e.g. "GROUP BRAA 040/35, 20
  THOUSAND, HOT". "ANGELS" is only used for friendlies. Groups are contacts within 3 NM of each other, with fill-ins
  (HEAVY, N CONTACTS, type, FAST). BULLSEYE is (0, −12 km); it is drawn on the map, and the HUD shows the player's
  position from it.
- **Requests** (COMMAND › SUPPORT): BOGEY DOPE; PICTURE; DECLARE on the locked target, answered with HOSTILE,
  BOGEY, FRIENDLY, NEUTRAL, FURBALL or CLEAN.

### Tankers and refuelling (src/refuel.js)
- **The tankers:**
  - KC-135R "TEXACO": the flying boom and the MPRS wing hoses. The boom's envelope comes from the rig's userData:
    20–40° down, ±15° across, telescope 6–18 ft (12 ideal).
  - Il-78M: three UPAZ hoses.
  - Rates: boom 6,500 lb/min, MPRS 2,680 lb/min, UPAZ 2,300 l/min. `FUEL_KG` gives each type's internal fuel.
  - The tanker holds 280 KIAS and its leg while it has receivers.
- **The procedure** (`RefuelSession`):
  - rendezvous, 1,000 ft below and behind where the tanker will be;
  - join: "cleared to join, observation left wing";
  - pre-contact or astern: "cleared pre-contact" / "cleared astern, left hose";
  - contact: "cleared contact". The boom operator plugs in when the receptacle holds still inside the envelope.
    A probe must go into the basket at 2–5 kt and push the hose into its 1–6 m range; the signal lights go red,
    amber, green, then flashing amber at the inner limit.
  - Out of limits: "DISCONNECT — <limit>", back to pre-contact. Too fast or too close: "BREAKAWAY". Hitting the
    tanker: a mid-air.
  - Full: "YOU'RE FULL — n POUNDS", then the right wing and "CLEARED TO DEPART".
- **The player:** COMMAND › SUPPORT › TANKER › REQUEST AIR REFUELING. The HUD shows:
  - the tanker's cue, the RV and the step;
  - fuel, onload, rate and time to full;
  - the contact target and its error;
  - the boom's pilot director lights (UP / DN, FWD / AFT) or the hose's lights.

  **Y** (or the menu) toggles the AR autopilot, which flies the whole procedure; stick input takes control back.
  Wingmen on COVER ME come along and take their turn (their brain is swapped for the session's and put back
  afterwards). SEND WINGMEN TO THE TANKER sends them on their own.
- **Events:** `tankerRequested (rx, { session, tanker })`, `refuelContact`, `refuelDone`, `refuelEnd`,
  `refuelCollision`.

### Reconnaissance (src/recon.js)
- **The aircraft:**
  - MQ-9A "REAPER" (becomes SHADOW when the player is REAPER): EO/IR ball out to 9.5 km, which moves a unit from
    contact to identified to confirmed with dwell. It carries 4 Hellfires.
  - RQ-4B "FORTE": radar out to 26 km, through cloud; it identifies only the big things.
  - U-2S "DRAGON": a photo run at ~67,000 ft that images a 28 km swath.
  - RC-135W "JAKE": SIGINT (see below).
- **Tasking:** COMMAND › SUPPORT › RECON sends them to the newest open search area, else the newest mark, else the
  steerpoint. The map panel's SEND RECON HERE works on any point, unit, mark or search area.
- **What they do:**
  - report on the radio ("EYES ON — …");
  - reveal what they see (`war.reveal(u, level, 'recon')`);
  - watch struck targets for BDA (`strikes.watchers`);
  - take pictures: `reconImage()` makes a FLIR, SAR or photo image of the terrain and units (no second render
    pass) and puts it in `sensors.imagery`. They do this on arrival and on a BDA result. `air.takeImage(flight,
    pos, bda)` is the hook for other plug-ins.
- **Hellfires:** the MQ-9's Hellfires answer the strike system's AIR STRIKE (through `strikes.airProviders`) when
  it is within 12 km of the marked unit. Otherwise HAMMER goes, as before.
- Units inside a mountain (`u.ugInside`, underground.js) are invisible to recon and SIGINT alike.

### Electronic warfare (src/ew.js)
- **The model:** noise jamming with `J/N = (K / d)² · gj · gr`, where K is the jammer's power, gj its pod sector and
  gr the radar's main lobe (side lobes −30 dB). A radar keeps `(1 + ΣJ/N)^(−1/4)` of its range, so a close target
  burns through (a self-screening jet at ~R0²/K).
  - `war.jamFactor(team, from, to)` gives that factor; `war.jam` is set by this plug-in.
  - It cuts war.coverage, the player's radar and ground.js SAM engagement ranges.
  - Other radar owners should call it too.
- **Jammers:**
  - `air.jam(ac, on, { brg | at, half })` turns one on or off.
  - EA-18G ALQ-99: K 2,500 km, ±45° sectors.
  - Self-protection: the Su-35 and Su-57 Khibiny and the Tu-95's set, on when one of ours is within ~40 km.
  - Enemy jammers put strobes on the player's scope; close in, they show BURN-THROUGH. The map draws friendly
    jamming sectors.
- **The Growler "ZAPPER 1":**
  - It escorts strikes (air strikes, B-52 strikes and the director's HAMMER packages) or stands off a point.
  - It jams the most threatening emitter ("MUSIC ON") and fires HARMs at SAM fire-control radars ("MAGNUM").
  - From COMMAND › SUPPORT › ELECTRONIC WARFARE: GROWLER: ESCORT ME / JAM THE NEWEST MARK. From the map:
    GROWLER: STAND-OFF JAMMING HERE.
- **Flying a Growler:**
  - **F4** opens the EW page (ALQ-218: emitters with bearing, range, JAMMED / BURN).
  - **[ ]** select an emitter.
  - **;** jammer on / off.
  - **'** points the pods at the selected emitter (press again for along the nose).
  - **M** (with the page up) fires a HARM at it: `WEAPONS.arm`, 32 km, radar-homing, flown by weapons.js.
- **Emitters** (`emitterOf(u, rec)`): search radars, SAM trackers, gun-dish AAA, naval radars and AWACS. A unit
  with `emitting = false` is silent, and `u.sigint` overrides the signature. The RC-135 first fixes an emitter
  (CONTACT, with the position error shrinking with dwell), then identifies it; events `sigintReport`.

### Bombers (src/bombers.js)
- **Launch sources and missiles:**
  - `AirLaunchSource` is a strikes.js `LaunchSource` carried by an aircraft or by a director flight.
  - `AirMissile` extends `StrategicMissile`: it drops clear, descends to cruise, then follows the terrain. The
    Hellfire flies a direct top attack instead.
  - `spec.Missile` picks the class in strikes.js.
  - Missiles: `kh101`, `jassm`, `hellfire`.
  - Strike types: `standoff` (the bombers' cruise missiles) and `carpet` (a B-52 run laying Mk-82s across the
    mark). Both are in COMMAND › TACTICAL SUPPORT (B-52 STAND-OFF STRIKE, B-52 CARPET BOMBING) and in SUPPORT ›
    BOMBERS.
- **Red raids:** the director's cruise-missile raids (Tu-95MS) call `air.standoffRaid(f)` in `launchRaid`. The
  bombers start ~75 km out at 9 km altitude and launch ~34 km from the target through
  `strikes.request('standoff', …, 'red')`, then turn away. MAGIC calls the launch. The bombers can be intercepted,
  and so can the Kh-101s (lockable once the AWACS holds them). Missiles shot down emit `strategicIntercepted`.

### API (`game.air`)
- `air.spawnAWACS(side, orbit)` and `air.spawnTanker(side, orbit)` put a flight on a racetrack. The orbit is
  `{ x, z, heading (deg, first leg), leg, R, alt, speed }`; missing fields come from `ORBITS`.
- `air.requestTanker(receiver, { auto, tanker, quiet })` returns a `RefuelSession`, or null. The receiver is the
  player's jet or any AI aircraft with a refuelling point (rigparts.js REFUEL).
- `air.sendRecon(kind, area)`: kind `'mq9' | 'rq4' | 'u2' | 'rc135'`; the area is `{ x, z, r }`, a unit, a mark or
  an intel report.
- `air.bomberRaid(side, targets)`:
  - red: two Tu-95MS (escorted from veteran up) through the director, or on their own without one;
  - blue: the B-52's JASSMs on the targets.
- Others: `air.jam(ac, on, sector)`, `air.sendGrowler(escortee | point)`, `air.awacs(side)`,
  `air.tankers(side)`, `air.announceFlight(f)`.
- Events: `supportThreatened`, `reconReport`, `sigintReport`, `raidLaunch`, `bdaImagery`, and the refuelling
  events above.

## Naval operations (`game.navalops`: src/navalops.js, src/launchseq.js, src/deckops.js)

### For the player
- **Naval Strike** and the **Living War** start with a carrier strike group round the home carrier and a red
  surface action group round the enemy carrier.
  - Ours: the carrier, a Ticonderoga cruiser, two Arleigh Burkes (USS Mason among them), a supply ship and an
    attack submarine, plus an Ohio SSGN on its own patrol box 11–19 km away.
  - Theirs: a Slava, two destroyers, a supply ship and a submarine.
  - The groups manoeuvre, defend themselves in layers and trade missile salvos every few minutes.
- **The deck:** the player starts (and respawns, in the war too) on catapult 2, the port bow one, with the
  deck alive round him: the JBD comes up behind the jet, the shooter and the green shirts, the steam. The
  chase camera is kept out of the island (`Naval.clearOfIslands`).
- **COMMAND › NAVAL** (backslash or F3):
  - LAUNCH ALERT FIGHTERS: two F/A-18s up the elevator and off the catapults.
  - RECOVER AIRCRAFT: the CAP comes home (Case I pattern, a wire or a bolter, struck below).
  - GROUP: FLANK / CRUISE SPEED, GROUP: TURN INTO THE WIND (two minutes of flight ops), GROUP: ZIG-ZAG ON / OFF.
  - SHIP LAUNCH and SUBMARINE LAUNCH: "n× TLAM (or HARPOON) FROM <ship>" at the newest mark (comma marks).
- **COMMAND › SANDBOX › NAVAL** (sandbox, free flight and the war): SPAWN RED SURFACE GROUP and SPAWN BLUE
  CARRIER GROUP, 15 km ahead.
- **Tactical map:**
  - Our group's SAM umbrella, its screen and its course (ZIG-ZAG, FLIGHT OPS), SAMs in flight, and the SAM
    envelopes of identified enemy ships.
  - Click the sea: SEND <carrier> GROUP HERE. Select an enemy ship: HARPOON / TLAM FROM <ship>.
  - A selected ship of ours shows course, speed, depth, magazine and empty cells; the carrier its deck (jets
    up, on deck, in the pattern).
- **HUD:** "CSG … · n VAMPIRES INBOUND · n SAMS IN FLIGHT", while it matters.
- **Radio:**
  - Air defence: "VAMPIRE, VAMPIRE — BEARING 040, 23 KM, ON <ship>", "BIRDS AWAY — 2× SM-2, TRACK 4012",
    "SPLASH ONE VAMPIRE", "MISS, REENGAGING", "LEAKER, LEAKER — CIWS ENGAGING", "CIWS ENGAGING — MOUNT 21".
  - Surface action: "BRUISER, BRUISER" (Harpoons away), "SHOT — 2× TLAM ON …".
  - The deck: marshal, "ROGER BALL", the wire, "BOLTER, BOLTER, BOLTER". The LSO talks to the player too:
    ROGER BALL, YOU'RE HIGH, POWER — YOU'RE LOW, HOOK DOWN!
  - In a war it all goes through `director.say` (its pacing and priorities); elsewhere through navalops' own
    queue (a call every 2.5 s).
- **Tasks** (the Living War, tasks.js): THE CARRIER IS UNDER MISSILE ATTACK (urgent: sink the ship that fired)
  and ENEMY SURFACE GROUP (within 70 km of our carrier).

### Groups
- **`navalops.spawnGroup(side, center, opts)`** returns a `Group`, or null without open water near `center`.
  Emits `navalGroup`. opts:
  - `composition`: `[[type, role, across, along]]`, metres in the formation's frame, starboard and aft
    positive. Default `CSG` for blue, `SAG` for red (both exported).
  - `name`, `course` (rad; default into the wind), `speed` ('cruise' | 'ops' | 'flank'), `deck` (flight ops
    on its carrier, default true), `areaR` (the patrol box radius, default 6 km).
- **A group:**
  - `members`: `{ ship, role, ox, oz }`. Roles are `hvu`, `aaw`, `screen`, `logistics` and `sub`.
  - `guide`: the carrier, or the first ship. If it's sunk, the next one takes over.
  - `side`, `name`.
  - `course` (the base course) and `axis` (the formation's, which follows the course only as fast as the screen
    can get round).
  - `order`: 'cruise' (16 kt), 'ops' (24 kt), 'flank' (28 kt) or 'stop'.
  - `dest` (a fleet move), `area` (the patrol box), `threat` (0..1), `zig` (`{ on }`), `tracks` (the radar
    picture).
  - `flightOps`: seconds of steady course into the wind. It's set while the deck has jets moving.
- **Behaviour:**
  - The guide patrols legs round its area, steams for `dest`, or turns into the wind for flight ops. Its course
    is always clear of land 4.5 km ahead (`openCourse`).
  - Threatened (missiles or aircraft in the picture), the group goes to flank speed and zig-zags ±25° on legs
    of 45–80 s.
  - Escorts keep their stations with `stationSteer`: the guide's velocity plus a correction. They never back
    down, and never run across the formation faster than 70% of their best speed.
  - An escort pulls in toward the guide where its station is over shallow water. It turns away from ships
    within 450 m, and checks 1.5 km ahead for land.
- **Calls:**
  - `navalops.groupOf(ship)`.
  - `navalops.moveGroupOf(ship, pos)` returns true if the ship is in a group. director.js sends its fleet moves
    here.
  - `navalops.steerGroup(group, heading, speed)`: heading in rad (null keeps it), speed as `order`.
- **Every ship is enlisted:**
  - On the helm: `ship.steer(heading, speed)` (naval.js).
  - `adManaged`: naval.js leaves its missiles to navalops. The CIWS stays in naval.js.
  - In the war registry: `cls` carrier / ship / sub, full names, and the contact names LARGE SURFACE /
    SURFACE / SUBSURFACE CONTACT.
  - `radarRange`, for director.js's air picture.
  - Its magazine and launch controller (`ship.launcher`), and a strike source for its TLAM / Harpoon /
    Kalibr / P-1000 (`ship.strikeSource`).
  - An enemy ship's HUD name is its class (DESTROYER, SLAVA CRUISER). Its registry name is the real one, once
    identified.
- **Submarines** stay deep (38–40 m): off `ground.targets`, `conceal` 0.97. They come up to periscope depth to
  launch, and for the broadcast every few minutes, with their masts raised there (naval.js `raiseMast`).

### Air defence
- **Twice a second per group:**
  - The radar picture (`trackPicture`): enemy aircraft, strategic missiles and missiles fired at its ships.
    Each must be within a radar's range and its radar horizon, and in terrain line of sight. The horizon is
    `radarHorizon(h1, h2)` = `HORIZON · (√h1 + √h2)`, with HORIZON = 1900 m (game scale).
  - Then threat evaluation and weapon assignment, `planEngagements` (exported, pure; see below).
- **`planEngagements(threats, shooters, { mediumReach })`** returns `[{ threat, shooter, key, n }]`.
  - threats: `{ id, kind: 'missile' | 'aircraft', pos, vel, defend (Vector3), inFlight }`.
  - shooters: `{ ship, pos, channels, weapons: [{ key, count, ready }] }`.
  - Missiles come before aircraft, ordered by time to reach what they're after.
  - The outer layer (SM-2, SM-6, S-300F) fires first. The medium layer (ESSM, RAM, Sea Sparrow, Osa-M, Shtil)
    fires once a threat is inside its reach.
  - Two at a missile (shoot-shoot-look), one at an aircraft (shoot-look-shoot).
  - Nothing inside a weapon's minimum range, and no more than each ship's fire channels.
- **Aircraft** are engaged inside 21 km if they're closing, or inside 9 km. Red fires one SAM at the player at
  a time, every 16 s (rookie) to 8 s (ace).
- **`SAMS`** (exported): range, minimum range, speed, burn, turn, proximity fuse, warhead, Pk against missiles,
  tip-over time, IR or radar.
- **Interceptors:**
  - Fly lead pursuit after the tip-over, and burst at the closest approach within the fuse.
  - Roll Pk against a missile; an aircraft takes `damage`.
  - Can be decoyed by flares and chaff. Self-destruct when the target's gone. The SM-6 drops its booster.
  - Each emits `missileLaunch` when fired at an aircraft (the player's missile warning).
- **The CIWS** (naval.js) now also engages strategic missiles closing within 1.6 km (`strikes.missiles`,
  `intercepted`).

### Launches from ships and submarines
- **`navalops.launchFrom(ship, key, target, n = 1, { quiet })`:**
  - A SAM key (`SAMS`) engages `target` with interceptors.
  - Any `MISSILES` key flies a real strike through strikes.js (BDA, the missile camera).
  - `target` is a unit, a designation or `{ x, z }`.
  - Returns the strike, the launch sequences, or null.
- `navalops.magazineOf(ship)` returns the ship's `Magazine`.
- **`strikes.fireFrom(src, specKey, n, target, { quiet, label, type, spacing })`** (strikes.js): a strike from
  one given source, with no nearest-shooter search.
- **`MISSILES.p1000`** (P-1000 Vulkan): the Slava's ship killer, 520 m/s, high over the sea.
- **Surface action:**
  - Every few minutes a group fires at the nearest known enemy surface ships within 48 km. Their carrier or
    Slava comes first (65% of the time).
  - Blue: cruisers fire Harpoons, destroyers TLAMs. Red: the Slava fires P-1000s, destroyers and submarines
    Kalibrs.
  - In Naval Strike the enemy carrier is left to the player.

### Launch sequences (src/launchseq.js)
- **`LaunchControl`** is on each armed ship (`ship.launcher`). `fire(key, spawn, { target, data })`:
  1. takes a round from the magazine and opens its hatch (`poseRig`);
  2. lights the motor when the hatch is open and calls `spawn(phase, pos, dir, seq)`, so the missile starts in
     a `LaunchPhase`;
  3. vents the module's uptake while the missile climbs out;
  4. closes the hatch after it.

  One launch at a time per door (a revolver, a sub's tube hatch). Also: `emptyCells()`, `count(key)`,
  `has(key)`, `seqs` (the sequences running) and `ready()` (a submarine fires only at periscope depth).
- **`LaunchPhase`** moves the missile until it's clear of its launcher:
  - a hot launch out of a cell on its booster: a Tomahawk slowly, in a cloud of exhaust; a Standard out in a
    fraction of a second;
  - a cold ejection, with the motor lit in the air (S-300F, Shtil);
  - an inclined container or canister, or a rail;
  - a capsule from a submarine: it rises from the tube, broaches in spray and foam, and lights its booster
    above the water.

  Callbacks: `onClear`, `onIgnite`, `onBroach`, `onExhaust`. strikes.js's `StrategicMissile` takes one as its
  last argument (phase 'launch'). A source whose host has a launcher launches on the rig
  (`LaunchSource.launchOnRig`).
- **`TIMING`:**
  - Mk 41: the hatch opens in 1.0 s, ignition follows 0.15 s later, the uptake vents 1.2 s, and the hatch
    closes over 1.6 s, starting 4 s after the missile's out.
  - Also: container, revolver, canister, rail, popup and subtube.
- **`LAUNCH`**, per missile: mode, accel, eject, ignite.
- **`vlsTimeline(key, depth, timing)`** gives, in seconds: the hatch open, ignition, clear, closing and closed.
- **`LOADOUTS[type][side]`** and **`buildMagazine(ship, load)`** return a `Magazine`:
  - its tubes are `{ key, kind: 'cell' | 'point' | 'mount', ref, left, door, timing }`;
  - quad-packed ESSM cells hold four;
  - rounds are spread through the modules.

### Carrier operations (src/deckops.js)
- **`navalops.deckOf(carrier)`** returns its `DeckOps`. Only carriers whose model has the deck layout (catSpots,
  JBDs, shuttles) get one.
- **`deck.requestLaunch({ type, skill, onAirborne })`:**
  - Blue jets come up the port-aft elevator; red ones appear by a bow catapult.
  - Either taxis behind a yellow shirt to a catapult and runs a `CatCycle`: taxi → hookup → tension → salute →
    stroke → clear → idle. The JBD rises and falls, the shuttle runs, and there's steam (`CAT_TIMING`).
  - The launch is the aircraft's own `startCatapult`. Airborne, the jet is handed to a Pilot and flies CAP for
    4–7 minutes before it comes back.
- **`navalops.catapultLaunch(carrier, ac)`** sends an existing aircraft, with its AI pilot, out by catapult
  (game.js's enemy carrier launches in Naval Strike). False if no catapult is free.
- **`navalops.recover(ac, carrier)`** (or `deck.recover(ac)`) flies a Case I recovery:
  - the initial at 300 m, the break, downwind, the 90, and a 2.6 km groove on a 3.5° glide slope;
  - the trap is aircraft.js's own wires; a bolter or wave-off goes round again (rookies bolter more often);
  - then out of the landing area to the elevator, and struck below.
  - One jet in the pattern at a time; none while the player is on final or the landing area is fouled.
- **Deck crews:** `deckcrew.glb` (tools/ships/deckcrew_model.py), four instanced meshes per carrier in the
  jersey colours (`SHIRTS`), about 34 people at their posts. They're drawn and animated only when the carrier is
  near the camera.
- **Parked aircraft** stand on their gear (naval.js `parkedModel`), instanced. The elevator is naval.js
  `setElevator`.

### naval.js additions
- **Group steaming:** `Ship.steer(heading, speed)`, with `HELM` per type (max speed, acceleration, turn rate,
  rudder lag) and `ship.nav`. Without it the ship keeps its circle.
- **Deck and rig:** `ship.catSpot(i, out)` (default cat 2, `ship.playerCat`), `ship.inIsland(p, margin)`,
  `naval.clearOfIslands(cam, target)`, `pointFrame(ship, name, pos, dir)` (any rig point: `harpoon_1..8`,
  `muzzle_<n>`) and `parkedModel(kind)`.
- **Level of detail**, `ship.updateLod()`:
  - hidden below about 1 px on screen, or deeper than 22 m;
  - no mounts, radars, doors or deck crew below 70 px;
  - below 120 px, a merged far model (`ship.far`: the whole ship at rest, one mesh per material) instead of the
    full one.
- **Rig additions** (tools/ships/RIG.md): the carrier's `jbd_1..4` (doors) and `shuttle_1..4` (slides), and its
  layout's `catSpots`, `jbds` and `lso`; the cruiser's `harpoon_1..8` points.

### Events
- `navalGroup` (group).
- `vampire` (group, { missiles }).
- `missileLaunch` (ship, { missile, target }): a SAM fired at an aircraft.
- strikes.js's own events for the surface-to-surface missiles.

## Interiors and boats (Phase C)

Walk into places and work them with their own buttons and screens; drive small boats. The framework is
`src/interiors.js`, the content `src/warrooms.js` (harbour, boats, submarine, travel) and `src/commandrooms.js`
(carrier, JOC, TEL), the console logic `src/firecontrol.js` (pure, tested), the screen drawing kit `src/screens.js`,
the boats `src/boats.js`. `src/warinteriors.js` plugs it all together as `game.interiors` (systems.js). Room models:
`models/interiors/*.glb`, built by `tools/interiors/*.py` (`sh tools/interiors/build.sh`; the node / extras contract
is `tools/interiors/ROOMS.md`).

### Where and how (the player)
- **COMMAND › TRAVEL** puts you on foot at any of them (from a stopped jet you climb out; in free flight, sandbox
  and the Living War also from the air: the jet is parked on the apron). Walk up to a door, a hatch or a boat and
  press **E**.
- **Small craft pier** west of the home base: the NSW 11 m **RHIB** and the **CB90H** combat boat. W/S throttle,
  A/D steer, SPACE crash stop, V chase / helm view, mouse look, E steps off at a pier slot, a ship's ladder, a
  surfaced submarine or a beach (slow down first).
- **USS Colorado (SSN-788)** lies surfaced off the pier: E at the escape trunk goes below into the control room
  (or signal for the RHIB from the casing). Ship control: rig for dive, dive / surface / emergency blow, ordered
  depth, bells, rudder; photonics masts with a live picture on the screens and full screen (mouse trains, wheel
  zooms, LMB / comma marks); sonar with a waterfall; fire control: target (marks, known units), TLAM / Harpoon,
  weapon key, spin up, firing point procedures (≤ 160 ft keel, ≤ 6 kt, holding depth), open the muzzle hatch,
  lift the guard, FIRE. K watches the missile break the surface, then the missile camera (K / Esc back).
- **The carrier** (home carrier): the island's port doors — CIC (the air and surface pictures, the TAO summary,
  the radio log, and a strike console that fires the group's Tomahawks / Harpoons from the escorts' VLS or the
  submarine: shooter, weapon, salvo, target, strike key, ARM, guarded LAUNCH) and Pri-Fly up the ladder (glass on
  the flight deck, deck status knob and lamps, horn, wind over the deck, the PLAT camera, catapults; SPOT puts an
  F/A-18 on cat 1 for you to walk out to, the guarded LAUNCH sends the alert fighter, RECOVERY turns the ship into
  the wind). The accommodation ladder aft of the island calls away the duty boat.
- **Joint Operations Center** at the home base (a hardened building behind T-walls and HESCO; solid and
  destructible): the wall (common operational picture, known targets with intel level beside the front's sectors,
  the director's tasks, strikes and BDA imagery, the radio, a status ticker) and consoles: map (click to mark),
  intel (click to mark), strike cell (type, AUTO or a specific shooter, REQUEST / ARM, guarded EXECUTE — the same
  `strikes.request` / `launchFrom`), tasks (ACCEPT / PUT ON HOLD / IGNORE ALL: `tasks.accept`, `abandon`,
  `dismissOffers`), the whole command menu as buttons, the radio log, the battle cab.
- **Captured Scud TEL** (free flight, sandbox, Living War) beside the JOC: the launch control cabin (power,
  generator, parking brake, rear supports, launch table, boom, target, gyrocompass alignment, control-system test,
  combat mode, batteries, the six-digit code lock (the order's code is on the display), guarded ПУСК); the driver's
  cab (brake, engine, W/S/A/D) once it's stowed. It reloads two minutes after a launch while stock lasts.
- Inside a room: WASD walk (Shift faster), mouse look, LMB presses what the crosshair is on (reach 2.6 m), wheel
  turns knobs, Tab frees a cursor, 1–9 sit at the room's stations (the cursor comes out; clicking a console's
  screen while walking sits you there too), RMB / Esc stand up, E leaves at the exit. A guarded control needs its
  guard lifted first; its keyboard shortcut lifts the guard. Hover shows what a control does and why it won't.

### API
- `game.interiors` (an `Interiors`): `addSite({ id, label, at(out) → Vector3 | null, radius, dy, enter, blocked(),
  hidden() })`, `removeSite(id)`, `addRoom(def)` → `Room`, `enterRoom(room, { text, spawn })`,
  `switchRoom(room)`, `leave({ to, then })`, `placePilot(pos, yaw)`, `takeControl(ctl)` / `releaseControl()`
  (a controller: `control(dt, mouse)`, `camera(cam, dt)`, `hud(ctx, hud)`, `action(a)`, `enter()`, `exit()`,
  `carry(pilot)`, `tick(dt)`, `kind`), `fadeTo(then, { text })`, `use(plugin)` (plug-ins may have `start`,
  `clear`, `update`, `commands`, `drawMap`, `mapInfo`, `mapActions`, `drawHud`). `ops` holds the harbour, sub,
  carrier, joc and tel plug-ins.
- A room def: `{ id, name, file | build(root, room), sealed (default true: drawn alone in its own scene), shadows,
  anchor(outMatrix4), exitTo() → { pos, yaw }, canExit(), bind: { node: { label, key, press, turn, value, lit,
  enabled, why, keepGuard } }, screens: { node: { fps, draw(ctx, ui, screen, game, room), wheel, feed } },
  stations: { node: { label, order, fov } }, keys, actions, status(), title, onLoad, onEnter, onExit, update,
  drive }`. `ui.button / row / hit` register click regions on a screen; `Screen.setFeed(texture)` shows a render
  target under a feed screen's canvas (`CameraFeed` in warrooms.js renders one a few times a second).
- While a controller has the player: `game.takeover` (game.update calls it instead of the man on foot),
  `game.indoors = { sealed, lookout, kind, name }` each frame (the HUD hides world markers and postfx drops water,
  sun and SSR when sealed; war sensors skip; audio is muffled), `game.nearPlane` (0.05 m in a room),
  `game.scenePass.scene` swapped to a sealed room's scene. `game.platforms` (`at(x, z, y)` → surface) makes the
  pier, pontoon and gangway walkable through `game.surfaceAt`; pilot.js rides moving decks (`deckRef`).
- `strikes.launchFrom(src, specKey, marks, { n, all, team, quiet })` fires a specific source at marks (the consoles
  use it; `strikes.request` still picks the nearest). A submarine's missile isn't counted as hitting the water
  while it broaches (its first 3 s).
- `steerShip(ship, heading, speed, yawRate)` drives a naval.js ship (it steams round circles) as if it had a helm.
- Boats: `new Boat(game, 'rhib' | 'cb90', x, z, heading)`, `BoatPhysics(spec)` (`step(dt, { throttle, steer })`,
  `sea`, `ground`, `collide` hooks), `Helm(sys, boat, plugin)`, `Harbor(game, site)`; `BOAT_SPECS` carries the
  real numbers (45.5 / 40.4 kt top, 0–20 kt ~5–6 s, full-helm radius ~23 m, crash stop 4.7 / 2.8 lengths).
- Harbour docks: `game.interiors.ops.harbor.docks.push({ id, host, label, text, at(out), step(out), yaw(), ok() })`
  lets a boat put the player aboard anything (the carrier's ladder, the submarine's casing use it).

## Underground bases (`game.underground`, src/underground.js)

Two hidden mountain complexes in red territory, far from towns, roads and airbases (ugsites.js `UG_SITES`):
- **ZHELEZNAYA GORA** (x 32.4, z −43.6 km): an Objekat 505 / Željava-style underground airbase. Two aircraft portals
  (N1, N2; inverted-T openings, two ~100 t sliding leaves) and a service portal (N3, hinged doors) in cuttings at the
  foot of a massif; N1 → tunnel → a 32 × 15 m, 220 m hangar hall (seven jets parked) → N2 is a drive-through loop; N3
  leads to a stores gallery. Aprons, a taxiway and a 2,200 m runway on the plain 1.1 km out, a support compound.
- **KAMENNY LOG** (x 35.2, z −23.8 km): a missile operating base (Sakkanmol / "missile city" style). Vehicle portals E1
  and E2 joined by the TEL garage hall (three Scud TELs), E3 into the magazine; a yard, three launch pads on the rise
  above the lake, gravel tracks, an access road.
- Around both: vents on the ridge (warm in the FLIR), relay masts, guard posts, a substation and a power line running
  into the hillside, camouflage nets over the cuttings, tyre tracks.

**Ground.** `terrainHeight` carves them (ugsites.js `ugCarve`, called at the end of terraincore.js `terrainHeight`, so the
map workers, terrain workers and physics agree): pads (runway, aprons, pads), capsules (roads, taxiway) and notches
(portal cuttings, cut only), each continuous and fading to the natural ground within its reach; everything outside the
sites' boxes is untouched. The terrain mesh is too coarse for a cutting, so each portal's ground is cut out of the
terrain shader (world.js `TERRAIN_CUT_U`, rectangles; a material drawing replacement ground defines `UG_KEEP`) and drawn
as a fine mesh with the terrain's own material, with no ground over the tunnel mouth (ugworld.js `PortalGround`). Trees
and grass keep off (`world.blockTree`, `world.noGrass`). `ugTunnelAt(x, z, y)` says when a point is inside a tunnel or
hall (floor, arch height): `game.surfaceAt` and the cameras (`game.camGround`, `underground.clampCamera`) use it, and the
player's jet crashes into the walls and arch. Interiors (ugint.js) are drawn only with a door open and the camera near
and in front, or the camera inside; their materials (`interiorMaterial`) are lit by the tunnel lamps — baked into the
lining, the nearest 12 as point lights — instead of the sun, sky and environment.

**Life.** Doors: `complex.openDoor(portalId, user)` / `releaseDoor` (open while anyone needs them, shut 8 s after the
last one; klaxon, beacons); `doorOpen(id)`, `usable(id)`. Scrambles: `underground.scramble(types, target, { role,
callsign, route, complex })` → a sortie (the jets taxi out of the hall through the door, down the taxiway, take off,
and become a director flight with `f.ugHome`), or null; `scrambleOrigin(pos)` is where one would come from (null if
none can). The director's GCI uses it when the underground airbase is nearer than its other origins. TELs are strikes.js
red `launcher` sources (`UgLauncher`, held until set up): a launch order sends one out to a pad; it sets up, fires,
stows and comes back in by the other portal. The missile base also fires on its own every ~7–11 minutes
(`missileSortie()`, through `strikes.request(type, marks, team, quiet, { only })`).

**Intelligence.** Each complex's units are war units: the `facility` (cls `facility`, UNKNOWN), the `entrance`s (cls
`entrance`, conceal 0.72), the clues (cls `bunker` / `radar` / `vehicle`) and the airbase's airfield (pre-war imagery).
Anyone who reveals a clue (eyes, the pod, recon aircraft, drones: `war.reveal`) adds to the complex's score (tracks,
guard post, power line 1; substation, mast 0.75; a vent 1.5 once IDENTIFIED — its heat, `u.heat` in sensors.js
`heatOf`; an entrance 2): CONTACT "UNKNOWN FACILITY" at 1, "POSSIBLE MISSILE STORAGE" (or "… UNDERGROUND HANGARS") at
3, IDENTIFIED "CONFIRMED UNDERGROUND MISSILE FACILITY" (or "… AIRBASE") at 5.5 — or at once when a door is seen moving,
an entrance is identified or a vehicle is seen coming out. Then: the TARGET IDENTIFIED callout, the radio, the reports
resolved, penetrators added to the blue missile field. Reports ("… IN THE HILLS 14 KM NORTH-EAST OF VORSK") come a few
minutes into the war, and when a hidden complex scrambles or launches.

**Striking it.** Only penetrators close an entrance: a strike missile with `hard ≥ 0.9` within ~22 m of the portal
(`strategicImpact`), a heavy bomber's bomb, or any bomb in the open doorway (weapons.js `worldBlast` emits `'blast'` (at,
{ r, amount, owner, kind: 'bomb' | 'blast' })). Everything else scars the facade. All entrances down seals the complex:
what's inside is trapped, its launchers are dead, no more scrambles. BDA: a unit may carry `bdaResult()`, which
strikes.js `reportBDA` uses ("ENTRANCE 2 OF 3 DESTROYED", "… FACADE SCARRED, DOOR INTACT (PENETRATOR REQUIRED)").
Tasks: INVESTIGATE REPORTED ACTIVITY, FIND THE ENTRANCES, SEAL <complex>, DESTROY THE ENTRANCES BEFORE THE TEL FIRES
(urgent). Map: the runway once known, a ring and the entrance count once identified; the panel's PENETRATOR STRIKE ON
ALL KNOWN ENTRANCES, and COMMAND › TACTICAL SUPPORT › PENETRATORS ON <complex>. Ground targets inside a mountain carry
`hidden` (off the HUD and target cycling).

**Events:** `ugClue` (complex, { clue, score }), `ugStage` (complex, { stage }), `ugDoor` (complex, { portal, open }),
`ugScramble` (complex, { sortie }), `ugTelSortie` (complex, { tel }), `ugEntranceDestroyed` (complex, { portal,
entrance }), `ugSealed` (complex).


## Night and weather (Phase C: firelight.js, weather.js, weathersys.js, nightfx.js)

### How to see it
- Menu: TIME (dawn, midday, dusk, night) and WEATHER (clear, cloudy, rain, storm, **fog**, **low** cloud).
- In the Living War the clock runs ×20 (a day in ~72 minutes: the war goes on into dusk and night) and a front
  comes through every 15-35 minutes, announced by WEATHER on the radio. COMMAND › SANDBOX › WEATHER / TIME (Sandbox,
  Free Flight and the Living War): any weather over two minutes, a front from upwind, automatic fronts on / off, jump
  to a time, clock stopped / ×1 / ×20 / ×60 / ×300.
- I: night-vision goggles (a GPU pass now: amplified, green phosphor, grain, halos, the round eyepiece). The tactical
  map's WEATHER layer is a weather-radar picture (green → yellow → red → magenta cells), cloud, fog and the front.

### `game.weather` (weathersys.js)
- `set(kind, { transition, say })`: the weather everywhere, now or blended over `transition` seconds. Kinds:
  `clear`, `cloudy`, `rain`, `storm`, `fog`, `overcast` (weather.js `WEATHER_KINDS`: cloud cover and heights, the rain
  deck, rain rates, ground fog, wind, turbulence, lightning).
- `front(kind, { heading, speed, width, eta, dist, say })`: `kind` moves in behind a line across the map (default: with
  the wind, 18 m/s, a 16 km transition zone); `eta` is when its middle reaches the camera. Ahead of the line the old
  weather, behind it the new (the clouds, fog, rain and palette all follow); 60 km past the camera it takes over.
- `timeScale` (sky clock: game seconds per second; 0 = stopped), `hour`, `setTime(hour | 'dawn' | 'day' | 'dusk' |
  'night')`, `auto` (the Living War's own fronts). The director (or anyone) drives the weather with these.
- Queries: `visibility(pos)` (m, Koschmieder), `ceiling(pos)` (lowest cloud base over it, m), `rainAt(pos)` (mm/h),
  `stormAt(pos)` (0..1: under a thunderstorm cell), `transmittance(a, b, band)` (0..1; band `'eye'`, `'tv'`, `'ir'`,
  `'radar'`), `irClear(a, b)` (no heat-seeker lock through cloud or fog), `caution(pos)` (how carefully to fly there),
  `describe(pos)` (the radio's words: "THUNDERSTORMS, CEILING 900 M, VISIBILITY 1.4 KM").
- **For the airbases (runway lights, searchlights):** `night` (0 day … 1 night, continuous) and `lightsOn` (on from a
  little before sunset to a little after sunrise; `setNight(on)` is still called on every change), `visibility(pos)`
  and `ceiling(pos)` (e.g. approach lights by day in fog or under a low ceiling). Events: none needed; poll these.
- Events: `missileLostInCloud` (owner, { missile, target }) when a heat seeker loses a target hidden in cloud / fog.

### What it does in play
- **Eyes** (war.js `updateSensors`): each line of sight carries its own haze, ground fog, rain and cloud (contact
  needs a little contrast, identifying much more); darkness is continuous (`night`); at night what stands in a fire's
  light is seen as by day. **Radar** ignores cloud; heavy rain costs some range. **Targeting pod**: its line of sight
  through cloud, fog and rain by band (the FLIR sees through haze and some rain, not cloud or fog).
- **IR**: the player's and the AI's heat seekers don't lock through cloud or fog (HUD: NO IR — CLOUD); a heat seeker in
  flight whose target stays hidden for 0.6 s loses it (dive into a cloud to shake one). The HUD's locked target shows
  TGT OBSCURED — CLOUD / FOG / RAIN when the eye can't see it. Marking a target or accepting a task under bad weather
  gets WEATHER OVER TARGET on the radio.
- **AI** (ai.js): finds enemies by radar (nose cone) or by eye (~9 km by day, less at night; an afterburner shows), not
  through cloud or fog; flies higher and gentler in bad weather and at night (`caution`).
- **Flight**: gusts and turbulence from `wx.turbulence` (in and under storm cells, in cloud, low down in a strong wind;
  ~±1-2 m/s² in rain, up to ~±5 in a cell core); the wind follows the weather.
- **Storms**: rain shafts drawn in the cloud march (dark curtains under the cells), lightning where the cells are (two
  in three inside the cloud, else a bolt that lights the ground round it), thunder delayed by distance at 343 m/s
  (a crack close by, a long low rumble far off), rain on the canopy in the cockpit view (and mist from cloud).
- **Fog**: a ground-fog layer with a flat top in the fog shader (and its JS twin): radiation / valley fog forms toward
  dawn after a clear night in the low ground (gone by mid-morning), sea fog banks drift with the wind, `fog` weather
  is dense (~350 m visibility under a 170 m top, clear above: hills stand out of it), `overcast` is a low stratus
  ceiling (~450 m) with drizzle and sea fog banks.

### Fire light (firelight.js), for plug-ins
- `effects.light(pos, intensity, life, opts)` (as before) → `fireLights.flash`: a burst of light that decays;
  calls at a moving plume merge into one light. `fireLights.keep(key, pos, I, opts)` for a light that lives while
  refreshed every frame; `fireLights.heat(pos, size)` for flames (effects.puffFire and burning smoke columns already
  report theirs, so anything that burns lights its surroundings). Budget by quality: 3 / 6 / 12 / 24 lights on
  surfaces (a quarter by day), 0 / 0 / 4 / 8 in the clouds, 0 / 4 / 6 / 8 glowing in the air. The FLIR sees none.
- Custom shaders: `FIRE_VIEW_GLSL` / `FIRE_WORLD_GLSL` + `fireUniforms()` (smoke, trails and the sea use them).

## Airbases (`game.bases`, src/bases.js)

The military fields (home, enemy, Miramar; the civil airport only gets the lighting) are live installations. The
plan of each field is `baseLayout(b)` in src/baselayout.js (base-local metres: `lx` across the runway toward the
apron, `lz` along it; shelters, QRA pad, taxi graph, tower, radar, power plant, fuel farms, igloos, depot, sirens,
searchlights, floods, pads, and the lighting configuration). The logic is plain JS in src/basestate.js (tested
headless); the visuals are src/basestructures.js (instanced installations), src/baselife.js (people, vehicles,
repair teams, physical scrambles), src/runwaycraters.js (craters cut into the pavement) and src/airfieldlights.js.
Models: models/airbases/ (tools/airbases/, see its CREDITS.md). `bases.render = false` runs it headless.

### Alert states
- Per field `F.fsm` (AlertFSM): `NORMAL` → `ALERT` (a hostile aircraft, flight or missile its side can see coming,
  or a scramble) → `ATTACK` (a blast on the field, or a threat within 12 km / 4 km) → back down after
  `ATTACK_HOLD` 40 s / `ALERT_HOLD` 90 s (with a minimum dwell) to `DAMAGED` while craters or losses are
  unrepaired, else `NORMAL`. Escalation is immediate.
- What it drives: the siren (rise-and-hold for ALERT, wavering for ATTACK, steady ALL CLEAR), the tower's calls
  ("ALARM YELLOW", "ALARM RED — TAKE COVER", "ALL CLEAR — DAMAGE: …"), crews running to the bunkers and vehicles
  pulling off the apron, AAA / SAM readiness (`t.readiness` 0.35 → 1: ground.js fires and locks slower when low; the
  S-300 launchers erect), the repair teams holding during ATTACK, and at night a blackout (all field lights off
  during ATTACK or with raiders inside 25 km) with the searchlights sweeping and coning raiders.
- The enemy field goes to ALERT the same way: SIGINT tells us ("… HAS GONE TO ALERT — EXPECT FIGHTERS").

### Components (war units, `war.add`)
| class | what | effect when lost |
|---|---|---|
| `runway` | RunwayUnit; never destroyed — `closed` when its minimum operating strip (15 m × 1200 m clear of craters and their broken lips) is gone; `hp` = MOS / length | no launches (`launchStatus` → `{ ok: false, why: 'runway' }`), the director's enemy scrambles come from further away, air traffic holds / goes around, the lights show a yellow X, the tower calls it |
| `taxiway` | TaxiwayUnit; craters on a taxiway cut that edge of the taxi graph | taxi routes go round it (the runway as a last resort) |
| `tower` | the control tower (airbase.js's building) | no ATC calls (only critical news, from COMMAND), scrambles wait ~34 s longer for no clearance |
| `radar` | the airfield surveillance radar | no coverage from it (no GCI from it); also dark without power (`u.unpowered`, which `war.coverage` skips) |
| `power` | the power plant (PowerPlant) | runway / taxiway / flood lights and the beacon out, the radar and the field's own radars unpowered, slower engine starts |
| `shelter` | each hardened aircraft shelter (hardened 0.7: a 500 lb bomb near it hardly marks it, a penetrator goes through) | the jet inside is lost with it |
| `fuel` | bulk fuel storage (ground.js fuel sites) | burns with secondaries for a minute; the sortie rate (turnarounds) drops |
| `ammo` | munitions igloos | cook-off for minutes (blasts that can set off neighbours); sortie rate drops |

Damage persists for the session; only the repair teams repair (runway / taxiway craters: clearing 50 s, filling 70 s,
capping 40 s for a 500 lb crater, scaled by size; two teams of a loader and a dump truck from the equipment yard,
two reserve teams if they're killed — the enemy sends attack aircraft after ours sometimes).

### API
- `bases.field(idOrBase)`, `bases.fieldAt(pos, margin)` → a Field: `{ id, base, team, name, state, stateName,
  fsm, craters (CraterField), crews, graph (TaxiGraph), airwing (Airwing), units, closed[], powered, blackout,
  runwayOpen, towerUp, fuelFrac, ammoFrac, rate, threat, threatDist, w(lx, lz, dy), local(pos) }`.
- `bases.launchStatus(b)` → `{ ok, why }` (why: `'runway' | 'aircraft' | 'fuel'`); `bases.raidAim(b)` → where a raid
  should aim (along the runway or at an installation). The director uses both.
- `bases.scramble(from, { team, types, role, callsign, skill, speed, target, setup(flight) })` → `{ field, eta,
  physical, types, scramble }`, `false` when the field can't launch now (runway, no jets, a pair already going),
  `null` when `from` is not an airfield with an airwing. Near the camera (< 16 km) it is physical: the horn, pilots
  running from the QRA building, canopies, engines, the doors, taxi on the graph to the runway, a pair line-up and
  an afterburner stream take-off, then `director.adopt(flight, jets)` hands the real aircraft to the director at
  160 m; far away it's the same timeline (`scrambleTimeline`) and `director.spawnFlight` at wheels-up. `setup` is
  called with the flight either way. The director's GCI scrambles go through it.
- The alert pair: two jets in the QRA shelters on five-minute alert; after a launch a ready jet from the shelters
  takes over (REFILL 150 s + a 90 s turnaround); jets back from a sortie turn round in a shelter (TURNAROUND 420 s,
  longer short of fuel and munitions).
- Events: `baseAlert` (field, { from, to }), `runwayClosed` / `runwayOpened` (field, { rw }), `baseDamage` (field,
  { what, unit, source }), `baseScramble` (field, { scramble }), `scrambleAborted` (field, { scramble, why }).
  Listens to `bombImpact` (weapons.js: every bomb's burst), `strategicImpact` (a runway-attack missile leaves a
  line of three craters across the runway), `raidDetected`, `raidHit`, `groundKilled`, `flightDone`, `killed`.
- Radio goes through `director.say` (the field's tower while it stands, else COMMAND; INTEL for the enemy field).
- HUD: an AIRFIELD block when near a field (state, runway MOS / closed, repair ETA, alert jets). Map: the fields'
  state rings, craters, crews, runway X; COMMAND › AIRFIELDS lists them.
- Tasks (`tasks.addGenerator`): cover the runway repair at our field (urgent), crater the enemy runway before their
  scramble / while they're at alert, stop their repair teams, strike their alert shelters while at ALERT.

### Lighting (src/airfieldlights.js)
FAA AC 150/5340-30 / ICAO Annex 14 layouts, one `THREE.Points` per field with directional colours: edge lights
≤ 60 m (yellow caution zone), threshold / end bars, centreline (colour-coded), TDZ, ALSF-2 / MALSR / Calvert
approach lights with sequenced flashers, REIL, PAPI (4 units, 3°30′ … 2°30′), blue taxiway edges, stop bars and
wig-wags (lit while a runway is closed), sodium apron floods with pools, obstruction lights, the rotating beacon
(military double white flash). The approach end is the one the autopilot lands on (`approachDir`). Circuits:
`lights.setPower(id, on)`, `setBlackout(id, on)`, `setClosed(id, r, closed)`, `setSearch(id, on, targets)`,
`setWeather(id, on)`, `lit(id)`. They show after dark (`setNight`, `game.weather.lightsOn`) and, polled once a
second by bases.js, by day when `game.weather.visibility` at the field is under 5 km or its `ceiling` under 450 m.
The blackout and searchlights follow `game.weather.night` (> 0.5). Burning fuel and ammunition use the normal
effects fire, so the weather's fire light already lights their surroundings.

### Coastal missile batteries (`game.coastal`, src/coastal.js)
A K-300P Bastion-P battery on the red coast (two K-340P launchers, command vehicle, radar) and a Harpoon coastal
battery on ours (two quad launchers, command post, Sentinel) — `strikes` launch sources of kind `'battery'`
(`CoastalBattery extends LaunchSource`). They engage ships through `strikes.request('antiship', [ship], team)` only
when they are the shooter the manager would pick; two salvos, then reloads. The home field also has a hardened
HIMARS pad (a `GroundLauncher` 'SKYWAR PAD HIMARS', ATACMS × 2 + a penetrator) and the enemy field an S-300 battery
and its Flap Lid on pads.

## Sandbox toolkit (`game.sandbox`: src/sandbox.js, sandboxdefs.js, sandboxunits.js, spectator.js)

SANDBOX mode only. Everything goes through the plug-ins' own APIs above: nothing here flies, drives or fights by
itself except an armour platoon's gunnery and a helicopter's circuit (no plug-in has those).

### For the player
- **The panel** (tactical map, left; `◂` folds it): SPAWN · UNITS · WAR · WATCH · FILE.
  - SPAWN: a category (AIR, NAVAL, GROUND, SITES), the item, the side (BLUE / RED / CIVIL where it makes sense:
    helicopters), the type, how many, the altitude (aircraft: 5K / 16K / 30K FT; helicopters 400 / 1000 / 2000 FT
    above the ground). Then every click on the map places one; the cursor shows a green ring where it fits and a red
    cross with the reason where it doesn't (SHIPS NEED WATER, NOT ENOUGH OPEN WATER, GROUND UNITS NEED LAND, TOO STEEP,
    ON THE SHORELINE, ON A RUNWAY, IN A TOWN, MORE THAN 3.5 KM FROM THE SEA). A convoy takes two clicks: start, then
    destination. Right-click or STOP PLACING disarms.
  - Items: fighters, attack jets, bombers, AWACS, tanker, EW jammer (EA-18G), drone (MQ-9 / RQ-4), helicopter; carrier
    group, surface group, destroyer pair, submarine; missile launchers (red Scud TEL / blue HIMARS-M270 ATACMS), SAM
    site (S-300, Buk, Osa / Patriot), rocket artillery (Grad, Smerch / GMLRS, HIMARS, M270), convoy, armour platoon,
    infantry squad; coastal battery, radar, forward position (command post, radar, two SPAAGs, three tanks, two
    squads, an Osa or a Patriot).
  - UNITS: everything placed with what it's doing; a click selects it (and centres the map). A selected unit (or a
    click on its ring or any of its units on the map) gets its actions in the map's panel: FOLLOW WITH THE CAMERA, its
    missions, DELETE (also the Delete key).
  - WAR: fly for BLUE or RED; BACKGROUND WAR on / off (the director's CAPs, raids, GCI, convoys and missile strikes, the
    forces' own orders, the task board, automatic fronts); SHOW ALL PLACED (the map rings the other side's units too,
    found or not: intel is untouched); the weather (at once or over two minutes, a storm or clearing front) and the
    time of day and the sky clock.
  - WATCH: the spectator, its view, the sim clock (PAUSE, ×1, ×2, ×4), and whether your jet is held while you watch.
  - FILE: the five scenarios, three save slots (SAVE / LOAD / CLEAR).
- **Missions** (map panel, per unit; what each item takes is `ITEMS[item].missions`): PATROL ROUTE (click waypoints,
  right-click / Enter to finish, Backspace to undo), CAP ORBIT (a point), STRIKE TARGET (a unit or a point), ESCORT (a
  unit), RECON AREA, SEAD, MOVE TO, RETURN TO BASE. Each is drawn on the map (route, orbit, strike line with its X,
  escort line). Esc cancels a tool without closing the map.
- **Spectator** (Backspace, the map's FOLLOW, WATCH): TAB / T next, X previous (placed units first, then every
  aircraft, ship and ground unit), V cycles CHASE / ORBIT / TOP / FREE, F free camera (W/S/A/D, Q/E, Shift ×5, mouse
  look, wheel speed), wheel zooms, 1–4 set the clock; the HUD box says what the followed unit is doing (orders, state,
  its pilot's target and range, speed, height, condition, intel, missiles inbound). PAGE UP / PAGE DOWN and HOME work
  any time. The strikes' missile camera (K) still takes over while it's on.
- **Scenarios**: CARRIER GROUP VS COASTAL DEFENCE, SEAD PACKAGE VS S-300 AND BUK, SCUD HUNT AT NIGHT, AIR BATTLE: 4V4
  WITH AWACS, CONVOY AMBUSH (`PRESETS` in sandboxdefs.js: each builds its setup from the terrain with `findSpot`).
- **Designating and striking**: the map's MARK / STRIKE ▸ as everywhere (our side's shooters); a unit or point of any
  side also gets `<OTHER SIDE> STRIKE HERE: BALLISTIC / CRUISE / ROCKETS` (`strikes.request(type, [mark], enemyTeam)`).

### API
- `sandbox.place(item, team, x, z, { variant, n, alt, to, from, quiet })` → a record `{ id, item, kind, team, variant,
  type, n, alt, at, handle, mission, label }` or null (`sandbox.why`). `remove(rec)`, `removeAll()`.
- `sandbox.assign(rec, { type, route: [{ x, z }], at: { x, z }, target: { rec } | { unit } })` → true or a reason.
- `unitsOf(rec)`, `leadOf(rec)`, `posOf(rec, out)`, `aliveOf(rec)`, `stateOf(rec)`, `recOfUnit(u)`.
- `setFaction('blue' | 'red')`, `setBackground(on)`, `setSimSpeed(0 | 1 | 2 | 4)`, `spectate({ rec } | { unit })`,
  `snapshot(name)` → setup, `apply(setup)`, `loadPreset(id)`, `saveSlot(i)`, `loadSlot(i)`.
- Rules (sandboxdefs.js, pure): `ITEMS`, `MISSIONS`, `validatePlacement(item, x, z, env, { alt })` → `{ ok, why, y }`,
  `findSpot(item, anchor, env, { rMin, rMax, side, away, minFrom })`, `normalizeSetup(s)`, `readStore(storage)` /
  `writeStore(storage, store)` (only `localStorage['skywar.sandbox']`: `{ v: 1, slots: [setup | null ×3] }`).
- A setup: `{ v: 1, name, faction, background, weather, hour, clock, player?: { x, z, alt, heading }, view?: { follow },
  units: [{ item, team, variant, n, alt, x, z, to?, from?, near?: { ref, along, side }, mission?: { type, route, at,
  target: { ref } | { x, z } } }] }`.
- Drivers (sandboxunits.js `DRIVERS`, one per kind): flights → `director.spawnFlight` (roles `cap`, `orbit`, `cas`,
  `strike` / `raid`, `escort`, `recon`; a patrol walks the CAP point along the route, or flies it round with `f.loop`;
  SEAD is `cas` with `f.pick` choosing air defences first, and two HARMs a jet fired at radiating radars); support →
  `air.spawnAWACS / spawnTanker / sendGrowler / sendRecon / taskRecon`; ship groups → `navalops.spawnGroup /
  moveGroupOf / launchFrom`; TELs, SAMs, artillery, convoys, coastal batteries → `forces.spawn… / fireMission /
  relocate` (an order a busy launcher can't take is asked again every 6 s; a convoy's next leg is planned per vehicle
  over the road graph); armour, radars and forward positions are `ground` targets in the war registry; infantry are
  `infantry.spawnSquad` squads.

### Hooks it added to shared code
- game.js: `simStep(dt, mouse)` is one step of the world; `update` runs `game.simSpeed ?? 1` of them a frame (0 holds
  the world, the camera, HUD and map go on); `game.subStep` marks the extra ones (the map draws once). A jet with
  `held` isn't flown (the spectator parks yours). `game.side` is `war.side`; the player's jet, hostile candidates,
  friendly pads, kill credit and messages follow it. System `updateCamera(cam, dt, mouse)` gets the mouse.
- war.js: `setSide(side)` (the new side's units confirmed, the old side's back to pre-war intel, marks cleared, event
  `warSide`); `clear()` resets the side to blue; no intel from the spectator's camera (`game.spectating`).
- tacmap.js: `mapClick(x, y, map)` → true to take a click before selection; the map's panel buttons carry `label`.
- director.js: `focus()` is `game.viewFocus` while spectating; `f.loop`, `f.pick`; `auto = false` stops its own
  activity (its flights still fly); `liveMax` / `fighterMax` raise the real-jet budget (the sandbox: 12 / 8).
- hud.js / cockpit.js / ai.js / wingmen.js: friend or foe by `war.side`; no jet symbology or warnings while spectating.

### What doesn't swap sides (flying for red)
The background war is blue against red with the player on blue (the director's GCI "their radars have you", raids on
our fields, the task board, MAGIC's calls, the RC-135 and B-52): it's switched off while you fly for red. Base and place
names stay as they are ("ENEMY AIR BASE" is the red field's name). The support aircraft the air plug-in launches for the
player's side (Growler, MQ-9, RC-135) and the blue strike sources keep their American types. On foot (after ejecting)
the pilot keeps the blue side's rules. The carrier start is the blue carrier's; red starts on its airfield.

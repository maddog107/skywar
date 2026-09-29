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
- **Sandbox** runs the same war (the later sandbox tools shape it). **Free Flight** stays peaceful (marks and
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
  has added red `launcher` sources.
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

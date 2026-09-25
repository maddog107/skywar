# SKYWAR

A browser flight-combat game built with three.js. Fly real jets over streamed, procedurally generated
islands and mountains. Fight AI squadrons, hit an enemy airbase, or take off and land in free flight.

## Run

```bash
npm start            # or: node server.mjs
# open http://localhost:8080
```

You need a local server because the game uses ES modules and loads `.glb` models. Opening
`index.html` straight from disk won't work. There are no npm dependencies: three.js comes from a CDN.

## Features

- **30 aircraft**: 22 with real glTF models (F-16, F-15, F-14, F-4, F-5, Typhoon, Rafale, Mirage,
  Jaguar, MiG-21/25/29, J-8/10/20, Su-57, Su-47, B-2 and more). The rest use detailed procedural models.
- **Energy-based flight model**: lift from angle of attack, induced drag that bleeds speed in turns,
  stalls, thinner air at altitude, afterburner and a transonic drag rise. Fly-by-wire G-command
  handling with per-aircraft G limits. Takeoff, landing (gear, brakes) and rearming on the home runway.
- **3D cockpit** in the style of GeoFS: live MFDs (radar, stores), attitude indicator, gauges,
  warning lights, moving stick and throttle, sun shadows sweeping the panel, and head motion under G.
- **Combat**: lead-computing gunsight, IR missiles (flares decoy them), radar missiles (9 km,
  flare-proof), rocket pods, flares, missile warnings, SAM sites and AAA flak.
- **Battle damage**: every airframe is cut into sections. Missiles can shear off a wing, damaged
  wings burn and trail smoke, killed jets break apart, and pilots eject under parachutes.
- **AI pilots**: they turn to fight, lead their gun shots, beam incoming missiles, drop flares,
  jink when under fire, extend when hurt, and avoid terrain. Skill scales with difficulty.
  Every fourth wave brings a named ace.
- **Missions**: Clean Sweep, Five on One, Ace Duel, SAM Alley, Escort, Scramble, Carrier Killer,
  Deadstick, Trap, Grand Theft Aero (start as a civilian, carjack a car, ram the Miramar gate, steal a jet with the
  military police on your tail, then outrun the interceptors) and Bridge Out (bomb a river bridge ahead of an armoured convoy, then destroy the stranded column), plus a Daily Mission picked from the date (the mission, jet and time of day change every day).
- **Modes**: Dogfight waves, Strike (destroy an airbase), Naval Strike (sink a carrier group),
  Survival, Target Practice (timed range), Sandbox (unlimited everything, invincible, bombs, N spawns
  bandits), Ring Race (timed canyon course) and Free Flight (with an unarmed carrier group offshore to shoot at).
- **Weather**: clear, cloudy, rain or storm, with rain streaks, darker skies, turbulence, and lightning
  whose thunder arrives late depending on distance. **Photo mode** (O) freezes the action for orbit shots. Four times of day: dawn, midday, dusk and night.
- **Aircraft carriers**: take off by catapult (full throttle on deck) and land on the angled deck to
  catch an arresting wire with the tailhook (H), and the wire stretches out to the hook as it stops you. Enemy carriers and destroyers defend themselves with CIWS guns that shoot
  down missiles, SAMs, a naval gun and deck-launched fighters. Destroyed ships burn and sink.
- **Airmanship**: animated landing gear, flaps (more lift, lower stall speed), speed brakes that dump
  lift on the ground, wheel brakes, and fuel (the afterburner burns it 4× faster, then BINGO, then a
  flameout that leaves you gliding). Land gear-up or too hard and you belly-land in sparks, or ditch at
  sea and slowly sink, instead of exploding. Start in the air, on the runway, on the apron (taxi out) or on the
  carrier. Stop on a friendly runway or deck to repair, refuel and rearm. In Free Flight and Sandbox the
  pause menu has Quick Position buttons (runway/carrier approach, runway takeoff, catapult), and the
  autopilot can auto-land (Y) at the nearest runway or carrier, or auto-takeoff (U).
- **Towns, roads and bridges**: about 30 villages, towns and cities built on street grids: houses with
  pitched roofs, townhouses, apartment blocks and downtown towers (windows light up at night), churches,
  parks, street lamps, and crossroads with working traffic lights and stop signs that the traffic obeys.
  Marked two-lane roads join the towns (and go round the airbases, never across a runway); dirt trails
  run out into the hills with dune buggies kicking up dust. Roads cross water on concrete and
  cable-stayed bridges. Bombs drop them, and the cars stop at the gap.
- **Airbases**: perimeter fences, a gate checkpoint (guard booth, boom barriers that lift for traffic,
  Humvees, jersey barriers, flag), control tower with a beacon, rotating radar, windsock, helipads,
  parked jets and a C-130, and helicopters flying circuits (plus a news chopper over the city).
- **More airports**: MCAS Miramar (parallel runways 32L/32R + crosswind 27/09, a flight line of
  F/A-18s, F-35s, C-130s and helicopters, hangars and base buildings) and Harbor International (runway
  16/34 on the waterfront, two terminals with airliners at the jet bridges, parking garage). Every runway
  has painted designators worked out from its real compass heading. Both airports have scheduled
  traffic: arrivals fly the glide path, land, roll out and taxi in; departures hold short, line up and
  take off. The autopilot lands at the nearest friendly airfield.
- **Roads that make sense**: roads follow the ground closely and never flicker or pop, stray fragments are removed,
  and wherever a road genuinely has to stop there's a roadblock: barriers, cones and a ROAD CLOSED / ROAD WORK
  AHEAD / END OF ROAD sign.
- **Performance**: cars, parked cars and pedestrians are only drawn near the camera, airport flight lines only
  near their base, and far-away traffic is simulated at a lower rate (about 20× fewer triangles per frame).
- **Real vehicles**: traffic and the cars in driveways are real car models (sedans, hatchbacks, SUVs,
  sports cars, taxis, police cars); convoys use a modern tank, M939 trucks and Humvees. Houses have
  front yards and driveways with one or two cars, and people walk the sidewalks.
- **Steerable parachute**: after ejecting you see your canopy in third person (V for first person);
  A/D turn, W dives, S brakes, SPACE flares just before touchdown. Once down you can walk (WASD, SHIFT
  to run), board a jet (E) or call for a new one (ENTER). Stopped on the ground (after a crash landing
  or just parked)? Press E to climb out.
- **Ready Room start** (Start: BARRACKS, or the pause-menu quick position): begin at the pilot quarters
  in a Humvee, drive to the gate, stop for the sentry, drive onto the apron, get out (E), walk to your
  jet, climb in (E), then taxi and take off. Flaps help: with full flaps a jet lifts off on its own.
- **Hangar**: nine paint schemes and three loadouts (Balanced, Air Superiority, Strike). Bombs
  have a CCIP impact pipper and leave craters.
- **Ejection, War Thunder trailer style**: eject (J J) into a first-person view under the parachute.
  You have an AK-47: shoot enemy parachutists (they shoot back), or shoot a pilot through his canopy,
  press E, and he gets shoved out while you take his jet. Your own abandoned jet or a friendly
  wingman's can be hijacked too. Each combat mission gives you 3 jets.
- **Presentation**: HDR bloom, PBR jets reflecting a baked sky, sun shadows, volumetric-style
  instanced clouds, an animated ocean, forests, contrails, wingtip vortices, vapour cones,
  G-LOC blackout, synthesized audio, and spoken radio callouts.

## Controls

| Input | Action |
|---|---|
| Mouse | Aim (Mouse-Aim mode), stick (Mouse-Stick / GeoFS mode), or look (Keys mode) |
| W/S, A/D, Q/E | Pitch, roll, rudder |
| 1 … 9, 0 | Throttle steps: 1 idle, 9 full power without afterburner, 0 afterburner |
| Z / Shift, mouse wheel | Throttle up / down |
| LMB / Space | Cannon (Space means wheel brakes on the ground) |
| RMB / M | Fire selected weapon |
| X | Cycle weapon: SRM, LRM, rockets, bombs |
| R | Flares |
| F | Flaps |
| Y / U | Autopilot: auto-land (nearest friendly runway or carrier) / auto-takeoff |
| J J | Eject; then E hijacks, R reloads, WASD/arrows steer the chute |
| N | Spawn a bandit (Sandbox / Free Flight) |
| L | Change loadout while stopped on a friendly pad (look behind in the air) |
| T / Tab | Cycle target |
| C (hold) / L (hold) | Padlock target / look behind |
| V / K | Camera: chase, cockpit, far, cinematic / missile cam |
| O | Photo mode (freeze, orbit, zoom, no HUD) |
| H | Tailhook up/down (catch a carrier wire) |
| F1 / ? | Help (controls) |
| B / G | Spoilers on/off / landing gear |
| Enter | New jet after a crash landing or parachute landing |
| Esc / P | Pause (Quick Position in Free Flight / Sandbox) |

A gamepad is supported: left stick flies, right stick X is rudder, RT fires guns, LT is the airbrake,
A fires the weapon, B drops flares, X cycles targets, Y changes camera, LB/RB throttle, D-pad switches
weapons, Back toggles gear and Start pauses.

## Code layout

`src/main.js` handles bootstrap, rendering and the menu. `game.js` runs modes, the player, targeting and
cameras. `aircraft.js` is the flight model. `ai.js` holds the AI pilots. `weapons.js` handles guns,
missiles and flares. `damage.js` covers break-up and ejection. `naval.js` holds the carriers and destroyers, and `pilot.js` is the on-foot pilot. `world.js` builds terrain, sky, ocean
and clouds. `effects.js` draws particles and trails. `cockpit.js` builds the 3D cockpit. `hud.js`,
`audio.js`, `input.js` and `config.js` hold the HUD, audio, input and aircraft data.

Model credits and licences are in `models/CREDITS.md` and on the in-game Credits screen.

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
- **Modes**: Dogfight waves, Strike (destroy an airbase), Naval Strike (sink a carrier group),
  Survival, Target Practice (timed range), Sandbox (unlimited everything, invincible, bombs, N spawns
  bandits) and Free Flight (with an unarmed carrier group offshore to shoot at). Four times of day: dawn, midday, dusk and night.
- **Aircraft carriers**: take off by catapult (full throttle on deck) and land on the angled deck to
  catch an arresting wire. Enemy carriers and destroyers defend themselves with CIWS guns that shoot
  down missiles, SAMs, a naval gun and deck-launched fighters. Destroyed ships burn and sink.
- **Airmanship**: animated landing gear, flaps (more lift, lower stall speed), speed brakes that dump
  lift on the ground, wheel brakes, and fuel (the afterburner burns it 4× faster, then BINGO, then a
  flameout that leaves you gliding). Land gear-up or too hard and you belly-land in sparks, or ditch at
  sea and slowly sink, instead of exploding. Start in the air, on the runway, on the apron (taxi out) or on the
  carrier. Stop on a friendly runway or deck to repair, refuel and rearm.
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
| J J | Eject; then E hijacks, R reloads, WASD/arrows steer the chute |
| N | Spawn a bandit (Sandbox / Free Flight) |
| L | Change loadout while stopped on a friendly pad (look behind in the air) |
| T / Tab | Cycle target |
| C (hold) / L (hold) | Padlock target / look behind |
| V | Camera: chase, cockpit, far, cinematic |
| B / G | Spoilers on/off / landing gear |
| Enter | New jet after a crash landing or parachute landing |
| Esc | Pause |

A gamepad is supported: sticks fly, RT fires guns, A fires the weapon, B drops flares, X cycles
targets, Y changes camera and the d-pad switches weapons.

## Code layout

`src/main.js` handles bootstrap, rendering and the menu. `game.js` runs modes, the player, targeting and
cameras. `aircraft.js` is the flight model. `ai.js` holds the AI pilots. `weapons.js` handles guns,
missiles and flares. `damage.js` covers break-up and ejection. `naval.js` holds the carriers and destroyers, and `pilot.js` is the on-foot pilot. `world.js` builds terrain, sky, ocean
and clouds. `effects.js` draws particles and trails. `cockpit.js` builds the 3D cockpit. `hud.js`,
`audio.js`, `input.js` and `config.js` hold the HUD, audio, input and aircraft data.

Model credits and licences are in `models/CREDITS.md` and on the in-game Credits screen.

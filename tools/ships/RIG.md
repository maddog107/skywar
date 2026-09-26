# Ship rigs: moving parts and marker points

Every ship model in `models/ships/` names its moving parts and marker points (docs/WAR.md "Model conventions").
`src/naval.js` finds them when it builds a ship and hands them out as `ship.rig`; the pose helpers move them.
Nothing here changes how a ship behaves: the fleet code decides when a door opens or a mast goes up.

## Using a rig

```js
import { openCell, ventCell, cellFrame, raiseMast, setElevator, openHatch, steerWheel, setDepth, poseRig, shipModel } from './naval.js';

const s = game.naval.spawn('destroyer', 'blue', spot, { orbitR: 1800 });   // any type in SHIP_TYPES
openCell(s, 0, 1);                 // cell_1's door fully open (k 0..1, any value in between for the animation)
ventCell(s, 0, 1);                 // the Mk 41 module's exhaust uptake (opens as the missile fires)
const p = new THREE.Vector3(), d = new THREE.Vector3();
cellFrame(s, 0, p, d);             // world position of the cell mouth and the launch direction (+Y of the cell)
raiseMast(sub, 'periscope_1', 1);  // masts: 0 stowed in the sail … 1 fully raised
setDepth(sub, sub.layout.periscopeDepth);   // submarine at periscope depth (only raised masts break the surface)
setElevator(carrier, 0, 1);        // elevator_1 down at the hangar deck (0 = flush with the flight deck)
openHatch(sub, 'hatch_escape', 1); // any hatch_* / door_* by name
steerWheel(boat, -0.5);            // boats: −1 hard to port … 1 hard to starboard
```

`ship.rig` (also on `shipModel(type)`, a ship built without a game, for previews and tests):

| field | what |
|---|---|
| `cells[i]` | missile cells in number order (`cell_1` is `cells[0]`): `{ name, node, door, uptake, spec }`. `node` is an empty at the cell mouth, +Y = launch direction; `spec.depth` = how deep the canister/tube goes below it. `door` is the rig entry of the door or hatch over it (on a submarine one hatch covers several cells). |
| `vls[i]` | the doors / tube hatches themselves (`vls_1` …) |
| `uptakes[i]` | Mk 41 exhaust-uptake hatches, one per 8-cell module |
| `masts` | `{ periscope_1, periscope_2, esm, comms, hdr, radar, snorkel }` (what the boat has) |
| `elevators[i]` | carrier deck-edge elevators (`elevator_1` …) |
| `hatches`, `doors` | `hatch_<name>` / `door_<name>` that swing, by name without the prefix |
| `seats` | boats: `driver`, `1` … `n` (passengers), `gunner_*` — empties where a person sits (+Z = backwards, facing −Z) |
| `points` | every marker empty by full name: `hatch_entry` (where a boat's crew boards), `jet_1`/`jet_2` (waterjet nozzles: spray and thrust), `muzzle_*`, `bridge` (a surfaced sub's cockpit) |
| `wheel` | a boat's steering wheel |
| `nodes` | every rig entry by node name: `{ node, spec, k, p0, q0 }` |

Rig entries record their pose in `k`. Instanced doors (the Mk 41 cell doors: one InstancedMesh per ship, not a
hundred meshes) keep an empty pivot node that the helper moves, then copy it into the instance matrix; don't move
those nodes by hand, use `poseRig(ship, name, k)`.

## How a model declares its rig (Blender scripts, `tools/ships/navkit.py`)

Each rig node is an object with a custom property `rig` (a JSON string, exported as glTF extras):

- `{"t":"door","hinge":[x,y,z],"open":rad}` turns about its own axis `hinge` (after its rest rotation) by `open·k`.
  `navkit.hinged()` builds one from a Part with the pivot on the hinge line.
- `{"t":"mast"|"elevator","slide":[x,y,z],"travel":m}` moves along its own axis by `travel·k` (`navkit.sliding()`).
- `{"t":"wheel","hinge":…,"open":…}` like a door, k −1..1.
- `{"t":"cell","door":"vls_3","uptake":"uptake_1","depth":7.7}` an empty (`navkit.point()`).
- `{"t":"point"}` an empty: seats, `hatch_entry`, nozzles, muzzles.

Doors that share one mesh (same geometry and material, same parent, three or more) are drawn instanced
automatically; anything else stays a mesh of its own, merged per node (one or two draw calls each).

## Per vessel

### Carrier (`carrier`, Nimitz class)
- `elevator_1..4`: the deck-edge elevators (1–3 starboard, 4 port aft). `setElevator(s, i, k)`: 0 flush with the
  flight deck, 1 down at the hangar deck (8.2 m). A jet parked on an elevator (layout.parked) rides it.
- `door_island_1..5` (flight-deck doors of the island: 1–2 port side, 3 forward face, 4–5 starboard),
  `door_accom` (the hull door at the top of the accommodation ladder, hangar-deck level).
- `hatch_entry`: the bottom platform of the starboard-quarter accommodation ladder, 1.5 m above the water.
  A boat comes alongside here (the platform's outboard edge is ~2.3 m off the hull).

Mk 41 on both US escorts (United Defense data sheets, launch photographs): 8-cell modules of 3.16 × 2.18 m,
two rows of four cells (0.79 m pitch) either side of a 0.24 m exhaust-uptake slot; the rows run athwartships
(8 cells across the beam). A lid hinges on its row's outer edge and swings up and outward to stand ~95°
(`open` −1.66 rad); the uptake lid turns up 90° and stands as a low fence (`uptake_<m>`, one per module;
`ventCell(s, i, k)` opens the one of cell i's module). `cell_<n>` is the centre of the cell mouth at the
launcher top, +Y straight up; the canister runs `spec.depth` = 7.7 m (strike length) below it. Where a module
carries the strikedown crane, three cells of one row lie under its cover and have no door or cell.

### Destroyer (`destroyer`, Arleigh Burke Flight IIA, hull 89)
- `vls_1..32` / `cell_1..32`: the forward launcher (4 modules, 8 cells across × 4 along) on its plinth between
  the gun and the bridge; `vls_33..96` / `cell_33..96`: the aft launcher (8 modules, 8 × 8) set into the roof
  between the two hangars. `layout.vls` lists both with their cell ranges and top heights.
- `door_hangar_1` (port), `door_hangar_2` (starboard): roller doors, k = 1 fully up. The flight deck is
  `layout.flightDeck` (z range; 4.0 m above the water).
- Mounts (naval.js defences): `mount_gun_0` Mk 45 Mod 4, `mount_sam_0` / `mount_sam_1` the two launchers
  (empties: the SAM leaves from there), `mount_ciws_0` Phalanx on the superstructure front, `mount_ciws_1` aft
  of the aft funnel. `radar` (SPS-67) turns.

### Cruiser (`cruiser`, Ticonderoga class CG-52 on, hull 62)
- `vls_1..61` / `cell_1..61`: the forward launcher (8 modules, 8 × 8 less the crane's three: the port half,
  second module from forward), flush in the forecastle between the forward gun and the deckhouse;
  `vls_62..122` / `cell_62..122`: the aft launcher on the 01 deck behind the flight deck (crane in the starboard
  half, second module from aft, the outboard three cells of its aft row). `uptake_1..16`.
- `door_hangar_1`: the hangar's roller door onto the raised flight deck (02 level, 10.1 m; `layout.flightDeck`).
- Mounts: `mount_gun_0` / `mount_gun_1` Mk 45 Mod 2 fore and aft, `mount_sam_0` / `mount_sam_1` the launchers,
  `mount_ciws_0` / `mount_ciws_1` Phalanx either side abaft the forward funnel. `radar` (SPS-49 on the main mast)
  and `radar2` (SPS-55 on the foremast) turn. SPY-1 faces: ahead and to starboard on the forward deckhouse, to
  port and aft on the aft one (as on the real ships).

### Supply ship (`supply`, Supply-class T-AOE-6, USNS Supply)
- `ras_1..12`: the span-wire padeyes at the kingpost heads of the twelve replenishment stations, numbered
  forward to aft, odd = starboard, even = port (station 14 was deleted in build; there is no 13/14). Their spec
  and `layout.ras` say what each rig is: `fuel` (single hose), `fuel2` (double hose), `stream` (solid cargo),
  and which side. `hose_<n>_<k>`: where fuel station n's k-th hose leaves its outrigger saddle (the hose
  loops down to a probe cradle at the deck edge). The port side is the carrier side.
- `door_hangar_1..3` (the three hangar bays, facing aft; roller doors, k = 1 up), `door_accom` (hull door at
  the top of the starboard accommodation ladder), `hatch_entry` (the ladder's bottom platform).
- No weapons (MSC service fit): no mounts.

### Slava-class cruiser (`slava`, Project 1164, Varyag 011) — red navy
- P-1000 Vulkan: `vls_1..16` the domed front caps of the 16 containers (8 twin launchers stepped along the
  forward superstructure, 4 a side, pitched 17°), hinged at the top, opening upward. `cell_1..16` at the
  container mouths, +Y along the container axis (forward and 17° up); `spec.depth` = the container length.
- S-300F Fort: `vls_17..24` the launch hatches of the eight below-deck revolvers aft (2 rows of 4), each
  hinged forward; `cell_17..80`, eight per revolver, all at its hatch (the revolver turns the next missile under
  it). `layout.vls` gives both ranges.
- `launcher_osa_1..2`: the Osa-M launchers, `poseRig(s, name, 1)` raises them out of their deck wells.
- Mounts: `mount_gun_0` AK-130, `mount_ciws_0..5` AK-630 (two forward, four on the aft platforms),
  `mount_sam_0` S-300F, `mount_sam_1` Osa-M. `radar` (Top Pair) and `radar2` (Top Steer) turn.

### RHIB (`rhib`, 11 m NSW RIB)
- `seat_driver` (starboard, behind the console), `seat_nav` (port), `seat_1..8` (four rows of two),
  `seat_gunner` (standing at the bow gun), `seat_gunner_2` (aft gun on the engine box). A seat empty sits on
  the saddle; a seated figure faces −Z.
- `wheel` (`steerWheel(s, −1..1)`), `jet_1` / `jet_2` (waterjet nozzles below the transom; +Y points aft
  along the jet: spray and wake), `muzzle_1` (bow M2), `muzzle_2` (aft M240), `hatch_entry` (step over the
  tube, starboard side amidships).

### CB90 (`cb90`, Combat Boat 90H)
- `door_ramp`: the bow ramp's front plate, hinged at its lower edge; k = 1 lowers it forward as a gangway.
  `hatch_bow` (foredeck companionway the troops come up through), `hatch_roof` (commander, wheelhouse roof),
  `hatch_troop_1..2` (troop compartment roof).
- `turret`: the twin 12.7 mm mount on the wheelhouse roof (`poseRig(s, 'turret', k)`, k −1..1 = ±180°), with
  `muzzle_1` / `muzzle_2` on it; `muzzle_3` the 40 mm grenade launcher on the troop roof.
- `seat_driver` (port), `seat_commander` (starboard) in the wheelhouse, `seat_gunner` (roof mount),
  `seat_gunner_2` (ring mount), `seat_1..18` (troops, six rows of three), `wheel`, `jet_1` / `jet_2`
  (FF-450 nozzles), `hatch_entry` (aft deck, starboard).

### Submarines (`ssn` Virginia Block V, `ssgn` Ohio SSGN)
- y = 0 is the surfaced waterline (the Virginia sits 0.84° down by the stern, as in photographs; the model's root
  node carries that trim). `setDepth(s, s.layout.periscopeDepth)` puts the keel at periscope depth (~18 m for the
  Virginia, ~22.6 m for the Ohio): the sail top ~2 m under, the raised masts 3–6 m out of the water.
- `vls_<n>`: missile-tube hatches. Virginia: `vls_1..2` the two Virginia Payload Tubes in the bow (lids hinged
  fore and aft, opening away from each other), `vls_3..6` the four Virginia Payload Module tubes aft of the sail
  (hinged to port). Ohio: `vls_1..24`, two rows of twelve behind the sail, hinged outboard and standing upright
  when open; `vls_1`/`vls_2` are the SOF lock-out chambers (no cells).
- `cell_<n>`: one per Tomahawk, 0.7 m down the tube; `cells[i].door` is the hatch over it. Virginia: 2 × 6 (VPT) +
  4 × 7 (VPM) = 40. Ohio: 22 × 7 = 154. +Y is straight up (with the Virginia's trim: 0.84° off vertical).
- `mast_*` (slide up out of the sail top): Virginia `radar` (BPS-16), `periscope_1`, `periscope_2` (AN/BVS-1
  photonics), `comms` (OE-538), `hdr` (SubHDR SATCOM), `esm` (BLQ-10), `snorkel`; Ohio `periscope_1`,
  `periscope_2` (optical), `esm`, `comms`, `radar`, `snorkel`.
- `hatch_escape`: the lock-out / escape trunk hatch (Virginia: just aft of the sail; Ohio: just forward of it),
  white rescue "sunburst" round it. `hatch_entry`: the deck beside it where a boat's crew steps across.
  `bridge`: the cockpit at the top front of the sail (where the officer of the deck stands surfaced).

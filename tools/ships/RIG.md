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

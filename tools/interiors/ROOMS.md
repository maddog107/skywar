# Interior rooms: how the Blender scripts and the game talk

The rooms of `src/interiors.js` / `src/warrooms.js` are built by the scripts in this folder with `roomkit.py` (which
sits on `tools/ships/shipkit.py`) and exported to `models/interiors/*.glb`. Build everything with
`sh tools/interiors/build.sh` (textures first, then every room); preview a GLB with
`blender -b -P tools/interiors/preview.py -- <glb> <png prefix> "x,y,z:tx,ty,tz[:fov]" …`.

## Frame and units
- Metres, the GAME frame: x right, y up, the room's "forward" is −z. roomkit converts for Blender (`shipkit.V`).
- The room's origin is where the game anchors it (a building's floor, a point in a ship or a vehicle): each room's
  script says where its origin sits in its host's frame.
- Faces point into the room (you're inside); walls you never see from outside can be single-sided.

## What the game reads (node names and extras)
| node | extras `ctl` | what the game does |
|---|---|---|
| `btn_*` | `{t:'button', slide, travel}` | push button: springs in and out when pressed; a binding runs |
| `sw_*` | `{t:'switch', hinge, open}` | toggle switch / key switch: two positions (k 0 / 1) |
| `guard_*` | `{t:'guard', hinge, open, for?}` | flip-up cover; blocks the control it covers (`for`, else the control named like it after the prefix: `guard_fire` → `btn_fire`) until lifted |
| `knob_*` | `{t:'knob', hinge, open, steps}` | rotary selector: click / wheel steps it |
| `lever_*` | `{t:'lever', hinge, open, steps}` | a lever (throttle, engine order): click / wheel steps it |
| `lamp_*` | `{t:'lamp', color}` | an indicator the game lights |
| `exit_*` | `{t:'exit'}` | leave the room (clicking it, or E near it) |
| `door_*` | `{t:'door'}` | go somewhere else (another room): the game's binding decides |
| `screen_*` | `{t:'screen', w, h}` | a live canvas (a quad with 0..1 UVs, canvas top at the top); w × h px |
| `stand_*` | `{t:'station', fov}` | an empty: the camera at that console (looks −z of the empty) |
| `spawn` | `{t:'spawn'}` | an empty: where you stand on entering (looks −z) |
| `lbl_*` | extras `lbl` (text), `st` (style) | a placard: the game draws the text into one atlas and merges them all |
- The root's extras `room`: `{ walk: [[x0, x1, z0, z1, floor y], …], eye, lights: [{t, p, c, i, d}], bg }` —
  walk areas are where you can stand (steps of up to 0.5 m between them); `lights` only matter for closed rooms
  (a room with windows is lit by the world).
- Materials are matched BY NAME (`src/warrooms.js ROOM_MATERIALS`): `Deck`, `DeckTile`, `Carpet`, `Wall`, `WallDark`,
  `Ceiling`, `Console*`, `Panel`, `Concrete` get the shared tiling textures of `models/interiors/tex` (UVs in metres);
  `Glass` becomes see-through; `Screen` is a dark glass panel; `ScreenArt` shows the game's static console pictures
  (`roomkit.monitor(..., art=k)`); `Light*` / `Lamp*` glow. Keep to roomkit's names.
- Control meshes: modelled at the origin facing +z (out of the panel) and placed by roomkit (`button`, `toggle`,
  `guard`, `knob`, `lever`, `lamp`, `keyswitch`, `screen`, `exit_node`); keep them small (a few dozen triangles).

## Budgets
- A room: ≤ 60k triangles static, ≤ 150 control nodes, ≤ 60 screens, ≤ 200 labels; a building exterior ≤ 25k.
- No textures in the GLB (the game's shared ones are tiled by material name); a GLB ≲ 2 MB.

## The rooms
| file | host / origin | notes |
|---|---|---|
| `ssn_control.glb` | Virginia SSN, one deck down under the sail (ship-local origin (0, −4.3, −40)) | closed; sonar to port, fire control to starboard, ship control forward, the command work station in the centre, photonics and navigation aft |
| `cvn_cic.glb` | Nimitz CVN, the Combat Direction Center on the gallery deck | closed, blue light |
| `cvn_prifly.glb` | Nimitz CVN, Primary Flight Control in the island's top | windows onto the flight deck (drawn in the world's scene) |
| `joc.glb`, `joc_ext.glb` | the Joint Operations Center at the home base | the floor (closed) and the building |
| `tel_cabin.glb`, `tel_cab.glb` | the 9P117 Scud TEL (vehicles.js `scud`) | the launch control cabin and the driver's cab |

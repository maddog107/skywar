# Underground complexes (`models/underground/`)

Portals, blast doors and the kit around them, built in Blender by `tools/underground/models.py` with the vehicle kit
(`tools/vehicles/vkit.py`) — **CC0 1.0**, like the other SKYWAR-built models. Rebuild with
`/opt/homebrew/bin/blender -b -P tools/underground/models.py`. The game swaps in its own materials by name
(`src/ugworld.js`): `Paint` is the cast concrete (the `door_*` nodes: painted steel), `Detail` the vehicle kit's palette.

| File | What | Reference used (reference only) |
|---|---|---|
| `portal_air.glb` | Aircraft portal: cast facade with an inverted-T opening (wide and low for the wings, a slot for the fin), two sliding blast-door leaves running into the piers, floor tracks, floodlights, gallery number, hazard paint | Željava / Objekat 505 "Klek" galleries A–C: ~20 m wide doors, ~100 t, inverted-T openings (en/hr/de Wikipedia; zeljava-lybi.com; Commons "Željava underground hangar", "Two Entrances to the underground tunnels of Željava Airforce base") |
| `portal_tel.glb` | Vehicle portal of a missile base: one sliding leaf, 9 × 7 m opening | CSIS "Undeclared North Korea": Sakkanmol / Yusang-ni portals 6–9 m wide |
| `portal_svc_a.glb`, `portal_svc_b.glb` | Service / personnel portals with two outward-opening hinged blast doors | Sakkanmol's "two outward opening doors" (CSIS); Cheyenne Mountain's hinged 25 t blast doors (Commons "NORADBlast-Doors.jpg") |
| `vent.glb` | Ventilation / emergency-exit shaft head with louvred hood and fence | Željava's 13 air shafts that double as exits; Yusang-ni ridgeline air shafts (CSIS) |
| `guardpost.glb` | Checkpoint hut, boom barrier, sandbags | gate checkpoints at Sakkanmol / Hoejung-ni (CSIS) |
| `substation.glb` | Fenced yard: two transformers, gantry with insulator strings, switch house | "power lines … tracing back to substations" (JASON report, NSA EBB 439) |
| `pole.glb` | Concrete power-line pole, cross-arm, pin insulators | Soviet SV-105 concrete poles |
| `mast.glb` | 26 m lattice relay mast with dishes and whips | relay masts over bunkers (NSA EBB 439, Doc 11) |

## Textures (`tex/`)

Photo textures from [Poly Haven](https://polyhaven.com), **CC0**, fetched at 1k by `tools/underground/fetch_textures.py`:

| File | Poly Haven asset | Use |
|---|---|---|
| `facade_diff/nor.jpg` | [concrete_slab_wall](https://polyhaven.com/a/concrete_slab_wall) | portal facades, wing walls |
| `lining_diff/nor.jpg` | [rough_concrete](https://polyhaven.com/a/rough_concrete) | shotcrete tunnel lining |
| `floor_diff/nor.jpg` | [concrete_floor_worn_001](https://polyhaven.com/a/concrete_floor_worn_001) | aprons, hall floors |
| `asphalt_diff.jpg` | [asphalt_01](https://polyhaven.com/a/asphalt_01) | taxiways, roads |
| `gravel_diff.jpg` | [gravel_floor](https://polyhaven.com/a/gravel_floor) | tracks |
| `door_diff/nor.jpg` | [green_metal_rust](https://polyhaven.com/a/green_metal_rust) | blast doors |
| `dirty_diff.jpg` | [dirty_concrete](https://polyhaven.com/a/dirty_concrete) | rubble |

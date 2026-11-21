# Effects atlases

Everything here is made by SKYWAR's own scripts in Blender (no third-party assets). **License: CC0 1.0.**

| Files | What | Made by |
|---|---|---|
| `fireball_air_a.webp`, `fireball_air_b.webp`, `fireball_air.json` | An air burst: a ball of fire that rolls, rises and turns to smoke. 64 frames. | SKYWAR / Blender (Mantaflow gas simulation), `tools/fx/bake_fireball.py` + `tools/fx/render_flipbook.py` |
| `fireball_ground_a.webp`, `fireball_ground_b.webp`, `fireball_ground.json` | A ground burst: a hemisphere of fire off the ground that mushrooms up on a stem. 64 frames. | the same |
| `fireball_fuel_a.webp`, `fireball_fuel_b.webp`, `fireball_fuel.json` | A fuel fireball: slower, sootier, rolling up off the ground. 64 frames. | the same |

## Format

Each burst is an 8×8 flipbook of 256 px frames, stored as two grey images that are 2×2 mosaics of 2048 px tiles
(lossy WebP, one tile per channel so the codec's colour planes can't smear one channel into another). `src/flipbook.js`
packs each mosaic into an RGBA texture on the GPU at load:

| atlas | R (top left) | G (top right) | B (bottom left) | A (bottom right) |
|---|---|---|---|---|
| `_a` | light, left-right | light, up-down | heat | coverage |
| `_b` | motion x | motion y | light, mean | light, front-back |

The frames carry no lighting of their own: the four light channels are how bright the smoke is under light from every
side (`b0`) and how that changes with the light's direction (`b`), so the game lights it with its own sun, sky and
fires as `b0 + b·s`. Heat goes through the particle shader's black-body ramp. Motion vectors (to the next frame, ±
`mvScale` frame widths) let two neighbouring frames be blended without ghosting. The `.json` gives each frame's time
(the frames are packed into the first instants and spread out over the smoke) and its window in the cloud (every
frame is cropped to its content), the fireball's width and the moment the fire is out.

## Re-making them

    blender --background --factory-startup --python tools/fx/bake_fireball.py -- --event ground --res 128 --set noise=2 --cache /tmp/fx/ground
    python3 tools/fx/render_flipbook.py --cache /tmp/fx/ground --out models/fx --preview /tmp/fx/ground.png

(`--event air | ground | fuel`; the cache is ~0.4 GB of grids per event and can be deleted afterwards; `cwebp` must be
installed for the `.webp` files.) About 3.5 minutes to simulate and 3.5 to render per event on an Apple M5.

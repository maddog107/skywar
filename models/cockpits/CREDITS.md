# Cockpit model credits (`models/cockpits/`)

The cockpits flown in cockpit view by the types in `COCKPIT_MODELS` (`src/cockpit.js`); every other type keeps the
procedural cockpit. Each file is cut out of a licensed aircraft model with `tools/cockpits/import_cockpit.py`
(Blender 5.2, headless): only the cockpit kept, the pilot's design eye at the origin, metres, the nose toward three.js
-Z, the blank display faces split into `SCREEN_<n>` (the game draws its live displays on them), the HUD combiner and
the canopy named for the game's glass, the rest joined by material.

CC BY models require the attribution below to be shown to players (the in-game credits list them).

| File | Cockpit | Title / Author | Licence | Source |
|---|---|---|---|---|
| `f22.glb` | F-22 Raptor | "F22 Raptor" by weeadamp | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (live Sketchfab API "CC Attribution", checked 2026-10-20) | https://sketchfab.com/3d-models/f22-raptor-1a58a540041242218cb99b46fa8c39a7 (GLB from the Objaverse mirror: `glbs/000-106/1a58a540041242218cb99b46fa8c39a7.glb`) |

## Commands

    /opt/homebrew/bin/blender -b -P tools/cockpits/import_cockpit.py -- 1a58a540041242218cb99b46fa8c39a7.glb models/cockpits/f22.glb \
        --box -3.3,3.3,-9,9,-1.8,5.2 --eye 0,-1.5,4.25 --upm 5.04 --screens Material.003 --hud F2277Mtl --glass Material.001

(the source's units: 5.04 to the metre, the 18.9 m airframe; the view is then fitted in the game with `eye` in
`COCKPIT_MODELS`: 20 cm forward of the file's eye point, clear of the seat's headbox, 11 cm lower, the HUD on the eye
line.) The model's plain white console panel (`F2266Mtl`) is painted panel grey in the game (`paint`).

## Looked at and not used (2026-10-20)

Searched in the Objaverse mirror of Sketchfab for every flyable type, licences re-checked on the live API; none of
the others reached the bar: the MiG-21 "Fishbed F" by diablomj (real layout, flat colours, no gauge faces), the
"cockpit with buttons" front panel by cemayhan (good textures, no tub, seat or consoles), helijah's Mirage 2000 and
the simple cockpits inside the game's own Gripen and Mirage 5 sources, an F-16 by dest (toy-like), and an "F-5E
Cockpit from DCS" photogrammetry capture (not used: a capture of a commercial simulator's cockpit). Better F-16C, Gripen
and F-35C cockpits are CC BY on Sketchfab but only downloadable with a Sketchfab account.

# Cockpit model credits (`models/cockpits/`)

The cockpits flown in cockpit view by the types in `COCKPIT_MODELS` (`src/cockpit.js`); every other type keeps the
procedural cockpit. Each file is cut out of a licensed aircraft model with `tools/cockpits/import_cockpit.py`
(Blender 5.2, headless): only the cockpit kept, the pilot's design eye at the origin, metres, the nose toward three.js
-Z, the blank display faces split into `SCREEN_<n>` (the game draws its live displays on them), the HUD combiner and
the canopy named for the game's glass, the rest joined by material.

CC BY models require the attribution below to be shown to players (the in-game credits list them).

| File | Cockpit | Title / Author | Licence | Source |
|---|---|---|---|---|
| `kit_hornet.glb` | F/A-18 family (fa18, ea18g): centre stick, two DDIs over the AMPCD, the UFC, a windscreen bow with three mirrors, a Martin-Baker seat | SKYWAR, built in Blender by `tools/cockpits/cockpit_kit.py hornet` | CC0 | (built from the real cockpit's layout) |
| `kit_viper.glb` | F-16 family (f16, f2): side-stick and throttle on the consoles, two MFDs, the DED over the ICP, the RWR scope, a one-piece canopy, an ACES II seat | SKYWAR, built in Blender by `tools/cockpits/cockpit_kit.py viper` | CC0 | (built from the real cockpit's layout) |
| `kit_eagle.glb` | F-15 (f15): the VSD and TEWS scope, the big ADI and the standby air data round it, the MPCD and HSI on the pedestal, the engine instruments, ACES II | SKYWAR, built in Blender by `tools/cockpits/cockpit_kit.py eagle` | CC0 | (built from the real cockpit's layout) |
| `kit_tomcat.glb` | F-14 front cockpit (f14): the VDI over the HSD, analogue flight and engine instruments, the windscreen bow | SKYWAR, built in Blender by `tools/cockpits/cockpit_kit.py tomcat` | CC0 | (built from the real cockpit's layout) |
| `kit_analog.glb` | the second-generation layout (f4, f5, a10, mirage, jaguar): the basic T of round dials, the radar scope, engine gauges down the right | SKYWAR, built in Blender by `tools/cockpits/cockpit_kit.py analog` | CC0 | (built from the real cockpit's layout) |
| `kit_flanker.glb` | Su-35S (su35, mig29, j10, su47): two MFDs and a small one, standby and engine dials, on the Soviet blue-green panel, the K-36 seat | SKYWAR, built in Blender by `tools/cockpits/cockpit_kit.py flanker` | CC0 | (built from the real cockpit's layout) |
| `kit_fishbed.glb` | MiG-21 (mig21, mig25, mig31, j8): the radar scope under its hood, the round dials, blue-green, the K-36 seat | SKYWAR, built in Blender by `tools/cockpits/cockpit_kit.py fishbed` | CC0 | (built from the real cockpit's layout) |
| `kit_pcd.glb` | F-35 (f35, f35n): the 20 x 8 inch panoramic display as two portals, the standby display, side-stick, no HUD (the helmet display) | SKYWAR, built in Blender by `tools/cockpits/cockpit_kit.py pcd` | CC0 | (built from the real cockpit's layout) |
| `kit_glass3.glb` | three big displays across (typhoon, gripen, su57, j20, x100), centre stick | SKYWAR, built in Blender by `tools/cockpits/cockpit_kit.py glass3` | CC0 | (built from the real cockpit's layout) |
| `kit_glass3s.glb` | the same with a side-stick (rafale) | SKYWAR, built in Blender by `tools/cockpits/cockpit_kit.py glass3s` | CC0 | (built from the real cockpit's layout) |
| `f22.glb` | F-22 Raptor | "F22 Raptor" by weeadamp | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (live Sketchfab API "CC Attribution", checked 2026-10-20) | https://sketchfab.com/3d-models/f22-raptor-1a58a540041242218cb99b46fa8c39a7 (GLB from the Objaverse mirror: `glbs/000-106/1a58a540041242218cb99b46fa8c39a7.glb`) |

## Commands

    /opt/homebrew/bin/blender -b -P tools/cockpits/cockpit_kit.py -- hornet models/cockpits/kit_hornet.glb --ao 2048 --samples 32
    /opt/homebrew/bin/blender -b -P tools/cockpits/cockpit_kit.py -- viper models/cockpits/kit_viper.glb --ao 2048 --samples 32
    (and the same for eagle, tomcat, analog, flanker, fishbed, pcd, glass3, glass3s: models/cockpits/kit_<layout>.glb)

(the kit's cockpits: real proportions round the design eye, the tiled shared textures by material name, placards drawn
by the game, an ambient-occlusion bake on a second UV set as the glTF occlusion texture; `--preview DIR` renders five
views from the eye.) The F-22's:

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

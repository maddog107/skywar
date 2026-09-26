# How each imported aircraft in `models/aircraft/` was made

Source files: Sketchfab models via the Objaverse mirror
(`https://huggingface.co/datasets/allenai/objaverse/resolve/main/glbs/<shard>/<uid>.glb`, uid = the id at the end
of the Sketchfab URL in `models/aircraft/CREDITS.md`; the shard is listed in Objaverse's `object-paths.json.gz`),
and the NASA Airborne Science C-130 (`C130_WFF_AIR_0626.glb`, https://airbornescience.nasa.gov/3d-models).

Each was cleaned with

    /opt/homebrew/bin/blender -b -P tools/aircraft/import_model.py -- SRC.glb models/aircraft/<id>.glb <options>

| id | source file | options |
|---|---|---|
| f22 | `03a2651804344ebc930e01cc945bf07d.glb` | `--nose -Y --decimate 0.6 --weld 35 --tint '#a3a9b0' --img JPEG` |
| fa18 | `635e68b7a0d24ac29c10f5fb9110129f.glb` | `--nose -Y --below 0.42 --below-max 0.2` |
| f35 | `dc727cb5c1404f26b3a29a7e2d50bb2b.glb` | `--nose -Y --below 0.42 --below-max 0.2` |
| a10 | `9521ff6ba5d448958ea45a89e94ab23d.glb` | `--nose +Y --below 0.3 --below-max 0.12 --tex 1024 --img JPEG --weld 35 --one-uv` |
| su35 | `fbcbe88be95e4bada5064f3f8f3893de.glb` | `--nose -Y --level-pitch --mono '#8ea3b4' --mono-mat 'Material_(2\|3\|5\|6\|7\|8\|12)$' --tex 1024 --img JPEG --weld 35` |
| gripen | `a2b70c2f92af45d18d95f02b60621dbf.glb` | `--nose -X --below 0.4 --below-max 0.2 --tex 1024 --img JPEG` |
| cessna | `49ac79d106934cb299f3c5ab645f9bda.glb` | `--nose -Y --box-delete 0,0.965,0,1,1,1 --decimate 0.6 --weld 35` (drops the static propeller; the game spins its own) |
| b737 | `197ae72ceb5441efa91b8bdc2ee37050.glb` | `--nose +X --below 0.22 --below-max 0.07 --weld 35 --paint 'Tail1Mtl=~1d4aa8,Blades\|wipers=~2b2d30,Strobe\|Light=~c9ced2,.*=~f2f2ef' --length 39.5 --img JPEG` |
| b747 | `4eadf04e705b41a2b272ee5aed4d01d5.glb` | `--nose -Y --weld 35 --paint 'phong1=~f2f2ef' --length 70.6 --img JPEG` |
| racer | `36f0f3e71d2a4c18b479db1ae8f9e7a7.glb` | `--nose -Y --delete 'BLADES\|back_wheels\|CANNON' --tex 1024 --img JPEG` |
| pitts | `be48f3f906ed431b98b1bf03ab7aadd6.glb` | `--nose -Y --pitch -11 --img JPEG --tex 1024` |
| c130 | `C130_WFF_AIR_0626.glb` (NASA) | `--nose -Y --weld-first --box-delete 0,0.695,0,1,0.7101,1 --wires 0.1 --tex 1024 --strip-maps --mono '#737b6c' --img JPEG --decimate 0.66 --decimate-sym --fix-flipped 48 --weld 35` (the monochrome repaint removes the NASA worm/meatball; `--weld-first` before decimating keeps the skin closed and facing out, where decimating the seam-split import tore it open and flipped faces; the box drops the 16 static prop blades, spinners kept, and the game spins four six-bladed props of its own; `--wires` drops the HF antenna wires) |
| f14 | `9d2d0c87539046aa8c2198fcc47cdcf8.glb` | `--nose +X` |
| f15 | `f874bffa8e314743b4a7cb9ad4b9f3a8.glb` | `--nose +X --delete 'TomGroup_[2345]_'` |
| f4 | `666403b893024c8c88409f9feb2277eb.glb` | `--nose -Y --paint 'Fuselage=#6f7a62,Main_Wing=#6f7a62,Tail_FIn=#6f7a62,Cannon_Housing=#2a2d30,Cockpit_Frame=#5d6754,Cockpit_WIndow=~1c252d' --glass 'Cockpit_WIndow' --length 19.2 --uv0 --one-uv --weld 40 --img JPEG` |
| mig29 | `ec6c1fcfe35f4cc8a638bd85463a34f2.glb` | `--nose -X --delete 'suspantion\|Tire\|_rim\|Hrom'` |
| su47 | `4a2b1cecf13c4c9db7933ffd7fd67339.glb` | `--nose -Y` |
| b2 | `12244128967f4d93b9cac52b275c3d51.glb` | `--nose -Y --tex 1024 --img JPEG` |
| su57 | `245cebbc76e34a9d8b77e81a54d9cdf1.glb` | `--nose -Y --decimate 0.4 --paint 'Material_0=#7b8791,02_-_Default=#2b3238' --length 20.1 --uv0 --one-uv --img JPEG --weld 35` |
| typhoon | `01d9a26a89dc4a17a9fa4c4c1f7ac39f.glb` | `--nose -Y --tex 1024 --img JPEG` |
| rafale | `d8bbfb0970ca4128b73e7e5364828fd3.glb` | `--nose -Y --delete 'Cylindre00[3789]\|bombe' --level-roll --decimate 0.7 --glass 'Material__29' --strip-maps --paint 'Material__31=#8e969c,Material__32=#6d757b,Material__30=#6d757b' --length 15.27 --img JPEG --tex 512` |

Kit-built aircraft (`tools/aircraft/<id>.py`, run as `blender -b -P tools/aircraft/<id>.py -- models/aircraft/<id>.glb`)
are listed in `models/aircraft/CREDITS.md` with their reference drawings.

Previewing: `node server.mjs` (and `node tools/aircraft/upload.mjs` to save PNGs), then open `/tools/aircraft/preview.html` (see the comment at the top of
`tools/aircraft/preview.js`). It renders models through the game's own loader/normaliser, with the nozzle
(red), wingtip (blue) and cockpit (green) rig points as markers.

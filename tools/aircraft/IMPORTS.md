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
| b747 | `4eadf04e705b41a2b272ee5aed4d01d5.glb` | see "Western types rebuilt" below (livery) |
| racer | `36f0f3e71d2a4c18b479db1ae8f9e7a7.glb` | `--nose -Y --delete 'BLADES\|back_wheels\|CANNON' --tex 1024 --img JPEG` |
| pitts | `be48f3f906ed431b98b1bf03ab7aadd6.glb` | `--nose -Y --pitch -11 --img JPEG --tex 1024` |
| c130 | `C130_WFF_AIR_0626.glb` (NASA) | `--nose -Y --weld-first --box-delete 0,0.695,0,1,0.7101,1 --wires 0.1 --tex 1024 --strip-maps --mono '#737b6c' --img JPEG --decimate 0.66 --decimate-sym --fix-flipped 48 --weld 35` (the monochrome repaint removes the NASA worm/meatball; `--weld-first` before decimating keeps the skin closed and facing out, where decimating the seam-split import tore it open and flipped faces; the box drops the 16 static prop blades, spinners kept, and the game spins four six-bladed props of its own; `--wires` drops the HF antenna wires) |
| f14 | `9d2d0c87539046aa8c2198fcc47cdcf8.glb` | `--nose +X` |
| f15 | `f874bffa8e314743b4a7cb9ad4b9f3a8.glb` | `--nose +X --delete 'TomGroup_[2345]_'` |
| f4 | `f7d8189af9fb40db9b4968830aabe29e.glb` | see "Western types rebuilt" below |
| mig29 | `ec6c1fcfe35f4cc8a638bd85463a34f2.glb` | `--nose -X --delete 'suspantion\|Tire\|_rim\|Hrom'` |
| su47 | `4a2b1cecf13c4c9db7933ffd7fd67339.glb` | `--nose -Y` |
| b2 | `12244128967f4d93b9cac52b275c3d51.glb` | `--nose -Y --tex 1024 --img JPEG` |
| su57 | `245cebbc76e34a9d8b77e81a54d9cdf1.glb` | `--nose -Y --decimate 0.4 --paint 'Material_0=#7b8791,02_-_Default=#2b3238' --length 20.1 --uv0 --one-uv --img JPEG --weld 35` |
| typhoon | `01d9a26a89dc4a17a9fa4c4c1f7ac39f.glb` | `--nose -Y --tex 1024 --img JPEG` |
| rafale | `d8bbfb0970ca4128b73e7e5364828fd3.glb` | `--nose -Y --delete 'Cylindre00[3789]\|bombe' --level-roll --decimate 0.7 --glass 'Material__29' --strip-maps --paint 'Material__31=#8e969c,Material__32=#6d757b,Material__30=#6d757b' --length 15.27 --img JPEG --tex 512` |
| cl415 | `cl415_airframe.glb`, split from `bf3eaa6a1f4f4fc18df9b05cf40de927.glb` (shard `000-129`) by `tools/aircraft/cl415_gear.py` (below) | `--nose -X --tex 1024 --img JPEG` |

The CL-415 keeps its own landing gear, which folds away in the game (`models/aircraft/cl415_gear.glb`, models.js
MODEL_FILES `gear`). The model is split first, then the airframe goes through `import_model.py`, and a second run of
the split checks that the gear file's frame is the finished airframe's:

    /opt/homebrew/bin/blender -b -P tools/aircraft/cl415_gear.py -- bf3eaa6a1f4f4fc18df9b05cf40de927.glb cl415_airframe.glb models/aircraft/cl415_gear.glb
    /opt/homebrew/bin/blender -b -P tools/aircraft/import_model.py -- cl415_airframe.glb models/aircraft/cl415.glb --nose -X --tex 1024 --img JPEG
    /opt/homebrew/bin/blender -b -P tools/aircraft/cl415_gear.py -- bf3eaa6a1f4f4fc18df9b05cf40de927.glb cl415_airframe.glb models/aircraft/cl415_gear.glb --check models/aircraft/cl415.glb

`cl415_gear.py` takes the three gear legs (with the nose gear's doors), the static propeller blades (the game spins
two four-bladed props of its own) and the instrument gauges out of the model, names the materials, and writes the gear
in the frame `import_model.py --nose -X` gives the airframe; its header describes the gear file (pivots, axes, linked
parts, shared materials).

Kit-built aircraft (`tools/aircraft/<id>.py`, run as `blender -b -P tools/aircraft/<id>.py -- models/aircraft/<id>.glb`)
are listed in `models/aircraft/CREDITS.md` with their reference drawings.

Previewing: `node server.mjs` (and `node tools/aircraft/upload.mjs` to save PNGs), then open `/tools/aircraft/preview.html` (see the comment at the top of
`tools/aircraft/preview.js`). It renders models through the game's own loader/normaliser, with the nozzle
(red), wingtip (blue) and cockpit (green) rig points as markers.

## Support aircraft, drones and bombers

Derived and built with `tools/aircraft/support_kit.py` (import, clean, stretch, add parts with `aircraft_kit.py`,
export the moving parts as separate named nodes for `src/rigparts.js`):

    /opt/homebrew/bin/blender -b -P tools/aircraft/<id>.py -- SRC.glb models/aircraft/<id>.glb

| id | script | source file |
|---|---|---|
| kc135 | `kc135.py` | Objaverse `glbs/000-081/95fedbaed45b492e8dfa9d1a8f76b25f.glb` ("KC135R" by Adastra) |
| e3 | `e3.py` | the same KC-135R file |
| a50 | `a50.py` | Objaverse `glbs/000-050/ab71a5f790f940798cc755246a7a8a7f.glb` ("Ilyushin Il-76" by helijah) |
| il78 | `il78.py` | Objaverse `glbs/000-025/0c0da2cc1b4c441dadc2510212c25fb7.glb` ("Il78" by manilov.ap) |
| mq9 | `mq9.py` | Objaverse `glbs/000-020/eff549610fee4f20904f7b388a3a0830.glb` ("MQ-9 Reaper" by TVHowell) |
| rq4 | `rq4.py` | NASA 3D Resources `3D Models/Global Hawk/Global Hawk.glb` |
| b52 | `b52.py` | Objaverse `glbs/000-078/3ca2f507a0a749799e16a4eee12e456c.glb` ("B52" by manilov.ap) |
| tu95 | `tu95.py` | Objaverse `glbs/000-114/1eac97ec49ed4f1da8b7deb1e1b2cc7a.glb` ("Tu95" by manilov.ap) |
| ea18g | `ea18g.py` | `models/aircraft/fa18.glb` (the game's F/A-18F) |
| u2 | `u2.py` | NASA `ER2_AFRC_AIR_0626.glb` (https://airbornescience.nasa.gov/3d-models/models/ER2_AFRC_AIR_0626.glb) |
| rc135 | `rc135.py` | the same KC-135R file |

Each script's header lists what it changes; sources and licences are in the last section of
`models/aircraft/CREDITS.md`.

## Western types rebuilt (F-4E, F-5E, Mirage 5F, Jaguar, F-35C, 747 livery)

Sources (Objaverse `glbs/<shard>/<uid>.glb`; licences in `models/aircraft/CREDITS.md`, re-checked on the live Sketchfab
API on 2026-10-15). Several were exported yawed off their axes (`--nose DEG`), so they go through a staging import
first; the box coordinates below are in the frame of the file each command reads.

| id | source (shard/uid) | what was done |
|---|---|---|
| f4 | `000-005/f7d8189af9fb40db9b4968830aabe29e` "F4" (manilov.ap) | oriented; gear legs, wheels and doors off; nose-wheel well closed; its crew, tanks, AIM-7s and AIM-9s kept |
| f5 | `000-141/8089d66a8a8748b2a4b049b3c06f6a02` "F5" (manilov.ap) | oriented; gear and doors off (named parts); bays repainted as closed doors (`paint_f5.py`); wingtip AIM-9s (`f5_stores.py`) |
| mirage | `000-136/f0773e28da464309957c942543564305` "Dassault Mirage 5" (helijah) | repainted (`paint_mirage.py`); gauges, gear off; wells closed; canopy closed |
| jaguar | `000-046/b09a0ee965bb424aaf14ebd06b698f96` "Jaguar" (manilov.ap) | oriented; the seated figure, gear off; wells closed; overwing AIM-9 launchers (`jaguar_stores.py`); light grey → dark sea grey |
| f35n | `000-082/dc727cb5c1404f26b3a29a7e2d50bb2b` "Low poly 1:1 USAF F35A" (WTigerTw) | the F-35C: bays and gear doors off, wing and tails re-proportioned (`f35c.py`), bays closed, Navy markings (`paint_f35c.py`) |
| b747 | `000-044/4eadf04e705b41a2b272ee5aed4d01d5` "Boeing747" (kaymanv) | split into materials and unwrapped (`b747_prep.py`), painted (`paint_b747.py`): the fictional Aurelia Pacific |

New `import_model.py` options used here: `--delete-box` / `--rotate-box` (loose parts by a box in the file's frame:
gear, canopies), `--fill-cavity` (close a gear well: delete its interior faces, fill or cap the opening),
`--image` (a painted texture onto matching materials), `--regrey` (recolour a texture's light grey), `--add` (merge
stores built in the file's frame), `--nose DEG`, `--no-centre` (a staged intermediate keeps its frame).

Liveries are painted on each model's own UV layout: `bakemaps.py` (Blender) bakes where every texel lies on the
airframe (position, normal); `livery.py` (Python 3, numpy + Pillow) paints from those (3-D noise camouflage that runs
across UV seams, an underside split by the skin's direction, decals and lettering projected on the skin, the original
texture's panel lines multiplied back in); `paint_<id>.py` is each scheme. Stores are built with `stores_kit.py`.

```
B=/opt/homebrew/bin/blender; I=tools/aircraft/import_model.py

# Mirage 5F
$B -b -P tools/aircraft/bakemaps.py -- MIRAGE5.glb M --mat texture
python3 tools/aircraft/paint_mirage.py M M/mirage_paint.png
$B -b -P $I -- MIRAGE5.glb models/aircraft/mirage.glb --nose -X \
  --delete 'ka51b|uhf-box|pression|accel|adi\.png|_ai\.png|alt\.png|asi\.png|fuel\.png|vsi\.png|^transparent$' \
  --delete-box -2.7,-0.2,-2.3,-2.0,0.2,-0.79 --delete-box 1.85,1.4,-2.3,2.85,2.15,-0.69 --delete-box 1.85,-2.15,-2.3,2.85,-1.4,-0.69 \
  --rotate-box -3.05,-0.45,0.28,-1.75,0.45,1.5:Y:-1.92,0,0.36:-46 \
  --fill-cavity 0.75,0.45,-0.98,2.85,2.3,-0.36:0.74,0,1,0.13:0.7637,0.4512 --fill-cavity 0.75,-2.3,-0.98,2.85,-0.45,-0.36:0.74,0,1,0.13:0.7637,0.4512 \
  --fill-cavity -2.85,-0.35,-1.05,-1.8,0.35,-0.6:0.74,0,1,0.13:0.7637,0.4512:-0.85 \
  --image "texture=M/mirage_paint.png" --tex 1024 --img JPEG

# Jaguar
$B -b -P $I -- JAGUAR.glb jaguar_raw.glb --nose -143.94 --delete '^cmj' --tex 2048
$B -b -P tools/aircraft/jaguar_stores.py -- jaguar_stores.glb
$B -b -P $I -- jaguar_raw.glb models/aircraft/jaguar.glb --nose +Y --add jaguar_stores.glb \
  --delete-box -0.35,3.2,-2.35,0.35,4.25,-0.6 --delete-box -1.55,-2.75,-2.35,1.55,-0.8,-0.38 \
  --fill-cavity -0.4,3.0,-1.2,0.4,4.4,-0.6:9,9,9,9:0.5080,0.3341:-0.9 --fill-cavity 0.1,-3.0,-1.25,1.2,-0.6,-0.6:9,9,9,9:0.5080,0.3341:-0.78 \
  --fill-cavity -1.2,-3.0,-1.25,-0.1,-0.6,-0.6:9,9,9,9:0.5080,0.3341:-0.78 \
  --regrey 'fuzel-FACES$|Line09|Line16|Line11|Line15|Ellipse05|kabin20-FACES$|Line03|vozdz|Box0[12]=#4b555c' --tex 1024 --img JPEG

# F-4E
$B -b -P $I -- F4.glb f4_raw.glb --nose -146.67 --tex 2048
$B -b -P $I -- f4_raw.glb models/aircraft/f4.glb --nose +Y \
  --delete-box -0.5,3.1,-2.7,0.5,5.65,-0.8 --delete-box 2.05,-2.6,-2.7,3.2,-1.6,-0.88 --delete-box -3.2,-2.6,-2.7,-2.05,-1.6,-0.88 \
  --delete-box 1.15,-2.05,-1.65,1.45,-1.1,-0.95 --delete-box -1.45,-2.05,-1.65,-1.15,-1.1,-0.95 \
  --fill-cavity -0.4,3.0,-1.6,0.4,5.5,-1.1:9,9,9,9:0.5835,0.6378 --tex 1024 --img JPEG

# F-5E
$B -b -P $I -- F5.glb f5_stage.glb --nose -148.5 --delete '^(shassy|stvorka|stvoka)' --no-centre --tex 2048
$B -b -P tools/aircraft/f5_stores.py -- f5_stores.glb
$B -b -P tools/aircraft/bakemaps.py -- f5_stage.glb F --mat '^fuzel-FACES$'
python3 tools/aircraft/paint_f5.py F F/f5_paint.png
$B -b -P $I -- f5_stage.glb models/aircraft/f5.glb --nose +Y --add f5_stores.glb --image '^fuzel-FACES$=F/f5_paint.png' --tex 1024 --img JPEG

# F-35C (f35n)
$B -b -P $I -- F35A.glb f35_stage.glb --nose -Y --below 0.42 --below-max 0.2 --tex 2048
$B -b -P $I -- f35_stage.glb f35_clean.glb --nose +Y --no-centre --delete-mat 'Material\.002' \
  --delete-box 2.0,-2.35,-0.66,2.36,-1.5,-0.44 --delete-box -2.36,-2.35,-0.66,-2.0,-1.5,-0.44 \
  --delete-box 2.05,-3.2,-1.4,2.38,-1.6,-0.5 --delete-box -2.38,-3.2,-1.4,-2.05,-1.6,-0.5 \
  --delete-box 1.6,-2.55,-1.4,1.83,-2.25,-0.55 --delete-box -1.83,-2.55,-1.4,-1.6,-2.25,-0.55 \
  --delete-box 1.45,-2.35,-1.8,1.8,-2.15,-0.5 --delete-box -1.8,-2.35,-1.8,-1.45,-2.15,-0.5 --tex 2048
$B -b -P tools/aircraft/f35c.py -- f35_clean.glb f35c_morph.glb
$B -b -P tools/aircraft/bakemaps.py -- f35c_morph.glb C --mat '^Material$'
python3 tools/aircraft/paint_f35c.py C C/f35c_paint.png
$B -b -P $I -- f35c_morph.glb models/aircraft/f35c.glb --nose +Y \
  --fill-cavity 0.05,-2.7,-1.35,1.45,1.8,-0.8:9,9,9,9:0.1602,0.0195:-1.1 --fill-cavity -1.45,-2.7,-1.35,-0.05,1.8,-0.8:9,9,9,9:0.1602,0.0195:-1.1 \
  --image '^Material$=C/f35c_paint.png' --tex 1024 --img JPEG

# 747-400
$B -b -P tools/aircraft/b747_prep.py -- B747.glb b747_prep.glb
$B -b -P tools/aircraft/bakemaps.py -- b747_prep.glb FUS --mat '^Fuselage$'
$B -b -P tools/aircraft/bakemaps.py -- b747_prep.glb FIN --mat '^Fin$'
python3 tools/aircraft/paint_b747.py FUS FIN OUT
$B -b -P $I -- b747_prep.glb models/aircraft/b747.glb --nose -Y --weld 35 --paint 'Wing=#c7cbce,Pylon=#d7dadd' --length 70.6 \
  --image '^Fuselage$=OUT/b747_fuselage.png' --image '^Fin$=OUT/b747_fin.png' --tex 4096 --img JPEG
```

The 747 keeps its frame (the flaps and spoilers in `src/surfacedefs.js` still fit); the fuselage texture is 4096×1024
(windows and doors are the model's own geometry). `tests/westernac.test.mjs` checks each model's shape against the real
aircraft, its paint, rig points, surfaces, stores and credits.

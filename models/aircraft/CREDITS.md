# Aircraft model credits (`models/aircraft/`)

All files are binary glTF 2.0. Every model here was cleaned for SKYWAR with
`tools/aircraft/import_model.py` (Blender 5.2, headless) or built with `tools/aircraft_kit.py`; the exact
command for each imported model is in `tools/aircraft/IMPORTS.md`. Common changes to imported models:
landing gear / ground props removed, re-oriented (nose toward three.js -Z), centred, textures downscaled
to ≤1024 px JPEG, and in some cases decimated, re-painted or re-levelled. The game rescales every model
to its real length (`spec.length`), so the files' own units do not matter.

CC BY models require the attribution below to be shown to players (e.g. on the credits screen).

The Sketchfab models were obtained without a login from the Objaverse mirror of Sketchfab
(https://huggingface.co/datasets/allenai/objaverse, whose metadata lists each object's licence); every
licence was re-checked against the live Sketchfab API (`api.sketchfab.com/v3/models/<uid>` →
"CC Attribution") on 2026-09-25.

| File | Aircraft | Title / Author | Licence | Source |
|---|---|---|---|---|
| `f22.glb` | F-22 Raptor | "F22 Raptor" by Njan (Jan Esch) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/f22-raptor-03a2651804344ebc930e01cc945bf07d |
| `fa18.glb` | F/A-18F Super Hornet | "Low poly 1:1 F/A-18F SuperHornet" by WTigerTw (Yi Tsung Lee) | CC BY 4.0 | https://sketchfab.com/3d-models/low-poly-11-fa-18f-superhornet-635e68b7a0d24ac29c10f5fb9110129f |
| `a10.glb` | A-10 Thunderbolt II | "A-10 Thunderbolt II" by AIRMAN Magazine | CC BY 4.0 | https://sketchfab.com/3d-models/a-10-thunderbolt-ii-9521ff6ba5d448958ea45a89e94ab23d |
| `su35.glb` | Su-35 (Su-30 airframe stands in) | "Su 30" by akashritharan | CC BY 4.0 | https://sketchfab.com/3d-models/su-30-fbcbe88be95e4bada5064f3f8f3893de |
| `gripen.glb` | JAS 39 Gripen | "JAS39 Gripen" by helijah | CC BY 4.0 | https://sketchfab.com/3d-models/jas39-gripen-a2b70c2f92af45d18d95f02b60621dbf |
| `cessna.glb` | Cessna 172 Skyhawk | "Cessna 172 Skyhawk - Stormworks" by ThalesMML (Thales) | CC BY 4.0 | https://sketchfab.com/3d-models/cessna-172-skyhawk-stormworks-49ac79d106934cb299f3c5ab645f9bda |
| `b737.glb` | Boeing 737 (MAX 8 airframe stands in for the -800) | "737 Max-8 (Free)" by AMGP3D (AMPG) | CC BY 4.0 | https://sketchfab.com/3d-models/737-max-8-free-197ae72ceb5441efa91b8bdc2ee37050 |
| `b747.glb` | Boeing 747 | "Boeing747" by kaymanv | CC BY 4.0 | https://sketchfab.com/3d-models/boeing747-4eadf04e705b41a2b272ee5aed4d01d5 |
| `c130.glb` | C-130 Hercules | NASA Airborne Science Program 3D model "C130_WFF_AIR_0626" (NASA Wallops C-130H) | Public domain (US Government work: "NASA content … texture maps and polygon data in any format – generally are not subject to copyright in the United States", https://www.nasa.gov/nasa-brand-center/images-and-media/). NASA insignia/logotype removed (repainted); credit NASA. | https://airbornescience.nasa.gov/3d-models |
| `f35.glb` | F-35A Lightning II | "Low poly 1:1 USAF F35A" by WTigerTw (Yi Tsung Lee) | CC BY 4.0 | https://sketchfab.com/3d-models/low-poly-11-usaf-f35a-dc727cb5c1404f26b3a29a7e2d50bb2b |
| `f14.glb` | F-14 Tomcat | "F-14 Tomcat Top Gun (Gear UP) Downloadable" by dwsd | CC BY 4.0 | https://sketchfab.com/3d-models/f-14-tomcat-top-gun-gear-up-downloadable-9d2d0c87539046aa8c2198fcc47cdcf8 |
| `f15.glb` | F-15 Eagle | "F-15 Eagle" by dashdu (Trouvaille) | CC BY 4.0 | https://sketchfab.com/3d-models/f-15-eagle-f874bffa8e314743b4a7cb9ad4b9f3a8 |
| `f4.glb` | F-4 Phantom II | "F-4 Phantom II Recreation" by jpford63 | CC BY 4.0 | https://sketchfab.com/3d-models/f-4-phantom-ii-recreation-666403b893024c8c88409f9feb2277eb |
| `mig29.glb` | MiG-29 Fulcrum | "MiG-29 Fulcrum Fighter Jet" by Carlos.Maciel | CC BY 4.0 | https://sketchfab.com/3d-models/mig-29-fulcrum-fighter-jet-ec6c1fcfe35f4cc8a638bd85463a34f2 |
| `su47.glb` | Su-47 Berkut | "Su-47 Berkut" by Carlos.Maciel | CC BY 4.0 | https://sketchfab.com/3d-models/su-47-berkut-4a2b1cecf13c4c9db7933ffd7fd67339 |
| `b2.glb` | B-2 Spirit | "B-2 Spirit Bomber" by Carlos.Maciel | CC BY 4.0 | https://sketchfab.com/3d-models/b-2-spirit-bomber-12244128967f4d93b9cac52b275c3d51 |
| `su57.glb` | Su-57 Felon | "PAK FA" by jratanatharathorn (Yo Boy) | CC BY 4.0 | https://sketchfab.com/3d-models/pak-fa-245cebbc76e34a9d8b77e81a54d9cdf1 |
| `typhoon.glb` | Eurofighter Typhoon | "Eurofighter Typhoon Game Prop" by robnewman76 | CC BY 4.0 | https://sketchfab.com/3d-models/eurofighter-typhoon-game-prop-01d9a26a89dc4a17a9fa4c4c1f7ac39f |
| `rafale.glb` | Dassault Rafale | "Dassault Rafale" by so_O (quick_loop) | CC BY 4.0 | https://sketchfab.com/3d-models/dassault-rafale-d8bbfb0970ca4128b73e7e5364828fd3 |

## Attribution lines (for the in-game credits)

- "F22 Raptor" (https://sketchfab.com/3d-models/f22-raptor-03a2651804344ebc930e01cc945bf07d) by Njan (Jan Esch), CC BY 4.0. Changes: decimated, re-coloured, re-oriented.
- "Low poly 1:1 F/A-18F SuperHornet" (https://sketchfab.com/3d-models/low-poly-11-fa-18f-superhornet-635e68b7a0d24ac29c10f5fb9110129f) by WTigerTw (Yi Tsung Lee), CC BY 4.0. Changes: landing gear removed, re-oriented.
- "Low poly 1:1 USAF F35A" (https://sketchfab.com/3d-models/low-poly-11-usaf-f35a-dc727cb5c1404f26b3a29a7e2d50bb2b) by WTigerTw (Yi Tsung Lee), CC BY 4.0. Changes: landing gear removed, re-oriented.
- "A-10 Thunderbolt II" (https://sketchfab.com/3d-models/a-10-thunderbolt-ii-9521ff6ba5d448958ea45a89e94ab23d) by AIRMAN Magazine, CC BY 4.0. Changes: landing gear removed, textures downscaled, re-oriented.
- "Su 30" (https://sketchfab.com/3d-models/su-30-fbcbe88be95e4bada5064f3f8f3893de) by akashritharan, CC BY 4.0. Changes: re-coloured, re-levelled, textures downscaled.
- "JAS39 Gripen" (https://sketchfab.com/3d-models/jas39-gripen-a2b70c2f92af45d18d95f02b60621dbf) by helijah, CC BY 4.0. Changes: landing gear removed, textures downscaled.
- "Cessna 172 Skyhawk - Stormworks" (https://sketchfab.com/3d-models/cessna-172-skyhawk-stormworks-49ac79d106934cb299f3c5ab645f9bda) by ThalesMML, CC BY 4.0. Changes: propeller removed, decimated.
- "737 Max-8 (Free)" (https://sketchfab.com/3d-models/737-max-8-free-197ae72ceb5441efa91b8bdc2ee37050) by AMGP3D, CC BY 4.0. Changes: landing gear removed, re-oriented.
- "Boeing747" (https://sketchfab.com/3d-models/boeing747-4eadf04e705b41a2b272ee5aed4d01d5) by kaymanv, CC BY 4.0. Changes: re-oriented.
- "F-14 Tomcat Top Gun (Gear UP) Downloadable" (https://sketchfab.com/3d-models/f-14-tomcat-top-gun-gear-up-downloadable-9d2d0c87539046aa8c2198fcc47cdcf8) by dwsd, CC BY 4.0. Changes: re-oriented.
- "F-15 Eagle" (https://sketchfab.com/3d-models/f-15-eagle-f874bffa8e314743b4a7cb9ad4b9f3a8) by dashdu (Trouvaille), CC BY 4.0. Changes: landing gear removed, re-oriented.
- "F-4 Phantom II Recreation" (https://sketchfab.com/3d-models/f-4-phantom-ii-recreation-666403b893024c8c88409f9feb2277eb) by jpford63, CC BY 4.0. Changes: painted.
- "MiG-29 Fulcrum Fighter Jet" (https://sketchfab.com/3d-models/mig-29-fulcrum-fighter-jet-ec6c1fcfe35f4cc8a638bd85463a34f2), "Su-47 Berkut" (https://sketchfab.com/3d-models/su-47-berkut-4a2b1cecf13c4c9db7933ffd7fd67339) and "B-2 Spirit Bomber" (https://sketchfab.com/3d-models/b-2-spirit-bomber-12244128967f4d93b9cac52b275c3d51) by Carlos.Maciel, CC BY 4.0. Changes: landing gear removed (MiG-29), textures downscaled, re-oriented.
- "PAK FA" (https://sketchfab.com/3d-models/pak-fa-245cebbc76e34a9d8b77e81a54d9cdf1) by jratanatharathorn, CC BY 4.0. Changes: decimated, painted.
- "Eurofighter Typhoon Game Prop" (https://sketchfab.com/3d-models/eurofighter-typhoon-game-prop-01d9a26a89dc4a17a9fa4c4c1f7ac39f) by robnewman76, CC BY 4.0. Changes: textures downscaled.
- "Dassault Rafale" (https://sketchfab.com/3d-models/dassault-rafale-d8bbfb0970ca4128b73e7e5364828fd3) by so_O, CC BY 4.0. Changes: stores removed, levelled, decimated, painted.
- C-130 model courtesy of NASA (Airborne Science Program). Changes: NASA markings removed, repainted, decimated.

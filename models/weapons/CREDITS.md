# On-foot weapon and first-person arm credits (`models/weapons/`)

All files are binary glTF 2.0. Every weapon was cleaned for SKYWAR with `tools/weapons/import_weapon.py`
(Blender 5.2, headless) from the spec in `tools/weapons/specs/<id>.json` (`tools/weapons/build.sh export <id>`);
the arms with `tools/weapons/import_arms.py`. Common changes: re-oriented (muzzle toward three.js -Z), scaled to
the real length, origin at the grip, moving parts split out and pivoted (magazine, bolt / slide, hammer, pump,
rocket), empties added for the grip / support hand / muzzle / ejection port / sights, a decimated LOD1 mesh
added, stray parts removed (a loose knife, loose cartridges, a second heat shield), duplicate materials merged,
textures downscaled to ≤512 px JPEG. The arms: specular/glossiness converted to metal/roughness, extra UV sets
and a stray sphere removed, the skin kept.

CC BY models require the attribution below to be shown to players (the in-game credits screen does).

The models were obtained without a login from the Objaverse mirror of Sketchfab
(https://huggingface.co/datasets/allenai/objaverse); every licence was re-checked against the live Sketchfab
API (`api.sketchfab.com/v3/models/<uid>` → "CC Attribution") on 2026-09-26.

| File | Weapon | Title / Author | Licence | Source |
|---|---|---|---|---|
| `ak47.glb` | AK-47 | "AK-47(Disassembly of weapons)" by skartemka | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | https://sketchfab.com/3d-models/ak-47disassembly-of-weapons-a1a1750320864923884608db5dc0ea33 |
| `m4a1.glb` | M4A1 carbine | "M4A1 Carbine" by MrM0lten | CC BY 4.0 | https://sketchfab.com/3d-models/m4a1-carbine-9bb8f18ad94d4b468e447a2d43bd08b9 |
| `m870.glb` | Remington 870 pump shotgun | "Remington 870 Classic" by space_potato | CC BY 4.0 | https://sketchfab.com/3d-models/remington-870-classic-cf28a90d832e416e905f946bb42915d4 |
| `m9.glb` | Beretta M9 pistol | "3D Beretta M9" by damkung13 (Vesper 3D) | CC BY 4.0 | https://sketchfab.com/3d-models/3d-beretta-m9-67a0596c99364e97ae15554cd30553e3 |
| `deagle.glb` | Desert Eagle | "Desert Eagle" by ELIZION | CC BY 4.0 | https://sketchfab.com/3d-models/desert-eagle-cabde59f5cf24effaf80536e35d04e95 |
| `rpg7.glb` | RPG-7 and its PG-7V rocket | "RPG_7" by AnilkumarG (AnilG) | CC BY 4.0 | https://sketchfab.com/3d-models/rpg-7-625b550f52a04068b943837558b5a582 |
| `m67.glb` | M67 fragmentation grenade | "m67 frag grenade/m67 осколочная граната" by mypPi | CC BY 4.0 | https://sketchfab.com/3d-models/m67-frag-grenadem67-256b80fab7204f35a9284c5f5ee93dad |
| `arms.glb` | First-person arms (gloved, rigged) | "fps arms" by bumstrum (DJMaesen) | CC BY 4.0 | https://sketchfab.com/3d-models/fps-arms-08ec4403a47645d8ad80633abf13d39d |

## Attribution lines

- "AK-47(Disassembly of weapons)" (https://sketchfab.com/3d-models/ak-47disassembly-of-weapons-a1a1750320864923884608db5dc0ea33) by skartemka (https://sketchfab.com/skartemka), licensed under CC BY 4.0. Changed as described above (knife and loose parts removed).
- "M4A1 Carbine" (https://sketchfab.com/3d-models/m4a1-carbine-9bb8f18ad94d4b468e447a2d43bd08b9) by MrM0lten (https://sketchfab.com/MrM0lten), licensed under CC BY 4.0. Changed as described above (loose cartridge removed).
- "Remington 870 Classic" (https://sketchfab.com/3d-models/remington-870-classic-cf28a90d832e416e905f946bb42915d4) by space_potato (https://sketchfab.com/space_potato), licensed under CC BY 4.0. Changed as described above.
- "3D Beretta M9" (https://sketchfab.com/3d-models/3d-beretta-m9-67a0596c99364e97ae15554cd30553e3) by damkung13 (https://sketchfab.com/damkung13), licensed under CC BY 4.0. Changed as described above (loose cartridge removed).
- "Desert Eagle" (https://sketchfab.com/3d-models/desert-eagle-cabde59f5cf24effaf80536e35d04e95) by ELIZION (https://sketchfab.com/ELIZION), licensed under CC BY 4.0. Changed as described above (loose cartridges removed).
- "RPG_7" (https://sketchfab.com/3d-models/rpg-7-625b550f52a04068b943837558b5a582) by AnilkumarG (https://sketchfab.com/AnilkumarG), licensed under CC BY 4.0. Changed as described above (second heat shield removed; the rocket split into the loaded round and a flying rocket).
- "m67 frag grenade/m67 осколочная граната" (https://sketchfab.com/3d-models/m67-frag-grenadem67-256b80fab7204f35a9284c5f5ee93dad) by mypPi (https://sketchfab.com/mypPi), licensed under CC BY 4.0. Changed as described above (spoon and pin split out).
- "fps arms" (https://sketchfab.com/3d-models/fps-arms-08ec4403a47645d8ad80633abf13d39d) by bumstrum (https://sketchfab.com/bumstrum), licensed under CC BY 4.0. Changed as described above.

"""Regenerate tools/aircraft/MODEL_FILES.patch.md from tools/aircraft/entries.json + the GLBs.
   python3 tools/aircraft/make_patch.py
"""
import json, os, struct

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
E = json.load(open(os.path.join(HERE, 'entries.json')))

# where each model came from (short form; full details in models/aircraft/CREDITS.md)
SOURCE = {
    'f22': ('"F22 Raptor" by Njan (Jan Esch)', 'CC BY 4.0', 'https://sketchfab.com/3d-models/f22-raptor-03a2651804344ebc930e01cc945bf07d'),
    'fa18': ('"Low poly 1:1 F/A-18F SuperHornet" by WTigerTw', 'CC BY 4.0', 'https://sketchfab.com/3d-models/low-poly-11-fa-18f-superhornet-635e68b7a0d24ac29c10f5fb9110129f'),
    'f35': ('"Low poly 1:1 USAF F35A" by WTigerTw', 'CC BY 4.0', 'https://sketchfab.com/3d-models/low-poly-11-usaf-f35a-dc727cb5c1404f26b3a29a7e2d50bb2b'),
    'a10': ('"A-10 Thunderbolt II" by AIRMAN Magazine', 'CC BY 4.0', 'https://sketchfab.com/3d-models/a-10-thunderbolt-ii-9521ff6ba5d448958ea45a89e94ab23d'),
    'su35': ('"Su 30" by akashritharan', 'CC BY 4.0', 'https://sketchfab.com/3d-models/su-30-fbcbe88be95e4bada5064f3f8f3893de'),
    'gripen': ('"JAS39 Gripen" by helijah', 'CC BY 4.0', 'https://sketchfab.com/3d-models/jas39-gripen-a2b70c2f92af45d18d95f02b60621dbf'),
    'cessna': ('"Cessna 172 Skyhawk - Stormworks" by ThalesMML', 'CC BY 4.0', 'https://sketchfab.com/3d-models/cessna-172-skyhawk-stormworks-49ac79d106934cb299f3c5ab645f9bda'),
    'b737': ('"737 Max-8 (Free)" by AMGP3D', 'CC BY 4.0', 'https://sketchfab.com/3d-models/737-max-8-free-197ae72ceb5441efa91b8bdc2ee37050'),
    'b747': ('"Boeing747" by kaymanv', 'CC BY 4.0', 'https://sketchfab.com/3d-models/boeing747-4eadf04e705b41a2b272ee5aed4d01d5'),
    'c130': ('NASA Airborne Science C-130 model', 'Public domain (NASA)', 'https://airbornescience.nasa.gov/3d-models'),
    'f14': ('"F-14 Tomcat Top Gun (Gear UP)" by dwsd', 'CC BY 4.0', 'https://sketchfab.com/3d-models/f-14-tomcat-top-gun-gear-up-downloadable-9d2d0c87539046aa8c2198fcc47cdcf8'),
    'f15': ('"F-15 Eagle" by dashdu', 'CC BY 4.0', 'https://sketchfab.com/3d-models/f-15-eagle-f874bffa8e314743b4a7cb9ad4b9f3a8'),
    'f4': ('"F-4 Phantom II Recreation" by jpford63', 'CC BY 4.0', 'https://sketchfab.com/3d-models/f-4-phantom-ii-recreation-666403b893024c8c88409f9feb2277eb'),
    'mig29': ('"MiG-29 Fulcrum Fighter Jet" by Carlos.Maciel', 'CC BY 4.0', 'https://sketchfab.com/3d-models/mig-29-fulcrum-fighter-jet-ec6c1fcfe35f4cc8a638bd85463a34f2'),
    'su47': ('"Su-47 Berkut" by Carlos.Maciel', 'CC BY 4.0', 'https://sketchfab.com/3d-models/su-47-berkut-4a2b1cecf13c4c9db7933ffd7fd67339'),
    'b2': ('"B-2 Spirit Bomber" by Carlos.Maciel', 'CC BY 4.0', 'https://sketchfab.com/3d-models/b-2-spirit-bomber-12244128967f4d93b9cac52b275c3d51'),
    'su57': ('"PAK FA" by jratanatharathorn', 'CC BY 4.0', 'https://sketchfab.com/3d-models/pak-fa-245cebbc76e34a9d8b77e81a54d9cdf1'),
    'typhoon': ('"Eurofighter Typhoon Game Prop" by robnewman76', 'CC BY 4.0', 'https://sketchfab.com/3d-models/eurofighter-typhoon-game-prop-01d9a26a89dc4a17a9fa4c4c1f7ac39f'),
    'rafale': ('"Dassault Rafale" by so_O', 'CC BY 4.0', 'https://sketchfab.com/3d-models/dassault-rafale-d8bbfb0970ca4128b73e7e5364828fd3'),
    'pitts': ('"Airplane biplane" by BlueHour', 'CC BY 4.0', 'https://sketchfab.com/3d-models/airplane-biplane-be48f3f906ed431b98b1bf03ab7aadd6'),
    'racer': ('"P-51 Mustang" by UlissesVinicios', 'CC BY 4.0', 'https://sketchfab.com/3d-models/p-51-mustang-36f0f3e71d2a4c18b479db1ae8f9e7a7'),
}
KIT = ['mig31', 'mig25', 'j20', 'j10', 'j8', 'f5', 'mig21', 'mirage', 'jaguar']
OLD = {
    'f22': 'procedural', 'fa18': 'procedural', 'a10': 'procedural', 'su35': 'procedural', 'mig31': 'procedural',
    'gripen': 'procedural', 'cessna': 'procedural', 'b737': 'procedural', 'f35': 'generic_fighter.glb (Poly Pizza stand-in)',
    'b747': 'airliner.glb (generic, OpenGameArt)', 'c130': 'cargo.glb (generic, Poly Pizza)', 'pitts': 'stunt_biplane.glb (Poly Pizza, toy-like)',
    'racer': 'air_racer.glb (Poly Pizza, 666 tris)', 'typhoon': 'eurofighter.glb (Captain_Ahab_62 low-poly, CC0)', 'su57': 'su57.glb (Addmix)', 'su47': 'su47.glb (Addmix)', 'b2': 'b2.glb (Addmix)',
}


def glb_stats(path):
    d = open(path, 'rb').read()
    n = struct.unpack_from('<I', d, 12)[0]
    j = json.loads(d[20:20 + n])
    tris = 0
    for me in j['meshes']:
        for pr in me['primitives']:
            acc = j['accessors'][pr['indices']] if 'indices' in pr else j['accessors'][pr['attributes']['POSITION']]
            tris += acc['count'] // 3
    return tris, len(d)


def js(v):
    """Python value → compact JS literal in the style of src/models.js."""
    if isinstance(v, dict):
        return '{ ' + ', '.join(f'{k}: {js(x)}' for k, x in v.items()) + ' }'
    if isinstance(v, list):
        return '[' + ', '.join(js(x) for x in v) + ']'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, str):
        return f"'{v}'"
    return repr(v)


order = ['f22', 'fa18', 'a10', 'su35', 'mig31', 'gripen', 'cessna', 'b737', 'f35', 'b747', 'c130',
         'f14', 'f15', 'f4', 'typhoon', 'rafale', 'j20', 'mig29', 'mig21', 'mig25', 'j10', 'j8', 'f5', 'mirage', 'jaguar',
         'su57', 'su47', 'b2', 'racer', 'pitts']
lines = []
rows = []
for i in order:
    if i not in E:
        continue
    e = {k: v for k, v in E[i].items() if not k.startswith('_') and k != 'as'}
    lines.append(f'    {i}: {js(e)},')
    tris, size = glb_stats(os.path.join(ROOT, 'models', e['file']))
    if i in KIT:
        src = f'Built in Blender: `tools/aircraft/{i}.py` (kit) | CC0'
    else:
        s = SOURCE[i]
        src = f'{s[0]} | {s[1]}'
    old = OLD.get(i, f'{i}.glb (Captain_Ahab_62 low-poly, CC0)')
    rows.append(f'| `{i}` | {old} | {src} | {tris:,} | {size / 1e6:.2f} MB |')

credits = []
for i in order:
    if i in SOURCE and i in E:
        s = SOURCE[i]
        what = s[0].split(' by ')[0].strip('"')
        who = s[0].split(' by ')[1] if ' by ' in s[0] else 'NASA'
        credits.append(f"        ['{what} ({i})', '{who}', '{s[1]}', '{s[2]}'],")
credits.append("        ['MiG-31, MiG-25, J-20, J-10, J-8, F-5E, MiG-21, Mirage III, Jaguar', 'SKYWAR / Blender (tools/aircraft_kit.py)', 'CC0', 'tools/aircraft/'],")

out = f"""# MODEL_FILES patch for the new aircraft models (`models/aircraft/`)

Generated by `python3 tools/aircraft/make_patch.py` from `tools/aircraft/entries.json`. Every entry was
checked in `tools/aircraft/preview.html` (the game's own loader/normaliser) with the nozzle (red), wingtip
(blue) and cockpit (green) rig points drawn as markers. Entries without `nozzles` rely on the game's
automatic `findNozzles()` (verified visually for each); civil aircraft get none automatically.
All models already face the game's convention (nose toward -Z), so `rot` is `[0, 0, 0]` everywhere.
No entry uses `paint: true` any more: every model carries its own paint/texture and still takes liveries.

## 1. `src/models.js` — replace these keys in `MODEL_FILES`

Keep `f16`, `f2` and `f35n` exactly as they are. For the ids below, replace the existing line (or add it
for the ids that were procedural: f22, fa18, a10, su35, mig31, gripen, cessna, b737):

```js
{chr(10).join(lines)}
```

The old files (`generic_fighter.glb`, `airliner.glb`, `cargo.glb`, `air_racer.glb`, `stunt_biplane.glb`,
the Captain_Ahab_62 set and the Addmix set) are no longer referenced once this is applied; they can be
deleted in a follow-up (and their rows removed from `models/CREDITS.md` / the credits list).

## 2. What changed per aircraft

| id | old | new source / licence | triangles | size |
|---|---|---|---|---|
{chr(10).join(rows)}

## 3. `src/main.js` `buildCredits()` rows

Replace the rows for the retired models (Captain_Ahab_62 ×2, Addmix, "Jet (F-35 stand-in)", "Jumbo Jet",
"Airplane (C-130 stand-in)", "Aeroplane (Unlimited Air Racer)", "Airplane (Stunt Biplane)") with:

```js
{chr(10).join(credits)}
```

## 4. `models/CREDITS.md`

Add one line pointing at the new file: "Aircraft in `models/aircraft/`: see `models/aircraft/CREDITS.md`
(sources, licences and attribution lines)."
"""
open(os.path.join(HERE, 'MODEL_FILES.patch.md'), 'w').write(out)
print('wrote', os.path.join(HERE, 'MODEL_FILES.patch.md'))
print('\n'.join(rows))

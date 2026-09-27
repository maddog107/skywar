# Ship model credits

Every ship here is original work: geometry and textures are produced entirely by the scripts in `tools/ships/`
(no third-party meshes, photos or textures), released as [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
Rebuild with `sh tools/ships/build.sh` (textures: `ship_textures.py`, `fleet_textures.py`; meshes: Blender).
Numerals are rendered with a system font (Arial Black / Arial Bold) at build time. The moving parts each model
names (VLS doors and cells, masts, elevators, hatches, seats, the wheel…) are listed in `tools/ships/RIG.md`.

| File | Vessel | Script | Dimensions and layout from |
|---|---|---|---|
| `carrier.glb` | Nimitz-class aircraft carrier (generic, hull number 73) | `carrier_model.py`, `carrier_layout.py` | published Nimitz dimensions (LOA ~333 m, flight deck ~77 m, waterline beam ~41 m, draught ~11 m) scaled to the game's gameplay constants in `src/naval.js` |
| `destroyer.glb` | Arleigh Burke-class destroyer, Flight IIA (generic, hull number 89) | `destroyer_model.py` | Naval Vessel Register; USNI Proceedings June 2002 ("Handling the Arleigh Burkes"); FAS DDG-51 page and aviation facilities resume; Navypedia; the Shipbucket DDG-79 drawing and the Proietti Flight IIA drawing (Wikimedia Commons); US Navy photographs |
| `cruiser.glb` | Ticonderoga-class cruiser, CG-52 on (generic, hull number 62) | `cruiser_model.py` | FAS CG-47 page and aviation facilities resume; globalsecurity "CG-47 Design"; Navypedia; the Proietti drawing and the 1994 All Hands line drawing (Commons); an overhead photograph of USS Vincennes; naval-encyclopedia.com |
| (both) | Mk 41 vertical launching system | `navkit.py` | United Defense Mk 41 strike / tactical data sheets (globalsecurity); Wikipedia; Lockheed Martin fact sheet; seaforces.org launch photographs |
| `ssn.glb` | Virginia-class attack submarine, Block V (with the Virginia Payload Module) | `sub_model.py ssn` | Wikimedia drawing SSN774.svg scaled to the published length; CRS report RL32418; H I Sutton / Naval News (Block V); Naval Submarine League (the Universal Modular Masts); GlobalSecurity; photographs (draught marks, trim, hatches) |
| `ssgn.glb` | Ohio-class guided-missile submarine (SSGN) | `sub_model.py ssgn` | Wikimedia drawing SSGN726_Ohio.svg scaled to 170.7 m; Naval Submarine League (SSGN conversion); FAS; photographs ("All tubes USS Ohio", the 2003 dry dock) |
| `supply.glb` | Supply-class fast combat support ship (T-AOE-6, USNS Supply) | `supply_model.py` | US Navy 1995 Supply-class line drawing (Commons); Wikipedia, GlobalSecurity, FAS, navsource; Naval Postgraduate School thesis on the AOE-6 load-out (Appendix B, the replenishment stations) |
| `rhib.glb` | 11 m Naval Special Warfare rigid inflatable boat | `rhib_model.py` | United States Marine Inc. (builder); americanspecialops.com; navyseals.com; photographs of Special Boat Teams 12 and 20 |
| `cb90.glb` | CB90H combat boat (Stridsbåt 90H), Swedish coastal camouflage | `cb90_model.py` | Dockstavarvet general arrangement and specification; KaMeWa FF-450 datasheet; hhogman.se; SoldF; sv.wikipedia |
| `slava.glb` | Slava-class cruiser (Project 1164, Varyag, pennant 011) | `slava_model.py` | US DoD profile drawing (1986, Commons); navypedia profile and plan; kchf.ru; ru.wikipedia (Project 1164); the annotated armament drawing on Commons; photographs of Varyag and Moskva |

Positions not published anywhere were measured from the scaled drawings and photographs above (roughly ±1–3 m
on the ships, ±0.2–0.3 m on the boats).

A ready-made DDG-51 GLB exists in https://github.com/Void0312Aurora/Echelon-Forge
(`examples/viz/web_viz/static/assets/naval/ddg51.glb`), but unlike that repo's aircraft and missile assets
it has no attribution/licence record of its own (the repository's Apache-2.0 licence does not establish
the model's origin), so it was not used. Sketchfab CC BY models were looked at for every vessel (Objaverse
mirror); none was both well enough detailed and riggable (separate VLS doors, masts, seats), so all are built.

# Interior model credits

Every room here is original work: geometry, placards and the shared tiling textures (`tex/`) are produced entirely
by the scripts in `tools/interiors/` (no third-party meshes, photos or textures), released as
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Rebuild with `sh tools/interiors/build.sh`. How the
game reads them (node names, extras, materials) is `tools/interiors/ROOMS.md`.

| File | Room | Script | Layout from |
|---|---|---|---|
| `ssn_control.glb` | Virginia-class SSN Command and Control Center | `ssn_control.py` | Naval Submarine League, "Virginia's Command and Control Center" (2004); GlobalSecurity SSN-774 design; Wikipedia (Virginia-class, Photonics mast, AN/BQQ-10, Tomahawk); US Navy photographs on Wikimedia Commons (040822-N-2653P-209, 040825-N-2653P-040, 060825-N-7441H-013); DVIDS (USS Texas 8859145, PCU Indiana 627423) |
| `cvn_cic.glb` | Nimitz-class carrier Combat Direction Center | `cvn_cic.py` | Wikipedia (Combat information center, Nimitz-class); US Navy / DVIDS photographs of carrier CDCs |
| `cvn_prifly.glb` | Nimitz-class Primary Flight Control | `cvn_prifly.py` | Wikipedia (Air boss, Catapult officer); US Navy / DVIDS photographs of Pri-Fly |
| `joc.glb`, `joc_ext.glb` | Joint Operations Center: the floor and the hardened building with its T-walls and HESCO | `joc.py`, `joc_ext.py` | Wikipedia (Air Operations Center, Tactical operations center, Common operational picture, Bremer wall, Hesco bastion); DVIDS photographs of AOC / JOC floors |
| `tel_cabin.glb`, `tel_cab.glb` | 9P117 Scud TEL launch control cabin and the MAZ-543 driver's cab | `tel_cabin.py`, `tel_cab.py` | missilery.info (8K14, 9P117); Wikipedia (Scud, MAZ-543) |
| `tex/*.jpg` | deck plate, floor tile, carpet, wall paint, ceiling, console, concrete (+ normal maps) | `textures.py` | procedural |

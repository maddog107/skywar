# ═══════════════════════════════════════════════════════════════
# Launcher revetment: a U of precast concrete T-walls ("Alaska" barriers, 4.2 m tall, 1.5 m sections, the blast
# walls used round parked aircraft, launchers and fuel bladders on deployed bases since 2003).
#   blender -b -P tools/airbases/build.py -- revetment
# Inside 18 m × 27 m, open toward −Z (where the launcher drives in). References: US Army ERDC "Protective
# Construction" (UFC 4-020-01 / FM 3-34.300 fig. 5-x T-wall data: 12–20 ft tall, 5 ft sections, 8–10 ft base) and
# photos of T-wall revetments at Bagram and Al Asad (US DoD, public domain).
# ═══════════════════════════════════════════════════════════════
import akit
from akit import Vehicle, Part

CENTER = False
H = 4.2
SEC = 1.5


def twall(b, c, along, out, h=H):
    """one T-wall section centred at c (x, z), running along `along` ('x'|'z'), its foot toward `out` (±1)"""
    x, z = c
    if along == 'z':
        b.box('concrete', x - 0.12, x + 0.12, 0, h, z - SEC / 2 + 0.02, z + SEC / 2 - 0.02, bev=0.02)
        fx0, fx1 = (x + 0.12, x + 0.12 + out * 1.1) if out > 0 else (x - 0.12 - 1.1, x - 0.12)
        b.box('concrete', min(fx0, fx1), max(fx0, fx1), 0, 0.45, z - SEC / 2 + 0.02, z + SEC / 2 - 0.02)
        b.prism_z('concrete', [(x, 0.45), (x + out * 1.0, 0.45), (x, 1.2)], z - 0.2, z + 0.2)
        b.box('dark', x - 0.13, x + 0.13, h - 0.5, h - 0.35, z - 0.1, z + 0.1)
    else:
        b.box('concrete', x - SEC / 2 + 0.02, x + SEC / 2 - 0.02, 0, h, z - 0.12, z + 0.12, bev=0.02)
        fz0, fz1 = (z + 0.12, z + 0.12 + out * 1.1) if out > 0 else (z - 0.12 - 1.1, z - 0.12)
        b.box('concrete', x - SEC / 2 + 0.02, x + SEC / 2 - 0.02, 0, 0.45, min(fz0, fz1), max(fz0, fz1))
        b.prism_x('concrete', [(z, 0.45), (z + out * 1.0, 0.45), (z, 1.2)], x - 0.2, x + 0.2)
        b.box('dark', x - 0.1, x + 0.1, h - 0.5, h - 0.35, z - 0.13, z + 0.13)


def make():
    akit.setup_materials('blue_green')
    v = Vehicle('revetment', 'Launcher revetment', scheme='blue_green')
    b = Part(v, 'body')
    n = 18
    for s in (-1, 1):
        for k in range(n):
            twall(b, (s * 9.5, -13.5 + SEC * (k + 0.5)), 'z', s)
    for k in range(13):
        twall(b, (-9.75 + SEC * (k + 0.5), 13.6), 'x', 1)
    # stencilled numbers on the end walls and a gravel pad
    for s in (-1, 1):
        b.box('white', s * 9.5 - 0.13, s * 9.5 + 0.13, 2.6, 3.4, -12.9, -12.3)
    b.box('sand', -8.8, 8.8, 0, 0.04, -14.0, 12.8, skip=('bottom',))
    return v

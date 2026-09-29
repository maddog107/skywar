# ═══════════════════════════════════════════════════════════════
# QRA crew building: the alert crews' hardened accommodation beside the Quick Reaction Alert pad (the "Q-shed" /
# alert facility: pilots and ground crew live here on 24-hour alert, a short sprint from the jets).
#   blender -b -P tools/airbases/build.py -- qrahut
# 20 m × 12 m × 5 m: a single-storey reinforced-concrete block, flat roof with earth cover edge and plant, armoured
# window shutters, the scramble door on the pad side behind a blast wall, the alarm bell, the scramble lamps and the
# telebrief antenna. References: descriptions and photos of the QRA(I) facilities at RAF Coningsby and RAF
# Lossiemouth (UK MoD, Crown copyright, reference only) and the USAF alert facility standard design (the "Mole
# hole") in AFM 88-series drawings.
# Frame: the scramble door faces −Z.
# ═══════════════════════════════════════════════════════════════
import akit
from akit import Vehicle, Part

CENTER = False


def make():
    akit.setup_materials('blue_green')
    v = Vehicle('qrahut', 'QRA crew building', scheme='blue_green')
    b = Part(v, 'body')
    x0, x1, z0, z1, h = -10.0, 10.0, -6.0, 6.0, 4.2
    b.box('concrete', x0, x1, 0, h, z0, z1, skip=('bottom',))
    b.box('concrete', x0 - 0.3, x1 + 0.3, h, h + 0.8, z0 - 0.3, z1 + 0.3, bev=0.1, skip=('bottom',))   # thick roof slab
    b.box('earth', x0 + 0.2, x1 - 0.2, h + 0.8, h + 0.95, z0 + 0.2, z1 - 0.2)
    # windows: small, deep, with steel shutters half closed
    for x in (-7.0, -3.5, 3.5, 7.0):
        for z, n in ((z0, -1), (z1, 1)):
            b.box('glass', x - 0.6, x + 0.6, 1.3, 2.3, z - 0.01, z + 0.01)
            b.box('steelplate', x - 0.7, x + 0.7, 1.9, 2.45, z + n * 0.02, z + n * 0.08)
    for s in (-1, 1):
        b.box('glass', s * 10.0 - 0.01, s * 10.0 + 0.01, 1.3, 2.3, -1.0, 1.0)
    # the scramble door (double, wide) with its lamp and the blast wall in front of it
    b.box('steelplate', -1.3, 1.3, 0, 2.4, z0 - 0.06, z0)
    b.box('dark', -0.02, 0.02, 0, 2.4, z0 - 0.07, z0 - 0.06)
    b.box('concrete', -1.8, 1.8, 2.6, 2.8, z0 - 1.5, z0)
    b.box('lens_red', -0.9, -0.5, 2.9, 3.2, z0 - 0.2, z0)
    b.box('lens_amber', 0.5, 0.9, 2.9, 3.2, z0 - 0.2, z0)
    b.box('concrete', -3.0, 3.0, 0, 2.5, z0 - 3.8, z0 - 3.3)
    b.box('yellow', -3.02, 3.02, 2.3, 2.5, z0 - 3.82, z0 - 3.28)
    # the alarm bell and the scramble horn on the wall
    b.cyl('red', (4.0, 3.2, z0), (4.0, 3.2, z0 - 0.15), 0.25, 0.25, 12)
    b.lathe((5.2, 3.3, z0 - 0.1), (0, 0, -1), [(0, 0.08, 'grey'), (0.35, 0.25, 'grey'), (0.37, 0.0, 'dark')], n=10)
    # the rear door, the plant: two AC condensers, the standby generator box, the telebrief/antenna mast
    b.box('steelplate', 5.0, 6.2, 0, 2.2, z1, z1 + 0.06)
    for x in (-6.0, -3.6):
        b.box('grey', x, x + 1.8, h + 0.95, h + 1.9, -2.0, -0.4, bev=0.04)
        b.cyl('dark', (x + 0.9, h + 1.9, -1.2), (x + 0.9, h + 1.92, -1.2), 0.6, 0.6, 12)
    b.box('odgreen', -9.0, -7.0, 0, 1.6, z1 + 0.5, z1 + 2.0, bev=0.05)
    b.cyl('zinc', (7.5, h + 0.95, 3.5), (7.5, h + 7.0, 3.5), 0.06, 0.04, 6)
    b.cyl('white', (7.5, h + 7.0, 3.5), (7.5, h + 7.8, 3.5), 0.04, 0.02, 6)
    for y in (h + 4.0, h + 5.5):
        b.beam('zinc', (6.8, y, 3.5), (8.2, y, 3.5), 0.03)
    # sign board over the door, the bench under the canopy
    b.box('dark', -2.0, 2.0, 3.4, 4.0, z0 - 0.04, z0)
    b.box('yellow', -1.8, 1.8, 3.5, 3.9, z0 - 0.05, z0 - 0.04)
    b.box('wood', 2.2, 4.8, 0.45, 0.5, z0 - 0.9, z0 - 0.4)
    return v

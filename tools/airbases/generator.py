# ═══════════════════════════════════════════════════════════════
# Airbase power plant: a hardened generator building (the base's standby/prime power: diesel generator sets of
# about 1–2 MW each, as in the USAF "central power plant" facilities and NATO hardened power stations), with its
# radiator deck, exhaust stacks, day tank and the transformer yard feeding the airfield's lighting and the radar.
#   blender -b -P tools/airbases/build.py -- generator
# Footprint 30 m × 20 m: the building 20 × 16 × 7.5 m (reinforced concrete, flat roof), three stacks to 10 m,
# a fenced transformer yard (two 2.5 MVA units, a switchgear kiosk) on the +x side. References: UFC 3-540-01
# (Engine-driven generator systems) and UFC 3-550-01 layouts; photos of the power plant buildings at Spangdahlem and
# Aviano (US Air Force, public domain).
# ═══════════════════════════════════════════════════════════════
import math
import akit
from akit import Vehicle, Part

CENTER = False


def make():
    akit.setup_materials('blue_green')
    v = Vehicle('generator', 'Power plant', scheme='blue_green')
    b = Part(v, 'body')
    x0, x1, z0, z1, h = -15.0, 5.0, -8.0, 8.0, 7.5
    b.box('concrete', x0, x1, 0, h, z0, z1, skip=('bottom',))
    b.box('concrete', x0 - 0.2, x1 + 0.2, h, h + 0.5, z0 - 0.2, z1 + 0.2, skip=('bottom',))            # parapet
    b.box('dark', x0 + 0.2, x1 - 0.2, h + 0.3, h + 0.51, z0 + 0.2, z1 - 0.2)                            # roof membrane
    # louvred intake walls, the roller doors for the gensets, a personnel door with its canopy
    for k in range(3):
        cz = -5.0 + k * 5.0
        b.box('steelplate', x0 - 0.05, x0, 1.0, 5.2, cz - 1.8, cz + 1.8)
        for j in range(8):
            y = 1.2 + j * 0.5
            b.box('dark', x0 - 0.12, x0 - 0.05, y, y + 0.08, cz - 1.75, cz + 1.75)
    for k in range(3):
        cx = -11.0 + k * 6.0
        b.box('steelplate', cx - 2.0, cx + 2.0, 0, 4.2, z0 - 0.06, z0)
        for j in range(12):
            y = 0.3 + j * 0.33
            b.box('dark', cx - 2.0, cx + 2.0, y, y + 0.03, z0 - 0.08, z0 - 0.06)
        b.box('yellow', cx - 2.1, cx + 2.1, 4.2, 4.4, z0 - 0.08, z0)
    b.box('steelplate', 2.4, 3.4, 0, 2.2, z0 - 0.06, z0)
    b.box('concrete', 1.9, 3.9, 2.5, 2.7, z0 - 1.2, z0)
    b.box('lamp_glow', 2.6, 3.2, 2.42, 2.5, z0 - 0.6, z0 - 0.3)
    b.box('white', -6.0, 0.0, 5.3, 6.1, z0 - 0.03, z0)
    # radiator deck: three horizontal radiators with fans, on the roof
    for k in range(3):
        cz = -5.0 + k * 5.0
        b.box('steelplate', -13.5, -5.5, h + 0.5, h + 1.9, cz - 1.8, cz + 1.8, bev=0.05)
        for j in range(3):
            cx = -12.2 + j * 2.7
            b.cyl('dark', (cx, h + 1.9, cz), (cx, h + 1.95, cz), 1.1, 1.1, 12)
            b.disc('black', (cx, h + 1.96, cz), (0, 1, 0), 1.0, 12)
    # exhaust stacks with rain caps, the silencers along the roof, the day tank, the cable trays
    for k in range(3):
        cz = -5.0 + k * 5.0
        b.cyl('steelplate', (-2.0, h + 0.8, cz), (2.5, h + 0.8, cz), 0.55, 0.55, 12)
        b.cyl('steelplate', (3.2, h + 0.5, cz), (3.2, 10.0, cz), 0.32, 0.32, 10)
        b.tube('steelplate', [(2.5, h + 0.8, cz), (3.2, h + 0.8, cz)], 0.3, 8)
        b.cyl('soot', (3.2, 10.0, cz), (3.2, 10.15, cz), 0.34, 0.34, 10)
        for y in (h - 2.0, h + 1.5):
            b.box('dark', 3.2, 5.0, y, y + 0.1, cz - 0.1, cz + 0.1)
    b.cyl('steelplate', (-3.0, 2.05, z1 + 1.4), (3.0, 2.05, z1 + 1.4), 1.0, 1.0, 14)
    for x in (-2.2, 2.2):
        b.box('concrete', x - 0.3, x + 0.3, 0.9, 1.2, z1 + 0.6, z1 + 2.2)
    b.box('concrete', -3.6, 3.6, 0, 0.9, z1 + 0.2, z1 + 2.6, skip=('bottom',))
    b.box('dark', x1, x1 + 3.0, 5.0, 5.3, -0.4, 0.4)
    # ── the transformer yard ──
    yx0, yx1, yz0, yz1 = 6.0, 15.0, -8.0, 8.0
    b.box('concrete', yx0, yx1, 0, 0.1, yz0, yz1, skip=('bottom',))
    b.box('sand', yx0 + 0.2, yx1 - 0.2, 0.1, 0.13, yz0 + 0.2, yz1 - 0.2)
    for k, cz in enumerate((-4.0, 2.0)):
        cx = 10.0
        b.box('concrete', cx - 1.8, cx + 1.8, 0.1, 0.4, cz - 1.4, cz + 1.4)
        b.box('odgreen', cx - 1.4, cx + 1.4, 0.4, 3.0, cz - 1.0, cz + 1.0, bev=0.04)
        for j in range(7):
            x = cx - 1.35 + j * 0.45
            b.box('odgreen', x - 0.06, x + 0.06, 0.6, 2.8, cz - 1.5, cz - 1.0)
            b.box('odgreen', x - 0.06, x + 0.06, 0.6, 2.8, cz + 1.0, cz + 1.5)
        b.cyl('odgreen', (cx - 1.0, 3.0, cz + 0.6), (cx - 1.0, 3.6, cz + 0.6), 0.45, 0.45, 10)
        for j in range(3):
            x = cx - 0.6 + j * 0.6
            b.cyl('insulator', (x, 3.0, cz - 0.3), (x, 4.0, cz - 0.3), 0.1, 0.06, 8)
            b.tube('cable', [(x, 4.0, cz - 0.3), (x, 4.6, cz - 0.3), (x1 - 0.5, 5.5, cz - 0.3)], 0.025, 4)
    b.box('grey', 12.5, 14.5, 0.1, 2.4, 5.0, 7.5, bev=0.03)
    for j in range(3):
        b.box('dark', 12.6 + j * 0.64, 13.1 + j * 0.64, 0.4, 2.1, 7.5, 7.52)
    # the H-frame pole where the overhead line leaves, the yard fence (posts, top rail and a mesh panel line)
    for z in (-5.0, 5.0):
        b.box('dark', x1 + 9.6, x1 + 9.9, 0, 8.0, z - 0.15, z + 0.15)
    b.box('dark', x1 + 9.5, x1 + 10.0, 7.3, 7.6, -5.4, 5.4)
    for z in (-3.0, 0.0, 3.0):
        b.cyl('insulator', (x1 + 9.75, 7.6, z), (x1 + 9.75, 8.1, z), 0.08, 0.05, 6)
    fence = [(yx0, yz0), (yx1, yz0), (yx1, yz1), (yx0, yz1)]
    for i in range(4):
        (ax, az), (bx, bz) = fence[i], fence[(i + 1) % 4]
        L = math.hypot(bx - ax, bz - az)
        for k in range(int(L / 2.5) + 1):
            t = k / max(1, int(L / 2.5))
            b.cyl('zinc', (ax + (bx - ax) * t, 0.1, az + (bz - az) * t), (ax + (bx - ax) * t, 2.4, az + (bz - az) * t), 0.04, 0.04, 5)
        b.cyl('zinc', (ax, 2.35, az), (bx, 2.35, bz), 0.03, 0.03, 4)
        b.cyl('zinc', (ax, 0.3, az), (bx, 0.3, bz), 0.02, 0.02, 4)
        b.cyl('zinc', (ax, 1.3, az), (bx, 1.3, bz), 0.015, 0.015, 4)
    return v

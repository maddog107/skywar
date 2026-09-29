# ═══════════════════════════════════════════════════════════════
# Bulk fuel storage tank: an API 650 welded-steel vertical tank with a self-supported cone roof (the usual
# 10,000-barrel JP-8 / TS-1 tank of an airbase POL farm), on a ring-wall foundation.
#   blender -b -P tools/airbases/build.py -- fueltank
# 18 m diameter × 11 m shell (≈ 2,800 m³, ~17,600 bbl gross), roof slope 1:6 (API 650 §5.10). A spiral stair with
# its handrail up the shell, a roof platform with guardrails, breather vents, a gauge hatch, foam chambers at the top
# of the shell (NFPA 11), shell manholes, the fill and draw-off nozzles with valves. References: API Standard 650
# figures; photos of the POL tanks at RAF Mildenhall and Ramstein (US Air Force, public domain).
# ═══════════════════════════════════════════════════════════════
import math
import akit
from akit import Vehicle, Part

CENTER = False
R, H = 9.0, 11.0


def make():
    akit.setup_materials('blue_green')
    v = Vehicle('fueltank', 'Bulk fuel storage tank', scheme='blue_green')
    b = Part(v, 'body')
    n = 28
    # ring wall, the shell (courses show as slight steps), the cone roof
    b.cyl('concrete', (0, 0, 0), (0, 0.45, 0), R + 0.5, R + 0.5, n, cap0=False)
    prof = [(0.45, R, 'steelplate'), (2.9, R, 'steelplate'), (2.9, R - 0.01, 'steelplate'), (5.3, R - 0.01, 'steelplate'), (5.3, R - 0.02, 'steelplate'),
            (7.7, R - 0.02, 'steelplate'), (7.7, R - 0.03, 'steelplate'), (H, R - 0.03, 'steelplate'), (H + 0.12, R + 0.08, 'steelplate'),
            (H + 0.12 + R / 6, 0.6, 'steelplate'), (H + 0.12 + R / 6 + 0.1, 0.0, 'steelplate')]
    b.lathe((0, 0, 0), (0, 1, 0), prof, n=n)
    # the top angle / wind girder
    b.lathe((0, 0, 0), (0, 1, 0), [(H - 0.05, R + 0.35, 'dark'), (H + 0.05, R + 0.35, 'dark'), (H + 0.05, R - 0.02, 'dark')], n=n, smooth=False)
    # spiral stair: 40 treads climbing half way round, the stringer and handrail
    steps, a0, a1 = 40, math.radians(-100), math.radians(80)
    rail = []
    for k in range(steps + 1):
        t = k / steps
        a = a0 + (a1 - a0) * t
        y = 0.45 + (H - 0.45) * t
        c, s = math.cos(a), math.sin(a)
        if k < steps:
            b.beam('dark', (c * (R + 0.05), y, s * (R + 0.05)), (c * (R + 1.0), y, s * (R + 1.0)), 0.25, 0.04)
        rail.append((c * (R + 1.05), y + 1.0, s * (R + 1.05)))
        if k % 5 == 0:
            b.cyl('dark', (c * (R + 1.05), y, s * (R + 1.05)), rail[-1], 0.025, 0.025, 4)
    b.tube('dark', rail, 0.03, 5)
    b.tube('dark', [(p[0] * (R + 1.0) / (R + 1.05), p[1] - 1.05, p[2] * (R + 1.0) / (R + 1.05)) for p in rail], 0.05, 4)
    # roof platform + guardrail at the stair head; vents, gauge hatch
    a = a1
    px, pz = math.cos(a) * (R - 1.0), math.sin(a) * (R - 1.0)
    yroof = H + 0.12 + (R - (R - 1.0)) / 6
    b.box('dark', px - 1.2, px + 1.2, yroof, yroof + 0.08, pz - 1.2, pz + 1.2)
    for dx, dz in ((-1.2, -1.2), (1.2, -1.2), (1.2, 1.2), (-1.2, 1.2)):
        b.cyl('yellow', (px + dx, yroof, pz + dz), (px + dx, yroof + 1.1, pz + dz), 0.03, 0.03, 4)
    b.tube('yellow', [(px - 1.2, yroof + 1.1, pz - 1.2), (px + 1.2, yroof + 1.1, pz - 1.2), (px + 1.2, yroof + 1.1, pz + 1.2), (px - 1.2, yroof + 1.1, pz + 1.2)], 0.035, 4)
    for (x, z) in ((0, 0), (3.0, -2.0), (-2.5, 3.0)):
        y = H + 0.12 + (R - math.hypot(x, z)) / 6
        b.cyl('steelplate', (x, y, z), (x, y + 0.9, z), 0.25, 0.25, 8)
        b.cyl('dark', (x, y + 0.9, z), (x, y + 1.1, z), 0.45, 0.3, 8)
    # foam chambers round the top of the shell, shell manholes, nozzles and valves at the foot
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        c, s = math.cos(a), math.sin(a)
        b.cyl('red', (c * R, H - 0.9, s * R), (c * (R + 0.5), H - 0.9, s * R * (R + 0.5) / R), 0.28, 0.28, 8)
        b.cyl('red', (c * (R + 0.45), 0.5, s * (R + 0.45)), (c * (R + 0.45), H - 0.9, s * (R + 0.45)), 0.06, 0.06, 6)
    for a in (math.pi, 0.2):
        c, s = math.cos(a), math.sin(a)
        b.cyl('steelplate', (c * R, 1.3, s * R), (c * (R + 0.3), 1.3, s * (R + 0.3)), 0.4, 0.4, 12)
        b.cyl('dark', (c * (R + 0.3), 1.3, s * (R + 0.3)), (c * (R + 0.35), 1.3, s * (R + 0.35)), 0.46, 0.46, 12)
    for a, y in ((math.radians(200), 0.9), (math.radians(215), 0.9)):
        c, s = math.cos(a), math.sin(a)
        b.cyl('steelplate', (c * R, y, s * R), (c * (R + 2.5), y, s * (R + 2.5)), 0.2, 0.2, 8)
        b.cyl('yellow', (c * (R + 1.4), y - 0.3, s * (R + 1.4)), (c * (R + 1.4), y + 0.55, s * (R + 1.4)), 0.14, 0.14, 8)
        b.cyl('red', (c * (R + 1.4), y + 0.55, s * (R + 1.4)), (c * (R + 1.4), y + 0.6, s * (R + 1.4)), 0.3, 0.3, 8)
    # the tank number and the product band (a painted ring and a plate)
    b.lathe((0, 0, 0), (0, 1, 0), [(6.4, R + 0.01, 'yellow'), (6.8, R + 0.01, 'yellow')], n=n)
    return v

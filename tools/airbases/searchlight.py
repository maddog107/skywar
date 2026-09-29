# ═══════════════════════════════════════════════════════════════
# Anti-aircraft searchlight on its two-wheel trailer: the 150 cm class (the Soviet RP-15 / Prozhektornaya stantsiya
# and the US 60-inch Sperry M1941 layout: a big drum lamp on a yoke on a turntable, levelling jacks on the trailer).
#   blender -b -P tools/airbases/build.py -- searchlight
# Trailer 4.2 m × 2.2 m; the drum 1.6 m across the lens, its axis at 2.0 m. References: TM 5-7150 (Sperry 60-inch
# searchlight) figures, photos of the preserved RP-15 at the Kubinka / Artillery museum (reference only).
# Rig: turret (rot y), launcher (the drum, rot x −10° … 80°).
# ═══════════════════════════════════════════════════════════════
import math
import akit
from akit import Vehicle, Part, rot
import vkit

CENTER = False


def make():
    akit.setup_materials('blue_green')
    v = Vehicle('searchlight', 'Searchlight', scheme='blue_green')
    b = Part(v, 'body')
    # trailer: frame, bed, wheels, drawbar, levelling jacks
    b.box('paint', -1.0, 1.0, 0.7, 0.95, -1.6, 1.6, bev=0.03)
    b.box('dark', -0.15, 0.15, 0.6, 0.7, -2.9, -1.6)
    b.cyl('dark', (0, 0.55, -2.9), (0, 0.72, -2.9), 0.07, 0.07, 6)
    for s in (-1, 1):
        b.cyl('tyre', (s * 1.0, 0.45, 0.3), (s * 1.28, 0.45, 0.3), 0.45, 0.45, 14)
        b.disc('dark', (s * 1.285, 0.45, 0.3), (s, 0, 0), 0.24, 10)
        b.box('paint', s * 0.95, s * 1.35, 0.95, 1.02, -0.3, 0.9)
        for z in (-1.4, 1.4):
            b.cyl('dark', (s * 0.9, 0.7, z), (s * 0.9, 0.05, z), 0.05, 0.05, 6)
            b.box('dark', s * 0.9 - 0.15, s * 0.9 + 0.15, 0.0, 0.05, z - 0.15, z + 0.15)
    # generator box at the front of the bed, cable reel
    b.box('paint', -0.7, 0.7, 0.95, 1.7, -1.55, -0.9, bev=0.03)
    b.box('dark', -0.6, 0.6, 1.1, 1.6, -1.56, -1.55)
    b.cyl('dark', (-0.4, 1.25, 1.35), (0.4, 1.25, 1.35), 0.28, 0.28, 10)
    # turntable + yoke
    t = Part(v, 'turret', pivot=(0, 0.95, 0.2), joint=rot('y', -math.pi, math.pi, group='aim'))
    t.cyl('dark', (0, 0.95, 0.2), (0, 1.1, 0.2), 0.62, 0.62, 16)
    for s in (-1, 1):
        t.box('paint', s * 0.95, s * 1.08, 1.1, 2.1, 0.0, 0.4, bev=0.02)
        t.box('paint', s * 0.3, s * 1.08, 1.1, 1.25, 0.0, 0.4)
        t.cyl('dark', (s * 0.86, 2.0, 0.2), (s * 1.12, 2.0, 0.2), 0.12, 0.12, 8)
    # the drum: barrel with its cooling vents, the front lens (glass, a door ring), the rear mirror housing
    d = Part(v, 'launcher', pivot=(0, 2.0, 0.2), parent=t, joint=rot('x', -0.17, 1.4, stow=0.0, deploy=0.6, group='aim'))
    z0, z1 = -0.55, 0.75
    d.lathe((0, 2.0, 0.2 + z0), (0, 0, 1), [(0, 0.82, 'paint'), (0.9, 0.84, 'paint'), (1.3, 0.7, 'paint'), (1.42, 0.35, 'paint'), (1.46, 0.0, 'paint')], n=20, cap0=False)
    d.lathe((0, 2.0, 0.2 + z0), (0, 0, 1), [(-0.08, 0.86, 'dark'), (0.0, 0.86, 'dark'), (0.0, 0.8, 'dark')], n=20, smooth=False)
    d.disc('glass', (0, 2.0, 0.2 + z0 - 0.01), (0, 0, -1), 0.8, 20)
    for k in range(4):
        y = 2.0 - 0.6 + k * 0.4
        d.box('dark', -0.8, 0.8, y - 0.012, y + 0.012, z0 + 0.2 - 0.02, z0 + 0.2 - 0.01)
    d.cyl('dark', (0, 2.8, 0.2), (0, 3.05, 0.2), 0.12, 0.16, 8)
    d.box('dark', -0.12, 0.12, 2.0 - 0.1, 2.0 + 0.1, 0.2 + z1 + 0.6, 0.2 + z1 + 0.9)
    return v

# ═══════════════════════════════════════════════════════════════
# Earth-covered munitions igloo (the US "Stradley" / 7-bar steel-arch magazine of DoD 6055.09-M and the NATO
# equivalent: a semicircular corrugated-steel arch on a concrete floor, buried under at least 0.6 m of earth, with a
# reinforced-concrete headwall and wing walls and a pair of steel blast doors).
#   blender -b -P tools/airbases/build.py -- igloo
# Arch 8 m span × 20 m deep under the mound; outer ~12 m wide × 26 m long × 6.5 m high. References: DoD 6055.09-M
# (Ammunition and Explosives Safety Standards) figures for earth-covered magazines, NAVFAC definitive drawings for
# steel-arch igloos, and photographs of the igloo rows at RAF Welford / Hill AFB (public domain, US DoD).
# Frame: the doors face −Z.
# ═══════════════════════════════════════════════════════════════
import math
import akit
from akit import Vehicle, Part

CENTER = False
L0, L1 = -13.0, 13.0
HW = 0.3                     # headwall thickness


def make():
    akit.setup_materials('blue_green')
    v = Vehicle('igloo', 'Earth-covered munitions igloo', scheme='blue_green')
    b = Part(v, 'body')
    # ── the mound: a half-ellipse cross-section 12 m wide × 6.5 m high, sloping down to the ground at the rear ──
    N = 16
    zs = [L0 + 0.6, L0 + 4, 0, L1 - 5, L1 - 2, L1]
    rings = []
    for z in zs:
        t = 1.0 if z <= L1 - 5 else max(0.05, (L1 - z) / 5.0)
        span, rise = 12.0 + 2.0 * (1 - t), 6.5 * (0.2 + 0.8 * t)
        rings.append([(-span / 2 + span * i / N, rise * max(0.0, 1 - abs(-1 + 2 * i / N) ** 1.8) ** 0.5, z) for i in range(N + 1)])
    for j in range(len(rings) - 1):
        A, B = rings[j], rings[j + 1]
        for i in range(N):
            b.face([A[i], A[i + 1], B[i + 1], B[i]], 'earth', want=(A[i][0] + A[i + 1][0], 1, 0.4 if j >= 3 else 0), smooth=True)
    b.face(rings[0], 'earth', want=(0, 0, -1))
    # ── the headwall: a flat concrete face with a stepped top and two splayed wing walls ──
    z0 = L0
    b.box('concrete', -4.4, 4.4, 0, 5.4, z0, z0 + 0.7, bev=0.03)
    b.box('concrete', -4.8, 4.8, 5.4, 5.8, z0 - 0.05, z0 + 0.75)
    for s in (-1, 1):
        b.prism_z('concrete', [(s * 4.4, 0), (s * 7.6, 0), (s * 7.6, 0.6), (s * 4.4, 5.4)], z0 - 0.4, z0 + 0.35)
        b.prism_x('concrete', [(z0 - 3.2, 0), (z0 + 0.2, 0), (z0 + 0.2, 5.4), (z0 - 3.2, 0.9)], s * 4.4 - (0.35 if s > 0 else 0), s * 4.4 + (0.35 if s < 0 else 0))
    # the apron slab in front
    b.box('concrete', -4.4, 4.4, 0, 0.12, z0 - 6.0, z0, skip=('bottom',))
    # ── the doors: two steel leaves in a frame, with the locking bars and the magazine number ──
    b.box('dark', -2.0, 2.0, 0.12, 3.9, z0 - 0.06, z0)
    for s in (-1, 1):
        b.box('steelplate', s * 0.02, s * 1.95, 0.15, 3.85, z0 - 0.16, z0 - 0.06)
        for y in (0.9, 2.0, 3.1):
            b.box('dark', s * 0.1, s * 1.85, y - 0.05, y + 0.05, z0 - 0.2, z0 - 0.16)
        b.box('dark', s * 0.16, s * 0.24, 0.6, 3.4, z0 - 0.24, z0 - 0.16)
    b.box('white', -1.0, 1.0, 4.3, 5.0, z0 - 0.03, z0)
    b.box('black', -0.7, -0.1, 4.4, 4.9, z0 - 0.04, z0 - 0.03)
    b.box('black', 0.1, 0.7, 4.4, 4.9, z0 - 0.04, z0 - 0.03)
    # hazard placard (the orange division-1.1 diamond), a lamp over the door
    pts = [(2.9, 4.3, z0 - 0.03), (3.4, 3.8, z0 - 0.03), (2.9, 3.3, z0 - 0.03), (2.4, 3.8, z0 - 0.03)]
    b.face(pts, 'orange', want=(0, 0, -1))
    b.box('dark', -0.3, 0.3, 4.0, 4.2, z0 - 0.5, z0)
    b.box('lens', -0.25, 0.25, 3.96, 4.0, z0 - 0.48, z0 - 0.05)
    # ── ventilators on the mound and the lightning-protection mast behind ──
    for z in (-5.0, 5.0):
        b.cyl('steelplate', (0, 6.2, z), (0, 7.2, z), 0.22, 0.22, 10)
        b.cyl('steelplate', (0, 7.2, z), (0, 7.5, z), 0.4, 0.3, 10)
    b.cyl('steelplate', (0, 0, L1 + 1.5), (0, 11.0, L1 + 1.5), 0.12, 0.05, 8)
    b.cyl('concrete', (0, 0, L1 + 1.5), (0, 0.4, L1 + 1.5), 0.5, 0.5, 8)
    b.tube('cable', [(0, 11.0, L1 + 1.5), (0, 6.6, 0), (0, 5.2, L0 + 1.0)], 0.02, 4)
    return v

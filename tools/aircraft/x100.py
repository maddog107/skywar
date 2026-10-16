# X-100 Overkill — SKYWAR's own (fictional) test jet, built with the aircraft kit.
#   python3 tools/aircraft/markings.py   (once: the gold lettering, badge and stencil images)
#   /opt/homebrew/bin/blender -b -P tools/aircraft/x100.py -- models/aircraft/x100.glb [--render DIR] [--quick]
#   /opt/homebrew/bin/blender -b -P tools/aircraft/x100_gear.py -- models/aircraft/x100.glb models/aircraft/x100_gear.glb
# (--quick: no texture atlas, for fast shape previews. The gear goes after the airframe: its doors take the airframe
# atlas's texture mapping, so rebuild it whenever the airframe changes.)
# An original design, not a copy of any aircraft: 21.0 m long, 12.6 m span. s = metres aft of the pitot tip,
# x = right, z = up from the chine line at the nose.
# Shape: a needle nose flaring into long, sharp chines (kit S(ch=...)) that run back into the wing's leading edge; a
# frameless gold-tinted canopy well forward; small close-coupled canards on the chines; caret intakes tucked under the
# chines feeding two big engines in flat-bottomed nacelles; a cranked-arrow wing (the strake swept 68°, the outer
# panel 54° with 11° anhedral, the trailing edge swept back to the tips); twin fins canted 30° outward over the
# nacelles with small ventral fins under them; 2-D thrust-vectoring nozzles with serrated paddles (kit
# paddle_nozzle()); and a conformal bulge on the belly between the nacelles: the bay the bunker busters drop from.
# Finish: satin black with gold. The gold is geometry in its own material ('TrimGold', baked into the trim atlas, so
# every gold edge is a crisp polygon edge and liveries leave it alone): the leading edges of the wing, canards and
# fins (kit surface(le=...)), the chine edges from the nose to the wing (kit loft(edge=...)) and a sill rail round
# the canopy (kit tube()). Painted on (tools/aircraft/markings.py, baked with the panel lines and ambient occlusion
# into the skin atlas): "X-100" in gold leaf on the fins and under the wings, "OVERKILL" on the nose, a double
# chevron on the spine, the made-up SKYWAR test-squadron badge with a lightning flash and the serial on the intake
# trunks, warning / rescue / no-step / intake-danger stencils, door outlines. Titanium heat tint on the nozzles.
import os, sys, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

QUICK = '--quick' in sys.argv
GOLD = ('TrimGold', 0.22)          # the wing's leading-edge band: material, width (m)

K.begin('x100', 21.0, paint='#17181b', paint2='#1b1c20', radome='#202226', gold=True,
        panel={'key': 'panel', 'line': 0.76, 'grime': 0.03})
K.new_material('TrimGold', '#d2a043', metal=0.0, rough=0.35)
# the canopy: a deeper gold-orange tint than the kit's default gold
g = K.mat('Canopy_Glass').node_tree.nodes['Principled BSDF']
g.inputs['Base Color'].default_value = (*K.srgb('#b4782a'), 1)

# ── fuselage: needle radome, chined forebody flaring into the wing, blended centre body, the tail ──
K.loft('Fuselage', [
    S(0.45, 0.02, 0.02, 0.02, z=0.00, nt=2.0, nb=3.0, ch=1.0),
    S(1.40, 0.15, 0.11, 0.07, z=0.00, nt=2.0, nb=3.0, ch=1.0),
    S(2.60, 0.32, 0.25, 0.14, z=0.01, nt=2.0, nb=3.2, ch=1.0),
    S(3.80, 0.54, 0.40, 0.22, z=0.02, nt=2.1, nb=3.4, ch=1.0),
    S(5.00, 0.76, 0.53, 0.32, z=0.03, nt=2.3, nb=3.4, ch=1.0),
    S(6.20, 1.00, 0.60, 0.44, z=0.03, nt=2.5, nb=3.2, ch=1.0, crown=0.1),
    S(7.40, 1.34, 0.63, 0.56, z=0.01, nt=2.6, nb=3.0, ch=1.0, crown=0.2),
    S(8.60, 1.66, 0.65, 0.66, z=-0.01, nt=2.7, nb=3.0, ch=0.95, crown=0.3),
    S(10.0, 1.94, 0.66, 0.74, z=-0.03, nt=2.8, nb=3.0, ch=0.8, crown=0.4),
    S(12.0, 2.06, 0.68, 0.80, z=-0.05, nt=2.8, nb=3.0, ch=0.6, crown=0.45),
    S(14.5, 2.06, 0.64, 0.80, z=-0.06, nt=2.8, nb=3.0, ch=0.55, crown=0.45),
    S(16.8, 1.96, 0.56, 0.74, z=-0.07, nt=2.8, nb=3.0, ch=0.5, crown=0.45),
    S(18.6, 1.82, 0.46, 0.62, z=-0.08, nt=2.8, nb=3.0, ch=0.45, crown=0.4),
    S(19.7, 1.70, 0.36, 0.50, z=-0.10, nt=2.8, nb=3.0, ch=0.4, crown=0.35),
], ring=64, register='Fuselage', mat_ranges=[(0.0, 2.4, 'Radome')],
   edge=dict(mat='TrimGold', top=0.12, bottom=0.06, s0=0.5, s1=9.3))     # gold chine edges, nose to the wing
K.probe('Pitot', 0.0, 0.75, 0.0, 0.03, 0.008)

# caret intakes tucked under the chines (outer lip forward, raked back at the bottom)
K.duct('Intake', [
    S(7.20, 0.36, 0.40, 0.42, x=1.00, z=-0.50, nt=4.5),
    S(8.60, 0.40, 0.42, 0.45, x=1.01, z=-0.52, nt=4.0),
    S(10.6, 0.42, 0.40, 0.45, x=1.00, z=-0.50, nt=3.6),
    S(12.2, 0.34, 0.32, 0.36, x=0.99, z=-0.46, nt=3.2),
], rake=(-0.75, -0.45), throat=1.7)

# engine nacelles: from the intake trunks back to the nozzles, flat-bottomed
K.loft('Nacelle', [
    S(10.8, 0.38, 0.30, 0.36, x=1.00, z=-0.50, nt=3.0, nb=3.6),
    S(12.6, 0.62, 0.42, 0.47, x=1.00, z=-0.44, nt=3.0, nb=3.8),
    S(16.5, 0.68, 0.44, 0.48, x=0.99, z=-0.36, nt=3.4, nb=4.0),
    S(18.8, 0.66, 0.43, 0.45, x=0.98, z=-0.30, nt=4.2, nb=4.6),
    S(19.55, 0.64, 0.41, 0.41, x=0.98, z=-0.28, nt=5.0, nb=5.0),
], ring=28, step=0.45, mirror=True)
# the conformal weapon-bay bulge between the nacelles
K.loft('Bay', [S(9.4, 0.18, 0.15, 0.05, z=-0.76, nt=2.5, nb=3.0), S(10.8, 0.52, 0.26, 0.24, z=-0.80, nt=3.0, nb=3.6),
               S(14.8, 0.55, 0.26, 0.24, z=-0.80, nt=3.0, nb=3.6), S(16.6, 0.20, 0.16, 0.06, z=-0.76, nt=2.5)], ring=24, step=0.45)

# big 2-D thrust-vectoring nozzles with upper and lower paddles
K.paddle_nozzle('Nozzle', 19.45, 20.42, 0.98, -0.28, 0.64, 0.41, 0.61, 0.36, paddle=0.58, converge=7, mirror=True, depth=0.8,
                teeth=4, tooth=0.16)
# the tail between the nozzles (a short stinger with the brake-chute)
K.loft('Stinger', [S(18.6, 0.30, 0.22, 0.22, z=-0.12, nt=2.6), S(20.2, 0.24, 0.16, 0.18, z=-0.14, nt=2.6),
                   S(20.75, 0.12, 0.08, 0.09, z=-0.14, nt=2.4)], ring=20)

# small close-coupled canards on the chines, a little dihedral
K.surface('Canard', [(6.55, 8.30, 1.00, 0.02, 0.045), (8.40, 8.98, 2.75, 0.15, 0.035)], material='Paint2', subdiv=2,
          le=('TrimGold', 0.12))

# cranked-arrow wing: the root inside the body, the strake emerging from the chine, the crank, and an outer panel
# with anhedral
K.surface('Wing', [
    (8.40, 19.00, 1.30, -0.05, 0.034),
    (9.20, 18.90, 1.80, -0.06, 0.032),
    (14.30, 19.10, 3.90, -0.13, 0.030),
    (17.60, 19.75, 6.30, -0.62, 0.026),
], subdiv=3, le=GOLD)

# twin fins canted 30° outward over the nacelles, small ventral fins under them
FIN_X, FIN_Z, FIN_H = 1.52, 0.0, 2.15      # the root sunk into the back (it slopes down toward the tail)
for side in (1, -1):
    sx = 'R' if side > 0 else 'L'
    K.fin('Fin' + sx, (15.8, 19.70), (18.55, 20.45, FIN_H), t=0.042, t_tip=0.03, cant=30 * side, x=FIN_X * side, z=FIN_Z,
          le=('TrimGold', 0.12))
    K.fin('Ventral' + sx, (17.5, 19.45), (18.45, 19.65, 0.62), t=0.045, t_tip=0.035, cant=(180 - 40) * side, x=1.42 * side,
          z=-0.62, le=('TrimGold', 0.08))

# frameless gold-tinted canopy well forward
# (the body's top is curved: the glass is sunk 0.2 m so its edges meet the skin, not the centreline's height)
CANOPY = [(2.70, 0.05, 0.10), (3.25, 0.30, 0.36), (3.90, 0.41, 0.56), (4.60, 0.44, 0.63), (5.30, 0.42, 0.58),
          (5.95, 0.31, 0.42), (6.55, 0.07, 0.12)]
SINK = 0.2
K.canopy(CANOPY, seat=(4.85, 0.0), sink=SINK)

def skin_z(s, x):
    # the fuselage's upper skin height at (s, x)
    p = K.body_at('Fuselage', s)
    pts = K.section_points(p, 1440)[:361]
    for (xa, za), (xb, zb) in zip(pts, pts[1:]):
        if xb <= x <= xa:
            return za + (zb - za) * (x - xa) / ((xb - xa) or 1e-9)
    return pts[-1][1]

# a gold sill rail where the glass meets the skin
fw = K.pchip([a for a, _, _ in CANOPY], [b for _, b, _ in CANOPY])
fh = K.pchip([a for a, _, _ in CANOPY], [c for _, _, c in CANOPY])
sill = []
for i in range(26):
    s_ = 2.85 + (6.4 - 2.85) * i / 25
    p = K.body_at('Fuselage', s_)
    zb = p['z'] + p['ht'] - SINK
    lo, hi = 0.0, math.pi / 2           # angle round the glass from its base edge (0) up to the top
    for _ in range(40):
        a = (lo + hi) / 2
        x_, z_ = fw(s_) * math.cos(a), zb + fh(s_) * math.sin(a) ** 0.85
        lo, hi = (a, hi) if z_ < skin_z(s_, x_) else (lo, a)
    sill.append((s_, fw(s_) * math.cos(lo), zb + fh(s_) * math.sin(lo) ** 0.85))
K.tube('Sill', sill, 0.022, material='TrimGold', N=6, mirror=True)

# EOTS window under the nose, the four 30 mm cannon on the chine shoulders, blade antennas, lights
K.ellipsoid('EOTS', 3.1, 0.0, -0.20, 0.32, 0.15, 0.09, material='Dark')
K.ellipsoid('GunFairing', 7.9, 1.02, 0.20, 1.05, 0.15, 0.09, material='Paint2', mirror=True)
for dx in (-0.05, 0.05):
    K.probe('Muzzle', 6.75, 7.05, 0.20, 0.04, 0.035, x=1.02 + dx)
    K.probe('Muzzle', 6.75, 7.05, 0.20, 0.04, 0.035, x=-1.02 - dx)
K.box('AntDorsal', 10.4, 10.8, -0.012, 0.012, 0.60, 0.74, material='Paint2')
K.box('AntVentral', 6.6, 6.9, -0.012, 0.012, -0.62, -0.50, material='Paint2')
K.lamp('NavLight', 18.6, 6.28, -0.60, mirror=True, r=0.05)

# ── markings (tools/aircraft/markings: x100_*.png) ──
from mathutils import Vector

def body_pt(s, u, reg='Fuselage'):
    """A point on the right upper skin of a registered loft at station s, a fraction u (0 the top centre … 1 the
    chine) of its half-width out: Blender (x, y, z) and the outward unit normal there."""
    p = K.body_at(reg, s)
    pts = K.section_points(p, 1440)
    tx = p['x'] + u * p['w']
    i = min(range(1, 360), key=lambda k: abs(pts[k][0] - tx))
    (xa, za), (xb, zb) = pts[i - 1], pts[i + 1]
    n = Vector((zb - za, 0.0, -(xb - xa))).normalized()
    return Vector((pts[i][0], K.Y(s), pts[i][1])), n

def along(img, s0, s1, u0, u1, h, depth=0.25, facing=0.35, mats=('Paint', 'Radome')):
    """Lettering laid along the upper skin from station s0 to s1 (at u0 → u1 of the half-width), h metres high, on
    both sides and readable on both (it runs nose-right on the right side, nose-left on the left)."""
    (P0, n0), (P1, n1) = body_pt(s0, u0), body_pt(s1, u1)
    D = (P0 - P1).normalized()
    n = (n0 + n1).normalized()
    n = (n - D * n.dot(D)).normalized()
    c = (P0 + P1) / 2
    K.decal(img, (-c.y, c.x, c.z), ((P0 - P1).length, h), tuple(n), up=tuple(n.cross(D)), depth=depth, facing=facing, mats=mats)

# OVERKILL on the nose, ahead of the windscreen
along('x100_nose.png', 1.05, 2.60, 0.50, 0.50, 0.23, depth=0.15, facing=0.3)
# double chevron on the spine, pointing forward
K.decal('x100_chevron.png', (9.9, 0.0, 0.62), (1.45, 1.09), (0, 0, 1), depth=0.25, mirror=False, mats=('Paint',))
# X-100 in gold leaf on both faces of both fins
c30, s30 = math.cos(math.radians(30)), math.sin(math.radians(30))
fx, fz = FIN_X + s30 * FIN_H * 0.52, FIN_Z + c30 * FIN_H * 0.52
K.decal('x100_fin.png', (18.75, fx, fz), (1.85, 0.58), (c30, 0, -s30), up=(s30, 0, c30), depth=0.12, facing=0.6)
K.decal('x100_fin.png', (18.75, fx, fz), (1.85, 0.58), (-c30, 0, s30), up=(s30, 0, c30), depth=0.12, facing=0.6)
# X-100 under the outer wings (read from below)
K.decal('x100_wing.png', (17.15, 4.75, -0.37), (2.2, 0.69), (-0.2, 0, -0.98), depth=0.15, facing=0.6)
# on the intake trunks' flat sides: the squadron badge, a gold lightning flash running aft from it (pointing
# forward on both sides), the serial and the intake-danger stencil
K.decal('x100_badge.png', (7.95, 1.415, -0.50), (0.58, 0.58), (1, 0, 0), depth=0.12, facing=0.7)
K.decal('x100_flash.png', (9.8, 1.415, -0.47), (2.7, 0.34), (1, 0, 0), up=(0, 0, 1), depth=0.2, facing=0.5, mirror=False)
K.decal('x100_flash.png', (9.8, -1.415, -0.47), (2.7, 0.34), (-1, 0, 0), up=(0, 0, -1), depth=0.2, facing=0.5, mirror=False)
K.decal('x100_serial.png', (9.6, 1.415, -0.78), (1.05, 0.12), (1, 0, 0), depth=0.12, facing=0.7)
K.decal('x100_danger.png', (7.55, 1.415, -0.16), (0.34, 0.105), (1, 0, 0), depth=0.12, facing=0.7)
# ejection-seat warning and canopy rescue arrow below the canopy, no-step on the wing roots
along('warning.png', 3.15, 3.33, 0.86, 0.86, 0.18, depth=0.12)
along('rescue.png', 6.15, 6.55, 0.80, 0.80, 0.20, depth=0.12)
K.decal('x100_nostep.png', (15.3, 2.75, 0.02), (0.62, 0.145), (0, 0, 1), depth=0.15)
# door and panel outlines (a lighter grey than the paint): the bay's two sawtooth doors, nose and main gear doors,
# engine access panels, the dorsal airbrake (src/surfacedefs.js) and panels on the back
K.decal('x100_saw.png', (12.8, 0.27, -1.03), (4.0, 0.46), (0, 0, -1), up=(1, 0, 0), depth=0.15, mats=('Paint',))
# (the gear doors' outlines match the doors of tools/aircraft/x100_gear.py)
K.decal('x100_door.png', (5.275, 0.0, -0.33), (2.27, 0.44), (0, 0, -1), up=(1, 0, 0), depth=0.15, mirror=False, mats=('Paint',))
K.decal('x100_door.png', (12.225, 1.29, -0.90), (1.87, 0.44), (0, 0, -1), up=(1, 0, 0), depth=0.12, mats=('Paint',))
K.decal('x100_door.png', (16.2, 1.0, -0.84), (2.4, 0.56), (0, 0, -1), up=(1, 0, 0), depth=0.12, mats=('Paint',))
K.decal('x100_door.png', (12.6, 0.95, 0.58), (1.5, 0.62), (0, 0, 1), up=(1, 0, 0), depth=0.15, mats=('Paint',))
K.decal('x100_door.png', (15.4, 0.62, 0.50), (1.2, 0.5), (0, 0, 1), up=(1, 0, 0), depth=0.15, mats=('Paint',))
K.decal('x100_door.png', (12.2, 0.0, 0.62), (2.46, 1.16), (0, 0, 1), up=(1, 0, 0), depth=0.15, mirror=False, mats=('Paint',))

K.heat_tint('Nozzle', 19.45, 20.98, [(0.0, '#6b5a3e'), (0.35, '#5a4636'), (0.62, '#3e3a50'), (0.85, '#383c48'), (1.0, '#2c2e33')])

if QUICK:
    K.finish()
else:
    K.finish(atlas=2048, ao=0.5, skin_rough=0.5, skin_metal=0.1)

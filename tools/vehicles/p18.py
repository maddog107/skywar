# ═══════════════════════════════════════════════════════════════
# P-18 "Spoon Rest D" VHF search radar antenna vehicle on the Ural-4320: a lattice mast hinged at the rear of the
# body, carrying the rotating array of 16 Yagi antennas (8 posts with a Yagi top and bottom) on a main boom.
#   blender -b -P tools/vehicles/build.py -- p18
# The real array is dismantled for travel; here it folds mechanically so the stowed vehicle stays road-sized: the
# mast lies forward over the cab, the two halves of the main boom fold back along it, each post turns about its own
# axis and each Yagi rolls flat — two thin layers above the mast. Everything is modelled deployed (mast vertical,
# array open) and turned into the stowed rest pose through the inverse of the joint chain, so raise(rig, 1)
# reproduces the deployed array exactly.
# References: P-18 photos on Wikimedia Commons (on Ural-4320/-375D trucks; Medina, Hungary), P-18 data
# (VHF 150–170 MHz, 16 Yagi antennas in two rows of 8, 6 rpm; the mast about 10 m).
# Rig: mast (rot x at the rear hinge, 0 → 90°, group 'raise'); antenna (spin about the mast, 6 rpm — spin only when
# deployed); array_l / array_r (the boom halves, rot y 0 → ∓90°, 'raise'); post_<l|r><1..4> (rot x 0 → 90°, 'raise');
# yagi_<l|r><1..4><t|b> (rot z 0 → 90°, 'raise'); jack_fl/fr/rl/rr; 6 wheels, exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector, Quaternion
import vkit
from vkit import Vehicle, Part, rot, slide, lerp, vec
import ural
from ural import URAL
import ammo_red

PIV = Vector((0.0, 2.95, 6.90))     # mast hinge
MAST_L = 5.6                        # hinge → rotator top
BOOM_UP = 0.30                      # main boom above the rotator (along the mast)
WING_OFF = (0.34, 0.54)             # the two boom halves stand behind the mast by these (deployed z) → stacked when stowed
POSTS = (0.72, 1.66, 2.60, 3.54)    # post stations out from the centre
POST_H = 0.80                       # half height of a post (Yagi to Yagi 1.6 m)
YAGI = 0.90                         # Yagi boom length
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))


def rot_parts(parts, pivot, axis, ang):
    q = Quaternion(Vector(axis).normalized(), ang)
    for p in parts:
        p.rotate_about(pivot, axis, ang)
        p.pivot = pivot + q @ (p.pivot - pivot)


def yagi(p, base, n_dir, e_dir, length=YAGI):
    """a Yagi on part p (deployed frame): boom from `base` along n_dir (a short tail behind for the reflector),
    elements along e_dir: reflector, driven dipole (with its feed box), four directors"""
    base, n, e = vec(base), Vector(n_dir).normalized(), Vector(e_dir).normalized()
    tail = 0.12
    p.cyl('aluminium', base - n * tail, base + n * length, 0.014, 0.014, 6, smooth=False)
    stations = [(-tail + 0.01, 0.50), (0.10, 0.46), (0.33, 0.42), (0.52, 0.40), (0.71, 0.38), (length - 0.02, 0.36)]
    for i, (t, h) in enumerate(stations):
        c = base + n * t
        p.cyl('aluminium', c - e * h, c + e * h, 0.008, 0.008, 4, smooth=False)
        if i == 1:
            p.box('dark', c.x - 0.04, c.x + 0.04, c.y - 0.04, c.y + 0.04, c.z - 0.04, c.z + 0.04)   # dipole feed box
    # the mounting clamp on the post
    p.box('dark', base.x - 0.035, base.x + 0.035, base.y - 0.035, base.y + 0.035, base.z - 0.035, base.z + 0.035)


def build_array(v):
    """mast, rotator, boom halves, posts and Yagis — built deployed, then folded into the rest pose"""
    top = PIV + Y * MAST_L
    mast = Part(v, 'mast', pivot=PIV, joint=rot('x', 0.0, math.pi / 2, group='raise'))
    # lattice mast: four corner tubes, zig-zag lacing on each face, the hinge knuckle and the rotator housing
    h = 0.16
    corners = [(-h, -h), (h, -h), (h, h), (-h, h)]
    y0, y1 = PIV.y + 0.15, top.y
    for (cx, cz) in corners:
        mast.cyl('paint', (cx, y0, PIV.z + cz), (cx, y1, PIV.z + cz), 0.03, 0.03, 6, smooth=True)
    n = int((y1 - y0) / 0.45)
    for f in range(4):
        a, b_ = corners[f], corners[(f + 1) % 4]
        for i in range(n):
            ya = lerp(y0, y1, i / n)
            yb = lerp(y0, y1, (i + 1) / n)
            p0 = (a[0], ya, PIV.z + a[1]) if i % 2 == 0 else (b_[0], ya, PIV.z + b_[1])
            p1 = (b_[0], yb, PIV.z + b_[1]) if i % 2 == 0 else (a[0], yb, PIV.z + a[1])
            mast.beam('paint', p0, p1, 0.02, 0.02)
        mast.beam('paint', (a[0], y1 - 0.02, PIV.z + a[1]), (b_[0], y1 - 0.02, PIV.z + b_[1]), 0.03, 0.03)
    mast.box('paint', -0.22, 0.22, PIV.y - 0.1, PIV.y + 0.2, PIV.z - 0.22, PIV.z + 0.22)
    mast.cyl('dark', (-0.3, PIV.y, PIV.z), (0.3, PIV.y, PIV.z), 0.07, 0.07, 10)
    mast.cyl('paint', (0, top.y - 0.25, PIV.z), (0, top.y, PIV.z), 0.2, 0.2, 14)
    # the cable run up the mast to the rotator
    mast.tube('cable', [(h + 0.05, y0 + 0.1, PIV.z), (h + 0.05, y1 - 0.3, PIV.z), (0.1, y1 - 0.1, PIV.z + 0.12)], 0.022, 5)
    # ── antenna (spins on the rotator) ──
    ant = Part(v, 'antenna', pivot=top, parent=mast, joint=vkit.spinj([0, 1, 0], rpm=6.0))
    ant.cyl('dark', (0, top.y, PIV.z), (0, top.y + 0.16, PIV.z), 0.17, 0.15, 14)     # slip-ring / rotating head
    yb = top.y + BOOM_UP
    ant.box('paint', -0.1, 0.1, top.y + 0.1, yb + 0.05, PIV.z - 0.08, PIV.z + WING_OFF[1] + 0.08)   # the boom bracket
    ant.box('dark', -0.18, 0.18, yb - 0.25, yb - 0.05, PIV.z - 0.12, PIV.z + 0.12)                   # feed junction box
    wings, posts, yagis = [], [], []
    for side, off in ((1, WING_OFF[0]), (-1, WING_OFF[1])):
        hz = PIV.z + off
        hinge = Vector((0.0, yb, hz))
        w = Part(v, 'array_' + ('r' if side > 0 else 'l'), pivot=hinge, parent=ant,
                 joint=rot('y', 0.0, math.pi / 2, group='raise') if side > 0 else rot('y', -math.pi / 2, 0.0, stow=0.0, deploy=-math.pi / 2, group='raise'))
        # boom half: a square tube with a king-post truss above it
        end = side * (POSTS[-1] + 0.25)
        w.beam('paint', (side * 0.04, yb, hz), (end, yb, hz), 0.07, 0.07)
        w.beam('paint', (side * 0.1, yb + 0.02, hz), (side * 1.9, yb + 0.32, hz), 0.03, 0.03)
        w.beam('paint', (side * 1.9, yb + 0.32, hz), (end - side * 0.1, yb + 0.02, hz), 0.03, 0.03)
        w.beam('paint', (side * 1.9, yb, hz), (side * 1.9, yb + 0.32, hz), 0.025, 0.025)
        w.cyl('dark', (0, yb - 0.06, hz), (0, yb + 0.06, hz), 0.06, 0.06, 10)                      # hinge knuckle
        wp = [w]
        wings.append((w, side, wp))
        for i, px in enumerate(POSTS):
            pc = Vector((side * px, yb, hz))
            pst = Part(v, 'post_%s%d' % ('r' if side > 0 else 'l', i + 1), pivot=pc, parent=w, joint=rot('x', 0.0, math.pi / 2, group='raise'))
            pst.beam('paint', pc - Y * POST_H, pc + Y * POST_H, 0.05, 0.05)
            pst.box('dark', pc.x - 0.05, pc.x + 0.05, pc.y - 0.06, pc.y + 0.06, pc.z - 0.06, pc.z + 0.06)
            # feeder cables from the Yagis to the boom
            pst.tube('cable', [pc + Y * (POST_H - 0.05) + X * 0.04, pc + X * 0.05], 0.01, 4)
            pst.tube('cable', [pc - Y * (POST_H - 0.05) + X * 0.04, pc + X * 0.05], 0.01, 4)
            pp = [pst]
            for tb, s in (('t', 1), ('b', -1)):
                base = pc + Y * (s * POST_H)
                ya = Part(v, 'yagi_%s%d%s' % ('r' if side > 0 else 'l', i + 1, tb), pivot=base, parent=pst, joint=rot('z', 0.0, math.pi / 2, group='raise'))
                yagi(ya, base, (0, 0, -1), (1, 0, 0))
                pp.append(ya)
                yagis.append(ya)
            posts.append((pst, pp))
            wp.extend(pp)
    # ── fold into the rest (stowed) pose: undo the joints from the outermost in ──
    subtree = [mast, ant] + [q for (_, _, wp) in wings for q in wp]
    rot_parts(subtree, PIV, X, -math.pi / 2)                        # mast down (lying forward)
    for (w, side, wp) in wings:
        rot_parts(wp, w.pivot, Y, -math.pi / 2 if side > 0 else math.pi / 2)   # boom halves fold back along the mast
    for (pst, pp) in posts:
        rot_parts(pp, pst.pivot, X, -math.pi / 2)                     # posts turn: the Yagis lie along the boom
    for ya in yagis:
        rot_parts([ya], ya.pivot, Z, -math.pi / 2)                    # Yagis roll flat
    # the antenna's spin axis at rest: the mast's direction (forward)
    ant.joint = vkit.spinj([0, 0, -1], rpm=6.0)
    return mast


def build_body(v, b):
    ural.ural(v, b)
    z0, z1 = 3.43, 7.12
    top = ural.cargo_bed(b, z0, z1, hx=1.22, y0=URAL['bed'], y1=1.38, sides=0.5, skip_rear=False)
    ural.rear_fenders(b, 4.25, 6.85, y=URAL['bed'])
    ural.rear_end(b, URAL['len'])
    # the antenna transport boxes (dismounted array parts, cables) under a canvas cover
    b.box('canvas_green', -1.12, 1.12, 1.88, 2.56, 3.52, 6.2, bev=0.06)
    for z in (3.9, 4.6, 5.3, 6.0):
        b.tube('cable', [(-1.13, 1.9, z), (-1.13, 2.57, z), (1.13, 2.57, z), (1.13, 1.9, z)], 0.012, 4)
    # mast travel rest behind the cab: a portal with a padded saddle under the mast
    zr = 3.12
    for sx in (-1, 1):
        b.beam('paint', (sx * 0.5, 1.38, zr), (sx * 0.3, 2.78, zr), 0.08, 0.08)
    b.box('paint', -0.45, 0.45, 2.72, 2.79, zr - 0.08, zr + 0.08)
    b.box('rubber', -0.25, 0.25, 2.79, 2.8, zr - 0.07, zr + 0.07)
    # the mast hinge pedestal (an A-frame on the rear of the body) and its locking struts
    for sx in (-1, 1):
        b.beam('paint', (sx * 0.9, 1.38, 6.55), (sx * 0.3, PIV.y - 0.02, PIV.z), 0.1, 0.1)
        b.beam('paint', (sx * 0.9, 1.38, 7.08), (sx * 0.3, PIV.y - 0.02, PIV.z), 0.1, 0.1)
        b.box('dark', sx * 0.24, sx * 0.4, PIV.y - 0.12, PIV.y + 0.12, PIV.z - 0.14, PIV.z + 0.14)
    b.box('paint', -0.9, 0.9, 1.38, 1.5, 6.5, 7.1)
    # cable reels for the feeder and the guys, on the body side
    for z in (6.45,):
        for sx in (-1, 1):
            b.cyl('dark', (sx * 1.23, 1.66, z), (sx * 1.33, 1.66, z), 0.2, 0.2, 14)
            b.cyl('cable', (sx * 1.235, 1.66, z), (sx * 1.325, 1.66, z), 0.16, 0.16, 14)


def build_jack(v, name, x, z, top=1.3, foot=0.42):
    j = Part(v, name, pivot=(x, top, z), joint=slide('-y', foot, group='jack'))
    j.cyl('steel', (x, foot + 0.06, z), (x, top - 0.04, z), 0.05, 0.05, 8)
    j.cyl('dark', (x, foot, z), (x, foot + 0.06, z), 0.17, 0.15, 12)
    return j


def jack_housing(b, x, z, y0, y1):
    b.cyl('paint', (x, y0, z), (x, y1, z), 0.075, 0.075, 10)
    sx = 1 if x > 0 else -1
    b.box('dark', sx * 0.44, x + sx * 0.06, y1 - 0.12, y1 - 0.02, z - 0.07, z + 0.07)
    b.box('dark', sx * 0.44, x - sx * 0.06, y0 + 0.02, y0 + 0.1, z - 0.05, z + 0.05)


def make():
    vkit.setup_materials('red_green')
    v = Vehicle('p18', 'P-18 "Spoon Rest D" radar antenna vehicle (Ural-4320)', scheme='red_green')
    b = Part(v, 'body')
    build_body(v, b)
    build_array(v)
    for name, x, z in (('jack_fl', -1.3, 3.2), ('jack_fr', 1.3, 3.2), ('jack_rl', -1.3, 7.02), ('jack_rr', 1.3, 7.02)):
        jack_housing(b, x, z, 0.8, 1.3)
        build_jack(v, name, x, z, top=1.3, foot=0.42)
    return v

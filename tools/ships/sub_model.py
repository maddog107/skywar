# ═══════════════════════════════════════════════════════════════
# Submarines — scripted models for Blender (run headless):
#   blender -b -P tools/ships/sub_model.py -- <texdir> models/ships/ssn.glb ssn     (Virginia class, Block V)
#   blender -b -P tools/ships/sub_model.py -- <texdir> models/ships/ssgn.glb ssgn   (Ohio class SSGN)
# Game frame (shipkit.py): x starboard, y up, bow −z; y = 0 is the waterline at SURFACED trim. layout.periscopeDepth
# says how far to lower the boat (naval.js setDepth) so only the raised masts break the surface.
# Rig (tools/ships/RIG.md): vls_<n> missile-tube hatches (hinged), cell_<n> one empty per missile at the top of its
# tube (+Y = launch direction; cell.door = the hatch over it), mast_<name> (slide up out of the sail), hatch_escape
# (the lock-out / escape trunk hatch where a boat's crew goes below, hinged), hatch_entry (empty on the deck beside
# it: where the boat comes alongside), bridge (the cockpit at the top of the sail).
# References (metres; "x" = aft of the bow tip, heights above the keel): the Wikimedia drawings SSN774.svg and
# SSGN726_Ohio.svg scaled to the published lengths, CRS RL32418 and H I Sutton (Block V VPM), the Naval Submarine
# League (masts), and photographs (draft marks, trim, hatches, colours).
# ═══════════════════════════════════════════════════════════════
import bpy, math, sys, os, json
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shipkit import Part, material, srgb, smoothstep, lerp, clamp, add_text
from mathutils import Quaternion
import navkit as K

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
TEX = args[0] if len(args) > 0 else '/tmp/shiptex'
OUT = args[1] if len(args) > 1 else 'ssn.glb'
VARIANT = args[2] if len(args) > 2 else 'ssn'
FONT = next((p for p in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Black.ttf',
                         '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') if os.path.exists(p)), None)

VPM = 25.6   # the Block V Virginia Payload Module: a 25.6 m section inserted at x = 51.5 of the Block I–IV hull
def blk5(x):
    return x + VPM if x > 51.5 else x

CFG = {
    # Virginia class Block V (SSN-802 on): 140.5 m, Ø 10.36 m; surfaced ~8.8 m draught, 0.8° down by the stern
    'ssn': dict(
        L=140.5, R=5.18, draft_mid=8.78, trim=0.84, flat=0.30,
        prof=[(0.0, 0.0), (0.12, 0.85), (0.5, 1.6), (1, 2.1), (2, 2.8), (3, 3.2), (4, 3.5), (5, 3.8), (6, 4.0), (8, 4.3),
              (10, 4.5), (12, 4.7), (14, 4.9), (16, 5.06), (18, 5.18), (110.6, 5.18), (111.6, 5.08), (113.6, 5.03),
              (115.6, 4.87), (117.6, 4.76), (119.6, 4.52), (121.6, 4.29), (123.6, 3.90), (125.6, 3.49), (127.6, 3.1),
              (132.6, 1.96), (135.2, 1.5), (137.4, 1.05), (139.4, 0.5)],
        tail=140.5, prop=dict(kind='pumpjet', x0=135.2, x1=139.4, r0=2.875, r1=2.15),
        sail=dict(x0=21.3, x1=31.0, top=15.85, w=1.8, fillet_x=17.9, fillet_h=2.5, fillet_w=2.5, planes=None),
        masts=[  # (name, x from the bow, y (starboard +), raised above the sail top (m), kind)
            ('radar', 22.6, 0.0, 2.5, 'radar'),
            ('periscope_1', 24.5, -0.38, 5.1, 'photonics'),
            ('periscope_2', 25.0, 0.38, 5.0, 'photonics'),
            ('comms', 26.0, 0.3, 5.8, 'comms'),
            ('hdr', 26.8, -0.25, 5.7, 'hdr'),
            ('esm', 27.6, 0.25, 4.8, 'esm'),
            ('snorkel', 28.4, 0.0, 3.4, 'snorkel'),
        ],
        tubes=[  # (x, y, tube Ø, hatch Ø, cells, hinge side 'fwd'|'aft'|'port'|'stbd')
            (11.0, 0.0, 2.21, 2.6, 6, 'fwd'), (14.0, 0.0, 2.21, 2.6, 6, 'aft'),               # Virginia Payload Tubes
            (60.5, 0.0, 2.21, 2.75, 7, 'port'), (63.8, 0.0, 2.21, 2.75, 7, 'port'),              # Virginia Payload Module
            (67.1, 0.0, 2.21, 2.75, 7, 'port'), (70.4, 0.0, 2.21, 2.75, 7, 'port')],
        hump=dict(x0=59.0, x1=73.5, h=1.0, w=3.6),
        stern=dict(kind='virginia', te_upper=blk5(106.4), upper_top=12.5, root_upper=3.65, tip_upper=2.65,
                   lower_depth=3.2, planes=(blk5(100.8), blk5(105.7)), span=11.5, canted=(blk5(99.0), 4.4, 2.9)),
        escape_x=35.5, access_x=48.9, aft_escape_x=blk5(76.5), towed=True, antifoul=False,
        draft_marks=[(10.0, (24, 26, 28)), (22.5, (26, 28, 30))], waa=[42.0, 82.0, 100.0],
        bow_planes=(15.3, 18.0), periscope_keel=18.2),
    # Ohio class SSGN (SSGN-726…729): 170.7 m, Ø 12.8 m, 11.0 m draught (level); 7-blade propeller
    'ssgn': dict(
        L=170.7, R=6.4, draft_mid=11.0, trim=0.0, flat=0.25,
        prof=[(0.0, 0.0), (0.15, 1.1), (0.7, 2.0), (2, 3.0), (4, 4.0), (6, 4.7), (8, 5.1), (10, 5.4), (12, 5.7), (14, 5.9),
              (16, 6.07), (18, 6.21), (20, 6.31), (21.5, 6.4), (121.0, 6.4), (130, 6.15), (140, 5.64), (150, 4.61),
              (160, 2.91), (165.5, 1.8), (168.3, 1.1), (169.6, 0.75)],
        tail=170.7, prop=dict(kind='prop', x=169.3, dia=7.6, blades=7),
        sail=dict(x0=31.8, x1=41.3, top=20.5, w=2.0, fillet_x=30.4, fillet_h=1.2, fillet_w=2.4,
                  planes=dict(x0=33.1, x1=37.6, z=17.6, span=11.5)),
        masts=[
            ('periscope_1', 33.3, -0.35, 6.2, 'periscope'),
            ('periscope_2', 34.3, 0.35, 6.2, 'periscope'),
            ('esm', 35.6, 0.0, 5.6, 'esm'),
            ('comms', 36.8, -0.35, 5.8, 'comms'),
            ('radar', 37.9, 0.35, 4.2, 'radar'),
            ('snorkel', 39.6, 0.0, 3.6, 'snorkel'),
        ],
        # 2 rows of 12 tubes, pitch 3.24 m; tubes 1-2 are the SOF lock-out chambers (no missiles); hatches hinge outboard
        tubes=[(53.7 + 3.24 * i, sg * 1.8, 2.21, 2.9, 0 if i == 0 else 7, 'stbd' if sg > 0 else 'port') for i in range(12) for sg in (-1, 1)],
        casing=dict(table=[(12.0, 12.2), (14.0, 12.71), (18.0, 13.17), (22.0, 13.52), (26.0, 13.82), (30.0, 14.0), (31.8, 14.1),
                           (110.0, 14.49), (115.0, 14.27), (120.0, 14.0), (125.0, 13.6), (130.0, 12.95), (135.0, 12.6)],
                    w_top=6.8),
        stern=dict(kind='ohio', te=165.5, root=5.3, tip=4.5, span=12.8, end_chord=4.5, end_h=4.6),
        escape_x=28.0, access_x=46.0, aft_escape_x=100.0, towed=False, antifoul=True,
        draft_marks=[(23.0, (32, 34, 36)), (31.0, (34, 36, 38))], waa=[],
        bow_planes=None, periscope_keel=22.6),
}
C = CFG[VARIANT]
L, R = C['L'], C['R']
BOW = -L / 2
def Z(x):
    """x (metres aft of the bow tip) → game z"""
    return BOW + x
KEEL_Y = -C['draft_mid']            # at mid-length (the trim turns the whole boat about the origin)
AXIS_Y = KEEL_Y + R
def ZH(h):
    """height above the keel → game y (level frame)"""
    return KEEL_Y + h
TILE = 0.8 * 16                     # metres per repeat of sub_tiles.jpg (16 tiles of ~0.8 m)

bpy.ops.wm.read_factory_settings(use_empty=True)
material('SubHull', srgb(0xffffff), 0.0, 0.62, image=os.path.join(TEX, 'sub_tiles.jpg'))
material('SubRed', srgb(0x4a2521), 0.0, 0.75)
material('SubDark', srgb(0x0e1011), 0.05, 0.55)
material('SubSteel', srgb(0x2b2e31), 0.3, 0.5)
material('Glass', srgb(0x1a2631), 0.5, 0.12)
material('White', srgb(0xd8d8d0), 0.05, 0.5)
material('Mast', srgb(0x1c1f22), 0.2, 0.55)
material('Radome', srgb(0x2a2d30), 0.05, 0.6)
material('Canister', srgb(0x4a4f52), 0.2, 0.6)
material('Prop', srgb(0x6a5a3a), 0.85, 0.35)
material('NavRed', srgb(0xff2020), 0.0, 0.5, emit=srgb(0xff2020), emit_strength=5.0)
material('NavGreen', srgb(0x20ff50), 0.0, 0.5, emit=srgb(0x20ff50), emit_strength=5.0)
material('NavWhite', srgb(0xffffff), 0.0, 0.5, emit=srgb(0xfff4e0), emit_strength=5.0)

# ═════════════ radius profile: monotone cubic (PCHIP) through the table ═════════════
PX = [p[0] for p in C['prof']]
PR = [p[1] for p in C['prof']]
def _pchip_slopes(xs, ys):
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    return m
PM = _pchip_slopes(PX, PR)
def radius(x):
    """hull radius at x metres aft of the bow tip"""
    if x <= PX[0]:
        return 0.0
    if x >= PX[-1]:
        return PR[-1]
    i = max(k for k in range(len(PX) - 1) if PX[k] <= x)
    h = PX[i + 1] - PX[i]
    t = (x - PX[i]) / h
    h00, h10, h01, h11 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
    return h00 * PR[i] + h10 * h * PM[i] + h01 * PR[i + 1] + h11 * h * PM[i + 1]

FLAT_Y = AXIS_Y + R - C['flat']     # the walking deck (on the parallel midbody)
def top_y(x):
    r = radius(x)
    return AXIS_Y + min(r, R - C['flat'] * smoothstep(R * 0.9, R, r))
def hull_y(xs, x):
    """hull surface height above (xs across, x along)"""
    r = radius(x)
    return min(AXIS_Y + math.sqrt(max(r * r - xs * xs, 0.0)), top_y(x))

S = Part(VARIANT + '_static')

# ═════════════ hull: body of revolution, flat walking deck, the waterline split (antifouling on the Ohio) ═════════════
mid_end = max(p for p, r in C['prof'] if abs(r - R) < 1e-6)
xs_st = [0.0, 0.06, 0.12, 0.25, 0.5, 0.8, 1.2, 1.7, 2.3, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.5, 11.0, 12.5, 14.0, 15.5, 17.0, 18.5, 20.0]
x = 22.0
while x < mid_end - 1e-6:
    xs_st.append(x)
    x += 3.5
xs_st.append(mid_end)
x = mid_end
while x < PX[-1] - 1e-6:
    x = min(PX[-1], x + 1.6)
    xs_st.append(x)
xs_st = sorted(set(round(v, 3) for v in xs_st))
NT = 44
A_W = None
if C['antifoul']:
    A_W = math.asin(-AXIS_Y / R)      # where the level waterline cuts the midbody ring
def ring(x):
    r = radius(x)
    angles = [-math.pi / 2 + 2 * math.pi * i / NT for i in range(NT + 1)]
    if A_W is not None:
        # nudge the two nearest ring vertices onto the waterline so the paint line runs straight
        for aw in (A_W, math.pi - A_W):
            if r > abs(AXIS_Y) + 0.05:
                aw_here = math.asin(max(-1.0, min(1.0, -AXIS_Y / r)))
                aw_here = aw_here if aw == A_W else math.pi - aw_here
                i = min(range(1, NT), key=lambda i: abs(angles[i] - aw_here))
                angles[i] = aw_here
    out = []
    for a in angles:
        xx, yy = r * math.cos(a), r * math.sin(a)
        yy = min(yy, top_y(x) - AXIS_Y)
        out.append((xx, AXIS_Y + yy, Z(x), r * (a + math.pi / 2)))
    return out
rings = [ring(x) for x in xs_st]
for k in range(len(rings) - 1):
    A, B = rings[k], rings[k + 1]
    for i in range(NT):
        q = [A[i], A[i + 1], B[i + 1], B[i]]
        uv = [(p[2] / TILE, p[3] / TILE) for p in q]
        cx = sum(p[0] for p in q) / 4; cy = sum(p[1] for p in q) / 4
        mat = 'SubRed' if C['antifoul'] and cy < -0.01 else 'SubHull'
        S.g(mat).face([p[:3] for p in q], uv if mat == 'SubHull' else None, (cx, cy - AXIS_Y, 0), True)

# waterline outline (surfaced, with the trim) for the game's foam line
th = math.radians(C['trim'])
wl = []
for x in xs_st:
    z = Z(x)
    y_lvl = z * math.tan(th)                 # the level-frame height the trimmed waterline passes through here
    r = radius(x)
    dy = y_lvl - AXIS_Y
    if r > abs(dy):
        wl.append((round(math.sqrt(r * r - dy * dy), 2), round(z, 2)))
waterline = wl + [(-x, z) for x, z in reversed(wl)]

# ═════════════ propulsor ═════════════
P_ = C['prop']
if P_['kind'] == 'pumpjet':
    x0, x1 = P_['x0'], P_['x1']
    n = 36
    def shroud_ring(x, r):
        return [(r * math.cos(2 * math.pi * i / n), AXIS_Y + r * math.sin(2 * math.pi * i / n), Z(x)) for i in range(n)]
    o0, o1 = shroud_ring(x0 + 0.5, P_['r0']), shroud_ring(x1, P_['r1'])
    i0, i1 = shroud_ring(x0 + 0.5, P_['r0'] - 0.42), shroud_ring(x1, P_['r1'] - 0.12)
    lip = shroud_ring(x0, P_['r0'] - 0.22)
    for i in range(n):
        j = (i + 1) % n
        c = (math.cos(2 * math.pi * (i + 0.5) / n), math.sin(2 * math.pi * (i + 0.5) / n))
        S.g('SubHull').face([o0[i], o0[j], o1[j], o1[i]], [(p[2] / TILE, i * 0.5 / TILE) for p in (o0[i], o0[j], o1[j], o1[i])], (c[0], c[1], 0.3), True)
        S.g('SubDark').face([i0[j], i0[i], i1[i], i1[j]], None, (-c[0], -c[1], 0), True)
        S.g('SubHull').face([lip[i], lip[j], o0[j], o0[i]], [(0, 0)] * 4, (c[0], c[1], -1), True)
        S.g('SubHull').face([lip[j], lip[i], i0[i], i0[j]], [(0, 0)] * 4, (-c[0], -c[1], -1), True)
        S.g('SubDark').face([o1[i], o1[j], i1[j], i1[i]], None, (0, 0, 1))
    # stator vanes from the hull to the shroud, the hub cone
    for k in range(11):
        a = 2 * math.pi * (k + 0.25) / 11
        xa = x0 + 0.9
        ra = radius(xa)
        S.beam('SubDark', (ra * math.cos(a), AXIS_Y + ra * math.sin(a), Z(xa)),
               ((P_['r0'] - 0.45) * math.cos(a + 0.12), AXIS_Y + (P_['r0'] - 0.45) * math.sin(a + 0.12), Z(xa + 0.6)), 0.7, 0.07)
    S.cyl('SubSteel', (0, AXIS_Y, 0), radius(PX[-1]), 0.08, Z(PX[-1]), Z(C['tail']), 16, cap0=True, axis='z')
else:
    # open 7-blade skewed propeller on its hub
    xh = P_['x']
    S.cyl('Prop', (0, AXIS_Y, 0), 0.95, 0.8, Z(xh - 0.9), Z(xh + 0.6), 16, axis='z')
    S.cyl('Prop', (0, AXIS_Y, 0), 0.8, 0.1, Z(xh + 0.6), Z(C['tail']), 16, cap0=False, axis='z')
    Rp = P_['dia'] / 2
    nb = P_['blades']
    for b in range(nb):
        a0 = 2 * math.pi * b / nb
        secs = []                                   # sections from the root to the tip, skewed back, twisted
        for k in range(7):
            t = k / 6
            rr = lerp(0.85, Rp, t)
            skew = math.radians(38) * t ** 1.6
            chord = lerp(1.0, 1.35, math.sin(math.pi * min(t, 0.85) / 1.7)) * (1 - 0.8 * t ** 6)
            pitch = math.radians(lerp(52, 24, t))
            a = a0 + skew
            cx, cy = rr * math.cos(a), rr * math.sin(a)
            tx, ty = -math.sin(a), math.cos(a)
            dz = chord / 2 * math.cos(pitch)
            dt = chord / 2 * math.sin(pitch)
            secs.append(((cx - tx * dt, AXIS_Y + cy - ty * dt, Z(xh) - dz), (cx + tx * dt, AXIS_Y + cy + ty * dt, Z(xh) + dz)))
        for (a, b2), (c2, d) in zip(secs, secs[1:]):
            S.g('Prop').face([a, b2, d, c2], None, (0, 0, -1))
            S.g('Prop').face([a, c2, d, b2], None, (0, 0, 1))

# ═════════════ stern control surfaces ═════════════
def fin(x_le_root, x_te_root, x_le_tip, x_te_tip, root, tip, t_root=0.5, t_tip=0.25):
    """a control surface between a root and a tip point (across, up) in the section plane, chord along the hull"""
    (xr, yr), (xt, yt) = root, tip
    dx, dy = xt - xr, yt - yr
    ln = math.hypot(dx, dy)
    nx, ny = -dy / ln, dx / ln
    def P(x, y, xx, s):
        return (x + nx * s, y + ny * s, Z(xx))
    for s in (1, -1):
        q = [P(xr, yr, x_le_root, s * t_root * 0.5), P(xr, yr, x_te_root, s * 0.03), P(xt, yt, x_te_tip, s * 0.03), P(xt, yt, x_le_tip, s * t_tip * 0.5)]
        S.g('SubHull').face(q, [(p[2] / TILE, (p[0] + p[1]) / TILE) for p in q], (nx * s, ny * s, 0))
    S.g('SubHull').face([P(xr, yr, x_le_root, t_root * 0.5), P(xt, yt, x_le_tip, t_tip * 0.5), P(xt, yt, x_le_tip, -t_tip * 0.5), P(xr, yr, x_le_root, -t_root * 0.5)], [(0, 0)] * 4, (0, 0, -1))
    S.g('SubHull').face([P(xt, yt, x_le_tip, t_tip * 0.5), P(xt, yt, x_te_tip, 0.03), P(xt, yt, x_te_tip, -0.03), P(xt, yt, x_le_tip, -t_tip * 0.5)], [(0, 0)] * 4, (dx, dy, 0))

def pod(x_across, y, xa, xb, r):
    """streamlined tip pod along the hull direction"""
    S.cyl('SubHull', (x_across, y, 0), 0.05, r, Z(xa), Z(xa + (xb - xa) * 0.25), 10, axis='z', cap0=False)
    S.cyl('SubHull', (x_across, y, 0), r, r * 0.55, Z(xa + (xb - xa) * 0.25), Z(xb), 10, axis='z')

st = C['stern']
if st['kind'] == 'virginia':
    te = st['te_upper']
    fin(te - st['root_upper'] - 0.4, te, te - st['tip_upper'], te, (0, hull_y(0, te - 1.8) - 0.3), (0, ZH(st['upper_top'])), 0.55, 0.3)
    fin(te - st['root_upper'] - 0.2, te, te - st['tip_upper'] + 0.2, te, (0, AXIS_Y - radius(te - 1.8) + 0.3), (0, AXIS_Y - radius(te - 1.8) - st['lower_depth']), 0.55, 0.3)
    p0, p1 = st['planes']
    cx0, ch_root, ch_tip = st['canted']
    for sg in (1, -1):
        rr = radius((p0 + p1) / 2)
        fin(p0, p1, p0 + 0.9, p1, (sg * (rr - 0.3), AXIS_Y), (sg * st['span'] / 2, AXIS_Y), 0.55, 0.3)
        pod(sg * st['span'] / 2, AXIS_Y, p0 - 0.4, p1 + 0.6, 0.34)
        # canted stabiliser below it (~40° down) with its own tip pod (towed-array fairlead)
        a = math.radians(40)
        rr2 = radius(cx0 + 2.0)
        root_pt = (sg * rr2 * math.cos(a) * 0.93, AXIS_Y - rr2 * math.sin(a) * 0.93)
        tip_pt = (sg * (rr2 + 3.0) * math.cos(a), AXIS_Y - (rr2 + 3.0) * math.sin(a))
        fin(cx0, cx0 + ch_root, cx0 + (ch_root - ch_tip), cx0 + ch_root, root_pt, tip_pt, 0.45, 0.25)
        pod(tip_pt[0], tip_pt[1], cx0 + 0.8, cx0 + ch_root + 0.5, 0.26)
else:
    te = st['te']
    xm = te - st['root'] * 0.5
    fin(te - st['root'], te, te - st['tip'], te, (0, hull_y(0, xm) - 0.3), (0, ZH(12.74)), 0.6, 0.35)
    fin(te - st['root'], te, te - st['tip'], te, (0, AXIS_Y - radius(xm) + 0.3), (0, ZH(0.0)), 0.6, 0.35)
    for sg in (1, -1):
        rr = radius(xm)
        fin(te - st['root'], te, te - st['tip'], te, (sg * (rr - 0.3), AXIS_Y), (sg * st['span'] / 2, AXIS_Y), 0.6, 0.35)
        xe = sg * st['span'] / 2
        fin(te - st['end_chord'], te, te - st['end_chord'] + 0.6, te, (xe, AXIS_Y - st['end_h'] / 2), (xe, AXIS_Y + st['end_h'] / 2), 0.3, 0.2)

# ═════════════ sail, its fillet, fairwater planes ═════════════
SA = C['sail']
SX0, SX1, SW = SA['x0'], SA['x1'], SA['w']
SAIL_TOP = ZH(SA['top'])
base_y = hull_y(0, (SX0 + SX1) / 2) - 0.35
def sail_outline():
    """plan outline (across, x from the bow): semicircular nose, parallel sides, a rounded blunt tail"""
    n = 12
    nose = [(SW / 2 * math.cos(math.pi * i / n), SX0 + SW / 2 - SW / 2 * math.sin(math.pi * i / n)) for i in range(n + 1)]
    tail_c = SX1 - SW * 0.35
    tail = [(-SW / 2 * (1 - (i / 6) ** 2 * 0.55), tail_c + SW * 0.35 * math.sin(math.pi / 2 * i / 6)) for i in range(7)]
    tail += [(-p[0], p[1]) for p in reversed(tail)]
    return nose + tail
outline = sail_outline()
top_pts = [(x, SAIL_TOP, Z(xf)) for x, xf in outline]
bot_pts = [(x, base_y, Z(xf)) for x, xf in outline]
n = len(outline)
xmid = (SX0 + SX1) / 2
for i in range(n):
    j = (i + 1) % n
    q = [bot_pts[i], bot_pts[j], top_pts[j], top_pts[i]]
    mx = (outline[i][0] + outline[j][0]) / 2
    mz = (outline[i][1] + outline[j][1]) / 2 - xmid
    S.g('SubHull').face(q, [(p[2] / TILE, p[1] / TILE) for p in q], (mx, 0, mz * 0.3), True)
S.g('SubHull').face(top_pts, [(p[2] / TILE, p[0] / TILE) for p in top_pts], (0, 1, 0))
# the fillet: a concave fairing from the deck (starting at fillet_x) up the sail's leading edge
FX, FH, FW = SA['fillet_x'], SA['fillet_h'], SA['fillet_w']
def FP(a, h):
    """a = 0 (starboard) … π (port) round the leading edge, h = 0 on the deck … 1 on the sail face"""
    ext = (SX0 - FX) * (1 - h) ** 2.2
    wid = SW / 2 + (FW / 2 - SW / 2) * (1 - h) ** 2.2
    x = wid * math.cos(a)
    xf = SX0 + SW / 2 - (SW / 2 + ext) * math.sin(a)
    y = lerp(hull_y(x, xf) - 0.06, hull_y(0, SX0) + FH, h ** 1.4)
    return (x, y, Z(xf))
for k in range(12):
    a0, a1 = math.pi * k / 12, math.pi * (k + 1) / 12
    for hh in range(5):
        h0, h1 = hh / 5, (hh + 1) / 5
        q = [FP(a0, h0), FP(a1, h0), FP(a1, h1), FP(a0, h1)]
        S.g('SubHull').face(q, [(p[2] / TILE, p[1] / TILE) for p in q], (math.cos((a0 + a1) / 2), 0.5, -math.sin((a0 + a1) / 2)), True)
if SA['planes']:
    pl = SA['planes']
    for sg in (1, -1):
        fin(pl['x0'], pl['x1'], pl['x0'] + 0.5, pl['x1'] - 0.2, (sg * SW / 2 * 0.95, ZH(pl['z'])), (sg * pl['span'] / 2, ZH(pl['z'])), 0.5, 0.3)
# bridge cockpit at the top front of the sail, the mast openings, nav lights, draft marks
S.box('SubDark', -SW / 2 + 0.2, SW / 2 - 0.2, SAIL_TOP - 0.02, SAIL_TOP + 0.01, Z(SX0 + 0.5), Z(SX0 + 2.1))
for (nm, xm, ym, travel, kind) in C['masts']:
    r = 0.3 if kind in ('photonics', 'periscope', 'hdr') else 0.62 if kind == 'snorkel' else 0.24
    S.cyl('SubDark', (ym, 0, Z(xm)), r + 0.05, r + 0.05, SAIL_TOP - 0.01, SAIL_TOP + 0.012, 12, cap0=False)
S.box('NavWhite', -0.1, 0.1, SAIL_TOP + 0.02, SAIL_TOP + 0.26, Z(SX0 + 0.25), Z(SX0 + 0.42))
S.box('NavRed', -SW / 2 - 0.02, -SW / 2 + 0.02, SAIL_TOP - 0.9, SAIL_TOP - 0.62, Z(SX0 + 1.2), Z(SX0 + 1.55))
S.box('NavGreen', SW / 2 - 0.02, SW / 2 + 0.02, SAIL_TOP - 0.9, SAIL_TOP - 0.62, Z(SX0 + 1.2), Z(SX0 + 1.55))
if FONT:
    for (xm, nums) in C['draft_marks']:
        for sg in (1, -1):
            for ft in nums:
                y = ZH(ft * 0.3048)
                if y > top_y(xm) - 0.3:
                    continue
                dy = y - AXIS_Y
                r = radius(xm)
                if r <= abs(dy):
                    continue
                xs = math.sqrt(r * r - dy * dy) + 0.02
                ex = (0, 0, -1) if sg > 0 else (0, 0, 1)
                add_text(S, 'White', str(ft), 0.16, FONT, (sg * xs, y, Z(xm)), ex, (0, 1, 0), (sg, 0, 0), 0.01)

# ═════════════ deck: safety track, cleats, hatches with rescue markings, towed-array conduit ═════════════
x_a, x_b = 18.5, mid_end - 6.0
S.box('SubSteel', -0.06, 0.06, FLAT_Y - 0.01, FLAT_Y + 0.025, Z(x_a), Z(SX0 - 3.0))
S.box('SubSteel', -0.06, 0.06, FLAT_Y - 0.01, FLAT_Y + 0.025, Z(SX1 + 0.5), Z(x_b))
for xx in list(range(int(x_a + 2), int(SX0 - 3), 8)) + list(range(int(SX1 + 3), int(x_b), 9)):
    for sg in (1, -1):
        S.box('SubSteel', sg * 1.2 - 0.14, sg * 1.2 + 0.14, FLAT_Y, FLAT_Y + 0.07, Z(xx) - 0.25, Z(xx) + 0.25)
def deck_hatch_ring(xh, r=0.55, sunburst=True, y=None):
    y = top_y(xh) if y is None else y
    S.cyl('SubSteel', (0, 0, Z(xh)), r + 0.1, r + 0.1, y - 0.02, y + 0.03, 16)
    if sunburst:
        for k in range(12):
            a = 2 * math.pi * k / 12
            p0 = (math.cos(a) * (r + 0.25), y + 0.035, Z(xh) + math.sin(a) * (r + 0.25))
            p1 = (math.cos(a) * (r + 0.95), y + 0.035, Z(xh) + math.sin(a) * (r + 0.95))
            S.beam('White', p0, p1, 0.1, 0.012, caps=False)
deck_hatch_ring(C['escape_x'])
deck_hatch_ring(C['access_x'], 0.45, False)
S.cyl('SubSteel', (0, 0, Z(C['access_x'])), 0.45, 0.43, top_y(C['access_x']) + 0.03, top_y(C['access_x']) + 0.12, 14)
if C['towed']:
    # half-round towed-array conduit along the upper starboard side, sail → stern
    a = math.radians(38)
    pts = []
    for xx in [SX1 + 2.0 + i * 4.0 for i in range(int((PX[-1] - 8 - SX1) / 4))]:
        r = radius(xx)
        pts.append((r * math.cos(a) + 0.05, AXIS_Y + r * math.sin(a), Z(xx)))
    K.sweep_tube(S, pts, 0.45, 'SubHull', n=10, cap=True)
for xc in C['waa']:
    for sg in (1, -1):
        a0, a1 = math.radians(-20), math.radians(10)
        pts = []
        for (a, xx) in ((a0, xc - 3.0), (a0, xc + 3.0), (a1, xc + 3.0), (a1, xc - 3.0)):
            rr = radius(xx) + 0.1
            pts.append((sg * rr * math.cos(a), AXIS_Y + rr * math.sin(a), Z(xx)))
        S.g('SubDark').face(pts, None, (sg, 0, 0))
if C['bow_planes']:
    b0, b1 = C['bow_planes']
    for sg in (1, -1):
        yc = AXIS_Y + 1.7                      # the retracted bow plane's lens-shaped recess on the hull side
        upper = []
        lower = []
        for k in range(10):
            t = k / 9
            xx = lerp(b0 - 0.4, b1 + 0.4, t)
            hh = 0.78 * math.sin(math.pi * t)
            r = radius(xx)
            for (lst, yy) in ((upper, yc + hh), (lower, yc - hh)):
                dy = yy - AXIS_Y
                lst.append((sg * (math.sqrt(max(r * r - dy * dy, 0)) + 0.025), yy, Z(xx)))
        S.g('SubDark').face(upper + lower[::-1], None, (sg, 0, 0))

# ═════════════ Block V VPM hump / Ohio casing over the missile tubes ═════════════
def casing(tab, w_top, xa, xb, step=1.0):
    """raised deck casing: top at height tab(x) above the keel, flat top w_top wide, sides sloping to the hull"""
    def ht(x):
        for (x0, h0), (x1, h1) in zip(tab, tab[1:]):
            if x0 <= x <= x1:
                return lerp(h0, h1, (x - x0) / (x1 - x0))
        return tab[-1][1] if x > tab[-1][0] else tab[0][1]
    xsq = []
    x = xa
    while x < xb:
        xsq.append(x)
        x += step
    xsq.append(xb)
    prev = None
    for x in xsq:
        yt = ZH(ht(x))
        r = radius(x)
        wt = w_top / 2 * smoothstep(-0.05, 0.5, yt - top_y(x))
        xs_side = min(wt + 1.4, r * 0.97)
        ys = AXIS_Y + math.sqrt(max(r * r - xs_side * xs_side, 0.0))
        cur = [(xs_side, ys, Z(x)), (wt, yt, Z(x)), (-wt, yt, Z(x)), (-xs_side, ys, Z(x))]
        if prev:
            for i in range(3):
                q = [prev[i], cur[i], cur[i + 1], prev[i + 1]]
                nrm = (1, 1, 0) if i == 0 else (0, 1, 0) if i == 1 else (-1, 1, 0)
                S.g('SubHull').face(q, [(p[2] / TILE, p[0] / TILE) for p in q], nrm, i != 1)
        prev = cur
    return ht
if C.get('hump'):
    hp = C['hump']
    base = 10.36 - C['flat']
    tab = [(hp['x0'] - 3.0, base), (hp['x0'], base + hp['h']), (hp['x1'], base + hp['h']), (hp['x1'] + 4.0, base)]
    ht = casing(tab, hp['w'], hp['x0'] - 3.0, hp['x1'] + 4.0, 0.5)
elif C.get('casing'):
    cs = C['casing']
    ht = casing(cs['table'], cs['w_top'], cs['table'][0][0], cs['table'][-1][0], 1.2)
def tube_top(x):
    return ZH(ht(x)) if (C.get('hump') or C.get('casing')) else top_y(x)
deck_hatch_ring(C['aft_escape_x'], y=max(tube_top(C['aft_escape_x']), top_y(C['aft_escape_x'])))

# ═════════════ missile tubes: rims, bores, canister tops (static) ═════════════
def mac_offsets(ncells, tr):
    if ncells not in (6, 7):
        return []
    offs = [(0.62 * tr * math.cos(2 * math.pi * i / 6 + math.pi / 6), 0.62 * tr * math.sin(2 * math.pi * i / 6 + math.pi / 6)) for i in range(6)]
    return ([(0.0, 0.0)] + offs) if ncells == 7 else offs
for (xt, yt, tube_d, hatch_d, ncells, side) in C['tubes']:
    y = tube_top(xt) + 0.01
    zc = Z(xt)
    tr = tube_d / 2
    S.cyl('SubSteel', (yt, 0, zc), hatch_d / 2 + 0.06, hatch_d / 2 + 0.06, y - 0.25, y + 0.02, 22, cap0=False)
    S.cyl('SubDark', (yt, 0, zc), tr, tr, y - 0.9, y + 0.015, 22, cap1=False)
    S.cyl('Canister', (yt, 0, zc), tr - 0.03, tr - 0.03, y - 0.9, y - 0.72, 22, cap0=False)
    for (ox, oz) in mac_offsets(ncells, tr):
        S.cyl('SubSteel', (yt + ox, 0, zc + oz), 0.3, 0.3, y - 0.72, y - 0.68, 10, cap0=False)

# ═════════════ root (with the surfaced trim) ═════════════
root = bpy.data.objects.new(VARIANT, None)
bpy.context.collection.objects.link(root)
if C['trim']:
    root.rotation_mode = 'QUATERNION'
    root.rotation_quaternion = Quaternion(K.V((1, 0, 0)).normalized(), math.radians(C['trim']))   # stern down
S.build(parent=root, sharp_deg=40)

# ═════════════ Rig: missile-tube hatches and one cell per missile ═════════════
def tube_hatch_mesh(d, name):
    """a domed circular hatch: hinge along local x at the origin, the disc towards +z"""
    r = d / 2
    p = Part(name)
    n = 22
    ring0 = [(r * math.cos(2 * math.pi * i / n), 0.03, r + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    ring1 = [(0.82 * r * math.cos(2 * math.pi * i / n), 0.17, r + 0.82 * r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        q = [ring0[i], ring0[j], ring1[j], ring1[i]]
        p.g('SubHull').face(q, [(v[0] / TILE, v[2] / TILE) for v in q], (ring0[i][0], 0.5, ring0[i][2] - r), True)
    p.g('SubHull').face(ring1, [(v[0] / TILE, v[2] / TILE) for v in ring1], (0, 1, 0))
    p.g('SubHull').face(ring0[::-1], [(0, 0)] * n, (0, -1, 0))
    for sx in (-r * 0.45, r * 0.45):
        p.box('SubHull', sx - 0.12, sx + 0.12, 0.0, 0.12, -0.12, 0.22)
    return p.mesh(origin=(0, 0, 0))

HINGE = {   # hinge side → (hinge point from the tube centre (across, along), rotation so local +z runs across the disc)
    'fwd': lambda r: ((0.0, -r), None),
    'aft': lambda r: ((0.0, r), ((0, 1, 0), math.pi)),
    'port': lambda r: ((-r, 0.0), ((0, 1, 0), math.pi / 2)),
    'stbd': lambda r: ((r, 0.0), ((0, 1, 0), -math.pi / 2)),
}
cell_no, tube_no = 1, 1
meshes = {}
for (xt, yt, tube_d, hatch_d, ncells, side) in C['tubes']:
    key = round(hatch_d, 2)
    if key not in meshes:
        meshes[key] = tube_hatch_mesh(hatch_d, 'tube_hatch_%d' % len(meshes))
    y = tube_top(xt) + 0.01
    zc = Z(xt)
    (hx, hz), rot = HINGE[side](hatch_d / 2)
    open_ang = -1.62 if side in ('port', 'stbd') else -1.95     # side hatches stand upright (~93°), end hatches flip over
    K.rig_node('vls_%d' % tube_no, meshes[key], (yt + hx, y, zc + hz), root, rot, {'t': 'door', 'hinge': [1, 0, 0], 'open': open_ang})
    for (ox, oz) in mac_offsets(ncells, tube_d / 2):
        K.point('cell_%d' % cell_no, (yt + ox, y - 0.7, zc + oz), root, None, t='cell', door='vls_%d' % tube_no, depth=6.4)
        cell_no += 1
    tube_no += 1

# ═════════════ Rig: masts ═════════════
def mast_part(nm, xm, ym, kind):
    """a mast built stowed (its head just under the sail top); returns the part and its origin (the head)"""
    P = Part('mast_' + nm)
    z = Z(xm)
    y1 = SAIL_TOP - 0.1
    dx = ym
    if kind in ('photonics', 'periscope'):
        P.cyl('Mast', (dx, 0, z), 0.22, 0.22, y1 - 8.0, y1 - 1.1, 14)
        if kind == 'photonics':                   # AN/BVS-1: a sensor pod with windows
            P.cyl('Mast', (dx, 0, z), 0.24, 0.22, y1 - 1.1, y1 - 0.12, 14)
            P.sphere('Mast', (dx, y1 - 0.12, z), 0.22, 0.1, 0.22, 14, 4, v0=0.5, v1=1.0)
            P.box('Glass', dx - 0.15, dx + 0.15, y1 - 0.75, y1 - 0.45, z - 0.25, z - 0.22)
            P.box('Glass', dx - 0.08, dx + 0.08, y1 - 0.38, y1 - 0.24, z - 0.24, z - 0.21)
        else:                                     # optical periscope: a tapering tube with the head window
            P.cyl('Mast', (dx, 0, z), 0.24, 0.13, y1 - 1.1, y1, 12)
            P.box('Glass', dx - 0.07, dx + 0.07, y1 - 0.45, y1 - 0.25, z - 0.2, z - 0.15)
    elif kind == 'hdr':                           # SubHDR SATCOM: a bulb radome on its mast
        P.cyl('Mast', (dx, 0, z), 0.2, 0.2, y1 - 8.0, y1 - 0.9, 12)
        P.sphere('Radome', (dx, y1 - 0.45, z), 0.3, 0.45, 0.3, 14, 8)
    elif kind == 'esm':                           # AN/BLQ-10 ESM: stacked cylindrical radome
        P.cyl('Mast', (dx, 0, z), 0.18, 0.18, y1 - 8.0, y1 - 1.6, 10)
        P.cyl('Radome', (dx, 0, z), 0.19, 0.19, y1 - 1.6, y1 - 0.2, 12)
        P.cyl('Radome', (dx, 0, z), 0.19, 0.08, y1 - 0.2, y1, 12)
        for yy in (y1 - 1.2, y1 - 0.8, y1 - 0.4):
            P.cyl('Mast', (dx, 0, z), 0.2, 0.2, yy, yy + 0.05, 12, cap0=False, cap1=False)
    elif kind == 'comms':                         # OE-538 multifunction comms mast: slim, whip on top
        P.cyl('Mast', (dx, 0, z), 0.2, 0.2, y1 - 8.0, y1 - 1.3, 10)
        P.cyl('Radome', (dx, 0, z), 0.2, 0.17, y1 - 1.3, y1 - 0.2, 12)
        P.cyl('Mast', (dx, 0, z), 0.035, 0.015, y1 - 0.2, y1 + 1.4, 5)
    elif kind == 'radar':                         # AN/BPS-16: a small flat antenna on a column
        P.cyl('Mast', (dx, 0, z), 0.18, 0.18, y1 - 8.0, y1 - 0.7, 10)
        P.box('Radome', dx - 0.8, dx + 0.8, y1 - 0.7, y1 - 0.15, z - 0.14, z + 0.1)
    else:                                         # snorkel induction mast: streamlined trunk, the head valve
        P.box('Mast', dx - 0.3, dx + 0.3, y1 - 8.0, y1 - 0.9, z - 0.45, z + 0.45)
        P.box('Mast', dx - 0.4, dx + 0.4, y1 - 0.9, y1, z - 0.57, z + 0.57)
        P.box('SubDark', dx - 0.34, dx + 0.34, y1 - 0.65, y1 - 0.2, z - 0.58, z - 0.56)
    return P, (dx, y1, z)

for (nm, xm, ym, travel, kind) in C['masts']:
    P, o = mast_part(nm, xm, ym, kind)
    K.sliding(P, 'mast_' + nm, o, root, (0, 1, 0), travel, t='mast')

# ═════════════ Rig: the lock-out / escape trunk hatch, the boarding point, the bridge ═════════════
xe = C['escape_x']
ye = top_y(xe)
H = Part('hatch_escape')
H.cyl('SubSteel', (0, 0, Z(xe)), 0.55, 0.5, ye + 0.03, ye + 0.14, 16)
H.box('SubSteel', -0.1, 0.1, ye + 0.14, ye + 0.2, Z(xe) - 0.22, Z(xe) + 0.22)
K.hinged(H, 'hatch_escape', (0, ye + 0.03, Z(xe) + 0.55), root, (1, 0, 0), 1.9)
K.point('hatch_entry', (1.5, ye, Z(xe + 1.6)), root)
K.point('bridge', (0, SAIL_TOP - 1.2, Z(SX0 + 1.3)), root)

# ═════════════ layout for the game ═════════════
layout = {
    'version': 1, 'deckY': round(FLAT_Y, 2), 'shadowY': round(FLAT_Y, 2), 'L': L, 'draft': C['draft_mid'],
    'waterline': [[x, z] for x, z in waterline],
    'deck': [[round(x * 0.45, 2), z] for x, z in waterline],
    'sailTop': round(SAIL_TOP, 2), 'trimDeg': C['trim'],
    # setDepth(ship, periscopeDepth): keel at periscope_keel m, the sail top ~2 m under, only raised masts show
    'periscopeDepth': round(C['periscope_keel'] - C['draft_mid'], 2),
    'tubes': tube_no - 1, 'cells': cell_no - 1,
    'fx': {'bowWave': 9, 'sternWave': 4, 'contact': 1.6, 'pile': 0.7, 'occlusion': 4, 'maxLen': 900, 'spray': 0.5},
    'mounts': [],
}
root['skywar'] = json.dumps(layout, separators=(',', ':'))
print(VARIANT, 'tris ~', S.tris(), 'cells', cell_no - 1, 'tubes', tube_no - 1, 'sail top', round(SAIL_TOP, 2))
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_extras=True, export_yup=True,
                          export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print('exported', OUT, os.path.getsize(OUT) // 1024, 'KB')

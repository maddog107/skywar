# Boeing E-3G Sentry (AWACS) — SKYWAR support-aircraft build.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/e3.py -- SRC.glb models/aircraft/e3.glb
# SRC: the same model as kc135.py, "KC135R" by Adastra (CC BY 4.0),
# https://sketchfab.com/3d-models/kc135r-95fedbaed45b492e8dfa9d1a8f76b25f
# The E-3 is a Boeing 707-320B airframe, whose layout the KC-135 (Boeing 717) shares; derived from it:
#  - fuselage lengthened 6.3 m (3.9 m ahead of the wing, 2.4 m behind it) to the E-3's 46.61 m
#  - the wing stretched spanwise outboard of the root (x1.106) to the -320B's 44.42 m span (the engines move out to
#    ~9.6 / 15.7 m, as on the E-3 drawing; LE sweep ~34°)
#  - the CFM56 nacelles and pylons replaced by TF33-PW-100A (JT3D-type) nacelles on 707 pylons: a short fan cowl
#    over the front half, the core cowl and nozzle behind it
#  - the 9.14 m rotodome (1.83 m thick, 3.35 m above the fuselage) on two struts in a Λ: the `rotodome` node,
#    painted half black, half white (the E-3's look; the pattern sweeps round as it turns at 6 rpm)
#  - Block 30/35 ESM blisters on the forward fuselage sides, the UARRSI refuelling receptacle, blade antennas,
#    wingtip HF probes; KC-135-only details (boom, boom pod, cargo door, unit markings) removed
# References (measuring only): USAF E-3 line drawing (Wikimedia Commons "AWACS Line drawing.jpg", public domain),
# USAF fact sheet, photographs of E-3C 81-0005 (Wikimedia Commons, CC BY-SA) and RAF E-3Ds.
# s = metres aft of the nose, x right, z up (tools/aircraft_kit.py).
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
from aircraft_kit import S
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]
L = 46.61

SK.begin('e3', L, paint='#b2b6b7', paint2='#a8acad', radome='#2a2d30', dark='#1d1f21', nozzle='#4f4a45')
K.material('Metal', '#b4b7b9', 0.7, 0.38)
K.material('CoreCowl', '#8e9294', 0.45, 0.45)
K.material('DomeBlack', '#1b1e23', 0.1, 0.5)
K.material('DomeWhite', '#dcddd9', 0.05, 0.55)
air = SK.load(SRC, nose='+Y', weld_first=True)
SK.fit(air, 41.53)        # the KC-135's scale (as kc135.py), then stretched below
obj = {o.name[len('src_'):]: o for o in air}
# as kc135.py: the dense wing and fuselage meshes decimated (symmetrically)
SK.decimate(0.4, [obj['Object_27']], sym=True)
SK.decimate(0.6, [obj['Object_37']], sym=True)
SK.weld([obj['Object_27'], obj['Object_37']], angle=35)
ALL = lambda: SK.meshes()

# ── clean-up: KC-135-only parts ──
SK.delete_loose(lambda a, b, n: -b.y > 33.5 and n < 400 and b.z < 1.3, [obj['Object_37']])            # the boom
SK.delete_loose(lambda a, b, n: n < 60 and -b.y > 30 and -a.y < 34.5 and b.z < 0.0, [obj['Object_37']])  # boom operator's pod
SK.delete_loose(lambda a, b, n: (b - a).length > 8 and (b - a).x < 0.1 and n <= 200, [obj['Object_32']])  # HF wire
SK.delete([obj['Object_38'], obj['Object_25'], obj['Object_33']])                                        # unit markings
print('tail codes', SK.delete_loose(lambda a, b, n: -b.y > 30 and a.z > 3.0, [obj['Object_20']]),     # tail codes (and their
      SK.delete_loose(lambda a, b, n: n < 40 and -b.y > 34.5 and -a.y < 37.6 and a.z > 5.3 and b.z < 7.0 and abs(a.x) < 0.5, [obj['Object_27']]))  # fragments in the fin)
# the cargo door outline on the left forward fuselage (the E-3's -320B airframe has none)
print('cargo door', SK.delete_loose(lambda a, b, n: a.x < -1.5 and b.x < -0.5 and -b.y > 6.5 and -a.y < 11.0 and (b.z - a.z) > 1.2 and n < 400, [obj['Object_32'], obj['Object_37']]))
# the CFM56 nacelles, their fans and pylons, and the lines painted on them
SK.delete([obj[n] for n in ('Object_3', 'Object_4', 'Object_5', 'Object_7', 'Object_8', 'Object_9', 'Object_11', 'Object_12', 'Object_13',
                            'Object_15', 'Object_16', 'Object_17', 'Object_21', 'Object_22', 'Object_23', 'Object_24')])
eng = lambda a, b: 6.3 < max(abs(a.x), abs(b.x)) < 16.5 and min(abs(a.x), abs(b.x)) > 6.3 and b.z < 1.45 and -b.y > 11.5 and -a.y < 25.5
SK.delete_loose(lambda a, b, n: n < 2000 and eng(a, b), [obj['Object_27']])
SK.delete_loose(lambda a, b, n: eng(a, b) and b.z < 0.9, [obj['Object_20'], obj['Object_26']])

# ── paint: E-3 light grey with panel lines ──
SK.replace_material(r'^material_6$', 'Paint')
SK.replace_material(r'^material_12$', 'Paint2')
SK.replace_material(r'^material_(3|9|4|8|0|13)$', 'Dark')
for n in ('Object_27', 'Object_37', 'Object_28'):
    K._box_uv(obj[n], 8.0)

# ── the 707-320B wing: stretch the wing outboard of the root spanwise (the stabiliser, aft of s 31, stays) ──
XR, KW = 2.05, 1.106                # tip 20.28 → 22.21 m (span 44.42 m)
SK.stretch(lambda w: abs(w.x) > XR and -w.y < 31.0, lambda w: Vector((math.copysign((abs(w.x) - XR) * (KW - 1), w.x), 0, 0)), ALL())
def wx_src(x):   # a stretched station back to the KC-135's
    return XR + (abs(x) - XR) / KW

# ── fuselage plugs: 2.4 m behind the wing (aft of s 26.5 inboard, all of the tail), then 3.9 m ahead of it ──
DA, DF, SF, SA = 2.4, 3.9, 11.2, 26.5   # 40.3 m → 46.6 m; root LE at 16.1 m, as on the E-3 drawing
SK.stretch(lambda w: -w.y >= SA and (abs(w.x) < 2.0 or -w.y > 30.5), Vector((0, -DA, 0)), ALL())
SK.stretch(lambda w: -w.y >= SF, Vector((0, -DF, 0)), ALL())
# (E-3 stations from here: nose 0, wing root LE ~15.9, tail cone ~46.6)
CROWN = 2.44            # fuselage top over the aft fuselage

# ── TF33-PW-100A nacelles on 707 pylons ──
exhausts = []
kit_eng = []
for xe in (9.6, 15.7):
    w = SK.section([obj['Object_27']], x=xe, pred=lambda p: 12 < -p.y < 34)
    le, te = w[0], w[1]
    # the lower skin over the front of the chord (the flap-track fairings further aft hang lower)
    zlo = SK.section([obj['Object_27']], x=xe, pred=lambda p: le + 0.3 < -p.y < le + 2.5)[2]
    zc = zlo + 0.02 - 0.62 - 0.80                 # nacelle axis: 0.62 m pylon gap below the lower skin
    s0 = le - 3.75                                # inlet lip
    print('TF33 at x %.1f: wing %s  axis z %.2f inlet s %.2f' % (xe, [round(v, 2) for v in w], zc, s0))
    kit_eng += K.duct('FanCowl%d' % int(xe), [S(s0, 0.70, 0.70, x=xe, z=zc), S(s0 + 0.3, 0.79, 0.79, x=xe, z=zc), S(s0 + 1.4, 0.81, 0.81, x=xe, z=zc),
                                              S(s0 + 2.3, 0.73, 0.73, x=xe, z=zc)], lip=0.1, throat=0.55, mirror=True, ring=32)
    for sd in (1, -1):
        x = sd * xe
        kit_eng.append(K.loft('FanExit%d%s' % (int(xe), 'R' if sd > 0 else 'L'), [S(s0 + 2.28, 0.71, 0.71, x=x, z=zc), S(s0 + 1.95, 0.7, 0.7, x=x, z=zc)],
                              material='Intake', ring=32, cap_front=False, cap_back=True))
        kit_eng.append(K.loft('CoreCowl%d%s' % (int(xe), 'R' if sd > 0 else 'L'), [S(s0 + 1.9, 0.58, 0.58, x=x, z=zc), S(s0 + 2.5, 0.58, 0.58, x=x, z=zc),
                               S(s0 + 3.9, 0.52, 0.52, x=x, z=zc), S(s0 + 4.65, 0.44, 0.44, x=x, z=zc)], material='CoreCowl', ring=28, cap_back=False))
        kit_eng.append(K.loft('Spinner%d%s' % (int(xe), 'R' if sd > 0 else 'L'), [S(s0 + 0.42, 0.02, 0.02, x=x, z=zc), S(s0 + 0.6, 0.16, 0.16, x=x, z=zc),
                               S(s0 + 0.72, 0.22, 0.22, x=x, z=zc)], material='Dark', ring=16))
        kit_eng.append(K.loft('Plug%d%s' % (int(xe), 'R' if sd > 0 else 'L'), [S(s0 + 4.5, 0.22, 0.22, x=x, z=zc), S(s0 + 5.0, 0.14, 0.14, x=x, z=zc),
                               S(s0 + 5.35, 0.02, 0.02, x=x, z=zc)], material='Nozzle', ring=16))
        exhausts.append((s0 + 4.9, x, zc))
    kit_eng += K.nozzle('Exhaust%d' % int(xe), s0 + 4.6, s0 + 4.95, xe, zc, 0.44, 0.4, mirror=True, depth=0.45, register=False)
    # pylon: from the nacelle's upper surface up into the wing's leading edge and lower skin, jutting forward
    kit_eng += K.surface('Pylon%d' % int(xe), [(s0 + 1.0, s0 + 4.9, xe, zc + 0.7, 0.07), (le - 0.9, le + 1.8, xe, zlo + 0.28, 0.07)],
                         material='Paint', mirror=True, subdiv=2)

# ── rotodome (moving part) on two struts in a Λ, with a fairing where they meet the spine ──
DS, R, HT = 30.2, 4.57, 0.915
DZ = CROWN + 3.35 + HT                            # rotodome centre height
import bmesh
def rotodome():
    bm = bmesh.new()
    N, M = 72, 14
    # the section: a lens, flat top and bottom easing into a rounded rim
    prof = []
    for j in range(M + 1):
        r = R * math.sin(0.5 * math.pi * j / M) ** 0.8
        h = HT * max(0.0, 1 - (r / R) ** 3.2) ** 0.5
        prof.append((r, h))
    rings_top, rings_bot = [], []
    top_c = bm.verts.new((0, K.Y(DS), DZ + HT)); bot_c = bm.verts.new((0, K.Y(DS), DZ - HT))
    for (r, h) in prof[1:]:
        rt, rb = [], []
        for i in range(N):
            a = 2 * math.pi * i / N
            rt.append(bm.verts.new((r * math.cos(a), K.Y(DS) + r * math.sin(a), DZ + h)))
            rb.append(bm.verts.new((r * math.cos(a), K.Y(DS) + r * math.sin(a), DZ - h)))
        rings_top.append(rt); rings_bot.append(rb)
    def mat_of(a, r):   # 1 = white: the outer part of one half (sector centred on +x), 0 = black
        return 1 if (math.cos(a) > 0 and r > 0.6 * R) else 0
    for i in range(N):
        a = 2 * math.pi * (i + 0.5) / N
        f = bm.faces.new((top_c, rings_top[0][i], rings_top[0][(i + 1) % N])); f.material_index = mat_of(a, 0)
        f = bm.faces.new((bot_c, rings_bot[0][(i + 1) % N], rings_bot[0][i])); f.material_index = mat_of(a, 0)
        for j in range(len(prof) - 2):
            rr = (prof[j + 1][0] + prof[j + 2][0]) / 2
            f = bm.faces.new((rings_top[j][i], rings_top[j + 1][i], rings_top[j + 1][(i + 1) % N], rings_top[j][(i + 1) % N])); f.material_index = mat_of(a, rr)
            f = bm.faces.new((rings_bot[j][(i + 1) % N], rings_bot[j + 1][(i + 1) % N], rings_bot[j + 1][i], rings_bot[j][i])); f.material_index = mat_of(a, rr)
        # the rim: top edge to bottom edge
        f = bm.faces.new((rings_top[-1][i], rings_bot[-1][i], rings_bot[-1][(i + 1) % N], rings_top[-1][(i + 1) % N])); f.material_index = mat_of(a, R)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K._obj('Rotodome', bm, ['DomeBlack', 'DomeWhite'])
dome = rotodome()
# turntable hub under the dome (turns with it)
hub = K.loft('DomeHub', [S(DS - 0.75, 0.75, 0.12, z=DZ - HT - 0.1), S(DS + 0.75, 0.75, 0.12, z=DZ - HT - 0.1)], material='Dark', ring=24)
SK.part('rotodome', [dome, hub], (DS, 0.0, DZ), props={'rpm': 6, 'diameter': 2 * R})
struts = []
for sd in (1, -1):
    struts += K.surface('Strut' + ('R' if sd > 0 else 'L'), [(DS - 0.85, DS + 0.85, sd * 0.85, CROWN - 0.15, 0.2), (DS - 0.8, DS + 0.8, sd * 0.4, DZ - HT - 0.12, 0.19)],
                        material='Paint', mirror=False, subdiv=2)
struts.append(K.loft('StrutFairing', [S(DS - 2.1, 0.05, 0.05, z=CROWN - 0.12), S(DS - 1.4, 0.75, 0.24, 0.1, z=CROWN - 0.1), S(DS, 1.05, 0.34, 0.1, z=CROWN - 0.1),
                                      S(DS + 1.3, 0.8, 0.26, 0.1, z=CROWN - 0.1), S(DS + 2.2, 0.05, 0.05, z=CROWN - 0.12)], material='Paint', ring=24))

# ── details ──
# ESM blisters on the forward fuselage sides (Block 30/35), the UARRSI receptacle behind the cockpit, antennas
for sd in (1, -1):
    K.loft('ESM' + ('R' if sd > 0 else 'L'), [S(6.2, 0.02, 0.05, x=sd * 1.66, z=1.25), S(6.8, 0.2, 0.42, x=sd * 1.7, z=1.25),
                                              S(8.4, 0.27, 0.6, x=sd * 1.72, z=1.25), S(10.0, 0.2, 0.42, x=sd * 1.7, z=1.25), S(10.6, 0.02, 0.05, x=sd * 1.66, z=1.25)],
           material='Paint2', ring=24)
K.loft('Receptacle', [S(4.9, 0.05, 0.03, z=2.33), S(5.3, 0.36, 0.14, 0.05, z=2.33), S(6.4, 0.36, 0.14, 0.05, z=2.36), S(6.9, 0.05, 0.03, z=2.36)], material='Paint2', ring=16)
K.box('ReceptacleDoor', 5.35, 6.2, -0.16, 0.16, 2.44, 2.5, material='Dark')
for k, s in enumerate((11.0, 13.0, 15.5, 17.5, 20.0, 34.5, 37.0)):
    K.fin('Blade%d' % k, (s, s + 0.45), (s + 0.25, s + 0.5, 0.42), t=0.08, t_tip=0.06, x=0.0, z=CROWN - 0.03, material='Dark', subdiv=0)
for k, s in enumerate((9.0, 18.5, 33.0)):
    K.fin('Belly%d' % k, (s, s + 0.4), (s + 0.2, s + 0.45, 0.35), t=0.08, t_tip=0.06, x=0.0, z=-1.9, cant=180, material='Dark', subdiv=0)
# HF probes on the wingtips, pointing forward
XT = XR + (19.9 - XR) * KW
w = SK.section([obj['Object_27']], x=XT - 0.08, pred=lambda p: 12 < -p.y < 36)
for sd in (1, -1):
    K.probe('HFProbe' + ('R' if sd > 0 else 'L'), w[0] - 1.7, w[0] + 0.6, (w[2] + w[3]) / 2, 0.09, 0.02, x=sd * (XT - 0.06), material='Paint2')

air_obj = SK.finish(OUT)
print('NOZZLES', [SK.frac(s, x, z) for s, x, z in exhausts])
print('COCKPIT', SK.frac(4.2, 0.0, 1.25))
print('REFUEL', SK.frac(5.8, 0.0, 2.5))

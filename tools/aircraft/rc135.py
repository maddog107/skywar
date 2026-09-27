# Boeing RC-135V/W Rivet Joint — SKYWAR support-aircraft build.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/rc135.py -- SRC.glb models/aircraft/rc135.glb
# SRC: the same model as kc135.py / e3.py, "KC135R" by Adastra (CC BY 4.0),
# https://sketchfab.com/3d-models/kc135r-95fedbaed45b492e8dfa9d1a8f76b25f
# The RC-135V/W is a C-135B airframe re-engined with CFM56 (F108) engines like the KC-135R; derived from it:
#  - the extended "hog nose" (AN/APN-59 radar), ~1.5 m longer than the tanker's nose and drooping
#  - the SLAR "cheek" fairings along the lower forward fuselage sides
#  - rows of blade antennas under the fuselage (the MUCELS / COMINT arrays), dorsal antennas, the refuelling
#    receptacle on the spine
#  - no boom, boom operator's pod, HF wire or unit markings
# References (measuring only): USAF RC-135V/W fact sheet, photographs on Wikimedia Commons.
# Real size (fact sheet): length 41.1 m, span 39.9 m, height 12.8 m. Built at the KC-135's scale (fit as kc135.py),
# the file is 41.81 m long and 40.56 m wide: the game scales it to 41.1 m, which gives the 39.9 m span.
# s = metres aft of the nose, x right, z up (tools/aircraft_kit.py).
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
from aircraft_kit import S
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]

SK.begin('rc135', 41.53, paint='#8f969b', paint2='#858c91', radome='#2a2d30', dark='#1d1f21', nozzle='#4a4541')
K.material('Metal', '#b7babc', 0.75, 0.35)
air = SK.load(SRC, nose='+Y', weld_first=True)   # (welded first: decimation then collapses across the seams)
SK.fit(air, 41.53)                      # the KC-135's scale (as kc135.py)
obj = {o.name[len('src_'):]: o for o in air}
ALL = lambda: SK.meshes()
# the dense wing (with fin, stabilisers, nacelles) and fuselage meshes decimated symmetrically, as kc135.py
SK.decimate(0.4, [obj['Object_27']], sym=True)
SK.decimate(0.6, [obj['Object_37']], sym=True)
SK.weld([obj['Object_27'], obj['Object_37']], angle=35)

# ── clean-up: tanker-only parts, markings of one aircraft, the HF wire, and the tanker's radome ──
def gone(what, r):
    print('removed %-16s %d parts, %d tris' % (what, *r))
gone('boom', SK.delete_loose(lambda a, b, n: -b.y > 33.5 and n < 400 and b.z < 1.3, [obj['Object_37']]))
# the boom operator's pod under the tail: its blister, the fairing slab under it and a strip ahead (all Object_37 has there)
gone('boom pod', SK.delete_loose(lambda a, b, n: n < 700 and -b.y > 30 and -a.y < 34.5 and b.z < 0.0, [obj['Object_37']]))
gone('HF wire', SK.delete_loose(lambda a, b, n: (b - a).length > 8 and (b - a).x < 0.1 and n <= 200, [obj['Object_32']]))
SK.delete([obj['Object_38'], obj['Object_25'], obj['Object_33']])                                        # unit markings
gone('tail codes', SK.delete_loose(lambda a, b, n: -b.y > 30 and a.z > 3.0, [obj['Object_20']]))
gone('fin fragments', SK.delete_loose(lambda a, b, n: n < 40 and -b.y > 34.5 and -a.y < 37.6 and a.z > 5.3 and b.z < 7.0 and abs(a.x) < 0.5, [obj['Object_27']]))
gone('tanker radome', SK.delete_loose(lambda a, b, n: n > 400 and -b.y < 0.1 and -a.y < 2.8, [obj['Object_32']]))
# the tanker unit's lettering ("190th ARW") and badge under the cockpit, both sides
gone('unit lettering', SK.delete_loose(lambda a, b, n: n < 130 and min(abs(a.x), abs(b.x)) > 1.15 and 3.55 < -b.y and -a.y < 4.75 and a.z > -0.72 and b.z < -0.25,
                                       [obj['Object_32'], obj['Object_36']]))
# the cargo door outline on the left forward fuselage (the RC-135's is under the left cheek)
gone('cargo door', SK.delete_loose(lambda a, b, n: a.x < -1.5 and b.x < -0.5 and -b.y > 6.5 and -a.y < 11.0 and (b.z - a.z) > 1.2 and n < 400, [obj['Object_32'], obj['Object_37']]))

# ── paint ──
SK.replace_material(r'^material_6$', 'Paint')
SK.replace_material(r'^material_12$', 'Paint2')
SK.replace_material(r'^material_(3|9)$', 'Nozzle')
SK.replace_material(r'^material_4$', 'Metal')
SK.replace_material(r'^material_(8|0|13)$', 'Dark')
for n in ('Object_27', 'Object_37', 'Object_28'):
    K._box_uv(obj[n], 8.0)

# ── the hog nose: everything moves aft 1.47 m and a longer, drooping radome is built ahead of the joint ──
DN = 1.47
SK.stretch(lambda w: True, Vector((0, -DN, 0)), ALL())
SJ = 1.4 + DN                              # the radome joint (the fuselage's nose ring: ±0.889, z -0.981..0.906)
hog = K.loft('HogNose', [
    S(SJ + 0.02, 0.889, 0.946, 0.941, z=-0.04), S(SJ - 0.5, 0.87, 0.9, 0.95, z=-0.08), S(SJ - 1.1, 0.8, 0.78, 0.93, z=-0.17),
    S(SJ - 1.7, 0.68, 0.6, 0.84, z=-0.28), S(SJ - 2.2, 0.5, 0.42, 0.64, z=-0.38), S(SJ - 2.55, 0.3, 0.24, 0.38, z=-0.45),
    S(SJ - 2.78, 0.12, 0.1, 0.14, z=-0.49), S(SJ - 2.87, 0.02, 0.02, 0.02, z=-0.5)],
    material='Paint', ring=40, cap_back=False, mat_ranges=[(0.0, SJ - 0.75, 'Radome')])
print('nose tip at s', SJ - 2.87)

# ── SLAR cheek fairings along the lower forward fuselage (behind the cockpit to ahead of the wing) ──
C0, C1 = 5.9 + DN, 12.3 + DN
for sd in (1, -1):
    x = sd * 1.72
    K.loft('Cheek' + ('R' if sd > 0 else 'L'), [S(C0, 0.05, 0.12, 0.2, x=x, z=-0.62), S(C0 + 0.7, 0.36, 0.55, 0.62, x=x, z=-0.62),
                                               S(C0 + 1.6, 0.46, 0.66, 0.7, x=x, z=-0.62), S(C1 - 1.4, 0.46, 0.66, 0.7, x=x, z=-0.62),
                                               S(C1 - 0.5, 0.3, 0.5, 0.55, x=x, z=-0.62), S(C1, 0.05, 0.14, 0.18, x=x, z=-0.62)],
           material='Paint2', ring=28)

# ── antennas: belly rows (COMINT), dorsal blades and SATCOM, the receptacle behind the cockpit ──
for k in range(8):
    s = 16.2 + DN + k * 0.9
    for sd in (1, -1):
        K.fin('BellyA%d%s' % (k, 'R' if sd > 0 else 'L'), (s, s + 0.3), (s + 0.12, s + 0.34, 0.32), t=0.08, t_tip=0.06, x=sd * 0.65, z=-1.72,
              cant=180 - sd * 15, material='Dark', subdiv=0)
for k in range(6):
    s = 25.0 + DN + k * 0.8
    K.fin('BellyB%d' % k, (s, s + 0.3), (s + 0.12, s + 0.34, 0.3), t=0.08, t_tip=0.06, x=0.0, z=-1.62, cant=180, material='Dark', subdiv=0)
for k, s in enumerate((9.5, 12.0, 14.5, 19.0, 22.0)):
    K.fin('Dorsal%d' % k, (s + DN, s + DN + 0.42), (s + DN + 0.22, s + DN + 0.46, 0.4), t=0.08, t_tip=0.06, x=0.0, z=2.4, material='Dark', subdiv=0)
K.ellipsoid('Satcom', 17.0 + DN, 0.0, 2.42, 0.9, 0.55, 0.18, material='Paint2')
K.loft('Receptacle', [S(4.6 + DN, 0.05, 0.03, z=2.2), S(5.0 + DN, 0.34, 0.14, 0.05, z=2.2), S(6.0 + DN, 0.34, 0.14, 0.05, z=2.25), S(6.5 + DN, 0.05, 0.03, z=2.27)],
       material='Paint2', ring=16)
K.box('ReceptacleDoor', 5.05 + DN, 5.85 + DN, -0.15, 0.15, 2.3, 2.37, material='Dark')

# engine exhausts (the CFM56s, as kc135.py)
exh = []
for xe in (-14.2, -8.4, 8.4, 14.2):
    pts = [o.matrix_world @ v.co for o in (obj['Object_22'], obj['Object_23']) for v in o.data.vertices if abs((o.matrix_world @ v.co).x - xe) < 1.2]
    far = max(pts, key=lambda p: -p.y)
    zs = [p.z for p in pts if -p.y > -far.y - 0.4]
    exh.append((-far.y, xe, (min(zs) + max(zs)) / 2))
SK.finish(OUT)
print('NOZZLES', [SK.frac(s, x, z) for s, x, z in exh])
print('COCKPIT', SK.frac(4.2 + DN, 0.0, 1.25))
print('REFUEL', SK.frac(5.5 + DN, 0.0, 2.4))

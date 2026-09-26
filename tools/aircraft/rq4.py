# Northrop Grumman RQ-4B Global Hawk (Block 40) — SKYWAR support-aircraft build.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/rq4.py -- SRC.glb models/aircraft/rq4.glb
# SRC: NASA 3D Resources "Global Hawk" (Global Hawk.glb), public domain (US Government work; NASA media guidelines,
# https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Global%20Hawk). NASA flies Block 10 airframes.
# Changes: nose turned to +Y, the landing gear (wheels, struts, doors) removed, scaled to the RQ-4B's 14.5 m; the
# model's wing is short for its fuselage (29.5 m at that length), so the outer wing is stretched spanwise to the
# Block 30/40's 39.9 m (the chord is kept: a little more slender than the real wing); the NASA livery (white, blue
# cheatline, NASA insignia) replaced by USAF light grey with the SKYWAR panel texture; dark inlet and exhaust faces.
# Real size (RQ-4B): length 14.5 m, span 39.9 m, height 4.7 m.
# s = metres aft of the nose, x right, z up (tools/aircraft_kit.py).
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]
L = 14.5
SPAN = 39.9

SK.begin('rq4', L, paint='#b3b8bb', paint2='#a9aeb1', dark='#1d1f21')
air = SK.load(SRC, nose='-Y')
# the landing gear: wheels, tyres, struts, doors and the nose leg are materials of their own
print('gear faces', SK.delete_mat_faces(r'justwheels|lambert4SG|blinn1SG|initialShadingGroup|lambert6SG', air))
SK.fit(air, L)
o = air[0]

# the RQ-4B's wing: stretch the wing outboard of the root spanwise to 39.9 m (the V-tail, aft of s 10, stays)
mn, mx = SK.bbox(air)
semi = max(-mn.x, mx.x)
X0 = 1.0
kw = (SPAN / 2 - X0) / (semi - X0)
print('semispan %.2f -> %.2f (x%.3f)' % (semi, SPAN / 2, kw))
SK.stretch(lambda w: abs(w.x) > X0 and 6.0 < -w.y < 9.8 and w.z < 2.2,
           lambda w: Vector(((abs(w.x) - X0) * (kw - 1) * (1 if w.x > 0 else -1), 0, 0)), air)

# paint: USAF light grey with panel lines over the whole airframe (box UVs); the engine's inlet and exhaust
# faces (flat discs across the dorsal nacelle) dark
SK.replace_material(r'.', 'Paint', air)
K._box_uv(o, 8.0)
inlet = SK.separate_loose(lambda a, b, n: (b.y - a.y) < 0.06 and 7.8 < -b.y < 9.2 and a.z > 2.2 and 0.3 < (b.x - a.x) < 1.2, 'Inlet', air)
exh = SK.separate_loose(lambda a, b, n: (b.y - a.y) < 0.06 and 12.3 < -b.y < 12.8 and a.z > 2.4 and 0.3 < (b.x - a.x) < 1.2, 'ExhaustFace', air)
for part, mat in ((inlet, 'Intake'), (exh, 'NozzleInner')):
    if part:
        SK.set_material([part], mat)
        a, b = SK.bbox([part])
        print(part.name, 's %.2f..%.2f x %.2f..%.2f z %.2f..%.2f' % (-b.y, -a.y, a.x, b.x, a.z, b.z))
ea, eb = SK.bbox([exh]) if exh else (Vector((0, -12.56, 2.78)), Vector((0, -12.56, 3.48)))
ex_s, ex_z = -((ea.y + eb.y) / 2), (ea.z + eb.z) / 2

SK.finish(OUT)
print('NOZZLES', [SK.frac(ex_s + 0.1, 0.0, ex_z)], 'nozzleR', round(0.3 / L, 4))
print('COCKPIT', SK.frac(0.7, 0.0, 2.1))

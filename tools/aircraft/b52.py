# Boeing B-52H Stratofortress — SKYWAR support-aircraft kit build.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/b52.py -- SRC.glb models/aircraft/b52.glb
# SRC: "B52" by manilov.ap (CC BY 4.0), https://sketchfab.com/3d-models/b52-3ca2f507a0a749799e16a4eee12e456c
# (Objaverse glbs/000-078/3ca2f507a0a749799e16a4eee12e456c.glb): a 2nd Bomb Wing B-52H (LA tail code, eight TF33
# turbofans in four pods, gear retracted).
# Changes: the tail gun barrels removed (the H's M61 went in 1991; the turret fairing and tail radar stay), the
# gear doors hanging below the belly removed, the wing stretched spanwise outboard of the root (x1.025) to the real
# 56.39 m span (the model's was 55.1 m at the real length).
# Real size: length 48.5 m, span 56.39 m, height 12.4 m. s = metres aft of the nose, x right, z up.
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]
L, SPAN = 48.5, 56.39

SK.begin('b52', L)
air = SK.load(SRC, nose='-X')
obj = {o.name[len('src_'):]: o for o in air}
def O(prefix):
    return [o for n, o in obj.items() if n.startswith(prefix)]

# ── clean-up (source coordinates after the nose turn: y = forward) ──
SK.delete(O('Cylinder02'))                                          # the tail gun's barrels
SK.delete(O('Box41') + O('Box301') + O('Box302') + O('Box303') + O('Object06') + O('Object10'))   # gear doors / legs
SK.fit(SK.meshes(), L)                                              # nose at s = 0, centred on x

# ── the wing to its real span: stretch outboard of the fuselage side, forward of the tailplane ──
mn, mx = SK.bbox()
half = (mx.x - mn.x) / 2
XR = 1.55
KW = (SPAN / 2 - XR) / (half - XR)
print('span %.2f -> %.2f (x%.4f)' % (2 * half, SPAN, KW))
SK.stretch(lambda w: abs(w.x) > XR and -w.y < 35.0, lambda w: Vector((math.copysign((abs(w.x) - XR) * (KW - 1), w.x), 0, 0)))

# ── probes: engine exhausts (pods of two TF33s: one contrail point per pod), receptacle, cockpit ──
pods = []
for o in SK.meshes():
    if o.name.startswith('src_DVIG_SOPL'):
        a, b = SK.bbox([o])
        pods.append(((a + b) / 2, a, b))
exh = {}
for c, a, b in pods:
    key = round(c.x / 4)            # the two nozzles of a pod share a key
    e = exh.setdefault(key, [0, 0, 0, 0, 0])
    e[0] += c.x; e[1] += c.z; e[2] += 1; e[3] = max(e[3], -a.y); e[4] = max(e[4], (b.x - a.x) / 2)
print('PODS', {k: (round(v[0] / v[2], 2), round(v[1] / v[2], 2), round(v[3], 2), v[2]) for k, v in exh.items()})
rec = [o for o in SK.meshes() if o.name.startswith('src_Object04')]
ra, rb = SK.bbox(rec)
print('RECEPTACLE s %.2f..%.2f x %.2f..%.2f z %.2f..%.2f' % (-rb.y, -ra.y, ra.x, rb.x, ra.z, rb.z))
glass = [o for o in SK.meshes() if o.name.startswith('src_Object08')]
ga, gb = SK.bbox(glass)
print('COCKPIT GLASS s %.2f..%.2f z %.2f..%.2f' % (-gb.y, -ga.y, ga.z, gb.z))

SK.finish(OUT)
print('NOZZLES', [SK.frac(v[3], v[0] / v[2], v[1] / v[2]) for v in exh.values()])
print('REFUEL', SK.frac((-rb.y - ra.y) / 2, 0.0, rb.z))
print('COCKPIT', SK.frac(-gb.y + 1.2, 0.0, (ga.z + gb.z) / 2 + 0.1))

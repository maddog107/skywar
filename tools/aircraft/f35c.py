# ═══════════════════════════════════════════════════════════════
# F-35C Lightning II (carrier variant) from WTigerTw's "Low poly 1:1 USAF F35A" (CC BY): the airframe is the same
# family, so the F-35A's fuselage, canopy, fins and texture are kept and its planform is re-proportioned to the C's:
#   wing   span 10.7 → 13.1 m (the C's bigger, folding wing: 62 m² against the A's 43), the leading-edge sweep kept
#          (35°), the chord growing outboard to a broad tip (×1.5 at the tip) as on the C, with the A's slight anhedral
#   tail   horizontal tails 15% more span and 12% more chord (the C's larger tails for carrier approach control)
# Gear and tailhook are the game's (aircraft.js); markings are repainted for a US Navy squadron
# (tools/aircraft/paint_f35c.py).
#   blender -b -P tools/aircraft/f35c.py -- f35_stage.glb OUT.glb
# f35_stage.glb: the source through import_model.py --nose -Y --below 0.42 --below-max 0.2 (gear off; nose +Y,
# centred, metres, Z up). Measured off it: wing root station x 1.9, leading edge y = 0.107 − 0.714·s (s metres
# outboard of the root), tip at x 5.38; tailplane root x 1.45, leading edge y = −5.25 − 0.625·(x − 2.4).
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, sys, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

WING_ROOT, WING_TIP_A, WING_TIP_C = 1.9, 5.38, 13.1 / 2
K_SPAN = (WING_TIP_C - WING_ROOT) / (WING_TIP_A - WING_ROOT)
TAN_LE, Y_LE0, ANHEDRAL = 0.714, 0.107, 0.04
TIP_CHORD = 0.5                      # chord growth at the tip
TAIL_ROOT, K_TAIL_SPAN, K_TAIL_CHORD = 1.45, 1.15, 0.12


def morph(co):
    x, y, z = co
    ax, sx = abs(x), (1 if x >= 0 else -1)
    if ax > WING_ROOT and -4.75 < y < 0.8 and -0.9 < z < -0.05:
        s = ax - WING_ROOT
        s2 = s * K_SPAN
        u = min(1.0, s / (WING_TIP_A - WING_ROOT))
        c = (Y_LE0 - TAN_LE * s) - y               # distance aft of the leading edge
        if c > 0:
            c *= 1 + TIP_CHORD * u
        return Vector((sx * (WING_ROOT + s2), (Y_LE0 - TAN_LE * s2) - c, z - (s2 - s) * ANHEDRAL))
    if ax > TAIL_ROOT and y <= -4.75 and -0.75 < z < 0.0:
        s = ax - TAIL_ROOT
        s2 = s * K_TAIL_SPAN
        le = lambda a: -5.25 - 0.625 * (a - 2.4)
        c = le(ax) - y
        if c > 0:
            c *= 1 + K_TAIL_CHORD * min(1.0, s / 2.3)
        x2 = TAIL_ROOT + s2
        return Vector((sx * x2, le(x2) - c, z))
    return None


n = 0
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    M = o.matrix_world; Mi = M.inverted()
    for v in o.data.vertices:
        w = morph(M @ v.co)
        if w is not None:
            v.co = Mi @ w
            n += 1
print('morphed', n, 'vertices; span ×%.3f' % K_SPAN)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True)
print('WROTE', OUT)

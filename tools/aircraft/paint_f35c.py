# ═══════════════════════════════════════════════════════════════
# F-35C markings: the F-35A's USAF tail markings (33rd FW "EG", serial, the yellow fin stripe and wing badge)
# are painted out in the RAM grey, and a US Navy squadron's low-visibility markings go on: the air wing's tail
# code "NE" (CVW-2) and "VFA-147" on the outer faces of the fins, "NAVY" on the aft fuselage, the modex 400 on the
# nose. Markings in the lighter grey of the low-vis scheme. Coordinates: f35c_morph.glb (tools/aircraft/f35c.py:
# nose +Y, centred, metres, Z up); fins canted out 25° with their mid-chord at y −5.9.
#   blender -b -P tools/aircraft/bakemaps.py -- f35c_morph.glb DIR --mat '^Material$'
#   python3 tools/aircraft/paint_f35c.py DIR DIR/f35c_paint.png
# ═══════════════════════════════════════════════════════════════
import sys, os, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import livery as LV

D, OUT = sys.argv[1], sys.argv[2]
P = LV.Painter(D)
b = P.base
grey = np.median(b[P.cover], 0)                      # the RAM grey
lum = b @ np.array([0.3, 0.59, 0.11], np.float32)
sat = (b.max(2) - b.min(2)) / np.maximum(b.max(2), 1e-4)

# paint out the fins' USAF markings (lettering, badge, stripe): everything on the fins brighter or more saturated than
# the grey round it; the fins' own panel lines are lost with them (a bare fin reads the same at game distances)
fin = P.box((1.3, -7.9, -0.1), (3.2, -3.6, 2.4)).astype(bool) & (np.abs(P.nx) > 0.45)
mark = fin & ((np.abs(lum - grey @ np.array([0.3, 0.59, 0.11])) > 0.03) | (sat > 0.25))
P.out[mark] = grey
# the 33rd FW badge on the inner wing's upper skin
badge = P.box((0.0, -1.0, -0.6), (6.6, 4.0, 0.2)).astype(bool) & (P.nz > 0.6) & (sat > 0.18)
P.out[badge & P.cover] = grey

LOVIS = '#62666a'
cant = math.radians(25)
span = (math.sin(cant), 0, math.cos(cant))
P.decal(LV.text('NE', LOVIS, px=220), (2.07, -5.95, 1.12), (0, 1, 0), span, 0.95, depth=0.3, mirror=0)
P.decal(LV.text('VFA-147', LOVIS, px=120), (1.86, -6.25, 0.62), (0, 1, 0), span, 0.85, depth=0.3, mirror=0)
P.decal(LV.text('NAVY', LOVIS, px=160), (1.36, -4.25, -0.55), (0, 1, 0), (0, 0, 1), 0.7, facing=(1, 0, -0.35), depth=0.35, mirror=0)
P.decal(LV.text('400', LOVIS, px=160), (0.52, 4.75, -0.15), (0, 1, 0), (0, 0, 1), 0.55, facing=(1, 0, 0.2), depth=0.45, mirror=0)
P.save(OUT)

# ═══════════════════════════════════════════════════════════════
# Dassault Mirage 5F livery for helijah's "Dassault Mirage 5" (Armée de l'Air, 1970s–80s tactical scheme).
#   blender -b -P tools/aircraft/bakemaps.py -- SRC.glb DIR --mat texture
#   python3 tools/aircraft/paint_mirage.py DIR DIR/mirage_paint.png
# Upper surfaces and sides in the two-tone disruptive camouflage (vert armée and gris bleu foncé), undersides in
# aluminium lacquer, bare metal round the afterburner; Armée de l'Air roundels above and below the wings and on the
# intake fairings; the squadron code on the fin (EC 3/13 "Auvergne", Colmar). The prototype's white-and-red display
# scheme, fin flash and badge are painted out. Coordinates: the source file (metres, nose toward −X, Z up).
# ═══════════════════════════════════════════════════════════════
import sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import livery as LV

D, OUT = sys.argv[1], sys.argv[2]
P = LV.Painter(D)
b = P.base
lum = b @ np.array([0.3, 0.59, 0.11], np.float32)
sat = (b.max(2) - b.min(2)) / np.maximum(b.max(2), 1e-4)
rows = np.arange(P.H)[:, None] * np.ones((1, P.W))

# the top strip of the atlas holds the wheels, the jet pipe and cockpit-tub textures; the black nose cone and pitot
# and the jet pipe keep their own colour (the dark gear wells painted on the undersides become closed doors)
skin = (P.cover | P.valid) & (rows >= 0.127 * P.H)
dark = (lum < 0.3) & (sat < 0.35) & ((P.x < -6.2) | (P.x > 7.05))
detail = P.detail(sat_max=0.25, lo=0.6, hi=1.08)
detail[(lum < 0.3) & ~dark] = 0.93   # the painted-on gear wells: closed doors

VERT_ARMEE, GRIS_BLEU, ALU, METAL = '#56593d', '#414b55', '#b4b8ba', '#8b8e91'
under = np.maximum(P.facing((0, 0, -1), 0.28, 0.42), (P.z < -0.78).astype(np.float32))
P.camo([VERT_ARMEE, GRIS_BLEU], scale=2.6, sym_axis=1, seed=21, warp=0.9, octaves=3, stretch=(1.35, 1, 1), where=skin * (1 - under))
P.fill(ALU, where=skin * under)
P.fill(METAL, where=skin * P.box((6.85, None, None), (None, None, None), soft=0.03))
P.shade(detail, where=skin)

# Armée de l'Air roundels (cocardes): blue centre, white, red ring
cocarde = LV.roundel([(1.0, '#c8202b'), (0.667, '#f4f4f0'), (0.333, '#1f3a8a')])
for s in (1, -1):
    P.decal(cocarde, (3.84, 2.15 * s, -0.6), (1, 0, 0), (0, s, 0), 0.95, facing=(0, 0, 1), depth=0.35)
    P.decal(cocarde, (3.84, 2.15 * s, -0.7), (1, 0, 0), (0, s, 0), 0.95, facing=(0, 0, -1), depth=0.35)
P.decal(cocarde, (-0.86, -0.93, -0.36), (1, 0, 0), (0, 0, 1), 0.5, depth=0.3, mirror=1)
# squadron code on the fin, black, both sides reading forward-to-aft on the left and aft-to-forward on the right
P.decal(LV.text('13-SC', '#141414', px=200), (6.1, -0.05, 1.18), (1, 0, 0), (0, 0, 1), 1.25, depth=0.25, mirror=1)
# small serial under the code
P.decal(LV.text('n° 23', '#141414', px=120), (6.35, -0.05, 0.86), (1, 0, 0), (0, 0, 1), 0.42, depth=0.25, mirror=1)

P.keep(((~skin) | dark).astype(np.float32))
P.save(OUT)

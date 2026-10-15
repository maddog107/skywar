# ═══════════════════════════════════════════════════════════════
# Boeing 747-400 livery of "Aurelia Pacific", a fictional airline (no real carrier's name, colours or marks).
#   blender -b -P tools/aircraft/b747_prep.py -- SRC.glb b747_prep.glb
#   blender -b -P tools/aircraft/bakemaps.py -- b747_prep.glb FUS --mat '^Fuselage$'
#   blender -b -P tools/aircraft/bakemaps.py -- b747_prep.glb FIN --mat '^Fin$'
#   python3 tools/aircraft/paint_b747.py FUS FIN OUTDIR       → OUTDIR/b747_fuselage.png, OUTDIR/b747_fin.png
# Gloss white fuselage over a deep-blue belly that sweeps up toward the tail under a gold pinstripe; the blue fin
# carries the airline's gold sunburst; "AURELIA PACIFIC" titles on the forward fuselage between the main-deck and
# upper-deck windows (both sides, reading forward on each), the registration SW-AUR on the rear fuselage. Windows
# and doors are the model's own (b747_prep.py), the engine cowls blue. Coordinates: the source's (nose −Y, Z up,
# 26.62 units to the 70.6 m length): doors at y −10.0, −5.3, −1.2, 2.9, 7.85; the main-deck window row at
# z −1.23, the upper-deck row at z −0.31 (y −9.9 … −4.3); the cabin floor about z −1.75.
# ═══════════════════════════════════════════════════════════════
import sys, os, math
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import livery as LV

FUS, FIN, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
WHITE, BLUE, GOLD, BELLY_GREY = '#f4f5f3', '#17306c', '#d2a12b', '#9aa0a6'

# ── fuselage ──
P = LV.Painter(FUS, base=False)
P.fill(WHITE)
# the belly line: just under the doors along the cabin, sweeping up from the rear door to the tail cone
y, z = P.y, P.z
line = np.where(y < 5.5, -1.74, -1.74 + (y - 5.5) / (12.6 - 5.5) * 0.95)
line = np.where(y < -11.4, -1.74 - (-11.4 - y) * 0.12, line)          # dipping a little under the nose
belly = LV.smoothstep(0.012, -0.012, z - line)
P.fill(BLUE, where=belly)
stripe = LV.smoothstep(0.012, -0.012, np.abs(z - line - 0.075) - 0.03)
P.fill(GOLD, where=stripe)
# titles and registration
P.decal(LV.text('AURELIA PACIFIC', BLUE, px=200, spacing=0.06), (-1.12, -6.6, -0.78), (0, -1, 0), (0, 0, 1), 7.4,
        depth=0.6, min_dot=0.2, mirror=0)
P.decal(LV.text('SW-AUR', '#1b1d22', px=150), (-1.05, 9.6, -1.12), (0, -1, 0), (0, 0, 1), 1.3, depth=0.6, min_dot=0.2, mirror=0)
# the radome's dark seam ring and a subtle anti-glare band under the flight-deck windows
P.fill('#d6d8da', where=LV.smoothstep(-12.78, -12.82, y))
P.shade(1 - 0.06 * LV.smoothstep(0.35, 0.0, np.abs(z + 0.05)) * LV.smoothstep(-11.0, -11.6, y) * LV.smoothstep(-12.9, -12.5, y))
os.makedirs(OUT, exist_ok=True)
P.save(os.path.join(OUT, 'b747_fuselage.png'))

# ── fin: blue all over, the gold sunburst ──
F = LV.Painter(FIN, base=False)
F.fill(BLUE)
cov = F.cover
yc, zc = F.y[cov].mean(), F.z[cov].mean()
S = 1024
im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
c = S / 2
for k in range(16):                                   # rays, long and short
    a = k * math.pi / 8
    r1 = S * (0.48 if k % 2 == 0 else 0.36)
    w = 0.07 if k % 2 == 0 else 0.05
    pts = [(c + math.cos(a) * r1, c + math.sin(a) * r1), (c + math.cos(a + w) * S * 0.2, c + math.sin(a + w) * S * 0.2),
           (c + math.cos(a - w) * S * 0.2, c + math.sin(a - w) * S * 0.2)]
    d.polygon(pts, fill=GOLD)
d.ellipse([c - S * 0.21, c - S * 0.21, c + S * 0.21, c + S * 0.21], fill=GOLD)
d.ellipse([c - S * 0.15, c - S * 0.15, c + S * 0.15, c + S * 0.15], fill=BLUE)
d.ellipse([c - S * 0.11, c - S * 0.11, c + S * 0.11, c + S * 0.11], fill=GOLD)
# the fin is swept: the badge sits a little aft and up of the fin's centroid
F.decal(im, (0.0, yc + 0.35, zc + 0.15), (0, 1, 0), (0, 0, 1), 2.4, facing=(1, 0, 0), depth=2.0, min_dot=-2)
F.save(os.path.join(OUT, 'b747_fin.png'))

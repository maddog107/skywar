# ═══════════════════════════════════════════════════════════════
# F-5E: close the main-wheel and speed-brake bays on manilov.ap's F5 texture. The model came with its gear down and
# the bay doors open; with the legs and doors gone (tools/aircraft/IMPORTS.md) the bays' dark-painted floors read as
# holes in the belly. Their texels (dark grey, facing down, inside the bay box) are repainted in the belly's own
# camouflage grey, so the belly reads as closed doors.
#   blender -b -P tools/aircraft/bakemaps.py -- f5_stage.glb DIR --mat '^fuzel-FACES$'
#   python3 tools/aircraft/paint_f5.py DIR DIR/f5_paint.png
# Coordinates: the staged airframe (nose +Y, Z up, the source's units; centreline x −2.55).
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
bay = P.box((-7.4, -4.7, None), (2.3, -1.3, 3.3)).astype(bool)
dark = (lum < 0.36) & (sat < 0.14) & P.cover
well = bay & dark & (P.nz < 0.5)
skin = P.cover & bay & ~dark
print('bay texels', int(well.sum()))
# the bay floors are small islands of their own in the texture: they take the belly's light camouflage grey (the
# median of the skin round the bays), slightly shaded, as flush doors would
light = np.median(P.base[skin & (lum > np.median(lum[skin]))], 0)
P.out[well] = light * 0.94
P.save(OUT)

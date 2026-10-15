# Northrop F-5E Tiger II wingtip AIM-9 Sidewinders on the wingtip launch rails (the aggressor's usual fit).
#   /opt/homebrew/bin/blender -b -P tools/aircraft/f5_stores.py -- OUT.glb
# In the frame of the staged airframe (f5_stage.glb, tools/aircraft/IMPORTS.md): nose +Y, Z up, the source's own
# units (2.3154 to the metre), the centreline at x −2.55; the right wingtip rail runs at x 6.40–6.48, z 3.0–3.22,
# from y −0.5 (front) to −6.75.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stores_kit as SK

U = 2.3154                       # model units per metre
SK.begin()
nose = (6.62, 1.05, 3.06)
parts = SK.scale(SK.aim9('AIM9', nose), U, nose)
SK.mirror_x(parts, x0=-2.55)
SK.export(sys.argv[sys.argv.index('--') + 1])

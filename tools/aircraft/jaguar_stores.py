# SEPECAT Jaguar overwing missile launchers: the RAF's GR1A/GR3 (and the Jaguar International's) AIM-9 Sidewinder
# rails on tall pylons above the outer wing, the missile's nose well ahead of the leading edge.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/jaguar_stores.py -- OUT.glb
# In the frame of the staged airframe (jaguar_raw.glb, tools/aircraft/IMPORTS.md): nose +Y, centred, metres, Z up;
# the wing's upper skin at x 2.55 runs from z +0.05 (leading edge, y −1.85) to −0.02 (trailing edge, y −3.95). The
# pylon stands ahead of the outer flap; the rail and the missile ride on top of it.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stores_kit as SK

SK.begin()
X = 2.55
parts = []
parts.append(SK.blade('OverwingPylon', X, -1.75, -3.0, -0.07, 0.53, t=0.075, sweep_top=0.2, taper=0.9))
parts.append(SK.box('OverwingRail', (X - 0.05, -3.15, 0.52), (X + 0.05, -0.75, 0.605), 'Launcher', bevel=0.012))
parts += SK.aim9('AIM9', (X, -0.45, 0.675))
SK.mirror_x(parts)
SK.export(sys.argv[sys.argv.index('--') + 1])

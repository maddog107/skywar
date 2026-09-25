# Chengdu J-10A — SKYWAR aircraft kit spec.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/j10.py -- models/aircraft/j10.glb [--render DIR]
# Proportions measured off the three-view https://commons.wikimedia.org/wiki/File:Chengdu_J-10.svg
# (Kaboldy, CC BY-SA 3.0 — used only as a measuring reference). Length 16.9 m incl. probe, span 9.75 m.
# s = metres aft of the probe tip, z = up from the radome axis.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('j10', 16.9, paint='#8d989f', paint2='#838e95', radome='#5d6469')

K.loft('Fuselage', [
    S(0.85, 0.02, 0.02, 0.02, z=0.00, nt=1.9),
    S(1.80, 0.30, 0.29, 0.29, z=0.09, nt=2.0),
    S(2.90, 0.48, 0.49, 0.47, z=0.22, nt=2.1),
    S(4.30, 0.60, 0.50, 0.52, z=0.21, nt=2.4, nb=2.8),
    S(6.20, 0.70, 0.66, 0.60, z=0.30, nt=2.6, nb=3.2),
    S(8.00, 0.84, 0.82, 0.86, z=0.10, nt=2.8, nb=3.2, crown=0.1),
    S(11.0, 0.96, 0.80, 0.80, z=0.00, nt=2.8, nb=3.0, crown=0.1),
    S(13.7, 1.02, 0.76, 0.74, z=0.02, nt=2.8, nb=3.0),
    S(15.2, 0.66, 0.54, 0.54, z=0.15, nt=2.3),
], ring=44, register='Fuselage', mat_ranges=[(0.0, 2.0, 'Radome')])
K.probe('Pitot', 0.0, 0.9, 0.0, 0.035)

# rectangular chin intake with a splitter plate, merging into the belly
K.duct('Intake', [
    S(4.30, 0.60, 0.34, 0.34, z=-0.50, nt=6.0),
    S(6.40, 0.62, 0.36, 0.36, z=-0.50, nt=5.0),
    S(8.80, 0.52, 0.32, 0.32, z=-0.46, nt=4.0),
], rake=(0.0, -0.95), throat=1.2, mirror=False)
K.box('Splitter', 3.95, 5.40, -0.60, 0.60, -0.11, -0.08, material='Paint2')

# delta wing (54° LE sweep), close-coupled canards
K.surface('Wing', [
    (7.85, 13.66, 0.90, -0.05, 0.045),
    (10.4, 13.55, 2.60, -0.10, 0.038),
    (12.67, 13.43, 4.85, -0.15, 0.03),
], subdiv=4)
K.surface('Canard', [(5.10, 7.20, 0.62, 0.25, 0.04), (7.20, 7.67, 2.20, 0.30, 0.03)], material='Paint2', subdiv=2)

# big single fin, canted ventral strakes
K.fin('Fin', (11.2, 14.9), (15.7, 16.9, 2.76), t=0.045, t_tip=0.03, x=0.0, z=0.78)
for side in (1, -1):
    K.fin('Ventral' + ('R' if side > 0 else 'L'), (13.6, 15.4), (14.3, 15.2, 0.55), t=0.045, t_tip=0.035,
          cant=(180 - 32) * side, x=0.62 * side, z=-0.62)

K.nozzle('Nozzle', 15.1, 16.35, 0.0, 0.15, 0.56, 0.47, petals=True, petal_len=0.1, depth=0.6)

# bubble canopy with a windscreen bow
K.canopy([(2.85, 0.05, 0.02), (3.30, 0.36, 0.30), (4.00, 0.48, 0.52), (4.80, 0.50, 0.58), (5.50, 0.44, 0.44),
          (6.00, 0.28, 0.20), (6.25, 0.06, 0.03)], frames=[3.45], seat=(4.75, 0.0))

# wingtip-less delta: PL-8 missiles on outer pylons
K.missile('PL8', 10.9, 2.9, 3.6, -0.42, 0.08, mirror=True)
K.box('Pylon', 11.8, 12.9, 3.56, 3.64, -0.34, -0.12, material='Paint2', mirror=True)
K.lamp('NavLight', 12.9, 4.83, -0.15, mirror=True, r=0.05)
K.finish()

# Shenyang J-8II Finback-B — SKYWAR aircraft kit spec.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/j8.py -- models/aircraft/j8.glb [--render DIR]
# No free three-view was found; built from published dimensions (length 21.59 m, span 9.34 m, height
# 5.41 m, 60° delta, twin WP-13 engines) and period photographs: long radome nose, raked rectangular side
# intakes behind a small framed canopy, dorsal spine, tall swept fin and a big folding ventral fin.
# s = metres aft of the pitot tip.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('j8', 21.59, paint='#8f999e', paint2='#7f898e', radome='#e4e4dc')

K.loft('Fuselage', [
    S(0.90, 0.02, 0.02, 0.02, nt=1.9),
    S(2.00, 0.28, 0.28, 0.26, z=0.02, nt=2.0),
    S(3.40, 0.52, 0.54, 0.50, z=0.08, nt=2.1),
    S(5.00, 0.66, 0.72, 0.66, z=0.14, nt=2.3, nb=2.8),
    S(7.00, 0.72, 0.80, 0.78, z=0.16, nt=2.6, nb=3.4),
    S(10.0, 1.05, 0.84, 0.86, z=0.16, nt=3.0, nb=3.8, crown=0.2),
    S(14.0, 1.22, 0.86, 0.86, z=0.16, nt=3.2, nb=4.0, crown=0.25),
    S(18.0, 1.18, 0.80, 0.80, z=0.14, nt=3.2, nb=4.0, crown=0.25),
    S(20.6, 1.08, 0.70, 0.70, z=0.12, nt=3.0, nb=3.6, crown=0.2),
], ring=48, register='Fuselage', mat_ranges=[(0.0, 3.0, 'Radome')])
K.probe('Pitot', 0.0, 0.95, 0.0, 0.04)

# raked rectangular side intakes with splitter gap
K.duct('Intake', [
    S(6.30, 0.34, 0.60, 0.60, x=1.02, z=0.02, nt=6.0),
    S(8.40, 0.38, 0.64, 0.64, x=1.06, z=0.06, nt=5.5),
    S(11.0, 0.30, 0.58, 0.58, x=0.98, z=0.10, nt=4.5),
    S(12.8, 0.12, 0.30, 0.30, x=0.90, z=0.12, nt=3.0),
], rake=(0.0, -0.55), throat=1.4)

# mid-set 60° delta with clipped tips and two fences each side
K.surface('Wing', [
    (9.80, 17.00, 1.15, -0.12, 0.045),
    (12.9, 16.95, 2.90, -0.18, 0.038),
    (15.80, 16.85, 4.67, -0.24, 0.03),
], subdiv=4)
for x in (2.2, 3.4):
    K.box('Fence', 11.0 + (x - 2.2) * 1.7, 16.9, x - 0.015, x + 0.015, -0.2, -0.02, material='Paint2', mirror=True)
K.surface('Stab', [(18.30, 20.30, 0.95, -0.05, 0.04), (20.00, 20.90, 2.85, -0.20, 0.03)], material='Paint2', subdiv=2)
K.fin('Fin', (15.0, 20.7), (19.4, 20.55, 2.75), t=0.045, t_tip=0.03, x=0.0, z=0.86, mid=[(16.4, 20.7, 0.12)])
K.fin('Ventral', (17.8, 20.0), (18.9, 20.2, 1.0), t=0.05, t_tip=0.04, cant=180, x=0.0, z=-0.62)

K.nozzle('Nozzle', 20.35, 21.59, 0.52, 0.10, 0.48, 0.44, mirror=True, depth=0.6)

# small framed canopy and dorsal spine
K.canopy([(4.20, 0.05, 0.02), (4.60, 0.36, 0.28), (5.20, 0.44, 0.44), (5.90, 0.44, 0.46), (6.50, 0.36, 0.34),
          (7.00, 0.18, 0.12), (7.30, 0.05, 0.02)], frames=[4.75, 5.95], seat=(5.8, 0.0))
K.loft('Spine', [S(7.0, 0.05, 0.05, z=0.88), S(8.0, 0.30, 0.18, 0.1, z=0.9), S(15.5, 0.26, 0.14, 0.1, z=0.98), S(17.0, 0.05, 0.05, z=0.98)], ring=16)

K.missile('PL8', 13.3, 2.9, 3.4, -0.62, 0.08, mirror=True)
K.box('Pylon', 14.1, 15.3, 3.36, 3.44, -0.52, -0.2, material='Paint2', mirror=True)
K.lamp('NavLight', 16.4, 4.67, -0.24, mirror=True, r=0.05)
K.finish()

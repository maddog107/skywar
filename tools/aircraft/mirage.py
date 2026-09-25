# Dassault Mirage IIIE — SKYWAR aircraft kit spec.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/mirage.py -- models/aircraft/mirage.glb [--render DIR]
# Proportions from the public-domain three-view
#   https://commons.wikimedia.org/wiki/File:Dassault_Mirage_III_3-view_line_drawing.png
# and published dimensions: length 15.03 m, span 8.22 m, 60° tailless delta.
# s = metres aft of the pitot tip, z = up from the radome axis.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('mirage', 15.03, paint='#a3aaa0', paint2='#939a90', radome='#3d4038')

K.loft('Fuselage', [
    S(0.75, 0.02, 0.02, 0.02, nt=1.9),
    S(1.80, 0.20, 0.20, 0.20, z=0.02, nt=2.0),
    S(3.00, 0.36, 0.38, 0.36, z=0.08, nt=2.0),
    S(4.40, 0.50, 0.55, 0.50, z=0.14, nt=2.1),
    S(6.20, 0.58, 0.62, 0.60, z=0.18, nt=2.2),
    S(8.50, 0.60, 0.62, 0.62, z=0.20, nt=2.3),
    S(11.5, 0.62, 0.60, 0.60, z=0.20, nt=2.3),
    S(13.8, 0.56, 0.54, 0.54, z=0.20, nt=2.2),
], ring=44, register='Fuselage', mat_ranges=[(0.0, 2.3, 'Radome')])
K.probe('Pitot', 0.0, 0.8, 0.0, 0.03)

# semicircular side intakes with half-cone shock bodies ("souris")
K.duct('Intake', [
    S(4.50, 0.30, 0.46, 0.46, x=0.62, z=0.12, nt=2.2),
    S(6.00, 0.34, 0.50, 0.50, x=0.64, z=0.14, nt=2.2),
    S(8.20, 0.28, 0.44, 0.44, x=0.58, z=0.16, nt=2.2),
    S(9.60, 0.10, 0.20, 0.20, x=0.50, z=0.18, nt=2.2),
], throat=1.0)
for side in (1, -1):
    K.loft('ShockBody' + ('R' if side > 0 else 'L'), [S(3.90, 0.02, 0.02, x=side * 0.50, z=0.12), S(4.50, 0.16, 0.20, x=side * 0.50, z=0.12),
                                                       S(5.00, 0.20, 0.26, x=side * 0.50, z=0.12)], material='Paint2', ring=16)

# tailless delta, conical camber, clipped tips; elevons are part of the wing
K.surface('Wing', [
    (6.40, 13.20, 0.62, -0.10, 0.045),
    (9.60, 13.10, 2.45, -0.14, 0.038),
    (12.40, 13.05, 4.11, -0.18, 0.03),
], subdiv=4)
K.fin('Fin', (9.9, 14.2), (13.8, 14.95, 2.35), t=0.045, t_tip=0.03, x=0.0, z=0.72, mid=[(11.0, 14.4, 0.12)])
K.fin('Ventral', (12.0, 13.6), (12.8, 13.8, 0.45), t=0.045, t_tip=0.035, cant=180, x=0.0, z=-0.38)

K.nozzle('Nozzle', 13.7, 15.03, 0.0, 0.20, 0.54, 0.48, depth=0.6)

# bubble canopy fairing into the spine
K.canopy([(3.35, 0.05, 0.02), (3.70, 0.34, 0.26), (4.30, 0.42, 0.40), (5.00, 0.42, 0.42), (5.60, 0.36, 0.32),
          (6.20, 0.20, 0.14), (6.60, 0.05, 0.02)], frames=[3.85], seat=(4.9, 0.0))
K.loft('Spine', [S(6.3, 0.05, 0.05, z=0.72), S(7.2, 0.24, 0.16, 0.1, z=0.72), S(12.0, 0.20, 0.14, 0.1, z=0.72), S(13.8, 0.05, 0.05, z=0.72)], ring=16)

# Matra R.550 Magic missiles under the wings, centreline tank
K.missile('Magic', 8.6, 2.75, 2.7, -0.52, 0.08, mirror=True)
K.box('Pylon', 9.3, 10.6, 2.66, 2.74, -0.42, -0.16, material='Paint2', mirror=True)
K.loft('DropTank', [S(6.2, 0.02, 0.02, z=-0.95), S(7.0, 0.25, 0.25, z=-0.95), S(9.6, 0.27, 0.27, z=-0.95), S(10.8, 0.05, 0.05, z=-0.95)], ring=16)
K.box('TankPylon', 7.6, 9.4, -0.03, 0.03, -0.72, -0.4, material='Paint2')
K.lamp('NavLight', 12.8, 4.11, -0.18, mirror=True, r=0.045)
K.finish()

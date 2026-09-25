# MiG-21bis Fishbed-L — SKYWAR aircraft kit spec.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/mig21.py -- models/aircraft/mig21.glb [--render DIR]
# Proportions from the public-domain three-view
#   https://commons.wikimedia.org/wiki/File:Mikoyan-Gurevich_MiG-21_3-view_line_drawing.png
# and published dimensions: length 14.5 m (fuselage + pitot as the game uses it), span 7.15 m, 57° delta.
# s = metres aft of the pitot tip, z = up from the intake axis.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('mig21', 14.5, paint='#a7aeb1', paint2='#979fa3', radome='#44503f')

# nose ring intake with the translating shock cone
K.duct('NoseIntake', [
    S(1.25, 0.44, 0.44, 0.44, nt=2.0),
    S(2.40, 0.54, 0.56, 0.54, z=0.02, nt=2.0),
    S(3.20, 0.58, 0.62, 0.58, z=0.04, nt=2.1),
], throat=1.0, mirror=False, lip=0.05, inner_scale=0.9)
K.loft('ShockCone', [S(0.55, 0.02, 0.02), S(0.95, 0.17, 0.17), S(1.35, 0.30, 0.30), S(1.60, 0.33, 0.33)], material='Radome', ring=20)
K.probe('Pitot', 0.0, 1.0, -0.36, 0.035)
K.box('PitotBoom', 0.9, 1.3, -0.02, 0.02, -0.38, -0.30, material='Dark')

K.loft('Fuselage', [
    S(3.10, 0.57, 0.61, 0.57, z=0.04, nt=2.1),
    S(4.50, 0.60, 0.64, 0.60, z=0.05, nt=2.1),
    S(7.00, 0.63, 0.62, 0.62, z=0.05, nt=2.1),
    S(10.0, 0.60, 0.58, 0.60, z=0.06, nt=2.1),
    S(12.4, 0.54, 0.52, 0.54, z=0.06, nt=2.0),
    S(13.7, 0.47, 0.47, 0.47, z=0.06, nt=2.0),
], ring=40, register='Fuselage')
# the fat dorsal spine (fuel) behind the canopy that makes the 'bis' shape
K.loft('Spine', [S(4.60, 0.16, 0.06, 0.05, z=0.60), S(5.60, 0.28, 0.26, 0.1, z=0.60, nt=2.4), S(9.5, 0.28, 0.30, 0.1, z=0.58, nt=2.4),
                 S(11.2, 0.18, 0.16, 0.1, z=0.58), S(12.0, 0.05, 0.04, 0.04, z=0.58)], ring=24)

# mid-low 57° delta with clipped tips, two fences per side
K.surface('Wing', [
    (5.90, 11.00, 0.55, -0.18, 0.045),
    (8.40, 11.05, 2.10, -0.22, 0.04),
    (10.55, 11.15, 3.575, -0.26, 0.035),
], subdiv=4)
for x in (1.6, 2.8):
    K.box('Fence', 7.7 + (x - 1.6) * 1.2, 11.0, x - 0.012, x + 0.012, -0.22, -0.08, material='Paint2', mirror=True)

# swept all-moving stabilator, tall swept fin with dorsal fillet, ventral fin
K.surface('Stab', [(11.65, 13.25, 0.42, -0.10, 0.04), (13.05, 13.60, 1.30, -0.12, 0.03)], material='Paint2', subdiv=2)
K.fin('Fin', (10.0, 13.5), (12.85, 13.85, 2.25), t=0.045, t_tip=0.03, x=0.0, z=0.56, mid=[(10.9, 13.55, 0.18)])
K.fin('Ventral', (12.1, 13.3), (12.8, 13.35, 0.62), t=0.045, t_tip=0.035, cant=180, x=0.0, z=-0.45)

# afterburner nozzle with petals
K.nozzle('Nozzle', 13.55, 14.5, 0.0, 0.06, 0.47, 0.42, petals=True, petal_len=0.08, depth=0.6)

# small framed canopy with windscreen
K.canopy([(3.55, 0.05, 0.02), (3.85, 0.30, 0.24), (4.30, 0.36, 0.36), (4.90, 0.34, 0.34), (5.40, 0.26, 0.24),
          (5.75, 0.10, 0.06)], frames=[3.95, 4.55], seat=(4.6, 0.0), sink=0.04)

# R-60 missiles on the outer pylons, drop tank on the centreline
K.missile('R60', 8.3, 2.1, 2.55, -0.52, 0.065, mirror=True)
K.box('Pylon', 8.8, 9.9, 2.52, 2.58, -0.46, -0.22, material='Paint2', mirror=True)
K.loft('DropTank', [S(6.0, 0.02, 0.02, z=-0.95), S(6.7, 0.22, 0.22, z=-0.95), S(8.8, 0.25, 0.25, z=-0.95), S(9.8, 0.05, 0.05, z=-0.95)], ring=16)
K.box('TankPylon', 7.2, 8.6, -0.03, 0.03, -0.72, -0.5, material='Paint2')
K.lamp('NavLight', 10.9, 3.575, -0.26, mirror=True, r=0.045)
K.finish()

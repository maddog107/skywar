# Northrop F-5E Tiger II — SKYWAR aircraft kit spec.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/f5.py -- models/aircraft/f5.glb [--render DIR]
# Proportions measured off the three-view https://commons.wikimedia.org/wiki/File:Northrop_F-5E_Tiger_II_3-view.svg
# (Kaboldy, CC BY-SA 3.0 — used only as a measuring reference). Length 14.45 m incl. probe, span 8.13 m over
# the wingtip missiles. s = metres aft of the probe tip, z = up from the probe axis.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('f5', 14.45, paint='#b39f7c', paint2='#98845f', radome='#3b3d3f')

K.loft('Fuselage', [
    S(0.69, 0.02, 0.02, 0.02, z=0.00, nt=1.8),
    S(1.60, 0.15, 0.14, 0.14, z=0.03, nt=1.9),
    S(2.70, 0.25, 0.25, 0.25, z=0.09, nt=2.0),
    S(4.20, 0.42, 0.46, 0.48, z=0.29, nt=2.2, nb=2.4),
    S(6.00, 0.46, 0.52, 0.52, z=0.33, nt=2.4, nb=2.8),
    S(8.00, 0.60, 0.64, 0.62, z=0.50, nt=2.6, nb=3.2),
    S(10.5, 0.74, 0.51, 0.52, z=0.56, nt=2.8, nb=3.2, crown=0.15),
    S(12.5, 0.62, 0.40, 0.40, z=0.58, nt=2.8, nb=3.0, crown=0.1),
    S(13.5, 0.46, 0.31, 0.30, z=0.58, nt=2.6),
], ring=44, register='Fuselage', mat_ranges=[(0.0, 1.7, 'Radome')])
K.probe('Pitot', 0.0, 0.72, 0.0, 0.03)

# D-shaped side intakes ahead of the wing, fed past small splitter plates
K.duct('Intake', [
    S(6.00, 0.21, 0.42, 0.42, x=0.68, z=0.30, nt=3.2),
    S(7.60, 0.25, 0.46, 0.46, x=0.72, z=0.36, nt=3.0),
    S(9.50, 0.20, 0.40, 0.40, x=0.62, z=0.44, nt=2.6),
    S(10.8, 0.08, 0.20, 0.20, x=0.50, z=0.50, nt=2.4),
], rake=(0.35, 0.0), throat=1.1)

# LERX strakes, low wing (24° LE sweep), wingtip AIM-9 rails
K.surface('LERX', [(6.00, 8.80, 0.40, 0.25, 0.03), (8.00, 8.80, 1.30, 0.20, 0.03)], subdiv=2)
K.surface('Wing', [
    (8.15, 10.70, 0.70, 0.14, 0.048),
    (9.60, 10.55, 2.60, 0.10, 0.04),
    (10.45, 11.10, 3.86, 0.07, 0.035),
], subdiv=4)
K.missile('AIM9', 8.2, 2.9, 4.07, 0.07, 0.065, mirror=True)
K.box('TipRail', 8.9, 10.9, 3.86, 4.02, 0.03, 0.10, material='Paint2', mirror=True)

# low-set all-moving tailplane, big single fin
K.surface('Stab', [(12.10, 13.60, 0.50, 0.20, 0.04), (12.96, 13.50, 2.10, 0.18, 0.03)], material='Paint2', subdiv=2)
K.fin('Fin', (10.7, 13.8), (12.46, 13.20, 2.1), t=0.045, t_tip=0.03, x=0.0, z=1.08, mid=[(11.2, 13.6, 0.12)])

# twin J85 nozzles close together
K.nozzle('Nozzle', 13.3, 14.45, 0.21, 0.52, 0.22, 0.20, mirror=True, depth=0.5)

# canopy: windscreen + long clamshell, with a bow
K.canopy([(4.15, 0.05, 0.02), (4.55, 0.34, 0.28), (5.20, 0.42, 0.48), (5.90, 0.42, 0.50), (6.50, 0.36, 0.38),
          (7.00, 0.18, 0.14), (7.25, 0.05, 0.02)], frames=[4.7], seat=(5.65, 0.0))
K.lamp('NavLight', 10.6, 3.86, 0.07, mirror=True, r=0.04)
K.finish()

# SEPECAT Jaguar — SKYWAR aircraft kit spec.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/jaguar.py -- models/aircraft/jaguar.glb [--render DIR]
# Proportions from the public-domain three-view
#   https://commons.wikimedia.org/wiki/File:SEPECAT_Jaguar_3-view_line_drawing.png
# and published dimensions: length 16.83 m, span 8.69 m. s = metres aft of the probe tip.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('jaguar', 16.83, paint='#6b7a5c', paint2='#5a6750', radome='#2e3230',
        panel={'key': 'camo', 'camo': 0.38})

K.loft('Fuselage', [
    S(0.55, 0.02, 0.02, 0.02, nt=1.8),
    S(1.40, 0.22, 0.24, 0.20, z=-0.02, nt=2.0),
    S(2.60, 0.42, 0.48, 0.42, z=0.04, nt=2.4, nb=2.8),
    S(4.20, 0.55, 0.66, 0.60, z=0.10, nt=2.6, nb=3.4),
    S(6.20, 0.60, 0.72, 0.72, z=0.10, nt=2.8, nb=3.8),
    S(9.00, 0.78, 0.74, 0.78, z=0.08, nt=3.0, nb=4.0, crown=0.15),
    S(12.5, 0.80, 0.66, 0.78, z=0.06, nt=3.0, nb=4.0, crown=0.15),
    S(15.0, 0.74, 0.52, 0.70, z=0.06, nt=2.8, nb=3.8),
    S(16.4, 0.66, 0.36, 0.64, z=0.02, nt=2.6, nb=3.4),
], ring=44, register='Fuselage', mat_ranges=[(0.0, 1.2, 'Radome')])
K.probe('Pitot', 0.0, 0.62, 0.0, 0.03)

# rectangular side intakes under the cockpit sill, splitter plates
K.duct('Intake', [
    S(5.20, 0.30, 0.44, 0.44, x=0.78, z=-0.04, nt=6.0),
    S(7.20, 0.32, 0.46, 0.46, x=0.84, z=-0.02, nt=5.0),
    S(9.60, 0.26, 0.40, 0.40, x=0.72, z=0.00, nt=4.0),
    S(11.2, 0.10, 0.20, 0.20, x=0.60, z=0.02, nt=3.0),
], rake=(0.0, -0.3), throat=1.1)

# shoulder wing, 40° quarter-chord sweep, 3° anhedral
K.surface('Wing', [
    (7.80, 11.30, 0.80, 0.80, 0.042),
    (9.90, 12.30, 2.80, 0.70, 0.036),
    (11.65, 12.90, 4.345, 0.58, 0.03),
], subdiv=4)
# all-moving tailplane with 10° anhedral, single swept fin
K.surface('Stab', [(14.0, 16.3, 0.60, 0.05, 0.04), (15.8, 16.45, 2.30, -0.25, 0.03)], material='Paint2', subdiv=2)
K.fin('Fin', (12.6, 16.6), (15.9, 16.83, 2.25), t=0.045, t_tip=0.03, x=0.0, z=0.78, mid=[(13.4, 16.6, 0.12)])
for side in (1, -1):
    K.fin('Ventral' + ('R' if side > 0 else 'L'), (14.8, 16.0), (15.4, 16.1, 0.5), t=0.045, t_tip=0.035,
          cant=(180 - 25) * side, x=0.42 * side, z=-0.62)

# twin Adour nozzles low under the tail
K.nozzle('Nozzle', 15.6, 16.55, 0.40, -0.30, 0.36, 0.33, mirror=True, depth=0.5)

# raised canopy
K.canopy([(2.75, 0.05, 0.02), (3.10, 0.36, 0.28), (3.70, 0.46, 0.46), (4.40, 0.46, 0.50), (5.00, 0.40, 0.40),
          (5.60, 0.24, 0.20), (6.00, 0.05, 0.02)], frames=[3.25], seat=(4.3, 0.0))
K.loft('Spine', [S(5.8, 0.05, 0.05, z=0.76), S(6.6, 0.26, 0.14, 0.1, z=0.76), S(12.4, 0.24, 0.12, 0.1, z=0.74), S(13.4, 0.05, 0.05, z=0.72)], ring=16)

# overwing Magic rails, underwing tanks
K.missile('Magic', 9.4, 2.75, 2.2, 1.05, 0.08, mirror=True)
K.box('OverwingRail', 10.2, 11.6, 2.16, 2.24, 0.72, 0.98, material='Paint2', mirror=True)
for side in (1, -1):
    x = 1.85 * side
    K.loft('Tank' + ('R' if side > 0 else 'L'), [S(8.0, 0.02, 0.02, x=x, z=-0.05), S(8.8, 0.24, 0.24, x=x, z=-0.05),
                                                 S(11.0, 0.26, 0.26, x=x, z=-0.05), S(12.2, 0.05, 0.05, x=x, z=-0.05)], ring=16)
K.box('TankPylon', 9.2, 10.8, 1.81, 1.89, 0.2, 0.72, material='Paint2', mirror=True)
K.lamp('NavLight', 12.3, 4.345, 0.58, mirror=True, r=0.045)
K.finish()

# Chengdu J-20 — SKYWAR aircraft kit spec.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/j20.py -- models/aircraft/j20.glb [--render DIR]
# Proportions measured off the three-view https://commons.wikimedia.org/wiki/File:Chengdu_J-20.svg
# (Kaboldy, CC BY-SA 3.0 — used only as a measuring reference; nothing from it is copied into the model).
# Length 20.4 m, span 13.0 m. s = metres aft of the radome tip, z = up from the radome axis.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('j20', 20.4, paint='#5c636b', paint2='#545b63', radome='#4a5057', gold=True)

K.loft('Fuselage', [
    S(0.00, 0.02, 0.02, 0.02, z=0.00, nt=1.6),
    S(1.00, 0.40, 0.33, 0.30, z=0.02, nt=1.6, nb=1.7),
    S(2.20, 0.73, 0.60, 0.50, z=0.04, nt=1.7, nb=1.8),
    S(3.50, 0.95, 0.78, 0.64, z=0.06, nt=1.9, nb=1.9),
    S(5.00, 1.18, 0.84, 0.76, z=0.06, nt=2.1, nb=2.2),
    S(6.60, 1.55, 0.74, 0.86, z=0.06, nt=2.6, nb=3.0, crown=0.25),
    S(8.50, 2.05, 0.62, 0.95, z=0.04, nt=3.0, nb=3.6, crown=0.4),
    S(11.0, 2.30, 0.58, 1.00, z=0.02, nt=3.2, nb=4.0, crown=0.4),
    S(14.0, 2.35, 0.56, 0.95, z=0.02, nt=3.2, nb=4.0, crown=0.4),
    S(16.5, 1.95, 0.55, 0.80, z=0.00, nt=3.2, nb=3.8, crown=0.35),
    S(18.4, 1.62, 0.52, 0.66, z=-0.05, nt=3.0, nb=3.4, crown=0.3),
    S(19.0, 1.55, 0.50, 0.62, z=-0.08, nt=3.0, nb=3.2, crown=0.3),
], ring=48, register='Fuselage', mat_ranges=[(0.0, 1.6, 'Radome')])

# caret intakes under the canard roots, with the diverterless (DSI) bumps ahead of them
K.duct('Intake', [
    S(5.50, 0.48, 0.62, 0.62, x=1.72, z=-0.24, nt=4.0),
    S(7.60, 0.50, 0.62, 0.62, x=1.80, z=-0.22, nt=4.0),
    S(10.4, 0.44, 0.55, 0.60, x=1.72, z=-0.20, nt=3.6),
    S(12.4, 0.30, 0.40, 0.45, x=1.55, z=-0.18, nt=3.2),
], rake=(0.55, -0.35), throat=1.5)
K.ellipsoid('DSI', 5.0, 1.12, -0.12, 0.75, 0.16, 0.36, mirror=True)
# chine / LERX shoulders from the forebody to the wing root
K.surface('Shoulder', [(4.8, 12.5, 1.05, 0.30, 0.03), (8.6, 12.0, 2.30, 0.28, 0.035)], subdiv=2)

# cranked delta wing
K.surface('Wing', [
    (11.3, 17.5, 2.20, 0.06, 0.045),
    (14.2, 17.5, 4.60, 0.00, 0.038),
    (16.0, 17.65, 6.60, -0.08, 0.032),
], subdiv=3)
# canards (slight anhedral)
K.surface('Canard', [(6.40, 9.00, 2.00, 0.45, 0.04), (8.70, 9.35, 3.95, 0.36, 0.03)], material='Paint2', subdiv=2)
# all-moving twin fins, canted 28°; ventral fins canted out 30°
for side in (1, -1):
    K.fin('Fin' + ('R' if side > 0 else 'L'), (16.7, 19.3), (19.1, 20.4, 2.3), t=0.045, t_tip=0.03, cant=28 * side, x=1.62 * side, z=0.40)
    K.fin('Ventral' + ('R' if side > 0 else 'L'), (17.4, 19.5), (18.3, 19.2, 0.8), t=0.045, t_tip=0.035, cant=(180 - 30) * side, x=1.15 * side, z=-0.72)
    K.loft('Boom' + ('R' if side > 0 else 'L'), [S(15.0, 0.05, 0.05, x=side * 2.15, z=0.0), S(16.3, 0.24, 0.13, 0.13, x=side * 2.15, z=0.0),
                                                 S(19.4, 0.18, 0.10, 0.10, x=side * 2.12, z=0.0), S(20.35, 0.04, 0.03, 0.03, x=side * 2.1, z=0.0)], ring=16)

# twin engines with serrated nozzles
K.nozzle('Nozzle', 18.7, 20.05, 0.84, -0.26, 0.64, 0.58, petals=True, petal_len=0.14, mirror=True, depth=0.7)

# long one-piece gold-tinted canopy
K.canopy([(2.65, 0.05, 0.02), (3.15, 0.42, 0.32), (3.90, 0.58, 0.54), (4.60, 0.62, 0.62), (5.40, 0.56, 0.52),
          (6.10, 0.38, 0.28), (6.55, 0.08, 0.04)], seat=(4.9, 0.0))

K.lamp('NavLight', 16.8, 6.60, -0.08, mirror=True, r=0.06)
K.finish()

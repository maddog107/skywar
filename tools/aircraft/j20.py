# Chengdu J-20 — SKYWAR aircraft kit spec.
#   python3 tools/aircraft/markings.py   (once: the insignia / bort-number images)
#   /opt/homebrew/bin/blender -b -P tools/aircraft/j20.py -- models/aircraft/j20.glb [--render DIR]
# Proportions measured off the three-view https://commons.wikimedia.org/wiki/File:Chengdu_J-20.svg
# (Kaboldy, CC BY-SA 3.0 — used only as a measuring reference; nothing from it is copied into the model), scaled
# to 20.4 m from the radome tip to the fin tips; the production jet's frameless gold-tinted canopy and no nose
# probe. s = metres aft of the radome tip, z = up from the radome tip's level.
# Shape: chined forebody, caret intakes with diverterless bumps under big canards, a flat wide centre body with
# tail booms carrying the canted all-moving fins and the ventral fins, cranked delta wing, two AL-31FN nozzles.
# Finish: PLAAF dark grey with lighter-grey door outlines (sawtooth fore and aft edges: side and ventral weapon
# bays, gear doors), the PLAAF insignia on the fins and wings, bort number 62012 in black with a yellow edge;
# panel lines, ambient occlusion and the markings baked into one texture atlas (aircraft_kit finish(atlas=...)).
import os, sys, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('j20', 20.4, paint='#636b73', paint2='#59616a', radome='#5c646c', gold=True,
        panel={'key': 'panel', 'line': 0.80, 'grime': 0.03})

# chined forebody → wide flat centre body over the intake trunks → twin-engine rear end
K.loft('Fuselage', [
    S(0.00, 0.02, 0.02, 0.02, z=-0.15, nt=1.5),
    S(1.00, 0.50, 0.27, 0.27, z=-0.13, nt=1.35, nb=1.6),
    S(2.00, 0.78, 0.50, 0.63, z=-0.05, nt=1.45, nb=1.8),
    S(3.00, 0.86, 0.62, 0.85, z=0.00, nt=1.65, nb=2.0),
    S(4.50, 0.95, 0.65, 1.00, z=0.04, nt=1.9, nb=2.4),
    S(5.50, 1.05, 0.72, 1.06, z=0.05, nt=2.1, nb=2.8, crown=0.15),
    S(7.00, 1.80, 0.80, 1.03, z=-0.04, nt=3.0, nb=3.4, crown=0.45),
    S(9.00, 1.90, 0.77, 1.10, z=-0.05, nt=3.2, nb=3.8, crown=0.5),
    S(11.5, 1.88, 0.72, 1.10, z=-0.10, nt=3.2, nb=3.8, crown=0.5),
    S(14.0, 1.72, 0.69, 1.04, z=-0.15, nt=3.0, nb=3.6, crown=0.45),
    S(16.0, 1.55, 0.71, 0.95, z=-0.20, nt=2.8, nb=3.2, crown=0.4),
    S(17.5, 1.44, 0.72, 0.76, z=-0.26, nt=2.6, nb=2.8, crown=0.3),
    S(18.2, 1.42, 0.62, 0.64, z=-0.32, nt=2.4, nb=2.6, crown=0.2),
], ring=60, register='Fuselage', mat_ranges=[(0.0, 1.9, 'Radome')])

# caret intakes (swept and raked lips, the outer lip forward) with the diverterless bumps ahead of them
K.duct('Intake', [
    S(5.45, 0.42, 0.56, 0.56, x=1.40, z=-0.36, nt=4.0),
    S(7.00, 0.45, 0.58, 0.58, x=1.45, z=-0.38, nt=4.0),
    S(9.00, 0.40, 0.52, 0.55, x=1.35, z=-0.38, nt=3.6),
    S(11.0, 0.24, 0.36, 0.40, x=1.10, z=-0.36, nt=3.0),
], rake=(-0.82, -0.32), throat=1.6)
K.ellipsoid('DSI', 4.95, 1.02, -0.28, 0.85, 0.17, 0.42, mirror=True)

# big canards, a little anhedral
K.surface('Canard', [(6.53, 9.02, 1.70, 0.20, 0.045), (7.60, 9.20, 2.90, 0.14, 0.04), (8.73, 9.36, 3.95, 0.08, 0.03)],
          material='Paint2', subdiv=2)
# cranked delta: the LERX from the canard root out to the boom, then the outer wing to the tip
K.surface('Wing', [
    (9.20, 18.60, 1.60, 0.14, 0.04),
    (10.30, 18.60, 2.10, 0.13, 0.04),
    (11.56, 18.53, 2.48, 0.11, 0.038),
    (14.00, 17.98, 4.85, -0.01, 0.034),
    (16.00, 17.55, 6.81, -0.12, 0.03),
], subdiv=3)
# tail booms along the wing root, the canted all-moving fins on them, ventral fins under them
for side in (1, -1):
    sx = 'R' if side > 0 else 'L'
    K.loft('Boom' + sx, [S(11.4, 0.04, 0.04, x=side * 2.28, z=0.06), S(12.6, 0.22, 0.16, 0.20, x=side * 2.28, z=0.06, nt=2.6),
                         S(19.4, 0.22, 0.18, 0.22, x=side * 2.28, z=0.06, nt=2.6), S(20.15, 0.10, 0.08, 0.10, x=side * 2.26, z=0.06)], ring=18)
    K.fin('Fin' + sx, (16.65, 19.30), (19.00, 20.30, 2.30), t=0.045, t_tip=0.03, cant=28 * side, x=2.10 * side, z=0.22)
    K.fin('Ventral' + sx, (17.45, 19.55), (18.10, 19.10, 0.95), t=0.045, t_tip=0.035, cant=(180 - 32) * side, x=2.15 * side, z=-0.14)

# two AL-31FN nozzles with serrated edges
K.nozzle('Nozzle', 18.0, 19.30, 0.79, -0.45, 0.62, 0.55, petals=True, petal_len=0.13, mirror=True, depth=0.75)

# one-piece frameless gold-tinted canopy
K.canopy([(2.70, 0.05, 0.02), (3.20, 0.42, 0.34), (3.90, 0.56, 0.55), (4.60, 0.60, 0.60), (5.30, 0.54, 0.48),
          (5.90, 0.36, 0.26), (6.30, 0.08, 0.04)], seat=(4.75, 0.0))
# the EOTS window under the nose, blade antennas
K.ellipsoid('EOTS', 2.6, 0.0, -0.62, 0.30, 0.16, 0.10, material='Dark')
K.box('AntDorsal', 9.6, 10.0, -0.012, 0.012, 0.76, 0.9, material='Paint2')
K.box('AntVentral', 6.0, 6.3, -0.012, 0.012, -1.20, -1.06, material='Paint2')
K.lamp('NavLight', 16.6, 6.82, -0.12, mirror=True, r=0.05)

# ── markings (tools/aircraft/markings) ──
fin_n = (math.cos(math.radians(28)), 0, -math.sin(math.radians(28)))          # the right fin's outer face
K.decal('plaaf_bars.png', (18.6, 2.70, 1.05), (1.25, 0.50), fin_n, up=(math.sin(math.radians(28)), 0, math.cos(math.radians(28))), depth=0.3)
for nz in (1, -1):
    K.decal('plaaf_bars.png', (16.55, 5.6, -0.05), (1.55, 0.62), (0, 0, nz), depth=0.4)
K.decal('bort_j20.png', (1.95, 0.70, -0.20), (1.15, 0.35), (1, 0, 0.12), depth=0.4, facing=0.55)
K.decal('warning.png', (2.85, 0.70, 0.30), (0.2, 0.2), (1, 0, 0.4), depth=0.3, facing=0.5)
# lighter-grey sawtooth door outlines: side weapon bays behind the intakes, the ventral bays, the gear doors
K.decal('saw_door.png', (9.4, 1.82, -0.62), (2.6, 0.62), (1, 0, -0.15), depth=0.35, facing=0.45, mats=('Paint',))
for x in (0.38,):
    K.decal('saw_door.png', (11.2, x, -1.18), (4.4, 0.66), (0, 0, -1), up=(1, 0, 0), depth=0.3, mats=('Paint',))
K.decal('saw_door.png', (13.6, 1.15, -1.12), (2.0, 0.55), (0, 0, -1), up=(1, 0, 0), depth=0.3, mats=('Paint',))
K.decal('saw_door.png', (4.2, 0.0, -0.98), (1.8, 0.42), (0, 0, -1), up=(1, 0, 0), depth=0.3, mirror=False, mats=('Paint',))
K.decal('panel.png', (8.0, 0.0, 0.79), (2.4, 0.5), (0, 0, 1), up=(1, 0, 0), depth=0.3, mirror=False)
K.finish(atlas=2048, ao=0.55)

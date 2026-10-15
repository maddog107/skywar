# Chengdu J-10A — SKYWAR aircraft kit spec.
#   python3 tools/aircraft/markings.py   (once: the insignia / bort-number images)
#   /opt/homebrew/bin/blender -b -P tools/aircraft/j10.py -- models/aircraft/j10.glb [--render DIR]
# Proportions measured off the three-view https://commons.wikimedia.org/wiki/File:Chengdu_J-10.svg
# (Kaboldy, CC BY-SA 3.0 — used only as a measuring reference; nothing from it is copied into the model).
# Length 16.9 m incl. probe, span 9.75 m. s = metres aft of the probe tip, z = up from the radome axis.
# Finish: PLAAF light grey with a darker radome, the PLAAF insignia (star, 八一 and bars) on the fin and both
# wing surfaces, red bort number 41112 on the nose, ejection warning triangles; panel lines, ambient occlusion and
# the markings are baked into one texture atlas (aircraft_kit finish(atlas=...)).
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('j10', 16.9, paint='#a3abb0', paint2='#9aa2a7', radome='#646c71',
        panel={'key': 'panel', 'line': 0.74, 'grime': 0.04})

# fuselage: pointed radome, cockpit, the tall mid-section over the chin intake, round rear end
K.loft('Fuselage', [
    S(0.85, 0.02, 0.02, 0.02, z=0.00, nt=1.9),
    S(1.50, 0.32, 0.32, 0.32, z=0.09, nt=2.0),
    S(2.30, 0.46, 0.37, 0.37, z=0.18, nt=2.1),
    S(3.00, 0.55, 0.48, 0.47, z=0.24, nt=2.2, nb=2.3),
    S(4.00, 0.63, 0.52, 0.52, z=0.20, nt=2.4, nb=2.8),
    S(5.00, 0.67, 0.58, 0.60, z=0.17, nt=2.5, nb=3.2),
    S(6.20, 0.67, 0.88, 0.88, z=0.14, nt=2.6, nb=3.6, crown=0.15),
    S(7.50, 0.68, 0.92, 0.92, z=0.10, nt=2.7, nb=3.6, crown=0.2),
    S(9.50, 0.70, 0.82, 0.82, z=0.00, nt=2.8, nb=3.4, crown=0.2),
    S(11.1, 0.70, 0.78, 0.78, z=0.00, nt=2.8, nb=3.2, crown=0.15),
    S(13.0, 0.68, 0.74, 0.72, z=0.03, nt=2.6, nb=2.8),
    S(14.5, 0.64, 0.64, 0.62, z=0.01, nt=2.3),
    S(15.15, 0.61, 0.60, 0.60, z=-0.05, nt=2.1),
], ring=56, register='Fuselage', mat_ranges=[(0.0, 2.05, 'Radome')])
K.probe('Pitot', 0.0, 0.9, 0.0, 0.035)

# rectangular chin intake ("smile" with rounded corners), raked back at the bottom, with its splitter ramp
K.duct('Intake', [
    S(4.10, 0.64, 0.33, 0.35, z=-0.58, nt=5.0, nb=4.0),
    S(5.60, 0.65, 0.33, 0.36, z=-0.55, nt=4.5, nb=3.6),
    S(8.00, 0.60, 0.30, 0.32, z=-0.50, nt=3.6, nb=3.2),
    S(10.4, 0.40, 0.22, 0.24, z=-0.40, nt=3.0),
], rake=(0.0, -1.2), throat=1.3, mirror=False, ring=40)
K.box('Splitter', 3.85, 5.10, -0.55, 0.55, -0.27, -0.23, material='Paint2')

# cranked-free 54° delta, low on the fuselage with a little anhedral; close-coupled canards with dihedral
K.surface('Wing', [
    (7.55, 13.55, 0.60, -0.36, 0.045),
    (9.40, 13.50, 2.15, -0.42, 0.040),
    (11.40, 13.40, 3.70, -0.48, 0.034),
    (12.70, 13.30, 4.87, -0.52, 0.030),
], subdiv=3)
K.surface('Canard', [(5.00, 7.35, 0.60, 0.45, 0.045), (7.25, 7.68, 2.17, 0.66, 0.03)], material='Paint2', subdiv=2)

# big swept fin with the brake-chute housing at its root; canted ventral fins; elevon actuator fairings
# (the root runs down to the top of the tapering rear fuselage, so no gap opens under the fin's trailing edge)
K.fin('Fin', (10.75, 16.0), (15.45, 16.78, 2.92), t=0.045, t_tip=0.03, x=0.0, z=0.50)
K.loft('Chute', [S(15.05, 0.04, 0.04, z=1.08), S(15.45, 0.16, 0.17, z=1.08), S(16.30, 0.17, 0.18, z=1.08),
                 S(16.55, 0.12, 0.12, z=1.08)], ring=16)
for side in (1, -1):
    K.fin('Ventral' + ('R' if side > 0 else 'L'), (13.6, 15.3), (14.35, 15.3, 0.62), t=0.05, t_tip=0.04,
          cant=(180 - 33) * side, x=1.10 * side, z=-0.70)
K.loft('Actuator', [S(12.6, 0.03, 0.03, x=0.92, z=-0.55), S(13.2, 0.13, 0.13, x=0.92, z=-0.55),
                    S(15.4, 0.12, 0.12, x=0.92, z=-0.55), S(15.75, 0.04, 0.04, x=0.92, z=-0.55)], ring=14, mirror=True)

# AL-31FN with a petalled nozzle
K.nozzle('Nozzle', 15.05, 16.38, 0.0, -0.06, 0.60, 0.43, petals=True, petal_len=0.1, depth=0.7)

# large bubble canopy with a windscreen bow and a rear frame
K.canopy([(2.85, 0.05, 0.02), (3.30, 0.38, 0.30), (3.90, 0.48, 0.54), (4.50, 0.50, 0.64), (5.20, 0.46, 0.55),
          (5.70, 0.32, 0.34), (6.00, 0.08, 0.05)], frames=[3.42, 5.80], seat=(4.75, 0.0))
# blade antennas: dorsal, under the nose
K.box('AntDorsal', 7.9, 8.25, -0.015, 0.015, 1.0, 1.16, material='Paint2')
K.box('AntVentral', 3.1, 3.35, -0.012, 0.012, -0.36, -0.22, material='Paint2')

# stores: PL-8 short-range missiles outboard, PL-12 medium-range inboard, on pylons; a centreline pylon
for (x, s0, ln, r, nm) in ((3.72, 11.0, 2.9, 0.08, 'PL8'), (2.59, 9.9, 3.9, 0.10, 'PL12')):
    zw = -0.36 - (x - 0.6) / (4.87 - 0.6) * 0.16
    K.box('Pylon' + nm, s0 + ln * 0.35, s0 + ln * 0.75, x - 0.04, x + 0.04, zw - 0.24, zw - 0.02, material='Paint2', mirror=True)
    K.missile(nm, s0, ln, x, zw - 0.36, r, mirror=True)
K.box('PylonC', 7.6, 9.6, -0.05, 0.05, -1.02, -0.86, material='Paint2')
K.lamp('NavLight', 12.9, 4.83, -0.52, mirror=True, r=0.05)

# ── markings (tools/aircraft/markings) ──
K.decal('plaaf_bars.png', (14.75, 0.0, 2.05), (2.1, 0.70), (1, 0, 0), depth=0.4)          # fin, both sides
for nz in (1, -1):                                                                     # wings, top and bottom
    K.decal('plaaf_bars.png', (11.75, 3.15, -0.45), (1.95, 0.65), (0, 0, nz), depth=0.5)
K.decal('bort_j10.png', (2.55, 0.42, 0.10), (1.15, 0.35), (1, 0, 0), depth=0.45, facing=0.55)
K.decal('warning.png', (3.15, 0.47, 0.55), (0.2, 0.2), (1, 0, 0.35), depth=0.3, facing=0.5)
K.decal('rescue.png', (6.3, 0.55, 0.72), (0.42, 0.21), (1, 0, 0.5), depth=0.3, facing=0.5)
K.decal('panel.png', (8.3, 0.0, 1.0), (0.9, 0.6), (0, 0, 1), up=(0, 1, 0), depth=0.3, mirror=False)
K.decal('panel.png', (12.2, 0.0, 0.8), (0.7, 0.5), (0, 0, 1), up=(0, 1, 0), depth=0.3, mirror=False)
K.finish(atlas=2048, ao=0.55)

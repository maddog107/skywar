# MiG-31 Foxhound — SKYWAR aircraft kit spec.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/mig31.py -- models/aircraft/mig31.glb [--render DIR]
# Proportions measured off the public-domain three-view
#   https://commons.wikimedia.org/wiki/File:Mikoyan_MiG-31_3-view_line_drawing.png
# (cross-checked against the larger https://commons.wikimedia.org/wiki/File:Mikoyan_MiG-31_3-view.svg).
# Length 22.69 m incl. probe, span 13.46 m, height 6.15 m. s = metres aft of the probe tip, z = up from the radome axis.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('mig31', 22.69, paint='#7f8b93', paint2='#737f88', radome='#4a5157')

# ── forward fuselage + cockpit section (narrow), blending into the wide engine body ──
K.loft('Fuselage', [
    S(1.00, 0.02, 0.02, 0.02, z=0.00, nt=1.8),
    S(1.60, 0.24, 0.22, 0.18, z=0.00, nt=1.9),
    S(2.60, 0.48, 0.45, 0.32, z=0.02, nt=2.0),
    S(4.20, 0.74, 0.86, 0.72, z=0.06, nt=2.4, nb=2.6),
    S(5.60, 0.78, 0.92, 0.80, z=0.06, nt=2.6, nb=3.0),
    S(7.20, 0.78, 0.94, 0.82, z=0.06, nt=2.8, nb=3.2),
    S(9.00, 0.95, 1.00, 0.82, z=0.08, nt=3.0, nb=3.6, crown=0.2),
    S(10.6, 1.55, 1.10, 0.82, z=0.10, nt=3.4, nb=4.0, crown=0.35),
    S(13.0, 1.62, 1.18, 0.82, z=0.12, nt=3.6, nb=4.2, crown=0.35),
    S(17.0, 1.62, 1.15, 0.80, z=0.12, nt=3.6, nb=4.2, crown=0.35),
    S(19.5, 1.56, 1.02, 0.80, z=0.10, nt=3.6, nb=4.0, crown=0.3),
    S(21.5, 1.48, 0.86, 0.78, z=0.05, nt=3.6, nb=3.8, crown=0.2),
], ring=48, register='Fuselage', mat_ranges=[(0.0, 2.3, 'Radome')])
K.probe('Pitot', 0.0, 1.05, 0.0, 0.05)

# ── big rectangular raked intakes on the forward-fuselage sides ──
K.duct('Intake', [
    S(6.75, 0.46, 0.88, 0.88, x=1.17, z=0.02, nt=6.0),
    S(8.60, 0.46, 0.88, 0.86, x=1.17, z=0.04, nt=6.0),
    S(10.4, 0.42, 0.82, 0.80, x=1.14, z=0.08, nt=5.0),
    S(11.8, 0.30, 0.60, 0.60, x=1.05, z=0.10, nt=4.0),
], rake=(0.0, -0.55), throat=1.6)

# ── wing: LERX kink, 41° LE sweep, slight anhedral ──
K.surface('Wing', [
    (11.20, 18.15, 1.55, 0.35, 0.05),
    (12.80, 18.20, 2.34, 0.34, 0.048),
    (16.50, 18.90, 6.66, 0.05, 0.035),
], subdiv=4)

# ── horizontal tails (all-moving), low on the tail booms ──
K.surface('Stab', [
    (18.90, 21.70, 1.45, -0.55, 0.045),
    (22.00, 22.70, 4.30, -0.70, 0.03),
], material='Paint2', subdiv=2)

# ── twin fins, canted out 8°, on the engine shoulders; ventral fins below ──
for side in (1, -1):
    K.fin('Fin' + ('R' if side > 0 else 'L'), (17.70, 21.65), (21.35, 22.05, 2.6), t=0.05, t_tip=0.035,
          cant=8 * side, x=1.42 * side, z=1.05)
    K.fin('Ventral' + ('R' if side > 0 else 'L'), (16.90, 21.00), (18.00, 20.20, 0.82), t=0.05, t_tip=0.04,
          cant=(180 - 20) * side, x=1.10 * side, z=-0.65)

# ── two big round nozzles side by side ──
K.nozzle('Nozzle', 20.9, 22.69, 0.74, -0.02, 0.76, 0.70, mirror=True, depth=0.8)
K.loft('TailCone', [S(20.8, 0.30, 0.30, 0.30, z=0.05), S(22.2, 0.20, 0.22, 0.2, z=0.05), S(22.6, 0.04, 0.04, 0.04, z=0.05)], ring=16)

# ── tandem canopy with bows, two crew ──
K.canopy([(5.25, 0.06, 0.02), (5.70, 0.40, 0.32), (6.30, 0.52, 0.52), (7.20, 0.54, 0.58), (8.20, 0.50, 0.50),
          (8.90, 0.30, 0.20), (9.30, 0.06, 0.03)], frames=[5.95, 6.95, 7.35], seat=[(6.45, 0.0), (7.85, 0.0)])

# ── dorsal spine fairing + four under-fuselage R-33 missiles (semi-recessed) ──
K.loft('Spine', [S(8.8, 0.05, 0.05, z=1.0), S(10.5, 0.36, 0.22, 0.1, z=1.16), S(17.5, 0.34, 0.20, 0.1, z=1.20), S(20.6, 0.05, 0.05, z=1.05)], ring=20)
for (sx, s0) in ((0.55, 10.2), (0.55, 14.6)):
    K.missile('R33', s0, 4.1, sx, -0.95, 0.19, mirror=True)
K.lamp('NavLight', 17.2, 6.66, 0.06, mirror=True, r=0.07)

K.finish()

# F-22A Raptor — SKYWAR aircraft kit spec.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/f22.py -- models/aircraft/f22.glb [--render DIR]
# Shaped after the public-domain USAF 3-view (U.S. Air Force):
#   https://commons.wikimedia.org/wiki/File:Lockheed_Martin_F-22A_Raptor_3-view_line_drawing.jpg
# Length 18.92 m, span 13.56 m, height 5.08 m. s = metres aft of the nose, z = metres above the nose tip.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('f22', 18.92, paint='#7b838c', paint2='#6c747d', gold=True)

# ── fuselage: chined forebody → wide blended centre body → tapering tail ──
K.loft('Fuselage', [
    S(0.00, 0.02, 0.02, 0.02, z=0.00, nt=1.5),
    S(0.50, 0.30, 0.20, 0.17, z=0.02, nt=1.55, nb=1.5),
    S(1.00, 0.50, 0.33, 0.30, z=0.04, nt=1.6, nb=1.5),
    S(2.00, 0.72, 0.53, 0.48, z=0.08, nt=1.7, nb=1.55),
    S(3.00, 0.84, 0.66, 0.60, z=0.10, nt=1.85, nb=1.6),
    S(4.00, 0.93, 0.74, 0.66, z=0.12, nt=1.95, nb=1.7),
    S(5.00, 1.00, 0.80, 0.72, z=0.14, nt=2.1, nb=1.9),
    S(6.20, 1.18, 0.86, 0.80, z=0.20, nt=2.4, nb=2.4),
    S(7.40, 1.60, 0.84, 0.86, z=0.26, nt=2.6, nb=3.0),
    S(8.60, 2.12, 0.78, 0.92, z=0.30, nt=2.8, nb=3.6, crown=0.15),
    S(10.0, 2.20, 0.75, 0.95, z=0.30, nt=2.9, nb=4.0, crown=0.2),
    S(12.0, 2.15, 0.72, 0.92, z=0.30, nt=2.9, nb=4.0, crown=0.2),
    S(13.5, 2.00, 0.64, 0.80, z=0.32, nt=2.9, nb=3.8, crown=0.2),
    S(15.0, 1.80, 0.50, 0.60, z=0.33, nt=2.8, nb=3.4, crown=0.15),
    S(16.5, 1.52, 0.38, 0.40, z=0.35, nt=2.8, nb=3.2),
    S(17.1, 1.35, 0.30, 0.30, z=0.35, nt=2.8, nb=3.0),
], ring=48, register='Fuselage')

# ── caret intakes: raked in side view (top lip forward) and in plan (outer lip aft) ──
K.duct('Intake', [
    S(5.45, 0.56, 0.50, 0.50, x=1.20, z=-0.15, nt=4.5, tw=0.14),
    S(7.00, 0.62, 0.52, 0.52, x=1.34, z=-0.12, nt=4.5, tw=0.14),
    S(8.60, 0.62, 0.50, 0.50, x=1.30, z=-0.10, nt=4.0, tw=0.1),
    S(10.2, 0.50, 0.42, 0.42, x=1.00, z=-0.10, nt=3.5),
], rake=(0.75, -1.25), throat=1.4)
# flat shoulders over the intakes, running from the forebody chine out to the wing root
K.surface('Shoulder', [
    (4.50, 10.6, 0.70, 0.36, 0.035),
    (5.75, 9.20, 2.05, 0.34, 0.04),
], subdiv=2)

# ── wings: 42° LE sweep, forward-swept TE, slight anhedral ──
K.surface('Wing', [
    (8.37, 15.79, 2.00, 0.40, 0.045),
    (12.10, 14.44, 6.00, 0.15, 0.036),
    (12.90, 13.60, 6.85, 0.10, 0.032),
], subdiv=4)

# ── all-moving horizontal tails (notched trailing edge) ──
K.surface('Stab', [
    (14.51, 17.69, 1.50, 0.36, 0.04),
    (15.66, 18.87, 2.85, 0.33, 0.035),
    (17.05, 18.40, 4.49, 0.30, 0.03),
], material='Paint2', subdiv=2)

# ── twin vertical tails, canted 28° ──
for side in (1, -1):
    K.fin('Fin' + ('R' if side > 0 else 'L'), (12.90, 17.00), (14.50, 15.70, 2.90), t=0.045, t_tip=0.03,
          cant=28 * side, x=1.55 * side, z=0.62)

# ── 2-D thrust-vectoring nozzles + centre tail stinger ──
K.box_nozzle('Nozzle', 16.70, 17.50, 0.62, 0.36, 0.60, 0.36, 0.56, 0.27, mirror=True, n=6.0)
K.loft('Stinger', [S(16.4, 0.18, 0.14, 0.14, z=0.38), S(17.3, 0.14, 0.12, 0.12, z=0.38), S(17.9, 0.03, 0.04, 0.04, z=0.38)], ring=16)

# ── canopy: one-piece, gold-tinted, frameless ──
K.canopy([(2.45, 0.05, 0.02), (3.00, 0.40, 0.33), (3.70, 0.53, 0.58), (4.30, 0.56, 0.66), (5.00, 0.50, 0.55),
          (5.60, 0.36, 0.34), (6.10, 0.14, 0.10)], seat=(4.55, 0.0))

# ── details: LERX-like chine fairings along the intake tops, pitot-less nose, formation lights ──
K.lamp('FormationL', 7.5, 2.05, 0.3, mirror=True, r=0.05)

K.finish()

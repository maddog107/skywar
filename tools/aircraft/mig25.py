# MiG-25P Foxbat — SKYWAR aircraft kit spec.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/mig25.py -- models/aircraft/mig25.glb [--render DIR]
# The MiG-31 was developed from the MiG-25 and shares its layout, so this spec reuses the MiG-31 stations
# scaled to the Foxbat's length, then changes what differs: single-seat low canopy, bigger fins, wingtip
# anti-flutter bodies, no dorsal spine. Proportions checked against the public-domain three-view
#   https://commons.wikimedia.org/wiki/File:Mikoyan-Gurevich_MiG-25_3-view_line_drawing.gif
# Length 19.75 m, span 14.01 m. s = metres aft of the nose tip.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

k = 19.75 / 22.69     # MiG-31 → MiG-25 length ratio for the shared fuselage stations
def s_(v): return v * k

K.begin('mig25', 19.75, paint='#8f9ba2', paint2='#84909a', radome='#d9dcd6')

def Sk(s, w, ht, hb, z=0.0, x=0.0, **kw):
    return S(s_(s), w * k, ht * k, hb * k, z=z * k, x=x * k, **kw)

K.loft('Fuselage', [
    Sk(0.90, 0.02, 0.02, 0.02, z=0.00, nt=1.8),
    Sk(1.60, 0.26, 0.24, 0.20, z=0.00, nt=1.9),
    Sk(2.80, 0.52, 0.48, 0.36, z=0.02, nt=2.0),
    Sk(4.40, 0.72, 0.80, 0.70, z=0.04, nt=2.3, nb=2.6),
    Sk(5.80, 0.76, 0.86, 0.78, z=0.05, nt=2.6, nb=3.0),
    Sk(7.40, 0.78, 0.88, 0.80, z=0.06, nt=2.8, nb=3.2),
    Sk(9.00, 0.98, 0.96, 0.82, z=0.08, nt=3.0, nb=3.6, crown=0.2),
    Sk(10.6, 1.60, 1.06, 0.82, z=0.10, nt=3.4, nb=4.0, crown=0.35),
    Sk(13.0, 1.66, 1.12, 0.82, z=0.12, nt=3.6, nb=4.2, crown=0.35),
    Sk(17.0, 1.66, 1.10, 0.80, z=0.12, nt=3.6, nb=4.2, crown=0.35),
    Sk(19.5, 1.60, 0.98, 0.80, z=0.10, nt=3.6, nb=4.0, crown=0.3),
    Sk(21.5, 1.52, 0.84, 0.78, z=0.05, nt=3.6, nb=3.8, crown=0.2),
], ring=48, register='Fuselage', mat_ranges=[(0.0, s_(2.4), 'Radome')])

K.probe('Pitot', 0.0, 0.82, 0.0, 0.04)
K.duct('Intake', [
    Sk(6.60, 0.48, 0.88, 0.88, x=1.20, z=0.02, nt=6.0),
    Sk(8.60, 0.48, 0.88, 0.86, x=1.20, z=0.04, nt=6.0),
    Sk(10.4, 0.44, 0.82, 0.80, x=1.16, z=0.08, nt=5.0),
    Sk(11.8, 0.30, 0.60, 0.60, x=1.06, z=0.10, nt=4.0),
], rake=(0.0, -0.6), throat=1.4)

# wing: shoulder-mounted, ~41° LE, 5° anhedral, tip chord carries an anti-flutter body
hs = 14.01 / 2
K.surface('Wing', [
    (s_(11.0), s_(18.2), 1.45, 0.30, 0.05),
    (s_(12.9), s_(18.3), 2.30, 0.26, 0.048),
    (s_(17.2), s_(19.3), hs - 0.05, -0.15, 0.035),
], subdiv=4)
for side in (1, -1):
    K.loft('TipBody' + ('R' if side > 0 else 'L'), [S(s_(16.2), 0.02, 0.02, x=side * hs, z=-0.16), S(s_(17.0), 0.08, 0.08, x=side * hs, z=-0.16),
                                                    S(s_(18.8), 0.08, 0.08, x=side * hs, z=-0.16), S(s_(19.6), 0.02, 0.02, x=side * hs, z=-0.16)], ring=10)

K.surface('Stab', [
    (s_(19.0), s_(21.8), 1.40, -0.50, 0.045),
    (s_(22.1), s_(22.8), 4.10, -0.64, 0.03),
], material='Paint2', subdiv=2)

for side in (1, -1):
    K.fin('Fin' + ('R' if side > 0 else 'L'), (s_(17.2), s_(21.7)), (s_(21.3), s_(22.2), 2.75), t=0.05, t_tip=0.035,
          cant=8 * side, x=1.30 * side, z=0.95)
    K.fin('Ventral' + ('R' if side > 0 else 'L'), (s_(16.9), s_(21.0)), (s_(18.0), s_(20.2), 0.8), t=0.05, t_tip=0.04,
          cant=(180 - 12) * side, x=1.05 * side, z=-0.55)

K.nozzle('Nozzle', s_(20.8), 19.75, 0.66, -0.02, 0.68, 0.63, mirror=True, depth=0.7)
K.loft('TailCone', [S(s_(20.8), 0.26, 0.26, 0.26, z=0.05), S(19.4, 0.16, 0.18, 0.16, z=0.05), S(19.72, 0.04, 0.04, 0.04, z=0.05)], ring=16)

# single low canopy, framed, blending into the spine
K.canopy([(4.35, 0.05, 0.02), (4.75, 0.36, 0.26), (5.35, 0.46, 0.40), (6.00, 0.46, 0.40), (6.60, 0.40, 0.30),
          (7.20, 0.20, 0.12), (7.50, 0.05, 0.02)], frames=[5.05, 6.45], seat=(5.75, 0.0))
K.loft('Spine', [S(7.3, 0.05, 0.05, z=0.85), S(8.4, 0.30, 0.14, 0.1, z=0.9), S(15.0, 0.28, 0.12, 0.1, z=1.0), S(17.8, 0.05, 0.05, z=0.95)], ring=16)

# four R-40 missiles on underwing pylons (the Foxbat's signature silhouette)
for (x, s0, L, r) in ((3.3, 11.4, 6.2, 0.155), (5.3, 12.8, 6.2, 0.155)):
    K.missile('R40', s0, L, x, -0.55, r, mirror=True)
    K.box('Pylon', s0 + 1.8, s0 + 3.6, x - 0.04, x + 0.04, -0.42, 0.2, material='Paint2', mirror=True)
K.lamp('NavLight', s_(17.6), hs, -0.16, mirror=True, r=0.07)

K.finish()

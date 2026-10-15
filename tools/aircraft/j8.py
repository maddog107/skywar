# Shenyang J-8II Finback-B — SKYWAR aircraft kit spec.
#   python3 tools/aircraft/markings.py   (once: the insignia / bort-number images)
#   /opt/homebrew/bin/blender -b -P tools/aircraft/j8.py -- models/aircraft/j8.glb [--render DIR]
# No free three-view was found; built from published dimensions (length 21.59 m with the probe, 20.53 m without,
# span 9.34 m, height 5.41 m, 60° delta, twin WP-13A engines) and photographs of the J-8II / F-8II (Wikimedia
# Commons: "Shenyang J-8II (Finback-B).jpg" at the China Aviation Museum, the F-8II front fuselage at the
# Hill Aerospace Museum): long dielectric radome, slab-sided forebody, framed two-piece canopy, big raked side
# intakes with splitter plates, dorsal spine, mid-set delta with two fences a side, low all-moving tailplane with
# anhedral, tall swept fin, folding ventral fin, twin nozzles with the brake-chute housing between them.
# Finish: PLAAF light grey with a dark green radome, the PLAAF insignia on the fin and wings, red bort number with a
# white edge, warning triangles; panel lines, ambient occlusion and the markings baked into one texture atlas.
# s = metres aft of the pitot tip, z = up from the radome axis.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import aircraft_kit as K
from aircraft_kit import S

K.begin('j8', 21.59, paint='#b4bbbf', paint2='#a7aeb2', radome='#5d6a58',
        panel={'key': 'panel', 'line': 0.74, 'grime': 0.045})

K.loft('Fuselage', [
    S(0.95, 0.02, 0.02, 0.02, nt=1.9),
    S(2.00, 0.30, 0.30, 0.29, z=0.02, nt=2.0),
    S(3.50, 0.56, 0.58, 0.55, z=0.06, nt=2.1),
    S(4.60, 0.64, 0.70, 0.66, z=0.10, nt=2.5, nb=2.9),
    S(6.50, 0.70, 0.80, 0.78, z=0.14, nt=2.9, nb=3.4),
    S(9.00, 0.86, 0.84, 0.86, z=0.16, nt=3.2, nb=3.8, crown=0.2),
    S(12.5, 1.14, 0.86, 0.88, z=0.16, nt=3.3, nb=4.0, crown=0.3),
    S(16.5, 1.18, 0.82, 0.84, z=0.14, nt=3.3, nb=4.0, crown=0.3),
    S(19.0, 1.10, 0.74, 0.74, z=0.12, nt=3.1, nb=3.6, crown=0.25),
    S(20.4, 1.04, 0.66, 0.66, z=0.10, nt=3.0, nb=3.4, crown=0.2),
], ring=56, register='Fuselage', mat_ranges=[(0.0, 3.55, 'Radome')])
K.probe('Pitot', 0.0, 1.0, 0.0, 0.04)

# big raked rectangular side intakes, standing off the fuselage on splitter plates
K.duct('Intake', [
    S(7.10, 0.36, 0.64, 0.62, x=1.05, z=0.02, nt=6.0),
    S(8.80, 0.40, 0.68, 0.66, x=1.10, z=0.05, nt=5.5),
    S(11.2, 0.34, 0.62, 0.62, x=1.04, z=0.10, nt=4.5),
    S(13.2, 0.14, 0.34, 0.34, x=0.95, z=0.13, nt=3.0),
], rake=(0.0, -0.48), throat=1.5)
for side in (1, -1):
    K.box('Splitter' + ('R' if side > 0 else 'L'), 6.85, 8.0, side * 0.67, side * 0.70, -0.55, 0.62, material='Paint2')

# mid-set 60° delta (a touch of anhedral) with clipped tips and two fences a side
K.surface('Wing', [
    (9.80, 17.05, 1.15, -0.12, 0.045),
    (12.9, 17.00, 2.90, -0.20, 0.038),
    (15.80, 16.90, 4.67, -0.28, 0.03),
], subdiv=4)
for x in (2.25, 3.45):
    zf = -0.12 - (x - 1.15) / 3.52 * 0.16
    K.box('Fence', 9.80 + (x - 1.15) * 1.70 + 0.4, 16.9, x - 0.015, x + 0.015, zf + 0.02, zf + 0.20, material='Paint2', mirror=True)
# low all-moving tailplane with anhedral
K.surface('Stab', [(18.25, 20.40, 0.98, -0.10, 0.04), (20.05, 20.95, 2.75, -0.30, 0.03)], material='Paint2', subdiv=2)
# tall swept fin with a fin-tip fairing; the folding ventral fin; dorsal spine
K.fin('Fin', (15.2, 20.55), (19.15, 20.45, 2.42), t=0.045, t_tip=0.03, x=0.0, z=0.82, mid=[(16.6, 20.55, 0.12)])
K.loft('FinCap', [S(19.0, 0.02, 0.02, z=3.24), S(19.35, 0.07, 0.07, z=3.24), S(20.45, 0.07, 0.07, z=3.24), S(20.7, 0.02, 0.02, z=3.24)], ring=12)
K.fin('Ventral', (17.9, 20.0), (18.95, 20.25, 1.05), t=0.05, t_tip=0.04, cant=180, x=0.0, z=-0.58)
K.loft('Spine', [S(7.0, 0.05, 0.05, z=0.88), S(8.0, 0.30, 0.18, 0.1, z=0.90), S(15.5, 0.27, 0.15, 0.1, z=0.97),
                 S(16.6, 0.10, 0.08, 0.05, z=0.97)], ring=16)

# twin WP-13A nozzles, the brake-chute housing between them
K.nozzle('Nozzle', 20.25, 21.59, 0.50, 0.08, 0.47, 0.43, mirror=True, depth=0.7)
K.loft('Chute', [S(20.0, 0.10, 0.18, 0.18, z=0.46), S(20.9, 0.15, 0.22, 0.22, z=0.46), S(21.35, 0.12, 0.18, 0.18, z=0.46)], ring=14)

# framed canopy (windscreen and hinged hood) and the 23-III gun pod under the forebody
K.canopy([(4.25, 0.05, 0.02), (4.65, 0.36, 0.28), (5.25, 0.44, 0.44), (5.95, 0.44, 0.46), (6.55, 0.36, 0.34),
          (7.05, 0.18, 0.12), (7.35, 0.05, 0.02)], frames=[4.80, 6.00], seat=(5.85, 0.0))
K.loft('GunPod', [S(6.2, 0.04, 0.04, z=-0.80), S(6.8, 0.17, 0.12, 0.13, z=-0.80), S(9.0, 0.18, 0.12, 0.14, z=-0.80),
                  S(9.6, 0.06, 0.05, z=-0.76)], ring=16)
K.probe('GunBarrel', 6.0, 6.6, -0.84, 0.035, 0.035, x=0.06)
K.box('AntDorsal', 12.2, 12.55, -0.012, 0.012, 1.08, 1.24, material='Paint2')
K.box('AntVentral', 4.3, 4.55, -0.012, 0.012, -0.80, -0.66, material='Paint2')

# stores: PL-8 short-range missiles outboard, PL-11 medium-range inboard, an 800 l centreline tank
for (x, s0, ln, r, nm) in ((3.55, 13.0, 2.9, 0.08, 'PL8'), (2.45, 11.6, 3.7, 0.105, 'PL11')):
    zw = -0.12 - (x - 1.15) / 3.52 * 0.16
    K.box('Pylon' + nm, s0 + ln * 0.35, s0 + ln * 0.75, x - 0.04, x + 0.04, zw - 0.24, zw - 0.02, material='Paint2', mirror=True)
    K.missile(nm, s0, ln, x, zw - 0.37, r, mirror=True)
K.box('PylonC', 10.8, 12.8, -0.05, 0.05, -0.88, -0.70, material='Paint2')
K.loft('Tank', [S(9.4, 0.03, 0.03, z=-1.18), S(10.4, 0.26, 0.26, z=-1.18), S(13.4, 0.29, 0.29, z=-1.18),
                S(14.9, 0.05, 0.05, z=-1.18)], ring=20)
K.lamp('NavLight', 16.4, 4.67, -0.28, mirror=True, r=0.05)

# ── markings (tools/aircraft/markings) ──
K.decal('plaaf_bars.png', (18.75, 0.0, 2.05), (1.9, 0.76), (1, 0, 0), depth=0.4)
for nz in (1, -1):
    K.decal('plaaf_bars.png', (14.6, 3.15, -0.22), (1.9, 0.76), (0, 0, nz), depth=0.5)
K.decal('bort_j8.png', (3.9, 0.55, 0.05), (1.4, 0.42), (1, 0, 0), depth=0.45, facing=0.55)
K.decal('warning.png', (4.45, 0.62, 0.62), (0.2, 0.2), (1, 0, 0.35), depth=0.3, facing=0.5)
K.decal('rescue.png', (7.2, 0.62, 0.78), (0.42, 0.21), (1, 0, 0.5), depth=0.3, facing=0.5)
K.decal('panel.png', (10.5, 0.0, 1.05), (0.8, 0.5), (0, 0, 1), up=(0, 1, 0), depth=0.3, mirror=False)
K.decal('panel.png', (17.4, 0.0, 0.95), (0.6, 0.45), (0, 0, 1), up=(0, 1, 0), depth=0.3, mirror=False)
K.finish(atlas=2048, ao=0.55)

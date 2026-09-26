# Ilyushin Il-78M "Midas" (aerial tanker) — SKYWAR support-aircraft build.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/il78.py -- SRC.glb models/aircraft/il78.glb
# SRC: "Il78" by manilov.ap, CC BY 4.0, https://sketchfab.com/3d-models/il78-0c0da2cc1b4c441dadc2510212c25fb7
# (Objaverse glbs/000-025/0c0da2cc1b4c441dadc2510212c25fb7.glb). Russian Aerospace Forces scheme as modelled.
# Changes: the landing gear (wheels, hubs, legs, small doors) removed; the three UPAZ-1 hose-and-drogue units the
# model carries (two under the outer wings, one on the left of the rear fuselage) rigged for src/rigparts.js:
#   drogue_l / drogue_r / drogue_c: origin at the pod's hose exit; hose_* 1 m long (stretched in the game);
#   basket_*: the drogue (UPAZ-1: 26 m of hose, a ~0.9 m basket), hidden inside the pod when stowed.
# Real size: length 46.59 m, span 50.50 m, height 14.76 m. s = metres aft of the nose, x right, z up.
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
from aircraft_kit import S
import bpy

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]
L = 46.59

SK.begin('il78', L, dark='#1a1b1c')
K.material('Metal', '#b5b8ba', 0.7, 0.38)
K.material('Hose', '#1b1c1d', 0.1, 0.8)
K.material('Stripe', '#e4e2da', 0.1, 0.5)
K.material('DrogueRed', '#b0281f', 0.1, 0.55)
air = SK.load(SRC, nose='+Y')
SK.fit(air, L)
obj = {o.name[len('src_'):]: o for o in air}   # e.g. 'Cylinder02-FACES.001'

# ── landing gear: every part lying wholly below the fuselage (tyres, hubs, legs, axles, small doors) ──
gear = [o for o in air if SK.bbox([o])[1].z < -2.5]
print('gear objects removed', len(gear))
SK.delete(gear)

# ── the three UPAZ-1 units: hose exits at the pods' tails (Cylinder02 / 03 under the wings, 01 on the fuselage) ──
def pod_tail(name):
    a, b = SK.bbox([obj[name]])
    return -a.y, (a.x + b.x) / 2, (a.z + b.z) / 2 + 0.02, (b.x - a.x) / 2
units = {'l': pod_tail('Cylinder02-FACES.001'), 'r': pod_tail('Cylinder03-FACES.001'), 'c': pod_tail('Cylinder01-FACES.001')}
print('UPAZ tails', {k: [round(v, 2) for v in u] for k, u in units.items()})
for sfx, (s1, x, z, pr) in units.items():
    hs = s1 - 0.25                                   # hose exit, just inside the pod's open tail
    hose = K.loft('Hose' + sfx, [S(hs, 0.045, 0.045, x=x, z=z), S(hs + 1.0, 0.045, 0.045, x=x, z=z)], material='Hose', ring=10)
    cpl = K.loft('Coupling' + sfx, [S(hs - 0.02, 0.08, 0.08, x=x, z=z), S(hs + 0.14, 0.12, 0.12, x=x, z=z), S(hs + 0.34, 0.11, 0.11, x=x, z=z)], material='Metal', ring=16)
    canopy = K.loft('Canopy' + sfx, [S(hs + 0.3, 0.11, 0.11, x=x, z=z), S(hs + 0.6, 0.27, 0.27, x=x, z=z), S(hs + 0.95, 0.44, 0.44, x=x, z=z),
                                     S(hs + 1.0, 0.45, 0.45, x=x, z=z)], material='Stripe', ring=24, cap_front=False, cap_back=False)
    rim = K.loft('Rim' + sfx, [S(hs + 0.9, 0.455, 0.455, x=x, z=z), S(hs + 1.0, 0.46, 0.46, x=x, z=z)], material='DrogueRed', ring=24, cap_front=False, cap_back=False)
    inner = K.loft('CanopyIn' + sfx, [S(hs + 0.32, 0.1, 0.1, x=x, z=z), S(hs + 0.97, 0.43, 0.43, x=x, z=z)], material='Dark', ring=24, cap_front=False, cap_back=False)
    d = SK.part('drogue_' + sfx, None, (hs, x, z), props={'hose': 26.0, 'droop': 6 if sfx != 'c' else 4})
    SK.part('hose_' + sfx, [hose], (hs, x, z), parent=d)
    SK.part('basket_' + sfx, [cpl, canopy, rim, inner], (hs, x, z), parent=d)

# D-30KP-2 exhausts (contrails): the aft end of each nacelle
exh = [(17.6, sd * 6.3, -0.27) for sd in (1, -1)] + [(19.84, sd * 10.5, -0.46) for sd in (1, -1)]
top = SK.section([obj['fuzel-FACES.001']], s=3.4, pred=lambda p: abs(p.x) < 0.8)[3]
SK.finish(OUT)
print('NOZZLES', [SK.frac(s, x, z) for s, x, z in exh])
print('COCKPIT', SK.frac(3.4, 0.0, top - 0.9))

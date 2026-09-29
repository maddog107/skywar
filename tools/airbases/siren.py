# ═══════════════════════════════════════════════════════════════
# Air-raid siren on a 12 m pole: a rotating electro-mechanical siren (the Federal Signal Thunderbolt / the Soviet
# S-40 layout: a motor housing with a horn rotor on top of a timber or steel pole, a control cabinet at the foot).
#   blender -b -P tools/airbases/build.py -- siren
# Rig: head (spin y, the rotating horn, ~2 rpm when sounding).
# ═══════════════════════════════════════════════════════════════
import math
import akit
from akit import Vehicle, Part, spinj

CENTER = False
H = 12.0


def make():
    akit.setup_materials('blue_green')
    v = Vehicle('siren', 'Air-raid siren', scheme='blue_green')
    b = Part(v, 'body')
    # pole: tapered steel with a base plate on a concrete footing
    b.box('concrete', -0.6, 0.6, 0, 0.3, -0.6, 0.6)
    b.cyl('steelplate', (0, 0.3, 0), (0, H - 0.6, 0), 0.17, 0.11, 10)
    b.box('dark', -0.3, 0.3, 0.3, 0.34, -0.3, 0.3)
    # climbing steps and the cable conduit
    for k in range(10):
        y = 2.2 + k * 0.9
        s = 1 if k % 2 else -1
        b.cyl('dark', (s * 0.1, y, 0), (s * 0.34, y, 0), 0.018, 0.018, 5)
    b.cyl('dark', (0, 0.3, 0.16), (0, H - 0.8, 0.13), 0.03, 0.03, 6)
    # control cabinet at the foot
    b.box('grey', -0.35, 0.35, 0.9, 1.9, 0.18, 0.62, bev=0.02)
    b.box('dark', -0.3, 0.3, 1.0, 1.8, 0.62, 0.63)
    b.box('grey', -0.4, 0.4, 1.9, 1.96, 0.14, 0.68)
    # platform and motor housing
    b.cyl('steelplate', (0, H - 0.6, 0), (0, H - 0.5, 0), 0.7, 0.7, 14)
    for a in range(6):
        t = a * math.pi / 3
        b.cyl('dark', (0.66 * math.cos(t), H - 0.5, 0.66 * math.sin(t)), (0.66 * math.cos(t), H + 0.35, 0.66 * math.sin(t)), 0.018, 0.018, 4)
    b.lathe((0, H - 0.5, 0), (0, 1, 0), [(0, 0.34, 'grey'), (0.55, 0.36, 'grey'), (0.62, 0.3, 'grey'), (0.66, 0.0, 'grey')], n=14, cap0=True)
    # the rotor: a drum with ports and two horns (bell mouths) opposite each other
    h = Part(v, 'head', pivot=(0, H + 0.1, 0), joint=spinj('y', 2.0))
    h.cyl('grey', (0, H + 0.1, 0), (0, H + 0.62, 0), 0.32, 0.32, 14)
    h.disc('dark', (0, H + 0.621, 0), (0, 1, 0), 0.3, 14)
    for s in (1, -1):
        h.lathe((s * 0.28, H + 0.36, 0), (s, 0, 0), [(0, 0.18, 'grey'), (0.4, 0.22, 'grey'), (0.8, 0.34, 'grey'), (1.05, 0.5, 'grey'), (1.08, 0.46, 'dark'), (0.6, 0.2, 'dark')], n=14)
        h.disc('black', (s * 0.9, H + 0.36, 0), (-s, 0, 0), 0.25, 14)
    return v

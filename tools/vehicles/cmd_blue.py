# ═══════════════════════════════════════════════════════════════
# Blue command post vehicle: an M1113 HMMWV (heavy variant, two-door cab) carrying an S-788-type
# command shelter (as the SICPS command post HMMWVs): environmental control unit on the shelter front, louvred
# grilles, rear door, whip antennas and a telescopic antenna mast on the rear corner.
#   blender -b -P tools/vehicles/build.py -- cmd_blue
# References: HMMWV 4.57 × 2.16 m, wheelbase 3.30 m; SICPS HMMWV with shelter and the M1097A2 shelter carrier
# (US Army photos, Wikimedia Commons, public domain); shelter ~2.5 m long, 2.0 m wide, top at 2.62 m.
# Rig: mast / mast_2 (telescopic mast sections, slide +y, group 'raise': 0 → +4.4 m), door_l / door_r (cab doors),
# door_shelter (rear shelter door), wheel_1l/1r (steered) / 2l/2r, exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, slide, lerp
import blue
import hmmwv
from hmmwv import H

SH = (-1.0, 1.0, 1.1, 2.62, 2.28, 4.72)     # shelter box: x0 x1 y0 y1 z0 z1
MAST_X, MAST_Z = 0.93, 4.84


def shelter(v, b):
    x0, x1, y0, y1, z0, z1 = SH
    b.box('paint', x0, x1, y0, y1, z0, z1, bev=0.025)
    # skid rails under the shelter and tie-down rings to the bed
    for sx in (-1, 1):
        b.box('dark', sx * 0.8, sx * 0.92, y0 - 0.06, y0, z0 + 0.05, z1 - 0.05)
        for z in (z0 + 0.3, z1 - 0.3):
            b.cyl('dark', (sx * 1.0, y0 + 0.08, z - 0.05), (sx * 1.0, y0 + 0.08, z + 0.05), 0.03, 0.03, 6)
    # panel seams (extruded shelter panels) on the sides and roof edge trim
    for sx in (-1, 1):
        for z in (2.95, 3.6, 4.2):
            b.panel('black', [(sx * 1.0, y0 + 0.05, z - 0.006), (sx * 1.0, y0 + 0.05, z + 0.006), (sx * 1.0, y1 - 0.05, z + 0.006), (sx * 1.0, y1 - 0.05, z - 0.006)], (sx, 0, 0), off=0.002)
        b.box('dark', sx * 0.99, sx * 1.02, y1 - 0.04, y1, z0, z1)
    # environmental control unit on the front face, projecting over the cab roof
    b.box('paint', -0.72, 0.52, 1.92, y1 - 0.02, z0 - 0.34, z0, bev=0.02)
    b.panel('mesh', [(-0.66, 2.0, z0 - 0.341), (0.46, 2.0, z0 - 0.341), (0.46, 2.52, z0 - 0.341), (-0.66, 2.52, z0 - 0.341)], (0, 0, -1), off=0.002)
    b.cyl('dark', (0.62, 2.1, z0 - 0.12), (0.62, 2.5, z0 - 0.12), 0.12, 0.12, 12)                # exhaust / power unit stack
    b.cyl('soot', (0.62, 2.5, z0 - 0.12), (0.62, 2.54, z0 - 0.12), 0.1, 0.1, 12)
    # louvred ECU grille on the left side and a data-entry panel with connectors on the right
    vkit.louvres(b, x0, 1.45, 1.98, 2.5, 2.95, 7, side=-1)
    b.panel('dark', [(x1, 1.3, 2.55), (x1, 1.3, 2.95), (x1, 1.6, 2.95), (x1, 1.6, 2.55)], (1, 0, 0), off=0.003)
    for k in range(4):
        b.cyl('dark', (x1 + 0.003, 1.4, 2.62 + k * 0.09), (x1 + 0.05, 1.4, 2.62 + k * 0.09), 0.025, 0.025, 8)
    # small window on each side
    for sx in (-1, 1):
        b.panel('glass', [(sx * 1.0, 2.05, 3.75), (sx * 1.0, 2.05, 4.05), (sx * 1.0, 2.3, 4.05), (sx * 1.0, 2.3, 3.75)], (sx, 0, 0), off=0.004, frame=0.03, frame_skin='dark')
    # rear: door opening (dark, seen when the door swings open), fold-down steps, spare wheel, lamps
    b.panel('interior', [(-0.45, 1.16, z1), (0.35, 1.16, z1), (0.35, 2.36, z1), (-0.45, 2.36, z1)], (0, 0, 1), off=0.002)
    for k, y in enumerate((0.72, 0.95)):
        b.box('dark', -0.4, 0.3, y - 0.02, y, z1 + 0.05, z1 + 0.28)
    b.beam('dark', (-0.42, 0.7, z1 + 0.28), (-0.42, 1.12, z1 + 0.02), 0.025, 0.025)
    b.beam('dark', (0.32, 0.7, z1 + 0.28), (0.32, 1.12, z1 + 0.02), 0.025, 0.025)
    # interior equipment racks seen through the door: consoles with screens
    b.box('dash', -0.9, -0.6, 1.2, 2.2, z1 - 1.6, z1 - 0.2)
    b.panel('screen', [(-0.6, 1.7, z1 - 1.4), (-0.6, 1.7, z1 - 0.8), (-0.6, 2.05, z1 - 0.8), (-0.6, 2.05, z1 - 1.4)], (1, 0, 0), off=0.004)
    b.panel('dials', [(-0.6, 1.35, z1 - 1.4), (-0.6, 1.35, z1 - 0.8), (-0.6, 1.62, z1 - 0.8), (-0.6, 1.62, z1 - 1.4)], (1, 0, 0), off=0.004)
    b.box('floor', -0.95, 0.95, 1.1, 1.14, z0 + 0.1, z1 - 0.05)
    # whip antennas on the shelter's front corners and a GPS puck
    for sx in (-1, 1):
        vkit.whip_antenna(b, (sx * 0.9, y1, z0 + 0.1), h=2.6)
    b.cyl('white', (0.0, y1, 3.4), (0.0, y1 + 0.04, 3.4), 0.07, 0.06, 10)
    # roof cable run from the ECU to the antennas
    b.tube('cable', [(-0.9, y1 + 0.02, z0 + 0.1), (-0.5, y1 + 0.02, z0 + 0.3), (0.0, y1 + 0.02, 3.4)], 0.015, 5)


def mast(v, b):
    """telescopic antenna mast strapped to the shelter's rear right corner: a fixed base tube, two sliding sections,
    a biconical antenna on top"""
    x, z = MAST_X, MAST_Z
    y_base0, y_base1 = 1.05, 2.72
    b.cyl('paint', (x, y_base0, z), (x, y_base1, z), 0.065, 0.065, 10)
    b.cyl('dark', (x, y_base1 - 0.04, z), (x, y_base1, z), 0.075, 0.075, 10)
    for y in (1.5, 2.3):
        b.box('dark', x - 0.09, x + 0.09, y - 0.04, y + 0.04, SH[5], z + 0.02)          # clamps to the shelter
    b.box('dark', x - 0.1, x + 0.1, y_base0 - 0.06, y_base0, z - 0.1, z + 0.1)
    # three nested sections, each 1.55 m long, sliding 1.35 m out of the one below (0.1 m stays inside when extended)
    travel, length = 1.35, 1.55
    parent, top, r = None, y_base1, 0.052
    names = ('mast', 'mast_2', 'mast_3')
    for k, name in enumerate(names):
        t = top + 0.1                                   # this section's top at rest, 0.1 above the one below
        m = Part(v, name, pivot=(x, t, z), parent=parent, joint=slide('y', travel, group='raise'))
        m.cyl('aluminium', (x, t - length, z), (x, t, z), r, r, 10)
        m.cyl('dark', (x, t - 0.04, z), (x, t, z), r + 0.008, r + 0.008, 10)       # locking collar
        parent, top, r = m, t, r - 0.011
    # biconical antenna head (two cones) with its feed, on the top section
    m = parent
    m.cyl('dark', (x, top, z), (x, top + 0.05, z), 0.03, 0.03, 8)
    m.cyl('black', (x, top + 0.05, z), (x, top + 0.28, z), 0.02, 0.24, 12)
    m.cyl('black', (x, top + 0.3, z), (x, top + 0.53, z), 0.24, 0.02, 12)
    m.empty('mast_head', (x, top + 0.53, z), (0, 1, 0))


def shelter_door(v):
    x0, x1, y0, y1, z0, z1 = SH
    d = Part(v, 'door_shelter', pivot=(-0.46, 1.76, z1 + 0.01), joint=rot('y', -1.7, 0.0, stow=0.0, deploy=-1.7, group='door'))
    d.box('paint', -0.46, 0.36, 1.15, 2.37, z1, z1 + 0.035, bev=0.008)
    vkit.grab_handle(d, (0.26, 1.72, z1 + 0.036), (0, 1, 0), (0, 0, 1), 0.16, 0.035, 'dark')
    for y in (1.4, 2.1):
        d.cyl('dark', (-0.47, y - 0.06, z1 + 0.02), (-0.47, y + 0.06, z1 + 0.02), 0.018, 0.018, 6)
    d.panel('yellow', [(-0.2, 2.18, z1 + 0.035), (0.1, 2.18, z1 + 0.035), (0.1, 2.26, z1 + 0.035), (-0.2, 2.26, z1 + 0.035)], (0, 0, 1), off=0.002)


def make():
    vkit.setup_materials('blue_tan')
    v = Vehicle('cmd_blue', 'M1113 HMMWV command post shelter', scheme='blue_tan')
    b = Part(v, 'body')
    hmmwv.front(b)
    hmmwv.cab(b, v)
    hmmwv.rear(b)
    proto = hmmwv.wheels(v)
    shelter(v, b)
    shelter_door(v)
    mast(v, b)
    # spare wheel standing against the shelter's rear left (a flat mount plate and the wheel)
    x0, x1, y0, y1, z0, z1 = SH
    b.box('dark', -0.95, -0.5, 1.2, 2.05, z1, z1 + 0.04)
    Part(v, 'spare', pivot=(-0.72, 1.62, z1 + 0.22), local=True, rest_yaw=-math.pi / 2, share=proto)   # outer face aft
    b.empty('exhaust', (0.95, 0.5, 2.4), (1, 0, 0))
    b.empty('seat_driver', (-0.5, 1.15, 1.95), (0, 0, -1))
    b.empty('hatch_entry', (-1.6, 0.0, 1.8), (1, 0, 0))
    return v

# ═══════════════════════════════════════════════════════════════
# M1157 FMTV 10-ton dump truck (Oshkosh / Stewart & Stevenson Medium Tactical Vehicle, 6×6), the US Army and USAF
# engineer dump truck used for crater fill in rapid runway repair.
#   blender -b -P tools/airbases/build.py -- dumptruck
# FMTV sheet: 7.4 m long, 2.44 m wide, 2.9 m to the cab roof, 395/85R20 tyres, 10 m³ (≈ 7 m³ struck) steel
# dump body with a cab protector and a top-hinged tailgate; front-mounted telescopic hoist, ~50° tip.
# The cab is the kit's FMTV LSAC armoured cab (usfam.fmtv_armoured_cab, as on the M142). Photos: M1157 dump trucks
# (US Army / DVIDS, public domain) and the TM 9-2320-392-10 outline drawings.
# Rig: bed (rot x about the rear hinge, group 'raise': 0 down … 1 tipped 50°), ram (the hoist), 6 wheels (front
# axle steers), door_l / door_r, exhaust.
# ═══════════════════════════════════════════════════════════════
import math
import akit
import vkit
from akit import Vehicle, Part, rot
import usfam
from usfam import FMTV

AXLES = [1.34, 4.85, 6.35]
ZEND = 7.35
HINGE = (0.0, 1.32, 7.12)
BED = {'z0': 2.72, 'z1': 7.3, 'hw': 1.2, 'y0': 1.36, 'y1': 2.32}


def chassis(v, b):
    F = FMTV
    fb, ft = F['frame']
    R = F['R']
    for sx in (-1, 1):
        b.box('dark', sx * 0.38, sx * 0.5, fb, ft, 0.3, ZEND - 0.04)
        b.box('dark', sx * 0.4, sx * 0.52, ft, HINGE[1] - 0.04, 2.6, ZEND - 0.1)            # dump subframe
    for z in (0.5, 2.4, 3.8, 5.6, ZEND - 0.2):
        b.box('dark', -0.38, 0.38, fb + 0.04, ft - 0.04, z - 0.06, z + 0.06)
    for z in AXLES:
        b.cyl('dark', (-0.82, R, z), (0.82, R, z), 0.08, 0.08, 10)
        b.lathe((0, R, z - 0.24), (0, 0, 1), [(0, 0.05, 'dark'), (0.05, 0.18, 'dark'), (0.34, 0.19, 'dark'), (0.42, 0.08, 'dark')], n=12)
        for sx in (-1, 1):
            b.box('dark', sx * 0.34, sx * 0.52, R + 0.06, fb, z - 0.5, z + 0.5)
    b.cyl('dark', (0, R + 0.1, 1.0), (0, R + 0.05, AXLES[-1]), 0.05, 0.05, 8)
    usfam.wheels(v, None, AXLES, F['track'], R, F['W'], F['rim'], steer={0: 1.0}, lugs=18, seg=22, nbolts=10, cti=True,
                 rim_skin='paint', hub_skin='paint', tread='block', rim_dish=0.05)
    # hinge brackets at the tail
    for sx in (-1, 1):
        b.box('dark', sx * 0.55, sx * 0.72, ft - 0.1, HINGE[1] + 0.08, HINGE[2] - 0.15, HINGE[2] + 0.15)
        b.cyl('steel', (sx * 0.5, HINGE[1], HINGE[2]), (sx * 0.78, HINGE[1], HINGE[2]), 0.06, 0.06, 10)
    # behind the cab: exhaust stack, air intake, fuel tank, battery box
    b.cyl('dark', (0.98, 1.3, 2.52), (0.98, 3.1, 2.52), 0.07, 0.07, 10)
    b.cyl('paint', (0.98, 2.0, 2.52), (0.98, 2.85, 2.52), 0.095, 0.095, 10, cap0=False, cap1=False)
    b.empty('exhaust', (0.98, 3.1, 2.52), (0, 1, 0))
    b.box('paint', -1.15, -0.72, 1.2, 2.95, 2.42, 2.66, bev=0.02)
    b.panel('mesh', [(-1.1, 2.95, 2.46), (-0.77, 2.95, 2.46), (-0.77, 2.95, 2.62), (-1.1, 2.95, 2.62)], (0, 1, 0), off=0.004)
    b.cyl('paint', (-0.92, 0.95, 2.6), (-0.92, 0.95, 3.95), 0.27, 0.27, 16)
    b.box('paint', 0.62, 1.2, 0.72, 1.1, 2.6, 3.9, bev=0.02)
    usfam.hatch_x(b, 1.2, 1, 0.76, 1.06, 2.66, 3.84)
    # rear: fenders over the tandem, mud flaps, lights, pintle
    for sx in (-1, 1):
        b.box('paint', sx * 0.72, sx * 1.2, 1.28, 1.32, 4.1, 7.1)
        b.box('rubber', sx * 0.75, sx * 1.18, 0.38, 1.28, ZEND - 0.3, ZEND - 0.27)
        vkit.lamp_box(b, (sx * 0.95, 1.0, ZEND - 0.12), (0.2, 0.1, 0.05), (0, 0, 1), lens='lens_red')
        usfam.reflector_tri(b, (sx * 0.62, 1.0, ZEND - 0.14), (0, 0, 1), 0.06)
    b.box('paint', -1.1, 1.1, 0.75, 1.1, ZEND - 0.28, ZEND - 0.14, bev=0.02)
    b.box('dark', -0.1, 0.1, 0.8, 0.98, ZEND - 0.14, ZEND - 0.04)


def bed(v):
    p = Part(v, 'bed', pivot=HINGE, joint=rot('x', 0.0, math.radians(50), stow=0.0, deploy=math.radians(50), group='raise'))
    z0, z1, hw, y0, y1 = BED['z0'], BED['z1'], BED['hw'], BED['y0'], BED['y1']
    # long sills and cross sills under the floor
    for sx in (-1, 1):
        p.box('paint', sx * 0.42, sx * 0.58, HINGE[1] - 0.02, y0, z0 + 0.1, z1 - 0.1)
    for z in (z0 + 0.4, z0 + 1.5, z0 + 2.6, z1 - 0.5):
        p.box('paint', -hw, hw, y0 - 0.1, y0, z - 0.05, z + 0.05)
    # the box: floor, sides with top rails and vertical stakes, headboard, cab protector
    p.box('paint', -hw, hw, y0, y0 + 0.08, z0, z1)
    for sx in (-1, 1):
        p.box('paint', sx * (hw - 0.05), sx * hw, y0, y1, z0, z1)
        p.box('paint', sx * (hw - 0.07), sx * (hw + 0.06), y1 - 0.12, y1, z0, z1)
        for z in (z0 + 0.9, z0 + 1.9, z0 + 2.9, z0 + 3.8):
            p.box('paint', sx * hw, sx * (hw + 0.05), y0, y1 - 0.12, z - 0.05, z + 0.05)
    top = 3.14                                                                                       # over the 3.0 m cab roof
    p.box('paint', -hw, hw, y0, top, z0, z0 + 0.06)
    p.box('paint', -hw, hw, top - 0.08, top, 1.9, z0 + 0.06)                                         # cab protector
    for sx in (-1, 1):
        p.box('paint', sx * (hw - 0.08), sx * hw, y1 + 0.1, top, 1.95, z0)
    for k in range(4):
        z = 2.0 + k * 0.22
        p.box('dark', -hw + 0.1, hw - 0.1, top, top + 0.03, z - 0.03, z + 0.03)
    # top-hinged tailgate with its latch levers
    p.box('paint', -hw + 0.05, hw - 0.05, y0 + 0.02, y1 - 0.02, z1 - 0.06, z1)
    for x in (-0.6, 0.0, 0.6):
        p.box('paint', x - 0.05, x + 0.05, y0 + 0.02, y1 - 0.02, z1, z1 + 0.04)
    for sx in (-1, 1):
        p.cyl('dark', (sx * (hw - 0.02), y1 - 0.08, z1 - 0.03), (sx * (hw + 0.1), y1 - 0.08, z1 - 0.03), 0.04, 0.04, 8)
        p.beam('dark', (sx * (hw + 0.06), y0 + 0.15, z1 - 0.2), (sx * (hw + 0.06), y0 + 0.5, z1 - 0.05), 0.04, 0.04)
    # a load of crater fill (crushed stone), heaped
    heap = [(z0 + 0.15, y0 + 0.1), (z0 + 0.9, y1 - 0.15), (z1 - 1.2, y1 - 0.12), (z1 - 0.15, y0 + 0.4)]
    p.prism_x('dirt', [(heap[0][0], y0 + 0.09)] + heap + [(heap[-1][0], y0 + 0.09)], -hw + 0.06, hw - 0.06)
    return p


def make():
    akit.setup_materials('blue_tan')
    v = Vehicle('dumptruck', 'M1157 FMTV dump truck', scheme='blue_tan')
    b = Part(v, 'body')
    usfam.fmtv_armoured_cab(v, b)
    chassis(v, b)
    p = bed(v)
    vkit.ram(v, 'ram', b, (0.0, 0.98, 4.15), p, (0.0, BED['y0'] - 0.1, 3.55), r=0.11)
    return v

# ═══════════════════════════════════════════════════════════════
# 9A310M1 TELAR of the 9K37M1 Buk-M1 (NATO SA-11 Gadfly) on the GM-569 tracked chassis.
#   blender -b -P tools/vehicles/build.py -- buk
# References: 9.3 × 3.25 × 3.8 m, 32.4 t; 9M38 missile 5.55 m × 0.40 m, wing span 0.86 m; the side view at Park
# Patriot 2015 (Vitaly V. Kuzmin, Wikimedia Commons) for the road-wheel stations, heights and the missile layout,
# the 3/4 views at MAKS and the museum 9A310M1 (radome, turret panels, guard hoops).
# Rig: turret (rot y, full circle; carries the 9S35 radome), launcher (the missile arm, rot x about its rear pivot,
# 0 → 70°, + = noses up), missile_1..4 (children of the launcher: 1-2 upper/inner, 3-4 lower/outer), muzzle_1..4
# (at the noses), track_l / track_r (scrolling), road wheels wheel_1..6<l|r>, sprocket_<l|r> (rear), idler_<l|r>
# (front), hatch_driver, exhaust, seat_driver, hatch_entry.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Vehicle, Part, rot, lerp
import redkit

DECK = 2.24
FENDER = 1.42
TRX = 1.33            # track centre line
TRW = 0.46            # track width
THK = 0.08            # track thickness
RW_R = 0.34           # road wheel radius
RW_S = [6.30, 5.26, 4.24, 3.22, 2.20, 1.20]     # rear → front
RW_Y = RW_R + THK     # road wheel centre height (track bottom on y = 0)
SPR = (7.28, 0.60, 0.38)   # rear drive sprocket (z, y, r)
IDL = (0.66, 1.00, 0.28)   # front idler
ROLL = [(2.1, 1.18, 0.09), (4.2, 1.18, 0.09), (6.1, 1.18, 0.09)]   # return rollers (front → rear)
REAR = 8.58
TPIV = (0.0, DECK, 3.62)   # turret axis
LPIV = (0.0, 3.34, 6.40)   # launcher pivot (rear of the arm)
M_IN = (0.36, 3.72, 1.10)  # inner (upper) missiles: x, axis y, nose z
M_OUT = (0.96, 3.56, 1.42) # outer (lower) missiles
M_LEN = 5.55
M_R = 0.20


def rrect(cx, cy, z, w, h, r, n=4):
    """a rounded rectangle ring (x, y at depth z), counter-clockwise from the bottom-right"""
    pts = []
    corners = [(cx + w / 2 - r, cy - h / 2 + r, -math.pi / 2), (cx + w / 2 - r, cy + h / 2 - r, 0.0),
               (cx - w / 2 + r, cy + h / 2 - r, math.pi / 2), (cx - w / 2 + r, cy - h / 2 + r, math.pi)]
    for (x, y, a0) in corners:
        for i in range(n + 1):
            a = a0 + (math.pi / 2) * i / n
            pts.append((x + r * math.cos(a), y + r * math.sin(a), z))
    return pts


def hull(b):
    # lower hull between the tracks (belly, lower glacis, rear plate)
    low = [(0.0, 1.32), (0.36, FENDER), (REAR - 0.1, FENDER), (REAR - 0.1, 0.62), (REAR - 0.35, 0.46), (0.70, 0.46)]
    b.prism_x('paint', low, -1.08, 1.08)
    # upper hull over the tracks: full width, the upper glacis rising to the deck
    up = [(0.02, 1.36), (0.88, DECK), (REAR, DECK), (REAR + 0.05, 2.1), (REAR + 0.05, FENDER), (0.36, FENDER)]
    b.prism_x('paint', up, -1.56, 1.56)
    # track guards (fenders) along the top of the runs, turned down at the front
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 1.08, sx * 1.60))
        b.box('paint', x0, x1, FENDER - 0.04, FENDER, -0.12, REAR + 0.1)
        b.face([(x0, FENDER - 0.04, -0.12), (x1, FENDER - 0.04, -0.12), (x1, 1.12, -0.28), (x0, 1.12, -0.28)], 'paint', want=(0, -0.3, -1))
        b.face([(x0, FENDER, -0.12), (x0, 1.16, -0.28), (x1, 1.16, -0.28), (x1, FENDER, -0.12)], 'paint', want=(0, 0.5, -1))
        # steel lip along the fender's outer edge
        b.box('paint', sx * 1.575, sx * 1.60, FENDER - 0.14, FENDER - 0.04, 0.0, REAR - 0.05)
    # side stowage boxes along the sponsons (the "panelled" hull sides), the engine air intake mesh at the rear
    for sx in (-1, 1):
        x = sx * 1.56
        zs = [0.9, 1.75, 2.45, 3.35, 4.15, 4.95]
        for i in range(len(zs) - 1):
            za, zb = zs[i] + 0.03, zs[i + 1] - 0.03
            b.box('paint', x, x + sx * 0.05, FENDER + 0.08, DECK - 0.1, za, zb, bev=0.01)
            vkit.grab_handle(b, (x + sx * 0.055, DECK - 0.35, (za + zb) / 2), (0, 0, 1), (sx, 0, 0), 0.14, 0.025, 'dark')
        b.panel('mesh', [(x, FENDER + 0.12, 5.2), (x, FENDER + 0.12, 7.5), (x, 1.82, 7.5), (x, 1.82, 5.2)], (sx, 0, 0), off=0.004, frame=0.03, frame_skin='dark')
        b.box('paint', x, x + sx * 0.05, 1.9, DECK - 0.08, 5.2, 7.5, bev=0.01)
        b.box('paint', x, x + sx * 0.06, FENDER + 0.1, DECK - 0.08, 7.6, REAR - 0.05, bev=0.01)
    # front: driver's hatch frame, headlights, tow hooks, glacis plates
    b.panel('dark', [(-1.05, DECK, 0.95), (-0.45, DECK, 0.95), (-0.45, DECK, 1.45), (-1.05, DECK, 1.45)], (0, 1, 0), off=0.004)
    g0, g1 = Vector((0, 1.36, 0.02)), Vector((0, DECK, 0.88))
    n = Vector((0, (g1 - g0).z, -(g1 - g0).y)).normalized()
    for sx in (-1, 1):
        p = Vector((sx * 1.3, 0, 0)) + g0.lerp(g1, 0.55) + n * 0.02
        vkit.headlight(b, tuple(p), tuple(n), r=0.08, depth=0.09, skin_body='dark', lens='lens', guard=True)
        b.cyl('dark', (sx * 0.62, 1.12, -0.06), (sx * 0.62, 1.12, 0.14), 0.06, 0.06, 8)
        b.tube('dark', [(sx * 0.62, 1.05, -0.08), (sx * 0.62, 0.92, -0.02), (sx * 0.62, 1.0, 0.1)], 0.025, 5)
        vkit.lamp_box(b, (sx * 1.45, 1.52, 0.2), (0.08, 0.06, 0.05), (0, 0, -1), lens='lens_amber', skin='dark')
    # spare track links on the upper glacis, tow cables along the sponsons, a boarding step at the front
    for i in range(4):
        q0 = g0.lerp(g1, 0.18 + i * 0.13)
        b.box('track_pad', 0.05, 1.25, q0.y + 0.0, q0.y + 0.05, q0.z - 0.05, q0.z + 0.05)
        b.box('dark', 0.05, 1.25, q0.y + 0.05, q0.y + 0.07, q0.z - 0.015, q0.z + 0.015)
    for sx in (-1, 1):
        b.tube('dark', [(sx * 1.6, DECK - 0.12, 1.2), (sx * 1.615, DECK - 0.14, 3.0), (sx * 1.615, DECK - 0.14, 4.7), (sx * 1.6, DECK - 0.12, 5.0)], 0.022, 5)
        b.box('dark', sx * 1.56, sx * 1.66, FENDER + 0.05, FENDER + 0.09, 0.7, 1.0)
    # driver's vision blocks in front of the hatch
    for dx in (-0.25, 0.0, 0.25):
        redkit.vision_block(b, (-0.75 + dx, DECK - 0.05, 0.9), (0, 0.4, -1), w=0.12, h=0.06, d=0.06)
    # rear: lights, tow pintle, the exhaust outlet on the right rear deck
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 1.35, 1.95, REAR + 0.07), (0.12, 0.09, 0.05), (0, 0, 1), lens='lens_red')
        b.cyl('dark', (sx * 0.5, 1.0, REAR - 0.12), (sx * 0.5, 1.0, REAR + 0.02), 0.06, 0.06, 8)
    b.box('dark', -0.12, 0.12, 0.8, 1.0, REAR - 0.1, REAR + 0.12)
    b.box('dark', 0.8, 1.35, DECK, DECK + 0.14, 7.9, 8.4, bev=0.02)
    b.panel('black', [(0.86, DECK + 0.141, 7.96), (1.29, DECK + 0.141, 7.96), (1.29, DECK + 0.141, 8.34), (0.86, DECK + 0.141, 8.34)], (0, 1, 0), off=0.002)
    # rear deck grilles
    for sx in (-1, 1):
        b.panel('mesh', [(sx * 0.15, DECK, 6.75), (sx * 0.75, DECK, 6.75), (sx * 0.75, DECK, 8.3), (sx * 0.15, DECK, 8.3)], (0, 1, 0), off=0.004, frame=0.03, frame_skin='dark')
    # turret ring
    b.cyl('dark', (0, DECK, TPIV[2]), (0, DECK + 0.05, TPIV[2]), 1.32, 1.32, 32)
    # return rollers (static) and the sprocket / idler hubs' mounts on the hull
    for sx in (-1, 1):
        for (z, y, r) in ROLL:
            b.cyl('dark', (sx * (TRX - 0.12), y, z), (sx * (TRX + 0.12), y, z), r, r, 10)
            b.cyl('dark', (sx * 1.08, y, z), (sx * (TRX - 0.12), y, z), 0.04, 0.04, 6)
        for (z, y, r) in (SPR, IDL):
            b.cyl('dark', (sx * 1.08, y, z), (sx * (TRX - 0.2), y, z), 0.12, 0.12, 10)
        # suspension arms (torsion bar cranks) to each road wheel
        for z in RW_S:
            b.beam('dark', (sx * 1.1, RW_Y + 0.2, z + 0.35), (sx * 1.14, RW_Y, z), 0.08, 0.1)


def road_wheels(v):
    proto = None
    for i, z in enumerate(reversed(RW_S)):      # wheel_1 is the front one
        for side in (1, -1):
            name = 'wheel_%d%s' % (i + 1, 'r' if side > 0 else 'l')
            if proto is None:
                p = Part(v, name, pivot=(side * TRX, RW_Y, z), local=True)
                redkit.road_wheel(p, RW_R, 0.38, rim_skin='paint', tyre='rubber', dual=True, bolts=8)
                proto = p
            else:
                Part(v, name, pivot=(side * TRX, RW_Y, z), local=True, rest_yaw=0.0 if side > 0 else math.pi, share=proto)
            v.meta['wheels'].append({'node': name, 'r': RW_R + THK, 'steer': 0, 'side': side})
    # drive sprockets (rear) and idlers (front)
    sp = None
    idl = None
    for side in (1, -1):
        s = 'r' if side > 0 else 'l'
        if sp is None:
            sp = Part(v, 'sprocket_' + s, pivot=(side * TRX, SPR[1], SPR[0]), local=True)
            sprocket(sp, SPR[2])
        else:
            Part(v, 'sprocket_' + s, pivot=(side * TRX, SPR[1], SPR[0]), local=True, rest_yaw=math.pi, share=sp)
        if idl is None:
            idl = Part(v, 'idler_' + s, pivot=(side * TRX, IDL[1], IDL[0]), local=True)
            redkit.road_wheel(idl, IDL[2], 0.36, rim_skin='paint', tyre='dark', dual=True, bolts=6)
        else:
            Part(v, 'idler_' + s, pivot=(side * TRX, IDL[1], IDL[0]), local=True, rest_yaw=math.pi, share=idl)
        v.meta['wheels'].append({'node': 'sprocket_' + s, 'r': SPR[2] + THK, 'steer': 0, 'side': side})
        v.meta['wheels'].append({'node': 'idler_' + s, 'r': IDL[2] + THK, 'steer': 0, 'side': side})


def sprocket(p, r, teeth=13):
    """drive sprocket, local coordinates (axle along x, outer face +x): two toothed rings on a hub"""
    for x0 in (-0.17, 0.09):
        x1 = x0 + 0.08
        p.cyl('paint', (x0, 0, 0), (x1, 0, 0), r * 0.86, r * 0.86, 16)
        for k in range(teeth):
            a0 = 2 * math.pi * k / teeth
            a1 = a0 + 2 * math.pi / teeth * 0.45
            am = (a0 + a1) / 2
            base0 = (math.cos(a0) * r * 0.84, math.sin(a0) * r * 0.84)
            base1 = (math.cos(a1) * r * 0.84, math.sin(a1) * r * 0.84)
            tip = (math.cos(am) * r * 1.02, math.sin(am) * r * 1.02)
            tip0 = (math.cos(am - 0.05) * r * 1.02, math.sin(am - 0.05) * r * 1.02)
            tip1 = (math.cos(am + 0.05) * r * 1.02, math.sin(am + 0.05) * r * 1.02)
            ring = [base0, tip0, tip1, base1]
            for (xf, s) in ((x0, -1), (x1, 1)):
                p.face([(xf, yz[0], yz[1]) for yz in ring], 'paint', want=(s, 0, 0))
            for i in range(3):
                a, b2 = ring[i], ring[i + 1]
                mid = ((a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2)
                p.face([(x0, a[0], a[1]), (x1, a[0], a[1]), (x1, b2[0], b2[1]), (x0, b2[0], b2[1])], 'paint', want=(0, mid[0], mid[1]))
    p.cyl('paint', (-0.12, 0, 0), (0.24, 0, 0), r * 0.4, r * 0.4, 12)
    p.bolts('dark', (0.24, 0, 0), (1, 0, 0), r * 0.26, 10, rb=0.014, h=0.02, seg=5)
    p.cyl('dark', (0.24, 0, 0), (0.28, 0, 0), r * 0.16, r * 0.12, 10, cap0=False)


def tracks(v):
    circles = [SPR] + [(z, RW_Y, RW_R) for z in RW_S] + [IDL] + ROLL
    for side in (-1, 1):
        vkit.track_run(v, side, side * TRX, TRW, circles, thick=THK, tile=0.60)


def turret(v):
    t = Part(v, 'turret', pivot=TPIV, joint=rot('y', -math.pi, math.pi, stow=0.0, deploy=0.0, group='turret'))
    y0 = DECK + 0.05
    z0, z1 = 0.95, 6.48
    # turret body: vertical lower sides, sloped upper side panels, flat top
    prof = [(-1.36, y0), (1.36, y0), (1.36, 2.84), (1.02, 3.26), (-1.02, 3.26), (-1.36, 2.84)]
    t.prism_z('paint', prof, z0, z1)
    # the sloped side panels: doors with X stiffeners (two big ones forward, then smaller boxes)
    for sx in (-1, 1):
        a0, a1 = Vector((sx * 1.36, 2.84, 0)), Vector((sx * 1.02, 3.26, 0))
        n = Vector((sx * (a1 - a0).y, -abs((a1 - a0).x) * 0 + abs(a1.x - a0.x), 0)).normalized()
        n = Vector((sx * 0.42, 0.34, 0)).normalized()
        for (za, zb) in ((1.05, 2.25), (2.35, 3.55), (3.65, 4.75), (4.85, 6.35)):
            pts = [a0.lerp(a1, 0.1) + Vector((0, 0, za)), a0.lerp(a1, 0.1) + Vector((0, 0, zb)), a0.lerp(a1, 0.9) + Vector((0, 0, zb)), a0.lerp(a1, 0.9) + Vector((0, 0, za))]
            t.panel('paint', pts, n, off=0.02, frame=0.02, frame_skin='dark')
            c0, c1 = pts[0] + n * 0.03, pts[2] + n * 0.03
            c2, c3 = pts[1] + n * 0.03, pts[3] + n * 0.03
            t.beam('paint', c0.lerp(c1, 0.12), c0.lerp(c1, 0.88), 0.03, 0.02, up=tuple(n))
            t.beam('paint', c2.lerp(c3, 0.12), c2.lerp(c3, 0.88), 0.03, 0.02, up=tuple(n))
            t.box('dark', min(pts[0].x, pts[2].x) + 0.1 * sx * 0, max(pts[0].x, pts[2].x), (pts[0].y + pts[2].y) / 2 - 0.02, (pts[0].y + pts[2].y) / 2 + 0.02, (za + zb) / 2 - 0.08, (za + zb) / 2 + 0.08)
        # lower side: equipment boxes with latches
        for (za, zb) in ((1.0, 1.9), (2.0, 3.0), (3.1, 4.2), (4.3, 5.3), (5.4, 6.4)):
            t.box('paint', sx * 1.36, sx * 1.4, y0 + 0.08, 2.78, za, zb, bev=0.01)
            t.box('dark', sx * 1.4, sx * 1.415, 2.55, 2.62, zb - 0.16, zb - 0.08)
    # rear face: boxes, the launcher's pivot brackets
    t.box('paint', -1.1, 1.1, y0 + 0.1, 3.0, z1, z1 + 0.18, bev=0.02)
    for sx in (-1, 1):
        t.box('dark', sx * 0.55, sx * 0.72, 3.15, LPIV[1] + 0.1, LPIV[2] - 0.25, LPIV[2] + 0.2)
    # the 9S35 "Fire Dome" radome on the front: a rounded loaf, bulging forwards
    rings = []
    for (z, sc, dy) in ((1.05, 1.0, 0.0), (0.6, 1.0, 0.0), (0.05, 0.98, 0.0), (-0.25, 0.9, 0.02), (-0.42, 0.72, 0.04), (-0.5, 0.45, 0.06)):
        rings.append(rrect(0.0, 2.80 + dy, z, 1.34 * sc, 1.06 * sc, 0.34 * sc, n=4))
    t.loft('paint', rings, smooth=True, cap1=True)
    t.face(rings[0], 'paint', want=(0, 0, 1))
    # radome frame / clamp band where it meets the turret
    t.loft('dark', [rrect(0.0, 2.80, 1.02, 1.40, 1.12, 0.36, n=4), rrect(0.0, 2.80, 0.92, 1.40, 1.12, 0.36, n=4)], smooth=True)
    for sx in (-1, 1):
        for y in (2.5, 3.1):
            t.box('dark', sx * 0.7, sx * 0.76, y - 0.06, y + 0.06, 0.9, 1.05)
    # optical tracker (TV sight) on the turret's front top, right side
    t.box('paint', 0.62, 0.98, 3.26, 3.52, 1.2, 1.7, bev=0.03)
    t.cyl('paint', (0.8, 3.44, 1.1), (0.8, 3.44, 1.22), 0.1, 0.1, 12)
    t.disc('glass', (0.8, 3.44, 1.098), (0, 0, -1), 0.075, 12)
    t.box('dark', 0.66, 0.94, 3.52, 3.58, 1.25, 1.62)
    # antennas at the rear corners
    for sx in (-1, 1):
        vkit.whip_antenna(t, (sx * 0.95, 3.26, 6.2), h=2.4)
    # cable harness along the top
    t.tube('hose', [(-0.2, 3.27, 1.6), (-0.2, 3.28, 5.9), (-0.4, 3.2, 6.3)], 0.025, 5)
    return t


def r9m38(m, nose, n=14):
    """a 9M38 missile along +z from `nose`: white radome, green body, four long-chord wings and four tail fins (X)"""
    nose = Vector(nose)
    L = M_LEN
    prof = [(0.0, 0.0, 'missile_white'), (0.12, 0.07, 'missile_white'), (0.45, 0.15, 'missile_white'), (0.85, 0.195, 'missile_white'),
            (0.95, 0.2, 'dark'), (1.0, 0.2, 'missile_green'), (L - 0.05, 0.2, 'missile_green'), (L, 0.16, 'soot')]
    m.lathe(nose, (0, 0, 1), prof, n=n, smooth=True, cap1=True)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        d = Vector((math.cos(a), math.sin(a), 0))
        tt = Vector((-math.sin(a), math.cos(a), 0)) * 0.012
        for (za, zb, zt0, zt1, span) in ((2.2, 3.7, 2.9, 3.62, 0.43), (L - 0.42, L - 0.05, L - 0.28, L - 0.08, 0.43)):
            A = nose + d * M_R + Vector((0, 0, za))
            B = nose + d * M_R + Vector((0, 0, zb))
            C = nose + d * span + Vector((0, 0, zt1))
            D = nose + d * span + Vector((0, 0, zt0))
            pts = [A, B, C, D]
            for s in (1, -1):
                m.face([tuple(p + tt * s) for p in pts], 'missile_green', want=tuple(tt * s))
            for i in range(4):
                j = (i + 1) % 4
                e = (pts[i] + pts[j]) / 2 - (A + C) / 2
                m.face([tuple(pts[i] + tt), tuple(pts[j] + tt), tuple(pts[j] - tt), tuple(pts[i] - tt)], 'missile_green', want=tuple(e))


def launcher(v, t):
    L = Part(v, 'launcher', pivot=LPIV, parent=t, joint=rot('x', 0.0, math.radians(65), stow=0.0, deploy=math.radians(40), group='launcher'))
    # the arm: a central spine and cross-beams carrying four rails
    L.box('paint', -0.16, 0.16, 3.28, 3.44, 1.6, LPIV[2] + 0.12, bev=0.02)
    for z in (2.0, 3.6, 5.2, 6.2):
        L.box('paint', -1.02, 1.02, 3.32, 3.40, z - 0.07, z + 0.07)
    L.cyl('dark', (-0.5, LPIV[1], LPIV[2]), (0.5, LPIV[1], LPIV[2]), 0.09, 0.09, 12)
    k = 1
    for (mx, my, mz) in (M_IN, M_OUT):
        for sx in (-1, 1):
            x = sx * mx
            # rail above the missile, with two hangers
            L.box('dark', x - 0.05, x + 0.05, my + M_R + 0.02, my + M_R + 0.1, mz + 1.4, mz + 4.9)
            for zh in (mz + 1.8, mz + 4.4):
                L.box('dark', x - 0.035, x + 0.035, my + M_R - 0.02, my + M_R + 0.03, zh - 0.06, zh + 0.06)
            # post from the rail down to the arm's cross-beams
            for z in (3.6, 5.2):
                L.beam('paint', (x, my + M_R + 0.06, z), (x * 0.7, 3.40, z), 0.06, 0.06)
            mis = Part(v, 'missile_%d' % k, pivot=(x, my, mz + M_LEN), parent=L)
            r9m38(mis, (x, my, mz))
            mis.empty('nozzle_%d' % k, (x, my, mz + M_LEN), (0, 0, 1))
            L.empty('muzzle_%d' % k, (x, my, mz), (0, 0, -1))
            k += 1
    # guard hoops over the noses and the tails
    for (z0, z1, h) in ((1.3, 2.1, 0.62), (5.6, 6.4, 0.52)):
        for sx in (-1, 1):
            L.tube('dark', [(sx * 1.08, 3.40, z0), (sx * 1.08, 3.40 + h, z0 + 0.1), (sx * 1.08, 3.40 + h, z1 - 0.1), (sx * 1.08, 3.40, z1)], 0.022, 6)
        L.tube('dark', [(-1.08, 3.40 + h, (z0 + z1) / 2), (-0.6, 3.40 + h + 0.12, (z0 + z1) / 2), (0.6, 3.40 + h + 0.12, (z0 + z1) / 2), (1.08, 3.40 + h, (z0 + z1) / 2)], 0.022, 6)
    return L


def make():
    vkit.setup_materials('red_camo')
    v = Vehicle('buk', '9A310M1 Buk-M1 TELAR (SA-11 Gadfly)', scheme='red_camo')
    b = Part(v, 'body')
    hull(b)
    road_wheels(v)
    tracks(v)
    t = turret(v)
    launcher(v, t)
    h = Part(v, 'hatch_driver', pivot=(-0.75, DECK + 0.01, 1.45), joint=rot('x', 0.0, math.radians(100), group='hatch'))
    h.box('paint', -1.02, -0.48, DECK, DECK + 0.05, 0.98, 1.45, bev=0.012)
    h.cyl('dark', (-0.98, DECK + 0.02, 1.45), (-0.52, DECK + 0.02, 1.45), 0.025, 0.025, 6)
    vkit.grab_handle(h, (-0.75, DECK + 0.05, 1.12), (1, 0, 0), (0, 1, 0), 0.18, 0.03, 'dark')
    b.empty('exhaust', (1.08, DECK + 0.16, 8.15), (0, 1, 0))
    b.empty('seat_driver', (-0.75, 1.75, 1.2), (0, 0, -1))
    b.empty('hatch_entry', (-0.75, DECK + 0.3, 1.2), (0, 1, 0))
    return v

# ═══════════════════════════════════════════════════════════════
# US wheeled family (Blender, with vkit): Michelin XZL wheels, the M860 semi-trailer the Patriot launching station
# and radar ride on (gooseneck, tandem bogie, landing gear, four swing-out outriggers), the HEMTT A4 cab and
# chassis, the FMTV armoured cab. Game frame, z = distance aft of the vehicle's front (vkit recentres the result).
#
# M860 references: JASDF / RoCAF M901 launching stations and radar sets (Wikimedia Commons): 2.90 m overall width
# (marked on the trailer), 13,250 kg payload; single 14.00R20-class tyres on a walking-beam tandem.
# HEMTT A4 (Oshkosh M983A4 spec sheet): 9.119 × 2.438 m, 2.997 m over the spare, track 2.007 m, wheelbase (tandem
# centres) 4.661 m, 16.00R20 XZL tyres, front tandem steers.
# ═══════════════════════════════════════════════════════════════
import math
from mathutils import Vector
import vkit
from vkit import Part, rot, slide, lerp, vec

# ── wheels ──

def wheels(v, parent, axles, track, R, W, rim, steer=None, lugs=20, seg=24, nbolts=10, cti=True, prefix='wheel',
           hub_skin='paint', rim_skin='paint', tread='block', rim_dish=0.05):
    """one shared wheel mesh on every hub: wheel_<axle><l|r> (right wheels hold the mesh, left ones share it turned
    180°). steer: {axle index: share of the steering angle}. Writes vk.wheels. (Adapted from chassis.wheels.)"""
    steer = steer or {}
    proto = None
    for i, z in enumerate(axles):
        for side in (1, -1):
            name = '%s_%d%s' % (prefix, i + 1, 'r' if side > 0 else 'l')
            if proto is None:
                p = Part(v, name, pivot=(side * track / 2, R, z), parent=parent, local=True)
                vkit.build_wheel(p, R, W, rim, lugs=lugs, seg=seg, nbolts=nbolts, cti=cti, hub_skin=hub_skin,
                                 rim_skin=rim_skin, tread=tread, rim_dish=rim_dish)
                proto = p
            else:
                p = Part(v, name, pivot=(side * track / 2, R, z), parent=parent, local=True,
                         rest_yaw=0.0 if side > 0 else math.pi, share=proto)
            v.meta['wheels'].append({'node': name, 'r': R, 'steer': steer.get(i, 0), 'side': side})
    return proto


# ── small parts ──

def panel_lines(b, pts, normal, w=0.012, skin='black'):
    """dark seam lines along a closed outline lying on a face"""
    nr = Vector(normal).normalized()
    P = [vec(p) for p in pts]
    for i in range(len(P)):
        a, c = P[i], P[(i + 1) % len(P)]
        d = (c - a)
        if d.length < 1e-6:
            continue
        s = d.normalized().cross(nr) * (w / 2)
        b.panel(skin, [a - s, c - s, c + s, a + s], nr, off=0.003)


def rect_on_x(x, y0, y1, z0, z1):
    return [(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)]


def hatch_x(b, x, sx, y0, y1, z0, z1, handle=True, hinge='front'):
    """a door / access hatch outline on a side face at plane x (outward sx): seams, handle, hinges"""
    panel_lines(b, rect_on_x(x, y0, y1, z0, z1), (sx, 0, 0))
    if handle:
        zh = z1 - 0.08 if hinge == 'front' else z0 + 0.08
        vkit.grab_handle(b, (x + sx * 0.01, (y0 + y1) / 2, zh), (0, 1, 0), (sx, 0, 0), min(0.18, (y1 - y0) * 0.5), 0.03, 'dark')
    zg = z0 + 0.02 if hinge == 'front' else z1 - 0.02
    for yy in (y0 + (y1 - y0) * 0.2, y1 - (y1 - y0) * 0.2):
        b.cyl('dark', (x + sx * 0.015, yy - 0.05, zg), (x + sx * 0.015, yy + 0.05, zg), 0.016, 0.016, 6)


def stencil_box(b, c, w, h, normal, skin='decal_white'):
    """a small stencilled marking (a pale rectangle) on a face"""
    nr = Vector(normal).normalized()
    a, bb = vkit.frame_from_axis(nr)
    c = vec(c)
    # keep the rectangle's 'h' side vertical when the face is vertical
    up = Vector((0, 1, 0)) if abs(nr.y) < 0.9 else Vector((0, 0, 1))
    right = up.cross(nr).normalized()
    up = nr.cross(right).normalized()
    pts = [c - right * w / 2 - up * h / 2, c + right * w / 2 - up * h / 2, c + right * w / 2 + up * h / 2, c - right * w / 2 + up * h / 2]
    b.panel(skin, pts, nr, off=0.004)


def text_faces(txt, size):
    """flat letter polygons of `txt` (Blender's built-in font), centred: [(x, y), ...] lists, x reading, y up"""
    import bpy
    cu = bpy.data.curves.new('vk_txt', type='FONT')
    cu.body = txt
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.extrude = 0.0
    ob = bpy.data.objects.new('vk_txt', cu)
    bpy.context.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    polys = [[(me.vertices[i].co.x, me.vertices[i].co.y) for i in p.vertices] for p in me.polygons]
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bpy.data.curves.remove(cu)
    return polys


def add_text(part, skin, txt, size, origin, right, up, project=None, off=0.004):
    """stencil lettering on a surface: letters laid out along `right` and `up` from `origin`, facing right × up;
    project(p) → p can push each vertex onto a curved surface"""
    o, r, u = vec(origin), Vector(right).normalized(), Vector(up).normalized()
    n = r.cross(u)
    for poly in text_faces(txt, size):
        pts = []
        for (x, y) in poly:
            p = o + r * x + u * y
            if project:
                p = project(p)
            pts.append(p + n * off)
        part.face([tuple(p) for p in pts], skin, want=tuple(n))


def reflector_tri(b, c, normal, s=0.07, skin='lens_red'):
    nr = Vector(normal).normalized()
    c = vec(c)
    up = Vector((0, 1, 0))
    right = up.cross(nr).normalized()
    pts = [c + up * s * 0.6, c - right * s * 0.55 - up * s * 0.4, c + right * s * 0.55 - up * s * 0.4]
    b.panel(skin, pts, nr, off=0.004)


# ── M860 semi-trailer ──

M860 = {
    'len': 10.50,          # gooseneck front → rear frame end
    'neck': 3.0,           # gooseneck length
    'axles': [8.15, 9.55],
    'track': 2.00,
    'R': 0.60, 'W': 0.38, 'rim': 0.30,
    'deck': 1.35,          # main deck top
    'neck_bot': 1.52,      # gooseneck underside (rests on the tractor's fifth wheel)
    'neck_top': 2.00,
    'kingpin': 0.90,
    'half': 1.22,          # deck half width
}


def outrigger(v, key, root, sx, stow_dir, deploy_ang, arm=1.55, foot=0.45, parent=None):
    """a swing-out outrigger: outrigger_<key> (arm, rot y about its root hinge, group 'jack') carrying jack_<key>
    (the screw leg, slide -y, group 'jack', its foot on y = 0 when deployed). Modelled folded along the trailer
    side (stow_dir = +1 pointing aft / -1 forward); deploy_ang = rotation to the deployed, splayed position."""
    x, y, z = root
    a = Part(v, 'outrigger_' + key, pivot=(x, y, z), parent=parent,
             joint=rot('y', min(0.0, deploy_ang), max(0.0, deploy_ang), stow=0.0, deploy=deploy_ang, group='jack'))
    tip = z + stow_dir * arm
    # hinge knuckle (turns with the arm), upper and lower beams converging on the leg head
    a.cyl('dark', (x, y - 0.22, z), (x, y + 0.34, z), 0.06, 0.06, 10)
    a.beam('paint', (x, y - 0.14, z + stow_dir * 0.05), (x, y + 0.02, tip), 0.12, 0.14)
    a.beam('paint', (x, y + 0.28, z + stow_dir * 0.05), (x, y + 0.10, tip - stow_dir * 0.08), 0.09, 0.09)
    a.beam('paint', (x, y - 0.1, z + stow_dir * 0.6), (x, y + 0.2, z + stow_dir * 0.62), 0.05, 0.05)
    # tread plate on the arm (crews stand on it)
    a.box('paint', x - 0.07, x + 0.07, y + 0.05, y + 0.14, tip - stow_dir * 0.12 - 0.12, tip - stow_dir * 0.12 + 0.12)
    # leg head sleeve
    a.cyl('paint', (x, y - 0.35, tip), (x, y + 0.22, tip), 0.075, 0.075, 12)
    a.cyl('dark', (x, y + 0.22, tip), (x, y + 0.27, tip), 0.085, 0.085, 12)
    # the leg: screw, inner tube, ball joint and a square foot pad
    leg = Part(v, 'jack_' + key, pivot=(x, y, tip), parent=a, joint=slide('-y', foot, group='jack'))
    leg.cyl('steel', (x, foot + 0.12, tip), (x, y + 0.2, tip), 0.05, 0.05, 10)
    leg.cyl('dark', (x, foot + 0.06, tip), (x, foot + 0.14, tip), 0.07, 0.06, 10)
    leg.box('dark', x - 0.23, x + 0.23, foot, foot + 0.05, tip - 0.23, tip + 0.23, bev=0.012)
    leg.box('paint', x - 0.16, x + 0.16, foot + 0.05, foot + 0.07, tip - 0.16, tip + 0.16)
    # crank on the leg head
    leg.beam('dark', (x, y + 0.34, tip), (x + sx * 0.18, y + 0.34, tip), 0.02, 0.02)
    leg.cyl('dark', (x, y + 0.27, tip), (x, y + 0.36, tip), 0.02, 0.02, 6)
    return a, leg


def m860_trailer(v, b, gear_parent=None):
    """the M860 semi-trailer on static part b (+ its wheels, landing gear, four outriggers, kingpin)."""
    T = M860
    L, hw = T['len'], T['half']
    yd = T['deck']
    nb, nt = T['neck_bot'], T['neck_top']
    # ── gooseneck: box structure, front face with lamps, underside plate with the kingpin ──
    b.box('paint', -hw, hw, nb, nt, 0.0, T['neck'] - 0.35, bev=0.03)
    b.box('dark', -0.9, 0.9, nb - 0.02, nb, 0.3, 1.6)                  # bearing plate
    b.cyl('steel', (0, nb - 0.09, T['kingpin']), (0, nb - 0.02, T['kingpin']), 0.045, 0.045, 10)
    b.empty('kingpin', (0, nb - 0.09, T['kingpin']), (0, 0, -1))
    for sx in (-1, 1):
        vkit.lamp_box(b, (sx * 1.05, nt - 0.12, -0.01), (0.1, 0.07, 0.04), (0, 0, -1), lens='lens_amber')
        vkit.lamp_box(b, (sx * 0.55, nt - 0.12, -0.01), (0.09, 0.06, 0.04), (0, 0, -1), lens='lens_amber')
        # side reinforcing ribs and the air / electrical couplings on the front face
        for z in (0.6, 1.3, 2.0):
            b.box('paint', sx * hw - 0.02, sx * hw + sx * 0.03, nb + 0.04, nt - 0.04, z - 0.04, z + 0.04)
    for x, sk in ((-0.35, 'red'), (-0.18, 'lens_blue')):
        b.cyl('dark', (x, nb + 0.2, -0.02), (x, nb + 0.2, 0.05), 0.045, 0.045, 8)
        b.disc(sk, (x, nb + 0.2, -0.021), (0, 0, -1), 0.03, 8)
    b.cyl('black', (0.3, nb + 0.2, -0.03), (0.3, nb + 0.2, 0.05), 0.06, 0.06, 10)
    # ── the neck: sloping down from the gooseneck to the main deck ──
    zn0, zn1 = T['neck'] - 0.35, T['neck'] + 0.35
    for sx in (-1, 1):
        prof = [(zn0, nb), (zn0, nt), (zn1, yd), (zn1, yd - 0.45)]
        b.prism_x('paint', prof, sx * 0.62 - 0.1, sx * 0.62 + 0.1)
    b.face([(-hw, nt, zn0), (hw, nt, zn0), (hw, yd, zn1), (-hw, yd, zn1)], 'paint', want=(0, 1, 0.8))
    # ── main frame and deck ──
    for sx in (-1, 1):
        b.box('dark', sx * 0.48, sx * 0.64, yd - 0.50, yd - 0.04, zn1, L - 0.05)       # I-beams
        b.box('paint', sx * (hw - 0.1), sx * hw, yd - 0.26, yd, zn1, L)                 # side rail (C channel)
        # stake pockets / tie-downs along the side rail
        for k in range(8):
            z = lerp(zn1 + 0.4, L - 0.4, k / 7)
            b.box('dark', sx * hw, sx * (hw + 0.02), yd - 0.2, yd - 0.06, z - 0.05, z + 0.05)
    b.box('paint', -hw, hw, yd - 0.05, yd, zn1, L)
    for z in [zn1 + 0.6 + 0.9 * k for k in range(8)]:
        if z < L - 0.3:
            b.box('dark', -0.48, 0.48, yd - 0.45, yd - 0.15, z - 0.06, z + 0.06)
    # underside pan (hides the see-through between the beams)
    b.face([(-hw, yd - 0.26, zn1), (hw, yd - 0.26, zn1), (hw, yd - 0.26, L), (-hw, yd - 0.26, L)], 'dark', want=(0, -1, 0))
    # ── rear frame end: bumper, lights, reflectors, plate, steps ──
    b.box('paint', -hw, hw, yd - 0.62, yd - 0.05, L - 0.22, L, bev=0.02)
    b.box('orange', -0.45, 0.45, yd - 0.60, yd - 0.50, L, L + 0.01)
    for sx in (-1, 1):
        for k, (lx, lens) in enumerate(((0.95, 'lens_red'), (0.78, 'lens_red'), (0.61, 'lens_amber'))):
            b.cyl('dark', (sx * lx, yd - 0.36, L), (sx * lx, yd - 0.36, L + 0.04), 0.065, 0.06, 12)
            b.disc(lens, (sx * lx, yd - 0.36, L + 0.041), (0, 0, 1), 0.055, 12)
        reflector_tri(b, (sx * 1.1, yd - 0.18, L), (0, 0, 1), 0.07)
        b.box('dark', sx * 0.2, sx * 0.3, yd - 0.9, yd - 0.62, L - 0.2, L - 0.05)       # step hanger
        b.box('dark', sx * 0.08, sx * 0.42, yd - 0.92, yd - 0.88, L - 0.28, L - 0.02)
    b.panel('white', [(-0.2, yd - 0.30, L), (0.2, yd - 0.30, L), (0.2, yd - 0.14, L), (-0.2, yd - 0.14, L)], (0, 0, 1), off=0.004)
    # ── tandem bogie: walking beams, trunnion, axles ──
    zc = (T['axles'][0] + T['axles'][1]) / 2
    R = T['R']
    for sx in (-1, 1):
        xb = sx * 0.72
        b.box('dark', xb - 0.08, xb + 0.08, R - 0.12, R + 0.1, T['axles'][0] - 0.2, T['axles'][1] + 0.2, bev=0.02)
        b.box('dark', xb - 0.1, xb + 0.1, R + 0.1, yd - 0.3, zc - 0.25, zc + 0.25)          # trunnion bracket
        b.cyl('dark', (xb - 0.18, R + 0.05, zc), (xb + 0.18, R + 0.05, zc), 0.12, 0.12, 12)
        for z in T['axles']:
            b.cyl('dark', (xb, R, z), (sx * 0.84, R, z), 0.1, 0.1, 10)
    for z in T['axles']:
        b.cyl('dark', (-0.72, R, z), (0.72, R, z), 0.075, 0.075, 10)
    # mud flaps behind the rear wheels
    for sx in (-1, 1):
        b.box('rubber', sx * 0.78, sx * 1.2, 0.35, yd - 0.26, T['axles'][1] + 0.72, T['axles'][1] + 0.74)
    wheels(v, None, T['axles'], T['track'], R, T['W'], T['rim'], lugs=20, seg=24, nbolts=10, cti=True,
           rim_skin='paint', hub_skin='paint', tread='block', prefix='wheel')
    # ── landing gear (front support legs), raised for towing: group 'gear' ──
    zg = 2.30
    gear = Part(v, 'landing_gear', pivot=(0, nb, zg), parent=gear_parent,
                joint=slide('y', 0.42, group='gear'))
    for sx in (-1, 1):
        x = sx * 0.82
        b.box('paint', x - 0.09, x + 0.09, 0.62, nb, zg - 0.09, zg + 0.09)                  # outer leg (static)
        gear.box('paint', x - 0.065, x + 0.065, 0.1, 0.8, zg - 0.065, zg + 0.065)          # inner leg
        gear.box('dark', x - 0.2, x + 0.2, 0.0, 0.1, zg - 0.22, zg + 0.22, bev=0.02)        # sand shoe
    b.beam('paint', (-0.82, 0.9, zg), (0.82, 1.3, zg), 0.06, 0.06)
    b.beam('paint', (0.82, 0.9, zg), (-0.82, 1.3, zg), 0.06, 0.06)
    b.box('dark', 0.86, 1.0, 1.15, 1.25, zg - 0.05, zg + 0.05)                               # gearbox
    b.beam('dark', (1.0, 1.2, zg), (1.18, 1.2, zg), 0.025, 0.025)                            # crank
    b.beam('dark', (1.18, 1.2, zg), (1.18, 1.0, zg), 0.025, 0.025)
    # ── four swing-out outriggers, folded along the sides ──
    rigs = {}
    for sx, side in ((-1, 'l'), (1, 'r')):
        # front pair folded forward under the gooseneck, rear pair folded aft behind the trailer; both splay 45° out.
        # Hinge knuckles on the frame (static).
        xf, xr = 1.15, 1.20
        b.box('dark', sx * 0.64, sx * (xf + 0.02), yd - 0.55, yd - 0.28, 3.23, 3.47)
        b.box('dark', sx * 1.02, sx * (xr + 0.02), yd - 0.55, yd - 0.28, 10.40, 10.62)
        rigs['f' + side] = outrigger(v, 'f' + side, (sx * xf, yd - 0.30, 3.35), sx, -1, -sx * math.radians(45))
        rigs['r' + side] = outrigger(v, 'r' + side, (sx * xr, yd - 0.30, 10.52), sx, +1, sx * math.radians(45))
    return {'gear': gear, 'outriggers': rigs}


# ── HEMTT A4 ──

HEMTT = {
    'track': 2.007,
    'R': 0.62, 'W': 0.43, 'rim': 0.30,     # 16.00R20 XZL
    'half': 1.219,                          # 2.438 m wide
    'cab_z': (0.22, 2.42), 'cab_top': 2.86,
    'eng_z': (2.46, 3.98), 'eng_top': 2.60,
    'frame': (0.86, 1.22),                  # frame rail bottom / top
}


def _plan(zf, zr, hw, ch):
    """cab plan ring (x, z): rounded (chamfered) front corners, square rear"""
    return [(-hw + ch, zf), (hw - ch, zf), (hw, zf + ch), (hw, zr), (-hw, zr), (-hw, zf + ch)]


def hemtt_cab(v, b, doors=True):
    """the HEMTT A4 cab (common with the PLS A1): flat, slightly raked front with a two-pane windscreen, headlight
    boxes low on the front corners, amber roof markers, big doors, mirrors on tubular arms. Returns the door parts."""
    H = HEMTT
    zf, zr = H['cab_z']
    hw = H['half'] - 0.02
    top = H['cab_top']
    yb_front, yb_arch, yw0, yw1 = 1.02, 1.36, 1.92, 2.70
    # lower front block (ahead of the front wheel), chamfered lower corners seen from the front
    prof = [(-hw + 0.32, yb_front), (hw - 0.32, yb_front), (hw, yb_front + 0.32), (hw, yw0), (-hw, yw0), (-hw, yb_front + 0.32)]
    b.prism_z('paint', prof, zf, 1.28)
    # main cab body over the wheel
    b.box('paint', -hw, hw, yb_arch, yw0, 1.28, zr)
    # upper cab: windscreen raked back ~23°, roof crowned
    r0 = [(x, yw0, z) for (x, z) in _plan(zf, zr, hw, 0.08)]
    r1 = [(x, yw1, z) for (x, z) in _plan(zf + 0.33, zr, hw, 0.08)]
    r2 = [(x, top, z) for (x, z) in _plan(zf + 0.48, zr - 0.04, hw - 0.05, 0.1)]
    b.loft('paint', [r0, r1, r2], smooth=False)
    b.face(r2, 'paint', want=(0, 1, 0))
    b.face(r0, 'paint', want=(0, -1, 0))
    # windscreen: two panes on the raked front (ring edge 0)
    A0, A1, B0, B1 = Vector(r0[0]), Vector(r0[1]), Vector(r1[0]), Vector(r1[1])
    n = (A1 - A0).cross(B0 - A0).normalized()
    if n.z > 0:
        n = -n

    def on(u, w):
        return lerp(lerp(A0, A1, u), lerp(B0, B1, u), w)
    for (u0, u1) in ((0.03, 0.485), (0.515, 0.97)):
        b.panel('glass', [on(u0, 0.08), on(u1, 0.08), on(u1, 0.92), on(u0, 0.92)], n, off=0.006, frame=0.035)
    for u in (0.25, 0.75):
        b.beam('black', on(u, 0.1) + n * 0.02, on(u - 0.08, 0.7) + n * 0.02, 0.014, 0.008)
    # sun visor / roof marker lights across the front edge
    for k in range(5):
        x = lerp(-0.85, 0.85, k / 4)
        vkit.lamp_box(b, (x, top + 0.03, zf + 0.52), (0.1, 0.06, 0.07), (0, 0, -1), lens='lens_amber')
    b.box('paint', -hw + 0.05, hw - 0.05, top - 0.02, top + 0.03, zf + 0.46, zf + 0.62)
    # lower front: headlight boxes, turn signals, blackout light, name plate, grab handles
    for sx in (-1, 1):
        cx = sx * (hw - 0.34)
        b.box('dark', cx - 0.2, cx + 0.2, 1.32, 1.6, zf - 0.08, zf + 0.02, bev=0.02)
        vkit.headlight(b, (cx - sx * 0.07, 1.46, zf - 0.08), (0, 0, -1), r=0.08, depth=0.04, skin_body='dark', lens='lens')
        vkit.lamp_box(b, (cx + sx * 0.12, 1.46, zf - 0.07), (0.08, 0.12, 0.04), (0, 0, -1), lens='lens_amber', skin='dark')
        vkit.lamp_box(b, (sx * (hw - 0.02), 1.72, zf + 0.2), (0.05, 0.08, 0.1), (sx, 0, 0), lens='lens_amber')
        vkit.grab_handle(b, (sx * (hw - 0.2), 1.8, zf - 0.005), (1, 0, 0), (0, 0, -1), 0.3, 0.04, 'dark')
    b.box('dark', -0.22, 0.22, 1.72, 1.8, zf - 0.02, zf)
    vkit.lamp_box(b, (0.45, 1.3, zf - 0.03), (0.12, 0.06, 0.04), (0, 0, -1), lens='lens', skin='dark')
    usfam_panel = panel_lines
    usfam_panel(b, [(-hw + 0.1, 1.08, zf), (hw - 0.1, 1.08, zf), (hw - 0.1, 1.86, zf), (-hw + 0.1, 1.86, zf)], (0, 0, -1), 0.01)
    # bumper with tow shackles, pintle and the winch fairlead; under-cab protection plate
    b.box('paint', -1.16, 1.16, 0.64, 1.02, 0.0, zf + 0.1, bev=0.03)
    for sx in (-1, 1):
        for dx in (0.72, 0.9):
            b.tube('dark', [(sx * dx, 0.86, -0.0), (sx * dx, 0.78, -0.03), (sx * dx, 0.72, -0.07), (sx * dx, 0.74, -0.11), (sx * dx, 0.82, -0.12)], 0.022, 6)
        b.box('dark', sx * 0.66, sx * 0.96, 0.8, 0.9, -0.03, 0.02)
    b.box('dark', -0.18, 0.18, 0.72, 0.94, -0.04, 0.02)
    b.cyl('dark', (-0.12, 0.83, -0.05), (0.12, 0.83, -0.05), 0.045, 0.045, 8)
    b.face([(-1.0, 0.64, zf + 0.08), (1.0, 0.64, zf + 0.08), (0.8, 0.5, 1.25), (-0.8, 0.5, 1.25)], 'dark', want=(0, -1, -0.5))
    # doors (hinged at the front edge): window, handle, seams; a boarding ladder below
    parts = {}
    for sx, key in ((-1, 'l'), (1, 'r')):
        x = sx * hw
        dz0, dz1, dy0, dy1 = 0.98, 1.96, 1.42, 2.66
        if doors:
            d = Part(v, 'door_' + key, pivot=(x, dy0, dz0), parent=None,
                     joint=rot([0, sx, 0], 0.0, 1.15, stow=0.0, deploy=1.15, group='door'))   # rear edge swings out
            t = 0.05
            xo_ = x + sx * 0.012              # the door stands a little proud of the cab side
            xi = xo_ - sx * t
            d.box('paint', min(xo_, xi), max(xo_, xi), dy0, dy1, dz0, dz1, bev=0.01)
            d.panel('glass', [(xo_, 2.02, dz0 + 0.08), (xo_, 2.02, dz1 - 0.08), (xo_, 2.58, dz1 - 0.08), (xo_, 2.58, dz0 + 0.2)], (sx, 0, 0), off=0.006, frame=0.035)
            d.panel('glass', [(xi, 2.02, dz0 + 0.08), (xi, 2.02, dz1 - 0.08), (xi, 2.58, dz1 - 0.08), (xi, 2.58, dz0 + 0.2)], (-sx, 0, 0), off=0.006)
            vkit.grab_handle(d, (xo_ + sx * 0.01, 1.86, dz1 - 0.15), (0, 0, 1), (sx, 0, 0), 0.16, 0.035, 'dark')
            d.box('dark', min(xo_, xo_ + sx * 0.02), max(xo_, xo_ + sx * 0.02), 1.72, 1.8, dz0 + 0.12, dz0 + 0.3)
            parts['door_' + key] = d
            # the body's opening behind the door (dark), so an opened door shows the cab's inside
            b.panel('interior', [(x, dy0 + 0.02, dz0 + 0.02), (x, dy0 + 0.02, dz1 - 0.02), (x, dy1 - 0.02, dz1 - 0.02), (x, dy1 - 0.02, dz0 + 0.02)], (sx, 0, 0), off=0.002)
        # boarding ladder ahead of the front wheel, grab rail beside the door
        for k, y in enumerate((0.55, 0.85, 1.15)):
            b.box('dark', min(x, x - sx * 0.36), max(x, x - sx * 0.36), y - 0.03, y, 0.95 + 0.03 * k, 1.28)
        b.beam('dark', (x - sx * 0.02, 0.5, 0.95), (x - sx * 0.02, 1.36, 1.02), 0.03, 0.03)
        vkit.grab_handle(b, (x + sx * 0.01, 2.05, 2.1), (0, 1, 0), (sx, 0, 0), 0.6, 0.05, 'dark')
        # mirrors on tubular arms from the A-pillar
        base = Vector((x, 2.45, zf + 0.35))
        head = Vector((x + sx * 0.2, 2.3, zf + 0.1))
        b.tube('dark', [base, base + Vector((sx * 0.2, 0.08, -0.1)), head], 0.018, 5)
        b.tube('dark', [Vector((x, 1.95, zf + 0.3)), head + Vector((0, -0.25, 0.02))], 0.016, 5)
        b.box('dark', head.x - 0.1, head.x + 0.1, head.y - 0.34, head.y + 0.08, head.z - 0.02, head.z + 0.05)
        b.panel('glass', [(head.x - 0.08, head.y - 0.32, head.z + 0.05), (head.x + 0.08, head.y - 0.32, head.z + 0.05), (head.x + 0.08, head.y + 0.06, head.z + 0.05), (head.x - 0.08, head.y + 0.06, head.z + 0.05)], (0, 0, 1), off=0.003)
        b.cyl('dark', (head.x, head.y - 0.46, head.z + 0.02), (head.x, head.y - 0.46, head.z + 0.1), 0.08, 0.08, 10)
    # rear wall: small window, roof hatch ring
    b.panel('glass', [(-0.5, 2.1, zr), (0.5, 2.1, zr), (0.5, 2.55, zr), (-0.5, 2.55, zr)], (0, 0, 1), off=0.005, frame=0.03)
    b.cyl('paint', (0.35, top, 1.75), (0.35, top + 0.06, 1.75), 0.42, 0.42, 20)
    b.cyl('dark', (0.35, top + 0.06, 1.75), (0.35, top + 0.08, 1.75), 0.36, 0.36, 20)
    b.empty('seat_driver', (-0.55, 1.95, 1.3), (0, 0, -1))
    b.empty('hatch_entry', (-1.6, 0.0, 1.2), (1, 0, 0))
    return parts


def hemtt_engine(b, spare=True):
    """the engine compartment behind the cab: radiator grille on the right, air cleaner on the left, exhaust stack,
    the spare wheel lying on top"""
    H = HEMTT
    z0, z1 = H['eng_z']
    y0, y1 = 1.36, H['eng_top']
    hw = 1.15
    b.box('paint', -hw, hw, y0, y1, z0, z1, bev=0.03)
    # right side: the big radiator grille (vertical slats)
    x = hw
    b.panel('black', [(x, 1.55, z0 + 0.12), (x, 1.55, z1 - 0.12), (x, y1 - 0.12, z1 - 0.12), (x, y1 - 0.12, z0 + 0.12)], (1, 0, 0), off=0.002)
    for k in range(16):
        z = lerp(z0 + 0.16, z1 - 0.16, k / 15)
        b.box('paint', x, x + 0.03, 1.56, y1 - 0.13, z - 0.02, z + 0.02)
    b.box('paint', x, x + 0.035, 1.5, 1.56, z0 + 0.1, z1 - 0.1)
    b.box('paint', x, x + 0.035, y1 - 0.13, y1 - 0.07, z0 + 0.1, z1 - 0.1)
    # left side: access panels, the air cleaner canister with its pre-cleaner
    hatch_x(b, -hw, -1, 1.5, 2.45, z0 + 0.15, z0 + 0.72)
    hatch_x(b, -hw, -1, 1.5, 2.45, z0 + 0.78, z1 - 0.15, hinge='back')
    b.cyl('paint', (-0.98, 1.45, z1 + 0.28), (-0.98, 2.55, z1 + 0.28), 0.26, 0.26, 16)
    b.cyl('dark', (-0.98, 2.55, z1 + 0.28), (-0.98, 2.62, z1 + 0.28), 0.2, 0.16, 12)
    b.tube('hose', [(-0.98, 2.3, z1 + 0.02), (-0.85, 2.3, z1 - 0.1)], 0.1, 8)
    # exhaust stack with a perforated heat shield and rain cap (right rear corner)
    ex, ez = 0.98, z1 + 0.18
    b.cyl('dark', (ex, 1.6, ez), (ex, 3.12, ez), 0.075, 0.075, 10)
    b.cyl('paint', (ex, 2.2, ez), (ex, 2.95, ez), 0.1, 0.1, 10, cap0=False, cap1=False)
    b.cyl('soot', (ex, 3.12, ez), (ex, 3.16, ez), 0.08, 0.08, 10)
    b.empty('exhaust', (ex, 3.16, ez), (0, 1, 0))
    # lifting eyes, top grille
    b.panel('vents', [(-0.9, y1, z0 + 0.15), (0.9, y1, z0 + 0.15), (0.9, y1, z1 - 0.15), (-0.9, y1, z1 - 0.15)], (0, 1, 0), off=0.003)
    if spare:
        # the spare wheel lying flat on its bracket
        R, W = H['R'], H['W']
        cz = (z0 + z1) / 2
        b.box('dark', -0.5, 0.5, y1, y1 + 0.05, cz - 0.1, cz + 0.1)
        b.box('dark', -0.1, 0.1, y1, y1 + 0.05, cz - 0.5, cz + 0.5)
        yc = y1 + 0.05 + W / 2
        b.lathe((0, yc - W / 2, cz), (0, 1, 0), [(0, H['rim'] * 0.9, 'dark'), (0.02, R - 0.15, 'tyre_side'), (0.05, R - 0.03, 'tyre'),
                                                 (W - 0.05, R - 0.03, 'tyre'), (W - 0.02, R - 0.15, 'tyre_side'), (W, H['rim'] * 0.9, 'dark')], n=24, smooth=True)
        for k in range(24):
            a0 = 2 * math.pi * k / 24
            for (ya, yb2) in ((0.03, W / 2 - 0.02), (W / 2 + 0.02, W - 0.03)):
                if (k + (ya > 0.1)) % 2:
                    continue
                p0 = Vector((math.cos(a0) * R, 0, math.sin(a0) * R))
                p1 = Vector((math.cos(a0 + 0.15) * R, 0, math.sin(a0 + 0.15) * R))
                b.beam('tyre', (p0.x, yc - W / 2 + ya, cz + p0.z), (p0.x, yc - W / 2 + yb2, cz + p0.z), 0.07, 0.05, up=(p0.x, 0, p0.z))
        b.cyl('dark', (0, yc + W / 2, cz), (0, yc + W / 2 + 0.02, cz), H['rim'] * 0.9, H['rim'] * 0.9, 16)
        b.cyl('dark', (0, yc + W / 2 + 0.02, cz), (0, yc + W / 2 + 0.08, cz), 0.1, 0.08, 10)
        for sx in (-1, 1):
            b.beam('dark', (sx * 0.62, yc + W / 2, cz), (sx * 0.62, y1, cz), 0.05, 0.05)


def hemtt_chassis(v, b, axles, zend, fenders=((), ()), tank=True):
    """frame, drivetrain, suspension, wheels, fenders and the side tanks of a HEMTT A4 (8×8, front tandem steers)"""
    H = HEMTT
    fb, ft = H['frame']
    R = H['R']
    for sx in (-1, 1):
        b.box('dark', sx * 0.40, sx * 0.52, fb, ft, 0.3, zend - 0.05)
    for z in (0.5, 2.6, 4.2, 5.9, (axles[2] + axles[3]) / 2, zend - 0.2):
        b.box('dark', -0.4, 0.4, fb + 0.05, ft - 0.05, z - 0.06, z + 0.06)
    b.face([(-0.95, fb - 0.02, 0.6), (0.95, fb - 0.02, 0.6), (0.95, fb - 0.02, zend - 0.3), (-0.95, fb - 0.02, zend - 0.3)], 'dark', want=(0, -1, 0))
    for i, z in enumerate(axles):
        # axle housing with its differential, spring / air-bag suspension
        b.cyl('dark', (-0.8, R, z), (0.8, R, z), 0.09, 0.09, 10)
        b.lathe((0, R, z - 0.28), (0, 0, 1), [(0, 0.05, 'dark'), (0.06, 0.2, 'dark'), (0.4, 0.22, 'dark'), (0.5, 0.1, 'dark')], n=12, smooth=True)
        for sx in (-1, 1):
            b.box('dark', sx * 0.36, sx * 0.56, R + 0.08, fb, z - 0.45, z + 0.45)            # spring pack
            b.cyl('rubber', (sx * 0.72, R + 0.12, z + 0.25), (sx * 0.72, fb, z + 0.25), 0.1, 0.1, 10)   # air bag / bump stop
            b.cyl('dark', (sx * 0.62, R + 0.05, z - 0.2), (sx * 0.62, fb + 0.1, z - 0.3), 0.035, 0.035, 6)  # damper
    # drive shafts
    b.cyl('dark', (0, R + 0.12, 1.2), (0, R + 0.05, axles[-1]), 0.05, 0.05, 8)
    wheels(v, None, axles, H['track'], R, H['W'], H['rim'], steer={0: 1.0, 1: 0.62}, lugs=20, seg=24, nbolts=10,
           cti=True, rim_skin='dark', hub_skin='dark', tread='block', rim_dish=0.06)
    # front fenders under the cab / engine box, rear fenders with mud flaps
    for sx in (-1, 1):
        x0, x1 = sx * 0.72, sx * 1.22
        b.box('paint', x0, x1, 1.36, 1.4, 1.2, 4.1)
        for (za, zb) in fenders[1]:
            b.box('paint', x0, x1, 1.34, 1.4, za, zb)
            b.box('paint', x1 - sx * 0.05, x1, 1.0, 1.4, za, za + 0.05)
            b.box('rubber', x0 + sx * 0.05, x1, 0.4, 1.34, zb - 0.02, zb + 0.01)
    if tank:
        # the vehicle's own fuel tank on the right, battery box and air tanks on the left
        b.cyl('paint', (1.0, 0.98, 4.25), (1.0, 0.98, 5.55), 0.3, 0.3, 16)
        for z in (4.5, 5.3):
            b.box('dark', 0.68, 1.32, 0.66, 1.3, z - 0.04, z + 0.04)
        b.cyl('dark', (1.0, 1.26, 4.9), (1.0, 1.36, 4.9), 0.07, 0.07, 8)
        b.box('paint', -1.2, -0.62, 0.72, 1.24, 4.2, 4.95, bev=0.02)
        hatch_x(b, -1.2, -1, 0.76, 1.2, 4.25, 4.9)
        for y in (0.82, 1.1):
            b.cyl('dark', (-0.95, y, 5.1), (-0.95, y, 5.95), 0.12, 0.12, 12)


# ── FMTV with the armoured (LSAC) cab, as on the M142 HIMARS ──

FMTV = {
    'track': 2.02,
    'R': 0.59, 'W': 0.40, 'rim': 0.27,     # 395/85R20
    'half': 1.20,
    'cab_z': (0.18, 2.36), 'cab_top': 3.0,
    'frame': (0.82, 1.14),
}


def fmtv_armoured_cab(v, b):
    """the FMTV cab-over-engine cab with the add-on armour of the HIMARS: flat armoured front with a two-pane
    windscreen in thick frames, grille below, headlights in guards on the bumper, doors with small windows,
    big mirrors, a roof hatch. Returns the door parts."""
    F = FMTV
    zf, zr = F['cab_z']
    hw = F['half'] - 0.02
    top = F['cab_top']
    yb, yw0, yw1 = 1.12, 1.98, 2.76
    # lower cab body (over the engine) and the upper cab with a slightly raked windscreen
    b.box('paint', -hw, hw, yb, yw0, zf, zr, bev=0.03)
    r0 = [(x, yw0, z) for (x, z) in _plan(zf, zr, hw, 0.06)]
    r1 = [(x, yw1, z) for (x, z) in _plan(zf + 0.14, zr, hw, 0.06)]
    r2 = [(x, top, z) for (x, z) in _plan(zf + 0.3, zr - 0.02, hw - 0.04, 0.08)]
    b.loft('paint', [r0, r1, r2], smooth=False)
    b.face(r2, 'paint', want=(0, 1, 0))
    A0, A1, B0, B1 = Vector(r0[0]), Vector(r0[1]), Vector(r1[0]), Vector(r1[1])
    n = (A1 - A0).cross(B0 - A0).normalized()
    if n.z > 0:
        n = -n

    def on(u, w):
        return lerp(lerp(A0, A1, u), lerp(B0, B1, u), w)
    # armoured windscreen: two thick-framed panes and a centre post
    for (u0, u1) in ((0.06, 0.47), (0.53, 0.94)):
        b.panel('glass', [on(u0, 0.12), on(u1, 0.12), on(u1, 0.9), on(u0, 0.9)], n, off=0.03, frame=0.07, frame_skin='dark')
        # the armour frame's proud border
        q = [on(u0 - 0.03, 0.05), on(u1 + 0.03, 0.05), on(u1 + 0.03, 0.97), on(u0 - 0.03, 0.97)]
        b.panel('paint', q, n, off=0.02)
    for u in (0.27, 0.73):
        b.beam('black', on(u, 0.14) + n * 0.045, on(u - 0.07, 0.72) + n * 0.045, 0.014, 0.008)
    # grille (FMTV slots) and armour bolts on the front, bumper with headlight guards and tow hooks
    b.panel('vents', [(-0.72, 1.3, zf), (0.72, 1.3, zf), (0.72, 1.86, zf), (-0.72, 1.86, zf)], (0, 0, -1), off=0.006, frame=0.04, frame_skin='dark')
    for x in (-1.05, 1.05):
        for y in (1.25, 1.85):
            b.cyl('dark', (x, y, zf - 0.02), (x, y, zf), 0.022, 0.022, 6)
    b.box('paint', -hw, hw, 0.72, 1.08, 0.0, zf + 0.12, bev=0.03)
    for sx in (-1, 1):
        cx = sx * (hw - 0.22)
        b.box('dark', cx - 0.17, cx + 0.17, 1.08, 1.4, 0.02, 0.2)
        vkit.headlight(b, (cx, 1.24, 0.02), (0, 0, -1), r=0.085, depth=0.05, skin_body='dark', lens='lens', guard=True)
        vkit.lamp_box(b, (cx + sx * 0.3, 0.9, -0.01), (0.1, 0.07, 0.04), (0, 0, -1), lens='lens_amber')
        b.tube('dark', [(sx * 0.62, 0.95, -0.0), (sx * 0.62, 0.86, -0.06), (sx * 0.62, 0.8, -0.1), (sx * 0.62, 0.84, -0.14)], 0.024, 6)
        vkit.lamp_box(b, (sx * (hw - 0.3), top + 0.03, zf + 0.34), (0.1, 0.06, 0.06), (0, 0, -1), lens='lens_amber')
    stencil_box(b, (-0.5, 0.9, -0.005), 0.3, 0.07, (0, 0, -1))
    stencil_box(b, (0.5, 0.9, -0.005), 0.3, 0.07, (0, 0, -1))
    # doors: armoured, small windows, handles; the steps behind the front wheel
    parts = {}
    for sx, key in ((-1, 'l'), (1, 'r')):
        x = sx * hw
        dz0, dz1, dy0, dy1 = 0.52, 1.52, 1.3, 2.9
        d = Part(v, 'door_' + key, pivot=(x, dy0, dz0), joint=rot([0, sx, 0], 0.0, 1.15, stow=0.0, deploy=1.15, group='door'))
        xo_ = x + sx * 0.015
        xi = xo_ - sx * 0.07
        d.box('paint', min(xo_, xi), max(xo_, xi), dy0, dy1, dz0, dz1, bev=0.012)
        d.panel('glass', [(xo_, 2.2, dz0 + 0.18), (xo_, 2.2, dz1 - 0.3), (xo_, 2.7, dz1 - 0.3), (xo_, 2.7, dz0 + 0.18)], (sx, 0, 0), off=0.008, frame=0.05, frame_skin='dark')
        d.panel('glass', [(xi, 2.2, dz0 + 0.18), (xi, 2.2, dz1 - 0.3), (xi, 2.7, dz1 - 0.3), (xi, 2.7, dz0 + 0.18)], (-sx, 0, 0), off=0.006)
        vkit.grab_handle(d, (xo_ + sx * 0.012, 1.95, dz1 - 0.14), (0, 1, 0), (sx, 0, 0), 0.2, 0.04, 'dark')
        for y in (1.55, 2.6):
            d.cyl('dark', (xo_ + sx * 0.02, y - 0.08, dz0 + 0.04), (xo_ + sx * 0.02, y + 0.08, dz0 + 0.04), 0.03, 0.03, 6)
        parts['door_' + key] = d
        b.panel('interior', [(x, dy0 + 0.02, dz0 + 0.02), (x, dy0 + 0.02, dz1 - 0.02), (x, dy1 - 0.02, dz1 - 0.02), (x, dy1 - 0.02, dz0 + 0.02)], (sx, 0, 0), off=0.002)
        # rear side window behind the door
        b.panel('glass', [(x, 2.25, 1.72), (x, 2.25, 2.15), (x, 2.7, 2.15), (x, 2.7, 1.72)], (sx, 0, 0), off=0.008, frame=0.05, frame_skin='dark')
        for k, y in enumerate((0.55, 0.85, 1.12)):
            b.box('dark', min(x, x - sx * 0.34), max(x, x - sx * 0.34), y - 0.03, y, 1.98, 2.3)
        vkit.grab_handle(b, (x + sx * 0.01, 1.95, 1.65), (0, 1, 0), (sx, 0, 0), 0.7, 0.05, 'dark')
        # big mirrors on arms from the front corners
        base = Vector((x, 2.5, zf + 0.25))
        head = Vector((x + sx * 0.22, 2.35, zf + 0.05))
        b.tube('dark', [base, base + Vector((sx * 0.14, 0.05, -0.08)), head], 0.02, 5)
        b.box('dark', head.x - 0.11, head.x + 0.11, head.y - 0.42, head.y + 0.05, head.z - 0.02, head.z + 0.05)
        b.panel('glass', [(head.x - 0.09, head.y - 0.4, head.z + 0.05), (head.x + 0.09, head.y - 0.4, head.z + 0.05), (head.x + 0.09, head.y + 0.03, head.z + 0.05), (head.x - 0.09, head.y + 0.03, head.z + 0.05)], (0, 0, 1), off=0.003)
    # roof: escape hatch, antenna bases; rear wall window
    b.box('paint', -0.4, 0.4, top, top + 0.06, 1.1, 1.8, bev=0.02)
    b.cyl('dark', (0.0, top + 0.06, 1.45), (0.0, top + 0.1, 1.45), 0.25, 0.25, 14)
    for sx in (-1, 1):
        vkit.whip_antenna(b, (sx * 0.95, top, zr - 0.2), h=2.2)
    b.panel('glass', [(-0.45, 2.2, zr), (0.45, 2.2, zr), (0.45, 2.65, zr), (-0.45, 2.65, zr)], (0, 0, 1), off=0.006, frame=0.04, frame_skin='dark')
    b.empty('seat_driver', (-0.55, 2.0, 1.2), (0, 0, -1))
    b.empty('hatch_entry', (-1.6, 0.0, 1.0), (1, 0, 0))
    return parts


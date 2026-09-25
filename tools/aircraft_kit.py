# ═══════════════════════════════════════════════════════════════
# SKYWAR parametric aircraft kit for Blender (headless).
#
# Per-aircraft spec scripts live in tools/aircraft/<id>.py and are run as
#   /opt/homebrew/bin/blender -b -P tools/aircraft/<id>.py -- models/aircraft/<id>.glb [--render DIR]
#
# Coordinates used by every spec (metres):
#   s = station, metres AFT of the nose tip (0 = nose, grows toward the tail)
#   x = lateral, + = right wing          z = up
# Blender gets Y = -s, so the nose points to +Y; the glTF exporter (+Y up) turns that into
# three.js "nose toward -Z, up +Y", i.e. MODEL_FILES rot [0, 0, 0].
#
# Parts: loft() fuselages/booms/nacelles from superellipse cross-sections (PCHIP-smoothed along s),
# surface() wings/tails/canards/fins from planform sections (NACA-style thickness, any dihedral/cant),
# duct() hollow intakes with dark throats, nozzle() round (optionally petalled) exhausts, box_nozzle()
# 2-D nozzles, canopy() glass bubble + cockpit tub/seat/helmet, turbofan(), propeller(), probe(),
# missile(), plus panel-line texture (box-projected UVs) and correct materials:
#   Paint* (panel texture × colour, recoloured by liveries), Dark (radomes/intakes, luminance < 0.06 so
#   liveries keep it), Nozzle (burnt metal, dark), Canopy_Glass (alpha-blended, so liveries skip it).
# finish() prints the MODEL_FILES entry (nozzles / nozzleR / cockpit as fractions of length).
# ═══════════════════════════════════════════════════════════════
import bpy, bmesh, math, sys, os, json, random
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGS[0] if ARGS and not ARGS[0].startswith('--') else None
RENDER_DIR = ARGS[ARGS.index('--render') + 1] if '--render' in ARGS else None

STATE = {'name': 'aircraft', 'L': 15.0, 'mats': {}, 'nozzles': [], 'cockpit': None, 'nozzleR': None, 'objects': []}

# ───────────────────────── materials ─────────────────────────
def srgb(h):
    if isinstance(h, str):
        h = int(h.lstrip('#'), 16)
    c = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)

_PANEL_IMG = {}
def panel_image(key='panel', size=1024, seed=7, line=0.80, contrast=1.0, grime=0.035):
    """Tileable panel-line + subtle weathering texture (greyscale, ~white) — multiplied by paint colour."""
    if key in _PANEL_IMG:
        return _PANEL_IMG[key]
    import numpy as np
    rng = np.random.default_rng(seed)
    N = size
    img = np.ones((N, N), np.float32)
    yy, xx = np.mgrid[0:N, 0:N] / N
    # low-frequency blotches (tileable: integer frequencies)
    for _ in range(14):
        fx, fy = rng.integers(1, 6, 2)
        ph = rng.random() * 6.283
        img += grime * rng.uniform(-1, 1) * np.sin(6.283 * (fx * xx + fy * yy) + ph) / 3
    # panels: rows of random height, each split into columns of random width (wrapping)
    y = 0
    while y < N:
        h = int(rng.integers(70, 190))
        y1 = min(N, y + h)
        x = int(rng.integers(0, N))
        x_end = x + N
        while x < x_end:
            w = int(rng.integers(90, 300))
            xs = np.arange(x, min(x + w, x_end)) % N
            shade = 1.0 + rng.uniform(-0.035, 0.035) * contrast
            img[y:y1, xs] *= shade
            img[y:y1, x % N] *= line                     # vertical seam
            img[y:y1, (x + 1) % N] *= 0.5 + 0.5 * line
            if rng.random() < 0.35:                      # rivet line along this panel edge
                img[y:y1:7, (x + 5) % N] *= 0.9
            x += w
        img[y % N, :] *= line                            # horizontal seam
        img[(y + 1) % N, :] *= 0.5 + 0.5 * line
        if rng.random() < 0.4:
            img[(y + 5) % N, ::7] *= 0.9
        y = y1
    # a few access hatches
    for _ in range(26):
        cx, cy = rng.integers(0, N, 2)
        w, h = rng.integers(14, 60, 2)
        xs = np.arange(cx, cx + w) % N
        ys = np.arange(cy, cy + h) % N
        img[np.ix_(ys[[0, -1]], xs)] *= 0.86
        img[np.ix_(ys, xs[[0, -1]])] *= 0.86
    img = np.clip(img / np.percentile(img, 97) * 0.97, 0, 1)
    rgba = np.stack([img, img, img, np.ones_like(img)], -1)
    im = bpy.data.images.new(key, N, N, alpha=False)
    im.pixels.foreach_set(rgba.ravel())
    im.pack()
    im.file_format = 'JPEG'
    _PANEL_IMG[key] = im
    return im

def material(name, color, metal=0.2, rough=0.55, alpha=1.0, panel=None, emissive=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    col = srgb(color) if not isinstance(color, tuple) else color
    b.inputs['Base Color'].default_value = (*col, 1)
    m.diffuse_color = (*col, alpha)          # workbench preview colour
    STATE.setdefault('factors', {})[name] = (list(col) + [alpha]) if panel else None
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if panel:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = panel_image(**panel) if isinstance(panel, dict) else panel_image()
        # texture straight into Base Color (what the glTF exporter understands); the paint colour is
        # written back as baseColorFactor by _patch_glb after export
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            m.blend_method = 'BLEND'
    if emissive:
        b.inputs['Emission Color'].default_value = (*srgb(emissive), 1)
        b.inputs['Emission Strength'].default_value = 1.0
    STATE['mats'][name] = m
    return m

def begin(name, length, paint='#8a939b', paint2=None, radome=None, glass='#2c3a48', glass_alpha=0.5,
          dark='#1c1e21', nozzle='#433f3b', panel=True, gold=False):
    """Reset the scene and create the standard material set."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    STATE.update(name=name, L=length, mats={}, nozzles=[], cockpit=None, nozzleR=None, objects=[], sections={}, factors={})
    _PANEL_IMG.clear()
    pn = {'key': 'panel'} if panel is True else panel if panel else None
    material('Paint', paint, 0.12, 0.55, panel=pn)
    material('Paint2', paint2 or paint, 0.12, 0.55, panel=pn)
    material('Radome', radome or paint, 0.1, 0.55, panel=None)
    material('Dark', dark, 0.3, 0.6)
    material('Intake', '#060708', 0.0, 0.9)
    material('Nozzle', nozzle, 0.6, 0.65)
    material('NozzleInner', '#2a1f18', 0.5, 0.6)
    if gold:
        material('Canopy_Glass', '#9a7a36', 0.9, 0.08, alpha=0.62)
    else:
        material('Canopy_Glass', glass, 0.1, 0.05, alpha=glass_alpha)
    material('Frame', paint, 0.12, 0.55, panel=pn)
    material('Seat', '#26282b', 0.1, 0.8)
    material('Helmet', '#b8b8aa', 0.1, 0.5)
    material('Missile', '#d9d9d2', 0.1, 0.5)
    material('Lamp', '#ffffff', 0.0, 0.3)

def mat(name):
    return STATE['mats'][name]

def new_material(name, color, **kw):
    return material(name, color, **kw)

def Y(s):
    return -s

# ───────────────────────── mesh helpers ─────────────────────────
def _obj(name, bm, materials):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    for m in materials:
        me.materials.append(mat(m) if isinstance(m, str) else m)
    STATE['objects'].append(ob)
    return ob

def pchip(xs, ys):
    """Monotone cubic interpolant through (xs, ys) → callable."""
    n = len(xs)
    if n == 1:
        return lambda x: ys[0]
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] if h[i] else 0 for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = max(0, min(n - 2, next(k for k in range(n - 1) if xs[k + 1] >= x)))
        t = (x - xs[i]) / h[i] if h[i] else 0
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])
    return f

def linear(xs, ys):
    def f(x):
        if x <= xs[0]: return ys[0]
        if x >= xs[-1]: return ys[-1]
        i = next(k for k in range(len(xs) - 1) if xs[k + 1] >= x)
        t = (x - xs[i]) / (xs[i + 1] - xs[i]) if xs[i + 1] != xs[i] else 0
        return ys[i] + (ys[i + 1] - ys[i]) * t
    return f

# Cross-section: dict(s, w, ht, hb, z=0, x=0, nt=2, nb=2, crown=0, keel=0, tw=0)
#   w = half-width, ht/hb = height above/below the widest line at z, nt/nb = superellipse exponents
#   (<2 → pointed/chined, 2 → ellipse, >2 → boxy); crown squeezes the top toward the centre (0..1)
#   tw = extra flat top half-width (adds a flat deck, e.g. airliner floors / Flanker centre-section)
SEC_KEYS = ('w', 'ht', 'hb', 'z', 'x', 'nt', 'nb', 'crown', 'tw', 'bw')
def S(s, w, ht, hb=None, z=0.0, nt=2.0, nb=None, x=0.0, crown=0.0, tw=0.0, bw=0.0):
    return dict(s=s, w=w, ht=ht, hb=ht if hb is None else hb, z=z, x=x, nt=nt, nb=nt if nb is None else nb,
                crown=crown, tw=tw, bw=bw)

def section_points(p, ring):
    pts = []
    for i in range(ring):
        a = 2 * math.pi * i / ring
        c, sn = math.cos(a), math.sin(a)
        up = sn >= 0
        n = p['nt'] if up else p['nb']
        n = max(n, 0.3)
        xx = p['w'] * math.copysign(abs(c) ** (2 / n), c)
        zz = (p['ht'] if up else p['hb']) * math.copysign(abs(sn) ** (2 / n), sn)
        if up and p['crown']:
            zz *= 1 - p['crown'] * (xx / max(p['w'], 1e-6)) ** 2
        flat = p['tw'] if up else p['bw']
        if flat:
            xx += math.copysign(flat, c) * (abs(sn) ** 0.5 if abs(c) > 1e-6 else 0)
        pts.append((p['x'] + xx, p['z'] + zz))
    return pts

def spacing(s0, s1, max_step, dense_front=True):
    n = max(2, int(math.ceil((s1 - s0) / max_step)) + 1)
    out = []
    for i in range(n):
        u = i / (n - 1)
        if dense_front:
            u = 1 - math.cos(u * math.pi / 2) if False else u
        out.append(s0 + (s1 - s0) * u)
    return out

def loft(name, stations, material='Paint', ring=40, step=None, cap_front=True, cap_back=True,
         mirror=False, mat_ranges=(), smooth_interp=True, extra_s=(), register=None, nose_dense=True):
    """Loft a body through cross-sections S(...). mat_ranges: [(s0, s1, 'Material')] per-face material override.
    mirror=True builds a copy at -x as well (for off-centre nacelles/ducts). Returns object(s)."""
    L = STATE['L']
    stations = sorted(stations, key=lambda d: d['s'])
    ss = [d['s'] for d in stations]
    interp = {k: (pchip if smooth_interp else linear)(ss, [d[k] for d in stations]) for k in SEC_KEYS}
    step = step or L / 70
    s0, s1 = ss[0], ss[-1]
    samples = set(ss) | set(extra_s)
    # denser rings near the front (nose curvature), regular elsewhere
    n = max(2, int(math.ceil((s1 - s0) / step)))
    for i in range(n + 1):
        u = i / n
        if nose_dense:
            u = u ** 1.35
        samples.add(s0 + (s1 - s0) * u)
    samples = sorted(x for x in samples if s0 <= x <= s1)
    # drop near-duplicates
    uniq = []
    for x in samples:
        if not uniq or x - uniq[-1] > 1e-4:
            uniq.append(x)
    secs = []
    for s in uniq:
        p = {k: interp[k](s) for k in SEC_KEYS}
        secs.append((s, section_points(p, ring)))
    if register:
        STATE['sections'][register] = (interp, s0, s1)
    mats = ['Paint' if material is None else material] + [m for _, _, m in mat_ranges]
    mats = list(dict.fromkeys(mats))
    objs = []
    for side in ([1, -1] if mirror else [1]):
        bm = bmesh.new()
        rings = [[bm.verts.new((side * x, Y(s), z)) for (x, z) in pts] for s, pts in secs]
        faces = []
        for k, (a, b) in enumerate(zip(rings, rings[1:])):
            smid = (secs[k][0] + secs[k + 1][0]) / 2
            mi = 0
            for (r0, r1, mname) in mat_ranges:
                if r0 <= smid <= r1:
                    mi = mats.index(mname)
            for i in range(ring):
                f = bm.faces.new((a[i], a[(i + 1) % ring], b[(i + 1) % ring], b[i]) if side > 0 else
                                 (a[i], b[i], b[(i + 1) % ring], a[(i + 1) % ring]))
                f.material_index = mi
        if cap_front:
            f = bm.faces.new(list(reversed(rings[0])) if side > 0 else rings[0])
            f.material_index = mats.index(mat_ranges[0][2]) if mat_ranges and mat_ranges[0][0] <= secs[0][0] else 0
        if cap_back:
            f = bm.faces.new(rings[-1] if side > 0 else list(reversed(rings[-1])))
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(_obj(f'{name}{"_L" if side < 0 else ""}', bm, mats))
    return objs[0] if len(objs) == 1 else objs

def body_at(register, s):
    """Interpolated fuselage cross-section params at station s (from a loft registered by name)."""
    interp, s0, s1 = STATE['sections'][register]
    s = min(max(s, s0), s1)
    return {k: interp[k](s) for k in SEC_KEYS}

def top_z(register, s, x=0.0):
    p = body_at(register, s)
    if abs(x) >= p['w'] + p['tw']:
        return p['z']
    # solve along the upper superellipse for this x
    best = p['z'] + p['ht']
    for (px, pz) in section_points(p, 160)[:80]:
        if abs(px - p['x'] - x) < (p['w'] + 1e-3) / 40:
            best = pz
            break
    return best

# ───────────────────────── lifting surfaces ─────────────────────────
def _airfoil(K=12, t=0.05):
    """Half-thickness distribution (NACA 4-digit shape) at cosine-spaced u — returns [(u, yt)]."""
    out = []
    for k in range(K + 1):
        u = (1 - math.cos(math.pi * k / K)) / 2
        yt = 5 * t * (0.2969 * math.sqrt(u) - 0.1260 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4)
        out.append((u, yt))
    return out

def surface(name, sections, material='Paint', mirror=True, subdiv=3, K=12, cap_root=True, cap_tip=True,
            blunt_te=0.0, flat=False):
    """Lifting surface through planform sections [(le_s, te_s, x, z, t/c), ...] from root to tip.
    Works for wings (x grows), fins (z grows), canted fins (both). subdiv = extra interpolated sections
    between consecutive given ones (keeps the damage segmentation's wing split clean)."""
    secs = []
    for i in range(len(sections) - 1):
        a, b = sections[i], sections[i + 1]
        for k in range(subdiv + 1):
            u = k / (subdiv + 1)
            secs.append(tuple(a[j] + (b[j] - a[j]) * u for j in range(5)))
    secs.append(tuple(sections[-1]))
    objs = []
    for side in ([1, -1] if mirror else [1]):
        bm = bmesh.new()
        rings = []
        for i, (le, te, x, z, t) in enumerate(secs):
            # span direction in the x-z plane → thickness direction perpendicular to it
            pa = secs[max(0, i - 1)]; pb = secs[min(len(secs) - 1, i + 1)]
            dx, dz = pb[2] - pa[2], pb[3] - pa[3]
            dl = math.hypot(dx, dz) or 1
            nx, nz = -dz / dl, dx / dl
            if nz < 0 or (abs(nz) < 1e-6 and nx < 0):
                nx, nz = -nx, -nz
            chord = te - le
            af = _airfoil(K, t)
            up = [(le + chord * u, yt * chord + blunt_te * u) for u, yt in af]
            ring = up + [(s, -h) for s, h in reversed(up[1:-1])]
            if flat:
                ring = [(s, h * 0.6) for s, h in ring]
            rings.append([bm.verts.new((side * (x + nx * h), Y(s), z + nz * h)) for s, h in ring])
        n = len(rings[0])
        for a, b in zip(rings, rings[1:]):
            for i in range(n):
                q = (a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])
                bm.faces.new(q if side > 0 else tuple(reversed(q)))
        if cap_tip:
            bm.faces.new(rings[-1])
        if cap_root:
            bm.faces.new(list(reversed(rings[0])))
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(_obj(f'{name}{"_L" if side < 0 else "_R" if mirror else ""}', bm, [material]))
    return objs

def fin(name, root, tip, t=0.045, t_tip=None, cant=0.0, x=0.0, z=0.0, mirror=False, material='Paint', subdiv=3,
        mid=None):
    """Vertical tail: root/tip = (le_s, te_s) chord stations, height from (x, z) root point, cant in degrees
    (outward lean from vertical, per side). mid = optional [(le, te, frac_height)] kinks."""
    h = tip[2] if len(tip) > 2 else 1.0
    c = math.radians(cant)
    secs = [(root[0], root[1], x, z, t)]
    for (le, te, fr) in (mid or []):
        secs.append((le, te, x + math.sin(c) * h * fr, z + math.cos(c) * h * fr, t + ((t_tip or t) - t) * fr))
    secs.append((tip[0], tip[1], x + math.sin(c) * h, z + math.cos(c) * h, t_tip or t))
    return surface(name, secs, material, mirror=mirror, subdiv=subdiv)

# ───────────────────────── engines ─────────────────────────
def ring_verts(bm, s, x, z, rx, rz, N, side=1, ang0=0.0, sfun=None):
    out = []
    for i in range(N):
        a = ang0 + 2 * math.pi * i / N
        ss = s + (sfun(i, a) if sfun else 0)
        out.append(bm.verts.new((side * (x + rx * math.cos(a)), Y(ss), z + rz * math.sin(a))))
    return out

def _bridge(bm, a, b, flip=False, mi=0):
    n = len(a)
    for i in range(n):
        q = (a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])
        f = bm.faces.new(tuple(reversed(q)) if flip else q)
        f.material_index = mi

def nozzle(name, s0, s1, x, z, r0, r1, petals=0, petal_len=0.12, mirror=False, depth=0.6, N=32,
           inner_ring=True, register=True, rz_scale=1.0):
    """Round exhaust: outer shell s0→s1 (radius r0→r1), optional serrated petals, dark hollow inside."""
    objs = []
    for side in ([1, -1] if mirror else [1]):
        bm = bmesh.new()
        tooth = (lambda i, a: petal_len if i % 2 == 0 else 0.0) if petals else None
        a = ring_verts(bm, s0, x, z, r0, r0 * rz_scale, N, side)
        mid = ring_verts(bm, s0 + (s1 - s0) * 0.55, x, z, (r0 + r1) / 2 * 1.01, (r0 + r1) / 2 * 1.01 * rz_scale, N, side)
        b = ring_verts(bm, s1, x, z, r1, r1 * rz_scale, N, side, sfun=tooth)
        bi = ring_verts(bm, s1 - 0.02, x, z, r1 * 0.9, r1 * 0.9 * rz_scale, N, side, sfun=tooth)
        ci = ring_verts(bm, s1 - depth, x, z, r1 * 0.82, r1 * 0.82 * rz_scale, N, side)
        _bridge(bm, a, mid, side < 0, 0)
        _bridge(bm, mid, b, side < 0, 0)
        _bridge(bm, b, bi, side < 0, 0)
        _bridge(bm, bi, ci, side < 0, 1)
        f = bm.faces.new(ci if side > 0 else list(reversed(ci)))
        f.material_index = 2
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(_obj(f'{name}{"_L" if side < 0 else ""}', bm, ['Nozzle', 'NozzleInner', 'Intake']))
        if inner_ring:
            # flame-holder ring inside
            bm2 = bmesh.new()
            r = r1 * 0.55
            o = ring_verts(bm2, s1 - depth + 0.05, x, z, r, r * rz_scale, 20, side)
            ii = ring_verts(bm2, s1 - depth + 0.05, x, z, r * 0.8, r * 0.8 * rz_scale, 20, side)
            _bridge(bm2, o, ii, side > 0)
            objs.append(_obj(f'{name}Ring{"_L" if side < 0 else ""}', bm2, ['Nozzle']))
        if register:
            STATE['nozzles'].append((side * x, z, s1))
            STATE['nozzleR'] = r1
    return objs

def box_nozzle(name, s0, s1, x, z, w0, h0, w1, h1, mirror=False, depth=0.7, n=5.0, register=True, tilt_te=0.0):
    """2-D (rectangular) exhaust like the F-22's: superellipse loft with a dark recessed throat."""
    objs = []
    for side in ([1, -1] if mirror else [1]):
        bm = bmesh.new()
        N = 32
        def rr(s, w, h, dz=0.0, sgn=1.0):
            pts = section_points(dict(w=w, ht=h, hb=h, z=z + dz, x=x, nt=n, nb=n, crown=0, tw=0, bw=0), N)
            return [bm.verts.new((side * px, Y(s + (tilt_te * (pz - z) if sgn else 0)), pz)) for px, pz in pts]
        a = rr(s0, w0, h0)
        b = rr(s1, w1, h1)
        bi = rr(s1 - 0.03, w1 * 0.88, h1 * 0.8)
        ci = rr(s1 - depth, w1 * 0.8, h1 * 0.7)
        _bridge(bm, a, b, side < 0, 0)
        _bridge(bm, b, bi, side < 0, 0)
        _bridge(bm, bi, ci, side < 0, 1)
        f = bm.faces.new(ci if side > 0 else list(reversed(ci)))
        f.material_index = 2
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(_obj(f'{name}{"_L" if side < 0 else ""}', bm, ['Nozzle', 'NozzleInner', 'Intake']))
        if register:
            STATE['nozzles'].append((side * x, z, s1))
            STATE['nozzleR'] = min(w1, h1)
    return objs

def duct(name, stations, rake=(0.0, 0.0), lip=0.08, throat=1.2, material='Paint', mirror=True, ring=32,
         cap_back=False, inner_scale=0.84):
    """Hollow intake: outer loft through S(...) sections (use x/z to position it), open mouth at the first
    station (raked: s += rake[0]*(x-x0) + rake[1]*(z-z0)), dark throat going `throat` metres inside."""
    stations = sorted(stations, key=lambda d: d['s'])
    ss = [d['s'] for d in stations]
    interp = {k: pchip(ss, [d[k] for d in stations]) for k in SEC_KEYS}
    L = STATE['L']
    n = max(3, int((ss[-1] - ss[0]) / (L / 60)) + 1)
    samples = sorted(set(ss) | {ss[0] + (ss[-1] - ss[0]) * i / n for i in range(n + 1)})
    p0 = {k: interp[k](ss[0]) for k in SEC_KEYS}
    def rk(px, pz, fade):
        # rake[0]: metres aft per metre outboard (+ = outer lip further aft); rake[1]: per metre up
        return (rake[0] * (px - p0['x']) + rake[1] * (pz - p0['z'])) * fade
    objs = []
    for side in ([1, -1] if mirror else [1]):
        bm = bmesh.new()
        rings = []
        for s in samples:
            p = {k: interp[k](s) for k in SEC_KEYS}
            fade = max(0.0, 1 - (s - ss[0]) / max(0.8, (ss[-1] - ss[0]) * 0.25))
            rings.append([bm.verts.new((side * px, Y(s + rk(px, pz, fade)), pz)) for px, pz in section_points(p, ring)])
        for a, b in zip(rings, rings[1:]):
            _bridge(bm, a, b, side < 0, 0)
        # lip → throat (dark)
        pin = dict(p0)
        pin['w'] *= inner_scale; pin['ht'] *= inner_scale; pin['hb'] *= inner_scale
        lip_r = [bm.verts.new((side * px, Y(ss[0] + lip + rk(px, pz, 1)), pz)) for px, pz in section_points(pin, ring)]
        deep = [bm.verts.new((side * px, Y(ss[0] + throat + rk(px, pz, 1) * 0.5), pz)) for px, pz in section_points(dict(pin, w=pin['w'] * 0.95, ht=pin['ht'] * 0.95, hb=pin['hb'] * 0.95), ring)]
        _bridge(bm, rings[0], lip_r, side > 0, 0)
        _bridge(bm, lip_r, deep, side > 0, 1)
        f = bm.faces.new(deep if side > 0 else list(reversed(deep)))
        f.material_index = 1
        if cap_back:
            bm.faces.new(rings[-1] if side > 0 else list(reversed(rings[-1])))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(_obj(f'{name}{"_L" if side < 0 else "_R" if mirror else ""}', bm, [material, 'Intake']))
    return objs

def turbofan(name, s0, length, x, z, r, mirror=True, fan_depth=0.35, core=True, material='Paint', lip_mat='Nozzle',
             r_exit=None, core_len=None, pylon=None):
    """Airliner nacelle: rounded lip, dark fan face with spinner, tapering cowl and exposed core with a cone."""
    objs = []
    r_exit = r_exit or r * 0.82
    for side in ([1, -1] if mirror else [1]):
        bm = bmesh.new()
        N = 36
        lip_in = ring_verts(bm, s0 + 0.06, x, z, r * 0.86, r * 0.86, N, side)
        lip = ring_verts(bm, s0, x, z, r * 0.93, r * 0.93, N, side)
        c1 = ring_verts(bm, s0 + length * 0.12, x, z, r, r, N, side)
        c2 = ring_verts(bm, s0 + length * 0.55, x, z, r * 0.98, r * 0.98, N, side)
        c3 = ring_verts(bm, s0 + length, x, z, r_exit, r_exit, N, side)
        c3i = ring_verts(bm, s0 + length - 0.05, x, z, r_exit * 0.92, r_exit * 0.92, N, side)
        _bridge(bm, lip_in, lip, side < 0, 1)
        _bridge(bm, lip, c1, side < 0, 0)
        _bridge(bm, c1, c2, side < 0, 0)
        _bridge(bm, c2, c3, side < 0, 0)
        _bridge(bm, c3, c3i, side < 0, 2)
        fan = ring_verts(bm, s0 + fan_depth, x, z, r * 0.84, r * 0.84, N, side)
        _bridge(bm, fan, lip_in, side < 0, 2)
        f = bm.faces.new(fan if side < 0 else list(reversed(fan)))
        f.material_index = 2
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(_obj(f'{name}{"_L" if side < 0 else "_R" if mirror else ""}', bm, [material, lip_mat, 'Intake']))
        # spinner
        sp = [(0.0, 0.0), (0.12, r * 0.18), (0.3, r * 0.26)]
        loft_objs = loft(f'{name}Spinner{"_L" if side < 0 else ""}', [S(s0 + fan_depth - 0.3 + a, b + 0.005, b + 0.005, x=side * x, z=z) for a, b in sp],
                         material='Dark', ring=16, cap_front=False)
        objs.append(loft_objs)
        if core:
            cl = core_len or length * 0.35
            cs = s0 + length
            objs.append(loft(f'{name}Core{"_L" if side < 0 else ""}', [S(cs - 0.1, r_exit * 0.9, r_exit * 0.9, x=side * x, z=z),
                        S(cs + cl * 0.6, r_exit * 0.62, r_exit * 0.62, x=side * x, z=z), S(cs + cl, r_exit * 0.45, r_exit * 0.45, x=side * x, z=z)],
                        material='Nozzle', ring=24, cap_front=False))
            objs.append(loft(f'{name}Cone{"_L" if side < 0 else ""}', [S(cs + cl - 0.05, r_exit * 0.4, r_exit * 0.4, x=side * x, z=z),
                        S(cs + cl + r_exit * 0.8, 0.02, 0.02, x=side * x, z=z)], material='Nozzle', ring=16, cap_back=False, cap_front=False))
        STATE['nozzles'].append((side * x, z, s0 + length + (core_len or length * 0.35)))
        STATE['nozzleR'] = r_exit * 0.6
    return objs

def propeller(name, s, x, z, r, blades=4, chord=0.22, spinner=0.3, spinner_len=0.7, mirror=False, pitch=25,
              material='Dark', scimitar=0.0, disc=False):
    """Static propeller: spinner + twisted blades in the plane at station s (blades point radially)."""
    objs = []
    for side in ([1, -1] if mirror else [1]):
        objs.append(loft(f'{name}Spinner{"_L" if side < 0 else ""}', [S(s - spinner_len, 0.02, 0.02, x=side * x, z=z),
                    S(s - spinner_len * 0.6, spinner * 0.75, spinner * 0.75, x=side * x, z=z),
                    S(s, spinner, spinner, x=side * x, z=z), S(s + 0.15, spinner, spinner, x=side * x, z=z)],
                    material=material, ring=20, smooth_interp=True))
        bm = bmesh.new()
        for k in range(blades):
            a0 = 2 * math.pi * k / blades + (0.3 if side < 0 else 0)
            prev = None
            M = 8
            for j in range(M + 1):
                u = j / M
                rr = spinner * 0.6 + (r - spinner * 0.6) * u
                c = chord * (0.75 + 0.6 * math.sin(math.pi * min(1, u * 1.1)) * (1 - u * 0.5))
                tw = math.radians(pitch + 35 * (1 - u))
                sweep = scimitar * u * u * c
                a = a0 + sweep / max(rr, 0.1)
                ca, sa = math.cos(a), math.sin(a)
                # blade chord lies in the plane of rotation, rotated by the twist
                cx, cy = -sa, ca
                pts = []
                for (dc, dt) in ((-0.5, 0.0), (0.0, 0.05), (0.5, 0.0), (0.0, -0.05)):
                    lc = dc * c
                    th = dt * c
                    px = x + rr * ca + cx * lc * math.cos(tw)
                    pz = z + rr * sa + cy * lc * math.cos(tw)
                    ps = s + 0.05 + lc * math.sin(tw) + th
                    pts.append(bm.verts.new((side * px, Y(ps), pz)))
                if prev:
                    for i in range(4):
                        bm.faces.new((prev[i], prev[(i + 1) % 4], pts[(i + 1) % 4], pts[i]))
                else:
                    bm.faces.new(list(reversed(pts)))
                prev = pts
            bm.faces.new(prev)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(_obj(f'{name}Blades{"_L" if side < 0 else ""}', bm, [material]))
    return objs

# ───────────────────────── cockpit ─────────────────────────
def canopy(stations, register='Fuselage', frames=(), seat=None, material='Canopy_Glass', ring=24, name='Canopy',
           tub=True, frame_w=0.05, sink=0.06, pilots=None):
    """Glass bubble over the fuselage: stations [(s, half_width, height)] — base sits on the fuselage top
    (sink metres below it). frames = stations of canopy bows (frame arches). seat = (s_seat, x) or list for
    tandem cockpits: a seat back + helmet under the glass."""
    L = STATE['L']
    ss = [a for a, _, _ in stations]
    fw = pchip(ss, [b for _, b, _ in stations])
    fh = pchip(ss, [c for _, _, c in stations])
    n = 28
    samples = [ss[0] + (ss[-1] - ss[0]) * (i / n) for i in range(n + 1)]
    def base_z(s):
        p = body_at(register, s)
        return p['z'] + p['ht'] * (1 - p['crown'] * 0.0) - sink
    bm = bmesh.new()
    rings = []
    half = ring // 2
    for s in samples:
        w, h = max(fw(s), 0.01), max(fh(s), 0.01)
        zb = base_z(s)
        pts = []
        for i in range(half + 1):
            a = math.pi * i / half
            pts.append(bm.verts.new((w * math.cos(a), Y(s), zb + h * math.sin(a) ** 0.85)))
        rings.append(pts)
    for a, b in zip(rings, rings[1:]):
        for i in range(half):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    objs = [_obj(name, bm, [material])]
    # frame arches
    for fs in frames:
        w, h = fw(fs) * 1.03, fh(fs) * 1.03
        zb = base_z(fs)
        bm = bmesh.new()
        r0, r1 = [], []
        for i in range(half + 1):
            a = math.pi * i / half
            k = math.sin(a) ** 0.85
            r0.append(bm.verts.new((w * math.cos(a), Y(fs - frame_w), zb + h * k)))
            r1.append(bm.verts.new((w * math.cos(a), Y(fs + frame_w), zb + h * k)))
        ri0 = [bm.verts.new((v.co.x * 0.93, v.co.y, zb + (v.co.z - zb) * 0.93)) for v in r0]
        ri1 = [bm.verts.new((v.co.x * 0.93, v.co.y, zb + (v.co.z - zb) * 0.93)) for v in r1]
        for i in range(half):
            bm.faces.new((r0[i], r0[i + 1], r1[i + 1], r1[i]))
            bm.faces.new((ri0[i + 1], ri0[i], ri1[i], ri1[i + 1]))
            bm.faces.new((r0[i + 1], r0[i], ri0[i], ri0[i + 1]))
            bm.faces.new((r1[i], r1[i + 1], ri1[i + 1], ri1[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(_obj(f'{name}Frame', bm, ['Frame']))
    # cockpit tub (dark) so the glass doesn't show bare paint, plus seat + helmet
    if tub:
        s_a, s_b = ss[0] + (ss[-1] - ss[0]) * 0.12, ss[-1] - (ss[-1] - ss[0]) * 0.12
        pts = []
        for s in [s_a + (s_b - s_a) * i / 10 for i in range(11)]:
            pts.append(S(s, fw(s) * 0.86, 0.03, 0.03, z=base_z(s) + 0.01, nt=3))
        objs.append(loft(f'{name}Tub', pts, material='Seat', ring=16))
    seats = seat if isinstance(seat, list) else ([seat] if seat else [])
    for (s_seat, sx) in seats:
        zb = base_z(s_seat)
        h = fh(s_seat)
        # seat back
        objs.append(loft('Seat', [S(s_seat - 0.08, 0.2, 0.02, z=zb + h * 0.3, x=sx), S(s_seat, 0.24, h * 0.28, 0.02, z=zb + h * 0.3, x=sx, nt=4),
                                  S(s_seat + 0.12, 0.24, h * 0.3, 0.02, z=zb + h * 0.3, x=sx, nt=4)], material='Seat', ring=16, smooth_interp=False))
        # helmet
        hz = zb + h * 0.62
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=8, radius=1.0)
        for v in bm.verts:
            v.co = Vector((sx + v.co.x * 0.14, Y(s_seat - 0.2) + v.co.y * 0.16, hz + v.co.z * 0.15))
        objs.append(_obj('Helmet', bm, ['Helmet']))
    if seats:
        s_eye, sx = seats[0]
        STATE['cockpit'] = (base_z(s_eye) + fh(s_eye) * 0.62, s_eye - 0.25)
    return objs

# ───────────────────────── small parts ─────────────────────────
def probe(name, s0, s1, z, r0, r1=0.01, x=0.0, material='Dark'):
    return loft(name, [S(s0, r1, r1, z=z, x=x), S(s1, r0, r0, z=z, x=x)], material=material, ring=10, smooth_interp=False)

def ellipsoid(name, s, x, z, rs, rx, rz, material='Paint', mirror=False, seg=16):
    objs = []
    for side in ([1, -1] if mirror else [1]):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=1.0)
        for v in bm.verts:
            v.co = Vector((side * x + v.co.x * rx, Y(s) + v.co.y * rs, z + v.co.z * rz))
        objs.append(_obj(f'{name}{"_L" if side < 0 else ""}', bm, [material]))
    return objs

def box(name, s0, s1, x0, x1, z0, z1, material='Paint', mirror=False):
    objs = []
    for side in ([1, -1] if mirror else [1]):
        bm = bmesh.new()
        vs = [bm.verts.new((side * x, Y(s), z)) for s in (s0, s1) for x in (x0, x1) for z in (z0, z1)]
        for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            bm.faces.new([vs[i] for i in q])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        objs.append(_obj(f'{name}{"_L" if side < 0 else ""}', bm, [material]))
    return objs

def missile(name, s0, length, x, z, r, fins=True, mirror=True, material='Missile', rail=True):
    """AIM-9 style missile (nose at s0) with cruciform fins and a launch rail above/beside it."""
    objs = []
    for side in ([1, -1] if mirror else [1]):
        sx = side * x
        objs.append(loft(f'{name}Body{"_L" if side < 0 else ""}', [S(s0, 0.015, 0.015, x=sx, z=z), S(s0 + r * 3.5, r * 0.95, r * 0.95, x=sx, z=z),
                    S(s0 + length * 0.97, r, r, x=sx, z=z), S(s0 + length, r * 0.8, r * 0.8, x=sx, z=z)], material=material, ring=12))
        if fins:
            for k in range(4):
                a = math.pi / 4 + k * math.pi / 2
                ca, sa = math.cos(a), math.sin(a)
                for (fs0, fs1, span) in ((s0 + length * 0.12, s0 + length * 0.2, r * 2.2), (s0 + length * 0.86, s0 + length, r * 2.6)):
                    bm = bmesh.new()
                    v = [bm.verts.new((sx + ca * r * 0.9, Y(fs0), z + sa * r * 0.9)), bm.verts.new((sx + ca * r * 0.9, Y(fs1), z + sa * r * 0.9)),
                         bm.verts.new((sx + ca * span, Y(fs1), z + sa * span)), bm.verts.new((sx + ca * span, Y(fs0 + (fs1 - fs0) * 0.6), z + sa * span))]
                    bm.faces.new(v)
                    objs.append(_obj(f'{name}Fin', bm, [material]))
    return objs

def lamp(name, s, x, z, r=0.06, material='Lamp', mirror=False):
    return ellipsoid(name, s, x, z, r, r, r, material, mirror, seg=8)

# ───────────────────────── finishing ─────────────────────────
def _box_uv(ob, scale=8.0, layer=None):
    me = ob.data
    if layer and layer not in me.uv_layers:
        me.uv_layers.new(name=layer)
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.get(layer) if layer else bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = ob.matrix_world @ l.vert.co
            if ax == 2:
                l[uv].uv = (co.x / scale, co.y / scale)
            elif ax == 0:
                l[uv].uv = (co.y / scale, co.z / scale)
            else:
                l[uv].uv = (co.x / scale, co.z / scale)
    bm.to_mesh(me)
    bm.free()

def _shade(ob, angle=35):
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0) > math.radians(angle):
            e.smooth = False
    bm.to_mesh(me)
    bm.free()

def bbox():
    xs, ys, zs = [], [], []
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))

def finish(out=None, shade_angle=34, uv_scale=8.0, join=True, extra_entry=None):
    """Shade, UV, join per material group, export GLB, print the MODEL_FILES entry. Returns entry dict."""
    out = out or OUT
    name = STATE['name']
    for ob in list(bpy.data.objects):
        if ob.type == 'MESH':
            _shade(ob, shade_angle)
            _box_uv(ob, uv_scale)
    if join:
        # join everything into one mesh per top-level part family (keeps names readable, few draw calls)
        meshes = [o for o in bpy.data.objects if o.type == 'MESH']
        bpy.ops.object.select_all(action='DESELECT')
        for o in meshes:
            o.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = name
        ob.data.name = name
    (x0, x1), (y0, y1), (z0, z1) = bbox()
    Lb = y1 - y0
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
    # three.js coords: tx = X, ty = Z, tz = -Y
    def frac(x, z, s):
        # three.js: x = X, y = Z, z = -Y = s; relative to the bbox centre, in units of the length
        return [round((x - cx) / Lb, 4), round((z - cz) / Lb, 4), round((s + cy) / Lb, 4)]
    noz = [frac(x, z, s) for (x, z, s) in STATE['nozzles']]
    entry = {'file': f'aircraft/{name}.glb', 'rot': [0, 0, 0]}
    if noz:
        entry['nozzles'] = noz
        entry['nozzleR'] = round((STATE['nozzleR'] or 0.4) / Lb, 4)
    else:
        entry['nozzles'] = []
    if STATE['cockpit']:
        cz_, cs_ = STATE['cockpit']
        entry['cockpit'] = [round((cz_ - cz) / Lb, 4), round((cs_ - (-cy)) / Lb, 4)]
    if extra_entry:
        entry.update(extra_entry)
    tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons)
    print('BBOX length %.3f span %.3f height %.3f' % (Lb, x1 - x0, z1 - z0))
    print('TRIS', tris)
    print('ENTRY', json.dumps({name: entry}))
    if out:
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                                  export_image_format='JPEG', export_jpeg_quality=82, export_texcoords=True,
                                  export_normals=True, export_materials='EXPORT')
        _patch_glb(out)
        print('WROTE', out, os.path.getsize(out))
    if RENDER_DIR:
        render(RENDER_DIR)
    return entry

def _patch_glb(path):
    """The glTF exporter drops the colour of a (texture × colour) MULTIPLY mix: write it back as
    baseColorFactor so the panel texture tints the paint instead of replacing it."""
    import struct
    data = open(path, 'rb').read()
    magic, ver, total = struct.unpack_from('<III', data, 0)
    jlen, jtype = struct.unpack_from('<II', data, 12)
    doc = json.loads(data[20:20 + jlen].decode('utf8'))
    rest = data[20 + jlen:]
    factors = STATE.get('factors', {})
    for m in doc.get('materials', []):
        f = factors.get(m.get('name'))
        if f:
            m.setdefault('pbrMetallicRoughness', {})['baseColorFactor'] = [round(v, 5) for v in f]
    js = json.dumps(doc, separators=(',', ':')).encode('utf8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', magic, ver, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), jtype) + js + rest
    open(path, 'wb').write(out)

# ───────────────────────── previews ─────────────────────────
def render(outdir, res=900):
    """Workbench orthographic top/side/front (+ perspective 3/4) renders with transparent background."""
    os.makedirs(outdir, exist_ok=True)
    name = STATE['name']
    (x0, x1), (y0, y1), (z0, z1) = bbox()
    c = Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_object_outline = False
    sc.render.film_transparent = True
    sc.display_settings.display_device = 'sRGB'
    cam = bpy.data.cameras.new('cam')
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    info = {}
    views = {
        'top': ((0, 0, 1), x1 - x0, y1 - y0, (0, 0, 0)),
        'side': ((-1, 0, 0), y1 - y0, z1 - z0, None),
        'front': ((0, 1, 0), x1 - x0, z1 - z0, None),
    }
    for v, (d, w, h, _) in views.items():
        cam.type = 'ORTHO'
        cam.ortho_scale = max(w, h)
        if v == 'top':
            sc.render.resolution_x, sc.render.resolution_y = max(8, int(res * (y1 - y0) / max(w, h))), max(8, int(res * w / max(w, h)))
            cam.ortho_scale = max(w, y1 - y0)
            co.location = c + Vector((0, 0, 50))
            co.rotation_euler = (0, 0, -math.pi / 2)   # nose to the left of the image
        elif v == 'side':
            sc.render.resolution_x, sc.render.resolution_y = res, max(8, int(res * h / w))
            co.location = c + Vector((-60, 0, 0))
            co.rotation_euler = (math.pi / 2, 0, -math.pi / 2)  # looking +x, nose (+Y) to the left
        else:
            sc.render.resolution_x, sc.render.resolution_y = res, max(8, int(res * h / w))
            co.location = c + Vector((0, 60, 0))
            co.rotation_euler = (math.pi / 2, 0, math.pi)
        cam.clip_end = 500
        sc.render.filepath = os.path.join(outdir, f'{name}_{v}.png')
        bpy.ops.render.render(write_still=True)
    # perspective 3/4
    cam.type = 'PERSP'
    cam.lens = 70
    sc.render.resolution_x, sc.render.resolution_y = 1100, 700
    sc.render.film_transparent = False
    for v, d in (('34f', Vector((1.0, 1.25, 0.6))), ('34r', Vector((-1.0, -1.2, 0.7)))):
        d.normalize()
        dist = max(x1 - x0, y1 - y0) * 2.3
        co.location = c + d * dist
        look = (c - co.location).normalized()
        co.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(outdir, f'{name}_{v}.png')
        bpy.ops.render.render(write_still=True)
    print('RENDERED', outdir)

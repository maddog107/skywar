# ═══════════════════════════════════════════════════════════════
# Livery painting on a model's own texture layout (plain Python 3: numpy + Pillow).
# tools/aircraft/bakemaps.py bakes, for every texel, where it lies on the airframe (pos, metres) and which way the
# skin faces there (nrm). A paint script (tools/aircraft/paint_<id>.py) builds a new texture from those: camouflage
# from 3-D noise (so the patterns run across UV seams and wrap round the airframe), an underside colour by which way
# the skin faces, national markings and lettering projected onto the skin like decals, and the original texture's
# panel lines and shading multiplied back in. Coordinates are the source file's (after Blender's glTF import: Z up).
#
#   import livery as LV
#   P = LV.Painter(DIR)                       # DIR from bakemaps.py (maps.npz, base.png)
#   P.fill('#55583e', where=P.mask(...))      # paint
#   P.camo([...colours], scale=2.4, ...)      # disruptive camouflage
#   P.decal(LV.roundel([...]), centre, ...)   # markings
#   P.shade(P.detail())                       # panel lines / shading from the original texture
#   P.save('painted.png')
# ═══════════════════════════════════════════════════════════════
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONTS = ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
         '/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']


def rgb(c):
    """'#rrggbb' → float RGB in 0..1 (sRGB, as stored in the texture)"""
    if isinstance(c, str):
        h = int(c.lstrip('#'), 16)
        return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], np.float32) / 255
    return np.asarray(c, np.float32)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ── 3-D value noise (smooth, tileless), vectorised over N points ──
_PERM = np.random.RandomState(1234).randint(0, 2 ** 31 - 1, 65536).astype(np.int64)
_VALS = np.random.RandomState(4321).rand(65536).astype(np.float32)


def _lattice(ix, iy, iz, seed):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    return _VALS[_PERM[h & 65535] & 65535]


def noise3(p, seed=0):
    """p: N×3 → N values in 0..1 (quintic-interpolated value noise, one unit = one cell)"""
    p = np.asarray(p, np.float64)
    i = np.floor(p).astype(np.int64)
    f = p - i
    u = f * f * f * (f * (f * 6 - 15) + 10)
    out = 0
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1 - u[:, 2]
                out = out + wx * wy * wz * _lattice(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out.astype(np.float32)


def fbm(p, scale, seed=0, octaves=3, gain=0.5, warp=0.0):
    """fractal noise, roughly 0..1; scale = the size (m) of the biggest blobs; warp bends the outlines"""
    p = np.asarray(p, np.float64) / scale
    if warp:
        q = np.stack([noise3(p * 0.7, seed + 11), noise3(p * 0.7, seed + 12), noise3(p * 0.7, seed + 13)], 1) - 0.5
        p = p + q * warp
    tot, amp, norm = 0, 1.0, 0
    for o in range(octaves):
        tot = tot + amp * noise3(p * (2 ** o), seed + o * 101)
        norm += amp
        amp *= gain
    return tot / norm


# ── stencils (RGBA images) for decals ──
def roundel(rings, px=512):
    """rings: [(radius 0..1, '#hex'), ...] outermost first → RGBA disc"""
    im = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for r, c in rings:
        rr = r * px / 2
        d.ellipse([px / 2 - rr, px / 2 - rr, px / 2 + rr, px / 2 + rr], fill=c)
    return im


def font(size, path=None):
    for f in ([path] if path else []) + FONTS:
        if f and os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                pass
    return ImageFont.load_default()


def text(s, colour='#101010', px=160, font_path=None, pad=8, stroke=0, stroke_colour=None, spacing=0):
    """lettering → RGBA image, tight around the glyphs; returns (image, aspect w/h)"""
    f = font(px, font_path)
    tmp = Image.new('RGBA', (10, 10))
    if spacing:
        widths = [ImageDraw.Draw(tmp).textbbox((0, 0), ch, font=f)[2] for ch in s]
        W = int(sum(widths) + spacing * px * (len(s) - 1) + 2 * pad)
    else:
        bb = ImageDraw.Draw(tmp).textbbox((0, 0), s, font=f, stroke_width=stroke)
        W = bb[2] - bb[0] + 2 * pad
    H = int(px * 1.25) + 2 * pad
    im = Image.new('RGBA', (int(W), H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if spacing:
        x = pad
        for ch, w in zip(s, widths):
            d.text((x, pad), ch, font=f, fill=colour, stroke_width=stroke, stroke_fill=stroke_colour)
            x += w + spacing * px
    else:
        d.text((pad - bb[0], pad - bb[1] + (H - 2 * pad - (bb[3] - bb[1])) // 2), s, font=f, fill=colour, stroke_width=stroke, stroke_fill=stroke_colour)
    bbox = im.getbbox() or (0, 0, W, H)
    im = im.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(W, bbox[2] + pad), min(H, bbox[3] + pad)))
    return im


def rect(w, h, colour, px=256):
    return Image.new('RGBA', (px, max(1, int(px * h / w))), colour)


class Painter:
    def __init__(self, d, base=True):
        m = np.load(os.path.join(d, 'maps.npz'))
        self.pos = m['pos'].astype(np.float32)
        self.nrm = m['nrm'].astype(np.float32)
        self.cover = m['cover'].astype(bool)
        self.H, self.W = self.cover.shape
        bp = os.path.join(d, 'base.png')
        if base and os.path.exists(bp):
            b = Image.open(bp).convert('RGB')
            if b.size != (self.W, self.H):
                b = b.resize((self.W, self.H), Image.LANCZOS)
            self.base = np.asarray(b, np.float32) / 255
        else:
            self.base = np.ones((self.H, self.W, 3), np.float32)
        self.out = self.base.copy()
        # gutters: texels outside every face get the nearest painted colour at save (no dark seams in the mips)
        self.valid = np.linalg.norm(self.nrm, axis=2) > 0.5
        self.x, self.y, self.z = self.pos[..., 0], self.pos[..., 1], self.pos[..., 2]
        self.nx, self.ny, self.nz = self.nrm[..., 0], self.nrm[..., 1], self.nrm[..., 2]

    # ── masks (H×W float 0..1) ──
    def box(self, lo, hi, soft=0.0):
        m = np.ones((self.H, self.W), np.float32)
        for k, a in enumerate((self.x, self.y, self.z)):
            if lo[k] is not None:
                m *= smoothstep(lo[k] - soft, lo[k] + soft, a) if soft else (a >= lo[k])
            if hi[k] is not None:
                m *= 1 - (smoothstep(hi[k] - soft, hi[k] + soft, a) if soft else (a > hi[k]))
        return m

    def facing(self, d, lo=0.2, hi=0.4):
        d = np.asarray(d, np.float32) / np.linalg.norm(d)
        return smoothstep(lo, hi, self.nx * d[0] + self.ny * d[1] + self.nz * d[2])

    def points(self, sym_axis=None):
        p = self.pos.reshape(-1, 3).copy()
        if sym_axis is not None:
            p[:, sym_axis] = np.abs(p[:, sym_axis])
        return p

    # ── paint ──
    def fill(self, colour, where=1.0):
        w = np.broadcast_to(np.asarray(where, np.float32), (self.H, self.W))[..., None]
        self.out = self.out * (1 - w) + rgb(colour) * w

    def camo(self, colours, scale=2.5, where=1.0, sym_axis=1, seed=7, octaves=3, warp=0.6, shares=None, edge=0.0, stretch=None):
        """disruptive camouflage: colours[0] is the ground; each further colour is a noise field thresholded to its share
        of the surface (shares, default equal); edge > 0 softens the outlines (m). sym_axis mirrors the pattern
        left/right (the span axis); stretch scales the axes (e.g. longer patches along the fuselage)"""
        p = self.points(sym_axis)
        if stretch is not None:
            p = p / np.asarray(stretch, np.float32)
        n = len(colours)
        shares = shares or [1.0 / n] * n
        res = np.tile(rgb(colours[0]), (len(p), 1))
        left = 1.0
        for k in range(1, n):
            f = fbm(p, scale, seed + 31 * k, octaves, warp=warp)
            # threshold for this colour's share of what is left
            frac = shares[k] / max(left, 1e-6)
            thr = np.quantile(f[self.cover.reshape(-1)], 1 - min(frac, 1)) if self.cover.any() else 0.5
            a = smoothstep(thr - edge, thr + edge, f) if edge else (f >= thr).astype(np.float32)
            res = res * (1 - a[:, None]) + rgb(colours[k]) * a[:, None]
            left -= shares[k]
        w = np.broadcast_to(np.asarray(where, np.float32), (self.H, self.W))[..., None]
        self.out = self.out * (1 - w) + res.reshape(self.H, self.W, 3) * w

    def decal(self, img, centre, u_axis, v_axis, size, facing=None, depth=0.6, min_dot=0.25, opacity=1.0, mirror=None):
        """project an RGBA image onto the skin: its centre at `centre`, its width `size` (m) along u_axis, its height
        along v_axis (image up = +v), onto skin facing `facing` (default u × v) within ±depth of the decal plane.
        mirror: an axis index (1 = y) to repeat it mirrored on the other side (the text stays readable)"""
        jobs = [(np.asarray(centre, np.float32), np.asarray(u_axis, np.float32), np.asarray(v_axis, np.float32), facing)]
        if mirror is not None:
            c2 = jobs[0][0].copy(); c2[mirror] *= -1
            fl = np.ones(3, np.float32); fl[mirror] = -1
            f2 = None if facing is None else np.asarray(facing, np.float32) * fl
            # mirrored: the u axis flips so lettering still reads forward on the far side
            jobs.append((c2, -jobs[0][1] * fl, jobs[0][2] * fl, f2))
        a = np.asarray(img.convert('RGBA'), np.float32) / 255
        ih, iw = a.shape[:2]
        width, height = size, size * ih / iw
        for c, u, v, f in jobs:
            u = u / np.linalg.norm(u); v = v / np.linalg.norm(v)
            nrm = np.cross(u, v) if f is None else np.asarray(f, np.float32) / np.linalg.norm(f)
            d = self.pos - c
            pu = (d @ u) / width + 0.5
            pv = 0.5 - (d @ v) / height
            pn = d @ nrm
            ok = (pu >= 0) & (pu < 1) & (pv >= 0) & (pv < 1) & (np.abs(pn) < depth) & ((self.nrm @ nrm) > min_dot) & self.valid
            if not ok.any():
                print('decal at', c.tolist(), 'hit no skin')
                continue
            # bilinear sample
            fx = pu[ok] * iw - 0.5; fy = pv[ok] * ih - 0.5
            x0 = np.clip(np.floor(fx).astype(int), 0, iw - 1); y0 = np.clip(np.floor(fy).astype(int), 0, ih - 1)
            x1 = np.clip(x0 + 1, 0, iw - 1); y1 = np.clip(y0 + 1, 0, ih - 1)
            tx = (fx - np.floor(fx))[:, None]; ty = (fy - np.floor(fy))[:, None]
            s = (a[y0, x0] * (1 - tx) * (1 - ty) + a[y0, x1] * tx * (1 - ty) + a[y1, x0] * (1 - tx) * ty + a[y1, x1] * tx * ty)
            al = s[:, 3:4] * opacity
            o = self.out[ok]
            self.out[ok] = o * (1 - al) + s[:, :3] * al

    # ── the original texture's detail (panel lines, rivets, shading) as a multiplier ──
    def detail(self, sat_max=0.22, lo=0.55, hi=1.1, ref=None, blur=0):
        b = self.base
        mx, mn = b.max(2), b.min(2)
        sat = (mx - mn) / np.maximum(mx, 1e-4)
        lum = b @ np.array([0.3, 0.59, 0.11], np.float32)
        neutral = (sat < sat_max) & self.cover
        if ref is None:
            ref = np.percentile(lum[neutral], 92) if neutral.any() else 1.0
        d = np.where(neutral, lum / ref, 1.0)
        if blur:
            # keep only the fine detail: divide out the large-scale shading
            big = np.asarray(Image.fromarray((np.clip(d, 0, 2) * 127).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur)), np.float32) / 127
            d = d / np.maximum(big, 0.3)
        return np.clip(d, lo, hi).astype(np.float32)

    def shade(self, mult, where=1.0):
        w = np.broadcast_to(np.asarray(where, np.float32), (self.H, self.W))
        m = 1 + (mult - 1) * w
        self.out = self.out * m[..., None]

    def keep(self, where):
        """put the original texture back where `where` (e.g. dark trim, glass, instruments)"""
        w = np.broadcast_to(np.asarray(where, np.float32), (self.H, self.W))[..., None]
        self.out = self.out * (1 - w) + self.base * w

    def bleed(self, img, mask, steps=12):
        """grow the colours inside mask outward by `steps` texels (gutters take their island's edge colour, so mipmaps
        and filtering never pull in the old paint)"""
        img = img.copy(); m = mask.copy()
        for _ in range(steps):
            acc = np.zeros_like(img); cnt = np.zeros(m.shape, np.float32)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                sm = np.roll(m, (dy, dx), (0, 1)); si = np.roll(img, (dy, dx), (0, 1))
                acc += si * sm[..., None]; cnt += sm
            grow = (~m) & (cnt > 0)
            img[grow] = acc[grow] / cnt[grow][:, None]
            m = m | grow
        return img, m

    def save(self, path, keep_outside=True, bleed=12):
        out = np.clip(self.out, 0, 1)
        if keep_outside:
            inside = self.cover | self.valid
            out = np.where(inside[..., None], out, self.base)
            if bleed:
                grown, m = self.bleed(out, self.cover.copy(), bleed)
                out = np.where((~self.cover & m)[..., None], grown, out)
        Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(path)
        print('wrote', path)

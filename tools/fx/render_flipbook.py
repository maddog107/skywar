#!/usr/bin/env python3
# ═══════════════════════════════════════════════════════════════
# Fireball flipbooks, stage 2: the simulation's grids (tools/fx/bake_fireball.py) into a flipbook atlas the game's
# particle shader can light itself. Plain numpy (any python3 with numpy, or Blender's own).
#
#   python3 tools/fx/render_flipbook.py --cache /tmp/fx/ground --out models/fx [--size 256] [--preview sheet.png]
#
# Every frame is looked at from the side (along +Y: x to the right, z up) with parallel rays, and is NOT rendered
# with a light of its own: what is stored is what the game needs to light it with its own sun, sky and fires.
#   <event>_a  R, G  the light's left-right and up-down terms    B  heat    A  coverage
#   <event>_b  R, G  motion vectors (to the next frame)          B  the light's even term    A  its front-back term
# Light: the smoke is marched once for each of six lights (from the right, left, top, bottom, front and back:
# Beer-Lambert shadowing along the light's axis, single scattering toward the eye, with a softer second term standing
# in for the light that scatters round), and the six are folded into four numbers per pixel, b0 + b·s for a sun in
# direction s: b0 their mean, b half the difference of each opposite pair. A sun on an axis gets its own render back
# (near enough), one in between a blend; behind the cloud the thin edges light up and the thick middle goes dark.
# Heat: the flame seen through the cold soot in front of it (soot that is itself burning doesn't hide it), plus the
# fire's glow scattered in the smoke round it, squashed into 0..1 for the game's black-body ramp.
# Motion vectors: the velocity grid averaged along each ray, weighted by what is visible there, times the step to
# the next frame; the game takes two taps (this frame pushed forward, the next one pulled back) and cross-fades.
# Every frame is cropped to what is in it (a square window in the domain; windows grow with the cloud), so early
# frames, where the fireball is small in the domain, are as sharp as late ones; the windows are in the metadata.
#
# Output: <out>/<event>_a.png, <event>_b.png (and .webp through `cwebp` when it is installed; see --webp) and
# <out>/<event>.json (layout, times, windows, the fireball's size and burn-out time: src/flipbook.js reads it).
# ═══════════════════════════════════════════════════════════════
import os, sys, json, zlib, struct, argparse, subprocess, shutil
import numpy as np

COLS = 8
SHADE = dict(
    sigma=1.5,         # extinction per metre of smoke at density 1
    light=0.8,         # the light's extinction against the eye's (soot scatters forward: shadows are softer than sight)
    soft=0.3,          # the second, softer shadow term's share, and
    soft_k=0.22,       # its extinction against the first
    flame_sigma=0.9,   # extinction per metre of flame (burning gas is full of glowing soot: a fire is nearly opaque)
    flame_gain=1.15,   # the flame grid (1 fresh fuel .. 0 burnt out) to heat, and
    flame_gamma=1.5,   # its curve (most of the burn is orange, not white)
    soot_free=0.9,     # smoke per unit of flame that glows with it
    thin=0.0,          # the last frames' smoke is worn away from its thin parts inward: density lost by the end
    thin_from=0.72,    # (from this fraction of the frames on)
    glow=0.5,          # the fire's light scattered in the smoke round it
    glow_radius=0.11,  # of the domain
    floor=0.02,        # coverage below this is nothing (the window is fitted to the rest)
    margin=0.07,       # round the window
)


# what differs by event: high explosive burns clean and white-hot, fuel orange under its own soot
EVENT_SHADE = {
    'air': dict(soot_free=1.3, flame_gain=1.25, thin=0.3),
    'ground': dict(soot_free=1.3, flame_gain=1.25, thin=0.3),
    'fuel': dict(soot_free=4.0, flame_gain=1.2, flame_gamma=1.2, thin=0.3),
}


def load(cache, i, shape=None):
    z = np.load(os.path.join(cache, 'frame_%03d.npz' % i))
    fr = {k: z[k].astype(np.float32) for k in z.files}
    full = fr['density'].shape
    for k in ('heat', 'velocity'):
        a = fr[k]
        if a.shape[:3] != full:
            # stored on a coarser grid (half resolution, or the simulation's own under a noise-refined density)
            up = max(2, int(round(full[0] / a.shape[0])))
            for ax in range(3):
                a = np.repeat(a, up, axis=ax)
            pad = [(0, max(0, full[ax] - a.shape[ax])) for ax in range(3)] + [(0, 0)] * (a.ndim - 3)
            a = np.pad(a, pad, mode='edge')[:full[0], :full[1], :full[2]]
            fr[k] = a
    return fr


def box_blur(a, r, axis):
    if r < 1:
        return a
    c = np.cumsum(np.pad(a, [(r + 1, r) if ax == axis else (0, 0) for ax in range(a.ndim)], mode='edge'), axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur3(a, r):
    for _ in range(2):
        for ax in range(3):
            a = box_blur(a, r, ax)
    return a


def passes(fr, dx, S=SHADE, age=0.0):
    """one frame's grids (z, y, x) -> images (z, x), z up. age: the frame's place in the flipbook, 0..1"""
    rho, fl, vel = fr['density'], np.clip(fr['flame'], 0, 1), fr['velocity']
    if S['thin'] > 0 and age > S['thin_from']:
        k = ((age - S['thin_from']) / (1 - S['thin_from'])) ** 2
        rho = np.maximum(0.0, rho - S['thin'] * k)
    # what stops light: the smoke, and the burning gas itself
    tau = dx * (S['sigma'] * rho + S['flame_sigma'] * fl)
    av = 1.0 - np.exp(-tau)                           # a voxel's own opacity
    ty = np.cumsum(tau, axis=1)
    tv = ty - tau                                     # optical depth in front of each voxel, from the eye
    Tv = np.exp(-tv)
    w = Tv * av                                       # what each voxel sends to the eye, per unit of light on it
    tot_y = ty[:, -1:, :]
    alpha = 1.0 - np.exp(-tot_y[:, 0, :])

    kl = S['light']

    def lit(t):
        t = kl * t
        return (1 - S['soft']) * np.exp(-t) + S['soft'] * np.exp(-S['soft_k'] * t)

    half = 0.5 * tau
    tx = np.cumsum(tau, axis=2)
    tz = np.cumsum(tau, axis=0)
    six = dict(
        R=(w * lit(tx[:, :, -1:] - tx + half)).sum(axis=1),     # light from +x
        L=(w * lit(tx - tau + half)).sum(axis=1),
        T=(w * lit(tz[-1:, :, :] - tz + half)).sum(axis=1),     # from above
        B=(w * lit(tz - tau + half)).sum(axis=1),
        F=(w * lit(tv + half)).sum(axis=1),                     # from the eye's side
        K=(w * lit(tot_y - ty + half)).sum(axis=1),             # from behind
    )
    # heat: the temperature of what the eye sees, a fire being its own glowing surface: fresh fuel white-hot,
    # nearly burnt gas dull red, cold soot in front of it dark. Gas with more soot in it than its flame accounts for
    # (the unburnt soot thrown out with the fuel, the smoke piling up as the fuel runs out) is that much cooler.
    hot = S['flame_sigma'] * fl
    cold = S['sigma'] * np.maximum(0.0, rho - S['soot_free'] * fl)
    theta = (np.clip(fl * S['flame_gain'], 0, 1) ** S['flame_gamma']) * hot / (hot + cold + 1e-6)
    direct = (w * theta).sum(axis=1)
    # and its glow in the smoke round it: the flame blurred out through the volume, scattered toward the eye
    r = max(1, int(round(S['glow_radius'] * rho.shape[2] / 3)))
    glow = blur3(theta, r)
    scatter = (w * (1 - theta) * glow).sum(axis=1) * S['glow']
    heat = np.clip(direct + scatter, 0, 1)
    # motion: what is visible on each ray, and how it moves across the image (x right, z up), in the grid's units
    wv = w + 1e-7
    ws = wv.sum(axis=1)
    mvx = (wv * vel[..., 0]).sum(axis=1) / ws
    mvz = (wv * vel[..., 2]).sum(axis=1) / ws
    out = dict(alpha=alpha, alpha_s=alpha, heat=heat, mvx=mvx, mvz=mvz, direct=direct)
    out.update(six)
    return out


def light_terms(p):
    """the six lit images -> b0 and (bx, by, bz), per unit of smoke coverage"""
    a = p['alpha_s']
    eps = 0.02
    mean = (p['R'] + p['L'] + p['T'] + p['B'] + p['F'] + p['K']) / 6.0
    b0 = (mean + eps) / (a + eps)       # (a wisp is lit from everywhere: 1)
    k = 0.5 / (a + eps)
    return b0, (p['R'] - p['L']) * k, (p['T'] - p['B']) * k, (p['F'] - p['K']) * k


def warp(img, dxc, dzc):
    """img pushed along (dxc, dzc) cells (a backward lookup with the motion at the destination)"""
    H, W = img.shape
    zz, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    xs, zs = np.clip(xx - dxc, 0, W - 1.001), np.clip(zz - dzc, 0, H - 1.001)
    x0, z0 = np.floor(xs).astype(int), np.floor(zs).astype(int)
    fx, fz = xs - x0, zs - z0
    return (img[z0, x0] * (1 - fx) + img[z0, x0 + 1] * fx) * (1 - fz) + (img[z0 + 1, x0] * (1 - fx) + img[z0 + 1, x0 + 1] * fx) * fz


def fit_velocity_unit(P, steps, fps):
    n = len(P)
    pairs = [i for i in range(3, n - 1, max(1, n // 12))]

    def err(k):
        e = 0.0
        for i in pairs:
            s = k * steps[i] * fps
            for key in ('alpha', 'heat'):
                e += float(np.abs(warp(P[i][key], P[i]['mvx'] * s, P[i]['mvz'] * s) - P[i + 1][key]).mean())
        return e
    e0 = err(0.0)
    ks = [0.02 * 1.3 ** j for j in range(18)]
    es = [err(k) for k in ks]
    j = int(np.argmin(es))
    lo, hi = ks[max(0, j - 1)], ks[min(len(ks) - 1, j + 1)]
    fine = np.linspace(lo, hi, 9)
    ef = [err(float(k)) for k in fine]
    j = int(np.argmin(ef))
    return float(fine[j]), ef[j] / max(e0, 1e-9)


def window_of(alpha, dx, floor):
    """the square that holds everything above the floor: centre x, centre z, edge (m), in the image's own frame"""
    m = alpha > floor
    if not m.any():
        return None
    zs = np.where(m.any(axis=1))[0]
    xs = np.where(m.any(axis=0))[0]
    x0, x1, z0, z1 = xs[0] * dx, (xs[-1] + 1) * dx, zs[0] * dx, (zs[-1] + 1) * dx
    return [(x0 + x1) / 2, (z0 + z1) / 2, max(x1 - x0, z1 - z0)]


def cubic_weights(t, B=1 / 3, C=1 / 3):
    # Mitchell-Netravali: the early frames are a few times finer than the simulation's cells, and a B-spline (B = 1,
    # C = 0) blurs them more than it needs to; this keeps the billows' edges without ringing
    t2, t3 = t * t, t * t * t
    return [((-B - 6 * C) * t3 + (3 * B + 12 * C) * t2 + (-3 * B - 6 * C) * t + B) / 6,
            ((12 - 9 * B - 6 * C) * t3 + (-18 + 12 * B + 6 * C) * t2 + (6 - 2 * B)) / 6,
            ((-12 + 9 * B + 6 * C) * t3 + (18 - 15 * B - 12 * C) * t2 + (3 * B + 6 * C) * t + B) / 6,
            ((B + 6 * C) * t3 - 6 * C * t2) / 6]


def resample(img, win, dx, N, fill=0.0):
    """img (z, x) sampled over the window [cx, cz, e] into an N×N frame, row 0 at the top"""
    cx, cz, e = win
    u = (np.arange(N) + 0.5) / N
    xs = (cx + (u - 0.5) * e) / dx - 0.5
    zs = (cz + (0.5 - u) * e) / dx - 0.5
    H, W = img.shape
    pad = np.pad(img, 2, mode='constant', constant_values=fill)

    def taps(c, n):
        i = np.floor(c).astype(int)
        t = (c - i).astype(np.float32)
        idx = [np.clip(i + k + 2, 0, n + 3) for k in (-1, 0, 1, 2)]
        return idx, cubic_weights(t)
    zi, zw = taps(zs, H)
    xi, xw = taps(xs, W)
    rows = sum(pad[zi[k], :] * zw[k][:, None] for k in range(4))
    return sum(rows[:, xi[k]] * xw[k][None, :] for k in range(4))


def write_png(path, a):
    a = np.ascontiguousarray(a)
    h, w = a.shape[:2]
    ch = 1 if a.ndim == 2 else a.shape[2]
    ctype = {1: 0, 3: 2, 4: 6}[ch]
    raw = np.zeros((h, w * ch + 1), dtype=np.uint8)
    raw[:, 1:] = a.reshape(h, w * ch)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    with open(path, 'wb') as fh:
        fh.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ctype, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw.tobytes(), 9)) + chunk(b'IEND', b''))


def u8(a):
    return np.clip(np.round(a * 255.0), 0, 255).astype(np.uint8)


# ── the game's shading of a frame (src/flipbook.js FLIPBOOK_FS), for looking at the result without the game ──
def fire_ramp(h):
    def ss(a, b, x):
        t = np.clip((x - a) / (b - a), 0, 1)
        return t * t * (3 - 2 * t)
    h = h[..., None]
    c = np.array([0.25, 0.02, 0.0]) * (1 - ss(0, 0.3, h)) + np.array([0.95, 0.22, 0.02]) * ss(0, 0.3, h)
    c = c * (1 - ss(0.25, 0.65, h)) + np.array([1.45, 0.62, 0.12]) * ss(0.25, 0.65, h)
    return c * (1 - ss(0.65, 1.0, h)) + np.array([2.1, 1.55, 0.8]) * ss(0.65, 1.0, h)


def shade(A, B, sun=(-0.55, 0.62, 0.56), soot=(0.2, 0.19, 0.18), bg=(0.33, 0.47, 0.72), night=False, heat_gain=1.0):
    """A, B: float frames (N, N, 4) as stored (0..1). Returns an sRGB uint8 image."""
    s = np.array(sun, dtype=np.float32)
    s /= np.linalg.norm(s)
    bx, by, heat, alpha = A[..., 0] * 2 - 1, A[..., 1] * 2 - 1, A[..., 2], A[..., 3]
    b0, bz = B[..., 2], B[..., 3] * 2 - 1
    sun_col = np.array([0.02, 0.025, 0.04]) if night else np.array([1.0, 0.93, 0.82]) * 0.95
    amb_top = np.array([0.012, 0.016, 0.03]) if night else np.array([0.3, 0.36, 0.48])
    amb_bot = np.array([0.006, 0.007, 0.008]) if night else np.array([0.1, 0.11, 0.08])
    direct = np.clip(b0 + bx * s[0] + by * s[1] + bz * s[2], 0, 1.5)
    sky = np.clip(b0 + 0.5 * by, 0, 1.5)
    gnd = np.clip(b0 - 0.5 * by, 0, 1.5)
    col = np.array(soot) * (sun_col * direct[..., None] * 1.7 + amb_top * sky[..., None] + amb_bot * gnd[..., None])
    heat = np.clip(heat * heat_gain, 0, 1)
    t = np.clip(heat / 0.35, 0, 1)
    e = (t * t * (3 - 2 * t))[..., None]
    col = col * (1 - e) + fire_ramp(heat) * e
    a = alpha[..., None]
    back = np.array([0.004, 0.005, 0.01]) if night else np.array(bg)
    out = col * a + back * (1 - a * (1 - e * 0.45))
    out = out / (1 + out * 0.25)                       # a soft shoulder, as the tone map has
    return u8(np.clip(out, 0, 1) ** (1 / 2.2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--out', default=None)
    ap.add_argument('--size', type=int, default=256)
    ap.add_argument('--preview', default=None, help='a contact sheet of the frames shaded as the game shades them')
    ap.add_argument('--webp', type=int, default=90, help='cwebp quality for the .webp copies (0: none)')
    ap.add_argument('--set', action='append', default=[], help='override a shading constant: name=value')
    ap.add_argument('--unit', type=float, default=None, help='the velocity grid\'s unit (default: fitted)')
    a = ap.parse_args()
    with open(os.path.join(a.cache, 'sim.json')) as fh:
        sim = json.load(fh)
    S = dict(SHADE)
    S.update(EVENT_SHADE.get(sim['event'], {}))
    for kv in a.set:
        k, v = kv.split('=')
        S[k] = float(v)
    n = sim['frames']
    dx = sim.get('dx') or sim['size'] / max(sim['res'])
    N = a.size
    times, steps = sim['times'], sim['steps']

    # pass 1: every frame's images and its window
    P, wins = [], []
    for i in range(n):
        p = passes(load(a.cache, i), dx, S, i / (n - 1))
        P.append({k: v.astype(np.float32) for k, v in p.items()})
        wins.append(window_of(p['alpha'], dx, S['floor']))
        print('frame %2d  cover %.3f  heat %.2f' % (i, float(p['alpha'].mean()), float(p['heat'].max())), flush=True)
    # windows: smoothed over neighbours, then grown to hold their own frame's content and its motion to the next
    first = next(w for w in wins if w)
    wins = [w or first for w in wins]
    W = np.array(wins, dtype=np.float64)
    sm = W.copy()
    for i in range(n):
        lo, hi = max(0, i - 2), min(n, i + 3)
        sm[i] = W[lo:hi].mean(axis=0)
    for i in range(n):
        if sim['floor']:
            # a ground burst stands on the frame's bottom edge
            need = max(abs(sm[i, 0] - W[i, 0]) * 2 + W[i, 2], W[i, 1] + W[i, 2] / 2)
            sm[i, 2] = max(sm[i, 2], need) * (1 + 2 * S['margin'])
            sm[i, 1] = sm[i, 2] / 2
        else:
            need = max(abs(sm[i, 0] - W[i, 0]), abs(sm[i, 1] - W[i, 1])) * 2 + W[i, 2]
            sm[i, 2] = max(sm[i, 2], need) * (1 + 2 * S['margin'])
    # the velocity grid's unit isn't documented: it is found by pushing each frame's picture along k × its motion
    # and comparing with the next frame (the k with the least error; --unit overrides). One frame's motion is then
    # v × k × the frame's time scale, in grid cells
    fps = sim.get('fps') or int(10.0 / max(steps))
    unit, gain = a.unit, None
    if unit is None:
        unit, gain = fit_velocity_unit(P, steps, fps)
        print('velocity unit %.3f cells per frame at time scale 1 (the warp leaves %.0f%% of the frame-to-frame difference)' % (unit, 100 * gain))
    A = np.zeros((n, N, N, 4), dtype=np.float32)
    Bt = np.zeros((n, N, N, 4), dtype=np.float32)
    mv_raw = []
    for i in range(n):
        p, win = P[i], sm[i]
        b0, bx, by, bz = light_terms(p)
        r = lambda img, fill=0.0: resample(img, win, dx, N, fill)
        alpha = np.clip(r(p['alpha']), 0, 1)
        A[i, ..., 0] = np.clip(r(bx) * 0.5 + 0.5, 0, 1)
        A[i, ..., 1] = np.clip(r(by) * 0.5 + 0.5, 0, 1)
        A[i, ..., 2] = np.clip(r(p['heat'] / (p['alpha'] + 0.02)), 0, 1)
        A[i, ..., 3] = alpha
        Bt[i, ..., 2] = np.clip(r(b0, 1.0), 0, 1)
        Bt[i, ..., 3] = np.clip(r(bz) * 0.5 + 0.5, 0, 1)
        # motion to the next frame, in this frame's uv (x right, y down the image)
        k = steps[i] * fps * dx * unit / win[2]
        mv_raw.append((r(p['mvx']) * k, -r(p['mvz']) * k))
    mv_scale = float(max(max(np.abs(m[0]).max(), np.abs(m[1]).max()) for m in mv_raw)) or 1.0
    mv_scale = min(mv_scale, 0.12)
    for i in range(n):
        Bt[i, ..., 0] = np.clip(mv_raw[i][0] / mv_scale * 0.5 + 0.5, 0, 1)
        Bt[i, ..., 1] = np.clip(mv_raw[i][1] / mv_scale * 0.5 + 0.5, 0, 1)
    # soft edges: nothing may touch a frame's border (the quad's edge would show), except a ground burst's foot
    u = (np.arange(N) + 0.5) / N
    edge = np.clip(np.minimum(u, 1 - u) / 0.04, 0, 1)
    fx_, fy_ = edge[None, :], edge[:, None]
    if sim['floor']:
        fy_ = np.clip(u / 0.04, 0, 1)[:, None] * np.clip((1 - u) / 0.012, 0, 1)[:, None]
    A[..., 3] *= (fx_ * fy_)[None]

    # what the game needs to know
    heat_sum = np.array([float((A[i, ..., 2] * A[i, ..., 3]).sum() * sm[i, 2] ** 2) for i in range(n)])
    peak = int(heat_sum.argmax())
    out_t = [t / (times[-1] + steps[-1]) for t in times]
    burn = next((i for i in range(peak, n) if heat_sum[i] < 0.06 * heat_sum[peak]), n - 1)
    # the fireball across at its hottest frame: what glows there (a sooty fuel fire never reaches the white of
    # high explosive, so against that frame's own brightest when that is the lower mark)
    hot_img = A[peak, ..., 2] * (A[peak, ..., 3] > 0.3)
    hot = hot_img > min(0.35, 0.5 * float(hot_img.max()))
    ext = sm[peak, 2]
    fire_d = float(max(hot.any(axis=0).sum(), hot.any(axis=1).sum()) / N * ext)
    ox, oz = sim['origin'][0] + sim['size'] / 2, sim['origin'][2]
    meta = dict(
        name=sim['event'], cols=COLS, rows=(n + COLS - 1) // COLS, frames=n, frameSize=N,
        ground=bool(sim['floor']),
        times=[round(t, 5) for t in out_t],                       # each frame's time, as a fraction of the whole
        duration=round(times[-1] + steps[-1], 4),                 # the simulation's own seconds
        burn=round(out_t[burn], 5),                               # the fire is out by this fraction
        fireDiameter=round(fire_d, 3),                            # the fireball across at its hottest (m, the simulation's)
        windows=[[round((w[0] - ox), 3), round((w[1] - oz), 3), round(w[2], 3)] for w in sm.tolist()],  # centre right / up of the burst point, edge (m)
        mvScale=round(mv_scale, 5),                               # the motion channels' ±1, in frame widths per step
        glow=[round(float(h / heat_sum[peak]), 4) for h in heat_sum],   # the fire's brightness frame by frame (its hottest = 1)
        velocityUnit=round(unit, 4),
        channels=dict(a='light x, light y, heat, coverage', b='motion x, motion y, light mean, light z'),
        source='SKYWAR / Blender %s Mantaflow, tools/fx/bake_fireball.py + render_flipbook.py; CC0' % sim.get('blender', ''),
        bake=dict(res=sim['res'], size=sim['size'], seconds=round(sim.get('bake_seconds', 0))),
    )
    print('peak frame %d, burn-out frame %d (%.2f s of %.2f s), fireball %.1f m, mv scale %.4f' % (peak, burn, times[burn], meta['duration'], fire_d, mv_scale))

    def atlas(F):
        rows = meta['rows']
        at = np.zeros((rows * N, COLS * N, 4), dtype=np.float32)
        for i in range(n):
            y, x = (i // COLS) * N, (i % COLS) * N
            at[y:y + N, x:x + N] = F[i]
        return at
    if a.out:
        os.makedirs(a.out, exist_ok=True)
        base = os.path.join(a.out, 'fireball_' + sim['event'])
        aa, bb = u8(atlas(A)), u8(atlas(Bt))
        # one grey image per atlas, its four channels side by side in a 2×2 mosaic: lossy WebP keeps full resolution
        # only in its luma plane, so colour channels would smear into each other; grey tiles don't
        for tag, at in (('a', aa), ('b', bb)):
            h, w = at.shape[:2]
            mosaic = np.zeros((h * 2, w * 2), dtype=np.uint8)
            for c in range(4):
                mosaic[(c // 2) * h:(c // 2 + 1) * h, (c % 2) * w:(c % 2 + 1) * w] = at[..., c]
            png = '%s_%s.png' % (base, tag)
            write_png(png, mosaic)
            if a.webp and shutil.which('cwebp'):
                subprocess.run(['cwebp', '-quiet', '-q', str(a.webp), '-m', '6', png, '-o', '%s_%s.webp' % (base, tag)], check=True)
                os.remove(png)
        with open(base + '.json', 'w') as fh:
            # (one key a line, its value compact)
            fh.write('{\n' + ',\n'.join(' %s: %s' % (json.dumps(k), json.dumps(v, separators=(',', ':') if isinstance(v, list) else None)) for k, v in meta.items()) + '\n}\n')
        print('wrote', base)
    if a.preview:
        pick = list(range(0, n, 2))
        tiles = [shade(A[i], Bt[i]) for i in pick]
        per = 8
        rows = [np.concatenate(tiles[k:k + per], axis=1) for k in range(0, len(tiles), per)]
        write_png(a.preview, np.concatenate(rows, axis=0))
        print('preview', a.preview)
    return A, Bt, meta


if __name__ == '__main__':
    main()

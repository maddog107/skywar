# ═══════════════════════════════════════════════════════════════
# Airbase structure textures (python3 + numpy + Pillow):
#   python3 tools/airbases/textures.py [OUT_DIR]      (default models/airbases/tex)
#   concrete.jpg  512², tileable, 4 m per tile (akit.TILE): cast-in-place concrete, formwork seams every 2 m,
#                 aggregate speckle, rain streaks and lichen blotches (the weathered grey of a 1980s TAB-V shelter)
#   earth.jpg     512², 6 m per tile: grassed-over earth cover (igloos, Soviet arch shelters, bunds) — mixed grass
#                 greens with bare soil patches
#   steel.jpg     512², 3 m per tile: painted steel plate (shelter doors, tanks), faint panel seams and rust spots
# ═══════════════════════════════════════════════════════════════
import sys, os
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'models', 'airbases', 'tex')
os.makedirs(OUT, exist_ok=True)
N = 512


def noise(freq, sharp=2.0, seed=0):
    """tileable band-limited noise in [-1, 1] (FFT-filtered white noise, so it wraps)"""
    r = np.random.default_rng(seed)
    w = r.standard_normal((N, N))
    f = np.fft.fftfreq(N) * N
    kx, ky = np.meshgrid(f, f)
    k = np.sqrt(kx * kx + ky * ky)
    filt = np.exp(-((k / freq) ** sharp))
    filt[0, 0] = 0
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
    return out / (np.abs(out).max() + 1e-9)


def fbm(base, octaves=4, gain=0.5, seed=0):
    a, s, t = 1.0, 0.0, 0.0
    for o in range(octaves):
        s += a * noise(base * 2 ** o, seed=seed + o)
        t += a
        a *= gain
    return s / t


def save(name, rgb):
    img = Image.fromarray(np.clip(rgb * 255, 0, 255).astype(np.uint8), 'RGB')
    img.save(os.path.join(OUT, name), quality=90)
    print('wrote', name)


y, x = np.mgrid[0:N, 0:N] / N

# ── concrete ──
base = np.array([0.56, 0.55, 0.52])
v = 0.08 * fbm(3, seed=1) + 0.035 * noise(90, seed=2) + 0.05 * (np.random.default_rng(3).random((N, N)) - 0.5)
streak = np.clip(noise(6, seed=4), 0, 1) * np.clip(0.5 + 0.5 * np.sin(x * np.pi * 2 * 23 + 3 * noise(4, seed=5)), 0, 1) ** 6
v -= 0.10 * streak
seam = (np.abs(((x * 2) % 1) - 0.5) > 0.494) | (np.abs(((y * 2) % 1) - 0.5) > 0.495)
v -= 0.09 * seam
lichen = np.clip(fbm(5, seed=6) - 0.35, 0, 1) * 1.8
rgb = base[None, None, :] + v[..., None]
rgb = rgb * (1 - lichen[..., None] * 0.35) + lichen[..., None] * 0.35 * np.array([0.36, 0.38, 0.28])
save('concrete.jpg', rgb)

# ── earth (grassed) ──
g = fbm(4, seed=10)
grass = np.array([0.30, 0.36, 0.18]) + np.array([0.06, 0.06, 0.02]) * fbm(8, seed=11)[..., None]
soil = np.array([0.40, 0.33, 0.24])
bare = np.clip((fbm(3, seed=12) - 0.25) * 3, 0, 1)
blades = 0.06 * noise(160, seed=13)
rgb = grass * (1 - bare[..., None]) + soil * bare[..., None] + (blades + 0.04 * g)[..., None]
save('earth.jpg', rgb)

# ── steel (painted) ──
base = np.array([0.42, 0.44, 0.40])
v = 0.03 * fbm(4, seed=20) + 0.02 * noise(120, seed=21)
seam = (np.abs(((y * 3) % 1) - 0.5) > 0.493)
v -= 0.06 * seam
rust = np.clip(fbm(9, seed=22) - 0.55, 0, 1) * 2.5
rgb = base[None, None, :] + v[..., None]
rgb = rgb * (1 - rust[..., None]) + rust[..., None] * np.array([0.42, 0.25, 0.14])
save('steel.jpg', rgb)

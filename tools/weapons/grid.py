# Draw a centimetre grid (butt frame: y forward from the butt, z up from the lowest point) and the spec's
# points / pivots over import_weapon.py's side.png:  python3 tools/weapons/grid.py OUT_DIR
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
d = sys.argv[1]
m = json.load(open(os.path.join(d, 'map.json')))
im = Image.open(os.path.join(d, 'side.png')).convert('RGB')
W, H, L = m['W'], m['H'], m['L']
px = W / L  # pixels per metre (ortho: the width spans L)
def to_px(y, z): return (W / 2 + (y - m['cy']) * px, H / 2 - (z - m['cz']) * px)
dr = ImageDraw.Draw(im, 'RGBA')
try: font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 13)
except Exception: font = None
lo, hi = m['lo'], m['hi']
y = 0.0
while y <= hi[1] + 0.001:
    x, _ = to_px(y, 0)
    cm = round(y * 100)
    col = (200, 0, 0, 150) if cm % 10 == 0 else (0, 0, 180, 70) if cm % 5 == 0 else (0, 0, 0, 25)
    dr.line([(x, 0), (x, H)], fill=col, width=1)
    if cm % 10 == 0: dr.text((x + 2, 2), f'{cm}', fill=(160, 0, 0), font=font)
    y += 0.01
z = 0.0
while z <= hi[2] + 0.001:
    _, yy = to_px(0, z)
    cm = round(z * 100)
    col = (200, 0, 0, 150) if cm % 10 == 0 else (0, 0, 180, 70) if cm % 5 == 0 else (0, 0, 0, 25)
    dr.line([(0, yy), (W, yy)], fill=col, width=1)
    if cm % 5 == 0: dr.text((2, yy - 14), f'z{cm}', fill=(160, 0, 0), font=font)
    z += 0.01
for name, p in list(m.get('points', {}).items()) + [(k + '*', [0] + v) for k, v in m.get('pivots', {}).items()]:
    x, yy = to_px(p[1], p[2])
    dr.ellipse([x - 5, yy - 5, x + 5, yy + 5], outline=(0, 160, 0, 255), width=2)
    dr.text((x + 7, yy - 7), name, fill=(0, 120, 0), font=font)
im.save(os.path.join(d, 'side_grid.png'))
print('grid', os.path.join(d, 'side_grid.png'))

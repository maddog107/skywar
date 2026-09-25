"""Reference-drawing helpers for the aircraft kit (plain python3 + Pillow).

  grid:    python3 refgrid.py grid REF.png OUT.png --box x0 y0 x1 y1 --length 18.9 [--rot 0] [--zero nose|center]
           Crops one view out of a 3-view drawing, detects its extent and draws a metre grid on it
           (x = metres aft of the nose, y = metres from the nose-tip row or the view centre) so
           coordinates can be read straight off the drawing.
  overlay: python3 refgrid.py overlay REF.png RENDER.png OUT.png --box x0 y0 x1 y1 [--rot 0] [--valign top|bottom|center]
           Scales a transparent-background kit render (tools/aircraft_kit.render) so its horizontal extent
           matches the drawing's, and paints it translucent red over the drawing.
"""
import argparse
from PIL import Image, ImageDraw, ImageChops


def load_view(path, box, rot):
    im = Image.open(path).convert('RGBA')
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    im = Image.alpha_composite(bg, im).convert('L')
    if box:
        im = im.crop(tuple(box))
    if rot:
        im = im.rotate(rot, expand=True, fillcolor=255)
    return im


def extent(im, thr=140):
    mask = im.point(lambda v: 255 if v < thr else 0)
    return mask.getbbox()  # (x0, y0, x1, y1)


def grid(a):
    im = load_view(a.ref, a.box, a.rot)
    x0, y0, x1, y1 = a.extent or extent(im)
    ppm = (x1 - x0) / a.length
    if a.yzero is not None:
        yz = a.yzero
    elif a.zero == 'center':
        yz = (y0 + y1) / 2
    else:
        col = [y for y in range(im.height) for x in range(x0, min(x0 + 3, im.width)) if im.getpixel((x, y)) < 140]
        yz = sum(col) / len(col) if col else (y0 + y1) / 2
    k = a.scale
    big = im.resize((im.width * k, im.height * k), Image.LANCZOS).convert('RGB')
    d = ImageDraw.Draw(big)
    m = 0.0
    while x0 + m * ppm <= im.width:
        X = (x0 + m * ppm) * k
        whole = abs(m - round(m)) < 1e-6
        d.line([(X, 0), (X, big.height)], fill=(0, 90, 255) if whole else (150, 200, 255), width=1)
        if whole:
            d.text((X + 2, 2), f'{int(round(m))}', fill=(0, 0, 200))
        m += 0.5
    for sgn in (1, -1):
        m = 0.0
        while 0 <= yz + sgn * m * ppm <= im.height:
            Yp = (yz + sgn * m * ppm) * k
            whole = abs(m - round(m)) < 1e-6
            d.line([(0, Yp), (big.width, Yp)], fill=(255, 60, 0) if whole else (255, 190, 160), width=1)
            if whole:
                d.text((2, Yp + 1), f'{-sgn * int(round(m))}', fill=(200, 0, 0))
            m += 0.5
    big.save(a.out)
    print('extent', (x0, y0, x1, y1), 'px/m', round(ppm, 3), 'zero row', round(yz, 1), '->', a.out)


def overlay(a):
    ref = load_view(a.ref, a.box, a.rot)
    rx0, ry0, rx1, ry1 = a.extent or extent(ref)
    rn = Image.open(a.render).convert('RGBA')
    bb = rn.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    rn = rn.crop(bb)
    sc = (rx1 - rx0) / rn.width
    rn = rn.resize((max(1, int(rn.width * sc)), max(1, int(rn.height * sc))), Image.LANCZOS)
    if a.valign == 'top':
        oy = ry0
    elif a.valign == 'bottom':
        oy = ry1 - rn.height
    else:
        oy = int((ry0 + ry1) / 2 - rn.height / 2)
    k = a.scale
    base = ref.convert('RGBA').resize((ref.width * k, ref.height * k), Image.LANCZOS)
    rn = rn.resize((rn.width * k, rn.height * k), Image.LANCZOS)
    al = rn.getchannel('A').point(lambda v: 255 if v > 60 else 0)
    fill = Image.new('RGBA', rn.size, (255, 30, 30, 0))
    fill.putalpha(al.point(lambda v: 90 if v else 0))
    edge = ImageChops.subtract(al, al.resize((max(1, al.width - 4), max(1, al.height - 4))).resize(al.size))
    base.alpha_composite(fill, (rx0 * k, oy * k))
    # outline: pixels where the mask changes
    from PIL import ImageFilter
    ol = al.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 0 else 0)
    red = Image.new('RGBA', rn.size, (230, 0, 0, 255))
    red.putalpha(ol)
    base.alpha_composite(red, (rx0 * k, oy * k))
    base.convert('RGB').save(a.out)
    print('ref extent', (rx0, ry0, rx1, ry1), 'render scale', round(sc, 4), '->', a.out)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('mode')
    p.add_argument('ref')
    p.add_argument('a1')
    p.add_argument('a2', nargs='?')
    p.add_argument('--box', type=int, nargs=4)
    p.add_argument('--extent', type=int, nargs=4)
    p.add_argument('--rot', type=float, default=0)
    p.add_argument('--length', type=float, default=10)
    p.add_argument('--zero', default='nose')
    p.add_argument('--yzero', type=float)
    p.add_argument('--valign', default='center')
    p.add_argument('--scale', type=int, default=2)
    a = p.parse_args()
    if a.mode == 'grid':
        a.out = a.a1
        grid(a)
    else:
        a.render, a.out = a.a1, a.a2
        overlay(a)

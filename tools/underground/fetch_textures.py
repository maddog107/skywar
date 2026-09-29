# ═══════════════════════════════════════════════════════════════
# Fetch the CC0 photo textures the underground complexes use (Poly Haven, https://polyhaven.com — CC0 1.0) and
# write them to models/underground/tex/ at 1k, as JPEG:
#   python3 tools/underground/fetch_textures.py
# (models/underground/CREDITS.md lists each asset; the files are small enough to keep in the repo.)
# ═══════════════════════════════════════════════════════════════
import io, json, os, sys, urllib.request
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'models', 'underground', 'tex'))
UA = {'User-Agent': 'skywar-asset-fetch'}

# game name → (Poly Haven asset, maps)
ASSETS = {
    'facade': ('concrete_slab_wall', ['Diffuse', 'nor_gl']),        # the portals' cast concrete
    'lining': ('rough_concrete', ['Diffuse', 'nor_gl']),            # shotcrete tunnel lining
    'floor': ('concrete_floor_worn_001', ['Diffuse', 'nor_gl']),    # aprons, hall floors
    'asphalt': ('asphalt_01', ['Diffuse']),                         # taxiways, roads
    'gravel': ('gravel_floor', ['Diffuse']),                        # tracks
    'door': ('green_metal_rust', ['Diffuse', 'nor_gl']),            # blast doors, painted steel
    'dirty': ('dirty_concrete', ['Diffuse']),                       # stains, weathering
}
SUFFIX = {'Diffuse': 'diff', 'nor_gl': 'nor'}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def main(size='1k', px=1024):
    os.makedirs(OUT, exist_ok=True)
    for name, (asset, maps) in ASSETS.items():
        files = json.loads(get('https://api.polyhaven.com/files/%s' % asset))
        for m in maps:
            url = files[m][size]['jpg']['url']
            im = Image.open(io.BytesIO(get(url))).convert('RGB')
            if im.size != (px, px):
                im = im.resize((px, px), Image.LANCZOS)
            dst = os.path.join(OUT, '%s_%s.jpg' % (name, SUFFIX[m]))
            im.save(dst, quality=86, optimize=True)
            print(asset, m, '→', os.path.relpath(dst), os.path.getsize(dst))


if __name__ == '__main__':
    main(*(sys.argv[1:]))

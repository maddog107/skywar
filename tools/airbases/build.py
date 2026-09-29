# ═══════════════════════════════════════════════════════════════
# Build (and optionally preview-render) the airbase models:
#   blender -b -P tools/airbases/build.py -- has_nato [igloo …]            → models/airbases/<id>.glb
#   blender -b -P tools/airbases/build.py -- has_nato --render DIR [--pose 0,1] [--views front34,side]
# Each model is tools/airbases/<id>.py with make() → a vkit.Vehicle (akit.py adds the structure materials); structures
# set CENTER = False (authored about their own origin: the game places them by it), vehicles are recentred on z.
# The preview renderer is the vehicle kit's (tools/vehicles/build.py): run with --render for EEVEE stills.
# ═══════════════════════════════════════════════════════════════
import bpy, sys, os, importlib
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.join(HERE, '..', 'vehicles'))
import akit  # noqa: F401  (patches the kit before any model is made)
import vkit

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
opt = lambda n, d=None: argv[argv.index(n) + 1] if n in argv else d
ids, skip = [], False
for a in argv:
    if skip:
        skip = False; continue
    if a in ('--render', '--pose', '--views', '--size', '--out'):
        skip = True; continue
    if not a.startswith('--'):
        ids.append(a)

# the vehicle driver's pose() and render() (loaded without running its main())
vb = None
if '--render' in argv:
    vpath = os.path.join(HERE, '..', 'vehicles', 'build.py')
    src = open(vpath).read()
    src = src[:src.rstrip().rfind('\nmain()')]   # its definitions only: not its main()
    vb = {'__file__': vpath, '__name__': 'vbuild_lib'}
    exec(compile(src, vpath, 'exec'), vb)

out_dir = opt('--out', os.path.join(vkit.REPO, 'models', 'airbases'))
os.makedirs(out_dir, exist_ok=True)
for vid in ids:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    vkit.MATS.clear()
    mod = importlib.import_module(vid)
    importlib.reload(mod)
    veh = mod.make()
    root = veh.build(center=getattr(mod, 'CENTER', True), out=None if '--no-export' in argv else os.path.join(out_dir, vid + '.glb'))
    if vb and opt('--render'):
        rdir = opt('--render'); os.makedirs(rdir, exist_ok=True)
        views = opt('--views', 'front34,side').split(',')
        size = tuple(int(s) for s in opt('--size', '900x560').split('x'))
        for k in [float(x) for x in opt('--pose', '0').split(',')]:
            vb['pose'](root, k)
            vb['render'](root, os.path.join(rdir, '%s_k%s' % (vid, ('%g' % k).replace('.', 'p'))), views, size)

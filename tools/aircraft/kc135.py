# Boeing KC-135R Stratotanker (with MPRS wing pods) — SKYWAR support-aircraft build.
#   /opt/homebrew/bin/blender -b -P tools/aircraft/kc135.py -- SRC.glb models/aircraft/kc135.glb
# SRC: "KC135R" by Adastra (CC BY 4.0), https://sketchfab.com/3d-models/kc135r-95fedbaed45b492e8dfa9d1a8f76b25f
# (Objaverse glbs/000-081/95fedbaed45b492e8dfa9d1a8f76b25f.glb).
# Changes: the airframe repainted AMC grey with the SKYWAR panel texture (USAF markings kept), odd engine colours
# replaced, the HF wire antenna and the model's simple boom removed; a new articulated flying boom and two Mk 32B-753
# (MPRS) hose-and-drogue wing pods built from published figures:
#   boom: ~8.2 m retracted, ~14.3 m extended (a 6 m telescope), ruddevators in a 42° V, 1.55 m span each;
#         contact envelope 20-40° down, ±10° (±15° max) across (US patents 4072283 / 7850121, USAF data)
#   MPRS: pods under the outer wings, ~70 ft / 21 m of hose on a KC-135 (FRL Mk 32B-753), ~0.7 m drogue
# Real size: length 41.53 m (with the stowed boom), span 39.88 m, height 12.70 m.
# s = metres aft of the nose, x right, z up (tools/aircraft_kit.py).
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import support_kit as SK
import aircraft_kit as K
from aircraft_kit import S

ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = ARGS[0], ARGS[1]
L = 41.53

SK.begin('kc135', L, paint='#7d858b', paint2='#737b81', radome='#2b2e31', dark='#1d1f21', nozzle='#4a4541')
K.material('Metal', '#b7babc', 0.75, 0.35)
K.material('Hose', '#1a1b1c', 0.1, 0.8)
K.material('Stripe', '#e4e2da', 0.1, 0.5)
air = SK.load(SRC, nose='+Y', weld_first=True)   # (welded first: decimation then collapses across the seams)
SK.fit(air, L)            # nose tip at s = 0; the file is already in metres (scale 0.9975)
obj = {o.name[len('src_'):]: o for o in air}
# the wing (with fin, stabilisers, nacelles) and the fuselage are far denser than the game needs: 77k → 45k triangles
SK.decimate(0.4, [obj['Object_27']], sym=True)
SK.decimate(0.6, [obj['Object_37']], sym=True)
SK.weld([obj['Object_27'], obj['Object_37']], angle=35)

# ── clean-up ──
# the model's boom (tube, nozzle, ruddevators) is part of the fuselage object: loose parts behind s 33.5 below the tail
SK.delete_loose(lambda a, b, n: -b.y > 33.5 and n < 400 and b.z < 1.3, [obj['Object_37']])
# the HF wire from the cockpit roof to the fin (thin, long): Object_32's long loose parts
SK.delete_loose(lambda a, b, n: (b - a).length > 8 and (b - a).x < 0.1 and n <= 200, [obj['Object_32']])
# unit markings of one real aircraft (the Kansas ANG "Free State Fueler" nose art, the ANG crest on the fin) and the
# subdued-flag decals that map as white squares: a generic AMC tanker keeps only the USAF titles, insignia and serial
SK.delete([obj['Object_38'], obj['Object_25'], obj['Object_33']])
# paint: the flat teal airframe → AMC grey with panel lines (box UVs); the rudder a shade darker; engine parts
SK.replace_material(r'^material_6$', 'Paint')
SK.replace_material(r'^material_12$', 'Paint2')
SK.replace_material(r'^material_(3|9)$', 'Nozzle')       # the yellow / lime exhaust parts
SK.replace_material(r'^material_4$', 'Metal')            # inlet lips
SK.replace_material(r'^material_(8|0|13)$', 'Dark')      # nacelle rings, green fin cap / antennas
for n in ('Object_27', 'Object_37', 'Object_28'):
    K._box_uv(obj[n], 8.0)

# ── flying boom (hinge under the aft fuselage, just aft of the boom operator's pod) ──
# Built horizontal along +s from the hinge, then turned about the hinge to its stowed angle; SK.part keeps geometry
# where it is, so the node carries the stow angle and the geometry lies along the node's own aft axis.
PIV = (33.95, 0.0, -0.62)
STOW = -8.5            # degrees about x: stowed with the tip up, tucked under the tail cone
TUBE = 6.75            # fixed boom, pivot → aft end
TELE = 1.25            # telescope showing when retracted (nozzle tip at TUBE + TELE ≈ 8.0 m from the hinge)
bs, bx, bz = PIV
def stowed(d):
    """kit coordinates of the point d metres along the stowed boom axis from the hinge"""
    a = math.radians(STOW)
    return (bs + d * math.cos(a), 0.0, bz - d * math.sin(a))
def stow_rotate(objs):
    from mathutils import Matrix, Vector
    P = Vector((PIV[1], K.Y(PIV[0]), PIV[2]))
    M = Matrix.Translation(P) @ Matrix.Rotation(math.radians(STOW), 4, 'X') @ Matrix.Translation(-P)
    for o in objs:
        o.data.transform(M)
boom_objs = []
# hinge fairing: a streamlined bullet around the hinge, blending into the belly
boom_objs.append(K.loft('BoomRoot', [S(bs - 0.9, 0.05, 0.05, z=bz + 0.05), S(bs - 0.5, 0.26, 0.22, z=bz + 0.04), S(bs + 0.2, 0.30, 0.26, z=bz),
                                     S(bs + 0.8, 0.26, 0.24, z=bz)], material='Paint', ring=24))
# fixed boom: a faired tube, slightly deeper than wide
boom_objs.append(K.loft('BoomTube', [S(bs + 0.6, 0.21, 0.23, z=bz), S(bs + 2.0, 0.2, 0.22, z=bz), S(bs + TUBE - 0.4, 0.17, 0.19, z=bz),
                                     S(bs + TUBE, 0.13, 0.14, z=bz)], material='Paint', ring=24))
# ruddevators: a 42° V above the boom near its aft end, 1.55 m span each
for side in (1, -1):
    dih = math.radians(42)
    root = (bs + TUBE - 1.35, bs + TUBE - 0.25, side * 0.16, bz + 0.1, 0.09)
    tip = (bs + TUBE - 0.75, bs + TUBE - 0.18, side * (0.16 + 1.55 * math.cos(dih)), bz + 0.1 + 1.55 * math.sin(dih), 0.08)
    boom_objs.extend(K.surface('Ruddevator' + ('R' if side > 0 else 'L'), [root, tip], material='Paint2', mirror=False, subdiv=1))
# boom operator's light and the black/white band markings near the aft end
boom_objs.append(K.loft('BoomBand', [S(bs + TUBE - 0.62, 0.176, 0.196, z=bz), S(bs + TUBE - 0.42, 0.172, 0.192, z=bz)], material='Stripe', ring=24, cap_front=False, cap_back=False))
# telescope: a bare-metal inner tube running well back inside the fixed boom, the nozzle on its end
tube = K.loft('BoomInner', [S(bs + TUBE - 5.8, 0.085, 0.085, z=bz), S(bs + TUBE + TELE - 0.45, 0.085, 0.085, z=bz)], material='Metal', ring=18)
nozzle = K.loft('BoomNozzle', [S(bs + TUBE + TELE - 0.5, 0.1, 0.1, z=bz), S(bs + TUBE + TELE - 0.3, 0.12, 0.12, z=bz), S(bs + TUBE + TELE - 0.12, 0.1, 0.1, z=bz),
                               S(bs + TUBE + TELE, 0.045, 0.045, z=bz)], material='Nozzle', ring=18)
collar = K.loft('BoomCollar', [S(bs + TUBE + TELE - 0.75, 0.098, 0.098, z=bz), S(bs + TUBE + TELE - 0.55, 0.098, 0.098, z=bz)], material='Stripe', ring=18)
ext_objs = [tube, nozzle, collar]
stow_rotate(boom_objs + ext_objs)
boom = SK.part('boom', boom_objs, PIV, rot=(STOW, 0, 0),
               props={'stow': -STOW, 'pitchMin': 20, 'pitchMax': 40, 'yawMax': 15, 'retracted': TUBE + TELE, 'extended': TUBE + TELE + 6.0})
ext = SK.part('boom_ext', ext_objs, stowed(TUBE), rot=(STOW, 0, 0), parent=boom, props={'travel': 6.0})
SK.empty('boom_nozzle', stowed(TUBE + TELE), parent=ext)

# ── Mk 32B-753 (MPRS) hose-and-drogue pods under the outer wings ──
PX = 17.3                              # pod station (m out from the centreline)
w = SK.section([obj['Object_27']], x=PX, pred=lambda p: 10 < -p.y < 31)
le, te, zlo, zhi = w
wing_low = zlo + 0.06                  # lower skin at mid-chord
PR = 0.39                              # pod radius
PZ = wing_low - 0.34 - PR              # pod axis height
P0, P1 = le - 0.35, le + 3.55          # pod nose / tail stations
print('MPRS pod: wing', w, 'axis z', PZ, 's', P0, P1)
pods = []
for side in (1, -1):
    x = side * PX
    pods.append(K.loft('MPRSPod' + ('R' if side > 0 else 'L'), [
        S(P0, 0.03, 0.03, x=x, z=PZ), S(P0 + 0.18, 0.13, 0.13, x=x, z=PZ), S(P0 + 0.55, 0.27, 0.27, x=x, z=PZ), S(P0 + 1.2, PR, PR, x=x, z=PZ),
        S(P1 - 0.9, PR, PR, x=x, z=PZ), S(P1 - 0.2, PR * 0.9, PR * 0.9, x=x, z=PZ), S(P1, PR * 0.84, PR * 0.84, x=x, z=PZ)],
        material='Paint', ring=28, cap_back=False))
    # the open tail: a dark hose tunnel with the stowed drogue's rim inside
    pods.append(K.loft('MPRSTail' + ('R' if side > 0 else 'L'), [S(P1 - 0.01, PR * 0.83, PR * 0.83, x=x, z=PZ), S(P1 - 0.5, PR * 0.7, PR * 0.7, x=x, z=PZ)],
                       material='Intake', ring=24, cap_front=False))
    pods.append(K.loft('MPRSDrogueRim' + ('R' if side > 0 else 'L'), [S(P1 - 0.18, PR * 0.66, PR * 0.66, x=x, z=PZ), S(P1 - 0.1, PR * 0.7, PR * 0.7, x=x, z=PZ)],
                       material='Stripe', ring=24, cap_front=False, cap_back=False))
    # pylon up to the wing's lower skin
    pods.extend(K.surface('MPRSPylon' + ('R' if side > 0 else 'L'), [(P0 + 1.0, P1 - 0.6, x, PZ + PR * 0.7, 0.07),
                                                                    (P0 + 0.6, P1 - 0.3, x, wing_low + 0.15, 0.08)], material='Paint', mirror=False, subdiv=1))
    # ram-air turbine on the nose (small four-blade propeller, feathered)
    pods.extend(K.propeller('MPRSRat' + ('R' if side > 0 else 'L'), P0 + 0.12, x, PZ, 0.3, blades=4, chord=0.07, spinner=0.07, spinner_len=0.2, pitch=60))

# the hose and drogue: drogue_<s> at the hose exit, hose_<s> 1 m long aft (stretched in the game), basket_<s> with its
# coupling at the rest position (inside the pod; it shows only once it trails out)
for side, sfx in ((1, 'r'), (-1, 'l')):
    x = side * PX
    hs = P1 - 0.3
    hose = K.loft('Hose' + sfx, [S(hs, 0.04, 0.04, x=x, z=PZ), S(hs + 1.0, 0.04, 0.04, x=x, z=PZ)], material='Hose', ring=10)
    # basket: coupling, then the canopy flaring out to ~0.7 m with ribs (a shuttlecock)
    cpl = K.loft('Coupling' + sfx, [S(hs - 0.02, 0.07, 0.07, x=x, z=PZ), S(hs + 0.12, 0.11, 0.11, x=x, z=PZ), S(hs + 0.3, 0.1, 0.1, x=x, z=PZ)], material='Metal', ring=16)
    canopy = K.loft('Canopy' + sfx, [S(hs + 0.28, 0.1, 0.1, x=x, z=PZ), S(hs + 0.55, 0.22, 0.22, x=x, z=PZ), S(hs + 0.85, 0.34, 0.34, x=x, z=PZ),
                                     S(hs + 0.9, 0.35, 0.35, x=x, z=PZ)], material='Stripe', ring=24, cap_front=False, cap_back=False)
    inner = K.loft('CanopyIn' + sfx, [S(hs + 0.3, 0.09, 0.09, x=x, z=PZ), S(hs + 0.86, 0.33, 0.33, x=x, z=PZ)], material='Dark', ring=24, cap_front=False, cap_back=False)
    d = SK.part('drogue_' + sfx, None, (hs, x, PZ), props={'hose': 21.0, 'droop': 5})
    SK.part('hose_' + sfx, [hose], (hs, x, PZ), parent=d)
    SK.part('basket_' + sfx, [cpl, canopy, inner], (hs, x, PZ), parent=d)

# engine exhausts (for the contrails): the aft-most point of each CFM56's exhaust parts
exh = []
for xe in (-14.2, -8.4, 8.4, 14.2):
    pts = [o.matrix_world @ v.co for o in (obj['Object_22'], obj['Object_23']) for v in o.data.vertices if abs((o.matrix_world @ v.co).x - xe) < 1.2]
    far = max(pts, key=lambda p: -p.y)
    zs = [p.z for p in pts if -p.y > -far.y - 0.4]
    exh.append((-far.y, xe, (min(zs) + max(zs)) / 2))
# (the airframe's receiver lights, antennas and the boom operator's pod come with the model)
SK.finish(OUT)
print('NOZZLES', [SK.frac(s, x, z) for s, x, z in exh])
print('COCKPIT', SK.frac(4.2, 0.0, 1.25))

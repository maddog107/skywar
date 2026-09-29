# ═══════════════════════════════════════════════════════════════
# Virginia-class SSN control room — the Command and Control Center — scripted model for Blender (headless):
#   blender -b -P tools/interiors/ssn_control.py -- models/interiors/ssn_control.glb
# Room frame: floor centre at the origin, x starboard, y up, −z forward (toward the bow). The game anchors it in the
# submarine (models/ships/ssn.glb) at ship-local (0, −4.3, −40): one deck down under the sail.
# Layout, from the Naval Submarine League's description of the Virginia's Command and Control Center (S. Lose,
# PMS450, 2004: archive.navalsubleague.org/2004/virginias-command-and-control-center-new-concepts-for-a-new-submarine),
# GlobalSecurity (ssn-774-design), Wikipedia (Virginia-class submarine, Photonics mast, AN/BQQ-10), SP's Naval
# Forces (photonics), and US Navy photographs on Wikimedia Commons (PCU Virginia's ship control panel, 040822-N-2653P-209;
# the photonics display, 040825-N-2653P-040; USS Texas plotting a course, 060825-N-7441H-013) and DVIDS (USS Texas
# 8859145, PCU Indiana control-room video 627423):
#   • the room sits on the middle deck, away from the hull's curve (the photonics masts don't pierce the hull)
#   • forward: the Ship Control System — pilot and co-pilot side by side, facing forward, flying the boat with
#     F-16-style joysticks on flat panels (it merges the old ship control and ballast control panels)
#   • above it: the two Vertical Large Screen Displays that the captain's Command Work Station drives, seen by all
#   • centre: the Command Work Station (captain / officer of the deck), with joystick control of the masts
#   • one step to port: sonar (AN/BQQ-10), the tactical support system; one step to starboard: fire control
#     (AN/BYG-1 combat control, the launcher control)
#   • aft of the captain: the horizontal navigation / plotting table, the photonics mast workstation (two positions,
#     two flat panels, keyboard, trackball and a hand controller each — USS Colorado's Xbox pads), the navigation
#     data display; starboard aft the radar and network console
#   • no red lighting on a Virginia (nothing optical to protect): white fixtures, dim purple-blue lights over the screens
# ═══════════════════════════════════════════════════════════════
import sys, os, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import roomkit as R
from roomkit import PI

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = args[0] if args else 'models/interiors/ssn_control.glb'

R.begin()
S = R.static()
X0, X1, Z0, Z1, H = -4.3, 4.3, -5.2, 5.0, 2.42
ART = [0]
def art():
    ART[0] = (ART[0] + 3) % 8
    return ART[0]

# ═════════════ the shell: deck, bulkheads (the upper part following the hull), the overhead ═════════════
R.shell(S, X0, X1, Z0, Z1, H, floor='Deck', wall='Wall', ceil='Ceiling', skip=('px', 'nx'))
for sx in (-1, 1):
    x = X1 * sx
    q = [(x, 0, Z0), (x, 1.55, Z0), (x, 1.55, Z1), (x, 0, Z1)]
    S.g('Wall').face(q, [(p[2], p[1]) for p in q], (-sx, 0, 0))
    prev = (x, 1.55)
    for (dx, y) in [(-0.1, 1.95), (-0.26, 2.25), (-0.4, H)]:
        nx = x + dx * sx
        q = [(prev[0], prev[1], Z0), (nx, y, Z0), (nx, y, Z1), (prev[0], prev[1], Z1)]
        S.g('Wall').face(q, [(p[2], p[1]) for p in q], (-sx, 0.3, 0))
        prev = (nx, y)
    z = Z0 + 0.45
    while z < Z1:
        R.uvbox(S, 'WallDark', min(x, x - 0.4 * sx), max(x, x - 0.4 * sx), 1.55, H, z - 0.05, z + 0.05)
        z += 0.9
# overhead: cable trays athwartships and fore-and-aft, pipe runs along the sides, fixtures, handholds, vents
for z in (-3.9, -1.9, 0.6, 3.3):
    R.tray(S, (X0 + 0.5, H - 0.12, z), (X1 - 0.5, H - 0.12, z), w=0.32)
for x in (-2.3, 2.3):
    R.tray(S, (x, H - 0.24, Z0 + 0.3), (x, H - 0.24, Z1 - 0.3), w=0.26)
for sx in (-1, 1):
    for k, (y, r, m) in enumerate([(2.0, 0.05, 'PipeBlue'), (2.1, 0.035, 'PipeWhite'), (2.18, 0.03, 'PipeGreen'), (1.88, 0.045, 'PipeWhite')]):
        x = sx * (X1 - 0.26 - k * 0.1)
        R.pipe(S, (x, y, Z0 + 0.1), (x, y, Z1 - 0.1), r, m)
    R.valve_wheel(S, (sx * (X1 - 0.33), 1.72, 3.7), yaw=sx * PI / 2, r=0.11, mat='Red')
for x in (-1.55, 0.0, 1.55):
    for z in (-2.9, -0.4, 2.1, 4.3):
        R.light_fixture(S, (x, H - 0.02, z), w=0.22, l=0.9, along='z')
# the dim purple-blue strips over the consoles
for sx in (-1, 1):
    for z in (-2.7, -1.25, 0.2):
        R.light_fixture(S, (sx * 3.25, H - 0.3, z), w=0.06, l=1.0, along='z', mat='LightBlue')
for z in (-2.9, 0.0, 2.8):
    R.handrail(S, (-0.9, H - 0.2, z), (0.9, H - 0.2, z), standoff=0.12)
for (x, z) in [(-1.2, -3.0), (1.2, -0.8), (-1.3, 3.6), (2.8, 1.3)]:
    R.uvbox(S, 'Steel', x - 0.3, x + 0.3, H - 0.05, H - 0.01, z - 0.15, z + 0.15)
    for k in range(5):
        R.uvbox(S, 'Black', x - 0.26, x + 0.26, H - 0.055, H - 0.05, z - 0.12 + k * 0.06, z - 0.1 + k * 0.06)
# forward bulkhead: a watertight door (dogged), electrical panels
R.uvbox(S, 'WallDark', -4.2, -3.2, 0.0, 2.05, Z0, Z0 + 0.05)
for (x, y) in [(-4.1, 0.3), (-4.1, 1.85), (-3.3, 0.3), (-3.3, 1.85)]:
    R.uvbox(S, 'Metal', x - 0.04, x + 0.04, y - 0.05, y + 0.05, Z0 + 0.05, Z0 + 0.09)
R.label('FR 26 — 2-26-1-Q', (-3.7, 2.15, Z0 + 0.06), 0, 0, h=0.05, st='y')
for x in (3.0, 3.65):
    R.uvbox(S, 'ConsoleLight', x - 0.28, x + 0.28, 0.9, 1.95, Z0, Z0 + 0.2)
    R.uvbox(S, 'Bezel', x - 0.22, x + 0.22, 1.2, 1.85, Z0 + 0.2, Z0 + 0.21)
    R.switch_bank(S, R.mat3(0), (x, 1.52, Z0 + 0.212), cols=5, rows=4, pitch=0.07)
    R.label('LOAD CENTER %d' % (1 if x < 3.3 else 2), (x, 1.9, Z0 + 0.212), 0, 0, h=0.03, st='b')

# ═════════════ ship control (forward) and the two vertical large screen displays above it ═════════════
M, A = R.console(S, 0.0, -4.45, yaw=0.0, w=2.9, h_desk=0.74, d=0.78, upper=0.6, tilt_upper=0.22, mat='Console')
Mu, cu = A['upper']
for i, xx in enumerate((-1.06, -0.36, 0.36, 1.06)):
    name = ('screen_scs_l', 'screen_scs_c1', 'screen_scs_c2', 'screen_scs_r')[i]
    R.monitor(S, name, R.xf(Mu, cu, (xx, 0.02, 0.0)), 0.0, 0.22, w=0.62, h=0.38, depth=0.02, bezel=0.03, px=(1024, 640))
Md, cd = A['desk']
for sx in (-1.1, 1.1):
    base = R.xf(Md, cd, (sx, 0.0, 0.05))
    R.obox(S, 'Bezel', Md, base, -0.07, 0.07, 0.0, 0.03, -0.07, 0.07)
    R.ocyl(S, 'Black', Md, base, (0, 0, 0), 0.018, 0.02, 0.03, 0.2, 10, axis='y')
    R.obox(S, 'Black', Md, base, -0.035, 0.035, 0.17, 0.3, -0.03, 0.03)
    R.obox(S, 'Red', Md, base, -0.012, 0.012, 0.3, 0.315, -0.012, 0.012)
    R.keyboard(S, Md, R.xf(Md, cd, (sx * 0.6, 0.0, 0.12)), w=0.38, d=0.14)
# the hard controls between the seats (a panel tilted up toward both)
Mp = R.mat3(0.0, 0.55)
cp = R.xf(Md, cd, (0.0, 0.1, -0.02))
R.obox(S, 'Panel', Mp, cp, -0.32, 0.32, -0.16, 0.16, -0.06, 0.0)
R.lever('lever_speed', R.xf(Mp, cp, (-0.22, -0.02, 0.0)), 0.0, 0.55, length=0.13, steps=7, arc=1.2)
R.label('ENGINE ORDER', R.xf(Mp, cp, (-0.22, 0.13, 0.001)), 0.0, 0.55, h=0.018, st='e')
R.knob('knob_rudder', R.xf(Mp, cp, (-0.03, 0.04, 0.0)), 0.0, 0.55, r=0.026, steps=7, arc=3.0)
R.label('RUDDER', R.xf(Mp, cp, (-0.03, 0.1, 0.001)), 0.0, 0.55, h=0.016, st='e')
R.knob('knob_depth', R.xf(Mp, cp, (0.12, 0.04, 0.0)), 0.0, 0.55, r=0.026, steps=6, arc=3.6)
R.label('ORDERED DEPTH', R.xf(Mp, cp, (0.12, 0.1, 0.001)), 0.0, 0.55, h=0.016, st='e')
R.button('btn_dive', R.xf(Mp, cp, (0.04, -0.08, 0.0)), 0.0, 0.55, r=0.017, mat='Green')
R.label('DIVE', R.xf(Mp, cp, (0.04, -0.12, 0.001)), 0.0, 0.55, h=0.014, st='e')
R.button('btn_surface', R.xf(Mp, cp, (0.14, -0.08, 0.0)), 0.0, 0.55, r=0.017, mat='Yellow')
R.label('SURFACE', R.xf(Mp, cp, (0.14, -0.12, 0.001)), 0.0, 0.55, h=0.014, st='e')
R.button('btn_blow', R.xf(Mp, cp, (0.25, -0.06, 0.0)), 0.0, 0.55, r=0.02, mat='Red')
R.guard('guard_blow', R.xf(Mp, cp, (0.25, -0.06 + 0.035, 0.0)), 0.0, 0.55, w=0.065, h=0.07, d=0.045)
R.label('EMERG BLOW', R.xf(Mp, cp, (0.25, -0.135, 0.001)), 0.0, 0.55, h=0.014, st='r')
R.toggle('sw_rig', R.xf(Mp, cp, (-0.08, -0.1, 0.0)), 0.0, 0.55)
R.label('RIG FOR DIVE', R.xf(Mp, cp, (-0.08, -0.135, 0.001)), 0.0, 0.55, h=0.013, st='e')
R.lamp('lamp_hull', R.xf(Mp, cp, (-0.15, -0.1, 0.0)), 0.0, 0.55, r=0.011, color='#30ff60', mat='LampGreen')
R.lamp('lamp_depth', R.xf(Mp, cp, (0.05, 0.12, 0.0)), 0.0, 0.55, r=0.009, color='#ffb020', mat='LampAmber')
R.label('SHIP CONTROL', R.xf(Mu, cu, (0.0, 0.345, 0.0)), 0.0, 0.22, h=0.045, st='w')
for k, (nm, lb) in enumerate([('sw_mast_esm', 'ESM'), ('sw_mast_hdr', 'SATCOM'), ('sw_mast_comms', 'COMMS'), ('sw_mast_radar', 'RADAR')]):
    R.toggle(nm, R.xf(Mu, cu, (1.46, 0.2 - k * 0.1, 0.0)), 0.0, 0.22)
    R.label(lb, R.xf(Mu, cu, (1.46, 0.2 - k * 0.1 - 0.035, 0.0)), 0.0, 0.22, h=0.014, st='e')
R.label('MASTS', R.xf(Mu, cu, (1.46, 0.27, 0.0)), 0.0, 0.22, h=0.018, st='e')
for sx in (-0.72, 0.72):
    R.chair(S, (sx, 0.0, -3.5), 0.0, kind='ship', mat='SeatBlue', h=0.5)
R.label('PILOT', (-0.72, 0.47, -3.26), 0.0, 0.0, h=0.03, st='w')
R.label('CO-PILOT', (0.72, 0.47, -3.26), 0.0, 0.0, h=0.03, st='w')
R.station('stand_scs', (0.0, 1.28, -3.1), yaw=0.0, pitch=-0.24, fov=60)
# the VLSDs: two big panels on the forward bulkhead over ship control, a frame round them
for i, x in enumerate((-0.72, 0.72)):
    R.monitor(S, 'screen_vlsd_%d' % (i + 1), (x, 1.9, Z0 + 0.12), 0.0, 0.0, w=1.3, h=0.8, depth=0.1, bezel=0.035, px=(1024, 640), bright=1.15)
R.uvbox(S, 'Bezel', -1.5, 1.5, 1.44, 1.47, Z0 + 0.02, Z0 + 0.2)
R.label('VLSD 1', (-0.72, 1.4, Z0 + 0.21), 0, 0, h=0.025, st='e')
R.label('VLSD 2', (0.72, 1.4, Z0 + 0.21), 0, 0, h=0.025, st='e')

# ═════════════ the command work station (centre): captain / officer of the deck ═════════════
M2, A2 = R.console(S, 0.0, -1.55, yaw=0.0, w=2.1, h_desk=0.76, d=0.72, upper=0.42, tilt_upper=0.3, mat='Console')
Mu2, cu2 = A2['upper']
R.monitor(S, 'screen_cws_1', R.xf(Mu2, cu2, (-0.5, 0.02, 0.0)), 0.0, 0.3, w=0.62, h=0.36, depth=0.02, bezel=0.025, px=(1024, 600))
R.monitor(S, 'screen_cws_2', R.xf(Mu2, cu2, (0.5, 0.02, 0.0)), 0.0, 0.3, w=0.62, h=0.36, depth=0.02, bezel=0.025, px=(1024, 600))
Md2, cd2 = A2['desk']
R.keyboard(S, Md2, R.xf(Md2, cd2, (-0.5, 0.0, 0.12)), w=0.4, d=0.14)
R.trackball(S, Md2, R.xf(Md2, cd2, (-0.05, 0.0, 0.14)))
# the mast joystick and the hard buttons: raise / lower each photonics mast, take a mast full screen
jb = R.xf(Md2, cd2, (0.25, 0.0, 0.08))
R.obox(S, 'Bezel', Md2, jb, -0.06, 0.06, 0.0, 0.03, -0.06, 0.06)
R.ocyl(S, 'Black', Md2, jb, (0, 0, 0), 0.016, 0.018, 0.03, 0.17, 10, axis='y')
R.obox(S, 'Black', Md2, jb, -0.03, 0.03, 0.15, 0.25, -0.025, 0.025)
Mb = R.mat3(0.0, 0.62)
bp = R.xf(Md2, cd2, (0.66, 0.06, -0.08))
R.obox(S, 'Panel', Mb, bp, -0.22, 0.22, -0.1, 0.1, -0.04, 0.0)
for i in range(2):
    y = 0.045 - i * 0.075
    R.button('btn_mast_%d' % (i + 1), R.xf(Mb, bp, (-0.14, y, 0.0)), 0.0, 0.62, r=0.016, mat='Yellow', square=True)
    R.lamp('lamp_mast_%d' % (i + 1), R.xf(Mb, bp, (-0.06, y, 0.0)), 0.0, 0.62, r=0.009, color='#30ff60', mat='LampGreen')
    R.button('btn_view_%d' % (i + 1), R.xf(Mb, bp, (0.12, y, 0.0)), 0.0, 0.62, r=0.016, mat='Green', square=True)
    R.label('PM%d  RAISE/LOWER    VIEW' % (i + 1), R.xf(Mb, bp, (0.0, y - 0.03, 0.001)), 0.0, 0.62, h=0.012, st='e')
R.label('COMMAND WORK STATION', R.xf(Mu2, cu2, (0.0, 0.25, 0.0)), 0.0, 0.3, h=0.035, st='w')
R.chair(S, (-0.5, 0.0, -0.7), 0.0, kind='ship', mat='Leather', h=0.52)
R.chair(S, (0.5, 0.0, -0.7), 0.0, kind='ship', mat='SeatBlue', h=0.5)
R.station('stand_cws', (0.0, 1.25, -0.62), yaw=0.0, pitch=-0.16, fov=64)
R.label('CO', (-0.5, 0.49, -0.45), 0.0, 0.0, h=0.03, st='w')
R.label('OOD', (0.5, 0.49, -0.45), 0.0, 0.0, h=0.03, st='w')

# ═════════════ side consoles: sonar to port, combat control to starboard ═════════════
def side_console(side, z, name, title, k):
    yaw = PI / 2 if side < 0 else -PI / 2
    x = side * 3.5
    Mx, Ax = R.console(S, x, z, yaw=yaw, w=1.32, h_desk=0.74, d=0.78, upper=0.72, tilt_upper=0.18, mat='Console')
    Mux, cux = Ax['upper']
    R.monitor(S, name, R.xf(Mux, cux, (0.0, 0.14, 0.0)), yaw, 0.18, w=0.64, h=0.4, depth=0.02, bezel=0.025, px=(1024, 640))
    if not (side > 0 and k == 3):
        R.monitor(S, None, R.xf(Mux, cux, (0.0, -0.22, 0.0)), yaw, 0.18, w=0.52, h=0.18, depth=0.02, bezel=0.02, art=art())
    Mdx, cdx = Ax['desk']
    R.keyboard(S, Mdx, R.xf(Mdx, cdx, (-0.12, 0.0, 0.1)), w=0.42, d=0.15)
    R.trackball(S, Mdx, R.xf(Mdx, cdx, (0.34, 0.0, 0.1)))
    R.label(title, R.xf(Mux, cux, (0.0, 0.42, 0.0)), yaw, 0.18, h=0.034, st='w')
    R.chair(S, R.xf(Mx, (x, 0, z), (0.0, 0.0, 0.95)), yaw, kind='ship', mat='SeatBlue', h=0.5)
    return Mx, (x, 0, z)
SON = [(-2.7, 'screen_sonar_wf', 'SONAR · BROADBAND'), (-1.25, 'screen_sonar_tac', 'SONAR · CONTACTS'), (0.2, 'screen_sonar_nb', 'SONAR · NARROWBAND')]
for k, (z, name, title) in enumerate(SON):
    Mx, o = side_console(-1, z, name, title, k + 1)
    R.station('stand_sonar%d' % (k + 1), R.xf(Mx, o, (0.0, 1.2, 0.95)), yaw=PI / 2, pitch=-0.18, fov=56)
    R.obox(S, 'Black', Mx, R.xf(Mx, o, (0.7, 0.9, 0.1)), -0.01, 0.01, -0.08, 0.02, -0.06, 0.06)   # a headset on its hook
FC = [(-2.7, 'screen_fc_tgt', 'COMBAT CONTROL · TARGETS'), (-1.25, 'screen_fc_wpn', 'COMBAT CONTROL · WEAPONS'), (0.2, 'screen_fc_launch', 'LAUNCHER CONTROL')]
for k, (z, name, title) in enumerate(FC):
    Mx, o = side_console(1, z, name, title, k + 1)
    R.station('stand_fc%d' % (k + 1), R.xf(Mx, o, (0.0, 1.2, 0.95)), yaw=-PI / 2, pitch=-0.18, fov=56)
# the launcher control's hard panel: weapon key, the sequence, the three ready lamps, FIRE under its guard
Mx = R.mat3(-PI / 2, 0.0)
Mk = R.mat3(-PI / 2, 0.5)
kc = R.xf(Mx, (3.5, 0, 0.2), (0.0, 0.86, -0.2))
R.obox(S, 'Panel', Mk, kc, -0.5, 0.5, -0.11, 0.11, -0.05, 0.0)
R.keyswitch('sw_key', R.xf(Mk, kc, (-0.42, 0.02, 0.0)), -PI / 2, 0.5)
R.label('WEAPON KEY', R.xf(Mk, kc, (-0.42, -0.06, 0.001)), -PI / 2, 0.5, h=0.014, st='e')
for j, (nm, lb, m) in enumerate([('btn_spinup', 'SPIN UP', 'Blue'), ('btn_fpp', 'FIRING POINT', 'Yellow'), ('btn_muzzle', 'MUZZLE HATCH', 'Orange'), ('btn_abort', 'ABORT', 'White')]):
    x = -0.26 + j * 0.13
    R.button(nm, R.xf(Mk, kc, (x, 0.02, 0.0)), -PI / 2, 0.5, r=0.018, mat=m, square=True)
    R.label(lb, R.xf(Mk, kc, (x, -0.055, 0.001)), -PI / 2, 0.5, h=0.012, st='e')
for j, (nm, lb) in enumerate([('lamp_ship', 'SHIP'), ('lamp_weapon', 'WEAPON'), ('lamp_solution', 'SOLUTION')]):
    x = 0.17 + j * 0.075
    R.lamp(nm, R.xf(Mk, kc, (x, 0.05, 0.0)), -PI / 2, 0.5, r=0.012, color='#30ff60', mat='LampGreen', square=True)
    R.label(lb, R.xf(Mk, kc, (x, 0.0, 0.001)), -PI / 2, 0.5, h=0.011, st='e')
R.button('btn_fire', R.xf(Mk, kc, (0.42, 0.0, 0.0)), -PI / 2, 0.5, r=0.024, mat='Red')
R.guard('guard_fire', R.xf(Mk, kc, (0.42, 0.045, 0.0)), -PI / 2, 0.5, w=0.075, h=0.085, d=0.05)
R.label('FIRE', R.xf(Mk, kc, (0.42, -0.07, 0.001)), -PI / 2, 0.5, h=0.016, st='r')

# ═════════════ aft of the captain: navigation table, photonics mast workstation, navigation data, radar ═════════════
R.uvbox(S, 'Console', -0.8, 0.8, 0.0, 0.9, 1.75, 2.75)
R.uvbox(S, 'Bezel', -0.85, 0.85, 0.9, 0.95, 1.7, 2.8)
R.screen('screen_nav', (0.0, 0.955, 2.25), 0.0, PI / 2, w=1.5, h=0.9, px=(1024, 614), bright=1.05)
R.handrail(S, (-0.9, 0.92, 1.7), (-0.9, 0.92, 2.8), standoff=0.0)
R.handrail(S, (0.9, 0.92, 1.7), (0.9, 0.92, 2.8), standoff=0.0)
R.label('NAVIGATION PLOT', (0.0, 0.72, 2.81), 0.0, 0.0, h=0.04, st='w')
R.station('stand_nav', (0.0, 1.62, 3.2), yaw=0.0, pitch=-1.0, fov=58)
# the photonics mast workstation: two positions, two panels each, keyboard, trackball, the hand controllers
M5, A5 = R.console(S, -2.35, 2.25, yaw=0.0, w=2.1, h_desk=0.74, d=0.75, upper=0.5, tilt_upper=0.2, mat='Console')
Mu5, cu5 = A5['upper']
Md5, cd5 = A5['desk']
for i, xx in enumerate((-0.5, 0.5)):
    R.monitor(S, 'screen_photon_%d' % (i + 1), R.xf(Mu5, cu5, (xx - 0.14 if i == 0 else xx + 0.14, 0.04, 0.0)), 0.0, 0.2, w=0.56, h=0.34, depth=0.02, bezel=0.022, px=(1024, 600), bright=1.1)
    R.monitor(S, None, R.xf(Mu5, cu5, (xx + 0.3 if i == 0 else xx - 0.3, 0.04, 0.0)), 0.0, 0.2, w=0.24, h=0.34, depth=0.02, bezel=0.02, art=art())
    R.keyboard(S, Md5, R.xf(Md5, cd5, (xx - 0.1, 0.0, 0.12)), w=0.36, d=0.13)
    pad = R.xf(Md5, cd5, (xx + 0.25, 0.0, 0.12))
    R.obox(S, 'Black', Md5, pad, -0.075, 0.075, 0.0, 0.032, -0.05, 0.04)
    for gx in (-0.045, 0.045):
        R.ocyl(S, 'Black', Md5, pad, (gx, 0, 0.02), 0.028, 0.024, 0.0, 0.03, 10, axis='y')
    R.obox(S, 'Green', Md5, pad, 0.03, 0.04, 0.032, 0.036, -0.02, -0.01)
    R.chair(S, (-2.35 + xx, 0.0, 3.2), 0.0, kind='ship', mat='SeatBlue', h=0.5)
    R.station('stand_photon_%d' % (i + 1), (-2.35 + xx, 1.2, 3.25), yaw=0.0, pitch=-0.2, fov=55)
R.label('PHOTONICS MAST WORKSTATION', R.xf(Mu5, cu5, (0.0, 0.3, 0.0)), 0.0, 0.2, h=0.034, st='w')
# navigation data display (NDDD)
M6, A6 = R.console(S, 2.3, 2.25, yaw=0.0, w=1.3, h_desk=0.74, d=0.75, upper=0.5, tilt_upper=0.2, mat='Console')
Mu6, cu6 = A6['upper']
R.monitor(S, 'screen_nddd', R.xf(Mu6, cu6, (0.0, 0.04, 0.0)), 0.0, 0.2, w=0.62, h=0.36, depth=0.02, bezel=0.022, px=(1024, 600))
R.keyboard(S, A6['desk'][0], R.xf(A6['desk'][0], A6['desk'][1], (0.0, 0.0, 0.12)), w=0.4, d=0.14)
R.label('NAVIGATION DATA', R.xf(Mu6, cu6, (0.0, 0.3, 0.0)), 0.0, 0.2, h=0.034, st='w')
R.chair(S, (2.3, 0.0, 3.2), 0.0, kind='ship', mat='SeatBlue', h=0.5)
R.station('stand_nddd', (2.3, 1.2, 3.25), yaw=0.0, pitch=-0.2, fov=55)
# radar and network console in the starboard aft corner
M7, A7 = R.console(S, 3.55, 4.1, yaw=-PI / 2, w=1.1, h_desk=0.74, d=0.7, upper=0.62, tilt_upper=0.18, mat='Console')
Mu7, cu7 = A7['upper']
R.monitor(S, 'screen_radar', R.xf(Mu7, cu7, (0.0, 0.1, 0.0)), -PI / 2, 0.18, w=0.5, h=0.44, depth=0.02, bezel=0.025, px=(768, 672))
R.label('RADAR · NETWORK', R.xf(Mu7, cu7, (0.0, 0.4, 0.0)), -PI / 2, 0.18, h=0.03, st='w')
R.chair(S, R.xf(M7, (3.55, 0, 4.1), (0.0, 0.0, 0.9)), -PI / 2, kind='ship', mat='SeatBlue', h=0.5)
R.station('stand_radar', R.xf(M7, (3.55, 0, 4.1), (0.0, 1.2, 0.9)), yaw=-PI / 2, pitch=-0.15, fov=55)

# ═════════════ aft: the ladder to the escape trunk, racks, a lighting panel, the 1MC, damage control ═════════════
R.exit_node('exit_ladder', (-3.35, 0.0, 4.45), yaw=0.0, w=0.62, h=H - 0.05, kind='hatch', label_text='ESCAPE TRUNK · UP')
R.uvbox(S, 'Yellow', -3.8, -2.9, 0.0, 0.01, 4.0, 4.9)
for x in (-1.9, -1.15, -0.4, 0.35, 1.1):
    R.uvbox(S, 'ConsoleLight', x - 0.36, x + 0.36, 0.0, 2.0, 4.55, Z1)
    R.uvbox(S, 'Bezel', x - 0.3, x + 0.3, 0.25, 1.8, 4.54, 4.55)
    R.switch_bank(S, R.mat3(PI), (x, 1.5, 4.535), cols=6, rows=3, pitch=0.06)
    R.label('CABINET %d' % int((x + 2.65) / 0.75), (x, 1.9, 4.535), PI, 0.0, h=0.04, st='b')
R.obox(S, 'Panel', R.mat3(PI), (1.85, 1.3, 4.9), -0.18, 0.18, -0.12, 0.12, -0.03, 0.0)
R.toggle('sw_lights', (1.85, 1.32, 4.87), PI, 0.0)
R.label('LIGHTING  NORMAL / NIGHT', (1.85, 1.22, 4.869), PI, 0.0, h=0.016, st='e')
S.beam('Black', (2.2, 1.3, 4.95), (2.2, 1.45, 4.95), 0.04)
R.label('1MC', (2.2, 1.52, 4.94), PI, 0.0, h=0.025, st='y')
R.uvbox(S, 'Red', 4.0, 4.28, 0.6, 1.8, -0.4, 0.1)
R.label('DC LOCKER', (3.99, 1.9, -0.15), -PI / 2, 0.0, h=0.05, st='r')
for (x, z) in [(-4.15, 1.4), (4.15, -3.6)]:
    R.ocyl(S, 'Red', R.mat3(0), (x, 0.0, z), (0, 0, 0), 0.08, 0.08, 0.3, 0.85, 12, axis='y')
for z in (-3.5, -0.8, 1.7, 4.0):
    R.pipe(S, (-1.0, H - 0.34, z), (1.0, H - 0.34, z), 0.022, 'PipeYellow', 8, flanges=False)
    for x in (-0.6, 0.0, 0.6):
        S.beam('Yellow', (x, H - 0.34, z), (x, H - 0.42, z), 0.04)
R.label('EAB', (0.0, H - 0.46, -0.79), 0.0, 0.0, h=0.03, st='y')

R.spawn((-2.8, 0.0, 3.85), yaw=-0.5)
R.finish(OUT, {
    'walk': [
        [X0 + 1.45, X1 - 1.45, -3.1, 1.2, 0.0],       # the centre, between the side consoles
        [-2.0, 2.0, -3.25, -2.3, 0.0],                # behind ship control
        [X0 + 1.45, X1 - 1.45, -3.25, -3.1, 0.0],
        [X0 + 0.35, X1 - 0.35, 1.2, 1.7, 0.0],         # the cross passage forward of the aft consoles
        [-1.35, 1.35, 1.2, 4.35, 0.0],                 # round the nav table (the table itself is a hole)
        [X0 + 0.35, -1.25, 3.05, 4.35, 0.0],          # behind the photonics workstation, to the ladder
        [1.25, 3.0, 3.05, 4.35, 0.0],
    ],
    'holes': [[-0.85, 0.85, 1.7, 2.8]],
    'eye': 1.64, 'bg': '#030405',
    'lights': [
        {'t': 'hemi', 'sky': '#b8c6d4', 'ground': '#2a2e33', 'i': 0.6, 'name': 'amb'},
        {'t': 'point', 'p': [0.0, 2.25, -3.1], 'c': '#eef3ff', 'i': 7, 'd': 7.5, 'name': 'l1'},
        {'t': 'point', 'p': [-2.5, 2.25, -1.2], 'c': '#eef3ff', 'i': 6, 'd': 7, 'name': 'l2'},
        {'t': 'point', 'p': [2.5, 2.25, -1.2], 'c': '#eef3ff', 'i': 6, 'd': 7, 'name': 'l3'},
        {'t': 'point', 'p': [0.0, 2.25, 2.6], 'c': '#eef3ff', 'i': 7, 'd': 7.5, 'name': 'l4'},
        {'t': 'point', 'p': [-2.4, 2.1, 3.9], 'c': '#c8b8ff', 'i': 3, 'd': 5, 'name': 'l5'},
    ],
})

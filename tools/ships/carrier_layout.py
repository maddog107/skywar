# ═══════════════════════════════════════════════════════════════
# Carrier layout — the single source of truth shared by the texture generator
# (ship_textures.py, plain python3 + Pillow) and the Blender model script
# (carrier_model.py). Everything is in the GAME's ship-local frame (metres):
#   x  across, starboard +          (three.js / naval.js "lx")
#   y  up, 0 = waterline            (flight deck at DECK_Y, the gameplay deckY)
#   z  along, bow −, stern +        (naval.js "lz")
# Gameplay constraints this layout keeps (see naval.js / aircraft.js / autopilot.js):
#   • flight deck top y = 19 (TYPES.carrier.deckY), inside the old walkable rectangle
#     x ∈ [−42, 34], z ∈ [−160, 160] (deck centre offset −4, B = 76, L = 320)
#   • catapult spot (12, −6.4): cat 1 runs from there straight to the bow
#   • autopilot touchdown (−4, 128), rollout along x = −4 to about z = 30:
#     the angled landing area and the wires sit on that lane
#   • island near x ≈ 21, z ≈ 26 (hitTest box), CIWS / SAM sponsons at the deck edge
# Nimitz-class reference: LOA 333 m, flight deck width 76.8 m, waterline beam 40.8 m,
# draft ~11.3 m, flight deck ~19 m above the waterline, 4 deck-edge elevators,
# angled deck ~9°, island on the starboard side a little aft of midships.
# ═══════════════════════════════════════════════════════════════
import math

L = 320.0
DECK_Y = 19.0          # flight deck surface
DECK_T = 0.7           # flight deck plate thickness (visual)
GALLERY_Y = 15.6       # underside of the deck-edge fascia / sponson tops
HANGAR_Y = 10.8        # hangar deck (bottom of the hangar-bay openings)
DRAFT = 11.0           # keel depth below the waterline
TEX_X0, TEX_X1 = -42.0, 34.0   # deck texture covers this rectangle (u)
TEX_Z0, TEX_Z1 = -160.0, 160.0  # … and this one (v; bow at the top of the image)

# ── Flight-deck outline (edges as piecewise-linear functions of z, bow → stern) ──
PORT_EDGE = [
    (-160.0, -12.5), (-156.0, -16.0), (-148.0, -19.5), (-136.0, -21.5),
    (-74.0, -22.5),                      # forward deck ends; the angled-deck sponson flares out
    (-46.0, -42.0),                      # forward port corner of the angled deck
    (58.0, -30.0),                       # angled-deck edge runs aft converging (~6.6°)
    (150.0, -27.0), (156.0, -25.5), (160.0, -23.5),
]
STBD_EDGE = [
    (-160.0, 13.5), (-156.0, 16.5), (-148.0, 19.5), (-138.0, 21.0),
    (150.0, 21.0), (156.0, 20.0), (160.0, 18.5),
]

def edge_at(edge, z):
    if z <= edge[0][0]:
        return edge[0][1]
    for (z0, x0), (z1, x1) in zip(edge, edge[1:]):
        if z <= z1:
            t = (z - z0) / (z1 - z0)
            return x0 + (x1 - x0) * t
    return edge[-1][1]

# deck-edge elevators (x0, x1, z0, z1); the tops are flush with the flight deck
ELEVATORS = [
    (21.0, 34.0, -100.0, -78.0),   # 1  starboard, forward
    (21.0, 34.0, -66.0, -44.0),    # 2  starboard, ahead of the island
    (21.0, 34.0, 58.0, 80.0),      # 3  starboard, abaft the island
    (-42.0, -29.5, 70.0, 92.0),    # 4  port, aft (angled-deck edge)
]

# island base (x0, x1, z0, z1): sits on its own sponson, overhanging the starboard edge
ISLAND = (13.0, 25.0, 10.0, 46.0)
ISLAND_SPONSON = (21.0, 25.5, 6.0, 50.0)

# ── Angled landing area ──
ANGLE_DEG = 8.0
ANGLE = math.radians(ANGLE_DEG)
LA_STERN_X = 1.0           # centreline crosses the ramp here
LA_HALF_W = 12.5           # half width of the landing area
LA_FWD_Z = -32.0           # forward end of the landing area (on the centreline)

def la_center_x(z):
    """x of the angled-deck centreline at z (it runs forward and to port)."""
    return LA_STERN_X - (160.0 - z) * math.tan(ANGLE)

# unit vectors in (x, z): along the landing direction (towards the bow) and across it (to starboard)
LA_DIR = (-math.sin(ANGLE), -math.cos(ANGLE))
LA_PERP = (math.cos(ANGLE), -math.sin(ANGLE))

# arresting wires: z where each crosses the centreline (1 = aft-most); span across the landing area
WIRES_Z = [138.0, 126.0, 114.0, 102.0]
WIRE_HALF = 15.0

def wire_ends(i):
    z = WIRES_Z[i]
    cx = la_center_x(z)
    return ((cx - LA_PERP[0] * WIRE_HALF, z - LA_PERP[1] * WIRE_HALF),
            (cx + LA_PERP[0] * WIRE_HALF, z + LA_PERP[1] * WIRE_HALF))

# ── Catapults (x, z_start, z_end); cat 1 is the gameplay one ──
CATS = [
    (12.0, -2.0, -157.0),     # 1  bow, starboard — the player's (spawn at z = −6.4)
    (-6.0, -62.0, -157.0),    # 2  bow, port
    (-25.0, 14.0, -52.0),     # 3  waist
    (-35.0, 26.0, -44.0),     # 4  waist, outboard
]
CAT_SPAWN = (12.0, -6.4)
# jet blast deflectors: (x centre, z hinge, width, raised?) — hinged at z, raised panel leans aft
JBDS = [
    (12.0, 3.2, 11.0, True),
    (-6.0, -56.0, 11.0, False),
    (-25.0, 19.0, 11.0, False),
    (-35.0, 31.0, 10.0, False),
]

# ── Sponsons with weapon mounts: (type, x, z); mount base at GALLERY_Y ──
MOUNTS = [
    ('ciws', 26.0, -124.0),    # starboard bow
    ('sam', -26.0, -114.0),    # port bow (RAM)
    ('ciws', -34.0, 146.0),    # port quarter
    ('sam', 25.5, 132.0),      # starboard quarter (Sea Sparrow)
    ('ciws', -46.0, -36.0),    # angled-deck forward corner
]

# Fresnel lens (optical landing system) on the port deck edge abeam the wires, LSO platform aft of it
LENS = (-29.8, 112.0)
LSO = (-27.0, 140.0)

# parked aircraft for naval.js: (type, x, z, yaw) — yaw is three.js rotation.y (0 = nose to the bow,
# + turns the nose to port). Kept off cat 1 (x 6..18), the landing lane (x −10..2, z > 20) and the
# landing area.
PARKED = [
    ('fa18', 27.5, -89.0, 0.95),    # on elevator 1, tail over the side
    ('f14', 27.5, -55.0, 0.95),     # on elevator 2
    ('fa18', 27.5, 69.0, 0.95),     # on elevator 3
    ('fa18', -15.5, -128.0, -0.95), # bow, port side, tails over the port edge
    ('f14', -15.5, -108.0, -0.95),
    ('fa18', 16.0, 56.0, 0.75),     # the "junkyard" just aft of the island
]

# ── Hull ──
BEAM_WL = 20.2           # waterline half-beam
BOOT_LO, BOOT_HI = -1.0, 1.5   # black boot-topping band (anti-fouling red below)

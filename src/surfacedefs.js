// ═══════════════════════════════════════════════════════════════
// Where each aircraft's flaps and speed brakes are on its model (cut out by surfaces.js).
// Model space: x to the right wing, y up, the nose toward −z, the model centred on its bounding box; every
// number is a fraction of the aircraft's length (so 0.05 on a 19.4 m F-15 is 0.97 m). Read positions off
// the grid in tools/aircraft/preview.js blueprint().
//
// A surface describes the right-hand (+x) one; it is mirrored for the left unless mirror: false.
//   top: [[x, z], ...]  convex outline seen from above, with y: [lo, hi] the height band it takes
//   side: [[z, y], ...] convex outline seen from the side, with x: [lo, hi] the band across
//   hinge: [[x, y, z], [x, y, z]]  the hinge line
//   angle: degrees at full travel. About a hinge running along x: positive takes the part aft of the hinge
//          down (flaps), negative raises it (spoilers, a dorsal brake). Along y: positive swings the aft part
//          outboard.
//   slide: [x, y, z]  translation at full travel (Fowler flaps run aft as they go down)
//   skin: 0 (default) cut through the whole thickness, walls close the cut (flaps); +1 / −1 a panel of the
//         upper / lower skin (outer / inner for a side outline), a floor `depth` below closes the bay
//   depth: bay depth for a skin panel (default 0.004)
// travel: { flap, brake } seconds for full travel, when it differs from the category default (surfaces.js)
// Flap notches: the game has two (takeoff, landing); a surface's angle is its landing (full) deflection and
// the takeoff notch is half of it. How to measure and check a new aircraft: tools/aircraft/SURFACES.md.
// ═══════════════════════════════════════════════════════════════
export const SURFACE_DEFS = {
    // F-15C: plain flaps inboard of the ailerons (hinge on the texture's panel line); the big dorsal speed
    // brake behind the canopy, hinged at its front, opening to 45°
    f15: {
        flaps: [{ top: [[0.108, 0.231], [0.199, 0.231], [0.199, 0.292], [0.108, 0.292]], y: [-0.07, 0.0], hinge: [[0.108, -0.021, 0.231], [0.199, -0.021, 0.231]], angle: 30 }],
        brakes: [{ top: [[-0.028, -0.112], [0.028, -0.112], [0.028, -0.029], [-0.028, -0.029]], y: [0.0, 0.05], hinge: [[-0.028, 0.022, -0.112], [0.028, 0.022, -0.112]], angle: -45, skin: 1, depth: 0.01, mirror: false }],
    },
    // Boeing 737-800: Fowler flaps inboard and outboard of the engine (they run aft on their tracks, taking the
    // back of the track fairings with them); spoiler panels on the upper skin just ahead of them, rising 40°
    b737: {
        flaps: [
            { top: [[0.056, -0.008], [0.132, -0.004], [0.132, 0.045], [0.056, 0.045]], y: [-0.135, -0.09], dihedral: 5, hinge: [[0.056, -0.103, -0.008], [0.132, -0.100, -0.004]], angle: 35, slide: [0, -0.004, 0.02] },
            { top: [[0.135, 0.0], [0.295, 0.061], [0.295, 0.10], [0.135, 0.06]], y: [-0.135, -0.085], dihedral: 5, hinge: [[0.135, -0.099, 0.0], [0.295, -0.082, 0.061]], angle: 35, slide: [0, -0.003, 0.016] },
        ],
        brakes: [
            { top: [[0.06, -0.030], [0.125, -0.026], [0.125, -0.0045], [0.06, -0.0085]], y: [-0.112, -0.085], dihedral: 5, hinge: [[0.06, -0.100, -0.030], [0.125, -0.097, -0.026]], angle: -40, skin: 1 },
            { top: [[0.14, -0.020], [0.29, 0.037], [0.29, 0.0585], [0.14, 0.0015]], y: [-0.103, -0.08], dihedral: 5, hinge: [[0.14, -0.097, -0.020], [0.29, -0.081, 0.037]], angle: -40, skin: 1 },
        ],
    },

    // ── US fighters and attack jets ──

    // ── Russian and Chinese types ──

    // ── European types, bombers, airliners, light aircraft ──

    // Eurofighter Typhoon: the inboard flaperons (root to mid-span, behind the pylons) droop for lift; the
    // dorsal airbrake on the spine behind the canopy, hinged at its front
    typhoon: {
        flaps: [{ top: [[0.08, 0.2885], [0.205, 0.2835], [0.205, 0.3135], [0.08, 0.3195]], y: [-0.1034, -0.093], hinge: [[0.08, -0.0961, 0.2885], [0.205, -0.0962, 0.2835]], angle: 25 }],
        brakes: [{ top: [[-0.016, -0.112], [0.016, -0.112], [0.016, -0.03], [-0.016, -0.03]], y: [-0.028, 0.002], hinge: [[-0.016, -0.0045, -0.112], [0.016, -0.0045, -0.112]], angle: -50, skin: 1, depth: 0.008, mirror: false }],
    },
    // Dassault Rafale: the inboard elevons (nacelle to the inner pylon) droop for lift; no dedicated airbrake.
    // The wing has anhedral.
    rafale: {
        flaps: [{ top: [[0.107, 0.3105], [0.1905, 0.3105], [0.1905, 0.357], [0.107, 0.363]], y: [-0.0815, -0.0635], dihedral: -4, hinge: [[0.107, -0.0662, 0.3105], [0.1905, -0.0721, 0.3105]], angle: 20 }],
    },
    // Saab JAS 39 Gripen: the inboard elevons (behind the wing's trailing edge, inside the step) droop at low
    // speed; the two airbrakes on the lower sides of the rear fuselage, ahead of the nozzle, hinged at their
    // front and opening outward and down from the skin
    gripen: {
        flaps: [{ top: [[0.060, 0.2790], [0.165, 0.2857], [0.165, 0.325], [0.060, 0.345]], y: [-0.0715, -0.060], hinge: [[0.060, -0.0622, 0.2790], [0.165, -0.0681, 0.2857]], angle: 20 }],
        brakes: [{ side: [[0.372, -0.0858], [0.415, -0.0858], [0.415, -0.096], [0.372, -0.096]], x: [0.008, 0.04], hinge: [[0.033, -0.0858, 0.372], [0.022, -0.096, 0.372]], angle: 45, skin: 1 }],
    },
    // Dassault Mirage IIIE: no flaps (elevons only); a small airbrake panel in the upper and in the lower skin of
    // each wing, on the texture's panel outline, hinged at the front, opening up and down
    mirage: {
        brakes: [
            { top: [[0.1015, 0.1437], [0.1218, 0.1437], [0.1218, 0.1593], [0.1015, 0.1593]], y: [-0.070, -0.058], hinge: [[0.1015, -0.0624, 0.1437], [0.1218, -0.0637, 0.1437]], angle: -60, skin: 1 },
            { top: [[0.1015, 0.1437], [0.1218, 0.1437], [0.1218, 0.1593], [0.1015, 0.1593]], y: [-0.080, -0.070], hinge: [[0.1015, -0.0766, 0.1437], [0.1218, -0.0761, 0.1437]], angle: 60, skin: -1 },
        ],
    },
    // SEPECAT Jaguar: double-slotted flaps along nearly the whole trailing edge (it has no ailerons), in two
    // sections either side of the overwing missile pylon, running aft as they go down; the wing has anhedral.
    // Two door-type airbrakes under the fuselage just behind the main-wheel wells, opening down.
    jaguar: {
        flaps: [
            { top: [[0.050, 0.1275], [0.117, 0.161], [0.117, 0.212], [0.050, 0.178]], y: [-0.0150, -0.0060], dihedral: -3, hinge: [[0.050, -0.0086, 0.1275], [0.117, -0.0121, 0.161]], angle: 40, slide: [0, -0.002, 0.012] },
            { top: [[0.1445, 0.1795], [0.235, 0.227], [0.235, 0.262], [0.1445, 0.225]], y: [-0.0200, -0.0105], dihedral: -4, hinge: [[0.1445, -0.0138, 0.1795], [0.235, -0.0208, 0.227]], angle: 40, slide: [0, -0.0015, 0.010] },
        ],
        brakes: [{ top: [[0.006, 0.16], [0.027, 0.16], [0.027, 0.21], [0.006, 0.21]], y: [-0.104, -0.094], hinge: [[0.006, -0.1004, 0.16], [0.027, -0.0991, 0.16]], angle: 60, skin: -1, depth: 0.006 }],
    },
    // Northrop B-2 Spirit: no flaps. The split drag rudders at the outboard trailing edge are its speed brakes:
    // the model builds each as a body of two halves meeting face to face, which open up and down like a bill
    // (split: each half takes its own skin and inner face). The front strip with the hinge fairings stays put.
    b2: {
        brakes: [
            { top: [[0.8341, 0.2946], [1.0131, 0.4220], [0.9634, 0.4576], [0.7844, 0.3302]], y: [-0.022, 0.006], hinge: [[0.8341, 0.0013, 0.2946], [1.0131, 0.0024, 0.4220]], angle: -45, skin: 1, split: true },
            { top: [[0.8341, 0.2946], [1.0131, 0.4220], [0.9634, 0.4576], [0.7844, 0.3302]], y: [-0.022, 0.006], hinge: [[0.8341, -0.0161, 0.2946], [1.0131, -0.0116, 0.4220]], angle: 45, skin: -1, split: true },
        ],
    },
    // Boeing 747-400: triple-slotted Fowler flaps inboard (body to the inboard aileron behind engine 2) and
    // outboard (inboard aileron to ~70% span; they take the back of the outboard engine's strut fairing with
    // them), running aft on their tracks; spoiler panels on the upper skin just ahead of each, rising 45°.
    // The wing has dihedral.
    b747: {
        flaps: [
            { top: [[0.047, -0.021], [0.147, 0.012], [0.147, 0.055], [0.047, 0.022]], y: [-0.086, -0.069], dihedral: 4.3, hinge: [[0.047, -0.0722, -0.021], [0.147, -0.0647, 0.012]], angle: 30, slide: [0, -0.003, 0.02] },
            { top: [[0.185, 0.042], [0.335, 0.127], [0.335, 0.160], [0.185, 0.075]], y: [-0.0735, -0.0585], dihedral: 5.6, hinge: [[0.185, -0.0611, 0.042], [0.335, -0.0465, 0.127]], angle: 30, slide: [0, -0.002, 0.015] },
        ],
        brakes: [
            { top: [[0.06, -0.0367], [0.14, -0.0103], [0.14, 0.0097], [0.06, -0.0167]], y: [-0.077, -0.0665], dihedral: 4.3, hinge: [[0.06, -0.0703, -0.0367], [0.14, -0.0636, -0.0103]], angle: -45, skin: 1 },
            { top: [[0.195, 0.0317], [0.32, 0.1025], [0.32, 0.1185], [0.195, 0.0477]], y: [-0.063, -0.056], dihedral: 5.6, hinge: [[0.195, -0.0592, 0.0317], [0.32, -0.0478, 0.1025]], angle: -45, skin: 1 },
        ],
    },
    // Cessna 172: electric slotted flaps on the inboard half of the wing, 30° in about 9 s; the model builds each
    // as a body of its own tucked into the cove under the upper skin, and it runs aft as it goes down
    cessna: {
        travel: { flap: 9 },
        flaps: [{ top: [[0.1025, -0.150], [0.3107, -0.150], [0.3107, -0.1015], [0.2960, -0.045], [0.1172, -0.045], [0.1025, -0.1015]], y: [0.0365, 0.0636], hinge: [[0.1025, 0.0612, -0.150], [0.3107, 0.0612, -0.150]], angle: 30, slide: [0, -0.004, 0.022] }],
    },
    // Unlimited racer (a Mustang): plain flaps from the wing root out to the ailerons, on the texture's hinge line
    // and flap/aileron joint, down 45°. No speed brake. The wing has dihedral.
    racer: {
        flaps: [{ top: [[0.052, -0.0050], [0.366, -0.051], [0.3781, 0.0], [0.052, 0.070]], y: [-0.1058, -0.080], dihedral: 4.3, hinge: [[0.052, -0.0848, -0.0050], [0.366, -0.0640, -0.051]], angle: 45 }],
    },

};

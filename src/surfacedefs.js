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
//   depth: bay depth for a skin panel (default 0.004); 0 closes nothing: no walls, floor or inside face (a
//          skin that is a single sheet, like the F-14's beaver tail, or the halves of a drooped A-10 deceleron)
//   split: true for one half of a split surface whose halves are separate bodies meeting face to face (a B-2
//          drag rudder): each half takes its skin and inner face, and no bay is made behind it
//   whole: true (or a nudge, in L) for a part modelled as a closed solid of its own (the F-16's flaperons and
//          speed-brake petals, a flaperon modelled with a gap all round): its triangles are taken whole, by
//          where their centre lies (nudged into the solid, so parts that touch face to face keep their own
//          faces), never clipped, and nothing closes the opening
//   clip: [[[x, y, z], [nx, ny, nz]], ...]  extra planes bounding the region (the normal points into it), e.g.
//          the split between the halves of a deceleron that is modelled drooped
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
    // C-130: Lockheed-Fowler flaps from the fuselage to the ailerons, in an inboard and an outboard section; they
    // run aft on their tracks as they go down (hydraulic, ~10 s full travel). No spoilers.
    c130: {
        flaps: [
            { top: [[0.066, 0.005], [0.25, 0.0], [0.25, 0.058], [0.066, 0.062]], y: [-0.08, -0.035], dihedral: 1.5, hinge: [[0.066, -0.053, 0.005], [0.25, -0.054, 0.0]], angle: 35, slide: [0, -0.004, 0.025] },
            { top: [[0.255, 0.002], [0.465, -0.022], [0.465, 0.025], [0.255, 0.055]], y: [-0.08, -0.035], dihedral: 1.5, hinge: [[0.255, -0.054, 0.002], [0.465, -0.056, -0.022]], angle: 35, slide: [0, -0.004, 0.022] },
        ],
        travel: { flap: 10 },
    },

    // ── US fighters and attack jets ──

    // F-16C: the flaperons (the model's own AileronL/R parts) droop 20° as flaps. The speed brakes are the
    // split petals at the end of the booms beside the nozzle (the model's BrakeL/R 01, 02): taken whole, the
    // upper one opens up and the lower one down, 30° each (60° in all), about the front of the split between
    // them (which leans 11° outboard-down, like the petals)
    f16: {
        flaps: [{ top: [[0.0721, 0.18314], [0.2437, 0.20882], [0.2437, 0.2335], [0.0721, 0.2335]], y: [-0.06815, -0.06], hinge: [[0.0725, -0.0623, 0.1829], [0.2436, -0.0656, 0.2085]], angle: 20 }],
        brakes: [
            { top: [[0.046, 0.3929], [0.0724, 0.3929], [0.0724, 0.4505], [0.046, 0.4505]], y: [-0.075, -0.05774], dihedral: -11.31, whole: true, hinge: [[0.0472, -0.05813, 0.3929], [0.07172, -0.06279, 0.3929]], angle: 30 },
            { top: [[0.046, 0.3929], [0.0724, 0.3929], [0.0724, 0.4505], [0.046, 0.4505]], y: [-0.05774, -0.045], dihedral: -11.31, whole: true, hinge: [[0.0472, -0.05813, 0.3929], [0.07172, -0.06279, 0.3929]], angle: -30 },
        ],
    },
    // F-22A: the flaperons (modelled with a gap all round, notched at the inboard trailing edge for the
    // stabiliser) droop 25°; the front of the outline follows the curved gap between wing and flaperon, and the
    // inboard end is cut just outboard of the blended wing root. No dedicated speed brake: the real jet brakes
    // with its control surfaces
    f22: {
        flaps: [{ top: [[0.103, 0.279], [0.1192, 0.2737], [0.1302, 0.2702], [0.2023, 0.2488], [0.2451, 0.237], [0.2451, 0.2955], [0.1505, 0.3272], [0.103, 0.3005]], y: [-0.0505, -0.04], hinge: [[0.1784, -0.0433, 0.257], [0.2057, -0.0432, 0.249]], angle: 25 }],
    },
    // F-35A: the flaperons (almost the whole trailing edge, behind the model's hinge-line groove) droop 25°.
    // No speed brake: the real jet splits its rudders and uses the flaperons
    f35: {
        flaps: [{ top: [[0.137, 0.2528], [0.3195, 0.209], [0.3195, 0.2506], [0.137, 0.2948]], y: [-0.034, -0.017], hinge: [[0.132, -0.0215, 0.254], [0.3199, -0.0254, 0.2089]], angle: 25 }],
    },
    // F-35A, hand-built model: the same constant-chord flaperons, root to 90% span, 25°; no speed brake
    f35n: {
        flaps: [{ top: [[0.102, 0.2495], [0.315, 0.2125], [0.315, 0.26], [0.102, 0.29]], y: [-0.068, -0.04], hinge: [[0.1026, -0.0476, 0.2494], [0.3429, -0.0585, 0.2077]], angle: 25 }],
    },
    // F/A-18E: the big single-slotted trailing-edge flaps inboard of the wing fold (a separate solid in the model)
    // go down 40° and run a little aft, opening a slot. The Super Hornet has no dorsal speed brake (the legacy
    // Hornet's): its speed-brake function raises the spoiler on top of each LEX, here the panel the texture
    // outlines behind the cockpit, hinged at its front and rising 60°
    fa18: {
        flaps: [{ top: [[0.0712, 0.1618], [0.1009, 0.1617], [0.238, 0.1841], [0.238, 0.2398], [0.0698, 0.253]], y: [-0.036, -0.008], whole: 0.0006, hinge: [[0.1007, -0.0164, 0.1631], [0.2379, -0.0221, 0.1853]], angle: 40, slide: [0, -0.002, 0.008] }],
        brakes: [{ top: [[0.0335, -0.1165], [0.0645, -0.103], [0.0715, -0.076], [0.0335, -0.076]], y: [-0.017, -0.004], dihedral: -13, skin: 1, depth: 0.006, hinge: [[0.0335, -0.0108, -0.1165], [0.0645, -0.0177, -0.103]], angle: -60 }],
    },
    // F-14: the speed brakes on the "beaver tail" between the engines, modelled with red bays and actuators:
    // an upper panel each side of the tail fairing rising 60° and a lower panel each side of the hook dropping
    // 60°, all hinged at the front. The beaver tail is a single thin sheet, so the panels have no bay floor
    // (depth 0). No flaps: this model's wings are fixed fully swept (68°), where the real flaps are locked out
    // (they only run with the wings forward of about 21°)
    f14: {
        brakes: [
            { top: [[0.0192, 0.383], [0.04, 0.383], [0.04, 0.44], [0.0345, 0.4485], [0.0245, 0.4485], [0.0192, 0.44]], y: [-0.0395, -0.03], skin: 1, depth: 0, hinge: [[0.0192, -0.0372, 0.383], [0.04, -0.0372, 0.383]], angle: -60 },
            { top: [[0.0192, 0.383], [0.04, 0.383], [0.04, 0.421], [0.0192, 0.421]], y: [-0.05, -0.0405], skin: -1, depth: 0, hinge: [[0.0192, -0.046, 0.383], [0.04, -0.046, 0.383]], angle: 60 },
        ],
    },
    // F-4E: the inboard trailing-edge flaps (root to the aileron, about a quarter of the chord) go down 60°, and
    // the ailerons outboard of them, up to the wing fold, droop 16.5° with them. The speed brakes are the panels
    // under each wing just aft of the main-gear wells (the texture's panel lines), hinged at the front and
    // opening 50°
    f4: {
        flaps: [
            { top: [[0.059, 0.1591], [0.1134, 0.1832], [0.1134, 0.24], [0.059, 0.225]], y: [-0.08, -0.056], dihedral: -4.6, hinge: [[0.059, -0.0618, 0.1591], [0.1134, -0.0665, 0.1832]], angle: 60 },
            { top: [[0.1134, 0.203], [0.232, 0.234], [0.232, 0.268], [0.1134, 0.24]], y: [-0.084, -0.062], dihedral: -4.6, hinge: [[0.1134, -0.069, 0.203], [0.232, -0.078, 0.234]], angle: 16.5 },
        ],
        brakes: [{ top: [[0.061, 0.1085], [0.1115, 0.1085], [0.1115, 0.1595], [0.061, 0.1595]], y: [-0.081, -0.07], dihedral: -3, skin: -1, depth: 0.006, hinge: [[0.061, -0.0757, 0.1085], [0.1115, -0.0783, 0.1085]], angle: 50 }],
    },
    // A-10C: the flaps inboard of the decelerons, in two pieces each side (inboard and outboard of the fairing
    // at 0.176), go down 20° (the real jet's DN setting). The decelerons are the split ailerons on the outer
    // panels. This model has them drooped (about 40°), with the hinge fittings and the halves' shells nested
    // inside, so they are split along a plane between the upper and lower halves (clip) rather than by the way
    // each face points: the upper half rises 55° to about level with the wing, the lower half drops 25°, 80° in
    // all. The opening is left open (depth 0): each half is a shell cut along the split
    a10: {
        flaps: [
            { top: [[0.0639, 0.0812], [0.1745, 0.0812], [0.1745, 0.103], [0.0639, 0.103]], y: [-0.064, -0.036], hinge: [[0.0639, -0.0428, 0.0812], [0.1745, -0.0492, 0.0812]], angle: 20 },
            { top: [[0.1776, 0.0817], [0.318, 0.0718], [0.318, 0.103], [0.1776, 0.103]], y: [-0.064, -0.038], dihedral: 4, hinge: [[0.1776, -0.0488, 0.0805], [0.318, -0.0392, 0.0706]], angle: 20 },
        ],
        brakes: [
            { top: [[0.3192, 0.0262], [0.5024, 0.0262], [0.5024, 0.085], [0.3192, 0.085]], y: [-0.0625, 0], clip: [[[0.42, -0.0235, 0.024], [-0.092, 1, 0.75]]], depth: 0, hinge: [[0.3192, -0.0339, 0.0258], [0.5024, -0.017, 0.0258]], angle: -55 },
            { top: [[0.3192, 0.0262], [0.5024, 0.0262], [0.5024, 0.085], [0.3192, 0.085]], y: [-0.0625, 0], clip: [[[0.42, -0.0235, 0.024], [0.092, -1, -0.75]]], depth: 0, hinge: [[0.3192, -0.0339, 0.0258], [0.5024, -0.017, 0.0258]], angle: 25 },
        ],
    },
    // F-5E: the trailing-edge flaps (root to the kink in the trailing edge, aft of the texture's hinge line) go
    // down 20°, the real jet's full setting. The speed brakes are the two panels side by side under the fuselage
    // ahead of the main-gear bays (the texture's panel), hinged at the front and opening 50°
    f5: {
        flaps: [{ top: [[0.0495, 0.2], [0.178, 0.2], [0.178, 0.245], [0.0495, 0.245]], y: [-0.102, -0.086], dihedral: -2.2, hinge: [[0.0495, -0.0915, 0.2], [0.178, -0.0962, 0.2]], angle: 20 }],
        brakes: [{ top: [[0.0012, 0.006], [0.0248, 0.006], [0.0248, 0.054], [0.0012, 0.054]], y: [-0.122, -0.1], skin: -1, depth: 0.006, hinge: [[0.0012, -0.1135, 0.006], [0.0248, -0.1115, 0.006]], angle: 50 }],
    },
    // Mitsubishi F-2A: the model's own flaperon (root to the fixed outer trailing edge) droops 20°; the split
    // speed-brake petals at the end of the booms beside the nozzle (modelled with their ribs and actuators)
    // open 30° up and 30° down, as on the F-16
    f2: {
        flaps: [{ top: [[0.0666, 0.18605], [0.2677, 0.19265], [0.2677, 0.2375], [0.0666, 0.2375]], y: [-0.0668, -0.052], hinge: [[0.0667, -0.0539, 0.1862], [0.2678, -0.0589, 0.1927]], angle: 20 }],
        brakes: [
            { top: [[0.0425, 0.402], [0.0669, 0.402], [0.0669, 0.458], [0.0425, 0.458]], y: [-0.075, -0.0612], dihedral: -8.5, whole: true, hinge: [[0.0433, -0.0612, 0.4028], [0.0669, -0.0647, 0.4028]], angle: 30 },
            { top: [[0.0425, 0.402], [0.0669, 0.402], [0.0669, 0.458], [0.0425, 0.458]], y: [-0.0612, -0.05], dihedral: -8.5, whole: true, hinge: [[0.0433, -0.0612, 0.4028], [0.0669, -0.0647, 0.4028]], angle: -30 },
        ],
    },

    // ── Russian and Chinese types ──

    // Su-35: flaperons on the inboard part of the trailing edge (ailerons outboard of them), drooping 35° for
    // landing; the big dorsal speed brake on the spine behind the canopy (2.6 m² on the real one), hinged at its
    // front, rising 54°
    su35: {
        flaps: [{ top: [[0.100, 0.187], [0.235, 0.218], [0.235, 0.280], [0.100, 0.250]], y: [-0.053, -0.036], hinge: [[0.100, -0.043, 0.187], [0.235, -0.043, 0.218]], angle: 35 }],
        brakes: [{ top: [[-0.022, -0.115], [0.022, -0.115], [0.022, -0.025], [-0.022, -0.025]], y: [-0.04, 0.005], hinge: [[-0.022, -0.007, -0.115], [0.022, -0.007, -0.115]], angle: -54, skin: 1, depth: 0.006, mirror: false }],
    },
    // Su-57: the model's own inboard flaperons (between the tailplane's leading edge and the ailerons), drooping
    // 30°. No speed brake: it brakes with its control surfaces
    su57: {
        flaps: [{ top: [[0.1645, 0.2745], [0.2475, 0.2613], [0.2475, 0.302], [0.19, 0.312]], y: [-0.045, -0.02], hinge: [[0.1645, -0.027, 0.2745], [0.2475, -0.027, 0.2613]], angle: 30 }],
    },
    // Su-47: flaperons on the inner part of the forward-swept wing (the texture's trailing-edge strip), drooping
    // 35°. No speed brake: it lands with the all-moving tailplanes pitched up as brakes
    su47: {
        flaps: [{ top: [[0.13, 0.2535], [0.235, 0.1799], [0.235, 0.221], [0.13, 0.300]], y: [-0.055, -0.025], hinge: [[0.13, -0.036, 0.2535], [0.235, -0.040, 0.1799]], angle: 35 }],
    },
    // MiG-29: plain flaps between the fuselage and the ailerons (the texture's panel lines), 25° for landing;
    // the upper (0.75 m², 56°) and lower (0.55 m², 60°) speed brakes on the beam between the engines, ahead of
    // the brake-chute fairing
    mig29: {
        flaps: [{ top: [[0.104, 0.2021], [0.2075, 0.2334], [0.2075, 0.284], [0.104, 0.265]], y: [-0.061, -0.045], hinge: [[0.104, -0.052, 0.2021], [0.2075, -0.052, 0.2334]], angle: 25 }],
        brakes: [
            { top: [[-0.023, 0.330], [0.023, 0.330], [0.023, 0.375], [-0.023, 0.375]], y: [-0.062, -0.05], hinge: [[-0.023, -0.0566, 0.330], [0.023, -0.0566, 0.330]], angle: -56, skin: 1, mirror: false },
            { top: [[-0.019, 0.333], [0.019, 0.333], [0.019, 0.372], [-0.019, 0.372]], y: [-0.075, -0.0615], hinge: [[-0.019, -0.066, 0.333], [0.019, -0.066, 0.333]], angle: 60, skin: -1, mirror: false },
        ],
    },
    // MiG-31: flaps on the inner half of the trailing edge (30°), hinged on the texture's spanwise panel line;
    // the airbrakes on the belly under the intake trunks, ahead of the main gear, hinged at the front, opening 40°
    mig31: {
        flaps: [{ top: [[0.075, 0.2508], [0.1822, 0.2508], [0.1822, 0.325], [0.075, 0.311]], y: [-0.047, -0.024], hinge: [[0.075, -0.0305, 0.2508], [0.1822, -0.0357, 0.2508]], angle: 30 }],
        brakes: [{ top: [[0.034, 0.024], [0.054, 0.024], [0.054, 0.066], [0.034, 0.066]], y: [-0.0835, -0.0735], hinge: [[0.034, -0.0789, 0.024], [0.054, -0.0758, 0.024]], angle: 40, skin: -1 }],
    },
    // MiG-25: flaps inboard of the ailerons (25°, the same for takeoff and landing on the real one), on the
    // texture's panel line behind the inner pylon; the upper speed brake between the fins, behind the end of the
    // spine (43.5°), and the lower one under the rear fuselage between the ventral fins (45°)
    mig25: {
        flaps: [{ top: [[0.077, 0.2704], [0.193, 0.2704], [0.193, 0.333], [0.077, 0.3125]], y: [-0.052, -0.034], dihedral: -5, hinge: [[0.077, -0.0428, 0.2704], [0.193, -0.0535, 0.2704]], angle: 25 }],
        brakes: [
            { top: [[-0.024, 0.405], [0.024, 0.405], [0.024, 0.438], [-0.024, 0.438]], y: [-0.025, -0.008], hinge: [[-0.024, -0.0165, 0.405], [0.024, -0.0165, 0.405]], angle: -43.5, skin: 1, mirror: false },
            { top: [[-0.028, 0.335], [0.028, 0.335], [0.028, 0.385], [-0.028, 0.385]], y: [-0.095, -0.082], hinge: [[-0.028, -0.0895, 0.335], [0.028, -0.0895, 0.335]], angle: 45, skin: -1, mirror: false },
        ],
    },
    // MiG-21bis: plain (blown) flaps between the fuselage and the inner fence, 45° for landing; the two forward
    // airbrakes on the lower sides of the fuselage under the wing root, opening down and out 35°. (Its third,
    // ventral brake is locked out with a centreline tank, which this model always carries.)
    mig21: {
        flaps: [{ top: [[0.0425, 0.191], [0.107, 0.191], [0.107, 0.268], [0.0425, 0.265]], y: [-0.078, -0.058], hinge: [[0.0425, -0.0658, 0.191], [0.107, -0.0666, 0.191]], angle: 45 }],
        brakes: [{ top: [[0.012, -0.145], [0.036, -0.145], [0.036, -0.095], [0.012, -0.095]], y: [-0.1, -0.062], hinge: [[0.012, -0.0921, -0.145], [0.036, -0.0741, -0.145]], angle: 35, skin: -1 }],
    },
    // J-20: flaperons between the tail booms and the wing crank, drooping 25°. No speed brake: it brakes with
    // its control surfaces
    j20: {
        flaps: [{ top: [[0.119, 0.3125], [0.224, 0.3125], [0.224, 0.367], [0.119, 0.367]], y: [-0.036, -0.012], hinge: [[0.119, -0.0205, 0.3125], [0.224, -0.0232, 0.3125]], angle: 25 }],
    },
    // J-10A: the inboard elevons droop 20° as flaps; four petal airbrakes on the rear fuselage, two on top beside
    // the fin and two underneath between the ventral fins, opening 50°
    j10: {
        flaps: [{ top: [[0.062, 0.23], [0.15, 0.23], [0.15, 0.312], [0.062, 0.318]], y: [-0.086, -0.06], hinge: [[0.062, -0.0705, 0.23], [0.15, -0.0745, 0.23]], angle: 20 }],
        brakes: [
            { top: [[0.007, 0.315], [0.042, 0.315], [0.042, 0.365], [0.007, 0.365]], y: [-0.048, -0.018], hinge: [[0.007, -0.0255, 0.315], [0.042, -0.0355, 0.315]], angle: -50, skin: 1 },
            { top: [[0.004, 0.315], [0.03, 0.315], [0.03, 0.362], [0.004, 0.362]], y: [-0.115, -0.095], hinge: [[0.004, -0.1085, 0.315], [0.03, -0.107, 0.315]], angle: 50, skin: -1 },
        ],
    },
    // J-8II: flaps between the fuselage and the inner fence, 30°; two ventral airbrakes on the belly behind the
    // nose gear, opening 45°
    j8: {
        flaps: [{ top: [[0.059, 0.241], [0.0995, 0.241], [0.0995, 0.296], [0.059, 0.297]], y: [-0.062, -0.042], hinge: [[0.059, -0.0502, 0.241], [0.0995, -0.051, 0.241]], angle: 30 }],
        brakes: [{ top: [[0.003, -0.175], [0.024, -0.175], [0.024, -0.13], [0.003, -0.13]], y: [-0.085, -0.06], hinge: [[0.003, -0.0748, -0.175], [0.024, -0.0705, -0.175]], angle: 45, skin: -1 }],
    },

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
    // Canadair CL-415: one hydraulic single-slotted flap each side from the hull to the aileron (the strip the model
    // marks under the wing, x 0.065 to 0.459), hung on four external hinges: the pods under the wing, whose round
    // lower ends are the hinge line, about 0.5 m below the skin. Turning about them the flap runs aft as it goes down
    // and opens its slot (0.26 m at full travel). Its chord is the aileron's (the line in the upper skin). A plane
    // just under the lower skin (clip) leaves the pods on the wing. The flight manual's settings are 0 / 10 / 15 / 25°
    // (15 to scoop and drop, 25 to land): full travel is 25°, the takeoff notch 12.5°
    cl415: {
        flaps: [{ top: [[0.0675, -0.0245], [0.4585, -0.0245], [0.4585, 0.025], [0.0675, 0.025]], y: [-0.0465, -0.029], clip: [[[0.2, -0.0443, -0.0315], [0, 1, -0.0869]]], hinge: [[0.0675, -0.0682, -0.0318], [0.4585, -0.0682, -0.0318]], angle: 25 }],
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

    // ── Support aircraft, drones and bombers (the living war) ──
    // KC-135R (Boeing 717 wing): Fowler flaps inboard (root fillet to the inboard aileron) and outboard (to the
    // outboard aileron), the inboard aileron between them left alone; spoiler groups on the upper skin ahead of each
    // flap, rising 40° (they are its speed brakes). Traced from the model's own panel lines (the flap leading edge
    // kinks at the inboard aileron); the band tilts with the model's dihedral. (tools/aircraft/kc135.py)
    kc135: {
        flaps: [
            { top: [[0.0865, -0.0258], [0.0993, -0.034], [0.1886, 0.0119], [0.1687, 0.0443], [0.0865, 0.0075]], y: [-0.106, -0.077], dihedral: 8.7, hinge: [[0.0993, -0.082, -0.034], [0.1886, -0.0715, 0.0119]], angle: 35, slide: [0, -0.004, 0.024] },
            { top: [[0.2345, 0.0355], [0.3305, 0.0786], [0.3163, 0.1112], [0.2173, 0.0658]], y: [-0.086, -0.058], dihedral: 8.7, hinge: [[0.2345, -0.066, 0.0355], [0.3305, -0.0505, 0.0786]], angle: 35, slide: [0, -0.003, 0.0225] },
        ],
        brakes: [
            { top: [[0.1113, -0.0522], [0.174, -0.0214], [0.167, 0.0008], [0.0993, -0.034]], y: [-0.092, -0.071], dihedral: 8.7, hinge: [[0.1113, -0.082, -0.0522], [0.174, -0.0725, -0.0214]], angle: -40, skin: 1 },
            { top: [[0.251, 0.0165], [0.3208, 0.0508], [0.3088, 0.0677], [0.2435, 0.0348]], y: [-0.072, -0.055], dihedral: 8.7, hinge: [[0.251, -0.0645, 0.0165], [0.3208, -0.0535, 0.0508]], angle: -40, skin: 1 },
        ],
    },
    // E-3G: the same wing, stretched spanwise into the 707-320B's and moved aft by the forward fuselage plug
    // (tools/aircraft/e3.py): the KC-135's defs carried through the same transform
    e3: {
        flaps: [
            { top: [[0.0812, 0.0093], [0.0939, 0.0019], [0.1826, 0.0431], [0.1628, 0.0722], [0.0812, 0.0392]], y: [-0.1, -0.0739], dihedral: 7.8772, hinge: [[0.0939, -0.0784, 0.0019], [0.1826, -0.069, 0.0431]], angle: 35, slide: [0, -0.0036, 0.0215] },
            { top: [[0.2282, 0.0643], [0.3235, 0.103], [0.3094, 0.1323], [0.2111, 0.0915]], y: [-0.082, -0.0569], dihedral: 7.8772, hinge: [[0.2282, -0.0641, 0.0643], [0.3235, -0.0502, 0.103]], angle: 35, slide: [0, -0.0027, 0.0202] },
        ],
        brakes: [
            { top: [[0.1058, -0.0145], [0.1681, 0.0132], [0.1611, 0.0332], [0.0939, 0.0019]], y: [-0.0874, -0.0686], dihedral: 7.8772, hinge: [[0.1058, -0.0784, -0.0145], [0.1681, -0.0699, 0.0132]], angle: -40, skin: 1 },
            { top: [[0.2445, 0.0472], [0.3138, 0.0781], [0.3019, 0.0932], [0.2371, 0.0637]], y: [-0.0695, -0.0542], dihedral: 7.8772, hinge: [[0.2445, -0.0627, 0.0472], [0.3138, -0.0528, 0.0781]], angle: -40, skin: 1 },
        ],
    },
    // A-50 (Il-76MD): Fowler flaps in two sections a side, cut through the wing with the aft flap-track fairings, 40° with
    // ~1.3 m aft travel; spoiler panels on the upper skin ahead of them rise 50° (tools/aircraft/a50.py)
    a50: {
        flaps: [
            { top: [[0.0474, 0.0031], [0.2309, 0.0263], [0.2309, 0.0687], [0.0474, 0.0445]], y: [-0.0547, -0.0214], dihedral: -2.6, hinge: [[0.0474, -0.024, 0.0031], [0.2309, -0.0309, 0.0263]], angle: 40, slide: [0, -0.005, 0.0282] },
            { top: [[0.2329, 0.0273], [0.3721, 0.0798], [0.3721, 0.111], [0.2329, 0.0687]], y: [-0.0627, -0.0288], dihedral: -3.4, hinge: [[0.2329, -0.0305, 0.0273], [0.3721, -0.0393, 0.0798]], angle: 40, slide: [0, -0.0044, 0.0242] },
        ],
        brakes: [
            { top: [[0.0807, -0.0291], [0.2117, -0.01], [0.2117, 0.0182], [0.0807, -0.0009]], y: [-0.0295, -0.0163], dihedral: -2.6, hinge: [[0.0807, -0.022, -0.0291], [0.2117, -0.0276, -0.01]], angle: -50, skin: 1 },
            { top: [[0.242, -0.0009], [0.3529, 0.0404], [0.3529, 0.0687], [0.242, 0.0273]], y: [-0.0375, -0.0254], dihedral: -3.4, hinge: [[0.242, -0.0315, -0.0009], [0.3529, -0.0375, 0.0404]], angle: -50, skin: 1 },
        ],
    },
    // Il-78M (another Il-76 model): the same Fowler flaps and spoilers as the A-50, measured on this model: the trailing
    // edge (kinked at 11.2 m out, where the two flap sections meet) and skin heights probed from the mesh, the chords
    // from the A-50's panel lines (2 m inboard; outboard tapering 1.7 to 1.4 m, its hinge passing just behind the
    // UPAZ pod's tail). The aft ends of the flap-track fairings go down with the flaps.
    il78: {
        flaps: [
            { top: [[0.079, -0.0363], [0.2395, -0.0109], [0.2395, 0.0426], [0.079, 0.0172]], y: [-0.048, -0.0135], dihedral: -3.8, hinge: [[0.079, -0.0176, -0.0363], [0.2395, -0.0309, -0.0109]], angle: 40, slide: [0, -0.0053, 0.03] },
            { top: [[0.2405, -0.0044], [0.396, 0.0518], [0.396, 0.0925], [0.2405, 0.0441]], y: [-0.0553, -0.0275], dihedral: -4.5, hinge: [[0.2405, -0.031, -0.0044], [0.396, -0.0465, 0.0518]], angle: 40, slide: [0, -0.0047, 0.0258] },
        ],
        brakes: [
            { top: [[0.087, -0.069], [0.2275, -0.0468], [0.2275, -0.0168], [0.087, -0.039]], y: [-0.026, -0.009], dihedral: -3.8, hinge: [[0.087, -0.0142, -0.069], [0.2275, -0.0286, -0.0468]], angle: -50, skin: 1 },
            { top: [[0.2455, -0.0326], [0.3756, 0.0145], [0.3756, 0.0435], [0.2455, -0.0036]], y: [-0.0375, -0.024], dihedral: -4.5, hinge: [[0.2455, -0.0303, -0.0326], [0.3756, -0.044, 0.0145]], angle: -50, skin: 1 },
        ],
    },
    // MQ-9A: the inboard trailing-edge surfaces (0.55-4.46 m out, closed solids of their own in the model) droop as
    // flaps; the band stops just under the upper skin so the actuator fairing on top of the wing stays put
    mq9: {
        flaps: [{ top: [[0.05, 0.0805], [0.4058, 0.0752], [0.4058, 0.1062], [0.05, 0.1168]], y: [-0.033, -0.0093], whole: true, hinge: [[0.0502, -0.0205, 0.0805], [0.4056, -0.0205, 0.0753]], angle: 30 }],
    },
    // B-52H: Fowler flaps in two sections a side (inboard and outboard of the inner engine pods), 35°; the spoiler
    // group ahead of the outboard flap rises 50° (tools/aircraft/b52.py)
    b52: {
        flaps: [
            { top: [[0.034, -0.0913], [0.195, -0.0053], [0.195, 0.0257], [0.034, -0.0603]], y: [-0.066, -0.052], hinge: [[0.034, -0.0565, -0.0913], [0.195, -0.0565, -0.0053]], angle: 35, slide: [0, -0.003, 0.016] },
            { top: [[0.205, 0.0], [0.35, 0.0774], [0.35, 0.1084], [0.205, 0.031]], y: [-0.066, -0.052], hinge: [[0.205, -0.0565, 0.0], [0.35, -0.0565, 0.0774]], angle: 35, slide: [0, -0.003, 0.016] },
        ],
        brakes: [{ top: [[0.215, -0.0166], [0.345, 0.0528], [0.345, 0.0728], [0.215, 0.0034]], y: [-0.06, -0.05], hinge: [[0.215, -0.0556, -0.0166], [0.345, -0.0556, 0.0528]], angle: -50, skin: 1 }],
    },
    // Tu-95MS: flaps in two sections a side, inboard and outboard of the inner nacelle, 35° with a little aft
    // travel (tools/aircraft/tu95.py)
    tu95: {
        flaps: [
            { top: [[0.035, -0.0997], [0.105, -0.0707], [0.105, -0.0367], [0.035, -0.0657]], y: [-0.087, -0.068], hinge: [[0.035, -0.0725, -0.0997], [0.105, -0.0725, -0.0707]], angle: 35, slide: [0, -0.004, 0.01] },
            { top: [[0.152, -0.0512], [0.295, 0.0081], [0.295, 0.0421], [0.152, -0.0172]], y: [-0.087, -0.068], hinge: [[0.152, -0.0725, -0.0512], [0.295, -0.0725, 0.0081]], angle: 35, slide: [0, -0.004, 0.01] },
        ],
    },
    // U-2S: the trailing-edge flaps inboard and outboard of the superpods, each a closed solid of its own in the model
    // (taken whole), 30° (tools/aircraft/u2.py)
    u2: {
        flaps: [
            { top: [[0.0556, 0.0811], [0.0561, 0.0805], [0.2042, 0.0781], [0.2047, 0.0786], [0.2047, 0.1298], [0.2043, 0.1327], [0.0561, 0.1438], [0.0556, 0.1404]], y: [-0.1002, -0.0819], whole: true, hinge: [[0.0582, -0.0838, 0.0805], [0.2021, -0.0841, 0.0781]], angle: 30 },
            { top: [[0.2512, 0.0784], [0.2516, 0.0779], [0.4704, 0.0741], [0.4707, 0.0745], [0.4707, 0.1109], [0.4704, 0.113], [0.2516, 0.1293], [0.2512, 0.1265]], y: [-0.0969, -0.0821], whole: true, hinge: [[0.2538, -0.0838, 0.0779], [0.4681, -0.084, 0.0741]], angle: 30 },
        ],
    },
    // RC-135W: the KC-135's wing (rc135.py: the same file at the same scale, the airframe 1.47 m further aft for the hog
    // nose): kc135's defs shifted (scratchpad rcdefs.mjs; re-derive them if either model changes)
    rc135: {
        flaps: [
            { top: [[0.0866, 0.0101], [0.0995, 0.0019], [0.1889, 0.0479], [0.169, 0.0804], [0.0866, 0.0435]], y: [-0.1062, -0.0771], dihedral: 8.7, hinge: [[0.0995, -0.0821, 0.0019], [0.1889, -0.0716, 0.0479]], angle: 35, slide: [0, -0.004, 0.024] },
            { top: [[0.2349, 0.0715], [0.331, 0.1147], [0.3168, 0.1474], [0.2177, 0.1019]], y: [-0.0861, -0.0581], dihedral: 8.7, hinge: [[0.2349, -0.0661, 0.0715], [0.331, -0.0506, 0.1147]], angle: 35, slide: [0, -0.003, 0.0225] },
        ],
        brakes: [
            { top: [[0.1115, -0.0163], [0.1743, 0.0145], [0.1673, 0.0368], [0.0995, 0.0019]], y: [-0.0922, -0.0711], dihedral: 8.7, hinge: [[0.1115, -0.0821, -0.0163], [0.1743, -0.0726, 0.0145]], angle: -40, skin: 1 },
            { top: [[0.2514, 0.0525], [0.3213, 0.0869], [0.3093, 0.1038], [0.2439, 0.0708]], y: [-0.0721, -0.0551], dihedral: 8.7, hinge: [[0.2514, -0.0646, 0.0525], [0.3213, -0.0536, 0.0869]], angle: -40, skin: 1 },
        ],
    },

};
// EA-18G: the F/A-18F airframe with the same bounding box (tools/aircraft/ea18g.py), so the Super Hornet's surfaces
SURFACE_DEFS.ea18g = SURFACE_DEFS.fa18;

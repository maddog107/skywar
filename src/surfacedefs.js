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

};

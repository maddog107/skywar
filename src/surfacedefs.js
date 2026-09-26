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

    // ── European types, bombers, airliners, light aircraft ──

};

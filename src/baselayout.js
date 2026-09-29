// ═══════════════════════════════════════════════════════════════
// Airbase layouts (docs/WAR.md, "Airbases"): where everything on a military airfield is, in base-local metres
// (x across the runway, + toward the apron; z along it — see world.js baseToWorld). Plain data, no three.js, so the
// logic (basestate.js) and the tests use it as the renderer does.
//
// The two 'standard' fields (SKYWAR AIR BASE and the enemy's) share one plan, drawn from NATO and Warsaw Pact
// practice of the 1980s–2000s:
//  • a dispersed hardened-aircraft-shelter area off the parallel taxiway (two lanes, three shelters each, doors
//    facing the lane, staggered so one stick of bombs can't take out every door) — the TAB-V shelter sites at
//    Spangdahlem and Bitburg, the "arochnoye" shelter groups at Soviet fields;
//  • a Quick Reaction Alert facility right by the departure end (two alert shelters and the crew building between
//    them, so the jets roll straight onto the runway: RAF Coningsby / Lossiemouth QRA, the "dezhurnoye zveno"
//    stands at Soviet fields);
//  • fuel (POL) and the munitions storage area (earth-covered igloos, quantity-distance spacing) at the ends of the
//    field away from the runway, the power plant by the technical area, the rapid-runway-repair equipment yard by
//    the gate (RADR: excavator / loader, dump trucks, crews).
// Landing and takeoff run toward −z (the player's runway start and the painted designators agree): the approach
// lights stand beyond the +z end, the alert jets line up there.
// ═══════════════════════════════════════════════════════════════

// ── paved surfaces (rects in base-local metres: x0, x1, z0, z1) ──
// kind: 'runway' | 'taxiway' | 'apron'; own: drawn by us (the rest by world.js / airbase.js already)
const STD_PAVED = [
    { kind: 'taxiway', x0: 129, x1: 151, z0: -1200, z1: 1200 },                     // parallel taxiway (world.js)
    { kind: 'apron', x0: 180, x1: 400, z0: -110, z1: 410 },                          // main apron (world.js)
    { kind: 'taxiway', x0: 50, x1: 140, z0: -909, z1: -891 },                        // connectors (world.js)
    { kind: 'taxiway', x0: 50, x1: 140, z0: -9, z1: 9 },
    { kind: 'taxiway', x0: 50, x1: 140, z0: 891, z1: 909 },
    // ours: close the gaps world.js leaves, and the new lanes
    { kind: 'taxiway', x0: 27.5, x1: 50, z0: -909, z1: -891, own: true },            // connector stubs to the runway edge
    { kind: 'taxiway', x0: 27.5, x1: 50, z0: -9, z1: 9, own: true },
    { kind: 'taxiway', x0: 27.5, x1: 50, z0: 891, z1: 909, own: true },
    { kind: 'taxiway', x0: 151, x1: 180, z0: -12, z1: 12, own: true },               // apron links
    { kind: 'taxiway', x0: 151, x1: 180, z0: 288, z1: 312, own: true },
    { kind: 'taxiway', x0: 129, x1: 151, z0: 1200, z1: 1455, own: true },            // taxiway north to the alert pad
    { kind: 'apron', x0: 27.5, x1: 205, z0: 1455, z1: 1515, own: true },             // QRA apron, onto the runway end
    { kind: 'apron', x0: 83, x1: 107, z0: 1515, z1: 1541, own: true },               // QRA shelter lead-ins
    { kind: 'apron', x0: 153, x1: 177, z0: 1515, z1: 1541, own: true },
    { kind: 'taxiway', x0: 151, x1: 510, z0: 792.5, z1: 807.5, own: true },          // shelter lane N1
    { kind: 'taxiway', x0: 151, x1: 510, z0: 1192.5, z1: 1207.5, own: true },        // shelter lane N2
    { kind: 'apron', x0: 217, x1: 243, z0: 807.5, z1: 822.5, own: true },            // shelter lead-ins, row 1 (doors south)
    { kind: 'apron', x0: 317, x1: 343, z0: 807.5, z1: 822.5, own: true },
    { kind: 'apron', x0: 417, x1: 443, z0: 807.5, z1: 822.5, own: true },
    { kind: 'apron', x0: 267, x1: 293, z0: 1177.5, z1: 1192.5, own: true },          // row 2 (doors north)
    { kind: 'apron', x0: 367, x1: 393, z0: 1177.5, z1: 1192.5, own: true },
    { kind: 'apron', x0: 467, x1: 493, z0: 1177.5, z1: 1192.5, own: true },
];

// hardened aircraft shelters: centre, facing (the way the door looks: −1 = toward −z, +1 = toward +z)
const STD_HAS = [
    { id: 'has1', lx: 230, lz: 841.5, face: -1, lane: 'n1' }, { id: 'has2', lx: 330, lz: 841.5, face: -1, lane: 'n1' }, { id: 'has3', lx: 430, lz: 841.5, face: -1, lane: 'n1' },
    { id: 'has4', lx: 280, lz: 1158.5, face: 1, lane: 'n2' }, { id: 'has5', lx: 380, lz: 1158.5, face: 1, lane: 'n2' }, { id: 'has6', lx: 480, lz: 1158.5, face: 1, lane: 'n2' },
];
// the alert (QRA) shelters by the departure end, doors toward the QRA apron
const STD_QRA = [{ id: 'qra1', lx: 95, lz: 1560, face: -1, alert: true }, { id: 'qra2', lx: 165, lz: 1560, face: -1, alert: true }];

// Taxi graph (nodes: base-local [lx, lz]). Edges carry their width (for crater closures).
const STD_NODES = {
    // runway centreline: the departure (line-up) point at the +z end, the exits
    rw_n: [0, 1480], rw_900: [0, 900], rw_0: [0, 0], rw_m900: [0, -900], rw_s: [0, -1440],
    // parallel taxiway
    tw_m1200: [140, -1200], tw_m900: [140, -900], tw_0: [140, 0], tw_300: [140, 300], tw_800: [140, 800], tw_900: [140, 900], tw_1200: [140, 1200], tw_1485: [140, 1485],
    // QRA apron
    qra_w: [40, 1485], qra_a1: [95, 1485], qra_a2: [165, 1485], qra1_f: [95, 1525], qra2_f: [165, 1525], qra1_in: [95, 1562], qra2_in: [165, 1562],
    // apron
    ap_0: [195, 0], ap_300: [195, 300],
    // shelter lanes and lead-ins
    n1_230: [230, 800], n1_330: [330, 800], n1_430: [430, 800], n1_end: [500, 800],
    n2_280: [280, 1200], n2_380: [380, 1200], n2_480: [480, 1200], n2_end: [500, 1200],
    has1_f: [230, 815], has2_f: [330, 815], has3_f: [430, 815], has4_f: [280, 1185], has5_f: [380, 1185], has6_f: [480, 1185],
    has1_in: [230, 845], has2_in: [330, 845], has3_in: [430, 845], has4_in: [280, 1155], has5_in: [380, 1155], has6_in: [480, 1155],
};
const W_RWY = 55, W_TW = 22, W_LANE = 15, W_PAD = 24;
const STD_EDGES = [
    ['rw_n', 'rw_900', W_RWY], ['rw_900', 'rw_0', W_RWY], ['rw_0', 'rw_m900', W_RWY], ['rw_m900', 'rw_s', W_RWY],
    ['tw_m1200', 'tw_m900', W_TW], ['tw_m900', 'tw_0', W_TW], ['tw_0', 'tw_300', W_TW], ['tw_300', 'tw_800', W_TW], ['tw_800', 'tw_900', W_TW], ['tw_900', 'tw_1200', W_TW], ['tw_1200', 'tw_1485', W_TW],
    ['tw_m900', 'rw_m900', 18], ['tw_0', 'rw_0', 18], ['tw_900', 'rw_900', 18],
    ['tw_1485', 'qra_a2', W_PAD], ['qra_a2', 'qra_a1', W_PAD], ['qra_a1', 'qra_w', W_PAD], ['qra_w', 'rw_n', W_PAD],
    ['qra_a1', 'qra1_f', W_PAD], ['qra1_f', 'qra1_in', W_PAD], ['qra_a2', 'qra2_f', W_PAD], ['qra2_f', 'qra2_in', W_PAD],
    ['tw_0', 'ap_0', 24], ['tw_300', 'ap_300', 24],
    ['tw_800', 'n1_230', W_LANE], ['n1_230', 'n1_330', W_LANE], ['n1_330', 'n1_430', W_LANE], ['n1_430', 'n1_end', W_LANE],
    ['tw_1200', 'n2_280', W_LANE], ['n2_280', 'n2_380', W_LANE], ['n2_380', 'n2_480', W_LANE], ['n2_480', 'n2_end', W_LANE],
    ['n1_230', 'has1_f', W_PAD], ['has1_f', 'has1_in', W_PAD], ['n1_330', 'has2_f', W_PAD], ['has2_f', 'has2_in', W_PAD], ['n1_430', 'has3_f', W_PAD], ['has3_f', 'has3_in', W_PAD],
    ['n2_280', 'has4_f', W_PAD], ['has4_f', 'has4_in', W_PAD], ['n2_380', 'has5_f', W_PAD], ['has5_f', 'has5_in', W_PAD], ['n2_480', 'has6_f', W_PAD], ['has6_f', 'has6_in', W_PAD],
];

// the standard field's installations (base-local). team-specific extras are added per base below.
const STD = {
    paved: STD_PAVED,
    shelters: [...STD_QRA, ...STD_HAS],
    taxi: { nodes: STD_NODES, edges: STD_EDGES },
    // takeoff toward −z from the +z end: taxi to the entry node, then line up (lead, number two in echelon right)
    depart: { node: 'rw_n', entry: 'qra_w', heading: -1, lineup: [[-8, 1476], [9, 1452]] },
    landing: { dir: -1, exit: ['rw_0', 'rw_m900'] },                          // landing toward −z, turning off at the first exit it can
    tower: { lx: 230, lz: -200 },
    radar: { lx: 120, lz: -430, range: 60000 },                              // the approach / surveillance radar (airbase.js)
    power: { lx: 500, lz: -480, yaw: 0 },
    fuel: [{ lx: 480, lz: -700 }, { lx: 520, lz: 420 }],                     // POL: bulk tanks (ground.js 'fuel' sites)
    ammo: [{ lx: 250, lz: -1470 }, { lx: 350, lz: -1470 }, { lx: 250, lz: -1620 }, { lx: 350, lz: -1620 }], // igloos, doors north
    depot: { lx: 490, lz: -225 },                                            // RADR equipment yard (repair crews start here)
    qraHut: { lx: 130, lz: 1566 },
    sirens: [{ lx: 255, lz: -170 }, { lx: 190, lz: 1000 }, { lx: 130, lz: 1605 }, { lx: 300, lz: -1300 }, { lx: -110, lz: 0 }],
    searchlights: [{ lx: -150, lz: -1350 }, { lx: -150, lz: 0 }, { lx: -150, lz: 1350 }, { lx: 545, lz: -1350 }, { lx: 545, lz: 60 }, { lx: 545, lz: 1400 }],
    floods: [{ lx: 176, lz: -60 }, { lx: 176, lz: 360 }, { lx: 404, lz: 150 }, { lx: 40, lz: 1528 }, { lx: 208, lz: 1528 }, { lx: 280, lz: 822 }, { lx: 380, lz: 822 }, { lx: 330, lz: 1177 }, { lx: 430, lz: 1177 }],
    bunkers: [{ lx: 210, lz: -330 }, { lx: 190, lz: 440 }, { lx: 280, lz: 1000 }, { lx: 205, lz: 1570 }, { lx: 300, lz: -1340 }],
    dispersal: [{ lx: 540, lz: -1150 }, { lx: 545, lz: 640 }, { lx: 545, lz: 980 }, { lx: -120, lz: -650 }, { lx: -120, lz: 650 }, { lx: 420, lz: 1450 }, { lx: 470, lz: -1480 }],
    stands: [{ lx: 335, lz: 200 }, { lx: 335, lz: 240 }, { lx: 335, lz: 285 }, { lx: 335, lz: 330 }, { lx: 335, lz: 372 }],
    // lighting: the landing direction's approach system, the other end's, PAPI side (−1: −x) at the touchdown point
    lights: { rw: [{ alsPrimary: 'alsf2', alsOther: 'malsr', papiSide: -1 }], beacon: { lx: 262, lz: -238, military: true } },
};

const HOME_EXTRA = {
    pads: [{ id: 'himars', kind: 'launcher', lx: -120, lz: -1560, yaw: Math.PI, name: 'HARDENED LAUNCH PAD' }],
    aaa: [{ lx: 250, lz: 690 }, { lx: -110, lz: 340 }, { lx: 60, lz: 1620 }],
};
const ENEMY_EXTRA = {
    // an S-300PS battery on hardened, revetted pads at the north-west corner (launchers erect when the base goes
    // to alert) with its Flap Lid engagement radar
    pads: [{ id: 's300a', kind: 'sam', lx: -125, lz: 1380, yaw: 0, name: 'S-300PS LAUNCHER' }, { id: 's300b', kind: 'sam', lx: -125, lz: 1560, yaw: 0, name: 'S-300PS LAUNCHER' },
        { id: 'flaplid', kind: 'samradar', lx: -155, lz: 1470, yaw: 0, name: '30N6 FLAP LID RADAR' }],
    aaa: [],
    // Soviet / Russian fields: an ICAO "Calvert"-style approach system
    lights: { rw: [{ alsPrimary: 'calvert', alsOther: 'simple', papiSide: -1 }], beacon: { lx: 262, lz: -238, military: true } },
};

// MCAS Miramar (layout 'miramar'): no shelters or alert pad (the Marines keep their Hornets on the flight line);
// its tower, radar, three runways, fuel, magazine and power
const MIRAMAR = {
    paved: null, // airbase.js records its pave() rects (info.paved)
    shelters: [],
    taxi: null,
    tower: { lx: 640, lz: -1650 },
    radar: { lx: 560, lz: -1900, range: 60000 },
    power: { lx: 950, lz: -1250, yaw: 0 },
    fuel: [{ lx: 1100, lz: 1650 }, { lx: 1180, lz: 1760 }],
    ammo: [{ lx: 1250, lz: -1950 }, { lx: 1340, lz: -1950 }, { lx: 1250, lz: -2060 }],
    depot: { lx: 880, lz: -600 },
    sirens: [{ lx: 700, lz: -1500 }, { lx: 600, lz: 0 }, { lx: 600, lz: 1400 }, { lx: 1100, lz: -900 }],
    searchlights: [{ lx: -850, lz: -2000 }, { lx: -850, lz: 0 }, { lx: -850, lz: 2000 }, { lx: 1400, lz: -2000 }, { lx: 1400, lz: 2000 }],
    floods: [{ lx: 0, lz: -1200 }, { lx: 0, lz: -400 }, { lx: 0, lz: 400 }, { lx: 0, lz: 1100 }, { lx: 620, lz: -1200 }, { lx: 620, lz: -400 }, { lx: 620, lz: 400 }, { lx: 620, lz: 1100 }],
    bunkers: [{ lx: 760, lz: -900 }, { lx: 760, lz: 300 }],
    dispersal: [{ lx: 1400, lz: -1000 }, { lx: 1400, lz: 800 }, { lx: -800, lz: -1200 }],
    stands: [],
    lights: { rw: [{ alsPrimary: 'alsf2', alsOther: 'malsr', papiSide: -1 }, { alsPrimary: 'malsr', alsOther: 'none', papiSide: -1 }, { alsPrimary: 'none', alsOther: 'none', papiSide: -1 }], beacon: { lx: 660, lz: -1700, military: true } },
};

// Harbor International: a civil airport — lights only (FAA civil beacon: alternating white and green)
const CIVIL = {
    paved: null, shelters: [], taxi: null, tower: { lx: 640, lz: 950 },
    floods: [{ lx: 330, lz: -1000 }, { lx: 330, lz: -500 }, { lx: 330, lz: 150 }, { lx: 330, lz: 600 }, { lx: 330, lz: 1100 }],
    lights: { rw: [{ alsPrimary: 'alsf2', alsOther: 'malsr', papiSide: -1 }], beacon: { lx: 660, lz: 1000, military: false } },
};

const cache = new Map();
// the layout of a base (BASES entry): merged plan for its layout and team; null for bases we don't model
export function baseLayout(b) {
    if (!b) return null;
    if (cache.has(b.id)) return cache.get(b.id);
    let L = null;
    if (b.layout === 'standard') {
        const extra = b.friendly ? HOME_EXTRA : ENEMY_EXTRA;
        L = { ...STD, ...extra, lights: extra.lights || STD.lights, military: true };
    } else if (b.layout === 'miramar') L = { ...MIRAMAR, pads: [], aaa: [], military: true };
    else if (b.layout === 'civil') L = { ...CIVIL, military: false };
    if (L) L.base = b;
    cache.set(b.id, L);
    return L;
}

// ── plain geometry helpers (base-local; no three.js) ──
// distance from (x, z) to the segment a–b, and the parameter along it
export function segDist(ax, az, bx, bz, x, z) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    return { d: Math.hypot(ax + dx * t - x, az + dz * t - z), t };
}
// is (lx, lz) on one of these paved rects (grown by pad)? Returns the rect or null
export function pavedAt(rects, lx, lz, pad = 0) {
    if (!rects) return null;
    for (const r of rects) if (lx >= r.x0 - pad && lx <= r.x1 + pad && lz >= r.z0 - pad && lz <= r.z1 + pad) return r;
    return null;
}
// runways of a base as rects in their own frame: { i, rw, cx, cz, c, s, half, hw } (c, s: the runway's rotation
// in the base frame, so a point maps to runway-local u (across) / v (along) with u = dx·c − dz·s, v = dx·s + dz·c)
export function runwayFrames(b) {
    return b.runways.map((rw, i) => {
        const r = -(rw.rot || 0);
        return { i, rw, cx: rw.lx, cz: rw.lz, c: Math.cos(r), s: Math.sin(r), half: rw.len / 2, hw: rw.w / 2 };
    });
}
// base-local → a runway's own (u across, v along)
export function toRunway(F, lx, lz, out = {}) {
    const dx = lx - F.cx, dz = lz - F.cz;
    out.u = dx * F.c - dz * F.s; out.v = dx * F.s + dz * F.c;
    return out;
}
export function fromRunway(F, u, v, out = {}) {
    // inverse rotation of toRunway
    out.lx = F.cx + u * F.c + v * F.s; out.lz = F.cz - u * F.s + v * F.c;
    return out;
}

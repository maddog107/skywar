// ═══════════════════════════════════════════════════════════════
// Underground complexes (docs/WAR.md, underground.js): where they are, what they're made of, and the ground works
// that go with them — plain data and arithmetic, no three.js, because terrainHeight (terraincore.js) carves the same
// ground on the main thread, in the terrain workers and in the map workers.
//
// Each site has a local frame: origin o (world x, z) and th, the direction out of the mountain (radians clockwise
// from north). u runs across it (to the right, looking out), v out of the mountain; world = o + u·U + v·V with
// U = (cos th, sin th), V = (sin th, −cos th). Everything below is in that frame, heights in metres above sea level.
//
// The carve (ugCarve) is a sequence of primitives, each continuous in (x, z) and fading back to the ground it was
// given at the edge of its reach, applied in order (so the result is continuous too):
//   pad      an oriented rectangle graded to a line (runway, aprons, launch pads), cut and fill slopes around it
//   capsule  a road / taxiway segment (a polyline is a chain of them), graded from one end's height to the other's
//   notch    a portal's cutting: a flat floor running into the hillside, splayed wing walls, the headwall over the
//            facade (cut only: it never raises the ground)
// Tunnels and halls are below the surface: ugTunnelFloor(x, z, y) says when a point is inside one (physics, cameras).
// ═══════════════════════════════════════════════════════════════

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// ── The complexes ──
// portals: { id, kind: 'air' | 'tel' | 'service', u, v (front face of the facade), floor, face: [width, height, depth],
//   open: [width, height] (the door opening), bore: [width, height] (the tunnel behind it), notch: length of the
//   cutting in front, splay (wing walls, m out per m along), door: 'slide' | 'swing' }
// tubes: the tunnels and halls, swept along a centre line: { id, ends: [portal id | null, …], pts: [[u, v, w, h, y, r],
//   …] } — at each point the bore's width and height, its floor, and r the radius the centre line bends round there;
//   bore and floor change linearly between points. A tube starts just outside its first portal's front face.
// props: where things stand (u, v in the site frame; heights from the ground): vents (air shafts from the halls, warm),
//   masts, guard posts, the substation, the power line (a pylon chain), camouflage nets over the cuttings, tracks
export const UG_SITES = [
    {
        // An Objekat 505 / Željava-style underground airbase: portals in the eastern foot of a massif, a hangar hall
        // parallel to the face that the two aircraft tunnels join (a drive-through loop), a runway on the plain 1.1 km out
        id: 'north', kind: 'air', name: 'ZHELEZNAYA GORA', o: [32400, -43600], th: 90 * DEG,
        label: { unknown: 'UNKNOWN FACILITY', possible: 'POSSIBLE UNDERGROUND HANGARS', confirmed: 'CONFIRMED UNDERGROUND AIRBASE' },
        portals: [
            { id: 'N1', kind: 'air', u: -160, v: 110, floor: 64, face: [46, 18, 8], open: [22, 9.5], bore: [24, 12.5], notch: 120, splay: 0.22, door: 'slide' },
            { id: 'N2', kind: 'air', u: 160, v: 110, floor: 64, face: [46, 18, 8], open: [22, 9.5], bore: [24, 12.5], notch: 120, splay: 0.22, door: 'slide' },
            { id: 'N3', kind: 'service', u: -430, v: 100, floor: 64, face: [22, 12, 6], open: [8, 6.5], bore: [9, 7.5], notch: 90, splay: 0.18, door: 'swing' },
        ],
        tubes: [
            // N1 → the hangar hall (32 × 15 m, 220 m long) → N2
            { id: 'hangar', ends: ['N1', 'N2'], pts: [
                [-160, 111, 24, 12.5, 64, 0], [-160, -55, 24, 12.5, 64, 34], [-100, -55, 32, 15, 64, 0], [100, -55, 32, 15, 64, 0],
                [160, -55, 24, 12.5, 64, 34], [160, 111, 24, 12.5, 64, 0]] },
            // N3 → the stores gallery (fuel, weapons, workshops)
            { id: 'stores', ends: ['N3', null], pts: [
                [-430, 101, 9, 7.5, 64, 0], [-430, -30, 9, 7.5, 64, 16], [-395, -30, 14, 9, 64, 0], [-255, -30, 14, 9, 64, 0]] },
        ],
        runway: { u: 0, v: 1100, ang: 0, len: 2200, w: 45, y: 44, grade: 0, over: 70 },
        pads: [
            // the apron strip in front of the portals
            { u: -130, v: 258, ang: 0, len: 700, w: 78, y: 64, cut: 1.2, fill: 0.9, reach: 90 },
            // the alert pad by the runway's south end, the turn-round
            { u: 1000, v: 1040, ang: 0, len: 160, w: 60, y: 44, cut: 1, fill: 0.8, reach: 70 },
            // the support compound NW of the runway: substation, fuel, barracks, the guard post
            { u: -1180, v: 700, ang: 0, len: 150, w: 110, y: 34, cut: 1, fill: 0.8, reach: 60 },
        ],
        roads: [
            // the taxiway: down off the apron and along the plain to the runway's south end
            { w: 23, pts: [[150, 292, 64], [220, 520, 53], [330, 850, 46.5], [900, 1030, 44.2], [1030, 1070, 44]], cut: 1.1, fill: 0.9, reach: 70, kind: 'taxi' },
            // the service road: from the north end of the apron to the support compound, and on out to the north-east
            { w: 8, pts: [[-480, 270, 64], [-700, 340, 55], [-1000, 470, 42], [-1110, 640, 35], [-1300, 760, 34], [-1700, 900, 36], [-2300, 1150, 38]], cut: 1, fill: 0.8, reach: 45, kind: 'road' },
        ],
        props: {
            vents: [[-120, -235], [20, -265], [140, -215], [-330, -150]],
            masts: [[-250, -420], [-160, -385]],
            guards: [[-720, 346, 0.3], [205, 305, 0]],
            substation: [-1150, 650],
            power: [[-2900, 1500], [-2500, 1330], [-2100, 1160], [-1700, 990], [-1400, 830], [-1180, 690], [-1010, 520], [-780, 390], [-580, 300], [-455, 200], [-440, 150]],
            nets: ['N1', 'N2', 'N3'],
            tracks: [[[-480, 250], [-330, 140], [-300, 20], [-330, -150]]],
        },
    },
    {
        // A missile operating base (Sakkanmol / "missile city" style): three portals in a ridge above a lake; the TEL
        // garage hall behind them is a drive-through loop between E1 and E2; launch pads on the rise east of the yard
        id: 'east', kind: 'missile', name: 'KAMENNY LOG', o: [35200, -23800], th: 90 * DEG,
        label: { unknown: 'UNKNOWN FACILITY', possible: 'POSSIBLE MISSILE STORAGE', confirmed: 'CONFIRMED UNDERGROUND MISSILE FACILITY' },
        portals: [
            { id: 'E1', kind: 'tel', u: 0, v: 5, floor: 22, face: [24, 13, 7], open: [9, 7], bore: [10, 8.5], notch: 60, splay: 0.3, door: 'slide' },
            { id: 'E2', kind: 'tel', u: -250, v: 0, floor: 22, face: [24, 13, 7], open: [9, 7], bore: [10, 8.5], notch: 60, splay: 0.25, door: 'slide' },
            { id: 'E3', kind: 'service', u: 210, v: 45, floor: 33, face: [18, 10, 6], open: [6, 5], bore: [7, 6], notch: 50, splay: 0.2, door: 'swing' },
        ],
        tubes: [
            // E1 → the TEL garage (26 × 13 m, 170 m long) → E2
            { id: 'garage', ends: ['E1', 'E2'], pts: [
                [0, 6, 10, 8.5, 22, 0], [0, -150, 10, 8.5, 22, 24], [-45, -150, 26, 13, 22, 0], [-205, -150, 26, 13, 22, 0],
                [-250, -150, 10, 8.5, 22, 24], [-250, 1, 10, 8.5, 22, 0]] },
            // E3 → the missile magazine and the command post
            { id: 'magazine', ends: ['E3', null], pts: [
                [210, 46, 7, 6, 33, 0], [210, -60, 7, 6, 31, 12], [175, -60, 16, 10, 30, 0], [60, -60, 16, 10, 30, 0]] },
        ],
        pads: [
            // the yard in front of the portals
            { u: -110, v: 90, ang: 0, len: 380, w: 80, y: 22, cut: 1.1, fill: 0.9, reach: 70 },
            { u: 170, v: 110, ang: 0, len: 150, w: 60, y: 30, cut: 1.1, fill: 0.9, reach: 60 },
            // launch pads (pre-surveyed, concrete) on the rise
            { u: -60, v: 385, ang: 20, len: 44, w: 30, y: 57, cut: 0.9, fill: 0.7, reach: 50 },
            { u: 235, v: 385, ang: -15, len: 44, w: 30, y: 86, cut: 0.9, fill: 0.7, reach: 50 },
            { u: 430, v: 270, ang: 30, len: 44, w: 30, y: 77, cut: 0.9, fill: 0.7, reach: 50 },
        ],
        roads: [
            // yard → the launch pads (gravel)
            { w: 8, pts: [[40, 125, 24], [70, 230, 38], [-10, 330, 52], [-60, 370, 57]], cut: 1, fill: 0.8, reach: 40, kind: 'track' },
            { w: 8, pts: [[70, 230, 38], [170, 300, 62], [230, 370, 85]], cut: 1, fill: 0.8, reach: 40, kind: 'track' },
            { w: 8, pts: [[170, 300, 62], [330, 290, 76], [420, 275, 77]], cut: 1, fill: 0.8, reach: 40, kind: 'track' },
            // the access road out to the south (to the landing on the coast)
            { w: 8, pts: [[240, 120, 30], [420, 150, 36], [620, 250, 58], [900, 380, 64], [1400, 520, 60]], cut: 1, fill: 0.8, reach: 45, kind: 'road' },
        ],
        props: {
            vents: [[-150, -262], [-40, -280], [80, -240], [150, -150]],
            masts: [[150, -400], [-500, -350]],
            guards: [[640, 262, 0.45], [285, 128, 0]],
            substation: [430, 190],
            power: [[1500, 560], [1200, 470], [900, 360], [650, 280], [430, 200], [320, 130], [230, 70]],
            nets: ['E1', 'E2', 'E3'],
            tracks: [[[40, 125], [70, 230], [170, 300], [235, 385]], [[70, 230], [-10, 330], [-60, 385]], [[-250, 60], [-150, 80], [0, 60]]],
        },
    },
];

// ═════════════ Frames ═════════════
export function siteToWorld(s, u, v, out = {}) {
    const c = Math.cos(s.th), sn = Math.sin(s.th);
    out.x = s.o[0] + u * c + v * sn;
    out.z = s.o[1] + u * sn - v * c;
    return out;
}
export function worldToSite(s, x, z, out = {}) {
    const c = Math.cos(s.th), sn = Math.sin(s.th), dx = x - s.o[0], dz = z - s.o[1];
    out.u = dx * c + dz * sn;
    out.v = dx * sn - dz * c;
    return out;
}
// a portal's own frame: origin on the floor at the middle of the facade's front face, V out of the mountain
export function portalFrame(s, p) {
    const w = siteToWorld(s, p.u, p.v);
    return { x: w.x, z: w.z, y: p.floor, ux: Math.cos(s.th), uz: Math.sin(s.th), vx: Math.sin(s.th), vz: -Math.cos(s.th), th: s.th };
}

// ═════════════ The carve ═════════════
// Primitives are compiled into world space once (below). Each has a bounding box: most of the world never gets
// past the site boxes.
const PRIMS = [];      // { site, bb: [x0, z0, x1, z1], f(x, z, h) → h }
const SITE_BB = [];    // per site, the union of its primitives' boxes
let enabled = true;

// the fade at the edge of a primitive's reach: 1 inside 70 %, 0 at the edge
const fade = (d, R) => (d <= R * 0.7 ? 1 : 1 - smooth01((d - R * 0.7) / (R * 0.3)));

// An oriented rectangle graded to y0 + grade·l (l along it), cut / fill slopes (rise per metre) beyond its edges
function padPrim(site, cx, cz, ax, az, hl, hw, y0, grade, cut, fill, R) {
    const e = hl + hw + R;
    return {
        site, kind: 'pad', bb: [cx - e, cz - e, cx + e, cz + e],
        paved(x, z, m) { const dx = x - cx, dz = z - cz; return Math.abs(dx * ax + dz * az) < hl + m && Math.abs(-dx * az + dz * ax) < hw + m; },
        f(x, z, h) {
            const dx = x - cx, dz = z - cz;
            const l = dx * ax + dz * az, w = -dx * az + dz * ax;
            const qa = Math.abs(l) - hl, qb = Math.abs(w) - hw;
            const d = Math.hypot(qa > 0 ? qa : 0, qb > 0 ? qb : 0);
            if (d >= R) return h;
            const t = y0 + grade * clamp(l, -hl, hl);
            const lo = t - fill * d, hi = t + cut * d;
            const hc = h < lo ? lo : h > hi ? hi : h;
            return h + (hc - h) * fade(d, R);
        },
    };
}

// A road segment from a to b (world x, z, y), half width hw, graded from ya to yb
function capsulePrim(site, ax, az, ya, bx, bz, yb, hw, cut, fill, R) {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, e = hw + R;
    return {
        site, kind: 'capsule', bb: [Math.min(ax, bx) - e, Math.min(az, bz) - e, Math.max(ax, bx) + e, Math.max(az, bz) + e],
        paved(x, z, m) {
            let t = ((x - ax) * dx + (z - az) * dz) / L2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            return Math.hypot(x - ax - dx * t, z - az - dz * t) < hw + m;
        },
        f(x, z, h) {
            let t = ((x - ax) * dx + (z - az) * dz) / L2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = ax + dx * t, pz = az + dz * t;
            let d = Math.hypot(x - px, z - pz) - hw;
            if (d < 0) d = 0;
            if (d >= R) return h;
            const tg = ya + (yb - ya) * t;
            const lo = tg - fill * d, hi = tg + cut * d;
            const hc = h < lo ? lo : h > hi ? hi : h;
            return h + (hc - h) * fade(d, R);
        },
    };
}

// A portal's cutting (cut only). In the portal frame (u across, v out of the facade's front face): the floor runs
// from the facade out to the mouth, wing walls splay out from the facade corners (height face[1] there, nothing at
// wallLen), 2:1 rock cuts above them; behind the front face the ground ramps up under the facade block and then
// climbs steeply to meet the hillside.
// ramp: the ground's step up at the floor's edge (under the wing walls and the facade's sides, which are this thick)
export const NOTCH = { sSide: 2.0, sBack: 2.2, ramp: 1.0, wing: 28, reach: 55 };
function notchPrim(site, p) {
    const F = portalFrame(site, p);
    const [Wf, Hf, Tf] = p.face;
    const wn0 = Wf / 2 - NOTCH.ramp, Ln = p.notch, splay = p.splay || 0, R = NOTCH.reach;
    const wallLen = wingLength(p);
    const y0 = p.floor;
    const e = Math.max(wn0 + splay * (Ln + R), Tf) + Ln + R + 40;
    const cutUp = (u, v) => {
        // the upper bound of the ground at (u, v) above the floor
        const wn = wn0 + splay * Math.max(v, 0);
        const du = Math.abs(u) - wn;
        const wallH = v >= 0 ? Hf * Math.max(0, 1 - v / wallLen) : Hf;
        const side = du <= 0 ? 0 : wallH * Math.min(1, du / NOTCH.ramp) + NOTCH.sSide * Math.max(0, du - NOTCH.ramp);
        if (v >= 0) return side;
        const back = -v;
        const head = back <= Tf ? (Hf - 1.5) * (back / Tf) : (Hf - 1.5) + NOTCH.sBack * (back - Tf);
        return Math.max(side, head);
    };
    return {
        site, kind: 'notch', portal: p, bb: [F.x - e, F.z - e, F.x + e, F.z + e],
        // the cutting and its side cuts (steep, bare rock), and over the headwall
        paved(x, z, m) {
            const dx = x - F.x, dz = z - F.z;
            const u = dx * F.ux + dz * F.uz, v = dx * F.vx + dz * F.vz;
            return v > -Tf - 30 - m && v < Ln + m && Math.abs(u) < wn0 + splay * Math.max(v, 0) + 30 + m;
        },
        f(x, z, h) {
            const dx = x - F.x, dz = z - F.z;
            const u = dx * F.ux + dz * F.uz, v = dx * F.vx + dz * F.vz;
            // (outside its reach: behind the headwall, beyond the mouth, off to the sides)
            const wn = wn0 + splay * Math.max(v, 0);
            const ou = Math.max(0, Math.abs(u) - wn - R * 0.5), ov = Math.max(0, v - Ln, -v - Tf - R);
            const d = Math.hypot(ou, ov);
            if (d >= R) return h;
            const up = y0 + cutUp(u, v);
            if (h <= up) return h;
            return h + (up - h) * fade(d, R);
        },
    };
}

// the notch floor's half width at v (between the wing walls' inner faces), the wing walls' length and height at v
export function notchWidth(p, v) { return p.face[0] / 2 - NOTCH.ramp + (p.splay || 0) * Math.max(v, 0); }
export function wingLength(p) { return Math.min(p.wing || NOTCH.wing, p.notch * 0.6); }
export function wallHeight(p, v) { return v >= 0 ? p.face[1] * Math.max(0, 1 - v / wingLength(p)) : p.face[1]; }

function compile() {
    PRIMS.length = 0; SITE_BB.length = 0;
    const W = {}, W2 = {};
    for (const s of UG_SITES) {
        const first = PRIMS.length;
        const c = Math.cos(s.th), sn = Math.sin(s.th);
        // a direction at angle a (deg) from U, in world x, z
        const dir = (a) => { const r = a * DEG; return { x: c * Math.cos(r) + sn * Math.sin(r), z: sn * Math.cos(r) - c * Math.sin(r) }; };
        if (s.runway) {
            const r = s.runway, w = siteToWorld(s, r.u, r.v, W), d = dir(r.ang || 0);
            PRIMS.push(padPrim(s, w.x, w.z, d.x, d.z, r.len / 2 + (r.over || 0), r.w / 2 + 12, r.y, r.grade || 0, 1.0, 0.8, 140));
        }
        for (const p of s.pads || []) {
            const w = siteToWorld(s, p.u, p.v, W), d = dir(p.ang || 0);
            PRIMS.push(padPrim(s, w.x, w.z, d.x, d.z, p.len / 2, p.w / 2, p.y, p.grade || 0, p.cut ?? 1, p.fill ?? 0.8, p.reach ?? 60));
        }
        for (const r of s.roads || []) {
            for (let i = 1; i < r.pts.length; i++) {
                const a = siteToWorld(s, r.pts[i - 1][0], r.pts[i - 1][1], W), b = siteToWorld(s, r.pts[i][0], r.pts[i][1], W2);
                PRIMS.push(capsulePrim(s, a.x, a.z, r.pts[i - 1][2], b.x, b.z, r.pts[i][2], r.w / 2 + 1.5, r.cut ?? 1, r.fill ?? 0.8, r.reach ?? 45));
            }
        }
        for (const p of s.portals) PRIMS.push(notchPrim(s, p));
        const bb = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = first; i < PRIMS.length; i++) {
            const b = PRIMS[i].bb;
            bb[0] = Math.min(bb[0], b[0]); bb[1] = Math.min(bb[1], b[1]); bb[2] = Math.max(bb[2], b[2]); bb[3] = Math.max(bb[3], b[3]);
        }
        SITE_BB.push({ site: s, bb, from: first, to: PRIMS.length });
    }
}
compile();

// Natural height h at (x, z) → the ground as the complexes shape it (h everywhere else)
export function ugCarve(x, z, h) {
    if (!enabled) return h;
    for (let k = 0; k < SITE_BB.length; k++) {
        const S = SITE_BB[k], b = S.bb;
        if (x < b[0] || z < b[1] || x > b[2] || z > b[3]) continue;
        for (let i = S.from; i < S.to; i++) {
            const P = PRIMS[i], pb = P.bb;
            if (x < pb[0] || z < pb[1] || x > pb[2] || z > pb[3]) continue;
            h = P.f(x, z, h);
        }
    }
    return h;
}

// ═════════════ Tubes: the tunnels and halls ═════════════
// The bore: vertical walls to WALL_K of the height, then an elliptical arch to the crown. Its height at lateral
// offset x (0 on the axis) — the ceiling there
export const WALL_K = 0.42;
export function boreHeightAt(w, h, x) {
    const a = w / 2, t = Math.abs(x) / a;
    if (t >= 1) return 0;
    const hw = h * WALL_K;
    return hw + (h - hw) * Math.sqrt(1 - t * t);
}

// The centre line of a tube, sampled every ~`step` m: straight runs, circular bends of each point's radius, the bore
// and floor interpolated between the points (by distance along the line, from bend middle to bend middle).
// → [{ u, v, x, z, y (floor), tx, tz (unit tangent, world), w, h, s (m along) }]
export function tubeSamples(site, tube, step = 2) {
    const P = tube.pts, n = P.length;
    // the primitives: straights and arcs, in the site frame
    const segs = [];
    let cur = { u: P[0][0], v: P[0][1] };
    const anchors = [0];   // where each control point sits along the line (m)
    let len = 0;
    const put = (seg) => { segs.push(seg); len += seg.L; };
    for (let i = 1; i < n; i++) {
        const p = P[i];
        if (i < n - 1 && p[5] > 0) {
            const q = P[i + 1];
            let ix = p[0] - P[i - 1][0], iy = p[1] - P[i - 1][1];
            const il = Math.hypot(ix, iy); ix /= il; iy /= il;
            let ox = q[0] - p[0], oy = q[1] - p[1];
            const ol = Math.hypot(ox, oy); ox /= ol; oy /= ol;
            const phi = Math.acos(clamp(ix * ox + iy * oy, -1, 1));
            const r = p[5], d = r * Math.tan(phi / 2);
            const A = { u: p[0] - ix * d, v: p[1] - iy * d }, B = { u: p[0] + ox * d, v: p[1] + oy * d };
            put({ kind: 'line', a: { ...cur }, b: A, L: Math.hypot(A.u - cur.u, A.v - cur.v) });
            // the arc's centre: to the side the line turns
            const turn = Math.sign(ix * oy - iy * ox) || 1;
            const C = { u: A.u - iy * r * turn, v: A.v + ix * r * turn };
            const a0 = Math.atan2(A.v - C.v, A.u - C.u);
            put({ kind: 'arc', C, r, a0, da: phi * turn, L: r * phi });
            anchors.push(len - r * phi / 2);
            cur = B;
        } else {
            put({ kind: 'line', a: { ...cur }, b: { u: p[0], v: p[1] }, L: Math.hypot(p[0] - cur.u, p[1] - cur.v) });
            anchors.push(len);
            cur = { u: p[0], v: p[1] };
        }
    }
    const out = [], c = Math.cos(site.th), sn = Math.sin(site.th);
    let s0 = 0;
    for (let k = 0; k < segs.length; k++) {
        const g = segs[k], m = Math.max(1, Math.ceil(g.L / step));
        for (let j = k === 0 ? 0 : 1; j <= m; j++) {
            const f = j / m, s = s0 + g.L * f;
            let u, v, tu, tv;
            if (g.kind === 'line') {
                u = g.a.u + (g.b.u - g.a.u) * f; v = g.a.v + (g.b.v - g.a.v) * f;
                tu = (g.b.u - g.a.u) / (g.L || 1); tv = (g.b.v - g.a.v) / (g.L || 1);
            } else {
                const a = g.a0 + g.da * f;
                u = g.C.u + Math.cos(a) * g.r; v = g.C.v + Math.sin(a) * g.r;
                const sg = Math.sign(g.da); tu = -Math.sin(a) * sg; tv = Math.cos(a) * sg;
            }
            // bore and floor between the anchors
            let i = 0;
            while (i < anchors.length - 2 && s > anchors[i + 1]) i++;
            const t = clamp((s - anchors[i]) / Math.max(anchors[i + 1] - anchors[i], 1e-6), 0, 1);
            const A = P[i], B = P[i + 1];
            out.push({
                u, v, x: site.o[0] + u * c + v * sn, z: site.o[1] + u * sn - v * c,
                tx: tu * c + tv * sn, tz: tu * sn - tv * c,
                w: A[2] + (B[2] - A[2]) * t, h: A[3] + (B[3] - A[3]) * t, y: A[4] + (B[4] - A[4]) * t, s,
            });
        }
        s0 += g.L;
    }
    return out;
}

// Every tube's samples, and a hash of them for point lookups (built on first use)
const TUBES = [];
let tubeHash = null;
const HC = 24;
export function tubeList() {
    if (!TUBES.length) for (const site of UG_SITES) for (const tube of site.tubes || []) TUBES.push({ site, tube, samples: tubeSamples(site, tube) });
    return TUBES;
}
function buildTubeHash() {
    tubeHash = new Map();
    tubeList().forEach((T, ti) => T.samples.forEach((q, si) => {
        const r = q.w / 2 + 4;
        for (let cx = Math.floor((q.x - r) / HC); cx <= Math.floor((q.x + r) / HC); cx++) for (let cz = Math.floor((q.z - r) / HC); cz <= Math.floor((q.z + r) / HC); cz++) {
            const k = cx * 100003 + cz;
            let l = tubeHash.get(k);
            if (!l) tubeHash.set(k, l = []);
            l.push(ti, si);
        }
    }));
}

// Is (x, z, y) inside a tunnel or hall? → { floor, ceil (the arch over this spot), lat (m off the axis), w, h, t
// (the tube), i (its sample) } — or null. `pad`: extra room round the bore (m)
const _tub = { floor: 0, ceil: 0, lat: 0, w: 0, h: 0, t: null, i: 0, x: 0, z: 0 };
export function ugTunnelAt(x, z, y, pad = 0) {
    if (!enabled) return null;
    if (!tubeHash) buildTubeHash();
    const l = tubeHash.get(Math.floor(x / HC) * 100003 + Math.floor(z / HC));
    if (!l) return null;
    let best = -1, bd = Infinity;
    for (let k = 0; k < l.length; k += 2) {
        const q = TUBES[l[k]].samples[l[k + 1]], d = (x - q.x) * (x - q.x) + (z - q.z) * (z - q.z);
        if (d < bd) { bd = d; best = k; }
    }
    if (best < 0) return null;
    const T = TUBES[l[best]], i = l[best + 1], q = T.samples[i];
    const lat = (x - q.x) * -q.tz + (z - q.z) * q.tx; // + to the right of the way the samples run
    // (past the open ends: outside)
    const along = (x - q.x) * q.tx + (z - q.z) * q.tz;
    if ((i === 0 && along < -0.5) || (i === T.samples.length - 1 && along > 0.5)) return null;
    if (Math.abs(lat) > q.w / 2 + pad) return null;
    const ceil = q.y + Math.max(boreHeightAt(q.w, q.h, Math.min(Math.abs(lat), q.w / 2 - 0.01)), 0.5);
    if (y < q.y - 3 || y > ceil + 1 + pad) return null;
    _tub.floor = q.y; _tub.ceil = ceil; _tub.lat = lat; _tub.w = q.w; _tub.h = q.h; _tub.t = T; _tub.i = i; _tub.x = q.x; _tub.z = q.z;
    return _tub;
}

// Is (x, z) on a complex's paved or graded ground (runway, aprons, pads, roads, the cuttings), within `margin` m?
// (no trees or grass there; world.blockTree / world.noGrass)
export function ugPaved(x, z, margin = 4) {
    for (let k = 0; k < SITE_BB.length; k++) {
        const S = SITE_BB[k], b = S.bb;
        if (x < b[0] || z < b[1] || x > b[2] || z > b[3]) continue;
        for (let i = S.from; i < S.to; i++) {
            const P = PRIMS[i];
            if (P.paved && P.paved(x, z, margin)) return true;
        }
    }
    return false;
}

// tests: the world without the complexes (to prove the carve stays local)
export function setCarve(on) { enabled = !!on; }
export function carveBounds() { return SITE_BB.map(S => ({ id: S.site.id, bb: S.bb.slice() })); }
export function carvePrims() { return PRIMS; }

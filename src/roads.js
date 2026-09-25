// ═══════════════════════════════════════════════════════════════
// Road network: two-lane roads between towns and airbases, with painted
// markings, and bridges wherever a road crosses water.
// A road is stored as a path (polyline with arc length, height and cross-slope)
// so traffic and convoys can drive along it.
//   • roads leave a town from the end of one of its streets and arrive at an
//     airbase through its main gate, so they never run across a street grid
//   • junctions are proper patches of tarmac with kerb radii (junctionShape);
//     the ribbons stop at the junction mouths instead of overlapping
//   • the drawn terrain is shaped so it never pokes through a road (RoadGround)
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight, BASES, fenceOf, baseToWorld, worldToBase } from './world.js';
import { Bridge } from './bridges.js';
import { offsetUnits } from './util.js';

export const ROAD_HALF = 7;      // 14 m wide: two 7 m lanes
export const LANE = 3.3;          // lane centre offset from the middle
export const STREET_HALF = 5;     // town streets: 10 m of tarmac…
export const SIDEWALK = 2.5;      // …with a pavement either side
const STEP = 15; // dense enough that the ribbon follows the ground between samples
const MAX_BRIDGE = 1400, MIN_BRIDGE = 50;

// Keep roads outside airbase fences (they go round, not across the runway)
const FENCE_MARGIN = 35;
export function outsideBases(x, z, margin = FENCE_MARGIN) {
    for (const b of BASES) {
        const { lx, lz } = worldToBase(b, x, z);
        const FENCE = fenceOf(b);
        const x0 = FENCE.x0 - margin, x1 = FENCE.x1 + margin, z0 = FENCE.z0 - margin, z1 = FENCE.z1 + margin;
        if (lx > x0 && lx < x1 && lz > z0 && lz < z1) {
            // push to the nearest side of the fence
            const d = [lx - x0, x1 - lx, lz - z0, z1 - lz];
            const k = d.indexOf(Math.min(...d));
            const nlx = k === 0 ? x0 : k === 1 ? x1 : lx, nlz = k === 2 ? z0 : k === 3 ? z1 : lz;
            return { ...baseToWorld(b, nlx, nlz), base: b, side: k, lx: nlx, lz: nlz, box: [x0, x1, z0, z1] };
        }
    }
    return null;
}

function slopeAt(x, z) {
    const e = 20, h = terrainHeight(x, z);
    return (Math.abs(terrainHeight(x + e, z) - h) + Math.abs(terrainHeight(x, z + e) - h)) / (2 * e);
}

// ── Textures (v runs along the road, ROAD_V metres per repeat) ──
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, wrapS = THREE.ClampToEdgeWrapping) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = wrapS; t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}
function grain(ctx, w, h, n, base, spread, alpha) {
    for (let i = 0; i < n; i++) {
        const v = base + Math.random() * spread;
        ctx.fillStyle = `rgba(${v},${v},${v + 4},${alpha})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
}
// Asphalt with white edge lines and a dashed yellow centre line
function roadTexture() {
    const [c, ctx] = canvas(128, 256);
    ctx.fillStyle = '#4a4c4f';
    ctx.fillRect(0, 0, 128, 256);
    grain(ctx, 128, 256, 1400, 60, 40, 0.35);
    ctx.fillStyle = '#6a6b68'; // gravel shoulders
    ctx.fillRect(0, 0, 6, 256); ctx.fillRect(122, 0, 6, 256);
    ctx.fillStyle = '#d6d6cf'; // edge lines
    ctx.fillRect(8, 0, 5, 256); ctx.fillRect(115, 0, 5, 256);
    ctx.fillStyle = '#f5c518'; // dashed centre line
    ctx.fillRect(61, 0, 6, 150);
    return tex(c);
}
// Town street, 15 m across: pavements with slab joints and a kerb, tarmac, thin edge lines, dashed centre line
function streetTexture() {
    const W = 256, H = 256, px = W / (2 * (STREET_HALF + SIDEWALK)), sw = Math.round(SIDEWALK * px);
    const [c, ctx] = canvas(W, H);
    ctx.fillStyle = '#434548';
    ctx.fillRect(0, 0, W, H);
    grain(ctx, W, H, 2600, 55, 40, 0.3);
    // a few darker patches and cracks: a lived-in street
    for (let i = 0; i < 6; i++) { ctx.fillStyle = 'rgba(30,30,32,0.09)'; ctx.fillRect(sw + Math.random() * (W - 2 * sw - 30), Math.random() * H, 10 + Math.random() * 30, 8 + Math.random() * 40); }
    for (const x0 of [0, W - sw]) {
        ctx.fillStyle = '#a7a39a'; ctx.fillRect(x0, 0, sw, H);
        grain(ctx, sw, H, 500, 140, 40, 0.25);
        ctx.fillStyle = 'rgba(80,78,72,0.55)';
        for (let y = 0; y < H; y += H / 12) ctx.fillRect(x0, y, sw, 1.5); // slab joints every 2 m
        ctx.fillStyle = '#cfcbc1'; ctx.fillRect(x0 === 0 ? sw - 4 : x0, 0, 4, H); // kerb stones
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(sw, 0, 2, H); ctx.fillRect(W - sw - 2, 0, 2, H); // gutter
    ctx.fillStyle = '#d8d8d0';
    ctx.fillRect(sw + Math.round(0.45 * px), 0, 3, H); ctx.fillRect(W - sw - Math.round(0.45 * px) - 3, 0, 3, H);
    ctx.fillStyle = '#e8c53a';
    ctx.fillRect(W / 2 - 3, 0, 6, 140);
    return tex(c);
}
// plain tarmac for junction boxes (world-space UVs, tiles both ways)
function asphaltTexture() {
    const [c, ctx] = canvas(128, 128);
    ctx.fillStyle = '#45474a'; ctx.fillRect(0, 0, 128, 128);
    grain(ctx, 128, 128, 1400, 55, 40, 0.3);
    return tex(c, THREE.RepeatWrapping);
}
function concreteTexture() {
    const [c, ctx] = canvas(64, 64);
    ctx.fillStyle = '#a7a39a'; ctx.fillRect(0, 0, 64, 64);
    grain(ctx, 64, 64, 300, 140, 40, 0.25);
    ctx.fillStyle = 'rgba(80,78,72,0.5)'; ctx.fillRect(0, 0, 64, 1.5); ctx.fillRect(0, 0, 1.5, 64);
    return tex(c, THREE.RepeatWrapping);
}

// Distant terrain is drawn with coarser tiles, which can poke through a road that hugs the true ground.
// Lift road surfaces a little with distance from the camera so they never flicker or pop in and out.
// Anything that sits on a road (cars, buggies) gets the same lift, or it would sink into the road at range.
// The lift is applied in world space, so it works for instanced meshes too.
export const ROAD_LIFT = 2.6; // metres per km beyond 250 m
export function liftWithDistance(mat, perKm = ROAD_LIFT) {
    mat.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
            vec4 mvPosition = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
                mvPosition = instanceMatrix * mvPosition;
            #endif
            vec4 wpLift = modelMatrix * mvPosition;
            wpLift.y += max(0.0, distance(wpLift.xyz, cameraPosition) - 250.0) * ${(perKm / 1000).toFixed(5)};
            mvPosition = viewMatrix * wpLift;
            gl_Position = projectionMatrix * mvPosition;`);
    };
    mat.customProgramCacheKey = () => 'lift' + perKm;
    return mat;
}
// the same lift on the CPU, for single objects driving on roads (convoys)
export function roadLiftAt(x, y, z, cam) {
    return cam ? Math.max(0, Math.hypot(x - cam.x, y - cam.y, z - cam.z) - 250) * ROAD_LIFT / 1000 : 0;
}
const surfaceMat = (map, extra = {}) => liftWithDistance(new THREE.MeshStandardMaterial({ map, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: offsetUnits(-4), ...extra }));
let _roadMat = null, _streetMat = null, _junctionMat = null, _walkMat = null, _markMat = null;
export function roadMaterial() { return _roadMat || (_roadMat = surfaceMat(roadTexture())); }
export function streetMaterial() { return _streetMat || (_streetMat = surfaceMat(streetTexture())); }
export function junctionMaterial() { return _junctionMat || (_junctionMat = surfaceMat(asphaltTexture())); }
export function sidewalkMaterial() { return _walkMat || (_walkMat = surfaceMat(concreteTexture(), { roughness: 0.95 })); }
// painted lines laid over the tarmac (stop lines): pulled a little further forward
export function markMaterial() { return _markMat || (_markMat = liftWithDistance(new THREE.MeshStandardMaterial({ color: 0xe6e6de, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: offsetUnits(-8) }))); }
// bridges carry their own deck geometry, so their road surface must not be lifted
let _plainRoad = null;
export function plainRoadMaterial() {
    if (!_plainRoad) _plainRoad = new THREE.MeshStandardMaterial({ map: roadMaterial().map, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: offsetUnits(-2) });
    return _plainRoad;
}
export const ROAD_V = 24; // metres per texture repeat (one dash + gap)

// Path helpers ─────────────────────────────────────────────────
// path.pts: [{x, y, z, g, s, hw?}] (g = cross-slope, s = arc length, hw = half-width if not the path's own); path.len
export function samplePath(path, s, out, tangent) {
    const pts = path.pts;
    s = Math.max(0, Math.min(path.len, s));
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].s <= s) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi];
    const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    out.g = a.g + (b.g - a.g) * t;
    if (tangent) tangent.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    // bridges: follow the deck curve exactly
    for (const br of path.bridges) {
        if (s >= br.s0 && s <= br.s1) { out.y = br.bridge.deckY((s - br.s0) / (br.s1 - br.s0)); out.g = 0; break; }
    }
    return out;
}

// index of the path point at arc length s (a point is inserted there if there isn't one within 5 cm)
export function pointAt(path, s) {
    const P = path.pts;
    s = Math.max(0, Math.min(path.len, s));
    let lo = 0, hi = P.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
    if (Math.abs(P[lo].s - s) < 0.05) return lo;
    if (Math.abs(P[hi].s - s) < 0.05) return hi;
    const a = P[lo], b = P[hi], t = (s - a.s) / (b.s - a.s);
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, g: a.g + (b.g - a.g) * t, s };
    if (a.hw !== undefined || b.hw !== undefined) q.hw = (a.hw ?? b.hw) + ((b.hw ?? a.hw) - (a.hw ?? b.hw)) * t;
    P.splice(hi, 0, q);
    return hi;
}

// unit direction of travel at arc length s
export function tangentAt(path, s, out = { x: 0, z: 0 }) {
    const P = path.pts;
    let lo = 0, hi = P.length - 1;
    s = Math.max(0, Math.min(path.len, s));
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
    const dx = P[hi].x - P[lo].x, dz = P[hi].z - P[lo].z, L = Math.hypot(dx, dz) || 1;
    out.x = dx / L; out.z = dz / L;
    return out;
}

// ── Junctions ──
// A junction box: the arms (unit direction away from the centre, tarmac half-width w) meet with kerbs rounded to
// radius R. Returns the outline polygon [[x, z]…] (counter-clockwise by angle) and, per arm (input order), the stub
// length L: the arm's ribbon stops at distance L from the centre and the box takes over. With `fixedL` (the lengths
// of the tarmac box) and w, R grown/shrunk by the pavement width, the same call gives the pavement's outer edge:
// the kerb arcs are concentric and the arm ends line up.
export function junctionShape(cx, cz, arms, R, fixedL = null) {
    const A = arms.map((a, k) => ({ dx: a.dx, dz: a.dz, w: a.w, k, ang: Math.atan2(a.dz, a.dx), L: fixedL ? fixedL[k] : a.w + 1.5 }));
    A.sort((a, b) => a.ang - b.ang);
    const n = A.length;
    const corners = [];
    for (let i = 0; i < n; i++) {
        const a = A[i], b = A[(i + 1) % n];
        let alpha = b.ang - a.ang; if (alpha <= 1e-6) alpha += Math.PI * 2;
        if (n === 1) alpha = Math.PI * 2;
        // a's left edge: c + na*wa + da*t ; b's right edge: c - nb*wb + db*u  (n = direction turned +90°)
        const nax = -a.dz, naz = a.dx, nbx = -b.dz, nbz = b.dx;
        const px0 = nax * a.w, pz0 = naz * a.w, qx0 = -nbx * b.w, qz0 = -nbz * b.w;
        // solve p0 + da t = q0 + db u
        const det = a.dx * -b.dz - a.dz * -b.dx;
        let P = null;
        if (Math.abs(det) > 1e-6) {
            const rx = qx0 - px0, rz = qz0 - pz0;
            const t = (rx * -b.dz - rz * -b.dx) / det;
            P = { x: px0 + a.dx * t, z: pz0 + a.dz * t };
        }
        if (alpha < Math.PI - 0.06 && P) {
            const T = R / Math.tan(alpha / 2);
            const Ta = { x: P.x + a.dx * T, z: P.z + a.dz * T }, Tb = { x: P.x + b.dx * T, z: P.z + b.dz * T };
            let bx = a.dx + b.dx, bz = a.dz + b.dz; const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
            const C = { x: P.x + bx * R / Math.sin(alpha / 2), z: P.z + bz * R / Math.sin(alpha / 2) };
            if (!fixedL) { a.L = Math.max(a.L, Ta.x * a.dx + Ta.z * a.dz + 0.3); b.L = Math.max(b.L, Tb.x * b.dx + Tb.z * b.dz + 0.3); }
            corners.push({ kind: 'arc', Ta, Tb, C });
        } else if (alpha > Math.PI + 0.06 && P) corners.push({ kind: 'point', P });
        else corners.push({ kind: 'none' });
    }
    // chains[i]: the kerb from arm i's left end round the corner to the next arm's right end
    const poly = [], chains = [];
    const end = (a, side) => { const nax = -a.dz, naz = a.dx; return [cx + side * nax * a.w + a.dx * a.L, cz + side * naz * a.w + a.dz * a.L]; };
    for (let i = 0; i < n; i++) {
        const a = A[i], ch = [end(a, 1)];
        const c = corners[i];
        if (c.kind === 'arc') {
            let t0 = Math.atan2(c.Ta.z - c.C.z, c.Ta.x - c.C.x), t1 = Math.atan2(c.Tb.z - c.C.z, c.Tb.x - c.C.x);
            // the short way round (the kerb bulges toward the corner)
            let d = t1 - t0; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
            const seg = Math.max(2, Math.ceil(Math.abs(d) / 0.18));
            for (let k = 0; k <= seg; k++) { const t = t0 + d * k / seg; ch.push([cx + c.C.x + Math.cos(t) * R, cz + c.C.z + Math.sin(t) * R]); }
        } else if (c.kind === 'point') ch.push([cx + c.P.x, cz + c.P.z]);
        ch.push(end(A[(i + 1) % n], -1));
        chains.push(ch);
        poly.push(end(a, -1), ...ch.slice(0, -1));
    }
    const L = new Array(n);
    for (const a of A) L[a.k] = a.L;
    return { poly, L, chains };
}

// ── Geometry accumulators ──
// Ribbons along paths and flat polygons, world space, one mesh per material
export class SurfaceBuilder {
    constructor() { this.pos = []; this.uv = []; this.idx = []; }

    // the path's ribbon between arc lengths s0 and s1 (points exactly at s0/s1 must exist: see pointAt).
    // half: half-width (a point's own hw wins); v per metre along, u across 0..1
    // skirt: another builder that gets a sloping curtain hanging from both edges (depth metres), so where the
    // ground falls away beside the road you see an embankment, not daylight under the ribbon
    ribbon(path, s0, s1, half, vScale = 1 / ROAD_V, skirt = null, depth = 3) {
        const P = path.pts, pos = this.pos, uv = this.uv, idx = this.idx;
        let prev = null, prevS = null;
        for (let k = 0; k < P.length; k++) {
            const p = P[k];
            if (p.s < s0 - 0.01 || p.s > s1 + 0.01) continue;
            const Q = P[Math.min(k + 1, P.length - 1)], O = P[Math.max(k - 1, 0)];
            let tx = Q.x - O.x, tz = Q.z - O.z;
            const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
            const rx = -tz, rz = tx, hw = p.hw ?? half;
            const base = pos.length / 3;
            // one flat cross-section (what the cars drive on); the drawn terrain is shaped to meet it (RoadGround)
            const lx = p.x - rx * hw, ly = p.y - p.g * hw, lz = p.z - rz * hw, Rx = p.x + rx * hw, Ry = p.y + p.g * hw, Rz = p.z + rz * hw;
            pos.push(lx, ly, lz, Rx, Ry, Rz);
            uv.push(0, p.s * vScale, 1, p.s * vScale);
            if (prev !== null) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
            prev = base;
            if (skirt) {
                const sb = skirt.pos.length / 3, out = 0.3 + depth * 0.4;
                skirt.pos.push(lx, ly, lz, lx - rx * out, ly - depth, lz - rz * out, Rx, Ry, Rz, Rx + rx * out, Ry - depth, Rz + rz * out);
                const u = (p.x + p.z) / 12;
                skirt.uv.push(u, 0, u, depth / 12, u, 0, u, depth / 12);
                if (prevS !== null) {
                    // left curtain faces left (-r), right one faces right (+r): winding by the travel direction
                    skirt.idx.push(prevS, sb, prevS + 1, sb, sb + 1, prevS + 1);
                    skirt.idx.push(prevS + 2, prevS + 3, sb + 2, sb + 2, prevS + 3, sb + 3);
                }
                prevS = sb;
            }
        }
    }

    // a flat-ish polygon (outline [[x, z]…], optional holes) with heights from yAt(x, z), UVs in world metres * uvScale
    polygon(outline, holes, yAt, uvScale) {
        const contour = outline.map(([x, z]) => new THREE.Vector2(x, z));
        const hs = (holes || []).map(h => h.map(([x, z]) => new THREE.Vector2(x, z)));
        const faces = THREE.ShapeUtils.triangulateShape(contour, hs);
        const all = [...contour, ...hs.flat()];
        const base = this.pos.length / 3;
        for (const v of all) { this.pos.push(v.x, yAt(v.x, v.y), v.y); this.uv.push(v.x * uvScale, v.y * uvScale); }
        for (const [a, b, c] of faces) {
            const A = all[a], B = all[b], C = all[c];
            // face up (+y): (B - A) x (C - A) has a positive y component
            const up = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y) > 0;
            if (up) this.idx.push(base + a, base + b, base + c); else this.idx.push(base + a, base + c, base + b);
        }
    }

    // a flat quad strip across a road (a painted line): centre (x, z), along the unit direction (dx, dz)
    quad(x, z, dx, dz, halfLen, halfW, yAt) {
        const rx = -dz, rz = dx, base = this.pos.length / 3;
        for (const [a, b] of [[-halfLen, -halfW], [halfLen, -halfW], [halfLen, halfW], [-halfLen, halfW]]) {
            const px = x + dx * a + rx * b, pz = z + dz * a + rz * b;
            this.pos.push(px, yAt(px, pz), pz); this.uv.push(0, 0);
        }
        // (dx, dz) x-z order: pick the winding that faces up
        const up = (dz * rx - dx * rz) > 0;
        if (up) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }

    geometry() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setIndex(this.idx);
        g.computeVertexNormals();
        return g;
    }

    mesh(material) {
        const m = new THREE.Mesh(this.geometry(), material);
        m.receiveShadow = true;
        m.frustumCulled = false;
        return m;
    }
}

// ── Terrain meets the road ──
// The drawn terrain near a road is pulled to just under the road surface (cut through bumps, fill dips),
// then eased back to the natural ground over a shoulder, so roads sit in the landscape instead of
// floating over it or disappearing into it. Physics keeps the true terrain height.
// On top of that, the terrain vertices of the two finest tile resolutions (world.js draws a vertex every 21.3 m
// close up, 32 m further out) are solved so that no terrain triangle rises above any road, street, junction or
// trail surface anywhere — not just at its vertices (a hillside triangle spanning a 10 m street otherwise buries
// half of it).
const EDGE = 1.5, SHOULDER = 16, UNDER = 0.25, MARGIN = 0.1, FILL = 0.7;
const GRIDS = [2048 / 96, 2048 / 64];
export class RoadGround {
    // base(x, z, h): the ground before roads are cut in (e.g. a town's graded surface), or null
    constructor(paths, base = null) {
        this.cell = 64;
        this.grid = new Map();
        this.base = base;
        this.surfaces = [];
        this.solved = false;
        for (const p of paths) {
            const half = p.ribbonHalf ?? p.half ?? ROAD_HALF, reach = half + EDGE + SHOULDER, P = p.pts;
            for (let k = 0; k + 1 < P.length; k++) {
                const a = P[k], b = P[k + 1];
                if (p.bridges.some(br => b.s > br.s0 + 0.01 && a.s < br.s1 - 0.01)) continue; // the deck carries itself
                const L = Math.hypot(b.x - a.x, b.z - a.z);
                if (L < 0.01) continue;
                const seg = { a, b, L, tx: (b.x - a.x) / L, tz: (b.z - a.z) / L, half, reach };
                const c0x = Math.floor((Math.min(a.x, b.x) - reach) / this.cell), c1x = Math.floor((Math.max(a.x, b.x) + reach) / this.cell);
                const c0z = Math.floor((Math.min(a.z, b.z) - reach) / this.cell), c1z = Math.floor((Math.max(a.z, b.z) + reach) / this.cell);
                for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
                    const key = cx * 100003 + cz;
                    let list = this.grid.get(key);
                    if (!list) this.grid.set(key, list = []);
                    list.push(seg);
                }
            }
        }
    }

    // surfaces (world-space BufferGeometry) the terrain must stay under
    protect(geometry) { this.surfaces.push(geometry); this.solved = false; }

    // drawn height of the ground at (x, z), given its natural height h, before the solve
    baseConform(x, z, h) {
        if (this.base) h = this.base(x, z, h);
        if (h < 0) return h; // never build land out into a lake
        const list = this.grid.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
        if (!list) return h;
        let bestW = 0, target = h;
        for (const sg of list) {
            const t = Math.max(0, Math.min(sg.L, (x - sg.a.x) * sg.tx + (z - sg.a.z) * sg.tz));
            const px = sg.a.x + sg.tx * t, pz = sg.a.z + sg.tz * t;
            const lat = (x - px) * -sg.tz + (z - pz) * sg.tx; // + to the right of travel
            const d = Math.hypot(x - px, z - pz);
            if (d >= sg.reach) continue;
            const w = d <= sg.half + EDGE ? 1 : 1 - smooth01((d - sg.half - EDGE) / SHOULDER);
            if (w <= bestW) continue;
            const u = t / sg.L;
            const y = sg.a.y + (sg.b.y - sg.a.y) * u, g = (sg.a.g || 0) + ((sg.b.g || 0) - (sg.a.g || 0)) * u;
            bestW = w;
            target = y + g * Math.max(-sg.half, Math.min(sg.half, lat)) - UNDER;
        }
        return h + (target - h) * bestW;
    }

    // drawn height (what world.js asks for every terrain vertex)
    conform(x, z, h) {
        if (!this.solved) this.solve();
        let out = Infinity;
        for (let g = 0; g < GRIDS.length; g++) {
            const st = GRIDS[g], i = Math.round(x / st), j = Math.round(z / st);
            if (Math.abs(i * st - x) > 1e-3 || Math.abs(j * st - z) > 1e-3) continue;
            const v = this.over[g].get(vkey(i, j));
            if (v !== undefined && v < out) out = v;
        }
        return out < Infinity ? out : this.baseConform(x, z, h);
    }

    // the drawn ground at any point, as the close-up tiles draw it (for putting things on it)
    drawnAt(x, z) {
        const st = GRIDS[0], fx = x / st, fz = z / st, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
        const H = (a, b) => { const X = a * st, Z = b * st; return this.conform(X, Z, terrainHeight(X, Z)); };
        if (u + v <= 1) { const a = H(i, j); return a + (H(i + 1, j) - a) * u + (H(i, j + 1) - a) * v; }
        const d = H(i + 1, j + 1);
        return d + (H(i, j + 1) - d) * (1 - u) + (H(i + 1, j) - d) * (1 - v);
    }

    solve() {
        this.solved = true;
        this.over = GRIDS.map(st => this.solveGrid(st));
        this.surfaces = []; // done with them
    }

    // Kaczmarz sweeps over "terrain under the surface" constraints, taken exactly where they can bind: at the
    // surface's vertices, where its edges cross the terrain grid lines (both axes and the tile diagonal), and at
    // the terrain vertices under it. A few gentle fills first (so roads don't float over dips), cuts last.
    solveGrid(st) {
        const inv = 1 / st;
        const ids = new Map(), H = [];
        // a small direct-mapped cache in front of the map: neighbouring constraints share vertices
        const cK = new Float64Array(4096).fill(-1), cV = new Int32Array(4096);
        const vid = (i, j) => {
            const k = vkey(i, j), h = ((i * 73856093) ^ (j * 19349663)) & 4095;
            if (cK[h] === k) return cV[h];
            let v = ids.get(k);
            if (v === undefined) { v = H.length; ids.set(k, v); const x = i * st, z = j * st; H.push(this.baseConform(x, z, terrainHeight(x, z))); }
            cK[h] = k; cV[h] = v;
            return v;
        };
        let cap = 1 << 18, n = 0, V = new Int32Array(cap * 3), Wt = new Float32Array(cap * 3), Y = new Float32Array(cap);
        const add = (x, z, y) => {
            if (n === cap) {
                cap *= 2;
                const V2 = new Int32Array(cap * 3), W2 = new Float32Array(cap * 3), Y2 = new Float32Array(cap);
                V2.set(V); W2.set(Wt); Y2.set(Y); V = V2; Wt = W2; Y = Y2;
            }
            const fx = x * inv, fz = z * inv, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, o = n * 3;
            if (u + v <= 1) { V[o] = vid(i, j); V[o + 1] = vid(i + 1, j); V[o + 2] = vid(i, j + 1); Wt[o] = 1 - u - v; Wt[o + 1] = u; Wt[o + 2] = v; }
            else { V[o] = vid(i + 1, j + 1); V[o + 1] = vid(i, j + 1); V[o + 2] = vid(i + 1, j); Wt[o] = u + v - 1; Wt[o + 1] = 1 - u; Wt[o + 2] = 1 - v; }
            Y[n++] = y;
        };
        const cross = (ax, ay, az, bx, by, bz, pa, pb) => { // where pa + (pb - pa) t crosses a multiple of st
            if (Math.abs(pb - pa) < 1e-6) return;
            const k0 = Math.ceil(Math.min(pa, pb) * inv), k1 = Math.floor(Math.max(pa, pb) * inv);
            for (let k = k0; k <= k1; k++) { const t = (k * st - pa) / (pb - pa); if (t > 1e-4 && t < 1 - 1e-4) add(ax + (bx - ax) * t, az + (bz - az) * t, ay + (by - ay) * t); }
        };
        let P;
        const edge = (ia, ib) => {
            const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2], bx = P[ib * 3], by = P[ib * 3 + 1], bz = P[ib * 3 + 2];
            cross(ax, ay, az, bx, by, bz, ax, bx); cross(ax, ay, az, bx, by, bz, az, bz); cross(ax, ay, az, bx, by, bz, ax + az, bx + bz);
        };
        for (const g of this.surfaces) {
            P = g.attributes.position.array;
            const I = g.index ? g.index.array : null;
            const nTri = I ? I.length / 3 : P.length / 9;
            const seen = new Uint8Array(P.length / 3);
            for (let t = 0; t < nTri; t++) {
                const ia = I ? I[t * 3] : t * 3, ib = I ? I[t * 3 + 1] : t * 3 + 1, ic = I ? I[t * 3 + 2] : t * 3 + 2;
                const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2], bx = P[ib * 3], by = P[ib * 3 + 1], bz = P[ib * 3 + 2], cx = P[ic * 3], cy2 = P[ic * 3 + 1], cz = P[ic * 3 + 2];
                if (!seen[ia]) { seen[ia] = 1; add(ax, az, ay); }
                if (!seen[ib]) { seen[ib] = 1; add(bx, bz, by); }
                if (!seen[ic]) { seen[ic] = 1; add(cx, cz, cy2); }
                edge(ia, ib); edge(ib, ic); edge(ic, ia);
                // terrain vertices under the triangle
                const x0 = Math.ceil(Math.min(ax, bx, cx) * inv), x1 = Math.floor(Math.max(ax, bx, cx) * inv);
                const z0 = Math.ceil(Math.min(az, bz, cz) * inv), z1 = Math.floor(Math.max(az, bz, cz) * inv);
                if (x0 > x1 || z0 > z1) continue;
                const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
                if (Math.abs(d) < 1e-9) continue;
                for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
                    const x = i * st, z = j * st;
                    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
                    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
                    add(x, z, l1 * ay + l2 * by + l3 * cy2);
                }
            }
        }
        const Hs = Float64Array.from(H);
        const sweep = (fill) => {
            let worst = 0;
            for (let c = 0; c < n; c++) {
                const a = V[c * 3], b = V[c * 3 + 1], d = V[c * 3 + 2], wa = Wt[c * 3], wb = Wt[c * 3 + 1], wd = Wt[c * 3 + 2];
                const pred = wa * Hs[a] + wb * Hs[b] + wd * Hs[d];
                let e;
                if (fill) { e = pred - (Y[c] - FILL); if (e >= 0) continue; e = pred - (Y[c] - MARGIN - 0.25); }
                else { e = pred - (Y[c] - MARGIN); if (e <= 0) continue; worst = Math.max(worst, e); }
                const s2 = wa * wa + wb * wb + wd * wd;
                if (s2 < 1e-9) continue;
                const k = e / s2;
                Hs[a] -= k * wa; Hs[b] -= k * wb; Hs[d] -= k * wd;
            }
            return worst;
        };
        sweep(true);
        for (let it = 0; it < 12; it++) if (sweep(false) < 0.005) break;
        const out = new Map();
        for (const [k, v] of ids) out.set(k, Hs[v]);
        return out;
    }
}
const vkey = (i, j) => (i + 8192) * 16384 + (j + 8192);
export const smooth01 = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };

// ── The intercity road network ──
// nodes: [{ x, z, ports? }] — a port is where a road may start: { x, z, dx, dz (outward), y?, g?, hw?, multi? }
// (a town's street ends, an airbase's gate). heightAt(x, z): the ground the road is laid on.
// avoid: [{ x, z, r, node }] areas a road must go round unless it starts or ends there.
export function buildRoads(group, nodes, { heightAt = terrainHeight, avoid = [] } = {}) {
    const edges = new Set();
    nodes.forEach((a, i) => {
        const near = nodes.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.z - b.z) })).filter(o => o.j !== i && o.d < 9500).sort((p, q) => p.d - q.d).slice(0, 2);
        near.forEach(o => edges.add(Math.min(i, o.j) + ',' + Math.max(i, o.j)));
    });
    Bridge.roadMaterial = plainRoadMaterial();
    // the best free port of node A for a road heading to B
    const portFor = (A, B) => {
        if (!A.ports || !A.ports.length) return null;
        const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1;
        let best = null, bs = -Infinity;
        for (const p of A.ports) {
            const ox = p.x - A.x, oz = p.z - A.z, ol = Math.hypot(ox, oz) || 1;
            const sc = (p.dx * dx + p.dz * dz) / L + 0.5 * (ox * dx + oz * dz) / (ol * L) - (p.used && !p.multi ? 10 : 0) - (p.rank || 0) * 0.04;
            if (sc > bs) { bs = sc; best = p; }
        }
        best.used = (best.used || 0) + 1;
        return best;
    };
    // a second road out of a shared port (an airbase gate) leaves the first one at a T-junction ~140 m out,
    // square to it, instead of running on top of it
    const branchOff = (port, target) => {
        const R = port.hostRaw;
        if (!R || R.length < 4) return null;
        let s = 0, k = 1;
        for (; k < R.length - 2; k++) { const d = Math.hypot(R[k].x - R[k - 1].x, R[k].z - R[k - 1].z); if (s + d > 140) break; s += d; }
        const q = R[k], qp = R[k - 1];
        let tx = q.x - qp.x, tz = q.z - qp.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        const side = tx * (target.z - q.z) - tz * (target.x - q.x) >= 0 ? 1 : -1;
        return { x: q.x, z: q.z, dx: -tz * side, dz: tx * side, branch: true };
    };
    const paths = [], bridges = [];
    let ei = 0;
    for (const e of edges) {
        const [i, j] = e.split(',').map(Number);
        const A = nodes[i], B = nodes[j];
        const pa0 = portFor(A, B), pb0 = portFor(B, A);
        const pa = (pa0 && pa0.multi && branchOff(pa0, B)) || pa0, pb = (pb0 && pb0.multi && branchOff(pb0, A)) || pb0;
        const LEAD = 40;
        const a0 = pa || A, b0 = pb || B;
        const a1 = pa ? { x: pa.x + pa.dx * LEAD, z: pa.z + pa.dz * LEAD } : A, b1 = pb ? { x: pb.x + pb.dx * LEAD, z: pb.z + pb.dz * LEAD } : B;
        const chord = Math.hypot(b1.x - a1.x, b1.z - a1.z) || 1;
        const ux = (b1.x - a1.x) / chord, uz = (b1.z - a1.z) / chord, nx = -uz, nz = ux;
        const k = Math.min(chord * 0.45, 900);
        const m0 = pa ? { x: pa.dx * k, z: pa.dz * k } : { x: ux * k, z: uz * k }, m1 = pb ? { x: -pb.dx * k, z: -pb.dz * k } : { x: ux * k, z: uz * k };
        const raw = [];
        const straight = (p, q) => { const L = Math.hypot(q.x - p.x, q.z - p.z), n = Math.max(1, Math.ceil(L / STEP)); for (let m = 0; m < n; m++) raw.push({ x: p.x + (q.x - p.x) * m / n, z: p.z + (q.z - p.z) * m / n }); };
        if (pa) straight(a0, a1);
        const steps = Math.ceil(chord * 1.25 / STEP);
        for (let s = 0; s <= steps; s++) {
            const t = s / steps, t2 = t * t, t3 = t2 * t;
            const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
            // gentle meander so roads don't look ruler-straight
            const wob = Math.sin(t * Math.PI * 3 + i) * Math.min(chord * 0.04, 180) * Math.sin(t * Math.PI);
            raw.push({ x: h00 * a1.x + h10 * m0.x + h01 * b1.x + h11 * m1.x + nx * wob, z: h00 * a1.z + h10 * m0.z + h01 * b1.z + h11 * m1.z + nz * wob });
        }
        if (pb) { const tail = []; const L = Math.hypot(b0.x - b1.x, b0.z - b1.z), n = Math.max(1, Math.ceil(L / STEP)); for (let m = 1; m <= n; m++) tail.push({ x: b1.x + (b0.x - b1.x) * m / n, z: b1.z + (b0.z - b1.z) * m / n }); raw.push(...tail); }
        // round other towns, not through them
        for (const q of raw) for (const t of avoid) {
            if (t.node === A || t.node === B) continue;
            const d = Math.hypot(q.x - t.x, q.z - t.z);
            if (d < t.r) { q.x = t.x + (q.x - t.x) / (d || 1) * t.r; q.z = t.z + (q.z - t.z) / (d || 1) * t.r; }
        }
        const samples = [];
        let prevOut = null;
        raw.forEach((r0, k) => {
            let x = r0.x, z = r0.z;
            const lead = (pa && !pa.branch && k < 4) || (pb && !pb.branch && k > raw.length - 5); // the port lead-ins stay where they are
            // each road keeps its own distance from the fence, so two roads going round the same side don't overlap
            const out = lead ? null : outsideBases(x, z, FENCE_MARGIN + (ei % 3) * 24);
            if (out) {
                // switching fence sides: go round the corner(s) instead of cutting across the base
                if (prevOut && prevOut.base === out.base && prevOut.side !== out.side) {
                    const [x0, x1, z0, z1] = out.box;
                    const xSide = (sd) => (sd === 0 ? x0 : x1), zSide = (sd) => (sd === 2 ? z0 : z1);
                    const corners = [];
                    const c1 = prevOut.side, c2 = out.side;
                    if (c1 < 2 && c2 >= 2) corners.push([xSide(c1), zSide(c2)]);
                    else if (c1 >= 2 && c2 < 2) corners.push([xSide(c2), zSide(c1)]);
                    else if (c1 < 2) { const zs = Math.abs(prevOut.lz - z0) < Math.abs(prevOut.lz - z1) ? z0 : z1; corners.push([xSide(c1), zs], [xSide(c2), zs]); }
                    else { const xs = Math.abs(prevOut.lx - x0) < Math.abs(prevOut.lx - x1) ? x0 : x1; corners.push([xs, zSide(c1)], [xs, zSide(c2)]); }
                    for (const [clx, clz] of corners) {
                        const w = baseToWorld(out.base, clx, clz), ch = terrainHeight(w.x, w.z);
                        samples.push({ x: w.x, z: w.z, h: ch, kind: ch < 1 ? 'water' : 'land' });
                    }
                }
                x = out.x; z = out.z;
            }
            prevOut = out;
            const h = terrainHeight(x, z);
            samples.push({ x, z, h, kind: lead ? 'land' : h < 1 ? 'water' : slopeAt(x, z) > 0.6 ? 'cliff' : 'land' });
        });
        // drop samples that bunch up (fence corners, bypasses)
        for (let q = samples.length - 2; q > 0; q--) if (Math.hypot(samples[q].x - samples[q - 1].x, samples[q].z - samples[q - 1].z) < 3) samples.splice(q, 1);
        // round off the corners that pushing round fences and towns leaves (not the port lead-ins, not at water)
        const fixedEnd = (k) => (pa && !pa.branch && k < 4) || (pb && !pb.branch && k > samples.length - 5) || k === 0 || k === samples.length - 1;
        for (let it = 0; it < 3; it++) for (let k = 1; k < samples.length - 1; k++) {
            const a = samples[k - 1], q = samples[k], b = samples[k + 1];
            if (fixedEnd(k) || a.kind !== 'land' || q.kind !== 'land' || b.kind !== 'land') continue;
            q.x = 0.25 * a.x + 0.5 * q.x + 0.25 * b.x; q.z = 0.25 * a.z + 0.5 * q.z + 0.25 * b.z;
        }
        // the first road out of a shared port is the one later roads branch off
        if (pa0 && pa0.multi && pa === pa0) pa0.hostRaw = samples;
        if (pb0 && pb0.multi && pb === pb0) pb0.hostRaw = [...samples].reverse();
        let cur = null, cutReason = null;
        // a road that has to stop (cliff, open water) ends in a roadblock; one that reaches a town/gate doesn't
        const flush = (reason = null) => {
            if (cur && cur.raw.length >= 2) { cur.endCut = reason; paths.push(cur); }
            cur = null; cutReason = reason;
        };
        for (let k = 0; k < samples.length; k++) {
            const sm = samples[k];
            if (sm.kind === 'land') {
                if (!cur) { cur = { raw: [], bridgeRaw: [], startCut: k === 0 ? null : cutReason || 'closed', edge: ei, startPort: k === 0 ? pa : null }; }
                cur.raw.push({ x: sm.x, z: sm.z });
                if (k === samples.length - 1) cur.endPort = pb;
                continue;
            }
            if (sm.kind === 'cliff') { flush('closed'); continue; }
            // water: look for the far shore
            let m = k;
            while (m < samples.length && samples[m].kind === 'water') m++;
            const Aw = samples[k - 1], Bw = samples[m];
            const span = Aw && Bw ? Math.hypot(Bw.x - Aw.x, Bw.z - Aw.z) : Infinity;
            if (cur && Aw && Bw && Bw.kind === 'land' && span <= MAX_BRIDGE && span >= MIN_BRIDGE) {
                const ya = heightAt(Aw.x, Aw.z) + 0.7, yb = heightAt(Bw.x, Bw.z) + 0.7;
                const br = new Bridge(new THREE.Vector3(Aw.x, ya, Aw.z), new THREE.Vector3(Bw.x, yb, Bw.z), bridges.length);
                bridges.push(br);
                group.add(br.group);
                cur.bridgeRaw.push({ bridge: br, at: cur.raw.length - 1 });
                // deck samples at the segment joints (the far shore sample is added by the loop)
                for (let q = 1; q < br.n; q++) cur.raw.push({ x: Aw.x + (Bw.x - Aw.x) * q / br.n, z: Aw.z + (Bw.z - Aw.z) * q / br.n, deck: true });
                k = m - 1;
            } else {
                flush('water');
                k = m - 1;
            }
        }
        flush(null);
        ei++;
    }
    // drop stray fragments that start and stop in the middle of nowhere
    for (let i = paths.length - 1; i >= 0; i--) {
        const p = paths[i];
        let len = 0;
        for (let k = 1; k < p.raw.length; k++) len += Math.hypot(p.raw[k].x - p.raw[k - 1].x, p.raw[k].z - p.raw[k - 1].z);
        const cuts = (p.startCut ? 1 : 0) + (p.endCut ? 1 : 0);
        if (!p.bridgeRaw.length && ((cuts === 2 && len < 600) || (cuts === 1 && len < 150))) paths.splice(i, 1);
    }
    // finish paths: heights, cross-slope, arc length, bridge ranges
    for (const p of paths) {
        // long straight runs (round a base's fence corners) get samples every STEP too, so the road follows the ground
        const dense = [], at = [];
        for (let k = 0; k < p.raw.length; k++) {
            const r = p.raw[k], q = p.raw[k - 1];
            if (q && !r.deck && !q.deck) {
                const d = Math.hypot(r.x - q.x, r.z - q.z), n = Math.ceil(d / STEP);
                for (let m = 1; m < n && d > STEP * 1.5; m++) dense.push({ x: q.x + (r.x - q.x) * m / n, z: q.z + (r.z - q.z) * m / n });
            }
            at[k] = dense.length;
            dense.push(r);
        }
        for (const br of p.bridgeRaw) br.at = at[br.at];
        p.raw = dense;
        let s = 0;
        p.pts = p.raw.map((r, idx) => {
            if (idx) s += Math.hypot(r.x - p.raw[idx - 1].x, r.z - p.raw[idx - 1].z);
            return { x: r.x, y: r.deck ? 0 : heightAt(r.x, r.z) + 0.5, z: r.z, g: 0, s };
        });
        // cross-slope from the direction of travel (roads are banked with the hillside, but only so far)
        for (let idx = 0; idx < p.pts.length; idx++) {
            const P = p.pts[idx], Q = p.pts[Math.min(idx + 1, p.pts.length - 1)], O = p.pts[Math.max(idx - 1, 0)];
            let tx = Q.x - O.x, tz = Q.z - O.z;
            const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
            const rx = -tz, rz = tx; // right-hand side
            if (!p.raw[idx].deck) {
                const hr = heightAt(P.x + rx * ROAD_HALF, P.z + rz * ROAD_HALF), hl = heightAt(P.x - rx * ROAD_HALF, P.z - rz * ROAD_HALF);
                P.g = Math.max(-0.1, Math.min(0.1, (hr - hl) / (2 * ROAD_HALF)));
                P.y = Math.max(P.y, Math.max(hr, hl) * 0.5 + heightAt(P.x, P.z) * 0.5 + 0.3);
            }
        }
        p.len = s;
        p.bridges = p.bridgeRaw.map(({ bridge, at }) => {
            const s0 = p.pts[at].s, s1 = s0 + bridge.len;
            bridge.path = p; bridge.s0 = s0; bridge.s1 = s1;
            return { bridge, s0, s1 };
        });
        // ease the bumps out of the grade (not on the decks)
        for (let it = 0; it < 2; it++) {
            const Y = p.pts.map(q => q.y);
            for (let k = 1; k < p.pts.length - 1; k++) if (!p.raw[k].deck && !p.raw[k - 1].deck && !p.raw[k + 1].deck) p.pts[k].y = Math.max(Y[k], 0.25 * Y[k - 1] + 0.5 * Y[k] + 0.25 * Y[k + 1]);
        }
        for (const q of p.pts) for (const br of p.bridges) if (q.s >= br.s0 - 0.01 && q.s <= br.s1 + 0.01) q.y = br.bridge.deckY((q.s - br.s0) / br.bridge.len);
        // where the road leaves a town street: carry on from the street's surface, narrow at first
        const joinPort = (port, fromEnd) => {
            if (!port) return;
            for (const q of p.pts) {
                const d = fromEnd ? p.len - q.s : q.s;
                if (d > 70) continue;
                const w = 1 - smooth01(d / 70);
                if (port.y !== undefined) {
                    const py = port.y + (port.slope || 0) * d; // the street's grade, carried on a little
                    q.y += (py - q.y) * w;
                    q.g += ((port.g ?? 0) * (fromEnd ? -1 : 1) - q.g) * w;
                }
                if (port.hw) q.hw = port.hw + (ROAD_HALF - port.hw) * smooth01(d / 40);
            }
        };
        joinPort(p.startPort, false); joinPort(p.endPort, true);
        delete p.raw; delete p.bridgeRaw;
    }
    // where the kept roads stop short: roadblocks go there
    const deadEnds = [];
    for (const p of paths) {
        const P = p.pts;
        if (p.startCut) deadEnds.push({ x: P[0].x, z: P[0].z, dx: P[0].x - P[1].x, dz: P[0].z - P[1].z, reason: p.startCut, w: ROAD_HALF, path: p, end: 0 });
        if (p.endCut) { const a = P[P.length - 1], b = P[P.length - 2]; deadEnds.push({ x: a.x, z: a.z, dx: a.x - b.x, dz: a.z - b.z, reason: p.endCut, w: ROAD_HALF, path: p, end: 1 }); }
    }
    return { paths, bridges, deadEnds };
}

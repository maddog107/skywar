// ═══════════════════════════════════════════════════════════════
// Terrain core: the height function, land-cover colours, the ground as towns grade it and roads cut it,
// and the terrain tile builder — plain arrays and numbers, no three.js, so the same code runs on the
// main thread and in the terrain worker (terrainworker.js). world.js re-exports BASES and terrainHeight.
// ═══════════════════════════════════════════════════════════════
import { fbm, ridged, smoothstep, lerp } from './noise.js';

// ── Airbases (terrain is flattened around them) ──
// Each base lists its runways in base-local metres (lx across, lz along; rot = extra rotation).
// layout picks the dressing: 'standard' (the original bases), 'miramar' (military, parallel runways),
// 'civil' (airline terminals). Runway numbers are worked out from the real compass heading.
export const BASES = [
    { id: 'home', name: 'SKYWAR AIR BASE', x: 0, z: 0, h: 22, r: 1500, heading: 0, friendly: true, layout: 'standard',
        runways: [{ lx: 0, lz: 0, len: 3000, w: 55 }] },
    { id: 'enemy', name: 'ENEMY AIR BASE', x: 7000, z: -17000, h: 38, r: 1700, heading: 0.35, friendly: false, layout: 'standard',
        runways: [{ lx: 0, lz: 0, len: 3000, w: 55 }] },
    { id: 'miramar', name: 'MCAS MIRAMAR', x: -10000, z: -19100, h: 58, r: 2800, heading: 0.698, friendly: true, layout: 'miramar',
        runways: [{ lx: -520, lz: 0, len: 3650, w: 60 }, { lx: -220, lz: 300, len: 2900, w: 46 }, { lx: -430, lz: -250, len: 1150, w: 45, rot: 0.87 }],
        fence: { x0: -900, x1: 1450, z0: -2150, z1: 2150 }, gate: { lx: 1450, lz: -300 } },
    { id: 'civil', name: 'HARBOR INTERNATIONAL', x: -13600, z: 10900, h: 14, r: 2100, heading: 0.315, friendly: true, layout: 'civil', civil: true,
        runways: [{ lx: 0, lz: 0, len: 2900, w: 60 }],
        fence: { x0: -250, x1: 900, z0: -1650, z1: 1650 }, gate: { lx: 900, lz: 0 } },
];

// ── Height function (metres). Shared by rendering, collisions and AI ──
export function terrainHeight(x, z) {
    let c = fbm(x * 0.000065 + 3.1, z * 0.000065 - 7.7, 4);
    let flatten = 1, flatH = 0;
    for (let i = 0; i < BASES.length; i++) {
        const b = BASES[i];
        const dx = x - b.x, dz = z - b.z;
        const d2 = dx * dx + dz * dz;
        c += 0.45 * Math.exp(-d2 / (7000 * 7000));
        if (d2 < b.r * b.r * 4) {
            const f = smoothstep(b.r, b.r * 2, Math.sqrt(d2));
            if (f < flatten) { flatten = f; flatH = b.h; }
        }
    }
    const land = smoothstep(-0.04, 0.16, c);
    const mountainMask = smoothstep(-0.05, 0.3, fbm(x * 0.00011 + 11.3, z * 0.00011 + 5.2, 3));
    const m = ridged(x * 0.00032 + 1.7, z * 0.00032 - 4.1, 5);
    const hills = fbm(x * 0.0008 + 2.2, z * 0.0008 + 9.1, 4);
    const detail = fbm(x * 0.0035, z * 0.0035, 3);
    let h = land * (32 + hills * 170 + m * m * 1900 * mountainMask + detail * 22) + (1 - land) * (-140 + detail * 20);
    if (flatten < 1) h = lerp(flatH, h, flatten);
    return h;
}

// Land-cover colour of the ground at (x, z), height h, normal's up component ny → out[o..o+2] (linear)
export function colorAt(x, h, z, ny, out, o) {
    const n = fbm(x * 0.0021, z * 0.0021, 2) * 0.5 + 0.5;
    const forest = smoothstep(0.02, 0.2, fbm(x * 0.0006 + 40, z * 0.0006 - 12, 3));
    const slope = 1 - ny;
    let r, g, b;
    {
        // lowland grass -> forest
        r = lerp(0.33, 0.44, n); g = lerp(0.44, 0.49, n); b = lerp(0.2, 0.25, n);
        r = lerp(r, 0.17, forest * 0.8); g = lerp(g, 0.26, forest * 0.8); b = lerp(b, 0.13, forest * 0.8);
        // alpine meadow / brown highland
        const hi = smoothstep(350, 800, h);
        r = lerp(r, 0.42 + n * 0.08, hi); g = lerp(g, 0.39 + n * 0.06, hi); b = lerp(b, 0.3, hi);
        // rock on steep slopes
        const rock = smoothstep(0.28, 0.5, slope + (h > 600 ? 0.1 : 0));
        r = lerp(r, 0.44 + n * 0.1, rock); g = lerp(g, 0.42 + n * 0.08, rock); b = lerp(b, 0.4 + n * 0.06, rock);
        // snow
        const snow = smoothstep(1150, 1450, h + n * 180) * (1 - smoothstep(0.45, 0.7, slope));
        r = lerp(r, 0.95, snow); g = lerp(g, 0.96, snow); b = lerp(b, 1.0, snow);
    }
    // base concrete aprons
    for (const base of BASES) {
        const d = Math.hypot(x - base.x, z - base.z);
        if (d < base.r * 1.05) {
            const t = smoothstep(base.r * 1.05, base.r * 0.9, d) * 0.35;
            r = lerp(r, 0.42, t); g = lerp(g, 0.46, t); b = lerp(b, 0.3, t);
        }
    }
    // convert sRGB-ish authored colours into linear for the renderer
    out[o] = r * r; out[o + 1] = g * g; out[o + 2] = b * b;
}

export const smooth01 = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
export const vkey = (i, j) => (i + 8192) * 16384 + (j + 8192);

// ── The ground as the towns grade it ──
// G: { towns: [{ x, z, bxx, bxz, axx, axz, C, n, N, ext2, H, M }], cells: Map(1 km cell → town indices), pads: [] }
// (built by towns.js). Natural height h at (x, z) → the graded ground inside towns / on levelled pads, else h.
export function townGradeAt(G, x, z, h) {
    if (h < 0.5) return h;
    const l = G.cells.get(Math.floor(x / 1000) * 100003 + Math.floor(z / 1000));
    if (l) for (let q = 0; q < l.length; q++) {
        const s = G.towns[l[q]], dx = x - s.x, dz = z - s.z;
        if (dx * dx + dz * dz > s.ext2) continue;
        const u = dx * s.bxx + dz * s.bxz, v = dx * s.axx + dz * s.axz;
        const fi = u / s.C + s.n, fj = v / s.C + s.n, N = s.N;
        const i = Math.max(0, Math.min(N - 2, Math.floor(fi))), j = Math.max(0, Math.min(N - 2, Math.floor(fj)));
        const a = Math.max(0, Math.min(1, fi - i)), b = Math.max(0, Math.min(1, fj - j));
        const k = j * N + i, M = s.M, H = s.H;
        const w = smooth01(((M[k] * (1 - a) + M[k + 1] * a) * (1 - b) + (M[k + N] * (1 - a) + M[k + N + 1] * a) * b - 0.15) / 0.6);
        if (w > 0) { h += ((H[k] * (1 - a) + H[k + 1] * a) * (1 - b) + (H[k + N] * (1 - a) + H[k + N + 1] * a) * b - h) * w; break; }
    }
    // levelled platforms (a stadium): flat inside the ellipse, easing back to the ground around it
    for (const pd of G.pads) {
        const dx = x - pd.x, dz = z - pd.z;
        if (dx * dx + dz * dz > (pd.a + pd.blend) ** 2) continue;
        const c = Math.cos(pd.yaw), s = Math.sin(pd.yaw), lx = dx * c - dz * s, lz = dx * s + dz * c;
        const e = Math.hypot(lx / pd.a, lz / pd.b); // 1 on the rim
        const w = e <= 1 ? 1 : 1 - smooth01((e - 1) * Math.min(pd.a, pd.b) / pd.blend);
        if (w > 0) h += (pd.y - h) * w;
    }
    return h;
}

// ── The ground as the roads cut it (RoadGround in roads.js packs its data into R) ──
// R: { cell, grid: Map(cell → Int32Array of segment indices), segs: Float64Array (SEG_STRIDE per segment),
//      edge, shoulder, under, base: town grade (above) or null, grids: [step, ...], over: [Map(vkey → height), ...] }
export const SEG_STRIDE = 13; // ax, az, ay, ag, bx, bz, by, bg, L, tx, tz, half, reach
// drawn height of the ground at (x, z), given its natural height h, before the solve
export function roadBaseConform(R, x, z, h) {
    if (R.base) h = townGradeAt(R.base, x, z, h);
    if (h < 0) return h; // never build land out into a lake
    const list = R.grid.get(Math.floor(x / R.cell) * 100003 + Math.floor(z / R.cell));
    if (!list) return h;
    const S = R.segs, EDGE = R.edge;
    let bestW = 0, target = h;
    for (let q = 0; q < list.length; q++) {
        const o = list[q] * SEG_STRIDE;
        const ax = S[o], az = S[o + 1], L = S[o + 8], tx = S[o + 9], tz = S[o + 10], half = S[o + 11];
        const t = Math.max(0, Math.min(L, (x - ax) * tx + (z - az) * tz));
        const px = ax + tx * t, pz = az + tz * t;
        const lat = (x - px) * -tz + (z - pz) * tx; // + to the right of travel
        const d = Math.hypot(x - px, z - pz);
        if (d >= S[o + 12]) continue;
        const w = d <= half + EDGE ? 1 : 1 - smooth01((d - half - EDGE) / R.shoulder);
        if (w <= bestW) continue;
        const u = t / L;
        const y = S[o + 2] + (S[o + 6] - S[o + 2]) * u, g = S[o + 3] + (S[o + 7] - S[o + 3]) * u;
        bestW = w;
        target = y + g * Math.max(-half, Math.min(half, lat)) - R.under;
    }
    return h + (target - h) * bestW;
}
// drawn height (what the terrain tiles use for every vertex): the solved heights on the tile grids, else the above
export function roadConform(R, x, z, h) {
    let out = Infinity;
    for (let g = 0; g < R.grids.length; g++) {
        const st = R.grids[g], i = Math.round(x / st), j = Math.round(z / st);
        if (Math.abs(i * st - x) > 1e-3 || Math.abs(j * st - z) > 1e-3) continue;
        const v = R.over[g].get(vkey(i, j));
        if (v !== undefined && v < out) out = v;
    }
    return out < Infinity ? out : roadBaseConform(R, x, z, h);
}

// Drawn height only (physics keeps the true terrain): open a ~2 m step at the waterline — shallow lakebed dips
// a little, the first metre of beach rises a little — so the flat water plane and near-flat beaches never
// fight in the depth buffer and flicker between sand and water.
export const shore = (h) => h < 0 ? h - 1.5 * Math.max(0, 1 + h / 6) : h + 0.6 * Math.max(0, 1 - h);

// ── Terrain tile ──
// A T x T m tile at (tx, tz) with seg x seg quads plus skirts, as plain arrays: position, normal, colour,
// true height (hTrue), the LOD morph source (default: no morph), index, and a bounding sphere.
// conform(x, z, h): the drawn ground height (roads, towns) or null. A generator: it yields every few rows,
// so a thread without workers can spread a big tile over several frames.
export function* tileJob(tx, tz, seg, T, conform) {
    const step = T / seg, x0 = tx * T, z0 = tz * T;
    const N = seg + 3; // one extra ring on each side for normals
    const H = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
            const x = x0 + (i - 1) * step, z = z0 + (j - 1) * step, h = terrainHeight(x, z);
            H[j * N + i] = conform ? conform(x, z, h) : h;
        }
        if ((j & 3) === 3) yield;
    }
    const V = seg + 1;
    const vCount = V * V + V * 4;
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3), col = new Float32Array(vCount * 3), ht = new Float32Array(vCount);
    const skirt = 30 + step * 1.5;
    const setVert = (k, i, j, drop) => {
        const h = shore(H[(j + 1) * N + (i + 1)]);
        ht[k] = H[(j + 1) * N + (i + 1)];
        pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = h - drop; pos[k * 3 + 2] = z0 + j * step;
        const hl = H[(j + 1) * N + i], hr = H[(j + 1) * N + i + 2], hd = H[j * N + i + 1], hu = H[(j + 2) * N + i + 1];
        // (hl - hr, 2 step, hd - hu), normalised as three.js's Vector3.normalize does it
        const nx = hl - hr, ny = 2 * step, nz = hd - hu, il = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
        nor[k * 3] = nx * il; nor[k * 3 + 1] = ny * il; nor[k * 3 + 2] = nz * il;
        colorAt(pos[k * 3], h, pos[k * 3 + 2], ny * il, col, k * 3);
    };
    let k = 0;
    for (let j = 0; j < V; j++) {
        for (let i = 0; i < V; i++) setVert(k++, i, j, 0);
        if (j & 1) yield;
    }
    // skirts: top, bottom, left, right edges
    const skirtStart = k;
    for (let i = 0; i < V; i++) setVert(k++, i, 0, skirt);
    for (let i = 0; i < V; i++) setVert(k++, i, seg, skirt);
    for (let j = 0; j < V; j++) setVert(k++, 0, j, skirt);
    for (let j = 0; j < V; j++) setVert(k++, seg, j, skirt);

    const idx = new (vCount > 65535 ? Uint32Array : Uint16Array)(seg * seg * 6 + seg * 24);
    let n = 0;
    const tri = (a, b, c) => { idx[n++] = a; idx[n++] = b; idx[n++] = c; };
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
        const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
        tri(a, c, b); tri(b, c, d);
    }
    const s0 = skirtStart, s1 = s0 + V, s2 = s1 + V, s3 = s2 + V;
    for (let i = 0; i < seg; i++) {
        // top edge (j=0) faces -z
        tri(i, i + 1, s0 + i); tri(i + 1, s0 + i + 1, s0 + i);
        // bottom edge (j=seg)
        const b0 = seg * V + i;
        tri(b0, s1 + i, b0 + 1); tri(b0 + 1, s1 + i, s1 + i + 1);
        // left edge (i=0)
        const l0 = i * V, l1 = (i + 1) * V;
        tri(l0, s2 + i, l1); tri(l1, s2 + i, s2 + i + 1);
        // right edge (i=seg)
        const r0 = i * V + seg, r1 = (i + 1) * V + seg;
        tri(r0, r1, s3 + i); tri(r1, s3 + i + 1, s3 + i);
    }
    // LOD morph source (see World.morphFrom); by default no morph
    const mo = new Float32Array(vCount * 4);
    for (let q = 0; q < vCount; q++) { mo[q * 4] = pos[q * 3 + 1]; mo[q * 4 + 1] = nor[q * 3]; mo[q * 4 + 2] = nor[q * 3 + 2]; mo[q * 4 + 3] = -1e4; }
    // bounding sphere as BufferGeometry.computeBoundingSphere makes it: box centre, farthest vertex
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let q = 0; q < vCount * 3; q += 3) {
        const x = pos[q], y = pos[q + 1], z = pos[q + 2];
        if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    let r2 = 0;
    for (let q = 0; q < vCount * 3; q += 3) { const dx = pos[q] - cx, dy = pos[q + 1] - cy, dz = pos[q + 2] - cz, d = dx * dx + dy * dy + dz * dz; if (d > r2) r2 = d; }
    return { tx, tz, seg, V, step, x0, z0, pos, nor, col, ht, mo, idx, sphere: [cx, cy, cz, Math.sqrt(r2)] };
}

export function runJob(it) { let r; do { r = it.next(); } while (!r.done); return r.value; }

// ═══════════════════════════════════════════════════════════════
// Sea-state maps: how much of each wave set (water.js) reaches each point of the water, and how deep it is.
// Plain arrays, no three.js (runs in waterworker.js, or on the main thread when there are no workers).
//
// Exposure comes from how open the water around a point is: the share of water in a box around it (a summed-area
// table of the water mask, so any box is four reads):
//   swell  needs the open sea: the share of water within ~5 km (a lake or a closed bay gets none)
//   wind   needs open water upwind (fetch): the share of water in a box stretching ~5 km upwind
//   chop   is everywhere, a little weaker on small ponds (water within ~700 m)
// Two maps: a coarse one (64 m texels, 16 km) for the exposure, and a fine one (8 m texels, 2 km) around the
// camera that adds the true depth at beach scale (the shallows fade the waves; the renderer tints by depth).
// Channels per texel: swell, wind, chop (0..1.2), depth (m, negative over land).
// Lakes: water that isn't connected to the open sea (a flood fill from the edge of the coarse map's surroundings,
// through water) gets no swell, and its wind channel is stored negative (−(wind + 0.01)): the waves take its size,
// the renderer its sign (fresh water's own colour, ocean.js). Use windGain() / isLake() to read it.
// ═══════════════════════════════════════════════════════════════
import { terrainHeight } from './terraincore.js';

export const COARSE = { size: 256, texel: 64 };
const SWASH_REACH = 3; // m above the sea: beach the swash can reach (water.js SWASH_H)
export const FINE = { size: 256, texel: 8 };
const R_SWELL = 5200, R_WIND = 2600, R_CHOP = 700;
const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };

// Coarse map centred on (cx, cz) (snapped to its texel grid); wind (wx, wz) = the way the wind blows.
// A generator: yields every few rows, so a thread without workers can spread it over frames.
export function* coarseJob(cx, cz, wx, wz) {
    const S = COARSE.size, T = COARSE.texel;
    const x0 = Math.round(cx / T) * T - (S / 2) * T, z0 = Math.round(cz / T) * T - (S / 2) * T;
    const m = Math.ceil((R_SWELL + R_WIND * 2) / T) + 1; // margin texels for the boxes
    const N = S + 2 * m;
    const depth = new Float32Array(N * N);
    // summed-area table of the water mask (N+1)²
    const sat = new Float64Array((N + 1) * (N + 1));
    for (let j = 0; j < N; j++) {
        let row = 0;
        for (let i = 0; i < N; i++) {
            const h = terrainHeight(x0 + (i - m + 0.5) * T, z0 + (j - m + 0.5) * T);
            depth[j * N + i] = -h;
            row += h < 0 ? 1 : 0;
            sat[(j + 1) * (N + 1) + i + 1] = sat[j * (N + 1) + i + 1] + row;
        }
        if ((j & 7) === 7) yield;
    }
    // share of water in the box [i0, i1) × [j0, j1) of the extended grid (clamped)
    const box = (ci, cj, rx, rz) => {
        const i0 = Math.max(0, Math.round(ci - rx)), i1 = Math.min(N, Math.round(ci + rx));
        const j0 = Math.max(0, Math.round(cj - rz)), j1 = Math.min(N, Math.round(cj + rz));
        const n = (i1 - i0) * (j1 - j0);
        if (n <= 0) return 0;
        const W = N + 1;
        return (sat[j1 * W + i1] - sat[j0 * W + i1] - sat[j1 * W + i0] + sat[j0 * W + i0]) / n;
    };
    // the sea: water reached from the edge of the extended grid (anything that opens onto the wider world)
    const sea = new Uint8Array(N * N), queue = new Int32Array(N * N);
    let qh = 0, qt = 0;
    const seed = (k) => { if (!sea[k] && depth[k] > 0) { sea[k] = 1; queue[qt++] = k; } };
    for (let i = 0; i < N; i++) { seed(i); seed((N - 1) * N + i); seed(i * N); seed(i * N + N - 1); }
    while (qh < qt) {
        const k = queue[qh++], i = k % N;
        if (i > 0) seed(k - 1);
        if (i < N - 1) seed(k + 1);
        if (k >= N) seed(k - N);
        if (k < N * (N - 1)) seed(k + N);
    }
    yield;
    const wl = Math.hypot(wx, wz) || 1, ux = -wx / wl, uz = -wz / wl; // upwind
    const data = new Float32Array(S * S * 4);
    const rs = R_SWELL / T, rw = R_WIND / T, rc = R_CHOP / T;
    for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
            const gi = i + m, gj = j + m, k = (j * S + i) * 4;
            const d = depth[gj * N + gi];
            data[k + 3] = d;
            if (d <= 0) { data[k] = data[k + 1] = data[k + 2] = 0; continue; }
            const oBig = box(gi + 0.5, gj + 0.5, rs, rs);
            const oUp = box(gi + 0.5 + ux * rw, gj + 0.5 + uz * rw, rw, rw);
            const oLoc = box(gi + 0.5, gj + 0.5, rc, rc);
            const lake = !sea[gj * N + gi];
            const swell = lake ? 0 : smooth(0.3, 0.8, oBig);
            const wind = smooth(0.2, 0.88, oUp) * Math.min(1, 0.3 + 1.2 * swell);
            data[k] = swell;
            data[k + 1] = lake ? -(wind + 0.01) : wind;
            data[k + 2] = 0.45 + 0.55 * smooth(0.05, 0.55, oLoc);
        }
        if ((j & 15) === 15) yield;
    }
    return { data, size: S, texel: T, x0, z0 };
}

// Fine map around (cx, cz): the true depth every 8 m; exposure interpolated from the coarse map
export function* fineJob(cx, cz, coarse) {
    const S = FINE.size, T = FINE.texel;
    const x0 = Math.round(cx / T) * T - (S / 2) * T, z0 = Math.round(cz / T) * T - (S / 2) * T;
    const data = new Float32Array(S * S * 4);
    const c = coarse, CS = c ? c.size : 0;
    for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
            const x = x0 + (i + 0.5) * T, z = z0 + (j + 0.5) * T, k = (j * S + i) * 4;
            const d = -terrainHeight(x, z);
            data[k + 3] = d;
            // (the beach just above the waterline keeps the exposure of the water beside it: the swash runs up
            // there, water.js; the waves themselves still see land, depth ≤ 0)
            if (d <= -SWASH_REACH) { data[k] = data[k + 1] = data[k + 2] = 0; continue; }
            let s0 = 1, s1 = 1, s2 = 1;
            if (c) {
                const fx = (x - c.x0) / c.texel - 0.5, fz = (z - c.z0) / c.texel - 0.5;
                if (fx >= 0 && fz >= 0 && fx <= CS - 1 && fz <= CS - 1) {
                    const ii = Math.min(Math.floor(fx), CS - 2), jj = Math.min(Math.floor(fz), CS - 2), a = fx - ii, b = fz - jj;
                    const q = (jj * CS + ii) * 4, D = c.data;
                    const lerp4 = (o) => {
                        // exposure is only defined on water texels: blend the wet neighbours only
                        let s = 0, w = 0;
                        const ws = [(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b], qs = [q, q + 4, q + CS * 4, q + CS * 4 + 4];
                        for (let n = 0; n < 4; n++) if (D[qs[n] + 3] > 0) { s += D[qs[n] + o] * ws[n]; w += ws[n]; }
                        return w > 1e-4 ? s / w : (o === 2 ? 0.6 : 0.2);
                    };
                    s0 = lerp4(0); s1 = lerp4(1); s2 = lerp4(2);
                }
            }
            data[k] = s0; data[k + 1] = s1; data[k + 2] = s2;
        }
        if ((j & 15) === 15) yield;
    }
    return { data, size: S, texel: T, x0, z0 };
}

// the wind-sea factor of a map sample (lakes store it negative) and whether the sample is a lake
export const windGain = (w) => (w < 0 ? -w : w);
export const isLake = (w) => w < 0;

export function runJob(it) { let r; do { r = it.next(); } while (!r.done); return r.value; }

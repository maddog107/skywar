// ═══════════════════════════════════════════════════════════════
// Cloud noise: the weather map and the shape / detail noise volumes for clouds.js
// ═══════════════════════════════════════════════════════════════
// Plain JS with no imports, so it also runs as a module worker: clouds.js generates these off the main
// thread (a few hundred ms of number crunching) and falls back to calling the functions directly.
// Float fields (the GPU gets half floats: 8-bit data would show as terraces on the smooth cloud surfaces);
// the same arrays answer densityAt() on the CPU for the whiteout.

export const WEATHER_SIZE = 32768;   // weather map tile (m)
export const WEATHER_RES = 512;
export const BASE_SIZE = 1400;       // shape noise tile (m)
export const BASE_RES = 64;
export const DETAIL_SIZE = 260;      // detail noise tile (m)
export const DETAIL_RES = 32;

function hash(a, b, c, s) {
    let h = Math.imul(s + 0x3c6ef372, 0x9e3779b1);
    h = Math.imul(h ^ a, 0x85ebca6b); h ^= h >>> 13;
    h = Math.imul(h ^ b, 0xc2b2ae35); h ^= h >>> 16;
    h = Math.imul(h ^ c, 0x27d4eb2f); h ^= h >>> 15;
    h = Math.imul(h, 0x165667b1); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

// feature points of a tileable 3D Worley grid with P cells per side
function worleyPoints(P, seed) {
    const pts = new Float32Array(P * P * P * 3);
    for (let z = 0; z < P; z++) for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
        const k = ((z * P + y) * P + x) * 3;
        pts[k] = x + hash(x, y, z, seed); pts[k + 1] = y + hash(x, y, z, seed + 1); pts[k + 2] = z + hash(x, y, z, seed + 2);
    }
    return pts;
}
// adds w * (1 - distance to the nearest feature point, in cells) of a tileable Worley grid with P cells per
// side to out (N^3, N a multiple of P): each cell's 27 candidate points are gathered once for all its voxels
function addWorley(out, N, P, seed, w) {
    const pts = worleyPoints(P, seed), cand = new Float32Array(81), s = P / N, vox = N / P;
    for (let cz = 0; cz < P; cz++) for (let cy = 0; cy < P; cy++) for (let cx = 0; cx < P; cx++) {
        let n = 0;
        for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx, y = cy + dy, z = cz + dz, wx = (x + P) % P, wy = (y + P) % P, wz = (z + P) % P;
            const k = ((wz * P + wy) * P + wx) * 3;
            cand[n++] = pts[k] + x - wx; cand[n++] = pts[k + 1] + y - wy; cand[n++] = pts[k + 2] + z - wz;
        }
        for (let z = cz * vox; z < (cz + 1) * vox; z++) {
            const pz = (z + 0.5) * s;
            for (let y = cy * vox; y < (cy + 1) * vox; y++) {
                const py = (y + 0.5) * s;
                for (let x = cx * vox, i = (z * N + y) * N + x; x < (cx + 1) * vox; x++, i++) {
                    const px = (x + 0.5) * s;
                    let best = 9;
                    for (let m = 0; m < 81; m += 3) {
                        const ex = cand[m] - px, ey = cand[m + 1] - py, ez = cand[m + 2] - pz, d = ex * ex + ey * ey + ez * ez;
                        if (d < best) best = d;
                    }
                    out[i] += w * (1 - Math.sqrt(best));
                }
            }
        }
    }
}

// tileable gradient noise with period P (lattice gradients precomputed per period and seed)
const GR3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function perlin3(P, seed) {
    const G = new Float32Array(P * P * P * 3);
    for (let k = 0; k < P; k++) for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
        const q = GR3[Math.floor(hash(i, j, k, seed) * 12)], o = ((k * P + j) * P + i) * 3;
        G[o] = q[0]; G[o + 1] = q[1]; G[o + 2] = q[2];
    }
    const g = (i, j, k, dx, dy, dz) => {
        const o = ((((k % P) * P) + (j % P)) * P + (i % P)) * 3;
        return G[o] * dx + G[o + 1] * dy + G[o + 2] * dz;
    };
    // u, v, w in [0, 1): one period
    return (u, v, w) => {
        const x = u * P, y = v * P, z = w * P;
        const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
        const fx = x - ix, fy = y - iy, fz = z - iz;
        const a = fade(fx), b = fade(fy), c = fade(fz);
        const x0 = ix % P, y0 = iy % P, z0 = iz % P, x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1;
        const l = (p, q, t) => p + (q - p) * t;
        return l(
            l(l(g(x0, y0, z0, fx, fy, fz), g(x1, y0, z0, fx - 1, fy, fz), a), l(g(x0, y1, z0, fx, fy - 1, fz), g(x1, y1, z0, fx - 1, fy - 1, fz), a), b),
            l(l(g(x0, y0, z1, fx, fy, fz - 1), g(x1, y0, z1, fx - 1, fy, fz - 1), a), l(g(x0, y1, z1, fx, fy - 1, fz - 1), g(x1, y1, z1, fx - 1, fy - 1, fz - 1), a), b),
            c);
    };
}
function perlin2(P, seed) {
    const G = new Float32Array(P * P * 2);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
        const a = hash(i, j, 0, seed) * Math.PI * 2;
        G[(j * P + i) * 2] = Math.cos(a); G[(j * P + i) * 2 + 1] = Math.sin(a);
    }
    const g = (i, j, dx, dy) => { const o = ((j % P) * P + (i % P)) * 2; return G[o] * dx + G[o + 1] * dy; };
    // u, v in [0, 1) (any real: wrapped)
    return (u, v) => {
        const x = (u - Math.floor(u)) * P, y = (v - Math.floor(v)) * P;
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
        const s = fade(fx), t = fade(fy);
        const a = g(ix, iy, fx, fy), b = g(ix + 1, iy, fx - 1, fy), c = g(ix, iy + 1, fx, fy - 1), d = g(ix + 1, iy + 1, fx - 1, fy - 1);
        return (a + (b - a) * s + (c - a) * t + (a - b - c + d) * s * t) * 1.41;
    };
}

export const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// stretch a field to 0..1 between its 1st and 99th percentiles (so every tile uses the full range);
// out: Float32Array (kept smooth: 8-bit fields show terraces once they are filtered) or Uint8Array
function normalize(f, out, stride, offset) {
    const sorted = Float32Array.from(f).sort();
    const lo = sorted[Math.floor(f.length * 0.01)], hi = sorted[Math.floor(f.length * 0.99)];
    const k = out instanceof Uint8Array ? 255 : 1;
    for (let i = 0; i < f.length; i++) out[i * stride + offset] = sat((f[i] - lo) / (hi - lo)) * k;
}

// Shape noise, RG: R = billows (Worley fbm dilated by Perlin: rounded, connected cauliflower heads),
// G = low-frequency Perlin (slow variation of how deep the billows cut)
export function makeBaseNoise(N = BASE_RES) {
    const p4 = perlin3(4, 21), p8 = perlin3(8, 22), p2 = perlin3(2, 24);
    const R = new Float32Array(N * N * N), G = new Float32Array(N * N * N);
    addWorley(R, N, 4, 11, 0.45); addWorley(R, N, 8, 12, 0.33); addWorley(R, N, 16, 13, 0.22);
    for (let z = 0, i = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, i++) {
        const u = (x + 0.5) / N, v = (y + 0.5) / N, w = (z + 0.5) / N;
        R[i] += (p4(u, v, w) + p8(u, v, w) * 0.5) * 0.18;
        G[i] = p2(u, v, w);
    }
    const out = new Float32Array(N * N * N * 2);
    normalize(R, out, 2, 0);
    normalize(G, out, 2, 1);
    return out;
}

// Detail noise, R: Worley fbm that frays the edges into wisps
export function makeDetailNoise(N = DETAIL_RES) {
    const F = new Float32Array(N * N * N);
    addWorley(F, N, 2, 31, 0.55); addWorley(F, N, 4, 32, 0.3); addWorley(F, N, 8, 33, 0.15);
    const out = new Uint8Array(N * N * N);
    normalize(F, out, 1, 0);
    return out;
}

// Weather map, RGBA: R = cumulus potential (blobs of many sizes), G = how tall the cloud there grows,
// B = deck cover noise, A = cloud base altitude variation
export function makeWeatherMap(N = WEATHER_RES) {
    const S = WEATHER_SIZE;
    const octaves = [
        { cell: 2048, rMin: 0.3, rMax: 0.62, amp: 1, seed: 41 },
        { cell: 1024, rMin: 0.3, rMax: 0.6, amp: 0.85, seed: 42 },
        { cell: 512, rMin: 0.32, rMax: 0.55, amp: 0.45, seed: 43 },
    ].map(o => {
        // per cell: x, z, 1/R², amplitude, height, cos/sx, sin/sx, cos, sin
        const P = S / o.cell, pts = new Float32Array(P * P * 9);
        for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
            const size = hash(i, j, 7, o.seed), R = o.cell * (o.rMin + (o.rMax - o.rMin) * size);
            const sx = 1 + 0.5 * hash(i, j, 5, o.seed), ang = hash(i, j, 6, o.seed) * Math.PI;
            const k = (j * P + i) * 9;
            pts[k] = (i + 0.15 + 0.7 * hash(i, j, 1, o.seed)) * o.cell; pts[k + 1] = (j + 0.15 + 0.7 * hash(i, j, 2, o.seed)) * o.cell;
            pts[k + 2] = 1 / (R * R);
            pts[k + 3] = o.amp * (0.55 + 0.45 * hash(i, j, 3, o.seed));
            pts[k + 4] = (0.4 + 0.6 * size) * (0.72 + 0.28 * hash(i, j, 4, o.seed));
            pts[k + 5] = Math.cos(ang) / sx; pts[k + 6] = Math.sin(ang) / sx; pts[k + 7] = Math.cos(ang); pts[k + 8] = Math.sin(ang);
        }
        return { ...o, P, pts };
    });
    const warpX = perlin2(10, 51), warpZ = perlin2(10, 52), region = perlin2(3, 53), lumps = perlin2(48, 54), lumps2 = perlin2(112, 59);
    const d4 = perlin2(4, 55), d12 = perlin2(12, 56), d32 = perlin2(32, 57), baseN = perlin2(3, 58);
    const out = new Float32Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const u = (x + 0.5) / N, v = (y + 0.5) / N;
        // warped domain: irregular outlines instead of circles
        const px = u * S + warpX(u, v) * 300, pz = v * S + warpZ(u + 0.37, v + 0.13) * 300;
        let pot = 0, hw = 0, hs = 0;
        for (const o of octaves) {
            const cx = Math.floor(px / o.cell), cz = Math.floor(pz / o.cell), P = o.P, pts = o.pts;
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
                const i = cx + dx, j = cz + dz;
                const wi = ((i % P) + P) % P, wj = ((j % P) + P) % P, k = (wj * P + wi) * 9;
                // elliptical footprint with a paraboloid potential: rounded outlines once the threshold cuts it
                const ex = px - (pts[k] + (i - wi) * o.cell), ez = pz - (pts[k + 1] + (j - wj) * o.cell);
                const lx = ex * pts[k + 5] + ez * pts[k + 6], lz = -ex * pts[k + 8] + ez * pts[k + 7];
                const r2 = (lx * lx + lz * lz) * pts[k + 2];
                if (r2 >= 1) continue;
                const c = pts[k + 3] * (1 - r2);
                pot = pot > c ? pot + c * c * 0.35 : c + pot * pot * 0.35; // soft union: overlapping blobs merge
                const wgt = c * c * c * c;
                hw += wgt; hs += wgt * pts[k + 4];
            }
        }
        // regional variation: fields of cloud and clearer areas, and lumpy outlines
        pot *= 0.82 + 0.3 * region(u, v);
        pot += lumps(u, v) * 0.07 + lumps2(u, v) * 0.04;
        const k = (y * N + x) * 4;
        out[k] = sat(pot);
        out[k + 1] = sat(hw > 0 ? hs / hw : 0.5);
        const deck = d4(u, v) * 0.5 + d12(u, v) * 0.32 + d32(u, v) * 0.18;
        out[k + 2] = sat(deck * 0.8 + 0.5);
        out[k + 3] = sat(baseN(u, v) * 0.7 + 0.5);
    }
    return out;
}

// float -> IEEE half (what a HalfFloatType texture takes)
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);
export function toHalf(f) {
    const out = new Uint16Array(f.length);
    for (let i = 0; i < f.length; i++) {
        _f32[0] = f[i];
        const x = _u32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 112, m = x & 0x7fffff;
        out[i] = e <= 0 ? (e < -10 ? sign : sign | (((m | 0x800000) >> (1 - e)) + 0x1000) >> 13)
            : e >= 31 ? sign | 0x7c00 : sign | ((e << 10) + ((m + 0x1000) >> 13));
    }
    return out;
}

// everything clouds.js needs: float fields for the CPU, half floats / bytes for the GPU
export function makeCloudNoise() {
    const weather = makeWeatherMap(), base = makeBaseNoise(), detail = makeDetailNoise();
    return { weather, weatherHalf: toHalf(weather), base, baseHalf: toHalf(base), detail };
}

// as a module worker: generate everything and hand the buffers back
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = () => {
        const n = makeCloudNoise();
        self.postMessage(n, [n.weather.buffer, n.weatherHalf.buffer, n.base.buffer, n.baseHalf.buffer, n.detail.buffer]);
    };
}

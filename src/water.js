// ═══════════════════════════════════════════════════════════════
// The sea: one wave field for the renderer and the physics.
//
// Sea and lakes are the plane y = 0 at rest (a lake is terrain below 0). The surface is displaced by a sum of
// Gerstner (trochoidal) waves in three sets, generated from the weather:
//   0 swell      long, low waves from a distant storm (a gentle heave when the sky is clear)
//   1 wind sea   the waves the local wind raises: short and small in a breeze, long, steep and breaking in a storm
//   2 chop       short wind waves everywhere on open water, lakes included
// Each set is scaled by the sea-state map (watermap.js): swell only where the water opens onto the sea, wind sea
// with the open water upwind (fetch), chop a little less on small ponds; and every set dies away in the shallows.
// The same numbers feed the GLSL (WAVE_GLSL, packed into two vec4 arrays) and the functions below, so floating
// things and the physics sit exactly on the water that is drawn. The renderer fades the shortest waves out with
// distance (its grid can't carry them there); the CPU field keeps them (physics doesn't depend on the camera).
//
// Conventions: rest point p0 = (x0, z0), phase θ = k (D·p0) − ω t + φ, deep-water dispersion ω = √(g k).
//   height  y = Σ a cos θ
//   x = x0 − Σ q a Dx sin θ,  z = z0 − Σ q a Dz sin θ   (points crowd into the crests: q is the steepness)
// A world point (x, z) is traced back to its rest point with a few Newton steps.
// No three.js and no DOM here: the node tests load this file too.
// ═══════════════════════════════════════════════════════════════
const G = 9.81;
export const MAX_WAVES = 24;
const TAU = Math.PI * 2;

// ── Sea states per weather ──
// U: wind speed (m/s) for the detail ripples and whitecaps. Per set: hs = significant height (m, open sea),
// lp = peak wavelength (m), n = number of waves, spread = half-width of the directions (deg), dir = offset from
// the wind (deg), steep = crest-sharpening budget (Σ q a k of the set, ≤ ~0.35 for gentle, 0.7 for a storm sea).
// foamJ: crests whose Jacobian (WAVE_GLSL waveField) falls below this break into whitecaps: set so the white cover
// of the open sea follows Monahan's U^3.4 (about 0.5 % at 8 m/s, 2 % at 12, 7 % at 18)
export const SEA_STATES = {
    clear: {
        U: 5, whitecap: 0.0, foamJ: 0.7,
        sets: [
            { hs: 1.0, lp: 145, n: 5, spread: 13, dir: 38, steep: 0.12 },
            { hs: 0.3, lp: 17, n: 9, spread: 42, dir: 0, steep: 0.28 },
            { hs: 0.1, lp: 5.5, n: 8, spread: 70, dir: 0, steep: 0.22 },
        ],
    },
    cloudy: {
        U: 8, whitecap: 0.15, foamJ: 0.76,
        sets: [
            { hs: 1.2, lp: 150, n: 5, spread: 13, dir: 38, steep: 0.12 },
            { hs: 0.7, lp: 28, n: 9, spread: 42, dir: 0, steep: 0.38 },
            { hs: 0.16, lp: 6.5, n: 8, spread: 70, dir: 0, steep: 0.24 },
        ],
    },
    rain: {
        U: 12, whitecap: 0.55, foamJ: 0.82,
        sets: [
            { hs: 1.5, lp: 165, n: 5, spread: 14, dir: 35, steep: 0.14 },
            { hs: 1.7, lp: 52, n: 9, spread: 45, dir: 0, steep: 0.52 },
            { hs: 0.28, lp: 7.5, n: 8, spread: 70, dir: 0, steep: 0.26 },
        ],
    },
    storm: {
        U: 18, whitecap: 1.0, foamJ: 0.9,
        sets: [
            { hs: 2.4, lp: 200, n: 5, spread: 15, dir: 30, steep: 0.16 },
            { hs: 4.2, lp: 95, n: 9, spread: 48, dir: 0, steep: 0.66 },
            { hs: 0.45, lp: 9, n: 8, spread: 72, dir: 0, steep: 0.28 },
        ],
    },
};
// the shallows: a set's waves fade out over this depth (m) toward the shore (longer waves feel the bottom sooner)
export const SET_DEPTH = [22, 12, 2];

// ── Shore waves: the swell as it reaches a beach ──
// A wave train that follows the depth contours in to the shore: phase ω t + C √depth, so it slows and bunches up
// in the shallows the way a shoaling wave does (C fits a typical 1:20 beach). It grows (Green's law, a ∝ d^-¼)
// until it stands 0.78 of the depth high, steepens, breaks and runs out. Height only (no sideways motion), and
// only where the fine sea map knows the depth (within ~1 km of the camera). aSwell / aWind: amplitude per unit of
// swell / wind-sea exposure; the break zone gets foam (ocean.js).
export const SHORE = { aSwell: 0, aWind: 0, omega: 0.65, C: 0 };
export const SHORE_DMAX = 10;
const SHORE_SLOPE = 0.05, SHORE_E = 4;
// ── The swash: what's left of a broken wave running up the beach and back ──
// Each shore wave that reaches the waterline runs up as a thin sheet to R ≈ 0.95 × its incoming amplitude above the
// still water (a fit in the spirit of Stockdon et al. 2006's run-up for a 1:20 beach: ~0.4 m in a light swell, ~1.7 m
// in a gale), fast on the way up (a third of the period), slower back down; how far varies along the beach. Over the
// beach (true height h above sea level) the water stands at η, drawn where the terrain draws that height
// (terraincore.js shore(): the first metre of beach is raised 0.6 m to keep it off the sea plane), so the sheet
// meets the sand exactly where it reaches. Land within SWASH_H of the sea level only.
export const SWASH_H = 3;
// the drawn height of a true height y ≥ 0 near the waterline (terraincore.js shore())
const shoreDrawn = (y) => y + 0.6 * Math.max(0, 1 - y);
const fract = (x) => x - Math.floor(x);

// ── The live wave field ──
const W = {
    n: 0, dx: new Float64Array(MAX_WAVES), dz: new Float64Array(MAX_WAVES), k: new Float64Array(MAX_WAVES),
    w: new Float64Array(MAX_WAVES), a: new Float64Array(MAX_WAVES), q: new Float64Array(MAX_WAVES),
    ph: new Float64Array(MAX_WAVES), set: new Int8Array(MAX_WAVES), lambda: new Float64Array(MAX_WAVES),
};
export const WATER = {
    t: 0,              // the water's clock (s): World.update advances it, physics reads it
    weather: 'clear', U: 5, whitecap: 0, foamJ: 0.7,
    windX: 1, windZ: 0, // unit direction the wind blows toward (x, z)
    maxCrest: 0.6,     // highest the surface can rise (or sink) anywhere (m): Σ amplitudes × the largest map factor
    version: 0,        // bumped whenever the waves change
    waves: W,
    // GPU packing (see WAVE_GLSL): A = (Dx, Dz, k, a), B = (q, phase offset, wavelength, set)
    gpuA: new Float32Array(MAX_WAVES * 4), gpuB: new Float32Array(MAX_WAVES * 4),
    originX: 0, originZ: 0, // the origin the GPU's phase offsets are relative to (set by updateWaveUniforms)
};

// deterministic RNG (mulberry32), so a weather always makes the same sea
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Build the waves for a weather ('clear' | 'cloudy' | 'rain' | 'storm') and a wind direction (x, z; any length)
export function setSeaState(weather = 'clear', windX = 1, windZ = 0) {
    const S = SEA_STATES[weather] || SEA_STATES.clear;
    const wl = Math.hypot(windX, windZ);
    const wx = wl > 1e-6 ? windX / wl : 1, wz = wl > 1e-6 ? windZ / wl : 0;
    if (WATER.weather === weather && WATER.windX === wx && WATER.windZ === wz && W.n) return false;
    WATER.weather = weather; WATER.U = S.U; WATER.whitecap = S.whitecap; WATER.foamJ = S.foamJ; WATER.windX = wx; WATER.windZ = wz;
    const windAng = Math.atan2(wz, wx);
    let n = 0, crest = 0;
    S.sets.forEach((set, si) => {
        const r = rng(1013 + si * 7919);
        // wavelengths spread (log-uniform with jitter) from ~0.4 to ~1.7 × the peak; energy from a Pierson-
        // Moskowitz shape in frequency, so most of it sits near the peak
        const lams = [], ws = [];
        for (let j = 0; j < set.n; j++) {
            const u = (j + 0.2 + 0.6 * r()) / set.n;
            const lam = set.lp * Math.pow(0.38, 1 - u) * Math.pow(1.7, u);
            const om = Math.sqrt(G * TAU / lam), op = Math.sqrt(G * TAU / set.lp);
            const x = op / om;
            // S(ω) Δω with log spacing: ∝ ω^-4 exp(-1.25 (ωp/ω)^4)
            ws.push(Math.pow(x, 4) * Math.exp(-1.25 * Math.pow(x, 4)));
            lams.push(lam);
        }
        const wsum = ws.reduce((a, b) => a + b, 0);
        // directions stratified across the spread (alternating sides, jittered), phases random
        for (let j = 0; j < set.n && n < MAX_WAVES; j++) {
            const side = (j % 2 ? -1 : 1) * ((j + 1) >> 1) / Math.ceil(set.n / 2);
            const ang = windAng + (set.dir + set.spread * (side * 0.85 + (r() - 0.5) * 0.3)) * Math.PI / 180;
            const lam = lams[j], k = TAU / lam;
            const a = set.hs * Math.sqrt(ws[j] / wsum / 8);
            W.dx[n] = Math.cos(ang); W.dz[n] = Math.sin(ang);
            W.k[n] = k; W.w[n] = Math.sqrt(G * k); W.a[n] = a; W.lambda[n] = lam;
            // each wave takes an equal share of the set's crest-sharpening budget (q a k = steep / n)
            W.q[n] = Math.min(1.5, set.steep / set.n / Math.max(a * k, 1e-6));
            W.ph[n] = r() * TAU; W.set[n] = si;
            crest += a;
            n++;
        }
    });
    W.n = n;
    // the shore waves: the swell's period, about as high as the waves arriving (their height is capped by the depth)
    const sw = S.sets[0], ws = S.sets[1];
    SHORE.omega = Math.sqrt(G * TAU / sw.lp);
    SHORE.C = 2 * SHORE.omega / (SHORE_SLOPE * Math.sqrt(G));
    SHORE.aSwell = 0.42 * sw.hs; SHORE.aWind = 0.2 * ws.hs;
    WATER.maxCrest = crest * 1.25 + 0.05 + 0.39 * 2.5; // (map factors reach 1.2; a breaker stands up to 0.78 × its depth)
    for (let i = 0; i < MAX_WAVES; i++) {
        const o = i * 4;
        if (i < n) {
            WATER.gpuA[o] = W.dx[i]; WATER.gpuA[o + 1] = W.dz[i]; WATER.gpuA[o + 2] = W.k[i]; WATER.gpuA[o + 3] = W.a[i];
            WATER.gpuB[o] = W.q[i]; WATER.gpuB[o + 2] = W.lambda[i]; WATER.gpuB[o + 3] = W.set[i];
        } else {
            WATER.gpuA.fill(0, o, o + 4); WATER.gpuB.fill(0, o, o + 4);
        }
    }
    WATER.version++;
    updateWaveUniforms(WATER.originX, WATER.originZ);
    return true;
}

export function setWaterTime(t) { WATER.t = t; }

// Phase offsets for the GPU, relative to an origin near the camera (double precision here, so the shader's
// float32 phase stays exact however far from the world origin you are): θ = k D·(p − origin) + offset
export function updateWaveUniforms(originX, originZ, t = WATER.t) {
    WATER.originX = originX; WATER.originZ = originZ;
    for (let i = 0; i < W.n; i++) {
        let off = W.k[i] * (W.dx[i] * originX + W.dz[i] * originZ) - W.w[i] * t + W.ph[i];
        off -= Math.floor(off / TAU) * TAU;
        WATER.gpuB[i * 4 + 1] = off;
    }
}

// ── Sea-state maps (built by watermap.js, in a worker) ──
// Two squares of size × size texels, texel metres apart, south-west corner (x0, z0): [0] fine (8 m, around the
// camera), [1] coarse (64 m, 16 km). Per texel (RGBA): swell, wind-sea and chop factors (0..~1.2) and the water
// depth (m; negative over land). A lake (water with no way out to the sea) has its wind factor negative. The fine map wins where it has data, fading into the coarse one over its last
// EDGE texels; beyond both it is open, deep sea (the renderer has faded its waves out by then anyway).
export const SEA_MAPS = [
    { data: null, size: 0, texel: 1, x0: 0, z0: 0 },
    { data: null, size: 0, texel: 1, x0: 0, z0: 0 },
];
export const SEA_MAP_EDGE = 12;
export const SEA_OPEN = [1, 1, 1, 200];
export let seaMapVersion = 0;
export function setSeaMap(level, m) {
    const M = SEA_MAPS[level];
    if (!m) { M.data = null; M.size = 0; }
    else { M.data = m.data; M.size = m.size; M.texel = m.texel; M.x0 = m.x0; M.z0 = m.z0; }
    seaMapVersion++;
}
// one map at (x, z): texel-centred bilinear into out; returns its weight (0 outside, fading in over the edge)
function sampleMap(M, x, z, out) {
    const D = M.data;
    if (!D) return 0;
    const S = M.size;
    const fx = (x - M.x0) / M.texel - 0.5, fz = (z - M.z0) / M.texel - 0.5;
    if (!(fx >= 0 && fz >= 0 && fx <= S - 1 && fz <= S - 1)) return 0;
    const i = Math.min(Math.floor(fx), S - 2), j = Math.min(Math.floor(fz), S - 2);
    const a = fx - i, b = fz - j;
    const k00 = (j * S + i) * 4, k10 = k00 + 4, k01 = k00 + S * 4, k11 = k01 + 4;
    const w00 = (1 - a) * (1 - b), w10 = a * (1 - b), w01 = (1 - a) * b, w11 = a * b;
    for (let c = 0; c < 4; c++) out[c] = D[k00 + c] * w00 + D[k10 + c] * w10 + D[k01 + c] * w01 + D[k11 + c] * w11;
    const e = Math.min(fx, fz, S - 1 - fx, S - 1 - fz);
    return Math.min(1, e / SEA_MAP_EDGE);
}
// the maps' factors at (x, z), the same as the shader's seaFactors()
const _fb = [0, 0, 0, 0], _ma = [0, 0, 0, 0], _mb = [0, 0, 0, 0];
export function seaFactors(x, z, out = _fb) {
    const wf = sampleMap(SEA_MAPS[0], x, z, _ma);
    if (wf >= 1) { out[0] = _ma[0]; out[1] = _ma[1]; out[2] = _ma[2]; out[3] = _ma[3]; return out; }
    const wc = sampleMap(SEA_MAPS[1], x, z, _mb);
    for (let c = 0; c < 4; c++) {
        const base = SEA_OPEN[c] + (_mb[c] - SEA_OPEN[c]) * wc;
        out[c] = base + (_ma[c] - base) * wf;
    }
    return out;
}
const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
// amplitude multiplier per set at a map sample f: exposure × the shallows (a lake's wind factor is stored negative:
// watermap.js)
function setGain(f, s) { return Math.abs(f[s]) * smooth(0, SET_DEPTH[s], f[3]); }
// how much the fine map speaks for (x, z) (0 outside it)
const _fw = [0, 0, 0, 0];
function fineWeight(x, z) { return sampleMap(SEA_MAPS[0], x, z, _fw); }

// Shore wave over rest point (x, z) with map factors f: its height; its gradient into G2 [dh/dx, dh/dz];
// SHORE_OUT.br = how close to breaking it is (0..1) and SHORE_OUT.crest (0..1 at the crest)
export const SHORE_OUT = { br: 0, crest: 0, gx: 0, gz: 0 };
const _sa = [0, 0, 0, 0];
// the swash over a beach point (rest point x, z; true depth d < 0): the water surface height, foam in O.br
export function swash(x, z, t, f) {
    const O = SHORE_OUT;
    const d = f[3];
    if (!(d <= 0 && d > -SWASH_H) || !SHORE.C) return 0;
    const wf = fineWeight(x, z);
    if (wf <= 0) return 0;
    const a0 = SHORE.aSwell * f[0] + SHORE.aWind * Math.abs(f[1]);
    // how far it runs varies along the beach (cusps, the bed), and so does its timing a little
    const along = 0.7 + 0.3 * Math.sin(0.11 * x + 1.3) * Math.sin(0.083 * z - 0.7) + 0.3 * Math.sin(0.037 * x - 0.051 * z);
    const R = 0.95 * a0 * along * wf;
    if (R <= 1e-3) return 0;
    const ph = fract((SHORE.omega * t + 0.4 + 0.05 * Math.sin(0.021 * x + 0.017 * z)) / (Math.PI * 2));
    const sw = ph < 0.35 ? Math.sin(ph / 0.35 * Math.PI / 2) : ph < 0.85 ? Math.cos((ph - 0.35) / 0.5 * Math.PI / 2) ** 2 : 0;
    const eta = R * sw, h = -d;
    O.br = eta > h ? (1 - smooth(0, 0.35, eta - h)) * (ph < 0.35 ? 1 : 0.55) * wf : 0;
    O.crest = 1; // (the foam rides the sheet's leading edge)
    return shoreDrawn(eta);
}
export function shoreWave(x, z, t, f) {
    const O = SHORE_OUT;
    O.br = 0; O.crest = 0; O.gx = 0; O.gz = 0;
    const d = f[3];
    if (d <= 0) return swash(x, z, t, f);
    if (!(d > 0 && d < SHORE_DMAX) || !SHORE.C) return 0;
    const wf = fineWeight(x, z);
    if (wf <= 0) return 0;
    const a0 = SHORE.aSwell * f[0] + SHORE.aWind * Math.abs(f[1]);
    const A = Math.min(a0 * Math.pow(4 / Math.max(d, 0.5), 0.25), 0.39 * d) * smooth(SHORE_DMAX, SHORE_DMAX * 0.5, d) * smooth(0, 0.3, d) * wf;
    if (A <= 1e-5) return 0;
    const rel = A / Math.max(d, 0.05), b = smooth(0.15, 0.39, rel), n = 1 + 4 * b;
    const sd = Math.sqrt(d), ph = SHORE.omega * t + SHORE.C * sd;
    const c = 0.5 + 0.5 * Math.cos(ph), cn1 = Math.pow(c, n - 1);
    // gradient: dh/dd · ∇d (∇d from the map, by central differences)
    const dhdd = -A * n * cn1 * Math.sin(ph) * SHORE.C / (2 * Math.max(sd, 0.2));
    const e = SHORE_E;
    const ddx = (seaFactors(x + e, z, _sa)[3] - seaFactors(x - e, z, _sa)[3]) / (2 * e);
    const ddz = (seaFactors(x, z + e, _sa)[3] - seaFactors(x, z - e, _sa)[3]) / (2 * e);
    O.gx = dhdd * ddx; O.gz = dhdd * ddz;
    O.br = smooth(0.26, 0.39, rel) * wf; O.crest = c;
    return A * (2 * cn1 * c - 1) * 0.9;
}

// ── Evaluation ──
const _f = [0, 0, 0, 0], _g = [0, 0, 0];
// Horizontal displacement and its Jacobian at rest point (x0, z0): fills E
const E = { dx: 0, dz: 0, jxx: 0, jxz: 0, jzz: 0 };
function displace(x0, z0, t, minLam) {
    seaFactors(x0, z0, _f);
    _g[0] = setGain(_f, 0); _g[1] = setGain(_f, 1); _g[2] = setGain(_f, 2);
    let dx = 0, dz = 0, jxx = 0, jxz = 0, jzz = 0;
    for (let i = 0; i < W.n; i++) {
        if (W.lambda[i] < minLam) continue;
        const a = W.a[i] * _g[W.set[i]];
        if (a === 0) continue;
        const th = W.k[i] * (W.dx[i] * x0 + W.dz[i] * z0) - W.w[i] * t + W.ph[i];
        const s = Math.sin(th), c = Math.cos(th);
        const qa = W.q[i] * a, qak = qa * W.k[i] * c;
        dx -= qa * W.dx[i] * s; dz -= qa * W.dz[i] * s;
        jxx += qak * W.dx[i] * W.dx[i]; jxz += qak * W.dx[i] * W.dz[i]; jzz += qak * W.dz[i] * W.dz[i];
    }
    E.dx = dx; E.dz = dz; E.jxx = 1 - jxx; E.jxz = -jxz; E.jzz = 1 - jzz;
    return E;
}

// Trace world (x, z) back to its rest point: Newton on p0 + D(p0) = p. Returns [x0, z0] in R.
const R = [0, 0];
function restPoint(x, z, t, minLam) {
    let x0 = x, z0 = z;
    for (let it = 0; it < 5; it++) {
        const e = displace(x0, z0, t, minLam);
        const fx = x0 + e.dx - x, fz = z0 + e.dz - z;
        if (fx * fx + fz * fz < 1e-8) break;
        const det = e.jxx * e.jzz - e.jxz * e.jxz;
        if (det > 0.05) {
            x0 -= (e.jzz * fx - e.jxz * fz) / det;
            z0 -= (e.jxx * fz - e.jxz * fx) / det;
        } else { x0 -= fx; z0 -= fz; } // near a fold: plain fixed-point step
    }
    R[0] = x0; R[1] = z0;
    return R;
}

// Everything about the surface over world (x, z): height h, unit normal, surface-particle velocity,
// the horizontal Jacobian (< ~0.4 at a breaking crest) and the rest point. minLam: skip waves shorter than
// this (a ship's hull rides over them).
const SAMPLE = { h: 0, nx: 0, ny: 1, nz: 0, vx: 0, vy: 0, vz: 0, jac: 1, x0: 0, z0: 0, depth: 0 };
export function waterSample(x, z, t = WATER.t, out = SAMPLE, minLam = 0) {
    const [x0, z0] = restPoint(x, z, t, minLam);
    seaFactors(x0, z0, _f);
    _g[0] = setGain(_f, 0); _g[1] = setGain(_f, 1); _g[2] = setGain(_f, 2);
    let h = 0, sx = 0, sz = 0, jxx = 0, jxz = 0, jzz = 0, vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < W.n; i++) {
        if (W.lambda[i] < minLam) continue;
        const a = W.a[i] * _g[W.set[i]];
        if (a === 0) continue;
        const k = W.k[i], ddx = W.dx[i], ddz = W.dz[i], om = W.w[i];
        const th = k * (ddx * x0 + ddz * z0) - om * t + W.ph[i];
        const s = Math.sin(th), c = Math.cos(th);
        const qa = W.q[i] * a;
        h += a * c;
        sx -= a * k * ddx * s; sz -= a * k * ddz * s;           // ∂y/∂x0, ∂y/∂z0
        const qak = qa * k * c;
        jxx += qak * ddx * ddx; jxz += qak * ddx * ddz; jzz += qak * ddz * ddz;
        vx += qa * om * ddx * c; vz += qa * om * ddz * c; vy += a * om * s;
    }
    if (minLam === 0) {
        const fx = _f[0], fy = _f[1], fz = _f[2], fd = _f[3]; // (shoreWave samples the map again)
        const hs = shoreWave(x0, z0, t, _f);
        _f[0] = fx; _f[1] = fy; _f[2] = fz; _f[3] = fd;
        if (hs !== 0 || SHORE_OUT.gx !== 0) {
            h += hs; sx += SHORE_OUT.gx; sz += SHORE_OUT.gz;
        }
    }
    // tangents Tx = (1 − jxx, sx, −jxz), Tz = (−jxz, sz, 1 − jzz); normal = Tz × Tx
    const txx = 1 - jxx, txz = -jxz, tzx = -jxz, tzz = 1 - jzz;
    let nx = sz * txz - tzz * sx, ny = tzz * txx - tzx * txz, nz = tzx * sx - sz * txx;
    const il = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
    out.h = h; out.nx = nx * il; out.ny = ny * il; out.nz = nz * il;
    out.vx = vx; out.vy = vy; out.vz = vz;
    out.jac = txx * tzz - txz * tzx;
    out.x0 = x0; out.z0 = z0; out.depth = _f[3];
    return out;
}

// Height of the surface over (x, z) at time t (m)
export function waterHeight(x, z, t = WATER.t) { return waterSample(x, z, t, SAMPLE).h; }
// Unit normal (x, y, z fields of `out`)
export function waterNormal(x, z, t = WATER.t, out = { x: 0, y: 1, z: 0 }) {
    const s = waterSample(x, z, t, SAMPLE);
    out.x = s.nx; out.y = s.ny; out.z = s.nz;
    return out;
}
// Velocity of the water at the surface over (x, z) (orbital motion; m/s)
export function waterVelocity(x, z, t = WATER.t, out = { x: 0, y: 0, z: 0 }) {
    const s = waterSample(x, z, t, SAMPLE);
    out.x = s.vx; out.y = s.vy; out.z = s.vz;
    return out;
}
// The surface as a long hull feels it: only waves at least minLam long
export function waterHeightLong(x, z, minLam, t = WATER.t) { return waterSample(x, z, t, SAMPLE, minLam).h; }

// ── GLSL ──
// The same field for shaders. Needs the uniforms of waveUniforms() (ocean.js) plus `seaMap` / `seaMapInfo` for
// the sea-state map (a float RGBA texture, read with texelFetch and blended by hand exactly like seaFactors()).
// waveLod: (near, far) multiples of a wave's length over which the renderer fades it out with distance.
export const WAVE_GLSL = /* glsl */`
    #define MAX_WAVES ${MAX_WAVES}
    uniform vec4 waveA[MAX_WAVES];   // Dx, Dz, k, a
    uniform vec4 waveB[MAX_WAVES];   // q, phase offset, wavelength, set
    uniform int waveN;
    uniform vec2 waveOrigin, waveLod;
    uniform sampler2D seaMapFine, seaMapCoarse;
    uniform vec4 seaFineInfo, seaCoarseInfo; // x0, z0, texel, size (0: no map)
    uniform vec3 setDepth;           // SET_DEPTH
    // one map at p: bilinear by hand (exactly like water.js sampleMap); w = its weight (0 outside, fades in at the edge)
    vec4 seaMapAt(sampler2D map, vec4 info, vec2 p, out float wt) {
        wt = 0.0;
        if (info.w < 1.0) return vec4(0.0);
        vec2 f = (p - info.xy) / info.z - 0.5;
        float S = info.w;
        if (f.x < 0.0 || f.y < 0.0 || f.x > S - 1.0 || f.y > S - 1.0) return vec4(0.0);
        ivec2 i = ivec2(min(floor(f), vec2(S - 2.0)));
        vec2 w = f - vec2(i);
        vec4 a = texelFetch(map, i, 0), b = texelFetch(map, i + ivec2(1, 0), 0);
        vec4 c = texelFetch(map, i + ivec2(0, 1), 0), d = texelFetch(map, i + ivec2(1, 1), 0);
        wt = min(1.0, min(min(f.x, f.y), min(S - 1.0 - f.x, S - 1.0 - f.y)) / ${SEA_MAP_EDGE.toFixed(1)});
        return a * ((1.0 - w.x) * (1.0 - w.y)) + b * (w.x * (1.0 - w.y)) + c * ((1.0 - w.x) * w.y) + d * (w.x * w.y);
    }
    vec4 seaFactors(vec2 p) {
        float wf, wc;
        vec4 fine = seaMapAt(seaMapFine, seaFineInfo, p, wf);
        if (wf >= 1.0) return fine;
        vec4 coarse = seaMapAt(seaMapCoarse, seaCoarseInfo, p, wc);
        vec4 base = mix(vec4(${SEA_OPEN.map(v => v.toFixed(1)).join(', ')}), coarse, wc);
        return mix(base, fine, wf);
    }
    vec3 setGains(vec4 f) {
        return abs(f.xyz) * vec3(smoothstep(0.0, setDepth.x, f.w), smoothstep(0.0, setDepth.y, f.w), smoothstep(0.0, setDepth.z, f.w));
    }
    // Displacement of rest point p0 (world xz) seen from dist metres away (short waves fade out with distance),
    // with the tangents Tx = d(pos)/dx0 and Tz = d(pos)/dz0, and for whitecaps the horizontal Jacobian (crest folding,
    // with fetch-limited sets as steep as √gain) now and a moment ago (0.8 s, 2 s: where a crest broke, foam lingers)
    vec3 waveField(vec2 p0, float dist, vec3 gains, out vec3 Tx, out vec3 Tz, out float jac, out vec2 jacPast) {
        vec2 lp = p0 - waveOrigin;
        vec3 d = vec3(0.0);
        float sx = 0.0, sz = 0.0, jxx = 0.0, jxz = 0.0, jzz = 0.0;
        vec3 w0 = vec3(0.0), p1 = vec3(0.0), p2 = vec3(0.0); // breaking (jxx, jxz, jzz): now, 0.8 s and 2 s ago
        for (int i = 0; i < MAX_WAVES; i++) {
            if (i >= waveN) break;
            vec4 A = waveA[i], B = waveB[i];
            float g = B.w < 0.5 ? gains.x : B.w < 1.5 ? gains.y : gains.z;
            float a = A.w * g * (1.0 - smoothstep(waveLod.x * B.z, waveLod.y * B.z, dist));
            if (a <= 0.0) continue;
            float th = A.z * dot(A.xy, lp) + B.y;
            float s = sin(th), c = cos(th);
            float qa = B.x * a;
            d.y += a * c;
            d.xz -= qa * A.xy * s;
            sx -= a * A.z * A.x * s; sz -= a * A.z * A.y * s;
            float qk = qa * A.z;
            vec3 dd = vec3(A.x * A.x, A.x * A.y, A.y * A.y) * qk;
            jxx += dd.x * c; jxz += dd.y * c; jzz += dd.z * c;
            // for whitecaps: a fetch-limited (young) sea is smaller than the open one but about as steep, so its
            // breaking goes with the square root of the set's gain
            vec3 dw = dd * inversesqrt(max(g, 1e-4));
            float om = sqrt(9.81 * A.z);
            w0 += dw * c;
            p1 += dw * cos(th + om * 0.8);
            p2 += dw * cos(th + om * 2.0);
        }
        Tx = vec3(1.0 - jxx, sx, -jxz);
        Tz = vec3(-jxz, sz, 1.0 - jzz);
        jac = (1.0 - w0.x) * (1.0 - w0.z) - w0.y * w0.y;
        jacPast = vec2((1.0 - p1.x) * (1.0 - p1.z) - p1.y * p1.y, (1.0 - p2.x) * (1.0 - p2.z) - p2.y * p2.y);
        return d;
    }
    // Shore wave over rest point p with map factors f (water.js shoreWave): height; gradient into grad;
    // br = how close to breaking, crest = 1 on the crest
    uniform vec4 shoreInfo; // aSwell, aWind, omega, C
    uniform float time;
    float seaFineWeight(vec2 p) {
        if (seaFineInfo.w < 1.0) return 0.0;
        vec2 f = (p - seaFineInfo.xy) / seaFineInfo.z - 0.5;
        float S = seaFineInfo.w;
        if (f.x < 0.0 || f.y < 0.0 || f.x > S - 1.0 || f.y > S - 1.0) return 0.0;
        return min(1.0, min(min(f.x, f.y), min(S - 1.0 - f.x, S - 1.0 - f.y)) / ${SEA_MAP_EDGE.toFixed(1)});
    }
    // the swash over a beach point (water.js swash)
    float swash(vec2 p, vec4 f, out float br, out float crest) {
        br = 0.0; crest = 1.0; // (the foam rides the sheet's leading edge)
        float d = f.w;
        if (!(d <= 0.0 && d > -${SWASH_H.toFixed(1)}) || shoreInfo.w <= 0.0) return 0.0;
        float wf = seaFineWeight(p);
        if (wf <= 0.0) return 0.0;
        float a0 = shoreInfo.x * f.x + shoreInfo.y * abs(f.y);
        float along = 0.7 + 0.3 * sin(0.11 * p.x + 1.3) * sin(0.083 * p.y - 0.7) + 0.3 * sin(0.037 * p.x - 0.051 * p.y);
        float R = 0.95 * a0 * along * wf;
        if (R <= 1e-3) return 0.0;
        float ph = fract((shoreInfo.z * time + 0.4 + 0.05 * sin(0.021 * p.x + 0.017 * p.y)) / 6.2831853);
        float c = ph < 0.35 ? sin(ph / 0.35 * 1.5707963) : ph < 0.85 ? cos((ph - 0.35) / 0.5 * 1.5707963) : 0.0;
        float sw = ph < 0.35 ? c : c * c;
        float eta = R * sw, h = -d;
        br = eta > h ? (1.0 - smoothstep(0.0, 0.35, eta - h)) * (ph < 0.35 ? 1.0 : 0.55) * wf : 0.0;
        return eta + 0.6 * max(0.0, 1.0 - eta);
    }
    float shoreWave(vec2 p, vec4 f, out vec2 grad, out float br, out float crest) {
        grad = vec2(0.0); br = 0.0; crest = 0.0;
        float d = f.w;
        if (d <= 0.0) return swash(p, f, br, crest);
        if (!(d > 0.0 && d < ${SHORE_DMAX.toFixed(1)}) || shoreInfo.w <= 0.0) return 0.0;
        float wf = seaFineWeight(p);
        if (wf <= 0.0) return 0.0;
        float a0 = shoreInfo.x * f.x + shoreInfo.y * abs(f.y);
        float A = min(a0 * pow(4.0 / max(d, 0.5), 0.25), 0.39 * d) * smoothstep(${SHORE_DMAX.toFixed(1)}, ${(SHORE_DMAX * 0.5).toFixed(1)}, d) * smoothstep(0.0, 0.3, d) * wf;
        if (A <= 1e-5) return 0.0;
        float rel = A / max(d, 0.05), b = smoothstep(0.15, 0.39, rel), n = 1.0 + 4.0 * b;
        float sd = sqrt(d), ph = shoreInfo.z * time + shoreInfo.w * sd;
        float c = 0.5 + 0.5 * cos(ph), cn1 = pow(c, n - 1.0);
        float dhdd = -A * n * cn1 * sin(ph) * shoreInfo.w / (2.0 * max(sd, 0.2));
        const float e = ${SHORE_E.toFixed(1)};
        vec2 gd = vec2(seaFactors(p + vec2(e, 0.0)).w - seaFactors(p - vec2(e, 0.0)).w, seaFactors(p + vec2(0.0, e)).w - seaFactors(p - vec2(0.0, e)).w) / (2.0 * e);
        grad = dhdd * gd;
        br = smoothstep(0.26, 0.39, rel) * wf; crest = c;
        return A * (2.0 * cn1 * c - 1.0) * 0.9;
    }
    // just the height over world point p (no inversion: good to a few cm in gentle seas; for effects)
    float waveHeightApprox(vec2 p, float dist) {
        vec3 tx, tz; float j; vec2 jp;
        vec3 g = setGains(seaFactors(p));
        vec3 d = waveField(p, dist, g, tx, tz, j, jp);
        // one fixed-point step toward the rest point
        d = waveField(p - d.xz, dist, g, tx, tz, j, jp);
        return d.y;
    }`;

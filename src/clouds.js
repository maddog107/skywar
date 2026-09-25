// ═══════════════════════════════════════════════════════════════
// Clouds: raymarched volumetric cumulus and the overcast deck
// ═══════════════════════════════════════════════════════════════
// One density field for the whole sky, marched per pixel at reduced resolution:
//   - a 2D weather map (tileable, 32 km) says where cumulus stand, how tall they grow, where the rain deck
//     is thick and how high the cloud base sits; a coverage threshold from the weather turns scattered fair
//     weather cumulus into broken stratocumulus;
//   - each cumulus is a flat-bottomed dome (an ellipsoid cap over the weather blob), eroded by a tileable
//     Perlin-Worley noise volume into cauliflower billows, with a fine Worley volume fraying its edges;
//   - rain and storms add a stratus deck at DECK_Y with a ragged base and a lumpy top.
// Lighting: Beer-Lambert extinction, a short light march toward the sun with a multiple-scattering
// approximation (a few octaves of weaker extinction and flatter phase), a two-lobe Henyey-Greenstein phase
// for the silver lining, sky light from above / darker bounce below, and the shared aerial perspective.
//
// Rendering: a full-screen triangle in the main scene (renderOrder 5, like the old clouds). Just before it
// draws (onBeforeRender), the opaque scene is already in the render target, so its depth texture is marched
// against in a nested pass into a small two-target buffer: premultiplied colour + alpha, and the distance the
// cloud starts at + the scene distance the ray stopped at. The triangle then upsamples that buffer (ignoring
// low-res texels whose ray hit a nearer object than their neighbours) and writes the cloud's entry depth to
// gl_FragDepth, so the hardware depth test cuts it cleanly around aircraft and terrain at full resolution.
import * as THREE from 'three';

export const DECK_Y = 2400;          // base of the overcast deck in rain and storms (m)
const DECK_THICK = 650;              // its thickness where fully covered (m)
const WEATHER_SIZE = 32768;          // weather map tile (m)
const WEATHER_RES = 512;
const BASE_SIZE = 1400;              // shape noise tile (m)
const BASE_RES = 64;
const DETAIL_SIZE = 260;             // detail noise tile (m)
const DETAIL_RES = 32;
const SIGMA = 0.04;                  // extinction at full density (1/m)
const EDGE = 20;                     // metres over which density ramps up at a cloud's surface
const EDGE_SCALE = 0.0011;           // field units per metre, roughly (see cloudDensity)
const NO_HIT = 60000;                // "no cloud" / "sky" distance (fits a half float)

// per weather: coverage threshold on the weather map (lower = more cloud), cloud base, tallest tops above
// the base, base altitude variation, deck amount (0 = none)
const WEATHER = {
    clear:  { thr: 0.56, base: 1300, thick: 560, baseVar: 160, deck: 0 },
    cloudy: { thr: 0.42, base: 1250, thick: 800, baseVar: 200, deck: 0 },
    rain:   { thr: 0.36, base: 1050, thick: 1000, baseVar: 160, deck: 0.62 },
    storm:  { thr: 0.3, base: 950, thick: 2200, baseVar: 160, deck: 0.85 },
};

const QUALITY = {
    // scale: cloud buffer size relative to the CSS pixel size; steps: primary march; light: light march
    high:   { scale: 0.5, steps: 112, light: 5, detail: 1 },
    medium: { scale: 0.42, steps: 88, light: 4, detail: 1 },
    low:    { scale: 0.28, steps: 56, light: 3, detail: 0 },
};

// ═══════════════════════════════════════════════════════════════
// Noise (generated once on the CPU; the same arrays answer densityAt() for the whiteout)
// ═══════════════════════════════════════════════════════════════
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
// distance to the nearest feature point (in cells) at u, v, w in [0, 1)
function worley3(pts, P, u, v, w) {
    const x = u * P, y = v * P, z = w * P;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) {
        const cz = iz + dz, wz = (cz + P) % P, oz = cz - wz;
        for (let dy = -1; dy <= 1; dy++) {
            const cy = iy + dy, wy = (cy + P) % P, oy = cy - wy;
            for (let dx = -1; dx <= 1; dx++) {
                const cx = ix + dx, wx = (cx + P) % P, ox = cx - wx;
                const k = ((wz * P + wy) * P + wx) * 3;
                const ex = pts[k] + ox - x, ey = pts[k + 1] + oy - y, ez = pts[k + 2] + oz - z;
                const d = ex * ex + ey * ey + ez * ez;
                if (d < best) best = d;
            }
        }
    }
    return Math.sqrt(best);
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

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

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
    const w4 = worleyPoints(4, 11), w8 = worleyPoints(8, 12), w16 = worleyPoints(16, 13);
    const p4 = perlin3(4, 21), p8 = perlin3(8, 22), p2 = perlin3(2, 24);
    const R = new Float32Array(N * N * N), G = new Float32Array(N * N * N);
    for (let z = 0, i = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, i++) {
        const u = (x + 0.5) / N, v = (y + 0.5) / N, w = (z + 0.5) / N;
        const wf = (1 - worley3(w4, 4, u, v, w)) * 0.45 + (1 - worley3(w8, 8, u, v, w)) * 0.33 + (1 - worley3(w16, 16, u, v, w)) * 0.22;
        const pn = p4(u, v, w) + p8(u, v, w) * 0.5;
        R[i] = wf + pn * 0.18;
        G[i] = p2(u, v, w);
    }
    const out = new Float32Array(N * N * N * 2);
    normalize(R, out, 2, 0);
    normalize(G, out, 2, 1);
    return out;
}

// Detail noise, R: Worley fbm that frays the edges into wisps
export function makeDetailNoise(N = DETAIL_RES) {
    const a = worleyPoints(2, 31), b = worleyPoints(4, 32), c = worleyPoints(8, 33);
    const F = new Float32Array(N * N * N);
    for (let z = 0, i = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, i++) {
        const u = (x + 0.5) / N, v = (y + 0.5) / N, w = (z + 0.5) / N;
        F[i] = (1 - worley3(a, 2, u, v, w)) * 0.55 + (1 - worley3(b, 4, u, v, w)) * 0.3 + (1 - worley3(c, 8, u, v, w)) * 0.15;
    }
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
        { cell: 512, rMin: 0.32, rMax: 0.55, amp: 0.55, seed: 43 },
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
                // elliptical footprint: paraboloid potential, so a threshold cut gives an ellipsoid dome (see shader)
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

// ═══════════════════════════════════════════════════════════════
// Shaders
// ═══════════════════════════════════════════════════════════════
// shared by the march and its light march: the density field
const FIELD_GLSL = /* glsl */`
    uniform sampler2D tWeather;
    uniform highp sampler3D tBase, tDetail;
    uniform vec3 wind;   // x, z: wind drift (m); y: slow rise of the billows (m)
    uniform vec4 cu;     // cumulus: coverage threshold, base altitude, tallest tops above the base, base variation
    uniform vec4 dk;     // deck: amount (0 = none), base altitude, thickness
    uniform vec2 slab;   // altitudes that can hold any cloud
    float pixFoot;       // metres one low-res pixel covers at the current sample (set by the march)
    #define WEATHER_SIZE ${WEATHER_SIZE.toFixed(1)}
    #define BASE_SIZE ${BASE_SIZE.toFixed(1)}
    #define DETAIL_SIZE ${DETAIL_SIZE.toFixed(1)}
    #define SIGMA ${SIGMA}

    vec4 weatherAt(vec3 p) { return textureLod(tWeather, (p.xz - wind.xz) / WEATHER_SIZE, 0.0); }
    // the same, B-spline filtered (four bilinear taps): plain bilinear creases the cloud walls along every texel
    vec4 cubicW(float v) {
        vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v, s = n * n * n;
        float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
        return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
    }
    vec4 weatherSmooth(vec3 p) {
        vec2 uv = (p.xz - wind.xz) / WEATHER_SIZE * ${WEATHER_RES.toFixed(1)} - 0.5;
        vec2 f = fract(uv); uv -= f;
        vec4 xc = cubicW(f.x), yc = cubicW(f.y);
        vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
        vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
        vec4 o = (c + vec4(xc.yw, yc.yw) / s) / ${WEATHER_RES.toFixed(1)};
        vec4 s0 = textureLod(tWeather, o.xz, 0.0), s1 = textureLod(tWeather, o.yz, 0.0);
        vec4 s2 = textureLod(tWeather, o.xw, 0.0), s3 = textureLod(tWeather, o.yw, 0.0);
        float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
        return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
    }
    // The field is in "coverage units": 0 at a cloud's surface, growing inward; noise erodes it in the same units,
    // so it can bite into the sides as easily as the top (a steep metre-based wall would look extruded).
    // cumulus before noise: a dome over the weather blob (its top at sqrt(cover) of the tallest height), flat base
    float cumulusShape(vec3 p, vec4 wm, out float hf) {
        float cov = clamp((wm.r - cu.x) / (1.0 - cu.x), 0.0, 1.0);
        float h = p.y - (cu.y + (wm.a - 0.5) * cu.w);
        float y = h / (cu.z * wm.g);
        float c = smoothstep(0.0, 0.6, cov);
        hf = clamp(y / max(sqrt(c), 0.05), 0.0, 1.0);
        return min(c - y * y, h * 0.004);
    }
    // deck before noise: inside the layer (thinner where its cover is patchy)
    float deckShape(vec3 p, vec4 wm, out float hf) {
        float cover = smoothstep(1.0 - dk.x, 1.35 - dk.x, wm.b);
        float h = p.y - dk.y;
        hf = clamp(h / dk.z, 0.0, 1.0);
        return cover > 0.0 ? min(h + 90.0, dk.z * cover - h) * 0.002 : -1.0;
    }
    // conservative distance (m) to where cloud could start, for skipping empty air
    float cloudGap(vec3 p, vec4 wm) {
        float h = p.y - (cu.y + (wm.a - 0.5) * cu.w);
        float g = max((cu.x - wm.r) * 450.0, max(-h, h - cu.z * wm.g));
        if (dk.x > 0.0) g = min(g, max(dk.y - 150.0 - p.y, p.y - dk.y - dk.z - 50.0));
        return g;
    }
    // full density 0..1 (edge: metres over which it ramps up at the surface);
    // amb: height within the cloud (0 base .. 1 top) for the sky light
    float cloudDensity(vec3 p, vec4 wm, float lod, float edge, bool detail, out float amb) {
        float hc, hd;
        float s = cumulusShape(p, wm, hc), sd = deckShape(p, wm, hd);
        amb = hc;
        if (max(s, sd) <= 0.0) return 0.0;
        vec2 n = textureLod(tBase, (p - wind) / BASE_SIZE, lod).rg;
        float billow = n.r; // 1 = solid
        // cumulus: billowy sides, deeper cauliflower heads on top (how deep varies from cloud to cloud), only a
        // little raggedness at the flat base, and thin fringes (little cover) mostly eaten away so clouds don't
        // stand on a wide brim
        float cov = (wm.r - cu.x) / (1.0 - cu.x);
        s -= (1.0 - billow) * (mix(0.1, 0.5, smoothstep(0.0, 0.5, hc)) * (0.65 + 0.7 * n.g) + 0.12 * (1.0 - smoothstep(0.0, 0.3, cov)));
        // deck: a ragged base and a lumpy top
        sd -= (1.0 - billow) * 0.38;
        if (sd > s) { s = sd; amb = hd; }
        float e = edge * ${EDGE_SCALE};
        #if DETAIL
        if (detail && s > 0.0 && s < e + 0.14) {
            // (mip-mapped by the pixel's footprint: finer than a pixel it only makes fur)
            float ld = max(0.0, log2(pixFoot / ${(DETAIL_SIZE / DETAIL_RES).toFixed(2)}));
            float nd = textureLod(tDetail, (p - wind * 1.3) / DETAIL_SIZE, ld).r;
            s -= (1.0 - nd) * mix(0.03, 0.14, smoothstep(0.1, 0.6, amb)) * (1.0 - smoothstep(1.0, 3.0, ld));
        }
        #endif
        return clamp(s / e, 0.0, 1.0);
    }`;

const TRI_VERT = /* glsl */`
    void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const marchFrag = (FOG_GLSL) => /* glsl */`
    precision highp float;
    uniform sampler2D tDepth;
    uniform float hasDepth, camNear, camFar, maxDist, sunScale, frame, pixAngle, flash;
    uniform mat4 projInv, camWorld;
    uniform vec2 lowRes;
    uniform vec3 camPos, sunDir, litColor, shadowColor, fogColor;
    layout(location = 0) out vec4 oColor;
    layout(location = 1) out vec4 oInfo;
    #include <packing>
    ${FOG_GLSL}
    ${FIELD_GLSL}
    #define NO_HIT ${NO_HIT.toFixed(1)}

    float stepAt(float t) { return 10.0 + t * 0.01; }
    // Henyey-Greenstein, scaled so an isotropic phase is 1
    float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5); }
    float phase(float mu, float k) { return min(0.7 * hg(mu, 0.6 * k) + 0.3 * hg(mu, -0.25 * k), 4.0); }

    // optical depth toward the sun: LIGHT_STEPS samples, each step longer than the last (~680 m in all), spread
    // over a cone around the sun direction with a new random offset every frame, so small billows cast soft
    // shadows once the resolve pass has averaged a few frames (a thin exact ray would streak)
    // well-mixed integer hash (pcg3d): pixel, frame, sample -> three uniform numbers, no spatial structure
    vec3 rand3(float a, float b) {
        uvec3 v = uvec3(uvec2(gl_FragCoord.xy), uint(a) * 4099u + uint(b));
        v = v * 1664525u + 1013904223u;
        v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
        v ^= v >> 16u;
        v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
        return vec3(v) * (1.0 / 4294967296.0);
    }
    float lightDepth(vec3 p, float lod, float jit) {
        float od = 0.0, d = 0.0, st = LIGHT_STEP0;
        for (int j = 0; j < LIGHT_STEPS; j++) {
            vec3 r = rand3(frame, float(j + 1)) - 0.5;
            float dj = d + st * r.x + st * 0.5;
            vec3 q = p + sunDir * dj + r * (dj * 0.35 + 12.0);
            if (q.y > slab.y) break;
            float a;
            vec4 wq = j < 2 ? weatherSmooth(q) : weatherAt(q);
            od += cloudDensity(q, wq, lod + 0.5 + float(j) * 0.5, max(${EDGE.toFixed(1)}, st * 0.5) + 25.0, false, a) * st;
            d += st; st *= LIGHT_RATIO;
        }
        return od * SIGMA;
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / lowRes;
        vec4 vp = projInv * vec4(uv * 2.0 - 1.0, 0.5, 1.0);
        vec3 vray = vp.xyz / vp.w;
        vray /= -vray.z;                     // view-space ray through this pixel at z = -1
        float rayLen = length(vray);
        vec3 rd = normalize(mat3(camWorld) * vray);
        vec3 ro = camPos;
        // where the opaque scene stops the ray
        float limit = NO_HIT;
        if (hasDepth > 0.5) {
            float d = texture(tDepth, uv).r;
            #ifdef USE_REVERSED_DEPTH_BUFFER
            bool sky = d <= 0.0;
            #else
            bool sky = d >= 1.0;
            #endif
            if (!sky) limit = min(-perspectiveDepthToViewZ(d, camNear, camFar) * rayLen, NO_HIT);
        }
        oColor = vec4(0.0);
        oInfo = vec4(NO_HIT, limit, NO_HIT, 1.0);
        // the slab of air that can hold cloud, up to where the haze has swallowed everything
        float t0, t1;
        if (abs(rd.y) < 1e-5) {
            if (ro.y < slab.x || ro.y > slab.y) return;
            t0 = 0.0; t1 = NO_HIT;
        } else {
            float ta = (slab.x - ro.y) / rd.y, tb = (slab.y - ro.y) / rd.y;
            t0 = max(min(ta, tb), 0.0); t1 = max(ta, tb);
        }
        float hd = length(rd.xz);
        t1 = min(t1, min(limit, maxDist / max(hd, 1e-3)));
        if (t1 <= t0) return;

        float mu = dot(rd, sunDir);
        float ph0 = phase(mu, 1.0), ph1 = phase(mu, 0.5), ph2 = phase(mu, 0.25);
        // interleaved gradient noise: a per-pixel start offset turns step banding into fine grain
        // (interleaved gradient noise, shifted every frame: evenly spread offsets that the resolve pass
        // averages into a smooth result faster than white noise would)
        float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + frame * 5.588238, vec2(0.06711056, 0.00583715))));
        float t = t0 + stepAt(t0) * jit;
        float T = 1.0, entry = NO_HIT, tw = 0.0, aw = 0.0;
        vec3 C = vec3(0.0);
        for (int i = 0; i < MAX_STEPS; i++) {
            if (t >= t1) break;
            vec3 p = ro + rd * t;
            float dt = stepAt(t);
            vec4 wm = weatherAt(p);
            float gap = cloudGap(p, wm);
            // (whole steps only: a skip to the estimated surface would line every ray up there and undo the jitter)
            if (gap > 0.0) { t += dt * clamp(floor(gap / dt), 1.0, 5.0); continue; }
            float lod = max(0.0, log2(dt / ${(BASE_SIZE / BASE_RES).toFixed(1)}));
            pixFoot = t * pixAngle * 2.0;
            float amb;
            float den = cloudDensity(p, weatherSmooth(p), lod, max(${EDGE.toFixed(1)}, dt * 0.5), t < 5000.0, amb);
            if (den > 0.0) {
                float seg = min(dt, t1 - t);
                float a = 1.0 - exp(-den * SIGMA * seg);
                float od = lightDepth(p, lod, jit);
                // sun: single scattering plus two weaker, less attenuated, flatter octaves standing in for the
                // multiple scattering that makes the sunlit side of a thick cloud so bright
                float sun = exp(-od) * ph0 + 0.45 * exp(-od * 0.35) * ph1 + 0.18 * exp(-od * 0.12) * ph2;
                sun *= 1.0 - dk.x * 0.75 * step(p.y, dk.y); // under the rain deck the sun is mostly gone
                vec3 S = litColor * (sun * sunScale) + shadowColor * mix(0.28, 0.8, sqrt(amb));
                S += vec3(0.75, 0.8, 1.0) * (flash * (1.6 - amb));    // lightning inside the cloud
                C += T * a * S;
                tw += T * a * t; aw += T * a;
                if (entry == NO_HIT && 1.0 - T * (1.0 - a) > 0.03) entry = t;
                T *= 1.0 - a;
                if (T < 0.015) break;
            }
            t += dt;
        }
        float alpha = 1.0 - T;
        if (aw <= 0.0) return;
        // aerial perspective at the cloud's mean depth, and a fade before the march gives up
        vec3 ray = rd * (tw / aw);
        vec2 fg = skyFogAmount(ray, camPos.y);
        C = mix(C, skyFogColor(fogColor, ray, fg.y) * alpha, fg.x);
        float fade = 1.0 - smoothstep(maxDist * 0.8, maxDist, length(ray.xz));
        oColor = vec4(C, alpha) * fade;
        oInfo = vec4(entry, limit, tw / aw, 1.0);
    }`;

// Temporal resolve (low res): blend this frame's march into the history reprojected to where each cloud
// pixel was last frame (by the cloud's mean depth), clamped to this frame's neighbourhood so nothing ghosts.
const RESOLVE_FRAG = /* glsl */`
    uniform sampler2D tCur, tInfo, tHist;
    uniform mat4 projInv, camWorld, prevViewProj;
    uniform vec3 camPos;
    uniform vec2 lowRes;
    uniform float blend;
    void main() {
        ivec2 ip = ivec2(gl_FragCoord.xy), mx = ivec2(lowRes) - 1;
        vec4 c = texelFetch(tCur, ip, 0);
        vec4 lo = c, hi = c, sum = vec4(0.0);
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec4 v = texelFetch(tCur, clamp(ip + ivec2(x, y), ivec2(0), mx), 0);
            lo = min(lo, v); hi = max(hi, v);
            sum += v * ((x == 0 ? 2.0 : 1.0) * (y == 0 ? 2.0 : 1.0));
        }
        // a light tent filter on this frame's grain before it goes into the history
        c = mix(c, sum / 16.0, 0.6);
        vec2 uv = gl_FragCoord.xy / lowRes;
        vec4 vp = projInv * vec4(uv * 2.0 - 1.0, 0.5, 1.0);
        vec3 rd = normalize(mat3(camWorld) * (vp.xyz / vp.w));
        float d = texelFetch(tInfo, ip, 0).z;
        vec4 pc = prevViewProj * vec4(camPos + rd * min(d, 20000.0), 1.0);
        vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
        if (blend >= 1.0 || pc.w <= 0.0 || puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) { gl_FragColor = c; return; }
        vec4 h = clamp(texture2D(tHist, puv), lo, hi);
        gl_FragColor = mix(h, c, blend);
    }`;

const COMPOSITE_VERT = /* glsl */`
    uniform mat4 projInv;
    varying vec3 vRay;
    void main() {
        vec4 p = projInv * vec4(position.xy, 0.5, 1.0);
        vRay = p.xyz / p.w;
        vRay /= -vRay.z;
        gl_Position = vec4(position.xy, 0.0, 1.0);
    }`;

const COMPOSITE_FRAG = /* glsl */`
    uniform sampler2D tCloud, tInfo;
    uniform vec2 lowRes, fullRes;
    uniform float camNear;
    uniform mat4 projMat;
    varying vec3 vRay;
    void main() {
        vec2 uv = gl_FragCoord.xy / fullRes;
        vec4 col = texture2D(tCloud, uv);
        if (col.a < 0.002) discard; // no cloud in any of the four texels around this pixel
        vec2 st = uv * lowRes - 0.5;
        ivec2 i0 = ivec2(floor(st)), mx = ivec2(lowRes) - 1;
        vec2 f = st - floor(st);
        ivec2 a = clamp(i0, ivec2(0), mx), b = clamp(i0 + ivec2(1, 0), ivec2(0), mx);
        ivec2 c = clamp(i0 + ivec2(0, 1), ivec2(0), mx), d = clamp(i0 + ivec2(1, 1), ivec2(0), mx);
        vec2 ia = texelFetch(tInfo, a, 0).xy, ib = texelFetch(tInfo, b, 0).xy, ic = texelFetch(tInfo, c, 0).xy, id = texelFetch(tInfo, d, 0).xy;
        vec4 lim = vec4(ia.y, ib.y, ic.y, id.y), ent = vec4(ia.x, ib.x, ic.x, id.x);
        // a low-res texel whose ray hit something much nearer than its neighbours' (a jet, a ridge) doesn't
        // speak for the pixels around it: take the others' cloud and let the depth test cut it at the edge
        float lmax = max(max(lim.x, lim.y), max(lim.z, lim.w));
        vec4 keep = step(lmax * 0.6, lim);
        if (keep.x + keep.y + keep.z + keep.w < 3.5) {
            vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y) * keep;
            w /= max(dot(w, vec4(1.0)), 1e-5);
            col = texelFetch(tCloud, a, 0) * w.x + texelFetch(tCloud, b, 0) * w.y + texelFetch(tCloud, c, 0) * w.z + texelFetch(tCloud, d, 0) * w.w;
            ent = mix(vec4(${NO_HIT.toFixed(1)}), ent, keep);
        }
        if (col.a < 0.002) discard;
        float entry = min(min(ent.x, ent.y), min(ent.z, ent.w));
        // depth of the cloud's leading edge
        float vz = max(entry / length(vRay), camNear * 1.001);
        vec4 clip = projMat * vec4(vRay * vz, 1.0);
        #ifdef USE_REVERSED_DEPTH_BUFFER
        gl_FragDepth = clamp(clip.z / clip.w, 0.0, 1.0);
        #else
        gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
        #endif
        gl_FragColor = col; // premultiplied
    }`;

function fullScreenTriangle() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    return g;
}

// ── Cloud shadows on the ground (and on anything else lit by the sun) ──
// Every built-in lit material gets its sun light (directional light 0) dimmed where the weather map puts a
// cloud between it and the sun: the point is projected along the sun direction to the middle of the cumulus
// layer (and to the rain deck) and the cover there read from the same map. The parameters are typed arrays
// shared by every material's uniforms (UniformsUtils.clone keeps them by reference), switched on only while
// the world scene renders (the cockpit scene has its own coordinates).
const SHADOW = {
    a: new Float32Array([0, 1, 0, 0]),       // sun direction (world), on
    b: new Float32Array([0.6, 1500, 2000, 0.8]), // cumulus threshold, mid-layer altitude, layer top, strength
    c: new Float32Array([0, 0, 0, DECK_Y]),   // wind drift x, z, deck amount, deck base
};
const SHADOW_GLSL = /* glsl */`
uniform sampler2D cloudShadowMap;
uniform vec4 cloudShadowA, cloudShadowB, cloudShadowC;
float cloudSunShadow( vec3 viewPos ) {
    if ( cloudShadowA.w < 0.5 ) return 1.0;
    vec3 wp = cameraPosition + ( vec4( viewPos, 0.0 ) * viewMatrix ).xyz;
    vec3 L = cloudShadowA.xyz;
    float sy = max( L.y, 0.08 );
    vec2 q = wp.xz + L.xz * ( max( cloudShadowB.y - wp.y, 0.0 ) / sy ) - cloudShadowC.xy;
    float sh = smoothstep( cloudShadowB.x, cloudShadowB.x + 0.12, texture2D( cloudShadowMap, q / ${WEATHER_SIZE.toFixed(1)} ).r )
        * cloudShadowB.w * ( 1.0 - smoothstep( cloudShadowB.y, cloudShadowB.z, wp.y ) );
    if ( cloudShadowC.z > 0.0 && wp.y < cloudShadowC.w ) {
        vec2 qd = wp.xz + L.xz * ( ( cloudShadowC.w + 300.0 - wp.y ) / sy ) - cloudShadowC.xy;
        sh = max( sh, smoothstep( 1.0 - cloudShadowC.z, 1.35 - cloudShadowC.z, texture2D( cloudShadowMap, qd / ${WEATHER_SIZE.toFixed(1)} ).b ) * 0.85 );
    }
    return 1.0 - sh;
}`;
function installCloudShadows(map) {
    const C = THREE.ShaderChunk, anchor = 'getDirectionalLightInfo( directionalLight, directLight );';
    if (!C.lights_fragment_begin.includes('cloudSunShadow')) {
        if (!C.lights_fragment_begin.includes(anchor)) return false; // three.js changed: no cloud shadows
        C.lights_fragment_begin = C.lights_fragment_begin.replace(anchor, anchor + `
		#if ( UNROLLED_LOOP_INDEX == 0 )
		directLight.color *= cloudSunShadow( geometryPosition );
		#endif`);
        C.lights_pars_begin += SHADOW_GLSL;
    }
    for (const k in THREE.ShaderLib) {
        const L = THREE.ShaderLib[k];
        if (!L.fragmentShader.includes('<lights_pars_begin>')) continue;
        Object.assign(L.uniforms, { cloudShadowMap: { value: map }, cloudShadowA: { value: SHADOW.a }, cloudShadowB: { value: SHADOW.b }, cloudShadowC: { value: SHADOW.c } });
    }
    return true;
}

// ═══════════════════════════════════════════════════════════════
export class Clouds {
    constructor(scene, renderer, { FOG_GLSL, SKY_FOG }) {
        this.renderer = renderer;
        this.SKY_FOG = SKY_FOG;
        this.weatherData = makeWeatherMap();
        this.baseData = makeBaseNoise();
        this.detailData = makeDetailNoise();
        // half floats on the GPU: 8-bit data would show as terraces on the smooth cloud surfaces
        const weather = new THREE.DataTexture(toHalf(this.weatherData), WEATHER_RES, WEATHER_RES, THREE.RGBAFormat, THREE.HalfFloatType);
        weather.wrapS = weather.wrapT = THREE.RepeatWrapping;
        weather.magFilter = THREE.LinearFilter;
        weather.minFilter = THREE.LinearMipmapLinearFilter; // the march reads level 0; far terrain its mips
        weather.generateMipmaps = true;
        weather.needsUpdate = true;
        const base = new THREE.Data3DTexture(toHalf(this.baseData), BASE_RES, BASE_RES, BASE_RES);
        base.format = THREE.RGFormat;
        base.type = THREE.HalfFloatType;
        const detail = new THREE.Data3DTexture(this.detailData, DETAIL_RES, DETAIL_RES, DETAIL_RES);
        detail.format = THREE.RedFormat;
        detail.unpackAlignment = 1;
        for (const t of [base, detail]) {
            t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
            t.magFilter = THREE.LinearFilter;
            t.minFilter = THREE.LinearMipmapLinearFilter;
            t.generateMipmaps = true;
            t.needsUpdate = true;
        }
        this.textures = [weather, base, detail];

        // the low-res buffer: premultiplied colour + alpha, and (cloud entry distance, scene distance)
        this.rt = new THREE.WebGLRenderTarget(4, 4, { count: 2, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
        this.rt.textures[0].minFilter = this.rt.textures[0].magFilter = THREE.LinearFilter;
        this.rt.textures[1].minFilter = this.rt.textures[1].magFilter = THREE.NearestFilter;
        for (const t of this.rt.textures) t.generateMipmaps = false;
        // temporal history (ping-pong), what the composite actually shows
        this.hist = [0, 1].map(() => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }));
        this.histIdx = 0;
        this.frame = 0;
        this.resetHistory = true;
        this.prevViewProj = new THREE.Matrix4();
        this.prevCamPos = new THREE.Vector3(1e9, 0, 0);

        this.windOff = new THREE.Vector3(); // x, z drift; y: rise of the billows
        this.fieldU = {
            tWeather: { value: weather }, tBase: { value: base }, tDetail: { value: detail },
            wind: { value: this.windOff }, cu: { value: new THREE.Vector4() }, dk: { value: new THREE.Vector4() }, slab: { value: new THREE.Vector2() },
        };
        const tri = fullScreenTriangle();
        this.marchMat = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
            defines: {},
            uniforms: {
                ...this.fieldU,
                tDepth: { value: null }, hasDepth: { value: 0 }, camNear: { value: 1 }, camFar: { value: 1000 }, maxDist: { value: 18000 }, sunScale: { value: 0.8 }, frame: { value: 0 }, pixAngle: { value: 0.0025 }, flash: { value: 0 },
                projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, lowRes: { value: new THREE.Vector2(4, 4) },
                camPos: { value: new THREE.Vector3() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
                litColor: { value: new THREE.Color(1, 1, 1) }, shadowColor: { value: new THREE.Color(0.5, 0.55, 0.6) }, fogColor: { value: new THREE.Color() },
                skyFogA: { value: SKY_FOG.a }, skyFogB: { value: SKY_FOG.b }, skyFogC: { value: SKY_FOG.c }, skyFogD: { value: SKY_FOG.d },
            },
            vertexShader: TRI_VERT,
            fragmentShader: marchFrag(FOG_GLSL),
        });
        const quad = new THREE.Mesh(tri, this.marchMat);
        quad.frustumCulled = false;
        this.marchScene = new THREE.Scene();
        this.marchScene.add(quad);
        this.marchCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.resolveMat = new THREE.ShaderMaterial({
            depthTest: false, depthWrite: false, blending: THREE.NoBlending,
            uniforms: {
                tCur: { value: this.rt.textures[0] }, tInfo: { value: this.rt.textures[1] }, tHist: { value: null },
                projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, prevViewProj: { value: this.prevViewProj },
                camPos: { value: new THREE.Vector3() }, lowRes: { value: new THREE.Vector2(4, 4) }, blend: { value: 1 },
            },
            vertexShader: TRI_VERT,
            fragmentShader: RESOLVE_FRAG,
        });
        const rq = new THREE.Mesh(tri, this.resolveMat);
        rq.frustumCulled = false;
        this.resolveScene = new THREE.Scene();
        this.resolveScene.add(rq);

        this.compMat = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, depthTest: true, fog: false,
            blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
            blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
            blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
            uniforms: {
                tCloud: { value: this.hist[0].texture }, tInfo: { value: this.rt.textures[1] },
                lowRes: { value: new THREE.Vector2(4, 4) }, fullRes: { value: new THREE.Vector2(4, 4) },
                camNear: { value: 1 }, projInv: { value: new THREE.Matrix4() }, projMat: { value: new THREE.Matrix4() },
            },
            vertexShader: COMPOSITE_VERT,
            fragmentShader: COMPOSITE_FRAG,
        });
        this.mesh = new THREE.Mesh(tri, this.compMat);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 5;
        this.mesh.raycast = () => {};
        this.mesh.onBeforeRender = (r, s, cam) => this.march(r, cam);
        scene.add(this.mesh);

        // cloud shadows: on while the world scene renders
        this.shadows = installCloudShadows(weather);
        const before = scene.onBeforeRender, after = scene.onAfterRender;
        scene.onBeforeRender = (...a) => { SHADOW.a[3] = this.shadows && this.mesh.visible ? 1 : 0; before.apply(scene, a); };
        scene.onAfterRender = (...a) => { SHADOW.a[3] = 0; after.apply(scene, a); };

        this.setWeather('clear', 0);
        this.setQuality('high');
        this.compile();
    }

    // compile the offscreen passes now rather than on the first frame that shows a cloud
    compile() {
        try { this.renderer.compile(this.marchScene, this.marchCam); this.renderer.compile(this.resolveScene, this.marchCam); } catch (e) { /* no GL (tests) */ }
    }

    get visible() { return this.mesh.visible; }
    set visible(v) { this.mesh.visible = v; }
    // lightning (0..1): a flash lights the clouds from inside; the history would smear it, so it resets
    get flash() { return this.marchMat.uniforms.flash.value; }
    set flash(f) {
        const u = this.marchMat.uniforms.flash;
        if (f !== u.value) { if (f > u.value) this.resetHistory = true; u.value = f; }
    }

    setQuality(q) {
        const Q = QUALITY[q] || QUALITY.high;
        this.q = Q;
        const ratio = Q.light >= 5 ? 2 : Q.light === 4 ? 2.3 : 3;
        const step0 = 680 * (ratio - 1) / (Math.pow(ratio, Q.light) - 1); // the light march reaches ~680 m
        const d = { MAX_STEPS: Q.steps, LIGHT_STEPS: Q.light, LIGHT_STEP0: step0.toFixed(2), LIGHT_RATIO: ratio.toFixed(2), DETAIL: Q.detail };
        const m = this.marchMat;
        if (JSON.stringify(m.defines) !== JSON.stringify(d)) { m.defines = d; m.needsUpdate = true; if (this.resolveScene) this.compile(); }
    }

    // weather: 'clear' | 'cloudy' | 'rain' | 'storm'
    setWeather(key, overcast) {
        const W = this.weather = WEATHER[key] || WEATHER.clear;
        const f = this.fieldU;
        f.cu.value.set(W.thr, W.base, W.thick, W.baseVar);
        f.dk.value.set(W.deck, DECK_Y, DECK_THICK, 0);
        let lo = W.base - W.baseVar * 0.5 - 60, hi = W.base + W.baseVar * 0.5 + W.thick + 60;
        if (W.deck > 0) { lo = Math.min(lo, DECK_Y - 160); hi = Math.max(hi, DECK_Y + DECK_THICK + 60); }
        f.slab.value.set(lo, hi);
        SHADOW.b[0] = W.thr; SHADOW.b[1] = W.base + W.thick * 0.3; SHADOW.b[2] = W.base + W.thick; SHADOW.c[2] = W.deck;
        this.overcast = overcast || 0;
        this.resetHistory = true;
    }

    // palette from World.setTime (colours are linear)
    setPalette({ lit, shadow, sunDir, overcast = 0 }) {
        const u = this.marchMat.uniforms;
        u.litColor.value.copy(lit).multiplyScalar(1 - overcast * 0.4);
        u.shadowColor.value.copy(shadow);
        // the HUD's white-out should be as bright as the cloud around you (dim at dusk, faint at night)
        this.whiteBright = Math.min(1, 0.3 * shadow.r + 0.59 * shadow.g + 0.11 * shadow.b + 0.6 * (0.3 * lit.r + 0.59 * lit.g + 0.11 * lit.b));
        u.sunDir.value.copy(sunDir).normalize();
        SHADOW.a[0] = u.sunDir.value.x; SHADOW.a[1] = u.sunDir.value.y; SHADOW.a[2] = u.sunDir.value.z;
        this.resetHistory = true;
    }

    update(dt, camera, wind, fogColor) {
        this.windOff.x += wind.x * dt * 0.6;
        this.windOff.z += wind.z * dt * 0.6;
        this.windOff.y += dt * 1.2;
        SHADOW.c[0] = this.windOff.x; SHADOW.c[1] = this.windOff.z;
        const u = this.marchMat.uniforms;
        u.fogColor.value.copy(fogColor);
        u.maxDist.value = this.SKY_FOG.a[3];
    }

    // Runs just before the composite triangle draws, with the opaque scene already in the target
    march(renderer, camera) {
        if (!camera.isPerspectiveCamera) return;
        const target = renderer.getRenderTarget();
        let w, h;
        if (target) { w = target.width; h = target.height; } else { const v = renderer.getDrawingBufferSize(_size); w = v.x; h = v.y; }
        const s = this.q.scale / renderer.getPixelRatio();
        const lw = Math.max(1, Math.round(w * s)), lh = Math.max(1, Math.round(h * s));
        if (this.rt.width !== lw || this.rt.height !== lh) {
            this.rt.setSize(lw, lh);
            for (const h of this.hist) h.setSize(lw, lh);
            this.resetHistory = true;
        }
        const depth = target && target.depthTexture && !(target.samples > 0) ? target.depthTexture : null;
        const u = this.marchMat.uniforms;
        u.tDepth.value = depth; u.hasDepth.value = depth ? 1 : 0;
        u.projInv.value.copy(camera.projectionMatrixInverse);
        u.camWorld.value.copy(camera.matrixWorld);
        u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
        u.camNear.value = camera.near; u.camFar.value = camera.far;
        u.lowRes.value.set(lw, lh);
        u.pixAngle.value = 2 / (camera.projectionMatrix.elements[5] * lh); // radians per low-res pixel
        const c = this.compMat.uniforms;
        c.lowRes.value.set(lw, lh); c.fullRes.value.set(w, h);
        c.camNear.value = camera.near;
        c.projInv.value.copy(camera.projectionMatrixInverse);
        c.projMat.value.copy(camera.projectionMatrix);
        u.frame.value = this.frame = (this.frame + 1) % 64;
        // history: reset after a jump (a respawn, a camera cut) or a change of weather / time of day
        const R = this.resolveMat.uniforms;
        if (u.camPos.value.distanceToSquared(this.prevCamPos) > 400 * 400) this.resetHistory = true;
        R.blend.value = this.resetHistory ? 1 : u.flash.value > 0.01 ? 0.5 : 0.12;
        this.resetHistory = false;
        R.projInv.value.copy(camera.projectionMatrixInverse);
        R.camWorld.value.copy(camera.matrixWorld);
        R.camPos.value.copy(u.camPos.value);
        R.lowRes.value.set(lw, lh);
        R.tHist.value = this.hist[this.histIdx].texture;
        this.histIdx ^= 1;
        const out = this.hist[this.histIdx];
        c.tCloud.value = out.texture;
        const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
        renderer.setRenderTarget(this.rt);
        renderer.render(this.marchScene, this.marchCam);
        renderer.setRenderTarget(out);
        renderer.render(this.resolveScene, this.marchCam);
        renderer.setRenderTarget(target, face, mip);
        this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        this.prevCamPos.copy(u.camPos.value);
    }

    // ── CPU copy of the field (no detail noise), for the whiteout ──
    weatherAt(x, z, out) {
        const N = WEATHER_RES, D = this.weatherData;
        const u = ((x - this.windOff.x) / WEATHER_SIZE) * N - 0.5, v = ((z - this.windOff.z) / WEATHER_SIZE) * N - 0.5;
        const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
        const i0 = ((i % N) + N) % N, j0 = ((j % N) + N) % N, i1 = (i0 + 1) % N, j1 = (j0 + 1) % N;
        for (let c = 0; c < 4; c++) {
            const a = D[(j0 * N + i0) * 4 + c], b = D[(j0 * N + i1) * 4 + c], d = D[(j1 * N + i0) * 4 + c], e = D[(j1 * N + i1) * 4 + c];
            out[c] = (a + (b - a) * fu) * (1 - fv) + (d + (e - d) * fu) * fv;
        }
        return out;
    }
    baseAt(x, y, z, out) {
        const N = BASE_RES, D = this.baseData;
        const u = ((x - this.windOff.x) / BASE_SIZE) * N - 0.5, v = ((y - this.windOff.y) / BASE_SIZE) * N - 0.5, w = ((z - this.windOff.z) / BASE_SIZE) * N - 0.5;
        const i = Math.floor(u), j = Math.floor(v), k = Math.floor(w), fu = u - i, fv = v - j, fw = w - k;
        let r = 0, g = 0;
        for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const wt = (dx ? fu : 1 - fu) * (dy ? fv : 1 - fv) * (dz ? fw : 1 - fw);
            const o = (((((k + dz) % N + N) % N) * N + (((j + dy) % N + N) % N)) * N + (((i + dx) % N + N) % N)) * 2;
            r += D[o] * wt; g += D[o + 1] * wt;
        }
        out[0] = r; out[1] = g;
        return r;
    }
    // 0..1: how much the HUD should white out with the camera at p. The volume already fogs the view from
    // inside a cloud, so this only adds the last bit of milkiness (and less of it when the cloud is dark).
    whiteoutAt(p) {
        return this.densityAt(p) * 0.7 * (this.whiteBright ?? 1);
    }

    // 0..1: cloud density at a world point (the same field the shader marches, minus the finest detail)
    densityAt(p) {
        if (!this.mesh.visible) return 0;
        const f = this.fieldU, cu = f.cu.value, dk = f.dk.value;
        if (p.y < f.slab.value.x || p.y > f.slab.value.y) return 0;
        const wm = this.weatherAt(p.x, p.z, _wm);
        const cov = sat((wm[0] - cu.x) / (1 - cu.x));
        const h = p.y - (cu.y + (wm[3] - 0.5) * cu.w), y = h / (cu.z * wm[1]);
        const cq = sat(cov / 0.6), cp = cq * cq * (3 - 2 * cq), hc = sat(y / Math.max(Math.sqrt(cp), 0.05));
        let s = Math.min(cp - y * y, h * 0.004);
        const c = dk.x > 0 ? sat((wm[2] - (1 - dk.x)) / 0.35) : 0, cover = c * c * (3 - 2 * c);
        const hdk = p.y - dk.y;
        let sd = cover > 0 ? Math.min(hdk + 90, dk.z * cover - hdk) * 0.002 : -1;
        if (Math.max(s, sd) <= 0) return 0;
        const billow = this.baseAt(p.x, p.y, p.z, _n);
        const k = sat(hc / 0.5), kc = sat(cov / 0.3);
        s -= (1 - billow) * ((0.1 + 0.4 * k * k * (3 - 2 * k)) * (0.65 + 0.7 * _n[1]) + 0.12 * (1 - kc * kc * (3 - 2 * kc)));
        sd -= (1 - billow) * 0.38;
        return sat(Math.max(s, sd) / (EDGE * EDGE_SCALE));
    }

    dispose() {
        this.mesh.removeFromParent();
        this.rt.dispose();
        for (const h of this.hist) h.dispose();
        this.marchMat.dispose(); this.compMat.dispose(); this.resolveMat.dispose();
        this.mesh.geometry.dispose();
        for (const t of this.textures) t.dispose();
    }
}
const _size = new THREE.Vector2();
function toHalf(f) {
    const out = new Uint16Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = THREE.DataUtils.toHalfFloat(f[i]);
    return out;
}
const _wm = [0, 0, 0, 0], _n = [0, 0];

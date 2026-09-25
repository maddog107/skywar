// Pure math helpers and deterministic noise, with no imports: shared by util.js (re-exported there) and by
// the terrain worker (terraincore.js / terrainworker.js), which can't load three.js.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

// ── Seeded PRNG so the world is the same every session ──
export function mulberry32(seed) {
    return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ── 2D simplex-ish gradient noise (Perlin) ──
const perm = new Uint8Array(512);
(function initNoise() {
    const r = mulberry32(1337);
    const p = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function grad(hash, x, y) {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v) * 0.5;
}
export function noise2d(x, y) {
    const fx = Math.floor(x), fy = Math.floor(y);
    const X = fx & 255, Y = fy & 255;
    const xf = x - fx, yf = y - fy;
    const u = fade(xf), v = fade(yf);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const x1 = lerp(grad(perm[a], xf, yf), grad(perm[b], xf - 1, yf), u);
    const x2 = lerp(grad(perm[a + 1], xf, yf - 1), grad(perm[b + 1], xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
}
export function fbm(x, y, octaves) {
    let val = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
        val += noise2d(x * freq, y * freq) * amp;
        max += amp;
        amp *= 0.5;
        freq *= 2.03;
    }
    return val / max;
}
export function ridged(x, y, octaves) {
    let val = 0, amp = 1, freq = 1, max = 0, w = 1;
    for (let i = 0; i < octaves; i++) {
        let n = 1 - Math.abs(noise2d(x * freq, y * freq));
        n *= n * w;
        w = clamp(n * 1.5, 0, 1);
        val += n * amp;
        max += amp;
        amp *= 0.5;
        freq *= 2.1;
    }
    return val / max;
}

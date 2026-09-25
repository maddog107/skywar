// Shared math helpers, deterministic noise, and scratch objects.
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const DEG = Math.PI / 180;
export const G = 9.81;
// set once the renderer exists: with a reversed depth buffer, polygonOffset units must flip sign
export const DEPTH = { reversed: false };
export const offsetUnits = (u) => (DEPTH.reversed ? -u : u);
export const MS_TO_KTS = 1.94384;
export const M_TO_FT = 3.28084;

export const AXIS_X = new THREE.Vector3(1, 0, 0);
export const AXIS_Y = new THREE.Vector3(0, 1, 0);
export const AXIS_Z = new THREE.Vector3(0, 0, 1);
export const FORWARD = new THREE.Vector3(0, 0, -1);

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

// Reusable temporaries. Only use within a single function without calling out.
export const tmp = {
    v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(),
    v4: new THREE.Vector3(), v5: new THREE.Vector3(), v6: new THREE.Vector3(),
    q1: new THREE.Quaternion(), q2: new THREE.Quaternion(),
    m1: new THREE.Matrix4(), c1: new THREE.Color()
};

// Distance from point p to segment ab, squared
export function segPointDistSq(a, b, p) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
    const len = abx * abx + aby * aby + abz * abz;
    let t = len > 0 ? (apx * abx + apy * aby + apz * abz) / len : 0;
    t = clamp(t, 0, 1);
    const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - p.z;
    return dx * dx + dy * dy + dz * dz;
}

// Solve intercept time for a projectile of speed s fired from origin (relative pos p, relative vel v)
export function interceptTime(px, py, pz, vx, vy, vz, s) {
    const a = vx * vx + vy * vy + vz * vz - s * s;
    const b = 2 * (px * vx + py * vy + pz * vz);
    const c = px * px + py * py + pz * pz;
    if (Math.abs(a) < 1e-6) return c > 0 && b < 0 ? -c / b : -1;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
    const t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
    return t > 0 ? t : -1;
}

export function formatTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
}

// Soft radial sprite texture (used for particles, clouds, glows)
export function makeRadialTexture(size = 128, stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [o, col] of stops) g.addColorStop(o, col);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

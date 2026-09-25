// Shared math helpers, deterministic noise, and scratch objects.
import * as THREE from 'three';

// pure math and noise live in noise.js (no imports, so the terrain worker can load them too)
import { clamp, lerp } from './noise.js';
export { clamp, lerp, smoothstep, mulberry32, noise2d, fbm, ridged } from './noise.js';
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

// A model that moves as a whole (a ship, a helicopter, an airliner): its parts keep their place on it, so compose
// their local matrices once and stop three.js recomposing them every frame (their world matrices still follow the
// root). `moving`: parts that turn or move on their own (radars, turrets, rotors) keep updating; what's under them
// is fixed to them.
export function freezeLocal(root, moving = []) {
    const own = new Set(moving);
    root.traverse(o => {
        if (o === root || own.has(o)) return;
        o.updateMatrix();
        o.matrixAutoUpdate = false;
    });
}

// Static scenery: work out world matrices once, then stop three.js recomposing them every frame.
// `animated`: objects that move (they keep updating, and everything under them follows).
export function freezeStatic(root, animated = []) {
    root.updateMatrixWorld(true);
    const moving = new Set();
    for (const a of animated) a.traverse(o => moving.add(o));
    root.traverse(o => {
        o.matrixWorldAutoUpdate = moving.has(o);
        o.matrixAutoUpdate = animated.includes(o);
    });
}

// ═══════════════════════════════════════════════════════════════
// Towns: villages, towns and cities laid out on street grids.
//   • each town is graded: the ground inside it is a smoothed version of the
//     hillside (TownSurface), and streets, pavements, buildings and the drawn
//     terrain all sit on that surface
//   • streets with pavements and markings; junctions are proper tarmac boxes
//     with kerb radii, traffic lights (cities) or stop signs, stop lines and
//     zebra crossings; street lamps
//   • buildings set back along the streets on their lots: houses with pitched
//     roofs, townhouses, apartment blocks, downtown towers, a church, parks
//   • windows are drawn by a shader (lit at random at night)
//   • dirt trails out into the countryside with dune buggies
// Towns are joined by the intercity road network (roads.js): roads leave from
// the end of a street, so they never run across a street grid.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight, BASES, gateOf, baseToWorld } from './world.js';
import { fbm, mulberry32, makeRadialTexture, offsetUnits, freezeStatic } from './util.js';
import { buildRoads, roadMaterial, streetMaterial, junctionMaterial, sidewalkMaterial, markMaterial, outsideBases, samplePath, liftWithDistance, RoadGround,
    junctionShape, SurfaceBuilder, pointAt, tangentAt, smooth01, STREET_HALF, SIDEWALK, ROAD_HALF } from './roads.js';
import { mergeGeometries as mergeGeos } from 'three/addons/utils/BufferGeometryUtils.js';
import { Traffic } from './traffic.js';
import { setBridgeNight, BridgeBatch } from './bridges.js';
import { Buildings } from './buildings.js';
import { townGradeAt } from './terraincore.js';
import { CarSet, PAINTS, NearInstances } from './carset.js';

const EXTENT = 24000, CELL = 3200;
const TOWN_CELL = 16000, FAR_CELL = 8000; // towns drawn together (see perTown)
const BLOCK_CELL = 2;
const STREET_Y = 0.3;             // street surface above the graded ground
const WALK = STREET_HALF + SIDEWALK; // half-width of a street with its pavements
const KERB_R = 5;                 // kerb radius at street corners

function slopeAt(x, z) {
    const e = 12, h = terrainHeight(x, z);
    return (Math.abs(terrainHeight(x + e, z) - h) + Math.abs(terrainHeight(x, z + e) - h)) / (2 * e);
}

// ── A town's graded ground: the hillside smoothed over ~40 m inside the town, blending back to the natural
// terrain at its edge. Streets, buildings and the drawn terrain all use it, so a town on a slope reads as terraced
// streets on a smooth hill instead of every bump poking through. (Physics keeps the true terrain height.)
class TownSurface {
    constructor(t, defs) {
        this.t = t;
        const C = this.C = 12;
        const ext = Math.max(t.radius, ...defs.map(sd => sd.half)) + 70;
        const n = this.n = Math.ceil(ext / C), N = this.N = 2 * n + 1;
        this.ext2 = (ext - C) * (ext - C);
        let H = new Float32Array(N * N), M = new Float32Array(N * N);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const u = (i - n) * C, v = (j - n) * C;
            const x = t.x + t.bx.x * u + t.ax.x * v, z = t.z + t.bx.z * u + t.ax.z * v;
            H[j * N + i] = terrainHeight(x, z);
            let m = Math.hypot(u, v) < t.radius + 12 ? 1 : 0;
            for (const sd of defs) {
                const [a, b] = sd.axis === 'a' ? [u, v] : [v, u];
                if (Math.abs(a - sd.off) < 24 && Math.abs(b) < sd.half + 14) m = 1;
            }
            M[j * N + i] = m;
        }
        const blur = (A) => {
            const B = new Float32Array(N * N);
            for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
                let s = 0, c = 0;
                for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                    const ii = i + di, jj = j + dj;
                    if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
                    s += A[jj * N + ii]; c++;
                }
                B[j * N + i] = s / c;
            }
            return B;
        };
        for (let k = 0; k < 4; k++) H = blur(H);
        for (let k = 0; k < 3; k++) M = blur(M);
        // the graded ground never drops into the water
        for (let k = 0; k < N * N; k++) H[k] = Math.max(H[k], 1.2);
        this.H = H; this.M = M;
    }

    // plain data for terraincore.js townGradeAt (also what the terrain worker gets)
    pack() {
        const t = this.t;
        return { x: t.x, z: t.z, bxx: t.bx.x, bxz: t.bx.z, axx: t.ax.x, axz: t.ax.z, C: this.C, n: this.n, N: this.N, ext2: this.ext2, H: this.H, M: this.M };
    }
}

// A sparse bitmap of cells (64 x 64 cells per chunk): what's taken by roads, streets and buildings
class BitGrid {
    constructor() { this.chunks = new Map(); this.lk = null; this.lc = null; }
    chunk(cx, cz, make) {
        const k = ((cx >> 6) + 8192) * 16384 + (cz >> 6) + 8192;
        if (k === this.lk) return this.lc;
        let c = this.chunks.get(k);
        if (!c && make) this.chunks.set(k, c = new Uint32Array(128));
        if (c) { this.lk = k; this.lc = c; }
        return c;
    }
    set(cx, cz) { const c = this.chunk(cx, cz, true), b = ((cz & 63) << 6) | (cx & 63); c[b >> 5] |= 1 << (b & 31); }
    clone() { const g = new BitGrid(); for (const [k, c] of this.chunks) g.chunks.set(k, c.slice()); return g; }
    has(cx, cz) { const c = this.chunk(cx, cz, false); if (!c) return false; const b = ((cz & 63) << 6) | (cx & 63); return (c[b >> 5] & (1 << (b & 31))) !== 0; }
}

const _v = new THREE.Vector3(), _t2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
// where segments a0-a1 and b0-b1 cross (t, u: fractions along each), or null
function segCross(a0, a1, b0, b1) {
    const r0 = a1.x - a0.x, r1 = a1.z - a0.z, s0 = b1.x - b0.x, s1 = b1.z - b0.z;
    const den = r0 * s1 - r1 * s0;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((b0.x - a0.x) * s1 - (b0.z - a0.z) * s0) / den, u = ((b0.x - a0.x) * r1 - (b0.z - a0.z) * r0) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u, x: a0.x + r0 * t, z: a0.z + r1 * t } : null;
}
// convex hull of [[x, z]…] (monotone chain)
function convexHull(pts) {
    const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    return lo.slice(0, -1).concat(hi.slice(0, -1));
}
// nearest point of a path to (x, z): { s, d }
function closestOnPath(p, x, z) {
    let best = { s: 0, d: Infinity };
    const P = p.pts;
    for (let k = 0; k + 1 < P.length; k++) {
        const a = P[k], b = P[k + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
        const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
        if (d < best.d) best = { s: a.s + (b.s - a.s) * t, d };
    }
    return best;
}

// ── Town building geometry: unit sized, base at y = 0, outward-facing (single-sided) ──
function triGeo(tris) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3));
    g.computeVertexNormals();
    return g;
}
// Gable roof: a prism with its ridge along z
function gableGeometry() {
    const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], T = [0, 1, -0.5], T2 = [0, 1, 0.5];
    return triGeo([[B, A, T], [D, C, T2], [A, D, T2], [A, T2, T], [C, B, T], [C, T, T2]]);
}
// Hip roof: a shorter ridge along z, the ends sloping too
function hipGeometry() {
    const A = [-0.5, 0, -0.5], B = [0.5, 0, -0.5], C = [0.5, 0, 0.5], D = [-0.5, 0, 0.5], R0 = [0, 1, -0.22], R1 = [0, 1, 0.22];
    return triGeo([[D, C, R1], [B, A, R0], [A, D, R1], [A, R1, R0], [C, B, R0], [C, R0, R1]]);
}
function unitBox() { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; }
const flat = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; };
// Dormer window: a little box with its own gable, window side facing +z
function dormerGeometry() {
    const box = flat(new THREE.BoxGeometry(1, 0.65, 1)); box.translate(0, 0.325, 0);
    const cap = gableGeometry(); cap.scale(1.15, 0.4, 1.1); cap.translate(0, 0.65, 0);
    return mergeGeos([box, cap]);
}
// Water tank on legs (rooftops; much bigger, on its own tall legs, a village water tower)
function tankGeometry() {
    const drum = flat(new THREE.CylinderGeometry(0.5, 0.5, 0.55, 12)); drum.translate(0, 0.725, 0);
    const lid = flat(new THREE.ConeGeometry(0.53, 0.2, 12)); lid.translate(0, 1.1, 0);
    const parts = [drum, lid];
    for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) { const l = flat(new THREE.BoxGeometry(0.06, 0.45, 0.06)); l.translate(x, 0.225, z); parts.push(l); }
    return mergeGeos(parts);
}
function spireGeometry() { const g = flat(new THREE.ConeGeometry(0.5, 1, 4)); g.rotateY(Math.PI / 4); g.translate(0, 0.5, 0); return g; }

// Facade styles (aStyle.x): the window pattern drawn by the shader
export const FACADE = { house: 0, townhouse: 1, apartment: 2, office: 3, glass: 4, church: 5, shed: 6 };

// ── Building material with shader-drawn windows (per-instance, in metres) ──
// Town buildings carry an instanced aStyle = (style, flags, accent hue, seed); flags: 1 = shop front on the ground
// floor, 2 / 4 = the street side is local +z / -z (doors and entrances go there)
export function makeFacadeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.04 });
    mat.userData.night = { value: 0 };
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.uNight = mat.userData.night;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec4 aStyle; varying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying vec4 vStyle; varying float vInst;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
                vScale = sc; vLp = position * sc; vLn = normal; vStyle = aStyle; vInst = float(gl_InstanceID);`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform float uNight; varying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying vec4 vStyle; varying float vInst;
                float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                // box-filtered repeating pulse (1 inside [a, b] of each unit period): far-away facades average out
                float pulseI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
                float pulseAA(float x, float a, float b) { float w = max(fwidth(x), 1e-4); return (pulseI(x + 0.5 * w, a, b) - pulseI(x - 0.5 * w, a, b)) / w; }
                float boxAA(float x, float a, float b) { float w = max(fwidth(x), 1e-4); return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0); }
                vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
                // glass (0..1), which window cell, and whether it's a shop / door / fascia
                float wGlass; vec2 wCell; float wShop; float wFascia; float wDoor;
                void facade() {
                    wGlass = 0.0; wCell = vec2(0.0); wShop = 0.0; wFascia = 0.0; wDoor = 0.0;
                    if (abs(vLn.y) > 0.5) return;
                    bool xFace = abs(vLn.x) > 0.5;
                    float u = xFace ? vLp.z : vLp.x, y = vLp.y;
                    float halfW = (xFace ? vScale.z : vScale.x) * 0.5;
                    float st = floor(vStyle.x + 0.5), fl = floor(vStyle.y + 0.5);
                    float shop = mod(fl, 2.0);
                    float front = (!xFace && ((mod(floor(fl / 2.0), 2.0) > 0.5 && vLn.z > 0.5) || (mod(floor(fl / 4.0), 2.0) > 0.5 && vLn.z < -0.5))) ? 1.0 : 0.0;
                    float fw = 3.2, fh = 3.0, x0 = 0.3, x1 = 0.7, y0 = 0.35, y1 = 0.78, base = 0.0;
                    if (st > 0.5 && st < 1.5) { fw = 2.8; fh = 3.3; x0 = 0.24; x1 = 0.76; y0 = 0.3; y1 = 0.82; }
                    else if (st > 1.5 && st < 2.5) { fw = 3.0; fh = 2.9; x0 = 0.18; x1 = 0.82; y0 = 0.32; y1 = 0.8; }
                    else if (st > 2.5 && st < 3.5) { fw = 3.0; fh = 3.7; x0 = 0.03; x1 = 0.97; y0 = 0.3; y1 = 0.86; }
                    else if (st > 3.5 && st < 4.5) { fw = 1.6; fh = 3.8; x0 = 0.06; x1 = 0.94; y0 = 0.1; y1 = 0.95; }
                    else if (st > 4.5 && st < 5.5) { fw = 4.5; fh = 20.0; x0 = 0.4; x1 = 0.6; y0 = 0.12; y1 = 0.62; }
                    else if (st > 5.5) { fw = 7.0; fh = 4.5; x0 = 0.1; x1 = 0.9; y0 = 0.6; y1 = 0.85; }
                    // a shop front fills the ground floor (4.2 m): big windows, a coloured fascia over them
                    if (shop > 0.5 && y < 4.2) {
                        float sw = 4.0;
                        wShop = pulseAA(u / sw + 0.5, 0.06, 0.94) * boxAA(y, 0.25, 3.2) * step(abs(u), halfW - 0.5);
                        wFascia = boxAA(y, 3.35, 4.05) * step(abs(u), halfW - 0.2);
                        wCell = vec2(floor(u / sw) + (vLn.x + vLn.z) * 57.0, -1.0);
                        wGlass = wShop;
                        return;
                    }
                    if (shop > 0.5) base = 4.2 - fh; // the floors above start over the shop
                    float yy = y - base;
                    wCell = vec2(floor(u / fw) + (vLn.x + vLn.z) * 57.0, floor(yy / fh));
                    float inX = pulseAA(u / fw + 0.5, x0, x1);
                    float inY = pulseAA(yy / fh, y0, y1);
                    float edge = step(0.9, y) * step(y, vScale.y - 0.7) * step(abs(u), halfW - 0.6);
                    if (st < 4.5 && shop < 0.5) edge *= step(0.6, yy); // no windows in the plinth
                    wGlass = inX * inY * edge;
                    // the front door (houses) or a glazed entrance (blocks, towers)
                    if (front > 0.5 && shop < 0.5 && st < 4.5) {
                        float dw = st < 0.5 ? 0.55 : 1.4, dh = st < 0.5 ? 2.1 : 2.9;
                        float d = boxAA(u, -dw, dw) * boxAA(y, 0.05, dh);
                        wDoor = d;
                        wGlass = max(wGlass * (1.0 - boxAA(y, 0.0, dh + 0.4) * boxAA(u, -dw - 0.8, dw + 0.8)), st < 0.5 ? 0.0 : d);
                    }
                }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                facade();
                float hw = hash12(wCell + vInst * 1.37 + vStyle.w * 13.1);
                float st2 = floor(vStyle.x + 0.5);
                // lit at night: about a quarter of homes, more of the offices, most shops
                float litP = wShop > 0.0 ? 0.75 : st2 > 2.5 && st2 < 4.5 ? 0.38 : 0.26;
                float lit = step(1.0 - litP, hw);
                vec3 glass = st2 > 3.5 && st2 < 4.5 ? mix(vec3(0.16, 0.24, 0.32), vec3(0.3, 0.42, 0.5), vLp.y / max(vScale.y, 1.0)) : vec3(0.1, 0.12, 0.15);
                if (wShop > 0.0) glass = vec3(0.14, 0.17, 0.2);
                vec3 wallC = diffuseColor.rgb;
                // a darker plinth, a cornice line at the top
                if (abs(vLn.y) < 0.5) wallC *= mix(1.0, 0.78, step(vLp.y, 0.6)) * mix(1.0, 0.85, step(vScale.y - 0.5, vLp.y));
                vec3 accent = mix(hue(vStyle.z), vec3(0.95), 0.12);
                diffuseColor.rgb = mix(wallC, accent, wFascia);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.2, 0.14), wDoor * step(st2, 0.5));
                diffuseColor.rgb = mix(diffuseColor.rgb, glass, wGlass);`)
            .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
                roughnessFactor = mix(roughnessFactor, 0.18, wGlass);`)
            .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
                metalnessFactor = mix(metalnessFactor, 0.35, wGlass);`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                // just under the bloom threshold: lit windows read as bright, not as a glowing haze
                vec3 warm = mix(vec3(1.0, 0.72, 0.4), vec3(0.75, 0.85, 1.0), step(0.93, hw));
                totalEmissiveRadiance += wGlass * lit * uNight * warm * (wShop > 0.0 ? 1.0 : 0.8);
                totalEmissiveRadiance += wFascia * uNight * accent * 0.45;`);
    };
    mat.customProgramCacheKey = () => 'facade1';
    return mat;
}

// ── Building material with shader-drawn windows (plain instanced boxes, no style: airbases) ──
export function makeBuildingMaterial(kind) {
    const mat = new THREE.MeshStandardMaterial({ roughness: kind === 'tower' ? 0.35 : 0.85, metalness: kind === 'tower' ? 0.35 : 0.05 });
    mat.userData.night = { value: 0 };
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.uNight = mat.userData.night;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying float vInst;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
                vScale = sc; vLp = position * sc; vLn = normal; vInst = float(gl_InstanceID);`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform float uNight; varying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying float vInst;
                float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                // box-filtered repeating pulse (1 inside [a, b] of each unit period): far-away facades average
                // out to a flat tint instead of shimmering in moire patterns
                float pulseI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
                float pulseAA(float x, float a, float b) { float w = max(fwidth(x), 1e-4); return (pulseI(x + 0.5 * w, a, b) - pulseI(x - 0.5 * w, a, b)) / w; }
                float winMask(out vec2 cell) {
                    cell = vec2(0.0);
                    if (abs(vLn.y) > 0.5) return 0.0;
                    float u = abs(vLn.x) > 0.5 ? vLp.z : vLp.x;
                    float y = vLp.y;
                    ${kind === 'tower' ? 'float fw = 2.4, fh = 3.6, wx0 = 0.08, wx1 = 0.92, wy0 = 0.18, wy1 = 0.9;' : 'float fw = 3.2, fh = 3.0, wx0 = 0.3, wx1 = 0.7, wy0 = 0.35, wy1 = 0.78;'}
                    cell = vec2(floor(u / fw) + (vLn.x + vLn.z) * 57.0, floor(y / fh));
                    float inX = pulseAA(u / fw, wx0, wx1);
                    float inY = pulseAA(y / fh, wy0, wy1);
                    float edge = step(1.0, y) * step(y, vScale.y - 0.8);
                    float halfW = (abs(vLn.x) > 0.5 ? vScale.z : vScale.x) * 0.5;
                    float side = step(abs(u), halfW - 0.9);
                    return inX * inY * edge * side;
                }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                vec2 wcell; float wm = winMask(wcell);
                float hw = hash12(wcell + vInst * 1.37);
                float lit = step(0.72, hw); // about a quarter of the windows are lit at night
                vec3 glass = ${kind === 'tower' ? 'vec3(0.18, 0.26, 0.34)' : 'vec3(0.12, 0.14, 0.17)'};
                diffuseColor.rgb = mix(diffuseColor.rgb, glass, wm);`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                // just under the bloom threshold: lit windows read as bright, not as a glowing haze
                totalEmissiveRadiance += wm * lit * uNight * mix(vec3(1.0, 0.72, 0.4), vec3(0.75, 0.85, 1.0), step(0.93, hw)) * 0.8;`);
    };
    mat.customProgramCacheKey = () => 'bld_' + kind;
    return mat;
}

function canvasTex(w, h, draw, rep = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
}

export class Towns {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.group = new THREE.Group();
        scene.add(this.group);
        this.blockGrid = new BitGrid();
        this.rand = mulberry32(2024);
        this.towns = this.placeTowns();
        this.planStreets();
        // the ground as the towns grade it, as plain data (terraincore.js townGradeAt; the terrain worker gets a copy):
        // each town's smoothed surface, the towns by 1 km cell, and levelled pads (stadiums, added as they're built)
        this.grade = { towns: [], cells: new Map(), pads: [] };
        this.pads = this.grade.pads;
        this.towns.forEach((t, ti) => {
            t.surf = new TownSurface(t, this.streetDefs.filter(sd => sd.t === t));
            this.grade.towns.push(t.surf.pack());
            const e = Math.sqrt(t.surf.ext2) + 12;
            for (let cx = Math.floor((t.x - e) / 1000); cx <= Math.floor((t.x + e) / 1000); cx++)
                for (let cz = Math.floor((t.z - e) / 1000); cz <= Math.floor((t.z + e) / 1000); cz++) {
                    const k = cx * 100003 + cz;
                    if (!this.grade.cells.has(k)) this.grade.cells.set(k, []);
                    this.grade.cells.get(k).push(ti);
                }
        });
        this.deadEnds = [];
        this.junctions = [];
        // town streets first (with their junctions), then the roads that join their ends
        const pieces = this.layoutStreets();
        this.streetJunctions(pieces);
        this.streetPaths = pieces.filter(pc => pc.d1 - pc.d0 > 18).map(pc => this.makeStreetPath(pc));
        this.streetDeadEnds();
        const nodes = this.towns.map(t => ({ x: t.x, z: t.z, ports: this.portsOf(t), town: t }));
        for (const b of BASES) {
            // arrive at an airbase through its main gate, carrying on from its access road
            const G = gateOf(b), w = baseToWorld(b, G.lx + 75, G.lz), o = baseToWorld(b, G.lx + 76, G.lz);
            nodes.push({ x: w.x, z: w.z, ports: [{ x: w.x, z: w.z, dx: o.x - w.x, dz: o.z - w.z, multi: true, gate: b, y: terrainHeight(w.x, w.z) + 0.35, g: 0, slope: 0 }] });
        }
        const { paths, bridges, deadEnds } = buildRoads(this.group, nodes, {
            heightAt: (x, z) => this.groundAt(x, z),
            avoid: this.towns.map((t, i) => ({ x: t.x, z: t.z, r: t.reach + 25, node: nodes[i] })),
        });
        this.deadEnds.push(...deadEnds);
        this.paths = paths;
        this.bridges = bridges;
        this.bridgeBatch = new BridgeBatch(this.group, bridges); // their decks and piers drawn a few meshes at a time
        for (const p of paths) { p.half = ROAD_HALF; }
        this.roadJunctions();
        this.shapeJunctions();
        const surfaces = this.buildSurfaces();
        for (const p of paths) this.markPath(p.pts, ROAD_HALF + 3);
        for (const p of this.streetPaths) this.markPath(p.pts, WALK + 0.3);
        for (const J of this.junctions) if (!J.streets) for (const [x, z] of J.poly) this.mark(x, z, 1.5); // street corners are covered by the streets' own marks
        this.streetGrid = this.blockGrid.clone(); // just the roads and streets (the blocker gets buildings too)
        this.dirtPaths = this.buildDirtTrails();
        surfaces.push(this.dirtGeo);
        this.buildSignals();
        this.buildBuildings();
        this.buildings.onBlast = (p, r) => this.panic(p, r); // a building blown up sends people running
        this.buildLamps();
        this.buildPeople();
        this.buildRoadblocks(this.deadEnds);
        this.traffic = new Traffic(this.group, [...paths, ...this.streetPaths], this.dirtPaths, this);
        for (const p of this.dirtPaths) p.half = 3.2;
        this.ground = new RoadGround([...paths, ...this.streetPaths, ...this.dirtPaths], this.grade);
        for (const g of surfaces) if (g) this.ground.protect(g);
        this.time = 0;
        // nothing in a town moves as an object (cars and people are instances) except collapsing bridges
        freezeStatic(this.group, this.bridges.map(b => b.group));
        if (world) {
            world.blockTree = (x, z) => this.blocked(x, z) || this.towns.some(t => Math.hypot(x - t.x, z - t.z) < t.radius * 0.9);
            world.refreshTrees();
            world.setGroundConform(this.ground);
        }
    }

    // ── the ground as the town grades it ──
    // natural height h at (x, z) → the graded ground (inside towns, on levelled pads), else h
    townBase(x, z, h) { return townGradeAt(this.grade, x, z, h); }
    groundAt(x, z) { return this.townBase(x, z, terrainHeight(x, z)); }

    // ── spatial blocker (roads, streets, buildings): 4 m cells ──
    mark(x, z, r) {
        const C = BLOCK_CELL;
        for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++) for (let cz = Math.floor((z - r) / C); cz <= Math.floor((z + r) / C); cz++) {
            // the cell's nearest point to (x, z) within r
            const nx = Math.max(cx * C, Math.min(x, cx * C + C)), nz = Math.max(cz * C, Math.min(z, cz * C + C));
            if ((nx - x) ** 2 + (nz - z) ** 2 <= r * r) this.blockGrid.set(cx, cz);
        }
    }
    blocked(x, z) { return this.blockGrid.has(Math.floor(x / BLOCK_CELL), Math.floor(z / BLOCK_CELL)); }
    onStreet(x, z) { return this.streetGrid.has(Math.floor(x / BLOCK_CELL), Math.floor(z / BLOCK_CELL)); }
    // every cell within r of the polyline (a capsule per segment)
    markPath(pts, r) {
        const C = BLOCK_CELL, R = r + C * 0.5, R2 = R * R, G = this.blockGrid;
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dz = b.z - a.z, iL2 = 1 / (dx * dx + dz * dz || 1);
            const x0 = Math.floor((Math.min(a.x, b.x) - r) / C), x1 = Math.floor((Math.max(a.x, b.x) + r) / C);
            const z0 = Math.floor((Math.min(a.z, b.z) - r) / C), z1 = Math.floor((Math.max(a.z, b.z) + r) / C);
            for (let cx = x0; cx <= x1; cx++) {
                const ex = cx * C + C / 2 - a.x; // cell centre relative to a (grown by half a cell)
                for (let cz = z0; cz <= z1; cz++) {
                    const ez = cz * C + C / 2 - a.z;
                    let t = (ex * dx + ez * dz) * iL2;
                    t = t < 0 ? 0 : t > 1 ? 1 : t;
                    const qx = ex - dx * t, qz = ez - dz * t;
                    if (qx * qx + qz * qz <= R2) G.set(cx, cz);
                }
            }
        }
    }

    placeTowns() {
        const r = this.rand;
        const towns = [];
        for (let gx = -EXTENT; gx < EXTENT; gx += CELL) for (let gz = -EXTENT; gz < EXTENT; gz += CELL) {
            if (r() < 0.35) continue;
            for (let t = 0; t < 6; t++) {
                const x = gx + r() * CELL, z = gz + r() * CELL;
                const h = terrainHeight(x, z);
                if (h < 8 || h > 160) continue;
                if (slopeAt(x, z) > 0.1) continue;
                if (fbm(x * 0.0006 + 40, z * 0.0006 - 12, 3) > 0.15) continue; // forests stay wild
                if (BASES.some(b => Math.hypot(x - b.x, z - b.z) < b.r * 2.2)) continue;
                const size = r() < 0.15 ? 'city' : r() < 0.5 ? 'town' : 'village';
                const n = size === 'city' ? 5 : size === 'town' ? 3 : 1;
                const S = size === 'city' ? 66 : size === 'town' ? 74 : 84;
                towns.push({ x, z, h, size, n, S, radius: n * S + S * 0.6 });
                break;
            }
        }
        // grid orientation: line up with the direction to the nearest neighbour (where the main road comes in)
        for (const t of towns) {
            let best = null, bd = Infinity;
            for (const o of towns) { if (o === t) continue; const d = Math.hypot(o.x - t.x, o.z - t.z); if (d < bd) { bd = d; best = o; } }
            t.theta = best ? Math.atan2(best.x - t.x, best.z - t.z) : r() * Math.PI;
            t.ax = { x: Math.sin(t.theta), z: Math.cos(t.theta) };   // streets of axis 'a' run along ax
            t.bx = { x: Math.cos(t.theta), z: -Math.sin(t.theta) };  // streets of axis 'b' run along bx
        }
        return towns;
    }

    // town grid (u along bx, v along ax, metres) → world
    tw(t, u, v) { return { x: t.x + t.bx.x * u + t.ax.x * v, z: t.z + t.bx.z * u + t.ax.z * v }; }

    planStreets() {
        this.streetDefs = [];
        for (const t of this.towns) {
            const R = t.radius;
            const ks = t.size === 'village' ? [0] : [...Array(t.n * 2 + 1).keys()].map(k => k - t.n);
            t.reach = R;
            for (const axis of ['a', 'b']) {
                for (const k of ks) {
                    const off = k * t.S;
                    const half = Math.sqrt(Math.max(0, R * R - off * off)) * (t.size === 'village' ? 1.6 : 1);
                    if (half < t.S * 0.8) continue;
                    this.streetDefs.push({ t, axis, k, off, half });
                    t.reach = Math.max(t.reach, half);
                }
            }
        }
    }

    // Street pieces along each grid line (split where the ground is unsuitable), in grid distance d
    layoutStreets() {
        const pieces = [], STEP = 12;
        for (const sd of this.streetDefs) {
            const { t, axis, off, half } = sd;
            let cur = null, cut = null;
            const flush = (why) => { if (cur && cur.d1 - cur.d0 > 20) { cur.cutEnd = why; pieces.push(cur); } cur = null; };
            for (let d = -half; d <= half + 0.01; d += STEP) {
                const w = axis === 'a' ? this.tw(t, off, d) : this.tw(t, d, off);
                const h = terrainHeight(w.x, w.z);
                if (h < 2 || slopeAt(w.x, w.z) > 0.34 || outsideBases(w.x, w.z)) { cut = h < 2 ? 'water' : 'closed'; flush(cut); continue; }
                if (!cur) cur = { t, sd, axis, k: sd.k, off, d0: d, d1: d, cutStart: d > -half + 0.01 ? cut || 'closed' : null, cutEnd: null };
                cur.d1 = d;
            }
            flush(null);
        }
        return pieces;
    }

    // Crossroads, T-junctions and corners of the grid. A street that ends within a few metres of a crossing street
    // is trimmed or extended to meet it, so nothing overlaps.
    streetJunctions(pieces) {
        const byTown = new Map();
        for (const pc of pieces) { if (!byTown.has(pc.t)) byTown.set(pc.t, []); byTown.get(pc.t).push(pc); }
        const role = (pc, d) => {
            if (d >= pc.d0 + 9 && d <= pc.d1 - 9) return 'thru';
            if (d > pc.d1 - 9 && d <= pc.d1 + (pc.cutEnd ? 1 : 16)) return 'end';
            if (d < pc.d0 + 9 && d >= pc.d0 - (pc.cutStart ? 1 : 16)) return 'start';
            return null;
        };
        for (const [t, ps] of byTown) {
            const A = ps.filter(p => p.axis === 'a'), B = ps.filter(p => p.axis === 'b');
            for (const pa of A) for (const pb of B) {
                // pa runs along ax at u = pa.off; pb along bx at v = pb.off → they cross at (pa.off, pb.off)
                const dA = pb.off, dB = pa.off;
                const ra = role(pa, dA), rb = role(pb, dB);
                if (!ra || !rb) continue;
                const w = this.tw(t, pa.off, pb.off);
                if (terrainHeight(w.x, w.z) < 2) continue;
                const J = { x: w.x, z: w.z, t, kind: 'street', arms: [] };
                for (const [pc, r, d] of [[pa, ra, dA], [pb, rb, dB]]) {
                    if (r === 'end') { pc.d1 = d; pc.cutEnd = null; }
                    if (r === 'start') { pc.d0 = d; pc.cutStart = null; }
                    J.arms.push(...(r === 'thru' ? [{ pc, d, dir: 1 }, { pc, d, dir: -1 }] : [{ pc, d, dir: r === 'end' ? -1 : 1 }]));
                }
                const ia = Math.abs(pa.k), ib = Math.abs(pb.k);
                const light = J.arms.length === 4 && ((t.size === 'city' && ia <= 2 && ib <= 2) || (t.size === 'town' && ia === 0 && ib === 0));
                J.type = light ? 'light' : 'stop';
                J.offset = this.rand() * 26;
                this.junctions.push(J);
            }
        }
    }

    // A street piece → a drivable path on the graded ground (level-ish across, following the town's surface)
    makeStreetPath(pc) {
        const t = pc.t, raw = [];
        for (let d = pc.d0; d < pc.d1 - 0.5; d += 12) raw.push(d);
        raw.push(pc.d1);
        const at = (d) => pc.axis === 'a' ? this.tw(t, pc.off, d) : this.tw(t, d, pc.off);
        const w0 = at(pc.d0), w1 = at(pc.d1), L = Math.hypot(w1.x - w0.x, w1.z - w0.z) || 1;
        const tx = (w1.x - w0.x) / L, tz = (w1.z - w0.z) / L, rx = -tz, rz = tx;
        const pts = raw.map(d => {
            const w = at(d);
            const y = this.groundAt(w.x, w.z) + STREET_Y;
            const g = (this.groundAt(w.x + rx * WALK, w.z + rz * WALK) - this.groundAt(w.x - rx * WALK, w.z - rz * WALK)) / (2 * WALK);
            return { x: w.x, y, z: w.z, g, s: d - pc.d0, d };
        });
        const path = { pts, len: pc.d1 - pc.d0, bridges: [], street: true, sd: pc.sd, t, stops: [], half: STREET_HALF, ribbonHalf: WALK, piece: pc };
        pc.path = path;
        return path;
    }

    // streets cut short by a steep bank get a barrier (waterfront streets just end at the water)
    streetDeadEnds() {
        for (const p of this.streetPaths) {
            const pc = p.piece, P = p.pts;
            if (p.len < 60) continue;
            if (pc.cutStart === 'closed') this.deadEnds.push({ x: P[0].x, z: P[0].z, dx: P[0].x - P[1].x, dz: P[0].z - P[1].z, reason: 'closed', w: STREET_HALF, y: P[0].y, path: p, end: 0 });
            if (pc.cutEnd === 'closed') { const a = P[P.length - 1], b = P[P.length - 2]; this.deadEnds.push({ x: a.x, z: a.z, dx: a.x - b.x, dz: a.z - b.z, reason: 'closed', w: STREET_HALF, y: a.y, path: p, end: 1 }); }
        }
    }

    // Where roads may leave a town: the open ends of its streets (not cut short, not in a junction)
    portsOf(t) {
        const ports = [];
        for (const p of this.streetPaths) {
            if (p.t !== t || p.len < 40) continue;
            const pc = p.piece, P = p.pts, n = P.length;
            for (const end of [0, 1]) {
                if (end === 0 ? pc.cutStart : pc.cutEnd) continue;
                if (this.junctions.some(J => J.arms.some(a => a.pc === pc && Math.abs(a.d - (end ? pc.d1 : pc.d0)) < 1))) continue;
                const a = end ? P[n - 1] : P[0], b = end ? P[n - 2] : P[1];
                const L = Math.hypot(a.x - b.x, a.z - b.z) || 1;
                ports.push({ x: a.x, z: a.z, dx: (a.x - b.x) / L, dz: (a.z - b.z) / L, y: a.y, g: end ? a.g : -a.g, slope: (a.y - b.y) / L, hw: STREET_HALF + 0.9, path: p, end, rank: Math.abs(pc.k) });
            }
        }
        return ports;
    }

    // Junctions on the road network: roads sharing a gate branch off one another, roads that cross (each other or
    // a street) get a crossroads, and a road cut short near another road is joined to it.
    roadJunctions() {
        const roads = this.paths;
        // roads that leave another road (the second road out of an airbase gate): a T-junction on it
        for (const p of roads) for (const [port, end] of [[p.startPort, 0], [p.endPort, 1]]) {
            if (!port || !port.branch) continue;
            const q = end ? p.pts[p.pts.length - 1] : p.pts[0];
            let host = null, c = null;
            for (const o of roads) { if (o === p) continue; const cc = closestOnPath(o, q.x, q.z); if (cc.d < 1 && (!c || cc.d < c.d)) { host = o; c = cc; } }
            if (!host || c.s < 30 || c.s > host.len - 30) continue;
            const arm = { path: p, s: end ? p.len : 0, dir: end ? -1 : 1, minor: true };
            const J0 = this.junctions.find(J => J.kind === 'branch' && J.arms[0].path === host && Math.abs(J.arms[0].s - c.s) < 1);
            if (J0) { J0.arms.push(arm); continue; }
            const Q = samplePath(host, c.s, new THREE.Vector3());
            this.junctions.push({ x: Q.x, z: Q.z, kind: 'branch', type: 'priority', offset: 0, arms: [{ path: host, s: c.s, dir: -1 }, { path: host, s: c.s, dir: 1 }, arm] });
        }
        let uid = 0;
        for (const p of [...roads, ...this.streetPaths]) p.uid = uid++;
        // crossings: roads with roads, roads with streets
        const segs = new Map(), CS = 80;
        const addSegs = (p) => {
            for (let k = 0; k + 1 < p.pts.length; k++) {
                const a = p.pts[k], b = p.pts[k + 1];
                if (p.bridges.some(br => b.s > br.s0 - 1 && a.s < br.s1 + 1)) continue;
                const cx0 = Math.floor(Math.min(a.x, b.x) / CS), cx1 = Math.floor(Math.max(a.x, b.x) / CS), cz0 = Math.floor(Math.min(a.z, b.z) / CS), cz1 = Math.floor(Math.max(a.z, b.z) / CS);
                for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
                    const key = cx * 100003 + cz;
                    if (!segs.has(key)) segs.set(key, []);
                    segs.get(key).push({ p, k });
                }
            }
        };
        for (const p of [...roads, ...this.streetPaths]) addSegs(p);
        const found = [];
        const seen = new Set();
        for (const list of segs.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            const A = list[i], B = list[j];
            if (A.p === B.p || (A.p.street && B.p.street)) continue;
            const id = A.p.uid + ':' + A.k + ':' + B.p.uid + ':' + B.k;
            if (seen.has(id)) continue; seen.add(id);
            const a0 = A.p.pts[A.k], a1 = A.p.pts[A.k + 1], b0 = B.p.pts[B.k], b1 = B.p.pts[B.k + 1];
            const X = segCross(a0, a1, b0, b1);
            if (!X) continue;
            found.push({ A: A.p, sA: a0.s + (a1.s - a0.s) * X.t, B: B.p, sB: b0.s + (b1.s - b0.s) * X.u, x: X.x, z: X.z });
        }
        const near = (p, s, r) => this.junctions.some(J => J.arms.some(a => a.path === p && Math.abs(a.s - s) < r)) || (p.street && this.junctions.some(J => J.arms.some(a => a.pc === p.piece && Math.abs(a.d - p.piece.d0 - s) < r)));
        for (const f of found) {
            if (Math.hypot(f.x - f.A.pts[0].x, f.z - f.A.pts[0].z) < 1 && Math.hypot(f.x - f.B.pts[0].x, f.z - f.B.pts[0].z) < 1) continue; // shared start
            if (near(f.A, f.sA, 45) || near(f.B, f.sB, 45)) continue;
            const arms = [];
            for (const [p, s] of [[f.A, f.sA], [f.B, f.sB]]) {
                if (s > 25) arms.push({ path: p, s, dir: -1 });
                if (s < p.len - 25) arms.push({ path: p, s, dir: 1 });
            }
            if (arms.length < 3) continue;
            // roads that merely graze each other at a shallow angle don't make a crossroads
            const ta = tangentAt(f.A, f.sA), tb = tangentAt(f.B, f.sB);
            if (Math.abs(ta.x * tb.x + ta.z * tb.z) > Math.cos(35 * Math.PI / 180)) continue;
            const minor = arms.filter(a => a.path.street);
            this.junctions.push({ x: f.x, z: f.z, kind: 'cross', arms, type: minor.length ? 'priority' : 'stop', offset: 0 });
        }
    }

    // Outline, stub lengths and surface plane of every junction; the paths through it take the plane's heights
    // (blending back to their own over 20 m), so the ribbons end exactly on the box's edges.
    shapeJunctions() {
        const BLEND = 20;
        this.junctions = this.junctions.filter(J => J.arms.length >= 2);
        for (const J of this.junctions) {
            for (const a of J.arms) if (a.pc) { a.path = a.pc.path; a.s = a.d - a.pc.d0; }
            J.arms = J.arms.filter(a => a.path && a.s >= -0.01 && a.s <= a.path.len + 0.01);
        }
        this.junctions = this.junctions.filter(J => J.arms.length >= 2 && new Set(J.arms.map(a => a.path)).size >= 2);
        const tv = { x: 0, z: 0 };
        for (const J of this.junctions) {
            J.heads = [];
            for (const a of J.arms) {
                tangentAt(a.path, a.s + a.dir * 3, tv);
                a.dx = tv.x * a.dir; a.dz = tv.z * a.dir;
                a.w = a.path.street ? STREET_HALF : ROAD_HALF;
                a.wOut = a.path.street ? WALK : ROAD_HALF;
            }
            J.streets = J.arms.every(a => a.path.street);
            const R = J.streets ? KERB_R : 7;
            const sh = junctionShape(J.x, J.z, J.arms.map(a => ({ dx: a.dx, dz: a.dz, w: J.streets ? a.w : a.wOut })), R);
            J.poly = sh.poly; J.L = sh.L; J.chains = sh.chains;
            J.arms.forEach((a, i) => { a.L = Math.min(sh.L[i], a.dir > 0 ? a.path.len - a.s : a.s); });
            if (J.streets) { const ring = junctionShape(J.x, J.z, J.arms.map(a => ({ dx: a.dx, dz: a.dz, w: a.wOut })), R - SIDEWALK, sh.L); J.ring = ring.poly; J.ringChains = ring.chains; }
            // the plane through the centre that best matches every path's grade along and across itself
            const paths = [...new Set(J.arms.map(a => a.path))];
            const v = new THREE.Vector3();
            let yc = 0;
            for (const p of paths) yc += samplePath(p, J.arms.find(a => a.path === p).s, v).y;
            yc /= paths.length;
            let sxx = 0, sxz = 0, szz = 0, bx = 0, bz = 0;
            for (const a of J.arms) {
                // along the arm: its grade; across it: the path's cross-slope (g is to the right of travel along +s,
                // and travel along +s is the arm direction times a.dir)
                const y0 = samplePath(a.path, a.s, v).y, y1 = samplePath(a.path, a.s + a.dir * 10, v).y;
                const g = samplePath(a.path, a.s + a.dir * 5, v).g;
                for (const [ex, ez, val, wgt] of [[a.dx, a.dz, (y1 - y0) / 10, 1], [-a.dz * a.dir, a.dx * a.dir, g, 0.4]]) {
                    sxx += wgt * ex * ex; sxz += wgt * ex * ez; szz += wgt * ez * ez; bx += wgt * ex * val; bz += wgt * ez * val;
                }
            }
            const det = sxx * szz - sxz * sxz;
            J.gx = Math.abs(det) > 1e-6 ? (bx * szz - bz * sxz) / det : 0;
            J.gz = Math.abs(det) > 1e-6 ? (bz * sxx - bx * sxz) / det : 0;
            // a junction on a steep hill is terraced flatter than the street
            const gl = Math.hypot(J.gx, J.gz);
            if (gl > 0.12) { J.gx *= 0.12 / gl; J.gz *= 0.12 / gl; }
            J.y = yc;
            J.yAt = (x, z) => J.y + J.gx * (x - J.x) + J.gz * (z - J.z);
            // cut points, then blend each path into the plane
            for (const a of J.arms) { pointAt(a.path, a.s); pointAt(a.path, a.s + a.dir * a.L); }
            for (const p of paths) {
                const arms = J.arms.filter(a => a.path === p), s0 = arms[0].s;
                for (let k = 0; k < p.pts.length; k++) {
                    const q = p.pts[k], ds = q.s - s0;
                    const arm = arms.find(a => Math.sign(ds || a.dir) === a.dir) || arms[0];
                    if (Math.sign(ds) !== 0 && Math.sign(ds) !== arm.dir) continue; // the path doesn't go that way
                    const ad = Math.abs(ds);
                    if (ad > arm.L + BLEND) continue;
                    const w = ad <= arm.L + 0.01 ? 1 : 1 - smooth01((ad - arm.L) / BLEND);
                    const Q = p.pts[Math.min(k + 1, p.pts.length - 1)], O = p.pts[Math.max(k - 1, 0)];
                    let tx = Q.x - O.x, tz = Q.z - O.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
                    const py = J.yAt(q.x, q.z), pg = J.gx * -tz + J.gz * tx;
                    q.y += (py - q.y) * w; q.g += (pg - q.g) * w;
                    if (w === 1 && q.hw !== undefined && !p.street) q.hw = ROAD_HALF;
                }
            }
            // traffic: where to stop on each approach
            for (const a of J.arms) {
                a.path.stops = a.path.stops || [];
                const minor = J.type !== 'priority' || a.path.street || a.minor;
                if (!minor) continue;
                // cars travelling toward the centre on this arm move against a.dir
                a.path.stops.push({ s: a.s, inter: J, axis: a.pc ? a.pc.axis : (a.path === J.arms[0].path ? 'a' : 'b'), from: a.dir, line: a.L + 1.2, kind: J.type === 'light' ? 'light' : 'stop' });
            }
        }
        for (const p of [...this.paths, ...this.streetPaths]) if (p.stops) p.stops.sort((a, b) => a.s - b.s);
    }

    // Ribbons for every road and street (stopping at junction mouths and bridge decks), the junction boxes, the
    // pavements round the street corners and the stop lines. Returns the geometries the terrain must stay under.
    buildSurfaces() {
        const roadB = new SurfaceBuilder(), streetB = new SurfaceBuilder(), boxB = new SurfaceBuilder(), walkB = new SurfaceBuilder(), markB = new SurfaceBuilder(), hullB = new SurfaceBuilder(), vergeB = new SurfaceBuilder();
        const cuts = new Map();
        for (const J of this.junctions) for (const a of J.arms) {
            if (!cuts.has(a.path)) cuts.set(a.path, []);
            cuts.get(a.path).push([Math.min(a.s, a.s + a.dir * a.L), Math.max(a.s, a.s + a.dir * a.L)]);
        }
        for (const p of [...this.paths, ...this.streetPaths]) {
            p.jcuts = cuts.get(p) || [];
            const ex = [...p.jcuts, ...p.bridges.map(b => [b.s0, b.s1])].sort((a, b) => a[0] - b[0]);
            let s = 0;
            const B = p.street ? streetB : roadB, half = p.street ? WALK : ROAD_HALF;
            // the embankment under each edge (not a surface the terrain has to stay under)
            const sk = vergeB, depth = p.street ? 2.5 : 3.5;
            for (const [a, b] of ex) { if (a - s > 0.3) B.ribbon(p, s, a, half, undefined, sk, depth); s = Math.max(s, b); }
            if (p.len - s > 0.3) B.ribbon(p, s, p.len, half, undefined, sk, depth);
        }
        for (const J of this.junctions) {
            boxB.polygon(J.poly, null, J.yAt, 1 / 12);
            // the pavement round each corner: between the kerb and the outer edge (one simple polygon per corner)
            if (J.ring) J.chains.forEach((inner, i) => walkB.polygon([...inner, ...[...J.ringChains[i]].reverse()], null, J.yAt, 1 / 3));
            // the terrain solver only needs a coarse cover of the box (its convex hull, on the same plane)
            hullB.polygon(convexHull(J.ring || J.poly), null, J.yAt, 0);
            // stop lines across the incoming lane
            if (J.type === 'priority' && !J.streets) continue;
            for (const a of J.arms) {
                if (J.type === 'priority' && !(a.path.street || a.minor)) continue;
                const d = a.L + 0.6, cx = J.x + a.dx * d, cz = J.z + a.dz * d, rx = a.dz, rz = -a.dx; // incoming traffic's right
                const lat = a.w * 0.5;
                markB.quad(cx + rx * lat, cz + rz * lat, a.dx, a.dz, 0.25, a.w * 0.5 - 0.35, (x, z) => J.yAt(x, z) + 0.02);
            }
        }
        const verge = liftWithDistance(new THREE.MeshStandardMaterial({ color: 0x6f6a5c, roughness: 1 }));
        const meshes = [[roadB, roadMaterial()], [streetB, streetMaterial()], [boxB, junctionMaterial()], [walkB, sidewalkMaterial()], [markB, markMaterial()], [vergeB, verge]];
        const geos = [];
        for (const [B, mat] of meshes) {
            if (!B.idx.length) continue;
            const m = B.mesh(mat);
            this.group.add(m);
            if (B === roadB || B === streetB) geos.push(m.geometry);
        }
        if (hullB.idx.length) geos.push(hullB.geometry());
        return geos;
    }

    // a NearInstances set that update() re-packs around the camera
    near(geo, mat, max, opts) {
        const set = new NearInstances(this.group, geo, mat, max, opts);
        (this.nearSets || (this.nearSets = [])).push(set);
        return set;
    }

    // One InstancedMesh per group of nearby towns for a kind of building part, each with its own bounding sphere,
    // so towns out of view (or out of the small shadow frustum) cost little. `far`: not drawn beyond this.
    // The towns are grouped by the TOWN_CELL (FAR_CELL for kinds only drawn close) square their centre is in:
    // one draw call covers a cluster of towns instead of one each (40 towns → ~15-20 groups).
    // attrs(n): per-instance attributes (the geometry is cloned per group to carry them)
    perTown(geo, mat, list, write, { shadow = true, far = Infinity, attrs = null } = {}) {
        const byTown = new Map(), C = far < Infinity ? FAR_CELL : TOWN_CELL;
        for (const o of list) {
            const k = Math.floor(o.t.x / C) * 1000 + Math.floor(o.t.z / C);
            if (!byTown.has(k)) byTown.set(k, []);
            byTown.get(k).push(o);
        }
        const out = [];
        for (const items of byTown.values()) {
            let g = geo;
            if (attrs) { g = geo.clone(); for (const [k, a] of Object.entries(attrs(items.length))) g.setAttribute(k, a); }
            const im = new THREE.InstancedMesh(g, mat, items.length);
            items.forEach((o, i) => write(im, i, o));
            im.castShadow = shadow; im.receiveShadow = true;
            im.computeBoundingSphere();
            im.matrixAutoUpdate = false;
            im.userData.far = far;
            this.group.add(im);
            (this.townMeshes || (this.townMeshes = [])).push(im);
            out.push(im);
        }
        return out;
    }

    // phase of a traffic light for an axis: 'green' | 'amber' | 'red'
    lightState(inter, axis) {
        const T = 26, t = (this.time + inter.offset) % T;
        if (axis === 'a') return t < 10 ? 'green' : t < 13 ? 'amber' : 'red';
        return t < 13 ? 'red' : t < 23 ? 'green' : 'amber';
    }

    // ── Crossroads furniture: traffic lights or stop signs on each approach's kerb, zebra crossings at lights ──
    buildSignals() {
        const withSigns = this.junctions.filter(J => J.type !== 'priority' || J.arms.some(a => a.path.street || a.minor));
        const lights = withSigns.filter(i => i.type === 'light'), stops = withSigns.filter(i => i.type !== 'light');
        const poleGeo = new THREE.CylinderGeometry(0.1, 0.12, 5.2, 6); poleGeo.translate(0, 2.6, 0);
        const headGeo = new THREE.BoxGeometry(0.45, 1.3, 0.35);
        const lampGeo = new THREE.SphereGeometry(0.22, 8, 6);
        const signPoleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5); signPoleGeo.translate(0, 1.15, 0);
        // octagon with a flat top edge (thetaStart), not spun in its own plane, so STOP reads level
        const signGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 8, 1, false, Math.PI / 8); signGeo.rotateX(Math.PI / 2);
        { const uv = signGeo.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i) - 0.5, v = uv.getY(i) - 0.5; uv.setXY(i, 0.5 + v, 0.5 - u); } } // the cap UVs read sideways: turn them so STOP is upright
        const stopTex = canvasTex(128, 128, (ctx) => { ctx.fillStyle = '#c4161c'; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = '#fff'; ctx.font = 'bold 38px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('STOP', 64, 66); }, false);
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6, metalness: 0.4 });
        const nL = Math.max(1, lights.length * 4), nS = Math.max(1, stops.length * 4);
        // street furniture is only drawn within a couple of km of the camera (see update)
        const poles = this.near(poleGeo, darkMat, nL);
        const heads = this.near(headGeo, darkMat, nL);
        this.lamps = this.near(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), nL, { colors: true });
        const sPoles = this.near(signPoleGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0a4, metalness: 0.5, roughness: 0.4 }), nS);
        const signs = this.near(signGeo, new THREE.MeshStandardMaterial({ map: stopTex, roughness: 0.6 }), nS);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
        const zebra = [];
        for (const it of withSigns) {
            for (const ap of it.arms) {
                if (it.type === 'priority' && !(ap.path.street || ap.minor)) continue;
                // traffic on this arm travels toward the centre (along -arm); signs stand on its right-hand kerb/verge
                const fx = -ap.dx, fz = -ap.dz;
                const rx = -fz, rz = fx;
                const side = ap.w + (ap.path.street ? 1.2 : 1.5), back = ap.L + 1.5;
                const x = it.x - fx * back + rx * side, z = it.z - fz * back + rz * side;
                const y = it.yAt(x, z) - 0.05;
                q.setFromAxisAngle(up, Math.atan2(-fx, -fz)); // the plate (+Z) faces back along -f, toward the oncoming drivers
                if (it.type === 'light') {
                    poles.add(m.compose(p.set(x, y, z), q, one));
                    heads.add(m.compose(p.set(x, y + 5.6, z), q, one));
                    const li = this.lamps.add(m.compose(p.set(x - fx * 0.22, y + 5.6, z - fz * 0.22), q, one));
                    it.heads.push({ idx: li, axis: ap.pc ? ap.pc.axis : 'a', state: null });
                    const zd = ap.L + 2.6;
                    zebra.push({ x: it.x + ap.dx * zd, z: it.z + ap.dz * zd, rot: Math.atan2(ap.dx, ap.dz), arm: ap });
                } else {
                    sPoles.add(m.compose(p.set(x, y, z), q, one));
                    signs.add(m.compose(p.set(x - fx * 0.08, y + 2.25, z - fz * 0.08), q, one)); // plate in front of the post
                }
            }
        }
        this.lampColors = { red: new THREE.Color(4, 0.2, 0.1), amber: new THREE.Color(4, 2, 0.1), green: new THREE.Color(0.3, 4, 1) };
        for (let i = 0; i < this.lamps.n; i++) this.lamps.setColor(i, this.lampColors.red);
        const zTex = canvasTex(64, 64, (ctx) => { ctx.clearRect(0, 0, 64, 64); ctx.fillStyle = 'rgba(240,240,232,0.95)'; for (let i = 0; i < 4; i++) ctx.fillRect(4 + i * 16, 0, 8, 64); }, false);
        const zGeo = new THREE.PlaneGeometry(STREET_HALF * 2 - 1, 3.5); zGeo.rotateX(-Math.PI / 2);
        const zm = this.near(zGeo, liftWithDistance(new THREE.MeshStandardMaterial({ map: zTex, color: 0xb8b8b0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: offsetUnits(-8), roughness: 0.9 })), Math.max(1, zebra.length));
        // the crossing lies on the arm just outside the box: its height is the street's there
        const v = new THREE.Vector3();
        for (const zb of zebra) {
            const arm = zb.arm, y = samplePath(arm.path, arm.s + arm.dir * (arm.L + 2.6), v).y;
            zm.add(m.compose(p.set(zb.x, y + 0.03, zb.z), q.setFromAxisAngle(up, zb.rot), one));
        }
    }

    // ── Buildings on lots along the streets ──
    // Each town picks a palette. Cities: glass and stone towers downtown (the tallest with a crown and spire),
    // apartment blocks with balconies and shops underneath, rows of townhouses, then houses with gardens; towns:
    // a centre of townhouses and shops round a market square; villages: houses, a church, a water tower.
    // A city gets a stadium on its edge, towns and cities a filling station on a road out.
    // Everything is a handful of instanced meshes per town, and every building is a record in buildings.js
    // (its walls, roof and details are its parts, so they fall with it).
    buildBuildings() {
        const r = mulberry32(99);
        const pick = (a) => a[Math.floor(r() * a.length) % a.length];
        const walls = [], gables = [], hips = [], flats = [], bits = [], tanks = [], dormers = [], spires = [], trees = [], parks = [], driveways = [], ground = [];
        const B = this.buildings = new Buildings(this.group);
        const up = new THREE.Vector3(0, 1, 0);
        // tryPlace: the whole footprint must be on dry land, clear of every road and street, and not too steep
        // (a building on a slope stands on a plinth down to its lowest corner). gap: space kept to its neighbours
        const tryPlace = (t, u, v, w, d, rot, o, gap = 1) => {
            const c = this.tw(t, u, v);
            const ca = Math.cos(rot), sa = Math.sin(rot);
            const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0], [0, -d / 2], [0, d / 2], [-w / 2, 0], [w / 2, 0]].map(([a, b]) => this.tw(t, u + a * ca - b * sa, v + a * sa + b * ca));
            let hmin = Infinity, hmax = -Infinity;
            for (const q of corners) {
                if (this.blocked(q.x, q.z)) return null;
                if (terrainHeight(q.x, q.z) < 2) return null;
                const h = this.groundAt(q.x, q.z); // the town's graded ground
                hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
            }
            if (hmax - hmin > Math.min(9, Math.max(3.5, Math.min(w, d) * 0.45))) return null;
            // lots are axis-aligned in the town grid: keep a gap to every footprint already placed
            const sw = Math.abs(Math.sin(rot)) > 0.5, hu = (sw ? d : w) / 2 + gap, hv = (sw ? w : d) / 2 + gap;
            const fp = t.footprints || (t.footprints = []);
            if (fp.some(f => Math.abs(f.u - u) < f.hu + hu - gap + Math.max(gap, f.gap) && Math.abs(f.v - v) < f.hv + hv - gap + Math.max(gap, f.gap))) return null;
            fp.push({ u, v, hu: hu - gap, hv: hv - gap, gap });
            for (const q of corners) this.mark(q.x, q.z, 1);
            const b = { t, x: c.x, z: c.z, y: hmin - 0.5, w, d, yaw: t.theta + rot, plinth: hmax - hmin, ...o };
            b.ht = o.ht + b.plinth + 0.5;
            walls.push(b);
            return b;
        };
        const PAL = [
            { walls: [0xe9dcc3, 0xe3c9a0, 0xd9b48c, 0xf0e2c8, 0xcf9f7a, 0xe8d3b0, 0xd6c2a0], roofs: [0xa4492f, 0x8f3b26, 0xb85a36, 0x7a3a2a, 0x9c5a3a] },       // warm: stucco and terracotta
            { walls: [0xd8d8d2, 0xc3c6c8, 0xaab3b8, 0xe6e4de, 0xb8bcb0, 0x9ea7ad, 0xcfc9bd], roofs: [0x4d545c, 0x5a5f66, 0x3f454c, 0x6a6f74, 0x57504a] },       // cool: render and slate
            { walls: [0x9b4a35, 0x8a3f2e, 0xb0624a, 0x7d4636, 0xc9b79c, 0xa25a44, 0xb98a6a], roofs: [0x3f3a38, 0x4a4f55, 0x5b3a2e, 0x6b4a3a] },                 // brick
            { walls: [0xf2d6c9, 0xd6e6d3, 0xcfe0ea, 0xf3e7b6, 0xe8cfe0, 0xf5f0e6, 0xe2d4c0], roofs: [0x9a4b3a, 0x5a6470, 0x8c5a3c, 0x6d7a5a] },               // pastel
        ];
        const APT = [0xb8b0a4, 0xc9bda8, 0x9aa3a8, 0xd2c3ad, 0xa89484, 0xc4a896, 0xd9d4ca, 0x8f9aa0, 0xbfae8e];
        const STONE = [0xc9c2b4, 0xb7ad9c, 0xa6a39c, 0xd8d2c4, 0x8e8a84];
        const GLASS = [0x5d7389, 0x6f8fa8, 0x4f6a5e, 0x8a9096, 0x3f4f63, 0x9c8b72, 0x7a8f99];
        const ACCENT = () => r(); // shop fascia hue
        for (const t of this.towns) {
            t.pal = PAL[Math.floor(r() * PAL.length)];
            const S = t.S, inner = S - WALK * 2 - 4; // lots start 2 m behind the pavement
            const n = t.size === 'village' ? 1 : t.n;
            const blocks = [];
            for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
                const cu = (i + 0.5) * S, cv = (j + 0.5) * S, dist = Math.hypot(cu, cv);
                if (dist > t.radius - S * 0.3) continue;
                blocks.push({ i, j, cu, cv, rel: dist / t.radius });
            }
            blocks.sort((a, b) => a.rel - b.rel);
            // the specials first, on the blocks nearest the centre that suit them
            let church = t.size === 'village' ? r() < 0.8 : true, market = t.size !== 'village';
            for (const bk of blocks) {
                const { cu, cv, rel } = bk;
                const c = this.tw(t, cu, cv);
                if (market && rel < 0.45 && (t.size === 'town' || rel > 0.2) && this.market(t, bk, inner, walls, bits, ground, r)) { market = false; bk.used = true; continue; }
                if (church && rel < 0.6 && rel > (t.size === 'city' ? 0.25 : 0.05) && !this.blocked(c.x, c.z) && terrainHeight(c.x, c.z) > 2) {
                    const ch = this.church(t, cu, cv, walls, gables, spires, bits, r);
                    if (ch) { church = false; bk.used = true; continue; }
                }
            }
            for (const bk of blocks) {
                if (bk.used) continue;
                const { cu, cv, rel } = bk;
                const zone = t.size === 'city' ? (rel < 0.28 ? 'core' : rel < 0.5 ? 'apt' : rel < 0.72 ? 'town' : 'house')
                    : t.size === 'town' ? (rel < 0.34 ? 'town' : 'house') : (rel < 0.15 && r() < 0.5 ? 'town' : 'house');
                if (r() < (t.size === 'city' ? 0.07 : 0.05) && zone !== 'core') { parks.push({ t, cu, cv, size: inner }); continue; }
                if (zone === 'core') { this.downtown(t, bk, inner, tryPlace, r, { GLASS, STONE, APT, ACCENT }); continue; }
                const before = walls.length;
                // perimeter lots facing the four streets
                const lotW = zone === 'apt' ? 20 + r() * 6 : zone === 'town' ? 8 + r() * 4 : 12 + r() * 3;
                const depth = zone === 'apt' ? 15 + r() * 3 : zone === 'town' ? 11 + r() * 3 : 9 + r() * 2;
                const edge = inner / 2 - depth / 2 - (zone === 'house' ? 4 : 0); // houses get front yards
                const mainStreet = Math.abs(bk.i + 0.5) < 1.6 || Math.abs(bk.j + 0.5) < 1.6; // shops along the central streets
                for (const side of [0, 1, 2, 3]) {
                    const alongU = side < 2, sgn = side % 2 ? 1 : -1;
                    for (let o0 = -inner / 2; ;) {
                        const wlot = zone === 'town' ? 7 + r() * 5 : lotW;
                        if (o0 + wlot > inner / 2 + 0.1) break;
                        const o = o0 + wlot / 2; // this lot's centre along the street
                        o0 += wlot + (zone === 'house' ? 5 : zone === 'town' ? 0.3 : 1.5);
                        if (zone === 'house' && r() < 0.16) continue; // gaps: gardens
                        const u = alongU ? cu + o : cu + sgn * edge, v = alongU ? cv + sgn * edge : cv + o;
                        const rot = alongU ? 0 : Math.PI / 2;
                        // the street is on this building's local ±z side (front: 2 = +z, 4 = -z)
                        const front = sgn > 0 ? 2 : 4;
                        let b = null;
                        if (zone === 'house') {
                            const w = wlot - 2 - r() * 3, d = depth - r() * 1.5, storeys = r() < 0.35 ? 2 : 1;
                            b = tryPlace(t, u, v, w, d, rot, { kind: 'house', ht: storeys * 3 + 0.2, style: FACADE.house, flags: front, col: pick(t.pal.walls), roof: r() < 0.62 ? 'gable' : r() < 0.85 ? 'hip' : 'flat', roofCol: pick(t.pal.roofs), front: sgn, floors: storeys });
                            if (b) {
                                // driveway beside the house from the street, usually with a car on it
                                const streetEdge = S / 2 - WALK, back = edge - d * 0.25;
                                const len = streetEdge - back, mid = (streetEdge + back) / 2;
                                const lat = o + (w / 2 + 2);
                                const du = alongU ? cu + lat : cu + sgn * mid, dv = alongU ? cv + sgn * mid : cv + lat;
                                const c = this.tw(t, du, dv);
                                const k = r(); driveways.push({ t, x: c.x, z: c.z, len, yaw: t.theta + rot, cars: k < 0.15 ? 0 : k < 0.6 ? 1 : 2, hue: r(), hue2: r(), flip: r() < 0.5 });
                            }
                        } else if (zone === 'town') {
                            const storeys = 2 + Math.floor(r() * 3), shop = (mainStreet || t.size !== 'city') && r() < 0.7 ? 1 : 0;
                            b = tryPlace(t, u, v, wlot - 0.3, depth, rot, { kind: 'town', ht: storeys * 3.3 + (shop ? 1 : 0) + 0.3, style: FACADE.townhouse, flags: front | shop, accent: ACCENT(), col: pick(r() < 0.7 ? t.pal.walls : STONE), roof: r() < 0.45 ? 'gable' : 'flat', roofCol: pick(t.pal.roofs), front: sgn, floors: storeys, shop }, 0.15);
                        } else {
                            const storeys = 4 + Math.floor(r() * 5), shop = mainStreet && r() < 0.6 ? 1 : 0;
                            b = tryPlace(t, u, v, wlot - 1, depth, rot, { kind: 'apt', ht: storeys * 2.9 + (shop ? 1.3 : 0) + 0.4, style: FACADE.apartment, flags: front | shop, accent: ACCENT(), col: pick(APT), roof: 'flat', front: sgn, floors: storeys, shop, balconies: r() < 0.75 });
                        }
                        void b;
                    }
                }
                // back gardens get a few trees; a block too steep to build on is left wooded
                const empty = walls.length === before;
                if (zone === 'house' || zone === 'town' || empty) for (let k = 0; k < (empty ? 12 : 3); k++) {
                    const sp = empty ? 0.85 : 0.4;
                    const c = this.tw(t, cu + (r() - 0.5) * inner * sp, cv + (r() - 0.5) * inner * sp);
                    if (!this.blocked(c.x, c.z)) trees.push({ x: c.x, z: c.z, s: 0.5 + r() * 0.5, t });
                }
            }
            if (t.size === 'village' && r() < 0.85) this.waterTower(t, tryPlace, r);
            if (t.size === 'city') this.stadium(t, ground, r);
            if (t.size !== 'village') this.fillingStation(t, walls, bits, ground, r);
        }
        this.decorate(walls, gables, hips, flats, bits, tanks, dormers, spires, r);
        this.draw({ walls, gables, hips, flats, bits, tanks, dormers, spires, trees, parks, ground }, B);
        B.index();
        this.buildDriveways(driveways);
        this.buildingCount = walls.filter(b => b.rec).length;
    }

    // Downtown block: one or two towers (glass or stone offices), or four smaller blocks if a street cuts it
    downtown(t, bk, inner, tryPlace, r, { GLASS, STONE, APT, ACCENT }) {
        const { cu, cv, rel } = bk;
        const two = r() < 0.45;
        const tall = (k) => (28 + Math.pow(Math.max(0, 1 - rel / 0.28), 1.2) * 110 * (0.55 + r() * 0.6)) * k;
        const tower = (u, v, w, d, ht) => {
            const glass = r() < 0.6;
            const floors = Math.max(6, Math.round(ht / 3.8));
            return tryPlace(t, u, v, w, d, 0, { kind: 'tower', ht: floors * 3.8, style: glass ? FACADE.glass : FACADE.office, flags: 2 | (r() < 0.5 ? 1 : 0), accent: ACCENT(), col: glass ? GLASS[Math.floor(r() * GLASS.length)] : STONE[Math.floor(r() * STONE.length)], roof: 'flat', floors, front: 1, tower: true });
        };
        let placed = 0;
        if (two) { placed += !!tower(cu - inner * 0.26, cv, inner * 0.44, inner * (0.55 + r() * 0.35), tall(1)); placed += !!tower(cu + inner * 0.26, cv, inner * 0.44, inner * (0.55 + r() * 0.35), tall(0.55 + r() * 0.5)); }
        else placed += !!tower(cu, cv, inner * (0.6 + r() * 0.3), inner * (0.55 + r() * 0.35), tall(1));
        if (!placed) for (const [a, b2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const u = cu + a * inner * 0.27, v = cv + b2 * inner * 0.27;
            if (r() < 0.6) tower(u, v, inner * 0.4, inner * 0.4, tall(0.4 + r() * 0.4));
            else { const storeys = 5 + Math.floor(r() * 4); tryPlace(t, u, v, inner * 0.4, inner * 0.4, 0, { kind: 'apt', ht: storeys * 2.9, style: FACADE.apartment, flags: 2, col: APT[Math.floor(r() * APT.length)], roof: 'flat', floors: storeys, front: 1, balconies: r() < 0.5 }); }
        }
    }

    // A market square: paved, rows of stalls under striped awnings, a market hall along one side
    market(t, bk, inner, walls, bits, ground, r) {
        const c = this.tw(t, bk.cu, bk.cv);
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([a, b]) => this.tw(t, bk.cu + a * (inner / 2 - 1), bk.cv + b * (inner / 2 - 1)));
        if (pts.some(q => this.blocked(q.x, q.z) || terrainHeight(q.x, q.z) < 2)) return false;
        const hs = pts.map(q => this.groundAt(q.x, q.z));
        if (Math.max(...hs) - Math.min(...hs) > 7) return false;
        (t.footprints || (t.footprints = [])).push({ u: bk.cu, v: bk.cv, hu: inner / 2, hv: inner / 2, gap: 1 });
        for (const q of pts) this.mark(q.x, q.z, 1);
        ground.push({ t, kind: 'plaza', cu: bk.cu, cv: bk.cv, size: inner, col: [0.62, 0.6, 0.56] });
        const colors = [0xd23b2f, 0x2f7fd2, 0xe8b72c, 0x3a9b4a, 0xe07b2a, 0xf0f0ea];
        // the hall on the far side
        const hall = { t, kind: 'market', ...this.tw(t, bk.cu, bk.cv + inner * 0.36), y: Math.min(...hs) - 0.4, w: inner * 0.85, d: inner * 0.2, ht: 7.5, yaw: t.theta, style: FACADE.shed, flags: 4, col: 0xc9b89a, roof: 'gable', roofCol: 0x6d7a82, front: -1, floors: 1 };
        walls.push(hall);
        // stalls: counter + awning
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 1; b++) {
            if (r() < 0.2) continue;
            const q = this.tw(t, bk.cu + a * inner * 0.17, bk.cv + b * inner * 0.15 - inner * 0.04);
            const y = this.groundAt(q.x, q.z);
            bits.push({ t, x: q.x, y: y + 0.3, z: q.z, w: 3, h: 1.0, d: 2, yaw: t.theta, col: 0x8a6a4a });
            bits.push({ t, x: q.x, y: y + 2.5, z: q.z, w: 3.6, h: 0.18, d: 2.8, yaw: t.theta, col: colors[Math.floor(r() * colors.length)], tilt: 0.12 });
            for (const [px, pz] of [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]]) {
                const pp = this.tw(t, bk.cu + a * inner * 0.17 + px, bk.cv + b * inner * 0.15 - inner * 0.04 + pz);
                bits.push({ t, x: pp.x, y: y + 0.3, z: pp.z, w: 0.08, h: 2.3, d: 0.08, yaw: t.theta, col: 0x55504a });
            }
        }
        return true;
    }

    // A church: nave, west tower and spire (instanced parts like any building), solid and destructible
    church(t, cu, cv, walls, gables, spires, bits, r) {
        const big = t.size !== 'village';
        const W = big ? 13 : 9, D = big ? 28 : 18, H = big ? 10 : 7;
        const c = this.tw(t, cu, cv);
        const corners = [[-W, -D * 0.7], [W, -D * 0.7], [W, D * 0.6], [-W, D * 0.6]].map(([a, b]) => this.tw(t, cu + a / 2, cv + b));
        if (corners.some(q => this.blocked(q.x, q.z) || terrainHeight(q.x, q.z) < 2)) return false;
        const hs = [c, ...corners].map(q => this.groundAt(q.x, q.z));
        if (Math.max(...hs) - Math.min(...hs) > 5) return false;
        const y = Math.min(...hs) - 0.6;
        (t.footprints || (t.footprints = [])).push({ u: cu, v: cv, hu: W / 2 + 4, hv: D * 0.75, gap: 1 });
        for (const q of corners) this.mark(q.x, q.z, 2);
        const col = r() < 0.5 ? 0xe9e2d2 : 0xc9b8a0, roofCol = r() < 0.6 ? 0x5a5f66 : 0x7a3a2a;
        const nave = { t, kind: 'church', x: c.x, z: c.z, y, w: W, d: D, ht: H + (Math.max(...hs) - Math.min(...hs)), yaw: t.theta, style: FACADE.church, flags: 0, col, roof: 'gable', roofCol, ridge: 'z', roofH: W * 0.55, floors: 1 };
        const tp = this.tw(t, cu, cv - D / 2 - W * 0.22);
        const TW = W * 0.45, TH = H * 2.3;
        const tower = { t, kind: 'church', part: nave, x: tp.x, z: tp.z, y, w: TW, d: TW, ht: TH + H * 0.2, yaw: t.theta, style: FACADE.church, flags: 0, col, roof: 'none', floors: 1 };
        walls.push(nave, tower);
        spires.push({ t, x: tp.x, y: y + tower.ht, z: tp.z, w: TW * 1.15, h: TH * 0.75, yaw: t.theta, col: roofCol, b: nave });
        const top = y + tower.ht + TH * 0.75;
        bits.push({ t, x: tp.x, y: top, z: tp.z, w: 0.3, h: 2.4, d: 0.3, yaw: t.theta, col: 0x3a3d40, b: nave }, { t, x: tp.x, y: top + 1.3, z: tp.z, w: 1.4, h: 0.3, d: 0.3, yaw: t.theta, col: 0x3a3d40, b: nave });
        nave.boxes = [{ x: c.x, z: c.z, w: W, d: D, y0: y, y1: y + nave.ht + W * 0.55, yaw: t.theta }, { x: tp.x, z: tp.z, w: TW, d: TW, y0: y, y1: top + 2, yaw: t.theta }];
        return true;
    }

    // Village water tower: a big tank up on legs
    waterTower(t, tryPlace, r) {
        for (let k = 0; k < 8; k++) {
            const a = r() * Math.PI * 2, d = t.radius * (0.55 + r() * 0.4);
            const u = Math.cos(a) * d, v = Math.sin(a) * d;
            const b = tryPlace(t, u, v, 8, 8, 0, { kind: 'watertower', ht: 0.1, style: FACADE.shed, flags: 0, col: 0x9aa0a4, roof: 'none', floors: 0, watertower: true });
            if (b) return b;
        }
        return null;
    }

    // A stadium just outside a city, where the ground is flat enough
    stadium(t, ground, r) {
        const A = 88, Bz = 68, H = 20;
        for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2 + r() * 0.2, d = t.radius + A + 30;
            const cx = t.x + Math.cos(a) * d, cz = t.z + Math.sin(a) * d, yaw = a + Math.PI / 2;
            const ca = Math.cos(yaw), sa = Math.sin(yaw);
            const pts = [];
            for (let q = 0; q < 12; q++) { const th = q / 12 * Math.PI * 2; const lx = Math.cos(th) * (A + 6), lz = Math.sin(th) * (Bz + 6); pts.push({ x: cx + lx * ca + lz * sa, z: cz - lx * sa + lz * ca }); }
            pts.push({ x: cx, z: cz });
            if (pts.some(q => this.blocked(q.x, q.z) || terrainHeight(q.x, q.z) < 3 || outsideBases(q.x, q.z))) continue;
            const hs = pts.map(q => terrainHeight(q.x, q.z));
            if (Math.max(...hs) - Math.min(...hs) > 22) continue;
            // it stands on a levelled platform (the drawn ground is cut and filled to it: see townBase)
            const y = hs.reduce((a, b) => a + b, 0) / hs.length;
            (this.pads || (this.pads = [])).push({ x: cx, z: cz, a: A + 14, b: Bz + 14, yaw, y: y + 0.2, blend: 45 });
            for (const q of pts) this.mark(q.x, q.z, 12);
            this.mark(cx, cz, 60);
            this.stadiums = this.stadiums || [];
            this.stadiums.push({ t, x: cx, z: cz, y, yaw, A, B: Bz, H, top: Math.max(...hs) });
            return;
        }
    }

    // A filling station beside one of the roads out of a town (or city)
    fillingStation(t, walls, bits, ground, r) {
        const roads = this.paths.filter(p => (p.startPort && p.startPort.path && p.startPort.path.t === t) || (p.endPort && p.endPort.path && p.endPort.path.t === t));
        const v = new THREE.Vector3(), tg = new THREE.Vector3();
        for (const p of roads) {
            const atStart = p.startPort && p.startPort.path && p.startPort.path.t === t;
            for (const dist of [110, 170, 240]) {
                if (dist > p.len - 60) continue;
                const s = atStart ? dist : p.len - dist;
                samplePath(p, s, v, tg);
                for (const side of [1, -1]) {
                    const rx = -tg.z * side, rz = tg.x * side;
                    const cx = v.x + rx * 25, cz = v.z + rz * 25, yaw = Math.atan2(tg.x, tg.z);
                    const ca = Math.cos(yaw), sa = Math.sin(yaw);
                    const at = (lx, lz) => ({ x: cx + lx * ca + lz * sa, z: cz - lx * sa + lz * ca });
                    const pts = [[-17, -13], [17, -13], [17, 13], [-17, 13], [0, 0], [0, 13], [0, -13]].map(([a, b]) => at(b, a));
                    if (pts.some(q => this.blocked(q.x, q.z) || terrainHeight(q.x, q.z) < 2)) continue;
                    const hs = pts.map(q => this.groundAt(q.x, q.z));
                    if (Math.max(...hs) - Math.min(...hs) > 3) continue;
                    const y = Math.max(...hs) + 0.15;
                    for (const q of pts) this.mark(q.x, q.z, 4);
                    const brand = [0xd8261e, 0x1f5fb8, 0x1f8a3c, 0xf2b01e][Math.floor(r() * 4)];
                    const rs = side > 0 ? 1 : -1; // the road is on the station's local +x (rs = 1) or -x side
                    // the forecourt runs right up to the road's edge
                    const fc = at(2.8 * rs, 0);
                    ground.push({ t, kind: 'forecourt', x: fc.x, z: fc.z, y, yaw, w: 31.6, d: 34, col: [0.42, 0.42, 0.43] });
                    // the shop at the back, its front to the road; the canopy over the pumps nearer the road
                    const sp = at(-9 * rs, 0);
                    const shop = { t, kind: 'station', x: sp.x, z: sp.z, y: y - 0.3, w: 16, d: 8, ht: 4.4, yaw: yaw + Math.PI / 2, style: FACADE.townhouse, flags: 1 | (rs > 0 ? 2 : 4), accent: 0.02, col: 0xe8e6df, roof: 'flat', front: rs, floors: 1, shop: 1, plinth: 0 };
                    walls.push(shop);
                    const cp = at(4 * rs, 0);
                    bits.push({ t, x: cp.x, y: y + 5.2, z: cp.z, w: 11, h: 0.9, d: 22, yaw, col: brand, b: shop });
                    for (const [a, b] of [[4 * rs - 4.5, -9], [4 * rs + 4.5, -9], [4 * rs - 4.5, 9], [4 * rs + 4.5, 9]]) { const q = at(a, b); bits.push({ t, x: q.x, y, z: q.z, w: 0.45, h: 5.3, d: 0.45, yaw, col: 0xdedcd6, b: shop }); }
                    for (const b of [-6, 0, 6]) {
                        const q = at(4 * rs, b);
                        bits.push({ t, x: q.x, y, z: q.z, w: 1.2, h: 0.25, d: 4.5, yaw, col: 0xbdbab2, b: shop });
                        bits.push({ t, x: q.x, y: y + 0.25, z: q.z, w: 0.7, h: 1.7, d: 0.9, yaw, col: brand, b: shop });
                    }
                    // the price sign on a pole by the road
                    const ps = at(12.5 * rs, 15);
                    bits.push({ t, x: ps.x, y, z: ps.z, w: 0.35, h: 6.5, d: 0.35, yaw, col: 0x6b6f72, b: shop }, { t, x: ps.x, y: y + 6.2, z: ps.z, w: 0.4, h: 2.6, d: 2.2, yaw, col: brand, b: shop });
                    shop.boxes = [{ x: sp.x, z: sp.z, w: 16, d: 8, y0: y - 0.3, y1: y + 4.4, yaw: yaw + Math.PI / 2 }, { x: cp.x, z: cp.z, w: 11, d: 22, y0: y + 5.1, y1: y + 6.2, yaw }];
                    return;
                }
            }
        }
    }

    // Roofs, rooftop plant, balconies, awnings, dormers and chimneys for every building placed
    decorate(walls, gables, hips, flats, bits, tanks, dormers, spires, r) {
        for (const b of walls) {
            const t = b.t, top = b.y + b.ht, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
            // building-local (x across w, z along d) → world
            const at = (lx, lz) => ({ x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c });
            if (b.watertower) {
                for (const [lx, lz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) { const q = at(lx, lz); bits.push({ t, x: q.x, y: b.y, z: q.z, w: 0.5, h: 22, d: 0.5, yaw: b.yaw, col: 0x7d8286, b }); }
                tanks.push({ t, x: b.x, y: b.y + 18, z: b.z, s: 10, sy: 12, yaw: b.yaw, col: 0xb9bec2, b });
                b.ht = 30; b.w = 9; b.d = 9;
                continue;
            }
            if (b.roof === 'gable' || b.roof === 'hip') {
                const alongZ = b.ridge === 'z';
                const rw = (alongZ ? b.d : b.w) * 1.1, rd = (alongZ ? b.w : b.d) * 1.14;
                const rh = b.roofH || (1.6 + Math.min(b.w, b.d) * 0.28);
                (b.roof === 'hip' ? hips : gables).push({ t, x: b.x, y: top, z: b.z, w: rw, d: rd, h: rh, yaw: b.yaw + (alongZ ? 0 : Math.PI / 2), col: b.roofCol, b });
                b.roofH = rh;
                if (b.kind === 'house') {
                    // a chimney, and dormers on the street side of some pitched roofs
                    if (r() < 0.6) { const q = at((r() - 0.5) * b.w * 0.6, (r() - 0.5) * b.d * 0.3); bits.push({ t, x: q.x, y: top + rh * 0.35, z: q.z, w: 0.7, h: rh * 0.85, d: 0.7, yaw: b.yaw, col: 0x7a4a3a, b }); }
                    if (b.roof === 'gable' && b.floors === 1 && r() < 0.45) {
                        for (const lx of b.w > 10 ? [-b.w * 0.2, b.w * 0.2] : [0]) {
                            const q = at(lx, b.front * b.d * 0.26);
                            dormers.push({ t, x: q.x, y: top + rh * 0.12, z: q.z, w: 1.9, h: 1.9, d: 2.2, yaw: b.yaw + (b.front > 0 ? 0 : Math.PI), col: b.col, b });
                        }
                    }
                } else if (b.kind === 'town' && r() < 0.5) {
                    const q = at(b.w * 0.3, 0); bits.push({ t, x: q.x, y: top + rh * 0.3, z: q.z, w: 0.6, h: rh, d: 0.6, yaw: b.yaw, col: 0x6b4a3a, b });
                }
            } else if (b.roof === 'flat') {
                flats.push({ t, x: b.x, y: top, z: b.z, w: b.w + 0.4, d: b.d + 0.4, yaw: b.yaw, b });
                // rooftop plant: AC units, a stair/lift housing, water tanks on the blocks, masts on the tallest
                const nAc = b.kind === 'house' ? 0 : b.tower ? 3 : 1 + Math.floor(r() * 2);
                for (let k = 0; k < nAc; k++) { const q = at((r() - 0.5) * b.w * 0.6, (r() - 0.5) * b.d * 0.6); const sz = b.tower ? 2.5 + r() * 2 : 1.4 + r(); bits.push({ t, x: q.x, y: top + 0.1, z: q.z, w: sz * 1.6, h: sz * 0.7, d: sz, yaw: b.yaw, col: 0x9da3a6, b }); }
                if (b.kind === 'apt' || b.tower) { const q = at(b.w * 0.2, -b.d * 0.15); bits.push({ t, x: q.x, y: top + 0.1, z: q.z, w: 4, h: 3.2, d: 3.5, yaw: b.yaw, col: b.col, b }); }
                if ((b.kind === 'apt' || b.kind === 'town') && r() < 0.45) { const q = at(-b.w * 0.25, b.d * 0.15); tanks.push({ t, x: q.x, y: top + 0.1, z: q.z, s: 2.6 + r(), yaw: b.yaw, col: r() < 0.5 ? 0x8a6a4a : 0xa9aeb2, b }); }
                if (b.tower && b.ht > 90) bits.push({ t, x: b.x, y: top, z: b.z, w: 0.5, h: 16 + b.ht * 0.1, d: 0.5, yaw: 0, col: 0xb8bcc0, b });
            }
            // downtown: the tallest towers step back near the top; the biggest gets a spire
            if (b.tower && b.ht > 70 && r() < 0.6) {
                const k = 0.62 + r() * 0.15, h2 = 8 + r() * 14;
                const crown = { t, kind: 'tower', part: b, x: b.x, z: b.z, y: top, w: b.w * k, d: b.d * k, ht: h2, yaw: b.yaw, style: b.style, flags: 0, col: b.col };
                walls.push(crown);
                flats.push({ t, x: b.x, y: top + h2, z: b.z, w: crown.w + 0.4, d: crown.d + 0.4, yaw: b.yaw, b });
                if (b.ht > 100) spires.push({ t, x: b.x, y: top + h2, z: b.z, w: Math.min(crown.w, crown.d) * 0.55, h: 18 + b.ht * 0.25, yaw: b.yaw, col: 0xb8bcc0, b });
                b.crownTop = top + h2;
            }
            // balconies on the apartment blocks: a slab and a parapet at every floor, front and back
            if (b.balconies) {
                const fh = 2.9, y0 = b.y + b.plinth + 0.5 + (b.shop ? 4.2 : fh);
                // not on a side that stands right on the pavement (they'd hang over the street)
                const sides = [1, -1].filter(sd => [-0.35, 0, 0.35].every(k => { const q = at(k * b.w, sd * (b.d / 2 + 1.4)); return !this.onStreet(q.x, q.z); }));
                for (let f = 0; y0 + f * fh < top - 2; f++) for (const sd of sides) {
                    const q = at(0, sd * (b.d / 2 + 0.6));
                    bits.push({ t, x: q.x, y: y0 + f * fh - 0.1, z: q.z, w: b.w * 0.72, h: 0.2, d: 1.2, yaw: b.yaw, col: 0xc8c4bc, b });
                    const q2 = at(0, sd * (b.d / 2 + 1.15));
                    bits.push({ t, x: q2.x, y: y0 + f * fh + 0.1, z: q2.z, w: b.w * 0.72, h: 0.95, d: 0.1, yaw: b.yaw, col: f % 2 ? 0xe8e6e0 : 0x9fb3bd, b });
                }
            }
            // shop awnings and entrance canopies on the street side
            if (b.shop && b.kind !== 'station') {
                const q = at(0, b.front * (b.d / 2 + 0.8));
                bits.push({ t, x: q.x, y: b.y + b.plinth + 0.5 + 3.1, z: q.z, w: b.w * 0.9, h: 0.15, d: 1.6, yaw: b.yaw, col: new THREE.Color().setHSL(b.accent || 0, 0.55, 0.45).getHex(), tilt: -0.15 * b.front, b });
            } else if ((b.kind === 'apt' || b.tower) && b.front) {
                const q = at(0, b.front * (b.d / 2 + 1.4));
                bits.push({ t, x: q.x, y: b.y + b.plinth + 0.5 + 3.2, z: q.z, w: b.tower ? 10 : 4, h: 0.3, d: 2.8, yaw: b.yaw, col: 0x5a5f64, b });
            }
        }
    }

    // Every part of every building into its per-town instanced mesh; the records know which instances are theirs
    draw({ walls, gables, hips, flats, bits, tanks, dormers, spires, trees, parks, ground }, B) {
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color(), e = new THREE.Euler(0, 0, 0, 'YXZ');
        const facade = makeFacadeMaterial();
        this.buildingMats = [facade];
        // a record per building (a church's tower and a tower's crown belong to their main part)
        for (const b of walls) {
            if (b.part) continue;
            b.rec = B.add({ x: b.x, z: b.z, y: b.y, w: b.w, d: b.d, ht: b.crownTop ? b.crownTop - b.y : b.ht, yaw: b.yaw, kind: b.kind, roofH: b.roofH || 0, boxes: b.boxes || (b.crownTop ? [{ x: b.x, z: b.z, w: b.w, d: b.d, y0: b.y, y1: b.y + b.ht, yaw: b.yaw }, { x: b.x, z: b.z, w: b.w * 0.8, d: b.d * 0.8, y0: b.y + b.ht, y1: b.crownTop, yaw: b.yaw }] : null) });
        }
        const recOf = (o) => (o.b ? (o.b.part ? o.b.part.rec : o.b.rec) : o.part ? o.part.rec : o.rec);
        const own = (o, im, i, role) => { const rec = recOf(o); if (rec) B.part(rec, im, i, role); };
        const unit = unitBox();
        // walls: one facade material for every kind, the style per instance
        this.perTown(unit, facade, walls.filter(b => !b.watertower), (im, i, o) => {
            own(o, im, i, 'wall');
            q.setFromAxisAngle(up, o.yaw);
            im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.w, o.ht, o.d)));
            im.setColorAt(i, c.setHex(o.col));
            im.geometry.attributes.aStyle.setXYZW(i, o.style, o.flags || 0, o.accent || 0, (o.x * 0.013 + o.z * 0.007) % 1);
        }, { attrs: (n) => ({ aStyle: new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4) }) });
        const roofMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
        // the roof prism's ridge runs along its local z: o.yaw points it, o.w is its length, o.d the span
        const roofWrite = (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw);
            im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.d, o.h, o.w)));
            im.setColorAt(i, c.setHex(o.col));
        };
        this.perTown(gableGeometry(), roofMat, gables, roofWrite);
        this.perTown(hipGeometry(), roofMat, hips, roofWrite);
        this.perTown(unit, new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.9 }), flats, (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw); im.setMatrixAt(i, m.compose(p.set(o.x, o.y - 0.25, o.z), q, s.set(o.w, 0.7, o.d)));
            im.setColorAt(i, c.setHex(0xffffff));
        });
        // small things are only worth drawing within a few km
        const bitMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.1 });
        this.perTown(unit, bitMat, bits, (im, i, o) => {
            own(o, im, i);
            e.set(o.tilt || 0, o.yaw, 0); q.setFromEuler(e);
            im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.w, o.h, o.d)));
            im.setColorAt(i, c.setHex(o.col));
        }, { far: 4000 });
        this.perTown(tankGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.3 }), tanks, (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw); im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.s, o.sy || o.s, o.s)));
            im.setColorAt(i, c.setHex(o.col));
        }, { far: 6000 });
        this.perTown(dormerGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.8 }), dormers, (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw); im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.w, o.h, o.d)));
            im.setColorAt(i, c.setHex(o.col));
        }, { far: 3000 });
        this.perTown(spireGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.4 }), spires, (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw); im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.w, o.h, o.w)));
            im.setColorAt(i, c.setHex(o.col));
        });
        // parks (lawns, trees, sometimes a pond) and plazas / forecourts: one vertex-coloured ground mesh per town
        for (const pk of parks) {
            ground.push({ t: pk.t, kind: 'lawn', cu: pk.cu, cv: pk.cv, size: pk.size, col: [0.31, 0.54, 0.24] });
            const pond = this.rand() < 0.35;
            if (pond) ground.push({ t: pk.t, kind: 'pond', cu: pk.cu + pk.size * 0.12, cv: pk.cv - pk.size * 0.1, size: pk.size * 0.32, col: [0.2, 0.34, 0.42] });
            for (let k = 0; k < 9; k++) {
                const du = (this.rand() - 0.5) * pk.size * 0.85, dv = (this.rand() - 0.5) * pk.size * 0.85;
                if (pond && Math.hypot(du - pk.size * 0.12, dv + pk.size * 0.1) < pk.size * 0.22) continue;
                const tp = this.tw(pk.t, pk.cu + du, pk.cv + dv);
                trees.push({ x: tp.x, z: tp.z, s: 0.6 + this.rand() * 0.5, t: pk.t });
            }
        }
        this.drawGround(ground);
        if (this.world && this.world.treeGeo && trees.length) {
            this.perTown(this.world.treeGeo, this.world.treeMat, trees, (im, i, o) => {
                q.setFromAxisAngle(up, this.rand() * 6.28); im.setMatrixAt(i, m.compose(p.set(o.x, this.groundAt(o.x, o.z) - 0.5, o.z), q, s.set(o.s, o.s, o.s)));
            }, { shadow: false, far: 12000 });
        }
        for (const st of this.stadiums || []) this.drawStadium(st, B);
    }

    // lawns, ponds, plazas and forecourts of a group of towns (see perTown) as one mesh (vertex colours), draped on
    // the graded ground
    drawGround(list) {
        const byTown = new Map();
        for (const o of list) {
            const k = Math.floor(o.t.x / TOWN_CELL) * 1000 + Math.floor(o.t.z / TOWN_CELL);
            if (!byTown.has(k)) byTown.set(k, []);
            byTown.get(k).push(o);
        }
        const mat = liftWithDistance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: offsetUnits(-2) }));
        for (const items of byTown.values()) {
            const pos = [], col = [], idx = [];
            for (const o of items) {
                const t = o.t;
                const N = o.kind === 'pond' ? 10 : 5;
                const base = pos.length / 3;
                const lift = o.kind === 'pond' ? 0.36 : o.kind === 'lawn' ? 0.3 : 0.33;
                for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
                    let a = i / N - 0.5, b = j / N - 0.5;
                    if (o.kind === 'pond') { const ang = Math.atan2(b, a), rr = Math.max(Math.abs(a), Math.abs(b)) * (0.85 + 0.15 * Math.sin(ang * 3)); a = Math.cos(ang) * rr; b = Math.sin(ang) * rr * 0.75; }
                    let x, z;
                    if (o.cu !== undefined) { const w = this.tw(t, o.cu + a * o.size, o.cv + b * o.size); x = w.x; z = w.z; }
                    else { const cy = Math.cos(o.yaw), sy = Math.sin(o.yaw), lx = a * o.w, lz = b * o.d; x = o.x + lx * cy + lz * sy; z = o.z - lx * sy + lz * cy; }
                    pos.push(x, o.y !== undefined ? o.y : this.groundAt(x, z) + lift, z);
                    const v = 0.93 + ((i * 7 + j * 13) % 5) * 0.03;
                    col.push((o.col[0] * v) ** 2.2, (o.col[1] * v) ** 2.2, (o.col[2] * v) ** 2.2); // authored in sRGB
                }
                for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = base + j * (N + 1) + i; idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2); }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
            g.setIndex(idx);
            // make every quad face up whatever the grid's handedness
            const P = g.attributes.position.array, I = g.index.array;
            for (let k = 0; k < I.length; k += 3) {
                const a = I[k] * 3, b = I[k + 1] * 3, c2 = I[k + 2] * 3;
                const ny = (P[b + 2] - P[a + 2]) * (P[c2] - P[a]) - (P[b] - P[a]) * (P[c2 + 2] - P[a + 2]);
                if (ny < 0) { const tmp = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = tmp; }
            }
            g.computeVertexNormals();
            const mesh = new THREE.Mesh(g, mat);
            mesh.receiveShadow = true;
            this.group.add(mesh);
        }
    }

    // A stadium: oval bowl of stands under a roof ring, the pitch, four floodlight masts (one merged mesh)
    drawStadium(st, B) {
        const { A, B: Bz, H } = st, SEG = 48, parts = [];
        const colored = (g, hex) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); const cc = new THREE.Color(hex), a = new Float32Array(n.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = cc.r; a[i + 1] = cc.g; a[i + 2] = cc.b; } n.setAttribute('color', new THREE.BufferAttribute(a, 3)); return n; };
        const ring = (a0, b0, y0, a1, b1, y1, hex) => {
            const pos = [];
            for (let k = 0; k < SEG; k++) {
                const t0 = k / SEG * Math.PI * 2, t1 = (k + 1) / SEG * Math.PI * 2;
                const P = (a, b, y, t) => [Math.cos(t) * a, y, Math.sin(t) * b];
                const p00 = P(a0, b0, y0, t0), p01 = P(a0, b0, y0, t1), p10 = P(a1, b1, y1, t0), p11 = P(a1, b1, y1, t1);
                pos.push(...p00, ...p10, ...p01, ...p01, ...p10, ...p11);
            }
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
            return colored(g, hex);
        };
        parts.push(ring(A, Bz, 0, A, Bz, H, 0xd2cec4));                    // outer wall (outward)
        parts.push(ring(A - 1, Bz - 1, H, A - 1, Bz - 1, 0, 0xb8b4aa));    // inner face of the wall
        parts.push(ring(A * 0.62, Bz * 0.6, 1.5, A - 1, Bz - 1, H - 2, 0x8a3a3a)); // the stands, climbing outward
        parts.push(ring(A - 16, Bz - 14, H + 1.5, A + 1.5, Bz + 1.5, H + 2.5, 0xeeeeea)); // roof ring
        parts.push(ring(A + 1.5, Bz + 1.5, H + 2.5, A - 16, Bz - 14, H + 1.5, 0xc8c8c4)); // its underside
        const pitch = new THREE.PlaneGeometry(A * 1.15, Bz * 1.05, 8, 1); pitch.rotateX(-Math.PI / 2); pitch.translate(0, 1, 0);
        const pc = colored(pitch, 0x3f8a3a);
        { const P = pc.attributes.position.array, C = pc.attributes.color.array; for (let i = 0; i < P.length / 3; i++) { if (Math.floor((P[i * 3] / (A * 1.15) + 0.5) * 8) % 2) { C[i * 3] *= 1.12; C[i * 3 + 1] *= 1.12; C[i * 3 + 2] *= 1.12; } } }
        parts.push(pc);
        for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            const mast = new THREE.BoxGeometry(1.2, H + 22, 1.2); mast.translate(sx * A * 0.72, (H + 22) / 2, sz * Bz * 0.72); parts.push(colored(mast, 0x9a9ea2));
            const lamp = new THREE.BoxGeometry(6, 3, 1); lamp.translate(sx * A * 0.72, H + 21, sz * Bz * 0.72); parts.push(colored(lamp, 0xf4f2e8));
        }
        const g = mergeGeos(parts);
        const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
        mesh.position.set(st.x, st.y - 0.4, st.z); mesh.rotation.y = st.yaw;
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.group.add(mesh);
        const rec = B.add({ x: st.x, z: st.z, y: st.y, w: st.A * 2, d: st.B * 1.4, ht: H + 2.5, yaw: st.yaw, kind: 'stadium', boxes: [{ x: st.x, z: st.z, w: st.A * 2, d: st.B * 1.4, y0: st.y, y1: st.y + H + 2.5, yaw: st.yaw }, { x: st.x, z: st.z, w: st.A * 1.4, d: st.B * 2, y0: st.y, y1: st.y + H + 2.5, yaw: st.yaw }] });
        B.partMesh(rec, mesh);
        (this.landmarks || (this.landmarks = [])).push(mesh);
    }

    buildDriveways(list) {
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
        const slab = new THREE.BoxGeometry(1, 1, 1); slab.translate(0, 0.5, 0);
        this.perTown(slab, new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.95 }), list, (im, i, o) => {
            q.setFromAxisAngle(up, o.yaw);
            im.setMatrixAt(i, m.compose(p.set(o.x, this.groundAt(o.x, o.z) - 0.3, o.z), q, s.set(3.6, 0.75, o.len)));
        }, { shadow: false, far: 3500 });
        // parked cars
        // one or two cars per driveway (two parked nose to tail)
        const cars = [];
        for (const o of list) {
            if (o.cars === 1) cars.push({ ...o, off: 0 });
            else if (o.cars === 2) { cars.push({ ...o, off: -2.7 }); cars.push({ ...o, off: 2.7, hue: o.hue2, flip: !o.flip }); }
        }
        const set = new CarSet(this.group, Math.max(1, cars.length), mulberry32(5150), { castShadow: false, allowSpecial: false });
        cars.forEach((o, i) => {
            q.setFromAxisAngle(up, o.yaw + (o.flip ? Math.PI : 0));
            const ox = o.x - Math.sin(o.yaw) * o.off, oz = o.z - Math.cos(o.yaw) * o.off;
            m.compose(p.set(ox, this.groundAt(ox, oz) + 0.45, oz), q, s.set(1, 1, 1));
            set.setMatrix(i, m);
            set.setPaint(i, PAINTS[Math.floor(o.hue * PAINTS.length)]);
        });
        this.parkedSet = set; // uploaded near the camera only (see update)
        this.parkedCars = cars.length;
    }

    // People walking the sidewalks (instanced; a gentle bob sells the walk from the air)
    buildPeople() {
        const r = mulberry32(4242);
        const streets = this.streetPaths.filter(p => p.len > 60);
        const total = streets.reduce((a, p) => a + p.len, 0);
        const n = Math.min(1400, Math.floor(total / 55));
        const body = new THREE.CylinderGeometry(0.22, 0.2, 1.05, 6); body.translate(0, 1.05, 0);
        const head = new THREE.SphereGeometry(0.14, 6, 5); head.translate(0, 1.72, 0);
        const legs = new THREE.CylinderGeometry(0.16, 0.12, 0.55, 5); legs.translate(0, 0.28, 0);
        const merge = (g, col) => { const cols = []; for (let i = 0; i < g.attributes.position.count; i++) cols.push(col.r, col.g, col.b); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); return g.index ? g.toNonIndexed() : g; };
        const white = new THREE.Color(1, 1, 1), skin = new THREE.Color(0.78, 0.6, 0.48), dark = new THREE.Color(0.18, 0.19, 0.22);
        void white;
        // shirts take a per-person colour; heads and legs are shared
        this.people = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.85 }), Math.max(1, n));
        this.peopleRest = new THREE.InstancedMesh(mergeGeos([merge(head, skin), merge(legs, dark)]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), Math.max(1, n));
        for (const im of [this.people, this.peopleRest]) { im.frustumCulled = false; im.castShadow = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
        const SHIRTS = [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0xecf0f1, 0x8e44ad, 0x34495e, 0xe67e22, 0x16a085, 0xd35400];
        this.walkers = [];
        const c = new THREE.Color();
        for (let i = 0; i < n; i++) {
            let x = r() * total, path = streets[0];
            for (const p of streets) { x -= p.len; if (x <= 0) { path = p; break; } }
            this.walkers.push({ path, s: r() * path.len, dir: r() < 0.5 ? 1 : -1, side: r() < 0.5 ? 1 : -1, speed: 1.1 + r() * 0.6, ph: r() * 6.28, h: 0.9 + r() * 0.2, shirt: SHIRTS[Math.floor(r() * SHIRTS.length)] });
            this.people.setColorAt(i, c.setHex(this.walkers[i].shirt));
        }
        this.people.count = this.peopleRest.count = n;
        this.group.add(this.people, this.peopleRest);
    }

    // an explosion (or a crash) at `at`: people close by are killed, everyone within a few hundred metres runs
    // away from it along their pavement
    panic(at, R) {
        if (!this.walkers) return;
        const run = Math.max(90, R * 6), kill = Math.max(4, R * 0.7);
        for (const w of this.walkers) {
            if (w.dead || w.x === undefined) continue;
            const dx = w.x - at.x, dz = w.z - at.z, d2 = dx * dx + dz * dz;
            if (d2 > run * run) continue;
            if (d2 < kill * kill && Math.abs((w.y ?? at.y) - at.y) < 12) { w.dead = true; continue; }
            samplePath(w.path, w.s, _v, _t2);
            w.dir = _t2.x * dx + _t2.z * dz >= 0 ? 1 : -1;
            w.panic = 7 + Math.random() * 8;
            w.run = 3.6 + Math.random() * 2;
        }
    }
    resetPeople() { for (const w of this.walkers || []) { w.dead = false; w.panic = 0; } }

    updatePeople(dt, cam) {
        if (!this.people) return;
        const T = this._pt || (this._pt = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), t: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), c: new THREE.Color() });
        const { m, q, s, p, t, up } = T;
        const R2 = 1800 * 1800;
        const lie = T.lie || (T.lie = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
        let k = 0;
        for (const w of this.walkers) {
            // running from an explosion for a while, then back to a stroll
            const run = w.panic > 0;
            if (run) w.panic -= dt;
            if (!w.dead) {
                w.s += w.dir * (run ? w.run : w.speed) * dt;
                if (w.s < 1 || w.s > w.path.len - 1) { w.dir = -w.dir; w.s = Math.max(1, Math.min(w.path.len - 1, w.s)); }
            }
            // too far away to see: just keep walking, don't draw
            if (cam && w.x !== undefined && (w.x - cam.x) ** 2 + (w.z - cam.z) ** 2 > R2) continue;
            samplePath(w.path, w.s, p, t);
            w.x = p.x; w.z = p.z; w.y = p.y;
            const i = k++;
            // on the pavement on one side of the street
            const lat = (STREET_HALF + 1.4) * w.side;
            p.x += -t.z * lat; p.z += t.x * lat;
            w.ph += dt * (run ? w.run * 3.4 : w.speed * 5.5);
            p.y += (p.g || 0) * lat + (w.dead ? 0.22 : Math.abs(Math.sin(w.ph)) * (run ? 0.14 : 0.06)); // the pavement's height
            q.setFromAxisAngle(up, Math.atan2(-t.x * w.dir, -t.z * w.dir));
            if (w.dead) q.multiply(lie); // flat on the pavement
            else if (run) q.multiply(_q.setFromAxisAngle(_ax.set(1, 0, 0), -0.25)); // leaning into the run
            m.compose(p, q, s.set(1, w.h, 1));
            m.toArray(this.people.instanceMatrix.array, i * 16);
            m.toArray(this.peopleRest.instanceMatrix.array, i * 16);
            T.c.setHex(w.shirt).toArray(this.people.instanceColor.array, i * 3);
        }
        const was = this.people.count;
        this.people.count = this.peopleRest.count = k;
        this.people.visible = this.peopleRest.visible = k > 0;
        if (!k && !was) return;
        // upload only the walkers actually drawn
        for (const [attr, n] of [[this.people.instanceMatrix, k * 16], [this.peopleRest.instanceMatrix, k * 16], [this.people.instanceColor, k * 3]]) {
            attr.clearUpdateRanges();
            if (n) attr.addUpdateRange(0, n);
            attr.needsUpdate = n > 0;
        }
    }

    // Road closed / road works / bridge out: barriers, cones and a sign wherever a road stops short
    buildRoadblocks(list) {
        const r = mulberry32(31337);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
        const stripe = canvasTex(256, 32, (ctx, w, h) => { for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f4f4f0' : '#d0201a'; ctx.beginPath(); ctx.moveTo(i * 32, h); ctx.lineTo(i * 32 + 16, 0); ctx.lineTo(i * 32 + 48, 0); ctx.lineTo(i * 32 + 32, h); ctx.fill(); } }, false);
        const signTex = (text, bg, fg) => canvasTex(256, 160, (ctx, w, h) => {
            ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = fg; ctx.lineWidth = 10; ctx.strokeRect(8, 8, w - 16, h - 16);
            ctx.fillStyle = fg; ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const lines = text.split('\n'); lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 50));
        }, false);
        const SIGNS = { closed: signTex('ROAD\nCLOSED', '#f4f4ee', '#c4161c'), works: signTex('ROAD WORK\nAHEAD', '#ff8a1c', '#141414'), water: signTex('END OF\nROAD', '#f4f4ee', '#c4161c') };
        const plankGeo = new THREE.BoxGeometry(1, 0.45, 0.12); plankGeo.translate(0, 0, 0);
        const postGeo = new THREE.BoxGeometry(0.12, 1.2, 0.12); postGeo.translate(0, 0.6, 0);
        const coneGeo = new THREE.ConeGeometry(0.28, 0.75, 10); coneGeo.translate(0, 0.37, 0);
        const signGeo = new THREE.PlaneGeometry(2.2, 1.4); signGeo.translate(0, 2.2, 0);
        const planks = [], posts = [], cones = [], signs = { closed: [], works: [], water: [] };
        for (const d of list) {
            const L = Math.hypot(d.dx, d.dz) || 1, fx = d.dx / L, fz = d.dz / L; // outward (the way the road would have gone)
            const rx = -fz, rz = fx;
            const yaw = Math.atan2(-fx, -fz);
            const kind = d.reason === 'water' ? 'water' : r() < 0.5 ? 'works' : 'closed';
            const bx = d.x - fx * 3, bz = d.z - fz * 3;
            const y = (d.path ? samplePath(d.path, d.end ? d.path.len - 3 : 3, _v).y : this.groundAt(bx, bz) + 0.3) - 0.05;
            // barrier across the whole road
            const W = d.w * 2 + 1;
            planks.push([bx, y + 1.0, bz, yaw, W], [bx, y + 0.45, bz, yaw, W]);
            for (const o of [-d.w, 0, d.w]) posts.push([bx + rx * o, y, bz + rz * o, yaw]);
            // sign on the barrier, facing the traffic that arrives here
            signs[kind].push([bx - fx * 0.3, y, bz - fz * 0.3, yaw]);
            // a line of cones in front for road works (and a few anyway)
            const nc = kind === 'works' ? 6 : 3;
            for (let k = 0; k < nc; k++) {
                const t = (k / (nc - 1) - 0.5) * d.w * 1.6, back = 6 + (k % 2) * 2;
                const cx = bx - fx * back + rx * t, cz = bz - fz * back + rz * t;
                const cy = d.path ? samplePath(d.path, d.end ? d.path.len - 3 - back : 3 + back, _v).y - 0.05 : y;
                cones.push([cx, cy, cz, 0]);
            }
        }
        const add = (geo, mat, list, scaleW) => {
            if (!list.length) return;
            const set = this.near(geo, mat, list.length, { castShadow: true });
            for (const [x, y, z, yaw, w] of list) set.add(m.compose(p.set(x, y, z), q.setFromAxisAngle(up, yaw), scaleW ? s.set(w, 1, 1) : one));
        };
        add(plankGeo, new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 }), planks, true);
        add(postGeo, new THREE.MeshStandardMaterial({ color: 0x555a5e, roughness: 0.6 }), posts);
        add(coneGeo, new THREE.MeshStandardMaterial({ color: 0xff6a10, roughness: 0.6 }), cones);
        for (const k of Object.keys(signs)) add(signGeo, new THREE.MeshStandardMaterial({ map: SIGNS[k], roughness: 0.6, side: THREE.DoubleSide }), signs[k]);
        this.roadblockCount = list.length;
    }

    // Street lamps along town streets (glow at night)
    buildLamps() {
        const pts = [];
        const v = new THREE.Vector3(), tg = new THREE.Vector3();
        for (const p of this.streetPaths) {
            let side = 1;
            for (let s = 20; s < p.len - 10; s += 44) {
                side = -side; // alternate sides of the street
                if (p.jcuts && p.jcuts.some(([a, b]) => s > a - 4 && s < b + 4)) continue; // not in a junction box
                samplePath(p, s, v, tg);
                const lat = (STREET_HALF + 1.6) * side, x = v.x - tg.z * lat, z = v.z + tg.x * lat;
                if (terrainHeight(x, z) < 2) continue;
                pts.push({ x, z, y: v.y + (v.g || 0) * lat, rx: tg.z * side, rz: -tg.x * side });
            }
        }
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.11, 7, 5); poleGeo.translate(0, 3.5, 0);
        const poles = this.near(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3b3f44, metalness: 0.5, roughness: 0.5 }), Math.max(1, pts.length));
        const m = new THREE.Matrix4();
        const glow = [];
        for (const o of pts) {
            poles.add(m.makeTranslation(o.x, o.y - 0.05, o.z));
            glow.push(o.x + o.rx * 1.2, o.y + 6.9, o.z + o.rz * 1.2);
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(glow, 3));
        this.lampGlow = new THREE.Points(lg, new THREE.PointsMaterial({
            map: makeRadialTexture(32, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,225,170,0.6)'], [1, 'rgba(255,190,110,0)']]),
            color: new THREE.Color(1.6, 1.2, 0.7), size: 5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
        }));
        this.lampGlow.visible = false;
        this.lampGlow.frustumCulled = false;
        this.group.add(this.lampGlow);
    }

    // Dirt trails wandering from town edges into the hills and along the coast
    buildDirtTrails() {
        const r = mulberry32(777);
        const trails = [];
        for (const t of this.towns) {
            if (t.size === 'city' || r() < 0.4) continue;
            let ang = r() * Math.PI * 2;
            let x = t.x + Math.sin(ang) * (t.radius + 25), z = t.z + Math.cos(ang) * (t.radius + 25);
            if (this.blocked(x, z)) continue;
            const pts = [{ x, z }];
            const steps = 60 + Math.floor(r() * 70);
            for (let k = 0; k < steps; k++) {
                let ok = false;
                for (let tries = 0; tries < 8 && !ok; tries++) {
                    const a = ang + (r() - 0.5) * (0.6 + tries * 0.35);
                    const nx = x + Math.sin(a) * 22, nz = z + Math.cos(a) * 22;
                    const h = terrainHeight(nx, nz);
                    if (h < 1.5 || slopeAt(nx, nz) > 0.32 || outsideBases(nx, nz) || this.towns.some(o => Math.hypot(nx - o.x, nz - o.z) < o.radius)) continue;
                    x = nx; z = nz; ang = a + (r() - 0.5) * 0.2; ok = true;
                }
                if (!ok) break;
                pts.push({ x, z });
            }
            if (pts.length < 25) continue;
            let s = 0;
            const P = pts.map((q, i) => { if (i) s += Math.hypot(q.x - pts[i - 1].x, q.z - pts[i - 1].z); return { x: q.x, y: this.groundAt(q.x, q.z) + 0.3, z: q.z, g: 0, s }; });
            trails.push({ pts: P, len: s, bridges: [], dirt: true, stops: [] });
        }
        const tex = canvasTex(64, 128, (ctx, w, h) => {
            ctx.fillStyle = '#8a6f4d'; ctx.fillRect(0, 0, w, h);
            for (let i = 0; i < 900; i++) { const v = 90 + Math.random() * 60; ctx.fillStyle = `rgba(${v},${Math.round(v * 0.8)},${Math.round(v * 0.55)},0.5)`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
            ctx.fillStyle = 'rgba(80,60,40,0.55)'; ctx.fillRect(14, 0, 8, h); ctx.fillRect(42, 0, 8, h);
            ctx.fillStyle = 'rgba(110,140,70,0.45)'; ctx.fillRect(28, 0, 8, h);
        });
        const pos = [], uv = [], idx = [];
        const HW = 3.2;
        for (const tr of trails) {
            let prev = null;
            tr.pts.forEach((P, k) => {
                const Q = tr.pts[Math.min(k + 1, tr.pts.length - 1)], O = tr.pts[Math.max(k - 1, 0)];
                let tx = Q.x - O.x, tz = Q.z - O.z; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
                const lx = P.x + tz * HW, lz = P.z - tx * HW, Rx = P.x - tz * HW, Rz = P.z + tx * HW;
                const base = pos.length / 3;
                pos.push(lx, P.y - 0.05, lz, Rx, P.y - 0.05, Rz);
                uv.push(0, P.s / 12, 1, P.s / 12);
                if (prev !== null) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
                prev = base;
            });
            this.markPath(tr.pts, 4.5);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, liftWithDistance(new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: offsetUnits(-4), side: THREE.DoubleSide })));
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.dirtGeo = trails.length ? g : null;
        return trails;
    }

    // Deck height of a standing bridge under (x, z) for something at height y, or null
    bridgeAt(x, z, y) {
        for (const b of this.bridges) { const h = b.deckAt(x, z, y); if (h != null) return h; }
        return null;
    }

    update(dt, cam) {
        this.time += dt;
        this.bridgeBatch.update(); // bridges reset for a new sortie
        if (this.buildings) this.buildings.update(dt, cam);
        // parked cars: re-pick the ones near the camera when it has moved a fair way
        // (and the street furniture, and which towns' rooftop clutter / trees are close enough to draw)
        if (cam && (!this._parkAt || this._parkAt.distanceToSquared(cam) > 150 * 150)) {
            this._parkAt = (this._parkAt || new THREE.Vector3()).copy(cam);
            if (this.parkedSet) this.parkedSet.commit(cam, 2200);
            for (const set of this.nearSets || []) set.commit(cam, 2000);
            for (const im of this.townMeshes || []) {
                const sp = im.boundingSphere, far = im.userData.far;
                if (far < Infinity) im.visible = Math.hypot(sp.center.x - cam.x, sp.center.z - cam.z) - sp.radius < far;
            }
        }
        this.updatePeople(dt, cam);
        if (!this.lamps) return;
        let dirty = false;
        for (const it of this.junctions) {
            if (it.type !== 'light') continue;
            for (const h of it.heads) {
                const st = this.lightState(it, h.axis);
                if (h.state !== st) { h.state = st; this.lamps.setColor(h.idx, this.lampColors[st]); dirty = true; }
            }
        }
        if (dirty) this.lamps.refreshColors();
    }

    setNight(on) {
        if (this.lampGlow) this.lampGlow.visible = on;
        for (const m of this.buildingMats || []) m.userData.night.value = on ? 1 : 0;
        if (this.traffic) this.traffic.setNight(on);
        if (this.buildings) this.buildings.setNight(on);
        setBridgeNight(on);
    }
}

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
import { setBridgeNight } from './bridges.js';
import { Buildings } from './buildings.js';
import { CarSet, PAINTS, NearInstances } from './carset.js';

const EXTENT = 24000, CELL = 3200;
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

    // [smoothed height, weight 0..1] at world (x, z), or null outside
    sample(x, z) {
        const t = this.t, dx = x - t.x, dz = z - t.z;
        if (dx * dx + dz * dz > this.ext2) return null;
        const u = dx * t.bx.x + dz * t.bx.z, v = dx * t.ax.x + dz * t.ax.z;
        const fi = u / this.C + this.n, fj = v / this.C + this.n, N = this.N;
        const i = Math.max(0, Math.min(N - 2, Math.floor(fi))), j = Math.max(0, Math.min(N - 2, Math.floor(fj)));
        const a = Math.max(0, Math.min(1, fi - i)), b = Math.max(0, Math.min(1, fj - j));
        const k = j * N + i;
        const bil = (A) => (A[k] * (1 - a) + A[k + 1] * a) * (1 - b) + (A[k + N] * (1 - a) + A[k + N + 1] * a) * b;
        const w = smooth01((bil(this.M) - 0.15) / 0.6);
        return w > 0 ? [bil(this.H), w] : null;
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
    has(cx, cz) { const c = this.chunk(cx, cz, false); if (!c) return false; const b = ((cz & 63) << 6) | (cx & 63); return (c[b >> 5] & (1 << (b & 31))) !== 0; }
}

const _v = new THREE.Vector3();
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

// ── Building material with shader-drawn windows (per-instance, in metres) ──
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

// Gable roof: a prism along z (unit size, base at y = 0)
function gableGeometry() {
    const g = new THREE.BufferGeometry();
    const v = [
        -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5,
        0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, 0.5,
        -0.5, 0, 0.5, -0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
        0.5, 0, -0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
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
        this.townCell = new Map(); // towns by 1 km cell (for townBase)
        for (const t of this.towns) {
            t.surf = new TownSurface(t, this.streetDefs.filter(sd => sd.t === t));
            const e = Math.sqrt(t.surf.ext2) + 12;
            for (let cx = Math.floor((t.x - e) / 1000); cx <= Math.floor((t.x + e) / 1000); cx++)
                for (let cz = Math.floor((t.z - e) / 1000); cz <= Math.floor((t.z + e) / 1000); cz++) {
                    const k = cx * 100003 + cz;
                    if (!this.townCell.has(k)) this.townCell.set(k, []);
                    this.townCell.get(k).push(t);
                }
        }
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
        for (const p of paths) { p.half = ROAD_HALF; }
        this.roadJunctions();
        this.shapeJunctions();
        const surfaces = this.buildSurfaces();
        for (const p of paths) this.markPath(p.pts, ROAD_HALF + 3);
        for (const p of this.streetPaths) this.markPath(p.pts, WALK + 0.3);
        for (const J of this.junctions) for (const [x, z] of J.ring || J.poly) this.mark(x, z, 1.5);
        this.dirtPaths = this.buildDirtTrails();
        surfaces.push(this.dirtGeo);
        this.buildSignals();
        this.buildBuildings();
        this.buildLamps();
        this.buildPeople();
        this.buildRoadblocks(this.deadEnds);
        this.traffic = new Traffic(this.group, [...paths, ...this.streetPaths], this.dirtPaths, this);
        for (const p of this.dirtPaths) p.half = 3.2;
        this.ground = new RoadGround([...paths, ...this.streetPaths, ...this.dirtPaths], (x, z, h) => this.townBase(x, z, h));
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
    // natural height h at (x, z) → the graded ground (inside towns), else h
    townBase(x, z, h) {
        if (h < 0.5) return h;
        const l = this.townCell.get(Math.floor(x / 1000) * 100003 + Math.floor(z / 1000));
        if (l) for (const t of l) {
            const s = t.surf.sample(x, z);
            if (s) return h + (s[0] - h) * s[1];
        }
        return h;
    }
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

    // One InstancedMesh per town for a kind of building part, each with its own tight bounding sphere,
    // so towns out of view (or out of the small shadow frustum) cost nothing. `far`: not drawn beyond this.
    perTown(geo, mat, list, write, { shadow = true, far = Infinity } = {}) {
        const byTown = new Map();
        for (const o of list) { if (!byTown.has(o.t)) byTown.set(o.t, []); byTown.get(o.t).push(o); }
        const out = [];
        for (const items of byTown.values()) {
            const im = new THREE.InstancedMesh(geo, mat, items.length);
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
    buildBuildings() {
        const r = mulberry32(99);
        const items = { house: [], town: [], apt: [], tower: [] };
        const roofs = [], flatRoofs = [], acUnits = [], trees = [], parks = [], specials = [], driveways = [];
        const tryPlace = (t, u, v, w, d, rot, kind, ht) => {
            // the whole footprint must be on dry, fairly flat land and clear of every road and street
            const c = this.tw(t, u, v);
            const ca = Math.cos(rot), sa = Math.sin(rot);
            const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0], [0, -d / 2], [0, d / 2]].map(([a, b]) => this.tw(t, u + a * ca - b * sa, v + a * sa + b * ca));
            let hmin = Infinity, hmax = -Infinity;
            for (const q of corners) {
                if (this.blocked(q.x, q.z)) return false;
                if (terrainHeight(q.x, q.z) < 2) return false;
                const h = this.groundAt(q.x, q.z); // the town's graded ground
                hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
            }
            if (hmax - hmin > Math.max(3, w * 0.25)) return false;
            // lots are axis-aligned in the town grid: keep a 2 m gap to every footprint already placed
            const sw = Math.abs(Math.sin(rot)) > 0.5, hu = (sw ? d : w) / 2 + 1, hv = (sw ? w : d) / 2 + 1;
            const fp = t.footprints || (t.footprints = []);
            if (fp.some(f => Math.abs(f.u - u) < f.hu + hu && Math.abs(f.v - v) < f.hv + hv)) return false;
            fp.push({ u, v, hu, hv });
            for (const q of corners) this.mark(q.x, q.z, 2);
            items[kind].push({ x: c.x, z: c.z, y: hmin - 0.6, w, d, ht: ht + (hmax - hmin), yaw: t.theta + rot, hue: r(), t });
            return true;
        };
        for (const t of this.towns) {
            const S = t.S, inner = S - WALK * 2 - 4; // lots start 2 m behind the pavement
            const n = t.size === 'village' ? 1 : t.n;
            let church = false;
            for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
                const cu = (i + 0.5) * S, cv = (j + 0.5) * S;
                const dist = Math.hypot(cu, cv);
                if (dist > t.radius - S * 0.3) continue;
                const rel = dist / t.radius;
                const zone = t.size === 'city' ? (rel < 0.3 ? 'tower' : rel < 0.55 ? 'apt' : rel < 0.75 ? 'town' : 'house')
                    : t.size === 'town' ? (rel < 0.32 ? 'town' : 'house') : 'house';
                if (t.size !== 'village' && !church && rel < 0.55 && r() < 0.3) {
                    const c = this.tw(t, cu, cv);
                    if (!this.blocked(c.x, c.z) && terrainHeight(c.x, c.z) > 2 && slopeAt(c.x, c.z) < 0.1) {
                        church = true;
                        (t.footprints || (t.footprints = [])).push({ u: cu, v: cv, hu: 16, hv: 20 });
                        specials.push({ x: c.x, z: c.z, y: this.groundAt(c.x, c.z) - 0.8, yaw: t.theta });
                        this.mark(c.x, c.z, 18);
                        continue;
                    }
                }
                if (r() < (t.size === 'city' ? 0.08 : 0.05)) { parks.push({ t, cu, cv, size: inner }); continue; }
                if (zone === 'tower') {
                    const two = r() < 0.5;
                    const w = two ? inner * 0.44 : inner * (0.6 + r() * 0.3), d = inner * (0.55 + r() * 0.35);
                    const hgt = 28 + Math.pow(Math.max(0, 1 - rel / 0.3), 1.2) * 95 * (0.6 + r() * 0.6);
                    // if the big footprint doesn't fit (a road cuts the block), try smaller buildings in the corners
                    let placed = two
                        ? tryPlace(t, cu - inner * 0.26, cv, w, d, 0, 'tower', hgt) + tryPlace(t, cu + inner * 0.26, cv, w, d, 0, 'tower', hgt * (0.55 + r() * 0.5))
                        : tryPlace(t, cu, cv, w, d, 0, 'tower', hgt) ? 1 : 0;
                    if (!placed) for (const [a, b2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                        tryPlace(t, cu + a * inner * 0.27, cv + b2 * inner * 0.27, inner * 0.4, inner * 0.4, 0, r() < 0.6 ? 'tower' : 'apt', hgt * (0.4 + r() * 0.4));
                    }
                    continue;
                }
                const lotW = zone === 'apt' ? 22 : zone === 'town' ? 12 : 13;
                const depth = zone === 'apt' ? 16 : zone === 'town' ? 12 : 10;
                const edge = inner / 2 - depth / 2 - (zone === 'house' ? 4 : 0); // houses get front yards
                for (const side of [0, 1, 2, 3]) {
                    const alongU = side < 2;
                    for (let o = -inner / 2 + lotW / 2; o <= inner / 2 - lotW / 2 + 0.1; o += lotW + (zone === 'house' ? 5 : 1)) {
                        if (zone === 'house' && r() < 0.18) continue; // gaps: driveways and gardens
                        const sgn = side % 2 ? 1 : -1;
                        const u = alongU ? cu + o : cu + sgn * edge;
                        const v = alongU ? cv + sgn * edge : cv + o;
                        const rot = alongU ? 0 : Math.PI / 2;
                        const w = lotW - (zone === 'house' ? 2 + r() * 3 : 0.5), d = depth - r() * 2;
                        const ht = zone === 'apt' ? 12 + Math.floor(r() * 5) * 3 : zone === 'town' ? 6 + Math.floor(r() * 3) * 3 : 3.2 + (r() < 0.35 ? 3 : 0);
                        if (tryPlace(t, u, v, w, d, rot, zone, ht) && zone === 'house') {
                            // driveway beside the house from the street, usually with a car on it
                            const streetEdge = S / 2 - WALK, back = edge - d * 0.25;
                            const len = streetEdge - back, mid = (streetEdge + back) / 2;
                            const lat = o + (w / 2 + 2);
                            const du = alongU ? cu + lat : cu + sgn * mid, dv = alongU ? cv + sgn * mid : cv + lat;
                            const c = this.tw(t, du, dv);
                            const k = r(); driveways.push({ t, x: c.x, z: c.z, len, yaw: t.theta + rot, cars: k < 0.15 ? 0 : k < 0.6 ? 1 : 2, hue: r(), hue2: r(), flip: r() < 0.5 });
                        }
                    }
                }
                if (zone === 'house' || zone === 'town') for (let k = 0; k < 2; k++) {
                    const c = this.tw(t, cu + (r() - 0.5) * inner * 0.35, cv + (r() - 0.5) * inner * 0.35);
                    if (!this.blocked(c.x, c.z)) trees.push({ x: c.x, z: c.z, s: 0.5 + r() * 0.4, t });
                }
            }
        }
        const wallGeo = new THREE.BoxGeometry(1, 1, 1); wallGeo.translate(0, 0.5, 0);
        const houseMat = makeBuildingMaterial('house'), towerMat = makeBuildingMaterial('tower');
        this.buildingMats = [houseMat, towerMat];
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
        const wallCols = [0xe8e0d0, 0xd8cdb8, 0xc9c2b4, 0xf0ece4, 0xbfb6a6, 0xd9c6a5, 0xa9b8c4, 0xc7a58a, 0xe6d3b3, 0xb7c7a8];
        const aptCols = [0xb8b0a4, 0xc9bda8, 0x9aa3a8, 0xd2c3ad, 0xa89484, 0xc4a896];
        const towerCols = [0x7d8fa0, 0x8a98a8, 0x5f7488, 0x9aa7b3, 0x6b7c70, 0xb0a898];
        const roofCols = [0x9a3b2a, 0x7a3326, 0x5a5f66, 0x8a4a2e, 0x4a4f55, 0x6e2f22];
        const all = [...items.house.map(o => ({ ...o, kind: 'house' })), ...items.town.map(o => ({ ...o, kind: 'town' })), ...items.apt.map(o => ({ ...o, kind: 'apt' }))];
        for (const o of all) {
            const top = o.y + o.ht;
            if (o.kind === 'house') roofs.push({ t: o.t, x: o.x, y: top, z: o.z, w: o.w * 1.12, d: o.d * 1.14, h: 2 + o.d * 0.2, yaw: o.yaw, hue: o.hue, b: o });
            else {
                flatRoofs.push({ t: o.t, x: o.x, y: top, z: o.z, w: o.w + 0.4, d: o.d + 0.4, yaw: o.yaw, b: o });
                if (o.kind === 'apt' || o.hue < 0.4) acUnits.push({ t: o.t, x: o.x + (o.hue - 0.5) * o.w * 0.4, y: top + 0.1, z: o.z, yaw: o.yaw, s: 1.4 + o.hue * 1.4, b: o });
            }
        }
        // every building is also a solid, destructible record (buildings.js) that knows the instances drawing it
        const B = this.buildings = new Buildings(this.group);
        for (const o of [...all, ...items.tower]) o.rec = B.add({ ...o, kind: o.kind || 'tower', roofH: o.kind === 'house' ? 2 + o.d * 0.2 : 0 });
        const own = (o, im, i, role) => { const b = o.rec || (o.b && o.b.rec); if (b) B.part(b, im, i, role); };
        this.perTown(wallGeo, houseMat, all, (im, i, o) => {
            own(o, im, i, 'wall');
            q.setFromAxisAngle(up, o.yaw);
            im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.w, o.ht, o.d)));
            im.setColorAt(i, c.setHex(o.kind === 'apt' ? aptCols[Math.floor(o.hue * aptCols.length)] : wallCols[Math.floor(o.hue * wallCols.length)]));
        });
        for (const o of items.tower) {
            flatRoofs.push({ t: o.t, x: o.x, y: o.y + o.ht, z: o.z, w: o.w + 0.6, d: o.d + 0.6, yaw: o.yaw, b: o });
            acUnits.push({ t: o.t, x: o.x, y: o.y + o.ht + 0.1, z: o.z, yaw: o.yaw, s: 3 + o.hue * 3, b: o });
            if (o.ht > 80) acUnits.push({ t: o.t, x: o.x, y: o.y + o.ht, z: o.z, yaw: 0, s: 0.5, mast: 18, b: o });
        }
        this.perTown(wallGeo, towerMat, items.tower, (im, i, o) => {
            own(o, im, i, 'wall');
            q.setFromAxisAngle(up, o.yaw);
            im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.w, o.ht, o.d)));
            im.setColorAt(i, c.setHex(towerCols[Math.floor(o.hue * towerCols.length)]));
        });
        // gable roofs: ridge along the building's long side (w), gables at the ends
        this.perTown(gableGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), roofs, (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw + Math.PI / 2);
            im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.d, o.h, o.w)));
            im.setColorAt(i, c.setHex(roofCols[Math.floor(o.hue * 7) % roofCols.length]));
        });
        this.perTown(wallGeo, new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.9 }), flatRoofs, (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw); im.setMatrixAt(i, m.compose(p.set(o.x, o.y - 0.2, o.z), q, s.set(o.w, 0.6, o.d)));
        });
        // rooftop clutter is too small to see from far away
        this.perTown(wallGeo, new THREE.MeshStandardMaterial({ color: 0x9da3a6, roughness: 0.6, metalness: 0.4 }), acUnits, (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw); im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, o.mast ? s.set(o.s, o.mast, o.s) : s.set(o.s * 1.6, o.s * 0.7, o.s)));
        }, { far: 7000 });
        B.index();
        for (const sp of specials) this.group.add(this.makeChurch(sp));
        this.buildDriveways(driveways);
        // parks: a lawn following the ground, and trees
        const lawnMat = new THREE.MeshStandardMaterial({ color: 0x4f8a3c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
        for (const pk of parks) {
            const cpt = this.tw(pk.t, pk.cu, pk.cv);
            const h0 = this.groundAt(cpt.x, cpt.z);
            const geo = new THREE.PlaneGeometry(pk.size, pk.size, 4, 4);
            geo.rotateX(-Math.PI / 2);
            geo.rotateY(pk.t.theta);
            const la = geo.attributes.position;
            for (let i = 0; i < la.count; i++) la.setY(i, this.groundAt(cpt.x + la.getX(i), cpt.z + la.getZ(i)) - h0 + 0.3);
            geo.computeVertexNormals();
            const lawn = new THREE.Mesh(geo, lawnMat);
            lawn.position.set(cpt.x, h0, cpt.z);
            lawn.receiveShadow = true;
            this.group.add(lawn);
            for (let k = 0; k < 9; k++) {
                const tp = this.tw(pk.t, pk.cu + (this.rand() - 0.5) * pk.size * 0.85, pk.cv + (this.rand() - 0.5) * pk.size * 0.85);
                trees.push({ x: tp.x, z: tp.z, s: 0.6 + this.rand() * 0.5, t: pk.t });
            }
        }
        if (this.world && this.world.treeGeo && trees.length) {
            this.perTown(this.world.treeGeo, this.world.treeMat, trees, (im, i, o) => {
                q.setFromAxisAngle(up, this.rand() * 6.28); im.setMatrixAt(i, m.compose(p.set(o.x, this.groundAt(o.x, o.z) - 0.5, o.z), q, s.set(o.s, o.s, o.s)));
            }, { shadow: false, far: 12000 });
        }
        this.buildingCount = all.length + items.tower.length;
    }

    buildDriveways(list) {
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
        const slab = new THREE.BoxGeometry(1, 1, 1); slab.translate(0, 0.5, 0);
        this.perTown(slab, new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.95 }), list, (im, i, o) => {
            q.setFromAxisAngle(up, o.yaw);
            im.setMatrixAt(i, m.compose(p.set(o.x, this.groundAt(o.x, o.z) - 0.3, o.z), q, s.set(3.6, 0.75, o.len)));
        }, { shadow: false, far: 9000 });
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

    updatePeople(dt, cam) {
        if (!this.people) return;
        const T = this._pt || (this._pt = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), t: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), c: new THREE.Color() });
        const { m, q, s, p, t, up } = T;
        const R2 = 1800 * 1800;
        let k = 0;
        for (const w of this.walkers) {
            w.s += w.dir * w.speed * dt;
            if (w.s < 1 || w.s > w.path.len - 1) { w.dir = -w.dir; w.s = Math.max(1, Math.min(w.path.len - 1, w.s)); }
            // too far away to see: just keep walking, don't draw
            if (cam && w.x !== undefined && (w.x - cam.x) ** 2 + (w.z - cam.z) ** 2 > R2) continue;
            samplePath(w.path, w.s, p, t);
            w.x = p.x; w.z = p.z;
            const i = k++;
            // on the pavement on one side of the street
            const lat = (STREET_HALF + 1.4) * w.side;
            p.x += -t.z * lat; p.z += t.x * lat;
            w.ph += dt * w.speed * 5.5;
            p.y += (p.g || 0) * lat + Math.abs(Math.sin(w.ph)) * 0.06; // the pavement's height (cheaper than sampling the ground)
            q.setFromAxisAngle(up, Math.atan2(-t.x * w.dir, -t.z * w.dir));
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

    makeChurch(sp) {
        const g = new THREE.Group();
        const wall = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.85 });
        const roof = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.7, side: THREE.DoubleSide });
        const nave = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 26), wall); nave.position.y = 4.5; g.add(nave);
        const nr = new THREE.Mesh(gableGeometry(), roof); nr.scale.set(13.5, 5, 27); nr.position.y = 9; g.add(nr);
        const tower = new THREE.Mesh(new THREE.BoxGeometry(6, 20, 6), wall); tower.position.set(0, 10, -14); g.add(tower);
        const spire = new THREE.Mesh(new THREE.ConeGeometry(4.2, 14, 4), roof); spire.rotation.y = Math.PI / 4; spire.position.set(0, 27, -14); g.add(spire);
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), roof); cross.position.set(0, 35, -14); g.add(cross);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.3), roof); arm.position.set(0, 35.4, -14); g.add(arm);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        g.position.set(sp.x, sp.y, sp.z);
        g.rotation.y = sp.yaw;
        return g;
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

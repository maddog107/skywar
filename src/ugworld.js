// ═══════════════════════════════════════════════════════════════
// Underground complexes, the static world (underground.js runs them): the ground at the portals, the facades and
// blast doors, wing walls, aprons, runway, taxiways and roads, and what stands around them.
//  • portal ground: the terrain mesh is far too coarse (a vertex every 21 m) for a cutting with walls and a headwall,
//    so each portal's ground is cut out of it (the terrain shader discards it: world.js TERRAIN_CUT_U) and drawn here
//    as a fine mesh with the terrain's own material, laid out along the cutting — rows at the facade's front and back
//    faces, columns on the wing walls' faces — with no ground over the tunnel mouth. Its rim is laid on the ground as
//    drawn (world.drawnSample) and follows the terrain tiles when they change resolution, like the craters do
//  • paved surfaces: the runway, aprons and pads are flat (the carve makes them so, coarse or fine); taxiways and
//    roads are graded, and conformed to the drawn ground like the portal rims
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight, TERRAIN_CUT_U, TERRAIN_CUTS } from './world.js';
import { UG_SITES, siteToWorld, portalFrame, notchWidth, wingLength, wallHeight, NOTCH, setCarve } from './ugsites.js';
import { offsetUnits, clamp } from './util.js';
import { liftWithDistance } from './roads.js';
import { craterCut } from './craters.js';
import { tubeList, ugTunnelAt } from './ugsites.js';
import { buildTube, interiorMaterial, uploadLamps } from './ugint.js';

const _ds = { h: 0, nx: 0, ny: 1, nz: 0 };
const STEP = 2;          // portal ground spacing (m)
const RIM = 3;           // rows / columns blended from the drawn ground (the rim) to the fine carve
const WALL_T = NOTCH.ramp; // wing walls and the facade's cheeks are as thick as the floor's edge step

// ═════════════ Portal ground ═════════════
// The patch's extent in the portal frame: wide enough for the side cuts, from behind the headwall to past the mouth
function patchExtent(site, p) {
    const F = portalFrame(site, p);
    const [W, Hf, Tf] = p.face;
    const at = (u, v) => ({ x: F.x + F.ux * u + F.vx * v, z: F.z + F.uz * u + F.vz * v });
    // the natural ground (the carve off), to see how deep the cutting is
    setCarve(false);
    let A = 0, back = Tf + 6;
    try {
        for (let v = 0; v <= p.notch; v += 5) {
            const wn = notchWidth(p, v) + WALL_T;
            let du = 0;
            for (const s of [-1, 1]) {
                // walk out until the side cut meets the hillside
                for (let d = 0; d < 120; d += 2) {
                    const q = at(s * (wn + d), v), h = terrainHeight(q.x, q.z) - p.floor;
                    const cut = wallHeight(p, v) + NOTCH.sSide * d;
                    if (cut >= h) { du = Math.max(du, d); break; }
                }
            }
            A = Math.max(A, wn + du);
        }
        // behind the facade: until the back slope meets the hillside
        for (let u = -W / 2; u <= W / 2; u += 4) {
            for (let d = 0; d < 120; d += 2) {
                const q = at(u, -Tf - d), h = terrainHeight(q.x, q.z) - p.floor;
                if (Hf - 1.5 + NOTCH.sBack * d >= h) { back = Math.max(back, Tf + d); break; }
            }
        }
    } finally { setCarve(true); }
    const u = Math.ceil((A + 10) / STEP) * STEP;
    return { F, A: Math.max(u, W / 2 + 16), v0: -Math.ceil((back + 10) / STEP) * STEP, v1: p.notch + 12 };
}

// the sorted row positions: every STEP, and exactly on the facade's faces and the wing walls' end
function rowsFor(p, v0, v1) {
    const want = [v0, v1, 0, -p.face[2], wingLength(p)];
    for (let v = v0; v <= v1; v += STEP) want.push(v);
    want.sort((a, b) => a - b);
    const out = [];
    for (const v of want) if (!out.length || v - out[out.length - 1] > 0.35) out.push(v); else if ([0, -p.face[2], wingLength(p)].includes(v)) out[out.length - 1] = v;
    return out;
}

export class PortalGround {
    constructor(world, site, p, material) {
        this.world = world; this.site = site; this.p = p;
        const E = patchExtent(site, p);
        Object.assign(this, E);
        const F = E.F, A = E.A;
        const [W, , Tf] = p.face;
        this.rows = rowsFor(p, E.v0, E.v1);
        // columns: the same topology on every row, warped so there's a column on each wing wall's inner and outer face
        const wnMax = notchWidth(p, E.v1);
        const nIn = Math.max(2, Math.ceil(wnMax / STEP)), nOut = Math.max(3, Math.ceil((A - notchWidth(p, 0) - WALL_T) / STEP));
        this.nIn = nIn; this.nOut = nOut;
        const cols = 2 * (nOut + 2 + nIn) + 1;
        this.cols = cols;
        const R = this.rows.length, N = R * cols;
        const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), col = new Float32Array(N * 3), mo = new Float32Array(N * 4), ht = new Float32Array(N);
        this.uv = new Float32Array(N * 2); // (u, v) of each vertex in the portal frame
        const colU = (j, v) => {
            const wn = notchWidth(p, v), sgn = j < (cols - 1) / 2 ? -1 : 1, k = Math.abs(j - (cols - 1) / 2);
            if (k <= nIn) return sgn * (wn - 0.25) * (k / nIn);        // the floor
            if (k === nIn + 1) return sgn * wn;                           // the walls' inner foot (the ground's edge step starts)
            if (k === nIn + 2) return sgn * (wn + WALL_T);                // the walls' outer top
            return sgn * (wn + WALL_T + (A - wn - WALL_T) * ((k - nIn - 2) / nOut)); // the side cuts, out to the rim
        };
        for (let i = 0; i < R; i++) {
            const v = this.rows[i];
            for (let j = 0; j < cols; j++) {
                const u = colU(j, v), k = i * cols + j;
                this.uv[k * 2] = u; this.uv[k * 2 + 1] = v;
                pos[k * 3] = F.x + F.ux * u + F.vx * v;
                pos[k * 3 + 2] = F.z + F.uz * u + F.vz * v;
            }
        }
        // cells: none under the facade block (between its faces, across its width), which stands there instead
        const idx = [];
        for (let i = 0; i < R - 1; i++) for (let j = 0; j < cols - 1; j++) {
            const vm = (this.rows[i] + this.rows[i + 1]) / 2, um = (colU(j, vm) + colU(j + 1, vm)) / 2;
            if (vm < 0 && vm > -Tf && Math.abs(um) < W / 2) continue;
            // (U × V is up: a → b runs along U, a → c along V)
            const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
            idx.push(a, b, c, b, d, c);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('morph', new THREE.BufferAttribute(mo, 4));
        g.setAttribute('hTrue', new THREE.BufferAttribute(ht, 1));
        g.setIndex(idx);
        this.geo = g;
        this.fine = new Float32Array(N); // the carved height at each vertex (fixed)
        for (let k = 0; k < N; k++) this.fine[k] = terrainHeight(pos[k * 3], pos[k * 3 + 2]);
        this.mesh = new THREE.Mesh(g, material);
        this.mesh.receiveShadow = true; this.mesh.castShadow = true;
        this.mesh.matrixAutoUpdate = false; this.mesh.matrixWorldAutoUpdate = false;
        this.mesh.name = 'ugGround:' + p.id;
        // the terrain tiles under it (their resolution changes are followed)
        const T = world.TILE;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let k = 0; k < N; k++) { x0 = Math.min(x0, pos[k * 3]); x1 = Math.max(x1, pos[k * 3]); z0 = Math.min(z0, pos[k * 3 + 2]); z1 = Math.max(z1, pos[k * 3 + 2]); }
        this.tileKeys = []; this.tileGeos = [];
        for (let tx = Math.floor(x0 / T); tx <= Math.floor(x1 / T); tx++) for (let tz = Math.floor(z0 / T); tz <= Math.floor(z1 / T); tz++) { this.tileKeys.push(world.tileKey(tx, tz)); this.tileGeos.push(undefined); }
        this.conform();
    }

    // the cut rectangle for the terrain shader: the portal frame's origin and axes, the patch's extent (a hair inside
    // it, so the coarse ground and the patch overlap rather than leave a crack)
    cutRect(out, o) {
        const F = this.F, e = 0.08;
        out[o] = F.x; out[o + 1] = F.z; out[o + 2] = F.ux; out[o + 3] = F.uz;
        out[o + 4] = this.A - e; out[o + 5] = this.v0 + e; out[o + 6] = this.v1 - e; out[o + 7] = 0;
    }

    // heights: the fine carve inside, the drawn ground on the rim, blended in between
    conform() {
        const w = this.world, g = this.geo, pos = g.attributes.position.array, R = this.rows.length, C = this.cols;
        for (let q = 0; q < this.tileKeys.length; q++) { const t = w.tiles.get(this.tileKeys[q]); this.tileGeos[q] = t && t.mesh ? t.mesh.geometry : null; }
        for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
            const k = i * C + j, ring = Math.min(i, j, R - 1 - i, C - 1 - j);
            let h = this.fine[k];
            if (ring < RIM) {
                w.drawnSample(pos[k * 3], pos[k * 3 + 2], _ds);
                h = _ds.h + (h - _ds.h) * (ring / RIM);
            }
            pos[k * 3 + 1] = h;
        }
        g.computeVertexNormals();
        const nor = g.attributes.normal.array, col = g.attributes.color.array, mo = g.attributes.morph.array, ht = g.attributes.hTrue.array;
        for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
            const k = i * C + j, ring = Math.min(i, j, R - 1 - i, C - 1 - j);
            if (ring === 0) { // the rim takes the drawn ground's normal (no seam in the light)
                w.drawnSample(pos[k * 3], pos[k * 3 + 2], _ds);
                const l = Math.hypot(_ds.nx, _ds.ny, _ds.nz) || 1;
                nor[k * 3] = _ds.nx / l; nor[k * 3 + 1] = _ds.ny / l; nor[k * 3 + 2] = _ds.nz / l;
            }
            w.colorAt(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], nor[k * 3 + 1], col, k * 3);
            mo[k * 4] = pos[k * 3 + 1]; mo[k * 4 + 1] = nor[k * 3]; mo[k * 4 + 2] = nor[k * 3 + 2]; mo[k * 4 + 3] = -1e4;
            ht[k] = pos[k * 3 + 1];
        }
        for (const k of ['position', 'normal', 'color', 'morph', 'hTrue']) g.attributes[k].needsUpdate = true;
        g.computeBoundingSphere();
    }

    // a tile under it changed resolution (or arrived): lay the rim again
    stale() {
        const tiles = this.world.tiles;
        for (let q = 0; q < this.tileKeys.length; q++) {
            const t = tiles.get(this.tileKeys[q]);
            if ((t && t.mesh ? t.mesh.geometry : null) !== this.tileGeos[q]) return true;
        }
        return false;
    }
}

// the terrain material, drawing the ground the tiles leave out (UG_KEEP), kept in step with the terrain's quality
// defines and night tint
export function groundMaterial(world) {
    const src = world.terrainMat;
    const m = src.clone();
    m.defines = { ...src.defines, UG_KEEP: '' };
    m.onBeforeCompile = src.onBeforeCompile;
    m.vertexColors = true;
    return m;
}
export function syncGroundMaterial(world, m) {
    const src = world.terrainMat, d = { ...src.defines, UG_KEEP: '' };
    if (Object.keys(d).sort().join() !== Object.keys(m.defines).sort().join()) { m.defines = d; m.needsUpdate = true; }
    m.emissive.copy(src.emissive);
}

// publish the cut rectangles to the terrain shader
export function setTerrainCuts(patches) {
    const arr = TERRAIN_CUT_U.ugCuts.value, box = TERRAIN_CUT_U.ugCutBox.value;
    arr.fill(0);
    box[0] = box[1] = 1e9; box[2] = box[3] = -1e9;
    patches.slice(0, TERRAIN_CUTS).forEach((pg, i) => {
        pg.cutRect(arr, i * 8);
        const r = Math.hypot(pg.A, Math.max(-pg.v0, pg.v1)) + 2;
        box[0] = Math.min(box[0], pg.F.x - r); box[1] = Math.min(box[1], pg.F.z - r);
        box[2] = Math.max(box[2], pg.F.x + r); box[3] = Math.max(box[3], pg.F.z + r);
    });
}

// ═════════════ Materials and textures ═════════════
const TEX_BASE = new URL('../models/underground/tex/', import.meta.url).href;
const texCache = new Map();
let loader = null;
export function ugTexture(name, { repeat = true, srgb = true } = {}) {
    if (texCache.has(name)) return texCache.get(name);
    if (typeof document === 'undefined') return null;
    loader = loader || new THREE.TextureLoader();
    const t = loader.load(TEX_BASE + name);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    texCache.set(name, t);
    return t;
}

// ═════════════ Ribbons: taxiways, roads, tracks, laid on the ground as drawn ═════════════
// pts: world [x, z] along the centre line; w: width. A strip of quads; heights from the drawn ground (re-laid when the
// tiles under it change), lifted a few cm and drawn with a polygon offset. v runs along it in metres (u across 0..1).
export class Ribbon {
    constructor(world, pts, w, material, { lift = 0.06, step = 6, heightAt = null } = {}) {
        this.world = world; this.lift = lift; this.heightAt = heightAt;
        // resample the centre line every `step` metres
        const P = [];
        for (let i = 1; i < pts.length; i++) {
            const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step));
            for (let k = i === 1 ? 0 : 1; k <= n; k++) P.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
        }
        const N = P.length;
        const pos = new Float32Array(N * 2 * 3), uv = new Float32Array(N * 2 * 2), nor = new Float32Array(N * 2 * 3);
        let s = 0;
        for (let i = 0; i < N; i++) {
            const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)];
            let tx = b[0] - a[0], tz = b[1] - a[1];
            const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
            if (i) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
            for (let e = 0; e < 2; e++) {
                const side = e ? 0.5 : -0.5, k = i * 2 + e;
                pos[k * 3] = P[i][0] - tz * w * side; pos[k * 3 + 2] = P[i][1] + tx * w * side;
                uv[k * 2] = e * w / 8; uv[k * 2 + 1] = s / 8; // (8 m texture tiles)
                nor[k * 3 + 1] = 1;
            }
        }
        const idx = [];
        for (let i = 0; i < N - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(idx);
        this.geo = g;
        this.length = s;
        this.mesh = new THREE.Mesh(g, material);
        this.mesh.receiveShadow = true;
        this.mesh.matrixAutoUpdate = false; this.mesh.matrixWorldAutoUpdate = false;
        const T = world.TILE, keys = new Set();
        for (let k = 0; k < N * 2; k++) keys.add(world.tileKey(Math.floor(pos[k * 3] / T), Math.floor(pos[k * 3 + 2] / T)));
        this.tileKeys = [...keys]; this.tileGeos = this.tileKeys.map(() => undefined);
        this.conform();
    }
    conform() {
        const w = this.world, g = this.geo, pos = g.attributes.position.array, nor = g.attributes.normal.array;
        for (let q = 0; q < this.tileKeys.length; q++) { const t = w.tiles.get(this.tileKeys[q]); this.tileGeos[q] = t && t.mesh ? t.mesh.geometry : null; }
        for (let k = 0; k < pos.length / 3; k++) {
            const x = pos[k * 3], z = pos[k * 3 + 2];
            const hk = this.heightAt ? this.heightAt(x, z) : null;
            if (hk != null) { pos[k * 3 + 1] = hk + this.lift; nor[k * 3] = 0; nor[k * 3 + 1] = 1; nor[k * 3 + 2] = 0; continue; }
            w.drawnSample(x, z, _ds);
            pos[k * 3 + 1] = _ds.h + this.lift;
            const l = Math.hypot(_ds.nx, _ds.ny, _ds.nz) || 1;
            nor[k * 3] = _ds.nx / l; nor[k * 3 + 1] = _ds.ny / l; nor[k * 3 + 2] = _ds.nz / l;
        }
        g.attributes.position.needsUpdate = true; g.attributes.normal.needsUpdate = true;
        g.computeBoundingSphere();
    }
    stale() {
        const tiles = this.world.tiles;
        for (let q = 0; q < this.tileKeys.length; q++) {
            const t = tiles.get(this.tileKeys[q]);
            if ((t && t.mesh ? t.mesh.geometry : null) !== this.tileGeos[q]) return true;
        }
        return false;
    }
}

// a flat rectangle (runway, apron, pad) at height y, in world space: centre, along-axis (unit x, z), half sizes
export function flatRect(cx, cz, ax, az, hl, hw, y, material, { uvScale = [1, 1], uvAlong = false } = {}) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, material);
    m.scale.set(hw * 2, 1, hl * 2);
    m.position.set(cx, y, cz);
    m.rotation.y = Math.atan2(ax, az); // local +z along (ax, az)
    const uv = g.attributes.uv.array;
    for (let i = 0; i < uv.length; i += 2) { uv[i] *= uvAlong ? 1 : uvScale[0]; uv[i + 1] *= uvScale[1]; }
    m.receiveShadow = true;
    m.updateMatrix(); m.updateMatrixWorld(true);
    m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false;
    return m;
}

export const polygonOffset = (m, f = -2, u = -4) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = offsetUnits(u); return m; };
export { clamp, siteToWorld, portalFrame, notchWidth, wingLength, wallHeight, UG_SITES };

// ═════════════ A complex's outside: ground, facades, walls, paving ═════════════

const MATS = {};
function mats() {
    if (MATS.ready) return MATS;
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
    const paved = (o) => craterCut(liftWithDistance(std({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: offsetUnits(-4), ...o })));
    MATS.concrete = std({ color: 0xc9c6bd, map: ugTexture('facade_diff.jpg'), normalMap: ugTexture('facade_nor.jpg', { srgb: false }) });
    MATS.wall = std({ color: 0xc2beb4, map: ugTexture('facade_diff.jpg'), normalMap: ugTexture('facade_nor.jpg', { srgb: false }) });
    MATS.apron = paved({ color: 0xd8d4ca, map: ugTexture('floor_diff.jpg') });
    MATS.runway = paved({ color: 0xffffff, map: runwayTexture() });
    MATS.taxi = paved({ color: 0xb4b0a8, map: ugTexture('asphalt_diff.jpg') });
    MATS.road = paved({ color: 0xa8a399, map: ugTexture('asphalt_diff.jpg') });
    MATS.track = paved({ color: 0xc8b89c, map: ugTexture('gravel_diff.jpg') });
    MATS.door = std({ color: 0xffffff, roughness: 0.65, metalness: 0.45, map: ugTexture('door_diff.jpg'), normalMap: ugTexture('door_nor.jpg', { srgb: false }) });
    MATS.dark = new THREE.MeshBasicMaterial({ color: 0x050505 });
    // inside (ugint.js patches these for the tunnel lamps)
    MATS.lining = std({ color: 0xa4a39d, map: ugTexture('lining_diff.jpg'), normalMap: ugTexture('lining_nor.jpg', { srgb: false }), roughness: 0.95 });
    MATS.hallFloor = std({ color: 0xc4bfb5, map: ugTexture('floor_diff.jpg'), normalMap: ugTexture('floor_nor.jpg', { srgb: false }), roughness: 0.55 });
    const lines = new Map();
    MATS.line = (c) => lines.get(c) || (lines.set(c, std({ color: c, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: offsetUnits(-4) })), lines.get(c));
    MATS.lampGeo = new THREE.BoxGeometry(0.5, 0.22, 1.6);
    MATS.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.0, 2.6), fog: false });
    MATS.ready = true;
    return MATS;
}

// Runway paint on concrete: 2200 × 45 m; the texture spans the width and repeats every 150 m along it (markings drawn
// on the concrete: centre line dashes, edge lines; the thresholds and numbers are separate quads)
function runwayTexture() {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = 256; c.height = 1024;
    const g = c.getContext('2d');
    g.fillStyle = '#8f8c84'; g.fillRect(0, 0, 256, 1024);
    for (let i = 0; i < 2600; i++) { const v = 110 + Math.random() * 60; g.fillStyle = `rgba(${v},${v},${v - 6},0.25)`; g.fillRect(Math.random() * 256, Math.random() * 1024, 3, 3); }
    // concrete slab joints every 5 m (1024 px = 150 m → 34 px)
    g.strokeStyle = 'rgba(40,40,38,0.35)'; g.lineWidth = 1;
    for (let y = 0; y < 1024; y += 1024 / 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    for (let x = 0; x <= 256; x += 256 / 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke(); }
    // tyre marks down the middle
    g.fillStyle = 'rgba(30,30,30,0.12)'; g.fillRect(96, 0, 64, 1024);
    // edge lines and the centre line (30 m dashes, 20 m gaps)
    g.fillStyle = '#e8e6de';
    g.fillRect(6, 0, 5, 1024); g.fillRect(245, 0, 5, 1024);
    for (let y = 0; y < 1024; y += 1024 / 3) g.fillRect(126, y, 4, 1024 / 3 * 0.6);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
}

// A placeholder facade block (the Blender model replaces it): the front wall with the opening, the cheeks, the door
function placeholderFacade(p, M) {
    const [W, H, T] = p.face, [ow, oh] = p.open;
    const g = new THREE.Group();
    const add = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; g.add(b); return b; };
    // model frame: x across (= u), y up, z into the mountain (= −v); the front face at z = 0
    add((W - ow) / 2, H, T, -(ow / 2 + (W - ow) / 4), H / 2, T / 2, M.concrete);
    add((W - ow) / 2, H, T, (ow / 2 + (W - ow) / 4), H / 2, T / 2, M.concrete);
    add(ow, H - oh, T, 0, oh + (H - oh) / 2, T / 2, M.concrete);
    const door = new THREE.Group();
    const leaf = add(ow * 1.02, oh * 1.02, 1.2, 0, oh / 2, 0, M.door);
    g.remove(leaf); door.add(leaf);
    door.position.set(0, 0, 1.4);
    g.add(door);
    g.userData.door = door;
    return g;
}

export class ComplexWorld {
    constructor(game, site) {
        this.game = game; this.site = site;
        const world = game.world, M = mats();
        this.group = new THREE.Group();
        this.group.name = 'ug:' + site.id;
        this.patches = [];
        this.ribbons = [];
        this.gmat = groundMaterial(world);
        this.facades = [];
        // the ground at each portal
        for (const p of site.portals) {
            const pg = new PortalGround(world, site, p, this.gmat);
            this.patches.push(pg);
            this.group.add(pg.mesh);
        }
        // facades, doors, wing walls, the paved floor of each cutting
        for (const p of site.portals) {
            const F = portalFrame(site, p);
            const f = placeholderFacade(p, M);
            f.position.set(F.x, p.floor, F.z);
            f.rotation.y = -F.th;
            this.group.add(f);
            this.facades.push({ p, F, obj: f, door: f.userData.door, openK: 0 });
            this.group.add(this.wingWalls(p, F, M));
            this.group.add(this.notchFloor(p, F, M));
        }
        // runway, aprons, pads
        const c = Math.cos(site.th), sn = Math.sin(site.th);
        const dir = (a) => { const r = a * Math.PI / 180; return { x: c * Math.cos(r) + sn * Math.sin(r), z: sn * Math.cos(r) - c * Math.sin(r) }; };
        if (site.runway) {
            const r = site.runway, w = siteToWorld(site, r.u, r.v), d = dir(r.ang || 0);
            this.group.add(flatRect(w.x, w.z, d.x, d.z, r.len / 2, r.w / 2, r.y + 0.05, M.runway, { uvScale: [1, r.len / 150] }));
        }
        for (const p of site.pads) {
            const w = siteToWorld(site, p.u, p.v), d = dir(p.ang || 0);
            this.group.add(flatRect(w.x, w.z, d.x, d.z, p.len / 2, p.w / 2, p.y + 0.04, M.apron, { uvScale: [p.w / 8, p.len / 8] }));
        }
        for (const r of site.roads) {
            const pts = r.pts.map(q => { const w = siteToWorld(site, q[0], q[1]); return [w.x, w.z]; });
            const mat = r.kind === 'taxi' ? M.taxi : r.kind === 'track' ? M.track : M.road;
            const rb = new Ribbon(world, pts, r.w, mat, { lift: r.kind === 'taxi' ? 0.08 : 0.06 });
            this.ribbons.push(rb);
            this.group.add(rb.mesh);
        }
        game.scene.add(this.group);
        this.conformT = 0;
        this.buildInterior();
    }

    // ── inside: the tubes (drawn only when they can be seen) ──
    buildInterior() {
        const site = this.site, M = mats();
        const im = {
            lining: interiorMaterial(M.lining, { baked: true }),
            floor: interiorMaterial(M.hallFloor, { baked: true }),
            line: (c) => interiorMaterial(M.line(c), { baked: true }),
            lampGeo: M.lampGeo, lampMat: M.lampMat,
        };
        this.interior = new THREE.Group();
        this.interior.name = 'ugInterior:' + site.id;
        this.lamps = [];
        this.tubes = [];
        const box = new THREE.Box3();
        for (const T of tubeList()) {
            if (T.site !== site) continue;
            const S = T.samples, L = S[S.length - 1].s;
            // the lining starts behind each portal's facade (its own opening is the way in)
            const skip = (id) => { const p = site.portals.find(q => q.id === id); return p ? 1 + p.face[2] - 0.3 : 0; };
            const start = skip(T.tube.ends[0]), end = T.tube.ends[1] ? L - skip(T.tube.ends[1]) : L;
            const big = S.some(q => q.w > 16);
            const t = buildTube(S, { start, end, cap: !T.tube.ends[1], mats: im, lampSpacing: big ? 12 : 10, lampPower: big ? 24 : 14 });
            this.interior.add(t.group);
            this.lamps.push(...t.lamps);
            this.tubes.push({ T, ...t });
            box.union(t.box);
        }
        this.interiorBox = box;
        this.interior.visible = false;
        this.group.add(this.interior);
        this.lampPower = 20;
    }

    // a door's position, 0 shut … 1 open (the placeholder slides aside)
    setDoor(pid, k) {
        const f = this.facades.find(q => q.p.id === pid);
        if (!f) return;
        f.openK = clamp(k, 0, 1);
        if (f.door) f.door.position.x = f.openK * (f.p.open[0] + 1);
    }

    // Is the camera inside, or near an open door in front of it? Then draw the interior and light it
    updateInterior(cam) {
        const inside = !!ugTunnelAt(cam.x, cam.z, cam.y, 1.5) && this.interiorBox.containsPoint(cam);
        let see = inside;
        const extra = this._daylight || (this._daylight = []);
        extra.length = 0;
        for (const f of this.facades) {
            const k = f.openK || 0;
            if (k < 0.02) continue;
            const F = f.F, dx = cam.x - F.x, dz = cam.z - F.z, v = dx * F.vx + dz * F.vz;
            if (Math.hypot(dx, dz) < 2500 && v > -f.p.face[2] - 2) see = true;
            // daylight in the doorway (dimmer at night)
            const day = this.game.world.timeKey === 'night' ? 0.05 : this.game.world.timeKey === 'day' ? 1 : 0.45;
            const [ow, oh] = f.p.open;
            extra.push({ x: F.x + F.vx * 6, y: F.y + oh * 0.8, z: F.z + F.vz * 6, range: 90, r: 260 * k * day, g: 280 * k * day, b: 310 * k * day });
        }
        this.interior.visible = see;
        this.inside = inside;
        if (see) uploadLamps(this.lamps, cam, this.lampPower, extra);
    }

    // splayed wing walls either side of the cutting, their tops sloping from the facade's height to nothing
    wingWalls(p, F, M) {
        const L = wingLength(p), n = 8, pos = [], idx = [];
        const P = (u, v, y) => pos.push(F.x + F.ux * u + F.vx * v, p.floor + y, F.z + F.uz * u + F.vz * v);
        for (const s of [-1, 1]) {
            const base = pos.length / 3;
            for (let i = 0; i <= n; i++) {
                const v = L * i / n, wn = notchWidth(p, v), h = wallHeight(p, v) + 0.35;
                // four corners of the section: inner foot, inner top, outer top, outer foot
                P(s * (wn - 0.2), v, -0.3); P(s * (wn - 0.2), v, h); P(s * (wn + WALL_T), v, h); P(s * (wn + WALL_T), v, h - 1.2);
            }
            for (let i = 0; i < n; i++) {
                const a = base + i * 4, b = a + 4;
                const quad = (q0, q1, q2, q3) => (s < 0 ? idx.push(q0, q1, q2, q0, q2, q3) : idx.push(q0, q2, q1, q0, q3, q2));
                quad(a, b, b + 1, a + 1);         // inner face
                quad(a + 1, b + 1, b + 2, a + 2); // top
                quad(a + 2, b + 2, b + 3, a + 3); // outer face (buried mostly)
            }
            // the end cap at the mouth
            const e = base + n * 4;
            s > 0 ? idx.push(e, e + 1, e + 2, e, e + 2, e + 3) : idx.push(e, e + 2, e + 1, e, e + 3, e + 2);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        // box-mapped uv (metres / 6 m per tile) from the positions
        const uv = new Float32Array(pos.length / 3 * 2);
        for (let k = 0; k < pos.length / 3; k++) { const u = (pos[k * 3] - F.x) * F.ux + (pos[k * 3 + 2] - F.z) * F.uz, v = (pos[k * 3] - F.x) * F.vx + (pos[k * 3 + 2] - F.z) * F.vz; uv[k * 2] = (v + u * 0.2) / 6; uv[k * 2 + 1] = (pos[k * 3 + 1] - p.floor) / 6; }
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        const m = new THREE.Mesh(g, M.wall);
        m.castShadow = m.receiveShadow = true;
        return m;
    }

    // the cutting's concrete floor, between the wing walls and out to the mouth
    notchFloor(p, F, M) {
        const n = 12, pos = [], uv = [], idx = [];
        for (let i = 0; i <= n; i++) {
            const v = p.notch * i / n, wn = notchWidth(p, v) - 0.1;
            for (const s of [-1, 1]) {
                pos.push(F.x + F.ux * s * wn + F.vx * v, p.floor + 0.04, F.z + F.uz * s * wn + F.vz * v);
                uv.push(s * wn / 8, v / 8);
            }
        }
        for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
        g.setIndex(idx);
        const m = new THREE.Mesh(g, M.apron);
        m.receiveShadow = true;
        return m;
    }

    update(dt) {
        syncGroundMaterial(this.game.world, this.gmat);
        this.updateInterior(this.game.camera.position);
        // follow the terrain tiles: re-lay one stale piece a frame
        this.conformT -= dt;
        if (this.conformT > 0) return;
        this.conformT = 0.25;
        for (const pg of this.patches) if (pg.stale()) { pg.conform(); return; }
        for (const rb of this.ribbons) if (rb.stale()) { rb.conform(); return; }
    }
}

// ═══════════════════════════════════════════════════════════════
// Craters: holes blown in the ground by bombs, missiles, rockets and crashing jets.
// The terrain is far too coarse to dig into (a vertex every 20 m or more), so a crater is two things:
//  - a lookup every ground pixel makes (terrain, road surfaces; grass and trees per plant): the craters
//    near a point come from a small toroidal index grid (8 slots per 16 m cell), their shape from a data
//    texture. Inside a hole the ground is cut away (discard); around it it's painted as turned earth, in
//    broken rays, and scorched (CRATER_GLSL).
//  - one mesh for every crater (one draw call, drawn with the terrain's own material, so it matches the
//    ground on grass, sand, snow and rock, by day and by night): a bowl dug below the ground, a broken rim of
//    thrown-out earth that runs back down under the terrain, and clods. It is conformed to the ground as drawn
//    (world.drawnSample) and re-conformed when the tile under it changes resolution. The profile itself (and
//    how deep it has formed / how far it has faded) is applied in the vertex shader.
// The same profile lowers the ground for anything that stands, drives or lands on it (craterAdj).
// Old craters fade out (fill in) when the cap is reached; clear() empties the lot for a new sortie.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mulberry32, smoothstep } from './util.js';

export const CRATER_MAX = 64;       // craters alive at once (mesh slots); the oldest are faded out before that
const RETIRE_AT = CRATER_MAX - 8;   // live craters kept: beyond this the oldest starts to fade out
const GRID = 256, CELL = 16;        // index grid: GRID x GRID cells of CELL m (toroidal, repeats every 4 km)
const SLOTS = 8;                    // craters per cell (two RGBA8 texels side by side)
const QMAX = 2.2;                   // the mesh's collar ends here (in hole radii), well under the ground
const FORM = 0.18, FADE_OUT = 2.5;  // seconds to dig in / to fill in
const HASH = 64;                    // physics lookup cell (m)
const CGRID = 5;                    // ground colour samples per side of a crater (interpolated between)
// mesh: rings (hole radii; dense at the rim) x segments, plus clods
const RINGS = [0, 0.2, 0.38, 0.54, 0.68, 0.79, 0.88, 0.95, 1.0, 1.06, 1.14, 1.24, 1.37, 1.53, 1.72, 1.94, QMAX];
const SEGS = 32, CLODS = 14, CV = 36;
const NR = RINGS.length;
const VPS = 1 + (NR - 1) * SEGS + CLODS * CV;                 // vertices per slot
const IPS = 3 * (SEGS + (NR - 2) * SEGS * 2) + CLODS * CV;   // indices per slot

// Kinds: hole radius (m), depth, rim height, scorch, reach of the thrown earth (hole radii), clods
export const CRATER_KINDS = {
    rkt: { r: 2.3, depth: 0.9, rim: 0.35, scorch: 0.75, reach: 3.0, clods: 6 },
    missile: { r: 3.3, depth: 1.4, rim: 0.5, scorch: 0.9, reach: 3.2, clods: 10 },
    sam: { r: 3.5, depth: 1.5, rim: 0.5, scorch: 0.9, reach: 3.2, clods: 10 },
    lrm: { r: 3.7, depth: 1.6, rim: 0.55, scorch: 0.9, reach: 3.2, clods: 11 },
    part: { r: 2.4, depth: 0.7, rim: 0.4, scorch: 1, reach: 2.6, clods: 6 },  // a heavy wreck section
    bomb: { r: 6.6, depth: 2.8, rim: 1.0, scorch: 1, reach: 3.3, clods: 14 },
};

// ── Shared GPU state: the index grid, the crater data, and the uniforms every patched material points at ──
const gridData = new Uint8Array(GRID * 2 * GRID * 4);
const gridTex = new THREE.DataTexture(gridData, GRID * 2, GRID, THREE.RGBAFormat, THREE.UnsignedByteType);
gridTex.needsUpdate = true;
// per crater (a column): row 0 centre x, z, long axis x, z; row 1 hole radii (along, across), depth, rim;
// row 2 fade (0..1), seed, scorch, reach
const dataArr = new Float32Array(CRATER_MAX * 3 * 4);
const dataTex = new THREE.DataTexture(dataArr, CRATER_MAX, 3, THREE.RGBAFormat, THREE.FloatType);
for (let i = 0; i < CRATER_MAX; i++) dataArr.set([1, 1], (CRATER_MAX + i) * 4); // sane radii in empty columns
dataTex.needsUpdate = true;
export const CRATER_U = {
    craterGrid: { value: gridTex },
    craterData: { value: dataTex },
    craterInfo: { value: new THREE.Vector4(1 / CELL, 0, GRID, 0) }, // 1 / cell size, craters alive, grid size
    craterBox: { value: new THREE.Vector4(1e9, 1e9, -1e9, -1e9) },  // bounds (x0, z0, x1, z1) of every crater's reach
};

export const CRATER_GLSL = /* glsl */`
    uniform highp sampler2D craterGrid, craterData;
    uniform vec4 craterInfo, craterBox;
    // rim height wobble and hole outline wobble around a crater (seeded)
    float crWob(float a, float s) { return 0.5 * sin(3.0 * a + s) + 0.3 * sin(5.0 * a + 1.7 * s) + 0.2 * sin(11.0 * a + 2.9 * s); }
    float crRad(float a, float s) { return 1.0 + 0.07 * (0.6 * sin(2.0 * a + 0.7 * s) + 0.4 * sin(7.0 * a + 2.3 * s)); }
    float crAngle(vec2 l) { return atan(l.y, abs(l.x) + abs(l.y) > 1e-6 ? l.x : 1.0); }
    // smooth value noise (0..1), for surfaces without the terrain's noise textures
    float crHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float crNoise(vec2 p) {
        p = mod(p, 512.0);
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(crHash(i), crHash(i + vec2(1.0, 0.0)), f.x), mix(crHash(i + vec2(0.0, 1.0)), crHash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    // height of a crater's surface above the ground it was dug into; l: position in hole radii (x along its long
    // axis). B, C: its rows 1 and 2. q (out): distance in hole radii, outline wobble included (< 1 in the hole)
    float crProfile(vec2 l, vec4 B, vec4 C, out float q) {
        float a = crAngle(l);
        q = length(l) / crRad(a, C.y);
        float rim = B.w * C.x * (1.0 + 0.45 * crWob(a, C.y)), D = B.z * C.x;
        if (q < 1.0) { float q2 = q * q; return -D + (D + rim) * (1.5 * q2 - 0.5 * q2 * q2); }
        return rim * exp(-3.0 * (q - 1.0)) - (0.5 + 0.6 * B.w + 0.05 * max(B.x, B.y)) * smoothstep(1.45, ${QMAX.toFixed(2)}, q);
    }
    // The craters around a ground point: x = distance to the nearest hole (hole radii, < 1: inside one),
    // y = turned earth (1 on the rim, broken rays further out), z = scorching, w = 1 in a bowl
    vec4 craterAt(vec2 xz) {
        vec4 r = vec4(99.0, 0.0, 0.0, 0.0);
        // (most of the ground is nowhere near a crater: one comparison, no texture read)
        if (xz.x < craterBox.x || xz.y < craterBox.y || xz.x > craterBox.z || xz.y > craterBox.w) return r;
        ivec2 cell = ivec2(mod(floor(xz * craterInfo.x), craterInfo.z));
        cell.x *= 2;
        vec4 s0 = texelFetch(craterGrid, cell, 0);
        if (s0.x == 0.0) return r;
        vec4 s1 = s0.w > 0.0 ? texelFetch(craterGrid, cell + ivec2(1, 0), 0) : vec4(0.0);
        for (int k = 0; k < ${SLOTS}; k++) {
            float v = k < 4 ? s0[k] : s1[k - 4];
            if (v == 0.0) break;
            int i = int(v * 255.0 + 0.5) - 1;
            vec4 A = texelFetch(craterData, ivec2(i, 0), 0), C = texelFetch(craterData, ivec2(i, 2), 0);
            vec2 d = xz - A.xy;
            vec2 l = vec2(dot(d, A.zw), dot(d, vec2(-A.w, A.z))) / texelFetch(craterData, ivec2(i, 1), 0).xy;
            float ql = length(l);
            if (ql > C.w * 1.08) continue;
            float a = crAngle(l);
            float q = ql / crRad(a, C.y);
            r.x = min(r.x, q);
            // earth thrown out in uneven rays, reaching further along some than others, thinning out with distance
            float ray = clamp(0.5 + 0.3 * sin(7.0 * a + 3.1 * C.y) + 0.2 * sin(12.0 * a + 1.3 * C.y) + 0.15 * sin(23.0 * a + 5.7 * C.y), 0.0, 1.0);
            r.y = max(r.y, (1.0 - smoothstep(1.0, C.w * (0.62 + 0.38 * ray), q)) * C.x);
            r.z = max(r.z, (1.0 - smoothstep(0.3, 1.8 + 0.5 * ray, q)) * C.z * C.x);
            r.w = max(r.w, (1.0 - smoothstep(0.75, 1.0, q)) * C.x);
        }
        return r;
    }
    // Crater mesh vertex (a = crater attribute: position in hole radii, slot, 0 surface / 1 clod / 2 unused):
    // height to add to the conformed ground; for the surface n (in: the ground's normal) becomes the crater's
    float craterLift(vec4 a, inout vec3 n) {
        if (a.w > 1.5) return 0.0;
        int i = int(a.z + 0.5);
        vec4 A = texelFetch(craterData, ivec2(i, 0), 0), B = texelFetch(craterData, ivec2(i, 1), 0), C = texelFetch(craterData, ivec2(i, 2), 0);
        float q, qe;
        float y = crProfile(a.xy, B, C, q);
        if (a.w > 0.5) return q < 1.0 ? y : max(y, 0.0); // a clod rests on the rim or the ground beyond it
        // slope: the ground's plus the profile's (central differences along world x and z)
        float e = 0.06 * min(B.x, B.y);
        vec2 dx = vec2(A.z / B.x, -A.w / B.y) * e, dz = vec2(A.w / B.x, A.z / B.y) * e;
        float sx = (crProfile(a.xy + dx, B, C, qe) - crProfile(a.xy - dx, B, C, qe)) / (2.0 * e);
        float sz = (crProfile(a.xy + dz, B, C, qe) - crProfile(a.xy - dz, B, C, qe)) / (2.0 * e);
        float ny = max(n.y, 0.2);
        // (where the rim runs back under the terrain it's lit as the ground is: no seam where the two meet)
        n = normalize(mix(normalize(vec3(n.x / ny - sx, 1.0, n.z / ny - sz)), n, smoothstep(1.25, 1.6, q)));
        return y;
    }`;

// ── The same shape on the CPU (physics) ──
const wob = (a, s) => 0.5 * Math.sin(3 * a + s) + 0.3 * Math.sin(5 * a + 1.7 * s) + 0.2 * Math.sin(11 * a + 2.9 * s);
const radW = (a, s) => 1 + 0.07 * (0.6 * Math.sin(2 * a + 0.7 * s) + 0.4 * Math.sin(7 * a + 2.3 * s));
const angleOf = (lx, lz) => Math.atan2(lz, Math.abs(lx) + Math.abs(lz) > 1e-6 ? lx : 1);
const _pq = { q: 0, y: 0 };
function profile(c, lx, lz) {
    const a = angleOf(lx, lz), q = Math.hypot(lx, lz) / radW(a, c.seed);
    const rim = c.rim * c.fade * (1 + 0.45 * wob(a, c.seed)), D = c.depth * c.fade;
    _pq.q = q;
    if (q < 1) { const q2 = q * q; _pq.y = -D + (D + rim) * (1.5 * q2 - 0.5 * q2 * q2); }
    else _pq.y = rim * Math.exp(-3 * (q - 1)) - (0.5 + 0.6 * c.rim + 0.05 * Math.max(c.ra, c.rb)) * smoothstep(1.45, QMAX, q);
    return _pq;
}

let active = null; // the live Craters (one world)
const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler();
// a box's 12 triangles (corners: bit 0 x, bit 1 y, bit 2 z); winding is fixed up per face
const BOX_FACES = [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]];

// Height to add to the ground at (x, z) for the craters there: the bowl below it, the rim above it, as drawn
// (0 away from every crater). A hash cell lookup; free when there are no craters.
export function craterAdj(x, z) {
    const C = active;
    if (!C || !C.list.length) return 0;
    const b = C.bb;
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) return 0;
    const list = C.hash.get(Math.floor(x / HASH) * 100003 + Math.floor(z / HASH));
    if (!list) return 0;
    let top = -Infinity, hole = false;
    for (let i = 0; i < list.length; i++) {
        const c = list[i], dx = x - c.x, dz = z - c.z;
        const lx = (dx * c.dx + dz * c.dz) / c.ra, lz = (dz * c.dx - dx * c.dz) / c.rb;
        if (lx * lx + lz * lz > QMAX * QMAX * 1.17) continue;
        const p = profile(c, lx, lz);
        if (p.q >= QMAX) continue;
        if (p.q < 1) hole = true;
        if (p.y > top) top = p.y;
    }
    // the drawn surface: inside a hole the crater's own; elsewhere the higher of the rim and the ground
    return top === -Infinity ? 0 : hole ? top : Math.max(0, top);
}

// Road surfaces (and anything else laid over the terrain): cut the holes and dirty the tarmac around them
export function craterCut(mat) {
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
    mat.onBeforeCompile = (sh, r) => {
        if (prev) prev.call(mat, sh, r);
        Object.assign(sh.uniforms, CRATER_U);
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vCrXZ;')
            .replace('#include <fog_vertex>', `#include <fog_vertex>
                {
                    vec4 crW = vec4(transformed, 1.0);
                    #ifdef USE_BATCHING
                    crW = batchingMatrix * crW;
                    #endif
                    #ifdef USE_INSTANCING
                    crW = instanceMatrix * crW;
                    #endif
                    vCrXZ = (modelMatrix * crW).xz;
                }`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vCrXZ;\n' + CRATER_GLSL)
            .replace('#include <map_fragment>', `#include <map_fragment>
                vec4 crR = craterAt(vCrXZ);
                if (crR.y > 0.0 || crR.z > 0.0) {
                    float crN = crNoise(vCrXZ * 0.35) * 0.45 + crNoise(vCrXZ * 1.3 + 17.0) * 0.55;
                    float crD = max(smoothstep(0.75, 0.95, crR.y), smoothstep(0.12, 0.7, crR.y * (0.4 + 1.2 * crN)));
                    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.15, 0.105, 0.065) * mix(0.8, 1.2, crN), crD);
                    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.02, 0.018), 0.65 * crR.z * (0.6 + 0.4 * crN));
                }`)
            .replace('#include <dithering_fragment>', `#include <dithering_fragment>
                if (crR.x < 1.0) discard;`);
    };
    mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + ':crater';
    return mat;
}

// ═══════════════════════════════════════════════════════════════
export class Craters {
    // material: the terrain material's crater-mesh variant (world.js)
    constructor(world, material) {
        this.world = world;
        this.list = [];                        // live craters, oldest first
        this.slots = new Array(CRATER_MAX).fill(null);
        this.hash = new Map();                 // HASH m cell → craters over it (physics)
        this.bb = [0, 0, 0, 0];                // bounds of every crater's reach
        this.cellOwners = new Map();           // grid cell index → craters registered there (for eviction)
        this.gridRows = [];                    // grid texel rows touched since the last upload
        this.dataDirty = false;
        this.serial = 0;
        this._ds = { h: 0, nx: 0, ny: 1, nz: 0 };
        this._col = [0, 0, 0];
        this._cg = new Float32Array(CGRID * CGRID * 3);
        this.reconform = [];                   // craters whose ground changed, re-laid a couple a frame
        active = this;
        this.buildMesh(material);
    }

    buildMesh(material) {
        const n = CRATER_MAX * VPS;
        const g = new THREE.BufferGeometry();
        const attr = (k, size) => {
            const a = new THREE.BufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
            g.setAttribute(k, a);
            return a;
        };
        this.aPos = attr('position', 3); this.aNor = attr('normal', 3); this.aCol = attr('color', 3); this.aCr = attr('crater', 4);
        const idx = new Uint16Array(CRATER_MAX * IPS);
        let k = 0;
        for (let s = 0; s < CRATER_MAX; s++) {
            const b = s * VPS;
            const ring = (r, j) => b + 1 + (r - 1) * SEGS + (j % SEGS);
            for (let j = 0; j < SEGS; j++) { idx[k++] = b; idx[k++] = ring(1, j + 1); idx[k++] = ring(1, j); }
            for (let r = 1; r < NR - 1; r++) for (let j = 0; j < SEGS; j++) {
                const a = ring(r, j), bb = ring(r, j + 1), c = ring(r + 1, j), d = ring(r + 1, j + 1);
                idx[k++] = a; idx[k++] = bb; idx[k++] = d;
                idx[k++] = a; idx[k++] = d; idx[k++] = c;
            }
            for (let v = 0; v < CLODS * CV; v++) idx[k++] = b + 1 + (NR - 1) * SEGS + v;
            this.collapse(s, false);
        }
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
        this.geo = g;
        this.mesh = new THREE.Mesh(g, material);
        this.mesh.frustumCulled = false;       // (spread over the map; unused slots are degenerate)
        this.mesh.receiveShadow = true;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.matrixWorldAutoUpdate = false;
        this.mesh.visible = false;
        this.mesh.name = 'craters';
        this.world.scene.add(this.mesh);
    }

    get count() { return this.list.length; }

    // A crater at (x, z). o: a kind from CRATER_KINDS, or { r, rb, depth, rim, scorch, reach, clods };
    // dir: its long axis (x, z; for an elongated gouge); instant: dug in fully at once (tests, stills)
    add(x, z, o = 'missile', { dir = null, instant = false, scale = 1 } = {}) {
        const K = typeof o === 'string' ? CRATER_KINDS[o] || CRATER_KINDS.missile : o;
        const j = () => 0.9 + Math.random() * 0.2;
        const ra = K.r * scale * j(), rb = (K.rb ? K.rb * scale : ra) * (K.rb ? j() : 1);
        let dx = 1, dz = 0;
        if (dir) { const l = Math.hypot(dir.x, dir.z); if (l > 1e-4) { dx = dir.x / l; dz = dir.z / l; } }
        else { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dz = Math.sin(a); }
        const c = {
            x, z, dx, dz, ra, rb, depth: K.depth * scale * j(), rim: K.rim * scale * j(), scorch: K.scorch ?? 1, reach: K.reach ?? 3.2,
            seed: Math.random() * 6.2832, clods: Math.min(CLODS, K.clods ?? 8), fade: instant ? 1 : 0, target: 1,
            slot: -1, born: this.serial++, cells: [], hashCells: [], tileKeys: [], tileGeos: [],
        };
        const rmax = Math.max(ra, rb);
        // the bowl stays clear of the sea level (a crater by the shore doesn't dig down under the water plane)
        this.world.drawnSample(x, z, this._ds);
        c.depth = Math.min(c.depth, Math.max(0.3, this._ds.h - 0.6));
        // craters don't overlap (each is laid on the plain ground): a blast on or next to an older crater
        // obliterates it, unless it's much smaller (then the old crater just takes it)
        for (let i = this.list.length - 1; i >= 0; i--) {
            const o2 = this.list[i], r2 = Math.max(o2.ra, o2.rb);
            if (Math.hypot(o2.x - x, o2.z - z) >= (rmax + r2) * 1.4) continue;
            if (rmax < r2 * 0.6 && o2.target > 0) return null;
            this.free(o2);
        }
        // keep a few slots spare: the oldest fades out (fills in) when there get to be many
        let live = 0;
        for (const e of this.list) if (e.target > 0) live++;
        if (live >= RETIRE_AT) for (const e of this.list) if (e.target > 0) { e.target = 0; break; }
        let slot = this.slots.indexOf(null);
        if (slot < 0) { // all taken (a burst while others fade): the most faded one goes now
            let worst = null;
            for (const e of this.list) if (!worst || (e.target - worst.target || e.fade - worst.fade) < 0) worst = e;
            this.free(worst);
            slot = this.slots.indexOf(null);
        }
        c.slot = slot;
        this.slots[slot] = c;
        this.list.push(c);
        this.registerGrid(c);
        if (c.slot < 0) return null; // (evicted by its own registration: can't happen, but be safe)
        // physics hash
        const R = rmax * QMAX * 1.08;
        for (let hx = Math.floor((x - R) / HASH); hx <= Math.floor((x + R) / HASH); hx++) for (let hz = Math.floor((z - R) / HASH); hz <= Math.floor((z + R) / HASH); hz++) {
            const key = hx * 100003 + hz;
            let l = this.hash.get(key);
            if (!l) this.hash.set(key, l = []);
            l.push(c);
            c.hashCells.push(key);
        }
        // terrain tiles it lies on (their resolution changes are followed)
        const w = this.world, T = w.TILE, RT = rmax * 3.0;
        for (let tx = Math.floor((x - RT) / T); tx <= Math.floor((x + RT) / T); tx++) for (let tz = Math.floor((z - RT) / T); tz <= Math.floor((z + RT) / T); tz++) {
            c.tileKeys.push(w.tileKey(tx, tz)); c.tileGeos.push(null);
        }
        this.updateBounds();
        this.conform(c, true);
        this.writeData(c);
        this.mesh.visible = true;
        return c;
    }

    // start filling a crater in (it's freed once faded)
    retire(c) { c.target = 0; }

    clear() {
        for (let i = this.list.length - 1; i >= 0; i--) this.free(this.list[i]);
        this.reconform.length = 0;
    }

    // remove a crater now
    free(c) {
        if (!c || c.slot < 0) return;
        const s = c.slot;
        for (const cell of c.cells) this.unregisterCell(cell, c);
        c.cells.length = 0;
        for (const key of c.hashCells) {
            const l = this.hash.get(key);
            if (!l) continue;
            const k = l.indexOf(c);
            if (k >= 0) l.splice(k, 1);
            if (!l.length) this.hash.delete(key);
        }
        c.hashCells.length = 0;
        this.slots[s] = null;
        c.slot = -1;
        const i = this.list.indexOf(c);
        if (i >= 0) this.list.splice(i, 1);
        dataArr.fill(0, s * 4, s * 4 + 4); dataArr.fill(0, (CRATER_MAX * 2 + s) * 4, (CRATER_MAX * 2 + s) * 4 + 4);
        dataArr.set([1, 1, 0, 0], (CRATER_MAX + s) * 4);
        this.dataDirty = true;
        this.collapse(s, true);
        this.updateBounds();
    }

    // an unused slot: every vertex on one point (zero-area triangles draw nothing)
    collapse(s, upload) {
        const b = s * VPS;
        this.aPos.array.fill(0, b * 3, (b + VPS) * 3);
        const cr = this.aCr.array;
        for (let v = (b) * 4, e = (b + VPS) * 4; v < e; v += 4) { cr[v] = 0; cr[v + 1] = 0; cr[v + 2] = s; cr[v + 3] = 2; }
        if (upload) this.touch(s);
    }

    touch(s) {
        for (const a of [this.aPos, this.aNor, this.aCol, this.aCr]) { a.addUpdateRange(s * VPS * a.itemSize, VPS * a.itemSize); a.needsUpdate = true; }
    }

    updateBounds() {
        const b = this.bb;
        b[0] = b[1] = Infinity; b[2] = b[3] = -Infinity;
        let top = -1;
        for (const c of this.list) {
            const R = Math.max(c.ra, c.rb) * QMAX * 1.08;
            b[0] = Math.min(b[0], c.x - R); b[1] = Math.min(b[1], c.z - R); b[2] = Math.max(b[2], c.x + R); b[3] = Math.max(b[3], c.z + R);
            top = Math.max(top, c.slot);
        }
        CRATER_U.craterInfo.value.y = this.list.length;
        const box = CRATER_U.craterBox.value;
        box.set(1e9, 1e9, -1e9, -1e9);
        for (const c of this.list) {
            const R = Math.max(c.ra, c.rb) * c.reach * 1.1;
            box.x = Math.min(box.x, c.x - R); box.y = Math.min(box.y, c.z - R); box.z = Math.max(box.z, c.x + R); box.w = Math.max(box.w, c.z + R);
        }
        this.geo.setDrawRange(0, (top + 1) * IPS);
        if (!this.list.length) this.mesh.visible = false;
    }

    // ── the index grid: every cell within the crater's reach lists it ──
    registerGrid(c) {
        const R = Math.max(c.ra, c.rb) * c.reach * 1.1;
        const cx0 = Math.floor((c.x - R) / CELL), cx1 = Math.floor((c.x + R) / CELL);
        const cz0 = Math.floor((c.z - R) / CELL), cz1 = Math.floor((c.z + R) / CELL);
        for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
            // the cell's nearest point to the centre within R
            const nx = Math.max(cx * CELL, Math.min(c.x, cx * CELL + CELL)), nz = Math.max(cz * CELL, Math.min(c.z, cz * CELL + CELL));
            if ((nx - c.x) ** 2 + (nz - c.z) ** 2 > R * R) continue;
            const gi = ((cz % GRID) + GRID) % GRID * GRID + ((cx % GRID) + GRID) % GRID;
            if (c.cells.includes(gi)) continue; // (a crater wider than the grid's period: never, but be safe)
            let owners = this.cellOwners.get(gi);
            if (!owners) this.cellOwners.set(gi, owners = []);
            // full: the oldest crater here goes (the new blast has torn through it)
            while (owners.length >= SLOTS) {
                let old = owners[0];
                for (const e of owners) if (e.born < old.born) old = e;
                this.free(old);
                owners = this.cellOwners.get(gi) || [];
                if (!this.cellOwners.has(gi)) this.cellOwners.set(gi, owners);
            }
            owners.push(c);
            c.cells.push(gi);
            this.writeCell(gi, owners);
        }
    }

    unregisterCell(gi, c) {
        const owners = this.cellOwners.get(gi);
        if (!owners) return;
        const k = owners.indexOf(c);
        if (k >= 0) owners.splice(k, 1);
        this.writeCell(gi, owners);
        if (!owners.length) this.cellOwners.delete(gi);
    }

    writeCell(gi, owners) {
        const row = Math.floor(gi / GRID), col = gi % GRID, o = (row * GRID * 2 + col * 2) * 4;
        for (let k = 0; k < SLOTS; k++) gridData[o + k] = k < owners.length ? owners[k].slot + 1 : 0;
        gridTex.addUpdateRange(o, 8);
        gridTex.needsUpdate = true;
    }

    writeData(c) {
        const s = c.slot;
        let o = s * 4;
        dataArr[o] = c.x; dataArr[o + 1] = c.z; dataArr[o + 2] = c.dx; dataArr[o + 3] = c.dz;
        o = (CRATER_MAX + s) * 4;
        dataArr[o] = c.ra; dataArr[o + 1] = c.rb; dataArr[o + 2] = c.depth; dataArr[o + 3] = c.rim;
        o = (CRATER_MAX * 2 + s) * 4;
        dataArr[o] = c.fade; dataArr[o + 1] = c.seed; dataArr[o + 2] = c.scorch; dataArr[o + 3] = c.reach;
        this.dataDirty = true;
    }

    // world position of hole-radius coordinates (lx along the long axis)
    toWorld(c, lx, lz, out) {
        out.x = c.x + c.dx * lx * c.ra - c.dz * lz * c.rb;
        out.z = c.z + c.dz * lx * c.ra + c.dx * lz * c.rb;
        return out;
    }

    // Lay the crater's mesh on the ground as drawn now. colours: also (re)compute the ground colours
    conform(c, colours) {
        const w = this.world, s = c.slot, b = s * VPS;
        const P = this.aPos.array, N = this.aNor.array, Col = this.aCol.array, CR = this.aCr.array;
        const ds = this._ds, col = this._col, p = { x: 0, z: 0 };
        for (let k = 0; k < c.tileKeys.length; k++) { const t = w.tiles.get(c.tileKeys[k]); c.tileGeos[k] = t && t.mesh ? t.mesh.geometry : null; }
        const towns = w.towns, T = w.TILE;
        let ltx = NaN, ltz = NaN, lt;
        const ground = (x, z) => {
            const tx = Math.floor(x / T), tz = Math.floor(z / T);
            if (tx !== ltx || tz !== ltz) { ltx = tx; ltz = tz; lt = w.tiles.get(w.tileKey(tx, tz)); }
            w.drawnSampleIn(lt, x, z, ds);
            // the drawn ground is pulled just under a road; the tarmac lies on it (roads.js UNDER)
            if (towns && towns.onStreet && towns.onStreet(x, z)) ds.h += 0.25;
            return ds;
        };
        // the ground's colour (as the terrain tiles paint it) varies slowly: sampled on a coarse grid over the
        // crater and interpolated, rather than worked out at every vertex
        const R = Math.max(c.ra, c.rb) * 2.9, G = CGRID, cg = this._cg;
        if (colours) for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
            const x = c.x - R + (2 * R * i) / (G - 1), z = c.z - R + (2 * R * j) / (G - 1);
            ground(x, z);
            w.colorAt(x, ds.h, z, ds.ny, cg, (j * G + i) * 3);
        }
        const colourAt = (x, z, out, o) => {
            const fx = Math.min(Math.max((x - c.x + R) / (2 * R) * (G - 1), 0), G - 1.001), fz = Math.min(Math.max((z - c.z + R) / (2 * R) * (G - 1), 0), G - 1.001);
            const i = Math.floor(fx), j = Math.floor(fz), a = fx - i, bb = fz - j, k = (j * G + i) * 3;
            for (let e = 0; e < 3; e++) out[o + e] = (cg[k + e] * (1 - a) + cg[k + 3 + e] * a) * (1 - bb) + (cg[k + G * 3 + e] * (1 - a) + cg[k + G * 3 + 3 + e] * a) * bb;
        };
        const put = (v, lx, lz, kind) => {
            this.toWorld(c, lx, lz, p);
            ground(p.x, p.z);
            P[v * 3] = p.x; P[v * 3 + 1] = ds.h; P[v * 3 + 2] = p.z;
            N[v * 3] = ds.nx; N[v * 3 + 1] = ds.ny; N[v * 3 + 2] = ds.nz;
            if (colours) colourAt(p.x, p.z, Col, v * 3);
            CR[v * 4] = lx; CR[v * 4 + 1] = lz; CR[v * 4 + 2] = s; CR[v * 4 + 3] = kind;
        };
        put(b, 0, 0, 0);
        for (let r = 1; r < NR; r++) for (let j = 0; j < SEGS; j++) {
            const a = (j / SEGS) * Math.PI * 2 - Math.PI, ql = RINGS[r] * radW(a, c.seed);
            put(b + 1 + (r - 1) * SEGS + j, ql * Math.cos(a), ql * Math.sin(a), 0);
        }
        // clods: chunks of earth on the rim and scattered beyond it, half buried (the same ones every time)
        const rnd = mulberry32(Math.floor(c.seed * 1e6) + 17);
        const rmax = Math.max(c.ra, c.rb);
        const v0 = b + 1 + (NR - 1) * SEGS;
        for (let k = 0; k < CLODS; k++) {
            const base = v0 + k * CV;
            if (k >= c.clods) {
                P.fill(0, base * 3, (base + CV) * 3);
                for (let v = base * 4, e = (base + CV) * 4; v < e; v += 4) { CR[v] = 0; CR[v + 1] = 0; CR[v + 2] = s; CR[v + 3] = 2; }
                continue;
            }
            const a = rnd() * Math.PI * 2 - Math.PI, u = rnd();
            const q = 0.97 + 1.7 * Math.pow(u, 1.6);
            const lx = q * Math.cos(a), lz = q * Math.sin(a);
            this.toWorld(c, lx, lz, p);
            ground(p.x, p.z);
            if (colours) colourAt(p.x, p.z, col, 0);
            const size = rmax * (0.04 + 0.05 * rnd()) * (1.3 - 0.3 * (q - 1));
            // a lump: a jittered box, tumbled, flat shaded, a third of it in the ground
            const e1 = _eu.set((rnd() - 0.5) * 0.9, rnd() * 6.283, (rnd() - 0.5) * 0.9), m = _m4.makeRotationFromEuler(e1).elements;
            const sx = 0.6 + 0.5 * rnd(), sy = 0.28 + 0.2 * rnd(), sz = 0.5 + 0.5 * rnd();
            const pts = [];
            for (let c8 = 0; c8 < 8; c8++) {
                const x = ((c8 & 1) ? 1 : -1) * sx * (0.55 + 0.9 * rnd()), y = ((c8 & 2) ? 1 : -1) * sy * (0.55 + 0.9 * rnd()), z = ((c8 & 4) ? 1 : -1) * sz * (0.55 + 0.9 * rnd());
                pts.push([(m[0] * x + m[4] * y + m[8] * z) * size, (m[1] * x + m[5] * y + m[9] * z) * size - size * 0.1, (m[2] * x + m[6] * y + m[10] * z) * size]);
            }
            const faces = BOX_FACES;
            let v = base;
            for (const f of faces) {
                let [A, B, C] = f.map(i => pts[i]);
                let ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
                let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
                const mx = A[0] + B[0] + C[0], my = A[1] + B[1] + C[1] + size * 0.3, mz = A[2] + B[2] + C[2]; // (from the lump's centre)
                if (nx * mx + ny * my + nz * mz < 0) { [B, C] = [C, B]; nx = -nx; ny = -ny; nz = -nz; }
                const il = 1 / (Math.hypot(nx, ny, nz) || 1);
                for (const Q of [A, B, C]) {
                    P[v * 3] = p.x + Q[0]; P[v * 3 + 1] = ds.h + Q[1]; P[v * 3 + 2] = p.z + Q[2];
                    // half the face's normal, half the way out from the middle: a soft lump, not a crate
                    const rx = Q[0], ry = Q[1] + size * 0.1, rz = Q[2], rl = 1 / (Math.hypot(rx, ry, rz) || 1);
                    const bx = nx * il * 0.45 + rx * rl * 0.55, by = ny * il * 0.45 + ry * rl * 0.55, bz = nz * il * 0.45 + rz * rl * 0.55, bl = 1 / (Math.hypot(bx, by, bz) || 1);
                    N[v * 3] = bx * bl; N[v * 3 + 1] = by * bl; N[v * 3 + 2] = bz * bl;
                    if (colours) { Col[v * 3] = col[0]; Col[v * 3 + 1] = col[1]; Col[v * 3 + 2] = col[2]; }
                    CR[v * 4] = lx; CR[v * 4 + 1] = lz; CR[v * 4 + 2] = s; CR[v * 4 + 3] = 1;
                    v++;
                }
            }
        }
        this.touch(s);
    }

    // Per frame: dig in / fill in, follow terrain tiles that changed resolution, upload what changed
    update(dt) {
        const list = this.list;
        for (let i = list.length - 1; i >= 0; i--) {
            const c = list[i];
            if (c.fade !== c.target && dt > 0) {
                c.fade = c.target > c.fade ? Math.min(c.target, c.fade + dt / FORM) : Math.max(c.target, c.fade - dt / FADE_OUT);
                this.writeData(c);
                if (c.fade <= 0 && c.target <= 0) { this.free(c); continue; }
            }
            if (c.queued) continue;
            const tiles = this.world.tiles;
            for (let k = 0; k < c.tileKeys.length; k++) {
                const t = tiles.get(c.tileKeys[k]);
                if ((t && t.mesh ? t.mesh.geometry : null) !== c.tileGeos[k]) { c.queued = true; this.reconform.push(c); break; }
            }
        }
        // (a tile under many craters changing resolution mustn't re-lay them all in one frame)
        for (let n = 0; n < 3 && this.reconform.length; n++) {
            const c = this.reconform.shift();
            c.queued = false;
            if (c.slot >= 0) this.conform(c, false);
        }
        if (this.dataDirty) { dataTex.needsUpdate = true; this.dataDirty = false; }
    }
}

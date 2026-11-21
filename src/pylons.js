// ═══════════════════════════════════════════════════════════════
// Visible stores: the pylons, launch rails, ejector racks and rocket pods under the wings and the fuselage, with the
// jet's own loadout on them (stores.js: an F-16's AIM-120s on its wingtips, a Su-35's R-77s between its engines),
// each one the shape weapons.js flies when it's fired (storeParts), so what leaves the pylon is what was hanging there.
//  • Where: stores.js STATIONS says which stations a type has (its real station map) and which stores go on which
//    (stationPlan). This file fits them to the model in front of it: the airframe's underside is rasterised once per
//    type into a height map (Fit), a wing station's pylon is stood on the skin there along its whole length (or the
//    model's own pylon is found and used), a fuselage station is hung from the belly under it, a wingtip rail from the
//    tip. Left is the mirror of right exactly (the height map is made symmetric first). A store that would hang into
//    the ground on the gear, or through a gear leg, is left off.
//  • Drawing: one mesh per damage section (damage.js: centre, left wing, right wing) holding that section's pylons,
//    racks and stores, colours per vertex (the pylons in the skin's colour where they stand, the stores in their own),
//    one material for all of them, hung on the section so a wing that's shot off takes its stores with it. A store
//    that has gone is taken out of the index buffer (and put back by a rearm). Built only for a jet close enough to
//    see them (storesNear: by its size on screen, well before farmodel.js takes over) and freed again when it isn't.
//  • Counting: nothing here owns ammunition. syncStores compares what hangs with the aircraft's own counters
//    (ac.missiles, ac.bombs, ...) every frame it is shown, so a rearm, a resupply or a sandbox top-up puts stores back
//    and anything that spends them takes them off. What a type can't hang outside (a bay carrier's whole load, a
//    B-52's bombs, the X-100's fifty Harpoons) is "inside": the stores outside go first, then the rest from the bay.
//  • Releasing: weapons.js asks Aircraft.releaseStore (releaseStore here) where a weapon starts: the next store of
//    its class in the release order (the last station given out first, right and left by turns), which vanishes from
//    its pylon as the weapon appears there. Rockets come out of their pods, which stay.
//  • A lost wing: its stores go with it, and their ammunition is gone (the counters are cut by what hung there).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { CLASSES, CLASS, storeFor, stationPlan, stationsOf, podOf } from './stores.js';
import { storeParts } from './weapons.js';
import { regionAt } from './damage.js';

// a jet shows its stores above SHOW_PX of length on screen and drops them below HIDE_PX (farmodel.js takes the whole
// jet at ~12 px): an AIM-120 is then about 7 px long and a pixel thick
export const SHOW_PX = 30, HIDE_PX = 24;

const _v = new THREE.Vector3(), _c = new THREE.Color();
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const FITS = new Map();      // type → Fit | null (a model that couldn't be measured)
const TEMPLATES = new Map(); // store id → its vertices, ready to copy
const RACK_COLOR = 0x6d7175, POD_FACE = 0x1c1d1f;
let material = null;
function storesMaterial() {
    if (!material) {
        // (the airframe's own finish: a painted, barely metallic skin; its own material so it never shares a program
        // with meshes that differ in shadows or instancing)
        material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.12, envMapIntensity: 0.6 });
        material.name = 'stores';
        material.userData.noPaint = true; // (liveries leave it alone: the pylons take the skin's colour themselves)
    }
    return material;
}

// ── The airframe's underside (and top) as a height map, once per type ──
// Model space: x to the right wing, y up, z aft. `und` is the lowest surface over each cell, `ovr` the highest, both
// made symmetric (the higher underside of the two sides, so a pylon stood on it never hangs clear of either).
class Fit {
    constructor(ac) {
        const L = ac.spec.length;
        const box = new THREE.Box3();
        const parts = skinParts(ac);
        for (const p of parts) { p.mesh.geometry.computeBoundingBox(); box.union(_bb.copy(p.mesh.geometry.boundingBox).applyMatrix4(p.m)); }
        this.L = L;
        this.hs = Math.max(-box.min.x, box.max.x);
        this.cell = clamp(L / 240, 0.05, 0.16);
        const pad = 0.4;
        this.X0 = this.hs + pad; this.Z0 = Math.max(-box.min.z, box.max.z) + pad;
        this.nx = Math.ceil(2 * this.X0 / this.cell); this.nz = Math.ceil(2 * this.Z0 / this.cell);
        const n = this.nx * this.nz;
        const lo = new Float32Array(n).fill(Infinity), hi = new Float32Array(n).fill(-Infinity);
        const { cell, X0, Z0, nx, nz } = this;
        const put = (x, y, z) => {
            const ix = Math.floor((x + X0) / cell), iz = Math.floor((z + Z0) / cell);
            if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return;
            const k = iz * nx + ix;
            if (y < lo[k]) lo[k] = y;
            if (y > hi[k]) hi[k] = y;
        };
        const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        const step = cell * 0.5;
        const edge = (p, q) => {
            const k = Math.ceil(Math.max(Math.abs(q.x - p.x), Math.abs(q.z - p.z)) / step);
            for (let i = 1; i < k; i++) { const u = i / k; put(p.x + (q.x - p.x) * u, p.y + (q.y - p.y) * u, p.z + (q.z - p.z) * u); }
        };
        for (const { mesh, m } of parts) {
            const g = mesh.geometry, P = g.attributes.position, idx = g.index;
            const cnt = idx ? idx.count : P.count;
            for (let t = 0; t + 2 < cnt; t += 3) {
                a.fromBufferAttribute(P, idx ? idx.getX(t) : t).applyMatrix4(m);
                b.fromBufferAttribute(P, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(m);
                c.fromBufferAttribute(P, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(m);
                put(a.x, a.y, a.z); put(b.x, b.y, b.z); put(c.x, c.y, c.z);
                const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) + X0) / cell)), i1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) + X0) / cell));
                const k0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) + Z0) / cell)), k1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) + Z0) / cell));
                if (i0 >= i1 && k0 >= k1) continue; // (inside one cell: its corners said it all)
                // its edges (a thin sliver or a wall seen edge-on covers no cell centre), then every cell centre under it
                edge(a, b); edge(b, c); edge(c, a);
                const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
                if (Math.abs(den) < 1e-9) continue;
                for (let iz = k0; iz <= k1; iz++) {
                    const z = (iz + 0.5) * cell - Z0;
                    for (let ix = i0; ix <= i1; ix++) {
                        const x = (ix + 0.5) * cell - X0;
                        const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den, v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den, w = 1 - u - v;
                        if (u < 0 || v < 0 || w < 0) continue;
                        const y = a.y * u + b.y * v + c.y * w, k = iz * nx + ix;
                        if (y < lo[k]) lo[k] = y;
                        if (y > hi[k]) hi[k] = y;
                    }
                }
            }
        }
        this.und = new Float32Array(n); this.ovr = new Float32Array(n);
        for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
            const k = iz * nx + ix, q = iz * nx + (nx - 1 - ix);
            const l0 = lo[k], l1 = lo[q], h0 = hi[k], h1 = hi[q];
            this.und[k] = l0 < Infinity ? (l1 < Infinity ? Math.max(l0, l1) : l0) : (l1 < Infinity ? l1 : NaN);
            this.ovr[k] = h0 > -Infinity ? (h1 > -Infinity ? Math.min(h0, h1) : h0) : (h1 > -Infinity ? h1 : NaN);
        }
        this.tip = this.findTip();
        this.skin = skinSample(parts, this.hs, L);
    }
    ix(x) { return Math.floor((x + this.X0) / this.cell); }
    iz(z) { return Math.floor((z + this.Z0) / this.cell); }
    xOf(ix) { return (ix + 0.5) * this.cell - this.X0; }
    zOf(iz) { return (iz + 0.5) * this.cell - this.Z0; }
    cellAt(A, ix, iz) { return ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz ? NaN : A[iz * this.nx + ix]; }
    under(x, z) { return this.cellAt(this.und, this.ix(x), this.iz(z)); }
    over(x, z) { return this.cellAt(this.ovr, this.ix(x), this.iz(z)); }
    // the lowest underside (or the highest top: A = ovr, top = true) over a rectangle; NaN where there's no airframe
    extreme(x0, x1, z0, z1, A = this.und, top = false) {
        let best = NaN;
        const i0 = this.ix(Math.min(x0, x1)), i1 = this.ix(Math.max(x0, x1)), k0 = this.iz(z0), k1 = this.iz(z1);
        for (let iz = k0; iz <= k1; iz++) for (let ix = i0; ix <= i1; ix++) {
            const y = this.cellAt(A, ix, iz);
            if (y === y && !(top ? y <= best : y >= best)) best = y;
        }
        return best;
    }
    // the wing's chord at x: the run of airframe along z there that lies most in the wing's part of the length
    chord(x) {
        const ix = this.ix(Math.abs(x)), lim = 0.32 * this.L;
        let best = null, bestScore = 0, start = -1, gap = 0;
        const close = (end) => {
            if (start < 0) return;
            const le = this.zOf(start) - this.cell / 2, te = this.zOf(end) + this.cell / 2;
            const score = Math.min(te, lim) - Math.max(le, -lim);
            if (score > bestScore) { bestScore = score; best = { le, te }; }
            start = -1;
        };
        let last = -1;
        for (let iz = 0; iz < this.nz; iz++) {
            const y = this.cellAt(this.und, ix, iz);
            if (y === y) { if (start < 0) start = iz; last = iz; gap = 0; } else if (start >= 0 && ++gap > 2) close(last);
        }
        close(last);
        return best;
    }
    // the wingtip: its outer face, its height there and the chord it has in its last 12 cm
    findTip() {
        let top = -1;
        for (let ix = this.nx - 1; ix >= this.nx / 2 && top < 0; ix--) {
            let cnt = 0;
            for (let iz = 0; iz < this.nz; iz++) if (this.und[iz * this.nx + ix] === this.und[iz * this.nx + ix]) cnt++;
            if (cnt >= 2) top = ix;
        }
        if (top < 0) return null;
        const cols = Math.max(2, Math.round(0.12 / this.cell));
        let z0 = Infinity, z1 = -Infinity, sum = 0, cnt = 0, low = Infinity;
        for (let ix = top; ix > top - cols; ix--) for (let iz = 0; iz < this.nz; iz++) {
            const u = this.und[iz * this.nx + ix], o = this.ovr[iz * this.nx + ix];
            if (u !== u) continue;
            const z = this.zOf(iz);
            if (z < z0) z0 = z; if (z > z1) z1 = z;
            sum += (u + o) / 2; cnt++;
            if (u < low) low = u;
        }
        return { x: this.xOf(top) + this.cell / 2, y: sum / cnt, low, z0: z0 - this.cell / 2, z1: z1 + this.cell / 2 };
    }
    // A pylon the model already has under its wing near x (± win): a narrow dip below the wing's own underside.
    // { x, y: its foot, z0, z1 } or null
    ownPylon(x, win) {
        const ch = this.chord(x);
        if (!ch) return null;
        const z0 = ch.le + (ch.te - ch.le) * 0.08, z1 = ch.te - (ch.te - ch.le) * 0.08;
        const i0 = this.ix(x - win), i1 = this.ix(x + win), k0 = this.iz(z0), k1 = this.iz(z1);
        const low = [];
        for (let ix = i0; ix <= i1; ix++) {
            let m = Infinity;
            for (let iz = k0; iz <= k1; iz++) { const y = this.cellAt(this.und, ix, iz); if (y < m) m = y; }
            low.push(m);
        }
        const fin = low.filter(v => v < Infinity).sort((p, q) => p - q);
        if (fin.length < 5) return null;
        const med = fin[fin.length >> 1];
        let bi = 0;
        for (let i = 1; i < low.length; i++) if (low[i] < low[bi]) bi = i;
        const depth = med - low[bi];
        if (!(depth > 0.07)) return null;
        // the columns of the dip, and its extent along the chord against a clean column beside it
        let a = bi, b = bi;
        while (a > 0 && low[a - 1] < med - depth * 0.5) a--;
        while (b < low.length - 1 && low[b + 1] < med - depth * 0.5) b++;
        const cx = (this.xOf(i0 + a) + this.xOf(i0 + b)) / 2;
        let ref = -1;
        for (let d = 1; d < low.length && ref < 0; d++) for (const i of [a - d, b + d]) if (i >= 0 && i < low.length && low[i] < Infinity && low[i] > med - depth * 0.25) { ref = i; break; }
        let pz0 = Infinity, pz1 = -Infinity, foot = Infinity;
        for (let iz = k0; iz <= k1; iz++) {
            let y = Infinity;
            for (let i = a; i <= b; i++) { const u = this.cellAt(this.und, i0 + i, iz); if (u < y) y = u; }
            const base = ref >= 0 ? this.cellAt(this.und, i0 + ref, iz) : med;
            if (!(y < (base === base ? base : med) - 0.05)) continue;
            const z = this.zOf(iz);
            if (z < pz0) pz0 = z; if (z > pz1) pz1 = z;
            if (y < foot) foot = y;
        }
        if (!(pz1 > pz0)) return null;
        return { x: cx, y: foot, z0: pz0 - this.cell / 2, z1: pz1 + this.cell / 2, depth };
    }
    // the same on top of the wing (an overwing launcher): { x, y: its top, z0, z1 } or null
    ownOver(x, win) {
        const ch = this.chord(x);
        if (!ch) return null;
        const i0 = this.ix(x - win), i1 = this.ix(x + win), k0 = this.iz(ch.le), k1 = this.iz(ch.te);
        const high = [];
        for (let ix = i0; ix <= i1; ix++) {
            let m = -Infinity;
            for (let iz = k0; iz <= k1; iz++) { const y = this.cellAt(this.ovr, ix, iz); if (y > m) m = y; }
            high.push(m);
        }
        const fin = high.filter(v => v > -Infinity).sort((p, q) => p - q);
        if (fin.length < 5) return null;
        const med = fin[fin.length >> 1];
        let bi = 0;
        for (let i = 1; i < high.length; i++) if (high[i] > high[bi]) bi = i;
        const rise = high[bi] - med;
        if (!(rise > 0.07)) return null;
        let a = bi, b = bi;
        while (a > 0 && high[a - 1] > med + rise * 0.5) a--;
        while (b < high.length - 1 && high[b + 1] > med + rise * 0.5) b++;
        let pz0 = Infinity, pz1 = -Infinity;
        for (let iz = k0; iz <= k1; iz++) {
            let y = -Infinity;
            for (let i = a; i <= b; i++) { const o = this.cellAt(this.ovr, i0 + i, iz); if (o > y) y = o; }
            if (!(y > med + rise * 0.5)) continue;
            const z = this.zOf(iz);
            if (z < pz0) pz0 = z; if (z > pz1) pz1 = z;
        }
        return pz1 > pz0 ? { x: (this.xOf(i0 + a) + this.xOf(i0 + b)) / 2, y: high[bi], z0: pz0, z1: pz1 } : null;
    }
}
const _bb = new THREE.Box3();

// the meshes that are the airframe's skin, each with its matrix into model space: the damage sections' own meshes and
// the flaps and brakes cut from them (where they lie stowed, whatever they're doing now); not the gear, props, flames,
// lights, rig parts, glass or the stores themselves
function skinParts(ac) {
    const out = [];
    const stowed = new Map();
    for (const s of ac.surfaces || []) stowed.set(s.pivot, s.base);
    const take = (mesh, m) => {
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!mesh.geometry || !mesh.geometry.attributes.position || mesh.userData.stores || mesh.userData.surfaceWell || (mat && mat.transparent)) return;
        out.push({ mesh, m });
    };
    const regions = Object.values(ac.regions || {});
    const roots = regions.length ? regions : [ac.model];
    for (const g of roots) {
        const gm = new THREE.Matrix4();
        if (g !== ac.model) gm.makeTranslation(g.position.x, g.position.y, g.position.z);
        for (const ch of g.children) {
            if (ch.isMesh) { take(ch, new THREE.Matrix4().copy(gm).multiply(_m.compose(ch.position, ch.quaternion, ch.scale))); continue; }
            if (!ch.userData.surface) continue;
            const base = stowed.get(ch) || ch.position;
            const pm = new THREE.Matrix4().copy(gm).multiply(_m.makeTranslation(base.x, base.y, base.z));
            ch.traverse((o) => {
                if (!o.isMesh) return;
                // (a surface's meshes sit directly on its pivot)
                const local = new THREE.Matrix4();
                for (let p = o; p && p !== ch; p = p.parent) local.premultiply(_m.compose(p.position, p.quaternion, p.scale));
                take(o, new THREE.Matrix4().copy(pm).multiply(local));
            });
        }
    }
    return out;
}
const _m = new THREE.Matrix4();

// where to read the skin's colour for the pylons: the material and texture coordinates of the wing's underside about
// half way out: { name, u, v } (name: the material's, as the file has it)
function skinSample(parts, hs, L) {
    let best = null, bestScore = Infinity;
    const p = new THREE.Vector3();
    // the part with the most triangles out there is the skin
    for (const { mesh, m } of parts) {
        const g = mesh.geometry, P = g.attributes.position, uv = g.attributes.uv;
        const mat = mesh.userData.origMat || (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
        const stepN = Math.max(1, Math.floor(P.count / 3000));
        for (let i = 0; i < P.count; i += stepN) {
            p.fromBufferAttribute(P, i).applyMatrix4(m);
            // near (0.45 hs, mid length), and low: the underside
            const score = Math.abs(Math.abs(p.x) - 0.45 * hs) + Math.abs(p.z - 0.05 * L) * 0.5 + (p.y + L) * 0.3;
            if (score < bestScore) { bestScore = score; best = { name: mat ? mat.name : '', u: uv ? uv.getX(i) : 0, v: uv ? uv.getY(i) : 0 }; }
        }
    }
    return best;
}

function fitFor(ac) {
    if (FITS.has(ac.type)) return FITS.get(ac.type);
    if (!ac.model || (ac.lostRegions && ac.lostRegions.size)) return null; // (measured on a whole one: wait for it)
    let fit = null;
    try { fit = new Fit(ac); } catch (e) { console.warn('[pylons] could not measure', ac.type, e); }
    FITS.set(ac.type, fit);
    return fit;
}

// ── The skin's colour where the pylons stand: its material's colour times its texture there ──
const texels = new WeakMap(); // texture → { w, h, data } | null
function texelsOf(tex) {
    if (texels.has(tex)) return texels.get(tex);
    let s = null;
    try {
        const img = tex.image;
        if (img && typeof document !== 'undefined') {
            const cv = document.createElement('canvas');
            cv.width = cv.height = 128;
            const ctx = cv.getContext('2d', { willReadFrequently: true });
            if (ctx && ctx.getImageData) {
                ctx.drawImage(img, 0, 0, 128, 128);
                const d = ctx.getImageData(0, 0, 128, 128).data;
                if (d && d.length === 128 * 128 * 4) s = { w: 128, h: 128, data: d };
            }
        }
    } catch (e) { s = null; }
    texels.set(tex, s);
    return s;
}
// the mesh on this jet that carries the fit's skin material, and its colour now (a livery swaps the material)
function skinMesh(ac, fit) {
    const name = fit.skin ? fit.skin.name : '';
    let found = null, any = null;
    for (const g of Object.values(ac.regions || {})) {
        for (const ch of g.children) {
            if (!ch.isMesh || ch.userData.stores) continue;
            const base = ch.userData.origMat || ch.material;
            if (base && !base.transparent && !any) any = ch;
            if (base && base.name === name) { found = ch; break; }
        }
        if (found) break;
    }
    return found || any;
}
function skinColor(mesh, fit, out) {
    const mat = mesh && (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material);
    if (!mat || !mat.color) return out.setRGB(0.3, 0.32, 0.34);
    out.copy(mat.color);
    const tx = mat.map && texelsOf(mat.map);
    if (tx && fit.skin) {
        // a few texels round the point, so one panel line doesn't decide it
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -2; dy <= 2; dy += 2) for (let dx = -2; dx <= 2; dx += 2) {
            const px = (((Math.floor(fit.skin.u * tx.w) + dx) % tx.w) + tx.w) % tx.w, py = (((Math.floor(fit.skin.v * tx.h) + dy) % tx.h) + tx.h) % tx.h;
            const o = (py * tx.w + px) * 4;
            r += (tx.data[o] / 255) ** 2.2; g += (tx.data[o + 1] / 255) ** 2.2; b += (tx.data[o + 2] / 255) ** 2.2; n++;
        }
        out.r *= r / n; out.g *= g / n; out.b *= b / n;
    } else if (mat.map) out.multiplyScalar(0.45); // (a textured skin we can't read: a mid grey of its tint)
    return out;
}

// ── Geometry: everything of one damage section in one set of arrays ──
class Mesher {
    constructor(ox, oy, oz) { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.ox = ox; this.oy = oy; this.oz = oz; }
    get verts() { return this.pos.length / 3; }
    // a copy of a template at (x, y, z): returns its range in the index buffer [start, count]
    add(t, x, y, z) {
        const base = this.verts, P = t.pos, N = t.nor, C = t.col, I = t.idx, start = this.idx.length;
        const dx = x - this.ox, dy = y - this.oy, dz = z - this.oz;
        for (let i = 0; i < P.length; i += 3) { this.pos.push(P[i] + dx, P[i + 1] + dy, P[i + 2] + dz); this.nor.push(N[i], N[i + 1], N[i + 2]); this.col.push(C[i], C[i + 1], C[i + 2]); }
        for (let i = 0; i < I.length; i++) this.idx.push(base + I[i]);
        return [start, I.length];
    }
    // a flat four-sided face (model space corners, in order round it), facing away from `inside`
    quad(a, b, c, d, inside, col) {
        let nx = (b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]);
        let ny = (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]);
        let nz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const flip = nx * (a[0] - inside[0]) + ny * (a[1] - inside[1]) + nz * (a[2] - inside[2]) < 0;
        if (flip) { nx = -nx; ny = -ny; nz = -nz; }
        const base = this.verts;
        for (const p of flip ? [a, d, c, b] : [a, b, c, d]) { this.pos.push(p[0] - this.ox, p[1] - this.oy, p[2] - this.oz); this.nor.push(nx, ny, nz); this.col.push(col[0], col[1], col[2]); }
        this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    // a box centred at (x, y, z)
    box(x, y, z, sx, sy, sz, col) {
        const x0 = x - sx / 2, x1 = x + sx / 2, y0 = y - sy / 2, y1 = y + sy / 2, z0 = z - sz / 2, z1 = z + sz / 2, c = [x, y, z];
        this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], c, col);
        this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c, col);
        this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], c, col);
        this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], c, col);
        this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c, col);
        this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], c, col);
    }
    // A pylon: a blade standing on the skin from z0 to z1 at x, its top following the skin (top(z): the skin's height,
    // a little inside it), its foot level at yFoot and a little shorter, raked forward at the leading edge, pointed
    // fore and aft
    pylon(x, z0, z1, yFoot, top, thick, col) {
        const K = 6, taper = [0.06, 0.8, 1, 1, 0.75, 0.06];
        const zc = (z0 + z1) / 2, len = z1 - z0;
        const sec = [];
        let lastTop = yFoot + 0.25;
        for (let i = 0; i < K; i++) {
            const zt = z0 + len * i / (K - 1), zb = zc + (zt - zc) * 0.84 - len * 0.03;
            let yt = top(zt);
            if (yt !== yt) yt = lastTop; else lastTop = yt;
            sec.push({ zt, zb, yt: Math.max(yt, yFoot + 0.02), h: thick / 2 * taper[i] });
        }
        const inside = [x, yFoot + 0.1, zc];
        for (let i = 0; i < K - 1; i++) {
            const p = sec[i], q = sec[i + 1];
            for (const s of [-1, 1]) this.quad([x + s * p.h, p.yt, p.zt], [x + s * q.h, q.yt, q.zt], [x + s * q.h, yFoot, q.zb], [x + s * p.h, yFoot, p.zb], inside, col);
            this.quad([x - p.h, yFoot, p.zb], [x + p.h, yFoot, p.zb], [x + q.h, yFoot, q.zb], [x - q.h, yFoot, q.zb], inside, col);
        }
        for (const p of [sec[0], sec[K - 1]]) this.quad([x - p.h, p.yt, p.zt], [x + p.h, p.yt, p.zt], [x + p.h, yFoot, p.zb], [x - p.h, yFoot, p.zb], inside, col);
    }
    geometry() {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
        g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(this.col), 3, true));
        g.setIndex(new THREE.BufferAttribute(this.verts > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
        g.computeBoundingSphere();
        return g;
    }
}
const rgb = (hex) => { _c.set(hex); return [Math.round(_c.r * 255), Math.round(_c.g * 255), Math.round(_c.b * 255)]; };

// a store's vertices ready to copy: the shape weapons.js flies (its pop-out wings still folded), its colour per
// vertex, the seeker dome dark glass
function templateOf(W) {
    let t = TEMPLATES.get(W.id);
    if (t) return t;
    const e = storeParts(W, true);
    const parts = [[e.geo, rgb(W.color ?? 0xd8d8d2)]];
    if (e.nose) parts.push([e.nose, rgb(0x1b1f24)]);
    t = packTemplate(parts);
    t.R = e.R; t.half = e.half; t.len = e.len;
    TEMPLATES.set(W.id, t);
    return t;
}
function packTemplate(parts) {
    const pos = [], nor = [], col = [], idx = [];
    for (const [g, c] of parts) {
        const base = pos.length / 3, P = g.attributes.position, N = g.attributes.normal, I = g.index;
        for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(c[0], c[1], c[2]); }
        if (I) for (let i = 0; i < I.count; i++) idx.push(base + I.getX(i)); else for (let i = 0; i < P.count; i++) idx.push(base + i);
    }
    return { pos, nor, col, idx };
}
// a rocket pod (stores.js PODS): a tube with a dark face of launch tubes at the front and a tapered tail, nose to −Z
function podTemplate(W) {
    const key = 'pod:' + W.id;
    let t = TEMPLATES.get(key);
    if (t) return t;
    const P = podOf(W), R = P.dia / 2, L = P.len, top = L / 2;
    const body = new THREE.LatheGeometry([new THREE.Vector2(0.001, -top), new THREE.Vector2(R * 0.5, -top), new THREE.Vector2(R, -top + L * 0.16), new THREE.Vector2(R, top - L * 0.05), new THREE.Vector2(R * 0.9, top)], 14);
    const face = new THREE.CircleGeometry(R * 0.9, 14);
    face.rotateX(-Math.PI / 2); face.translate(0, top, 0);
    body.rotateX(-Math.PI / 2); face.rotateX(-Math.PI / 2);
    t = packTemplate([[body, rgb(W.color ?? 0xd6d6cf)], [face, rgb(POD_FACE)]]);
    t.R = R; t.half = R; t.len = L; t.pod = P;
    TEMPLATES.set(key, t);
    return t;
}

// ── A rack's worth of stores under a station's foot (0, 0, 0): where each hangs (dx: + outboard, dy, dz) in the
// order they are released, and the hardware between them and the pylon ──
const RAIL_CLASSES = new Set(['srm', 'lrm', 'agm', 'arm']);
function rackOf(t, cls, n, cap, tandem) {
    const R = t.R, len = t.len, zs = -0.06 * len;
    const rail = RAIL_CLASSES.has(cls) && !t.pod ? (cls === 'srm' ? 0.08 : 0.1) : 0; // a launch rail's depth
    const railLen = clamp(0.74 * len, 1.1, 3.0);
    const spots = [], hw = []; // hw: boxes [x, y, z, sx, sy, sz, kind]
    const single = (x, y, z) => {
        if (rail) hw.push([x, y - rail / 2, z, 0.075, rail, railLen, 'rail']);
        spots.push({ dx: x, dy: y - rail - R - 0.008, dz: z });
    };
    const triple = (z, k) => {
        // an ejector rack's beam, a store under it and one on either shoulder
        const bl = clamp(0.72 * len, 1.1, 2.3);
        hw.push([0, -0.085, z, 0.14, 0.17, bl, 'rack']);
        const sx = 0.07 + R + 0.012;
        if (k >= 3 || k === 1) spots.push({ dx: 0, dy: -0.17 - R - 0.01, dz: z });
        if (k >= 2) spots.push({ dx: sx, dy: -0.085, dz: z }, { dx: -sx, dy: -0.085, dz: z });
    };
    if (n <= 1 || cap <= 1) single(0, 0, zs);
    else if (tandem) {
        // two in line under a long adapter
        const g = len / 2 + 0.07;
        hw.push([0, -0.045, zs, 0.1, 0.09, Math.min(2 * len * 0.8, 2 * g + 1), 'rack']);
        spots.push({ dx: 0, dy: -0.09 - R - 0.01, dz: zs + g }, { dx: 0, dy: -0.09 - R - 0.01, dz: zs - g });
    } else if (cap === 2) {
        // side by side on a twin adapter
        const sp = Math.max(0.36, 2 * t.half + 0.05);
        hw.push([0, -0.045, zs, sp + 0.1, 0.09, clamp(0.5 * len, 0.8, 1.6), 'rack']);
        single(sp / 2, -0.09, zs); single(-sp / 2, -0.09, zs);
    } else if (cap >= 6) {
        // two triples in tandem on one long beam
        const g = len / 2 + 0.1, front = Math.ceil(n / 2), rear = n - front;
        hw.push([0, -0.06, zs, 0.16, 0.12, 2 * len + 0.5, 'rack']);
        if (rear) triple(zs + g, rear);
        triple(zs - g, front);
    } else triple(zs, n);
    let z0 = Infinity, z1 = -Infinity, w = t.half;
    for (const s of spots) { z0 = Math.min(z0, s.dz - len / 2); z1 = Math.max(z1, s.dz + len / 2); w = Math.max(w, Math.abs(s.dx) + t.half); }
    for (const h of hw) { z0 = Math.min(z0, h[2] - h[5] / 2); z1 = Math.max(z1, h[2] + h[5] / 2); }
    return { spots, hw, z0, z1, w, rail: rail > 0, hwLen: hw.length ? Math.max(...hw.map(h => h[5])) : len };
}

// ── Where the landing gear stands (model space), so nothing is hung through a leg ──
function gearLegs(ac) {
    const L = ac.spec.length, legs = [];
    if (ac.rig.gearContacts && ac.rig.gearContacts.length) for (const c of ac.rig.gearContacts) legs.push({ x: c.x, z: c.z, w: 0.3, l: 0.45 });
    else if (!ac.fixedGear) {
        // (aircraft.js buildGear's generic legs)
        const sc = clamp(L / 17, 0.8, 3.2), hs = ac.rig.halfSpan || ac.spec.span / 2;
        const heavy = ac.spec.category === 'civil' || ac.spec.category === 'bomber' || ac.spec.category === 'support';
        const mainX = heavy ? Math.min(hs * 0.25, L * 0.09) : Math.max(1.0, L * 0.075);
        const w = (L > 30 ? 0.36 : 0.14) * sc, l = (L > 30 ? 0.85 : 0.36) * sc;
        legs.push({ x: 0, z: -0.3 * L, w, l }, { x: -mainX, z: 0.04 * L, w, l }, { x: mainX, z: 0.04 * L, w, l });
    }
    return legs;
}

// ── Layout: the plan's stores placed on this model ──
// Returns { slots, meshers: { region: Mesher }, seq: { cls: [slot…] in the order they come back (the last is the
// next to leave) }, inside: { cls: n not shown } }
function layout(ac, fit, plan, lost, skinCol) {
    const L = ac.spec.length, hs = fit.hs, regions = ac.regions || {};
    const meshers = {}, slots = [], seq = {}, inside = { ...plan.inside };
    // (the ground under the parked jet, and where a leg's top is: the generic legs hang from the model's lowest point)
    const legs = gearLegs(ac), floor = -ac.gearOffset + 0.12, legTop = (ac.rig.minY ?? -1) + 0.2;
    const rackCol = rgb(RACK_COLOR), railCol = [Math.round(skinCol[0] * 0.8), Math.round(skinCol[1] * 0.8), Math.round(skinCol[2] * 0.8)];
    const mesherOf = (region) => {
        if (!meshers[region]) { const g = regions[region]; meshers[region] = g ? new Mesher(g.position.x, g.position.y, g.position.z) : new Mesher(0, 0, 0); }
        return meshers[region];
    };
    const pylons = new Set(); // generated pylons, by where they stand (a pylon and its side rails share one)
    const miss = (pl, n) => { inside[pl.cls] = (inside[pl.cls] || 0) + (pl.cls === 'rkt' ? 0 : n); };
    for (const pl of plan.places) {
        const t = pl.cls === 'rkt' ? podTemplate(pl.store) : templateOf(pl.store);
        const def = pl.def, released = [];
        for (const s of pl.pair ? [1, -1] : [0]) {
            const n = pl.pair ? (s > 0 ? Math.ceil(pl.n / 2) : Math.floor(pl.n / 2)) : pl.n;
            if (!n) continue;
            const out = s || 1; // which way is outboard
            const rack = def.dx || def.kind === 'tip' || def.kind === 'over' ? rackOf(t, pl.cls, 1, 1, false) : rackOf(t, pl.cls, n, pl.cap, pl.tandem);
            // the station's foot (where the rack hangs from), what to build above it, and how the store leaves
            let fx, fy, fz, railLaunch = false, hang = null, hardware = true;
            if (def.kind === 'tip') {
                const tip = fit.tip;
                if (!tip) { miss(pl, n); continue; }
                fz = (tip.z0 + tip.z1) / 2; railLaunch = true; hardware = false;
                if (def.under) {
                    // a rail under the tip, the missile below it
                    fx = out * (tip.x - 0.1); fy = tip.low - 0.1;
                    hang = (m) => m.box(fx, tip.low - 0.045, fz, 0.08, 0.11, 2.3, railCol);
                    rack.spots[0] = { dx: 0, dy: -t.R - 0.008, dz: -0.04 * t.len };
                } else {
                    // the missile outboard of the tip rail, in the wing's plane
                    const gap = def.own ? 0.012 : 0.1;
                    fx = out * (tip.x + gap + t.R); fy = tip.y;
                    if (!def.own) hang = (m) => m.box(out * (tip.x + 0.04), tip.y, fz, 0.1, 0.11, 2.5, railCol);
                    rack.spots[0] = { dx: 0, dy: 0, dz: -0.04 * t.len };
                }
            } else if (def.kind === 'over') {
                const x = def.f * hs, own = fit.ownOver(x, Math.max(0.35, 0.05 * hs));
                const ch = fit.chord(own ? own.x : x);
                if (!ch) { miss(pl, n); continue; }
                fx = out * (own ? own.x : x); fz = own ? (own.z0 + own.z1) / 2 : ch.le + (def.c ?? 0.45) * (ch.te - ch.le);
                fy = own ? own.y : fit.extreme(x - 0.05, x + 0.05, fz - 0.6, fz + 0.6, fit.ovr, true);
                if (!(fy === fy)) { miss(pl, n); continue; }
                if (!own) { const y0 = fy; fy += 0.12; hang = (m) => m.box(fx, y0 + 0.05, fz, 0.08, 0.14, 2.3, railCol); }
                railLaunch = true; hardware = false;
                rack.spots[0] = { dx: 0, dy: t.R + 0.008, dz: -0.04 * t.len };
            } else if (def.kind === 'wing') {
                const x0 = def.f * hs, own = def.own && !def.fix ? fit.ownPylon(x0, Math.max(0.3, 0.045 * hs)) : null;
                const x = own ? own.x : x0, ch = fit.chord(x);
                if (!ch) { miss(pl, n); continue; }
                fx = out * x;
                if (own) { fz = (own.z0 + own.z1) / 2; fy = own.y; } else {
                    fz = def.z != null ? def.z * L : ch.le + (def.c ?? 0.42) * (ch.te - ch.le);
                    // the pylon: long enough for what hangs on it, standing on the skin along its whole length
                    const plen = Math.min(clamp(0.56 * Math.max(rack.hwLen, t.len * 0.9), 0.8, pl.cap >= 6 ? 9 : 2.4), 0.9 * (ch.te - ch.le));
                    const z0 = fz - plen / 2, z1 = fz + plen / 2, th = clamp(0.006 * L, 0.07, 0.2);
                    const low = fit.extreme(x - th / 2, x + th / 2, z0, z1);
                    if (!(low === low)) { miss(pl, n); continue; }
                    const drop = def.drop ?? (def.fix ? 0 : clamp(0.016 * L, 0.2, 0.42));
                    fy = low - drop;
                    const key = s + ':' + def.f;
                    if (drop > 0 && !pylons.has(key)) {
                        pylons.add(key);
                        const yf = fy, top = (z) => fit.extreme(x - th / 2, x + th / 2, z - 0.02, z + 0.02, fit.und, true) + 0.04;
                        hang = (m) => m.pylon(fx, z0, z1, yf, top, th, skinCol);
                    }
                }
                if (def.dx) {
                    // a launch rail on the pylon's side: the missile beside it
                    const bx = fx + out * def.dx, by = fy + (def.dy || 0);
                    if (!def.own) { const h0 = hang; hang = (m) => { if (h0) h0(m); m.box((fx + bx) / 2, by, fz, Math.abs(def.dx), 0.07, 1.3, railCol); }; }
                    fx = bx; fy = by; railLaunch = true; hardware = false;
                    rack.spots[0] = { dx: 0, dy: 0, dz: -0.04 * t.len };
                }
            } else { // 'fus': hung from the belly under it
                const x = Math.abs(def.x || 0);
                fx = s * x; fz = def.z * L;
                const w = Math.max(rack.w * 0.6, 0.06);
                const low = fit.extreme(x - w, x + w, fz + rack.z0 * 0.8, fz + rack.z1 * 0.8);
                if (!(low === low)) { miss(pl, n); continue; }
                const sink = def.sink || 0, drop = def.own || sink ? 0 : (def.drop ?? 0.07);
                fy = low + sink - drop;
                if (drop > 0) {
                    const plen = clamp(0.5 * Math.max(rack.hwLen, t.len * 0.8), 0.6, 2.2), th = 0.09, yf = fy;
                    const top = (z) => fit.extreme(x - th / 2, x + th / 2, z - 0.02, z + 0.02, fit.und, true) + 0.04;
                    hang = (m) => m.pylon(fx, fz - plen / 2, fz + plen / 2, yf, top, th, skinCol);
                }
            }
            if (def.fwd) fz -= def.fwd;
            // the section it rides on (a wing that's gone has nothing)
            const region = regions[regionAt(fx, fz, L, hs)] ? regionAt(fx, fz, L, hs) : regions.center ? 'center' : 'model';
            if (lost.has(region)) { miss(pl, n); continue; }
            // clear of the ground on the gear, and of the legs
            const spots = rack.spots.slice(0, n);
            let ok = true;
            for (const sp of spots) {
                const sx = fx + out * sp.dx, sy = fy + sp.dy, sz = fz + sp.dz;
                if (sy - t.half < floor) ok = false;
                for (const g of legs) if (Math.abs(sx - g.x) < g.w + t.half * 0.8 && Math.abs(sz - g.z) < g.l + t.len / 2 && sy - t.R < legTop) ok = false;
            }
            if (!ok) { miss(pl, pl.cls === 'rkt' ? 0 : n); continue; }
            const m = mesherOf(region);
            if (hang) hang(m);
            if (hardware) for (const h of rack.hw) m.box(fx + out * h[0], fy + h[1], fz + h[2], h[3], h[4], h[5], h[6] === 'rail' ? railCol : rackCol);
            for (let i = 0; i < spots.length; i++) {
                const sp = spots[i], pos = new THREE.Vector3(fx + out * sp.dx, fy + sp.dy, fz + sp.dz);
                const [i0, cnt] = m.add(t, pos.x, pos.y, pos.z);
                const slot = { cls: pl.cls, store: pl.store, st: pl.st, side: s, pos, region, i0, n: cnt, rail: railLaunch, pod: t.pod || null, len: t.len, shown: true, k: i };
                slots.push(slot);
                released.push(slot);
            }
        }
        // the order they leave in: rack position by rack position, right and left by turns
        released.sort((a, b) => a.k - b.k || b.side - a.side);
        (seq[pl.cls] || (seq[pl.cls] = [])).push(released);
    }
    // a class's stores come back in the order of its stations (the preferred first) and leave in the reverse: the
    // last station given out empties first
    for (const cls in seq) seq[cls] = seq[cls].flatMap(group => group.slice().reverse());
    return { slots, meshers, seq, inside };
}

// ── The view on an aircraft ──
function newView() {
    return { lc: undefined, full: {}, plan: null, built: false, slots: [], seq: {}, shown: {}, inside: {}, meshes: {}, lostN: 0, cycle: 0, bayN: 0, skin: null, skinMat: null, count: 0 };
}

// what the jet carries now, class by class, as the plan wants it: [{ cls, store, n }]
function plan(ac, v) {
    const same = v.lc === ac.loadCounts, lc = ac.loadCounts || {};
    const load = [];
    for (const c of CLASSES) {
        const n = ac[c.ammo] | 0;
        const full = Math.max(n, lc[c.key] | 0, same ? v.full[c.key] | 0 : 0);
        v.full[c.key] = full;
        if (!full) continue;
        const W = storeFor(ac, c.key);
        if (W && W.id) load.push({ cls: c.key, store: W, n: full });
    }
    v.lc = ac.loadCounts;
    v.plan = stationPlan(ac.type, load);
    unbuild(v);
}

function build(ac, v) {
    v.built = true;
    v.slots = []; v.seq = {}; v.shown = {}; v.inside = { ...v.plan.inside }; v.meshes = {}; v.count = 0;
    v.lostN = ac.lostRegions ? ac.lostRegions.size : 0;
    v.bay = null;
    const fit = v.plan.places.length || v.plan.bay ? fitFor(ac) : null;
    if (!fit) { for (const pl of v.plan.places) if (pl.cls !== 'rkt') v.inside[pl.cls] = (v.inside[pl.cls] || 0) + pl.n; return; }
    v.skin = skinMesh(ac, fit);
    v.skinMat = v.skin ? v.skin.material : null;
    skinColor(v.skin, fit, _c);
    const skinCol = [Math.round(clamp(_c.r, 0, 1) * 255), Math.round(clamp(_c.g, 0, 1) * 255), Math.round(clamp(_c.b, 0, 1) * 255)];
    const lay = layout(ac, fit, v.plan, ac.lostRegions || new Set(), skinCol);
    v.slots = lay.slots; v.seq = lay.seq; v.inside = lay.inside;
    for (const cls in v.seq) v.shown[cls] = v.seq[cls].length;
    for (const region in lay.meshers) {
        const m = lay.meshers[region];
        if (!m.idx.length) continue;
        const geo = m.geometry();
        const mesh = new THREE.Mesh(geo, storesMaterial());
        mesh.name = 'stores';
        mesh.userData.stores = true;
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false; // (it never moves on its section)
        (ac.regions && ac.regions[region] ? ac.regions[region] : ac.model).add(mesh);
        v.meshes[region] = { mesh, full: geo.index.array.slice() };
    }
    v.count = v.slots.length;
    // where the weapons carried inside drop from: the bays under the belly
    if (v.plan.bay) {
        v.bay = [];
        for (const [bx, bz] of v.plan.bay) for (const s of bx ? [1, -1] : [0]) {
            const y = fit.extreme(bx - 0.15, bx + 0.15, bz * fit.L - 0.5, bz * fit.L + 0.5);
            if (y === y) v.bay.push(new THREE.Vector3(s * bx, y - 0.25, bz * fit.L));
        }
        if (!v.bay.length) v.bay = null;
    }
}

function unbuild(v) {
    for (const r in v.meshes) { const e = v.meshes[r]; if (e.mesh.parent) e.mesh.parent.remove(e.mesh); e.mesh.geometry.dispose(); }
    v.meshes = {}; v.slots = []; v.seq = {}; v.shown = {}; v.built = false; v.count = 0;
}

function setShown(v, slot, on) {
    if (slot.shown === on) return;
    slot.shown = on;
    const e = v.meshes[slot.region];
    if (!e) return;
    const index = e.mesh.geometry.index, a = index.array;
    if (on) for (let i = slot.i0; i < slot.i0 + slot.n; i++) a[i] = e.full[i]; else a.fill(0, slot.i0, slot.i0 + slot.n);
    index.addUpdateRange(slot.i0, slot.n);
    index.needsUpdate = true;
}

// a wing has gone: what hung on it went with it, and so did that ammunition
function loseRegions(ac, v) {
    v.lostN = ac.lostRegions.size;
    for (const cls in v.seq) {
        const seq = v.seq[cls], shown = v.shown[cls];
        let lostShown = 0;
        const keep = [];
        for (let i = 0; i < seq.length; i++) {
            if (!ac.lostRegions.has(seq[i].region)) { keep.push(seq[i]); continue; }
            if (i < shown) lostShown++;
        }
        if (keep.length === seq.length) continue;
        const c = CLASS[cls];
        if (cls === 'rkt') ac[c.ammo] = Math.round((ac[c.ammo] | 0) * keep.length / seq.length); // (the rockets in the pods that went)
        else ac[c.ammo] = Math.max(0, (ac[c.ammo] | 0) - lostShown);
        v.full[cls] = Math.max(0, (v.full[cls] | 0) - lostShown);
        v.shown[cls] = shown - lostShown;
        v.seq[cls] = keep;
    }
    v.slots = v.slots.filter(s => !ac.lostRegions.has(s.region));
    for (const r of ac.lostRegions) delete v.meshes[r]; // (the mesh rides away on its wing)
    v.count = v.slots.length;
}

// Is the jet close enough to show its stores? By its length on screen at the camera's field of view (a zoomed
// targeting pod still sees them), with some slack between showing and hiding.
export function storesNear(ac, cam) {
    if (!cam || !cam.isPerspectiveCamera || !ac.model || !ac.model.visible || ac.exploded) return false;
    const d = Math.max(cam.position.distanceTo(ac.pos), 1);
    const px = ac.spec.length / d * 450 / Math.tan((cam.fov || 60) * Math.PI / 360);
    return px > (ac.storesView && ac.storesView.built ? HIDE_PX : SHOW_PX);
}

// Keep what hangs on the jet in step with what it carries. near false: free its meshes (nothing is drawn, nothing
// is kept). Returns the number of stores hanging (shown or spent).
export function syncStores(ac, near = true) {
    let v = ac.storesView;
    if (!near) { if (v && v.built) unbuild(v); return 0; }
    if (!v) v = ac.storesView = newView();
    // plan again after a rearm (armAircraft makes a new loadCounts) or when something grew past what was planned
    let again = !v.plan || v.lc !== ac.loadCounts;
    if (!again) for (const c of CLASSES) if ((ac[c.ammo] | 0) > (v.full[c.key] | 0)) { again = true; break; }
    if (again) plan(ac, v);
    if (!v.built) build(ac, v);
    else if (v.skin && v.skin.material !== v.skinMat) { unbuild(v); build(ac, v); } // (a new livery: the pylons' colour)
    if (ac.lostRegions && ac.lostRegions.size !== v.lostN) loseRegions(ac, v);
    for (const cls in v.seq) {
        if (cls === 'rkt') continue; // (the pods stay)
        const seq = v.seq[cls], want = clamp((ac[CLASS[cls].ammo] | 0) - (v.inside[cls] | 0), 0, seq.length);
        let shown = v.shown[cls];
        while (shown > want) setShown(v, seq[--shown], false);
        while (shown < want) setShown(v, seq[shown++], true);
        v.shown[cls] = shown;
    }
    return v.count;
}

// The station a weapon of this class leaves from now (world space, into out: { pos, quat, rail }), and the store
// hanging there leaves with it. null: nothing to say (not shown, or the type hangs none of this class and has no bay).
export function releaseStore(ac, cls, out) {
    const v = ac.storesView;
    if (!v || !v.built || !cls) return null;
    const seq = v.seq[cls];
    let p = null, rail = false;
    if (seq && seq.length) {
        if (cls === 'rkt') {
            // out of the front of the next pod
            const s = seq[v.cycle++ % seq.length], r = s.pod ? s.pod.dia * 0.3 : 0.1, a = Math.random() * 6.283;
            p = _v.set(s.pos.x + Math.cos(a) * r, s.pos.y + Math.sin(a) * r, s.pos.z - s.len / 2);
        } else if (v.shown[cls] > 0) {
            const s = seq[--v.shown[cls]];
            setShown(v, s, false);
            p = _v.copy(s.pos); rail = s.rail;
        }
    }
    if (!p) {
        // carried inside: out of a bay, or (a type with none) from where one hung
        if (v.bay) p = _v.copy(v.bay[v.bayN++ % v.bay.length]);
        else if (seq && seq.length && cls !== 'rkt') { const s = seq[v.cycle++ % seq.length]; p = _v.copy(s.pos); rail = s.rail; }
        else return null;
    }
    out.pos.copy(p).applyQuaternion(ac.quat).add(ac.pos);
    out.quat.copy(ac.quat);
    out.rail = rail;
    return out;
}

// free everything (the aircraft is removed)
export function disposeStores(ac) {
    if (ac.storesView) { unbuild(ac.storesView); ac.storesView = null; }
}

// ── For tests and tools ──
// what hangs on the jet now: { cls: shown }, and every slot (model space)
export function storesShown(ac) {
    const v = ac.storesView, out = {};
    if (v) for (const cls in v.seq) out[cls] = cls === 'rkt' ? v.seq[cls].length : v.shown[cls];
    return out;
}
export const storeSlots = (ac) => (ac.storesView ? ac.storesView.slots : []);
export const fitOf = (ac) => fitFor(ac);
export const hasStations = (type) => !!stationsOf(type);

// ═══════════════════════════════════════════════════════════════
// A big set of cars drawn with instancing: real car models (Quaternius
// "Cars Bundle", CC0) split by type, a handful of draw calls for thousands of
// cars. Plain family cars get individual paint colours; taxis, police cars and
// the orange sports car keep their liveries.
// Used by the driving traffic and the cars parked in driveways.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { propParts } from './props.js';
import { liftWithDistance } from './roads.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CAR_TYPES = [
    { id: 'car_sedan', weight: 5, paint: 'Blue', len: 4.7 },
    { id: 'car_hatch', weight: 4, paint: 'LightBlue', len: 4.1 },
    { id: 'car_suv', weight: 4, paint: 'White', len: 4.9 },
    { id: 'car_sports', weight: 1.2, paint: 'White', len: 4.5 },
    { id: 'car_sports2', weight: 0.6, paint: null, len: 4.4 },
    { id: 'car_taxi', weight: 0.9, paint: null, len: 4.8 },
    { id: 'car_police', weight: 0.4, paint: null, len: 4.8 },
    // built here (no model): town buses and box lorries, only in the traffic
    { id: 'bus', weight: 0.35, paint: 'Paint', len: 11.8, make: () => busParts(), big: true },
    { id: 'truck', weight: 0.6, paint: 'Paint', len: 9.6, make: () => truckParts(), big: true },
];
export const PAINTS_BUS = [0xc8302a, 0x2a62b8, 0xe8b72c, 0xf0f0ea, 0x2f8a4a];

// Procedural big vehicles, facing -Z, wheels on y = 0. Parts by material: the paint (instance colour), dark glass,
// black (tyres, bumpers), light grey trim.
const _mats = {};
const vmat = (name, color, rough = 0.6, metal = 0.2) => _mats[name] || (_mats[name] = new THREE.MeshStandardMaterial({ name, color, roughness: rough, metalness: metal }));
function vparts(spec) {
    const by = new Map();
    for (const [mat, w, h, d, x, y, z, cyl] of spec) {
        const g = cyl ? new THREE.CylinderGeometry(w, w, h, 10) : new THREE.BoxGeometry(w, h, d);
        if (cyl) g.rotateZ(Math.PI / 2);
        g.translate(x, y, z);
        const ng = g.toNonIndexed();
        if (!by.has(mat)) by.set(mat, []);
        by.get(mat).push(ng);
    }
    return [...by].map(([mat, geos]) => ({ geometry: mergeGeometries(geos), material: mat }));
}
function wheels(xs, zs, r = 0.5) { const out = []; for (const x of xs) for (const z of zs) out.push([vmat('Black', 0x1c1c1e, 0.9, 0), r, 0.4, 0, x, r, z, true]); return out; }
function busParts() {
    const paint = vmat('Paint', 0xffffff, 0.45, 0.3), glass = vmat('Glass', 0x1d2630, 0.15, 0.6), trim = vmat('Trim', 0xcfd2d4, 0.5, 0.4);
    return vparts([
        [paint, 2.5, 2.4, 11.6, 0, 1.75, 0],          // body
        [glass, 2.54, 0.95, 10.4, 0, 2.2, 0.3],       // side windows
        [glass, 2.3, 1.2, 0.1, 0, 2.0, -5.82],        // windscreen
        [trim, 2.4, 0.25, 11.2, 0, 3.05, 0],          // roof
        [trim, 1.6, 0.3, 3, 0, 3.3, 2.5],             // roof pod
        [vmat('Black', 0x1c1c1e, 0.9, 0), 2.52, 0.3, 11.7, 0, 0.62, 0],
        ...wheels([-1.15, 1.15], [-3.9, 3.6]),
    ]);
}
function truckParts() {
    const paint = vmat('Paint', 0xffffff, 0.45, 0.3), glass = vmat('Glass', 0x1d2630, 0.15, 0.6), box = vmat('Box', 0xe4e4e0, 0.7, 0.1);
    return vparts([
        [paint, 2.4, 2.1, 2.3, 0, 1.75, -3.55],       // cab
        [glass, 2.2, 0.8, 0.1, 0, 2.3, -4.72],        // windscreen
        [box, 2.5, 2.9, 6.9, 0, 2.35, 1.2],           // cargo box
        [vmat('Black', 0x1c1c1e, 0.9, 0), 2.2, 0.35, 9.2, 0, 0.75, -0.1], // chassis
        ...wheels([-1.1, 1.1], [-3.4, 2.2, 3.6]),
    ]);
}
export const PAINTS = [0xd8d8d8, 0x1d3f8a, 0xb01e1e, 0x202225, 0xe0b43a, 0x2e6b3a, 0x7a7f86, 0xf0f0ea, 0x5a2d82, 0xc85a1e, 0x2a8fbd, 0x8a2433, 0x9aa3a8, 0x3b3b3b];

// fallback when the models aren't available: the old box car
function boxParts() {
    const body = new THREE.BoxGeometry(2, 1.1, 4.5); body.translate(0, 0.85, 0);
    const cabin = new THREE.BoxGeometry(1.8, 0.85, 2.3); cabin.translate(0, 1.8, 0.35);
    return [{ geometry: body, material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5, name: 'Paint' }) },
        { geometry: cabin, material: new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.2, metalness: 0.6 }) }];
}

// ── One mesh per vehicle ──
// A model's parts (one per material) merged into one geometry: each part's colour becomes a vertex colour, and
// aMat = (paint mask, roughness, metalness) per vertex. With vehicleMaterial() a whole car is one draw call (and
// one instance buffer) instead of one per material. Only plain untextured, opaque standard materials merge;
// returns null otherwise (the caller keeps a mesh per part).
export function mergeVehicleParts(parts, paintName = null) {
    if (!parts || !parts.length) return null;
    const ok = parts.every(pt => {
        const m = pt.material;
        return m && m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && !m.map && !m.normalMap && !m.roughnessMap && !m.metalnessMap && !m.emissiveMap && !m.alphaMap
            && !m.transparent && m.opacity === 1 && m.side === THREE.FrontSide && !m.vertexColors && m.emissive.getHex() === 0
            && pt.geometry.attributes.position && pt.geometry.attributes.normal;
    });
    if (!ok) return null;
    const geos = parts.map(pt => {
        const src = pt.geometry.index ? pt.geometry.toNonIndexed() : pt.geometry;
        const n = src.attributes.position.count, m = pt.material;
        const paint = !!paintName && m.name === paintName;
        const c = paint ? { r: 1, g: 1, b: 1 } : m.color;
        const col = new Float32Array(n * 3), mat = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
            mat[i * 3] = paint ? 1 : 0; mat[i * 3 + 1] = m.roughness; mat[i * 3 + 2] = m.metalness;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', src.attributes.position);
        g.setAttribute('normal', src.attributes.normal);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('aMat', new THREE.BufferAttribute(mat, 3));
        return g;
    });
    try { return mergeGeometries(geos); } catch (e) { return null; }
}

// The material for mergeVehicleParts geometry (shared by every vehicle type): vertex colours, the instance colour
// on the painted parts only (a negative one darkens every part: a wreck), roughness / metalness per vertex.
const _vehicleMats = {};
export function vehicleMaterial(onRoad = false) {
    const key = onRoad ? 'road' : 'plain';
    if (_vehicleMats[key]) return _vehicleMats[key];
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    if (onRoad) liftWithDistance(m); // ride with the road surface's distance lift
    const lift = m.onBeforeCompile, liftKey = onRoad ? m.customProgramCacheKey() : '';
    m.onBeforeCompile = (sh, r) => {
        if (onRoad) lift(sh, r);
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec3 aMat;\nvarying vec2 vRM;')
            .replace('#include <color_vertex>', THREE.ShaderChunk.color_vertex.replace('vColor.rgb *= instanceColor.rgb;',
                'vColor.rgb *= instanceColor.r < 0.0 ? -instanceColor.rgb : mix(vec3(1.0), instanceColor.rgb, aMat.x);') + '\nvRM = aMat.yz;');
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vRM;')
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRM.x;')
            .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vRM.y;');
    };
    m.customProgramCacheKey = () => 'vehicle:' + liftKey;
    return (_vehicleMats[key] = m);
}

export class CarSet {
    constructor(parent, n, rng = Math.random, { castShadow = false, allowSpecial = true, onRoad = false, big = false } = {}) {
        this.n = n;
        const types = CAR_TYPES.filter(t => (allowSpecial || t.paint) && (big || !t.big));
        const total = types.reduce((a, t) => a + t.weight, 0);
        this.slots = [];
        const counts = new Map();
        for (let i = 0; i < n; i++) {
            let r = rng() * total, t = types[0];
            for (const ty of types) { r -= ty.weight; if (r <= 0) { t = ty; break; } }
            const k = counts.get(t) || 0;
            counts.set(t, k + 1);
            this.slots.push({ type: t, i: k });
        }
        this.meshes = new Map(); // type → [{ im, paint }]
        // every slot's transform and colour live here; only the cars near the camera are uploaded (see commit)
        this.mats = new Float32Array(n * 16);
        this.paints = new Float32Array(n * 3).fill(1);
        this.wrecked = new Uint8Array(n);
        this.byType = new Map();
        this.slots.forEach((sl, i) => { if (!this.byType.has(sl.type)) this.byType.set(sl.type, []); this.byType.get(sl.type).push(i); });
        for (const [t, count] of counts) {
            const parts = (t.make ? t.make() : propParts(t.id)) || boxParts();
            const list = [];
            const white = new THREE.Color(1, 1, 1);
            const merged = mergeVehicleParts(parts, t.paint);
            // one draw call per vehicle type (every part in one geometry); per-material meshes only as a fallback
            const drawn = merged ? [{ geometry: merged, material: vehicleMaterial(onRoad), merged: true, paint: !!t.paint }]
                : parts.map(pt => {
                    const isPaint = t.paint ? pt.material.name === t.paint : false;
                    const mat = isPaint || onRoad ? pt.material.clone() : pt.material;
                    if (isPaint) mat.color.setRGB(1, 1, 1); // the instance colour is the paint
                    if (onRoad) liftWithDistance(mat); // ride with the road surface's distance lift
                    return { geometry: pt.geometry, material: mat, merged: false, paint: isPaint };
                });
            for (const d of drawn) {
                const im = new THREE.InstancedMesh(d.geometry, d.material, count);
                im.frustumCulled = false;
                im.castShadow = castShadow;
                im.receiveShadow = castShadow;
                for (let k = 0; k < count; k++) im.setColorAt(k, white);
                parent.add(im);
                list.push({ im, paint: d.paint, merged: d.merged });
            }
            this.meshes.set(t, list);
        }
        this._c = new THREE.Color();
    }

    setMatrix(slot, m) { m.toArray(this.mats, slot * 16); }

    setPaint(slot, hex) { this._c.setHex(hex).toArray(this.paints, slot * 3); this.wrecked[slot] = 0; }

    // burnt-out wreck: everything goes dark
    wreck(slot) { this.wrecked[slot] = 1; }

    restore(slot, hex) { this.setPaint(slot, hex); }

    // Upload only the cars within `radius` of `center` (compacting each type's instances).
    // Far cars cost nothing on the GPU.
    commit(center, radius) {
        const r2 = radius * radius, M = this.mats, P = this.paints;
        const dark = [0.08, 0.075, 0.07];
        for (const [t, list] of this.meshes) {
            const slots = this.byType.get(t);
            let k = 0;
            for (const i of slots) {
                const o = i * 16, dx = M[o + 12] - center.x, dz = M[o + 14] - center.z;
                if (dx * dx + dz * dz > r2 || M[o] === 0 && M[o + 5] === 0) continue; // far away, or hidden (zero scale)
                for (const p of list) {
                    p.im.instanceMatrix.array.set(M.subarray(o, o + 16), k * 16);
                    const ca = p.im.instanceColor.array, co = k * 3;
                    // (a merged vehicle reads a negative colour as "burnt out": every part darkens, see vehicleMaterial)
                    if (this.wrecked[i]) { const sg = p.merged ? -1 : 1; ca[co] = dark[0] * sg; ca[co + 1] = dark[1] * sg; ca[co + 2] = dark[2] * sg; }
                    else if (p.paint) { ca[co] = P[i * 3]; ca[co + 1] = P[i * 3 + 1]; ca[co + 2] = P[i * 3 + 2]; }
                    else { ca[co] = ca[co + 1] = ca[co + 2] = 1; }
                }
                k++;
            }
            for (const p of list) {
                const was = p.im.count;
                p.im.count = k;
                p.im.visible = k > 0;
                if (!k && !was) continue; // nothing near before or now: no upload
                upload(p.im.instanceMatrix, k * 16);
                upload(p.im.instanceColor, k * 3);
            }
        }
    }
}

// flag just the first n floats of an instance buffer for upload (not the whole buffer)
function upload(attr, n) {
    attr.clearUpdateRanges();
    if (n > 0) attr.addUpdateRange(0, n);
    attr.needsUpdate = n > 0;
}

// ═══════════════════════════════════════════════════════════════
// Small things only worth drawing near the camera (street furniture): every
// transform lives here, and commit() uploads just the ones within a radius,
// packed to the front of the InstancedMesh. The bounding sphere is refit to
// the near set so the shadow pass can cull it too.
// ═══════════════════════════════════════════════════════════════
export class NearInstances {
    constructor(parent, geometry, material, max, { castShadow = false, receiveShadow = true, colors = false } = {}) {
        this.n = 0;
        this.mats = new Float32Array(max * 16);
        this.cols = colors ? new Float32Array(max * 3).fill(1) : null;
        this.slots = new Int32Array(Math.max(1, max)); // packed slot → source index
        this.k = 0;
        const im = this.im = new THREE.InstancedMesh(geometry, material, Math.max(1, max));
        if (colors) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, max) * 3).fill(1), 3);
        im.count = 0;
        im.visible = false;
        im.castShadow = castShadow;
        im.receiveShadow = receiveShadow;
        im.matrixAutoUpdate = false;
        parent.add(im);
    }

    add(m) { m.toArray(this.mats, this.n * 16); return this.n++; }

    setColor(i, c) { c.toArray(this.cols, i * 3); }

    commit(center, radius) {
        const r2 = radius * radius, M = this.mats, im = this.im, A = im.instanceMatrix.array;
        let k = 0;
        for (let i = 0; i < this.n; i++) {
            const o = i * 16, dx = M[o + 12] - center.x, dz = M[o + 14] - center.z;
            if (dx * dx + dz * dz > r2) continue;
            A.set(M.subarray(o, o + 16), k * 16);
            this.slots[k++] = i;
        }
        const was = this.k;
        this.k = im.count = k;
        im.visible = k > 0;
        if (!k && !was) return;
        upload(im.instanceMatrix, k * 16);
        if (this.cols) this.refreshColors();
        if (k) im.computeBoundingSphere();
    }

    // re-copy the colours of the packed instances (e.g. traffic lights changing)
    refreshColors() {
        const C = this.cols, ca = this.im.instanceColor.array;
        for (let s = 0; s < this.k; s++) { const i = this.slots[s] * 3; ca[s * 3] = C[i]; ca[s * 3 + 1] = C[i + 1]; ca[s * 3 + 2] = C[i + 2]; }
        upload(this.im.instanceColor, this.k * 3);
    }
}

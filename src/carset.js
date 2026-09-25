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

export const CAR_TYPES = [
    { id: 'car_sedan', weight: 5, paint: 'Blue' },
    { id: 'car_hatch', weight: 4, paint: 'LightBlue' },
    { id: 'car_suv', weight: 4, paint: 'White' },
    { id: 'car_sports', weight: 1.2, paint: 'White' },
    { id: 'car_sports2', weight: 0.6, paint: null },
    { id: 'car_taxi', weight: 0.9, paint: null },
    { id: 'car_police', weight: 0.4, paint: null },
];
export const PAINTS = [0xd8d8d8, 0x1d3f8a, 0xb01e1e, 0x202225, 0xe0b43a, 0x2e6b3a, 0x7a7f86, 0xf0f0ea, 0x5a2d82, 0xc85a1e, 0x2a8fbd, 0x8a2433, 0x9aa3a8, 0x3b3b3b];

// fallback when the models aren't available: the old box car
function boxParts() {
    const body = new THREE.BoxGeometry(2, 1.1, 4.5); body.translate(0, 0.85, 0);
    const cabin = new THREE.BoxGeometry(1.8, 0.85, 2.3); cabin.translate(0, 1.8, 0.35);
    return [{ geometry: body, material: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.5, name: 'Paint' }) },
        { geometry: cabin, material: new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.2, metalness: 0.6 }) }];
}

export class CarSet {
    constructor(parent, n, rng = Math.random, { castShadow = false, allowSpecial = true, onRoad = false } = {}) {
        this.n = n;
        const types = CAR_TYPES.filter(t => allowSpecial || t.paint);
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
            const parts = propParts(t.id) || boxParts();
            const list = [];
            for (const pt of parts) {
                const isPaint = t.paint ? pt.material.name === t.paint : false;
                const mat = isPaint || onRoad ? pt.material.clone() : pt.material;
                if (isPaint) mat.color.setRGB(1, 1, 1); // the instance colour is the paint
                if (onRoad) liftWithDistance(mat); // ride with the road surface's distance lift
                const im = new THREE.InstancedMesh(pt.geometry, mat, count);
                im.frustumCulled = false;
                im.castShadow = castShadow;
                im.receiveShadow = castShadow;
                const white = new THREE.Color(1, 1, 1);
                for (let k = 0; k < count; k++) im.setColorAt(k, white);
                parent.add(im);
                list.push({ im, paint: isPaint });
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
                    if (this.wrecked[i]) { ca[co] = dark[0]; ca[co + 1] = dark[1]; ca[co + 2] = dark[2]; }
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

// ═══════════════════════════════════════════════════════════════
// A big set of cars drawn with instancing: real car models (Quaternius
// "Cars Bundle", CC0) split by type, a handful of draw calls for thousands of
// cars. Plain family cars get individual paint colours; taxis, police cars and
// the orange sports car keep their liveries.
// Used by the driving traffic and the cars parked in driveways.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { propParts } from './props.js';

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
    constructor(parent, n, rng = Math.random, { castShadow = false, allowSpecial = true } = {}) {
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
        for (const [t, count] of counts) {
            const parts = propParts(t.id) || boxParts();
            const list = [];
            for (const pt of parts) {
                const isPaint = t.paint ? pt.material.name === t.paint : false;
                const mat = isPaint ? pt.material.clone() : pt.material;
                if (isPaint) mat.color.setRGB(1, 1, 1); // the instance colour is the paint
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

    setMatrix(slot, m) {
        const s = this.slots[slot];
        for (const p of this.meshes.get(s.type)) p.im.setMatrixAt(s.i, m);
    }

    setPaint(slot, hex) {
        const s = this.slots[slot];
        for (const p of this.meshes.get(s.type)) if (p.paint) p.im.setColorAt(s.i, this._c.setHex(hex));
        this.colorsDirty = true;
    }

    // burnt-out wreck: everything goes dark
    wreck(slot) {
        const s = this.slots[slot];
        for (const p of this.meshes.get(s.type)) p.im.setColorAt(s.i, this._c.setRGB(0.08, 0.075, 0.07));
        this.colorsDirty = true;
    }

    restore(slot, hex) {
        const s = this.slots[slot];
        for (const p of this.meshes.get(s.type)) p.im.setColorAt(s.i, this._c.setHex(p.paint ? hex : 0xffffff));
        this.colorsDirty = true;
    }

    flush(matrices = true) {
        for (const list of this.meshes.values()) for (const p of list) {
            if (matrices) p.im.instanceMatrix.needsUpdate = true;
            if (this.colorsDirty && p.im.instanceColor) p.im.instanceColor.needsUpdate = true;
        }
        this.colorsDirty = false;
    }

    finalizeStatic() {
        this.flush(true);
        for (const list of this.meshes.values()) for (const p of list) { p.im.frustumCulled = true; p.im.computeBoundingSphere(); }
    }
}

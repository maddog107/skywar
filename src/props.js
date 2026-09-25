// ═══════════════════════════════════════════════════════════════
// Decor models (helicopters, vehicles): loaded once, normalised to real size,
// sitting on y = 0 and facing -Z. See models/CREDITS.md.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// length = real length in metres (longest horizontal side after rotY)
export const PROP_FILES = {
    heli_military: { file: 'heli_military.glb', length: 15, rotY: Math.PI },
    heli_civil: { file: 'heli_civil.glb', length: 11, rotY: 0 },
    humvee: { file: 'humvee.glb', length: 4.6, rotY: -Math.PI / 2 },
    buggy: { file: 'buggy.glb', length: 3.4, rotY: -Math.PI / 2 },
    tank: { file: 'tank.glb', length: 9.6, rotY: 0 },
    m939: { file: 'm939.glb', length: 7.9, rotY: -Math.PI / 2 },
    // Quaternius "Cars Bundle" (CC0)
    car_sedan: { file: 'car_sedan.glb', length: 4.7, rotY: Math.PI },
    car_hatch: { file: 'car_hatch.glb', length: 4.1, rotY: Math.PI },
    car_suv: { file: 'car_suv.glb', length: 4.9, rotY: Math.PI },
    car_sports: { file: 'car_sports.glb', length: 4.5, rotY: Math.PI },
    car_sports2: { file: 'car_sports2.glb', length: 4.4, rotY: Math.PI },
    car_taxi: { file: 'car_taxi.glb', length: 4.8, rotY: Math.PI },
    car_police: { file: 'car_police.glb', length: 4.8, rotY: Math.PI },
};

const cache = {};

export async function preloadProps() {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(PROP_FILES).map(async ([id, info]) => {
        try {
            const gltf = await loader.loadAsync('models/' + info.file);
            cache[id] = normalise(gltf.scene, info);
        } catch (e) { console.warn('[props] failed to load', info.file, e); }
    }));
}

function normalise(root, info) {
    const holder = new THREE.Group(), inner = new THREE.Group();
    inner.add(root);
    inner.rotation.y = info.rotY || 0;
    holder.add(inner);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const scale = info.length / Math.max(size.z, 1e-6);
    inner.scale.setScalar(scale);
    const c = box.getCenter(new THREE.Vector3());
    inner.position.set(-c.x * scale, -box.min.y * scale, -c.z * scale);
    holder.updateMatrixWorld(true);
    holder.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => { if (m && 'roughness' in m) { m.roughness = Math.max(m.roughness ?? 0.6, 0.45); m.metalness = Math.min(m.metalness ?? 0, 0.3); } });
    });
    const b2 = new THREE.Box3().setFromObject(holder);
    return { object: holder, size: b2.getSize(new THREE.Vector3()) };
}

export function hasProp(id) { return !!cache[id]; }
export function propSize(id) { return cache[id] ? cache[id].size : new THREE.Vector3(4, 2, PROP_FILES[id]?.length || 4); }

// A fresh copy to place in the scene
export function propInstance(id) {
    if (!cache[id]) return null;
    return cache[id].object.clone(true);
}

// Geometry baked per material, for InstancedMesh (many copies, few draw calls)
const partsCache = {};
export function propParts(id) {
    if (partsCache[id]) return partsCache[id];
    if (!cache[id]) return null;
    const byMat = new Map();
    cache[id].object.updateMatrixWorld(true);
    cache[id].object.traverse(o => {
        if (!o.isMesh || Array.isArray(o.material)) return;
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (!g.attributes.normal) g.computeVertexNormals();
        const ng = g.index ? g.toNonIndexed() : g;
        if (!byMat.has(o.material)) byMat.set(o.material, []);
        byMat.get(o.material).push(ng);
    });
    const parts = [];
    for (const [mat, geos] of byMat) {
        try { parts.push({ geometry: mergeGeometries(geos), material: mat }); } catch (e) { /* skip odd primitives */ }
    }
    partsCache[id] = parts;
    return parts;
}

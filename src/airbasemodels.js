// ═══════════════════════════════════════════════════════════════
// Airbase models (models/airbases/*.glb, built in Blender by tools/airbases/*.py with the vehicle kit — see
// models/airbases/CREDITS.md): shelters, igloos, fuel tanks, the power plant, sirens, searchlights, revetments, the
// alert crews' building, and the base vehicles (runway-repair loader and dump truck, aircraft tug, follow-me car,
// the Harpoon coastal launcher). Real size in metres, facing −Z, +Y up; moving parts are named nodes with their
// joint in userData (the vehicle kit's rig format), so vehicles.js's pose / openDoors / raise / roll / steer work on
// the rigs made here.
//   preloadAirbaseModels({ background: true }); await airbaseModelsReady();
//   const { object, rig } = createModel('has_nato');   openDoors(rig, 1)
//   staticModel('igloo')        → a merged copy (a few draw calls), shared geometry
//   modelParts('fueltank')      → [{ geometry, material }] in the model's frame, for instancing
// Materials by name: Paint (vehicles.js's camouflage, per model scheme), Detail (the kit's palette), Concrete,
// Earth, Steel (textures in models/airbases/tex/); anything else keeps the glTF's own factors.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { paintMaterial } from './vehicles.js';
import { mergeStaticModel, weldGeometry } from './meshmerge.js';

export const AB_MODELS = {
    has_nato: { file: 'has_nato.glb', paint: 'blue_green', name: 'Hardened aircraft shelter (TAB-V, 3rd generation)' },
    has_red: { file: 'has_red.glb', paint: 'red_green', name: 'Arch aircraft shelter (Soviet "arochnoye ukrytiye")' },
    qrahut: { file: 'qrahut.glb', name: 'QRA crew building' },
    igloo: { file: 'igloo.glb', name: 'Earth-covered munitions igloo' },
    fueltank: { file: 'fueltank.glb', name: 'Bulk fuel storage tank' },
    generator: { file: 'generator.glb', name: 'Power plant' },
    searchlight: { file: 'searchlight.glb', paint: 'blue_green', name: 'Searchlight' },
    siren: { file: 'siren.glb', name: 'Air-raid siren' },
    revetment: { file: 'revetment.glb', name: 'Launcher revetment' },
    loader: { file: 'loader.glb', paint: 'blue_tan', name: 'Wheel loader (runway repair)' },
    dumptruck: { file: 'dumptruck.glb', paint: 'blue_tan', name: 'Dump truck (runway repair)' },
    tug: { file: 'tug.glb', paint: 'blue_tan', name: 'Aircraft tow tractor' },
    followme: { file: 'followme.glb', paint: 'blue_tan', name: 'Follow-me car' },
    hcds: { file: 'hcds.glb', paint: 'blue_tan', name: 'Harpoon coastal defence launcher' },
};

const BASE = 'models/airbases/';
const cache = {};
let loading = null, readyResolve = null;
const ready = new Promise(r => (readyResolve = r));

// ── materials ──
let texLoader = null;
const texCache = {};
function tex(path, srgb = true, repeat = true) {
    if (texCache[path]) return texCache[path];
    const t = texLoader ? texLoader.load(path, undefined, undefined, () => {}) : new THREE.Texture();
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false;
    t.anisotropy = 8;
    return (texCache[path] = t);
}
const MATS = {};
export function abMaterial(name) {
    if (MATS[name]) return MATS[name];
    let m = null;
    if (name === 'Detail') {
        const orm = tex('models/vehicles/tex/detail_orm.png', false, false);
        m = new THREE.MeshStandardMaterial({ name, map: tex('models/vehicles/tex/detail.png', true, false), roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1 });
        m.map.magFilter = THREE.NearestFilter;
    } else if (name === 'Concrete') m = new THREE.MeshStandardMaterial({ name, map: tex(BASE + 'tex/concrete.jpg'), roughness: 0.92, metalness: 0 });
    else if (name === 'Earth') m = new THREE.MeshStandardMaterial({ name, map: tex(BASE + 'tex/earth.jpg'), roughness: 1, metalness: 0 });
    else if (name === 'Steel') m = new THREE.MeshStandardMaterial({ name, map: tex(BASE + 'tex/steel.jpg'), roughness: 0.55, metalness: 0.55 });
    return (MATS[name] = m);
}

// ── loading ──
export function preloadAirbaseModels(opts = {}) {
    if (loading) return opts.background ? Promise.resolve() : loading;
    loading = ready;
    const run = () => loadAll(opts).then(readyResolve, readyResolve);
    if (!opts.background) { run(); return loading; }
    const idle = globalThis.requestIdleCallback || ((f) => setTimeout(f, 300));
    idle(run, { timeout: 5000 });
    return Promise.resolve();
}
async function loadAll(opts) {
    if (opts.textures !== false && typeof document !== 'undefined' && document.createElementNS) texLoader = new THREE.TextureLoader();
    const loader = new GLTFLoader();
    const ids = opts.ids || Object.keys(AB_MODELS);
    await Promise.all(ids.map(async (id) => {
        try {
            const url = BASE + AB_MODELS[id].file;
            const buf = opts.fetchBuffer ? await opts.fetchBuffer(url) : await (await fetch(url)).arrayBuffer();
            const gltf = await loader.parseAsync(buf, BASE);
            cache[id] = prepare(id, gltf.scene);
        } catch (e) {
            if (!opts.quiet) console.warn('[airbasemodels] failed to load', id, e && e.message);
        }
    }));
}
export function airbaseModelsReady() { return loading || ready; }
export function hasModel(id) { return !!cache[id]; }

function prepare(id, scene) {
    const root = scene.getObjectByName(id) || scene.children[0] || scene;
    let meta = {};
    try { meta = JSON.parse(root.userData.vk || '{}'); } catch (e) { /* no rig metadata */ }
    const scheme = AB_MODELS[id].paint;
    root.traverse((o) => {
        if (o.userData && typeof o.userData.joint === 'string') { try { o.userData.joint = JSON.parse(o.userData.joint); } catch (e) { delete o.userData.joint; } }
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const swap = (m) => {
            if (!m) return m;
            if (m.name === 'Paint') return paintMaterial(scheme || 'blue_green');
            return abMaterial(m.name) || m;
        };
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    return { scene: root, meta };
}

// ── instances ──
export function createModel(id, opts = {}) {
    const src = cache[id];
    if (!src) return null;
    const object = src.scene.clone(true);
    object.name = id;
    if (opts.paint) repaintModel(object, opts.paint);
    return { object, rig: buildRig(id, object, src.meta) };
}
export function repaintModel(object, scheme) {
    const m = paintMaterial(scheme);
    object.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(x => (x.name === 'Paint' ? m : x)) : (o.material.name === 'Paint' ? m : o.material); });
}

// a merged static copy in the stowed pose (or after pose(rig) of opts.pose), cached per id + paint + key
const STATIC = new Map();
export function staticModel(id, { paint = null, key = '', pose = null, hide = null } = {}) {
    const k = id + ':' + (paint || '') + ':' + key;
    if (STATIC.has(k)) return STATIC.get(k).clone();
    const made = createModel(id, { paint });
    if (!made) return null;
    if (pose) pose(made.rig);
    if (hide) made.object.traverse(o => { if (hide.includes(o.name)) o.visible = false; });
    made.object.updateMatrixWorld(true);
    const merged = mergeStaticModel(made.object);
    STATIC.set(k, merged);
    return merged.clone();
}

// geometry + material pairs of a merged copy, in the model's frame (for InstancedMesh)
const PARTS = new Map();
export function modelParts(id, opts = {}) {
    const k = id + ':' + (opts.paint || '') + ':' + (opts.key || '');
    if (PARTS.has(k)) return PARTS.get(k);
    const m = staticModel(id, opts);
    if (!m) return null;
    m.updateMatrixWorld(true);
    const parts = [];
    m.traverse(o => { if (o.isMesh && !Array.isArray(o.material)) parts.push({ geometry: o.geometry.clone().applyMatrix4(o.matrixWorld), material: o.material }); });
    PARTS.set(k, parts);
    return parts;
}

// A model split for instancing: the static shell (every mesh not under a jointed node, merged per material, in the
// model's frame) and each jointed node (its meshes in the node's own frame, with its rest transform and joint), so a
// door can be drawn per instance as  M_instance · T(rest) · R(joint) .  Cached per id.
const SPLIT = new Map();
export function modelSplit(id) {
    if (SPLIT.has(id)) return SPLIT.get(id);
    const src = cache[id];
    if (!src) return null;
    const root = src.scene.clone(true);
    root.updateMatrixWorld(true);
    const jointed = [];
    root.traverse(o => { if (o !== root && o.userData && o.userData.joint && typeof o.userData.joint === 'object') jointed.push(o); });
    const under = (o, set) => { for (let q = o; q; q = q.parent) if (set.includes(q)) return q; return null; };
    const byMat = new Map(), joints = [];
    const inv = new THREE.Matrix4();
    const add = (map, o, rel) => {
        const g = o.geometry.clone().applyMatrix4(rel);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        const ng = g.index ? g.toNonIndexed() : g;
        if (!map.has(o.material)) map.set(o.material, []);
        map.get(o.material).push(ng);
    };
    root.traverse(o => { if (o.isMesh && !Array.isArray(o.material) && o.visible !== false && !under(o, jointed)) add(byMat, o, o.matrixWorld); });
    for (const j of jointed) {
        if (jointed.some(p => p !== j && under(j.parent, [p]))) continue; // (nested joints ride on their parent: not needed here)
        inv.copy(j.matrixWorld).invert();
        const m = new Map();
        j.traverse(o => { if (o.isMesh && !Array.isArray(o.material)) add(m, o, new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); });
        // rest transform relative to the root (the root is at the origin)
        const restPos = new THREE.Vector3(), restQuat = new THREE.Quaternion(), sc = new THREE.Vector3();
        j.matrixWorld.decompose(restPos, restQuat, sc);
        const jj = j.userData.joint;
        joints.push({ name: j.name, restPos, restQuat, axis: new THREE.Vector3().fromArray(jj.axis), j: jj, parts: mergeMap(m) });
    }
    const out = { shell: mergeMap(byMat), joints };
    SPLIT.set(id, out);
    return out;
}
function mergeMap(map) {
    const parts = [];
    for (const [material, geos] of map) {
        let n = 0; for (const g of geos) n += g.attributes.position.count;
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
        let o = 0;
        for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.computeBoundingSphere();
        parts.push({ geometry: weldGeometry(geo), material });
    }
    return parts;
}

// ── the rig (same shape as vehicles.js buildRig, so its joint helpers work) ──
function buildRig(id, object, meta) {
    const nodes = {};
    object.traverse(o => { if (o.name) nodes[o.name] = o; });
    const rig = {
        id, object, nodes, meta, dims: meta.dims || null,
        joints: [], byGroup: {}, byName: {}, wheels: [], rams: [], tracks: [], muzzles: [], missiles: [], canisters: [],
        erector: nodes.erector || null, turret: nodes.turret || null, launcher: nodes.launcher || null, antenna: nodes.antenna || null,
        exhaust: nodes.exhaust || null, state: { raise: 0, jack: 0, door: 0, yaw: 0, pitch: 0 },
    };
    for (const o of Object.values(nodes)) {
        const j = o.userData.joint;
        if (!j || typeof j !== 'object') continue;
        const e = { node: o, j, restPos: o.position.clone(), restQuat: o.quaternion.clone(), axis: new THREE.Vector3().fromArray(j.axis), value: j.stow || 0 };
        rig.joints.push(e);
        rig.byName[o.name] = e;
        const g = j.group || j.type;
        (rig.byGroup[g] || (rig.byGroup[g] = [])).push(e);
    }
    const numbered = (prefix) => Object.keys(nodes).filter(n => new RegExp('^' + prefix + '_\\d+$').test(n)).sort((a, b) => +a.split('_').pop() - +b.split('_').pop()).map(n => nodes[n]);
    rig.muzzles = numbered('muzzle');
    rig.canisters = numbered('canister');
    for (const w of meta.wheels || []) {
        const node = nodes[w.node];
        if (!node) continue;
        node.rotation.reorder('YXZ');
        rig.wheels.push({ node, r: w.r, steer: w.steer || 0, side: w.side || 1, yaw0: node.rotation.y, spin: node.rotation.x });
    }
    const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m3 = new THREE.Matrix3();
    for (const r of meta.rams || []) {
        const node = nodes[r.node], end = nodes[r.end];
        if (!node || !end) continue;
        const e = { node, end, len: r.len, restQuat: node.quaternion.clone(), stages: (r.stages || []).map(n => ({ node: nodes[n], rest: nodes[n].position.clone() })), restDir: new THREE.Vector3() };
        object.updateMatrixWorld(true);
        e.restDir.copy(end.getWorldPosition(_a)).sub(node.getWorldPosition(_b));
        e.restDir.applyMatrix3(_m3.setFromMatrix4(node.parent.matrixWorld).invert()).normalize();
        rig.rams.push(e);
    }
    return rig;
}

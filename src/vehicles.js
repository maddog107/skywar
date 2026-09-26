// ═══════════════════════════════════════════════════════════════
// Military ground vehicles: rigged models for the war layer (TELs, SAMs, radars, command posts, rocket
// artillery, APCs, support trucks). Models are built in Blender by tools/vehicles/*.py (models/vehicles/*.glb,
// see models/vehicles/CREDITS.md): real size in metres, facing −Z, wheels on y = 0, moving parts as named nodes
// with their origin on the pivot. Each moving node carries its joint (userData.joint, from the glTF extras):
//   { type: 'rot' | 'slide' | 'spin', axis: [x, y, z] (parent frame), min, max, stow, deploy, group, rpm }
// and the root carries the rig description (userData.vk: wheels, rams, tracks, dimensions).
//
//   await preloadVehicles();                       // main.js, with the other preloads
//   const { object, rig } = createVehicle('scud'); // a fresh copy (shares geometry and materials)
//   deployJacks(rig, 1); deployPad(rig, 1); raise(rig, 1);   // 0 = stowed … 1 = deployed / erected
//   aim(rig, yaw, pitch); spin(rig, dt); roll(rig, metres); steer(rig, angle);
//   muzzleWorld(rig, i, pos, dir);                 // launch point and direction of tube / rail / canister i
//
// Every helper only moves nodes (no allocation); rams re-aim themselves after each pose change.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeStaticModel } from './meshmerge.js';

// cls: the war layer's class strings (docs/WAR.md). dims: metres (the models are built to them; rig.dims has the
// measured box). crew: seats. speed: road km/h. arm: what it carries (the launcher nodes the rig exposes).
export const VEHICLES = {
    scud: {
        name: '9P117M1 TEL, 9K72 Elbrus (SS-1C Scud-B)', short: 'SCUD TEL', cls: 'tel', team: 'red', file: 'scud.glb', paint: 'red_camo',
        chassis: 'MAZ-543A 8×8', dims: { length: 12.4, width: 3.07, height: 3.4 }, crew: 4, mass: 37.4, speed: 60,
        arm: '1 × R-17 (8K14) ballistic missile: 11.16 m, 0.88 m, 300 km, 985 kg warhead', muzzles: 0,
        // erector: rot x about the rear hinge, 0 → 90°; missile: child of the erector, origin on its base, nose along −z;
        // nozzle: empty, −z along the exhaust; pad: the launch table, swung down 90° under the erected missile
        parts: ['body', 'erector', 'missile', 'nozzle', 'pad', 'jack_fl', 'jack_fr', 'jack_rl', 'jack_rr', 'ram_l', 'ram_r', 'exhaust', 'seat_driver', 'hatch_entry'],
    },
};

// Paint schemes: models/vehicles/tex/paint_<scheme>.jpg (tools/vehicles/textures.py)
export const PAINTS = ['red_camo', 'red_green', 'blue_green', 'blue_tan'];

const BASE = 'models/vehicles/';
const cache = {};          // id → { scene, meta }
let loading = null;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix3();

// ── shared materials (one set for every vehicle) ──
let texLoader = null;
const texCache = {};
let texPending = 0, texWaiters = [];
const texDone = () => { if (--texPending <= 0) { texPending = 0; texWaiters.splice(0).forEach(f => f()); } };
// resolves once every texture requested so far has loaded (or failed)
export function whenTexturesLoaded() { return texPending ? new Promise(r => texWaiters.push(r)) : Promise.resolve(); }
function tex(name, srgb = true, repeat = false) {
    if (texCache[name]) return texCache[name];
    if (texLoader) texPending++;
    const t = !texLoader ? new THREE.Texture() : texLoader.load(BASE + 'tex/' + name, texDone, undefined, (e) => { console.warn('[vehicles] texture failed', name, e); texDone(); });
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false; // glTF UV convention (v = 0 at the top of the image), as GLTFLoader's own textures
    t.anisotropy = 8;
    t.name = name;
    return (texCache[name] = t);
}
const MATS = { paint: {}, detail: null, track: null };
export function paintMaterial(scheme) {
    if (!PAINTS.includes(scheme)) scheme = 'red_camo';
    return MATS.paint[scheme] || (MATS.paint[scheme] = new THREE.MeshStandardMaterial({
        name: 'Paint', map: tex('paint_' + scheme + '.jpg', true, true), roughness: 0.74, metalness: 0.08, envMapIntensity: 0.75,
    }));
}
function detailMaterial() {
    if (MATS.detail) return MATS.detail;
    const orm = tex('detail_orm.png', false);
    return (MATS.detail = new THREE.MeshStandardMaterial({
        name: 'Detail', map: tex('detail.png'), roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1, envMapIntensity: 1,
    }));
}
function trackMaterial() {
    return MATS.track || (MATS.track = new THREE.MeshStandardMaterial({
        name: 'Track', map: tex('track.jpg', true, true), roughness: 0.8, metalness: 0.35, envMapIntensity: 0.6,
    }));
}

// ── loading ──
// opts.fetchBuffer(url) → ArrayBuffer lets tests load the files without a browser; opts.textures = false skips images.
export function preloadVehicles(opts = {}) {
    if (loading) return loading;
    if (opts.textures !== false && typeof document !== 'undefined' && document.createElementNS) texLoader = new THREE.TextureLoader();
    const loader = new GLTFLoader();
    const load = async (file) => {
        if (opts.fetchBuffer) return loader.parseAsync(await opts.fetchBuffer(BASE + file), BASE);
        return loader.loadAsync(BASE + file);
    };
    const ids = opts.ids || Object.keys(VEHICLES);
    loading = Promise.all(ids.map(async (id) => {
        try {
            const gltf = await load(VEHICLES[id].file);
            cache[id] = prepare(id, gltf.scene);
        } catch (e) {
            console.warn('[vehicles] failed to load', id, e && e.message);
        }
    }));
    return loading;
}
export function vehiclesReady() { return loading || Promise.resolve(); }
export function hasVehicle(id) { return !!cache[id]; }

function prepare(id, scene) {
    const root = scene.getObjectByName(id) || scene.children[0] || scene;
    let meta = {};
    try { meta = JSON.parse(root.userData.vk || '{}'); } catch (e) { /* no rig metadata */ }
    const scheme = VEHICLES[id].paint;
    root.traverse((o) => {
        if (o.userData && typeof o.userData.joint === 'string') {
            try { o.userData.joint = JSON.parse(o.userData.joint); } catch (e) { delete o.userData.joint; }
        }
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        const swap = (m) => m && (m.name === 'Paint' ? paintMaterial(scheme) : m.name === 'Detail' ? detailMaterial() : m.name === 'Track' ? trackMaterial() : m);
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
    });
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    return { scene: root, meta };
}

// ── instances ──
// opts.paint: a scheme from PAINTS (default: the vehicle's own)
export function createVehicle(id, opts = {}) {
    const src = cache[id];
    if (!src) throw new Error('[vehicles] not loaded: ' + id);
    const object = src.scene.clone(true);
    object.name = id;
    const rig = buildRig(id, object, src.meta);
    if (opts.paint && opts.paint !== VEHICLES[id].paint) repaint(object, opts.paint);
    if (rig.tracks.length) {
        // each side's track gets its own material copy so it can scroll on its own (the image is shared)
        for (const t of rig.tracks) {
            const m = trackMaterial().clone();
            m.map = trackMaterial().map.clone();
            t.node.traverse(o => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(x => x.name === 'Track' ? m : x) : (o.material.name === 'Track' ? m : o.material); });
            t.material = m;
        }
    }
    return { object, rig };
}

export function repaint(object, scheme) {
    const m = paintMaterial(scheme);
    object.traverse(o => {
        if (!o.isMesh) return;
        o.material = Array.isArray(o.material) ? o.material.map(x => x.name === 'Paint' ? m : x) : (o.material.name === 'Paint' ? m : o.material);
    });
}

function buildRig(id, object, meta) {
    const nodes = {};
    object.traverse(o => { if (o.name) nodes[o.name] = o; });
    const rig = {
        id, spec: VEHICLES[id], object, nodes, meta,
        dims: meta.dims || null,
        joints: [], byGroup: {}, byName: {},
        wheels: [], rams: [], tracks: [], muzzles: [], missiles: [], canisters: [],
        erector: nodes.erector || null, missile: nodes.missile || null, pad: nodes.pad || null,
        turret: nodes.turret || null, launcher: nodes.launcher || null, antenna: nodes.antenna || null, mast: nodes.mast || null,
        jacks: { fl: nodes.jack_fl || null, fr: nodes.jack_fr || null, rl: nodes.jack_rl || null, rr: nodes.jack_rr || null },
        exhaust: nodes.exhaust || null, seat: nodes.seat_driver || null, hatch: nodes.hatch_entry || null,
        state: { raise: 0, jack: 0, pad: 0, yaw: 0, pitch: 0 },
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
    const numbered = (prefix) => Object.keys(nodes).filter(n => new RegExp('^' + prefix + '_\\d+$').test(n))
        .sort((a, b) => +a.split('_').pop() - +b.split('_').pop()).map(n => nodes[n]);
    rig.muzzles = numbered('muzzle');
    rig.missiles = numbered('missile');
    rig.canisters = numbered('canister');
    for (const w of meta.wheels || []) {
        const node = nodes[w.node];
        if (!node) continue;
        node.rotation.reorder('YXZ'); // yaw (steering) outside, spin inside
        rig.wheels.push({ node, r: w.r, steer: w.steer || 0, side: w.side || 1, yaw0: node.rotation.y, spin: node.rotation.x });
    }
    for (const r of meta.rams || []) {
        const node = nodes[r.node], end = nodes[r.end];
        if (!node || !end) continue;
        const e = { node, end, len: r.len, restQuat: node.quaternion.clone(), stages: r.stages.map(n => ({ node: nodes[n], rest: nodes[n].position.clone() })), restDir: new THREE.Vector3() };
        // rest direction in the parent frame: base → anchor, measured in the rest pose
        object.updateMatrixWorld(true);
        e.restDir.copy(end.getWorldPosition(_v)).sub(node.getWorldPosition(_v2));
        e.restDir.applyMatrix3(_m.setFromMatrix4(node.parent.matrixWorld).invert()).normalize();
        rig.rams.push(e);
    }
    for (const t of meta.tracks || []) {
        const node = nodes[t.node];
        if (node) rig.tracks.push({ node, side: t.side || 1, tile: t.tile || 0.68, material: null, offset: 0 });
    }
    return rig;
}

// ── joints ──
// setJoint: an absolute joint value (radians for 'rot', metres for 'slide'), clamped to the joint's range
export function setJoint(rig, name, value) {
    const e = typeof name === 'string' ? rig.byName[name] : name;
    if (!e) return;
    const j = e.j;
    if (j.type !== 'spin') value = Math.min(Math.max(value, Math.min(j.min, j.max)), Math.max(j.min, j.max));
    e.value = value;
    if (j.type === 'slide') {
        e.node.position.copy(e.restPos).addScaledVector(e.axis, value);
    } else {
        e.node.quaternion.setFromAxisAngle(e.axis, value).multiply(e.restQuat);
    }
}

// pose(rig, group, k): every joint in the group to stow + (deploy − stow)·k
export function pose(rig, group, k) {
    const list = rig.byGroup[group];
    if (!list) return;
    for (const e of list) setJoint(rig, e, e.j.stow + (e.j.deploy - e.j.stow) * k);
    rig.state[group] = k;
    updateRams(rig);
}

export const raise = (rig, k) => pose(rig, 'raise', k);          // erector / mast / lifting frame: 0 stowed … 1 erected
export const deployJacks = (rig, k) => pose(rig, 'jack', k);     // stabiliser jacks down to the ground
export const deployPad = (rig, k) => pose(rig, 'pad', k);        // a TEL's launch pad swung down under the missile
export const openDoors = (rig, k) => pose(rig, 'door', k);
export const openHatches = (rig, k) => pose(rig, 'hatch', k);

// aim(rig, yaw, pitch): turret yaw (radians, + = to the left) and launcher pitch (+ = up), clamped to the joints'
// limits. Vehicles with several aiming joints (a radar head and a launcher) aim all of them.
export function aim(rig, yaw, pitch) {
    for (const e of rig.byGroup.turret || []) setJoint(rig, e, yaw);
    for (const e of rig.byGroup.launcher || []) setJoint(rig, e, pitch);
    rig.state.yaw = yaw; rig.state.pitch = pitch;
    updateRams(rig);
}

// spin(rig, dt): radar antennas turn at their own rate (joint.rpm)
export function spin(rig, dt, rate = 1) {
    for (const e of rig.byGroup.spin || []) setJoint(rig, e, (e.value + dt * rate * (e.j.rpm || 6) * Math.PI / 30) % (Math.PI * 2));
}

// roll(rig, metres): turn the wheels (and scroll the tracks) for a distance driven (+ = forwards)
export function roll(rig, dist, distRight = dist) {
    for (const w of rig.wheels) {
        const d = w.side > 0 ? distRight : dist;
        w.spin = (w.spin - d / w.r * w.side) % (Math.PI * 2);
        w.node.rotation.x = w.spin;
    }
    for (const t of rig.tracks) {
        t.offset = (t.offset + (t.side > 0 ? distRight : dist) / t.tile) % 1;
        if (t.material) t.material.map.offset.x = t.offset; // u runs forwards along the ground run (vkit track_run)
    }
}

// steer(rig, angle): steered wheels (+ = to the left); each axle turns by its own share (rig.wheels[i].steer)
export function steer(rig, angle) {
    for (const w of rig.wheels) if (w.steer) w.node.rotation.y = w.yaw0 + angle * w.steer;
}

// Re-aim the hydraulic rams at their anchors and slide their rod stages out to reach them.
export function updateRams(rig) {
    if (!rig.rams.length) return;
    rig.object.updateMatrixWorld(true);
    for (const r of rig.rams) {
        r.node.quaternion.copy(r.restQuat);
        r.node.updateMatrixWorld(true);
        _v.copy(r.end.getWorldPosition(_v)).sub(r.node.getWorldPosition(_v2));
        const len = _v.length();
        _v.applyMatrix3(_m.setFromMatrix4(r.node.parent.matrixWorld).invert()).normalize();
        _q.setFromUnitVectors(r.restDir, _v);
        r.node.quaternion.copy(_q).multiply(r.restQuat);
        const n = r.stages.length;
        for (let i = 0; i < n; i++) r.stages[i].node.position.copy(r.stages[i].rest).addScaledVector(r.restDir, (len - r.len) * (i + 1) / n);
    }
    rig.object.updateMatrixWorld(true);
}

// World position and direction (unit) of muzzle i (0-based): where a rocket / missile leaves tube, rail or canister i
export function muzzleWorld(rig, i, pos, dir) {
    const m = rig.muzzles[i];
    if (!m) return false;
    m.updateWorldMatrix(true, false);
    if (pos) pos.setFromMatrixPosition(m.matrixWorld);
    if (dir) dir.set(0, 0, -1).applyQuaternion(m.getWorldQuaternion(_q2));
    return true;
}

// A merged, static copy of a vehicle in its current pose (a few draw calls): parked / distant vehicles
export function staticVehicle(object) {
    object.updateMatrixWorld(true);
    return mergeStaticModel(object);
}

// Rest the rig: every joint stowed, wheels straight
export function stow(rig) {
    for (const e of rig.joints) setJoint(rig, e, e.j.stow || 0);
    for (const w of rig.wheels) { w.node.rotation.y = w.yaw0; }
    for (const k of Object.keys(rig.state)) rig.state[k] = 0;
    updateRams(rig);
}

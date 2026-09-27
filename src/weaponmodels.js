// ═══════════════════════════════════════════════════════════════
// Weapon and arms models (models/weapons/, see models/weapons/CREDITS.md), loaded once and cloned per use.
// A weapon file (tools/weapons/import_weapon.py) holds:
//   lod0  the detailed weapon: named moving parts (mag, bolt, slide, pump, hammer, rocket, spoon, pin) and
//         empties: grip (the firing hand; the origin), support (the other hand), muzzle, eject, sight /
//         sightFront (the sight line), shoulder / rear (RPG), port (shotgun loading port), charge (bolt handle)
//   lod1  the same merged into one decimated mesh (a soldier's weapon further away, a dropped weapon)
//   root parts: the RPG's rocket in flight (fins out), the shotgun's shell
// Weapons face -Z, +Y up, metres. arms.glb: first-person arms (rigged, gloved) for the view model.
// Without the files (tests, a failed download) procedural stand-ins are used.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildRifleModel } from './rifle.js';

export const WEAPON_FILES = { ak47: 'ak47', m4a1: 'm4a1', m870: 'm870', m9: 'm9', deagle: 'deagle', rpg7: 'rpg7', m67: 'm67' };
const loaded = {};     // id → gltf scene
let armsSrc = null;

export async function preloadWeapons(base = 'models/weapons/') {
    const loader = new GLTFLoader();
    const jobs = Object.entries(WEAPON_FILES).map(async ([id, f]) => {
        try {
            const g = await loader.loadAsync(base + f + '.glb');
            prepare(g.scene);
            loaded[id] = g.scene;
        } catch (e) { console.warn('[weapons] failed to load', f, e); }
    });
    jobs.push((async () => {
        try {
            const g = await loader.loadAsync(base + 'arms.glb');
            g.scene.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; tuneMaterial(o.material, true); } });
            armsSrc = g.scene;
        } catch (e) { console.warn('[weapons] failed to load arms', e); }
    })());
    await Promise.all(jobs);
}
export const hasWeaponModel = (id) => !!loaded[id];
export const hasArms = () => !!armsSrc;

function tuneMaterial(m, skin = false) {
    if (!m || !('roughness' in m)) return;
    m.envMapIntensity = skin ? 0.6 : 0.85;
    m.side = THREE.FrontSide; // closed meshes: half the fragments of double-sided
    if (m.normalMap) m.normalScale.set(1, 1);
}
function prepare(scene) {
    scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        tuneMaterial(o.material);
    });
}

// read the empties (and parts) of a lod0 group
function collect(lod0) {
    const points = {}, parts = {};
    for (const c of lod0.children) {
        if (c.isMesh || c.children.some(k => k.isMesh)) parts[c.name] = c;
        else points[c.name] = c.position.clone();
    }
    return { points, parts };
}

// A weapon for the view model or a character's hands. lod 0: the detailed model with moving parts; lod 1: one
// mesh. Returns { id, root, parts, points, lod, rest } — parts' rest positions / rotations in `rest`.
export function weaponModel(id, { lod = 0, shadows = true } = {}) {
    const src = loaded[id];
    let root, parts, points;
    if (src) {
        const node = src.getObjectByName(lod ? 'lod1' : 'lod0') || src.getObjectByName('lod0');
        const inst = node.clone(true);
        if (lod) {
            root = new THREE.Group(); root.add(inst); inst.position.set(0, 0, 0);
            ({ points } = collect(src.getObjectByName('lod0')));
            parts = {};
        } else {
            root = inst;
            ({ points, parts } = collect(root));
        }
    } else ({ root, parts, points } = fallbackWeapon(id));
    root.name = 'weapon:' + id;
    root.traverse(o => { if (o.isMesh) { o.castShadow = shadows; o.receiveShadow = shadows; } });
    const rest = {};
    for (const [k, p] of Object.entries(parts)) rest[k] = { pos: p.position.clone(), quat: p.quaternion.clone() };
    return { id, root, parts, points, lod, rest };
}
// put the moving parts back where they were built
export function restParts(w) {
    for (const [k, r] of Object.entries(w.rest)) { const p = w.parts[k]; if (p) { p.position.copy(r.pos); p.quaternion.copy(r.quat); p.visible = true; } }
}

// the RPG's PG-7V as it flies (fins out), nose toward -Z, centred on its middle
export function rocketModel() {
    const src = loaded.rpg7 && loaded.rpg7.getObjectByName('rocket_flight');
    const g = new THREE.Group();
    if (src) {
        const m = src.clone(true);
        m.position.set(0, 0, 0);
        m.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3());
        m.position.sub(c);
        g.add(m);
    } else {
        const olive = new THREE.MeshStandardMaterial({ color: 0x5d6b3a, roughness: 0.6, metalness: 0.3 });
        const head = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.043, 0.4, 12).rotateX(-Math.PI / 2), olive); head.position.z = -0.3;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.55, 10).rotateX(Math.PI / 2), olive); body.position.z = 0.15;
        g.add(head, body);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    return g;
}

// a thrown grenade (lod 0 without the pin, the spoon flies off separately)
export function grenadeModel() {
    const w = weaponModel('m67');
    if (w.parts.pin) w.parts.pin.visible = false;
    return w;
}

// ── Spent cases: shared geometry and materials, instanced by whoever ejects them ──
let caseGeo = null, shellGeo = null, brass = null, hull = null;
export function caseGeometry(kind) {
    if (!caseGeo) {
        caseGeo = new THREE.CylinderGeometry(0.0055, 0.006, 0.039, 8, 1).rotateX(Math.PI / 2); // 7.62×39 / 5.56 / 9 mm, near enough
        shellGeo = new THREE.CylinderGeometry(0.0105, 0.0105, 0.07, 10, 1).rotateX(Math.PI / 2);
        brass = new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.35, metalness: 0.9 });
        hull = new THREE.MeshStandardMaterial({ color: 0xa8201a, roughness: 0.6, metalness: 0.1 });
    }
    return kind === 'shell' ? { geo: shellGeo, mat: hull } : { geo: caseGeo, mat: brass };
}

// ── First-person arms (skinned) ──
// Returns { root, mesh, bones: { R_arm, R_elbow, R_wrist, R_point1, ..., L_... } } or null
export function armsModel() {
    if (!armsSrc) return null;
    const root = SkeletonUtils.clone(armsSrc);
    const bones = {};
    let mesh = null;
    root.traverse(o => {
        if (o.isBone) bones[o.name.replace(/_\d+$/, '')] = o;
        if (o.isSkinnedMesh) mesh = o;
    });
    return { root, mesh, bones };
}

// ═══════════════════════════════════════════════════════════════
// Procedural stand-ins (no model files): same conventions, rough shapes
// ═══════════════════════════════════════════════════════════════
const FALLBACK_POINTS = {
    ak47: { muzzle: [0, 0.073, -0.606], support: [0, 0.067, -0.291], eject: [0.018, 0.085, -0.166], sight: [0, 0.1165, -0.231], sightFront: [0, 0.1175, -0.548] },
    m4a1: { muzzle: [0, 0.088, -0.555], support: [0, 0.082, -0.287], eject: [0.015, 0.087, -0.097], sight: [0, 0.1355, -0.027], sightFront: [0, 0.1375, -0.389] },
    m870: { muzzle: [0, 0.0595, -0.71], support: [0, 0.024, -0.385], eject: [0.016, 0.052, -0.185], sight: [0, 0.075, -0.12], sightFront: [0, 0.08, -0.695], port: [0, 0.022, -0.12] },
    m9: { muzzle: [0, 0.053, -0.167], eject: [0.012, 0.067, -0.05], sight: [0, 0.071, 0.014], sightFront: [0, 0.072, -0.151] },
    deagle: { muzzle: [0, 0.071, -0.213], eject: [0.015, 0.074, -0.12], sight: [0, 0.0845, 0.02], sightFront: [0, 0.0865, -0.205] },
    rpg7: { muzzle: [0, 0.13, -0.205], support: [0, 0.05, 0.145], rear: [0, 0.13, 0.745], shoulder: [0, 0.13, 0.345], sight: [0, 0.215, 0.145], sightFront: [0, 0.195, -0.18] },
    m67: {},
};
function fallbackWeapon(id) {
    const root = new THREE.Group(), parts = {};
    const steel = new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.45, metalness: 0.8 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b3a1c, roughness: 0.6 });
    const olive = new THREE.MeshStandardMaterial({ color: 0x4b5536, roughness: 0.7, metalness: 0.2 });
    const add = (geo, mat, x, y, z, name) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); root.add(m); if (name) { m.name = name; parts[name] = m; } return m; };
    const cylZ = (r1, r2, l, seg = 10) => new THREE.CylinderGeometry(r1, r2, l, seg).rotateX(Math.PI / 2);
    switch (id) {
        case 'ak47': case 'm4a1': {
            const ak = buildRifleModel();
            ak.position.set(0, 0.0, 0.0);
            ak.scale.setScalar(0.8);
            root.add(ak);
            break;
        }
        case 'm870':
            add(cylZ(0.012, 0.012, 0.66), steel, 0, 0.06, -0.38);
            add(cylZ(0.022, 0.022, 0.2), wood, 0, 0.024, -0.385, 'pump');
            add(new THREE.BoxGeometry(0.04, 0.05, 0.22), steel, 0, 0.05, -0.06);
            add(new THREE.BoxGeometry(0.036, 0.07, 0.3), wood, 0, 0.0, 0.2);
            break;
        case 'm9': case 'deagle': {
            const k = id === 'deagle' ? 1.25 : 1;
            add(new THREE.BoxGeometry(0.03 * k, 0.035 * k, 0.2 * k), steel, 0, 0.06 * k, -0.06 * k, 'slide');
            add(new THREE.BoxGeometry(0.028 * k, 0.11 * k, 0.045 * k), steel, 0, 0.0, 0.0);
            add(new THREE.BoxGeometry(0.02 * k, 0.1 * k, 0.03 * k), steel, 0, -0.01 * k, 0.0, 'mag');
            break;
        }
        case 'rpg7':
            add(cylZ(0.022, 0.022, 0.95), olive, 0, 0.13, 0.27);
            add(cylZ(0.035, 0.035, 0.35), wood, 0, 0.13, 0.35);
            add(cylZ(0.043, 0.02, 0.4), olive, 0, 0.13, -0.35, 'rocket');
            add(new THREE.BoxGeometry(0.025, 0.09, 0.035), wood, 0, 0.0, 0.0);
            break;
        case 'm67':
            add(new THREE.SphereGeometry(0.032, 14, 10), olive, 0, 0, 0);
            add(new THREE.BoxGeometry(0.012, 0.06, 0.004), steel, 0, 0.02, 0.03, 'spoon');
            add(new THREE.TorusGeometry(0.01, 0.0015, 5, 12), steel, 0.01, 0.045, 0, 'pin');
            break;
    }
    const points = { grip: new THREE.Vector3() };
    for (const [k, v] of Object.entries(FALLBACK_POINTS[id] || {})) points[k] = new THREE.Vector3(...v);
    return { root, parts, points };
}

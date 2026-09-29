// ═══════════════════════════════════════════════════════════════
// Naval forces: aircraft carriers and destroyers.
//  • Ships steam in large circles in open ocean, or steer a heading and speed when a group plug-in drives them
//    (Ship.steer: navalops.js keeps carrier groups in formation).
//  • Carrier decks are real landing surfaces (moving), with catapults and
//    arresting wires.
//  • CIWS guns shoot down incoming missiles and aircraft; SAM launchers defend
//    the group. Destroyed ships burn and sink.
// Ships implement the same interface as ground targets (pos, team, damage…)
// so HUD, targeting and weapons work on them unchanged.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeInPlace, mergeStaticModel } from './meshmerge.js';
import { clusterTriangles } from './farmodel.js';
import { ShipFX, deckHeightAt, foamTexture } from './shipfx.js';
import { waterHeightLong } from './water.js';
import { terrainHeight } from './world.js';
import { loft, createAircraftModel } from './models.js';
import { rand, clamp, lerp, interceptTime, freezeLocal, skipWorldWhileHidden } from './util.js';
import { WEAPONS, AIRCRAFT } from './config.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _mp = new THREE.Vector3();
const damp01 = (a, b, dt) => a + (b - a) * (1 - Math.exp(-0.5 * dt));
const wrapPi = (a) => { a %= Math.PI * 2; return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a; };

// Group steaming (navalops.js): how a hull answers the helm when it steers a heading and speed instead of circling.
// maxSpeed m/s (flank), accel m/s² (it slows twice as fast), turn rad/s at full rudder with way on (tactical
// diameters: a Nimitz ~1.2 km at 30 kt, an Arleigh Burke ~0.6 km), rudder s (how long the turn takes to build).
export const HELM = {
    carrier: { maxSpeed: 16, accel: 0.06, turn: 0.016, rudder: 6 },
    destroyer: { maxSpeed: 16.5, accel: 0.14, turn: 0.034, rudder: 3.5 },
    cruiser: { maxSpeed: 16.5, accel: 0.13, turn: 0.032, rudder: 3.5 },
    slava: { maxSpeed: 16.5, accel: 0.12, turn: 0.03, rudder: 4 },
    supply: { maxSpeed: 14.5, accel: 0.07, turn: 0.02, rudder: 5 },
    ssn: { maxSpeed: 16, accel: 0.15, turn: 0.035, rudder: 3 },
    ssgn: { maxSpeed: 13, accel: 0.1, turn: 0.025, rudder: 4 },
    rhib: { maxSpeed: 25, accel: 2.5, turn: 0.45, rudder: 0.6 },
    cb90: { maxSpeed: 22, accel: 2, turn: 0.35, rudder: 0.7 },
};

const TYPES = {
    carrier: { name: 'CARRIER', L: 320, B: 76, deckY: 19, hp: 1300, score: 3000, speed: 12 },
    destroyer: { name: 'DESTROYER', L: 155, B: 20, deckY: 8, hp: 450, score: 1200, speed: 13 },
    // (models/ships/*.glb, tools/ships/*_model.py; cls = the war layer's class string, docs/WAR.md)
    cruiser: { name: 'CRUISER', L: 173, B: 16.8, deckY: 6.4, hp: 520, score: 1500, speed: 13 },
    ssn: { name: 'SUBMARINE', L: 140, B: 10.4, deckY: 1.7, hp: 260, score: 1400, speed: 8, cls: 'sub' },
    ssgn: { name: 'SSGN', L: 171, B: 12.8, deckY: 1.9, hp: 320, score: 1600, speed: 8, cls: 'sub' },
    supply: { name: 'SUPPLY SHIP', L: 229, B: 32.6, deckY: 12.5, hp: 700, score: 900, speed: 11 },
    rhib: { name: 'RHIB', L: 11, B: 3.2, deckY: 0.9, hp: 25, score: 80, speed: 16, cls: 'boat' },
    cb90: { name: 'COMBAT BOAT', L: 15.9, B: 3.8, deckY: 1.3, hp: 60, score: 200, speed: 18, cls: 'boat' },
    slava: { name: 'SLAVA CRUISER', L: 186, B: 20.8, deckY: 7.6, hp: 600, score: 1800, speed: 13 },
};
export const SHIP_TYPES = TYPES;

// How a hull answers the sea (water.js): it feels only waves longer than `minLam` (a long hull bridges the short
// ones), sampled at its bow, stern and sides, and follows them as a damped oscillator for heave, pitch and roll
// (natural periods T s, damping ζ), scaled by `gain` and capped (m / rad) so a carrier deck stays landable.
const SEA_RESPONSE = {
    carrier: { minLam: 110, heave: { T: 9, z: 0.6, gain: 0.8, cap: 1.6 }, pitch: { T: 8, z: 0.7, gain: 0.6, cap: 0.012 }, roll: { T: 17, z: 0.35, gain: 0.5, cap: 0.018 } },
    destroyer: { minLam: 45, heave: { T: 6, z: 0.45, gain: 0.95, cap: 3 }, pitch: { T: 6, z: 0.5, gain: 0.9, cap: 0.07 }, roll: { T: 10, z: 0.15, gain: 1, cap: 0.2 } },
    cruiser: { minLam: 50, heave: { T: 6.5, z: 0.45, gain: 0.9, cap: 2.8 }, pitch: { T: 6.5, z: 0.5, gain: 0.85, cap: 0.06 }, roll: { T: 11, z: 0.15, gain: 0.95, cap: 0.18 } },
    slava: { minLam: 50, heave: { T: 6.5, z: 0.45, gain: 0.9, cap: 2.8 }, pitch: { T: 6.5, z: 0.5, gain: 0.85, cap: 0.06 }, roll: { T: 11, z: 0.15, gain: 0.95, cap: 0.18 } },
    supply: { minLam: 70, heave: { T: 7.5, z: 0.5, gain: 0.85, cap: 2.2 }, pitch: { T: 7, z: 0.6, gain: 0.7, cap: 0.035 }, roll: { T: 13, z: 0.25, gain: 0.8, cap: 0.1 } },
    // surfaced submarines: round hulls with little freeboard roll easily; submerged, the waves fade out (update)
    ssn: { minLam: 35, heave: { T: 5.5, z: 0.4, gain: 1, cap: 2.5 }, pitch: { T: 5.5, z: 0.45, gain: 0.9, cap: 0.08 }, roll: { T: 8, z: 0.12, gain: 1, cap: 0.22 } },
    ssgn: { minLam: 45, heave: { T: 6, z: 0.4, gain: 1, cap: 2.8 }, pitch: { T: 6, z: 0.45, gain: 0.9, cap: 0.07 }, roll: { T: 9, z: 0.12, gain: 1, cap: 0.2 } },
    // small boats ride the short waves
    rhib: { minLam: 4, heave: { T: 1.1, z: 0.5, gain: 1, cap: 1.2 }, pitch: { T: 1.1, z: 0.45, gain: 1, cap: 0.3 }, roll: { T: 1.5, z: 0.3, gain: 1, cap: 0.35 } },
    cb90: { minLam: 6, heave: { T: 1.4, z: 0.5, gain: 1, cap: 1.3 }, pitch: { T: 1.4, z: 0.45, gain: 1, cap: 0.25 }, roll: { T: 1.9, z: 0.3, gain: 1, cap: 0.3 } },
};

function inPoly(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < xi + (z - zi) / (zj - zi) * (xj - xi)) inside = !inside;
    }
    return inside;
}

// Find a spot of open ocean where a ship can circle
export function findOcean(nearX, nearZ, minD, maxD, orbitR) {
    for (let tries = 0; tries < 400; tries++) {
        const a = Math.random() * Math.PI * 2, d = rand(minD, maxD);
        const x = nearX + Math.cos(a) * d, z = nearZ + Math.sin(a) * d;
        if (terrainHeight(x, z) > -50) continue;
        let ok = true;
        for (let k = 0; k < 16 && ok; k++) {
            const b = (k / 16) * Math.PI * 2;
            for (const r of [orbitR * 0.6, orbitR + 400]) {
                if (terrainHeight(x + Math.cos(b) * r, z + Math.sin(b) * r) > -25) { ok = false; break; }
            }
        }
        if (ok) return { x, z };
    }
    return null;
}

function deckTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 1024;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3d4044'; ctx.fillRect(0, 0, 256, 1024);
    for (let i = 0; i < 9000; i++) {
        const v = 50 + Math.random() * 25;
        ctx.fillStyle = `rgba(${v},${v},${v + 3},0.35)`;
        ctx.fillRect(Math.random() * 256, Math.random() * 1024, 2, 2);
    }
    // angled landing area (stern at bottom, bow at top)
    ctx.save();
    ctx.translate(96, 1024);
    ctx.rotate(-0.16);
    ctx.strokeStyle = '#f2f2f2'; ctx.lineWidth = 3;
    ctx.strokeRect(-40, -620, 80, 620);
    ctx.setLineDash([22, 18]);
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, -600); ctx.lineTo(0, 0); ctx.stroke();
    ctx.setLineDash([]);
    // arresting wires
    ctx.strokeStyle = '#d8d0b0'; ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-40, -120 - k * 26); ctx.lineTo(40, -120 - k * 26); ctx.stroke(); }
    ctx.restore();
    // catapult tracks at the bow
    ctx.strokeStyle = '#8a8d90'; ctx.lineWidth = 2;
    for (const x of [150, 190]) { ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, 420); ctx.stroke(); }
    // yellow taxi lines
    ctx.strokeStyle = '#e8c23a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(200, 980); ctx.bezierCurveTo(220, 700, 170, 500, 170, 60); ctx.stroke();
    // bow number
    ctx.fillStyle = '#e8e8e8'; ctx.font = 'bold 70px Arial'; ctx.textAlign = 'center';
    ctx.save(); ctx.translate(128, 120); ctx.rotate(Math.PI); ctx.fillText('73', 0, 0); ctx.restore();
    // elevators
    ctx.strokeStyle = 'rgba(230,230,230,0.5)'; ctx.lineWidth = 2;
    ctx.strokeRect(205, 380, 45, 70); ctx.strokeRect(205, 560, 45, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    return t;
}

const MAT = {
    hull: new THREE.MeshStandardMaterial({ color: 0x5c6369, roughness: 0.7, metalness: 0.35 }),
    hullDark: new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.7, metalness: 0.3 }),
    super: new THREE.MeshStandardMaterial({ color: 0x6d747a, roughness: 0.6, metalness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.1, metalness: 0.9 }),
    white: new THREE.MeshStandardMaterial({ color: 0xd8dbdc, roughness: 0.5 }),
    charred: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 }),
};
let deckTex = null;

function box(w, h, d, mat, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
}

// A parked aircraft for a deck: its model standing on landing gear (the legs Aircraft.buildGear makes: struts and
// wheels under the belly, the belly 1.2 m up), origin on the deck. (The models themselves are gear-up.)
const PARK_MAT = {
    strut: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.7, roughness: 0.35 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
};
export function parkedModel(kind) {
    const { object, rig } = createAircraftModel(kind);
    const spec = AIRCRAFT[kind] || { length: 17, category: 'fighter' };
    const L = spec.length;
    const H = -(rig.minY ?? -L * 0.08) + 1.2;
    const g = new THREE.Group();
    object.position.y = H;
    g.add(object);
    if (!(rig.gearParts && rig.gearParts.length) && !rig.fixedGear) {
        const sc = clamp(L / 17, 0.8, 3.2), wheelR = 0.33 * sc, bellyY = (rig.minY != null ? rig.minY + 0.15 : -H + 1.35) + H;
        const mainX = spec.category === 'civil' || spec.category === 'bomber' ? Math.min((rig.halfSpan || spec.span / 2) * 0.25, L * 0.09) : Math.max(1.0, L * 0.075);
        for (const [x, z] of [[0, -0.3 * L], [-mainX, 0.04 * L], [mainX, 0.04 * L]]) {
            const len = Math.max(0.4, bellyY - wheelR);
            const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * sc, 0.09 * sc, len, 6), PARK_MAT.strut);
            strut.position.set(x, wheelR + len / 2, z);
            const tyre = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.22 * sc, 12), PARK_MAT.tyre);
            tyre.rotation.z = Math.PI / 2; tyre.position.set(x, wheelR, z);
            g.add(strut, tyre);
        }
    }
    return g;
}

// Ship models (tools/ships/*.py, models/ships/CREDITS.md). Loaded once at boot; if a file is missing the
// procedural ship below is used instead.
const SHIP_FILES = {
    carrier: 'models/ships/carrier.glb', destroyer: 'models/ships/destroyer.glb',
    cruiser: 'models/ships/cruiser.glb', ssn: 'models/ships/ssn.glb', ssgn: 'models/ships/ssgn.glb', rhib: 'models/ships/rhib.glb', cb90: 'models/ships/cb90.glb', supply: 'models/ships/supply.glb', slava: 'models/ships/slava.glb',
};
const shipGltf = {};
// The carrier and destroyer (what the game modes spawn today) load before the game starts; the other fleet models
// load right after, off the boot's critical path: await shipsLoaded() before spawning them.
const BOOT_SHIPS = ['carrier', 'destroyer'];
let lateShips = null;
const shipLoading = new Set();   // types whose model is still on its way
export async function preloadShips() {
    foamTexture(); // build the procedural foam texture now (~80 ms) rather than on the first sortie
    const loader = new GLTFLoader();
    const load = async ([type, file]) => {
        shipLoading.add(type);
        try { shipGltf[type] = await loader.loadAsync(file); } catch (e) { console.warn('[naval] ship model not loaded:', file, e && e.message); }
        shipLoading.delete(type);
    };
    const files = Object.entries(SHIP_FILES);
    await Promise.all(files.filter(([t]) => BOOT_SHIPS.includes(t)).map(load));
    lateShips = Promise.all(files.filter(([t]) => !BOOT_SHIPS.includes(t)).map(load));
}
export function shipsLoaded() { return lateShips || Promise.resolve(); }
export function hasShipModel(type) { return !!shipGltf[type]; }
// Use an already parsed glTF for a ship type (tests, tools); ships made after this use it.
export function setShipModel(type, gltf) { shipGltf[type] = gltf; delete templates[type]; }
export const SHIP_MODEL_FILES = SHIP_FILES;

// A ship from its glTF: static hull/superstructure, rotating radar(s) "radar"/"radar2", turrets "mount_<type>_<n>";
// root extras.skywar = the layout (deck outline, waterline, parked aircraft…) written by the Blender script.
function buildFromGltf(type, gltf) {
    const g = new THREE.Group(), parts = {};
    const root = gltf.scene.clone(true);
    g.add(root);
    let layout = null;
    root.traverse(o => { if (!layout && o.userData && typeof o.userData.skywar === 'string') { try { layout = JSON.parse(o.userData.skywar); } catch (e) { /* ignore */ } } });
    root.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
            if (!m) continue;
            if (m.map) m.map.anisotropy = 16;
            // painted steel in the open: the sky (and the sea's bounce) light the shaded sides a lot
            m.envMapIntensity = m.name === 'Deck' ? 0.6 : 1.25;
            if (m.name === 'Under') m.userData.noMerge = true; // shipfx.js tints it as the light changes: keep it a material of its own
        }
    });
    const radar = root.getObjectByName('radar');
    if (radar) { radar.name = 'ship:radar'; parts.radar = radar; }
    const radar2 = root.getObjectByName('radar2');
    if (radar2) { radar2.name = 'ship:radar2'; parts.radar2 = radar2; }
    const mounts = [];
    root.traverse(o => {
        const m = /^mount_(ciws|sam|gun)_\d+$/.exec(o.name);
        if (m) mounts.push({ type: m[1], p: o.position.clone(), turret: o });
    });
    prepareRig(root);
    // parked aircraft (kept clear of cat 1, the landing lane and the landing area); one parked on a deck-edge
    // elevator rides it down to the hangar deck (setElevator)
    g.updateMatrixWorld(true);
    for (const [kind, x, z, yaw] of (layout && layout.parked) || []) {
        const object = parkedModel(kind);
        object.position.set(x, layout.deckY || TYPES[type].deckY, z);
        object.rotation.y = yaw;
        object.scale.setScalar(0.95);
        const k = (layout.elevators || []).findIndex(p => inPoly(x, z, p));
        const lift = k >= 0 ? root.getObjectByName('elevator_' + (k + 1)) : null;
        if (lift) { lift.worldToLocal(object.position); lift.add(object); } else g.add(object);
    }
    return { group: g, parts, mounts, layout };
}

// ── Rig: the moving parts the Blender scripts name (docs/WAR.md "Model conventions", tools/ships/RIG.md) ──
// Each rig node carries extras "rig" (JSON). {hinge: [x, y, z], open: rad} turns it about its own axis (after its
// rest rotation) by open·k; {slide: [x, y, z], travel: m} moves it along its own axis by travel·k. t (kind):
// 'door' (vls_<n> cell doors, uptake_<n>, hatch_*, door_*), 'mast' (mast_*), 'elevator' (elevator_<n>),
// 'wheel' and 'turret' (k −1..1: ±open about the hinge), 'cell' (cell_<n>: the missile's start point, +Y = launch
// direction; door = the node that covers it), 'point' (seat_*, hatch_entry, jet_<n>, muzzle_<n>).
// Template time: parse the specs, give single-mesh rig nodes a pivot of their own, and draw doors that share a
// mesh (the ~100 VLS cell doors of a destroyer) as one InstancedMesh per ship — one draw call, not a hundred.
function toPivot(mesh) {
    const p = new THREE.Object3D();
    p.name = mesh.name; p.userData = mesh.userData;
    p.position.copy(mesh.position); p.quaternion.copy(mesh.quaternion); p.scale.copy(mesh.scale);
    const parent = mesh.parent;
    parent.add(p); parent.remove(mesh);
    for (const c of [...mesh.children]) p.add(c);
    mesh.name = ''; mesh.userData = {};
    mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
    p.add(mesh);
    return p;
}

function prepareRig(root) {
    let nodes = [];
    root.traverse(o => {
        if (typeof o.userData.rig !== 'string') return;
        try { o.userData.rigSpec = JSON.parse(o.userData.rig); nodes.push(o); } catch (e) { /* not a rig node */ }
    });
    nodes = nodes.map(o => (o.isMesh ? toPivot(o) : o));
    // doors that share one mesh (and parent) → one InstancedMesh per primitive; the door nodes stay as empty pivots
    const groups = new Map();
    for (const o of nodes) {
        const ms = o.children;
        if (o.userData.rigSpec.t !== 'door' || !ms.length || !ms.every(c => c.isMesh && !c.isInstancedMesh && !c.children.length && !Array.isArray(c.material))) continue;
        const key = ms.map(c => c.geometry.uuid + c.material.uuid).join() + o.parent.uuid;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(o);
    }
    let n = 0;
    const m4 = new THREE.Matrix4();
    for (const list of groups.values()) {
        if (list.length < 3) continue;
        const ims = list[0].children.map(src => {
            src.updateMatrix();
            const im = new THREE.InstancedMesh(src.geometry, src.material, list.length);
            im.name = 'ship:rigdoors' + n++;
            im.castShadow = true; im.receiveShadow = true;
            im.userData.local = src.matrix.toArray();   // the primitive's place in its door node (identity from Blender)
            return im;
        });
        list.forEach((o, i) => {
            o.updateMatrix();
            ims.forEach((im, j) => im.setMatrixAt(i, m4.fromArray(im.userData.local).premultiply(o.matrix)));
            for (const c of [...o.children]) o.remove(c);
            o.userData.rigInst = { ims: ims.map(im => im.name), index: i };
        });
        for (const im of ims) { im.computeBoundingSphere(); list[0].parent.add(im); }
    }
    // small moving parts (hatches, a boat's wheel) are a draw call each in every shadow cascade for a shadow
    // nobody sees: they don't cast one (judged per node, so a mast's parts stay one mesh)
    root.updateMatrixWorld(true);
    const box = new THREE.Box3(), size = new THREE.Vector3();
    for (const o of nodes) {
        box.setFromObject(o);
        if (!box.isEmpty() && box.getSize(size).length() < 3) o.traverse(c => { if (c.isMesh && !c.isInstancedMesh) c.castShadow = false; });
    }
}

// Per ship (a clone of the template): the rig nodes by name and by kind. Lists are in number order
// (vls_1 → rig.vls[0], cell_1 → rig.cells[0], elevator_1 → rig.elevators[0]).
function bindRig(group) {
    const rig = { nodes: {}, vls: [], cells: [], uptakes: [], masts: {}, elevators: [], hatches: {}, doors: {}, seats: {}, points: {}, turrets: {}, wheel: null };
    const ims = {};
    group.traverse(o => { if (o.isInstancedMesh && o.name.startsWith('ship:rigdoors')) ims[o.name] = o; });
    group.traverse(o => {
        const spec = o.userData.rigSpec;
        if (!spec) return;
        const inst = o.userData.rigInst;
        rig.nodes[o.name] = {
            name: o.name, node: o, spec, k: 0, p0: o.position.clone(), q0: o.quaternion.clone(),
            ims: inst ? inst.ims.map(nm => ims[nm]).filter(Boolean) : null, index: inst ? inst.index : -1,
        };
    });
    const num = (s) => +(/(\d+)$/.exec(s) || [0, 0])[1];
    const byNum = (re) => Object.values(rig.nodes).filter(e => re.test(e.name)).sort((a, b) => num(a.name) - num(b.name));
    rig.vls = byNum(/^vls_\d+$/);
    rig.uptakes = byNum(/^uptake_\d+$/);
    rig.elevators = byNum(/^elevator_\d+$/);
    rig.cells = byNum(/^cell_\d+$/);
    for (const c of rig.cells) {
        c.door = rig.nodes[c.spec.door || c.name.replace('cell_', 'vls_')] || null;
        c.uptake = c.spec.uptake ? rig.nodes[c.spec.uptake] || null : null;
    }
    for (const e of Object.values(rig.nodes)) {
        const nm = e.name;
        if (nm.startsWith('mast_')) rig.masts[nm.slice(5)] = e;
        else if (nm.startsWith('hatch_') && e.spec.t === 'door') rig.hatches[nm.slice(6)] = e;
        else if (nm.startsWith('door_')) rig.doors[nm.slice(5)] = e;
        else if (nm.startsWith('seat_')) rig.seats[nm.slice(5)] = e.node;
        else if (e.spec.t === 'wheel') rig.wheel = e;
        else if (e.spec.t === 'turret') rig.turrets[nm] = e;
        if (e.spec.t === 'point') rig.points[nm] = e.node;
    }
    return rig;
}

// ── Pose helpers (work on a Ship or on shipModel()'s result; k 0..1 = closed/stowed/up … open/raised/down) ──
const _rq = new THREE.Quaternion(), _rax = new THREE.Vector3(), _rm = new THREE.Matrix4();
export function poseRig(ship, name, k) {
    const e = ship && ship.rig && ship.rig.nodes[name];
    if (!e) return false;
    const s = e.spec, o = e.node;
    e.k = s.t === 'wheel' || s.t === 'turret' ? clamp(k, -1, 1) : clamp(k, 0, 1);
    if (s.hinge) o.quaternion.copy(e.q0).multiply(_rq.setFromAxisAngle(_rax.fromArray(s.hinge), (s.open || 0) * e.k));
    if (s.slide) o.position.copy(e.p0).addScaledVector(_rax.fromArray(s.slide).applyQuaternion(e.q0), (s.travel || 0) * e.k);
    o.updateMatrix();
    if (e.ims) for (const im of e.ims) { im.setMatrixAt(e.index, _rm.fromArray(im.userData.local).premultiply(o.matrix)); im.instanceMatrix.needsUpdate = true; }
    return true;
}
// open the door over missile cell i (0-based: cell_1 is 0); on a submarine that's the tube hatch over it
export function openCell(ship, i, k) { const c = ship && ship.rig && ship.rig.cells[i]; return !!(c && c.door) && poseRig(ship, c.door.name, k); }
// open the exhaust uptake of cell i's VLS module (Mk 41: the hatch between its two rows of cells)
export function ventCell(ship, i, k) { const c = ship && ship.rig && ship.rig.cells[i]; return !!(c && c.uptake) && poseRig(ship, c.uptake.name, k); }
// masts by name ('periscope' or 'mast_periscope'); k 0 = stowed in the sail, 1 = fully raised
export function raiseMast(ship, name, k) { return poseRig(ship, name.startsWith('mast_') ? name : 'mast_' + name, k); }
// deck-edge elevator i (0-based); k 0 = flush with the flight deck, 1 = down at the hangar deck
export function setElevator(ship, i, k) { const e = ship && ship.rig && ship.rig.elevators[i]; return !!e && poseRig(ship, e.name, k); }
// hatch_<name> / door_<name>
export function openHatch(ship, name, k) { return poseRig(ship, name.startsWith('hatch_') || name.startsWith('door_') ? name : 'hatch_' + name, k); }
// boat steering wheel, s −1 (hard to port) .. 1 (hard to starboard)
export function steerWheel(ship, s) { const w = ship && ship.rig && ship.rig.wheel; return !!w && poseRig(ship, w.name, s); }
// submarine depth below its surfaced trim, in metres (0 = surfaced, layout.periscopeDepth = only the masts show)
export function setDepth(ship, d) { ship.depth = Math.max(0, d); return ship.depth; }
// world position of cell i's mouth and its launch direction (+Y of the cell node); false if there's no such cell
export function cellFrame(ship, i, pos, dir) {
    const c = ship && ship.rig && ship.rig.cells[i];
    if (!c) return false;
    c.node.updateWorldMatrix(true, false);
    if (pos) pos.setFromMatrixPosition(c.node.matrixWorld);
    if (dir) dir.set(0, 1, 0).transformDirection(c.node.matrixWorld);
    return true;
}

// world position and +Y direction of any rig point or node by name (harpoon_<n> canister mouths, muzzle_<n>…)
export function pointFrame(ship, name, pos, dir) {
    const r = ship && ship.rig;
    const o = r && (r.points[name] || (r.nodes[name] && r.nodes[name].node));
    if (!o) return false;
    o.updateWorldMatrix(true, false);
    if (pos) pos.setFromMatrixPosition(o.matrixWorld);
    if (dir) dir.set(0, 1, 0).transformDirection(o.matrixWorld);
    return true;
}

function buildCarrier() {
    if (shipGltf.carrier) return buildFromGltf('carrier', shipGltf.carrier);
    const T = TYPES.carrier, L = T.L, g = new THREE.Group(), parts = {};
    const hull = new THREE.Mesh(loft([
        [-L * 0.5, 2, 6, T.deckY * 0.45, 2.5], [-L * 0.44, 14, 13, T.deckY * 0.4, 3], [-L * 0.3, 20, 14, T.deckY * 0.35, 4],
        [0, 21, 14, T.deckY * 0.35, 5], [L * 0.4, 20, 13, T.deckY * 0.4, 5], [L * 0.5, 18, 12, T.deckY * 0.45, 5],
    ], 20), MAT.hull);
    hull.castShadow = true; hull.receiveShadow = true;
    g.add(hull);
    // flight deck with overhang (angled deck to port)
    if (!deckTex) deckTex = deckTexture();
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.85, metalness: 0.1 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(T.B, 1.2, L), [MAT.hullDark, MAT.hullDark, deckMat, MAT.hullDark, MAT.hullDark, MAT.hullDark]);
    deck.position.set(-4, T.deckY - 0.6, 0);
    deck.receiveShadow = true; deck.castShadow = true;
    g.add(deck);
    // hangar walls under deck overhang
    box(T.B - 26, T.deckY - 8, L * 0.8, MAT.hullDark, -4, 8, 0, g);
    // island on the starboard side
    const ix = T.B * 0.5 - 12, iz = L * 0.08;
    box(12, 16, 36, MAT.super, ix, T.deckY, iz, g);
    box(10, 8, 22, MAT.super, ix, T.deckY + 16, iz - 2, g);
    box(10.2, 2.2, 18, MAT.glass, ix, T.deckY + 20, iz - 3, g);
    box(8, 6, 10, MAT.super, ix, T.deckY + 24, iz - 4, g);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 18, 8), MAT.super);
    mast.position.set(ix, T.deckY + 38, iz - 4);
    g.add(mast);
    const radar = new THREE.Group();
    radar.name = 'ship:radar';
    radar.add(new THREE.Mesh(new THREE.BoxGeometry(9, 2.6, 0.5), MAT.white));
    radar.position.set(ix, T.deckY + 44, iz - 4);
    g.add(radar);
    parts.radar = radar;
    // parked jets along the bow starboard side
    for (let k = 0; k < 5; k++) {
        const { object } = createAircraftModel(k % 2 ? 'f14' : 'fa18');
        object.position.set(T.B * 0.5 - 16, T.deckY + 2.2, -L * 0.42 + k * 22);
        object.rotation.y = Math.PI / 2 + 0.5;
        object.scale.setScalar(0.95);
        g.add(object);
    }
    // CIWS and SAM mounts
    const mounts = [
        { type: 'ciws', p: new THREE.Vector3(T.B * 0.5 - 2, T.deckY - 2, -L * 0.45) },
        { type: 'ciws', p: new THREE.Vector3(-T.B * 0.5 + 2, T.deckY - 2, L * 0.44) },
        { type: 'ciws', p: new THREE.Vector3(T.B * 0.5 - 2, T.deckY - 2, L * 0.4) },
        { type: 'sam', p: new THREE.Vector3(-T.B * 0.5 + 4, T.deckY - 2, -L * 0.38) },
        { type: 'sam', p: new THREE.Vector3(T.B * 0.5 - 4, T.deckY - 2, L * 0.46) },
    ];
    mounts.forEach(m => addMount(g, m));
    return { group: g, parts, mounts };
}

function buildDestroyer() {
    if (shipGltf.destroyer) return buildFromGltf('destroyer', shipGltf.destroyer);
    const T = TYPES.destroyer, L = T.L, g = new THREE.Group(), parts = {};
    const hull = new THREE.Mesh(loft([
        [-L * 0.5, 0.5, 2, T.deckY * 0.9, 2], [-L * 0.4, 6, 7, T.deckY * 0.5, 2.5], [-L * 0.1, 10, 8, T.deckY * 0.35, 3.5],
        [L * 0.3, 10, 8, T.deckY * 0.35, 4], [L * 0.5, 8, 6, T.deckY * 0.5, 4],
    ], 18), MAT.hull);
    hull.castShadow = true; hull.receiveShadow = true;
    g.add(hull);
    box(16, 1, L * 0.85, MAT.hullDark, 0, T.deckY - 1, 5, g);
    box(12, 10, 34, MAT.super, 0, T.deckY, -2, g);
    box(10, 6, 16, MAT.super, 0, T.deckY + 10, -6, g);
    box(10.2, 1.8, 6, MAT.glass, 0, T.deckY + 12, -12, g);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.7, 16, 8), MAT.super);
    mast.position.set(0, T.deckY + 24, -4);
    g.add(mast);
    const radar = new THREE.Group();
    radar.name = 'ship:radar';
    radar.add(new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 0.4), MAT.white));
    radar.position.set(0, T.deckY + 30, -4);
    g.add(radar);
    parts.radar = radar;
    box(8, 3, 14, MAT.super, 0, T.deckY, 34, g); // funnel/hangar
    box(9, 2, 10, MAT.hullDark, 0, T.deckY - 1, -44, g); // VLS
    const mounts = [
        { type: 'gun', p: new THREE.Vector3(0, T.deckY, -58) },
        { type: 'sam', p: new THREE.Vector3(0, T.deckY + 1, -44) },
        { type: 'ciws', p: new THREE.Vector3(0, T.deckY + 8, 26) },
    ];
    mounts.forEach(m => addMount(g, m));
    return { group: g, parts, mounts };
}

function addMount(g, m) {
    const turret = new THREE.Group();
    if (m.type === 'ciws') {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 1.8, 10), MAT.white);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.white);
        dome.position.y = 1.8;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3, 6), MAT.hullDark);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.4, -1.8);
        turret.add(base, dome, barrel);
    } else if (m.type === 'gun') {
        const h = new THREE.Mesh(new THREE.BoxGeometry(5, 2.5, 6), MAT.super);
        h.position.y = 1.2;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 7, 8), MAT.hullDark);
        barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.6, -5.5);
        turret.add(h, barrel);
    } else {
        const b = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 3), MAT.super);
        b.position.y = 1.1;
        turret.add(b);
    }
    turret.position.copy(m.p);
    turret.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.add(turret);
    m.turret = turret;
}

// Bake every static mesh of a ship (not the turning radar / turrets) into as few meshes as possible
// (meshmerge.js: one per textured material, one for all the plain painted ones), and each turret's and
// radar's own parts likewise: a carrier with its deck park is a handful of draw calls, and the shadow pass too.
function mergeStatic(g) {
    const moving = [];
    g.traverse(o => { if (o.name.startsWith('ship:radar') || o.name.startsWith('ship:mount') || o.userData.rigSpec) moving.push(o); });
    mergeInPlace(g, moving);
    for (const o of moving) if (o.children.length) mergeInPlace(o, moving.filter(x => x !== o));
}

// Submarines: below the surface their paint fades to the colour of deep water (light absorbed on the way down
// and back), fully by ~5 m, so at periscope depth only the raised masts read, whatever the water shader lets
// through. A clone per source material (a sub's merged meshes share theirs with other ships otherwise).
const DEEP_WATER = new THREE.Color(0.004, 0.025, 0.045);
const _uwMats = new Map();
function underwaterMaterial(src) {
    let m = _uwMats.get(src);
    if (m) return m;
    m = src.clone();
    const prev = src.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
        if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev.call(src, sh, r);
        sh.uniforms.uDeep = { value: DEEP_WATER };
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying float vSubY;')
            .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSubY = (modelMatrix * vec4(transformed, 1.0)).y;');
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying float vSubY;\nuniform vec3 uDeep;')
            .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, uDeep, smoothstep(0.2, 5.0, -vSubY) * 0.95);\n#include <opaque_fragment>');
    };
    const key = src.customProgramCacheKey.bind(src);
    m.customProgramCacheKey = () => key() + '|underwater';
    _uwMats.set(src, m);
    return m;
}

// The far version of a ship (level of detail): the whole model at rest — mounts, radars, doors, elevators and their
// parked jets included — merged into a handful of meshes (one per material), without the flush cell doors. Shown
// instead of the full model once the ship is small on screen (Ship.updateLod): the same shapes, a tenth of the draws.
function buildFar(group) {
    const copy = group.clone(true);
    const drop = [];
    copy.traverse(o => { if (o.isInstancedMesh) drop.push(o); });
    for (const o of drop) o.removeFromParent();
    copy.updateMatrixWorld(true);
    const far = mergeStaticModel(copy);
    far.name = 'ship:far';
    return far;
}

// The very far version: the far model's triangles clustered on a grid a 1/140th of the ship's length (farmodel.js),
// colours from its materials and textures, one mesh and one draw call. Shown once the ship is under ~30 px long
// (Ship.updateLod), where the far model's dozen draws and ~100k triangles make a few dozen pixels. Built the first
// time it's needed; null for a submarine (its paint fades under water, a plain mesh wouldn't) or when it can't be.
const VFAR_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.1 });
function buildVeryFar(t, type) {
    if (t.vfar !== undefined) return t.vfar;
    t.vfar = null;
    const def = TYPES[type];
    if (!t.far || !def || def.cls === 'sub') return null;
    try {
        const { position, color, index } = clusterTriangles(t.far, def.L / 140);
        if (index.length >= 30) {
            const g0 = new THREE.BufferGeometry();
            g0.setAttribute('position', new THREE.BufferAttribute(position, 3));
            g0.setAttribute('color', new THREE.BufferAttribute(color, 3));
            g0.setIndex(index);
            // faceted, like the hull and superstructure it stands for (normals shared across a 90° edge shade it
            // lighter or darker than the real thing)
            const geo = g0.toNonIndexed();
            geo.computeVertexNormals();
            geo.computeBoundingSphere();
            const m = new THREE.Mesh(geo, VFAR_MAT);
            m.name = 'ship:vfar';
            m.castShadow = false; m.receiveShadow = true;
            t.vfar = m;
        }
    } catch (e) { console.warn('[naval] no very far model for', type, e); }
    return t.vfar;
}
let _vfarBuiltAt = -1;

// Ships are built once per type and cloned: clones share geometry and materials, so a sortie that
// rebuilds the home carrier (or sinks a group) allocates nothing on the GPU.
const templates = {};
function makeShip(type) {
    let t = templates[type];
    if (!t) {
        const pending = !shipGltf[type] && shipLoading.has(type);
        if (pending) console.warn('[naval] model for', type, 'not loaded yet (await shipsLoaded()): using the procedural destroyer');
        t = shipGltf[type] ? buildFromGltf(type, shipGltf[type]) : type === 'carrier' ? buildCarrier() : buildDestroyer();
        if (!pending) templates[type] = t;   // (a stand-in isn't kept: the next ship of the type gets the real model)
        t.mounts.forEach((m, i) => { m.turret.name = 'ship:mount' + i; });
        mergeStatic(t.group);
        if (TYPES[type] && TYPES[type].cls === 'sub') t.group.traverse(o => { if (o.isMesh) o.material = underwaterMaterial(o.material); });
        t.far = buildFar(t.group);
    }
    const group = t.group.clone(true);
    const parts = {};
    const radar = group.getObjectByName('ship:radar');
    if (radar) parts.radar = radar;
    const radar2 = group.getObjectByName('ship:radar2');
    if (radar2) parts.radar2 = radar2;
    const mounts = t.mounts.map((m, i) => ({ type: m.type, p: m.p.clone(), turret: group.getObjectByName('ship:mount' + i), fireT: rand(0, 2), lockT: 0 }));
    return { group, parts, mounts, layout: t.layout || null, rig: bindRig(group), far: t.far || null, template: t };
}

// A fresh model of a ship type with its rig, not in any scene and not simulated (previews, the hangar, tests):
// { group, parts, mounts, layout, rig } — the pose helpers above take it in place of a Ship.
export function shipModel(type) { return makeShip(type); }

export class Ship {
    constructor(naval, type, team, center, orbitR, angle, dir = 1, name = null) {
        this.naval = naval;
        this.game = naval.game;
        this.type = type;
        this.def = TYPES[type];
        this.team = team;
        this.isGround = true;
        this.isShip = true;
        this.name = name || this.def.name;
        this.callsign = this.name;
        this.hp = this.health = this.maxHp = this.maxHealth = this.def.hp;
        this.alive = true;
        this.center = new THREE.Vector3();
        this.pos = this.center;
        this.vel = new THREE.Vector3();
        this.radius = this.def.B * 0.6;
        this.hitRadius = 40;
        this.incoming = [];
        this.orbit = { cx: center.x, cz: center.z, R: orbitR, a: angle, w: dir * this.def.speed / orbitR };
        const built = makeShip(type);
        this.mesh = built.group;
        this.mesh.rotation.order = 'YXZ'; // heading first, then pitch/roll about the ship's own axes
        this.parts = built.parts;
        this.mounts = built.mounts;
        this.layout = built.layout;
        this.rig = built.rig;   // moving parts: see the pose helpers (openCell, raiseMast, setElevator…)
        this.cls = this.def.cls || (type === 'carrier' ? 'carrier' : 'ship');
        this.depth = 0;         // submarines: metres below the surfaced trim (layout.periscopeDepth = at periscope depth)
        this.motionT = Math.random() * 100;
        this.motionSeed = Math.random() * 10;
        this.motion = { heave: 0, pitch: 0, roll: 0 };
        // the hull moves as a whole: only the radars and turrets turn on it
        freezeLocal(this.mesh, [this.parts.radar, this.parts.radar2, ...this.mounts.map(m => m.turret)].filter(Boolean));
        this.game.scene.add(this.mesh);
        if (naval.fx) naval.fx.add(this, this.layout);
        this.heading = 0;
        this.deckY = this.def.deckY;
        this.sinkT = 0;
        this.wakeT = 0;
        this.ammo = { sam: type === 'carrier' ? 8 : 12 };
        this.nav = null;        // group steaming (steer()): a heading and speed instead of the circle
        // level of detail: the parts too small to see from afar (mounts, radars, cell doors, small rig parts), and the
        // whole model swapped for its merged far version (buildFar) once the ship is small on screen
        this.details = [...this.mounts.map(m => m.turret), this.parts.radar, this.parts.radar2].filter(Boolean);
        this.mesh.traverse(o => { if (o.isInstancedMesh && o.name.startsWith('ship:rigdoors')) this.details.push(o); });
        this.near = [...this.mesh.children];
        // (hidden, the full model and the whole ship leave their subtrees out of the per-frame world-matrix pass)
        for (const c of this.near) skipWorldWhileHidden(c);
        skipWorldWhileHidden(this.mesh);
        if (built.far) {
            this.far = built.far.clone();
            this.far.visible = false;
            this.far.traverse(o => { o.matrixAutoUpdate = false; o.updateMatrix(); });
            this.mesh.add(this.far);
        }
        this.template = built.template || null; // (its very far version is built on first need: updateLod)
        this.lodK = 1;
        this.place(0);
    }

    // Steer a heading (rad, 0 = −Z like `heading`) at a speed (m/s): the ship leaves its circle and answers the helm
    // at its own rate (HELM). navalops.js sets nav.wantHeading / nav.wantSpeed as the group manoeuvres.
    steer(heading, speed) {
        if (!this.nav) {
            const h = HELM[this.type] || HELM.destroyer, p = this.mesh.position;
            const v0 = Math.hypot(this.vel.x, this.vel.z);
            this.nav = { x: p.x, z: p.z, speed: v0, rate: 0, wantHeading: this.heading, wantSpeed: v0, ...h };
        }
        this.nav.wantHeading = heading;
        this.nav.wantSpeed = speed;
        return this.nav;
    }

    // one step of the helm: speed toward the order, the rudder builds a turn toward the ordered heading
    steam(dt, rate) {
        const n = this.nav;
        const want = clamp(n.wantSpeed, 0, n.maxSpeed * rate);
        n.speed += clamp(want - n.speed, -n.accel * 2 * dt, n.accel * dt);
        const err = wrapPi(n.wantHeading - this.heading);
        const rmax = n.turn * clamp(n.speed / 6, 0.12, 1) * (this.alive ? 1 : 0);
        const wantRate = clamp(err * 0.35, -rmax, rmax);
        n.rate += (wantRate - n.rate) * (1 - Math.exp(-dt / n.rudder));
        this.heading = wrapPi(this.heading + n.rate * dt);
        n.x -= Math.sin(this.heading) * n.speed * dt;
        n.z -= Math.cos(this.heading) * n.speed * dt;
        // (code that reads the circle — a fleet move, an escort joining — sees where the ship is)
        this.orbit.cx = n.x; this.orbit.cz = n.z;
    }

    place(dt) {
        const o = this.orbit;
        const rate = this.alive ? 1 - 0.6 * (1 - Math.max(this.hp, 0) / this.maxHp) : 0.15;
        if (this.nav) return this.placeAt(dt, rate);
        // recovering aircraft: steam straight into the wind (slide the circle along instead of turning),
        // as long as there's open water ahead
        if (this.straight > 0 && this.alive) {
            this.straight -= dt;
            const sg = Math.sign(o.w), v = Math.abs(o.w) * o.R * rate;
            const tx = -Math.sin(o.a) * sg, tz = Math.cos(o.a) * sg;
            const ax = o.cx + Math.cos(o.a) * o.R + tx * 2500, az = o.cz + Math.sin(o.a) * o.R + tz * 2500;
            if (terrainHeight(ax, az) < -8) { o.cx += tx * v * dt; o.cz += tz * v * dt; }
            else { this.straight = 0; o.a += o.w * dt * rate; }
        } else o.a += o.w * dt * rate;
        const x = o.cx + Math.cos(o.a) * o.R, z = o.cz + Math.sin(o.a) * o.R;
        // tangent direction of travel
        const tx = -Math.sin(o.a) * Math.sign(o.w), tz = Math.cos(o.a) * Math.sign(o.w);
        this.heading = Math.atan2(-tx, -tz);
        this.poseAt(x, z, dt);
    }

    // group steaming: the helm moves the ship, then the same sea motion as on the circle
    placeAt(dt, rate) {
        if (dt > 0) this.steam(dt, rate);
        this.poseAt(this.nav.x, this.nav.z, dt);
    }

    // the hull at (x, z) on the current heading: sinking, battle damage and the sea
    poseAt(x, z, dt) {
        const sink = this.alive ? 0 : Math.min(this.sinkT / 60, 1);
        const dmgFrac = 1 - Math.max(this.hp, 0) / this.maxHp;
        // heave / pitch / roll with the waves (deckAt follows the tilted deck, so landings stay consistent)
        this.motionT += dt;
        const mo = this.seaMotion(x, z, dt);
        const y = -sink * (this.def.deckY + 25) - dmgFrac * 1.5 + mo.heave - this.depth;
        if (dt > 0) this.vel.set((x - this.mesh.position.x) / dt, (y - this.mesh.position.y) / dt, (z - this.mesh.position.z) / dt);
        this.mesh.position.set(x, y, z);
        this.mesh.rotation.set(0, this.heading, 0);
        this.listAngle = damp01(this.listAngle || 0, (1 - Math.max(this.hp, 0) / this.maxHp) * 0.05, dt);
        this.mesh.rotation.z = this.listAngle + sink * 0.28 + mo.roll;
        this.mesh.rotation.x = mo.pitch - (this.alive ? 0 : sink * 0.08) + (this.trim || 0); // (trim: a diving submarine's down angle)
        this.deckY = this.def.deckY + y;
        this.center.set(x, y + this.def.deckY * 0.55, z);
    }

    // The sea under the hull (only waves long enough to move it) at bow, stern, beam and centre, followed by a damped
    // oscillator per axis. Pitch > 0 lifts the bow, roll > 0 the starboard side (the mesh turns YXZ).
    seaMotion(x, z, dt) {
        const R = SEA_RESPONSE[this.type] || SEA_RESPONSE.carrier, m = this.motion, L = this.def.L * 0.4, B = this.def.B * 0.42;
        const c = Math.cos(this.heading), s = Math.sin(this.heading);
        // ship-local (lx, lz) → world: x + lx c + lz s, z − lx s + lz c (the inverse of toLocal)
        const at = (lx, lz) => waterHeightLong(x + lx * c + lz * s, z - lx * s + lz * c, R.minLam);
        const hb = at(0, -L), hs = at(0, L), hp = at(-B, 0), hsb = at(B, 0), hc = at(0, 0);
        const f = this.depth > 0 ? Math.exp(-this.depth / 8) : 1; // a submerged hull feels the waves less with depth
        const target = {
            heave: f * (hb + hs + hp + hsb + 2 * hc) / 6,
            pitch: f * Math.atan2(hb - hs, 2 * L),
            roll: f * Math.atan2(hsb - hp, 2 * B),
        };
        if (!m.v) { m.v = { heave: 0, pitch: 0, roll: 0 }; m.x = { heave: target.heave, pitch: 0, roll: 0 }; }
        if (dt > 0) for (const k of ['heave', 'pitch', 'roll']) {
            const P = R[k], w = 2 * Math.PI / P.T;
            // semi-implicit Euler, in substeps (stable at any frame rate)
            const n = Math.max(1, Math.ceil(dt / 0.02)), h = dt / n;
            for (let i = 0; i < n; i++) {
                m.v[k] += (w * w * (target[k] * P.gain - m.x[k]) - 2 * P.z * w * m.v[k]) * h;
                m.x[k] += m.v[k] * h;
            }
            m[k] = Math.max(-P.cap, Math.min(P.cap, m.x[k]));
        }
        return m;
    }

    // local coordinates: lx across (starboard +), lz along (bow −)
    toLocal(x, z) {
        const dx = x - this.mesh.position.x, dz = z - this.mesh.position.z;
        const c = Math.cos(this.heading), s = Math.sin(this.heading);
        return { lx: dx * c - dz * s, lz: dx * s + dz * c };
    }
    toWorld(lx, ly, lz, out = new THREE.Vector3()) {
        return out.set(lx, ly, lz).applyEuler(this.mesh.rotation).add(this.mesh.position);
    }

    onDeck(x, z, margin = 0) {
        const { lx, lz } = this.toLocal(x, z);
        const B = this.type === 'carrier' ? this.def.B : this.def.B * 0.8;
        const off = this.type === 'carrier' ? -4 : 0;
        if (!(Math.abs(lx - off) < B / 2 - margin && Math.abs(lz) < this.def.L / 2 - margin)) return false;
        // the modelled flight deck (angled deck, elevators, island sponson), not just its bounding rectangle
        const lay = this.layout;
        if (lay && lay.deck && this.type === 'carrier') {
            const sp = lay.islandSponson;
            return inPoly(lx, lz, lay.deck) || (lay.elevators || []).some(p => inPoly(lx, lz, p)) ||
                (!!sp && lx >= sp[0] && lx <= sp[1] && lz >= sp[2] && lz <= sp[3]);
        }
        return true;
    }
    // deck surface height at a world point (follows heave, pitch and roll)
    deckHeight(x, z) {
        const { lx, lz } = this.toLocal(x, z);
        return deckHeightAt(this.mesh, this.def.deckY, lx, lz);
    }
    // Where a landing jet's hook finds a wire: its reference point touches down between just short of the
    // aft-most wire and a little past the forward-most (the hook trails ~6 m behind it). Further up the deck
    // there's no wire to catch: a bolter.
    inWireZone(x, z) {
        if (this.type !== 'carrier') return false;
        const { lz } = this.toLocal(x, z);
        const w = this.layout && this.layout.wires;
        if (!w || !w.length) return lz > -this.def.L * 0.02 && lz < this.def.L * 0.48;
        let z0 = Infinity, z1 = -Infinity;
        for (const [a, b] of w) { z0 = Math.min(z0, a[1], b[1]); z1 = Math.max(z1, a[1], b[1]); }
        return lz > z0 - 14 && lz < z1 + 10;
    }
    // Catapult i's spot (the model's layout.catSpots; cat 2, the port bow one, by default: the view from behind a
    // jet on it is clear of the island), in world space. Without a layout: the old spot on cat 1.
    catSpot(i = null, out = new THREE.Vector3()) {
        const s = this.layout && this.layout.catSpots;
        if (!s || !s.length) return this.toWorld(12, this.deckY, -this.def.L * 0.02, out);
        const c = s[Math.min(i ?? (s.length > 1 ? 1 : 0), s.length - 1)];
        return this.toWorld(c[0], this.deckY, c[1], out);
    }
    catapultSpot() { return this.catSpot(this.playerCat ?? null); }

    // is a world point inside (or within `margin` m of) the island? Returns how far inside, or 0
    inIsland(p, margin = 0) {
        const isl = this.layout && this.layout.island;
        if (!isl || this.type !== 'carrier') return 0;
        const { lx, lz } = this.toLocal(p.x, p.z);
        if (p.y > this.deckY + 42) return 0;
        const d = Math.min(lx - (isl[0] - margin), (isl[1] + margin) - lx, lz - (isl[2] - margin), (isl[3] + margin) - lz);
        return d > 0 ? d : 0;
    }

    hitTest(p) {
        const { lx, lz } = this.toLocal(p.x, p.z);
        const y = p.y - this.mesh.position.y;
        const isl = this.layout && this.layout.island;
        const onIsland = isl ? lx > isl[0] && lx < isl[1] && lz > isl[2] && lz < isl[3] : Math.abs(lx - (this.def.B * 0.5 - 12)) < 8 && Math.abs(lz - this.def.L * 0.08) < 20;
        const top = this.def.deckY + (onIsland ? 30 : 2);
        return Math.abs(lx) < this.def.B / 2 && Math.abs(lz) < this.def.L / 2 && y > -6 && y < top;
    }

    damage(amount, source, kind) {
        if (!this.alive) return;
        const mult = kind === 'missile' ? 2.5 : kind === 'rocket' ? 1.8 : 1;
        this.hp -= amount * mult;
        this.health = this.hp;
        this.lastHitBy = source;
        this.lastKind = kind;
        const dmgFrac = 1 - Math.max(this.hp, 0) / this.maxHp;
        // fires spread as damage accumulates: one small blaze at first, a burning wreck near the end
        this.fires = this.fires || [];
        const wantFires = Math.ceil(dmgFrac * 9);
        while (this.fires.length < wantFires) {
            this.fires.push({
                p: new THREE.Vector3(rand(-this.def.B * 0.35, this.def.B * 0.35), this.def.deckY + 1, rand(-this.def.L * 0.42, this.def.L * 0.42)),
                size: 0.5 + Math.random() * 0.5, grow: 0,
            });
        }
        // secondary explosions (ammo, fuel) at 75 / 50 / 25 %
        this.stage = this.stage || 0;
        const stageNow = dmgFrac >= 0.75 ? 3 : dmgFrac >= 0.5 ? 2 : dmgFrac >= 0.25 ? 1 : 0;
        while (this.stage < stageNow && this.hp > 0) {
            this.stage++;
            const at = this.toWorld(rand(-this.def.B * 0.3, this.def.B * 0.3), this.def.deckY + 2, rand(-this.def.L * 0.4, this.def.L * 0.4));
            this.game.effects.explosion(at, 1.6 + this.stage * 0.5);
            this.game.effects.debrisBurst(at, _v.set(0, 50, 0), 6, 1.2);
            this.game.audio.boom(this.game.camera.position.distanceTo(at), 1.3);
            this.game.events.emit('shipSecondary', this, { stage: this.stage });
        }
        if (this.hp <= 0) this.destroy(source);
    }

    destroy(source) {
        this.alive = false;
        this.hp = this.health = 0;
        this.fires = this.fires || [];
        while (this.fires.length < 12) this.fires.push({ p: new THREE.Vector3(rand(-this.def.B * 0.35, this.def.B * 0.35), this.def.deckY + 1, rand(-this.def.L * 0.45, this.def.L * 0.45)), size: 1, grow: 0.5 });
        const fx = this.game.effects;
        for (let i = 0; i < 6; i++) {
            this.naval.later(() => {
                const p = this.toWorld(rand(-15, 15), this.def.deckY, rand(-this.def.L * 0.4, this.def.L * 0.4));
                fx.explosion(p, 2.5 + Math.random() * 1.5);
                this.game.audio.boom(this.game.camera.position.distanceTo(p), 1.5);
            }, i * 350);
        }
        this.game.events.emit('groundKilled', this, { source });
    }

    // Level of detail: not drawn at all when it would be a speck (or a submarine well under), and no mounts, radars
    // or cell doors while it's small on screen (the ship's length in pixels on a 900 px screen at this field of view,
    // so the targeting pod's narrow views still see it all)
    updateLod() {
        const cam = this.game.camera;
        if (!cam) return;
        const d = Math.max(cam.position.distanceTo(this.mesh.position), 1);
        const px = this.def.L / d * 450 / Math.tan((cam.fov || 60) * Math.PI / 360);
        this.mesh.visible = px > 1.2 && this.depth < 22;
        const detail = this.mesh.visible && px > 70;
        if (detail !== this.lodDetail) { this.lodDetail = detail; for (const o of this.details) o.visible = detail; }
        const far = !!this.far && px < 120;
        // very far: one clustered mesh (buildVeryFar), a type's first one built at most once a frame
        let vfar = far && px < (this.lodVfar ? 33 : 30) && this.alive && !this.sinkT;
        if (vfar && !this.vfar && this.template) {
            const T = this.template;
            if (T.vfar === undefined) { const f = this.game.time || 0; if (_vfarBuiltAt !== f) { _vfarBuiltAt = f; buildVeryFar(T, this.type); } }
            if (T.vfar) { this.vfar = T.vfar.clone(); this.vfar.visible = false; this.vfar.matrixAutoUpdate = false; this.vfar.updateMatrix(); this.mesh.add(this.vfar); }
        }
        if (!this.vfar) vfar = false;
        if (far !== this.lodFar || vfar !== this.lodVfar) {
            this.lodFar = far; this.lodVfar = vfar;
            for (const c of this.near) c.visible = !far;
            this.far.visible = far && !vfar;
            if (this.vfar) this.vfar.visible = vfar;
        }
        this.lodPx = px;
    }

    update(dt) {
        const g = this.game, fx = g.effects;
        if (!this.alive) this.sinkT += dt;
        this.place(dt);
        this.updateLod();
        if (this.parts.radar) this.parts.radar.rotation.y += dt * 1.6;
        if (this.parts.radar2) this.parts.radar2.rotation.y -= dt * 2.6;
        if (!this.alive && this.sinkT > 70) { this.remove(); return 'gone'; }
        // wake, bow wave, foam line and spray: shipfx.js (Naval.fx)
        // fires from battle damage
        if (this.fires) {
            const dmgFrac = this.alive ? 1 - this.hp / this.maxHp : 1;
            for (const f of this.fires) {
                f.grow = Math.min(1, f.grow + dt * 0.15); // each blaze builds up over a few seconds
                const k = f.size * (0.35 + f.grow * 0.65) * (0.6 + dmgFrac * 0.8);
                if (Math.random() < 0.2 + dmgFrac * 0.5) {
                    const p = this.toWorld(f.p.x, f.p.y, f.p.z);
                    const dark = dmgFrac > 0.5 ? 0.05 : 0.18;
                    fx.smoke.emit(p, _v.set(rand(-2, 2), rand(8, 16), rand(-2, 2)), rand(5, 10) * (0.6 + k), 6 * k + 3, 40 * k + 12, [dark, dark, dark], [0.28, 0.27, 0.26], 0.75, 0, 0.1, 5);
                    fx.puffFire(p, _v.set(rand(-2, 2), 8 + k * 6, rand(-2, 2)), 4 + 6 * k, 0.4 + k * 0.3);
                }
            }
        }
        if (!this.alive || this.passive) return;
        this.updateDefenses(dt);
    }

    updateDefenses(dt) {
        const g = this.game;
        const diff = g.difficulty;
        for (const m of this.mounts) {
            const mp = this.toWorld(m.turret.position.x, m.turret.position.y + 2, m.turret.position.z, _mp); // (everything below copies it)
            m.fireT -= dt;
            if (m.type === 'ciws') {
                // priority: incoming missiles aimed at our group
                let tgt = null, best = 1600 * 1600;
                for (const ms of g.weapons.missiles) {
                    if (ms.team === this.team || ms.kind === 'rkt') continue;
                    const d = ms.pos.distanceToSquared(mp);
                    const aimedAtUs = ms.target && ms.target.isShip && ms.target.team === this.team;
                    if (d < best && aimedAtUs) { best = d; tgt = ms; }
                }
                // and the strategic ones (strikes.js: cruise and anti-ship missiles, a ballistic one coming down on
                // us) closing on this ship — the last layer of the group's air defence (navalops.js)
                const sm = g.strikes && g.strikes.missiles;
                if (sm) for (const ms of sm) {
                    if (!ms.alive || ms.team === this.team || ms.phase === 'launch') continue;
                    const d = ms.pos.distanceToSquared(mp);
                    if (d >= best) continue;
                    const closing = (ms.vel.x * (mp.x - ms.pos.x) + ms.vel.y * (mp.y - ms.pos.y) + ms.vel.z * (mp.z - ms.pos.z)) > 0;
                    if (closing) { best = d; tgt = ms; }
                }
                let isMissile = !!tgt;
                if (!tgt) tgt = this.nearestEnemyAircraft(mp, 2200);
                if (!tgt) continue;
                const dir = _v.subVectors(tgt.pos, mp);
                const dist = dir.length();
                dir.normalize();
                m.turret.rotation.y = Math.atan2(-dir.x, -dir.z) - this.heading;
                if (m.fireT <= 0) {
                    m.fireT = 0.05;
                    // lead the target
                    const tt = dist / 1100;
                    const aim = _v2.copy(tgt.pos).addScaledVector(tgt.vel, tt).sub(mp).normalize();
                    aim.x += rand(-0.012, 0.012); aim.y += rand(-0.012, 0.012); aim.z += rand(-0.012, 0.012);
                    g.weapons.fireFlak(mp, aim.normalize(), this, isMissile ? 0 : 3 + diff.skill * 3, 1100, Infinity);
                    m.engagedT = g.time; m.target = tgt; // (navalops.js: "CIWS ENGAGING")
                    if (isMissile && Math.random() < (this.team === 'red' ? 0.028 : 0.05)) {
                        // CIWS kill
                        g.events.emit('ciwsKill', this, { missile: tgt });
                        if (tgt.isStrategic) tgt.damage(1e3, this); // (strikes.js intercepted(): its own explosion)
                        else {
                            g.effects.explosion(tgt.pos, 0.6);
                            const idx = g.weapons.missiles.indexOf(tgt);
                            if (idx >= 0) g.weapons.removeMissile(idx);
                        }
                    }
                }
            } else if (m.type === 'gun') {
                const tgt = this.nearestEnemyAircraft(mp, 3500);
                if (!tgt) continue;
                const rel = _v.subVectors(tgt.pos, mp);
                const tt = interceptTime(rel.x, rel.y, rel.z, tgt.vel.x, tgt.vel.y, tgt.vel.z, 900);
                if (tt <= 0) continue;
                const aim = _v2.copy(tgt.pos).addScaledVector(tgt.vel, tt).sub(mp).normalize();
                m.turret.rotation.y = Math.atan2(-aim.x, -aim.z) - this.heading;
                if (m.fireT <= 0) {
                    m.fireT = lerp(1.6, 0.9, diff.skill);
                    aim.x += rand(-0.03, 0.03); aim.y += rand(-0.02, 0.03); aim.z += rand(-0.03, 0.03);
                    g.weapons.fireFlak(mp, aim.normalize(), this, 10, 900, tt * rand(0.85, 1.1));
                    g.effects.fire.emit(mp, _v.set(0, 0, 0), 0.12, 6, 3, [2.2, 1.6, 0.9], [1.2, 0.5, 0.15], 1, 0, 0, 0);
                    g.effects.puffSmoke(mp, _v.set(0, 2, 0), 2.5, 0.55, 2.5, 0.45);
                }
            } else if (m.type === 'sam' && this.ammo.sam > 0 && !this.adManaged) { // (navalops.js flies a group's SAMs)
                const tgt = this.nearestEnemyAircraft(mp, WEAPONS.sam.range);
                if (!tgt || tgt.pos.distanceTo(mp) < 700) { m.lockT = Math.max(0, m.lockT - dt); continue; }
                m.lockT += dt;
                tgt.lockedBy = tgt.lockedBy || new Set();
                tgt.lockedBy.add(this);
                if (m.lockT > 3 && m.fireT <= 0 && tgt.incoming.length < 2) {
                    this.launchDir = _v.set(0, 1, 0).clone();
                    const launcher = { pos: mp.clone(), vel: this.vel.clone(), team: this.team, isGround: true, alive: true, launchDir: this.launchDir, name: this.name };
                    g.weapons.fireMissile(launcher, tgt, 'sam');
                    this.ammo.sam--;
                    m.fireT = lerp(18, 10, diff.skill);
                    m.lockT = 1;
                }
            }
        }
    }

    nearestEnemyAircraft(p, range) {
        let best = null, bd = range * range;
        for (const a of this.game.aircraft) {
            if (!a.alive || a.team === this.team || a.onGround) continue;
            const d = a.pos.distanceToSquared(p);
            if (d < bd) { bd = d; best = a; }
        }
        return best;
    }

    remove() {
        this.game.scene.remove(this.mesh);
        if (this.naval.fx) this.naval.fx.remove(this);
        this.gone = true;
    }
}

export class Naval {
    constructor(game) {
        this.game = game;
        this.ships = [];
        this.homeCarrier = null;
        this._surf = { h: 0, ship: null, water: false, runway: null, hull: false };
        this.timers = new Set();
        this.fx = new ShipFX(game.scene);
    }

    // setTimeout that's cancelled when the sortie ends (no explosions in the menu scene)
    later(fn, ms) {
        const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
        this.timers.add(id);
    }

    spawnHomeCarrier() {
        const spot = findOcean(0, 0, 5000, 14000, 2600) || { x: -9000, z: 6000 };
        const s = new Ship(this, 'carrier', 'blue', spot, 2600, Math.random() * Math.PI * 2, 1, 'CVN-73');
        this.ships.push(s);
        this.game.ground.targets.push(s);
        this.homeCarrier = s;
        return s;
    }

    spawnEnemyGroup(passive = false) {
        const spot = (passive ? findOcean(0, 0, 7000, 16000, 2600) : null) || findOcean(0, 0, 20000, 32000, 3000) || findOcean(0, 0, 12000, 40000, 2200) || { x: 22000, z: 10000 };
        const a0 = Math.random() * Math.PI * 2;
        const carrier = new Ship(this, 'carrier', 'red', spot, 3000, a0, -1, 'ENEMY CARRIER');
        const d1 = new Ship(this, 'destroyer', 'red', spot, 3350, a0 + 0.09, -1, 'DESTROYER');
        const d2 = new Ship(this, 'destroyer', 'red', spot, 2650, a0 - 0.1, -1, 'DESTROYER');
        // keep escorts in formation: same angular speed as the carrier
        d1.orbit.w = d2.orbit.w = carrier.orbit.w;
        for (const s of [carrier, d1, d2]) { s.passive = passive; this.ships.push(s); this.game.ground.targets.push(s); }
        this.enemyCarrier = carrier;
        return carrier;
    }

    // Any ship type (cruiser, ssn, ssgn, supply, rhib, cb90, slava, …) steaming round a circle of radius orbitR about
    // `center` (open ocean: see findOcean). opts: orbitR, angle, dir (1 / −1), name, passive.
    spawn(type, team, center, opts = {}) {
        const s = new Ship(this, type, team, center, opts.orbitR ?? (TYPES[type].L < 40 ? 400 : 1800), opts.angle ?? Math.random() * Math.PI * 2, opts.dir ?? 1, opts.name || null);
        s.passive = !!opts.passive;
        this.ships.push(s);
        this.game.ground.targets.push(s);
        return s;
    }

    // Keep a chase camera out of a carrier's island (a view from inside its wall hides the jet): pull the camera in
    // along the line to what it looks at until it's clear. Moves `cam` (a Vector3) in place.
    clearOfIslands(cam, target) {
        for (const s of this.ships) {
            if (s.type !== 'carrier' || s.gone || !s.layout || Math.abs(s.mesh.position.x - cam.x) > 300 || Math.abs(s.mesh.position.z - cam.z) > 300) continue;
            if (!s.inIsland(cam, 2.5)) continue;
            for (let k = 0.95; k > 0; k -= 0.05) {
                _v.lerpVectors(target, cam, k);
                if (!s.inIsland(_v, 2.5)) { cam.copy(_v); break; }
            }
        }
        return cam;
    }

    // Deck / hull query used by aircraft ground contact
    deckAt(x, z, y) {
        for (const s of this.ships) {
            if (s.gone) continue;
            if (!s.onDeck(x, z)) continue;
            if (y < -10) continue;
            const r = this._surf;
            r.vessel = s; // (whatever the deck belongs to: a man walking on it rides along, pilot.js)
            r.h = s.deckHeight(x, z); r.ship = s.type === 'carrier' && s.alive ? s : null; r.water = false; r.runway = null;
            r.hull = y < s.deckY - 4 || s.type !== 'carrier' || !s.alive;
            if (r.hull) r.ship = null;
            return r;
        }
        return null;
    }

    update(dt) {
        for (let i = this.ships.length - 1; i >= 0; i--) {
            const s = this.ships[i];
            if (s.update(dt) === 'gone') {
                this.ships.splice(i, 1);
                const k = this.game.ground.targets.indexOf(s);
                if (k >= 0) this.game.ground.targets.splice(k, 1);
            }
        }
        this.fx.update(dt, this.game);
    }

    clear() {
        this.ships.forEach(s => s.remove());
        this.fx.clear();
        this.ships = [];
        this.timers.forEach(clearTimeout);
        this.timers.clear();
        this.homeCarrier = this.enemyCarrier = null;
    }
}

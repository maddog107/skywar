// Ship models and their rigs (models/ships/*.glb, tools/ships/RIG.md). Every model file loads headless through
// naval.js (images stripped: Node has no image decoder, and nothing is drawn), has the rig nodes its type promises,
// and the pose helpers move them: VLS cell doors and uptakes, masts, elevators, hatches, seats, the wheel. Each
// type also spawns and steams round its circle with a stub game (submarines dive to periscope depth).
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const N = await src('naval.js');
const repo = fileURLToPath(new URL('../', import.meta.url));

// A GLB without its images: drop images / textures / samplers and every texture reference, keep the BIN chunk.
function stripTextures(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
    delete json.images; delete json.textures; delete json.samplers;
    for (const m of json.materials || []) {
        const pbr = m.pbrMetallicRoughness || {};
        delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture;
        delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
        for (const e of Object.values(m.extensions || {})) for (const k of Object.keys(e)) if (/Texture$/.test(k)) delete e[k];
    }
    const js = new TextEncoder().encode(JSON.stringify(json));
    const pad = (4 - (js.length % 4)) % 4;
    const rest = buf.subarray(20 + jsonLen);
    const out = new Uint8Array(20 + js.length + pad + rest.length);
    const o = new DataView(out.buffer);
    o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.length, true);
    o.setUint32(12, js.length + pad, true); o.setUint32(16, 0x4e4f534a, true);
    out.set(js, 20); out.fill(0x20, 20 + js.length, 20 + js.length + pad);
    out.set(rest, 20 + js.length + pad);
    return out.buffer;
}
const parse = (ab) => new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));

// What each type's rig must have (counts are exact; names must exist)
const EXPECT = {
    carrier: { elevators: 4, doors: ['island_1', 'island_2', 'island_3', 'island_4', 'island_5', 'accom'], points: ['hatch_entry'] },
    destroyer: { cells: 96, uptakes: 12, vertical: true, doors: ['hangar_1', 'hangar_2'] },
    cruiser: { cells: 122, uptakes: 16, vertical: true, doors: ['hangar_1'] },
    ssn: { cellsMin: 12, masts: ['periscope_1', 'periscope_2'], hatches: ['escape'], points: ['hatch_entry'], sub: true },
    ssgn: { cells: 154, masts: ['periscope_1'], hatches: ['escape'], points: ['hatch_entry'], sub: true },
    rhib: { seats: ['driver', 'nav', '1', '8', 'gunner'], seatsMin: 10, wheel: true, points: ['jet_1', 'jet_2', 'hatch_entry'] },
    cb90: { seats: ['driver', 'commander'], seatsMin: 20, wheel: true, points: ['jet_1', 'jet_2', 'muzzle_1', 'muzzle_3'], doors: ['ramp'], hatches: ['bow', 'roof'] },
    supply: { points: ['ras_1', 'ras_12', 'hatch_entry'], doors: ['hangar_1', 'hangar_2', 'hangar_3', 'accom'] },
    slava: { cells: 80 },
};

const types = Object.entries(N.SHIP_MODEL_FILES).filter(([, f]) => existsSync(repo + f));

describe('ship models load headless with their rigs', () => {
    for (const [type, file] of types) {
        test(type, { todo: (EXPECT[type] || {}).todo }, async () => {
            const gltf = await parse(stripTextures(readFileSync(repo + file)));
            N.setShipModel(type, gltf);
            const m = N.shipModel(type);
            const r = m.rig, want = EXPECT[type] || {};
            assert.ok(r, 'no rig');
            if (want.cells != null) assert.equal(r.cells.length, want.cells, 'missile cells');
            if (want.cellsMin != null) assert.ok(r.cells.length >= want.cellsMin, `at least ${want.cellsMin} cells (${r.cells.length})`);
            if (want.uptakes != null) assert.equal(r.uptakes.length, want.uptakes, 'VLS uptakes');
            if (want.elevators != null) assert.equal(r.elevators.length, want.elevators, 'elevators');
            for (const d of want.doors || []) assert.ok(r.doors[d], 'door_' + d);
            for (const h of want.hatches || []) assert.ok(r.hatches[h], 'hatch_' + h);
            for (const p of want.points || []) assert.ok(r.points[p], p);
            for (const s of want.seats || []) assert.ok(r.seats[s], 'seat_' + s);
            if (want.seatsMin) assert.ok(Object.keys(r.seats).length >= want.seatsMin, 'seats');
            if (want.wheel) assert.ok(r.wheel, 'wheel');
            for (const k of want.masts || []) assert.ok(r.masts[k], 'mast_' + k);
            // numbered lists run 1..n without gaps
            r.cells.forEach((c, i) => assert.equal(c.name, 'cell_' + (i + 1)));
            r.vls.forEach((c, i) => assert.equal(c.name, 'vls_' + (i + 1)));
            m.group.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(m.group);

            // cells: a door over each, it turns when opened (instanced doors: their instance matrix follows) and closes again
            const pos = new THREE.Vector3(), dir = new THREE.Vector3(), mat = new THREE.Matrix4();
            for (let i = 0; i < r.cells.length; i++) {
                const c = r.cells[i];
                assert.ok(c.door, c.name + ' has no door');
                assert.ok(N.cellFrame(m, i, pos, dir));
                assert.ok(box.containsPoint(pos), c.name + ' outside the ship');
                if (want.vertical) assert.ok(dir.y > 0.99, c.name + ' launches vertically');
                else assert.ok(dir.y > 0.05, c.name + ' launches upwards');
            }
            for (const i of [0, r.cells.length >> 1, r.cells.length - 1].filter(i => i >= 0 && i < r.cells.length)) {
                const d = r.cells[i].door;
                const q0 = d.node.quaternion.clone(), p0 = d.node.position.clone();
                assert.ok(N.openCell(m, i, 1));
                assert.ok(d.node.quaternion.angleTo(q0) > 0.5 || d.node.position.distanceTo(p0) > 0.3, 'door moved');
                if (d.ims) for (const im of d.ims) {
                    im.getMatrixAt(d.index, mat);
                    const want = new THREE.Matrix4().fromArray(im.userData.local).premultiply(d.node.matrix);
                    assert.ok(mat.elements.every((v, j) => Math.abs(v - want.elements[j]) < 1e-4), 'instance follows'); // (instance matrices are float32)
                }
                assert.ok(N.openCell(m, i, 0));
                // (componentwise: angleTo is imprecise near zero for the float32 quaternions a glTF stores)
                const qd = d.node.quaternion.toArray().reduce((m, v, j) => Math.max(m, Math.abs(v - q0.toArray()[j])), 0);
                assert.ok(qd < 1e-6 && d.node.position.distanceTo(p0) < 1e-6, 'door closed again');
                if (r.cells[i].uptake) assert.ok(N.ventCell(m, i, 1) && r.cells[i].uptake.k === 1);
            }
            // masts rise, elevators go down, hatches and doors swing
            for (const [k, e] of Object.entries(r.masts)) {
                const y0 = e.node.position.y;
                assert.ok(N.raiseMast(m, k, 1));
                assert.ok(e.node.position.y > y0 + 0.5, 'mast_' + k + ' rises');
            }
            r.elevators.forEach((e, i) => {
                const y0 = e.node.position.y;
                assert.ok(N.setElevator(m, i, 1));
                assert.ok(e.node.position.y < y0 - 5, e.name + ' goes down to the hangar deck');
            });
            for (const e of [...Object.values(r.hatches), ...Object.values(r.doors)]) {
                const q0 = e.node.quaternion.clone(), p0 = e.node.position.clone();
                assert.ok(N.poseRig(m, e.name, 1));
                assert.ok(e.node.quaternion.angleTo(q0) > 0.3 || e.node.position.distanceTo(p0) > 0.3, e.name + ' moves');
            }
            if (r.wheel) {
                const q0 = r.wheel.node.quaternion.clone();
                assert.ok(N.steerWheel(m, -1));
                assert.ok(r.wheel.node.quaternion.angleTo(q0) > 0.5, 'wheel turns');
            }
            // seats and points sit on the boat
            for (const [k, o] of [...Object.entries(r.seats), ...Object.entries(r.points)]) {
                o.getWorldPosition(pos);
                assert.ok(box.clone().expandByScalar(1).containsPoint(pos), k + ' outside the model');
            }
        });
    }
});

describe('every ship type spawns and steams', () => {
    // a stub game: a scene and the target list, nothing to shoot at (passive ships skip their defences)
    const game = { scene: new THREE.Scene(), ground: { targets: [] }, aircraft: [], camera: new THREE.PerspectiveCamera() };
    for (const [type] of types) {
        test(type, () => {
            const naval = new N.Naval(game);
            const s = naval.spawn(type, 'blue', { x: 0, z: 0 }, { passive: true, angle: 0 });
            assert.equal(s.type, type);
            assert.ok(s.rig && s.cls);
            const p0 = s.mesh.position.clone();
            for (let i = 0; i < 120; i++) naval.update(1 / 30);
            const moved = s.mesh.position.distanceTo(p0);
            assert.ok(moved > s.def.speed * 4 * 0.8 && moved < s.def.speed * 4 * 1.3, `${type} steams ${moved.toFixed(1)} m in 4 s`);
            assert.ok(Math.abs(s.mesh.position.y) < 2, 'afloat');
            if (EXPECT[type] && EXPECT[type].sub) {
                const d = s.layout.periscopeDepth;
                assert.ok(d > 5, 'layout.periscopeDepth');
                N.setDepth(s, d);
                for (let i = 0; i < 30; i++) naval.update(1 / 30);
                assert.ok(Math.abs(s.mesh.position.y + d) < 1.5, 'dived to periscope depth');
            }
            // poses survive the ship's frozen matrices (the helpers update the node's matrix themselves)
            if (s.rig.cells.length) {
                N.openCell(s, 0, 1);
                naval.update(1 / 30);
                const d = s.rig.cells[0].door;
                const m = new THREE.Matrix4().compose(d.node.position, d.node.quaternion, d.node.scale);
                assert.ok(m.equals(d.node.matrix), 'door matrix up to date');
            }
            naval.clear();
            assert.equal(game.scene.children.filter(o => o === s.mesh).length, 0, 'removed');
        });
    }
});

describe('ship levels of detail by size on screen (Ship.updateLod)', () => {
    // near (the full rig) above ~120 px, the merged far model below it, one clustered mesh below ~30 px (not for a
    // submarine), nothing at all under a pixel or two
    const game = { scene: new THREE.Scene(), ground: { targets: [] }, aircraft: [], camera: new THREE.PerspectiveCamera(60, 1, 1, 90000), time: 0 };
    const draws = (s) => { let n = 0; s.mesh.traverseVisible(o => { if (o.isMesh) n++; }); return n; };
    const at = (s, px) => {
        const d = s.def.L / px * 450 / Math.tan(Math.PI / 6);
        game.camera.position.set(s.mesh.position.x + d, 30, s.mesh.position.z); game.camera.updateMatrixWorld();
        game.time += 1;
        s.updateLod();
        return { near: s.near.some(c => c.visible), far: !!(s.far && s.far.visible), vfar: !!(s.vfar && s.vfar.visible), shown: s.mesh.visible, draws: draws(s) };
    };
    for (const type of ['destroyer', 'carrier', 'ssn']) {
        test(type, { skip: !types.some(([t]) => t === type) }, () => {
            const naval = new N.Naval(game);
            const s = naval.spawn(type, 'blue', { x: 0, z: 0 }, { passive: true, angle: 0 });
            const near = at(s, 400), far = at(s, 80), vfar = at(s, 20), speck = at(s, 0.5);
            assert.deepEqual([near.near, near.far, near.vfar], [true, false, false], 'near');
            assert.deepEqual([far.near, far.far, far.vfar], [false, true, false], 'far');
            assert.ok(far.draws < near.draws, `far ${far.draws} draws < near ${near.draws}`);
            if (s.cls === 'sub') assert.equal(vfar.vfar, false, 'no very far version for a submarine');
            else {
                assert.deepEqual([vfar.near, vfar.far, vfar.vfar], [false, false, true], 'very far');
                assert.equal(vfar.draws, 1, 'one draw');
                const back = at(s, 32);
                assert.equal(back.vfar, true, 'hysteresis: stays very far just above the threshold');
                assert.equal(at(s, 60).far, true, 'far again');
            }
            assert.equal(speck.shown, false, 'a speck is not drawn');
            assert.deepEqual([at(s, 400).near, s.far.visible], [true, false], 'near again');
            naval.clear();
        });
    }
});

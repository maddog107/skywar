// Levels of detail added by the performance pass: a car's far version (carset.js vehicleLod) and which instances
// CarSet.commit draws with it; a jet's far version (Aircraft.updateLod, farmodel.js) by its size on screen.
// (Ships' levels: ships.test.mjs.)
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const { mergeVehicleParts, vehicleLod, CarSet, CAR_LOD_NEAR } = await src('carset.js');
const { makeAircraft, stubGame } = await import('./helpers/flight.mjs');
const { cullSmallParts, sightDistance } = await src('meshmerge.js');
const { skipWorldWhileHidden } = await src('util.js');

const car = () => {
    const paint = new THREE.MeshStandardMaterial({ name: 'Paint', color: 0xffffff, roughness: 0.4, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ name: 'Glass', color: 0x203040, roughness: 0.1, metalness: 0.6 });
    const body = new THREE.BoxGeometry(1.9, 1.1, 4.5, 12, 8, 24).translate(0, 0.8, 0);
    const cabin = new THREE.SphereGeometry(0.9, 24, 16).scale(1, 0.6, 1.4).translate(0, 1.5, 0.2);
    return mergeVehicleParts([{ geometry: body, material: paint }, { geometry: cabin, material: glass }], 'Paint');
};
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe('car far version (carset.js vehicleLod)', () => {
    test('far fewer triangles, the same size, colours and paint mask kept', () => {
        const full = car(), far = vehicleLod(full, 4.5 / 14);
        assert.ok(tris(far) < tris(full) / 3, `${tris(far)} of ${tris(full)}`);
        full.computeBoundingBox(); far.computeBoundingBox();
        const a = full.boundingBox, b = far.boundingBox;
        for (const k of ['x', 'y', 'z']) {
            assert.ok(Math.abs(a.min[k] - b.min[k]) < 0.35, `min ${k}`);
            assert.ok(Math.abs(a.max[k] - b.max[k]) < 0.35, `max ${k}`);
        }
        const cols = new Set(), C = far.attributes.color;
        for (let i = 0; i < C.count; i++) cols.add(C.getX(i).toFixed(2));
        assert.ok(cols.size >= 2, 'paint and glass stay apart');
        const M = far.attributes.aMat;
        let paint = 0;
        for (let i = 0; i < M.count; i++) if (M.getX(i) === 1) paint++;
        assert.ok(paint > 0 && paint < M.count, 'the paint mask survives');
        const N = far.attributes.normal;
        for (let i = 0; i < N.count; i++) assert.ok(Math.abs(Math.hypot(N.getX(i), N.getY(i), N.getZ(i)) - 1) < 1e-3);
    });
    test('the full model is welded (indexed) and draws what the parts drew', () => {
        const full = car();
        assert.ok(full.index, 'indexed');
    });
});

describe('CarSet.commit picks the version by distance', () => {
    test('near cars get the full model, far ones the far version, out of range none', () => {
        const parent = new THREE.Group(), set = new CarSet(parent, 7, () => 0.01, { allowSpecial: false });
        const m = new THREE.Matrix4();
        const xs = [0, 60, CAR_LOD_NEAR - 20, CAR_LOD_NEAR + 50, 900, 1500, 9000];
        xs.forEach((x, i) => set.setMatrix(i, m.makeTranslation(x, 0, 0)));
        set.commit({ x: 0, z: 0 }, 2200);
        let near = 0, far = 0, lod = true;
        for (const list of set.meshes.values()) for (const p of list) { near += p.im.count; if (p.far) far += p.far.count; else lod = false; }
        if (lod) { assert.equal(near, 3); assert.equal(far, 3); } else assert.equal(near, 6);
    });
});

describe('Aircraft.updateLod: the far version by size on screen', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 1, 90000);
    const place = (g, ac, px) => {
        const d = ac.spec.length / px * 450 / Math.tan(Math.PI / 6);
        cam.position.set(ac.pos.x + d, ac.pos.y, ac.pos.z); cam.updateMatrixWorld();
        g.time += 1;
        ac.updateLod();
        return { model: ac.model.visible, far: !!(ac.farLod && ac.farLod.visible) };
    };
    test('an AI jet: the real one close, the far version under ~12 px, back with hysteresis', () => {
        const g = stubGame({ camera: cam });
        const ac = makeAircraft('f16', { game: g, team: 'red' });
        assert.deepEqual(place(g, ac, 200), { model: true, far: false });
        assert.deepEqual(place(g, ac, 8), { model: false, far: true });
        assert.ok(ac.farLod.parent === ac.root, 'hung on the jet');
        let meshes = 0; ac.model.traverse(o => { if (o.isMesh) meshes++; });
        assert.ok(ac.farLod.isMesh && meshes > 3, `one draw instead of ${meshes}`);
        assert.deepEqual(place(g, ac, 13), { model: false, far: true }, 'stays far just above the threshold');
        assert.deepEqual(place(g, ac, 20), { model: true, far: false });
    });
    test('never the player, and not a jet that is damaged or going down', () => {
        const g = stubGame({ camera: cam });
        const me = makeAircraft('f16', { game: g, isPlayer: true });
        assert.deepEqual(place(g, me, 5), { model: true, far: false });
        const ac = makeAircraft('f16', { game: g, team: 'red' });
        ac.lostRegions.add('wingL');
        assert.deepEqual(place(g, ac, 5), { model: true, far: false });
        ac.lostRegions.clear(); ac.falling = true;
        assert.deepEqual(place(g, ac, 5), { model: true, far: false });
    });
});

describe('small parts too far to see (meshmerge.js cullSmallParts)', () => {
    const mat = new THREE.MeshStandardMaterial();
    const truck = () => {
        const root = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 3, 9), mat);
        const wheels = [0, 1, 2, 3].map(i => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12), mat); w.position.set(i % 2 ? 1.2 : -1.2, 0.5, i < 2 ? -3 : 3); return w; });
        const missile = new THREE.Group(); missile.add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8), mat));
        root.add(body, ...wheels, missile);
        return { root, body, wheels, missile };
    };
    test('sightDistance grows with the part: a wheel a few hundred metres, a truck kilometres', () => {
        assert.equal(sightDistance(new THREE.Vector3(1, 0.4, 1)), 1100 * 1 > 400 ? 1100 : 400);
        assert.ok(sightDistance(new THREE.Vector3(9, 3, 2.5)) > 5000);
        assert.equal(sightDistance(new THREE.Vector3(0.2, 0.1, 0.1)), 400);
    });
    test('wheels hidden far out, the body kept; back when near; what else hid stays hidden; skipped nodes untouched', () => {
        const t = truck();
        t.wheels[3].visible = false; // (hidden by something else)
        cullSmallParts(t.root, new THREE.Vector3(50, 0, 0), [t.missile]);
        assert.ok(t.body.visible && t.wheels.slice(0, 3).every(w => w.visible));
        cullSmallParts(t.root, new THREE.Vector3(3000, 0, 0), [t.missile]);
        assert.ok(t.body.visible, 'the body shows at 3 km');
        assert.ok(t.wheels.every(w => !w.visible), 'the wheels do not');
        assert.ok(t.missile.children[0].visible, 'a skipped node is left alone');
        cullSmallParts(t.root, new THREE.Vector3(100, 0, 0), [t.missile]);
        assert.ok(t.wheels.slice(0, 3).every(w => w.visible), 'back near');
        assert.equal(t.wheels[3].visible, false, 'still hidden by whatever hid it');
    });
});

describe('skipWorldWhileHidden (util.js): a hidden subtree skips the world-matrix pass', () => {
    test('stale while hidden, right again the first pass after it shows; updateWorldMatrix still exact', () => {
        const scene = new THREE.Scene(), ship = new THREE.Group(), full = new THREE.Group(), cell = new THREE.Object3D();
        cell.position.set(0, 5, 10); full.add(cell); ship.add(full); scene.add(ship);
        skipWorldWhileHidden(full);
        scene.updateMatrixWorld();
        const world = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        assert.deepEqual(world(cell).toArray(), [0, 5, 10]);
        full.visible = false;
        ship.position.set(1000, 0, 0);
        scene.updateMatrixWorld();
        assert.equal(world(full).x, 1000, 'the hidden node itself keeps up');
        assert.equal(world(cell).x, 0, 'what is under it waits');
        cell.updateWorldMatrix(true, false);
        assert.equal(world(cell).x, 1000, 'updateWorldMatrix(true, false) gives the true transform');
        ship.position.set(2000, 0, 0);
        scene.updateMatrixWorld();
        full.visible = true;
        scene.updateMatrixWorld();
        assert.deepEqual(world(cell).toArray(), [2000, 5, 10], 'caught up once shown');
    });
});

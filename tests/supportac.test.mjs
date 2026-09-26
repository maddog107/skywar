// Support aircraft, drones and heavy bombers (docs/WAR.md): every new type has a config entry, a model entry and a
// model file whose moving parts are named nodes (src/rigparts.js), and the rig helpers work: parts are taken out of
// the airframe before segmentation with the file's scale baked in, hung on the right damage section of every
// instance, and posed by setBoom / trailDrogue / spinRotodome. The GLBs are checked by reading their JSON chunk
// (node names and hierarchy), so no WebGL or image decoding is needed.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const THREE = await import('three');
const { AIRCRAFT, hasEjectionSeat } = await src('config.js');
const { MODEL_FILES } = await src('models.js');
const RP = await src('rigparts.js');
const { segmentModel, regionAt } = await src('damage.js');

// type → rig nodes its model must have (name → parent name, or null for a part of its own)
const RIGS = {
    e3: { rotodome: null },
    kc135: { boom: null, boom_ext: 'boom', boom_nozzle: 'boom_ext', drogue_l: null, drogue_r: null, hose_l: 'drogue_l', hose_r: 'drogue_r', basket_l: 'drogue_l', basket_r: 'drogue_r' },
};

// node name → parent node name, from a GLB's JSON chunk
function glbNodes(file) {
    const buf = readFileSync(file);
    assert.equal(buf.readUInt32LE(0), 0x46546c67, 'glTF magic');
    const len = buf.readUInt32LE(12);
    const doc = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
    const parent = {};
    (doc.nodes || []).forEach((n, i) => (n.children || []).forEach(c => { parent[c] = i; }));
    const out = {};
    (doc.nodes || []).forEach((n, i) => { if (n.name) out[n.name] = { parent: parent[i] != null ? doc.nodes[parent[i]].name : null, node: n }; });
    return out;
}

describe('support types: config and model entries', () => {
    for (const [id, rig] of Object.entries(RIGS)) {
        test(`${id}: AIRCRAFT entry, MODEL_FILES entry and a model with its rig nodes`, () => {
            const s = AIRCRAFT[id];
            assert.ok(s, 'AIRCRAFT entry');
            for (const k of ['name', 'role', 'country', 'length', 'span', 'category', 'desc', 'flight', 'health']) assert.ok(s[k] != null, `spec.${k}`);
            assert.ok(['support', 'drone', 'bomber', 'fighter'].includes(s.category), s.category);
            const m = MODEL_FILES[id];
            assert.ok(m && m.file, 'MODEL_FILES entry');
            const file = new URL(`../models/${m.file}`, import.meta.url);
            assert.ok(existsSync(file), `model file ${m.file}`);
            const nodes = glbNodes(file);
            for (const [name, parentName] of Object.entries(rig)) {
                assert.ok(nodes[name], `node ${name} in ${m.file}`);
                if (parentName) assert.equal(nodes[name].parent, parentName, `${name} rides on ${parentName}`);
                // a moving part carries no scale of its own (pivots and travel are in metres)
                const sc = nodes[name].node.scale;
                assert.ok(!sc || sc.every(v => Math.abs(v - 1) < 1e-4), `${name} unscaled`);
            }
        });
    }
    test('nobody ejects from an AWACS, a tanker or a drone; fighters and bombers keep their seats', () => {
        assert.equal(hasEjectionSeat(AIRCRAFT.e3), false);
        assert.equal(hasEjectionSeat(AIRCRAFT.kc135), false);
        assert.equal(hasEjectionSeat(AIRCRAFT.f16), true);
        assert.equal(hasEjectionSeat(AIRCRAFT.b2), true);
        assert.equal(hasEjectionSeat(AIRCRAFT.b737), false);
        assert.equal(hasEjectionSeat({ category: 'support', eject: true }), true);
        assert.equal(hasEjectionSeat({ category: 'drone' }), false);
    });
});

// A stand-in for a loaded tanker file: model space as normaliseGLTF leaves it (holder > inner, scaled 2x), an
// airframe mesh, and a boom + drogue rigged like the real ones
function fakeTanker() {
    const mat = new THREE.MeshBasicMaterial();
    const holder = new THREE.Group(), inner = new THREE.Group();
    inner.scale.setScalar(2);   // the file is in half-metres: the normaliser scales it x2
    holder.add(inner);
    const air = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 20), mat);          // fuselage, 40 m once scaled
    air.name = 'airframe';
    const wing = new THREE.Mesh(new THREE.BoxGeometry(20, 0.2, 3), mat);      // 40 m span
    const boom = new THREE.Group(); boom.name = 'boom';
    boom.position.set(0, -1, 7); boom.rotation.x = -0.15;                       // hinge under the tail, stowed tip-up
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3).rotateX(Math.PI / 2).translate(0, 0, 1.5), mat); // 3 units aft
    const ext = new THREE.Group(); ext.name = 'boom_ext'; ext.position.set(0, 0, 3);
    const noz = new THREE.Object3D(); noz.name = 'boom_nozzle'; noz.position.set(0, 0, 0.6);
    ext.add(noz); boom.add(tube, ext);
    const dr = new THREE.Object3D(); dr.name = 'drogue_l'; dr.position.set(-8, -0.5, 2); dr.userData.hose = 20;
    const hose = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5), mat); hose.name = 'hose_l';
    const basket = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4), mat); basket.name = 'basket_l';
    dr.add(hose, basket);
    inner.add(air, wing, boom, dr);
    holder.updateMatrixWorld(true);
    return holder;
}

describe('rig parts', () => {
    test('extractRigParts: parts leave the airframe, in model space with the scale baked in', () => {
        const holder = fakeTanker();
        const before = new THREE.Vector3();
        holder.getObjectByName('boom_nozzle').getWorldPosition(before);
        const parts = RP.extractRigParts(holder);
        assert.deepEqual(parts.map(p => p.name).sort(), ['boom', 'drogue_l']);
        assert.equal(holder.getObjectByName('boom'), undefined, 'the boom is out of the airframe (segmentation must not merge it)');
        const boom = parts.find(p => p.name === 'boom');
        assert.deepEqual(boom.scale.toArray(), [1, 1, 1]);
        assert.ok(boom.position.distanceTo(new THREE.Vector3(0, -2, 14)) < 1e-6, 'hinge in metres');
        // the telescope sits 6 m down the boom (3 file units x 2), the nozzle 1.2 m further
        assert.ok(Math.abs(boom.getObjectByName('boom_ext').position.z - 6) < 1e-6);
        boom.updateMatrixWorld(true);
        const after = boom.getObjectByName('boom_nozzle').getWorldPosition(new THREE.Vector3());
        assert.ok(after.distanceTo(before) < 1e-5, 'nozzle stays where it was');
        const tubeGeo = boom.children.find(c => c.isMesh).geometry;
        tubeGeo.computeBoundingBox();
        assert.ok(Math.abs(tubeGeo.boundingBox.max.z - 6) < 1e-5, 'mesh scaled into metres');
    });

    test('attachRigParts: each instance gets its own parts on the right damage section', () => {
        const holder = fakeTanker();
        const templates = RP.extractRigParts(holder);
        const L = 40, hs = 20;
        for (const t of templates) t.userData.region = regionAt(t.position.x, t.position.z, L, hs);
        const seg = segmentModel(holder, L);
        const a = RP.attachRigParts(seg.clone(true), templates);
        const b = RP.attachRigParts(seg.clone(true), templates);
        assert.notEqual(a.boom, b.boom);
        assert.equal(a.boom.parent.userData.region, 'tail');
        assert.equal(a.drogue_l.parent.userData.region, 'wingL');
        for (const n of ['boom', 'boom_ext', 'boom_nozzle', 'drogue_l', 'hose_l', 'basket_l']) assert.ok(a[n], n);
        assert.equal(a.hose_l.visible, false, 'stowed hose is reeled in (hidden)');
        assert.equal(a.basket_l.visible, false, 'stowed basket is in its pod');
    });

    test('setBoom / stowBoom / trailDrogue / spinRotodome pose the parts', () => {
        const holder = fakeTanker();
        const templates = RP.extractRigParts(holder);
        const obj = new THREE.Group();
        const rig = { parts: RP.attachRigParts(obj, templates) };
        const p = (n) => { obj.updateMatrixWorld(true); return rig.parts[n].getWorldPosition(new THREE.Vector3()); };
        const stowed = p('boom_nozzle');
        assert.equal(RP.setBoom(rig, 30 * Math.PI / 180, 0, 0), true);
        const down = p('boom_nozzle');
        assert.ok(down.y < stowed.y - 2, 'boom 30° down: the nozzle drops');
        RP.setBoom(rig, 30 * Math.PI / 180, 0, 5);
        const out = p('boom_nozzle');
        assert.ok(Math.abs(out.distanceTo(down) - 5) < 1e-4, 'telescope 5 m out');
        RP.setBoom(rig, 30 * Math.PI / 180, 10 * Math.PI / 180, 5);
        assert.ok(p('boom_nozzle').x > 1, 'yawed right');
        RP.setBoom(rig, 0, 0, 99);
        assert.ok(Math.abs(rig.parts.boom_ext.position.z - rig.parts.boom_ext.userData.rest.p.z - 5.6) < 1e-6, 'extension capped at the travel');
        RP.stowBoom(rig);
        assert.ok(p('boom_nozzle').distanceTo(stowed) < 1e-5, 'stowed again');
        const b0 = p('basket_l');
        assert.equal(RP.trailDrogue(rig, 'l', 1), true);
        const b1 = p('basket_l');
        assert.ok(Math.abs(b1.distanceTo(b0) - 20) < 1e-3, 'drogue trails the full 20 m hose');
        assert.ok(b1.y < b0.y, 'hose sags');
        assert.equal(rig.parts.hose_l.visible, true);
        assert.equal(rig.parts.basket_l.visible, true);
        assert.equal(RP.trailDrogue(rig, 'r', 1), false, 'no right drogue on this one');
        assert.equal(RP.setBoom({ parts: {} }, 0.3), false);
        // rotodome: 6 rpm is a turn every 10 s
        const dome = new THREE.Group(); dome.name = 'rotodome';
        const r2 = { parts: RP.attachRigParts(new THREE.Group(), [dome]) };
        RP.spinRotodome(r2, 2.5, 6);
        assert.ok(Math.abs(Math.abs(r2.parts.rotodome.rotation.y) - Math.PI / 2) < 1e-6, 'quarter turn in 2.5 s');
    });

    test('refuel points: every receiver entry is a boom receptacle or a probe inside the airframe', () => {
        for (const [id, d] of Object.entries(RP.REFUEL)) {
            assert.ok(AIRCRAFT[id], id);
            assert.ok(d.kind === 'boom' || d.kind === 'probe', `${id} kind`);
            assert.ok(d.at.length === 3 && d.at.every(v => Math.abs(v) <= 0.6), `${id} at`);
        }
        const t = RP.refuelTemplate({ at: [0, 0.05, -0.3], kind: 'boom' }, 20);
        assert.equal(t.name, 'refuel');
        assert.ok(t.position.distanceTo(new THREE.Vector3(0, 1, -6)) < 1e-9);
    });
});

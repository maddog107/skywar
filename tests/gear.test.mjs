import { src } from './helpers/setup.mjs';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A model's own retractable gear (models.js normaliseGear / addGear), on the CL-415's real gear file: the game turns
// only the three legs (each about its axis); the main legs' parallelogram (the oleo leg and the lower arm) and the nose
// gear's doors follow from the legs' own turn.
describe('models: a model\'s own retractable gear (the CL-415\'s)', () => {
    let THREE, M, gltf;
    const S = 19.82 / 19.7954; // the game's scale for the CL-415 (its file is 19.7954 long)
    before(async () => {
        THREE = await import('three');
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        M = await src('models.js');
        const buf = readFileSync(new URL('../models/aircraft/cl415_gear.glb', import.meta.url));
        const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        gltf = await new Promise((res, rej) => new GLTFLoader().parse(data, '', res, rej));
    });
    // the airframe it shares its material with, and the file → model transform (the game's: here a uniform scale)
    const setup = () => {
        const paint = new THREE.MeshStandardMaterial({ name: 'cl415_paint' });
        const airframe = new THREE.Group();
        airframe.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), paint));
        const { parts, contacts } = M.normaliseGear(gltf.scene.clone(true), new THREE.Matrix4().makeScale(S, S, S), airframe);
        const object = new THREE.Group(), rig = {};
        M.addGear(object, rig, parts);
        const leg = (name) => rig.gearParts.find(p => p.name === name);
        const sub = (p, re) => { let f = null; p.traverse(o => { if (!f && o !== p && re.test(o.name)) f = o; }); return f; };
        const pose = (k) => { M.poseGear(rig, k); object.updateMatrixWorld(true); };
        return { object, rig, contacts, paint, leg, sub, pose };
    };
    const wpos = (o) => o.getWorldPosition(new THREE.Vector3());
    const wquat = (o) => o.getWorldQuaternion(new THREE.Quaternion());
    const turn = (q) => 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI; // degrees from no turn

    test('three legs on their pivots, unit axes, their angles, and contact points under the wheels', () => {
        const { rig, contacts } = setup();
        assert.equal(rig.retractGear, true);
        assert.deepEqual(rig.gearParts.map(p => p.userData.gear.kind).sort(), ['main', 'main', 'nose']);
        assert.equal(rig.gearContacts, undefined, 'contacts come with the type (normaliseGear), not per instance');
        assert.equal(contacts.length, 3);
        rig.gearParts.forEach((p, i) => {
            const g = p.userData.gear;
            assert.ok(g.axis.isVector3 && Math.abs(g.axis.length() - 1) < 1e-9, 'unit axis');
            assert.ok(Math.abs(g.angle - (g.kind === 'nose' ? 90 : 115) * Math.PI / 180) < 1e-9, 'angle in radians');
            assert.ok(contacts[i].y < p.position.y - 1, 'contact below the pivot');
            assert.ok(Math.abs(contacts[i].y + 4.65) < 0.01, `wheel bottoms 4.65 m below the centre (${contacts[i].y})`);
        });
        const xs = rig.gearParts.map((p, i) => [p.userData.gear.kind, contacts[i].x]);
        for (const [kind, x] of xs) assert.ok(kind === 'nose' ? Math.abs(x) < 1e-6 : Math.abs(Math.abs(x) - 2.387) < 0.01, `${kind} contact x ${x}`);
    });

    test('materials: legs and wheels share the airframe\'s texture but liveries skip them; the doors are its paint', () => {
        const { leg, sub, paint } = setup();
        const mats = (o) => { const m = new Set(); o.traverse(c => { if (c.isMesh) m.add(c.material); }); return [...m]; };
        for (const m of mats(sub(leg('gear_main_l'), /_leg$/))) {
            assert.equal(m.name, 'cl415_gear');
            assert.equal(m.userData.noPaint, true);
        }
        assert.deepEqual(mats(sub(leg('gear_nose'), /door_l/)), [paint]);
    });

    test('main gear: a parallelogram — the oleo leg rises straight up, the lower arm stays on its hull hinge', () => {
        for (const side of ['l', 'r']) {
            const { leg, sub, pose } = setup();
            const top = leg('gear_main_' + side), oleo = sub(top, /_leg$/), link = sub(top, /_link$/);
            pose(1);
            const P1 = wpos(top), A0 = wpos(oleo), B0 = wpos(link);
            const P2 = B0.clone().sub(A0).add(P1);              // the lower arm's hull hinge
            const armEnd = link.worldToLocal(P2.clone());       // … in the lower arm's own frame
            const arm = A0.distanceTo(P1);
            for (const k of [0.5, 0]) {
                pose(k);
                assert.ok(turn(wquat(oleo)) < 1e-4, `${side} k ${k}: the leg keeps its attitude (turned ${turn(wquat(oleo))}°)`);
                assert.ok(link.localToWorld(armEnd.clone()).distanceTo(P2) < 1e-5, `${side} k ${k}: the lower arm stays on its hinge`);
                assert.ok(Math.abs(turn(wquat(link)) - turn(wquat(top))) < 1e-4, 'the arms stay parallel');
            }
            const up = wpos(oleo).sub(P1);
            assert.ok(Math.abs(up.x) < 0.002 && Math.abs(up.y - arm) < 0.002, `${side}: up, the leg stands right above the upper hinge (${up.toArray()})`);
            assert.ok(Math.abs(arm - 0.957 * S) < 0.002, 'the arms are 0.957 m long');
        }
    });

    test('nose gear: folds rearward, and its doors stay on the hull and close over it in the last 30%', () => {
        const { leg, sub, pose } = setup();
        const nose = leg('gear_nose'), doors = [sub(nose, /door_l/), sub(nose, /door_r/)];
        pose(1);
        const h0 = doors.map(wpos), wheel0 = nose.worldToLocal(new THREE.Vector3(0, -4.4, -8.26));
        pose(0.4); // 60% of the way up: the doors haven't started
        doors.forEach((d, i) => { assert.ok(turn(wquat(d)) < 1e-4, 'still open'); assert.ok(wpos(d).distanceTo(h0[i]) < 1e-5, 'on the hull'); });
        pose(0);
        doors.forEach((d, i) => {
            assert.ok(Math.abs(turn(wquat(d)) - 90) < 1e-3, `closed: turned 90° (${turn(wquat(d))})`);
            assert.ok(wpos(d).distanceTo(h0[i]) < 1e-5, 'still hinged on the hull');
        });
        const wheel = nose.localToWorld(wheel0.clone());
        assert.ok(wheel.z > -8.26 + 1 && wheel.y > -4.4 + 1, `the wheels went aft and up (${wheel.toArray()})`);
    });

    test('the linked parts follow a leg turned by Euler angles as well as by a quaternion', () => {
        const { leg, sub, object } = setup();
        const top = leg('gear_main_l'), oleo = sub(top, /_leg$/);
        const a = top.userData.gear.axis, ang = top.userData.gear.angle * 0.7;
        top.rotation.set(a.x * ang, a.y * ang, a.z * ang); // the axis is a unit axis vector
        object.updateMatrixWorld(true);
        assert.ok(Math.abs(turn(top.quaternion) - ang * 180 / Math.PI) < 1e-6);
        assert.ok(turn(wquat(oleo)) < 1e-4, 'the leg keeps its attitude');
    });
});

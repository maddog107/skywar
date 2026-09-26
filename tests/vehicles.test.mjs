// Rigged ground vehicles (src/vehicles.js, models/vehicles/*.glb): every vehicle in VEHICLES loads headless, has
// the rig nodes its entry lists, sits on y = 0 facing −Z at its real size, stays inside the triangle budget, and the
// pose helpers really move its parts: jacks reach the ground, erectors stand up, rams follow, turrets and launchers
// aim (muzzles turn with them), antennas spin, wheels roll and steer.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const THREE = await import('three');
const V = await src('vehicles.js');
const repo = new URL('../', import.meta.url);
const fetchBuffer = async (u) => { const b = readFileSync(new URL(u, repo)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
await V.preloadVehicles({ textures: false, fetchBuffer });

const box = (o) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const wpos = (o) => { o.updateMatrixWorld(true); return o.getWorldPosition(new THREE.Vector3()); };
const tris = (o) => { let n = 0; o.traverse(m => { if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return n; };
// world bounding box of the meshes directly under a node (not its jointed children)
const ownBox = (node) => {
    node.updateMatrixWorld(true);
    const b = new THREE.Box3();
    const walk = (o) => { for (const c of o.children) { if (c.userData.joint) continue; if (c.isMesh) b.expandByObject(c); walk(c); } };
    if (node.isMesh) b.expandByObject(node);
    walk(node);
    return b;
};

describe('vehicles', () => {
    for (const [id, spec] of Object.entries(V.VEHICLES)) {
        describe(id, () => {
            test('loads with its rig nodes', () => {
                assert.ok(V.hasVehicle(id), 'not loaded: models/vehicles/' + spec.file);
                const { object, rig } = V.createVehicle(id);
                for (const n of spec.parts || []) assert.ok(rig.nodes[n], `${id}: missing node ${n}`);
                assert.ok(['tel', 'sam', 'sam-radar', 'radar', 'command', 'artillery', 'vehicle', 'fuel', 'ammo', 'aaa', 'convoy', 'tank'].includes(spec.cls), 'cls ' + spec.cls);
                assert.ok(['red', 'blue', 'neutral'].includes(spec.team));
                if (spec.muzzles != null) assert.equal(rig.muzzles.length, spec.muzzles, 'muzzle count');
                assert.ok(object.children.length > 0);
            });

            test('real size, on the ground, facing -Z, within budget', () => {
                const { object, rig } = V.createVehicle(id);
                const b = box(object);
                assert.ok(Math.abs(b.min.y) < 0.03, `bottom at y=${b.min.y.toFixed(3)}`);
                const L = b.max.z - b.min.z, W = b.max.x - b.min.x;
                // spec.dims: the real vehicle (mirrors / antennas can stick out a little)
                assert.ok(Math.abs(L - spec.dims.length) / spec.dims.length < 0.08, `length ${L.toFixed(2)} vs ${spec.dims.length}`);
                assert.ok(W > spec.dims.width * 0.9 && W < spec.dims.width * 1.3, `width ${W.toFixed(2)} vs ${spec.dims.width}`);
                assert.ok(Math.abs(b.min.x + b.max.x) < 0.25, 'centred on x = 0');
                if (rig.seat) assert.ok(wpos(rig.seat).z < (b.min.z + b.max.z) / 2 + (spec.seatAft ? L : 0), 'driver sits towards -Z (the front)');
                const t = tris(object);
                assert.ok(t <= (spec.budget || 30000), `${t} triangles`);
                assert.ok(t >= 4000, `${t} triangles: too plain`);
            });

            test('pose helpers move the parts', () => {
                const { object, rig } = V.createVehicle(id);
                object.updateMatrixWorld(true);
                // every joint moves when set to its far end
                for (const e of rig.joints) {
                    const before = e.node.matrixWorld.clone();
                    const far = e.j.type === 'spin' ? 1.0 : (Math.abs(e.j.deploy - e.j.stow) > 1e-6 ? e.j.deploy : e.j.max);
                    V.setJoint(rig, e, far);
                    object.updateMatrixWorld(true);
                    assert.ok(!before.equals(e.node.matrixWorld), `${id}: joint ${e.node.name} did not move`);
                }
                V.stow(rig);
                // jacks: feet end on the ground (y ~ 0) when deployed, above it when stowed
                const jacks = Object.values(rig.jacks).filter(Boolean);
                if (jacks.length) {
                    V.deployJacks(rig, 0);
                    for (const j of jacks) assert.ok(ownBox(j).min.y > 0.08, `${j.name} stowed foot at ${ownBox(j).min.y.toFixed(3)}`);
                    V.deployJacks(rig, 1);
                    for (const j of jacks) assert.ok(Math.abs(ownBox(j).min.y) < 0.03, `${j.name} deployed foot at ${ownBox(j).min.y.toFixed(3)}`);
                }
                // erector / mast: stands up; rams stretch to their anchors
                if (rig.byGroup.raise) {
                    V.deployPad(rig, 1);
                    V.raise(rig, 0);
                    const h0 = box(object).max.y;
                    V.raise(rig, 1);
                    const h1 = box(object).max.y;
                    assert.ok(h1 > h0 + 1, `raise: top ${h0.toFixed(2)} → ${h1.toFixed(2)}`);
                    for (const r of rig.rams) {
                        const last = r.stages[r.stages.length - 1].node;
                        const anchor = wpos(r.end);
                        const b = ownBox(last);
                        assert.ok(b.distanceToPoint(anchor) < 0.08, `${r.node.name}: rod end ${b.distanceToPoint(anchor).toFixed(3)} m from its anchor`);
                    }
                }
                if (rig.missile && spec.cls === 'tel' && rig.nodes.nozzle) {
                    // erected: the missile stands (nose up) and its base rests on the launch pad
                    const n = rig.nodes.nozzle, d = new THREE.Vector3(0, 0, -1).applyQuaternion(n.getWorldQuaternion(new THREE.Quaternion()));
                    assert.ok(d.y < -0.99, 'exhaust points down when erected');
                    if (rig.pad) {
                        const base = wpos(n), pb = ownBox(rig.pad);
                        assert.ok(Math.abs(base.y - pb.max.y) < 0.12, `missile base ${base.y.toFixed(2)} vs pad top ${pb.max.y.toFixed(2)}`);
                        assert.ok(Math.abs(pb.min.y) < 0.03, 'pad feet on the ground');
                    }
                }
                // turret / launcher: muzzles swing with the aim
                if (rig.muzzles.length && (rig.byGroup.turret || rig.byGroup.launcher)) {
                    V.stow(rig);
                    V.raise(rig, 1);
                    const p0 = new THREE.Vector3(), d0 = new THREE.Vector3(), p1 = new THREE.Vector3(), d1 = new THREE.Vector3();
                    V.aim(rig, 0, 0);
                    V.muzzleWorld(rig, 0, p0, d0);
                    const ty = rig.byGroup.turret ? rig.byGroup.turret[0].j : null, lp = rig.byGroup.launcher ? rig.byGroup.launcher[0].j : null;
                    V.aim(rig, ty ? Math.min(ty.max, 0.6) : 0, lp ? Math.min(lp.max, 0.5) : 0);
                    V.muzzleWorld(rig, 0, p1, d1);
                    assert.ok(d0.angleTo(d1) > 0.2, 'muzzle direction follows aim');
                    if (lp) assert.ok(d1.y > d0.y, 'positive pitch raises the muzzles');
                    if (ty && ty.max > 0.3) {
                        // + yaw turns to the left (towards -x when the muzzles face -z)
                        const flat0 = Math.atan2(-d0.x, -d0.z), flat1 = Math.atan2(-d1.x, -d1.z);
                        assert.ok(flat1 > flat0 || Math.abs(d0.y) > 0.95, 'yaw + is to the left');
                    }
                }
                // antennas spin
                for (const e of rig.byGroup.spin || []) {
                    const q0 = e.node.quaternion.clone();
                    V.spin(rig, 1.5);
                    assert.ok(e.node.quaternion.angleTo(q0) > 0.05, `${e.node.name} spins`);
                }
                // wheels roll and steer
                if (rig.wheels.length) {
                    const w = rig.wheels[0], q0 = w.node.quaternion.clone();
                    V.roll(rig, 1.0);
                    assert.ok(w.node.quaternion.angleTo(q0) > 0.3, 'wheel rolls');
                    const steered = rig.wheels.filter(x => x.steer);
                    if (steered.length) {
                        const s = steered[0], y0 = s.node.rotation.y;
                        V.steer(rig, 0.3);
                        assert.ok(Math.abs(s.node.rotation.y - y0 - 0.3 * s.steer) < 1e-6, 'steers');
                    }
                }
            });
        });
    }
});

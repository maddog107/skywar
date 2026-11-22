// Visible stores (pylons.js, stores.js STATIONS / stationPlan, models.js stripBakedStores, the hooks in aircraft.js
// and weapons.js): what hangs under the wings is the loadout, it sits where the model's skin is, it leaves when it's
// fired and comes back with a rearm, and a wing that's shot off takes its stores (and their ammunition) with it.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arenaGame } from './helpers/arena.mjs';
import { loadAircraft, triangleCount } from './helpers/aircraftmodel.mjs';

const THREE = await import('three');
const { AIRCRAFT } = await src('config.js');
const S = await src('stores.js');
const { LOADOUTS, PRESETS, CLASSES, CLASS, STATIONS, loadoutOf, armAircraft, stationPlan, stationsOf, podOf } = S;
const P = await src('pylons.js');
const { stripBakedStores } = await src('models.js');
const { segmentModel } = await src('damage.js');
const { makeAircraft, stubGame } = await import('./helpers/flight.mjs');

const TYPES = Object.keys(LOADOUTS);
const BAY_ONLY = ['f22', 'f35', 'f35n', 'j20', 'su57', 'b2'];
const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 90000);
const near = (ac, d = 40) => { cam.position.set(ac.pos.x + d, ac.pos.y - 5, ac.pos.z); cam.updateMatrixWorld(); };
// a headless jet near the camera, armed with a preset, its stores built
function jet(type, preset, opts = {}) {
    const g = opts.game || stubGame({ camera: cam });
    const ac = makeAircraft(type, { game: g, isPlayer: !!opts.isPlayer });
    near(ac);
    if (preset) armAircraft(ac, preset);
    ac.updateStores();
    return ac;
}
const shownOf = (ac) => P.storesShown(ac);
const slotsOf = (ac, cls) => P.storeSlots(ac).filter(s => !cls || s.cls === cls);
const world = (ac, s) => s.pos.clone().applyQuaternion(ac.quat).add(ac.pos);

describe('station plans (stores.js stationPlan)', () => {
    test('every type × loadout: each store on a station of its type, none used twice, nothing more than it carries', () => {
        for (const type of TYPES) for (const pre of PRESETS) {
            const load = loadoutOf({ spec: AIRCRAFT[type], type }, pre);
            const plan = stationPlan(type, load);
            const T = stationsOf(type), used = new Set();
            for (const pl of plan.places) {
                assert.ok(T.st[pl.st], `${type} ${pre}: station ${pl.st}`);
                assert.ok(!used.has(pl.st), `${type} ${pre}: station ${pl.st} given out twice`);
                used.add(pl.st);
                assert.ok(pl.n >= 1 && pl.n <= (pl.pair ? 2 : 1) * pl.cap, `${type} ${pre}: ${pl.n} on ${pl.st}`);
            }
            for (const e of load) {
                const hung = plan.places.filter(p => p.cls === e.cls).reduce((a, p) => a + p.n, 0);
                const want = e.cls === 'rkt' ? Math.ceil(e.n / podOf(e.store).tubes) : e.n;
                assert.equal(hung + (plan.inside[e.cls] || 0), want, `${type} ${pre} ${e.cls}: hung + inside = carried`);
            }
        }
    });
    test('bay carriers hang nothing outside; a B-52 its cruise missiles and no bombs', () => {
        for (const type of BAY_ONLY) for (const pre of PRESETS) {
            const plan = stationPlan(type, loadoutOf({ spec: AIRCRAFT[type], type }, pre));
            assert.equal(plan.places.length, 0, `${type} ${pre}`);
            assert.ok(plan.bay && plan.bay.length, `${type} has bays`);
        }
        const b52 = stationPlan('b52', loadoutOf({ spec: AIRCRAFT.b52, type: 'b52' }, 'strike'));
        assert.deepEqual(b52.places.map(p => p.cls), ['alcm']);
        assert.equal(b52.places[0].n, 12, 'six JASSMs a pylon');
        assert.equal(b52.inside.bomb, 51);
        const x = stationPlan('x100', loadoutOf({ spec: AIRCRAFT.x100, type: 'x100' }, 'balanced'));
        assert.equal(x.inside.ashm, 50, 'fifty Harpoons stay inside');
        assert.ok(x.places.every(p => p.cls === 'srm' || p.cls === 'lrm'));
    });
    test('the classic loads come out as on the real jets', () => {
        const at = (type, pre) => Object.fromEntries(stationPlan(type, loadoutOf({ spec: AIRCRAFT[type], type }, pre)).places.map(p => [p.st, p.store.id + ' ' + p.n]));
        // F-16: AMRAAMs on the wingtips, Sidewinders on 2/8
        const f16 = at('f16', 'air');
        assert.equal(f16[1], 'aim120c 2'); assert.equal(f16[2], 'aim9x 2'); assert.equal(f16[3], 'aim120c 2');
        // Su-35: all twelve points with R-73s on the tips and R-77s between the engines
        const su = stationPlan('su35', loadoutOf({ spec: AIRCRAFT.su35, type: 'su35' }, 'air'));
        assert.equal(su.places.reduce((a, p) => a + p.n, 0), 12);
        assert.deepEqual(su.inside, {});
        // F-14: Phoenix in the tunnel, Sparrows on the glove pylons, Sidewinders on their shoulders
        const f14 = at('f14', 'air');
        assert.equal(f14.tr, 'aim54 2'); assert.equal(f14.tf, 'aim54 2'); assert.equal(f14.g, 'aim7m 2'); assert.equal(f14.gs, 'aim9m 2');
        // F-15: four AMRAAMs on the fuselage corners, Sidewinders on the pylon rails
        const f15 = at('f15', 'air');
        assert.equal(f15.ff, 'aim120c 2'); assert.equal(f15.fr, 'aim120c 2'); assert.equal(f15.ro, 'aim9x 2');
    });
});

describe('the stores on every type (procedural models, headless)', () => {
    test('every type × loadout builds; never more shown than carried; mirrored; inside the span; bay carriers bare', () => {
        let built = 0;
        for (const type of TYPES) for (const pre of PRESETS) {
            const ac = jet(type, pre);
            const v = ac.storesView;
            assert.ok(v && v.built, `${type} ${pre} built`);
            const shown = shownOf(ac);
            for (const c of CLASSES) {
                const n = shown[c.key] || 0;
                if (c.key === 'rkt') assert.ok(n <= Math.ceil((ac.rockets | 0) / podOf(S.storeFor(ac, 'rkt')).tubes), `${type} ${pre}: ${n} pods`);
                else assert.ok(n <= (ac[c.ammo] | 0), `${type} ${pre}: ${n} ${c.key} shown of ${ac[c.ammo]}`);
                assert.equal(n + (c.key === 'rkt' ? 0 : (v.inside[c.key] || 0)), c.key === 'rkt' ? n : (ac[c.ammo] | 0), `${type} ${pre} ${c.key}: shown + inside = carried`);
            }
            const fit = P.fitOf(ac);
            for (const s of slotsOf(ac)) {
                assert.ok(Math.abs(s.pos.x) <= fit.hs + 0.6, `${type} ${pre}: ${s.cls} at x ${s.pos.x.toFixed(2)} of half span ${fit.hs.toFixed(2)}`);
                assert.ok([s.pos.x, s.pos.y, s.pos.z].every(Number.isFinite));
            }
            // a pair's left store is its right one mirrored
            for (const s of slotsOf(ac).filter(q => q.side > 0)) {
                const twins = slotsOf(ac, s.cls).filter(q => q.side < 0 && q.st === s.st && q.k === s.k);
                if (!twins.length) continue; // (the odd one of an odd count hangs on the right)
                const t = twins[0];
                assert.ok(Math.abs(t.pos.x + s.pos.x) < 1e-9 && Math.abs(t.pos.y - s.pos.y) < 1e-9 && Math.abs(t.pos.z - s.pos.z) < 1e-9, `${type} ${pre} ${s.cls}@${s.st}: mirrored`);
            }
            if (BAY_ONLY.includes(type)) { assert.equal(slotsOf(ac).length, 0, `${type} shows nothing`); assert.equal(v.mesh, null, 'no mesh at all'); }
            else built += slotsOf(ac).length;
            // one mesh for the whole jet (one draw), on its model, with every jet's the same material; a block of it
            // for each damage section something hangs on
            let stores = 0;
            ac.model.traverse(o => { if (o.userData.stores) stores++; });
            assert.equal(stores, slotsOf(ac).length ? 1 : 0, `${type} ${pre}: ${stores} meshes`);
            if (v.mesh) {
                assert.equal(v.mesh.parent, ac.model);
                assert.equal(v.mesh.material.name, 'stores');
                assert.ok(v.mesh.castShadow && v.mesh.receiveShadow);
                const blocks = Object.values(v.blocks);
                assert.equal(blocks.reduce((n, b) => n + b.n, 0), v.mesh.geometry.index.count, 'the blocks are the whole mesh');
                for (const sl of slotsOf(ac)) { const b = v.blocks[sl.region]; assert.ok(sl.i0 >= b.i0 && sl.i0 + sl.n <= b.i0 + b.n, 'a store lies in its section\'s block'); }
            }
            ac.remove();
            assert.equal(ac.storesView, null, 'freed with the jet');
        }
        assert.ok(built > 400, `${built} stores hung over all types and loadouts`);
    });
    test('types with nothing to carry show nothing', () => {
        for (const type of ['b747', 'kc135', 'e3', 'cessna', 'rq4']) {
            if (!AIRCRAFT[type]) continue;
            const ac = jet(type, null);
            assert.equal(slotsOf(ac).length, 0, type);
            ac.remove();
        }
    });
    test('the AI\'s jets show the air-to-air load they are given; bombs handed to one later hang too', () => {
        const ac = jet('f16', null); // (as the AI flies it: armAircraft(ac, 'air', { ai: true }) in the constructor)
        assert.deepEqual(shownOf(ac), { lrm: 4, srm: 2 });
        ac.bombs = 4; // (director.js gives a strike flight its bombs like this)
        ac.updateStores();
        assert.equal(shownOf(ac).bomb, 4);
        ac.bombs--; ac.updateStores();
        assert.equal(shownOf(ac).bomb, 3);
        ac.remove();
    });
});

describe('fitted to the real models (the GLB files, headless)', () => {
    // the type's file as the game loads it (stores stripped, cut into damage sections), swapped onto a headless jet
    async function real(type, preset) {
        const { holder, spec } = await loadAircraft(type);
        const before = triangleCount(holder);
        const stripped = stripBakedStores(holder, type);
        const seg = segmentModel(holder, spec.length);
        const ac = makeAircraft(type, { game: stubGame({ camera: cam }) });
        ac.model = seg; ac.regions = {};
        for (const c of seg.children) if (c.userData.region) ac.regions[c.userData.region] = c;
        ac.surfaces = [];
        const box = new THREE.Box3().setFromObject(seg);
        ac.rig = { ...ac.rig, halfSpan: (box.max.x - box.min.x) / 2, minY: box.min.y, gearContacts: null };
        ac.gearOffset = -box.min.y + 1.2;
        const fit = P.fitModel(type, seg, spec.length);
        near(ac);
        armAircraft(ac, preset);
        ac.updateStores();
        return { ac, fit, before, stripped };
    }
    const REAL = ['f16', 'fa18', 'f15', 'f14', 'a10', 'su35', 'mig29', 'typhoon', 'f4', 'f5', 'mig21', 'mig25', 'mig31', 'j10', 'j8', 'rafale', 'gripen', 'jaguar', 'mirage', 'ea18g', 'mq9', 'b52', 'tu95', 'x100', 'su47', 'f2'];
    test('stores hang from the skin (or the model\'s own pylon), mirrored, clear of the ground and of each other', async () => {
        const rows = [], bad = [];
        for (const type of REAL) {
            for (const pre of PRESETS) {
                const { ac, fit } = await real(type, pre);
                const T = stationsOf(type), slots = slotsOf(ac), tag = `${type} ${pre}: `;
                if (!slots.length) bad.push(tag + 'nothing hangs');
                let worst = 0;
                for (const s of slots) {
                    const def = T.st[s.st], R = s.pod ? s.pod.dia / 2 : (s.store.dia || 0.15) / 2, at = `${s.store.short}@${s.st}`;
                    if (!(Math.abs(s.pos.x) <= fit.hs + 0.5)) bad.push(tag + at + ' outside the span');
                    if (!(s.pos.y - R > -ac.gearOffset + 0.05)) bad.push(tag + at + ' not clear of the ground');
                    if (def.kind === 'tip' || def.kind === 'over' || def.dx) continue; // (beside a rail, not under the skin)
                    // the skin over it: the store's top is under it, and no further than a pylon and a rack below
                    const u = fit.extreme(Math.abs(s.pos.x) - 0.05, Math.abs(s.pos.x) + 0.05, s.pos.z - 0.3, s.pos.z + 0.3);
                    if (!(u === u)) continue; // (a side rail's missile out past the pylon's wing station)
                    const gap = u - (s.pos.y + R);
                    worst = Math.max(worst, gap);
                    if (!(gap > -0.02 - (def.sink || 0) - Math.max(def.dy || 0, 0) && gap < 1.25)) bad.push(tag + at + ` hangs ${gap.toFixed(2)} m under the skin`);
                }
                for (const s of slots.filter(q => q.side > 0)) {
                    const t = slots.find(q => q.side < 0 && q.cls === s.cls && q.st === s.st && q.k === s.k);
                    if (t && !(Math.abs(t.pos.x + s.pos.x) < 1e-9 && Math.abs(t.pos.y - s.pos.y) < 1e-9 && Math.abs(t.pos.z - s.pos.z) < 1e-9)) bad.push(tag + `${s.store.short}@${s.st} not mirrored`);
                }
                // no two stores in each other
                for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
                    const a = slots[i], b = slots[j];
                    if (Math.abs(a.pos.z - b.pos.z) > (a.len + b.len) / 2) continue;
                    const ra = a.pod ? a.pod.dia / 2 : a.store.dia / 2, rb = b.pod ? b.pod.dia / 2 : b.store.dia / 2;
                    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
                    if (!(d > (ra + rb) * 0.95)) bad.push(tag + `${a.store.short}@${a.st} and ${b.store.short}@${b.st} overlap (${d.toFixed(2)} m apart)`);
                }
                // the pylons stood under it are pylons, not walls: none deeper than a real one (a bomber's is the biggest)
                const deep = Math.max(0, ...(ac.storesView.stood || []));
                if (deep > (ac.spec.length > 30 ? 0.9 : 0.7)) bad.push(tag + `a pylon ${deep.toFixed(2)} m deep`);
                rows.push(`${type.padEnd(8)} ${pre.padEnd(9)} ${String(slots.length).padStart(2)} stores, deepest ${worst.toFixed(2)} m under the skin, pylons to ${deep.toFixed(2)} m, ${ac.storesView.mesh.geometry.index.count / 3} triangles`);
                ac.remove();
            }
        }
        P.resetFits();
        console.log(rows.join('\n'));
        assert.deepEqual(bad, []);
    });
    test('the stores modelled into the files are taken out at load (models.js stripBakedStores)', async () => {
        for (const [type, min] of [['fa18', 2500], ['f14', 3000], ['f15', 800], ['f4', 3500], ['a10', 800], ['mq9', 5000], ['gripen', 900], ['mig25', 1000], ['j10', 700]]) {
            const { ac, before, stripped } = await real(type, 'air');
            assert.ok(stripped >= min && stripped < before * 0.5, `${type}: ${stripped} of ${before} triangles were stores`);
            ac.remove();
        }
        // a clean file is left alone
        const { holder } = await loadAircraft('su35');
        assert.equal(stripBakedStores(holder, 'su35'), 0);
        P.resetFits();
    });
    test('a stealth jet is clean and its weapons drop from under the belly', async () => {
        for (const type of ['f22', 'b2']) {
            const { ac, fit } = await real(type, 'balanced');
            assert.equal(slotsOf(ac).length, 0);
            assert.equal(ac.storesView.mesh, null, 'no mesh at all');
            const out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), rail: false };
            const cls = type === 'b2' ? 'gbu' : 'lrm';
            assert.ok(ac.releaseStore(cls, out), `${type}: a bay`);
            const local = out.pos.clone().sub(ac.pos).applyQuaternion(ac.quat.clone().invert());
            const belly = fit.extreme(Math.abs(local.x) - 0.2, Math.abs(local.x) + 0.2, local.z - 0.5, local.z + 0.5);
            assert.ok(local.y < belly && local.y > belly - 0.6, `${type}: from just under the belly`);
            assert.ok(Math.abs(local.x) < 2.5);
            ac.remove();
        }
        P.resetFits();
    });
});

describe('firing, dropping, rearming (weapons.js through Aircraft.releaseStore)', () => {
    function armed(type, preset) {
        const g = arenaGame();
        g.camera = cam;
        const ac = g.spawn(type, { team: 'blue', pos: { x: 0, y: 3000, z: 0 }, isPlayer: true });
        near(ac);
        armAircraft(ac, preset);
        ac.updateStores();
        return { g, ac };
    }
    test('a missile leaves its own station: exactly one store goes, the weapon starts where it hung, pointing as the jet does', () => {
        const { g, ac } = armed('f16', 'balanced');
        const before = shownOf(ac), next = ac.storesView.seq.lrm[before.lrm - 1];
        const at = world(ac, next);
        const m = g.weapons.fireMissile(ac, null, 'lrm');
        assert.ok(m.pos.distanceTo(at) < 0.01, `started ${m.pos.distanceTo(at).toFixed(3)} m from its station`);
        assert.ok(m.mesh.quaternion.angleTo(ac.quat) < 1e-6);
        assert.equal(m.W.id, 'aim120c');
        assert.deepEqual(shownOf(ac), { ...before, lrm: before.lrm - 1 });
        assert.equal(next.shown, false);
        ac.lrm--; ac.updateStores(); // (game.js counts it down after firing)
        assert.deepEqual(shownOf(ac), { ...before, lrm: before.lrm - 1 }, 'the count agrees: nothing more goes');
        // its triangles are out of the index buffer
        const idx = ac.storesView.mesh.geometry.index.array;
        for (let i = next.i0; i < next.i0 + next.n; i++) assert.equal(idx[i], 0);
    });
    test('it leaves as it hung: a banked jet\'s missile and bomb keep their roll on the way out', () => {
        const { g, ac } = armed('f16', 'balanced');
        ac.qv.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.1); ac.syncBody(); // 63° of bank
        ac.vel.copy(ac.getForward(new THREE.Vector3())).multiplyScalar(240);
        const m = g.weapons.fireMissile(ac, null, 'lrm'), b = g.weapons.dropBomb(ac, 'bomb');
        g.weapons.update(1 / 60);
        // (pointing along its flight path now: a degree or two off the jet's nose, but not rolled level)
        assert.ok(m.mesh.quaternion.angleTo(ac.quat) < 0.08, `missile turned ${m.mesh.quaternion.angleTo(ac.quat).toFixed(3)} rad leaving`);
        assert.ok(b.mesh.quaternion.angleTo(ac.quat) < 0.08, `bomb turned ${b.mesh.quaternion.angleTo(ac.quat).toFixed(3)} rad leaving`);
    });
    test('right and left by turns; a bomb off its rack; rockets out of pods that stay', () => {
        const { g, ac } = armed('f16', 'balanced');
        const a = g.weapons.fireMissile(ac, null, 'lrm'), xa = a.pos.clone().sub(ac.pos).dot(ac.getRight(new THREE.Vector3()));
        const b = g.weapons.fireMissile(ac, null, 'lrm'), xb = b.pos.clone().sub(ac.pos).dot(ac.getRight(new THREE.Vector3()));
        assert.ok(xa * xb < 0 && Math.abs(xa + xb) < 0.01, `one from each side (${xa.toFixed(2)}, ${xb.toFixed(2)})`);
        ac.lrm -= 2;
        const bombs = shownOf(ac).bomb, slot = ac.storesView.seq.bomb[bombs - 1], at = world(ac, slot);
        const bomb = g.weapons.dropBomb(ac, 'bomb');
        assert.ok(bomb.pos.distanceTo(at) < 0.01, 'the bomb starts on its rack');
        assert.equal(shownOf(ac).bomb, bombs - 1);
        ac.bombs--;
        const pods = slotsOf(ac, 'rkt');
        assert.equal(pods.length, 2, 'two LAU-61s');
        const r = g.weapons.fireMissile(ac, null, 'rkt');
        const d = Math.min(...pods.map(p => r.pos.distanceTo(world(ac, p).add(new THREE.Vector3(0, 0, -p.len / 2).applyQuaternion(ac.quat)))));
        assert.ok(d < 0.25, `the rocket leaves a pod's face (${d.toFixed(2)} m)`);
        ac.rockets -= 4; ac.updateStores();
        assert.equal(slotsOf(ac, 'rkt').filter(p => p.shown).length, 2, 'the pods stay');
    });
    test('what hangs outside goes first, the rest comes from where one hung; a rearm puts everything back', () => {
        const { g, ac } = armed('f16', 'air'); // six AMRAAMs: four hang, two are "inside"
        assert.equal(shownOf(ac).lrm, 4);
        assert.equal(ac.storesView.inside.lrm, 2);
        for (let k = 0; k < 4; k++) { g.weapons.fireMissile(ac, null, 'lrm'); ac.lrm--; ac.updateStores(); assert.equal(shownOf(ac).lrm, 3 - k); }
        const m = g.weapons.fireMissile(ac, null, 'lrm'); ac.lrm--; ac.updateStores();
        assert.equal(shownOf(ac).lrm, 0);
        const d = Math.min(...slotsOf(ac, 'lrm').map(s => m.pos.distanceTo(world(ac, s))));
        assert.ok(d < 0.01, 'the fifth starts from an (empty) AMRAAM station');
        armAircraft(ac, 'air'); ac.updateStores();
        assert.deepEqual(shownOf(ac), { lrm: 4, srm: 2 });
        assert.ok(slotsOf(ac).every(s => s.shown));
    });
    test('a count that comes back (a resupply, the sandbox\'s top-up) hangs the store again; another loadout rehangs the jet', () => {
        const { g, ac } = armed('fa18', 'balanced');
        const full = shownOf(ac);
        g.weapons.fireMissile(ac, null, 'aam'); ac.missiles--; ac.updateStores();
        assert.equal(shownOf(ac).srm, full.srm - 1);
        ac.missiles++; ac.updateStores();
        assert.deepEqual(shownOf(ac), full);
        // fired but never counted down (the sandbox): it is back on the next frame
        g.weapons.fireMissile(ac, null, 'aam'); ac.updateStores();
        assert.deepEqual(shownOf(ac), full);
        armAircraft(ac, 'strike'); ac.updateStores();
        assert.ok(shownOf(ac).arm === 2 && shownOf(ac).ashm === 2 && !shownOf(ac).agm, JSON.stringify(shownOf(ac)));
    });
    test('a jet too far to show its stores launches from under the wing as before', () => {
        const g = arenaGame();
        g.camera = cam;
        const ac = g.spawn('f16', { team: 'red', pos: { x: 0, y: 3000, z: 0 } });
        cam.position.set(9000, 3000, 0); cam.updateMatrixWorld();
        ac.updateStores();
        assert.ok(!ac.storesView || !ac.storesView.built);
        const m = g.weapons.fireMissile(ac, null, 'aam');
        const local = m.pos.clone().sub(ac.pos).applyQuaternion(ac.quat.clone().invert());
        assert.ok(Math.abs(Math.abs(local.x) - ac.rig.halfSpan * 0.35) < 1e-6 && Math.abs(local.y + 1.5) < 1e-6);
    });
});

describe('level of detail and damage', () => {
    test('built when the jet is big on screen, freed when it is small; the player\'s always', () => {
        const g = stubGame({ camera: cam });
        const ac = makeAircraft('su35', { game: g, team: 'red' });
        const px = (p) => { const d = ac.spec.length / p * 450 / Math.tan(Math.PI / 6); cam.position.set(ac.pos.x + d, ac.pos.y, ac.pos.z); cam.updateMatrixWorld(); ac.updateStores(); return !!(ac.storesView && ac.storesView.built); };
        assert.equal(px(8), false, 'a speck: nothing built');
        assert.equal(ac.storesView, undefined, 'nor anything kept');
        assert.equal(px(200), true);
        const mesh = ac.storesView.mesh;
        assert.ok(mesh && mesh.parent === ac.model && Object.keys(ac.storesView.blocks).length >= 2, 'one mesh on the jet, a block a section');
        assert.equal(px(P.HIDE_PX + 2), true, 'kept a little past where it appeared');
        assert.equal(px(P.HIDE_PX - 4), false);
        assert.ok(!mesh.parent && ac.storesView.mesh === null, 'the mesh gone');
        assert.equal(px(P.SHOW_PX - 2), false, 'and not back until clearly bigger');
        assert.equal(px(P.SHOW_PX + 4), true);
        // hidden with the far model
        ac.model.visible = false;
        ac.updateStores();
        assert.equal(ac.storesView.built, false);
        ac.model.visible = true;
        const me = makeAircraft('f16', { game: g, isPlayer: true });
        cam.position.set(me.pos.x + 50000, me.pos.y, me.pos.z); cam.updateMatrixWorld();
        me.updateStores();
        assert.ok(me.storesView.built, 'the player\'s own jet keeps its stations however far the camera');
    });
    test('a wing shot off takes its stores and their ammunition', () => {
        const ac = jet('su35', 'air', { isPlayer: true });
        const before = shownOf(ac), total = { srm: ac.missiles, lrm: ac.lrm };
        const onLeft = (cls) => slotsOf(ac, cls).filter(s => s.region === 'wingL').length;
        const lost = { srm: onLeft('srm'), lrm: onLeft('lrm') };
        assert.ok(lost.srm >= 1 && lost.lrm >= 1, 'something hangs on the left wing');
        // where the left wing's stores hang (model space), and their triangles in the jet's mesh
        const v = ac.storesView, left = slotsOf(ac).filter(s => s.region === 'wingL'), block = { ...v.blocks.wingL };
        const drawn = (idx, i0, n) => { let k = 0; for (let i = i0; i < i0 + n; i += 3) if (idx[i] !== idx[i + 1]) k++; return k; };
        const trisBefore = drawn(v.mesh.geometry.index.array, block.i0, block.n);
        assert.ok(trisBefore > 500, 'the wing\'s block is drawn');
        const onWing = () => ac.regions.wingL.children.filter(o => o.userData.stores);
        assert.equal(onWing().length, 0, 'nothing of it on the wing itself while the wing is on the jet');
        ac.lostRegions.add('wingL'); // (damage.js Wreckage.detach)
        ac.updateStores();
        // the block went from the jet's mesh into a mesh on the wing, the same triangles in the same place
        assert.equal(drawn(v.mesh.geometry.index.array, block.i0, block.n), 0, 'blanked in the jet\'s mesh');
        assert.equal(v.blocks.wingL, undefined);
        const [piece] = onWing();
        assert.ok(piece && piece.material === v.mesh.material && piece.castShadow, 'a mesh of its own on the wing');
        assert.equal(drawn(piece.geometry.index.array, 0, piece.geometry.index.count), trisBefore, 'the same triangles');
        piece.geometry.computeBoundingBox();
        const bb = piece.geometry.boundingBox.clone().translate(ac.regions.wingL.position);
        for (const s of left) assert.ok(bb.containsPoint(s.pos), `${s.store.short} is where it hung`);
        assert.ok(bb.max.x < 0, 'all of it on the left');
        assert.equal(ac.missiles, total.srm - lost.srm);
        assert.equal(ac.lrm, total.lrm - lost.lrm);
        assert.deepEqual(shownOf(ac), { srm: before.srm - lost.srm, lrm: before.lrm - lost.lrm });
        assert.ok(slotsOf(ac).every(s => s.region !== 'wingL'));
        // what's left still fires from the right
        const out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), rail: false };
        for (let k = 0; k < before.srm - lost.srm; k++) { assert.ok(ac.releaseStore('srm', out)); assert.ok(out.pos.clone().sub(ac.pos).dot(ac.getRight(new THREE.Vector3())) > 0); ac.missiles--; }
        ac.updateStores();
        assert.equal(shownOf(ac).srm, 0);
    });
    test('a jet blown apart: every section takes its stores, spent ones stay off, the jet\'s own mesh is freed', () => {
        const ac = jet('su35', 'air');
        const v = ac.storesView, out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), rail: false };
        ac.releaseStore('lrm', out); ac.lrm--; // one spent first
        const hanging = slotsOf(ac).filter(s => s.shown).length, sections = Object.keys(v.blocks);
        const tris = (g) => { const a = g.index.array; let k = 0; for (let i = 0; i < a.length; i += 3) if (a[i] !== a[i + 1]) k++; return k; };
        const whole = tris(v.mesh.geometry), mesh = v.mesh;
        for (const r of Object.keys(ac.regions)) ac.lostRegions.add(r); // (Wreckage.breakup)
        ac.exploded = true;
        ac.update(1 / 60); // (an exploded jet's update does nothing but this)
        assert.ok(!mesh.parent && v.mesh === null && !v.built, 'the jet\'s mesh is gone');
        let pieces = 0, drawn = 0;
        for (const r of sections) for (const o of ac.regions[r].children) if (o.userData.stores) { pieces++; drawn += tris(o.geometry); }
        assert.equal(pieces, sections.length, 'a piece on every section that carried something');
        assert.equal(drawn, whole, 'every triangle that was drawn rides on a piece, and no more');
        assert.ok(hanging > 0);
        ac.update(1 / 60); ac.update(1 / 60); // (and nothing more happens)
    });
    test('stores already spent on the lost wing cost nothing more', () => {
        const ac = jet('su35', 'air', { isPlayer: true });
        const out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), rail: false };
        // fire until a left-wing R-73 has gone
        let fired = 0;
        while (slotsOf(ac, 'srm').filter(s => s.region === 'wingL' && !s.shown).length === 0 && fired < 4) { ac.releaseStore('srm', out); ac.missiles--; fired++; }
        const leftShown = slotsOf(ac, 'srm').filter(s => s.region === 'wingL' && s.shown).length, had = ac.missiles;
        ac.lostRegions.add('wingL'); ac.updateStores();
        assert.equal(ac.missiles, had - leftShown);
        assert.equal(shownOf(ac).srm, ac.missiles);
    });
});

// The X-100 Overkill test jet (config.js x100): every hangar bar at 100, the player's own (no enemy, ally or daily
// pool flies it), its 1000-round-a-second shotgun cannon (blasts of 20 rounds over a wide cone; weapons.js fireGun keeps
// the rate at low frame rates too), and the
// stores only it carries: the MK-84X mega bomb (its `bomb` over WEAPONS.bomb), the GBU-57X bunker buster (the BBU
// slot: it buries itself, goes off on its fuse, and what it hits takes it as a penetrator: underground.js, bases.js) and
// twenty GBU-43X MOABs (the MOAB slot, WEAPONS.moab: the biggest blast in the game).
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arenaGame, seeded, THREE } from './helpers/arena.mjs';

const { AIRCRAFT, WEAPONS, ENEMY_POOL, ENEMY_EARLY, ALLY_POOL, hangarStats } = await src('config.js');
const { SLOTS, slotFits, slotName } = await src('game.js');
const { dailyMission } = await src('missions.js');
const { armAircraft, storeFor } = await src('stores.js');
const { Underground } = await src('underground.js');

const X = AIRCRAFT.x100;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// a ground target that records what hit it
function target(pos, { hp = 1e6, radius = 10, team = 'red' } = {}) {
    return { pos, radius, team, alive: true, hp, hits: [], isGround: true, damage(a, src, kind) { this.hits.push({ a, kind }); this.hp -= a; if (this.hp <= 0) this.alive = false; } };
}
// the arena with flat ground at 0 (land) and these ground targets
function range(targets) {
    const g = arenaGame();
    g.surfaceAt = () => ({ h: 0 });
    g.ground = { targets };
    g.shake = 0;
    return g;
}
// release a bomb of `kind` straight down onto (0, 0, 0) from `alt` m and step until it has gone off
function drop(g, ac, kind, alt = 300) {
    ac.pos.set(0, alt, 0); ac.vel.set(0, 0, 0);
    g.weapons.dropBomb(ac, kind);
    const b = g.weapons.bombs[g.weapons.bombs.length - 1];
    let buried = false;
    for (let t = 0; t < 30 && g.weapons.bombs.includes(b); t += 1 / 60) {
        g.weapons.updateBombs(1 / 60);
        buried = buried || !!b.buried;
    }
    assert.ok(!g.weapons.bombs.includes(b), 'went off');
    return { b, buried };
}

describe('X-100 Overkill: the test jet', () => {
    test('every hangar bar reads 100', () => {
        for (const [n, v] of hangarStats(X)) assert.equal(v, 100, n);
        // (and nothing else in the hangar comes close on all five)
        for (const [id, s] of Object.entries(AIRCRAFT)) if (id !== 'x100') assert.ok(hangarStats(s).some(([, v]) => v < 100), id);
    });

    test('only the player flies it: no enemy or ally pool, no daily mission', () => {
        for (const pool of [ENEMY_POOL, ENEMY_EARLY, ALLY_POOL]) assert.ok(!pool.includes('x100'));
        for (let d = 0; d < 400; d++) assert.notEqual(dailyMission(new Date(2026, 0, 1 + d)).aircraft, 'x100');
    });

    test('its cannon fires 1000 rounds a second, and still does at 20 fps', () => {
        for (const fps of [60, 30, 20]) {
            const g = arenaGame();
            const ac = g.spawn('x100', { team: 'blue', pos: { x: 0, y: 3000, z: 0 }, isPlayer: true });
            ac.ammo = 1e5;
            let shots = 0;
            for (let i = 0; i < fps * 2; i++) { g.time += 1 / fps; shots += g.weapons.fireGun(ac, g.time); }
            assert.ok(shots > 1940 && shots <= 2040, `${fps} fps: ${shots} rounds in 2 s`);
        }
        // an ordinary gun's rate is unchanged
        const g = arenaGame();
        const f16 = g.spawn('f16', { team: 'blue', pos: { x: 0, y: 3000, z: 0 } });
        let shots = 0;
        for (let i = 0; i < 120; i++) { g.time += 1 / 60; shots += g.weapons.fireGun(f16, g.time); }
        assert.ok(Math.abs(shots - AIRCRAFT.f16.gun.rate * 2) <= 2, 'F-16: ' + shots);
    });

    test('it fires like a shotgun: blasts of 20 rounds spread evenly over a wide cone (an F-16\'s stream stays tight)', () => {
        seeded(5, () => {
            const blast = (type) => {
                const g = arenaGame();
                const ac = g.spawn(type, { team: 'blue', pos: { x: 0, y: 3000, z: 0 }, isPlayer: true });
                ac.vel.set(0, 0, 0); // (the rounds' own directions, not the jet's speed added in)
                g.time += 1;
                const n = g.weapons.fireGun(ac, g.time);
                const fwd = ac.getForward(new THREE.Vector3());
                return { n, off: g.weapons.bullets.map(b => b.vel.clone().normalize().angleTo(fwd)), at: g.weapons.bullets.map(b => b.pos.clone()) };
            };
            const x = blast('x100'), f = blast('f16');
            assert.equal(x.n, 20, 'one pull: one blast of 20');
            assert.equal(f.n, 1);
            const cone = X.gun.cone;
            assert.ok(x.off.every(a => a <= cone + 1e-6), 'inside the cone');
            // even over the disc: about a quarter inside half the cone's radius, and many out near the rim
            const inner = x.off.filter(a => a < cone / 2).length, rim = x.off.filter(a => a > cone * 0.7).length;
            assert.ok(inner >= 1 && inner <= 10, 'inner: ' + inner);
            assert.ok(rim >= 6, 'rim: ' + rim);
            assert.ok(Math.max(...x.off) > cone * 0.8, 'the pattern is wide: ' + Math.max(...x.off).toFixed(3));
            assert.ok(Math.max(...f.off) < 0.01, 'the F-16\'s rounds stay tight');
            // a blast leaves the muzzle all at once
            assert.ok(x.at.every(p => p.distanceTo(x.at[0]) < 0.01));
            // 500 m out the pattern is about 80 m across
            const r500 = Math.max(...x.off) * 500;
            assert.ok(r500 > 34 && r500 < 41, 'radius at 500 m: ' + r500.toFixed(1));
        });
    });

    test('its rounds hit ground targets through the grid (weapons.js binTargets): every kind, as a scan of all would', () => {
        seeded(6, () => {
            // a box with a hitTest and its reach (an installation), a sphere (a vehicle), a hitTest with no reach, a long
            // box too big to bin (a bridge-sized span): the last two go in `always`. (All 3.5 km up, clear of the hills.)
            const H = 3500;
            const box = (x, z, hw, hd, yaw, reach) => ({ pos: V(x, H, z), team: 'red', alive: true, hits: 0, ...(reach ? { get hitReach() { return Math.hypot(hw, hd); } } : {}),
                hitTest(p) { const dx = p.x - this.pos.x, dz = p.z - this.pos.z, c = Math.cos(yaw), s = Math.sin(yaw); return Math.abs(dx * c - dz * s) < hw && Math.abs(dx * s + dz * c) < hd && p.y > H - 1 && p.y < H + 12; },
                damage() { this.hits++; } });
            const sphere = (x, z, r) => ({ center: V(x, H + 4, z), pos: V(x, H + 4, z), radius: r, team: 'red', alive: true, hits: 0, damage() { this.hits++; } });
            const inst = box(300, 0, 20, 10, 0.6, true), veh = sphere(0, 300, 6), odd = box(-300, 0, 8, 8, 0, false), span = box(0, -400, 1100, 8, 0, true);
            const g = range([inst, veh, odd, span]);
            const W = g.weapons, owner = { team: 'blue' };
            const T = W.binTargets(g.ground.targets, 40);
            assert.deepEqual(T.always, [odd, span]);
            // a round at each from 150 m off, level 4 m up
            for (const t of [inst, veh, odd, span]) {
                const at = (t.center || t.pos).clone().setY(H + 4), from = at.clone().add(V(150, 0, 90).normalize().multiplyScalar(-150));
                const vel = at.clone().sub(from).normalize().multiplyScalar(WEAPONS.bulletSpeed);
                W.newBullet(from, vel, owner, 10, 2, false, [1, 1, 1]);
                for (let i = 0; i < 30; i++) W.updateBullets(1 / 60);
            }
            assert.deepEqual([inst, veh, odd, span].map(t => t.hits), [1, 1, 1, 1]);
            // 200 boxes and spheres scattered over 3 km: anywhere a round would hit one, that one is in the round's cell
            const many = [];
            for (let i = 0; i < 200; i++) many.push(i % 2 ? sphere(Math.random() * 3000, Math.random() * 3000, 3 + Math.random() * 30) : box(Math.random() * 3000, Math.random() * 3000, 3 + Math.random() * 200, 3 + Math.random() * 40, Math.random() * 6, true));
            const G = W.binTargets(many, 40);
            let checked = 0;
            for (let k = 0; k < 20000; k++) {
                const p = V(Math.random() * 3000, H + 4, Math.random() * 3000);
                const cell = G.cells.get(Math.floor(p.x / 250) * 65536 + Math.floor(p.z / 250)) || [];
                for (const t of many) {
                    const hit = t.hitTest ? t.hitTest(p) : p.distanceTo(t.center) < t.radius;
                    if (hit) { checked++; assert.ok(cell.includes(t) || G.always.includes(t), `a target ${p.x.toFixed(0)},${p.z.toFixed(0)} misses its cell`); }
                }
            }
            assert.ok(checked > 500, 'hits checked: ' + checked);
        });
    });

    test('the bunker-buster slot is the X-100\'s only; its bombs are MK-84Xs', () => {
        const bbu = SLOTS.find(s => s.key === 'buster');
        assert.ok(slotFits(X, bbu));
        for (const [id, s] of Object.entries(AIRCRAFT)) if (id !== 'x100') assert.ok(!slotFits(s, bbu), id);
        const bmb = SLOTS.find(s => s.key === 'bomb');
        assert.equal(slotName(X, bmb), 'MK-84X MEGA BOMB');
        assert.equal(slotName(AIRCRAFT.f16, bmb), 'MK-82 BOMB');
    });

    test('a mega bomb does many times a Mk 82\'s damage, over a much wider circle', () => {
        seeded(3, () => {
            const run = (type) => {
                const near = target(V(0, 0, 30)), far = target(V(0, 0, 120));
                const g = range([near, far]);
                const ac = g.spawn(type, { team: 'blue', pos: { x: 0, y: 300, z: 0 } });
                drop(g, ac, 'bomb');
                const sum = (t) => t.hits.reduce((a, h) => a + h.a, 0);
                return { near: sum(near), far: sum(far), kinds: near.hits.map(h => h.kind) };
            };
            const mk82 = run('f16'), mk84x = run('x100');
            assert.ok(mk84x.near > mk82.near * 6, `near: ${mk84x.near.toFixed(0)} vs ${mk82.near.toFixed(0)}`);
            assert.equal(mk82.far, 0, 'a Mk 82 does nothing 120 m out');
            assert.ok(mk84x.far > 300, 'the MK-84X still wrecks things 120 m out: ' + mk84x.far.toFixed(0));
            assert.deepEqual(mk84x.kinds, ['bomb']);
        });
        assert.equal(WEAPONS.bomb.damage, 220, 'the shared Mk 82 table is left as it was');
    });

    test('twenty GBU-43X MOABs: the X-100\'s only, on both its ground loadouts', () => {
        const moab = SLOTS.find(s => s.key === 'moab');
        assert.ok(slotFits(X, moab));
        for (const [id, s] of Object.entries(AIRCRAFT)) if (id !== 'x100') assert.ok(!slotFits(s, moab), id);
        assert.equal(slotName(X, moab), 'GBU-43X MOAB');
        for (const pre of ['balanced', 'strike']) {
            const ac = { type: 'x100', spec: X };
            armAircraft(ac, pre);
            assert.equal(ac.moabs, 20, pre);
            assert.equal(ac.bombs > 0 && ac.busters > 0, true, pre + ': the MK-84Xs and bunker busters as well');
        }
        assert.ok(storeFor(X, 'moab').kg > storeFor(X, 'bomb').kg * 2, 'bigger than the MK-84X');
    });

    test('a MOAB hits harder than the MK-84X and wrecks things twice as far out', () => {
        seeded(5, () => {
            const run = (kind) => {
                const near = target(V(0, 0, 30)), far = target(V(0, 0, 250));
                const g = range([near, far]);
                const ac = g.spawn('x100', { team: 'blue', pos: { x: 0, y: 300, z: 0 } });
                const { b } = drop(g, ac, kind);
                const sum = (t) => t.hits.reduce((a, h) => a + h.a, 0);
                return { near: sum(near), far: sum(far), kinds: near.hits.map(h => h.kind), W: b.W };
            };
            const mk = run('bomb'), moab = run('moab');
            assert.equal(moab.W.short, 'GBU-43X');
            assert.ok(moab.near > mk.near * 1.5, `near: ${moab.near.toFixed(0)} vs ${mk.near.toFixed(0)}`);
            assert.equal(mk.far, 0, 'the MK-84X does nothing 250 m out');
            assert.ok(moab.far > 500, 'the MOAB still wrecks things 250 m out: ' + moab.far.toFixed(0));
            assert.deepEqual(moab.kinds, ['bomb']);
        });
    });

    test('a bunker buster buries itself, goes off on its fuse, and hits as a penetrator', () => {
        seeded(4, () => {
            const on = target(V(0, 0, 0), { radius: 15 }), off = target(V(0, 0, 50));
            const g = range([on, off]);
            const blasts = [];
            const emit = g.events.emit;
            g.events.emit = (k, a, b) => { if (k === 'blast') blasts.push(b); emit(k, a, b); };
            const ac = g.spawn('x100', { team: 'blue', pos: { x: 0, y: 300, z: 0 } });
            const { buried } = drop(g, ac, 'buster');
            assert.ok(buried, 'it went into the ground before going off');
            assert.ok(on.hits.length && on.hits.every(h => h.kind === 'penetrator'));
            assert.ok(on.hits[0].a >= WEAPONS.buster.damage, 'right on it: ' + on.hits[0].a);
            assert.ok(blasts.some(o => o.kind === 'penetrator'), 'the blast goes out as a penetrator (underground.js listens)');
        });
    });

    test('underground: a bunker buster on a tunnel portal brings it down; a mega bomb only scars it', () => {
        const hits = [];
        const e = { alive: true, d: 6 };
        const c = { active: true, center: V(0, 0, 0), entrances: [e], clues: [{ alive: true, kind: 'vent', hp: 100, radius: 3, pos: V(5, 0, 0) }], unitHit: (u, a, s, k) => hits.push({ u, a, k }) };
        const sys = { complexes: [c], portalDist: (x) => x.d, inDoorway: () => false };
        const owner = { spec: AIRCRAFT.x100 };
        Underground.prototype.blast.call(sys, V(0, 0, 0), { owner, kind: 'penetrator', r: 60, amount: WEAPONS.buster.damage * 4 });
        assert.ok(hits.some(h => h.u === e && h.k === 'penetrator' && h.a > 1200), 'the portal: ' + JSON.stringify(hits.map(h => [h.k, Math.round(h.a)])));
        assert.ok(hits.some(h => h.u === c.clues[0] && h.k === 'penetrator' && h.a >= 5000), 'the vent shaft collapses');
        hits.length = 0;
        Underground.prototype.blast.call(sys, V(0, 0, 0), { owner, kind: 'bomb', r: 150, amount: X.bomb.damage * 4 });
        assert.ok(hits.every(h => h.k !== 'penetrator'), 'a bomb is no penetrator');
    });
});

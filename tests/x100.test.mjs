// The X-100 Overkill test jet (config.js x100): every hangar bar at 100, the player's own (no enemy, ally or daily
// pool flies it), its 100-round-a-second cannon (weapons.js fireGun keeps the rate at low frame rates too), and the
// stores only it carries: the MK-84X mega bomb (its `bomb` over WEAPONS.bomb) and the GBU-57X bunker buster (the BBU
// slot: it buries itself, goes off on its fuse, and what it hits takes it as a penetrator: underground.js, bases.js).
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arenaGame, seeded, THREE } from './helpers/arena.mjs';

const { AIRCRAFT, WEAPONS, ENEMY_POOL, ENEMY_EARLY, ALLY_POOL, hangarStats } = await src('config.js');
const { SLOTS, slotFits, slotName } = await src('game.js');
const { dailyMission } = await src('missions.js');
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

    test('its cannon fires 100 rounds a second, and still does at 20 fps', () => {
        for (const fps of [60, 30, 20]) {
            const g = arenaGame();
            const ac = g.spawn('x100', { team: 'blue', pos: { x: 0, y: 3000, z: 0 }, isPlayer: true });
            ac.ammo = 1e5;
            let shots = 0;
            for (let i = 0; i < fps * 2; i++) { g.time += 1 / fps; shots += g.weapons.fireGun(ac, g.time); }
            assert.ok(shots > 190 && shots <= 202, `${fps} fps: ${shots} rounds in 2 s`);
        }
        // an ordinary gun's rate is unchanged
        const g = arenaGame();
        const f16 = g.spawn('f16', { team: 'blue', pos: { x: 0, y: 3000, z: 0 } });
        let shots = 0;
        for (let i = 0; i < 120; i++) { g.time += 1 / 60; shots += g.weapons.fireGun(f16, g.time); }
        assert.ok(Math.abs(shots - AIRCRAFT.f16.gun.rate * 2) <= 2, 'F-16: ' + shots);
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

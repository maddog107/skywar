// The RPG-7's rocket and the M67 grenade: their ballistics (arsenal.js stepRocket / stepGrenade / solveThrow) and
// what they do when they go off (ordnance.js with a stub world): trucks, tanks, cars, soldiers.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { noop, seeded } from './helpers/arena.mjs';

const THREE = await import('three');
const { ROCKET, GRENADE, stepRocket, stepGrenade, solveThrow, throwVelocity, materielDamage, ARSENAL } = await src('arsenal.js');
const { Ordnance } = await src('ordnance.js');
const { Infantry } = await src('infantry.js');
const { Traffic } = await src('traffic.js');

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const flatGround = (h = 0) => ({ ground: (x, z, out) => { out.h = h; out.nx = 0; out.ny = 1; out.nz = 0; return out; }, solid: null });

// a rocket fired level from 100 m up (nothing to hit), stepped at dt until `until`
function flyRocket(dt, until) {
    const r = { pos: V(0, 100, 0), vel: V(0, 0, -ROCKET.launch), age: 0, dist: 0 };
    let vmax = 0;
    const at = {};
    while (!until(r)) {
        stepRocket(r, dt);
        vmax = Math.max(vmax, r.vel.length());
        for (const d of [100, 300, 500]) if (!at[d] && -r.pos.z >= d) at[d] = { t: r.age, drop: 100 - r.pos.y };
    }
    return { r, vmax, at };
}

function grenade(pos, vel, fuse = GRENADE.fuse) { return { pos: pos.clone(), vel: vel.clone(), fuse, rest: false, bounces: 0 }; }

describe('RPG-7 rocket: flight', () => {
    test('booster 115 m/s, the sustainer takes it to ~295 m/s — at any frame rate', () => {
        for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
            const early = flyRocket(dt, (r) => r.age >= 0.066);
            assert.ok(Math.abs(early.r.vel.length() - 115) < 2, 'leaves the tube at 115 m/s');
            const { vmax } = flyRocket(dt, (r) => r.age >= 1.5);
            assert.ok(vmax > 285 && vmax < 300, `top speed ${vmax.toFixed(1)} m/s at ${Math.round(1 / dt)} fps`);
        }
    });

    test('flat out to 100 m, a few metres of drop at 300 m (the sight\'s stadia), self-destructs past 1 km', () => {
        const runs = [1 / 30, 1 / 60, 1 / 240].map(dt => flyRocket(dt, (r) => r.age >= ROCKET.selfDestruct));
        for (const { at, r } of runs) {
            assert.ok(at[100].drop < 1, 'drop at 100 m: ' + at[100].drop.toFixed(2));
            assert.ok(at[300].drop > 1.5 && at[300].drop < 5, 'drop at 300 m: ' + at[300].drop.toFixed(2));
            assert.ok(at[300].t > 1 && at[300].t < 1.5, 'time of flight to 300 m: ' + at[300].t.toFixed(2));
            assert.ok(r.dist > 900 && r.dist < 1400, 'range at self-destruct: ' + r.dist.toFixed(0));
        }
        // frame-rate independent: the same point at 300 m within a few decimetres, the burst within a few metres
        const d300 = runs.map(x => x.at[300].drop);
        assert.ok(Math.max(...d300) - Math.min(...d300) < 0.3, d300.map(d => d.toFixed(2)).join(' / '));
        const far = runs.map(x => x.r.dist);
        assert.ok(Math.max(...far) - Math.min(...far) < 10, far.map(d => d.toFixed(0)).join(' / '));
    });
});

describe('M67 grenade: throw, bounce, roll', () => {
    test('a throw along the view lands ~20 m out, bounces, rolls, and settles before the fuse', () => {
        for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
            const g = grenade(V(0, 1.75, 0), throwVelocity(V(0, 0, -1)));
            let t = 0, first = null;
            while (!g.rest && t < 6) { const b = stepGrenade(g, dt, flatGround()); t += dt; if (b && !first) first = -g.pos.z; }
            assert.ok(first > 17 && first < 24, 'first bounce at ' + first?.toFixed(1));
            assert.ok(g.rest && t < GRENADE.fuse, 'at rest after ' + t.toFixed(2) + ' s');
            assert.ok(g.bounces >= 1);
            assert.ok(-g.pos.z > first && -g.pos.z < first + 8, 'rolled on to ' + (-g.pos.z).toFixed(1));
            assert.ok(Math.abs(g.pos.y - GRENADE.radius) < 1e-6, 'lying on the ground');
        }
    });

    test('the thrower\'s own motion carries into the throw', () => {
        const still = throwVelocity(V(0, 0, -1), V());
        const running = throwVelocity(V(0, 0, -1), V(), V(0, 0, -5));
        assert.ok(running.length() > still.length() + 3);
    });

    test('off a wall: it comes back', () => {
        // a wall face at z = -6 facing +z
        const env = { ...flatGround(), solid: (x, y, z) => (z < -6 && y < 5 ? { x: 0, z: 1 } : null) };
        const g = grenade(V(0, 1.5, 0), V(0, 2, -15));
        let t = 0;
        while (!g.rest && t < 6) { stepGrenade(g, 1 / 60, env); t += 1 / 60; }
        assert.ok(g.rest);
        assert.ok(g.pos.z > -6, 'stopped on the near side of the wall: z ' + g.pos.z.toFixed(2));
        assert.ok(g.bounces >= 1);
    });

    test('solveThrow lands it where it was aimed (drag costs a few per cent), and says when it can\'t reach', () => {
        for (const [d, h] of [[8, 0], [15, 0], [20, 0], [15, -2], [25, -2]]) {
            const from = V(0, 1.75, 0), to = V(0, h, -d);
            const s = solveThrow(from, to, 15);
            assert.ok(s, `a solution for ${d} m`);
            const g = grenade(from, V(s.x, s.y, s.z), 9);
            let t = 0;
            while (t < 4) { const b = stepGrenade(g, 1 / 120, flatGround(h)); t += 1 / 120; if (b || g.pos.y <= h + GRENADE.radius + 1e-6) break; }
            assert.ok(Math.abs(-g.pos.z - d) < Math.max(0.3, d * 0.035), `aimed ${d} m, landed ${(-g.pos.z).toFixed(2)} m`);
            assert.ok(Math.abs(t - s.time) < 0.1, 'flight time as predicted');
        }
        assert.equal(solveThrow(V(0, 1.75, 0), V(0, 0, -60), 15), null, '60 m is too far to throw');
        const lob = solveThrow(V(0, 1.75, 0), V(0, 0, -15), 15, true), flatThrow = solveThrow(V(0, 1.75, 0), V(0, 0, -15), 15);
        assert.ok(lob.angle > flatThrow.angle && lob.time > flatThrow.time, 'the high lob');
    });
});

// ── what they do: Ordnance in a stub world (flat ground at 0, no effects) ──
function world(extra = {}) {
    const log = [];
    const g = {
        time: 0, shake: 0, damageFlash: 0,
        scene: { add() {}, remove() {}, attach() {} },
        effects: noop(), audio: noop(),
        weapons: { addCrater() {}, blastPeople() {}, hitAir() {} },
        events: { emit(name, who, data) { log.push({ name, who, data, t: g.time }); } },
        camera: new THREE.PerspectiveCamera(),
        difficulty: { skill: 0.6, dmgTaken: 1 },
        aircraft: [], ground: { targets: [] }, world: { towns: null }, infantry: null, pilotMode: null,
        surfaceAt: () => ({ h: 0 }),
        ...extra,
    };
    g.log = log;
    g.ordnance = new Ordnance(g);
    g.step = (dt = 1 / 60) => { g.time += dt; g.ordnance.update(dt); if (g.infantry) { g.infantry.index(); } };
    return g;
}
// a ground target like ground.js's (hp from its table): { type, pos, radius, hp, damage() }
function groundTarget(type, pos, hp, radius) {
    return { type, pos, radius, hp, maxHp: hp, alive: true, team: 'red', hits: [], damage(a, src, kind) { if (!this.alive) return; this.hits.push({ a, kind }); this.hp -= a; if (this.hp <= 0) this.alive = false; } };
}
const shooter = { team: 'blue', pos: V(0, 0, 0), alive: true };
function fireAt(g, target, from = V(0, 1.5, 0)) {
    const dir = V().subVectors(target, from).normalize();
    g.ordnance.launchRocket(shooter, { origin: from, dir, team: 'blue' });
    let t = 0;
    while (g.ordnance.rockets.length && t < 6) { g.step(); t += 1 / 60; }
    return g.log.filter(e => e.name === 'ordnanceExplode').at(-1);
}

describe('RPG-7 rocket: what it hits', () => {
    test('one rocket wrecks a truck 80 m away', () => seeded(1, () => {
        const g = world();
        const truck = groundTarget('truck', V(0, 1.2, -80), 45, 6);
        g.ground.targets.push(truck);
        const boom = fireAt(g, truck.pos);
        assert.ok(boom, 'it went off');
        assert.ok(boom.data.at.distanceTo(truck.pos) < 5, 'on the truck');
        assert.equal(truck.alive, false, 'truck destroyed: ' + JSON.stringify(truck.hits));
        assert.ok(boom.t < 0.6, 'a quick flight: ' + boom.t.toFixed(2) + ' s');
    }));

    test('a tank takes two; a truck 5 m from a hit on the tank is damaged by the blast, one 30 m off isn\'t', () => seeded(2, () => {
        const g = world();
        const tank = groundTarget('tank', V(0, 1.3, -120), 90, 7);
        const near = groundTarget('truck', V(9, 1.2, -121), 45, 6);
        const far = groundTarget('truck', V(34, 1.2, -120), 45, 6);
        g.ground.targets.push(tank, near, far);
        fireAt(g, tank.pos);
        assert.ok(tank.alive && tank.hp < 40, 'one hit: still alive with ' + tank.hp.toFixed(0) + ' hp');
        assert.ok(near.hp < near.maxHp, 'the truck next to it is hurt');
        assert.equal(far.hp, far.maxHp, 'the far one isn\'t');
        fireAt(g, tank.pos);
        assert.equal(tank.alive, false, 'two hits');
    }));

    test('a miss flies on and self-destructs at the end of its range', () => seeded(3, () => {
        const g = world();
        const boom = fireAt(g, V(0, 600, -1000), V(0, 1.5, 0));
        assert.ok(boom, 'it went off');
        assert.ok(Math.abs(boom.t - ROCKET.selfDestruct) < 0.05, 'after ' + boom.t.toFixed(2) + ' s');
        assert.ok(boom.data.at.length() > 900, 'far out');
    }));

    test('into the ground short of the target: it bursts there', () => seeded(4, () => {
        const g = world();
        const boom = fireAt(g, V(0, 0, -40), V(0, 1.6, 0));
        assert.ok(boom && Math.abs(boom.data.at.y) < 0.3 && boom.data.at.z < -30 && boom.data.at.z > -45, 'burst at ' + boom?.data.at.toArray().map(v => v.toFixed(1)));
    }));
});

describe('explosions: people and cars', () => {
    test('soldiers: a direct hit kills, the blast kills those close and spares those further off', () => seeded(5, () => {
        const g = world();
        g.infantry = new Infantry(g);
        g.infantry.render = false;
        const target = g.infantry.spawnSquad({ team: 'red', pos: V(0, 0, -60), n: 1, facing: 0 }).members[0];
        const close = g.infantry.spawnSquad({ team: 'red', pos: V(4, 0, -61), n: 1, facing: 0 }).members[0];
        const safe = g.infantry.spawnSquad({ team: 'red', pos: V(25, 0, -60), n: 1, facing: 0 }).members[0];
        g.infantry.index();
        fireAt(g, V(target.pos.x, 1.2, target.pos.z));
        assert.equal(target.alive, false, 'the one it hit');
        assert.equal(close.alive, false, 'the one 4 m away');
        assert.equal(safe.alive, true, 'the one 25 m away');
        assert.equal(safe.hp, safe.maxHp);
        const killed = g.log.filter(e => e.name === 'soldierKilled');
        assert.equal(killed.length, 2);
        assert.ok(killed.every(e => e.data.source === shooter && e.data.kind === 'blast'));
        // they dropped their rifles (with rounds in them)
        assert.equal(g.ordnance.drops.length, 2);
        assert.ok(g.ordnance.drops.every(d => d.rounds > 0 && d.id === 'ak47'));
        // and the blast threw them (ragdoll-lite)
        assert.ok(close.fling && !close.fling.soft);
    }));

    test('a grenade goes off on its fuse where it came to rest; soldiers near it run first', () => seeded(6, () => {
        const g = world();
        g.infantry = new Infantry(g);
        g.infantry.render = false;
        const s = g.infantry.spawnSquad({ team: 'red', pos: V(0, 0, -22), n: 1, facing: Math.PI }).members[0];
        g.infantry.index();
        const gr = g.ordnance.throwGrenade(shooter, { origin: V(0, 1.75, 0), dir: V(0, 0, -1), team: 'blue' });
        let t = 0, warned = false;
        while (g.ordnance.grenades.length && t < 8) { g.step(); t += 1 / 60; if (s.fleeT > 0) warned = true; }
        const boom = g.log.find(e => e.name === 'ordnanceExplode');
        assert.ok(boom && boom.data.kind === 'grenade');
        assert.ok(Math.abs(boom.t - GRENADE.fuse) < 0.05, 'on its fuse: ' + boom.t.toFixed(2));
        assert.ok(gr.rest && boom.data.at.distanceTo(gr.pos) < 0.01, 'where it lay');
        assert.ok(warned, 'the soldier saw it land and ran');
    }));

    test('cars: rifle rounds set one burning and it goes up; a rocket or grenade wrecks it at once', () => seeded(7, () => {
        const g = world();
        const wrecked = [];
        const t = Object.create(Traffic.prototype); // just the damage side: no roads, no meshes
        t.cars = [V(0, 0, -30), V(3.5, 0, -30), V(60, 0, -30), V(0, 0, -200)].map((p, i) => ({ i, len: 4.6, big: false, hp: 30, maxHp: 30, dead: false, pos: p, speed: 12 }));
        t.buggies = []; t.towns = { parkedSet: null, parkedCars: 0 }; t.carSet = { wreck(i) { wrecked.push(i); } };
        const [a, b, c, d] = t.cars;
        // AK rounds into the first car
        const per = materielDamage(ARSENAL.ak47, 'vehicle');
        let n = 0;
        while (!a.fire && n < 40) { t.hitAt(V(0.3, 0.8, -30), per, g, 2.8, shooter); n++; }
        assert.ok(a.fire > 0 && !a.dead, `on fire after ${n} rounds`);
        assert.ok(a.disabled, 'the driver stopped');
        let secs = 0;
        while (!a.dead && secs < 10) { t.damagedFx(a, 0.1, g); secs += 0.1; }
        assert.ok(a.dead && secs < 6, 'it went up after ' + secs.toFixed(1) + ' s of burning');
        assert.deepEqual(wrecked, [0]);
        assert.ok(b.hp < b.maxHp && !b.dead, 'the car beside it was knocked about');
        const up = g.log.find(e => e.name === 'carDestroyed');
        assert.ok(up && up.who === a && up.data.source === shooter && up.data.how === 'shot');
        // a rocket into the one 60 m off: gone at once; the one far away untouched
        t.blast(c.pos, 2.2, g, shooter);
        assert.ok(c.dead && c.hopV > 3, 'wrecked and thrown up');
        assert.ok(!d.dead);
        // through Ordnance: a grenade at the last one
        g.world.towns = { traffic: t };
        g.ordnance.explode(V(0.5, 0.3, -200), 'grenade', shooter, 'blue');
        assert.ok(d.dead, 'the grenade wrecked it');
    }));
});

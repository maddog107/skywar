// Soldiers (infantry.js) headless: their brains run without bodies (Infantry.render = false) in a stub world with a
// recording ordnance (what they fire, throw and drop), a stand-in player on foot, stub terrain and real buildings.
// Then a firefight with the real Weapons (bullets) and Ordnance on the real terrain of the enemy airbase.
import { src } from './helpers/setup.mjs';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { noop, seeded } from './helpers/arena.mjs';

const THREE = await import('three');
const { Infantry, INF, GARRISONS } = await src('infantry.js');
const { scatter, blastDamage, GRENADE, stepGrenade } = await src('arsenal.js');
const { personHitTest } = await src('pilot.js');
const { Buildings, WORLD_BUILDINGS } = await src('buildings.js');
const { Weapons } = await src('weapons.js');
const { Ordnance } = await src('ordnance.js');
const { BASES, baseToWorld, terrainHeight } = await src('world.js');

const V = (x, y, z) => new THREE.Vector3(x, y, z);
after(() => { WORLD_BUILDINGS.current = null; });

// A stub world: ground from `surface(x, z)`, optional buildings, a recording ordnance.
function field({ surface = () => 0, buildings = null, skill = 0.6 } = {}) {
    const shots = [], throws = [], rockets = [], drops = [], log = [];
    const g = {
        time: 0,
        difficulty: { skill, dmgTaken: 1 },
        events: { emit(name, who, data) { log.push({ name, who, data, t: g.time }); } },
        camera: new THREE.PerspectiveCamera(),
        aircraft: [],
        audio: noop(), effects: noop(),
        world: { towns: buildings ? { buildings } : null },
        ground: null,
        pilotMode: null,
        surfaceAt: (x, z) => ({ h: surface(x, z) }),
        ordnance: {
            // each round's real direction (the weapon's spread on top of the soldier's aim) and whether it hits the
            // player standing where he is
            fireGun(shooter, def, o) {
                const d = scatter(o.dir, o.spread, new THREE.Vector3());
                const pm = g.pilotMode;
                const zone = pm ? personHitTest(o.origin, o.origin.clone().addScaledVector(d, 600), pm.feet(new THREE.Vector3())) : null;
                shots.push({ shooter, def, origin: o.origin.clone(), dir: d, zone, t: g.time });
            },
            launchRocket(shooter, o) { rockets.push({ shooter, origin: o.origin.clone(), dir: o.dir.clone(), t: g.time }); },
            throwGrenade(shooter, o) { throws.push({ shooter, origin: o.origin.clone(), vel: o.vel.clone(), t: g.time }); },
            dropWeapon(from, id, rounds) { drops.push({ id, rounds }); },
        },
    };
    g.inf = g.infantry = new Infantry(g);
    g.inf.render = false;
    g.step = (dt = 1 / 60) => { g.time += dt; g.inf.update(dt); };
    // run for `secs`; stop early when `until()` is true (returns whether it did)
    g.run = (secs, until = null, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) { g.step(dt); if (until && until()) return true; } return false; };
    Object.assign(g, { shots, throws, rockets, drops, log });
    return g;
}
// the player on foot (pilot.js's interface as the soldiers see it): pos rides 0.3 m above the feet
function player(g, x, z, team = 'blue') {
    const p = {
        team, alive: true, walker: {}, vel: V(0, 0, 0), lastShotT: -9,
        pos: V(x, g.surfaceAt(x, z).h + 0.3, z),
        feet(out) { return out.set(this.pos.x, this.pos.y - 0.3, this.pos.z); },
        moveTo(x, z) { this.pos.set(x, g.surfaceAt(x, z).h + 0.3, z); },
    };
    g.pilotMode = p;
    return p;
}
// one soldier, looking along `facing` (0: toward -z) — the squad's jitter taken out
function soldier(g, x, z, { team = 'red', facing = 0, weapon, skill } = {}) {
    const s = g.inf.spawnSquad({ team, pos: V(x, 0, z), n: 1, facing, weapon, skill }).members[0];
    s.yaw = s.lookYaw = s.postYaw = facing;
    return s;
}
function town(boxes) {
    const bl = new Buildings({ add() {} });
    for (const b of boxes) bl.add({ y: 0, yaw: 0, kind: 'house', ...b });
    bl.index();
    return bl;
}

describe('infantry: seeing and hearing', () => {
    test('spots a man in front within a couple of seconds, not one behind him', () => seeded(11, () => {
        const g = field();
        const s = soldier(g, 0, 0, { facing: 0 });
        const p = player(g, 0, -80);
        assert.ok(g.run(3, () => s.state === 'combat'), 'in front: seen');
        assert.equal(s.target, p);
        const g2 = field();
        const s2 = soldier(g2, 0, 0, { facing: 0 });
        player(g2, 0, 80);
        assert.equal(g2.run(10, () => s2.state === 'combat' || s2.state === 'alert'), false, 'behind: not seen in 10 s');
        assert.equal(g2.shots.length, 0);
    }));

    test('a hill or a house in between hides him', () => seeded(12, () => {
        const ridge = (x, z) => 6 * Math.max(0, 1 - Math.abs(z + 40) / 8);
        const g = field({ surface: ridge });
        const s = soldier(g, 0, 0, { facing: 0 });
        player(g, 0, -80);
        assert.equal(g.run(8, () => s.state === 'combat'), false, 'behind the ridge');
        const g2 = field({ buildings: town([{ x: 0, z: -40, w: 24, d: 6, ht: 7 }]) });
        const s2 = soldier(g2, 0, 0, { facing: 0 });
        const p2 = player(g2, 0, -80);
        assert.equal(g2.run(8, () => s2.state === 'combat'), false, 'behind the house');
        // step out from behind it: seen
        p2.moveTo(40, -80);
        assert.ok(g2.run(4, () => s2.state === 'combat'), 'out in the open');
    }));

    test('hears gunfire behind him, turns, finds the shooter', () => seeded(13, () => {
        const g = field();
        const s = soldier(g, 0, 0, { facing: 0 });
        const p = player(g, 0, 150);
        g.run(1);
        assert.equal(s.state, 'idle');
        p.lastShotT = g.time;
        g.inf.noise(p.pos, 380, p, 'blue');
        assert.equal(s.state, 'alert', 'heard it');
        assert.ok(g.run(4, () => s.state === 'combat'), 'turned round and saw him');
        assert.equal(s.target, p);
    }));

    test('the squad is told: men looking the other way turn to the enemy', () => seeded(14, () => {
        const g = field();
        const sq = g.inf.spawnSquad({ team: 'red', pos: V(0, 0, 0), n: 3, facing: 0 });
        const [spotter, ...rest] = sq.members;
        spotter.yaw = spotter.lookYaw = 0;
        for (const m of rest) m.yaw = m.lookYaw = m.postYaw = Math.PI; // backs to him
        const p = player(g, 0, -90);
        assert.ok(g.run(3, () => spotter.state === 'combat'));
        g.run(0.3);
        for (const m of rest) {
            assert.ok(m.state === 'alert' || m.state === 'combat', m.state);
            assert.ok(m.hasTargetPos && m.targetPos.distanceTo(p.pos) < 3, 'knows where he is');
        }
        assert.ok(g.run(4, () => rest.every(m => m.state === 'combat')), 'they all engage');
    }));

    test('friendly soldiers never shoot the player; enemy ones do, at him', () => seeded(15, () => {
        const g = field();
        const sq = g.inf.spawnSquad({ team: 'blue', pos: V(0, 0, 0), n: 3, facing: 0 });
        const p = player(g, 0, -30);
        for (let i = 0; i < 10; i++) { p.lastShotT = g.time; g.inf.noise(p.pos, 380, p, 'blue'); g.run(1); }
        assert.equal(g.shots.length, 0);
        assert.ok(sq.members.every(m => m.target !== p));
        const g2 = field();
        soldier(g2, 0, 0, { facing: 0 });
        const p2 = player(g2, 0, -30);
        g2.run(6);
        assert.ok(g2.shots.length > 5, g2.shots.length + ' rounds');
        const chest = p2.feet(V()).setY(p2.pos.y + 1);
        for (const sh of g2.shots) assert.ok(sh.dir.angleTo(V().subVectors(chest, sh.origin)) < 0.15, 'aimed at him');
    }));
});

describe('infantry: fighting', () => {
    // one soldier shooting at the player standing still `dist` m away for `secs`
    function range(skill, dist, secs = 25, seed = 21) {
        return seeded(seed, () => {
            const g = field({ skill });
            const s = soldier(g, 0, 0, { facing: 0, skill });
            player(g, 0, -dist);
            g.run(secs);
            const n = g.shots.length, hits = g.shots.filter(x => x.zone).length;
            return { n, hits, rate: n ? hits / n : 0, s, g };
        });
    }

    test('accuracy falls with range and rises with difficulty', () => {
        const rookie40 = range(0.35, 40), vet40 = range(0.6, 40), ace40 = range(0.9, 40), vet150 = range(0.6, 150);
        const fmt = (r) => `${r.hits}/${r.n} (${(r.rate * 100).toFixed(0)}%)`;
        console.log(`# soldier hits on a man standing: rookie 40 m ${fmt(rookie40)}, veteran 40 m ${fmt(vet40)}, ace 40 m ${fmt(ace40)}, veteran 150 m ${fmt(vet150)}`);
        for (const r of [rookie40, vet40, ace40, vet150]) assert.ok(r.n > 40, 'kept shooting: ' + r.n);
        assert.ok(ace40.rate > vet40.rate && vet40.rate > rookie40.rate, 'skill');
        assert.ok(vet40.rate > vet150.rate * 1.5, 'range');
        assert.ok(ace40.rate > 0.3 && vet150.rate < 0.2 && rookie40.rate < 0.35, 'sane numbers');
    });

    test('bursts, then a reload when the magazine runs dry', () => {
        const { s, g } = range(0.6, 60, 20, 22);
        assert.ok(g.shots.length > s.gun.def.mag, g.shots.length + ' rounds');
        assert.ok(s.gun.reserve < s.gun.def.mag * 5, 'took rounds from the reserve');
        // bursts: gaps between groups of rounds
        const gaps = g.shots.slice(1).map((x, i) => x.t - g.shots[i].t).filter(d => d > 0.3).length;
        assert.ok(gaps > 4, gaps + ' pauses');
    });

    test('a grenade for a man who ducked behind a wall', () => seeded(23, () => {
        const g = field({ buildings: town([{ x: 0, z: -15, w: 10, d: 1.2, ht: 3 }]) });
        const s = soldier(g, 0, 0, { facing: 0 });
        s.grenades = 2;
        const p = player(g, 12, -21);
        assert.ok(g.run(3, () => s.state === 'combat'), 'saw him');
        p.moveTo(0, -21); // behind the wall
        assert.ok(g.run(10, () => g.throws.length > 0), 'threw one');
        const th = g.throws[0];
        // where it lands
        const gr = { pos: th.origin.clone(), vel: th.vel.clone(), fuse: 9, rest: false };
        const env = { ground: (x, z, out) => { out.h = 0; out.nx = 0; out.ny = 1; out.nz = 0; return out; }, solid: null };
        let t = 0;
        while (t < 4 && gr.pos.y > GRENADE.radius + 1e-6) { stepGrenade(gr, 1 / 120, env); t += 1 / 120; }
        assert.ok(Math.hypot(gr.pos.x - 6, gr.pos.z + 21) < 10, `landed ${Math.hypot(gr.pos.x - 6, gr.pos.z + 21).toFixed(1)} m from where he was`);
        assert.equal(s.grenades, 1);
    }));

    test('they shoot at aircraft low and slow, not at fast or high ones', () => seeded(24, () => {
        const heli = (y, speed) => ({ alive: true, team: 'blue', pos: V(0, y, -250), vel: V(speed, 0, 0), speed, hitRadius: 8, onGround: false });
        const g = field();
        soldier(g, 0, 0, { facing: 0 });
        g.aircraft.push(heli(120, 50));
        g.run(6);
        assert.ok(g.shots.length > 5, 'at a helicopter at 120 m: ' + g.shots.length);
        assert.ok(g.shots.every(x => x.dir.y > 0.2), 'aimed up');
        for (const [y, speed] of [[120, 260], [900, 60]]) {
            const g2 = field();
            soldier(g2, 0, 0, { facing: 0 });
            g2.aircraft.push(heli(y, speed));
            g2.run(6);
            assert.equal(g2.shots.length, 0, `${speed} m/s at ${y} m`);
        }
    }));

    test('an RPG gunner keeps his rockets for men bunched up (not a lone man in the open), then waits a while', () => seeded(28, () => {
        const lone = field();
        soldier(lone, 0, 0, { facing: 0, weapon: 'rpg7' });
        soldier(lone, 0, -80, { team: 'blue', facing: Math.PI, weapon: 'm4a1' });
        lone.run(12);
        assert.equal(lone.rockets.length, 0, 'no rocket at one man in the open');
        const group = field();
        soldier(group, 0, 0, { facing: 0, weapon: 'rpg7' });
        for (const x of [-2, 0, 2.5]) soldier(group, x, -80, { team: 'blue', facing: Math.PI, weapon: 'm4a1' });
        for (const s of group.inf.soldiers) s.spread = true; // (hold them bunched)
        assert.ok(group.run(8, () => group.rockets.length > 0), 'a rocket into the group');
        const t0 = group.rockets[0].t;
        group.run(6);
        assert.ok(group.rockets.every(r => r === group.rockets[0] || r.t - t0 >= 10), 'not another one straight away');
    }));

    test('alerted, a squad spreads out instead of standing in a huddle', () => seeded(29, () => {
        const g = field();
        const sq = g.inf.spawnSquad({ team: 'red', pos: V(0, 0, 0), n: 4, facing: 0, spread: 1 });
        player(g, 0, -120);
        const minGap = () => { let m = Infinity; for (const a of sq.members) for (const b of sq.members) if (a !== b) m = Math.min(m, a.pos.distanceTo(b.pos)); return m; };
        assert.ok(minGap() < 2.5, 'bunched at first: ' + minGap().toFixed(1));
        assert.ok(g.run(10, () => minGap() > 3.5), 'spread out: ' + minGap().toFixed(1));
    }));

    test('shot at: he runs behind the nearest house and kneels there', () => seeded(25, () => {
        const g = field({ buildings: town([{ x: 8, z: 0, w: 6, d: 8, ht: 5 }]) });
        const s = soldier(g, 0, 10, { facing: -Math.PI / 2 }); // looking east (+x)
        const p = player(g, 60, 0);
        g.run(0.5);
        s.damage(20, p, 'gun', p.pos.clone());
        let hidden = false;
        g.run(8, () => (hidden = s.inCover && s.stance === 'crouch' && !g.inf.losClear(V(60, 1.6, 0), V(s.pos.x, s.pos.y + 1.0, s.pos.z))));
        assert.ok(hidden, `in cover behind the house: at ${s.pos.x.toFixed(1)}, ${s.pos.z.toFixed(1)}`);
        assert.ok(s.pos.x < 8, 'on the far side of it');
    }));

    test('death: he falls, drops his rifle, and his squad knows where it came from', () => seeded(26, () => {
        const g = field();
        const sq = g.inf.spawnSquad({ team: 'red', pos: V(0, 0, 0), n: 3, facing: 0 });
        for (const m of sq.members) m.yaw = m.lookYaw = Math.PI;
        const p = player(g, 0, -120);
        g.run(0.5);
        const [a, b, c] = sq.members;
        a.damage(999, p, 'gun', p.pos.clone());
        assert.equal(a.alive, false); assert.equal(a.state, 'dead');
        assert.deepEqual(g.drops.map(d => d.id), ['ak47']);
        assert.ok(g.drops[0].rounds >= 30);
        const k = g.log.find(e => e.name === 'soldierKilled');
        assert.ok(k && k.who === a && k.data.source === p && k.data.kind === 'gun');
        for (const m of [b, c]) { assert.equal(m.state, 'alert'); assert.ok(m.hasTargetPos && m.targetPos.distanceTo(p.pos) < 20); }
        // he falls away from the shot and ends up on the ground
        g.run(2);
        assert.ok(a.fling.done && Math.abs(a.pos.y) < 0.01);
        assert.ok(a.pos.z > 0 || a.fling.vel.z >= 0, 'knocked back, away from the shooter');
        // a dead man doesn't shoot or get hurt again
        const n = g.shots.filter(x => x.shooter === a).length;
        a.damage(50, p);
        g.run(1);
        assert.equal(g.shots.filter(x => x.shooter === a).length, n);
    }));

    test('blasts: his own side\'s grenade hurts him a third as much', () => seeded(27, () => {
        const g = field();
        const a = soldier(g, 0, 0), b = soldier(g, 60, 0), foe = soldier(g, 0, 60, { team: 'blue' });
        g.inf.index();
        const B = GRENADE.blast, at = V(10, 0.3, 0);
        g.inf.blast(at, B, foe, 'blue');
        const full = a.maxHp - a.hp;
        a.hp = a.maxHp;
        g.inf.blast(at, B, b, 'red');
        const own = a.maxHp - a.hp;
        assert.ok(a.alive && full > 0 && Math.abs(own / full - 0.35) < 0.01, `enemy ${full.toFixed(0)} vs own ${own.toFixed(0)}`);
        assert.ok(Math.abs(full - blastDamage(V(0, 0.9, 0).distanceTo(at), B)) < 1e-6);
        // close in, it kills either way
        g.inf.blast(V(2, 0.3, 0), B, b, 'red');
        assert.equal(a.alive, false);
    }));
});

describe('infantry: garrisons and a real firefight', () => {
    test('every garrison squad stands on land inside its base', () => {
        const g = field({ surface: (x, z) => Math.max(terrainHeight(x, z), 0) });
        const enemy = BASES.find(b => b.id === 'enemy'), home = BASES.find(b => b.id === 'home');
        const red = g.inf.garrison(enemy, 'red', baseToWorld, GARRISONS.enemy), blue = g.inf.garrison(home, 'blue', baseToWorld, GARRISONS.home);
        assert.ok(red.reduce((n, q) => n + q.members.length, 0) >= 30, 'the enemy base is well guarded');
        assert.ok(blue.reduce((n, q) => n + q.members.length, 0) >= 6);
        for (const s of g.inf.soldiers) assert.ok(terrainHeight(s.pos.x, s.pos.z) > 0, 'not in the sea');
        assert.ok(g.inf.soldiers.some(s => s.weaponId === 'rpg7') && g.inf.soldiers.some(s => s.weaponId === 'm870'), 'mixed weapons');
    });

    test('two squads at 110 m on the enemy apron: real rounds, real casualties, no friendly kills', () => seeded(31, () => {
        const E = BASES.find(b => b.id === 'enemy');
        const P = (lx, lz) => { const w = baseToWorld(E, lx, lz); return V(w.x, terrainHeight(w.x, w.z), w.z); };
        const a = P(420, -700), b = P(420, -810);
        assert.ok(Math.abs(a.y - b.y) < 1.5, 'flat ground');
        const log = [];
        const g = {
            time: 0, shake: 0, damageFlash: 0,
            difficulty: { skill: 0.6, dmgTaken: 1 },
            events: { emit(name, who, data) { log.push({ name, who, data, t: g.time }); } },
            camera: new THREE.PerspectiveCamera(),
            scene: { add() {}, remove() {}, attach() {} },
            aircraft: [], ground: null, pilotMode: null, player: null,
            audio: noop(), effects: noop(), wreckage: noop(),
            world: { towns: null },
            surfaceAt: (x, z) => ({ h: Math.max(terrainHeight(x, z), 0) }),
        };
        g.camera.position.copy(a).lerp(b, 0.5).setY(a.y + 300);
        g.camera.updateMatrixWorld();
        g.weapons = new Weapons(g);
        g.ordnance = new Ordnance(g);
        g.infantry = new Infantry(g);
        g.infantry.render = false;
        const red = g.infantry.spawnSquad({ team: 'red', pos: a, n: 4, facing: Math.atan2(-(b.x - a.x), -(b.z - a.z)) });
        const blue = g.infantry.spawnSquad({ team: 'blue', pos: b, n: 4, facing: Math.atan2(-(a.x - b.x), -(a.z - b.z)) });
        for (const m of [...red.members, ...blue.members]) m.grenades = 0;
        let rounds = 0;
        const origFire = g.ordnance.fireGun.bind(g.ordnance);
        g.ordnance.fireGun = (...args) => { rounds++; return origFire(...args); };
        const dt = 1 / 60;
        for (let t = 0; t < 90 && red.alive && blue.alive; t += dt) {
            g.time += dt;
            g.infantry.update(dt);
            g.ordnance.update(dt);
            g.weapons.update(dt);
        }
        const deaths = log.filter(e => e.name === 'soldierKilled');
        const alive = (q) => q.members.filter(m => m.alive).length;
        console.log(`# firefight at 110 m: ${rounds} rounds, ${deaths.length} dead in ${g.time.toFixed(0)} s (red ${alive(red)} / blue ${alive(blue)} left)`);
        assert.ok(rounds > 50, 'they fought');
        assert.ok(deaths.length >= 2, 'people died');
        for (const d of deaths) assert.ok(d.data.source && d.data.source.team !== d.who.team, 'killed by the other side');
        assert.ok(g.ordnance.drops.length === deaths.length, 'each dropped his rifle');
    }));
});

void INF;

import { src } from './helpers/setup.mjs';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { arenaGame, seeded, noop } from './helpers/arena.mjs';

// The living war (front.js, tasks.js, director.js, wingmen.js) against stub games: the front has to move when a
// side dominates (and never into an airbase), kills have to weaken their sector, tasks have to be offered, paced,
// accepted, completed and failed from what happens, wingmen have to change what they do when ordered, and
// flights have to become real jets near the player and abstract again far away.
let THREE, W, F, T, D, WM, world, config;

// a game with an event bus that works (handlers), a real War, and whatever else a test adds
function warGame(extra = {}) {
    const handlers = {};
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 60000, 250000); // far from everything: no effects near the camera
    const g = {
        time: 0, state: 'playing', mode: 'war', callsign: 'TEST', score: 0,
        difficulty: config.DIFFICULTY.veteran, settings: { start: 'auto' },
        camera: cam, scene: new THREE.Scene(),
        world: { weather: 'clear', timeKey: 'day', towns: null, tiles: new Map(), TILE: 2048 },
        events: { on(k, fn) { (handlers[k] = handlers[k] || []).push(fn); }, emit(k, a, b) { (handlers[k] || []).forEach(fn => fn(a, b || {})); } },
        audio: { say() {}, tick() {}, boom() {}, uiConfirm() {} },
        feed: [], addFeed(t) { this.feed.push(t); },
        aircraft: [], naval: { ships: [] }, player: null, pilotMode: null, navTarget: null, lockTarget: null,
        effects: noop(), weapons: noop(), systems: [], isNeutral: () => false,
        ...extra,
    };
    g.ground = g.ground || stubGround(g);
    g.war = new W.War(g);
    g.war.start(g.mode);
    return g;
}

// ground targets as far as the war systems care: position, team, hp, damage → groundKilled
function stubGround(g) {
    return {
        targets: [],
        addTarget(type, x, z, rot, team) {
            const y = Math.max(world.terrainHeight(x, z), 0);
            const u = {
                type, team, alive: true, isGround: true, radius: 7, hp: 90, maxHp: 90, health: 90, maxHealth: 90, def: { score: 100, name: type }, name: type.toUpperCase(),
                pos: new THREE.Vector3(x, y + 3, z), vel: new THREE.Vector3(), mesh: { position: new THREE.Vector3(x, y, z), rotation: { y: rot }, add() {} },
                damage(a, source) { if (!this.alive) return; this.hp -= a; this.health = this.hp; if (this.hp <= 0) { this.alive = false; g.events.emit('groundKilled', this, { source }); } },
                remove() {},
            };
            this.targets.push(u);
            return u;
        },
    };
}

const step = (g, secs, dt = 1, fn = null) => {
    for (let t = 0; t < secs; t += dt) {
        g.time += dt; g.war.time += dt;
        for (const s of g.systems) if (s.update) s.update(dt);
        if (fn) fn(t);
    }
};

before(async () => {
    THREE = await import('three');
    W = await src('war.js');
    F = await src('front.js');
    T = await src('tasks.js');
    D = await src('director.js');
    WM = await src('wingmen.js');
    world = await src('world.js');
    config = await src('config.js');
});

describe('the front line', () => {
    const frontGame = () => {
        const g = warGame();
        g.front = new F.FrontLine(g);
        g.systems = [g.front];
        g.front.start('war');
        return g;
    };

    test('the fighting stretch is split into named sectors, and the war starts where it always did', () => {
        const g = frontGame(), fr = g.front;
        assert.ok(fr.sectors.length >= 5, fr.sectors.length + ' sectors');
        assert.deepEqual(fr.sectors.map(s => s.name).slice(0, 3), ['ALPHA', 'BRAVO', 'CHARLIE']);
        assert.equal(g.war.sideAt(7000, -17000), 'red');
        assert.equal(g.war.sideAt(0, 0), 'blue');
        assert.equal(g.war.sideAt(-10000, -19100), 'blue');
        for (const s of fr.sectors) {
            const n = s.normal;
            assert.equal(g.war.sideAt(s.center.x + n.x * 1500, s.center.z + n.z * 1500), 'red', s.name + ': its normal points into enemy ground');
            assert.equal(g.war.sideAt(s.center.x - n.x * 1500, s.center.z - n.z * 1500), 'blue', s.name + ': and away from ours');
        }
    });

    test('a sector where we dominate pushes the front into enemy ground, smoothly', () => {
        const g = frontGame(), fr = g.front, s = fr.landSectors[1];
        const probe = new THREE.Vector3(s.center.x + s.normal.x * 400, 0, s.center.z + s.normal.z * 400);
        assert.equal(g.war.sideAt(probe.x, probe.z), 'red');
        fr.offensiveT = 1e9; // (no random offensives in this test)
        let maxStep = 0, last = 0;
        step(g, 600, 1, () => { s.blue = 95; s.red = 40; maxStep = Math.max(maxStep, s.off - last); last = s.off; });
        assert.ok(s.off > 1500, 'moved ' + Math.round(s.off) + ' m in 10 min');
        assert.ok(maxStep <= 6.5, 'no jumps: at most ' + maxStep.toFixed(1) + ' m a second');
        assert.equal(g.war.sideAt(probe.x, probe.z), 'blue', 'the ground just past the old line is ours now');
    });

    test('a collapsing sector never gives up an airbase', () => {
        const g = frontGame(), fr = g.front;
        fr.offensiveT = 1e9;
        step(g, 3600, 2, () => { for (const s of fr.sectors) { s.red = 110; s.blue = 8; } });
        for (const b of world.BASES.filter(b => b.friendly)) {
            assert.equal(g.war.sideAt(b.x, b.z), 'blue', b.name + ' still ours');
            for (const p of g.war.front) assert.ok(Math.hypot(p.x - b.x, p.z - b.z) > 5000, 'the front stays clear of ' + b.name);
        }
        assert.ok(fr.sectors.every(s => s.off <= 0) && fr.sectors.some(s => s.off < -2000), 'it did fall back');
    });

    test("kills near the line weaken their side's sector; the ground war's own fire doesn't count twice", () => {
        const g = frontGame(), fr = g.front, s = fr.landSectors[2];
        const at = new THREE.Vector3(s.center.x + s.normal.x * 800, 0, s.center.z + s.normal.z * 800);
        const red0 = s.red;
        for (let k = 0; k < 4; k++) g.events.emit('groundKilled', { team: 'red', pos: at, cls: 'tank' }, { source: {} });
        assert.ok(red0 - s.red > 12, 'four tanks cost the enemy ' + (red0 - s.red).toFixed(1));
        const red1 = s.red;
        g.events.emit('groundKilled', { team: 'red', pos: at, cls: 'tank' }, { source: { isFront: true } });
        assert.equal(s.red, red1);
        const blue0 = s.blue;
        g.events.emit('groundKilled', { team: 'blue', pos: at, cls: 'tank' }, { source: {} });
        assert.ok(s.blue < blue0, 'our losses weaken us');
    });

    test('a bridge down behind their lines cuts their supply for as long as it is down', () => {
        const g = frontGame(), fr = g.front, s = fr.landSectors[0];
        const bpos = new THREE.Vector3(s.center.x + s.normal.x * 5000, 0, s.center.z + s.normal.z * 5000);
        g.world.towns = { towns: [], bridges: [{ alive: false, pos: bpos }] };
        fr.updateSupply();
        assert.ok(s.supply.red < 0.9, 'red supply ' + s.supply.red.toFixed(2));
        assert.equal(s.supply.blue, 1);
        g.world.towns.bridges[0].alive = true;
        fr.updateSupply();
        assert.equal(s.supply.red, 1, 'repaired: supply back');
    });

    test('stretches of front over the sea stay quiet; near the player, real units fight on land', () => {
        const g = frontGame(), fr = g.front;
        assert.ok(fr.landSectors.length >= 3, fr.landSectors.length + ' land sectors');
        fr.offensiveT = 1e9;
        const sea = fr.sectors.find(s => s.sea);
        if (sea) { step(g, 120, 1, () => { sea.blue = 100; sea.red = 10; }); assert.equal(sea.off, 0, 'a sea stretch does not move'); }
        const s = fr.landSectors[1];
        g.player = { pos: new THREE.Vector3(s.center.x - s.normal.x * 3000, 1500, s.center.z - s.normal.z * 3000), alive: true };
        step(g, 4);
        assert.ok(fr.zones.length >= 1, 'an engagement zone near the player');
        const z = fr.zones[0];
        const reds = z.units.filter(u => u.team === 'red'), blues = z.units.filter(u => u.team === 'blue');
        assert.ok(reds.length >= 2 && blues.length >= 2, reds.length + ' red, ' + blues.length + ' blue');
        assert.ok(reds.filter(u => g.war.sideAt(u.pos.x, u.pos.z) === 'red').length >= 2, 'theirs on their side');
        assert.ok(blues.filter(u => g.war.sideAt(u.pos.x, u.pos.z) === 'blue').length >= 2, 'ours on ours');
        for (const u of z.units) assert.ok(world.terrainHeight(u.pos.x, u.pos.z) > 1, 'on land');
        g.player.pos.set(0, 1500, 70000);
        step(g, 3);
        assert.equal(fr.zones.length, 0, 'gone when the player left');
        assert.ok(g.ground.targets.every(u => !u.frontZone || u.removed), 'its vehicles taken away');
    });

    test('red artillery batteries sit behind their lines and add to their firepower', () => {
        const g = frontGame(), fr = g.front;
        assert.ok(fr.batteries.length >= 2, fr.batteries.length + ' batteries');
        for (const bt of fr.batteries) {
            assert.equal(bt.units.length, 3);
            for (const u of bt.units) {
                assert.equal(g.war.sideAt(u.pos.x, u.pos.z), 'red');
                assert.equal(g.war.rec(u).cls, 'artillery');
            }
        }
        fr.updateSupply();
        const s = fr.batteries[0].sector;
        assert.ok(s.redFirepower > 1.1);
        for (const u of fr.batteries[0].units) u.damage(999, {});
        fr.updateSupply();
        assert.ok(s.redFirepower < 1.1 || fr.batteries.some(b => b !== fr.batteries[0] && b.sector === s), 'silenced');
    });
});

describe('tasks', () => {
    const taskGame = () => {
        const g = warGame();
        g.player = { pos: new THREE.Vector3(0, 2000, 0), alive: true, isPlayer: true, team: 'blue' };
        g.tasks = new T.TaskManager(g);
        g.systems = [g.tasks];
        g.tasks.start('war');
        g.tasks.builtin = []; // (only what each test offers)
        return g;
    };
    const target = (g, x = 6000, z = -9000) => { const u = g.ground.addTarget('tank', x, z, 0, 'red'); g.war.add(u, { cls: 'tank' }); return u; };

    test('an offered task is accepted, steers the player, and pays out when its target dies', () => {
        const g = taskGame(), tm = g.tasks;
        const u = target(g);
        const t = tm.offer({ type: 'test', title: 'DESTROY THE TANK', units: [u], reward: 500 });
        assert.ok(t && t.state === 'offered');
        assert.ok(g.feed.some(l => /NEW TASK AVAILABLE — DESTROY THE TANK/.test(l)), 'offered on the radio');
        assert.ok(tm.commands().some(c => c.path[0] === 'TASKS' && /ACCEPT: DESTROY THE TANK/.test(c.label) && c.badge), 'in the command menu, with a badge');
        tm.accept(t);
        assert.equal(tm.active, t);
        assert.ok(g.navTarget && g.navTarget.pos.distanceTo(u.pos) < 1, 'the steer cue points at it');
        u.damage(999, g.player);
        step(g, 1);
        assert.equal(t.state, 'done');
        assert.equal(g.score, 500);
        assert.equal(tm.doneCount, 1);
        assert.equal(g.navTarget, null, 'the steer cue is released');
    });

    test('failure: out of time, and a target that gets away', () => {
        const g = taskGame(), tm = g.tasks;
        const t = tm.offer({ type: 'test', title: 'QUICK', units: [target(g)], limit: 20 }, { force: true });
        tm.accept(t);
        step(g, 25);
        assert.equal(t.state, 'failed');
        assert.ok(g.feed.some(l => /TASK FAILED — OUT OF TIME/.test(l)));
        const u = target(g);
        const t2 = tm.offer({ type: 'test', title: 'RUNNER', units: [u] }, { force: true });
        tm.accept(t2);
        u.removed = true; // (a convoy that got home)
        step(g, 1);
        assert.equal(t2.state, 'failed');
    });

    test('paced: routine offers a couple of minutes apart, urgent ones sooner, three at most', () => {
        const g = taskGame(), tm = g.tasks;
        assert.ok(tm.offer({ type: 'a', title: 'ONE', units: [target(g)] }));
        assert.equal(tm.offer({ type: 'b', title: 'TWO', units: [target(g)] }), null, 'too soon after the first');
        step(g, 20);
        assert.ok(tm.offer({ type: 'c', title: 'RAID', urgent: true, pos: new THREE.Vector3() }), 'an urgent one gets through');
        step(g, 30);
        assert.equal(tm.offer({ type: 'b', title: 'TWO', units: [target(g)] }), null, 'routine offers wait ~2 minutes');
        step(g, 100);
        assert.ok(tm.offer({ type: 'b', title: 'TWO', units: [target(g)] }));
        assert.equal(tm.offered.length, 3);
        step(g, 20);
        assert.ok(tm.offer({ type: 'd', title: 'LAUNCH', urgent: true, pos: new THREE.Vector3() }), 'an urgent offer pushes out the oldest routine one');
        assert.equal(tm.offered.length, 3);
        assert.ok(!tm.offered.some(t => t.title === 'ONE'));
    });

    test('offers expire; one finished by someone else pays nothing, by the player half', () => {
        const g = taskGame(), tm = g.tasks;
        const t = tm.offer({ type: 'x', title: 'OLD NEWS', pos: new THREE.Vector3(), expires: 60 });
        step(g, 61);
        assert.equal(t.state, 'expired');
        const u1 = target(g), u2 = target(g, 7000, -9500);
        const a = tm.offer({ type: 'y', title: 'THEIRS', units: [u1] }, { force: true });
        const b = tm.offer({ type: 'z', title: 'MINE', units: [u2], reward: 400 }, { force: true });
        u1.damage(999, { team: 'blue' });
        u2.damage(999, g.player);
        step(g, 1);
        assert.equal(a.state, 'done'); assert.equal(b.state, 'done');
        assert.equal(g.score, 200, 'half of MINE, nothing for THEIRS');
    });

    test('plug-ins add generators', () => {
        const g = taskGame(), tm = g.tasks;
        let calls = 0;
        tm.addGenerator(() => { calls++; return calls === 2 ? { type: 'plugin', title: 'FROM A PLUG-IN', pos: new THREE.Vector3(1000, 0, 1000) } : null; });
        step(g, 35);
        assert.ok(calls >= 2);
        assert.ok(tm.offered.some(t => t.title === 'FROM A PLUG-IN'));
    });

    test('a raid: offered when it is detected, done when it is shot down, failed when it gets through', () => {
        const g = taskGame(), tm = g.tasks;
        const f = { id: 7, team: 'red', role: 'raid', n: 2, pos: new THREE.Vector3(0, 3000, -40000), target: { pos: new THREE.Vector3(), label: 'SKYWAR AIR BASE' }, done: false };
        g.events.emit('raidDetected', f);
        const t = tm.offered.find(x => x.type === 'raid');
        assert.ok(t && t.urgent && /INTERCEPT THE RAID ON SKYWAR AIR BASE/.test(t.title));
        tm.accept(t);
        f.hitReported = true;
        step(g, 1);
        assert.equal(t.state, 'failed');
        const f2 = { ...f, id: 8, hitReported: false, n: 2 };
        g.events.emit('raidDetected', f2);
        const t2 = tm.offered.find(x => x.key === 'raid:8');
        tm.accept(t2);
        f2.n = 0;
        step(g, 1);
        assert.equal(t2.state, 'done');
    });

    test('battle damage assessment: a task while the strike waits for eyes on it (with the real generators)', () => {
        const g = warGame();
        g.player = { pos: new THREE.Vector3(0, 2000, 0), alive: true, isPlayer: true, team: 'blue' };
        const u = g.ground.addTarget('tank', 6000, -9000, 0, 'red');
        g.war.add(u, { cls: 'tank' });
        const aim = { pos: u.pos, unit: u, label: 'T-72 TANK' };
        g.strikes = { bda: [{ strike: { id: 3, team: 'blue', type: 'cruise' }, aim, pos: u.pos.clone(), t: 0, look: 0 }] };
        const tm = g.tasks = new T.TaskManager(g);
        g.systems = [tm];
        tm.start('war');
        step(g, 21);
        const t = tm.offered.find(x => x.type === 'bda');
        assert.ok(t, 'offered: ' + tm.offered.map(x => x.title).join(', '));
        tm.accept(t);
        g.strikes.bda.length = 0; aim.result = 'TARGET DESTROYED';
        step(g, 1);
        assert.equal(t.state, 'done');
        assert.equal(g.score, 300);
    });
});

describe('wingmen', () => {
    // a real wingman (Aircraft + Pilot) with the player flying straight and level, and the war around them
    const wingGame = (x = 20000, z = 30000, alt = 3500) => {
        const g = arenaGame();
        const handlers = {};
        const emit = g.events.emit;
        g.events = { on(k, fn) { (handlers[k] = handlers[k] || []).push(fn); }, emit(k, a, b) { emit(k, a, b); (handlers[k] || []).forEach(fn => fn(a, b || {})); } };
        g.war = new W.War(g); g.war.start('war');
        g.war.radio = function (from, text) { (g.radioLog = g.radioLog || []).push(from + ': ' + text); };
        g.isNeutral = () => false;
        g.lockTarget = null;
        g.camera = { position: new THREE.Vector3(0, 50000, 0) };
        g.mode = 'war';
        g.state = 'playing';
        const y = Math.max(world.terrainHeight(x, z), 0) + alt;
        const P = g.spawn('f16', { team: 'blue', pos: { x, y, z }, heading: 0, speedFrac: 0.6, isPlayer: true });
        P.pilot = null;
        g.player = P;
        const w = g.spawn('f16', { team: 'blue', pos: { x: x + 80, y: y - 10, z: z + 80 }, heading: 0, speedFrac: 0.6, skill: 0.7 });
        w.callsign = 'BOLT';
        w.pilot.formation = { leader: P, offset: new THREE.Vector3(70, -8, 60) };
        g.wingmen = new WM.Wingmen(g);
        g.wingmen.start('war');
        return { g, P, w, y };
    };
    const fly = (g, P, secs, dt = 1 / 30, fn = null) => {
        for (let i = 0; i < secs / dt; i++) {
            // the player: straight and level
            P.controls.pitch = 0; P.controls.roll = 0; P.controls.yaw = 0; P.controls.throttle = 0.7;
            g.step(dt);
            g.war.time += dt;
            g.wingmen.update(dt);
            if (fn) fn(i * dt);
        }
    };

    test('the Living War starts them covering the player; the order changes what they fight', () => {
        seeded(11, () => {
            const { g, P, w } = wingGame();
            assert.equal(w.pilot.brain.order, 'cover');
            // a bandit 20 km off: covering, he stays on the wing
            const far = g.spawn('mig29', { team: 'red', pos: { x: P.pos.x + 20000, y: P.pos.y, z: P.pos.z }, heading: Math.PI / 2, skill: 0.5 });
            far.pilot.passive = true; far.pilot.waypoint = far.pos.clone().add(new THREE.Vector3(30000, 0, 0));
            fly(g, P, 5);
            assert.equal(w.pilot.target, null, 'covering: not chasing a bandit 20 km away');
            assert.ok(w.pos.distanceTo(P.pos) < 1500, 'still on the wing (' + Math.round(w.pos.distanceTo(P.pos)) + ' m)');
            // free CAP: he goes for it
            assert.ok(g.wingmen.order('engage'));
            assert.ok(g.radioLog.some(l => /^BOLT: (COPY, ENGAGING BANDITS|WEAPONS FREE, HUNTING|COPY, FREE CAP)/.test(l)), 'acknowledged: ' + g.radioLog.slice(-1));
            fly(g, P, 3);
            assert.equal(w.pilot.target, far, 'engaging the far bandit');
            // attack my target: nothing locked or marked → unable
            assert.equal(g.wingmen.order('attack'), false);
            assert.ok(/UNABLE/.test(g.radioLog[g.radioLog.length - 1]));
            g.lockTarget = far;
            assert.ok(g.wingmen.order('attack'));
            assert.equal(w.pilot.brain.target, far);
        });
    });

    test('hold position: he orbits where he was told and stays there', () => {
        seeded(12, () => {
            const { g, P, w } = wingGame();
            g.wingmen.order('hold');
            const hold = w.pilot.brain.hold.clone();
            assert.equal(w.pilot.formation, null);
            assert.ok(/HOLDING AT ANGELS/.test(g.radioLog[g.radioLog.length - 1]));
            let maxR = 0;
            fly(g, P, 150, 1 / 30, (t) => { if (t > 60) maxR = Math.max(maxR, Math.hypot(w.pos.x - hold.x, w.pos.z - hold.z)); });
            assert.ok(w.alive, 'still flying');
            assert.ok(maxR < 4500, 'orbiting within ' + Math.round(maxR) + ' m of the hold point');
            assert.ok(P.pos.distanceTo(hold) > 15000, 'while the player flew on (' + Math.round(P.pos.distanceTo(hold)) + ' m)');
        });
    });

    test('attack ground targets: gun and rocket runs on a known tank near the player', () => {
        seeded(13, () => {
            // over the home airfield (the one big flat place): the player 6 km out at 1800 m, a tank on the runway
            const { g, P, w, y } = wingGame(0, 6000, 1800);
            const tx = 0, tz = -600;
            const tank = { pos: new THREE.Vector3(tx, Math.max(world.terrainHeight(tx, tz), 0) + 2.5, tz), vel: new THREE.Vector3(), team: 'red', alive: true, isGround: true, radius: 7, hitRadius: 7, center: null, hp: 90, name: 'T-72',
                damage(a) { this.hp -= a; if (this.hp <= 0) this.alive = false; }, incoming: [] };
            tank.center = tank.pos;
            g.ground = { targets: [tank] };
            g.war.add(tank, { cls: 'tank', name: 'T-72', known: 2 });
            assert.ok(g.wingmen.order('ground'));
            assert.equal(w.pilot.brain.target, tank);
            let fired = 0, dove = false, minAgl = Infinity;
            const rk0 = w.rockets;
            fly(g, P, 150, 1 / 30, () => {
                if (w.pilot.strafePhase === 'in') dove = true;
                if (w.alive) minAgl = Math.min(minAgl, w.pos.y - Math.max(world.terrainHeight(w.pos.x, w.pos.z), 0));
                fired = g.log.gunShots;
            });
            void y;
            assert.ok(w.alive, 'he did not fly into the ground (lowest ' + Math.round(minAgl) + ' m)');
            assert.ok(dove, 'made a run on it');
            assert.ok(fired > 0 || w.rockets < rk0, 'fired at it');
            assert.ok(!tank.alive || tank.hp < 90, 'hit it (hp ' + Math.round(tank.hp) + ')');
        });
    });

    test('return to base: he flies home; no order at all leaves the AI as it was', () => {
        seeded(14, () => {
            const { g, P, w } = wingGame();
            g.wingmen.order('rtb');
            assert.ok(w.pilot.passive && w.pilot.waypoint, 'flying a route home');
            const base = g.wingmen.list[0].base;
            const d0 = Math.hypot(w.pos.x - base.x, w.pos.z - base.z);
            fly(g, P, 40);
            assert.ok(Math.hypot(w.pos.x - base.x, w.pos.z - base.z) < d0 - 5000, 'closer to ' + base.name);
            // a wingman without a brain picks targets the old way (anything, anywhere)
            const { g: g2, w: w2 } = wingGame();
            w2.pilot.brain = null;
            const far = g2.spawn('mig29', { team: 'red', pos: { x: w2.pos.x + 20000, y: w2.pos.y, z: w2.pos.z }, heading: Math.PI / 2, skill: 0.5 });
            w2.pilot.pickTarget();
            assert.equal(w2.pilot.target, far);
        });
    });
});

describe('the director', () => {
    const dirGame = () => {
        const g = arenaGame();
        const handlers = {};
        const emit = g.events.emit;
        g.events = { on(k, fn) { (handlers[k] = handlers[k] || []).push(fn); }, emit(k, a, b) { emit(k, a, b); (handlers[k] || []).forEach(fn => fn(a, b || {})); } };
        g.war = new W.War(g); g.war.start('war');
        g.war.radio = function (from, text) { (g.radioLog = g.radioLog || []).push(from + ': ' + text); };
        g.camera = { position: new THREE.Vector3(0, 3000, 0) };
        g.state = 'playing'; g.mode = 'war'; g.settings = { start: 'auto' };
        g.ground = stubGround(g);
        g.world = { weather: null, towns: null };
        g.player = { pos: new THREE.Vector3(0, 3000, 0), alive: true, team: 'blue', vel: new THREE.Vector3(), incoming: [], onGround: false };
        g.director = new D.Director(g);
        g.director.enabled = true; g.director.mode = 'war';
        return g;
    };

    test('flights are abstract far away, real jets near the player, and abstract again when he leaves', () => {
        seeded(21, () => {
            const g = dirGame(), d = g.director;
            const f = d.spawnFlight({ team: 'red', role: 'cap', types: ['mig29', 'su35'], pos: new THREE.Vector3(0, 4000, -60000), speed: 230,
                loiter: { center: new THREE.Vector3(0, 4000, -60000), R: 6000, until: 1e9 } });
            d.updateLOD();
            assert.equal(f.members, null, 'abstract at 60 km');
            assert.equal(g.aircraft.length, 0);
            g.player.pos.set(0, 3000, -45000);
            d.updateLOD();
            assert.ok(f.members && f.members.length === 2, 'two real jets at 15 km');
            assert.equal(g.aircraft.length, 2);
            assert.ok(f.members[0].pilot.leash > 0 && f.members[0].pilot.home, 'on a leash round their CAP station');
            f.members[1].health *= 0.5;
            g.player.pos.set(0, 3000, 20000);
            d.updateLOD();
            assert.equal(f.members, null, 'abstract again at 60+ km');
            assert.equal(g.aircraft.length, 0);
            assert.ok(Math.abs(f.hp[1] - 0.5) < 0.01, 'damage kept (' + f.hp[1] + ')');
        });
    });

    test("a raid nobody stops hits its target, and says so", () => {
        seeded(22, () => {
            const g = dirGame(), d = g.director;
            const u = g.ground.addTarget('radar', 3000, 3000, 0, 'blue');
            u.hp = u.maxHp = 140;
            g.war.add(u, { cls: 'radar', name: 'AN/TPS-75 RADAR' });
            let hit = null;
            g.events.on('raidHit', (f, { hit: h }) => { hit = h; });
            g.player.pos.set(0, 3000, 90000); // far away: all abstract
            const f = d.spawnFlight({ team: 'red', role: 'raid', types: ['su35', 'su35'], bombs: 4, pos: new THREE.Vector3(3000, 2500, -40000), speed: 220,
                route: [{ p: new THREE.Vector3(3000, 2500, -10000) }, { p: new THREE.Vector3(3000, 2500, 3000), attack: true }, { p: new THREE.Vector3(3000, 2500, 12000) }],
                target: { pos: u.pos, unit: u, label: 'THE RADAR', kind: 'unit' } });
            f.home = new THREE.Vector3(3000, 2500, -40000);
            for (let t = 0; t < 400 && !f.done; t += 0.5) { g.war.time += 0.5; g.time += 0.5; d.updateFlights(0.5); }
            assert.ok(f.hitReported, 'it got there');
            assert.ok(hit === true || hit === false);
            if (hit) assert.ok(u.hp < 140, 'the radar took damage');
            assert.ok(g.radioLog.some(l => /ENEMY RAID HIT THE RADAR/.test(l)) || !hit);
            assert.ok(f.done || f.state === 'rtb', 'then it went home');
        });
    });

    test('a raid the player watches: real jets fly over the target and bomb it', () => {
        seeded(24, () => {
            const g = dirGame(), d = g.director;
            // a radar of ours on the home airfield (flat), the player watching from 8 km
            const u = g.ground.addTarget('radar', 400, -300, 0, 'blue');
            u.hp = u.maxHp = 400;
            g.war.add(u, { cls: 'radar', name: 'AN/TPS-75 RADAR' });
            g.player.pos.set(0, 3000, 8000);
            const h = (x, z) => Math.max(world.terrainHeight(x, z), 0) + 1500;
            const f = d.spawnFlight({ team: 'red', role: 'raid', types: ['su35', 'su35'], bombs: 4, pos: new THREE.Vector3(400, h(400, -14000), -14000), speed: 210,
                route: [{ p: new THREE.Vector3(400, h(400, -300), -300), attack: true }, { p: new THREE.Vector3(400, h(400, 6000), 6000) }, { p: new THREE.Vector3(9000, 3000, 12000) }],
                target: { pos: u.pos, unit: u, label: 'THE RADAR', kind: 'unit' } });
            f.home = new THREE.Vector3(0, 3000, -40000);
            let drops = 0, nearest = Infinity;
            const emit = g.events.emit;
            g.events.emit = (k, a, b) => { if (k === 'bomb') drops++; emit(k, a, b); };
            for (let t = 0; t < 90; t += 1 / 30) {
                g.time += 1 / 30; g.war.time += 1 / 30;
                d.updateLOD(); g.step(1 / 30); d.updateFlights(1 / 30);
                const lead = f.lead();
                if (lead) nearest = Math.min(nearest, Math.hypot(lead.pos.x - u.pos.x, lead.pos.z - u.pos.z));
            }
            assert.ok(f.members || f.done, 'they became real jets near the player');
            assert.ok(nearest < 800, 'flew over the target (closest ' + Math.round(nearest) + ' m), not round it');
            assert.ok(drops >= 6, drops + ' bombs released');
            assert.ok(u.hp < 400, 'the radar was hit (' + Math.round(u.hp) + ' hp left)');
            assert.ok(f.hitReported);
        });
    });

    test('our fighters meeting their bombers out of sight: the bombers lose', () => {
        seeded(23, () => {
            const g = dirGame(), d = g.director;
            g.player.pos.set(0, 3000, 90000);
            const ours = d.spawnFlight({ team: 'blue', role: 'cap', types: ['f15', 'f16'], pos: new THREE.Vector3(0, 4000, -20000), speed: 230, callsign: 'COLT' });
            const theirs = d.spawnFlight({ team: 'red', role: 'raid', types: ['su35', 'su35'], pos: new THREE.Vector3(2000, 3000, -21000), speed: 210 });
            for (let k = 0; k < 40; k++) d.abstractCombat();
            assert.ok(theirs.n < 2, 'bombers left: ' + theirs.n);
            assert.equal(ours.n, 2, 'bombers do not shoot back');
            assert.ok(g.radioLog.some(l => /^COLT 1: (SPLASH ONE|FOX THREE, SPLASH|BANDIT DOWN)/.test(l)));
        });
    });
});

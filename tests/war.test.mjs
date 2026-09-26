import { src } from './helpers/setup.mjs';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// The war core (war.js) and strategic strikes (strikes.js) against a stub game: missiles have to fly real
// trajectories to their aim points, strikes have to find shooters, intel has to rise and never fall.
describe('war layer: intel, marks, strikes', () => {
    let THREE, W, S, world;
    const stubFx = () => ({
        now: 0, flashTex: null,
        fire: { emit() {} }, smoke: { emit() {} }, flame: { emit() {} },
        addTrail: () => ({ push() {}, emitting: true }), light() {}, sprite() {}, explosion() {}, smokeColumn() {}, waterSplash() {},
    });
    const game = () => {
        const cam = new THREE.PerspectiveCamera();
        cam.position.set(0, 3000, 0);
        const g = {
            time: 0, state: 'playing', callsign: 'TEST', score: 0,
            camera: cam, scene: new THREE.Scene(),
            world: { weather: 'clear', timeKey: 'day', towns: null, tiles: new Map(), TILE: 2048 },
            events: { emit() {}, on() {} }, audio: { say() {}, tick() {}, boom() {} },
            feed: [], addFeed(t) { this.feed.push(t); },
            surfaceAt: (x, z) => ({ h: Math.max(world.terrainHeight(x, z), 0) }),
            aircraft: [], ground: { targets: [] }, naval: { ships: [] }, player: null,
            effects: stubFx(),
            weapons: { addCrater() {}, worldBlast() {}, blastPeople() {}, missiles: [] },
            isNeutral: () => false, lockTarget: null,
        };
        g.war = new W.War(g);
        g.war.start('freeflight');
        return g;
    };
    // a ground unit the war can register
    const unit = (x, z, team = 'red', cls = 'radar', hp = 140) => {
        const y = Math.max(world.terrainHeight(x, z), 0);
        return { pos: new THREE.Vector3(x, y + 5, z), team, alive: true, name: cls.toUpperCase(), radius: 14, hp, maxHp: hp, isGround: true,
            damage(a) { this.hp -= a; if (this.hp <= 0) this.alive = false; } };
    };
    // fly every missile until nothing is left (or give up)
    const fly = (g, secs = 400) => { for (let t = 0; t < secs && (g.strikes.missiles.length || g.strikes.sources.some(s => s.queue.length)); t += 1 / 30) { g.time += 1 / 30; g.war.time += 1 / 30; g.strikes.update(1 / 30); } };

    before(async () => {
        THREE = await import('three');
        W = await src('war.js');
        S = await src('strikes.js');
        world = await src('world.js');
    });

    test('intel only rises, and friendly units are always known', () => {
        const g = game();
        const red = unit(5000, -5000), blue = unit(1000, 1000, 'blue');
        g.war.add(red); g.war.add(blue);
        assert.equal(g.war.known(blue), W.INTEL.CONFIRMED);
        assert.equal(g.war.known(red), W.INTEL.UNKNOWN);
        g.war.reveal(red, W.INTEL.IDENTIFIED, 'test');
        assert.equal(g.war.known(red), W.INTEL.IDENTIFIED);
        g.war.reveal(red, W.INTEL.CONTACT, 'test');
        assert.equal(g.war.known(red), W.INTEL.IDENTIFIED, 'a weaker report never lowers what we know');
        assert.equal(g.war.label(red), 'RADAR');
    });

    test('marking confirms a unit; grid references and territory make sense', () => {
        const g = game();
        const red = unit(7000, -16000);
        g.war.add(red);
        const d = g.war.designate(red, 'test');
        assert.equal(d.unit, red);
        assert.equal(g.war.known(red), W.INTEL.CONFIRMED);
        assert.equal(g.war.designate(red), d, 'marking twice returns the same mark');
        assert.match(g.war.grid(1234, -5678), /^[A-Z]{2} \d{3} \d{3}$/);
        assert.equal(g.war.sideAt(7000, -17000), 'red', 'the enemy airbase is in enemy territory');
        assert.equal(g.war.sideAt(0, 0), 'blue', 'the home base is ours');
        assert.equal(g.war.sideAt(-10000, -19100), 'blue', 'Miramar is ours');
    });

    test('a ballistic missile flies a real arc and lands on its aim point', () => {
        const g = game();
        g.strikes = new S.StrikeManager(g); g.strikes.enabled = true;
        const aim = new THREE.Vector3(18000, 0, -9000); aim.y = Math.max(world.terrainHeight(aim.x, aim.z), 0);
        let hit = null;
        g.strikes.impact = function (m) { hit = m.pos.clone(); m.remove(); this.missiles.splice(this.missiles.indexOf(m), 1); };
        const m = g.strikes.spawnMissile(S.MISSILES.atacms, 'blue', new THREE.Vector3(0, 30, 0), new THREE.Vector3(0, 1, 0), { pos: aim, unit: null, label: 'T' }, { name: 'SILO', host: null, pos: new THREE.Vector3() }, null);
        let apogee = 0;
        for (let t = 0; t < 300 && g.strikes.missiles.length; t += 1 / 30) { g.strikes.update(1 / 30); apogee = Math.max(apogee, m.pos.y); }
        assert.ok(hit, 'it came down');
        assert.ok(Math.hypot(hit.x - aim.x, hit.z - aim.z) < 60, 'within 60 m of the aim: ' + Math.round(Math.hypot(hit.x - aim.x, hit.z - aim.z)));
        assert.ok(apogee > 3500, 'a high arc (apogee ' + Math.round(apogee) + ' m)');
    });

    test('a cruise missile follows the terrain and hits a land target', () => {
        const g = game();
        g.strikes = new S.StrikeManager(g); g.strikes.enabled = true;
        const tgt = unit(9000, -12000);
        g.war.add(tgt);
        let hit = null, minAgl = Infinity;
        const imp = g.strikes.impact.bind(g.strikes);
        g.strikes.impact = function (m, water) { hit = m.pos.clone(); imp(m, water); };
        const m = g.strikes.spawnMissile(S.MISSILES.tlam, 'blue', new THREE.Vector3(-6000, 10, 3000), new THREE.Vector3(0, 1, 0), { pos: tgt.pos, unit: tgt, label: 'T' }, { name: 'DDG', host: null, pos: new THREE.Vector3() }, null);
        for (let t = 0; t < 400 && g.strikes.missiles.length; t += 1 / 30) {
            g.strikes.update(1 / 30);
            if (m.phase === 'cruise') minAgl = Math.min(minAgl, m.pos.y - Math.max(world.terrainHeight(m.pos.x, m.pos.z), 0));
        }
        assert.ok(hit, 'it arrived');
        assert.ok(hit.distanceTo(tgt.pos) < 25, 'on target: ' + Math.round(hit.distanceTo(tgt.pos)) + ' m');
        assert.ok(minAgl > 5, 'never flew into the ground (lowest ' + Math.round(minAgl) + ' m)');
        assert.ok(!tgt.alive, 'a radar does not survive a Tomahawk');
    });

    test('cruise missiles get over the central mountains on several routes', () => {
        const routes = [[[-6000, 3000], [9000, -12000]], [[-14000, -2000], [6000, -15000]], [[16000, -2000], [2000, -14000]], [[-2000, 8000], [8000, -9000]]];
        for (const [[sx, sz], [tx, tz]] of routes) {
            const g = game();
            g.strikes = new S.StrikeManager(g); g.strikes.enabled = true;
            const tgt = unit(tx, tz);
            g.war.add(tgt);
            let hit = null;
            g.strikes.impact = function (m) { hit = m.pos.clone(); m.remove(); this.missiles.splice(this.missiles.indexOf(m), 1); };
            g.strikes.spawnMissile(S.MISSILES.tlam, 'blue', new THREE.Vector3(sx, Math.max(world.terrainHeight(sx, sz), 0) + 5, sz), new THREE.Vector3(0, 1, 0), { pos: tgt.pos, unit: tgt, label: 'T' }, { name: 'L', host: null, pos: new THREE.Vector3() }, null);
            for (let t = 0; t < 400 && g.strikes.missiles.length; t += 1 / 30) g.strikes.update(1 / 30);
            assert.ok(hit && hit.distanceTo(tgt.pos) < 25, `route ${sx},${sz} → ${tx},${tz}: ` + (hit ? Math.round(hit.distanceTo(tgt.pos)) + ' m off' : 'no impact'));
        }
    });

    test('an anti-ship missile homes on a moving ship', () => {
        const g = game();
        g.strikes = new S.StrikeManager(g); g.strikes.enabled = true;
        const ship = { pos: new THREE.Vector3(24000, 10, -9000), vel: new THREE.Vector3(12, 0, 0), team: 'red', alive: true, isShip: true, name: 'DD', radius: 12, hp: 450, maxHp: 450,
            hitTest(p) { return Math.abs(p.x - this.pos.x) < 75 && Math.abs(p.z - this.pos.z) < 10 && p.y < 20; }, damage(a) { this.hp -= a; } };
        g.war.add(ship, { cls: 'ship' });
        let hit = null;
        g.strikes.impact = function (m) { hit = m.pos.clone(); m.remove(); this.missiles.splice(this.missiles.indexOf(m), 1); };
        g.strikes.spawnMissile(S.MISSILES.harpoon, 'blue', new THREE.Vector3(17000, 5, -2000), new THREE.Vector3(0, 1, 0), { pos: ship.pos, unit: ship, label: 'DD' }, { name: 'DDG', host: null, pos: new THREE.Vector3() }, null);
        for (let t = 0; t < 300 && g.strikes.missiles.length; t += 1 / 30) { ship.pos.addScaledVector(ship.vel, 1 / 30); g.strikes.update(1 / 30); }
        assert.ok(hit && ship.hitTest(hit), 'hit the hull');
    });

    test('a strike request finds the nearest shooter with the right missile and spends its stock', () => {
        const g = game();
        g.strikes = new S.StrikeManager(g); g.strikes.enabled = true;
        const near = new S.LaunchSource(g.strikes, { name: 'NEAR', team: 'blue', kind: 'silo', stock: { tlam: 2 } });
        near.at = new THREE.Vector3(1000, 20, 1000);
        const far = new S.LaunchSource(g.strikes, { name: 'FAR', team: 'blue', kind: 'silo', stock: { tlam: 8 } });
        far.at = new THREE.Vector3(-30000, 20, 30000);
        g.strikes.addSource(far); g.strikes.addSource(near);
        const tgt = unit(9000, -12000);
        g.war.add(tgt);
        const d = g.war.designate(tgt);
        const st = g.strikes.request('naval', [d]);
        assert.equal(st, null, 'a naval strike needs ships or subs, not silos');
        const st2 = g.strikes.request('multi', [d]);
        assert.ok(st2 && st2.planned === 1, 'one missile per mark');
        assert.equal(near.stock.tlam, 1, 'the nearest shooter fired');
        assert.equal(far.stock.tlam, 8);
    });

    test('rocket artillery ripple-fires a salvo onto the aim', () => {
        const g = game();
        g.strikes = new S.StrikeManager(g); g.strikes.enabled = true;
        const host = { pos: new THREE.Vector3(0, Math.max(world.terrainHeight(0, 0), 0), 0), team: 'blue', alive: true, name: 'HIMARS' };
        const L = new S.GroundLauncher(g.strikes, host, { kind: 'artillery', stock: { gmlrs: 1 } });
        g.strikes.addSource(L);
        // (a flat, low aim: on a mountainside the arcs would come down on the slope in front of it)
        let aim = null;
        for (let k = 0; k < 400 && !aim; k++) {
            const x = 3000 + (k % 20) * 400, z = -2000 - Math.floor(k / 20) * 400, h = world.terrainHeight(x, z);
            if (h > 5 && h < 150 && Math.abs(world.terrainHeight(x + 150, z) - h) < 8 && Math.abs(world.terrainHeight(x, z + 150) - h) < 8) aim = new THREE.Vector3(x, h, z);
        }
        const d = g.war.designate({ x: aim.x, z: aim.z });
        const falls = [];
        g.strikes.impact = function (m) { falls.push(m.pos.clone()); m.remove(); this.missiles.splice(this.missiles.indexOf(m), 1); };
        const st = g.strikes.request('rocket', [d]);
        assert.ok(st, 'the salvo was ordered');
        fly(g);
        assert.equal(falls.length, S.MISSILES.gmlrs.count, 'every rocket of the salvo landed');
        for (const p of falls) assert.ok(Math.hypot(p.x - aim.x, p.z - aim.z) < S.MISSILES.gmlrs.spread * 2.2, 'inside the salvo spread');
    });
});

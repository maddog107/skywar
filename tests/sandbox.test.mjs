import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { noop } from './helpers/arena.mjs';

// The sandbox toolkit (sandbox.js, sandboxdefs.js, sandboxunits.js) on stub games over the real terrain: where things
// may be placed, the side swap (war.setSide and the player's jet), missions through the director's real flights and
// the other plug-ins' APIs (recorded), a save that loads back to the same setup (and only ever writes its own key),
// and every scenario building and spawning without errors.
// (top-level await, not a root before() hook: see tests/README.md)
const THREE = await import('three');
const W = await src('war.js');
const D = await src('director.js');
const world = await src('world.js');
const config = await src('config.js');
const DEFS = await src('sandboxdefs.js');
const { SandboxTools } = await src('sandbox.js');

const env = (war) => ({ heightAt: world.terrainHeight, sideAt: (x, z) => war.sideAt(x, z), onRunway: (x, z) => !!world.isOnRunway(x, z), bases: world.BASES });
const bareWar = () => new W.War({ events: { emit() {}, on() {} }, audio: { tick() {} }, addFeed() {} });

// ── a stub game: a real War and Director, recording fakes for the other plug-ins ──
function stubGround(g) {
    return {
        targets: [],
        addTarget(type, x, z, rot, team) {
            const y = Math.max(world.terrainHeight(x, z), 0);
            const u = {
                type, team, alive: true, isGround: true, radius: 7, hp: 90, maxHp: 90, health: 90, maxHealth: 90, def: { score: 100, name: type }, name: type.toUpperCase(),
                pos: new THREE.Vector3(x, y + 3, z), vel: new THREE.Vector3(), mesh: { position: new THREE.Vector3(x, y, z), rotation: { y: rot, set() {} }, add() {} },
                damage(a, source) { if (!this.alive) return; this.hp -= a; this.health = this.hp; if (this.hp <= 0) { this.alive = false; g.events.emit('groundKilled', this, { source }); } },
                remove() { this.gone = true; },
            };
            this.targets.push(u);
            return u;
        },
    };
}
// a forces group as far as the sandbox cares (living, members, centre, orders recorded)
function fakeGroup(g, kind, team, pos, n = 3) {
    const members = [];
    for (let i = 0; i < n; i++) {
        const u = g.ground.addTarget('truck', pos.x + i * 30, pos.z, 0, team);
        members.push(u);
    }
    return {
        kind, team, members, done: false, state: 'ready', orders: [],
        get alive() { return members.some(v => v.alive); },
        living() { return members.filter(v => v.alive); },
        centre(out = new THREE.Vector3()) { out.set(0, 0, 0); for (const v of members) out.add(v.pos); return out.divideScalar(members.length); },
    };
}
function sandboxGame({ side = 'blue' } = {}) {
    const handlers = {}, log = { calls: [], storage: null };
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 60000, 250000); // (far from everything: flights stay abstract)
    const g = {
        time: 0, state: 'playing', mode: 'sandbox', callsign: 'TEST', score: 0,
        difficulty: config.DIFFICULTY.veteran, settings: { start: 'auto' },
        camera: cam, scene: new THREE.Scene(),
        world: { weather: 'clear', timeKey: 'day', towns: null, tiles: new Map(), TILE: 2048 },
        events: { on(k, fn) { (handlers[k] = handlers[k] || []).push(fn); }, emit(k, a, b) { (handlers[k] || []).forEach(fn => fn(a, b || {})); } },
        audio: { say() {}, tick() {}, boom() {}, uiConfirm() {} },
        feed: [], addFeed(t) { this.feed.push(t); }, showBanner(t) { log.banner = t; },
        aircraft: [], naval: { ships: [] }, player: null, pilotMode: null, navTarget: null, lockTarget: null,
        effects: noop(), weapons: noop(), systems: [], isNeutral: () => false,
        get side() { return this.war.side; },
        log,
    };
    g.ground = stubGround(g);
    g.war = new W.War(g);
    g.war.start('sandbox');
    g.director = new D.Director(g);
    g.director.start('sandbox');
    g.air = {
        enabled: true, flights: [],
        mk(role, team, at) { const f = { role, team, ac: { alive: true, pos: new THREE.Vector3(at.x, at.alt || at.y || 6000, at.z), vel: new THREE.Vector3() }, alt: 6000, setTrack(T) { this.task = { kind: 'track', T }; }, task: { kind: 'track' } }; this.flights.push(f); return f; },
        spawnAWACS(team, o) { log.calls.push(['spawnAWACS', team]); return this.mk('awacs', team, o); },
        spawnTanker(team, o) { log.calls.push(['spawnTanker', team]); return this.mk('tanker', team, o); },
        sendGrowler(w) { log.calls.push(['sendGrowler', w]); return this.growler || (this.growler = this.mk('ew', g.war.side, w.pos || w)); },
        sendRecon(kind, area) { log.calls.push(['sendRecon', kind, area]); return this.mk('recon', g.war.side, area); },
        taskRecon(f, area) { log.calls.push(['taskRecon', area]); },
        track(role, side, o) { return { role, side, ...o }; },
        removeFlight(f) { f.dead = true; },
    };
    g.navalops = {
        enabled: true, groups: [], decks: [],
        spawnGroup(side, c, o) {
            log.calls.push(['spawnGroup', side, o.composition.length]);
            const ships = o.composition.map(([type], i) => ({ type, team: side, alive: true, isShip: true, pos: new THREE.Vector3(c.x + i * 400, 0, c.z), vel: new THREE.Vector3(), remove() {}, strikeSource: { canFire: (k) => k === 'tlam' || k === 'harpoon' } }));
            const grp = { side, members: ships.map(s => ({ ship: s })), guide: ships[0], dest: null, order: 'cruise', get alive() { return ships.some(s => s.alive); } };
            this.groups.push(grp);
            return grp;
        },
        moveGroupOf(ship, p) { log.calls.push(['moveGroupOf', p.x, p.z]); const grp = this.groups.find(x => x.guide === ship); if (grp) grp.dest = { x: p.x, z: p.z }; return true; },
        launchFrom(ship, key, target, n) { log.calls.push(['launchFrom', key, n]); return { ok: true }; },
        deckOf() { return null; },
    };
    g.forces = {
        enabled: true, groups: [], units: [], fireOk: true,
        spawnTEL(team, p) { log.calls.push(['spawnTEL', team]); return fakeGroup(g, 'tel', team, p, 1); },
        spawnSAM(team, type, p) { log.calls.push(['spawnSAM', team, type]); return fakeGroup(g, 'sam', team, p, 4); },
        spawnArtillery(team, type, p) { log.calls.push(['spawnArtillery', team, type]); return fakeGroup(g, 'battery', team, p, 3); },
        spawnCoastal(team, p) { log.calls.push(['spawnCoastal', team]); return fakeGroup(g, 'coastal', team, p, 4); },
        spawnConvoy(team, from, to) {
            log.calls.push(['spawnConvoy', team]);
            const gr = fakeGroup(g, 'convoy', team, from, 6);
            gr.destPos = new THREE.Vector3(to.x, 0, to.z);
            gr.route = { len: 4000, at: (s) => ({ x: from.x + (to.x - from.x) * s / 4000, z: from.z + (to.z - from.z) * s / 4000, tx: 1, tz: 0 }) };
            return gr;
        },
        placeOf: (id) => { const b = world.BASES.find(x => x.id === id); return b ? { x: b.x + 600, z: b.z } : null; },
        convoyEnds: () => ({ from: { x: 7000, z: -17000 }, to: { x: 9000, z: -26000 } }),
        fireMission(gr, target) { log.calls.push(['fireMission', gr.kind]); return this.fireOk ? 2 : 0; },
        relocate(gr, to) { log.calls.push(['relocate', gr.kind, to && to.x]); return true; },
        removeVehicle(v) { v.removed = true; },
    };
    g.infantry = {
        soldiers: [],
        spawnSquad(o) { log.calls.push(['spawnSquad', o.team, o.n]); const sq = { team: o.team, members: [] }; for (let i = 0; i < o.n; i++) { const s = { team: o.team, alive: true, cls: 'infantry', pos: new THREE.Vector3(o.pos.x + i, 0, o.pos.z), state: 'idle' }; sq.members.push(s); this.soldiers.push(s); } return sq; },
        remove(s) { s.alive = false; },
    };
    g.weather = { wx: {}, kind: 'clear', hour: 13, timeScale: 1, auto: true, set(k) { this.kind = k; }, setTime(h) { this.hour = typeof h === 'number' ? h : 22; }, front() { return {}; } };
    g.tasks = { enabled: true, start() { this.enabled = true; }, clear() { this.enabled = false; }, offered: [], active: null };
    g.player = makePlayer(g);
    g.respawnPlayer = () => {
        const r = g.sandbox.respawnPoint();
        log.respawn = r;
        g.player = makePlayer(g);
        g.player.base = r && r.base;
    };
    g.sandbox = new SandboxTools(g);
    g.sandbox.start('sandbox');
    g.systems = [g.director, g.sandbox];
    if (side !== 'blue') g.sandbox.setFaction(side, { quiet: true });
    return g;
}
function makePlayer(g) {
    // (far out to sea: the director makes real jets only near the player, and this stub doesn't fly any)
    const p = { team: g.war.side, isPlayer: true, alive: true, root: { visible: true }, pos: new THREE.Vector3(0, 2000, 200000), vel: new THREE.Vector3(0, 0, -200), removed: false, remove() { this.removed = true; }, spawnAir(pos) { this.pos.copy(pos); } };
    g.aircraft.push(p);
    return p;
}
const step = (g, secs, dt = 1) => {
    for (let t = 0; t < secs; t += dt) {
        g.time += dt; g.war.time += dt;
        for (const s of g.systems) if (s.update) s.update(dt);
    }
};
// a storage that remembers everything (and whose owner's settings must come through untouched)
function memStorage(init = {}) {
    const m = new Map(Object.entries(init)), writes = [];
    return { writes, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { writes.push(k); m.set(k, String(v)); }, dump: () => Object.fromEntries(m) };
}

// spots on the real map the tests use: open sea, firm land on each side, a runway
const SEA = { x: 20000, z: -12000 }, RED_LAND = { x: 6000, z: -22000 }, BLUE_LAND = { x: 2000, z: -6000 };

describe('placement: where things may stand', () => {
    const E = env(bareWar());
    test('ships only on open water, ground units only on land, both with the reason', () => {
        assert.ok(world.terrainHeight(SEA.x, SEA.z) < -25 && world.terrainHeight(RED_LAND.x, RED_LAND.z) > 3, 'the test spots are sea and land');
        for (const item of ['csg', 'sag', 'ddg', 'sub']) {
            assert.equal(DEFS.validatePlacement(item, SEA.x, SEA.z, E).ok, true, item + ' at sea');
            const land = DEFS.validatePlacement(item, RED_LAND.x, RED_LAND.z, E);
            assert.equal(land.ok, false, item + ' on land');
            assert.equal(land.why, 'SHIPS NEED WATER');
        }
        for (const item of ['tel', 'sam', 'artillery', 'armour', 'infantry', 'radar', 'fob', 'convoy']) {
            assert.equal(DEFS.validatePlacement(item, RED_LAND.x, RED_LAND.z, E).ok, true, item + ' on land');
            const sea = DEFS.validatePlacement(item, SEA.x, SEA.z, E);
            assert.equal(sea.ok, false, item + ' at sea');
            assert.equal(sea.why, 'GROUND UNITS NEED LAND');
        }
    });
    test('a ship needs room: a narrow inlet or a pond is refused', () => {
        // somewhere just off a coast: deep enough under the click, land within the group's 1.5 km
        let found = null;
        for (let x = -30000; x < 30000 && !found; x += 400) for (let z = -40000; z < 20000 && !found; z += 400) {
            if (world.terrainHeight(x, z) < -30 && DEFS.validatePlacement('csg', x, z, E).why === 'NOT ENOUGH OPEN WATER') found = { x, z };
        }
        assert.ok(found, 'there are waters too tight for a carrier group');
    });
    test('runways, steep slopes and the shoreline are refused for ground units', () => {
        const home = world.BASES.find(b => b.id === 'home');
        let rw = null;
        for (let dx = -1500; dx <= 1500 && !rw; dx += 50) for (let dz = -1500; dz <= 1500 && !rw; dz += 50) if (world.isOnRunway(home.x + dx, home.z + dz)) rw = { x: home.x + dx, z: home.z + dz };
        assert.ok(rw, 'found the home runway');
        assert.equal(DEFS.validatePlacement('sam', rw.x, rw.z, E).why, 'ON A RUNWAY');
        const whys = new Set();
        for (let x = -40000; x < 40000; x += 700) for (let z = -50000; z < 30000; z += 700) { const v = DEFS.validatePlacement('armour', x, z, E); if (!v.ok) whys.add(v.why); }
        for (const w of ['TOO STEEP', 'ON THE SHORELINE', 'GROUND UNITS NEED LAND']) assert.ok(whys.has(w), 'somewhere is refused as ' + w);
    });
    test('a coastal battery must be within 3.5 km of the sea', () => {
        let inland = null, coast = null;
        for (let x = -40000; x < 40000 && !(inland && coast); x += 900) for (let z = -50000; z < 30000; z += 900) {
            if (!DEFS.validatePlacement('sam', x, z, E).ok) continue;
            const c = DEFS.validatePlacement('coastal', x, z, E);
            if (c.ok) coast = coast || { x, z }; else inland = inland || { x, z, why: c.why };
        }
        assert.ok(coast, 'a coastal spot exists');
        assert.ok(inland && /FROM THE SEA/.test(inland.why), 'an inland one is refused: ' + (inland && inland.why));
    });
    test('aircraft go anywhere at the altitude asked, lifted clear of the ground', () => {
        const peak = { x: 0, z: 0, h: -1 };
        for (let x = -30000; x < 30000; x += 1500) for (let z = -40000; z < 20000; z += 1500) { const h = world.terrainHeight(x, z); if (h > peak.h) Object.assign(peak, { x, z, h }); }
        const v = DEFS.validatePlacement('fighter', peak.x, peak.z, E, { alt: 100 });
        assert.equal(v.ok, true);
        assert.ok(v.y >= peak.h + 250, 'lifted over the peak (' + Math.round(peak.h) + ' m) to ' + Math.round(v.y));
        assert.equal(DEFS.validatePlacement('fighter', SEA.x, SEA.z, E, { alt: 6000 }).y, 6000);
        assert.equal(DEFS.validatePlacement('csg', 1e6, 0, E).ok, false, 'off the map');
    });
    test('findSpot finds the nearest place that fits, on the side asked for', () => {
        const p = DEFS.findSpot('sam', { x: 12000, z: -30000 }, E, { rMax: 12000, side: 'red' });
        assert.ok(p, 'a spot');
        assert.equal(DEFS.validatePlacement('sam', p.x, p.z, E).ok, true);
        assert.equal(bareWar().sideAt(p.x, p.z), 'red');
        const s = DEFS.findSpot('csg', RED_LAND, E, { rMax: 30000, step: 1000 });
        assert.ok(s && DEFS.validatePlacement('csg', s.x, s.z, E).ok, 'open water near a coast');
    });
    test('the sandbox refuses a bad click with the reason, and places a good one', () => {
        const g = sandboxGame(), sb = g.sandbox;
        assert.equal(sb.place('ddg', 'blue', RED_LAND.x, RED_LAND.z), null);
        assert.equal(sb.why, 'SHIPS NEED WATER');
        assert.equal(sb.place('growler', 'red', 0, 0), null, 'no red Growler');
        const rec = sb.place('ddg', 'blue', SEA.x, SEA.z);
        assert.ok(rec && sb.placed.includes(rec));
        assert.deepEqual(g.log.calls.find(c => c[0] === 'spawnGroup'), ['spawnGroup', 'blue', 2]);
    });
});

describe('the side swap', () => {
    test('war.setSide: the new side is ours, the old one falls back to pre-war intel, marks go', () => {
        const g = sandboxGame(), war = g.war;
        const red = g.ground.addTarget('truck', RED_LAND.x, RED_LAND.z, 0, 'red'); war.add(red, { cls: 'vehicle' });
        const blue = g.ground.addTarget('truck', BLUE_LAND.x, BLUE_LAND.z, 0, 'blue'); war.add(blue, { cls: 'vehicle' });
        const hq = g.ground.addTarget('bunker', BLUE_LAND.x + 400, BLUE_LAND.z, 0, 'blue'); war.add(hq, { cls: 'command' });
        war.designate(red);
        let told = null; g.events.on('warSide', (s) => { told = s; });
        assert.equal(war.known(red), W.INTEL.CONFIRMED, 'marked');
        war.setSide('red');
        assert.equal(told, 'red');
        assert.equal(war.side, 'red'); assert.equal(war.enemyTeam, 'blue');
        assert.equal(war.known(red), W.INTEL.CONFIRMED, 'our own now');
        assert.equal(war.known(blue), W.INTEL.UNKNOWN, 'a blue truck has to be found');
        assert.equal(war.known(hq), W.INTEL.IDENTIFIED, 'a fixed installation is on pre-war imagery');
        assert.equal(war.designations.length, 0);
        assert.equal(war.label(blue), 'UNKNOWN VEHICLE');
        war.clear();
        assert.equal(war.side, 'blue', 'every sortie starts on our side');
    });
    test('flying for red: a red jet on the red airfield, the background war off, blue back again', () => {
        const g = sandboxGame(), sb = g.sandbox, old = g.player;
        assert.equal(sb.setFaction('red', { quiet: true }), true);
        assert.equal(g.war.side, 'red');
        assert.ok(old.removed && !g.aircraft.includes(old), 'the blue jet is gone');
        assert.equal(g.player.team, 'red');
        assert.equal(g.log.respawn.where, 'runway');
        assert.equal(g.log.respawn.base.id, 'enemy', 'on the red field');
        assert.equal(sb.background, false);
        assert.equal(g.director.auto, false, 'no GCI, raids or tasks aimed at a red player');
        assert.equal(g.tasks.enabled, false);
        sb.setBackground(true, { quiet: true });
        assert.equal(sb.background, false, 'the background war needs the player on blue');
        assert.equal(sb.pal.team, 'red', 'the palette places for our side first');
        sb.setFaction('blue', { quiet: true });
        assert.equal(g.player.team, 'blue');
        assert.equal(sb.respawnPoint(), null, 'blue: the game picks its own start');
        sb.setBackground(true, { quiet: true });
        assert.equal(g.director.auto, true);
    });
});

describe('missions', () => {
    test('a fighter flight is a director flight on CAP where it was placed, and patrols a drawn route', () => {
        const g = sandboxGame(), sb = g.sandbox, d = g.director;
        const rec = sb.place('fighter', 'blue', 0, -8000, { alt: 5000 });
        const f = rec.handle;
        assert.ok(d.flights.includes(f) && f.sandbox === rec);
        assert.equal(f.role, 'cap'); assert.equal(f.team, 'blue'); assert.equal(f.types.length, 2);
        assert.ok(Math.hypot(f.loiter.center.x, f.loiter.center.z + 8000) < 1, 'its CAP point is where it was put');
        const route = [{ x: 0, z: -14000 }, { x: 8000, z: -18000 }, { x: 9000, z: -8000 }];
        assert.equal(sb.assign(rec, { type: 'patrol', route }, { quiet: true }), true);
        assert.equal(rec.mission.type, 'patrol');
        assert.ok(Math.hypot(f.loiter.center.x - route[0].x, f.loiter.center.z - route[0].z) < 1);
        const legs = new Set();
        for (let t = 0; t < 900; t += 1) { step(g, 1); legs.add(rec.leg || 0); }
        assert.ok(legs.size >= 3, 'the CAP point walks the route: legs ' + [...legs].join(','));
        assert.equal(f.state, 'out', 'still on the job, not home');
    });
    test('a bomber patrol flies its route round and round', () => {
        const g = sandboxGame(), sb = g.sandbox;
        // (a route well back on our side, the background war off: along the front at z −12 km the red CAPs shot the
        // bombers down in about one run in eight, and the test failed for it)
        sb.setBackground(false, { quiet: true });
        const rec = sb.place('bomber', 'blue', 0, 20000, { alt: 9000 });
        sb.assign(rec, { type: 'patrol', route: [{ x: 0, z: 14000 }, { x: 10000, z: 14000 }] }, { quiet: true });
        const f = rec.handle;
        assert.equal(f.loop, true);
        let wrapped = false, last = f.wp;
        for (let t = 0; t < 900; t++) { step(g, 1); if (f.wp < last) wrapped = true; last = f.wp; }
        assert.ok(wrapped, 'back to the first point');
        assert.notEqual(f.state, 'rtb');
    });
    test('strike, SEAD, escort, recon and RTB set the director\'s roles and targets', () => {
        const g = sandboxGame(), sb = g.sandbox, war = g.war;
        const sam = sb.place('sam', 'red', RED_LAND.x, RED_LAND.z);
        const truck = g.ground.addTarget('truck', RED_LAND.x + 900, RED_LAND.z, 0, 'red'); war.add(truck, { cls: 'vehicle' });
        for (const u of sam.handle.members) war.rec(u) ? (war.rec(u).cls = 'sam') : war.add(u, { cls: 'sam' });
        // attack jets on a ground unit: guns and rockets (cas)
        const a = sb.place('attack', 'blue', 0, -6000);
        assert.equal(sb.assign(a, { type: 'strike', target: { rec: sam } }, { quiet: true }), true);
        assert.equal(a.handle.role, 'cas');
        assert.ok(a.handle.target && a.handle.target.unit === sam.handle.members[0]);
        // bombers: in over an initial point, bombs on the target, out
        const b = sb.place('bomber', 'blue', 0, -2000);
        sb.assign(b, { type: 'strike', target: { unit: truck } }, { quiet: true });
        assert.equal(b.handle.role, 'strike');
        assert.ok(b.handle.route.some(r => r.attack) && b.handle.bombs.every(n => n === 8));
        // SEAD goes for the air defences before the truck next to them
        const s = sb.place('fighter', 'blue', 0, -7000);
        sb.assign(s, { type: 'sead', at: { x: RED_LAND.x + 900, z: RED_LAND.z } }, { quiet: true });
        assert.equal(s.handle.role, 'cas');
        const pick = s.handle.pick({ ac: { team: 'blue', pos: new THREE.Vector3(0, 3000, -7000) } });
        assert.ok(sam.handle.members.includes(pick), 'a SAM vehicle, not the truck');
        // escort another placed flight
        const e = sb.place('fighter', 'blue', 500, -6500);
        sb.assign(e, { type: 'escort', target: { rec: a } }, { quiet: true });
        assert.equal(e.handle.role, 'escort'); assert.equal(e.handle.escortOf, a.handle);
        assert.equal(typeof sb.assign(e, { type: 'escort', target: { rec: e } }, { quiet: true }), 'string', 'not itself');
        // recon: a loop over the area, and what's under it is seen
        const r = sb.place('fighter', 'blue', RED_LAND.x, RED_LAND.z + 1000);
        sb.assign(r, { type: 'recon', at: RED_LAND }, { quiet: true });
        assert.equal(r.handle.role, 'recon'); assert.equal(r.handle.loop, true); assert.equal(r.handle.route.length, 4);
        step(g, 2);
        assert.ok(war.known(truck) >= W.INTEL.IDENTIFIED, 'the recon flight saw the truck');
        // home
        sb.assign(a, { type: 'rtb' }, { quiet: true });
        assert.equal(a.handle.state, 'rtb');
        // what an item can't do
        const aw = sb.place('awacs', 'blue', 0, 8000);
        assert.match(sb.assign(aw, { type: 'strike', at: RED_LAND }, { quiet: true }), /ISN'T FOR/);
        assert.equal(sb.assign(aw, { type: 'cap', at: { x: 1000, z: 9000 } }, { quiet: true }), true);
        assert.equal(aw.handle.task.kind, 'track');
    });
    test('ships, ground forces, convoys, armour and infantry take their orders through their APIs', () => {
        const g = sandboxGame(), sb = g.sandbox, calls = g.log.calls;
        const grp = sb.place('ddg', 'blue', SEA.x, SEA.z);
        const route = [{ x: SEA.x + 5000, z: SEA.z }, { x: SEA.x + 5000, z: SEA.z - 6000 }];
        sb.assign(grp, { type: 'patrol', route }, { quiet: true });
        assert.deepEqual(calls.at(-1), ['moveGroupOf', route[0].x, route[0].z]);
        grp.handle.dest = null; // (arrived)
        step(g, 1);
        assert.deepEqual(calls.filter(c => c[0] === 'moveGroupOf').at(-1), ['moveGroupOf', route[1].x, route[1].z], 'on to the next point');
        const sam = sb.place('sam', 'red', RED_LAND.x, RED_LAND.z);
        assert.equal(sb.assign(grp, { type: 'strike', target: { rec: sam } }, { quiet: true }), true);
        assert.deepEqual(calls.at(-1), ['launchFrom', 'tlam', 2], 'land attack at a land target');
        // a TEL that's busy: the order is asked again until it's taken
        const tp = DEFS.findSpot('tel', { x: RED_LAND.x + 2000, z: RED_LAND.z }, env(g.war), { rMax: 4000 });
        const tel = sb.place('tel', 'red', tp.x, tp.z);
        g.forces.fireOk = false;
        sb.assign(tel, { type: 'strike', at: { x: 0, z: 0 } }, { quiet: true });
        const n0 = calls.filter(c => c[0] === 'fireMission').length;
        step(g, 7);
        assert.ok(calls.filter(c => c[0] === 'fireMission').length > n0, 'asked again');
        g.forces.fireOk = true;
        sb.assign(sam, { type: 'move', at: { x: RED_LAND.x + 3000, z: RED_LAND.z } }, { quiet: true });
        assert.deepEqual(calls.at(-1), ['relocate', 'sam', RED_LAND.x + 3000]);
        assert.match(sb.assign(sam, { type: 'strike', at: { x: 0, z: 0 } }, { quiet: true }), /ISN'T FOR/);
        // armour drives to where it's sent
        const arm = sb.place('armour', 'blue', BLUE_LAND.x, BLUE_LAND.z, { n: 4 });
        assert.equal(sb.unitsOf(arm).length, 4);
        const to = { x: BLUE_LAND.x + 300, z: BLUE_LAND.z - 300 };
        sb.assign(arm, { type: 'move', at: to }, { quiet: true });
        const c0 = sb.posOf(arm, new THREE.Vector3()).clone();
        step(g, 20, 0.5);
        const c1 = sb.posOf(arm, new THREE.Vector3());
        assert.ok(Math.hypot(c1.x - to.x, c1.z - to.z) < Math.hypot(c0.x - to.x, c0.z - to.z) - 40, 'closer to where it was sent');
        // infantry walk a patrol
        const ip = DEFS.findSpot('infantry', { x: BLUE_LAND.x - 200, z: BLUE_LAND.z }, env(g.war), { rMax: 3000, step: 100 });
        const sq = sb.place('infantry', 'blue', ip.x, ip.z);
        sb.assign(sq, { type: 'patrol', route: [{ x: BLUE_LAND.x - 200, z: BLUE_LAND.z - 100 }, { x: BLUE_LAND.x - 300, z: BLUE_LAND.z }] }, { quiet: true });
        assert.ok(sq.handle.members.every(s => s.route && s.route.length === 2 && s.kind === 'patrol'));
    });
    test('deleting a unit takes it away and clears orders that pointed at it', () => {
        const g = sandboxGame(), sb = g.sandbox;
        const sam = sb.place('sam', 'red', RED_LAND.x, RED_LAND.z);
        const a = sb.place('attack', 'blue', 0, -6000);
        sb.assign(a, { type: 'strike', target: { rec: sam } }, { quiet: true });
        const f = sb.place('fighter', 'blue', 0, -9000);
        sb.remove(sam);
        assert.ok(!sb.placed.includes(sam) && sam.handle.members.every(v => v.removed));
        assert.equal(a.mission.target, null);
        sb.remove(f);
        assert.ok(!g.director.flights.includes(f.handle), 'the flight is gone from the director');
    });
});

describe('save and load', () => {
    test('a setup saved and loaded again is the same setup (units, sides, orders, targets)', () => {
        const g = sandboxGame(), sb = g.sandbox;
        const sam = sb.place('sam', 'red', RED_LAND.x, RED_LAND.z, { variant: 1 });
        const f = sb.place('fighter', 'blue', 0, -8000, { n: 4, alt: 7000, variant: 3 });
        sb.assign(f, { type: 'patrol', route: [{ x: 0, z: -14000 }, { x: 8000, z: -18000 }] }, { quiet: true });
        const a = sb.place('attack', 'blue', 1000, -7000);
        sb.assign(a, { type: 'strike', target: { rec: sam } }, { quiet: true });
        sb.place('ddg', 'red', SEA.x, SEA.z);
        sb.place('armour', 'blue', BLUE_LAND.x, BLUE_LAND.z, { n: 6 });
        g.weather.set('storm'); g.weather.hour = 21;
        const s1 = sb.snapshot('TEST');
        const json = JSON.parse(JSON.stringify(s1));
        const g2 = sandboxGame(), sb2 = g2.sandbox;
        const res = sb2.apply(json, { quiet: true });
        assert.equal(res.ok, true); assert.deepEqual(res.failed, []);
        assert.equal(res.placed, 5);
        const s2 = sb2.snapshot('TEST');
        const shape = (s) => s.units.map(u => [u.item, u.team, u.variant, u.n, u.mission ? u.mission.type : null, u.mission && u.mission.target ? JSON.stringify(u.mission.target) : null, u.mission && u.mission.route ? u.mission.route.length : 0]);
        assert.deepEqual(shape(s2), shape(s1));
        assert.equal(g2.weather.kind, 'storm'); assert.equal(g2.weather.hour, 21);
        const b = sb2.placed[2];
        assert.equal(b.mission.target.rec, sb2.placed[0], 'the strike points at the loaded SAM');
        assert.equal(sb2.placed[1].handle.types.length, 4);
    });
    test('slots live under skywar.sandbox only, and survive a reload', () => {
        const g = sandboxGame(), sb = g.sandbox;
        const store = memStorage({ 'skywar.settings': '{"quality":"high"}', 'skywar.best': '{"dogfight":900}' });
        Object.defineProperty(sb, 'storage', { get: () => store });
        sb.store = null;
        sb.place('fighter', 'red', 5000, -20000);
        assert.equal(sb.saveSlot(1), true);
        assert.deepEqual([...new Set(store.writes)], ['skywar.sandbox'], 'nothing else written');
        assert.equal(store.getItem('skywar.settings'), '{"quality":"high"}');
        assert.equal(store.getItem('skywar.best'), '{"dogfight":900}');
        const back = DEFS.readStore(store);
        assert.equal(back.slots[0], null);
        assert.equal(back.slots[1].units.length, 1);
        sb.removeAll();
        const res = sb.loadSlot(1);
        assert.equal(res.placed, 1);
        assert.equal(sb.placed[0].team, 'red');
        sb.clearSlot(1);
        assert.equal(DEFS.readStore(store).slots[1], null);
    });
    test('rubbish in storage is ignored, not trusted', () => {
        assert.equal(DEFS.normalizeSetup({ v: 99, units: [] }), null);
        assert.equal(DEFS.normalizeSetup('nope'), null);
        const s = DEFS.normalizeSetup({ v: DEFS.FORMAT, faction: 'green', units: [{ item: 'deathstar', x: 0, z: 0 }, { item: 'fighter', team: 'purple', x: 'a', z: 5, n: 99, mission: { type: 'strike', target: { ref: 50 } } }] });
        assert.equal(s.faction, 'blue');
        assert.equal(s.units.length, 1);
        assert.equal(s.units[0].team, 'blue'); assert.equal(s.units[0].x, 0); assert.equal(s.units[0].n, 8);
        assert.equal(s.units[0].mission.target, undefined, 'a reference to nothing is dropped');
        const bad = memStorage({ 'skywar.sandbox': '{not json' });
        assert.deepEqual(DEFS.readStore(bad).slots, [null, null, null]);
    });
});

describe('scenarios', () => {
    const E = env(bareWar());
    for (const p of DEFS.PRESETS) {
        test(p.label + ': builds on the real terrain, and every unit spawns with its orders', () => {
            const setup = DEFS.normalizeSetup(p.build(E));
            assert.ok(setup && setup.units.length >= 4, 'a setup');
            for (const u of setup.units) {
                if (u.near) continue; // (placed beside another unit at load time)
                const v = DEFS.validatePlacement(u.item, u.x, u.z, E, { alt: u.alt });
                assert.equal(v.ok, true, u.item + ' at ' + u.x + ',' + u.z + ': ' + v.why);
            }
            const g = sandboxGame(), sb = g.sandbox;
            const res = sb.apply(setup, { quiet: true });
            assert.equal(res.ok, true);
            assert.deepEqual(res.failed, [], 'nothing failed');
            assert.equal(res.placed, setup.units.length);
            const ordered = setup.units.filter(u => u.mission).length;
            assert.equal(sb.placed.filter(r => r.mission).length, ordered, 'every order taken');
            assert.equal(g.war.side, setup.faction);
            assert.equal(g.weather.kind, setup.weather);
            if (setup.view) assert.ok(sb.spec.on && sb.spec.target && sb.spec.target.rec === res.recs[setup.view.follow], 'watching the unit it says');
            step(g, 30);
            sb.spec.stop();
        });
    }
});

describe('the sim clock and the spectator', () => {
    test('the clock only takes 0, 1, 2, 4; watching holds the jet and lets it go again', () => {
        const g = sandboxGame(), sb = g.sandbox;
        sb.setSimSpeed(4); assert.equal(g.simSpeed, 4);
        sb.setSimSpeed(3); assert.equal(g.simSpeed, 1);
        sb.stepSimSpeed(-1); assert.equal(g.simSpeed, 0);
        sb.stepSimSpeed(-1); assert.equal(g.simSpeed, 0);
        const rec = sb.place('fighter', 'red', 5000, -20000);
        assert.equal(sb.spectate({ rec }), true);
        assert.equal(g.spectating, true);
        assert.equal(g.player.held, true); assert.equal(g.player.abandoned, true, 'the AI leaves it alone');
        const cam = g.camera;
        g.input = { down: () => false };
        g.camGround = (x, z) => world.terrainHeight(x, z);
        sb.updateCamera(cam, 1 / 60, { dx: 0, dy: 0, wheel: 0 });
        assert.ok(cam.position.distanceTo(rec.handle.pos) < 400, 'the camera is with the flight');
        assert.ok(g.viewFocus && g.viewFocus.distanceTo(cam.position) < 1, 'the war comes alive where it looks');
        const n = sb.nextFollow(1);
        assert.ok(n, 'something else to watch');
        sb.spec.stop();
        assert.equal(g.spectating, false);
        assert.equal(g.player.held, false); assert.equal(g.player.abandoned, false);
        assert.equal(g.viewFocus, null);
        sb.clear();
        assert.equal(g.simSpeed, 1, 'another mode starts on the normal clock');
    });
});

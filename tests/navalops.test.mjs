// Naval operations (src/navalops.js, src/launchseq.js, src/deckops.js) headless: the Mk 41 launch timeline on a rig
// (hatch, ignition, the missile out of the cell, uptake, hatch closing, the cell marked empty), a cold-launch revolver,
// a submarine capsule breaking the surface before its booster lights; the catapult cycle's state machine; threat
// evaluation and weapon assignment (most urgent first, the outer layer only beyond the medium one, salvos of two at
// missiles); a carrier group keeping its formation through a turn and a zig-zag (real ship models and helm); an AI jet
// up the elevator, taxied to a catapult and launched off it (a real Aircraft on the real carrier deck); an
// interceptor killing an incoming anti-ship missile.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const N = await src('naval.js');
const L = await src('launchseq.js');
const D = await src('deckops.js');
const O = await src('navalops.js');
const { War } = await src('war.js');
const { StrikeManager, MISSILES } = await src('strikes.js');
const { terrainHeight } = await src('world.js');
globalThis.__aircraftMod = await src('aircraft.js');
const repo = fileURLToPath(new URL('../', import.meta.url));

// ── helpers ──
function stripTextures(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
    delete json.images; delete json.textures; delete json.samplers;
    for (const m of json.materials || []) {
        const pbr = m.pbrMetallicRoughness || {};
        delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture;
        delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
    }
    const js = new TextEncoder().encode(JSON.stringify(json));
    const pad = (4 - (js.length % 4)) % 4;
    const rest = buf.subarray(20 + jsonLen);
    const out = new Uint8Array(20 + js.length + pad + rest.length);
    const o = new DataView(out.buffer);
    o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.length, true);
    o.setUint32(12, js.length + pad, true); o.setUint32(16, 0x4e4f534a, true);
    out.set(js, 20); out.fill(0x20, 20 + js.length, 20 + js.length + pad);
    out.set(rest, 20 + js.length + pad);
    return out.buffer;
}
const parse = (ab) => new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
for (const t of ['carrier', 'destroyer', 'cruiser', 'supply', 'ssn', 'slava']) N.setShipModel(t, await parse(stripTextures(readFileSync(repo + N.SHIP_MODEL_FILES[t]))));
D.setDeckCrewModel(await parse(stripTextures(readFileSync(repo + 'models/ships/deckcrew.glb'))));

// a no-op for anything (effects, audio): every property is a callable no-op
function noop() {
    const fn = () => p;
    const p = new Proxy(fn, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : p), set: () => true, apply: () => p });
    return p;
}
function navalGame(mode = 'naval') {
    const game = {
        scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1.6, 1, 2e5), time: 0, mode,
        events: { on() {}, emit() {} }, settings: { fuel: false }, audio: noop(), effects: noop(), wreckage: noop(),
        world: { timeKey: 'day', weather: 'clear' }, wind: new THREE.Vector3(3, 0, -2),
        aircraft: [], weapons: { missiles: [], flares: [], removeMissile(i) { this.missiles.splice(i, 1); } },
        difficulty: { skill: 0.6, dmgTaken: 1 }, ground: { targets: [] }, addFeed() {}, player: null,
        surfaceAt(x, z, y = 1e9) { const d = this.naval.deckAt(x, z, y); return d || { h: 0, water: true, runway: null, ship: null, hull: false }; },
    };
    game.naval = new N.Naval(game);
    game.war = new War(game);
    game.strikes = new StrikeManager(game); game.strikes.enabled = true;
    game.navalops = new O.NavalOps(game);
    game.navalops.enabled = true; game.navalops.mode = mode;
    return game;
}
// deep water with room for a group (deterministic: the first spot on a grid)
function openSea(r = 7000) {
    for (let x = -60000; x <= 60000; x += 4000) for (let z = -60000; z <= 60000; z += 4000) if (O.openWater(x, z, r)) return { x, z };
    return null;
}

// ═════════════ Launch sequences ═════════════
describe('launch sequences (launchseq.js)', () => {
    // a ship with a few Mk 41 cells: doors and an uptake per module, like the destroyer's rig
    function fakeShip(n = 8, opts = {}) {
        const cells = [];
        for (let i = 0; i < n; i++) cells.push({ name: 'cell_' + (i + 1), spec: { depth: opts.depth ?? 7.7 }, door: { name: opts.sharedDoor ? 'vls_17' : 'vls_' + (i + 1) }, uptake: opts.noUptake ? null : { name: 'uptake_' + (1 + (i >> 3)) } });
        return { pos: new THREE.Vector3(), vel: new THREE.Vector3(), def: { cls: opts.sub ? 'sub' : 'ship' }, rig: { cells, points: {}, nodes: {} } };
    }
    function run(key, lc, T = 14, dt = 1 / 120) {
        const log = { poses: {}, first: {}, t: 0 };
        let missile = null;
        const seq = lc.fire(key, (phase) => (missile = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), phase, start: log.t }));
        assert.ok(seq, 'fired');
        const mark = (k) => { if (log.first[k] == null) log.first[k] = log.t; };
        for (; log.t < T; log.t += dt) {
            lc.update(dt);
            const door = seq.tube.door, up = seq.tube.uptake;
            if (door && lc.doorK(door) >= 1) mark('doorOpen');
            if (up && lc.doorK(up) >= 1) mark('uptakeOpen');
            if (missile) { mark('ignite'); if (!missile.phase.done) missile.phase.step(missile, dt); if (missile.phase.cleared) { mark('clear'); log.clearY ??= missile.pos.y; } }
            if (log.first.clear != null && door && lc.doorK(door) < 1) mark('closing');
            if (log.first.closing != null && door && lc.doorK(door) <= 0) mark('closed');
            if (seq.tube.state === 'empty') mark('empty');
        }
        return { log, seq, missile };
    }

    test('Mk 41 Tomahawk: hatch open in 1 s, motor lights, it climbs out slowly on its booster, the uptake vents, the hatch closes after', () => {
        const ship = fakeShip(8);
        const lc = new L.LaunchControl(ship, { magazine: L.buildMagazine(ship, { cells: [['tlam', 2], ['sm2', 6]] }), frame: (t, p, d) => { p.set(0, 10, 0); d.set(0, 1, 0); return true; }, exhaustAt: (t, out) => (out.set(0.5, 10, 0), true) });
        assert.equal(lc.count('tlam'), 2);
        const { log, seq, missile } = run('tlam', lc);
        const want = L.vlsTimeline('tlam', 7.7);
        const f = log.first;
        console.log('    tlam timeline (s): door open', f.doorOpen.toFixed(2), 'ignite', f.ignite.toFixed(2), 'clear', f.clear.toFixed(2), 'hatch closing', f.closing.toFixed(2), 'closed', f.closed.toFixed(2), '(expected', JSON.stringify(Object.fromEntries(Object.entries(want).map(([k, v]) => [k, +v.toFixed(2)]))) + ')');
        assert.ok(Math.abs(f.doorOpen - want.open) < 0.05, 'hatch fully open at ~1 s');
        assert.ok(f.ignite > f.doorOpen && Math.abs(f.ignite - want.ignite) < 0.05, 'the motor lights just after the hatch is open');
        assert.ok(f.uptakeOpen >= f.ignite && f.uptakeOpen - f.ignite < 0.3, 'the uptake blows open at ignition');
        assert.ok(Math.abs(f.clear - want.clear) < 0.06, 'out of the cell when the booster has pushed it 7.7 m');
        assert.ok(f.clear - f.ignite > 1, 'a Tomahawk climbs out slowly (Mk 106: ~1.3 s in the cell)');
        assert.ok(Math.abs(log.clearY - (10 + MISSILES.tlam.len / 2)) < 0.3, 'its tail at the cell mouth when it clears: ' + log.clearY.toFixed(2));
        assert.ok(missile.vel.y > 10 && Math.abs(missile.vel.x) < 1e-6, 'rising straight up out of the cell');
        assert.ok(Math.abs(f.closing - (f.clear + L.TIMING.mk41.closeDelay)) < 0.1, 'the hatch starts closing 4 s after the missile is out');
        assert.ok(Math.abs(f.closed - f.closing - L.TIMING.mk41.close) < 0.1, 'and is shut 1.6 s later');
        assert.ok(f.empty > f.clear, 'the cell is marked empty once the plenum has vented');
        assert.equal(seq.tube.state, 'empty');
        assert.equal(lc.count('tlam'), 1);
        assert.deepEqual(lc.emptyCells(), [seq.tube.ref]);
    });

    test('an SM-2 leaves its cell in a fraction of a second; a quad-packed ESSM cell fires four and only then is empty', () => {
        const ship = fakeShip(8);
        const lc = new L.LaunchControl(ship, { magazine: L.buildMagazine(ship, { cells: [['sm2', 4], ['essm', 1, 4]] }), frame: (t, p, d) => { p.set(0, 10, 0); d.set(0, 1, 0); return true; } });
        const { log } = run('sm2', lc, 4);
        assert.ok(log.first.clear - log.first.ignite < 0.35, 'SM-2 out in ' + (log.first.clear - log.first.ignite).toFixed(2) + ' s');
        assert.equal(lc.count('essm'), 4);
        const cells = new Set();
        for (let k = 0; k < 4; k++) { const r = run('essm', lc, 3); cells.add(r.seq.tube.ref); assert.equal(r.seq.tube.state, k < 3 ? 'ready' : 'empty'); }
        assert.equal(cells.size, 1, 'all four from the one cell');
        assert.equal(lc.count('essm'), 0);
    });

    test('a cold-launch revolver: thrown out of the hatch, lit in the air, the next round only after the revolver turns', () => {
        const ship = fakeShip(8, { sharedDoor: true, noUptake: true });
        const lc = new L.LaunchControl(ship, { magazine: L.buildMagazine(ship, { ranges: [['s300f', 1, 8]] }), frame: (t, p, d) => { p.set(0, 5, 0); d.set(0, 1, 0); return true; } });
        let lit = null, missile = null;
        const seq = lc.fire('s300f', (phase) => (missile = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), phase }));
        assert.equal(seq.tube.mode, 'cold');
        assert.equal(lc.fire('s300f', () => null), null, 'the revolver is busy: no second round at once');
        let t = 0;
        for (; t < 6; t += 1 / 120) {
            lc.update(1 / 120);
            if (missile && !missile.phase.done) { missile.phase.step(missile, 1 / 120); if (missile.phase.lit && lit == null) lit = { t, y: missile.pos.y }; }
        }
        assert.ok(lit, 'the motor lit');
        assert.ok(lit.y > 5 + 7 && lit.y < 5 + 40, 'in the air above the hatch: ' + lit.y.toFixed(1) + ' m');
        assert.ok(lc.fire('s300f', () => null), 'the next round once the revolver has turned');
    });

    test('a submarine capsule rises from the tube, breaks the surface, and the booster lights above the water', () => {
        let broach = null, ignite = null;
        const m = { pos: new THREE.Vector3(), vel: new THREE.Vector3() };
        const ph = new L.LaunchPhase({ key: 'tlam', mode: 'capsule', frame: (p, d) => { p.set(0, -14, 0); d.set(0, 1, 0); }, onBroach: (p) => { broach = { y: m.pos.y, t: ph.t }; }, onIgnite: () => { ignite = { y: m.pos.y, t: ph.t }; } });
        let t = 0;
        while (ph.step(m, 1 / 120) && t < 20) t += 1 / 120;
        assert.ok(broach && ignite, 'broached and lit');
        assert.ok(!ph.lit || ignite, 'no booster flame while it rises in the water');
        assert.ok(ignite.t > broach.t, 'the booster lights after the capsule breaks the surface');
        assert.ok(ignite.y - MISSILES.tlam.len / 2 > 0, 'its bottom clear of the water when it lights (' + ignite.y.toFixed(1) + ' m)');
        assert.ok(ignite.y < 20, 'just above the surface');
        assert.ok(m.vel.y > 5, 'still going up');
        console.log('    capsule: broached at', broach.t.toFixed(2), 's, booster lit at', ignite.t.toFixed(2), 's,', ignite.y.toFixed(1), 'm up');
    });

    test('a magazine spreads each missile over the forward and aft launchers (destroyer rig)', () => {
        const g = navalGame();
        const s = g.naval.spawn('destroyer', 'blue', { x: 0, z: 0 }, { passive: true });
        const mag = L.buildMagazine(s, L.LOADOUTS.destroyer.blue);
        const tl = mag.tubes.filter(t => t.key === 'tlam').map(t => t.ref);
        assert.ok(tl.some(i => i < 32) && tl.some(i => i >= 32), 'Tomahawks in both launchers');
        assert.equal(mag.count('essm'), 48, '12 quad-packed cells');
        assert.ok(mag.tubes.every(t => t.door && t.uptake), 'every cell with its door and module uptake');
        g.naval.clear();
    });
});

// ═════════════ The catapult cycle ═════════════
describe('carrier deck (deckops.js)', () => {
    test('catapult cycle: taxi → hookup → tension → salute → stroke → clear → idle; the JBD up before the stroke and down after', () => {
        const c = new D.CatCycle(0);
        assert.ok(c.assign({}));
        assert.ok(!c.assign({}), 'one jet at a time');
        const seen = [];
        let jbdAtStroke = null, t = 0, progress = 0, strokeT = null;
        for (; t < 60 && !(seen.includes('idle')); t += 1 / 60) {
            const io = { atSpot: t > 3 };
            if (c.state === 'stroke') { strokeT ??= t; progress = Math.min(1, (t - strokeT) / 2.2); io.progress = progress; io.gone = t - strokeT > 2.4; }
            const ev = c.update(1 / 60, io);
            if (ev) { seen.push(ev); if (ev === 'stroke') jbdAtStroke = c.jbd; }
        }
        assert.deepEqual(seen, ['hookup', 'tension', 'salute', 'stroke', 'clear', 'idle']);
        assert.ok(jbdAtStroke >= 0.99, 'the JBD is fully up before the launch');
        assert.equal(c.jbd, 0); assert.equal(c.shuttle, 0);
        assert.ok(t > 3 + D.CAT_TIMING.hookup + D.CAT_TIMING.tension + D.CAT_TIMING.salute && t < 40, 'the cycle takes ' + t.toFixed(1) + ' s');
        // a jet lost on the catapult: straight to clear
        const c2 = new D.CatCycle(1); c2.assign({}); c2.update(0.1, { atSpot: true });
        assert.equal(c2.update(0.1, { abort: true }), 'clear');
    });

    test('an AI jet comes up the elevator, taxis behind its director to a catapult and is launched off it', () => {
        const g = navalGame();
        const sea = openSea(5000);
        const cv = g.naval.spawn('carrier', 'blue', sea, { orbitR: 2600 });
        cv.steer(cv.heading, 10);
        const deck = new D.DeckOps(g.navalops, cv, { launches: true, parked: false });
        assert.ok(deck.ok, 'the carrier model has the deck layout');
        deck.requestLaunch({ type: 'fa18', skill: 0.6 });
        const dt = 1 / 60, seen = [];
        let ac = null, maxY = 0, elevDown = false, jbdMax = 0, shuttleMax = 0, t = 0, airborneT = null, crewPoses = new Set();
        for (; t < 170; t += dt) {
            g.time += dt;
            for (const a of g.aircraft) if (a.pilot && a.alive) a.pilot.update(dt);
            for (const a of g.aircraft) a.update(dt);
            g.naval.update(dt);
            g.camera.position.set(cv.pos.x + 250, cv.pos.y + 80, cv.pos.z + 150); // (the deck crew only work in view)
            deck.update(dt); deck.postPhysics();
            if (deck.elev.k > 0.99) elevDown = true;
            ac = ac || g.aircraft[0];
            for (const c of deck.cats) { if (c.log.length && !seen.includes(c.log[c.log.length - 1])) seen.push(c.log[c.log.length - 1]); jbdMax = Math.max(jbdMax, c.jbd); shuttleMax = Math.max(shuttleMax, c.shuttle); }
            if (deck.crew) for (const m of deck.crew.members) if (m.job) crewPoses.add(m.pose);
            if (ac) {
                assert.ok(ac.alive, 'the jet survives its launch');
                if (ac.onGround) assert.ok(ac.deck === cv || deck.elev.jet, 'on the deck (or the elevator) until it launches');
                const launched = !ac.onGround && (!(ac.pilot instanceof D.DeckPilot) || ac.pilot.state === 'climb');
                if (launched) { airborneT ??= t; maxY = Math.max(maxY, ac.pos.y); }
                if (airborneT != null && t - airborneT > 25) break;
            }
        }
        assert.ok(elevDown, 'the elevator went down to the hangar for it');
        assert.ok(ac, 'a jet was brought up');
        for (const s of ['taxi', 'hookup', 'tension', 'salute', 'stroke', 'clear']) assert.ok(seen.includes(s), 'catapult cycle ' + s + ' (' + seen.join(' ') + ')');
        assert.ok(jbdMax >= 0.99, 'the JBD came up');
        assert.ok(shuttleMax > 0.5, 'the shuttle ran down the track (' + shuttleMax.toFixed(2) + ')');
        assert.ok(airborneT != null, 'airborne');
        assert.ok(maxY > 150, 'climbing away (max ' + maxY.toFixed(0) + ' m)');
        assert.ok(crewPoses.has('beckon'), 'a director walked it to the catapult');
        assert.ok(crewPoses.has('tension') || crewPoses.has('launch'), 'the shooter gave the signals');
        console.log('    launch: airborne after', airborneT.toFixed(1), 's, climbing to', maxY.toFixed(0), 'm');
        g.naval.clear();
    });
});

describe('carrier recoveries (deckops.js)', () => {
    test('an AI jet flies the Case I pattern, bolters (a planned hook skip), traps on the next pass and is struck below', () => {
        const g = navalGame();
        const { Aircraft } = globalThis.__aircraftMod;
        const sea = openSea(9000);
        const cv = g.naval.spawn('carrier', 'blue', sea, { orbitR: 2600 });
        cv.steer(1.2, 12); cv.nav.speed = 12; cv.heading = 1.2;
        const deck = new D.DeckOps(g.navalops, cv, { launches: true, parked: false, crew: false });
        const calls = [];
        g.navalops.say = (from, text) => calls.push(from + ': ' + text);
        g.player = { pos: cv.pos, alive: true }; // (the deck only talks with the player near)
        const ac = new Aircraft(g, 'fa18', { team: 'blue', name: 'SUNDOWNER 201' });
        ac.spawnAir(new THREE.Vector3(sea.x + 4000, 1500, sea.z + 3000), 1.0, 0.5);
        g.aircraft.push(ac);
        assert.ok(deck.recover(ac));
        deck.jets[0].bolterPlan = true;
        const touchdowns = [];
        g.events = { on() {}, emit(k, a, b) { if (k === 'touchdown' && a === ac) touchdowns.push(b); } };
        const states = [deck.jets[0].state];
        const dt = 1 / 60;
        let t = 0;
        for (; t < 700; t += dt) {
            g.time += dt;
            for (const a of g.aircraft) if (a.pilot && a.alive) a.pilot.update(dt);
            for (const a of g.aircraft) a.update(dt);
            g.naval.update(dt); cv.steer(1.2, 12);
            deck.update(dt); deck.postPhysics();
            assert.ok(ac.alive, 'the jet survives the pattern (' + (states[states.length - 1] || '') + ')');
            const dp = deck.jets[0];
            if (!dp) break;
            if (states[states.length - 1] !== dp.state) states.push(dp.state);
        }
        console.log('    recovery:', states.join(' → '), '·', t.toFixed(0), 's');
        for (const s of ['marshal', 'initial', 'upwind', 'break', 'downwind', 'ninety', 'groove', 'final', 'bolter-up', 'rollout', 'trapped', 'taxi-in', 'strike']) assert.ok(states.includes(s), 'went through ' + s);
        assert.ok(touchdowns.length >= 2 && !touchdowns[0].trap && touchdowns[touchdowns.length - 1].trap, 'a bolter, then a trap');
        assert.ok(touchdowns.every(d => d.vs > -6), 'firm but safe touchdowns (' + touchdowns.map(d => d.vs.toFixed(1)).join(', ') + ' m/s)');
        assert.ok(ac.removed && !g.aircraft.includes(ac), 'struck below: gone into the hangar');
        assert.ok(calls.some(c => /BALL/.test(c)) && calls.some(c => /BOLTER/.test(c)) && calls.some(c => /WIRE/.test(c)), 'the ball call, the bolter call, the wire (' + calls.join(' | ') + ')');
        g.naval.clear();
    });
});

// ═════════════ Threat evaluation and weapon assignment ═════════════
describe('air defence (navalops.js)', () => {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    function shooters(ch = 8) {
        return [
            { id: 'cg', pos: V(0, 0, 0), channels: ch, weapons: [{ key: 'sm2', count: 20 }, { key: 'essm', count: 16 }] },
            { id: 'ddg', pos: V(2000, 0, 0), channels: ch, weapons: [{ key: 'sm2', count: 20 }, { key: 'essm', count: 16 }] },
        ];
    }
    const inbound = (id, kind, dist, speed, y = 10) => ({ id, kind, pos: V(0, y, -dist), vel: V(0, 0, speed), defend: V(0, 0, 0), inFlight: 0 });

    test('the most urgent first, a salvo of two at a missile, the outer layer only beyond the medium envelope', () => {
        const A = inbound('A', 'missile', 20000, 240), B = inbound('B', 'missile', 7000, 240), C = inbound('C', 'aircraft', 25000, 250, 3000);
        const E = inbound('E', 'missile', 60000, 240);
        const plan = O.planEngagements([A, C, E, B], shooters());
        const order = plan.map(a => a.threat.id);
        console.log('    plan:', plan.map(a => a.threat.id + '→' + a.shooter.id + ' ' + a.n + '× ' + a.key).join(', '));
        assert.deepEqual([...new Set(order)], ['B', 'A', 'C'], 'B (closest in time) before A before the aircraft; E out of range');
        const of = (id) => plan.filter(a => a.threat.id === id);
        assert.equal(of('B').reduce((s, a) => s + a.n, 0), 2, 'two at a missile');
        assert.equal(of('C').reduce((s, a) => s + a.n, 0), 1, 'one at an aircraft (shoot-look-shoot)');
        assert.ok(of('B').every(a => a.key === 'essm'), 'the close missile: the medium layer');
        assert.ok(of('A').every(a => a.key === 'sm2'), 'the far missile: the long-range layer');
        assert.ok(of('C').every(a => a.key === 'sm2'), 'the far aircraft: the long-range layer');
    });

    test('shots already in flight count, and the fire channels limit what goes out at once', () => {
        const A = inbound('A', 'missile', 20000, 240); A.inFlight = 2;
        const B = inbound('B', 'missile', 15000, 240); B.inFlight = 1;
        const plan = O.planEngagements([A, B], shooters());
        assert.equal(plan.filter(a => a.threat === A).length, 0, 'two already on A');
        assert.equal(plan.filter(a => a.threat === B).reduce((s, a) => s + a.n, 0), 1, 'one more on B');
        const many = Array.from({ length: 6 }, (_, i) => inbound('M' + i, 'missile', 14000 + i * 500, 240));
        const p2 = O.planEngagements(many, shooters(2));
        assert.equal(p2.reduce((s, a) => s + a.n, 0), 4, 'two channels a ship: four missiles guided at once');
        // nothing inside the minimum range (the other ship, 2 km off, can still take it)
        assert.equal(O.planEngagements([inbound('X', 'missile', 400, 240)], shooters().slice(0, 1)).length, 0);
        assert.equal(O.planEngagements([inbound('X', 'missile', 400, 240)], shooters()).filter(a => a.shooter.id === 'cg').length, 0);
    });

    test('an SM-2 off the cruiser kills an incoming Harpoon-class missile (or misses, the next one goes)', () => {
        const g = navalGame();
        const sea = openSea(5000);
        const grp = g.navalops.spawnGroup('blue', sea, { composition: [['cruiser', 'aaw', 0, 0]], deck: false });
        const cg = grp.guide;
        assert.ok(cg.launcher && cg.launcher.count('sm2') > 0, 'the cruiser carries SM-2');
        // a red anti-ship missile inbound from 18 km, sea-skimming
        const src = { team: 'red', kind: 'ship', name: 'X', pos: V(sea.x, 5, sea.z - 18000), host: null, prepTime: () => 0 };
        const aim = { pos: cg.pos, unit: cg, label: 'CG' };
        const m = g.strikes.spawnMissile(MISSILES.harpoon, 'red', V(sea.x, 10, sea.z - 18000), V(0, 0, 1), aim, src, null);
        m.phase = 'cruise'; m.vel.set(0, 0, 240);
        let killed = false, t = 0, launched = 0;
        g.events = { on() {}, emit() {} };
        for (; t < 90 && !killed; t += 1 / 60) {
            g.time += 1 / 60; g.war.time += 1 / 60;
            g.naval.update(1 / 60);
            g.navalops.update(1 / 60);
            g.strikes.update(1 / 60);
            launched = Math.max(launched, g.navalops.stats.launched);
            if (!m.alive) killed = true;
        }
        assert.ok(launched >= 1, 'interceptors launched');
        assert.ok(killed, 'the missile was stopped (' + t.toFixed(1) + ' s, ' + launched + ' launched)');
        assert.ok(cg.alive && cg.hp === cg.maxHp, 'the cruiser untouched');
        console.log('    intercept: ' + launched + ' SAM(s), missile down after ' + t.toFixed(1) + ' s');
        g.naval.clear();
    });
});

// ═════════════ Formation ═════════════
describe('carrier group steaming (navalops.js)', () => {
    test('station keeping: the steer never backs up, sprints when behind and settles on the guide\'s speed on station', () => {
        // (the guide steams north, −z, at 8 m/s)
        const a = O.stationSteer(0, 0, 0, -600, 0, -8, 16);
        assert.ok(a.speed > 8 && Math.abs(a.heading) < 0.05, 'behind: faster, same course');
        const b = O.stationSteer(0, 0, 0, 900, 0, -8, 16);
        assert.ok(b.speed >= 8 * 0.45 - 1e-9 && b.speed < 8 && Math.abs(b.heading) < 0.05, 'ahead: slower, never backing');
        const c = O.stationSteer(0, 0, 1000, 0, 0, -8, 16);
        assert.ok(c.heading < -0.1, 'station to starboard: turns to starboard (heading ' + c.heading.toFixed(2) + ')');
        const d = O.stationSteer(0, 0, 0, 0, 0, -8, 16);
        assert.ok(Math.abs(d.speed - 8) < 1e-9 && d.err === 0, 'on station: the guide\'s speed');
        const e = O.stationSteer(0, 0, 0, 0, 8, 0, 16);
        assert.ok(Math.abs(e.heading + Math.PI / 2) < 1e-9, 'the guide turned east: so does the escort');
    });

    test('a carrier group keeps its stations through a 90° turn together and a zig-zag, without collisions', () => {
        const g = navalGame();
        const sea = openSea(9000);
        assert.ok(sea, 'open sea for the test');
        g.wind.set(0, 0, 0);
        const grp = g.navalops.spawnGroup('blue', sea, { composition: O.CSG.filter(r => r[0] !== 'ssn'), deck: false, course: 0 });
        assert.equal(grp.members.length, 5);
        for (const m of grp.members) assert.ok(g.war.rec(m.ship), m.ship.name + ' in the war registry');
        assert.equal(g.war.rec(grp.guide).cls, 'carrier');
        grp.area = { x: sea.x, z: sea.z, r: 30000 };
        const dt = 0.1, P = {};
        const errAt = () => grp.members.filter(m => m.ship !== grp.guide).map(m => { O.stationPos(grp.guide.pos.x, grp.guide.pos.z, grp.axis, m.ox * (m.k ?? 1), m.oz * (m.k ?? 1), P); return Math.hypot(P.x - m.ship.pos.x, P.z - m.ship.pos.z); });
        let minSep = Infinity;
        const sim = (secs, fn) => {
            for (let t = 0; t < secs; t += dt) {
                g.time += dt;
                if (fn) fn(t);
                g.naval.update(dt);
                grp.steerGuide(dt); grp.keepStations(dt);
                const S = grp.ships();
                for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) minSep = Math.min(minSep, S[i].pos.distanceTo(S[j].pos));
            }
        };
        grp.leg = { x: sea.x, z: sea.z - 40000 }; grp.legT = 1e9; grp.navT = 0;
        sim(180);
        const e1 = errAt();
        console.log('    on station after 3 min (m):', e1.map(e => Math.round(e)).join(' '));
        assert.ok(e1.every(e => e < 450), 'every escort on its station');
        // turn 90° together
        const h0 = grp.course;
        O.NavalOps.prototype.steerGroup.call(g.navalops, grp, h0 + Math.PI / 2);
        let turned = 0;
        sim(420, () => { if (Math.abs(((grp.guide.heading - h0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 1.2) turned++; });
        const e2 = errAt();
        console.log('    after the 90° turn (m):', e2.map(e => Math.round(e)).join(' '), ' guide heading', (grp.guide.heading * 57.3).toFixed(0) + '°');
        assert.ok(turned > 0, 'the group came round');
        assert.ok(e2.every(e => e < 600), 'back on station after the turn');
        // zig-zag under threat: the guide swings ±25° about the base course, the screen follows
        grp.threat = 1;
        const hs = [];
        sim(240, (t) => { grp.threat = 1; if (t % 5 < dt) hs.push(grp.guide.heading); });
        const dev = hs.map(h => Math.abs(((h - grp.course + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
        assert.ok(Math.max(...dev) > 0.3, 'zig-zagging (' + (Math.max(...dev) * 57.3).toFixed(0) + '° off the base course)');
        const e3 = errAt();
        assert.ok(e3.every(e => e < 900), 'the screen stays with it (' + e3.map(e => Math.round(e)).join(' ') + ')');
        assert.ok(minSep > 250, 'no collisions (closest ' + minSep.toFixed(0) + ' m)');
        g.naval.clear();
    });

    test('open water: courses turn away from land ahead, and groups only spawn with room', () => {
        const sea = openSea(7000);
        assert.ok(O.openWater(sea.x, sea.z, 7000));
        assert.ok(!O.openWater(0, 0, 3000), 'the home base is not open water');
        // find a heading that runs into land within 5 km from somewhere near a coast, and check openCourse avoids it
        let found = null;
        for (let x = -40000; x <= 40000 && !found; x += 2000) for (let z = -40000; z <= 40000 && !found; z += 2000) {
            if (terrainHeight(x, z) > -80) continue;
            for (let k = 0; k < 8; k++) { const h = k * Math.PI / 4; const d = O.clearRun(x, z, h, 5000); if (d < 3000) { found = { x, z, h }; break; } }
        }
        assert.ok(found, 'a spot near a coast');
        const h2 = O.openCourse(found.x, found.z, found.h, 5000);
        assert.ok(O.clearRun(found.x, found.z, h2, 5000) > O.clearRun(found.x, found.z, found.h, 5000), 'the chosen course has more open water');
    });
});

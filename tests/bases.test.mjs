import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { noop } from './helpers/arena.mjs';

// Living airbases (bases.js, basestate.js, airfieldlights.js): the alert state machine, runway craters closing a
// runway by its minimum operating strip and the repair crews reopening it, what losing the tower / the radar's power
// / the power plant does, scrambles (their timeline, the abstract launch through the director, one pair at a time,
// called off by a cut runway), and the airfield lighting layout (FAA / ICAO counts and spacing) and its circuits.
let THREE, S, AL, BL, B, W, world, config;

// (top-level await, not a root before() hook: see tests/README.md)
THREE = await import('three');
S = await src('basestate.js');
AL = await src('airfieldlights.js');
BL = await src('baselayout.js');
B = await src('bases.js');
W = await src('war.js');
world = await src('world.js');
config = await src('config.js');
// the airbase models (models/airbases/*.glb), read from disk
const { readFileSync } = await import('node:fs');
const M = await src('airbasemodels.js'), V = await src('vehicles.js');
const repo = new URL('../', import.meta.url);
await M.preloadAirbaseModels({ textures: false, fetchBuffer: async (u) => { const b = readFileSync(new URL(u, repo)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });

const HOME = () => world.BASES.find(b => b.id === 'home');
const ENEMY = () => world.BASES.find(b => b.id === 'enemy');

// ── a war game with the real War and Bases (visuals off), a stub director, lights and airbase records ──
function basesGame() {
    const handlers = {};
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 60000, 250000);
    const radio = [], lightsLog = [], flights = [];
    const recs = {};
    const lights = {
        setPower(id, on) { lightsLog.push(['power', id, on]); }, setBlackout(id, on) { lightsLog.push(['blackout', id, on]); },
        setClosed(id, r, c) { lightsLog.push(['closed', id, r, c]); }, setSearch() {},
    };
    const g = {
        time: 0, state: 'playing', mode: 'war', callsign: 'TEST', score: 0,
        difficulty: config.DIFFICULTY.veteran, settings: { start: 'auto' },
        camera: cam, scene: new THREE.Scene(),
        world: { weather: 'clear', timeKey: 'day', towns: null, tiles: new Map(), TILE: 2048, airTraffic: {} },
        events: { on(k, fn) { (handlers[k] = handlers[k] || []).push(fn); }, emit(k, a, b) { (handlers[k] || []).forEach(fn => fn(a, b || {})); } },
        audio: { say() {}, tick() {}, boom() {} },
        feed: [], addFeed(t) { this.feed.push(t); },
        aircraft: [], naval: { ships: [] }, player: null, pilotMode: null,
        effects: noop(), weapons: noop(), systems: [], isNeutral: () => false,
        director: {
            enabled: true, flights: [],
            say(from, text) { radio.push({ from, text }); },
            spawnFlight(o) { const f = { ...o, n: o.types.length, hp: o.types.map(() => 1), done: false }; flights.push({ f, t: g.bases.time }); return f; },
        },
    };
    // airbase.js's records of the tower and radar buildings (buildings.js), per field
    g.world.airbases = { lights, bases: world.BASES.map(b => { recs[b.id] = { tower: { alive: true, hp: 900, maxHp: 900 }, radar: { alive: true, hp: 400, maxHp: 400 } }; return { base: b, towerRec: recs[b.id].tower, radarRec: recs[b.id].radar }; }) };
    g.ground = {
        targets: [],
        addTarget(type, x, z, rot, team) {
            const y = Math.max(world.terrainHeight(x, z), 0);
            const u = { type, team, alive: true, isGround: true, radius: 7, hp: 90, maxHp: 90, health: 90, maxHealth: 90, def: { score: 100, name: type }, name: type.toUpperCase(),
                pos: new THREE.Vector3(x, y + 3, z), vel: new THREE.Vector3(), mesh: { position: new THREE.Vector3(x, y, z), rotation: { y: rot }, children: [], add() {} },
                damage(a, source) { if (!this.alive) return; this.hp -= a; if (this.hp <= 0) { this.alive = false; g.events.emit('groundKilled', this, { source }); } }, remove() {} };
            this.targets.push(u);
            return u;
        },
    };
    g.war = new W.War(g);
    g.war.start('war');
    g.bases = new B.Bases(g);
    g.bases.render = false;
    g.bases.start('war');
    g.step = (secs, dt = 0.5) => { for (let t = 0; t < secs - 1e-9; t += dt) { g.time += dt; g.war.time += dt; g.bases.update(dt); } };
    Object.assign(g, { radio, lightsLog, flights, recs });
    return g;
}

// a line of three craters right across runway 0 of a crater field at v (runway frame), as a runway-attack munition leaves
function cutRunway(cf, v, r = 4.3) {
    const Fr = cf.frames[0];
    for (const u of [-Fr.hw * 0.62, 0, Fr.hw * 0.62]) { const p = BL.fromRunway(Fr, u, v); cf.add(p.lx, p.lz, r, { t: 0 }); }
}

describe('alert state machine', () => {
    test('NORMAL → ALERT on a threat, → ATTACK on a blast, held, then steps back down through the dwell', () => {
        const f = new S.AlertFSM(0);
        assert.equal(f.update(0), null);
        assert.equal(f.state, S.ALERT.NORMAL);
        f.threat(1, 10);
        assert.deepEqual(f.update(10), { from: S.ALERT.NORMAL, to: S.ALERT.ALERT });
        f.impact(20);
        assert.deepEqual(f.update(20), { from: S.ALERT.ALERT, to: S.ALERT.ATTACK }, 'escalation is immediate');
        // held through ATTACK_HOLD after the last blast
        for (let t = 21; t < 20 + S.ATTACK_HOLD; t += 1) assert.equal(f.update(t), null, 'still ATTACK at ' + t);
        const down = f.update(20 + S.ATTACK_HOLD + 0.5);
        assert.deepEqual(down, { from: S.ALERT.ATTACK, to: S.ALERT.ALERT });
        // then ALERT until ALERT_HOLD after the last threat (the blast counted as one)
        assert.equal(f.update(20 + S.ALERT_HOLD - 1), null);
        f.damaged = true;
        assert.deepEqual(f.update(20 + S.ALERT_HOLD + 1), { from: S.ALERT.ALERT, to: S.ALERT.DAMAGED }, 'damage left: DAMAGED, not NORMAL');
        f.damaged = false;
        assert.deepEqual(f.update(20 + S.ALERT_HOLD + 2), { from: S.ALERT.DAMAGED, to: S.ALERT.NORMAL });
    });
    test('no flicker: a stepped-down state waits out its minimum dwell; a close threat (level 3) is ATTACK', () => {
        const f = new S.AlertFSM(0);
        f.threat(1, 0); f.update(0);
        assert.equal(f.state, S.ALERT.ALERT);
        // threat gone at once: ALERT stays at least MIN_DWELL and ALERT_HOLD
        assert.equal(f.update(S.MIN_DWELL[S.ALERT.ALERT] - 1), null);
        f.threat(3, 30);
        assert.equal(f.update(30).to, S.ALERT.ATTACK);
        assert.equal(f.name, 'ATTACK');
        assert.ok(f.history.length >= 2);
    });
});

describe('runway craters, closure and repair', () => {
    test('a single crater leaves a minimum operating strip; two cuts across the runway close it', () => {
        const b = HOME(), cf = new S.CraterField(b, BL.baseLayout(b).paved);
        const Fr = cf.frames[0];
        assert.equal(cf.runwayStatus(0).mos, b.runways[0].len);
        const c = cf.add(0, 0, 4.3);
        assert.ok(c && c.rw === 0 && c.surface === 'runway');
        const st = cf.runwayStatus(0);
        assert.ok(st.open, 'one crater on the centreline: a 15 m lane beside it stays open');
        assert.ok(st.lane[0] > c.u + cf.reach(c) - 1e-6 || st.lane[1] < c.u - cf.reach(c) + 1e-6, 'the lane clears the crater and its broken lip');
        cutRunway(cf, Fr.half / 3); cutRunway(cf, -Fr.half / 3);
        const cut = cf.runwayStatus(0);
        assert.ok(!cut.open, 'MOS ' + cut.mos + ' m < ' + S.MOS_LENGTH);
        assert.ok(cut.mos < S.MOS_LENGTH && cut.mos > 900);
        assert.equal(cf.anyRunwayOpen(), false);
        // a blast in a crater makes it bigger instead of a new one
        const n = cf.craters.length, big = cf.add(0.5, 0.5, 4.3);
        assert.equal(cf.craters.length, n);
        assert.ok(big.r > 4.3);
    });
    test('nothing off the pavement; a taxiway crater cuts that taxi route and the graph goes round it', () => {
        const b = HOME(), L = BL.baseLayout(b), cf = new S.CraterField(b, L.paved);
        assert.equal(cf.add(-600, 0, 4.3), null, 'grass west of the runway');
        const g = new S.TaxiGraph(L.taxi);
        const nodes = Object.keys(L.taxi.nodes);
        const a = L.depart.entry;
        const from = nodes.find(k => k.startsWith('has')) || nodes[0];
        const r0 = g.route(from, a);
        assert.ok(r0 && r0.length >= 2, 'a route from ' + from + ' to ' + a);
        // crater the middle of the route's longest taxiway edge
        let best = null;
        for (let i = 0; i < r0.length - 1; i++) { const e = g.edges.find(e => (e.a === r0[i] && e.b === r0[i + 1]) || (e.b === r0[i] && e.a === r0[i + 1])); if (e.w <= 40 && (!best || g.len(e) > g.len(best))) best = e; }
        const A = L.taxi.nodes[best.a], Bn = L.taxi.nodes[best.b];
        cf.add((A[0] + Bn[0]) / 2, (A[1] + Bn[1]) / 2, 4.3);
        assert.ok(cf.blocksSegment(A[0], A[1], Bn[0], Bn[1], best.w), 'the crater blocks that edge');
        const r1 = g.route(from, a, g.blocker(cf));
        if (r1) for (let i = 0; i < r1.length - 1; i++) assert.ok(!((r1[i] === best.a && r1[i + 1] === best.b) || (r1[i] === best.b && r1[i + 1] === best.a)), 'the new route avoids the cut edge');
    });
    test('repair crews reopen the runway first, stage by stage, and hold while under attack', () => {
        const b = HOME(), L = BL.baseLayout(b), cf = new S.CraterField(b, L.paved);
        const Fr = cf.frames[0];
        cutRunway(cf, Fr.half / 3); cutRunway(cf, -Fr.half / 3);
        const tw = cf.add(200, 0, 4.3); // one on the parallel taxiway
        assert.ok(tw && tw.rw < 0);
        const crews = new S.RepairCrews(cf, L.depot, { teams: 2 });
        // under attack nobody works
        for (let t = 0; t < 120; t += 1) crews.update(1, { hold: true });
        assert.ok(cf.craters.every(c => c.stage === 'open' && c.work === 0), 'no work during the attack');
        let t = 0, reopened = null, twThen = null;
        const stagesSeen = new Set();
        while (t < 3600) {
            crews.update(1); t += 1;
            for (const c of cf.craters) stagesSeen.add(c.stage);
            if (reopened === null && cf.usable(0)) { reopened = t; twThen = tw.stage; }
            if (cf.unrepaired.length === 0) break;
        }
        assert.ok(reopened !== null, 'the runway reopened');
        assert.ok(['clearing', 'filling', 'capping', 'repaired'].every(s => stagesSeen.has(s)));
        // one cut's three craters by two teams: a few minutes (≈ 160 s per 500 lb crater, plus driving)
        assert.ok(reopened > 150 && reopened < 900, 'reopened after ' + reopened + ' s');
        assert.equal(twThen, 'open', 'the taxiway waits while the runway is closed');
        assert.equal(cf.unrepaired.length, 0, 'everything repaired within the hour (' + t + ' s)');
    });
    test('in the game: bombs on the runway close it (lights, radio, air traffic, launch status); the player rolling into a crater', () => {
        const g = basesGame(), F = g.bases.field('home'), Fr = F.craters.frames[0];
        for (const v of [Fr.half / 3, -Fr.half / 3]) for (const u of [-Fr.hw * 0.62, 0, Fr.hw * 0.62]) {
            const p = BL.fromRunway(Fr, u, v), w = F.w(p.lx, p.lz, 0.5);
            g.events.emit('bombImpact', { pos: w }, { at: w });
        }
        g.step(1);
        assert.equal(F.runwayOpen, false);
        assert.equal(F.state, S.ALERT.ATTACK, 'blasts on the field: ATTACK');
        assert.ok(g.lightsLog.some(e => e[0] === 'closed' && e[1] === 'home' && e[3] === true), 'runway lights off, the X on');
        assert.ok(g.radio.some(r => /CLOSED/.test(r.text)), 'the tower calls it closed');
        assert.deepEqual(g.bases.launchStatus(F.base), { ok: false, why: 'runway' });
        assert.equal(g.world.airTraffic.runwayClosed(F.base, F.base.runways[0]), true, 'air traffic holds');
        assert.equal(F.units.runways[0].closed, true);
        // the player's jet at speed into a crater: wrecked; slow: damaged
        const c = F.craters.craters[0], pw = F.w(c.lx, c.lz, 1);
        let crashed = false, hurt = 0;
        const p = { alive: true, onGround: true, speed: 45, pos: pw, spec: { span: 10 }, vel: new THREE.Vector3(0, 0, -45), maxHealth: 100, crash() { crashed = true; }, damage(a) { hurt += a; } };
        g.player = p;
        g.step(0.5);
        assert.ok(crashed, 'at 45 m/s it is a crash');
        const c2 = F.craters.craters[1];
        const p2 = { ...p, speed: 12, pos: F.w(c2.lx, c2.lz, 1), vel: new THREE.Vector3(0, 0, -12), _craterHit: null };
        crashed = false; g.player = p2;
        g.step(0.5);
        assert.ok(!crashed && hurt > 0, 'taxiing speed: gear damage');
    });
});

describe('components', () => {
    test('the tower: ATC calls while it stands; without it only critical news (from COMMAND) and slower scrambles', () => {
        const T1 = S.scrambleTimeline({ tower: true }), T0 = S.scrambleTimeline({ tower: false });
        assert.ok(T0.airborne - T1.airborne >= 30, 'no clearance: the leader waits and looks out');
        const g = basesGame(), F = g.bases.field('home');
        g.bases.tower(F, 'TEST ONE');
        assert.equal(g.radio.at(-1).from, 'SKYWAR TOWER');
        g.recs.home.tower.alive = false;
        assert.equal(F.towerUp, false);
        const n = g.radio.length;
        g.bases.tower(F, 'TEST TWO');
        assert.equal(g.radio.length, n, 'no ATC');
        g.bases.tower(F, 'TEST THREE', { critical: true });
        assert.equal(g.radio.at(-1).from, 'COMMAND');
        const sc = g.bases.scramble(F, { role: 'cap' });
        assert.ok(sc && Math.abs(sc.eta - S.scrambleTimeline({ qra: true, tower: false, taxi: 170 }).airborne) < 1e-6);
    });
    test('the power plant: lights and the surveillance radar go dark (no coverage from it)', () => {
        const g = basesGame(), F = g.bases.field('home'), war = g.war;
        const rad = F.units.radar;
        assert.ok(rad && F.units.power);
        const pt = new THREE.Vector3(F.base.x + 6000, 4000, F.base.z - 12000);
        const before = war.coverage('blue', pt);
        rad.rec.alive = false; const without = war.coverage('blue', pt); rad.rec.alive = true;
        assert.ok(before > without, 'the field radar sees the point (' + before.toFixed(2) + ' vs ' + without.toFixed(2) + ' without it)');
        F.units.power.damage(1e6, null, 'strike');
        assert.equal(F.units.power.alive, false);
        g.step(1);
        assert.equal(F.powered, false);
        assert.ok(g.lightsLog.some(e => e[0] === 'power' && e[1] === 'home' && e[2] === false), 'lights off');
        assert.equal(rad.unpowered, true);
        assert.equal(war.coverage('blue', pt), without, 'coverage as if the radar were gone');
        assert.ok(g.radio.some(r => /POWER PLANT/.test(r.text)));
        assert.equal(F.state, S.ALERT.ATTACK);
        // slower scrambles without ground power
        assert.ok(S.scrambleTimeline({ power: false }).airborne > S.scrambleTimeline({ power: true }).airborne);
    });
    test('shelters take their jets with them; fuel and munitions losses slow the sortie rate', () => {
        const g = basesGame(), F = g.bases.field('enemy');
        const aw = F.airwing, n = aw.jets.length;
        const sh = [...F.units.shelters.values()].find(u => !u.def.name.includes('ALERT') && u.sid.startsWith('has'));
        const jet = aw.shelter(sh.sid).jet;
        assert.ok(jet);
        sh.damage(1e6, null, 'strike');
        assert.equal(jet.state, 'lost');
        assert.equal(aw.jets.filter(j => j.state !== 'lost').length, n - 1);
        const r0 = F.rate;
        for (const t of F.units.fuel) t.damage(1e6, null);
        assert.ok(F.fuelFrac === 0 && F.rate < r0 * 0.4, 'no fuel: rate ' + F.rate.toFixed(2));
        for (const u of F.units.igloos) u.damage(1e6, null, 'strike');
        assert.ok(F.ammoFrac === 0 && F.units.igloos.every(u => u.cook > 0), 'the igloos cook off');
    });
    test('air defence readiness follows the alert state', () => {
        const g = basesGame(), F = g.bases.field('enemy');
        assert.ok(F.units.aaa.length + F.units.pads.length > 0);
        g.step(1);
        assert.ok([...F.units.aaa, ...F.units.pads].every(t => t.readiness < 0.5));
        F.fsm.threat(1, g.bases.time);
        g.step(1);
        assert.equal(F.state, S.ALERT.ALERT);
        assert.ok([...F.units.aaa, ...F.units.pads].every(t => t.readiness === 1));
    });
});

describe('scrambles', () => {
    test('the timeline runs in order; the alert pair is quicker than jets from the shelters', () => {
        const T = S.scrambleTimeline({});
        const order = ['horn', 'run', 'climb', 'start', 'canopy', 'taxi', 'lineup', 'roll1', 'roll2', 'airborne'];
        for (let i = 1; i < order.length; i++) assert.ok(T[order[i]] > T[order[i - 1]], order[i] + ' after ' + order[i - 1]);
        assert.ok(T.airborne > 60 && T.airborne < 150, 'QRA: wheels up ' + T.airborne.toFixed(0) + ' s after the horn');
        assert.ok(S.scrambleTimeline({ qra: false, taxi: 900 }).airborne > T.airborne + 60);
        assert.ok(S.scrambleTimeline({ night: true, power: false }).lineup > S.scrambleTimeline({ night: true }).lineup);
    });
    test('abstract scramble: the director gets the flight at wheels-up; one pair at a time; the alert shelters refill', () => {
        const g = basesGame(), F = g.bases.field('home');
        let setupFlight = null;
        const sc = g.bases.scramble(F, { role: 'intercept', target: new THREE.Vector3(0, 5000, -40000), setup: (f) => { setupFlight = f; } });
        assert.ok(sc && !sc.physical, 'far from the camera: abstract');
        assert.deepEqual(sc.types, ['f16', 'f16'], 'the QRA pair');
        assert.equal(F.airwing.alertReady.length, 0);
        assert.equal(g.bases.scramble(F, {}), false, 'one pair at a time');
        g.step(sc.eta - 2);
        assert.equal(g.flights.length, 0, 'not yet airborne');
        g.step(4);
        assert.equal(g.flights.length, 1);
        assert.ok(Math.abs(g.flights[0].t - sc.eta) < 1.1, 'airborne at the eta');
        assert.deepEqual(g.flights[0].f.types, ['f16', 'f16']);
        assert.equal(setupFlight, g.flights[0].f);
        assert.equal(setupFlight.fromField, F);
        // the alert shelters are taken over by ready jets (REFILL), which go on alert after a turnaround
        g.step(S.REFILL + 100);
        assert.equal(F.airwing.alertReady.length, 2, 'two jets back on alert');
        // the flight lands home: its jets turn round
        g.events.emit('flightDone', setupFlight, { why: 'landed' });
        assert.ok(setupFlight.jets.every(j => j.state === 'turnaround'));
    });
    test('a cut runway: no launch at all, and a scramble under way is called off with its jets back', () => {
        const g = basesGame(), F = g.bases.field('enemy'), Fr = F.craters.frames[0];
        const sc = g.bases.scramble(F, {});
        assert.ok(sc);
        g.step(10);
        cutRunway(F.craters, Fr.half / 3); cutRunway(F.craters, -Fr.half / 3);
        g.bases.pavementChanged(F);
        let aborted = null;
        g.events.on('scrambleAborted', (f, d) => { aborted = d.why; });
        g.step(2);
        assert.equal(aborted, 'runway');
        assert.ok(sc.scramble.jets.every(j => j.state === 'turnaround'));
        assert.equal(g.bases.scramble(F, {}), false);
        assert.equal(g.bases.launchStatus(F.base).why, 'runway');
        assert.equal(g.flights.length, 0);
        assert.ok(g.radio.some(r => /CALLED OFF|CLOSED/.test(r.text)), 'intel tells us');
    });
});

describe('airfield lighting', () => {
    const tags = (ls, t) => ls.filter(l => l.tag === t);
    test('home: edge lights ≤ 60 m apart both sides, threshold rows, ALSF-2 and MALSR, PAPI, taxiway blue', () => {
        const b = HOME(), L = BL.baseLayout(b), { lights, counts } = AL.lightingLayout(b, L);
        const Fr = BL.runwayFrames(b)[0];
        const loc = (l) => { const p = world.worldToBase(b, l.x, l.z); return BL.toRunway(Fr, p.lx, p.lz, {}); };
        // edge lights: two rows, 3 m outside the edge, spacing ≤ 60 m, end to end
        for (const sd of [-1, 1]) {
            const vs = tags(lights, 'edge').map(loc).filter(r => Math.sign(r.u) === sd).map(r => r.v).sort((a, b) => a - b);
            assert.ok(Math.abs(vs[0] + Fr.half) < 1 && Math.abs(vs.at(-1) - Fr.half) < 1, 'edge row spans the runway');
            for (let i = 1; i < vs.length; i++) assert.ok(vs[i] - vs[i - 1] <= 60.01, 'spacing ' + (vs[i] - vs[i - 1]));
        }
        tags(lights, 'edge').forEach(l => assert.ok(Math.abs(Math.abs(loc(l).u) - (Fr.hw + 3)) < 0.01));
        // threshold / end rows at 3 m spacing across the width at both ends: green one way, red the other
        const nt = Math.floor((2 * Fr.hw) / 3) + 1;
        assert.equal(counts.threshold, 2 * nt);
        tags(lights, 'threshold').forEach(l => { assert.ok(l.c1[1] > l.c1[0], 'green outward'); assert.ok(l.c2[0] > l.c2[1], 'red inward'); });
        // centreline every 15 m
        assert.equal(counts.centreline, Math.floor((2 * Fr.half - 15) / 15) + 1);
        // ALSF-2 (24 barrettes of 5 to 720 m, 15 sequenced flashers) + MALSR (7 barrettes, 5 RAIL flashers)
        assert.equal(counts.als, 24 * 5 + 7 * 5);
        assert.equal(counts.flasher, 15 + 5);
        assert.equal(counts.als_side, 10 * 2 * 3, 'red side-row barrettes in the inner 300 m');
        assert.equal(counts.tdz, 30 * 2 * 3, 'touchdown zone barrettes to 900 m');
        // PAPI: four per end, inner to outer 3°30′ … 2°30′, on the landing pilot's left
        assert.equal(counts.papi, 8);
        const papi = tags(lights, 'papi');
        for (let e = 0; e < 2; e++) { const set = papi.slice(e * 4, e * 4 + 4); for (let i = 1; i < 4; i++) assert.ok(set[i].p < set[i - 1].p); assert.ok(Math.abs(set[0].p - 3.5 * Math.PI / 180) < 1e-9 && Math.abs(set[3].p - 2.5 * Math.PI / 180) < 1e-9); }
        // taxiway edges: blue, and not on the runway
        assert.ok(counts.taxi > 50);
        tags(lights, 'taxi').forEach(l => { assert.ok(l.c1[2] > l.c1[0] * 3); assert.ok(Math.abs(loc(l).u) > Fr.hw + 3 || Math.abs(loc(l).v) > Fr.half + 3); });
        // the rest: one military beacon on the tower, stop bars + guard lights at the holds, floods, the closed X
        assert.equal(counts.beacon, 1);
        assert.equal(counts.stopbar, 4 * 7);
        assert.equal(counts.guard, 3 * 2);
        assert.equal(counts.flood, L.floods.length);
        assert.equal(counts.closedX, 3 * 25);
    });
    test('enemy: ICAO Calvert approach (1 / 2 / 3 sources by thirds, converging crossbars), REIL at the other end', () => {
        const b = ENEMY(), { counts } = AL.lightingLayout(b, BL.baseLayout(b));
        assert.equal(counts.als, 10 * 1 + 10 * 2 + 10 * 3);
        assert.ok(counts.als_bar > 40);
        assert.equal(counts.reil, 2);
        assert.equal(counts.flasher || 0, 0);
        assert.equal(counts.tdz || 0, 0);
    });
    test('circuits: a closed runway shows the X and the stop bars; blackout and lost power put everything out', () => {
        const F = { power: new Array(32).fill(0), main: true, blackout: false, closed: [false, false, false], points: {}, pools: { visible: true } };
        const apply = (o) => { Object.assign(F, o); AL.AirfieldLights.prototype.apply.call({ night: true }, F); return F.power; };
        let p = apply({});
        assert.equal(p[AL.rwc(0, 'EDGE')], 1); assert.equal(p[AL.rwc(0, 'X')], 0); assert.equal(p[AL.CIRCUIT.STOP], 0); assert.equal(p[AL.CIRCUIT.TAXI], 1);
        p = apply({ closed: [true, false, false] });
        assert.equal(p[AL.rwc(0, 'EDGE')], 0); assert.equal(p[AL.rwc(0, 'PAPI')], 0); assert.equal(p[AL.rwc(0, 'X')], 1);
        assert.equal(p[AL.CIRCUIT.STOP], 1); assert.equal(p[AL.CIRCUIT.GUARD], 1);
        p = apply({ closed: [false, false, false], blackout: true });
        for (const k of ['EDGE', 'THR', 'CL', 'ALS', 'FLASH', 'PAPI', 'X']) assert.equal(p[AL.rwc(0, k)], 0, k);
        assert.equal(p[AL.CIRCUIT.TAXI] + p[AL.CIRCUIT.FLOOD] + p[AL.CIRCUIT.BEACON], 0);
        assert.equal(p[AL.CIRCUIT.OBST], 1, 'obstruction lights stay on in a blackout');
        assert.equal(F.pools.visible, false);
        p = apply({ blackout: false, main: false });
        assert.equal(p.reduce((a, x) => a + x, 0), 0, 'no power: all dark');
    });
});

describe('airbase models', () => {
    const box = (o) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
    const tris = (o) => { let n = 0; o.traverse(m => { if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }); return n; };
    const wpos = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
    test('every model loads, stands on the ground, inside its triangle budget', () => {
        for (const id of Object.keys(M.AB_MODELS)) {
            assert.ok(M.hasModel(id), id + ' loaded');
            const { object } = M.createModel(id);
            const bb = box(object);
            assert.ok(Math.abs(bb.min.y) < 0.2, id + ' on the ground (' + bb.min.y.toFixed(2) + ')');
            assert.ok(tris(object) < 22000, id + ' ' + tris(object) + ' tris');
        }
    });
    test('shelters: the size the layout reserves; NATO doors slide clear of the opening, Soviet gates swing out', () => {
        for (const id of ['has_nato', 'has_red']) {
            const { object, rig } = M.createModel(id);
            const bb = box(object);
            assert.ok(bb.max.y > 9 && bb.max.y < 10.5, id + ' height ' + bb.max.y.toFixed(1));
            const split = M.modelSplit(id);
            assert.deepEqual(split.joints.map(j => j.name).filter(n => /^door/.test(n)).sort(), ['door_l', 'door_r']);
            assert.ok(split.shell.length >= 1);
            const l = rig.nodes.door_l, r = rig.nodes.door_r;
            const l0 = box(l), r0 = box(r);
            assert.ok(l0.max.x > -0.5 && r0.min.x < 0.5, 'closed: the leaves meet in the middle');
            V.openDoors(rig, 1);
            const l1 = box(l), r1 = box(r);
            if (id === 'has_nato') assert.ok(l1.max.x < -10 && r1.min.x > 10, 'open: both leaves beside the 21 m opening');
            else assert.ok(l1.min.z < -25 && r1.min.z < -25, 'open: the gates swung out in front');
        }
    });
    test('vehicle rigs: the loader lifts its bucket, the dump truck tips its bed, the Harpoon launcher jacks down and elevates', () => {
        const up = (id, node) => { const { rig } = M.createModel(id); const n = rig.nodes[node]; const b0 = box(n); V.raise(rig, 1); const b1 = box(n); return b1.max.y - b0.max.y; };
        assert.ok(up('loader', 'arm') > 1.5, 'bucket up');
        assert.ok(up('dumptruck', 'bed') > 2, 'bed tipped');
        const { rig } = M.createModel('hcds');
        assert.equal(rig.muzzles.length, 4);
        const m0 = wpos(rig.muzzles[0]).y;
        V.raise(rig, 1);
        assert.ok(wpos(rig.muzzles[0]).y > m0 + 1, 'canisters elevated');
        V.deployJacks(rig, 1);
        const feet = rig.byGroup.jack.map(e => box(e.node).min.y);
        assert.ok(feet.length === 4 && feet.every(y => y < 0.1), 'jacks on the ground');
        const { rig: sr } = M.createModel('siren');
        assert.ok(sr.byGroup.spin && sr.byGroup.spin.length === 1, 'the siren rotor spins');
    });
});

// Air support and electronic warfare (src/airsupport.js and its helpers): the brevity maths and wording, the
// AWACS radar and its calls, tanker racetracks, the boom and drogue geometry and envelopes, a receiver flown from
// the rendezvous to fuel flowing (real Aircraft over the real terrain), fuel transfer, recon reveals, SIGINT,
// jamming and burn-through, and the stand-off bomber raid through the strike system.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { noop, seeded } from './helpers/arena.mjs';

// (top-level await: see tests/README.md)
const THREE = await import('three');
const W = await src('war.js');
const BR = await src('brevity.js');
const RF = await src('refuel.js');
const EW = await src('ew.js');
const RC = await src('recon.js');
const BM = await src('bombers.js');
const AS = await src('airsupport.js');
const AW = await src('awacs.js');
const ST = await src('strikes.js');
const { Aircraft } = await src('aircraft.js');
const { Pilot } = await src('ai.js');
const world = await src('world.js');
const config = await src('config.js');
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const NM = BR.NM, DEG = Math.PI / 180;

// ── a game as far as the air-support plug-in cares: a real War, events that work, no rendering ──
function airGame(extra = {}) {
    const handlers = {};
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 60000, 250000);
    const g = {
        time: 0, state: 'playing', mode: 'war', callsign: 'VIPER', score: 0,
        difficulty: config.DIFFICULTY.veteran, settings: { start: 'auto', controlMode: 'keyboard', fuel: true },
        camera: cam, scene: new THREE.Scene(),
        world: { weather: 'clear', timeKey: 'day', towns: null, tiles: new Map(), TILE: 2048 },
        events: { on(k, fn) { (handlers[k] = handlers[k] || []).push(fn); }, emit(k, a, b) { (handlers[k] || []).forEach(fn => fn(a, b || {})); } },
        audio: { say() {}, tick() {}, boom() {}, uiConfirm() {} },
        feed: [], addFeed(t) { this.feed.push(t); },
        aircraft: [], naval: { ships: [] }, player: null, pilotMode: null, navTarget: null, lockTarget: null,
        effects: noop(), weapons: noop(), wreckage: noop(), systems: [], isNeutral: () => false,
        surfaceAt: () => ({ h: -1e6 }), wind: null, input: { down: () => false }, aimDir: new THREE.Vector3(),
        ...extra,
    };
    g.ground = g.ground || stubGround(g);
    g.war = new W.War(g);
    g.war.start(g.mode);
    return g;
}
function stubGround(g) {
    return {
        targets: [],
        addTarget(type, x, z, rot = 0, team = 'red') {
            const y = Math.max(world.terrainHeight(x, z), 0);
            const u = {
                type, team, alive: true, isGround: true, radius: type === 'sam' || type === 'radar' ? 14 : 7, hp: 110, maxHp: 110, health: 110, maxHealth: 110, name: type.toUpperCase(),
                pos: new THREE.Vector3(x, y + 3, z), vel: new THREE.Vector3(), incoming: [],
                damage(a) { if (!this.alive) return; this.hp -= a; this.health = this.hp; if (this.hp <= 0) this.alive = false; },
                remove() {},
            };
            this.targets.push(u);
            return u;
        },
    };
}
// the air-support system on a game, switched on without its default flights
function airSystem(g) {
    const air = new AS.AirSupport(g);
    air.clear();
    air.enabled = true; air.mode = g.mode; air.warMode = true;
    g.air = air;
    return air;
}
// the world ticking: brains, then physics, then the plug-in
function run(g, air, secs, dt = 1 / 30, each = null) {
    for (let t = 0; t < secs; t += dt) {
        g.time += dt; g.war.time += dt;
        for (const a of g.aircraft) if (a.pilot && a.alive) a.pilot.update(dt);
        for (const a of g.aircraft) a.update(dt);
        air.update(dt);
        if (each && each(t) === false) return t;
    }
    return secs;
}

// ═════════════ Brevity ═════════════
describe('brevity: BRAA, bullseye, aspects, groups and the words', () => {
    test('bearings are true (north −z, east +x) and three digits', () => {
        assert.equal(Math.round(BR.bearing(0, 0, 0, -1000)), 0);
        assert.equal(Math.round(BR.bearing(0, 0, 1000, 0)), 90);
        assert.equal(Math.round(BR.bearing(0, 0, 0, 1000)), 180);
        assert.equal(Math.round(BR.bearing(0, 0, -1000, 0)), 270);
        assert.equal(BR.pad3(40), '040');
        assert.equal(BR.cardinal(44), 'NORTHEAST');
        assert.equal(BR.cardinal(181), 'SOUTH');
    });

    test('aspect bands: HOT 0–30°, FLANK 31–70°, BEAM 71–120°, DRAG 121–180° off the target\'s nose', () => {
        const me = V(0, 0, 0), him = V(0, 6000, -30000);            // 30 km north of us
        const toMe = V(0, 0, 250), off = (deg) => V(Math.sin(deg * DEG) * 250, 0, Math.cos(deg * DEG) * 250);
        assert.equal(BR.aspectName(BR.aspectAngle(me, him, toMe)), 'HOT');
        assert.equal(BR.aspectName(BR.aspectAngle(me, him, off(25))), 'HOT');
        assert.equal(BR.aspectName(BR.aspectAngle(me, him, off(50))), 'FLANK');
        assert.equal(BR.aspectName(BR.aspectAngle(me, him, off(95))), 'BEAM');
        assert.equal(BR.aspectName(BR.aspectAngle(me, him, off(170))), 'DRAG');
    });

    test('a BRAA call: bearing/range in NM, altitude in thousands (feet below 1,000), aspect with direction', () => {
        const me = V(0, 3000, 0);
        // a group 35 NM out on bearing 040, at 20,000 ft, heading straight for us
        const b = 40 * DEG, R = 35 * NM;
        const pos = V(Math.sin(b) * R, 20000 / BR.FT, -Math.cos(b) * R);
        const vel = V(-Math.sin(b) * 240, 0, Math.cos(b) * 240);
        assert.equal(BR.formatBraa(BR.braa(me, pos, vel)), 'BRAA 040/35, 20 THOUSAND, HOT');
        // beaming: across our line of sight (a track of 130°, square to the 220° line back to us); flanking at 50° off
        const trk = (deg) => V(Math.sin(deg * DEG) * 240, 0, -Math.cos(deg * DEG) * 240);
        assert.equal(BR.formatBraa(BR.braa(me, pos, trk(130))), 'BRAA 040/35, 20 THOUSAND, BEAM SOUTHEAST');
        assert.equal(BR.formatBraa(BR.braa(me, pos, trk(270))), 'BRAA 040/35, 20 THOUSAND, FLANK WEST');
        assert.equal(BR.altWords(480), '500 FEET');
        assert.equal(BR.altWords(20400), '20 THOUSAND');
        assert.equal(BR.angels(23100), 'ANGELS 23');
        // the whole group line, with its fill-ins, and bullseye format
        const g2 = { pos, vel, n: 2, members: [], type: 'FLANKER' };
        assert.equal(BR.groupBraa(me, g2, 'HOSTILE'), 'GROUP BRAA 040/35, 20 THOUSAND, HOT, HOSTILE, 2 CONTACTS, FLANKER');
        assert.equal(BR.groupBullseye({ x: 0, z: 0 }, { pos: V(0, 9000, -30 * NM), vel: V(0, 0, 200), n: 4, members: [] }), 'GROUP BULLSEYE 000/30, 30 THOUSAND, TRACK SOUTH, HOSTILE, HEAVY, 4 CONTACTS');
    });

    test('groups: contacts within 3 NM are one; a picture names two groups by their spread', () => {
        const c = (x, z) => ({ pos: V(x, 6000, z), vel: V(0, 0, 200), n: 1 });
        const g1 = BR.groupContacts([c(0, 0), c(2000, 1000), c(30000, 0)]);
        assert.equal(g1.length, 2);
        assert.equal(g1[0].n, 2);
        assert.equal(BR.pictureCall({ x: 0, z: 0 }, []), 'PICTURE CLEAN');
        assert.match(BR.pictureCall({ x: 0, z: 0 }, [{ ...g1[1], id: 'HOSTILE' }]), /^PICTURE, SINGLE GROUP BULLSEYE 090\/16, 20 THOUSAND, TRACK SOUTH, HOSTILE$/);
        const two = BR.groupContacts([c(0, -40000), c(0, 0)]).map(q => ({ ...q, id: 'HOSTILE' }));
        const pic = BR.pictureCall({ x: 0, z: 0 }, two);
        assert.match(pic, /^PICTURE, 2 GROUPS, /);
        assert.match(pic, /NORTH GROUP BULLSEYE 000\/22/);
        assert.match(pic, /SOUTH GROUP BULLSEYE/);
    });

    test('DECLARE: CLEAN, FRIENDLY, FURBALL, HOSTILE (identified or out of their airspace), BOGEY, NEUTRAL', () => {
        assert.equal(BR.declare({ team: 'red', known: 1 }, 'blue', { held: false }), 'CLEAN');
        assert.equal(BR.declare({ team: 'blue', known: 3 }, 'blue'), 'FRIENDLY');
        assert.equal(BR.declare({ team: 'red', known: 2 }, 'blue', { friendliesNear: true }), 'FURBALL');
        assert.equal(BR.declare({ team: 'red', known: 2 }, 'blue'), 'HOSTILE');
        assert.equal(BR.declare({ team: 'red', known: 1, hostileOrigin: true }, 'blue'), 'HOSTILE');
        assert.equal(BR.declare({ team: 'red', known: 1 }, 'blue'), 'BOGEY');
        assert.equal(BR.declare({ team: 'neutral', known: 0 }, 'blue', { neutral: true }), 'NEUTRAL');
    });

    test('said the way a controller says it', () => {
        assert.equal(BR.speakable('VIPER 1, MAGIC, GROUP BRAA 040/35, 20 THOUSAND, HOT, HOSTILE'), 'viper 1, magic, group bra zero four zero, 35, 20 thousand, hot, hostile');
    });
});

// ═════════════ The AWACS ═════════════
describe('the AWACS radar and its controller', () => {
    test('what the E-3 sees: range by size (stealth late), the notch for a low beamer, terrain, jamming', () => {
        const g = airGame(), war = g.war;
        const awacs = V(0, 9400, 40000);
        const far = V(0, 8000, -60000); // 100 km north
        assert.equal(AW.awacsSees(war, 'blue', awacs, far, V(0, 0, 250), 'su35'), true, 'a fighter at 100 km');
        assert.equal(AW.awacsSees(war, 'blue', awacs, far, V(0, 0, 250), 'f22'), false, 'an F-22 at 100 km');
        assert.equal(AW.awacsSees(war, 'blue', awacs, V(0, 8000, 20000), V(0, 0, 250), 'f22'), true, 'an F-22 at 20 km');
        // low over flat sea (no terrain to hide behind) 30 km out: closing it's seen, beaming it's in the notch
        let sea = null;
        for (let x = -60000; x < 60000 && !sea; x += 2500) for (let z = 20000; z < 70000 && !sea; z += 2500) {
            let ok = true;
            for (let k = -3; k <= 3 && ok; k++) if (world.terrainHeight(x + k * 800, z) > -20) ok = false;
            if (ok) sea = V(x, 200, z);
        }
        assert.ok(sea, 'found open sea');
        const from = V(sea.x, 9400, sea.z + 30000);
        assert.equal(AW.awacsSees(war, 'blue', from, sea, V(0, 0, 220), 'su35'), true, 'low, closing');
        assert.equal(AW.awacsSees(war, 'blue', from, sea, V(220, 0, 0), 'su35'), false, 'low and beaming: in the Doppler notch');
        assert.equal(AW.awacsSees(war, 'blue', from, V(sea.x, 6000, sea.z), V(220, 0, 0), 'su35'), true, 'beaming but high: clear of the clutter');
        // jamming shrinks the reach
        war.jam = () => 0.2;
        assert.equal(AW.awacsSees(war, 'blue', awacs, far, V(0, 0, 250), 'su35'), false, 'jammed at 100 km');
        war.jam = null;
    });

    test('MAGIC holds the bandits, calls POPUP / THREAT / MERGED in brevity, answers BOGEY DOPE and DECLARE; lost, the picture goes', () => seeded(7, () => {
        // (a dogfight: nothing briefed, the bandits start unknown)
        const g = airGame({ mode: 'dogfight' }), air = airSystem(g), war = g.war;
        const e3 = air.spawnAWACS('blue', { x: 0, z: 45000 });
        // the player 20 km north of the AWACS track, heading north; a pair of Su-35s 30 km further, heading for him
        const p = new Aircraft(g, 'f16', { team: 'blue', isPlayer: true, name: 'VIPER' });
        p.spawnAir(V(0, 6000, 5000), 0, 0.6); g.aircraft.push(p); g.player = p;
        const red = [0, 1].map(i => { const a = new Aircraft(g, 'su35', { team: 'red' }); a.spawnAir(V(i * 1500, 7000, -25000), Math.PI, 0.6); g.aircraft.push(a); return a; });
        war.sync();
        const calls = () => war.radioLog.map(m => m.text);
        run(g, air, 14);
        for (const a of red) assert.ok(war.known(a) >= W.INTEL.CONTACT, 'the sweep reveals each bandit');
        assert.equal(war.rec(red[0]).source, 'awacs');
        assert.ok(calls().some(t => /^VIPER 1, MAGIC, (POPUP|THREAT,) GROUP BRAA \d{3}\/\d+, \d+ THOUSAND, (HOT|FLANK \w+), HOSTILE, 2 CONTACTS/.test(t)), 'a POPUP / THREAT call: ' + calls().join(' | '));
        air.awacsCtl.bogeyDope();
        assert.match(calls().at(-1), /^VIPER 1, MAGIC, GROUP BRAA \d{3}\/\d+, /);
        g.lockTarget = red[0];
        const ans = air.awacsCtl.declare();
        assert.match(ans, /^HOSTILE/, 'declared hostile (out of their airspace, no IFF)');
        // they close to the merge
        run(g, air, 60, 1 / 30, () => (red[0].pos.distanceTo(p.pos) < 2500 ? false : undefined));
        run(g, air, 3);
        assert.ok(calls().some(t => t === 'VIPER 1, MAGIC, MERGED'), 'MERGED');
        // the AWACS is shot down: COMMAND says so and no more looks
        e3.ac.alive = false;
        run(g, air, 1);
        assert.ok(calls().some(t => /MAGIC IS DOWN — WE'VE LOST THE AIR PICTURE/.test(t)));
        const seen = war.rec(red[1]).lastSeen;
        run(g, air, 12);
        assert.ok(war.rec(red[1]).lastSeen === seen || war.rec(red[1]).source !== 'awacs', 'no more AWACS looks');
        assert.equal(air.awacs('blue', true), null);
    }));
});

// ═════════════ Tankers ═════════════
describe('tanker tracks and the boom and drogue geometry', () => {
    test('a racetrack is continuous, its legs straight and its turns the right radius', () => {
        const T = RF.makeTrack({ x: 1000, z: -2000, heading: Math.PI / 2, leg: 30000, R: 8000, alt: 6000, speed: 200 });
        const L = RF.trackLength(T);
        assert.ok(Math.abs(L - (60000 + 2 * Math.PI * 8000)) < 1e-6);
        const p = { x: 0, z: 0 }, q = { x: 0, z: 0 }, d = { x: 0, z: 0 };
        for (let s = 0; s < L; s += 50) {
            RF.trackPoint(T, s, p, d);
            RF.trackPoint(T, s + 50, q, null);
            assert.ok(Math.abs(Math.hypot(q.x - p.x, q.z - p.z) - 50) < 0.5, 'continuous at ' + s);
            assert.ok(Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-9);
        }
        // the first leg runs east, the turns are 8 km from the centre line
        RF.trackPoint(T, 1000, p, d);
        assert.ok(Math.abs(d.x - 1) < 1e-9 && Math.abs(d.z) < 1e-9);
        assert.ok(Math.abs(Math.abs(p.z - T.z) - 8000) < 1e-6);
        // the nearest point finds its own arc length back
        for (const s of [500, 20000, 40000, 70000, 100000]) {
            RF.trackPoint(T, s, p, null);
            const s2 = RF.trackNearest(T, p.x, p.z);
            RF.trackPoint(T, s2, q, null);
            assert.ok(Math.hypot(q.x - p.x, q.z - p.z) < 2, 'nearest to s = ' + s);
        }
        // a turn at 200 m/s on an 8.5 km radius banks ~26°
        assert.ok(Math.abs(RF.trackBank({ R: 8500 }, 200) / DEG - 25.6) < 0.5);
    });

    test('boom: solved onto a receptacle and back; the envelope and the director lights', () => {
        const env = RF.boomEnvelope({ pitchMin: 20, pitchMax: 40, yawMax: 15 }, 6);
        assert.ok(Math.abs(env.ideal / DEG - 30) < 1e-9);
        assert.ok(Math.abs(env.extMin - 6 * 0.3048) < 1e-9 && Math.abs(env.extMax - 18 * 0.3048) < 1e-9 && Math.abs(env.extIdeal - 12 * 0.3048) < 1e-9);
        const H = V(0, -2.4, 16.5), L0 = 8;
        // the ideal contact point: 30° down, 12 ft out
        const cp = RF.boomTip(H, L0, env.ideal, 0, env.extIdeal, V());
        const sol = RF.boomSolve(H, cp, L0);
        assert.ok(Math.abs(sol.pitch - env.ideal) < 1e-9 && Math.abs(sol.yaw) < 1e-9 && Math.abs(sol.ext - env.extIdeal) < 1e-9);
        let st = RF.boomStatus(sol, env);
        assert.equal(st.ok, true);
        assert.equal(st.elevZone, 'green'); assert.equal(st.telZone, 'green');
        // a receiver 1.5 m low and 2 m back: the lights say UP and FORWARD
        st = RF.boomStatus(RF.boomSolve(H, V(cp.x, cp.y - 1.5, cp.z + 2), L0), env);
        assert.ok(st.elev > 0.1, 'UP'); assert.ok(st.tel > 0.1, 'FORWARD');
        // out of the envelope: each limit
        assert.equal(RF.boomStatus(RF.boomSolve(H, V(cp.x, cp.y + 3.5, cp.z), L0), env).why, 'ELEVATION UPPER LIMIT');
        assert.equal(RF.boomStatus(RF.boomSolve(H, V(cp.x, cp.y - 5, cp.z - 3), L0), env).why, 'ELEVATION LOWER LIMIT');
        assert.equal(RF.boomStatus(RF.boomSolve(H, V(cp.x + 4, cp.y, cp.z), L0), env).why, 'AZIMUTH LIMIT');
        assert.equal(RF.boomStatus(RF.boomSolve(H, V(cp.x, cp.y + 1.4, cp.z - 2.6), L0), env).why, 'INNER LIMIT');
        assert.equal(RF.boomStatus(RF.boomSolve(H, V(cp.x, cp.y - 1.3, cp.z + 2.3), L0), env).why, 'OUTER LIMIT');
    });

    test('hose and drogue: the trailed basket, the capture, the refuelling range and its lights', () => {
        const dr = { E: V(-17, 0.6, 26), len: 21, droop: 5 * DEG };
        const B = RF.drogueFree(dr, 1, { x: 0, y: 0 }, V());
        assert.ok(Math.abs(B.distanceTo(dr.E) - 21) < 1e-9);
        assert.ok(B.y < dr.E.y - 1.5, 'the hose sags');
        // a probe tip going through the basket plane: centred and slow → contact; on the rim; too fast; stopped short
        const at = (dx, dy, dz) => V(B.x + dx, B.y + dy, B.z + dz);
        assert.equal(RF.probeCapture(at(0.1, 0, 0.3), at(0.1, 0, -0.2), B, 1.2), 'contact');
        assert.equal(RF.probeCapture(at(0.6, 0, 0.3), at(0.6, 0, -0.2), B, 1.2), 'rim');
        assert.equal(RF.probeCapture(at(0, 0, 0.3), at(0, 0, -0.2), B, 3.5), 'fast');
        assert.equal(RF.probeCapture(at(0, 0, 1.3), at(0, 0, 0.8), B, 1.2), null);
        // pushed in 3 m: green; 0.5 m: amber; past the inner limit: flashing amber (and let go further in);
        // pulled past full trail or off the trail line: disconnect
        const push = (m) => RF.drogueState(dr, V(dr.E.x, dr.E.y - Math.sin(dr.droop) * (21 - m), dr.E.z + Math.cos(dr.droop) * (21 - m)));
        assert.equal(RF.drogueLights(push(3)).light, 'green');
        assert.equal(RF.drogueLights(push(3)).flow, true);
        assert.equal(RF.drogueLights(push(0.5)).light, 'amber');
        assert.equal(RF.drogueLights(push(6.8)).light, 'amber-flash');
        assert.equal(RF.drogueLights(push(9)).disconnect, true);
        assert.equal(RF.drogueLights(push(-1)).disconnect, true);
        const st = RF.drogueState(dr, V(dr.E.x + 7, dr.E.y - 1, dr.E.z + 17));
        assert.ok(st.angle > RF.DROGUE.angleMax && RF.drogueLights(st).disconnect, 'too far off the trail line');
    });

    test('fuel: real rates (boom 6,500 lb/min, MPRS 2,680 lb/min, UPAZ 2,300 l/min) and time to full', () => {
        assert.ok(Math.abs(RF.transferRate('kc135', 'boom') * 60 / RF.LB - 6500) < 1);
        assert.ok(Math.abs(RF.transferRate('kc135', 'l') * 60 / RF.LB - 2680) < 1);
        assert.ok(Math.abs(RF.transferRate('il78', 'c') * 60 - 2300 * 0.8) < 1);
        assert.ok(Math.abs(RF.timeToFull('f16', 0.5, RF.transferRate('kc135', 'boom')) - 3175 * 0.5 / (6500 * RF.LB / 60)) < 1e-6);
        // the AR speed: 280 kt indicated at the tanker's height, slower for a slow receiver
        const tas = RF.arSpeed('kc135', config.AIRCRAFT.f16, 6100);
        assert.ok(tas > 190 && tas < 215, 'TAS ' + tas);
        assert.ok(RF.arSpeed('kc135', config.AIRCRAFT.a10, 6100) < 175);
    });
});

// ═════════════ A receiver flown to the tanker ═════════════
describe('air refuelling, flown', () => {
    const fly = (rxType, dt = 1 / 30) => seeded(3, () => {
        const g = airGame({ mode: 'freeflight' }), air = airSystem(g);
        const tk = air.spawnTanker('blue', { x: 0, z: 20000 });
        tk.keepReal = true;
        // the receiver 4 km behind and a little below the tanker, same heading, flown by the AR controller (AI)
        const back = tk.ac.vel.clone().normalize().multiplyScalar(-4000);
        const rx = new Aircraft(g, rxType, { team: 'blue', name: 'BOLT' });
        rx.spawnAir(tk.ac.pos.clone().add(back).add(V(150, -300, 0)), Math.atan2(-tk.ac.vel.x, -tk.ac.vel.z), 0.62);
        rx.fuel = 0.5;
        new Pilot(g, rx, 0.7);
        g.aircraft.push(rx);
        g.war.sync();
        const s = air.requestTanker(rx, { quiet: true });
        assert.ok(s, 'a session');
        const log = { states: [], maxErr: 0, sumErr: 0, n: 0, flowT: 0 };
        run(g, air, 420, dt, () => {
            if (log.states.at(-1) !== s.state) log.states.push(s.state);
            if (s.flow) { log.flowT += dt; log.maxErr = Math.max(log.maxErr, s.err.dist); log.sumErr += s.err.dist; log.n++; }
            if (s.done || (s.state === 'post')) return false;
        });
        log.meanErr = log.sumErr / Math.max(log.n, 1);
        console.log(`    ${rxType}: ${log.states.join(' → ')} · fuel flowed ${log.flowT.toFixed(0)} s · contact error mean ${log.meanErr.toFixed(2)} m, worst ${log.maxErr.toFixed(2)} m`);
        return { s, rx, tk, log, g };
    });

    test('boom (F-16 on the KC-135R): rendezvous, join, pre-contact, contact, fuel, disconnect — within limits', () => {
        const { s, rx, log, g } = fly('f16', 1 / 60);
        assert.equal(s.station, 'boom');
        for (const st of ['rendezvous', 'join', 'observe', 'precontact', 'contact']) assert.ok(log.states.includes(st), st + ' in ' + log.states.join(' → '));
        assert.ok(log.flowT > 5, 'fuel flowed ' + log.flowT.toFixed(1) + ' s');
        assert.ok(rx.fuel > 0.99, 'full: ' + rx.fuel.toFixed(3));
        // (the telescope gives ±1.8 m fore and aft, the elevation ±2 m: it never came close to a disconnect)
        assert.ok(log.meanErr < 0.6 && log.maxErr < 1.8, 'held the contact position: mean ' + log.meanErr.toFixed(2) + ', worst ' + log.maxErr.toFixed(2) + ' m');
        assert.ok(!g.war.radioLog.some(m => /DISCONNECT —|BREAKAWAY/.test(m.text)), 'no disconnect at a limit, no breakaway');
        assert.ok(g.war.radioLog.some(m => /CLEARED TO PRE-CONTACT/.test(m.text)) && g.war.radioLog.some(m => /^CONTACT$/.test(m.text)) && g.war.radioLog.some(m => /YOU'RE FULL/.test(m.text)));
        // the offload at the boom's rate: half an F-16's tank, 1,590 kg, in about half a minute
        assert.ok(Math.abs(s.onload - 0.5 * 3175) < 60, 'onload ' + s.onload.toFixed(0) + ' kg');
        assert.ok(log.flowT < 3175 * 0.5 / RF.transferRate('kc135', 'boom') + 6);
    });

    test('hose (F/A-18E on the KC-135R\'s MPRS pod): into the basket and fuel at the drogue rate', () => {
        const { s, rx, log } = fly('fa18');
        assert.ok(s.station === 'l' || s.station === 'r', 'a wing hose: ' + s.station);
        for (const st of ['precontact', 'contact']) assert.ok(log.states.includes(st), st + ' in ' + log.states.join(' → '));
        assert.ok(log.flowT > 60, 'fuel flowed ' + log.flowT.toFixed(0) + ' s');
        assert.ok(rx.fuel > 0.6, 'fuel ' + rx.fuel.toFixed(2));
        const rate = s.onload / log.flowT;
        assert.ok(Math.abs(rate - RF.transferRate('kc135', 'l')) < 1, 'rate ' + rate.toFixed(1) + ' kg/s');
    });

    test('out of the envelope it disconnects, and the receiver is cleared back to pre-contact', () => {
        const g = airGame({ mode: 'freeflight' }), air = airSystem(g);
        const tk = air.spawnTanker('blue', { x: 0, z: 20000 });
        const rx = new Aircraft(g, 'f16', { team: 'blue', name: 'BOLT' });
        rx.spawnAir(tk.ac.pos.clone(), 0, 0.6); g.aircraft.push(rx); new Pilot(g, rx, 0.7);
        rx.fuel = 0.3;
        const s = new RF.RefuelSession(air, rx, tk, { auto: true, ai: true });
        // put the receptacle on the contact point, plugged in
        s.set('contact');
        tk.ops.stations.boom.session = s;
        tk.ops.boom.latched = true; s.flow = true;
        const cp = RF.boomContactPoint(tk.ops.rig.boom, V());
        const place = (dy, dz) => { rx.pos.copy(RF.toWorld(tk.ac, V(cp.x, cp.y + dy, cp.z + dz), V())).sub(RF.toWorld(rx, s.ref, V()).sub(rx.pos)); rx.quat.copy(tk.ac.quat); };
        place(0, 0);
        s.update(1 / 30);
        assert.equal(s.state, 'contact'); assert.equal(tk.ops.boom.latched, true);
        place(0, 3.5); // 3.5 m aft: past the telescope's outer limit
        s.update(1 / 30);
        assert.equal(s.state, 'precontact');
        assert.equal(tk.ops.boom.latched, false);
        assert.ok(g.war.radioLog.some(m => /DISCONNECT — OUTER LIMIT/.test(m.text)));
    });

    test('fuel transfer: the receiver gains what the tanker gives; full, it\'s sent to the right wing', () => {
        const g = airGame({ mode: 'freeflight' }), air = airSystem(g);
        const tk = air.spawnTanker('blue', { x: 0, z: 20000 });
        const rx = new Aircraft(g, 'f15', { team: 'blue', name: 'BOLT' });
        rx.spawnAir(tk.ac.pos.clone(), 0, 0.6); g.aircraft.push(rx);
        rx.fuel = 0.2;
        let done = null;
        g.events.on('refuelDone', (a, d) => { done = d; });
        const s = new RF.RefuelSession(air, rx, tk, { auto: true, ai: true });
        s.set('contact'); s.flow = true;
        const give0 = tk.ops.give;
        s.transfer(10);
        const kg = 10 * RF.transferRate('kc135', 'boom');
        assert.ok(Math.abs(s.onload - kg) < 1e-6);
        assert.ok(Math.abs(rx.fuel - (0.2 + kg / RF.fuelKg('f15'))) < 1e-9);
        assert.ok(Math.abs(give0 - tk.ops.give - kg) < 1e-6);
        for (let i = 0; i < 400 && s.state === 'contact'; i++) s.transfer(1);
        assert.equal(s.state, 'post');
        assert.ok(rx.fuel >= 0.995);
        assert.ok(done && Math.abs(done.kg - 0.8 * RF.fuelKg('f15')) < 50, 'onload ' + (done && done.kg.toFixed(0)));
    });
});

// ═════════════ Recon ═════════════
describe('reconnaissance and SIGINT', () => {
    test('dwell: close, big, uncovered things are quick; the Global Hawk leaves small things far off unidentified', () => {
        const u = (r, conceal = 0) => ({ radius: r, conceal });
        const a = RC.reconDwell('mq9', 3000, u(14), null), b = RC.reconDwell('mq9', 9000, u(4), null), c = RC.reconDwell('mq9', 3000, u(14, 0.6), null);
        assert.ok(a.contact < b.contact && a.ident < b.ident && a.confirm < b.confirm);
        assert.ok(c.ident > a.ident * 2, 'camouflage slows identification');
        assert.equal(RC.reconDwell('mq9', 12000, u(14), null), null, 'out of the ball\'s reach');
        assert.equal(RC.reconDwell('rq4', 20000, u(5), null).ident, null);
        assert.ok(RC.reconDwell('rq4', 20000, u(14), null).ident > 0);
        assert.ok(RC.inSwath(V(0, 0, 13000), V(-20000, 0, 0), V(20000, 0, 0), 14000));
        assert.ok(!RC.inSwath(V(0, 0, 15000), V(-20000, 0, 0), V(20000, 0, 0), 14000));
    });

    test('a Reaper sent to an area finds, identifies and confirms what\'s there (war.reveal … recon), watches it for BDA', () => seeded(11, () => {
        const g = airGame(), air = airSystem(g), war = g.war;
        // a SAM site and two trucks on flat ground in their territory, a tank 25 km away
        const A = { x: 7000, z: -17000 };
        const units = [g.ground.addTarget('sam', A.x, A.z), g.ground.addTarget('truck', A.x + 600, A.z + 400), g.ground.addTarget('truck', A.x - 500, A.z + 700)];
        const far = g.ground.addTarget('tank', A.x + 25000, A.z);
        war.sync();
        const f = air.sendRecon('mq9', { x: A.x, z: A.z, r: 2000 });
        assert.equal(f.kind, 'mq9');
        run(g, air, 420, 1 / 15, () => (units.every(u => war.known(u) >= W.INTEL.CONFIRMED) ? false : undefined));
        for (const u of units) {
            assert.ok(war.known(u) >= W.INTEL.IDENTIFIED, u.type + ' identified (' + war.known(u) + ')');
            assert.equal(war.rec(u).source, 'recon');
        }
        assert.ok(units.some(u => war.known(u) === W.INTEL.CONFIRMED), 'confirmed after watching');
        assert.equal(war.known(far), 0, 'the tank 25 km off stays unknown');
        assert.ok(air.watches(units[0].pos), 'a BDA watcher over the area');
        assert.ok(!air.watches(far.pos));
        assert.ok(war.radioLog.some(m => /EYES ON/.test(m.text)));
    }));

    test('SIGINT: the Rivet Joint fixes radiating emitters (CONTACT, the fix closing in), then identifies them; silent ones stay hidden', () => seeded(5, () => {
        const g = airGame(), air = airSystem(g), war = g.war;
        const radar = g.ground.addTarget('radar', 7000, -17000);
        const sam = g.ground.addTarget('sam', 8200, -16000);
        const silent = g.ground.addTarget('sam', 5800, -18000);
        silent.emitting = false;
        war.sync();
        // (the airfield's radar is on pre-war imagery, a SAM site suspected: start them all unknown)
        for (const u of [radar, sam, silent]) { war.rec(u).known = 0; war.rec(u).source = null; }
        assert.equal(war.known(radar), 0);
        const f = air.sendRecon('rc135', null, true);
        let fixedT = null, errs = [];
        run(g, air, 240, 1 / 10, (t) => {
            if (fixedT == null && war.known(sam) >= W.INTEL.CONTACT) fixedT = t;
            if (war.known(sam) === W.INTEL.CONTACT) errs.push(war.rec(sam).lastPos.distanceTo(sam.pos));
            if (war.known(radar) >= 2 && war.known(sam) >= 2) return false;
        });
        assert.ok(fixedT != null, 'a fix');
        assert.equal(war.known(radar), W.INTEL.IDENTIFIED, 'the search radar identified');
        assert.equal(war.known(sam), W.INTEL.IDENTIFIED, 'the SAM tracker identified');
        assert.equal(war.rec(sam).source, 'sigint');
        assert.equal(war.known(silent), 0, 'a radar that keeps quiet isn\'t heard');
        if (errs.length > 4) assert.ok(errs[errs.length - 1] <= errs[0], 'the fix closes in: ' + errs[0].toFixed(0) + ' → ' + errs[errs.length - 1].toFixed(0) + ' m');
        // the pure parts: dwell by strength and distance, the radio horizon
        const em = EW.emitterOf(sam, war.rec(sam));
        assert.equal(em.name, 'SA-6 STRAIGHT FLUSH');
        const near = EW.sigintDwell(em, 20000), farD = EW.sigintDwell(em, 120000);
        assert.ok(near.fix < farD.fix && near.ident < farD.ident && near.fix < near.ident);
        const low = V(0, 50, 60000);
        assert.equal(EW.sigintHears(low, em, V(0, 20, 0), () => 0, () => true), false, 'two antennas near the ground 60 km apart: over the horizon');
        assert.equal(EW.sigintHears(V(0, 10000, 60000), em, V(0, 20, 0), () => 0, () => true), true);
        void f;
    }));
});

// ═════════════ Jamming ═════════════
describe('electronic warfare: noise jamming and burn-through', () => {
    test('a stand-off jammer blinds a radar along its bearing, less off it; a self-screen hides its jet until burn-through', () => {
        const radar = V(0, 20, 0), target = V(0, 6000, 40000);
        const alq = { pos: V(0, 7000, 60000), K: EW.JAMMERS.alq99.K, brg: 0, half: 45 * DEG };  // south of the radar, pods north at it
        assert.equal(EW.jamFactor(radar, target, []), 1);
        const main = EW.jamFactor(radar, target, [alq]);
        assert.ok(main < 0.2, 'main lobe: ' + main.toFixed(3));
        const side = EW.jamFactor(radar, V(40000, 6000, 0), [alq]);
        assert.ok(side > main * 3 && side < 0.9, 'side lobes: ' + side.toFixed(3));
        const away = EW.jamFactor(radar, target, [{ ...alq, brg: Math.PI }]);
        assert.ok(away > main * 2, 'pods pointed elsewhere: ' + away.toFixed(3));
        // self-protection: detected (d < R0 · factor) only inside ≈ R0² / K
        const R0 = 45000, K = EW.JAMMERS.khibiny.K;
        const seenAt = (d) => { const j = { pos: V(0, 6000, -d), K, brg: 0, half: Math.PI }; return d < R0 * EW.jamFactor(V(0, 6000, 0), j.pos, [j]); };
        assert.equal(seenAt(24000), false);
        assert.equal(seenAt(9000), true);
        const bt = EW.burnThrough(R0, K);
        assert.ok(seenAt(bt * 0.95) && !seenAt(bt * 1.1), 'burn-through at ' + (bt / 1000).toFixed(1) + ' km');
    });

    test('war.coverage and SAM reach shrink under a Growler\'s jamming (air.jam), and come back when it stops', () => {
        const g = airGame(), air = airSystem(g), war = g.war;
        const radar = g.ground.addTarget('radar', 0, -40000);
        radar.radarRange = 90000;
        war.sync();
        const jet = V(0, 6000, -10000); // 30 km south of the radar
        assert.ok(war.coverage('red', jet) > 0.5, 'seen before');
        const growler = { pos: V(0, 7000, 5000), team: 'blue', type: 'ea18g', alive: true };
        const j = air.jam(growler, true, { at: radar });
        assert.equal(j.kind, 'alq99');
        assert.equal(war.coverage('red', jet), 0, 'jammed: the jet is in the Growler\'s shadow');
        const jf = war.jamFactor('red', radar.pos, jet);
        assert.ok(jf < 0.2);
        // burn-through: close enough to the radar it's seen again
        assert.ok(war.coverage('red', V(0, 6000, -40000 + 90000 * jf * 0.8)) > 0, 'burn-through inside ' + (90 * jf).toFixed(1) + ' km');
        air.jam(growler, false);
        assert.ok(war.coverage('red', jet) > 0.5, 'back once the music stops');
    });
});

// ═════════════ Bombers ═════════════
describe('bombers: the stand-off raid through the strike system', () => {
    const strikesOn = (g) => {
        const st = new ST.StrikeManager(g);
        st.enabled = true;
        st.boom = () => {}; st.audioLaunch = () => {};  // (no delayed sounds in a test)
        g.strikes = st;
        return st;
    };

    test('a Tu-95 raid plans a launch point 34 km out and launches Kh-101s (AirLaunchSource) that fly to the target and hit it', () => seeded(9, () => {
        const g = airGame(), st = strikesOn(g), war = g.war;
        const target = g.ground.addTarget('radar', 0, 0);
        target.team = 'blue';
        war.sync();
        const f = { types: ['tu95', 'tu95'], pos: V(0, 9000, -90000), vel: V(0, 0, 200), hp: [1, 1], n: 2, done: false, target: { pos: target.pos, unit: target, label: 'THE RADAR' } };
        const plan = BM.planStandoff(f);
        assert.ok(plan && plan.stock.kh101 === 12, 'twelve Kh-101s');
        assert.ok(Math.abs(Math.hypot(plan.lp.x, plan.lp.z) - BM.STANDOFF.launch) < 1, 'launch point 34 km out');
        assert.ok(f.route[0].launch && f.bombs.every(b => b === 0));
        const src = st.addSource(new BM.AirLaunchSource(st, f, { name: 'BEAR RAID', team: 'red', kind: 'bomber', stock: plan.stock }));
        f.pos.copy(plan.lp);
        let launched = 0, impacts = 0;
        g.events.on('strategicLaunch', () => launched++);
        g.events.on('strategicImpact', () => impacts++);
        const strike = st.request('standoff', [target], 'red', true);
        assert.ok(strike && strike.planned === 2, 'two on the target');
        assert.equal(src.stock.kh101, 10);
        let air = 0;
        for (let t = 0; t < 400 && impacts < 2; t += 1 / 30) {
            g.time += 1 / 30; war.time += 1 / 30;
            f.pos.addScaledVector(f.vel, 1 / 30);
            st.update(1 / 30);
            for (const m of st.missiles) { assert.ok(m instanceof BM.AirMissile); air = Math.max(air, m.age); }
        }
        assert.equal(launched, 2);
        assert.equal(impacts, 2, 'both arrived');
        assert.ok(!target.alive || target.hp < 110, 'the radar was hit (hp ' + target.hp + ')');
    }));

    test('air.bomberRaid (no director): two Bears fly to the launch point and release through strikes.request', () => seeded(4, () => {
        const g = airGame({ mode: 'strike' }), st = strikesOn(g), air = airSystem(g), war = g.war;
        const home = g.ground.addTarget('hangar', 0, 0);
        home.team = 'blue';
        war.sync();
        const host = air.bomberRaid('red', [home]);
        assert.ok(host && air.raids.length === 1);
        const r = air.raids[0];
        // (start them 4 km short of the launch point)
        const dir = V(r.lp.x - host.pos.x, 0, r.lp.z - host.pos.z).normalize();
        for (const f of r.own) { f.ac.pos.copy(r.lp).addScaledVector(dir, -4000); f.ac.vel.copy(dir).multiplyScalar(200); }
        let t = run(g, air, 90, 1 / 30, () => { st.update(1 / 30); return r.launched ? false : undefined; });
        assert.ok(r.launched, 'launched after ' + t.toFixed(0) + ' s');
        run(g, air, 12, 1 / 30, () => { st.update(1 / 30); });
        assert.ok(st.missiles.filter(m => m.team === 'red').length >= 2, 'cruise missiles in the air');
        assert.ok(war.radioLog.some(m => /THE BOMBERS HAVE RELEASED \d+ CRUISE MISSILES/.test(m.text)));
    }));
});

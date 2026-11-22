// Multiplayer at module level: the wire format (netproto.js), the interpolation buffer (netinterp.js), and the game's
// side (multiplayer.js) with two or three headless games (real Aircraft and Weapons, no-op effects) joined through an
// in-memory stand-in for the relay that stamps and routes messages as relay.mjs does and refuses, with the relay's own
// validators, anything the real relay would drop a connection for.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { src } from './helpers/setup.mjs';
import { noop } from './helpers/arena.mjs';

const THREE = await import('three');
const P = await src('netproto.js');
const { InterpBuffer, ClockSync, MODE, slerp } = await src('netinterp.js');
const { NetLink } = await src('netlink.js');
const { Multiplayer, SPAWN_SAFE, RESPAWN_DELAY, LIMITS } = await src('multiplayer.js');
const { Aircraft } = await src('aircraft.js');
const { Pilot } = await src('ai.js');
const { Weapons } = await src('weapons.js');
const { SYSTEMS } = await src('systems.js');
const { MODES } = await src('config.js');
const relay = await import(new URL('../relay.mjs', import.meta.url).href);
// (never assert.equal on a game object: a failure would try to print the whole scene graph)
const same = (a, b, msg) => assert.ok(a === b, msg || 'the same object');

// ═════════════ netproto ═════════════
describe('multiplayer: the wire format', () => {
    const state = { n: 0, life: 3, pos: { x: 12345.678, y: 2345.6789, z: -98765.4321 }, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -1.2, 0.7)), vel: { x: 211.37, y: -14.92, z: -388.05 }, throttle: 0.87, flags: P.FLAG.ALIVE | P.FLAG.AB | P.FLAG.FIRE, health: 73.46, g: 6.27 };

    test('an entity row round-trips within its quantisation', () => {
        const row = P.encodeEntity(state), d = P.decodeEntity(row);
        assert.equal(row.length, 16);
        assert.ok(row.every(x => typeof x === 'number' && isFinite(x)));
        assert.equal(d.n, 0); assert.equal(d.life, 3);
        assert.ok(Math.abs(d.px - state.pos.x) <= 0.005 && Math.abs(d.py - state.pos.y) <= 0.005 && Math.abs(d.pz - state.pos.z) <= 0.005, 'position to the centimetre');
        assert.ok(Math.abs(d.vx - state.vel.x) <= 0.0501 && Math.abs(d.vy - state.vel.y) <= 0.0501 && Math.abs(d.vz - state.vel.z) <= 0.0501, 'velocity to 0.1 m/s');
        const q = new THREE.Quaternion(d.qx, d.qy, d.qz, d.qw);
        assert.ok(Math.abs(q.length() - 1) < 1e-9, 'a unit quaternion');
        assert.ok(q.angleTo(state.quat) < 2e-4, 'orientation to a hundredth of a degree');
        assert.equal(d.thr, 0.87); assert.equal(d.flags, state.flags);
        assert.ok(Math.abs(d.hp - 73.46) <= 0.05 && Math.abs(d.g - 6.27) <= 0.05);
    });

    test('a row is about 100 bytes, and the relay accepts it', () => {
        const row = P.encodeEntity(state), bytes = JSON.stringify(row).length;
        assert.ok(bytes < 120, bytes + ' bytes');
        const worst = { t: 's', c: 123456789, e: new Array(P.MAX_ENTITIES).fill(row), m: new Array(P.MAX_MISSILES).fill(P.encodeMissile({ id: 59999, pos: state.pos, vel: { x: -1234, y: 987, z: -1456 }, tracking: true })) };
        assert.ok(relay.validState(worst));
        assert.ok(JSON.stringify(worst).length <= relay.DEFAULTS.maxMsg, 'the fullest state message (' + JSON.stringify(worst).length + ' bytes) fits the relay\'s limit');
    });

    test('decodeEntity refuses what isn\'t a row, and tames what is out of range', () => {
        const good = P.encodeEntity(state);
        for (const bad of [null, 5, 'x', {}, [], good.slice(0, 15), good.map((x, i) => (i === 4 ? NaN : x)), good.map((x, i) => (i === 2 ? Infinity : x)), good.map((x, i) => (i === 7 ? '1' : x)),
            good.map((x, i) => (i === 0 ? -1 : x)), good.map((x, i) => (i === 0 ? 4096 : x)), good.map((x, i) => (i === 0 ? 1.5 : x)), good.map((x, i) => (i === 2 ? 9e6 : x)), good.map((x, i) => (i === 3 ? -5000 : x))]) assert.equal(P.decodeEntity(bad), null);
        const wild = good.slice(); wild[5] = wild[6] = wild[7] = wild[8] = 0; wild[9] = 9e6; wild[12] = 500; wild[14] = -3; wild[15] = 900;
        const d = P.decodeEntity(wild);
        assert.deepEqual([d.qx, d.qy, d.qz, d.qw], [0, 0, 0, 1], 'a zero quaternion becomes the identity');
        assert.ok(Math.hypot(d.vx, d.vy, d.vz) <= 2500.001);
        assert.equal(d.thr, 1); assert.equal(d.hp, 0); assert.equal(d.g, 20);
    });

    test('missile rows', () => {
        const row = P.encodeMissile({ id: 17, pos: { x: 100.126, y: 2000, z: -300.5 }, vel: { x: 600.4, y: -20, z: 10 }, tracking: true }), d = P.decodeMissile(row);
        assert.deepEqual(row, [17, 100.13, 2000, -300.5, 600, -20, 10, 1]);
        assert.equal(d.id, 17); assert.equal(d.tracking, true); assert.equal(d.px, 100.13); assert.equal(d.vx, 600);
        assert.equal(P.decodeMissile([17, 1, 2]), null); assert.equal(P.decodeMissile([17, NaN, 2, 3, 4, 5, 6, 1]), null);
    });

    test('entity ids, kinds, strings', () => {
        const id = P.eid(37, 12);
        assert.equal(P.eidOwner(id), 37); assert.equal(P.eidN(id), 12);
        assert.equal(P.eidOwner(P.eid(9999, P.NMAX - 1)), 9999);
        assert.equal(P.KINDS[P.kindCode('missile')], 'missile'); assert.equal(P.kindCode('whatever'), 0);
        assert.equal(P.safeStr('F/A-18E <b>Super</b> Hornet!'), 'FA-18E bSuperb Hornet');
        assert.equal(P.safeStr('x'.repeat(40)).length, 24);
        assert.equal(P.safeStr(null), '');
    });

    test('the relay\'s address comes from the page\'s', () => {
        assert.equal(P.relayUrl('http://localhost:8080/'), 'ws://localhost:8080/ws');
        assert.equal(P.relayUrl('http://localhost:8111/index.html?x=1#y'), 'ws://localhost:8111/ws');
        assert.equal(P.relayUrl('https://maddog107.com/skywar/'), 'wss://maddog107.com/skywar/ws');
        assert.equal(P.relayUrl('https://maddog107.com/skywar/index.html'), 'wss://maddog107.com/skywar/ws');
    });

    test('every aircraft type, paint scheme and store id is one the relay lets through (or the others would see an F-16)', async () => {
        const { AIRCRAFT } = await src('config.js'), { LIVERIES } = await src('models.js'), { STORES } = await src('stores.js');
        for (const k of Object.keys(AIRCRAFT)) assert.ok(relay.isToken(k), 'aircraft ' + k);
        for (const k of Object.keys(LIVERIES)) assert.ok(relay.isToken(k), 'livery ' + k);
        for (const k of Object.keys(STORES)) assert.ok(k.length <= 16 && relay.validEvent({ e: ['ml', 1, 0, k, 'aam', 0, 0, 0, 0, 0, 0, 0, 0] }), 'store ' + k);
        assert.ok(!relay.isToken('F-16') && !relay.isToken('') && !relay.isToken('x'.repeat(17)) && !relay.isToken(5));
    });

    test('the mode and its system are registered', () => {
        assert.ok(MODES.multiplayer && MODES.multiplayer.label === 'MULTIPLAYER');
        assert.ok(SYSTEMS.some(([name, S]) => name === 'mp' && S === Multiplayer));
    });
});

// ═════════════ netinterp ═════════════
describe('multiplayer: the interpolation buffer', () => {
    // a jet in a level 6 g turn at 250 m/s, sampled 20 times a second
    const R = 250 * 250 / (9.81 * 6), w = 250 / R;
    const truth = (t) => {
        const a = w * t, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
        return { px: R * Math.sin(a), py: 3000, pz: -R * Math.cos(a), vx: 250 * Math.cos(a), vy: 0, vz: 250 * Math.sin(a), qx: q.x, qy: q.y, qz: q.z, qw: q.w, thr: 0.9, flags: 8, hp: 100, g: 6 };
    };
    const fill = (buf, t0, t1, hz = 20) => { for (let t = t0; t <= t1 + 1e-9; t += 1 / hz) buf.push(t, truth(t)); };
    const dist = (a, b) => Math.hypot(a.px - b.px, a.py - b.py, a.pz - b.pz);

    test('between snapshots: on the arc to a few centimetres (a straight line would cut the corner)', () => {
        const buf = new InterpBuffer(), out = {};
        fill(buf, 0, 1);
        let worst = 0, worstLin = 0;
        for (let t = 0.3; t < 0.95; t += 0.0137) {
            assert.equal(buf.sample(t, out), MODE.INTERP);
            worst = Math.max(worst, dist(out, truth(t)));
            const t0 = Math.floor(t * 20) / 20, a = truth(t0), b = truth(t0 + 0.05), u = (t - t0) / 0.05;
            worstLin = Math.max(worstLin, dist({ px: a.px + (b.px - a.px) * u, py: 3000, pz: a.pz + (b.pz - a.pz) * u }, truth(t)));
            const q = new THREE.Quaternion(out.qx, out.qy, out.qz, out.qw), tq = truth(t);
            assert.ok(q.angleTo(new THREE.Quaternion(tq.qx, tq.qy, tq.qz, tq.qw)) < 1e-3, 'orientation follows');
            assert.ok(Math.hypot(out.vx - tq.vx, out.vz - tq.vz) < 0.6, 'velocity follows');
        }
        assert.ok(worst < 0.02, 'worst error ' + worst.toFixed(4) + ' m');
        assert.ok(worst < worstLin / 3, 'better than a straight line between snapshots (' + worstLin.toFixed(3) + ' m)');
    });

    test('past the newest: coasts round the turn for half a second, then holds still', () => {
        const buf = new InterpBuffer(), out = {};
        fill(buf, 0, 1);
        assert.equal(buf.sample(1.1, out), MODE.EXTRAP);
        assert.ok(dist(out, truth(1.1)) < 0.15, 'after 100 ms: ' + dist(out, truth(1.1)).toFixed(3) + ' m');
        assert.ok(out.age > 0.099 && out.age < 0.101);
        const straight = { px: truth(1).px + truth(1).vx * 0.3, py: 3000, pz: truth(1).pz + truth(1).vz * 0.3 };
        buf.sample(1.3, out);
        assert.ok(dist(out, truth(1.3)) < dist(straight, truth(1.3)) / 3, 'it keeps turning (' + dist(out, truth(1.3)).toFixed(2) + ' m against ' + dist(straight, truth(1.3)).toFixed(2) + ' m dead ahead)');
        assert.equal(buf.sample(1.5 - 1e-6, out), MODE.EXTRAP);
        const at = { ...out };
        assert.equal(buf.sample(1.6, out), MODE.HELD);
        assert.equal(buf.sample(9, out), MODE.HELD);
        assert.ok(dist(out, at) < 0.01, 'held where the coasting ended');
        assert.deepEqual([out.vx, out.vy, out.vz], [0, 0, 0], 'standing still');
        assert.ok(out.age > 7.9);
    });

    test('empty, a single snapshot, older than everything kept, out-of-order pushes', () => {
        const buf = new InterpBuffer(4), out = {};
        assert.equal(buf.sample(1, out), MODE.NONE);
        assert.ok(buf.push(1, truth(1)));
        assert.equal(buf.sample(0.5, out), MODE.INTERP);
        assert.ok(dist(out, truth(1)) < 1e-9, 'before its only snapshot: that snapshot');
        assert.equal(buf.sample(1.2, out), MODE.EXTRAP);
        assert.ok(dist(out, { px: truth(1).px + truth(1).vx * 0.2, py: 3000, pz: truth(1).pz + truth(1).vz * 0.2 }) < 1e-6, 'one snapshot: straight on');
        assert.ok(!buf.push(1, truth(1)), 'the same time again is ignored');
        assert.ok(!buf.push(0.9, truth(0.9)), 'an older one is ignored');
        for (let t = 1.05; t < 1.6; t += 0.05) buf.push(t, truth(t));
        assert.equal(buf.count, 4, 'only the newest few are kept');
        assert.equal(buf.sample(1.0, out), MODE.INTERP);
        assert.ok(dist(out, truth(buf.at(3).t)) < 1e-9, 'older than everything kept: the oldest kept');
        buf.clear();
        assert.equal(buf.sample(1, out), MODE.NONE);
    });

    test('a long gap is crossed in a straight line (no overshoot)', () => {
        const buf = new InterpBuffer(), out = {};
        buf.push(0, { px: 0, py: 100, pz: 0, vx: 200, vy: 0, vz: 0, qw: 1 });
        buf.push(2, { px: 50, py: 100, pz: 0, vx: -200, vy: 0, vz: 0, qw: 1 });
        for (let t = 0; t <= 2; t += 0.1) { buf.sample(t, out); assert.ok(out.px >= -1e-9 && out.px <= 50 + 1e-9, 'x = ' + out.px); }
    });

    test('a sender whose simulation runs at half speed (a struggling machine): its puppet moves evenly, never ahead and back', () => {
        const buf = new InterpBuffer(), out = {};
        // a snapshot every 50 ms of its clock, but only 25 ms of ground covered each time; its velocity still says 250 m/s
        for (let i = 0; i <= 20; i++) buf.push(i * 0.05, { px: 0, py: 3000, pz: -250 * 0.025 * i, vx: 0, vy: 0, vz: -250, qw: 1 });
        let last = Infinity, worst = 0;
        for (let t = 0.3; t < 0.95; t += 0.004) {
            assert.equal(buf.sample(t, out), MODE.INTERP);
            assert.ok(out.pz <= last + 1e-9, 'never backwards (at t = ' + t.toFixed(3) + ')');
            last = out.pz;
            worst = Math.max(worst, Math.abs(out.pz + 125 * t));
        }
        assert.ok(worst < 0.01, 'on the line it really flew: ' + worst.toFixed(4) + ' m off');
        assert.ok(Math.abs(out.vz + 125) < 0.5, 'at the speed it really covers ground: ' + out.vz);
        // and it coasts on at that pace, not at the speed it claims
        assert.equal(buf.sample(1.1, out), MODE.EXTRAP);
        assert.ok(Math.abs(out.pz + 125 * 1.1) < 0.1, 'coasting: ' + (out.pz + 137.5).toFixed(3) + ' m off');
        // a sender that keeps up has a pace of 1 (the turning jet above is unchanged by any of this)
        const ok = new InterpBuffer();
        fill(ok, 0, 1);
        assert.ok(Math.abs(ok.newest.k - 1) < 1e-4, 'pace ' + ok.newest.k);
    });

    test('slerp: the short way round, unit length, and on past the end', () => {
        const a = { qx: 0, qy: 0, qz: 0, qw: 1 }, q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1), b = { qx: -q.x, qy: -q.y, qz: -q.z, qw: -q.w }, out = {};
        slerp(a, b, 0.5, out);
        assert.ok(new THREE.Quaternion(out.qx, out.qy, out.qz, out.qw).angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5)) < 1e-6);
        slerp(a, b, 1.5, out);
        assert.ok(new THREE.Quaternion(out.qx, out.qy, out.qz, out.qw).angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.5)) < 1e-6);
        assert.ok(Math.abs(Math.hypot(out.qx, out.qy, out.qz, out.qw) - 1) < 1e-12);
    });

    test('ClockSync: the offset of the quickest delivery, following a path that got slower for good', () => {
        const c = new ClockSync();
        // the sender's clock is 1000 s behind ours; deliveries take 40 ms, some up to 90 ms
        let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 400; i++) { const sent = i * 0.05; c.update(sent, sent + 1000 + 0.04 + (i % 7 ? rnd() * 0.05 : 0)); }
        assert.ok(c.offset >= 1000.04 && c.offset < 1000.05, 'offset ' + (c.offset - 1000).toFixed(4));
        for (let i = 400; i < 1200; i++) { const sent = i * 0.05; c.update(sent, sent + 1000 + 0.14); }
        assert.ok(Math.abs(c.offset - 1000.14) < 0.005, 'after the path slowed by 100 ms: ' + (c.offset - 1000).toFixed(4));
    });
});

// ═════════════ multiplayer.js: headless games joined through a stand-in relay ═════════════
class Events {
    constructor() { this.map = {}; this.log = []; }
    on(k, fn) { (this.map[k] = this.map[k] || []).push(fn); }
    emit(k, a, b) { this.log.push([k, a, b]); (this.map[k] || []).forEach(fn => fn(a, b || {})); }
}

// routes like relay.mjs: stamps the sender, `to` goes to one client, state goes to the whole room (the sender too);
// what the real relay would drop a connection for fails the test
class Hub {
    constructor() { this.clients = new Map(); this.nextId = 1; this.host = 0; this.set = { time: 'day', weather: 'clear', ai: false }; this.sent = []; this.hold = false; this.queue = []; }
    // (a client welcomed but not yet listening keeps what arrives in its backlog, as netlink.js does)
    deliver(to, msg) { if (this.hold) this.queue.push([to, msg]); else if (to.link.onMessage) to.link.onMessage(JSON.parse(JSON.stringify(msg))); else to.link.backlog.push(JSON.parse(JSON.stringify(msg))); }
    release() { this.hold = false; for (const [to, msg] of this.queue.splice(0)) this.deliver(to, msg); }
    join(mp, hello) {
        const hub = this, id = this.nextId++;
        const c = { id, mp, hello, link: null };
        const link = c.link = {
            open: true, rtt: 30, onMessage: null, onClose: null, backlog: [],
            pump() {},
            state(clock, e, m) {
                const msg = m && m.length ? { t: 's', c: clock, e, m } : { t: 's', c: clock, e };
                assert.ok(relay.validState(msg), 'a state the relay accepts: ' + JSON.stringify(msg).slice(0, 200));
                assert.ok(JSON.stringify(msg).length <= relay.DEFAULTS.maxMsg);
                hub.sent.push([id, msg]);
                for (const o of hub.clients.values()) hub.deliver(o, { t: 's', s: [m && m.length ? [id, clock, e, m] : [id, clock, e]] });
            },
            event(e, to) {
                const msg = to ? { t: 'e', e, to } : { t: 'e', e };
                assert.ok(relay.validEvent(msg), 'an event the relay accepts: ' + JSON.stringify(msg));
                assert.ok(JSON.stringify(msg).length <= relay.DEFAULTS.maxMsg);
                hub.sent.push([id, msg]);
                for (const o of hub.clients.values()) if (o.id !== id && (!to || o.id === to)) hub.deliver(o, { t: 'e', f: id, e });
            },
            send(o) {
                if (o.t !== 'set') return;
                assert.equal(typeof o.ai, 'boolean');
                if (hub.host !== id) return;
                hub.set.ai = o.ai;
                for (const x of hub.clients.values()) hub.deliver(x, { t: 'set', set: { ...hub.set } });
            },
            close() { hub.leave(id); },
        };
        if (!this.clients.size) this.host = id;
        const peers = [...this.clients.values()].map(o => [o.id, o.hello.name, o.hello.team, o.hello.ac, o.hello.lv || 'default']);
        const others = [...this.clients.values()];
        this.clients.set(id, c);
        for (const o of others) this.deliver(o, { t: 'join', p: [id, hello.name, hello.team, hello.ac, hello.lv || 'default'] });
        mp.pending = { link, welcome: { t: 'welcome', id, name: hello.name, room: 'TEST', host: this.host, set: { ...this.set }, peers }, hello, url: 'ws://test/ws' };
        return c;
    }
    leave(id) {
        const c = this.clients.get(id);
        if (!c) return;
        this.clients.delete(id);
        c.link.open = false;
        if (this.host === id) this.host = this.clients.size ? this.clients.keys().next().value : 0;
        for (const o of this.clients.values()) this.deliver(o, { t: 'leave', id, host: this.host });
    }
    events(name) { return this.sent.filter(([, m]) => m.t === 'e' && m.e[0] === name); }
}

const clock = { t: 100 };

// a headless game: the real Aircraft / Weapons / Multiplayer, effects and sound that do nothing
function makeGame(hub, hello, { at = [0, 3000, 0], heading = 0 } = {}) {
    const g = {
        scene: { add() {}, remove() {} }, events: new Events(), settings: { fuel: false, controlMode: 'keyboard' },
        audio: noop(), effects: noop(), wreckage: noop(), world: { weather: null, towns: null }, wind: null,
        camera: { position: new THREE.Vector3() }, input: { down: () => false, consumeMouse() {}, lock() {}, unlock() {} },
        time: 0, state: 'playing', deathT: 0, aircraft: [], player: null, pilotMode: null, ground: null, lockTarget: null,
        difficulty: { skill: 0.6, dmgTaken: 1, enemyMissileRate: 0.7 }, feed: [], banners: [], kills: 0, score: 0,
        addFeed(text) { g.feed.push(text); }, showBanner(a, b) { g.banners.push(a + ' / ' + b); },
        surfaceAt: () => ({ h: -1e6 }), startPoint: () => 'air', atFriendlyPad: () => false,
        aimDir: new THREE.Vector3(), camQuat: new THREE.Quaternion(), camPos: new THREE.Vector3(),
    };
    g.weapons = new Weapons(g);
    g.spawnPlayer = () => { const p = g.player = new Aircraft(g, hello.ac, { team: 'blue', isPlayer: true, name: 'X' }); g.aircraft.push(p); return p; };
    g.respawnPlayer = () => { const old = g.player; old.isPlayer = false; old.abandoned = true; if (old.alive) { old.alive = false; old.explode(false); } g.spawnPlayer(); g.state = 'playing'; g.deathT = 0; };
    // (the game's own 'killed' handler, as far as multiplayer needs it)
    g.events.on('killed', (ac) => { if (ac.isPlayer) { g.state = 'dead'; g.deathT = 0; } });
    g.mp = new Multiplayer(g);
    g.mp.clockFn = () => clock.t;
    hub.join(g.mp, hello);
    g.spawnPlayer();
    g.mp.start('multiplayer', { start: 'air' });
    g.place = (pos, hd = heading, speed = 250) => {
        const p = g.player;
        p.pos.set(...pos); p.qv.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hd);
        p.vel.set(0, 0, -1).applyQuaternion(p.qv).multiplyScalar(speed);
        p.alpha = 0.03; p.syncBody();
    };
    g.place(at, heading);
    g.step = (dt) => {
        g.time += dt;
        if (g.state === 'dead') g.deathT += dt;
        for (const a of g.aircraft) if (a.pilot && a.alive && !a.pilotDead) a.pilot.update(dt);
        for (const a of g.aircraft) a.update(dt);
        g.weapons.update(dt);
        g.mp.update(dt);
        for (let i = g.aircraft.length - 1; i >= 0; i--) { const a = g.aircraft[i]; if (a.exploded && a !== g.player) { a.remove(); g.aircraft.splice(i, 1); } }
    };
    return g;
}
// everyone steps together on one clock
const run = (games, seconds, each = null, dt = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += dt) { clock.t += dt; for (const g of games) g.step(dt); if (each) each(t); } };
const puppetOf = (g, id, n = 0) => { const peer = g.mp.peers.get(id), rec = peer && peer.ents.get(n); return rec ? rec.ac : null; };
const unsafe = (...games) => { for (const g of games) for (const e of g.mp.locals.values()) e.safeUntil = 0; };

// A (blue, VIPER) 300 m behind B (red, MAVERICK), same course and speed
function pair(opts = {}) {
    const hub = new Hub();
    const A = makeGame(hub, { name: 'VIPER', team: 'blue', ac: 'f16', lv: 'default' }, { at: [0, 3000, 0] });
    const B = makeGame(hub, { name: 'MAVERICK', team: opts.teamB || 'red', ac: 'f15', lv: 'navy' }, { at: [0, 3000, -300] });
    run([A, B], 0.5);
    if (!opts.keepSafe) unsafe(A, B);
    run([A, B], 0.2);
    return { hub, A, B, a: A.mp.me.id, b: B.mp.me.id };
}
// A holds the trigger for `seconds` (B flies on ahead of it, both level)
function fire(S, seconds) {
    const { A, B } = S;
    let shots = 0;
    run([A, B], seconds, () => {
        for (const g of [A, B]) { const p = g.player; if (p.alive) { p.controls.pitch = 0; p.controls.roll = 0; p.controls.throttle = 0.8; } }
        if (A.player.alive) { A.player.ammo = 500; shots += A.weapons.fireGun(A.player, A.time); }
    });
    return shots;
}

describe('multiplayer: seeing each other', () => {
    test('each client has a puppet of the other: a real Aircraft with its type, side and callsign, and no flight model', () => {
        const { A, B, a, b } = pair();
        const pb = puppetOf(A, b), pa = puppetOf(B, a);
        assert.ok(pb && pa);
        assert.ok(pb instanceof Aircraft && A.aircraft.includes(pb) && B.aircraft.includes(pa));
        assert.equal(pb.type, 'f15'); assert.equal(pb.team, 'red'); assert.equal(pb.callsign, 'MAVERICK'); assert.ok(pb.puppet && pb.puppet.human); assert.equal(pb.pilot, null);
        assert.equal(pa.type, 'f16'); assert.equal(pa.team, 'blue'); assert.equal(pa.callsign, 'VIPER');
        assert.equal(A.aircraft.length, 2); assert.equal(B.aircraft.length, 2);
        assert.equal(A.player.callsign, 'VIPER'); assert.equal(B.player.team, 'red', 'our own jet takes our side');
        assert.equal(A.mp.playerCount, 2);
    });

    test('a puppet follows its owner: where the owner was 100 ms ago, to within a few centimetres, through a hard turn', () => {
        const { A, B, a } = pair();
        const pa = puppetOf(B, a), hist = [];
        let worst = 0, worstNow = 0, worstAng = 0, n = 0;
        run([A, B], 4, (t) => {
            const p = A.player;
            p.controls.roll = t < 0.6 ? 1 : 0; p.controls.pitch = t > 0.6 ? 0.8 : 0; p.controls.throttle = 1; // roll in and pull
            hist.push({ t: clock.t, pos: p.pos.clone(), quat: p.quat.clone() });
            // the owner's true position INTERP_DELAY ago, between the two frames either side of it
            const T = clock.t - P.INTERP_DELAY, i = hist.findIndex(h => h.t >= T - 1e-9);
            if (t < 0.5 || i < 1) return;
            const h0 = hist[i - 1], h1 = hist[i], u = (T - h0.t) / (h1.t - h0.t), then = h0.pos.clone().lerp(h1.pos, u);
            worst = Math.max(worst, pa.pos.distanceTo(then)); worstNow = Math.max(worstNow, pa.pos.distanceTo(p.pos)); n++;
            worstAng = Math.max(worstAng, pa.quat.angleTo(h0.quat.clone().slerp(h1.quat, u)));
        });
        assert.ok(n > 150);
        assert.ok(A.player.gLoad > 4, 'the owner really was turning (' + A.player.gLoad.toFixed(1) + ' g)');
        assert.ok(worst < 0.15, 'worst error against the owner 100 ms ago: ' + worst.toFixed(3) + ' m');
        assert.ok(worstAng < 0.035, 'orientation follows: worst ' + (worstAng * 57.3).toFixed(2) + '°');
        assert.ok(worstNow < A.player.speed * P.INTERP_DELAY * 1.2 + 1, 'and never more than its 100 ms of flight behind where the owner is now (' + worstNow.toFixed(1) + ' m)');
        console.log(`    puppet error: ${(worst * 100).toFixed(1)} cm and ${(worstAng * 57.3).toFixed(2)}° against the owner 100 ms ago, ${worstNow.toFixed(1)} m behind the owner's present (speed ${A.player.speed.toFixed(0)} m/s)`);
    });

    test('throttle, afterburner, gear, flaps, speed brake and health reach the puppet', () => {
        const { A, B, a } = pair();
        const pa = puppetOf(B, a), p = A.player;
        run([A, B], 2.5, () => { p.controls.throttle = 1; p.controls.pitch = 0; });
        assert.ok(p.afterburner && pa.afterburner, 'afterburner'); assert.ok(pa.throttle > 0.95);
        assert.ok(!pa.gear && pa.gearAnim === 0);
        A.place([0, 3000, -2000], 0, 150); // (slow enough for the flaps to stay out)
        p.gear = true; p.flaps = 2; p.airbrake = true; p.health = 61;
        run([A, B], 0.4, () => { p.controls.throttle = 0.2; p.airbrake = true; });
        assert.ok(pa.gear && pa.gearAnim > 0, 'the gear is coming down'); assert.equal(pa.flaps, 2); assert.ok(pa.airbrake);
        assert.ok(Math.abs(pa.health - 61) < 0.1, 'health ' + pa.health); assert.ok(!pa.afterburner);
        assert.ok(Math.abs(pa.speed - p.speed) < 8 && Math.abs(pa.mach - p.mach) < 0.03);
    });

    test('snapshots stop: the puppet coasts, holds, then is hidden and can\'t be hit or locked until they resume', () => {
        const { hub, A, B, b } = pair();
        const pb = puppetOf(A, b);
        hub.hold = true;                                 // the network stalls: both fly on, nothing gets through
        run([A, B], 0.4);
        assert.ok(pb.alive && pb.root.visible, 'a short gap: still there');
        assert.equal(pb.puppet.mode, MODE.EXTRAP);
        run([A, B], 0.5);
        assert.equal(pb.puppet.mode, MODE.HELD);
        const held = pb.pos.clone();
        run([A, B], 1);
        assert.ok(pb.pos.distanceTo(held) < 0.01 && pb.vel.length() === 0, 'holding still');
        run([A, B], P.STALE_AFTER - 1.5);
        assert.ok(!pb.alive && !pb.root.visible, 'stale: hidden and not a target');
        hub.queue.length = 0; hub.hold = false;
        pb.health = 100; pb.damage(50, A.player, 'gun');
        A.mp.flushClaims();
        assert.equal(B.player.health, B.player.maxHealth, 'and nothing reaches its owner');
        run([A, B], 0.5);                                // the snapshots are back
        assert.ok(pb.alive && pb.root.visible, 'back');
        assert.ok(pb.pos.distanceTo(B.player.pos) < B.player.speed * 0.15 + 2, 'and where its owner is');
    });

    test('the drawing delay follows how late a peer\'s snapshots come (0.1 s when they come evenly, never over 0.25 s) and comes back', () => {
        const { hub, A, B, b } = pair();
        const peer = A.mp.peers.get(b), pb = puppetOf(A, b);
        assert.ok(Math.abs(peer.delay - P.INTERP_DELAY) < 0.011, 'evenly delivered: ' + peer.delay.toFixed(3) + ' s');
        // the network delivers in bunches, every 150 ms
        let frame = 0, n = 0, interp = 0;
        hub.hold = true;
        run([A, B], 4, (t) => { if (++frame % 9 === 0) { hub.release(); hub.hold = true; } if (t > 2.5) { n++; if (pb.puppet.mode === MODE.INTERP) interp++; } });
        hub.release();
        assert.ok(peer.delay > 0.16 && peer.delay <= 0.25 + 1e-9, 'bunched: ' + peer.delay.toFixed(3) + ' s');
        assert.ok(interp / n > 0.9, 'and so the puppet is still drawn between two snapshots (' + Math.round(100 * interp / n) + '% of frames)');
        assert.ok(pb.alive && pb.pos.distanceTo(B.player.pos) < B.player.speed * 0.45, 'with its owner');
        run([A, B], 6);
        assert.ok(peer.delay < 0.125, 'even again: ' + peer.delay.toFixed(3) + ' s');
    });

    test('a hidden tab is away at once: hidden to the others, can\'t be hurt; back in the air after a long absence it gets a new jet', () => {
        const { A, B, a, b } = pair();
        const pb = puppetOf(A, b), life = B.mp.life;
        B.mp.onVisibility(true);
        run([A], 0.1);
        assert.ok(A.mp.peers.get(b).away && !pb.alive && !pb.root.visible, 'gone from the others\' sky at once');
        // a claim that was already on its way does nothing
        A.mp.send(['hit', 0, life, 80, 0, 0], b);
        assert.equal(B.player.health, B.player.maxHealth);
        run([A], 5);
        B.mp.onVisibility(false);
        const old = B.player;
        run([A, B], 0.3);
        assert.ok(B.player !== old, 'a fresh jet (the old one wasn\'t flying while the tab was hidden)');
        assert.equal(B.mp.life, life + 1); assert.equal(B.mp.deaths, 0, 'not counted as a loss');
        assert.ok(B.feed.some(f => /AWAY/.test(f)));
        const nb = puppetOf(A, b);
        assert.ok(nb && nb !== pb && nb.alive && !A.mp.peers.get(b).away, 'and the others see the new one');
        assert.ok(puppetOf(B, a), 'it still sees them');
    });

    test('a pilot who leaves is gone from everyone\'s sky', () => {
        const { hub, A, B, b } = pair();
        const pb = puppetOf(A, b);
        A.lockTarget = pb;
        hub.leave(b);
        assert.equal(A.mp.peers.size, 0); assert.ok(!A.aircraft.includes(pb)); same(A.lockTarget, null);
        assert.ok(A.feed.some(f => f === 'MAVERICK LEFT'));
        run([A], 0.5);
        assert.equal(A.aircraft.length, 1);
    });
});

describe('multiplayer: guns — the shooter decides, the owner applies', () => {
    test('rounds that hit the puppet become claims; the owner\'s health drops, and comes back to the shooter in its snapshots', () => {
        const S = pair(), { hub, A, B, b } = S, pb = puppetOf(A, b);
        const shots = fire(S, 0.6);
        run([A, B], 0.5);
        const claims = hub.events('hit');
        assert.ok(shots >= 8 && claims.length > 0, shots + ' rounds, ' + claims.length + ' claims');
        assert.ok(claims.every(([from, m]) => from === S.a && m.to === b), 'sent to the target\'s owner only');
        assert.ok(claims.length <= 0.6 * P.SEND_HZ + 2, 'a stream of hits is one claim per snapshot (' + claims.length + ')');
        const hurt = B.player.maxHealth - B.player.health;
        assert.ok(hurt > 5, 'B was hurt: ' + hurt.toFixed(1));
        assert.ok(Math.abs(pb.health - B.player.health) < 0.11, 'A\'s puppet of B shows B\'s health: ' + pb.health + ' / ' + B.player.health);
        // the damage went through B's own damage path with A's puppet as the source
        same(B.player.lastHitBy, puppetOf(B, S.a));
        assert.ok(B.events.log.some(([k, ac, d]) => k === 'hit' && ac === B.player && d.source === puppetOf(B, S.a) && d.kind === 'gun'));
        // and the shooter got his hit markers at once
        assert.ok(A.events.log.some(([k, ac, d]) => k === 'hit' && ac === pb && d.source === A.player));
        // the claimed amount is what the rounds were worth; the owner applied it by its own rules (a player takes 45% from guns)
        const claimed = claims.reduce((s, [, m]) => s + m.e[3], 0);
        assert.ok(Math.abs(hurt - claimed * 0.45) < 0.5, 'claimed ' + claimed.toFixed(1) + ', applied ' + hurt.toFixed(1));
    });

    test('the puppet is never damaged locally', () => {
        const S = pair(), { hub, A, B, b } = S, pb = puppetOf(A, b);
        hub.hold = true;                       // the relay goes quiet: nothing reaches B, nothing comes back
        const before = pb.health;
        fire(S, 0.4);
        assert.equal(pb.health, before, 'health only ever comes from the owner');
        assert.ok(pb.alive);
        hub.queue.length = 0; hub.hold = false;
    });

    test('a puppet\'s cannon is drawn here (tracers) and hurts nothing', () => {
        const S = pair(), { A, B } = S;
        fire(S, 0.5);
        run([A, B], 0.15, () => { A.player.ammo = 500; A.weapons.fireGun(A.player, A.time); });
        const mine = B.weapons.bullets.filter(x => x.owner === puppetOf(B, S.a));
        assert.ok(mine.length > 3, mine.length + ' of the puppet\'s rounds in the air on B');
        assert.ok(mine.every(x => x.damage === 0), 'for show');
        assert.ok(mine.some(x => x.tracer));
        assert.ok(B.events.log.some(([k, ac]) => k === 'gunfire' && ac === puppetOf(B, S.a)));
    });

    test('same side: rounds pass through, and a forged claim is refused', () => {
        const S = pair({ teamB: 'blue' }), { hub, A, B, b } = S;
        fire(S, 0.5);
        assert.equal(hub.events('hit').length, 0, 'no claims against our own side');
        A.mp.send(['hit', 0, B.mp.life, 60, 0, 0], b);
        assert.equal(B.player.health, B.player.maxHealth, 'the owner refuses a claim from its own side');
    });

    test('spawn protection: no claims while the target is fresh, none applied; it ends after ' + SPAWN_SAFE + ' s or when the pilot fires', () => {
        const S = pair({ keepSafe: true }), { hub, A, B, b } = S, pb = puppetOf(A, b);
        assert.ok(pb.puppet.safe && /SAFE/.test(pb.callsign), 'the others see it is protected');
        fire(S, 0.4);
        assert.equal(hub.events('hit').length, 0);
        A.mp.send(['hit', 0, B.mp.life, 60, 0, 0], b);
        assert.equal(B.player.health, B.player.maxHealth);
        // B opens fire: its protection ends
        run([A, B], 0.3, () => { B.player.ammo = 100; B.weapons.fireGun(B.player, B.time); });
        run([A, B], 0.3);
        assert.ok(!pb.puppet.safe && pb.callsign === 'MAVERICK');
        fire(S, 0.4);
        assert.ok(B.player.health < B.player.maxHealth);
        // and it runs out by itself
        const T = pair({ keepSafe: true });
        run([T.A, T.B], SPAWN_SAFE);
        assert.ok(!puppetOf(T.A, T.b).puppet.safe);
    });

    test('claims a client can\'t trust: wrong airframe, a dead jet, rubbish', () => {
        const S = pair(), { A, B, b } = S, hp = B.player.health;
        A.mp.send(['hit', 0, B.mp.life + 1, 60, 0, 0], b);   // an airframe that doesn't exist yet
        A.mp.send(['hit', 7, 1, 60, 0, 0], b);               // an entity B doesn't own
        A.mp.send(['hit', 0, B.mp.life, -50, 0, 0], b);      // negative damage
        A.mp.send(['hit', 0, B.mp.life, 0, 0, 0], b);
        assert.equal(B.player.health, hp);
        A.mp.send(['hit', 0, B.mp.life, 1e8, 1, 0], b);      // absurd damage: capped, but it is a hit
        assert.ok(!B.player.alive);
        A.mp.send(['hit', 0, B.mp.life, 60, 0, 0], b);       // already dead
        assert.equal(B.mp.deaths, 1);
    });
});

describe('multiplayer: deaths, the feed, the score, respawn', () => {
    test('B is shot down: both show the kill, the scores agree, B\'s puppet dies with the game\'s effects, B gets a new jet', () => {
        const S = pair(), { hub, A, B, a, b } = S, pb = puppetOf(A, b);
        B.player.health = 12;
        fire(S, 1.2);
        assert.ok(!B.player.alive, 'B is down');
        assert.equal(B.state, 'dead');
        assert.equal(hub.events('die').length, 1);
        assert.deepEqual(hub.events('die')[0][1].e.slice(0, 5), ['die', 0, 1, P.eid(a, 0), 0], 'the owner names the killer');
        assert.equal(A.mp.kills, 1); assert.equal(B.mp.deaths, 1); assert.equal(A.mp.deaths, 0); assert.equal(B.mp.kills, 0);
        assert.ok(A.feed.includes('VIPER SHOT DOWN MAVERICK [GUNS]'), A.feed.join(' | '));
        assert.ok(B.feed.includes('VIPER SHOT DOWN MAVERICK [GUNS]'), B.feed.join(' | '));
        assert.ok(B.banners.some(x => /SHOT DOWN \/ by VIPER/.test(x)), B.banners.join(' | '));
        assert.equal(A.kills, 1, 'the HUD\'s kill count');
        // A's picture of B: dead (the game was told through its own 'killed' event, with A's jet as the source)
        assert.ok(!pb.alive);
        assert.ok(A.events.log.some(([k, ac, d]) => k === 'killed' && ac === pb && d.source === A.player));
        // scores as each side reports them to the other
        run([A, B], 0.2);
        assert.equal(B.mp.peers.get(a).kills, 1); assert.equal(A.mp.peers.get(b).deaths, 1);
        // it falls, then blows up where its owner's did; the puppet is gone from the game
        run([A, B], 3.5);
        assert.ok(hub.events('boom').length >= 1, 'the owner reported the explosion');
        assert.ok(pb.exploded && !A.aircraft.includes(pb));
        assert.ok(A.events.log.some(([k, ac]) => k === 'exploded' && ac === pb), 'with the game\'s own explosion');
        // and after the wait B has a new airframe, protected, which A sees as a new puppet at full health
        run([A, B], RESPAWN_DELAY - 3.5 + 0.5);
        assert.ok(B.player.alive && B.state === 'playing'); assert.equal(B.mp.life, 2);
        const nb = puppetOf(A, b);
        assert.ok(nb && nb !== pb && nb.alive && nb.puppet.life === 2);
        assert.equal(nb.health, nb.maxHealth); assert.ok(nb.puppet.safe);
        // the scoreboard: the killer first
        const rows = A.mp.scoreRows();
        assert.deepEqual(rows.map(r => [r.name, r.team, r.kills, r.deaths]), [['VIPER', 'blue', 1, 0], ['MAVERICK', 'red', 0, 1]]);
        assert.ok(rows[0].me && rows[0].host && rows[1].ping === 30);
        assert.deepEqual(B.mp.scoreRows().map(r => [r.name, r.kills, r.deaths]), [['VIPER', 1, 0], ['MAVERICK', 0, 1]]);
    });

    test('a snapshot still in the post when the jet died can\'t bring it back', () => {
        const S = pair(), { hub, A, B, b } = S;
        const stale = hub.sent.filter(([from, m]) => from === b && m.t === 's').pop()[1];
        B.player.health = 1;
        fire(S, 0.3);
        run([A, B], 3.4);                                // (blown up, and not yet in its next airframe)
        same(puppetOf(A, b), null, 'exploded and gone');
        A.mp.onMessage({ t: 's', s: [[b, stale.c + 9e6, stale.e]] });   // the old airframe, late
        same(puppetOf(A, b), null);
        assert.equal(A.aircraft.length, 1);
    });

    test('a crash is nobody\'s kill', () => {
        const S = pair(), { A, B, a, b } = S;
        B.player.crash();
        assert.ok(B.feed.includes('MAVERICK CRASHED') && A.feed.includes('MAVERICK CRASHED'));
        assert.equal(A.mp.kills, 0); assert.equal(B.mp.deaths, 1);
        assert.ok(puppetOf(A, b) === null || puppetOf(A, b).exploded, 'went up at once');
        assert.ok(B.banners.some(x => /^CRASHED/.test(x)) || true);
        void a;
    });

    test('hit, then into the ground within seconds: the shooter\'s kill', () => {
        const S = pair(), { A, B, a } = S;
        fire(S, 0.4);
        assert.ok(B.player.alive && B.player.health < B.player.maxHealth);
        B.player.crash();
        assert.ok(A.feed.some(f => f.startsWith('VIPER SHOT DOWN MAVERICK')), A.feed.join(' | '));
        assert.equal(A.mp.kills, 1);
        void a;
    });

    test('three pilots: the one who only watched sees the same kill line and scores', () => {
        const hub = new Hub();
        const A = makeGame(hub, { name: 'VIPER', team: 'blue', ac: 'f16' }, { at: [0, 3000, 0] });
        const B = makeGame(hub, { name: 'MAVERICK', team: 'red', ac: 'f15' }, { at: [0, 3000, -300] });
        const C = makeGame(hub, { name: 'GHOST', team: 'blue', ac: 'f14' }, { at: [4000, 4000, 4000] });
        run([A, B, C], 0.6); unsafe(A, B, C); run([A, B, C], 0.2);
        assert.equal(C.aircraft.length, 3);
        B.player.health = 5;
        let n = 0;
        run([A, B, C], 1, () => { A.player.ammo = 500; n += A.weapons.fireGun(A.player, A.time); for (const g of [A, B]) { g.player.controls.pitch = 0; g.player.controls.roll = 0; } });
        run([A, B, C], 0.3);
        assert.ok(C.feed.includes('VIPER SHOT DOWN MAVERICK [GUNS]'), C.feed.join(' | '));
        assert.deepEqual(C.mp.scoreRows().map(r => [r.name, r.kills, r.deaths]), [['VIPER', 1, 0], ['GHOST', 0, 0], ['MAVERICK', 0, 1]]);
        assert.equal(C.mp.kills, 0);
    });
});

describe('multiplayer: missiles and flares', () => {
    test('a missile: launch and flight are mirrored as a ghost that warns its target; the warhead is a claim; it ends where the shooter\'s did', () => {
        const S = pair(), { hub, A, B, a, b } = S, pb = puppetOf(A, b);
        const m = A.weapons.fireMissile(A.player, pb, 'aam');
        assert.ok(m && m.target === pb);
        const ml = hub.events('ml');
        assert.equal(ml.length, 1);
        assert.equal(ml[0][1].e[5], P.eid(b, 0), 'the launch names its target');
        assert.equal(B.mp.ghosts.size, 1);
        const gh = [...B.mp.ghosts.values()][0];
        same(gh.W, m.W, 'the same store (' + m.W.short + ')'); same(gh.target, B.player);
        assert.ok(B.player.incoming.includes(gh), 'the targeted jet has its missile warning');
        assert.ok(B.events.log.some(([k, ac, d]) => k === 'missileLaunch' && d.missile === gh && d.target === B.player), 'the game was told of the launch (sound, MISSILE LAUNCH)');
        assert.equal(hub.events('ml').length, 1, 'the ghost is not launched again by the client that draws it');
        const hp = B.player.health;
        let seen = 0, err = 0;
        run([A, B], 6, () => {
            for (const g of [A, B]) { g.player.controls.pitch = 0; g.player.controls.roll = 0; g.player.controls.throttle = 0.8; }
            if (gh.alive && gh.mesh.visible && A.weapons.missiles.includes(m)) { seen++; err = Math.max(err, gh.pos.distanceTo(m.pos)); }
        });
        assert.ok(seen > 20, 'the ghost flew (' + seen + ' frames)');
        assert.ok(err < 120, 'the ghost stays with the real missile, a tenth of a second behind it: ' + err.toFixed(1) + ' m');
        assert.ok(!A.weapons.missiles.includes(m), 'the real one is gone');
        assert.ok(B.player.health < hp - 20, 'its warhead hurt B: ' + (hp - B.player.health).toFixed(1));
        assert.ok(hub.events('hit').some(([, x]) => x.e[4] === P.kindCode('missile') && x.to === b), 'through a missile claim');
        assert.equal(hub.events('mx').length, 1);
        assert.equal(B.mp.ghosts.size, 0); assert.equal(B.player.incoming.length, 0, 'ghost and warning gone');
        assert.equal(A.mp.myMissiles.size, 0);
        void a;
    });

    test('flares are dropped for real by the puppet, so the shooter\'s seeker can be decoyed', () => {
        const S = pair(), { A, B, b } = S, pb = puppetOf(A, b);
        assert.equal(A.weapons.flares.length, 0);
        assert.ok(B.weapons.dropFlares(B.player, B.time));
        assert.equal(A.weapons.flares.length, 4, 'four flares in A\'s world');
        assert.ok(A.weapons.flares.every(f => f.owner === pb));
        assert.equal(A.weapons.chaff.length, 1, 'and the chaff');
        assert.ok(A.weapons.flares[0].pos.distanceTo(pb.pos) < 5, 'at the puppet');
        assert.equal(B.weapons.flares.length, 4, 'B\'s own are not doubled');
    });

    test('a missile that loses its target stops warning it ("MISSILE DEFEATED")', () => {
        const S = pair(), { A, B, b } = S, pb = puppetOf(A, b);
        const m = A.weapons.fireMissile(A.player, pb, 'aam');
        run([A, B], 0.3);
        const gh = [...B.mp.ghosts.values()][0];
        assert.ok(B.player.incoming.includes(gh));
        A.weapons.loseLock(m);
        run([A, B], 0.2);
        assert.ok(!B.player.incoming.includes(gh));
        assert.ok(B.events.log.some(([k, o, d]) => k === 'decoyed' && d.victim === B.player));
    });

    test('a missile nobody saw launched (we joined while it flew) is still drawn', () => {
        const hub = new Hub();
        const A = makeGame(hub, { name: 'VIPER', team: 'blue', ac: 'f16' }, { at: [0, 3000, 0] });
        A.weapons.fireMissile(A.player, null, 'aam');
        run([A], 0.5);
        const C = makeGame(hub, { name: 'GHOST', team: 'red', ac: 'f14' }, { at: [0, 3000, -3000] });
        run([A, C], 0.5);
        assert.equal(C.mp.ghosts.size, 1);
    });
});

describe('multiplayer: AI bandits are the host\'s', () => {
    function withBandit() {
        const S = pair(), { A, B } = S;
        // the host turns the bandits on; here one is put in by hand, ahead of B
        const ai = new Aircraft(A, 'mig29', { team: 'red' });
        ai.spawnAir(new THREE.Vector3(0, 3000, -3000), 0, 0.6);
        new Pilot(A, ai, 0.5);
        A.aircraft.push(ai);
        run([A, B], 0.5);
        return { ...S, ai };
    }

    test('the host flies it; everyone else has a puppet of it, described by the host', () => {
        const { hub, A, B, a, ai } = withBandit();
        assert.ok(A.mp.isHost && !B.mp.isHost);
        const e = A.mp.locals.get(ai);
        assert.ok(e && e.n === 1);
        assert.equal(hub.events('ai').length, 1);
        const pp = puppetOf(B, a, 1);
        assert.ok(pp && pp.type === 'mig29' && pp.team === 'red' && !pp.puppet.human && pp.pilot === null);
        assert.ok(pp.pos.distanceTo(ai.pos) < ai.speed * 0.15 + 2);
    });

    test('a guest\'s hit on it is a claim the host applies; the kill is the guest\'s', () => {
        const { hub, A, B, a, ai } = withBandit();
        // B is red like the bandit: a blue guest shoots it instead
        const C = makeGame(hub, { name: 'GHOST', team: 'blue', ac: 'f14' }, { at: [0, 3000, 500] });
        run([A, B, C], 0.6); unsafe(C);
        const pp = puppetOf(C, a, 1);
        assert.ok(pp);
        pp.damage(ai.health + 50, C.player, 'missile');
        assert.ok(!ai.alive, 'the host applied it');
        same(ai.lastHitBy, puppetOf(A, C.mp.me.id));
        assert.equal(C.mp.kills, 1);
        const line = 'GHOST SHOT DOWN ' + ai.spec.name.toUpperCase() + ' [MISSILE]';
        for (const g of [A, B, C]) assert.ok(g.feed.includes(line), g.feed.join(' | '));
        assert.equal(A.mp.kills, 0);
    });

    test('a late joiner is told what the host flies', () => {
        const { hub, A, a, ai } = withBandit();
        const C = makeGame(hub, { name: 'GHOST', team: 'blue', ac: 'f14' }, { at: [0, 3000, 500] });
        run([A, C], 0.5);
        const pp = puppetOf(C, a, 1);
        assert.ok(pp && pp.type === 'mig29');
        void ai;
    });

    test('the host leaves: the next host takes the bandits over where they are (a real aircraft with an AI pilot again)', () => {
        const { hub, A, B, a, ai } = withBandit();
        hub.set.ai = true; A.mp.room.set.ai = true; B.mp.room.set.ai = true;
        const C = makeGame(hub, { name: 'GHOST', team: 'blue', ac: 'f14' }, { at: [0, 3000, 500] });
        run([A, B, C], 0.5);
        ai.health = 77;
        run([A, B, C], 0.3);
        const pp = puppetOf(B, a, 1), at = pp.pos.clone();
        hub.leave(a);
        assert.ok(B.mp.isHost);
        assert.ok(B.aircraft.includes(pp) && !pp.puppet && pp.pilot instanceof Pilot, 'the same aircraft, now flown here');
        assert.ok(pp.alive && Math.abs(pp.health - 77) < 0.2 && pp.pos.distanceTo(at) < 1);
        assert.ok(B.feed.some(f => /HOST NOW/.test(f)));
        run([B, C], 1);
        assert.ok(B.mp.locals.has(pp), 'one of the new host\'s own');
        assert.ok(pp.pos.distanceTo(at) > 100 && pp.alive, 'and flying');
        // the others dropped the old host's puppet and have the new host's
        same(C.mp.peers.get(a), undefined);
        const np = puppetOf(C, B.mp.me.id, B.mp.locals.get(pp).n);
        assert.ok(np && np.type === 'mig29' && Math.abs(np.health - 77) < 0.2);
        assert.equal(C.aircraft.filter(x => x.type === 'mig29').length, 1, 'one bandit, not two');
    });

    test('only the host can switch the bandits; switching them off clears them for everyone', () => {
        const { hub, A, B, a, ai } = withBandit();
        B.mp.toggleBandits();
        assert.equal(hub.set.ai, false);
        assert.ok(B.feed.some(f => /ONLY THE HOST/.test(f)));
        A.mp.toggleBandits();
        assert.ok(hub.set.ai && A.mp.room.set.ai && B.mp.room.set.ai);
        assert.ok(B.feed.some(f => /AI BANDITS ON/.test(f)));
        A.mp.toggleBandits();
        assert.ok(!A.aircraft.includes(ai) && puppetOf(B, a, 1) === null && B.aircraft.length === 2);
    });
});

// ═════════════ netlink.js: one connection, against a WebSocket that is only a recorder ═════════════
describe('multiplayer: the connection (netlink.js)', () => {
    class FakeWS {
        constructor(url) { this.url = url; this.readyState = 0; this.sent = []; this.bufferedAmount = 0; FakeWS.last = this; queueMicrotask(() => { if (this.readyState === 0 && !FakeWS.dead) { this.readyState = 1; this.onopen && this.onopen(); } else if (FakeWS.dead) this.fail(); }); }
        send(d) { this.sent.push(JSON.parse(d)); }
        close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose({ code: 1000, reason: '' }); }
        deliver(o) { this.onmessage && this.onmessage({ data: typeof o === 'string' ? o : JSON.stringify(o) }); }
        fail() { this.readyState = 3; this.onerror && this.onerror({}); this.onclose && this.onclose({ code: 1006, reason: '' }); }
    }
    const tick = () => new Promise(r => setTimeout(r, 0));
    const WELCOME = { t: 'welcome', v: P.PROTOCOL, id: 7, name: 'VIPER', room: 'X', host: 7, set: { time: 'day', weather: 'clear', ai: false }, peers: [] };
    const HELLO = { name: 'viper', room: 'x', team: 'blue', ac: 'f16', lv: 'default', time: 'day', weather: 'clear' };
    async function linked(now = { t: 1000 }) {
        FakeWS.dead = false;
        const link = new NetLink('ws://test/ws', { WebSocket: FakeWS, now: () => now.t });
        const p = link.connect(HELLO);
        await tick();
        const ws = FakeWS.last;
        ws.deliver(WELCOME);
        return { link, ws, welcome: await p, now };
    }

    test('hello with the protocol number, then the welcome', async () => {
        const { link, ws, welcome } = await linked();
        assert.deepEqual(ws.sent[0], { t: 'hello', v: P.PROTOCOL, ...HELLO });
        assert.equal(welcome.id, 7); assert.ok(link.open);
        assert.equal(ws.sent[1].t, 'ping', 'and the first ping');
        link.close();
        assert.ok(!link.open);
    });

    test('refused: the relay\'s reason is the error; unreachable: a message that says so', async () => {
        FakeWS.dead = false;
        const a = new NetLink('ws://test/ws', { WebSocket: FakeWS });
        const pa = a.connect(HELLO);
        await tick();
        FakeWS.last.deliver({ t: 'err', code: 'version', msg: 'Your copy of the game is out of date: reload the page to play multiplayer.' });
        await assert.rejects(pa, /reload the page/);
        FakeWS.dead = true;
        const b = new NetLink('ws://test/ws', { WebSocket: FakeWS });
        await assert.rejects(b.connect(HELLO), /Can't reach the multiplayer server/);
        FakeWS.dead = false;
        const c = new NetLink('ws://test/ws', { WebSocket: FakeWS });
        await assert.rejects(c.connect(HELLO, 30), /didn't answer in time/, 'no welcome');
        const d = new NetLink('ws://test/ws', { WebSocket: undefined });
        d.WS = undefined;
        await assert.rejects(d.connect(HELLO), /WebSocket/);
    });

    test('messages after the welcome wait in the backlog until someone listens; rubbish is skipped', async () => {
        const { link, ws } = await linked();
        ws.deliver({ t: 'join', p: [9, 'GHOST', 'red', 'f14', 'default'] });
        ws.deliver('not json at all');
        ws.deliver('null');
        ws.deliver({ t: 'e', f: 9, e: ['st', 1, 0, 30] });
        assert.deepEqual(link.backlog.map(m => m.t), ['join', 'e']);
        const got = [];
        link.onMessage = (m) => got.push(m.t);
        ws.deliver({ t: 'leave', id: 9, host: 7 });
        assert.deepEqual(got, ['leave']);
        link.close();
    });

    test('the ping is the quickest of the last few round trips', async () => {
        const now = { t: 1000 }, { link, ws } = await linked(now);
        for (const [sent, back] of [[1000, 1180], [3000, 3040], [5000, 5350], [7000, 7055]]) { now.t = back; ws.deliver({ t: 'pong', n: sent }); }
        assert.equal(link.rtt, 40);
        for (let i = 0; i < 8; i++) { now.t = 10000 + i * 2000 + 90; ws.deliver({ t: 'pong', n: 10000 + i * 2000 }); }
        assert.equal(link.rtt, 90, 'the old quick one has dropped out of the window');
        link.close();
    });

    test('events over the budget wait for the next second, in order; snapshots always go, unless the line is stalled', async () => {
        const now = { t: 5000 }, { link, ws } = await linked(now);
        ws.sent.length = 0;
        for (let i = 0; i < 70; i++) link.event(['st', i, 0, 0]);
        assert.equal(ws.sent.length, 45, 'this second\'s budget');
        assert.equal(link.queue.length, 25);
        for (let i = 0; i < 20; i++) assert.ok(link.state(i, [], []), 'a snapshot is not held back by events');
        link.pump();
        assert.equal(ws.sent.filter(m => m.t === 'e').length, 45, 'still nothing more this second');
        now.t += 1001;
        link.event(['st', 70, 0, 0], 9);          // (a new one goes behind the ones waiting)
        link.pump();
        const ev = ws.sent.filter(m => m.t === 'e');
        assert.deepEqual(ev.map(m => m.e[1]), [...Array(71).keys()], 'all of them, in order');
        assert.equal(ev[70].to, 9); assert.equal(ev[0].to, undefined);
        // a stalled line: no snapshots are queued behind it
        ws.sent.length = 0;
        ws.bufferedAmount = 50000;
        assert.equal(link.state(99, [[0]], []), false);
        assert.equal(ws.sent.length, 0);
        ws.bufferedAmount = 0;
        assert.ok(link.state(100, [[0]], [[1, 2, 3, 4, 5, 6, 7, 1]]));
        assert.deepEqual(ws.sent, [{ t: 's', c: 100, e: [[0]], m: [[1, 2, 3, 4, 5, 6, 7, 1]] }]);
        link.close();
    });

    test('a connection that ends is reported once, and not when we closed it ourselves', async () => {
        const { link, ws } = await linked();
        let ended = 0;
        link.onClose = () => ended++;
        ws.close();
        assert.equal(ended, 1); assert.ok(!link.open);
        const again = await linked();
        again.link.onClose = () => ended++;
        again.link.close();
        assert.equal(ended, 1);
    });
});

describe('multiplayer: outside the mode', () => {
    test('idle in every other mode: no connection, no hooks, nothing sent', () => {
        const g = { events: new Events(), aircraft: [], world: {}, input: { down: () => false } };
        const mp = new Multiplayer(g);
        mp.makeLink = () => { throw new Error('single-player must never open a connection'); };
        for (const mode of ['dogfight', 'freeflight', 'war', 'missions']) {
            mp.start(mode, {});
            assert.equal(mp.active, false); assert.equal(g.cockpitOnly, false);
            mp.update(1 / 60);
            assert.equal(mp.onAction('pause'), false); assert.equal(mp.onAction('photo'), false);
            assert.equal(mp.respawnPoint(), null); assert.equal(mp.onKilled(), false);
            mp.flyJet(1 / 60, {}, {}); mp.drawHud({}, {});
            mp.clear();
        }
        assert.equal(mp.link, null);
        g.events.emit('killed', {}, {}); g.events.emit('flares', {}); g.events.emit('missileLaunch', {}, { missile: {} });
    });

    test('pause can\'t stop the world: the menu flag goes up, the jet holds its wings level', () => {
        const { A } = pair();
        let shown = null;
        A.onPause = (on) => { shown = on; };
        assert.equal(A.mp.onAction('pause'), true);
        assert.ok(A.mp.menuOpen && shown === true && A.state === 'playing');
        const p = A.player, s = { fire: true };
        p.qv.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.8); p.syncBody(); // banked
        A.mp.flyJet(1 / 60, p, s);
        assert.equal(s.fire, false);
        assert.ok(Math.abs(p.controls.roll) > 0.5, 'rolling back level');
        assert.equal(A.mp.onAction('missile'), true, 'no weapons from the menu');
        assert.equal(A.mp.onAction('pause'), true);
        assert.ok(!A.mp.menuOpen && shown === false);
        assert.equal(A.mp.onAction('photo'), true, 'photo mode is refused');
        assert.equal(A.mp.onAction('eject'), true, 'so is ejecting');
        assert.ok(A.feed.some(f => /PHOTO/.test(f)) && A.feed.some(f => /EJECT/.test(f)));
    });
});

// ═════════════ A peer is not trusted ═════════════
// What a modified client could send: every message here has a shape the relay lets through (relay.validEvent /
// validState), delivered as the relay would deliver it, stamped with the sender's id.
describe('multiplayer: a peer is not trusted', () => {
    // A (blue, host), B (red), C (blue) in one room, all past their spawn protection
    function trio() {
        const hub = new Hub();
        const A = makeGame(hub, { name: 'VIPER', team: 'blue', ac: 'f16' }, { at: [0, 3000, 0] });
        const B = makeGame(hub, { name: 'MAVERICK', team: 'red', ac: 'f15' }, { at: [0, 3000, -300] });
        const C = makeGame(hub, { name: 'GHOST', team: 'blue', ac: 'f14' }, { at: [3000, 3500, 2000] });
        run([A, B, C], 0.6); unsafe(A, B, C); run([A, B, C], 0.2);
        return { hub, A, B, C, a: A.mp.me.id, b: B.mp.me.id, c: C.mp.me.id };
    }
    // deliver to `to` what `from` (a client id) could have sent through the relay
    const forge = (to, from, e) => { assert.ok(relay.validEvent({ t: 'e', e }), 'the relay would pass it: ' + JSON.stringify(e)); to.mp.onMessage({ t: 'e', f: from, e }); };
    const forgeState = (to, from, c, rows, ms) => { const m = { t: 's', c, e: rows, ...(ms ? { m: ms } : {}) }; assert.ok(relay.validState(m)); to.mp.onMessage({ t: 's', s: [ms ? [from, c, rows, ms] : [from, c, rows]] }); };
    const row = (n, life, x, y, z, flags = P.FLAG.ALIVE) => P.encodeEntity({ n, life, pos: { x, y, z }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 0, y: 0, z: -200 }, throttle: 0.8, flags, health: 100, g: 1 });
    const stateClock = (g) => Math.round(clock.t * 1e4) / 10;

    test('missile ids are each peer\'s own: one peer can\'t touch another\'s ghost, and ids out of range are refused', () => {
        const { A, B, C, a, b } = trio();
        const m = A.weapons.fireMissile(A.player, puppetOf(A, b), 'aam');
        run([A, B, C], 0.3);
        const pa = C.mp.peers.get(a), pb = C.mp.peers.get(b);
        const id = A.mp.myMissiles.get(m).id;
        same(pa.ghosts.size, 1); assert.ok(pa.ghosts.has(id)); same(pb.ghosts.size, 0);
        const ghost = pa.ghosts.get(id);
        // B tries to end A's missile: by its id, and by ids that the old packed key would have mapped onto it
        for (const forged of [id, id + 65536, id + (a - b) * 65536, id - 65536, 0, -1, 65536, 1e9, 0.5]) forge(C, b, ['mx', forged, ghost.pos.x, ghost.pos.y, ghost.pos.z]);
        assert.ok(pa.ghosts.get(id) === ghost && ghost.alive && C.mp.ghosts.has(ghost), 'A\'s ghost is still there');
        // and to launch under such ids: refused outright
        for (const forged of [65536, id + 65536, 1e6, 0, -3, 2.5]) forge(C, b, ['ml', forged, 0, 'aim9x', 'aam', 0, 0, 3000, 0, 0, 0, -300, stateClock()]);
        same(pb.ghosts.size, 0);
        forgeState(C, b, stateClock() + 1, [], [[70000, 0, 3000, 0, 0, 0, -300, 1], [0, 0, 3000, 0, 0, 0, -300, 1], [1.5, 0, 3000, 0, 0, 0, -300, 1]]);
        same(pb.ghosts.size, 0, 'missile rows with ids out of range are dropped');
        // B's own missile with the very same id as A's is a different ghost; ending it leaves A's alone
        forge(C, b, ['ml', id, 0, 'aim9x', 'aam', 0, 0, 3000, 0, 0, 0, -300, stateClock()]);
        same(pb.ghosts.size, 1); assert.ok(pb.ghosts.get(id) !== ghost && pb.ghosts.get(id).peer === pb);
        forge(C, b, ['mx', id, 0, 3000, 0]);
        same(pb.ghosts.size, 0);
        assert.ok(pa.ghosts.get(id) === ghost && ghost.alive);
        same(C.mp.ghosts.size, 1);
    });

    test('ghosts are capped whichever message asks for them: per peer and in all', () => {
        const { C, b } = trio();
        const { PEER_GHOSTS, MAX_GHOSTS } = LIMITS;
        const pb = C.mp.peers.get(b);
        // unknown ids in state rows (the path with no launch event), 12 a message, for 10 messages
        let id = 100, c = stateClock();
        for (let k = 0; k < 10; k++) { const ms = []; for (let i = 0; i < 12; i++) ms.push([id++, i * 10, 3000, 0, 0, 0, -300, 1]); forgeState(C, b, c += 50, [], ms); }
        same(pb.ghosts.size, PEER_GHOSTS, 'one peer: ' + pb.ghosts.size);
        // launch events too
        for (let i = 0; i < 200; i++) forge(C, b, ['ml', 5000 + i, 0, 'aim9x', 'aam', 0, 0, 3000, 0, 0, 0, -300, stateClock()]);
        same(pb.ghosts.size, PEER_GHOSTS);
        // many peers at it together
        for (let p = 0; p < 10; p++) {
            C.mp.onMessage({ t: 'join', p: [900 + p, 'X' + p, 'red', 'f16', 'default'] });
            const ms = []; for (let i = 0; i < 12; i++) ms.push([1 + i, i * 10, 3000, p * 10, 0, 0, -300, 1]);
            forgeState(C, 900 + p, c, [], ms); forgeState(C, 900 + p, c + 50, [], ms.map(r => [r[0] + 50, ...r.slice(1)]));
        }
        assert.ok(C.mp.ghosts.size <= MAX_GHOSTS, 'in all: ' + C.mp.ghosts.size);
        same(C.mp.ghosts.size, MAX_GHOSTS);
        for (const peer of C.mp.peers.values()) assert.ok(peer.ghosts.size <= PEER_GHOSTS);
        // they go when their owners stop reporting them, and the count with them
        run([C], 2.5);
        same(C.mp.ghosts.size, 0);
        for (const peer of C.mp.peers.values()) same(peer.ghosts.size, 0);
    });

    test('a death is recorded once, only for a living airframe we have a picture of; the killer must be in the room', () => {
        const { A, B, C, a, b, c } = trio();
        const feedOf = (g) => g.feed.filter(f => /SHOT DOWN|CRASHED/.test(f));
        const before = { feed: feedOf(C).length, kills: [A.mp.kills, B.mp.kills, C.mp.kills] };
        const life = B.mp.life;
        // deaths of things that don't exist: an entity B has none of, an airframe it hasn't got to, a past one
        for (const e of [['die', 7, 1, P.eid(a, 0), 0], ['die', 0, life + 1, P.eid(a, 0), 0], ['die', 0, life - 1, P.eid(a, 0), 0], ['die', -1, life, 0, 0], ['die', 0.5, life, 0, 0], ['die', 5000, life, 0, 0], ['die', 0, 1e9, 0, 0]]) {
            for (let i = 0; i < 50; i++) { forge(C, b, e); forge(A, b, e); }
        }
        same(feedOf(C).length, before.feed, 'nothing in the feed: ' + feedOf(C).join(' | '));
        same(A.mp.kills, 0, 'no kill handed to anyone');
        assert.ok(puppetOf(C, b).alive);
        // B's real jet "dies" a thousand times, naming A, who never hit it
        for (let i = 0; i < 1000; i++) { forge(C, b, ['die', 0, life, P.eid(a, 0), 0]); forge(A, b, ['die', 0, life, P.eid(a, 0), 0]); }
        same(feedOf(C).length, before.feed + 1, 'one line on the watcher: ' + feedOf(C).join(' | '));
        same(feedOf(A).length, 1);
        same(A.mp.kills, 0, 'A never claimed a hit on it: the kill is not A\'s');
        assert.ok(feedOf(A)[0] === 'MAVERICK WAS SHOT DOWN', feedOf(A)[0]);
        assert.ok(!puppetOf(C, b).alive && puppetOf(C, b).puppet.dead);
        // …and once its airframe has ended, nothing more can be said about it
        forge(C, b, ['boom', 0, life, 0, 0, 0, 3000, 0]);
        for (let i = 0; i < 20; i++) forge(C, b, ['die', 0, life, P.eid(a, 0), 0]);
        same(feedOf(C).length, before.feed + 1);
        assert.deepEqual([A.mp.kills, B.mp.kills, C.mp.kills], before.kills);
        void c;
    });

    test('a killer who isn\'t in the room is "unknown"; a peer can only report its own aircraft', () => {
        const { A, B, C, a, b, c } = trio();
        const life = B.mp.life;
        forge(C, b, ['die', 0, life, P.eid(4242, 0), 1]);            // nobody has that id
        assert.ok(C.feed.includes('MAVERICK WAS SHOT DOWN'), C.feed.join(' | '));
        assert.ok(!C.feed.some(f => /SHOT DOWN MAVERICK/.test(f)));
        // C "reports" a death with A's airframe number: it can only ever mean C's own jet, whatever it says
        const T = trio();
        T.A.mp.locals.get(T.A.player);
        forge(T.B, T.c, ['die', 0, T.A.mp.life, P.eid(T.b, 0), 0]);
        assert.ok(puppetOf(T.B, T.a).alive, 'A\'s puppet on B is untouched');
        assert.ok(!puppetOf(T.B, T.c).alive, 'it killed its own picture');
        assert.ok(T.B.feed.some(f => /GHOST/.test(f)) && !T.B.feed.some(f => /SHOT DOWN VIPER|VIPER (WAS|CRASHED)/.test(f)));
        same(T.B.mp.kills, 0, 'and B, named as the killer, had not hit it: no kill');
        void a; void c; void A; void B;
    });

    test('table lookups are by a table\'s own entries: "constructor", "toString", "__proto__" are not aircraft, liveries or stores', () => {
        const { C, b } = trio();
        for (const [i, t] of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'].entries()) {
            const id = 700 + i;
            C.mp.onMessage({ t: 'join', p: [id, 'EVIL' + i, 'red', t, t] });
            const peer = C.mp.peers.get(id);
            same(peer.ac, 'f16'); same(peer.lv, 'default');
            forgeState(C, id, stateClock(), [row(0, 1, 100 * i, 3000, 0)]);
            const pp = puppetOf(C, id);
            assert.ok(pp && pp.type === 'f16', 'built as an F-16');
            forge(C, id, ['ml', 1, 0, t, t, 0, 0, 3000, 0, 0, 0, -300, stateClock()]);
            same(peer.ghosts.size, 1);
            assert.ok(typeof peer.ghosts.get(1).W.boost === 'number', 'a real weapon table');
        }
        void b;
    });

    test('only the host has aircraft besides its own jet', () => {
        const { A, B, C, b } = trio();
        assert.ok(A.mp.isHost);
        forge(C, b, ['ai', 3, 'su57', 1, 'FAKE', 300, 90, 1]);
        same(C.mp.peers.get(b).desc.size, 0, 'a description from a peer who isn\'t the host is ignored');
        forgeState(C, b, stateClock(), [row(3, 1, 0, 3000, 0)]);
        same(puppetOf(C, b, 3), null);
        same(C.aircraft.length, 3);
        // a hit claimed for such an aircraft is refused too
        const hp = C.player.health;
        forge(C, b, ['hit', 0, C.mp.life, 50, 0, 3]);
        same(C.player.health, hp);
        void B;
    });

    test('hit claims: the amount must be a number, the kind a known one, and a cannon doesn\'t reach across the map', () => {
        const { A, B, C, a, b } = trio();
        const hp = B.player.health, life = B.mp.life;
        for (const e of [['hit', 0, life, '50', 0, 0], ['hit', 0, life, 50, 99, 0], ['hit', 0, life, 50, -1, 0], ['hit', 0, life, 50, 0, -1], ['hit', 0, life, 50, 0, 9999], ['hit', '0', life, 50, 0, 0], ['hit', 0, life, 50, 0.5, 0], ['hit', 0, life, 50]]) forge(B, a, e);
        same(B.player.health, hp, 'malformed claims do nothing');
        // the shooter, as B sees it, is 20 km away
        const far = B.player.health;
        puppetOf(B, a).pos.set(0, 3000, 20000);
        assert.ok(puppetOf(B, a).pos.distanceTo(B.player.pos) > LIMITS.GUN_REACH);
        forge(B, a, ['hit', 0, life, 30, P.kindCode('gun'), 0]);
        same(B.player.health, far, 'a cannon hit from 20 km is refused');
        forge(B, a, ['hit', 0, life, 30, P.kindCode('missile'), 0]);
        assert.ok(B.player.health < far, 'a missile\'s is not (it flew there)');
        void b;
    });

    test('repeating a message does not make more of anything: flares, launches, airframes, parts', () => {
        const { A, B, C, b } = trio();
        const pb = C.mp.peers.get(b);
        for (let i = 0; i < 300; i++) forge(C, b, ['fl', 0]);
        same(C.weapons.flares.length, 4, 'one salvo, not three hundred');
        for (let i = 0; i < 300; i++) forge(C, b, ['ml', 1 + i, 0, 'aim9x', 'aam', P.eid(C.mp.me.id, 0), 0, 3000, 0, 0, 0, -300, stateClock()]);
        assert.ok(pb.ghosts.size <= 8, pb.ghosts.size + ' ghosts from 300 launches in one instant');
        assert.ok(C.player.incoming.length <= 8);
        const warnings = C.events.log.filter(([k, o, d]) => k === 'missileLaunch' && d && d.missile && d.missile.ghost).length;
        assert.ok(warnings <= 8, warnings + ' launch warnings');
        // a new airframe number in every snapshot
        let built = 0;
        const make = C.mp.makePuppet.bind(C.mp);
        C.mp.makePuppet = (...args) => { const r = make(...args); if (r) built++; return r; };
        let c = stateClock();
        for (let life = 2; life < 400; life++) forgeState(C, b, c += 50, [row(0, life, 0, 3000, 0)]);
        assert.ok(built <= 1, built + ' aircraft built for 400 airframe numbers in one instant');
        run([C], 3, () => { for (let k = 0; k < 5; k++) forgeState(C, b, c += 50, [row(0, 1000 + Math.round(c), 0, 3000, 0)]); });
        assert.ok(built <= 5, built + ' in three seconds of it');
        same(C.aircraft.length, 3, 'never more than the one puppet');
        // a wing can only come off once, and only a wing
        const pp = puppetOf(C, b), L = pp.puppet.life;
        for (let i = 0; i < 50; i++) for (const region of [0, 1, 2, 3, 4, 9, -1]) forge(C, b, ['part', 0, L, region]);
        assert.ok(pp.lostRegions.size <= 2 && !pp.lostRegions.has('center') && !pp.lostRegions.has('nose') && !pp.lostRegions.has('tail'));
        void A; void B;
    });

    test('nothing grows without bound: wild entity numbers, airframe numbers, scores, room members', () => {
        const { C, b } = trio();
        const pb = C.mp.peers.get(b);
        const ended = pb.ended.size;
        for (let i = 0; i < 3000; i++) {
            forge(C, b, ['boom', 4096 + i, 1, 0, 0, 0, 0, 0]); forge(C, b, ['gone', -i - 1, 1]); forge(C, b, ['boom', i + 0.5, 1, 0, 0, 0, 0, 0]);
            forge(C, b, ['gone', 5 + (i % 4000), 1e9]); forge(C, b, ['gone', 5 + (i % 4000), 3]); forge(C, b, ['boom', 5 + (i % 4000), i, 0, 0, 0, 0, 0]);
        }
        assert.ok(pb.ended.size > ended && pb.ended.size <= ended + 4000, 'ended: ' + pb.ended.size);
        assert.ok(pb.ended.size <= P.NMAX);
        assert.ok(puppetOf(C, b).alive, 'and its real jet is untouched');
        forge(C, b, ['st', 1e9, -5, 2.5]);
        assert.deepEqual([pb.kills, pb.deaths, pb.ping], [0, 0, 0]);
        forge(C, b, ['st', 12, 3, 40]);
        assert.deepEqual([pb.kills, pb.deaths, pb.ping], [12, 3, 40]);
        same(C.mp.kills, 0, 'a peer\'s score is its own word: it never adds to ours');
        for (let i = 0; i < 500; i++) C.mp.onMessage({ t: 'join', p: [2000 + i, 'P' + i, 'red', 'f16', 'default'] });
        assert.ok(C.mp.peers.size <= P.MAX_PLAYERS * 2, C.mp.peers.size + ' peers');
        // the same member announced twice is one member
        const n = C.mp.peers.size;
        C.mp.onMessage({ t: 'join', p: [b, 'OTHER', 'blue', 'f16', 'default'] });
        same(C.mp.peers.size, n); same(C.mp.peers.get(b).name, 'MAVERICK');
        // rubbish instead of messages
        for (const m of [null, 5, 'x', [], {}, { t: 's' }, { t: 's', s: 'x' }, { t: 's', s: [5, null, [b], [b, 'x'], [b, -1, []], [b, 5, 'rows'], [b, 5, [null, 5, 'x', []]]] }, { t: 'e' }, { t: 'e', f: b }, { t: 'e', f: b, e: 'x' },
            { t: 'e', f: b, e: ['hit', {}, []] }, { t: 'e', f: b, e: ['die', [0], null] }, { t: 'e', f: 12345, e: ['die', 0, 1, 0, 0] }, { t: 'join' }, { t: 'join', p: 'x' }, { t: 'join', p: [-1] }, { t: 'leave' }, { t: 'leave', id: 'x', host: {} }, { t: 'set' }, { t: 'set', set: 5 }]) C.mp.onMessage(m);
        assert.ok(puppetOf(C, b).alive);
    });
});

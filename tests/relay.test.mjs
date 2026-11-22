// The multiplayer relay (relay.mjs) on an ephemeral port: the WebSocket handshake and framing against a raw TCP client
// (masking, 16-bit lengths, fragments, pings, oversize and unmasked frames), and rooms, hosts, batching, caps, the Origin
// check, malformed input and callsigns through Node's own WebSocket client (skipped where there is none: Node < 22).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { src } from './helpers/setup.mjs';

const { createRelay, PROTOCOL, cleanName, cleanRoom, validState, validEvent, DEFAULTS, addressKey, isLoopbackAddress } = await import(new URL('../relay.mjs', import.meta.url).href);
const proto = await src('netproto.js');

const ORIGIN = 'http://localhost:8080';
const HAS_WS = typeof WebSocket === 'function';
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// (No test here depends on how quickly anything happens: `node --test tests/` runs every file in one process, and other
// files' heavy imports block the event loop for seconds while these tests wait on sockets and timers.)

// a relay on its own HTTP server, port chosen by the system
async function startRelay(options = {}) {
    const relay = createRelay({ path: '/ws', ...options });
    const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
    relay.attach(server);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    return { relay, server, port, url: `ws://127.0.0.1:${port}/ws`, stop: () => new Promise(r => { relay.close(); server.close(r); server.closeAllConnections && server.closeAllConnections(); }) };
}

// Node's WebSocket with a queue of what arrived: next('welcome') waits for the next message of that type
function client(url, { origin = ORIGIN, headers = {} } = {}) {
    const ws = new WebSocket(url, { headers: { ...(origin ? { Origin: origin } : {}), ...headers } });
    const got = [], waiting = [];
    const c = {
        ws, got, closed: null, opened: false,
        send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)),
        next(type, ms = 15000) {
            const i = got.findIndex(m => m.t === type);
            if (i >= 0) return Promise.resolve(got.splice(i, 1)[0]);
            return new Promise((resolve, reject) => {
                const w = { type, resolve, timer: setTimeout(() => { waiting.splice(waiting.indexOf(w), 1); reject(new Error('no "' + type + '" message within ' + ms + ' ms')); }, ms) };
                waiting.push(w);
            });
        },
        untilClosed: (ms = 15000) => new Promise((resolve, reject) => {
            if (c.closed) return resolve(c.closed);
            const timer = setTimeout(() => reject(new Error('not closed within ' + ms + ' ms')), ms);
            ws.addEventListener('close', (e) => { clearTimeout(timer); resolve({ code: e.code, reason: e.reason }); });
        }),
        async hello(h = {}) { c.send({ t: 'hello', v: PROTOCOL, name: 'VIPER', room: 'TEST', team: 'blue', ac: 'f16', lv: 'default', time: 'day', weather: 'clear', ...h }); return c.next('welcome'); },
        close: () => { try { ws.close(); } catch (e) { /* ignore */ } },
    };
    ws.addEventListener('message', (e) => {
        const m = JSON.parse(e.data);
        const i = waiting.findIndex(w => w.type === m.t);
        if (i >= 0) { const w = waiting.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(m); } else got.push(m);
    });
    ws.addEventListener('close', (e) => { c.closed = { code: e.code, reason: e.reason }; });
    ws.addEventListener('error', () => {});
    c.ready = new Promise((resolve, reject) => {
        ws.addEventListener('open', () => { c.opened = true; resolve(c); });
        ws.addEventListener('close', () => reject(new Error('closed before it opened')));
    });
    c.ready.catch(() => {});
    return c;
}
const join = async (url, h, o) => { const c = client(url, o); await c.ready; c.me = await c.hello(h); return c; };

// a raw TCP client: does the handshake by hand, sends whatever bytes the test wants, collects the server's frames
function raw(port, { path = '/ws', headers = {}, key = randomBytes(16).toString('base64') } = {}) {
    return new Promise((resolve) => {
        const sock = net.connect(port, '127.0.0.1');
        let buf = Buffer.alloc(0), head = null;
        const r = { sock, key, frames: [], closed: false, status: 0, headers: '' };
        const lines = ['GET ' + path + ' HTTP/1.1', 'Host: 127.0.0.1', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Key: ' + key, 'Sec-WebSocket-Version: 13', 'Origin: ' + ORIGIN];
        for (const [k, v] of Object.entries(headers)) { const i = lines.findIndex(l => l.toLowerCase().startsWith(k.toLowerCase() + ':')); if (v === null) { if (i >= 0) lines.splice(i, 1); } else if (i >= 0) lines[i] = k + ': ' + v; else lines.push(k + ': ' + v); }
        sock.on('connect', () => sock.write(lines.join('\r\n') + '\r\n\r\n'));
        sock.on('data', (d) => {
            buf = Buffer.concat([buf, d]);
            if (!head) {
                const i = buf.indexOf('\r\n\r\n');
                if (i < 0) return;
                head = buf.subarray(0, i).toString();
                r.headers = head; r.status = +head.split(' ')[1];
                buf = buf.subarray(i + 4);
                resolve(r);
            }
            for (;;) {
                if (buf.length < 2) break;
                let len = buf[1] & 0x7f, off = 2;
                if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
                if (buf.length < off + len) break;
                r.frames.push({ op: buf[0] & 0x0f, fin: !!(buf[0] & 0x80), masked: !!(buf[1] & 0x80), data: buf.subarray(off, off + len) });
                buf = buf.subarray(off + len);
            }
        });
        sock.on('close', () => { r.closed = true; if (!head) resolve(r); });
        sock.on('error', () => {});
        // a client frame: masked unless told otherwise
        r.frame = (op, payload, { fin = true, mask = true, len64 = false } = {}) => {
            const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8'), n = p.length;
            const h = len64 ? Buffer.alloc(10) : n < 126 ? Buffer.alloc(2) : Buffer.alloc(4);
            h[0] = (fin ? 0x80 : 0) | op;
            if (len64) { h[1] = 127; h.writeUInt32BE(n, 6); } else if (n < 126) h[1] = n; else { h[1] = 126; h.writeUInt16BE(n, 2); }
            if (!mask) return Buffer.concat([h, p]);
            h[1] |= 0x80;
            const m = randomBytes(4), out = Buffer.from(p);
            for (let i = 0; i < n; i++) out[i] ^= m[i & 3];
            return Buffer.concat([h, m, out]);
        };
        r.text = (o, opts) => sock.write(r.frame(1, typeof o === 'string' ? o : JSON.stringify(o), opts));
        r.json = () => r.frames.filter(f => f.op === 1).map(f => JSON.parse(f.data.toString()));
        r.until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await wait(5); } };
        r.closeCode = () => { const f = r.frames.find(x => x.op === 8); return f && f.data.length >= 2 ? f.data.readUInt16BE(0) : null; };
    });
}
const HELLO = { t: 'hello', v: PROTOCOL, name: 'RAW', room: 'RAWROOM', team: 'blue', ac: 'f16', lv: 'default' };

describe('relay: names and message shapes', () => {
    test('the protocol number is the client\'s', () => { assert.equal(PROTOCOL, proto.PROTOCOL); });

    test('callsigns: letters, digits, space, _ and -, 14 characters, upper case', () => {
        assert.equal(cleanName('viper'), 'VIPER');
        assert.equal(cleanName('  Mad   Dog 107  '), 'MAD DOG 107');
        assert.equal(cleanName('<img src=x onerror=alert(1)>'), 'IMG SRCX ONERR');
        assert.equal(cleanName('ÀÉÎ—日本'), 'PILOT');
        assert.equal(cleanName('a_b-c'), 'A_B-C');
        assert.equal(cleanName('ABCDEFGHIJKLMNOPQRSTUVWXYZ').length, 14);
        for (const bad of ['', '   ', null, undefined, 42, {}, [], '!!!']) assert.equal(cleanName(bad), 'PILOT');
        assert.equal(cleanName('f u c k'), 'PILOT');
        assert.equal(cleanName('5H1T-HEAD'), 'PILOT');
        // the client's own cleaner agrees on everything it lets through
        for (const s of ['viper', '  Mad   Dog 107  ', '<b>x</b>', 'a_b-c', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) assert.equal(proto.cleanCallsign(s), cleanName(s));
    });

    test('room codes: letters and digits, 8 characters; nothing = PUBLIC', () => {
        assert.equal(cleanRoom('abc-12 3!'), 'ABC123');
        assert.equal(cleanRoom(''), 'PUBLIC');
        assert.equal(cleanRoom(null), 'PUBLIC');
        assert.equal(cleanRoom('averyveryverylongroomcode'), 'AVERYVER');
        assert.equal(proto.cleanRoom('abc-12 3!'), 'ABC123');
    });

    test('state and event validation', () => {
        const row = [0, 1, 10.5, 200, -3, 0, 0, 0, 32767, 100, 0, -2000, 80, 9, 1000, 10];
        assert.ok(validState({ c: 1234, e: [row] }));
        assert.ok(validState({ c: 1234, e: [], m: [[1, 2, 3, 4, 5, 6, 7, 1]] }));
        assert.ok(!validState({ c: 1234 }));
        assert.ok(!validState({ c: -1, e: [] }));
        assert.ok(!validState({ c: 'x', e: [] }));
        assert.ok(!validState({ c: 1, e: [[1, 'x']] }));
        assert.ok(!validState({ c: 1, e: [[1, null]] }));
        assert.ok(!validState({ c: 1, e: [[1e9]] }), 'a number out of range');
        assert.ok(!validState({ c: 1, e: [new Array(25).fill(0)] }), 'a row too long');
        assert.ok(!validState({ c: 1, e: new Array(13).fill([0]) }), 'too many rows');
        assert.ok(!validState({ c: 1, e: {} }));
        assert.ok(validEvent({ e: ['hit', 3, 1, 12.5, 0, 0] }));
        assert.ok(validEvent({ e: ['ml', 7, 0, 'aim9x', 'aam', 4099, 1, 2, 3, 4, 5, 6], to: 3 }));
        assert.ok(!validEvent({ e: ['chat', 'hello there'] }), 'not on the whitelist');
        assert.ok(!validEvent({ e: ['hit', '<script>'] }), 'a string outside the safe alphabet');
        assert.ok(!validEvent({ e: ['hit', 'x'.repeat(25)] }));
        assert.ok(!validEvent({ e: ['hit', [1, 2]] }));
        assert.ok(!validEvent({ e: ['hit', 1], to: 'everyone' }));
        assert.ok(!validEvent({ e: [] }));
        assert.ok(!validEvent({ e: ['hit', ...new Array(24).fill(1)] }));
    });

    test('the limits asked for', () => {
        assert.equal(DEFAULTS.maxPerRoom, 16); assert.equal(DEFAULTS.maxRooms, 64); assert.equal(DEFAULTS.maxConns, 256); assert.equal(DEFAULTS.maxPerIp, 8);
        assert.ok(DEFAULTS.maxMsg <= 2048); assert.equal(DEFAULTS.maxRate, 80);
        assert.ok(DEFAULTS.burst >= 160 && DEFAULTS.burst <= 400, 'a few seconds of a client\'s messages may arrive at once');
        assert.ok(DEFAULTS.pingMs < 100000, 'pings well inside Cloudflare\'s 100 s idle limit');
        assert.ok(DEFAULTS.origins.includes('maddog107.com') && DEFAULTS.origins.includes('localhost') && !DEFAULTS.allowNoOrigin);
        assert.equal(DEFAULTS.trustProxy, false, 'no proxy header is believed unless the relay is told it is behind one');
    });
});

describe('relay: the WebSocket protocol (raw TCP client)', () => {
    let R;
    before(async () => { R = await startRelay(); });
    after(() => R.stop());

    test('handshake: 101 with the right Sec-WebSocket-Accept', async () => {
        const r = await raw(R.port);
        assert.equal(r.status, 101);
        const accept = createHash('sha1').update(r.key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
        assert.match(r.headers, new RegExp('Sec-WebSocket-Accept: ' + accept.replace(/[+/=]/g, '\\$&'), 'i'));
        assert.doesNotMatch(r.headers, /Sec-WebSocket-Extensions/i, 'no extensions agreed');
        r.sock.destroy();
    });

    test('handshake refused: bad version, bad key, wrong path, wrong or missing Origin', async () => {
        assert.equal((await raw(R.port, { headers: { 'Sec-WebSocket-Version': '8' } })).status, 400);
        assert.equal((await raw(R.port, { key: 'short' })).status, 400);
        assert.equal((await raw(R.port, { path: '/elsewhere' })).status, 404);
        assert.equal((await raw(R.port, { headers: { Origin: 'https://evil.example' } })).status, 403);
        assert.equal((await raw(R.port, { headers: { Origin: 'https://maddog107.com.evil.example' } })).status, 403);
        assert.equal((await raw(R.port, { headers: { Origin: null } })).status, 403);
        assert.equal((await raw(R.port, { headers: { Origin: 'https://maddog107.com' } })).status, 101);
        assert.equal((await raw(R.port, { headers: { Origin: 'http://127.0.0.1:8111' } })).status, 101);
    });

    test('a masked text frame is read; the reply is an unmasked text frame', async () => {
        const r = await raw(R.port);
        r.text(HELLO);
        await r.until(() => r.json().length);
        const w = r.json()[0];
        assert.equal(w.t, 'welcome'); assert.equal(w.name, 'RAW'); assert.equal(w.room, 'RAWROOM'); assert.equal(w.host, w.id);
        assert.ok(r.frames.every(f => !f.masked));
        r.sock.destroy();
    });

    test('a message in fragments, with a ping between them, is put together', async () => {
        const r = await raw(R.port);
        const s = JSON.stringify({ ...HELLO, room: 'FRAG' });
        r.sock.write(r.frame(1, s.slice(0, 10), { fin: false }));
        r.sock.write(r.frame(9, 'hi'));
        r.sock.write(r.frame(0, s.slice(10, 30), { fin: false }));
        r.sock.write(r.frame(0, s.slice(30)));
        await r.until(() => r.json().length);
        assert.equal(r.json()[0].room, 'FRAG');
        const pong = r.frames.find(f => f.op === 10);
        assert.ok(pong && pong.data.toString() === 'hi', 'the ping was answered with its payload');
        r.sock.destroy();
    });

    test('a frame with a 16-bit length (126…2048 bytes) is accepted', async () => {
        const r = await raw(R.port);
        r.text({ ...HELLO, room: 'LEN16' });
        await r.until(() => r.json().length);
        const rows = []; for (let i = 0; i < 10; i++) rows.push([i, 1, 12345.67, 2345.67, -12345.67, 1, 2, 3, 32767, 1234, -1234, 1234, 100, 255, 1000, 90]);
        const msg = JSON.stringify({ t: 's', c: 123456, e: rows });
        assert.ok(msg.length > 126 && msg.length < 2048);
        r.text(msg);
        r.text({ t: 'ping', n: 7 });
        await r.until(() => r.json().some(m => m.t === 'pong'));
        assert.ok(!r.closed);
        r.sock.destroy();
    });

    test('dropped: an unmasked frame, a frame over 2 KB, a 64-bit length, a binary frame, a reserved bit', async () => {
        for (const [what, send, code] of [
            ['unmasked', (r) => r.sock.write(r.frame(1, JSON.stringify(HELLO), { mask: false })), 1002],
            ['too big', (r) => r.sock.write(r.frame(1, 'x'.repeat(2049))), 1009],
            ['64-bit length', (r) => r.sock.write(r.frame(1, 'x'.repeat(10), { len64: true })), 1009],
            ['binary', (r) => r.sock.write(r.frame(2, Buffer.from([1, 2, 3]))), 1003],
            ['reserved bit', (r) => { const f = r.frame(1, '{}'); f[0] |= 0x40; r.sock.write(f); }, 1002],
            ['fragments over 2 KB in all', (r) => { r.sock.write(r.frame(1, 'x'.repeat(1500), { fin: false })); r.sock.write(r.frame(0, 'x'.repeat(1500))); }, 1009],
            ['a continuation with nothing to continue', (r) => r.sock.write(r.frame(0, 'x')), 1002],
        ]) {
            const r = await raw(R.port);
            send(r);
            await r.until(() => r.closed);
            assert.equal(r.closeCode(), code, what);
        }
    });

    test('a close frame is answered with one', async () => {
        const r = await raw(R.port);
        r.sock.write(r.frame(8, Buffer.from([0x03, 0xe8])));
        await r.until(() => r.closed);
        assert.equal(r.closeCode(), 1000);
    });
});

describe('relay: rooms', { skip: !HAS_WS && 'no global WebSocket in this Node' }, () => {
    let R;
    before(async () => { R = await startRelay(); });
    after(() => R.stop());

    test('hello → welcome; the room keeps the world its first pilot chose; joiners get it and the roster', async () => {
        const a = await join(R.url, { name: 'viper', room: 'alpha', time: 'dusk', weather: 'storm', ac: 'f15', lv: 'navy' });
        assert.equal(a.me.v, PROTOCOL); assert.equal(a.me.name, 'VIPER'); assert.equal(a.me.room, 'ALPHA');
        assert.equal(a.me.host, a.me.id); assert.deepEqual(a.me.set, { time: 'dusk', weather: 'storm', ai: false }); assert.deepEqual(a.me.peers, []);
        const b = await join(R.url, { name: 'Maverick', room: 'ALPHA', team: 'red', time: 'night', weather: 'clear' });
        assert.deepEqual(b.me.set, { time: 'dusk', weather: 'storm', ai: false }, 'the joiner flies in the room\'s world');
        assert.equal(b.me.host, a.me.id);
        assert.deepEqual(b.me.peers, [[a.me.id, 'VIPER', 'blue', 'f15', 'navy']]);
        assert.notEqual(b.me.id, a.me.id);
        const j = await a.next('join');
        assert.deepEqual(j.p, [b.me.id, 'MAVERICK', 'red', 'f16', 'default']);
        a.close(); b.close();
    });

    test('rubbish in a hello is replaced, never passed on', async () => {
        const a = await join(R.url, { name: '<script>alert(1)</script>', room: '../../etc', team: 'purple', ac: 'F-16; DROP', lv: 7, time: 'tea', weather: 'frogs' });
        assert.equal(a.me.name, 'SCRIPTALERT1SC'); assert.equal(a.me.room, 'ETC');
        assert.deepEqual(a.me.set, { time: 'day', weather: 'clear', ai: false });
        const b = await join(R.url, { name: 'x', room: 'etc' });
        assert.deepEqual(b.me.peers, [[a.me.id, 'SCRIPTALERT1SC', 'blue', 'f16', 'default']]);
        a.close(); b.close();
    });

    test('two pilots with one callsign: the second gets a number', async () => {
        const a = await join(R.url, { name: 'GHOST', room: 'TWINS' }), b = await join(R.url, { name: 'ghost', room: 'TWINS' }), c = await join(R.url, { name: 'GHOST', room: 'TWINS' });
        assert.equal(a.me.name, 'GHOST'); assert.equal(b.me.name, 'GHOST2'); assert.equal(c.me.name, 'GHOST3');
        const d = await join(R.url, { name: 'ABCDEFGHIJKLMN', room: 'TWINS' }), e = await join(R.url, { name: 'ABCDEFGHIJKLMN', room: 'TWINS' });
        assert.equal(e.me.name, 'ABCDEFGHIJKLM2'); assert.equal(e.me.name.length, 14);
        for (const x of [a, b, c, d, e]) x.close();
    });

    test('rooms are separate: state and events stay inside', async () => {
        const a = await join(R.url, { room: 'ONE', name: 'A' }), b = await join(R.url, { room: 'ONE', name: 'B' }), c = await join(R.url, { room: 'TWO', name: 'C' });
        assert.deepEqual(c.me.peers, []);
        a.send({ t: 'e', e: ['fl', 0] });
        a.send({ t: 's', c: 1, e: [[0, 1, 2, 3, 4, 0, 0, 0, 1, 0, 0, 0, 50, 8, 100, 10]] });
        assert.deepEqual(await b.next('e'), { t: 'e', f: a.me.id, e: ['fl', 0] });
        const s = await b.next('s');
        assert.equal(s.s[0][0], a.me.id);
        await wait(150);
        assert.equal(c.got.filter(m => m.t === 'e' || m.t === 's').length, 0, 'nothing reached the other room');
        for (const x of [a, b, c]) x.close();
    });

    test('the host is the longest-connected client; it passes on when the host leaves; only the host sets the room', async () => {
        const a = await join(R.url, { room: 'HOSTS', name: 'A' }), b = await join(R.url, { room: 'HOSTS', name: 'B' }), c = await join(R.url, { room: 'HOSTS', name: 'C' });
        assert.equal(b.me.host, a.me.id); assert.equal(c.me.host, a.me.id);
        // a non-host's switch is ignored
        b.send({ t: 'set', ai: true });
        a.send({ t: 'set', ai: true });
        const s1 = await c.next('set');
        assert.deepEqual(s1.set.ai, true);
        await wait(80);
        assert.equal(c.got.filter(m => m.t === 'set').length, 0, 'only the host\'s set went round');
        a.close();
        const lb = await b.next('leave'), lc = await c.next('leave');
        assert.deepEqual(lb, { t: 'leave', id: a.me.id, host: b.me.id });
        assert.deepEqual(lc, lb);
        // the room keeps its switches for the next host, and for a late joiner
        const d = await join(R.url, { room: 'HOSTS', name: 'D' });
        assert.equal(d.me.host, b.me.id); assert.equal(d.me.set.ai, true);
        b.close();
        assert.equal((await c.next('leave')).host, c.me.id);
        c.close(); d.close();
    });

    test('an empty room is gone; the next pilot to use its code opens a new one', async () => {
        const a = await join(R.url, { room: 'GONE', name: 'A', time: 'night' });
        a.close(); await a.untilClosed(); await wait(30);
        const b = await join(R.url, { room: 'GONE', name: 'B', time: 'dawn' });
        assert.equal(b.me.set.time, 'dawn'); assert.equal(b.me.host, b.me.id);
        b.close();
    });

    test('state is batched: everyone\'s newest snapshots in one message, at most 20 times a second, none held longer than a tick', async () => {
        const a = await join(R.url, { room: 'BATCH', name: 'A' }), b = await join(R.url, { room: 'BATCH', name: 'B' }), c = await join(R.url, { room: 'BATCH', name: 'C' });
        const row = (x) => [0, 1, x, 100, 0, 0, 0, 0, 32767, 0, 0, 0, 50, 8, 100, 10];
        await wait(80); c.got.length = 0;
        const t1 = Date.now();
        for (let i = 1; i <= 6; i++) a.send({ t: 's', c: i, e: [row(i)] });
        b.send({ t: 's', c: 77, e: [row(500)], m: [[1, 2, 3, 4, 5, 6, 7, 1]] });
        // the room had been quiet: the first snapshot goes out at once…
        const s1 = await c.next('s');
        assert.deepEqual(s1.s, [[a.me.id, 1, [row(1)]]], 'alone: it did not wait for the others');
        // …and what came in behind it is one message a tick later: both pilots, A's newest three in order (its older ones dropped)
        const s2 = await c.next('s');
        assert.ok(Date.now() - t1 >= 40, 'a tick later, no sooner: ' + (Date.now() - t1) + ' ms');
        assert.deepEqual(s2.s, [[a.me.id, 4, [row(4)]], [a.me.id, 5, [row(5)]], [a.me.id, 6, [row(6)]], [b.me.id, 77, [row(500)], [[1, 2, 3, 4, 5, 6, 7, 1]]]]);
        await wait(80);
        // a steady 100 snapshots a second from A come out at the relay's rate, not A's
        c.got.length = 0;
        const t0 = Date.now();
        for (let i = 0; i < 50; i++) { a.send({ t: 's', c: 100 + i, e: [row(i)] }); await wait(10); }
        const dur = (Date.now() - t0) / 1000;
        await wait(80);
        const n = c.got.filter(m => m.t === 's').length;
        assert.ok(n >= 2 && n <= dur * 20 + 2, n + ' messages in ' + dur.toFixed(2) + ' s: never more than 20 a second');
        // nothing new, nothing sent
        c.got.length = 0; await wait(200);
        assert.equal(c.got.filter(m => m.t === 's').length, 0);
        for (const x of [a, b, c]) x.close();
    });

    test('events are relayed at once, in order, stamped with the sender; `to` sends to one client', async () => {
        const a = await join(R.url, { room: 'EV', name: 'A' }), b = await join(R.url, { room: 'EV', name: 'B' }), c = await join(R.url, { room: 'EV', name: 'C' });
        const t0 = Date.now();
        for (let i = 0; i < 20; i++) a.send({ t: 'e', e: ['st', i, 0, 0] });
        const seen = [];
        for (let i = 0; i < 20; i++) seen.push(await b.next('e'));
        void t0; // (relayed as they come, not held for the next state message: nothing here waits for a tick)
        assert.deepEqual(seen.map(m => m.e[1]), [...Array(20).keys()], 'in order');
        assert.ok(seen.every(m => m.f === a.me.id), 'the relay names the sender: nobody can speak for someone else');
        for (let i = 0; i < 20; i++) await c.next('e');
        c.got.length = 0;
        a.send({ t: 'e', e: ['hit', 0, 1, 25, 0, 0], to: b.me.id });
        assert.deepEqual((await b.next('e')).e, ['hit', 0, 1, 25, 0, 0]);
        await wait(80);
        assert.equal(c.got.filter(m => m.t === 'e').length, 0, 'the third client did not get it');
        // a `to` outside the room goes nowhere (and is not an error)
        a.send({ t: 'e', e: ['hit', 0, 1, 25, 0, 0], to: 9999 });
        a.send({ t: 'ping', n: 5 });
        assert.equal((await a.next('pong')).n, 5);
        for (const x of [a, b, c]) x.close();
    });

    test('a wrong protocol version is refused with a message to reload', async () => {
        const a = client(R.url); await a.ready;
        a.send({ t: 'hello', v: PROTOCOL - 1, name: 'OLD', room: 'V' });
        const e = await a.next('err');
        assert.equal(e.code, 'version'); assert.match(e.msg, /reload/i);
        await a.untilClosed();
        const b = client(R.url); await b.ready;
        b.send({ t: 'hello', v: PROTOCOL + 1, name: 'NEW', room: 'V' });
        assert.equal((await b.next('err')).code, 'version');
        await b.untilClosed();
    });

    test('malformed input drops the connection', async () => {
        const cases = [
            ['not JSON', 'hello?', false], ['a JSON string', '"hello"', false], ['an array', '[1,2]', false], ['null', 'null', false],
            ['an unknown type', { t: 'chat', text: 'hi' }, true], ['state before hello', { t: 's', c: 1, e: [] }, false],
            ['a second hello', { t: 'hello', v: PROTOCOL, name: 'X', room: 'M' }, true],
            ['NaN in a state', '{"t":"s","c":1,"e":[[1,NaN]]}', true], ['a string in a state', { t: 's', c: 1, e: [['x']] }, true],
            ['too many rows', { t: 's', c: 1, e: new Array(13).fill([0]) }, true], ['an event not on the list', { t: 'e', e: ['say', 'hi'] }, true],
            ['markup in an event', { t: 'e', e: ['st', '<b>'] }, true], ['a bad set', { t: 'set', ai: 'yes' }, true], ['a bad ping', { t: 'ping', n: 'x' }, true],
        ];
        for (const [what, msg, helloFirst] of cases) {
            const a = client(R.url); await a.ready;
            if (helloFirst) await a.hello({ room: 'M' + Math.random().toString(36).slice(2, 8) });
            a.send(msg);
            const c = await a.untilClosed();
            assert.equal(c.code, 4000, what);
        }
        // (earlier tests' clients are still saying goodbye: give them a moment) nobody is left connected
        for (let i = 0; i < 100 && R.relay.counts().connections; i++) await wait(10);
        assert.equal(R.relay.counts().connections, 0);
        assert.equal(R.relay.counts().rooms, 0);
    });

    test('a message over 2 KB drops the connection', async () => {
        const a = await join(R.url, { room: 'BIG' });
        a.send({ t: 'e', e: ['st', ...new Array(20).fill('x'.repeat(24))], pad: 'y'.repeat(2000) });
        assert.equal((await a.untilClosed()).code, 1009);
    });

    test('a flood drops the connection; what a held-up client owed, delivered in one go, does not', async () => {
        const a = await join(R.url, { room: 'FLOOD', name: 'A' }), b = await join(R.url, { room: 'FLOOD', name: 'B' });
        // B was stalled for a few seconds and now sends the 150 messages it owed at once: not a flood
        for (let i = 0; i < 150; i++) b.send({ t: 'ping', n: i });
        // A sends 600 at once
        for (let i = 0; i < 600; i++) a.send({ t: 'ping', n: i });
        assert.equal((await a.untilClosed()).code, 4005);
        assert.equal((await b.next('leave')).id, a.me.id);
        b.send({ t: 'ping', n: 1000 });
        for (;;) { const p = await b.next('pong'); if (p.n === 1000) break; }
        assert.ok(!b.closed, 'the burst was let through');
        b.close();
    });
});

describe('relay: more than 80 messages a second, sustained', { skip: !HAS_WS && 'no global WebSocket in this Node' }, () => {
    test('80 a second are earned back, up to the allowance; more than that at once is a flood', async () => {
        const R = await startRelay({ burst: 40 });
        try {
            assert.equal(R.relay.options.maxRate, 80);
            const a = await join(R.url, { room: 'RATE', name: 'A' }), b = await join(R.url, { room: 'RATE', name: 'B' });
            const pongs = async (c, from, n) => { for (let got = 0; got < n;) { const p = await c.next('pong'); if (p.n >= from && p.n < from + n) got++; } };
            // the whole allowance at once: fine
            for (let i = 0; i < 39; i++) b.send({ t: 'ping', n: i });
            await pongs(b, 0, 39);
            // half a second and more later it has been earned back (80 a second): the same again
            await wait(700);
            for (let i = 0; i < 39; i++) b.send({ t: 'ping', n: 100 + i });
            await pongs(b, 100, 39);
            assert.ok(!b.closed);
            // more than the allowance at once: dropped
            for (let i = 0; i < 120; i++) a.send({ t: 'ping', n: i });
            assert.equal((await a.untilClosed()).code, 4005);
            assert.equal((await b.next('leave')).id, a.me.id);
            b.close();
        } finally { await R.stop(); }
    });
});

describe('relay: caps and time-outs', { skip: !HAS_WS && 'no global WebSocket in this Node' }, () => {
    test('players per room, and rooms', async () => {
        const R = await startRelay({ maxPerRoom: 2, maxRooms: 2 });
        try {
            const a = await join(R.url, { room: 'R1', name: 'A' }), b = await join(R.url, { room: 'R1', name: 'B' });
            const c = client(R.url); await c.ready;
            c.send({ t: 'hello', v: PROTOCOL, name: 'C', room: 'R1' });
            const e = await c.next('err');
            assert.equal(e.code, 'full'); assert.match(e.msg, /full/i);
            await c.untilClosed();
            const d = await join(R.url, { room: 'R2', name: 'D' });
            const f = client(R.url); await f.ready;
            f.send({ t: 'hello', v: PROTOCOL, name: 'F', room: 'R3' });
            assert.equal((await f.next('err')).code, 'rooms');
            await f.untilClosed();
            // a place frees when someone leaves
            b.close(); await a.next('leave');
            const g = await join(R.url, { room: 'R1', name: 'G' });
            assert.equal(g.me.peers.length, 1);
            for (const x of [a, d, g]) x.close();
        } finally { await R.stop(); }
    });

    test('connections in all', async () => {
        const R = await startRelay({ maxConns: 3, maxPerIp: 100 });
        try {
            const cs = [];
            for (let i = 0; i < 3; i++) cs.push(await join(R.url, { room: 'C', name: 'P' + i }));
            const x = client(R.url); await x.ready;
            const e = await x.next('err');
            assert.equal(e.code, 'busy'); assert.match(e.msg, /full/i);
            await x.untilClosed();
            assert.equal(R.relay.counts().connections, 3);
            cs[0].close(); await cs[1].next('leave');
            const y = await join(R.url, { room: 'C', name: 'Y' });
            assert.ok(y.me.id);
            for (const c of [...cs, y]) c.close();
        } finally { await R.stop(); }
    });

    // is the next connection (with these headers) let in, or refused as one too many from its address?
    const admitted = async (R, headers, keep) => {
        const c = client(R.url, { headers }); await c.ready;
        c.send({ t: 'hello', v: PROTOCOL, name: 'P', room: 'IP' });
        const m = await Promise.race([c.next('welcome').catch(() => null), c.next('err').catch(() => null)]);
        if (m && m.t === 'welcome') { keep.push(c); return true; }
        assert.equal(m && m.code, 'address');
        return false;
    };

    test('connections per address: without TRUST_PROXY no header is read (the socket\'s address counts)', async () => {
        const R = await startRelay({ maxPerIp: 2 });
        const keep = [];
        try {
            // every one of these comes from 127.0.0.1, whatever it claims
            assert.ok(await admitted(R, { 'X-Real-IP': '203.0.113.1' }, keep));
            assert.ok(await admitted(R, { 'CF-Connecting-IP': '203.0.113.2', 'X-Forwarded-For': '203.0.113.3' }, keep));
            assert.ok(!await admitted(R, { 'X-Real-IP': '203.0.113.4' }, keep), 'a third, claiming another address, is still the third from this one');
            assert.ok(!await admitted(R, { 'CF-Connecting-IP': '203.0.113.5' }, keep));
            assert.ok(!await admitted(R, { 'X-Forwarded-For': '203.0.113.6' }, keep));
        } finally { for (const c of keep) c.close(); await R.stop(); }
    });

    test('connections per address: with TRUST_PROXY a local proxy\'s X-Real-IP counts, and only that header', async () => {
        const R = await startRelay({ maxPerIp: 2, trustProxy: true });
        const keep = [];
        try {
            assert.ok(await admitted(R, { 'X-Real-IP': '203.0.113.7' }, keep));
            assert.ok(await admitted(R, { 'X-Real-IP': '203.0.113.7' }, keep));
            assert.ok(!await admitted(R, { 'X-Real-IP': '203.0.113.7' }, keep), 'the third from that address');
            assert.ok(await admitted(R, { 'X-Real-IP': '203.0.113.8' }, keep), 'another address has its own count');
            // an IPv4-mapped IPv6 address is that IPv4 address
            assert.ok(await admitted(R, { 'X-Real-IP': '::ffff:203.0.113.8' }, keep));
            assert.ok(!await admitted(R, { 'X-Real-IP': '::ffff:203.0.113.8' }, keep));
            // CF-Connecting-IP and X-Forwarded-For are never read: with no X-Real-IP these are the proxy's own address
            assert.ok(await admitted(R, { 'CF-Connecting-IP': '198.51.100.1', 'X-Forwarded-For': '198.51.100.2' }, keep));
            assert.ok(await admitted(R, { 'CF-Connecting-IP': '198.51.100.3', 'X-Forwarded-For': '198.51.100.4' }, keep));
            assert.ok(!await admitted(R, { 'CF-Connecting-IP': '198.51.100.5', 'X-Forwarded-For': '198.51.100.6' }, keep), 'they did not make three addresses');
            // and X-Real-IP wins over whatever those two say
            assert.ok(!await admitted(R, { 'X-Real-IP': '203.0.113.7', 'CF-Connecting-IP': '198.51.100.9', 'X-Forwarded-For': '198.51.100.9' }, keep));
        } finally { for (const c of keep) c.close(); await R.stop(); }
    });

    test('connections per address: an X-Real-IP that is not an address falls back to the socket\'s', async () => {
        const R = await startRelay({ maxPerIp: 2, trustProxy: true });
        const keep = [];
        try {
            assert.ok(await admitted(R, { 'X-Real-IP': 'not-an-address' }, keep));
            assert.ok(await admitted(R, { 'X-Real-IP': '999.1.1.1' }, keep));
            for (const bad of ['203.0.113.7, 203.0.113.8', '203.0.113.7:8080', '2001:db8::zz', 'x']) assert.ok(!await admitted(R, { 'X-Real-IP': bad }, keep), JSON.stringify(bad) + ' counted as the socket\'s address');
            assert.ok(await admitted(R, { 'X-Real-IP': '203.0.113.7' }, keep), 'a real address still has its own count');
        } finally { for (const c of keep) c.close(); await R.stop(); }
    });

    test('connections per address: IPv6 clients are counted by /64', async () => {
        const R = await startRelay({ maxPerIp: 2, trustProxy: true });
        const keep = [];
        try {
            assert.ok(await admitted(R, { 'X-Real-IP': '2001:db8:1:2::1' }, keep));
            assert.ok(await admitted(R, { 'X-Real-IP': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }, keep));
            assert.ok(!await admitted(R, { 'X-Real-IP': '2001:0db8:0001:0002:ffff:ffff:ffff:ffff' }, keep), 'three addresses in one /64 are one client');
            assert.ok(await admitted(R, { 'X-Real-IP': '2001:db8:1:3::1' }, keep), 'the next /64 is someone else');
        } finally { for (const c of keep) c.close(); await R.stop(); }
    });

    test('addressKey / isLoopbackAddress', () => {
        assert.equal(addressKey('203.0.113.7'), '203.0.113.7');
        assert.equal(addressKey('::ffff:203.0.113.7'), '203.0.113.7');
        assert.equal(addressKey('::ffff:cb00:7107'), '203.0.113.7');
        assert.equal(addressKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
        assert.equal(addressKey('2001:DB8:1:2::9'), '2001:db8:1:2::/64');
        assert.equal(addressKey('2001:db8::1'), '2001:db8:0:0::/64');
        assert.equal(addressKey('fe80::1%en0'), 'fe80:0:0:0::/64');
        assert.equal(addressKey('64:ff9b::192.0.2.1'), '64:ff9b:0:0::/64');
        for (const bad of ['', 'x', '1.2.3', '1.2.3.4.5', '256.1.1.1', '1.2.3.4, 5.6.7.8', '1.2.3.4:80', '2001:db8::zz', ':::', null, undefined, 7, {}]) assert.equal(addressKey(bad), null, String(bad));
        for (const lo of ['127.0.0.1', '127.9.9.9', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']) assert.ok(isLoopbackAddress(lo), lo);
        for (const no of ['126.0.0.1', '10.0.0.1', '203.0.113.7', '::2', '::', '2001:db8::1', '::ffff:10.0.0.1', 'localhost', '', null]) assert.ok(!isLoopbackAddress(no), String(no));
    });

    test('an Origin the relay does not know never gets a connection', async () => {
        const R = await startRelay({ origins: ['maddog107.com', 'localhost'] });
        try {
            for (const origin of ['https://evil.example', 'https://notmaddog107.com', null]) {
                const c = client(R.url, { origin });
                await assert.rejects(c.ready, undefined, String(origin));
            }
            const ok = await join(R.url, { room: 'O' }, { origin: 'https://maddog107.com' });
            assert.ok(ok.me.id);
            ok.close();
            assert.equal(R.relay.counts().refused, 3);
            // and a refused socket is closed on the server's side too (none left open)
            let open = 1;
            for (let i = 0; i < 150 && open; i++) { await wait(10); open = await new Promise(r => R.server.getConnections((e, n) => r(n))); }
            assert.equal(open, 0);
        } finally { await R.stop(); }
        // a relay told to allow clients with no Origin (tools, not browsers)
        const R2 = await startRelay({ allowNoOrigin: true });
        try { const c = await join(R2.url, { room: 'O' }, { origin: null }); assert.ok(c.me.id); c.close(); } finally { await R2.stop(); }
    });

    test('silent connections time out: no hello, no answer to pings, idle in a room', async () => {
        const R = await startRelay({ helloMs: 150, pingMs: 60, deadMs: 60000, idleMs: 3000 });
        try {
            const a = client(R.url); await a.ready;
            assert.equal((await a.untilClosed()).code, 4006, 'no hello');
            // one that keeps sending state stays, for longer than the idle limit
            const c = await join(R.url, { room: 'T' });
            const t0 = Date.now();
            while (Date.now() - t0 < 4500) { c.send({ t: 's', c: Date.now() - t0 + 1, e: [] }); await wait(100); }
            assert.ok(!c.closed, 'still there after ' + (Date.now() - t0) + ' ms of talking');
            // in a room and answering pings (Node's client does, like a browser) but sending nothing more: idle
            const e = await c.next('err');
            assert.equal(e.code, 'idle');
            assert.equal((await c.untilClosed()).code, 4006);
        } finally { await R.stop(); }
        // a peer that has stopped answering altogether (a raw socket that never pongs)
        const R2 = await startRelay({ pingMs: 40, deadMs: 200, helloMs: 100000 });
        try {
            const r = await raw(R2.port);
            await r.until(() => r.frames.some(f => f.op === 9));
            await r.until(() => r.closed);
            assert.equal(r.closeCode(), 4006);
        } finally { await R2.stop(); }
    });

    test('closing the relay closes everyone', async () => {
        const R = await startRelay();
        const a = await join(R.url, { room: 'END' });
        await R.stop();
        assert.equal((await a.untilClosed()).code, 1001);
    });
});

// ── Production shape: its own process on a Unix socket (systemd PrivateNetwork=yes: no TCP at all), a reverse proxy in
// front setting X-Real-IP ──
describe('relay: standalone on a Unix socket', { skip: process.platform === 'win32' }, () => {
    test('listens on SOCKET, lets the proxy\'s user connect, and counts clients by the proxy\'s X-Real-IP', async () => {
        const { spawn } = await import('node:child_process');
        const { mkdtempSync, statSync, rmSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join: pjoin } = await import('node:path');
        const dir = mkdtempSync(pjoin(tmpdir(), 'skywar-relay-')), sock = pjoin(dir, 'relay.sock');
        const child = spawn(process.execPath, [new URL('../relay.mjs', import.meta.url).pathname], { env: { ...process.env, SOCKET: sock, TRUST_PROXY: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
        try {
            await new Promise((resolve, reject) => {
                let out = '';
                child.stdout.on('data', d => { out += d; if (out.includes('listening on ' + sock)) resolve(); });
                child.on('exit', (code) => reject(new Error('relay exited ' + code + ': ' + out)));
                setTimeout(() => reject(new Error('relay did not start: ' + out)), 20000).unref();
            });
            assert.equal(statSync(sock).mode & 0o777, 0o666, 'the proxy (another user) can connect to the socket');
            // an upgrade through the socket, as the proxy would send it: resolves with what came back first
            const open = (ip) => new Promise((resolve, reject) => {
                const s = net.connect(sock);
                let got = Buffer.alloc(0);
                s.on('error', reject);
                s.on('connect', () => s.write('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n'
                    + 'Sec-WebSocket-Key: ' + randomBytes(16).toString('base64') + '\r\nOrigin: ' + ORIGIN + '\r\nX-Real-IP: ' + ip + '\r\n\r\n'));
                s.on('data', d => { got = Buffer.concat([got, d]); });
                // (a refusal is written straight after the 101, and the socket closed; an accepted one just stays open)
                setTimeout(() => resolve({ s, text: got.toString('latin1') }), 400);
            });
            const held = [];
            for (let i = 0; i < DEFAULTS.maxPerIp; i++) {
                const r = await open('203.0.113.9');
                assert.match(r.text, /^HTTP\/1\.1 101 /, 'connection ' + (i + 1) + ' from one address is let in');
                assert.ok(!r.text.includes('"address"'));
                held.push(r.s);
            }
            const over = await open('203.0.113.9');
            assert.ok(over.text.includes('"code":"address"'), 'one more from that address is refused');
            held.push(over.s);
            const other = await open('2001:db8::7');
            assert.match(other.text, /^HTTP\/1\.1 101 /);
            assert.ok(!other.text.includes('"address"'), 'another address (through the same proxy) has its own count');
            held.push(other.s);
            for (const s of held) s.destroy();
        } finally {
            child.kill('SIGTERM');
            await new Promise(r => { child.on('exit', r); setTimeout(r, 3000).unref(); });
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

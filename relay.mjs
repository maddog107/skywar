// ═══════════════════════════════════════════════════════════════
// SKYWAR multiplayer relay (docs/MULTIPLAYER.md): a small WebSocket server written directly on node:http and
// node:crypto (RFC 6455), with no npm packages, so it can run on a production box where nothing gets installed.
//
//   development   node server.mjs                              static files + the relay at /ws, one port
//   production    HOST=127.0.0.1 PORT=8377 node relay.mjs      behind nginx (which proxies /skywar/ws to it)
//
// What it does: rooms keyed by a short code; every client gets a small numeric id, is told who is in the room and who
// the host is (the longest-connected client; the next one when it leaves); each client's latest state snapshot is kept
// and sent to the whole room in one combined message 20 times a second; events (hit claims, launches, deaths…) are
// relayed at once, in order. It never interprets game state: it checks the shape and the size of a message and
// passes it on stamped with the sender's id, so nobody can speak for another player.
//
// A public server, so: an Origin allowlist, caps (players per room, rooms, connections, connections per address),
// every message validated (type whitelist, finite numbers in range, short strings from a safe alphabet, 2 KB), a
// connection that sends rubbish or floods is dropped, silent ones time out, and nothing is logged or stored
// (no message contents, no addresses). Environment: HOST, PORT, ALLOWED_ORIGINS (comma-separated host names or
// origins), ALLOW_NO_ORIGIN=1 (clients that are not browsers), RELAY_STATS=1 (a line of counts a minute).
// Needs Node 18+ (written for Node 20: no global WebSocket is used).
// ═══════════════════════════════════════════════════════════════
import http from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// the protocol version (src/netproto.js PROTOCOL must match: tests/relay.test.mjs checks it); a client with another
// one is refused with a message telling the player to reload
export const PROTOCOL = 1;

export const DEFAULTS = {
    maxMsg: 2048,        // bytes in one client message (a frame, or a fragmented message in all)
    maxRate: 80,         // frames a second from one connection before it is dropped
    maxPerRoom: 16, maxRooms: 64, maxConns: 256, maxPerIp: 8,
    tickMs: 50,          // the combined state message: 20 a second
    pingMs: 25000,       // a ping this often (Cloudflare closes a WebSocket idle for ~100 s)
    deadMs: 70000,       // nothing at all heard for this long (not even a pong): gone
    helloMs: 10000,      // connected but no hello yet
    idleMs: 600000,      // in a room but no state or event for this long (a tab left hidden): the slot is freed
    maxBuffered: 262144, // bytes waiting to be written to a slow client before it is dropped
    origins: ['localhost', '127.0.0.1', '[::1]', 'maddog107.com', 'www.maddog107.com'],
    allowNoOrigin: false,
    path: null,          // only this URL path upgrades (null: any)
};

// the events a client may send (src/multiplayer.js): the relay passes them on without reading them
export const EVENTS = new Set(['hit', 'die', 'boom', 'part', 'ml', 'mx', 'fl', 'st', 'ai', 'gone', 'away', 'blast', 'bld', 'eject', 'sync']);
const TIMES = new Set(['dawn', 'day', 'dusk', 'night']);
const WEATHERS = new Set(['clear', 'cloudy', 'grey', 'rain', 'storm', 'fog', 'overcast']);
const TOKEN = /^[a-z0-9_]{1,16}$/;                 // an aircraft type, a livery
const EVENT_STR = /^[A-Za-z0-9_ -]{0,24}$/;        // a string inside an event (a weapon id, a callsign)
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ── What a player may call himself: letters, digits, space, _ and -, 14 characters, upper case ──
// (the client shows names with textContent / canvas text only; this keeps them short, plain and typeable)
const RUDE = /(FUCK|SHIT|CUNT|NIGG|FAGG|BITCH|RAPE|NAZI|HITLER|PENIS|VAGIN|PORN|WHORE|SLUT|DICK|COCK|PUSSY|ASSHOLE|RETARD|KKK)/;
const LEET = { 0: 'O', 1: 'I', 3: 'E', 4: 'A', 5: 'S', 7: 'T', 8: 'B' };
export function cleanName(s) {
    s = (typeof s === 'string' ? s : '').slice(0, 64).replace(/[^A-Za-z0-9 _-]/g, '').replace(/ +/g, ' ').trim().slice(0, 14).trim().toUpperCase();
    // (a public server with young players: the obvious words are refused, spelled with digits or spaced out too)
    if (!s || RUDE.test(s.replace(/[ _-]/g, '').replace(/[0134578]/g, d => LEET[d]))) return 'PILOT';
    return s;
}
export function cleanRoom(s) {
    s = (typeof s === 'string' ? s : '').slice(0, 64).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return s || 'PUBLIC';
}

const isNum = (x, lim) => typeof x === 'number' && x === x && x >= -lim && x <= lim;
// rows: an array of at most `maxRows` arrays of at most `maxCols` finite numbers
function numRows(a, maxRows, maxCols, lim) {
    if (!Array.isArray(a) || a.length > maxRows) return false;
    for (const r of a) {
        if (!Array.isArray(r) || r.length > maxCols) return false;
        for (const x of r) if (!isNum(x, lim)) return false;
    }
    return true;
}
// a state snapshot: { t: 's', c: sender clock (ms), e: entity rows, m: missile rows (optional) }
export function validState(m) {
    return isNum(m.c, 1e13) && m.c >= 0 && numRows(m.e, 12, 24, 1e7) && (m.m === undefined || numRows(m.m, 12, 12, 1e7));
}
// an event: { t: 'e', e: [name, ...numbers and short strings], to: a client id (optional) }
export function validEvent(m) {
    const e = m.e;
    if (!Array.isArray(e) || e.length < 1 || e.length > 24 || !EVENTS.has(e[0])) return false;
    for (let i = 1; i < e.length; i++) {
        const x = e[i];
        if (typeof x === 'string' ? !EVENT_STR.test(x) : !isNum(x, 1e9)) return false;
    }
    return m.to === undefined || (Number.isInteger(m.to) && m.to > 0 && m.to < 1e6);
}

// ── Frames ──
function frame(op, payload) {
    const n = payload.length;
    let head;
    if (n < 126) { head = Buffer.allocUnsafe(2); head[1] = n; }
    else if (n < 65536) { head = Buffer.allocUnsafe(4); head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.allocUnsafe(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(n, 6); }
    head[0] = 0x80 | op;
    return n ? Buffer.concat([head, payload]) : head;
}
const textFrame = (obj) => frame(1, Buffer.from(JSON.stringify(obj), 'utf8'));
function closeFrame(code, reason = '') {
    const r = Buffer.from(reason, 'utf8').subarray(0, 100), p = Buffer.allocUnsafe(2 + r.length);
    p.writeUInt16BE(code, 0); r.copy(p, 2);
    return frame(8, p);
}
const utf8 = new TextDecoder('utf-8', { fatal: true });

const normIp = (ip) => String(ip || '').replace(/^::ffff:/, '');
const isLoopback = (ip) => ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');
const IP_RE = /^[0-9a-fA-F:.]{2,45}$/;

// ═════════════ The relay ═════════════
export function createRelay(options = {}) {
    const opt = { ...DEFAULTS, ...options };
    const allowed = new Set(opt.origins.map(o => String(o).trim().toLowerCase()).filter(Boolean));
    const rooms = new Map();     // code → { code, clients: Map(id → client, in joining order), host, set }
    const conns = new Set();
    const perIp = new Map();
    let nextId = 1, closed = false;
    const stats = { accepted: 0, refused: 0, dropped: 0 };

    const originOk = (origin) => {
        if (!origin) return !!opt.allowNoOrigin;
        try { const u = new URL(origin); return allowed.has(u.hostname.toLowerCase()) || allowed.has(u.origin.toLowerCase()); } catch (e) { return false; }
    };
    // the client's address: the socket's, or behind a reverse proxy on this machine (nginx behind Cloudflare) the one
    // the proxy names: CF-Connecting-IP, else the last X-Forwarded-For entry (the one our own proxy appended)
    const clientIp = (req) => {
        const ip = normIp(req.socket.remoteAddress);
        if (!isLoopback(ip)) return ip;
        const cf = req.headers['cf-connecting-ip'];
        if (typeof cf === 'string' && IP_RE.test(cf.trim())) return normIp(cf.trim());
        const xff = req.headers['x-forwarded-for'];
        if (typeof xff === 'string') { const last = xff.split(',').pop().trim(); if (IP_RE.test(last)) return normIp(last); }
        return ip;
    };

    const write = (c, buf) => {
        if (c.gone) return;
        c.socket.write(buf);
        if (c.socket.writableLength > opt.maxBuffered) drop(c, 1008, 'slow'); // a client that can't keep up
    };
    const send = (c, obj) => write(c, textFrame(obj));
    const toRoom = (room, obj, except = null) => { const f = textFrame(obj); for (const c of room.clients.values()) if (c !== except) write(c, f); };

    // close a connection (with a close frame when the socket is still good); its 'close' event tidies up
    function drop(c, code = 1000, reason = '') {
        if (c.gone) return;
        c.gone = true;
        if (code !== 1000 && code !== 1001) stats.dropped++;
        try { c.socket.write(closeFrame(code, reason)); } catch (e) { /* already gone */ }
        c.socket.end();
        setTimeout(() => c.socket.destroy(), 1000).unref();
        leave(c);
    }
    const refuse = (c, code, msg) => { send(c, { t: 'err', code, msg }); drop(c, 4001, code); };

    function leave(c) {
        if (!conns.delete(c)) return;
        const n = (perIp.get(c.ip) || 1) - 1;
        if (n > 0) perIp.set(c.ip, n); else perIp.delete(c.ip);
        const room = c.room;
        if (!room) return;
        c.room = null;
        room.clients.delete(c.id);
        if (!room.clients.size) { rooms.delete(room.code); return; }
        if (room.host === c.id) room.host = room.clients.keys().next().value; // the longest-connected one left
        toRoom(room, { t: 'leave', id: c.id, host: room.host });
    }

    // ── Messages ──
    function hello(c, m) {
        if (c.room) return drop(c, 4000, 'hello twice');
        if (m.v !== PROTOCOL) {
            return refuse(c, 'version', typeof m.v === 'number' && m.v > PROTOCOL
                ? 'The multiplayer server is older than this page: try again in a few minutes.'
                : 'Your copy of the game is out of date: reload the page to play multiplayer.');
        }
        const code = cleanRoom(m.room);
        let room = rooms.get(code);
        if (!room) {
            if (rooms.size >= opt.maxRooms) return refuse(c, 'rooms', 'The server has no free rooms right now: join the PUBLIC room or try again later.');
            // the room's world: whoever opens it chooses; everyone who joins flies in that
            room = { code, clients: new Map(), host: 0, set: { time: TIMES.has(m.time) ? m.time : 'day', weather: WEATHERS.has(m.weather) ? m.weather : 'clear', ai: false } };
            rooms.set(code, room);
        }
        if (room.clients.size >= opt.maxPerRoom) return refuse(c, 'full', 'Room ' + code + ' is full (' + opt.maxPerRoom + ' pilots): try another room code.');
        // two pilots with one callsign: the second gets a number
        let name = cleanName(m.name);
        const taken = new Set([...room.clients.values()].map(p => p.name));
        for (let k = 2; taken.has(name) && k < 99; k++) name = cleanName(m.name).slice(0, 14 - String(k).length).trim() + k;
        do { c.id = nextId; nextId = nextId % 9999 + 1; } while ([...conns].some(o => o !== c && o.id === c.id));
        c.name = name;
        c.team = m.team === 'red' ? 'red' : 'blue';
        c.ac = typeof m.ac === 'string' && TOKEN.test(m.ac) ? m.ac : 'f16';
        c.lv = typeof m.lv === 'string' && TOKEN.test(m.lv) ? m.lv : 'default';
        c.room = room;
        if (!room.clients.size) room.host = c.id;
        const peers = [...room.clients.values()].map(info);
        room.clients.set(c.id, c);
        c.active = Date.now();
        send(c, { t: 'welcome', v: PROTOCOL, id: c.id, name, room: code, host: room.host, set: room.set, peers, max: opt.maxPerRoom });
        toRoom(room, { t: 'join', p: info(c) }, c);
    }
    const info = (c) => [c.id, c.name, c.team, c.ac, c.lv];

    function handle(c, m) {
        if (m === null || typeof m !== 'object' || Array.isArray(m)) return drop(c, 4000, 'malformed');
        if (m.t === 'hello') return hello(c, m);
        const room = c.room;
        if (!room) return drop(c, 4000, 'no hello');
        switch (m.t) {
            case 's':
                if (!validState(m)) return drop(c, 4000, 'malformed');
                c.state = m.m && m.m.length ? [c.id, m.c, m.e, m.m] : [c.id, m.c, m.e];
                c.dirty = true; c.active = Date.now();
                return;
            case 'e': {
                if (!validEvent(m)) return drop(c, 4000, 'malformed');
                c.active = Date.now();
                const out = { t: 'e', f: c.id, e: m.e };
                if (m.to === undefined) return toRoom(room, out, c);
                const to = room.clients.get(m.to);
                if (to && to !== c) send(to, out);
                return;
            }
            case 'ping':
                if (!isNum(m.n, 1e13)) return drop(c, 4000, 'malformed');
                return send(c, { t: 'pong', n: m.n });
            case 'set':
                // the room's switches (AI bandits on or off): the host's to throw
                if (typeof m.ai !== 'boolean') return drop(c, 4000, 'malformed');
                if (room.host !== c.id) return;
                room.set.ai = m.ai;
                return toRoom(room, { t: 'set', set: room.set });
            default:
                return drop(c, 4000, 'unknown type');
        }
    }

    function message(c, payload) {
        let m;
        try { m = JSON.parse(utf8.decode(payload)); } catch (e) { return drop(c, 4000, 'malformed'); }
        handle(c, m);
    }

    // what arrived on the socket: whole frames are taken off the front of c.buf (client frames are masked; a frame
    // or a fragmented message longer than maxMsg, a binary frame, a reserved bit: the connection is dropped)
    function parse(c) {
        while (!c.gone) {
            const b = c.buf;
            if (b.length < 2) return;
            const fin = b[0] & 0x80, op = b[0] & 0x0f;
            let len = b[1] & 0x7f, off = 2;
            if (b[0] & 0x70 || !(b[1] & 0x80)) return drop(c, 1002, 'protocol');
            if (len === 127) return drop(c, 1009, 'too big');
            if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
            if (len > opt.maxMsg) return drop(c, 1009, 'too big');
            if (op >= 8 && (len > 125 || !fin)) return drop(c, 1002, 'protocol');
            if (b.length < off + 4 + len) return;
            const payload = Buffer.allocUnsafe(len);
            for (let i = 0; i < len; i++) payload[i] = b[off + 4 + i] ^ b[off + (i & 3)];
            c.buf = b.subarray(off + 4 + len);
            // flooding: more than maxRate frames in a second
            const now = Date.now();
            if (now - c.rateT >= 1000) { c.rateT = now; c.rateN = 0; }
            if (++c.rateN > opt.maxRate) return drop(c, 4005, 'flood');
            c.seen = now;
            if (op === 1) {
                if (c.frag) return drop(c, 1002, 'protocol');
                if (fin) message(c, payload); else { c.frag = [payload]; c.fragLen = len; }
            } else if (op === 0) {
                if (!c.frag) return drop(c, 1002, 'protocol');
                c.frag.push(payload); c.fragLen += len;
                if (c.fragLen > opt.maxMsg) return drop(c, 1009, 'too big');
                if (fin) { const all = Buffer.concat(c.frag); c.frag = null; message(c, all); }
            } else if (op === 8) {
                return drop(c, 1000);
            } else if (op === 9) {
                write(c, frame(10, payload));
            } else if (op !== 10) {
                return drop(c, op === 2 ? 1003 : 1002, 'unsupported');
            }
        }
    }

    // ── The HTTP upgrade (the WebSocket handshake) ──
    function handleUpgrade(req, socket, head) {
        // say why and hang up: what the client still sends is read and thrown away (a socket left paused would never see
        // the client's close and stay open for good), and the socket is destroyed a moment later whatever the client does
        const hangUp = (data) => { socket.resume(); socket.end(data); setTimeout(() => socket.destroy(), 1000).unref(); };
        const end = (status) => { stats.refused++; hangUp('HTTP/1.1 ' + status + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); };
        socket.on('error', () => { /* its 'close' follows */ });
        const key = req.headers['sec-websocket-key'];
        let path = '/';
        try { path = new URL(req.url, 'http://x').pathname; } catch (e) { return end('400 Bad Request'); }
        if (closed || (opt.path && path !== opt.path)) return end('404 Not Found');
        if (req.method !== 'GET' || String(req.headers.upgrade || '').toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13'
            || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return end('400 Bad Request');
        if (!originOk(req.headers.origin)) return end('403 Forbidden');
        const ip = clientIp(req);
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '
            + createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
        socket.setNoDelay(true);
        const c = { socket, ip, id: 0, room: null, name: '', team: 'blue', ac: 'f16', lv: 'default', buf: head && head.length ? head : Buffer.alloc(0),
            frag: null, fragLen: 0, rateT: Date.now(), rateN: 0, seen: Date.now(), born: Date.now(), active: Date.now(), pinged: Date.now(),
            state: null, dirty: false, gone: false };
        // full: say so in a message the page can show, then close (a refused upgrade gives the page no reason at all)
        if (conns.size >= opt.maxConns || (perIp.get(ip) || 0) >= opt.maxPerIp) {
            stats.refused++;
            const many = conns.size < opt.maxConns;
            socket.write(textFrame({ t: 'err', code: many ? 'address' : 'busy', msg: many ? 'Too many connections from your network: close another tab and try again.' : 'The multiplayer server is full right now: try again in a few minutes.' }));
            hangUp(closeFrame(4001, many ? 'address' : 'busy'));
            return;
        }
        conns.add(c);
        perIp.set(ip, (perIp.get(ip) || 0) + 1);
        stats.accepted++;
        socket.on('data', (d) => {
            if (c.gone) return;
            c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d;
            parse(c);
        });
        socket.on('close', () => { c.gone = true; leave(c); });
        if (c.buf.length) parse(c);
    }

    // ── Clocks: the combined state message, and housekeeping ──
    const tick = setInterval(() => {
        for (const room of rooms.values()) {
            let s = null;
            for (const c of room.clients.values()) if (c.dirty) { c.dirty = false; (s || (s = [])).push(c.state); }
            if (s) toRoom(room, { t: 's', s });
        }
    }, opt.tickMs);
    const keep = setInterval(() => {
        const now = Date.now(), ping = frame(9, Buffer.alloc(0));
        for (const c of [...conns]) {
            if (now - c.seen > opt.deadMs) drop(c, 4006, 'timeout');
            else if (!c.room && now - c.born > opt.helloMs) drop(c, 4006, 'no hello');
            else if (c.room && now - c.active > opt.idleMs) { send(c, { t: 'err', code: 'idle', msg: 'You were away too long and lost your place in the room.' }); drop(c, 4006, 'idle'); }
            else if (now - c.pinged >= opt.pingMs) { c.pinged = now; write(c, ping); }
        }
    }, Math.max(20, Math.min(5000, opt.pingMs / 2, opt.helloMs / 2, opt.deadMs / 2, opt.idleMs / 2)));
    tick.unref(); keep.unref();

    return {
        options: opt, handleUpgrade,
        // serve WebSocket upgrades on an existing HTTP server (server.mjs: static files and the relay on one port)
        attach(server) { server.on('upgrade', handleUpgrade); return this; },
        counts: () => ({ rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.clients.size, 0), connections: conns.size, ...stats }),
        close() {
            closed = true;
            clearInterval(tick); clearInterval(keep);
            for (const c of [...conns]) drop(c, 1001, 'server closing');
        },
    };
}

// ═════════════ Standalone (production) ═════════════
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const env = process.env;
    const relay = createRelay({
        ...(env.ALLOWED_ORIGINS ? { origins: env.ALLOWED_ORIGINS.split(',') } : {}),
        allowNoOrigin: env.ALLOW_NO_ORIGIN === '1',
    });
    const server = http.createServer((req, res) => {
        // (a health check for a monitor: counts only)
        if (req.method === 'GET' && req.url === '/health') {
            const n = relay.counts();
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            return res.end(JSON.stringify({ ok: true, rooms: n.rooms, players: n.players }));
        }
        res.writeHead(426, { 'Content-Type': 'text/plain', Connection: 'close' });
        res.end('SKYWAR multiplayer relay: WebSocket connections only\n');
    });
    server.headersTimeout = 10000; server.requestTimeout = 10000; server.keepAliveTimeout = 5000;
    relay.attach(server);
    const host = env.HOST || '127.0.0.1', port = +(env.PORT || 8377);
    server.listen(port, host, () => console.log(`SKYWAR relay (protocol ${PROTOCOL}) listening on ${host}:${port}`));
    if (env.RELAY_STATS === '1') setInterval(() => { const n = relay.counts(); console.log(`rooms ${n.rooms} players ${n.players} connections ${n.connections} refused ${n.refused} dropped ${n.dropped}`); }, 60000).unref();
    const stop = () => { relay.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

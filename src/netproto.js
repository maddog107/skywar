// ═══════════════════════════════════════════════════════════════
// Multiplayer wire format (docs/MULTIPLAYER.md): what a client sends the relay (relay.mjs) and reads back.
// Pure functions and constants: no three.js, no DOM, so the node tests and the relay's tests can load it.
//
// Messages are JSON text. A client's state goes out 20 times a second as rows of plain numbers, quantised so a row
// is about 100 bytes:
//   entity  [n, life, x, y, z, qx, qy, qz, qw, vx, vy, vz, throttle, flags, health, g]
//   missile [id, x, y, z, vx, vy, vz, tracking]
// n is the entity's number with its owner (0: the player's jet; 1…: AI aircraft the host flies); `life` goes up by
// one with every new airframe, so a snapshot that was still in the post when the jet died can't bring it back.
// Everything a peer sends is checked again here on the way in (decodeEntity): a peer is not trusted either.
// ═══════════════════════════════════════════════════════════════

export const PROTOCOL = 2;          // relay.mjs PROTOCOL must be the same number (2: bombs, rockets, buildings)
export const SEND_HZ = 20;          // state snapshots a second
export const INTERP_DELAY = 0.1;    // s: remote aircraft are drawn this far in the past, between two snapshots
export const EXTRAP_MAX = 0.5;      // s: how long a remote aircraft coasts on its last velocity when snapshots stop
export const STALE_AFTER = 3;       // s without a snapshot: the aircraft is hidden and can't be hit or locked
export const MAX_ENTITIES = 12, MAX_MISSILES = 12;   // rows in one state message (the relay's limits)
export const MAX_PLAYERS = 16;
export const MAX_MISSILE_ID = 65535;                 // a missile's id with its owner: 1 … this (anything else is refused)
export const MAX_LIFE = 1e6;                         // airframe counts beyond this are refused
export const MAX_EVENT = 64;                         // an event's length, its name included (the relay's limit)

// an entity's id across the room: its owner's client id and its number with that owner
export const NMAX = 4096;
export const eid = (cid, n) => cid * NMAX + n;
export const eidOwner = (e) => Math.floor(e / NMAX);
export const eidN = (e) => e % NMAX;

export const FLAG = {
    GEAR: 1, FIRE: 2, GROUND: 4, ALIVE: 8, AB: 16, FALLING: 32, BRAKE: 64, SAFE: 128,
    FLAP1: 256, FLAP2: 512, HOOK: 1024, BELLY: 2048,
};
// how a hit was made (Aircraft.damage's `kind`), as a number on the wire
export const KINDS = ['gun', 'missile', 'flak', 'rocket', 'bomb', 'blast', 'rifle', 'crash'];
export const kindCode = (k) => Math.max(0, KINDS.indexOf(k));
export const REGION_CODES = ['center', 'nose', 'wingL', 'wingR', 'tail'];

const r2 = (x) => Math.round(x * 100) / 100;
const fin = (x) => typeof x === 'number' && x === x && x !== Infinity && x !== -Infinity;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// s: { n, life, pos, quat, vel, throttle, flags, health, g }  (pos / vel: {x, y, z}; quat: {x, y, z, w})
export function encodeEntity(s) {
    const p = s.pos, q = s.quat, v = s.vel;
    return [s.n, s.life, r2(p.x), r2(p.y), r2(p.z),
        Math.round(q.x * 32767), Math.round(q.y * 32767), Math.round(q.z * 32767), Math.round(q.w * 32767),
        Math.round(v.x * 10), Math.round(v.y * 10), Math.round(v.z * 10),
        Math.round(clamp(s.throttle, 0, 1) * 100), s.flags | 0, Math.round(Math.max(0, s.health) * 10), Math.round(clamp(s.g, -20, 20) * 10)];
}

// a row from a peer → out { n, life, px, py, pz, qx, qy, qz, qw, vx, vy, vz, thr, flags, hp, g }, or null when it
// isn't one (wrong length, not numbers, off the map)
export function decodeEntity(row, out = {}) {
    if (!Array.isArray(row) || row.length < 16) return null;
    for (let i = 0; i < 16; i++) if (!fin(row[i])) return null;
    const n = row[0], life = row[1];
    if (n < 0 || n >= NMAX || n !== Math.floor(n) || life < 0 || life > MAX_LIFE || life !== Math.floor(life)) return null;
    if (Math.abs(row[2]) > 250000 || Math.abs(row[4]) > 250000 || row[3] < -1000 || row[3] > 60000) return null;
    let qx = row[5], qy = row[6], qz = row[7], qw = row[8];
    const ql = Math.hypot(qx, qy, qz, qw);
    if (ql < 1) { qx = qy = qz = 0; qw = 1; } else { qx /= ql; qy /= ql; qz /= ql; qw /= ql; }
    let vx = row[9] / 10, vy = row[10] / 10, vz = row[11] / 10;
    const vl = Math.hypot(vx, vy, vz);
    if (vl > 2500) { vx *= 2500 / vl; vy *= 2500 / vl; vz *= 2500 / vl; }
    out.n = n; out.life = life;
    out.px = row[2]; out.py = row[3]; out.pz = row[4];
    out.qx = qx; out.qy = qy; out.qz = qz; out.qw = qw;
    out.vx = vx; out.vy = vy; out.vz = vz;
    out.thr = clamp(row[12] / 100, 0, 1);
    out.flags = row[13] | 0;
    out.hp = clamp(row[14] / 10, 0, 1e5);
    out.g = clamp(row[15] / 10, -20, 20);
    return out;
}

// m: { id, pos, vel, tracking, bomb }  (bomb: a guided bomb's row, not a missile's: the last number is 2)
export function encodeMissile(m) {
    const p = m.pos, v = m.vel;
    return [m.id, r2(p.x), r2(p.y), r2(p.z), Math.round(v.x), Math.round(v.y), Math.round(v.z), m.bomb ? 2 : m.tracking ? 1 : 0];
}
export function decodeMissile(row, out = {}) {
    if (!Array.isArray(row) || row.length < 8) return null;
    for (let i = 0; i < 8; i++) if (!fin(row[i])) return null;
    if (row[0] < 1 || row[0] > MAX_MISSILE_ID || row[0] !== Math.floor(row[0])) return null;
    if (Math.abs(row[1]) > 250000 || Math.abs(row[3]) > 250000 || row[2] < -1000 || row[2] > 90000) return null;
    out.id = row[0];
    out.px = row[1]; out.py = row[2]; out.pz = row[3];
    out.vx = clamp(row[4], -4000, 4000); out.vy = clamp(row[5], -4000, 4000); out.vz = clamp(row[6], -4000, 4000);
    out.tracking = row[7] === 1;
    out.bomb = row[7] === 2;
    return out;
}

// ── Bombs and rockets (netordnance.js) ──
// 'ord' [name, n, store, kind, guided, clock, …items]: what one aircraft released in one frame, ORD_ITEM numbers each
//   item [id, x, y, z, vx, vy, vz, age (ms), twist (rad × 100)]
// 'blast' [name, clock, …ends]: what of ours ended in one frame, BLAST_ITEM numbers each: [id, x, y, z, how]
export const ORD_KINDS = ['bomb', 'gbu', 'buster', 'moab', 'rkt'];   // weapons.js dropBomb kinds, and a rocket
export const ORD_HEAD = 6, ORD_ITEM = 9, BLAST_HEAD = 2, BLAST_ITEM = 5;
export const ORD_PER_EVENT = Math.floor((MAX_EVENT - ORD_HEAD) / ORD_ITEM);        // 6: a rocket pod's whole salvo
export const BLAST_PER_EVENT = Math.floor((MAX_EVENT - BLAST_HEAD) / BLAST_ITEM);  // 12
// How a bomb, a rocket or a missile ended (its owner's word: every client plays the same end from it)
//   HIT     a missile or rocket went off on its target or by its proximity fuse; a bomb on a ship (no crater)
//   GROUND  a bomb burst on the ground; a missile or rocket came to the end of its flight (into the ground or the sea,
//           out of fuel or life): where exactly it was says which, as in weapons.js
//   WATER   a bomb into the sea          WORLD  into a building (or an air target): no crater
//   OPEN    a cluster bomb opened        BURIED, BURIED_IN  a bunker buster went into the ground / a building (its
//           delay fuse follows)          QUIET  taken out of the game without a bang
export const HOW = { HIT: 0, GROUND: 1, WATER: 2, WORLD: 3, OPEN: 4, BURIED: 5, BURIED_IN: 6, QUIET: 7 };

// ── Town buildings (networld.js) ──
// A building on the wire is its place in the towns' list (the same on every client: tests/towns.test.mjs pins it)
// with a byte of its position, so a client whose list were different would ignore it rather than knock the wrong
// one down: entry = index × 256 + check
export const bldCheck = (b) => ((Math.round(b.x) * 31) ^ Math.round(b.z)) & 255;
export const bldEntry = (index, b) => index * 256 + bldCheck(b);
// 'bld' [name, clock, …entries]
export const BLD_HEAD = 2, BLD_PER_EVENT = MAX_EVENT - BLD_HEAD;
// 'sync' [name, 0]: a newcomer asks the host. The host's answer: the destroyed ones as a bitset, in parts
//   [name, 1, epoch, part, parts, count, digest, …32-bit words] (bit i of word k: building 32 k + i)
//   [name, 2, epoch, …bridge entries] (networld.js)
export const SYNC_HEAD = 7, SYNC_WORDS = MAX_EVENT - SYNC_HEAD - 1;   // 56 words: 1792 buildings a part
// a digest of the list (where each building stands): two clients with the same one have the same towns
export function listDigest(list) {
    let h = 0x811c9dc5 ^ list.length;
    for (const b of list) {
        for (const v of [Math.round(b.x * 10), Math.round(b.z * 10)]) for (let k = 0; k < 4; k++) { h ^= (v >> (k * 8)) & 0xff; h = Math.imul(h, 0x01000193); }
    }
    return h >>> 0;
}
// n flags (isSet(i)) as 32-bit words
export function packBits(n, isSet) {
    const words = new Array(Math.ceil(n / 32)).fill(0);
    for (let i = 0; i < n; i++) if (isSet(i)) words[i >> 5] = (words[i >> 5] | (1 << (i & 31))) >>> 0;
    return words;
}

// ── Names (the relay enforces the same rules: relay.mjs cleanName / cleanRoom) ──
// a callsign: letters, digits, space, _ and -, at most 14 characters, upper case
export function cleanCallsign(s) {
    return (typeof s === 'string' ? s : '').slice(0, 64).replace(/[^A-Za-z0-9 _-]/g, '').replace(/ +/g, ' ').trim().slice(0, 14).trim().toUpperCase();
}
// a room code: letters and digits, at most 8, upper case; nothing typed = the public room
export function cleanRoom(s) {
    return (typeof s === 'string' ? s : '').slice(0, 64).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'PUBLIC';
}
// a string that may go inside an event (the relay drops a connection that sends any other character)
export function safeStr(s, max = 24) {
    return (typeof s === 'string' ? s : '').replace(/[^A-Za-z0-9_ -]/g, '').slice(0, max);
}

// the relay's address, from the page's: ws(s)://<where the page is>/ws, so the same build works at
// http://localhost:8080/ and at https://maddog107.com/skywar/
export function relayUrl(base) {
    const u = new URL('ws', base);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.search = ''; u.hash = '';
    return u.href;
}

// ═══════════════════════════════════════════════════════════════
// Multiplayer (docs/MULTIPLAYER.md): the towns' buildings, the same for everyone.
//
// Every client builds the same building records, in the same order (tests/towns.test.mjs pins them; the e2e check
// fingerprints them on each page). What brings one down is decided where the weapon that did it was fired, as with
// aircraft: whoever's bomb, rocket, missile, cannon or crash drops a building on his own screen tells the room
// (`bld`: its place in the list), and every other client brings that one down too, at the moment its picture of the
// blast gets there. A blast from someone else's weapon still does its damage here (netordnance.js: so hits from two
// pilots add up), but it never brings a building down by itself: only its owner's word does. So every client has the
// same buildings down, whatever each one's own count of the damage to those still standing.
//
// A newcomer asks the room's host (`sync`) for the buildings down so far: a bitset, ~1 KB in four parts, taken only
// from the host and only while asked for; they are ruins at once (buildings.js ruin: no collapse, no fire). Buildings
// stay down while the room lives (as long as anyone who saw them fall is in it); a sortie flown from the menu starts
// with whole towns and asks again. The airbases' structures stay indestructible here (as before).
//
// Building destruction is scenery in multiplayer: no score, no feed lines (the kill lines must stay on the feed).
// ═══════════════════════════════════════════════════════════════
import {
    MAX_EVENT, bldCheck, bldEntry, BLD_PER_EVENT, SYNC_HEAD, SYNC_WORDS, listDigest, packBits,
} from './netproto.js';

// the towns' records (buildings.js KINDS): the airbases' hangars, towers and shelters are not among them
const TOWN_KINDS = new Set(['house', 'town', 'shop', 'apt', 'tower', 'church', 'landmark', 'stadium', 'station', 'market', 'watertower']);
const APPLY_PER_FRAME = 30;     // remote buildings brought down in one frame at most (a MOAB's hundred over a few frames)
const WAIT_MAX = 1;             // s: what a peer says fell is applied when our picture of it gets there, or after this
const SYNC_WAIT = 15;           // s a newcomer takes the host's answer for
const int = (x, lo, hi) => (typeof x === 'number' && x >= lo && x <= hi && x === Math.floor(x) ? x : -1);
// a budget: `rate` a second, at most `cap` saved up
function allow(b, now, rate, cap) {
    b.n = Math.min(cap, (b.n ?? cap) + Math.max(0, now - (b.t ?? now)) * rate);
    b.t = now;
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
}

export class NetWorld {
    constructor(mp) {
        this.mp = mp;
        this.bl = null;
        this.list = [];             // the town buildings, in the order every client has them
        this.index = new Map();     // record → its place in that list
        this.digest = 0;
        this.out = [];              // ours that fell, not yet told (kept while the connection is down)
        this.due = new Map();       // index → { peer, c, at }: what a peer says fell, waiting for our picture of it
        this.want = null;           // { host, until, got: Set of parts, parts }: we asked the host for the state
        this.applying = false;      // (bringing down what a peer said fell: not ours to tell)
        this.noKill = false;        // (a peer's blast: its damage, never the last blow)
        this.saved = null;
        this.epoch = 0;
        this.warned = false;
    }

    // ═════════════ The world's buildings, while the mode runs ═════════════
    attach(bl) {
        if (!bl || this.bl) return;
        this.bl = bl;
        this.list = bl.list.filter(b => TOWN_KINDS.has(b.kind));
        this.index = new Map(this.list.map((b, i) => [b, i]));
        this.digest = listDigest(this.list);
        const own = (k) => (Object.prototype.hasOwnProperty.call(bl, k) ? bl[k] : null);
        this.saved = { damage: own('damage'), destroy: own('destroy') };
        const proto = Object.getPrototypeOf(bl);
        // only the towns' buildings can be hurt (the airbases' are as they were: indestructible here)
        bl.damage = (b, amount, game, source) => { if (this.index.has(b)) proto.damage.call(bl, b, amount, game, source); };
        bl.destroy = (b, game, source) => {
            // a peer's blast: everything but the last blow (its owner says whether it fell): left scorched and smoking
            if (this.noKill) {
                b.hp = Math.max(1, b.hp);
                if (!bl.smoking.some(q => q.b === b)) bl.smoking.push({ b, puff: 0 });
                bl.scorch(b, 0.45);
                return;
            }
            proto.destroy.call(bl, b, game, null); // (no score, no feed line: scenery here)
            if (!this.applying) this.tell(b);
        };
    }

    detach() {
        const bl = this.bl;
        if (!bl) return;
        for (const k of ['damage', 'destroy']) { if (this.saved[k]) bl[k] = this.saved[k]; else delete bl[k]; }
        this.bl = null; this.saved = null;
        this.list = []; this.index = new Map();
        this.reset();
    }

    reset() { this.out.length = 0; this.due.clear(); this.want = null; this.applying = false; this.noKill = false; }

    // one of ours fell on our screen: the room is told (at the end of the frame, with the frame's clock)
    tell(b) {
        const i = this.index.get(b);
        if (i !== undefined && this.out.length < this.list.length) this.out.push(i);
    }

    // a peer's blast (netordnance.js): its damage to the buildings round it, never bringing one down
    blast(at, R, amount) {
        const bl = this.bl, g = this.mp.game;
        if (!bl || !(R > 0) || !(amount > 0)) return;
        this.noKill = true;
        try { bl.explode(at, R, amount, g, null); } finally { this.noKill = false; }
    }

    // ═════════════ Every frame ═════════════
    update(now) {
        if (!this.bl) return;
        if (this.out.length && this.mp.link && this.mp.link.open) this.flush();
        if (this.due.size) this.applyDue(now);
        if (this.want && now > this.want.until) this.want = null; // (no answer: we keep what we saw fall ourselves)
    }

    flush() {
        const c = Math.round(this.mp.frameNow() * 1e4) / 10;
        while (this.out.length) {
            const part = this.out.splice(0, BLD_PER_EVENT);
            this.mp.send(['bld', c, ...part.map(i => bldEntry(i, this.list[i]))]);
        }
    }

    // ═════════════ What the others say fell ═════════════
    // e: ['bld', its clock (ms), …entries]: brought down here when our picture of that peer gets to that moment
    onBld(peer, e) {
        if (!this.bl || e.length > MAX_EVENT) return;
        const c = typeof e[1] === 'number' && e[1] >= 0 ? e[1] / 1000 : -1, now = this.mp.now();
        for (let k = 2; k < e.length; k++) {
            const x = e[k];
            const i = int(Math.floor(x / 256), 0, this.list.length - 1);
            if (i < 0 || typeof x !== 'number' || x !== Math.floor(x)) continue;
            const b = this.list[i];
            if ((x & 255) !== bldCheck(b)) { if (!this.warned) { this.warned = true; console.warn('[multiplayer] a building that isn\'t ours: the towns differ'); } continue; }
            if (!b.alive || this.due.has(i)) continue; // (one entry per building: the queue can't grow past the list)
            this.due.set(i, { peer, c, at: now });
        }
    }

    // the moment a peer's picture is drawn at (as its aircraft and its weapons are)
    drawnAt(peer) { return this.mp.frameNow() - (peer.clock.offset ?? 0) - peer.delay; }

    applyDue(now) {
        const g = this.mp.game, bl = this.bl;
        let n = 0;
        this.applying = true;
        try {
            for (const [i, d] of this.due) {
                if (n >= APPLY_PER_FRAME) break;
                const peerGone = !this.mp.peers.has(d.peer.id);
                if (!peerGone && d.c >= 0 && this.drawnAt(d.peer) < d.c && now - d.at < WAIT_MAX) continue;
                this.due.delete(i);
                const b = this.list[i];
                if (!b.alive) continue;
                n++;
                bl.destroy(b, g, null);
            }
        } finally { this.applying = false; }
    }

    // ═════════════ A newcomer: the buildings down so far, from the host ═════════════
    // ask the room's host (right after joining, after a reconnection, and again if the host leaves before answering)
    ask() {
        const mp = this.mp, host = mp.room.host;
        if (!this.bl || !mp.link || host === mp.me.id || !mp.peers.has(host)) { this.want = null; return; }
        this.want = { host, until: mp.now() + SYNC_WAIT, got: new Set(), parts: Math.ceil(this.list.length / (32 * SYNC_WORDS)) };
        mp.send(['sync', 0], host);
    }

    // the host left: ask the next one (or we are it: what we have is the room's)
    hostChanged() { if (this.want) this.ask(); }

    onSync(peer, e) {
        const mp = this.mp, now = mp.now();
        if (!this.bl) return;
        if (e[1] === 0) {
            // asked: we answer if we are the host, a couple of times a peer at most
            if (!mp.isHost || !allow(peer.syncAsk || (peer.syncAsk = {}), now, 0.2, 2)) return;
            return this.answer(peer.id);
        }
        if (e[1] !== 1) return;
        // the host's answer: from the host, while we wait for it, for our very towns
        const w = this.want;
        if (!w || peer.id !== mp.room.host || peer.id !== w.host || now > w.until) return;
        const part = int(e[3], 0, w.parts - 1);
        if (part < 0 || e[4] !== w.parts || e[5] !== this.list.length || e[6] !== this.digest || w.got.has(part)) return;
        w.got.add(part);
        const bl = this.bl, n = this.list.length;
        for (let k = 0; k < SYNC_WORDS && SYNC_HEAD + k < e.length; k++) {
            const word = int(e[SYNC_HEAD + k], 0, 4294967295);
            if (word <= 0) continue;
            for (let j = 0; j < 32; j++) {
                if (!((word >>> j) & 1)) continue;
                const i = (part * SYNC_WORDS + k) * 32 + j;
                if (i < n && this.list[i].alive) { bl.ruin(this.list[i]); this.due.delete(i); }
            }
        }
        if (w.got.size >= w.parts) this.want = null;
    }

    answer(to) {
        // (down, or said to have fallen and not yet drawn here)
        const n = this.list.length, words = packBits(n, (i) => !this.list[i].alive || this.due.has(i)), parts = Math.ceil(n / (32 * SYNC_WORDS));
        this.epoch = this.epoch % 1e6 + 1;
        for (let p = 0; p < parts; p++) this.mp.send(['sync', 1, this.epoch, p, parts, n, this.digest, ...words.slice(p * SYNC_WORDS, (p + 1) * SYNC_WORDS)], to);
    }

    // which of the towns' buildings are down (tests, tools/net/e2e.mjs)
    downList() { const out = []; this.list.forEach((b, i) => { if (!b.alive) out.push(i); }); return out; }
}

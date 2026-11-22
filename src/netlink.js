// ═══════════════════════════════════════════════════════════════
// Multiplayer: one connection to the relay (relay.mjs). Opens the WebSocket, says hello, waits for the welcome
// (or the relay's reason for refusing: a full room, an out-of-date page), measures the ping, and keeps what it
// sends under the relay's flood limit (events that would go over wait for the next second; the 20 state snapshots a
// second always go). Nothing here knows about the game: multiplayer.js reads `onMessage` and calls state() / event().
// Nothing is opened until connect() is called (single-player never touches the network).
// ═══════════════════════════════════════════════════════════════
import { PROTOCOL } from './netproto.js';

const EVENTS_PER_SEC = 45;   // + 20 states + pings stays well under the relay's 80 frames a second
const QUEUE_MAX = 200;

export class NetLink {
    // opts.WebSocket: the constructor to use (the browser's by default); opts.wsOptions: its second argument (node
    // tests pass { headers: { Origin } }); opts.now: a clock in ms
    constructor(url, opts = {}) {
        this.url = url;
        this.WS = opts.WebSocket || globalThis.WebSocket;
        this.wsOptions = opts.wsOptions;
        this.now = opts.now || (() => performance.now());
        this.ws = null;
        this.open = false;
        this.rtt = 0;              // ms: the ping
        this.rtts = [];
        this.onMessage = null;     // (msg) every message after the welcome
        this.backlog = [];         // what arrived after the welcome before anyone was listening (multiplayer.js attach reads it)
        this.onClose = null;       // ({ code, reason, refused }) the connection ended (after it had been open)
        this.queue = [];
        this.sentT = 0; this.sentN = 0;
        this.pingTimer = null;
    }

    // → Promise of the relay's welcome { id, name, room, host, set: { time, weather, ai }, peers }; rejects with an
    // Error whose message can be shown to the player
    connect(hello, timeoutMs = 8000) {
        return new Promise((resolve, reject) => {
            if (!this.WS) return reject(new Error('This browser has no WebSocket support: multiplayer needs it.'));
            let done = false, refused = null;
            const fail = (msg) => { if (done) return; done = true; clearTimeout(timer); this.close(); reject(new Error(msg)); };
            const unreachable = 'Can\'t reach the multiplayer server. Check your connection and try again: the server may be down.';
            let ws;
            try { ws = this.ws = this.wsOptions ? new this.WS(this.url, this.wsOptions) : new this.WS(this.url); } catch (e) { return reject(new Error(unreachable)); }
            const timer = setTimeout(() => fail('The multiplayer server didn\'t answer in time. Try again in a moment.'), timeoutMs);
            ws.onopen = () => { try { ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL, ...hello })); } catch (e) { fail(unreachable); } };
            ws.onmessage = (ev) => {
                let m;
                try { m = JSON.parse(ev.data); } catch (e) { return; }
                if (!m || typeof m !== 'object') return;
                // the ping: the quickest of the last few round trips (a slow frame holds a reply up; the network didn't)
                if (m.t === 'pong') { const r = this.now() - m.n; if (r >= 0 && r < 60000) { this.rtts.push(r); if (this.rtts.length > 8) this.rtts.shift(); this.rtt = Math.min(...this.rtts); } return; }
                if (m.t === 'err') { refused = typeof m.msg === 'string' ? m.msg.slice(0, 200) : 'The multiplayer server refused the connection.'; if (!done) fail(refused); return; }
                if (!done) {
                    if (m.t !== 'welcome') return;
                    done = true; clearTimeout(timer);
                    this.open = true;
                    this.pingTimer = setInterval(() => this.send({ t: 'ping', n: Math.round(this.now()) }), 2000);
                    this.send({ t: 'ping', n: Math.round(this.now()) });
                    resolve(m);
                    return;
                }
                // (welcomed, but the game hasn't taken the connection over yet: kept for it, the newest snapshots dropped
                // first if that takes long)
                if (this.onMessage) this.onMessage(m);
                else if (this.backlog.length < (m.t === 's' ? 400 : 2000)) this.backlog.push(m);
            };
            ws.onerror = () => { if (!done) fail(unreachable); };
            ws.onclose = (ev) => {
                const was = this.open;
                this.open = false;
                clearInterval(this.pingTimer);
                if (!done) return fail(refused || unreachable);
                if (was && this.ws === ws && this.onClose) this.onClose({ code: ev && ev.code, reason: ev && ev.reason, refused });
            };
        });
    }

    send(obj) {
        const ws = this.ws;
        if (!ws || ws.readyState !== 1) return false;
        try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    }

    // the 20-a-second snapshot: c = our clock (ms), e = entity rows, m = missile rows. Not sent while earlier ones are
    // still waiting to leave (a stalled line): a snapshot is only worth anything fresh, and when the line comes back
    // the relay should get the newest one, not seconds of old ones in a burst that looks like a flood.
    state(c, e, m) {
        const ws = this.ws;
        if (ws && ws.bufferedAmount > 8192) return false;
        return this.send(m && m.length ? { t: 's', c, e, m } : { t: 's', c, e });
    }

    // an event for the room, or for one client (`to`); held back when this second's budget is spent
    event(e, to) {
        const msg = to ? { t: 'e', e, to } : { t: 'e', e };
        if (this.queue.length || !this.budget()) { if (this.queue.length < QUEUE_MAX) this.queue.push(msg); return; }
        this.send(msg);
    }
    budget() {
        const t = this.now();
        if (t - this.sentT >= 1000) { this.sentT = t; this.sentN = 0; }
        if (this.sentN >= EVENTS_PER_SEC) return false;
        this.sentN++;
        return true;
    }
    // once a frame: send what was held back
    pump() {
        while (this.queue.length && this.budget()) this.send(this.queue.shift());
    }

    close() {
        const ws = this.ws;
        this.open = false;
        this.ws = null;
        clearInterval(this.pingTimer);
        this.queue.length = 0;
        if (ws) { ws.onmessage = ws.onerror = ws.onclose = ws.onopen = null; try { ws.close(); } catch (e) { /* ignore */ } }
    }
}

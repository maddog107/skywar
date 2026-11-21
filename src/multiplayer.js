// ═══════════════════════════════════════════════════════════════
// Multiplayer (docs/MULTIPLAYER.md): the game's side of flying in one world with other people.
//
// Every client simulates only what it owns: its own jet, and (the host) the AI bandits. Everything else is a
// *puppet*: a real Aircraft in game.aircraft with its team and callsign, so the HUD, radar, map, seekers and sounds
// treat it like any other, but with no flight model and no pilot. Each frame it is placed from its owner's snapshots
// (netinterp.js), ~100 ms in the past.
//
// Damage is decided by the shooter and applied by the owner: our rounds and missiles hit-test a puppet as they do any
// aircraft, but Aircraft.damage on a puppet becomes a hit claim sent to its owner, who applies it through the normal
// damage() path with our puppet as the source; its health and its death come back in its snapshots and events. A
// puppet's cannon is drawn (tracers, sound, no damage); its missiles are ghosts (mesh, trail, motor light) that give
// the targeted player the usual warning; its flares are dropped for real by its puppet here, so our seekers can be
// decoyed. Deaths are the owner's: a puppet falls, burns and blows up with the game's own effects when told to.
//
// The world can't pause: Esc brings the menu up while the jet flies on wings-level; photo mode is off; a hidden tab
// is "away" at once (hidden to the others, can't be hit) and gets a new jet if it stayed away.
//
// A plug-in system (systems.js): game.mp. Idle, and never near the network, unless the MULTIPLAYER mode is launched.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { AIRCRAFT, WEAPONS } from './config.js';
import { Aircraft, soundSpeed } from './aircraft.js';
import { Pilot } from './ai.js';
import { STORES } from './stores.js';
import { storeMesh } from './weapons.js';
import { applyLivery, LIVERIES } from './models.js';
import { BASES, baseToWorld } from './world.js';
import { fireLights, FIRE_COLORS } from './firelight.js';
import { registerAirTarget, unregisterAirTarget } from './softtargets.js';
import { clamp, rand, pick } from './util.js';
import { NetLink } from './netlink.js';
import { InterpBuffer, ClockSync, MODE } from './netinterp.js';
import {
    SEND_HZ, INTERP_DELAY, STALE_AFTER, MAX_ENTITIES, MAX_MISSILES, NMAX, FLAG, KINDS, REGION_CODES, kindCode,
    eid, eidOwner, eidN, encodeEntity, decodeEntity, encodeMissile, decodeMissile, safeStr, relayUrl,
    MAX_MISSILE_ID, MAX_LIFE, MAX_PLAYERS, cleanCallsign, cleanRoom,
} from './netproto.js';

export const SPAWN_SAFE = 6;        // s of spawn protection (it ends early when you open fire)
export const RESPAWN_DELAY = 4;     // s from being shot down to the new jet
export const AWAY_RESPAWN = 3;      // s with the tab hidden after which an airborne jet is replaced by a fresh one
export const STALL_RESPAWN = 8;     // s frozen without the tab being hidden (a stalled machine): the same
const BANDIT_GAP = 8;               // s between a cleared wave of AI bandits and the next
// Nothing a peer sends is trusted (it arrives through the relay, which only checks its shape): every id, number and
// string is checked again where it is used, an event about something its sender doesn't own is ignored, and what a
// peer can make us build is capped, however often it repeats itself.
const MAX_PUPPETS = 48, PEER_PUPPETS = 14;   // aircraft we build for the others in all, and for any one of them (its jet + the host's bandits)
const MAX_GHOSTS = 64, PEER_GHOSTS = 16;     // their missiles we draw
const GUN_REACH = 4000;                      // m: a cannon hit claimed from further away than this is refused
const SEND_GAP = 0.07, MAX_DELAY = 0.25;     // s: the longest between two snapshots of a peer that sends evenly; the most we draw it in the past
export const LIMITS = { MAX_PUPPETS, PEER_PUPPETS, MAX_GHOSTS, PEER_GHOSTS, GUN_REACH };
const TIMES = ['dawn', 'day', 'dusk', 'night'], WEATHERS = ['clear', 'cloudy', 'grey', 'rain', 'storm', 'fog', 'overcast'];
const MISSILE_KINDS = ['aam', 'lrm', 'xlr', 'arm', 'agm', 'ashm', 'alcm', 'sam'];
// a table's own entry (never 'constructor' or 'toString' off its prototype: the key is a peer's)
const own = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
// an integer in [lo, hi], or -1
const int = (x, lo, hi) => (typeof x === 'number' && x >= lo && x <= hi && x === Math.floor(x) ? x : -1);
// a budget: `rate` a second, at most `cap` saved up (a launch, a new airframe: more than that from one peer is noise)
function allow(b, now, rate, cap) {
    b.n = Math.min(cap, (b.n ?? cap) + Math.max(0, now - (b.t ?? now)) * rate);
    b.t = now;
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
}
const BLUE = '#5ab8ff', RED = '#ff6a5a', GREEN = '#5dffa0', AMBER = '#ffc23f', DIM = '#9fb2c4', WARN = '#ff4a3d';
const teamCol = (t) => (t === 'red' ? RED : BLUE);

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _S = { age: 0 }, _D = {}, _M = {};
const FWD = new THREE.Vector3(0, 0, -1);
let ghostGeo = null, ghostMat = null;

// What makes an Aircraft a puppet (aircraft.js: `puppet.place` instead of the flight model, `puppet.hit` instead of damage)
class Puppet {
    constructor(mp, peer, n, life, human) {
        this.mp = mp; this.peer = peer; this.n = n; this.life = life; this.human = human;
        this.ac = null;
        this.buf = new InterpBuffer();
        this.mode = MODE.NONE;
        this.corr = new THREE.Vector3(); this.shown = new THREE.Vector3();
        this.heard = 0;          // when its last snapshot arrived (our clock)
        this.born = mp.now();    // when we built it
        this.hitT = -1e9;        // when one of ours last claimed a hit on it (a kill of it can only be ours after that)
        this.flareT = -1e9;
        this.dead = false;       // its owner said it was killed
        this.stale = false;      // no snapshots for a while, or its owner's tab is hidden: hidden here, can't be hit
        this.safe = false;       // spawn protection
        this.gunSnd = 0;
        this.name = '';
    }
    place(ac, dt) { this.mp.placePuppet(this, ac, dt); }
    hit(ac, amount, source, kind) { this.mp.claimHit(this, ac, amount, source, kind); }
}

export class Multiplayer {
    constructor(game) {
        this.game = game;
        this.active = false;
        this.link = null;            // the connection of the sortie being flown
        this.pending = null;         // a connection the lobby opened, waiting for the launch
        this.clockFn = () => performance.now() / 1000;
        this.makeLink = (url) => new NetLink(url);
        this.reset();
        if (game.events) this.bind();
        if (typeof document !== 'undefined' && document.addEventListener) {
            try { document.addEventListener('visibilitychange', () => this.onVisibility(document.visibilityState === 'hidden')); } catch (e) { /* no document events here */ }
        }
    }

    now() { return this.clockFn(); }

    // The clock snapshots are stamped with and puppets are placed by: game.time, which advances by exactly what the
    // aircraft are moved by each frame, kept on the wall clock by a corrected offset (update()). Stamping with the
    // wall clock itself would be off by wherever in its frame each client happened to read it: a few milliseconds,
    // a metre or more of a jet, different every frame.
    frameNow() { return this.t0 + this.game.time; }

    reset() {
        this.me = { id: 0, name: 'PILOT', team: 'blue', ac: 'f16', lv: 'default' };
        this.room = { code: '', host: 0, set: { time: 'day', weather: 'clear', ai: false } };
        this.peers = new Map();        // client id → peer
        this.locals = new Map();       // Aircraft we own → { n, life, safeUntil, desc }
        this.byN = new Map();          // n → Aircraft we own
        this.life = 0;                 // our jet's airframe count
        this.nextN = 1;                // numbers for the AI we own
        this.myMissiles = new Map();   // our missiles in flight → { id, target }
        this.nextMissile = 0;
        this.ghosts = new Set();       // other people's missiles as we draw them (each peer's own, by its id: peer.ghosts)
        this.claims = new Map();
        this.kills = 0; this.deaths = 0;
        this.sendT = 0; this.statT = 0; this.sentStat = '';
        this.menuOpen = false;
        this.away = false; this.wasHidden = false; this.awaySince = 0; this.lastTick = 0; this.t0 = 0;
        this.offline = null;           // { since, tries, nextAt, msg }: the connection dropped, we're trying again
        this.connecting = false;
        this.where = 'runway';
        this.waveT = 3;
        this.killedBy = null;
        this.quiet = null;
        this.hello = null;
    }

    get isHost() { return !!this.link && this.room.host === this.me.id; }
    get playerCount() { return this.peers.size + 1; }

    // ═════════════ The lobby (mplobby.js) ═════════════
    // Open the connection and join the room; resolves with the room as the relay has it (the time of day and the
    // weather are whoever opened it's), rejects with an Error to show the player. The launch follows: start().
    async connect(info) {
        this.dropPending();
        const hello = { name: info.name, room: info.room, team: info.team === 'red' ? 'red' : 'blue', ac: info.ac, lv: info.lv || 'default', time: info.time, weather: info.weather };
        const url = info.url || relayUrl(document.baseURI);
        const link = this.makeLink(url);
        const w = await link.connect(hello);
        this.pending = { link, welcome: w, hello, url };
        // (a connection made and then never launched: let go of it if it closes meanwhile)
        link.onClose = () => { if (this.pending && this.pending.link === link) this.pending = null; };
        const set = w.set && typeof w.set === 'object' ? w.set : {};
        return { code: cleanRoom(w.room), name: cleanCallsign(w.name) || 'PILOT', time: TIMES.includes(set.time) ? set.time : 'day', weather: WEATHERS.includes(set.weather) ? set.weather : 'clear',
            ai: set.ai === true, host: w.host === w.id, players: (Array.isArray(w.peers) ? w.peers.length : 0) + 1 };
    }
    dropPending() { if (this.pending) { this.pending.link.close(); this.pending = null; } }

    // take over a connection that has been welcomed (the lobby's, a reconnection's, a test's)
    attach(link, w, hello, url) {
        this.link = link; this.hello = hello; this.url = url || this.url;
        link.onMessage = (m) => { try { this.onMessage(m); } catch (e) { if (!this._warned) { this._warned = true; console.warn('[multiplayer] bad message', e); } } };
        link.onClose = (info) => this.onLinkClosed(info);
        const set = w.set && typeof w.set === 'object' ? w.set : {};
        this.me = { id: int(w.id, 1, 1e6), name: cleanCallsign(w.name) || 'PILOT', team: hello.team === 'red' ? 'red' : 'blue', ac: hello.ac, lv: hello.lv || 'default' };
        this.room = { code: cleanRoom(w.room), host: int(w.host, 1, 1e6), set: { time: TIMES.includes(set.time) ? set.time : 'day', weather: WEATHERS.includes(set.weather) ? set.weather : 'clear', ai: set.ai === true } };
        this.peers.clear();
        for (const p of Array.isArray(w.peers) ? w.peers : []) this.addPeer(p);
        // what the relay sent between its welcome and now (someone joined or left, a host described its bandits)
        if (link.backlog && link.backlog.length) for (const m of link.backlog.splice(0)) link.onMessage(m);
    }

    // ═════════════ Plug-in hooks ═════════════
    start(mode, opts = {}) {
        const g = this.game;
        this.active = mode === 'multiplayer';
        g.cockpitOnly = this.active; // nobody else would see a man on a parachute or on foot: no ejecting, no climbing out
        if (!this.active) { this.dropPending(); return; }
        const pend = this.pending;
        this.pending = null;
        this.reset();
        this.where = ['air', 'runway', 'apron'].includes(opts.start) ? opts.start : g.startPoint ? g.startPoint() : 'runway';
        if (pend) this.attach(pend.link, pend.welcome, pend.hello, pend.url);
        else this.offline = { since: this.now(), tries: 0, nextAt: Infinity, msg: 'NOT CONNECTED' }; // (launched without the lobby: alone)
        this.lastTick = 0;
        this.t0 = this.now() - (g.time || 0);
        this.quietWorld(true);
        const p = g.player;
        if (this.me.team === 'red' && g.war && g.war.setSide) g.war.setSide('red');
        if (p) { p.team = this.me.team; this.adoptPlayer(p); }
        g.callsign = this.me.name;
        g.showBanner && g.showBanner('MULTIPLAYER — ROOM ' + this.room.code, this.playerCount + ' PILOT' + (this.playerCount === 1 ? '' : 'S') + ' · YOU ARE ' + this.me.name + ' (' + this.me.team.toUpperCase() + ') · TAB: SCORES', 6, teamCol(this.me.team));
        for (const peer of this.peers.values()) this.greet(peer);
    }

    clear() {
        const g = this.game;
        if (this.link) { this.link.onClose = null; this.link.close(); this.link = null; }
        for (const gh of [...this.ghosts]) this.removeGhost(gh, false);
        if (this.active || this.quiet) this.quietWorld(false);
        this.active = false;
        g.cockpitOnly = false;
        this.reset();
    }

    update(dt) {
        if (!this.active) return;
        const g = this.game, now = this.now();
        // back from a hidden tab (or a stall so long that everyone lost sight of us) with the jet in the air: it wasn't
        // flying while we were gone. (Not the first frame after the launch, however long that one took.)
        const gap = this.lastTick ? now - this.lastTick : 0;
        this.lastTick = now;
        // The frame clock stays on the wall clock. A few milliseconds apart is only where in its frame this was read:
        // eased out. More is time the simulation really lost (a frame longer than the game steps in one go, a stall):
        // the jet hung in the air that long, and the clock says so at once.
        const slip = now - this.frameNow();
        if (Math.abs(slip) > 0.015) this.t0 += slip; else this.t0 += slip * 0.05;
        if ((this.wasHidden && gap > AWAY_RESPAWN) || gap > STALL_RESPAWN) this.backFromAway(gap);
        this.wasHidden = false;
        if (this.link) this.link.pump();
        this.syncLocals(now);
        this.updateDeath(now);
        this.updatePuppets(now, dt);
        this.updateGhosts(dt, now);
        this.trackMissiles();
        this.updateBandits(dt);
        if (now - this.sendT >= 1 / SEND_HZ - 0.004) { this.sendT = now; this.sendState(); }
        if (now - this.statT > 3) this.sendStats(true);
        if (this.offline && now >= this.offline.nextAt && !this.connecting) this.reconnect();
        g.objective = 'ROOM ' + this.room.code + ' · ' + this.playerCount + ' PILOT' + (this.playerCount === 1 ? '' : 'S') + ' · KILLS ' + this.kills + ' · LOSSES ' + this.deaths + (this.room.set.ai ? ' · AI BANDITS' : '') + ' · TAB: SCORES';
    }

    onAction(a) {
        if (!this.active) return false;
        const g = this.game, p = g.player;
        switch (a) {
            case 'pause':
                // (a modal over the menu: Esc closes that first, as in the single-player pause)
                if (this.menuOpen && typeof document !== 'undefined' && document.querySelector && document.querySelector('.modal.show')) { document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show')); return true; }
                this.menu(!this.menuOpen);
                return true;
            case 'lockLost':
                if (!this.menuOpen && (g.settings.controlMode !== 'mousestick')) this.menu(true);
                return true;
            case 'photo': g.addFeed('NO PHOTO MODE IN MULTIPLAYER — THE WORLD CAN\'T STOP', DIM); return true;
            case 'eject': g.addFeed('NO EJECTING IN MULTIPLAYER — STAY WITH THE JET', DIM); return true;
            case 'target': return g.input.down('Tab'); // Tab holds the scoreboard up here; T still cycles targets
            case 'spawn': this.toggleBandits(); return true;
            case 'confirm':
                // stuck (belly-landed, or stopped somewhere that isn't one of our pads): a new jet
                if (p && p.alive && p.onGround && p.speed < 2 && (p.bellied || !g.atFriendlyPad(p))) { this.respawn('NEW JET'); return true; }
                return false;
        }
        return this.menuOpen; // (the menu is up: the jet is flying itself)
    }

    // the game's pause() in multiplayer: the menu comes up, the world goes on (game.js)
    menu(on) {
        const g = this.game;
        this.menuOpen = !!on;
        g.onPause && g.onPause(this.menuOpen);
        g.input.consumeMouse();
        if (this.menuOpen) { g.input.freeMouse = false; g.input.unlock(); }
        else {
            if (typeof document !== 'undefined' && document.querySelectorAll) document.querySelectorAll('.modal.show').forEach(m => m.classList.remove('show'));
            if (g.settings.controlMode !== 'mousestick') g.input.lock();
        }
        return true;
    }

    // the last word on the controls (game.js updatePlayer): with the menu up the jet holds its wings level and its height
    flyJet(dt, p, s) {
        if (!this.active || !this.menuOpen) return;
        s.fire = false;
        if (p.onGround) return;
        const c = p.controls, right = p.getRight(_v);
        c.roll = clamp(right.y * 2.5, -1, 1);
        c.pitch = clamp(-p.vel.y / Math.max(p.speed, 1) * 3, -0.3, 0.5);
        c.yaw = 0;
        this.game.aimDir.copy(p.vel).normalize(); // (mouse-aim: don't chase where the cursor wandered over the menu)
    }

    // where the game puts our next jet: our side's airfield (adoptPlayer then moves it to our own spot there)
    respawnPoint() {
        if (!this.active) return null;
        return { where: this.where === 'apron' ? 'runway' : this.where, base: this.teamBase() };
    }

    // the game's kill messages and score are single-player's ("SPLASH +250", combos): multiplayer writes its own
    onKilled() { return this.active; }

    // ═════════════ Spawning ═════════════
    teamBase(team = this.me.team) { return team === 'red' ? (BASES.find(b => !b.friendly && !b.civil) || BASES[0]) : BASES[0]; }

    // our place among our side's pilots (so two jets never start on the same spot)
    slot() {
        let k = 0;
        for (const p of this.peers.values()) if (p.team === this.me.team && p.id < this.me.id) k++;
        return k % 8;
    }

    // Our new jet: number it, put it on our own spot (two abreast down the runway, a row on the apron, or line abreast
    // in the air on the way to the other side's field), and protect it for a few seconds
    adoptPlayer(p) {
        const g = this.game, now = this.now();
        this.life++;
        const e = { n: 0, life: this.life, safeUntil: now + SPAWN_SAFE, player: true };
        for (const [a, o] of this.locals) if (o.n === 0 && a !== p) this.locals.delete(a);
        this.locals.set(p, e); this.byN.set(0, p);
        p.team = this.me.team; p.callsign = this.me.name;
        const base = this.teamBase(), k = this.slot(), h = base.heading;
        if (this.where === 'air') {
            const other = this.teamBase(this.me.team === 'red' ? 'blue' : 'red');
            const dx = other.x - base.x, dz = other.z - base.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
            const side = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 90;
            p.spawnAir(_v.set(base.x + ux * 2500 - uz * side, base.h + 1800 + (k % 3) * 60, base.z + uz * 2500 + ux * side), Math.atan2(-ux, -uz), 0.62);
        } else if (this.where === 'apron') {
            p.spawnRunway(base);
            const w = baseToWorld(base, 290, 60 + k * 45);
            p.pos.set(w.x, base.h + p.gearOffset, w.z);
            p.qv.setFromAxisAngle(_v.set(0, 1, 0), Math.PI / 2 - h); // nose toward the taxiway
            p.syncBody();
        } else {
            p.spawnRunway(base);
            const w = baseToWorld(base, (k % 2 ? 13 : -13), 1260 + (k >> 1) * 50);
            p.pos.set(w.x, base.h + p.gearOffset, w.z);
            p.syncBody();
        }
        if (g.aimDir) {
            g.aimDir.copy(p.vel.lengthSq() > 1 && !p.onGround ? p.vel : p.getForward(_v)).normalize();
            g.camQuat.copy(p.quat);
            g.camPos.copy(p.pos).add(_v.set(0, 6, 30).applyQuaternion(p.quat));
        }
    }

    // a new jet for us, now (shot down and the wait is over, stuck on the ground, back from being away)
    respawn(why) {
        const g = this.game;
        if (!g.respawnPlayer) return;
        g.respawnPlayer();
        if (g.player && !this.locals.has(g.player)) this.adoptPlayer(g.player);
        if (why) g.showBanner(why, 'SPAWN PROTECTION ' + SPAWN_SAFE + ' s — IT ENDS WHEN YOU OPEN FIRE', 3, GREEN);
    }

    updateDeath(now) {
        const g = this.game, p = g.player;
        if (g.state === 'dead') {
            // (the burning jet goes in before the new one arrives: one airframe of ours in the air at a time)
            if (p && p.falling && p.fallTimer > 3) p.fallTimer = 3;
            if (this.killedBy) { g.showBanner(this.killedBy.title, this.killedBy.sub, 4, WARN); this.killedBy = null; }
            if (g.deathT > RESPAWN_DELAY) this.respawn('NEW AIRFRAME');
        }
        // opening fire ends the spawn protection
        const e = p && this.locals.get(p);
        if (e && e.safeUntil > now && g.time > 0.5 && (g.time - p.lastGun < 0.1 || g.time - p.lastMissile < 0.1)) e.safeUntil = 0;
    }

    // ═════════════ What we own ═════════════
    // the aircraft this client simulates: our jet (n 0) and any AI flying here (the host's bandits)
    syncLocals(now) {
        const g = this.game, p = g.player;
        if (p && !p.exploded && !this.locals.has(p)) this.adoptPlayer(p);
        for (const a of g.aircraft) {
            if (a.puppet || a === p || this.locals.has(a) || a.exploded || !a.alive || a.abandoned || a.isPlayer) continue;
            if (this.isHost || !this.link) this.adoptAI(a); // (only the host flies AI; on our own, offline, they are ours too)
        }
        for (const [a, e] of this.locals) {
            if (a === p) continue;
            if (a.exploded) { this.forget(a, e); continue; }
            if (!g.aircraft.includes(a)) { this.send(['gone', e.n, e.life]); this.forget(a, e); } // taken out of the game without a bang
        }
    }
    forget(a, e) { this.locals.delete(a); if (this.byN.get(e.n) === a) this.byN.delete(e.n); }

    adoptAI(a) {
        while (this.byN.has(this.nextN)) this.nextN = this.nextN % (NMAX - 1) + 1;
        const e = { n: this.nextN, life: 1, safeUntil: 0 };
        this.nextN = this.nextN % (NMAX - 1) + 1;
        this.locals.set(a, e); this.byN.set(e.n, a);
        this.send(this.describe(a, e));
    }
    // what the others need to build its puppet: type, side, a name of its own (an ace's), health, skill
    describe(a, e) {
        return ['ai', e.n, safeStr(a.type, 16), a.team === 'red' ? 1 : 0, a.callsign !== a.spec.name ? safeStr(a.callsign, 20) : '', Math.round(a.maxHealth), Math.round(((a.pilot || a.pilotAI || {}).skill ?? 0.6) * 100), a.isAce ? 1 : 0];
    }

    flagsOf(a, e, now) {
        const g = this.game;
        let f = 0;
        if (a.gear) f |= FLAG.GEAR;
        if (a.alive && a.lastGun > 0 && g.time - a.lastGun < 0.12) f |= FLAG.FIRE;
        if (a.onGround) f |= FLAG.GROUND;
        if (a.alive) f |= FLAG.ALIVE;
        if (a.afterburner) f |= FLAG.AB;
        if (a.falling) f |= FLAG.FALLING;
        if (a.airbrake) f |= FLAG.BRAKE;
        if (e.safeUntil > now) f |= FLAG.SAFE;
        if (a.flaps === 1) f |= FLAG.FLAP1; else if (a.flaps >= 2) f |= FLAG.FLAP2;
        if (a.hook) f |= FLAG.HOOK;
        if (a.bellied) f |= FLAG.BELLY;
        return f;
    }

    sendState() {
        const link = this.link;
        if (!link || !link.open || this.away) return;
        const now = this.now(), rows = [], ms = [];
        for (const [a, e] of this.locals) {
            if (a.exploded || rows.length >= MAX_ENTITIES) continue;
            rows.push(encodeEntity({ n: e.n, life: e.life, pos: a.pos, quat: a.quat, vel: a.vel, throttle: a.throttle, flags: this.flagsOf(a, e, now), health: a.health, g: a.gLoad }));
        }
        for (const [m, r] of this.myMissiles) {
            if (ms.length >= MAX_MISSILES) break;
            const t = r.target;
            ms.push(encodeMissile({ id: r.id, pos: m.pos, vel: m.vel, tracking: !!t && m.target === t && !m.lost && t.alive !== false }));
        }
        this.flushClaims();
        link.state(Math.round(this.frameNow() * 1e4) / 10, rows, ms); // our frame clock, ms to a tenth (a millisecond is 30 cm at Mach 1)
    }

    send(e, to) { if (this.link && this.link.open) this.link.event(e, to); }

    sendStats(force, to) {
        const ping = Math.round(this.link ? this.link.rtt : 0), s = this.kills + ',' + this.deaths + ',' + ping;
        this.statT = this.now();
        if (!force && s === this.sentStat) return;
        this.sentStat = s;
        this.send(['st', this.kills, this.deaths, ping], to);
    }

    // ═════════════ Game events → the room ═════════════
    bind() {
        const ev = this.game.events;
        ev.on('killed', (ac, d) => { if (this.active) this.localKilled(ac, d || {}); });
        ev.on('exploded', (ac, d) => { if (this.active) this.localExploded(ac, d || {}); });
        ev.on('flares', (ac) => { const e = this.active && this.locals.get(ac); if (e) this.send(['fl', e.n]); });
        ev.on('partLost', (ac, d) => { const e = this.active && this.locals.get(ac); if (e && d) this.send(['part', e.n, e.life, Math.max(0, REGION_CODES.indexOf(d.region))]); });
        ev.on('missileLaunch', (ac, d) => { if (this.active && d && d.missile && !d.missile.ghost) this.localLaunch(ac, d.missile, d.target); });
    }

    // an entity anywhere in the room, by id: { ac, name, team, mine, player }
    who(id) {
        if (typeof id !== 'number' || !(id > 0) || id !== Math.floor(id) || id > 1e12) return null;
        const cid = eidOwner(id), n = eidN(id);
        if (cid === this.me.id) {
            const ac = this.byN.get(n);
            return { ac: ac || null, name: n === 0 ? this.me.name : ac ? this.nameOf(ac) : 'BANDIT', team: n === 0 ? this.me.team : ac ? ac.team : 'red', mine: true, player: n === 0 };
        }
        const peer = this.peers.get(cid);
        if (!peer) return null;
        const rec = peer.ents.get(n), d = n === 0 ? null : peer.desc.get(n);
        return { ac: rec ? rec.ac : null, name: n === 0 ? peer.name : rec ? rec.name : d ? this.descName(d) : 'BANDIT', team: n === 0 ? peer.team : d ? d.team : 'red', mine: false, player: n === 0, peer };
    }
    nameOf(ac) { return (ac.callsign || ac.spec.name).toUpperCase(); }
    descName(d) { return (d.name || (AIRCRAFT[d.type] || AIRCRAFT.f16).name).toUpperCase(); }
    idOf(ac) {
        if (!ac) return 0;
        if (ac.puppet) return eid(ac.puppet.peer.id, ac.puppet.n);
        const e = this.locals.get(ac);
        return e ? eid(this.me.id, e.n) : 0;
    }

    // one of ours was killed (the normal damage path decided it): tell the room who did it
    localKilled(ac, { source, kind }) {
        const e = this.locals.get(ac);
        if (!e) return;
        const g = this.game;
        // a crash long after the last hit is nobody's kill
        const credit = source && source !== ac && !(kind === 'crash' && !(g.time - ac.lastHitTime < 10));
        let k = credit ? this.idOf(source) : 0;
        // (hit by someone whose aircraft we never had a picture of: the last claim that hurt it still names them)
        if (!k && e.hitBy && g.time - e.hitT < 10) k = e.hitBy;
        this.send(['die', e.n, e.life, k, kindCode(kind)]);
        const killer = this.who(k);
        this.record({ name: e.player ? this.me.name : this.nameOf(ac), team: ac.team, mine: true, player: !!e.player }, killer, kind);
        if (e.player) {
            this.deaths++;
            this.sendStats(false);
            this.killedBy = killer ? { title: 'SHOT DOWN', sub: 'by ' + killer.name + (killer.ac ? ' (' + killer.ac.spec.name.toUpperCase() + ')' : '') } : { title: 'CRASHED', sub: '' };
        }
    }

    localExploded(ac, { ground, water }) {
        const e = this.locals.get(ac);
        if (!e) return;
        const p = ac.pos;
        this.send(['boom', e.n, e.life, ground ? 1 : 0, water ? 1 : 0, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10]);
    }

    // a kill, for the feed and the score: victim / killer { name, team, mine, player }; unknown: someone was named as
    // the killer who isn't in the room (or it was us, and we never hit it)
    record(victim, killer, kind, unknown = false) {
        const g = this.game;
        const mineKill = !!killer && killer.mine && killer.player, mineDeath = victim.mine && victim.player;
        if (mineKill) {
            this.kills++;
            this.sendStats(false);
            g.kills = this.kills; g.score = (g.score || 0) + 100;
            g.killmarkerT = g.hitmarkerT = g.time;
            g.audio && g.audio.say && g.audio.say(pick(['Splash one!', 'Good kill, good kill!', 'Bandit down!', 'Splash!']));
        }
        const how = kind === 'gun' ? ' [GUNS]' : kind === 'missile' ? ' [MISSILE]' : '';
        const text = killer ? killer.name + ' shot down ' + victim.name + how : unknown ? victim.name + ' was shot down' : victim.name + ' crashed';
        g.addFeed(text.toUpperCase(), mineKill ? GREEN : mineDeath ? WARN : victim.team === this.me.team ? '#ff9f5a' : BLUE);
    }

    // ═════════════ Hit claims ═════════════
    // Aircraft.damage on a puppet (our round, our missile's warhead, our AI's): not ours to apply. Its owner is told;
    // the shooter gets the hit marker at once.
    claimHit(rec, ac, amount, source, kind) {
        if (!ac.alive || !(amount > 0) || rec.safe || rec.stale) return;
        const src = source && this.locals.get(source);
        if (!src || source.team === ac.team) return; // nothing else here may hurt it; never our own side
        const g = this.game;
        ac.lastHitBy = source; ac.lastHitTime = g.time;
        rec.hitT = this.now();
        g.events.emit('hit', ac, { source, amount, kind });
        const k = kindCode(kind), key = rec.peer.id + ':' + rec.n + ':' + rec.life + ':' + k + ':' + src.n;
        const c = this.claims.get(key);
        if (c) c.amount += amount; else this.claims.set(key, { to: rec.peer.id, n: rec.n, life: rec.life, k, src: src.n, amount });
        if (kind !== 'gun') this.flushClaims(); // (a stream of cannon hits goes out as one claim per snapshot)
    }
    flushClaims() {
        if (!this.claims.size) return;
        for (const c of this.claims.values()) this.send(['hit', c.n, c.life, Math.round(c.amount * 10) / 10, c.k, c.src], c.to);
        this.claims.clear();
    }

    // someone claims a hit on one of ours: apply it through the normal damage path, their puppet as the source
    // e: ['hit', our entity's number, its airframe, amount, kind, the shooter's entity number]. The shooter decides
    // whether it hit (that is the design: it saw the target where it shot at it); what we can check, we do.
    onHit(peer, e) {
        const n = int(e[1], 0, NMAX - 1), srcN = int(e[5], 0, NMAX - 1), kind = KINDS[int(e[4], 0, KINDS.length - 1)], amount = e[3];
        if (n < 0 || srcN < 0 || !kind || typeof amount !== 'number' || !(amount > 0)) return;
        const ac = this.byN.get(n), ent = ac && this.locals.get(ac), now = this.now();
        if (!ent || ent.life !== e[2] || !ac.alive) return;     // not ours, not this airframe, already down
        if (this.away || now - this.lastTick > 1) return;       // we're not really here (a hidden tab): no free kills
        if (ent.safeUntil > now) return;                        // spawn protection
        if (srcN > 0 && peer.id !== this.room.host) return;     // only the host has aircraft besides its own jet
        const srcRec = peer.ents.get(srcN), src = srcRec && srcRec.ac ? srcRec.ac : null;
        const team = src ? src.team : srcN === 0 ? peer.team : 'red';
        if (team === ac.team) return;                           // same side
        // a cannon reaches a couple of kilometres: not from where we see that shooter flying, then it isn't a hit
        if (kind === 'gun' && src && !srcRec.stale && !srcRec.dead && src.pos.distanceToSquared(ac.pos) > GUN_REACH * GUN_REACH) return;
        ent.hitBy = eid(peer.id, srcN); ent.hitT = this.game.time;
        ac.damage(Math.min(amount, 5000), src, kind);
    }

    // ═════════════ Messages from the relay ═════════════
    onMessage(m) {
        if (!m || typeof m !== 'object') return;
        switch (m.t) {
            case 's': return this.onState(m.s);
            case 'e': return this.onEvent(m.f, m.e);
            case 'join': return this.onJoin(m.p);
            case 'leave': return this.onLeave(m.id, m.host);
            case 'set': return this.onSet(m.set);
        }
    }

    // p: [id, callsign, side, aircraft type, livery] as the relay lists a room member
    addPeer(p) {
        const id = Array.isArray(p) ? int(p[0], 1, 1e6) : -1;
        if (id < 0 || id === this.me.id || this.peers.has(id) || this.peers.size >= MAX_PLAYERS * 2) return null;
        const peer = {
            id, name: cleanCallsign(p[1]) || 'PILOT', team: p[2] === 'red' ? 'red' : 'blue',
            ac: own(AIRCRAFT, p[3]) ? p[3] : 'f16', lv: own(LIVERIES, p[4]) ? p[4] : 'default',
            clock: new ClockSync(), ents: new Map(), desc: new Map(), ended: new Map(), ghosts: new Map(),
            launches: {}, builds: {}, heard: 0, away: false, kills: 0, deaths: 0, ping: 0, late: 0, delay: INTERP_DELAY,
        };
        this.peers.set(id, peer);
        return peer;
    }

    onJoin(p) {
        const peer = this.addPeer(p);
        if (!peer) return;
        this.game.addFeed(peer.name + ' JOINED (' + peer.team.toUpperCase() + ')', teamCol(peer.team));
        this.greet(peer);
    }
    // what a newcomer needs from us that isn't in the snapshots: our score, the AI we fly, whether we're away
    greet(peer) {
        this.sendStats(true, peer.id);
        for (const [a, e] of this.locals) if (e.n > 0 && !a.exploded) this.send(this.describe(a, e), peer.id);
        if (this.away) this.send(['away', 1], peer.id);
    }

    onLeave(id, host) {
        const peer = this.peers.get(id), g = this.game;
        const wasHost = this.room.host === id;
        if (int(host, 1, 1e6) > 0) this.room.host = host;
        if (peer) {
            // the host's AI bandits pass to the new host: ours now, if that's us
            if (wasHost && this.isHost) this.inherit(peer);
            this.removePeer(peer);
            g.addFeed(peer.name + ' LEFT', DIM);
        }
        if (wasHost && this.isHost) g.addFeed('YOU ARE THE HOST NOW — N: AI BANDITS ON / OFF', AMBER);
    }

    removePeer(peer) {
        for (const rec of [...peer.ents.values()]) this.removePuppet(rec);
        for (const gh of [...peer.ghosts.values()]) this.removeGhost(gh, false);
        this.peers.delete(peer.id);
    }

    onSet(set) {
        if (!set || typeof set !== 'object') return;
        const was = this.room.set.ai;
        this.room.set.ai = !!set.ai;
        if (was !== this.room.set.ai) {
            this.game.addFeed(this.room.set.ai ? 'AI BANDITS ON — HOSTILES INBOUND' : 'AI BANDITS OFF', AMBER);
            if (this.isHost) { this.waveT = 2; if (!this.room.set.ai) this.clearBandits(); }
        }
    }

    // An event from `from` (the relay stamps the sender: a peer can only speak as itself). Everything in it is the
    // peer's own word: each handler checks the ids, ranges and ownership it relies on, and none does more work or
    // keeps more memory when a message is repeated.
    onEvent(from, e) {
        const peer = this.peers.get(from);
        if (!peer || !Array.isArray(e) || e.length > 24) return;
        for (let i = 1; i < e.length; i++) if (typeof e[i] !== 'string' && !(typeof e[i] === 'number' && isFinite(e[i]))) return;
        switch (e[0]) {
            case 'hit': return this.onHit(peer, e);
            case 'die': return this.onDie(peer, e);
            case 'boom': return this.onBoom(peer, e);
            case 'gone': return this.onGone(peer, e);
            case 'part': return this.onPart(peer, e);
            case 'fl': return this.onFlares(peer, e);
            case 'ml': return this.onLaunch(peer, e);
            case 'mx': return this.onMissileEnd(peer, e);
            case 'ai': return this.onDescribe(peer, e);
            // (its own score as it counts it: shown on the board, never added to ours)
            case 'st': peer.kills = Math.max(0, int(e[1], 0, 9999)); peer.deaths = Math.max(0, int(e[2], 0, 9999)); peer.ping = Math.max(0, int(e[3], 0, 9999)); return;
            case 'away': peer.away = e[1] === 1; return;
        }
    }

    // that airframe of its is over (peer.ended: at most one entry per entity number, so it can't grow)
    endLife(peer, n, life) { if ((peer.ended.get(n) ?? -1) < life) peer.ended.set(n, life); }

    onGone(peer, e) {
        const n = int(e[1], 0, NMAX - 1), life = int(e[2], 0, MAX_LIFE);
        if (n < 0 || life < 0) return;
        const rec = peer.ents.get(n);
        if (rec && rec.life > life) return; // (an airframe it has already replaced)
        this.endLife(peer, n, life);
        if (rec) this.removePuppet(rec);
    }

    // the AI aircraft a host flies: only the room's host has any
    onDescribe(peer, e) {
        const n = int(e[1], 1, NMAX - 1);
        if (n < 0 || peer.id !== this.room.host || (peer.desc.size >= 200 && !peer.desc.has(n))) return;
        peer.desc.set(n, {
            type: own(AIRCRAFT, e[2]) ? e[2] : 'f16', team: e[3] === 0 ? 'blue' : 'red', name: typeof e[4] === 'string' ? safeStr(e[4], 20) : '',
            maxHealth: clamp(typeof e[5] === 'number' ? e[5] : 100, 1, 5000), skill: clamp((typeof e[6] === 'number' ? e[6] : 60) / 100, 0.1, 1), ace: e[7] === 1,
        });
    }

    // ── snapshots ──
    onState(list) {
        if (!Array.isArray(list)) return;
        const now = this.now();
        for (let i = 0; i < list.length && i < MAX_PLAYERS * 2; i++) {
            const s = list[i];
            if (!Array.isArray(s)) continue;
            const peer = this.peers.get(s[0]); // (ours comes back too: the relay sends the room one message)
            const c = typeof s[1] === 'number' ? s[1] / 1000 : NaN;
            if (!peer || !(c >= 0 && c < 1e10)) continue;
            // how much later than the quickest delivery this one came: the worst of late (fading) sets how far back we draw
            const late = now - peer.clock.update(c, now) - c;
            peer.late = Math.max(peer.late * 0.96, Math.min(Math.max(late, 0), 0.5)); // (halves in under a second)
            peer.heard = now;
            const rows = s[2], ms = s[3];
            if (Array.isArray(rows)) for (let k = 0; k < rows.length && k < MAX_ENTITIES; k++) this.onEntity(peer, c, rows[k], now);
            if (Array.isArray(ms)) for (let k = 0; k < ms.length && k < MAX_MISSILES; k++) this.onMissile(peer, c, ms[k], now);
        }
    }

    onEntity(peer, c, row, now) {
        const d = decodeEntity(row, _D);
        if (!d) return;
        if (d.n > 0 && peer.id !== this.room.host) return;   // only the host flies anything but its own jet
        if ((peer.ended.get(d.n) ?? -1) >= d.life) return;   // (still in the post when that airframe went)
        let rec = peer.ents.get(d.n);
        if (rec && rec.life !== d.life) {
            if (d.life < rec.life) return;
            // a new airframe under that number: at most one a second (a real one takes RESPAWN_DELAY)
            if (now - rec.born < 1) return;
            this.endLife(peer, d.n, rec.life);
            this.removePuppet(rec); rec = null;
        }
        if (!rec) {
            if (!(d.flags & FLAG.ALIVE)) return;
            rec = this.makePuppet(peer, d.n, d.life, d, now);
            if (!rec) return;
        }
        rec.buf.push(c, d);
        rec.heard = now;
    }

    // every puppet is built here: so many in all, so many for one peer, and no faster than a peer could really need
    // them (building an aircraft costs a few milliseconds: a peer changing its airframe number in every message
    // would otherwise stall us)
    makePuppet(peer, n, life, d, now = this.now()) {
        const g = this.game;
        const desc = n === 0 ? { type: peer.ac, team: peer.team, name: peer.name, lv: peer.lv, human: true } : peer.desc.get(n);
        if (!desc) return null; // (an AI whose description hasn't arrived yet)
        let count = 0;
        for (const p of this.peers.values()) count += p.ents.size;
        if (count >= MAX_PUPPETS || peer.ents.size >= PEER_PUPPETS || !allow(peer.builds, now, 2, 12)) return null;
        const type = own(AIRCRAFT, desc.type) ? desc.type : 'f16';
        const ac = new Aircraft(g, type, { team: desc.team, name: desc.name || null });
        if (desc.lv && desc.lv !== 'default' && own(LIVERIES, desc.lv)) { try { applyLivery(ac.model, desc.lv, type); } catch (e) { /* stock paint */ } }
        if (desc.maxHealth) ac.maxHealth = ac.health = desc.maxHealth;
        if (desc.ace) ac.isAce = true;
        const rec = new Puppet(this, peer, n, life, !!desc.human);
        rec.ac = ac; rec.name = this.nameOf(ac);
        ac.puppet = rec;
        ac.pos.set(d.px, d.py, d.pz); ac.quat.set(d.qx, d.qy, d.qz, d.qw); ac.qv.copy(ac.quat); ac.vel.set(d.vx, d.vy, d.vz);
        ac.gear = !!(d.flags & FLAG.GEAR); ac.gearAnim = ac.gear ? 1 : 0; ac.onGround = !!(d.flags & FLAG.GROUND);
        ac.throttle = ac.controls.throttle = d.thr;
        g.aircraft.push(ac);
        peer.ents.set(n, rec);
        return rec;
    }

    removePuppet(rec) {
        const g = this.game, ac = rec.ac;
        rec.peer.ents.delete(rec.n);
        if (!ac) return;
        ac.alive = false; ac.removed = true;
        for (const m of ac.incoming) if (m.ghost) m.target = null;
        ac.incoming.length = 0;
        if (g.lockTarget === ac) { g.lockTarget = null; g.lockProgress = 0; }
        const i = g.aircraft.indexOf(ac);
        if (i >= 0) { g.aircraft.splice(i, 1); ac.remove(); }
        rec.ac = null;
    }

    // Aircraft.update for a puppet: where its owner's snapshots put it now (the peer's delay in the past)
    placePuppet(rec, ac, dt) {
        const now = this.frameNow(), off = rec.peer.clock.offset ?? 0;
        const mode = rec.buf.sample(now - off - rec.peer.delay, _S);
        if (mode === MODE.NONE) return;
        // snapshots are back after it coasted: ease out the step between where we drew it and where it really was
        const corr = rec.corr;
        if (mode === MODE.INTERP && rec.mode >= MODE.EXTRAP) {
            corr.set(rec.shown.x - _S.px, rec.shown.y - _S.py, rec.shown.z - _S.pz);
            if (corr.lengthSq() > 150 * 150) corr.set(0, 0, 0);
        }
        rec.mode = mode;
        if (corr.x || corr.y || corr.z) { corr.multiplyScalar(Math.exp(-dt / 0.15)); if (corr.lengthSq() < 1e-4) corr.set(0, 0, 0); }
        ac.pos.set(_S.px + corr.x, _S.py + corr.y, _S.pz + corr.z);
        rec.shown.copy(ac.pos);
        ac.quat.set(_S.qx, _S.qy, _S.qz, _S.qw);
        ac.qv.copy(ac.quat);
        ac.vel.set(_S.vx, _S.vy, _S.vz);
        const sp = ac.vel.length(), f = _S.flags;
        ac.speed = sp;
        ac.mach = sp / soundSpeed(ac.pos.y);
        if (!ac.fixedGear) ac.gear = !!(f & FLAG.GEAR);
        ac.onGround = !!(f & FLAG.GROUND);
        ac.airbrake = !!(f & FLAG.BRAKE);
        ac.flaps = f & FLAG.FLAP2 ? 2 : f & FLAG.FLAP1 ? 1 : 0;
        if (ac.hookMesh) ac.hook = !!(f & FLAG.HOOK);
        ac.bellied = !!(f & FLAG.BELLY);
        ac.falling = !!(f & FLAG.FALLING) && !rec.stale;
        ac.throttle = ac.controls.throttle = _S.thr;
        ac.afterburner = !!(f & FLAG.AB);
        ac.gLoad = _S.g;
        // the angle of attack, from the nose and the flight path (vapour off the wingtips in a hard turn)
        ac.alpha = sp > 40 ? Math.acos(clamp(_v.copy(FWD).applyQuaternion(ac.quat).dot(ac.vel) / sp, -1, 1)) : 0;
        if (!rec.dead) ac.health = Math.min(_S.hp, ac.maxHealth);
        rec.safe = !!(f & FLAG.SAFE);
        // its cannon: tracers, muzzle flash and the sound of it; the rounds do nothing (weapons.js)
        if ((f & FLAG.FIRE) && ac.alive && ac.spec.gun) this.puppetGun(rec, ac, now);
    }

    puppetGun(rec, ac, now) {
        const g = this.game;
        ac.ammo = 999;
        if (!g.weapons.fireGun(ac, g.time) || now - rec.gunSnd < 0.085 || !g.audio || !g.audio.gunfire) return;
        rec.gunSnd = now;
        const cam = g.camera, d = cam.position.distanceTo(ac.pos);
        if (d > 3500) return;
        const pan = cam.matrixWorld ? _v.subVectors(ac.pos, cam.position).normalize().dot(_v2.setFromMatrixColumn(cam.matrixWorld, 0)) : 0;
        g.audio.gunfire('deagle', d, pan);
    }

    // every frame: which puppets are really there (snapshots stopped for a while, or the owner's tab is hidden:
    // not drawn, can't be hit or locked, until they're back)
    updatePuppets(now, dt = 0) {
        for (const peer of this.peers.values()) {
            // How far in the past this peer's aircraft are drawn: INTERP_DELAY when its snapshots arrive evenly; more (up
            // to MAX_DELAY) when they come late or in bunches, so there is still one either side of the moment drawn
            // (a snapshot every SEND_GAP at worst, plus the lateness seen lately). Changed slowly: the puppets must not lurch.
            const want = clamp(SEND_GAP + peer.late, INTERP_DELAY, MAX_DELAY);
            peer.delay += clamp(want - peer.delay, -0.05 * dt, 0.1 * dt);
            for (const rec of peer.ents.values()) {
                const ac = rec.ac;
                if (!ac) continue;
                if (ac.exploded) { peer.ents.delete(rec.n); this.endLife(peer, rec.n, rec.life); continue; }
                // an AI aircraft its host stopped reporting long ago (without a word): gone, its place freed
                // (if it does come back, it is built again)
                if (rec.n > 0 && now - rec.heard > STALE_AFTER * 4) { this.removePuppet(rec); continue; }
                const stale = peer.away || now - rec.heard > STALE_AFTER;
                if (stale !== rec.stale) {
                    rec.stale = stale;
                    ac.root.visible = !stale;
                    if (stale) { for (const m of ac.incoming) if (m.ghost) m.target = null; ac.falling = false; }
                }
                ac.alive = !rec.dead && !stale;
                const tag = rec.safe && ac.alive ? rec.name + ' · SAFE' : rec.name;
                if (ac.callsign !== tag) ac.callsign = tag;
            }
        }
    }

    // e: ['die', its entity's number, that airframe, the killer's id (0: nobody), kind]. A peer can only report the
    // death of an aircraft of its own that we have a living picture of, once: nothing reaches the kill feed or the
    // score for an airframe we never saw, one that has already died or ended, or the same death told again.
    onDie(peer, e) {
        const g = this.game, n = int(e[1], 0, NMAX - 1), life = int(e[2], 0, MAX_LIFE), kind = KINDS[int(e[4], 0, KINDS.length - 1)] || 'gun';
        if (n < 0 || life < 0) return;
        const rec = peer.ents.get(n);
        if (!rec || !rec.ac || rec.life !== life || rec.dead || (peer.ended.get(n) ?? -1) >= life) return;
        rec.dead = true;
        // who did it: someone in the room now (us: only an aircraft of ours that did claim a hit on it); anyone else is "unknown"
        let killer = typeof e[3] === 'number' && e[3] > 0 ? this.who(e[3]) : null;
        const named = typeof e[3] === 'number' && e[3] > 0;
        if (killer && killer.mine && !(this.now() - rec.hitT < 30)) killer = null;
        this.record({ name: rec.name, team: rec.ac.team, mine: false, player: n === 0 }, killer, kind, named && !killer);
        const ac = rec.ac;
        ac.alive = false; ac.health = 0;
        for (const m of ac.incoming) if (m.ghost) m.target = null;
        g.effects.explosion(ac.pos, 0.7, ac.vel);
        g.events.emit('killed', ac, { source: killer ? killer.ac : null, kind });
    }

    onBoom(peer, e) {
        const n = int(e[1], 0, NMAX - 1), life = int(e[2], 0, MAX_LIFE);
        if (n < 0 || life < 0) return;
        const rec = peer.ents.get(n);
        if (!rec || !rec.ac || rec.life !== life) return; // (not the airframe we have: nothing to blow up, nothing to remember)
        this.endLife(peer, n, life);
        const ac = rec.ac;
        peer.ents.delete(n);
        if (rec.stale) { this.removePuppet(rec); return; }
        // where it really went in (we draw it a moment behind)
        if (typeof e[5] === 'number' && typeof e[6] === 'number' && typeof e[7] === 'number' && _v.set(e[5], e[6], e[7]).distanceToSquared(ac.pos) < 3000 * 3000) ac.pos.copy(_v);
        rec.dead = true;
        ac.root.visible = true;
        ac.explode(e[3] === 1, e[4] === 1);
    }

    onPart(peer, e) {
        const rec = peer.ents.get(int(e[1], 0, NMAX - 1)), region = REGION_CODES[int(e[3], 0, REGION_CODES.length - 1)], g = this.game;
        // (a wing: the only part the game shears off a flying jet)
        if (!rec || !rec.ac || rec.life !== e[2] || (region !== 'wingL' && region !== 'wingR') || !rec.ac.regions[region] || rec.ac.lostRegions.has(region)) return;
        const ac = rec.ac;
        g.effects.explosion(ac.regions[region].getWorldPosition(_v), 0.5, ac.vel);
        g.wreckage.detach(ac, region, 1);
    }

    onFlares(peer, e) {
        const rec = peer.ents.get(int(e[1], 0, NMAX - 1)), g = this.game, now = this.now();
        // (a dispenser fires a salvo every 0.35 s at most: more often than that is ignored)
        if (!rec || !rec.ac || !rec.ac.alive || now - rec.flareT < 0.25) return;
        rec.flareT = now;
        // dropped for real by its puppet here: our own missiles' seekers can be pulled off by them
        rec.ac.flares = 9; rec.ac.lastFlare = -10;
        g.weapons.dropFlares(rec.ac, g.time);
    }

    // ═════════════ Missiles ═════════════
    // one of ours left the rail: the others draw a ghost of it from this and from its position in our snapshots
    localLaunch(ac, m, target) {
        const e = this.locals.get(ac);
        if (!e || m.kind === 'rkt' || !m.W || m.W.unguided || !MISSILE_KINDS.includes(m.kind)) return;
        const id = this.nextMissile = this.nextMissile % 60000 + 1;
        this.myMissiles.set(m, { id, target: target || null });
        const p = m.pos, v = m.vel;
        this.send(['ml', id, e.n, safeStr(m.W.id || '', 16), m.kind, this.idOf(target), Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10,
            Math.round(v.x), Math.round(v.y), Math.round(v.z), Math.round(this.frameNow() * 1000)]);
    }

    // ours that are gone (weapons.js took them out of the scene: hit, decoyed and spent, into the ground): tell the room
    trackMissiles() {
        if (!this.myMissiles.size) return;
        const live = this.game.weapons.missiles;
        for (const [m, r] of this.myMissiles) {
            if (live.includes(m)) continue;
            this.myMissiles.delete(m);
            this.send(['mx', r.id, Math.round(m.pos.x * 10) / 10, Math.round(m.pos.y * 10) / 10, Math.round(m.pos.z * 10) / 10]);
        }
    }

    onLaunch(peer, e) {
        const id = int(e[1], 1, MAX_MISSILE_ID), n = int(e[2], 0, NMAX - 1), kind = MISSILE_KINDS.includes(e[4]) ? e[4] : 'aam';
        if (id < 0 || n < 0 || (n > 0 && peer.id !== this.room.host)) return; // (only the host flies anything but its own jet)
        // a jet fires one every 0.6 s at most, the host's bandits a few between them: more than that is noise
        if (!allow(peer.launches, this.now(), 3, 8)) return;
        const W = (own(STORES, e[3]) && STORES[e[3]]) || WEAPONS[kind === 'aam' ? 'missile' : kind] || WEAPONS.missile;
        const owner = peer.ents.get(n), target = this.who(e[5]);
        const gh = this.makeGhost(peer, id, W, kind, owner ? owner.ac : null, target && target.ac, e[6], e[7], e[8], e[9], e[10], e[11], typeof e[12] === 'number' ? e[12] / 1000 : -1);
        if (!gh) return;
        // the launch as the game knows it: its sound, the warning for whoever it's meant for
        this.game.events.emit('missileLaunch', gh.owner, { missile: gh, target: gh.target });
    }

    // every ghost is made here, so the limits hold whichever message asked for it: one per (peer, id), a few per
    // peer, so many in all; a position off the map or a speed no missile has is refused
    makeGhost(peer, id, W, kind, owner, target, x, y, z, vx, vy, vz, c) {
        const g = this.game;
        if (int(id, 1, MAX_MISSILE_ID) < 0 || peer.ghosts.has(id) || peer.ghosts.size >= PEER_GHOSTS || this.ghosts.size >= MAX_GHOSTS) return null;
        for (const v of [x, y, z, vx, vy, vz]) if (typeof v !== 'number' || !isFinite(v)) return null;
        if (Math.abs(x) > 250000 || Math.abs(z) > 250000 || y < -1000 || y > 90000 || Math.hypot(vx, vy, vz) > 7000) return null;
        let mesh;
        if (W.id) mesh = storeMesh(W);
        else {
            if (!ghostGeo) { ghostGeo = new THREE.CylinderGeometry(0.1, 0.1, 3, 8); ghostGeo.rotateX(Math.PI / 2); ghostMat = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.45, metalness: 0.3 }); }
            mesh = new THREE.Mesh(ghostGeo, ghostMat);
        }
        mesh.position.set(x, y, z);
        mesh.visible = false; // (until the others' picture of the launcher, a moment behind, gets there)
        g.scene.add(mesh);
        const gh = {
            ghost: true, id, peer, W, kind, mesh, pos: mesh.position, vel: new THREE.Vector3(vx, vy, vz),
            owner: owner || { pos: mesh.position, team: peer.team, callsign: peer.name }, team: peer.team, target: target || null,
            tracking: !!target, buf: new InterpBuffer(8), age: 0, heard: this.now(), lost: false, alive: true,
            trail: g.effects.addTrail({ max: 220, width: 1.1, life: 5.5, color: [0.92, 0.92, 0.9], alpha: 0.5, minDist: 10, widthGrow: 2.2 }),
        };
        if (c >= 0) gh.buf.push(c, { px: x, py: y, pz: z, vx, vy, vz });
        // it's after one of ours: the usual warning (HUD, tone, the AI's evasion) reads the target's `incoming`
        if (target && this.locals.has(target)) target.incoming.push(gh);
        this.ghosts.add(gh);
        peer.ghosts.set(id, gh);
        return gh;
    }

    onMissile(peer, c, row, now) {
        const d = decodeMissile(row, _M);
        if (!d) return;
        let gh = peer.ghosts.get(d.id); // (a peer's ids name its own missiles only)
        // one we never saw launched (we joined while it flew): a plain missile
        if (!gh) { gh = this.makeGhost(peer, d.id, WEAPONS.missile, 'aam', null, null, d.px, d.py, d.pz, d.vx, d.vy, d.vz, c); if (!gh) return; gh.age = 1; }
        gh.buf.push(c, d);
        gh.heard = now;
        if (gh.tracking && !d.tracking) {
            // decoyed, notched or out of sight: it isn't coming for its target any more
            gh.tracking = false;
            const t = gh.target, g = this.game;
            if (t && t.incoming) { const i = t.incoming.indexOf(gh); if (i >= 0) t.incoming.splice(i, 1); }
            if (t && t === g.player) g.events.emit('decoyed', gh.owner, { missile: gh, victim: t });
        }
    }

    onMissileEnd(peer, e) {
        const gh = peer.ghosts.get(int(e[1], 1, MAX_MISSILE_ID));
        if (!gh || gh.peer !== peer) return;
        if (typeof e[2] === 'number' && typeof e[3] === 'number' && typeof e[4] === 'number' && _v.set(e[2], e[3], e[4]).distanceToSquared(gh.pos) < 4000 * 4000) gh.pos.copy(_v);
        this.removeGhost(gh, true);
    }

    removeGhost(gh, bang) {
        const g = this.game;
        this.ghosts.delete(gh);
        if (gh.peer.ghosts.get(gh.id) === gh) gh.peer.ghosts.delete(gh.id);
        gh.alive = false;
        if (gh.target && gh.target.incoming) { const i = gh.target.incoming.indexOf(gh); if (i >= 0) gh.target.incoming.splice(i, 1); }
        if (gh.trail) gh.trail.emitting = false;
        g.scene.remove(gh.mesh);
        if (bang && gh.mesh.visible) {
            g.effects.explosion(gh.pos, gh.W.boom || 0.8, gh.vel);
            if (g.audio && g.audio.boom) g.audio.boom(g.camera.position.distanceTo(gh.pos), 0.6);
        }
    }

    updateGhosts(dt, now) {
        if (!this.ghosts.size) return;
        const fx = this.game.effects;
        for (const gh of this.ghosts) {
            if (now - gh.heard > 2) { this.removeGhost(gh, false); continue; } // its owner stopped reporting it
            const T = this.frameNow() - (gh.peer.clock.offset ?? 0) - gh.peer.delay;
            const first = gh.buf.count ? gh.buf.at(gh.buf.count - 1) : null;
            if (!first || T < first.t) continue; // not launched yet in the picture we draw
            if (!gh.buf.sample(T, _S)) continue;
            gh.mesh.visible = true;
            gh.pos.set(_S.px, _S.py, _S.pz);
            gh.vel.set(_S.vx, _S.vy, _S.vz);
            gh.age += dt;
            const sp = gh.vel.length(), W = gh.W;
            if (sp > 1) gh.mesh.quaternion.setFromUnitVectors(FWD, _v.copy(gh.vel).divideScalar(sp));
            // the motor: flame, smoke trail and its light at night, while it burns
            if (gh.age > 0.25 && gh.age < (W.boost || 3) + 0.25) {
                gh.trail.push(gh.pos, fx.now);
                fx.fire.emit(gh.pos, _v.copy(gh.vel).multiplyScalar(0.7), 0.06, 2.2, 0.8, [6, 4.5, 2.2], [3, 1, 0.2], 1, 0, 0, 0);
                if (Math.random() < 0.5) fx.smoke.emit(gh.pos, _v.copy(gh.vel).multiplyScalar(0.05), rand(1.5, 3), 1.8, 7, [0.85, 0.85, 0.85], [0.7, 0.7, 0.7], 0.35, 0, 1, 1);
                _v.copy(gh.pos); if (sp > 1) _v.addScaledVector(gh.vel, -2.2 / sp);
                fireLights.keep(gh, _v, 14000, { color: FIRE_COLORS.motor, core: 2.5, cloud: 1.6, glow: 1.2, flicker: 0.12, vel: gh.vel });
            } else gh.trail.emitting = false;
        }
    }

    // ═════════════ AI bandits (the host's) ═════════════
    toggleBandits() {
        const g = this.game;
        if (!this.link || !this.link.open) { g.addFeed('NOT CONNECTED', DIM); return; }
        if (!this.isHost) { const h = this.peers.get(this.room.host); g.addFeed('ONLY THE HOST' + (h ? ' (' + h.name + ')' : '') + ' CAN CALL IN AI BANDITS', DIM); return; }
        this.link.send({ t: 'set', ai: !this.room.set.ai });
    }

    // the dogfight mode's wave spawner, on the host only: the next wave a few seconds after the last bandit is down
    updateBandits(dt) {
        // (AI we still fly although we aren't the host: we were, lost the connection, and someone else is now)
        if (!this.isHost && this.link && this.link.open && this.locals.size > 1) this.clearBandits();
        if (!this.isHost || !this.room.set.ai) return;
        const g = this.game, p = g.player;
        let alive = 0;
        for (const [a, e] of this.locals) if (e.n > 0 && a.alive && !a.pilotDead) alive++;
        if (alive) { this.waveT = BANDIT_GAP; return; }
        this.waveT -= dt;
        if (this.waveT <= 0 && p && p.alive && g.nextWave) { this.waveT = BANDIT_GAP; g.nextWave(); }
    }
    clearBandits() {
        const g = this.game;
        for (const [a, e] of [...this.locals]) {
            if (e.n === 0) continue;
            this.send(['gone', e.n, e.life]);
            this.forget(a, e);
            const i = g.aircraft.indexOf(a);
            if (i >= 0) g.aircraft.splice(i, 1);
            a.alive = false; a.remove();
        }
    }

    // The host left and we're the host now: its AI bandits carry on as ours. Each puppet becomes a real aircraft with
    // an AI pilot, from where it is; syncLocals numbers and announces it as one of ours.
    inherit(peer) {
        const g = this.game;
        for (const rec of [...peer.ents.values()]) {
            const ac = rec.ac, d = peer.desc.get(rec.n);
            if (rec.n === 0 || !ac || rec.dead || rec.stale || ac.exploded || ac.falling || !this.room.set.ai) continue;
            peer.ents.delete(rec.n);
            ac.puppet = null; rec.ac = null;
            ac.alive = true;
            ac.callsign = d && d.name ? d.name : ac.spec.name;
            ac.qv.copy(ac.quat); ac.alpha = 0; ac.beta = 0; ac.rollRate = 0; ac.gLoad = 1;
            ac.onGround = false; ac.bellied = false; ac.falling = false;
            ac.controls.pitch = ac.controls.roll = ac.controls.yaw = 0; ac.controls.throttle = Math.max(ac.throttle, 0.7);
            ac.flares = ac.spec.flares; ac.ammo = ac.spec.gun ? ac.spec.gun.ammo : 0; ac.lastFlare = -10;
            ac.incoming.length = 0;
            new Pilot(g, ac, d ? d.skill : 0.6);
        }
        this.waveT = BANDIT_GAP;
    }

    // ═════════════ Away, and losing the connection ═════════════
    onVisibility(hidden) {
        if (!this.active) return;
        const now = this.now();
        if (hidden) { this.away = true; this.wasHidden = true; this.awaySince = now; this.flushClaims(); this.send(['away', 1]); }
        else if (this.away) { this.away = false; this.send(['away', 0]); }
    }

    // a hidden tab doesn't fly: if the jet was in the air while we were gone it's replaced (no loss counted)
    backFromAway(gap) {
        const g = this.game, p = g.player;
        if (this.away && typeof document !== 'undefined' && document.visibilityState === 'visible') { this.away = false; this.send(['away', 0]); }
        if (p && p.alive && !p.onGround && g.state === 'playing') {
            g.addFeed('YOU WERE AWAY ' + Math.round(gap) + ' s — NEW JET', AMBER);
            this.respawn('BACK IN THE FIGHT');
        }
    }

    onLinkClosed(info) {
        if (!this.active) return;
        const g = this.game, now = this.now();
        if (this.link) { this.link.onClose = null; this.link.close(); this.link = null; }
        for (const peer of [...this.peers.values()]) this.removePeer(peer);
        this.myMissiles.clear(); this.claims.clear();
        const msg = info && info.refused ? String(info.refused) : '';
        this.offline = { since: now, tries: 0, nextAt: now + 1.5, msg };
        g.showBanner('CONNECTION LOST', msg || 'Trying to get back into room ' + this.room.code + '…', 5, WARN);
        g.addFeed('CONNECTION LOST — RECONNECTING', WARN);
    }

    async reconnect() {
        const g = this.game, off = this.offline;
        if (!off || !this.hello || !this.url) return;
        this.connecting = true;
        const link = this.makeLink(this.url);
        try {
            // (the same room, in the world it had: if it emptied meanwhile we reopen it as it was)
            const w = await link.connect({ ...this.hello, name: this.me.name, time: this.room.set.time, weather: this.room.set.weather });
            if (!this.active || this.offline !== off) { link.close(); return; }
            this.attach(link, w, this.hello, this.url);
            this.offline = null;
            this.sentStat = '';
            g.addFeed('BACK IN ROOM ' + this.room.code + ' — ' + this.playerCount + ' PILOT' + (this.playerCount === 1 ? '' : 'S'), GREEN);
            for (const peer of this.peers.values()) this.greet(peer);
            for (const [a, e] of this.locals) if (e.n > 0 && !a.exploded) this.send(this.describe(a, e));
        } catch (err) {
            link.close();
            if (this.offline === off) {
                off.tries++;
                off.msg = String(err && err.message || '');
                off.nextAt = this.now() + Math.min(15, 2 * off.tries);
            }
        } finally { this.connecting = false; }
    }

    // ═════════════ A world that's the same for everyone ═════════════
    // What each client would otherwise run on its own dice is left out of multiplayer: the airliners and the airbase
    // helicopters (they can be flown into and shot down), and damage to the towns' buildings and to bridges (a block
    // standing for one pilot and rubble for another). Put back when the sortie ends.
    quietWorld(on) {
        const g = this.game, world = g.world || {};
        if (on && !this.quiet) {
            const q = this.quiet = { helis: null, traffic: null, bl: null, bridges: [], war: null };
            const ab = world.airbases;
            if (ab && ab.helis && ab.helis.length) {
                q.helis = ab.helis;
                for (const h of q.helis) { h.mesh.visible = false; unregisterAirTarget(h); }
                ab.helis = [];
            }
            const at = world.airTraffic;
            if (at && at.flights) {
                for (const f of at.flights) f.remove();
                at.flights.length = 0;
                q.traffic = at; q.trafficUpdate = at.update;
                at.update = () => {};
            }
            const bl = world.towns && world.towns.buildings;
            if (bl && bl.damage) { q.bl = bl; bl.damage = () => {}; bl.explode = () => {}; }
            for (const b of (world.towns && world.towns.bridges) || []) if (b.damage) { b.damage = () => {}; q.bridges.push(b); }
            // the war layer's intelligence chatter ("INTEL: IDENTIFIED: …" for every boat and truck seen) would push the
            // kill lines off the feed: not here (the tower's calls stay)
            const war = g.war;
            if (war && war.radio) { q.war = war; const radio = war.radio; war.radio = function (from, text, o) { return from === 'INTEL' ? undefined : radio.call(this, from, text, o); }; }
        } else if (!on && this.quiet) {
            const q = this.quiet;
            this.quiet = null;
            if (q.helis && world.airbases) { world.airbases.helis = q.helis; for (const h of q.helis) { h.mesh.visible = h.alive; registerAirTarget(h); } }
            if (q.traffic) {
                const at = q.traffic;
                delete at.update;
                if (at.update !== q.trafficUpdate) at.update = q.trafficUpdate;
                for (const ap of at.airports || []) { at.spawn(ap, 'arrival'); at.spawn(ap, 'departure'); } // as at boot
            }
            if (q.bl) { delete q.bl.damage; delete q.bl.explode; }
            for (const b of q.bridges) delete b.damage;
            if (q.war) delete q.war.radio;
        }
    }

    // ═════════════ HUD: the scoreboard (hold Tab), connection trouble ═════════════
    scoreRows() {
        const rows = [{ id: this.me.id, name: this.me.name, team: this.me.team, type: this.me.ac, kills: this.kills, deaths: this.deaths, ping: Math.round(this.link ? this.link.rtt : 0), me: true, away: this.away }];
        for (const p of this.peers.values()) rows.push({ id: p.id, name: p.name, team: p.team, type: p.ac, kills: p.kills, deaths: p.deaths, ping: p.ping, away: p.away });
        for (const r of rows) r.host = r.id === this.room.host;
        return rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
    }

    drawHud(ctx, hud) {
        if (!this.active) return;
        const g = this.game, W = hud.w, H = hud.h, now = this.now();
        const mono = (w, px) => (ctx.font = w + ' ' + px + 'px "Share Tech Mono", ui-monospace, monospace');
        ctx.textBaseline = 'middle';
        const p = g.player, e = p && this.locals.get(p);
        if (e && e.safeUntil > now && p.alive) {
            mono('700', 13); ctx.textAlign = 'center'; ctx.fillStyle = GREEN;
            ctx.fillText('SPAWN PROTECTION ' + Math.ceil(e.safeUntil - now), W / 2, H * 0.27);
        }
        if (this.offline) {
            mono('700', 14); ctx.textAlign = 'center'; ctx.fillStyle = WARN;
            ctx.fillText(isFinite(this.offline.nextAt) ? 'CONNECTION LOST — RECONNECTING' + (this.offline.tries ? ' (TRY ' + (this.offline.tries + 1) + ')' : '') : 'NOT CONNECTED — FLYING ALONE', W / 2, H * 0.2);
            if (this.offline.msg) { mono('600', 11); ctx.fillStyle = DIM; ctx.fillText(this.offline.msg.toUpperCase().slice(0, 110), W / 2, H * 0.2 + 18, W * 0.9); }
        }
        if (!g.input || !g.input.down('Tab')) return;
        const rows = this.scoreRows(), rh = 22, w = Math.min(560, W - 24), x = (W - w) / 2, h = 74 + rows.length * rh, y = Math.max(10, (H - h) / 2);
        ctx.fillStyle = 'rgba(6,12,18,0.92)'; ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(93,255,160,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.textAlign = 'left'; mono('700', 15); ctx.fillStyle = GREEN;
        ctx.fillText('ROOM ' + this.room.code, x + 14, y + 18);
        mono('600', 11); ctx.fillStyle = DIM; ctx.textAlign = 'right';
        ctx.fillText(String(this.room.set.time).toUpperCase() + ' · ' + String(this.room.set.weather).toUpperCase() + ' · AI BANDITS ' + (this.room.set.ai ? 'ON' : 'OFF') + (this.isHost ? ' (N)' : ''), x + w - 14, y + 18);
        const cols = [x + 14, x + w * 0.4, x + w * 0.74, x + w * 0.83, x + w - 14];
        ctx.textAlign = 'left'; ctx.fillText('PILOT', cols[0], y + 44); ctx.fillText('AIRCRAFT', cols[1], y + 44);
        ctx.textAlign = 'right'; ctx.fillText('KILLS', cols[2], y + 44); ctx.fillText('LOSSES', cols[3] + 22, y + 44); ctx.fillText('PING', cols[4], y + 44);
        let yy = y + 66;
        for (const r of rows) {
            if (r.me) { ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x + 4, yy - rh / 2, w - 8, rh); }
            mono(r.me ? '700' : '600', 13);
            ctx.fillStyle = teamCol(r.team); ctx.textAlign = 'left';
            ctx.fillText((r.host ? '★ ' : '') + r.name + (r.away ? '  (AWAY)' : ''), cols[0], yy, w * 0.38 - 20);
            ctx.fillStyle = DIM; mono('600', 12);
            ctx.fillText(((AIRCRAFT[r.type] || {}).name || '').toUpperCase(), cols[1], yy, w * 0.27);
            ctx.fillStyle = '#e8f0f4'; ctx.textAlign = 'right'; mono('700', 13);
            ctx.fillText(String(r.kills), cols[2], yy); ctx.fillText(String(r.deaths), cols[3] + 22, yy);
            ctx.fillStyle = r.ping > 180 ? AMBER : DIM; mono('600', 12);
            ctx.fillText(r.me && !this.link ? '—' : r.ping + ' ms', cols[4], yy);
            yy += rh;
        }
    }
}

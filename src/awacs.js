// ═══════════════════════════════════════════════════════════════
// The AWACS controller (air support, airsupport.js): our E-3's radar and its voice ("MAGIC").
//  • the radar sweeps with the rotodome (6 rpm: one look at each track every 10 s). A target is held if it's inside
//    the radar's reach for its size (stealth types far less), above the radar horizon from the E-3's altitude, not
//    behind terrain, not hidden by jamming (war.jamFactor) — and not in the pulse-Doppler clutter notch: low over
//    the ground and beaming the AWACS (almost no closing speed) it drops out. What it holds goes into the war
//    layer as air CONTACTs (war.reveal … 'awacs') and into the track file; enemy cruise missiles it sees become
//    visible (and lockable)
//  • groups (brevity.js): contacts within 3 NM are one group; groups are tracked from one look to the next
//  • calls, paced through the director's radio (director.say) when a war runs: THREAT (a hostile group closing
//    inside ~15 NM of the player), MERGED, POPUP (a new group appearing close), FADED, NEW GROUP, a PICTURE now and
//    then, cruise missiles inbound; and the answers to BOGEY DOPE, PICTURE and DECLARE (the command menu)
//  • no AWACS on station (shot down, driven off): none of this — the picture falls back to the ground radars
// ═══════════════════════════════════════════════════════════════
import { INTEL } from './war.js';
import { terrainHeight } from './world.js';
import { AIR_TARGETS } from './softtargets.js';
import * as BR from './brevity.js';

export const AWACS_RANGE = 320000;                     // a 5 m² fighter at medium altitude (E-3G)
export const STEALTH = { f22: 0.12, f35: 0.15, f35n: 0.15, b2: 0.1, su57: 0.3, j20: 0.3 }; // range factors
const MISSILE_RCS = 0.35;
const SWEEP = 2 * Math.PI * 6 / 60;                    // rad/s
const HELD = 14;                                       // s a track stays held without a new look
const THREAT_R = 28000, MERGE_R = 3500, POPUP_R = 36000;

// can the AWACS at `from` see a target at `pos` moving at `vel` (type for its size)? side: the AWACS's team
export function awacsSees(war, side, from, pos, vel, type, missile = false) {
    const d = Math.hypot(pos.x - from.x, pos.y - from.y, pos.z - from.z);
    const g0 = Math.max(terrainHeight(pos.x, pos.z), 0);
    const agl = pos.y - g0;
    let R = AWACS_RANGE * (missile ? MISSILE_RCS : STEALTH[type] ?? 1);
    if (agl < 300) R *= 0.65; // ground clutter
    if (war && war.jamFactor) R *= war.jamFactor(side, from, pos);
    if (d > R) return false;
    const h1 = Math.max(from.y - Math.max(terrainHeight(from.x, from.z), 0), 0) + 10;
    if (d > 4120 * (Math.sqrt(h1) + Math.sqrt(Math.max(agl, 0)))) return false;
    // the Doppler notch: low, in the clutter, and beaming
    if (agl < 1500 && vel) {
        const vr = ((pos.x - from.x) * vel.x + (pos.y - from.y) * vel.y + (pos.z - from.z) * vel.z) / Math.max(d, 1);
        if (Math.abs(vr) < 25) return false;
    }
    return war ? war.radarLOS(from, pos) : true;
}

export class AwacsController {
    constructor(air) {
        this.air = air; this.game = air.game;
        this.bull = { x: 0, z: -12000 };
        this.reset();
    }

    reset() {
        this.held = new Map();      // target → war time of its last look
        this.groups = [];           // tracked groups
        this.nextId = 1;
        this.az = 0;
        this.groupT = 3;
        this.pictureT = 40;         // the check-in picture
        this.lastPicture = -1e9;
        this.lost = false;
        this.missileCalls = new Set();
    }

    // our AWACS, on station (not running from a threat); null when there's none
    get flight() { return this.air.awacs(this.game.war.side, true); }
    get call() { const f = this.flight; return f ? f.callsign : 'MAGIC'; }
    get player() { const g = this.game, p = g.player; return p && p.alive && !g.pilotMode && !p.onGround ? p : null; }
    get pc() { return (this.game.callsign || 'VIPER') + ' 1'; }

    update(dt) {
        const g = this.game, war = g.war;
        const f = this.flight;
        if (!f) return;
        this.sweep(dt, f);
        this.groupT -= dt;
        if (this.groupT <= 0) {
            this.groupT = 2;
            this.updateGroups();
            if (this.air.callsOn) this.calls();
        }
        void war;
    }

    // ── the radar: the rotodome's beam sweeps round; what it passes is looked at ──
    sweep(dt, f) {
        const g = this.game, war = g.war, side = f.team, from = f.ac.pos;
        this.a0 = this.az;
        this.a1 = this.a0 + SWEEP * dt;
        this.az = this.a1 % (Math.PI * 2);
        for (const a of g.aircraft) {
            if (!a.alive || a.team === side || a.onGround || a.abandoned) continue;
            if (!this.inBeam(from, a.pos)) continue;
            if (awacsSees(war, side, from, a.pos, a.vel, a.type)) {
                this.held.set(a, war.time);
                if (side === war.side) war.reveal(a, INTEL.CONTACT, 'awacs', true);
            }
        }
        const st = g.strikes;
        if (st && st.missiles) for (const m of st.missiles) {
            if (!m.alive || m.team === side || m.kind === 'rocket') continue;
            if (!this.inBeam(from, m.pos)) continue;
            if (awacsSees(war, side, from, m.pos, m.vel, null, true)) { m.detected = true; m.awacsT = war.time; }
        }
    }

    // is the bearing from the AWACS to p inside the arc the beam swept this frame?
    inBeam(from, p) {
        let b = Math.atan2(p.x - from.x, -(p.z - from.z));
        if (b < 0) b += Math.PI * 2;
        const a0 = this.a0, a1 = this.a1;
        return a1 > Math.PI * 2 ? b >= a0 || b < a1 - Math.PI * 2 : b >= a0 && b < a1;
    }

    holds(a) { const t = this.held.get(a); return t != null && this.game.war.time - t < HELD; }

    // ── groups ──
    contacts() {
        const g = this.game, war = g.war, side = war.side, out = [], mis = [];
        for (const a of g.aircraft) {
            if (!a.alive || a.team === side || a.team === 'neutral' || a.onGround || a.abandoned) continue;
            const rec = war.rec(a);
            if (!rec || rec.known < INTEL.CONTACT || war.time - rec.lastSeen > HELD) continue;
            out.push({ pos: rec.lastPos, vel: a.vel, n: 1, unit: a, known: rec.known, type: a.type, origin: rec.origin || (rec.origin = war.sideAt(rec.lastPos.x, rec.lastPos.z)) });
        }
        const d = g.director;
        if (d && d.enabled) for (const f of d.flights) {
            if (f.done || f.members || f.team === side || !f.detected || f.n <= 0) continue;
            out.push({ pos: f.lastSeen || f.pos, vel: f.vel, n: f.n, flight: f, known: INTEL.CONTACT, origin: 'red', types: f.types, role: f.role });
        }
        const st = g.strikes;
        if (st && st.missiles) for (const m of st.missiles) {
            if (!m.alive || m.team === side || !m.detected || war.time - (m.awacsT ?? -1e9) > HELD) continue;
            mis.push({ pos: m.pos, vel: m.vel, n: 1, missile: m, known: INTEL.CONTACT, origin: 'red' });
        }
        return { air: out, missiles: mis };
    }

    updateGroups() {
        const g = this.game, war = g.war;
        const { air, missiles } = this.contacts();
        const fresh = [...BR.groupContacts(air), ...BR.groupContacts(missiles, 6 * BR.NM, 3000).map(q => ((q.missiles = true), q))];
        const now = war.time;
        const used = new Set();
        for (const q of fresh) {
            // same group as last time: the nearest old one within 12 km
            let best = null, bd = 12000;
            for (const o of this.groups) {
                if (used.has(o) || !!o.missiles !== !!q.missiles) continue;
                const dd = Math.hypot(o.pos.x - q.pos.x, o.pos.z - q.pos.z);
                if (dd < bd) { bd = dd; best = o; }
            }
            if (best) { used.add(best); q.gid = best.gid; q.firstT = best.firstT; q.threatT = best.threatT; q.threatR = best.threatR; q.merged = best.merged; q.called = best.called; q.popup = best.popup; }
            else { q.gid = this.nextId++; q.firstT = now; q.isNew = true; }
            q.lastT = now;
            this.ident(q);
        }
        // groups that have gone: faded (called ones close to the player)
        const P = this.player;
        for (const o of this.groups) {
            if (used.has(o) || !o.called || !P || this.air.callsOn === false) continue;
            if (Math.hypot(o.pos.x - P.pos.x, o.pos.z - P.pos.z) > 70000 || o.missiles) continue;
            // (shot down isn't faded: a group whose members all died just goes)
            if (o.members.every(m => (m.unit && !m.unit.alive) || (m.flight && (m.flight.done || m.flight.n === 0)))) continue;
            this.say(this.pc + ', ' + this.call + ', ' + BR.groupBullseye(this.bull, o, o.id).replace(/, (HOSTILE|BOGEY).*$/, '') + ', FADED', { ttl: 12 });
        }
        this.groups = fresh;
    }

    // HOSTILE (identified, or out of enemy airspace with no IFF answer: the ID criteria) or BOGEY; the type fill-in
    ident(q) {
        let hostile = false, type = null, sameType = true;
        for (const m of q.members) {
            if (m.known >= INTEL.IDENTIFIED || m.origin === 'red' || m.flight || m.missile) hostile = true;
            const t = m.known >= INTEL.IDENTIFIED ? m.type : null;
            if (!t) sameType = false; else if (type && type !== t) sameType = false; else type = t;
        }
        q.id = hostile ? 'HOSTILE' : 'BOGEY';
        q.type = q.missiles ? 'CRUISE MISSILES' : sameType && type ? BR.REPORTING[type] || null : null;
        q.fast = !q.missiles && Math.hypot(q.vel.x, q.vel.z) > 330;
    }

    // ── what MAGIC says by itself ──
    calls() {
        const g = this.game, war = g.war, P = this.player;
        const now = war.time;
        for (const q of this.groups) {
            if (q.missiles) {
                if (!q.called) { q.called = true; this.say(this.call + ', ' + (q.n > 1 ? q.n + ' ' : '') + 'CRUISE MISSILES INBOUND, GROUP ' + BR.formatBullseye(this.bull, q.pos, q.vel) + ', HOSTILE', { color: '#ff4a3d', priority: true, speech: 'cruise missiles inbound' }); }
                continue;
            }
            if (!P) { if (!q.called && q.isNew) q.called = true; continue; }
            const rng = Math.hypot(q.pos.x - P.pos.x, q.pos.z - P.pos.z);
            const b = BR.braa(P.pos, q.pos, q.vel);
            if (rng < MERGE_R) {
                if (!q.merged) { q.merged = true; q.called = true; this.say(this.pc + ', ' + this.call + ', MERGED', { priority: true, color: '#ff9f5a' }); }
                continue;
            }
            if (q.isNew && !q.called && rng < POPUP_R) {
                q.called = true; q.popup = true; q.threatT = now; q.threatR = rng;
                this.say(this.pc + ', ' + this.call + ', POPUP ' + BR.groupBraa(P.pos, q, q.id), { priority: rng < 20000, color: '#ff9f5a' });
                continue;
            }
            if (!q.called && q.isNew && !q.flightAnnounced) {
                // a group further out: NEW GROUP in bullseye (director flights are announced through announceFlight)
                q.called = true;
                if (!q.members.some(m => m.flight)) this.say(this.call + ', NEW GROUP ' + BR.formatBullseye(this.bull, q.pos, q.vel) + ', ' + q.id + BR.fillIns(q).map(s => ', ' + s).join(''), { color: '#ffd24a', ttl: 15 });
            }
            // THREAT: closing, inside the briefed range; again when it's halved the range or a while has passed
            const closing = b.aspect === 'HOT' || b.aspect === 'FLANK';
            if (closing && rng < THREAT_R && (q.threatT == null || (now - q.threatT > 45) || rng < (q.threatR ?? Infinity) * 0.55)) {
                q.threatT = now; q.threatR = rng; q.called = true;
                this.say(this.pc + ', ' + this.call + ', THREAT, ' + BR.groupBraa(P.pos, q, q.id), { priority: rng < 15000, color: '#ff9f5a' });
            }
        }
        // a picture now and then (and the check-in one)
        this.pictureT -= 2;
        if (this.pictureT <= 0) {
            this.pictureT = 210;
            const air = this.groups.filter(q => !q.missiles);
            if (now - this.lastPicture > 60) this.picture(true);
            void air;
        }
    }

    say(text, { color = '#9fd4ff', priority = false, ttl = 20, speech = null } = {}) {
        this.air.say(this.call, text.replace(new RegExp('^' + this.call + ', '), ''), { color, priority, ttl, say: speech || BR.speakable(text) });
    }

    // ── answers ──
    // BOGEY DOPE: BRAA to the nearest group
    bogeyDope() {
        const P = this.player, pc = this.pc;
        this.air.say(pc, this.call + ', ' + pc + ', BOGEY DOPE', { color: '#8fd0ff', say: false });
        if (!P) return;
        const air = this.groups.filter(q => !q.missiles);
        if (!air.length) { this.say(pc + ', ' + this.call + ', CLEAN', { priority: true }); return; }
        let best = null, bd = Infinity;
        for (const q of air) { const d = Math.hypot(q.pos.x - P.pos.x, q.pos.z - P.pos.z); if (d < bd) { bd = d; best = q; } }
        best.called = true; best.threatT = this.game.war.time; best.threatR = bd;
        this.say(pc + ', ' + this.call + ', ' + BR.groupBraa(P.pos, best, best.id), { priority: true });
    }

    // PICTURE: all the groups, bullseye format
    picture(own = false) {
        const P = this.player, pc = this.pc;
        if (!own) this.air.say(pc, this.call + ', ' + pc + ', REQUEST PICTURE', { color: '#8fd0ff', say: false });
        this.lastPicture = this.game.war.time;
        const air = this.groups.filter(q => !q.missiles);
        for (const q of air) q.called = true;
        const txt = BR.pictureCall(this.bull, air, P ? P.pos : null);
        this.say((own ? this.call + ', ' : pc + ', ' + this.call + ', ') + txt, { priority: !own, ttl: 30 });
    }

    // DECLARE: the locked target (by what we know of it)
    declare() {
        const g = this.game, war = g.war, pc = this.pc, P = this.player;
        const t = g.lockTarget;
        if (!t || !P) { this.air.say(pc, this.call + ', ' + pc + ', DECLARE', { color: '#8fd0ff', say: false }); this.say(pc + ', ' + this.call + ', SAY AGAIN — NO TRACK LOCKED', { priority: true }); return; }
        const b = BR.braa(P.pos, t.pos, t.vel || { x: 0, y: 0, z: 0 });
        this.air.say(pc, this.call + ', ' + pc + ', DECLARE, ' + BR.formatBraa(b).replace(/, (HOT|FLANK|BEAM|DRAG).*$/, ''), { color: '#8fd0ff', say: false });
        const ans = this.declareText(t);
        this.say(pc + ', ' + this.call + ', ' + ans, { priority: true });
        return ans;
    }

    declareText(t) {
        const g = this.game, war = g.war;
        if (t.isStrategic) return 'HOSTILE, CRUISE MISSILE';
        if (t.isGround) return 'UNABLE — SURFACE TRACK';
        const neutral = AIR_TARGETS.includes(t);
        const held = neutral || t.team === war.side || this.holds(t) || (war.rec(t) && war.time - war.rec(t).lastSeen < HELD);
        // friendlies and the target within 5 NM of each other: FURBALL
        let mixed = false;
        if (t.team !== war.side && !neutral) for (const a of g.aircraft) if (a.alive && a.team === war.side && a !== g.player && a.pos.distanceTo(t.pos) < 5 * BR.NM) { mixed = true; break; }
        const rec = war.rec(t);
        const known = rec ? rec.known : 0;
        const origin = rec ? (rec.origin || war.sideAt(rec.lastPos.x, rec.lastPos.z)) : null;
        const id = BR.declare({ team: t.team, known, hostileOrigin: origin === 'red' }, war.side, { held, friendliesNear: mixed, neutral });
        if (id === 'HOSTILE') {
            const type = known >= INTEL.IDENTIFIED ? BR.REPORTING[t.type] : null;
            return 'HOSTILE, SINGLE CONTACT' + (type ? ', ' + type : '');
        }
        if (id === 'FRIENDLY') return 'FRIENDLY' + (t.callsign && t.callsign !== t.spec?.name ? ', ' + t.callsign : '');
        return id;
    }

    // the director's new flight, in brevity (called by director.announce); true when we made the call
    announce(f) {
        if (!this.flight || !this.air.callsOn) return false;
        const P = this.player;
        const q = { pos: f.pos, vel: f.vel, n: f.n, members: [], type: null };
        const tail = f.role === 'raid' ? ' — ' + (f.standoff ? 'BOMBERS, EXPECT CRUISE MISSILES' : 'STRIKE AIRCRAFT') + (f.target ? ', TARGET ' + f.target.label : '') : f.role === 'recon' ? ' — FAST MOVER, RECCE' : f.role === 'cas' ? ' — ATTACK AIRCRAFT' + (f.target ? ', TARGET ' + f.target.label : '') : '';
        const close = P && Math.hypot(f.pos.x - P.pos.x, f.pos.z - P.pos.z) < POPUP_R;
        const txt = close ? this.pc + ', ' + this.call + ', POPUP ' + BR.groupBraa(P.pos, q, 'HOSTILE') : this.call + ', NEW GROUP ' + BR.formatBullseye(this.bull, f.pos, f.vel) + ', HOSTILE' + BR.fillIns(q).map(s => ', ' + s).join('');
        this.say(txt + tail, { color: f.role === 'raid' ? '#ff9f5a' : '#ffd24a', priority: f.role === 'raid', ttl: 25, speech: BR.speakable(txt) + (f.role === 'raid' ? '. raid.' : '') });
        // (so our own grouping doesn't call it again)
        for (const q2 of this.groups) if (q2.members.some(m => m.flight === f)) { q2.called = true; q2.flightAnnounced = true; }
        return true;
    }
}

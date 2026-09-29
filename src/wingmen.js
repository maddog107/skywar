// ═══════════════════════════════════════════════════════════════
// Wingmen that take orders (docs/WAR.md), a plug-in system (systems.js). The wingmen themselves are spawned by
// game.js start() in formation (ai.js flies them); this gives each an order and a "brain" the AI consults
// (Pilot.brain: pick(pilot) chooses its target, steer(pilot, dt) flies it when it has none):
//  • ATTACK MY TARGET — the HUD's locked target, or the latest mark: a dogfight, or gun and rocket runs
//  • COVER ME — on the wing, and anything that threatens the player within ~8 km gets engaged
//  • ENGAGE FIGHTERS — free CAP: any bandit within 30 km
//  • ATTACK GROUND TARGETS — known enemies near the player (or the latest mark), one after another
//  • HOLD POSITION — orbit where the order was given, engaging what comes close
//  • ESCORT AIRCRAFT — stay with the nearest friendly aircraft and protect it
//  • RETURN TO BASE — fly home and land; a fresh jet comes back up after a while
// Every order gets a spoken acknowledgement. With no order given the wingmen behave exactly as before (the
// Living War starts them on COVER ME). Orders go to the whole flight or to one wingman (WINGMEN › BOLT).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, groundHeight } from './world.js';
import { INTEL } from './war.js';
import { Aircraft } from './aircraft.js';
import { Pilot } from './ai.js';
import { ALLY_POOL } from './config.js';
import { clamp, pick } from './util.js';

export const ORDERS = {
    attack: { label: 'ATTACK MY TARGET', hint: 'LOCKED OR MARKED' },
    cover: { label: 'COVER ME', hint: 'ON MY WING' },
    engage: { label: 'ENGAGE FIGHTERS', hint: 'FREE CAP' },
    ground: { label: 'ATTACK GROUND TARGETS', hint: 'KNOWN ENEMIES NEAR ME' },
    hold: { label: 'HOLD POSITION', hint: 'ORBIT HERE' },
    escort: { label: 'ESCORT AIRCRAFT', hint: 'NEAREST FRIENDLY' },
    rtb: { label: 'RETURN TO BASE', hint: 'LAND AND REARM' },
};
export const ORDER_KEYS = ['attack', 'cover', 'engage', 'ground', 'hold', 'escort', 'rtb'];
const COVER_R = 8000, ENGAGE_R = 30000, HOLD_R = 7000, ESCORT_R = 7000, SELF_R = 2200;
const VOICE = [{ pitch: 0.95, rate: 1.26, name: 'Fred|Albert|Ralph' }, { pitch: 1.12, rate: 1.24, name: 'Tom|Bruce|Junior' }];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3();

// What a wingman is doing: his order and whatever it's about (a target, a point, an aircraft)
export class WingBrain {
    constructor(sys, ac, order = 'cover') {
        this.sys = sys; this.game = sys.game; this.ac = ac;
        this.wingman = true;
        this.order = order;
        this.target = null;     // attack: the ordered target · ground: the current one
        this.hold = null;       // hold: the orbit centre (y = altitude)
        this.escortee = null;   // escort: the aircraft
        this.formation = ac.pilot ? ac.pilot.formation : null; // (kept to put him back on the wing)
        this.orbitDir = 1;
    }

    // the target the AI should go for (null: none, fly steer() or formation; undefined: the AI's own choice)
    pick(p) {
        const g = this.game, ac = this.ac, P = g.player;
        // anything right on top of him gets fought, whatever the order
        const close = this.nearestBandit(ac.pos, SELF_R, ac.pos);
        switch (this.order) {
            case 'attack': {
                const t = this.target;
                if (t && t.alive && !t.removed) return close && t.isGround ? close : t;
                return close || null;
            }
            case 'cover': {
                if (!P || !P.alive) return close || null;
                // whoever's after the player first, then anything near him
                let best = null, bd = Infinity;
                for (const e of g.aircraft) {
                    if (!e.alive || e.team === ac.team || e.onGround || e.abandoned) continue;
                    const d = e.pos.distanceTo(P.pos);
                    if (d > COVER_R) continue;
                    const onHim = (e.pilot && e.pilot.target === P) || P.incoming.some(m => m.owner === e);
                    const s = d * (onHim ? 0.4 : 1) + e.pos.distanceTo(ac.pos) * 0.3;
                    if (s < bd) { bd = s; best = e; }
                }
                return best || close || null;
            }
            case 'engage': return this.nearestBandit(P && P.alive ? P.pos : ac.pos, ENGAGE_R, ac.pos) || null;
            case 'ground': {
                if (close) return close;
                const t = this.target;
                if (t && t.alive && !t.removed && t.pos.distanceTo(ac.pos) < 14000) return t;
                this.target = this.sys.groundTarget(this);
                return this.target || null;
            }
            case 'hold': return this.hold ? this.nearestBandit(this.hold, HOLD_R, ac.pos) || null : null;
            case 'escort': {
                const E = this.escortee;
                if (!E || !E.alive) return close || null;
                let best = null, bd = Infinity;
                for (const e of g.aircraft) {
                    if (!e.alive || e.team === ac.team || e.onGround) continue;
                    const d = e.pos.distanceTo(E.pos);
                    const onIt = e.pilot && (e.pilot.target === E || e.pilot.priority === E);
                    if (d > ESCORT_R && !onIt) continue;
                    const s = d * (onIt ? 0.4 : 1);
                    if (s < bd) { bd = s; best = e; }
                }
                return best || close || null;
            }
            case 'rtb': return null;
        }
        return undefined;
    }

    nearestBandit(at, R, from) {
        let best = null, bd = Infinity;
        for (const e of this.game.aircraft) {
            if (!e.alive || e.team === this.ac.team || e.onGround || e.abandoned) continue;
            if (e.pos.distanceTo(at) > R) continue;
            const d = e.pos.distanceTo(from);
            if (d < bd) { bd = d; best = e; }
        }
        return best;
    }

    // where to fly with no target: an orbit round the hold point, or a slot beside the escorted aircraft
    // (returns null to fly the formation / the AI's own patrol)
    steer(p, dt) {
        const ac = this.ac;
        void dt;
        if (this.order === 'hold' && this.hold) {
            const c = this.hold;
            const rel = _v.set(ac.pos.x - c.x, 0, ac.pos.z - c.z);
            const r = rel.length() || 1;
            rel.divideScalar(r);
            const R = 2200;
            const tang = _v2.set(-rel.z * this.orbitDir, 0, rel.x * this.orbitDir);
            const dir = _d.copy(tang).addScaledVector(rel, -clamp((r - R) / R, -0.8, 0.8));
            dir.y = clamp((c.y - ac.pos.y) / 1500, -0.25, 0.25);
            return { dir: dir.normalize(), throttle: 0.72 };
        }
        if (this.order === 'escort' && this.escortee && this.escortee.alive) {
            const E = this.escortee;
            const f = _v2.copy(E.vel).setY(0);
            if (f.lengthSq() < 1) f.set(0, 0, -1);
            f.normalize();
            const slot = _v.copy(E.pos).addScaledVector(f, -220).add(_d.set(-f.z * 260, 70, f.x * 260));
            const dir = _d.subVectors(slot, ac.pos);
            const dist = dir.length();
            dir.normalize();
            const closing = ac.vel.dot(dir) - E.vel.dot(dir);
            const throttle = clamp(0.55 + (dist - 150) * 0.0015 - closing * 0.01, 0.2, 1);
            if (dist < 250) dir.lerp(f, 1 - dist / 250).normalize();
            return { dir, throttle };
        }
        return null;
    }
}

export class Wingmen {
    constructor(game) {
        this.game = game;
        this.list = [];      // { ac, callsign, brain, voice, status, respawnT, base }
        game.events.on('killed', (ac, d = {}) => this.onKilled(ac, d.source));
        game.events.on('groundKilled', (t, d = {}) => this.onGroundKilled(t, d.source));
    }

    // ═════════════ Lifecycle ═════════════
    start(mode) {
        this.clear();
        this.mode = mode;
        const g = this.game;
        // the wingmen game.js made (formation on the player)
        let i = 0;
        for (const a of g.aircraft) {
            if (a === g.player || a.team !== g.war.side || !a.pilot || !a.pilot.formation) continue;
            this.list.push({ ac: a, callsign: a.callsign, voice: VOICE[i % VOICE.length], brain: null, hitCall: false, lowCall: false, rktT: 0, offset: a.pilot.formation.offset.clone(), type: a.type });
            i++;
        }
        // the Living War starts them covering the player, with rockets for ground work
        if (mode === 'war') for (const w of this.list) { this.setOrder(w, 'cover', true); w.ac.rockets = 24; }
    }

    clear() { this.list.length = 0; }

    get active() { return this.list.filter(w => w.ac && w.ac.alive && !w.ac.removed); }

    // ═════════════ Orders ═════════════
    // give one wingman (w) or all of them (w = null) an order; quiet: no radio
    order(key, w = null, quiet = false) {
        const ws = w ? [w] : this.active;
        if (!ws.length) return false;
        let ok = false;
        for (let k = 0; k < ws.length; k++) ok = this.setOrder(ws[k], key, quiet || k > 0) || ok;
        this.game.events.emit('wingmanOrder', key, { wingmen: ws });
        return ok;
    }

    setOrder(w, key, quiet = false) {
        const g = this.game, war = g.war, ac = w.ac;
        if (!ac || !ac.alive || !ac.pilot) return false;
        const p = ac.pilot;
        const b = w.brain || (w.brain = new WingBrain(this, ac, key));
        const prev = b.order;
        // the order's subject, or "unable"
        let say = null, label = '';
        switch (key) {
            case 'attack': {
                const t = this.orderedTarget();
                if (!t) { this.ack(w, 'UNABLE — NO TARGET. LOCK OR MARK ONE', quiet); return false; }
                b.target = t;
                label = war ? war.label(t) : t.name || 'TARGET';
                say = t.isGround ? pick(['IN HOT ON ', 'COPY, ROLLING IN ON ']) + label : pick(['COPY, ENGAGING ', 'TALLY, ENGAGING ']) + label;
                break;
            }
            case 'cover': say = pick(['COPY, ON YOUR WING', 'WILCO, COVERING YOU', 'COPY, I\'VE GOT YOUR SIX']); break;
            case 'engage': say = pick(['COPY, ENGAGING BANDITS', 'WEAPONS FREE, HUNTING', 'COPY, FREE CAP']); break;
            case 'ground': {
                b.target = null;
                const t = this.groundTarget(b, true);
                if (!t) { this.ack(w, 'UNABLE — NO GROUND TARGETS KNOWN NEAR YOU', quiet); return false; }
                b.target = t;
                say = pick(['COPY, IN HOT', 'WILCO, ATTACKING GROUND TARGETS', 'COPY, ROLLING IN']) + ' — ' + (war ? war.label(t) : t.name);
                break;
            }
            case 'hold': {
                const P = g.player && g.player.alive ? g.player.pos : ac.pos;
                const alt = Math.max(P.y, groundHeight(P.x, P.z) + 1200);
                b.hold = new THREE.Vector3(P.x, alt, P.z);
                b.orbitDir = Math.random() < 0.5 ? -1 : 1;
                say = 'HOLDING AT ANGELS ' + Math.max(1, Math.round(alt * 3.281 / 1000));
                break;
            }
            case 'escort': {
                const E = this.escortCandidate(ac);
                if (!E) { this.ack(w, 'NEGATIVE — NOTHING TO ESCORT', quiet); return false; }
                b.escortee = E;
                say = 'COPY, ESCORTING ' + (E.callsign || (war ? war.label(E) : 'THE FRIENDLY'));
                break;
            }
            case 'rtb': {
                w.base = this.nearestBase(ac.pos);
                say = pick(['COPY, RTB', 'WILCO, HEADING HOME', 'RTB, SEE YOU ON THE GROUND']);
                break;
            }
        }
        b.order = key;
        p.brain = b;
        // on the wing for the orders that stay with the player; free for the ones that don't
        p.formation = key === 'cover' || key === 'attack' || key === 'ground' || key === 'engage' ? (b.formation || p.formation) : null;
        if (b.formation) b.formation.leader = g.player;
        if (key === 'rtb') { p.passive = true; p.waypoint = new THREE.Vector3(w.base.x, w.base.h + 1500, w.base.z); p.cruise = 0.75; p.target = null; }
        else { p.passive = false; p.waypoint = null; }
        p.target = null; p.thinkT = 0; // (re-decide now)
        w.status = key;
        if (!quiet && say) this.ack(w, say);
        void prev;
        return true;
    }

    // "BOLT, COPY, ENGAGING" — spoken
    ack(w, text, quiet = false) {
        if (quiet) return;
        const g = this.game, war = g.war;
        const line = text;
        const spoken = w.callsign.toLowerCase() + ', ' + text.toLowerCase().replace(/ — .*/, '');
        war.radio(w.callsign, line, { color: '#8fd0ff', say: spoken, voice: w.voice });
    }

    // the HUD's locked target, else the newest mark on a unit that's still there
    orderedTarget() {
        const g = this.game, war = g.war;
        const t = g.lockTarget;
        if (t && t.alive && !g.isNeutral(t) && t.team !== g.war.side) return t;
        for (let i = war.designations.length - 1; i >= 0; i--) {
            const d = war.designations[i];
            if (d.unit && d.unit.alive && d.unit.team !== war.side) return d.unit;
        }
        return null;
    }

    // a ground target for a wingman: the latest mark, else known enemies near the player (not ones the other
    // wingman is on; armour and guns before the SAMs that would kill him)
    groundTarget(b, fresh = false) {
        const g = this.game, war = g.war;
        const mark = [...war.designations].reverse().find(d => d.unit && d.unit.alive && d.unit.isGround && !d.unit.isShip && d.unit.team !== war.side);
        if (mark && (fresh || !this.taken(mark.unit, b))) return mark.unit;
        const P = g.player && g.player.alive ? g.player.pos : b.ac.pos;
        const W = { tank: 1, artillery: 1, vehicle: 1.2, aaa: 1.6, tel: 0.8, convoy: 1, sam: 2.5, 'sam-radar': 2.5 };
        let best = null, bs = Infinity;
        for (const { u, rec, d2 } of war.near(P, 9000, { team: war.enemyTeam, minKnown: INTEL.CONTACT })) {
            if (!u.isGround || u.isShip || u.isBridge || rec.hardened > 0.5) continue;
            if (this.taken(u, b)) continue;
            const s = Math.sqrt(d2) * (W[rec.cls] ?? 1.5);
            if (s < bs) { bs = s; best = u; }
        }
        return best;
    }

    taken(u, b) { return this.list.some(w => w.brain && w.brain !== b && w.brain.order === 'ground' && w.brain.target === u); }

    escortCandidate(ac) {
        const g = this.game;
        let best = null, bd = 40000;
        for (const a of g.aircraft) {
            if (!a.alive || a.team !== ac.team || a === g.player || a === ac || a.onGround) continue;
            if (this.list.some(w => w.ac === a)) continue;
            const d = a.pos.distanceTo(g.player ? g.player.pos : ac.pos);
            if (d < bd) { bd = d; best = a; }
        }
        return best;
    }

    nearestBase(pos) {
        const g = this.game;
        let best = null, bd = Infinity;
        for (const b of BASES) {
            if (!b.friendly || b.civil) continue;
            const d = Math.hypot(b.x - pos.x, b.z - pos.z);
            if (d < bd) { bd = d; best = b; }
        }
        void g;
        return best || BASES[0];
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        const g = this.game;
        if (g.state === 'menu' || g.state === 'over' || !this.list.length) return;
        for (const w of this.list) {
            const ac = w.ac;
            // a replacement coming up after RTB or a loss (Living War / Sandbox)
            if ((!ac || !ac.alive || ac.removed) && w.respawnT != null) {
                w.respawnT -= dt;
                if (w.respawnT <= 0) this.relaunch(w);
                continue;
            }
            if (!ac || !ac.alive) continue;
            const b = w.brain;
            if (!b) continue;
            // the ordered target is gone: report and go back to covering the player
            if (b.order === 'attack' && b.target && !b.target.alive) {
                this.ack(w, b.target.isGround ? pick(['TARGET DESTROYED', 'SHACK! TARGET DOWN']) + ' — REJOINING' : 'SPLASH — REJOINING');
                b.target = null;
                this.setOrder(w, 'cover', true);
            }
            if (b.order === 'escort' && (!b.escortee || !b.escortee.alive)) { this.ack(w, 'MY ESCORT IS GONE — REJOINING'); this.setOrder(w, 'cover', true); }
            // rockets on a ground run: nose on it, in range
            if (ac.pilot && ac.pilot.target && ac.pilot.target.isGround && ac.pilot.strafePhase === 'in' && (ac.rockets || 0) > 0) {
                w.rktT -= dt;
                const t = ac.pilot.target, d = t.pos.distanceTo(ac.pos);
                if (w.rktT <= 0 && d < 1900 && d > 500) {
                    const f = ac.getForward(_v);
                    if (_v2.subVectors(t.pos, ac.pos).normalize().dot(f) > 0.9975) {
                        w.rktT = 1.1;
                        for (let k = 0; k < 2 && ac.rockets > 0; k++) { g.weapons.fireMissile(ac, null, 'rkt'); ac.rockets--; }
                    }
                }
            }
            // damage and fuel: say so, and come home when it's bad
            const hp = ac.health / ac.maxHealth;
            if (hp < 0.55 && !w.hitCall) { w.hitCall = true; this.ack(w, pick(['I\'M HIT — STILL IN THE FIGHT', 'TAKING DAMAGE, I\'M OK'])); }
            if (hp < 0.25 && b.order !== 'rtb' && (this.mode === 'war' || this.mode === 'sandbox')) { this.ack(w, 'I\'M HIT BAD — RTB'); this.setOrder(w, 'rtb', true); }
            if (!w.winchester && ac.missiles === 0 && (ac.ammo || 0) < 40) { w.winchester = true; this.ack(w, 'WINCHESTER — GUNS AND MISSILES OUT'); }
            // home: land and hand over to a fresh jet
            if (b.order === 'rtb' && w.base && Math.hypot(ac.pos.x - w.base.x, ac.pos.z - w.base.z) < 2600) {
                const far = !g.player || ac.pos.distanceTo(g.camera.position) > 3000;
                if (far) this.land(w);
            }
        }
    }

    // on the ground: the jet goes, and (in the war modes) a fresh one comes up later
    land(w) {
        const g = this.game, ac = w.ac;
        this.ack(w, 'ON DECK — REARMING');
        ac.remove();
        const i = g.aircraft.indexOf(ac);
        if (i >= 0) g.aircraft.splice(i, 1);
        ac.removed = true;
        if (this.mode === 'war' || this.mode === 'sandbox') w.respawnT = 75;
    }

    relaunch(w) {
        const g = this.game, p = g.player;
        w.respawnT = null;
        if (!p) return;
        const base = w.base || this.nearestBase(p.pos);
        const a = new Aircraft(g, w.type || pick(ALLY_POOL), { team: g.war.side, name: w.callsign });
        const dir = _v.set(p.pos.x - base.x, 0, p.pos.z - base.z);
        const L = dir.length() || 1;
        a.spawnAir(new THREE.Vector3(base.x + dir.x / L * 1500, base.h + 900, base.z + dir.z / L * 1500), Math.atan2(-dir.x, -dir.z), 0.6);
        const pl = new Pilot(g, a, clamp(g.difficulty.skill + 0.1, 0.4, 0.9));
        pl.formation = { leader: p, offset: w.offset.clone() };
        a.rockets = 24;
        g.aircraft.push(a);
        w.ac = a; w.brain = null; w.hitCall = false; w.winchester = false;
        this.setOrder(w, 'cover', true);
        this.ack(w, 'AIRBORNE, REJOINING');
    }

    onKilled(ac, source) {
        const w = this.list.find(x => x.ac === source);
        if (w && ac.team !== source.team) this.ack(w, pick(['SPLASH ONE!', 'SPLASH — BANDIT DOWN', 'FOX TWO, SPLASH']));
        const lost = this.list.find(x => x.ac === ac);
        if (lost && (this.mode === 'war' || this.mode === 'sandbox')) lost.respawnT = 150; // (game.js calls "IS DOWN")
    }

    onGroundKilled(t, source) {
        const w = this.list.find(x => x.ac === source);
        if (w && Math.random() < 0.6) this.ack(w, pick(['TARGET DESTROYED', 'SHACK!', 'GOOD HITS, TARGET DOWN']));
    }

    // ═════════════ Command menu ═════════════
    commands() {
        const ws = this.active;
        if (!this.list.length) return [];
        const out = [];
        const hasTarget = !!this.orderedTarget();
        const canEscort = ws.some(w => this.escortCandidate(w.ac));
        const hintFor = (k) => k === 'attack' ? (hasTarget ? this.game.war.label(this.orderedTarget()) : 'LOCK OR MARK FIRST') : k === 'escort' && !canEscort ? 'NO FRIENDLY AIRCRAFT' : ORDERS[k].hint;
        for (const w of this.list) {
            const alive = w.ac && w.ac.alive && !w.ac.removed;
            for (const k of ORDER_KEYS) {
                out.push({ path: ['WINGMEN', w.callsign], label: ORDERS[k].label, hint: (w.status === k && alive ? '● ' : '') + hintFor(k), enabled: alive && (k !== 'attack' || hasTarget), run: () => this.order(k, w) });
            }
            out.push({ path: ['WINGMEN', w.callsign], label: 'STATUS: ' + this.statusText(w), enabled: false, run: () => {} });
        }
        if (ws.length > 1 || this.list.length > 1) for (const k of ORDER_KEYS) out.push({ path: ['WINGMEN'], label: 'ALL: ' + ORDERS[k].label, hint: hintFor(k), enabled: ws.length > 0 && (k !== 'attack' || hasTarget), run: () => this.order(k) });
        else for (const k of ORDER_KEYS) out.push({ path: ['WINGMEN'], label: ORDERS[k].label, hint: hintFor(k), enabled: ws.length > 0 && (k !== 'attack' || hasTarget), run: () => this.order(k) });
        return out;
    }

    statusText(w) {
        const ac = w.ac;
        if (!ac || ac.removed) return w.respawnT != null ? 'REARMING · BACK IN ' + Math.max(0, Math.round(w.respawnT)) + ' S' : 'NOT FLYING';
        if (!ac.alive) return 'DOWN';
        return (ORDERS[w.status] ? ORDERS[w.status].label : 'FORMATION') + ' · ' + Math.round(ac.health / ac.maxHealth * 100) + '%';
    }

    // ═════════════ HUD and map ═════════════
    drawHud(ctx, hud) {
        const g = this.game;
        if (!this.list.length || g.photo || g.hideHud || hud.compact || g.pilotMode || (g.tacmap && g.tacmap.open)) return;
        if (!this.list.some(w => w.brain)) return; // (no orders given: nothing new to show)
        ctx.save();
        ctx.font = '600 11px "Share Tech Mono", ui-monospace, monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        let y = hud.h - 88;
        for (const w of this.list) {
            ctx.fillStyle = w.ac && w.ac.alive && !w.ac.removed ? 'rgba(143,208,255,0.85)' : 'rgba(143,208,255,0.4)';
            ctx.fillText(w.callsign + ' ▸ ' + this.statusText(w), 28, y);
            y -= 15;
        }
        ctx.restore();
    }

    drawMap(ctx, map) {
        if (!this.list.length) return;
        const P = {}, Q = {};
        ctx.save();
        ctx.font = '600 10px "Share Tech Mono", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (const w of this.list) {
            const ac = w.ac;
            if (!ac || !ac.alive || ac.removed || !w.brain) continue;
            map.toScreen(ac.pos.x, ac.pos.z, P);
            ctx.fillStyle = '#8fd0ff';
            ctx.fillText(w.callsign + ' · ' + ORDERS[w.status].label, P.x + 10, P.y + 10);
            const b = w.brain;
            const to = b.order === 'hold' ? b.hold : b.order === 'escort' && b.escortee ? b.escortee.pos : b.order === 'rtb' && w.base ? _v.set(w.base.x, 0, w.base.z) : ac.pilot && ac.pilot.target ? ac.pilot.target.pos : null;
            if (to) {
                map.toScreen(to.x, to.z, Q);
                ctx.strokeStyle = 'rgba(143,208,255,0.55)'; ctx.setLineDash([3, 4]);
                ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke(); ctx.setLineDash([]);
                if (b.order === 'hold') { ctx.beginPath(); ctx.arc(Q.x, Q.y, Math.max(4, 2200 * map.scale), 0, Math.PI * 2); ctx.stroke(); }
            }
        }
        ctx.restore();
    }
}

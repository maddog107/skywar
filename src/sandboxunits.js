// ═══════════════════════════════════════════════════════════════
// The sandbox's units (sandbox.js): one driver per kind of thing that can be placed, over the plug-ins' own APIs
// (docs/WAR.md) — nothing here flies, drives or fights by itself except the armour platoon's gunnery and the
// helicopter's circuit, which have no plug-in of their own:
//   flights of fighters, attack jets and bombers → game.director (spawnFlight; roles, loiters, routes, targets, escorts)
//   AWACS, tankers, the Growler, drones → game.air (spawnAWACS / spawnTanker / sendGrowler / sendRecon)
//   ship groups → game.navalops (spawnGroup, moveGroupOf, launchFrom)
//   TELs, SAM groups, rocket artillery, convoys, coastal batteries → game.forces (spawn…, fireMission, relocate)
//   armour, radars, forward positions → game.ground targets (+ war.add); infantry → game.infantry squads
// A driver: spawn(sb, rec, at) → handle (or null + rec.why) · units(sb, rec) → live units · pos(sb, rec, out)
//   alive(sb, rec) · remove(sb, rec) · assign(sb, rec, m) → true / a reason · update(sb, rec, dt) · state(sb, rec)
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight, groundHeight } from './world.js';
import { INTEL } from './war.js';
import { CSG, SAG } from './navalops.js';
import { makeHelicopter } from './airbase.js';
import { registerAirTarget, unregisterAirTarget, Downed, AIR } from './softtargets.js';
import { clamp, rand, pick } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const BLUE_CALLS = ['VIPER', 'EAGLE', 'HAWK', 'RAPTOR', 'COBRA', 'SABRE', 'LANCER', 'DAGGER', 'TALON', 'HUNTER'];
const RED_CALLS = ['SOKOL', 'BERKUT', 'GROM', 'KORSHUN', 'VOLK', 'MOLNIYA', 'STRIZH', 'YASTREB'];
const TRACER_RED = [3.4, 1.0, 0.5], TRACER_BLUE = [3.0, 2.6, 1.3];
const NAMES = {
    tank: { red: 'T-72 TANK', blue: 'M1 ABRAMS' }, spaag: { red: 'ZSU-23-4 SHILKA', blue: 'M163 VULCAN' }, radar: { red: 'P-37 RADAR', blue: 'AN/TPS-75 RADAR' },
    bunker: { red: 'COMMAND POST', blue: 'COMMAND POST' },
};
const SANDBOX_FIRE = { team: 'sandbox', name: 'GUNFIRE', isFront: true }; // (the tracers' owner: they're only drawn, the hit is rolled)

export const V3 = (p, y = 0) => new THREE.Vector3(p.x, p.y ?? y, p.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
let callN = 0;
const callsign = (team) => (team === 'red' ? RED_CALLS : BLUE_CALLS)[callN++ % (team === 'red' ? RED_CALLS : BLUE_CALLS).length];

// something to follow or escort, from a record, a unit or a point: { pos, vel, done }
export function proxyOf(sb, what) {
    if (!what) return null;
    if (what.rec) {
        const rec = what.rec, D = DRIVERS[rec.kind];
        const out = new THREE.Vector3();
        return { get pos() { return D.pos(sb, rec, out); }, get vel() { const u = D.units(sb, rec)[0]; return u && u.vel ? u.vel : _v3.set(0, 0, 0); }, get done() { return !D.alive(sb, rec); }, rec };
    }
    if (what.unit) { const u = what.unit; return { get pos() { return u.pos; }, get vel() { return u.vel || _v3.set(0, 0, 0); }, get done() { return !u.alive || !!u.removed; }, unit: u }; }
    return null;
}

// ═════════════ Flights (director.js) ═════════════
const FLIGHT = {
    spawn(sb, rec, at) {
        const g = sb.game, d = g.director;
        if (!d || !d.enabled || !d.spawnFlight) { rec.why = 'THE AIR WAR ISN\'T RUNNING'; return null; }
        const pos = new THREE.Vector3(at.x, at.y, at.z);
        const bomber = rec.item === 'bomber';
        const f = d.spawnFlight({ team: rec.team, role: bomber ? 'orbit' : 'cap', types: Array(rec.n).fill(rec.type), pos, speed: bomber ? 200 : 225, skill: 0.72,
            loiter: { center: pos.clone(), R: bomber ? 9000 : 6000, until: Infinity }, callsign: rec.call = callsign(rec.team), bombs: rec.item === 'fighter' ? 0 : bomber ? 8 : 4 });
        f.home = d.homeFor(rec.team, pos);
        f.sandbox = rec;
        f.announced = true; // (the sandbox put it there: no pop-up call for it; the other side still has to find it)
        return f;
    },
    units(sb, rec) { const f = rec.handle; return f && f.members ? f.members.filter(a => a.alive) : []; },
    pos(sb, rec, out) { const f = rec.handle, l = f && f.lead(); return out.copy(l ? l.pos : f ? f.pos : rec.at); },
    alive(sb, rec) { const f = rec.handle; return !!f && !f.done && f.n > 0; },
    remove(sb, rec) {
        const g = sb.game, d = g.director, f = rec.handle;
        if (!f || !d) return;
        if (f.members) d.dematerialize(f);
        f.done = true;
        const i = d.flights.indexOf(f);
        if (i >= 0) d.flights.splice(i, 1);
    },
    // a new job for the flight: the director's own roles and fields; real jets are re-briefed at once
    assign(sb, rec, m) {
        const g = sb.game, d = g.director, f = rec.handle, war = g.war;
        if (!f || f.done) return 'GONE';
        const bomber = rec.item === 'bomber';
        const own = rec.team === war.side;
        const alt = rec.alt || 4000;
        const P = (p, y) => new THREE.Vector3(p.x, Math.max(y ?? alt, groundHeight(p.x, p.z) + 400), p.z);
        let role = f.role, loiter = null, route = [], target = null, escortOf = null, loop = false, pickFn = null, bombs = 0;
        switch (m.type) {
            case 'cap':
                role = bomber ? 'orbit' : 'cap';
                loiter = { center: P(m.at), R: bomber ? 9000 : 6000, until: Infinity };
                break;
            case 'patrol':
                if (bomber) { role = 'orbit'; route = m.route.map(p => ({ p: P(p) })); loop = true; }
                else { role = 'cap'; loiter = { center: P(m.route[0]), R: 3500, until: Infinity }; } // (the centre hops along the route: update)
                break;
            case 'recon': {
                role = 'recon';
                const c = m.at, R = 3500;
                for (let k = 0; k < 4; k++) route.push({ p: P({ x: c.x + Math.cos(k * Math.PI / 2) * R, z: c.z + Math.sin(k * Math.PI / 2) * R }, Math.max(alt, 2500)) });
                loop = true;
                break;
            }
            case 'escort': {
                const e = m.target && (m.target.rec && m.target.rec.handle && m.target.rec.kind === 'flight' ? m.target.rec.handle : proxyOf(sb, m.target));
                if (!e) return 'NOTHING TO ESCORT';
                if (e === f) return 'CAN\'T ESCORT ITSELF';
                role = 'escort'; escortOf = e;
                break;
            }
            case 'strike': case 'sead': {
                const t = m.target || { pos: m.at };
                const tp = t.unit ? t.unit.pos : t.rec ? DRIVERS[t.rec.kind].pos(sb, t.rec, new THREE.Vector3()) : V3(t.pos || m.at, groundHeight((t.pos || m.at).x, (t.pos || m.at).z));
                const tu = t.unit || (t.rec ? DRIVERS[t.rec.kind].units(sb, t.rec)[0] || null : null);
                target = { pos: tu ? tu.pos : tp.clone(), unit: tu, label: tu ? g.war.label(tu) : 'TARGET', kind: tu && (tu.isShip) ? 'ship' : 'unit' };
                if (m.type === 'sead') {
                    role = 'cas';
                    const at = tp.clone();
                    pickFn = (p) => seadPick(g, f, at, p);
                } else if (bomber || (tu && tu.isShip) || rec.item === 'attack' && !tu) {
                    // bombs over the target: in over an initial point, out past it
                    role = own ? 'strike' : 'raid';
                    const from = f.members && f.lead() ? f.lead().pos : f.pos;
                    const dir = _v.set(tp.x - from.x, 0, tp.z - from.z); const L = dir.length() || 1; dir.divideScalar(L);
                    const hAlt = bomber ? Math.max(alt, 6000) : Math.max(1200, Math.min(alt, 3000));
                    route = [{ p: P({ x: tp.x - dir.x * 12000, z: tp.z - dir.z * 12000 }, hAlt) }, { p: P(tp, hAlt), attack: true }, { p: P({ x: tp.x + dir.x * 6000, z: tp.z + dir.z * 6000 }, hAlt) }, { p: P({ x: from.x, z: from.z }, hAlt) }];
                    bombs = bomber ? 8 : 4;
                } else role = 'cas'; // (guns and rockets on what's there)
                break;
            }
            case 'move':
                role = bomber ? 'orbit' : 'cap';
                loiter = { center: P(m.at), R: 5000, until: Infinity };
                break;
            case 'rtb': d.rtb(f); return true;
            default: return 'NOT FOR AIRCRAFT';
        }
        Object.assign(f, { role, loiter, route, wp: 0, target, escortOf, loop, pick: pickFn, state: 'out', t: 0, hitReported: false, dropped: 0, vector: null, anchor: null, endT: 0 });
        if (bombs) f.bombs = f.types.map(() => bombs);
        if (f.members) {
            for (const a of f.members) {
                if (!a.alive || !a.pilot) continue;
                d.configure(f, a, a.pilot);
                a.pilot.target = null;
                if (role === 'cas') a.rockets = Math.max(a.rockets | 0, 12);
                if (bombs) a.bombs = Math.max(a.bombs | 0, bombs);
            }
        }
        return true;
    },
    update(sb, rec) {
        const f = rec.handle, m = rec.mission;
        if (!f || f.done || !m) return;
        // a patrol's CAP point walks along the route
        if (m.type === 'patrol' && f.loiter && m.route && m.route.length > 1) {
            rec.leg = rec.leg || 0;
            const here = f.members && f.lead() ? f.lead().pos : f.pos;
            if (flat(here, f.loiter.center) < 3000) {
                rec.leg = (rec.leg + 1) % m.route.length;
                const p = m.route[rec.leg];
                f.loiter.center.set(p.x, Math.max(rec.alt || 4000, groundHeight(p.x, p.z) + 400), p.z);
            }
        }
        // attack aircraft stay on the job while they're still getting there (the director sends them home 200 s in)
        if (f.role === 'cas' && f.target && f.state !== 'rtb') {
            const here = f.members && f.lead() ? f.lead().pos : f.pos;
            if (flat(here, f.target.pos) > 3500) f.t = Math.min(f.t, 20);
        }
        // recon: what the flight flies over is seen by its side
        if (m.type === 'recon' && rec.team === sb.game.war.side) revealAround(sb.game, f.members && f.lead() ? f.lead().pos : f.pos, 6000, INTEL.IDENTIFIED);
    },
    state(sb, rec) {
        const f = rec.handle;
        if (!f) return '';
        const lead = f.lead && f.lead();
        const tgt = lead && lead.pilot && lead.pilot.target;
        const word = f.state === 'rtb' ? 'RTB' : rec.mission && rec.mission.type === 'patrol' ? 'PATROL' : rec.mission && rec.mission.type === 'sead' ? 'SEAD' : ROLE_WORDS[f.role] || f.role.toUpperCase();
        const s = word + ' · ' + f.n + '/' + f.types.length + (f.members ? '' : ' (FAR)');
        return s + (tgt && tgt.pos ? ' · ENGAGING ' + nameOf(sb.game, tgt) : '');
    },
};
const ROLE_WORDS = { cap: 'CAP', escort: 'ESCORT', cas: 'ATTACKING', strike: 'STRIKE', raid: 'STRIKE', recon: 'RECON', orbit: 'ORBIT', intercept: 'INTERCEPT' };

// SEAD: the nearest emitter or launcher of an air-defence site near the aim point; the usual fight when a fighter's on us
function seadPick(g, f, at, p) {
    const ac = p.ac;
    for (const e of g.aircraft) if (e.alive && e.team !== ac.team && !e.onGround && e.pos.distanceToSquared(ac.pos) < 1800 * 1800) return undefined;
    let best = null, bd = 9000 * 9000;
    for (const t of g.ground.targets) {
        if (!t.alive || t.removed || t.team === ac.team || t.team === 'neutral' || t.isShip) continue;
        const r = g.war.rec(t), cls = r ? r.cls : t.cls;
        if (cls !== 'sam' && cls !== 'sam-radar' && cls !== 'radar' && cls !== 'aaa') continue;
        const d = t.pos.distanceToSquared(at) * (cls === 'sam-radar' || cls === 'radar' ? 0.5 : 1);
        if (d < bd) { bd = d; best = t; }
    }
    return best || undefined;
}

function revealAround(g, pos, R, level) {
    const war = g.war, foe = war.enemyTeam;
    for (const { u } of war.near(pos, R, { team: foe })) war.reveal(u, level, 'recon', true);
}

export function nameOf(g, u) {
    if (!u) return '';
    const r = g.war && g.war.rec(u);
    return (r ? r.name : u.callsign || u.name || (u.spec && u.spec.name) || 'UNIT').toUpperCase();
}

// ═════════════ Support aircraft (airsupport.js) ═════════════
const SUPPORT = {
    spawn(sb, rec, at) {
        const g = sb.game, air = g.air;
        if (!air || !air.enabled) { rec.why = 'NO AIR SUPPORT IN THIS MODE'; return null; }
        const team = rec.team;
        let f = null;
        if (rec.item === 'awacs') f = air.spawnAWACS(team, { x: at.x, z: at.z, alt: at.y });
        else if (rec.item === 'tanker') f = air.spawnTanker(team, { x: at.x, z: at.z, alt: at.y });
        else if (rec.item === 'growler') f = air.sendGrowler({ x: at.x, z: at.z });
        else if (rec.item === 'drone') f = air.sendRecon(rec.type, { x: at.x, z: at.z, r: 3500 }, true);
        if (!f) { rec.why = 'COULDN\'T LAUNCH IT'; return null; }
        f.sandbox = rec;
        return f;
    },
    units(sb, rec) { const f = rec.handle; return f && f.ac && f.ac.alive && !f.dead ? [f.ac] : []; },
    pos(sb, rec, out) { const f = rec.handle; return out.copy(f && f.ac ? f.ac.pos : rec.at); },
    alive(sb, rec) { const f = rec.handle; return !!f && !f.dead && f.ac && f.ac.alive && !f.ac.removed; },
    remove(sb, rec) { const f = rec.handle, air = sb.game.air; if (f && air && !f.dead && f.ac && !f.ac.removed) air.removeFlight(f); },
    assign(sb, rec, m) {
        const g = sb.game, air = g.air, f = rec.handle;
        if (!f || f.dead) return 'GONE';
        const role = rec.item;
        if (role === 'awacs' || role === 'tanker') {
            if (m.type !== 'cap' && m.type !== 'move') return 'ONLY AN ORBIT';
            f.setTrack(air.track(role, rec.team, { x: m.at.x, z: m.at.z, alt: rec.alt || f.alt }));
            return true;
        }
        if (role === 'growler') {
            if (m.type === 'escort') { const e = m.target && m.target.rec && m.target.rec.kind === 'flight' ? m.target.rec.handle : null; if (!e) return 'IT ESCORTS FLIGHTS OF JETS'; air.sendGrowler(e); return true; }
            if (m.type === 'cap' || m.type === 'sead') { air.sendGrowler({ x: m.at.x, z: m.at.z }); return true; }
            return 'NOT FOR THE JAMMER';
        }
        if (role === 'drone') {
            if (m.type !== 'recon') return 'ONLY RECON';
            air.taskRecon(f, { x: m.at.x, z: m.at.z, r: 3500 });
            return true;
        }
        return 'NOT FOR IT';
    },
    state(sb, rec) {
        const f = rec.handle;
        if (!f) return '';
        const task = f.task ? f.task.kind.toUpperCase() : 'IDLE';
        return rec.item.toUpperCase() + ' · ' + task + (f.threat ? ' · DEFENSIVE' : '') + (f.jammer && f.jammer.on ? ' · JAMMING' : '');
    },
};

// ═════════════ Helicopters (a circuit of their own: nothing else flies them) ═════════════
export class SandboxHeli {
    constructor(sb, team, variant, at, alt) {
        const g = sb.game;
        this.sb = sb; this.game = g;
        this.team = team;
        this.mesh = makeHelicopter(variant === 'civil' ? 'heli_civil' : 'heli_military');
        this.mesh.position.set(at.x, Math.max(terrainHeight(at.x, at.z), 0) + alt, at.z);
        g.scene.add(this.mesh);
        this.alt = alt; this.speed = 55;
        this.route = [{ x: at.x, z: at.z }]; this.wp = 0; this.orbit = { x: at.x, z: at.z };
        this.alive = true; this.radius = this.hitRadius = 8;
        this.hp = this.maxHp = 70; this.health = this.hp; this.maxHealth = this.hp;
        this.vel = new THREE.Vector3(); this.yaw = 0; this.bank = 0;
        this.name = variant === 'civil' ? 'CIVIL HELICOPTER' : team === 'red' ? 'MI-8 HIP' : 'UH-60 BLACK HAWK';
        this.cls = 'helicopter';
        this.fireT = 0;
        registerAirTarget(this);
        if (team !== 'neutral') g.war.add(this, { cls: 'helicopter', name: this.name });
    }
    get pos() { return this.mesh.position; }
    damage(amount, source) { this.hit(amount, this.game, source); }
    hit(amount, game, source) {
        if (!this.alive || amount <= 0) return;
        this.hp -= amount; this.health = this.hp;
        if (this.hp > 0) return;
        this.alive = false;
        this.downed = new Downed(this.mesh, this.vel, game || this.game, { spin: 4, size: 0.6 });
        if (source && (source === this.game.player || source === this.game.pilotMode)) this.game.addFeed('HELICOPTER DOWN', '#ffc23f');
    }
    update(dt) {
        const g = this.game;
        if (!this.alive) { if (this.downed && !this.downed.update(dt)) this.downed = null; return; }
        if (this.hp < this.maxHp * 0.5 && Math.random() < dt * 10) g.effects.puffSmoke(this.pos, _v2.set(0, 2, 0), 1.5, 0.15, 2, 0.5);
        // where to: the next waypoint, or round the orbit point / over the target
        let tx, tz;
        const T = this.strike && this.strike.done ? null : this.strike;
        if (T) {
            const tp = T.pos;
            const d = flat(this.pos, tp);
            if (d > 1400) { tx = tp.x; tz = tp.z; } else { this.circle = (this.circle || 0) + dt * 0.09; tx = tp.x + Math.cos(this.circle) * 900; tz = tp.z + Math.sin(this.circle) * 900; }
            // door guns and rockets on what's near the target
            this.fireT -= dt;
            if (this.fireT <= 0 && d < 2200) { this.fireT = rand(0.8, 1.6); duelShot(g, this, enemyNear(g, this.team, this.pos, 1800, true), 0.55, [6, 14]); }
        } else if (this.route.length > 1) {
            const w = this.route[this.wp];
            if (flat(this.pos, w) < 150) this.wp = (this.wp + 1) % this.route.length;
            tx = this.route[this.wp].x; tz = this.route[this.wp].z;
        } else { this.circle = (this.circle || 0) + dt * 0.07; tx = this.orbit.x + Math.cos(this.circle) * 700; tz = this.orbit.z + Math.sin(this.circle) * 700; }
        const dx = tx - this.pos.x, dz = tz - this.pos.z, L = Math.hypot(dx, dz) || 1;
        const want = Math.atan2(-dx, -dz);
        let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const turn = clamp(dy, -0.5 * dt, 0.5 * dt);
        this.yaw += turn;
        this.bank += (clamp(-turn / Math.max(dt, 1e-3) * 1.2, -0.45, 0.45) - this.bank) * Math.min(1, dt * 2);
        const sp = this.speed * clamp(L / 300, 0.3, 1);
        const before = _v.copy(this.pos);
        this.pos.x -= Math.sin(this.yaw) * sp * dt; this.pos.z -= Math.cos(this.yaw) * sp * dt;
        const ground = Math.max(terrainHeight(this.pos.x, this.pos.z), 0), ahead = Math.max(terrainHeight(this.pos.x - Math.sin(this.yaw) * 300, this.pos.z - Math.cos(this.yaw) * 300), 0);
        const y = Math.max(ground, ahead) + this.alt;
        this.pos.y += clamp(y - this.pos.y, -6 * dt, 9 * dt);
        this.mesh.rotation.set(-0.1, this.yaw, this.bank, 'YXZ');
        const rotor = this.mesh.userData.rotor;
        if (rotor) rotor.rotation.y += dt * 28;
        if (dt > 0) this.vel.subVectors(this.pos, before).divideScalar(dt);
    }
    remove() {
        this.alive = false; this.removed = true;
        if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
        unregisterAirTarget(this);
    }
}
void AIR;

const HELI = {
    spawn(sb, rec, at) { const h = new SandboxHeli(sb, rec.team, rec.type, at, rec.alt || 180); return h; },
    units(sb, rec) { return rec.handle && rec.handle.alive ? [rec.handle] : []; },
    pos(sb, rec, out) { return out.copy(rec.handle ? rec.handle.pos : rec.at); },
    alive(sb, rec) { return !!rec.handle && rec.handle.alive; },
    remove(sb, rec) { if (rec.handle) rec.handle.remove(); },
    assign(sb, rec, m) {
        const h = rec.handle;
        if (!h || !h.alive) return 'GONE';
        h.strike = null;
        if (m.type === 'patrol') { h.route = m.route.map(p => ({ x: p.x, z: p.z })); h.wp = 0; return true; }
        if (m.type === 'move') { h.route = [{ x: m.at.x, z: m.at.z }]; h.orbit = { x: m.at.x, z: m.at.z }; return true; }
        if (m.type === 'strike') {
            if (h.team === 'neutral') return 'IT\'S A CIVILIAN';
            h.strike = proxyOf(sb, m.target) || { pos: V3(m.at, groundHeight(m.at.x, m.at.z)), done: false };
            return true;
        }
        return 'NOT FOR A HELICOPTER';
    },
    update(sb, rec, dt) { if (rec.handle) rec.handle.update(dt); },
    state(sb, rec) { const h = rec.handle; return !h ? '' : !h.alive ? 'DOWN' : h.strike && !h.strike.done ? 'ATTACKING' : h.route.length > 1 ? 'PATROL' : 'ORBIT'; },
};

// ═════════════ Ship groups (navalops.js) ═════════════
const COMPOSITION = {
    csg: { blue: CSG, red: [['carrier', 'hvu', 0, 0], ...SAG] },
    sag: { blue: [['cruiser', 'aaw', 0, 0], ['destroyer', 'screen', -1900, -700], ['destroyer', 'screen', 1900, -700], ['supply', 'logistics', 0, 1900]], red: SAG.filter(c => c[1] !== 'sub') },
    ddg: { blue: [['destroyer', 'screen', 0, 0], ['destroyer', 'screen', 1000, 800]], red: [['destroyer', 'screen', 0, 0], ['destroyer', 'screen', 1000, 800]] },
    sub: { blue: [['ssn', 'sub', 0, 0]], red: [['ssn', 'sub', 0, 0]] },
};
const NAVAL = {
    spawn(sb, rec, at) {
        const g = sb.game, ops = g.navalops;
        if (!ops || !ops.enabled) { rec.why = 'NO NAVAL OPERATIONS IN THIS MODE'; return null; }
        const comp = COMPOSITION[rec.item][rec.team];
        const grp = ops.spawnGroup(rec.team, { x: at.x, z: at.z }, { composition: comp, name: (rec.team === 'red' ? 'RED ' : 'BLUE ') + ({ csg: 'CARRIER GROUP', sag: 'SURFACE GROUP', ddg: 'DESTROYERS', sub: 'SUBMARINE' })[rec.item] });
        if (!grp) { rec.why = 'NO OPEN WATER THERE'; return null; }
        grp.sandbox = rec;
        return grp;
    },
    units(sb, rec) { const grp = rec.handle; return grp ? grp.members.map(m => m.ship).filter(s => s.alive && !s.gone) : []; },
    pos(sb, rec, out) { const grp = rec.handle; const s = grp && (grp.guide && grp.guide.alive ? grp.guide : grp.members.map(m => m.ship).find(x => x.alive)); return out.copy(s ? s.pos : rec.at); },
    alive(sb, rec) { return !!rec.handle && rec.handle.alive; },
    remove(sb, rec) {
        const g = sb.game, grp = rec.handle, ops = g.navalops;
        if (!grp) return;
        for (const m of grp.members) {
            const s = m.ship;
            if (s.strikeSource && g.strikes) g.strikes.removeSource(s.strikeSource);
            const deck = ops.deckOf && ops.deckOf(s);
            if (deck) { deck.dispose(); ops.decks.splice(ops.decks.indexOf(deck), 1); }
            s.remove();
            s.alive = false; s.removed = true; s.group = null;
            let i = g.naval.ships.indexOf(s); if (i >= 0) g.naval.ships.splice(i, 1);
            i = g.ground.targets.indexOf(s); if (i >= 0) g.ground.targets.splice(i, 1);
        }
        const i = ops.groups.indexOf(grp);
        if (i >= 0) ops.groups.splice(i, 1);
    },
    assign(sb, rec, m) {
        const g = sb.game, ops = g.navalops, grp = rec.handle;
        if (!grp || !grp.alive) return 'GONE';
        rec.leg = 0; rec.escortT = 0;
        if (m.type === 'move') { ops.moveGroupOf(grp.guide, m.at); return true; }
        if (m.type === 'patrol') { ops.moveGroupOf(grp.guide, m.route[0]); return true; }
        if (m.type === 'escort') { const e = proxyOf(sb, m.target); if (!e) return 'NOTHING TO ESCORT'; rec.escortee = e; return true; }
        if (m.type === 'strike') return navalStrike(sb, rec, m) ? true : 'NO MISSILES FOR THAT TARGET';
        return 'NOT FOR SHIPS';
    },
    update(sb, rec, dt) {
        const g = sb.game, ops = g.navalops, grp = rec.handle, m = rec.mission;
        if (!grp || !grp.alive || !m || !grp.guide) return;
        if (m.type === 'patrol' && m.route && !grp.dest) {
            rec.leg = ((rec.leg || 0) + 1) % m.route.length;
            ops.moveGroupOf(grp.guide, m.route[rec.leg]);
        } else if (m.type === 'escort' && rec.escortee && !rec.escortee.done) {
            rec.escortT = (rec.escortT || 0) - dt;
            if (rec.escortT <= 0) { rec.escortT = 20; const p = rec.escortee.pos; ops.moveGroupOf(grp.guide, { x: p.x + 2500, z: p.z + 2500 }); }
        }
    },
    state(sb, rec) {
        const grp = rec.handle;
        if (!grp) return '';
        const n = grp.members.filter(x => x.ship.alive).length;
        return (grp.dest ? 'UNDER WAY' : 'ON STATION') + ' · ' + n + '/' + grp.members.length + ' SHIPS' + (grp.threat > 0 ? ' · THREAT' : '') + ' · ' + (grp.order || '').toUpperCase();
    },
};

function navalStrike(sb, rec, m) {
    const g = sb.game, ops = g.navalops, grp = rec.handle;
    const t = m.target && (m.target.unit || (m.target.rec && DRIVERS[m.target.rec.kind].units(sb, m.target.rec)[0])) || null;
    const target = t || { x: m.at.x, z: m.at.z };
    const ship = t && t.isShip;
    const keys = ship ? ['harpoon', 'p1000', 'kalibr', 'tlam'] : ['tlam', 'kalibr'];
    for (const mm of grp.members) {
        const s = mm.ship;
        if (!s.alive || !s.strikeSource) continue;
        for (const k of keys) if (s.strikeSource.canFire && s.strikeSource.canFire(k)) { if (ops.launchFrom(s, k, target, 2)) return true; }
    }
    return false;
}

// ═════════════ Mobile forces (forces.js) ═════════════
const FORCES = {
    spawn(sb, rec, at) {
        const g = sb.game, F = g.forces;
        if (!F || !F.enabled) { rec.why = 'NO GROUND FORCES IN THIS MODE'; return null; }
        const team = rec.team, pos = { x: at.x, z: at.z };
        let gr = null;
        switch (rec.item) {
            case 'tel': gr = team === 'red' ? F.spawnTEL('red', pos) : F.spawnArtillery('blue', 'atacms', pos); break;
            case 'sam': gr = F.spawnSAM(team, rec.type, pos, { fixed: false }); break;
            case 'artillery': gr = F.spawnArtillery(team, rec.type, pos); break;
            case 'coastal': gr = F.spawnCoastal(team, pos, { shore: [shoreNear(pos)].filter(Boolean) }); break;
            case 'convoy': {
                let to = rec.to, from = rec.from ? F.placeOf(rec.from) || pos : pos;
                if (to === 'auto' || !to) {
                    to = autoDest(g, team, from);
                    if (!to) { const ends = F.convoyEnds(team); if (ends) { to = ends.to; if (!rec.from) from = ends.from; } }
                }
                gr = to ? F.spawnConvoy(team, from, to, team === 'red' ? 0 : 0, { quiet: true }) : null;
                if (!gr) { rec.why = 'NO ROAD BETWEEN THOSE POINTS'; return null; }
                rec.to = { x: Math.round(gr.destPos.x), z: Math.round(gr.destPos.z) };
                break;
            }
        }
        if (!gr) { rec.why = rec.why || 'NOTHING FITS THERE'; return null; }
        gr.sandbox = rec;
        // the sandbox shows what it placed: its side's intel has it, the other side's has to find it
        return gr;
    },
    units(sb, rec) { const gr = rec.handle; return gr ? gr.living() : []; },
    pos(sb, rec, out) { const gr = rec.handle; if (!gr) return out.copy(rec.at); const a = gr.living(); return a.length ? gr.centre(out) : out.copy(gr.members.length ? gr.members[0].pos : rec.at); },
    alive(sb, rec) { return grAlive(rec.handle); },
    remove(sb, rec) {
        const g = sb.game, F = g.forces, gr = rec.handle;
        if (!gr || !F) return;
        for (const v of gr.members) { F.releaseMesh && F.releaseMesh(v); F.removeVehicle(v); v.alive = false; v.removed = true; const k = F.units.indexOf(v); if (k >= 0) F.units.splice(k, 1); }
        if (gr.launcher && g.strikes) g.strikes.removeSource(gr.launcher);
        gr.done = true;
        const i = F.groups.indexOf(gr);
        if (i >= 0) F.groups.splice(i, 1);
    },
    assign(sb, rec, m) {
        const g = sb.game, F = g.forces, gr = rec.handle;
        if (!grAlive(gr)) return 'GONE';
        rec.pendingT = 0;
        if (m.type === 'move') {
            if (rec.item === 'convoy') return convoyLeg(sb, rec, m.at) ? true : 'NO ROAD THERE';
            return F.relocate(gr, { x: m.at.x, z: m.at.z }) ? true : 'CAN\'T MOVE NOW';
        }
        if (m.type === 'patrol') {
            if (rec.item !== 'convoy') return 'ONLY CONVOYS PATROL';
            rec.leg = 0;
            return convoyLeg(sb, rec, m.route[0]) ? true : 'NO ROAD THERE';
        }
        if (m.type === 'strike') {
            const t = strikeTarget(sb, m);
            if (rec.item === 'coastal' && !(t && t.isShip)) return 'IT FIRES AT SHIPS';
            const k = F.fireMission(gr, t || { x: m.at.x, z: m.at.z }, { label: t ? nameOf(g, t) : 'TARGET' });
            if (!k) { rec.pendingT = 6; return true; } // (busy now: it's asked again in a moment)
            return true;
        }
        return 'NOT FOR ' + rec.item.toUpperCase();
    },
    update(sb, rec, dt) {
        const m = rec.mission, gr = rec.handle, g = sb.game;
        if (!m || !grAlive(gr)) return;
        // an order it couldn't take yet (a TEL still stowing): asked again every few seconds, for a few minutes
        if (m.type === 'strike' && rec.pendingT > 0) {
            rec.pendingT -= dt;
            if (rec.pendingT <= 0) {
                rec.tries = (rec.tries || 0) + 1;
                const t = strikeTarget(sb, m);
                const k = g.forces.fireMission(gr, t || { x: m.at.x, z: m.at.z }, { label: t ? nameOf(g, t) : 'TARGET' });
                if (!k && rec.tries < 40) rec.pendingT = 6;
            }
        }
        // a convoy on patrol: the next leg once it's there
        if (rec.item === 'convoy' && m.type === 'patrol' && m.route && m.route.length > 1 && gr.legDone) {
            gr.legDone = false;
            rec.leg = ((rec.leg || 0) + 1) % m.route.length;
            convoyLeg(sb, rec, m.route[rec.leg]);
        }
    },
    state(sb, rec) {
        const gr = rec.handle;
        if (!gr) return '';
        const a = gr.living().length;
        const st = gr.state || (gr.launchers && gr.launchers[0] && gr.launchers[0].fstate) || (gr.v && gr.v.fstate) || '';
        return String(st).toUpperCase() + ' · ' + a + '/' + gr.members.length + ' VEHICLES';
    },
};

// (a forces group's `alive` is a getter; a convoy's is a method that lists its vehicles)
const grAlive = (gr) => !!gr && !gr.done && (typeof gr.alive === 'function' ? gr.alive().length > 0 : !!gr.alive);

function strikeTarget(sb, m) {
    if (!m.target) return null;
    if (m.target.unit) return m.target.unit.alive ? m.target.unit : null;
    if (m.target.rec) return DRIVERS[m.target.rec.kind].units(sb, m.target.rec)[0] || null;
    return null;
}

// a point on the shore near a coastal battery's hide (the launchers drive there to fire)
function shoreNear(p) {
    let best = null, bd = Infinity;
    for (let r = 300; r <= 3500; r += 300) for (let k = 0; k < 24; k++) {
        const a = k / 24 * Math.PI * 2, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        const h = terrainHeight(x, z);
        if (h < 4 || h > 40) continue;
        let sea = false;
        for (let j = 0; j < 8 && !sea; j++) { const b = j / 8 * Math.PI * 2; if (terrainHeight(x + Math.cos(b) * 350, z + Math.sin(b) * 350) < -8) sea = true; }
        if (sea && r < bd) { bd = r; best = { x, z, heading: 0 }; }
    }
    return best;
}

// somewhere on the road network 4-15 km away on the team's side (a town) for a convoy placed with no destination
function autoDest(g, team, from) {
    const towns = g.world && g.world.towns ? g.world.towns.towns : [];
    const c = towns.filter(t => g.war.sideAt(t.x, t.z) === team).map(t => ({ t, d: Math.hypot(t.x - from.x, t.z - from.z) })).filter(o => o.d > 3500 && o.d < 20000).sort((a, b) => a.d - b.d);
    return c.length ? { x: c[0].t.x, z: c[0].t.z } : null;
}

// a convoy's next leg: every vehicle plans its own way there (a column again at the far end); its arrival ends the
// leg instead of the convoy (the forces system would park it and take it away)
export function convoyLeg(sb, rec, to) {
    const g = sb.game, F = g.forces, cv = rec.handle;
    if (!grAlive(cv) || !F) return false;
    if (!cv._sbFinish) {
        cv._sbFinish = cv.finish;
        cv.finish = (why) => { if (why === 'arrived' && rec.mission && (rec.mission.type === 'patrol' || rec.mission.type === 'move')) { cv.state = 'arrived'; cv.legDone = true; return; } cv._sbFinish(why); };
    }
    const live = cv.alive().filter(v => !v.dismounted);
    if (!live.length) return false;
    cv.done = false; cv.state = 'leg'; cv.legDone = false; // (not 'move': its own column logic follows the first route)
    let left = live.length;
    const dir = _v.set(to.x - live[0].pos.x, 0, to.z - live[0].pos.z); const L = dir.length() || 1; dir.divideScalar(L);
    live.forEach((v, k) => {
        const p = { x: to.x - dir.x * k * 40, z: to.z - dir.z * k * 40 };
        F.queuePlan(v, p, (r) => {
            if (!r) { if (--left <= 0) cv.legDone = true; return; }
            v.drive(r, { cap: cv.cap || 11, onArrive: () => { if (--left <= 0) { cv.state = 'arrived'; cv.legDone = true; } } });
        }, { vmax: 14 });
    });
    cv.destPos && cv.destPos.set(to.x, groundHeight(to.x, to.z), to.z);
    return true;
}

// ═════════════ Ground units of our own: armour, radars, forward positions ═════════════
// the nearest enemy of `team` within R: ground targets (not ships), soldiers, and low helicopters
export function enemyNear(g, team, pos, R, soft = false) {
    let best = null, bd = R * R;
    for (const t of g.ground.targets) {
        if (!t.alive || t.removed || t.team === team || t.team === 'neutral' || t.isShip || t.isBridge || t.ugInside) continue;
        const d = t.pos.distanceToSquared(pos);
        if (d < bd) { bd = d; best = t; }
    }
    if (g.infantry) for (const s of g.infantry.soldiers) {
        if (!s.alive || s.team === team) continue;
        const d = s.pos.distanceToSquared(pos) * (soft ? 1 : 2.5); // (a gunner goes for vehicles first)
        if (d < bd) { bd = d; best = s; }
    }
    return best;
}

// one round from `shooter` at `target`: flash and tracer near the camera, a hit (or a near miss) and its damage
export function duelShot(g, shooter, target, pHit = 0.5, dmg = [10, 18]) {
    if (!target || !shooter.alive) return;
    const fx = g.effects, cam = g.camera.position;
    const d = shooter.pos.distanceTo(target.pos);
    const near = shooter.pos.distanceTo(cam) < 9000 || target.pos.distanceTo(cam) < 9000;
    shooter.firingT = g.war ? g.war.time : 0;
    if (near) {
        const m = _v.copy(shooter.pos).setY(shooter.pos.y + 1.5);
        const dir = _v2.subVectors(target.pos, m).normalize();
        m.addScaledVector(dir, 4);
        if (fx.sprite && fx.flashTex) fx.sprite(fx.flashTex, m, 4, 0.08, 1, 1, [1, 0.85, 0.6]);
        if (g.weapons && g.weapons.newBullet) g.weapons.newBullet(m, dir.multiplyScalar(1300), SANDBOX_FIRE, 0, d / 1300 + 0.05, true, shooter.team === 'red' ? TRACER_RED : TRACER_BLUE);
    }
    const hit = Math.random() < pHit;
    if (hit) {
        if (near) fx.explosion(_v.copy(target.pos).setY(target.pos.y + 1), target.cls === 'infantry' ? 0.15 : 0.4);
        target.damage(rand(dmg[0], dmg[1]), shooter, 'gun');
    } else if (near && fx.groundImpact) {
        const x = target.pos.x + rand(-20, 20), z = target.pos.z + rand(-20, 20);
        fx.groundImpact(_v.set(x, groundHeight(x, z) + 0.5, z));
    }
}

// a ground target of ours in the war registry (ground.js makes it, war.js knows it)
function groundUnit(g, type, team, x, z, face, cls) {
    const u = g.ground.addTarget(type, x, z, face, team);
    const name = (NAMES[type] && NAMES[type][team]) || u.name;
    u.name = name; u.def = { ...u.def, name };
    g.war.add(u, { name, cls });
    return u;
}
function removeGround(g, u) {
    const i = g.ground.targets.indexOf(u);
    if (i >= 0) g.ground.targets.splice(i, 1);
    if (u.remove) u.remove();
    u.removed = true;
}

// a platoon: drives in a wedge to where it's sent, and shoots it out with anything hostile within 2.5 km
const ARMOUR = {
    spawn(sb, rec, at) {
        const g = sb.game, face = rec.team === 'red' ? 0 : Math.PI;
        const tanks = [];
        for (let i = 0; i < rec.n; i++) {
            const off = wedge(i, face);
            tanks.push(groundUnit(g, 'tank', rec.team, at.x + off.x, at.z + off.z, face, 'tank'));
        }
        return { tanks, goal: null, face, fireT: rand(1, 2), moving: false };
    },
    units(sb, rec) { return rec.handle ? rec.handle.tanks.filter(t => t.alive && !t.removed) : []; },
    pos(sb, rec, out) { return centreOf(ARMOUR.units(sb, rec), out, rec.handle ? rec.handle.tanks : [], rec.at); },
    alive(sb, rec) { return ARMOUR.units(sb, rec).length > 0; },
    remove(sb, rec) { if (rec.handle) for (const t of rec.handle.tanks) removeGround(sb.game, t); },
    assign(sb, rec, m) {
        const P = rec.handle;
        if (!P || !ARMOUR.alive(sb, rec)) return 'GONE';
        P.route = null; P.target = null; P.goal = null;
        if (m.type === 'move') P.goal = { x: m.at.x, z: m.at.z };
        else if (m.type === 'patrol') { P.route = m.route.map(p => ({ x: p.x, z: p.z })); P.leg = 0; P.goal = P.route[0]; }
        else if (m.type === 'strike') { P.target = proxyOf(sb, m.target) || { pos: V3(m.at, groundHeight(m.at.x, m.at.z)), done: false }; }
        else return 'NOT FOR ARMOUR';
        return true;
    },
    update(sb, rec, dt) { platoonUpdate(sb.game, rec.handle, rec.team, dt); },
    state(sb, rec) {
        const P = rec.handle;
        if (!P) return '';
        return (P.engaged && sb.game.time - P.engaged < 6 ? 'ENGAGED' : P.moving ? 'MOVING' : 'HOLDING') + ' · ' + ARMOUR.units(sb, rec).length + '/' + P.tanks.length + ' TANKS';
    },
};
function wedge(i, face) {
    const row = Math.ceil(i / 2), side = i === 0 ? 0 : (i % 2 ? 1 : -1);
    const ax = side * 45 * row, az = row * 40; // across, behind (in the platoon's frame)
    const c = Math.cos(face), s = Math.sin(face);
    return { x: ax * c + az * s, z: -ax * s + az * c };
}
function centreOf(list, out, all, fallback) {
    if (!list.length) return out.copy(all && all.length ? all[0].pos : V3(fallback));
    out.set(0, 0, 0);
    for (const u of list) out.add(u.pos);
    return out.divideScalar(list.length);
}
// drive (the front's zone units' way: straight over the ground, 6 m/s) and fight
function platoonUpdate(g, P, team, dt) {
    if (!P) return;
    const live = P.tanks.filter(t => t.alive && !t.removed);
    if (!live.length) return;
    const c = centreOf(live, _v3, P.tanks, live[0].pos);
    // where to: a target to close on, the next waypoint, the goal
    let goal = P.goal;
    if (P.target && !P.target.done) { const tp = P.target.pos; goal = flat(c, tp) > 1600 ? { x: tp.x, z: tp.z } : null; }
    if (P.route && P.goal && flat(c, P.goal) < 120) { P.leg = (P.leg + 1) % P.route.length; P.goal = P.route[P.leg]; goal = P.goal; }
    if (goal && flat(c, goal) < 60 && !P.route) { P.goal = null; goal = null; }
    P.moving = !!goal;
    if (goal) P.face = Math.atan2(-(goal.x - c.x), -(goal.z - c.z));
    live.forEach((u, i) => {
        if (!goal) { u.vel.set(0, 0, 0); return; }
        const off = wedge(i, P.face);
        const tx = goal.x + off.x, tz = goal.z + off.z;
        const dx = tx - u.mesh.position.x, dz = tz - u.mesh.position.z, d = Math.hypot(dx, dz);
        if (d < 6) { u.vel.set(0, 0, 0); return; }
        const step = Math.min(d, 6 * dt);
        const x = u.mesh.position.x + dx / d * step, z = u.mesh.position.z + dz / d * step;
        if (terrainHeight(x, z) < 1) { u.vel.set(0, 0, 0); return; } // (not into the sea)
        const y = groundHeight(x, z);
        u.mesh.position.set(x, y, z);
        u.pos.set(x, y + u.radius * 0.4, z);
        u.mesh.rotation.y = Math.atan2(-dx, -dz);
        u.vel.set(dx / d * 6, 0, dz / d * 6);
    });
    // gunnery: a round every second or two from one of them at the nearest hostile within 2.5 km
    P.fireT -= dt;
    if (P.fireT <= 0) {
        P.fireT = rand(1.2, 2.4) / Math.sqrt(live.length);
        const shooter = pick(live);
        const t = enemyNear(g, team, shooter.pos, 2500);
        if (t) { P.engaged = g.time; duelShot(g, shooter, t, t.cls === 'infantry' ? 0.35 : 0.5, t.cls === 'infantry' ? [40, 110] : [10, 18]); }
    }
}

const RADAR = {
    spawn(sb, rec, at) {
        const u = groundUnit(sb.game, 'radar', rec.team, at.x, at.z, rand(0, 6.28), 'radar');
        u.radarRange = 85000;
        return { units: [u] };
    },
    units(sb, rec) { return rec.handle ? rec.handle.units.filter(u => u.alive && !u.removed) : []; },
    pos(sb, rec, out) { return out.copy(rec.handle ? rec.handle.units[0].pos : V3(rec.at)); },
    alive(sb, rec) { return RADAR.units(sb, rec).length > 0; },
    remove(sb, rec) { if (rec.handle) for (const u of rec.handle.units) removeGround(sb.game, u); },
    assign() { return 'A RADAR STAYS PUT'; },
    state(sb, rec) { return RADAR.alive(sb, rec) ? 'RADIATING · 85 KM' : 'DESTROYED'; },
};

// a forward position: a command post, a radar, guns, a few tanks dug in, two squads and (theirs) an Osa
const FOB = {
    spawn(sb, rec, at) {
        const g = sb.game, team = rec.team;
        const face = team === 'red' ? 0 : Math.PI;
        const P = (dx, dz) => ({ x: at.x + dx, z: at.z + dz });
        const fix = [];
        const put = (type, dx, dz, cls) => { const p = P(dx, dz); if (terrainHeight(p.x, p.z) < 3) return null; const u = groundUnit(g, type, team, p.x, p.z, face, cls); fix.push(u); return u; };
        put('bunker', 0, 0, 'command');
        const r = put('radar', -140, 90, 'radar'); if (r) r.radarRange = 70000;
        put('spaag', 120, -80, 'aaa'); put('spaag', -110, -110, 'aaa');
        const tanks = [];
        for (let i = 0; i < 3; i++) { const p = P(-120 + i * 120, -200 * (team === 'red' ? 1 : -1)); if (terrainHeight(p.x, p.z) >= 3) tanks.push(groundUnit(g, 'tank', team, p.x, p.z, face, 'tank')); }
        const squads = [];
        if (g.infantry) for (const [dx, dz] of [[60, 60], [-70, 30]]) { const p = P(dx, dz); squads.push(g.infantry.spawnSquad({ team, pos: new THREE.Vector3(p.x, 0, p.z), n: 5, kind: 'guard', weapon: 'mixed', name: team === 'red' ? 'ENEMY SOLDIER' : 'SOLDIER' })); }
        let sam = null;
        if (g.forces && g.forces.enabled) sam = g.forces.spawnSAM(team, team === 'red' ? 'osa' : 'patriot', P(220, 160), { fixed: true, launchers: 1, support: false });
        return { fix, platoon: { tanks, goal: null, face, fireT: 1 }, squads, sam };
    },
    units(sb, rec) {
        const H = rec.handle;
        if (!H) return [];
        return [...H.fix, ...H.platoon.tanks].filter(u => u.alive && !u.removed);
    },
    pos(sb, rec, out) { return out.copy(rec.handle && rec.handle.fix[0] ? rec.handle.fix[0].pos : V3(rec.at)); },
    alive(sb, rec) { return FOB.units(sb, rec).length > 0; },
    remove(sb, rec) {
        const g = sb.game, H = rec.handle;
        if (!H) return;
        for (const u of [...H.fix, ...H.platoon.tanks]) removeGround(g, u);
        if (g.infantry) for (const sq of H.squads) for (const s of [...sq.members]) g.infantry.remove(s);
        if (H.sam) FORCES.remove(sb, { handle: H.sam });
    },
    assign() { return 'A POSITION STAYS PUT'; },
    update(sb, rec, dt) { if (rec.handle) platoonUpdate(sb.game, rec.handle.platoon, rec.team, dt); },
    state(sb, rec) { return FOB.units(sb, rec).length + ' UNITS STANDING'; },
};

const INFANTRY = {
    spawn(sb, rec, at) {
        const g = sb.game;
        if (!g.infantry) { rec.why = 'NO INFANTRY'; return null; }
        return g.infantry.spawnSquad({ team: rec.team, pos: new THREE.Vector3(at.x, 0, at.z), n: rec.n, kind: 'guard', weapon: 'mixed', spread: 5, name: rec.team === 'red' ? 'ENEMY SOLDIER' : 'SOLDIER' });
    },
    units(sb, rec) { return rec.handle ? rec.handle.members.filter(s => s.alive) : []; },
    pos(sb, rec, out) { return centreOf(INFANTRY.units(sb, rec), out, rec.handle ? rec.handle.members : [], rec.at); },
    alive(sb, rec) { return INFANTRY.units(sb, rec).length > 0; },
    remove(sb, rec) { const g = sb.game; if (rec.handle && g.infantry) for (const s of [...rec.handle.members]) g.infantry.remove(s); },
    assign(sb, rec, m) {
        const sq = rec.handle;
        if (!sq || !INFANTRY.alive(sb, rec)) return 'GONE';
        const pts = m.type === 'patrol' ? m.route : m.type === 'move' ? [m.at] : null;
        if (!pts) return 'NOT FOR INFANTRY';
        const route = pts.map(p => new THREE.Vector3(p.x, groundHeight(p.x, p.z), p.z));
        sq.members.forEach((s, i) => {
            const r = route.map((q, k) => route[(k + i) % route.length].clone().add(_v.set(rand(-4, 4), 0, rand(-4, 4))));
            s.route = m.type === 'move' ? [r[0], r[0].clone()] : r; s.routeI = 0; s.kind = 'patrol';
            if (s.state === 'idle' || s.state === 'patrol') { s.state = 'patrol'; s.moveTo = null; s.waitT = 0; }
        });
        return true;
    },
    state(sb, rec) { const n = INFANTRY.units(sb, rec).length; const s = rec.handle && rec.handle.members.find(x => x.alive); return (s ? String(s.state).toUpperCase() : 'DOWN') + ' · ' + n + ' MEN'; },
};

// which driver runs which item
export const KIND_OF = {
    fighter: 'flight', attack: 'flight', bomber: 'flight', awacs: 'support', tanker: 'support', growler: 'support', drone: 'support', heli: 'heli',
    csg: 'naval', sag: 'naval', ddg: 'naval', sub: 'naval', tel: 'forces', sam: 'forces', artillery: 'forces', convoy: 'forces', coastal: 'forces',
    armour: 'armour', infantry: 'infantry', radar: 'radar', fob: 'fob',
};
export const DRIVERS = { flight: FLIGHT, support: SUPPORT, heli: HELI, naval: NAVAL, forces: FORCES, armour: ARMOUR, infantry: INFANTRY, radar: RADAR, fob: FOB };

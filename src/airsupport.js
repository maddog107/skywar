// ═══════════════════════════════════════════════════════════════
// Air support and electronic warfare (docs/WAR.md), a war plug-in system (systems.js): game.air.
//  • support flights: real aircraft (aircraft.js) flown by an AI brain (ai.js Pilot.brain.fly) — racetrack orbits,
//    transits, photo runs, escorts. Far from the camera (> ~24 km, nothing threatening them) a flight is flown
//    coarsely: its jet leaves the scene and moves along its path on its own (no flight model, no mesh); it comes
//    back as a real jet within ~18 km, or as soon as anything threatens it
//  • AWACS (E-3G "MAGIC" ours, A-50U theirs) on racetracks at 9–10 km: ours is the controller of awacs.js
//    (the radar picture, brevity calls, BOGEY DOPE / PICTURE / DECLARE); both give their side radar coverage
//    (war.coverage, radarRange). Driven off by bandits or shot down, the picture is gone
//  • tankers (KC-135R "TEXACO": boom and MPRS wing hoses; Il-78M: three UPAZ hoses) on racetracks at 6–6.5 km:
//    rendezvous, join, pre-contact, contact and fuel through refuel.js, for the player (with an AR autopilot) and
//    the AI (wingmen come along and take their turn)
//  • reconnaissance (recon.js): MQ-9 (Hellfires through the strikes system's air strike), RQ-4, U-2 photo runs,
//    RC-135 SIGINT — tasked from the command menu or the map ("SEND RECON HERE"), revealing, watching for BDA,
//    sending pictures
//  • electronic warfare (ew.js): EA-18G escort / stand-off jamming and HARMs; the player's own Growler (an EW page);
//    enemy self-protection jammers (strobes on the player's scope, burn-through close in). war.jam is ours.
//  • bombers (bombers.js): the director's Tu-95MS raids stand off and launch Kh-101s through the strike system; a
//    B-52H on call for stand-off (JASSM) strikes and carpet bombing
// API: air.spawnAWACS(side, orbit), air.spawnTanker(side, orbit), air.requestTanker(receiver), air.sendRecon(kind,
// area), air.bomberRaid(side, targets), air.jam(ac, on, sector) — see docs/WAR.md.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { Aircraft, thrustLapse, airDensity } from './aircraft.js';
import { Pilot, steerToward, avoidTerrain } from './ai.js';
import { BASES, terrainHeight, groundHeight } from './world.js';
import { INTEL } from './war.js';
import { WEAPONS } from './config.js';
import { clamp, rand, DEG, M_TO_FT, MS_TO_KTS } from './util.js';
import * as BR from './brevity.js';
import { AwacsController } from './awacs.js';
import { makeTrack, trackPoint, trackNearest, trackLength, TankerOps, RefuelSession, receiverPoint, fuelKg, arSpeed, toWorld, LB, KT, timeToFull, rendezvousPoint } from './refuel.js';
import { JAMMERS, jamToNoise, JAM_FLOOR, emitterOf, sigintDwell, sigintHears, fixError, HARM, harmShot, bearingRad } from './ew.js';
import { RECON, reconDwell, inSwath, reconImage } from './recon.js';
import { AirLaunchSource, CARRIERS, planStandoff, bombImpact } from './bombers.js';
import { MISSILES } from './strikes.js';

if (!WEAPONS.arm) WEAPONS.arm = HARM; // the HARM joins the missile table (weapons.js fires WEAPONS[kind])

const FONT = '"Share Tech Mono", ui-monospace, monospace';
const BLUE = '#6fb4ff', RED = '#ff5a4a', GREEN = '#5dffa0', AMBER = '#ffc23f';
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _aim = new THREE.Vector3(), _dir = new THREE.Vector3();
const _tp = { x: 0, z: 0 }, _td = { x: 0, z: 0 }, _ts = { x: 0, z: 0 };
const AY = new THREE.Vector3(0, 1, 0);
const headingFor = (dx, dz) => Math.atan2(-dx, -dz); // spawnAir / qv heading (0 = north, + = left)

// Radio voices (audio.say: a system voice by name where there is one)
const VOICES = {
    MAGIC: { pitch: 1.05, rate: 1.22, name: 'Alex|US English|Aaron' },
    DARKSTAR: { pitch: 1.05, rate: 1.22, name: 'Alex|US English|Aaron' },
    TEXACO: { pitch: 0.9, rate: 1.12, name: 'Daniel|UK English Male|Arthur' },
    BOOM: { pitch: 1.0, rate: 1.1, name: 'Fred|Ralph' },
    recon: { pitch: 0.95, rate: 1.16, name: 'Tom|Albert' },
    ZAPPER: { pitch: 1.12, rate: 1.26, name: 'Tom|Bruce' },
    DOOM: { pitch: 0.78, rate: 1.08, name: 'Ralph|Fred' },
};

// Where the support aircraft fly, by role and side (the front runs east–west ~5–34 km north of the home base):
// racetracks well behind each side's lines. heading: degrees of the first leg (90 = east).
export const ORBITS = {
    awacs: { blue: { x: -5000, z: 36000, heading: 90, leg: 36000, R: 8500, alt: 9400, speed: 190 }, red: { x: 12000, z: -64000, heading: 90, leg: 30000, R: 8000, alt: 9000, speed: 180 } },
    tanker: { blue: { x: -14000, z: 17000, heading: 90, leg: 36000, R: 8500, alt: 6100, speed: 200 }, red: { x: 20000, z: -48000, heading: 90, leg: 30000, R: 8000, alt: 6500, speed: 205 } },
    rc135: { blue: { x: 6000, z: 9000, heading: 90, leg: 32000, R: 8500, alt: 10000, speed: 205 } },
    b52: { blue: { x: -26000, z: 44000, heading: 90, leg: 30000, R: 9000, alt: 10500, speed: 215 } },
    ew: { blue: { x: 0, z: 4000, heading: 90, leg: 18000, R: 5500, alt: 7000, speed: 215 } },
};
const TYPES = { awacs: { blue: 'e3', red: 'a50' }, tanker: { blue: 'kc135', red: 'il78' } };
const CALLS = { awacs: { blue: ['MAGIC', 'DARKSTAR', 'WIZARD'], red: ['BERKUT'] }, tanker: { blue: ['TEXACO', 'SHELL', 'ARCO'], red: ['VOLGA'] } };
const RADAR_RANGE = { e3: 250000, a50: 220000 };
const SELF_JAM = { su35: 'khibiny', su57: 'khibiny', tu95: 'tu95' };
export const BULLSEYE = { x: 0, z: -12000 };

// ═════════════ A support flight: one aircraft with a job ═════════════
export class SupportFlight {
    constructor(air, { type, team, role, kind = null, callsign, pos, heading = 0, speed = 200, alt = 6000, skill = 0.7 }) {
        const g = air.game;
        this.air = air; this.game = g;
        this.id = air.nextId++;
        this.role = role; this.kind = kind; this.team = team; this.type = type;
        this.callsign = callsign;
        const ac = this.ac = new Aircraft(g, type, { team, name: callsign });
        ac.spawnAir(pos, heading, clamp(speed / ac.spec.flight.speed, 0.3, 1));
        ac.vel.setLength(speed); ac.speed = speed;
        ac.throttle = ac.controls.throttle = 0.72;
        ac.missiles = role === 'ew' ? 2 : 0; ac.lrm = 0; ac.bombs = 0; ac.rockets = 0;
        if (role === 'ew') ac.harms = 2;
        ac.support = this;
        const pl = new Pilot(g, ac, skill);
        pl.passive = true;
        this.brain = { fly: (p, dt) => this.fly(dt), pick: () => null, support: this };
        pl.brain = this.brain;
        g.aircraft.push(ac);
        const blue = team === g.war.side;
        g.war.add(ac, { cls: 'aircraft', name: blue ? callsign + ' · ' + ac.spec.name.toUpperCase() : ac.spec.name.toUpperCase() });
        if (RADAR_RANGE[type]) ac.radarRange = RADAR_RANGE[type];
        this.speed = speed; this.alt = alt;
        this.minAgl = kind === 'mq9' ? 1200 : 700;
        this.maxBank = ac.spec.category === 'fighter' ? null : type === 'u2' || type === 'rq4' ? 0.45 : 0.5;
        this.task = null; this.s = 0;
        this.coarse = false;
        this.coarseUpdate = (dt) => this.coarseStep(dt);
        this.ctl = {};
        this.stretch = null;
        this.threat = null; this.threatT = 0; this.clearT = 0;
        this.t = 0;
        this.dead = false;
    }

    get alive() { return this.ac.alive && !this.ac.removed; }
    // the racetrack it flies (rendezvous predictions), if it's on one
    get track() { const t = this.task; return t && t.kind === 'track' && !this.stretch ? t.T : null; }
    get onStation() { return this.alive && !this.threat && (!this.task || this.task.kind === 'track' || this.task.kind === 'orbit' || this.task.kind === 'run' || this.task.kind === 'escort'); }

    // ── what to fly ──
    setTrack(T) { this.task = { kind: 'track', T }; this.s = trackNearest(T, this.ac.pos.x, this.ac.pos.z); this.speed = T.speed; this.alt = T.alt; this.stretch = null; }
    setOrbit(c, R, alt, speed, dir = 1) { this.task = { kind: 'orbit', c: new THREE.Vector3(c.x, 0, c.z), R, dir }; this.alt = alt; this.speed = speed; }
    setGoto(P, alt, speed, then = null) { this.task = { kind: 'goto', P: new THREE.Vector3(P.x, 0, P.z), then }; this.alt = alt; this.speed = speed; }
    setRun(a, b, alt, speed, then = null) { this.task = { kind: 'run', a: new THREE.Vector3(a.x, 0, a.z), b: new THREE.Vector3(b.x, 0, b.z), leg: 0, then }; this.alt = alt; this.speed = speed; }
    setEscort(of, off, then = null) { this.task = { kind: 'escort', of, off: off.clone(), then }; }
    rtb() {
        const b = this.air.homeBase(this.team, this.ac.pos);
        this.home = b;
        this.setGoto(b, Math.max(b.y, 2500), this.speed * 0.95, () => { this.task = { kind: 'land' }; });
    }

    // where to aim now (x, y = altitude, z) and how fast; coarse: advance exactly along the path
    aimPoint(out, dt, coarse = false) {
        const ac = this.ac, t = this.task;
        const V = this.speed;
        if (!t) { out.copy(ac.pos).addScaledVector(ac.vel, 5); out.y = this.alt; return V; }
        switch (t.kind) {
            case 'track': {
                const T = t.T;
                if (this.stretch) {
                    // a receiver on the boom: straight on past the end of the leg
                    const S = this.stretch;
                    const along = (ac.pos.x - S.x) * S.dx + (ac.pos.z - S.z) * S.dz;
                    out.set(S.x + S.dx * (along + V * 7), T.alt, S.z + S.dz * (along + V * 7));
                    return this.trackSpeed();
                }
                if (coarse) { this.s += V * dt; trackPoint(T, this.s, _tp, _td); out.set(_tp.x, T.alt, _tp.z); return V; }
                this.syncS(dt);
                trackPoint(T, this.s + Math.max(ac.speed, 90) * 7, _tp, null);
                out.set(_tp.x, T.alt, _tp.z);
                return this.trackSpeed();
            }
            case 'orbit': {
                const c = t.c, dx = ac.pos.x - c.x, dz = ac.pos.z - c.z;
                const a = Math.atan2(dz, dx) + t.dir * (coarse ? V * dt : V * 7) / t.R;
                const r = coarse ? t.R : clamp(Math.hypot(dx, dz), t.R * 0.6, t.R * 1.6) * 0.3 + t.R * 0.7;
                out.set(c.x + Math.cos(a) * r, this.alt, c.z + Math.sin(a) * r);
                return V;
            }
            case 'goto': case 'land': {
                const P = t.kind === 'land' ? this.home : t.P;
                out.set(P.x, this.alt, P.z);
                const d = Math.hypot(P.x - ac.pos.x, P.z - ac.pos.z);
                if (t.kind === 'goto' && d < (coarse ? V * dt + 300 : 1800)) { this.task = null; if (t.then) t.then(this); }
                return V;
            }
            case 'run': {
                const P = t.leg === 0 ? t.a : t.b;
                const d = Math.hypot(P.x - ac.pos.x, P.z - ac.pos.z);
                // (the photo leg: a straight line from a to b, the point beyond b to aim at)
                if (t.leg === 1) { const L = t.a.distanceTo(t.b) || 1; out.set(t.b.x + (t.b.x - t.a.x) / L * 3000, this.alt, t.b.z + (t.b.z - t.a.z) / L * 3000); }
                else out.set(P.x, this.alt, P.z);
                if (d < (coarse ? V * dt + 300 : 1500)) { if (t.leg === 0) t.leg = 1; else { this.task = null; if (t.then) t.then(this); } }
                return V;
            }
            case 'escort': {
                const E = t.of;
                if (!E || E.alive === false || E.done) { this.task = null; if (t.then) t.then(this); out.copy(ac.pos); out.y = this.alt; return V; }
                const ev = E.vel || _v3.set(0, 0, -1);
                const eh = Math.hypot(ev.x, ev.z) || 1;
                const fx = ev.x / eh, fz = ev.z / eh;
                // the slot: off right / behind the escortee (off.x right, off.z behind), its altitude + off.y
                out.set(E.pos.x - fz * t.off.x - fx * t.off.z, Math.max(E.pos.y + t.off.y, groundHeight(E.pos.x, E.pos.z) + 1500), E.pos.z + fx * t.off.x - fz * t.off.z);
                this.alt = out.y;
                const d = Math.hypot(out.x - ac.pos.x, out.z - ac.pos.z);
                // (lead the slot a little so it isn't a tail chase)
                out.x += fx * 1500; out.z += fz * 1500;
                return clamp(eh + (d - 800) * 0.04, 150, ac.spec.flight.speed * 0.9);
            }
            case 'retro': {
                // running from a threat: straight away from it, home-ward
                const T = this.threat && this.threat.alive ? this.threat.pos : t.from;
                const h = this.air.homeBase(this.team, ac.pos);
                let dx = ac.pos.x - T.x, dz = ac.pos.z - T.z;
                const dl = Math.hypot(dx, dz) || 1;
                dx /= dl; dz /= dl;
                const hx = h.x - ac.pos.x, hz = h.z - ac.pos.z, hl = Math.hypot(hx, hz) || 1;
                out.set(ac.pos.x + (dx * 0.7 + hx / hl * 0.3) * 6000, this.alt, ac.pos.z + (dz * 0.7 + hz / hl * 0.3) * 6000);
                return ac.spec.flight.speed * 0.95;
            }
        }
        out.copy(ac.pos); out.y = this.alt;
        return V;
    }

    // keep s on the point of the track we're at (a small search round it; a global one when well off it)
    syncS(dt) {
        const T = this.task.T, ac = this.ac;
        let s = this.s + Math.max(ac.speed, 50) * dt;
        const d2 = (q) => { trackPoint(T, q, _ts, null); return (_ts.x - ac.pos.x) ** 2 + (_ts.z - ac.pos.z) ** 2; };
        let best = s, bd = d2(s);
        for (const ds of [-250, 250, -60, 60]) { const d = d2(s + ds); if (d < bd) { bd = d; best = s + ds; } }
        s = best;
        if (bd > 5000 * 5000) s = trackNearest(T, ac.pos.x, ac.pos.z);
        this.s = s % trackLength(T);
    }

    // a tanker slows to the speed its receivers can hold
    trackSpeed() {
        let V = this.speed;
        if (this.ops) for (const s of this.air.sessions) if (s.tanker === this && !s.done && s.state !== 'rendezvous') V = Math.min(V, arSpeed(this.type, s.rx.spec, this.ac.pos.y));
        return V;
    }

    // ── real flight: the brain (ai.js Pilot.brain.fly) ──
    fly(dt) {
        const ac = this.ac, c = ac.controls;
        if (!ac.alive) return false;
        if (this.coarse) return true;
        if (this.task && this.task.kind === 'strike') return this.air.flyStrike(this, dt);
        const V = this.aimPoint(_aim, dt);
        const dx = _aim.x - ac.pos.x, dz = _aim.z - ac.pos.z, hd = Math.hypot(dx, dz) || 1;
        const gam = clamp((this.alt - ac.pos.y) / Math.max(ac.speed * 22, 800), -0.07, 0.07);
        _dir.set(dx / hd * Math.cos(gam), Math.sin(gam), dz / hd * Math.cos(gam));
        steerToward(ac, _dir, c, 0.6, true, this.maxBank);
        this.speedHold(V, dt);
        if (ac.flares > 0 && ac.pilot) ac.pilot.flares();
        avoidTerrain(ac, c, this.minAgl);
        return true;
    }

    speedHold(V, dt) {
        const ac = this.ac, c = ac.controls;
        const err = V - ac.speed;
        const grad = Math.max((ac.thrustMil || 5) * thrustLapse(airDensity(ac.pos.y), ac.spec) / 0.9, 0.4);
        this.ctl.i = clamp((this.ctl.i ?? 0) + err * (0.05 / grad) * dt, -0.5, 0.5);
        if (this.ctl.thr0 == null) this.ctl.thr0 = 0.7;
        c.throttle = clamp(this.ctl.thr0 + this.ctl.i + err * 0.35 / grad, 0.15, 1);
        ac.airbrake = err < -30;
    }

    // ── coarse flight: far from everyone, the jet is a point moving along its path (ac.update is this) ──
    coarseStep(dt) {
        const ac = this.ac;
        if (!ac.alive || ac.exploded) { delete ac.update; return ac.update(dt); }
        const V = this.aimPoint(_aim, dt, true);
        const t = this.task;
        if (t && t.kind === 'track' && !this.stretch) {
            ac.pos.set(_aim.x, ac.pos.y + clamp(t.T.alt - ac.pos.y, -12 * dt, 12 * dt), _aim.z);
            ac.vel.set(_td.x * V, 0, _td.z * V);
        } else if (t && t.kind === 'orbit') {
            const vx = _aim.x - ac.pos.x, vz = _aim.z - ac.pos.z, L = Math.hypot(vx, vz) || 1;
            ac.vel.set(vx / L * V, 0, vz / L * V);
            ac.pos.set(_aim.x, ac.pos.y + clamp(this.alt - ac.pos.y, -12 * dt, 12 * dt), _aim.z);
        } else {
            const dx = _aim.x - ac.pos.x, dz = _aim.z - ac.pos.z, L = Math.hypot(dx, dz) || 1;
            ac.vel.set(dx / L * V, 0, dz / L * V);
            ac.pos.x += ac.vel.x * dt; ac.pos.z += ac.vel.z * dt;
            ac.pos.y += clamp(this.alt - ac.pos.y, -12 * dt, 12 * dt);
            ac.pos.y = Math.max(ac.pos.y, groundHeight(ac.pos.x, ac.pos.z) + 600);
        }
        ac.speed = V;
        ac.qv.setFromAxisAngle(AY, headingFor(ac.vel.x, ac.vel.z));
        ac.quat.copy(ac.qv);
    }

    // level of detail: coarse when far from the camera and left alone; real when anything's near or at it
    updateLod() {
        const g = this.game, ac = this.ac;
        if (!ac.alive) { if (this.coarse) this.goReal(); return; }
        const d = ac.pos.distanceTo(g.camera.position);
        const busy = ac.incoming.length > 0 || !!this.threat || ac.health < ac.maxHealth * 0.999 || g.lockTarget === ac || this.keepReal || this.air.sessions.some(s => !s.done && (s.tanker === this || s.rx === ac));
        if (this.coarse) { if (d < 18000 || busy) this.goReal(); }
        else if (d > 24000 && !busy && this.t > 1) this.goCoarse();
    }
    goCoarse() {
        const g = this.game, ac = this.ac;
        this.coarse = true;
        ac.stopTrails();
        if (ac.root.parent) g.scene.remove(ac.root);
        ac.update = this.coarseUpdate;
        if (this.task && this.task.kind === 'track' && !this.stretch) this.s = trackNearest(this.task.T, ac.pos.x, ac.pos.z);
    }
    goReal() {
        const g = this.game, ac = this.ac;
        this.coarse = false;
        delete ac.update;
        if (!ac.root.parent && !ac.exploded) g.scene.add(ac.root);
        ac.alpha = 0.04; ac.rollRate = 0;
        ac.throttle = ac.controls.throttle = 0.72;
        ac.syncBody();
    }
}

// ═════════════ A jammer (an EA-18G's pods, a fighter's self-protection set) ═════════════
class Jammer {
    constructor(ac, kind, team, auto = true) {
        const J = JAMMERS[kind];
        this.ac = ac; this.kind = kind; this.team = team; this.auto = auto;
        this.K = J.K; this.half = J.half; this.name = J.name; this.standoff = !!J.standoff;
        this.brg = 0; this.on = false;
    }
    get pos() { return this.ac.pos; }
    get alive() { return this.ac.alive && !this.ac.removed; }
}

// ═════════════ The system ═════════════
export class AirSupport {
    constructor(game) {
        this.game = game;
        this.flights = [];
        this.sessions = [];
        this.jammers = [];
        this.raids = [];
        this.emitters = [];
        this.nextId = 1;
        this.radioQ = []; this.lastRadio = -1e9;
        this.enabled = false; this.callsOn = true;
        this.ew = { page: false, sel: 0, list: [] };
        this.keysPrev = {};
        this.awacsCtl = new AwacsController(this);
        this.bull = BULLSEYE;
        this.awacsCtl.bull = this.bull;
        // the war layer asks about jamming (war.jamFactor: coverage, the player's radar, SAM fire control)
        game.war.jam = (team, from, to) => this.jamFactorFor(team, from, to);
        // BDA eyes, and aircraft on call for the strike system's air strikes
        const st = game.strikes;
        if (st) {
            st.watchers = st.watchers || [];
            st.watchers.push((pos) => this.watches(pos));
            st.airProviders = st.airProviders || [];
            st.airProviders.push((type, marks, team, quiet) => type === 'carpet' ? this.carpetStrike(marks, team, quiet) : type === 'air' ? this.reaperStrike(marks, team, quiet) : null);
        }
        game.events.on('killed', (ac, d = {}) => this.onKilled(ac, d.source));
        game.events.on('bda', (e) => this.onBDA(e));
        game.events.on('strikeRequested', (st) => this.onStrike(st));
        game.events.on('packageTasked', (f) => this.onPackage(f));
        game.events.on('strategicImpact', (m, d = {}) => this.onImpact(m, d));
        game.events.on('strategicIntercepted', (m) => { if (m.team !== game.war.side && this.enabled) this.say(this.awacsCtl.call, 'SPLASH ONE CRUISE MISSILE', { color: GREEN, say: false }); });
    }

    // ═════════════ Lifecycle ═════════════
    start(mode, opts = {}) {
        this.clear();
        const g = this.game;
        this.mode = mode;
        this.enabled = !['rings', 'practice'].includes(mode) && !g.mission && opts.airSupport !== false;
        if (!this.enabled) return;
        const war = mode === 'war' || mode === 'sandbox';
        this.warMode = war;
        // our AWACS and tanker wherever there's flying to do; the enemy's where there's a real enemy side
        this.spawnAWACS('blue');
        this.spawnTanker('blue');
        if (war || mode === 'strike' || mode === 'naval') { this.spawnAWACS('red'); this.spawnTanker('red'); }
        if (war || mode === 'strike') this.sendRecon('rc135', null, true);
        if (war) this.spawnB52();
        this.callsOn = mode !== 'freeflight';
        this.awacsCtl.reset();
        this.awacsCtl.bull = this.bull;
        // the task board (tasks.js): threats to our high-value aircraft, a lost drone
        if (g.tasks && !this.taskGen) this.taskGen = g.tasks.addGenerator((tasks) => this.offerTasks(tasks));
    }

    clear() {
        // (the game has removed every aircraft by now; the strike sources went with strikes.clear)
        this.flights.length = 0;
        for (const s of this.sessions) s.done = true;
        this.sessions.length = 0;
        this.jammers.length = 0;
        this.raids.length = 0;
        this.emitters.length = 0;
        this.radioQ.length = 0;
        this.playerSession = null;
        this.ew.page = false;
        this.enabled = false;
        this.b52 = null;
        this.pending = [];
        this.lostT = null;
    }

    // ═════════════ Radio ═════════════
    // through the director's pacing when a war runs (it gives each speaker a voice), else our own
    say(from, text, opts = {}) {
        const g = this.game, d = g.director;
        const o = { voice: this.voiceOf(from), ...opts };
        if (d && d.enabled && d.say) { d.say(from, text, o); return; }
        if (o.priority || (!this.radioQ.length && g.time - this.lastRadio > 3.2)) { this.lastRadio = g.time; g.war.radio(from, text, o); return; }
        if (this.radioQ.length >= 6) this.radioQ.shift();
        this.radioQ.push({ from, text, o, t: g.time });
    }
    flushRadio() {
        const g = this.game;
        while (this.radioQ.length && g.time - this.radioQ[0].t > (this.radioQ[0].o.ttl ?? 20)) this.radioQ.shift();
        if (this.radioQ.length && g.time - this.lastRadio > 3.2) { const q = this.radioQ.shift(); this.lastRadio = g.time; g.war.radio(q.from, q.text, q.o); }
    }
    voiceOf(from) {
        if (!from) return null;
        const k = from.split(' ')[0];
        if (VOICES[k]) return VOICES[k];
        if (/REAPER|FORTE|DRAGON|JAKE/.test(k)) return VOICES.recon;
        return null;
    }

    // ═════════════ Spawning (the API) ═════════════
    // a racetrack from an orbit spec ({ x, z, heading (deg), leg, R, alt, speed, dir }), or the default for the role
    track(role, side, orbit) {
        const o = { ...(ORBITS[role] && ORBITS[role][side] || ORBITS[role].blue), ...(orbit || {}) };
        return makeTrack({ x: o.x, z: o.z, heading: (o.heading ?? 90) * DEG, leg: o.leg, R: o.R, alt: o.alt, speed: o.speed, dir: o.dir ?? 1 });
    }

    spawnSupport(opts) {
        const f = new SupportFlight(this, opts);
        this.flights.push(f);
        return f;
    }

    // start a flight on its racetrack: at its start (or where `at` says), heading along it
    onTrack(f, T) {
        f.setTrack(T);
        return f;
    }
    trackStart(T, frac = Math.random()) {
        const s = trackLength(T) * frac;
        trackPoint(T, s, _tp, _td);
        return { pos: new THREE.Vector3(_tp.x, T.alt, _tp.z), heading: headingFor(_td.x, _td.z) };
    }

    // air.spawnAWACS(side, orbit): an E-3G (blue) / A-50U (red) on a racetrack
    spawnAWACS(side = 'blue', orbit = null) {
        const T = this.track('awacs', side, orbit);
        const st = this.trackStart(T);
        const n = this.flights.filter(f => f.role === 'awacs' && f.team === side).length;
        const call = CALLS.awacs[side][n % CALLS.awacs[side].length];
        const f = this.spawnSupport({ type: TYPES.awacs[side] || 'e3', team: side, role: 'awacs', callsign: call, pos: st.pos, heading: st.heading, speed: T.speed, alt: T.alt });
        this.onTrack(f, T);
        return f;
    }

    // air.spawnTanker(side, orbit): a KC-135R (blue: boom + wing hoses) / Il-78M (red: three hoses)
    spawnTanker(side = 'blue', orbit = null) {
        const T = this.track('tanker', side, orbit);
        const st = this.trackStart(T);
        const n = this.flights.filter(f => f.role === 'tanker' && f.team === side).length;
        const call = CALLS.tanker[side][n % CALLS.tanker[side].length];
        const f = this.spawnSupport({ type: TYPES.tanker[side] || 'kc135', team: side, role: 'tanker', callsign: call, pos: st.pos, heading: st.heading, speed: T.speed, alt: T.alt });
        f.ops = new TankerOps(f);
        this.onTrack(f, T);
        return f;
    }

    spawnB52(orbit = null) {
        if (this.b52 && this.b52.alive) return this.b52;
        const T = this.track('b52', 'blue', orbit);
        const st = this.trackStart(T);
        const f = this.spawnSupport({ type: 'b52', team: this.game.war.side, role: 'bomber', callsign: 'DOOM 1', pos: st.pos, heading: st.heading, speed: T.speed, alt: T.alt });
        f.ac.flares = 60;
        f.bombs = 36;
        const stg = this.game.strikes;
        if (stg && stg.enabled) f.launcher = stg.addSource(new AirLaunchSource(stg, f.ac, { name: 'DOOM 1 (B-52H)', team: f.team, kind: 'bomber', stock: { ...CARRIERS.b52 } }));
        this.onTrack(f, T);
        this.b52 = f;
        return f;
    }

    // our side's nearest airfield (a point at 2.5 km), or far behind the lines for theirs without one
    homeBase(team, pos) {
        const war = this.game.war;
        let best = null, bd = Infinity;
        for (const b of BASES) {
            if (b.civil || (team === war.side) !== !!b.friendly) continue;
            const d = Math.hypot(b.x - pos.x, b.z - pos.z);
            if (d < bd) { bd = d; best = b; }
        }
        if (best) return new THREE.Vector3(best.x, best.h + 2500, best.z);
        return new THREE.Vector3(pos.x, 6000, team === 'red' ? -70000 : 60000);
    }

    // air.awacs(side, onStation): the side's AWACS flight
    awacs(side = 'blue', onStation = false) {
        for (const f of this.flights) if (f.role === 'awacs' && f.team === side && f.alive && (!onStation || f.onStation)) return f;
        return null;
    }
    tankers(side) { return this.flights.filter(f => f.role === 'tanker' && f.team === side && f.alive && f.ops); }

    // ═════════════ Tankers: sessions ═════════════
    // air.requestTanker(receiver, { auto, tanker }): start air refuelling for the player's jet or an AI aircraft;
    // returns the session (refuel.js RefuelSession) or null
    requestTanker(rx = this.game.player, opts = {}) {
        const g = this.game, war = g.war;
        if (!rx || !rx.alive) return null;
        const have = this.sessions.find(s => s.rx === rx && !s.done);
        if (have) return have;
        const isPlayer = rx === g.player;
        const pc = isPlayer ? (g.callsign || 'VIPER') + ' 1' : rx.callsign;
        const rp = receiverPoint(rx);
        if (!rp) { if (isPlayer) this.say('COMMAND', 'UNABLE — THE ' + rx.spec.name.toUpperCase() + ' CAN\'T TAKE FUEL IN FLIGHT', { color: AMBER, say: false }); return null; }
        const heavy = rx.spec.category === 'bomber' || rx.spec.category === 'support';
        let tk = opts.tanker || null;
        if (!tk) {
            let bd = Infinity;
            for (const f of this.tankers(rx.team)) {
                if (!f.ops.stationFor(rp.kind, heavy) || f.threat) continue;
                const d = f.ac.pos.distanceTo(rx.pos);
                if (d < bd) { bd = d; tk = f; }
            }
        }
        if (!tk) { if (isPlayer) this.say('COMMAND', 'NO TANKER AVAILABLE FOR A ' + (rp.kind === 'boom' ? 'BOOM' : 'PROBE') + ' RECEIVER', { color: AMBER, say: 'No tanker available.' }); return null; }
        const slot = this.sessions.filter(s => s.tanker === tk && !s.done).length;
        const s = new RefuelSession(this, rx, tk, { auto: !isPlayer || !!opts.auto, ai: !isPlayer, slot, callsign: pc });
        if (!s.ok) return null;
        this.sessions.push(s);
        if (isPlayer) this.playerSession = s;
        else if (rx.pilot) {
            s.prevBrain = rx.pilot.brain;
            s.brain = { fly: (p, dt) => s.fly(dt, p.ac.controls), pick: () => null, refuel: s };
            rx.pilot.brain = s.brain;
        }
        const b = BR.braa(rx.pos, tk.ac.pos, tk.ac.vel);
        const kind = rp.kind === 'boom' ? 'BOOM' : 'DROGUE';
        if (isPlayer || !opts.quiet) {
            this.say(pc, tk.callsign + ', ' + pc + ', REQUEST AIR REFUELING, ' + kind, { color: '#8fd0ff', say: false });
            const aw = this.awacs(war.side, true);
            if (aw && isPlayer) this.say(aw.callsign, pc + ', ' + aw.callsign + ', ' + tk.callsign + ' BRAA ' + BR.pad3(b.brg) + '/' + Math.round(b.rng) + ', ' + BR.angels(tk.ac.pos.y * M_TO_FT), { color: '#9fd4ff', say: BR.speakable(pc + ', ' + aw.callsign + ', ' + tk.callsign + ' bra ' + BR.pad3(b.brg) + '/' + Math.round(b.rng) + ', ' + BR.angels(tk.ac.pos.y * M_TO_FT)) });
            const trk = Math.round(BR.trackDeg(tk.ac.vel));
            this.say(tk.callsign, pc + ', ' + tk.callsign + ', ' + BR.angels(tk.ac.pos.y * M_TO_FT) + ', TRACK ' + BR.pad3(trk) + ', ' + Math.round(arSpeed(tk.type, rx.spec, tk.ac.pos.y) * Math.sqrt(airDensity(tk.ac.pos.y)) / KT) + ' KNOTS — ' + (s.station === 'boom' ? 'BOOM' : ({ l: 'LEFT', r: 'RIGHT', c: 'CENTRE' })[s.station] + ' HOSE') + ', CLEARED TO RENDEZVOUS', { color: '#9fd4ff', say: pc.toLowerCase() + ', ' + tk.callsign.toLowerCase() + ', cleared to rendezvous' });
        }
        // the player's wingmen come along and take their turn
        if (isPlayer && g.wingmen && g.wingmen.active) for (const w of g.wingmen.active) if (w.ac && w.ac.alive && receiverPoint(w.ac) && (!w.brain || w.brain.order === 'cover')) this.requestTanker(w.ac, { quiet: true });
        g.events.emit('tankerRequested', rx, { session: s, tanker: tk });
        return s;
    }

    endSession(s) {
        const rx = s.rx;
        if (s.brain && rx.pilot && rx.pilot.brain === s.brain) rx.pilot.brain = s.prevBrain || null;
        if (rx.pilot) { rx.pilot.target = null; rx.pilot.thinkT = 0; }
        if (s === this.playerSession) this.playerSession = null;
    }

    // ═════════════ Recon ═════════════
    // air.sendRecon(kind, area): 'mq9' | 'rq4' | 'u2' | 'rc135' to an area { x, z, r } (or a unit / mark / Vector3);
    // an existing one of that kind is re-tasked. Returns the flight.
    sendRecon(kind, area = null, quiet = false) {
        const g = this.game, war = g.war;
        const R = RECON[kind];
        if (!R) return null;
        const A = this.areaOf(area) || this.defaultArea();
        let f = this.flights.find(x => x.role === 'recon' && x.kind === kind && x.alive);
        if (!f) {
            if (kind === 'rc135') {
                const T = this.track('rc135', 'blue', area ? { x: A.x, z: A.z + 22000 } : null);
                const st = this.trackStart(T, 0.1);
                f = this.spawnSupport({ type: 'rc135', team: war.side, role: 'recon', kind, callsign: 'JAKE 11', pos: st.pos, heading: st.heading, speed: T.speed, alt: T.alt });
                this.onTrack(f, T);
                f.sig = new Map();
                if (!quiet) this.say('JAKE 11', 'ON STATION, LISTENING', { color: '#9fd4ff', say: 'Jake one one, on station.' });
                return f;
            }
            // up from our side: a way back from the area, toward the nearest friendly field
            const base = this.homeBase(war.side, A);
            const dx = base.x - A.x, dz = base.z - A.z, L = Math.hypot(dx, dz) || 1;
            const lead = Math.min(R.lead, L * 0.8);
            const pos = new THREE.Vector3(A.x + dx / L * lead, 0, A.z + dz / L * lead);
            const alt = Math.max(R.alt, groundHeight(pos.x, pos.z) + R.agl);
            pos.y = alt;
            // (not the player's own callsign: VIPER, REAPER… are the player's)
            const call = R.callsign === g.callsign ? (kind === 'mq9' ? 'SHADOW' : 'HAWKEYE') : R.callsign;
            f = this.spawnSupport({ type: kind, team: war.side, role: 'recon', kind, callsign: call + ' 1', pos, heading: headingFor(-dx, -dz), speed: R.speed, alt });
            f.seen = new Map();
            if (kind === 'mq9') { f.hellfires = R.hellfires; const st = g.strikes; if (st && st.enabled) f.launcher = st.addSource(new AirLaunchSource(st, f.ac, { name: f.callsign + ' (MQ-9A)', team: f.team, kind: 'drone', stock: { hellfire: R.hellfires }, range: 12000 })); }
        }
        this.taskRecon(f, A, quiet);
        return f;
    }

    taskRecon(f, A, quiet = false) {
        const g = this.game, war = g.war, R = RECON[f.kind];
        f.area = { x: A.x, z: A.z, r: A.r || R.sensor.area || 3000 };
        f.onArea = false; f.arriveT = null; f.imaged = false;
        const alt = Math.max(R.alt, groundHeight(A.x, A.z) + R.agl);
        if (f.kind === 'u2') {
            // a photo run straight across the area, from where it is
            const dx = A.x - f.ac.pos.x, dz = A.z - f.ac.pos.z, L = Math.hypot(dx, dz) || 1;
            const a = new THREE.Vector3(A.x - dx / L * R.run, 0, A.z - dz / L * R.run), b = new THREE.Vector3(A.x + dx / L * R.run, 0, A.z + dz / L * R.run);
            f.setRun(a, b, alt, R.speed, () => this.u2Done(f));
            f.run = { a, b, shots: new Set(), done: false };
        } else f.setGoto(A, alt, R.speed * 1.1, () => { f.setOrbit(A, R.orbitR, alt, R.speed, 1); f.onArea = true; f.arriveT = war.time; this.say(f.callsign, 'ON STATION, GRID ' + war.grid(A.x, A.z) + (f.kind === 'mq9' ? ', ' + f.hellfires + ' HELLFIRES' : ''), { color: '#9fd4ff', say: f.callsign.toLowerCase() + ', on station.' }); });
        const eta = Math.round(Math.hypot(A.x - f.ac.pos.x, A.z - f.ac.pos.z) / (R.speed * 1.1) / 60);
        if (!quiet) this.say(f.callsign, 'COPY, ' + (f.kind === 'u2' ? 'PHOTO RUN OVER' : 'EN ROUTE TO') + ' GRID ' + war.grid(A.x, A.z) + ', ' + Math.max(1, eta) + ' MIN', { color: '#9fd4ff', say: f.callsign.toLowerCase() + ', copy, en route, ' + Math.max(1, eta) + ' minutes.' });
        f.stayUntil = war.time + (R.stay || 1e9);
    }

    // an area from a point / unit / mark / report / { x, z, r }
    areaOf(a) {
        if (!a) return null;
        if (a.center) return { x: a.center.x, z: a.center.z, r: a.radius || 3000 };           // an intel report
        if (a.unit && a.unit.pos) return { x: a.unit.pos.x, z: a.unit.pos.z, r: 2500 };       // a mark on a unit
        if (a.fixed) return { x: a.fixed.x, z: a.fixed.z, r: 2500 };                          // a mark on a point
        if (a.pos) return { x: a.pos.x, z: a.pos.z, r: a.r || 2500 };
        if (a.x != null && a.z != null) return { x: a.x, z: a.z, r: a.r || 3000 };
        return null;
    }
    // where recon goes when not told: the newest open search area, the newest mark, the steerpoint, ahead of us
    defaultArea() {
        const g = this.game, war = g.war;
        const rp = [...war.reports].reverse().find(r => !r.resolved);
        if (rp) return this.areaOf(rp);
        const d = war.designations[war.designations.length - 1];
        if (d) return this.areaOf(d.unit ? { unit: d.unit } : { pos: d.fixed || d.pos });
        if (g.navTarget && g.navTarget.pos) return this.areaOf({ pos: g.navTarget.pos });
        const p = g.player && g.player.alive ? g.player : null;
        if (p) { const f = p.getForward(_v); return { x: p.pos.x + f.x * 12000, z: p.pos.z + f.z * 12000, r: 4000 }; }
        return { x: 0, z: -15000, r: 5000 };
    }
    areaLabel() {
        const g = this.game, war = g.war;
        const rp = [...war.reports].reverse().find(r => !r.resolved);
        if (rp) return 'SEARCH AREA ' + war.grid(rp.center.x, rp.center.z).slice(0, 2);
        const d = war.designations[war.designations.length - 1];
        if (d) return 'MARK ' + d.id;
        if (g.navTarget && g.navTarget.pos) return 'STEERPOINT';
        return '12 KM AHEAD';
    }

    // ═════════════ EW: jamming ═════════════
    // air.jam(ac, on, sector): switch an aircraft's jammer on or off; sector { brg (deg, true) | at (a point or
    // unit to point at), half (deg) }. A jammer is made for it if it has none (a Growler's ALQ-99, else a
    // self-protection set). Returns the jammer.
    jam(ac, on = true, sector = null) {
        if (!ac) return null;
        let j = this.jammers.find(x => x.ac === ac);
        if (!j) { j = new Jammer(ac, ac.type === 'ea18g' ? 'alq99' : SELF_JAM[ac.type] || 'khibiny', ac.team, false); this.jammers.push(j); }
        j.on = !!on;
        j.auto = false;
        if (sector) {
            if (sector.at) { const p = sector.at.pos || sector.at; j.brg = bearingRad(ac.pos, p); j.at = sector.at; }
            else if (sector.brg != null) { j.brg = sector.brg * DEG; j.at = null; }
            if (sector.half != null) j.half = sector.half * DEG;
        }
        return j;
    }

    // the share of its range a `team` radar at `from` keeps against `to` through the other side's jammers
    jamFactorFor(team, from, to) {
        let jn = 0;
        for (const j of this.jammers) { if (!j.on || j.team === team || !j.alive) continue; jn += jamToNoise(from, to, j); }
        return jn > 0 ? Math.max(JAM_FLOOR, (1 + jn) ** -0.25) : 1;
    }

    updateJammers(dt) {
        const g = this.game, war = g.war;
        // enemy self-protection sets: on when one of ours is close, pointed at the nearest
        this.jamScanT = (this.jamScanT || 0) - dt;
        if (this.jamScanT <= 0) {
            this.jamScanT = 1;
            for (const a of g.aircraft) if (a.alive && a.team !== war.side && SELF_JAM[a.type] && !this.jammers.some(j => j.ac === a)) this.jammers.push(new Jammer(a, SELF_JAM[a.type], a.team, true));
            for (let i = this.jammers.length - 1; i >= 0; i--) if (!this.jammers[i].ac.alive || this.jammers[i].ac.removed) this.jammers.splice(i, 1);
            for (const j of this.jammers) {
                if (!j.auto || j.standoff) continue;
                let best = null, bd = 42000;
                for (const a of g.aircraft) {
                    if (!a.alive || a.team === j.team || a.onGround || a.spec.category !== 'fighter') continue;
                    const d = a.pos.distanceTo(j.ac.pos);
                    if (d < bd) { bd = d; best = a; }
                }
                j.on = !!best;
                if (best) j.brg = bearingRad(j.ac.pos, best.pos);
            }
        }
        // pointed at a unit or a point: keep the bearing on it
        for (const j of this.jammers) if (j.at && j.on) { const p = j.at.pos || j.at; if (j.at.alive === false) j.at = null; else j.brg = bearingRad(j.ac.pos, p); }
    }

    // ═════════════ Emitters (SIGINT, the EW page, HARM) ═════════════
    updateEmitters() {
        const war = this.game.war;
        this.emitters.length = 0;
        for (const u of war.units) {
            if (!u.alive || u.team === war.side || u.team === 'neutral') continue;
            const rec = war.recs.get(u);
            const em = emitterOf(u, rec);
            if (em) this.emitters.push({ u, rec, em });
        }
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.enabled) return;
        const g = this.game;
        if (g.state === 'menu' || g.state === 'over') return;
        this.flushRadio();
        this.emT = (this.emT || 0) - dt;
        if (this.emT <= 0) { this.emT = 1; this.updateEmitters(); }
        for (let i = this.flights.length - 1; i >= 0; i--) {
            const f = this.flights[i];
            f.t += dt;
            if (!f.dead && !f.ac.alive) this.flightLost(f);
            if (f.ac.exploded || f.ac.removed) { this.flights.splice(i, 1); continue; }
            if (!f.ac.alive) continue;
            f.updateLod();
            this.threatCheck(f, dt);
            if (f.task && f.task.kind === 'land') this.landIfUnseen(f);
        }
        for (let i = this.sessions.length - 1; i >= 0; i--) {
            const s = this.sessions[i];
            s.update(dt);
            if (s.done) { this.endSession(s); this.sessions.splice(i, 1); }
        }
        const wx = g.world.weather;
        for (const f of this.flights) {
            if (f.ops && f.ac.alive) { f.ops.update(dt, wx); this.stretchCheck(f); }
            if (f.role === 'recon' && f.ac.alive) this.updateRecon(f, dt);
            if (f.role === 'ew' && f.ac.alive) this.updateGrowler(f, dt);
        }
        this.awacsCtl.update(dt);
        this.updateJammers(dt);
        this.updateRaids(dt);
        this.updateStrikes(dt);
        this.updatePlayer(dt);
        this.pollKeys();
        this.lostCheck(dt);
    }

    // the tanker holds its leg while a receiver is on the boom or a hose (it'd turn back onto its track after)
    stretchCheck(f) {
        const busy = this.sessions.some(s => s.tanker === f && !s.done && (s.state === 'precontact' || s.state === 'contact' || s.state === 'breakaway'));
        const t = f.task;
        if (!t || t.kind !== 'track') return;
        if (busy && !f.stretch) {
            // only on a straight leg
            const T = t.T, s = ((f.s % trackLength(T)) + trackLength(T)) % trackLength(T);
            const onLeg = s < T.leg || (s > T.leg + Math.PI * T.R && s < 2 * T.leg + Math.PI * T.R);
            if (onLeg) { trackPoint(T, s, _tp, _td); f.stretch = { x: f.ac.pos.x, z: f.ac.pos.z, dx: _td.x, dz: _td.z, t: 0 }; }
        } else if (f.stretch) {
            f.stretch.t += this.game.time - (f.stretch.last ?? this.game.time);
            f.stretch.last = this.game.time;
            if (!busy || f.stretch.t > 300) { f.stretch = null; f.s = trackNearest(t.T, f.ac.pos.x, f.ac.pos.z); }
        }
    }

    // bandits closing on one of our support aircraft: it runs for home, and says so
    threatCheck(f, dt) {
        const g = this.game, war = g.war;
        f.thrT = (f.thrT || 0) - dt;
        if (f.thrT > 0) return;
        f.thrT = 1;
        // (the Growler fights, bombers on a run and raiders press on)
        if (f.role === 'ew' || f.role === 'raid' || (f.role === 'bomber' && f.task && f.task.kind === 'strike')) return;
        // a threat: a bandit that's after it (its pilot's target), or one close and pointing at it (a tanker with
        // receivers on it only runs from one that's after it)
        const R = f.role === 'awacs' || f.role === 'tanker' ? 30000 : 18000;
        const tanking = f.ops && this.sessions.some(s => s.tanker === f && !s.done && s.state !== 'rendezvous');
        let best = null, bd = Infinity;
        for (const a of g.aircraft) {
            if (!a.alive || a.team === f.team || a.onGround || a.abandoned || a.spec.category !== 'fighter') continue;
            const d = a.pos.distanceTo(f.ac.pos);
            if (d > R) continue;
            const after = a.pilot && a.pilot.target === f.ac;
            const hot = !tanking && BR.aspectAngle(f.ac.pos, a.pos, a.vel) < 45 && d < R * 0.6;
            if ((after || hot) && d < bd) { bd = d; best = a; }
        }
        if (best && !f.threat) {
            f.threat = best; f.clearT = 0;
            f.saved = f.task;
            f.task = { kind: 'retro', from: best.pos.clone() };
            if (f.team === war.side) {
                const b = BR.braa(f.ac.pos, best.pos, best.vel);
                this.say(f.callsign, (f.role === 'awacs' ? 'DEFENSIVE, RETROGRADING — BANDIT ' : 'BANDIT ON US, BUGGING OUT — ') + 'BRAA ' + BR.pad3(b.brg) + '/' + Math.round(b.rng), { color: '#ff9f5a', say: f.callsign.toLowerCase() + ', ' + (f.role === 'awacs' ? 'defensive, retrograding.' : 'bandit on us, bugging out.'), priority: f.role === 'awacs' });
                g.events.emit('supportThreatened', f, { threat: best });
            }
        } else if (f.threat) {
            const d = f.threat.alive ? f.threat.pos.distanceTo(f.ac.pos) : Infinity;
            if (!best && d > 40000) f.clearT += 1; else f.clearT = 0;
            if (f.clearT > 15 || !f.threat.alive) {
                f.threat = null;
                f.task = f.saved && f.saved.kind === 'track' ? null : f.saved;
                if (f.saved && f.saved.kind === 'track') f.setTrack(f.saved.T);
                if (!f.task) this.defaultTask(f);
                if (f.team === war.side) this.say(f.callsign, 'BACK ON STATION', { color: '#9fd4ff', say: false });
            }
        }
    }

    // back to what a flight of its kind does when it's got nothing else: its orbit, or home
    defaultTask(f) {
        const orbit = f.role === 'awacs' || f.role === 'tanker' ? f.role : f.kind === 'rc135' ? 'rc135' : f.role === 'bomber' ? 'b52' : f.role === 'ew' ? 'ew' : null;
        if (orbit && ORBITS[orbit][f.team]) f.setTrack(this.track(orbit, f.team));
        else f.rtb();
    }

    // home, and nobody's watching: it lands (the jet goes)
    landIfUnseen(f) {
        const g = this.game, ac = f.ac;
        if (!f.home || Math.hypot(ac.pos.x - f.home.x, ac.pos.z - f.home.z) > 3000) return;
        if (ac.pos.distanceTo(g.camera.position) < 6000) return;
        this.removeFlight(f);
    }
    removeFlight(f) {
        const g = this.game, ac = f.ac;
        if (f.launcher && g.strikes) g.strikes.removeSource(f.launcher);
        ac.remove();
        const i = g.aircraft.indexOf(ac);
        if (i >= 0) g.aircraft.splice(i, 1);
        ac.removed = true;
        f.dead = true;
    }

    flightLost(f) {
        const g = this.game, war = g.war;
        f.dead = true;
        if (f.launcher && g.strikes) g.strikes.removeSource(f.launcher);
        if (f.team !== war.side) {
            if (f.role === 'awacs') this.say(this.awacsCtl.call, 'SPLASH THE MAINSTAY — THEIR AIR PICTURE IS DOWN', { color: GREEN, say: 'Splash the Mainstay.' });
            else if (f.role === 'tanker') this.say(this.awacsCtl.call, 'SPLASH THE ENEMY TANKER', { color: GREEN, say: false });
            return;
        }
        if (f.role === 'awacs') {
            this.say('COMMAND', f.callsign + ' IS DOWN — WE\'VE LOST THE AIR PICTURE', { color: '#ff4a3d', say: f.callsign.toLowerCase() + ' is down. We have lost the air picture.', priority: true });
            if (this.warMode) this.pending.push({ t: war.time + 360, run: () => { const n = this.spawnAWACS('blue'); this.say(n.callsign, 'ON STATION — PICTURE TO FOLLOW', { color: '#9fd4ff', say: n.callsign.toLowerCase() + ', on station.' }); } });
        } else if (f.role === 'tanker') {
            this.say('COMMAND', f.callsign + ' IS DOWN', { color: '#ff4a3d', say: false, priority: true });
            if (this.warMode) this.pending.push({ t: war.time + 300, run: () => { const n = this.spawnTanker('blue'); this.say(n.callsign, 'ON STATION, TRACK ANCHOR', { color: '#9fd4ff', say: false }); } });
        } else if (f.role === 'recon') {
            this.say(f.callsign, f.kind === 'mq9' || f.kind === 'rq4' ? 'LINK LOST — THE AIRCRAFT IS DOWN' : 'MAYDAY, MAYDAY', { color: '#ff4a3d', say: false });
            if (f.area) this.lostRecon = { f, area: { ...f.area }, t: war.time };
        } else this.say('COMMAND', f.callsign + ' IS DOWN', { color: '#ff4a3d', say: false });
    }

    lostCheck() {
        const war = this.game.war;
        for (let i = this.pending.length - 1; i >= 0; i--) if (war.time >= this.pending[i].t) { const p = this.pending.splice(i, 1)[0]; p.run(); }
    }

    // ═════════════ The player: AR autopilot, HARMs, fuel ═════════════
    updatePlayer() {
        const g = this.game, p = g.player;
        if (!p || !p.alive) return;
        if (p.type === 'ea18g') {
            if (p.harms == null) p.harms = 2;
            if (!this.jammers.some(j => j.ac === p)) { const j = new Jammer(p, 'alq99', p.team, false); j.brg = headingOf(p); this.jammers.push(j); }
            if (p.onGround && g.rearmT > 4) p.harms = 2;
        }
    }

    // the AR autopilot flies the player's jet (the stick takes it back)
    flyJet(dt, p, s, mouse) {
        const S = this.playerSession;
        if (!S || S.done || S.rx !== p || !S.auto) return;
        const g = this.game;
        const moved = s.manual || (g.settings.controlMode !== 'keyboard' && Math.abs(mouse.dx) + Math.abs(mouse.dy) > 3);
        if (moved && S.state !== 'rendezvous') { this.arAuto(false, 'AR AUTOPILOT OFF — YOU HAVE CONTROL'); return; }
        if (moved && S.state === 'rendezvous') { this.arAuto(false, 'AR AUTOPILOT OFF'); return; }
        S.fly(dt, p.controls);
    }

    arAuto(on, msg) {
        const g = this.game, S = this.playerSession;
        if (!S) return;
        S.auto = on;
        if (!on) { const p = g.player; if (p) g.aimDir.copy(p.vel).normalize(); }
        if (g.autopilot && g.autopilot.active && on) g.autopilot.disengage();
        g.addFeed(msg || (on ? 'AR AUTOPILOT ON — IT FLIES THE JOIN AND THE CONTACT (STICK TO TAKE OVER)' : 'AR AUTOPILOT OFF'), on ? GREEN : AMBER);
    }

    onAction(a) {
        if (!this.enabled || this.game.state !== 'playing') return false;
        const g = this.game, p = g.player;
        if (a === 'autoland' && this.playerSession && !this.playerSession.done && p && !g.pilotMode) { this.arAuto(!this.playerSession.auto); return true; }
        if (a === 'missile' && this.ew.page && p && p.type === 'ea18g' && !g.pilotMode) { this.fireHarm(p); return true; }
        return false;
    }

    // ═════════════ The player's Growler: the EW page ═════════════
    // F4: the page; with it up [ / ] pick a threat, ; jammer on/off, ' point the pods at the threat (again: along the
    // nose), M a HARM at it
    pollKeys() {
        const g = this.game, inp = g.input, p = g.player;
        if (!inp || !p || !p.alive || g.pilotMode || g.state !== 'playing') return;
        const edge = (code) => { const d = inp.down(code), was = this.keysPrev[code]; this.keysPrev[code] = d; return d && !was; };
        if (edge('F4') && p.type === 'ea18g') { this.ew.page = !this.ew.page; g.audio.tick(this.ew.page ? 1200 : 700, 0.06, 0.05); }
        if (!this.ew.page || p.type !== 'ea18g') { this.ew.page = this.ew.page && p.type === 'ea18g'; return; }
        this.ewList(p);
        const n = this.ew.list.length;
        if (edge('BracketRight') && n) { this.ew.sel = (this.ew.sel + 1) % n; g.audio.tick(1400, 0.04, 0.04); }
        if (edge('BracketLeft') && n) { this.ew.sel = (this.ew.sel - 1 + n) % n; g.audio.tick(1400, 0.04, 0.04); }
        if (edge('Semicolon')) this.playerJam(!this.playerJammer(p).on);
        if (edge('Quote')) this.aimJammer(p);
    }
    playerJammer(p) { return this.jammers.find(j => j.ac === p) || this.jam(p, false); }
    playerJam(on) {
        const g = this.game, p = g.player;
        const j = this.playerJammer(p);
        j.on = on; j.auto = false;
        g.addFeed('ALQ-99 ' + (on ? 'JAMMING — SECTOR ' + BR.pad3(((j.brg / DEG) + 360) % 360) + ' ±' + Math.round(j.half / DEG) + '°' : 'STANDBY'), on ? GREEN : AMBER);
        g.audio.tick(on ? 1500 : 600, 0.08, 0.05);
    }
    // the pods at the selected threat; pressed again (or with none): along the nose
    aimJammer(p) {
        const g = this.game, j = this.playerJammer(p);
        const e = this.ew.list[this.ew.sel];
        if (e && j.at !== e.u) { j.at = e.u; j.brg = bearingRad(p.pos, e.u.pos); g.addFeed('ALQ-99 → ' + e.em.name, GREEN); }
        else { j.at = null; j.brg = headingOf(p); g.addFeed('ALQ-99 → ALONG THE NOSE ' + BR.pad3(((j.brg / DEG) + 360) % 360), GREEN); }
        if (!j.on) this.playerJam(true);
    }
    // what the Growler's receivers hear (ALQ-218): emitters in range with a line of sight, nearest first
    ewList(p) {
        const war = this.game.war;
        this.ew.listT = (this.ew.listT || 0) - 1;
        if (this.ew.listT > 0 && this.ew.list.length) return this.ew.list;
        this.ew.listT = 20;
        const sel = this.ew.list[this.ew.sel] ? this.ew.list[this.ew.sel].u : null;
        const out = [];
        for (const e of this.emitters) {
            const d = e.u.pos.distanceTo(p.pos);
            if (d > e.em.power || !sigintHears(p.pos, e.em, e.u.pos, terrainHeight, (a, b) => war.radarLOS(a, b))) continue;
            // (and it becomes a contact on the map: the Growler knows where it is)
            if (war.known(e.u) < INTEL.CONTACT) war.reveal(e.u, INTEL.CONTACT, 'elint', true);
            out.push({ u: e.u, em: e.em, d });
        }
        out.sort((a, b) => a.d - b.d);
        this.ew.list = out.slice(0, 8);
        const k = sel ? this.ew.list.findIndex(x => x.u === sel) : -1;
        this.ew.sel = k >= 0 ? k : Math.min(this.ew.sel, Math.max(0, this.ew.list.length - 1));
        return this.ew.list;
    }
    fireHarm(p) {
        const g = this.game;
        const e = this.ew.list[this.ew.sel];
        if (!(p.harms > 0)) { g.addFeed('NO HARMS LEFT', AMBER); g.audio.tick(200, 0.1, 0.1); return; }
        if (!e) { g.addFeed('HARM: NO EMITTER SELECTED ( [ / ] )', AMBER); return; }
        const shot = harmShot(p.pos, p.getForward(_v), e.u.pos, emitterOf(e.u, g.war.rec(e.u)));
        if (!shot.ok) { g.addFeed('HARM: ' + shot.why, AMBER); g.audio.tick(250, 0.1, 0.08); return; }
        g.weapons.fireMissile(p, e.u, 'arm');
        p.harms--;
        this.say((g.callsign || 'VIPER') + ' 1', 'MAGNUM, ' + e.em.name, { color: '#8fd0ff', say: 'magnum', priority: true });
    }

    // ═════════════ Growlers (AI) ═════════════
    // air.sendGrowler(escortOf | point): up from our side, escorting a jet / flight, or standing off a point
    sendGrowler(what = null) {
        const g = this.game, war = g.war;
        let f = this.flights.find(x => x.role === 'ew' && x.alive);
        if (!f) {
            const T = this.track('ew', 'blue');
            const st = this.trackStart(T, 0.3);
            f = this.spawnSupport({ type: 'ea18g', team: war.side, role: 'ew', callsign: 'ZAPPER 1', pos: st.pos, heading: st.heading, speed: T.speed, alt: T.alt, skill: 0.8 });
            f.ac.harms = 2; f.ac.missiles = 2;
            f.jammer = new Jammer(f.ac, 'alq99', f.team, true);
            this.jammers.push(f.jammer);
            this.onTrack(f, T);
        }
        if (what && (what.getForward || what.members || what.types)) { f.escortee = what; f.setEscort(what, new THREE.Vector3(2500, 600, 6000), () => this.growlerHome(f)); }
        else if (what) { const A = this.areaOf(what); f.escortee = null; f.standoffAt = new THREE.Vector3(A.x, 0, A.z); this.growlerStandoff(f); }
        return f;
    }
    growlerStandoff(f) {
        const A = f.standoffAt, P = f.ac.pos;
        const dx = P.x - A.x, dz = P.z - A.z, L = Math.hypot(dx, dz) || 1;
        const c = new THREE.Vector3(A.x + dx / L * 26000, 0, A.z + dz / L * 26000);
        f.setOrbit(c, 5000, Math.max(7000, groundHeight(c.x, c.z) + 3000), 215, 1);
    }
    growlerHome(f) { const T = this.track('ew', 'blue'); f.setTrack(T); f.escortee = null; }

    // what it jams (the most threatening emitter for whoever it protects) and when it fires a HARM
    updateGrowler(f, dt) {
        const g = this.game, war = g.war, j = f.jammer;
        if (!j) return;
        f.ewT = (f.ewT || 0) - dt;
        if (f.ewT > 0) return;
        f.ewT = 1;
        const E = f.escortee && f.escortee.alive !== false && !f.escortee.done ? f.escortee : null;
        const focus = E ? E.pos : f.standoffAt || null;
        if (!focus) { j.on = false; return; }
        // the threats round the protected one: radars that can see it, SAM trackers first
        let best = null, bs = -Infinity;
        for (const e of this.emitters) {
            const d = e.u.pos.distanceTo(focus);
            if (d > (e.em.kind === 'search' ? 90000 : 40000)) continue;
            const s = (e.em.hot ? 3 : 1) - d / 30000;
            if (s > bs) { bs = s; best = e; }
        }
        if (best) {
            j.on = true; j.at = best.u; j.brg = bearingRad(f.ac.pos, best.u.pos);
            j.half = 40 * DEG;
            if (!f.jamCalled || f.jamCalled !== best.u) { f.jamCalled = best.u; this.say(f.callsign, 'MUSIC ON, JAMMING ' + best.em.name, { color: '#9fd4ff', say: f.callsign.toLowerCase() + ', music on.' }); }
            // a HARM at a fire-control radar in reach, nose roughly on
            const shot = harmShot(f.ac.pos, f.ac.getForward(_v), best.u.pos, best.em);
            if (best.em.hot && f.ac.harms > 0 && shot.ok && war.time - (f.harmT || -1e9) > 20 && !best.u.incoming.some(m => m.kind === 'arm')) {
                f.harmT = war.time;
                g.weapons.fireMissile(f.ac, best.u, 'arm');
                f.ac.harms--;
                this.say(f.callsign, 'MAGNUM, ' + best.em.name, { color: '#9fd4ff', say: f.callsign.toLowerCase() + ', magnum.' });
            }
        } else { j.on = false; j.at = null; }
    }

    // a strike is going in: the Growler goes with it
    onStrike(st) {
        if (!this.enabled || !st || st.team !== this.game.war.side) return;
        if (st.type === 'air' && st.jets && st.jets[0]) this.sendGrowler(st.jets[0]);
        else if ((st.type === 'standoff' || st.type === 'carpet') && st.aims[0]) this.sendGrowler({ pos: st.aims[0].pos });
    }
    onPackage(f) { if (this.enabled && f && f.team === this.game.war.side) this.sendGrowler(f); }

    // ═════════════ Recon: sensors, reports, pictures ═════════════
    updateRecon(f, dt) {
        const g = this.game, war = g.war, R = RECON[f.kind];
        if (f.kind === 'rc135') { this.updateSigint(f, dt); return; }
        // time up: home
        if (f.stayUntil && war.time > f.stayUntil && f.task && f.task.kind === 'orbit') { this.say(f.callsign, 'BINGO, RTB', { color: '#9fd4ff', say: false }); f.rtb(); f.area = null; return; }
        if (!f.area) return;
        f.scanT = (f.scanT || 0) - dt;
        if (f.scanT > 0) return;
        f.scanT = 0.5;
        const P = f.ac.pos;
        const units = war.units, n = units.length;
        if (!n) return;
        if (f.kind === 'u2') { this.u2Scan(f); return; }
        const A = f.area;
        // (the drone's sensor operator works the search area: a slice of the war's units each look)
        const per = Math.min(n, 40);
        for (let k = 0; k < per; k++) {
            f.scanI = ((f.scanI || 0) + 1) % n;
            const u = units[f.scanI];
            if (!u.alive || u.team === war.side || u.team === 'neutral') continue;
            const rec = war.recs.get(u);
            if (!rec || rec.cls === 'aircraft' || rec.cls === 'helicopter' || rec.known >= INTEL.CONFIRMED) continue;
            if (Math.hypot(u.pos.x - A.x, u.pos.z - A.z) > A.r + 2500) continue;
            const d = u.pos.distanceTo(P);
            const need = reconDwell(f.kind, d, u, rec);
            if (!need) continue;
            if (!war.lineOfSight(P, _v.copy(u.pos).setY(u.pos.y + 3))) continue;
            if (R.sensor.clouds && g.sensors && g.sensors.transmittance && g.sensors.transmittance(P, u.pos) < 0.3) continue;
            const s = f.seen.get(u) || 0;
            const t = s + 0.5 * (per / Math.min(n, per)) * (n / per);
            f.seen.set(u, t);
            const lvl = need.confirm && t >= need.confirm ? INTEL.CONFIRMED : need.ident && t >= need.ident ? INTEL.IDENTIFIED : t >= need.contact ? INTEL.CONTACT : 0;
            if (lvl > rec.known) {
                war.reveal(u, lvl, 'recon', true);
                (f.found || (f.found = [])).push({ u, lvl });
            }
        }
        // a report every ten seconds when there's news
        f.repT = (f.repT || 0) - 0.5;
        if (f.repT <= 0 && f.found && f.found.length) {
            f.repT = 10;
            const ids = f.found.filter(x => x.lvl >= INTEL.IDENTIFIED), nc = f.found.length - ids.length;
            const names = [...new Set(ids.map(x => war.label(x.u)))].slice(0, 3);
            this.say(f.callsign, 'EYES ON — ' + (nc ? nc + ' NEW CONTACT' + (nc > 1 ? 'S' : '') : '') + (nc && ids.length ? ', ' : '') + (ids.length ? ids.length + ' IDENTIFIED: ' + names.join(', ') : '') + ' — GRID ' + war.grid(A.x, A.z), { color: '#ffd24a', say: f.callsign.toLowerCase() + ', eyes on. ' + (ids.length ? ids.length + ' identified.' : nc + ' new contacts.') });
            g.events.emit('reconReport', f, { found: f.found.slice() });
            f.found.length = 0;
        }
        // the first picture of the area, a while after arriving
        if (f.onArea && !f.imaged && war.time - (f.arriveT ?? war.time) > 14) { f.imaged = true; this.takeImage(f, { x: A.x, y: 0, z: A.z }, null); }
    }

    // U-2: everything in the swath of the photo leg (and not under cloud), identified once processed
    u2Scan(f) {
        const g = this.game, war = g.war, R = RECON.u2, run = f.run;
        if (!run || run.done || !f.task || f.task.kind !== 'run' || f.task.leg !== 1) return;
        const P = f.ac.pos;
        for (const u of war.units) {
            if (!u.alive || u.team === war.side || u.team === 'neutral' || run.shots.has(u)) continue;
            const rec = war.recs.get(u);
            if (!rec || rec.cls === 'aircraft' || rec.cls === 'helicopter') continue;
            if (Math.hypot(u.pos.x - P.x, u.pos.z - P.z) > R.swath || !inSwath(u.pos, run.a, run.b, R.swath)) continue;
            if (g.sensors && g.sensors.transmittance && g.sensors.transmittance(P, u.pos) < 0.3) continue;
            run.shots.add(u);
        }
    }
    u2Done(f) {
        const g = this.game, war = g.war, run = f.run;
        if (!run || run.done) return;
        run.done = true;
        this.say(f.callsign, 'PHOTO RUN COMPLETE — IMAGERY TO FOLLOW', { color: '#9fd4ff', say: false });
        const A = f.area ? { ...f.area } : null;
        this.pending.push({ t: war.time + RECON.u2.sensor.process, run: () => {
            let n = 0;
            for (const u of run.shots) { if (u.alive && war.known(u) < INTEL.IDENTIFIED) { war.reveal(u, INTEL.IDENTIFIED, 'recon', true); n++; } }
            this.say(f.callsign, 'IMAGERY PROCESSED — ' + (n ? n + ' TARGETS IDENTIFIED' : 'NOTHING NEW') + (A ? ', GRID ' + war.grid(A.x, A.z) : '') + ' — SEE THE MAP', { color: '#ffd24a', say: 'Imagery processed. ' + n + ' targets identified.' });
            if (A) this.takeImage(f, { x: A.x, y: 0, z: A.z }, null);
            g.events.emit('reconReport', f, { found: [...run.shots] });
        } });
        f.area = null;
        f.rtb();
    }

    // RC-135: radar emitters by their emissions — a fix (CONTACT) after a few seconds, identified after longer
    updateSigint(f, dt) {
        const g = this.game, war = g.war;
        f.sigT = (f.sigT || 0) - dt;
        if (f.sigT > 0) return;
        f.sigT = 0.5;
        const P = f.ac.pos;
        for (const e of this.emitters) {
            const u = e.u, rec = e.rec;
            if (!rec || rec.known >= INTEL.IDENTIFIED) continue;
            if (!sigintHears(P, e.em, u.pos, terrainHeight, (a, b) => war.radarLOS(a, b))) continue;
            const d = u.pos.distanceTo(P);
            const need = sigintDwell(e.em, d);
            let s = f.sig.get(u);
            if (!s) { s = { t: 0, ox: rand(-1, 1), oz: rand(-1, 1) }; f.sig.set(u, s); }
            s.t += 0.5;
            if (s.t >= need.ident && rec.known < INTEL.IDENTIFIED) {
                war.reveal(u, INTEL.IDENTIFIED, 'sigint', true);
                (f.found || (f.found = [])).push({ u, em: e.em, id: true });
            } else if (s.t >= need.fix) {
                if (rec.known < INTEL.CONTACT) { war.reveal(u, INTEL.CONTACT, 'sigint', true); (f.found || (f.found = [])).push({ u, em: e.em, id: false }); }
                // the fix: where the bearing cuts cross, closing in with dwell
                if (rec.source === 'sigint') { const err = fixError(d, s.t, need.ident); rec.lastPos.set(u.pos.x + s.ox * err, u.pos.y, u.pos.z + s.oz * err); rec.lastSeen = war.time; }
            }
        }
        f.repT = (f.repT || 0) - 0.5;
        if (f.repT <= 0 && f.found && f.found.length) {
            f.repT = 12;
            const ids = f.found.filter(x => x.id), fixes = f.found.filter(x => !x.id);
            const name = (x) => x.em.name;
            const parts = [];
            if (fixes.length) parts.push(fixes.length + ' NEW EMITTER' + (fixes.length > 1 ? 'S' : '') + ': ' + [...new Set(fixes.map(name))].slice(0, 2).join(', '));
            if (ids.length) parts.push(ids.length + ' IDENTIFIED: ' + [...new Set(ids.map(x => war.label(x.u)))].slice(0, 2).join(', '));
            const x0 = f.found[0].u.pos;
            this.say(f.callsign, parts.join(' · ') + ' — ' + BR.formatBullseye(this.bull, x0, { x: 0, y: 0, z: 0 }).split(',')[0], { color: '#ffd24a', say: f.callsign.toLowerCase() + ', new emitters.' });
            g.events.emit('sigintReport', f, { found: f.found.slice() });
            f.found.length = 0;
        }
    }

    // does one of our recon aircraft see a point (strikes.watchers: BDA)?
    watches(pos) {
        const war = this.game.war;
        for (const f of this.flights) {
            if (f.role !== 'recon' || !f.alive || !f.area || f.kind === 'rc135' || f.kind === 'u2') continue;
            const R = RECON[f.kind];
            const d = f.ac.pos.distanceTo(pos);
            if (d > R.sensor.range) continue;
            if (!war.lineOfSight(f.ac.pos, _v2.copy(pos).setY(pos.y + 4))) continue;
            f.watchT = war.time; f.watchPos = (f.watchPos || new THREE.Vector3()).copy(pos);
            return true;
        }
        return false;
    }

    // a BDA result came in while a drone was watching: its picture of it
    onBDA(e) {
        if (!this.enabled || !e || !e.aim) return;
        const war = this.game.war;
        const pos = e.aim.unit ? e.aim.unit.pos : e.aim.pos;
        for (const f of this.flights) {
            if (f.role !== 'recon' || !f.alive || f.watchT == null || war.time - f.watchT > 3) continue;
            if (!f.watchPos || f.watchPos.distanceTo(pos) > 200) continue;
            this.takeImage(f, pos, e);
            return;
        }
    }

    // a drone's picture (recon.js reconImage) into the targeting pod's imagery list (the map shows it)
    takeImage(f, pos, bda) {
        const g = this.game, war = g.war, S = g.sensors, R = RECON[f.kind];
        const size = f.kind === 'mq9' ? 1400 : f.kind === 'rq4' ? 6000 : 9000;
        const units = war.near(_v.set(pos.x, 0, pos.z), size, { alive: false }).filter(o => o.rec.team !== war.side || o.u.isGround).map(o => o.u).filter(u => u.pos);
        const aim = bda ? bda.aim : null;
        const canvas = reconImage({
            center: pos, size, style: R.imagery, units, roads: g.world.towns ? g.world.towns.paths : null,
            look: _v2.subVectors(pos, f.ac.pos),
            title: f.callsign + ' · ' + (R.imagery === 'flir' ? 'MTS-B FLIR WHOT' : R.imagery === 'sar' ? 'SAR / GMTI' : 'SYERS-2 PAN'),
            lines: [war.grid(pos.x, pos.z), S && S.zulu ? S.zulu() : '', bda ? (bda.result || '').split(' —')[0] : 'AREA IMAGERY', Math.round(f.ac.pos.y * M_TO_FT).toLocaleString('en-US') + ' FT'],
        });
        if (!canvas) return null;
        const img = {
            canvas, pos: new THREE.Vector3(pos.x, pos.y || 0, pos.z), t: g.time, clock: S && S.zulu ? S.zulu() : '', mission: g.clockText ? g.clockText() : '',
            result: bda ? bda.result : 'AREA IMAGERY — ' + units.filter(u => u.alive).length + ' OBJECTS', label: aim ? aim.label || '' : 'RECON ' + war.grid(pos.x, pos.z),
            grid: war.grid(pos.x, pos.z), source: R.short, strike: bda ? bda.strike : null, aim, mark: aim ? aim.mark || null : null, unit: aim ? aim.unit || null : null,
        };
        if (aim) aim.imagery = img;
        if (S && S.imagery) { S.imagery.push(img); if (S.imagery.length > 24) S.imagery.shift(); }
        g.addFeed(R.short + ' IMAGERY RECORDED — TACTICAL MAP (`) TO REVIEW', '#9fd4ff');
        g.events.emit('bdaImagery', img);
        return img;
    }

    // ═════════════ Strikes: the Reaper's Hellfires, the B-52 ═════════════
    // strikes.airProviders: an AIR STRIKE on a mark the Reaper can reach is flown by it, with Hellfires
    reaperStrike(marks, team, quiet) {
        const g = this.game, war = g.war, st = g.strikes;
        if (team !== war.side || !st) return null;
        const d = marks[marks.length - 1];
        const unit = d.unit || (d.alive !== undefined ? d : null);
        if (!unit) return null; // (Hellfires need something to hit)
        const f = this.flights.find(x => x.kind === 'mq9' && x.alive && x.launcher && (x.launcher.stock.hellfire || 0) > 0 && x.ac.pos.distanceTo(unit.pos) < 12000);
        if (!f) return null;
        const aim = { pos: unit.pos, unit, label: war.label(unit), mark: d.id ? d : null };
        const strike = { id: st.nextStrikeId++, type: 'drone', label: 'AIR STRIKE (' + f.callsign + ')', team, spec: MISSILES.hellfire, aims: [aim], launched: 0, planned: 0, impacts: 0, lost: 0, missiles: [], t: g.time, sources: new Set([f.launcher]), done: false };
        const k = f.launcher.fire('hellfire', 2, aim, strike, 2.5);
        if (!k) return null;
        strike.planned = k;
        st.strikes.push(strike);
        if (d.transmitted === false) d.transmitted = true;
        if (!quiet) this.say(f.callsign, 'COPY, ' + k + ' HELLFIRE' + (k > 1 ? 'S' : '') + ' ON ' + aim.label + ' — CLEARED HOT, RIFLE IN 3', { color: '#9fd4ff', say: f.callsign.toLowerCase() + ', copy, hellfire, cleared hot.' });
        g.events.emit('strikeRequested', strike);
        return strike;
    }

    // carpet bombing: the B-52 runs in over the mark at 8.5 km and lays a stick of Mk-82s across it
    carpetStrike(marks, team, quiet) {
        const g = this.game, war = g.war, st = g.strikes;
        if (team !== war.side || !st) return null;
        const f = this.b52 && this.b52.alive ? this.b52 : (this.warMode ? this.spawnB52() : null);
        if (!f || (f.bombs || 0) < 6) { if (!quiet) this.say('DOOM 1', 'UNABLE — ' + (f ? 'NO BOMBS LEFT' : 'NOT ON STATION'), { color: AMBER, say: false }); return null; }
        const d = marks[marks.length - 1];
        const unit = d.unit || (d.alive !== undefined ? d : null);
        const pos = unit ? unit.pos : d.fixed || d.pos;
        const aim = { pos, unit, label: unit ? war.label(unit) : 'MARK ' + d.id, mark: d.id ? d : null };
        const n = Math.min(18, f.bombs);
        const strike = { id: st.nextStrikeId++, type: 'carpet', label: 'CARPET BOMBING', team, spec: { name: 'MK-82', short: 'MK-82', kind: 'air', warhead: 220, blast: 55, hard: 0.3 }, aims: [aim], launched: 0, planned: n, impacts: 0, lost: 0, missiles: [], t: g.time, sources: new Set(), done: false };
        st.strikes.push(strike);
        if (d.transmitted === false) d.transmitted = true;
        // the run: from the side it's on, a 25 km run-in to the target, level at 8.5 km
        const P = f.ac.pos;
        const dx = pos.x - P.x, dz = pos.z - P.z, L = Math.hypot(dx, dz) || 1;
        const ip = new THREE.Vector3(pos.x - dx / L * 25000, 8500, pos.z - dz / L * 25000);
        f.saved = f.task;
        f.task = { kind: 'strike', ip, pos, dir: new THREE.Vector3(dx / L, 0, dz / L), n, dropped: 0, phase: 'ip', strike, aim, nextT: 0 };
        f.alt = 8500;
        const eta = Math.round((L + 5000) / f.ac.speed / 60);
        if (!quiet) this.say(f.callsign, 'COPY CARPET BOMBING ON ' + aim.label + ', ' + n + ' MK-82S — TIME ON TARGET ' + Math.max(1, eta) + ' MIN', { color: '#9fd4ff', say: 'Doom one, copy, bombs on target in ' + Math.max(1, eta) + ' minutes.' });
        g.events.emit('strikeRequested', strike);
        return strike;
    }

    // the B-52's bomb run: to the IP, then straight at the target, releasing so the stick straddles it
    flyStrike(f, dt) {
        const g = this.game, ac = f.ac, c = ac.controls, t = f.task, war = g.war;
        const T = t.aim.unit && t.aim.unit.alive ? t.aim.unit.pos : t.pos;
        let aim;
        if (t.phase === 'ip') {
            aim = t.ip;
            if (Math.hypot(t.ip.x - ac.pos.x, t.ip.z - ac.pos.z) < 3000) { t.phase = 'run'; this.say(f.callsign, 'IP INBOUND, BOMB DOORS OPEN', { color: '#9fd4ff', say: false }); }
        } else if (t.phase === 'run') {
            aim = _aim.set(T.x + t.dir.x * 20000, 0, T.z + t.dir.z * 20000);
            // release: the first bomb lands half a stick short of the target
            const gy = Math.max(groundHeight(T.x, T.z), 0);
            const tof = bombImpact(ac, gy, _v2);
            const along = (_v2.x - T.x) * t.dir.x + (_v2.z - T.z) * t.dir.z;
            const half = t.n * 0.22 * ac.speed * 0.5;
            if (along > -half - 60 && t.dropped < t.n && g.time >= t.nextT) {
                g.weapons.dropBomb(ac);
                t.dropped++; f.bombs--; t.nextT = g.time + 0.22;
                t.strike.launched++;
                if (t.dropped === 1) this.say(f.callsign, 'BOMBS AWAY', { color: '#9fd4ff', say: 'doom one, bombs away.' });
            }
            if (t.dropped >= t.n || along > half + 3000) {
                t.phase = 'out';
                t.landT = war.time + tof + 3;
            }
        } else {
            aim = _aim.set(ac.pos.x + t.dir.x * 20000, 0, ac.pos.z + t.dir.z * 20000);
            if (war.time > t.landT && !t.reported) {
                t.reported = true;
                const st = t.strike;
                st.impacts = st.planned; st.done = true;
                if (g.strikes) g.strikes.checkAirBDA(st);
                f.task = null;
                const Tb = this.track('b52', 'blue');
                f.setTrack(Tb);
            }
        }
        const dx = aim.x - ac.pos.x, dz = aim.z - ac.pos.z, hd = Math.hypot(dx, dz) || 1;
        const gam = clamp((f.alt - ac.pos.y) / Math.max(ac.speed * 22, 800), -0.07, 0.07);
        _dir.set(dx / hd * Math.cos(gam), Math.sin(gam), dz / hd * Math.cos(gam));
        steerToward(ac, _dir, c, 0.6, true, f.maxBank);
        f.speedHold(230, dt);
        if (ac.flares > 0 && ac.pilot) ac.pilot.flares();
        avoidTerrain(ac, c, 800);
        return true;
    }

    updateStrikes() {
        // (the B-52's stand-off JASSMs go through the strike system by themselves; nothing to do here yet)
    }

    // ═════════════ Bombers: the red stand-off raid ═════════════
    // the director's raid of cruise-missile carriers (director.launchRaid calls this): it stands off and launches
    standoffRaid(f) {
        if (!this.enabled || !f || !this.game.strikes || !this.game.strikes.enabled) return null;
        const plan = planStandoff(f);
        if (!plan) return null;
        const st = this.game.strikes;
        const src = st.addSource(new AirLaunchSource(st, f, { name: 'BEAR RAID', team: f.team, kind: 'bomber', stock: plan.stock }));
        const r = { f, src, lp: plan.lp, launched: false, target: f.target };
        this.raids.push(r);
        return r;
    }

    // air.bomberRaid(side, targets): a raid of two Tu-95MS (red) with an escort, or the B-52 (blue), on targets
    // (units, points or marks). Red: a director flight when the war director runs, else our own.
    bomberRaid(side = 'red', targets = null) {
        const g = this.game, war = g.war, d = g.director;
        if (side === war.side) {
            const T = (targets || []).map(t => t && t.pos ? (t.alive !== undefined ? t : { pos: t.pos, fixed: t.pos, id: 0, transmitted: true, label: 'TARGET' }) : { pos: new THREE.Vector3(t.x, 0, t.z), fixed: new THREE.Vector3(t.x, groundHeight(t.x, t.z), t.z), id: 0, transmitted: true, label: 'TARGET' });
            if (!T.length) return null;
            if (!this.b52 || !this.b52.alive) this.spawnB52();
            return g.strikes ? g.strikes.request('standoff', T, war.side) : null;
        }
        const tgt = targets && targets[0] ? targets[0] : null;
        const tpos = tgt ? (tgt.pos || tgt) : new THREE.Vector3(BASES[0].x, BASES[0].h, BASES[0].z);
        const target = { pos: new THREE.Vector3(tpos.x, tpos.y ?? groundHeight(tpos.x, tpos.z), tpos.z), unit: tgt && tgt.alive !== undefined ? tgt : null, label: tgt && tgt.name ? tgt.name : 'THE TARGET', kind: 'base', extra: (targets || []).slice(1) };
        const start = new THREE.Vector3(target.pos.x + 5000, 9000, target.pos.z - 80000);
        if (d && d.enabled && d.spawnFlight) {
            const f = d.spawnFlight({ team: 'red', role: 'raid', types: ['tu95', 'tu95'], bombs: 0, pos: start, speed: 200, skill: 0.6, route: [], target, callsign: 'RAID' });
            f.home = d.homeFor ? d.homeFor('red', start) : start.clone();
            this.standoffRaid(f);
            if (d.intensity && d.intensity() > 0.95) { const e = d.spawnFlight({ team: 'red', role: 'escort', types: ['su35', 'su35'], pos: start.clone().add(_v.set(800, 300, 600)), speed: 200, skill: 0.6, escortOf: f, callsign: 'ESCORT' }); e.home = f.home.clone(); }
            return f;
        }
        // no director: our own flights (a raid of real jets, flown to the launch point)
        const f = { types: ['tu95', 'tu95'], pos: start.clone(), target, n: 2, done: false, hp: [1, 1], vel: new THREE.Vector3() };
        const plan = planStandoff(f);
        if (!plan) return null;
        const lead = this.spawnSupport({ type: 'tu95', team: 'red', role: 'raid', callsign: 'BEAR 1', pos: f.pos.clone(), heading: headingFor(plan.lp.x - f.pos.x, plan.lp.z - f.pos.z), speed: 200, alt: 9000, skill: 0.6 });
        const wing = this.spawnSupport({ type: 'tu95', team: 'red', role: 'raid', callsign: 'BEAR 2', pos: f.pos.clone().add(_v.set(400, 60, 500)), heading: headingFor(plan.lp.x - f.pos.x, plan.lp.z - f.pos.z), speed: 200, alt: 9060, skill: 0.6 });
        for (const b of [lead, wing]) { b.ac.flares = 48; b.setGoto(plan.lp, 9000, 200, (fl) => { fl.rtb(); }); }
        const host = { members: [lead.ac, wing.ac], get pos() { return lead.ac.alive ? lead.ac.pos : wing.ac.pos; }, get vel() { return lead.ac.alive ? lead.ac.vel : wing.ac.vel; }, types: ['tu95', 'tu95'], hp: [1, 1], get n() { return (lead.ac.alive ? 1 : 0) + (wing.ac.alive ? 1 : 0); }, get done() { return !lead.ac.alive && !wing.ac.alive; }, target };
        const src = g.strikes.addSource(new AirLaunchSource(g.strikes, host, { name: 'BEAR RAID', team: 'red', kind: 'bomber', stock: plan.stock }));
        this.raids.push({ f: host, src, lp: plan.lp, launched: false, target, own: [lead, wing] });
        this.say(this.awacsCtl.call, 'NEW GROUP ' + BR.formatBullseye(this.bull, start, _v.set(0, 0, 1)) + ', HOSTILE, 2 CONTACTS — BOMBERS, EXPECT CRUISE MISSILES', { color: '#ff9f5a', priority: true });
        return host;
    }

    // at the launch point the raid fires its cruise missiles at the target (and whatever of ours is close to it)
    updateRaids() {
        const g = this.game, war = g.war, st = g.strikes;
        for (let i = this.raids.length - 1; i >= 0; i--) {
            const r = this.raids[i], f = r.f;
            if (f.done || f.n === 0) { if (st) st.removeSource(r.src); this.raids.splice(i, 1); continue; }
            if (r.launched) continue;
            const d = Math.hypot(f.pos.x - r.lp.x, f.pos.z - r.lp.z);
            if (d > 3500) continue;
            r.launched = true;
            const aims = [r.target.unit && r.target.unit.alive ? r.target.unit : { id: 0, pos: r.target.pos, fixed: r.target.pos, transmitted: true, label: r.target.label }];
            for (const e of r.target.extra || []) aims.push(e.alive !== undefined ? e : { id: 0, pos: e.pos || e, fixed: e.pos || e, transmitted: true, label: 'TARGET' });
            // (and our radars, SAMs and installations near the target)
            for (const { u } of war.near(r.target.pos, 1500, { team: war.side })) if (aims.length < 4 && u.isGround && !u.isShip) aims.push(u);
            let fired = 0;
            for (const a of aims) { const s = st.request('standoff', [a], f.team || 'red', true); if (s) fired += s.planned; }
            if (fired) {
                this.say(this.awacsCtl.call, 'VAMPIRE LAUNCH — THE BOMBERS HAVE RELEASED ' + fired + ' CRUISE MISSILES TOWARD ' + r.target.label, { color: '#ff4a3d', priority: true, speech: 'Missile launch. The bombers have released cruise missiles toward ' + r.target.label.toLowerCase() + '.' });
                g.events.emit('raidLaunch', f, { target: r.target, missiles: fired });
            }
        }
    }

    // a red cruise missile hits near one of our places
    onImpact(m, d) {
        const g = this.game, war = g.war;
        if (!this.enabled || !m || m.team === war.side || !m.source || !m.source.airLaunch) return;
        const at = d.at || m.pos;
        if (this.lastImpactT && war.time - this.lastImpactT < 6) return;
        this.lastImpactT = war.time;
        this.say('COMMAND', 'CRUISE MISSILE IMPACT — ' + (g.director && g.director.placeName ? g.director.placeName(at) : 'GRID ' + war.grid(at.x, at.z)), { color: '#ff4a3d', say: false });
    }

    onKilled(ac) {
        if (!this.enabled || !ac) return;
        // a high-value enemy aircraft down: a bonus for whoever did it (the player's share through the usual kill)
        const f = ac.support;
        if (f && f.team !== this.game.war.side && (f.role === 'awacs' || f.role === 'tanker') && ac.lastHitBy === this.game.player) {
            this.game.score += 1000;
            this.game.addFeed('HIGH-VALUE AIR ASSET DOWN: ' + ac.spec.name.toUpperCase() + '  +1000', AMBER);
        }
    }

    // ═════════════ The director's announcements (in brevity when our AWACS is up) ═════════════
    announceFlight(f) { return this.enabled ? this.awacsCtl.announce(f) : false; }

    // ═════════════ Tasks (tasks.js generator) ═════════════
    offerTasks(tasks) {
        const g = this.game, war = g.war;
        if (!this.enabled) return null;
        for (const f of this.flights) {
            if (f.team !== war.side || !f.threat || !f.alive || f.taskOffered || (f.role !== 'awacs' && f.role !== 'tanker')) continue;
            if (!tasks.canOffer(true)) return null;
            f.taskOffered = true;
            const threats = g.aircraft.filter(a => a.alive && a.team !== war.side && a.spec.category === 'fighter' && a.pos.distanceTo(f.ac.pos) < 45000);
            return { type: 'hvaa', key: 'hvaa' + f.id, title: 'PROTECT ' + f.callsign, brief: 'Bandits are closing on ' + f.callsign + ' (' + f.ac.spec.name + '). Get between them and it.', from: 'COMMAND', label: f.callsign, urgent: true, reward: 700,
                units: threats, pos: () => f.ac.pos, expires: 90, limit: 360,
                check: () => (!f.alive ? 'failed:' + f.callsign + ' WAS SHOT DOWN' : !f.threat && threats.every(a => !a.alive || a.pos.distanceTo(f.ac.pos) > 50000) ? 'done:THE THREAT IS GONE' : null) };
        }
        const L = this.lostRecon;
        if (L && war.time - L.t < 60 && !L.offered && tasks.canOffer(false)) {
            L.offered = true;
            const c = new THREE.Vector3(L.area.x, 0, L.area.z);
            return { type: 'recon', key: 'lostrecon' + L.f.id, title: 'FINISH ' + L.f.callsign + '\'S SEARCH', brief: L.f.callsign + ' went down over grid ' + war.grid(L.area.x, L.area.z) + '. Fly over the area and see what shot it down.', from: 'COMMAND', label: 'SEARCH AREA', reward: 450,
                area: { center: c, radius: L.area.r }, pos: c, expires: 180, limit: 600,
                check: () => { const p = g.player; return p && p.alive && Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < Math.max(2500, L.area.r) ? 'done:AREA COVERED' : null; } };
        }
        return null;
    }

    // ═════════════ Command menu ═════════════
    commands() {
        if (!this.enabled) return [];
        const g = this.game, war = g.war, p = g.player, out = [];
        const aw = this.awacs(war.side, true);
        const pc = (g.callsign || 'VIPER') + ' 1';
        const S = ['SUPPORT'];
        const awHint = aw ? aw.callsign : 'NO AWACS ON STATION';
        out.push({ path: S, label: 'BOGEY DOPE', hint: awHint, enabled: !!aw, run: () => this.awacsCtl.bogeyDope() });
        out.push({ path: S, label: 'PICTURE', hint: awHint, enabled: !!aw, run: () => this.awacsCtl.picture() });
        out.push({ path: S, label: 'DECLARE', hint: !aw ? awHint : g.lockTarget ? war.label(g.lockTarget) || 'LOCKED TRACK' : 'LOCK A TRACK FIRST (T)', enabled: !!aw && !!g.lockTarget, run: () => this.awacsCtl.declare() });
        // tanker
        const TK = ['SUPPORT', 'TANKER'], ses = this.playerSession;
        const rp = p ? receiverPoint(p) : null;
        const tk = this.tankers(war.side)[0];
        if (!ses) out.push({ path: TK, label: 'REQUEST AIR REFUELING', hint: !rp ? 'NOT AIR-REFUELABLE' : !tk ? 'NO TANKER' : tk.callsign + ' · ' + (rp.kind === 'boom' ? 'BOOM' : 'DROGUE') + ' · ' + (tk.ac.pos.distanceTo(p.pos) / 1852).toFixed(0) + ' NM', enabled: !!(rp && tk && p && p.alive && !p.onGround), run: () => this.requestTanker(p) });
        else {
            out.push({ path: TK, label: ses.auto ? 'AR AUTOPILOT OFF (Y)' : 'AR AUTOPILOT ON (Y)', hint: 'FLIES THE JOIN AND CONTACT', run: () => this.arAuto(!ses.auto) });
            out.push({ path: TK, label: 'ABORT REFUELING', hint: ses.state.toUpperCase(), run: () => { this.say(pc, ses.tanker.callsign + ', ' + pc + ', ABORTING', { color: '#8fd0ff', say: false }); ses.release(); ses.end('abort'); } });
        }
        const wg = g.wingmen && g.wingmen.active ? g.wingmen.active.filter(w => w.ac && receiverPoint(w.ac)) : [];
        if (wg.length) out.push({ path: TK, label: 'SEND WINGMEN TO THE TANKER', hint: wg.length + ' RECEIVER' + (wg.length > 1 ? 'S' : ''), enabled: !!tk, run: () => { for (const w of wg) this.requestTanker(w.ac, { quiet: true }); this.say(wg[0].callsign, 'COPY, TANKING', { color: '#8fd0ff', say: false }); } });
        for (const t of this.tankers(war.side)) out.push({ path: TK, label: 'STATUS: ' + t.callsign + ' (' + t.ac.spec.name.split(' ')[0] + ')', hint: Math.round(t.ops.give / LB / 1000) + 'K LB TO GIVE · ' + BR.angels(t.ac.pos.y * M_TO_FT), enabled: false, run: () => {} });
        // recon
        const RC = ['SUPPORT', 'RECON'], where = this.areaLabel();
        for (const k of ['mq9', 'rq4', 'u2']) {
            const R = RECON[k], f = this.flights.find(x => x.kind === k && x.alive);
            out.push({ path: RC, label: (f ? 'RE-TASK ' : 'SEND ') + R.short + ' (' + R.label.split(' ')[0] + ')', hint: '→ ' + where, run: () => this.sendRecon(k) });
        }
        const mq = this.flights.find(x => x.kind === 'mq9' && x.alive && x.launcher);
        const mark = war.designations[war.designations.length - 1];
        if (mq) out.push({ path: RC, label: 'REAPER: HELLFIRE ON MARK' + (mark ? ' ' + mark.id : ''), hint: (mq.launcher.stock.hellfire || 0) + ' LEFT', enabled: !!(mark && mark.unit), run: () => g.strikes.request('air', [mark]) });
        for (const f of this.flights.filter(x => x.role === 'recon' && x.alive && x.kind !== 'rc135')) out.push({ path: RC, label: 'RECALL ' + f.callsign, run: () => { f.area = null; f.rtb(); this.say(f.callsign, 'COPY, RTB', { color: '#9fd4ff', say: false }); } });
        const rj = this.flights.find(x => x.kind === 'rc135' && x.alive);
        out.push({ path: RC, label: rj ? 'RIVET JOINT: ' + (rj.sig ? rj.sig.size : 0) + ' EMITTERS HEARD' : 'SEND RIVET JOINT (RC-135W)', hint: rj ? 'SIGINT ON STATION' : 'SIGINT', enabled: !rj, run: () => this.sendRecon('rc135') });
        // electronic warfare
        const EW = ['SUPPORT', 'ELECTRONIC WARFARE'];
        const gr = this.flights.find(x => x.role === 'ew' && x.alive);
        out.push({ path: EW, label: 'GROWLER: ESCORT ME', hint: gr ? gr.callsign : 'ZAPPER 1', enabled: !!(p && p.alive), run: () => { const f = this.sendGrowler(p); this.say(f.callsign, 'COPY, JOINING — MUSIC ON YOUR SAMS', { color: '#9fd4ff', say: false }); } });
        out.push({ path: EW, label: 'GROWLER: JAM ' + (mark ? 'MARK ' + mark.id : 'THE NEWEST MARK'), hint: 'STAND-OFF', enabled: !!mark, run: () => { const f = this.sendGrowler({ pos: mark.unit ? mark.unit.pos : mark.fixed || mark.pos }); this.say(f.callsign, 'COPY, STAND-OFF JAMMING GRID ' + mark.grid, { color: '#9fd4ff', say: false }); } });
        if (gr) out.push({ path: EW, label: 'GROWLER: RETURN TO ORBIT', run: () => this.growlerHome(gr) });
        if (p && p.type === 'ea18g') {
            const j = this.jammers.find(x => x.ac === p);
            out.push({ path: EW, label: this.ew.page ? 'EW PAGE OFF (F4)' : 'EW PAGE ON (F4)', hint: 'ALQ-99 / ALQ-218', run: () => { this.ew.page = !this.ew.page; }, keepOpen: true });
            out.push({ path: EW, label: j && j.on ? 'JAMMER: STANDBY (;)' : 'JAMMER: ON (;)', run: () => this.playerJam(!(j && j.on)) });
            out.push({ path: EW, label: 'POINT PODS AT THE SELECTED THREAT (\')', enabled: this.ew.list.length > 0, run: () => this.aimJammer(p) });
            out.push({ path: EW, label: 'HARM AT THE SELECTED THREAT (M)', hint: (p.harms ?? 0) + ' LEFT', enabled: (p.harms ?? 0) > 0, run: () => { this.ew.page = true; this.ewList(p); this.fireHarm(p); } });
        }
        // bombers
        const BM = ['SUPPORT', 'BOMBERS'];
        const b52 = this.b52 && this.b52.alive ? this.b52 : null;
        const js = b52 && b52.launcher ? b52.launcher.stock.jassm || 0 : 0;
        const markHint = mark ? 'MARK ' + mark.id + ' · ' + mark.label : 'MARK A TARGET FIRST (,)';
        const standoff = { label: 'B-52 STAND-OFF STRIKE (JASSM)', hint: b52 ? js + ' JASSM · ' + markHint : 'NOT ON STATION', enabled: !!(b52 && js && mark), run: () => g.strikes.request('standoff', [mark]) };
        const carpet = { label: 'B-52 CARPET BOMBING (MK-82)', hint: b52 ? (b52.bombs || 0) + ' BOMBS · ' + markHint : 'NOT ON STATION', enabled: !!(b52 && (b52.bombs || 0) >= 6 && mark), run: () => g.strikes.request('carpet', [mark]) };
        out.push({ path: BM, ...standoff }, { path: BM, ...carpet });
        out.push({ path: ['TACTICAL SUPPORT'], ...standoff }, { path: ['TACTICAL SUPPORT'], ...carpet });
        return out;
    }

    // ═════════════ Map ═════════════
    drawMap(ctx, map) {
        if (!this.enabled) return;
        const g = this.game, war = g.war, P = {}, Q = {};
        ctx.save();
        ctx.font = '600 10px ' + FONT; ctx.textBaseline = 'middle';
        // the bullseye
        map.toScreen(this.bull.x, this.bull.z, P);
        ctx.strokeStyle = 'rgba(159,212,255,0.8)'; ctx.lineWidth = 1.2;
        for (const r of [4, 8, 12]) { ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, Math.PI * 2); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(P.x - 16, P.y); ctx.lineTo(P.x + 16, P.y); ctx.moveTo(P.x, P.y - 16); ctx.lineTo(P.x, P.y + 16); ctx.stroke();
        ctx.fillStyle = 'rgba(159,212,255,0.85)'; ctx.textAlign = 'left'; ctx.fillText('BULLSEYE', P.x + 15, P.y - 11);
        for (const f of this.flights) {
            if (!f.alive || f.team !== war.side) continue;
            const t = f.task;
            ctx.strokeStyle = f.role === 'tanker' ? 'rgba(111,220,255,0.55)' : f.role === 'awacs' ? 'rgba(111,180,255,0.5)' : 'rgba(111,180,255,0.4)';
            ctx.setLineDash([6, 5]); ctx.lineWidth = 1.2;
            if (t && t.kind === 'track') {
                const T = t.T, L = trackLength(T);
                ctx.beginPath();
                for (let i = 0; i <= 48; i++) { trackPoint(T, L * i / 48, _tp, null); map.toScreen(_tp.x, _tp.z, Q); if (i) ctx.lineTo(Q.x, Q.y); else ctx.moveTo(Q.x, Q.y); }
                ctx.stroke();
            } else if (t && t.kind === 'orbit') { map.toScreen(t.c.x, t.c.z, Q); ctx.beginPath(); ctx.arc(Q.x, Q.y, Math.max(3, t.R * map.scale), 0, Math.PI * 2); ctx.stroke(); }
            ctx.setLineDash([]);
            // label beside the aircraft (the war registry draws the symbol)
            map.toScreen(f.ac.pos.x, f.ac.pos.z, P);
            ctx.fillStyle = BLUE; ctx.textAlign = 'left';
            const what = f.role === 'awacs' ? 'AWACS' : f.role === 'tanker' ? 'TANKER · ' + Math.round(f.ops.give / LB / 1000) + 'K LB' : f.role === 'recon' ? RECON[f.kind].short : f.role === 'ew' ? 'EW' : f.role === 'bomber' ? 'B-52 · ' + (f.launcher ? f.launcher.stock.jassm || 0 : 0) + ' JASSM' : '';
            ctx.fillText(f.callsign + ' · ' + what + ' · ' + BR.angels(f.ac.pos.y * M_TO_FT) + (f.threat ? ' · DEFENSIVE' : ''), P.x + 10, P.y - 10);
            // a recon aircraft's search area and footprint
            if (f.role === 'recon' && f.area && f.kind !== 'rc135') {
                map.toScreen(f.area.x, f.area.z, Q);
                ctx.strokeStyle = 'rgba(255,210,74,0.7)'; ctx.setLineDash([3, 4]);
                ctx.beginPath(); ctx.arc(Q.x, Q.y, Math.max(5, f.area.r * map.scale), 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
                ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke();
                ctx.fillStyle = '#ffd24a'; ctx.fillText(f.callsign + (f.onArea ? ' ON STATION' : ' EN ROUTE'), Q.x + 8, Q.y + 12);
            }
            if (f.run && !f.run.done) {
                map.toScreen(f.run.a.x, f.run.a.z, Q); const Q2 = map.toScreen(f.run.b.x, f.run.b.z);
                ctx.strokeStyle = 'rgba(255,210,74,0.35)'; ctx.lineWidth = Math.max(2, RECON.u2.swath * 2 * map.scale);
                ctx.beginPath(); ctx.moveTo(Q.x, Q.y); ctx.lineTo(Q2.x, Q2.y); ctx.stroke(); ctx.lineWidth = 1.2;
            }
        }
        // jammers: a friendly jammer's sector, and the noise strobes on the enemy radars it's jamming
        for (const j of this.jammers) {
            if (!j.on || !j.alive) continue;
            map.toScreen(j.pos.x, j.pos.z, P);
            if (j.team === war.side) {
                const R = 60000 * map.scale;
                ctx.fillStyle = 'rgba(93,255,160,0.07)'; ctx.strokeStyle = 'rgba(93,255,160,0.45)';
                ctx.beginPath(); ctx.moveTo(P.x, P.y);
                ctx.arc(P.x, P.y, R, j.brg - Math.PI / 2 - j.half, j.brg - Math.PI / 2 + j.half); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = GREEN; ctx.textAlign = 'left'; ctx.fillText(j.name + ' JAMMING', P.x + 10, P.y + 12);
                for (const e of this.emitters) {
                    if (war.known(e.u) < INTEL.CONTACT) continue;
                    const jn = jamToNoise(e.u.pos, j.pos, j);
                    if (jn < 2) continue;
                    const rp = war.recs.get(e.u).lastPos;
                    map.toScreen(rp.x, rp.z, Q);
                    ctx.strokeStyle = 'rgba(255,90,74,' + clamp(0.25 + Math.log10(jn) * 0.12, 0.25, 0.8) + ')'; ctx.setLineDash([2, 3]);
                    ctx.beginPath(); ctx.moveTo(Q.x, Q.y); ctx.lineTo(P.x, P.y); ctx.stroke(); ctx.setLineDash([]);
                }
            } else if (war.known(j.ac) >= INTEL.CONTACT) {
                ctx.fillStyle = '#ff9f5a'; ctx.textAlign = 'left'; ctx.fillText('JAMMER', P.x + 10, P.y + 12);
            }
        }
        // the player on his way to a tanker
        const S = this.playerSession;
        if (S && !S.done) {
            const a = g.player.pos, b = S.tanker.ac.pos;
            map.toScreen(a.x, a.z, P); map.toScreen(b.x, b.z, Q);
            ctx.strokeStyle = 'rgba(111,220,255,0.7)'; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke(); ctx.setLineDash([]);
        }
        // raids and their launch points
        for (const r of this.raids) {
            if (r.launched || !(r.f.detected || r.own)) continue;
            map.toScreen(r.lp.x, r.lp.z, P);
            ctx.strokeStyle = 'rgba(255,90,74,0.6)';
            ctx.beginPath(); ctx.moveTo(P.x - 6, P.y - 6); ctx.lineTo(P.x + 6, P.y + 6); ctx.moveTo(P.x + 6, P.y - 6); ctx.lineTo(P.x - 6, P.y + 6); ctx.stroke();
            ctx.fillStyle = RED; ctx.fillText('LIKELY LAUNCH POINT', P.x + 9, P.y);
        }
        ctx.restore();
    }

    mapActions(sel) {
        if (!this.enabled || !sel) return [];
        const g = this.game, war = g.war, out = [];
        if (!['point', 'report', 'unit', 'mark'].includes(sel.kind)) return out;
        if (sel.kind === 'unit' && sel.unit.team === war.side) return out;
        const area = sel.kind === 'report' ? sel.report : sel.kind === 'mark' ? (sel.mark.unit ? { unit: sel.mark.unit } : { pos: sel.mark.fixed || sel.mark.pos }) : sel.kind === 'unit' ? { unit: sel.unit } : { pos: sel.pos };
        out.push({ label: 'SEND RECON HERE: REAPER (MQ-9)', run: () => this.sendRecon('mq9', area) });
        out.push({ label: 'SEND RECON HERE: GLOBAL HAWK (RQ-4)', run: () => this.sendRecon('rq4', area) });
        out.push({ label: 'SEND RECON HERE: U-2 PHOTO RUN', run: () => this.sendRecon('u2', area) });
        const unit = sel.kind === 'unit' ? sel.unit : sel.kind === 'mark' ? sel.mark.unit : null;
        const mq = this.flights.find(x => x.kind === 'mq9' && x.alive && x.launcher && (x.launcher.stock.hellfire || 0) > 0);
        if (unit && unit.alive && mq) out.push({ label: 'REAPER: HELLFIRE STRIKE (' + (mq.launcher.stock.hellfire || 0) + ')', enabled: mq.ac.pos.distanceTo(unit.pos) < 12000, run: () => { const d = sel.kind === 'mark' ? sel.mark : war.designate(unit, 'map'); g.strikes.request('air', [d]); } });
        out.push({ label: 'GROWLER: STAND-OFF JAMMING HERE', run: () => this.sendGrowler(area) });
        return out;
    }

    mapInfo(sel) {
        if (!this.enabled || !sel || sel.kind !== 'unit') return [];
        const f = sel.unit.support, war = this.game.war, out = [];
        if (!f || f.team !== war.side) return out;
        if (f.role === 'tanker') {
            out.push({ text: 'TANKER · ' + Math.round(f.ops.give / LB).toLocaleString('en-US') + ' LB TO GIVE', color: '#9fd4ff' });
            out.push({ text: 'STATIONS: ' + Object.keys(f.ops.stations).map(s => (s === 'boom' ? 'BOOM' : s.toUpperCase() + ' HOSE') + (f.ops.stations[s].session ? ' (BUSY)' : '')).join(' · '), color: '#9fd4ff' });
        }
        if (f.role === 'awacs') out.push({ text: 'AWACS · ' + this.awacsCtl.groups.filter(q => !q.missiles).length + ' GROUPS HELD' + (f.threat ? ' · DEFENSIVE' : ''), color: '#9fd4ff' });
        if (f.role === 'recon' && f.kind === 'rc135') out.push({ text: 'SIGINT · ' + (f.sig ? f.sig.size : 0) + ' EMITTERS HEARD', color: '#9fd4ff' });
        if (f.role === 'bomber') out.push({ text: 'B-52H · ' + (f.launcher ? f.launcher.stock.jassm || 0 : 0) + ' JASSM · ' + (f.bombs || 0) + ' MK-82', color: '#9fd4ff' });
        return out;
    }

    // ═════════════ HUD ═════════════
    drawHud(ctx, hud) {
        const g = this.game;
        if (!this.enabled || g.photo || g.hideHud || g.sensorView) return;
        const p = g.player;
        if (!p || !p.alive || g.pilotMode || g.state !== 'playing') return;
        ctx.save();
        ctx.textBaseline = 'middle';
        this.drawStrobes(ctx, hud, p);
        if (this.playerSession && !this.playerSession.done) this.drawAR(ctx, hud, this.playerSession);
        if (this.ew.page && p.type === 'ea18g') this.drawEwPage(ctx, hud, p);
        // a locked cruise missile (the HUD's target boxes don't know them)
        const t = g.lockTarget;
        if (t && t.isStrategic && t.alive) {
            const P = hud.project(t.pos, g.camera, {});
            if (P.front) {
                ctx.strokeStyle = '#ff4a3d'; ctx.lineWidth = 2;
                ctx.strokeRect(P.x - 14, P.y - 14, 28, 28);
                ctx.fillStyle = '#ff4a3d'; ctx.font = '700 12px ' + FONT; ctx.textAlign = 'center';
                ctx.fillText(t.spec.short + ' · ' + (t.pos.distanceTo(p.pos) / 1000).toFixed(1) + 'km', P.x, P.y - 24);
            }
        }
        // the bullseye from us (for the controller's bullseye calls)
        if (this.awacs(g.war.side, true) && !hud.compact) {
            const b = BR.bearing(this.bull.x, this.bull.z, p.pos.x, p.pos.z), r = Math.hypot(p.pos.x - this.bull.x, p.pos.z - this.bull.z) / BR.NM;
            ctx.font = '600 11px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(93,255,160,0.7)';
            ctx.fillText('BULL ' + BR.pad3(b) + '/' + Math.round(r), 28, hud.h - 110);
        }
        ctx.restore();
    }

    // enemy jammers on our radar: strobes along their bearings on the scope, a burn-through mark close in
    drawStrobes(ctx, hud, p) {
        const g = this.game, war = g.war;
        let any = false;
        for (const j of this.jammers) {
            if (!j.on || !j.alive || j.team === war.side) continue;
            const jn = jamToNoise(p.pos, j.pos, j);
            if (jn < 1) continue;
            const d = j.pos.distanceTo(p.pos);
            const burn = d < 45000 * Math.max(JAM_FLOOR, (1 + jn) ** -0.25);
            const fwd = p.getForward(_v);
            const hdg = Math.atan2(-fwd.x, -fwd.z);
            const brg = Math.atan2(-(j.pos.x - p.pos.x), -(j.pos.z - p.pos.z)) - hdg;
            if (g.cameraMode !== 'cockpit' && hud.radarGeom) {
                const { R, cx, cy } = hud.radarGeom;
                const sx = -Math.sin(brg), sy = -Math.cos(brg);
                ctx.save();
                ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
                // noise: a flickering wedge along the bearing
                for (let k = 0; k < 10; k++) {
                    const r0 = R * Math.random() * 0.9, r1 = r0 + R * (0.05 + Math.random() * 0.15);
                    const w = (Math.random() - 0.5) * 0.06;
                    ctx.strokeStyle = 'rgba(255,200,90,' + (0.35 + Math.random() * 0.4) + ')'; ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(cx + (sx + w) * r0, cy + (sy - w) * r0); ctx.lineTo(cx + (sx + w) * r1, cy + (sy - w) * r1); ctx.stroke();
                }
                if (burn) {
                    const rr = Math.min(d / (g.radarRange || 8000), 1.05) * R;
                    ctx.strokeStyle = '#ff4a3d'; ctx.lineWidth = 1.5;
                    ctx.strokeRect(cx + sx * rr - 5, cy + sy * rr - 5, 10, 10);
                }
                ctx.restore();
            }
            if (!any) {
                any = true;
                const b = (((hdg + brg) * -1 / DEG) % 360 + 360) % 360;
                ctx.font = '700 12px ' + FONT; ctx.textAlign = 'center'; ctx.fillStyle = burn ? '#ff4a3d' : AMBER;
                const y = g.cameraMode !== 'cockpit' && hud.radarGeom ? hud.radarGeom.cy - hud.radarGeom.R - 14 : hud.h * 0.78;
                ctx.fillText((burn ? 'BURN-THROUGH ' : 'STROBE ') + BR.pad3(BR.bearing(p.pos.x, p.pos.z, j.pos.x, j.pos.z)) + (burn ? ' · ' + (d / 1000).toFixed(0) + ' KM' : ' · JAMMED'), hud.w / 2, y);
                void b;
            }
        }
    }

    // the refuelling cues: the tanker's box and steering, the procedure, the contact point, the lights
    drawAR(ctx, hud, S) {
        const g = this.game, cam = g.camera, p = g.player, tk = S.tanker.ac;
        const C = hud.compact;
        const d = tk.pos.distanceTo(p.pos);
        const P = hud.project(tk.pos, cam, {});
        const cyan = '#6fe0ff';
        ctx.font = '600 12px ' + FONT;
        if (S.state === 'rendezvous' || S.state === 'join' || d > 2500) {
            // the tanker (off screen: an arrow at the edge)
            if (!P.front || P.x < 0 || P.x > hud.w || P.y < 0 || P.y > hud.h) hud.edgeArrow(P, cyan, d);
            else {
                ctx.strokeStyle = cyan; ctx.lineWidth = 1.8;
                ctx.beginPath(); ctx.moveTo(P.x, P.y - 12); ctx.lineTo(P.x + 12, P.y); ctx.lineTo(P.x, P.y + 12); ctx.lineTo(P.x - 12, P.y); ctx.closePath(); ctx.stroke();
                ctx.fillStyle = cyan; ctx.textAlign = 'center';
                ctx.fillText(S.tanker.callsign + ' · ' + (d / 1852).toFixed(1) + ' NM', P.x, P.y - 22);
            }
        }
        // the panel (right, under the kill feed)
        const x = hud.w - (C ? 14 : 28), y0 = C ? 150 : 250;
        const closing = -((tk.vel.x - p.vel.x) * (tk.pos.x - p.pos.x) + (tk.vel.y - p.vel.y) * (tk.pos.y - p.pos.y) + (tk.vel.z - p.vel.z) * (tk.pos.z - p.pos.z)) / Math.max(d, 1);
        const lines = [];
        const kind = S.station === 'boom' ? 'BOOM' : ({ l: 'LEFT', r: 'RIGHT', c: 'CENTRE' })[S.station] + ' HOSE';
        lines.push([S.tanker.callsign + ' · ' + tk.spec.name.split(' ')[0] + ' · ' + kind, cyan, '700 13px']);
        const STEP = {
            rendezvous: 'RENDEZVOUS — ' + (d / 1852).toFixed(1) + ' NM, CLOSING ' + Math.round(closing * MS_TO_KTS) + ' KT',
            join: 'JOIN — OBSERVATION, LEFT WING',
            observe: 'OBSERVATION — WAIT FOR CLEARANCE',
            precontact: S.station === 'boom' ? 'PRE-CONTACT — STABILIZE BEHIND THE BOOM' : 'ASTERN — STABILIZE BEHIND THE BASKET',
            contact: S.station === 'boom' ? (S.flow ? 'CONTACT — HOLD, FLY THE DIRECTOR LIGHTS' : 'CLEARED CONTACT — MOVE IN SLOWLY') : (S.attached ? (S.flow ? 'CONTACT — FUEL FLOWING' : 'IN THE BASKET — PUSH IN TO THE GREEN') : 'CLEARED CONTACT — PROBE INTO THE BASKET, 2–5 KT'),
            breakaway: 'BREAKAWAY — POWER BACK, DOWN AND AFT',
            post: 'COMPLETE — RIGHT WING, THEN DEPART',
        };
        lines.push([STEP[S.state] || S.state.toUpperCase(), S.state === 'breakaway' ? '#ff4a3d' : '#e8f4ff', '600 12px']);
        if (S.state === 'rendezvous') {
            // the heading to fly (to the intercept point) and the height to hold
            const rpt = this.rvPoint || (this.rvPoint = new THREE.Vector3());
            rendezvousPoint(p, S.tanker, rpt);
            const brg = BR.bearing(p.pos.x, p.pos.z, rpt.x, rpt.z);
            lines.push(['STEER ' + BR.pad3(brg) + ' · ' + BR.angels(rpt.y * M_TO_FT) + ' (1,000 FT BELOW THE TANKER)', '#e8f4ff', '600 12px']);
            const R = hud.project(rpt, cam, {});
            if (R.front && R.x > 0 && R.x < hud.w && R.y > 0 && R.y < hud.h) {
                ctx.strokeStyle = 'rgba(111,224,255,0.8)'; ctx.lineWidth = 1.4;
                ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; ctx[k ? 'lineTo' : 'moveTo'](R.x + Math.cos(a) * 9, R.y + Math.sin(a) * 9); } ctx.closePath(); ctx.stroke();
                ctx.fillStyle = 'rgba(111,224,255,0.9)'; ctx.textAlign = 'center'; ctx.fillText('RV', R.x, R.y + 20);
            }
        }
        const rate = S.rate, cap = fuelKg(p.type);
        lines.push(['FUEL ' + Math.round((p.fuel ?? 1) * 100) + '% · ONLOAD ' + Math.round(S.onload / LB).toLocaleString('en-US') + ' LB' + (S.flow ? ' · ' + Math.round(rate * 60 / LB).toLocaleString('en-US') + ' LB/MIN · FULL IN ' + formatClock(timeToFull(p.type, p.fuel ?? 1, rate)) : ''), S.flow ? GREEN : '#9fd4ff', '600 12px']);
        lines.push([S.auto ? 'AR AUTOPILOT ON — STICK TO TAKE OVER (Y: OFF)' : 'Y: AR AUTOPILOT · \\ SUPPORT › TANKER', S.auto ? GREEN : 'rgba(232,244,255,0.6)', '600 11px']);
        void cap;
        let y = y0;
        ctx.textAlign = 'right';
        const wmax = lines.reduce((m, l) => { ctx.font = l[2] + ' ' + FONT; return Math.max(m, ctx.measureText(l[0]).width); }, 0);
        ctx.fillStyle = 'rgba(6,12,18,0.45)'; ctx.fillRect(x - wmax - 12, y - 12, wmax + 18, lines.length * 17 + 8);
        for (const [t, col, f] of lines) { ctx.font = f + ' ' + FONT; ctx.fillStyle = col; ctx.fillText(t, x, y); y += 17; }
        // close in: where the receptacle / probe should go, and where it is
        if (S.state === 'precontact' || S.state === 'contact' || S.state === 'breakaway' || S.state === 'observe' || S.state === 'join') {
            const tgt = toWorld(tk, S.tgtL, _v);
            const T = hud.project(tgt, cam, {});
            const me = toWorld(p, S.useRef ? S.ref : _v3.set(0, 0, 0), _v2);
            const M = hud.project(me, cam, {});
            if (T.front && d < 1500) {
                ctx.strokeStyle = cyan; ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.moveTo(T.x - 10, T.y); ctx.lineTo(T.x + 10, T.y); ctx.moveTo(T.x, T.y - 10); ctx.lineTo(T.x, T.y + 10); ctx.stroke();
                if (M.front) { ctx.beginPath(); ctx.arc(M.x, M.y, 6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(M.x, M.y); ctx.lineTo(T.x, T.y); ctx.stroke(); ctx.setLineDash([]); }
                const e = S.err;
                ctx.fillStyle = cyan; ctx.textAlign = 'left'; ctx.font = '600 11px ' + FONT;
                const fmt = (v, a, b) => (Math.abs(v) < 0.3 ? '' : (v > 0 ? a : b) + ' ' + Math.abs(v).toFixed(1) + ' ');
                ctx.fillText((fmt(e.eu, 'UP', 'DOWN') + fmt(e.es, 'RIGHT', 'LEFT') + fmt(e.ea, 'FWD', 'AFT')).trim() || 'ON THE SPOT', T.x + 14, T.y + 14);
            }
            if (S.station === 'boom' && (S.state === 'contact' || S.state === 'precontact') && d < 400) this.drawPDI(ctx, hud, S, tk);
            if (S.station !== 'boom' && (S.state === 'contact' || S.state === 'precontact') && d < 400) this.drawHoseLights(ctx, hud, S, tk);
        }
    }

    // the boom's pilot director lights (under the KC-135's belly): UP / DOWN and FORE / AFT
    drawPDI(ctx, hud, S, tk) {
        const cam = this.game.camera;
        const at = toWorld(tk, _v.set(0, -2.2, -tk.spec.length * 0.12), _v2);
        let P = hud.project(at, cam, {});
        if (!P.front) P = { x: hud.w / 2, y: hud.h * 0.3 };
        const st = S.stat;
        const bar = (x, k, zone, top, bottom) => {
            const H = 90;
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 9, P.y - H / 2 - 16, 18, H + 32);
            for (let i = 0; i < 9; i++) {
                const yy = P.y - H / 2 + i * H / 8;
                const c = i === 4 ? '#3dff7a' : i === 3 || i === 5 ? '#3dff7a' : i < 2 || i > 6 ? '#ff4a3d' : '#ffc23f';
                ctx.fillStyle = c; ctx.globalAlpha = 0.2; ctx.fillRect(x - 6, yy - 4, 12, 8); ctx.globalAlpha = 1;
            }
            // lit: the command — toward the letter to move to
            const yy = P.y - clamp(k, -1, 1) * H / 2;
            ctx.fillStyle = zone === 'green' ? '#3dff7a' : zone === 'amber' ? '#ffc23f' : '#ff4a3d';
            ctx.fillRect(x - 7, yy - 5, 14, 10);
            ctx.font = '700 12px ' + FONT; ctx.textAlign = 'center'; ctx.fillStyle = '#e8f4ff';
            ctx.fillText(top, x, P.y - H / 2 - 9); ctx.fillText(bottom, x, P.y + H / 2 + 9);
        };
        if (!st || st.elev == null) return;
        bar(P.x - 40, st.elev, st.elevZone, 'U', 'D');
        bar(P.x + 40, st.tel, st.telZone, 'F', 'A');
        ctx.font = '600 10px ' + FONT; ctx.fillStyle = 'rgba(232,244,255,0.7)'; ctx.textAlign = 'center';
        ctx.fillText('ELEV ' + (S.sol.pitch / DEG).toFixed(0) + '° · AZ ' + (S.sol.yaw / DEG).toFixed(0) + '° · TEL ' + (S.sol.ext * 3.281).toFixed(0) + ' FT', P.x, P.y + 70);
    }

    // a hose's signal lights (on the pod) and the basket
    drawHoseLights(ctx, hud, S, tk) {
        const cam = this.game.camera, ops = S.ops;
        const B = ops.basketPos(S.station, _v);
        const Pb = hud.project(toWorld(tk, S.attached ? S.tip : B, _v2), cam, {});
        const dr = ops.rig.drogues[S.station];
        const Pp = hud.project(toWorld(tk, dr.E, _v3), cam, {});
        if (Pb.front && !S.attached) { ctx.strokeStyle = '#6fe0ff'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(Pb.x, Pb.y, 14, 0, Math.PI * 2); ctx.stroke(); }
        const P = Pp.front ? Pp : { x: hud.w / 2, y: hud.h * 0.3 };
        const light = S.light;
        const flash = light === 'amber-flash' && (this.game.time * 3) % 1 < 0.5;
        const cols = [['#ff4a3d', light === 'red'], ['#ffc23f', light === 'amber' || (light === 'amber-flash' && !flash)], ['#3dff7a', light === 'green']];
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(P.x - 30, P.y - 12, 60, 24);
        cols.forEach(([c, on], i) => { ctx.fillStyle = c; ctx.globalAlpha = on ? 1 : 0.15; ctx.beginPath(); ctx.arc(P.x - 18 + i * 18, P.y, 7, 0, Math.PI * 2); ctx.fill(); });
        ctx.globalAlpha = 1;
        if (S.attached) {
            ctx.font = '600 10px ' + FONT; ctx.fillStyle = 'rgba(232,244,255,0.8)'; ctx.textAlign = 'center';
            ctx.fillText('HOSE IN ' + S.dst.pushIn.toFixed(1) + ' M (1–6 GREEN)', P.x, P.y + 22);
        }
    }

    // the Growler's EW page: what the receivers hear round the jet, the pods' sector, the list, the keys
    drawEwPage(ctx, hud, p) {
        const g = this.game, war = g.war;
        const list = this.ewList(p);
        const j = this.playerJammer(p);
        const W = 300, H = 330, x = hud.w - W - (hud.compact ? 10 : 28), y = hud.h * 0.5 - H / 2 - 20;
        ctx.fillStyle = 'rgba(2,14,8,0.72)'; ctx.fillRect(x, y, W, H);
        ctx.strokeStyle = 'rgba(93,255,160,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
        ctx.font = '700 13px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = GREEN;
        ctx.fillText('EW · ALQ-99 ' + (j.on ? 'JAM' : 'STBY') + ' · HARM ' + (p.harms ?? 0), x + 10, y + 16);
        // the threat display: the jet in the middle, nose up, 80 km ring
        const cx = x + W / 2, cy = y + 120, R = 88, range = 80000;
        ctx.strokeStyle = 'rgba(93,255,160,0.35)';
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, R / 2, 0, Math.PI * 2); ctx.stroke();
        const fwd = p.getForward(_v), hdg = Math.atan2(fwd.x, -fwd.z);
        if (j.on) {
            ctx.fillStyle = 'rgba(93,255,160,0.16)';
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, j.brg - hdg - Math.PI / 2 - j.half, j.brg - hdg - Math.PI / 2 + j.half); ctx.closePath(); ctx.fill();
        }
        list.forEach((e, i) => {
            const b = bearingRad(p.pos, e.u.pos) - hdg, r = Math.min(e.d / range, 1) * R;
            const ex = cx + Math.sin(b) * r, ey = cy - Math.cos(b) * r;
            const jammed = j.on && jamToNoise(e.u.pos, p.pos, j) > 10;
            ctx.fillStyle = i === this.ew.sel ? '#ffffff' : e.em.hot ? '#ff5a4a' : AMBER;
            ctx.font = '700 11px ' + FONT; ctx.textAlign = 'center';
            ctx.fillText(e.em.kind === 'track' ? (e.u.type === 'msam' ? '8' : '6') : e.em.kind === 'search' ? 'S' : e.em.kind === 'aaa' ? 'A' : e.em.kind === 'naval' ? 'N' : 'W', ex, ey);
            if (i === this.ew.sel) { ctx.strokeStyle = '#ffffff'; ctx.strokeRect(ex - 8, ey - 8, 16, 16); }
            if (jammed) { ctx.strokeStyle = 'rgba(93,255,160,0.8)'; ctx.beginPath(); ctx.arc(ex, ey, 10, 0, Math.PI * 2); ctx.stroke(); }
        });
        ctx.fillStyle = GREEN; ctx.beginPath(); ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 5, cy + 5); ctx.lineTo(cx - 5, cy + 5); ctx.closePath(); ctx.fill();
        // the list
        let yy = y + 226;
        ctx.textAlign = 'left'; ctx.font = '600 11px ' + FONT;
        if (!list.length) { ctx.fillStyle = 'rgba(232,244,255,0.6)'; ctx.fillText('NO EMITTERS HEARD', x + 10, yy); yy += 15; }
        list.slice(0, 5).forEach((e, i) => {
            const sel = i === this.ew.sel;
            const jf = war.jamFactor(e.u.team, e.u.pos, p.pos);
            const state = !j.on ? '' : jf < 0.45 ? (e.d < (e.em.hot ? 60000 : 90000) * jf ? ' BURN' : ' JAMMED') : '';
            ctx.fillStyle = sel ? '#ffffff' : e.em.hot ? '#ff9f5a' : '#e8f4ff';
            ctx.fillText((sel ? '▶ ' : '  ') + e.em.name + ' ' + BR.pad3(BR.bearing(p.pos.x, p.pos.z, e.u.pos.x, e.u.pos.z)) + '° ' + (e.d / 1000).toFixed(0) + 'KM' + state, x + 10, yy, W - 20);
            yy += 15;
        });
        ctx.fillStyle = 'rgba(232,244,255,0.55)'; ctx.font = '600 10px ' + FONT;
        ctx.fillText('[ ] SELECT · ; JAM ON/OFF · \' POINT PODS · M HARM · F4 CLOSE', x + 10, y + H - 10, W - 20);
    }
}

// (helpers)
function headingOf(p) { const f = p.getForward(_v); return Math.atan2(f.x, -f.z); }
function formatClock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

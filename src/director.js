// ═══════════════════════════════════════════════════════════════
// The director (docs/WAR.md): keeps the war happening around the player, a plug-in system (systems.js) that
// runs in the Living War and in the Sandbox. Scaled by difficulty, never more than a few threats at once.
//  • flights — groups of aircraft with a role (CAP, raid, escort, recon, intercept, strike package, CAS)
//    that are simulated coarsely far away (a position moving along a route, no mesh, fights and air defences
//    resolved by odds) and become real jets with AI (aircraft.js, ai.js) within ~20 km of the player, and
//    abstract again past ~30 km
//  • enemy: CAP stations over their ground, radar-directed scrambles when their radars see the player (no
//    radars, no scrambles), raids on our bases, towns, radars and the carrier, recon flights, supply convoys on
//    the road network, the carrier group moving, and missile strikes from a launcher hidden in their
//    territory ("MISSILE LAUNCH DETECTED")
//  • friendly: CAP, strike packages against what the player has identified, convoys that need an escort, and
//    flights and troops that call for help
//  • the air picture: our radars (a real radar at each of our airfields, the carrier's) detect enemy flights
//  • radio: paced (a few seconds between calls, stale chatter dropped), each speaker with their own voice
//  • war-mode glue: where to respawn, the objective line, ending a sortie on the ground; fuel depots keep
//    burning for the whole war
// Other plug-ins: director.flights, director.convoys, director.say(from, text, opts), director.spawnFlight(o),
// director.materialize(f) / dematerialize(f); events 'raidDetected', 'raidHit', 'flightDown',
// 'convoyStarted', 'convoyUnderAttack', 'convoyArrived', 'convoyLost', 'supportRequest', 'packageTasked',
// 'telPreparing', 'reconDetected'.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { AIRCRAFT, WEAPONS } from './config.js';
import { Aircraft } from './aircraft.js';
import { Pilot } from './ai.js';
import { BASES, terrainHeight, groundHeight, baseToWorld, isOnRunway } from './world.js';
import { INTEL } from './war.js';
import { GroundLauncher } from './strikes.js';
import { findOcean } from './naval.js';
import { VEHICLES, pose, raise, deployJacks, deployPad } from './vehicles.js';
import { dress } from './dressing.js';
import { clamp, rand, pick, lerp } from './util.js';

const MAT_R = 18000, DEMAT_R = 27000; // flights become real jets this close to the player, abstract past that
const SPACING = 32;                     // convoy vehicle spacing (m)
const RED_FIGHTERS = ['su35', 'mig29', 'j10', 'su57', 'j20', 'mig21', 'mirage'];
const RED_STRIKERS = ['su35', 'j10', 'mig29', 'j8'];
const BLUE_FIGHTERS = ['f15', 'f16', 'typhoon', 'rafale', 'f14'];
const BLUE_STRIKERS = ['f16', 'fa18', 'f15'];
const BLUE_CALLS = ['SPRINGFIELD', 'ENFIELD', 'UZI', 'COLT', 'DODGE', 'PONTIAC', 'CHEVY', 'FORD'];
const CONVOY_CALLS = ['CARAVAN', 'MULE', 'PACKHORSE', 'WAGON'];
const RED_CONVOY = ['truck', 'fueltruck', 'truck', 'spaag', 'truck', 'msam', 'fueltruck', 'tank'];
const BLUE_CONVOY = ['humvee', 'truck', 'fueltruck', 'truck', 'truck', 'humvee'];
const VEH_NAMES = {
    red: { truck: 'URAL-4320 AMMUNITION TRUCK', fueltruck: 'ATZ-5 FUEL TANKER', spaag: 'ZSU-23-4 SHILKA', msam: 'SA-8 GECKO', tank: 'T-72 TANK', humvee: 'BRDM SCOUT CAR' },
    blue: { truck: 'HEMTT CARGO TRUCK', fueltruck: 'HEMTT FUELER', humvee: 'M1126 STRYKER', tank: 'M1 ABRAMS', spaag: 'M163 VULCAN', msam: 'M1097 AVENGER' },
};
const VEH_CLS = { truck: 'vehicle', fueltruck: 'vehicle', humvee: 'vehicle', tank: 'tank', spaag: 'aaa', msam: 'sam' };
// the rigged models (vehicles.js) the convoy stand-ins wear once they've loaded
const VEH_MODEL = { red: { truck: 'ammo_red', fueltruck: 'fuel_red', msam: 'osa' }, blue: { truck: 'ammo_blue', fueltruck: 'fuel_blue', humvee: 'stryker' } };
const TEL_MUZZLE = new THREE.Vector3(0, 7.8, 5.2); // the erected Scud's middle (it stands on its pad at the rear)

// Radio voices: each speaker keeps theirs (audio.say picks a system voice by name when there is one)
export const VOICES = {
    COMMAND: { pitch: 0.78, rate: 1.05, name: 'Daniel|UK English Male|Arthur' },
    MAGIC: { pitch: 1.05, rate: 1.22, name: 'Alex|US English|Aaron' },
    INTEL: { pitch: 0.9, rate: 1.1 },
    ground: { pitch: 0.7, rate: 1.12, name: 'Fred|Ralph' },
    flight: { pitch: 1.0, rate: 1.28, name: 'Tom|Albert' },
};
export function voiceFor(from) {
    if (!from) return null;
    if (VOICES[from]) return VOICES[from];
    if (/WARHORSE|GRIZZLY|BULLDOG|CARAVAN|MULE|PACKHORSE|WAGON/.test(from)) return VOICES.ground;
    return VOICES.flight;
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const ALLIED = { team: 'allied', name: 'ALLIED AIRCRAFT', isAllied: true }; // abstract friendly fire (not the player's score)
const HOSTILE = { team: 'red-ai', name: 'ENEMY AIRCRAFT' };

// ═════════════ Flights ═════════════
// A group of aircraft with a job. Far away: a position moving along a route (no mesh); near the player: real
// Aircraft with Pilots (members), handed back to the abstract state when the player leaves.
export class Flight {
    constructor(dir, o) {
        this.dir = dir; this.game = dir.game;
        this.id = dir.nextId++;
        this.team = o.team; this.role = o.role;
        this.callsign = o.callsign || (o.team === 'red' ? 'RAID' : 'FLIGHT');
        this.types = o.types.slice();
        this.hp = this.types.map(() => 1);
        this.bombs = this.types.map(() => o.bombs || 0);
        this.pos = new THREE.Vector3().copy(o.pos);
        this.vel = new THREE.Vector3();
        this.speed = o.speed || 210;
        this.route = (o.route || []).map(r => (r.p ? r : { p: r }));
        this.wp = 0;
        this.loiter = o.loiter || null;       // { center: Vector3 (y = altitude), R, until (war time) }
        this.orbitA = Math.random() * Math.PI * 2;
        this.target = o.target || null;       // { pos, unit, label, kind }
        this.home = o.home || null;           // Vector3: where it goes back to
        this.escortOf = o.escortOf || null;   // the flight it protects
        this.skill = o.skill ?? 0.6;
        this.members = null;
        this.state = 'out';
        this.t = 0;
        this.detected = false; this.seenT = -1e9; this.announced = false;
        this.lastPos = new THREE.Vector3().copy(o.pos);
        this.done = false;
        this.tag = o.tag || null;
    }
    get n() {
        if (this.members) { let k = 0; for (const a of this.members) if (a.alive) k++; return k; }
        let k = 0; for (const h of this.hp) if (h > 0) k++; return k;
    }
    get fighters() { return this.role === 'cap' || this.role === 'escort' || this.role === 'intercept' || this.role === 'sweep'; }
    lead() { if (!this.members) return null; for (const a of this.members) if (a.alive) return a; return null; }
}

// ═════════════ Convoys ═════════════
// A column of ground targets driving a road (ground.js GroundTarget.follow): toward the front, to deliver
// supply. A bridge down ahead stops it; it waits, then turns back.
export class Convoy {
    constructor(dir, { team, path, sign, types, callsign }) {
        const g = dir.game;
        this.dir = dir; this.game = g;
        this.id = dir.nextId++;
        this.team = team; this.path = path; this.sign = sign; this.callsign = callsign;
        this.state = 'move'; this.haltT = 0; this.t = 0;
        this.endS = sign > 0 ? path.len : 0;
        const startS = sign > 0 ? 0 : path.len;
        const lead = startS + sign * (Math.min(path.len * 0.12, 300) + SPACING * (types.length - 1));
        this.vehicles = types.map((type, i) => {
            const t = g.ground.addTarget(type, 0, 0, 0, team);
            t.follow(path, lead - sign * SPACING * i, sign);
            t.route.cruise = 11;
            t.convoyOf = this;
            t.name = VEH_NAMES[team][type] || t.name;
            t.def = { ...t.def, name: t.name };
            g.war.add(t, { cls: VEH_CLS[type] || 'vehicle', name: t.name, conceal: team === 'red' ? 0.15 : 0 });
            if (VEH_MODEL[team][type]) dress(t, VEH_MODEL[team][type], { pose: 'road' });
            return t;
        });
        this.total = this.vehicles.length;
        g.world.towns?.traffic?.clearPath?.(path);
        const endP = path.pts[sign > 0 ? path.pts.length - 1 : 0];
        this.destPos = new THREE.Vector3(endP.x, endP.y, endP.z);
        this.destName = dir.placeName(this.destPos);
    }
    alive() { return this.vehicles.filter(v => v.alive && !v.removed); }
    leadVehicle() {
        let best = null, bs = -Infinity;
        for (const v of this.vehicles) if (v.alive && !v.removed && v.route && v.route.s * this.sign > bs) { bs = v.route.s * this.sign; best = v; }
        return best;
    }
    centre(out) {
        const a = this.alive();
        out.set(0, 0, 0);
        if (!a.length) return out.copy(this.destPos);
        for (const v of a) out.add(v.pos);
        return out.divideScalar(a.length);
    }
}

export class Director {
    constructor(game) {
        this.game = game;
        this.enabled = false;
        this.flights = [];
        this.convoys = [];
        this.burning = [];
        this.queue = [];
        this.nextId = 1;
        this.lastRadio = -1e9;
        game.events.on('killed', (ac, d = {}) => this.onAircraftKilled(ac, d.source));
        game.events.on('groundKilled', (t, d = {}) => this.onGroundKilled(t, d.source));
        game.events.on('strategicLaunch', (m) => this.onLaunch(m));
    }

    // ═════════════ Lifecycle ═════════════
    start(mode) {
        this.clear();
        this.mode = mode;
        this.enabled = mode === 'war' || mode === 'sandbox';
        if (!this.enabled) return;
        const g = this.game;
        const k = this.intensity();
        this.capT = rand(25, 45);
        this.blueCapT = rand(40, 70);
        this.raidT = rand(150, 210) / k;
        this.reconT = rand(420, 600) / k;
        this.redConvoyT = rand(40, 80);
        this.blueConvoyT = rand(220, 320);
        this.missileT = rand(330, 450) / k;
        this.fleetT = rand(600, 900);
        this.packageT = 120;
        this.gciAcc = 0; this.lastScramble = -1e9;
        this.lodT = 0; this.picT = 0; this.combatT = 0; this.thinkT = 1;
        this.placeDefences();
        if (g.naval && g.naval.homeCarrier) g.naval.homeCarrier.radarRange = 90000;
        if (g.naval && g.naval.enemyCarrier) g.naval.enemyCarrier.radarRange = 80000;
        if (mode === 'war') {
            g.showBanner('LIVING WAR', 'The front is a few minutes north. \\ command menu · ` tactical map · , mark a target', 7, '#ffc23f');
            this.sitrep();
        }
    }

    clear() {
        // (the game has already removed every aircraft by now: the flights just go)
        this.flights.length = 0;
        this.convoys.length = 0;
        this.burning.length = 0;
        this.queue.length = 0;
        this.tel = null;
        this.defences = [];
        this.enabled = false;
        this.fleetMove = null;
        this.endOffered = false;
    }

    // how busy the enemy is (rookie ~0.8 … ace ~1.3)
    intensity() { const sk = (this.game.difficulty || { skill: 0.6 }).skill; return 0.55 + sk * 0.8; }

    focus() {
        const g = this.game;
        if (g.pilotMode) return g.pilotMode.pos;
        if (g.player && g.player.alive) return g.player.pos;
        return g.camera.position;
    }

    // ═════════════ Radio (paced) ═════════════
    // opts: war.radio's (color, say, priority) plus ttl (s a line may wait before it's stale), and group + merge:
    // lines of a group that pile up while they wait become one (merge(count) gives its text) — a burst of new
    // contacts is one call, not six
    say(from, text, opts = {}) {
        const g = this.game, now = g.time;
        const o = { voice: voiceFor(from), ...opts };
        if (o.group && !o.priority) {
            const q = this.queue.find(x => x.o.group === o.group && x.from === from);
            if (q) { q.count = (q.count || 1) + 1; q.text = o.merge ? o.merge(q.count, text) : text; q.o.say = false; return; }
        }
        if (o.priority || (!this.queue.length && now - this.lastRadio > 3.5)) { this.send(from, text, o); return; }
        if (this.queue.length >= 6) this.queue.shift();
        this.queue.push({ from, text, o, t: now });
    }
    send(from, text, o) {
        this.lastRadio = this.game.time;
        this.game.war.radio(from, text, o);
    }
    flushRadio() {
        const now = this.game.time;
        while (this.queue.length && now - this.queue[0].t > (this.queue[0].o.ttl ?? 25)) this.queue.shift();
        if (this.queue.length && now - this.lastRadio > 3.5) { const q = this.queue.shift(); this.send(q.from, q.text, q.o); }
    }

    sitrep() {
        const fr = this.game.front;
        const hot = fr && fr.sectors.length ? fr.sectors.reduce((a, s) => (s.intensity > a.intensity ? s : a), fr.sectors[0]) : null;
        this.say('COMMAND', 'ALL STATIONS, SKYWAR COMMAND. THE FRONT IS HOLDING' + (hot ? ' — HEAVY FIGHTING IN ' + fr.sectorLabel(hot) : '') + '. TASKS WILL FOLLOW', { color: '#9fd4ff', say: 'All stations, Skywar command. The front is holding. Stand by for tasking.' });
    }

    // a place name for the radio: the nearest named town, or a grid
    placeName(pos) {
        const towns = this.game.world.towns ? this.game.world.towns.towns : [];
        let best = null, bd = 6000;
        for (const t of towns) { const d = Math.hypot(t.x - pos.x, t.z - pos.z); if (d < bd && t.mapName) { bd = d; best = t; } }
        return best ? best.mapName.toUpperCase() : 'GRID ' + this.game.war.grid(pos.x, pos.z);
    }

    // ═════════════ Our airfields' defences: a radar each, SAMs at home ═════════════
    placeDefences() {
        const g = this.game;
        if (!g.ground || !g.ground.addTarget) return;
        this.defences = [];
        const put = (base, type, lx, lz, name) => {
            const w = baseToWorld(base, lx, lz);
            if (terrainHeight(w.x, w.z) < 2 || isOnRunway(w.x, w.z)) return null;
            const u = g.ground.addTarget(type, w.x, w.z, -base.heading, 'blue');
            u.name = name; u.def = { ...u.def, name };
            if (type === 'radar') u.radarRange = 85000;
            g.war.add(u, { name, cls: type === 'radar' ? 'radar' : 'sam' });
            // the Patriot launching station, emplaced: outriggers down, mast up, canisters raised
            if (type === 'sam') dress(u, 'patriot_ln', { pose: 'emplaced', onRig: (rig) => { for (const k of VEHICLES.patriot_ln.deploy) pose(rig, k, 1); } });
            this.defences.push(u);
            return u;
        };
        const home = BASES.find(b => b.id === 'home'), mir = BASES.find(b => b.id === 'miramar');
        if (home) { put(home, 'radar', -760, -1050, 'AN/TPS-75 RADAR'); put(home, 'sam', -820, 600, 'PATRIOT BATTERY'); }
        if (mir) put(mir, 'radar', 1250, 1500, 'AN/TPS-75 RADAR');
    }

    // ═════════════ Flights: making, LOD, flying ═════════════
    spawnFlight(o) {
        const f = new Flight(this, o);
        this.flights.push(f);
        return f;
    }

    // make the flight's jets real, in formation where it is
    materialize(f) {
        const g = this.game;
        if (f.members) return;
        f.members = [];
        let hx = f.vel.x, hz = f.vel.z;
        if (Math.hypot(hx, hz) < 1) { const P = this.nextPoint(f); hx = P.x - f.pos.x; hz = P.z - f.pos.z; }
        const L = Math.hypot(hx, hz) || 1;
        hx /= L; hz /= L;
        const heading = Math.atan2(-hx, -hz);
        const blue = f.team === g.war.side;
        let k = 0;
        for (let i = 0; i < f.types.length; i++) {
            if (f.hp[i] <= 0) continue;
            const a = new Aircraft(g, f.types[i], { team: f.team, name: blue ? f.callsign + ' ' + (i + 1) : null });
            const back = 150 * k, side = k ? (k % 2 ? 1 : -1) * 110 * Math.ceil(k / 2) : 0;
            const x = f.pos.x - hx * back - hz * side, z = f.pos.z - hz * back + hx * side;
            const y = Math.max(f.pos.y + k * 25, groundHeight(x, z) + 350);
            a.spawnAir(_v.set(x, y, z), heading, 0.62);
            a.health = a.maxHealth * clamp(f.hp[i], 0.2, 1);
            a.bombs = f.bombs[i];
            a.rockets = f.role === 'cas' ? 12 : 0;
            a.flares = f.team === 'red' ? 8 : 16;
            a.slot = i;
            a.flight = f;
            const pl = new Pilot(g, a, clamp(f.skill + rand(-0.08, 0.08), 0.2, 1));
            this.configure(f, a, pl);
            g.aircraft.push(a);
            f.members.push(a);
            g.war.add(a, { cls: 'aircraft', name: blue ? a.callsign : a.spec.name.toUpperCase() });
            k++;
        }
        f.matT = g.war.time;
    }

    // what the pilots do, by role
    configure(f, a, pl) {
        const g = this.game;
        pl.passive = false; pl.waypoint = null; pl.leash = 0; pl.home = null; pl.brain = null;
        switch (f.state === 'rtb' ? 'rtb' : f.role) {
            case 'cap': pl.home = (f.loiter ? f.loiter.center : f.pos).clone(); pl.leash = 16000; break;
            case 'intercept': case 'sweep': pl.home = (f.anchor || f.pos).clone(); pl.leash = 22000; break;
            case 'escort': pl.home = (f.escortOf && !f.escortOf.done ? f.escortOf.pos : f.pos).clone(); pl.leash = 9000; break;
            case 'cas': {
                pl.home = (f.target ? f.target.pos : f.pos).clone(); pl.leash = 9000;
                // strafe what's on the ground at the target, unless a fighter is on us
                pl.brain = { pick: (p) => this.casPick(f, p) };
                break;
            }
            default: {
                // raids, strike packages, recon, going home: fly the route
                pl.passive = true;
                pl.cruise = f.role === 'recon' ? 0.95 : 0.72;
                pl.waypoint = this.flyPoint(f).clone();
            }
        }
        void g;
    }

    casPick(f, p) {
        const g = this.game, ac = p.ac;
        for (const e of g.aircraft) if (e.alive && e.team !== ac.team && !e.onGround && e.pos.distanceToSquared(ac.pos) < 1600 * 1600) return undefined; // (defend: the usual fight)
        const at = f.target ? f.target.pos : ac.pos;
        let best = null, bd = 3500 * 3500;
        for (const t of g.ground.targets) {
            if (!t.alive || t.removed || t.team === ac.team || t.team === 'neutral' || t.isShip || t.isBridge) continue;
            const d = t.pos.distanceToSquared(at);
            if (d < bd) { bd = d; best = t; }
        }
        return best || undefined;
    }

    // back to abstract: the living jets are taken away (the dead ones fall and burn as usual)
    dematerialize(f) {
        const g = this.game;
        if (!f.members) return;
        const lead = f.lead();
        if (lead) { f.pos.copy(lead.pos); f.vel.copy(lead.vel); }
        for (const a of f.members) {
            f.hp[a.slot] = a.alive ? clamp(a.health / a.maxHealth, 0, 1) : 0;
            f.bombs[a.slot] = a.alive ? (a.bombs | 0) : 0;
            if (!a.alive) continue;
            a.remove();
            const i = g.aircraft.indexOf(a);
            if (i >= 0) g.aircraft.splice(i, 1);
            a.removed = true;
        }
        f.members = null;
    }

    // where the flight is headed next (a route point, its loiter centre, the player it's hunting, a raid its CAP
    // has committed on, or home)
    nextPoint(f) {
        if (f.state === 'rtb' && f.home) return f.home;
        if ((f.role === 'intercept' || f.role === 'sweep') && f.anchor) return f.anchor;
        if (f.vector && !f.vector.done) return f.vector.pos;
        if (f.loiter && this.game.war.time < f.loiter.until) return f.loiter.center;
        if (f.wp < f.route.length) return f.route[f.wp].p;
        return f.home || f.pos;
    }

    // what real jets steer for: on an attack leg the point past the target (the AI circles a waypoint it reaches,
    // so aiming at the target itself would orbit it instead of running over it)
    flyPoint(f) {
        const r = f.route[f.wp];
        if (f.state !== 'rtb' && r && r.attack && f.route[f.wp + 1]) return f.route[f.wp + 1].p;
        return this.nextPoint(f);
    }

    // Level of detail: real jets near the player, abstract far away — within a budget of AI aircraft, and never
    // more enemy fighters around the player than the difficulty allows (the rest wait their turn, abstract)
    updateLOD() {
        const g = this.game, P = this.focus(), war = g.war;
        const k = this.intensity();
        // (each real jet costs ~0.2 ms a frame: rookie 5 / veteran 6 / ace 8, and 2 / 3 / 4 enemy fighters)
        const budget = Math.round(k * 6), fighterCap = Math.round(k * 3);
        let live = 0, redFighters = 0;
        for (const f of this.flights) if (f.members) { live += f.n; if (f.team !== war.side && f.fighters) redFighters += f.n; }
        // nearest first
        const order = this.flights.filter(f => !f.done && f.n > 0).sort((a, b) => a.pos.distanceToSquared(P) - b.pos.distanceToSquared(P));
        for (const f of order) {
            const d = Math.hypot(f.pos.x - P.x, f.pos.z - P.z);
            if (f.members) {
                if (d > DEMAT_R && this.canDemat(f, P)) { live -= f.n; if (f.team !== war.side && f.fighters) redFighters -= f.n; this.dematerialize(f); }
            } else if (d < MAT_R && live + f.n <= budget) {
                if (f.team !== war.side && f.fighters && redFighters + f.n > fighterCap) continue;
                this.materialize(f); live += f.n;
                if (f.team !== war.side && f.fighters) redFighters += f.n;
            }
        }
    }

    // not while anything's shooting at it or chasing it, or it's locked
    canDemat(f, P) {
        const g = this.game;
        for (const a of f.members) {
            if (!a.alive) continue;
            if (a.pos.distanceTo(P) < DEMAT_R * 0.9) return false;
            if (a.incoming.length || g.lockTarget === a) return false;
            if (a.pilot && a.pilot.target && a.pilot.target.pos && a.pilot.target.pos.distanceTo(a.pos) < 6000) return false;
        }
        return true;
    }

    // real flights every frame; abstract ones five times a second (they're only points on a route)
    updateFlights(dt) {
        this.absAcc = (this.absAcc || 0) + dt;
        const abs = this.absAcc >= 0.2 ? this.absAcc : 0;
        if (abs) this.absAcc = 0;
        for (let i = this.flights.length - 1; i >= 0; i--) {
            const f = this.flights[i];
            f.t += dt;
            if (f.members) this.flyReal(f, dt); else if (abs) this.flyAbstract(f, abs);
            if (f.n === 0 && !f.done) this.flightGone(f, 'destroyed');
            if (f.done) {
                if (f.members) this.dematerialize(f);
                this.flights.splice(i, 1);
            }
        }
    }

    flyAbstract(f, dt) {
        const war = this.game.war;
        if (f.n === 0) return;
        f.lastPos.copy(f.pos);
        // escorts stay with their charge
        if (f.role === 'escort' && f.escortOf && !f.escortOf.done && f.state !== 'rtb') {
            f.pos.set(f.escortOf.pos.x + 900, f.escortOf.pos.y + 300, f.escortOf.pos.z + 600);
            f.vel.copy(f.escortOf.vel);
            return;
        }
        if (f.role === 'escort' && (!f.escortOf || f.escortOf.done) && f.state !== 'rtb') this.rtb(f);
        // on station: orbit (unless it's committed on something)
        if (f.loiter && war.time < f.loiter.until && f.state !== 'rtb' && !(f.vector && !f.vector.done)) {
            const c = f.loiter.center;
            if (Math.hypot(f.pos.x - c.x, f.pos.z - c.z) < f.loiter.R * 1.4) {
                f.orbitA += f.speed / f.loiter.R * dt;
                const x = c.x + Math.cos(f.orbitA) * f.loiter.R, z = c.z + Math.sin(f.orbitA) * f.loiter.R;
                f.vel.set((x - f.pos.x) / Math.max(dt, 1e-3), 0, (z - f.pos.z) / Math.max(dt, 1e-3));
                f.pos.set(x, c.y, z);
                return;
            }
        } else if (f.loiter && f.state !== 'rtb' && war.time >= f.loiter.until) { this.rtb(f); }
        // attack aircraft circle over their target while they work on it
        if (f.role === 'cas' && f.state !== 'rtb' && f.target) {
            const T = f.target.pos;
            if (Math.hypot(f.pos.x - T.x, f.pos.z - T.z) < 2500) {
                f.orbitA += f.speed / 1500 * dt;
                f.pos.set(T.x + Math.cos(f.orbitA) * 1500, Math.max(f.pos.y, groundHeight(T.x, T.z) + 700), T.z + Math.sin(f.orbitA) * 1500);
                f.vel.set(-Math.sin(f.orbitA) * f.speed, 0, Math.cos(f.orbitA) * f.speed);
                return;
            }
        }
        const P = this.nextPoint(f);
        const dx = P.x - f.pos.x, dz = P.z - f.pos.z, d = Math.hypot(dx, dz);
        const step = f.speed * dt;
        if (d < step + 400) { this.arrive(f); return; }
        f.vel.set(dx / d * f.speed, 0, dz / d * f.speed);
        f.pos.x += dx / d * step; f.pos.z += dz / d * step;
        f.pos.y += clamp(P.y - f.pos.y, -15 * dt, 15 * dt);
        f.pos.y = Math.max(f.pos.y, groundHeight(f.pos.x, f.pos.z) + 250);
    }

    // a route point reached (abstract or real): on to the next one, and home at the end
    arrive(f) {
        if (f.state === 'rtb') {
            // home: they land (real jets only once nobody's watching)
            const lead = f.lead();
            if (!lead || lead.pos.distanceTo(this.focus()) > 7000) this.flightGone(f, 'landed');
            return;
        }
        const r = f.route[f.wp];
        if (!r) { if (f.loiter && this.game.war.time < f.loiter.until) return; this.rtb(f); return; }
        if (r.attack && !f.members) this.resolveAttack(f);
        f.wp++;
        if (f.wp >= f.route.length && !f.loiter && f.role !== 'intercept' && f.role !== 'cas') { this.rtb(f); return; }
        if (f.members) for (const a of f.members) if (a.alive && a.pilot && a.pilot.passive) a.pilot.waypoint = this.flyPoint(f).clone();
    }

    rtb(f) {
        if (f.state === 'rtb') return;
        f.state = 'rtb';
        if (!f.home) f.home = this.homeFor(f.team, f.pos);
        if (f.members) for (const a of f.members) if (a.alive && a.pilot) { this.configure(f, a, a.pilot); a.pilot.target = null; a.pilot.waypoint = f.home.clone(); }
    }

    homeFor(team, pos) {
        const g = this.game;
        let best = null, bd = Infinity;
        for (const b of BASES) {
            if (b.civil || (team === g.war.side) !== !!b.friendly) continue;
            const d = Math.hypot(b.x - pos.x, b.z - pos.z);
            if (d < bd) { bd = d; best = b; }
        }
        if (!best) return new THREE.Vector3(pos.x, 3000, pos.z - (team === 'red' ? 40000 : -40000));
        return new THREE.Vector3(best.x, best.h + 1500, best.z);
    }

    flightGone(f, why) {
        if (f.done) return;
        f.done = true;
        f.endedBy = why;
        this.game.events.emit('flightDone', f, { why });
        const war = this.game.war;
        // a spy plane that got home: they know where our carrier is now
        if (why === 'landed' && f.role === 'recon' && f.target && f.target.kind === 'carrier' && f.team !== war.side) {
            this.reconSawCarrier = true;
            if (f.detected) this.say('INTEL', 'THE ENEMY RECON FLIGHT GOT HOME — EXPECT THEM TO KNOW WHERE THE CARRIER IS', { color: '#ff9f5a', say: false });
        }
        if (why === 'destroyed' && f.team !== war.side && f.detected && (f.role === 'raid' || f.role === 'recon' || f.role === 'cas')) {
            this.say('MAGIC', pick(['PICTURE CLEAN — ', 'SCRATCH ONE — ', 'GOOD WORK — ']) + (f.role === 'raid' ? 'RAID DESTROYED' : f.role === 'recon' ? 'RECON FLIGHT DOWN' : 'ATTACK AIRCRAFT DOWN'), { color: '#5dffa0', say: false });
        }
        if (why === 'destroyed' && f.team === war.side && f.role !== 'wing') this.say('COMMAND', f.callsign + ' FLIGHT IS LOST', { color: '#ff4a3d', say: false });
    }

    // Real jets: follow their lead, advance the route, drop bombs on the target, go home when done
    flyReal(f, dt) {
        const g = this.game, war = g.war;
        const lead = f.lead();
        if (!lead) return;
        f.lastPos.copy(f.pos);
        f.pos.copy(lead.pos); f.vel.copy(lead.vel);
        for (const a of f.members) if (!a.alive && f.hp[a.slot] > 0) f.hp[a.slot] = 0;
        // fighters: keep their anchors current, go home when the time's up
        if (f.state !== 'rtb') {
            if (f.role === 'escort') {
                if (!f.escortOf || f.escortOf.done) this.rtb(f);
                else for (const a of f.members) if (a.alive && a.pilot && a.pilot.home) a.pilot.home.copy(f.escortOf.pos);
            } else if ((f.role === 'intercept' || f.role === 'sweep') && f.anchor) {
                for (const a of f.members) if (a.alive && a.pilot && a.pilot.home) a.pilot.home.copy(f.anchor);
            } else if (f.role === 'cap' && f.loiter) {
                // a CAP committed on a raid chases it; otherwise it minds its station
                const at = f.vector && !f.vector.done ? f.vector.pos : f.loiter.center;
                for (const a of f.members) if (a.alive && a.pilot && a.pilot.home) { a.pilot.home.copy(at); a.pilot.leash = f.vector && !f.vector.done ? 20000 : 16000; }
            }
            if (f.loiter && war.time >= f.loiter.until) this.rtb(f);
            if (f.endT && war.time > f.endT) this.rtb(f);
        }
        const passive = f.state === 'rtb' || (!f.fighters && f.role !== 'cas');
        if (passive) {
            const P = this.nextPoint(f);
            if (Math.hypot(P.x - lead.pos.x, P.z - lead.pos.z) < 2200 && (f.state === 'rtb' || !f.route[f.wp] || !f.route[f.wp].attack)) this.arrive(f);
            if (f.target && f.role !== 'recon' && f.state !== 'rtb') this.bombRun(f);
        }
        if (f.role === 'cas' && f.state !== 'rtb' && f.t > 200) this.rtb(f);
    }

    // release bombs where they'll land on the target (a falling bomb, no drag: good to ~50 m)
    bombRun(f) {
        const g = this.game, T = f.target.unit && f.target.unit.alive ? f.target.unit.pos : f.target.pos;
        let left = 0;
        for (const a of f.members) {
            if (!a.alive || !(a.bombs > 0)) continue;
            left++;
            const hd = Math.hypot(T.x - a.pos.x, T.z - a.pos.z);
            if (hd > 15000) continue;
            const gy = Math.max(groundHeight(T.x, T.z), 0), h = a.pos.y - gy, vy = a.vel.y;
            if (h < 60) continue;
            // a quick estimate first (no drag); the real fall only near the release point
            const tf = (vy + Math.sqrt(vy * vy + 2 * 9.81 * h)) / 9.81;
            if (Math.hypot(a.pos.x + a.vel.x * tf * 0.9 - T.x, a.pos.z + a.vel.z * tf * 0.9 - T.z) > 1500) continue;
            const p = this.bombFall(a, gy, _v2);
            const miss = Math.hypot(p.x - T.x, p.z - T.z);
            a._drop = (a._drop || 0);
            if (miss < 70 + a._drop * 35 && (!a._dropT || g.time - a._dropT > 0.3)) {
                g.weapons.dropBomb(a);
                a.bombs--; a._drop++; a._dropT = g.time;
                f.dropped = (f.dropped || 0) + 1;
            }
        }
        // past it with bombs gone (or overflown): on to the next point
        const r = f.route[f.wp];
        const lead = f.lead();
        if (r && r.attack && lead) {
            const past = (lead.pos.x - T.x) * lead.vel.x + (lead.pos.z - T.z) * lead.vel.z > 0 && Math.hypot(T.x - lead.pos.x, T.z - lead.pos.z) > 1500;
            if (!left || past) {
                if (!f.hitReported) this.raidOutcome(f, (f.dropped || 0) > 0);
                this.arrive(f);
            }
        }
    }

    // where a bomb let go now lands on the plane y = gy: the fall weapons.js flies (gravity, its drag), in 0.1 s steps
    bombFall(a, gy, out) {
        const drag = WEAPONS.bomb.drag;
        let x = a.pos.x, y = a.pos.y - 2.2, z = a.pos.z, vx = a.vel.x, vy = a.vel.y - 4, vz = a.vel.z;
        for (let t = 0; t < 60 && y > gy; t += 0.1) {
            vy -= 9.81 * 0.1;
            const k = 1 - drag * 0.1;
            vx *= k; vy *= k; vz *= k;
            x += vx * 0.1; y += vy * 0.1; z += vz * 0.1;
        }
        return out.set(x, gy, z);
    }

    // Abstract attack on arrival: what the bombs would have done (odds by warhead), then the report
    resolveAttack(f) {
        const g = this.game, war = g.war, T = f.target;
        if (!T) return;
        const tp = T.unit && T.unit.alive ? T.unit.pos : T.pos;
        const src = f.team === war.side ? ALLIED : HOSTILE;
        let hits = 0;
        for (let i = 0; i < f.hp.length; i++) {
            if (f.hp[i] <= 0 || f.bombs[i] <= 0) continue;
            f.bombs[i] = 0;
            if (Math.random() > 0.72) continue;
            hits++;
            // a stick of bombs: the aimed unit, and whatever's close to it
            const near = war.near(tp, 180, { team: f.team === 'red' ? 'blue' : 'red' });
            if (T.unit && T.unit.alive && T.unit.damage) T.unit.damage(rand(160, 360), src, 'bomb');
            for (const { u } of near.slice(0, 3)) if (u !== T.unit && u.damage) u.damage(rand(60, 200), src, 'bomb');
        }
        f.hits = hits;
        this.raidOutcome(f, hits > 0);
        // our own strikes: the result is known only if someone sees it
        if (f.team === war.side && T.unit && g.strikes && g.strikes.bda) {
            const aim = { pos: tp.clone(), unit: T.unit, label: T.label };
            const st = { id: 'pkg' + f.id, type: 'air', label: 'AIR STRIKE', team: war.side, aims: [aim], done: true, spec: { short: 'JDAM', kind: 'air' } };
            if (g.strikes.observed(tp)) g.strikes.reportBDA(st, aim);
            else g.strikes.bda.push({ strike: st, aim, pos: tp.clone(), t: g.time, look: 0 });
        }
    }

    raidOutcome(f, hit) {
        const g = this.game, war = g.war;
        if (f.hitReported) return;
        f.hitReported = true;
        f.struck = !!hit;
        const T = f.target;
        if (f.team === war.side) {
            if (f.role === 'strike') this.say(f.callsign + ' 1', hit ? 'BOMBS ON TARGET — ' + T.label + ', EGRESSING' : 'OFF TARGET, NO JOY — ' + T.label, { color: '#9fd4ff', say: false });
            return;
        }
        if (f.role !== 'raid') return;
        g.events.emit('raidHit', f, { target: T, hit });
        if (hit) this.say('COMMAND', 'ENEMY RAID HIT ' + T.label + (T.kind === 'base' ? ' — DAMAGE REPORTS COMING IN' : ''), { color: '#ff4a3d', say: 'Enemy raid hit ' + T.label.toLowerCase() + '.', priority: true });
        if (hit && g.front && T.kind !== 'carrier') {
            const s = g.front.sectorAt(T.pos, 40000);
            if (s) g.front.hit(s, 'blue', T.kind === 'base' ? 6 : 4, 'raid');
        }
    }

    // ═════════════ Abstract air war: fights, air defences ═════════════
    abstractCombat() {
        const g = this.game, war = g.war;
        const fl = this.flights;
        for (const a of fl) {
            if (a.done || a.members || a.n === 0) continue;
            for (const b of fl) {
                if (b === a || b.done || b.members || b.n === 0 || b.team === a.team || a.team !== war.side) continue;
                if (Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) > 8000) continue;
                // a = ours, b = theirs: fighters shoot, bombers and recon don't; an escort ties our fighters up
                const ours = a.fighters ? a.n : 0, theirs = b.fighters ? b.n : 0;
                const escorted = !b.fighters && fl.some(e => e.escortOf === b && !e.done && e.n > 0);
                if (ours && Math.random() < 0.05 * ours * (b.fighters ? 0.9 : escorted ? 0.7 : 1.3)) this.abstractLoss(b, a);
                if (theirs && a.n && Math.random() < 0.045 * theirs) this.abstractLoss(a, b);
                if (!a.engagedCall && ours && theirs) {
                    a.engagedCall = true;
                    this.supportCall(a, b);
                }
            }
            void a;
        }
        // SAMs against abstract flights overhead
        for (const f of fl) {
            if (f.done || f.members || f.n === 0) continue;
            if (f.pos.y - groundHeight(f.pos.x, f.pos.z) < 120) continue;
            const foe = f.team === 'red' ? 'blue' : 'red';
            const sams = war.near(f.pos, 8500, { team: foe, cls: ['sam', 'sam-radar'] });
            let p = 0;
            for (const { u } of sams) if ((u.ammo ?? 1) > 0 && !u.isShip) p += 0.05;
            if (p && Math.random() < Math.min(p, 0.3)) this.abstractLoss(f, null, 'sam');
        }
    }

    abstractLoss(f, by, how = 'air') {
        const i = f.hp.findIndex(h => h > 0);
        if (i < 0) return;
        f.hp[i] = 0;
        const war = this.game.war;
        this.game.events.emit('flightDown', f, { by, how });
        if (f.team === war.side) this.say(f.callsign + ' ' + (i + 1 === 1 ? 2 : 1), f.callsign + ' ' + (i + 1) + (how === 'sam' ? ' IS DOWN — SAM!' : ' IS DOWN!'), { color: '#ff4a3d', say: false, ttl: 12 });
        else if (by && by.team === war.side) this.say(by.callsign + ' 1', pick(['SPLASH ONE', 'FOX THREE, SPLASH', 'BANDIT DOWN']), { color: '#5dffa0', say: false, ttl: 10 });
    }

    // one of ours is in a fight it could use help with
    supportCall(ours, theirs) {
        const g = this.game, P = this.focus();
        if (ours.pos.distanceTo(P) > 70000) return;
        this.say(ours.callsign + ' 1', 'ENGAGED, ' + theirs.n + ' BANDITS — ' + g.war.describePos(ours.pos) + ' — REQUEST SUPPORT', { color: '#ffd24a', say: ours.callsign.toLowerCase() + ' one, engaged, requesting support.' });
        g.events.emit('supportRequest', ours, { attackers: theirs });
    }

    // ═════════════ The air picture (our radars) ═════════════
    airPicture() {
        const g = this.game, war = g.war;
        for (const f of this.flights) {
            if (f.done || f.team === war.side) continue;
            let seen = false;
            if (f.members) {
                for (const a of f.members) {
                    if (!a.alive) continue;
                    if (war.coverage(war.side, a.pos) > 0.15) { war.reveal(a, INTEL.CONTACT, 'radar', true); seen = true; }
                    else if (war.known(a) >= INTEL.CONTACT && war.rec(a) && war.time - war.rec(a).lastSeen < 5) seen = true;
                }
            } else seen = war.coverage(war.side, f.pos) > 0.15;
            if (seen) { f.seenT = war.time; f.lastSeen = (f.lastSeen || new THREE.Vector3()).copy(f.pos); }
            const was = f.detected;
            f.detected = war.time - f.seenT < 30;
            if (f.detected && !was && !f.announced) { f.announced = true; this.announce(f); }
        }
    }

    // MAGIC calls a new enemy flight
    announce(f) {
        const g = this.game, war = g.war;
        const P = this.focus();
        const { brg, km } = war.bearingRange(P, f.pos);
        const hd = Math.round(((Math.atan2(f.vel.x, -f.vel.z) * 57.2958) + 360) % 360);
        const alt = Math.round(f.pos.y * 3.281 / 1000);
        const what = f.role === 'raid' ? f.n + ' STRIKE AIRCRAFT' : f.role === 'recon' ? 'SINGLE FAST MOVER' : f.role === 'cas' ? f.n + ' ATTACK AIRCRAFT' : f.n + ' BANDITS';
        const tgt = f.target && (f.role === 'raid' || f.role === 'cas') ? ', TARGET ' + f.target.label : '';
        const txt = what + ', BRG ' + String(brg).padStart(3, '0') + ' FOR ' + Math.round(km) + ' KM, ANGELS ' + alt + ', HEADING ' + String(hd).padStart(3, '0') + tgt;
        const urgent = f.role === 'raid' || f.role === 'cas' || f.role === 'recon';
        if (!urgent && km > 60) return; // a CAP far off: nothing to say
        this.say('MAGIC', (f.role === 'raid' ? 'RAID ALERT — ' : f.role === 'recon' ? 'UNKNOWN AIRCRAFT — ' : 'NEW PICTURE — ') + txt, { color: urgent ? '#ff9f5a' : '#ffd24a', say: urgent ? (f.role === 'raid' ? 'Raid alert. ' : 'Magic, new contact. ') + what.toLowerCase() + ', bearing ' + brg + ', ' + Math.round(km) + ' kilometres.' : false, priority: f.role === 'raid' });
        g.events.emit(f.role === 'recon' ? 'reconDetected' : f.role === 'raid' || f.role === 'cas' ? 'raidDetected' : 'flightDetected', f);
    }

    // ═════════════ The enemy's plans ═════════════
    think() {
        const g = this.game, war = g.war;
        if (!g.player) return;
        const k = this.intensity();
        // CAP stations over their ground (and ours)
        this.capT -= 1;
        if (this.capT <= 0) { this.capT = 25; this.keepCaps(); }
        // radar-directed scrambles at the player
        this.gci();
        // raids
        this.raidT -= 1;
        if (this.raidT <= 0) {
            const active = this.flights.filter(f => f.team === 'red' && (f.role === 'raid' || f.role === 'cas') && !f.done).length;
            if (active < (k > 1.2 ? 2 : 1)) this.launchRaid();
            this.raidT = rand(240, 390) / k;
        }
        this.reconT -= 1;
        if (this.reconT <= 0) { this.reconT = rand(480, 720) / k; this.launchRecon(); }
        // convoys
        this.redConvoyT -= 1;
        if (this.redConvoyT <= 0) {
            this.redConvoyT = 20;
            if (this.convoys.filter(c => c.team === 'red').length < (k > 1.2 ? 2 : 1) && this.startConvoy('red')) this.redConvoyT = rand(150, 240);
        }
        this.blueConvoyT -= 1;
        if (this.blueConvoyT <= 0) {
            this.blueConvoyT = 30;
            if (!this.convoys.some(c => c.team === 'blue') && this.startConvoy('blue')) this.blueConvoyT = rand(480, 720);
        }
        // missiles (the launcher is set up once every system has started)
        if (!this.telChecked && war.time > 3) { this.telChecked = true; this.ensureTel(); }
        this.missileT -= 1;
        if (this.missileT <= 0) { this.missileT = rand(480, 720) / k; this.missileStrike(); }
        // the enemy fleet repositions
        this.fleetT -= 1;
        if (this.fleetT <= 0) { this.fleetT = rand(600, 900); this.moveFleet(); }
        // our strike packages against what the player has found
        this.packageT -= 1;
        if (this.packageT <= 0) { this.packageT = 45; this.maybePackage(); }
        this.vectorCaps();
        for (const c of this.convoys) this.convoyThreats(c);
        void war;
    }

    // keep 1-3 enemy CAPs and one of ours on station
    keepCaps() {
        const g = this.game, war = g.war, fr = g.front, k = this.intensity();
        const want = k > 1.2 ? 3 : k > 0.95 ? 2 : 1;
        const redCaps = this.flights.filter(f => f.team === 'red' && f.role === 'cap' && !f.done && f.state !== 'rtb');
        if (redCaps.length < want) {
            const c = this.capStation('red', redCaps.map(f => f.loiter.center));
            if (c) {
                const from = this.enemyAirfield() || _v.set(c.x, 0, c.z - 30000);
                const f = this.spawnFlight({ team: 'red', role: 'cap', types: [pick(RED_FIGHTERS), pick(RED_FIGHTERS)], pos: new THREE.Vector3(from.x, 1500, from.z), speed: 230,
                    loiter: { center: c, R: 6000, until: war.time + rand(600, 900) }, skill: this.redSkill(), callsign: 'CAP' });
                f.home = this.homeFor('red', c);
            }
        }
        this.blueCapT -= 25;
        const blueCaps = this.flights.filter(f => f.team === war.side && f.role === 'cap' && !f.done && f.state !== 'rtb');
        if (!blueCaps.length && this.blueCapT <= 0 && fr) {
            this.blueCapT = rand(60, 120);
            const c = this.capStation('blue', []);
            if (c) {
                const base = this.homeFor('blue', c);
                const call = pick(BLUE_CALLS);
                const f = this.spawnFlight({ team: war.side, role: 'cap', types: [pick(BLUE_FIGHTERS), pick(BLUE_FIGHTERS)], pos: new THREE.Vector3(base.x, 1200, base.z), speed: 230,
                    loiter: { center: c, R: 7000, until: war.time + rand(720, 960) }, skill: 0.62, callsign: call });
                f.home = base;
                this.say(call + ' 1', 'TWO SHIP, AIRBORNE, PUSHING TO CAP OVER ' + (fr.sectorAt(c) ? fr.sectorLabel(fr.sectorAt(c)) : 'THE FRONT'), { color: '#9fd4ff', say: false });
            }
        }
    }

    // our CAP commits on raids and attackers our radars see coming within reach of its station
    vectorCaps() {
        const war = this.game.war;
        for (const f of this.flights) {
            if (f.team !== war.side || f.role !== 'cap' || f.done || f.state === 'rtb' || !f.loiter) continue;
            if (f.vector && (f.vector.done || f.vector.n === 0)) f.vector = null;
            if (f.vector) continue;
            let best = null, bd = 30000;
            for (const e of this.flights) {
                if (e.team === war.side || e.done || !e.detected || e.n === 0 || !(e.role === 'raid' || e.role === 'cas' || e.role === 'recon')) continue;
                const d = Math.hypot(e.pos.x - f.loiter.center.x, e.pos.z - f.loiter.center.z);
                if (d < bd) { bd = d; best = e; }
            }
            if (!best) continue;
            f.vector = best;
            this.say(f.callsign + ' 1', 'COMMITTING ON THE ' + (best.role === 'raid' ? 'RAID' : best.role === 'recon' ? 'FAST MOVER' : 'ATTACKERS') + ', ' + Math.round(bd / 1000) + ' KM', { color: '#9fd4ff', say: false, ttl: 15 });
        }
    }

    // a point over a side's ground, behind the front (spread away from the other CAPs)
    capStation(team, avoid) {
        const g = this.game, war = g.war, fr = g.front;
        for (let k = 0; k < 30; k++) {
            let x, z;
            if (fr && fr.sectors.length) {
                const s = pick(fr.sectors);
                const d = rand(9000, 18000) * (team === 'red' ? 1 : -1);
                x = s.center.x + s.normal.x * d + rand(-4000, 4000); z = s.center.z + s.normal.z * d + rand(-4000, 4000);
            } else { x = rand(-25000, 25000); z = team === 'red' ? rand(-40000, -20000) : rand(0, 20000); }
            if (war.sideAt(x, z) !== team) continue;
            if (avoid.some(p => Math.hypot(p.x - x, p.z - z) < 15000)) continue;
            return new THREE.Vector3(x, Math.max(groundHeight(x, z) + 1500, rand(2800, 4500)), z);
        }
        return null;
    }

    redSkill() { return clamp((this.game.difficulty || { skill: 0.6 }).skill + rand(-0.08, 0.08), 0.2, 1); }

    // the enemy airbase, while it can still launch (hangars or parked jets left); else null
    enemyAirfield() {
        const g = this.game, b = BASES.find(x => !x.friendly);
        if (!b) return null;
        const assets = g.ground.targets.filter(t => (t.type === 'hangar' || t.type === 'parked') && Math.hypot(t.pos.x - b.x, t.pos.z - b.z) < 3000);
        if (assets.length && !assets.some(t => t.alive)) {
            if (!this.airfieldDownCall) { this.airfieldDownCall = true; this.say('COMMAND', 'THE ENEMY AIRFIELD IS OUT OF ACTION — THEIR FIGHTERS WILL HAVE TO COME FROM FURTHER AWAY', { color: '#5dffa0', say: 'The enemy airfield is out of action.' }); }
            return null;
        }
        return new THREE.Vector3(b.x, b.h, b.z);
    }

    // where enemy aircraft come from: their airfield, their carrier, or deep in their territory
    redOrigin(toward) {
        const g = this.game;
        const af = this.enemyAirfield();
        const cv = g.naval && g.naval.enemyCarrier && g.naval.enemyCarrier.alive ? g.naval.enemyCarrier.pos : null;
        const opts = [];
        if (af) opts.push(af);
        if (cv) opts.push(cv);
        if (!opts.length) {
            // "from further away": the far north
            return new THREE.Vector3(toward.x + rand(-15000, 15000), 0, toward.z - 55000);
        }
        opts.sort((a, b) => a.distanceTo(toward) - b.distanceTo(toward));
        return opts[0].clone();
    }

    // GCI: their radars see the player over or near their ground → a pair of interceptors comes up
    gci() {
        const g = this.game, war = g.war, p = g.player;
        if (!p || !p.alive || p.onGround || g.pilotMode) { this.gciAcc = Math.max(0, this.gciAcc - 1); return; }
        const fr = g.front;
        const near = war.sideAt(p.pos.x, p.pos.z) === 'red' || (fr && fr.distToFront(p.pos) < 7000);
        const cov = near ? war.coverage('red', p.pos) : 0;
        this.gciAcc = cov > 0.25 ? this.gciAcc + 1 : Math.max(0, this.gciAcc - 2);
        // the anchor of an interception in progress follows the player while they're seen
        for (const f of this.flights) if (f.role === 'intercept' && !f.done && cov > 0.25) (f.anchor = f.anchor || new THREE.Vector3()).copy(p.pos);
        if (this.gciAcc < 18 || war.time - this.lastScramble < 200 / this.intensity()) return;
        const redNear = g.aircraft.filter(a => a.alive && a.team === 'red' && a.pos.distanceTo(p.pos) < 22000).length;
        if (redNear >= 2) return;
        const from = this.redOrigin(p.pos);
        // an underground airbase nearer than that: its fighters taxi out of the mountain and take off (underground.js)
        const ug = g.underground, ugFrom = ug && ug.scrambleOrigin ? ug.scrambleOrigin(p.pos) : null;
        if (ugFrom && ugFrom.distanceTo(p.pos) < from.distanceTo(p.pos) && ug.scramble([pick(RED_FIGHTERS), pick(RED_FIGHTERS)], p.pos, { role: 'intercept', callsign: 'INTERCEPT' })) {
            this.lastScramble = war.time;
            this.gciAcc = 0;
            return;
        }
        this.lastScramble = war.time;
        this.gciAcc = 0;
        const dir = _v.subVectors(p.pos, from).setY(0).normalize();
        const start = from.clone().addScaledVector(dir, 3000);
        start.y = groundHeight(start.x, start.z) + 900;
        const f = this.spawnFlight({ team: 'red', role: 'intercept', types: [pick(RED_FIGHTERS), pick(RED_FIGHTERS)], pos: start, speed: 280, skill: this.redSkill() + 0.05,
            route: [{ p: new THREE.Vector3(p.pos.x, Math.max(p.pos.y, 2500), p.pos.z) }], callsign: 'INTERCEPT' });
        f.anchor = p.pos.clone(); f.endT = war.time + 300; f.home = this.homeFor('red', start);
        f.detected = true; f.seenT = war.time; f.announced = true;
        const { brg, km } = war.bearingRange(p.pos, start);
        this.say('MAGIC', 'BANDITS SCRAMBLING, BRG ' + String(brg).padStart(3, '0') + ' FOR ' + Math.round(km) + ' KM — THEIR RADARS HAVE YOU', { color: '#ff9f5a', say: 'Magic. Bandits scrambling, bearing ' + brg + '. Their radars have you.' });
    }

    // a raid on one of our places
    launchRaid() {
        const g = this.game, war = g.war;
        const t = this.raidTarget();
        if (!t) return null;
        const origin = this.redOrigin(t.pos);
        const bombers = Object.keys(AIRCRAFT).filter(id => AIRCRAFT[id].category === 'bomber' && AIRCRAFT[id].country !== 'USA');
        const type = bombers.length && Math.random() < 0.7 ? pick(bombers) : pick(RED_STRIKERS);
        const n = this.intensity() > 1.2 ? 3 : 2;
        const dir = _v.subVectors(t.pos, origin).setY(0);
        let dist = dir.length(); dir.normalize();
        // they form up well back, so there's time to see them coming (~3 minutes out)
        if (dist < 42000) { origin.addScaledVector(dir, dist - rand(42000, 50000)); dist = origin.distanceTo(t.pos); }
        // come in low or high; low raids hide from our radars until late
        const low = Math.random() < 0.35;
        const alt = (x, z) => groundHeight(x, z) + (low ? 450 : 2200);
        const ip = new THREE.Vector3(t.pos.x - dir.x * 14000, 0, t.pos.z - dir.z * 14000); ip.y = alt(ip.x, ip.z);
        const over = new THREE.Vector3(t.pos.x + dir.x * 5000, 0, t.pos.z + dir.z * 5000); over.y = Math.max(alt(t.pos.x, t.pos.z), groundHeight(over.x, over.z) + 400);
        const tgtPt = new THREE.Vector3(t.pos.x, alt(t.pos.x, t.pos.z), t.pos.z);
        const egress = new THREE.Vector3(t.pos.x + dir.z * 12000, 3000, t.pos.z - dir.x * 12000);
        const start = origin.clone().addScaledVector(dir, Math.min(4000, dist * 0.1)); start.y = alt(start.x, start.z);
        const f = this.spawnFlight({ team: 'red', role: 'raid', types: Array(n).fill(type), bombs: 4, pos: start, speed: 215, skill: this.redSkill(),
            route: [{ p: ip }, { p: tgtPt, attack: true }, { p: over }, { p: egress }], target: t, callsign: 'RAID', tag: low ? 'low' : 'high' });
        f.home = this.homeFor('red', origin);
        // escorts from veteran up
        if (this.intensity() > 0.95) {
            const e = this.spawnFlight({ team: 'red', role: 'escort', types: [pick(RED_FIGHTERS), pick(RED_FIGHTERS)], pos: start.clone().add(_v2.set(800, 300, 600)), speed: 215, skill: this.redSkill(), escortOf: f, callsign: 'ESCORT' });
            e.home = f.home.clone();
        }
        return f;
    }

    // what the enemy wants to hit: our airfields, the early-warning radars, the carrier, a town near the front
    raidTarget() {
        const g = this.game, war = g.war;
        const opts = [];
        for (const b of BASES) if (b.friendly && !b.civil) {
            const w = baseToWorld(b, 300 + rand(-150, 150), rand(-600, 600));
            opts.push({ w: b.id === 'home' ? 3 : 2, t: { pos: new THREE.Vector3(w.x, b.h, w.z), unit: null, label: b.name, kind: 'base', base: b } });
        }
        for (const u of this.defences || []) if (u.alive) opts.push({ w: 1.2, t: { pos: u.pos, unit: u, label: u.name + ' AT ' + this.placeName(u.pos), kind: 'unit' } });
        const cv = g.naval && g.naval.homeCarrier;
        if (cv && cv.alive) opts.push({ w: 1.2, t: { pos: cv.pos, unit: cv, label: 'THE CARRIER GROUP', kind: 'carrier' } });
        if (g.front && g.world.towns) {
            for (const tw of g.world.towns.towns) {
                if (war.sideAt(tw.x, tw.z) !== war.side || tw.size === 'village') continue;
                const d = g.front.distToFront(_v.set(tw.x, 0, tw.z));
                if (d < 12000) opts.push({ w: 0.5, t: { pos: new THREE.Vector3(tw.x, groundHeight(tw.x, tw.z), tw.z), unit: null, label: (tw.mapName || 'THE TOWN').toUpperCase(), kind: 'town' } });
            }
        }
        if (!opts.length) return null;
        let r = Math.random() * opts.reduce((a, o) => a + o.w, 0);
        for (const o of opts) { r -= o.w; if (r <= 0) return o.t; }
        return opts[0].t;
    }

    // a fast jet high over our side, having a look (at the carrier, often)
    launchRecon() {
        const g = this.game;
        const cv = g.naval && g.naval.homeCarrier && g.naval.homeCarrier.alive ? g.naval.homeCarrier : null;
        const home = BASES.find(b => b.id === 'home');
        const look = cv && Math.random() < 0.6 ? cv.pos : new THREE.Vector3(home.x, 0, home.z);
        const from = this.redOrigin(look);
        const dir = _v.subVectors(look, from).setY(0).normalize();
        const start = from.clone().addScaledVector(dir, 5000); start.y = 7000;
        const over = look.clone().addScaledVector(dir, 6000); over.y = 7500;
        const back = new THREE.Vector3(from.x + dir.z * 15000, 7000, from.z - dir.x * 15000);
        const type = pick(['mig25', 'mig31', 'su57']);
        const f = this.spawnFlight({ team: 'red', role: 'recon', types: [type], pos: start, speed: 330, skill: this.redSkill(),
            route: [{ p: new THREE.Vector3(look.x, 7500, look.z) }, { p: over }, { p: back }], target: { pos: look.clone(), unit: cv && look === cv.pos ? cv : null, label: cv && look === cv.pos ? 'THE CARRIER GROUP' : 'SKYWAR AIR BASE', kind: cv && look === cv.pos ? 'carrier' : 'base' }, callsign: 'RECON' });
        f.home = this.homeFor('red', from);
        return f;
    }

    // ═════════════ Convoys ═════════════
    // a road wholly on one side, toward the front (the end nearer it is where it's going)
    pickRoad(team) {
        const g = this.game, war = g.war, towns = g.world.towns, fr = g.front;
        if (!towns || !towns.paths) return null;
        const opts = [];
        for (const p of towns.paths) {
            if (p.len < (team === 'red' ? 2400 : 3000) || this.convoys.some(c => c.path === p)) continue;
            const a = p.pts[0], b = p.pts[p.pts.length - 1], m = p.pts[p.pts.length >> 1];
            if (war.sideAt(a.x, a.z) !== team || war.sideAt(b.x, b.z) !== team || war.sideAt(m.x, m.z) !== team) continue;
            if (p.bridges.some(br => !br.bridge.alive)) continue;
            const da = fr ? fr.distToFront(a) : 0, db = fr ? fr.distToFront(b) : 0;
            if (Math.min(da, db) < 1500 || Math.min(da, db) > 22000) continue;
            opts.push({ p, sign: db < da ? 1 : -1, score: p.len / 1000 - Math.min(da, db) / 4000 + rand(0, 3) });
        }
        opts.sort((x, y) => y.score - x.score);
        return opts[0] || null;
    }

    startConvoy(team) {
        const g = this.game, war = g.war;
        if (!g.ground || !g.ground.addTarget) return null;
        const road = this.pickRoad(team);
        if (!road) return null;
        const k = this.intensity();
        const types = team === 'red' ? RED_CONVOY.slice(0, Math.round(5 + k * 1.5)) : BLUE_CONVOY.slice(0, 5);
        const c = new Convoy(this, { team, path: road.p, sign: road.sign, types, callsign: team === war.side ? pick(CONVOY_CALLS) + ' ' + (1 + Math.floor(Math.random() * 3)) : 'CONVOY' });
        c.reportT = war.time + rand(50, 90);
        c.attackT = team === war.side ? war.time + rand(70, 140) : Infinity;
        this.convoys.push(c);
        g.events.emit('convoyStarted', c);
        if (team === war.side) this.say(c.callsign, 'ROLLING WITH ' + c.total + ' VEHICLES TO ' + c.destName + ' — REQUEST ESCORT', { color: '#9fd4ff', say: false });
        return c;
    }

    updateConvoys(dt) {
        const g = this.game, war = g.war;
        for (let i = this.convoys.length - 1; i >= 0; i--) {
            const c = this.convoys[i];
            c.t += dt;
            const alive = c.alive();
            if (!alive.length) { this.endConvoy(c, 'destroyed'); this.convoys.splice(i, 1); continue; }
            const lead = c.leadVehicle();
            // a bridge down ahead: stop short of the gap, wait, turn back
            if (c.state === 'move') {
                for (const b of c.path.bridges) {
                    const br = b.bridge;
                    if (br.alive || !br.gap) continue;
                    const g0 = b.s0 + br.gap[0], g1 = b.s0 + br.gap[1];
                    const near = c.sign > 0 ? g0 : g1;
                    // vehicles on the span as it fell go into the river
                    for (const v of alive) if (v.route.s > g0 - 3 && v.route.s < g1 + 3 && !v.sinking) { v.sinking = true; v.destroy(null); }
                    if (lead && (near - lead.route.s) * c.sign > -5 && (near - lead.route.s) * c.sign < 4000) {
                        c.state = 'halt'; c.gapNear = near; c.haltT = 0;
                        if (c.team === war.side) this.say(c.callsign, 'THE BRIDGE IS DOWN AHEAD OF US — HOLDING', { color: '#ffd24a', say: false });
                        else if (war.known(lead) >= INTEL.CONTACT) this.say('INTEL', 'ENEMY CONVOY HALTED AT A DOWNED BRIDGE — ' + this.placeName(lead.pos), { color: '#5dffa0', say: false });
                        break;
                    }
                }
            }
            if (c.state === 'halt') {
                const stuck = alive.filter(v => (c.gapNear - v.route.s) * c.sign > 0).sort((a, b) => (b.route.s - a.route.s) * c.sign);
                stuck.forEach((v, k) => { v.route.stopAt = c.gapNear - c.sign * (18 + k * 26); });
                if (!stuck.length || stuck[0].route.speed < 0.5) c.haltT += dt;
                if (c.haltT > 45) {
                    c.state = 'back';
                    for (const v of stuck) { v.route.dir = -c.sign; v.route.stopAt = null; v.route.cruise = 13; v.route.speed = 0; }
                }
            }
            // each vehicle that reaches the end of its road is through (or home again, if it turned back)
            for (const v of alive) {
                const end = v.route.dir > 0 ? c.path.len : 0;
                if (Math.abs(v.route.s - end) > 50) continue;
                if (v.route.dir === c.sign) c.arrived = (c.arrived || 0) + 1; else c.returned = (c.returned || 0) + 1;
                this.removeVehicle(v);
            }
            if (!c.alive().length) {
                this.endConvoy(c, c.arrived ? 'arrived' : c.returned ? 'turned back' : 'destroyed');
                this.convoys.splice(i, 1);
                continue;
            }
            // intel picks up an enemy convoy after a while
            if (c.team !== war.side && !c.reported && war.time > c.reportT && lead) {
                c.reported = true;
                const off = _v.set(rand(-1200, 1200), 0, rand(-1200, 1200));
                c.report = war.report({ text: 'ENEMY SUPPLY CONVOY MOVING ON THE ROAD NEAR ' + this.placeName(lead.pos), center: _v2.copy(lead.pos).add(off), radius: 2600, unit: lead, cls: 'convoy', say: false });
            }
        }
    }

    endConvoy(c, why) {
        const g = this.game, war = g.war;
        c.state = why;
        const n = c.arrived || 0;
        if (why === 'arrived' && g.front) g.front.deliver(c.destPos, c.team, 0.04 + 0.14 * n / c.total);
        g.events.emit(why === 'arrived' ? 'convoyArrived' : 'convoyLost', c, { why });
        if (c.team === war.side) {
            if (why === 'arrived') this.say(c.callsign, 'ARRIVED AT ' + c.destName + ' WITH ' + n + ' OF ' + c.total + (c.calledHelp ? ' — THANKS FOR THE COVER' : ''), { color: '#5dffa0', say: false });
            else if (why === 'destroyed') this.say('COMMAND', c.callsign + ' HAS BEEN DESTROYED', { color: '#ff4a3d', say: false });
            else this.say(c.callsign, 'TURNED BACK — THE ROAD IS CUT', { color: '#ffd24a', say: false });
        } else if (why === 'arrived' && c.reported) this.say('INTEL', 'THE ENEMY CONVOY REACHED ' + c.destName, { color: '#ff9f5a', say: false });
        else if (why === 'destroyed' && c.reported) this.say('COMMAND', 'ENEMY CONVOY DESTROYED — THEIR FRONT WILL FEEL THAT', { color: '#5dffa0', say: false });
        else if (why === 'turned back' && c.reported) this.say('INTEL', 'THE ENEMY CONVOY HAS TURNED BACK — THE ROAD IS CUT', { color: '#5dffa0', say: false });
    }

    removeVehicle(v) {
        const g = this.game;
        const i = g.ground.targets.indexOf(v);
        if (i >= 0) g.ground.targets.splice(i, 1);
        v.remove();
        v.removed = true;
    }

    // our convoy draws an attack; when it's close, the convoy calls for help
    convoyThreats(c) {
        const g = this.game, war = g.war;
        if (c.team !== war.side) return;
        if (c.state === 'move' && war.time > c.attackT && !c.attacker) {
            const at = c.centre(_v3).clone();
            const from = this.redOrigin(at);
            const dir = _v.subVectors(at, from).setY(0).normalize();
            const start = from.clone().addScaledVector(dir, 4000); start.y = groundHeight(start.x, start.z) + 1200;
            c.attacker = this.spawnFlight({ team: 'red', role: 'cas', types: [pick(RED_STRIKERS), pick(RED_STRIKERS)], pos: start, speed: 230, skill: this.redSkill(),
                route: [{ p: new THREE.Vector3(at.x, groundHeight(at.x, at.z) + 900, at.z) }], target: { pos: at, unit: null, label: c.callsign, kind: 'convoy', convoy: c }, callsign: 'STRIKE' });
            c.attacker.home = this.homeFor('red', from);
        }
        const f = c.attacker;
        if (f && !f.done && f.target) {
            f.target.pos.copy(c.centre(_v3));
            if (f.members) for (const a of f.members) if (a.alive && a.pilot && a.pilot.home) a.pilot.home.copy(f.target.pos);
            if (!c.calledHelp && f.pos.distanceTo(f.target.pos) < 14000) {
                c.calledHelp = true;
                this.say(c.callsign, 'ENEMY AIRCRAFT INBOUND ON OUR POSITION — WE NEED AIR COVER NOW', { color: '#ff9f5a', say: c.callsign.toLowerCase() + ', enemy aircraft inbound, we need air cover!', priority: true });
                g.events.emit('convoyUnderAttack', c, { flight: f });
            }
            // abstract strafing when nobody's there to see it
            if (!f.members && f.pos.distanceTo(f.target.pos) < 2000) {
                f.casT = (f.casT || 0) + 1;
                if (f.casT % 6 === 0) {
                    const v = c.alive()[0];
                    if (v && Math.random() < 0.4) v.damage(999, HOSTILE, 'rocket');
                    if (f.casT > 60) this.rtb(f);
                }
            }
        }
    }

    // ═════════════ Missile strikes (and the launcher that fires them) ═════════════
    // until the mobile-forces plug-in adds real TELs: a launcher truck hidden in their territory
    ensureTel() {
        const g = this.game, war = g.war, st = g.strikes;
        if (!st || !st.enabled || !st.sources) return null;
        if (this.tel && this.tel.u.alive) return this.tel;
        if (st.sources.some(s => s.team === 'red' && s.kind === 'launcher' && s.alive && (!this.tel || s !== this.tel.src))) return null; // someone else's launchers
        if (this.tel && !this.tel.u.alive) { if (war.time - this.tel.deadT < 600) return null; } // a new one comes up after a while
        const site = this.telSite();
        if (!site) return null;
        const u = g.ground.addTarget('truck', site.x, site.z, rand(0, 6.28), 'red');
        u.name = 'SS-1C SCUD-B TEL';
        u.def = { ...u.def, name: 'SCUD TEL', score: 600 };
        war.add(u, { cls: 'tel', name: 'SS-1C SCUD-B TEL', conceal: 0.6 });
        this.telRig(u);
        const src = st.addSource(new GroundLauncher(st, u, { kind: 'launcher', name: 'SCUD TEL', stock: { scud: 4, kalibr: 2 }, muzzle: TEL_MUZZLE.clone() }));
        // the rigged 9P117 (vehicles.js), once the models are in: jacks, pad and erector run the launch sequence
        dress(u, 'scud', { onRig: () => { u.erectShown = -1; } });
        u.radius = u.hitRadius = 8;
        this.tel = { u, src, relocateT: Infinity, deadT: 0, reloadT: 0 };
        return this.tel;
    }

    telSite() {
        const g = this.game, war = g.war, fr = g.front;
        for (let k = 0; k < 60; k++) {
            let x, z;
            if (fr && fr.sectors.length) {
                const s = pick(fr.sectors), d = rand(12000, 22000);
                x = s.center.x + s.normal.x * d + rand(-5000, 5000); z = s.center.z + s.normal.z * d + rand(-5000, 5000);
            } else { x = rand(-20000, 25000); z = rand(-40000, -22000); }
            if (war.sideAt(x, z) !== 'red') continue;
            if (fr ? !fr.goodGround(x, z, 5) : terrainHeight(x, z) < 5) continue;
            return { x, z };
        }
        return null;
    }

    // a missile on the truck bed that's raised before a launch
    telRig(u) {
        const grp = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 11, 12), new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.7, metalness: 0.2 }));
        body.position.y = 5.5; body.castShadow = true;
        const nose = new THREE.Mesh(new THREE.ConeGeometry(0.44, 1.8, 12), new THREE.MeshStandardMaterial({ color: 0x3c4230, roughness: 0.7 }));
        nose.position.y = 11.9;
        grp.add(body, nose);
        grp.position.set(0, 2.8, 3.2);
        grp.rotation.x = Math.PI / 2 - 0.06; // lying along the bed, nose forward (−Z)
        u.mesh.add(grp);
        u.erector = grp;
        u.erect = 0;
    }

    updateTel(dt) {
        const g = this.game, war = g.war, t = this.tel;
        if (!t) return;
        const u = t.u;
        if (!u.alive) { if (!t.deadT) t.deadT = war.time; return; }
        // raise the missile while a launch is being prepared, lower the rail after (a new round is loaded a
        // minute and a half after each launch, while there are any left)
        const q = t.src.queue[0];
        const want = q ? 1 : 0;
        u.erect = clamp(u.erect + (want ? dt / 8 : -dt / 10), 0, 1);
        const loaded = !!q || (war.time > t.reloadT && (t.src.stock.scud || 0) + (t.src.stock.kalibr || 0) > 0);
        if (u.rig) {
            // jacks down, then the pad, then the erector (and the reverse): only when something changed
            const r = u.rig, e = u.erect;
            if (Math.abs(e - (u.erectShown ?? -1)) > 0.002 || u.loadedShown !== loaded) {
                u.erectShown = e; u.loadedShown = loaded;
                deployJacks(r, clamp(e * 3, 0, 1)); deployPad(r, clamp(e * 3 - 1, 0, 1)); raise(r, clamp(e * 3 - 2, 0, 1));
                if (r.missile) r.missile.visible = loaded;
            }
        } else if (u.erector) {
            u.erector.rotation.x = (Math.PI / 2 - 0.06) * (1 - u.erect);
            u.erector.visible = loaded;
        }
        // a prepared launch goes ahead unless it's been found and killed first
        if (t.launchAt && war.time >= t.launchAt) { t.launchAt = null; this.fireTel(t.target); }
        // after firing it moves on — if nobody's watching
        if (war.time > t.relocateT && !q && u.pos.distanceTo(this.focus()) > 12000) {
            const site = this.telSite();
            if (site) {
                const y = groundHeight(site.x, site.z);
                u.mesh.position.set(site.x, y, site.z);
                u.pos.set(site.x, y + u.radius * 0.4, site.z);
                t.relocateT = Infinity;
                t.moved = (t.moved || 0) + 1;
                g.events.emit('telRelocated', u);
            }
        }
    }

    // pick a target and either fire now, or be seen preparing (a chance to stop it)
    missileStrike() {
        const g = this.game, war = g.war;
        const t = this.ensureTel();
        const target = this.missileTarget();
        if (!target) return;
        const tel = this.tel;
        if (t && Math.random() < 0.5) {
            // intel sees the launcher getting ready: it fires in ~2.5 minutes unless it's destroyed
            tel.launchAt = war.time + rand(140, 170);
            tel.target = target;
            const off = _v.set(rand(-1500, 1500), 0, rand(-1500, 1500));
            tel.report = war.report({ text: 'ENEMY BALLISTIC MISSILE LAUNCHER PREPARING TO FIRE NEAR ' + this.placeName(tel.u.pos), center: _v2.copy(tel.u.pos).add(off), radius: 3000, unit: tel.u, cls: 'tel', say: false });
            this.say('COMMAND', 'PRIORITY — ENEMY TEL PREPARING A LAUNCH, GRID ' + war.grid(tel.u.pos.x, tel.u.pos.z) + ' — FIND IT BEFORE IT FIRES', { color: '#ff9f5a', say: 'Priority. Enemy launcher preparing to fire. Find it before it launches.', priority: true });
            g.events.emit('telPreparing', tel.u, { launchAt: tel.launchAt, target });
            return;
        }
        this.fireTel(target);
    }

    fireTel(target) {
        const g = this.game, st = g.strikes;
        if (!st || !target) return;
        const type = target.kind === 'carrier' ? 'cruise' : 'ballistic';
        const mark = target.unit ? target.unit : { id: 0, pos: target.pos, fixed: target.pos, transmitted: true, label: target.label };
        const s = st.request(type, [mark], 'red', true);
        if (s && this.tel) this.tel.relocateT = g.war.time + rand(160, 240);
        return s;
    }

    missileTarget() {
        const g = this.game;
        const opts = [];
        const home = BASES.find(b => b.id === 'home'), mir = BASES.find(b => b.id === 'miramar');
        const at = (b, lx, lz) => { const w = baseToWorld(b, lx, lz); return new THREE.Vector3(w.x, b.h, w.z); };
        if (home) opts.push({ w: 3, pos: at(home, 380 + rand(-100, 100), rand(-500, 500)), label: home.name, kind: 'base' });
        if (mir) opts.push({ w: 2, pos: at(mir, 900 + rand(-150, 150), rand(-900, 900)), label: mir.name, kind: 'base' });
        for (const u of this.defences || []) if (u.alive && u.radarRange) opts.push({ w: 1.5, pos: u.pos, unit: u, label: u.name, kind: 'unit' });
        const cv = g.naval && g.naval.homeCarrier;
        if (cv && cv.alive && (this.reconSawCarrier || Math.random() < 0.3)) opts.push({ w: 2, pos: cv.pos, unit: cv, label: 'THE CARRIER GROUP', kind: 'carrier' });
        if (g.strikes && g.strikes.silo && g.strikes.silo.alive) opts.push({ w: 1, pos: g.strikes.silo.pos, label: g.strikes.silo.name, kind: 'site' });
        if (!opts.length) return null;
        let r = Math.random() * opts.reduce((a, o) => a + o.w, 0);
        for (const o of opts) { r -= o.w; if (r <= 0) return o; }
        return opts[0];
    }

    onLaunch(m) {
        if (!this.enabled || !m || m.team === this.game.war.side) return;
        const src = m.source, war = this.game.war;
        if (this.tel && src === this.tel.src) this.tel.reloadT = war.time + 90; // the rail's empty until a reload
        // the launch gives the launcher away: satellites / AWACS put a contact where it came from
        if (src && src.host && src.host.pos && war.rec(src.host)) war.reveal(src.host, INTEL.CONTACT, 'launch', true);
    }

    // ═════════════ The enemy fleet moves ═════════════
    moveFleet() {
        const g = this.game, war = g.war, cv = g.naval && g.naval.enemyCarrier;
        if (!cv || !cv.alive) return;
        const o = cv.orbit;
        const spot = findOcean(o.cx, o.cz, 9000, 22000, 3200);
        if (!spot) return;
        // a group the naval plug-in steams (navalops.js) goes there in formation; otherwise slide the circles along
        if (g.navalops && g.navalops.moveGroupOf && g.navalops.moveGroupOf(cv, spot)) this.fleetMove = null;
        else this.fleetMove = { to: new THREE.Vector3(spot.x, 0, spot.z), ships: g.naval.ships.filter(s => s.team === cv.team && s.orbit && Math.hypot(s.orbit.cx - o.cx, s.orbit.cz - o.cz) < 50) };
        if (war.known(cv) >= INTEL.CONTACT) this.say('INTEL', 'THE ENEMY CARRIER GROUP IS ON THE MOVE — LAST KNOWN ' + war.describePos(cv.pos), { color: '#ffd24a', say: false });
    }

    updateFleet(dt) {
        const m = this.fleetMove;
        if (!m) return;
        const lead = m.ships[0];
        if (!lead || !lead.alive) { this.fleetMove = null; return; }
        const dx = m.to.x - lead.orbit.cx, dz = m.to.z - lead.orbit.cz, d = Math.hypot(dx, dz);
        if (d < 50) { this.fleetMove = null; return; }
        const step = Math.min(d, 7 * dt);
        for (const s of m.ships) { if (!s.orbit) continue; s.orbit.cx += dx / d * step; s.orbit.cz += dz / d * step; }
    }

    // ═════════════ Our strike packages ═════════════
    // something the player identified a while ago and hasn't dealt with: command sends a pair of jets
    maybePackage() {
        const g = this.game, war = g.war;
        if (this.flights.some(f => f.role === 'strike' && !f.done)) return;
        if (war.time - (this.lastPackage ?? -1e9) < 300 / this.intensity()) return;
        const P = this.focus();
        let best = null;
        for (const u of war.units) {
            if (!u.alive || u.team === war.side || u.team === 'neutral' || u.isShip) continue;
            const rec = war.rec(u);
            if (!rec || rec.known < INTEL.IDENTIFIED || rec.source === 'prior' || war.time - rec.lastSeen > 900) continue;
            if (!['sam', 'sam-radar', 'artillery', 'radar', 'tel', 'command', 'aaa'].includes(rec.cls)) continue;
            if (war.time - (rec.identT ?? rec.lastSeen) < 150) continue;
            if (u.pos.distanceTo(P) < 6000) continue; // the player's on it
            if (u.packageSent) continue;
            const score = (rec.cls === 'sam' || rec.cls === 'artillery' ? 2 : 1) - u.pos.distanceTo(P) / 60000;
            if (!best || score > best.score) best = { u, rec, score };
        }
        if (!best || Math.random() < 0.35) return;
        this.lastPackage = war.time;
        best.u.packageSent = true;
        const u = best.u;
        const base = this.homeFor(war.side, u.pos);
        const call = 'HAMMER';
        const dir = _v.subVectors(u.pos, base).setY(0).normalize();
        const alt = (x, z) => groundHeight(x, z) + 1800;
        const tgt = new THREE.Vector3(u.pos.x, alt(u.pos.x, u.pos.z), u.pos.z);
        const over = new THREE.Vector3(u.pos.x + dir.x * 5000, 0, u.pos.z + dir.z * 5000); over.y = alt(over.x, over.z);
        const start = base.clone(); start.y = alt(start.x, start.z);
        const types = best.rec.cls === 'artillery' || best.rec.cls === 'aaa' ? ['a10', 'a10'] : [pick(BLUE_STRIKERS), pick(BLUE_STRIKERS)];
        const f = this.spawnFlight({ team: war.side, role: 'strike', types, bombs: 4, pos: start, speed: 220, skill: 0.62,
            route: [{ p: tgt, attack: true }, { p: over }], target: { pos: u.pos, unit: u, label: war.label(u), kind: 'unit' }, callsign: call });
        f.home = base;
        const eta = Math.round(u.pos.distanceTo(base) / f.speed / 60 * 10) / 10;
        this.say('COMMAND', call + ' FLIGHT TASKED AGAINST THE ' + war.label(u) + ' YOU IDENTIFIED — TIME ON TARGET ' + Math.max(1, Math.round(eta)) + ' MIN', { color: '#9fd4ff', say: 'Hammer flight tasked against the target you identified.' });
        g.events.emit('packageTasked', f, { unit: u });
        return f;
    }

    // ═════════════ Events ═════════════
    onAircraftKilled(ac) {
        if (!this.enabled || !ac || !ac.flight) return;
        const f = ac.flight;
        if (f.hp[ac.slot] > 0) f.hp[ac.slot] = 0;
        this.game.events.emit('flightDown', f, { ac });
    }

    // fuel and ammunition keep burning for the rest of the war
    onGroundKilled(t) {
        if (!this.enabled || !t || !t.pos) return;
        const rec = this.game.war.rec(t);
        const cls = rec ? rec.cls : t.cls;
        if (cls === 'fuel' || cls === 'ammo' || t.type === 'fuel') this.burning.push({ pos: t.pos.clone(), size: clamp((t.radius || 10) / 9, 0.8, 1.8), until: 0 });
        else if (cls === 'hangar' || cls === 'command' || cls === 'bunker') this.burning.push({ pos: t.pos.clone(), size: 0.7, until: 0, smoulder: true });
    }

    updateBurning(dt) {
        const g = this.game, war = g.war, fx = g.effects, cam = g.camera.position;
        this.fireT = (this.fireT || 0) - dt;
        const puffs = this.fireT <= 0;
        if (puffs) this.fireT = 0.18;
        for (const b of this.burning) {
            const d = b.pos.distanceTo(cam);
            if (d > 15000) continue;
            if (war.time > b.until) {
                const life = rand(55, 75);
                fx.smokeColumn(b.pos, b.size * (b.smoulder ? 0.6 : 1), life);
                b.until = war.time + life - 5;
            }
            if (puffs && d < 5000 && !b.smoulder) fx.puffFire(_v.copy(b.pos).add(_v2.set(rand(-6, 6), rand(0, 3), rand(-6, 6))), _v2.set(0, rand(5, 9), 0), rand(4, 7) * b.size, 0.8);
        }
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.enabled) return;
        const g = this.game;
        if (g.state === 'menu' || g.state === 'over') return;
        this.flushRadio();
        this.updateFlights(dt);
        this.convoyAcc = (this.convoyAcc || 0) + dt;
        if (this.convoyAcc >= 0.25) { this.updateConvoys(this.convoyAcc); this.convoyAcc = 0; }
        this.updateFleet(dt);
        this.updateBurning(dt);
        this.updateTel(dt);
        this.lodT -= dt;
        if (this.lodT <= 0) { this.lodT = 0.5; this.updateLOD(); }
        this.picT -= dt;
        if (this.picT <= 0) { this.picT = 2; this.airPicture(); }
        this.combatT -= dt;
        if (this.combatT <= 0) { this.combatT = 2; this.abstractCombat(); }
        this.thinkT -= dt;
        if (this.thinkT <= 0) { this.thinkT = 1; this.think(); }
        if (this.mode === 'war') this.objectiveLine();
    }

    objectiveLine() {
        const g = this.game, fr = g.front, t = g.tasks;
        const km = fr ? fr.gainKm() : 0;
        g.objective = 'LIVING WAR · FRONT ' + (km >= 0 ? '+' : '') + km.toFixed(1) + ' KM · BALANCE ' + Math.round((fr ? fr.balance() : 0.5) * 100) + '%' + (t ? ' · TASKS DONE ' + t.doneCount : '');
    }

    // ═════════════ War mode: respawns, ending a sortie ═════════════
    // a new jet at the friendly airfield or carrier nearest where the last one went down
    respawnPoint() {
        const g = this.game;
        if (this.mode !== 'war' || !this.enabled) return null;
        const pref = g.settings.start || 'auto';
        if (pref !== 'auto' && pref !== 'runway' && pref !== 'carrier') return null;
        const at = g.player ? g.player.pos : g.camera.position;
        const opts = [];
        for (const b of BASES) if (b.friendly && !b.civil) opts.push({ where: 'runway', base: b, d: Math.hypot(b.x - at.x, b.z - at.z) });
        const cv = g.naval && g.naval.homeCarrier;
        if (cv && cv.alive) opts.push({ where: 'carrier', d: Math.hypot(cv.pos.x - at.x, cv.pos.z - at.z) });
        opts.sort((a, b) => a.d - b.d);
        return opts[0] || null;
    }

    commands() {
        if (!this.enabled || this.mode !== 'war') return [];
        const g = this.game, p = g.player;
        const onPad = p && p.alive && p.onGround && p.speed < 3 && g.atFriendlyPad && g.atFriendlyPad(p);
        return [{ path: ['SORTIE'], label: 'END SORTIE (BANK THE SCORE)', hint: onPad ? 'ON A FRIENDLY PAD' : 'LAND AT A FRIENDLY BASE FIRST', enabled: !!onPad, run: () => g.gameOver(true) }];
    }

    // ═════════════ Tactical map: flights we know about ═════════════
    drawMap(ctx, map) {
        if (!this.enabled) return;
        const war = this.game.war, P = {};
        ctx.save();
        ctx.font = '600 10px "Share Tech Mono", monospace'; ctx.textBaseline = 'middle';
        for (const f of this.flights) {
            if (f.done || f.members || f.n === 0) continue; // (real jets are drawn from the war registry)
            const own = f.team === war.side;
            if (!own && !f.detected) continue;
            const pos = own ? f.pos : f.lastSeen || f.pos;
            map.toScreen(pos.x, pos.z, P);
            const col = own ? '#6fb4ff' : f.role === 'raid' || f.role === 'cas' ? '#ff5a4a' : '#ffb35a';
            const a = Math.atan2(f.vel.x, -f.vel.z);
            ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(a);
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 2); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
            ctx.strokeStyle = col; ctx.globalAlpha = 0.6;
            ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, -10 - Math.min(40, f.speed * 90 * map.scale)); ctx.stroke();
            ctx.restore();
            ctx.fillStyle = col; ctx.textAlign = 'left';
            const label = own ? f.callsign + ' ×' + f.n + ' ' + f.role.toUpperCase() : (f.role === 'raid' ? 'RAID ×' + f.n : f.role === 'recon' ? 'UNKNOWN ×1' : f.role === 'cas' ? 'ATTACKERS ×' + f.n : 'BANDITS ×' + f.n);
            ctx.fillText(label, P.x + 10, P.y - 8);
            // a raid's likely target
            if (!own && f.target && (f.role === 'raid' || f.role === 'cas')) {
                const Q = map.toScreen(f.target.pos.x, f.target.pos.z);
                ctx.strokeStyle = 'rgba(255,90,74,0.45)'; ctx.setLineDash([3, 5]);
                ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke(); ctx.setLineDash([]);
            }
        }
        // our convoys' destinations
        for (const c of this.convoys) {
            if (c.team !== war.side) continue;
            const a = map.toScreen(c.centre(_v).x, _v.z), b = map.toScreen(c.destPos.x, c.destPos.z);
            ctx.strokeStyle = 'rgba(111,180,255,0.55)'; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#6fb4ff'; ctx.textAlign = 'left'; ctx.fillText(c.callsign + ' → ' + c.destName, a.x + 10, a.y + 10);
        }
        ctx.restore();
    }
}

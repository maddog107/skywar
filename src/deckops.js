// ═══════════════════════════════════════════════════════════════
// Carrier operations (docs/WAR.md "Naval operations"): a carrier's flight deck alive.
//  • Deck crews in their shirt colours (deckcrew.glb, a handful of instanced meshes per carrier): directors walking
//    jets to the catapults backwards, the shooter's signals and salute, green shirts at the launch bar, the hook
//    runner, plane captains by the parked jets, the LSOs on their platform, handlers by the elevators, a tractor.
//  • Parked aircraft (instanced), and the port-aft elevator bringing jets up from the hangar and striking
//    recovered ones below (naval.js setElevator).
//  • Catapult launches (CatCycle): a jet taxis behind its director to the catapult, the jet blast deflector comes
//    up, launch bar and holdback, full power, the shooter's salute, the stroke — the shuttle racing down the track in
//    steam — then the JBD goes down. The player's own launch off the catapult gets the same deck (JBD, shooter,
//    shuttle, steam) around it.
//  • Recoveries (DeckPilot): the Case I pattern — initial, the break, downwind, the 180 — the ball call, the wire
//    through aircraft.js's own trap, or a bolter and round again; then out of the landing area to the elevator.
//    The LSO talks to the player on his approach too.
// The jets are real Aircraft flying through their own ground and flight physics (Aircraft.startCatapult, the wire
// trap); a deck pilot sets their controls and hands them to a normal AI Pilot once they're airborne.
// Only carriers whose model has the deck layout (catSpots, JBDs, shuttles: tools/ships/carrier_model.py) get ops.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeStaticModel } from './meshmerge.js';
import { parkedModel, poseRig, setElevator } from './naval.js';
import { Aircraft, refSpeeds } from './aircraft.js';
import { Pilot, steerToward, avoidTerrain } from './ai.js';
import { clamp, lerp, rand, G, DEG } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
const wrapPi = (a) => { a %= Math.PI * 2; return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a; };
const GLIDE = 3.5 * DEG;

// flight-deck jersey colours (CV NATOPS)
export const SHIRTS = { yellow: 0xf2c417, green: 0x2f9a45, blue: 0x2b5ccc, brown: 0x6e4526, purple: 0x7a3fb0, red: 0xc72e2a, white: 0xeeeeea };

// ═════════════ The catapult cycle (a state machine; tests/navalops.test.mjs) ═════════════
// taxi → hookup (launch bar into the shuttle, holdback, JBD coming up) → tension (the cat takes tension, the jet to
// full power, the shooter's run-up signal) → salute (the pilot salutes, the shooter touches the deck and points down
// the track) → stroke (the shuttle and the jet down the track) → clear (JBD down, shuttle back, steam) → idle.
// Times (s) are a brisk version of real cyclic ops (a real cat launches every 60–90 s).
export const CAT_TIMING = { hookup: 6, tension: 4, salute: 2, strokeMax: 4, clear: 5, jbdUp: 4.5, jbdDown: 3.5, shuttleBack: 5, steam: 5 };

export class CatCycle {
    constructor(index, timing = CAT_TIMING) {
        this.index = index; this.T = timing;
        this.state = 'idle'; this.t = 0;
        this.jet = null;
        this.jbd = 0; this.shuttle = 0; this.steam = 0;
        this.log = [];
    }
    get free() { return this.state === 'idle'; }
    assign(jet) { if (this.state !== 'idle') return false; this.jet = jet; this.set('taxi'); return true; }
    set(s) { this.state = s; this.t = 0; this.log.push(s); return s; }
    // io: { atSpot (the jet stopped on the spot), progress (0..1 of the stroke the jet has run), gone (left the deck),
    //   abort (the jet is lost) } → the state entered this step, or null
    update(dt, io = {}) {
        const T = this.T;
        this.t += dt;
        let ev = null;
        if (io.abort && this.state !== 'idle' && this.state !== 'clear') ev = this.set('clear');
        switch (this.state) {
            case 'taxi': if (io.atSpot) ev = this.set('hookup'); break;
            case 'hookup': if (this.t >= T.hookup) ev = this.set('tension'); break;
            case 'tension': if (this.t >= T.tension) ev = this.set('salute'); break;
            case 'salute': if (this.t >= T.salute) { ev = this.set('stroke'); this.steam = 1; } break;
            case 'stroke':
                this.shuttle = clamp(io.progress ?? this.shuttle, this.shuttle, 1);
                if (io.gone || this.t >= T.strokeMax) ev = this.set('clear');
                break;
            case 'clear':
                if (this.t >= T.clear && this.jbd <= 0 && this.shuttle <= 0) { ev = this.set('idle'); this.jet = null; }
                break;
        }
        // the JBD comes up once the jet is on its spot and stays up through the launch
        const up = this.state === 'hookup' || this.state === 'tension' || this.state === 'salute' || this.state === 'stroke';
        this.jbd = up ? Math.min(1, this.jbd + dt / T.jbdUp) : Math.max(0, this.jbd - dt / T.jbdDown);
        if (this.state === 'clear' && this.t > 1) this.shuttle = Math.max(0, this.shuttle - dt / T.shuttleBack);
        if (this.state !== 'stroke') this.steam = Math.max(0, this.steam - dt / T.steam);
        return ev;
    }
}

// ═════════════ The crew model (deckcrew.glb) ═════════════
let crewGltf = null, crewLoading = null;
export function loadDeckCrew() {
    if (crewLoading) return crewLoading;
    crewLoading = new GLTFLoader().loadAsync('models/ships/deckcrew.glb').then(g => { crewGltf = g; return g; }).catch(e => { console.warn('[deckops] deckcrew.glb not loaded', e && e.message); return null; });
    return crewLoading;
}
export function setDeckCrewModel(gltf) { crewGltf = gltf; crewTpl = null; }
let crewTpl = null;
function crewTemplates() {
    if (crewTpl || !crewGltf) return crewTpl;
    const part = (name) => {
        const o = crewGltf.scene.getObjectByName(name);
        if (!o) return null;
        o.updateMatrixWorld(true);
        const merged = mergeStaticModel(o);
        const mesh = merged.children.find(c => c.isMesh);
        return mesh ? { geo: mesh.geometry, mat: mesh.material } : null;
    };
    const t = { torso: part('crew_torso'), head: part('crew_head'), arm: part('crew_arm'), leg: part('crew_leg'), tractor: part('tractor') };
    if (!t.torso || !t.head || !t.arm || !t.leg) return null;
    return (crewTpl = t);
}

const HIP = 0.92, SHOULDER = 1.42, SX = 0.23;

// Where the crew stand around (ship-local x starboard, z aft; yaw 0 faces the bow) — the jobs pull some away
const CREW_POSTS = [
    ['white', -26.3, 139, Math.PI, 'lso'], ['white', -27.6, 140.5, Math.PI, 'lso'], ['white', -25.2, 141.6, Math.PI * 0.9, 'lso'],
    ['yellow', 8, -2, 0.4, 'director'], ['yellow', -20, 16, -0.3, 'director'], ['yellow', 4, -30, 0.2, 'shooter'], ['yellow', -12, -58, 0.3, 'shooter'],
    ['green', 18, 0, 0.8, 'catcrew'], ['green', 6, 10, 0.6, 'catcrew'], ['green', -30, 12, -0.4, 'catcrew'], ['green', -16, 24, -0.5, 'hookrunner'],
    ['green', -21, 113, 1.2, 'gear'], ['green', 13, 128, -1.6, 'gear'],
    ['blue', 25, -76, 1.4, 'handler'], ['blue', 24, -41, 1.3, 'handler'], ['blue', -30, 94, -0.7, 'elevator'], ['blue', 24, 82, 1.0, 'handler'], ['blue', 10, 48, 0.2, 'tractor'],
    ['brown', 22, -95, 1.0, 'captain'], ['brown', 22, -60, 0.9, 'captain'], ['brown', -13, -123, -0.9, 'captain'], ['brown', -13, -103, -0.8, 'captain'], ['brown', 11, 52, 0.7, 'captain'], ['brown', 20, 74, 0.9, 'captain'],
    ['purple', 17, -12, 0.3, 'fuel'], ['purple', 19, -28, 0.4, 'fuel'], ['purple', 11, 60, -0.4, 'fuel'],
    ['red', -8, -122, 0.1, 'ordnance'], ['red', -6, -101, -0.2, 'ordnance'], ['red', 21.5, 5, 1.6, 'crash'], ['red', 11, 18, 1.2, 'crash'],
    ['white', 1, -20, 0.1, 'safety'], ['white', -16, 2, -0.2, 'safety'], ['white', 16, 90, -0.5, 'safety'],
];

// Arm and leg pose for a member: arm pitch (about x: + swings forward/up) and roll (about z: + out to the side),
// left then right, leg pitches, and how far down he is (kneel 0..1)
function poseOf(m, t) {
    const P = m.P;
    P.al = 0; P.ar = 0; P.rl = 0.08; P.rr = 0.08; P.ll = 0; P.lr = 0; P.kneel = 0;
    switch (m.pose) {
        case 'walk': case 'run': {
            const a = Math.sin(m.phase), k = m.pose === 'run' ? 0.75 : 0.45;
            P.ll = a * k; P.lr = -a * k; P.al = -a * k * 0.8; P.ar = a * k * 0.8;
            break;
        }
        case 'beckon': { // "come ahead": both arms up in front, forearms waving back toward the face
            const w = Math.sin(t * 5 + m.seed) * 0.35;
            P.al = 2.3 + w; P.ar = 2.3 - w; P.rl = 0.35; P.rr = 0.35;
            if (m.walking) { const a = Math.sin(m.phase); P.ll = a * 0.35; P.lr = -a * 0.35; }
            break;
        }
        case 'tension': // the shooter's run-up: right hand high, circling, left arm pointing at the jet
            P.ar = 2.9 + Math.sin(t * 9) * 0.12; P.rr = 0.25 + Math.cos(t * 9) * 0.12;
            P.al = 1.45; P.rl = 0.3;
            break;
        case 'launch': { // the salute: touch the deck, then point down the track
            P.kneel = 1; P.ar = m.poseT < 0.8 ? 0.2 : 1.35; P.rr = 0.05; P.al = 0.4; P.rl = 0.5;
            P.ll = 1.35; P.lr = -0.25;
            break;
        }
        case 'kneel': P.kneel = 1; P.ll = 1.35; P.lr = -0.2; P.al = 0.9; P.ar = 0.9; break;
        case 'hold': P.al = 0.2; P.ar = 0.2; P.rl = 1.4; P.rr = 1.4; break; // arms out: "hold"
        case 'wave': { const w = Math.sin(t * 6 + m.seed); P.ar = 2.6 + w * 0.3; P.rr = 0.6 + w * 0.3; break; }
        case 'lso': P.ar = 1.5 + Math.sin(t * 0.7 + m.seed) * 0.1; P.al = 0.3; break; // the pickle switch held out
        case 'point': P.ar = 1.5; P.rr = 0.25; break;
        case 'sit': P.kneel = 0.55; P.ll = 1.45; P.lr = 1.45; P.al = 0.9; P.ar = 0.9; P.rl = 0.2; P.rr = 0.2; break;
        default: { const b = Math.sin(t * 0.8 + m.seed) * 0.05; P.al = b; P.ar = -b; }
    }
    return P;
}

// ═════════════ A carrier's deck crew (instanced) ═════════════
class CrewSet {
    constructor(ship, tpl, posts) {
        this.ship = ship;
        const deckY = (ship.layout && ship.layout.deckY) || ship.def.deckY;
        this.deckY = deckY;
        const n = posts.length;
        const mk = (T, count, cast) => {
            const im = new THREE.InstancedMesh(T.geo, T.mat, count);
            im.name = 'deckcrew'; im.frustumCulled = false; im.castShadow = cast; im.receiveShadow = true;
            im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            ship.mesh.add(im);
            return im;
        };
        this.torso = mk(tpl.torso, n, true);
        this.head = mk(tpl.head, n, false);
        this.arms = mk(tpl.arm, n * 2, false);
        this.legs = mk(tpl.leg, n * 2, true);
        const col = new THREE.Color();
        this.members = posts.map(([shirt, x, z, yaw, role], i) => {
            col.setHex(SHIRTS[shirt]);
            this.torso.setColorAt(i, col);
            this.arms.setColorAt(i * 2, col); this.arms.setColorAt(i * 2 + 1, col);
            return { i, shirt, role, x, z, yaw, home: { x, z, yaw }, goal: null, speed: 1.4, face: null, pose: role === 'lso' ? 'lso' : 'idle', poseT: 0, phase: rand(0, 6), seed: rand(0, 10), walking: false, job: null, idleT: rand(4, 20), P: {} };
        });
        this.torso.instanceColor.needsUpdate = true; this.arms.instanceColor.needsUpdate = true;
        this.t = 0;
        this.visible = true;
    }

    // members with a role free for a job (the nearest to a point)
    borrow(role, x, z, shirt = null) {
        let best = null, bd = Infinity;
        for (const m of this.members) {
            if (m.job || (role && m.role !== role) || (shirt && m.shirt !== shirt)) continue;
            const d = (m.x - x) ** 2 + (m.z - z) ** 2;
            if (d < bd) { bd = d; best = m; }
        }
        return best;
    }
    release(m) { if (!m) return; m.job = null; m.pose = m.role === 'lso' ? 'lso' : 'idle'; m.face = null; this.walkTo(m, m.home.x, m.home.z); }
    walkTo(m, x, z, speed = 1.4, face = null) { m.goal = { x, z }; m.speed = speed; m.face = face; }

    setVisible(v) { if (v === this.visible) return; this.visible = v; for (const im of [this.torso, this.head, this.arms, this.legs]) im.visible = v; }

    update(dt, avoid) {
        this.t += dt;
        const t = this.t;
        for (const m of this.members) {
            m.poseT += dt;
            // idle crew wander a few metres now and then (never into the landing area while it's in use)
            if (!m.job && !m.goal) {
                m.idleT -= dt;
                if (m.idleT <= 0 && m.role !== 'lso') {
                    m.idleT = rand(8, 30);
                    const x = m.home.x + rand(-4, 4), z = m.home.z + rand(-5, 5);
                    if (!avoid || !avoid(x, z)) this.walkTo(m, x, z, 1.2);
                }
            }
            m.walking = false;
            if (m.goal) {
                const dx = m.goal.x - m.x, dz = m.goal.z - m.z, d = Math.hypot(dx, dz);
                if (d < 0.12) { m.goal = null; if (!m.job) { m.yaw = m.home.yaw; if (m.pose === 'walk' || m.pose === 'run') m.pose = 'idle'; } }
                else {
                    const step = Math.min(d, m.speed * dt);
                    m.x += dx / d * step; m.z += dz / d * step;
                    m.walking = true;
                    m.phase += m.speed * dt * 3.2;
                    if (m.face == null) m.yaw = Math.atan2(-dx, -dz);
                    if (!m.job && m.pose !== 'walk' && m.pose !== 'run') m.pose = m.speed > 2.2 ? 'run' : 'walk';
                }
            }
            if (m.face != null) m.yaw = m.face;
        }
        if (!this.visible) return;
        for (const m of this.members) this.write(m, poseOf(m, t));
        for (const im of [this.torso, this.head, this.arms, this.legs]) im.instanceMatrix.needsUpdate = true;
    }

    write(m, P) {
        const y = this.deckY - P.kneel * 0.42;
        _e.set(-P.kneel * 0.25, m.yaw, 0, 'YXZ'); // (kneeling: leaning forward)
        _q.setFromEuler(_e);
        _m.compose(_p.set(m.x, y, m.z), _q, _s);
        this.torso.setMatrixAt(m.i, _m);
        this.head.setMatrixAt(m.i, _m);
        for (let k = 0; k < 2; k++) {
            const sg = k ? 1 : -1;
            // arm: at the shoulder, rolled out to its side, then swung forward
            _m2.makeRotationZ(sg * (k ? P.rr : P.rl)).multiply(_m3.makeRotationX(k ? P.ar : P.al));
            _m2.setPosition(sg * SX, SHOULDER, 0);
            this.arms.setMatrixAt(m.i * 2 + k, _m3.multiplyMatrices(_m, _m2));
            _m2.makeRotationX(k ? P.lr : P.ll).setPosition(sg * 0.1, HIP, 0);
            this.legs.setMatrixAt(m.i * 2 + k, _m3.multiplyMatrices(_m, _m2));
        }
    }

    dispose() { for (const im of [this.torso, this.head, this.arms, this.legs]) { im.removeFromParent(); im.dispose(); } }
}

// ═════════════ A jet on the deck or in the pattern ═════════════
// Put in place of the jet's AI pilot (game.js calls pilot.update before the physics): kinematic on the deck (taxiing
// behind a director, riding an elevator, held on the catapult), then the jet's own physics for the launch and in
// the air, flown with the same stick logic as the AI. `combat`: the Pilot it hands the jet back to once airborne.
export class DeckPilot {
    constructor(deck, ac, { combat = null, skill = 0.6, recover = false } = {}) {
        this.deck = deck; this.ac = ac; this.game = deck.game;
        this.combat = combat;
        this.skill = combat ? combat.skill : skill;
        this.target = null; this.formation = null; this.passive = true;
        this.state = recover ? 'marshal' : 'hold';
        this.t = 0;
        this.path = null; this.s = 0; this.hdg = 0;
        this.cat = null; this.elevDrop = 0;
        this.bolterPlan = false;
        ac.pilot = this;
    }

    // deck-local placement (the jet rides the deck frame; aircraft.js updateGround places it from _dl)
    place(lx, lz, heading) {
        const ac = this.ac, ship = this.deck.ship;
        ac.deck = ship; ac.onGround = true; ac.onWater = false;
        ac._dl = { ship, lx, lz };
        ac.deckHeading = heading;
        ac.relSpeed = 0; ac.speed = 0;
        ac.vel.copy(ship.vel);
        ac.gear = true; ac.gearAnim = 1; ac.alpha = 0;
        ac.qv.setFromAxisAngle(_v.set(0, 1, 0), ship.heading + heading);
        ship.toWorld(lx, 0, lz, _v2);
        ac.pos.x = _v2.x; ac.pos.z = _v2.z;
        ac.pos.y = ship.deckHeight(ac.pos.x, ac.pos.z) + ac.gearOffset;
        ac.syncBody();
    }

    // follow a deck-local path at taxi speed, turning toward it; true when it's at the end
    taxi(dt, speed = 3) {
        const P = this.path;
        let seg = 0, s = this.s + speed * dt;
        let x = P[0][0], z = P[0][1], hx = 0, hz = -1;
        let acc = 0;
        for (seg = 0; seg < P.length - 1; seg++) {
            const L = Math.hypot(P[seg + 1][0] - P[seg][0], P[seg + 1][1] - P[seg][1]);
            if (acc + L >= s || seg === P.length - 2) {
                const k = L > 0 ? clamp((s - acc) / L, 0, 1) : 1;
                x = lerp(P[seg][0], P[seg + 1][0], k); z = lerp(P[seg][1], P[seg + 1][1], k);
                hx = P[seg + 1][0] - P[seg][0]; hz = P[seg + 1][1] - P[seg][1];
                if (k >= 1 && seg === P.length - 2) { s = acc + L; this.s = s; this.hdg = this.turnTo(Math.atan2(-hx, -hz), dt, 0.9); this.place(x, z, this.hdg); return true; }
                break;
            }
            acc += L;
        }
        this.s = s;
        this.hdg = this.turnTo(Math.atan2(-hx, -hz), dt, 0.5);
        this.place(x, z, this.hdg);
        return false;
    }
    turnTo(want, dt, rate) { return this.hdg + clamp(wrapPi(want - this.hdg), -rate * dt, rate * dt); }

    update(dt) {
        const ac = this.ac, c = ac.controls, D = this.deck;
        this.t += dt;
        if (!ac.alive) return;
        switch (this.state) {
            case 'hold': case 'elevator': // (elevator ride: deckops moves the jet up with it)
                c.throttle = 0; c.pitch = c.roll = c.yaw = 0;
                this.place(this.lx, this.lz, this.hdg);
                return;
            case 'taxi': {
                c.throttle = 0; c.pitch = c.roll = c.yaw = 0;
                const done = this.taxi(dt, this.t < 2 ? 1.5 : 3.2);
                if (done) { this.state = this.cat ? 'spot' : 'parked'; this.lx = ac._dl.lx; this.lz = ac._dl.lz; }
                return;
            }
            case 'spot': case 'parked': {
                // on the catapult: held by the holdback bar (full power in tension), launch bar in the shuttle
                const cyc = this.cat;
                const power = cyc && (cyc.state === 'tension' || cyc.state === 'salute');
                c.throttle = power ? 1 : 0.05; c.pitch = c.roll = c.yaw = 0;
                ac.flaps = 1; ac.hook = false;
                this.place(this.lx, this.lz, 0);
                if (cyc && cyc.state === 'stroke' && !this.fired) {
                    this.fired = true;
                    c.throttle = 1;
                    ac.startCatapult();
                    this.state = 'launch';
                    this.x0 = this.lz;
                }
                return;
            }
            case 'launch': {
                c.throttle = 1; c.pitch = 0; c.roll = 0; c.yaw = 0;
                if (ac.onGround && ac._dl) this.progress = (this.x0 - ac._dl.lz);
                if (!ac.onGround) { this.state = 'climb'; this.t = 0; this.climbHdg = Math.atan2(-ac.vel.x, -ac.vel.z); }
                return;
            }
            case 'climb': this.climbOut(dt); return;
        }
        this.flyPattern(dt);
    }

    // off the bow: wings level, climb straight ahead, gear and flaps up, then hand over to the fighter AI
    climbOut(dt) {
        const ac = this.ac, c = ac.controls;
        const agl = ac.pos.y; // (over the sea)
        const gam = clamp((ac.speed - refSpeeds(ac.spec).takeoff) / 60, 0.04, 0.22);
        _v.set(-Math.sin(this.climbHdg), gam, -Math.cos(this.climbHdg)).normalize();
        steerToward(ac, _v, c, 1, true);
        c.throttle = 1;
        if (agl > 45 && ac.gear) ac.gear = false;
        if (agl > 250) ac.flaps = 0;
        if (agl > 420 || this.t > 25) this.deck.airborne(this);
    }

    // ── the Case I pattern and the approach ──
    // waypoints in the carrier's frame (x starboard, z aft; metres; altitudes above the sea)
    patternPoint(name, out) {
        const D = this.deck, s = D.ship, L = D.geo;
        switch (name) {
            case 'initial': return s.toWorld(450, 0, 5200, out).setY(300);
            case 'break': return s.toWorld(450, 0, -700, out).setY(250);
            case 'downwind': return s.toWorld(-2100, 0, -200, out).setY(185);
            case 'abeam': return s.toWorld(-2100, 0, 900, out).setY(185);
            case 'ninety': return s.toWorld(-1100, 0, 1750, out).setY(140);
            case 'groove': return s.toWorld(L.touch[0] + L.la[0] * -1350, 0, L.touch[1] + L.la[1] * -1350, out).setY(s.deckY + 1350 * Math.tan(GLIDE) + 8);
        }
        return out.copy(s.pos);
    }

    flyTo(dt, target, speed, maxBank = 1.0, climbMax = 0.2) {
        const ac = this.ac, c = ac.controls;
        const dx = target.x - ac.pos.x, dz = target.z - ac.pos.z, dh = Math.hypot(dx, dz) || 1;
        const gam = clamp((target.y - ac.pos.y) / Math.max(dh, 400), -0.12, climbMax);
        _v.set(dx / dh * Math.cos(gam), Math.sin(gam), dz / dh * Math.cos(gam));
        steerToward(ac, _v, c, 0.8, true, maxBank);
        c.throttle = clamp(0.55 + (speed - ac.speed) * 0.04, 0.05, ac.hasAB ? 0.9 : 1);
        ac.airbrake = ac.speed > speed + 40;
        if (avoidTerrain(ac, c, 120)) c.throttle = 0.9;
        return dh;
    }

    flyPattern(dt) {
        const ac = this.ac, D = this.deck, s = D.ship, c = ac.controls, rs = refSpeeds(ac.spec);
        const app = rs.approach;
        if (!s.alive) { this.deck.abandon(this); return; }
        switch (this.state) {
            case 'marshal': { // the stack: a left-hand orbit over the carrier at 1500 m, until it's our turn
                const a = Math.atan2(ac.pos.z - s.pos.z, ac.pos.x - s.pos.x) - 0.35;
                _v2.set(s.pos.x + Math.cos(a) * 3500, 1500, s.pos.z + Math.sin(a) * 3500);
                this.flyTo(dt, _v2, 170, 0.6);
                ac.gear = false; ac.hook = false; ac.flaps = 0;
                if (D.nextToLand(this)) { this.state = 'initial'; D.radio(this, 'initial'); }
                return;
            }
            case 'initial':
                if (this.flyTo(dt, this.patternPoint('initial', _v2), 190, 0.7) < 600) this.state = 'upwind';
                return;
            case 'upwind': case 'bolter-up': {
                this.patternPoint('break', _v2);
                const d = this.flyTo(dt, _v2, this.state === 'upwind' ? 180 : 120, 0.5);
                if (this.state === 'bolter-up') { ac.gear = true; if (ac.pos.y > s.deckY + 60) ac.gear = false; }
                if (d < 700 || D.localOf(ac.pos).lz < -600) { this.state = 'break'; this.t = 0; }
                return;
            }
            case 'break': {
                // a hard turn downwind, bleeding off speed; gear, flaps and hook come down
                const d = this.flyTo(dt, this.patternPoint('downwind', _v2), app + 25, 1.25);
                if (ac.speed < 170) { ac.gear = true; ac.flaps = 2; ac.hook = !this.bolterPlan; }
                ac.airbrake = ac.speed > app + 45;
                if (d < 700) this.state = 'downwind';
                return;
            }
            case 'downwind': {
                const d = this.flyTo(dt, this.patternPoint('abeam', _v2), app + 8, 0.6);
                ac.gear = true; ac.flaps = 2; ac.hook = !this.bolterPlan;
                if (d < 500) this.state = 'ninety';
                return;
            }
            case 'ninety': {
                const d = this.flyTo(dt, this.patternPoint('ninety', _v2), app + 4, 0.75, 0.05);
                if (d < 450) { this.state = 'groove'; this.called = false; }
                return;
            }
            case 'groove': {
                const d = this.flyTo(dt, this.patternPoint('groove', _v2), app, 0.8, 0.05);
                if (d < 350 || D.onFinal(ac) < 1500) { this.state = 'final'; this.t = 0; }
                return;
            }
            case 'final': return this.final(dt, app);
            case 'rollout': {
                c.throttle = 0; c.pitch = c.roll = c.yaw = 0;
                ac.airbrake = true;
                if (ac.onGround && ac.relSpeed < 1.5) {
                    ac.airbrake = false; ac.hook = false;
                    this.lx = ac._dl ? ac._dl.lx : 0; this.lz = ac._dl ? ac._dl.lz : 0;
                    this.hdg = ac.deckHeading || 0;
                    this.state = 'trapped'; this.t = 0;
                    D.trapped(this);
                }
                return;
            }
            case 'trapped': // the hook runner clears the wire, the director takes him
                c.throttle = 0; this.place(this.lx, this.lz, this.hdg);
                if (this.t > 3.5) { this.path = D.taxiInPath(this.lx, this.lz); this.s = 0; this.state = 'taxi-in'; this.t = 0; }
                return;
            case 'taxi-in': {
                c.throttle = 0;
                if (this.taxi(dt, this.t < 3 ? 1.5 : 3)) { this.lx = this.ac._dl.lx; this.lz = this.ac._dl.lz; this.state = 'strike'; D.strikeBelow(this); }
                return;
            }
            case 'strike': c.throttle = 0; this.place(this.lx, this.lz, this.hdg); return;
            case 'waveoff': {
                // power up, climb straight ahead, round again
                this.flyTo(dt, this.patternPoint('break', _v2), app + 20, 0.4, 0.15);
                c.throttle = Math.max(c.throttle, 0.9);
                if (this.t > 12) { this.state = 'upwind'; ac.gear = false; }
                return;
            }
        }
    }

    // on the ball: the angled deck's centreline and the glide slope to the target wire, leading the moving deck
    // (the auto-land's final approach in autopilot.js, flown along the angled deck)
    final(dt, app) {
        const ac = this.ac, c = ac.controls, D = this.deck, s = D.ship;
        ac.gear = true; ac.flaps = 2; ac.hook = !this.bolterPlan;
        if (ac.onGround) {
            // on deck: in the wires, or a bolter (no wire: full power and fly off the angled deck)
            if (ac.trap || ac.relSpeed < 30) { this.state = 'rollout'; return; }
            c.throttle = 1; c.pitch = 0.45; c.roll = 0; c.yaw = 0; ac.airbrake = false;
            if (!this.boltered) { this.boltered = true; D.radio(this, 'bolter'); }
            return;
        }
        if (this.boltered) { this.boltered = false; this.bolterPlan = false; this.state = 'bolter-up'; this.t = 0; return; }
        const fwd = D.landingDir(_v3);
        const touch = D.touchPoint(_v2);
        const rel = _v.subVectors(ac.pos, touch);
        const along = -rel.dot(fwd), lateral = rel.x * fwd.z - rel.z * fwd.x;
        const glideAlt = touch.y + Math.max(along, 0) * Math.tan(GLIDE);
        const hErr = ac.pos.y - ac.gearOffset - glideAlt;
        if (!this.called && along < 1400) { this.called = true; D.radio(this, 'ball'); }
        // wave-off: badly out of the groove close in (or the deck isn't clear)
        if (along < 650 && along > 150 && (Math.abs(lateral) > 32 || Math.abs(hErr) > 22 || D.fouled(this))) {
            this.state = 'waveoff'; this.t = 0; D.radio(this, 'waveoff'); return;
        }
        const look = clamp(along * 0.5, 350, 1200);
        const shipVel = s.vel;
        const aim = _v.copy(touch).addScaledVector(fwd, -(along - look)).addScaledVector(shipVel, look / Math.max(ac.speed, 50));
        aim.y = touch.y + Math.max(along - look, 0) * Math.tan(GLIDE) + ac.gearOffset + clamp(-hErr * 5, -120, 150);
        const dir = aim.sub(ac.pos).normalize();
        steerToward(ac, dir, c, 1, true, 0.45);
        c.yaw = clamp(c.yaw, -0.4, 0.4);
        const relSpeed = _v2.subVectors(ac.vel, shipVel).length();
        c.throttle = clamp(0.45 + (app - relSpeed) * 0.06, 0.05, ac.hasAB ? 0.9 : 1);
        ac.airbrake = relSpeed > app + 15;
        if (along < -250) { this.state = 'waveoff'; this.t = 0; } // (flew past without touching: round again)
    }
}

// ═════════════ A carrier's deck ═════════════
export class DeckOps {
    // ops: the navalops system (or anything with game); opts: { launches (AI launches and recoveries run here),
    //   crew (default true), parked (extra parked jets, default true), cats: which catapults AI jets use }
    constructor(ops, ship, opts = {}) {
        this.ops = ops; this.game = ops.game; this.ship = ship;
        this.team = ship.team;
        const lay = ship.layout;
        this.ok = !!(lay && lay.catSpots && lay.landing && ship.rig && ship.rig.nodes.jbd_1);
        this.opts = opts;
        this.jets = [];           // DeckPilots
        this.queue = [];          // launch requests
        this.cap = [];            // { ac, until } airborne jets launched here
        this.crew = null; this.parked = [];
        this.elev = { i: 3, k: 0, want: 0, jet: null, then: null, busy: false };
        this.t = 0; this.lastTrap = -1e9; this.lsoT = 0;
        if (!this.ok) return;
        this.geo = this.geometry(lay);
        this.cats = lay.catSpots.map((_, i) => new CatCycle(i));
        this.aiCats = opts.cats || (this.team === 'blue' ? [2, 0] : [0, 1]); // (blue: cat 3 by the elevator, then cat 1; the player's is cat 2)
        if (opts.parked !== false) this.addParked();
        this.lso = { player: null, calls: {} };
    }

    geometry(lay) {
        const ang = (lay.landing.angleDeg || 8) * DEG;
        const la = [-Math.sin(ang), -Math.cos(ang)];             // landing direction (toward the bow and to port)
        const wz = lay.wires && lay.wires.length ? lay.wires.map(w => (w[0][1] + w[1][1]) / 2) : [138, 126, 114, 102];
        const tz = (wz[1] + wz[2]) / 2 - 2;                       // the reference point touches down aiming for the 3-wire
        const tx = lay.landing.sternX - (160 - tz) * Math.tan(ang);
        const e = (lay.elevators || [])[3];
        const elev4 = e ? [e.reduce((a, p) => a + p[0], 0) / e.length, e.reduce((a, p) => a + p[1], 0) / e.length] : [-35.6, 81];
        return { la, touch: [tx, tz], halfW: lay.landing.halfW || 12.5, elev4, ang, deckY: lay.deckY || this.ship.def.deckY, wires: wz };
    }

    // ── geometry helpers (world) ──
    localOf(p) { return this.ship.toLocal(p.x, p.z); }
    landingDir(out) { const h = this.ship.heading + this.geo.ang; return out.set(-Math.sin(h), 0, -Math.cos(h)); }
    touchPoint(out) { return this.ship.toWorld(this.geo.touch[0], this.geo.deckY, this.geo.touch[1], out); }
    // along-track distance of an aircraft to the touchdown point (Infinity if it's not behind the ramp)
    onFinal(ac) {
        const fwd = this.landingDir(_v3), touch = this.touchPoint(_v2);
        const rel = _v.subVectors(ac.pos, touch);
        const along = -rel.dot(fwd), lateral = Math.abs(rel.x * fwd.z - rel.z * fwd.x);
        return along > 0 && lateral < along * 0.4 + 200 ? along : Infinity;
    }
    // is a deck-local point in the landing area?
    inLandingArea(x, z) {
        const g = this.geo;
        if (z < (this.ship.layout.landing.fwdZ ?? -32) || z > 162) return false;
        const cx = this.ship.layout.landing.sternX - (160 - z) * Math.tan(g.ang);
        return Math.abs(x - cx) < g.halfW + 2;
    }
    catSpot(i) { return this.ship.layout.catSpots[i]; }

    // ── parked aircraft (instanced, extra to the model's own deck park) ──
    addParked() {
        const spots = [['fa18', 26.5, -34, 0.95], ['fa18', 26.5, -20, 0.95], ['fa18', 15.5, 96, -0.9], ['fa18', 15.5, 113, -0.9], ['fa18', 17, 131, -0.9]];
        const kinds = [...new Set(spots.map(s => s[0]))];
        const deckY = this.geo.deckY;
        for (const kind of kinds) {
            const list = spots.filter(s => s[0] === kind);
            const model = parkedModel(kind);
            model.updateMatrixWorld(true);
            const merged = mergeStaticModel(model);
            for (const mesh of merged.children) {
                if (!mesh.isMesh) continue;
                const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
                im.name = 'deckparked'; im.castShadow = mesh.castShadow; im.receiveShadow = true;
                list.forEach(([, x, z, yaw], k) => { _q.setFromAxisAngle(_v.set(0, 1, 0), yaw); _m.compose(_p.set(x, deckY, z), _q, _s.set(0.95, 0.95, 0.95)); im.setMatrixAt(k, _m); });
                _s.set(1, 1, 1);
                im.computeBoundingSphere();
                this.ship.mesh.add(im);
                this.ship.details.push(im); // (hidden with the other details when the carrier is small on screen)
                this.parked.push(im);
            }
        }
    }

    ensureCrew() {
        if (this.crew || this.opts.crew === false) return;
        const tpl = crewTemplates();
        if (!tpl) { loadDeckCrew(); return; }
        this.crew = new CrewSet(this.ship, tpl, CREW_POSTS);
    }

    // ═════════════ Launches ═════════════
    // A new AI jet up the elevator (blue) or on a spot by a bow catapult (red), taxied to a catapult and launched.
    // o: { type, skill, onAirborne(ac) } → the request
    requestLaunch(o = {}) {
        if (!this.ok) return null;
        const r = { type: o.type || (this.team === 'blue' ? 'fa18' : 'su35'), skill: o.skill ?? 0.6, onAirborne: o.onAirborne || null, ac: o.ac || null, combat: o.combat || null, t: this.t };
        this.queue.push(r);
        return r;
    }

    // an existing aircraft (with its AI pilot) goes out by catapult: game.js's enemy carrier launches (navalops.js
    // catapultLaunch). False if there's no free catapult for it right now.
    adopt(ac) {
        if (!this.ok || !ac.pilot) return false;
        const cat = this.freeCat();
        if (cat == null) return false;
        const dp = new DeckPilot(this, ac, { combat: ac.pilot });
        this.spotNear(dp, cat);
        return true;
    }

    freeCat() {
        for (const i of this.aiCats) {
            const c = this.cats[i];
            if (!c.free) continue;
            if (this.inLandingArea(...this.catSpot(i)) && this.recovering()) continue; // (the waist cats sit in the landing area)
            if (this.playerOn(i)) continue;
            return i;
        }
        return null;
    }
    playerOn(i) {
        const p = this.game.player;
        if (!p || !p.alive || p.deck !== this.ship || !p._dl) return false;
        const s = this.catSpot(i);
        return Math.hypot(p._dl.lx - s[0], p._dl.lz - s[1]) < 30;
    }
    recovering() { return this.jets.some(j => ['final', 'groove', 'ninety', 'rollout', 'trapped'].includes(j.state)); }

    // a jet appears on the deck a short taxi from catapult i (red: the enemy carrier's alert jets)
    spotNear(dp, i) {
        const [x, z] = this.catSpot(i);
        const pre = i === 0 ? [[2, 16], [8, 6], [x, z + 6], [x, z]] : i === 1 ? [[-9, -34], [-6, -48], [x, z + 6], [x, z]] : [[x - 6, z + 26], [x, z + 10], [x, z]];
        dp.path = pre; dp.s = 0; dp.hdg = Math.atan2(-(pre[1][0] - pre[0][0]), -(pre[1][1] - pre[0][1]));
        dp.cat = this.cats[i]; dp.cat.assign(dp.ac);
        dp.state = 'taxi'; dp.t = 0; dp.catIndex = i;
        dp.place(pre[0][0], pre[0][1], dp.hdg);
        this.jets.push(dp);
        this.assignDirector(dp);
    }

    spawnJet(r) {
        const g = this.game;
        const ac = new Aircraft(g, r.type, { team: this.team, name: r.name || null });
        ac.flares = ac.spec.flares;
        g.aircraft.push(ac);
        return ac;
    }

    processQueue() {
        if (!this.queue.length) return;
        const r = this.queue[0];
        const cat = this.freeCat();
        if (cat == null) return;
        if (this.team === 'blue' && !this.elev.busy && this.ship.rig.elevators[3]) {
            // up from the hangar on the port-aft elevator, then taxi to the catapult
            this.queue.shift();
            this.elevatorUp(r, cat);
        } else if (this.team !== 'blue') {
            this.queue.shift();
            const ac = r.ac || this.spawnJet(r);
            const dp = new DeckPilot(this, ac, { combat: r.combat, skill: r.skill });
            dp.request = r;
            this.spotNear(dp, cat);
        }
    }

    elevatorUp(r, cat) {
        const E = this.elev;
        E.busy = true; E.want = 1; E.cat = cat;
        E.then = () => {
            // at the hangar deck: the jet is wheeled on, and the elevator brings it up
            const ac = r.ac || this.spawnJet(r);
            const dp = new DeckPilot(this, ac, { combat: r.combat, skill: r.skill });
            dp.request = r;
            dp.state = 'elevator'; dp.lx = this.geo.elev4[0]; dp.lz = this.geo.elev4[1] + 3; dp.hdg = 0;
            dp.place(dp.lx, dp.lz, 0);
            dp.cat = this.cats[cat]; dp.cat.assign(ac); dp.catIndex = cat;
            this.jets.push(dp);
            E.jet = dp; E.want = 0;
            E.then = () => {
                // up: taxi to the catapult behind a director
                const [x, z] = this.catSpot(cat);
                // (inboard off the elevator first: the deck edge runs in toward the stern there)
                const off = [[dp.lx, dp.lz], [dp.lx + 5.5, dp.lz - 7]];
                dp.path = cat === 2 ? [...off, [-26.5, 55], [-26, 36], [x - 0.5, z + 13], [x, z + 4], [x, z]] : [...off, [-22, 50], [-8, 28], [4, 12], [10, 4], [x, z + 4], [x, z]];
                dp.s = 0; dp.state = 'taxi'; dp.t = 0;
                E.jet = null; E.busy = false;
                this.assignDirector(dp);
            };
        };
    }

    strikeBelow(dp) {
        const E = this.elev;
        const go = () => {
            E.busy = true; E.jet = dp; E.want = 1;
            E.then = () => { this.despawn(dp); E.jet = null; E.want = 0; E.then = () => { E.busy = false; }; };
        };
        if (!E.busy) go(); else dp.waitElevator = go;
    }

    despawn(dp) {
        const g = this.game, ac = dp.ac;
        const i = this.jets.indexOf(dp); if (i >= 0) this.jets.splice(i, 1);
        this.releaseCrew(dp);
        ac.remove();
        const k = g.aircraft.indexOf(ac); if (k >= 0) g.aircraft.splice(k, 1);
        ac.removed = true;
        this.cap = this.cap.filter(c => c.ac !== ac);
        this.ops.onStruckBelow && this.ops.onStruckBelow(this, ac);
    }

    // the jet is off the bow and climbing: hand it to its fighter AI
    airborne(dp) {
        const g = this.game, ac = dp.ac;
        const i = this.jets.indexOf(dp); if (i >= 0) this.jets.splice(i, 1);
        let pl = dp.combat;
        if (pl) ac.pilot = pl;
        else { pl = new Pilot(g, ac, dp.skill); pl.home = this.ship.pos; pl.leash = 16000; }
        ac.gear = false; ac.flaps = 0;
        this.cap.push({ ac, t0: this.t, until: this.t + rand(240, 420) });
        if (dp.request && dp.request.onAirborne) dp.request.onAirborne(ac);
    }

    // ═════════════ Recoveries ═════════════
    // an airborne jet of ours comes back to land (the pattern, the ball, a wire — or a bolter), then goes below
    recover(ac) {
        if (!this.ok || !ac || !ac.alive || ac.onGround || this.jets.some(j => j.ac === ac)) return false;
        const dp = new DeckPilot(this, ac, { combat: ac.pilot && !(ac.pilot instanceof DeckPilot) ? ac.pilot : null, recover: true });
        // (a rookie bolters more often; the pattern takes the same wire otherwise)
        dp.bolterPlan = Math.random() < lerp(0.2, 0.06, dp.skill);
        this.jets.push(dp);
        this.cap = this.cap.filter(c => c.ac !== ac);
        this.radio(dp, 'marshal');
        return true;
    }
    abandon(dp) {
        const i = this.jets.indexOf(dp); if (i >= 0) this.jets.splice(i, 1);
        this.releaseCrew(dp);
        if (dp.combat && dp.ac.alive) dp.ac.pilot = dp.combat;
        else if (dp.ac.alive) { const pl = new Pilot(this.game, dp.ac, dp.skill); pl.home = null; }
    }
    // one jet at a time into the pattern, 40 s apart, with the landing area clear of launches and the player
    nextToLand(dp) {
        if (this.t - this.lastTrap < 25) return false;
        if (this.jets.some(j => j !== dp && ['initial', 'upwind', 'break', 'downwind', 'ninety', 'groove', 'final', 'rollout', 'trapped', 'bolter-up', 'waveoff'].includes(j.state))) return false;
        if (this.cats.some((c, i) => this.inLandingArea(...this.catSpot(i)) && !c.free)) return false;
        const p = this.game.player;
        if (p && p.alive && !p.onGround && p.gear && this.onFinal(p) < 6000) return false;
        const q = this.jets.filter(j => j.state === 'marshal');
        return q[0] === dp;
    }
    fouled(dp) {
        // a jet (or the player) stopped in the landing area
        for (const j of this.jets) if (j !== dp && j.ac._dl && j.ac.onGround && this.inLandingArea(j.ac._dl.lx, j.ac._dl.lz)) return true;
        const p = this.game.player;
        return !!(p && p.alive && p.onGround && p.deck === this.ship && p._dl && this.inLandingArea(p._dl.lx, p._dl.lz));
    }
    trapped(dp) {
        this.lastTrap = this.t;
        this.radio(dp, 'trap');
        // the hook runner goes out to the jet
        const C = this.crew;
        if (C) {
            const m = C.borrow('hookrunner', dp.lx, dp.lz) || C.borrow('gear', dp.lx, dp.lz);
            if (m) { m.job = dp; C.walkTo(m, dp.lx - 3, dp.lz + 7, 3); dp.crew = [...(dp.crew || []), m]; setTimeout(() => { if (m.job === dp) C.release(m); }, 9000); }
        }
        this.assignDirector(dp);
    }
    // out of the landing area, aft along the port side (inside the deck edge) and onto the port-aft elevator
    taxiInPath(x, z) {
        const [ex, ez] = this.geo.elev4;
        return [[x, z], [x - 5, z + 9], [-26, Math.max(z + 22, 40)], [-27.5, 66], [ex + 4.5, ez - 7], [ex, ez + 2]];
    }

    // ═════════════ Crew jobs ═════════════
    assignDirector(dp) {
        const C = this.crew;
        if (!C || dp.director) return;
        const m = C.borrow('director', dp.ac._dl ? dp.ac._dl.lx : 0, dp.ac._dl ? dp.ac._dl.lz : 0);
        if (!m) return;
        m.job = dp; m.pose = 'beckon';
        dp.director = m;
        dp.crew = [...(dp.crew || []), m];
    }
    releaseCrew(dp) {
        const C = this.crew;
        if (!C || !dp.crew) return;
        for (const m of dp.crew) if (m.job === dp || m.job === dp.cat) C.release(m);
        dp.crew = null; dp.director = null;
    }

    // the director walks backwards ahead of a taxiing jet, facing it; at the catapult the shooter and the green
    // shirts take over
    crewJobs(dt) {
        const C = this.crew;
        if (!C) return;
        for (const dp of this.jets) {
            const m = dp.director, ac = dp.ac;
            if (!m || !ac._dl) continue;
            const moving = dp.state === 'taxi' || dp.state === 'taxi-in';
            if (!moving && dp.state !== 'trapped') {
                if (dp.state === 'spot' || dp.state === 'strike' || dp.state === 'launch') { C.release(m); dp.director = null; }
                continue;
            }
            const h = dp.hdg, ahead = 13;
            const tx = ac._dl.lx - Math.sin(h) * ahead + Math.cos(h) * 3, tz = ac._dl.lz - Math.cos(h) * ahead - Math.sin(h) * 3;
            m.goal = m.goal || { x: 0, z: 0 };
            m.goal.x = tx; m.goal.z = tz; m.speed = 3.6; m.face = h + Math.PI;
            m.pose = 'beckon';
        }
        // catapult crews
        for (const cyc of this.cats) {
            const i = cyc.index, spot = this.catSpot(i);
            if (cyc.state === 'hookup' && !cyc.crew) {
                // green shirts to the launch bar, the shooter forward and to the side of the jet
                const side = i === 0 ? -1 : 1;
                const g1 = C.borrow('catcrew', spot[0], spot[1]), g2 = C.borrow('catcrew', spot[0], spot[1]);
                const sh = C.borrow('shooter', spot[0], spot[1]) || C.borrow('safety', spot[0], spot[1]);
                cyc.crew = [g1, g2, sh].filter(Boolean);
                if (g1) { g1.job = cyc; C.walkTo(g1, spot[0] - 1.2, spot[1] - 5.2, 2.5); }
                if (g2) { g2.job = cyc; C.walkTo(g2, spot[0] + 1.5, spot[1] - 4.2, 2.5); }
                if (sh) { sh.job = cyc; C.walkTo(sh, spot[0] + side * 14, spot[1] - 16, 2.4); }
            }
            const crew = cyc.crew || [];
            const [g1, g2, sh] = [crew[0], crew[1], crew[2]];
            if (cyc.state === 'hookup') {
                for (const g of [g1, g2]) if (g && !g.goal) { g.pose = 'kneel'; g.face = Math.PI; }
                if (sh && !sh.goal) { sh.pose = 'point'; sh.face = Math.atan2(spot[0] - sh.x, spot[1] - sh.z) + Math.PI; }
            } else if (cyc.state === 'tension') {
                // the green shirts clear out; the shooter gives the run-up
                if (!cyc.greensOff) { cyc.greensOff = true; for (const g of [g1, g2]) if (g) { g.pose = 'walk'; g.face = null; C.walkTo(g, spot[0] + (g === g1 ? -12 : 12), spot[1] - 2, 2.2); } }
                if (sh) { sh.pose = 'tension'; sh.face = Math.atan2(spot[0] - sh.x, spot[1] - sh.z) + Math.PI; }
            } else if (cyc.state === 'salute' || cyc.state === 'stroke') {
                if (sh) { if (sh.pose !== 'launch') sh.poseT = 0; sh.pose = 'launch'; sh.face = Math.PI * 0.5 * (i === 0 ? 1 : -1) + Math.PI; }
            } else if ((cyc.state === 'clear' || cyc.state === 'idle') && cyc.crew) {
                for (const m of cyc.crew) if (m) C.release(m);
                cyc.crew = null; cyc.greensOff = false;
            }
        }
        // the LSOs signal while someone's on the ball
        const onBall = this.jets.some(j => j.state === 'final') || (this.lso.player && this.lso.player.state === 'final');
        for (const m of C.members) if (m.role === 'lso' && !m.job) m.pose = onBall && m === C.members[0] ? 'wave' : 'lso';
    }

    // ═════════════ The player's own launches and landings ═════════════
    // On a catapult spot the player gets the deck around him: the JBD up, a shooter, the stroke with the shuttle and
    // steam when he goes to full power (aircraft.js startCatapult); on approach the LSO talks to him.
    playerDeck(dt) {
        const g = this.game, p = g.player;
        if (!p || !p.alive || g.pilotMode) return;
        if (p.onGround && p.deck === this.ship && p._dl) {
            for (let i = 0; i < this.cats.length; i++) {
                const cyc = this.cats[i], s = this.catSpot(i);
                const on = Math.hypot(p._dl.lx - s[0], p._dl.lz - s[1]) < 4 && Math.abs(wrapPi(p.deckHeading || 0)) < 0.3;
                if (cyc.player && cyc.jet !== p) cyc.player = false;
                if (on && cyc.free && p.relSpeed < 1 && !p.catapult) { cyc.assign(p); cyc.player = true; cyc.update(0, { atSpot: true }); }
                if (cyc.player) {
                    cyc.pX0 = cyc.pX0 ?? p._dl.lz;
                    if (p.catapult > 0 && cyc.state !== 'stroke' && cyc.state !== 'clear') { cyc.set('stroke'); cyc.steam = 1; this.radio(null, 'launch'); }
                    if (cyc.state === 'salute') cyc.t = 0; // (the player launches when he goes to full power: wait for him)
                }
            }
        }
        // the LSO on the player's approach: the ball call, then the calls
        const st = this.lso;
        const along = !p.onGround && p.gear ? this.onFinal(p) : Infinity;
        if (along < 1500 && along > 80) {
            if (!st.player) { st.player = { state: 'final', called: false, t: 0 }; }
            const P = st.player;
            P.t += dt;
            const touch = this.touchPoint(_v2);
            const glide = touch.y + along * Math.tan(GLIDE) + p.gearOffset;
            const h = p.pos.y - glide;
            if (!P.called && along < 1350) { P.called = true; this.say('PADDLES', 'ROGER BALL' + (p.hook ? '' : ' — HOOK UP, HOOK UP!'), { say: 'Roger ball.' }); }
            else if (P.called && P.t > 3 && this.t - (st.lastCall || -9) > 3.5) {
                const call = !p.hook ? 'HOOK DOWN!' : h > 18 ? "YOU'RE HIGH" : h < -12 ? 'POWER — YOU\'RE LOW' : null;
                if (call) { st.lastCall = this.t; this.say('PADDLES', call, { say: call.toLowerCase().replace('—', ',') }); }
            }
        } else if (st.player && (p.onGround || along > 2500)) {
            if (p.onGround && p.deck === this.ship && !st.player.done) {
                st.player.done = true;
                if (!p.trap && p.relSpeed > 30) this.say('PADDLES', 'BOLTER, BOLTER, BOLTER', { say: 'Bolter, bolter, bolter.' });
            }
            if (!p.onGround || p.relSpeed < 2) st.player = null;
        }
    }

    // ═════════════ Radio (the tower, paddles and the pilots) ═════════════
    say(from, text, o = {}) {
        const g = this.game, p = g.player;
        // (only when the player is near the carrier or on it: the rest of the world doesn't hear the deck)
        if (!p || p.pos.distanceTo(this.ship.pos) > 12000) return;
        if (this.ops && this.ops.say) this.ops.say(from, text, { color: '#9fd4ff', say: o.say ?? false, voice: o.voice, ttl: 12 });
    }
    radio(dp, what) {
        const ac = dp && dp.ac, cs = ac ? (ac.callsign || 'HORNET') : '';
        if (this.team !== (this.game.war ? this.game.war.side : 'blue')) return;
        const fuel = (rand(4.2, 6.8)).toFixed(1);
        switch (what) {
            case 'marshal': return this.say(cs, 'MARSHAL, ' + cs + ', RTB FOR RECOVERY, ANGELS 5');
            case 'initial': return this.say('TOWER', cs + ', CHARLIE — YOU\'RE NUMBER ONE');
            case 'ball': return this.say(cs, (ac.spec.name.split(' ')[0].toUpperCase().replace(/[^A-Z]/g, '') || 'HORNET') + ' BALL, ' + fuel), this.say('PADDLES', 'ROGER BALL');
            case 'bolter': return this.say('PADDLES', 'BOLTER, BOLTER, BOLTER');
            case 'waveoff': return this.say('PADDLES', 'WAVE OFF, WAVE OFF');
            case 'trap': return this.say('TOWER', cs + ' — ' + ['1', '2', '3', '3', '4'][Math.floor(rand(0, 5))] + '-WIRE');
            case 'launch': return this.say('TOWER', dp ? cs + ' AIRBORNE' : 'SHOOTER — LAUNCH');
        }
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.ok || this.ship.gone) return;
        this.t += dt;
        const ship = this.ship, g = this.game;
        const camD = g.camera.position.distanceTo(ship.pos);
        const near = ship.mesh.visible && camD < 2500;
        this.ensureCrew();
        this.playerDeck(dt);
        if (this.opts.launches !== false) this.processQueue();
        // catapult cycles, JBDs and shuttles
        for (const cyc of this.cats) {
            const dp = this.jets.find(j => j.cat === cyc);
            const io = {};
            if (cyc.player) {
                const p = g.player;
                io.atSpot = true;
                io.gone = !p || !p.alive || !p.onGround || p.deck !== ship;
                if (p && p._dl && cyc.pX0 != null) io.progress = (cyc.pX0 - p._dl.lz) / this.shuttleTravel(cyc.index);
                if (cyc.state === 'tension' || cyc.state === 'hookup') io.gone = false;
                if (!p || !p.alive) io.abort = true;
                else if (p._dl && Math.hypot(p._dl.lx - this.catSpot(cyc.index)[0], p._dl.lz - this.catSpot(cyc.index)[1]) > 6 && cyc.state !== 'stroke' && cyc.state !== 'clear') io.abort = true;
            } else if (dp) {
                io.atSpot = dp.state === 'spot';
                io.gone = dp.state === 'climb' || !dp.ac.onGround && dp.state !== 'taxi';
                io.progress = (dp.progress || 0) / this.shuttleTravel(cyc.index);
                if (!dp.ac.alive) io.abort = true;
            } else if (cyc.state !== 'idle' && cyc.state !== 'clear') io.abort = true;
            const ev = cyc.update(dt, io);
            if (ev === 'idle') { cyc.player = false; cyc.pX0 = null; }
            if (ev === 'clear' && dp && dp.state === 'climb') this.radio(dp, 'launch');
            if (ev === 'stroke' && near) this.catSound(cyc);
            this.poseCat(cyc);
            if (cyc.steam > 0.02 && near) this.steam(cyc, dt);
        }
        // the elevator
        this.updateElevator(dt);
        for (const dp of this.jets) if (dp.waitElevator && !this.elev.busy) { const f = dp.waitElevator; dp.waitElevator = null; f(); }
        // a jet that's been up a while (or is out of missiles, or hurt) comes home
        if (this.opts.launches !== false) for (const c of [...this.cap]) {
            const ac = c.ac;
            if (!ac.alive) { this.cap.splice(this.cap.indexOf(c), 1); continue; }
            if (this.t > c.until || ac.health < ac.maxHealth * 0.45 || ((ac.missiles || 0) + (ac.lrm || 0) === 0 && ac.spec.missiles > 0)) this.recover(ac);
        }
        // crews (only drawn and animated near the camera)
        if (this.crew) {
            this.crew.setVisible(near);
            if (near) {
                this.crewJobs(dt);
                const busyLA = this.recovering();
                this.crew.update(dt, busyLA ? (x, z) => this.inLandingArea(x, z) : null);
            }
        }
        // (a finished jet whose director went missing: nothing to do; the DeckPilots run from game.update)
        for (const dp of this.jets) if (!dp.ac.alive && dp.state !== 'gone') { dp.state = 'gone'; this.releaseCrew(dp); if (dp.cat && dp.cat.jet === dp.ac) dp.cat.update(0, { abort: true }); }
        this.jets = this.jets.filter(j => j.state !== 'gone');
    }

    shuttleTravel(i) { const n = this.ship.rig.nodes['shuttle_' + (i + 1)]; return n && n.spec.travel ? n.spec.travel : 90; }

    poseCat(cyc) {
        const s = this.ship, i = cyc.index;
        const kJ = cyc.jbd * cyc.jbd * (3 - 2 * cyc.jbd), kS = cyc.shuttle;
        if (cyc.poseJ !== kJ) { cyc.poseJ = kJ; poseRig(s, 'jbd_' + (i + 1), kJ); }
        if (cyc.poseS !== kS) { cyc.poseS = kS; poseRig(s, 'shuttle_' + (i + 1), kS); }
    }

    // steam off the catapult track: a cloud racing down behind the shuttle, then wisps from the slot
    steam(cyc, dt) {
        const fx = this.game.effects, s = this.ship;
        if (!fx) return;
        const cat = s.layout.cats[cyc.index], spot = this.catSpot(cyc.index);
        const zs = spot[1] - 5.5, travel = this.shuttleTravel(cyc.index);
        cyc.steamAcc = (cyc.steamAcc || 0) + dt * (cyc.state === 'stroke' ? 60 : 14) * cyc.steam;
        while (cyc.steamAcc > 1) {
            cyc.steamAcc -= 1;
            const z = cyc.state === 'stroke' ? zs - cyc.shuttle * travel * Math.random() : lerp(zs, zs - travel, Math.random());
            s.toWorld(cat[0] + rand(-0.4, 0.4), this.geo.deckY + 0.3, z, _v);
            const up = cyc.state === 'stroke' ? rand(3, 7) : rand(1.5, 3.5);
            fx.smoke.emit(_v, _v2.set(s.vel.x * 0.5 + rand(-1, 1), up, s.vel.z * 0.5 + rand(-1, 1)), rand(1.4, 3), rand(1, 2), rand(4, 8), [0.96, 0.97, 0.98], [0.9, 0.92, 0.94], 0.45 * cyc.steam + 0.1, 0, 1.2, 0.8);
        }
    }
    catSound(cyc) {
        const s = this.catSpot(cyc.index), g = this.game, p = this.ship.toWorld(s[0], this.geo.deckY, s[1], _v);
        const d = g.camera.position.distanceTo(p);
        if (d < 1500 && g.audio && g.audio.whoosh) g.audio.whoosh(clamp(0.9 - d / 1500, 0.1, 0.9));
    }

    // the port-aft elevator: down to the hangar deck and back up, a jet riding it (the physics puts a jet at flight-
    // deck level: postPhysics lowers it with the platform)
    updateElevator(dt) {
        const E = this.elev;
        if (!this.ship.rig.elevators[E.i]) return;
        const target = E.want;
        if (E.k !== target) {
            E.k = target > E.k ? Math.min(target, E.k + dt / 7) : Math.max(target, E.k - dt / 7);
            setElevator(this.ship, E.i, E.k * E.k * (3 - 2 * E.k));
            if (E.k === target && E.then) { const f = E.then; E.then = null; f(); }
        } else if (E.then) { const f = E.then; E.then = null; f(); }
    }
    postPhysics() {
        const E = this.elev;
        if (!E.jet || !E.jet.ac.alive) return;
        const drop = (this.ship.rig.elevators[E.i].spec.travel || -8.2) * (E.k * E.k * (3 - 2 * E.k));
        E.jet.ac.pos.y += drop;
    }

    dispose() {
        if (this.crew) this.crew.dispose();
        for (const im of this.parked) { im.removeFromParent(); const i = this.ship.details.indexOf(im); if (i >= 0) this.ship.details.splice(i, 1); }
        this.parked.length = 0;
        for (const dp of this.jets) if (dp.ac.alive && dp.combat) dp.ac.pilot = dp.combat;
        this.jets.length = 0;
    }
}

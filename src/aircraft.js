// ═══════════════════════════════════════════════════════════════
// Aircraft entity + flight model
//
// Flight model works in the "wind frame" (qv): -Z along the velocity vector,
// +Y along the lift direction. The body is the wind frame rotated by angle of
// attack (alpha) and sideslip (beta). Stick pitch commands load factor (G), like
// a fly-by-wire fighter; lift = q·Cl(alpha), drag = q·(Cd0 + K·Cl²).
// That gives real energy bleed in turns, stalls at low speed, and thinner air
// at altitude, while staying stable and fun.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { AIRCRAFT } from './config.js';
import { createAircraftModel } from './models.js';
import { clamp, damp, lerp, rand, G, DEG, makeRadialTexture } from './util.js';
import { groundHeight, terrainHeight, isOnRunway } from './world.js';
import { createEngineFlame } from './afterburner.js';
import { surfaceTravel } from './surfaces.js';

const LIFT_K = 0.0016;
const CL_MAX = 1.65;
const K_INDUCED = 0.13;
const POST_STALL = 0.35; // deepest post-stall AoA, as a fraction past max AoA (types without an AoA limiter)

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _acc = new THREE.Vector3(), _vOld = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);

const navTex = makeRadialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]);

// ── Thrust, drag and compressibility ──
// Drag (per unit mass): q·(cd0·(1 + W·waveShape(M)) + K·Cl²/lift), q = liftK·V²·ρ.
// Thrust: accel · lapse(ρ) · ram(M) · throttle curve.
// Each type is calibrated at two points from config.js — the level top speed at sea level (`speed`)
// and at 11 km (`mach`) — by solving for the wave-drag strength W and the ram-thrust gain k (the
// subsonic drag cd0 is given, so handling at combat speeds stays as tuned). Subsonic types derive
// cd0 from the sea-level point and W from the 11 km "wall" instead.
export const soundSpeed = (h) => 340 - Math.max(h, 0) * 0.004;
export const airDensity = (h) => Math.exp(-Math.max(h, 0) / 9000);
const CAL_ALT = 11000;
const MIL_RAM = 0.4; // share of the ram-thrust gain available without afterburner
// wave-drag shape: 0 below the critical Mach, 1 at the peak (~M1.1), decaying when supersonic
export function waveShape(M, mmax) {
    if (mmax < 1) { const mc = mmax - 0.04; return M > mc ? 60 * (M - mc) * (M - mc) : 0; } // subsonic types hit a wall
    if (M < 0.85) return 0;
    if (M < 1.1) { const t = (M - 0.85) / 0.25; return t * t * (3 - 2 * t); }
    return 1 / (1 + 1.6 * (M - 1.1));
}
// jet engines lose thrust roughly as ρ^0.75 (ram recovery wins some back at speed); civil and prop types
// keep a gentler curve (they cruise high on a much smaller thrust margin)
const isJet = (spec) => !(spec.category === 'civil' || spec.prop);
export const thrustLapse = (rho, spec) => (isJet(spec) ? Math.pow(rho, 0.75) : 0.45 + 0.55 * rho);
const ramX = (M) => clamp(M - 0.9, 0, 2);

const calCache = {};
// Solve the two-point calibration for a type: { cd0, waveK, ramK }
export function flightCalibration(typeId, spec = AIRCRAFT[typeId]) {
    if (calCache[typeId]) return calCache[typeId];
    const f = spec.flight, liftK = LIFT_K * f.lift, mmax = f.mach ?? 1.8;
    const point = (h, M) => {
        const V = M * soundSpeed(h), rho = airDensity(h), q = liftK * V * V * rho, Cl = G / q;
        return { T: f.accel * thrustLapse(rho, spec) / q, ind: K_INDUCED * Cl * Cl / f.lift, s: waveShape(M, mmax), x: ramX(M) };
    };
    const p1 = point(0, f.speed / soundSpeed(0)), p2 = point(CAL_ALT, mmax);
    let cd0 = f.cd0, W = 0, k = 0;
    if (mmax < 1 || cd0 == null || !isJet(spec) || f.afterburner === false) {
        // subsonic: the sea-level point sits (nearly) below the drag wall → cd0; the 11 km Mach sets the wall
        const given = cd0;
        for (let i = 0; i < 8; i++) {
            if (given == null) cd0 = (p1.T - p1.ind) / (1 + W * p1.s);
            W = Math.max(0, ((p2.T - p2.ind) / cd0 - 1) / Math.max(p2.s, 1e-3));
        }
    } else {
        // T·(1 + k·x) = cd0·(1 + W·s) + ind at both points: linear in (k, W)
        const a11 = p1.T * p1.x, a12 = -cd0 * p1.s, b1 = cd0 + p1.ind - p1.T;
        const a21 = p2.T * p2.x, a22 = -cd0 * p2.s, b2 = cd0 + p2.ind - p2.T;
        const det = a11 * a22 - a12 * a21;
        k = (b1 * a22 - a12 * b2) / det;
        W = (a11 * b2 - a21 * b1) / det;
        // out of range (shouldn't happen with sane targets): keep one term at 0 and fit the other to 11 km
        if (!(k >= 0)) { k = 0; W = ((p2.T - p2.ind) / cd0 - 1) / Math.max(p2.s, 1e-3); }
        if (!(W >= 0)) { W = 0; k = Math.max(0, ((cd0 + p2.ind) / p2.T - 1) / Math.max(p2.x, 1e-3)); }
    }
    return (calCache[typeId] = { cd0, waveK: Math.max(0, W), ramK: k });
}
export function maxMach(typeId) { return AIRCRAFT[typeId]?.flight.mach ?? 1.8; }

// Handy reference speeds (m/s): stall with a flap setting, takeoff and approach
export function refSpeeds(spec) {
    const liftK = LIFT_K * spec.flight.lift;
    const vs = (flaps) => Math.sqrt(G / (liftK * CL_MAX * (1 + 0.2 * flaps)));
    return { stall: vs(0), takeoff: vs(1) * 1.12, approach: vs(2) * 1.3, flapLimit: 175 };
}

// A surface actuator: runs at `rate` (full travels per second) and eases into the end of its travel over the
// last ~8% (a hydraulic ram slowing as it seats), so nothing snaps or crawls
function actuate(x, target, rate, dt) {
    const d = target - x;
    if (d === 0) return x;
    const step = rate * dt * clamp(Math.abs(d) / 0.08, 0.2, 1);
    return Math.abs(d) <= step ? target : x + Math.sign(d) * step;
}

let nextId = 1;
const GEAR_MATS = {
    strutMat: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.7, roughness: 0.35 }),
    tyreMat: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
    hubMat: new THREE.MeshStandardMaterial({ color: 0x777b80, metalness: 0.6, roughness: 0.4 }),
};
for (const m of Object.values(GEAR_MATS)) m.userData.noPaint = true;

export class Aircraft {
    constructor(game, typeId, { team = 'blue', isPlayer = false, name = null } = {}) {
        this.id = nextId++;
        this.game = game;
        this.type = typeId;
        this.spec = AIRCRAFT[typeId];
        this.team = team;
        this.isPlayer = isPlayer;
        this.callsign = name || this.spec.name;

        const { object, rig } = createAircraftModel(typeId);
        this.model = object;
        this.rig = rig;
        // procedural models (types without a .glb: F-22, F/A-18, A-10, Su-35, MiG-31, Gripen, ...) have no
        // measured half span; weapons.js hangs missiles off it, so without this their launch position was NaN
        if (!(rig.halfSpan > 0)) rig.halfSpan = this.spec.span / 2;
        this.root = new THREE.Group();
        this.root.add(object);
        game.scene.add(this.root);

        const f = this.spec.flight;
        this.liftK = LIFT_K * f.lift;
        this.alphaMax = f.alpha * DEG;
        this.clSlope = CL_MAX / this.alphaMax;
        // short-period response: time constant for AoA (so G) to follow the stick — nimble types are quick,
        // heavies slow — and the fastest the nose may slew relative to the flight path (rad/s at ~120 m/s+)
        this.pitchTau = f.pitchTau ?? clamp(0.3 / f.roll, 0.07, 0.35);
        this.alphaRate = f.alphaRate ?? clamp(0.3 * f.roll, 0.6, 1.4);
        this.rollResp = clamp(f.roll * 2.2, 3, 10); // 1/s: how quickly roll rate follows the stick
        const cal = flightCalibration(typeId, this.spec);
        this.cd0 = cal.cd0;
        this.waveK = cal.waveK;
        this.ramK = cal.ramK;
        this.mmax = maxMach(typeId);
        this.thrustAB = f.accel;
        // no afterburner on civil, propeller and non-reheat jets (A-10, B-2): 90% throttle is nearly full power
        this.hasAB = isJet(this.spec) && f.afterburner !== false;
        this.thrustMil = f.accel * (this.hasAB ? 0.62 : 0.92);
        this.hitRadius = clamp(this.spec.length * 0.55, 7, 22);
        this.gearOffset = -(rig.minY ?? -this.spec.length * 0.08) + 1.2;
        if (!rig.minY) this.gearOffset = this.spec.length * 0.09 + 1.2;
        this.fixedGear = !!rig.fixedGear;
        if (this.fixedGear) this.gearOffset = -rig.minY + 0.05; // sits on the model's own wheels

        // state
        this.pos = this.root.position;
        this.vel = new THREE.Vector3(0, 0, -f.speed * 0.55);
        this.qv = new THREE.Quaternion();   // wind frame
        this.quat = this.root.quaternion;    // body
        this.alpha = 0; this.beta = 0;
        this.rollRate = 0;
        this.throttle = 0.75;
        this.airbrake = false;
        this.gear = false;
        this.gearAnim = 0;
        this.flaps = 0; this.flapAnim = 0; this.brakeAnim = 0;
        this.fuel = 1;
        this.flameout = false;
        this.fuelTime = this.spec.fuelTime || (this.spec.category === 'civil' ? 3000 : this.spec.category === 'bomber' ? 3600 : 1500);
        this.onGround = false;
        this.deck = null; this.deckHeading = 0; this.relSpeed = 0; this.trap = false; this.catapult = 0;
        this.gLoad = 1;
        this.stalling = false;
        this.stallExcess = 0; this.stallDepth = 0; this.stallDir = 1; // post-stall state (see updateFlight)
        this.pullAvail = 1; this.pitchAuthority = 1; this.nAvail = 9; this.nNeutral = 1;
        this.speed = this.vel.length();
        this.mach = 0;

        this.health = this.spec.health;
        this.maxHealth = this.spec.health;
        this.ammo = this.spec.gun ? this.spec.gun.ammo : 0;
        this.missiles = this.spec.missiles;
        this.flares = this.spec.flares;
        this.alive = true;
        this.falling = false;
        this.fallTimer = 0;
        this.lastGun = 0; this.lastMissile = -10; this.lastFlare = -10;
        this.lastHitBy = null; this.lastHitTime = -10;
        this.controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0.75 };
        this.pilot = null; // AI
        this.incoming = []; // missiles tracking us
        this.smokeT = 0; this.trailT = 0;

        this.regions = {};
        for (const c of this.model.children) if (c.userData.region) this.regions[c.userData.region] = c;
        this.lostRegions = new Set();
        this.damagePoints = [];
        this.ejectT = -1;
        this.initFX();
    }

    initFX() {
        const rig = this.rig;
        // exhaust plume per nozzle (afterburner.js): military power → full afterburner with shock diamonds
        this.flames = rig.nozzles.map(n => { const f = createEngineFlame(rig.nozzleR); f.position.copy(n); this.model.add(f); return f; });
        // propellers (models.js makeProp): blades, blur disc, and a spin rate (rad/s) that follows the engine;
        // they start at running speed (a spawn in the air shouldn't spool up)
        this.propParts = (rig.props || []).map(p => ({
            p, blades: p.getObjectByName('propBlades'), disc: p.getObjectByName('propDisc'),
            gap: 2 * Math.PI / (p.userData.blades || 2), rate: this.propTarget(),
        }));
        // nav lights
        const mk = (color, pos, scale) => {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: navTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
            s.position.copy(pos);
            s.scale.setScalar(scale);
            this.model.add(s);
            return s;
        };
        const [lt, rt] = rig.wingtips;
        this.navL = mk(new THREE.Color(1.4, 0.05, 0.05), lt, 0.55);
        this.navR = mk(new THREE.Color(0.05, 1.4, 0.2), rt, 0.55);
        this.strobe = mk(new THREE.Color(1.5, 1.5, 1.5), new THREE.Vector3(0, rig.height ? rig.height * 0.35 : 2, this.spec.length * 0.42), 0.8);
        this.vortex = [null, null];
        this.contrails = [];
        this.wingVapor = 0;
        this.buildGear();
        this.buildSurfaces();
    }

    buildGear() {
        if (this.fixedGear) { this.gearLegs = []; this.gear = true; this.gearAnim = 1; return; }
        const L = this.spec.length;
        const H = this.gearOffset;
        const sc = clamp(L / 17, 0.8, 3.2);
        const bellyY = this.rig.minY != null ? this.rig.minY + 0.15 : -H + 1.35;
        const { strutMat, tyreMat, hubMat } = GEAR_MATS;
        const wheelR = 0.33 * sc;
        const strutLen = Math.max(0.4, bellyY - (-H + wheelR));
        this.gearLegs = [];
        const halfSpan = this.rig.halfSpan || this.spec.span / 2;
        const mainX = this.spec.category === 'civil' || this.spec.category === 'bomber' ? Math.min(halfSpan * 0.25, L * 0.09) : Math.max(1.0, L * 0.075);
        const legs = [
            { x: 0, z: -0.3 * L, axis: 'x', dir: -1, wheels: 1 },
            { x: -mainX, z: 0.04 * L, axis: 'z', dir: 1, wheels: this.spec.length > 30 ? 2 : 1 },
            { x: mainX, z: 0.04 * L, axis: 'z', dir: -1, wheels: this.spec.length > 30 ? 2 : 1 },
        ];
        for (const l of legs) {
            const pivot = new THREE.Group();
            pivot.position.set(l.x, bellyY, l.z);
            const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * sc, 0.09 * sc, strutLen, 8), strutMat);
            strut.position.y = -strutLen / 2;
            pivot.add(strut);
            for (let w = 0; w < l.wheels; w++) {
                const wheel = new THREE.Group();
                const tyre = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, 0.22 * sc, 16), tyreMat);
                tyre.rotation.z = Math.PI / 2;
                const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, 0.24 * sc, 10), hubMat);
                hub.rotation.z = Math.PI / 2;
                wheel.add(tyre, hub);
                wheel.position.set(l.wheels > 1 ? (w ? 0.2 : -0.2) * sc : 0, -strutLen, l.wheels > 1 ? (w ? 0.5 : -0.5) * sc : 0);
                pivot.add(wheel);
            }
            pivot.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
            pivot.userData = l;
            this.model.add(pivot);
            this.gearLegs.push(pivot);
        }
        this.updateGearVisual();
        // tailhook: an arm under the tail that swings down for carrier traps (H)
        if (this.spec.category === 'fighter') {
            const hook = new THREE.Group();
            hook.position.set(0, bellyY + 0.15, L * 0.34);
            const len = clamp(L * 0.17, 2, 5);
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16 * sc, 0.16 * sc, len), strutMat);
            arm.position.z = len / 2;
            const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3 * sc, 0.34 * sc, 0.42 * sc), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5, metalness: 0.3 }));
            tip.position.set(0, -0.1 * sc, len);
            hook.add(arm, tip);
            hook.traverse(o => { if (o.isMesh) o.castShadow = true; });
            this.model.add(hook);
            this.hookMesh = hook;
            this.hookTip = tip;
            // lowered far enough to drag on the deck, never through it
            this.hookDown = 0.62;
            this.hookLen = len;
        }
        this.hook = false;
        this.hookAnim = 0;
        this.updateHookVisual();
    }

    // Hook engages an arresting wire: remember where, so the cable can be drawn to the hook
    catchWire() {
        if (this.trap || !this.deck) return;
        this.trap = true;
        this.caughtWire = true;
        const tip = this.hookPoint(_v1);
        const { lz } = this.deck.toLocal(tip.x, tip.z);
        const B = this.deck.def.B;
        this.wire = { ship: this.deck, lz, x0: -4 - B * 0.36, x1: -4 + B * 0.36, fade: 1.5 };
        if (!this.wireMeshes) {
            const mat = new THREE.MeshStandardMaterial({ color: 0xb8b4a4, roughness: 0.35, metalness: 0.7 });
            this.wireMeshes = [0, 1].map(() => {
                const m = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 6), mat);
                m.geometry.translate(0, 0.5, 0);
                return m;
            });
        }
        this.wireMeshes.forEach(m => this.game.scene.add(m));
        if (this.isPlayer) this.game.audio.tick(160, 0.35, 0.4);
    }

    updateWire(dt) {
        const w = this.wire;
        if (!this.trap) w.fade -= dt;
        if (w.fade <= 0 || !w.ship.alive || !this.alive) {
            this.wireMeshes.forEach(m => this.game.scene.remove(m));
            this.wire = null;
            return;
        }
        const tip = this.hookPoint(_v1);
        const deckY = w.ship.deckY + 0.45;
        [w.x0, w.x1].forEach((x, i) => {
            const a = w.ship.toWorld(x, deckY, w.lz);
            const m = this.wireMeshes[i];
            m.position.copy(a);
            const d = _v2.subVectors(tip, a);
            m.scale.set(1, d.length(), 1);
            m.quaternion.setFromUnitVectors(_v3.set(0, 1, 0), d.normalize());
        });
    }

    updateHookVisual() {
        if (!this.hookMesh) return;
        // stowed flat along the belly, lowered ~38°
        this.hookMesh.rotation.x = 0.04 + this.hookAnim * (this.hookDown - 0.04);
    }

    // on the deck/runway the hook rides on the surface instead of sinking into it
    settleHook() {
        if (!this.hookMesh || this.hookAnim <= 0) return;
        this.root.updateMatrixWorld(true);
        const tip = this.hookPoint(_v1);
        const floor = (this.deck ? this.deck.deckY : this.game.surfaceAt(tip.x, tip.z, tip.y + 3).h) + 0.25;
        // swing toward the surface (gently, so it settles instead of oscillating)
        const want = 0.04 + this.hookAnim * (this.hookDown - 0.04);
        const r = clamp(this.hookMesh.rotation.x + (tip.y - floor) / this.hookLen * 0.5, 0.04, want);
        if (Math.abs(r - this.hookMesh.rotation.x) > 1e-4) { this.hookMesh.rotation.x = r; this.hookMesh.updateMatrixWorld(true); }
    }

    // world position of the hook point
    hookPoint(out) {
        if (!this.hookTip) return out.copy(this.pos);
        return this.hookTip.getWorldPosition(out);
    }

    // Flaps and speed brakes: cut from the model's own skin (surfaces.js, surfacedefs.js), so stowed they are
    // just part of the wing or fuselage. Each moves like a hydraulic / electric actuator: at a steady rate,
    // settling gently at the end of its travel.
    buildSurfaces() {
        const t = surfaceTravel(this.type, this.spec);
        this.flapRate = 1 / t.flap; this.brakeRate = 1 / t.brake;
        this.surfaces = [];
        this.model.traverse(o => {
            const s = o.userData.surface;
            if (!s) return;
            this.surfaces.push({
                pivot: o, kind: s.kind, axis: new THREE.Vector3().fromArray(s.axis), angle: s.angle * DEG,
                slide: s.slide ? new THREE.Vector3().fromArray(s.slide) : null, base: o.position.clone(), k: -1,
            });
        });
    }

    updateSurfaces(dt) {
        this.flapAnim = actuate(this.flapAnim, this.flaps / 2, this.flapRate, dt);
        this.brakeAnim = actuate(this.brakeAnim, this.alive && this.airbrake ? 1 : 0, this.brakeRate, dt);
        for (const s of this.surfaces) {
            const k = s.kind === 'flap' ? this.flapAnim : this.brakeAnim;
            if (k === s.k) continue;
            s.k = k;
            s.pivot.quaternion.setFromAxisAngle(s.axis, s.angle * k);
            s.pivot.position.copy(s.base);
            if (s.slide) s.pivot.position.addScaledVector(s.slide, k);
        }
    }

    updateGearVisual() {
        const k = this.gearAnim; // 1 = down
        const e = 1 - (1 - k) * (1 - k);
        for (const p of this.gearLegs) {
            const l = p.userData;
            p.visible = k > 0.03;
            const ang = (1 - e) * Math.PI * 0.5;
            if (l.axis === 'x') p.rotation.set(ang * l.dir, 0, 0);
            else p.rotation.set(0, 0, ang * l.dir);
        }
    }

    get forward() { return _v1.set(0, 0, -1).applyQuaternion(this.quat); }
    getForward(out) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
    getUp(out) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
    getRight(out) { return out.set(1, 0, 0).applyQuaternion(this.quat); }

    // Place the aircraft in flight with a heading (radians, 0 = -Z) and speed
    spawnAir(pos, heading, speedFrac = 0.6) {
        this.pos.copy(pos);
        this.qv.setFromAxisAngle(AY, heading);
        this.vel.set(0, 0, -1).applyQuaternion(this.qv).multiplyScalar(this.spec.flight.speed * speedFrac);
        this.speed = this.vel.length();
        this.alpha = 0.03;
        this.throttle = this.controls.throttle = 0.8;
        this.gear = false; this.gearAnim = 0; this.onGround = false; this.deck = null; this.flaps = 0; this.flapAnim = 0; this.brakeAnim = 0;
        this.syncBody();
    }

    // Park on a carrier catapult (ship from naval.js)
    spawnDeck(ship) {
        const spot = ship.catapultSpot();
        this.qv.setFromAxisAngle(AY, ship.heading);
        this.pos.copy(spot).setY(ship.deckY + this.gearOffset);
        this.deck = ship; this._dl = null; this.deckHeading = 0; this.relSpeed = 0;
        this.vel.copy(ship.vel);
        this.speed = 0; this.alpha = 0;
        this.throttle = this.controls.throttle = 0;
        this.gear = true; this.gearAnim = 1; this.onGround = true; this.flaps = 1; this.flapAnim = 0.5; this.brakeAnim = 0;
        this.syncBody();
    }

    spawnRunway(base) {
        const L = 3000;
        const h = base.heading;
        this.qv.setFromAxisAngle(AY, -h);
        const fwd = _v1.set(0, 0, -1).applyQuaternion(this.qv);
        this.pos.set(base.x, base.h + this.gearOffset, base.z).addScaledVector(fwd, -L * 0.42);
        this.vel.set(0, 0, 0);
        this.speed = 0;
        this.alpha = 0;
        this.throttle = this.controls.throttle = 0;
        this.gear = true; this.gearAnim = 1; this.onGround = true; this.deck = null; this.relSpeed = 0; this.flaps = 1; this.flapAnim = 0.5; this.brakeAnim = 0;
        this.syncBody();
    }

    // Engine thrust (m/s²) for the current throttle at this air density and Mach, including fuel starvation
    thrustFor(rho, mach = 0) {
        if (this.flameout && this.game.settings?.fuel === false && !this.bellied && !this.forcedFlameout) { this.flameout = false; this.fuel = Math.max(this.fuel, 0.05); }
        if (this.flameout || this.bellied) return 0;
        const t = this.throttle, r = this.ramK * ramX(mach);
        const mil = this.thrustMil * (1 + MIL_RAM * r), ab = this.thrustAB * (1 + r);
        return (t <= 0.9 ? mil * (t / 0.9) : mil + (ab - mil) * ((t - 0.9) / 0.1)) * thrustLapse(rho, this.spec);
    }

    burnFuel(dt) {
        if (!this.isPlayer || this.game.settings?.fuel === false || this.flameout) return;
        const t = this.throttle;
        const rate = t <= 0.9 || !this.hasAB ? 0.12 + 0.88 * Math.min(t / 0.9, 1.1) : 1 + 3 * ((t - 0.9) / 0.1);
        this.fuel = Math.max(0, this.fuel - rate * dt / this.fuelTime);
        if (this.fuel <= 0 && !this.flameout) {
            this.flameout = true;
            this.game.events.emit('flameout', this);
        }
    }

    refuel(amount = 1) {
        this.fuel = Math.min(1, this.fuel + amount);
        if (this.fuel > 0.01) this.flameout = false;
    }

    get clEff() { return this.clSlope; }
    // flaps add camber: extra lift even at zero angle of attack (same max-lift gain as before: +20% of CLmax per notch)
    get flapCl() { return CL_MAX * 0.2 * this.flaps * clamp(this.flapAnim * 2 / Math.max(this.flaps, 1), 0, 1); }

    syncBody() {
        if (this.gearLegs && this._gearShown !== this.gearAnim) { this._gearShown = this.gearAnim; this.updateGearVisual(); }
        if (this._hookShown !== this.hookAnim) { this._hookShown = this.hookAnim; this.updateHookVisual(); }
        _q1.setFromAxisAngle(AX, this.alpha);
        _q2.setFromAxisAngle(AY, this.beta);
        this.quat.copy(this.qv).multiply(_q1).multiply(_q2);
    }

    // ── Flight model step ──
    updateFlight(dt) {
        const c = this.controls, f = this.spec.flight;
        const alt = this.pos.y;
        const rho = airDensity(alt);
        let V = this.vel.length();
        this.speed = V;
        this.mach = V / soundSpeed(alt);

        // Throttle target (0..1) with engine spool
        this.throttle = damp(this.throttle, clamp(c.throttle, 0, 1), this.throttle < c.throttle ? 1.6 : 2.5, dt);

        const vhat = _v1.copy(this.vel).divideScalar(Math.max(V, 0.01));
        const q = this.liftK * V * V * rho;
        const authority = clamp(V / 90, 0.12, 1) * (this.falling ? 0.2 : 1);

        if (this.onGround) return this.updateGround(dt, rho);

        // Roll about the velocity vector
        let rollTarget = c.roll * f.roll * authority;
        // missing wing: strong roll toward the damaged side, less lift
        const lostL = this.lostRegions.has('wingL'), lostR = this.lostRegions.has('wingR');
        if (lostL !== lostR) rollTarget += (lostL ? -1 : 1) * f.roll * 0.3 * clamp(V / 150, 0.2, 1);
        // stalled wing drops (one side lets go first)
        if (this.stallDepth > 0) rollTarget += this.stallDir * f.roll * 0.3 * this.stallDepth * clamp(V / 60, 0.3, 1);
        // roll rate builds briskly and stops harder than it starts, so the wings stop near where the stick is centred
        const rollLag = this.rollResp * (Math.abs(rollTarget) < Math.abs(this.rollRate) ? 2.5 : 1);
        // exact over the step for a first-order lag: the roll angle it sweeps is the same at any frame rate
        const r0 = this.rollRate, eR = Math.exp(-rollLag * dt);
        this.rollRate = rollTarget + (r0 - rollTarget) * eR;
        const rollStep = rollTarget * dt + (r0 - rollTarget) * (1 - eR) / rollLag;
        _q1.setFromAxisAngle(AZ, -rollStep);
        this.qv.multiply(_q1);

        // Lift direction & neutral G (so neutral stick holds the flight path)
        const liftDir = _v2.set(0, 1, 0).applyQuaternion(this.qv);
        const nNeutral = Math.max(0, liftDir.y) * (this.falling ? 0 : 1);
        const gLim = f.gLimit;
        let nCmd = c.pitch >= 0
            ? nNeutral + c.pitch * (gLim - nNeutral)
            : nNeutral + c.pitch * (nNeutral + 3);
        // share of the pull range actually usable at this speed (max-AoA lift vs the G limit). The player's stick
        // is scaled by it (game.js) so, slow, a little stick doesn't slam the nose to max AoA while full stick is
        // still max performance; AI and autopilot loops keep the raw mapping they're tuned for.
        const nAvail = q * (this.clEff * this.alphaMax + this.flapCl) / G;
        this.pitchAuthority = clamp((nAvail * 1.03 - nNeutral) / Math.max(gLim - nNeutral, 0.1), 0.1, 1);
        // the same without the floor: the most pull (raw stick mapping) that stays on the right side of the
        // stall — AI and autopilot cap their stick at this
        this.pullAvail = clamp((nAvail - nNeutral) / Math.max(gLim - nNeutral, 0.1), 0, 1);
        this.nAvail = nAvail; this.nNeutral = nNeutral;
        // flaps: extra lift makes the jet balloon up for a few seconds (like an untrimmed GeoFS jet)
        if (this._lastFlaps === undefined) this._lastFlaps = this.flaps;
        if (this.flaps !== this._lastFlaps) { this.balloon = (this.balloon || 0) + (this.flaps - this._lastFlaps) * 0.45; this._lastFlaps = this.flaps; }
        this.balloon = (this.balloon || 0) * Math.exp(-0.28 * dt);
        // spoilers: dump lift so the jet sinks while they're out
        nCmd += this.balloon * clamp(V / 90, 0, 1.2) - 0.75 * this.brakeAnim * clamp(V / 70, 0, 1);

        // AoA needed to produce the commanded G, limited by stall AoA
        const clS = this.clEff, cl0 = this.flapCl;
        let alphaCmd = ((nCmd * G) / Math.max(q, 1e-3) - cl0) / clS;
        const alphaLim = this.alphaMax;
        // stall warning: slow (near the 1-G stall speed at this density & flap setting), or at max AoA while slowish —
        // not an alpha-limited break turn at corner speed
        const vStall = Math.sqrt(G / (this.liftK * rho * CL_MAX * (1 + 0.2 * this.flaps)));
        // Post-stall: without an AoA limiter, pulling for more lift than the wing has lets the AoA creep past
        // the stall (slowly, so a brief over-pull only buffets). Lift then falls off, drag rises and a wing
        // drops; easing the stick (not pulling past the limit) brings the AoA straight back.
        const over = alphaCmd / alphaLim - 1.05; // how far past the stall the stick asks for
        const eTarget = !f.aoaLimiter && !this.falling && c.pitch > 0.02 && over > 0 ? POST_STALL * clamp(over / 0.4, 0, 1) : 0;
        this.stallExcess = eTarget > this.stallExcess ? Math.min(eTarget, this.stallExcess + 0.3 * dt) : Math.max(eTarget, this.stallExcess - 2 * dt);
        const alphaTop = alphaLim * (1 + this.stallExcess);
        this.stalling = !this.falling && (V < vStall * 1.1 || (alphaCmd > alphaLim * 0.98 && c.pitch > -0.2 && V < vStall * 1.6) || this.stallDepth > 0);
        alphaCmd = clamp(alphaCmd, -alphaLim * 0.55, alphaTop);
        // AoA follows the command through a first-order lag (smooth G onset, no overshoot or porpoising),
        // with the nose's slew rate relative to the flight path capped so it can't snap to max AoA
        const alphaRateMax = this.alphaRate * clamp(V / Math.min(120, f.speed * 0.6), 0.35, 1.2);
        const a0 = this.alpha;
        const dA = (alphaCmd - this.alpha) * (1 - Math.exp(-dt / this.pitchTau));
        this.alpha += clamp(dA, -alphaRateMax * dt, alphaRateMax * dt);
        this.alpha = clamp(this.alpha, -alphaLim * 0.6, alphaTop);
        // forces use the AoA/sideslip averaged over the step (not the end value), so the lift and G build up
        // along the same time line at 30 fps as at 120
        const aMid = (a0 + this.alpha) / 2;

        // Sideslip from rudder
        const betaCmd = c.yaw * 7 * DEG * authority;
        const b0 = this.beta;
        this.beta = damp(this.beta, betaCmd, 4, dt);
        const bMid = (b0 + this.beta) / 2;

        // lift curve: linear up to CL_MAX at max AoA, a short buffet plateau, then lift falls away
        let Cl;
        const aN = aMid / alphaLim;
        if (aN <= 1) { Cl = clS * aMid; this.stallDepth = 0; }
        else {
            const depth = clamp((aN - 1.05) / (POST_STALL - 0.05), 0, 1);
            if (depth > 0 && !(this.stallDepth > 0)) this.stallDir = Math.sign(this.rollRate + this.beta * 5) || (Math.random() < 0.5 ? -1 : 1);
            this.stallDepth = depth;
            Cl = CL_MAX * (1 - 0.35 * depth);
        }
        Cl += cl0;
        let lift = q * Cl * (1 - (this.lostRegions.has('wingL') ? 0.22 : 0) - (this.lostRegions.has('wingR') ? 0.22 : 0));
        const maxLift = gLim * G * 1.05;
        lift = clamp(lift, -maxLift * 0.45, maxLift);
        const side = -q * this.clSlope * 0.45 * bMid;

        let cd = this.cd0 * (1 + 3.5 * this.brakeAnim) + K_INDUCED * Cl * Cl / f.lift + 0.6 * bMid * bMid;
        if (this.gearAnim > 0.05) cd += this.cd0 * 0.8 * this.gearAnim;
        cd += 0.3 * this.stallDepth; // separated flow over a stalled wing
        cd += this.cd0 * 0.85 * this.flapAnim * 2;
        if (this.flaps && V > 175 && this.isPlayer) { this.flaps = 0; this.game.events.emit('flapsBlown', this); }
        // compressibility: transonic drag rise, easing off once supersonic
        cd += this.cd0 * this.waveK * waveShape(this.mach, this.mmax);
        // past the type's top Mach (thermal / structural limit) drag climbs steeply, so thinner air above
        // 11 km only buys a few percent more
        const overM = this.mach - this.mmax - 0.04;
        if (overM > 0 && this.mmax >= 1) cd += this.cd0 * 40 * overM * overM;
        const drag = q * cd;

        const thrustN = this.thrustFor(rho, this.mach);
        this.afterburner = this.hasAB && this.throttle > 0.905 && !this.flameout;
        this.burnFuel(dt);

        const rightW = _v3.set(1, 0, 0).applyQuaternion(this.qv);
        const bodyFwd = this.getForward(new THREE.Vector3());
        _acc.set(0, -G, 0)
            .addScaledVector(liftDir, lift)
            .addScaledVector(rightW, side)
            .addScaledVector(vhat, -drag)
            .addScaledVector(bodyFwd, this.falling ? thrustN * 0.2 : thrustN);
        // wind and weather turbulence (stronger low down and in storms)
        if (this.game.wind) _acc.addScaledVector(this.game.wind, 0.02);
        const wx = this.game.world && this.game.world.weather;
        if (wx === 'rain' || wx === 'storm') {
            const k = (wx === 'storm' ? 3.2 : 1.4) * clamp(1.4 - alt / 3000, 0.3, 1.4);
            const t = this.game.time * 1.7 + this.id;
            _acc.x += (Math.sin(t * 1.3) + Math.sin(t * 3.7)) * k * 0.5;
            _acc.y += (Math.sin(t * 2.1 + 1) + Math.sin(t * 5.3)) * k;
            _acc.z += Math.sin(t * 1.9 + 2) * k * 0.5;
        }

        // speed brake: extra parasitic drag plus a fixed bite so it works at any speed
        if (this.brakeAnim > 0.05) _acc.addScaledVector(vhat, -1.8 * this.brakeAnim);
        this.gLoad = lift / G + (this.gLoad - lift / G) * Math.exp(-10 * dt);

        const oldDir = _v2.copy(vhat);
        _vOld.copy(this.vel); // start-of-step velocity, for the position update
        this.vel.addScaledVector(_acc, dt);
        V = this.vel.length();
        if (V < 5) { this.vel.addScaledVector(bodyFwd, 5 - V); V = 5; }
        // cap absurd speeds
        const vcap = Math.max(f.speed * 1.6, this.mmax * 300 * 1.08);
        if (V > vcap) this.vel.multiplyScalar(vcap / V);
        const newDir = _v3.copy(this.vel).normalize();
        _q1.setFromUnitVectors(oldDir, newDir);
        this.qv.premultiply(_q1).normalize();

        // Stall departure: well below the stall speed (true airspeed at this density and flap setting) the nose falls through
        const vDep = vStall * 0.8;
        if (V < vDep && !this.falling) {
            const drop = (vDep - V) / vDep;
            const fwdW = _v2.set(0, 0, -1).applyQuaternion(this.qv);
            const axis = _v3.crossVectors(fwdW, AY);
            if (axis.lengthSq() > 1e-4) {
                axis.normalize();
                _q1.setFromAxisAngle(axis, -drop * 0.9 * dt);
                this.qv.premultiply(_q1);
                this.vel.applyQuaternion(_q1);
            }
        }

        // trapezoidal position step (average of the start and end velocity): turns trace the same arc at any frame rate
        this.pos.addScaledVector(_vOld.add(this.vel), dt * 0.5);
        this.syncBody();
        this.checkGround(dt);
    }

    updateGround(dt, rho) {
        const c = this.controls;
        const thrust = this.thrustFor(rho);
        this.afterburner = this.hasAB && this.throttle > 0.905 && !this.flameout;
        this.burnFuel(dt);
        const ship = this.deck;
        let V = this.relSpeed;
        // heading: on a deck it is relative to the ship so we turn with it
        let heading;
        if (ship) heading = ship.heading + this.deckHeading;
        else {
            const fwd = _v1.set(0, 0, -1).applyQuaternion(this.qv);
            heading = Math.atan2(-fwd.x, -fwd.z);
        }
        const steer = this.bellied ? 0 : (c.yaw * 0.6 - c.roll * 0.35) * clamp(1 - V / 120, 0.1, 1) * 0.6;
        if (ship) this.deckHeading += steer * dt; else heading += steer * dt;
        if (ship) heading = ship.heading + this.deckHeading;
        this.qv.setFromAxisAngle(AY, heading);
        this.rollRate = 0; this.beta = 0;

        this._lastFlaps = this.flaps; this.balloon = 0;
        const rotateSpeed = Math.sqrt(G / (this.liftK * rho * CL_MAX * (1 + 0.2 * this.flaps))) * 1.05;
        let pitchTarget = V > rotateSpeed * 0.85 && !this.bellied ? clamp(c.pitch, 0, 1) * 0.28 : 0;
        // with flaps out the nose comes up by itself once past rotation speed, and the jet flies off
        if (this.flaps > 0 && !this.bellied && !this.deck && V > rotateSpeed && c.pitch > -0.3) pitchTarget = Math.max(pitchTarget, 0.06 * this.flaps);
        this.alpha = damp(this.alpha, pitchTarget, 2.5, dt);
        const Cl = this.clEff * this.alpha + this.flapCl;
        // spoilers: airbrake on the ground dumps lift and brakes hard
        const lift = this.liftK * V * V * rho * Cl * (this.airbrake ? 0.3 : 1);
        let friction = (this.airbrake || this.wheelBrake ? 6 : 0.25) + (c.throttle < 0.05 && V < 30 ? 1.5 : 0);
        if (this.bellied) friction = this.bellyWater ? 10 : 8;
        const drag = this.liftK * V * V * rho * (this.cd0 * (1 + 3.5 * this.brakeAnim + 1.7 * this.flapAnim) + K_INDUCED * Cl * Cl);
        let acc = thrust - drag - (V > 0.1 ? friction : 0);
        // carrier catapult: a violent shove down the deck
        if (this.catapult > 0) {
            this.catapult -= dt;
            acc = Math.max(acc, 34);
            if (V > rotateSpeed * 1.2) this.catapult = 0;
        }
        // hook dropped late while rolling through the wires still catches one
        if (!this.trap && this.deck && this.hook && this.hookAnim > 0.8 && V > 15 && !this.catapult && this.deck.inWireZone(this.pos.x, this.pos.z)) {
            this.catchWire();
            this.game.events.emit('touchdown', this, { vs: 0, onRunway: false, onDeck: true, trap: true, late: true });
        }
        // arresting wire: stops a landing jet in ~100 m
        if (this.trap) {
            acc = Math.min(acc, -26);
            if (V < 2) { this.trap = false; V = 0; }
        }
        V = Math.max(0, V + acc * dt);
        this.relSpeed = V;
        this.speed = V;
        this.gLoad = 1;
        this.stalling = false; this.stallExcess = 0; this.stallDepth = 0;
        this.mach = V / 340;
        const dir = _v2.set(0, 0, -1).applyQuaternion(this.qv);
        this.vel.copy(dir).multiplyScalar(V);
        if (ship) {
            this.vel.add(ship.vel);
            // ride in the deck's frame so a turning carrier carries us round with it
            if (!this._dl || this._dl.ship !== ship) { const l = ship.toLocal(this.pos.x, this.pos.z); this._dl = { ship, lx: l.lx, lz: l.lz }; }
            const dh = this.deckHeading;
            this._dl.lx -= Math.sin(dh) * V * dt;
            this._dl.lz -= Math.cos(dh) * V * dt;
            const w = ship.toWorld(this._dl.lx, 0, this._dl.lz, _v3);
            this.pos.x = w.x; this.pos.z = w.z;
        } else {
            this._dl = null;
            this.pos.addScaledVector(this.vel, dt);
        }
        const surf = this.game.surfaceAt(this.pos.x, this.pos.z, this.pos.y - this.gearOffset + 3);
        if (ship && surf.ship !== ship) {
            // off the end (or edge) of the deck: flying if fast enough, otherwise dropping
            this.onGround = false; this.deck = null; this.catapult = 0; this.trap = false;
            if (this.bellied) { this.bellied = false; this.bellyWater = false; this.sinkDepth = 0; this.crash(true); return; }
            if (V > rotateSpeed) { this.vel.y += 2.5; this.pos.y += 0.5; this.alpha = Math.max(this.alpha, 0.12); }
            this.syncBody();
            return;
        }
        this.pos.y = surf.h + this.gearOffset;
        if (this.bellied) {
            this.pos.y = surf.h + this.bellyOffset + (this.bellyWater ? 0 : 0.2) - this.sinkDepth;
            this.updateBelly(dt, V);
            if (V > 5) { this.qv.multiply(_q1.setFromAxisAngle(AZ, (Math.random() - 0.5) * 0.02)); }
        } else if (lift > G * 1.02) {
            this.onGround = false;
            this.trap = false;
            this.deck = null;
            this.vel.y = 2.5;
            this.pos.y += 0.5;
            this.catapult = 0;
        }
        if (!ship) {
            // rolled off the runway at speed on rough ground?
            if (!surf.runway && !surf.bridge && V > (this.bellied ? 8 : 40) && surf.h > 1) {
                const e = 5;
                const dx = terrainHeight(this.pos.x + e, this.pos.z) - terrainHeight(this.pos.x - e, this.pos.z);
                const dz = terrainHeight(this.pos.x, this.pos.z + e) - terrainHeight(this.pos.x, this.pos.z - e);
                const slope = Math.hypot(dx, dz) / (2 * e);
                if (slope > (this.bellied ? 0.35 : 0.12)) this.crash();
            }
            if (surf.water && !this.bellied) this.crash(true);
        }
        this.syncBody();
    }

    startCatapult() {
        if (!this.onGround || !this.deck || this.bellied || this.relSpeed > 5 || this.catapult > 0) return false;
        this.catapult = 3;
        this.flaps = Math.max(this.flaps, 1);
        return true;
    }

    checkGround() {
        const bottom = this.pos.y - this.gearOffset;
        const surf = this.game.surfaceAt(this.pos.x, this.pos.z, bottom + 3);
        if (bottom > surf.h) return;
        if (!this.alive || this.falling) { this.explode(true, surf.water); return; }
        // landing?
        const shipVel = surf.ship ? surf.ship.vel : _v1.set(0, 0, 0);
        const rel = _v2.copy(this.vel).sub(shipVel);
        const vs = rel.y;
        const relSpeed = Math.hypot(rel.x, rel.z);
        const up = this.getUp(_v3);
        const upY = up.y;
        const fwd = this.getForward(_v3);
        const pitch = Math.asin(clamp(fwd.y, -1, 1));
        const flatEnough = surf.h > 0.5 && !surf.water && !surf.hull;
        const vsLimit = surf.ship ? -9.5 : -7;
        if (this.gearAnim > 0.9 && vs > vsLimit && upY > 0.94 && pitch > -0.08 && pitch < 0.35 && relSpeed < this.spec.flight.speed * 0.6 && (surf.runway || surf.ship || flatEnough)) {
            this.onGround = true;
            this.deck = surf.ship || null; this._dl = null;
            this.pos.y = surf.h + this.gearOffset;
            this.relSpeed = relSpeed;
            const heading = Math.atan2(-rel.x, -rel.z);
            this.qv.setFromAxisAngle(AY, heading);
            this.trap = false;
            if (this.deck) {
                this.deckHeading = heading - this.deck.heading;
                if (this.deck.inWireZone(this.pos.x, this.pos.z)) {
                    if (this.hook || !this.hookMesh) this.catchWire();
                    else if (this.isPlayer) this.game.addFeed('HOOK UP — NO WIRE! (H)', '#ff4a3d');
                }
            }
            this.vel.y = shipVel.y;
            this.alpha = Math.max(0, pitch);
            this.game.events.emit('touchdown', this, { vs, onRunway: !!surf.runway, onDeck: !!surf.ship, trap: this.trap });
            return;
        }
        // too hard / gear up / off-field — but still survivable? Then it's a belly landing (or ditching)
        const canBelly = !surf.hull && vs > -6.5 && upY > 0.8 && pitch > -0.15 && pitch < 0.4 && relSpeed < this.spec.flight.speed * 0.75;
        if (canBelly && this.isPlayer) { this.startBelly(surf, rel, relSpeed, vs); return; }
        this.crash(surf.water && !surf.hull);
    }

    startBelly(surf, rel, relSpeed, vs) {
        const collapsed = this.gearAnim > 0.5;
        const dmgPct = clamp((relSpeed - 45) * 0.45 + (-vs) * 5 + (surf.water ? 5 : 12), 8, 90);
        const dmg = dmgPct / 100 * this.maxHealth;
        if (this.health - dmg <= 0) { this.crash(surf.water); return; }
        this.health -= dmg;
        this.bellied = true;
        this.bellyWater = !!surf.water;
        this.bellyStopped = false;
        this.gear = false; this.gearAnim = 0; this.updateGearVisual();
        // rest on the lowest point of the airframe with the gear up (model origins vary a lot)
        const q0 = this.root.quaternion.clone();
        this.root.quaternion.identity(); // measure level, not at the touchdown pitch
        this.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(this.root);
        this.root.quaternion.copy(q0);
        this.root.updateMatrixWorld(true);
        this.bellyOffset = isFinite(box.min.y) ? clamp(this.root.position.y - box.min.y, 0.3, this.gearOffset) : this.gearOffset * 0.5;
        this.flaps = 0;
        this.onGround = true;
        this.deck = surf.ship || null; this._dl = null;
        this.relSpeed = relSpeed;
        const heading = Math.atan2(-rel.x, -rel.z);
        this.qv.setFromAxisAngle(AY, heading);
        if (this.deck) this.deckHeading = heading - this.deck.heading;
        this.alpha = 0; this.sinkDepth = 0;
        this.controls.throttle = 0;
        this.addDamagePoint(!surf.water);
        this.game.events.emit('bellyLanded', this, { water: !!surf.water, collapsed, dmg: dmgPct });
    }

    // Grinding along on the belly: sparks, dust or spray, then a stop (and a slow sink at sea)
    updateBelly(dt, V) {
        const fx = this.game.effects;
        const L = this.spec.length;
        if (V > 3 && Math.random() < 0.9) {
            const p = _v1.set(rand(-1, 1) * L * 0.08, -this.gearOffset + 1.2, rand(-0.3, 0.3) * L).applyMatrix4(this.root.matrixWorld);
            const back = _v2.copy(this.vel).multiplyScalar(-0.15);
            if (this.bellyWater) {
                for (let k = 0; k < 2; k++) fx.smoke.emit(p, _v3.set(rand(-8, 8), rand(6, 18), rand(-8, 8)).add(back), rand(0.8, 1.6), 2, 9, [0.92, 0.96, 1], [0.85, 0.9, 0.95], 0.7, 0, 1, -18);
            } else {
                for (let k = 0; k < 3; k++) fx.fire.emit(p, _v3.set(rand(-12, 12), rand(3, 14), rand(-12, 12)).add(back), rand(0.2, 0.5), 0.6, 0.15, [6, 4.5, 2], [3, 1, 0.2], 1, 0, 1, -20);
                fx.smoke.emit(p, _v3.set(rand(-3, 3), rand(2, 6), rand(-3, 3)), rand(1.5, 3), 3, 14, [0.45, 0.4, 0.33], [0.55, 0.5, 0.42], 0.55, 0, 1.2, 1);
            }
        }
        if (V < 1 && !this.bellyStopped) {
            this.bellyStopped = true;
            this.game.events.emit('bellyStopped', this, { water: this.bellyWater });
        }
        if (this.bellyWater && V < 3) this.sinkDepth = Math.min(this.gearOffset + 2.5, (this.sinkDepth || 0) + dt * 0.25);
    }

    get invincible() { return this.isPlayer && this.game.mode === 'sandbox'; }

    crash(water = false) {
        if (!this.alive && !this.falling) return;
        if (this.invincible && this.alive && !this.falling) { this.sandboxBounce(water); return; }
        if (water) this.game.effects.waterSplash(this.pos, 1.4);
        this.health = 0;
        this.explode(true, water);
    }

    // Sandbox: instead of crashing, bounce back up off the ground, levelled out and slowed
    sandboxBounce(water) {
        const g = this.game;
        if (water) g.effects.waterSplash(this.pos, 0.8);
        else g.effects.debrisBurst(this.pos, _v1.set(0, 4, 0), 3, 0.4);
        g.shake = Math.min(1.5, (g.shake || 0) + 0.8);
        const hx = this.vel.x, hz = this.vel.z, hs = Math.hypot(hx, hz);
        const fwd = this.getForward(_v2);
        const heading = hs > 1 ? Math.atan2(-hx, -hz) : Math.atan2(-fwd.x, -fwd.z);
        this.onGround = false; this.deck = null; this._dl = null; this.bellied = false; this.bellyWater = false; this.sinkDepth = 0;
        this.trap = false; this.catapult = 0;
        const surf = g.surfaceAt(this.pos.x, this.pos.z, 1e9);
        this.pos.y = Math.max(surf.h, 0) + this.gearOffset + 4;
        const v = Math.max(hs * 0.7, 20);
        this.vel.set(-Math.sin(heading) * v, 6, -Math.cos(heading) * v);
        this.qv.setFromAxisAngle(AY, heading).multiply(_q1.setFromAxisAngle(AX, 0.08));
        this.rollRate = 0; this.alpha = 0.05;
        this.syncBody();
        if (!(g.time - (this._bounceMsgT ?? -99) < 3)) { this._bounceMsgT = g.time; g.addFeed('SANDBOX — CRASH IGNORED', '#9fb2c4'); }
    }

    // ── Damage ──
    damage(amount, source, kind = 'gun') {
        if (!this.alive) return;
        if (this.invincible) { this.lastHitBy = source; this.lastHitTime = this.game.time; this.game.events.emit('hit', this, { source, amount: 0, kind }); return; }
        let mult = this.isPlayer ? this.game.difficulty.dmgTaken : 1;
        // AI cannon is tuned down against the player so fights last long enough to be fun
        if (this.isPlayer && kind === 'gun') mult *= 0.45;
        this.health -= amount * mult;
        this.lastHitBy = source; this.lastHitTime = this.game.time;
        this.game.events.emit('hit', this, { source, amount, kind });
        if (this.health <= 0) { this.kill(source, kind); return; }
        // visible battle damage
        const hp = this.health / this.maxHealth;
        if (kind === 'missile') {
            this.addDamagePoint();
            const wings = ['wingL', 'wingR'].filter(r => this.regions[r] && !this.lostRegions.has(r));
            if (hp < 0.6 && wings.length && Math.random() < 0.6) {
                const r = wings[Math.floor(Math.random() * wings.length)];
                const w = this.regions[r].getWorldPosition(new THREE.Vector3());
                this.game.effects.explosion(w, 0.5, this.vel);
                this.game.wreckage.detach(this, r, 1);
                this.game.events.emit('partLost', this, { region: r });
            } else {
                this.game.effects.debrisBurst(this.pos, this.vel, 4, 0.4);
            }
        } else if (Math.random() < (kind === 'flak' ? 0.2 : 0.07)) this.addDamagePoint();
        // low health: make sure a wing is burning
        if (hp < 0.35 && !this.damagePoints.some(d => d.fire)) this.addDamagePoint(true);
    }

    addDamagePoint(fire = false) {
        if (this.damagePoints.length >= 4) { if (fire) this.damagePoints[0].fire = true; return; }
        const L = this.spec.length;
        const hs = this.rig.halfSpan || this.spec.span / 2;
        let local, region;
        const r = Math.random();
        if (fire || r < 0.5) {
            // on a wing, part way out
            const side = Math.random() < 0.5 ? -1 : 1;
            region = side < 0 ? 'wingL' : 'wingR';
            if (this.lostRegions.has(region)) { region = side < 0 ? 'wingR' : 'wingL'; }
            local = new THREE.Vector3((region === 'wingL' ? -1 : 1) * hs * rand(0.25, 0.4), 0, L * rand(0.0, 0.12));
        } else if (r < 0.8) {
            region = 'center'; local = new THREE.Vector3(rand(-1, 1), L * 0.02, L * rand(0.05, 0.3));
        } else {
            region = 'tail'; local = new THREE.Vector3(0, L * 0.03, L * 0.35);
        }
        this.damagePoints.push({ local, region, fire, t: 0 });
    }

    kill(source, kind) {
        if (!this.alive) return;
        this.alive = false;
        this.health = 0;
        this.game.events.emit('killed', this, { source: source || this.lastHitBy, kind });
        if (this.spec.category !== 'civil' && (this.isPlayer || Math.random() < 0.85)) this.ejectT = rand(0.15, 0.9);
        // Big hits and missiles blow the jet apart; otherwise it falls burning
        if (kind === 'missile' && Math.random() < 0.55 || kind === 'crash') {
            this.explode(false);
        } else {
            this.falling = true;
            this.fallTimer = rand(2.5, 6);
            this.fallSpin = rand(1.5, 4) * (Math.random() < 0.5 ? -1 : 1);
            this.game.effects.explosion(this.pos, 0.7, this.vel);
        }
    }

    explode(ground = false, water = false) {
        if (this.exploded) return;
        if (this.alive) { this.alive = false; this.game.events.emit('killed', this, { source: this.lastHitBy, kind: 'crash' }); }
        this.exploded = true;
        this.falling = false;
        const fx = this.game.effects;
        if (water) fx.waterSplash(this.pos, 1.4);
        if (!water) {
            fx.explosion(this.pos, ground ? 2.2 : 1.6, ground ? null : this.vel);
            fx.debrisBurst(this.pos, ground ? _v1.set(0, 0, 0) : this.vel, ground ? 6 : 12, this.spec.length / 22);
        }
        // last-second ejection, then the airframe comes apart
        if (!ground && !this.ejected && this.ejectT > 0) this.game.wreckage.eject(this);
        if (!ground && !water) this.game.wreckage.breakup(this, 1.3);
        this.game.events.emit('exploded', this, { ground, water });
        this.root.visible = false;
        this.stopTrails();
    }

    stopTrails() {
        for (const t of this.vortex) if (t) t.emitting = false;
        for (const t of this.contrails) if (t) t.emitting = false;
        this.vortex = [null, null];
        this.contrails = [];
    }

    remove() {
        this.stopTrails();
        if (this.wireMeshes) this.wireMeshes.forEach(m => this.game.scene.remove(m));
        this.wire = null;
        this.game.scene.remove(this.root);
        // free per-instance GPU resources (shared geometries/materials are kept)
        for (const f of this.flames) f.dispose();
        for (const s of [this.navL, this.navR, this.strobe]) s && s.material.dispose();
        for (const pp of this.propParts) for (const m of [pp.blades, pp.disc]) m && m.material.dispose(); // per-prop materials (the geometry is shared)
        this.model.traverse(o => { if (o.isMesh && o.userData.origMat && o.material !== o.userData.origMat) o.material.dispose(); });
        for (const l of this.gearLegs || []) l.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        // the hook owns its geometry (materials are shared, except the hook tip's; flaps and brakes share the model's)
        if (this.hookMesh) this.hookMesh.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
        if (this.hookTip) this.hookTip.material.dispose();
        if (this.wireMeshes) { this.wireMeshes.forEach(m => m.geometry.dispose()); this.wireMeshes[0].material.dispose(); this.wireMeshes = null; }
    }

    // ── Per-frame ──
    update(dt) {
        if (this.ejectT > 0 && !this.ejected) {
            this.ejectT -= dt;
            if (this.ejectT <= 0 && !this.exploded) this.game.wreckage.eject(this);
        }
        if (this.exploded) return;
        if (this.falling) {
            // uncontrolled spiral
            this.controls.roll = clamp(this.fallSpin, -1, 1);
            this.controls.pitch = 0.2;
            this.controls.throttle = 0;
            this.fallTimer -= dt;
            if (this.fallTimer <= 0) this.explode(false);
        }
        const hTarget = this.hook ? 1 : 0;
        if (this.hookAnim !== hTarget) this.hookAnim = hTarget > this.hookAnim ? Math.min(1, this.hookAnim + dt / 1.2) : Math.max(0, this.hookAnim - dt / 1.2);
        if (this.onGround) this.settleHook(); else if (this.hookMesh) this.updateHookVisual();
        if (this.wire) this.updateWire(dt);
        if (this.fixedGear) this.gear = true;
        const gTarget = this.gear ? 1 : 0;
        if (this.gearAnim !== gTarget) {
            this.gearAnim = gTarget > this.gearAnim ? Math.min(1, this.gearAnim + dt / 2.2) : Math.max(0, this.gearAnim - dt / 2.2);
            this.updateGearVisual();
        }
        this.updateSurfaces(dt);
        this.updateFlight(dt);
        this.updateVisuals(dt);
    }

    // Prop speed (rad/s) the engine drives toward: a running engine holds the prop near its governed speed (a bit
    // more with power); a dead one lets it windmill in the airflow, and on the ground it stops.
    propTarget() {
        if (this.alive && !this.flameout && !this.bellied) return 75 + this.throttle * 35;
        return this.onGround || this.bellied ? 0 : Math.min(this.speed * 0.2, 25);
    }

    updateProps(dt) {
        const target = this.propTarget();
        for (const pp of this.propParts) {
            // a prop on a shot-off wing winds down with it
            const tgt = this.lostRegions.has(pp.p.parent?.userData.region) ? 0 : target;
            pp.rate += (tgt - pp.rate) * Math.min(1, dt * (tgt > pp.rate ? 0.6 : 0.3));
            // a real prop turns more than one blade gap per frame, which strobes (the blades stand still or turn
            // backwards): draw at most 0.3 of a gap per frame and let the blur disc carry the speed
            pp.p.rotation.z -= Math.min(pp.rate * dt, pp.gap * 0.3);
            const blur = clamp((pp.rate - 15) / 35, 0, 1);
            if (pp.blades) {
                const m = pp.blades.material, fade = blur > 0.01;
                m.opacity = 1 - 0.8 * blur;
                // an opaque material's shader forces alpha to 1: switching needs the other program variant
                if (m.transparent !== fade) { m.transparent = fade; m.needsUpdate = true; }
            }
            if (pp.disc) {
                pp.disc.material.opacity = 0.32 * blur;
                pp.disc.visible = blur > 0.01;
            }
        }
    }

    updateVisuals(dt) {
        const fx = this.game.effects;
        const now = this.game.time;
        // Engine flames
        // flame from throttle step 5 (45%) up; stronger toward step 9, afterburner on 0
        const power = this.alive && !this.flameout && !this.bellied ? clamp((this.throttle - 0.42) / 0.48, 0, 1) : 0;
        const ab = this.afterburner && this.alive && !this.flameout ? 1 : 0;
        for (const f of this.flames) f.update(power, ab, this.mach || 0, dt, now + this.id, this.game.camera);
        if (this.propParts.length) this.updateProps(dt);
        // Nav lights
        const blink = (now * 1.1 + this.id * 0.37) % 1.2 < 0.06;
        this.strobe.visible = blink && this.alive;
        this.navL.visible = this.alive && !this.lostRegions.has('wingL');
        this.navR.visible = this.alive && !this.lostRegions.has('wingR');

        const worldPos = _v1;
        // Damage: smoke / fire from battle-damage points (billowing trails)
        this.smokeT -= dt;
        const hp = this.health / this.maxHealth;
        if (this.smokeT <= 0 && (this.damagePoints.length || hp < 0.6 || this.falling)) {
            this.smokeT = this.falling ? 0.02 : 0.035;
            const pts = this.damagePoints.length ? this.damagePoints : [{ local: new THREE.Vector3(0, 0, this.spec.length * 0.2), region: 'center', fire: hp < 0.3 }];
            for (const d of pts) {
                if (this.lostRegions.has(d.region) && d.region !== 'center') continue;
                worldPos.copy(d.local).applyMatrix4(this.model.matrixWorld);
                const trailVel = _v2.copy(this.vel).multiplyScalar(0.25).add(_v3.set(0, 3, 0));
                const burning = d.fire || hp < 0.3 || this.falling;
                const dark = burning ? 0.06 : hp < 0.5 ? 0.22 : 0.4;
                const big = (burning ? 4.5 : 3) * (this.falling ? 1.4 : 1);
                fx.puffSmoke(worldPos, trailVel, big, dark, burning ? 4.5 : 2.6, burning ? 0.8 : 0.5);
                if (burning) {
                    // flames licking back off the wing
                    fx.puffFire(worldPos, _v2.copy(this.vel).multiplyScalar(0.9), this.falling ? 6 : 3.5, 0.28);
                    fx.puffFire(worldPos, _v2.copy(this.vel).multiplyScalar(0.8), this.falling ? 4 : 2.5, 0.4);
                }
            }
            // stump of a lost wing sparks and burns
            for (const r of ['wingL', 'wingR']) {
                if (!this.lostRegions.has(r) || this.exploded) continue;
                worldPos.set((r === 'wingL' ? -1 : 1) * Math.max(this.spec.length * 0.12, 2), 0, this.spec.length * 0.05).applyMatrix4(this.model.matrixWorld);
                fx.puffFire(worldPos, _v2.copy(this.vel).multiplyScalar(0.85), 3, 0.3);
                fx.puffSmoke(worldPos, _v2.copy(this.vel).multiplyScalar(0.2), 3.5, 0.08, 3.5, 0.7);
            }
        }

        // Wingtip vortices when pulling hard / high AoA
        const vapor = this.alive && !this.onGround && (this.gLoad > 5 || (this.alpha > 0.22 && this.speed > 110));
        for (let i = 0; i < 2; i++) {
            if (vapor) {
                if (!this.vortex[i]) this.vortex[i] = fx.addTrail({ max: 60, width: 0.3, life: 0.7, color: [1, 1, 1], alpha: 0.3, minDist: 4, widthGrow: 1.2 });
                worldPos.copy(this.rig.wingtips[i]).applyMatrix4(this.model.matrixWorld);
                this.vortex[i].push(worldPos, fx.now);
            } else if (this.vortex[i]) {
                this.vortex[i].emitting = false;
                this.vortex[i] = null;
            }
        }
        // Wing vapour cloud over the wing in very high-G pulls
        if (this.alive && this.gLoad > 6.5 && this.speed > 150 && Math.random() < 0.6) {
            worldPos.set(rand(-1, 1) * this.rig.halfSpan * 0.5 || rand(-3, 3), 1, rand(-2, 3)).applyMatrix4(this.model.matrixWorld);
            fx.smoke.emit(worldPos, _v2.copy(this.vel).multiplyScalar(0.92), 0.25, 3, 6, [0.95, 0.97, 1], [1, 1, 1], 0.35, 0, 0.5, 0);
        }
        // Contrails at altitude
        const wantContrail = this.alive && this.pos.y > 4200 && this.throttle > 0.3;
        if (wantContrail && !this.contrails.length) {
            for (let i = 0; i < this.rig.nozzles.length; i++) this.contrails.push(fx.addTrail({ max: 160, width: 1.2, life: 9, color: [1, 1, 1], alpha: 0.55, minDist: 25, widthGrow: 5 }));
        } else if (!wantContrail && this.contrails.length) {
            this.contrails.forEach(t => (t.emitting = false));
            this.contrails = [];
        }
        for (let i = 0; i < this.contrails.length; i++) {
            worldPos.copy(this.rig.nozzles[i]).applyMatrix4(this.model.matrixWorld);
            this.contrails[i].push(worldPos, fx.now);
        }
        // Vapour cone near Mach 1
        if (this.alive && Math.abs(this.mach - 1) < 0.045 && this.pos.y < 3500 && Math.random() < 0.8) {
            for (let k = 0; k < 3; k++) {
                const a = Math.random() * 6.28;
                const r = this.spec.length * 0.14;
                worldPos.set(Math.cos(a) * r, Math.sin(a) * r, this.spec.length * 0.05).applyMatrix4(this.model.matrixWorld);
                fx.smoke.emit(worldPos, _v2.copy(this.vel).multiplyScalar(0.97), 0.18, 2.5, 5, [0.95, 0.97, 1], [1, 1, 1], 0.45, 0, 0, 0);
            }
        }
    }
}

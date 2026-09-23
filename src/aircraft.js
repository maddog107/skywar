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

const LIFT_K = 0.0016;
const CL_MAX = 1.65;
const K_INDUCED = 0.13;

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _acc = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);

// Shared flame material template (additive, HDR so bloom picks it up)
const flameGeo = (() => {
    const g = new THREE.ConeGeometry(1, 1, 16, 8, true);
    g.translate(0, -0.5, 0);
    g.rotateX(-Math.PI / 2); // tip points +Z (backwards)
    return g;
})();
function makeFlameMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
        uniforms: { power: { value: 0 }, ab: { value: 0 }, time: { value: 0 } },
        vertexShader: /* glsl */`
            varying float vT; varying vec3 vN; varying vec3 vV;
            void main() {
                vT = position.z; // 0 at nozzle, 1 at tip
                vec4 mv = modelViewMatrix * vec4(position, 1.0);
                vN = normalize(normalMatrix * normal);
                vV = normalize(-mv.xyz);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: /* glsl */`
            uniform float power, ab, time; varying float vT; varying vec3 vN; varying vec3 vV;
            void main() {
                float rim = pow(abs(dot(vN, vV)), 1.5);
                float t = clamp(vT, 0.0, 1.0);
                // shock diamonds when the afterburner is lit
                float diamonds = ab * 0.6 * pow(0.5 + 0.5 * cos(t * 36.0 - time * 3.0), 6.0) * (1.0 - t);
                vec3 core = mix(vec3(0.6, 0.75, 1.6), vec3(3.2, 1.7, 0.6), ab);
                vec3 tip = mix(vec3(0.15, 0.2, 0.7), vec3(1.6, 0.35, 0.05), ab);
                vec3 col = mix(core, tip, t) * (1.0 - t) * rim;
                col += vec3(3.0, 2.2, 1.4) * diamonds;
                float flick = 0.85 + 0.15 * sin(time * 60.0 + t * 12.0);
                gl_FragColor = vec4(col * power * flick, 1.0);
            }`,
    });
}
const navTex = makeRadialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,255,255,0.8)'], [1, 'rgba(255,255,255,0)']]);

// Handy reference speeds (m/s): stall with a flap setting, takeoff and approach
export function refSpeeds(spec) {
    const liftK = LIFT_K * spec.flight.lift;
    const vs = (flaps) => Math.sqrt(G / (liftK * CL_MAX * (1 + 0.2 * flaps)));
    return { stall: vs(0), takeoff: vs(1) * 1.12, approach: vs(2) * 1.3, flapLimit: 175 };
}

let nextId = 1;
const SURF_MAT = new THREE.MeshStandardMaterial({ color: 0x6f777f, metalness: 0.35, roughness: 0.5, side: THREE.DoubleSide });
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
        this.root = new THREE.Group();
        this.root.add(object);
        game.scene.add(this.root);

        const f = this.spec.flight;
        this.liftK = LIFT_K * f.lift;
        this.alphaMax = f.alpha * DEG;
        this.clSlope = CL_MAX / this.alphaMax;
        this.cd0 = f.accel / (this.liftK * f.speed * f.speed);
        this.thrustAB = f.accel;
        this.thrustMil = f.accel * 0.62;
        this.hitRadius = clamp(this.spec.length * 0.55, 7, 22);
        this.gearOffset = -(rig.minY ?? -this.spec.length * 0.08) + 1.2;
        if (!rig.minY) this.gearOffset = this.spec.length * 0.09 + 1.2;

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
        this.flames = [];
        for (const n of rig.nozzles) {
            const m = new THREE.Mesh(flameGeo, makeFlameMaterial());
            m.position.copy(n);
            m.renderOrder = 9;
            m.frustumCulled = false;
            this.model.add(m);
            this.flames.push(m);
        }
        // nav lights
        const mk = (color, pos, scale) => {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: navTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
            s.position.copy(pos);
            s.scale.setScalar(scale);
            this.model.add(s);
            return s;
        };
        const [lt, rt] = rig.wingtips;
        this.navL = mk(new THREE.Color(1.4, 0.05, 0.05), lt, 0.9);
        this.navR = mk(new THREE.Color(0.05, 1.4, 0.2), rt, 0.9);
        this.strobe = mk(new THREE.Color(1.5, 1.5, 1.5), new THREE.Vector3(0, rig.height ? rig.height * 0.35 : 2, this.spec.length * 0.42), 0.8);
        this.vortex = [null, null];
        this.contrails = [];
        this.wingVapor = 0;
        this.buildGear();
        this.buildSurfaces();
    }

    buildGear() {
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
    }

    // Visible flaps (wing trailing edge) and speed brake (spine panel, or wing spoilers on big jets)
    buildSurfaces() {
        const L = this.spec.length, rig = this.rig;
        const hs = rig.halfSpan || this.spec.span / 2;
        const tip = rig.wingtips[1] || new THREE.Vector3(hs, 0, L * 0.15);
        const wingY = tip.y, teZ = tip.z + L * 0.015;
        const mat = SURF_MAT;
        const chord = Math.max(0.6, L * 0.055), span = hs * 0.42, thick = Math.max(0.05, L * 0.004);
        this.flapPanels = [];
        for (const s of [-1, 1]) {
            const pivot = new THREE.Group();
            pivot.position.set(s * hs * 0.4, wingY, teZ);
            const panel = new THREE.Mesh(new THREE.BoxGeometry(span, thick, chord), mat);
            panel.position.z = chord / 2;
            panel.castShadow = true;
            pivot.add(panel);
            pivot.visible = false;
            this.model.add(pivot);
            this.flapPanels.push(pivot);
        }
        this.brakePanels = [];
        const big = this.spec.category !== 'fighter';
        if (big) {
            // spoilers pop up from the top of each wing
            for (const s of [-1, 1]) {
                const pivot = new THREE.Group();
                pivot.position.set(s * hs * 0.45, wingY + thick, teZ - chord * 1.6);
                const panel = new THREE.Mesh(new THREE.BoxGeometry(span * 0.9, thick, chord * 0.9), mat);
                panel.position.z = chord * 0.45;
                panel.castShadow = true;
                pivot.add(panel);
                pivot.visible = false;
                this.model.add(pivot);
                this.brakePanels.push(pivot);
            }
        } else {
            const topY = rig.minY != null && rig.height ? rig.minY + rig.height * 0.62 : L * 0.05;
            const pivot = new THREE.Group();
            pivot.position.set(0, topY, L * 0.0);
            const len = L * 0.13, w = L * 0.065;
            const panel = new THREE.Mesh(new THREE.BoxGeometry(w, thick, len), mat);
            panel.position.z = len / 2;
            panel.castShadow = true;
            pivot.add(panel);
            pivot.visible = false;
            this.model.add(pivot);
            this.brakePanels.push(pivot);
        }
    }

    updateSurfaces(dt) {
        const onGroundBrake = this.onGround && this.isPlayer && this.game.input.down('Space');
        const brakeTarget = this.airbrake && !onGroundBrake ? 1 : this.airbrake && this.onGround ? 1 : 0;
        this.brakeAnim = damp(this.brakeAnim, this.alive ? brakeTarget : 0, 5, dt);
        this.flapAnim = damp(this.flapAnim, this.flaps / 2, 2.5, dt);
        for (const p of this.flapPanels) { p.visible = this.flapAnim > 0.03; p.rotation.x = this.flapAnim * 0.7; }
        const big = this.spec.category !== 'fighter';
        for (const p of this.brakePanels) { p.visible = this.brakeAnim > 0.03; p.rotation.x = -this.brakeAnim * (big ? 0.9 : 0.85); }
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
        this.gear = false; this.gearAnim = 0; this.onGround = false; this.deck = null; this.flaps = 0;
        this.syncBody();
    }

    // Park on a carrier catapult (ship from naval.js)
    spawnDeck(ship) {
        const spot = ship.catapultSpot();
        this.qv.setFromAxisAngle(AY, ship.heading);
        this.pos.copy(spot).setY(ship.deckY + this.gearOffset);
        this.deck = ship; this.deckHeading = 0; this.relSpeed = 0;
        this.vel.copy(ship.vel);
        this.speed = 0; this.alpha = 0;
        this.throttle = this.controls.throttle = 0;
        this.gear = true; this.gearAnim = 1; this.onGround = true; this.flaps = 1;
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
        this.gear = true; this.gearAnim = 1; this.onGround = true; this.deck = null; this.relSpeed = 0; this.flaps = 1;
        this.syncBody();
    }

    // Engine thrust (m/s²) for the current throttle, including fuel starvation
    thrustFor(rho) {
        if (this.flameout || this.bellied) return 0;
        const t = this.throttle;
        return (t <= 0.9 ? this.thrustMil * (t / 0.9) : this.thrustMil + (this.thrustAB - this.thrustMil) * ((t - 0.9) / 0.1)) * (0.45 + 0.55 * rho);
    }

    burnFuel(dt) {
        if (!this.isPlayer || this.game.settings?.fuel === false || this.flameout) return;
        const t = this.throttle;
        const rate = t <= 0.9 ? 0.12 + 0.88 * (t / 0.9) : 1 + 3 * ((t - 0.9) / 0.1);
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

    get clEff() { return this.clSlope * (1 + 0.2 * this.flaps); }

    syncBody() {
        if (this.gearLegs && this._gearShown !== this.gearAnim) { this._gearShown = this.gearAnim; this.updateGearVisual(); }
        _q1.setFromAxisAngle(AX, this.alpha);
        _q2.setFromAxisAngle(AY, this.beta);
        this.quat.copy(this.qv).multiply(_q1).multiply(_q2);
    }

    // ── Flight model step ──
    updateFlight(dt) {
        const c = this.controls, f = this.spec.flight;
        const alt = this.pos.y;
        const rho = Math.exp(-Math.max(alt, 0) / 9000);
        let V = this.vel.length();
        this.speed = V;
        this.mach = V / (340 - Math.max(alt, 0) * 0.004);

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
        this.rollRate = damp(this.rollRate, rollTarget, 7, dt);
        _q1.setFromAxisAngle(AZ, -this.rollRate * dt);
        this.qv.multiply(_q1);

        // Lift direction & neutral G (so neutral stick holds the flight path)
        const liftDir = _v2.set(0, 1, 0).applyQuaternion(this.qv);
        const nNeutral = Math.max(0, liftDir.y) * (this.falling ? 0 : 1);
        const gLim = f.gLimit;
        let nCmd = c.pitch >= 0
            ? nNeutral + c.pitch * (gLim - nNeutral)
            : nNeutral + c.pitch * (nNeutral + 3);

        // AoA needed to produce the commanded G, limited by stall AoA
        const clS = this.clEff;
        let alphaCmd = (nCmd * G) / Math.max(q * clS, 1e-3);
        const alphaLim = this.alphaMax;
        this.stalling = alphaCmd > alphaLim * 0.98 && c.pitch > -0.2 && V < f.speed * 0.45;
        alphaCmd = clamp(alphaCmd, -alphaLim * 0.55, alphaLim);
        const pitchRateMax = 1.4 * clamp(V / 120, 0.35, 1.2);
        const dA = clamp(alphaCmd - this.alpha, -pitchRateMax * dt, pitchRateMax * dt);
        this.alpha = damp(this.alpha, this.alpha + dA * 1.0 / Math.max(dt, 1e-4) * dt, 1, dt) + dA * 0.9;
        this.alpha = clamp(this.alpha, -alphaLim * 0.6, alphaLim);

        // Sideslip from rudder
        const betaCmd = c.yaw * 7 * DEG * authority;
        this.beta = damp(this.beta, betaCmd, 4, dt);

        const Cl = clS * this.alpha;
        let lift = q * Cl * (1 - (this.lostRegions.has('wingL') ? 0.22 : 0) - (this.lostRegions.has('wingR') ? 0.22 : 0));
        const maxLift = gLim * G * 1.05;
        lift = clamp(lift, -maxLift * 0.45, maxLift);
        const side = -q * this.clSlope * 0.45 * this.beta;

        let cd = this.cd0 * (1 + 3.5 * this.brakeAnim) + K_INDUCED * Cl * Cl / f.lift + 0.6 * this.beta * this.beta;
        if (this.gearAnim > 0.05) cd += this.cd0 * 0.8 * this.gearAnim;
        cd += this.cd0 * 0.85 * this.flapAnim * 2;
        if (this.flaps && V > 175 && this.isPlayer) { this.flaps = 0; this.game.events.emit('flapsBlown', this); }
        // transonic drag rise
        if (this.mach > 0.9) cd += this.cd0 * clamp((this.mach - 0.9) * 2.2, 0, 0.8);
        const drag = q * cd;

        const thrustN = this.thrustFor(rho);
        this.afterburner = this.throttle > 0.905 && !this.flameout;
        this.burnFuel(dt);

        const rightW = _v3.set(1, 0, 0).applyQuaternion(this.qv);
        const bodyFwd = this.getForward(new THREE.Vector3());
        _acc.set(0, -G, 0)
            .addScaledVector(liftDir, lift)
            .addScaledVector(rightW, side)
            .addScaledVector(vhat, -drag)
            .addScaledVector(bodyFwd, this.falling ? thrustN * 0.2 : thrustN);
        // wind
        if (this.game.wind) _acc.addScaledVector(this.game.wind, 0.02);

        // speed brake: extra parasitic drag plus a fixed bite so it works at any speed
        if (this.brakeAnim > 0.05) _acc.addScaledVector(vhat, -1.8 * this.brakeAnim);
        this.gLoad = lift / G + (this.gLoad - lift / G) * Math.exp(-10 * dt);

        const oldDir = _v2.copy(vhat);
        this.vel.addScaledVector(_acc, dt);
        V = this.vel.length();
        if (V < 5) { this.vel.addScaledVector(bodyFwd, 5 - V); V = 5; }
        // cap absurd speeds
        const vcap = f.speed * 1.6;
        if (V > vcap) this.vel.multiplyScalar(vcap / V);
        const newDir = _v3.copy(this.vel).normalize();
        _q1.setFromUnitVectors(oldDir, newDir);
        this.qv.premultiply(_q1).normalize();

        // Stall departure: at very low speed the nose falls through
        if (V < 45 && !this.falling) {
            const drop = (45 - V) / 45;
            const fwdW = _v2.set(0, 0, -1).applyQuaternion(this.qv);
            const axis = _v3.crossVectors(fwdW, AY);
            if (axis.lengthSq() > 1e-4) {
                axis.normalize();
                _q1.setFromAxisAngle(axis, -drop * 0.9 * dt);
                this.qv.premultiply(_q1);
                this.vel.applyQuaternion(_q1);
            }
        }

        this.pos.addScaledVector(this.vel, dt);
        this.syncBody();
        this.checkGround(dt);
    }

    updateGround(dt, rho) {
        const c = this.controls;
        const thrust = this.thrustFor(rho);
        this.afterburner = this.throttle > 0.905 && !this.flameout;
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

        const rotateSpeed = Math.sqrt(G / (this.liftK * rho * CL_MAX * (1 + 0.2 * this.flaps))) * 1.05;
        const pitchTarget = V > rotateSpeed * 0.85 && !this.bellied ? clamp(c.pitch, 0, 1) * 0.28 : 0;
        this.alpha = damp(this.alpha, pitchTarget, 2.5, dt);
        const Cl = this.clEff * this.alpha;
        // spoilers: airbrake on the ground dumps lift and brakes hard
        const lift = this.liftK * V * V * rho * Cl * (this.airbrake ? 0.3 : 1);
        let friction = (this.airbrake ? 6 : 0.25) + (c.throttle < 0.05 && V < 30 ? 1.5 : 0);
        if (this.bellied) friction = this.bellyWater ? 10 : 8;
        const drag = this.liftK * V * V * rho * (this.cd0 * (1 + 3.5 * this.brakeAnim + 1.7 * this.flapAnim) + K_INDUCED * Cl * Cl);
        let acc = thrust - drag - (V > 0.1 ? friction : 0);
        // carrier catapult: a violent shove down the deck
        if (this.catapult > 0) {
            this.catapult -= dt;
            acc = Math.max(acc, 34);
            if (V > rotateSpeed * 1.2) this.catapult = 0;
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
        this.stalling = false;
        this.mach = V / 340;
        const dir = _v2.set(0, 0, -1).applyQuaternion(this.qv);
        this.vel.copy(dir).multiplyScalar(V);
        if (ship) this.vel.add(ship.vel);
        this.pos.addScaledVector(this.vel, dt);
        const surf = this.game.surfaceAt(this.pos.x, this.pos.z, this.pos.y - this.gearOffset + 3);
        if (ship && surf.ship !== ship) {
            // off the end (or edge) of the deck: flying if fast enough, otherwise dropping
            this.onGround = false; this.deck = null; this.catapult = 0;
            if (V > rotateSpeed) { this.vel.y += 2.5; this.pos.y += 0.5; this.alpha = Math.max(this.alpha, 0.12); }
            this.syncBody();
            return;
        }
        this.pos.y = surf.h + this.gearOffset;
        if (this.bellied) {
            this.pos.y = surf.h + (this.bellyWater ? 0 : 0.2) + 1.0 - this.sinkDepth;
            this.updateBelly(dt, V);
            if (V > 5) { this.qv.multiply(_q1.setFromAxisAngle(AZ, (Math.random() - 0.5) * 0.02)); }
        } else if (lift > G * 1.02) {
            this.onGround = false;
            this.deck = null;
            this.vel.y = 2.5;
            this.pos.y += 0.5;
            this.catapult = 0;
        }
        if (!ship) {
            // rolled off the runway at speed on rough ground?
            if (!surf.runway && V > 40 && surf.h > 1 && !(this.bellied && V < 90)) {
                const e = 5;
                const slope = Math.abs(terrainHeight(this.pos.x + e, this.pos.z) - terrainHeight(this.pos.x - e, this.pos.z)) / (2 * e);
                if (slope > 0.12) this.crash();
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
            this.deck = surf.ship || null;
            this.pos.y = surf.h + this.gearOffset;
            this.relSpeed = relSpeed;
            const heading = Math.atan2(-rel.x, -rel.z);
            this.qv.setFromAxisAngle(AY, heading);
            if (this.deck) {
                this.deckHeading = heading - this.deck.heading;
                this.trap = this.deck.inWireZone(this.pos.x, this.pos.z);
            }
            this.vel.y = shipVel.y;
            this.alpha = Math.max(0, pitch);
            this.game.events.emit('touchdown', this, { vs, onRunway: !!surf.runway, onDeck: !!surf.ship, trap: this.trap });
            return;
        }
        // too hard / gear up / off-field — but still survivable? Then it's a belly landing (or ditching)
        const canBelly = !surf.hull && vs > -6.5 && upY > 0.8 && pitch > -0.15 && pitch < 0.4 && relSpeed < this.spec.flight.speed * 0.75;
        if (canBelly) { this.startBelly(surf, rel, relSpeed, vs); return; }
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
        this.flaps = 0;
        this.onGround = true;
        this.deck = surf.ship || null;
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

    crash(water = false) {
        if (!this.alive && !this.falling) return;
        if (water) this.game.effects.waterSplash(this.pos, 1.4);
        this.health = 0;
        this.explode(true, water);
    }

    // ── Damage ──
    damage(amount, source, kind = 'gun') {
        if (!this.alive) return;
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
        this.game.scene.remove(this.root);
        // free per-instance GPU resources (shared geometries/materials are kept)
        for (const m of this.flames) m.material.dispose();
        for (const s of [this.navL, this.navR, this.strobe]) s && s.material.dispose();
        this.model.traverse(o => { if (o.isMesh && o.userData.origMat && o.material !== o.userData.origMat) o.material.dispose(); });
        for (const l of this.gearLegs || []) l.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
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
        const gTarget = this.gear ? 1 : 0;
        if (this.gearAnim !== gTarget) {
            this.gearAnim = gTarget > this.gearAnim ? Math.min(1, this.gearAnim + dt / 2.2) : Math.max(0, this.gearAnim - dt / 2.2);
            this.updateGearVisual();
        }
        this.updateSurfaces(dt);
        this.updateFlight(dt);
        this.updateVisuals(dt);
    }

    updateVisuals(dt) {
        const fx = this.game.effects;
        const now = this.game.time;
        // Engine flames
        const power = this.alive && !this.flameout ? clamp((this.throttle - 0.35) / 0.55, 0, 1) : 0;
        const ab = this.afterburner && this.alive && !this.flameout ? 1 : 0;
        const R = this.rig.nozzleR;
        for (const m of this.flames) {
            const u = m.material.uniforms;
            u.time.value = now + this.id;
            u.power.value = damp(u.power.value, power * 0.55 + ab * 1.2, 10, dt);
            u.ab.value = damp(u.ab.value, ab, 6, dt);
            const len = R * (2 + power * 3 + ab * (9 + Math.random() * 1.5));
            m.scale.set(R * (0.85 + ab * 0.15), R * (0.85 + ab * 0.15), len);
            m.visible = u.power.value > 0.02;
        }
        // Props
        if (this.rig.props) for (const p of this.rig.props) p.rotation.z += dt * (8 + this.throttle * 60);
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
                if (!this.vortex[i]) this.vortex[i] = fx.addTrail({ max: 60, width: 0.35, life: 0.9, color: [1, 1, 1], alpha: 0.5, minDist: 4, widthGrow: 2.5 });
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

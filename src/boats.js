// ═══════════════════════════════════════════════════════════════
// Small military boats you drive (docs/WAR.md "Interiors and boats"): the Naval Special Warfare 11 m RHIB and the
// Swedish Combat Boat 90H (models/ships/rhib.glb / cb90.glb, rigged: seats, wheel, waterjet nozzles, hatch_entry).
//  • BoatPhysics: a planing hull on the waves of water.js — waterjet thrust (power-limited, a reversing bucket),
//    hull resistance that humps and falls away on the plane, a keel that turns it, yaw from the nozzles, heave /
//    pitch / roll that follow the surface under the bow, stern and sides and leave it on a crest (the boat flies
//    and slams back down), trim and lift on the plane, banking into turns, grounding. Pure numbers: tests drive it.
//  • Boat: the model, the physics, spray, the wake (shipfx.js), the engines' sound; moored to a pier slot or
//    alongside a ship (it rides along); the player sits at the helm (the Helm controller: interiors.js)
//  • Harbor: a naval small-craft pier near the home base with a floating pontoon and a gangway, walkable
//    (game.platforms), with mooring slots for the boats
// Real numbers: NSW RIB (USSOCOM fact book, US Navy fact file): 11 m, 3.2 m, 2 × Caterpillar 3126 (470 hp) and
// 2 × Kamewa FF-280 waterjets, 45+ kt. CB90H (Dockstavarvet / Saab): 15.9 m, 3.8 m, 15.3 t (19 t loaded),
// 2 × Scania DSI14 V8 (625 hp), 2 × Kamewa FF-450 waterjets, 40+ kt, turns and stops in a few lengths.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, damp, smoothstep, rand } from './util.js';
import { waterSample, WATER } from './water.js';
import { terrainHeight } from './terraincore.js';
import { hullResistance } from './seaplane.js';
import { shipModel, steerWheel, SHIP_TYPES } from './naval.js';

const G = 9.81;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _W = { h: 0, nx: 0, ny: 1, nz: 0, vx: 0, vy: 0, vz: 0, jac: 1, x0: 0, z0: 0, depth: 0 };
export const KT = 1.94384;

// top: design top speed (m/s) at full power, light sea; hump: speed of the resistance hump (m/s) — past ~1.6× it
// the hull is fully up on the plane; power (W) and eta (propulsive efficiency) give the thrust at speed, capped
// at `bollard` (m/s² at rest); rMax: the fastest yaw rate (rad/s); turnU: speed for full steering authority;
// sway: how hard the keel resists sliding sideways (1/s); heave / pitch / roll: natural frequency (rad/s) and
// damping of the hull on the water; lift: how far it rises on the plane (m); trim: bow-up at the hump / on the
// plane (rad); heel: bank into a full-rate turn (rad); draft: keel below the waterline (m)
export const BOAT_SPECS = {
    rhib: {
        name: 'NSW 11 M RHIB', short: 'RHIB', L: 11, B: 3.2, mass: 8200, power: 701e3, eta: 0.52, bollard: 3.3, reverse: 0.5, top: 23.4,
        hump: 7.2, rMax: 0.62, turnU: 9, sway: 2.4, heave: [5.4, 0.36], pitch: [5.2, 0.42], roll: [4.4, 0.3],
        lift: 0.32, trim: [0.075, 0.03], heel: 0.2, draft: 0.62, engines: 2, cyl: 6, idleRpm: 650, maxRpm: 2800, eye: 0.72,
    },
    cb90: {
        name: 'COMBAT BOAT 90H', short: 'CB90', L: 15.9, B: 3.8, mass: 16500, power: 932e3, eta: 0.5, bollard: 3.0, reverse: 0.7, top: 20.8,
        hump: 8, rMax: 0.58, turnU: 8, sway: 2.8, heave: [4.8, 0.4], pitch: [4.4, 0.45], roll: [3.8, 0.34],
        lift: 0.28, trim: [0.06, 0.025], heel: 0.16, draft: 0.8, engines: 2, cyl: 8, idleRpm: 600, maxRpm: 2300, eye: 0.8,
    },
};

// ═════════════ Physics ═════════════
// The sea is a function (x, z, out) → out { h, vy } (default: water.js's waves). World: x east, z south, y up;
// heading h (rad): 0 = north (−z), + = turning left (naval.js's convention). Controls: throttle −1 (full astern:
// the reversing buckets) … 1, steer −1 (port) … 1 (starboard).
export function seaSampler(x, z, out) { const s = waterSample(x, z, WATER.t, _W); out.h = s.h; out.vy = s.vy; return out; }

export class BoatPhysics {
    constructor(spec, x = 0, z = 0, heading = 0) {
        this.spec = spec;
        this.x = x; this.y = 0; this.z = z; this.h = heading;
        this.u = 0; this.v = 0; this.r = 0;          // surge, sway (m/s, body), yaw rate (rad/s)
        this.vy = 0;                                 // heave rate
        this.pitch = 0; this.pr = 0; this.roll = 0; this.rr = 0;
        this.throttle = 0; this.steer = 0;           // the actual lever / nozzle positions (they follow the input)
        this.airborne = false; this.airT = 0;
        this.slam = 0;                               // the last landing's impact speed (m/s), for effects
        this.grounded = false;
        this.immersion = 1;                          // how much of the jets is in the water
        this.plane = 0;                              // 0 displacement … 1 fully on the plane
        this.thrust = 0;
        this.sea = seaSampler;
        this.collide = null;                         // (x, z, r) → { nx, nz, d } push-out, or null
        this.ground = terrainHeight;                 // sea-bed height at (x, z)
        // top speed: the quadratic (spray / air / appendage) drag that makes thrust = resistance there
        const top = spec.top, Tt = spec.power * spec.eta / (spec.mass * top);
        this.k2 = Math.max(0, (Tt - G * hullResistance(top / spec.hump)) / (top * top));
        this._s = [{ h: 0, vy: 0 }, { h: 0, vy: 0 }, { h: 0, vy: 0 }, { h: 0, vy: 0 }, { h: 0, vy: 0 }];
        this.settle();
    }

    get speed() { return Math.hypot(this.u, this.v); }
    get knots() { return this.u * KT; }

    // float at rest where it is
    settle() {
        const s = this.sea(this.x, this.z, this._s[4]);
        this.y = s.h; this.vy = 0; this.pitch = this.roll = this.pr = this.rr = 0;
        return this;
    }

    // resistance (m/s², always ≥ 0) at |u|
    resistance(u) {
        const a = Math.abs(u), S = this.spec;
        // (+ a viscous term at displacement speeds, so it does coast to a stop; gone once it's on the plane)
        return G * hullResistance(a / S.hump) * (1 - 0.35 * (this.airborne ? 1 : 0)) + this.k2 * a * a + 0.09 * a * (1 - smoothstep(0, S.hump, a));
    }
    // thrust (m/s², signed) for a throttle at surge speed u
    thrustAt(thr, u) {
        const S = this.spec;
        if (thr >= 0) return thr * Math.min(S.bollard, S.power * S.eta / (S.mass * Math.max(Math.abs(u), 0.5)));
        return thr * S.bollard * S.reverse;
    }

    step(dt, ctl = { throttle: 0, steer: 0 }) {
        const n = Math.max(1, Math.ceil(dt / (1 / 120)));
        const h = dt / n;
        for (let i = 0; i < n; i++) this.sub(h, ctl);
        return this;
    }

    sub(dt, ctl) {
        const S = this.spec;
        // the helm: the throttle levers and the nozzles slew to what's asked
        this.throttle = approach(this.throttle, clamp(ctl.throttle || 0, -1, 1), dt / 0.8);
        this.steer = approach(this.steer, clamp(ctl.steer || 0, -1, 1), dt / 0.35);
        const c = Math.cos(this.h), s = Math.sin(this.h);
        const fx = -s, fz = -c, rx = c, rz = -s;           // forward, starboard
        // ── the sea under the hull: bow, stern, port, starboard, middle ──
        const Lb = S.L * 0.36, Bb = S.B * 0.42;
        const bow = this.sea(this.x + fx * Lb, this.z + fz * Lb, this._s[0]);
        const stern = this.sea(this.x - fx * Lb, this.z - fz * Lb, this._s[1]);
        const port = this.sea(this.x - rx * Bb, this.z - rz * Bb, this._s[2]);
        const stbd = this.sea(this.x + rx * Bb, this.z + rz * Bb, this._s[3]);
        const mid = this.sea(this.x, this.z, this._s[4]);
        const hc = (bow.h + stern.h + port.h + stbd.h + 2 * mid.h) / 6;
        const vyw = mid.vy;
        this.plane = smoothstep(S.hump * 0.9, S.hump * 1.7, Math.abs(this.u));
        const hump = Math.exp(-(((Math.abs(this.u) - S.hump) / (S.hump * 0.45)) ** 2));
        // ── vertical: buoyancy + planing lift pull it to the surface; gravity only, once it's left the water ──
        const w = S.heave[0], z = S.heave[1], e0 = G / (w * w);
        const yT = hc + S.lift * this.plane;
        const e = yT - this.y;
        const wasAir = this.airborne;
        this.airborne = e < -e0 * 1.02;
        let ay;
        if (!this.airborne) ay = Math.max(-G, w * w * e - 2 * z * w * (this.vy - vyw));
        else ay = -G;
        if (wasAir && !this.airborne) {
            const imp = vyw - this.vy;
            this.slam = Math.max(0, imp);
            this.airT = 0;
        }
        if (this.airborne) this.airT += dt;
        this.vy += ay * dt;
        this.y += this.vy * dt;
        // the jets: out of the water, they only spin (the transom's depth under the surface)
        // (the stern drops Lb·pitch when the bow comes up)
        const transomDepth = stern.h - (this.y - this.pitch * Lb - S.draft * 0.7);
        this.immersion = clamp((transomDepth + 0.1) / (S.draft * 0.35), 0, 1);
        // ── surge, sway and yaw (body frame; Coriolis terms carry the momentum round a turn) ──
        const T = this.thrustAt(this.throttle, this.u) * this.immersion;
        this.thrust = T;
        const R = this.resistance(this.u) * Math.sign(this.u);
        // (r is + to port: turning left the hull slides out to starboard, and a turn bleeds speed)
        const du = T - R - this.v * this.r;
        const dv = -S.sway * (this.airborne ? 0.15 : 1) * this.v + this.u * this.r;
        // yaw: the nozzles push the stern round (thrust vectoring: even stopped, with power on), steering reverses astern
        const auth = (0.25 * Math.abs(this.throttle) * this.immersion + 0.75 * clamp(Math.abs(this.u) / S.turnU, 0, 1)) * (this.airborne ? 0.1 : 1);
        const rT = -this.steer * S.rMax * auth * (this.u < -0.5 ? -1 : 1);
        this.r += (rT - this.r) * clamp(dt * (this.airborne ? 0.4 : 2.6), 0, 1);
        this.u += du * dt;
        if (Math.abs(this.u) < 0.02 && this.throttle === 0) this.u *= Math.exp(-3 * dt); // (it does come to a stop)
        this.v += dv * dt;
        this.h += this.r * dt;
        // world motion
        const nc = Math.cos(this.h), ns = Math.sin(this.h);
        const vx = this.u * -ns + this.v * nc, vz = this.u * -nc + this.v * -ns;
        let nx = this.x + vx * dt, nz = this.z + vz * dt;
        // the bottom: bow into shallow water → aground (a boat can back off)
        const bx = nx + -ns * S.L * 0.45, bz = nz + -nc * S.L * 0.45;
        const bed = this.ground(bx, bz);
        this.grounded = bed > this.y - S.draft;
        if (this.grounded && this.u > 0) { this.u *= Math.exp(-8 * dt); nx = this.x + (this.v * nc) * dt; nz = this.z + (this.v * -ns) * dt; }
        // piers, ships: pushed out, the speed into them killed
        if (this.collide) {
            const hit = this.collide(nx, nz, S.B * 0.5 + 0.2, this);
            if (hit) {
                nx += hit.nx * hit.d; nz += hit.nz * hit.d;
                const vin = vx * hit.nx + vz * hit.nz;
                if (vin < 0) {
                    // remove the velocity into the obstacle (in the body frame)
                    const kx = hit.nx * vin, kz = hit.nz * vin;
                    this.u -= (kx * -ns + kz * -nc) * 1.3; this.v -= (kx * nc + kz * -ns) * 1.3;
                    this.bump = Math.max(this.bump || 0, -vin);
                }
            }
        }
        this.x = nx; this.z = nz;
        // ── pitch and roll: follow the surface (and trim on the plane, bank into the turn); tumble a little in the air ──
        const trim = S.trim[0] * hump + S.trim[1] * this.plane * (this.u > 0 ? 1 : 0);
        const pw = Math.atan2(bow.h - stern.h, 2 * Lb), rw = Math.atan2(stbd.h - port.h, 2 * Bb);
        const heel = clamp(this.r / S.rMax, -1, 1) * S.heel * clamp(this.u / S.turnU, 0, 1.2); // (banks into the turn)
        if (!this.airborne) {
            const [wp, zp] = S.pitch, [wr, zr] = S.roll;
            this.pr += (wp * wp * (pw + trim - this.pitch) - 2 * zp * wp * this.pr) * dt;
            this.rr += (wr * wr * (rw + heel - this.roll) - 2 * zr * wr * this.rr) * dt;
        } else {
            this.pr += (-0.8 * this.pr - 0.9 * (this.pitch + 0.02)) * dt; // the bow drops a little
            this.rr *= Math.exp(-0.5 * dt);
        }
        this.pitch = clamp(this.pitch + this.pr * dt, -0.45, 0.5);
        this.roll = clamp(this.roll + this.rr * dt, -0.6, 0.6);
    }

    // world velocity into out (for the wake, the camera, anything riding along)
    velocity(out) {
        const nc = Math.cos(this.h), ns = Math.sin(this.h);
        return out.set(this.u * -ns + this.v * nc, this.vy, this.u * -nc + this.v * -ns);
    }
}

function approach(a, b, step) { return Math.abs(b - a) <= step ? b : a + Math.sign(b - a) * step; }

// ═════════════ A boat in the world ═════════════
// Duck-typed like a naval.js Ship where the wake / foam (shipfx.js) and the war look: mesh, heading, vel, def, type,
// alive, depth, pos, team, name, hitRadius, damage().
export class Boat {
    constructor(game, type, x, z, heading, opts = {}) {
        this.game = game;
        this.type = type;
        this.spec = BOAT_SPECS[type];
        this.def = SHIP_TYPES[type];
        this.name = opts.name || this.spec.name;
        this.callsign = this.name;
        this.team = opts.team || 'blue';
        this.cls = 'boat';
        this.isShip = true; this.isBoat = true;
        this.alive = true;
        this.hp = this.maxHp = this.health = this.maxHealth = this.def.hp * 2;
        this.depth = 0;
        this.radius = this.spec.L * 0.4; this.hitRadius = this.spec.L * 0.5;
        this.phys = new BoatPhysics(this.spec, x, z, heading);
        const m = shipModel(type);
        this.mesh = m.group;
        this.mesh.rotation.order = 'YXZ';
        this.rig = m.rig; this.layout = m.layout;
        this.mesh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        game.scene.add(this.mesh);
        this.pos = new THREE.Vector3(x, 0, z);
        this.vel = new THREE.Vector3();
        this.heading = heading;
        this.moored = null;        // { host (a Ship or null for a fixed slot), lx, lz, dh } or { slot }
        this.driver = null;        // the Helm controller while someone's at the wheel
        this.sprayT = 0; this.rpm = this.spec.idleRpm;
        this.engineOn = false;
        if (game.naval && game.naval.fx) game.naval.fx.add(this, this.layout);
        this.place();
    }

    get x() { return this.phys.x; }
    get z() { return this.phys.z; }

    // a point of the rig (hatch_entry, jet_1, seat_driver…) in the world
    point(name, out) {
        const o = this.rig.points[name] || this.rig.seats[name.replace(/^seat_/, '')];
        if (!o) return out.copy(this.pos);
        o.updateWorldMatrix(true, false);
        return out.setFromMatrixPosition(o.matrixWorld);
    }

    // tie up: to a fixed slot ({ x, z, heading }) or alongside a moving ship (host: its local lx, lz and heading)
    moor(host, lx, lz, dh = 0) {
        this.moored = { host, lx, lz, dh };
        this.phys.u = this.phys.v = this.phys.r = 0;
        this.phys.throttle = 0;
        this.engineOn = false;
    }
    castOff() { this.moored = null; }

    update(dt, ctl = null) {
        const p = this.phys, g = this.game;
        if (!this.alive) { this.sinkT = (this.sinkT || 0) + dt; this.phys.y -= dt * 0.4; this.place(); return; }
        if (this.moored) {
            const m = this.moored, H = m.host;
            if (H && (H.gone || (H.depth || 0) > 2)) { this.moored = null; } // (a submarine going down casts it off)
            else {
                let hx = m.lx, hz = m.lz, hh = m.dh;
                if (H) {
                    const c = Math.cos(H.heading), s = Math.sin(H.heading), P = H.mesh.position;
                    hx = P.x + m.lx * c + m.lz * s; hz = P.z - m.lx * s + m.lz * c; hh = H.heading + m.dh;
                }
                const k = 1 - Math.exp(-6 * dt);
                p.x += (hx - p.x) * k; p.z += (hz - p.z) * k;
                let dh = hh - p.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); p.h += dh * k;
                p.u = p.v = p.r = 0;
                // it still rides the waves (vertical only: it isn't moving through the water)
                p.step(dt, { throttle: 0, steer: 0 });
                if (H) { const vx = H.vel ? H.vel.x : 0, vz = H.vel ? H.vel.z : 0; this.vel.set(vx, p.vy, vz); }
                else this.vel.set(0, p.vy, 0);
                this.place();
                return;
            }
        }
        const input = ctl || { throttle: 0, steer: 0 };
        p.step(dt, input);
        p.velocity(this.vel);
        this.place();
        if (this.rig.wheel) steerWheel(this, p.steer);
        this.effects(dt);
    }

    place() {
        const p = this.phys;
        this.mesh.position.set(p.x, p.y, p.z);
        this.mesh.rotation.set(p.pitch, p.h, p.roll);
        this.heading = p.h;
        this.pos.set(p.x, p.y + this.def.deckY * 0.5, p.z);
    }

    // spray off the chines and the bow, the jets' rooster tail, a burst when it slams down; engines' note
    effects(dt) {
        const g = this.game, fx = g.effects, p = this.phys, S = this.spec;
        const sp = Math.abs(p.u);
        this.rpm = damp(this.rpm, S.idleRpm + (S.maxRpm - S.idleRpm) * Math.abs(p.throttle) * (0.75 + 0.25 * p.immersion), 3, dt);
        if (!fx || !fx.smoke) return;
        const cam = g.camera.position;
        if (cam.distanceToSquared(this.mesh.position) > 1500 * 1500) return;
        this.sprayT -= dt;
        if (this.sprayT <= 0 && sp > 4 && !p.airborne) {
            this.sprayT = 0.06 - 0.03 * p.plane;
            const c = Math.cos(p.h), s = Math.sin(p.h);
            // chine spray: two sheets thrown out and back from a third of the way aft of the bow
            for (const side of [-1, 1]) {
                const lz = -S.L * (0.12 + 0.15 * p.plane), lx = side * S.B * 0.5;
                _v.set(p.x + lx * c + lz * s, p.y + 0.1, p.z - lx * s + lz * c);
                const out = side * (2.5 + sp * 0.18);
                _v2.set(out * c + this.vel.x * 0.55, 1.8 + sp * 0.12, -out * s + this.vel.z * 0.55);
                fx.smoke.emit(_v, _v2, rand(0.6, 1.1), 0.5 + sp * 0.03, 2.2 + sp * 0.12, [0.95, 0.97, 1], [0.86, 0.9, 0.94], 0.5, 0, 1.1, -9);
            }
            // the jets' rooster tail
            if (p.throttle > 0.3 && p.immersion > 0.3) {
                for (const j of ['jet_1', 'jet_2']) {
                    if (!this.rig.points[j]) continue;
                    this.point(j, _v);
                    _v.y = Math.max(_v.y, p.y + 0.1);
                    _v2.set(this.vel.x * 0.35, 3 + p.throttle * 3, this.vel.z * 0.35);
                    fx.smoke.emit(_v, _v2, rand(0.5, 0.9), 0.5, 2.6 + sp * 0.08, [0.96, 0.98, 1], [0.9, 0.93, 0.96], 0.42 * p.throttle, 0, 1.4, -10);
                }
            }
        }
        if (p.slam > 2.2) {
            const k = clamp(p.slam / 6, 0.3, 1.2);
            this.point('hatch_entry', _v); _v.y = p.y + 0.2;
            fx.waterSplash(_v, 0.35 * k);
            if (this.driver) { g.shake = Math.min(1.5, (g.shake || 0) + 0.25 * k); g.audio.thud && g.audio.thud(0.25 * k); }
            p.slam = 0;
        }
        if (p.bump > 1.5) { if (this.driver) { g.shake = Math.min(1.5, (g.shake || 0) + 0.3); g.audio.tick(90, 0.25, 0.25); } p.bump = 0; }
    }

    damage(amount) {
        if (!this.alive) return;
        this.hp -= amount; this.health = this.hp;
        if (this.hp <= 0) {
            this.alive = false;
            this.game.effects.explosion(this.mesh.position.clone().setY(1), 1.2);
            this.game.events.emit('boatLost', this);
        }
    }
    hitTest(p) {
        const dx = p.x - this.phys.x, dz = p.z - this.phys.z, c = Math.cos(this.phys.h), s = Math.sin(this.phys.h);
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        return Math.abs(lx) < this.spec.B / 2 && Math.abs(lz) < this.spec.L / 2 && p.y > this.phys.y - 1 && p.y < this.phys.y + 3;
    }

    remove() {
        this.removed = true;
        this.game.scene.remove(this.mesh);
        if (this.game.naval && this.game.naval.fx) this.game.naval.fx.remove(this);
        if (this.sound) this.sound.stop();
    }
}

// ═════════════ The engines: two diesels, the jets and the water ═════════════
export class BoatSound {
    constructor(audio) {
        this.audio = audio;
        const ctx = audio.ctx;
        this.ok = !!(ctx && audio.world);
        if (!this.ok) return;
        this.out = ctx.createGain(); this.out.gain.value = 0;
        this.out.connect(audio.world);
        // the diesels: two detuned sawtooths at the firing frequency through a lowpass, with a slow flutter
        this.oscs = [0, 1].map(i => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 35 + i; o.start(); return o; });
        this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 400; this.lp.Q.value = 1.2;
        this.dg = ctx.createGain(); this.dg.gain.value = 0.35;
        for (const o of this.oscs) o.connect(this.lp);
        this.lp.connect(this.dg).connect(this.out);
        // the waterjets' whine and the rush of water past the hull
        this.jetF = ctx.createBiquadFilter(); this.jetF.type = 'bandpass'; this.jetF.frequency.value = 1800; this.jetF.Q.value = 3;
        this.jetG = ctx.createGain(); this.jetG.gain.value = 0;
        audio.loop(audio.pink).connect(this.jetF).connect(this.jetG).connect(this.out);
        this.washF = ctx.createBiquadFilter(); this.washF.type = 'bandpass'; this.washF.frequency.value = 600; this.washF.Q.value = 0.6;
        this.washG = ctx.createGain(); this.washG.gain.value = 0;
        audio.loop(audio.pink).connect(this.washF).connect(this.washG).connect(this.out);
    }
    update(boat, near) {
        if (!this.ok || !this.audio.running) return;
        const t = this.audio.ctx.currentTime, S = boat.spec, p = boat.phys;
        const fire = boat.rpm / 60 * S.cyl / 2;
        this.oscs[0].frequency.setTargetAtTime(fire, t, 0.1);
        this.oscs[1].frequency.setTargetAtTime(fire * 1.013, t, 0.1);
        this.lp.frequency.setTargetAtTime(200 + boat.rpm * 0.45, t, 0.1);
        const vol = boat.engineOn ? near : 0;
        this.out.gain.setTargetAtTime(vol * 0.55, t, 0.15);
        this.jetG.gain.setTargetAtTime(0.05 + 0.25 * Math.abs(p.throttle) * p.immersion, t, 0.1);
        this.jetF.frequency.setTargetAtTime(1200 + boat.rpm * 0.4, t, 0.1);
        this.washG.gain.setTargetAtTime(Math.min(0.6, Math.abs(p.u) / 20) * (p.airborne ? 0.2 : 1), t, 0.1);
    }
    stop() { if (this.ok) { try { this.out.disconnect(); for (const o of this.oscs) o.stop(); } catch (e) { /* ignore */ } } this.ok = false; }
}

// ═════════════ The helm: you, driving a boat ═════════════
// W/S throttle (held: ahead / astern; release: idle), A/D steer, SPACE crash stop (both buckets down), V the camera
// (chase / at the wheel), mouse looks round, E steps off where there's somewhere to step (a pier's pontoon, a ship's
// ladder, a surfaced submarine's casing).
export class Helm {
    constructor(sys, boat, plugin) {
        this.sys = sys; this.game = sys.game; this.boat = boat; this.plugin = plugin;
        this.kind = 'boat';
        this.view = 'chase';
        this.look = { yaw: 0, pitch: 0.12 };
        this.ctl = { throttle: 0, steer: 0 };
        this.lever = 0;
        this.camPos = new THREE.Vector3(); this.camInit = false;
        this.near = 0.3;
        this.dock = null;
        this.prevKeys = {};
    }
    press(code) { const d = this.game.input.down(code), p = d && !this.prevKeys[code]; this.prevKeys[code] = d; return p; }

    enter() {
        const b = this.boat;
        b.driver = this; b.castOff(); b.engineOn = true;
        if (!b.sound && this.game.audio.ctx) b.sound = new BoatSound(this.game.audio);
        const pm = this.game.pilotMode;
        if (pm && pm.walker) { pm.walker.character.setPose('seated'); pm.walker.mesh.visible = true; pm.hidden = false; }
        this.game.showBanner(b.name, 'W/S THROTTLE · A/D STEER · SPACE CRASH STOP · V CAMERA · E STEP OFF (AT A PIER, A SHIP\'S LADDER OR A SURFACED SUB)', 5, '#5dffa0');
        this.game.audio.tick(500, 0.15, 0.3);
    }
    exit() {
        const b = this.boat;
        b.driver = null;
        const pm = this.game.pilotMode;
        if (pm && pm.walker) pm.walker.character.setPose(null);
        if (b.sound) b.sound.update(b, 0);
    }

    control(dt, mouse) {
        const g = this.game, input = g.input, b = this.boat;
        const sens = 0.0022 * (g.settings.sensitivity || 1);
        this.look.yaw -= mouse.dx * sens;
        this.look.pitch = clamp(this.look.pitch + mouse.dy * sens * (g.settings.invertPitch ? -1 : 1) * (this.view === 'helm' ? -1 : 1), this.view === 'helm' ? -0.9 : -0.25, this.view === 'helm' ? 0.9 : 1.1);
        if (mouse.dx || mouse.dy) this.lookT = 1.5;
        this.lookT = (this.lookT || 0) - dt;
        if (this.lookT < 0 && this.view === 'chase') this.look.yaw = damp(this.look.yaw, 0, 1.5, dt);
        const fwd = input.down('KeyW', 'ArrowUp'), back = input.down('KeyS', 'ArrowDown');
        const crash = input.down('Space');
        this.ctl.throttle = crash ? -1 : fwd ? 1 : back ? -0.6 : 0;
        this.ctl.steer = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
        if (mouse.wheel && this.view === 'chase') this.zoom = clamp((this.zoom || 1) * (1 + mouse.wheel * 0.1), 0.5, 2.5);
        this.dock = this.plugin.dockNear(b);
        if (this.press('KeyE')) {
            if (this.dock && this.dock.ok) this.plugin.stepOff(b, this.dock);
            else g.addFeed(this.dock ? this.dock.why : 'NOTHING TO STEP ONTO HERE — COME ALONGSIDE A PIER, A SHIP\'S LADDER OR A SURFACED SUB', '#ffc23f');
        }
    }

    // the man at the wheel rides along (for everyone who cares where the player is)
    carry(pm) {
        const b = this.boat;
        const seat = b.rig.seats.driver;
        if (seat) { seat.updateWorldMatrix(true, false); _v.setFromMatrixPosition(seat.matrixWorld); } else _v.copy(b.mesh.position).setY(b.mesh.position.y + 1);
        pm.seat.root.position.copy(_v).setY(_v.y + 0.3);
        pm.yaw = b.heading + this.look.yaw;
        if (pm.walker) {
            const m = pm.walker.mesh;
            m.position.copy(_v);
            if (seat) seat.getWorldQuaternion(m.quaternion); else m.quaternion.setFromEuler(_e.set(0, b.heading, 0));
            m.visible = this.view === 'chase';
        }
    }

    tick(dt) {
        const b = this.boat;
        b.update(dt, this.ctl);
        if (b.sound) b.sound.update(b, 1);
    }

    camera(cam, dt) {
        const b = this.boat, p = b.phys, S = b.spec;
        if (this.view === 'helm') {
            const seat = b.rig.seats.driver;
            if (seat) { seat.updateWorldMatrix(true, false); _v.setFromMatrixPosition(seat.matrixWorld); } else _v.copy(b.mesh.position);
            _v2.set(0, S.eye, 0).applyQuaternion(b.mesh.quaternion);
            cam.position.copy(_v).add(_v2);
            cam.quaternion.copy(b.mesh.quaternion).multiply(_q.setFromEuler(_e.set(this.look.pitch, this.look.yaw, 0, 'YXZ')));
            cam.fov = damp(cam.fov, 72, 6, dt);
            cam.updateProjectionMatrix();
            this.camInit = false;
            return;
        }
        // chase: behind and above, lagging a little, never under the waves
        const k = this.zoom || 1;
        const dist = (S.L * 1.25 + 6) * k, h = (S.L * 0.35 + 2.2) * k;
        const yaw = b.heading + this.look.yaw, pitch = this.look.pitch;
        const tgt = _v.copy(b.mesh.position); tgt.y = Math.max(p.y, 0) + 1.6;
        const want = _v2.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + h, Math.cos(yaw) * Math.cos(pitch) * dist).add(tgt);
        const wh = Math.max(terrainHeight(want.x, want.z), 0) + 1.2;
        if (want.y < wh) want.y = wh;
        if (!this.camInit) { this.camPos.copy(want); this.camInit = true; } else this.camPos.lerp(want, 1 - Math.exp(-7 * dt));
        cam.position.copy(this.camPos);
        cam.up.set(0, 1, 0);
        cam.lookAt(tgt.addScaledVector(_v3.set(-Math.sin(b.heading), 0, -Math.cos(b.heading)), S.L * 0.4));
        const sp = Math.abs(p.u);
        cam.fov = damp(cam.fov, 62 + clamp(sp / S.top, 0, 1) * 10, 3, dt);
        cam.updateProjectionMatrix();
    }

    action(a) {
        if (a === 'camera') { this.view = this.view === 'chase' ? 'helm' : 'chase'; this.look.yaw = 0; this.look.pitch = this.view === 'helm' ? 0 : 0.12; return true; }
        if (['designate', 'photo', 'flares', 'flaps', 'weapon', 'loadout', 'confirm', 'target', 'missile', 'gear', 'hook', 'eject', 'spoilers', 'autoland', 'autotakeoff', 'spawn', 'nvg'].includes(a)) return true;
        return false;
    }

    hud(ctx, hud) {
        const g = this.game, b = this.boat, p = b.phys, S = b.spec, W = hud.w, H = hud.h, C = hud.compact;
        const F = '"Share Tech Mono", ui-monospace, monospace';
        ctx.save();
        ctx.textBaseline = 'middle';
        const M = C ? 14 : 28;
        // speed, throttle, heading
        ctx.textAlign = 'right';
        ctx.font = '700 ' + (C ? 30 : 42) + 'px ' + F; ctx.fillStyle = '#fff';
        ctx.fillText(Math.round(Math.abs(p.u) * KT), W - M - 46, H - (C ? 44 : 60));
        ctx.font = '600 ' + (C ? 12 : 14) + 'px ' + F; ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText('KT', W - M, H - (C ? 40 : 56));
        const hdg = Math.round(((-b.heading * 180 / Math.PI) % 360 + 360) % 360);
        ctx.fillText('HDG ' + String(hdg).padStart(3, '0') + '°  ' + Math.round(b.rpm) + ' RPM', W - M, H - (C ? 18 : 26));
        const state = p.airborne ? 'AIRBORNE' : p.grounded ? 'AGROUND' : p.plane > 0.8 ? 'ON THE PLANE' : Math.abs(p.u) > S.hump * 0.6 ? 'CLIMBING THE HUMP' : Math.abs(p.u) > 0.5 ? 'DISPLACEMENT' : 'STOPPED';
        ctx.fillStyle = p.grounded ? '#ffc23f' : '#9fd4ff';
        ctx.fillText(state, W - M, H - (C ? 76 : 100));
        // throttle bar: astern below the line, ahead above
        const bx = W - M - 8, by = H - (C ? 150 : 200), bh = C ? 60 : 80;
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(bx - 6, by - bh / 2, 12, bh);
        ctx.fillStyle = p.throttle >= 0 ? '#5dffa0' : '#ffc23f';
        const th = p.throttle * bh / 2;
        ctx.fillRect(bx - 5, th >= 0 ? by - th : by, 10, Math.abs(th));
        ctx.fillStyle = '#fff'; ctx.fillRect(bx - 8, by - 0.5, 16, 1);
        // name, keys, the dock prompt
        ctx.textAlign = 'left';
        ctx.font = '700 ' + (C ? 13 : 16) + 'px ' + F; ctx.fillStyle = '#e8f4ff';
        ctx.fillText(b.name, M, C ? 22 : 34);
        ctx.font = '600 ' + (C ? 10 : 12) + 'px ' + F; ctx.fillStyle = 'rgba(255,255,255,0.68)';
        ctx.fillText('W/S THROTTLE · A/D STEER · SPACE CRASH STOP · V CAMERA · MOUSE LOOK · E STEP OFF', M, H - (C ? 20 : 30), W * 0.62);
        if (this.dock) {
            ctx.textAlign = 'center'; ctx.font = '700 ' + (C ? 13 : 16) + 'px ' + F;
            ctx.fillStyle = this.dock.ok ? '#ffc23f' : 'rgba(255,194,63,0.6)';
            ctx.fillText(this.dock.ok ? 'E — ' + this.dock.label : this.dock.why, W / 2, H * 0.68);
        }
        ctx.restore();
        void g;
    }
}

// ═════════════ The harbour: a small-craft pier near the home base ═════════════
// A concrete pier from the shore out into deep water (found once on the coast nearest the base), a floating pontoon
// on its south side with a hinged gangway down to it, bollards, fenders, lamp posts, ladders and a harbour office;
// the pier deck, the pontoon (it rides the swell) and the gangway are walkable (game.platforms).
export function findPierSite(home = { x: 0, z: 0 }, TH = terrainHeight) {
    let best = null;
    for (let dz = -900; dz <= 900; dz += 150) {
        // march west from the base to the shore
        let sx = null;
        for (let x = home.x - 200; x > home.x - 6000; x -= 20) if (TH(x, home.z + dz) < 0) { sx = x; break; }
        if (sx === null) continue;
        const z = home.z + dz;
        // which way the bottom drops fastest from here
        let dir = null;
        for (let a = 0; a < 24; a++) {
            const ang = a / 24 * Math.PI * 2, ux = Math.cos(ang), uz = Math.sin(ang);
            let deep = -1;
            for (let d = 10; d <= 220; d += 10) if (TH(sx + ux * d, z + uz * d) < -9) { deep = d; break; }
            if (deep < 0) continue;
            // (and the pier mustn't cross land again)
            let dry = false;
            for (let d = 10; d < deep; d += 10) if (TH(sx + ux * d, z + uz * d) > -0.3) dry = true;
            if (dry) continue;
            if (!dir || deep < dir.deep) dir = { ux, uz, deep };
        }
        if (!dir) continue;
        const score = dir.deep + Math.abs(dz) * 0.08;
        if (!best || score < best.score) best = { score, x: sx, z, ux: dir.ux, uz: dir.uz, len: clamp(dir.deep + 30, 60, 150) };
    }
    return best;
}

const MAT = {};
function mat(key, color, rough = 0.85, metal = 0) {
    return MAT[key] || (MAT[key] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
}

export class Harbor {
    constructor(game, site) {
        this.game = game;
        this.site = site;
        const { x, z, ux, uz, len } = site;
        this.root = { x: x - ux * 14, z: z - uz * 14 };     // the pier starts on the land
        this.dir = { x: ux, z: uz };
        this.len = len + 14;
        this.yaw = Math.atan2(ux, uz);                        // local +z runs out along the pier
        this.W = 8; this.deckY = 2.6;
        this.group = new THREE.Group();
        this.group.name = 'harbor';
        this.group.position.set(this.root.x, 0, this.root.z);
        this.group.rotation.y = this.yaw;
        this.build();
        game.scene.add(this.group);
        this.group.updateMatrixWorld(true);
        // the pontoon rides the swell: its own group (along the pier's south side, the outer half)
        this.pont = { a: this.len * 0.52, b: this.len * 0.92, off: this.W / 2 + 4.2, w: 3.4 };
        this.buildPontoon();
        this.surf = { h: 0, ship: null, water: false, runway: null, hull: false, bridge: true, vessel: null, platform: this };
        this.platform = { at: (px, pz, py) => this.surfaceAt(px, pz, py) };
        (game.platforms || (game.platforms = [])).push(this.platform);
        this.slots = [
            { id: 'A', t: 0.35, type: 'rhib', boat: null },
            { id: 'B', t: 0.82, type: 'cb90', boat: null },
        ];
    }

    // pier-local (lx across, lz out along) ↔ world
    toWorld(lx, lz, out) {
        const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
        return out.set(this.root.x + lx * c + lz * s, 0, this.root.z - lx * s + lz * c);
    }
    toLocal(x, z) {
        const dx = x - this.root.x, dz = z - this.root.z, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
        return { lx: dx * c - dz * s, lz: dx * s + dz * c };
    }

    // walkable: the deck, the gangway (a ramp) and the pontoon
    surfaceAt(x, z, y = 1e9) {
        const l = this.toLocal(x, z);
        if (l.lz < -1 || l.lz > this.len + 12) return null;
        const r = this.surf;
        if (Math.abs(l.lx) <= this.W / 2 && l.lz <= this.len) { if (y < this.deckY - 3) return null; r.h = this.deckY; return r; }
        const P = this.pont, py = this.pontY;
        const side = -1; // (the pontoon lies on the pier's −x side)
        const gx0 = this.W / 2, gx1 = P.off - P.w / 2;
        const gz = this.gangZ;
        if (side * l.lx >= gx0 - 0.2 && side * l.lx <= gx1 + 0.3 && Math.abs(l.lz - gz) <= 0.8) {
            const t = clamp((side * l.lx - gx0) / (gx1 - gx0), 0, 1);
            r.h = this.deckY + (py - this.deckY) * t; return r;
        }
        if (Math.abs(side * l.lx - P.off) <= P.w / 2 && l.lz >= P.a && l.lz <= P.b) { if (y < py - 3) return null; r.h = py; return r; }
        return null;
    }

    build() {
        const g = this.group, L = this.len, W = this.W, Y = this.deckY;
        const conc = mat('conc', 0x8d8a82, 0.92), dark = mat('dark', 0x2c2d2f, 0.8), steel = mat('steel', 0x5a5f64, 0.5, 0.6);
        const yellow = mat('yellow', 0xd9b429, 0.6), rubber = mat('rubber', 0x151515, 0.9), white = mat('white', 0xdedcd4, 0.7);
        const geos = new Map();
        const put = (m, geo, x, y, z, ry = 0) => {
            if (ry) geo.rotateY(ry);
            geo.translate(x, y, z);
            if (!geos.has(m)) geos.set(m, []);
            geos.get(m).push(geo);
        };
        // deck slab with a curb along both edges (yellow-painted), on concrete pile caps and piles
        put(conc, new THREE.BoxGeometry(W, 0.55, L), 0, Y - 0.275, L / 2);
        for (const sx of [-1, 1]) {
            put(yellow, new THREE.BoxGeometry(0.28, 0.22, L), sx * (W / 2 - 0.14), Y + 0.11, L / 2);
            put(dark, new THREE.BoxGeometry(0.35, 0.5, L), sx * (W / 2 + 0.05), Y - 0.6, L / 2); // edge beam
        }
        for (let lz = 6; lz <= L; lz += 8) {
            _v.set(0, 0, 0); this.toWorld(0, lz, _v);
            const bed = Math.min(terrainHeight(_v.x, _v.z), 0);
            const h = Y - 0.5 - bed + 1;
            for (const sx of [-1, 0, 1]) put(conc, new THREE.BoxGeometry(0.6, h, 0.6), sx * (W / 2 - 0.6), Y - 0.5 - h / 2, lz);
            put(conc, new THREE.BoxGeometry(W - 0.4, 0.5, 0.9), 0, Y - 0.8, lz); // cap beam
        }
        // bollards and fenders, lamp posts, ladders, life rings
        for (let lz = 18; lz <= L - 2; lz += 12) {
            for (const sx of [-1, 1]) {
                put(dark, new THREE.CylinderGeometry(0.2, 0.24, 0.55, 10), sx * (W / 2 - 0.55), Y + 0.27, lz);
                put(dark, new THREE.CylinderGeometry(0.3, 0.3, 0.1, 10), sx * (W / 2 - 0.55), Y + 0.58, lz);
                put(rubber, new THREE.CylinderGeometry(0.28, 0.28, 2.2, 10), sx * (W / 2 + 0.35), Y - 1.2, lz + 6);
            }
        }
        for (let lz = 20; lz <= L; lz += 24) {
            const sx = lz % 48 < 24 ? 1 : -1;
            put(steel, new THREE.CylinderGeometry(0.08, 0.11, 6, 8), sx * (W / 2 - 0.3), Y + 3, lz);
            put(steel, new THREE.BoxGeometry(0.9, 0.08, 0.14), sx * (W / 2 - 0.65), Y + 6, lz);
            put(white, new THREE.BoxGeometry(0.5, 0.14, 0.3), sx * (W / 2 - 1.05), Y + 5.92, lz);
        }
        for (const lz of [30, L - 6]) for (const sx of [-1, 1]) {
            for (let k = 0; k < 7; k++) put(steel, new THREE.BoxGeometry(0.5, 0.04, 0.04), sx * (W / 2 + 0.05), Y - 0.35 - k * 0.32, lz);
            for (const dx of [-0.25, 0.25]) put(steel, new THREE.BoxGeometry(0.05, 2.4, 0.05), sx * (W / 2 + 0.05), Y - 1.1, lz + dx);
        }
        // railing on the shore end, a harbour office and a sign
        for (const sx of [-1, 1]) for (let lz = 0; lz < 14; lz += 2) put(steel, new THREE.BoxGeometry(0.05, 1.05, 0.05), sx * (W / 2 - 0.1), Y + 0.52, lz);
        for (const sx of [-1, 1]) put(steel, new THREE.BoxGeometry(0.05, 0.05, 14), sx * (W / 2 - 0.1), Y + 1.05, 7);
        put(white, new THREE.BoxGeometry(4.2, 2.8, 3.2), W / 2 + 3.6, 1.4 + Math.max(terrainHeight(this.root.x, this.root.z), 0), 4);
        for (const [m, list] of geos) {
            const merged = new THREE.Mesh(mergeAll(list), m);
            merged.castShadow = true; merged.receiveShadow = true;
            g.add(merged);
        }
        // the pier's name board
        const sign = signMesh('SMALL CRAFT PIER · SKYWAR NAVAL STATION', 5.2, 0.7);
        sign.position.set(0, Y + 2.4, 1.5); sign.rotation.y = Math.PI;
        g.add(sign);
        for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), steel); post.position.set(sx * 2.4, Y + 1.3, 1.5); g.add(post); }
    }

    buildPontoon() {
        const P = this.pont, conc = mat('pont', 0x6f6d68, 0.9), rubber = mat('rubber', 0x151515, 0.9), steel = mat('steel', 0x5a5f64, 0.5, 0.6), grate = mat('grate', 0x3d4145, 0.7, 0.4);
        const g = this.pontG = new THREE.Group();
        const len = P.b - P.a;
        const geos = [], rub = [], st = [];
        const deck = new THREE.BoxGeometry(P.w, 0.7, len); deck.translate(0, -0.35, len / 2); geos.push(deck);
        for (let k = 0; k < len; k += 3.5) { const f = new THREE.CylinderGeometry(0.22, 0.22, 3.2, 8); f.rotateX(Math.PI / 2); f.translate(-P.w / 2 - 0.2, -0.2, k + 1.75); rub.push(f); }
        for (let k = 3; k < len; k += 8) { const b = new THREE.CylinderGeometry(0.14, 0.16, 0.4, 8); b.translate(-P.w / 2 + 0.35, 0.2, k); st.push(b); }
        g.add(new THREE.Mesh(mergeAll(geos), conc), new THREE.Mesh(mergeAll(rub), rubber), new THREE.Mesh(mergeAll(st), steel));
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.group.add(g);
        g.position.set(-P.off, 0, P.a);
        // the gangway: a ramp with side rails, pivoting on the pier edge
        this.gangZ = P.a + len * 0.45;
        const gw = this.gang = new THREE.Group();
        const run = P.off - P.w / 2 - this.W / 2;
        const ramp = new THREE.Mesh(new THREE.BoxGeometry(run + 0.4, 0.1, 1.3), grate);
        ramp.position.x = -(run + 0.4) / 2;
        gw.add(ramp);
        for (const sz of [-0.62, 0.62]) { const rl = new THREE.Mesh(new THREE.BoxGeometry(run + 0.4, 0.05, 0.05), steel); rl.position.set(-(run + 0.4) / 2, 1.0, sz); gw.add(rl); }
        gw.position.set(-this.W / 2, this.deckY, this.gangZ);
        this.group.add(gw);
        this.gangRun = run;
        this.pontY = 0.4;
    }

    // the pontoon and the gangway follow the swell
    update(dt) {
        const P = this.pont;
        this.toWorld(-P.off, (P.a + P.b) / 2, _v);
        const h = waterSample(_v.x, _v.z, WATER.t, _W).h;
        this.pontY = damp(this.pontY ?? h + 0.35, h + 0.35, 3, dt);
        this.pontG.position.y = this.pontY;
        const drop = this.deckY - this.pontY;
        this.gang.rotation.z = Math.atan2(drop, this.gangRun);
        this.gang.children[0].scale.x = Math.hypot(this.gangRun, drop) / this.gangRun;
    }

    // world position of slot i's boat (alongside the pontoon's outer edge) and its heading
    slotPose(slot, B) {
        const P = this.pont;
        const lz = P.a + (P.b - P.a) * slot.t;
        const lx = -(P.off + P.w / 2 + B / 2 + 0.55);
        const w = this.toWorld(lx, lz, new THREE.Vector3());
        return { x: w.x, z: w.z, heading: this.yaw + Math.PI }; // bow toward the shore
    }
    // where you stand on the pontoon beside a slot
    slotStep(slot, out) {
        const P = this.pont;
        const lz = P.a + (P.b - P.a) * slot.t;
        return this.toWorld(-(P.off + P.w / 2 - 0.9), lz, out).setY(this.pontY);
    }

    // hulls against the pier and the pontoon (boats.js BoatPhysics.collide)
    collide(x, z, r) {
        const l = this.toLocal(x, z);
        const boxes = [[-this.W / 2, this.W / 2, -2, this.len], [-this.pont.off - this.pont.w / 2, -this.pont.off + this.pont.w / 2, this.pont.a, this.pont.b]];
        for (const [x0, x1, z0, z1] of boxes) {
            const cx = clamp(l.lx, x0, x1), cz = clamp(l.lz, z0, z1);
            const dx = l.lx - cx, dz = l.lz - cz, d = Math.hypot(dx, dz);
            if (d < r) {
                let nx = dx, nz = dz, n = d;
                if (d < 1e-3) { nx = l.lx < (x0 + x1) / 2 ? -1 : 1; nz = 0; n = 1; }
                nx /= n; nz /= n;
                const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
                return { nx: nx * c + nz * s, nz: -nx * s + nz * c, d: r - d };
            }
        }
        return null;
    }

    dispose() {
        const g = this.game;
        g.scene.remove(this.group);
        if (g.platforms) { const i = g.platforms.indexOf(this.platform); if (i >= 0) g.platforms.splice(i, 1); }
    }
}

// merge a list of (non-indexed or indexed) geometries into one (position + normal only)
function mergeAll(list) {
    const parts = list.map(gg => { const n = gg.index ? gg.toNonIndexed() : gg; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; });
    let count = 0;
    for (const p of parts) count += p.attributes.position.count;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    let o = 0;
    for (const p of parts) { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); o += p.attributes.position.count; }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.computeBoundingSphere();
    return out;
}

// a painted sign board (a canvas texture; plain grey without a DOM)
function signMesh(text, w, h) {
    let map = null;
    if (typeof document !== 'undefined' && document.createElement) {
        const c = document.createElement('canvas');
        c.width = 1024; c.height = Math.round(1024 * h / w);
        const ctx = c.getContext('2d');
        if (ctx && ctx.fillRect) {
            ctx.fillStyle = '#1d3350'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.strokeStyle = '#e8e4d8'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, c.width - 20, c.height - 20);
            ctx.fillStyle = '#f2efe6'; ctx.font = 'bold ' + Math.round(c.height * 0.42) + 'px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(text, c.width / 2, c.height / 2, c.width - 60);
            map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
        }
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : 0x1d3350, roughness: 0.7, side: THREE.DoubleSide }));
    return m;
}

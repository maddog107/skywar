// ═══════════════════════════════════════════════════════════════
// Mobile forces, the vehicles (forces.js): one ForceVehicle per rigged truck, TEL, launcher, radar or APC.
//  • the unit interface every war system uses (docs/WAR.md): pos, team, alive, name (what our side calls it),
//    radius, damage(), cls / conceal / hardened for the war layer, route.speed and mesh for the targeting pod
//  • it drives a Route (forcesnav.js): accelerates, brakes for bends and crests, crawls up hills, follows the
//    vehicle ahead in a column, reverses into a hide; its body pitches and rolls with the ground or the road's
//    banking, the wheels turn and steer, and it throws up dust across country
//  • its rig pose (jacks, pad, erector, masts, doors, launcher aim) is state here: animations run whether or not
//    anyone sees them, and the mesh shows them — a live rig close in, a merged static copy further out, nothing
//    beyond ~7 km (forces.js decides, within a budget)
//  • when it's destroyed it burns: fireball by what it carried (a fuelled missile, a fuel tank, ammunition that
//    cooks off), parts thrown, a charred wreck that smokes for a minute or two
// VehicleLauncher (a strikes.js GroundLauncher) makes a vehicle a launch source whose countdown waits for the
// vehicle to be ready (driven to its firing point, jacked, erected, aimed).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { VEHICLES, setJoint, updateRams, spin as spinRig, roll as rollRig, steer as steerRig, muzzleWorld, stow as stowRig } from './vehicles.js';
import { GroundLauncher, MISSILES } from './strikes.js';
import { terrainHeight } from './world.js';
import { roadLiftAt } from './roads.js';
import { craterAdj } from './craters.js';
import { INTEL } from './war.js';
import { clamp, rand } from './util.js';

// ── What each vehicle is, for the game: its war class, a ground.js-style type (sensors / infantry / small arms read
// it), hit points, score, cruise speeds (m/s: on the road, across country), acceleration, what it carries (the
// fireball when it goes up), the label our side uses once it's identified. Speeds from the real vehicles: a
// MAZ-543 does 60 km/h on a road and ~20 across country, a Ural 75 / 30, tracked Buk and M270 ~60 / 35.
export const UNIT = {
    scud: { cls: 'tel', type: 'tel', hp: 90, score: 600, road: 14, off: 5.5, accel: 0.5, carry: 'missile', label: 'SS-1C SCUD-B TEL', crew: 4 },
    bastion: { cls: 'tel', type: 'tel', hp: 95, score: 500, road: 16, off: 6, accel: 0.55, carry: 'missile', label: 'SSC-5 BASTION LAUNCHER', crew: 3 },
    s300: { cls: 'sam', type: 'sam', hp: 80, score: 350, road: 14, off: 5.5, accel: 0.5, carry: 'missile', label: 'SA-10 GRUMBLE LAUNCHER', crew: 4 },
    flaplid: { cls: 'sam-radar', type: 'radar', hp: 80, score: 450, road: 14, off: 5.5, accel: 0.5, carry: 'fuel', label: 'SA-10 FLAP LID RADAR', crew: 4 },
    p18: { cls: 'radar', type: 'radar', hp: 60, score: 250, road: 17, off: 7, accel: 0.7, carry: 'fuel', label: 'SPOON REST RADAR', crew: 4 },
    buk: { cls: 'sam', type: 'tank', hp: 110, score: 400, road: 15, off: 9, accel: 0.8, carry: 'missile', label: 'SA-11 GADFLY TELAR', crew: 4 },
    osa: { cls: 'sam', type: 'sam', hp: 70, score: 300, road: 17, off: 8, accel: 0.8, carry: 'missile', label: 'SA-8 GECKO TELAR', crew: 5 },
    grad: { cls: 'artillery', type: 'truck', hp: 60, score: 250, road: 18, off: 7, accel: 0.75, carry: 'rockets', label: 'BM-21 GRAD LAUNCHER', crew: 3 },
    smerch: { cls: 'artillery', type: 'truck', hp: 80, score: 350, road: 15, off: 6, accel: 0.5, carry: 'rockets', label: 'BM-30 SMERCH LAUNCHER', crew: 4 },
    cmd_red: { cls: 'command', type: 'truck', hp: 60, score: 300, road: 18, off: 7, accel: 0.75, carry: 'fuel', label: 'COMMAND POST (KSHM)', crew: 7 },
    fuel_red: { cls: 'vehicle', type: 'fueltruck', hp: 45, score: 120, road: 18, off: 7, accel: 0.7, carry: 'fuel', label: 'FUEL TANKER', crew: 2 },
    ammo_red: { cls: 'vehicle', type: 'truck', hp: 55, score: 150, road: 18, off: 7, accel: 0.7, carry: 'ammo', label: 'AMMUNITION TRUCK', crew: 2 },
    crane: { cls: 'vehicle', type: 'truck', hp: 60, score: 150, road: 16, off: 6, accel: 0.6, carry: 'fuel', label: 'MISSILE TRANSLOADER', crew: 2 },
    btr80: { cls: 'vehicle', type: 'tank', hp: 110, score: 200, road: 20, off: 9, accel: 1.0, carry: 'ammo', label: 'BTR-80 APC', crew: 3, troops: 7 },
    himars: { cls: 'artillery', type: 'truck', hp: 70, score: 350, road: 20, off: 8, accel: 0.8, carry: 'rockets', label: 'M142 HIMARS', crew: 3 },
    m270: { cls: 'artillery', type: 'tank', hp: 120, score: 400, road: 16, off: 10, accel: 0.8, carry: 'rockets', label: 'M270 MLRS', crew: 3 },
    patriot_ln: { cls: 'sam', type: 'sam', hp: 70, score: 350, road: 16, off: 6, accel: 0.5, carry: 'missile', label: 'PATRIOT LAUNCHER', crew: 3 },
    patriot_radar: { cls: 'sam-radar', type: 'radar', hp: 80, score: 450, road: 16, off: 6, accel: 0.5, carry: 'fuel', label: 'PATRIOT AN/MPQ-65 RADAR', crew: 0 },
    sentinel: { cls: 'radar', type: 'radar', hp: 40, score: 200, road: 20, off: 8, accel: 0.8, carry: null, label: 'SENTINEL RADAR', crew: 3 },
    cmd_blue: { cls: 'command', type: 'humvee', hp: 50, score: 250, road: 22, off: 10, accel: 1.1, carry: 'fuel', label: 'COMMAND HMMWV', crew: 4 },
    hemtt: { cls: 'vehicle', type: 'truck', hp: 60, score: 150, road: 20, off: 8, accel: 0.8, carry: 'fuel', label: 'HEMTT TRACTOR', crew: 2 },
    fuel_blue: { cls: 'vehicle', type: 'fueltruck', hp: 50, score: 150, road: 20, off: 8, accel: 0.75, carry: 'fuel', label: 'HEMTT FUELER', crew: 2 },
    ammo_blue: { cls: 'vehicle', type: 'truck', hp: 60, score: 180, road: 20, off: 8, accel: 0.75, carry: 'ammo', label: 'HEMTT MISSILE TRANSPORTER', crew: 2 },
    stryker: { cls: 'vehicle', type: 'tank', hp: 120, score: 250, road: 22, off: 10, accel: 1.0, carry: 'ammo', label: 'M1126 STRYKER', crew: 2, troops: 9 },
};

// the rig's pose groups, in a fixed order (static copies are keyed by which are up)
export const GROUPS = ['jack', 'pad', 'raise', 'door', 'hatch', 'gear', 'side', 'launcher'];

// ── extra missiles for the strike manager (strikes.js MISSILES): the Smerch's 300 mm rocket and the Bastion's
// P-800 Oniks. A Grad fires 0.5 s apart (a 40-round salvo in 20 s), a Smerch 3 s (12 in 38 s), GMLRS ~1 s.
if (!MISSILES.smerch) MISSILES.smerch = { kind: 'rocket', name: '9M55 SMERCH', short: 'SMERCH', count: 12, warhead: 190, blast: 26, hard: 0.2, len: 7.6, dia: 0.3, color: 0x4a5236, nose: 0x2a2e22, spread: 170 };
if (!MISSILES.oniks) MISSILES.oniks = { kind: 'antiship', name: 'P-800 ONIKS', short: 'ONIKS', speed: 520, alt: 14, seaAlt: 11, boost: 5, warhead: 430, blast: 24, hard: 0.35, len: 8.9, dia: 0.72, span: 1.7, color: 0x8e958a, nose: 0x3a3d3a };
export const RIPPLE = { grad: 0.5, smerch: 2.6, gmlrs: 1.2 };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _pf = {}, _pr = {}, _pc = {};
const _ds = { h: 0, nx: 0, ny: 1, nz: 0 };
const CHARRED = new THREE.MeshStandardMaterial({ color: 0x17140f, roughness: 1, metalness: 0.15 });
const SCORCHED = new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 0.95, metalness: 0.25 });
export const WRECK_MATERIALS = [CHARRED, SCORCHED];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t) => t * t * (3 - 2 * t);

export function paintFor(vid, team) {
    const p = VEHICLES[vid] ? VEHICLES[vid].paint : 'red_green';
    if (team === 'blue') return /^blue/.test(p) ? p : 'blue_tan';
    return /^red/.test(p) ? p : 'red_green';
}

// ═════════════ A vehicle ═════════════
export class ForceVehicle {
    // sys: the MobileForces system; vid: a VEHICLES key; opts: { name, heading, hp, conceal, paint }
    constructor(sys, vid, team, at, opts = {}) {
        this.sys = sys; this.game = sys.game;
        this.vid = vid; this.spec = VEHICLES[vid]; this.u = UNIT[vid];
        if (!this.spec || !this.u) throw new Error('[forces] unknown vehicle ' + vid);
        this.team = team;
        this.paint = opts.paint || paintFor(vid, team);
        this.realName = opts.name || this.u.label;
        const d = this.spec.dims;
        this.L = d.length; this.W = d.width; this.H = d.height;
        this.pos = new THREE.Vector3(); this.center = this.pos;
        this.vel = new THREE.Vector3();
        this.heading = opts.heading ?? 0; this.pitch = 0; this.roll = 0;
        this.radius = Math.max(this.L * 0.5, 3.2); this.hitRadius = this.radius;
        this.hp = this.maxHp = this.health = this.maxHealth = opts.hp ?? this.u.hp;
        this.alive = true; this.removed = false;
        this.isGround = true;
        this.cls = opts.cls || this.u.cls;
        this.type = this.u.type;
        this.def = { name: this.realName, score: this.u.score, boom: 1.2 };
        this.conceal = opts.conceal ?? 0.2;
        this.hardened = opts.hardened ?? (this.u.type === 'tank' ? 0.3 : 0);
        this.incoming = [];
        this.firingT = null; this.burnT = 0; this.smokeT = 0; this.lastKind = null;
        // drive state (ground.js convention: a unit with a route moves; sensors.js reads route.speed)
        this.route = { r: null, s: 0, i: 0, speed: 0, cap: Infinity, lead: null, gap: 0, onArrive: null, hold: false };
        this.base = new THREE.Vector3();    // where the wheels are (the ground under the vehicle's centre)
        this.liftK = 0;                     // how much of the road's distance lift applies (1 on a road, 0 off it)
        // pose (rig groups 0..1), launcher aim, missiles aboard (bit i: missile / canister i still there)
        this.state = {}; for (const g of GROUPS) this.state[g] = 0;
        this.aimYaw = 0; this.aimPitch = 0;
        this.spinning = false;              // radar antennas turning
        this.loaded = opts.loaded ?? 0xff;  // missiles on the rails (mask)
        this.anim = [];
        this.animT = 0;
        // the mesh: a root that's in the scene only while a copy is shown (forces.js LOD)
        this.mesh = new THREE.Group();
        this.mesh.name = 'force:' + vid;
        this.mesh.rotation.order = 'YXZ'; // (rotation.y stays the heading: sensors.js reads it)
        this.lod = 0; this.copy = null; this.copyKey = ''; this.live = null;
        this.applied = {};                  // what the live rig was last posed to
        this.ctrl = null;                   // the TEL / SAM group / battery / convoy running it
        this.dustT = 0; this.placeT = 0;
        this.parked = true;
        this.tick = 0;
        this.setPos(at.x, at.z);
    }

    // ═════════════ The war layer's view ═════════════
    // what our side calls it (its real name once identified): the HUD labels ground targets by name
    get name() { const w = this.game.war; return w && w.rec(this) ? w.label(this) : this.realName; }
    set name(v) { this.realName = v; }
    // the HUD and the lock cycle skip enemies nobody has found yet, and friendly vehicles far off
    get hidden() {
        const w = this.game.war;
        if (!w || !w.enabled) return false;
        if (this.team === w.side) return this.game.camera && this.pos.distanceToSquared(this.game.camera.position) > 4000 * 4000;
        return w.known(this) < INTEL.CONTACT;
    }
    setConceal(c) {
        this.conceal = c;
        const r = this.game.war && this.game.war.rec(this);
        if (r) r.conceal = c;
    }
    update() { /* (ground.js calls this every frame: the forces system ticks its own vehicles) */ }

    // ═════════════ Placing and driving ═════════════
    setPos(x, z, heading = this.heading) {
        this.heading = heading;
        const h = this.groundAt(x, z);
        this.base.set(x, h, z);
        this.pos.set(x, h + this.H * 0.42, z);
        this.liftK = 0; this.onRoad = false;
        this.syncMesh();
    }

    groundAt(x, z) {
        const g = this.game;
        if (g.surfaceAt) return g.surfaceAt(x, z, 1e9).h;
        return Math.max(terrainHeight(x, z), 0);
    }

    // start driving a Route. opts: { cap (m/s), lead (vehicle ahead on the same route), gap (m behind it),
    // onArrive(v), s (start at this arc length) }
    drive(r, opts = {}) {
        const R = this.route;
        R.r = r; R.s = opts.s ?? 0; R.i = 0; R.cap = opts.cap ?? Infinity; R.lead = opts.lead || null; R.gap = opts.gap ?? 45;
        R.onArrive = opts.onArrive || null; R.hold = false; R.end = opts.end ?? r.len;
        this.parked = false;
        return this;
    }
    stop() { const R = this.route; R.r = null; R.speed = 0; R.lead = null; this.vel.set(0, 0, 0); this.parked = true; }
    get moving() { return !!this.route.r; }

    // seconds left to the end of the current route at this vehicle's speeds (the route's limits, its own road and
    // cross-country speeds, the column's cap): cumulative times cached on the route for this vehicle type
    driveTime() {
        const R = this.route, r = R.r;
        if (!r) return 0;
        const key = this.vid + ':' + (R.cap === Infinity ? 0 : R.cap);
        if (!r._t || r._t.key !== key) {
            const T = new Float32Array(r.n);
            for (let i = 1; i < r.n; i++) {
                const v = Math.max(1, Math.min(r.lim ? r.lim[i - 1] : 20, r.f[i - 1] & 1 ? this.u.road : this.u.off, R.cap));
                T[i] = T[i - 1] + (r.s[i] - r.s[i - 1]) / (v * 0.85); // (the average runs a little under the limit)
            }
            r._t = { key, T };
        }
        const T = r._t.T, i = r.seg(R.s, R.i), j = Math.min(i + 1, r.n - 1);
        const k = r.s[j] > r.s[i] ? (R.s - r.s[i]) / (r.s[j] - r.s[i]) : 0;
        return Math.max(0, T[r.n - 1] - (T[i] + (T[j] - T[i]) * k)) + 8;
    }

    // one frame of driving: speed toward what the road (and the vehicle ahead) allows, along the route
    driveStep(dt) {
        const R = this.route, r = R.r;
        if (!r) return;
        const p = r.at(R.s, _pc, R.i); R.i = p.i;
        // the vehicle ahead in the column: keep the gap (it may have stopped, or been knocked out); a follower may
        // run a little over the column's speed to close up
        let lead = R.lead;
        while (lead && (!lead.alive || lead.removed || lead.route.r !== r)) lead = lead.alive && !lead.removed ? null : lead.route.lead;
        let v = Math.min(p.f & 1 ? this.u.road : this.u.off, p.lim, R.cap * (lead ? 1.3 : 1));
        if (this.hp < this.maxHp * 0.4) v *= 0.6; // limping
        const brake = 1.8;
        let room = R.end - R.s;
        if (lead) {
            const gap = lead.route.s - R.s - R.gap;
            room = Math.min(room, gap + 2);
            v = Math.min(v, Math.max(0, lead.route.speed + gap * 0.35));
        }
        if (R.hold) v = 0;
        v = Math.min(v, Math.sqrt(2 * brake * Math.max(room - 0.4, 0)));
        const a = v > R.speed ? this.u.accel : brake * 1.6;
        R.speed += clamp(v - R.speed, -a * dt, a * dt);
        if (R.speed < 0.02 && v <= 0.02) R.speed = 0;
        R.s = Math.min(R.s + R.speed * dt, R.end);
        this.moved = R.speed * dt;
        if (R.end - R.s < 0.6 && R.speed < 0.4) {
            const cb = R.onArrive;
            this.placeOnRoute(dt);
            this.stop();
            if (cb) cb(this);
            return;
        }
        this.placeOnRoute(dt);
    }

    // position, heading and pitch from the route under the axles (front and rear ~⅓ of the length out)
    placeOnRoute(dt = 0) {
        const R = this.route, r = R.r;
        const half = this.L * 0.34;
        const c = r.at(R.s, _pc, R.i);
        const f = r.at(Math.min(R.s + half, r.len), _pf, c.i), b = r.at(Math.max(R.s - half, 0), _pr, c.i);
        const rev = (c.f & 4) !== 0;
        let dx = f.x - b.x, dz = f.z - b.z;
        if (dx * dx + dz * dz < 1e-4) { dx = c.tx; dz = c.tz; }
        if (rev) { dx = -dx; dz = -dz; }
        const want = Math.atan2(-dx, -dz), dh = wrap(want - this.heading);
        // a reversal (backing into a hide, turning round to go back): swing round rather than snap
        if (dt > 0 && Math.abs(dh) > 0.5) this.heading = wrap(this.heading + Math.sign(dh) * Math.min(Math.abs(dh), 1.1 * dt));
        else this.heading = want;
        const onRoad = (c.f & 1) !== 0;
        this.onRoad = onRoad;
        // off the road the wheels are on the drawn ground (a meshed vehicle), else on the route's samples
        let y = c.y;
        if (!onRoad && this.lod > 0) y = this.drawnGround(c.x, c.z);
        this.base.set(c.x, y, c.z);
        const run = Math.max(Math.hypot(f.x - b.x, f.z - b.z), 0.5);
        this.pitch = Math.atan2((rev ? b.y - f.y : f.y - b.y), run) * (onRoad || this.lod === 0 ? 1 : 0.5);
        this.roll = onRoad ? Math.atan(c.g) : 0; // (the road's banking: + right side up)
        if (!onRoad && this.lod > 0) this.tiltFromGround(); // (pitch and roll from the drawn ground's normal)
        // the road's distance lift eases in and out over a few tens of metres
        const lk = onRoad && !(c.f & 2) ? 1 : 0;
        this.liftK = dt > 0 ? this.liftK + clamp(lk - this.liftK, -(this.moved || 0) / 30, (this.moved || 0) / 30) : lk;
        const sp = R.speed;
        this.vel.set(-Math.sin(this.heading) * sp * (rev ? -1 : 1), 0, -Math.cos(this.heading) * sp * (rev ? -1 : 1));
        this.pos.set(c.x, y + this.H * 0.42, c.z);
        this.syncMesh();
    }

    // the drawn terrain (the tile under it, which differs a little from the true height at range) plus craters
    drawnGround(x, z) {
        const w = this.game.world;
        if (w && w.drawnSample && w.tiles) { w.drawnSample(x, z, _ds); return Math.max(_ds.h, 0) + craterAdj(x, z); }
        return this.groundAt(x, z);
    }
    tiltFromGround() {
        const w = this.game.world;
        if (!w || !w.drawnSample || !w.tiles) return;
        w.drawnSample(this.base.x, this.base.z, _ds);
        // the normal in the vehicle's frame: forward (−Z rotated by the heading) and right
        const s = Math.sin(this.heading), c = Math.cos(this.heading);
        const fx = -s, fz = -c, rx = c, rz = -s;
        const nf = _ds.nx * fx + _ds.nz * fz, nr = _ds.nx * rx + _ds.nz * rz;
        // ground rising ahead tilts the normal back (nose up); rising to the right tilts it left (right side up)
        this.pitch = Math.atan2(-nf, _ds.ny);
        this.roll = Math.atan2(-nr, _ds.ny);
    }

    // parked: settle on the ground as drawn (re-done now and then: the terrain tiles sharpen as the camera nears);
    // one stopped on a road stays on the road's surface, with its distance lift
    settle() {
        if (!this.onRoad) {
            this.base.y = this.lod > 0 ? this.drawnGround(this.base.x, this.base.z) : this.groundAt(this.base.x, this.base.z);
            if (this.lod > 0) this.tiltFromGround(); else { this.pitch = 0; this.roll = 0; }
            this.liftK = 0;
        }
        this.pos.y = this.base.y + this.H * 0.42;
        this.syncMesh();
    }

    syncMesh() {
        const m = this.mesh, cam = this.game.camera;
        let y = this.base.y;
        if (this.liftK > 0 && cam) y += roadLiftAt(this.base.x, this.base.y, this.base.z, cam.position) * this.liftK;
        if (!this.alive) y -= 0.25;
        m.position.set(this.base.x, y, this.base.z);
        m.rotation.set(this.pitch + (this.alive ? 0 : this.wreckTilt || 0), this.heading, this.roll + (this.alive ? 0 : (this.wreckRoll || 0)), 'YXZ');
    }

    // local (vehicle frame, metres, −Z forward) → world
    toWorld(lx, ly, lz, out) {
        const s = Math.sin(this.heading), c = Math.cos(this.heading);
        return out.set(this.base.x + lx * c + lz * s, this.base.y + ly, this.base.z - lx * s + lz * c);
    }
    forward(out) { return out.set(-Math.sin(this.heading), 0, -Math.cos(this.heading)); }
    // bearing (yaw, the heading convention) from the vehicle to a point, relative to its own heading (+ left)
    relYaw(x, z) { return wrap(Math.atan2(-(x - this.pos.x), -(z - this.pos.z)) - this.heading); }

    // ═════════════ Pose and animation ═════════════
    // play steps in order: { g: group, to: 0..1, dur } · { aim: [yaw, pitch], dur } · { wait: s } · { fn }
    play(steps) { for (const s of steps) this.anim.push(s); return this; }
    get busy() { return this.anim.length > 0; }
    animStep(dt) {
        while (this.anim.length) {
            const a = this.anim[0];
            if (a.fn) { this.anim.shift(); a.fn(this); continue; }
            if (a.t === undefined) {
                a.t = 0;
                if (a.g) a.from = this.state[a.g] ?? 0;
                if (a.aim) { a.y0 = this.aimYaw; a.p0 = this.aimPitch; }
                // (already there: nothing to wait for)
                if (a.g && Math.abs(a.from - a.to) < 1e-3) { this.anim.shift(); continue; }
            }
            a.t += dt;
            const dur = a.dur ?? a.wait ?? 0, k = dur > 0 ? ease(clamp(a.t / dur, 0, 1)) : 1;
            if (a.g) this.state[a.g] = a.from + (a.to - a.from) * k;
            if (a.aim) { this.aimYaw = a.y0 + wrap(a.aim[0] - a.y0) * k; this.aimPitch = a.p0 + (a.aim[1] - a.p0) * k; }
            if (a.t >= dur) { this.anim.shift(); dt = a.t - dur; if (dt <= 0) break; continue; }
            break;
        }
    }
    // the pose as a static copy's key: every group up or down, the launcher aim, what's still aboard
    poseKey() {
        let k = '';
        for (const g of GROUPS) k += this.state[g] > 0.5 ? '1' : '0';
        return k + '|' + (this.loaded & 0xff);
    }
    // is the pose between named poses (an animation part-way)?
    get midPose() { for (const g of GROUPS) { const v = this.state[g]; if (v > 0.001 && v < 0.999) return true; } return this.anim.length > 0; }

    // pose a live rig to the state (only what changed since last time; rams once)
    applyRig(dt) {
        const L = this.live;
        if (!L) return;
        const rig = L.rig, A = this.applied;
        let moved = false;
        for (const g of GROUPS) {
            if (g === 'launcher') continue;
            const v = this.state[g];
            if (A[g] === v || !rig.byGroup[g]) continue;
            for (const e of rig.byGroup[g]) setJoint(rig, e, e.j.stow + (e.j.deploy - e.j.stow) * v);
            rig.state[g] = v; A[g] = v; moved = true;
        }
        // the launcher: its deploy angle (a group) or its aim, whichever is higher; the turret: the aim's yaw
        const lg = rig.byGroup.launcher;
        if (lg && (A.launcher !== this.state.launcher || A.pitch !== this.aimPitch)) {
            for (const e of lg) setJoint(rig, e, Math.max(this.aimPitch, e.j.stow + (e.j.deploy - e.j.stow) * this.state.launcher));
            A.launcher = this.state.launcher; A.pitch = this.aimPitch; moved = true;
        }
        const tg = rig.byGroup.turret;
        if (tg && A.yaw !== this.aimYaw) { for (const e of tg) setJoint(rig, e, this.aimYaw); A.yaw = this.aimYaw; moved = true; }
        if (A.loaded !== this.loaded) { this.showLoad(rig); A.loaded = this.loaded; }
        if (moved && rig.rams.length) updateRams(rig);
        if (this.spinning && dt > 0) spinRig(rig, dt);
        if (this.moved && rig.wheels.length) {
            rollRig(rig, this.moved * (this.route.r && (this.route.r.f[this.route.i] & 4) ? -1 : 1));
            // steer into the bend ahead
            const r = this.route.r;
            if (r) {
                const ahead = r.at(Math.min(this.route.s + this.L * 0.8, r.len), _pf, this.route.i);
                const want = clamp(wrap(Math.atan2(-(ahead.x - this.base.x), -(ahead.z - this.base.z)) - this.heading), -0.5, 0.5);
                L.steer = (L.steer || 0) + (want - (L.steer || 0)) * Math.min(1, dt * 4);
                steerRig(rig, L.steer);
            }
        }
    }
    // missiles / canisters aboard (by the loaded mask)
    showLoad(rig) {
        if (rig.missile) rig.missile.visible = !!(this.loaded & 1);
        rig.missiles.forEach((m, i) => { m.visible = !!(this.loaded & (1 << i)); });
    }
    // world position and direction of launch point i: the rig's muzzle when there's a live rig, else from the
    // vehicle's frame (hardpoints measured once per vehicle type: forces.js)
    muzzle(i, pos, dir) {
        // (muzzleWorld brings the node's parents' matrices up to date itself)
        if (this.live && this.live.rig.muzzles.length && muzzleWorld(this.live.rig, i % this.live.rig.muzzles.length, pos, dir)) return true;
        const hp = this.sys.hardpoint && this.sys.hardpoint(this.vid, i, this.state);
        if (hp) {
            this.toWorld(hp.x, hp.y, hp.z, pos);
            // (the launcher's aim turns the stowed direction; good enough far off)
            const yaw = this.heading + this.aimYaw, el = hp.up ? Math.PI / 2 : this.aimPitch;
            dir.set(-Math.sin(yaw) * Math.cos(el), Math.sin(el), -Math.cos(yaw) * Math.cos(el));
            return true;
        }
        pos.copy(this.pos).y += 3; dir.set(0, 1, 0);
        return true;
    }

    // ═════════════ Per frame (the forces system calls it) ═════════════
    step(dt) {
        if (!this.alive) { this.wreckStep(dt); return; }
        this.moved = 0;
        if (this.route.r) this.driveStep(dt);
        else { this.route.speed = 0; this.vel.set(0, 0, 0); }
        if (this.anim.length) this.animStep(dt);
        if (this.lod > 0) {
            if (this.lod === 2) this.applyRig(dt);
            if (!this.route.r) { this.placeT -= dt; if (this.placeT <= 0) { this.placeT = 0.6; this.settle(); } }
            if (this.moved > 0) this.dust(dt);
            if (this.hp < this.maxHp * 0.45) this.smoke(dt);
        }
    }

    // dust behind the wheels across country (and on dirt), none in the rain
    dust(dt) {
        const g = this.game, cam = g.camera;
        const R = this.route;
        if (!R.r || (R.r.f[R.i] & 1)) return;
        const w = g.world ? g.world.weather : 'clear';
        if (w === 'rain' || w === 'storm') return;
        const sp = R.speed;
        if (sp < 1.5 || !cam) return;
        const d2 = this.base.distanceToSquared(cam.position);
        if (d2 > 3500 * 3500) return;
        this.dustT -= dt * Math.min(sp / 4, 2.5);
        if (this.dustT > 0) return;
        this.dustT = 0.14;
        const fx = g.effects;
        for (const side of [-1, 1]) {
            this.toWorld(side * this.W * 0.45, 0.4, this.L * 0.42, _v);
            _v2.set(rand(-1, 1), rand(1.2, 2.6), rand(-1, 1)).addScaledVector(this.vel, -0.15);
            const c = rand(0.46, 0.56);
            fx.smoke.emit(_v, _v2, rand(3, 5.5), rand(1.6, 2.4), rand(7, 12), [c, c * 0.9, c * 0.72], [c * 1.12, c * 1.04, c * 0.9], 0.42, 0, 1.3, 0.4, 0, 0.5, 0.6);
        }
    }
    // a damaged vehicle smokes
    smoke(dt) {
        this.smokeT -= dt;
        if (this.smokeT > 0) return;
        this.smokeT = 0.3;
        const cam = this.game.camera;
        if (!cam || this.pos.distanceToSquared(cam.position) > 4000 * 4000) return;
        this.game.effects.puffSmoke(_v.copy(this.pos).setY(this.pos.y + this.H * 0.4), _v2.set(0, 2.5, 0), 1.6, 0.14, 2.6, 0.5);
    }

    // ═════════════ Damage ═════════════
    damage(amount, source, kind) {
        if (!this.alive || amount <= 0) return;
        this.lastKind = kind;
        this.hp -= amount;
        this.health = this.hp;
        this.lastHitT = this.game.war ? this.game.war.time : 0;
        this.lastHitBy = source || null;
        if (this.ctrl && this.ctrl.onHit) this.ctrl.onHit(this, source, kind, amount);
        if (this.hp <= 0) this.destroy(source);
    }

    destroy(source) {
        if (!this.alive) return;
        this.alive = false;
        this.hp = this.health = 0;
        const g = this.game, fx = g.effects;
        this.anim.length = 0;
        this.stop();
        this.spinning = false;
        this.emitting = false;
        // the blast: bigger for what it carried; a fuelled missile or a fuel tank goes up in a second fireball, a
        // load of ammunition cooks off for a few seconds
        const carry = this.u.carry, big = this.L > 10 ? 1.25 : 1;
        fx.explosion(this.pos, 1.1 * big);
        fx.debrisBurst(this.pos, _v.set(0, 25, 0), 7, 1.1);
        const at = this.pos.clone();
        const later = (s, fn) => this.sys.later(s, fn);
        if (carry === 'missile' && this.loaded) later(0.35, () => { fx.explosion(at, 2.4 * big); fx.smokeColumn(at, 1.4, 50); this.sys.boom(at, 2); });
        else if (carry === 'fuel') later(0.25, () => { fx.explosion(_v.copy(at).setY(at.y + 2), 2.0); });
        else if (carry === 'ammo' || carry === 'rockets') for (let i = 0; i < 6; i++) later(0.4 + i * rand(0.3, 0.9), () => { fx.explosion(_v.copy(at).add(_v2.set(rand(-4, 4), rand(0, 4), rand(-4, 4))), rand(0.4, 0.8)); });
        this.def.boom = carry === 'missile' ? 2.2 : carry === 'fuel' ? 2 : 1.2;
        // a part thrown off a live rig (the erector, the launcher, the turret, the radar)
        if (this.live) {
            const rig = this.live.rig;
            const part = rig.turret || rig.launcher || rig.erector || rig.mast;
            if (part && part.parent) {
                part.traverse(o => { if (o.isMesh) o.material = CHARRED; });
                fx.throwPart(part, _v.set(rand(-6, 6), rand(14, 24), rand(-6, 6)), 3, true);
            }
        }
        this.wreckTilt = rand(-0.05, 0.05); this.wreckRoll = rand(-0.08, 0.08);
        this.burnT = rand(45, 90);
        fx.smokeColumn(_v.copy(this.pos).setY(this.base.y + 1), clamp(this.L / 10, 0.6, 1.4), this.burnT * 0.8);
        this.syncMesh();
        this.sys.onVehicleKilled(this, source);
        g.events.emit('groundKilled', this, { source });
    }

    // flames licking over the wreck while it burns
    wreckStep(dt) {
        if (this.burnT <= 0) return;
        this.burnT -= dt;
        this.smokeT -= dt;
        if (this.smokeT > 0 || this.lod === 0) return;
        this.smokeT = 0.16;
        const r = this.L * 0.3;
        if (Math.random() < 0.6) this.game.effects.puffFire(_v.copy(this.pos).add(_v2.set(rand(-r, r), rand(-1, 1), rand(-r, r))), _v2.set(0, rand(4, 8), 0), rand(2.2, 3.8) * clamp(this.L / 9, 0.7, 1.4), 0.6);
    }

    remove() {
        this.removed = true;
        this.sys.releaseMesh(this);
    }
}

// ═════════════ A vehicle as a launch source ═════════════
// A strikes.js GroundLauncher whose queued launches wait for the vehicle: the countdown (the last few seconds of
// the sequence: ignition) only runs once the unit says it's ready. The unit's controller gets the order
// (onFireOrder), gives the launch point (launchFrame) and hears each launch (onLaunch).
export class VehicleLauncher extends GroundLauncher {
    constructor(mgr, unit, opts) {
        super(mgr, unit, { kind: opts.kind, name: opts.name || unit.realName, stock: opts.stock || {}, range: opts.range || 300000, elev: opts.elev });
        this.unit = unit;
        this.final = opts.final ?? 2.5;
    }
    get alive() { return this.unit.alive && !this.unit.removed; }
    get pos() { return this.unit.pos; }
    canFire(specKey) { return super.canFire(specKey) && (!this.unit.ctrl || !this.unit.ctrl.canTakeOrder || this.unit.ctrl.canTakeOrder(this, specKey)); }
    // time from the order to the (first) launch, for the ETA the shooter calls
    prepTime(specKey) { const c = this.unit.ctrl; return c && c.prepEstimate ? c.prepEstimate(this, specKey) : super.prepTime(specKey); }
    fire(specKey, n, aim, strike) {
        const q0 = this.queue.length;
        const pt = this.prepTime(specKey);
        const k = super.fire(specKey, n, aim, strike);
        // (the countdown is the final seconds once ready; the queue keeps the ripple spacing)
        const rip = RIPPLE[specKey];
        for (let i = q0; i < this.queue.length; i++) {
            const q = this.queue[i];
            q.t = this.final + (rip != null ? (i - q0) * rip : Math.max(0, q.t - pt));
        }
        if (k && this.unit.ctrl && this.unit.ctrl.onFireOrder) this.unit.ctrl.onFireOrder(this, specKey, aim, strike);
        return k;
    }
    update(dt) {
        if (!this.alive) { if (this.queue.length) this.abort(); return; }
        if (!this.queue.length) return;
        const c = this.unit.ctrl;
        if (c && c.readyToFire && !c.readyToFire(this)) return;
        super.update(dt);
    }
    launchFrame(out, dir, q) {
        const c = this.unit.ctrl;
        if (c && c.launchFrame && c.launchFrame(this, out, dir, q)) return;
        super.launchFrame(out, dir, q);
    }
    launch(q) {
        const c = this.unit.ctrl;
        // far from anyone's eyes a rocket is only its flight time and where it lands (no missile, no trail)
        if (c && c.abstractLaunch && c.abstractLaunch(this, q)) {
            this.fired++;
            this.unit.firingT = this.mgr.game.war.time;
            if (c.onLaunch) c.onLaunch(this, q, null);
            return null;
        }
        const m = super.launch(q);
        if (c && c.onLaunch) c.onLaunch(this, q, m);
        return m;
    }
    // a rocket leaving a tube: a flash at the muzzle, the exhaust blasting back over the vehicle and kicking up
    // dust behind it (a whole ripple builds a cloud there, the launcher stays in sight)
    launchEffects(p, d, spec) {
        if (spec.kind !== 'rocket') { super.launchEffects(p, d, spec); return; }
        const g = this.mgr.game, fx = g.effects, cam = g.camera;
        if (cam && p.distanceToSquared(cam.position) > 16000 * 16000) return;
        fx.sprite(fx.flashTex, p, 6, 0.12, 2, 0.9, [1, 0.85, 0.6]);
        if (Math.random() < 0.3) fx.light(p, 40, 0.25);
        for (let i = 0; i < 3; i++) {
            _v.copy(d).multiplyScalar(-rand(14, 30)).add(_v2.set(rand(-3, 3), rand(-1, 3), rand(-3, 3)));
            const c = rand(0.72, 0.84);
            fx.smoke.emit(p, _v, rand(2.5, 5), rand(1.5, 2.5), rand(7, 12), [c, c, c * 0.98], [c * 0.85, c * 0.85, c * 0.82], 0.5, 0, 1.4, 0.4, 0, 0.5, 0.5);
        }
        fx.fire.emit(p, _v.copy(d).multiplyScalar(-20), rand(0.12, 0.25), 1.6, 3, [5, 3.4, 1.4], [2.4, 0.8, 0.1], 0.8, 0, 2, 0);
        // dust off the ground behind the launcher
        if (Math.random() < 0.5) {
            _v3.copy(p).addScaledVector(d, -8); _v3.y = this.unit.base.y + 0.5;
            const c = rand(0.5, 0.58);
            fx.smoke.emit(_v3, _v.set(rand(-6, 6), rand(1, 4), rand(-6, 6)), rand(4, 7), rand(3, 5), rand(12, 20), [c, c * 0.92, c * 0.78], [c * 1.1, c * 1.02, c * 0.9], 0.5, 0, 1.3, 0.3, 0, 0.5, 0.6);
        }
        this.mgr.audioLaunch(p, spec);
    }
    // the vehicle's gone: the strikes won't get these missiles
    abort() {
        const strikes = new Set();
        for (const q of this.queue) if (q.strike) { q.strike.planned = Math.max(0, q.strike.planned - 1); strikes.add(q.strike); }
        this.queue.length = 0;
        for (const st of strikes) this.mgr.checkStrikeDone(st);
    }
}

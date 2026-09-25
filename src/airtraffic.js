// ═══════════════════════════════════════════════════════════════
// Scheduled air traffic at Miramar and Harbor International.
// Arrivals fly a 3° glide path to the touchdown zone, flare, roll out, turn off
// and taxi to a parking spot; departures wait at the hold line (giving way to
// landing traffic), line up, roll, rotate and climb out. Purely scripted
// (kinematic) so dozens of movements cost almost nothing.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, runwayInfo, runwayNumbers, baseToWorld, worldToBase, terrainHeight } from './world.js';
import { makeParkedModel } from './airbase.js';
import { makeRadialTexture, clamp, rand, lerp } from './util.js';
import { AIRCRAFT } from './config.js';

const GS = 3 * Math.PI / 180;
const PERF = {
    b737: { vr: 74, vapp: 71, climb: 0.1, acc: 2.3, cruise: 125, dec: 2.3 },
    b747: { vr: 84, vapp: 78, climb: 0.08, acc: 1.9, cruise: 130, dec: 2.1 },
    cessna: { vr: 28, vapp: 33, climb: 0.12, acc: 1.8, cruise: 55, dec: 2.6 },
    fa18: { vr: 76, vapp: 70, climb: 0.28, acc: 7, cruise: 210, dec: 3.2 },
    f35: { vr: 78, vapp: 72, climb: 0.26, acc: 7, cruise: 210, dec: 3.2 },
    c130: { vr: 56, vapp: 58, climb: 0.13, acc: 2.6, cruise: 115, dec: 2.4 },
};
const _v = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

// Landing direction for a runway: the end whose approach is clear of terrain
function pickDirection(b, rw) {
    const R = runwayInfo(b, rw);
    let best = null;
    for (const dir of [1, -1]) {
        const fx = R.dirX * dir, fz = R.dirZ * dir;
        const thrX = R.x - fx * R.half, thrZ = R.z - fz * R.half;
        let worst = -Infinity;
        for (let d = 200; d <= 14000; d += 200) {
            const over = terrainHeight(thrX - fx * d, thrZ - fz * d) - (b.h + d * Math.tan(GS));
            worst = Math.max(worst, over);
        }
        if (!best || worst < best.worst) best = { dir, worst };
    }
    return best.dir;
}

class Flight {
    constructor(sys, ap, type, kind, rwIdx) {
        this.sys = sys; this.ap = ap; this.type = type; this.kind = kind;
        this.b = ap.base;
        this.rw = this.b.runways[rwIdx];
        this.perf = PERF[type];
        this.mesh = makeParkedModel(type);
        this.gear = this.mesh.children[1];
        sys.scene.add(this.mesh);
        const R = runwayInfo(this.b, this.rw), dir = ap.dir;
        this.fwd = new THREE.Vector3(R.dirX * dir, 0, R.dirZ * dir);
        this.thr = new THREE.Vector3(R.x, this.b.h, R.z).addScaledVector(this.fwd, -R.half);
        this.end = new THREE.Vector3(R.x, this.b.h, R.z).addScaledVector(this.fwd, R.half);
        this.touch = this.thr.clone().addScaledVector(this.fwd, 380);
        this.pos = new THREE.Vector3();
        this.yaw = Math.atan2(-this.fwd.x, -this.fwd.z);
        this.pitch = 0; this.bank = 0; this.speed = 0;
        this.t = 0;
        this.lights = sys.makeLights(this.mesh, AIRCRAFT[type].length, AIRCRAFT[type].span);
        if (kind === 'arrival') {
            const d = rand(9000, 14000);
            this.pos.copy(this.touch).addScaledVector(this.fwd, -d);
            this.pos.y = this.b.h + d * Math.tan(GS);
            this.speed = this.perf.vapp;
            this.state = 'approach';
            this.gear.visible = true;
        } else {
            // at the hold line beside the departure threshold, on the taxiway side
            const side = this.sideVector();
            const hold = this.thr.clone().addScaledVector(this.fwd, 60).addScaledVector(side, this.rw.w / 2 + 70);
            this.pos.copy(hold);
            this.yaw = Math.atan2(side.x, side.z); // facing the runway
            this.state = 'hold';
            this.holdT = rand(4, 10);
            this.gear.visible = true;
        }
        this.place();
    }

    // unit vector from the runway toward the apron side (+x of the base)
    sideVector() {
        const a = baseToWorld(this.b, 0, 0), c = baseToWorld(this.b, 1, 0);
        return new THREE.Vector3(c.x - a.x, 0, c.z - a.z).normalize();
    }

    get busyRunway() { return this.kind === 'arrival' && (this.state === 'approach' && this.distToTouch() < 5500 || this.state === 'rollout'); }
    distToTouch() { return _v.subVectors(this.touch, this.pos).setY(0).dot(this.fwd); }

    place() {
        this.mesh.position.copy(this.pos);
        _e.set(this.pitch, this.yaw, this.bank);
        this.mesh.quaternion.setFromEuler(_e);
    }

    steerTo(target, dt, speed) {
        const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
        const want = Math.atan2(-dx, -dz);
        let dy = want - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += clamp(dy, -0.7 * dt, 0.7 * dt);
        this.speed += clamp(speed - this.speed, -3 * dt, 2 * dt);
        this.pos.x += -Math.sin(this.yaw) * this.speed * dt;
        this.pos.z += -Math.cos(this.yaw) * this.speed * dt;
        return Math.hypot(dx, dz);
    }

    update(dt) {
        this.t += dt;
        const P = this.perf, b = this.b;
        switch (this.state) {
            case 'approach': {
                const d = this.distToTouch();
                this.pos.addScaledVector(this.fwd, this.speed * dt);
                const glide = b.h + Math.max(0, d) * Math.tan(GS);
                this.pos.y = d > 60 ? glide : lerp(b.h, glide, clamp(d / 60, 0, 1));
                this.pitch = d < 250 ? lerp(0.1, 0.035, clamp(d / 250, 0, 1)) : 0.035;
                if (d <= 0) { this.state = 'rollout'; this.pos.y = b.h; this.sys.touchdown(this); }
                break;
            }
            case 'rollout': {
                this.pitch += (0 - this.pitch) * Math.min(1, dt * 1.5);
                this.speed = Math.max(11, this.speed - P.dec * dt);
                this.pos.addScaledVector(this.fwd, this.speed * dt);
                this.pos.y = b.h;
                const along = _v.subVectors(this.pos, this.thr).dot(this.fwd);
                if (this.speed <= 11.5 || along > this.rw.len - 350) {
                    // turn off toward the apron and taxi to a parking spot
                    // runway → the parallel taxiway → along it → into the parking spot
                    const here = worldToBase(b, this.pos.x, this.pos.z), spot = this.ap.spotLocal();
                    const tx = this.ap.taxiX;
                    const w = (lx, lz) => { const q = baseToWorld(b, lx, lz); return new THREE.Vector3(q.x, b.h, q.z); };
                    this.route = [w(tx, here.lz + Math.sign(spot.lz - here.lz) * 40), w(tx, spot.lz), w(spot.lx - 40, spot.lz), w(spot.lx, spot.lz)];
                    this.state = 'taxi';
                }
                break;
            }
            case 'taxi': {
                const tgt = this.route[0];
                const d = this.steerTo(tgt, dt, this.route.length === 1 ? Math.min(8, tgt.distanceTo(this.pos) * 0.4) : 10);
                if (d < 8) { this.route.shift(); if (!this.route.length) { this.state = 'parked'; this.parkT = rand(30, 70); this.speed = 0; } }
                this.pos.y = b.h;
                break;
            }
            case 'parked': this.parkT -= dt; if (this.parkT <= 0) this.done = true; break;
            case 'hold': {
                this.holdT -= dt;
                if (this.holdT <= 0 && !this.sys.runwayBusy(this)) {
                    this.state = 'lineup';
                    this.route = [this.thr.clone().addScaledVector(this.fwd, 70), this.thr.clone().addScaledVector(this.fwd, 160)];
                }
                break;
            }
            case 'lineup': {
                const d = this.steerTo(this.route[0], dt, 7);
                if (d < 7) { this.route.shift(); if (!this.route.length) { this.state = 'roll'; this.yaw = Math.atan2(-this.fwd.x, -this.fwd.z); } }
                break;
            }
            case 'roll': {
                this.speed += P.acc * dt;
                this.pos.addScaledVector(this.fwd, this.speed * dt);
                if (this.speed > P.vr) this.pitch = Math.min(0.14, this.pitch + dt * 0.08);
                if (this.speed > P.vr + 6) { this.state = 'climb'; this.climbT = 0; }
                this.pos.y = b.h;
                break;
            }
            case 'climb': {
                this.climbT += dt;
                this.speed = Math.min(P.cruise, this.speed + P.acc * 0.6 * dt);
                if (this.climbT > 4) this.gear.visible = false;
                // gentle turn out after a few kilometres
                if (this.climbT > 25) { this.yaw += dt * 0.05; this.bank = Math.min(0.35, this.bank + dt * 0.1); }
                this.pos.x += -Math.sin(this.yaw) * this.speed * dt;
                this.pos.z += -Math.cos(this.yaw) * this.speed * dt;
                this.pos.y += this.speed * P.climb * dt;
                // terrain: climb harder if needed
                const ground = Math.max(terrainHeight(this.pos.x + -Math.sin(this.yaw) * 1500, this.pos.z + -Math.cos(this.yaw) * 1500), 0);
                if (this.pos.y < ground + 250) this.pos.y += this.speed * 0.15 * dt;
                if (this.climbT > 140 || this.pos.y > 4000) this.done = true;
                break;
            }
        }
        this.place();
        // lights: strobes and beacon blink, landing light when low
        if (this.lights) {
            const n = this.sys.night, blink = (this.t * 1.1) % 1 < 0.12;
            this.lights.beacon.visible = n && blink;
            this.lights.land.visible = n && (this.state === 'approach' || this.state === 'rollout' || this.state === 'roll' || this.state === 'climb' && this.climbT < 30);
            for (const w of this.lights.wing) w.visible = n;
        }
    }

    remove() { this.sys.scene.remove(this.mesh); }
}

class Airport {
    constructor(base, types, arrRw, depRw) {
        this.base = base;
        this.types = types;       // [[id, weight], ...]
        this.arrRw = arrRw; this.depRw = depRw;
        this.dir = pickDirection(base, base.runways[arrRw]);
        this.nextT = rand(4, 10);
        this.lastKind = 'departure';
        this.name = base.name;
        const n = runwayNumbers(base, base.runways[arrRw]);
        this.activeRunway = this.dir > 0 ? n.toward : n.from;
    }
    pickType() {
        let r = Math.random() * this.types.reduce((a, t) => a + t[1], 0);
        for (const [id, w] of this.types) { r -= w; if (r <= 0) return id; }
        return this.types[0][0];
    }
    // the parallel taxiway, and a parking spot on the apron (base-local)
    get taxiX() { return this.base.layout === 'civil' ? 180 : -60; }
    spotLocal() { return this.base.layout === 'civil' ? { lx: 330, lz: rand(-1260, -1150) } : { lx: 470, lz: rand(1060, 1160) }; }
}

export class AirTraffic {
    constructor(scene) {
        this.scene = scene;
        this.flights = [];
        this.night = false;
        this.airports = [];
        const mir = BASES.find(b => b.id === 'miramar'), civ = BASES.find(b => b.id === 'civil');
        if (mir) this.airports.push(new Airport(mir, [['fa18', 5], ['f35', 3], ['c130', 2]], 0, 1));
        if (civ) this.airports.push(new Airport(civ, [['b737', 7], ['b747', 2], ['cessna', 1]], 0, 0));
        this.glowTex = makeRadialTexture(32, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
        // get things moving straight away
        for (const ap of this.airports) { this.spawn(ap, 'arrival'); this.spawn(ap, 'departure'); }
    }

    makeLights(mesh, L, span) {
        const mk = (color, size, x, y, z) => {
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
            sp.position.set(x, y, z); sp.scale.setScalar(size); sp.visible = false;
            mesh.add(sp);
            return sp;
        };
        return {
            beacon: mk(0xff3020, L * 0.4, 0, L * 0.25, 0),
            land: mk(0xfff4dd, L * 0.7, 0, L * 0.12, -L * 0.52),
            wing: [mk(0xff2010, L * 0.2, -span / 2, L * 0.15, 0), mk(0x20ff60, L * 0.2, span / 2, L * 0.15, 0)],
        };
    }

    spawn(ap, kind) {
        const rwIdx = kind === 'arrival' ? ap.arrRw : ap.depRw;
        const f = new Flight(this, ap, ap.pickType(), kind, rwIdx);
        this.flights.push(f);
        return f;
    }

    // departures wait while someone is landing on (or rolling out along) the same runway
    runwayBusy(dep) {
        return this.flights.some(f => f !== dep && f.ap === dep.ap && f.rw === dep.rw && f.busyRunway)
            || this.flights.some(f => f !== dep && f.ap === dep.ap && f.rw === dep.rw && (f.state === 'roll' || f.state === 'lineup'));
    }

    touchdown(f) { this.lastTouch = { name: f.ap.name, type: f.type }; }

    setNight(on) { this.night = on; }

    update(dt) {
        for (const ap of this.airports) {
            ap.nextT -= dt;
            const mine = this.flights.filter(f => f.ap === ap && !f.done);
            if (ap.nextT <= 0 && mine.length < 5) {
                const kind = ap.lastKind === 'arrival' ? 'departure' : 'arrival';
                ap.lastKind = kind;
                this.spawn(ap, kind);
                ap.nextT = rand(35, 70);
            }
        }
        for (let i = this.flights.length - 1; i >= 0; i--) {
            const f = this.flights[i];
            f.update(dt);
            if (f.done) { f.remove(); this.flights.splice(i, 1); }
        }
    }
}

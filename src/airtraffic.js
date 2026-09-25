// ═══════════════════════════════════════════════════════════════
// Scheduled air traffic at Miramar and Harbor International.
// Arrivals fly a 3° glide path to the touchdown zone (spaced at least 6 km
// apart), flare, roll out, turn off and taxi to a free stand; after a
// turnaround there they taxi out again as a departure: along the taxiway to
// the hold line, wait for landing traffic, line up, roll, rotate and climb
// out. Taxiing aircraft stop for one another. Purely scripted (kinematic) so
// dozens of movements cost almost nothing.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, runwayInfo, runwayNumbers, baseToWorld, worldToBase, terrainHeight } from './world.js';
import { makeParkedModel } from './airbase.js';
import { makeRadialTexture, clamp, rand, lerp, freezeLocal } from './util.js';
import { AIRCRAFT } from './config.js';
import { registerAirTarget, unregisterAirTarget, Downed, AIR } from './softtargets.js';

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
        this.perf = PERF[type];
        this.mesh = makeParkedModel(type);
        this.gear = this.mesh.children[1];
        sys.scene.add(this.mesh);
        this.setRunway(rwIdx);
        this.pos = new THREE.Vector3();
        this.yaw = Math.atan2(-this.fwd.x, -this.fwd.z);
        this.pitch = 0; this.bank = 0; this.speed = 0;
        this.t = 0;
        this.lights = sys.makeLights(this.mesh, AIRCRAFT[type].length, AIRCRAFT[type].span);
        freezeLocal(this.mesh); // only the airframe as a whole moves (gear and lights just show / hide)
        // shootable (softtargets.js)
        this.alive = true;
        this.radius = Math.max(AIRCRAFT[type].span, AIRCRAFT[type].length) * 0.4;
        this.hp = this.maxHp = Math.round(40 + AIRCRAFT[type].length * 6);
        this.hitRadius = this.radius;
        this.vel = new THREE.Vector3();
        this.name = AIRCRAFT[type].name;
        registerAirTarget(this);
        if (kind === 'arrival') {
            // behind whoever is already on the approach, 6 km at least
            let d = rand(9000, 14000);
            for (const f of sys.flights) if (f.ap === ap && f.rw === this.rw && f.state === 'approach') d = Math.max(d, f.distToTouch() + 6000);
            this.pos.copy(this.touch).addScaledVector(this.fwd, -d);
            this.pos.y = this.b.h + d * Math.tan(GS);
            this.speed = this.perf.vapp;
            this.state = 'approach';
            this.gear.visible = true;
        } else {
            // a departure starts on a stand and taxis out
            const st = ap.freeStand();
            if (st) {
                st.by = this; this.stand = st;
                const q = baseToWorld(this.b, st.lx, st.lz);
                this.pos.set(q.x, this.b.h, q.z);
                this.yaw = Math.PI / 2 - this.b.heading; // nose toward the taxiway (-x local)
                this.taxiOut();
            } else {
                const hold = this.holdPoint();
                this.pos.copy(hold);
                this.yaw = Math.atan2(this.side.x, this.side.z); // facing the runway
                this.state = 'hold';
                this.holdT = rand(4, 10);
            }
            this.gear.visible = true;
        }
        this.place();
    }

    // the runway in use (landing and departing the same way, into the wind the airport picked)
    setRunway(rwIdx) {
        this.rw = this.b.runways[rwIdx];
        const R = runwayInfo(this.b, this.rw), dir = this.ap.dir;
        this.fwd = new THREE.Vector3(R.dirX * dir, 0, R.dirZ * dir);
        this.thr = new THREE.Vector3(R.x, this.b.h, R.z).addScaledVector(this.fwd, -R.half);
        this.end = new THREE.Vector3(R.x, this.b.h, R.z).addScaledVector(this.fwd, R.half);
        this.touch = this.thr.clone().addScaledVector(this.fwd, 380);
        this.side = this.sideVector();
    }

    // too close behind another arrival: power up, climb away and leave the pattern
    goAround() {
        this.state = 'climb'; this.climbT = 25; this.kind = 'departure';
        this.pitch = 0.1;
        this.sys.goArounds = (this.sys.goArounds || 0) + 1;
    }

    // the hold line beside the departure threshold, on the taxiway side
    holdPoint() { return this.thr.clone().addScaledVector(this.fwd, 60).addScaledVector(this.side, this.rw.w / 2 + 70); }

    // from the stand: out onto the parallel taxiway, along it to the hold line
    taxiOut() {
        const b = this.b, w = (lx, lz) => { const q = baseToWorld(b, lx, lz); return new THREE.Vector3(q.x, b.h, q.z); };
        const hold = this.holdPoint(), hl = worldToBase(b, hold.x, hold.z), here = worldToBase(b, this.pos.x, this.pos.z);
        // outbound traffic keeps to its own lane along the apron edge, so it never meets an arrival head-on on the
        // taxiway; it crosses over to the hold line at the end
        const lane = this.ap.outX;
        this.route = [w(here.lx - 40, here.lz), w(lane, here.lz + Math.sign(hl.lz - here.lz) * 30), w(lane, hl.lz - Math.sign(hl.lz - here.lz) * 40), hold];
        this.state = 'taxiout';
        this.kind = 'departure';
        this.speed = 0;
    }

    // someone taxiing, holding or lining up just ahead of us: stop and wait. Returns 'queue' behind a holding
    // aircraft (wait as long as it takes), 'traffic' for a moving one, or null
    blocked() {
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        for (const f of this.sys.flights) {
            if (f === this || f.ap !== this.ap || !f.alive || !(f.state === 'taxi' || f.state === 'taxiout' || f.state === 'hold' || f.state === 'lineup')) continue;
            const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z, d = Math.hypot(dx, dz);
            const room = (this.radius + f.radius) * 1.2 + 15;
            if (d < room && (dx * fx + dz * fz) > d * 0.5) return f.state === 'hold' || f.state === 'lineup' ? 'queue' : 'traffic';
        }
        return null;
    }

    // unit vector from the runway toward the apron side (+x of the base)
    sideVector() {
        const a = baseToWorld(this.b, 0, 0), c = baseToWorld(this.b, 1, 0);
        return new THREE.Vector3(c.x - a.x, 0, c.z - a.z).normalize();
    }

    get busyRunway() { return this.kind === 'arrival' && (this.state === 'approach' && this.distToTouch() < 5500 || this.state === 'rollout'); }
    distToTouch() { return _v.subVectors(this.touch, this.pos).setY(0).dot(this.fwd); }

    place() {
        this.vel.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.speed);
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

    // same call shape as Aircraft.damage, so missiles and lock logic can treat it like any aircraft
    damage(amount, source) { if (AIR.game) this.hit(amount, AIR.game, source); }

    hit(amount, game, source) {
        if (!this.alive || amount <= 0) return;
        this.hp -= amount;
        this.game = game;
        if (this.hp > 0) return;
        this.alive = false;
        const vel = new THREE.Vector3(-Math.sin(this.yaw), Math.sin(this.pitch), -Math.cos(this.yaw)).multiplyScalar(this.speed);
        if (this.pos.y - this.b.h < 3) { vel.y = 0; } // on the ground: it burns where it stands
        this.downed = new Downed(this.mesh, vel, game, { spin: 0.4, size: Math.min(2, this.radius / 10) });
        if (this.lights) for (const sp of [this.lights.beacon, this.lights.land, ...this.lights.wing]) sp.visible = false;
        if (source && (source === game.player || source === game.pilotMode)) game.addFeed(AIRCRAFT[this.type].name.toUpperCase() + ' DOWN', '#ffc23f');
    }

    update(dt) {
        if (!this.alive) { if (!this.downed || !this.downed.update(dt)) this.done = true; return; }
        if (this.hp < this.maxHp * 0.5 && this.game && Math.random() < dt * 10) this.game.effects.puffSmoke(this.pos, _v.set(0, 2, 0), 2, 0.15, 2, 0.5);
        this.t += dt;
        const P = this.perf, b = this.b;
        switch (this.state) {
            case 'approach': {
                const d = this.distToTouch();
                // spacing: a faster jet closing on a slower one ahead slows to its speed (never below its own stall margin)
                let want = P.vapp;
                for (const f of this.sys.flights) {
                    if (f === this || f.ap !== this.ap || f.rw !== this.rw || f.state !== 'approach' || !f.alive) continue;
                    const gap = d - f.distToTouch();
                    if (gap > 0 && gap < 4500) want = Math.max(P.vapp * 0.82, Math.min(want, f.speed));
                    if (gap > 0 && gap < 1500 && this.speed > f.speed + 2 && d > 800) { this.goAround(); return; }
                }
                this.speed += clamp(want - this.speed, -1.5 * dt, 1.5 * dt);
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
                    const st = this.ap.freeStand();
                    if (st) { st.by = this; this.stand = st; }
                    const here = worldToBase(b, this.pos.x, this.pos.z), spot = st ? { lx: st.lx, lz: st.lz } : this.ap.spotLocal();
                    const tx = this.ap.taxiX;
                    const w = (lx, lz) => { const q = baseToWorld(b, lx, lz); return new THREE.Vector3(q.x, b.h, q.z); };
                    this.route = [w(tx, here.lz + Math.sign(spot.lz - here.lz) * 40), w(tx, spot.lz), w(spot.lx - 40, spot.lz), w(spot.lx, spot.lz)];
                    this.state = 'taxi';
                }
                break;
            }
            case 'taxi': case 'taxiout': {
                const tgt = this.route[0];
                // wait for traffic ahead (but not for ever: nose to nose, someone has to go)
                const why = this.blocked();
                const stop = why === 'queue' || (why && (this.blockT = (this.blockT || 0) + dt) < 25);
                if (!stop) this.blockT = 0;
                const want = stop ? 0 : this.route.length === 1 ? Math.min(8, tgt.distanceTo(this.pos) * 0.4 + 1) : 10;
                const d = this.steerTo(tgt, dt, want);
                if (d < 8) {
                    this.route.shift();
                    if (this.route.length === 3 && this.state === 'taxiout' && this.stand) { this.stand.by = null; this.stand = null; } // off the stand
                    if (!this.route.length) {
                        if (this.state === 'taxi') { this.state = 'parked'; this.parkT = rand(40, 90); this.speed = 0; }
                        else { this.state = 'hold'; this.holdT = rand(3, 8); this.speed = 0; this.yaw = Math.atan2(this.side.x, this.side.z); }
                    }
                }
                this.pos.y = b.h;
                break;
            }
            case 'parked': {
                // turnaround done: taxi out and depart (or make way if the airport's busy)
                this.parkT -= dt;
                if (this.parkT <= 0) {
                    if (this.sys.flights.filter(f => f.ap === this.ap && f.kind === 'departure' && f.alive).length < 2) { this.setRunway(this.ap.depRw); this.taxiOut(); }
                    else this.parkT = rand(10, 20);
                }
                break;
            }
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

    remove() {
        if (this.stand && this.stand.by === this) this.stand.by = null;
        unregisterAirTarget(this);
        this.sys.scene.remove(this.mesh);
        // the model's geometry and materials are shared; only the light sprites' materials are this flight's own
        if (this.lights) for (const sp of [this.lights.beacon, this.lights.land, ...this.lights.wing]) sp.material.dispose();
    }
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
    // the parallel taxiway, and the stands for visiting aircraft on the apron (base-local, clear of the parked rows)
    get taxiX() { return this.base.layout === 'civil' ? 180 : -60; }
    get outX() { return this.base.layout === 'civil' ? 250 : 20; }
    spotLocal() { return this.base.layout === 'civil' ? { lx: 330, lz: rand(-1260, -1150) } : { lx: 470, lz: rand(1060, 1160) }; }
    freeStand() {
        if (!this.stands) this.stands = this.base.layout === 'civil' ? [-1130, -1200, -1270].map(lz => ({ lx: 330, lz, by: null })) : [1050, 1100, 1150, 1200].map(lz => ({ lx: 470, lz, by: null }));
        const free = this.stands.filter(s => !s.by || !s.by.alive || s.by.done);
        return free.length ? free[Math.floor(Math.random() * free.length)] : null;
    }
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

    spawn(ap, kind, type = ap.pickType()) {
        const rwIdx = kind === 'arrival' ? ap.arrRw : ap.depRw;
        const f = new Flight(this, ap, type, kind, rwIdx);
        this.flights.push(f);
        return f;
    }

    // would an arrival of this type catch up with someone slower already on the approach? (then it waits)
    tooClose(ap, type) {
        const v = PERF[type].vapp;
        for (const f of this.flights) {
            if (f.ap !== ap || f.state !== 'approach' || !f.alive || f.speed >= v) continue;
            const d = f.distToTouch(), t = d / f.speed; // the slow one lands in t seconds
            if (d + 6000 + t * (v - f.speed) > 15000) return true;
        }
        return false;
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
                // mostly arrivals (they turn round and leave again); a departure now and then if the stands are empty
                const deps = mine.filter(f => f.kind === 'departure').length;
                const kind = deps === 0 && Math.random() < 0.4 ? 'departure' : 'arrival', type = ap.pickType();
                if (kind === 'arrival' && this.tooClose(ap, type)) { ap.nextT = 10; continue; } // sequencing: try again shortly
                this.spawn(ap, kind, type);
                ap.nextT = rand(40, 75);
            }
        }
        for (let i = this.flights.length - 1; i >= 0; i--) {
            const f = this.flights[i];
            f.update(dt);
            if (f.done) { f.remove(); this.flights.splice(i, 1); }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// Bombers and air-launched missiles (air support, airsupport.js), through the strike system (strikes.js):
//  • AirLaunchSource — a LaunchSource carried by an aircraft or a director flight (director.js: a point moving
//    along its route far away, real jets near the player): the round drops out of the bay or off the pylon with the
//    carrier's speed and falls clear before its engine lights
//  • AirMissile — the rounds: stand-off cruise missiles (Kh-101, AGM-158 JASSM) that dive from the launch height to
//    their cruise level and then terrain-follow like a Tomahawk, and the AGM-114 Hellfire, a direct lofted attack
//  • strike types 'standoff' (a bomber's cruise missiles) and 'carpet' (a B-52's stick of Mk-82s, flown by
//    airsupport.js through strikes.airProviders)
//  • the red stand-off raid: a Tu-95MS raid (director.js launchRaid) stands off ~34 km from its target and
//    launches its Kh-101s instead of overflying
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { MISSILES, STRIKE_TYPES, LaunchSource, StrategicMissile } from './strikes.js';
import { terrainHeight } from './world.js';
import { WEAPONS } from './config.js';
import { clamp, rand, G } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

// ═════════════ The rounds ═════════════
export class AirMissile extends StrategicMissile {
    constructor(mgr, spec, team, pos, dir, aim, source, strike) {
        super(mgr, spec, team, pos, dir, aim, source, strike);
        // out of the bay / off the rail: it falls clear, wings folded, then the engine lights
        this.phase = 'drop';
        if (this.wings) this.wings.scale.x = 0.05;
        this.trail.emitting = false;
    }

    flyCruise(dt) {
        const s = this.spec;
        if (this.phase === 'drop') {
            this.vel.y -= G * dt;
            this.vel.multiplyScalar(1 - 0.02 * dt);
            if (this.age > (s.dropT ?? 1)) this.phase = s.direct ? 'direct' : 'descent';
            return;
        }
        if (this.phase === 'direct') { this.flyDirect(dt); return; }
        if (this.wings && this.wings.scale.x < 1) this.wings.scale.x = Math.min(1, this.wings.scale.x + dt * 1.5);
        // from the launch height down to the cruise level at `descent` m/s, turning onto the target; then the
        // Tomahawk's terrain following and pop-up / dive (strikes.js)
        if (this.phase === 'descent') {
            const T = this.targetPos, here = Math.max(terrainHeight(this.pos.x, this.pos.z), 0);
            const dx = T.x - this.pos.x, dz = T.z - this.pos.z, hd = Math.hypot(dx, dz);
            if (this.pos.y < here + s.alt + 500 || hd < 6000) { this.phase = 'cruise'; this.vel.y = Math.max(this.vel.y, -40); }
            else {
                const speed = Math.min(Math.max(this.vel.length(), 120) + 20 * dt, s.speed);
                const cur = Math.atan2(this.vel.x, this.vel.z), want = Math.atan2(dx, dz);
                let dh = want - cur;
                while (dh > Math.PI) dh -= Math.PI * 2;
                while (dh < -Math.PI) dh += Math.PI * 2;
                const h = cur + clamp(dh, -2 * G / speed * dt, 2 * G / speed * dt);
                const vy = -Math.min(s.descent ?? 60, speed * 0.6);
                const hs = Math.sqrt(Math.max(speed * speed - vy * vy, 100));
                this.vel.set(Math.sin(h) * hs, this.vel.y + clamp(vy - this.vel.y, -15 * dt, 15 * dt), Math.cos(h) * hs);
                return;
            }
        }
        super.flyCruise(dt);
    }

    // Hellfire: motor to ~420 m/s, a lofted climb over the target, then down onto it steeply (a top attack)
    flyDirect(dt) {
        const s = this.spec, T = this.targetPos;
        const speed = this.vel.length();
        const dx = T.x - this.pos.x, dz = T.z - this.pos.z, hd = Math.hypot(dx, dz);
        const aim = _v.copy(T);
        if (hd > 1200) aim.y = Math.max(T.y, this.pos.y) + Math.min(hd * 0.12, 600);
        const want = aim.sub(this.pos).normalize().multiplyScalar(Math.min(speed + 160 * dt, s.speed));
        const dv = want.sub(this.vel), maxDv = 22 * G * dt;
        if (dv.length() > maxDv) dv.setLength(maxDv);
        this.vel.add(dv);
        if (this.age - (s.dropT ?? 0.3) < 2.5) {
            // the motor's short, bright burn and its smoke
            const fx = this.game.effects;
            const back = _v2.copy(this.vel).normalize().multiplyScalar(-s.len * 0.6).add(this.pos);
            fx.fire.emit(back, _v.copy(this.vel).multiplyScalar(0.5), 0.05, 1.2, 0.5, [7, 5, 2.4], [3.5, 1.2, 0.2], 1, 0, 0, 0);
            if (Math.random() < 0.6) fx.smoke.emit(back, _v.copy(this.vel).multiplyScalar(0.05), rand(1.5, 3), 1.1, 5, [0.85, 0.85, 0.84], [0.7, 0.7, 0.7], 0.4, 0, 1, 1);
        }
    }
}

// ═════════════ Missiles and strike types (registered with the strike system when this loads) ═════════════
export const AIR_MISSILES = {
    kh101: { kind: 'cruise', name: 'KH-101', short: 'KH-101', speed: 210, alt: 45, seaAlt: 15, boost: 0, warhead: 420, blast: 30, hard: 0.35, len: 7.45, dia: 0.74, span: 3.0, color: 0x6e7468, nose: 0x3a3d38, Missile: AirMissile, dropT: 1.2, descent: 70 },
    jassm: { kind: 'cruise', name: 'AGM-158 JASSM', short: 'JASSM', speed: 240, alt: 40, seaAlt: 15, boost: 0, warhead: 450, blast: 28, hard: 0.55, len: 4.27, dia: 0.55, span: 2.4, color: 0x5d6358, nose: 0x2f312e, Missile: AirMissile, dropT: 1.0, descent: 60 },
    hellfire: { kind: 'cruise', direct: true, name: 'AGM-114 HELLFIRE', short: 'HELLFIRE', speed: 420, alt: 0, seaAlt: 0, boost: 0, warhead: 200, blast: 7, hard: 0.5, len: 1.63, dia: 0.178, span: 0.33, color: 0x6b7060, nose: 0x2a2c28, Missile: AirMissile, dropT: 0.3 },
};
for (const [k, v] of Object.entries(AIR_MISSILES)) if (!MISSILES[k]) MISSILES[k] = v;
if (!STRIKE_TYPES.standoff) STRIKE_TYPES.standoff = { label: 'BOMBER STAND-OFF STRIKE', use: { blue: 'jassm', red: 'kh101' }, sources: ['bomber'], per: 2 };
if (!STRIKE_TYPES.carpet) STRIKE_TYPES.carpet = { label: 'CARPET BOMBING (B-52H)', aircraft: true };

// what each missile carrier takes along
export const CARRIERS = { tu95: { kh101: 6 }, b52: { jassm: 8 }, mq9: { hellfire: 4 } };

// ═════════════ The launch source ═════════════
// host: an Aircraft, or a director flight ({ pos, vel, n, done, members })
export class AirLaunchSource extends LaunchSource {
    constructor(mgr, host, { name, team, kind = 'bomber', stock, range = 400000 }) {
        super(mgr, { name, team, kind, stock, host, range });
        this.airLaunch = true;
        this.ix = 0;
    }
    get alive() {
        const h = this.host;
        if (!h) return false;
        if (h.types && h.hp) return !h.done && h.n > 0; // a director flight
        return h.alive !== false && !h.exploded;
    }
    get pos() { return this.host.pos; }
    prepTime() { return this.kind === 'drone' ? 1.5 : 4 + rand(0, 2); } // bay doors, weapons release consent
    // the carrier this round comes off: a flight's real jets in turn, or the flight itself far away
    carrier() {
        const h = this.host;
        if (h.members) {
            const live = h.members.filter(a => a.alive);
            if (live.length) return live[this.ix++ % live.length];
        }
        return h;
    }
    launchFrame(out, dir) {
        const c = this.carrier();
        const v = c.vel || _v.set(0, 0, -1);
        const hs = Math.hypot(v.x, v.z) || 1;
        dir.set(v.x / hs, -0.12, v.z / hs).normalize();
        out.copy(c.pos);
        if (c.getUp) { out.addScaledVector(c.getUp(_v2), -3.5); out.x -= dir.x * 4; out.z -= dir.z * 4; } else out.y -= 4;
    }
    launchEffects(p, d, spec) {
        const fx = this.game.effects;
        const cam = this.game.camera.position;
        if (p.distanceTo(cam) > 20000) return;
        for (let i = 0; i < 4; i++) fx.smoke.emit(p, _v.copy(d).multiplyScalar(rand(20, 60)), rand(1.5, 3), 1.2, 6, [0.8, 0.8, 0.8], [0.7, 0.7, 0.7], 0.35, 0, 1, 0.5);
        if (spec.direct) fx.light(p, 30, 0.3);
    }
}

// ═════════════ Bombs: where a Mk-82 let go now lands (weapons.js's fall: gravity and its drag), 0.1 s steps ═════════════
export function bombImpact(ac, gy, out) {
    const drag = WEAPONS.bomb.drag;
    const up = ac.getUp ? ac.getUp(_v2) : _v2.set(0, 1, 0);
    let x = ac.pos.x - up.x * 2.2, y = ac.pos.y - up.y * 2.2, z = ac.pos.z - up.z * 2.2;
    let vx = ac.vel.x - up.x * 4, vy = ac.vel.y - up.y * 4, vz = ac.vel.z - up.z * 4;
    let t = 0;
    for (; t < 70 && y > gy; t += 0.1) {
        vy -= G * 0.1;
        const k = 1 - drag * 0.1;
        vx *= k; vy *= k; vz *= k;
        x += vx * 0.1; y += vy * 0.1; z += vz * 0.1;
    }
    out.set(x, gy, z);
    return t;
}

// ═════════════ The red stand-off raid (director.js raids of cruise-missile carriers) ═════════════
export const STANDOFF = { start: 75000, launch: 34000, alt: 9000, speed: 200 };
// Turn a director raid flight into a stand-off one: it starts further out, flies to a launch point ~34 km short of
// its target at 9 km and turns away there; the bombs come off (it's the missiles that do it). Returns the launch
// point and a heading away, or null when the flight carries nothing to launch.
export function planStandoff(f) {
    const stock = {};
    for (let i = 0; i < f.types.length; i++) {
        const c = CARRIERS[f.types[i]];
        if (!c) continue;
        for (const [k, n] of Object.entries(c)) if (MISSILES[k] && MISSILES[k].Missile === AirMissile) stock[k] = (stock[k] || 0) + n;
    }
    if (!Object.keys(stock).length || !f.target) return null;
    const T = f.target.pos;
    const dir = _v.set(T.x - f.pos.x, 0, T.z - f.pos.z);
    const L = dir.length() || 1;
    dir.divideScalar(L);
    if (L < STANDOFF.start) f.pos.set(T.x - dir.x * STANDOFF.start, f.pos.y, T.z - dir.z * STANDOFF.start);
    f.pos.y = STANDOFF.alt;
    const lp = new THREE.Vector3(T.x - dir.x * STANDOFF.launch, STANDOFF.alt, T.z - dir.z * STANDOFF.launch);
    // after the launch: a turn away (to the side with the more distance from the target) and home
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const away = lp.clone().addScaledVector(side, 16000).addScaledVector(dir, -14000); away.y = STANDOFF.alt;
    f.route = [{ p: lp, launch: true }, { p: away }];
    f.bombs = f.types.map(() => 0);
    f.speed = STANDOFF.speed;
    f.standoff = true;
    return { lp, stock };
}

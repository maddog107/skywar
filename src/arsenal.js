// ═══════════════════════════════════════════════════════════════
// Arsenal: the weapons carried on foot, as data plus the rules they follow.
//   • ARSENAL / SLOTS: every weapon's stats (keys 1–7 select them in this order)
//   • Gun: one carried weapon's state: magazine, reserve, the action cycling, reloads (magazine,
//     shell by shell, rocket), bloom. The player (pilot.js) and soldiers (infantry.js) both use it.
//   • damage with range, spread, recoil; what a round does to vehicles, aircraft, armour, buildings
//   • ballistics: the RPG-7's PG-7V rocket (boost, sustainer, a slight drop) and the M67 grenade
//     (thrown, bounces, rolls, explodes on its fuse); blast fall-off; throw solutions
//   • AI marksmanship: aim error from skill, range, movement and suppression, and the chance it hits
// Nothing here draws or touches the scene: ordnance.js fires these into the world, viewmodel.js and
// character.js draw them. Tested headless in tests/arsenal.test.mjs.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

const G = 9.81;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ── The weapons ──
// damage: to a person (100 hp), per round (per pellet for the shotgun); head: headshot multiplier.
// range: [full damage out to (m), falls off to (m), leaving this fraction]. velocity m/s, life s.
// spread (rad, cone half-angle): hip / aimed down the sights, + walking / running / in the air, + bloom
// per shot up to max, decaying exponentially at `recover` (1/s). recoil: camera kick per shot (rad) and its
// return rate.
// vs: what one round does to a traffic car (30 hp, a lorry 60), a helicopter / aircraft, a soft ground
// target (trucks, launchers, radars, parked jets), armour (tanks, bunkers, hangars) and buildings.
// noise: how far away soldiers hear it (m). tracer: every n-th round glows. ads: sight picture zoom.
export const ARSENAL = {
    ak47: {
        id: 'ak47', name: 'AK-47', long: 'AK-47 · 7.62×39 mm', slot: 1, type: 'rifle', fire: 'auto', model: 'ak47',
        rpm: 600, mag: 30, reserve: 180, reload: 2.45, reloadEmpty: 3.05,
        damage: 38, head: 2.8, velocity: 715, life: 1.35, range: [40, 280, 0.62],
        spread: { hip: 0.030, ads: 0.0045, walk: 0.016, run: 0.042, air: 0.03, perShot: 0.0065, max: 0.032, recover: 3.5 },
        recoil: { pitch: 0.021, yaw: 0.008, kick: 0.05, recover: 9 },
        vs: { vehicle: 2.2, aircraft: 1.2, soft: 1.6, armor: 0, building: 0 },
        tracer: 3, noise: 380, flash: 1.1, ads: { fov: 50, time: 0.22 }, draw: 0.55, speed: 0.96,
    },
    m4a1: {
        id: 'm4a1', name: 'M4A1', long: 'M4A1 CARBINE · 5.56×45 mm', slot: 2, type: 'rifle', fire: 'auto', model: 'm4a1',
        rpm: 800, mag: 30, reserve: 210, reload: 2.2, reloadEmpty: 2.75,
        damage: 31, head: 3.3, velocity: 880, life: 1.3, range: [50, 330, 0.66],
        spread: { hip: 0.024, ads: 0.0035, walk: 0.014, run: 0.038, air: 0.028, perShot: 0.0045, max: 0.026, recover: 6 },
        recoil: { pitch: 0.014, yaw: 0.005, kick: 0.04, recover: 10 },
        vs: { vehicle: 1.8, aircraft: 1.0, soft: 1.3, armor: 0, building: 0 },
        tracer: 4, noise: 350, flash: 0.9, ads: { fov: 46, time: 0.2 }, draw: 0.5, speed: 0.98,
    },
    m870: {
        id: 'm870', name: 'REMINGTON 870', long: 'REMINGTON 870 · 12 GA 00 BUCK', slot: 3, type: 'shotgun', fire: 'pump', model: 'm870',
        rpm: 70, pump: 0.55, mag: 6, reserve: 30, shellStart: 0.32, shell: 0.5, shellEnd: 0.4,
        pellets: 9, damage: 17, head: 1.6, velocity: 400, life: 0.45, range: [8, 42, 0.12],
        spread: { hip: 0.058, ads: 0.042, walk: 0.008, run: 0.02, air: 0.02, perShot: 0, max: 0, recover: 6 },
        recoil: { pitch: 0.085, yaw: 0.02, kick: 0.12, recover: 7 },
        vs: { vehicle: 0.9, aircraft: 0.4, soft: 0.6, armor: 0, building: 0 },
        tracer: 0, noise: 320, flash: 1.6, ads: { fov: 58, time: 0.22 }, draw: 0.6, speed: 0.95,
    },
    m9: {
        id: 'm9', name: 'M9 BERETTA', long: 'M9 · 9×19 mm', slot: 4, type: 'pistol', fire: 'semi', model: 'm9',
        rpm: 450, mag: 15, reserve: 75, reload: 1.55, reloadEmpty: 1.85,
        damage: 24, head: 2.6, velocity: 375, life: 0.8, range: [15, 70, 0.55],
        spread: { hip: 0.016, ads: 0.006, walk: 0.012, run: 0.03, air: 0.02, perShot: 0.012, max: 0.03, recover: 7 },
        recoil: { pitch: 0.032, yaw: 0.01, kick: 0.06, recover: 11 },
        vs: { vehicle: 1.1, aircraft: 0.5, soft: 0.7, armor: 0, building: 0 },
        tracer: 0, noise: 180, flash: 0.6, ads: { fov: 60, time: 0.16 }, draw: 0.35, speed: 1.04,
    },
    deagle: {
        id: 'deagle', name: 'DESERT EAGLE', long: 'DESERT EAGLE · .44 MAGNUM', slot: 5, type: 'pistol', fire: 'semi', model: 'deagle',
        rpm: 200, mag: 8, reserve: 40, reload: 1.9, reloadEmpty: 2.2,
        damage: 64, head: 2.5, velocity: 440, life: 0.9, range: [20, 90, 0.6],
        spread: { hip: 0.024, ads: 0.007, walk: 0.016, run: 0.034, air: 0.024, perShot: 0.03, max: 0.045, recover: 5 },
        recoil: { pitch: 0.085, yaw: 0.02, kick: 0.13, recover: 7 },
        vs: { vehicle: 3.4, aircraft: 1.6, soft: 2.4, armor: 0, building: 0 },
        tracer: 0, noise: 300, flash: 1.4, ads: { fov: 58, time: 0.18 }, draw: 0.4, speed: 1.03,
    },
    rpg7: {
        id: 'rpg7', name: 'RPG-7', long: 'RPG-7 · PG-7V HEAT', slot: 6, type: 'launcher', fire: 'single', model: 'rpg7', projectile: 'rocket',
        mag: 1, reserve: 4, reload: 3.6,
        spread: { hip: 0.012, ads: 0.003, walk: 0.02, run: 0.05, air: 0.03, perShot: 0, max: 0, recover: 4 },
        recoil: { pitch: 0.05, yaw: 0.012, kick: 0.15, recover: 5 },
        backblast: { len: 15, cone: 0.5, damage: 70 },
        noise: 450, flash: 2.5, ads: { fov: 44, time: 0.3 }, draw: 0.8, speed: 0.9,
    },
    m67: {
        id: 'm67', name: 'M67 GRENADE', long: 'M67 FRAGMENTATION GRENADE', slot: 7, type: 'grenade', fire: 'throw', model: 'm67', projectile: 'grenade',
        mag: 1, reserve: 3, pull: 0.35, cycle: 0.9,
        spread: { hip: 0, ads: 0, walk: 0, run: 0, air: 0, perShot: 0, max: 0, recover: 1 },
        recoil: { pitch: 0.01, yaw: 0, kick: 0, recover: 6 },
        noise: 0, flash: 0, ads: { fov: 66, time: 0.2 }, draw: 0.4, speed: 1.02,
    },
};
export const SLOTS = ['ak47', 'm4a1', 'm870', 'm9', 'deagle', 'rpg7', 'm67'];
export const weaponDef = (id) => ARSENAL[id] || ARSENAL.ak47;

// ── The RPG-7's PG-7V rocket and the M67 grenade ──
// The booster kicks the rocket out at 115 m/s; ~11 m out the sustainer lights and pushes it to ~295 m/s; its
// fins keep it pointed along its flight path, and the thrust holds most of the drop off until it burns out.
// It self-destructs after 4.5 s (~1.2 km: it holds its speed better than the real one). Blast: `peak` damage
// to people inside `inner`, falling to nothing at R. vs: what it does to each class of target (explosiveDamage).
export const ROCKET = {
    launch: 115, max: 295, ignite: 0.1, burn: 0.45, accel: (295 - 115) / 0.45, drag: 0.00006, gBoost: 0.28, coast: 0.8,
    arm: 5, selfDestruct: 4.5, radius: 0.045,
    blast: { R: 9, inner: 2.5, peak: 300 },
    vs: { vehicle: 999, armor: 40, soft: 140, aircraft: 160, building: { R: 5, amount: 180 } },
    splash: 7,   // ground targets within this of the burst take some of it
    noise: 600,
};
// Fuse from the moment the spoon flies (it's thrown): M67, 4–5.5 s. Lethal within ~5 m, dangerous to ~15 m.
export const GRENADE = {
    speed: 17, loft: 0.3, fuse: 4.0, restitution: 0.32, friction: 0.55, radius: 0.035, drag: 0.02,
    blast: { R: 13, inner: 3.5, peak: 240 },
    vs: { vehicle: 999, armor: 0, soft: 60, aircraft: 60, building: { R: 3, amount: 45 } },
    splash: 4,
    noise: 550,
};

// What an explosion (D: ROCKET or GRENADE) does to a ground target of class cls ('soft' | 'armor' | ...):
// a direct hit gets the full HEAT effect (a rocket's shaped charge adds its jet), one `dist` m from the burst a
// share falling off to nothing at D.splash
export function explosiveDamage(D, cls, direct, dist = 0) {
    const v = D.vs[cls] ?? D.vs.soft ?? 0;
    if (direct) return v * 1.2 + (D === ROCKET ? 20 : 0);
    if (dist >= D.splash) return 0;
    return v * 0.6 * (1 - Math.max(0, dist) / D.splash);
}

// Friendly fire: rounds don't hurt their own side's soldiers; blasts hurt them a third as much
export function friendlyFactor(sourceTeam, victimTeam, kind) {
    if (!sourceTeam || sourceTeam !== victimTeam) return 1;
    return kind === 'gun' ? 0 : 0.35;
}

// ── Damage ──
// a round's damage to a person at distance d (m)
export function damageAt(w, d) {
    const [full, far, min] = w.range || [1e9, 1e9, 1];
    if (d <= full) return w.damage;
    if (d >= far) return w.damage * min;
    return w.damage * (1 + (min - 1) * (d - full) / (far - full));
}
// blast damage at distance d from the centre of an explosion B = { R, inner, peak }
export function blastDamage(d, B) {
    if (d >= B.R) return 0;
    if (d <= B.inner) return B.peak;
    const k = 1 - (d - B.inner) / (B.R - B.inner);
    return B.peak * Math.pow(k, 1.6);
}
// What kind of thing a ground target is, for small arms: armour shrugs rounds off, soft skin doesn't
const ARMORED = new Set(['tank', 'spaag', 'bunker', 'hangar']);
export function targetClass(t) {
    if (!t) return 'soft';
    if (t.cls === 'infantry') return 'person';
    if (t.isShip || t.hardened >= 0.5 || ARMORED.has(t.type)) return 'armor';
    if (t.isBridge) return 'building';
    return 'soft';
}
// One round (or pellet) of weapon w against a target class ('vehicle', 'aircraft', 'soft', 'armor', 'building')
export function materielDamage(w, cls) {
    const v = w && w.vs;
    if (!v) return 0;
    return v[cls] ?? 0;
}

// ── Spread (cone half-angle, rad) for a stance ──
// st: { ads 0..1, walk 0..1, run 0..1, air: bool }
export function spreadFor(w, gun, st = {}) {
    const s = w.spread;
    const ads = clamp(st.ads || 0, 0, 1);
    let r = s.hip + (s.ads - s.hip) * ads;
    r += (s.walk || 0) * clamp(st.walk || 0, 0, 1) * (1 - ads * 0.6);
    r += (s.run || 0) * clamp(st.run || 0, 0, 1);
    if (st.air) r += s.air || 0;
    if (gun) r += gun.heat * (1 - ads * 0.5);
    return r;
}
// a random direction inside a cone of half-angle `spread` around unit `dir` (uniform over the disc)
const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
export function scatter(dir, spread, out = new THREE.Vector3(), rnd = Math.random) {
    out.copy(dir);
    if (spread <= 0) return out;
    // any two axes perpendicular to dir
    _t1.set(Math.abs(dir.y) < 0.9 ? 0 : 1, Math.abs(dir.y) < 0.9 ? 1 : 0, 0).cross(dir).normalize();
    _t2.crossVectors(dir, _t1);
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * Math.tan(spread);
    return out.addScaledVector(_t1, Math.cos(a) * r).addScaledVector(_t2, Math.sin(a) * r).normalize();
}

// ── One carried weapon ──
export class Gun {
    constructor(def, opts = {}) {
        this.def = typeof def === 'string' ? weaponDef(def) : def;
        this.id = this.def.id;
        this.mag = opts.mag ?? this.def.mag;
        this.reserve = opts.reserve ?? this.def.reserve;
        this.cycle = 0;          // s until the action can fire again
        this.pump = 0;           // shotgun: s left of the pump stroke
        this.chambered = true;   // shotgun: a shell sits in the chamber
        this.reload = null;      // { kind: 'mag' | 'empty' | 'shell' | 'rocket', t, dur, stage, stop }
        this.heat = 0;           // bloom (rad)
        this.held = false;       // the trigger was down last update (semi-auto wants a fresh pull)
        this.shots = 0;          // rounds since the trigger went down
        this.dry = false;        // the hammer fell on an empty chamber this update
        this.events = [];        // 'magOut', 'magIn', 'shellIn', 'pump', 'bolt', 'rocketIn', 'reloaded' (for sounds / animation)
    }

    get total() { return this.mag + this.reserve; }
    get full() { return this.mag >= this.def.mag; }
    get reloading() { return !!this.reload; }
    // 0..1 through the current reload (shotgun: through the whole shell-by-shell sequence)
    get reloadProgress() {
        const r = this.reload;
        if (!r) return 0;
        return clamp(r.t / Math.max(r.dur, 1e-3), 0, 1);
    }

    canReload() { return !this.reload && this.def.fire !== 'throw' && this.reserve > 0 && this.mag < this.def.mag; }

    startReload() {
        if (!this.canReload()) return false;
        const d = this.def;
        if (d.fire === 'pump') {
            const n = Math.min(d.mag - this.mag, this.reserve);
            this.reload = { kind: 'shell', t: 0, stage: 'start', stageT: 0, n, dur: d.shellStart + n * d.shell + d.shellEnd + (this.chambered ? 0 : d.pump), stop: false };
        } else if (d.fire === 'single') {
            this.reload = { kind: 'rocket', t: 0, dur: d.reload };
        } else {
            const empty = this.mag === 0;
            this.reload = { kind: empty ? 'empty' : 'mag', t: 0, dur: empty ? d.reloadEmpty : d.reload, magOut: false };
        }
        return true;
    }

    cancelReload() { this.reload = null; }

    // Advance by dt with the trigger up or down. Returns how many rounds leave the muzzle now (an automatic
    // fires every round it owes, so its rate holds at any frame rate; a fresh pull is needed for the others).
    update(dt, trigger) {
        const d = this.def;
        this.events.length = 0;
        this.dry = false;
        this.heat *= Math.exp(-d.spread.recover * dt); // (sustained fire builds bloom up toward max)
        if (this.cycle > 0 || trigger) this.cycle -= dt;
        if (this.pump > 0) {
            this.pump -= dt;
            if (this.pump <= 0) { this.pump = 0; this.chambered = this.mag > 0; }
        }
        const press = trigger && !this.held;
        this.held = trigger;
        if (!trigger) { this.shots = 0; if (this.cycle < 0) this.cycle = 0; }
        if (this.reload) {
            // pulling the trigger stops a shotgun reload after the shell going in now
            if (this.reload.kind === 'shell' && press && this.mag > 0) this.reload.stop = true;
            this.advanceReload(dt);
            if (this.reload) return 0;
        }
        let n = 0;
        if (d.fire === 'auto') {
            if (trigger && this.mag > 0) while (this.cycle <= 0 && this.mag > 0 && n < 4) { n++; this.mag--; this.cycle += 60 / d.rpm; }
            else if (press && this.mag <= 0) this.dry = true;
        } else if (d.fire === 'semi') {
            if (press && this.cycle <= 0) {
                if (this.mag > 0) { n = 1; this.mag--; this.cycle = 60 / d.rpm; } else this.dry = true;
            }
        } else if (d.fire === 'pump') {
            if (press && this.cycle <= 0 && this.pump <= 0) {
                if (this.chambered && this.mag > 0) {
                    n = 1; this.mag--; this.chambered = false; this.pump = d.pump; this.cycle = d.pump + 0.08;
                    this.events.push('pump');
                } else this.dry = true;
            }
        } else if (d.fire === 'single') {
            if (press && this.cycle <= 0) {
                if (this.mag > 0) { n = 1; this.mag--; this.cycle = 0.6; } else this.dry = true;
            }
        }
        if (n) {
            this.shots += n;
            this.heat = Math.min(d.spread.max, this.heat + d.spread.perShot * n);
        }
        if (this.cycle < -0.25) this.cycle = -0.25; // a hitch can't bank a whole burst
        return n;
    }

    advanceReload(dt) {
        const d = this.def, r = this.reload;
        r.t += dt;
        if (r.kind === 'shell') {
            r.stageT += dt;
            if (r.stage === 'start' && r.stageT >= d.shellStart) { r.stage = 'shells'; r.stageT = 0; }
            while (r.stage === 'shells' && r.stageT >= d.shell) {
                r.stageT -= d.shell;
                if (this.reserve > 0 && this.mag < d.mag) { this.mag++; this.reserve--; this.events.push('shellIn'); }
                if (r.stop || this.reserve <= 0 || this.mag >= d.mag) { r.stage = 'end'; r.stageT = 0; }
            }
            if (r.stage === 'end' && r.stageT >= d.shellEnd + (this.chambered ? 0 : d.pump)) {
                if (!this.chambered && this.mag > 0) { this.chambered = true; this.events.push('pump'); }
                this.reload = null;
                this.events.push('reloaded');
            }
            // (the whole sequence is shorter when it stops early: keep the progress readout honest)
            if (this.reload) r.dur = Math.max(r.t + 0.01, r.dur);
            return;
        }
        if (r.kind === 'rocket') {
            if (r.t >= r.dur) { const k = Math.min(d.mag - this.mag, this.reserve); this.mag += k; this.reserve -= k; this.reload = null; this.events.push('rocketIn', 'reloaded'); }
            return;
        }
        // magazine: out at 25 %, the new one seats at 70 % (ammo counts from then), bolt / slide at the end
        if (!r.magOut && r.t >= r.dur * 0.25) { r.magOut = true; this.events.push('magOut'); }
        if (!r.magIn && r.t >= r.dur * 0.7) {
            r.magIn = true;
            const k = Math.min(d.mag - this.mag, this.reserve);
            this.mag += k; this.reserve -= k;
            this.events.push('magIn');
        }
        if (r.t >= r.dur) { if (r.kind === 'empty') this.events.push('bolt'); this.reload = null; this.events.push('reloaded'); }
    }
}

// ── Ballistics ──
// Rocket state { pos, vel (Vector3), age, dist }. Advance by dt (the caller tests the segment for hits).
export function stepRocket(r, dt, R = ROCKET) {
    const sp = r.vel.length(), t0 = r.age, t1 = r.age + dt;
    if (sp > 1e-6) {
        _t1.copy(r.vel).divideScalar(sp);
        // thrust for the part of this step the sustainer burns (so the top speed doesn't depend on the frame rate)
        const burn = Math.max(0, Math.min(t1, R.ignite + R.burn) - Math.max(t0, R.ignite));
        if (burn > 0) r.vel.addScaledVector(_t1, R.accel * burn);
        r.vel.addScaledVector(_t1, -sp * sp * R.drag * dt);
    }
    // the sustainer's thrust holds most of the drop off while it burns (and a moment after)
    const held = clamp(R.ignite + R.burn + R.coast - t0, 0, dt);
    r.vel.y -= G * (R.gBoost * held + (dt - held));
    r.pos.addScaledVector(r.vel, dt);
    r.age += dt;
    r.dist = (r.dist || 0) + sp * dt;
    return r;
}

// Grenade state { pos, vel, fuse, rest, bounces }. env.ground(x, z, out) → out { h, nx, ny, nz } (the surface
// under a point and its normal); env.solid(x, y, z) → a building's outward normal { x, z } there, or null.
// Returns the number of hard bounces this step (for the clink).
const _gn = { h: 0, nx: 0, ny: 1, nz: 0 };
export function stepGrenade(g, dt, env, D = GRENADE) {
    g.fuse -= dt;
    if (g.rest) return 0;
    let bounces = 0;
    const steps = Math.max(1, Math.ceil(g.vel.length() * dt / 0.2));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
        g.vel.y -= G * h;
        g.vel.multiplyScalar(1 - D.drag * h);
        const nx = g.pos.x + g.vel.x * h, ny = g.pos.y + g.vel.y * h, nz = g.pos.z + g.vel.z * h;
        // walls: bounce off the face it went through
        const wall = env.solid ? env.solid(nx, ny, nz) : null;
        if (wall) {
            const vn = g.vel.x * wall.x + g.vel.z * wall.z;
            if (vn < 0) {
                g.vel.x -= (1 + D.restitution) * vn * wall.x; g.vel.z -= (1 + D.restitution) * vn * wall.z;
                g.vel.multiplyScalar(0.7);
                if (-vn > 2) bounces++;
            }
            continue;
        }
        g.pos.set(nx, ny, nz);
        const s = env.ground(g.pos.x, g.pos.z, _gn);
        const floor = s.h + D.radius;
        if (g.pos.y < floor) {
            g.pos.y = floor;
            const vn = g.vel.x * s.nx + g.vel.y * s.ny + g.vel.z * s.nz;
            if (vn < 0) {
                // reflect the normal part (with restitution), scrub the tangential part (friction)
                g.vel.x -= vn * s.nx; g.vel.y -= vn * s.ny; g.vel.z -= vn * s.nz;
                g.vel.multiplyScalar(1 - D.friction * Math.min(1, -vn / 6 + 0.25));
                const e = -vn > 1.5 ? D.restitution : 0;
                g.vel.x -= e * vn * s.nx; g.vel.y -= e * vn * s.ny; g.vel.z -= e * vn * s.nz;
                if (-vn > 1.5) bounces++;
            }
            // rolling: slows down (and settles) on the ground
            g.vel.multiplyScalar(Math.exp(-1.6 * h));
            if (g.vel.lengthSq() < 0.09 && s.ny > 0.8) { g.vel.set(0, 0, 0); g.rest = true; break; }
        }
    }
    g.bounces = (g.bounces || 0) + bounces;
    return bounces;
}

// Launch velocity that lands a throw (or a lob) of speed v from `from` on `to`: the flatter arc, or the high one.
// null when it can't reach. { x, y, z, angle, time }
export function solveThrow(from, to, v, high = false) {
    const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y, d = Math.hypot(dx, dz);
    if (d < 1e-3) return { x: 0, y: v, z: 0, angle: Math.PI / 2, time: 2 * v / G };
    const v2 = v * v, disc = v2 * v2 - G * (G * d * d + 2 * dy * v2);
    if (disc < 0) return null;
    const ang = Math.atan2(v2 + (high ? 1 : -1) * Math.sqrt(disc), G * d);
    const c = Math.cos(ang);
    return { x: dx / d * v * c, y: v * Math.sin(ang), z: dz / d * v * c, angle: ang, time: d / (v * c) };
}

// The velocity a thrown grenade leaves the hand with: along the view, lofted a little, plus the thrower's own
export function throwVelocity(viewDir, out = new THREE.Vector3(), carry = null, D = GRENADE) {
    out.copy(viewDir);
    out.y += D.loft;
    out.normalize().multiplyScalar(D.speed);
    if (carry) out.addScaledVector(carry, 0.8);
    return out;
}

// ── AI marksmanship ──
// Aim error (rad, standard deviation) for a soldier: skill 0..1 (difficulty), the target's speed across the
// line of fire (m/s), whether the shooter moves, `settle` 1 → 0 over the first second on a new target,
// `suppressed` 0..1 (rounds snapping past). A weapon's own spread adds in quadrature.
export function aimSigma({ skill = 0.6, targetSpeed = 0, moving = false, settle = 0, suppressed = 0, spread = 0 } = {}) {
    let s = 0.016 - 0.012 * clamp(skill, 0, 1);
    s += Math.min(targetSpeed, 9) * 0.0007;
    if (moving) s += 0.012;
    s += clamp(settle, 0, 1) * 0.02;
    s += clamp(suppressed, 0, 1) * 0.012;
    return Math.hypot(s, spread * 0.5);
}
// the chance that a round with aim error sigma lands within `radius` (m) of a point `dist` away (Rayleigh)
export function hitProbability(sigma, dist, radius) {
    const sd = Math.max(sigma * dist, 1e-6);
    return 1 - Math.exp(-(radius * radius) / (2 * sd * sd));
}
// a Gaussian-ish random offset (Box-Muller)
export function gauss(rnd = Math.random) {
    const u = Math.max(rnd(), 1e-9), v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Where a round hits a person (standing / crouched): a head sphere on top of a body capsule ──
export const BODY = {
    stand: { head: 1.62, headR: 0.13, body0: 0.12, body1: 1.44, bodyR: 0.24 },
    crouch: { head: 1.12, headR: 0.13, body0: 0.12, body1: 0.98, bodyR: 0.28 },
    prone: { head: 0.3, headR: 0.13, body0: 0.1, body1: 0.3, bodyR: 0.3 },
};

// the ammo a weapon starts a life with: magazine + reserve (for the HUD's "30 / 180")
export function startingAmmo(id) { const d = weaponDef(id); return { mag: d.mag, reserve: d.reserve }; }

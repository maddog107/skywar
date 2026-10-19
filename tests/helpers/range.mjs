// A weapons range for the stores tests (stores.js, weapons.js): the real Weapons over the real terrain, ground
// targets and ships that record what hit them, and a launcher — a jet flying a straight line, with the frame a
// weapon needs (forward / up / right) — that fires its type's own stores. Nothing else in the world.
import { src } from './setup.mjs';
import { arenaGame } from './arena.mjs';

const THREE = await import('three');
const { AIRCRAFT } = await src('config.js');
const { terrainHeight } = await src('world.js');
const { armAircraft } = await src('stores.js');
export const V = (x, y, z) => new THREE.Vector3(x, y, z);

// the range: flat-water sea below 0, the terrain elsewhere; ground targets in g.ground.targets
export function range({ weather = null } = {}) {
    const g = arenaGame();
    g.ground = { targets: [] };
    g.surfaceAt = (x, z) => { const h = terrainHeight(x, z); return h < 0 ? { h: 0, water: true } : { h }; };
    g.weather = weather;
    g.shake = 0;
    g.movers = [];
    g.launchers = [];
    g.run = (secs, until = () => false, dt = 1 / 60) => {
        for (let t = 0; t < secs; t += dt) {
            g.time += dt;
            for (const L of g.launchers) if (L.alive) { L.pos.addScaledVector(L.vel, dt); if (L.turn) L.turn(dt); }
            for (const u of g.movers) if (u.alive) u.pos.addScaledVector(u.vel, dt);
            g.weapons.update(dt);
            if (until()) return t;
        }
        return Infinity;
    };
    return g;
}

// a target on the ground at (x, z) (y: on the terrain), or a ship (a box hitTest at the waterline)
export function groundTarget(g, x, z, { hp = 1e6, radius = 10, type = 'bunker', team = 'red', vel = null, ship = false, L = 150, B = 18 } = {}) {
    const h = Math.max(terrainHeight(x, z), 0);
    const t = {
        pos: V(x, h + (ship ? 4 : radius * 0.4), z), vel: vel ? vel.clone() : V(0, 0, 0), radius, hitRadius: radius, type, team, alive: true, hp, maxHp: hp,
        isGround: true, incoming: [], hits: [], name: type.toUpperCase(),
        damage(a, s, kind) { this.hits.push({ a, kind, t: g.time }); this.hp -= a; if (this.hp <= 0) this.alive = false; },
        get dmg() { return this.hits.reduce((s, h) => s + h.a, 0); },
    };
    if (ship) {
        t.isShip = true; t.def = { cls: 'ship', L, B };
        t.hitTest = (p) => Math.abs(p.x - t.pos.x) < B / 2 && Math.abs(p.z - t.pos.z) < L / 2 && p.y < 22 && p.y > -2;
    }
    g.ground.targets.push(t);
    if (vel) g.movers.push(t);
    return t;
}

// a jet of `type` flying straight along dir at `speed` from pos, armed with its `preset` loadout. turn(dt): its own
// manoeuvre, if any (it rotates its frame and velocity)
export function launcher(g, type, pos, dir, { speed = 230, team = 'blue', preset = 'strike' } = {}) {
    const d = dir.clone().normalize();
    const L = {
        type, spec: AIRCRAFT[type], pos: pos.clone(), vel: d.clone().multiplyScalar(speed), team, alive: true, incoming: [],
        quat: new THREE.Quaternion().setFromUnitVectors(V(0, 0, -1), d), rig: { halfSpan: 5 },
        getForward(o) { return o.set(0, 0, -1).applyQuaternion(this.quat); },
        getUp(o) { return o.set(0, 1, 0).applyQuaternion(this.quat); },
        getRight(o) { return o.set(1, 0, 0).applyQuaternion(this.quat); },
        // point it (and its flight path) along a new direction
        face(dir2) { const n = dir2.clone().normalize(); this.quat.setFromUnitVectors(V(0, 0, -1), n); this.vel.copy(n).multiplyScalar(this.vel.length()); },
    };
    armAircraft(L, preset);
    g.launchers.push(L);
    return L;
}

// a spot of open sea: a 30 km line along +x at z with no land on it (and its start)
export function seaLine(len = 32000) {
    for (let z = -60000; z <= 60000; z += 2000) for (let x0 = -60000; x0 <= 60000 - len; x0 += 4000) {
        let ok = true;
        for (let x = x0; x <= x0 + len && ok; x += 250) if (terrainHeight(x, z) > -3) ok = false;
        if (ok) return { x0, z };
    }
    return null;
}
// a stretch of land: a len m line along +x at some z, all of it dry and lower than maxH
export function landLine(len = 17000, maxH = 1500) {
    for (let z = -60000; z <= 60000; z += 1000) {
        let start = null;
        for (let x = -60000; x <= 60000; x += 250) {
            const h = terrainHeight(x, z);
            if (h > 5 && h < maxH) { if (start === null) start = x; if (x - start >= len) return { x0: start, z }; } else start = null;
        }
    }
    return null;
}

export { THREE, terrainHeight };

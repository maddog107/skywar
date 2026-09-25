// ═══════════════════════════════════════════════════════════════
// Things in the air that aren't combat aircraft but can still be shot down:
// the airbase helicopters and the scheduled air traffic. Each registers here
// with { pos, radius, alive, hit(amount, game, source) }; weapons test bullets,
// missiles and blasts against the list, and the player can fly into them.
// A shot-down one falls trailing smoke and fire and explodes where it lands.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight } from './world.js';
import { rand } from './util.js';

export const AIR_TARGETS = [];
export function registerAirTarget(t) { if (!AIR_TARGETS.includes(t)) AIR_TARGETS.push(t); }
export function unregisterAirTarget(t) { const i = AIR_TARGETS.indexOf(t); if (i >= 0) AIR_TARGETS.splice(i, 1); }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

// does the segment a→b pass within r of c?
export function segHitsSphere(a, b, c, r) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L2 = dx * dx + dy * dy + dz * dz;
    let t = L2 > 0 ? ((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t - c.x, py = a.y + dy * t - c.y, pz = a.z + dz * t - c.z;
    return px * px + py * py + pz * pz < r * r;
}

// the fall: carries on with the speed it had, gravity takes over, tumbling, smoke and fire behind it
export class Downed {
    constructor(mesh, vel, game, { spin = 1.5, size = 1 } = {}) {
        this.mesh = mesh; this.game = game; this.size = size;
        this.vel = vel.clone();
        this.spin = new THREE.Vector3(rand(-0.3, 0.3), rand(-1, 1) * spin, rand(0.6, 1.2) * (Math.random() < 0.5 ? -1 : 1));
        this.puff = 0;
        this.done = false;
        const fx = game.effects;
        fx.explosion(mesh.position, 0.6 + size * 0.4);
        fx.debrisBurst(mesh.position, this.vel, 6, 0.8 + size * 0.3);
        game.audio.boom(game.camera.position.distanceTo(mesh.position), 1);
    }

    update(dt) {
        if (this.done) return false;
        const m = this.mesh, g = this.game, fx = g.effects;
        this.vel.y -= 9.8 * dt;
        this.vel.multiplyScalar(1 - 0.08 * dt);
        m.position.addScaledVector(this.vel, dt);
        _q.setFromEuler(new THREE.Euler(this.spin.x * dt, this.spin.y * dt, this.spin.z * dt));
        m.quaternion.multiply(_q);
        this.puff -= dt;
        if (this.puff <= 0) {
            this.puff = 0.05;
            fx.puffSmoke(m.position, _v.copy(this.vel).multiplyScalar(0.1), 2 + this.size, 0.1, 3, 0.6);
            fx.puffFire(m.position, _v.copy(this.vel).multiplyScalar(0.2), 2 + this.size);
        }
        const ground = Math.max(terrainHeight(m.position.x, m.position.z), 0);
        if (m.position.y > ground + 1) return true;
        // impact
        m.position.y = ground;
        m.visible = false;
        this.done = true;
        const at = _v2.copy(m.position);
        if (terrainHeight(at.x, at.z) < 0) fx.waterSplash(at, 1 + this.size);
        else {
            fx.explosion(at, 1.2 + this.size);
            fx.debrisBurst(at, _v.set(0, 30, 0), 8, 1 + this.size * 0.4);
            // whatever it lands on takes the hit too
            const towns = g.world.towns;
            if (towns) { towns.buildings && towns.buildings.explode(at, 20 + this.size * 10, 400, g, null); towns.traffic.blast(at, 12 + this.size * 6, g); }
        }
        g.audio.boom(g.camera.position.distanceTo(at), 1.5);
        return false;
    }
}

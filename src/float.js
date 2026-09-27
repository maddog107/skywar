// ═══════════════════════════════════════════════════════════════
// Floating things: anything resting on the sea or a lake rides the waves of water.js — heaving with the surface
// under it and tilted to the surface's slope, averaged over its size (a big wreck bridges the short waves) and
// eased (it has mass). Used for ditched aircraft (aircraft.js), wreckage and ejected pilots (damage.js).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { waterSample, WATER } from './water.js';

const _q = new THREE.Quaternion(), _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const S = { h: 0, nx: 0, ny: 1, nz: 0, vx: 0, vy: 0, vz: 0, jac: 1, x0: 0, z0: 0, depth: 0 };

// The surface under (x, z) as something `size` metres long feels it: height (m) and unit normal into n
export function surfaceUnder(x, z, size, n = _n) {
    const w = waterSample(x, z, WATER.t, S, Math.max(0, size * 0.7));
    n.set(w.nx, w.ny, w.nz);
    return w.h;
}

// The rotation that tilts +Y onto the water's normal under (x, z), eased toward it at `rate` (1/s): state.tilt
// (a Quaternion kept on the object) holds the current one. Multiply it in front of the object's own yaw.
export function waveTilt(state, x, z, size, dt, rate = 2.5) {
    const t = state.tilt || (state.tilt = new THREE.Quaternion());
    surfaceUnder(x, z, size, _n);
    _q.setFromUnitVectors(_up, _n);
    t.slerp(_q, 1 - Math.exp(-rate * Math.max(dt, 0)));
    return t;
}

// A thing floating free (a piece of wreckage, a pilot in a life vest): it bobs on the waves, drifts with the wind,
// and — if `sinkAfter` is set — slowly goes under and is gone. obj: an Object3D; opts: size (m), float (how far it
// sits out of the water, m), sinkAfter (s, or Infinity), yaw (rad), spin (rad/s)
export class Floater {
    constructor(obj, { size = 2, float = 0.2, sinkAfter = Infinity, yaw = 0, spin = 0, drift = null } = {}) {
        this.obj = obj; this.size = size; this.float = float; this.sinkAfter = sinkAfter;
        this.yaw = yaw; this.spin = spin; this.drift = drift; // drift: a Vector3 (the game's wind) or null
        this.t = 0; this.sink = 0; this.gone = false;
        this.heave = null;
    }
    update(dt) {
        const o = this.obj;
        this.t += dt;
        if (this.t > this.sinkAfter) this.sink += dt * 0.35; // going down (m/s)
        if (this.drift) { o.position.x += this.drift.x * 0.03 * dt; o.position.z += this.drift.z * 0.03 * dt; }
        this.yaw += this.spin * dt;
        this.spin *= Math.exp(-0.2 * dt);
        const h = surfaceUnder(o.position.x, o.position.z, this.size, _n);
        // heave with a little lag (it has mass), then sit at its freeboard
        this.heave = this.heave == null ? h : this.heave + (h - this.heave) * (1 - Math.exp(-3 * dt));
        o.position.y = this.heave + this.float - this.sink;
        const tilt = waveTilt(this, o.position.x, o.position.z, this.size, dt);
        o.quaternion.setFromAxisAngle(_up, this.yaw).premultiply(tilt);
        if (this.sink > this.size + 6) this.gone = true;
        return !this.gone;
    }
}

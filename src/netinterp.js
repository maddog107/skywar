// ═══════════════════════════════════════════════════════════════
// Multiplayer: where a remote aircraft is *now*, from the snapshots its owner sent (docs/MULTIPLAYER.md).
//
// Snapshots arrive ~20 times a second, late by the network and in bunches (the relay batches them), each stamped with
// its sender's clock. ClockSync turns a sender's time into ours; InterpBuffer keeps the last few snapshots and is
// sampled a little in the past (netproto.js INTERP_DELAY), between two of them: position along a Hermite curve
// through both positions and velocities (a turn stays an arc, not a polygon), orientation by slerp. When the
// newest snapshot is older than the time asked for it coasts on the last velocity (and the turn it was in) for at
// most EXTRAP_MAX seconds, then holds still.
// Plain numbers, no allocation after construction, no three.js.
// ═══════════════════════════════════════════════════════════════
import { EXTRAP_MAX } from './netproto.js';

// how sample() found the pose
export const MODE = { NONE: 0, INTERP: 1, EXTRAP: 2, HELD: 3 };

// A sender's clock against ours: offset = (when we got it) − (when it says it was sent), taken from the quickest
// deliveries (a late packet says nothing about the clocks), creeping up slowly so a path that got slower for good
// is followed. sender time + offset = our time.
export class ClockSync {
    constructor() { this.offset = null; }
    update(sent, received) {
        const d = received - sent;
        if (this.offset === null || d < this.offset) this.offset = d;
        else this.offset += (d - this.offset) * 0.004; // (slow: every millisecond it wanders is 30 cm of a jet at Mach 1)
        return this.offset;
    }
}

const FIELDS = ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'qx', 'qy', 'qz', 'qw'];

export class InterpBuffer {
    constructor(size = 16) {
        this.size = size;
        this.snaps = [];
        for (let i = 0; i < size; i++) this.snaps.push({ t: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1, thr: 0, flags: 0, hp: 0, g: 1, k: 1 });
        this.head = -1;   // index of the newest
        this.count = 0;
    }

    get newest() { return this.count ? this.snaps[this.head] : null; }
    at(k) { return this.snaps[(this.head - k + this.size * 2) % this.size]; } // k = 0: the newest

    // t: the sender's time (s). Out-of-order or repeated snapshots are ignored.
    push(t, s) {
        if (this.count && t <= this.snaps[this.head].t) return false;
        const prev = this.count ? this.snaps[this.head] : null;
        this.head = (this.head + 1) % this.size;
        if (this.count < this.size) this.count++;
        const d = this.snaps[this.head];
        d.t = t;
        for (const k of FIELDS) d[k] = s[k] ?? (k === 'qw' ? 1 : 0);
        d.thr = s.thr ?? 0; d.flags = s.flags ?? 0; d.hp = s.hp ?? 0; d.g = s.g ?? 1;
        d.k = prev ? pace(prev, d) : 1;
        return true;
    }

    clear() { this.head = -1; this.count = 0; }

    // The pose at sender time t → out { px…, vx…, qx…, thr, flags, hp, g, age }; returns a MODE. `age` is how far t
    // is past the newest snapshot (≤ 0 while interpolating).
    sample(t, out) {
        if (!this.count) return MODE.NONE;
        const b = this.snaps[this.head];
        out.age = t - b.t;
        if (t >= b.t) {
            // past the newest: coast
            const e = Math.min(t - b.t, EXTRAP_MAX);
            let ax = 0, ay = 0, az = 0;
            const a = this.count > 1 ? this.at(1) : null, dt = a ? b.t - a.t : 0;
            if (a && dt > 1e-3 && dt < 0.4) {
                // the acceleration it had between the last two (a turning jet keeps turning), capped at ~12 g
                ax = (b.vx - a.vx) / dt; ay = (b.vy - a.vy) / dt; az = (b.vz - a.vz) / dt;
                const al = Math.hypot(ax, ay, az);
                if (al > 120) { ax *= 120 / al; ay *= 120 / al; az *= 120 / al; }
            }
            // (at the pace it was really covering ground: a sender whose simulation runs slow moves less than its speed says)
            const k = b.k;
            out.px = b.px + (b.vx * e + 0.5 * ax * e * e) * k;
            out.py = b.py + (b.vy * e + 0.5 * ay * e * e) * k;
            out.pz = b.pz + (b.vz * e + 0.5 * az * e * e) * k;
            out.vx = (b.vx + ax * e) * k; out.vy = (b.vy + ay * e) * k; out.vz = (b.vz + az * e) * k;
            // and the rotation it had, for at most one more interval
            if (a && dt > 1e-3 && dt < 0.4 && e > 0) slerp(a, b, 1 + Math.min(e / dt, 1.5), out);
            else { out.qx = b.qx; out.qy = b.qy; out.qz = b.qz; out.qw = b.qw; }
            out.thr = b.thr; out.flags = b.flags; out.hp = b.hp; out.g = b.g;
            if (t - b.t > EXTRAP_MAX) { out.vx = out.vy = out.vz = 0; return MODE.HELD; }
            return e > 0 ? MODE.EXTRAP : MODE.INTERP;
        }
        // the two snapshots either side of t
        let k = 1;
        while (k < this.count && this.at(k).t > t) k++;
        if (k >= this.count) {
            // older than everything kept (just joined, or a long stall): the oldest as it is
            const o = this.at(this.count - 1);
            for (const f of FIELDS) out[f] = o[f];
            out.thr = o.thr; out.flags = o.flags; out.hp = o.hp; out.g = o.g;
            return MODE.INTERP;
        }
        const p0 = this.at(k), p1 = this.at(k - 1), dt = p1.t - p0.t, u = (t - p0.t) / dt, pc = p1.k;
        if (dt < 0.5) {
            // cubic Hermite through both positions with both velocities (the velocities at the pace the ground was
            // really covered: with a slow sender's full speed for tangents the curve would run ahead and come back)
            const u2 = u * u, u3 = u2 * u;
            const h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * dt * pc, h01 = -2 * u3 + 3 * u2, h11 = (u3 - u2) * dt * pc;
            out.px = h00 * p0.px + h10 * p0.vx + h01 * p1.px + h11 * p1.vx;
            out.py = h00 * p0.py + h10 * p0.vy + h01 * p1.py + h11 * p1.vy;
            out.pz = h00 * p0.pz + h10 * p0.vz + h01 * p1.pz + h11 * p1.vz;
        } else {
            // a long gap (it stood still, or we lost it for a while): a straight line, no overshoot
            out.px = p0.px + (p1.px - p0.px) * u; out.py = p0.py + (p1.py - p0.py) * u; out.pz = p0.pz + (p1.pz - p0.pz) * u;
        }
        out.vx = (p0.vx + (p1.vx - p0.vx) * u) * pc; out.vy = (p0.vy + (p1.vy - p0.vy) * u) * pc; out.vz = (p0.vz + (p1.vz - p0.vz) * u) * pc;
        slerp(p0, p1, u, out);
        out.thr = p0.thr + (p1.thr - p0.thr) * u;
        out.g = p0.g + (p1.g - p0.g) * u;
        out.hp = p1.hp;
        out.flags = u < 0.5 ? p0.flags : p1.flags;
        return MODE.INTERP;
    }
}

// The pace between two snapshots: the ground really covered over what their velocities say it should have been.
// 1 for a sender whose simulation keeps up with its clock; less when it doesn't (a machine below ~20 frames a second
// steps less game time than passes, a page that stalled for part of the interval); never much above 1.
function pace(a, b) {
    const dt = b.t - a.t;
    const want = 0.5 * Math.hypot(a.vx + b.vx, a.vy + b.vy, a.vz + b.vz) * dt;
    if (!(dt > 1e-4) || want < 0.5) return 1; // (standing or creeping: nothing to scale)
    const k = Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz) / want;
    return k > 1.25 ? 1.25 : k;
}

// quaternion a → b at u (u > 1 carries the rotation on past b), the short way round; out.qx … out.qw, unit length
export function slerp(a, b, u, out) {
    let bx = b.qx, by = b.qy, bz = b.qz, bw = b.qw;
    let cos = a.qx * bx + a.qy * by + a.qz * bz + a.qw * bw;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let ka, kb;
    if (cos > 0.9995) { ka = 1 - u; kb = u; } // nearly the same: a straight blend (renormalised below)
    else {
        const th = Math.acos(cos), sn = Math.sin(th);
        ka = Math.sin((1 - u) * th) / sn; kb = Math.sin(u * th) / sn;
    }
    const x = ka * a.qx + kb * bx, y = ka * a.qy + kb * by, z = ka * a.qz + kb * bz, w = ka * a.qw + kb * bw;
    const l = Math.hypot(x, y, z, w) || 1;
    out.qx = x / l; out.qy = y / l; out.qz = z / l; out.qw = w / l;
    return out;
}

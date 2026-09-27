// ═══════════════════════════════════════════════════════════════
// Air-to-air refuelling (air support, airsupport.js): tanker tracks, the flying boom and the hose-and-drogue units,
// the receiver's rendezvous and station keeping, fuel transfer, and the radio procedure (ATP-3.3.4.2 / ATP-56):
//  • rendezvous: the tanker flies a racetrack (anchor); the receiver is steered to intercept it 1,000 ft below,
//    joins in the OBSERVATION position off the tanker's left wing, and is cleared to PRE-CONTACT (boom: ~50 ft aft
//    and a little below the contact position; drogue: "cleared astern", a few metres behind the basket)
//  • boom (KC-135R): "cleared contact" — the receiver closes slowly (~1 ft/s) and holds the contact position; the
//    boom operator flies the nozzle onto the receptacle and plugs in. Envelope from the model's rig (rigparts.js):
//    elevation 20–40° below the fuselage axis (ideal 30°), azimuth within ±15° (the stops; ±10° is the normal
//    envelope), telescope 6–18 ft out (ideal 12 ft). Out of it: an automatic disconnect. Pilot director lights under
//    the tanker's belly command UP / DOWN (elevation) and FORE / AFT (telescope), green in the middle, amber toward
//    the limits, red at them. 6,500 lb/min.
//  • hose and drogue (KC-135 MPRS wing pods, Il-78M UPAZ-1 pods): the probe has to go into the basket at 2–5 kt of
//    closure; pushing the hose in 1–6 m (the reel takes up the slack) is the refuelling range. Signal lights on the
//    pod (STANAG 7215): red — don't make contact / breakaway; amber — cleared contact; green — fuel flowing; flashing
//    amber — inner limit (too close); steady amber after green — outer limit or transfer complete. MPRS 2,680 lb/min,
//    UPAZ-1 ~2,300 l/min.
//  • breakaway: closing too fast or too close — "BREAKAWAY, BREAKAWAY, BREAKAWAY": power back, drop down and aft.
// Model frame (rigparts.js): x toward the right wing, y up, z aft. Fuel is the game's 0..1 fraction of internal fuel;
// FUEL_KG turns it into kilograms (published internal capacities).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { REFUEL, setBoom, stowBoom } from './rigparts.js';
import { steerToward, avoidTerrain } from './ai.js';
import { thrustLapse, airDensity } from './aircraft.js';
import { clamp, damp, lerp, DEG, G } from './util.js';

export const LB = 0.4536;              // kg per pound
export const KT = 0.514444;            // m/s per knot
const FT_M = 0.3048;

// internal fuel, kg (published figures)
export const FUEL_KG = {
    f16: 3175, f2: 3700, f15: 6100, f22: 8200, f35: 8280, f35n: 8280, f4: 5900, a10: 4850, b2: 75750, e3: 65000, b52: 141000,
    rc135: 59000, fa18: 6530, ea18g: 6530, rafale: 4700, typhoon: 5000, f14: 7350, gripen: 2400, su35: 11500, a50: 80000, tu95: 76000,
    su57: 10300, mig29: 3500, mig31: 16350, j20: 12000, j10: 3950, mirage: 3160, jaguar: 3340, kc135: 90700, il78: 138000,
};
// what a tanker can give (kg) and its hoses' rates (kg/s)
export const TANKERS = {
    kc135: { give: 68000, boomRate: 6500 * LB / 60, drogueRate: 2680 * LB / 60, stations: ['boom', 'l', 'r'], altitude: 6100, arKias: 280 },
    il78: { give: 100000, drogueRate: 2300 * 0.8 / 60, stations: ['l', 'r', 'c'], altitude: 6500, arKias: 290 },
};

// the boom's contact envelope (model rig userData: pitchMin / pitchMax / yawMax degrees; boom_ext.travel metres) and
// the telescope limits: 6–18 ft out, 12 ft ideal
export function boomEnvelope(ud = {}, travel = 6) {
    const pitchMin = (ud.pitchMin ?? 20) * DEG, pitchMax = (ud.pitchMax ?? 40) * DEG, yawMax = (ud.yawMax ?? 15) * DEG;
    return {
        pitchMin, pitchMax, yawMax, yawNormal: Math.min(yawMax, 10 * DEG), ideal: (pitchMin + pitchMax) / 2,
        extMin: Math.min(6 * FT_M, travel * 0.3), extMax: Math.min(18 * FT_M, travel - 0.05), extIdeal: Math.min(12 * FT_M, travel * 0.6), travel,
    };
}

// ═════════════ Racetracks ═════════════
// A tanker / AWACS orbit: two straight legs of `leg` metres joined by half circles of radius R. (x, z) is the
// centre, heading (rad, 0 = north / −z, + toward +x) the direction of the first leg, dir +1 turns right, −1 left.
export function makeTrack({ x, z, heading = Math.PI / 2, leg = 40000, R = 8000, alt = 6000, speed = 200, dir = 1 }) {
    return { x, z, heading, leg, R, alt, speed, dir };
}
export const trackLength = (T) => 2 * T.leg + 2 * Math.PI * T.R;
// position (outP: x, z) and unit direction (outD: x, z) at arc length s round the track
export function trackPoint(T, s, outP, outD) {
    const P = trackLength(T);
    s = ((s % P) + P) % P;
    const fx = Math.sin(T.heading), fz = -Math.cos(T.heading);   // first leg's direction
    const rx = -fz * T.dir, rz = fx * T.dir;                      // toward the turn centres (inside of the turns)
    const half = T.leg / 2;
    let px, pz, dx, dz;
    if (s < T.leg) {
        // leg 1: from −half to +half along f, offset −R toward the outside
        const u = s - half;
        px = T.x + fx * u - rx * T.R; pz = T.z + fz * u - rz * T.R; dx = fx; dz = fz;
    } else if (s < T.leg + Math.PI * T.R) {
        // turn 1 round the centre at +half along f
        const a = (s - T.leg) / T.R;                              // 0..π
        const cx = T.x + fx * half, cz = T.z + fz * half;
        // start point: cx − r·R; the radius vector turns toward f then to +r
        const ox = -rx * Math.cos(a) + fx * Math.sin(a), oz = -rz * Math.cos(a) + fz * Math.sin(a);
        px = cx + ox * T.R; pz = cz + oz * T.R;
        dx = fx * Math.cos(a) + rx * Math.sin(a); dz = fz * Math.cos(a) + rz * Math.sin(a);
    } else if (s < 2 * T.leg + Math.PI * T.R) {
        // leg 2: back along −f, offset +R
        const u = half - (s - T.leg - Math.PI * T.R);
        px = T.x + fx * u + rx * T.R; pz = T.z + fz * u + rz * T.R; dx = -fx; dz = -fz;
    } else {
        const a = (s - 2 * T.leg - Math.PI * T.R) / T.R;
        const cx = T.x - fx * half, cz = T.z - fz * half;
        const ox = rx * Math.cos(a) - fx * Math.sin(a), oz = rz * Math.cos(a) - fz * Math.sin(a);
        px = cx + ox * T.R; pz = cz + oz * T.R;
        dx = -fx * Math.cos(a) - rx * Math.sin(a); dz = -fz * Math.cos(a) - rz * Math.sin(a);
    }
    if (outP) { outP.x = px; outP.z = pz; }
    if (outD) { outD.x = dx; outD.z = dz; }
    return s;
}
const _tp = { x: 0, z: 0 };
// arc length of the point of the track nearest (x, z) (coarse search, then refined)
export function trackNearest(T, x, z) {
    const P = trackLength(T), n = 72;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
        const s = P * i / n;
        trackPoint(T, s, _tp, null);
        const d = (_tp.x - x) ** 2 + (_tp.z - z) ** 2;
        if (d < bd) { bd = d; best = s; }
    }
    let step = P / n / 2;
    for (let k = 0; k < 12; k++) {
        for (const s of [best - step, best + step]) {
            trackPoint(T, s, _tp, null);
            const d = (_tp.x - x) ** 2 + (_tp.z - z) ** 2;
            if (d < bd) { bd = d; best = s; }
        }
        step /= 2;
    }
    return ((best % P) + P) % P;
}
// bank (rad) the track's turns need at speed V
export const trackBank = (T, V) => Math.atan(V * V / (G * T.R));
// the turn radius for a speed and bank
export const turnRadius = (V, bank) => V * V / (G * Math.tan(bank));

// ═════════════ Frames ═════════════
const _qi = new THREE.Quaternion();
export function toWorld(ac, local, out) { return out.copy(local).applyQuaternion(ac.quat).add(ac.pos); }
export function toLocal(ac, world, out) { return out.copy(world).sub(ac.pos).applyQuaternion(_qi.copy(ac.quat).invert()); }
export function dirToLocal(ac, dir, out) { return out.copy(dir).applyQuaternion(_qi.copy(ac.quat).invert()); }

// a part's position in the model frame: its own, plus that of the airframe section it hangs on (a group with a
// position and no turn: damage.js segmentModel, rigparts.js attachRigParts)
function nodeModelPos(node, out) {
    out.copy(node.position);
    const p = node.parent;
    if (p && p.userData && p.userData.region != null) out.add(p.position);
    return out;
}

// The receiver's refuelling point in the model frame: the rig's `refuel` empty, else REFUEL (fractions of its
// length). Returns { local, kind } or null when the type can't be refuelled in flight.
export function receiverPoint(ac) {
    const n = ac.rig && ac.rig.parts && ac.rig.parts.refuel;
    if (n) return { local: nodeModelPos(n, new THREE.Vector3()), kind: n.userData.kind || 'boom' };
    const d = REFUEL[ac.type];
    if (!d) return null;
    const L = ac.spec.length;
    return { local: new THREE.Vector3(d.at[0] * L, d.at[1] * L, d.at[2] * L), kind: d.kind };
}

// Stand-ins for a tanker whose model has no rig nodes (a procedural fallback, headless tests): the file's nodes as
// normaliseGLTF leaves them, in fractions of the length (measured in the browser off models/aircraft/*.glb)
export const TANKER_RIG = {
    kc135: { boom: { at: [0, -0.0582, 0.3972], L0: 8.0, ud: { pitchMin: 20, pitchMax: 40, yawMax: 15 }, travel: 6 },
        drogues: { l: { at: [-0.4166, -0.0184, 0.2244], hose: 21, droop: 5 }, r: { at: [0.4166, -0.0184, 0.2244], hose: 21, droop: 5 } } },
    il78: { drogues: { l: { at: [-0.3305, -0.0266, 0.1937], hose: 26, droop: 6 }, r: { at: [0.3314, -0.0266, 0.1937], hose: 26, droop: 6 }, c: { at: [-0.0573, -0.0340, 0.4661], hose: 26, droop: 4 } } },
};

// A tanker's refuelling equipment in its model frame: { boom: { H, L0, env, node } | null, drogues: { l|r|c: { E, len,
// droop, node, hose, basket } } } (computed once per aircraft)
export function tankerRig(ac) {
    if (ac._tankerRig) return ac._tankerRig;
    const parts = (ac.rig && ac.rig.parts) || {};
    const fb = TANKER_RIG[ac.type] || {};
    const L = ac.spec.length;
    const out = { boom: null, drogues: {} };
    if (parts.boom) {
        const b = parts.boom, e = parts.boom_ext, nz = parts.boom_nozzle;
        const travel = e ? (e.userData.travel ?? 6) : 6;
        out.boom = {
            H: nodeModelPos(b, new THREE.Vector3()),
            L0: (e ? e.userData.rest.p[2] : 6.75) + (nz ? nz.position.z : 1.25),
            env: boomEnvelope(b.userData, travel), node: b,
        };
    } else if (fb.boom) {
        const d = fb.boom;
        out.boom = { H: new THREE.Vector3(d.at[0] * L, d.at[1] * L, d.at[2] * L), L0: d.L0, env: boomEnvelope(d.ud, d.travel), node: null };
    }
    for (const s of ['l', 'r', 'c']) {
        const n = parts['drogue_' + s];
        if (n) out.drogues[s] = { E: nodeModelPos(n, new THREE.Vector3()), len: n.userData.hose ?? 15, droop: (n.userData.droop ?? 6) * DEG, node: n, hose: parts['hose_' + s], basket: parts['basket_' + s], side: s };
        else if (fb.drogues && fb.drogues[s]) {
            const d = fb.drogues[s];
            out.drogues[s] = { E: new THREE.Vector3(d.at[0] * L, d.at[1] * L, d.at[2] * L), len: d.hose, droop: d.droop * DEG, node: null, side: s };
        }
    }
    ac._tankerRig = out;
    return out;
}

// ═════════════ Boom geometry ═════════════
// Point the boom from its hinge H (model frame) at T: pitch (rad, down), yaw (rad, right), ext (telescope, m) and
// the distance. The boom's axis: (sin yaw · cos pitch, −sin pitch, cos yaw · cos pitch) — rigparts.setBoom's.
export function boomSolve(H, T, L0, out = {}) {
    const vx = T.x - H.x, vy = T.y - H.y, vz = T.z - H.z;
    const d = Math.hypot(vx, vy, vz) || 1e-6;
    out.pitch = Math.asin(clamp(-vy / d, -1, 1));
    out.yaw = Math.atan2(vx, vz);
    out.ext = d - L0;
    out.dist = d;
    return out;
}
// the nozzle tip for a boom pose (model frame)
export function boomTip(H, L0, pitch, yaw, ext, out) {
    const L = L0 + ext;
    return out.set(H.x + Math.sin(yaw) * Math.cos(pitch) * L, H.y - Math.sin(pitch) * L, H.z + Math.cos(yaw) * Math.cos(pitch) * L);
}
// the ideal contact point for the receptacle (model frame): 30° down, on the centreline, 12 ft out
export function boomContactPoint(boom, out) { return boomTip(boom.H, boom.L0, boom.env.ideal, 0, boom.env.extIdeal, out); }

// Where a solution sits in the envelope: ok (inside the disconnect limits), why (the limit it's past), and the
// pilot director lights: elev (−1 … +1: + = the receiver should go UP), tel (+ = go FORWARD), az (+ = go RIGHT),
// each with a zone 'green' | 'amber' | 'red'
export function boomStatus(sol, env, out = {}) {
    let why = null;
    if (sol.pitch < env.pitchMin) why = 'ELEVATION UPPER LIMIT';
    else if (sol.pitch > env.pitchMax) why = 'ELEVATION LOWER LIMIT';
    else if (Math.abs(sol.yaw) > env.yawMax) why = 'AZIMUTH LIMIT';
    else if (sol.ext < env.extMin) why = 'INNER LIMIT';
    else if (sol.ext > env.extMax) why = 'OUTER LIMIT';
    out.ok = !why; out.why = why;
    // PDI: the receiver goes UP when the boom is steeper than ideal (he's low), FORWARD when it's out too far
    const eh = (env.pitchMax - env.pitchMin) / 2;
    out.elev = clamp((sol.pitch - env.ideal) / eh, -1.3, 1.3);
    out.tel = clamp((sol.ext - env.extIdeal) / ((env.extMax - env.extMin) / 2), -1.3, 1.3);
    out.az = clamp(-sol.yaw / env.yawMax, -1.3, 1.3);
    const zone = (k) => (Math.abs(k) < 0.25 ? 'green' : Math.abs(k) < 0.85 ? 'amber' : 'red');
    out.elevZone = zone(out.elev); out.telZone = zone(out.tel); out.azZone = Math.abs(sol.yaw) < env.yawNormal ? (Math.abs(out.az) < 0.3 ? 'green' : 'amber') : 'red';
    return out;
}

// ═════════════ Hose and drogue ═════════════
// The free basket (model frame): trailing `len` of hose from the exit E, drooped, plus a sway (m)
export function drogueFree(dr, k, sway, out) {
    const len = dr.len * k, a = dr.droop * k;
    return out.set(dr.E.x + sway.x, dr.E.y - Math.sin(a) * len + sway.y, dr.E.z + Math.cos(a) * len);
}
// hose pushed in (m) and its angle off the trail line (rad) for a basket at B (model frame)
export function drogueState(dr, B, out = {}) {
    const vx = B.x - dr.E.x, vy = B.y - dr.E.y, vz = B.z - dr.E.z;
    const d = Math.hypot(vx, vy, vz);
    out.pushIn = dr.len - d;
    // trail line: straight aft, drooped
    const tx = 0, ty = -Math.sin(dr.droop), tz = Math.cos(dr.droop);
    out.angle = Math.acos(clamp((vx * tx + vy * ty + vz * tz) / Math.max(d, 1e-6), -1, 1));
    return out;
}
// Signal lights for a hose in contact: green in the refuelling range (pushed in 1–6 m), flashing amber past the inner
// limit, steady amber short of the range; disconnect past full trail (the probe pulls out) or off the trail line
export const DROGUE = { rangeMin: 1.0, rangeMax: 6.0, inner: 8.0, pullOut: -0.6, angleMax: 16 * DEG, capture: 0.4, rim: 0.8, closeMin: 0.3, closeMax: 3.0 };
export function drogueLights(st) {
    if (st.pushIn < DROGUE.pullOut || st.angle > DROGUE.angleMax) return { light: 'red', flow: false, disconnect: true };
    if (st.pushIn > DROGUE.inner) return { light: 'amber-flash', flow: false, disconnect: true };
    if (st.pushIn > DROGUE.rangeMax) return { light: 'amber-flash', flow: false, disconnect: false };
    if (st.pushIn >= DROGUE.rangeMin) return { light: 'green', flow: true, disconnect: false };
    return { light: 'amber', flow: false, disconnect: false };
}
// Did the probe tip go into the basket this step? prev / tip / basket in the model frame, closure (m/s, + closing).
// 'contact' | 'rim' (hit the spokes, bounced off) | 'fast' (too fast: hose whip) | null
export function probeCapture(prev, tip, basket, closure) {
    if (!(prev.z > basket.z && tip.z <= basket.z + 0.05)) return null;
    const t = (prev.z - basket.z) / Math.max(prev.z - tip.z, 1e-6);
    const x = prev.x + (tip.x - prev.x) * clamp(t, 0, 1), y = prev.y + (tip.y - prev.y) * clamp(t, 0, 1);
    const r = Math.hypot(x - basket.x, y - basket.y);
    if (r > DROGUE.rim) return null;
    if (r > DROGUE.capture) return 'rim';
    if (closure > DROGUE.closeMax) return 'fast';
    if (closure < DROGUE.closeMin) return null;
    return 'contact';
}

// Pose a hose-and-drogue unit with its basket at B (model frame): the hose straight from the exit to the basket
const _hz = new THREE.Vector3(0, 0, 1), _hv = new THREE.Vector3(), _hu = new THREE.Vector3(), _hq = new THREE.Quaternion();
export function poseHose(dr, B, visible = true) {
    const n = dr.node;
    if (!n) return;
    const rest = n.userData.rest;
    if (rest) n.quaternion.fromArray(rest.q);
    // the exit's own frame: (B − E), in the node's rest orientation (identity for the models so far)
    _hv.set(B.x - dr.E.x, B.y - dr.E.y, B.z - dr.E.z);
    if (rest && (rest.q[0] || rest.q[1] || rest.q[2])) _hv.applyQuaternion(_hq.fromArray(rest.q).invert());
    const L = _hv.length();
    _hu.copy(_hv).divideScalar(Math.max(L, 1e-6));
    if (dr.hose) {
        dr.hose.visible = visible && L > 0.05;
        dr.hose.quaternion.setFromUnitVectors(_hz, _hu);
        dr.hose.scale.set(1, 1, Math.max(L, 1e-3));
    }
    if (dr.basket) {
        dr.basket.visible = visible;
        const r = dr.basket.userData.rest ? dr.basket.userData.rest.p : [0, 0, 0];
        dr.basket.position.set(r[0] + _hv.x, r[1] + _hv.y, r[2] + _hv.z);
        dr.basket.quaternion.setFromUnitVectors(_hz, _hu);
    }
}
export function stowHose(dr) {
    if (!dr.node) return;
    if (dr.hose) { dr.hose.visible = false; dr.hose.scale.set(1, 1, 1e-3); dr.hose.quaternion.identity(); }
    if (dr.basket) {
        const r = dr.basket.userData.rest ? dr.basket.userData.rest.p : [0, 0, 0];
        dr.basket.position.fromArray(r); dr.basket.quaternion.identity(); dr.basket.visible = false;
    }
    if (dr.node.userData.rest) dr.node.quaternion.fromArray(dr.node.userData.rest.q);
}
export { setBoom, stowBoom };

// ═════════════ Fuel ═════════════
export function fuelKg(type) { return FUEL_KG[type] ?? 5000; }
// kg/s through a station of a tanker (the boom, or a hose)
export function transferRate(tankerType, station) {
    const T = TANKERS[tankerType];
    if (!T) return 20;
    return station === 'boom' ? T.boomRate : T.drogueRate;
}
// seconds to fill a receiver at a fuel fraction
export function timeToFull(type, fuel, rate) { return Math.max(0, 1 - fuel) * fuelKg(type) / Math.max(rate, 1e-3); }

// The speed (TAS, m/s) a tanker refuels at: its AR indicated airspeed at this height, slower for a receiver that
// can't keep up (an A-10: about 80% of its top speed)
export function arSpeed(tankerType, receiverSpec, alt) {
    const T = TANKERS[tankerType] || TANKERS.kc135;
    const tas = T.arKias * KT / Math.sqrt(airDensity(alt));
    return Math.min(tas, receiverSpec ? receiverSpec.flight.speed * 0.82 : tas);
}

// ═════════════ Station keeping (the receiver's autopilot, the AI's hands) ═════════════
// Fly `ac` so that its reference point (model frame, e.g. the probe tip) sits on `target` (world), moving with
// `vRef` (the tanker's velocity): a desired velocity from the position error in the tanker's axes (along track,
// across, up), turned into stick (ai.js steerToward) and throttle (a PI loop scaled by the thrust available).
// lim: { along: [back, fwd] m/s, side, vert } closure limits; k: position gains 1/s. st keeps the integrator.
const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _vd = new THREE.Vector3(), _rp = new THREE.Vector3();
export function stationKeep(ac, c, target, refLocal, vRef, frameQ, dt, st, { k = 0.35, kSide = 0.45, along = [-8, 6], side = 5, vert = 4, assist = 0 } = {}) {
    // where the reference point is now
    toWorld(ac, refLocal, _rp);
    _e.subVectors(target, _rp);
    _f.set(0, 0, -1).applyQuaternion(frameQ); _r.set(1, 0, 0).applyQuaternion(frameQ); _u.set(0, 1, 0).applyQuaternion(frameQ);
    const ea = _e.dot(_f), es = _e.dot(_r), eu = _e.dot(_u);
    const va = clamp(ea * k, along[0], along[1]), vs = clamp(es * kSide, -side, side), vu = clamp(eu * kSide, -vert, vert);
    _vd.copy(vRef).addScaledVector(_f, va).addScaledVector(_r, vs).addScaledVector(_u, vu);
    const V = _vd.length();
    steerToward(ac, _e.copy(_vd).divideScalar(Math.max(V, 1)), c, 1, true);
    // throttle: the along-track speed error, gain sized by the thrust per unit throttle here
    const vErr = _vd.dot(_f) - ac.vel.dot(_f);
    const rho = airDensity(ac.pos.y);
    const grad = Math.max((ac.thrustMil || 5) * thrustLapse(rho, ac.spec) / 0.9, 0.5); // m/s² per unit throttle
    const kp = 0.9 / grad, ki = 0.25 / grad;
    st.i = clamp((st.i ?? 0) + vErr * ki * dt, -0.6, 0.6);
    if (st.thr0 == null) st.thr0 = clamp(ac.throttle, 0.3, 0.85);
    c.throttle = clamp(st.thr0 + st.i + vErr * kp, 0.05, 1);
    // spoilers when well overrunning
    ac.airbrake = vErr < -6;
    // a gentle hand on the position (the AI's and the autopilot's steadiness), m/s at most
    if (assist > 0) {
        ac.pos.addScaledVector(_r, clamp(es, -1, 1) * assist * dt).addScaledVector(_u, clamp(eu, -1, 1) * assist * dt);
        if (Math.abs(ea) < 3) ac.pos.addScaledVector(_f, clamp(ea, -1, 1) * assist * 0.6 * dt);
    }
    return { ea, es, eu, dist: Math.hypot(ea, es, eu) };
}

// Rendezvous: steer to intercept the tanker along its track (a point ahead of it where we'd meet), 1,000 ft below
// until close. Returns the aim point (world) and the closure.
const _ip = { x: 0, z: 0 }, _id = { x: 0, z: 0 };
export function rendezvousPoint(ac, tank, out) {
    const T = tank.track, V = Math.max(tank.ac.speed, 50), tp = tank.ac.pos, tv = tank.ac.vel;
    let tau = 0;
    const s0 = tank.s || 0;
    for (let i = 0; i < 5; i++) {
        futurePos(T, s0, V, tp, tv, tau);
        const d = Math.hypot(_ip.x - ac.pos.x, _ip.z - ac.pos.z);
        const closing = Math.max(ac.speed + V * 0.3, 60);
        tau = clamp(d / closing, 0, 600);
    }
    // (a stern conversion, not a head-on: 3 km behind its future spot)
    futurePos(T, s0, V, tp, tv, Math.max(0, tau - 3000 / V));
    return out.set(_ip.x, (T ? T.alt : tp.y) - 300, _ip.z);
}
// where the tanker will be in t s: along its racetrack, or straight on when it's off it (into _ip)
function futurePos(T, s0, V, tp, tv, t) {
    if (T) trackPoint(T, s0 + V * t, _ip, _id);
    else { _ip.x = tp.x + tv.x * t; _ip.z = tp.z + tv.z * t; }
}

// steering toward a point with an altitude, for the rendezvous leg (terrain avoidance on top)
const _dir = new THREE.Vector3();
export function flyToward(ac, c, P, speed, dt, st, minAgl = 300) {
    _dir.set(P.x - ac.pos.x, 0, P.z - ac.pos.z);
    const hd = _dir.length();
    if (hd > 1) _dir.divideScalar(hd); else _dir.set(0, 0, -1);
    const gam = clamp((P.y - ac.pos.y) / Math.max(ac.speed * 12, 600), -0.2, 0.2);
    _dir.multiplyScalar(Math.cos(gam)).setY(Math.sin(gam));
    steerToward(ac, _dir, c, 0.8, true);
    const err = speed - ac.speed;
    const rho = airDensity(ac.pos.y);
    const grad = Math.max((ac.thrustMil || 5) * thrustLapse(rho, ac.spec) / 0.9, 0.5);
    st.i = clamp((st.i ?? 0) + err * (0.08 / grad) * dt, -0.5, 0.5);
    if (st.thr0 == null) st.thr0 = clamp(ac.throttle, 0.4, 0.85);
    c.throttle = clamp(st.thr0 + st.i + err * 0.4 / grad, 0.1, 0.9);
    ac.airbrake = err < -25;
    avoidTerrain(ac, c, minAgl);
    return hd;
}

// ═════════════ The tanker's side: stations, the boom operator, the hoses ═════════════
// One per tanker flight. stations: 'boom' (flying boom), 'l' / 'r' / 'c' (hoses). Each holds at most one receiver's
// session at a time; others wait in the observation position.
export class TankerOps {
    constructor(flight) {
        this.flight = flight;
        this.ac = flight.ac;
        this.type = flight.ac.type;
        this.spec = TANKERS[this.type] || TANKERS.kc135;
        this.give = this.spec.give;
        this.rig = tankerRig(this.ac);
        this.stations = {};
        for (const s of this.spec.stations) if (s === 'boom' ? this.rig.boom : this.rig.drogues[s]) this.stations[s] = { name: s, session: null, k: 0, want: 0, light: 'off', sway: { x: 0, y: 0 }, swayT: Math.random() * 10 };
        this.boom = { pitch: this.rig.boom ? this.rig.boom.env.ideal : 0, yaw: 0, ext: 0, down: 0, latched: false };
        this.prev = new THREE.Vector3();
    }

    hasBoom() { return !!this.stations.boom; }
    hoses() { return ['l', 'r', 'c'].filter(s => this.stations[s]); }

    // which station suits a receiver (boom receptacle → the boom; probe → a free hose, the centre one for a heavy)
    stationFor(kind, heavy = false) {
        if (kind === 'boom') return this.stations.boom ? 'boom' : null;
        const hs = this.hoses();
        if (!hs.length) return null;
        if (heavy && this.stations.c) return 'c';
        const free = hs.filter(s => !this.stations[s].session && s !== 'c');
        return free[0] || hs.find(s => s !== 'c') || hs[0];
    }
    busy(s) { return !!(this.stations[s] && this.stations[s].session); }

    // the basket where it is now (model frame): trailed free with its sway, or on the probe
    basketPos(s, out) {
        const st = this.stations[s], dr = this.rig.drogues[s];
        return drogueFree(dr, st.k, st.sway, out);
    }

    // per frame: hoses reel in / out, the free baskets sway, the boom goes down / up (the session poses the latched
    // boom and a basket on a probe itself)
    update(dt, weather = 'clear') {
        const gust = { clear: 0.18, cloudy: 0.25, rain: 0.45, storm: 0.8 }[weather] ?? 0.2;
        for (const s of Object.keys(this.stations)) {
            const st = this.stations[s];
            if (s === 'boom') continue;
            st.k = damp(st.k, st.want, st.want > st.k ? 0.35 : 0.5, dt);
            if (Math.abs(st.k - st.want) < 0.004) st.k = st.want;
            st.swayT += dt;
            st.sway.x = gust * (Math.sin(st.swayT * 0.9) * 0.7 + Math.sin(st.swayT * 2.3 + 1.3) * 0.3) * st.k;
            st.sway.y = gust * (Math.sin(st.swayT * 0.7 + 2) * 0.5 + Math.sin(st.swayT * 1.9) * 0.3) * st.k;
            const dr = this.rig.drogues[s];
            if (!dr.node) continue;
            if (st.contact) continue; // (posed by the session)
            if (st.k <= 0.001) { if (!st.stowed) { stowHose(dr); st.stowed = true; } continue; }
            st.stowed = false;
            poseHose(dr, this.basketPos(s, _bp), true);
        }
        // the boom: down to the contact attitude while someone's on it, stowed otherwise
        const b = this.boom;
        const bs = this.stations.boom;
        if (bs) {
            const want = bs.session && !bs.session.done ? 1 : 0;
            b.down = damp(b.down, want, 0.6, dt);
            if (!b.latched && this.rig.boom.node) {
                if (b.down < 0.02) stowBoom(this.ac.rig);
                else {
                    const env = this.rig.boom.env;
                    // (the stowed boom sits a little up: lerp from there to the attitude the operator holds)
                    const rest = -8.5 * DEG;
                    setBoom(this.ac.rig, lerp(rest, b.pitch, b.down), b.yaw * b.down, b.ext * b.down);
                    void env;
                }
            }
        }
    }
}
const _bp = new THREE.Vector3();

// ═════════════ A receiver's session ═════════════
// states: 'rendezvous' → 'join' → 'observe' → 'precontact' → 'contact' (fuel flows once plugged in) → 'post' →
// 'done'; 'breakaway' drops back to pre-contact; 'abort' ends it (the receiver or the tanker lost, or called off)
export const AR_STATES = ['rendezvous', 'join', 'observe', 'precontact', 'contact', 'breakaway', 'post', 'done', 'abort'];
const GAINS = {
    join: { k: 0.1, kSide: 0.1, along: [-30, 50], side: 30, vert: 12 },
    observe: { k: 0.3, kSide: 0.3, along: [-8, 8], side: 6, vert: 4 },
    precontact: { k: 0.35, kSide: 0.45, along: [-4, 3], side: 3, vert: 2.5 },
    contact: { k: 0.3, kSide: 0.6, along: [-1.2, 0.9], side: 1.2, vert: 1.2 },
    breakaway: { k: 0.5, kSide: 0.5, along: [-12, 0], side: 6, vert: 8 },
    post: { k: 0.3, kSide: 0.3, along: [-10, 6], side: 8, vert: 4 },
};
// (the AI and the AR autopilot add a gentle hand on the position close in: stationKeep's assist)
const ASSIST = { contact: { ...GAINS.contact, assist: 0.8 }, precontact: { ...GAINS.precontact, assist: 0.3 } };
const ZERO = new THREE.Vector3();
const _w = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();

export class RefuelSession {
    // air: the air-support system (radio, game); rx: the receiver (Aircraft); tanker: its flight ({ ac, ops, track,
    // s, callsign }); opts.auto: flown by the AI (or the player's AR autopilot); opts.slot: its place in the queue
    constructor(air, rx, tanker, opts = {}) {
        this.air = air; this.game = air.game;
        this.rx = rx; this.tanker = tanker; this.ops = tanker.ops;
        const rp = receiverPoint(rx);
        this.kind = rp ? rp.kind : null;
        this.ref = rp ? rp.local : new THREE.Vector3();
        this.heavy = rx.spec.category === 'bomber' || rx.spec.category === 'support' || rx.spec.length > 30;
        this.station = this.kind ? this.ops.stationFor(this.kind, this.heavy) : null;
        this.state = 'rendezvous'; this.stateT = 0; this.t = 0; this.stable = 0;
        this.auto = !!opts.auto;
        this.ai = !!opts.ai;           // an AI receiver (not the player)
        this.slot = opts.slot || 0;
        this.onload = 0; this.fuel0 = rx.fuel ?? 1;
        this.ctl = {};
        this.tip = new THREE.Vector3(); this.prevTip = new THREE.Vector3(); this.hasPrev = false;
        this.tgtL = new THREE.Vector3(); this.useRef = false;
        this.relV = new THREE.Vector3();
        this.sol = {}; this.stat = { ok: false }; this.dst = { pushIn: 0, angle: 0 }; this.light = 'off'; this.flow = false;
        this.attached = false; this.disconnects = 0; this.ready = 0;
        this.err = { ea: 0, es: 0, eu: 0, dist: 0 };
        this.callsign = opts.callsign || rx.callsign || rx.spec.name.toUpperCase();
        this.rate = transferRate(this.tanker.ac.type, this.station);
        this.done = false;
    }

    get ok() { return !!this.station; }
    get from() { return this.tanker.callsign; }
    say(text, speech, opts = {}) { this.air.say(this.from, this.callsign + ', ' + text, { say: speech === false ? false : this.callsign.toLowerCase() + ', ' + (speech || text.toLowerCase()), color: '#9fd4ff', ...opts }); }
    set(state) { this.state = state; this.stateT = 0; this.stable = 0; this.ctl.i = this.ctl.i ?? 0; }
    stationState() { return this.ops.stations[this.station]; }

    // where the receiver waits: off the tanker's left wing (stacked out and back by its place in the queue), and
    // off the right wing when it's done (model frame, for its centre)
    obsPoint(out, right = false) {
        const hs = (this.tanker.ac.rig.halfSpan || this.tanker.ac.spec.span / 2);
        const k = this.slot;
        return out.set((right ? 1 : -1) * (hs + 22 + k * 30), -4 - k * 3, 12 + k * 18);
    }
    // pre-contact for the reference point: the boom — 15 m aft of the contact position and a little below;
    // a hose — a few metres astern of the basket
    precontactPoint(out) {
        if (this.station === 'boom') { boomContactPoint(this.ops.rig.boom, out); return out.add(_q.set(0, -2.5, 15)); }
        return this.ops.basketPos(this.station, out).add(_q.set(0, 0, 4));
    }

    // ── per frame, after the physics: the procedure, the boom operator, the hose, the fuel ──
    update(dt) {
        const g = this.game, tk = this.tanker.ac, rx = this.rx;
        if (this.done) return;
        if (!rx.alive || rx.removed || rx.exploded) return this.end('abort');
        if (!tk.alive || tk.removed) { this.say('THE TANKER IS GONE — TAKE IT HOME', false, { color: '#ff9f5a' }); return this.end('abort'); }
        this.t += dt; this.stateT += dt;
        toWorld(rx, this.ref, _w); toLocal(tk, _w, this.tip);
        if (this.hasPrev && dt > 0) this.relV.subVectors(this.tip, this.prevTip).divideScalar(dt);
        const closure = -this.relV.z;
        const dCg = rx.pos.distanceTo(tk.pos);
        switch (this.state) {
            case 'rendezvous': {
                this.useRef = false;
                if (dCg < 3500) {
                    this.set('join');
                    this.say('CLEARED TO JOIN — OBSERVATION LEFT WING, ANGELS ' + Math.round(tk.pos.y * 3.281 / 1000), 'cleared to join, observation left wing');
                }
                break;
            }
            case 'join': case 'observe': {
                this.useRef = false;
                this.obsPoint(this.tgtL);
                this.measure(rx, tk);
                if (this.state === 'join') {
                    this.stable = this.err.dist < 40 ? this.stable + dt : 0;
                    if (this.stable > 2) this.set('observe');
                    break;
                }
                // wait for the station; the boom goes down / the hose trails, then the clearance
                const st = this.stationState();
                if (!st.session || st.session === this) {
                    st.session = this;
                    if (this.station !== 'boom') st.want = 1;
                    const ready = this.station === 'boom' ? this.ops.boom.down > 0.9 : st.k > 0.97;
                    if (ready && this.stateT > 2) {
                        this.set('precontact');
                        if (this.station === 'boom') this.say('CLEARED TO PRE-CONTACT', 'cleared to pre contact');
                        else this.say('CLEARED ASTERN, ' + ({ l: 'LEFT', r: 'RIGHT', c: 'CENTRE' })[this.station] + ' HOSE', 'cleared astern, ' + ({ l: 'left', r: 'right', c: 'centre' })[this.station] + ' hose');
                    }
                }
                break;
            }
            case 'precontact': {
                this.useRef = true;
                this.precontactPoint(this.tgtL);
                this.measure(rx, tk);
                if (this.station !== 'boom') this.light = 'amber';
                this.stable = this.err.dist < 2.5 && this.relV.length() < 1.2 ? this.stable + dt : 0;
                if (this.stable > 1.5) { this.set('contact'); this.say('CLEARED CONTACT', 'cleared contact'); }
                break;
            }
            case 'contact': {
                this.useRef = true;
                if (this.station === 'boom') this.boomContact(dt, closure);
                else this.hoseContact(dt, closure);
                if (this.state !== 'contact') break;
                if (this.flow) this.transfer(dt);
                break;
            }
            case 'breakaway': {
                this.useRef = true;
                this.precontactPoint(this.tgtL).add(_q.set(0, -8, 25));
                this.measure(rx, tk);
                if (this.stateT > 6) { this.set('precontact'); this.say('CLEARED BACK TO PRE-CONTACT', 'cleared back to pre contact'); }
                break;
            }
            case 'post': {
                this.useRef = false;
                this.obsPoint(this.tgtL, true);
                this.measure(rx, tk);
                if ((this.auto && this.stateT > 7) || (!this.auto && (this.stateT > 25 || dCg > 400))) {
                    this.say(this.onload > 0 ? 'CLEARED TO DEPART — GOOD HUNTING' : 'CLEARED TO DEPART', this.onload > 0 ? 'cleared to depart, good hunting' : 'cleared to depart');
                    return this.end('done');
                }
                break;
            }
        }
        // too close or too fast near the tanker: breakaway; into it: a mid-air
        if (this.state === 'precontact' || this.state === 'contact') this.safety(closure, rx, tk);
        this.collision(rx, tk);
        this.prevTip.copy(this.tip); this.hasPrev = true;
        void g;
    }

    // the error to the current target (reference point or centre), in the tanker's axes
    measure(rx, tk) {
        toWorld(rx, this.useRef ? this.ref : ZERO, _w); toLocal(tk, _w, _p);
        this.err.ea = -(this.tgtL.z - _p.z); this.err.es = this.tgtL.x - _p.x; this.err.eu = this.tgtL.y - _p.y;
        this.err.dist = Math.hypot(this.err.ea, this.err.es, this.err.eu);
        return this.err;
    }

    // ── the flying boom: the operator plugs in once the receptacle holds still inside the envelope ──
    boomContact(dt, closure) {
        const boom = this.ops.rig.boom, env = boom.env, B = this.ops.boom;
        boomContactPoint(boom, this.tgtL);
        this.measure(this.rx, this.tanker.ac);
        const sol = boomSolve(boom.H, this.tip, boom.L0, this.sol);
        const stat = boomStatus(sol, env, this.stat);
        if (!B.latched) {
            // fly the nozzle to just short of the receptacle (the stops hold it inside its travel)
            const rate = 12 * DEG * dt;
            B.pitch += clamp(clamp(sol.pitch, env.pitchMin - 3 * DEG, env.pitchMax + 3 * DEG) - B.pitch, -rate, rate);
            B.yaw += clamp(clamp(sol.yaw, -env.yawMax, env.yawMax) - B.yaw, -rate, rate);
            const want = clamp(sol.ext - 0.9, 0, env.travel);
            B.ext += clamp(want - B.ext, -2 * dt, 1.5 * dt);
            this.ready = stat.ok && this.relV.length() < 0.7 ? this.ready + dt : 0;
            if (this.ready > 0.8) {
                // extend and plug in
                B.ext += 2.5 * dt;
                if (B.ext >= sol.ext - 0.12 && Math.abs(B.pitch - sol.pitch) < 2 * DEG && Math.abs(B.yaw - sol.yaw) < 2 * DEG) {
                    B.latched = true; this.flow = true;
                    this.air.say('BOOM', 'CONTACT', { color: '#9fd4ff', say: 'contact' });
                    this.game.events.emit('refuelContact', this.rx, { session: this });
                }
            }
            return;
        }
        // latched: the boom follows the receptacle; out of the envelope it lets go by itself
        B.pitch = sol.pitch; B.yaw = sol.yaw; B.ext = sol.ext;
        if (this.ops.rig.boom.node) setBoom(this.tanker.ac.rig, sol.pitch, sol.yaw, clamp(sol.ext, 0, env.travel));
        if (!stat.ok) this.disconnect(stat.why);
        void closure;
    }

    // ── the hose: the probe has to go into the basket; pushed in to the refuelling range, fuel flows ──
    hoseContact(dt, closure) {
        const st = this.stationState(), dr = this.ops.rig.drogues[this.station];
        const basket = this.ops.basketPos(this.station, _t);
        if (!this.attached) {
            this.light = 'amber';
            // aim a metre through the basket
            this.tgtL.copy(basket).add(_q.set(0, 0, -1));
            this.measure(this.rx, this.tanker.ac);
            if (this.hasPrev) {
                const r = probeCapture(this.prevTip, this.tip, basket, closure);
                if (r === 'contact') {
                    this.attached = true; st.contact = true;
                    this.game.events.emit('refuelContact', this.rx, { session: this });
                } else if (r === 'rim') {
                    st.sway.x += (this.tip.x - basket.x) > 0 ? -0.5 : 0.5; st.swayT += 1.3;
                    if (!this.ai) this.game.addFeed('BASKET STRIKE — BACK OFF AND TRY AGAIN', '#ffc23f');
                    this.set('precontact');
                } else if (r === 'fast') {
                    if (!this.ai) this.game.addFeed('TOO FAST — HOSE WHIP. BACK TO ASTERN', '#ff9f5a');
                    this.say('TOO FAST — BACK TO ASTERN', 'too fast, back to astern');
                    this.set('precontact');
                }
                // flew past it
                if (!this.attached && this.tip.z < basket.z - 3) this.breakaway('OVERRUN');
            }
            return;
        }
        // on the probe: the basket goes where the probe goes; the hose angle and how far it's pushed in decide
        this.tgtL.copy(dr.E).add(_q.set(0, -Math.sin(dr.droop), Math.cos(dr.droop)).multiplyScalar(dr.len - 3));
        this.measure(this.rx, this.tanker.ac);
        drogueState(dr, this.tip, this.dst);
        const L = drogueLights(this.dst);
        if (L.flow && !this.flow && this.onload === 0) this.air.say(this.from, this.callsign + ', CONTACT — FUEL FLOWING', { color: '#9fd4ff', say: 'contact, fuel flowing' });
        this.light = L.light; this.flow = L.flow;
        if (dr.node) poseHose(dr, this.tip, true);
        if (L.disconnect) this.disconnect(this.dst.pushIn > DROGUE.inner ? 'INNER LIMIT' : this.dst.angle > DROGUE.angleMax ? 'HOSE ANGLE' : 'PULLED OFF');
        void dt;
    }

    transfer(dt) {
        const rx = this.rx, cap = fuelKg(rx.type);
        const room = Math.max(0, 1 - (rx.fuel ?? 1)) * cap;
        const kg = Math.min(this.rate * dt, room, Math.max(this.ops.give, 0));
        if (kg > 0) {
            if (rx.refuel) rx.refuel(kg / cap); else rx.fuel = Math.min(1, (rx.fuel ?? 0) + kg / cap);
            this.onload += kg; this.ops.give -= kg;
        }
        if ((rx.fuel ?? 1) >= 0.995 || room <= 0.5) this.full();
        else if (this.ops.give <= 0) { this.say('THAT\'S ALL THE GAS WE HAVE — DISCONNECT', 'that is all the gas we have, disconnect'); this.release(); this.set('post'); }
    }

    full() {
        const lb = Math.round(this.onload / LB / 10) * 10;
        this.say('YOU\'RE FULL — ' + lb.toLocaleString('en-US') + ' POUNDS. DISCONNECT, CLEARED TO THE RIGHT WING', 'you are full, ' + lb + ' pounds. disconnect, cleared to the right wing');
        this.game.events.emit('refuelDone', this.rx, { session: this, kg: this.onload });
        this.release();
        this.set('post');
    }

    // let go of the boom / the basket (the boom pulls back a metre, the hose springs back to its trail)
    release() {
        const st = this.stationState();
        if (this.station === 'boom') { const B = this.ops.boom; B.latched = false; B.ext = Math.max(0, B.ext - 1); }
        else { this.attached = false; if (st) st.contact = false; this.light = 'amber'; }
        this.flow = false;
    }

    disconnect(why) {
        this.release();
        this.disconnects++;
        this.say('DISCONNECT — ' + why + '. BACK TO ' + (this.station === 'boom' ? 'PRE-CONTACT' : 'ASTERN'), 'disconnect, ' + why.toLowerCase() + '. back to ' + (this.station === 'boom' ? 'pre contact' : 'astern'));
        this.set('precontact');
    }

    breakaway(why) {
        this.release();
        this.air.say(this.station === 'boom' ? 'BOOM' : this.from, 'BREAKAWAY, BREAKAWAY, BREAKAWAY' + (why ? ' — ' + why : ''), { color: '#ff4a3d', say: 'breakaway, breakaway, breakaway', priority: true });
        if (!this.ai) this.game.addFeed('BREAKAWAY — THROTTLE BACK, DESCEND, DROP AFT', '#ff4a3d');
        this.set('breakaway');
    }

    // (only near the boom / the basket: moving in from the wing is not overrunning anything)
    safety(closure, rx, tk) {
        if (this.state === 'breakaway') return;
        const tip = this.tip;
        if (this.station === 'boom') {
            const b = this.ops.rig.boom;
            const cp = boomContactPoint(b, _q);
            const dC = Math.hypot(tip.x - cp.x, tip.y - cp.y, tip.z - cp.z);
            const nearBoom = Math.abs(tip.x - b.H.x) < 8 && tip.z < cp.z + 12;
            const tooClose = nearBoom && (tip.z < b.H.z + b.L0 + b.env.extMin - 1.5 || tip.y > b.H.y - 2);
            if (tooClose || (closure > 2.6 && dC < 8)) this.breakaway(tooClose ? 'TOO CLOSE' : 'CLOSURE');
        } else if (!this.attached && closure > 4) {
            const B = this.ops.basketPos(this.station, _q);
            if (Math.hypot(tip.x - B.x, tip.y - B.y, tip.z - B.z) < 6) this.breakaway('CLOSURE');
        }
        void rx; void tk;
    }

    // the receiver's centre inside the tanker's fuselage (a capsule along its axis): a mid-air collision
    collision(rx, tk) {
        toLocal(tk, rx.pos, _p);
        const L = tk.spec.length;
        const z = clamp(_p.z, -L * 0.46, L * 0.46);
        const d = Math.hypot(_p.x, _p.y, _p.z - z);
        const r = 2.4 + Math.min(rx.spec.length, 20) * 0.1;
        if (d < r) {
            this.air.say(this.from, 'MID-AIR! MID-AIR!', { color: '#ff4a3d', say: 'mid air, mid air!', priority: true });
            this.game.events.emit('refuelCollision', rx, { tanker: tk });
            if (rx.crash) rx.crash();
            if (tk.damage) tk.damage(tk.maxHealth * 0.45, rx, 'crash');
            this.end('abort');
        }
    }

    // ── steering (before the physics): the AI's hands, or the player's AR autopilot ──
    fly(dt, c) {
        const tk = this.tanker.ac, rx = this.rx;
        if (this.done) return false;
        if (this.state === 'rendezvous') {
            rendezvousPoint(rx, this.tanker, _p);
            const want = Math.min(rx.spec.flight.speed * 0.95, Math.max(tk.speed + 70, 180));
            flyToward(rx, c, _p, want, dt, this.ctl);
            return true;
        }
        toWorld(tk, this.tgtL, _t);
        const G0 = (this.auto && ASSIST[this.state]) || GAINS[this.state] || GAINS.observe;
        stationKeep(rx, c, _t, this.useRef ? this.ref : ZERO, tk.vel, tk.quat, dt, this.ctl, G0);
        return true;
    }

    end(why) {
        if (this.done) return;
        this.done = true;
        this.state = why;
        const st = this.station && this.stationState();
        if (st && st.session === this) {
            st.session = null; st.contact = false;
            // the boom goes back up, the hose reels in (the next receiver's clearance trails it again)
            if (this.station === 'boom') { this.ops.boom.latched = false; this.ops.boom.ext = 0; }
            else st.want = 0;
        }
        this.flow = false;
        this.game.events.emit('refuelEnd', this.rx, { session: this, why });
    }
}

// ═══════════════════════════════════════════════════════════════
// Arm IK for holding weapons, on any rig given its bones: the first-person arms (weaponmodels.js) and
// the animated characters (character.js).
//   • two-bone solve: shoulder → elbow → wrist, the elbow swung toward a pole direction
//   • the hand turned to a target frame: fwd (wrist → knuckles) and up (the back of the hand), measured
//     once from the rig's own finger bones, so no per-rig axis bookkeeping
//   • part of the wrist's twist handed to the forearm (no candy-wrapper wrist)
//   • fingers curled toward the palm (0 open … 1 fist), the thumb across it, the index off onto a trigger
// All in world space; the bones' parents must be up to date (call after the animation mixer).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _m = new THREE.Matrix4();
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

// a rotation whose -Z… no: whose X = side, Y = up, Z = -fwd (so "forward" is -Z like everything else here)
export function frameQuat(fwd, up, out = new THREE.Quaternion()) {
    const z = _d.copy(fwd).negate().normalize();
    const x = _e.crossVectors(up, z).normalize();
    const y = _c.crossVectors(z, x);
    _m.makeBasis(x, y, z);
    return out.setFromRotationMatrix(_m);
}

const _wp = new THREE.Vector3(), _ws = new THREE.Vector3();
function worldPos(o, out) { return out.setFromMatrixPosition(o.matrixWorld); }
function worldQuat(o, out) { o.matrixWorld.decompose(_wp, out, _ws); return out; }
// set o's world rotation (its parent's matrixWorld must be current), blended by w. Only o's own matrix is
// brought up to date (the solve refreshes the next bone down itself; the renderer does the fingers).
function setWorldQuat(o, q, w = 1) {
    worldQuat(o.parent, _pq).invert();
    const local = _q3.copy(_pq).multiply(q);
    if (w >= 1) o.quaternion.copy(local); else o.quaternion.slerp(local, w);
    o.updateWorldMatrix(false, false);
}

export class ArmIK {
    // b: { upper, lower, hand, fingers: { thumb: [..], index: [..], middle: [..], ring: [..], pinky: [..] } }
    // side 'R' | 'L'. Measured in the pose the rig is in now (its bind pose, before any animation).
    constructor(b, side) {
        this.b = b; this.side = side;
        const { upper, lower, hand } = b;
        upper.updateWorldMatrix(true, true);
        const S = worldPos(upper, new THREE.Vector3()), E = worldPos(lower, new THREE.Vector3()), W = worldPos(hand, new THREE.Vector3());
        this.la = S.distanceTo(E); this.lb = E.distanceTo(W);
        // the hand's own frame from its knuckles: fwd = wrist → middle knuckle, side = pinky → index
        const f = b.fingers;
        const mid = worldPos(f.middle[0], new THREE.Vector3()), idx = worldPos(f.index[0], new THREE.Vector3()), pk = worldPos(f.pinky[0], new THREE.Vector3());
        const fwd = mid.clone().sub(W).normalize();
        const sideV = idx.clone().sub(pk).normalize();
        const up = side === 'R' ? new THREE.Vector3().crossVectors(fwd, sideV) : new THREE.Vector3().crossVectors(sideV, fwd);
        up.normalize();
        this.handLen = W.distanceTo(mid);
        const frame = frameQuat(fwd, up);
        this.offset = frame.clone().invert().multiply(worldQuat(hand, new THREE.Quaternion())); // hand = frame * offset
        this.handBindLocal = hand.quaternion.clone();
        // finger bend axes in each joint's local frame: fingers curl about `side` (toward the palm), the thumb
        // mostly about `fwd` (across the palm)
        const bendW = sideV.clone().multiplyScalar(side === 'R' ? 1 : -1);
        const thumbW = fwd.clone().multiplyScalar(side === 'R' ? -1 : 1).addScaledVector(bendW, 0.45).normalize();
        this.fingers = {};
        for (const k of FINGERS) {
            const chain = (f[k] || []).filter(Boolean);
            const ax = k === 'thumb' ? thumbW : bendW;
            this.fingers[k] = chain.map(bone => {
                const inv = worldQuat(bone, new THREE.Quaternion()).invert();
                return { bone, bind: bone.quaternion.clone(), axis: ax.clone().applyQuaternion(inv).normalize() };
            });
        }
        this.S = new THREE.Vector3(); this.E = new THREE.Vector3();
    }

    // Reach `target` (world) with the wrist, elbow toward `pole` (world direction), hand oriented as `handQuat`
    // (from frameQuat(fwd, up)), blended by w. twist: share of the wrist's twist given to the forearm.
    solve(target, handQuat, pole, w = 1, twist = 0.5) {
        const { upper, lower, hand } = this.b;
        upper.parent.updateWorldMatrix(true, false);
        upper.updateWorldMatrix(false, false); lower.updateWorldMatrix(false, false); hand.updateWorldMatrix(false, false);
        const S = worldPos(upper, this.S);
        const a = this.la, b = this.lb;
        const T = _a.copy(target);
        let d = T.distanceTo(S);
        const dmax = (a + b) * 0.998, dmin = Math.abs(a - b) + 1e-3;
        const dir = _b.subVectors(T, S).divideScalar(Math.max(d, 1e-6));
        if (d > dmax) { d = dmax; T.copy(S).addScaledVector(dir, d); } else if (d < dmin) { d = dmin; T.copy(S).addScaledVector(dir, d); }
        const cosA = THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
        const p = _c.copy(pole).addScaledVector(dir, -pole.dot(dir));
        if (p.lengthSq() < 1e-8) p.set(0, -1, 0).addScaledVector(dir, dir.y);
        p.normalize();
        const E = this.E.copy(S).addScaledVector(dir, a * cosA).addScaledVector(p, a * sinA);
        // upper arm: its elbow onto E
        const cur = worldPos(lower, _d).sub(S).normalize();
        const want = _e.subVectors(E, S).normalize();
        _q.setFromUnitVectors(cur, want).multiply(worldQuat(upper, _q2));
        setWorldQuat(upper, _q, w);
        lower.updateWorldMatrix(false, false); hand.updateWorldMatrix(false, false);
        // forearm: its wrist onto T
        const E2 = worldPos(lower, _d);
        const cur2 = worldPos(hand, _e).sub(E2).normalize();
        const want2 = _c.subVectors(T, E2).normalize();
        _q.setFromUnitVectors(cur2, want2).multiply(worldQuat(lower, _q2));
        setWorldQuat(lower, _q, w);
        hand.updateWorldMatrix(false, false);
        if (!handQuat) return;
        // the hand: its frame onto handQuat; part of the twist goes into the forearm
        const Qh = _q.copy(handQuat).multiply(this.offset);
        if (twist > 0) {
            const ax = _c.subVectors(worldPos(hand, _e), worldPos(lower, _d)).normalize();
            const Q0 = worldQuat(lower, _q2).multiply(this.handBindLocal);        // the hand carried along untwisted
            const delta = _q3.copy(Qh).multiply(Q0.invert());                     // world delta to reach Qh
            const proj = ax.dot(_a.set(delta.x, delta.y, delta.z));
            const tw = _pq.set(ax.x * proj, ax.y * proj, ax.z * proj, delta.w);
            if (tw.lengthSq() > 1e-10) {
                tw.normalize();
                tw.slerp(_q2.identity(), 1 - twist);                               // share of the twist
                const lw = worldQuat(lower, _q2).premultiply(tw);
                setWorldQuat(lower, lw, w);
                hand.updateWorldMatrix(false, false);
            }
        }
        setWorldQuat(hand, Qh, w);
    }

    // curl: { thumb, index, middle, ring, pinky } 0..1 (or one number for all); spread per joint (rad) at 1
    curl(c, max = [1.1, 1.35, 1.1]) {
        for (const k of FINGERS) {
            const v = typeof c === 'number' ? c : (c[k] ?? 0);
            const chain = this.fingers[k];
            for (let i = 0; i < chain.length; i++) {
                const j = chain[i];
                const ang = v * (k === 'thumb' ? [0.6, 0.55, 0.45][i] ?? 0.4 : max[i] ?? 0.9);
                j.bone.quaternion.copy(j.bind).multiply(_q.setFromAxisAngle(j.axis, ang));
            }
        }
    }
}

// Finger bone chains by the rig's naming: first-person arms (R_point1..4) or Quaternius (Index1R..)
export function fingerChains(find, side, rig) {
    if (rig === 'fp') {
        const s = side + '_';
        const ch = (n) => [1, 2, 3].map(i => find(s + n + i)).filter(Boolean);
        return { thumb: ch('thumb'), index: ch('point'), middle: ch('middle'), ring: ch('ring'), pinky: ch('pink') };
    }
    const ch = (n) => [1, 2, 3].map(i => find(n + i + side)).filter(Boolean);
    return { thumb: ch('Thumb'), index: ch('Index'), middle: ch('Middle'), ring: ch('Ring'), pinky: ch('Pinky') };
}

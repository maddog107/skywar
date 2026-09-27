// ═══════════════════════════════════════════════════════════════
// Animated people: the pilot (Quaternius "SWAT" character, CC0) with idle,
// walk, run and shooting animations. Used for the pilot on foot, under the
// parachute, the Ready Room walk to the jet, enemy parachutists and pilots
// shoved out of hijacked jets. Falls back to a simple figure if not loaded.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { weaponModel } from './weaponmodels.js';
import { ArmIK, frameQuat, fingerChains } from './ik.js';
import { holdFor, bodyHoldFor } from './holds.js';

const HEIGHT = 1.8;
const sources = {};         // kind → { scene, clips, scale, offsetY }
const FILES = { pilot: 'models/pilot.glb', civilian: 'models/civilian.glb' };
const live = new Set();     // characters whose animations tick every frame

export async function preloadCharacter() {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(FILES).map(async ([kind, file]) => {
        try {
            const gltf = await loader.loadAsync(file);
            const scene = gltf.scene;
            scene.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(scene);
            const size = box.getSize(new THREE.Vector3());
            sources[kind] = { scene, clips: gltf.animations, scale: HEIGHT / size.y, offsetY: -box.min.y };
            scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
        } catch (e) {
            console.warn('[character] failed to load', file, e);
        }
    }));
}

// Fallback: a figure made of rounded parts (never boxes)
function fallbackFigure() {
    const g = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0x4d5a3e, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.6, 4, 10), suit); body.position.y = 1.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0x2f3a28, roughness: 0.6 })); head.position.y = 1.7;
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.7, 4, 8), suit); legs.position.y = 0.45;
    g.add(body, head, legs);
    return g;
}

export class Character {
    constructor(kind = 'pilot') {
        this.root = new THREE.Group();
        this.root.userData.character = this; // lets containers (wreckage, seats) dispose it
        this.current = null;
        this.actions = {};
        const source = sources[kind] || sources.pilot;
        if (source) {
            const clone = SkeletonUtils.clone(source.scene);
            // SkeletonUtils gives every skinned part its own Skeleton (and bone texture); the parts all
            // share one rig, so bind them to a single skeleton: one bone texture and one update per frame
            this.skeletons = [];
            clone.traverse(o => {
                if (!o.isSkinnedMesh) return;
                const first = this.skeletons[0];
                if (first && sameRig(o.skeleton, first)) { o.skeleton.dispose(); o.bind(first, o.bindMatrix); }
                else this.skeletons.push(o.skeleton);
            });
            // Quaternius characters face +Z; the game's "forward" is -Z
            const holder = this.holder = new THREE.Group();
            holder.rotation.y = Math.PI;
            clone.scale.setScalar(source.scale);
            clone.position.y = source.offsetY * source.scale;
            holder.add(clone);
            this.root.add(holder);
            this.mixer = new THREE.AnimationMixer(clone);
            this.clone = clone;
            for (const clip of source.clips) {
                const name = clip.name.split('|').pop().replace(/^Man_/, '');
                this.actions[name] = this.mixer.clipAction(clip);
            }
            this.ensureIK(); // measured now, in the model's rest pose
            live.add(this);
        } else {
            this.root.add(fallbackFigure());
        }
        this.play('Idle');
    }

    // cross-fade to an animation (Idle, Walk, Run, Run_Shoot, Idle_Gun_Shoot, Death, Wave…)
    play(name, fade = 0.25, speed = 1) {
        const a = this.actions[name];
        if (!a) return;
        if (this.mixer) live.add(this); // re-arm if it was dropped while out of the scene
        a.timeScale = speed;
        if (this.current === a) return;
        a.reset().setEffectiveWeight(1).fadeIn(fade).play();
        if (name === 'Death') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        if (this.current) this.current.fadeOut(fade);
        this.current = a;
    }

    // pick idle / walk / run from a ground speed (m/s)
    locomotion(speed, shooting = false) {
        if (shooting) this.play(speed > 1 ? 'Run_Shoot' : 'Idle_Gun_Shoot', 0.12);
        else if (speed > 4.5) this.play('Run', 0.2, speed / 5.5);
        else if (speed > 0.4) this.play('Walk', 0.2, Math.max(0.6, speed / 1.9));
        else this.play(this.armed && this.actions.Idle_Gun ? 'Idle_Gun' : 'Idle', 0.3);
    }

    // (compat) an AK-47 in hand, or nothing
    setRifle(on) { this.setWeapon(on ? 'ak47' : null, { mode: 'hand' }); }

    bone(name) { this.bones = this.bones || {}; return this.bones[name] ?? (this.bones[name] = (this.clone && this.clone.getObjectByName(name)) || null); }

    // IK chains for both arms, measured in the rig's bind pose
    // (a rig without the arm and finger bones, like the civilian's, just doesn't hold weapons)
    ensureIK() {
        if (this.ikR || this.noIK || !this.clone) return !!this.ikR;
        const find = (n) => this.bone(n);
        const need = ['UpperArm', 'LowerArm', 'Wrist', 'Index1', 'Middle1', 'Pinky1'].flatMap(n => [n + 'R', n + 'L']);
        if (!need.every(find)) { this.noIK = true; return false; }
        this.root.updateMatrixWorld(true);
        this.ikR = new ArmIK({ upper: find('UpperArmR'), lower: find('LowerArmR'), hand: find('WristR'), fingers: fingerChains(find, 'R', 'q') }, 'R');
        this.ikL = new ArmIK({ upper: find('UpperArmL'), lower: find('LowerArmL'), hand: find('WristL'), fingers: fingerChains(find, 'L', 'q') }, 'L');
        this.spine = ['Abdomen', 'Torso', 'Chest'].map(find).filter(Boolean);
        return true;
    }

    // Hold a weapon (an arsenal id) or nothing (null).
    //   mode 'hold': the weapon at the shoulder / out in front, both hands on it (IK), the upper body bent to the
    //   aim — on foot; 'hand': in the right hand alone (hanging under a parachute).
    //   lod 1: the simplified model (a soldier further away).
    setWeapon(id, { mode = 'hold', lod = 0 } = {}) {
        this.armed = !!id;
        this.holdMode = mode;
        const cur = this.weapon;
        if (cur && (cur.id !== id || cur.lod !== lod || cur.mode !== mode)) {
            if (cur.root.parent) cur.root.parent.remove(cur.root);
            this.weapon = null;
        }
        if (!id || !this.clone) {
            if (!id && this.current === this.actions.Idle_Gun) this.play('Idle', 0.2);
            return;
        }
        if (!this.ensureIK()) return;
        if (!this.weapon) {
            this.weaponCache = this.weaponCache || {};
            const key = id + ':' + lod;
            const w = this.weaponCache[key] || (this.weaponCache[key] = weaponModel(id, { lod }));
            w.mode = mode;
            this.weapon = w;
            if (mode === 'hand') this.attachToHand(w);
            else this.root.add(w.root);
        }
        this.weapon.root.visible = true;
    }

    // in the right hand, gripped the way the IK hold grips it: weapon = hand frame × (the hold's wrist frame)⁻¹
    attachToHand(w) {
        const hand = this.bone('WristR'), H = holdFor(w.id).R;
        hand.add(w.root);
        this.root.updateMatrixWorld(true);
        const s = hand.getWorldScale(_ws).x / Math.max(this.root.getWorldScale(_ws2).x, 1e-6);
        // the wrist's frame in weapon space
        const fq = frameQuat(_t.fromArray(H.fwd).normalize(), _d.fromArray(H.up).normalize(), _q).multiply(this.ikR.offset);
        _m4.compose(_bp.fromArray(H.at).add(w.points.grip), fq, _cp.set(1, 1, 1)).invert();
        _m4.decompose(w.root.position, w.root.quaternion, _cp);
        w.root.position.multiplyScalar(1 / s);
        w.root.scale.setScalar(1 / s);
    }

    // where the weapon points: pitch (rad, + up) and whether he's aiming (else it's carried at low ready)
    setAim(pitch, aiming) { this.aimPitch = pitch; this.aiming = aiming; }

    // After the animation: bend the spine toward the aim, put the weapon at the shoulder (or out in front) and
    // the hands on it. (Only for mode 'hold'.)
    applyHold(dt) {
        const w = this.weapon;
        if (!w || this.holdMode !== 'hold' || !this.ikR) return;
        const H = holdFor(w.id), BH = bodyHoldFor(w.id);
        this.aimK = (this.aimK || 0) + ((this.aiming ? 1 : 0) - (this.aimK || 0)) * Math.min(1, dt * 9);
        const aimP = (this.aimPitch || 0) * this.aimK;
        const pitch = aimP - BH.low * (1 - this.aimK);
        this.root.updateWorldMatrix(true, false);
        this.root.getWorldQuaternion(_rq);
        // The upper body: bladed to the target for a long gun (the left shoulder forward, so the support hand reaches
        // the handguard; the head turned back to the front) and leaning into the aim, spread over the spine. These
        // are added to the animation's pose, so a bone the clip doesn't drive is put back first (else last frame's
        // turn would pile up every frame).
        const sp = this.spine, nk = this.neck || (this.neck = ['Neck', 'Head'].map(n => this.bone(n)).filter(Boolean));
        const adj = this.adjBones || (this.adjBones = [...sp, ...nk]);
        if (!this.adjBase) { this.adjBase = adj.map(b => b.quaternion.clone()); this.adjSet = adj.map(b => b.quaternion.clone()); }
        for (let i = 0; i < adj.length; i++) {
            if (adj[i].quaternion.equals(this.adjSet[i])) adj[i].quaternion.copy(this.adjBase[i]); // (untouched since)
            else this.adjBase[i].copy(adj[i].quaternion);                                            // (the clip's own)
        }
        // each bone's extra world rotation, applied down the chain (parent first) in quaternions alone: bone i's new
        // world = D_i × (its parent's new world × its local), so no matrices are rebuilt until the IK reads them
        const blade = (BH.blade || 0) * (0.4 + 0.6 * this.aimK);
        const up = _t.set(0, 1, 0).applyQuaternion(_rq), right = _d.set(1, 0, 0).applyQuaternion(_rq);
        const nS = Math.max(sp.length, 1), nN = Math.max(nk.length, 1);
        const Ds = _q2.setFromAxisAngle(right, THREE.MathUtils.clamp(aimP, -1.1, 1.1) * 0.8 / nS).multiply(_q.setFromAxisAngle(up, -blade / nS));
        const Dn = _nq.setFromAxisAngle(up, blade / nN);
        if (adj.length && (blade > 1e-4 || Math.abs(aimP) > 1e-4)) {
            adj[0].parent.updateWorldMatrix(true, false);
            adj[0].parent.matrixWorld.decompose(_bp, _pq, _cp); // the chain's parent (the hips), as the clip left it
            let prev = adj[0].parent;
            for (let i = 0; i < adj.length; i++) {
                const b = adj[i];
                if (b.parent !== prev) { b.parent.updateWorldMatrix(true, false); b.parent.matrixWorld.decompose(_bp, _pq, _cp); }
                _bq.copy(_pq).multiply(b.quaternion).premultiply(i < sp.length ? Ds : Dn); // its new world rotation
                b.quaternion.copy(_pq.invert()).multiply(_bq);                             // … as a local one
                _pq.copy(_bq);
                prev = b;
            }
        }
        for (let i = 0; i < adj.length; i++) this.adjSet[i].copy(adj[i].quaternion);
        // the weapon: the grip relative to the chest, pointed along the aim
        const chest = this.spine[this.spine.length - 1] || this.root;
        chest.updateWorldMatrix(true, false);
        const aimQ = _nq.copy(_rq).multiply(_q.setFromAxisAngle(_d.set(1, 0, 0), pitch));
        const rs = this.root.getWorldScale(_ws).x, ws = rs * (BH.scale || 1); // (a long gun a little smaller: his arms are short)
        const P = _bp.setFromMatrixPosition(chest.matrixWorld).add(_cp.fromArray(BH.grip).multiplyScalar(rs).applyQuaternion(aimQ));
        // (as a child of the root: undo the root's transform)
        _m4.compose(P, aimQ, _ws2.set(ws, ws, ws));
        _m4b.copy(this.root.matrixWorld).invert().multiply(_m4);
        _m4b.decompose(w.root.position, w.root.quaternion, w.root.scale);
        w.root.updateMatrixWorld(true);
        // the hands onto it
        const wm = w.root.matrixWorld;
        const hand = (ik, h, pole) => {
            if (!h) return;
            const base = _t.copy(h.from === 'support' && w.points.support ? w.points.support : w.points.grip).add(_d.fromArray(h.at));
            base.applyMatrix4(wm);
            const hq = frameQuat(_cp.fromArray(h.fwd).normalize().applyQuaternion(aimQ), _ws2.fromArray(h.up).normalize().applyQuaternion(aimQ), _q2);
            ik.solve(base, hq, _pp.fromArray(pole).applyQuaternion(_rq), 1, 0.5);
            ik.curl(h.curl);
        };
        hand(this.ikR, H.R, [0.55, -0.8, 0.25]);
        hand(this.ikL, H.L, [-0.6, -0.75, 0.2]);
    }

    // world position of the weapon's muzzle (null when unarmed)
    muzzlePos(out) {
        const w = this.weapon;
        if (!this.armed || !w || !w.points.muzzle) return null;
        w.root.updateWorldMatrix(true, false);
        return w.root.localToWorld(out.copy(w.points.muzzle));
    }

    // advance the animation (owner-driven characters: infantry.js decides how often)
    tick(dt, ik = true) {
        if (!this.mixer) return;
        this.mixer.update(dt);
        if (this.pose || this.poseW > 0) this.applyPose(dt);
        if (ik && this.weapon && this.holdMode === 'hold') this.applyHold(dt);
    }

    // Hold a pose on top of the current animation ('chute', 'chuteArmed', 'seated', 'limp', 'kneel' or null):
    // the named limbs are swung to point in fixed directions, blended in and out over ~0.4 s
    setPose(name) { this.pose = name; }

    // kneel (0 standing … 1 down on one knee): the hips drop with the kneeling pose
    setCrouch(k) {
        this.crouchK = k;
        if (this.holder) this.holder.position.y = -0.5 * k;
        if (k > 0.5 && this.pose !== 'kneel' && !this.pose) this.setPose('kneel');
        else if (k <= 0.5 && this.pose === 'kneel') this.setPose(null);
    }

    applyPose(dt) {
        const want = this.pose ? 1 : 0;
        this.poseW = (this.poseW || 0) + Math.sign(want - (this.poseW || 0)) * Math.min(Math.abs(want - (this.poseW || 0)), dt * 2.5);
        if (this.poseW <= 0.001 || !this.clone) return;
        const P = POSES[this.pose || this.lastPose];
        if (!P) return;
        if (this.pose) this.lastPose = this.pose;
        this.bones = this.bones || {};
        this.root.updateWorldMatrix(true, false);
        this.root.getWorldQuaternion(_rq);
        for (const [name, dir] of P) {
            const b = this.bones[name] ?? (this.bones[name] = this.clone.getObjectByName(name) || null);
            if (!b || !b.parent) continue;
            const child = b.children.find(c => c.isBone) || b.children[0];
            if (!child) continue;
            b.updateWorldMatrix(true, true);
            b.getWorldPosition(_bp); child.getWorldPosition(_cp);
            _d.subVectors(_cp, _bp);
            if (_d.lengthSq() < 1e-8) continue;
            _t.fromArray(dir).normalize().applyQuaternion(_rq);
            _q.setFromUnitVectors(_d.normalize(), _t);
            b.getWorldQuaternion(_bq);
            b.parent.getWorldQuaternion(_pq);
            _nq.copy(_q).multiply(_bq);                 // the bone's new world rotation
            _nq.premultiply(_pq.invert());              // …in its parent's frame
            b.quaternion.slerp(_nq, this.poseW);
            b.updateMatrixWorld(true);
        }
    }

    dispose() {
        live.delete(this);
        if (this.root.parent) this.root.parent.remove(this.root);
        if (this.mixer) { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.clone); this.mixer = null; }
        if (this.skeletons) this.skeletons.forEach(s => s.dispose());
        this.skeletons = null;
        this.actions = {}; this.current = null;
    }
}

const _ws = new THREE.Vector3(), _ws2 = new THREE.Vector3();
const _rq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _bq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _nq = new THREE.Quaternion();
const _bp = new THREE.Vector3(), _cp = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _pp = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _m4b = new THREE.Matrix4();

// Limb directions in the character's own frame (it faces -Z; its left hand is -X). Parents come first.
const ARMS_UP = [['UpperArmL', [-0.35, 1, 0.12]], ['LowerArmL', [-0.1, 1, 0.05]], ['UpperArmR', [0.35, 1, 0.12]], ['LowerArmR', [0.1, 1, 0.05]]];
const DANGLE = [['UpperLegL', [-0.08, -1, -0.28]], ['LowerLegL', [-0.04, -1, 0.22]], ['UpperLegR', [0.08, -1, -0.2]], ['LowerLegR', [0.04, -1, 0.3]]];
const POSES = {
    // hanging in the harness, hands up on the risers
    chute: [...ARMS_UP, ...DANGLE],
    // the player's pilot keeps his rifle hand free
    chuteArmed: [ARMS_UP[0], ARMS_UP[1], ...DANGLE],
    // strapped into the seat during the ejection
    seated: [['UpperLegL', [-0.1, -0.1, -1]], ['LowerLegL', [0, -1, -0.15]], ['UpperLegR', [0.1, -0.1, -1]], ['LowerLegR', [0, -1, -0.15]],
        ['UpperArmL', [-0.25, -1, -0.2]], ['UpperArmR', [0.25, -1, -0.2]]],
    // dead weight under a canopy
    limp: [['UpperArmL', [-0.45, -1, 0.1]], ['LowerArmL', [-0.25, -1, 0.05]], ['UpperArmR', [0.45, -1, 0.1]], ['LowerArmR', [0.25, -1, 0.05]],
        ['UpperLegL', [-0.1, -1, 0.05]], ['LowerLegL', [-0.05, -1, 0.2]], ['UpperLegR', [0.1, -1, -0.05]], ['LowerLegR', [0.05, -1, 0.1]]],
    // kneeling to shoot (behind cover): right knee down, left foot planted forward (the hips drop, see crouch)
    kneel: [['UpperLegL', [-0.12, -0.18, -1]], ['LowerLegL', [-0.02, -1, 0.08]], ['UpperLegR', [0.14, -1, 0.35]], ['LowerLegR', [0.04, -0.12, 1]]],
};

function sameRig(a, b) {
    return a.bones.length === b.bones.length && a.bones.every((bone, i) => bone === b.bones[i])
        && a.boneInverses.every((m, i) => m.equals(b.boneInverses[i]));
}

function inScene(o) { while (o.parent) o = o.parent; return o.isScene; }

// tick every live character's animation. Anything that has left the scene (or never made it there
// within a few seconds) is dropped; it rejoins when shown again (see play()).
export function updateCharacters(dt) {
    for (const c of live) {
        if (c.manual) continue; // driven by its owner (infantry.js ticks its soldiers at their own rate)
        if (!inScene(c.root)) {
            c.idle = (c.idle || 0) + dt;
            if (c.seen || c.idle > 5) { live.delete(c); c.seen = false; c.idle = 0; }
            continue;
        }
        c.seen = true; c.idle = 0;
        c.mixer.update(dt);
        if (c.pose || c.poseW > 0) c.applyPose(dt);
        if (c.weapon && c.holdMode === 'hold') c.applyHold(dt);
    }
}

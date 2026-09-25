// ═══════════════════════════════════════════════════════════════
// Animated people: the pilot (Quaternius "SWAT" character, CC0) with idle,
// walk, run and shooting animations. Used for the pilot on foot, under the
// parachute, the Ready Room walk to the jet, enemy parachutists and pilots
// shoved out of hijacked jets. Falls back to a simple figure if not loaded.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { buildRifleModel } from './rifle.js';

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
            const holder = new THREE.Group();
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

    // AK-47 in the right hand (pilot rig only: the civilian has no gun animations)
    setRifle(on) {
        this.armed = on;
        if (!this.rifle) {
            if (!on) return;
            const hand = this.clone && this.clone.getObjectByName('WristR');
            if (!hand) return;
            const grip = new THREE.Group();
            const ak = buildRifleModel();
            ak.position.set(0, 0.1, -0.1); // pistol grip in the palm
            grip.add(ak);
            hand.add(grip);
            this.rifle = grip;
        }
        const R = Character.RIFLE, grip = this.rifle;
        // the bone's world scale includes the model's import scale: undo it so the AK is life-size
        this.root.updateMatrixWorld(true);
        const s = grip.parent.getWorldScale(_ws).x / Math.max(this.root.getWorldScale(_ws2).x, 1e-6);
        grip.position.fromArray(R.pos).multiplyScalar(1 / s);
        grip.rotation.fromArray(R.rot);
        grip.scale.setScalar(R.size / s);
        grip.visible = on;
        if (!on && this.current === this.actions.Idle_Gun) this.play('Idle', 0.2);
    }

    // world position of the rifle's muzzle (null when not armed)
    muzzlePos(out) {
        if (!this.armed || !this.rifle) return null;
        return this.rifle.children[0].localToWorld(out.set(0, 0.02, -0.64));
    }

    // Hold a pose on top of the current animation ('chute', 'chuteArmed', 'seated', 'limp' or null):
    // the named limbs are swung to point in fixed directions, blended in and out over ~0.4 s
    setPose(name) { this.pose = name; }

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

// grip offset in the right wrist's frame (metres, radians) and the rifle's scale
// (rot is the inverse of the wrist's world rotation in the Idle_Gun_Shoot pose, so the muzzle points
// straight ahead when aiming)
Character.RIFLE = { pos: [0, 0, 0], rot: [1.512, -0.202, 1.39], size: 0.8 };
const _ws = new THREE.Vector3(), _ws2 = new THREE.Vector3();
const _rq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _bq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _nq = new THREE.Quaternion();
const _bp = new THREE.Vector3(), _cp = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3();

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
        if (!inScene(c.root)) {
            c.idle = (c.idle || 0) + dt;
            if (c.seen || c.idle > 5) { live.delete(c); c.seen = false; c.idle = 0; }
            continue;
        }
        c.seen = true; c.idle = 0;
        c.mixer.update(dt);
        if (c.pose || c.poseW > 0) c.applyPose(dt);
    }
}

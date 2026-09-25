// ═══════════════════════════════════════════════════════════════
// Animated people: the pilot (Quaternius "SWAT" character, CC0) with idle,
// walk, run and shooting animations. Used for the pilot on foot, under the
// parachute, the Ready Room walk to the jet, enemy parachutists and pilots
// shoved out of hijacked jets. Falls back to a simple figure if not loaded.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

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
        this.current = null;
        this.actions = {};
        const source = sources[kind] || sources.pilot;
        if (source) {
            const clone = SkeletonUtils.clone(source.scene);
            // Quaternius characters face +Z; the game's "forward" is -Z
            const holder = new THREE.Group();
            holder.rotation.y = Math.PI;
            clone.scale.setScalar(source.scale);
            clone.position.y = source.offsetY * source.scale;
            holder.add(clone);
            this.root.add(holder);
            this.mixer = new THREE.AnimationMixer(clone);
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
        else this.play('Idle', 0.3);
    }

    dispose() { live.delete(this); if (this.root.parent) this.root.parent.remove(this.root); }
}

function inScene(o) { while (o.parent) o = o.parent; return o.isScene; }

// tick every live character's animation (anything no longer in the scene is dropped)
export function updateCharacters(dt) {
    for (const c of live) {
        if (!inScene(c.root)) { if (c.seen) live.delete(c); continue; }
        c.seen = true;
        c.mixer.update(dt);
    }
}

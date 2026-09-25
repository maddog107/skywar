// ═══════════════════════════════════════════════════════════════
// Ready Room start: begin at the barracks outside the airbase in a Humvee.
//   drive to the main gate → stop at the checkpoint for the sentry →
//   drive onto the apron → hop out (E) → walk to your jet → climb in (E)
// Then the normal game takes over: start up, taxi, take off.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, FENCE, GATE, baseToWorld, worldToBase, terrainHeight } from './world.js';
import { propInstance } from './props.js';
import { clamp, damp } from './util.js';
import { Character } from './character.js';

export const BARRACKS = { lx: 700, lz: -225 };      // base-local: the dorms, outside the fence by the gate road
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

// things you can't drive through, in base-local boxes [x0, x1, z0, z1]
const OBSTACLES = [
    [355, 405, -85, 185],   // hangars
    [216, 244, -208, -192], // tower & ops building
    [315, 355, 185, 390],   // parked jets
    [228, 272, 395, 445],   // parked transport
    [674, 726, -250, -200], // barracks blocks
];

export function makeSoldier() {
    const g = new THREE.Group();
    const suit = new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc89b7b, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x25282a, roughness: 0.8 });
    const part = (w, h, d, mat, x, y, z, parent = g) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
    const legs = [], arms = [];
    for (const s of [-1, 1]) {
        const hip = new THREE.Group(); hip.position.set(s * 0.13, 0.95, 0); g.add(hip);
        part(0.17, 0.9, 0.2, suit, 0, -0.45, 0, hip);
        part(0.18, 0.12, 0.3, dark, 0, -0.9, -0.05, hip);
        legs.push(hip);
        const sh = new THREE.Group(); sh.position.set(s * 0.3, 1.5, 0); g.add(sh);
        part(0.13, 0.62, 0.15, suit, 0, -0.3, 0, sh);
        arms.push(sh);
    }
    part(0.5, 0.62, 0.28, suit, 0, 1.28, 0);           // torso
    part(0.52, 0.2, 0.3, dark, 0, 1.0, 0);             // belt / harness
    part(0.24, 0.26, 0.24, skin, 0, 1.75, 0);          // head
    part(0.3, 0.14, 0.3, new THREE.MeshStandardMaterial({ color: 0x3a4b2e, roughness: 0.7 }), 0, 1.92, 0); // helmet
    part(0.26, 0.08, 0.05, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.8 }), 0, 1.77, -0.13); // visor
    g.userData = { legs, arms };
    return g;
}

export class GroundStart {
    constructor(game, jet) {
        this.game = game;
        this.jet = jet;
        this.base = BASES.find(b => b.friendly);
        this.state = 'drive';
        this.cleared = false;
        this.stopT = 0;
        this.camYaw = 0; this.camPitch = 0.18;
        this.prevE = false;
        this.hint = '';
        const b = this.base;
        // the Humvee, parked by the barracks facing the road to the gate
        const start = baseToWorld(b, BARRACKS.lx + 4, BARRACKS.lz - 48);
        const toGate = baseToWorld(b, GATE.lx + 40, GATE.lz);
        this.car = {
            mesh: propInstance('humvee') || new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 4.6), new THREE.MeshStandardMaterial({ color: 0x5b6443 })),
            pos: new THREE.Vector3(start.x, 0, start.z),
            yaw: Math.atan2(-(toGate.x - start.x), -(toGate.z - start.z)),
            v: 0, steer: 0,
        };
        this.car.pos.y = this.groundY(this.car.pos.x, this.car.pos.z);
        game.scene.add(this.car.mesh);
        const ch = new Character();
        this.walker = { mesh: ch.root, character: ch, pos: new THREE.Vector3(), yaw: 0, anim: 0, speed: 0 };
        this.walker.mesh.visible = false;
        game.scene.add(this.walker.mesh);
        const gw = baseToWorld(b, GATE.lx, GATE.lz);
        this.gatePos = new THREE.Vector3(gw.x, b.h, gw.z);
        const out = baseToWorld(b, GATE.lx + 22, GATE.lz);
        this.checkPos = new THREE.Vector3(out.x, b.h, out.z);
        this.introPending = true; // shown on the first frame, after the mode's own banner
        this.placeCar();
    }

    get focus() { return this.state === 'drive' ? this.car.pos : this.walker.pos; }

    groundY(x, z) {
        const s = this.game.surfaceAt(x, z, 1e9);
        return s.water ? 0 : s.h;
    }

    local(p) { return worldToBase(this.base, p.x, p.z); }
    insideFence(l) { return l.lx > FENCE.x0 && l.lx < FENCE.x1 && l.lz > FENCE.z0 && l.lz < FENCE.z1; }
    blockedAt(l, r = 2) { return OBSTACLES.some(([x0, x1, z0, z1]) => l.lx > x0 - r && l.lx < x1 + r && l.lz > z0 - r && l.lz < z1 + r); }

    // can we move from a to b (world)? fence only opens at the gate, and only once cleared
    canMove(a, b, r) {
        const la = this.local(a), lb = this.local(b);
        if (this.blockedAt(lb, r)) return 'obstacle';
        const ia = this.insideFence(la), ib = this.insideFence(lb);
        if (ia === ib) return 'ok';
        const atGate = Math.abs(lb.lz - GATE.lz) < 11 && Math.abs(lb.lx - FENCE.x1) < 6;
        if (!atGate) return 'fence';
        if (ib && !this.cleared) return 'barrier'; // driving in needs the sentry's OK
        return 'ok';
    }

    edgeE() {
        const down = this.game.input.down('KeyE') || this.game.input.down('Enter');
        const edge = down && !this.prevE;
        this.prevE = down;
        return edge;
    }

    update(dt, mouse) {
        const g = this.game, input = g.input;
        const sens = 0.0022 * (g.settings.sensitivity || 1);
        this.camYaw -= mouse.dx * sens;
        this.camPitch = clamp(this.camPitch + mouse.dy * sens * (g.settings.invertPitch ? -1 : 1), -0.2, 1.1);
        if (this.introPending) {
            this.introPending = false;
            g.navTarget = { pos: this.gatePos, label: 'CHECKPOINT' };
            g.objective = 'DRIVE TO THE BASE — STOP AT THE CHECKPOINT';
            g.showBanner('READY ROOM', 'W/S drive · A/D steer · Mouse look. Stop at the gate for the sentry.', 6, '#ffc23f');
        }
        const e = this.edgeE();
        this.hint = '';
        if (this.state === 'drive') this.drive(dt, input, e);
        else this.walk(dt, input, e);
        // keep the parked jet quiet and still
        this.jet.controls.throttle = 0; this.jet.throttle = 0;
    }

    drive(dt, input, e) {
        const c = this.car, g = this.game;
        const thr = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
        const steerIn = (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
        if (thr > 0) c.v += (c.v < 0 ? 14 : 5.5) * dt;
        else if (thr < 0) c.v -= (c.v > 0.5 ? 14 : 3.5) * dt;
        else c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), (1 + Math.abs(c.v) * 0.12) * dt);
        c.v = clamp(c.v, -7, 30);
        c.steer = damp(c.steer, steerIn, 6, dt);
        c.yaw += c.v / 3.3 * Math.tan(c.steer * 0.55) * dt;
        const fwd = _v.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
        const next = _v2.copy(c.pos).addScaledVector(fwd, c.v * dt);
        const res = this.canMove(c.pos, next, 2.5);
        if (res === 'ok') { c.pos.x = next.x; c.pos.z = next.z; }
        else {
            if (Math.abs(c.v) > 4) { g.shake = Math.min(1.2, g.shake + Math.abs(c.v) * 0.04); g.audio.tick(90, 0.25, 0.3); }
            c.v = -c.v * 0.15;
            if (res === 'barrier') g.addFeed('SENTRY: "HALT! Stop at the checkpoint."', '#ff9f5a');
            if (res === 'fence') this.hint = 'THE FENCE — USE THE MAIN GATE';
        }
        c.pos.y = this.groundY(c.pos.x, c.pos.z);
        this.placeCar();
        // checkpoint: stop by the booth and the sentry waves you through
        if (!this.cleared) {
            const d = c.pos.distanceTo(this.checkPos);
            if (d < 30) {
                if (Math.abs(c.v) < 1) {
                    this.stopT += dt;
                    this.hint = 'SENTRY CHECKING YOUR ID…';
                    if (this.stopT > 1.8) {
                        this.cleared = true;
                        if (g.world.airbases) g.world.airbases.gateOpen = true;
                        g.addFeed('SENTRY: "ID checks out, Captain. Your jet is on the apron."', '#5dffa0');
                        g.audio.say('I D checks out, Captain. Your jet is on the apron.', true);
                        g.navTarget = { pos: this.jet.pos, label: 'YOUR JET' };
                        g.objective = 'DRIVE TO YOUR JET ON THE APRON';
                    }
                } else { this.stopT = 0; this.hint = 'STOP FOR THE SENTRY'; }
            }
        } else if (c.pos.distanceTo(this.jet.pos) < 60) {
            this.hint = Math.abs(c.v) < 2 ? 'E — GET OUT' : 'SLOW DOWN AND PARK';
            g.objective = 'PARK, GET OUT (E) AND WALK TO YOUR JET';
        }
        if (e && Math.abs(c.v) < 2.5) this.exitCar();
        else if (e) this.hint = 'STOP FIRST';
    }

    placeCar() {
        const c = this.car;
        const fwd = _v.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw)), right = _v2.set(-fwd.z, 0, fwd.x);
        const hf = this.groundY(c.pos.x + fwd.x * 1.7, c.pos.z + fwd.z * 1.7), hb = this.groundY(c.pos.x - fwd.x * 1.7, c.pos.z - fwd.z * 1.7);
        const hr = this.groundY(c.pos.x + right.x, c.pos.z + right.z), hl = this.groundY(c.pos.x - right.x, c.pos.z - right.z);
        _e.set(Math.atan2(hf - hb, 3.4), c.yaw, Math.atan2(hl - hr, 2));
        c.mesh.position.copy(c.pos);
        c.mesh.quaternion.setFromEuler(_e);
    }

    exitCar() {
        const c = this.car, w = this.walker;
        c.v = 0;
        const left = _v.set(-Math.cos(c.yaw), 0, Math.sin(c.yaw));
        w.pos.copy(c.pos).addScaledVector(left, 2.4);
        w.pos.y = this.groundY(w.pos.x, w.pos.z);
        w.yaw = c.yaw;
        w.mesh.visible = true;
        this.state = 'walk';
        this.camYaw = 0;
        if (this.cleared) this.game.objective = 'WALK TO YOUR JET — E TO CLIMB IN';
        this.game.audio.tick(300, 0.1, 0.15);
    }

    walk(dt, input, e) {
        const w = this.walker, g = this.game;
        const fwdIn = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
        const sideIn = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
        const run = input.down('ShiftLeft', 'ShiftRight');
        const camYaw = w.yaw + this.camYaw;
        let mx = 0, mz = 0;
        if (fwdIn || sideIn) {
            // move relative to where the camera looks
            const f = { x: -Math.sin(camYaw), z: -Math.cos(camYaw) }, r = { x: Math.cos(camYaw), z: -Math.sin(camYaw) };
            mx = f.x * fwdIn + r.x * sideIn; mz = f.z * fwdIn + r.z * sideIn;
            const L = Math.hypot(mx, mz); mx /= L; mz /= L;
            const targetYaw = Math.atan2(-mx, -mz);
            let dy = targetYaw - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            const turn = dy * Math.min(1, dt * 10);
            w.yaw += turn; this.camYaw -= turn; // turning the body keeps the camera where it was
        }
        const target = (fwdIn || sideIn) ? (run ? 6.5 : 3.4) : 0;
        w.speed = damp(w.speed, target, 8, dt);
        const next = _v2.copy(w.pos); next.x += mx * w.speed * dt; next.z += mz * w.speed * dt;
        const res = this.canMove(w.pos, next, 0.6);
        if (res === 'ok' || (res === 'barrier')) { w.pos.x = next.x; w.pos.z = next.z; } // on foot you can walk past the boom
        w.pos.y = this.groundY(w.pos.x, w.pos.z);
        w.character.locomotion(w.speed);
        w.mesh.position.copy(w.pos);
        w.mesh.rotation.set(0, w.yaw, 0);
        // board the jet or get back in the Humvee
        const jet = this.jet;
        const dJet = w.pos.distanceTo(_v.copy(jet.pos).setY(w.pos.y));
        const dCar = w.pos.distanceTo(this.car.pos);
        if (dJet < jet.spec.length * 0.6 + 3) {
            this.hint = 'E — CLIMB INTO THE ' + jet.spec.name.toUpperCase();
            if (e) { this.board(); return; }
        } else if (dCar < 4) {
            this.hint = 'E — GET IN THE HUMVEE';
            if (e) { w.mesh.visible = false; this.state = 'drive'; this.camYaw = 0; return; }
        }
    }

    board() {
        const g = this.game, jet = this.jet;
        this.walker.mesh.visible = false;
        this.done = true;
        g.groundStart = null;
        g.navTarget = null;
        g.aimDir.copy(jet.getForward(_v)).normalize();
        g.cameraMode = g.settings.defaultCockpit ? 'cockpit' : 'chase';
        g.objective = '';
        g.showBanner('STRAPPED IN', 'Throttle up (1–0 / Z), taxi down the taxiway to the runway (A/D steer), and take off. Flaps help!', 7, '#5dffa0');
        g.audio.say('Canopy closed. Cleared to taxi.', true);
        if (g.settings.controlMode !== 'mousestick') g.input.lock();
    }

    updateCamera(cam, dt) {
        let target, dist, height, yaw;
        if (this.state === 'drive') {
            const c = this.car;
            target = _v.copy(c.pos).setY(c.pos.y + 2.2);
            dist = 10; height = 3.2; yaw = c.yaw + this.camYaw;
            this.camYaw = damp(this.camYaw, 0, Math.abs(c.v) > 3 ? 1.2 : 0, dt); // drift back behind the car when moving
        } else {
            const w = this.walker;
            target = _v.copy(w.pos).setY(w.pos.y + 1.7);
            dist = 4.2; height = 0.6; yaw = w.yaw + this.camYaw;
        }
        const pitch = this.camPitch;
        const off = _v2.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + height, Math.cos(yaw) * Math.cos(pitch) * dist);
        const want = off.add(target);
        const gy = Math.max(terrainHeight(want.x, want.z), 0) + 0.6;
        if (want.y < gy) want.y = gy;
        cam.position.lerp(want, this.camInit ? Math.min(1, dt * 8) : 1);
        this.camInit = true;
        cam.lookAt(target);
        cam.fov = damp(cam.fov, 62, 4, dt);
        cam.updateProjectionMatrix();
    }

    dispose() {
        this.game.scene.remove(this.car.mesh);
        this.game.scene.remove(this.walker.mesh);
        if (this.game.world.airbases) this.game.world.airbases.gateOpen = false;
    }
}

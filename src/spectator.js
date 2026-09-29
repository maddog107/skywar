// ═══════════════════════════════════════════════════════════════
// The sandbox's spectator camera (sandbox.js): follow any unit — behind it (CHASE), round it with the mouse (ORBIT), from
// above (TOP) — or fly a FREE camera (W/S/A/D, Q/E down/up, Shift faster, mouse looks, wheel changes speed). While it's
// on, the player's jet is held where it is (`held`: game.js skips its flight model and controls) and the AI ignores it
// (`abandoned`); game.spectating hides the jet's HUD symbology and keeps the camera out of the war's intel (war.js), and
// game.viewFocus makes the director bring the war to life where the camera is.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, damp } from './util.js';

export const VIEW_MODES = ['chase', 'orbit', 'top', 'free'];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Spectator {
    constructor(sb) {
        this.sb = sb;
        this.game = sb.game;
        this.on = false;
        this.mode = 'chase';
        this.target = null;              // { unit } or { rec } (a placed record: its lead, or where its abstract flight is)
        this.yaw = 0; this.pitch = -0.28; this.zoom = 1;
        this.dir = new THREE.Vector3(0, 0, -1);
        this.at = new THREE.Vector3();
        this.free = { pos: new THREE.Vector3(), yaw: 0, pitch: -0.2, speed: 120 };
        this.deadT = 0;
        this.focus = new THREE.Vector3();
    }

    // ── on / off ──
    start(target = null) {
        const g = this.game, p = g.player;
        if (g.pilotMode || g.groundStart) { this.sb.say('LEAVE THE ROOM OR CLIMB BACK IN FIRST', '#ffc23f'); return false; }
        if (!this.on && p && p.alive && this.sb.holdJet) { this.held = { ac: p, abandoned: !!p.abandoned }; p.held = true; p.abandoned = true; }
        this.on = true;
        g.spectating = true;
        g.tip = null; // (the first seconds' key tip is the jet's)
        if (target) this.follow(target);
        else if (!this.target) this.follow(this.sb.defaultFollow());
        if (!this.target && this.mode !== 'free') this.setMode('free');
        if (this.mode === 'free') this.enterFree();
        return true;
    }
    stop() {
        const g = this.game;
        if (!this.on) return;
        this.on = false;
        g.spectating = false;
        g.viewFocus = null;
        this.releaseJet();
        g.cameraMode = g.cameraMode || 'chase';
    }
    releaseJet() {
        const h = this.held;
        if (!h) return;
        h.ac.held = false;
        h.ac.abandoned = h.abandoned;
        this.held = null;
    }
    // (the jet is held only while watching, and only if the panel says so)
    setHold(on) {
        const g = this.game, p = g.player;
        if (!this.on) return;
        if (on && !this.held && p && p.alive) { this.held = { ac: p, abandoned: !!p.abandoned }; p.held = true; p.abandoned = true; }
        else if (!on) this.releaseJet();
    }

    follow(t) {
        this.target = t || null;
        this.deadT = 0;
        if (t && this.mode === 'free') this.mode = 'chase';
        const P = this.targetPos(_v);
        if (P) { this.at.copy(P); const v = this.targetVel(_v2); if (v && v.lengthSq() > 4) this.dir.copy(v).setY(0).normalize(); }
    }
    setMode(m) {
        this.mode = VIEW_MODES.includes(m) ? m : 'chase';
        if (this.mode === 'free') this.enterFree();
    }
    cycleMode() { this.setMode(VIEW_MODES[(VIEW_MODES.indexOf(this.mode) + 1) % VIEW_MODES.length]); if (this.mode === 'free' && !this.target) return; }
    enterFree() {
        const cam = this.game.camera, F = this.free;
        F.pos.copy(cam.position);
        _e.setFromQuaternion(cam.quaternion, 'YXZ');
        F.yaw = _e.y; F.pitch = clamp(_e.x, -1.45, 1.45);
    }

    // ── what's followed ──
    unitOf(t = this.target) {
        if (!t) return null;
        if (t.unit) return t.unit;
        if (t.rec) return this.sb.leadOf(t.rec);
        return null;
    }
    targetPos(out) {
        const t = this.target;
        if (!t) return null;
        if (t.unit) return out.copy(t.unit.pos);
        if (t.rec) return this.sb.posOf(t.rec, out);
        return null;
    }
    targetVel(out) {
        const u = this.unitOf();
        if (u && u.vel) return out.copy(u.vel);
        const t = this.target;
        if (t && t.rec && t.rec.handle && t.rec.handle.vel) return out.copy(t.rec.handle.vel);
        return null;
    }
    targetAlive() {
        const t = this.target;
        if (!t) return false;
        if (t.unit) return t.unit.alive && !t.unit.removed && !t.unit.gone;
        return this.sb.aliveOf(t.rec);
    }
    // how big it is (the camera stands off by it)
    sizeOf() {
        const u = this.unitOf();
        if (!u) return this.target && this.target.rec && ['csg', 'sag', 'ddg'].includes(this.target.rec.item) ? 250 : 20;
        if (u.spec && u.spec.length) return u.spec.length;
        if (u.isShip) return u.def && u.def.L ? u.def.L : 150;
        if (u.cls === 'infantry') return 2;
        return Math.max(6, (u.radius || 6) * 2);
    }

    // ── per frame (the game's updateCamera → sandbox.updateCamera) ──
    update(cam, dt, mouse) {
        const g = this.game, input = g.input;
        const m = mouse || { dx: 0, dy: 0, wheel: 0 };
        if (g.cockpit) g.cockpit.enabled = false;
        if (g.player) g.player.root.visible = !g.player.exploded;
        cam.up.set(0, 1, 0);
        // a unit that's gone: a few seconds on the wreck, then the next one
        if (this.target && !this.targetAlive()) {
            this.deadT += dt;
            if (this.deadT > 5) { const n = this.sb.nextFollow(1, true); if (n) this.follow(n); else { this.target = null; this.setMode('free'); } }
        }
        if (this.mode === 'free' || !this.target) this.flyFree(cam, dt, m, input);
        else {
            const P = this.targetPos(_v);
            if (!P) { this.setMode('free'); this.flyFree(cam, dt, m, input); }
            else {
                this.at.lerp(P, 1 - Math.exp(-dt * 12));
                if (this.at.distanceToSquared(P) > 400 * 400) this.at.copy(P); // (a jump: a new target)
                const S = this.sizeOf();
                this.zoom = clamp(this.zoom * (1 + m.wheel * 0.09), 0.25, 12);
                const V = this.targetVel(_v2);
                if (V && V.lengthSq() > 9) this.dir.lerp(_v3.copy(V).normalize(), 1 - Math.exp(-dt * 2.5)).normalize();
                if (this.mode === 'chase') {
                    const d = (S * 2.2 + 18) * this.zoom;
                    const flatDir = _v3.copy(this.dir).setY(this.dir.y * 0.5).normalize();
                    cam.position.copy(this.at).addScaledVector(flatDir, -d).add(_v2.set(0, d * 0.28 + 2, 0));
                    this.ground(cam.position);
                    cam.lookAt(_v2.copy(this.at).addScaledVector(this.dir, S * 0.8));
                } else if (this.mode === 'orbit') {
                    this.yaw -= m.dx * 0.004; this.pitch = clamp(this.pitch - m.dy * 0.003, -1.35, 0.6);
                    const d = (S * 3 + 30) * this.zoom;
                    cam.position.set(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(d).add(this.at);
                    this.ground(cam.position);
                    cam.lookAt(this.at);
                } else {
                    const d = (S * 8 + 450) * this.zoom;
                    cam.position.set(this.at.x, this.at.y + d, this.at.z + d * 0.18);
                    cam.lookAt(this.at);
                }
                cam.fov = damp(cam.fov, 60, 4, dt);
            }
        }
        cam.updateProjectionMatrix();
        g.viewFocus = this.focus.copy(cam.position);
        return true;
    }

    flyFree(cam, dt, m, input) {
        const F = this.free;
        F.yaw -= m.dx * 0.0025; F.pitch = clamp(F.pitch - m.dy * 0.0025, -1.5, 1.5);
        if (input.down('ArrowLeft')) F.yaw += dt * 1.2;
        if (input.down('ArrowRight')) F.yaw -= dt * 1.2;
        if (input.down('ArrowUp')) F.pitch = clamp(F.pitch + dt, -1.5, 1.5);
        if (input.down('ArrowDown')) F.pitch = clamp(F.pitch - dt, -1.5, 1.5);
        F.speed = clamp(F.speed * (1 - m.wheel * 0.12), 10, 3000);
        _e.set(F.pitch, F.yaw, 0, 'YXZ');
        cam.quaternion.setFromEuler(_e);
        const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion), right = _v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
        const sp = F.speed * (input.down('ShiftLeft', 'ShiftRight') ? 5 : 1) * dt;
        if (input.down('KeyW')) F.pos.addScaledVector(fwd, sp);
        if (input.down('KeyS')) F.pos.addScaledVector(fwd, -sp);
        if (input.down('KeyD')) F.pos.addScaledVector(right, sp);
        if (input.down('KeyA')) F.pos.addScaledVector(right, -sp);
        if (input.down('KeyE')) F.pos.y += sp;
        if (input.down('KeyQ')) F.pos.y -= sp;
        this.ground(F.pos);
        cam.position.copy(F.pos);
        cam.fov = damp(cam.fov, 65, 4, dt);
    }

    ground(p) {
        const g = this.game;
        const gy = Math.max(g.camGround ? g.camGround(p.x, p.z, p.y) : 0, 0) + 3;
        if (p.y < gy) p.y = gy;
    }
}

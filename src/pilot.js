// ═══════════════════════════════════════════════════════════════
// On-foot / under-canopy pilot (War Thunder trailer style):
//  • first-person under the parachute, steer with WASD, look with the mouse
//  • AK-47: shoot enemy parachutists, or shoot a pilot through his canopy
//  • hijack: board any nearby jet whose pilot is dead (or friendly, or your
//    own abandoned jet) — the previous occupant gets shoved out
//  • enemy pilots under canopies shoot back
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, rand, damp } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

// Ray (origin o, unit dir d) vs sphere: returns distance or -1
function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return -1;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? t : -1;
}

export class PilotOnFoot {
    constructor(game, seat, fromAircraft) {
        this.game = game;
        this.seat = seat;
        this.from = fromAircraft;
        this.yaw = seat.root.rotation.y || Math.atan2(-fromAircraft.vel.x, -fromAircraft.vel.z);
        this.pitch = 0;
        this.health = 100;
        this.alive = true;
        this.mag = 30; this.reserve = 120; this.reloadT = 0; this.fireT = 0;
        this.recoil = 0;
        this.hijackT = 0;
        this.hint = '';
        this.landedT = 0;
        this.isChute = true;
        this.team = 'blue';
        this.vel = seat.vel;
        this.incoming = [];
        seat.player = true;
        seat.glide = new THREE.Vector3();
    }

    get pos() { return this.seat.root.position; }
    getForward(out) { return this.viewDir(out); }

    headPos(out) { return out.copy(this.seat.root.position).add(_v3.set(0, this.seat.deployed ? 1.9 : 1.2, 0)); }

    viewDir(out) {
        return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    }

    update(dt, mouse) {
        const g = this.game, input = g.input;
        const sens = 0.0022 * g.settings.sensitivity;
        this.yaw -= mouse.dx * sens;
        this.pitch = clamp(this.pitch - mouse.dy * sens * (g.settings.invertPitch ? -1 : 1), -1.45, 1.45);
        this.recoil = damp(this.recoil, 0, 10, dt);
        // steer the canopy: face direction + forward drive
        const s = this.seat;
        if (s.deployed && !s.landed) {
            const fwd = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 0.6 : 0);
            const turn = (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
            this.yaw += turn * dt * 0.8;
            s.glide.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(4 + fwd * 5);
        }
        // AK-47
        this.fireT -= dt;
        if (this.reloadT > 0) {
            this.reloadT -= dt;
            if (this.reloadT <= 0) { const n = Math.min(30 - this.mag, this.reserve); this.mag += n; this.reserve -= n; }
        } else if (input.mouse.left && this.fireT <= 0) {
            if (this.mag > 0) this.shoot();
            else if (this.reserve > 0) this.reload();
            else { this.fireT = 0.3; g.audio.tick(300, 0.08, 0.05); }
        }
        if (input.down('KeyR') && this.reloadT <= 0 && this.mag < 30 && this.reserve > 0) this.reload();

        // hijack candidates
        const head = this.headPos(_v);
        let best = null, bd = 160;
        for (const a of g.aircraft) {
            if (!a.alive || a.exploded || a.falling || a === this.from && !this.from.abandoned) continue;
            const d = a.pos.distanceTo(head);
            if (d < bd) { bd = d; best = a; }
        }
        this.candidate = best;
        this.hint = '';
        if (best) {
            const boardable = best.pilotDead || best.abandoned || best.team === 'blue';
            this.hint = boardable ? 'E — HIJACK ' + best.spec.name.toUpperCase() + ' (' + Math.round(bd) + ' m)' : 'SHOOT THE PILOT THROUGH THE CANOPY TO HIJACK';
            if (boardable && input.down('KeyE') && this.hijackT <= 0) this.hijack(best);
        }
        // leap animation into the hijacked jet
        if (this.hijackT > 0) {
            this.hijackT -= dt;
            if (this.hijackT <= 0) g.completeHijack(this.hijackTarget, this);
        }
        if (s.landed) {
            this.landedT += dt;
            this.hint = g.lives > 0 ? 'ENTER — REQUEST A NEW JET  (' + (g.lives === Infinity ? '∞' : g.lives) + ' LEFT)' : 'NO AIRFRAMES LEFT';
            if ((input.down('Enter') || input.down('Space')) && this.landedT > 1) g.respawnPlayer();
        }
        this.updateEnemyShooters(dt);
    }

    reload() {
        this.reloadT = 2.2;
        this.game.audio.tick(500, 0.12, 0.08);
        setTimeout(() => this.game.audio.tick(900, 0.12, 0.05), 1500);
    }

    shoot() {
        const g = this.game;
        this.fireT = 0.1; // ~600 rpm
        this.mag--;
        this.recoil = Math.min(this.recoil + 0.012, 0.06);
        this.pitch += 0.004; this.yaw += rand(-0.003, 0.003);
        const o = this.headPos(new THREE.Vector3());
        const d = this.viewDir(new THREE.Vector3());
        d.x += rand(-0.006, 0.006); d.y += rand(-0.006, 0.006); d.z += rand(-0.006, 0.006);
        d.normalize();
        // tracer for looks
        g.weapons.bullets.push({ pos: o.clone().addScaledVector(d, 3), vel: d.clone().multiplyScalar(715).add(this.seat.vel), owner: this, team: 'blue', damage: 0, life: 1.2, tracer: this.mag % 3 === 0, color: [3.2, 2.4, 1.2] });
        g.audio.gunshot && g.audio.gunshot();
        g.events.emit('rifle', this);
        // hitscan: pilots in cockpits, parachutists, airframes
        let hit = null, hitT = 900;
        for (const a of g.aircraft) {
            if (!a.alive || a.isPlayer) continue;
            const cp = _v2.copy(a.rig.cockpit).applyMatrix4(a.model.matrixWorld);
            const tc = raySphere(o, d, cp, 1.3);
            if (tc > 0 && tc < hitT) { hitT = tc; hit = { kind: 'cockpit', a }; continue; }
            const tb = raySphere(o, d, a.pos, a.hitRadius * 0.6);
            if (tb > 0 && tb < hitT) { hitT = tb; hit = { kind: 'body', a }; }
        }
        for (const s of g.wreckage.seats) {
            if (s.player || s.dead || !s.owner) continue;
            const c = _v2.copy(s.root.position).add(_v3.set(0, 1.0, 0));
            const t = raySphere(o, d, c, 1.4);
            if (t > 0 && t < hitT) { hitT = t; hit = { kind: 'chute', s }; }
        }
        if (!hit) return;
        const p = o.clone().addScaledVector(d, hitT);
        g.effects.impact(p, null);
        g.hitmarkerT = g.time;
        if (hit.kind === 'cockpit') {
            const a = hit.a;
            a.pilotHp = (a.pilotHp ?? 100) - 35;
            if (a.pilotHp <= 0 && !a.pilotDead) g.killPilot(a);
        } else if (hit.kind === 'body') {
            hit.a.damage(3, this, 'rifle');
        } else if (hit.kind === 'chute') {
            hit.s.hp = (hit.s.hp ?? 100) - 40;
            if (hit.s.hp <= 0) {
                hit.s.dead = true;
                g.killmarkerT = g.time;
                g.score += 150;
                g.addFeed('ENEMY PILOT KILLED  +150', '#ffc23f');
            }
        }
    }

    hijack(a) {
        this.hijackTarget = a;
        this.hijackT = 0.7;
        this.leapFrom = this.headPos(new THREE.Vector3());
    }

    // Enemy pilots dangling under their own canopies take pot-shots at you
    updateEnemyShooters(dt) {
        const g = this.game;
        const me = this.headPos(_v);
        for (const s of g.wreckage.seats) {
            if (s.player || s.dead || s.landed || !s.deployed || !s.owner || s.owner.team !== 'red') continue;
            const d = s.root.position.distanceTo(me);
            if (d > 450) continue;
            s.shootT = (s.shootT ?? rand(0.5, 2)) - dt;
            if (s.shootT > 0) continue;
            s.shootT = rand(0.09, 0.14);
            s.burst = (s.burst || 0) + 1;
            if (s.burst > 6) { s.burst = 0; s.shootT = rand(1.2, 2.5); }
            const from = _v2.copy(s.root.position).add(_v3.set(0, 1.4, 0));
            const dir = _v3.subVectors(me, from).normalize();
            dir.x += rand(-0.03, 0.03); dir.y += rand(-0.03, 0.03); dir.z += rand(-0.03, 0.03);
            g.weapons.bullets.push({ pos: from.clone(), vel: dir.normalize().multiplyScalar(715), owner: s, team: 'red', damage: 0, life: 1.2, tracer: true, color: [3.4, 1.0, 0.5] });
            if (Math.random() < clamp(0.18 - d / 3000, 0.02, 0.15)) this.takeHit(12);
        }
    }

    takeHit(dmg) {
        if (!this.alive) return;
        const g = this.game;
        this.health -= dmg * g.difficulty.dmgTaken;
        g.damageFlash = Math.min(1, g.damageFlash + 0.5);
        g.audio.thud(0.4);
        if (this.health <= 0) {
            this.alive = false;
            g.pilotKilled();
        }
    }
}

// A body shoved out of a hijacked cockpit, tumbling without a canopy
export function spawnFallingBody(game, a) {
    const w = game.wreckage;
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 4, 8), w.suitMat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), w.helmetMat);
    head.position.y = 0.6;
    root.add(body, head);
    root.scale.setScalar(1.6);
    root.position.copy(a.rig.cockpit).applyMatrix4(a.model.matrixWorld).add(_v.set(0, 2, 0));
    game.scene.add(root);
    const up = a.getUp(new THREE.Vector3()), right = a.getRight(new THREE.Vector3());
    w.parts.push({
        obj: root, vel: a.vel.clone().multiplyScalar(0.6).addScaledVector(up, 18).addScaledVector(right, rand(-10, 10)),
        spin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), life: 30, smokeT: 99, burning: false, heavy: false, radius: 1, body: true,
    });
}

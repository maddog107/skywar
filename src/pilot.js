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
import { Character } from './character.js';

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
        this.prevE = true; // the E that climbed you out mustn't climb you straight back in
        this.hint = '';
        this.landedT = 0;
        this.isChute = true;
        this.team = 'blue';
        this.vel = seat.vel;
        this.incoming = [];
        seat.player = true;
        seat.glide = new THREE.Vector3();
        seat.heading = this.yaw;
        this.flareT = 0; this.flareUsed = false;
        this.walker = null;
        if (seat.character) seat.character.setRifle(true); // third person: the AK is in his hand
        if (seat.walkedOut) this.startWalking();
    }

    // third-person unless the player picked the cockpit (first-person) camera
    get thirdPerson() { return this.game.cameraMode !== 'cockpit'; }

    // On the ground: leave the canopy behind and walk
    startWalking() {
        const s = this.seat, g = this.game;
        if (s.chute && s.chute.parent === s.root) g.scene.attach(s.chute);
        s.seat.visible = false;
        // the same animated pilot steps out of the harness (or a fresh one after climbing out of a jet)
        const ch = s.character || new Character();
        if (s.character) s.pilot.visible = true; else s.pilot.visible = false;
        g.scene.add(ch.root);
        ch.root.scale.setScalar(1);
        ch.root.rotation.set(0, 0, 0);
        ch.setRifle(true);
        this.walker = { mesh: ch.root, character: ch, speed: 0, anim: 0, yaw: this.yaw };
        this.placeWalker();
    }

    placeWalker() {
        const w = this.walker;
        w.mesh.position.copy(this.seat.root.position).setY(this.seat.root.position.y - 0.3);
        w.mesh.rotation.set(0, w.yaw, 0);
    }

    dispose() { if (this.walker) { this.walker.character.dispose(); } }

    get pos() { return this.seat.root.position; }
    getForward(out) { return this.viewDir(out); }

    headPos(out) { return out.copy(this.seat.root.position).add(_v3.set(0, this.walker ? 1.45 : this.seat.deployed ? 1.9 : 1.2, 0)); }

    viewDir(out) {
        return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    }

    update(dt, mouse) {
        const g = this.game, input = g.input;
        const sens = 0.0022 * g.settings.sensitivity;
        this.yaw -= mouse.dx * sens;
        this.pitch = clamp(this.pitch - mouse.dy * sens * (g.settings.invertPitch ? -1 : 1), -1.45, 1.45);
        this.recoil = damp(this.recoil, 0, 10, dt);
        const s = this.seat;
        // first person: don't render your own body around the camera
        if (this.walker) this.walker.mesh.visible = this.thirdPerson;
        else if (s.pilot) s.pilot.visible = this.thirdPerson;
        if (s.deployed && !s.landed) this.steerCanopy(dt, input);
        else if (s.landed) {
            if (!this.walker) this.startWalking();
            this.walk(dt, input);
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
        let best = null, bd = this.walker ? 16 : 160; // on foot you have to walk up to the jet
        for (const a of g.aircraft) {
            if (!a.alive || a.exploded || a.falling || a.bellied || a === this.from && !this.from.abandoned) continue;
            const d = a.pos.distanceTo(head);
            if (d < bd) { bd = d; best = a; }
        }
        this.candidate = best;
        this.hint = '';
        const eDown = input.down('KeyE'), ePress = eDown && !this.prevE;
        this.prevE = eDown;
        if (best) {
            const vip = this.game.mstate && this.game.mstate.transport === best;
            const boardable = !vip && (best.pilotDead || best.abandoned || best.team === 'blue');
            this.hint = vip ? 'PROTECT THE VIP — NO BOARDING' : boardable ? (best === this.from ? 'E — CLIMB BACK IN' : best.team === 'blue' && !best.pilotDead ? 'E — BOARD ' : 'E — HIJACK ') + (best === this.from ? '' : best.spec.name.toUpperCase()) + ' (' + Math.round(bd) + ' m)' : 'SHOOT THE PILOT THROUGH THE CANOPY TO HIJACK';
            if (boardable && ePress && this.hijackT <= 0) this.hijack(best);
        }
        // leap animation into the hijacked jet
        if (this.hijackT > 0) {
            this.hijackT -= dt;
            if (this.hijackT <= 0) { g.completeHijack(this.hijackTarget, this); return; }
        }
        if (s.landed) {
            this.landedT += dt;
            if (!this.hint) this.hint = g.lives > 0 ? 'ENTER — REQUEST A NEW JET  (' + (g.lives === Infinity ? '∞' : g.lives) + ' LEFT)' : 'NO AIRFRAMES LEFT';
            if (input.down('Enter') && this.landedT > 1) g.respawnPlayer();
        } else if (s.deployed) {
            // a long ride down from altitude: allow skipping it (the hijack prompt takes priority)
            this.airT = (this.airT || 0) + dt;
            if (!this.hint && this.airT > 3 && g.lives > 0) this.hint = 'ENTER — SKIP THE DESCENT, REQUEST A NEW JET';
            if (this.airT > 3 && g.lives > 0 && input.down('Enter')) g.respawnPlayer();
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
        this.lastShotT = g.time;
        this.mag--;
        this.recoil = Math.min(this.recoil + 0.012, 0.06);
        this.pitch += 0.004; this.yaw += rand(-0.003, 0.003);
        // third person: aim down the camera's line of sight (the crosshair), first person: from the eyes
        const tp = this.thirdPerson;
        const o = tp ? g.camera.position.clone() : this.headPos(new THREE.Vector3());
        const d = tp ? g.camera.getWorldDirection(new THREE.Vector3()) : this.viewDir(new THREE.Vector3());
        if (tp) o.addScaledVector(d, this.walker ? 4.5 : 17);
        d.x += rand(-0.006, 0.006); d.y += rand(-0.006, 0.006); d.z += rand(-0.006, 0.006);
        d.normalize();
        // tracer for looks: from the rifle's muzzle when you can see it
        const ch = this.walker ? this.walker.character : this.seat.character;
        const mz = tp && ch && ch.muzzlePos(new THREE.Vector3());
        if (mz) g.effects.fire.emit(mz, this.seat.vel, 0.05, 0.35, 0.12, [4, 3, 1.6], [2, 1, 0.3], 1, 0, 0, 0);
        const td = mz ? o.clone().addScaledVector(d, 250).sub(mz).normalize() : d; // converge on the aim point
        g.weapons.bullets.push({ pos: mz ? mz.clone() : o.clone().addScaledVector(d, 3), vel: td.clone().multiplyScalar(715).add(this.seat.vel), owner: this, team: 'blue', damage: 0, life: 1.2, tracer: this.mag % 3 === 0, color: [3.2, 2.4, 1.2] });
        g.audio.gunshot && g.audio.gunshot();
        g.events.emit('rifle', this);
        // hitscan: pilots in cockpits, parachutists, airframes
        let hit = null, hitT = 900;
        for (const a of g.aircraft) {
            if (!a.alive || a.isPlayer || a === this.from || a.team === 'blue') continue;
            const cp = _v2.copy(a.rig.cockpit).applyMatrix4(a.model.matrixWorld);
            const tc = raySphere(o, d, cp, 1.3);
            if (tc > 0 && tc < hitT) { hitT = tc; hit = { kind: 'cockpit', a }; continue; }
            const tb = raySphere(o, d, a.pos, a.hitRadius * 0.6);
            if (tb > 0 && tb < hitT) { hitT = tb; hit = { kind: 'body', a }; }
        }
        for (const s of g.wreckage.seats) {
            if (s.player || s.dead || !s.owner || s.owner.team !== 'red') continue;
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

    // Ram-air canopy: A/D turn (and bank), W = front risers (faster, steeper), S = brakes (slow, floaty),
    // SPACE near the ground = flare for a soft touchdown
    steerCanopy(dt, input) {
        const s = this.seat;
        const turn = (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
        const fast = input.down('KeyW', 'ArrowUp'), brake = input.down('KeyS', 'ArrowDown');
        const rate = turn * (brake ? 0.55 : fast ? 1.25 : 0.9);
        s.heading += rate * dt;
        this.yaw += rate * dt; // the view turns with the canopy
        s.bank = damp(s.bank || 0, -turn * (fast ? 0.45 : 0.3), 3, dt);
        const agl = this.pos.y - this.game.surfaceAt(this.pos.x, this.pos.z, this.pos.y).h;
        if (input.down('Space') && !this.flareUsed && agl < 22) { this.flareUsed = true; this.flareT = 2.2; this.game.audio.tick(250, 0.2, 0.1); }
        let speed = fast ? 14 : brake ? 4 : 9, sink = fast ? 8.5 : brake ? 3.8 : 5.5;
        if (this.flareT > 0) { this.flareT -= dt; speed = 5; sink = 0.8; }
        s.pitchLean = damp(s.pitchLean || 0, fast ? 0.25 : brake ? -0.2 : 0, 3, dt);
        s.sink = sink;
        s.glide.set(-Math.sin(s.heading), 0, -Math.cos(s.heading)).multiplyScalar(speed);
        this.agl = agl;
    }

    // On foot: WASD relative to where you look, SHIFT to run
    walk(dt, input) {
        const w = this.walker, s = this.seat, g = this.game;
        const f = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
        const r = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
        let mx = 0, mz = 0;
        if (f || r) {
            const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
            mx = fx * f + rx * r; mz = fz * f + rz * r;
            const L = Math.hypot(mx, mz); mx /= L; mz /= L;
            let dy = Math.atan2(-mx, -mz) - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            w.yaw += dy * Math.min(1, dt * 10);
        }
        // shooting: square up to where you're aiming so the rifle points at it
        if ((this.lastShotT ?? -9) > g.time - 0.3) {
            let da = this.yaw - w.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
            w.yaw += da * Math.min(1, dt * 14);
        }
        w.speed = damp(w.speed, (f || r) ? (input.down('ShiftLeft', 'ShiftRight') ? 6.5 : 3.4) : 0, 8, dt);
        const p = s.root.position;
        const nx = p.x + mx * w.speed * dt, nz = p.z + mz * w.speed * dt;
        const ahead = g.surfaceAt(nx, nz, p.y + 1.5);
        const wasWet = g.surfaceAt(p.x, p.z, p.y + 1.5).water;
        if (!ahead.water || wasWet) { p.x = nx; p.z = nz; } // no walking out onto lakes (you can wade ashore)
        else { w.speed = 0; this.hint = this.hint || 'WATER — FIND ANOTHER WAY'; }
        const su = g.surfaceAt(p.x, p.z, p.y + 1.5);
        p.y = (su.water ? -0.9 : su.h) + 0.3;
        w.character.locomotion(w.speed, (this.lastShotT ?? -9) > g.time - 0.3);
        this.placeWalker();
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
    const ch = new Character();
    ch.play('Death', 0.1);
    ch.root.position.y = -0.9;
    root.add(ch.root);
    root.scale.setScalar(1.15);
    root.position.copy(a.rig.cockpit).applyMatrix4(a.model.matrixWorld).add(_v.set(0, 2, 0));
    game.scene.add(root);
    const up = a.getUp(new THREE.Vector3()), right = a.getRight(new THREE.Vector3());
    w.parts.push({
        obj: root, inert: true, vel: a.vel.clone().multiplyScalar(0.6).addScaledVector(up, 18).addScaledVector(right, rand(-10, 10)),
        spin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), life: 30, smokeT: 99, burning: false, heavy: false, radius: 1, body: true,
    });
}

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
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

// AK-47 with a drum: 60 rounds, ~920 rpm, 540 spare
export const AK = { interval: 0.065, mag: 60, reserve: 540, reload: 2.2 };
const CANOPY_HP = 150;

// squared distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9)
export function segSegDistSq(p1, q1, p2, q2) {
    const d1 = _a.subVectors(q1, p1), d2 = _b.subVectors(q2, p2), r = _c.subVectors(p1, p2);
    const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
    let s, t;
    if (a < 1e-9 && e < 1e-9) return r.lengthSq();
    if (a < 1e-9) { s = 0; t = clamp(f / e, 0, 1); }
    else {
        const c = d1.dot(r);
        if (e < 1e-9) { t = 0; s = clamp(-c / a, 0, 1); }
        else {
            const b = d1.dot(d2), den = a * e - b * b;
            s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
            t = (b * s + f) / e;
            if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
        }
    }
    const dx = p1.x + d1.x * s - (p2.x + d2.x * t), dy = p1.y + d1.y * s - (p2.y + d2.y * t), dz = p1.z + d1.z * s - (p2.z + d2.z * t);
    return dx * dx + dy * dy + dz * dz;
}

// does segment a-b pass through the ellipsoid at c with horizontal radius rx and vertical radius ry?
export function segHitsEllipsoid(a, b, c, rx, ry) {
    const k = rx / ry;
    const ax = a.x - c.x, ay = (a.y - c.y) * k, az = a.z - c.z;
    const dx = b.x - a.x, dy = (b.y - a.y) * k, dz = b.z - a.z;
    const L2 = dx * dx + dy * dy + dz * dz;
    const t = L2 > 0 ? clamp(-(ax * dx + ay * dy + az * dz) / L2, 0, 1) : 0;
    const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
    return px * px + py * py + pz * pz < rx * rx;
}

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

// ── Ejection seats as targets (damage.js seat objects: root, chute, deployed, landed, dead, owner, player) ──
// The body: a capsule from the boots to the helmet — hanging in the harness (the seat root is scaled 1.6x),
// or standing on the ground. The canopy: a flattened dome ~12 m above the harness.
export function seatBody(s, a, b, standing = s.landed) {
    const r = s.root;
    if (standing) { a.copy(r.position); b.copy(r.position).y += 1.6; return; }
    r.updateMatrixWorld();
    r.localToWorld(a.set(0, 0.15, 0)); r.localToWorld(b.set(0, 1.2, 0));
}
export const seatCanopyUp = (s) => s.deployed && !s.landed && !s.canopyGone && s.chute && s.chute.visible;
export function seatCanopyCenter(s, out) { const r = s.root; r.updateMatrixWorld(); return r.localToWorld(out.set(0, 7.9, 0)); }
// what a round from a to b this frame hits: 'body', 'canopy' or null
export function seatHitTest(s, a, b, standing = s.landed) {
    seatBody(s, _v2, _v3, standing);
    if (segSegDistSq(a, b, _v2, _v3) < 0.55 * 0.55) return 'body';
    if (seatCanopyUp(s) && segHitsEllipsoid(a, b, seatCanopyCenter(s, _v2), 6.6, 2.4)) return 'canopy';
    return null;
}
// holes spill air: the dome sags as it tears, and a shredded one is just a streamer. Returns true when shredded.
export function tearSeatCanopy(s, amount) {
    if (!seatCanopyUp(s)) return false;
    s.canopyHp = Math.max(0, (s.canopyHp ?? CANOPY_HP) - amount);
    const torn = 1 - s.canopyHp / CANOPY_HP, dome = s.chute.children[0];
    if (s.canopyHp <= 0) { s.canopyGone = true; if (dome) dome.scale.set(0.22, 1.7, 0.22); return true; }
    if (dome) dome.scale.set(1 - torn * 0.25, 0.6 * (1 - torn * 0.35), 1 - torn * 0.25);
    return false;
}
export const isEnemySeat = (s) => !s.player && !s.dead && !!s.owner && s.owner.team === 'red';
// an enemy pilot (under his canopy or on the ground) takes `dmg`; the player (or his rifle) gets the kill
export function hitEnemySeat(g, s, dmg, source) {
    if (s.dead || dmg <= 0) return;
    s.hp = (s.hp ?? 100) - dmg;
    if (s.hp > 0) return;
    s.dead = true; // damage.js: a dead pilot hangs limp and comes down faster
    if (s.character) { s.character.setRifle && s.character.setRifle(false); s.character.play('Death', 0.12); }
    if (source && (source === g.player || source === g.pilotMode)) {
        g.killmarkerT = g.time; g.hitmarkerT = g.time;
        g.score += 150;
        g.addFeed('ENEMY PILOT KILLED  +150', '#ffc23f');
    }
    g.events.emit('seatKilled', s, { source });
}
// a shredded enemy canopy: he drops like a stone (killed on impact, see Game.updateSeats)
export function shredEnemyCanopy(g, s, amount, source) {
    if (tearSeatCanopy(s, amount)) { s.sink = 45; s.doomedBy = source || null; if (source === g.player) g.addFeed('ENEMY CANOPY SHREDDED', '#ffc23f'); }
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
        this.mag = AK.mag; this.reserve = AK.reserve; this.reloadT = 0; this.fireT = 0; this.lastShotT = -9;
        seat.canopyHp = CANOPY_HP; seat.canopyGone = false; // bullets through the canopy tear it
        this.wasLanded = !!seat.landed; this.descentV = 0;
        this.strafeT = 0; this.threat = null; this.lastHitT = -9;
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
        // AK-47: the interval accumulates, so the rate holds at any frame rate (several rounds in a long frame)
        this.fireT -= dt;
        if (this.reloadT > 0) {
            this.reloadT -= dt;
            if (this.reloadT <= 0) { const n = Math.min(AK.mag - this.mag, this.reserve); this.mag += n; this.reserve -= n; }
        } else if (input.mouse.left) {
            for (let k = 0; k < 4 && this.fireT <= 0; k++) {
                if (this.mag > 0) this.shoot();
                else { if (this.reserve > 0) this.reload(); else { this.fireT = 0.3; g.audio.tick(300, 0.08, 0.05); } break; }
            }
        }
        if (!input.mouse.left || this.reloadT > 0) this.fireT = Math.max(this.fireT, 0); // no stored-up burst
        if (input.down('KeyR') && this.reloadT <= 0 && this.mag < AK.mag && this.reserve > 0) this.reload();
        // landing: a torn (or shredded) canopy comes down hard
        if (s.landed && !this.wasLanded && this.descentV > 9) this.takeHit((this.descentV - 9) * 7, 'HIT THE GROUND TOO HARD');
        this.wasLanded = s.landed;
        if (!s.landed) this.descentV = -s.vel.y;

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
            // a mission on its last jet: that jet is the only one you may fly (no second life by commandeering another)
            const lastJet = g.mission && g.lives <= 0 && best !== this.from;
            const boardable = !vip && !lastJet && (best.pilotDead || best.abandoned || best.team === 'blue');
            this.hint = vip ? 'PROTECT THE VIP — NO BOARDING' : lastJet ? 'LAST JET — YOU CAN ONLY FLY YOUR OWN' : boardable ? (best === this.from ? 'E — CLIMB BACK IN' : best.team === 'blue' && !best.pilotDead ? 'E — BOARD ' : 'E — HIJACK ') + (best === this.from ? '' : best.spec.name.toUpperCase()) + ' (' + Math.round(bd) + ' m)' : 'SHOOT THE PILOT THROUGH THE CANOPY TO HIJACK';
            if (boardable && ePress && this.hijackT <= 0) this.hijack(best);
        }
        // leap animation into the hijacked jet
        if (this.hijackT > 0) {
            this.hijackT -= dt;
            if (this.hijackT <= 0) { g.completeHijack(this.hijackTarget, this); return; }
        }
        if (s.landed) {
            this.landedT += dt;
            if (!this.hint) this.hint = g.lives > 0 ? 'ENTER — REQUEST A NEW JET  (' + (g.lives === Infinity ? '∞' : g.lives) + ' LEFT)' : 'NO AIRFRAMES LEFT — ENTER: END THE SORTIE';
            if (input.down('Enter') && this.landedT > 1) g.respawnPlayer(); // (with none left, that ends the sortie)
        } else if (s.deployed) {
            // a long ride down from altitude: allow skipping it (the hijack prompt takes priority)
            this.airT = (this.airT || 0) + dt;
            if (!this.hint && this.airT > 3 && g.lives > 0) this.hint = 'ENTER — SKIP THE DESCENT, REQUEST A NEW JET';
            if (this.airT > 3 && g.lives > 0 && input.down('Enter')) g.respawnPlayer();
        }
        this.updateEnemyShooters(dt);
        this.watchThreats(dt);
    }

    reload() {
        this.reloadT = AK.reload; // (cockpit.js animates the reload over the same 2.2 s)
        this.game.audio.tick(500, 0.12, 0.08);
        setTimeout(() => this.game.audio.tick(900, 0.12, 0.05), 1500);
    }

    shoot() {
        const g = this.game;
        this.fireT += AK.interval;
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
            hitEnemySeat(g, hit.s, 40, this);
        }
    }

    // Ram-air canopy: A/D turn (and bank), W = front risers (faster, steeper), S = brakes (slow, floaty),
    // SPACE near the ground = flare for a soft touchdown
    steerCanopy(dt, input) {
        const s = this.seat;
        const torn = 1 - this.canopyHp / CANOPY_HP; // 0 intact … 1 shredded
        const turn = this.canopyGone ? 0 : (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0);
        const fast = input.down('KeyW', 'ArrowUp'), brake = input.down('KeyS', 'ArrowDown');
        const rate = turn * (brake ? 0.55 : fast ? 1.25 : 0.9) * (1 - torn * 0.5);
        s.heading += rate * dt;
        this.yaw += rate * dt; // the view turns with the canopy
        s.bank = damp(s.bank || 0, -turn * (fast ? 0.45 : 0.3), 3, dt);
        const agl = this.pos.y - this.game.surfaceAt(this.pos.x, this.pos.z, this.pos.y).h;
        if (input.down('Space') && !this.flareUsed && !this.canopyGone && agl < 22) { this.flareUsed = true; this.flareT = 2.2; this.game.audio.tick(250, 0.2, 0.1); }
        // holes spill air: a torn canopy sinks faster and flies slower; a shredded one is just a streamer
        let speed = (fast ? 14 : brake ? 4 : 9) * (1 - torn * 0.35), sink = (fast ? 8.5 : brake ? 3.8 : 5.5) + torn * 6;
        if (this.flareT > 0) { this.flareT -= dt; speed = 5; sink = 0.8 + torn * 4; }
        if (this.canopyGone) { speed = 2; sink = 45; } // near free fall
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
        const bl = g.world.towns && g.world.towns.buildings;
        if (bl && bl.blocks(nx, nz, p.y)) { w.speed = 0; this.placeWalker(); return; } // walls are solid
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

    // ── Getting hit (weapons.js: red-team rounds and blasts) ──
    get canopyHp() { return this.seat.canopyHp ?? CANOPY_HP; }
    get canopyGone() { return !!this.seat.canopyGone; }
    get canopyUp() { return seatCanopyUp(this.seat); }

    // a round from a to b this frame: true if it hit you (or your canopy)
    bulletHit(a, b, damage) {
        if (!this.alive) return false;
        const hit = seatHitTest(this.seat, a, b, !!this.walker);
        if (hit === 'body') this.takeHit(22 + damage, 'CUT DOWN BY GUNFIRE');
        else if (hit === 'canopy') this.tearCanopy(6 + damage * 0.4);
        return !!hit;
    }

    // an explosion at `at` (radius R, damage at the centre)
    blast(at, R, dmg) {
        if (!this.alive) return;
        seatBody(this.seat, _v2, _v3, !!this.walker);
        const d = _v2.lerp(_v3, 0.5).distanceTo(at);
        if (d < R) this.takeHit(dmg * (1 - d / R), 'CAUGHT IN A BLAST');
        if (this.alive && this.canopyUp) { const dc = seatCanopyCenter(this.seat, _v2).distanceTo(at); if (dc < R + 6) this.tearCanopy(dmg * 0.6 * (1 - dc / (R + 6))); }
    }

    tearCanopy(amount) {
        const g = this.game;
        if (!this.canopyUp || !this.alive) return;
        if (tearSeatCanopy(this.seat, amount)) {
            g.showBanner('CANOPY SHREDDED', "You're falling — brace for impact", 3, '#ff4a3d');
            g.audio.say('My chute! My chute!', true);
            g.shake = Math.min(1.5, g.shake + 0.8);
            return;
        }
        if (g.time - (this.tearMsgT ?? -9) > 1.5) { this.tearMsgT = g.time; g.addFeed('CANOPY HIT — ' + Math.round(this.canopyHp / CANOPY_HP * 100) + '% · SINKING FASTER', '#ff9f5a'); }
    }

    takeHit(dmg, cause) {
        if (!this.alive || dmg <= 0) return;
        const g = this.game;
        this.health -= dmg * g.difficulty.dmgTaken;
        this.lastHitT = g.time;
        g.damageFlash = Math.min(1, g.damageFlash + 0.35 + dmg / 80);
        g.shake = Math.min(1.5, g.shake + 0.25 + dmg / 120);
        g.audio.thud(0.4);
        if (this.health <= 0) {
            this.health = 0;
            this.alive = false;
            this.die();
            g.pilotKilled(cause);
        } else if (this.health < 50 && !this.hurtCall) { this.hurtCall = true; g.audio.say("I'm hit! I'm hit!", true); }
    }

    // dead: the body goes limp (a hanging one keeps descending under whatever is left of the canopy)
    die() {
        const ch = this.walker ? this.walker.character : this.seat.character;
        if (ch) { ch.setRifle(false); ch.play('Death', 0.12); }
        this.seat.dead = true;
        if (this.walker) this.walker.mesh.visible = true;
        else if (this.seat.pilot) this.seat.pilot.visible = true;
        if (this.game.cameraMode === 'cockpit') this.game.cameraMode = 'chase'; // see what happened
    }

    // hostile jets lining up on you (the HUD warns): within ~2.5 km, nose on you, closing
    watchThreats(dt) {
        const g = this.game, me = this.headPos(_v);
        let best = null, bestD = 2600;
        for (const a of g.aircraft) {
            if (!a.alive || a.team !== 'red' || a.onGround || a.pilotDead) continue;
            const d = a.pos.distanceTo(me);
            if (d > bestD) continue;
            const to = _v2.subVectors(me, a.pos).divideScalar(d);
            if (a.getForward(_v3).dot(to) > 0.94 && a.vel.dot(to) > 60) { best = a; bestD = d; }
        }
        this.threat = best;
        this.strafeT = best ? 0.6 : Math.max(0, this.strafeT - dt);
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

// ═══════════════════════════════════════════════════════════════
// AI pilots. Uses the same flight model and controls as the player.
// Skill (0..1) affects reaction time, aim error, G usage, lead accuracy,
// missile discipline and defensive flying.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, rand, lerp, G } from './util.js';
import { WEAPONS } from './config.js';
import { terrainHeight } from './world.js';

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3();
const _d = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3(), _a = new THREE.Vector3();

// Turn a desired world direction into stick inputs (bank-to-turn like a real pilot).
export function steerToward(ac, dir, c, aggr = 1, keepUpright = true) {
    _f.set(0, 0, -1).applyQuaternion(ac.qv);
    _u.set(0, 1, 0).applyQuaternion(ac.qv);
    _r.set(1, 0, 0).applyQuaternion(ac.qv);
    const x = dir.dot(_r), y = dir.dot(_u), z = dir.dot(_f);
    const angle = Math.acos(clamp(z, -1, 1));
    const bank = Math.atan2(-_r.y, _u.y); // + = right wing down
    if (angle < 0.14) {
        // fine tracking: small pitch/yaw corrections, gently level the wings
        c.pitch = clamp(y * 14 * aggr, -1, 1);
        c.yaw = clamp(-x * 10, -1, 1);
        const levelTerm = keepUpright ? -bank * 0.35 : 0;
        c.roll = clamp(x * 10 + levelTerm, -1, 1);
    } else {
        let rollErr = Math.atan2(x, y); // angle to roll so the target sits in the lift plane
        // if the target is below and near the nose, push instead of rolling inverted
        if (Math.abs(rollErr) > 2.4 && angle < 0.5) {
            c.roll = clamp(x * 6 - bank * 0.3, -1, 1);
            c.pitch = clamp(y * 6, -0.8, 0);
            c.yaw = clamp(-x * 6, -1, 1);
            return angle;
        }
        c.roll = clamp(rollErr * 2.6, -1, 1);
        const align = Math.cos(rollErr);
        c.pitch = clamp(angle * 3.2, 0, 1) * clamp(align * 1.6, -0.25, 1) * aggr;
        c.yaw = clamp(-x * 2, -1, 1) * 0.4;
    }
    return angle;
}

// Terrain / altitude avoidance. Returns true if it took over the controls.
export function avoidTerrain(ac, c, minAGL = 150) {
    const V = ac.speed;
    let danger = 0;
    for (const t of [1, 2.2, 4]) {
        _p.copy(ac.pos).addScaledVector(ac.vel, t);
        const h = Math.max(terrainHeight(_p.x, _p.z), 0);
        const margin = _p.y - h - minAGL * (t < 2 ? 0.6 : 1);
        if (margin < 0) danger = Math.max(danger, clamp(-margin / 150, 0.3, 1) * (t === 1 ? 1.2 : t === 2.2 ? 1 : 0.7));
    }
    const hHere = Math.max(terrainHeight(ac.pos.x, ac.pos.z), 0);
    if (ac.pos.y - hHere < minAGL * 0.5 && ac.vel.y < 0) danger = Math.max(danger, 1);
    if (danger <= 0) return false;
    // climb out, wings level
    _d.copy(ac.vel).setY(0).normalize();
    if (_d.lengthSq() < 0.1) _d.set(0, 0, -1);
    _d.y = 0.9 * danger + 0.3;
    _d.normalize();
    steerToward(ac, _d, c, 1);
    c.throttle = 1;
    void V;
    return true;
}

export class Pilot {
    constructor(game, ac, skill = 0.5) {
        this.game = game;
        this.ac = ac;
        this.skill = clamp(skill, 0.1, 1);
        ac.pilot = this;
        this.target = null;
        this.state = 'engage';
        this.thinkT = rand(0, 0.5);
        this.stateT = 0;
        this.lockT = 0;
        this.missileCD = rand(3, 8);
        this.burstT = 0;
        this.jinkT = 0; this.jinkDir = new THREE.Vector3();
        this.aimWobble = rand(0, 100);
        this.noticeT = 0;
        this.home = null; // patrol anchor
        this.formation = null; // {leader, offset}
    }

    enemiesOf() {
        const out = [];
        for (const a of this.game.aircraft) if (a.alive && a.team !== this.ac.team && !a.onGround && !a.abandoned) out.push(a);
        // an ejected player hanging under a canopy is fair game for the bad guys
        const pm = this.game.pilotMode;
        if (pm && pm.alive && !pm.seat.landed && this.ac.team === 'red') out.push(pm);
        if (this.leash && this.home) return out.filter(e => e.pos.distanceTo(this.home) < this.leash);
        return out;
    }

    pickTarget() {
        const ac = this.ac;
        if (this.passive) { this.target = null; return; }
        const fwd = ac.getForward(_f);
        let best = null, bestScore = Infinity;
        for (const e of this.enemiesOf()) {
            const d = e.pos.distanceTo(ac.pos);
            const dot = _d.subVectors(e.pos, ac.pos).normalize().dot(fwd);
            let score = d * (1.6 - dot * 0.6);
            if (e.isPlayer) score *= this.game.aggroPlayer ?? 0.8; // hostiles prefer the player a bit
            if (e.isChute) score *= 1.6;
            if (e === this.target) score *= 0.7; // stickiness
            if (score < bestScore) { bestScore = score; best = e; }
        }
        // escort missions: go for the protected aircraft most of the time (decided every few seconds)
        this.priorityT = (this.priorityT || 0) - 1;
        if (this.priorityT <= 0) { this.usePriority = Math.random() < 0.65; this.priorityT = 6 + Math.floor(Math.random() * 8); }
        if (this.priority && this.priority.alive && (this.usePriority || !best)) best = this.priority;
        if (best !== this.target) this.lockT = 0;
        this.target = best;
    }

    threatMissile() {
        const ac = this.ac;
        let best = null, bestT = Infinity;
        for (const m of ac.incoming) {
            const d = m.pos.distanceTo(ac.pos);
            const closing = Math.max(50, m.vel.length() - ac.speed * 0.3);
            const tti = d / closing;
            if (tti < bestT) { bestT = tti; best = m; }
        }
        return best ? { m: best, tti: bestT } : null;
    }

    update(dt) {
        const ac = this.ac;
        if (!ac.alive || ac.falling) return;
        const c = ac.controls;
        const g = this.game;
        const sk = this.skill;
        this.thinkT -= dt;
        this.stateT -= dt;
        this.missileCD -= dt;

        if (this.thinkT <= 0) {
            this.thinkT = lerp(0.9, 0.25, sk) + rand(0, 0.2);
            this.pickTarget();
            const threat = this.threatMissile();
            // Rookies often don't notice missiles until late
            if (threat && threat.tti < lerp(2.5, 7, sk) && Math.random() < lerp(0.55, 1, sk)) {
                this.state = 'defend';
                this.stateT = 1.5;
                this.defendMissile = threat.m;
            } else if (this.state === 'defend' && this.stateT <= 0) {
                this.state = 'engage';
            }
            if (this.state === 'engage' && ac.health < ac.maxHealth * 0.3 && sk > 0.45 && Math.random() < 0.3) {
                this.state = 'extend';
                this.stateT = rand(5, 9);
            }
            if (this.state === 'extend' && this.stateT <= 0) this.state = 'engage';
            // being gunned? jink
            if (this.state === 'engage') {
                for (const e of this.enemiesOf()) {
                    if (e.isChute) continue;
                    const d = e.pos.distanceTo(ac.pos);
                    if (d > 900) continue;
                    const ef = e.getForward(_f);
                    const toMe = _d.subVectors(ac.pos, e.pos).normalize();
                    if (ef.dot(toMe) > 0.985 && Math.random() < sk * 0.7) {
                        this.state = 'jink';
                        this.stateT = rand(1.2, 2.5);
                        break;
                    }
                }
            } else if (this.state === 'jink' && this.stateT <= 0) this.state = 'engage';
        }

        const aggr = lerp(0.6, 1.0, sk);
        let wantDir = _t.set(0, 0, -1).applyQuaternion(ac.qv);
        let throttle = 0.85;
        let wantGuns = false;

        if (this.waypoint) {
            // transports / bombers: fly the route, hold altitude, don't fight
            const to = _d.subVectors(this.waypoint, ac.pos);
            to.y = clamp((this.waypoint.y - ac.pos.y) / 1500, -0.25, 0.25) * to.length() * 0.001 + to.y * 0;
            wantDir = _t.set(to.x, 0, to.z).normalize();
            wantDir.y = clamp((this.waypoint.y - ac.pos.y) / 2000, -0.2, 0.2);
            wantDir.normalize();
            steerToward(ac, wantDir, c, 0.6);
            c.throttle = this.cruise ?? 0.75;
            avoidTerrain(ac, c, 200);
            return;
        }
        const FL = this.formation && this.formation.leader;
        if (FL && FL !== this.game.player) this.formation.leader = this.game.player; // follow whatever jet the player flies
        if (this.formation && !this.target && this.formation.leader && !this.formation.leader.onGround && this.formation.leader.alive) {
            // hold position off the leader's wing
            const L = this.formation.leader;
            if (L && L.alive) {
                _p.copy(this.formation.offset).applyQuaternion(L.qv).add(L.pos).addScaledVector(L.vel, 1.2);
                wantDir = _t.subVectors(_p, ac.pos);
                const dist = wantDir.length();
                wantDir.normalize();
                throttle = clamp(L.throttle + (dist - 20) * 0.004 - ac.vel.clone().sub(L.vel).dot(wantDir) * 0.01, 0, 1);
                if (dist < 60) wantDir.lerp(_d.set(0, 0, -1).applyQuaternion(L.qv), 1 - dist / 60).normalize();
            }
        } else if (this.state === 'defend' && this.defendMissile) {
            const m = this.defendMissile;
            // beam the missile: turn perpendicular to its line of sight and dive a little
            const los = _d.subVectors(ac.pos, m.pos).setY(0).normalize();
            const perp = _p.set(-los.z, 0, los.x);
            const fwd = ac.getForward(_f);
            if (perp.dot(fwd) < 0) perp.negate();
            wantDir = _t.copy(perp).addScaledVector(_u.set(0, -1, 0), 0.25).normalize();
            throttle = 1;
            const dist = m.pos.distanceTo(ac.pos);
            // flare timing: skilled pilots dump flares right as the missile closes in
            const tti = dist / Math.max(80, m.vel.length() - ac.speed * 0.3);
            m.flaredBy = m.flaredBy || new Map();
            const n = m.flaredBy.get(ac) || 0;
            if (ac.flares > 0 && n < 2 && tti < lerp(1.2, 2.6, sk) - n * 0.9 && Math.random() < lerp(0.5, 0.95, sk)) {
                g.weapons.dropFlares(ac, g.time);
                m.flaredBy.set(ac, n + 1);
            } else if (n < 2 && tti < lerp(1.2, 2.6, sk) - n * 0.9) m.flaredBy.set(ac, n + 1);
            if (!ac.incoming.includes(m)) { this.state = 'engage'; this.defendMissile = null; }
        } else if (this.state === 'jink') {
            this.jinkT -= dt;
            if (this.jinkT <= 0) {
                this.jinkT = rand(0.5, 1.1);
                this.jinkDir.set(rand(-1, 1), rand(-0.5, 0.8), rand(-1, 1)).normalize();
            }
            wantDir = _t.copy(ac.getForward(_f)).addScaledVector(this.jinkDir, 1.8).normalize();
            throttle = 1;
        } else if (this.state === 'extend') {
            // run away from the nearest enemy, low and fast
            const t = this.target;
            if (t) wantDir = _t.subVectors(ac.pos, t.pos).setY(0).normalize().setY(-0.05).normalize();
            throttle = 1;
        } else if (this.target) {
            const t = this.target;
            const rel = _d.subVectors(t.pos, ac.pos);
            const dist = rel.length();
            // lead pursuit with skill-based accuracy
            const tof = dist / (WEAPONS.bulletSpeed + ac.speed * 0.5);
            const lead = lerp(0.55, 1.0, sk);
            _p.copy(t.pos).addScaledVector(t.vel, tof * lead);
            _p.y += 0.5 * G * tof * tof * 0.5; // bullet drop
            // aim error that shrinks with skill
            const wob = (1 - sk) * 28;
            this.aimWobble += dt;
            _p.x += Math.sin(this.aimWobble * 1.7) * wob;
            _p.y += Math.sin(this.aimWobble * 2.3 + 1) * wob;
            _p.z += Math.cos(this.aimWobble * 1.3) * wob;
            if (dist > 2500) {
                // pure pursuit when far, slightly above to keep energy
                _p.copy(t.pos).y += 150;
            }
            wantDir = _t.subVectors(_p, ac.pos).normalize();
            // prefer to fight with altitude in hand rather than on the deck
            const agl = ac.pos.y - Math.max(terrainHeight(ac.pos.x, ac.pos.z), 0);
            if (agl < 700 && dist > 600) { wantDir.y += (700 - agl) / 1400; wantDir.normalize(); }
            const fwd = ac.getForward(_f);
            const off = Math.acos(clamp(fwd.dot(wantDir), -1, 1));
            const boresightOff = Math.acos(clamp(fwd.dot(_a.copy(rel).normalize()), -1, 1));

            // energy management
            throttle = ac.speed < 190 ? 1 : dist > 1500 ? 1 : 0.88;
            const closing = -_a.subVectors(t.vel, ac.vel).dot(rel.clone().normalize());
            ac.airbrake = sk > 0.5 && dist < 500 && closing > 60 && boresightOff < 0.4;
            if (ac.airbrake) throttle = 0.4;

            // guns
            const gunCone = lerp(0.05, 0.022, sk);
            if (off < gunCone && dist < lerp(700, 1100, sk)) {
                wantGuns = true;
            }
            // missiles
            const maxPerTarget = t.isPlayer ? Math.max(1, Math.round(1 + g.difficulty.enemyMissileRate * 1.5)) : 3;
            if (ac.missiles > 0 && !t.isChute && boresightOff < 0.45 && dist > 500 && dist < WEAPONS.missile.range) {
                this.lockT += dt;
                t.lockedBy = t.lockedBy || new Set();
                t.lockedBy.add(ac);
                const need = WEAPONS.missile.lockTime * lerp(2.2, 1.1, sk);
                if (this.lockT > need && this.missileCD <= 0 && t.incoming.length < maxPerTarget) {
                    const rate = ac.team === 'red' ? g.difficulty.enemyMissileRate : 0.8;
                    if (Math.random() < rate) {
                        g.weapons.fireMissile(ac, t);
                        ac.missiles--;
                    }
                    this.missileCD = rand(6, 12) / Math.max(rate, 0.3);
                    this.lockT = 0;
                }
            } else {
                this.lockT = Math.max(0, this.lockT - dt * 2);
                if (t.lockedBy) t.lockedBy.delete(ac);
            }
            // avoid ramming
            if (dist < 90 && closing > 0) {
                wantDir = _t.copy(fwd).addScaledVector(_u.set(0, 1, 0).applyQuaternion(ac.qv), 1.5).normalize();
                wantGuns = false;
            }
        } else {
            // patrol: orbit the anchor
            const anchor = this.home || g.player?.pos || _p.set(0, 1500, 0);
            _p.copy(anchor);
            const rel = _d.subVectors(ac.pos, _p).setY(0);
            const tang = _a.set(-rel.z, 0, rel.x).normalize();
            wantDir = _t.copy(tang).addScaledVector(rel.normalize(), -0.4);
            wantDir.y = clamp((1600 - ac.pos.y) / 2000, -0.3, 0.3);
            wantDir.normalize();
            throttle = 0.7;
        }

        // stay near the fight
        if (!this.leash && g.player && ac.pos.distanceTo(g.player.pos) > 14000) {
            wantDir = _t.subVectors(g.player.pos, ac.pos).normalize();
        }

        steerToward(ac, wantDir, c, aggr);
        c.throttle = throttle;
        // skill-limited G tolerance
        c.pitch *= lerp(0.7, 1, sk);

        // avoid other aircraft (mid-air collisions)
        for (const o of g.aircraft) {
            if (o === ac || !o.alive) continue;
            const d = o.pos.distanceToSquared(ac.pos);
            if (d < 70 * 70) {
                _d.subVectors(ac.pos, o.pos).normalize();
                steerToward(ac, _d.add(ac.getForward(_f)).normalize(), c, 1);
            }
        }

        const minAGL = lerp(260, 120, sk);
        if (avoidTerrain(ac, c, minAGL)) wantGuns = false;

        if (wantGuns) {
            this.burstT -= dt;
            if (this.burstT > -0.6) g.weapons.fireGun(ac, g.time);
            if (this.burstT < -0.6 - (1 - sk)) this.burstT = rand(0.4, 1.2);
        }
    }
}

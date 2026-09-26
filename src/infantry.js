// ═══════════════════════════════════════════════════════════════
// Infantry: soldiers who guard and patrol sites and fight with the arsenal's weapons (arsenal.js).
//   • they see an enemy inside their view cone (wider once alert) when terrain, buildings and big vehicles
//     don't block the line of sight, after a moment that's shorter close up, for a moving or shooting target;
//     they hear gunfire and explosions, and bullets snapping past
//   • the squad is told; they move to cover (behind buildings, hangars, vehicles, the lie of the land) and
//     kneel there, shoot in bursts with aim that gets worse with range, movement and incoming fire and better
//     with difficulty; they reload, now and then lob a grenade, and run from one that lands by them
//   • they also shoot at enemy aircraft that come low and slow (and at helicopters)
//   • they die with a fall (flung by a blast), drop their weapon (its ammunition can be picked up), and lie there
//   • friendly soldiers stand guard at the player's base and never shoot the player
// API (docs/WAR.md unit interface: pos, team, alive, name, radius, hitRadius, damage(), cls 'infantry'):
//   game.infantry.spawnSquad({ team, pos, n, kind: 'guard' | 'patrol', route, weapon, facing, spread, name })
// Brains run without meshes (tests/infantry.test.mjs). Bodies: pooled animated characters for the nearest
// FULL soldiers, instanced low-poly figures further out, nothing beyond FIG_RANGE; soldiers far from the camera
// and the player aren't simulated in detail (patrols just walk their routes).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { Gun, weaponDef, damageAt, blastDamage, aimSigma, gauss, solveThrow, spreadFor, BODY, friendlyFactor } from './arsenal.js';
import { Character } from './character.js';
import { personHitTest, segPointDist2 } from './pilot.js';
import { terrainHeight } from './world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const INF = {
    FULL: 18,            // animated characters at most (the nearest soldiers)
    FULL_RANGE: 170,     // … within this of the camera (m)
    FIG_RANGE: 1100,     // instanced figures out to here
    AI_RANGE: 1600,      // full brains within this of the camera or the player; coarse beyond
    THINK: 0.2,          // s between decisions (staggered)
    CELL: 32,            // spatial grid
    SIGHT_IDLE: 170, SIGHT_ALERT: 380, FOV_IDLE: 1.05, FOV_ALERT: 1.5, // m, rad (half-angles)
    NIGHT: 0.45,         // sight at night
    AA_RANGE: 650, AA_ALT: 380, AA_SPEED: 140, // shooting at aircraft: this close, this low, this slow
};
const SPEED = { walk: 1.55, jog: 3.3, run: 5.2, crouch: 1.2 };

// Garrisons, in base-local metres (airbase.js / ground.js standard layout: x across the runway toward the apron,
// z along it; the gate at (570, -300)). at: the squad's post, look: where it faces, route: a patrol's beat.
export const GARRISONS = {
    enemy: [
        { at: [592, -312], n: 2, look: [800, -300], weapon: 'ak47', name: 'GATE GUARD' },
        { at: [545, -275], n: 2, look: [570, -300] },
        { at: [540, -420], n: 2, route: [[540, -420], [540, -1000], [540, -1500], [540, -1000]] },
        { at: [360, 200], n: 3, route: [[362, 185], [362, 395], [305, 395], [305, 185]] },
        { at: [432, 168], n: 4, look: [600, 200] },
        { at: [442, -330], n: 3, look: [620, -360] },
        { at: [-680, 622], n: 2, look: [-900, 700] },
        { at: [342, 20], n: 3, route: [[345, -90], [345, 130]] },
        { at: [500, 442], n: 2, look: [650, 470] },
        // the SAM sites on their ring (ground.js spawnEnemyBase)
        ...[0, 1, 2, 3].map(i => { const a = (i / 4) * Math.PI * 2 + 0.4; return { at: [Math.cos(a) * 1300 + 18, Math.sin(a) * 1300 * 1.2 + 6], n: 3, look: [Math.cos(a) * 2600, Math.sin(a) * 2600 * 1.2] }; }),
    ],
    home: [
        { at: [592, -312], n: 2, look: [800, -300], weapon: 'm4a1', name: 'GATE GUARD' },
        { at: [255, -188], n: 2, look: [100, -150], weapon: 'm4a1' },
        { at: [362, 195], n: 2, route: [[362, 190], [362, 395]], weapon: 'm4a1' },
        { at: [690, -178], n: 2, look: [600, -180], weapon: 'm4a1' },
    ],
};
const TEAM_LOOK = {
    red: { body: 0x5b5a3a, gear: 0x2e2618 },   // olive-drab uniform, brown webbing
    blue: { body: 0x3e4a36, gear: 0x191b1c },  // woodland green, black gear
};
const HELMET_Y = 1.62;

// ═══════════════════════════════════════════════════════════════
// Line of sight: terrain (a cached height grid), buildings, and the bulk of ground targets
// ═══════════════════════════════════════════════════════════════
// the bulk of a ground target for sight lines and cover: [radius, height of its centre] (m)
const BULK = { hangar: [17, 9], bunker: [13, 5], fuel: [7, 3.5], radar: [3.5, 2], tank: [2.7, 1.3], spaag: [2.7, 1.3], msam: [2.4, 1.4], truck: [2.2, 1.4], fueltruck: [2.2, 1.4], humvee: [1.8, 1], parked: [2.4, 1.5], sam: [2.6, 1.3], aaa: [2.4, 1.3] };

export class HeightCache {
    constructor(fn, cell = 4, tile = 32) { this.fn = fn; this.cell = cell; this.tile = tile; this.tiles = new Map(); }
    tileAt(tx, tz) {
        const k = tx * 100003 + tz;
        let t = this.tiles.get(k);
        if (!t) {
            const n = this.tile + 1, a = new Float32Array(n * n), s = this.cell * this.tile;
            for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = this.fn(tx * s + i * this.cell, tz * s + j * this.cell);
            t = a;
            this.tiles.set(k, t);
            if (this.tiles.size > 400) this.tiles.delete(this.tiles.keys().next().value);
        }
        return t;
    }
    h(x, z) {
        const c = this.cell, s = c * this.tile;
        const tx = Math.floor(x / s), tz = Math.floor(z / s);
        const a = this.tileAt(tx, tz), n = this.tile + 1;
        const fx = (x - tx * s) / c, fz = (z - tz * s) / c;
        const i = Math.min(this.tile - 1, Math.floor(fx)), j = Math.min(this.tile - 1, Math.floor(fz));
        const u = fx - i, v = fz - j;
        const h00 = a[j * n + i], h10 = a[j * n + i + 1], h01 = a[(j + 1) * n + i], h11 = a[(j + 1) * n + i + 1];
        return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
    }
    clear() { this.tiles.clear(); }
}

// ═══════════════════════════════════════════════════════════════
// A soldier
// ═══════════════════════════════════════════════════════════════
let SOLDIER_ID = 0;
export class Soldier {
    constructor(inf, o) {
        this.inf = inf;
        this.id = ++SOLDIER_ID;
        this.cls = 'infantry';
        this.team = o.team || 'red';
        this.name = o.name || (this.team === 'red' ? 'ENEMY SOLDIER' : 'SOLDIER');
        this.isGround = true;
        this.radius = 0.5; this.hitRadius = 1;
        this.alive = true;
        this.hp = this.maxHp = o.hp || 100;
        this.health = this.hp; this.maxHealth = this.hp;
        this.pos = new THREE.Vector3().copy(o.pos);
        this.vel = new THREE.Vector3();
        this.yaw = o.facing ?? rand(0, Math.PI * 2);     // body
        this.lookYaw = this.yaw;                           // head / aim yaw
        this.aimPitch = 0;
        this.post = this.pos.clone(); this.postYaw = this.yaw;
        this.kind = o.kind || 'guard';
        this.route = o.route || null; this.routeI = 0; this.waitT = rand(0, 3);
        this.squad = o.squad || null;
        this.weaponId = o.weapon || 'ak47';
        this.gun = new Gun(this.weaponId, { reserve: weaponDef(this.weaponId).type === 'launcher' ? 3 : weaponDef(this.weaponId).mag * 5 });
        this.grenades = o.grenades ?? (Math.random() < 0.6 ? 1 : 2);
        this.skill = clamp((o.skill ?? 0.6) + rand(-0.1, 0.1), 0.1, 1);
        this.state = this.route ? 'patrol' : 'idle';
        this.target = null; this.targetPos = new THREE.Vector3(); this.hasTargetPos = false;
        this.seeT = 0; this.lastSeenT = -99; this.alertT = -99; this.acquiredT = -99; this.visible = false;
        this.investigate = null;
        this.moveTo = null; this.moveSpeed = 0; this.mode = null; // 'cover' | 'flee' | 'search' | null
        this.coverPos = null; this.inCover = false;
        this.stance = 'stand'; this.crouchK = 0;
        this.burstLeft = 0; this.burstPause = rand(0.3, 1); this.trigger = false;
        this.suppress = 0;
        this.throwT = -1; this.lastGrenadeT = -99; this.throwTarget = new THREE.Vector3();
        this.fleeFrom = null; this.fleeT = 0;
        this.thinkT = rand(0, INF.THINK);
        this.hitAnimT = 0;
        this.deadT = 0; this.body = null; this.fling = null;
        this.coarse = false;
        this.aiming = false;
    }

    get game() { return this.inf.game; }
    eye(out) { return out.set(this.pos.x, this.pos.y + (this.stance === 'crouch' ? 1.1 : 1.6), this.pos.z); }
    chest(out) { return out.set(this.pos.x, this.pos.y + (this.stance === 'crouch' ? 0.85 : 1.25), this.pos.z); }

    // ── taking damage (the war layer's unit interface) ──
    damage(amount, source = null, kind = 'gun', from = null) {
        if (!this.alive || amount <= 0) return;
        this.hp -= amount; this.health = this.hp;
        const g = this.game;
        if (this.hp <= 0) { this.die(source, kind, from); return; }
        this.hitAnimT = 0.35;
        this.suppress = Math.min(1, this.suppress + 0.5);
        // who shot me? the squad hears about it, and cover looks good now
        const src = source && source.pos ? source : null;
        if (src && src.team !== this.team) {
            const p = from || src.pos;
            this.hear(src, p, this.pos.distanceTo(p), true);
            if (!this.inCover) this.wantCover = true;
        }
        void g;
    }

    die(source, kind, from) {
        if (!this.alive) return;
        const g = this.game;
        this.alive = false; this.hp = this.health = 0;
        this.state = 'dead'; this.deadT = 0;
        this.moveTo = null; this.trigger = false; this.burstLeft = 0;
        this.gun.cancelReload();
        // flung by a blast, or knocked back by the round
        const away = from ? _v.subVectors(this.pos, from).setY(0) : _v.set(rand(-1, 1), 0, rand(-1, 1));
        if (away.lengthSq() < 1e-6) away.set(1, 0, 0);
        away.normalize();
        if (kind === 'blast' || kind === 'rocket' || kind === 'grenade' || kind === 'bomb' || kind === 'missile') {
            const k = from ? clamp(1 - this.pos.distanceTo(from) / 12, 0.2, 1) : 0.6;
            this.fling = { vel: away.clone().multiplyScalar(rand(4, 9) * k).setY(rand(3, 7) * k), spin: rand(-6, 6), t: 0 };
        } else this.fling = { vel: away.clone().multiplyScalar(rand(0.5, 1.4)), spin: 0, t: 0, soft: true };
        this.deathYaw = Math.atan2(-away.x, -away.z) + Math.PI; // falls away from what hit him
        // the weapon falls out of his hands
        if (g.ordnance) g.ordnance.dropWeapon(this.body ? this.body.ch : this.pos, this.weaponId, this.gun.mag + Math.min(this.gun.reserve, this.gun.def.mag * 2));
        if (this.body) { this.body.ch.setWeapon(null); this.body.ch.setPose(null); this.body.ch.setCrouch(0); this.body.ch.play('Death', 0.1); }
        if (this.squad) this.squad.lost(this, source);
        this.inf.onKilled(this, source, kind);
    }

    // heard something (a shot, a blast) from `p`: turn to it, and if it's an enemy, go after it
    hear(src, p, d, hostile = true) {
        if (!this.alive) return;
        const now = this.game.time;
        if (hostile) {
            // a rough fix: the further, the vaguer
            const err = Math.min(d * 0.12, 25);
            this.targetPos.set(p.x + rand(-err, err), p.y, p.z + rand(-err, err)); this.hasTargetPos = true;
            if (src && src.alive !== false && src.team && src.team !== this.team) { this.target = this.target || src; this.seeT = Math.max(this.seeT, 0.45); }
        }
        this.alertT = now;
        if (this.state === 'idle' || this.state === 'patrol') {
            this.state = 'alert';
            this.lookYaw = Math.atan2(-(p.x - this.pos.x), -(p.z - this.pos.z));
            this.reactT = rand(0.2, 0.7) * (1.3 - this.skill);
        }
    }

    // ── the brain: decisions a few times a second ──
    think(dt) {
        const g = this.game, inf = this.inf, now = g.time;
        // look for enemies
        const seen = this.scan(dt);
        if (seen) {
            if (!this.visible || this.target !== seen) { this.acquiredT = now; }
            this.target = seen; this.visible = true; this.lastSeenT = now;
            inf.aimPoint(seen, this.targetPos); this.hasTargetPos = true;
            if (this.state !== 'combat') { this.state = 'combat'; this.alertT = now; if (this.squad) this.squad.alert(this, seen, this.targetPos); g.audio.soldierCall && g.audio.soldierCall(this); }
        } else this.visible = false;
        if (this.state === 'combat' && !this.visible && now - this.lastSeenT > 3.5) {
            this.state = 'alert'; this.mode = this.hasTargetPos ? 'search' : null;
            if (this.mode === 'search') { this.moveTo = this.targetPos.clone(); this.moveSpeed = SPEED.jog; }
        }
        if (this.state === 'alert' && now - this.alertT > 30 && !this.visible) this.stand();
        if (this.target && (this.target.alive === false || this.target.dead)) { this.target = null; this.visible = false; if (this.state === 'combat') { this.state = 'alert'; this.alertT = now; } }
        // grenades landing close by: run
        if (this.fleeT > 0) return;
        // cover: when shot at, suppressed, or reloading in the open
        const threat = this.hasTargetPos ? this.targetPos : null;
        if (threat && (this.state === 'combat' || this.state === 'alert') && !this.inCover && this.mode !== 'cover'
            && (this.wantCover || this.suppress > 0.3 || this.gun.reloading || (this.state === 'combat' && Math.random() < 0.25))) {
            const c = inf.findCover(this, threat);
            this.wantCover = false;
            if (c) { this.coverPos = c; this.moveTo = c.clone(); this.moveSpeed = SPEED.run; this.mode = 'cover'; }
        }
        // leave cover that no longer hides me (the enemy moved), or that I reached
        if (this.inCover && threat && inf.losClear(_v.copy(threat).setY(threat.y + 0.3), _v2.set(this.pos.x, this.pos.y + 1.0, this.pos.z))) { this.inCover = false; this.wantCover = true; }
        // under fire, don't bunch up: step away from a squad mate standing right by me (once per alarm)
        if (!this.spread && threat && (this.state === 'combat' || this.state === 'alert') && !this.moveTo && !this.inCover && this.squad) {
            const mate = this.squad.members.find(m => m !== this && m.alive && m.pos.distanceToSquared(this.pos) < 16);
            if (mate) {
                const away = _v.subVectors(this.pos, mate.pos).setY(0);
                if (away.lengthSq() < 1e-4) away.set(rand(-1, 1), 0, rand(-1, 1));
                this.moveTo = this.pos.clone().addScaledVector(away.normalize(), rand(4, 7)); this.moveSpeed = SPEED.jog;
            }
            this.spread = true;
        }
        // a grenade for an enemy who's hiding (or sitting still) close enough
        if (this.state === 'combat' && this.grenades > 0 && this.throwT < 0 && now - this.lastGrenadeT > 14 && threat) {
            const d = this.pos.distanceTo(threat);
            const hiding = !this.visible && now - this.lastSeenT < 8;
            if (d > 9 && d < 32 && (hiding ? Math.random() < 0.35 : Math.random() < 0.05)) this.startThrow(threat);
        }
        // reload when dry (or topping up in cover)
        if (!this.gun.reloading && this.gun.reserve > 0 && (this.gun.mag === 0 || (this.inCover && !this.visible && this.gun.mag < this.gun.def.mag * 0.4))) this.gun.startReload();
        // idle / patrol / alert movement
        if (this.state === 'patrol' && !this.moveTo && this.route) {
            this.waitT -= INF.THINK;
            if (this.waitT <= 0) { this.routeI = (this.routeI + 1) % this.route.length; this.moveTo = this.route[this.routeI].clone(); this.moveSpeed = SPEED.walk; this.waitT = rand(2, 5); }
        }
        if (this.state === 'idle' && !this.moveTo && this.pos.distanceTo(this.post) > 2) { this.moveTo = this.post.clone(); this.moveSpeed = SPEED.walk; }
        if (this.state === 'idle' && Math.random() < 0.04) this.lookYaw = this.postYaw + rand(-0.8, 0.8);
        if (this.state === 'alert' && !this.moveTo && !this.inCover && this.hasTargetPos && Math.random() < 0.3) {
            // edge toward where it came from, carefully
            const d = _v.subVectors(this.targetPos, this.pos).setY(0);
            if (d.length() > 25) { this.moveTo = this.pos.clone().addScaledVector(d.normalize(), 12); this.moveSpeed = SPEED.jog; }
        }
    }

    stand() {
        this.state = this.route ? 'patrol' : 'idle';
        this.spread = false;
        this.target = null; this.visible = false; this.hasTargetPos = false; this.mode = null; this.inCover = false; this.coverPos = null;
        this.stance = 'stand';
        this.moveTo = null;
    }

    // which enemy can I see (and have I looked long enough to be sure)?
    scan(dt) {
        const inf = this.inf, g = this.game, now = g.time;
        const alert = this.state !== 'idle' && this.state !== 'patrol';
        const night = inf.night ? INF.NIGHT : 1;
        const range = (alert ? INF.SIGHT_ALERT : INF.SIGHT_IDLE) * night;
        const fov = alert ? INF.FOV_ALERT : INF.FOV_IDLE;
        const eye = this.eye(_v4);
        let best = null, bestScore = -1;
        for (const t of inf.enemiesOf(this, range)) {
            const tp = inf.aimPoint(t, _v3);
            const dx = tp.x - eye.x, dz = tp.z - eye.z, dist = Math.hypot(dx, tp.y - eye.y, dz);
            if (dist > (t.isAircraft ? INF.AA_RANGE : range)) continue;
            const ang = Math.abs(wrap(Math.atan2(-dx, -dz) - this.lookYaw));
            if (dist > 6 && ang > fov && !(t.isAircraft && dist < 400)) continue; // (you hear a jet overhead)
            if (!inf.losClear(eye, tp, t)) continue;
            // noticing takes a moment: quicker close up, for a moving or shooting target, when alert
            const moving = inf.speedOf(t) > 1.5, shooting = t.lastShotT != null && now - t.lastShotT < 1.2;
            let rate = (alert ? 2.2 : 1.1) * clamp(60 / Math.max(dist, 10), 0.35, 4) * (moving ? 1.6 : 1) * (shooting ? 3 : 1) * night;
            if (t.isAircraft) rate = 3;
            const score = 1000 / dist + (t === this.target ? 50 : 0);
            if (score > bestScore) { bestScore = score; best = t; best._rate = rate; }
        }
        if (best) {
            this.seeT = Math.min(1.5, this.seeT + dt * best._rate);
            if (this.seeT >= 1) return best;
            // turn toward what caught the eye
            if (this.seeT > 0.3) this.lookYaw += wrap(Math.atan2(-(inf.aimPoint(best, _v3).x - this.pos.x), -(_v3.z - this.pos.z)) - this.lookYaw) * 0.3;
            return null;
        }
        this.seeT = Math.max(0, this.seeT - dt * 0.35);
        return null;
    }

    startThrow(at) {
        this.throwT = 0;
        this.throwTarget.copy(at);
        this.grenades--;
        this.lastGrenadeT = this.game.time;
        this.trigger = false; this.burstLeft = 0;
    }

    // ── every frame: move, turn, aim, shoot ──
    act(dt) {
        const g = this.game, inf = this.inf, now = g.time;
        this.suppress = Math.max(0, this.suppress - dt * 0.35);
        this.hitAnimT = Math.max(0, this.hitAnimT - dt);
        this.fleeT = Math.max(0, this.fleeT - dt);
        // fleeing a grenade
        if (this.fleeT > 0 && this.fleeFrom) {
            const away = _v.subVectors(this.pos, this.fleeFrom).setY(0);
            if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
            this.moveTo = _v2.copy(this.pos).addScaledVector(away.normalize(), 6).clone();
            this.moveSpeed = SPEED.run; this.inCover = false; this.stance = 'stand';
        }
        // walking / running
        let moving = false;
        if (this.moveTo) {
            const d = _v.subVectors(this.moveTo, this.pos).setY(0), L = d.length();
            if (L < 0.6) {
                this.moveTo = null;
                if (this.mode === 'cover') { this.inCover = true; this.mode = null; }
                else if (this.mode === 'search') { this.mode = null; }
            } else {
                d.divideScalar(L);
                const sp = this.moveSpeed * (this.stance === 'crouch' ? 0.6 : 1) * (this.hitAnimT > 0 ? 0.5 : 1);
                if (inf.step(this, d, sp * dt)) moving = true;
                else { this.moveTo = null; if (this.mode === 'cover') this.mode = null; }
                // run facing where you go; walk-and-aim facing the enemy
                const dir = Math.atan2(-d.x, -d.z);
                if (!(this.state === 'combat' && this.visible && this.moveSpeed < SPEED.run)) this.yaw += wrap(dir - this.yaw) * Math.min(1, dt * 7);
            }
        }
        this.moving = moving;
        this.vel.set(0, 0, 0);
        if (moving) this.vel.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(this.moveSpeed);
        // stance: kneel in cover (and while reloading behind it); stand to run
        this.stance = this.inCover && !moving ? 'crouch' : 'stand';
        this.crouchK += ((this.stance === 'crouch' ? 1 : 0) - this.crouchK) * Math.min(1, dt * 6);
        // aim
        const combat = this.state === 'combat' && this.target && this.visible;
        this.aiming = combat || this.state === 'alert';
        if (combat) {
            const tp = inf.leadPoint(this, this.target, _v3);
            const eye = this.eye(_v4);
            const want = Math.atan2(-(tp.x - eye.x), -(tp.z - eye.z));
            const pitch = Math.atan2(tp.y - eye.y, Math.hypot(tp.x - eye.x, tp.z - eye.z));
            const k = Math.min(1, dt * (4 + this.skill * 6));
            this.lookYaw += wrap(want - this.lookYaw) * k;
            this.aimPitch += (pitch - this.aimPitch) * k;
            if (!moving || this.moveSpeed < SPEED.run) this.yaw += wrap(this.lookYaw - this.yaw) * Math.min(1, dt * 8);
        } else {
            if (!moving) this.yaw += wrap(this.lookYaw - this.yaw) * Math.min(1, dt * 3);
            else this.lookYaw = this.yaw;
            this.aimPitch *= Math.exp(-3 * dt);
        }
        // grenade: wind up, throw at 0.45 s
        if (this.throwT >= 0) {
            this.throwT += dt;
            if (this.throwT >= 0.45 && !this.threw) {
                this.threw = true;
                const from = _v.set(this.pos.x, this.pos.y + 1.75, this.pos.z);
                // a lob that lands near the target (worse with less skill)
                const err = (1 - this.skill) * 5 + 1;
                const to = _v2.copy(this.throwTarget).add(_v5.set(rand(-err, err), 0, rand(-err, err)));
                to.y = g.surfaceAt(to.x, to.z, to.y + 5).h;
                const sol = solveThrow(from, to, 15, from.distanceTo(to) > 22) || solveThrow(from, to, 19) || { x: to.x - from.x, y: 6, z: to.z - from.z };
                g.ordnance && g.ordnance.throwGrenade(this, { origin: from.clone(), vel: new THREE.Vector3(sol.x, sol.y, sol.z), team: this.team, fuse: rand(3, 3.6) });
                g.audio.soldierCall && g.audio.soldierCall(this, 'grenade');
            }
            if (this.throwT > 0.9) { this.throwT = -1; this.threw = false; }
            this.gun.update(dt, false);
            return;
        }
        // shoot: bursts (a fresh pull per shot for the semi-automatics), after a reaction time on a new target
        let trigger = false;
        if (combat && now - this.acquiredT > (0.25 + (1 - this.skill) * 0.7) && Math.abs(wrap(this.lookYaw - this.yaw)) < 0.6 && this.fleeT <= 0 && this.hitAnimT <= 0.1) {
            const dist = this.pos.distanceTo(this.targetPos);
            const def = this.gun.def;
            const maxR = def.type === 'pistol' ? 90 : def.type === 'shotgun' ? 45 : def.type === 'launcher' ? 380 : 450;
            if (dist < maxR) {
                if (this.burstLeft <= 0) {
                    this.burstPause -= dt;
                    if (this.burstPause <= 0) {
                        // a rocket is kept for vehicles, aircraft, men bunched up or dug in (decided now, not every frame)
                        if (def.type === 'launcher' && !inf.rocketWorthy(this, this.target, dist)) this.burstPause = rand(1.2, 2.5);
                        else {
                            this.burstLeft = def.fire === 'auto' ? Math.round(rand(3, 7) - this.skill * 1.5) : def.fire === 'semi' ? Math.round(rand(1, 3)) : 1;
                            this.burstPause = rand(0.45, 1.3) * (def.fire === 'semi' ? 0.7 : 1) + dist / 400;
                            this.semiT = 0;
                            if (def.type === 'launcher') this.rocketT = now;
                        }
                    }
                }
                if (this.burstLeft > 0) {
                    if (def.fire === 'auto') trigger = true;
                    else { this.semiT = (this.semiT || 0) - dt; if (this.semiT <= 0) { trigger = true; this.semiT = rand(0.18, 0.35); } }
                }
            }
        } else this.burstLeft = 0;
        const n = this.gun.update(dt, trigger);
        for (let i = 0; i < n; i++) { this.fire(); this.burstLeft--; }
        if (this.burstLeft <= 0 && this.gun.def.fire === 'auto') this.gun.held = false;
        if (this.gun.dry && this.gun.reserve > 0) this.gun.startReload();
    }

    fire() {
        const g = this.game, inf = this.inf, def = this.gun.def;
        const muzzle = inf.muzzleOf(this, _v);
        const tp = inf.leadPoint(this, this.target, _v2);
        const dir = _v3.subVectors(tp, muzzle).normalize();
        // aim error: skill, range (it's an angle), the target's motion, my own, settling on a new target, being shot at
        const sig = aimSigma({
            skill: this.skill, targetSpeed: inf.speedOf(this.target), moving: this.moving, suppressed: this.suppress,
            settle: clamp(1 - (g.time - this.acquiredT) / (0.8 + (1 - this.skill)), 0, 1),
        });
        const right = _v4.set(-dir.z, 0, dir.x).normalize(), up = _v5.crossVectors(right, dir);
        dir.addScaledVector(right, gauss() * sig).addScaledVector(up, gauss() * sig).normalize();
        // the weapon's own spread: aimed when standing, from the hip on the move; a good shot holds a burst down better
        const ads = this.moving ? 0.3 : 1;
        const spread = spreadFor(def, null, { ads, walk: this.moving ? 1 : 0 }) + this.gun.heat * (1 - ads * 0.5) * (1.3 - this.skill);
        this.lastShotT = g.time;
        if (def.projectile === 'rocket') g.ordnance && g.ordnance.launchRocket(this, { origin: muzzle.clone(), dir: dir.clone(), team: this.team, backblast: true });
        else if (g.ordnance) g.ordnance.fireGun(this, def, { origin: muzzle, dir, muzzle, spread, team: this.team, tracer: def.tracer && this.gun.mag % def.tracer === 0 });
    }

    // far from everything: patrols keep walking their routes, nobody thinks
    coarseUpdate(dt) {
        if (!this.route || !this.alive) return;
        const t = this.route[this.routeI];
        const d = _v.subVectors(t, this.pos).setY(0), L = d.length();
        if (L < 1) { this.routeI = (this.routeI + 1) % this.route.length; return; }
        this.pos.addScaledVector(d.divideScalar(L), Math.min(L, SPEED.walk * dt));
        this.yaw = Math.atan2(-d.x, -d.z);
        this.pos.y = this.inf.groundY(this.pos.x, this.pos.z);
    }
}

// ═══════════════════════════════════════════════════════════════
// A squad: soldiers who share what they know
// ═══════════════════════════════════════════════════════════════
export class Squad {
    constructor(inf, o) {
        this.inf = inf; this.team = o.team || 'red'; this.kind = o.kind || 'guard'; this.name = o.name || '';
        this.members = [];
        this.alertT = -99;
    }
    get alive() { return this.members.some(m => m.alive); }
    // one of us has spotted `target` at p: everyone turns to it, those who can see it will engage
    alert(from, target, p) {
        const now = this.inf.game.time;
        this.alertT = now;
        for (const m of this.members) {
            if (!m.alive || m === from) continue;
            m.targetPos.copy(p); m.hasTargetPos = true;
            if (!m.target) m.target = target;
            m.seeT = Math.max(m.seeT, 0.7);
            m.alertT = now;
            if (m.state === 'idle' || m.state === 'patrol') { m.state = 'alert'; m.lookYaw = Math.atan2(-(p.x - m.pos.x), -(p.z - m.pos.z)); m.moveTo = null; }
        }
    }
    lost(m, source) {
        // a man down: the rest know where it came from
        if (source && source.pos && source.team !== this.team) for (const o of this.members) if (o.alive && o !== m) o.hear(source, source.pos, o.pos.distanceTo(source.pos), true);
    }
}

// ═══════════════════════════════════════════════════════════════
// The system
// ═══════════════════════════════════════════════════════════════
export class Infantry {
    constructor(game) {
        this.game = game;
        this.soldiers = [];
        this.squads = [];
        this.grid = new Map();
        this.heights = new HeightCache((x, z) => (game.surfaceAt ? game.surfaceAt(x, z, 1e9).h : Math.max(terrainHeight(x, z), 0)));
        this.pool = [];            // animated bodies: { ch, soldier }
        this.frame = 0;
        this.night = false;
        this.playerVel = new THREE.Vector3(); this.playerLast = null;
        this.stats = { full: 0, figures: 0, thinking: 0, coarse: 0 };
        this.render = true;        // headless tests turn bodies off
        this.figures = null;
        this.onKilledHooks = [];
    }

    // ── spawning ──
    // { team, pos, n, kind: 'guard' | 'patrol', route: [Vector3...], weapon (id | 'mixed'), facing, spread, name, skill }
    spawnSquad(o) {
        const g = this.game, sq = new Squad(this, o);
        const n = o.n || 4, spread = o.spread ?? 3;
        const skill = o.skill ?? (g.difficulty ? g.difficulty.skill : 0.6);
        const base = o.pos.clone ? o.pos : new THREE.Vector3(o.pos.x, o.pos.y || 0, o.pos.z);
        const route = o.route ? o.route.map(p => { const v = p.clone ? p.clone() : new THREE.Vector3(p.x, 0, p.z); v.y = this.groundY(v.x, v.z); return v; }) : null;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3), r = i === 0 ? 0 : spread * rand(0.6, 1.2);
            const p = new THREE.Vector3(base.x + Math.cos(a) * r, 0, base.z + Math.sin(a) * r);
            p.y = this.groundY(p.x, p.z);
            let weapon = o.weapon || (o.team === 'blue' ? 'm4a1' : 'ak47');
            if (weapon === 'mixed') weapon = i === 1 && n >= 3 ? 'rpg7' : i === 3 && n >= 4 ? (o.team === 'blue' ? 'm870' : 'm870') : (o.team === 'blue' ? 'm4a1' : 'ak47');
            const s = new Soldier(this, { team: o.team, pos: p, kind: o.kind, route: route ? route.map((q, k) => route[(k + i) % route.length]) : null, weapon, facing: (o.facing ?? rand(0, 6.28)) + rand(-0.4, 0.4), squad: sq, skill, name: o.name });
            if (route) s.routeI = i % route.length;
            sq.members.push(s);
            this.soldiers.push(s);
        }
        this.squads.push(sq);
        return sq;
    }

    groundY(x, z) { const g = this.game; return g.surfaceAt ? g.surfaceAt(x, z, 1e9).h : Math.max(terrainHeight(x, z), 0); }

    get count() { return this.soldiers.filter(s => s.alive).length; }

    // ── the grid ──
    index() {
        const G = this.grid, C = INF.CELL;
        for (const l of G.values()) l.length = 0;
        for (const s of this.soldiers) {
            const k = Math.floor(s.pos.x / C) * 100003 + Math.floor(s.pos.z / C);
            let l = G.get(k);
            if (!l) G.set(k, l = []);
            l.push(s);
        }
    }
    forEachNear(p, r, fn) {
        const C = INF.CELL, x0 = Math.floor((p.x - r) / C), x1 = Math.floor((p.x + r) / C), z0 = Math.floor((p.z - r) / C), z1 = Math.floor((p.z + r) / C);
        const r2 = r * r;
        for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
            const l = this.grid.get(cx * 100003 + cz);
            if (l) for (const s of l) if (s.pos.distanceToSquared(p) <= r2 && fn(s) === true) return;
        }
    }

    // ── who's who ──
    // enemies of soldier s within r: soldiers of the other side, the player on foot (for the red side), and
    // aircraft of the other side low and slow enough to shoot at
    enemiesOf(s, r) {
        const out = this._enemies || (this._enemies = []);
        out.length = 0;
        this.forEachNear(s.pos, r, (o) => { if (o.alive && o.team !== s.team) out.push(o); });
        const pm = this.game.pilotMode;
        if (pm && pm.alive && pm.team !== s.team && pm.pos.distanceToSquared(s.pos) < r * r) {
            const agl = pm.pos.y - this.groundY(pm.pos.x, pm.pos.z);
            if (pm.walker || agl < 80) out.push(pm);
        }
        for (const a of this.game.aircraft || []) {
            if (!a.alive || a.team === s.team || a.team === 'neutral' || a.exploded) continue;
            const d2 = a.pos.distanceToSquared(s.pos);
            if (d2 > INF.AA_RANGE * INF.AA_RANGE) continue;
            if (a.speed > INF.AA_SPEED || a.pos.y - this.groundY(a.pos.x, a.pos.z) > INF.AA_ALT) continue;
            a.isAircraft = true;
            out.push(a);
        }
        return out;
    }

    // where to aim at a unit: chest height for people, the middle of an aircraft
    aimPoint(t, out) {
        if (t.cls === 'infantry' && t.chest) return t.chest(out);
        if (t.walker !== undefined && t.feet) { // the player
            if (t.walker) return t.feet(out).setY(out.y + 1.25);
            return out.copy(t.pos).setY(t.pos.y + 0.9);
        }
        return out.copy(t.pos);
    }
    speedOf(t) {
        if (!t) return 0;
        if (t === this.game.pilotMode) return this.playerVel.length();
        return t.vel ? Math.hypot(t.vel.x, t.vel.z) + Math.abs(t.vel.y) * 0.5 : 0;
    }
    // aim point led for the round's flight time
    leadPoint(s, t, out) {
        this.aimPoint(t, out);
        const v = t === this.game.pilotMode ? this.playerVel : t.vel;
        if (v) {
            const def = s.gun.def, speed = def.velocity || 250;
            const tt = out.distanceTo(s.pos) / speed;
            out.addScaledVector(v, tt * (0.6 + s.skill * 0.4));
        }
        return out;
    }
    // Is a rocket from soldier s worth it at t? Vehicles and sites, aircraft on the ground or hovering; men only
    // bunched up or dug in behind cover (the player: with friends by him, or standing still, now and then), and not
    // more often than every ten seconds or so.
    rocketWorthy(s, t, dist) {
        if (!t || dist < 25) return false;
        if (t.isAircraft) return t.onGround || t.speed < 40;
        const pm = this.game.pilotMode;
        if (t.cls !== 'infantry' && t !== pm) return dist < 300;
        if (dist > 220 || this.game.time < (s.rocketT ?? -99) + 10) return false;
        let near = 0;
        this.forEachNear(t.pos, 6, (o) => { if (o !== t && o.alive && o.team === t.team) near++; });
        if (t === pm) return near > 0 || (this.speedOf(t) < 1 && Math.random() < 0.35);
        return near > 0 || !!t.inCover;
    }

    muzzleOf(s, out) {
        if (s.body && s.body.ch.muzzlePos(out)) return out;
        return out.set(s.pos.x - Math.sin(s.lookYaw) * 0.55, s.pos.y + (s.stance === 'crouch' ? 1.0 : 1.45), s.pos.z - Math.cos(s.lookYaw) * 0.55);
    }

    // ── sight lines ──
    // clear from a to b? terrain, buildings, and the bulk of ground targets (and stationary vehicles) in between.
    // `target` (optional) doesn't block itself.
    losClear(a, b, target = null) {
        const g = this.game;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz);
        if (L < 1e-3) return true;
        // terrain (the drawn ground, cached)
        const n = Math.max(2, Math.ceil(L / 5));
        for (let k = 1; k < n; k++) {
            const t = k / n, x = a.x + dx * t, y = a.y + dy * t, z = a.z + dz * t;
            if (this.heights.h(x, z) > y - 0.15) return false;
        }
        // buildings (the town's and the airbases' solids)
        const bl = g.world && g.world.towns && g.world.towns.buildings;
        if (bl && Math.min(a.y, b.y) < bl.maxTop) {
            const m = Math.max(2, Math.ceil(L / 2));
            for (let k = 1; k < m; k++) {
                const t = k / m, y = a.y + dy * t;
                if (y > bl.maxTop) continue;
                const hb = bl.at(a.x + dx * t, y, a.z + dz * t);
                if (hb && hb !== target) return false;
            }
        }
        // hangars, bunkers, vehicles, wrecks
        if (g.ground) for (const t of g.ground.targets) {
            if (t === target || t.isShip || t.isBridge) continue;
            const B = BULK[t.type];
            if (!B) continue;
            const c = _v5.set(t.mesh ? t.mesh.position.x : t.pos.x, (t.mesh ? t.mesh.position.y : t.pos.y) + B[1], t.mesh ? t.mesh.position.z : t.pos.z);
            if (Math.abs(c.x - a.x) > L + B[0] && Math.abs(c.x - b.x) > L + B[0]) continue;
            if (segPointDist2(a, b, c) < B[0] * B[0] && c.distanceToSquared(b) > (B[0] + 0.5) ** 2 && c.distanceToSquared(a) > (B[0] + 0.5) ** 2) return false;
        }
        return true;
    }

    // Somewhere within ~25 m that hides me from `threat` (at kneeling height) and isn't too far off my post.
    // Candidates: around buildings, behind ground targets and wrecks, and a ring of points (dips and crests).
    findCover(s, threat) {
        const g = this.game, cands = this._cands || (this._cands = []);
        cands.length = 0;
        const p = s.pos, R = 25;
        const bl = g.world && g.world.towns && g.world.towns.buildings;
        if (bl) {
            const C = 64, seen = new Set();
            for (let cx = Math.floor((p.x - R) / C); cx <= Math.floor((p.x + R) / C); cx++) for (let cz = Math.floor((p.z - R) / C); cz <= Math.floor((p.z + R) / C); cz++) {
                const l = bl.grid.get(cx * 100003 + cz);
                if (l) for (const b of l) {
                    if (!b.alive || b.off || seen.has(b)) continue;
                    seen.add(b);
                    // the point behind it (away from the threat), just clear of the wall, and its two corners
                    const away = _v.set(b.x - threat.x, 0, b.z - threat.z).normalize();
                    const ext = Math.max(b.w, b.d) / 2 + 1.1;
                    for (const side of [0, -0.7, 0.7]) {
                        const q = new THREE.Vector3(b.x + away.x * ext - away.z * side * ext, 0, b.z + away.z * ext + away.x * side * ext);
                        if (q.distanceTo(p) < R) cands.push(q);
                    }
                }
            }
        }
        if (g.ground) for (const t of g.ground.targets) {
            const B = BULK[t.type];
            if (!B || t.route && t.alive) continue;
            const tp = t.mesh ? t.mesh.position : t.pos;
            if (tp.distanceTo(p) > R + B[0]) continue;
            const away = _v.set(tp.x - threat.x, 0, tp.z - threat.z).normalize();
            cands.push(new THREE.Vector3(tp.x + away.x * (B[0] + 1.0), 0, tp.z + away.z * (B[0] + 1.0)));
        }
        for (let k = 0; k < 8; k++) {
            const a = k / 8 * Math.PI * 2 + s.id, r = rand(6, 16);
            cands.push(new THREE.Vector3(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r));
        }
        let best = null, bestScore = Infinity;
        const eye = _v2.set(threat.x, threat.y + 0.2, threat.z);
        for (const q of cands) {
            q.y = this.groundY(q.x, q.z);
            if (bl && bl.blocks(q.x, q.z, q.y)) continue;
            const s2 = g.surfaceAt ? g.surfaceAt(q.x, q.z, q.y + 2) : null;
            if (s2 && s2.water) continue;
            // hidden from the threat when kneeling?
            if (this.losClear(eye, _v3.set(q.x, q.y + 1.0, q.z))) continue;
            // but not right on top of it, and not a long run
            const dThreat = q.distanceTo(threat);
            if (dThreat < 8) continue;
            const score = q.distanceTo(p) + (s.kind === 'guard' ? q.distanceTo(s.post) * 0.3 : 0) - Math.min(dThreat, 60) * 0.05;
            if (score < bestScore) { bestScore = score; best = q; }
        }
        return best ? best.clone() : null;
    }

    // walk soldier s along unit direction d by `len` (m), round buildings and water; false if stuck
    step(s, d, len) {
        const g = this.game, bl = g.world && g.world.towns && g.world.towns.buildings;
        const tryDir = (ang) => {
            const c = Math.cos(ang), sn = Math.sin(ang);
            const x = d.x * c - d.z * sn, z = d.x * sn + d.z * c;
            const nx = s.pos.x + x * len, nz = s.pos.z + z * len;
            if (bl && bl.blocks(nx, nz, s.pos.y, 0.45)) return false;
            const su = g.surfaceAt ? g.surfaceAt(nx, nz, s.pos.y + 1.5) : null;
            if (su && su.water) return false;
            s.pos.x = nx; s.pos.z = nz;
            s.pos.y = su ? su.h : this.groundY(nx, nz);
            return true;
        };
        if (tryDir(0)) return true;
        for (const a of [0.7, -0.7, 1.4, -1.4]) if (tryDir(a)) return true;
        return false;
    }

    // ── what the world tells them ──
    // a shot or blast at p heard `radius` m away (source: the shooter; team: whose it was)
    noise(p, radius, source, team, explosion = false) {
        if (!radius || !this.soldiers.length) return;
        this.forEachNear(p, radius, (s) => {
            if (!s.alive) return;
            const d = s.pos.distanceTo(p);
            const hostile = team && team !== s.team && team !== 'neutral';
            if (hostile) s.hear(source, source && source.pos && !explosion ? source.pos : p, d, true);
            else if (explosion || (s.state === 'idle' || s.state === 'patrol')) {
                // friends firing, or a blast: look that way, get ready
                s.alertT = this.game.time;
                if (s.state === 'idle' || s.state === 'patrol') { s.state = 'alert'; s.lookYaw = Math.atan2(-(p.x - s.pos.x), -(p.z - s.pos.z)); }
            }
            if (explosion && d < 25) s.suppress = Math.min(1, s.suppress + 0.6), s.wantCover = true;
        });
    }

    // a grenade came to rest (or bounced) at p: everyone near it runs
    grenadeWarning(p, team) {
        this.forEachNear(p, 9, (s) => {
            if (!s.alive) return;
            s.fleeFrom = p.clone(); s.fleeT = rand(2.2, 3.2) * (0.7 + s.skill * 0.5);
            if (s.team !== team) s.alertT = this.game.time;
            s.inCover = false; s.mode = null;
            this.game.audio.soldierCall && this.game.audio.soldierCall(s, 'grenadeWarn');
        });
    }

    // A round from prev to b.pos: does it hit a soldier (true: it stops there)? Rounds don't hurt their own
    // side's soldiers. Near misses suppress (and give away the shooter).
    bulletHit(b, prev) {
        if (!this.soldiers.length) return false;
        const p = b.pos;
        const C = INF.CELL;
        const x0 = Math.floor((Math.min(prev.x, p.x) - 3) / C), x1 = Math.floor((Math.max(prev.x, p.x) + 3) / C);
        const z0 = Math.floor((Math.min(prev.z, p.z) - 3) / C), z1 = Math.floor((Math.max(prev.z, p.z) + 3) / C);
        if ((x1 - x0 + 1) * (z1 - z0 + 1) > 36) return false; // (a very long step: not a small-arms round near people)
        let hit = null, zone = null, bt = 2;
        for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
            const l = this.grid.get(cx * 100003 + cz);
            if (!l) continue;
            for (const s of l) {
                if (!s.alive || friendlyFactor(b.team, s.team, 'gun') === 0) continue; // (rounds pass their own side)
                if (Math.abs(s.pos.y + 1 - p.y) > 20 && Math.abs(s.pos.y + 1 - prev.y) > 20) continue;
                const z = personHitTest(prev, p, s.pos, s.stance);
                if (z) {
                    const t = this.closestT(prev, p, s.pos);
                    if (t < bt) { bt = t; hit = s; zone = z; }
                    continue;
                }
                // a near miss: snaps past, and gives the shooter away
                if (!b.warned && segPointDist2(prev, p, _v.set(s.pos.x, s.pos.y + 1.3, s.pos.z)) < 6) {
                    s.suppress = Math.min(1, s.suppress + 0.3);
                    if (b.owner && b.owner.team && b.owner.team !== s.team) s.hear(b.owner, b.from || b.owner.pos || p, s.pos.distanceTo(b.from || p), true);
                }
            }
        }
        if (!hit) return false;
        const g = this.game;
        let dmg;
        if (b.small && b.def) {
            const dist = (b.def.life - b.life) * b.def.velocity;
            dmg = damageAt(b.def, dist) * (zone === 'head' ? b.def.head : 1);
        } else dmg = 45 + (b.damage || 0) * 2; // cannon shells
        const at = _v2.lerpVectors(prev, p, bt);
        this.blood(at, _v3.copy(b.vel).normalize(), zone === 'head');
        const wasAlive = hit.alive;
        hit.damage(dmg, b.owner, 'gun', b.from || null);
        const mine = b.owner && (b.owner === g.pilotMode || b.owner === g.player);
        if (mine) {
            g.hitmarkerT = g.time;
            g.hitKind = zone === 'head' ? 'head' : 'body';
            if (wasAlive && !hit.alive) { g.killmarkerT = g.time; hit.headshot = zone === 'head'; }
        }
        b.pos.copy(at);
        return true;
    }

    closestT(a, b, c) {
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L2 = dx * dx + dy * dy + dz * dz;
        return L2 > 0 ? clamp(((c.x - a.x) * dx + (c.y + 1 - a.y) * dy + (c.z - a.z) * dz) / L2, 0, 1) : 0;
    }

    blood(at, dir, head) {
        const fx = this.game.effects;
        if (!fx || !fx.smoke) return;
        for (let i = 0; i < (head ? 7 : 4); i++) {
            _v4.copy(dir).multiplyScalar(rand(1, 4)).add(_v5.set(rand(-1, 1), rand(-0.5, 1.2), rand(-1, 1)));
            fx.smoke.emit(at, _v4, rand(0.25, 0.5), 0.08, rand(0.3, 0.55), [0.3, 0.015, 0.012], [0.18, 0.01, 0.01], 0.85, 0, 2.5, -4, 0, 0.5, 0.5);
        }
    }

    // A blast B = { R, inner, peak } at `at`: soldiers inside take its damage (their own side's a third of it
    // outside the lethal radius, and the one a rocket hit dead-on all of it)
    blast(at, B, source, team, direct = null) {
        if (!this.soldiers.length) return;
        this.forEachNear(at, B.R, (s) => {
            if (!s.alive) return;
            const d = _v.set(s.pos.x, s.pos.y + 0.9, s.pos.z).distanceTo(at);
            let dmg = s === direct ? 999 : blastDamage(d, B);
            if (s !== direct && d > B.inner) dmg *= friendlyFactor(team, s.team, 'blast');
            if (dmg > 0) s.damage(dmg, source, 'blast', at);
        });
    }

    // the first soldier (not `exclude`) on the segment a → b: { t, soldier } or null
    segmentHit(a, b, r = 0.35, exclude = null) {
        let best = null;
        this.forEachNear(_v.lerpVectors(a, b, 0.5), a.distanceTo(b) / 2 + 3, (s) => {
            if (!s.alive || s === exclude) return;
            if (personHitTest(a, b, s.pos, s.stance) || segPointDist2(a, b, _v2.set(s.pos.x, s.pos.y + 1, s.pos.z)) < (0.45 + r) ** 2) {
                const t = this.closestT(a, b, s.pos);
                if (!best || t < best.t) best = { t, soldier: s };
            }
        });
        return best;
    }

    onKilled(s, source, kind) {
        this.game.events && this.game.events.emit('soldierKilled', s, { source, kind, headshot: !!s.headshot });
        for (const f of this.onKilledHooks) f(s, source, kind);
    }

    // ═════════════ per frame ═════════════
    update(dt) {
        const g = this.game;
        this.frame++;
        if (!this.soldiers.length) return;
        this.night = !!(g.world && g.world.timeKey === 'night');
        // the player's velocity (for leading shots)
        const pm = g.pilotMode;
        if (pm) {
            if (this.playerLast && dt > 0) this.playerVel.subVectors(pm.pos, this.playerLast).divideScalar(dt);
            this.playerLast = (this.playerLast || new THREE.Vector3()).copy(pm.pos);
        } else { this.playerLast = null; this.playerVel.set(0, 0, 0); }
        this.index();
        const cam = g.camera ? g.camera.position : null;
        const focus = pm ? pm.pos : g.player ? g.player.pos : cam;
        const AR2 = INF.AI_RANGE * INF.AI_RANGE;
        let thinking = 0, coarse = 0;
        for (const s of this.soldiers) {
            if (!s.alive) { this.updateDead(s, dt); continue; }
            const near = (cam && s.pos.distanceToSquared(cam) < AR2) || (focus && s.pos.distanceToSquared(focus) < AR2);
            if (!near) { s.coarse = true; s.coarseT = (s.coarseT || 0) + dt; if (s.coarseT > 0.5) { s.coarseUpdate(s.coarseT); s.coarseT = 0; } coarse++; continue; }
            s.coarse = false;
            thinking++;
            s.thinkT -= dt;
            if (s.thinkT <= 0) { s.thinkT += INF.THINK; s.think(INF.THINK); }
            s.act(dt);
        }
        this.stats.thinking = thinking; this.stats.coarse = coarse;
        if (this.render) this.updateBodies(dt);
    }

    updateDead(s, dt) {
        s.deadT += dt;
        const f = s.fling;
        if (f && !f.done) {
            f.t += dt;
            f.vel.y -= 9.81 * dt;
            s.pos.addScaledVector(f.vel, dt);
            const h = this.groundY(s.pos.x, s.pos.z);
            if (s.pos.y <= h) { s.pos.y = h; if (f.soft || f.vel.y > -3) f.done = true; else { f.vel.y *= -0.25; f.vel.x *= 0.4; f.vel.z *= 0.4; } }
        }
        // bodies are cleared a while later
        if (s.deadT > 90) this.remove(s);
    }

    remove(s) {
        if (s.body) this.release(s);
        const i = this.soldiers.indexOf(s);
        if (i >= 0) this.soldiers.splice(i, 1);
        if (s.squad) { const k = s.squad.members.indexOf(s); if (k >= 0) s.squad.members.splice(k, 1); }
    }

    // ═════════════ bodies ═════════════
    // The nearest FULL soldiers within FULL_RANGE get an animated character (from a pool); others within
    // FIG_RANGE are instanced figures.
    updateBodies(dt) {
        const g = this.game, cam = g.camera;
        if (!cam) return;
        const cp = cam.position;
        // who gets a full body (re-picked every few frames: stable, cheap)
        if (this.frame % 6 === 0 || !this._near) {
            const cand = this._cand || (this._cand = []);
            cand.length = 0;
            const R2 = INF.FULL_RANGE * INF.FULL_RANGE;
            for (const s of this.soldiers) { s._d2 = s.pos.distanceToSquared(cp); if (s._d2 < R2) cand.push(s); }
            cand.sort((a, b) => a._d2 - b._d2);
            const want = new Set(cand.slice(0, INF.FULL));
            for (const s of this.soldiers) if (s.body && !want.has(s)) this.release(s);
            let made = 0;
            for (const s of want) if (!s.body && this.assign(s, made < 2)) made++;
            this._near = want;
        }
        // frustum (skip animating what isn't on screen)
        const fr = this._frustum || (this._frustum = new THREE.Frustum());
        cam.updateMatrixWorld();
        _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        fr.setFromProjectionMatrix(_m);
        const sph = this._sph || (this._sph = new THREE.Sphere(new THREE.Vector3(), 1.2));
        let full = 0, k = 0;
        for (const s of this.soldiers) {
            if (!s.body) continue;
            full++;
            const ch = s.body.ch;
            this.poseBody(s, ch, dt);
            sph.center.set(s.pos.x, s.pos.y + 0.9, s.pos.z);
            const onScreen = fr.intersectsSphere(sph);
            // the nearest few every frame, the rest every other; off screen every fourth, without the hands
            s.body.acc += dt;
            const every = !onScreen ? 4 : k < 8 ? 1 : 2;
            k++;
            if ((this.frame + s.id) % every === 0) { ch.tick(s.body.acc, onScreen); s.body.acc = 0; }
        }
        this.stats.full = full;
        this.updateFigures();
    }

    // a character for soldier s (from the pool, or a new one if `create`)
    assign(s, create) {
        let b = this.pool.find(p => !p.soldier);
        if (!b) {
            if (!create) return false;
            const ch = new Character('pilot');
            ch.manual = true;
            this.mergeBody(ch);
            b = { ch, soldier: null, team: null, acc: 0 };
            this.pool.push(b);
        }
        const ch = b.ch;
        b.soldier = s; s.body = b; b.acc = 0;
        if (b.team !== s.team) { this.dress(ch, s.team); b.team = s.team; }
        this.game.scene.add(ch.root);
        ch.root.visible = true;
        ch.setPose(null); ch.setCrouch(0);
        if (s.alive) {
            ch.setWeapon(s.weaponId, { mode: 'hold', lod: 1 });
            ch.play('Idle', 0);
        } else {
            ch.setWeapon(null);
            ch.play('Death', 0);
            const a = ch.actions.Death;
            if (a) a.time = a.getClip().duration; // already down
        }
        this.poseBody(s, ch, 0);
        return true;
    }

    release(s) {
        const b = s.body;
        if (!b) return;
        b.soldier = null; s.body = null;
        b.ch.root.visible = false;
        if (b.ch.root.parent) b.ch.root.parent.remove(b.ch.root);
    }

    // The uniform: team colours on the SWAT model's clothing. A soldier's body is merged into one skinned mesh (one
    // draw call, not nine) with the colours in its vertices, one shared geometry per team; a body that can't be
    // merged has its materials recoloured instead.
    dress(ch, team) {
        if (ch.merged) { ch.merged.geometry = this.teamGeometry(team); return; }
        const mats = this._mats || (this._mats = {});
        (ch.clone || ch.root).traverse(o => {
            if (!o.isMesh || !o.material) return;
            const base = o.userData.baseMat || (o.userData.baseMat = o.material);
            const key = team + ':' + base.name;
            if (!mats[key]) {
                const L = TEAM_LOOK[team];
                const m = base.clone();
                if (/^Swat$/i.test(base.name) && L) m.color.setHex(L.body);
                else if (/Black/i.test(base.name) && L) m.color.setHex(L.gear);
                mats[key] = m;
            }
            o.material = mats[key];
        });
    }

    // a new body: its skinned parts (all bound to one skeleton, see character.js) become one mesh
    mergeBody(ch) {
        if (!ch.clone) return;
        const parts = [];
        ch.clone.traverse(o => { if (o.isSkinnedMesh) parts.push(o); });
        const f = parts[0];
        if (parts.length < 2 || !parts.every(p => p.skeleton === f.skeleton && p.parent === f.parent && p.bindMatrix.equals(f.bindMatrix) && p.matrix.equals(f.matrix))) return;
        if (!this._bodySrc) this._bodySrc = parts.map(p => ({ geo: p.geometry, mat: p.material }));
        const geo = this.teamGeometry('red');
        if (!geo) return;
        const mat = this._bodyMat || (this._bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04, name: 'soldier' }));
        const mesh = new THREE.SkinnedMesh(geo, mat);
        mesh.name = 'soldier';
        mesh.position.copy(f.position); mesh.quaternion.copy(f.quaternion); mesh.scale.copy(f.scale);
        mesh.bind(f.skeleton, f.bindMatrix);
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
        f.parent.add(mesh);
        for (const p of parts) p.parent.remove(p);
        ch.merged = mesh;
    }

    // the body's parts merged, coloured for a team (built once per team)
    teamGeometry(team) {
        const cache = this._teamGeo || (this._teamGeo = {});
        if (cache[team] !== undefined) return cache[team];
        const L = TEAM_LOOK[team], keep = ['position', 'normal', 'skinIndex', 'skinWeight', 'color'];
        let merged = null;
        try {
            const geos = this._bodySrc.map(({ geo, mat }) => {
                const g = geo.clone();
                const c = new THREE.Color().copy(mat.color);
                if (L && /^Swat$/i.test(mat.name)) c.setHex(L.body);
                else if (L && /Black/i.test(mat.name)) c.setHex(L.gear);
                const n = g.attributes.position.count, a = new Float32Array(n * 3);
                for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
                g.setAttribute('color', new THREE.BufferAttribute(a, 3));
                for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
                g.morphAttributes = {};
                // the same attribute types in every part (glTF may store joints as bytes in one, shorts in another)
                const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
                if (si && !(si.array instanceof Uint16Array)) g.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(si.array), 4));
                if (sw && !(sw.array instanceof Float32Array)) {
                    const f = new Float32Array(sw.count * 4);
                    for (let i = 0; i < sw.count; i++) { f[i * 4] = sw.getX(i); f[i * 4 + 1] = sw.getY(i); f[i * 4 + 2] = sw.getZ(i); f[i * 4 + 3] = sw.getW(i); }
                    g.setAttribute('skinWeight', new THREE.BufferAttribute(f, 4));
                }
                return g;
            });
            const ok = geos.every(g => keep.every(k => !!g.attributes[k]) && !!g.index === !!geos[0].index);
            merged = ok ? mergeGeometries(geos, false) : null;
        } catch (e) { merged = null; }
        cache[team] = merged;
        return merged;
    }

    // the body follows the soldier: place, turn, animation for what he's doing, aim, kneel
    poseBody(s, ch, dt) {
        ch.root.position.copy(s.pos);
        if (!s.alive) {
            ch.root.rotation.set(0, s.deathYaw ?? s.yaw, 0);
            if (s.fling && !s.fling.done) ch.root.rotation.x = -s.fling.t * (s.fling.spin || 0) * 0.2;
            // sink into the ground before being cleared
            if (s.deadT > 85) ch.root.position.y -= (s.deadT - 85) * 0.3;
            if (ch.current !== ch.actions.Death) ch.play('Death', 0.1);
            return;
        }
        ch.root.rotation.set(0, s.yaw, 0);
        ch.setCrouch(s.crouchK);
        ch.setAim(s.aimPitch, s.aiming);
        // lod: the detailed weapon close up
        const lod = s._d2 != null && s._d2 < 28 * 28 ? 0 : 1;
        if (ch.weapon && ch.weapon.lod !== lod) ch.setWeapon(s.weaponId, { mode: 'hold', lod });
        if (s.throwT >= 0) { ch.play('Punch_Right', 0.1, 0.9); return; }
        if (s.hitAnimT > 0.2) { ch.play('HitRecieve', 0.08, 1.4); return; }
        const sp = s.moving ? s.moveSpeed : 0;
        if (sp < 0.3) { ch.play(s.stance === 'crouch' ? 'Idle_Gun' : 'Idle', 0.25); return; }
        // moving: facing the move (running) or strafing while aiming at the enemy
        const moveYaw = Math.atan2(-(s.vel.x), -(s.vel.z));
        const rel = wrap(moveYaw - s.yaw);
        const a = Math.abs(rel);
        const name = a < 0.7 ? (sp > 4 ? 'Run' : 'Walk') : a > 2.4 ? 'Run_Back' : rel > 0 ? 'Run_Left' : 'Run_Right';
        ch.play(name, 0.2, name === 'Walk' ? Math.max(0.6, sp / 1.6) : Math.max(0.55, sp / 5.2));
    }

    // ── instanced figures: every soldier between FULL and FIG_RANGE (alive: standing; dead: lying) ──
    updateFigures() {
        const g = this.game, cp = g.camera.position;
        if (!this.figures) this.buildFigures();
        const im = this.figures;
        const R2 = INF.FIG_RANGE * INF.FIG_RANGE;
        let n = 0;
        for (const s of this.soldiers) {
            if (s.body || n >= im.instanceMatrix.count) continue;
            const d2 = s.pos.distanceToSquared(cp);
            if (d2 > R2) continue;
            _e.set(s.alive ? 0 : -Math.PI / 2, s.alive ? s.yaw : (s.deathYaw ?? s.yaw), 0);
            _q.setFromEuler(_e);
            _m.compose(_v.copy(s.pos).setY(s.pos.y + (s.alive ? (s.stance === 'crouch' ? -0.45 : 0) : 0.15)), _q, _s.set(1, s.alive && s.stance === 'crouch' ? 0.7 : 1, 1));
            im.setMatrixAt(n, _m);
            im.setColorAt(n, s.team === 'red' ? this._redC : this._blueC);
            n++;
        }
        im.count = n;
        im.visible = n > 0;
        if (n) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
        this.stats.figures = n;
    }

    buildFigures() {
        const parts = [];
        const col = (geo, c) => { const n = geo.attributes.position.count, a = new Float32Array(n * 3); const cc = new THREE.Color(c); for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; } geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k); return geo.index ? geo.toNonIndexed() : geo; };
        const cap = (r, l, x, y, z, c) => { const g = new THREE.CapsuleGeometry(r, l, 2, 6); g.translate(x, y, z); return col(g, c); };
        parts.push(cap(0.09, 0.62, -0.1, 0.45, 0, 0xffffff), cap(0.09, 0.62, 0.1, 0.45, 0, 0xffffff)); // legs (uniform: instance colour)
        parts.push(cap(0.17, 0.42, 0, 1.18, 0, 0xffffff));                                           // torso
        parts.push(cap(0.06, 0.45, -0.22, 1.12, -0.12, 0xffffff), cap(0.06, 0.45, 0.22, 1.12, -0.12, 0xffffff)); // arms
        { const h = new THREE.SphereGeometry(0.11, 8, 6); h.translate(0, 1.6, 0); parts.push(col(h, 0xc8a080)); }
        { const h = new THREE.SphereGeometry(0.135, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2); h.translate(0, 1.64, 0); parts.push(col(h, 0x333a2a)); }
        { const r = new THREE.BoxGeometry(0.05, 0.08, 0.8); r.translate(0.1, 1.2, -0.35); parts.push(col(r, 0x1a1a1a)); } // rifle
        const geo = mergeGeometries(parts);
        const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
        const im = new THREE.InstancedMesh(geo, mat, 512);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(512 * 3).fill(1), 3);
        im.count = 0; im.frustumCulled = false; im.castShadow = true;
        this.game.scene.add(im);
        this.figures = im;
        this._redC = new THREE.Color(TEAM_LOOK.red.body).multiplyScalar(1.6);
        this._blueC = new THREE.Color(TEAM_LOOK.blue.body).multiplyScalar(1.6);
    }

    // ── garrisons for the sites in the game (called by game.js) ──
    // A base: local (lx, lz) positions → world, squads at the gate, on the apron, round the bunker and radars.
    garrison(base, team, toWorld, layout) {
        const out = [];
        const W = (lx, lz) => { const w = toWorld(base, lx, lz); return new THREE.Vector3(w.x, 0, w.z); };
        const facing = (lx, lz, tx, tz) => { const a = W(lx, lz), b = W(tx, tz); return Math.atan2(-(b.x - a.x), -(b.z - a.z)); };
        for (const L of layout) {
            const route = L.route ? L.route.map(([x, z]) => W(x, z)) : null;
            out.push(this.spawnSquad({ team, pos: W(L.at[0], L.at[1]), n: L.n, kind: route ? 'patrol' : 'guard', route, weapon: L.weapon || 'mixed', spread: L.spread ?? 3, facing: L.look ? facing(L.at[0], L.at[1], L.look[0], L.look[1]) : undefined, name: L.name }));
        }
        return out;
    }

    clear() {
        for (const s of this.soldiers) if (s.body) this.release(s);
        this.soldiers = []; this.squads = [];
        this.grid.clear();
        if (this.figures) { this.figures.count = 0; this.figures.visible = false; }
        this.heights.clear();
        this._near = null;
    }

    // every character made (so a shader-compile pass can see one early)
    prewarm(n = 4) {
        if (!this.render) return;
        for (let i = this.pool.length; i < n; i++) { const ch = new Character('pilot'); ch.manual = true; this.mergeBody(ch); ch.root.visible = false; this.pool.push({ ch, soldier: null, team: null, acc: 0 }); }
    }
}
void BODY; void HELMET_Y;

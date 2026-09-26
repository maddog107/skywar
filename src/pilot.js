// ═══════════════════════════════════════════════════════════════
// On-foot / under-canopy pilot (War Thunder trailer style):
//  • first-person under the parachute, steer with WASD, look with the mouse
//  • an arsenal (arsenal.js): AK-47, M4A1, Remington 870, M9, Desert Eagle, RPG-7, M67 grenades.
//    1–7 or the mouse wheel switch, RMB aims down the sights, R reloads, SHIFT sprints on foot
//  • shoot enemy parachutists, soldiers (infantry.js), a pilot through his canopy, cars, vehicles
//  • hijack: board any nearby jet whose pilot is dead (or friendly, or your
//    own abandoned jet) — the previous occupant gets shoved out
//  • enemy pilots under canopies shoot back; soldiers do too
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { clamp, rand, damp } from './util.js';
import { Character } from './character.js';
import { Gun, SLOTS, weaponDef, spreadFor, BODY, damageAt } from './arsenal.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3();

const CANOPY_HP = 150;
const ARMOR = 0.55;        // body armour and helmet: the share of a small-arms round's damage that gets through
const REGEN = { delay: 6, rate: 7 }; // health comes back after `delay` s without a hit, `rate` hp/s

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

// squared distance from point c to segment a-b
export function segPointDist2(a, b, c) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L2 = dx * dx + dy * dy + dz * dz;
    const t = L2 > 0 ? clamp(((c.x - a.x) * dx + (c.y - a.y) * dy + (c.z - a.z) * dz) / L2, 0, 1) : 0;
    const px = a.x + dx * t - c.x, py = a.y + dy * t - c.y, pz = a.z + dz * t - c.z;
    return px * px + py * py + pz * pz;
}

// A round from a to b against a person standing at `feet` (zones: arsenal.js BODY): 'head', 'body' or null
const _h = new THREE.Vector3(), _f0 = new THREE.Vector3(), _f1 = new THREE.Vector3();
export function personHitTest(a, b, feet, stance = 'stand') {
    const Z = BODY[stance] || BODY.stand;
    _h.set(feet.x, feet.y + Z.head, feet.z);
    if (segPointDist2(a, b, _h) < Z.headR * Z.headR) return 'head';
    _f0.set(feet.x, feet.y + Z.body0, feet.z); _f1.set(feet.x, feet.y + Z.body1, feet.z);
    if (segSegDistSq(a, b, _f0, _f1) < Z.bodyR * Z.bodyR) return 'body';
    return null;
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
    if (s.character) { s.character.setWeapon && s.character.setWeapon(null); s.character.play('Death', 0.12); }
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

const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'];

export class PilotOnFoot {
    constructor(game, seat, fromAircraft) {
        this.game = game;
        this.seat = seat;
        this.from = fromAircraft;
        this.yaw = seat.root.rotation.y || Math.atan2(-fromAircraft.vel.x, -fromAircraft.vel.z);
        this.pitch = 0;
        this.health = 100;
        this.alive = true;
        this.cls = 'infantry';
        seat.canopyHp = CANOPY_HP; seat.canopyGone = false; // bullets through the canopy tear it
        this.wasLanded = !!seat.landed; this.descentV = 0;
        this.strafeT = 0; this.threat = null; this.lastHitT = -9;
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
        // ── the arsenal ──
        this.guns = {};
        for (const id of SLOTS) this.guns[id] = new Gun(id);
        this.weaponId = 'ak47';
        this.lastWeapon = 'm9';
        this.switching = null;       // { from, to, t, dur }
        this.adsK = 0;               // 0 hip … 1 aimed down the sights
        this.sprinting = false;
        this.moveSpeed = 0;
        this.onGround = !!seat.landed;
        this.landed = false;         // (one frame) just touched down
        this.recoil = 0;             // transient camera kick (rad, added to the view pitch by the camera)
        this.recoilDebt = 0;         // part of the aim climb that settles back when you stop shooting
        this.shotFlag = 0;           // shots since the view model last looked (it kicks for them)
        this.lastShotT = -9;
        this.throwState = null;      // grenade: { phase: 'pull' | 'hold' | 'throw' | 'thrown', t }
        this.hurt = [];              // damage direction markers: { bearing (world, rad), t }
        this.prevKeys = {};
        this.kills = 0;
        if (seat.character) seat.character.setWeapon(this.weaponId, { mode: 'hand' }); // third person: the weapon in his hand
        if (seat.walkedOut) this.startWalking();
    }

    get gun() { return this.guns[this.weaponId]; }
    get def() { return this.gun.def; }
    // third-person unless the player picked the cockpit (first-person) camera
    get thirdPerson() { return this.game.cameraMode !== 'cockpit'; }
    // the camera's field of view: zooms in down the sights
    get fov() {
        const d = this.def, k = this.adsK * this.adsK * (3 - 2 * this.adsK);
        return this.thirdPerson ? 66 + (d.ads.fov + 8 - 66) * k : 72 + (d.ads.fov - 72) * k;
    }

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
        ch.setPose(null);
        ch.setWeapon(this.weaponId, { mode: 'hold' });
        this.walker = { mesh: ch.root, character: ch, speed: 0, anim: 0, yaw: this.yaw, vx: 0, vz: 0 };
        this.placeWalker();
    }

    placeWalker() {
        const w = this.walker;
        w.mesh.position.copy(this.seat.root.position).setY(this.seat.root.position.y - 0.3);
        w.mesh.rotation.set(0, w.yaw, 0);
    }

    dispose() { if (this.walker) { this.walker.character.dispose(); } }

    get pos() { return this.seat.root.position; }
    // feet on the ground (the seat root rides 0.3 m up)
    feet(out) { return out.copy(this.seat.root.position).setY(this.seat.root.position.y - (this.walker ? 0.3 : 0)); }
    getForward(out) { return this.viewDir(out); }

    headPos(out) { return out.copy(this.seat.root.position).add(_v3.set(0, this.walker ? 1.45 : this.seat.deployed ? 1.9 : 1.2, 0)); }

    viewDir(out) {
        return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    }

    update(dt, mouse) {
        const g = this.game, input = g.input;
        const sens = 0.0022 * g.settings.sensitivity * (1 - this.adsK * 0.45); // steadier down the sights
        this.yaw -= mouse.dx * sens;
        this.pitch = clamp(this.pitch - mouse.dy * sens * (g.settings.invertPitch ? -1 : 1), -1.45, 1.45);
        this.recoil = damp(this.recoil, 0, 12, dt);
        const s = this.seat;
        this.landed = false;
        // first person: don't render your own body around the camera
        if (this.walker) this.walker.mesh.visible = this.thirdPerson;
        else if (s.pilot) s.pilot.visible = this.thirdPerson;
        if (s.deployed && !s.landed) this.steerCanopy(dt, input);
        else if (s.landed) {
            if (!this.walker) this.startWalking();
            this.walk(dt, input);
        }
        this.onGround = !!s.landed;
        this.updateWeapons(dt, input, mouse);
        // landing: a torn (or shredded) canopy comes down hard
        if (s.landed && !this.wasLanded) { this.landed = true; if (this.descentV > 9) this.takeHit((this.descentV - 9) * 7, 'HIT THE GROUND TOO HARD'); }
        this.wasLanded = s.landed;
        if (!s.landed) this.descentV = -s.vel.y;
        // health comes back when you've been out of the fight for a while
        if (this.health < 100 && g.time - this.lastHitT > REGEN.delay) this.health = Math.min(100, this.health + REGEN.rate * dt);
        for (let i = this.hurt.length - 1; i >= 0; i--) if (g.time - this.hurt[i].t > 1.6) this.hurt.splice(i, 1);

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
        // weapons lying on the ground: walk over one to take its ammunition
        if (this.walker && g.ordnance) {
            const pick = g.ordnance.pickupNear(this.pos, 1.8);
            if (pick) this.takeAmmo(pick);
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

    // ── Weapons ──
    press(input, code) { const d = input.down(code), p = d && !this.prevKeys[code]; this.prevKeys[code] = d; return p; }

    selectWeapon(id) {
        if (!this.guns[id] || this.hijackT > 0) return;
        const cur = this.switching ? this.switching.to : this.weaponId;
        if (id === cur) return;
        this.gun.cancelReload();
        this.throwState = null;
        const from = this.switching && this.switching.t < this.switching.dur / 2 ? this.switching.from : this.weaponId;
        this.switching = { from, to: id, t: 0, dur: weaponDef(from).draw * 0.45 + weaponDef(id).draw * 0.55 };
        if (from !== id) this.lastWeapon = from;
        this.game.audio.weaponSwitch && this.game.audio.weaponSwitch(weaponDef(id).type);
    }

    // the next / previous weapon that has any ammunition left
    cycleWeapon(dir) {
        const cur = this.switching ? this.switching.to : this.weaponId;
        let i = SLOTS.indexOf(cur);
        for (let k = 0; k < SLOTS.length; k++) {
            i = (i + dir + SLOTS.length) % SLOTS.length;
            if (this.guns[SLOTS[i]].total > 0) { this.selectWeapon(SLOTS[i]); return; }
        }
    }

    takeAmmo(pick) {
        const gun = this.guns[pick.id];
        if (!gun) return;
        const room = gun.def.reserve * 2 - gun.reserve;
        if (room <= 0) { this.hint = this.hint || 'FULL ON ' + gun.def.name + ' AMMO'; return; }
        const n = Math.min(room, pick.rounds);
        gun.reserve += n;
        pick.rounds -= n;
        this.game.addFeed('+' + n + ' ' + gun.def.name + (gun.def.type === 'grenade' ? '' : ' ROUNDS'), '#cfd8e0');
        this.game.audio.tick(700, 0.08, 0.05); this.game.audio.tick(900, 0.08, 0.05, 0.07);
    }

    updateWeapons(dt, input, mouse) {
        const g = this.game;
        const live = this.alive && this.hijackT <= 0;
        // switching: 1–7, the wheel
        for (let k = 0; k < DIGITS.length; k++) if (this.press(input, DIGITS[k]) && live) this.selectWeapon(SLOTS[k]);
        if (mouse.wheel && live) this.cycleWeapon(mouse.wheel > 0 ? 1 : -1);
        if (this.press(input, 'KeyQ') && live) this.selectWeapon(this.lastWeapon); // quick swap
        if (this.switching) {
            const sw = this.switching;
            sw.t += dt;
            if (sw.t >= sw.dur / 2 && this.weaponId !== sw.to) {
                this.weaponId = sw.to;
                if (this.walker) this.walker.character.setWeapon(sw.to, { mode: 'hold' });
                else if (this.seat.character) this.seat.character.setWeapon(sw.to, { mode: 'hand' });
            }
            if (sw.t >= sw.dur) this.switching = null;
        }
        const gun = this.gun, def = gun.def;
        // aim down the sights (not while sprinting, reloading, switching or throwing)
        const wantAds = live && input.mouse.right && !this.switching && !gun.reloading && !this.sprinting && def.type !== 'grenade';
        this.adsK = clamp(this.adsK + (wantAds ? 1 : -1) * dt / def.ads.time, 0, 1);
        // reload
        if (this.press(input, 'KeyR') && live && !this.switching && gun.startReload()) this.sprinting = false;
        // the trigger
        const trigger = live && input.mouse.left && !this.switching;
        if (trigger && this.sprinting) this.sprintBlock = 0.35;
        if (def.fire === 'throw') { this.updateThrow(dt, trigger); gun.update(dt, false); }
        else {
            const n = gun.update(dt, trigger && !this.sprinting);
            for (let i = 0; i < n; i++) this.fire(gun, i, n, dt);
            if (gun.dry) {
                g.audio.dryFire ? g.audio.dryFire() : g.audio.tick(300, 0.08, 0.05);
                if (gun.reserve > 0) gun.startReload();
            }
            // an empty magazine reloads itself once you let go of the trigger (the rocket straight away)
            if (!gun.reloading && gun.mag === 0 && gun.reserve > 0 && (!trigger || def.fire === 'single') && gun.cycle <= 0.3 && !this.switching) gun.startReload();
            for (const e of gun.events) g.audio.reloadSound && g.audio.reloadSound(def.id, e);
            if (gun.total === 0 && !this.switching && !trigger) this.cycleWeapon(1); // out of everything: pick up something else
        }
        // recoil that settles back once you stop shooting
        if (g.time - this.lastShotT > 0.12 && this.recoilDebt > 0) {
            const k = Math.min(this.recoilDebt, this.recoilDebt * 6 * dt + 0.002);
            this.pitch -= k; this.recoilDebt -= k;
        }
    }

    // where a round starts and which way it goes: from the eyes in first person; along the crosshair ray in
    // third person, starting level with the muzzle
    aimRay(origin, dir, muzzle) {
        const g = this.game;
        if (this.thirdPerson) {
            origin.copy(g.camera.position);
            g.camera.getWorldDirection(dir);
            const along = muzzle ? Math.max(1, _v.subVectors(muzzle, origin).dot(dir)) : (this.walker ? 4.5 : 17);
            origin.addScaledVector(dir, along);
        } else {
            this.headPos(origin);
            this.viewDir(dir);
        }
        return origin;
    }

    // the muzzle in the world: the third-person character's weapon, or the view model's (first person)
    muzzleWorld(out) {
        const ch = this.walker ? this.walker.character : this.seat.character;
        if (this.thirdPerson && ch && ch.muzzlePos(out)) return out;
        const vm = this.game.cockpit && this.game.cockpit.viewModel;
        if (!this.thirdPerson && vm && vm.muzzleWorld(out)) return out.add(this.game.camera.position);
        return null;
    }

    stance() {
        const w = this.walker;
        return { ads: this.adsK, walk: w ? clamp(w.speed / 3.4, 0, 1) : 0, run: this.sprinting ? 1 : 0, air: !this.onGround };
    }

    fire(gun, i, n, dt) {
        const g = this.game, def = gun.def;
        const muzzle = this.muzzleWorld(_m);
        this.aimRay(_o, _d, muzzle);
        // a catch-up round (several in one long frame) left the muzzle a moment ago: start it further on
        const late = (n - 1 - i) * (60 / def.rpm);
        const spread = spreadFor(def, gun, this.stance());
        if (g.ordnance) {
            if (def.projectile === 'rocket') g.ordnance.launchRocket(this, { origin: muzzle || _o, dir: _d, team: 'blue', carry: this.vel, backblast: true });
            else g.ordnance.fireGun(this, def, { origin: _o, dir: _d, muzzle, spread, team: 'blue', carry: this.vel, tracer: def.tracer && (gun.mag % def.tracer === 0), late, gun });
        }
        this.lastShotT = g.time;
        this.shotFlag++;
        // recoil: the aim climbs (less down the sights), a transient kick on top, a little sideways wander
        const r = def.recoil, k = 1 - this.adsK * 0.35;
        const climb = r.pitch * k * rand(0.8, 1.2);
        this.pitch += climb; this.recoilDebt += climb * 0.55;
        this.yaw += rand(-1, 1) * r.yaw * k;
        this.recoil = Math.min(this.recoil + r.kick * 0.25, 0.08);
        g.shake = Math.max(g.shake, def.type === 'launcher' ? 0.5 : def.id === 'm870' || def.id === 'deagle' ? 0.22 : 0.08);
        this.sprinting = false;
        g.events.emit('rifle', this);
    }

    // grenades: hold the trigger to pull the pin and cock the arm (the arc shows), let go to throw
    updateThrow(dt, trigger) {
        const g = this.game, gun = this.gun;
        let st = this.throwState;
        if (!st) {
            if (trigger && gun.mag > 0 && !this.sprinting) { st = this.throwState = { phase: 'pull', t: 0 }; g.audio.grenadePin && g.audio.grenadePin(); }
            return;
        }
        st.t += dt;
        if (st.phase === 'pull' && st.t >= gun.def.pull) { st.phase = 'hold'; st.t = 0; }
        if ((st.phase === 'pull' || st.phase === 'hold') && !trigger && st.t > 0.02 && (st.phase === 'hold' || st.t >= gun.def.pull * 0.6)) { st.phase = 'throw'; st.t = 0; }
        if (st.phase === 'throw' && st.t >= 0.12 && !st.released) {
            st.released = true;
            gun.mag--;
            const hand = this.muzzleWorld(_m) || this.headPos(_m).add(_v.set(0, -0.1, 0));
            this.aimRay(_o, _d, null);
            g.ordnance && g.ordnance.throwGrenade(this, { origin: hand, dir: this.viewDir(_d), team: 'blue', carry: this.vel });
            this.lastShotT = g.time;
        }
        if (st.phase === 'throw' && st.t >= 0.3) { st.phase = 'thrown'; st.t = 0; }
        if (st.phase === 'thrown' && st.t >= gun.def.cycle - 0.3) {
            this.throwState = null;
            if (gun.reserve > 0) { gun.reserve--; gun.mag = 1; }
            else this.selectWeapon(this.lastWeapon !== 'm67' ? this.lastWeapon : 'm9');
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
        this.moveSpeed = 0;
        this.sprinting = false;
    }

    // On foot: WASD relative to where you look, SHIFT to sprint (not while aiming or shooting)
    walk(dt, input) {
        const w = this.walker, s = this.seat, g = this.game;
        const f = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
        const r = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
        this.sprintBlock = Math.max(0, (this.sprintBlock || 0) - dt);
        const def = this.def, gun = this.gun;
        this.sprinting = !!(f > 0 && input.down('ShiftLeft', 'ShiftRight') && this.adsK < 0.3 && this.sprintBlock <= 0 && !(this.throwState));
        let mx = 0, mz = 0;
        const aiming = this.adsK > 0.05 || (this.lastShotT ?? -9) > g.time - 0.6 || !!this.throwState;
        if (f || r) {
            const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
            mx = fx * f + rx * r; mz = fz * f + rz * r;
            const L = Math.hypot(mx, mz); mx /= L; mz /= L;
            if (!aiming) {
                let dy = Math.atan2(-mx, -mz) - w.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
                w.yaw += dy * Math.min(1, dt * 10);
            }
        }
        // aiming / shooting: square up to where you're aiming (and strafe) so the weapon points at it
        if (aiming) {
            let da = this.yaw - w.yaw; da = Math.atan2(Math.sin(da), Math.cos(da));
            w.yaw += da * Math.min(1, dt * 14);
        }
        const speed = (f || r) ? (this.sprinting ? 6.6 : this.adsK > 0.5 ? 2.0 : 3.4) * (def.speed || 1) * (gun.reloading && this.sprinting ? 0.9 : 1) : 0;
        w.speed = damp(w.speed, speed, 8, dt);
        this.moveSpeed = w.speed;
        const p = s.root.position;
        const nx = p.x + mx * w.speed * dt, nz = p.z + mz * w.speed * dt;
        const bl = g.world.towns && g.world.towns.buildings;
        if (bl && bl.blocks(nx, nz, p.y)) { w.speed = 0; this.placeWalker(); this.animateWalker(0, 0, aiming); return; } // walls are solid
        const ahead = g.surfaceAt(nx, nz, p.y + 1.5);
        const wasWet = g.surfaceAt(p.x, p.z, p.y + 1.5).water;
        if (!ahead.water || wasWet) { p.x = nx; p.z = nz; } // no walking out onto lakes (you can wade ashore)
        else { w.speed = 0; this.hint = this.hint || 'WATER — FIND ANOTHER WAY'; }
        const su = g.surfaceAt(p.x, p.z, p.y + 1.5);
        p.y = (su.water ? -0.9 : su.h) + 0.3;
        this.placeWalker();
        this.animateWalker(f, r, aiming);
    }

    // legs: forward / back / sidestep while aiming (the body faces the aim), plain walk / run otherwise
    animateWalker(f, r, aiming) {
        const w = this.walker, ch = w.character, g = this.game;
        ch.setAim(this.pitch, aiming || this.adsK > 0.2);
        if (!aiming || w.speed < 0.4) { ch.locomotion(w.speed, false); return; }
        // the movement relative to the body
        const rel = Math.atan2(r, f); // 0 forward, ±π/2 sideways, π back
        const a = Math.abs(rel);
        const name = a < 0.6 ? (w.speed > 4.5 ? 'Run' : 'Walk') : a > 2.5 ? 'Run_Back' : rel > 0 ? 'Run_Right' : 'Run_Left';
        ch.play(name, 0.2, name === 'Walk' ? Math.max(0.6, w.speed / 1.9) : Math.max(0.55, w.speed / 5));
        void g;
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
            if (Math.random() < clamp(0.18 - d / 3000, 0.02, 0.15)) this.takeHit(12, null, from);
        }
    }

    // ── Getting hit (weapons.js: red-team rounds and blasts) ──
    get canopyHp() { return this.seat.canopyHp ?? CANOPY_HP; }
    get canopyGone() { return !!this.seat.canopyGone; }
    get canopyUp() { return seatCanopyUp(this.seat); }

    // a round from a to b this frame: true if it hit you (or your canopy). b: the bullet (small arms carry their
    // weapon: damage with range, a headshot, body armour)
    bulletHit(a, b, damage, bullet = null) {
        if (!this.alive) return false;
        if (bullet && bullet.small && this.walker) {
            const zone = personHitTest(a, b, this.feet(_v));
            if (!zone) return false;
            const def = bullet.def, dist = (def.life - bullet.life) * def.velocity;
            let dmg = damageAt(def, dist) * ARMOR;
            if (zone === 'head') dmg *= def.head * 0.6; // (the helmet takes the worst of it)
            this.takeHit(dmg, zone === 'head' ? 'SHOT IN THE HEAD' : 'SHOT DEAD', bullet.from || null);
            return true;
        }
        const hit = seatHitTest(this.seat, a, b, !!this.walker);
        const from = bullet && bullet.from;
        if (hit === 'body') this.takeHit(22 + damage, 'CUT DOWN BY GUNFIRE', from);
        else if (hit === 'canopy') this.tearCanopy(6 + damage * 0.4);
        return !!hit;
    }

    // an explosion at `at` (radius R, damage at the centre)
    blast(at, R, dmg) {
        if (!this.alive) return;
        seatBody(this.seat, _v2, _v3, !!this.walker);
        const d = _v2.lerp(_v3, 0.5).distanceTo(at);
        if (d < R) this.takeHit(dmg * (1 - d / R), 'CAUGHT IN A BLAST', at);
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

    // take damage; `from` (a world position) shows where it came from on the HUD
    takeHit(dmg, cause, from = null) {
        if (!this.alive || dmg <= 0) return;
        const g = this.game;
        this.health -= dmg * g.difficulty.dmgTaken;
        this.lastHitT = g.time;
        if (from) {
            const bearing = Math.atan2(-(from.x - this.pos.x), -(from.z - this.pos.z));
            const same = this.hurt.find(h => Math.abs(Math.atan2(Math.sin(h.bearing - bearing), Math.cos(h.bearing - bearing))) < 0.3);
            if (same) { same.t = g.time; same.bearing = bearing; } else this.hurt.push({ bearing, t: g.time });
            if (this.hurt.length > 6) this.hurt.shift();
        }
        g.damageFlash = Math.min(1, g.damageFlash + 0.35 + dmg / 80);
        g.shake = Math.min(1.5, g.shake + 0.25 + dmg / 120);
        g.audio.thud(0.4);
        if (this.health <= 0) {
            this.health = 0;
            this.alive = false;
            this.die();
            g.pilotKilled(cause);
        } else if (this.health < 50 && !this.hurtCall) { this.hurtCall = true; g.audio.say("I'm hit! I'm hit!", true); }
        if (this.health > 70) this.hurtCall = false;
    }

    // dead: the body goes limp (a hanging one keeps descending under whatever is left of the canopy)
    die() {
        const ch = this.walker ? this.walker.character : this.seat.character;
        if (ch) {
            // the weapon falls out of his hands
            if (this.walker && this.game.ordnance) this.game.ordnance.dropWeapon(ch, this.weaponId, this.gun.mag + this.gun.reserve);
            ch.setWeapon(null); ch.play('Death', 0.12);
        }
        this.seat.dead = true;
        this.throwState = null;
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

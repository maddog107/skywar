// ═══════════════════════════════════════════════════════════════
// "Grand Theft Aero": start as a civilian in town, carjack a car, smash
// through the Miramar gate, and steal a jet off the flight line while the
// military police chase you — then outrun the interceptors they scramble.
//   walk → E by a car on the road: carjack → drive → ram the gate (or talk
//   your way up to the sentry and get rumbled) → INTRUDER ALERT → MP Humvees
//   chase you: they ram your car (it takes damage, and can roll) and tackle
//   you on foot (BUSTED when you're down) → jump out by the jet → climb in (E) →
//   taxi & take off under fire → interceptors → escape 22 km or shoot them down
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, baseToWorld, worldToBase, terrainHeight } from './world.js';
import { GroundStart } from './groundstart.js';
import { propInstance } from './props.js';
import { Character } from './character.js';
import { samplePath } from './roads.js';
import { clamp, rand } from './util.js';

// fallback box meshes (no prop model loaded) own their geometry; prop clones share the cache's
function ownMesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.userData.ownGeo = true; return m; }
function freeOwn(m) { if (m && m.userData.ownGeo) { m.geometry.dispose(); m.material.dispose(); } }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

// Miramar, base-local: where the jet to steal is parked (clear of the flight line rows), and what's solid
export const HEIST_JET = { lx: 380, lz: -1450, yaw: Math.PI / 2 }; // nose toward the runways (-x)
const MIRAMAR_OBSTACLES = (() => {
    const o = [];
    for (let k = 0; k < 9; k++) { const z = -1350 + k * 280; o.push([668, 732, z - 37, z + 37]); } // hangars
    o.push([800, 1360, -2150, -334], [800, 1360, -266, 2150]);  // the base buildings, either side of the main road
    o.push([40, 560, -1370, 1030]);                              // the flight line rows
    o.push([612, 668, -1660, -1640]);                            // tower
    return o;
})();

class HeistGround extends GroundStart {
    constructor(op, jet, start) {
        super(op.game, jet, { base: op.base, obstacles: MIRAMAR_OBSTACLES, onFoot: start, character: 'civilian', noIntro: true });
        this.op = op;
        this.hp = 100; // you, on foot: MP tackles and shots wear this down
    }

    drive(dt, input, e) {
        if (this.car.flip) { this.flipStep(dt); return; }
        super.drive(dt, input, e);
    }

    // an MP vehicle hit the car at relative speed `rel` (m/s): dents, a shove, and maybe a roll
    rammed(u, rel) {
        const c = this.car, g = this.game;
        if (c.flip || c.wrecked) return;
        c.hp -= 4 + rel * 0.7; // a full-speed ram costs about a fifth of the car
        const dx = c.pos.x - u.pos.x, dz = c.pos.z - u.pos.z, L = Math.hypot(dx, dz) || 1, nx = dx / L, nz = dz / L;
        const push = _v.set(c.pos.x + nx * 1.8, c.pos.y, c.pos.z + nz * 1.8);
        if (this.canMove(c.pos, push, 2.5) === 'ok') { c.pos.x = push.x; c.pos.z = push.z; }
        c.v *= 0.45;
        c.yaw += (Math.random() - 0.5) * 0.6;
        g.shake = Math.min(1.6, g.shake + 0.5 + rel * 0.03);
        g.audio.tick(70, 0.35, 0.5); g.audio.tick(150, 0.15, 0.3);
        g.effects.impact(_v2.copy(c.pos).addScaledVector(_v.set(nx, 0, nz), -1.2).setY(c.pos.y + 0.8), null);
        // which way it rolls: away from the hit, about the car's long axis
        const side = Math.sign(nx * Math.cos(c.yaw) - nz * Math.sin(c.yaw)) || 1;
        if (c.hp <= 0 || (c.hp < 40 && rel > 28 && Math.random() < 0.3)) this.flipCar(side, nx, nz); // wrecked, or a big hit on a battered car
        else g.addFeed('RAMMED BY THE MPs! CAR ' + Math.max(0, Math.round(c.hp)) + '%', '#ff9f5a');
    }

    flipCar(side, nx, nz) {
        const c = this.car, g = this.game;
        const box = new THREE.Box3().setFromObject(c.mesh);
        c.flip = { t: 0, side, nx, nz, h: box.max.y - box.min.y };
        c.v = 0;
        g.addFeed('THE CAR ROLLED!', '#ff4a3d');
        g.audio.tick(60, 0.6, 0.6);
    }

    // the roll: up, over onto the roof, sliding away from the hit; then you crawl out
    flipStep(dt) {
        const c = this.car, f = c.flip, g = this.game;
        f.t = Math.min(1, f.t + dt / 1.2);
        const k = f.t * f.t * (3 - 2 * f.t);
        const nx = c.pos.x + f.nx * 5 * (1 - f.t) * dt, nz = c.pos.z + f.nz * 5 * (1 - f.t) * dt;
        if (this.canMove(c.pos, _v.set(nx, c.pos.y, nz), 2.5) === 'ok') { c.pos.x = nx; c.pos.z = nz; }
        c.pos.y = this.groundY(c.pos.x, c.pos.z);
        _e.set(0, c.yaw, f.side * Math.PI * k);
        c.mesh.quaternion.setFromEuler(_e);
        c.mesh.position.set(c.pos.x, c.pos.y + Math.sin(Math.PI * f.t) * 2.2 + k * f.h, c.pos.z);
        if (f.t < 1) return;
        c.flip = null; c.wrecked = true;
        this.exitCar();
        this.hp -= 15;
        g.shake = Math.min(1.6, g.shake + 0.8);
        g.showBanner('WRECKED!', 'You crawl out of the wreck — run for the jet!', 3.5, '#ff9f5a');
    }

    // an MP caught you on foot: knocked down a peg (true = that was the last straw)
    tackled(u) {
        const w = this.walker, g = this.game;
        this.hp -= 25;
        const dx = w.pos.x - u.pos.x, dz = w.pos.z - u.pos.z, L = Math.hypot(dx, dz) || 1;
        const push = _v.set(w.pos.x + dx / L * 3, w.pos.y, w.pos.z + dz / L * 3);
        if (this.canMove(w.pos, push, 0.6) !== 'fence') { w.pos.x = push.x; w.pos.z = push.z; }
        g.shake = Math.min(1.6, g.shake + 0.7);
        g.audio.tick(90, 0.25, 0.4);
        if (this.hp > 0) g.addFeed('KNOCKED DOWN! GET UP AND RUN — HEALTH ' + Math.round(this.hp) + '%', '#ff9f5a');
        return this.hp <= 0;
    }

    // walking: carjack the nearest car on the road
    walkHook(dt, e) {
        if (this.car && this.car.wrecked && this.walker.pos.distanceTo(this.car.pos) < 4) { this.hint = 'THE CAR IS A WRECK — RUN FOR THE JET'; return true; }
        const traffic = this.game.world.towns && this.game.world.towns.traffic;
        if (!traffic) return false;
        let best = null, bd = 7;
        for (const c of traffic.cars) {
            if (c.dead || c.stolen || !c.pos) continue;
            const d = c.pos.distanceTo(this.walker.pos);
            if (d < bd) { bd = d; best = c; }
        }
        if (!best) return false;
        this.hint = best.speed > 3 ? 'E — CARJACK (it\'s moving!)' : 'E — CARJACK';
        if (e) { this.carjack(best, traffic); return true; }
        return false;
    }

    carjack(c, traffic) {
        const g = this.game;
        const type = traffic.carSet.slots[c.i].type;
        c.stolen = true; c.speed = 0;
        samplePath(c.path, c.s, _v, _v2);
        if (c.dir < 0) _v2.negate();
        const yaw = Math.atan2(-_v2.x, -_v2.z);
        const mesh = propInstance(type.id) || ownMesh(new THREE.BoxGeometry(2, 1.4, 4.5), new THREE.MeshStandardMaterial({ color: c.color }));
        const fast = type.id.startsWith('car_sports') ? 44 : type.id === 'car_police' ? 42 : 36;
        this.setCar(mesh, c.pos.clone(), yaw, fast, type.id === 'car_police' ? 'POLICE CAR' : 'CAR');
        this.car.hp = 100;
        // the driver bails out and runs off
        const driver = new Character('civilian');
        const side = _v.set(Math.cos(yaw), 0, -Math.sin(yaw));
        driver.root.position.copy(c.pos).addScaledVector(side, 2.5);
        driver.root.rotation.y = yaw + Math.PI / 2;
        driver.play('Run');
        g.scene.add(driver.root);
        this.op.fleeing.push({ ch: driver, t: 7, dir: side.clone() });
        this.walker.mesh.visible = false;
        this.state = 'drive';
        this.camYaw = 0;
        g.addFeed('CARJACKED A ' + (type.id === 'car_police' ? 'POLICE CAR (bold move)' : type.id.replace('car_', '').toUpperCase()), '#ffc23f');
        g.audio.say(type.id === 'car_police' ? 'Hey! That\'s my cruiser!' : 'Hey! My car!', true);
        g.audio.tick(160, 0.2, 0.3);
        this.op.onCarjack();
    }

    // at the booth without being on the list: the sentry sounds the alarm
    driveHook(dt, e) {
        const c = this.car;
        if (!this.op.alarm) {
            const d = c.pos.distanceTo(this.checkPos);
            if (d < 30 && Math.abs(c.v) < 1) {
                this.stopT += dt;
                this.hint = 'SENTRY: "ID, PLEASE…"';
                if (this.stopT > 2.5) this.op.raiseAlarm('SENTRY: "You\'re not on the list — STEP OUT OF THE VEHICLE!"');
            } else if (d < 60 && Math.abs(c.v) > 12) this.hint = 'FLOOR IT — RAM THE BARRIER!';
        }
        if (c.pos.distanceTo(this.jet.pos) < 60) this.hint = Math.abs(c.v) < 2.5 ? 'E — GET OUT AND STEAL THE JET' : 'SLOW DOWN — THE JET IS HERE';
        // the Ready Room's checkpoint logic is skipped, so hop out here
        if (e && Math.abs(c.v) < 2.5) this.exitCar();
        else if (e) this.hint = 'STOP FIRST';
        return true;
    }

    dispose() {
        const m = this.car && this.car.mesh;
        super.dispose();
        freeOwn(m);
    }

    // ramming the boom barrier at speed smashes through
    onBarrier(c) {
        if (this.cleared) return true;
        if (Math.abs(c.v) < 12) return false;
        this.cleared = true;
        this.op.smashGate(c);
        return true;
    }

    board() {
        super.board();
        this.op.onBoard();
    }
}

export class HeistOp {
    constructor(game) {
        this.game = game;
        this.base = BASES.find(b => b.id === 'miramar');
        this.alarm = false;
        this.pursuers = [];
        this.fleeing = [];
        this.stage = 'town';
        this.result = null;
        this.waves = 0;
        this.tookOffT = -1;
        const jet = game.player;
        // start on the pavement in the town nearest the base, by a road with traffic
        const start = this.startSpot();
        this.ground = new HeistGround(this, jet, start);
        game.groundStart = game.groundStartObj = this.ground;
        const gw = baseToWorld(this.base, this.base.gate.lx + 30, this.base.gate.lz);
        this.gateTarget = new THREE.Vector3(gw.x, this.base.h, gw.z);
        game.navTarget = { pos: start.carHint || this.gateTarget, label: 'GRAB A CAR' };
        game.objective = 'CARJACK A CAR (walk up to one on the road, E)';
        this.sirenT = 0;
    }

    startSpot() {
        const b = this.base, gw = baseToWorld(b, b.gate.lx + 70, b.gate.lz);
        const traffic = this.game.world.towns && this.game.world.towns.traffic;
        // a spot next to a road, 1.5–5 km from the gate, with a car nearby
        let best = null, bd = Infinity;
        if (traffic) for (const c of traffic.cars) {
            if (!c.pos || c.dead || c.path.street === undefined) continue;
            const d = Math.hypot(c.pos.x - gw.x, c.pos.z - gw.z);
            if (d < 1500 || d > 6000) continue;
            if (d < bd) { bd = d; best = c; }
        }
        if (!best && traffic) best = traffic.cars.find(c => c.pos && !c.dead);
        if (!best) return { pos: new THREE.Vector3(gw.x + 1500, 0, gw.z), yaw: 0 };
        const p = best.pos.clone();
        samplePath(best.path, best.s, _v, _v2);
        const side = _v.set(-_v2.z, 0, _v2.x).normalize();
        const pos = p.clone().addScaledVector(side, 9);
        const yaw = Math.atan2(side.x, side.z); // facing the road
        return { pos, yaw, carHint: p };
    }

    onCarjack() {
        if (this.stage !== 'town') return;
        this.stage = 'driving';
        this.game.navTarget = { pos: this.gateTarget, label: 'MIRAMAR MAIN GATE' };
        this.game.objective = 'DRIVE TO MCAS MIRAMAR — RAM THE GATE (FAST!)';
        this.game.showBanner('GRAND THEFT AERO', 'Get to Miramar and crash through the main gate. Faster than 45 km/h or the barrier stops you.', 6, '#ffc23f');
    }

    smashGate(c) {
        const g = this.game;
        g.shake = 1.2;
        g.audio.boom(10, 0.6);
        g.effects.debrisBurst(c.pos, _v.set(0, 6, 0), 5, 0.6);
        const info = g.world.airbases && g.world.airbases.bases.find(i => i.base === this.base);
        if (info) for (const a of info.arms) { a.pivot.visible = false; }
        c.v *= 0.75;
        g.addFeed('SMASHED THROUGH THE GATE!', '#ff4a3d');
        this.raiseAlarm(null);
    }

    raiseAlarm(msg) {
        if (this.alarm) return;
        const g = this.game, b = this.base;
        this.alarm = true;
        if (this.stage === 'town' || this.stage === 'driving') this.stage = 'alarm'; // never regress from 'jet'/'air'
        if (msg) g.addFeed(msg, '#ff9f5a');
        g.showBanner('INTRUDER ALERT', 'Military police are after you — they\'ll ram your car and tackle you. Get to the jet!', 5, '#ff4a3d');
        g.audio.say('Intruder alert! Intruder alert! Lock down the flight line!', true);
        this.ground.cleared = true;
        g.navTarget = { pos: this.game.player.pos, label: 'STEAL THIS JET' };
        g.objective = 'GET TO THE JET — MPs IN PURSUIT';
        // MP Humvees from inside the base and a police car from the gate
        const spots = [[760, -380, 'humvee', 25], [760, -220, 'humvee', 25], [620, -900, 'humvee', 24], [b.gate.lx + 120, b.gate.lz + 20, 'car_police', 33]];
        for (const [lx, lz, id, vmax] of spots) {
            const w = baseToWorld(b, lx, lz);
            const mesh = propInstance(id) || ownMesh(new THREE.BoxGeometry(2.2, 1.8, 4.6), new THREE.MeshStandardMaterial({ color: 0x5b6443 }));
            g.scene.add(mesh);
            // a flashing light bar
            const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
            bar.position.y = id === 'humvee' ? 2.1 : 1.6;
            mesh.add(bar);
            this.pursuers.push({ mesh, bar, pos: new THREE.Vector3(w.x, b.h, w.z), yaw: 0, v: 0, vmax, fireT: rand(1, 3), id, hitT: 0 });
        }
    }

    onBoard() {
        this.stage = 'jet';
        const g = this.game;
        g.objective = 'TAXI AND TAKE OFF — THEY\'RE SHOOTING AT YOU!';
        g.showBanner('YOU\'RE IN!', 'Throttle up and go — taxi to the runway (or just floor it across the grass) and take off!', 5, '#5dffa0');
        if (!this.alarm) this.raiseAlarm(null);
    }

    target() {
        const gs = this.game.groundStart;
        if (gs) return { pos: gs.focus, r: gs.state === 'drive' ? 4.5 : 2.2 };
        const p = this.game.player;
        return { pos: p.pos, r: p.onGround ? 6 : -1 };
    }

    update() {
        const g = this.game;
        const dt = Math.min(0.1, Math.max(0, g.time - (this.lastT ?? g.time)));
        this.lastT = g.time;
        // carjacked drivers running away
        for (let i = this.fleeing.length - 1; i >= 0; i--) {
            const f = this.fleeing[i];
            f.t -= dt;
            f.ch.root.position.addScaledVector(f.dir, 6 * dt);
            f.ch.root.position.y = Math.max(terrainHeight(f.ch.root.position.x, f.ch.root.position.z), 0);
            if (f.t <= 0) { f.ch.dispose(); this.fleeing.splice(i, 1); }
        }
        // entering the base any other way also trips the alarm
        if (!this.alarm && g.groundStart) {
            const l = worldToBase(this.base, g.groundStart.focus.x, g.groundStart.focus.z);
            const F = this.base.fence;
            if (l.lx > F.x0 && l.lx < F.x1 && l.lz > F.z0 && l.lz < F.z1) this.raiseAlarm(null);
        }
        if (this.alarm) this.updatePursuers(dt);
        const gs = g.groundStart;
        if (gs && gs.car && gs.car.wrecked) {
            this.smokeT = (this.smokeT || 0) - dt;
            if (this.smokeT <= 0) { this.smokeT = 0.15; g.effects.puffSmoke(_v.copy(gs.car.pos).setY(gs.car.pos.y + 1), _v2.set(0, 2, 0), 1.2, 0.18, 2.2, 0.5); }
        }
        if (this.alarm && gs && this.stage !== 'jet' && this.stage !== 'air') {
            const status = (gs.state === 'drive' && gs.car.hp != null ? 'CAR ' + Math.max(0, Math.round(gs.car.hp)) + '% · ' : '') + 'YOU ' + Math.max(0, Math.round(gs.hp)) + '%';
            g.objective = (gs.state === 'drive' ? 'GET TO THE JET — MPs IN PURSUIT' : 'RUN TO THE JET — E TO CLIMB IN') + ' · ' + status;
        }
        // after takeoff: interceptors
        const p = g.player;
        if (this.stage === 'jet' && p && p.alive && !p.onGround) {
            const agl = p.pos.y - Math.max(terrainHeight(p.pos.x, p.pos.z), 0);
            if (agl > 40) {
                this.stage = 'air'; this.tookOffT = g.time;
                g.showBanner('AIRBORNE — NOW RUN!', 'Miramar is scrambling interceptors. Get 22 km away, or shoot them all down.', 6, '#ffc23f');
                g.audio.say('Unauthorised departure! Scramble the alert fighters!', true);
                this.scramble(['fa18', 'fa18']);
            }
        }
        if (this.stage === 'air') {
            const d = Math.hypot(p.pos.x - this.base.x, p.pos.z - this.base.z);
            const reds = g.aircraft.filter(a => a.team === 'red' && a.alive && !a.pilotDead);
            if (this.waves < 2 && g.time - this.tookOffT > 50) this.scramble(['f35', 'fa18']);
            g.objective = 'ESCAPE: ' + (d / 1000).toFixed(1) + ' / 22 KM FROM MIRAMAR · INTERCEPTORS: ' + reds.length;
            g.navTarget = null;
            if (d > 22000 || (this.waves >= 2 && reds.length === 0)) this.result = 'win';
        }
        if (p && !p.alive && this.stage !== 'town') this.result = this.result || 'lose';
        // sirens
        if (this.alarm && this.stage !== 'air') {
            this.sirenT -= dt;
            if (this.sirenT <= 0) { this.sirenT = 0.5; this.sirenHi = !this.sirenHi; g.audio.tick(this.sirenHi ? 760 : 560, 0.45, 0.05); }
        }
    }

    scramble(types) {
        const g = this.game, b = this.base;
        this.waves++;
        const e = g.spawnEnemies(types.length, { x: b.x, z: b.z }, types);
        for (const a of e) { a.callsign = 'MIRAMAR ALERT'; if (a.pilot) { a.pilot.home = new THREE.Vector3(b.x, 0, b.z); a.pilot.leash = 30000; } }
        g.addFeed('INTERCEPTORS SCRAMBLED FROM MIRAMAR (' + types.length + ')', '#ff4a3d');
    }

    updatePursuers(dt) {
        const g = this.game;
        const tgt = this.target();
        for (const u of this.pursuers) {
            // drive straight at you, cutting across the grass
            const dx = tgt.pos.x - u.pos.x, dz = tgt.pos.z - u.pos.z, d = Math.hypot(dx, dz);
            const want = Math.atan2(-dx, -dz);
            let dy = want - u.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            u.yaw += clamp(dy, -1.3 * dt, 1.3 * dt);
            u.hitT = Math.max(0, u.hitT - dt);
            const vt = u.hitT > 0.6 ? -5 : d < 12 ? Math.max(6, d) : u.vmax * (Math.abs(dy) > 1 ? 0.5 : 1); // reverse off after a hit
            u.v += clamp(vt - u.v, -10 * dt, 5 * dt);
            u.pos.x += -Math.sin(u.yaw) * u.v * dt;
            u.pos.z += -Math.cos(u.yaw) * u.v * dt;
            u.pos.y = Math.max(terrainHeight(u.pos.x, u.pos.z), 0);
            u.mesh.position.copy(u.pos);
            _e.set(0, u.yaw, 0);
            u.mesh.quaternion.setFromEuler(_e);
            u.bar.material.color.setHex(Math.floor(g.time * 6) % 2 ? 0xff2020 : 0x2040ff);
            // contact: ram the car, tackle you on foot, or bash the jet
            const gs = g.groundStart;
            if (tgt.r > 0 && d < tgt.r + 2 && u.hitT <= 0 && !this.result) {
                u.hitT = 1.8;
                const rel = Math.abs(u.v) + (gs && gs.state === 'drive' ? Math.abs(gs.car.v) * 0.5 : 0);
                u.v = -3;
                if (gs && gs.state === 'drive' && gs.rammed) gs.rammed(u, rel);
                else if (gs && gs.tackled) { u.hitT = 3; if (gs.tackled(u)) this.busted(); } // on foot: each MP needs a moment to come back at you
                else if (g.player && g.player.onGround) { g.player.damage(8 + rel * 0.8, null, 'crash'); g.shake = Math.min(1.6, g.shake + 0.6); g.addFeed('AN MP HUMVEE RAMMED THE JET!', '#ff4a3d'); }
            }
            // on foot: they shoot at you too (not much of a marksman at a run)
            if (gs && gs.state === 'walk' && gs.hp > 0 && d < 70 && d > 5 && !this.result) {
                u.fireT -= dt;
                if (u.fireT <= 0) {
                    u.fireT = rand(1.2, 2.4);
                    const from = _v.copy(u.pos).setY(u.pos.y + 2.2);
                    const dir = _v2.subVectors(gs.walker.pos, from).setY(gs.walker.pos.y + 1.2 - from.y).normalize();
                    dir.x += rand(-0.03, 0.03); dir.z += rand(-0.03, 0.03);
                    g.weapons.bullets.push({ pos: from.clone(), vel: dir.multiplyScalar(700), owner: null, team: 'red', damage: 0, life: 0.5, tracer: true, color: [3.4, 1.0, 0.5] });
                    if (Math.random() < 0.3) { gs.hp -= 7; g.shake = Math.min(1.6, g.shake + 0.25); if (gs.hp <= 0) this.busted(); }
                }
            }
            // shooting at the jet as it taxis and rolls
            if (this.stage === 'jet' && g.player.onGround && d < 160) {
                u.fireT -= dt;
                if (u.fireT <= 0) {
                    u.fireT = rand(0.8, 1.6);
                    const from = _v.copy(u.pos).setY(u.pos.y + 2.2);
                    const dir = _v2.subVectors(g.player.pos, from).normalize();
                    g.weapons.bullets.push({ pos: from.clone(), vel: dir.multiplyScalar(700), owner: null, team: 'red', damage: 0, life: 0.6, tracer: true, color: [3.4, 1.0, 0.5] });
                    if (Math.random() < 0.35) g.player.damage(3, null, 'gun');
                }
            }
        }
    }

    busted() {
        if (this.result) return;
        const g = this.game;
        this.result = 'lose';
        g.showBanner('BUSTED!', 'The MPs got you. Nice try.', 5, '#ff4a3d');
        g.audio.say('Hands where I can see them!', true);
    }

    dispose() {
        for (const u of this.pursuers) {
            this.game.scene.remove(u.mesh);
            u.bar.geometry.dispose(); u.bar.material.dispose();
            freeOwn(u.mesh);
        }
        for (const f of this.fleeing) f.ch.dispose();
        this.pursuers = []; this.fleeing = [];
        // the smashed gate comes back for the next sortie
        const info = this.game.world.airbases && this.game.world.airbases.bases.find(i => i.base === this.base);
        if (info) for (const a of info.arms) { a.pivot.visible = true; a.open = 0; a.pivot.rotation.x = 0; }
    }
}

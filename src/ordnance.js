// ═══════════════════════════════════════════════════════════════
// Ordnance: what the on-foot weapons (arsenal.js) put into the world.
//   • rounds: real bullets (weapons.js) that carry their weapon, so whatever they hit takes the right damage:
//     people (with range and headshots), cars, helicopters and aircraft, soft ground targets; armour and walls
//     stop them. The shotgun fires nine pellets. Muzzle flash, brass, the report (by distance), and soldiers
//     in earshot hear it (infantry.js)
//   • the RPG-7's rocket: a physical projectile (arsenal.js stepRocket) with its backblast, smoke trail and fins;
//     it hits people, cars, trucks, tanks, parked aircraft, helicopters, buildings and the ground, and blows up at
//     the end of its range
//   • grenades: thrown, bounce and roll (arsenal.js stepGrenade), explode on their fuse
//   • explosions: blast and fragments for people and soldiers, wrecked cars, damaged targets and buildings
//   • the weapons of the dead lie where they fall; walking over one takes its ammunition
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { ROCKET, GRENADE, stepRocket, stepGrenade, throwVelocity, scatter, targetClass, weaponDef, explosiveDamage } from './arsenal.js';
import { rocketModel, grenadeModel, weaponModel, caseGeometry } from './weaponmodels.js';
import { AIR_TARGETS, segHitsSphere } from './softtargets.js';
import { segPointDist2, personHitTest } from './pilot.js';
import { terrainHeight } from './world.js';
import { rand } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const _prev = new THREE.Vector3(), _hit = new THREE.Vector3(), _fwd = new THREE.Vector3(0, 0, -1);
const TRACER_BLUE = [3.2, 2.4, 1.2], TRACER_RED = [3.4, 1.0, 0.5];
const RPG_CRATER = { r: 1.3, depth: 0.5, rim: 0.2, scorch: 0.7, reach: 2.6, clods: 4 };
const GRENADE_CRATER = { r: 0.9, depth: 0.3, rim: 0.12, scorch: 0.6, reach: 2.4, clods: 3 };
const MAX_DROPS = 40, MAX_BRASS = 80;

export class Ordnance {
    constructor(game) {
        this.game = game;
        this.rockets = [];
        this.grenades = [];
        this.drops = [];
        this.brass = [];
        this.gnd = { h: 0, nx: 0, ny: 1, nz: 0 };
        // how a grenade meets the world: the drawn ground (with its slope) and building walls
        this.env = {
            ground: (x, z, out) => {
                const g = this.game, h = g.surfaceAt(x, z, 1e9).h;
                const e = 0.6, hx = g.surfaceAt(x + e, z, 1e9).h, hz = g.surfaceAt(x, z + e, 1e9).h;
                const nx = h - hx, nz = h - hz, L = Math.hypot(nx, e, nz);
                out.h = h; out.nx = nx / L; out.ny = e / L; out.nz = nz / L;
                return out;
            },
            solid: (x, y, z) => this.wallNormal(x, y, z),
        };
    }

    // ═════════════ Small arms ═════════════
    // shooter: the player (pilot.js) or a soldier (infantry.js); origin/dir: the line of fire (dir unit);
    // muzzle: where the flash (and the tracer's look) is; spread: cone half-angle (rad)
    fireGun(shooter, def, o) {
        const g = this.game, W = g.weapons;
        const n = def.pellets || 1;
        const col = o.team === 'red' ? TRACER_RED : TRACER_BLUE;
        const carry = o.carry;
        for (let i = 0; i < n; i++) {
            // the shotgun's pattern, the rest their bloom and aim
            const d = scatter(o.dir, o.spread, _v2);
            const start = _v.copy(o.origin);
            if (o.late) start.addScaledVector(d, o.late * def.velocity);
            const vel = _v3.copy(d).multiplyScalar(def.velocity);
            if (carry) vel.add(carry);
            const b = W.newBullet(start, vel, shooter, def.vs.aircraft || 0.5, def.life, !!o.tracer && i === 0, col);
            b.small = true; b.def = def;
            (b.from || (b.from = new THREE.Vector3())).copy(o.origin);
        }
        // flash, brass, the report
        const cam = g.camera.position;
        const dist = o.muzzle ? o.muzzle.distanceTo(cam) : o.origin.distanceTo(cam);
        if (o.muzzle && def.flash && dist < 900) {
            g.effects.fire.emit(o.muzzle, carry || _v.set(0, 0, 0), 0.05, 0.25 + def.flash * 0.25, 0.1, [4, 3, 1.6], [2, 1, 0.3], 1, 0, 0, 0);
            if (def.pellets || def.id === 'deagle') g.effects.smoke.emit(o.muzzle, _v.copy(o.dir).multiplyScalar(3), rand(0.6, 1), 0.2, 0.9, [0.6, 0.6, 0.6], [0.7, 0.7, 0.7], 0.3, 0, 1, 0.5);
        }
        if (o.muzzle && dist < 45 && shooter !== g.pilotMode || (shooter === g.pilotMode && g.pilotMode && g.pilotMode.thirdPerson && o.muzzle)) this.ejectBrass(o.muzzle, o.dir, def);
        if (g.audio.gunfire) g.audio.gunfire(def.id, shooter === g.pilotMode ? 0 : dist, this.pan(o.origin));
        else if (shooter === g.pilotMode && g.audio.gunshot) g.audio.gunshot();
        if (g.infantry) g.infantry.noise(o.origin, def.noise, shooter, o.team);
        g.events.emit('smallArms', shooter, { def });
    }

    // stereo position of a world point for a one-shot (-1 left … 1 right)
    pan(p) {
        const cam = this.game.camera, e = cam.matrixWorldInverse.elements;
        const x = e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12], z = e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14];
        return Math.max(-1, Math.min(1, x / Math.max(Math.hypot(x, z), 1)));
    }

    ejectBrass(at, dir, def) {
        const g = this.game;
        let c = this.brass.find(x => x.life <= 0);
        const kind = def.fire === 'pump' ? 'shell' : 'case';
        if (!c) {
            if (this.brass.length >= MAX_BRASS) return;
            const cg = caseGeometry(kind);
            const m = new THREE.Mesh(cg.geo, cg.mat);
            m.castShadow = false;
            g.scene.add(m);
            c = { mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, kind };
            this.brass.push(c);
        }
        if (c.kind !== kind) { const cg = caseGeometry(kind); c.mesh.geometry = cg.geo; c.mesh.material = cg.mat; c.kind = kind; }
        // out to the right of the line of fire
        const right = _v.set(-dir.z, 0, dir.x).normalize();
        c.mesh.position.copy(at).addScaledVector(dir, -0.35).addScaledVector(right, 0.05);
        c.vel.copy(right).multiplyScalar(rand(2.5, 4)).add(_v2.set(0, rand(1.5, 2.8), 0)).addScaledVector(dir, rand(-1, 0));
        c.spin.set(rand(-20, 20), rand(-20, 20), rand(-20, 20));
        c.life = 3;
        c.rest = false;
        c.mesh.visible = true;
    }

    // ═════════════ The RPG-7 ═════════════
    launchRocket(shooter, o) {
        const g = this.game;
        const mesh = rocketModel();
        mesh.position.copy(o.origin);
        g.scene.add(mesh);
        const vel = new THREE.Vector3().copy(o.dir).normalize().multiplyScalar(ROCKET.launch);
        if (o.carry) vel.add(o.carry);
        const r = { mesh, pos: mesh.position, vel, age: 0, dist: 0, owner: shooter, team: o.team, puff: 0, lit: false };
        mesh.quaternion.setFromUnitVectors(_fwd, _v.copy(vel).normalize());
        this.rockets.push(r);
        // the launch: the booster's bang, a jet of smoke and flame out of the back, dust kicked up behind
        const fx = g.effects, back = _v2.copy(o.dir).negate();
        const rear = _v3.copy(o.origin).addScaledVector(back, 1.0);
        fx.fire.emit(o.origin, _v.copy(o.dir).multiplyScalar(8), 0.08, 0.8, 0.4, [5, 4, 2], [2, 1, 0.3], 1, 0, 0, 0);
        for (let i = 0; i < 14; i++) {
            const s = rand(8, 30);
            fx.smoke.emit(rear, _v.copy(back).multiplyScalar(s).add(_v.set(rand(-2, 2), rand(-1, 2), rand(-2, 2)).multiplyScalar(1 + s * 0.1)), rand(1.5, 3.5), rand(0.4, 0.8), rand(3, 5), [0.72, 0.7, 0.66], [0.8, 0.78, 0.75], 0.55, 0, 2.2, 0.5, 0, 0.5, 0.8);
        }
        for (let i = 0; i < 4; i++) fx.fire.emit(rear, _v.copy(back).multiplyScalar(rand(20, 45)), rand(0.06, 0.12), 0.6, 1.4, [4, 2.6, 1.2], [1.5, 0.5, 0.1], 0.9, 0, 0, 0);
        const gh = g.surfaceAt(rear.x, rear.z, rear.y + 2).h;
        if (rear.y - gh < 3) fx.dustBurst(_v.set(rear.x, gh + 0.3, rear.z), 0.35, 0.8);
        g.audio.rocketLaunch ? g.audio.rocketLaunch(g.camera.position.distanceTo(o.origin)) : g.audio.whoosh(0.6);
        if (g.infantry) g.infantry.noise(o.origin, 450, shooter, o.team);
        // backblast: people in the cone behind the launcher
        if (o.backblast) this.backblast(o.origin, back, shooter, o.team);
        g.events.emit('rpgLaunch', shooter, { rocket: r });
        return r;
    }

    backblast(at, back, source, team) {
        const g = this.game, B = weaponDef('rpg7').backblast;
        const hurt = (p) => {
            const d = _v.subVectors(p, at), L = d.length();
            if (L > B.len || L < 0.5) return 0;
            const cos = d.dot(back) / L;
            if (cos < Math.cos(B.cone)) return 0;
            return B.damage * (1 - L / B.len);
        };
        if (g.infantry) g.infantry.forEachNear(at, B.len, (s) => { const dmg = hurt(s.pos); if (dmg > 0) s.damage(dmg * (s.team === team ? 0.5 : 1), source, 'blast', at); });
    }

    updateRockets(dt) {
        const g = this.game, fx = g.effects;
        for (let i = this.rockets.length - 1; i >= 0; i--) {
            const r = this.rockets[i];
            _prev.copy(r.pos);
            stepRocket(r, dt);
            const dir = _v.copy(r.vel).normalize();
            r.mesh.quaternion.setFromUnitVectors(_fwd, dir);
            // the sustainer's flame and the smoke trail (puffs close together near the camera)
            const burning = r.age > ROCKET.ignite && r.age < ROCKET.ignite + ROCKET.burn + 0.15;
            r.puff -= dt * r.vel.length();
            while (r.puff <= 0) {
                r.puff += burning ? 0.9 : 1.6;
                const t = rand(0, 1), p = _v2.lerpVectors(_prev, r.pos, t).addScaledVector(dir, -0.55);
                fx.smoke.emit(p, _v3.set(rand(-0.5, 0.5), rand(0, 0.8), rand(-0.5, 0.5)), rand(2.5, 4), 0.35, rand(2.2, 3.4), [0.74, 0.73, 0.7], [0.84, 0.83, 0.8], 0.5, 0, 1.4, 0.3, 0, 0.5, 0.6);
            }
            if (burning) fx.fire.emit(_v2.copy(r.pos).addScaledVector(dir, -0.6), _v3.copy(r.vel).multiplyScalar(0.3), 0.05, 0.55, 0.2, [5, 3.6, 1.6], [2, 0.8, 0.2], 1, 0, 0, 0);
            // what it hits on the way
            const armed = r.dist > ROCKET.arm;
            const hit = armed ? this.rocketHit(r, _prev, r.pos) : null;
            if (hit || r.age > ROCKET.selfDestruct) {
                const at = hit ? hit.at : r.pos;
                this.explode(at, 'rocket', r.owner, r.team, { direct: hit && hit.target, targetKind: hit && hit.kind, vel: r.vel, water: hit && hit.kind === 'water' });
                g.scene.remove(r.mesh);
                this.rockets.splice(i, 1);
            }
        }
    }

    // the first thing on the segment a → b a rocket runs into: { at, kind, target } or null
    rocketHit(r, a, b) {
        const g = this.game, team = r.team;
        let best = null, bt = 2;
        const consider = (t, kind, target) => { if (t < bt) { bt = t; best = { kind, target }; } };
        const seg = _v3.subVectors(b, a), L = seg.length();
        if (L < 1e-6) return null;
        // soldiers and the player on foot
        if (g.infantry) { const h = g.infantry.segmentHit(a, b, 0.35, r.owner); if (h) consider(h.t, 'soldier', h.soldier); }
        const pm = g.pilotMode;
        if (pm && pm.alive && pm !== r.owner && pm.walker && personHitTest(a, b, pm.feet(_v))) consider(this.closestT(a, seg, pm.pos), 'player', pm);
        // aircraft (flying, taxiing, parked)
        for (const ac of g.aircraft) {
            if (!ac.alive || ac.team === team || ac === r.owner) continue;
            if (Math.abs(ac.pos.x - a.x) > 60 + L || Math.abs(ac.pos.z - a.z) > 60 + L) continue;
            if (segPointDist2(a, b, ac.pos) < (ac.hitRadius * 0.6) ** 2) consider(this.closestT(a, seg, ac.pos), 'aircraft', ac);
        }
        for (const t of AIR_TARGETS) {
            if (!t.alive || Math.abs(t.pos.x - a.x) > 40 + L || Math.abs(t.pos.z - a.z) > 40 + L) continue;
            if (segHitsSphere(a, b, t.pos, t.radius * 0.7)) consider(this.closestT(a, seg, t.pos), 'air', t);
        }
        if (g.ground) for (const t of g.ground.targets) {
            if (!t.alive || t.isBridge || t.team === team) continue;
            if (Math.abs(t.pos.x - a.x) > t.radius + 30 + L || Math.abs(t.pos.z - a.z) > t.radius + 30 + L) continue;
            let hit = false;
            if (t.hitTest) { for (let k = 1; k <= 4 && !hit; k++) hit = t.hitTest(_v.lerpVectors(a, b, k / 4)); }
            else hit = segPointDist2(a, b, t.center || t.pos) < (t.radius * 0.8) ** 2;
            if (hit) consider(this.closestT(a, seg, t.pos), 'target', t);
        }
        // cars in the traffic (and parked)
        const towns = g.world.towns;
        if (towns && towns.traffic) {
            for (let k = 1; k <= 6; k++) {
                const p = _v.lerpVectors(a, b, k / 6);
                const c = towns.traffic.carAt ? towns.traffic.carAt(p, 1.0) : null;
                if (c) { consider(k / 6, 'car', c); break; }
            }
        }
        // buildings, then the ground and the sea
        const bl = towns && towns.buildings;
        if (bl && Math.min(a.y, b.y) < bl.maxTop) {
            const n = Math.max(2, Math.ceil(L / 1.5));
            for (let k = 1; k <= n; k++) { const t = k / n, p = _v.lerpVectors(a, b, t); const hb = bl.at(p.x, p.y, p.z); if (hb) { consider(t, 'building', hb); break; } }
        }
        const sb = g.surfaceAt(b.x, b.z, b.y + 1);
        if (b.y < sb.h) {
            // bisect for where it met the surface
            let lo = 0, hi = 1;
            for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2, p = _v.lerpVectors(a, b, m); if (p.y < g.surfaceAt(p.x, p.z, p.y + 1).h) hi = m; else lo = m; }
            consider(hi, sb.water ? 'water' : 'ground', null);
        }
        if (!best) return null;
        best.at = _hit.lerpVectors(a, b, bt);
        return best;
    }

    closestT(a, seg, c) {
        const L2 = seg.lengthSq();
        return L2 > 0 ? Math.max(0, Math.min(1, ((c.x - a.x) * seg.x + (c.y - a.y) * seg.y + (c.z - a.z) * seg.z) / L2)) : 0;
    }

    // ═════════════ Grenades ═════════════
    throwGrenade(shooter, o) {
        const g = this.game;
        const w = grenadeModel();
        const mesh = w.root;
        mesh.position.copy(o.origin);
        g.scene.add(mesh);
        const vel = o.vel ? o.vel.clone() : throwVelocity(o.dir, new THREE.Vector3(), o.carry);
        const gr = { mesh, pos: mesh.position, vel, fuse: o.fuse ?? GRENADE.fuse, rest: false, bounces: 0, owner: shooter, team: o.team, spin: new THREE.Vector3(rand(-12, 12), rand(-6, 6), rand(-12, 12)) };
        this.grenades.push(gr);
        // the spoon flies off
        if (w.parts.spoon) {
            const spoon = w.parts.spoon;
            spoon.updateWorldMatrix(true, false);
            g.scene.attach(spoon);
            g.effects.throwPart(spoon, _v.set(rand(-2, 2), rand(2, 4), rand(-2, 2)).add(vel.clone().multiplyScalar(0.3)), 12, false);
        }
        g.audio.grenadeThrow && g.audio.grenadeThrow();
        g.events.emit('grenadeThrown', shooter, { grenade: gr });
        return gr;
    }

    updateGrenades(dt) {
        const g = this.game;
        for (let i = this.grenades.length - 1; i >= 0; i--) {
            const gr = this.grenades[i];
            const wasRest = gr.rest;
            const bounces = stepGrenade(gr, dt, this.env);
            if (bounces && g.audio.grenadeBounce) g.audio.grenadeBounce(g.camera.position.distanceTo(gr.pos));
            if (!gr.rest) { gr.mesh.rotation.x += gr.spin.x * dt; gr.mesh.rotation.y += gr.spin.y * dt; gr.mesh.rotation.z += gr.spin.z * dt; gr.spin.multiplyScalar(Math.exp(-dt * (gr.bounces ? 2 : 0.2))); }
            else if (!wasRest) { gr.mesh.rotation.x = Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1); gr.mesh.rotation.z = rand(-0.3, 0.3); }
            // soldiers see one land near them and run from it (infantry.js)
            if (g.infantry && (gr.bounces || gr.rest) && !gr.warned) { gr.warned = true; g.infantry.grenadeWarning(gr.pos, gr.team); }
            if (gr.fuse <= 0) {
                const s = g.surfaceAt(gr.pos.x, gr.pos.z, gr.pos.y + 1);
                this.explode(_v.copy(gr.pos), 'grenade', gr.owner, gr.team, { water: s.water && gr.pos.y < 0.3 });
                g.scene.remove(gr.mesh);
                this.grenades.splice(i, 1);
            }
        }
    }

    // a building wall at (x, y, z): its outward normal (horizontal) there, or null
    wallNormal(x, y, z) {
        const bl = this.game.world.towns && this.game.world.towns.buildings;
        if (!bl || y > bl.maxTop) return null;
        const b = bl.at(x, y, z);
        if (!b) return null;
        const q = b.boxes ? b.boxes.find(q => y < q.y1 && y > q.y0 && bl.inside(q, x, z)) || b : b;
        const dx = x - q.x, dz = z - q.z;
        const u = dx * q.c - dz * q.s, v = dx * q.s + dz * q.c; // building-local (see buildings.js inside())
        const pu = q.w / 2 - Math.abs(u), pv = q.d / 2 - Math.abs(v);
        // the face it's closest to; local x → (c, -s), local z → (s, c) in world
        if (pu < pv) { const sg = Math.sign(u) || 1; return { x: q.c * sg, z: -q.s * sg }; }
        const sg = Math.sign(v) || 1;
        return { x: q.s * sg, z: q.c * sg };
    }

    // ═════════════ Explosions ═════════════
    // kind 'rocket' | 'grenade'; direct: what it hit (target / car / aircraft / soldier), for the full HEAT effect
    explode(where, kind, source, team, o = {}) {
        const g = this.game, fx = g.effects;
        const at = where.clone(); // (callers pass shared temporaries, which the effects below reuse)
        const D = kind === 'rocket' ? ROCKET : GRENADE, B = D.blast;
        const s = g.surfaceAt(at.x, at.z, at.y + 1);
        const low = at.y - s.h < 1.5;
        const camD = g.camera.position.distanceTo(at);
        // the look and sound
        // in the water: an RPG bursts on the surface, a grenade sinks a metre or two and throws up a neat little column
        if (o.water) {
            if (fx.water) fx.water.blast(_v.set(at.x, 0, at.z), { kg: kind === 'rocket' ? 0.73 : 0.18, depth: kind === 'rocket' ? 'contact' : 'optimal', agl: 0, sound: 'hiss' });
            else { fx.waterSplash(_v.set(at.x, 0.3, at.z), kind === 'rocket' ? 0.8 : 0.5); fx.explosion(at, 0.35); }
        }
        else {
            fx.explosion(at, kind === 'rocket' ? 0.72 : 0.5, o.vel ? _v2.copy(o.vel).multiplyScalar(0.05) : null);
            if (low) {
                fx.dustBurst(_v.set(at.x, s.h + 0.3, at.z), kind === 'rocket' ? 0.55 : 0.4, 1);
                if (!s.ship && !s.bridge && !s.runway) g.weapons.addCrater(_v.set(at.x, s.h, at.z), kind === 'rocket' ? RPG_CRATER : GRENADE_CRATER, o.vel || null, { quiet: true });
            }
            // fragments
            for (let i = 0; i < (kind === 'rocket' ? 18 : 26); i++) {
                _v.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(rand(40, 110));
                fx.sparks.emit(at, _v, rand(0.15, 0.4), 0.3, 0.1, [2.6, 1.8, 0.8], [1.4, 0.5, 0.1], 1, 0, 0.4, -15, 0, 0.5, 1, 0.02);
            }
        }
        g.audio.boom(camD, kind === 'rocket' ? 1.15 : 0.85);
        if (camD < 120) g.shake = Math.min(1.5, g.shake + (120 - camD) / (kind === 'rocket' ? 90 : 130));
        if (g.infantry) g.infantry.noise(at, D.noise, source, team, true);
        // people: the player (his own blast too), enemy pilots on the ground, soldiers
        const pm = g.pilotMode;
        if (pm && pm.alive && (team !== 'blue' || source === pm)) pm.blast(at, B.R, B.peak * (source === pm ? 0.8 : 1));
        if (team !== 'red') g.weapons.blastPeople(at, B.R, B.peak, source, 'blue', { soldiers: false }); // enemy pilots on the ground
        if (g.infantry) g.infantry.blast(at, B, source, team, o.direct && o.targetKind === 'soldier' ? o.direct : null);
        // vehicles in the traffic and parked: a rocket wrecks what it hits, the blast what's near
        const towns = g.world.towns;
        if (towns && towns.traffic) towns.traffic.blast(at, kind === 'rocket' ? 2.2 : 0.4, g, source);
        // ground targets: HEAT on a direct hit, blast damage near it (arsenal.js explosiveDamage)
        const V = D.vs;
        if (g.ground) for (const t of g.ground.targets) {
            if (!t.alive || t.team === team || t.isBridge) continue;
            const cls = targetClass(t);
            if (t === o.direct) { t.damage(explosiveDamage(D, cls, true), source, kind); continue; }
            const dd = t.distTo ? t.distTo(at) : t.pos.distanceTo(at) - t.radius * 0.7;
            const dmg = explosiveDamage(D, cls, false, dd);
            if (dmg > 0) t.damage(dmg, source, kind);
        }
        // aircraft on the ground (and a direct hit on one flying low), helicopters
        for (const ac of g.aircraft) {
            if (!ac.alive || ac.team === team) continue;
            const d = ac.pos.distanceTo(at) - ac.hitRadius * 0.4;
            if (ac === o.direct) ac.damage(V.aircraft, source, kind);
            else if (d < 8) ac.damage(V.aircraft * 0.5 * (1 - Math.max(0, d) / 8), source, kind);
        }
        for (const t of AIR_TARGETS) {
            if (!t.alive) continue;
            const d = t.pos.distanceTo(at) - t.radius * 0.5;
            if (t === o.direct) g.weapons.hitAir(t, V.aircraft, source);
            else if (d < 8) g.weapons.hitAir(t, V.aircraft * 0.5 * (1 - Math.max(0, d) / 8), source);
        }
        // buildings (the town's and the airbases': hangars, towers, parked aircraft)
        const bl = towns && towns.buildings;
        if (bl) bl.explode(at, V.building.R, V.building.amount, g, source);
        else if (towns && towns.panic) towns.panic(at, B.R * 0.5);
        g.events.emit('ordnanceExplode', source, { at, kind });
    }

    // ═════════════ Dropped weapons ═════════════
    // a weapon falling out of a character's hands (or from a point): it tumbles to the ground and lies there
    dropWeapon(from, id, rounds) {
        const g = this.game;
        const w = weaponModel(id, { lod: 1 });
        const m = w.root;
        if (from && from.weapon && from.weapon.root.parent) {
            from.weapon.root.updateWorldMatrix(true, false);
            from.weapon.root.matrixWorld.decompose(m.position, m.quaternion, _v);
        } else if (from && from.isVector3) m.position.copy(from).y += 1;
        else if (from && from.root) m.position.copy(from.root.position).y += 1.1;
        m.scale.set(1, 1, 1);
        g.scene.add(m);
        const d = { mesh: m, id, rounds: Math.max(0, rounds | 0), pos: m.position, vel: new THREE.Vector3(rand(-1, 1), rand(0.5, 1.5), rand(-1, 1)), spin: new THREE.Vector3(rand(-4, 4), rand(-2, 2), rand(-4, 4)), rest: false, t: 0 };
        this.drops.push(d);
        if (this.drops.length > MAX_DROPS) { const old = this.drops.shift(); g.scene.remove(old.mesh); }
        return d;
    }

    pickupNear(p, r) {
        for (const d of this.drops) {
            if (d.rounds <= 0 || !d.rest) continue;
            if (Math.abs(d.pos.x - p.x) < r && Math.abs(d.pos.z - p.z) < r && Math.abs(d.pos.y - p.y) < 2.5) return d;
        }
        return null;
    }

    updateDrops(dt) {
        const g = this.game;
        for (const d of this.drops) {
            if (d.rest) continue;
            d.t += dt;
            d.vel.y -= 9.81 * dt;
            d.pos.addScaledVector(d.vel, dt);
            d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
            const h = g.surfaceAt(d.pos.x, d.pos.z, d.pos.y + 1).h;
            if (d.pos.y < h + 0.04) {
                d.pos.y = h + 0.04;
                if (d.vel.y < -3) { d.vel.y *= -0.25; d.vel.x *= 0.5; d.vel.z *= 0.5; d.spin.multiplyScalar(0.4); g.audio.clatter && g.audio.clatter(g.camera.position.distanceTo(d.pos)); }
                else {
                    // lying flat on its side
                    d.rest = true;
                    _v.set(0, 0, -1).applyQuaternion(d.mesh.quaternion).setY(0);
                    const yaw = _v.lengthSq() > 1e-4 ? Math.atan2(-_v.x, -_v.z) : rand(0, 6.28);
                    d.mesh.rotation.set(0, yaw, Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1), 'YXZ');
                    d.pos.y = h + 0.03;
                }
            }
        }
    }

    updateBrass(dt) {
        const g = this.game;
        for (const c of this.brass) {
            if (c.life <= 0) continue;
            c.life -= dt;
            if (c.life <= 0) { c.mesh.visible = false; continue; }
            if (c.rest) continue;
            c.vel.y -= 9.81 * dt;
            c.mesh.position.addScaledVector(c.vel, dt);
            c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
            const h = terrainHeight(c.mesh.position.x, c.mesh.position.z);
            if (c.mesh.position.y < h + 0.01) {
                if (c.vel.y < -2) { c.vel.y *= -0.3; c.vel.x *= 0.5; c.vel.z *= 0.5; }
                else { c.rest = true; c.mesh.position.y = g.surfaceAt(c.mesh.position.x, c.mesh.position.z, c.mesh.position.y + 1).h + 0.006; c.mesh.rotation.set(0, rand(0, 6), Math.PI / 2); }
            }
        }
    }

    update(dt) {
        if (this.rockets.length) this.updateRockets(dt);
        if (this.grenades.length) this.updateGrenades(dt);
        if (this.drops.length) this.updateDrops(dt);
        if (this.brass.length) this.updateBrass(dt);
    }

    clear() {
        const sc = this.game.scene;
        for (const r of this.rockets) sc.remove(r.mesh);
        for (const gr of this.grenades) sc.remove(gr.mesh);
        for (const d of this.drops) sc.remove(d.mesh);
        for (const c of this.brass) { c.life = 0; c.mesh.visible = false; }
        this.rockets = []; this.grenades = []; this.drops = [];
    }
}
void _q;

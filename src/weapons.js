// ═══════════════════════════════════════════════════════════════
// Weapons: cannon rounds, guided missiles (proportional navigation), flares
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { rand, clamp, segPointDistSq, G, makeRadialTexture } from './util.js';
import { terrainHeight } from './world.js';
import { AIR_TARGETS, segHitsSphere } from './softtargets.js';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _prev = new THREE.Vector3();
const GUN_BLUE = [3.2, 2.6, 1.2], GUN_RED = [3.4, 1.0, 0.5], FLAK_COLOR = [3.6, 1.2, 0.5];

const flareTex = makeRadialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,240,200,0.9)'], [0.4, 'rgba(255,180,80,0.35)'], [1, 'rgba(255,120,40,0)']]);

export class Weapons {
    constructor(game) {
        this.game = game;
        this.bullets = [];
        this.missiles = [];
        this.flares = [];
        this.bombs = [];
        this.craters = [];
        this.bombGeo = (() => {
            const g = new THREE.Group();
            const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.6, 4, 10), new THREE.MeshStandardMaterial({ color: 0x5d6650, roughness: 0.6 }));
            body.rotation.x = Math.PI / 2;
            const fins = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.04), new THREE.MeshStandardMaterial({ color: 0x4d5543 }));
            fins.position.z = 0.9;
            const fins2 = fins.clone(); fins2.rotation.z = Math.PI / 4;
            g.add(body, fins, fins2);
            return g;
        })();
        this.craterTex = makeRadialTexture(128, [[0, 'rgba(20,16,12,0.95)'], [0.45, 'rgba(35,28,20,0.85)'], [0.7, 'rgba(60,50,38,0.4)'], [1, 'rgba(60,50,38,0)']]);
        this.craterGeo = new THREE.CircleGeometry(1, 20);
        this.craterMat = new THREE.MeshBasicMaterial({ map: this.craterTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: true });
        this.bulletPool = []; // spent round objects, reused by fireGun / fireFlak
        this.missileGeo = (() => {
            const g = new THREE.CylinderGeometry(0.1, 0.1, 3, 8);
            g.rotateX(Math.PI / 2);
            return g;
        })();
        this.missileMat = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.45, metalness: 0.3 });
        this.rocketGeo = (() => {
            const g = new THREE.CylinderGeometry(0.07, 0.07, 1.8, 6);
            g.rotateX(Math.PI / 2);
            return g;
        })();
        this.samGeo = (() => {
            const g = new THREE.CylinderGeometry(0.22, 0.22, 5.5, 8);
            g.rotateX(Math.PI / 2);
            return g;
        })();
        this.flareMat = new THREE.SpriteMaterial({ map: flareTex, color: new THREE.Color(6, 4.5, 2.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    }

    // ── Cannon ──
    fireGun(ac, now) {
        const gun = ac.spec.gun;
        if (!gun || !ac.alive || ac.ammo <= 0) return false;
        if (now - ac.lastGun < 1 / gun.rate) return false;
        ac.lastGun = now;
        ac.ammo--;
        const fwd = ac.getForward(_v1);
        const spread = ac.isPlayer || ac.team === 'blue' && !ac.pilot ? 0.0035 : 0.008 + (1 - (ac.pilot?.skill ?? 1)) * 0.02;
        const dir = _v2.copy(fwd).add(_v3.set(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread))).normalize();
        const muzzle = _v3.copy(ac.pos).addScaledVector(fwd, ac.spec.length * 0.5);
        const vel = dir.multiplyScalar(WEAPONS.bulletSpeed).add(ac.vel);
        const b = this.newBullet(muzzle, vel, ac, gun.damage, WEAPONS.bulletLife, ac.ammo % 3 !== 0, ac.team === 'blue' ? GUN_BLUE : GUN_RED);
        b.flak = false;
        this.game.events.emit('gunfire', ac);
        // muzzle flash
        this.game.effects.fire.emit(muzzle, ac.vel, 0.05, 1.8, 0.6, [6, 5, 3], [3, 1.5, 0.5], 1, 0, 0, 0);
        return true;
    }

    // Flak / AAA rounds from ground units
    fireFlak(pos, dir, owner, damage = 6, speed = 900, fuse = rand(1.2, 2.8)) {
        const b = this.newBullet(pos, _v4.copy(dir).multiplyScalar(speed), owner, damage, Math.min(3, isFinite(fuse) ? fuse + 0.1 : 2.2), true, FLAK_COLOR);
        b.flak = isFinite(fuse); b.fuse = fuse;
    }

    // a round from the pool (or a new one), pushed onto the live list
    newBullet(pos, vel, owner, damage, life, tracer, color) {
        const b = this.bulletPool.pop() || { pos: new THREE.Vector3(), vel: new THREE.Vector3(), pooled: true };
        b.pos.copy(pos); b.vel.copy(vel);
        b.owner = owner; b.team = owner.team; b.damage = damage; b.life = life; b.tracer = tracer; b.color = color;
        b.flak = false; b.fuse = 0;
        this.bullets.push(b);
        return b;
    }

    updateBullets(dt) {
        const g = this.game;
        const list = this.bullets;
        for (let i = list.length - 1; i >= 0; i--) {
            const b = list[i];
            b.life -= dt;
            _prev.copy(b.pos);
            b.vel.y -= G * dt * 0.5;
            b.pos.addScaledVector(b.vel, dt);
            let dead = b.life <= 0;
            if (!dead) {
                // aircraft hits (segment test against each enemy)
                for (const ac of g.aircraft) {
                    if (!ac.alive || ac.team === b.team || b.damage <= 0) continue;
                    const r = ac.hitRadius;
                    if (Math.abs(ac.pos.x - b.pos.x) > 80 || Math.abs(ac.pos.z - b.pos.z) > 80) continue;
                    // test in target's frame: shift the segment by target displacement this frame
                    _v1.copy(_prev).addScaledVector(ac.vel, dt);
                    if (segPointDistSq(_v1, b.pos, ac.pos) < r * r) {
                        ac.damage(b.damage, b.owner, 'gun');
                        g.effects.impact(b.pos, ac.vel);
                        g.events.emit('bulletHit', b.owner, { target: ac });
                        dead = true;
                        break;
                    }
                }
            }
            if (!dead && g.ground) {
                for (const t of g.ground.targets) {
                    if (!t.alive || t.team === b.team || b.damage <= 0) continue;
                    if (t.hitTest ? t.hitTest(b.pos) : segPointDistSq(_prev, b.pos, t.center) < t.radius * t.radius) {
                        t.damage(b.damage, b.owner);
                        g.effects.impact(b.pos, null);
                        g.events.emit('bulletHit', b.owner, { target: t });
                        dead = true;
                        break;
                    }
                }
            }
            if (!dead && b.damage > 0) dead = this.worldBulletHit(b, _prev);
            if (!dead && b.team === 'red' && b.damage > 0 && g.pilotMode && g.pilotMode.alive) {
                const head = g.pilotMode.headPos(_v1);
                if (segPointDistSq(_prev, b.pos, head) < 2.4 * 2.4) { g.pilotMode.takeHit(b.damage * 2.5); dead = true; }
            }
            if (!dead && b.flak) {
                b.fuse -= dt;
                if (b.fuse <= 0) {
                    // airburst: damages anything close
                    g.effects.fire.emit(b.pos, _v1.set(0, 0, 0), 0.15, 4, 10, [6, 4, 2], [2, 1, 0.3], 1, 0, 0, 0);
                    g.effects.smoke.emit(b.pos, _v1.set(0, 1, 0), 2.5, 5, 14, [0.08, 0.08, 0.08], [0.2, 0.2, 0.2], 0.8, 0, 1, 0);
                    for (const ac of g.aircraft) {
                        if (ac.alive && ac.team !== b.team && ac.pos.distanceToSquared(b.pos) < 45 * 45) ac.damage(b.damage, b.owner, 'flak');
                    }
                    dead = true;
                }
            }
            if (!dead && b.pos.y < 3000) {
                const h = terrainHeight(b.pos.x, b.pos.z);
                if (b.pos.y < h || b.pos.y < 0) {
                    if (b.pos.y < 0 && h < 0) g.effects.smoke.emit(b.pos, _v1.set(0, 18, 0), 0.7, 1, 4, [0.9, 0.95, 1], [0.8, 0.85, 0.9], 0.7, 0, 1, -20);
                    else g.effects.groundImpact(b.pos);
                    dead = true;
                }
            }
            if (dead) {
                list[i] = list[list.length - 1]; list.pop();
                if (b.pooled && this.bulletPool.length < 4000) { b.owner = null; this.bulletPool.push(b); }
            }
        }
        g.effects.drawTracers(list, g.camera.position);
    }

    // ── Missiles ──
    fireMissile(ac, target, kind = 'aam') {
        if (ac.alive === false) return null;
        const W = kind === 'sam' ? WEAPONS.sam : kind === 'lrm' ? WEAPONS.lrm : kind === 'rkt' ? WEAPONS.rkt : WEAPONS.missile;
        const fwd = ac.getForward ? ac.getForward(_v1) : _v1.copy(ac.launchDir);
        const pos = _v2.copy(ac.pos);
        if (ac.getUp) {
            // drop from a rail under the wing
            const side = (ac.missileSide = -(ac.missileSide || 1));
            pos.addScaledVector(ac.getRight(_v3), side * ac.rig.halfSpan * (kind === 'rkt' ? 0.25 : 0.35)).addScaledVector(ac.getUp(_v4), -1.5);
            if (kind === 'rkt') fwd.add(_v3.set(rand(-0.012, 0.012), rand(-0.012, 0.012), rand(-0.012, 0.012))).normalize();
        }
        const mesh = new THREE.Mesh(kind === 'sam' ? this.samGeo : kind === 'rkt' ? this.rocketGeo : this.missileGeo, this.missileMat);
        if (kind === 'lrm') mesh.scale.set(1.25, 1.25, 1.25);
        mesh.position.copy(pos);
        mesh.castShadow = true;
        this.game.scene.add(mesh);
        const vel = (ac.vel ? ac.vel.clone() : new THREE.Vector3()).addScaledVector(fwd, kind === 'sam' ? 60 : kind === 'rkt' ? 120 : 15);
        if (ac.getUp && kind !== 'rkt') vel.addScaledVector(ac.getUp(_v4), -6);
        const m = {
            mesh, pos: mesh.position, vel, target, owner: ac, team: ac.team, kind, W,
            life: W.life, age: 0, armed: false, lost: false,
            trail: this.game.effects.addTrail({ max: 220, width: kind === 'sam' ? 1.0 : kind === 'rkt' ? 0.6 : 1.1, life: kind === 'sam' ? 7 : kind === 'rkt' ? 2 : 5.5, color: [0.92, 0.92, 0.9], alpha: 0.5, minDist: 10, widthGrow: 2.2 }),
            fireT: 0,
        };
        this.missiles.push(m);
        if (target && target.incoming) target.incoming.push(m);
        this.game.events.emit('missileLaunch', ac, { missile: m, target });
        return m;
    }

    removeMissile(i) {
        const m = this.missiles[i];
        this.game.scene.remove(m.mesh);
        m.trail.emitting = false;
        if (m.target && m.target.incoming) {
            const k = m.target.incoming.indexOf(m);
            if (k >= 0) m.target.incoming.splice(k, 1);
        }
        this.missiles.splice(i, 1);
    }

    updateMissiles(dt) {
        const g = this.game, fx = g.effects;
        for (let i = this.missiles.length - 1; i >= 0; i--) {
            const m = this.missiles[i];
            const W = m.W;
            m.life -= dt;
            m.age += dt;
            const speed = m.vel.length();
            const dir = _v1.copy(m.vel).divideScalar(Math.max(speed, 1));
            // motor
            if ((W.unguided || m.age > 0.25) && m.age < W.boost + 0.25) m.vel.addScaledVector(dir, W.accelBoost * dt);
            // drag (thinner up high)
            const rho = Math.exp(-Math.max(m.pos.y, 0) / 9000);
            m.vel.addScaledVector(dir, -speed * speed * 0.00018 * rho * dt);
            if (m.age < 0.25 && !W.unguided) m.vel.y -= G * dt; // drop before ignition
            if (W.unguided) m.vel.y -= G * dt * 0.5;
            m.armed = m.age > 0.5;

            // guidance
            const t = m.target;
            const tgtAlive = t && (t.alive !== false) && !(t.exploded);
            if (m.age > 0.3 && tgtAlive && !m.lost && !W.unguided) {
                const tp = t.pos, tv = t.vel || _v4.set(0, 0, 0);
                const r = _v2.subVectors(tp, m.pos);
                const dist = r.length();
                const rhat = _v3.copy(r).divideScalar(dist);
                // seeker gimbal limit
                if (rhat.dot(dir) < 0.35 && dist > 120) {
                    m.lost = true;
                    const k = t.incoming ? t.incoming.indexOf(m) : -1;
                    if (k >= 0) t.incoming.splice(k, 1);
                }
                // decoyed by flares?
                if (t.isFlare !== true && m.kind !== 'sam' && !W.radar) this.checkFlares(m, dir, dist);
                const vr = _v4.subVectors(tv, m.vel);
                // Proportional navigation: a = N * Vc * LOS_rate
                const losRate = _v2.crossVectors(r, vr).divideScalar(Math.max(dist * dist, 1));
                const Vc = -vr.dot(rhat);
                const acc = _v4.crossVectors(losRate, rhat).multiplyScalar(W.navN * Math.max(Vc, 150));
                // plus a small pure-pursuit bias so tail-chases still converge
                acc.addScaledVector(rhat.sub(_v2.copy(dir).multiplyScalar(rhat.dot(dir))), 60);
                const maxA = W.turnG * G * clamp(speed / 500, 0.3, 1.2);
                if (acc.length() > maxA) acc.setLength(maxA);
                m.vel.addScaledVector(acc, dt);
                // proximity fuse
                if (m.armed && dist < W.prox + (t.hitRadius || 0) * 0.5) {
                    this.detonate(m, t);
                    this.removeMissile(i);
                    continue;
                }
            }
            // unguided rounds: proximity-fuse on anything hostile
            if (W.unguided && m.age > 0.15) {
                let hitT = null;
                for (const a of g.aircraft) if (a.alive && a.team !== m.team && a.pos.distanceToSquared(m.pos) < (W.prox + a.hitRadius * 0.5) ** 2) { hitT = a; break; }
                if (!hitT && g.ground) for (const gt of g.ground.targets) if (gt.alive && gt.team !== m.team && (gt.hitTest ? gt.hitTest(m.pos) : gt.pos.distanceToSquared(m.pos) < (gt.radius + 4) ** 2)) { hitT = gt; break; }
                if (hitT) { this.detonate(m, hitT); this.splash(m, hitT); this.removeMissile(i); continue; }
            }
            // segment check vs target in case of overshoot
            _prev.copy(m.pos);
            m.pos.addScaledVector(m.vel, dt);
            if (m.armed && tgtAlive && !t.isFlare && segPointDistSq(_prev, m.pos, t.pos) < (W.prox + 4) ** 2) {
                this.detonate(m, t);
                this.removeMissile(i);
                continue;
            }
            m.mesh.quaternion.setFromUnitVectors(_v2.set(0, 0, -1), _v3.copy(m.vel).normalize());
            // exhaust
            if (m.age > 0.25 && m.age < W.boost + 0.25) {
                m.trail.push(m.pos, fx.now);
                fx.fire.emit(m.pos, _v2.copy(m.vel).multiplyScalar(0.7), 0.06, 2.2, 0.8, [6, 4.5, 2.2], [3, 1, 0.2], 1, 0, 0, 0);
                if (Math.random() < 0.5) fx.smoke.emit(m.pos, _v2.copy(m.vel).multiplyScalar(0.05), rand(1.5, 3), 1.8, 7, [0.85, 0.85, 0.85], [0.7, 0.7, 0.7], 0.35, 0, 1, 1);
            } else if (m.age >= W.boost + 0.25) {
                m.trail.emitting = false;
            }
            if (m.target && m.target.hitTest && m.target.alive && m.armed && m.target.hitTest(m.pos)) {
                this.detonate(m, m.target);
                this.removeMissile(i);
                continue;
            }
            if (m.armed !== false && this.worldMissileHit(m)) {
                fx.explosion(m.pos, 0.8);
                this.splash(m);
                this.removeMissile(i);
                continue;
            }
            const h = terrainHeight(m.pos.x, m.pos.z);
            if (m.pos.y < Math.max(h, 0) || m.life <= 0 || (m.age > W.boost + 2 && speed < 170)) {
                if (m.pos.y < 0 && h < 0) fx.waterSplash(m.pos, 0.6);
                else { fx.explosion(m.pos, m.pos.y < h + 3 ? 0.8 : 0.5); this.splash(m); }
                this.removeMissile(i);
                continue;
            }
        }
    }

    detonate(m, t) {
        const g = this.game;
        g.effects.explosion(m.pos, 0.9, m.vel);
        if (t.isFlare) return;
        // splash damage scaled by miss distance
        const d = m.pos.distanceTo(t.pos);
        let dmg = m.W.damage * clamp(1.5 - d / 40, 0.6, 1.3);
        if (t.isPlayer) dmg *= 0.8;
        if (AIR_TARGETS.includes(t)) this.hitAir(t, dmg, m.owner); // a helicopter or airliner locked with T
        else if (t.damage) t.damage(dmg, m.owner, m.kind === 'rkt' ? 'rocket' : 'missile');
        g.events.emit('missileHit', m.owner, { target: t, missile: m });
    }

    // area damage to ground targets near an impact
    splash(m, exclude = null) {
        const g = this.game;
        if (!g.ground) return;
        const R = m.W.splash || 26;
        for (const t of g.ground.targets) {
            if (!t.alive || t.team === m.team || t === exclude) continue;
            if (t.hitTest && t.hitTest(m.pos)) { t.damage(m.W.damage, m.owner, m.kind === 'rkt' ? 'rocket' : 'missile'); continue; }
            const d = t.distTo ? t.distTo(m.pos) : t.pos.distanceTo(m.pos);
            if (d < R + t.radius) t.damage(m.W.damage * clamp(1.2 - d / (R + t.radius), 0.3, 1), m.owner, m.kind === 'rkt' ? 'rocket' : 'missile');
        }
        g.world.towns?.traffic.blast(m.pos, R * 0.6, g);
        this.worldBlast(m.pos, R, m.W.damage * 2.2, m.owner);
    }

    // ── The rest of the world: town buildings, cars, helicopters and air traffic ──
    // damage a helicopter / airliner (softtargets.js); tells the game when that brought it down
    hitAir(t, amount, owner) {
        if (!t.alive) return;
        t.hit(amount, this.game, owner);
        if (!t.alive) this.game.events.emit('airKilled', t, { source: owner });
    }

    worldBulletHit(b, prev) {
        const g = this.game;
        for (const t of AIR_TARGETS) {
            if (!t.alive || Math.abs(t.pos.x - b.pos.x) > 120 || Math.abs(t.pos.z - b.pos.z) > 120) continue;
            if (segHitsSphere(prev, b.pos, t.pos, t.radius)) {
                this.hitAir(t, b.damage, b.owner);
                g.effects.impact(b.pos, null);
                if (b.owner === g.player) g.hitmarkerT = g.time;
                return true;
            }
        }
        const towns = g.world.towns;
        if (!towns || b.pos.y > 700) return false;
        const bl = towns.buildings;
        if (bl && b.pos.y < bl.maxTop) {
            // a round moves ~17 m a frame: sample along the step so it can't skip through a house
            for (let k = 1; k <= 4; k++) {
                const p = _v1.lerpVectors(prev, b.pos, k / 4);
                const hit = bl.at(p.x, p.y, p.z);
                if (hit) { bl.damage(hit, b.damage, g, b.owner); g.effects.impact(p, null); b.pos.copy(p); return true; }
            }
        }
        // cars: sample the step too — the band just above the road is thinner than one frame's travel
        if (b.pos.y - terrainHeight(b.pos.x, b.pos.z) < 40) {
            for (let k = 1; k <= 6; k++) {
                const p = _v1.lerpVectors(prev, b.pos, k / 6);
                const h = terrainHeight(p.x, p.z);
                if (p.y - h > 4) continue;
                if (towns.traffic.hitAt(p, b.damage, g)) { g.effects.impact(p, null); b.pos.copy(p); return true; }
                if (p.y < h) break; // into the ground first
            }
        }
        return false;
    }

    worldMissileHit(m) {
        for (const t of AIR_TARGETS) {
            if (t.alive && t.pos.distanceToSquared(m.pos) < (t.radius + 6) ** 2) { this.hitAir(t, m.W.damage * 1.5, m.owner); return true; }
        }
        const bl = this.game.world.towns && this.game.world.towns.buildings;
        return !!(bl && bl.at(m.pos.x, m.pos.y, m.pos.z));
    }

    // blast damage to buildings and anything flying close
    worldBlast(at, R, amount, owner) {
        const g = this.game;
        const bl = g.world.towns && g.world.towns.buildings;
        if (bl) bl.explode(at, R, amount, g, owner);
        for (const t of AIR_TARGETS) {
            if (!t.alive) continue;
            const d = t.pos.distanceTo(at);
            if (d < R + t.radius) this.hitAir(t, amount * 0.5 * (1 - d / (R + t.radius)), owner);
        }
    }

    checkFlares(m, dir, distToTarget) {
        for (const f of this.flares) {
            if (f.checked.has(m)) continue;
            const r = _v2.subVectors(f.pos, m.pos);
            const d = r.length();
            if (d > 2600 || d > distToTarget * 1.6) continue;
            if (r.divideScalar(d).dot(dir) < 0.6) continue;
            f.checked.add(m);
            // each flare has a chance to seduce the seeker
            const chance = f.owner?.isPlayer ? 0.11 : 0.05 + (f.owner?.pilot?.skill ?? 0.5) * 0.06;
            if (Math.random() < chance) {
                if (m.target.incoming) {
                    const k = m.target.incoming.indexOf(m);
                    if (k >= 0) m.target.incoming.splice(k, 1);
                }
                m.target = f;
                this.game.events.emit('decoyed', m.owner, { missile: m, victim: f.owner });
                return;
            }
        }
    }

    // ── Bombs (unguided, gravity) ──
    dropBomb(ac) {
        const mesh = this.bombGeo.clone();
        const pos = ac.pos.clone().addScaledVector(ac.getUp(_v1), -2.2);
        mesh.position.copy(pos);
        mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
        this.game.scene.add(mesh);
        this.bombs.push({ mesh, pos: mesh.position, vel: ac.vel.clone().addScaledVector(ac.getUp(_v1), -4), owner: ac, team: ac.team, life: 60 });
        this.game.events.emit('bomb', ac);
    }

    // Predict where a bomb released now would land (for the CCIP pipper)
    predictBomb(ac, out) {
        const up = ac.getUp(_v2);
        const p = _v3.copy(ac.pos).addScaledVector(up, -2.2), v = _v4.copy(ac.vel).addScaledVector(up, -4);
        const dt = 0.05;
        for (let t = 0; t < 40; t += dt) {
            v.y -= G * dt;
            v.multiplyScalar(1 - WEAPONS.bomb.drag * dt);
            p.addScaledVector(v, dt);
            if (p.y > 2100) continue; // above every mountain: skip the terrain query
            const s = this.game.surfaceAt(p.x, p.z, p.y);
            if (p.y <= s.h) return out.copy(p).setY(s.h);
        }
        return null;
    }

    updateBombs(dt) {
        const g = this.game, fx = g.effects, W = WEAPONS.bomb;
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const b = this.bombs[i];
            b.life -= dt;
            b.vel.y -= G * dt;
            b.vel.multiplyScalar(1 - W.drag * dt);
            b.pos.addScaledVector(b.vel, dt);
            b.mesh.quaternion.setFromUnitVectors(_v1.set(0, 0, -1), _v2.copy(b.vel).normalize());
            const s = g.surfaceAt(b.pos.x, b.pos.z, b.pos.y + 2);
            const blds = g.world.towns && g.world.towns.buildings;
            const onBuilding = blds && blds.at(b.pos.x, b.pos.y, b.pos.z);
            let hitShip = null;
            if (g.ground) for (const t of g.ground.targets) if (t.alive && t.hitTest && t.team !== b.team && t.hitTest(b.pos)) { hitShip = t; break; }
            if (b.pos.y > s.h && !hitShip && !onBuilding && b.life > 0) continue;
            // impact
            const at = b.pos.clone();
            if (!hitShip && !onBuilding) at.y = s.h;
            if (s.water && !hitShip) {
                fx.waterSplash(at, 2.2);
                fx.explosion(at, 0.8);
            } else {
                fx.explosion(at, 2.4);
                fx.debrisBurst(at, _v1.set(0, 40, 0), 5, 0.8);
                for (let k = 0; k < 20; k++) fx.smoke.emit(at, _v1.set(rand(-25, 25), rand(15, 60), rand(-25, 25)), rand(2, 4), 6, 22, [0.35, 0.3, 0.24], [0.5, 0.45, 0.38], 0.8, 0, 1.2, -12);
                if (!hitShip && !s.ship && !onBuilding) this.addCrater(at);
            }
            g.audio.boom(g.camera.position.distanceTo(at), 1.6);
            if (g.camera.position.distanceTo(at) < 800) g.shake = Math.min(1.5, g.shake + 0.6);
            // splash damage
            if (g.ground) for (const t of g.ground.targets) {
                if (!t.alive || t.team === b.team) continue;
                if (t === hitShip) { t.damage(W.damage * 1.6, b.owner, 'bomb'); continue; }
                const d = t.distTo ? t.distTo(at) : t.pos.distanceTo(at);
                if (d < W.splash + t.radius) t.damage(W.damage * clamp(1.2 - d / (W.splash + t.radius), 0.2, 1), b.owner, 'bomb');
            }
            g.world.towns?.traffic.blast(at, W.splash * 0.7, g);
            this.worldBlast(at, W.splash, W.damage * 4, b.owner);
            for (const a of g.aircraft) {
                if (!a.alive || a.team === b.team) continue;
                const d = a.pos.distanceTo(at);
                if (d < 60) a.damage(W.damage * (1 - d / 60), b.owner, 'missile');
            }
            g.scene.remove(b.mesh);
            this.bombs.splice(i, 1);
        }
    }

    addCrater(p) {
        const g = this.game;
        const m = new THREE.Mesh(this.craterGeo, this.craterMat);
        m.rotation.x = -Math.PI / 2;
        m.position.copy(p).y += 0.4;
        m.scale.setScalar(rand(14, 20));
        m.renderOrder = 2;
        g.scene.add(m);
        this.craters.push(m);
        if (this.craters.length > 60) g.scene.remove(this.craters.shift());
    }

    // ── Flares ──
    dropFlares(ac, now) {
        if (!ac.alive || ac.flares <= 0 || now - ac.lastFlare < 0.35) return false;
        ac.lastFlare = now;
        ac.flares--;
        const up = ac.getUp(_v1), right = ac.getRight(_v2);
        for (let k = 0; k < 4; k++) {
            const s = new THREE.Sprite(this.flareMat);
            s.scale.setScalar(9);
            s.renderOrder = 9;
            const side = k % 2 ? 1 : -1;
            s.position.copy(ac.pos).addScaledVector(up, -2);
            this.game.scene.add(s);
            const vel = ac.vel.clone().multiplyScalar(0.6)
                .addScaledVector(right, side * rand(25, 45))
                .addScaledVector(up, rand(-30, -8));
            this.flares.push({ sprite: s, pos: s.position, vel, life: rand(3, 4), owner: ac, isFlare: true, alive: true, hitRadius: 0, checked: new Set(), smokeT: 0, trail: null });
        }
        this.game.events.emit('flares', ac);
        return true;
    }

    updateFlares(dt) {
        const fx = this.game.effects;
        for (let i = this.flares.length - 1; i >= 0; i--) {
            const f = this.flares[i];
            f.life -= dt;
            f.vel.multiplyScalar(Math.exp(-1.2 * dt));
            f.vel.y -= G * 0.8 * dt;
            f.pos.addScaledVector(f.vel, dt);
            f.sprite.scale.setScalar(7 + Math.random() * 5);
            f.smokeT -= dt;
            if (f.smokeT <= 0) {
                f.smokeT = 0.04;
                fx.smoke.emit(f.pos, _v1.set(0, 2, 0), rand(1.5, 2.5), 1.5, 6, [0.9, 0.9, 0.88], [0.75, 0.75, 0.75], 0.45, 0, 1, 1);
            }
            if (f.life <= 0) {
                f.alive = false;
                this.game.scene.remove(f.sprite);
                this.flares.splice(i, 1);
            }
        }
    }

    update(dt) {
        this.updateBullets(dt);
        this.updateBombs(dt);
        this.updateMissiles(dt);
        this.updateFlares(dt);
    }

    clear() {
        for (const b of this.bullets) if (b.pooled && this.bulletPool.length < 4000) { b.owner = null; this.bulletPool.push(b); }
        this.bullets.length = 0;
        for (let i = this.missiles.length - 1; i >= 0; i--) this.removeMissile(i);
        this.flares.forEach(f => this.game.scene.remove(f.sprite));
        this.flares.length = 0;
        this.bombs.forEach(b => this.game.scene.remove(b.mesh));
        this.bombs.length = 0;
        this.craters.forEach(c => this.game.scene.remove(c));
        this.craters.length = 0;
    }
}

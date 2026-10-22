// ═══════════════════════════════════════════════════════════════
// Weapons: cannon rounds, guided missiles (proportional navigation), flares
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WEAPONS } from './config.js';
import { storeOfKind, storeFor, radiating, flareChance, chaffChance, notchChance } from './stores.js';
import { emitterOf } from './ew.js';
import { rand, clamp, segPointDistSq, G, makeRadialTexture } from './util.js';
import { terrainHeight, isOnRunway } from './world.js';
import { outsideBases } from './roads.js';
import { CRATER_KINDS, craterAdj } from './craters.js';
import { AIR_TARGETS, segHitsSphere } from './softtargets.js';
import { seatHitTest, seatBody, seatCanopyUp, seatCanopyCenter, isEnemySeat, hitEnemySeat, shredEnemyCanopy } from './pilot.js';
import { materielDamage, targetClass, damageAt } from './arsenal.js';
import { gunCalibre, gunRealRate, WARHEAD_KG } from './splash.js';

// what a round does to a target class: small arms (b.small, from ordnance.js) carry their weapon's table
// (arsenal.js: armour shrugs them off, walls stop them); everything else deals its flat damage
const roundVs = (b, cls) => (b.small ? materielDamage(b.def, cls) : b.damage);

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _prev = new THREE.Vector3();
// the ground targets' grid for rounds (binTargets): cell size (m) and a cell's key
const CELL = 250;
const cellKey = (ix, iz) => ix * 65536 + iz;
const _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3(), _s3 = new THREE.Vector3(), _s4 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
// a bunker buster's hole: narrow for its size and deep, the earth heaved up in a high rim
const BUSTER_CRATER = { r: 7.5, depth: 7, rim: 1.8, scorch: 0.55, reach: 2.8, clods: 18 };
// a MOAB's: it goes off just above the ground, so a wide, shallow bowl scorched black, earth thrown far
const MOAB_CRATER = { r: 19, depth: 3.4, rim: 1.5, scorch: 1, reach: 3.0, clods: 24 };
const GUN_BLUE = [3.2, 2.6, 1.2], GUN_RED = [3.4, 1.0, 0.5], FLAK_COLOR = [3.6, 1.2, 0.5];
// terrain looked at ahead of a sea-skimmer or a cruise missile (m)
const AHEAD = [100, 200, 350, 500, 700, 900, 1150, 1400, 1700, 2100, 2600, 3200, 4000];

// ── Store meshes (stores.js sizes): an ogive or a seeker dome on a body of revolution, the fin sets of its shape
// (at: from the nose, 0 … 1 of the length; chord: of the length; span: of the radius, out from the body; n: 2 for
// a pair of wings; grid: lattice fins), nose toward −Z. One geometry per store, shared. ──
const FINS = {
    aim9: [{ at: 0.1, chord: 0.07, span: 3.0 }, { at: 0.93, chord: 0.1, span: 4.0 }],
    stub: [{ at: 0.4, chord: 0.18, span: 0.6 }, { at: 0.93, chord: 0.07, span: 2.0 }],
    r73: [{ at: 0.08, chord: 0.05, span: 2.4 }, { at: 0.9, chord: 0.1, span: 3.2 }],
    aam: [{ at: 0.48, chord: 0.16, span: 1.6 }, { at: 0.93, chord: 0.08, span: 2.2 }],
    sparrow: [{ at: 0.45, chord: 0.12, span: 2.4 }, { at: 0.93, chord: 0.09, span: 2.4 }],
    grid: [{ at: 0.5, chord: 0.12, span: 1.2 }, { at: 0.965, chord: 0.035, span: 2.0, grid: true }],
    big: [{ at: 0.6, chord: 0.3, span: 1.4 }, { at: 0.93, chord: 0.1, span: 1.5 }],
    agm: [{ at: 0.55, chord: 0.45, span: 1.3 }, { at: 0.95, chord: 0.08, span: 1.0 }],
    cruise: [{ at: 0.45, chord: 0.12, span: 6, n: 2 }, { at: 0.94, chord: 0.08, span: 1.6 }],
    rocket: [{ at: 0.95, chord: 0.06, span: 1.6 }],
    // bombs: low-drag fins; a Paveway's canards and big tail wings; a KAB's; a JDAM's tail kit and strakes; the
    // SDB's wings; a cluster canister's
    mk: [{ at: 0.86, chord: 0.24, span: 1.5 }],
    fab: [{ at: 0.86, chord: 0.22, span: 1.3 }],
    pave: [{ at: 0.1, chord: 0.08, span: 1.4 }, { at: 0.88, chord: 0.2, span: 2.6 }],
    kab: [{ at: 0.12, chord: 0.1, span: 1.6 }, { at: 0.88, chord: 0.2, span: 2.2 }],
    jdam: [{ at: 0.5, chord: 0.3, span: 0.5 }, { at: 0.9, chord: 0.15, span: 1.6 }],
    sdb: [{ at: 0.42, chord: 0.12, span: 7, n: 2 }, { at: 0.92, chord: 0.1, span: 1.8 }],
    cbu: [{ at: 0.88, chord: 0.2, span: 1.4 }],
    // the MOAB: four lattice fins on the tail and small fixed fins just ahead of them
    moab: [{ at: 0.84, chord: 0.1, span: 0.45 }, { at: 0.97, chord: 0.04, span: 1.3, grid: true }],
};
const NOSE = { dome: 1, glass: 1, ogive: 4, blunt: 1.6, bomb: 2.2 };
// IR seekers: a dark glass dome; TV / laser ones a glass window; radars, cruise and bombs an ogive
const noseOf = (W) => W.cls === 'srm' ? 'dome' : W.seeker === 'tv' || W.seeker === 'laser' || W.seeker === 'mmw' ? 'glass' : W.drop || W.cls === 'gbu' || W.cls === 'bomb' || W.cls === 'moab' ? 'bomb' : W.cls === 'rkt' ? 'blunt' : 'ogive';
const STORE_GEO = new Map(), STORE_MAT = new Map();
function storeMat(color, glass) {
    const k = glass ? 'glass' : color;
    if (!STORE_MAT.has(k)) STORE_MAT.set(k, glass ? new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.15, metalness: 0.6 }) : new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 }));
    return STORE_MAT.get(k);
}
function storeGeo(W) {
    let e = STORE_GEO.get(W.id);
    if (e) return e;
    const L = W.len || 3, R = (W.dia || 0.15) / 2, nose = noseOf(W), nl = Math.min(L * 0.35, R * NOSE[nose]);
    const moab = W.shape === 'moab'; // (a long straight body that narrows only a little into its fins)
    const bomb = nose === 'bomb', tailL = bomb ? L * (moab ? 0.1 : 0.3) : L * 0.04, tailR = bomb ? R * (W.shape === 'cbu' ? 0.8 : moab ? 0.75 : 0.42) : R * 0.85;
    // lathe profiles from the tail (−Y) up to the tip (+Y), rotated so the nose points along −Z
    const top = L / 2, shoulder = top - nl;
    const curve = nose === 'dome' || nose === 'glass' ? (t) => R * Math.sqrt(1 - t * t) : (t) => R * (1 - t * t);
    const nosePts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; nosePts.push(new THREE.Vector2(Math.max(curve(t), 0.001), shoulder + nl * t)); }
    const noseG = new THREE.LatheGeometry(nosePts, 12);
    const body = new THREE.LatheGeometry([new THREE.Vector2(0.001, -top), new THREE.Vector2(tailR, -top), new THREE.Vector2(R, -top + tailL), new THREE.Vector2(R, shoulder)], 12);
    const parts = [body];
    if (nose !== 'dome' && nose !== 'glass') parts.push(noseG);
    for (const f of FINS[W.shape] || FINS.aam) {
        const n = f.n || 4, span = f.span * R, chord = Math.max(0.03, f.chord * L), th = f.grid ? Math.max(0.02, R * 0.5) : Math.max(0.008, R * 0.07);
        const y = top - f.at * L;
        for (let k = 0; k < n; k++) {
            const b = new THREE.BoxGeometry(th, chord, n === 2 ? span * 2 + R * 2 : span);
            if (n !== 2) b.translate(0, y, R + span / 2); else b.translate(0, y, 0);
            b.rotateY(n === 2 ? Math.PI / 2 : k * Math.PI / 2 + Math.PI / 4);
            parts.push(b);
            if (n === 2) break;
        }
    }
    const geo = mergeGeometries(parts);
    geo.rotateX(-Math.PI / 2);
    noseG.rotateX(-Math.PI / 2);
    e = { geo, nose: nose === 'dome' || nose === 'glass' ? noseG : null };
    STORE_GEO.set(W.id, e);
    return e;
}
export function storeMesh(W) {
    const e = storeGeo(W);
    const root = new THREE.Group();
    const body = new THREE.Mesh(e.geo, storeMat(W.color ?? 0xd8d8d2));
    body.castShadow = true;
    root.add(body);
    if (e.nose) root.add(new THREE.Mesh(e.nose, storeMat(0, true)));
    return root;
}

const flareTex = makeRadialTexture(64, [[0, 'rgba(255,255,255,1)'], [0.15, 'rgba(255,240,200,0.9)'], [0.4, 'rgba(255,180,80,0.35)'], [1, 'rgba(255,120,40,0)']]);

export class Weapons {
    constructor(game) {
        this.game = game;
        this.bullets = [];
        this.missiles = [];
        this.flares = [];
        this.bombs = [];
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
        this.chaff = [];     // chaff clouds (dropFlares): radar decoys
        this.bomblets = [];  // a cluster bomb's submunitions on their way down
    }

    // ── Cannon ──
    // Returns the number of rounds fired this call (0 while the gun cycles). A held trigger fires every round
    // it owes (up to 3 in one long frame, more for a very fast gun), so the rate of fire doesn't drop at low frame
    // rates; a fresh pull fires one. A shotgun cannon (the X-100's GAU-X: `pellets`, `cone`) fires blasts instead:
    // `pellets` rounds at once, rate / pellets times a second, spread evenly over a cone `cone` rad wide each side.
    fireGun(ac, now) {
        const gun = ac.spec.gun;
        if (!gun || !ac.alive || ac.ammo <= 0) return 0;
        const P = gun.pellets || 1;
        const iv = P / gun.rate, since = now - ac.lastGun;
        if (since < iv) return 0;
        // (a 100-round-a-second gun owes several rounds in every frame: its window and its cap are wider)
        const held = since < Math.max(iv * 4, 0.12);
        const n = held ? Math.min(Math.max(3, Math.ceil(gun.rate / P * 0.06)), Math.floor(since / iv), Math.ceil(ac.ammo / P)) : 1;
        ac.lastGun = held ? ac.lastGun + n * iv : now;
        const fwd = ac.getForward(_v1);
        const spread = ac.isPlayer || ac.team === 'blue' && !ac.pilot ? 0.0035 : 0.008 + (1 - (ac.pilot?.skill ?? 1)) * 0.02;
        const cone = gun.cone || 0, right = cone && ac.getRight(_s1), up = cone && ac.getUp(_s2);
        let shot = 0;
        for (let k = 0; k < n; k++) {
            // a catch-up round (or blast) left the muzzle a moment ago: start it that much further down range
            const ahead = ac.spec.length * 0.5 + (n - 1 - k) * iv * WEAPONS.bulletSpeed;
            for (let j = 0; j < P && ac.ammo > 0; j++, shot++) {
                ac.ammo--;
                const dir = _v2.copy(fwd);
                if (cone) {
                    // uniform over the cone's disc (√ of the radius), so the pattern is as dense at the rim as in the middle
                    const r = cone * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
                    dir.addScaledVector(right, r * Math.cos(a)).addScaledVector(up, r * Math.sin(a)).normalize();
                } else dir.add(_v3.set(rand(-spread, spread), rand(-spread, spread), rand(-spread, spread))).normalize();
                const muzzle = _v3.copy(ac.pos).addScaledVector(fwd, ahead);
                const vel = dir.multiplyScalar(WEAPONS.bulletSpeed).add(ac.vel);
                // (two rounds in three a tracer; a shotgun blast's one in four, or its sheet of fire would be a white blur)
                const tracer = P > 1 ? ac.ammo % 4 === 0 : ac.ammo % 3 !== 0;
                const b = this.newBullet(muzzle, vel, ac, gun.damage, WEAPONS.bulletLife, tracer, ac.team === 'blue' ? GUN_BLUE : GUN_RED);
                b.flak = false;
                // (its splash in the water, splash.js: the calibre, and how many real rounds this one stands for)
                b.cal = gun.cal || (gun.cal = gunCalibre(gun.name));
                b.rep = gun.rep || (gun.rep = clamp(Math.round(gunRealRate(gun.name) / gun.rate), 1, 6));
            }
        }
        this.game.events.emit('gunfire', ac);
        // muzzle flash (a shotgun blast's is a ball of fire)
        this.game.effects.fire.emit(_v3.copy(ac.pos).addScaledVector(fwd, ac.spec.length * 0.5), ac.vel, 0.05, P > 1 ? 3 : 1.8, 0.6, [6, 5, 3], [3, 1.5, 0.5], 1, 0, 0, 0);
        return shot;
    }

    // Flak / AAA rounds from ground units (cal: mm, for the splash a round makes in the water: 23 mm AAA, a CIWS's
    // 20 / 30 mm, a ship's 76–130 mm gun)
    fireFlak(pos, dir, owner, damage = 6, speed = 900, fuse = rand(1.2, 2.8), cal = 23, rep = 1) {
        const b = this.newBullet(pos, _v4.copy(dir).multiplyScalar(speed), owner, damage, Math.min(3, isFinite(fuse) ? fuse + 0.1 : 2.2), true, FLAK_COLOR);
        b.flak = isFinite(fuse); b.fuse = fuse; b.cal = cal; b.rep = rep;
        return b;
    }

    // a round from the pool (or a new one), pushed onto the live list
    newBullet(pos, vel, owner, damage, life, tracer, color) {
        const b = this.bulletPool.pop() || { pos: new THREE.Vector3(), vel: new THREE.Vector3(), pooled: true };
        b.pos.copy(pos); b.vel.copy(vel);
        b.owner = owner; b.team = owner.team; b.damage = damage; b.life = life; b.tracer = tracer; b.color = color;
        b.flak = false; b.fuse = 0; b.small = false; b.def = null; b.whizzed = false; b.cal = 0; b.rep = 0; b.skips = 0;
        this.bullets.push(b);
        return b;
    }

    // The ground targets binned on a CELL m grid once a frame, so a round tests only the few near it (the X-100's
    // shotgun keeps ~2000 rounds in the air over a war's 200-odd targets). A target with a hitTest bins by how far its
    // test reaches from pos (hitReach), one without by its sphere (center, radius); `pad` covers a round's step in a
    // frame. One with a hitTest but no hitReach, or too big to bin, goes in `always`: every round tests it.
    binTargets(targets, pad) {
        const T = this.tgrid || (this.tgrid = { cells: new Map(), used: [], always: [] });
        for (const a of T.used) a.length = 0;
        T.used.length = 0; T.always.length = 0;
        for (const t of targets) {
            if (!t.alive) continue;
            const c = t.hitTest ? t.pos : t.center, r = (t.hitTest ? t.hitReach : t.radius) + pad;
            if (!c || !(r < CELL * 4)) { T.always.push(t); continue; }
            const x1 = Math.floor((c.x + r) / CELL), z0 = Math.floor((c.z - r) / CELL), z1 = Math.floor((c.z + r) / CELL);
            for (let ix = Math.floor((c.x - r) / CELL); ix <= x1; ix++) {
                for (let iz = z0; iz <= z1; iz++) {
                    const k = cellKey(ix, iz);
                    let a = T.cells.get(k);
                    if (a === undefined) T.cells.set(k, a = []);
                    if (a.length === 0) T.used.push(a);
                    a.push(t);
                }
            }
        }
        return T;
    }

    // a round against these ground targets (it moved from _prev to b.pos this frame); true when it hit one
    groundBulletHit(b, targets) {
        const g = this.game;
        for (const t of targets) {
            if (!t.alive || t.team === b.team) continue;
            if (t.hitTest ? t.hitTest(b.pos) : segPointDistSq(_prev, b.pos, t.center) < t.radius * t.radius) {
                const dmg = roundVs(b, targetClass(t));
                if (dmg > 0) t.damage(dmg, b.owner, b.small ? 'rifle' : undefined);
                if (b.small && dmg > 0 && b.owner === g.pilotMode) g.hitmarkerT = g.time;
                g.effects.impact(b.pos, null);
                g.events.emit('bulletHit', b.owner, { target: t });
                return true;
            }
        }
        return false;
    }

    updateBullets(dt) {
        const g = this.game;
        const list = this.bullets;
        const grid = g.ground && list.length ? this.binTargets(g.ground.targets, 40 + 1800 * dt) : null;
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
                        ac.damage(roundVs(b, 'aircraft'), b.owner, b.small ? 'rifle' : 'gun');
                        if (b.small && b.owner === g.pilotMode) g.hitmarkerT = g.time;
                        g.effects.impact(b.pos, ac.vel);
                        g.events.emit('bulletHit', b.owner, { target: ac });
                        dead = true;
                        break;
                    }
                }
            }
            if (!dead && grid && b.damage > 0) {
                // (only the targets binned in this round's cell, and any too big or odd to bin)
                const cell = grid.cells.get(cellKey(Math.floor(b.pos.x / CELL), Math.floor(b.pos.z / CELL)));
                dead = (cell !== undefined && this.groundBulletHit(b, cell)) || (grid.always.length > 0 && this.groundBulletHit(b, grid.always));
            }
            if (!dead && b.damage > 0) dead = this.worldBulletHit(b, _prev); // (walls first: cover works)
            if (!dead && b.damage > 0) dead = this.peopleBulletHit(b, _prev);
            if (!dead && b.flak) {
                b.fuse -= dt;
                if (b.fuse <= 0) {
                    // airburst: damages anything close
                    g.effects.fire.emit(b.pos, _v1.set(0, 0, 0), 0.15, 4, 10, [6, 4, 2], [2, 1, 0.3], 1, 0, 0, 0);
                    g.effects.smoke.emit(b.pos, _v1.set(0, 1, 0), 2.5, 5, 14, [0.08, 0.08, 0.08], [0.2, 0.2, 0.2], 0.8, 0, 1, 0);
                    g.effects.light(b.pos, 22, 0.22, { merge: 12, cloud: 1.2 }); // [night] the burst lights the sky round it
                    for (const ac of g.aircraft) {
                        if (ac.alive && ac.team !== b.team && ac.pos.distanceToSquared(b.pos) < 45 * 45) ac.damage(b.damage, b.owner, 'flak');
                    }
                    this.blastPeople(b.pos, 30, b.damage * 5, b.owner, b.team);
                    dead = true;
                }
            }
            if (!dead && b.pos.y < 3000) {
                const h = terrainHeight(b.pos.x, b.pos.z);
                if (b.pos.y < h || b.pos.y < 0) {
                    if (b.pos.y < 0 && h < 0) {
                        // into the sea: a spout sized to the round, or at a shallow angle it skips off and flies on (splash.js)
                        const W = g.effects.water;
                        if (W && W.round(b, _prev)) continue;
                    } else {
                        g.effects.groundImpact(b.pos);
                        // strafing: a round striking the ground right by someone on foot still hurts (fragments, ricochet)
                        const pm = g.pilotMode;
                        if (b.team === 'red' && b.damage > 0 && !b.small && pm && pm.alive && pm.walker) {
                            const d = Math.hypot(pm.pos.x - b.pos.x, pm.pos.z - b.pos.z);
                            if (d < 2.5) pm.takeHit(b.damage * (1.6 - d * 0.4), 'CUT DOWN BY GUNFIRE');
                        }
                    }
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
    // kind: 'aam' (IR), 'lrm' (radar), 'xlr', 'arm', 'agm', 'ashm', 'alcm', 'rkt' (stores.js classes) or 'sam'. An
    // aircraft fires its type's own store for the kind (an F-16's AIM-9X, a Su-35's R-73: stores.js storeFor);
    // a ground launcher the plain table (WEAPONS.sam; 'arm': the HARM of airsupport.js). Wo: a store to fire instead;
    // tag: fields for the missile ({ viaEW: true }: the EW page's HARM)
    fireMissile(ac, target, kind = 'aam', Wo = null, tag = null) {
        if (ac.alive === false) return null;
        const W = Wo || storeOfKind(ac, kind) || WEAPONS[kind === 'aam' ? 'missile' : kind] || WEAPONS.missile;
        const fwd = ac.getForward ? ac.getForward(_v1) : _v1.copy(ac.launchDir);
        const pos = _v2.copy(ac.pos);
        if (ac.getUp) {
            // drop from a rail under the wing
            const side = (ac.missileSide = -(ac.missileSide || 1));
            pos.addScaledVector(ac.getRight(_v3), side * ac.rig.halfSpan * (kind === 'rkt' ? 0.25 : 0.35)).addScaledVector(ac.getUp(_v4), -1.5);
            if (kind === 'rkt') fwd.add(_v3.set(rand(-0.012, 0.012), rand(-0.012, 0.012), rand(-0.012, 0.012))).normalize();
        }
        let mesh;
        if (W.id) mesh = storeMesh(W);
        else {
            mesh = new THREE.Mesh(kind === 'sam' ? this.samGeo : kind === 'rkt' ? this.rocketGeo : this.missileGeo, this.missileMat);
            if (kind === 'lrm') mesh.scale.set(1.25, 1.25, 1.25);
            else if (W.scale) mesh.scale.setScalar(W.scale);
            mesh.castShadow = true;
        }
        mesh.position.copy(pos);
        this.game.scene.add(mesh);
        const vel = (ac.vel ? ac.vel.clone() : new THREE.Vector3()).addScaledVector(fwd, kind === 'sam' ? 60 : kind === 'rkt' ? 120 : 15);
        if (ac.getUp && kind !== 'rkt') vel.addScaledVector(ac.getUp(_v4), -6);
        const big = W.cls === 'alcm' || W.cls === 'ashm' || W.cls === 'xlr';
        const m = {
            mesh, pos: mesh.position, vel, target, owner: ac, team: ac.team, kind, W,
            life: W.life, age: 0, armed: false, lost: false,
            trail: this.game.effects.addTrail({ max: 220, width: kind === 'sam' ? 1.0 : kind === 'rkt' ? 0.6 : big ? 1.4 : 1.1, life: kind === 'sam' ? 7 : kind === 'rkt' ? 2 : 5.5, color: [0.92, 0.92, 0.9], alpha: 0.5, minDist: 10, widthGrow: 2.2 }),
            fireT: 0,
        };
        // a GPS weapon flies to where the target is now (a cruise missile: JASSM, Storm Shadow)
        if (target && W.seeker === 'gps') m.aim = target.pos.clone();
        if (tag) Object.assign(m, tag);
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
            // motor; then a sustainer for the ones that have one: a ramjet (Meteor, Kh-31) or a turbojet holding its
            // cruise speed (Harpoon, JASSM)
            const boosting = (W.unguided || m.age > 0.25) && m.age < W.boost + 0.25;
            const sustaining = !boosting && W.sustain && m.age > 0.25 && m.age < W.boost + 0.25 + (W.sustainT ?? Infinity) && speed < (W.cruise || W.vmax || Infinity);
            if (boosting) m.vel.addScaledVector(dir, W.accelBoost * dt);
            else if (sustaining) m.vel.addScaledVector(dir, W.sustain * dt);
            // drag (thinner up high)
            const rho = Math.exp(-Math.max(m.pos.y, 0) / 9000);
            m.vel.addScaledVector(dir, -speed * speed * 0.00018 * (W.drag ?? 1) * rho * dt);
            if (m.age < 0.25 && !W.unguided) m.vel.y -= G * dt; // drop before ignition
            if (W.unguided) m.vel.y -= G * dt * 0.5;
            m.armed = m.age > 0.5;

            // guidance (the seeker, the flight profile, the proximity fuse: guide())
            const t = m.target;
            const tgtAlive = t && (t.alive !== false) && !(t.exploded);
            if (m.age > 0.3 && !m.lost && !W.unguided && this.guide(m, dt, speed, dir)) { this.removeMissile(i); continue; }
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
            // exhaust (a ramjet or a turbojet sustainer burns clean: no smoke after the booster)
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
            if (m.pos.y < Math.max(h, 0) || m.life <= 0 || (m.age > W.boost + 2 && !sustaining && speed < (W.minSpeed ?? 170))) {
                // into the sea: its warhead throws a column up (splash.js), a fireball on the surface inside it
                if (m.pos.y < 0 && h < 0) { if (fx.water) fx.water.blast(m.pos, { kg: W.kg ?? WARHEAD_KG[m.kind] ?? 8, depth: 'contact', vel: m.vel, agl: 0 }); else fx.waterSplash(m.pos, 0.6); }
                else {
                    fx.explosion(m.pos, m.pos.y < h + 3 ? (W.boom || 0.8) : 0.5); this.splash(m);
                    if (m.pos.y < h + 2.5) this.addCrater(_v2.set(m.pos.x, h, m.pos.z), m.kind === 'aam' ? 'missile' : m.kind, m.vel, W.crater ? { scale: W.crater } : undefined);
                }
                this.removeMissile(i);
                continue;
            }
        }
        if (this.chaff.length) this.updateChaff(dt);
    }

    // ── Guidance: what the seeker sees, then where to steer (the flight profile) and the fuse. Returns true when
    // the missile went off (the caller removes it). ──
    guide(m, dt, speed, dir) {
        const g = this.game, W = m.W;
        let t = m.target;
        if (t && (t.alive === false || t.exploded)) t = null;
        // fired without a lock: an anti-ship or anti-radiation missile searches ahead for something to home on
        if (!t && !m.aim && (W.cls === 'ashm' || W.cls === 'arm')) {
            m.searchT = (m.searchT || 0) - dt;
            if (m.searchT <= 0) { m.searchT = 0.5; t = this.acquire(m, dir); }
        }
        if (!t && !m.aim) return false;
        // where it's steering: the target; an ARM's last fix on a radar that went quiet; a GPS weapon's point
        // (a cruise missile's terminal seeker takes the target itself in the last couple of km)
        let tp = t ? t.pos : m.aim, tv = t && t.vel ? t.vel : _s4.set(0, 0, 0);
        if (m.aim) {
            const near = t && t.pos.distanceToSquared(m.aim) < 300 * 300 && m.pos.distanceToSquared(m.aim) < 2500 * 2500;
            if (!near) { tp = m.aim; tv = _s4.set(0, 0, 0); }
        }
        if (t && W.seeker === 'arm' && !this.emits(t)) {
            if (!m.memory) m.memory = t.pos.clone().add(_s1.set(rand(-35, 35), 0, rand(-35, 35)));
            tp = m.memory; tv = _s4.set(0, 0, 0);
        }
        const r = _v2.subVectors(tp, m.pos);
        const dist = r.length();
        const rhat = _v3.copy(r).divideScalar(Math.max(dist, 1e-3));
        const prof = W.profile;
        const midcourse = (prof === 'skim' || prof === 'cruise') && Math.hypot(r.x, r.z) > W.terminal;
        // seeker gimbal limit (not in the inertial midcourse of a sea-skimmer or a cruise missile)
        if (t && !midcourse && rhat.dot(dir) < 0.35 && dist > 120) { this.loseLock(m); return false; }
        if (t && !this.seekerHolds(m, t, rhat, dist, dt)) return false;
        if (m.lost) return false;
        const maxA = W.turnG * G * clamp(speed / 500, W.tvc ? 0.6 : 0.3, 1.2);
        if (prof === 'skim' || prof === 'cruise') this.flyLow(m, tp, tv, r, rhat, dist, speed, dir, maxA, dt);
        else if (prof === 'loft' && dist > 7000) {
            // a lofted shot: up into the thin air toward where he'll be, then down onto him
            const tgo = dist / Math.max(speed, 300);
            _s1.copy(tp).addScaledVector(tv, tgo); _s1.y += dist * W.loft;
            this.steerTo(m, _s1, speed, maxA * 0.5, 1.0, dt);
        } else if (prof === 'top' && Math.hypot(r.x, r.z) > 1100) {
            // top attack: over the target, then down onto its roof
            _s1.copy(tp); _s1.y += Math.hypot(r.x, r.z) * 0.25;
            this.steerTo(m, _s1, speed, maxA, 1.5, dt);
        } else this.pn(m, r, rhat, dist, tv, dir, maxA, dt);
        // proximity fuse
        if (m.armed && t && dist < W.prox + (t.hitRadius || 0) * 0.5 && tp === t.pos) { this.detonate(m, t); return true; }
        return false;
    }

    // proportional navigation: a = N · Vc · LOS rate, plus a small pure-pursuit bias so tail chases still converge
    pn(m, r, rhat, dist, tv, dir, maxA, dt) {
        const vr = _s2.subVectors(tv, m.vel);
        const losRate = _s3.crossVectors(r, vr).divideScalar(Math.max(dist * dist, 1));
        const Vc = -vr.dot(rhat);
        const acc = _s1.crossVectors(losRate, rhat).multiplyScalar(m.W.navN * Math.max(Vc, 150));
        acc.addScaledVector(_s2.copy(rhat).addScaledVector(dir, -rhat.dot(dir)), 60);
        if (acc.length() > maxA) acc.setLength(maxA);
        m.vel.addScaledVector(acc, dt);
    }

    // turn the velocity toward a point (gain: 1 / time constant, s⁻¹), at most maxA
    steerTo(m, point, speed, maxA, gain, dt) {
        const want = _s2.subVectors(point, m.pos);
        const d = want.length();
        if (d < 1) return;
        const acc = want.multiplyScalar(speed / d).sub(m.vel).multiplyScalar(gain);
        if (acc.length() > maxA) acc.setLength(maxA);
        m.vel.addScaledVector(acc, dt);
    }

    // Sea-skimming / terrain following (anti-ship and cruise missiles): `alt` over the sea (0) or the ground, climbing
    // early for what's ahead (each ridge in the next 4 km is cleared on a 20° slope: the terrain-following radar's
    // "ski toe"); in the last few km a pop-up to see the target and a bunt down onto it (Harpoon, the cruise
    // missiles), or straight in at wave height (Exocet)
    flyLow(m, tp, tv, r, rhat, dist, speed, dir, maxA, dt) {
        const W = m.W, hd = Math.max(1, Math.hypot(r.x, r.z)), ux = r.x / hd, uz = r.z / hd;
        const L = Math.max(400, speed * 2.5);
        if (hd > W.terminal) {
            // (down to it on a 15° glide from the drop, up at no more than 40°)
            const y = clamp(this.terrainFollow(m, ux, uz, W.alt, dt, L), m.pos.y - L * 0.27, m.pos.y + L * 0.84);
            _s1.set(m.pos.x + ux * L, y, m.pos.z + uz * L);
            this.steerTo(m, _s1, speed, maxA, 1.5, dt);
            return;
        }
        if (W.popup && !m.dive) {
            // up at ~25° to the apex (still clear of the ground), until the target's 24° below with nothing in the way
            // (a target behind a ridge: higher, for a steeper dive)
            const sees = this.lineClear(m.pos, tp);
            if ((m.pos.y - tp.y >= hd * 0.45 && sees) || m.pos.y - tp.y >= hd || hd < 250) m.dive = true;
            else {
                const apex = Math.max(tp.y + (W.popAlt || 320) + (sees ? 0 : 400), this.terrainFollow(m, ux, uz, W.alt, dt, L));
                _s1.set(m.pos.x + ux * L, Math.min(apex, m.pos.y + L * 0.47), m.pos.z + uz * L);
                this.steerTo(m, _s1, speed, maxA * 1.5, 1.5, dt);
                return;
            }
        }
        // the dive (a bunt: it pulls harder now), or the run in at wave height: onto the target
        this.pn(m, r, rhat, dist, tv, dir, maxA * 2, dt);
    }
    // nothing but air on the straight line from a to b (the terrain, sampled; not the last 15%: the target's own ground)
    lineClear(a, b) {
        for (let k = 1; k < 12; k++) {
            const t = k / 12 * 0.85;
            const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
            if (y < terrainHeight(x, z) + 4) return false;
        }
        return true;
    }

    // the height for the carrot L m ahead: high enough that the straight line to it clears everything between (alt
    // over it), and over every ridge beyond it less a 20° climb to it (10 Hz)
    terrainFollow(m, ux, uz, alt, dt, L) {
        m.tfT = (m.tfT || 0) - dt;
        if (m.tfT > 0 && m.tfNeed != null) return m.tfNeed;
        m.tfT = 0.1;
        const y = m.pos.y;
        let need = Math.max(terrainHeight(m.pos.x, m.pos.z), 0) + alt;
        for (const a of AHEAD) {
            const h = Math.max(terrainHeight(m.pos.x + ux * a, m.pos.z + uz * a), 0) + alt;
            need = Math.max(need, a <= L ? y + (h - y) * L / a : h - (a - L) * 0.36);
        }
        return (m.tfNeed = need);
    }

    // Does the seeker still have it? Flares and cloud (IR, TV), the launcher's radar (semi-active), its laser,
    // chaff and the notch (radar). Sets m.lost (or a new target: a decoy) and returns false when it's gone.
    seekerHolds(m, t, rhat, dist, dt) {
        const g = this.game, W = m.W, s = W.seeker || (W.radar ? 'arh' : m.kind === 'sam' ? 'sam' : 'ir');
        if (t.isFlare) return true;
        if (s === 'ir' && m.kind !== 'sam') this.checkFlares(m, rhat, dist);
        // [weather] a heat seeker or a TV seeker loses a target that stays hidden in cloud or fog (weathersys.js)
        if ((s === 'ir' || s === 'tv') && m.kind !== 'sam' && g.weather && g.weather.irClear && !m.lost) {
            m.irT = (m.irT || 0) - dt;
            if (m.irT <= 0) {
                m.irT = 0.2;
                m.blindT = g.weather.irClear(m.pos, t.pos) ? 0 : (m.blindT || 0) + 0.2;
                if (m.blindT > 0.6) { this.loseLock(m); g.events.emit('missileLostInCloud', m.owner, { missile: m, target: t }); return false; }
            }
        }
        // a semi-active missile rides the launcher's radar: its nose within 60° of the target and in range, or a
        // laser seeker the launcher's spot — lose it for over half a second and the missile goes dumb
        if (s === 'sarh' || s === 'laser') {
            m.supT = (m.supT || 0) - dt;
            if (m.supT <= 0) {
                m.supT = 0.2;
                const ok = s === 'laser' ? this.laserOK(m.owner, t) : this.illuminated(m.owner, t, W);
                m.unsupT = ok ? 0 : (m.unsupT || 0) + 0.2;
                if (m.unsupT > 0.6) { this.loseLock(m); g.events.emit('missileTrashed', m.owner, { missile: m, target: t, why: s === 'laser' ? 'laser' : 'support' }); return false; }
            }
        }
        // radar seekers against an aircraft: chaff, and the notch (it flying across our line of sight, below us)
        if ((s === 'arh' || s === 'sarh') && t.getForward && m.kind !== 'sam') {
            this.checkChaff(m, t, rhat, dist);
            if (m.target !== t) return false;
            m.notchT = (m.notchT || 0) - dt;
            if (m.notchT <= 0) {
                m.notchT = 0.5;
                const v = t.vel.length();
                const beam = v > 60 ? 1 - Math.abs(t.vel.dot(rhat)) / v : 0;
                if (Math.random() < notchChance(W, beam, m.pos.y > t.pos.y + 100)) {
                    this.loseLock(m);
                    g.events.emit('notched', m.owner, { missile: m, victim: t });
                    return false;
                }
            }
        }
        return true;
    }

    // the missile stops guiding (gimbal limit, decoy, cloud, the launcher's radar or laser gone)
    loseLock(m) {
        m.lost = true;
        const t = m.target;
        const k = t && t.incoming ? t.incoming.indexOf(m) : -1;
        if (k >= 0) t.incoming.splice(k, 1);
    }

    // is the launcher still painting it (a semi-active missile)? its radar's ±60° and a little past the missile's range
    illuminated(o, t, W) {
        if (!o || o.alive === false || !o.getForward) return !o || !o.getForward; // (a ground launcher: its own radar)
        const d = _s2.subVectors(t.pos, o.pos), L = d.length();
        return L < W.range * 1.6 && o.getForward(_s3).dot(d.divideScalar(Math.max(L, 1))) > 0.5;
    }

    // can the launcher keep its laser on t? alive, within 20 km, the pod able to look there (below the wings, not
    // behind the tail) and no cloud in between
    laserOK(o, t) {
        if (!o || o.alive === false || o.falling) return false;
        if (!o.getForward) return true;
        const d = _s2.subVectors(t.pos, o.pos), L = d.length();
        if (L > 20000) return false;
        d.divideScalar(Math.max(L, 1));
        if (o.getForward(_s3).dot(d) < -0.6 || o.getUp(_s3).dot(d) > 0.35) return false;
        const wx = this.game.weather;
        return !(wx && wx.irClear && !wx.irClear(o.pos, t.pos));
    }

    // is t transmitting (an ARM's target)? ew.js knows the war's emitters; the plain ones by type (stores.js)
    emits(t) {
        const war = this.game.war;
        return radiating(t, war && war.rec ? emitterOf(t, war.rec(t)) : null);
    }

    // a seeker looking for its own target ahead (an anti-ship missile or a HARM fired without a lock): the nearest
    // hostile ship / radar within 35° of its flight path and 15 km (25 km for a HARM)
    acquire(m, dir) {
        const g = this.game;
        if (!g.ground) return null;
        const W = m.W, R = W.cls === 'arm' ? 25000 : 15000;
        let best = null, bd = R * R;
        for (const u of g.ground.targets) {
            if (!u.alive || u.hidden || u.team === m.team || u.team === 'neutral') continue;
            if (W.cls === 'ashm' ? !u.isShip : !this.emits(u)) continue;
            const r = _s2.subVectors(u.pos, m.pos), d2 = r.lengthSq();
            if (d2 > bd || r.normalize().dot(dir) < 0.82) continue;
            bd = d2; best = u;
        }
        if (best) { m.target = best; if (best.incoming) best.incoming.push(m); }
        return best;
    }

    detonate(m, t) {
        const g = this.game, W = m.W;
        g.effects.explosion(m.pos, W.boom || 0.9, m.vel);
        if (t.isFlare) return;
        this.blastPeople(m.pos, 30, 90, m.owner, m.team);
        // an air-to-air warhead's fragments: damage by how close it went off; a ground-attack one hits (and a
        // Maverick does less to a ship than an anti-ship missile: vsShip)
        const d = m.pos.distanceTo(t.pos);
        let dmg = W.ground ? W.damage : W.damage * clamp(1.5 - d / 40, 0.6, 1.3);
        if (t.isShip && W.vsShip) dmg *= W.vsShip;
        if (t.isPlayer) dmg *= 0.8;
        if (AIR_TARGETS.includes(t)) this.hitAir(t, dmg, m.owner); // a helicopter or airliner locked with T
        else if (t.damage) t.damage(dmg, m.owner, m.kind === 'rkt' ? 'rocket' : 'missile');
        // and what's round it (the rest of a SAM site, the convoy, the buildings)
        if (W.ground) {
            this.splash(m, t);
            const h = terrainHeight(m.pos.x, m.pos.z);
            if (!t.isShip && m.pos.y < h + 4 && h > 0) this.addCrater(_v2.set(m.pos.x, h, m.pos.z), 'missile', m.vel, W.crater ? { scale: W.crater } : undefined);
        }
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
        this.blastPeople(m.pos, R + 8, m.W.damage, m.owner, m.team);
    }

    // ── People: the ejected player (hit by red rounds) and enemy pilots in their seats, under their canopies or
    // standing where they landed (hit by blue rounds): a body capsule plus the canopy, which tears (pilot.js) ──
    peopleBulletHit(b, prev) {
        const g = this.game;
        if (g.infantry && g.infantry.bulletHit(b, prev)) return true; // soldiers (infantry.js)
        if (b.team === 'red') {
            const pm = g.pilotMode;
            if (!pm || !pm.alive || Math.abs(pm.pos.x - b.pos.x) > 60 || Math.abs(pm.pos.z - b.pos.z) > 60) return false;
            // a round snapping past your head
            if (b.small && !b.whizzed && segPointDistSq(prev, b.pos, _v1.copy(pm.pos).setY(pm.pos.y + 1.3)) < 9) { b.whizzed = true; g.audio.whiz && g.audio.whiz(); }
            if (!pm.bulletHit(prev, b.pos, b.damage, b)) return false;
            g.effects.impact(b.pos, null);
            return true;
        }
        for (const s of g.wreckage.seats) {
            if (!isEnemySeat(s)) continue;
            const r = s.root.position;
            if (Math.abs(r.x - b.pos.x) > 60 || Math.abs(r.z - b.pos.z) > 60 || Math.abs(r.y + 8 - b.pos.y) > 60) continue;
            const hit = seatHitTest(s, prev, b.pos);
            if (!hit) continue;
            if (hit === 'body') hitEnemySeat(g, s, b.small ? damageAt(b.def, (b.def.life - b.life) * b.def.velocity) * 1.2 : 22 + b.damage, b.owner);
            else shredEnemyCanopy(g, s, 6 + (b.small ? b.def.damage * 0.3 : b.damage * 0.4), b.owner);
            g.effects.impact(b.pos, null);
            if (b.owner === g.player || (b.owner === g.pilotMode && g.pilotMode)) g.hitmarkerT = g.time;
            return true;
        }
        return false;
    }

    // an explosion at `at`: people inside R take up to `dmg` (canopies a little further out tear).
    // `team` is the side that set it off: its own pilots are spared (null: everyone, e.g. a jet crashing).
    // Soldiers (infantry.js) are caught too unless opts.soldiers is false (ordnance.js blasts them itself).
    blastPeople(at, R, dmg, owner, team = null, opts = null) {
        const g = this.game, pm = g.pilotMode;
        if (g.infantry && !(opts && opts.soldiers === false)) g.infantry.blast(at, { R, inner: R * 0.15, peak: dmg }, owner, team);
        if (pm && pm.alive && team !== 'blue') pm.blast(at, R, dmg);
        if (team === 'red') return;
        for (const s of g.wreckage.seats) {
            if (!isEnemySeat(s)) continue;
            seatBody(s, _v1, _v2);
            const d = _v1.lerp(_v2, 0.5).distanceTo(at);
            if (d < R) hitEnemySeat(g, s, dmg * (1 - d / R), owner);
            if (!s.dead && seatCanopyUp(s)) {
                const dc = seatCanopyCenter(s, _v1).distanceTo(at);
                if (dc < R + 6) shredEnemyCanopy(g, s, dmg * 0.6 * (1 - dc / (R + 6)), owner);
            }
        }
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
                this.hitAir(t, roundVs(b, 'aircraft'), b.owner);
                g.effects.impact(b.pos, null);
                if (b.owner === g.player || (b.small && b.owner === g.pilotMode)) g.hitmarkerT = g.time;
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
                if (hit) { const d = roundVs(b, 'building'); if (d > 0) bl.damage(hit, d, g, b.owner); g.effects.impact(p, null); b.pos.copy(p); return true; }
            }
        }
        // cars: sample the step too — the band just above the road is thinner than one frame's travel
        if (b.pos.y - terrainHeight(b.pos.x, b.pos.z) < 40 && (!towns.traffic.nearAny || towns.traffic.nearAny(prev, b.pos))) {
            for (let k = 1; k <= 6; k++) {
                const p = _v1.lerpVectors(prev, b.pos, k / 6);
                const h = terrainHeight(p.x, p.z);
                if (p.y - h > 4) continue;
                if (towns.traffic.hitAt(p, roundVs(b, 'vehicle'), g, 2.8, b.owner)) {
                    g.effects.impact(p, null); b.pos.copy(p);
                    if (b.small && b.owner === g.pilotMode) g.hitmarkerT = g.time;
                    return true;
                }
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
    // kind: 'bomb', or 'blast' for anything else (plug-ins listen for 'blast': underground.js)
    worldBlast(at, R, amount, owner, kind = 'blast') {
        const g = this.game;
        if (g.events) g.events.emit('blast', at, { r: R, amount, owner, kind });
        const bl = g.world.towns && g.world.towns.buildings;
        if (bl) bl.explode(at, R, amount, g, owner);
        for (const t of AIR_TARGETS) {
            if (!t.alive) continue;
            const d = t.pos.distanceTo(at);
            if (d < R + t.radius) this.hitAir(t, amount * 0.5 * (1 - d / (R + t.radius)), owner);
        }
    }

    checkFlares(m, los, distToTarget) {
        for (const f of this.flares) {
            if (f.checked.has(m)) continue;
            if (f.owner && f.owner.team === m.team) continue; // your own side's flares don't pull your missiles
            // own scratch vector: the caller's _v2 still holds the line of sight it needs for navigation
            const r = (this._flareR || (this._flareR = new THREE.Vector3())).subVectors(f.pos, m.pos);
            const d = r.length();
            if (d > 2600 || d > distToTarget * 1.6) continue;
            // only a flare the seeker sees next to its target (within ~14°) can pull it off
            if (r.divideScalar(d).dot(los) < 0.97) continue;
            f.checked.add(m);
            // one roll per salvo per missile (a salvo is 4 flares)
            const salvos = m.salvos || (m.salvos = new Set());
            if (salvos.has(f.salvo)) continue;
            salvos.add(f.salvo);
            // a good pilot times his flares better; a modern seeker (IRCCM) sees through more of them (stores.js)
            const chance = flareChance(m.W, f.owner?.isPlayer ? 0.35 : 0.08 + (f.owner?.pilot?.skill ?? 0.5) * 0.25);
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

    // Chaff against a radar missile: a cloud the seeker sees beside the target (within ~12° and 400 m of its range)
    // can steal it — once per salvo. Head-on it rarely works; with the target beaming the missile it often does.
    checkChaff(m, t, los, distToTarget) {
        for (const c of this.chaff) {
            if (c.owner && c.owner.team === m.team) continue;
            const r = _s2.subVectors(c.pos, m.pos);
            const d = r.length();
            if (Math.abs(d - distToTarget) > 400 || r.divideScalar(Math.max(d, 1)).dot(los) < 0.978) continue;
            const salvos = m.salvos || (m.salvos = new Set());
            if (salvos.has(c.salvo)) continue;
            salvos.add(c.salvo);
            const v = t.vel.length();
            const beam = v > 60 ? 1 - Math.abs(t.vel.dot(los)) / v : 0;
            const base = c.owner?.isPlayer ? 0.45 : 0.1 + (c.owner?.pilot?.skill ?? 0.5) * 0.3;
            if (Math.random() < chaffChance(m.W, base, beam)) {
                this.loseLock(m);
                m.lost = false;
                m.target = c;
                this.game.events.emit('decoyed', m.owner, { missile: m, victim: c.owner, chaff: true });
                return;
            }
        }
    }

    updateChaff(dt) {
        for (let i = this.chaff.length - 1; i >= 0; i--) {
            const c = this.chaff[i];
            c.life -= dt;
            c.vel.multiplyScalar(Math.exp(-2.5 * dt));
            c.vel.y -= 1.5 * dt;
            c.pos.addScaledVector(c.vel, dt);
            if (c.life <= 0) { c.alive = false; this.chaff.splice(i, 1); }
        }
    }

    // ── Bombs (gravity; a guided one flies itself onto its target) ──
    // kind 'bomb': the type's bomb (stores.js: a Mk 82, a FAB-500, a cluster bomb, the X-100's MK-84X); 'gbu': its
    // guided bomb (a Paveway, a JDAM, a KAB-500); 'buster': the X-100's GBU-57X bunker buster; 'moab': its GBU-43X
    bombW(ac, kind = 'bomb') {
        const cls = kind === 'buster' || kind === 'gbu' || kind === 'moab' ? kind : 'bomb';
        return storeFor(ac, cls) || (kind === 'buster' ? WEAPONS.buster : kind === 'moab' ? WEAPONS.moab : WEAPONS.bomb);
    }

    // target: a guided bomb's (the laser's spot, or the GPS point: where the target is now)
    dropBomb(ac, kind = 'bomb', target = null) {
        const W = this.bombW(ac, kind), buster = kind === 'buster';
        const mesh = buster ? this.busterMesh() : W.id ? storeMesh(W) : this.bombGeo.clone();
        const pos = ac.pos.clone().addScaledVector(ac.getUp(_v1), buster ? -2.6 : kind === 'moab' ? -3 : -2.2);
        mesh.position.copy(pos);
        mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
        this.game.scene.add(mesh);
        const b = { mesh, pos: mesh.position, vel: ac.vel.clone().addScaledVector(ac.getUp(_v1), -4), owner: ac, team: ac.team, life: W.guided ? 300 : 90, W, kind, age: 0 }; // (a glide bomb can be minutes in the air)
        if (W.guided && target) { b.target = target; if (W.seeker === 'gps') b.aim = target.pos.clone(); }
        this.bombs.push(b);
        this.game.events.emit('bomb', ac, { kind, bomb: b });
        return b;
    }

    // A guided bomb's fins: turn the flight path onto the line to the aim point (holding it against gravity), with
    // only the lift its fins make (perpendicular to the flight path; less slow and in thin air) and the drag that
    // lift costs — so it glides only so far (ld). A laser bomb needs the spot (laserOK: the jet in sight of the
    // target, no cloud between); without it it falls (a Paveway IV on GPS to where the spot last was). A GPS bomb
    // goes to the point it was given, in any weather — a moving target won't be there.
    guideBomb(b, dt) {
        const W = b.W;
        if (b.age < 0.5) return; // (clear of the jet)
        let aim = null;
        if (W.seeker === 'laser') {
            b.laseT = (b.laseT || 0) - dt;
            if (b.laseT <= 0) { b.laseT = 0.2; b.spot = !!b.target && b.target.alive !== false && this.laserOK(b.owner, b.target); }
            if (b.spot) { aim = b.target.pos; (b.lastSpot || (b.lastSpot = new THREE.Vector3())).copy(aim); }
            else if (W.gpsBackup && b.lastSpot) aim = b.lastSpot;
        } else if (W.seeker === 'gps') aim = b.aim;
        if (aim) this.steerBomb(b.pos, b.vel, W, aim, dt);
    }
    steerBomb(pos, vel, W, aim, dt) {
        const v = vel.length();
        if (v < 1) return;
        const vhat = _s1.copy(vel).divideScalar(v);
        const acc = _s2.subVectors(aim, pos).normalize().multiplyScalar(v).sub(vel).multiplyScalar(1.6);
        acc.y += G;
        acc.addScaledVector(vhat, -acc.dot(vhat));
        const maxA = W.lift * G * (v / 250) ** 2 * Math.exp(-Math.max(pos.y, 0) / 9000);
        const a = acc.length();
        if (a > maxA) acc.multiplyScalar(maxA / a);
        vel.addScaledVector(acc, dt);
        vel.addScaledVector(vhat, -Math.min(a, maxA) * W.ld * dt);
    }

    // Could a guided bomb released now reach `aim`? Its flight simulated at 10 Hz (the HUD's IN RANGE cue):
    // { ok, miss (m), tof (s) }
    bombReach(ac, W, aim) {
        const up = ac.getUp(_s3);
        const pos = (this._rp || (this._rp = new THREE.Vector3())).copy(ac.pos).addScaledVector(up, -2.2);
        const vel = (this._rv || (this._rv = new THREE.Vector3())).copy(ac.vel).addScaledVector(up, -4);
        const dt = 0.1;
        let t = 0;
        for (; t < 150; t += dt) {
            vel.y -= G * dt;
            vel.multiplyScalar(1 - W.drag * dt);
            if (t > 0.5) this.steerBomb(pos, vel, W, aim, dt);
            if (W.thrust && t > 0.5 && t < 0.5 + W.boost) vel.addScaledVector(_s4.copy(vel).normalize(), W.thrust * dt);
            pos.addScaledVector(vel, dt);
            if (pos.y < aim.y + 2 || pos.y < Math.max(terrainHeight(pos.x, pos.z), 0)) break;
        }
        const miss = Math.hypot(pos.x - aim.x, pos.z - aim.z);
        return { ok: miss < Math.max(12, (W.splash || 30) * 0.35), miss, tof: t };
    }

    // a cluster bomb opens: the case splits and its bomblets scatter over a circle `spread` m across on the ground
    openCluster(b) {
        const C = b.W.cluster, fx = this.game.effects;
        const h = Math.max(1, b.pos.y - this.game.surfaceAt(b.pos.x, b.pos.z, b.pos.y).h);
        const vy = Math.max(0, -b.vel.y), tFall = Math.max(0.5, (Math.sqrt(vy * vy + 2 * G * h) - vy) / G);
        for (let k = 0; k < C.n; k++) {
            const a = rand(0, Math.PI * 2), s = C.spread * Math.sqrt(Math.random()) / tFall;
            this.bomblets.push({ pos: b.pos.clone(), vel: b.vel.clone().add(_v1.set(Math.cos(a) * s, rand(-4, 4), Math.sin(a) * s)), owner: b.owner, team: b.team, C, n: k });
        }
        fx.smoke.emit(b.pos, _v1.set(0, 0, 0), 2.5, 3, 12, [0.55, 0.55, 0.52], [0.7, 0.7, 0.68], 0.5, 0, 1.5, 0);
        fx.sparks && fx.sparks.emit && fx.sparks.emit(b.pos, b.vel, 0.4, 1.2, 0.4, [4, 3, 2], [2, 1, 0.4], 1, 0, 0, 0);
    }

    updateBomblets(dt) {
        const g = this.game, fx = g.effects;
        for (let i = this.bomblets.length - 1; i >= 0; i--) {
            const q = this.bomblets[i];
            q.vel.y -= G * dt;
            q.vel.multiplyScalar(1 - 0.08 * dt); // (a little ribbon / chute on each)
            q.pos.addScaledVector(q.vel, dt);
            const s = g.surfaceAt(q.pos.x, q.pos.z, q.pos.y + 2);
            let hitShip = null;
            if (g.ground) for (const t of g.ground.targets) if (t.alive && t.hitTest && t.team !== q.team && t.hitTest(q.pos)) { hitShip = t; break; }
            if (q.pos.y > s.h && !hitShip) continue;
            this.bomblets[i] = this.bomblets[this.bomblets.length - 1]; this.bomblets.pop();
            const at = q.pos.clone();
            if (!hitShip) at.y = s.h;
            const C = q.C;
            if (s.water && !hitShip) { fx.waterSplash ? fx.waterSplash(at, 0.4) : null; continue; }
            fx.explosion(at, 0.75);
            if (q.n % 6 === 0) g.audio.boom(g.camera.position.distanceTo(at), 0.5);
            if (g.ground) for (const t of g.ground.targets) {
                if (!t.alive || t.team === q.team) continue;
                if (t === hitShip) { t.damage(C.dmg, q.owner, 'bomb'); continue; }
                const d = t.distTo ? t.distTo(at) : t.pos.distanceTo(at);
                if (d < C.r + t.radius) t.damage(C.dmg * clamp(1.2 - d / (C.r + t.radius), 0.25, 1), q.owner, 'bomb');
            }
            g.world.towns?.traffic.blast(at, C.r * 0.8, g);
            this.worldBlast(at, C.r, C.dmg * 2, q.owner, 'bomb');
            this.blastPeople(at, C.r * 1.6, 110, q.owner, q.team);
        }
    }

    // the GBU-57X: a slim 6 m case with an ogive nose, a yellow band and lattice fins (nose along -Z, like the bomb)
    busterMesh() {
        if (!this.busterGeo) {
            const g = new THREE.Group();
            const dark = new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.5, metalness: 0.35 });
            const band = new THREE.MeshStandardMaterial({ color: 0xd9ad2b, roughness: 0.55 });
            const along = (m, z) => { m.rotation.x = Math.PI / 2; m.position.z = z; return m; };
            const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.3, 14), dark);
            nose.rotation.x = -Math.PI / 2; nose.position.z = -2.95;
            const fin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.7), dark);
            fin.position.z = 2.3;
            const fin2 = fin.clone(); fin2.rotation.z = Math.PI / 2;
            g.add(along(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 4.6, 14), dark), 0), nose,
                along(new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.41, 0.25, 14), band), -1.6),
                along(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.6, 14), dark), 2.6), fin, fin2);
            this.busterGeo = g;
        }
        return this.busterGeo.clone();
    }

    // Predict where a bomb released now would land (for the CCIP pipper); W: which bomb (its drag)
    predictBomb(ac, out, W = WEAPONS.bomb) {
        const up = ac.getUp(_v2);
        const p = _v3.copy(ac.pos).addScaledVector(up, -2.2), v = _v4.copy(ac.vel).addScaledVector(up, -4);
        const dt = 0.05;
        for (let t = 0; t < 40; t += dt) {
            v.y -= G * dt;
            v.multiplyScalar(1 - W.drag * dt);
            p.addScaledVector(v, dt);
            if (p.y > 2100) continue; // above every mountain: skip the terrain query
            const s = this.game.surfaceAt(p.x, p.z, p.y);
            if (p.y <= s.h) return out.copy(p).setY(s.h);
        }
        return null;
    }

    updateBombs(dt) {
        const g = this.game;
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const b = this.bombs[i], W = b.W || WEAPONS.bomb;
            // a bunker buster in the ground: its delay fuse, then it goes off deep under where it went in
            if (b.buried) {
                if ((b.fuseT -= dt) > 0) continue;
                this.bombBurst(b, b.at, b.surf, false, null, b.onBuilding);
                g.scene.remove(b.mesh);
                this.bombs.splice(i, 1);
                continue;
            }
            b.life -= dt;
            b.age = (b.age || 0) + dt;
            b.vel.y -= G * dt;
            b.vel.multiplyScalar(1 - W.drag * dt);
            if (W.guided) this.guideBomb(b, dt);
            // (a rocket in the tail of the AASM: further still)
            if (W.thrust && b.age > 0.5 && b.age < 0.5 + W.boost) b.vel.addScaledVector(_v1.copy(b.vel).normalize(), W.thrust * dt);
            b.pos.addScaledVector(b.vel, dt);
            b.mesh.quaternion.setFromUnitVectors(_v1.set(0, 0, -1), _v2.copy(b.vel).normalize());
            const s = g.surfaceAt(b.pos.x, b.pos.z, b.pos.y + 2);
            // a cluster bomb opens at its height (or as it's about to hit, dropped low)
            if (W.cluster && b.age > 0.6 && (b.pos.y - s.h < W.cluster.agl || b.pos.y + b.vel.y * 0.25 < s.h)) {
                this.openCluster(b);
                g.scene.remove(b.mesh);
                this.bombs.splice(i, 1);
                continue;
            }
            const blds = g.world.towns && g.world.towns.buildings;
            const onBuilding = blds && blds.at(b.pos.x, b.pos.y, b.pos.z);
            let hitShip = null;
            if (g.ground) for (const t of g.ground.targets) if (t.alive && t.hitTest && t.team !== b.team && t.hitTest(b.pos)) { hitShip = t; break; }
            if (b.pos.y > s.h && !hitShip && !onBuilding && b.life > 0) continue;
            // impact
            const at = b.pos.clone();
            if (!hitShip && !onBuilding) at.y = s.h;
            const wet = s.water && !hitShip;
            if (b.kind === 'buster' && !wet && !hitShip && b.life > 0) {
                // it punches straight in (through a roof, into the ground): a spurt of dust, and the fuse runs
                b.buried = true; b.fuseT = W.fuse; b.at = at; b.surf = s; b.onBuilding = !!onBuilding;
                b.mesh.visible = false;
                g.effects.dustBurst(at, 0.9, 0.7);
                g.audio.boom(g.camera.position.distanceTo(at), 0.35);
                continue;
            }
            this.bombBurst(b, at, s, wet, hitShip, onBuilding);
            g.scene.remove(b.mesh);
            this.bombs.splice(i, 1);
        }
    }

    // A bomb going off at `at` (s: the surface there): the blast, the crater, the damage. A Mk 82 is the yardstick
    // (k = 1); the MK-84X's and the MOAB's fireballs are bigger (their `fx` size; the MOAB's crater wide and shallow:
    // MOAB_CRATER), and a bunker buster goes off deep in the ground: the
    // earth heaves up in a fountain, a deep crater, and what it hits takes it as a penetrator (through hardened
    // shelters, tunnel portals, command bunkers)
    bombBurst(b, at, s, wet, hitShip, onBuilding) {
        const g = this.game, fx = g.effects, W = b.W || WEAPONS.bomb;
        const buster = b.kind === 'buster', size = W.fx || 2.4, k = size / 2.4;
        const dmgKind = buster ? 'penetrator' : 'bomb';
        if (wet) {
            // into the sea it goes off a few metres down (a buster deeper): the column, the base surge, the slick (splash.js)
            if (fx.water) fx.water.blast(at, { kg: W.kg ?? WARHEAD_KG.bomb, depth: buster ? 'optimal' : 'shallow', vel: b.vel, agl: 0 });
            else { fx.waterSplash(at, 2.2 * k); fx.explosion(at, 0.8 * k); }
        } else if (buster && !hitShip) {
            // under the ground: a geyser of earth and rock, a deep hole (effects.js earthFountain)
            if (fx.earthFountain) fx.earthFountain(at, 1.7); else fx.explosion(at, size);
            fx.debrisBurst(at, _v1.set(0, 70, 0), 14, 1.6);
            if (!onBuilding && !s.ship && !s.bridge) this.addCrater(at, BUSTER_CRATER, b.vel);
        } else {
            // the MK-84X and the MOAB: a mushroom cloud over a ring of dust (effects.js megaBlast)
            if (k > 1.5 && fx.megaBlast) fx.megaBlast(at, k); else fx.explosion(at, size);
            fx.debrisBurst(at, _v1.set(0, 40 * Math.sqrt(k), 0), Math.round(5 * k), 0.8 * Math.sqrt(k));
            for (let n = 0; n < Math.round(20 * Math.min(k, 2)); n++) fx.smoke.emit(at, _v1.set(rand(-25, 25), rand(15, 60), rand(-25, 25)).multiplyScalar(Math.sqrt(k)), rand(2, 4), 6 * Math.sqrt(k), 22 * Math.sqrt(k), [0.35, 0.3, 0.24], [0.5, 0.45, 0.38], 0.8, 0, 1.2, -12);
            if (!hitShip && !s.ship && !onBuilding && !s.bridge) {
                if (b.kind === 'moab') this.addCrater(at, MOAB_CRATER, b.vel);
                else this.addCrater(at, 'bomb', b.vel, W.crater ? { scale: W.crater } : undefined);
            }
        }
        const camD = g.camera.position.distanceTo(at);
        if (!wet || !fx.water) g.audio.boom(camD, 1.6 * Math.sqrt(k)); // (in the water: splash.js's own whoomp)
        if (camD < 800 * Math.sqrt(k)) g.shake = Math.min(1.5 * Math.sqrt(k), g.shake + (wet ? 0.45 : 0.6) * Math.sqrt(k));
        g.events.emit('bombImpact', b, { at, water: wet, ship: hitShip, W, kind: b.kind || 'bomb' }); // (bases.js: runway craters)
        // splash damage
        if (g.ground) for (const t of g.ground.targets) {
            if (!t.alive || t.team === b.team) continue;
            if (t === hitShip) { t.damage(W.damage * 1.6, b.owner, dmgKind); continue; }
            const d = t.distTo ? t.distTo(at) : t.pos.distanceTo(at);
            if (buster && d < 4) { t.damage(W.damage * 1.6, b.owner, dmgKind); continue; } // (went in right on it)
            if (d < W.splash + t.radius) t.damage(W.damage * clamp(1.2 - d / (W.splash + t.radius), 0.2, 1), b.owner, dmgKind);
        }
        g.world.towns?.traffic.blast(at, W.splash * 0.7, g);
        this.worldBlast(at, W.splash, W.damage * 4, b.owner, dmgKind);
        this.blastPeople(at, Math.max(75, W.splash * 1.3), 180 * Math.max(1, k), b.owner, b.team);
        const R = Math.max(60, W.splash * 0.8);
        for (const a of g.aircraft) {
            if (!a.alive || a.team === b.team) continue;
            const d = a.pos.distanceTo(at);
            if (d < R) a.damage(W.damage * (1 - d / R), b.owner, 'missile');
        }
    }

    // ── Craters (craters.js): a hole in the ground where something blew up on it ──
    // at: the point on the ground; kind: a CRATER_KINDS key ('rkt', 'missile', 'bomb', ...) or a shape
    // ({ r, rb, depth, rim, ... }); vel: what hit (a gouge runs along an elongated crater's long axis)
    addCrater(at, kind = 'missile', vel = null, opts = {}) {
        const g = this.game, C = g.world && g.world.craters;
        if (!C) return null;
        const K = typeof kind === 'string' ? CRATER_KINDS[kind] || CRATER_KINDS.missile : kind;
        const r = Math.max(K.r, K.rb || 0) * (opts.scale || 1);
        if (!this.craterSite(at.x, at.z, at.y, r)) return null;
        const c = C.add(at.x, at.z, K, { dir: K.rb && vel ? vel : null, scale: opts.scale || 1, instant: !!opts.instant });
        if (!c) return null;
        // earth thrown out of it
        if (!opts.quiet) g.effects.ejecta(at, r);
        // vehicles and wrecks in it settle into it
        if (g.ground) for (const t of g.ground.targets) {
            if (t.radius > 9 || (t.route && t.alive) || t.sinking) continue;
            const mp = t.mesh.position;
            if (Math.abs(mp.x - at.x) > r * 3 || Math.abs(mp.z - at.z) > r * 3) continue;
            const a = craterAdj(mp.x, mp.z), d = a - (t.craterY || 0);
            mp.y += d; t.pos.y += d; t.craterY = a;
        }
        return c;
    }

    // Can the ground at (x, z) take a crater of radius r? Dry land only (the whole hole), not on a runway or
    // inside an airbase fence, a bridge, a building or right under a big ground target
    craterSite(x, z, y, r) {
        const g = this.game;
        for (let k = 0; k < 7; k++) {
            const a = k * 0.9, d = k ? r * 1.3 : 0, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
            if (terrainHeight(px, pz) < 1.5 || isOnRunway(px, pz)) return false;
        }
        if (outsideBases(x, z, 40)) return false; // (non-null: inside a fence, plus a margin)
        const towns = g.world.towns;
        if (towns) {
            if (towns.bridgeAt && towns.bridgeAt(x, z, y + 6) != null) return false;
            const bl = towns.buildings;
            if (bl && bl.at(x, y + 1, z, r * 0.5)) return false;
        }
        if (g.naval && g.naval.ships.length && g.naval.deckAt(x, z, y + 6)) return false;
        if (g.ground) for (const t of g.ground.targets) {
            if (t.radius > 9 && Math.hypot(t.pos.x - x, t.pos.z - z) < t.radius * 0.8 + r * 0.5) return false;
        }
        return true;
    }

    // ── Flares ──
    dropFlares(ac, now) {
        if (!ac.alive || ac.flares <= 0 || now - ac.lastFlare < 0.35) return false;
        ac.lastFlare = now;
        ac.flares--;
        const up = ac.getUp(_v1), right = ac.getRight(_v2);
        const salvo = {};
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
            this.flares.push({ sprite: s, pos: s.position, vel, life: rand(3, 4), owner: ac, isFlare: true, alive: true, hitRadius: 0, checked: new Set(), salvo, smokeT: 0, trail: null });
        }
        // and a bundle of chaff (the dispenser runs a program: flares for the heat seekers, chaff for the radars) —
        // a glittering cloud that stops dead in the air while the jet flies on
        const cpos = ac.pos.clone().addScaledVector(up, -1.5);
        this.chaff.push({ pos: cpos, vel: ac.vel.clone().multiplyScalar(0.25), life: 4.5, owner: ac, isFlare: true, isChaff: true, alive: true, hitRadius: 0, salvo: {} });
        const fx = this.game.effects;
        for (let k = 0; k < 5; k++) fx.smoke.emit(cpos, _v3.copy(ac.vel).multiplyScalar(0.12).add(_v4.set(rand(-6, 6), rand(-6, 6), rand(-6, 6))), rand(2.5, 3.5), 2, rand(10, 16), [0.78, 0.8, 0.84], [0.72, 0.74, 0.78], 0.22, 0, 2.2, -0.5);
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
        if (this.bomblets.length) this.updateBomblets(dt);
        this.updateMissiles(dt);
        this.updateFlares(dt);
    }

    clear() {
        for (const b of this.bullets) if (b.pooled && this.bulletPool.length < 4000) { b.owner = null; this.bulletPool.push(b); }
        this.bullets.length = 0;
        for (let i = this.missiles.length - 1; i >= 0; i--) this.removeMissile(i);
        this.flares.forEach(f => this.game.scene.remove(f.sprite));
        this.flares.length = 0;
        this.chaff.length = 0;
        this.bombs.forEach(b => this.game.scene.remove(b.mesh));
        this.bombs.length = 0;
        this.bomblets.length = 0;
        if (this.game.world && this.game.world.craters) this.game.world.craters.clear();
    }
}

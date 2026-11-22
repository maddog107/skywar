// ═══════════════════════════════════════════════════════════════
// Multiplayer (docs/MULTIPLAYER.md): bombs and unguided rockets, the same for everyone.
//
// What another pilot drops or fires is drawn here as a ghost that follows the same path: the store's own mesh, a
// rocket's motor, trail and light. A bomb or a rocket that isn't guided flies by gravity, drag and its motor alone, so
// one launch message (`ord`: where it left the jet's station, its velocity, its age and roll; a rocket pod's whole
// salvo in one) lets every client fly it with the same equations as weapons.js, in its owner's past like his jet; a
// guided bomb (it steers on its owner's laser spot or GPS point) rides in his snapshots instead, as missiles do.
// When it ends, its owner says where and how (`blast`: on the ground, in the sea, into a building, a cluster bomb
// opening, a bunker buster going in), and the ghost ends there — when our picture of it gets there — with the
// game's own burst: the same fireball, mushroom cloud, crater, sound and camera shake (weapons.js bombBurst with the
// ghost marked `show`, which stops before the damage). A peer's blast still hurts the buildings round it here, but
// never brings one down (networld.js: only its owner's word does), and it never hurts an aircraft: aircraft damage
// is the shooter's, applied by the owner through hit claims.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { STORES, CLASS } from './stores.js';
import { storeMesh } from './weapons.js';
import { terrainHeight } from './world.js';
import { WARHEAD_KG } from './splash.js';
import { fireLights, FIRE_COLORS } from './firelight.js';
import { G, rand } from './util.js';
import { InterpBuffer } from './netinterp.js';
import {
    NMAX, MAX_MISSILE_ID, MAX_MISSILES, ORD_KINDS, ORD_HEAD, ORD_ITEM, ORD_PER_EVENT, BLAST_HEAD, BLAST_ITEM, BLAST_PER_EVENT, HOW,
    encodeMissile,
} from './netproto.js';

// Nothing a peer sends is trusted: what it can make us build is capped, however often it repeats itself
const PEER_ORD = 64, MAX_ORD = 192;   // ghosts of bombs and rockets: one peer's, everyone's
const ORD_RATE = 24, ORD_BURST = 48;  // launches a second from one peer (a pod's salvo of 6 every 0.35 s is 17)
const OPEN_RATE = 4;                  // cluster bombs opening a second from one peer (a release every 0.25 s at most)
const REACH = 3000;                   // m: an end further than this from where we have the ghost is not believed
const STEP = 1 / 60;                  // s: the ghosts fly on in steps of at most this
const WAIT_MAX = 1;                   // s: an end (or a launch) waits at most this long for our picture of it
export const ORD_LIMITS = { PEER_ORD, MAX_ORD, ORD_RATE, ORD_BURST, OPEN_RATE, REACH };

const own = (table, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
const int = (x, lo, hi) => (typeof x === 'number' && x >= lo && x <= hi && x === Math.floor(x) ? x : -1);
const fin = (x) => typeof x === 'number' && isFinite(x);
const inWorld = (x, y, z) => Math.abs(x) <= 250000 && Math.abs(z) <= 250000 && y >= -1000 && y <= 90000;
const r2 = (x) => Math.round(x * 100) / 100, r1 = (x) => Math.round(x * 10) / 10;
function allow(b, now, rate, cap) {
    b.n = Math.min(cap, (b.n ?? cap) + Math.max(0, now - (b.t ?? now)) * rate);
    b.t = now;
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
}
const FWD = new THREE.Vector3(0, 0, -1), AXIS_Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _S = { age: 0 };

export class NetOrdnance {
    constructor(mp) {
        this.mp = mp;
        this.mine = new Map();      // ours in flight: weapon object → { id, kind, W, n, guided, rkt, buried }
        this.launched = [];         // released this frame (sent at the end of it)
        this.rowAt = 0;             // (guided bombs' rows, by turns when there are more than fit)
        this.ghosts = new Set();    // everyone else's, as we draw them (each peer's own, by its id: peer.ord)
        this.bursts = 0;            // ends played here (tests, the e2e check)
    }

    clear() {
        for (const gh of [...this.ghosts]) this.remove(gh);
        this.mine.clear(); this.launched.length = 0;
    }
    // the connection dropped: what we fire meanwhile nobody sees (its end is not told either)
    forget() { this.mine.clear(); this.launched.length = 0; }

    // ═════════════ Ours ═════════════
    // weapons.js dropBomb's 'bomb' event, and fireMissile's 'missileLaunch' for a rocket (of an aircraft we fly)
    onBomb(ac, b, kind) {
        const e = this.mp.locals.get(ac);
        if (!e || !b || b.show || !b.W) return;
        this.launched.push({ n: e.n, obj: b, kind: ORD_KINDS.includes(kind) ? kind : 'bomb', W: b.W, guided: !!(b.W.guided && b.target), rkt: false });
    }
    onRocket(ac, m) {
        const e = this.mp.locals.get(ac);
        if (!e || !m || !m.W) return;
        this.launched.push({ n: e.n, obj: m, kind: 'rkt', W: m.W, guided: false, rkt: true });
    }

    // every frame (after weapons.update): what we released this frame goes out, one event per aircraft and store (a
    // pod's salvo in one), and what of ours ended
    update(dt, now) {
        if (this.launched.length) this.sendLaunches();
        if (this.mine.size) this.trackEnds();
        if (this.ghosts.size) this.updateGhosts(dt, now);
    }

    clock() { return Math.round(this.mp.frameNow() * 1e4) / 10; }

    sendLaunches() {
        const mp = this.mp, wp = mp.game.weapons, c = this.clock();
        let ev = null, key = '';
        for (const L of this.launched) {
            const o = L.obj;
            if (!(L.rkt ? wp.missiles : wp.bombs).includes(o)) continue; // (gone already)
            const id = mp.nextMissile = mp.nextMissile % 60000 + 1; // (one numbering with our missiles: a row's id names one)
            this.mine.set(o, { id, kind: L.kind, W: L.W, n: L.n, guided: L.guided, rkt: L.rkt, buried: false });
            const store = L.W.id || '', k = L.n + ':' + store + ':' + L.kind + ':' + (L.guided ? 1 : 0);
            if (!ev || k !== key || (ev.length - ORD_HEAD) / ORD_ITEM >= ORD_PER_EVENT) {
                if (ev) mp.send(ev);
                ev = ['ord', L.n, store, ORD_KINDS.indexOf(L.kind), L.guided ? 1 : 0, c]; key = k;
            }
            const p = o.pos, v = o.vel;
            ev.push(id, r2(p.x), r2(p.y), r2(p.z), r1(v.x), r1(v.y), r1(v.z), Math.round((o.age || 0) * 1000), Math.round((o.twist || 0) * 100));
        }
        if (ev) mp.send(ev);
        this.launched.length = 0;
    }

    // ours that ended this frame (weapons.js took them out: the burst is marked on them, endHow / how), and a bunker
    // buster that went into the ground (it goes off after its fuse on every client)
    trackEnds() {
        const mp = this.mp, wp = mp.game.weapons;
        let ev = null;
        const add = (id, at, how) => {
            if (!ev || (ev.length - BLAST_HEAD) / BLAST_ITEM >= BLAST_PER_EVENT) { if (ev) mp.send(ev); ev = ['blast', this.clock()]; }
            ev.push(id, r2(at.x), r2(at.y), r2(at.z), how);
        };
        for (const [o, r] of this.mine) {
            if ((r.rkt ? wp.missiles : wp.bombs).includes(o)) {
                if (!r.rkt && o.buried && !r.buried) { r.buried = true; add(r.id, o.at || o.pos, o.onBuilding ? HOW.BURIED_IN : HOW.BURIED); }
                continue;
            }
            this.mine.delete(o);
            if (r.buried) continue; // (told already)
            if (r.rkt) add(r.id, o.pos, o.how === 0 ? HOW.HIT : o.how === 1 ? HOW.GROUND : o.how === 3 ? HOW.WORLD : HOW.QUIET);
            else add(r.id, o.endAt || o.pos, o.endHow >= 0 ? o.endHow : HOW.QUIET);
        }
        if (ev) mp.send(ev);
    }

    // our guided bombs' rows for the snapshot (after our missiles', `room` left): by turns when they don't all fit
    rows(ms) {
        const room = MAX_MISSILES - ms.length;
        if (room <= 0 || !this.mine.size) return;
        const list = [];
        for (const [o, r] of this.mine) if (r.guided && !r.buried) list.push([o, r]);
        if (!list.length) return;
        const n = Math.min(room, list.length), at = list.length > room ? this.rowAt++ % list.length : 0;
        for (let k = 0; k < n; k++) {
            const [o, r] = list[(at + k) % list.length];
            ms.push(encodeMissile({ id: r.id, pos: o.pos, vel: o.vel, bomb: true }));
        }
    }

    // ═════════════ Theirs ═════════════
    // the store a peer names, for the kind it says: one of the store table's own entries of that class, or the plain
    // table for the kind (weapons.js bombW / fireMissile); a store of another class is refused
    weaponOf(store, kind) {
        if (store) {
            if (!own(STORES, store)) return null;
            const W = STORES[store];
            return W.cls === kind ? W : null;
        }
        return kind === 'buster' ? WEAPONS.buster : kind === 'moab' ? WEAPONS.moab : kind === 'rkt' ? WEAPONS.rkt : WEAPONS.bomb;
    }

    // e: ['ord', its aircraft's number, store, kind, guided, its clock (ms), …items]
    onOrd(peer, e) {
        const mp = this.mp, now = mp.now();
        const n = int(e[1], 0, NMAX - 1), kind = ORD_KINDS[int(e[3], 0, ORD_KINDS.length - 1)], c = e[5];
        if (n < 0 || !kind || typeof e[2] !== 'string' || !fin(c) || c < 0) return;
        if (n > 0 && peer.id !== mp.room.host) return; // (only the host flies anything but its own jet)
        const W = this.weaponOf(e[2], kind);
        if (!W) return;
        const guided = e[4] === 1 && !!W.guided;
        for (let off = ORD_HEAD; off + ORD_ITEM <= e.length; off += ORD_ITEM) {
            if (!allow(peer.ordB || (peer.ordB = {}), now, ORD_RATE, ORD_BURST)) break;
            this.make(peer, n, W, kind, guided, c / 1000, e, off, now);
        }
    }

    // every ghost is made here, so the limits hold: one per (peer, id), so many per peer and in all; a position off
    // the map or a speed nothing dropped from a jet has is refused
    make(peer, n, W, kind, guided, c, e, off, now) {
        const g = this.mp.game, wp = g.weapons;
        const id = int(e[off], 1, MAX_MISSILE_ID);
        if (id < 0 || peer.ord.has(id) || peer.ord.size >= PEER_ORD || this.ghosts.size >= MAX_ORD) return null;
        for (let k = 1; k < ORD_ITEM; k++) if (!fin(e[off + k])) return null;
        const x = e[off + 1], y = e[off + 2], z = e[off + 3], vx = e[off + 4], vy = e[off + 5], vz = e[off + 6];
        if (!inWorld(x, y, z) || Math.hypot(vx, vy, vz) > 2500) return null;
        const age = Math.min(Math.max(e[off + 7] / 1000, 0), 2), twist = Math.max(-7, Math.min(7, e[off + 8] / 100));
        const rkt = kind === 'rkt';
        let mesh;
        if (rkt) {
            if (W.id) mesh = storeMesh(W);
            else mesh = new THREE.Mesh(wp.rocketGeo, wp.missileMat);
        } else {
            mesh = kind === 'buster' ? wp.busterMesh() : W.id ? storeMesh(W) : wp.bombGeo.clone();
            mesh.traverse(o => { if (o.isMesh) o.castShadow = true; });
        }
        mesh.position.set(x, y, z);
        mesh.visible = false; // (until our picture of the jet that released it gets there)
        g.scene.add(mesh);
        const gh = {
            id, peer, n, W, kind, rkt, guided, mesh, pos: mesh.position, vel: new THREE.Vector3(vx, vy, vz),
            c0: c, t: c, age, twist, shown: false, at: now, heard: now, end: null, fuseT: 0, onBuilding: false, groundT: 0,
            buf: guided ? new InterpBuffer(8) : null, trail: null, show: true, owner: null, team: peer.team,
        };
        if (gh.buf) gh.buf.push(c, { px: x, py: y, pz: z, vx, vy, vz });
        this.ghosts.add(gh);
        peer.ord.set(id, gh);
        return gh;
    }

    // a guided bomb's row in its owner's snapshot (multiplayer.js onMissile: rows marked as a bomb's come here)
    onRow(peer, c, d, now) {
        const gh = peer.ord.get(d.id);
        if (!gh || !gh.guided || gh.end) return; // (one we never saw released: not drawn)
        gh.buf.push(c, d);
        gh.heard = now;
    }

    // e: ['blast', its clock (ms), …[id, x, y, z, how]]: those of its ended there
    onBlast(peer, e) {
        const now = this.mp.now(), c = fin(e[1]) && e[1] >= 0 ? e[1] / 1000 : -1;
        for (let off = BLAST_HEAD; off + BLAST_ITEM <= e.length; off += BLAST_ITEM) {
            const gh = peer.ord.get(int(e[off], 1, MAX_MISSILE_ID));
            if (!gh || gh.end || gh.fuseT > 0) continue;
            const x = e[off + 1], y = e[off + 2], z = e[off + 3], how = int(e[off + 4], 0, HOW.QUIET);
            const ok = fin(x) && fin(y) && fin(z) && inWorld(x, y, z);
            gh.end = { c: c >= 0 ? c : gh.t, x: ok ? x : NaN, y, z, how: how < 0 ? HOW.QUIET : how, at: now };
        }
    }

    removePeer(peer) { for (const gh of [...peer.ord.values()]) this.remove(gh); }

    remove(gh) {
        const g = this.mp.game;
        this.ghosts.delete(gh);
        if (gh.peer.ord.get(gh.id) === gh) gh.peer.ord.delete(gh.id);
        if (gh.trail) gh.trail.emitting = false;
        g.scene.remove(gh.mesh);
    }

    // the moment a peer's picture is drawn at (its jet's too); before its first snapshot, the wall clock since it came
    drawn(gh, now) {
        const p = gh.peer;
        return p.clock.offset != null ? this.mp.frameNow() - p.clock.offset - p.delay : gh.c0 + (now - gh.at);
    }

    updateGhosts(dt, now) {
        for (const gh of this.ghosts) {
            // a bunker buster in the ground: its fuse, then it goes off
            if (gh.fuseT > 0) { if ((gh.fuseT -= dt) <= 0) { this.burstBomb(gh, gh.onBuilding); this.remove(gh); } continue; }
            const T = this.drawn(gh, now);
            if (!gh.shown) {
                if (T < gh.c0 && now - gh.at < WAIT_MAX) continue; // (not released yet in the picture we draw)
                this.reveal(gh, now);
            }
            const E = gh.end, until = E ? Math.min(T, E.c) : T;
            if (gh.guided) {
                if (now - gh.heard > 3 && !E) { this.remove(gh); continue; } // (its owner stopped reporting it)
                if (gh.buf.sample(Math.max(until, gh.c0), _S)) { gh.pos.set(_S.px, _S.py, _S.pz); gh.vel.set(_S.vx, _S.vy, _S.vz); }
                gh.age += dt;
            } else this.fly(gh, until);
            if (E && (T >= E.c || now - E.at > WAIT_MAX)) { this.finish(gh, now); continue; }
            // no word of it for far longer than it can fly (its owner left without one): gone
            if (!E && now - gh.at > (gh.rkt ? (gh.W.life || 5) + 5 : gh.guided ? 330 : 120)) { this.remove(gh); continue; }
            const sp = gh.vel.length();
            if (sp > 1) {
                gh.mesh.quaternion.setFromUnitVectors(FWD, _v.copy(gh.vel).divideScalar(sp));
                if (gh.twist) gh.mesh.quaternion.multiply(_q.setFromAxisAngle(AXIS_Z, gh.twist));
            }
            if (gh.rkt) this.motor(gh, sp);
        }
    }

    // its jet's picture got to the release: there it is, leaving the station (which empties on the puppet)
    reveal(gh, now) {
        const g = this.mp.game;
        gh.shown = true;
        gh.mesh.visible = true;
        const rec = gh.peer.ents.get(gh.n), ac = rec && rec.ac;
        gh.owner = ac || null;
        if (ac && !gh.rkt && CLASS[gh.kind]) { const f = CLASS[gh.kind].ammo; if (ac[f] > 0) ac[f]--; }
        if (gh.rkt) {
            gh.trail = g.effects.addTrail({ max: 220, width: 0.6, life: 2, color: [0.92, 0.92, 0.9], alpha: 0.5, minDist: 10, widthGrow: 2.2 });
            const d = g.camera.position.distanceTo(gh.pos);
            if (d < 1500 && now - (gh.peer.whooshT || -9) > 0.2 && g.audio && g.audio.whoosh) { gh.peer.whooshT = now; g.audio.whoosh(0.35 * (1 - d / 1500)); }
        }
    }

    // On from where it was to time T of its owner's clock, by weapons.js's own equations (updateBombs for a bomb,
    // updateMissiles for an unguided rocket), in steps of at most STEP; it stops on the ground (its owner's word of
    // where it ended will come)
    fly(gh, T) {
        const W = gh.W, p = gh.pos, v = gh.vel;
        let left = T - gh.t;
        if (left <= 0) return;
        if (left > 30) left = 30; // (a long gap: a hidden tab)
        gh.t = T;
        for (let steps = 0; left > 1e-6 && steps < 2000; steps++) {
            const dt = Math.min(STEP, left);
            left -= dt;
            gh.age += dt;
            if (gh.rkt) {
                const speed = v.length(), k = 1 / Math.max(speed, 1);
                if (gh.age < W.boost + 0.25) v.addScaledVector(_v.copy(v).multiplyScalar(k), W.accelBoost * dt);
                const rho = Math.exp(-Math.max(p.y, 0) / 9000);
                v.addScaledVector(_v.copy(v).multiplyScalar(k), -speed * speed * 0.00018 * (W.drag ?? 1) * rho * dt);
                v.y -= G * dt * 0.5;
            } else {
                v.y -= G * dt;
                v.multiplyScalar(1 - W.drag * dt);
                if (W.thrust && gh.age > 0.5 && gh.age < 0.5 + W.boost) v.addScaledVector(_v.copy(v).normalize(), W.thrust * dt);
            }
            p.addScaledVector(v, dt);
            const h = Math.max(terrainHeight(p.x, p.z), 0);
            if (p.y < h) { p.y = h; v.set(0, 0, 0); break; } // (on the ground: waiting for its owner's word)
        }
    }

    // a rocket's motor: flame, smoke trail and its light, while it burns (as weapons.js draws a missile's)
    motor(gh, sp) {
        const fx = this.mp.game.effects, W = gh.W;
        if (gh.age > 0.25 && gh.age < W.boost + 0.25 && sp > 1) {
            gh.trail.push(gh.pos, fx.now);
            fx.fire.emit(gh.pos, _v.copy(gh.vel).multiplyScalar(0.7), 0.06, 2.2, 0.8, [6, 4.5, 2.2], [3, 1, 0.2], 1, 0, 0, 0);
            if (Math.random() < 0.5) fx.smoke.emit(gh.pos, _v.copy(gh.vel).multiplyScalar(0.05), rand(1.5, 3), 1.8, 7, [0.85, 0.85, 0.85], [0.7, 0.7, 0.7], 0.35, 0, 1, 1);
            _v.copy(gh.pos).addScaledVector(gh.vel, -1.2 / sp);
            fireLights.keep(gh, _v, 9000, { color: FIRE_COLORS.motor, core: 2, cloud: 1.2, glow: 1, flicker: 0.12, vel: gh.vel });
        } else if (gh.trail) gh.trail.emitting = false;
    }

    // Our picture of it got to where its owner says it ended: the same end here
    finish(gh, now) {
        const E = gh.end, g = this.mp.game;
        // (where its owner says, unless that is somewhere it can't have got to)
        if (E.x === E.x && _v.set(E.x, E.y, E.z).distanceTo(gh.pos) < REACH) gh.pos.copy(_v);
        this.bursts++;
        if (gh.rkt) {
            if (this.endFx(gh.W, 'rkt', gh.pos, gh.vel, E.how) && this.splashes(gh.W, true, E.how, gh.pos)) this.mp.net.blast(gh.pos, gh.W.splash || 26, gh.W.damage * 2.2);
            this.remove(gh);
            return;
        }
        gh.mesh.visible = false;
        switch (E.how) {
            case HOW.QUIET: this.bursts--; break;
            case HOW.OPEN:
                // a cluster bomb's bomblets (drawn only: weapons.js updateBomblets stops before their damage)
                if (gh.W.cluster && allow(gh.peer.opens || (gh.peer.opens = {}), now, OPEN_RATE, OPEN_RATE)) g.weapons.openCluster(gh);
                break;
            case HOW.BURIED: case HOW.BURIED_IN:
                // a bunker buster in the ground: a spurt of dust, and the fuse runs (it goes off here when it would there)
                g.effects.dustBurst(gh.pos, 0.9, 0.7);
                if (g.audio && g.audio.boom) g.audio.boom(g.camera.position.distanceTo(gh.pos), 0.35);
                gh.onBuilding = E.how === HOW.BURIED_IN;
                gh.fuseT = gh.W.fuse || 0.45;
                gh.end = null;
                return; // (the ghost stays for its fuse)
            default:
                this.burstBomb(gh, E.how === HOW.WORLD, E.how === HOW.WATER, E.how === HOW.HIT);
        }
        this.remove(gh);
    }

    // a bomb going off (weapons.js bombBurst: its fireball, cloud, crater, sound and shake, and no damage), and its
    // blast on the buildings round it (never the last blow: networld.js)
    burstBomb(gh, onBuilding, wet = false, onTarget = false) {
        const g = this.mp.game, at = gh.pos.clone(), s = g.surfaceAt(at.x, at.z, at.y + 2);
        if (!onBuilding && !onTarget && !wet) at.y = s.h;
        g.weapons.bombBurst(gh, at, s, wet, onTarget ? true : null, onBuilding);
        if (!wet) this.mp.net.blast(at, gh.W.splash, gh.W.damage * 4);
    }

    // where a missile or a rocket ended, as weapons.js updateMissiles / detonate draw it: false if it went quietly
    endFx(W, kind, pos, vel, how) {
        const g = this.mp.game, fx = g.effects, wp = g.weapons, h = terrainHeight(pos.x, pos.z);
        const crater = W.crater ? { scale: W.crater } : undefined;
        if (how === HOW.QUIET) return false;
        if (how === HOW.GROUND) {
            if (pos.y < 0 && h < 0) { if (fx.water) fx.water.blast(pos, { kg: W.kg ?? WARHEAD_KG[kind] ?? 8, depth: 'contact', vel, agl: 0 }); else fx.waterSplash(pos, 0.6); }
            else {
                fx.explosion(pos, pos.y < h + 3 ? (W.boom || 0.8) : 0.5);
                if (pos.y < h + 2.5) wp.addCrater(_v2.set(pos.x, h, pos.z), kind === 'aam' ? 'missile' : kind, vel, crater);
            }
        } else if (how === HOW.WORLD) fx.explosion(pos, 0.8);
        else {
            fx.explosion(pos, W.boom || 0.9, vel);
            if (W.ground && pos.y < h + 4 && h > 0) wp.addCrater(_v2.set(pos.x, h, pos.z), 'missile', vel, crater);
        }
        return true;
    }
    // did its owner's weapons.js splash() (the blast on what's round it) run for this end? (not in the water)
    splashes(W, rkt, how, pos) {
        if (how === HOW.WORLD) return true;
        if (how === HOW.GROUND) return !(pos.y < 0 && terrainHeight(pos.x, pos.z) < 0);
        return how === HOW.HIT && (rkt || !!W.ground);
    }
}

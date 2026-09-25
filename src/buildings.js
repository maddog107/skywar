// ═══════════════════════════════════════════════════════════════
// Town buildings as solid, destructible objects. The buildings themselves
// are drawn by towns.js as per-town instanced meshes; this keeps a record
// per building (footprint, height, health, the instances that draw it) in a
// grid so bullets, missiles, bombs, aircraft and people can hit them.
// Destroyed buildings collapse into a dust cloud and leave smoking rubble.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand } from './util.js';

const CELL = 64;
const HP = { house: 160, town: 320, apt: 700, tower: 1800 }; // plus a little per metre of height
const COLLAPSE = 2.6; // seconds
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _axis = new THREE.Vector3();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

export class Buildings {
    constructor(parent) {
        this.list = [];
        this.grid = new Map();
        this.maxTop = 0;
        this.collapsing = [];
        this.burning = [];
        // rubble piles: a few rough blocks merged into one unit-footprint heap
        const blocks = [];
        for (let k = 0; k < 9; k++) {
            const g = new THREE.BoxGeometry(rand(0.25, 0.55), rand(0.25, 0.8), rand(0.25, 0.55));
            g.rotateY(rand(0, Math.PI)); g.rotateX(rand(-0.4, 0.4));
            g.translate(rand(-0.3, 0.3), 0.15, rand(-0.3, 0.3));
            blocks.push(g);
        }
        const heap = mergeGeometries(blocks);
        this.rubble = new THREE.InstancedMesh(heap, new THREE.MeshStandardMaterial({ color: 0x6d6760, roughness: 1 }), 400);
        this.rubble.count = 0;
        this.rubble.castShadow = true; this.rubble.receiveShadow = true;
        this.rubble.frustumCulled = false;
        parent.add(this.rubble);
    }

    // o: { x, z, y (base), w, d, ht, yaw, kind, roofH } — `parts` are filled in as its instances are written
    add(o) {
        const b = {
            x: o.x, z: o.z, y: o.y, w: o.w, d: o.d, yaw: o.yaw, kind: o.kind,
            top: o.y + o.ht + (o.roofH || 0), c: Math.cos(o.yaw), s: Math.sin(o.yaw),
            hp: (HP[o.kind] || 300) + o.ht * 6, alive: true, parts: [],
        };
        b.maxHp = b.hp;
        this.list.push(b);
        return b;
    }

    part(b, im, i) { b.parts.push({ im, i }); }

    index() {
        for (const b of this.list) {
            const r = Math.hypot(b.w, b.d) / 2;
            this.maxTop = Math.max(this.maxTop, b.top);
            for (let cx = Math.floor((b.x - r) / CELL); cx <= Math.floor((b.x + r) / CELL); cx++)
                for (let cz = Math.floor((b.z - r) / CELL); cz <= Math.floor((b.z + r) / CELL); cz++) {
                    const k = cx * 100003 + cz;
                    let l = this.grid.get(k);
                    if (!l) this.grid.set(k, l = []);
                    l.push(b);
                }
        }
    }

    // building-local offsets of a world point (u across the width, v along the depth)
    inside(b, x, z, pad = 0) {
        const dx = x - b.x, dz = z - b.z;
        const u = dx * b.c - dz * b.s, v = dx * b.s + dz * b.c; // three.js yaw: local x → (c, -s), local z → (s, c)
        return Math.abs(u) <= b.w / 2 + pad && Math.abs(v) <= b.d / 2 + pad;
    }

    // the standing building containing a point (pad: grow the box, e.g. an aircraft's radius)
    at(x, y, z, pad = 0) {
        if (y > this.maxTop + pad) return null;
        const l = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
        if (!l) return null;
        for (const b of l) if (b.alive && y < b.top + pad && y > b.y - pad && this.inside(b, x, z, pad)) return b;
        return null;
    }

    // people and cars: is (x, z) inside a standing building's walls at height y?
    blocks(x, z, y, pad = 0.4) { return this.at(x, Math.min(y + 1, this.maxTop), z, pad); }

    damage(b, amount, game, source) {
        if (!b.alive || amount <= 0) return;
        b.hp -= amount;
        if (b.hp <= 0) this.destroy(b, game, source);
    }

    // blast damage to every building within `radius` of p (full at the wall, fading to 30% at the edge)
    explode(p, radius, amount, game, source) {
        const seen = new Set();
        for (let cx = Math.floor((p.x - radius) / CELL); cx <= Math.floor((p.x + radius) / CELL); cx++)
            for (let cz = Math.floor((p.z - radius) / CELL); cz <= Math.floor((p.z + radius) / CELL); cz++) {
                const l = this.grid.get(cx * 100003 + cz);
                if (!l) continue;
                for (const b of l) {
                    if (!b.alive || seen.has(b)) continue;
                    seen.add(b);
                    const dx = p.x - b.x, dz = p.z - b.z;
                    const u = Math.max(0, Math.abs(dx * b.c - dz * b.s) - b.w / 2), v = Math.max(0, Math.abs(dx * b.s + dz * b.c) - b.d / 2);
                    const dy = p.y > b.top ? p.y - b.top : p.y < b.y ? b.y - p.y : 0;
                    const d = Math.hypot(u, v, dy);
                    if (d < radius) this.damage(b, amount * (1 - 0.7 * d / radius), game, source);
                }
            }
    }

    destroy(b, game, source) {
        b.alive = false;
        this.game = game;
        const h = b.top - b.y;
        // remember each instance's standing matrix; the collapse animates from it
        for (const pt of b.parts) { pt.im.getMatrixAt(pt.i, _m); pt.base = _m.clone(); }
        _axis.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
        this.collapsing.push({ b, t: 0, h, axis: _axis.clone(), tilt: rand(0.08, 0.22) });
        if (game) {
            const fx = game.effects, c = _v.set(b.x, b.y + h * 0.4, b.z);
            fx.explosion(c, Math.min(3, 0.8 + h / 25));
            fx.debrisBurst(c, _v2.set(0, 25, 0), 8, 1.2);
            game.audio.boom(game.camera.position.distanceTo(c), 1.4);
            if (game.camera.position.distanceTo(c) < 900) game.shake = Math.min(1.5, (game.shake || 0) + 0.5);
            if (source && (source === game.player || source === game.pilotMode)) {
                const pts = b.kind === 'tower' ? 150 : b.kind === 'apt' ? 80 : 40;
                game.score += pts;
                game.addFeed((b.kind === 'tower' ? 'TOWER BLOCK' : b.kind === 'apt' ? 'APARTMENT BLOCK' : 'BUILDING') + ' DESTROYED  +' + pts, '#ffc23f');
            }
        }
    }

    update(dt) {
        const g = this.game;
        for (let i = this.collapsing.length - 1; i >= 0; i--) {
            const c = this.collapsing[i], b = c.b;
            c.t = Math.min(1, c.t + dt / COLLAPSE);
            const k = c.t * c.t; // accelerating fall
            // sink straight down into the dust, leaning a little as it goes
            _q.setFromAxisAngle(c.axis, c.tilt * c.t);
            const pivot = _p.set(b.x, b.y, b.z);
            _m2.makeTranslation(pivot.x, pivot.y - c.h * 0.95 * k, pivot.z).multiply(_m.makeRotationFromQuaternion(_q)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
            for (const pt of b.parts) {
                pt.im.setMatrixAt(pt.i, c.t < 1 ? _m.multiplyMatrices(_m2, pt.base) : HIDDEN);
                pt.im.instanceMatrix.needsUpdate = true;
            }
            if (g && Math.random() < dt * 40) {
                // billowing dust around the base
                const a = rand(0, Math.PI * 2), r = Math.max(b.w, b.d) * rand(0.3, 0.8);
                g.effects.smoke.emit(_v.set(b.x + Math.cos(a) * r, b.y + rand(0, c.h * (1 - k)), b.z + Math.sin(a) * r), _v2.set(Math.cos(a) * 6, rand(2, 8), Math.sin(a) * 6),
                    rand(3, 6), 4 + b.w * 0.2, 16 + b.w * 0.6, [0.55, 0.5, 0.44], [0.62, 0.58, 0.52], 0.8, 0, 1.2, 0);
            }
            if (c.t >= 1) {
                this.collapsing.splice(i, 1);
                this.addRubble(b);
                this.burning.push({ b, t: rand(18, 30), fire: rand(6, 12), puff: 0 });
            }
        }
        for (let i = this.burning.length - 1; i >= 0; i--) {
            const f = this.burning[i], b = f.b;
            f.t -= dt; f.fire -= dt; f.puff -= dt;
            if (g && f.puff <= 0) {
                f.puff = 0.18;
                const p = _v.set(b.x + rand(-0.35, 0.35) * b.w, b.y + 1.5, b.z + rand(-0.35, 0.35) * b.d);
                g.effects.puffSmoke(p, _v2.set(0, rand(3, 6), 0), 1.5 + b.w * 0.06, 0.12, 3.5, 0.55);
                if (f.fire > 0) g.effects.puffFire(p, _v2.set(0, 4, 0), 2 + b.w * 0.05);
            }
            if (f.t <= 0) this.burning.splice(i, 1);
        }
    }

    addRubble(b) {
        const r = this.rubble;
        if (r.count >= r.instanceMatrix.count) return;
        _q.setFromAxisAngle(_v.set(0, 1, 0), b.yaw);
        r.setMatrixAt(r.count++, _m.compose(_p.set(b.x, b.y + 0.4, b.z), _q, _s.set(b.w * 1.15, Math.min(1.2 + (b.top - b.y) * 0.12, 7), b.d * 1.15)));
        r.instanceMatrix.needsUpdate = true;
    }

    // back to the untouched town (between sorties)
    reset() {
        for (const c of this.collapsing) c.b.alive = false; // finish: fall through to the restore below
        this.collapsing = []; this.burning = [];
        for (const b of this.list) {
            if (b.alive && b.hp === b.maxHp) continue;
            for (const pt of b.parts) if (pt.base) { pt.im.setMatrixAt(pt.i, pt.base); pt.im.instanceMatrix.needsUpdate = true; }
            b.alive = true; b.hp = b.maxHp;
        }
        this.rubble.count = 0;
    }
}

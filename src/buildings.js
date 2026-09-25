// ═══════════════════════════════════════════════════════════════
// Buildings (and other big fixed structures) as solid, destructible objects.
// The town buildings are drawn by towns.js as per-town instanced meshes; the
// airbases add their hangars, control towers, terminals, parked aircraft…
// (plain meshes, groups or instances). This keeps a record per structure
// (one or more boxes, health, the instances / meshes that draw it) in a grid
// so bullets, missiles, bombs, aircraft and people can hit them.
//   • damaged (below half health): scorched and smoking
//   • destroyed: collapses into a dust cloud, leaves a stub of wall and a
//     smoking heap of debris that burns for a while (and glows at night)
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, mulberry32, makeRadialTexture } from './util.js';

const CELL = 64;
// hp: base health (plus a little per metre of height); pts: score for destroying one; style 'vehicle': blows up
// at once instead of collapsing
export const KINDS = {
    house: { hp: 160, pts: 40, name: 'BUILDING' },
    town: { hp: 320, pts: 40, name: 'BUILDING' },
    shop: { hp: 280, pts: 40, name: 'BUILDING' },
    apt: { hp: 700, pts: 80, name: 'APARTMENT BLOCK' },
    tower: { hp: 1800, pts: 150, name: 'TOWER BLOCK' },
    church: { hp: 600, pts: 60, name: 'CHURCH' },
    landmark: { hp: 2600, pts: 250, name: 'LANDMARK' },
    stadium: { hp: 3000, pts: 250, name: 'STADIUM' },
    station: { hp: 180, pts: 50, name: 'GAS STATION' },
    market: { hp: 200, pts: 30, name: 'MARKET HALL' },
    watertower: { hp: 260, pts: 60, name: 'WATER TOWER' },
    hangar: { hp: 900, pts: 120, name: 'HANGAR' },
    atc: { hp: 1100, pts: 200, name: 'CONTROL TOWER' },
    terminal: { hp: 2600, pts: 250, name: 'TERMINAL' },
    office: { hp: 500, pts: 60, name: 'BASE BUILDING' },
    garage: { hp: 1400, pts: 80, name: 'PARKING GARAGE' },
    booth: { hp: 140, pts: 30, name: 'CHECKPOINT' },
    radar: { hp: 220, pts: 100, name: 'RADAR' },
    jetbridge: { hp: 160, pts: 20, name: 'JET BRIDGE' },
    aircraft: { hp: 90, pts: 80, name: 'PARKED AIRCRAFT', style: 'vehicle' },
    heli: { hp: 60, pts: 60, name: 'PARKED HELICOPTER', style: 'vehicle' },
};
const COLLAPSE = 2.6; // seconds
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _axis = new THREE.Vector3(), _c = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

// the town and the airbases share one set, so every structure in the world is found by the same queries
export const WORLD_BUILDINGS = { current: null };

// A heap of rubble for a unit footprint (x, z in ±0.5, about 1 high): a lumpy mound with broken slabs,
// blocks and a few beams sticking out. Vertex colours give it light/dark variation; the instance colour tints it.
function rubbleGeometry() {
    const r = mulberry32(77);
    const parts = [];
    const shade = (g, k) => { const n = g.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const v = k * (0.85 + r() * 0.3); col[i * 3] = v; col[i * 3 + 1] = v * 0.97; col[i * 3 + 2] = v * 0.93; } g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g; };
    const mound = new THREE.CylinderGeometry(0.16, 0.56, 0.62, 10, 3);
    const mp = mound.attributes.position;
    for (let i = 0; i < mp.count; i++) {
        const y = mp.getY(i), k = 1 + (r() - 0.5) * 0.35;
        mp.setXYZ(i, mp.getX(i) * k, y + (y > -0.3 ? (r() - 0.5) * 0.18 : 0), mp.getZ(i) * k);
    }
    mound.translate(0, 0.31, 0);
    mound.scale(1, 0.85, 1);
    parts.push(shade(mound.toNonIndexed(), 0.9));
    for (let k = 0; k < 16; k++) {
        const big = k < 5;
        const g = new THREE.BoxGeometry(big ? 0.34 + r() * 0.2 : 0.08 + r() * 0.14, big ? 0.05 : 0.06 + r() * 0.1, big ? 0.22 + r() * 0.15 : 0.08 + r() * 0.12);
        g.rotateX((r() - 0.5) * 1.4); g.rotateZ((r() - 0.5) * 1.2); g.rotateY(r() * Math.PI);
        const a = r() * Math.PI * 2, d = 0.1 + r() * 0.38;
        g.translate(Math.cos(a) * d, 0.5 * (1 - d / 0.55) + 0.05 + r() * 0.12, Math.sin(a) * d);
        parts.push(shade(g.toNonIndexed(), big ? 1.05 : 0.8 + r() * 0.4));
    }
    for (let k = 0; k < 4; k++) { // bent beams / rebar
        const g = new THREE.BoxGeometry(0.025, 0.025, 0.5 + r() * 0.3);
        g.rotateX(-0.3 - r() * 0.7); g.rotateY(r() * Math.PI * 2);
        g.translate((r() - 0.5) * 0.4, 0.45 + r() * 0.2, (r() - 0.5) * 0.4);
        parts.push(shade(g.toNonIndexed(), 0.35));
    }
    for (const g of parts) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    const out = mergeGeometries(parts);
    out.computeVertexNormals();
    return out;
}

export class Buildings {
    constructor(parent) {
        this.list = [];
        this.grid = new Map();
        this.maxTop = 0;
        this.indexed = 0;
        this.collapsing = [];
        this.burning = [];
        this.smoking = [];
        this.night = false;
        WORLD_BUILDINGS.current = this;
        this.rubble = new THREE.InstancedMesh(rubbleGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), 500);
        this.rubble.count = 0;
        this.rubble.castShadow = true; this.rubble.receiveShadow = true;
        this.rubble.frustumCulled = false;
        this.rubble.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(500 * 3).fill(1), 3);
        parent.add(this.rubble);
        // fire glow over burning ruins (a handful of additive sprites, given to the nearest fires)
        const glowMat = new THREE.SpriteMaterial({ map: makeRadialTexture(64, [[0, 'rgba(255,190,110,1)'], [0.35, 'rgba(255,120,40,0.45)'], [1, 'rgba(255,80,20,0)']]), color: 0xffa050, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
        this.glows = [];
        for (let i = 0; i < 12; i++) { const s = new THREE.Sprite(glowMat.clone()); s.visible = false; s.frustumCulled = false; parent.add(s); this.glows.push(s); }
    }

    // o: { x, z, y (base), w, d, ht, yaw, kind, roofH, name?, friendly?, boxes? } — `parts` are filled in as its
    // instances / meshes are written. boxes: [{ x, z, y0, y1, w, d, yaw }] for a structure that isn't one box
    // (a control tower: ops building, shaft, cab); x/z/w/d/yaw/ht then describe the main one.
    add(o) {
        const K = KINDS[o.kind] || KINDS.town;
        const b = {
            x: o.x, z: o.z, y: o.y, w: o.w, d: o.d, yaw: o.yaw, kind: o.kind, name: o.name || K.name, friendly: !!o.friendly,
            top: o.y + o.ht + (o.roofH || 0), c: Math.cos(o.yaw), s: Math.sin(o.yaw),
            hp: (o.hp || K.hp) + (K.style ? 0 : o.ht * 6), alive: true, parts: [], boxes: null, off: false,
        };
        b.maxHp = b.hp;
        b.r = Math.hypot(b.w, b.d) / 2;
        if (o.boxes) {
            b.boxes = o.boxes.map(q => ({ x: q.x, z: q.z, y0: q.y0, y1: q.y1, w: q.w, d: q.d, c: Math.cos(q.yaw || 0), s: Math.sin(q.yaw || 0) }));
            for (const q of b.boxes) { b.top = Math.max(b.top, q.y1); b.r = Math.max(b.r, Math.hypot(q.x - b.x, q.z - b.z) + Math.hypot(q.w, q.d) / 2); }
        }
        this.list.push(b);
        return b;
    }

    // an instance that draws part of b ('wall': left standing as a burnt stub when it falls)
    part(b, im, i, role) { b.parts.push({ im, i, role }); }
    // a plain mesh or group that draws part of b
    partMesh(b, obj) { b.parts.push({ obj }); }

    // grid the records added since the last call
    index() {
        for (; this.indexed < this.list.length; this.indexed++) {
            const b = this.list[this.indexed], r = b.r;
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

    // is (x, y, z) inside b (grown by pad)?
    contains(b, x, y, z, pad = 0) {
        if (!b.boxes) return y < b.top + pad && y > b.y - pad && this.inside(b, x, z, pad);
        for (const q of b.boxes) if (y < q.y1 + pad && y > q.y0 - pad && this.inside(q, x, z, pad)) return true;
        return false;
    }

    // the standing structure containing a point (pad: grow the boxes, e.g. an aircraft's radius)
    at(x, y, z, pad = 0) {
        if (y > this.maxTop + pad) return null;
        const l = this.grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
        if (!l) return null;
        for (const b of l) if (b.alive && !b.off && this.contains(b, x, y, z, pad)) return b;
        return null;
    }

    // people and cars: is (x, z) inside a standing building's walls at height y?
    blocks(x, z, y, pad = 0.4) { return this.at(x, Math.min(y + 1, this.maxTop), z, pad); }

    // highest standing roof within r of (x, z) (helicopters keep clear), or -Infinity
    topAt(x, z, r) {
        let top = -Infinity;
        for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++)
            for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
                const l = this.grid.get(cx * 100003 + cz);
                if (l) for (const b of l) if (b.alive && !b.off && b.top > top && Math.hypot(b.x - x, b.z - z) < r + b.r) top = b.top;
            }
        return top;
    }

    damage(b, amount, game, source) {
        if (!b.alive || b.off || amount <= 0) return;
        const before = b.hp;
        b.hp -= amount;
        if (game) this.game = game;
        if (b.hp <= 0) { this.destroy(b, game, source); return; }
        // scorched and smoking once it's badly hit
        if (b.hp < b.maxHp * 0.5) {
            if (before >= b.maxHp * 0.5) this.smoking.push({ b, puff: 0 });
            this.scorch(b, 0.45 + 0.55 * b.hp / b.maxHp);
        }
    }

    // darken the instances drawing b (1 = as built)
    scorch(b, k) {
        for (const pt of b.parts) {
            if (!pt.im || !pt.im.instanceColor) continue;
            if (!pt.col) { pt.im.getColorAt(pt.i, _c); pt.col = _c.clone(); }
            pt.im.setColorAt(pt.i, _c.copy(pt.col).multiplyScalar(k));
            pt.im.instanceColor.needsUpdate = true;
        }
    }

    // box distance from a point (0 inside)
    distTo(b, p) {
        const one = (q, y0, y1) => {
            const dx = p.x - q.x, dz = p.z - q.z;
            const u = Math.max(0, Math.abs(dx * q.c - dz * q.s) - q.w / 2), v = Math.max(0, Math.abs(dx * q.s + dz * q.c) - q.d / 2);
            const dy = p.y > y1 ? p.y - y1 : p.y < y0 ? y0 - p.y : 0;
            return Math.hypot(u, v, dy);
        };
        if (!b.boxes) return one(b, b.y, b.top);
        let d = Infinity;
        for (const q of b.boxes) d = Math.min(d, one(q, q.y0, q.y1));
        return d;
    }

    // blast damage to every structure within `radius` of p (full at the wall, fading to 30% at the edge)
    explode(p, radius, amount, game, source) {
        const seen = new Set();
        for (let cx = Math.floor((p.x - radius) / CELL); cx <= Math.floor((p.x + radius) / CELL); cx++)
            for (let cz = Math.floor((p.z - radius) / CELL); cz <= Math.floor((p.z + radius) / CELL); cz++) {
                const l = this.grid.get(cx * 100003 + cz);
                if (!l) continue;
                for (const b of l) {
                    if (!b.alive || b.off || seen.has(b)) continue;
                    seen.add(b);
                    const d = this.distTo(b, p);
                    if (d < radius) this.damage(b, amount * (1 - 0.7 * d / radius), game, source);
                }
            }
        if (this.onBlast) this.onBlast(p, radius);
    }

    destroy(b, game, source) {
        b.alive = false;
        if (game) this.game = game;
        const h = b.top - b.y, K = KINDS[b.kind] || KINDS.town;
        // remember each part's standing transform; the collapse animates from it
        for (const pt of b.parts) {
            if (pt.im) {
                pt.im.getMatrixAt(pt.i, _m); pt.base = _m.clone();
                pt.im.updateWorldMatrix(true, false);
                const P = pt.im.matrixWorld;
                pt.P = P.equals(_m3.identity()) ? null : P.clone();
                pt.Pinv = pt.P ? pt.P.clone().invert() : null;
            } else {
                pt.obj.updateWorldMatrix(true, true);
                pt.meshes = [];
                pt.obj.traverse(o => { if (o.isMesh || o.isSprite || o.isLine || o.isPoints) pt.meshes.push({ o, base: o.matrixWorld.clone(), auto: o.matrixWorldAutoUpdate, vis: o.visible }); });
                for (const q of pt.meshes) q.o.matrixWorldAutoUpdate = false;
            }
        }
        const vehicle = K.style === 'vehicle';
        _axis.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
        this.collapsing.push({ b, t: 0, h, axis: _axis.clone(), tilt: vehicle ? rand(0.2, 0.5) : rand(0.08, 0.22), dur: vehicle ? 0.35 : Math.min(COLLAPSE, 1.2 + h * 0.03), vehicle });
        this.smoking = this.smoking.filter(s => s.b !== b);
        if (this.onBlast) this.onBlast(_v.set(b.x, b.y, b.z), Math.max(b.w, b.d) + 20);
        if (game) {
            const fx = game.effects, c = _v.set(b.x, b.y + h * (vehicle ? 0.5 : 0.4), b.z);
            fx.explosion(c, vehicle ? 1.2 : Math.min(3, 0.8 + h / 25));
            fx.debrisBurst(c, _v2.set(0, 25, 0), 8, 1.2);
            game.audio.boom(game.camera.position.distanceTo(c), 1.4);
            if (game.camera.position.distanceTo(c) < 900) game.shake = Math.min(1.5, (game.shake || 0) + 0.5);
            if (source && (source === game.player || source === game.pilotMode)) {
                if (b.friendly) game.addFeed('FRIENDLY ' + b.name + ' DESTROYED', '#ff4a3d');
                else { game.score += K.pts; game.addFeed(b.name + ' DESTROYED  +' + K.pts, '#ffc23f'); }
            }
        }
    }

    update(dt, cam) {
        const g = this.game;
        for (let i = this.collapsing.length - 1; i >= 0; i--) {
            const c = this.collapsing[i], b = c.b;
            c.t = Math.min(1, c.t + dt / c.dur);
            const k = c.t * c.t; // accelerating fall
            // sink straight down into the dust, leaning a little as it goes (a vehicle just crumples)
            _q.setFromAxisAngle(c.axis, c.tilt * c.t);
            const pivot = _p.set(b.x, b.y, b.z);
            _m2.makeTranslation(pivot.x, pivot.y - c.h * (c.vehicle ? 0.45 : 0.95) * k, pivot.z).multiply(_m.makeRotationFromQuaternion(_q)).multiply(_m3.makeTranslation(-pivot.x, -pivot.y, -pivot.z));
            const done = c.t >= 1;
            for (const pt of b.parts) {
                if (pt.im) {
                    let M;
                    if (done) M = pt.role === 'wall' && !c.vehicle ? this.stub(b, pt) : HIDDEN;
                    else { M = _m.multiplyMatrices(_m2, pt.P ? _m3.multiplyMatrices(pt.P, pt.base) : pt.base); if (pt.Pinv) M.premultiply(pt.Pinv); }
                    pt.im.setMatrixAt(pt.i, M);
                    pt.im.instanceMatrix.needsUpdate = true;
                } else for (const q of pt.meshes) {
                    if (done) q.o.visible = false;
                    else q.o.matrixWorld.multiplyMatrices(_m2, q.base);
                }
            }
            if (g && !c.vehicle && Math.random() < dt * 40) {
                // billowing dust around the base
                const a = rand(0, Math.PI * 2), r = Math.max(b.w, b.d) * rand(0.3, 0.8);
                g.effects.smoke.emit(_v.set(b.x + Math.cos(a) * r, b.y + rand(0, c.h * (1 - k)), b.z + Math.sin(a) * r), _v2.set(Math.cos(a) * 6, rand(2, 8), Math.sin(a) * 6),
                    rand(3, 6), 4 + b.w * 0.2, 16 + b.w * 0.6, [0.55, 0.5, 0.44], [0.62, 0.58, 0.52], 0.8, 0, 1.2, 0);
            }
            if (done) {
                this.collapsing.splice(i, 1);
                this.addRubble(b, c.vehicle);
                this.burning.push({ b, t: rand(40, 70), fire: c.vehicle ? rand(15, 30) : rand(12, 25), puff: 0, flick: rand(0, 10) });
            }
        }
        // hit but still standing: smoke from the top and the windows
        for (const s of this.smoking) {
            const b = s.b;
            s.puff -= dt;
            if (!g || s.puff > 0) continue;
            const far = cam ? Math.hypot(b.x - cam.x, b.z - cam.z) : 0;
            if (far > 6000) { s.puff = 1; continue; } // too far to see
            s.puff = 0.25 + far / 3000;
            const h = b.top - b.y, p = _v.set(b.x + rand(-0.3, 0.3) * b.w, b.y + h * rand(0.5, 1), b.z + rand(-0.3, 0.3) * b.d);
            g.effects.puffSmoke(p, _v2.set(0, rand(3, 6), 0), 1.2 + b.w * 0.05, 0.14, 3, 0.5);
            if (b.hp < b.maxHp * 0.25 && Math.random() < 0.5) g.effects.puffFire(p, _v2.set(0, 3, 0), 1.5 + b.w * 0.03);
        }
        for (let i = this.burning.length - 1; i >= 0; i--) {
            const f = this.burning[i], b = f.b;
            f.t -= dt; f.fire -= dt; f.puff -= dt; f.flick += dt;
            if (g && f.puff <= 0) {
                const far = cam ? Math.hypot(b.x - cam.x, b.z - cam.z) : 0;
                f.puff = far > 7000 ? 1 : 0.18 + far / 6000;
                if (far <= 7000) {
                    const p = _v.set(b.x + rand(-0.35, 0.35) * b.w, b.y + 1.5, b.z + rand(-0.35, 0.35) * b.d);
                    g.effects.puffSmoke(p, _v2.set(0, rand(3, 6), 0), 1.5 + b.w * 0.06, 0.12, 3.5, 0.55);
                    if (f.fire > 0) g.effects.puffFire(p, _v2.set(0, 4, 0), 2 + b.w * 0.05);
                }
            }
            if (f.t <= 0) this.burning.splice(i, 1);
        }
        this.updateGlows(cam);
    }

    // the standing stub of a wall instance: the bottom storey or so, burnt
    stub(b, pt) {
        const h = b.top - b.y;
        const k = Math.min(1, Math.min(4.5, 1.5 + h * 0.12) / Math.max(h, 1));
        if (pt.im.instanceColor) { if (!pt.col) { pt.im.getColorAt(pt.i, _c); pt.col = _c.clone(); } pt.im.setColorAt(pt.i, _c.copy(pt.col).multiplyScalar(0.28)); pt.im.instanceColor.needsUpdate = true; }
        return _m.copy(pt.base).multiply(_m3.makeScale(1, k, 1));
    }

    // glowing fires, nearest first
    updateGlows(cam) {
        const G = this.glows;
        let n = 0;
        if (this.burning.length) {
            const list = cam ? [...this.burning].filter(f => f.fire > 0).sort((a, c) => ((a.b.x - cam.x) ** 2 + (a.b.z - cam.z) ** 2) - ((c.b.x - cam.x) ** 2 + (c.b.z - cam.z) ** 2)) : this.burning;
            for (const f of list) {
                if (n >= G.length || f.fire <= 0) break;
                const b = f.b, s = G[n++], size = Math.max(b.w, b.d) * 1.6 + 10;
                const fl = 0.8 + Math.sin(f.flick * 9.1) * 0.08 + Math.sin(f.flick * 23.7) * 0.06;
                s.position.set(b.x, b.y + 3 + size * 0.12, b.z);
                s.scale.setScalar(size * fl);
                s.material.opacity = (this.night ? 0.95 : 0.35) * Math.min(1, f.fire / 4) * fl;
                s.visible = true;
            }
        }
        for (; n < G.length; n++) G[n].visible = false;
    }

    setNight(on) { this.night = on; }

    addRubble(b, vehicle) {
        const r = this.rubble;
        if (r.count >= r.instanceMatrix.count) return;
        const h = b.top - b.y;
        _q.setFromAxisAngle(_v.set(0, 1, 0), b.yaw + rand(-0.2, 0.2));
        const hh = vehicle ? 1.2 : Math.min(1.4 + h * 0.13, 9);
        r.setMatrixAt(r.count, _m.compose(_p.set(b.x, b.y + 0.3, b.z), _q, _s.set(b.w * (vehicle ? 0.8 : 1.12), hh, b.d * (vehicle ? 0.8 : 1.12))));
        // tinted by what it was built from (walls), darkened: soot and dust
        const wall = b.parts.find(pt => pt.col || (pt.im && pt.im.instanceColor));
        let mat = null;
        if (!wall) for (const pt of b.parts) if (pt.meshes) for (const q of pt.meshes) if (!mat && q.o.isMesh && q.o.material && q.o.material.color) mat = q.o.material;
        if (wall && wall.im) { wall.im.getColorAt(wall.i, _c); if (wall.col) _c.copy(wall.col); }
        else if (mat) _c.copy(mat.color);
        else _c.setRGB(0.5, 0.48, 0.45);
        _c.lerp(_v2.set(0.45, 0.42, 0.38), 0.5).multiplyScalar(0.85);
        if (vehicle) _c.setRGB(0.16, 0.15, 0.14);
        r.setColorAt(r.count, _c);
        r.count++;
        r.instanceMatrix.needsUpdate = true;
        r.instanceColor.needsUpdate = true;
    }

    // back to the untouched world (between sorties)
    reset() {
        for (const c of this.collapsing) c.b.alive = false; // finish: fall through to the restore below
        this.collapsing = []; this.burning = []; this.smoking = [];
        for (const b of this.list) {
            if (b.alive && b.hp === b.maxHp) continue;
            for (const pt of b.parts) {
                if (pt.im) {
                    if (pt.base) { pt.im.setMatrixAt(pt.i, pt.base); pt.im.instanceMatrix.needsUpdate = true; }
                    if (pt.col) { pt.im.setColorAt(pt.i, pt.col); pt.im.instanceColor.needsUpdate = true; }
                } else if (pt.meshes) {
                    for (const q of pt.meshes) { q.o.matrixWorld.copy(q.base); q.o.matrixWorldAutoUpdate = q.auto; q.o.visible = q.vis; }
                    pt.meshes = null;
                }
            }
            b.alive = true; b.hp = b.maxHp;
        }
        this.rubble.count = 0;
        for (const s of this.glows) s.visible = false;
    }
}

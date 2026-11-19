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
import { Chunks } from './collapse.js';

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
// flag one instance's slot for upload, not the whole buffer (an InstancedMesh can hold a whole group of towns)
function touch(attr, i) { attr.addUpdateRange(i * attr.itemSize, attr.itemSize); attr.needsUpdate = true; }
const DUST = new THREE.Color(0.45, 0.42, 0.38);
// concrete and plaster dust (lit by the sun in effects.js): a pale grey-beige that greys as it thins out
const CONCRETE0 = [0.55, 0.54, 0.52], CONCRETE1 = [0.62, 0.62, 0.6];
const FLOOR = 3.2; // one storey (m): a collapse sheds a ring of rubble and dust as each one crushes at the foot
// A blast that brings a whole district down at once (the X-100's MOAB) would have every building throw its own fireball,
// debris and dust, fill the particle pools and leave the bomb's own mushroom cloud no room: the first FULL_FX to fall in a
// frame get all of it, the rest just fall (the big blast covers them, and the feed sums them up in one line); the dust of
// many collapsing at once and the fires of many burning share DUST_SHARE and FIRE_SHARE buildings' worth
const FULL_FX = 10, DUST_SHARE = 10, FIRE_SHARE = 30;

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
        this.fallen = 0;                    // buildings destroyed this frame
        this.mass = { n: 0, pts: 0 };       // the player's beyond FULL_FX this frame (one feed line)
        this.night = false;
        WORLD_BUILDINGS.current = this;
        this.rubble = new THREE.InstancedMesh(rubbleGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), 500);
        this.rubble.count = 0;
        this.rubble.castShadow = true; this.rubble.receiveShadow = true;
        this.rubble.frustumCulled = false;
        this.rubble.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(500 * 3).fill(1), 3);
        parent.add(this.rubble);
        // the pieces a collapse throws off (collapse.js); a hard landing kicks up a little dust
        this.chunks = new Chunks(parent);
        this.chunks.onBounce = (x, y, z, size, speed) => {
            const g = this.game;
            if (!g || size < 1.2 || Math.random() > 0.5) return;
            g.effects.smoke.emit(_v.set(x, y + 0.3, z), _v2.set(rand(-1, 1), rand(0.5, 2), rand(-1, 1)), rand(2.5, 5), size * 0.8, size * 2.6 + speed * 0.15, CONCRETE0, CONCRETE1, 0.55, 0, 1.4, 0.2, 0, 0.5, 0.5);
        };
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
            touch(pt.im.instanceColor, pt.i);
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
                    if (d < radius) { b.hitX = p.x; b.hitY = p.y; b.hitZ = p.z; this.damage(b, amount * (1 - 0.7 * d / radius), game, source); }
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
                pt.obj.traverse(o => { if (o.isMesh || o.isSprite || o.isLine || o.isPoints) pt.meshes.push({ o, base: o.matrixWorld.clone(), auto: o.matrixWorldAutoUpdate }); });
                for (const q of pt.meshes) q.o.matrixWorldAutoUpdate = false;
            }
        }
        const vehicle = K.style === 'vehicle';
        const full = !game || this.fallen < FULL_FX;
        // How it comes down. Most buildings pancake: each storey crushes onto the one below and the whole thing sinks
        // into its own dust, leaning a little. A tall, slender one may instead topple away from the blast, pivoting on
        // its foot as it goes (a vehicle just crumples)
        let dx = b.hitX != null ? b.x - b.hitX : 0, dz = b.hitZ != null ? b.z - b.hitZ : 0;
        const dl = Math.hypot(dx, dz);
        if (dl > 1) { dx /= dl; dz /= dl; } else { const a = rand(0, Math.PI * 2); dx = Math.cos(a); dz = Math.sin(a); }
        const topple = !vehicle && h > 1.6 * Math.min(b.w, b.d) && Math.random() < 0.45;
        const c = { b, t: 0, h, vehicle, topple, sunk: 0, nextFloor: FLOOR * 0.6, share: full ? 1 : 0.3, heap: -1, col: this.wallColour(b) };
        if (topple) {
            // pivot on the foot of the far wall, turning about the horizontal axis across the fall
            const ex = Math.abs(dx * b.c - dz * b.s) * b.w / 2 + Math.abs(dx * b.s + dz * b.c) * b.d / 2;
            c.pivot = new THREE.Vector3(b.x + dx * ex, b.y, b.z + dz * ex);
            c.axis = new THREE.Vector3(dz, 0, -dx);
            c.tilt = rand(0.45, 0.8);
        } else {
            c.pivot = new THREE.Vector3(b.x, b.y, b.z);
            c.axis = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
            c.tilt = vehicle ? rand(0.2, 0.5) : rand(0.05, 0.18);
        }
        // (free fall from the top would take √(2h/g); the floors giving way one by one hold it back)
        c.dur = vehicle ? 0.35 : (0.8 + 1.3 * Math.sqrt(2 * h / 9.81)) * (topple ? 1.15 : 1);
        if (!vehicle) c.heap = this.addRubble(b, false, 0.03);
        this.collapsing.push(c);
        this.smoking = this.smoking.filter(s => s.b !== b);
        if (this.onBlast) this.onBlast(_v.set(b.x, b.y, b.z), Math.max(b.w, b.d) + 20);
        if (game) {
            this.fallen++;
            const fx = game.effects, c = _v.set(b.x, b.y + h * (vehicle ? 0.5 : 0.4), b.z);
            if (full) {
                fx.explosion(c, vehicle ? 1.2 : Math.min(3, 0.8 + h / 25));
                if (vehicle) fx.debrisBurst(c, _v2.set(0, 25, 0), 8, 1.2);
                else this.spall(this.collapsing[this.collapsing.length - 1], dx, dz);
                game.audio.boom(game.camera.position.distanceTo(c), 1.4);
            }
            const cd = game.camera.position.distanceTo(c);
            if (cd < 900) { if (game.shockShake) game.shockShake(cd, 0.5); else game.shake = Math.min(1.5, (game.shake || 0) + 0.5); }
            if (source && (source === game.player || source === game.pilotMode)) {
                if (b.friendly) game.addFeed('FRIENDLY ' + b.name + ' DESTROYED', '#ff4a3d');
                else {
                    game.score += K.pts;
                    if (full) game.addFeed(b.name + ' DESTROYED  +' + K.pts, '#ffc23f');
                    else { this.mass.n++; this.mass.pts += K.pts; }
                }
            }
        }
    }

    update(dt, cam) {
        const g = this.game;
        this.fallen = 0;
        if (this.mass.n && g) { g.addFeed('+' + this.mass.n + ' MORE BUILDINGS DESTROYED  +' + this.mass.pts, '#ffc23f'); this.mass.n = this.mass.pts = 0; }
        const dustK = Math.min(1, DUST_SHARE / Math.max(1, this.collapsing.length)), fireK = Math.max(1, this.burning.length / FIRE_SHARE);
        for (let i = this.collapsing.length - 1; i >= 0; i--) {
            const c = this.collapsing[i], b = c.b;
            c.t = Math.min(1, c.t + dt / c.dur);
            // a moment's sag as it gives way, then an accelerating fall (k: the share of the drop done)
            const u = Math.max(0, (c.t - 0.12) / 0.88);
            const k = c.vehicle ? c.t * c.t : c.t < 0.12 ? 0.025 * c.t / 0.12 : 0.025 + 0.975 * Math.pow(u, 1.7);
            // pancaking: straight down into the dust, leaning a little; toppling: over on its foot as it sinks
            _q.setFromAxisAngle(c.axis, c.tilt * (c.topple ? Math.pow(k, 0.7) : c.t));
            const pv = c.pivot, sink = c.h * (c.vehicle ? 0.45 : c.topple ? 0.8 : 0.95) * k;
            _m2.makeTranslation(pv.x, pv.y - sink, pv.z).multiply(_m.makeRotationFromQuaternion(_q)).multiply(_m3.makeTranslation(-pv.x, -pv.y, -pv.z));
            const done = c.t >= 1;
            for (const pt of b.parts) {
                if (pt.im) {
                    let M;
                    if (done) M = pt.role === 'wall' && !c.vehicle ? this.stub(b, pt) : HIDDEN;
                    else { M = _m.multiplyMatrices(_m2, pt.P ? _m3.multiplyMatrices(pt.P, pt.base) : pt.base); if (pt.Pinv) M.premultiply(pt.Pinv); }
                    pt.im.setMatrixAt(pt.i, M);
                    touch(pt.im.instanceMatrix, pt.i);
                } else for (const q of pt.meshes) {
                    // gone: squashed to nothing rather than hidden, so distance culling (which toggles .visible)
                    // can't bring it back
                    if (done) q.o.matrixWorld.copy(HIDDEN);
                    else q.o.matrixWorld.multiplyMatrices(_m2, q.base);
                }
            }
            if (!c.vehicle) {
                // each storey that crushes at the foot sheds a ring of rubble and pushes out a ring of dust; the heap
                // inside grows as they come down
                c.sunk = sink;
                while (g && c.sunk > c.nextFloor && c.nextFloor < c.h) { c.nextFloor += FLOOR; this.storey(c, dustK); }
                if (c.heap >= 0) this.growRubble(c.heap, b, Math.max(0.03, k));
            }
            if (g && !c.vehicle && Math.random() < dt * 40 * dustK) {
                // billowing dust around the base
                const a = rand(0, Math.PI * 2), r = Math.max(b.w, b.d) * rand(0.3, 0.8);
                g.effects.smoke.emit(_v.set(b.x + Math.cos(a) * r, b.y + rand(0, c.h * (1 - k)), b.z + Math.sin(a) * r), _v2.set(Math.cos(a) * 6, rand(2, 8), Math.sin(a) * 6),
                    rand(5, 9), 4 + b.w * 0.2, 16 + b.w * 0.7, CONCRETE0, CONCRETE1, 0.8, 0, 1.2, 0.2);
            }
            if (done) {
                this.collapsing.splice(i, 1);
                if (c.vehicle) this.addRubble(b, true);
                else if (g) this.surge(c, dustK);
                this.burning.push({ b, t: rand(40, 70), fire: c.vehicle ? rand(15, 30) : rand(12, 25), puff: 0, flick: rand(0, 10) });
            }
        }
        this.chunks.update(dt);
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
                f.puff = (far > 7000 ? 1 : 0.18 + far / 6000) * fireK;
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

    // the colour of b's walls as built (rubble is made of it)
    wallColour(b) {
        const wall = b.parts.find(pt => pt.col || (pt.im && pt.im.instanceColor));
        if (wall && wall.im) { if (wall.col) _c.copy(wall.col); else wall.im.getColorAt(wall.i, _c); }
        else {
            let mat = null;
            for (const pt of b.parts) if (pt.meshes) for (const q of pt.meshes) if (!mat && q.o.isMesh && q.o.material && q.o.material.color) mat = q.o.material;
            if (mat) _c.copy(mat.color); else _c.setRGB(0.6, 0.58, 0.55);
        }
        return [_c.r, _c.g, _c.b];
    }

    // a point on b's walls (local u across the width, v along the depth) and the wall's outward normal, in the world
    wallPoint(b, out) {
        const side = Math.random() * (b.w + b.d) < b.w ? 0 : 1, sg = Math.random() < 0.5 ? -1 : 1;
        const u = side ? sg * b.w / 2 : rand(-0.5, 0.5) * b.w, v = side ? rand(-0.5, 0.5) * b.d : sg * b.d / 2;
        const nu = side ? sg : 0, nv = side ? 0 : sg;
        out.x = b.x + u * b.c + v * b.s; out.z = b.z - u * b.s + v * b.c;
        out.nx = nu * b.c + nv * b.s; out.nz = -nu * b.s + nv * b.c;
        return out;
    }

    // one piece of the building: a slab of floor, a lump of wall or a small bit, in its own (dusty, scorched) colour
    chunk(c, x, y, z, vx, vy, vz) {
        const b = c.b, r = Math.random();
        let sx, sy, sz;
        if (r < 0.35) { sx = rand(1.2, 3.2); sy = rand(0.25, 0.45); sz = rand(0.8, 2.2); }      // floor slab
        else if (r < 0.7) { sx = rand(0.6, 1.6); sy = rand(0.5, 1.3); sz = rand(0.5, 1.4); }    // wall
        else { sx = rand(0.2, 0.6); sy = rand(0.2, 0.5); sz = rand(0.2, 0.6); }                 // bits
        const s = Math.min(1, (b.w + b.d) / 30) * 0.5 + 0.5; // (a house's pieces are smaller than a tower's)
        const grey = Math.random() < 0.18, f = rand(0.62, 0.95);
        const col = grey ? [0.55, 0.54, 0.52] : c.col;
        // the ground where it comes down (a town on a hillside: lower downhill), from its flight to b's foot level
        let gy = b.y;
        if (this.groundAt) {
            const T = (vy + Math.sqrt(vy * vy + 2 * 9.81 * Math.max(0, y - b.y))) / 9.81;
            gy = this.groundAt(x + vx * T, z + vz * T);
        }
        this.chunks.spawn(x, y, z, vx, vy, vz, sx * s, sy * s, sz * s, col[0] * f, col[1] * f, col[2] * f, gy + 0.05, 4);
    }

    // the blast's side of the building blown out as it gives way: pieces flung away from the blast, from all heights
    spall(c, dx, dz) {
        const b = c.b, n = Math.round(Math.min(22, 6 + (b.w + b.d) * 0.25)), W = {};
        for (let i = 0; i < n; i++) {
            this.wallPoint(b, W);
            // (mostly the walls facing the blast)
            if (W.nx * dx + W.nz * dz > 0.3 && Math.random() < 0.7) { i--; continue; }
            const sp = rand(6, 18), y = b.y + rand(0.1, 0.9) * c.h;
            this.chunk(c, W.x, y, W.z, (W.nx * 0.5 + dx * 0.8) * sp + rand(-3, 3), rand(1, 8), (W.nz * 0.5 + dz * 0.8) * sp + rand(-3, 3));
        }
    }

    // a storey crushed at the foot: rubble thrown out round the base, bits falling off the top edge as it comes down,
    // a ring of dust pushed out along the ground
    storey(c, dustK) {
        const b = c.b, fx = this.game.effects, per = (b.w + b.d) * 0.5, W = {};
        // (most of it piles up within a few metres of the walls: the apron of rubble round a ruin)
        const n = Math.round(Math.min(26, 5 + per * 0.55) * c.share);
        for (let i = 0; i < n; i++) {
            this.wallPoint(b, W);
            if (Math.random() < 0.65) {
                const sp = Math.random() < 0.8 ? rand(1.5, 6) : rand(6, 12);
                this.chunk(c, W.x + W.nx * 0.5, b.y + rand(0.3, 3), W.z + W.nz * 0.5, W.nx * sp + rand(-1.5, 1.5), rand(0.5, 5), W.nz * sp + rand(-1.5, 1.5));
            } else {
                const sp = rand(1, 5), top = Math.max(1, c.h - c.sunk);
                this.chunk(c, W.x + W.nx, b.y + top * rand(0.6, 1), W.z + W.nz, W.nx * sp, rand(-2, 3), W.nz * sp);
            }
        }
        const nd = Math.round(Math.min(12, 4 + per * 0.25) * c.share * dustK);
        for (let i = 0; i < nd; i++) {
            this.wallPoint(b, W);
            const sp = rand(6, 16);
            fx.smoke.emit(_v.set(W.x, b.y + rand(0.5, 2.5), W.z), _v2.set(W.nx * sp + rand(-2, 2), rand(0.5, 3), W.nz * sp + rand(-2, 2)),
                rand(9, 15), rand(4, 7), rand(16, 26) + per * 0.5, CONCRETE0, CONCRETE1, 0.8, 0, 0.7, 0.15, 0, 0.5, 0.5);
        }
    }

    // the last of it down: the dust it has pushed ahead of itself rolls out along the ground, round corners and down
    // the streets, and a pale cloud stands over the ruin for half a minute, drifting off on the wind
    surge(c, dustK) {
        const b = c.b, fx = this.game.effects, R = Math.max(b.w, b.d) / 2, per = (b.w + b.d) * 0.5;
        const n = Math.round(Math.min(70, 16 + per * 1.4) * c.share * dustK);
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + rand(-0.15, 0.15), sp = rand(10, 26) * (0.7 + 0.3 * Math.min(1, c.h / 30));
            const ca = Math.cos(a), sa = Math.sin(a);
            fx.smoke.emit(_v.set(b.x + ca * R * 0.8, b.y + rand(1, 4), b.z + sa * R * 0.8), _v2.set(ca * sp, rand(0.5, 3), sa * sp),
                rand(14, 24), rand(6, 10) + R * 0.3, rand(24, 40) + R * 0.8, CONCRETE0, CONCRETE1, 0.75, 0, 0.55, 0.12, 0, 0.5, 0.4);
        }
        const m = Math.round(Math.min(24, 6 + c.h * 0.4) * c.share * dustK);
        for (let i = 0; i < m; i++) {
            fx.smoke.emit(_v.set(b.x + rand(-0.4, 0.4) * b.w, b.y + rand(2, Math.max(3, c.h * 0.5)), b.z + rand(-0.4, 0.4) * b.d), _v2.set(rand(-2, 2), rand(3, 9), rand(-2, 2)),
                rand(18, 30), R * 0.8 + 8, R * 1.6 + 30, CONCRETE0, CONCRETE1, 0.7, 0, 0.35, 0.4, 0, 0.5, 0.3);
        }
        const g = this.game;
        if (c.share >= 1) g.audio.boom(g.camera.position.distanceTo(_v.set(b.x, b.y, b.z)), 0.8);
    }

    // the standing stub of a wall instance: the bottom storey or so, burnt
    stub(b, pt) {
        const h = b.top - b.y;
        const k = Math.min(1, Math.min(3.2, 1 + h * 0.08) / Math.max(h, 1)); // lower than the heap piled inside it
        if (pt.im.instanceColor) { if (!pt.col) { pt.im.getColorAt(pt.i, _c); pt.col = _c.clone(); } pt.im.setColorAt(pt.i, _c.copy(pt.col).multiplyScalar(0.28)); touch(pt.im.instanceColor, pt.i); }
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
                const b = f.b, s = G[n++], size = Math.max(b.w, b.d) * 1.25 + 8;
                const fl = 0.8 + Math.sin(f.flick * 9.1) * 0.08 + Math.sin(f.flick * 23.7) * 0.06;
                s.position.set(b.x, b.y + 3 + size * 0.12, b.z);
                s.scale.setScalar(size * fl);
                s.material.opacity = (this.night ? 0.8 : 0.12) * Math.min(1, f.fire / 4) * fl;
                s.visible = true;
            }
        }
        for (; n < G.length; n++) G[n].visible = false;
    }

    setNight(on) { this.night = on; }

    // a heap of rubble on b's footprint (f: how much of its height it has yet: a collapse grows it); its slot, or -1
    addRubble(b, vehicle, f = 1) {
        const r = this.rubble;
        if (r.count >= r.instanceMatrix.count) return -1;
        const i = r.count++;
        b.heapYaw = b.yaw + rand(-0.2, 0.2);
        this.heapMatrix(i, b, vehicle, f);
        // tinted by what it was built from (walls), darkened: soot and dust
        const w = this.wallColour(b);
        _c.setRGB(w[0], w[1], w[2]).lerp(DUST, 0.5).multiplyScalar(0.85);
        if (vehicle) _c.setRGB(0.16, 0.15, 0.14);
        r.setColorAt(i, _c);
        r.instanceColor.needsUpdate = true;
        return i;
    }

    heapMatrix(i, b, vehicle, f) {
        const r = this.rubble, h = b.top - b.y;
        _q.setFromAxisAngle(_v.set(0, 1, 0), b.heapYaw);
        const hh = vehicle ? 1.2 : Math.min(3 + h * 0.3, 18); // (the mound is ~0.53 of this: a third of a low block's height)
        r.setMatrixAt(i, _m.compose(_p.set(b.x, b.y + 0.3, b.z), _q, _s.set(b.w * (vehicle ? 0.8 : 1.12), hh * f, b.d * (vehicle ? 0.8 : 1.12))));
        touch(r.instanceMatrix, i);
    }

    growRubble(i, b, f) { this.heapMatrix(i, b, false, f); }

    // back to the untouched world (between sorties)
    reset() {
        for (const c of this.collapsing) c.b.alive = false; // finish: fall through to the restore below
        this.collapsing = []; this.burning = []; this.smoking = [];
        for (const b of this.list) {
            if (b.alive && b.hp === b.maxHp) continue;
            for (const pt of b.parts) {
                if (pt.im) {
                    if (pt.base) { pt.im.setMatrixAt(pt.i, pt.base); touch(pt.im.instanceMatrix, pt.i); }
                    if (pt.col) { pt.im.setColorAt(pt.i, pt.col); touch(pt.im.instanceColor, pt.i); }
                } else if (pt.meshes) {
                    for (const q of pt.meshes) { q.o.matrixWorld.copy(q.base); q.o.matrixWorldAutoUpdate = q.auto; }
                    pt.meshes = null;
                }
            }
            b.alive = true; b.hp = b.maxHp; b.hitX = b.hitY = b.hitZ = null;
        }
        this.rubble.count = 0;
        this.chunks.reset();
        for (const s of this.glows) s.visible = false;
    }
}

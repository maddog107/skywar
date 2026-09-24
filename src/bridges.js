// ═══════════════════════════════════════════════════════════════
// Bridges: concrete road bridges over water, destructible.
// Bombs drop them (missiles and rockets barely scratch them). When one goes,
// the span around the hit collapses into the water and the road is cut.
// Bridges act as neutral ground targets while a game is running.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, clamp } from './util.js';

const SEG = 24;          // segment length (m), matches the road texture repeat
const HALF_W = 8.5;      // deck half width
const HP = 520;
const KIND_MULT = { bomb: 1, missile: 0.3, rocket: 0.4 };

const MAT = {
    concrete: new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.9 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8c3b2e, roughness: 0.55, metalness: 0.4 }),
    cable: new THREE.LineBasicMaterial({ color: 0xdedcd4, transparent: true, opacity: 0.7, fog: true }),
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

function boxGeo(w, h, d, x, y, z, rotY = 0, pitch = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    _q.setFromEuler(new THREE.Euler(pitch, rotY, 0, 'YXZ'));
    g.applyMatrix4(_m.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1)));
    return g;
}

export class Bridge {
    constructor(A, B, index) {
        this.index = index;
        this.a = A.clone(); this.b = B.clone();
        this.len = Math.hypot(B.x - A.x, B.z - A.z);
        this.dir = new THREE.Vector3(B.x - A.x, 0, B.z - A.z).normalize();
        this.right = new THREE.Vector3(-this.dir.z, 0, this.dir.x);
        this.heading = Math.atan2(-this.dir.x, -this.dir.z);
        this.n = Math.max(2, Math.round(this.len / SEG));
        this.segLen = this.len / this.n;
        this.rise = clamp(this.len * 0.035, 6, 35);
        this.group = new THREE.Group();
        // ground-target interface
        this.isGround = true; this.isBridge = true;
        this.team = 'neutral';
        this.name = 'BRIDGE';
        this.type = 'bridge';
        this.def = { name: 'BRIDGE', score: 600, boom: 3 };
        this.radius = 20; this.hitRadius = 20;
        this.vel = new THREE.Vector3();
        this.incoming = [];
        this.pos = new THREE.Vector3((A.x + B.x) / 2, this.deckY(0.5) + 1, (A.z + B.z) / 2);
        this.center = this.pos;
        this.bbox = {
            x0: Math.min(A.x, B.x) - 12, x1: Math.max(A.x, B.x) + 12,
            z0: Math.min(A.z, B.z) - 12, z1: Math.max(A.z, B.z) + 12,
        };
        this.segGeo = [];
        this.buildParts();
        this.reset();
    }

    deckY(t) {
        return this.a.y + (this.b.y - this.a.y) * t + this.rise * Math.sin(Math.PI * clamp(t, 0, 1));
    }
    pointAt(s, out) {
        const t = s / this.len;
        return out.set(this.a.x + this.dir.x * s, this.deckY(t), this.a.z + this.dir.z * s);
    }

    // Per-segment geometry (world space), built once
    buildParts() {
        for (let i = 0; i < this.n; i++) {
            const s0 = i * this.segLen, s1 = s0 + this.segLen;
            const p0 = this.pointAt(s0, new THREE.Vector3()), p1 = this.pointAt(s1, new THREE.Vector3());
            const mid = p0.clone().add(p1).multiplyScalar(0.5);
            const L = p0.distanceTo(p1) + 0.3;
            const pitch = Math.atan2(p1.y - p0.y, this.segLen);
            const parts = [
                boxGeo(HALF_W * 2, 1.6, L, 0, -0.8, 0),                    // slab
                boxGeo(HALF_W * 1.1, 1.8, L, 0, -2.4, 0),                  // box girder
                boxGeo(0.5, 1.1, L, HALF_W - 0.25, 0.55, 0),               // parapets
                boxGeo(0.5, 1.1, L, -HALF_W + 0.25, 0.55, 0),
            ];
            const concrete = mergeGeometries(parts);
            parts.forEach(g => g.dispose());
            const road = new THREE.PlaneGeometry(HALF_W * 2 - 2, L);
            road.rotateX(-Math.PI / 2);
            road.translate(0, 0.03, 0);
            // v runs along the road
            const uv = road.attributes.uv;
            for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * L / 24);
            const local = new THREE.Matrix4().compose(mid, _q.setFromEuler(new THREE.Euler(pitch, this.heading, 0, 'YXZ')), _s.set(1, 1, 1));
            this.segGeo.push({ concrete, road, local, mid, s0, s1 });
        }
        // piers (every ~3 segments, down into the water) and, on long spans, cable-stay towers
        const piers = [];
        const every = Math.max(2, Math.round(70 / this.segLen));
        for (let i = every; i < this.n; i += every) {
            const p = this.pointAt(i * this.segLen, new THREE.Vector3());
            const h = p.y - 3.3 + 20;
            for (const side of [-1, 1]) {
                const g = new THREE.CylinderGeometry(1.6, 2, h, 10);
                g.translate(p.x + this.right.x * side * 5, p.y - 3.3 - h / 2, p.z + this.right.z * side * 5);
                piers.push(g);
            }
            const cap = boxGeo(HALF_W * 2 + 1, 1.4, 4, 0, 0, 0);
            cap.applyMatrix4(new THREE.Matrix4().compose(_v.set(p.x, p.y - 3.9, p.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading), _s.set(1, 1, 1)));
            piers.push(cap);
        }
        this.towers = [];
        if (this.len > 420) {
            for (const t of [0.28, 0.72]) {
                const s = t * this.len;
                const p = this.pointAt(s, new THREE.Vector3());
                const H = 40 + this.len * 0.03;
                const top = p.y + H;
                for (const side of [-1, 1]) {
                    const g = new THREE.BoxGeometry(2.4, H + 25, 3);
                    g.translate(p.x + this.right.x * side * (HALF_W + 1.5), p.y + (H - 25) / 2, p.z + this.right.z * side * (HALF_W + 1.5));
                    piers.push(g);
                }
                const beam = boxGeo(HALF_W * 2 + 5, 2.4, 2.4, 0, 0, 0);
                beam.applyMatrix4(new THREE.Matrix4().compose(_v.set(p.x, top - 4, p.z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.heading), _s.set(1, 1, 1)));
                piers.push(beam);
                this.towers.push({ s, top, p });
            }
        }
        if (piers.length) {
            const pg = mergeGeometries(piers.map(g => g.index ? g.toNonIndexed() : g));
            piers.forEach(g => g.dispose());
            this.piers = new THREE.Mesh(pg, MAT.concrete);
            this.piers.castShadow = true; this.piers.receiveShadow = true;
            this.group.add(this.piers);
        }
    }

    // Rebuild the intact deck (and cables) from the segments still standing
    rebuildDeck() {
        for (const m of [this.deckMesh, this.roadMesh, this.cables]) if (m) { this.group.remove(m); m.geometry.dispose(); }
        const cg = [], rg = [];
        this.segGeo.forEach((sg, i) => {
            if (this.fallen[i]) return;
            cg.push(sg.concrete.clone().applyMatrix4(sg.local));
            rg.push(sg.road.clone().applyMatrix4(sg.local));
        });
        this.deckMesh = this.roadMesh = this.cables = null;
        if (cg.length) {
            this.deckMesh = new THREE.Mesh(mergeGeometries(cg), MAT.concrete);
            this.deckMesh.castShadow = true; this.deckMesh.receiveShadow = true;
            this.roadMesh = new THREE.Mesh(mergeGeometries(rg), Bridge.roadMaterial);
            this.roadMesh.receiveShadow = true;
            this.group.add(this.deckMesh, this.roadMesh);
        }
        cg.forEach(g => g.dispose()); rg.forEach(g => g.dispose());
        if (this.towers.length) {
            const pts = [];
            for (const tw of this.towers) {
                for (let k = 1; k <= 8; k++) for (const dir of [-1, 1]) {
                    const s = tw.s + dir * k * this.len * 0.028;
                    const seg = Math.floor(s / this.segLen);
                    if (s < 0 || s > this.len || this.fallen[seg]) continue;
                    const d = this.pointAt(s, _v);
                    for (const side of [-1, 1]) {
                        const ox = this.right.x * side * (HALF_W + 1.2), oz = this.right.z * side * (HALF_W + 1.2);
                        pts.push(tw.p.x + ox, tw.top - 6, tw.p.z + oz, d.x + ox, d.y + 0.5, d.z + oz);
                    }
                }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
            this.cables = new THREE.LineSegments(g, MAT.cable);
            this.group.add(this.cables);
        }
    }

    reset() {
        this.alive = true;
        this.hp = this.health = this.maxHealth = HP;
        this.objective = false;
        this.gap = null;
        this.burnT = 0;
        this.incoming.length = 0;
        this.fallen = new Array(this.n).fill(false);
        if (this.falling) for (const f of this.falling) { this.group.remove(f.mesh); }
        this.falling = [];
        this.rebuildDeck();
    }
    remove() { this.reset(); } // GroundForces.clear() → restore for the next sortie

    // ── Ground-target interface ──
    local(p) {
        const rx = p.x - this.a.x, rz = p.z - this.a.z;
        return { s: rx * this.dir.x + rz * this.dir.z, l: rx * this.right.x + rz * this.right.z };
    }
    standing(s) { return s >= 0 && s <= this.len && !this.fallen[Math.min(this.n - 1, Math.floor(s / this.segLen))]; }

    hitTest(p) {
        if (p.x < this.bbox.x0 || p.x > this.bbox.x1 || p.z < this.bbox.z0 || p.z > this.bbox.z1) return false;
        const { s, l } = this.local(p);
        if (Math.abs(l) > HALF_W + 1 || !this.standing(s)) return false;
        const y = this.deckY(s / this.len);
        if (p.y < y - 4.5 || p.y > y + 3) return false;
        this.hitS = s;
        return true;
    }

    distTo(p) {
        const { s } = this.local(p);
        return this.pointAt(clamp(s, 0, this.len), _v2).distanceTo(p);
    }

    // Road surface under (x, z) for anything at height y (flying under the deck is allowed)
    deckAt(x, z, y) {
        if (x < this.bbox.x0 || x > this.bbox.x1 || z < this.bbox.z0 || z > this.bbox.z1) return null;
        const { s, l } = this.local(_v.set(x, 0, z));
        if (Math.abs(l) > HALF_W || !this.standing(s)) return null;
        const h = this.deckY(s / this.len);
        return y >= h - 3 ? h : null;
    }

    damage(amount, source, kind) {
        if (!this.alive) return;
        this.lastKind = kind;
        this.hp -= amount * (KIND_MULT[kind] ?? 0.03);
        this.health = Math.max(0, this.hp);
        if (this.hp <= 0) this.destroy(source);
    }

    destroy(source) {
        const g = this.game;
        this.alive = false;
        this.hp = this.health = 0;
        const sc = clamp(this.hitS ?? this.len / 2, this.segLen * 1.5, this.len - this.segLen * 1.5);
        const half = clamp(this.len * 0.15, 36, 80);
        const g0 = Math.max(this.segLen, sc - half), g1 = Math.min(this.len - this.segLen, sc + half);
        this.falling = [];
        this.segGeo.forEach((sg, i) => {
            const c = (sg.s0 + sg.s1) / 2;
            if (c < g0 || c > g1) return;
            this.fallen[i] = true;
            const grp = new THREE.Group();
            grp.add(new THREE.Mesh(sg.concrete, MAT.concrete), new THREE.Mesh(sg.road, Bridge.roadMaterial));
            grp.position.copy(sg.mid);
            grp.quaternion.setFromEuler(new THREE.Euler(0, this.heading, 0, 'YXZ'));
            this.group.add(grp);
            // pieces near the break points hinge, the middle drops
            const edge = Math.min(c - g0, g1 - c) / half;
            this.falling.push({
                mesh: grp, delay: rand(0, 0.35) + edge * 0.2,
                vel: new THREE.Vector3(rand(-2, 2), rand(-1, 2), rand(-2, 2)),
                spin: new THREE.Vector3(rand(-0.5, 0.5), rand(-0.1, 0.1), rand(-0.6, 0.6)),
                splashed: false,
            });
        });
        const i0 = this.fallen.indexOf(true), i1 = this.fallen.lastIndexOf(true);
        this.gap = [i0 * this.segLen, (i1 + 1) * this.segLen];
        this.rebuildDeck();
        if (g) {
            const at = this.pointAt(sc, new THREE.Vector3());
            g.effects.explosion(at, 3);
            g.effects.debrisBurst(at, _v.set(0, 35, 0), 10, 1.5);
            g.audio.boom(g.camera.position.distanceTo(at), 2);
            g.events.emit('groundKilled', this, { source });
            g.events.emit('bridgeDown', this, { source });
        }
        this.burnT = 50;
        this.smokeT = 0;
    }

    update(dt) {
        const g = this.game;
        for (const f of this.falling) {
            if (f.delay > 0) { f.delay -= dt; continue; }
            if (f.mesh.position.y < -40) continue;
            f.vel.y -= 9.8 * dt;
            if (f.mesh.position.y < 0) f.vel.multiplyScalar(1 - 2.5 * dt); // water drag
            f.mesh.position.addScaledVector(f.vel, dt);
            f.mesh.rotation.x += f.spin.x * dt; f.mesh.rotation.z += f.spin.z * dt;
            if (!f.splashed && f.mesh.position.y < 1 && g) {
                f.splashed = true;
                g.effects.waterSplash(_v.copy(f.mesh.position).setY(0.5), 2.5);
                if (Math.random() < 0.4) g.audio.boom(g.camera.position.distanceTo(f.mesh.position), 0.8);
            }
        }
        if (this.burnT > 0 && this.gap && g) {
            this.burnT -= dt;
            this.smokeT -= dt;
            if (this.smokeT <= 0) {
                this.smokeT = 0.15;
                for (const s of this.gap) {
                    const p = this.pointAt(s, _v);
                    g.effects.smoke.emit(p, _v2.set(rand(-2, 2), rand(6, 10), rand(-2, 2)), rand(5, 8), 5, 30, [0.1, 0.1, 0.1], [0.35, 0.34, 0.32], 0.6, 0, 0.15, 5);
                    if (Math.random() < 0.3) g.effects.puffFire(p, _v2.set(0, 8, 0), 4, 0.5);
                }
            }
        }
    }
}
Bridge.roadMaterial = null; // set by roads.js (shared road material)

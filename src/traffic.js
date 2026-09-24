// ═══════════════════════════════════════════════════════════════
// Civilian traffic: instanced cars and trucks driving the road network.
// They keep right, slow for broken bridges and turn back, and get wrecked
// by nearby explosions (a bridge collapsing under them sends them into the water).
// At night they show headlights and tail lights.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { samplePath, LANE } from './roads.js';
import { rand, makeRadialTexture } from './util.js';

const COLORS = [0xd8d8d8, 0x1d3f8a, 0xb01e1e, 0x202225, 0xe0b43a, 0x2e6b3a, 0x7a7f86, 0xf0f0ea, 0x5a2d82, 0xc85a1e];
const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _c = new THREE.Color();

export class Traffic {
    constructor(scene, paths) {
        this.paths = paths.filter(p => p.len > 300);
        const total = this.paths.reduce((a, p) => a + p.len, 0);
        this.count = Math.min(220, Math.floor(total / 450));
        const body = new THREE.BoxGeometry(2, 1.1, 4.5); body.translate(0, 0.85, 0);
        const cabin = new THREE.BoxGeometry(1.8, 0.85, 2.3); cabin.translate(0, 1.8, 0.35);
        this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.5 }), this.count);
        this.cabin = new THREE.InstancedMesh(cabin, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0.6 }), this.count);
        for (const im of [this.body, this.cabin]) { im.frustumCulled = false; im.castShadow = false; scene.add(im); }
        // lights: 2 points per car (head + tail)
        const lp = new Float32Array(this.count * 6), lc = new Float32Array(this.count * 6);
        for (let i = 0; i < this.count; i++) { lc.set([1.6, 1.5, 1.2, 1.4, 0.1, 0.05], i * 6); }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
        lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
        this.lights = new THREE.Points(lg, new THREE.PointsMaterial({
            map: makeRadialTexture(32, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]),
            vertexColors: true, size: 9, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
        }));
        this.lights.frustumCulled = false;
        this.lights.visible = false;
        scene.add(this.lights);
        this.cars = [];
        for (let i = 0; i < this.count; i++) this.cars.push({ i });
        this.reset();
    }

    setNight(on) { this.lights.visible = on; }

    reset() {
        for (const c of this.cars) this.place(c);
        this.blocked = new Set();
        this.update(0, null);
    }

    place(c) {
        // weight path choice by length so traffic density is even
        const total = this.paths.reduce((a, p) => a + p.len, 0);
        let r = Math.random() * total, path = this.paths[0];
        for (const p of this.paths) { r -= p.len; if (r <= 0) { path = p; break; } }
        c.path = path;
        c.dir = Math.random() < 0.5 ? 1 : -1;
        c.s = rand(20, path.len - 20);
        c.truck = Math.random() < 0.2;
        c.cruise = c.truck ? rand(13, 18) : rand(17, 27);
        c.speed = c.cruise;
        c.wait = 0;
        c.dead = false; c.fall = 0; c.vy = 0; c.yOff = 0; c.smoke = 0;
        c.color = COLORS[Math.floor(Math.random() * COLORS.length)];
        this.body.setColorAt(c.i, _c.setHex(c.color));
        this.cabin.setColorAt(c.i, _c.setHex(c.truck ? 0xcfd2d4 : 0x2a3440));
        if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
        if (this.cabin.instanceColor) this.cabin.instanceColor.needsUpdate = true;
    }

    // distance ahead (along the car's direction) to the nearest broken span, or Infinity
    gapAhead(c) {
        let best = Infinity;
        for (const b of c.path.bridges) {
            const br = b.bridge;
            if (!br.gap) continue;
            const g0 = b.s0 + br.gap[0], g1 = b.s0 + br.gap[1];
            const d = c.dir > 0 ? g0 - c.s : c.s - g1;
            if (d > -1 && d < best) best = d;
            if (c.s > g0 && c.s < g1) return -1; // on the part that fell
        }
        return best;
    }

    wreck(c, fall) {
        if (c.dead) return;
        c.dead = true;
        c.speed = 0;
        c.fall = fall ? 1 : 0;
        c.smoke = fall ? 0 : rand(12, 25);
        this.body.setColorAt(c.i, _c.setHex(0x1a1918));
        this.cabin.setColorAt(c.i, _c.setHex(0x111111));
        this.body.instanceColor.needsUpdate = this.cabin.instanceColor.needsUpdate = true;
    }

    // Explosion at `at` with radius R wrecks nearby cars
    blast(at, R, game) {
        for (const c of this.cars) {
            if (c.dead || !c.pos) continue;
            if (c.pos.distanceToSquared(at) < (R + 4) * (R + 4)) {
                this.wreck(c, false);
                if (game) game.effects.explosion(c.pos, 0.5);
            }
        }
    }

    update(dt, game) {
        const lp = this.lights.geometry.attributes.position;
        for (const c of this.cars) {
            if (!c.dead) {
                const gap = this.gapAhead(c);
                if (gap < 0) {
                    this.wreck(c, true); // the road just fell away
                } else {
                    let target = c.cruise;
                    if (gap < 120) target = Math.max(0, (gap - 14) * 0.25);
                    c.speed += Math.max(-8 * dt, Math.min(3 * dt, target - c.speed));
                    if (c.speed < 0.3 && gap < 40) { c.wait += dt; if (c.wait > rand(4, 9)) { c.dir = -c.dir; c.wait = 0; } }
                    c.s += c.dir * c.speed * dt;
                    if (c.s < 5 || c.s > c.path.len - 5) { c.s = Math.max(5, Math.min(c.path.len - 5, c.s)); c.dir = -c.dir; }
                }
            }
            if (c.fall) {
                c.vy -= 9.8 * dt;
                c.yOff += c.vy * dt;
                if (c.fall === 1 && samplePath(c.path, c.s, _p).y + c.yOff < 0.5) {
                    c.fall = 2;
                    if (game) game.effects.waterSplash(_p.setY(0.3), 0.8);
                }
                if (c.yOff < -80) c.fall = 0;
            }
            samplePath(c.path, c.s, _p, _t);
            if (c.dir < 0) _t.negate();
            const rx = -_t.z, rz = _t.x, rl = Math.hypot(rx, rz) || 1;
            _p.x += rx / rl * LANE; _p.z += rz / rl * LANE;
            _p.y += (_p.g || 0) * LANE * c.dir + c.yOff;
            c.pos = c.pos || new THREE.Vector3();
            c.pos.copy(_p);
            _e.set(Math.asin(Math.max(-1, Math.min(1, _t.y))), Math.atan2(-_t.x, -_t.z), c.dead && !c.fall ? 0.15 : 0);
            _q.setFromEuler(_e);
            const k = c.truck ? 1.35 : 1;
            _s.set(k, k * (c.truck ? 1.25 : 1), c.truck ? 1.9 : 1);
            if (c.fall === 0 && c.yOff < -60) _s.set(0.0001, 0.0001, 0.0001);
            _m.compose(_p, _q, _s);
            this.body.setMatrixAt(c.i, _m);
            this.cabin.setMatrixAt(c.i, _m);
            if (this.lights.visible) {
                const hx = -_t.x * 2.4 * _s.z, hz = -_t.z * 2.4 * _s.z; // tail lights behind
                lp.setXYZ(c.i * 2, _p.x + _t.x * 2.4 * _s.z, _p.y + 0.9, _p.z + _t.z * 2.4 * _s.z);
                lp.setXYZ(c.i * 2 + 1, _p.x + hx, _p.y + 0.9, _p.z + hz);
                if (c.dead) { lp.setXYZ(c.i * 2, 0, -999, 0); lp.setXYZ(c.i * 2 + 1, 0, -999, 0); }
            }
            if (c.smoke > 0 && game) {
                c.smoke -= dt;
                if (Math.random() < dt * 8) game.effects.smoke.emit(c.pos, _t.set(rand(-1, 1), rand(4, 7), rand(-1, 1)), rand(2, 4), 4, 14, [0.08, 0.08, 0.08], [0.3, 0.3, 0.3], 0.5, 0, 0.2, 2);
            }
        }
        this.body.instanceMatrix.needsUpdate = this.cabin.instanceMatrix.needsUpdate = true;
        if (this.lights.visible) lp.needsUpdate = true;
    }

    // keep a road clear (e.g. for a mission convoy)
    clearPath(path) {
        for (const c of this.cars) if (c.path === path) { let tries = 0; do { this.place(c); } while (c.path === path && ++tries < 20); }
    }
}

// ═══════════════════════════════════════════════════════════════
// Traffic: instanced cars and trucks on roads and town streets, dune buggies
// on the dirt trails.
//   • keep right; stop at red lights (go on green), halt at stop signs
//   • slow for broken bridges and turn back; wrecked by nearby explosions
//     (a bridge collapsing under them sends them into the water)
//   • headlights and tail lights at night, dust behind the buggies
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { samplePath, LANE, liftWithDistance } from './roads.js';
import { rand, makeRadialTexture } from './util.js';
import { propParts } from './props.js';
import { CarSet, PAINTS } from './carset.js';

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _c = new THREE.Color(), _v = new THREE.Vector3();

export class Traffic {
    constructor(scene, paths, dirtPaths = [], towns = null) {
        this.towns = towns;
        this.paths = paths.filter(p => p.len > 120);
        this.dirtPaths = dirtPaths;
        this.roadLen = this.paths.reduce((a, p) => a + p.len, 0);
        this.count = Math.min(620, Math.floor(this.roadLen / 230));
        // real car models (instanced per type)
        this.carSet = new CarSet(scene, this.count, Math.random, { onRoad: true });
        // dune buggies: the model's parts, instanced
        this.buggyCount = Math.min(60, dirtPaths.length * 3);
        this.buggyParts = [];
        const parts = this.buggyCount ? propParts('buggy') : null;
        if (parts) for (const pt of parts) {
            const im = new THREE.InstancedMesh(pt.geometry, liftWithDistance(pt.material.clone()), this.buggyCount);
            im.frustumCulled = false; im.castShadow = true;
            scene.add(im);
            this.buggyParts.push(im);
        }
        if (!this.buggyParts.length) this.buggyCount = 0;
        // lights: 2 points per car (head + tail)
        const lp = new Float32Array(this.count * 6), lc = new Float32Array(this.count * 6);
        for (let i = 0; i < this.count; i++) { lc.set([1.6, 1.5, 1.2, 1.4, 0.1, 0.05], i * 6); lp[i * 6 + 1] = lp[i * 6 + 4] = -999; } // hidden until placed
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
        lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
        this.lights = new THREE.Points(lg, liftWithDistance(new THREE.PointsMaterial({
            map: makeRadialTexture(32, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]),
            vertexColors: true, size: 4.5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
        })));
        this.lights.frustumCulled = false;
        this.lights.visible = false;
        scene.add(this.lights);
        this.cars = [];
        for (let i = 0; i < this.count; i++) this.cars.push({ i });
        this.buggies = [];
        for (let i = 0; i < this.buggyCount; i++) this.buggies.push({ i, buggy: true });
        this.reset();
    }

    setNight(on) {
        this.lights.visible = on;
        if (on) this.lights.geometry.attributes.position.needsUpdate = true;
    }

    reset() {
        for (const c of this.cars) this.place(c);
        this.buggies.forEach((b, i) => this.placeBuggy(b, i));
        this.update(0, null);
    }

    place(c) {
        let r = Math.random() * this.roadLen, path = this.paths[0];
        for (const p of this.paths) { r -= p.len; if (r <= 0) { path = p; break; } }
        c.path = path;
        c.dir = Math.random() < 0.5 ? 1 : -1;
        c.s = rand(10, path.len - 10);
        c.truck = false;
        c.cruise = path.street ? rand(10, 14) : rand(16, 27);
        c.speed = c.cruise;
        c.wait = 0; c.stopDone = null; c.stopT = 0;
        c.dead = false; c.fall = 0; c.vy = 0; c.yOff = 0; c.smoke = 0; c.stolen = false;
        c.color = PAINTS[Math.floor(Math.random() * PAINTS.length)];
        this.carSet.restore(c.i, c.color);
    }

    placeBuggy(b, i) {
        const path = this.dirtPaths[i % this.dirtPaths.length];
        b.path = path; b.dir = Math.random() < 0.5 ? 1 : -1;
        b.s = rand(5, path.len - 5);
        b.cruise = rand(11, 19); b.speed = b.cruise;
        b.dead = false; b.fall = 0; b.yOff = 0; b.vy = 0; b.smoke = 0; b.bounce = Math.random() * 10;
        b.dust = 0;
    }

    // distance ahead (along the car's direction) to the nearest broken span, or Infinity (-1 = on it)
    gapAhead(c) {
        let best = Infinity;
        for (const b of c.path.bridges) {
            const br = b.bridge;
            if (!br.gap) continue;
            const g0 = b.s0 + br.gap[0], g1 = b.s0 + br.gap[1];
            if (c.s > g0 && c.s < g1) return -1;
            const d = c.dir > 0 ? g0 - c.s : c.s - g1;
            if (d > -1 && d < best) best = d;
        }
        return best;
    }

    // speed limit from the next junction (red light or stop sign)
    junctionLimit(c, dt) {
        const stops = c.path.stops;
        if (!stops || !stops.length || !this.towns) return Infinity;
        // nearest stop line ahead: 9 m before the junction centre
        let st = null, dist = Infinity;
        for (const s of stops) {
            const line = s.s - c.dir * 9;
            const d = (line - c.s) * c.dir;
            if (d > -0.5 && d < dist) { dist = d; st = s; }
        }
        if (!st || dist > 60) return Infinity;
        const key = st.inter;
        if (st.inter.type === 'light') {
            const state = this.towns.lightState(st.inter, st.axis);
            if (state === 'green' || (state === 'amber' && dist < 10)) return Infinity;
            return Math.max(0, (dist - 1) * 0.45);
        }
        // stop sign: come to a halt, wait a moment, then go
        if (c.stopDone === key) return Infinity;
        if (dist < 2 && c.speed < 0.4) {
            c.stopT += dt;
            if (c.stopT > 1.2) { c.stopDone = key; c.stopT = 0; }
            return 0;
        }
        return Math.max(0, (dist - 0.5) * 0.45);
    }

    wreck(c, fall) {
        if (c.dead) return;
        c.dead = true;
        c.speed = 0;
        c.fall = fall ? 1 : 0;
        c.smoke = fall ? 0 : rand(12, 25);
        if (c.buggy) return;
        this.carSet.wreck(c.i);
    }

    // Explosion at `at` with radius R wrecks nearby vehicles
    blast(at, R, game) {
        const r2 = (R + 4) * (R + 4);
        for (const list of [this.cars, this.buggies]) for (const c of list) {
            if (c.dead || !c.pos) continue;
            if (c.pos.distanceToSquared(at) < r2) {
                this.wreck(c, false);
                if (game) game.effects.explosion(c.pos, 0.5);
            }
        }
    }

    move(c, dt) {
        const gap = this.gapAhead(c);
        if (gap < 0) { this.wreck(c, true); return; }
        let target = c.cruise;
        if (gap < 120) target = Math.max(0, (gap - 14) * 0.25);
        target = Math.min(target, this.junctionLimit(c, dt));
        c.speed += Math.max(-7 * dt, Math.min(3 * dt, target - c.speed));
        if (c.speed < 0.3 && gap < 40) { c.wait += dt; if (c.wait > rand(4, 9)) { c.dir = -c.dir; c.wait = 0; } }
        c.s += c.dir * c.speed * dt;
        if (c.s < 4 || c.s > c.path.len - 4) { c.s = Math.max(4, Math.min(c.path.len - 4, c.s)); c.dir = -c.dir; c.stopDone = null; }
    }

    // world transform of a vehicle on its path
    pose(c, lane) {
        samplePath(c.path, c.s, _p, _t);
        if (c.dir < 0) _t.negate();
        const rx = -_t.z, rz = _t.x, rl = Math.hypot(rx, rz) || 1;
        _p.x += rx / rl * lane; _p.z += rz / rl * lane;
        _p.y += (_p.g || 0) * lane * c.dir + c.yOff;
        c.pos = c.pos || new THREE.Vector3();
        c.pos.copy(_p);
    }

    fallUpdate(c, dt, game) {
        if (!c.fall) return;
        c.vy -= 9.8 * dt;
        c.yOff += c.vy * dt;
        if (c.fall === 1 && samplePath(c.path, c.s, _v).y + c.yOff < 0.5) {
            c.fall = 2;
            if (game) game.effects.waterSplash(_v.setY(0.3), 0.8);
        }
        if (c.yOff < -80) c.fall = 0;
    }

    update(dt, game) {
        const lp = this.lights.geometry.attributes.position;
        const cam = game && game.camera ? game.camera.position : null;
        this.frame = (this.frame || 0) + 1;
        const FAR2 = 5000 * 5000;
        for (const c of this.cars) {
            if (c.stolen) { // taken by the player: its lights go with it
                _m.makeScale(0, 0, 0); this.carSet.setMatrix(c.i, _m);
                lp.setXYZ(c.i * 2, 0, -999, 0); lp.setXYZ(c.i * 2 + 1, 0, -999, 0);
                continue;
            }
            // far from the camera: simulate every 4th frame (with the saved-up time) — nobody can see them
            if (cam && c.pos && dt > 0 && !c.fall && (c.pos.x - cam.x) ** 2 + (c.pos.z - cam.z) ** 2 > FAR2 && (this.frame + c.i) % 4) { c.acc = (c.acc || 0) + dt; continue; }
            const cdt = dt + (c.acc || 0); c.acc = 0;
            if (!c.dead) this.move(c, cdt);
            this.fallUpdate(c, dt, game);
            this.pose(c, c.path.street ? 2.4 : LANE);
            _e.set(Math.asin(Math.max(-1, Math.min(1, _t.y))), Math.atan2(-_t.x, -_t.z), c.dead && !c.fall ? 0.15 : 0);
            _q.setFromEuler(_e);
            _s.set(1, 1, 1);
            if (c.fall === 0 && c.yOff < -60) _s.set(0.0001, 0.0001, 0.0001);
            _m.compose(_p, _q, _s);
            this.carSet.setMatrix(c.i, _m);
            { // always kept current (cheap), so switching to night shows them in the right place
                if (c.dead) { lp.setXYZ(c.i * 2, 0, -999, 0); lp.setXYZ(c.i * 2 + 1, 0, -999, 0); }
                else {
                    lp.setXYZ(c.i * 2, _p.x + _t.x * 2.4 * _s.z, _p.y + 0.9, _p.z + _t.z * 2.4 * _s.z);
                    lp.setXYZ(c.i * 2 + 1, _p.x - _t.x * 2.4 * _s.z, _p.y + 0.9, _p.z - _t.z * 2.4 * _s.z);
                }
            }
            if (c.smoke > 0 && game) {
                c.smoke -= dt;
                if (Math.random() < dt * 8) game.effects.smoke.emit(c.pos, _v.set(rand(-1, 1), rand(4, 7), rand(-1, 1)), rand(2, 4), 4, 14, [0.08, 0.08, 0.08], [0.3, 0.3, 0.3], 0.5, 0, 0.2, 2);
            }
        }
        for (const b of this.buggies) {
            if (!b.dead) this.move(b, dt);
            this.fallUpdate(b, dt, game);
            b.bounce += dt * (4 + b.speed * 0.5);
            b.yOff = b.fall ? b.yOff : Math.abs(Math.sin(b.bounce)) * 0.12 * Math.min(1, b.speed / 8);
            this.pose(b, 1.4);
            _e.set(Math.asin(Math.max(-1, Math.min(1, _t.y))) + Math.sin(b.bounce * 1.3) * 0.03, Math.atan2(-_t.x, -_t.z), b.dead ? 0.4 : Math.sin(b.bounce * 0.7) * 0.04);
            _q.setFromEuler(_e);
            _m.compose(_p, _q, _s.set(1, 1, 1));
            for (const im of this.buggyParts) im.setMatrixAt(b.i, _m);
            // dust plume, only where someone can see it
            if (game && !b.dead && b.speed > 6 && cam && cam.distanceToSquared(b.pos) < 900 * 900) {
                b.dust -= dt;
                if (b.dust <= 0) {
                    b.dust = 0.07;
                    _v.copy(b.pos).addScaledVector(_t, -1.8);
                    game.effects.smoke.emit(_v, _t.set(rand(-1.5, 1.5), rand(1, 3), rand(-1.5, 1.5)), rand(1.5, 2.5), 3, 12, [0.55, 0.45, 0.32], [0.62, 0.53, 0.4], 0.45, 0, 0.9, 1.5);
                }
            }
        }
        // only the cars near the camera go to the GPU
        this.carSet.commit(cam || { x: 0, z: 0 }, cam ? 3500 : 1e9);
        for (const im of this.buggyParts) im.instanceMatrix.needsUpdate = true;
        if (this.lights.visible) lp.needsUpdate = true;
    }

    // keep a road clear (e.g. for a mission convoy)
    clearPath(path) {
        for (const c of this.cars) if (c.path === path) { let tries = 0; do { this.place(c); } while (c.path === path && ++tries < 20); }
    }
}

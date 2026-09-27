// ═══════════════════════════════════════════════════════════════
// Life on the airbases (docs/WAR.md, "Airbases"): what moves on a field near the camera.
//  • people: one instanced mesh per field, animated in the vertex shader (walk, run, working arms), so a few dozen
//    ground crew, pilots and repair teams cost one draw call and no per-frame skinning
//  • vehicles: static merged copies (a couple of draw calls each) of the rigged models — fuel trucks, tugs, the
//    follow-me car, patrol and cargo trucks — driving their loops; the runway-repair teams' loaders and dump trucks
//    (their bucket and bed in the pose for the job), which are ground targets the enemy (and the player) can kill
//  • on alert the vehicles run for the dispersal points and the people for the bunkers; they come back out after
//  • the scramble, when the player's close enough to see it: the horn, the pilots running out of the alert crews'
//    building to the jets, the doors rolling open, engines, "canopy down", taxi out, line-up and the afterburner
//    takeoff of a pair ten seconds apart — real aircraft all the way, handed to the director once they're climbing
//  • a jet taxiing over from a shelter to re-arm the alert pad after a launch
// Nothing here runs while the field is far from the camera (the logic in bases.js / basestate.js carries on).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { baseToWorld, worldToBase, terrainHeight } from './world.js';
import { Aircraft } from './aircraft.js';
import { steerToward } from './ai.js';
import { makeParkedModel } from './airbase.js';
import { hasVehicle, createVehicle, staticVehicle } from './vehicles.js';
import { hasModel, staticModel } from './airbasemodels.js';
import { raise } from './vehicles.js';
import { clamp, rand, pick } from './util.js';

const NEAR = 6500;           // m: life is drawn and updated within this of the field
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ═════════════ People ═════════════
// Figure (y up, facing −z): legs and arms swing about the hips and shoulders in the vertex shader.
// aPart: 0 clothing (instance colour), 1 skin, 2 headgear (second instance colour); aLimb: 0 body, 1/2 legs, 3/4 arms
function figureGeometry() {
    const parts = [];
    const add = (g, part, limb) => {
        const n = g.attributes.position.count;
        g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1));
        g.setAttribute('aLimb', new THREE.Float32BufferAttribute(new Float32Array(n).fill(limb), 1));
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'aPart', 'aLimb'].includes(k)) g.deleteAttribute(k);
        parts.push(g.index ? g.toNonIndexed() : g);
    };
    const cap = (r, l, x, y, z) => { const g = new THREE.CapsuleGeometry(r, l, 2, 7); g.translate(x, y, z); return g; };
    add(cap(0.085, 0.62, -0.1, 0.47, 0), 0, 1); add(cap(0.085, 0.62, 0.1, 0.47, 0), 0, 2);   // legs
    add(cap(0.075, 0.08, -0.1, 0.07, -0.05), 2, 1); add(cap(0.075, 0.08, 0.1, 0.07, -0.05), 2, 2); // boots (dark: headgear colour)
    add(cap(0.17, 0.38, 0, 1.16, 0), 0, 0);                                                      // torso
    add(cap(0.055, 0.46, -0.235, 1.13, 0), 0, 3); add(cap(0.055, 0.46, 0.235, 1.13, 0), 0, 4);  // arms
    { const g = new THREE.SphereGeometry(0.105, 9, 7); g.translate(0, 1.6, -0.01); add(g, 1, 0); }   // head
    { const g = new THREE.SphereGeometry(0.128, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2); g.translate(0, 1.63, 0); add(g, 2, 0); } // cap / helmet
    const out = mergeGeometries(parts);
    out.computeBoundingSphere();
    return out;
}
function figureMaterial(uTime) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
    m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = uTime;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', `#include <common>
                uniform float uTime;
                attribute float aPart, aLimb;
                attribute vec4 aAnim;   // phase, cycles/s, stride (0 still … 1 running), work (arms busy)
                attribute vec3 aCol, aCol2;
                varying vec3 vFigCol;
                mat3 figRot(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }`)
            .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
                float ph = (uTime * aAnim.y + aAnim.x) * 6.2832;
                float sw = sin(ph) * (0.25 + 0.55 * aAnim.z) * step(0.01, aAnim.y);
                float ang = 0.0; float pivot = 0.0;
                if (aLimb > 0.5 && aLimb < 2.5) { ang = aLimb < 1.5 ? sw : -sw; pivot = 0.9; }
                else if (aLimb > 2.5) {
                    ang = (aLimb < 3.5 ? -sw : sw) * 0.8;
                    // at work: both arms forward and busy
                    if (aAnim.w > 0.5) ang = -0.9 - 0.45 * sin(uTime * 5.0 + aAnim.x * 6.0 + aLimb);
                    pivot = 1.42;
                }
                mat3 R = figRot(ang);
                objectNormal = R * objectNormal;`)
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                transformed.y -= pivot; transformed = R * transformed; transformed.y += pivot;
                transformed.y += abs(sin(ph)) * 0.05 * aAnim.z;
                vFigCol = aPart < 0.5 ? aCol : aPart < 1.5 ? vec3(0.62, 0.45, 0.34) : aCol2;`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vFigCol;')
            .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFigCol;');
    };
    m.customProgramCacheKey = () => 'basefigure';
    return m;
}
// clothing schemes: coverall / headgear
const LOOK = {
    crew_blue: [[0.12, 0.14, 0.2], [0.08, 0.08, 0.08]],          // dark coveralls, black cap
    vest_blue: [[0.85, 0.72, 0.12], [0.08, 0.08, 0.08]],         // reflective vest over them
    pilot_blue: [[0.24, 0.27, 0.18], [0.85, 0.86, 0.85]],        // olive flight suit, white helmet
    crew_red: [[0.16, 0.2, 0.28], [0.12, 0.14, 0.12]],           // blue-grey technicians' overalls
    pilot_red: [[0.22, 0.24, 0.2], [0.7, 0.72, 0.7]],
    engineer: [[0.35, 0.33, 0.24], [0.9, 0.72, 0.12]],           // repair teams: fatigues, hard hats
    guard_blue: [[0.33, 0.3, 0.22], [0.25, 0.26, 0.2]], guard_red: [[0.3, 0.33, 0.24], [0.22, 0.26, 0.18]],
};

class Crowd {
    constructor(scene, n = 96) {
        this.uTime = { value: 0 };
        const geo = figureGeometry();
        this.aAnim = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
        this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        this.aCol2 = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        geo.setAttribute('aAnim', this.aAnim); geo.setAttribute('aCol', this.aCol); geo.setAttribute('aCol2', this.aCol2);
        this.mesh = new THREE.InstancedMesh(geo, figureMaterial(this.uTime), n);
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        this.mesh.castShadow = true; this.mesh.receiveShadow = true;
        scene.add(this.mesh);
        this.people = [];
        this.max = n;
    }
    add(o) {
        if (this.people.length >= this.max) return null;
        const p = { x: 0, z: 0, y: 0, yaw: 0, speed: 0, mode: 'idle', path: null, look: 'crew_blue', work: false, hidden: false, phase: Math.random(), ...o };
        this.people.push(p);
        return p;
    }
    remove(p) { const i = this.people.indexOf(p); if (i >= 0) this.people.splice(i, 1); }
    clear() { this.people.length = 0; this.mesh.count = 0; }
    // walk / run each along its path; write the instances
    update(dt, t) {
        this.uTime.value = t;
        let n = 0;
        const im = this.mesh;
        for (const p of this.people) {
            if (p.path && p.path.length) {
                const tg = p.path[0], dx = tg.x - p.x, dz = tg.z - p.z, d = Math.hypot(dx, dz);
                const step = p.speed * dt;
                if (d <= step + 0.05) { p.x = tg.x; p.z = tg.z; p.path.shift(); if (!p.path.length && p.onArrive) { const f = p.onArrive; p.onArrive = null; f(p); } }
                else { p.x += dx / d * step; p.z += dz / d * step; p.yaw = Math.atan2(-dx, -dz); }
            }
            if (p.hidden) continue;
            const moving = p.path && p.path.length && p.speed > 0.1;
            _q.setFromAxisAngle(UP, p.yaw);
            im.setMatrixAt(n, _m.compose(_v.set(p.x, p.y, p.z), _q, _s.set(1, 1, 1)));
            const run = moving ? clamp((p.speed - 1.4) / 3.5, 0, 1) : 0;
            this.aAnim.setXYZW(n, p.phase, moving ? 0.9 + p.speed * 0.26 : 0, run, p.work && !moving ? 1 : 0);
            const L = LOOK[p.look] || LOOK.crew_blue;
            this.aCol.setXYZ(n, L[0][0], L[0][1], L[0][2]); this.aCol2.setXYZ(n, L[1][0], L[1][1], L[1][2]);
            if (++n >= this.max) break;
        }
        im.count = n;
        if (n) { im.instanceMatrix.needsUpdate = true; this.aAnim.needsUpdate = true; this.aCol.needsUpdate = true; this.aCol2.needsUpdate = true; }
    }
}

// ═════════════ Vehicles ═════════════
// A static copy of a model (vehicles.js or airbasemodels.js), or a box when neither has loaded yet
const VCACHE = new Map();
function vehicleObject(id, { paint = null, key = '', posed = null } = {}) {
    try {
        if (hasModel(id)) { const o = staticModel(id, { paint, key, pose: posed }); if (o) return o; }
        if (hasVehicle(id)) {
            const k = id + ':' + (paint || '') + ':' + key;
            if (!VCACHE.has(k)) {
                const made = createVehicle(id, paint ? { paint } : {});
                if (posed) posed(made.rig);
                VCACHE.set(k, staticVehicle(made.object));
            }
            return VCACHE.get(k).clone();
        }
    } catch (e) { /* fall through */ }
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.4, 7), new THREE.MeshStandardMaterial({ color: 0x5b6443, roughness: 0.8 }));
    m.position.y = 1.2; m.castShadow = true;
    g.add(m);
    return g;
}

// a vehicle driving waypoints (world x/z), turning at a limited rate, slowing for corners and at the end
class Mover {
    constructor(scene, object, { x, z, yaw = 0, y = 0 }) {
        this.object = object; this.scene = scene;
        this.pos = new THREE.Vector3(x, y, z);
        this.yaw = yaw; this.speed = 0; this.cruise = 8; this.path = [];
        this.object.position.copy(this.pos);
        this.object.rotation.set(0, yaw, 0);
        scene.add(object);
        this.wait = 0;
    }
    go(points, cruise = 8) { this.path = points.map(p => ({ x: p.x, z: p.z })); this.cruise = cruise; }
    get idle() { return !this.path.length && this.wait <= 0; }
    update(dt, y) {
        if (this.wait > 0) { this.wait -= dt; this.speed = 0; }
        else if (this.path.length) {
            const tg = this.path[0], dx = tg.x - this.pos.x, dz = tg.z - this.pos.z, d = Math.hypot(dx, dz);
            const want = Math.atan2(-dx, -dz);
            const err = wrap(want - this.yaw);
            this.yaw += clamp(err, -0.6 * dt, 0.6 * dt) * (this.speed > 0.5 ? 1 : 0.4) + (this.speed <= 0.5 ? clamp(err, -0.25 * dt, 0.25 * dt) : 0);
            const last = this.path.length === 1;
            const target = Math.abs(err) > 0.9 ? 2.5 : last ? Math.min(this.cruise, d * 0.35 + 0.5) : this.cruise;
            this.speed += clamp(target - this.speed, -4 * dt, 2 * dt);
            const step = this.speed * dt * (Math.abs(err) > 1.6 ? 0.3 : 1);
            this.pos.x -= Math.sin(this.yaw) * step; this.pos.z -= Math.cos(this.yaw) * step;
            if (d < 4 || (last && d < 1.5)) { this.path.shift(); if (!this.path.length) { this.speed = 0; if (this.onArrive) { const f = this.onArrive; this.onArrive = null; f(this); } } }
        }
        this.pos.y = y;
        this.object.position.copy(this.pos);
        this.object.rotation.y = this.yaw;
    }
    setObject(o) { this.scene.remove(this.object); this.object = o; this.scene.add(o); o.position.copy(this.pos); o.rotation.y = this.yaw; }
    remove() { this.scene.remove(this.object); }
}

// a repair-team vehicle as a ground target: the enemy's attack aircraft (and the player) can kill it
class CrewVehicle {
    constructor(life, kind, name) {
        this.life = life; this.kind = kind; this.type = 'truck'; this.cls = 'vehicle';
        this.team = life.F.team; this.name = name;
        this.alive = true; this.isGround = true;
        this.hp = this.maxHp = kind === 'loader' ? 110 : 80; this.health = this.hp; this.maxHealth = this.hp;
        this.radius = this.hitRadius = 5;
        this.pos = new THREE.Vector3(); this.center = this.pos; this.vel = new THREE.Vector3(); this.incoming = [];
        this.def = { name, score: 150, boom: 1.1 };
        this.mesh = new THREE.Object3D();
        this.mover = null;
        this.noHud = true; // (ours: no HUD box — the enemy's still get theirs)
    }
    hitTest(p) { return Math.abs(p.x - this.pos.x) < 3.5 && Math.abs(p.z - this.pos.z) < 3.5 && p.y > this.pos.y - 2 && p.y < this.pos.y + 2.5; }
    distTo(p) { return Math.max(0, this.pos.distanceTo(p) - 3); }
    damage(amount, source) {
        if (!this.alive || !(amount > 0)) return;
        this.hp -= amount; this.health = this.hp;
        if (this.hp <= 0) this.destroy(source);
    }
    destroy(source) {
        if (!this.alive) return;
        this.alive = false; this.hp = this.health = 0;
        const g = this.life.game, fx = g.effects;
        fx.explosion(this.pos, 1.1); fx.debrisBurst(this.pos, _v.set(0, 20, 0), 5, 0.8);
        fx.smokeColumn(_v.copy(this.pos).setY(this.pos.y - 1), 0.6, 60);
        if (this.mover) this.mover.object.traverse(o => { if (o.isMesh) o.material = CHAR; });
        this.life.crewLoss(this);
        g.events.emit('groundKilled', this, { source });
    }
    update() { }
    remove() { this.removed = true; }
}
const CHAR = new THREE.MeshStandardMaterial({ color: 0x1c1b19, roughness: 1 });

// ═════════════ A field's life ═════════════
export class FieldLife {
    constructor(sys, F) {
        this.sys = sys; this.F = F; this.game = sys.game;
        this.b = F.base; this.L = F.L;
        this.scene = this.game.scene;
        this.crowd = new Crowd(this.scene);
        this.crowd.mesh.visible = false;
        this.t = 0;
        this.near = false;
        this.movers = [];        // ambient vehicles { m: Mover, role, ... }
        this.crewVis = new Map(); // logic crew → { loader, truck, people: [], targets }
        this.ambientBuilt = false;
        this.taxiing = [];       // scripted jets taxiing (QRA re-arming)
    }

    // world position of base-local (lx, lz) on the ground
    w(lx, lz, out = new THREE.Vector3()) { const p = baseToWorld(this.b, lx, lz); return out.set(p.x, this.b.h, p.z); }
    ground(x, z) { const g = Math.max(terrainHeight(x, z), 0); return Math.abs(g - this.b.h) < 3 ? this.b.h : g; }

    reset() {
        this.clear();
        this.t = 0;
    }
    clear() {
        for (const v of this.movers) v.m.remove();
        this.movers.length = 0;
        for (const c of this.crewVis.values()) { c.loader.remove(); c.truck.remove(); }
        this.crewVis.clear();
        for (const j of this.taxiing) this.scene.remove(j.mesh);
        this.taxiing.length = 0;
        this.crowd.clear();
        this.ambientBuilt = false;
        this.bunkered = false;
    }

    // ── per frame ──
    update(dt, cam) {
        this.t += dt;
        const near = !!cam && Math.hypot(cam.x - this.b.x, cam.z - this.b.z) < NEAR + this.b.r;
        this.near = near;
        this.crowd.mesh.visible = near;
        this.updateCrews(dt, near);
        if (!near) { for (const v of this.movers) v.m.object.visible = false; return; }
        if (!this.ambientBuilt) this.buildAmbient();
        const alert = this.F.fsm.state === 1 || this.F.fsm.state === 2;
        if (alert !== this.bunkered) { this.bunkered = alert; this.takeCover(alert); }
        for (const v of this.movers) { v.m.object.visible = true; this.ambientStep(v, dt); v.m.update(dt, this.ground(v.m.pos.x, v.m.pos.z)); }
        for (let i = this.taxiing.length - 1; i >= 0; i--) if (this.taxiJet(this.taxiing[i], dt)) this.taxiing.splice(i, 1);
        this.crowd.update(dt, this.t);
    }

    // ── ambient: crews on the apron and by the shelters, a fuel truck, a tug, the follow-me car, a patrol ──
    buildAmbient() {
        this.ambientBuilt = true;
        const F = this.F, L = this.L, red = F.team === 'red';
        const crew = red ? 'crew_red' : 'crew_blue';
        // around the jets on the apron stands: a couple of mechanics each, one of them busy
        for (const s of L.stands || []) {
            for (let k = 0; k < 2; k++) {
                const p = this.w(s.lx - 6 + k * 9, s.lz + (k ? 4 : -5));
                this.crowd.add({ x: p.x, z: p.z, y: this.b.h, yaw: rand(0, 6.28), look: k ? crew : (red ? crew : 'vest_blue'), work: k === 0, home: p.clone(), wander: 6 });
            }
        }
        // at the alert shelters: the crew chiefs; by the QRA building, the alert pilots
        for (const s of (L.shelters || []).filter(x => x.alert)) {
            const p = this.w(s.lx + 10, s.lz - 24);
            this.crowd.add({ x: p.x, z: p.z, y: this.b.h, yaw: 0, look: crew, qraChief: s.id });
        }
        if (L.qraHut) for (let k = 0; k < 2; k++) {
            const p = this.w(L.qraHut.lx - 4 + k * 8, L.qraHut.lz - 10);
            this.crowd.add({ x: p.x, z: p.z, y: this.b.h, yaw: rand(0, 6.28), look: red ? 'pilot_red' : 'pilot_blue', qraPilot: k });
        }
        // a few more walking between the tower, the shelters and the apron
        const spots = [L.tower, ...(L.stands || []).slice(0, 2), ...(L.shelters || []).slice(2, 5)].filter(Boolean);
        for (let k = 0; k < 5 && spots.length > 1; k++) {
            const a = pick(spots), p = this.w(a.lx + rand(-20, 20), a.lz + rand(-20, 20));
            this.crowd.add({ x: p.x, z: p.z, y: this.b.h, look: k % 2 ? crew : (red ? 'guard_red' : 'guard_blue'), walker: true, spots });
        }
        // vehicles: a fuel truck doing its rounds, a tug, the follow-me car (ours), a patrol along the fence
        const fuel = red ? 'fuel_red' : 'fuel_blue', cargo = red ? 'ammo_red' : 'hemtt';
        const start = L.depot || { lx: 400, lz: -200 };
        const mk = (id, dx, role, o = {}) => {
            const p = this.w(start.lx + dx, start.lz);
            const m = new Mover(this.scene, vehicleObject(id, o), { x: p.x, z: p.z, yaw: -this.b.heading, y: this.b.h });
            this.movers.push({ m, role, id, t: rand(0, 20) });
        };
        mk(fuel, -30, 'fuel');
        if (!red) { mk('tug', -48, 'tug'); mk('followme', -60, 'followme'); } else mk(cargo, -48, 'cargo');
        mk(red ? 'ammo_red' : 'cmd_blue', -70, 'patrol');
    }

    // where an ambient vehicle goes next
    ambientStep(v, dt) {
        const m = v.m, L = this.L;
        if (this.bunkered) return;
        if (!m.idle) return;
        v.t -= dt;
        if (v.t > 0) return;
        const F = this.F, pts = [];
        const at = (lx, lz) => { const p = this.w(lx, lz); return { x: p.x, z: p.z }; };
        const stands = L.stands || [], sh = (L.shelters || []).filter(s => !s.alert);
        switch (v.role) {
            case 'fuel': case 'cargo': {
                // out to a stand or a shelter, a stop there, then the next
                const go = Math.random() < 0.5 && stands.length ? pick(stands) : sh.length ? pick(sh) : null;
                if (!go) break;
                const front = go.face ? { lx: go.lx + 16, lz: go.lz + go.face * 32 } : { lx: go.lx - 18, lz: go.lz + 8 };
                pts.push(at(front.lx, front.lz));
                v.t = rand(25, 45);
                break;
            }
            case 'tug': { const go = pick([...stands, ...sh]); if (go) { pts.push(at(go.lx - 20, go.lz + (go.face || 1) * 26)); v.t = rand(30, 60); } break; }
            case 'followme': {
                // waits at the first runway exit, then back to the apron
                v.flip = !v.flip;
                pts.push(v.flip ? at(165, 20) : at(200, 60)); v.t = rand(40, 80);
                break;
            }
            case 'patrol': {
                const f = F.fence, k = v.leg = ((v.leg || 0) + 1) % 4;
                const c = [[f.x1 - 25, f.z0 + 25], [f.x1 - 25, f.z1 - 25], [f.x0 + 25, f.z1 - 25], [f.x0 + 25, f.z0 + 25]][k];
                pts.push(at(c[0], c[1])); v.t = rand(2, 6);
                break;
            }
        }
        if (pts.length) m.go(pts, v.role === 'patrol' ? 9 : 7);
        // the crowd: walkers pick a new spot now and then; idle mechanics shuffle about their jet
        for (const p of this.crowd.people) {
            if (p.hidden || (p.path && p.path.length) || p.busy) continue;
            if (p.walker && Math.random() < 0.3) { const a = pick(p.spots); const q = this.w(a.lx + rand(-25, 25), a.lz + rand(-25, 25)); p.path = [{ x: q.x, z: q.z }]; p.speed = 1.4; }
            else if (p.home && Math.random() < 0.25) { p.path = [{ x: p.home.x + rand(-p.wander, p.wander), z: p.home.z + rand(-p.wander, p.wander) }]; p.speed = 1.2; }
        }
    }

    // alert: everyone for the bunkers, vehicles to the dispersal points (and back out after)
    takeCover(on) {
        const L = this.L, bunkers = L.bunkers || [], disp = L.dispersal || [];
        for (const p of this.crowd.people) {
            if (p.busy) continue;
            if (on && bunkers.length) {
                let best = null, bd = Infinity;
                for (const b of bunkers) { const q = this.w(b.lx, b.lz - 5); const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < bd) { bd = d; best = q; } }
                p.from = { x: p.x, z: p.z };
                p.path = [{ x: best.x, z: best.z }]; p.speed = rand(3.8, 5.2);
                p.onArrive = (pp) => { pp.hidden = true; };
            } else if (!on && p.hidden) {
                p.hidden = false;
                if (p.from) { p.path = [{ x: p.from.x, z: p.from.z }]; p.speed = 1.4; }
            }
        }
        if (on) for (const v of this.movers) {
            if (!disp.length) break;
            let best = null, bd = Infinity;
            for (const d of disp) { const q = this.w(d.lx, d.lz); const dd = Math.hypot(q.x - v.m.pos.x, q.z - v.m.pos.z); if (dd < bd) { bd = dd; best = q; } }
            v.m.go([{ x: best.x + rand(-15, 15), z: best.z + rand(-15, 15) }], 13);
            v.t = 1e9;
        } else for (const v of this.movers) v.t = rand(5, 20);
    }

    // ── repair teams: a loader and a dump truck per logic crew, and four engineers when they're at work ──
    updateCrews(dt, near) {
        const F = this.F, sys = this.sys;
        for (const c of F.crews.crews) {
            let vis = this.crewVis.get(c);
            if (!vis && c.alive) vis = this.makeCrew(c);
            if (!vis) continue;
            if (!c.alive) continue;
            // the loader leads, the truck follows a little behind, both from the logic's position
            const p = this.w(c.lx, c.lz);
            const hx = -Math.sin(c.heading), hz = -Math.cos(c.heading);
            const working = c.state === 'working';
            if (vis.loader.alive) vis.loader.pos.set(p.x + hx * 4, this.b.h + 1.2, p.z + hz * 4);
            if (vis.truck.alive) vis.truck.pos.set(p.x - hx * 12 + hz * (working ? 6 : 0), this.b.h + 1.2, p.z - hz * 12 - hx * (working ? 6 : 0));
            for (const u of [vis.loader, vis.truck]) { if (!u.alive) continue; u.vel.set(hx, 0, hz).multiplyScalar(c.state === 'driving' ? 8 : 0); }
            if (!near) { if (vis.mL) { vis.mL.object.visible = false; vis.mT.object.visible = false; } continue; }
            this.showCrew(c, vis, dt, working);
        }
        void sys;
    }
    makeCrew(c) {
        const F = this.F, red = F.team === 'red';
        const loader = new CrewVehicle(this, 'loader', (red ? 'ENEMY ' : '') + 'RUNWAY REPAIR LOADER');
        const truck = new CrewVehicle(this, 'dumptruck', (red ? 'ENEMY ' : '') + 'REPAIR DUMP TRUCK');
        const vis = { crew: c, loader, truck, people: [], mL: null, mT: null, stage: null };
        loader.crew = truck.crew = c;
        this.crewVis.set(c, vis);
        // as ground targets in the war modes (the enemy's CAS goes for them; the player can too)
        const g = this.game;
        if (this.sys.enabled && g.ground && g.ground.targets) {
            for (const u of [loader, truck]) { g.ground.targets.push(u); if (g.war) g.war.add(u, { cls: 'vehicle', name: u.name, conceal: 0.1 }); }
        }
        return vis;
    }
    showCrew(c, vis, dt, working) {
        const F = this.F, red = F.team === 'red', paint = red ? 'red_green' : null;
        const stage = c.target ? c.target.stage : null;
        const key = (working && stage === 'filling' ? 'up' : 'down');
        if (!vis.mL) {
            vis.mL = new Mover(this.scene, vehicleObject('loader', { paint }), { x: vis.loader.pos.x, z: vis.loader.pos.z, y: this.b.h });
            vis.mT = new Mover(this.scene, vehicleObject('dumptruck', { paint }), { x: vis.truck.pos.x, z: vis.truck.pos.z, y: this.b.h });
            vis.loader.mover = vis.mL; vis.truck.mover = vis.mT;
        }
        // the truck's bed up while it tips the fill in; the loader's bucket raised while it works
        if (vis.key !== key && vis.truck.alive && vis.loader.alive) {
            vis.key = key;
            vis.mT.setObject(vehicleObject('dumptruck', { paint, key, posed: key === 'up' ? (rig) => raise(rig, 1) : null }));
            vis.mL.setObject(vehicleObject('loader', { paint, key: working ? 'up' : 'down', posed: working ? (rig) => raise(rig, 0.6) : null }));
        }
        for (const [u, m] of [[vis.loader, vis.mL], [vis.truck, vis.mT]]) {
            m.object.visible = true;
            if (!u.alive) continue;
            const d = Math.hypot(u.pos.x - m.pos.x, u.pos.z - m.pos.z);
            if (d > 0.3) { m.yaw += clamp(wrap(Math.atan2(-(u.pos.x - m.pos.x), -(u.pos.z - m.pos.z)) - m.yaw), -1.2 * dt, 1.2 * dt); }
            m.pos.x += (u.pos.x - m.pos.x) * Math.min(1, dt * 3); m.pos.z += (u.pos.z - m.pos.z) * Math.min(1, dt * 3);
            m.pos.y = this.b.h;
            m.object.position.copy(m.pos); m.object.rotation.y = m.yaw;
        }
        // engineers on foot round the crater while they work
        if (working && !vis.people.length && c.target) {
            for (let k = 0; k < 4; k++) {
                const a = k / 4 * Math.PI * 2, r = c.target.r * 1.35 + 2, q = this.w(c.target.lx + Math.cos(a) * r, c.target.lz + Math.sin(a) * r);
                vis.people.push(this.crowd.add({ x: q.x, z: q.z, y: this.b.h, yaw: a + Math.PI / 2, look: 'engineer', work: true, busy: true }));
            }
        } else if (!working && vis.people.length) { for (const p of vis.people) if (p) this.crowd.remove(p); vis.people.length = 0; }
    }
    // a repair vehicle destroyed: when both of a team's are gone, the team is
    crewLoss(u) {
        const vis = this.crewVis.get(u.crew);
        if (!vis) return;
        if (!vis.loader.alive && !vis.truck.alive) {
            u.crew.alive = false;
            if (u.crew.target) { u.crew.target.crew = null; u.crew.target = null; }
            for (const p of vis.people) if (p) this.crowd.remove(p);
            vis.people.length = 0;
            const friendly = this.F.team === this.game.war.side;
            this.sys.say(friendly ? 'COMMAND' : 'INTEL', friendly ? this.F.name + ': A RUNWAY REPAIR TEAM HAS BEEN WIPED OUT' : 'AN ENEMY RUNWAY REPAIR TEAM IS DOWN', { color: friendly ? '#ff4a3d' : '#5dffa0', say: false });
        }
    }
    // the enemy repair vehicles still working (for tasks)
    crewTargets() {
        const out = [];
        for (const v of this.crewVis.values()) for (const u of [v.loader, v.truck]) if (u.alive && v.crew.alive) out.push(u);
        return out;
    }

    // ═════════════ The scramble ═════════════
    startScramble(sc) {
        const F = this.F, S = F.structures, g = this.game;
        sc.jetsLive = [];
        sc.people = [];
        const red = F.team === 'red';
        // the horn by the alert pad (or the first jet's shelter), doors rolling open
        const s0 = sc.jets[0] && sc.jets[0].from ? this.L.shelters.find(s => s.id === sc.jets[0].from.id) : null;
        const hut = this.L.qraHut ? this.w(this.L.qraHut.lx, this.L.qraHut.lz) : s0 ? this.w(s0.lx, s0.lz) : this.w(0, 0);
        this.sys.sounds.horn(hut, 3);
        sc.jets.forEach((j, k) => {
            const sid = j.from ? j.from.id : null;
            if (S && sid) S.setDoor(sid, 1);
            // the pilots run out of the crew building (or across from the apron) to their jets
            const pose = S && sid ? S.jetPose(sid, new THREE.Vector3()) : null;
            const tgt = pose ? pose.pos.clone() : hut.clone();
            const side = _v.set(-Math.cos(pose ? pose.heading : 0), 0, Math.sin(pose ? pose.heading : 0)).multiplyScalar(3.2);
            const from = this.L.qraHut ? this.w(this.L.qraHut.lx + (k ? 5 : -5), this.L.qraHut.lz - 8) : tgt.clone().add(_v2.set(40, 0, 20));
            const pilot = this.crowd.add({ x: from.x, z: from.z, y: this.b.h, look: red ? 'pilot_red' : 'pilot_blue', busy: true, speed: 5.4 });
            if (pilot) {
                const doorPt = sid ? this.doorPoint(sid) : null;
                pilot.path = [...(doorPt ? [{ x: doorPt.x, z: doorPt.z }] : []), { x: tgt.x + side.x, z: tgt.z + side.z }];
                pilot.speed = 5.4;
                pilot.onArrive = (p) => { p.climbT = this.t + 5; };
                sc.people.push(pilot);
            }
            // the crew chief comes to the jet too
            const chief = this.crowd.add({ x: tgt.x + side.x * 2 + 6, z: tgt.z + side.z * 2, y: this.b.h, look: red ? 'crew_red' : 'vest_blue', busy: true, work: true });
            if (chief) sc.people.push(chief);
            j.sid = sid;
        });
        // the alert pilots idling by the building are the ones who ran
        for (const p of this.crowd.people) if (p.qraPilot !== undefined) p.hidden = true;
        sc.stageT = {};
        g.events.emit('scrambleStarted', F, { scramble: sc });
    }
    doorPoint(sid) { const S = this.F.structures, f = S && S.doorFront(sid, 6); return f ? this.w(f.lx, f.lz) : null; }

    // the scramble frame by frame, on its timeline (bases.js scrambleTimeline)
    scrambleUpdate(sc, dt) {
        const F = this.F, S = F.structures, T = sc.T, t = sc.t, g = this.game;
        const friendly = F.team === g.war.side;
        // pilots climb in
        for (const p of sc.people) if (p && p.climbT && this.t > p.climbT && !p.hidden) p.hidden = true;
        // engines: the real aircraft appear in place of the shelter's parked jet
        if (t >= T.start && !sc.made) {
            sc.made = true;
            sc.jets.forEach((j, k) => {
                const pose = S && j.sid ? S.jetPose(j.sid, new THREE.Vector3()) : null;
                const ac = new Aircraft(g, j.type, { team: F.team, name: friendly ? 'ALERT ' + (k + 1) : null });
                const at = pose ? pose.pos : this.w(this.L.depart ? this.L.depart.lineup[k][0] : 0, this.L.depart ? this.L.depart.lineup[k][1] + 60 : 0);
                ac.spawnRunway(F.base);
                ac.pos.set(at.x, F.base.h + ac.gearOffset, at.z);
                ac.qv.setFromAxisAngle(UP, pose ? pose.heading : -F.base.heading);
                ac.throttle = ac.controls.throttle = 0.12; ac.flaps = 1;
                ac.syncBody();
                ac.airwingJet = j; ac.fromField = F; ac.scramble = sc;
                g.aircraft.push(ac);
                if (S && j.sid) S.jetOut(j.sid, true);
                sc.jetsLive.push({ ac, k, j, route: null, i: 0, speed: 0, heading: pose ? pose.heading : -F.base.heading, phase: 'start', rollT: k ? T.roll2 : T.roll1 });
            });
        }
        if (t >= T.canopy && !sc.stageT.canopy) {
            sc.stageT.canopy = true;
            if (friendly && F.towerUp) this.sys.say('ALERT 1', 'ALERT FLIGHT, CANOPIES DOWN, READY TO TAXI', { color: '#9fd4ff', say: false });
        }
        if (t >= T.taxi && !sc.stageT.taxi) {
            sc.stageT.taxi = true;
            for (const J of sc.jetsLive) J.route = this.taxiRoute(J);
            if (friendly && F.towerUp) this.sys.say(F.towerCall, 'ALERT FLIGHT, SCRAMBLE — TAXI RUNWAY ' + this.runwayName() + ', WIND CALM, CLEARED FOR TAKEOFF WHEN READY', { color: '#9fd4ff', say: false });
        }
        for (const J of sc.jetsLive) this.flyScrambleJet(sc, J, dt);
        // doors shut after them, the chiefs walk off
        if (t > T.roll2 + 15 && !sc.stageT.doors) { sc.stageT.doors = true; for (const j of sc.jets) if (S && j.sid) S.setDoor(j.sid, 0); for (const p of sc.people) if (p) this.crowd.remove(p); for (const p of this.crowd.people) if (p.qraPilot !== undefined) p.hidden = false; }
        // all airborne and climbing: the director has them
        if (sc.jetsLive.length && sc.jetsLive.every(J => J.phase === 'handed' || !J.ac.alive) && !sc.done) {
            const live = sc.jetsLive.filter(J => J.ac.alive).map(J => J.ac);
            if (live.length) this.sys.airborne(sc, live); else sc.done = true;
        }
    }

    runwayName() { const u = this.F.units.runways[0]; return u ? u.name.replace('RUNWAY ', '').split('/')[0] : ''; }

    // taxi route for a scramble jet: out of its shelter onto the graph, to the line-up spot at the departure end
    taxiRoute(J) {
        const F = this.F, G = F.graph, dep = this.L.depart;
        const pts = [];
        const sid = J.j.sid;
        if (G && dep) {
            const start = sid ? sid + '_in' : 'qra_a1';
            const r = G.route(start, dep.entry || dep.node, G.blocker(F.craters));
            if (r) for (const n of G.points(r).slice(1)) pts.push(n);
        }
        // onto the runway and round onto its heading at the line-up spot (number two in echelon right, behind)
        const lu = dep ? dep.lineup[J.k] : [0, 1400];
        pts.push({ lx: lu[0] + 7, lz: lu[1] + 3 }, { lx: lu[0], lz: lu[1] - 5 });
        return pts.map(p => this.w(p.lx, p.lz));
    }

    // one scramble jet: taxi (kinematic), line up, hold, then the takeoff roll under its own power (physics), climb
    flyScrambleJet(sc, J, dt) {
        const ac = J.ac, F = this.F, g = this.game;
        if (!ac.alive || J.phase === 'handed') return;
        const T = sc.T;
        if (J.phase === 'start' || J.phase === 'taxi' || J.phase === 'lineup' || J.phase === 'hold') {
            // (the flight model runs first each frame; on the ground we place it ourselves)
            if (J.phase === 'start' && sc.t >= T.taxi + J.k * 7 && J.route) J.phase = 'taxi';
            if (J.phase === 'taxi') {
                const tg = J.route[J.i];
                if (!tg) { J.phase = 'hold'; J.speed = 0; }
                else {
                    const dx = tg.x - ac.pos.x, dz = tg.z - ac.pos.z, d = Math.hypot(dx, dz);
                    const want = Math.atan2(-dx, -dz), err = wrap(want - J.heading);
                    const lastLeg = J.i >= J.route.length - 1;
                    const tgtSpeed = Math.abs(err) > 0.5 ? 4 : lastLeg ? Math.min(9, d * 0.3 + 1) : 11;
                    // keep a gap behind the other jet
                    const other = sc.jetsLive.find(o => o !== J && o.ac.alive);
                    const block = other && J.k === 1 && other.phase !== 'roll' && other.phase !== 'air' && ac.pos.distanceTo(other.ac.pos) < 26;
                    J.speed += clamp((block ? 0 : tgtSpeed) - J.speed, -4 * dt, 2.5 * dt);
                    J.heading += clamp(err, -0.55 * dt, 0.55 * dt) * clamp(J.speed / 3, 0.2, 1);
                    const step = J.speed * dt;
                    ac.pos.x -= Math.sin(J.heading) * step; ac.pos.z -= Math.cos(J.heading) * step;
                    if (d < Math.max(5, step * 1.5)) J.i++;
                }
            }
            if (J.phase === 'hold') {
                // settle onto the runway heading
                const rh = this.runwayHeading();
                J.heading += clamp(wrap(rh - J.heading), -0.5 * dt, 0.5 * dt);
                J.speed = 0;
                if (sc.t >= J.rollT && Math.abs(wrap(rh - J.heading)) < 0.05) this.beginRoll(J);
            }
            if (J.phase !== 'roll') {
                ac.onGround = true;
                ac.pos.y = F.base.h + ac.gearOffset;
                ac.qv.setFromAxisAngle(UP, J.heading);
                ac.vel.set(-Math.sin(J.heading), 0, -Math.cos(J.heading)).multiplyScalar(J.speed);
                ac.relSpeed = ac.speed = J.speed;
                ac.controls.throttle = ac.throttle = 0.2 + J.speed * 0.02;
                ac.alpha = 0;
                ac.syncBody();
            }
            return;
        }
        // the takeoff roll and climb-out: hold the centreline, rotate, gear up, climb straight ahead
        const c = ac.controls;
        c.throttle = 1;
        if (ac.onGround) {
            // hold the line it lined up on: heading error, and drift across (right of the line = +x: steer left)
            const f = _v.set(0, 0, -1).applyQuaternion(ac.qv);
            const rh = this.runwayHeading(), cur = Math.atan2(-f.x, -f.z);
            const lat = this.lateral(ac.pos, J.lineX);
            c.yaw = clamp(wrap(rh - cur) * 4 + lat * 0.04, -1, 1); c.roll = 0;
            c.pitch = ac.speed > (J.vr || 70) ? 0.85 : 0;
            J.phase = 'roll';
        } else {
            J.phase = 'air';
            J.airT = (J.airT || 0) + dt;
            if (J.airT > 2.5) ac.gear = false;
            if (J.airT > 6) ac.flaps = 0;
            const rh = this.runwayHeading();
            const dir = _v.set(-Math.sin(rh), 0.22, -Math.cos(rh)).normalize();
            steerToward(ac, dir, c, 0.6, true);
            const agl = ac.pos.y - this.ground(ac.pos.x, ac.pos.z);
            if (agl > 160 && J.airT > 5) J.phase = 'handed';
        }
        void g;
    }
    beginRoll(J) {
        const ac = J.ac;
        J.phase = 'roll';
        J.lineX = this.lateral(ac.pos, 0);
        ac.onGround = true; ac.relSpeed = 0; ac.speed = 0; ac.vel.set(0, 0, 0);
        ac.qv.setFromAxisAngle(UP, J.heading);
        ac.controls.throttle = 1; ac.throttle = 0.95;
        ac.flaps = 1;
        const f = ac.spec.flight;
        J.vr = Math.sqrt(9.81 / (ac.liftK * 1.65 * (1 + 0.2 * ac.flaps))) * 1.12;
        void f;
        ac.syncBody();
        if (this.F.team === this.game.war.side && J.k === 0 && this.F.towerUp) this.sys.say('ALERT 1', 'ALERT ONE ROLLING', { color: '#9fd4ff', say: false });
    }
    // the departure heading (world yaw of the aircraft's nose) and a point's offset across the runway
    runwayHeading() { const dir = this.L.depart ? this.L.depart.heading : -1; return (dir < 0 ? 0 : Math.PI) - this.b.heading; }
    lateral(p, x0 = 0) { const q = worldToBase(this.b, p.x, p.z); return q.lx - x0; }

    // called off (the runway cut under them): jets that haven't rolled shut down where they are and are towed back
    abortScramble(sc) {
        const F = this.F, S = F.structures, g = this.game;
        for (const J of sc.jetsLive || []) {
            if (J.phase === 'roll' || J.phase === 'air' || J.phase === 'handed') continue;
            const i = g.aircraft.indexOf(J.ac);
            if (i >= 0) g.aircraft.splice(i, 1);
            J.ac.remove();
            if (S && J.j.sid) S.jetOut(J.j.sid, false);
        }
        for (const p of sc.people || []) if (p) this.crowd.remove(p);
        for (const j of sc.jets) if (S && j.sid) S.setDoor(j.sid, 0);
        for (const p of this.crowd.people) if (p.qraPilot !== undefined) p.hidden = false;
    }

    // ═════════════ A jet taxiing over to take the alert ═════════════
    qraMoves(moves) {
        const F = this.F, S = F.structures;
        for (const mv of moves) {
            if (!this.near || !S || !F.graph || !mv.from) { if (S) S.syncJets(); continue; }
            const r = F.graph.route(mv.from.id + '_in', mv.to.id + '_in', F.graph.blocker(F.craters));
            if (!r) { S.syncJets(); continue; }
            // the jet shows in neither shelter while it taxis
            S.jetOut(mv.to.id, true);
            S.setDoor(mv.from.id, 1); S.setDoor(mv.to.id, 1);
            const mesh = makeParkedModel(mv.jet.type);
            const pose = S.jetPose(mv.from.id, new THREE.Vector3());
            mesh.position.copy(pose.pos);
            this.scene.add(mesh);
            this.taxiing.push({ mesh, route: F.graph.points(r).slice(1).map(p => this.w(p.lx, p.lz)), i: 0, heading: pose.heading, speed: 0, mv, wait: 12 });
        }
    }
    taxiJet(J, dt) {
        const S = this.F.structures;
        if (J.wait > 0) { J.wait -= dt; this.placeJet(J); return false; }
        const tg = J.route[J.i];
        if (!tg) {
            this.scene.remove(J.mesh);
            if (S) { S.jetOut(J.mv.to.id, false); S.setDoor(J.mv.from.id, 0); S.setDoor(J.mv.to.id, 0); }
            return true;
        }
        const dx = tg.x - J.mesh.position.x, dz = tg.z - J.mesh.position.z, d = Math.hypot(dx, dz);
        const err = wrap(Math.atan2(-dx, -dz) - J.heading);
        J.speed += clamp((Math.abs(err) > 0.5 ? 3 : J.i === J.route.length - 1 ? Math.min(6, d * 0.3 + 0.8) : 8) - J.speed, -3 * dt, 2 * dt);
        J.heading += clamp(err, -0.5 * dt, 0.5 * dt) * clamp(J.speed / 3, 0.2, 1);
        J.mesh.position.x -= Math.sin(J.heading) * J.speed * dt; J.mesh.position.z -= Math.cos(J.heading) * J.speed * dt;
        if (d < 4) J.i++;
        this.placeJet(J);
        return false;
    }
    placeJet(J) { J.mesh.position.y = this.b.h + 0.05; J.mesh.rotation.set(0, J.heading, 0); }
}
void _e; void _q; void mergeGeometries;

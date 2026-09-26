// ═══════════════════════════════════════════════════════════════
// Traffic: instanced cars, buses and lorries on roads and town streets, dune
// buggies on the dirt trails.
//   • a road network: at a junction a car goes straight on or turns into
//     another arm (following a curve through the junction box); where a road
//     leaves a town street it carries on from one to the other
//   • keep right, keep a gap to the car ahead; stop at red lights (go on green)
//     and stop signs (then wait for the box to clear); give way where a
//     street meets a main road
//   • a wreck blocks its lane: the cars behind stop, then pull round it when
//     the other lane is clear
//   • slow for broken bridges and turn back; wrecked by nearby explosions
//     (a bridge collapsing under them sends them into the water)
//   • at night: head and tail lights, and a pool of headlight on the road
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { samplePath, LANE, liftWithDistance } from './roads.js';
import { rand, makeRadialTexture } from './util.js';
import { propParts } from './props.js';
import { CarSet, PAINTS, PAINTS_BUS, mergeVehicleParts, vehicleMaterial } from './carset.js';
import { craterAdj } from './craters.js';

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const GAP = 3.5;     // metres kept to the vehicle ahead when stopped
const POOLS = 90;    // headlight pools drawn (the nearest cars)

const laneOf = (p) => p.turn ? 0 : p.street ? 2.4 : p.dirt ? 1.4 : LANE;

export class Traffic {
    constructor(scene, paths, dirtPaths = [], towns = null) {
        this.towns = towns;
        this.paths = paths.filter(p => p.len > 30);
        this.dirtPaths = dirtPaths;
        this.roadLen = this.paths.reduce((a, p) => a + p.len, 0);
        this.count = Math.min(620, Math.floor(this.roadLen / 230));
        this.buildNetwork();
        // real car models (instanced per type), plus buses and lorries
        this.carSet = new CarSet(scene, this.count, Math.random, { onRoad: true, big: true });
        // dune buggies: the model's parts, instanced
        this.buggyCount = Math.min(60, dirtPaths.length * 3);
        this.buggyParts = [];
        const parts = this.buggyCount ? propParts('buggy') : null;
        const merged = parts && mergeVehicleParts(parts); // one draw call for every buggy (see carset.js)
        const drawn = merged ? [{ geometry: merged, material: vehicleMaterial(true) }] : (parts || []).map(pt => ({ geometry: pt.geometry, material: liftWithDistance(pt.material.clone()) }));
        const white = new THREE.Color(1, 1, 1);
        for (const d of drawn) {
            const im = new THREE.InstancedMesh(d.geometry, d.material, this.buggyCount);
            im.frustumCulled = false; im.castShadow = true;
            if (merged) for (let k = 0; k < this.buggyCount; k++) im.setColorAt(k, white); // same shader variant as the cars
            scene.add(im);
            this.buggyParts.push(im);
        }
        if (!this.buggyParts.length) this.buggyCount = 0;
        // lights: 4 points per vehicle (two head, two tail)
        const lp = new Float32Array(this.count * 12), lc = new Float32Array(this.count * 12);
        for (let i = 0; i < this.count; i++) { lc.set([1.7, 1.6, 1.3, 1.7, 1.6, 1.3, 1.5, 0.08, 0.04, 1.5, 0.08, 0.04], i * 12); for (let k = 0; k < 4; k++) lp[i * 12 + k * 3 + 1] = -999; } // hidden until placed
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
        lg.setAttribute('color', new THREE.BufferAttribute(lc, 3));
        this.lights = new THREE.Points(lg, liftWithDistance(new THREE.PointsMaterial({
            map: makeRadialTexture(32, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']]),
            vertexColors: true, size: 3.2, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
        })));
        this.lights.frustumCulled = false;
        this.lights.visible = false;
        scene.add(this.lights);
        // the headlight beams on the road ahead of the nearest cars (night only)
        const pool = new THREE.PlaneGeometry(5, 12); pool.rotateX(-Math.PI / 2); pool.translate(0, 0.12, -9);
        const beamTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 128, 4, 32, 110, 120); g.addColorStop(0, 'rgba(255,240,200,0.9)'); g.addColorStop(0.5, 'rgba(255,230,180,0.25)'); g.addColorStop(1, 'rgba(255,220,160,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
        this.pools = new THREE.InstancedMesh(pool, liftWithDistance(new THREE.MeshBasicMaterial({ map: beamTex, color: 0xb0a080, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, polygonOffset: true, polygonOffsetFactor: -6 })), POOLS);
        this.pools.count = 0; this.pools.visible = false; this.pools.frustumCulled = false;
        scene.add(this.pools);
        this.night = false;
        this.cars = [];
        for (let i = 0; i < this.count; i++) {
            const type = this.carSet.slots[i].type;
            this.cars.push({ i, len: type.len || 4.6, big: !!type.big, bus: type.id === 'bus' });
        }
        this.buggies = [];
        for (let i = 0; i < this.buggyCount; i++) this.buggies.push({ i, buggy: true, len: 3.4 });
        this.reset();
    }

    // Junctions along every path (sorted by s) and the joins between a road and the street it leaves from
    buildNetwork() {
        const drivable = new Set(this.paths);
        for (const p of this.paths) { p.nodes = []; p.links = [null, null]; }
        for (const J of this.towns ? this.towns.junctions || [] : []) {
            const arms = J.arms.filter(a => drivable.has(a.path)); // every way out of the junction
            for (const a of arms) if (!a.path.nodes.some(q => q.J === J)) a.path.nodes.push({ s: a.s, J, arms });
        }
        for (const p of this.paths) p.nodes.sort((a, b) => a.s - b.s);
        for (const p of this.paths) for (const [port, end] of [[p.startPort, 0], [p.endPort, 1]]) {
            if (!port || !port.path || !drivable.has(port.path)) continue;
            p.links[end] = { path: port.path, end: port.end };
            port.path.links[port.end] = { path: p, end };
        }
    }

    setNight(on) {
        this.night = on;
        this.lights.visible = on;
        this.pools.visible = on;
        if (on) this.lights.geometry.attributes.position.needsUpdate = true;
    }

    reset() {
        if (this.towns && this.towns.resetPeople) this.towns.resetPeople();
        for (const c of this.cars) this.place(c);
        // no two cars on top of each other: nudge them apart along their lane
        for (const list of this.lanes()) for (let k = 1; k < list.length; k++) {
            const a = list[k - 1], b = list[k];
            if ((b.s - a.s) * b.dir < (a.len + b.len) / 2 + GAP) this.place(b, true);
        }
        this.buggies.forEach((b, i) => this.placeBuggy(b, i));
        this.update(0, null);
    }

    place(c, again = false) {
        let path = this.paths[0];
        for (let tries = 0; tries < 6; tries++) {
            let r = Math.random() * this.roadLen;
            for (const p of this.paths) { r -= p.len; if (r <= 0) { path = p; break; } }
            if (!(c.big && path.street && Math.random() < 0.7)) break; // lorries mostly on the open road
        }
        c.path = path;
        c.dir = Math.random() < 0.5 ? 1 : -1;
        c.s = rand(Math.min(10, path.len / 3), Math.max(path.len / 3, path.len - 10));
        if (again) c.s = (c.s + rand(20, 60)) % path.len;
        c.truck = c.big;
        c.cruise = (path.street ? rand(10, 14) : rand(16, 27)) * (c.big ? 0.82 : 1);
        c.speed = c.cruise * 0.5;
        c.wait = 0; c.stopDone = null; c.stopT = 0; c.plan = null; c.turn = null; c.passing = null; c.laneOff = laneOf(path); c.blocked = 0;
        c.dead = false; c.fall = 0; c.vy = 0; c.yOff = 0; c.smoke = 0; c.stolen = false; c.hp = c.big ? 60 : 30;
        c.color = c.bus ? PAINTS_BUS[Math.floor(Math.random() * PAINTS_BUS.length)] : PAINTS[Math.floor(Math.random() * PAINTS.length)];
        this.carSet.restore(c.i, c.color);
    }

    placeBuggy(b, i) {
        const path = this.dirtPaths[i % this.dirtPaths.length];
        b.path = path; b.dir = Math.random() < 0.5 ? 1 : -1;
        b.s = rand(5, path.len - 5);
        b.cruise = rand(11, 19); b.speed = b.cruise;
        b.dead = false; b.fall = 0; b.yOff = 0; b.vy = 0; b.smoke = 0; b.bounce = Math.random() * 10; b.hp = 20;
        b.dust = 0; b.laneOff = 1.4;
    }

    // every lane's vehicles, ordered in their direction of travel: each car gets its lane (c._lane) and the
    // oncoming one (c._other). Returns the lanes.
    // (every frame: the per-path lists are kept and refilled, not reallocated)
    lanes() {
        const L = this._lanes || (this._lanes = new Map());
        for (const e of L.values()) { e.fw.length = 0; e.bw.length = 0; }
        for (const c of this.cars) {
            if (c.stolen || !c.path) continue;
            let e = L.get(c.path);
            if (!e) L.set(c.path, e = { fw: [], bw: [] });
            (c.dir > 0 ? e.fw : e.bw).push(c);
        }
        const out = [];
        for (const [p, e] of L) {
            const { fw, bw } = e;
            if (!fw.length && !bw.length) { if (p.turn) L.delete(p); continue; } // a turn's path is used once
            // stable insertion sorts (short lists): the same order as sorting a filtered copy
            for (let i = 1; i < fw.length; i++) { const c = fw[i]; let j = i - 1; while (j >= 0 && fw[j].s > c.s) { fw[j + 1] = fw[j]; j--; } fw[j + 1] = c; }
            for (let i = 1; i < bw.length; i++) { const c = bw[i]; let j = i - 1; while (j >= 0 && bw[j].s < c.s) { bw[j + 1] = bw[j]; j--; } bw[j + 1] = c; }
            for (let i = 0; i < fw.length; i++) { const c = fw[i]; c._lane = fw; c._other = bw; c._k = i; }
            for (let i = 0; i < bw.length; i++) { const c = bw[i]; c._lane = bw; c._other = fw; c._k = i; }
            out.push(fw, bw);
        }
        return out;
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

    // the next junction ahead on the car's path (within `range`), or null
    nextNode(c, range = 90) {
        const nodes = c.path.nodes;
        if (!nodes || !nodes.length) return null;
        let best = null, bd = range;
        for (const n of nodes) {
            const d = (n.s - c.s) * c.dir;
            if (d > -0.5 && d < bd) { bd = d; best = n; }
        }
        return best;
    }

    // speed limit from the junction ahead: lights, stop signs, giving way, and a box that isn't clear
    junctionLimit(c, dt, n) {
        if (!n) return Infinity;
        const J = n.J;
        const approach = n.arms.find(a => a.path === c.path && a.dir === -c.dir); // the arm we're coming in on
        if (!approach) return Infinity;
        const line = n.s - c.dir * (approach.L + 1.2);
        const dist = (line - c.s) * c.dir;
        if (dist < -0.5 || dist > 60) return Infinity;
        const brake = (d) => Math.max(0, (d - 0.5) * 0.45);
        const minor = J.type !== 'priority' || c.path.street || approach.minor;
        if (J.type === 'light') {
            const axis = approach.pc ? approach.pc.axis : 'a';
            const state = this.towns.lightState(J, axis);
            if (state === 'green' || (state === 'amber' && dist < 10)) return (J.busy || 0) > 2 && dist < 3 ? 0 : Infinity;
            return brake(dist);
        }
        if (!minor) return Infinity;
        // stop sign / give way: come to a halt at the line, wait a moment, then go when the box is clear
        if (c.stopDone === J) return Infinity;
        if (dist < 2 && c.speed < 0.4) {
            c.stopT += dt;
            if (c.stopT > 1.1 && !(J.busy > 0)) { c.stopDone = J; c.stopT = 0; J.busy = (J.busy || 0) + 1; }
            return 0;
        }
        return brake(dist);
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

    // a round (or a rammed car) hitting near p: the car there takes the damage, a few rounds wreck it
    hitAt(p, amount, game, r = 2.8) {
        for (const list of [this.cars, this.buggies]) for (const c of list) {
            if (c.dead || !c.pos || c.stolen) continue;
            const rr = c.big ? r + 2.5 : r;
            const dx = c.pos.x - p.x, dz = c.pos.z - p.z, dy = p.y - c.pos.y;
            if (dx * dx + dz * dz > rr * rr || dy < -1 || dy > (c.big ? 4 : 3)) continue;
            c.hp = (c.hp ?? 30) - amount;
            if (c.hp <= 0) { this.wreck(c, false); if (game) game.effects.explosion(c.pos, c.big ? 0.8 : 0.5); }
            return c;
        }
        return null;
    }

    // Explosion at `at` with radius R wrecks nearby vehicles (and sends the people nearby running)
    blast(at, R, game) {
        const r2 = (R + 4) * (R + 4);
        for (const list of [this.cars, this.buggies]) for (const c of list) {
            if (c.dead || !c.pos) continue;
            if (c.pos.distanceToSquared(at) < r2) {
                this.wreck(c, false);
                if (game) game.effects.explosion(c.pos, 0.5);
            }
        }
        if (this.towns && this.towns.panic) this.towns.panic(at, R);
    }

    // decide at the next junction: straight on (if the path goes on) or into another arm
    plan(c, n) {
        const options = n.arms.filter(a => !(a.path === c.path && a.dir === -c.dir) && a.L < a.path.len);
        if (!options.length) return null;
        const straight = options.find(a => a.path === c.path && a.dir === c.dir);
        if (straight && Math.random() < 0.62) return straight;
        const turns = options.filter(a => a !== straight && (!c.big || !a.path.street || Math.random() < 0.3));
        return turns.length ? turns[Math.floor(Math.random() * turns.length)] : straight || null;
    }

    // a curve through the junction box from the car's lane on its arm to its lane on the exit arm
    turnPath(c, n, exit) {
        const J = n.J, inArm = n.arms.find(a => a.path === c.path && a.dir === -c.dir);
        const lane0 = laneOf(c.path), lane1 = laneOf(exit.path);
        // entry: on our arm at its mouth, in our lane (right of travel toward the centre, i.e. along -arm)
        const e = { x: J.x + inArm.dx * inArm.L, z: J.z + inArm.dz * inArm.L }, ex = { x: -inArm.dx, z: -inArm.dz };
        e.x += -ex.z * lane0; e.z += ex.x * lane0;
        // exit: at the exit arm's mouth, in the lane for travelling out along it
        const x = { x: J.x + exit.dx * exit.L, z: J.z + exit.dz * exit.L }, xx = { x: exit.dx, z: exit.dz };
        x.x += -xx.z * lane1; x.z += xx.x * lane1;
        // control point: where the two lane lines meet (the centre if they're parallel)
        const den = ex.x * xx.z - ex.z * xx.x;
        let cp = { x: J.x, z: J.z };
        if (Math.abs(den) > 0.1) {
            const t = ((x.x - e.x) * xx.z - (x.z - e.z) * xx.x) / den;
            if (t > 0 && t < 60) cp = { x: e.x + ex.x * t, z: e.z + ex.z * t };
        }
        const pts = [];
        let s = 0;
        for (let k = 0; k <= 8; k++) {
            const u = k / 8, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), d = u * u;
            const px = a * e.x + b * cp.x + d * x.x, pz = a * e.z + b * cp.z + d * x.z;
            if (k) s += Math.hypot(px - pts[k - 1].x, pz - pts[k - 1].z);
            pts.push({ x: px, y: J.yAt(px, pz), z: pz, g: 0, s });
        }
        return { pts, len: s, bridges: [], turn: true, id: c.i, uid: -1 - c.i, nodes: [], links: [null, null] };
    }

    move(c, dt) {
        const gap = this.gapAhead(c);
        if (gap < 0) { this.wreck(c, true); return; }
        let target = c.cruise;
        if (gap < 120) target = Math.max(0, (gap - 14) * 0.25);
        // junctions: plan the way through, obey the signals
        const n = c.turn ? null : this.nextNode(c);
        if (n && c.plan && c.plan.n !== n) c.plan = null;
        if (n && !c.plan) c.plan = { n, exit: this.plan(c, n) };
        target = Math.min(target, this.junctionLimit(c, dt, n));
        if (c.plan && c.plan.exit && c.plan.exit.path !== c.path) target = Math.min(target, c.path.street ? 7 : 9); // slow for the turn
        // keep a gap to the vehicle ahead (a wreck too), pulling round a wreck when the other lane is clear
        const lane = c._lane;
        if (lane) {
            const k = lane[c._k] === c ? c._k : lane.indexOf(c);
            let lead = lane[k + 1];
            if (lead && lead === c.passing) lead = lane[k + 2];
            if (lead) {
                const room = (lead.s - c.s) * c.dir - (lead.len + c.len) / 2 - GAP;
                target = Math.min(target, Math.max(0, room * 0.6), lead.dead ? Infinity : lead.speed + room * 0.4);
                if (lead.dead && room < 6 && c.speed < 1) {
                    c.blocked += dt;
                    const clear = !(c._other || []).some(o => { const d = (o.s - c.s) * c.dir; return d > -10 && d < 70 && !o.dead; });
                    if (c.blocked > 2.5 && clear) { c.passing = lead; c.blocked = 0; }
                } else c.blocked = 0;
            }
        }
        if (c.passing && (c.passing.s - c.s) * c.dir < -(c.passing.len + c.len) / 2 - 4) c.passing = null; // past it
        c.speed += Math.max(-7 * dt, Math.min((c.big ? 2 : 3) * dt, target - c.speed));
        if (c.speed < 0.3 && gap < 40) { c.wait += dt; if (c.wait > rand(4, 9)) { c.dir = -c.dir; c.wait = 0; c.plan = null; } }
        const before = c.s;
        c.s += c.dir * c.speed * dt;
        // entering the junction box: take the turn
        if (!c.turn && c.plan && c.plan.exit && c.plan.exit.path !== c.path) {
            const pn = c.plan.n, inArm = pn.arms.find(a => a.path === c.path && a.dir === -c.dir);
            if (inArm && (pn.s - c.s) * c.dir <= inArm.L) {
                const exit = c.plan.exit;
                c.turn = { to: exit, J: pn.J };
                c.path = this.turnPath(c, pn, exit);
                c.s = 0; c.dir = 1; c.plan = null;
                return;
            }
        }
        if (c.plan && (c.plan.n.s - c.s) * c.dir < -(c.plan.exit ? c.plan.exit.L : 8)) { c.plan = null; c.stopDone = null; }
        void before;
        // the end of the path: out of a turn onto its exit arm, on from a street onto its road, or turn round
        const atEnd = c.turn ? c.s >= c.path.len : c.dir > 0 ? c.s > c.path.len - 4 : c.s < 4;
        if (atEnd) {
            if (c.turn) {
                const ex = c.turn.to;
                c.path = ex.path; c.dir = ex.dir; c.s = ex.s + ex.dir * ex.L;
                c.turn = null; c.stopDone = null;
                c.cruise = (c.path.street ? rand(10, 14) : rand(16, 27)) * (c.big ? 0.82 : 1);
                return;
            }
            const end = c.dir > 0 ? 1 : 0, link = c.path.links && c.path.links[end];
            if (link && Math.random() < 0.92) {
                c.path = link.path; c.dir = link.end === 0 ? 1 : -1; c.s = link.end === 0 ? 1 : link.path.len - 1;
                c.plan = null; c.stopDone = null;
                c.cruise = (c.path.street ? rand(10, 14) : rand(16, 27)) * (c.big ? 0.82 : 1);
                return;
            }
            c.s = Math.max(4, Math.min(c.path.len - 4, c.s)); c.dir = -c.dir; c.stopDone = null; c.plan = null;
        }
    }

    // world transform of a vehicle on its path
    pose(c, lane) {
        samplePath(c.path, c.s, _p, _t);
        if (c.dir < 0) _t.negate();
        const rx = -_t.z, rz = _t.x, rl = Math.hypot(rx, rz) || 1;
        _p.x += rx / rl * lane; _p.z += rz / rl * lane;
        _p.y += (_p.g || 0) * lane * c.dir + c.yOff + craterAdj(_p.x, _p.z); // (down into a crater on the road and out)
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
        this.lanes();
        // who's in which junction box (for stop signs: wait until it's clear)
        if (this.towns && this.towns.junctions) for (const J of this.towns.junctions) J.busy = 0;
        for (const c of this.cars) {
            if (c.dead || c.stolen) continue;
            if (c.turn) c.turn.J.busy++;
            else if (c.plan && Math.abs(c.plan.n.s - c.s) < 9) c.plan.n.J.busy++;
        }
        const hide = (i) => { for (let k = 0; k < 4; k++) lp.setXYZ(i * 4 + k, 0, -999, 0); };
        let pools = 0;
        const pm = this.pools.instanceMatrix.array;
        for (const c of this.cars) {
            if (c.stolen) { // taken by the player: its lights go with it
                _m.makeScale(0, 0, 0); this.carSet.setMatrix(c.i, _m);
                hide(c.i);
                continue;
            }
            // far from the camera: simulate every 4th frame (with the saved-up time) — nobody can see them
            if (cam && c.pos && dt > 0 && !c.fall && (c.pos.x - cam.x) ** 2 + (c.pos.z - cam.z) ** 2 > FAR2 && (this.frame + c.i) % 4) { c.acc = (c.acc || 0) + dt; continue; }
            const cdt = dt + (c.acc || 0); c.acc = 0;
            if (!c.dead) this.move(c, cdt);
            this.fallUpdate(c, dt, game);
            // lane: our own, or the other one while pulling round a wreck
            const want = c.passing ? -laneOf(c.path) * 0.9 : laneOf(c.path);
            c.laneOff += (want - c.laneOff) * Math.min(1, cdt * 1.5);
            this.pose(c, c.turn ? 0 : c.laneOff);
            _e.set(Math.asin(Math.max(-1, Math.min(1, _t.y))), Math.atan2(-_t.x, -_t.z), c.dead && !c.fall ? 0.15 : 0);
            _q.setFromEuler(_e);
            _s.set(1, 1, 1);
            if (c.fall === 0 && c.yOff < -60) _s.set(0.0001, 0.0001, 0.0001);
            _m.compose(_p, _q, _s);
            this.carSet.setMatrix(c.i, _m);
            { // always kept current (cheap), so switching to night shows them in the right place
                if (c.dead) hide(c.i);
                else {
                    const h = c.len / 2, w = c.big ? 0.95 : 0.7, rx = -_t.z, rz = _t.x, y = _p.y + (c.big ? 1.0 : 0.75);
                    lp.setXYZ(c.i * 4, _p.x + _t.x * h + rx * w, y, _p.z + _t.z * h + rz * w);
                    lp.setXYZ(c.i * 4 + 1, _p.x + _t.x * h - rx * w, y, _p.z + _t.z * h - rz * w);
                    lp.setXYZ(c.i * 4 + 2, _p.x - _t.x * h + rx * w, y, _p.z - _t.z * h + rz * w);
                    lp.setXYZ(c.i * 4 + 3, _p.x - _t.x * h - rx * w, y, _p.z - _t.z * h - rz * w);
                    // a pool of light on the road ahead, for the nearest cars
                    if (this.night && cam && pools < POOLS && (_p.x - cam.x) ** 2 + (_p.z - cam.z) ** 2 < 900 * 900) {
                        _m.compose(_p.set(_p.x + _t.x * h, _p.y - 0.4, _p.z + _t.z * h), _q.setFromAxisAngle(_v.set(0, 1, 0), Math.atan2(-_t.x, -_t.z)), _s.set(1, 1, 1));
                        _m.toArray(pm, pools * 16);
                        pools++;
                    }
                }
            }
            if (c.smoke > 0 && game) {
                c.smoke -= dt;
                if (Math.random() < dt * 8) game.effects.smoke.emit(c.pos, _v.set(rand(-1, 1), rand(4, 7), rand(-1, 1)), rand(2, 4), 4, 14, [0.08, 0.08, 0.08], [0.3, 0.3, 0.3], 0.5, 0, 0.2, 2);
            }
        }
        if (this.night) {
            this.pools.count = pools;
            this.pools.instanceMatrix.clearUpdateRanges();
            if (pools) { this.pools.instanceMatrix.addUpdateRange(0, pools * 16); this.pools.instanceMatrix.needsUpdate = true; }
        }
        let nb = 0; // buggies drawn: only the ones near the camera, packed to the front (like the cars)
        for (const b of this.buggies) {
            if (!b.dead) this.moveBuggy(b, dt);
            this.fallUpdate(b, dt, game);
            b.bounce += dt * (4 + b.speed * 0.5);
            b.yOff = b.fall ? b.yOff : Math.abs(Math.sin(b.bounce)) * 0.12 * Math.min(1, b.speed / 8);
            this.pose(b, 1.4);
            if (!cam || (_p.x - cam.x) ** 2 + (_p.z - cam.z) ** 2 < 3500 * 3500) {
                _e.set(Math.asin(Math.max(-1, Math.min(1, _t.y))) + Math.sin(b.bounce * 1.3) * 0.03, Math.atan2(-_t.x, -_t.z), b.dead ? 0.4 : Math.sin(b.bounce * 0.7) * 0.04);
                _q.setFromEuler(_e);
                _m.compose(_p, _q, _s.set(1, 1, 1));
                for (const im of this.buggyParts) im.setMatrixAt(nb, _m);
                nb++;
            }
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
        for (const im of this.buggyParts) {
            const was = im.count;
            im.count = nb; im.visible = nb > 0;
            if (!nb && !was) continue;
            im.instanceMatrix.clearUpdateRanges();
            if (nb) im.instanceMatrix.addUpdateRange(0, nb * 16);
            im.instanceMatrix.needsUpdate = nb > 0;
        }
        if (this.lights.visible) lp.needsUpdate = true;
    }

    // buggies: out and back along their trail
    moveBuggy(b, dt) {
        b.speed += Math.max(-7 * dt, Math.min(3 * dt, b.cruise - b.speed));
        b.s += b.dir * b.speed * dt;
        if (b.s < 4 || b.s > b.path.len - 4) { b.s = Math.max(4, Math.min(b.path.len - 4, b.s)); b.dir = -b.dir; }
    }

    // keep a road clear (e.g. for a mission convoy)
    clearPath(path) {
        for (const c of this.cars) if (c.path === path) { let tries = 0; do { this.place(c); } while (c.path === path && ++tries < 20); }
    }
}

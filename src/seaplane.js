// ═══════════════════════════════════════════════════════════════
// Seaplanes and flying boats on the water (the CL-415; any AIRCRAFT entry with a `seaplane` block).
//
// On the water the aircraft is a rigid body (6 degrees of freedom) instead of the wheeled ground model:
//   • buoyancy: contact points along the keel and the chines of the hull and under the wingtip floats, each a
//     spring on its depth below the waves of water.js (the same surface that is drawn), damped against the
//     water's own vertical motion, so it floats at its real draught and rides the swell. The centre of gravity
//     sits `cgHeight` above the keel: high over a narrow hull, so at rest it leans on one float, like the real one;
//   • hydrodynamic resistance of a planing hull: rises with speed to a hump (≈ 0.2 of the weight the water
//     carries, at the hump speed), then falls away as the hull climbs onto its step and planes; less as the
//     wing takes the weight; a keel that resists sideslip; the water rudder turns it at taxi speeds;
//   • the wing and the propellers as in flight (aircraft.js's lift, drag and thrust), elevator and ailerons
//     working with the dynamic pressure, so it rotates onto the step and flies off at its takeoff speed;
//   • beaching: the same points (and the wheels, gear down) stand on the true terrain, so it can run up a
//     beach or a ramp, and taxi out onto land with the gear down (the ground model takes over there).
// Touching down: too fast a sink, the nose too low, a wing down, the gear down, too fast, or a sea too big for
// the type damages it or flips it over; slamming into waves on the water hurts it too, and a float driven under
// or a roll past ~55° capsizes it. On the water it throws spray from the bow and floats and leaves a wake (drawn
// into the ocean's wake map, shipfx.js). Space on the water reverses the propellers (to stop, or back off).
// Everything here is a function of the Aircraft (aircraft.js calls in: updateFlight → waterStep, checkGround →
// waterContact, updateGround → enterWater); the state lives in ac.sea.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { waterSample, seaFactors, WATER, SEA_STATES, SET_DEPTH } from './water.js';
import { terrainHeight } from './terraincore.js';
import { foamTexture } from './shipfx.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const G = 9.81;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _mm = new THREE.Matrix4();
const _F = new THREE.Vector3(), _T = new THREE.Vector3(), _r = new THREE.Vector3(), _vp = new THREE.Vector3(), _fp = new THREE.Vector3(), _tq = new THREE.Vector3();
const _vw = new THREE.Vector3(), _fh = new THREE.Vector3(), _rh = new THREE.Vector3(), _vh = new THREE.Vector3(), _ld = new THREE.Vector3();
const _tb = new THREE.Vector3(), _wb = new THREE.Vector3(), _tw = new THREE.Vector3(), _ax = new THREE.Vector3(), _cg = new THREE.Vector3(), _cgw = new THREE.Vector3();
const _W = { h: 0, nx: 0, ny: 1, nz: 0, vx: 0, vy: 0, vz: 0, jac: 1, x0: 0, z0: 0, depth: 0 };
const AY = new THREE.Vector3(0, 1, 0);

// ── Contact points ──
// From the type's `seaplane` block (config.js), in model space (x right, y up, nose −z): keel stations as
// [z / L, keel height above its lowest point (m), share of the buoyancy], the chines `chine` · L out to each side
// and `deadrise` metres up, the floats as [x / L, height above the keel (m), z / L], the wheels likewise.
// The buoyancy is normalised so the hull floats with its step `draft` metres deep.
export function contactPoints(ac) {
    if (ac._seaPts && ac._seaPts.type === ac.type) return ac._seaPts;
    const S = ac.spec.seaplane, L = ac.spec.length, keel = keelY(ac);
    const pts = [];
    for (const [zf, hk, wf] of S.keel) {
        const y = keel + hk, z = zf * L, cw = S.chine * L;
        pts.push({ p: new THREE.Vector3(0, y, z), k: wf, float: false });
        pts.push({ p: new THREE.Vector3(-cw, y + S.deadrise, z), k: wf * 0.5, float: false }, { p: new THREE.Vector3(cw, y + S.deadrise, z), k: wf * 0.5, float: false });
    }
    let sum = 0;
    for (const c of pts) sum += c.k * Math.max(0, S.draft - (c.p.y - keel));
    const kScale = G / Math.max(sum, 1e-3);
    for (const c of pts) c.k *= kScale;
    // wingtip floats: a float pushed right under carries floatLoad of the weight
    for (const [xf, hf, zf] of S.floats) {
        for (const sx of [-1, 1]) pts.push({ p: new THREE.Vector3(sx * xf * L, keel + hf, zf * L), k: G * S.floatLoad / S.floatDepth, float: true, depth: S.floatDepth });
    }
    const wheels = (S.wheels || []).map(([x, y, z]) => new THREE.Vector3(x * L, keel + y, z * L));
    ac._seaPts = { type: ac.type, pts, wheels, keel, kScale, cg: new THREE.Vector3(0, keel + S.cgHeight, (S.cgZ || 0) * L) };
    return ac._seaPts;
}

// the keel's height in model space: the model's lowest point (gear up), or where the type says it is
export function keelY(ac) { return ac.rig.minY ?? (ac.spec.seaplane.keelY ?? -0.2) * ac.spec.length; }

// resistance / load of a planing hull at speed ratio x = V / hump speed: rising to the hump, falling off the step
export function hullResistance(x) {
    if (x <= 1) return 0.2 * x * x * (0.35 + 0.65 * x);
    return 0.09 + 0.11 * Math.exp(-2.6 * (x - 1)) + 0.012 * (x - 1);
}

// Significant wave height of the sea at (x, z) (m): the weather's, scaled by how exposed this water is
const _sf = [0, 0, 0, 0];
export function seaHs(x, z) {
    const S = SEA_STATES[WATER.weather] || SEA_STATES.clear;
    const f = seaFactors(x, z, _sf);
    let hs2 = 0;
    for (let i = 0; i < 3; i++) {
        const t = Math.min(Math.max(f[3] / SET_DEPTH[i], 0), 1), g = f[i] * t * t * (3 - 2 * t);
        hs2 += (S.sets[i].hs * g) ** 2;
    }
    return Math.sqrt(hs2);
}

// ── State ──
function seaState(ac) {
    if (!ac.sea) ac.sea = { w: new THREE.Vector3(), load: 0, t: 0, sprayT: 0, hit: 0, planing: 0, wake: null, hw: null };
    return ac.sea;
}

// Put the aircraft afloat, level on the waves at (x, z), heading h (rad, 0 = −Z)
export function spawnWater(ac, x, z, heading) {
    const P = contactPoints(ac), S = ac.spec.seaplane, s = seaState(ac);
    ac.onGround = true; ac.onWater = true; ac.deck = null; ac._dl = null; ac.bellied = false; ac.trap = false; ac.catapult = 0;
    ac.gear = false; ac.gearAnim = 0; ac.flaps = 0; ac.flapAnim = 0; ac.brakeAnim = 0;
    ac.throttle = ac.controls.throttle = 0;
    ac.alpha = 0; ac.beta = 0; ac.rollRate = 0;
    ac.qv.setFromAxisAngle(AY, heading);
    ac.vel.set(0, 0, 0); ac.speed = 0; ac.relSpeed = 0;
    ac.pos.set(x, waterSample(x, z, WATER.t, _W).h - P.keel - S.draft, z);
    s.w.set(0, 0, 0); s.load = 1;
    ac.syncBody();
    if (ac.updateGearVisual) ac.updateGearVisual();
}

// ── Touching the water from the air (aircraft.js checkGround, every flight step) ──
// true when the hull or a float is in the water: the aircraft is then on it, damaged, or wrecked
export function waterContact(ac) {
    if (!ac.spec.seaplane || ac.onWater) return false;
    const P = contactPoints(ac);
    if (ac.pos.y + P.keel - 3 > WATER.maxCrest + 2) return false; // well above any wave
    let wet = false;
    for (const c of P.pts) {
        _v1.copy(c.p).applyQuaternion(ac.quat).add(ac.pos);
        if (terrainHeight(_v1.x, _v1.z) > -0.5) continue; // over land (as game.surfaceAt has it): the ground model's business
        if (_v1.y < waterSample(_v1.x, _v1.z, WATER.t, _W).h) { wet = true; break; }
    }
    if (!wet) return false;
    touchdown(ac);
    return true;
}

// The moment of touchdown: judge it, then float (or break)
function touchdown(ac) {
    const g = ac.game, S = ac.spec.seaplane, s = seaState(ac);
    const w = waterSample(ac.pos.x, ac.pos.z, WATER.t, _W);
    const vs = ac.vel.y - w.vy; // sink rate relative to the water surface
    const fwd = ac.getForward(_v2), right = ac.getRight(_v4);
    const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
    const roll = Math.asin(Math.max(-1, Math.min(1, right.y)));
    const V = Math.hypot(ac.vel.x, ac.vel.z);
    const hs = seaHs(ac.pos.x, ac.pos.z);
    // how bad was it (0 = a greaser, 1 = it goes over)
    let severity = 0;
    const why = [];
    const add = (x, what) => { if (x > 0.02) { severity += x; why.push(what); } };
    add((-vs - S.sinkOk) / (S.sinkMax - S.sinkOk), 'HARD');
    add((-0.02 - pitch) / 0.1, 'NOSE LOW');
    add((Math.abs(roll) - 0.1) / 0.18, 'WING LOW');
    add((V - S.landMax) / 25, 'TOO FAST');
    add((hs - S.maxWave) / S.maxWave * 1.4, 'SEA TOO HIGH');
    if (ac.gearAnim > 0.5 && V > 12) add(1.5, 'GEAR DOWN');
    s.lastLanding = { vs, pitch, roll, V, hs, severity, why };
    // back on the water moments after lifting off (skipping off a crest on the takeoff run): not a landing
    const skip = s.offAt != null && g.time - s.offAt < 4;
    if (!ac.alive || ac.falling || severity >= 1) {
        if (g.effects) g.effects.waterSplash(ac.pos, 1.8);
        if (ac.isPlayer && g.addFeed) g.addFeed('CRASHED ON THE WATER' + (why.length ? ' — ' + why.join(', ') : ''), '#ff4a3d');
        ac.health = 0;
        ac.explode(true, true);
        return;
    }
    if (severity > 0.35) {
        const dmg = severity * 0.6 * ac.maxHealth;
        ac.health -= dmg;
        if (ac.isPlayer && g.addFeed) g.addFeed('ROUGH WATER LANDING — ' + why.join(', ') + '  HULL −' + Math.round(dmg / ac.maxHealth * 100) + '%', '#ffc23f');
        if (typeof g.shake === 'number') g.shake = Math.min(1.5, g.shake + severity);
        if (ac.addDamagePoint) ac.addDamagePoint();
    }
    // on the water: the flight state carries over into the rigid body (the attitude as the AoA made it)
    ac.onWater = true; ac.onGround = true; ac.deck = null; ac._dl = null;
    ac.qv.copy(ac.quat); ac.alpha = 0; ac.beta = 0; ac.rollRate = 0;
    s.w.set(0, 0, 0); s.hit = 0;
    touchSpray(ac, Math.min(1.6, 0.5 + V / 60 + Math.max(0, -vs) / 4));
    if (g.events && !skip) g.events.emit('touchdown', ac, { vs, onRunway: false, onDeck: false, onWater: true, trap: false });
}

// From the ground model rolling into the water (gear down, down a ramp or a beach)
export function enterWater(ac) {
    const s = seaState(ac);
    ac.onWater = true; ac.onGround = true;
    ac.qv.copy(ac.quat); ac.alpha = 0; ac.beta = 0;
    s.w.set(0, 0, 0);
}

// ── The step on the water ──
export function waterStep(ac, dt, rho) {
    const s = seaState(ac), S = ac.spec.seaplane, c = ac.controls, f = ac.spec.flight;
    const P = contactPoints(ac), I = S.inertia; // per-unit-mass moments of inertia (m²): roll, pitch, yaw
    s.t += dt;
    // engines and fuel as in flight
    ac.throttle += (Math.min(Math.max(c.throttle, 0), 1) - ac.throttle) * (1 - Math.exp(-(ac.throttle < c.throttle ? 1.6 : 2.5) * dt));
    const thrustA = ac.thrustFor(rho, ac.speed / 340);
    ac.afterburner = false;
    ac.burnFuel(dt);
    // the water under each point, once per frame (it moves slowly next to the substeps: carried on by its vy)
    const pts = P.pts, n = pts.length;
    if (!s.hw || s.hw.length !== n) { s.hw = new Float32Array(n); s.hv = new Float32Array(n); }
    for (let i = 0; i < n; i++) {
        _v1.copy(pts[i].p).applyQuaternion(ac.quat).add(ac.pos);
        const w = waterSample(_v1.x, _v1.z, WATER.t, _W);
        s.hw[i] = w.h; s.hv[i] = w.vy;
    }
    const drift = waterSample(ac.pos.x, ac.pos.z, WATER.t, _W); // the surface water's orbital motion under the hull
    const dvx = drift.vx, dvz = drift.vz;
    const sub = Math.max(2, Math.ceil(dt / 0.008)), h = dt / sub;
    let impact = 0, push = 0, floatDeep = 0, loadAvg = 0, wetAny = false, grounded = 0, scrape = 0;
    // the rigid body turns about its centre of gravity: cg = pos + R·cgOffset
    _cg.copy(P.cg).applyQuaternion(ac.quat).add(ac.pos);
    for (let k = 0; k < sub; k++) {
        const tk = k * h;
        const fwd = _v2.set(0, 0, -1).applyQuaternion(ac.quat);
        const up = _v3.set(0, 1, 0).applyQuaternion(ac.quat);
        const right = _v4.set(1, 0, 0).applyQuaternion(ac.quat);
        _cgw.copy(P.cg).applyQuaternion(ac.quat); // cg relative to the model origin, world axes
        const F = _F.set(0, -G, 0), T = _T.set(0, 0, 0);
        let load = 0, wetN = 0, wy = 0;
        const uh = ac.vel.x * fwd.x + ac.vel.z * fwd.z, xs = Math.abs(uh) / S.humpSpeed;
        const planeK = xs > 0.6 ? S.planeLift * (xs - 0.6) * (xs - 0.6) : 0;
        // ── buoyancy (and the ground, where a point is on the lake bed, a beach or a ramp) ──
        for (let i = 0; i < n; i++) {
            const cp = pts[i];
            const r = _r.copy(cp.p).applyQuaternion(ac.quat).sub(_cgw); // arm from the cg
            const px = _cg.x + r.x, py = _cg.y + r.y, pz = _cg.z + r.z;
            const vp = _vp.copy(s.w).cross(r).add(ac.vel);
            const imm = s.hw[i] + s.hv[i] * tk - py;
            if (imm > 0) {
                const deep = cp.float ? Math.min(imm, cp.depth) : Math.min(imm, S.draft * 2.2);
                // planing: at speed the water pushing on the bottom lifts it far more than its displacement does
                const dyn = cp.float ? 1 : 1 + planeK;
                let fy = cp.k * deep * dyn - cp.k * S.heaveDamp * (vp.y - s.hv[i]) * Math.min(1, imm / 0.3) * Math.sqrt(dyn);
                if (fy < 0) fy = 0;
                if (cp.float) floatDeep = Math.max(floatDeep, imm / cp.depth);
                else { load += cp.k * deep; wetN++; }
                F.y += fy; wy += fy;
                T.add(_tq.copy(r).cross(_fp.set(0, fy, 0)));
            }
            const pen = terrainHeight(px, pz) - py;
            if (pen > 0) {
                grounded++;
                scrape = Math.max(scrape, Math.hypot(vp.x, vp.z)); // the hull dragged over the bottom
                const fy = Math.min(pen, 1.5) * 60 - Math.min(vp.y, 0) * 9;
                _fp.set(-vp.x * 1.6, Math.max(fy, 0), -vp.z * 1.6);
                F.add(_fp); T.add(_tq.copy(r).cross(_fp));
            }
        }
        // ── the wheels (gear down): on the terrain only ──
        if (ac.gearAnim > 0.9) for (const wp of P.wheels) {
            const r = _r.copy(wp).applyQuaternion(ac.quat).sub(_cgw);
            const px = _cg.x + r.x, py = _cg.y + r.y, pz = _cg.z + r.z;
            const pen = terrainHeight(px, pz) - py;
            if (pen <= 0) continue;
            grounded++;
            const vp = _vp.copy(s.w).cross(r).add(ac.vel);
            const along = vp.dot(fwd), across = vp.dot(right);
            const brake = ac.wheelBrake ? 3 : 0.15;
            _fp.set(0, Math.max(0, Math.min(pen, 0.8) * 45 - Math.min(vp.y, 0) * 7), 0)
                .addScaledVector(fwd, -Math.sign(along) * Math.min(Math.abs(along) * 4, brake))
                .addScaledVector(right, -across * 3);
            F.add(_fp); T.add(_tq.copy(r).cross(_fp));
        }
        const loadFrac = load / G; // the share of the weight the water carries
        loadAvg += loadFrac / sub;
        if (wetN) wetAny = true;
        // ── hydrodynamics of the hull (through the water, which itself sways with the waves) ──
        _vw.set(ac.vel.x - dvx, 0, ac.vel.z - dvz);
        _fh.set(fwd.x, 0, fwd.z).normalize(); _rh.set(right.x, 0, right.z).normalize();
        const u = _vw.dot(_fh), lat = _vw.dot(_rh);
        if (wetN) {
            const x = Math.abs(u) / S.humpSpeed;
            const R = hullResistance(x) * G * Math.min(loadFrac, 1.4);
            F.addScaledVector(_fh, -Math.sign(u) * R - u * 0.03);
            F.addScaledVector(_rh, -lat * S.keelK * Math.min(loadFrac, 1.2)); // the keel: it goes where it points
            s.planing = Math.min(1, Math.max(0, (x - 1) / 0.8));
        } else s.planing = 0;
        // ── the wing and the engines ──
        const V = ac.vel.length(), q = ac.liftK * V * V * rho;
        const vhat = V > 0.5 ? _vh.copy(ac.vel).divideScalar(V) : _vh.copy(fwd);
        const alpha = V > 3 ? Math.atan2(-vhat.dot(up), vhat.dot(fwd)) : 0; // the wing against the airflow
        const aN = alpha / ac.alphaMax;
        const Cl = (aN <= 1 ? ac.clEff * Math.max(alpha, -ac.alphaMax * 0.5) : 1.65 * (1 - 0.35 * Math.min(1, (aN - 1) * 3))) + ac.flapCl;
        const cd = ac.cd0 * (1 + 3.5 * ac.brakeAnim + 1.7 * ac.flapAnim) + 0.13 * Cl * Cl / f.lift + ac.cd0 * 0.8 * ac.gearAnim;
        if (V > 0.5) {
            const ld = _ld.copy(right).cross(vhat).normalize(); // lift: across the airflow, in the plane of symmetry
            if (ld.dot(up) < 0) ld.negate();
            F.addScaledVector(ld, q * Cl).addScaledVector(vhat, -q * cd);
        }
        s.liftG = q * Cl / G;
        const rev = ac.wheelBrake && V < 25 ? -0.45 : 1; // Space: reverse pitch
        F.addScaledVector(fwd, thrustA * rev);
        if (ac.game.wind) F.addScaledVector(ac.game.wind, 0.02);
        // ── control moments (dynamic pressure), water rudder, damping, in body axes (× inertia) ──
        const qa = Math.min(q, 40);
        _wb.copy(s.w).applyQuaternion(_q.copy(ac.quat).invert());
        const steer = c.yaw * 0.7 - c.roll * 0.3; // (+: to the left, like the ground model)
        const yawTarget = steer * S.turnRate * Math.min(1, Math.abs(u) / 2 + 0.25) / (1 + Math.max(0, Math.abs(u) - 12) / 8);
        const dw = wetN ? S.waterDamp : 0.5;
        _tb.set(
            (c.pitch * qa * S.pitchK - _wb.x * dw * 0.8 * I[1]),
            (yawTarget - _wb.y) * (wetN ? 2.2 : 0.8) * I[2],
            (-c.roll * qa * S.rollK - _wb.z * dw * I[0]),
        ).applyQuaternion(ac.quat);
        T.add(_tb);
        // ── integrate (semi-implicit Euler) about the cg ──
        ac.vel.addScaledVector(F, h);
        _cg.addScaledVector(ac.vel, h);
        const tb = _tw.copy(T).applyQuaternion(_q.copy(ac.quat).invert());
        tb.x /= I[1]; tb.y /= I[2]; tb.z /= I[0];
        s.w.addScaledVector(tb.applyQuaternion(ac.quat), h);
        const wl = s.w.length();
        if (wl > 1e-7) { _q2.setFromAxisAngle(_ax.copy(s.w).divideScalar(wl), wl * h); ac.quat.premultiply(_q2).normalize(); }
        ac.pos.copy(_cg).sub(_cgw.copy(P.cg).applyQuaternion(ac.quat));
        impact = Math.max(impact, wy); // the hull slamming: the upward push the water gives it
        push = Math.max(push, F.y + G); // everything holding it up (for the G meter)
    }
    s.load = loadAvg;
    // ── state for the rest of the game ──
    ac.qv.copy(ac.quat); ac.alpha = 0; ac.beta = 0; ac.rollRate = 0;
    const V = ac.vel.length();
    ac.speed = V; ac.relSpeed = Math.hypot(ac.vel.x, ac.vel.z); ac.mach = V / 340;
    ac.gLoad = push / G;
    ac.stalling = false; ac.stallDepth = 0; ac.stallExcess = 0;
    // slamming into waves too big for it
    if (impact > G * S.slamG) {
        const dmg = (impact / G - S.slamG) * 5;
        ac.health -= dmg; s.hit += dmg;
        if (ac.health <= 0) { ac.health = 0; ac.explode(true, true); return; }
        if (ac.isPlayer && dmg > 4 && ac.game.addFeed) ac.game.addFeed('SLAMMING INTO THE WAVES — HULL −' + Math.round(dmg / ac.maxHealth * 100) + '%', '#ffc23f');
    }
    // the hull driven onto a beach, a bank or rocks faster than a gentle beaching: it tears
    if (scrape > 6) {
        const dmg = (scrape - 6) ** 2 * 2 * dt;
        ac.health -= dmg; s.hit += dmg;
        if (ac.health <= 0) { ac.health = 0; ac.explode(true, true); return; }
        if (ac.isPlayer && !s.agroundT && ac.game.addFeed) ac.game.addFeed('RUN AGROUND — HULL DAMAGED', '#ffc23f');
        s.agroundT = 3;
    }
    if (s.agroundT) s.agroundT = Math.max(0, s.agroundT - dt);
    // capsized: over on its side or back, or a float driven right under
    const upY = _v3.set(0, 1, 0).applyQuaternion(ac.quat).y;
    if (upY < 0.57 || floatDeep > 1.6) {
        if (ac.isPlayer && ac.game.addFeed) ac.game.addFeed('CAPSIZED', '#ff4a3d');
        ac.health = 0;
        ac.explode(true, true);
        return;
    }
    // lift-off: the hull clear of the water, nothing touching, and the wing carrying it (a crest can throw it
    // clear below flying speed: then it just drops back)
    if (!wetAny && !grounded && floatDeep <= 0 && s.liftG > 0.97) { takeoff(ac); return; }
    // out of the water onto land (a ramp or a beach, gear down): the ground model takes over once it stands where
    // game.surfaceAt no longer calls it water (it hands back below −0.5 m: a margin, so it doesn't flicker between)
    if (!wetAny && grounded && ac.gearAnim > 0.9 && V < 25 && terrainHeight(ac.pos.x, ac.pos.z) > -0.2) {
        ac.onWater = false; ac.onGround = true; ac.deck = null;
        const fw = _v2.set(0, 0, -1).applyQuaternion(ac.quat);
        ac.qv.setFromAxisAngle(AY, Math.atan2(-fw.x, -fw.z));
        ac.relSpeed = Math.hypot(ac.vel.x, ac.vel.z);
        ac.syncBody();
        return;
    }
    waterFX(ac, dt);
}

// back into the air: the wind frame from the velocity, the angle of attack from the body
function takeoff(ac) {
    const s = seaState(ac);
    ac.onWater = false; ac.onGround = false;
    const fwd = _v2.set(0, 0, -1).applyQuaternion(ac.quat), up = _v3.set(0, 1, 0).applyQuaternion(ac.quat);
    if (ac.vel.lengthSq() < 1) ac.vel.copy(fwd);
    const vhat = _v1.copy(ac.vel).normalize();
    const right = _v4.copy(vhat).cross(up).normalize();
    const upW = _vp.copy(right).cross(vhat).normalize();
    _mm.makeBasis(right, upW, _vh.copy(vhat).negate());
    ac.qv.setFromRotationMatrix(_mm);
    ac.alpha = Math.max(0, Math.atan2(-vhat.dot(up), vhat.dot(fwd)));
    ac.beta = 0; ac.rollRate = 0;
    s.w.set(0, 0, 0);
    s.offAt = ac.game.time;
    ac.syncBody();
    if (s.wake) s.wake.stop();
}

// ── Spray and wake ──
// touching down: sheets of spray thrown out sideways and back from the chines (k: 0.5 a greaser … 1.6 a slam)
function touchSpray(ac, k) {
    const fx = ac.game.effects;
    if (!fx || !fx.smoke) return;
    const S = ac.spec.seaplane, L = ac.spec.length, ky = keelY(ac);
    for (let i = 0; i < 16; i++) {
        const side = i % 2 ? 1 : -1, r = Math.random();
        _v1.set(side * S.chine * L * 1.1, ky + 0.2, (S.sprayZ + r * 0.3) * L).applyQuaternion(ac.quat).add(ac.pos);
        const out = _v2.set(side, 0, 0).applyQuaternion(ac.quat);
        _v3.copy(ac.vel).multiplyScalar(0.3 + 0.3 * r).addScaledVector(out, (4 + Math.random() * 8) * k).add(_v4.set(0, (2.5 + Math.random() * 5) * k, 0));
        fx.smoke.emit(_v1, _v3, 1 + Math.random() * k, 1.2 + k, 4 + 5 * k, [0.93, 0.96, 1], [0.86, 0.9, 0.94], 0.5 + 0.2 * Math.min(k, 1), 0, 0.9, -9);
    }
}

function waterFX(ac, dt) {
    const g = ac.game, fx = g.effects, s = seaState(ac), S = ac.spec.seaplane;
    const L = ac.spec.length, V = Math.hypot(ac.vel.x, ac.vel.z);
    if (fx && fx.smoke) {
        s.sprayT -= dt;
        if (V > 3 && s.sprayT <= 0 && s.load > 0.05) {
            s.sprayT = V > 20 ? 0.025 : 0.07;
            const k = Math.min(1, V / 25);
            // bow spray: sheets off both chines ahead of the step; lower, further aft and finer once it planes
            for (const side of [-1, 1]) {
                const zf = S.sprayZ + s.planing * 0.12;
                _v1.set(side * S.chine * L * 1.05, keelY(ac) + 0.3, zf * L).applyQuaternion(ac.quat).add(ac.pos);
                const out = _v2.set(side, 0, 0).applyQuaternion(ac.quat);
                // thrown out sideways and falling straight back (heavy water, not smoke): short-lived, fading fast
                _v3.copy(ac.vel).multiplyScalar(0.6).addScaledVector(out, 5 + 9 * k).add(_v4.set(0, 3 + 6 * k * (1 - s.planing * 0.5), 0));
                fx.smoke.emit(_v1, _v3, 0.45 + 0.5 * k, 0.7 + 1.4 * k, 2.5 + 3.5 * k, [0.93, 0.96, 1], [0.86, 0.9, 0.94], 0.45 * k + 0.1, 0, 0.9, -9);
            }
            // a float in the water ploughs its own
            for (const cp of contactPoints(ac).pts) {
                if (!cp.float) continue;
                _v1.copy(cp.p).applyQuaternion(ac.quat).add(ac.pos);
                if (V > 4 && _v1.y < waterSample(_v1.x, _v1.z, WATER.t, _W).h + 0.1) fx.smoke.emit(_v1, _v3.copy(ac.vel).multiplyScalar(0.3).add(_v4.set(0, 2.5, 0)), 0.8, 0.6, 3, [0.93, 0.96, 1], [0.86, 0.9, 0.94], 0.45, 0, 0.9, -9);
            }
        }
    }
    // the wake, drawn into the ocean's wake map (shipfx.js)
    if (!s.wake && g.naval && g.naval.fx && g.naval.fx.addTrail && V > 1) s.wake = new WakeTrail(g.naval.fx, ac);
    if (s.wake) s.wake.push(ac, V);
}

// A small craft's wake for the wake map: a strip of foam and milky water behind the hull
const TRAIL_FS = /* glsl */`
    varying vec4 vD; // metres behind, across (−1..1), strength
    uniform sampler2D foamMap;
    uniform float time;
    void main() {
        float x = abs(vD.y);
        // the map's texels are metres wide: slow, large-scale breakup along the trail (the ocean shader adds the lace)
        float n = texture2D(foamMap, vec2(0.37 + vD.y * 0.06, vD.x * 0.012 - time * 0.004)).g;
        float core = (1.0 - smoothstep(0.15, 1.0, x)) * exp(-vD.x / 40.0) * vD.z;
        float foam = clamp(core * (0.25 + 0.9 * n), 0.0, 0.8); // the ocean turns this into lace (its foam threshold)
        float milk = (1.0 - smoothstep(0.4, 1.0, x)) * exp(-vD.x / 220.0) * vD.z * 0.45;
        gl_FragColor = vec4(foam, milk, 0.0, 1.0);
    }`;
export class WakeTrail {
    constructor(shipfx, ac) {
        this.fx = shipfx; this.ac = ac;
        this.max = 90;
        this.pts = [];
        this.travel = 0; this.last = null; this.time = 0;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.max * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
        g.setAttribute('aD', new THREE.BufferAttribute(new Float32Array(this.max * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage));
        const idx = [];
        for (let i = 0; i < this.max - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        g.setIndex(idx);
        g.setDrawRange(0, 0);
        this.mat = new THREE.ShaderMaterial({
            uniforms: { foamMap: { value: foamTexture() }, time: { value: 0 } },
            vertexShader: 'attribute vec4 aD; varying vec4 vD; void main() { vD = aD; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }',
            fragmentShader: TRAIL_FS,
            depthTest: false, depthWrite: false, side: THREE.DoubleSide,
            blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        });
        this.mesh = new THREE.Mesh(g, this.mat);
        this.mesh.frustumCulled = false;
        shipfx.addTrail(this);
    }
    attach(scene) { scene.add(this.mesh); }
    stop() { this.stopped = true; }
    push(ac, V) {
        this.stopped = false;
        const L = ac.spec.length, iv = 1 / Math.max(V, 0.1);
        const tx = ac.pos.x - ac.vel.x * iv * L * 0.35, tz = ac.pos.z - ac.vel.z * iv * L * 0.35;
        if (this.last) this.travel += Math.hypot(tx - this.last.x, tz - this.last.z);
        this.last = { x: tx, z: tz };
        const strength = Math.min(1, V / 12) * (0.4 + 0.6 * Math.min(1, ac.sea ? ac.sea.load * 1.5 : 1));
        if (!this.pts.length || this.travel - this.pts[0].s > 3) {
            this.pts.unshift({ x: tx, z: tz, s: this.travel, strength, width: 1.2 + L * 0.05 + V * 0.04 });
            if (this.pts.length > this.max) this.pts.pop();
        } else { this.pts[0].x = tx; this.pts[0].z = tz; this.pts[0].strength = Math.max(this.pts[0].strength, strength); }
    }
    update(dt) {
        this.time += dt;
        this.mat.uniforms.time.value = this.time;
        const geo = this.mesh.geometry, pos = geo.attributes.position.array, dat = geo.attributes.aD.array, P = this.pts, n = P.length;
        for (let i = 0; i < n; i++) {
            const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, n - 1)];
            let tx = a.x - b.x, tz = a.z - b.z;
            const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
            const along = this.travel - P[i].s, hw = P[i].width + along * 0.06;
            P[i].strength *= Math.exp(-dt / 40);
            for (let k = 0; k < 2; k++) {
                const sg = k ? 1 : -1, j = i * 2 + k;
                pos[j * 3] = P[i].x + tz * hw * sg; pos[j * 3 + 1] = 0.05; pos[j * 3 + 2] = P[i].z - tx * hw * sg;
                dat[j * 4] = along; dat[j * 4 + 1] = sg; dat[j * 4 + 2] = P[i].strength; dat[j * 4 + 3] = 0;
            }
        }
        geo.attributes.position.needsUpdate = geo.attributes.aD.needsUpdate = true;
        geo.setDrawRange(0, Math.max(0, n - 1) * 6);
        if (this.stopped && P.every(p => p.strength < 0.02)) this.fx.removeTrail(this); // faded out: gone
    }
    dispose() {
        this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose();
        if (this.ac.sea && this.ac.sea.wake === this) this.ac.sea.wake = null;
    }
}

// ═══════════════════════════════════════════════════════════════
// A seaplane base: sheltered water near a town, a jetty from the shore, and a clear run to take off along.
// Towns are searched nearest the home airfield first; a candidate spot needs 4 m of water, a shore within
// 250 m toward the town (for the jetty), and 1.6 km of water at least 2.5 m deep in some direction (into the
// wind if it can); lakes and bays are preferred to open coast.
// ═══════════════════════════════════════════════════════════════
export function findSeaplaneBase(towns, home = { x: 0, z: 0 }, wind = null) {
    const TH = terrainHeight, list = [...(towns || [])].sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z));
    const wl = wind ? Math.hypot(wind.x, wind.z) : 0, upX = wl > 0.1 ? -wind.x / wl : 0, upZ = wl > 0.1 ? -wind.z / wl : 0;
    let best = null;
    for (const t of list.slice(0, 14)) {
        for (let r = 250; r <= 2500 && !(best && best.town === t); r += 150) {
            for (let a = 0; a < 24; a++) {
                const ang = a / 24 * Math.PI * 2, x = t.x + Math.cos(ang) * r, z = t.z + Math.sin(ang) * r;
                if (TH(x, z) > -4) continue;
                // the shore toward the town
                const dx = (t.x - x) / r, dz = (t.z - z) / r;
                let shore = -1;
                for (let d = 10; d <= 250; d += 10) if (TH(x + dx * d, z + dz * d) > 0.5) { shore = d; break; }
                if (shore < 40) continue;
                // the longest clear takeoff run
                let run = null;
                for (let k = 0; k < 16; k++) {
                    const ha = k / 16 * Math.PI * 2, hx = Math.cos(ha), hz = Math.sin(ha);
                    let ok = true;
                    for (let d = 0; d <= 1600 && ok; d += 50) {
                        for (const lat of [-25, 0, 25]) if (TH(x + hx * d - hz * lat, z + hz * d + hx * lat) > -2.5) { ok = false; break; }
                    }
                    if (!ok) continue;
                    const into = hx * upX + hz * upZ; // into the wind is best
                    if (!run || into > run.into) run = { hx, hz, into };
                }
                if (!run) continue;
                // shelter: the share of water within 2.5 km (a lake or a bay rather than the open coast)
                let wet = 0;
                for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) if (TH(x + i * 500, z + j * 500) < 0) wet++;
                const open = wet / 121;
                const score = Math.hypot(t.x - home.x, t.z - home.z) / 1500 + open * 4 + shore / 150 - run.into;
                if (!best || score < best.score) best = { score, town: t, x, z, heading: Math.atan2(-run.hx, -run.hz), shore: { x: x + dx * shore, z: z + dz * shore }, open };
                break; // (this ring has one: the next town)
            }
        }
    }
    return best;
}

// A timber jetty from the shore out toward (x, z): decking on stringers and pile bents every 4 m, a railing post
// and a bollard or two, all in one mesh. Returns { mesh, end: {x, z} (where a seaplane ties up) }
export function buildJetty(base) {
    const sx = base.shore.x, sz = base.shore.z, ex = base.x, ez = base.z;
    const dx = ex - sx, dz = ez - sz, D = Math.hypot(dx, dz);
    const len = Math.min(Math.max(D - 18, 25), 70), ux = dx / D, uz = dz / D;
    const yaw = Math.atan2(ux, uz); // local +z along the jetty, out from the shore
    const deckY = 1.15, W = 3.2;
    const wood = [], dark = [];
    const put = (geo, x, y, z, arr = wood) => { geo.translate(x, y, z); arr.push(geo); };
    // decking: planks across, with gaps
    for (let z = -2; z < len; z += 0.32) put(new THREE.BoxGeometry(W, 0.06, 0.28), 0, deckY, z);
    // stringers and pile bents
    for (const x of [-W / 2 + 0.2, 0, W / 2 - 0.2]) put(new THREE.BoxGeometry(0.16, 0.22, len + 2), x, deckY - 0.14, len / 2 - 1, dark);
    for (let z = 0; z <= len; z += 4) {
        const wx = sx + ux * z, wz = sz + uz * z, bed = Math.min(terrainHeight(wx, wz), 0.5);
        const h = deckY - bed + 0.4;
        for (const x of [-W / 2 - 0.05, W / 2 + 0.05]) put(new THREE.CylinderGeometry(0.16, 0.18, h, 7), x, deckY - h / 2 + 0.1, z, dark);
        put(new THREE.BoxGeometry(W + 0.5, 0.2, 0.18), 0, deckY - 0.3, z, dark); // cross beam
    }
    // bollards at the end, a light post
    for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) put(new THREE.CylinderGeometry(0.12, 0.14, 0.5, 8), x, deckY + 0.28, len - 0.5, dark);
    put(new THREE.CylinderGeometry(0.06, 0.07, 3, 6), W / 2 - 0.2, deckY + 1.5, len - 1.5, dark);
    const mat = new THREE.MeshStandardMaterial({ color: 0x7b6344, roughness: 0.92 }), mat2 = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.95 });
    const g = new THREE.Group();
    for (const [arr, m] of [[wood, mat], [dark, mat2]]) {
        const mesh = new THREE.Mesh(mergeGeometries(arr), m);
        mesh.castShadow = true; mesh.receiveShadow = true;
        g.add(mesh);
        for (const a of arr) a.dispose();
    }
    g.position.set(sx, 0, sz);
    g.rotation.y = yaw;
    g.updateMatrixWorld(true);
    const endX = sx + ux * (len + 22), endZ = sz + uz * (len + 22);
    return { mesh: g, end: { x: endX, z: endZ }, dir: { x: ux, z: uz }, len };
}

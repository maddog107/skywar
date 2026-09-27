// Headless mobile forces (forces.js): a stub game with the real war layer, strike manager and forces system over
// the real terrain — no meshes, no roads (unless a test gives it towns), effects that do nothing. Used by
// tests/forces.test.mjs.
import { src } from './setup.mjs';

const THREE = await import('three');
const W = await src('war.js');
const S = await src('strikes.js');
const F = await src('forces.js');
const world = await src('world.js');

export function noopFx() {
    const sys = { emit() {} };
    return {
        now: 0, flashTex: null, smoke: sys, fire: sys, flame: sys, sparks: sys,
        addTrail: () => ({ push() {}, emitting: true }), light() {}, sprite() {}, explosion() {}, smokeColumn() {}, waterSplash() {},
        debrisBurst() {}, throwPart() {}, puffFire() {}, puffSmoke() {}, impact() {}, groundImpact() {},
    };
}

// events: a real emitter that also keeps a log
function events() {
    const map = {}, log = [];
    return { log, on(k, fn) { (map[k] = map[k] || []).push(fn); }, emit(k, a, b) { log.push({ k, a, b }); (map[k] || []).forEach(fn => fn(a, b || {})); } };
}

// opts: { towns (a towns.js Towns, for the road network), mode ('test': nothing placed), camera: [x, y, z] }
export function forcesGame(opts = {}) {
    const cam = new THREE.PerspectiveCamera();
    const c = opts.camera || [0, 3000, 0];
    cam.position.set(c[0], c[1], c[2]);
    const fired = [];
    const g = {
        time: 0, state: 'playing', callsign: 'TEST', score: 0, mode: opts.mode || 'test',
        camera: cam, scene: new THREE.Scene(),
        world: { weather: 'clear', timeKey: 'day', towns: opts.towns || null, tiles: new Map(), TILE: 2048 },
        events: events(), audio: { say() {}, tick() {}, boom() {}, whoosh() {} },
        feed: [], addFeed(t) { this.feed.push(t); },
        surfaceAt: (x, z) => ({ h: Math.max(world.terrainHeight(x, z), 0) }),
        aircraft: [], ground: { targets: [] }, naval: { ships: [] }, player: null, pilotMode: null,
        effects: noopFx(),
        difficulty: { skill: 0.6, enemyMissileRate: 0.7 },
        weapons: {
            missiles: fired, addCrater() {}, worldBlast() {}, blastPeople() {},
            // a SAM launch: recorded (with where it left and what the launcher's W was)
            fireMissile(ac, target, kind) {
                const m = { owner: ac, target, kind, pos: new THREE.Vector3().copy(ac.pos), vel: new THREE.Vector3(), W: null, life: 0, t: g.time };
                fired.push(m);
                g.samLog.push(m);
                if (target && target.incoming) target.incoming.push(m);
                return m;
            },
        },
        isNeutral: () => false, lockTarget: null,
    };
    g.samLog = [];
    // an aircraft for the air defences to see: flies straight and level (pos, vel, team, incoming, lockedBy)
    g.addJet = (x, y, z, vx = 0, vz = 0, team = 'blue') => {
        const a = { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(vx, 0, vz), team, alive: true, onGround: false, incoming: [], hitRadius: 8, name: 'JET',
            update(dt) { this.pos.addScaledVector(this.vel, dt); } };
        g.aircraft.push(a);
        return a;
    };
    g.war = new W.War(g);
    g.war.start(g.mode);
    g.strikes = new S.StrikeManager(g);
    g.strikes.enabled = true;
    g.forces = new F.MobileForces(g);
    g.forces.start(g.mode, {});
    // advance the world by dt (war time, strikes, forces)
    g.step = (dt = 1 / 30) => {
        g.time += dt;
        g.war.time += dt;
        for (const a of g.aircraft) { if (a.lockedBy) a.lockedBy.clear(); if (a.update) a.update(dt); }
        g.strikes.update(dt);
        g.forces.update(dt);
    };
    g.run = (secs, dt = 1 / 20, until = null) => {
        for (let t = 0; t < secs; t += dt) { g.step(dt); if (until && until()) return t; }
        return secs;
    };
    return g;
}

export { THREE, W, S, F, world };

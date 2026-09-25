// Headless aircraft for flight-model tests: a stub game (no scene, no effects, nothing to hit unless a
// surface is given) and small helpers to fly the real Aircraft.updateFlight.
import { src } from './setup.mjs';

const THREE = await import('three');
const { Aircraft } = await src('aircraft.js');

export const soundSpeed = (h) => 340 - Math.max(h, 0) * 0.004; // same as aircraft.js

export function stubGame(extra = {}) {
    const g = {
        scene: { add() {}, remove() {} },
        events: { emit() {} },
        settings: { fuel: false },
        audio: { tick() {}, say() {} },
        effects: null,
        world: null,
        wind: null,
        time: 0,
        aircraft: [],
        difficulty: { skill: 0.6, dmgTaken: 1, enemyMissileRate: 0.7 },
        addFeed() {},
        runway: false, // true: a flat runway at h = 0 everywhere; false: nothing to hit
        surfaceAt: () => (g.runway ? { h: 0, runway: true } : { h: -1e6 }),
        ...extra,
    };
    return g;
}

export function makeAircraft(typeId, { game = stubGame(), team = 'blue', isPlayer = false, alt = 3000, speedFrac = 0.6, heading = 0 } = {}) {
    const ac = new Aircraft(game, typeId, { team, isPlayer });
    ac.spawnAir(new THREE.Vector3(0, alt, 0), heading, speedFrac);
    game.aircraft.push(ac);
    return ac;
}

// Level flight at `alt`, heading -Z: after every step the state is re-levelled (and optionally the
// speed pinned), so what's left is the thrust − drag balance with 1 G of lift.
export function levelFlight(ac, alt, V0, throttle = 1) {
    ac.pos.set(0, alt, 0);
    ac.qv.identity();
    ac.vel.set(0, 0, -V0);
    ac.speed = V0;
    ac.alpha = 0.03; ac.beta = 0; ac.rollRate = 0;
    ac.throttle = throttle;
    ac.onGround = false; ac.gear = false; ac.gearAnim = 0; ac.flaps = 0; ac.flapAnim = 0;
    Object.assign(ac.controls, { pitch: 0, roll: 0, yaw: 0, throttle });
    return {
        step(dt, holdV = null) {
            ac.updateFlight(dt);
            const V = holdV ?? ac.vel.length();
            ac.vel.set(0, 0, -V);
            ac.speed = V;
            ac.qv.identity();
            ac.pos.set(0, alt, 0);
        },
    };
}

// Heading (rad, 0 = -Z, + = left like spawnAir) and flight-path angle of the velocity vector
export function pathAngles(ac) {
    const v = ac.vel, h = Math.hypot(v.x, v.z);
    return { heading: Math.atan2(-v.x, -v.z), gamma: Math.atan2(v.y, h) };
}

export { THREE };

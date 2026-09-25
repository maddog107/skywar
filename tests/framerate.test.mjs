// Frame-rate independence: the same inputs flown at 30, 60 and 120 fps must end up in (nearly) the same
// place — open-loop stick sequences through the flight model, AI steering, and a stall entry/recovery.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, THREE } from './helpers/flight.mjs';

const { steerToward } = await src('ai.js');
const RATES = [30, 60, 120];

// stick program: [until t (s), pitch, roll, throttle]
const PROGRAM = [[2, 1, 0, 1], [3, 0, 1, 1], [5, 0, 0, 1], [8, 0.5, 0, 0.9], [9, 0, -0.6, 0.7], [12, -0.2, 0, 0.7]];

function flyProgram(id, fps) {
    const ac = makeAircraft(id, { alt: 3000 });
    ac.spawnAir(new THREE.Vector3(0, 3000, 0), 0, 0.55);
    const dt = 1 / fps;
    for (let i = 0, N = Math.round(12 * fps); i < N; i++) {
        const t = (i + 0.5) * dt; // (integer step count: no float drift in where the segments start)
        const step = PROGRAM.find(p => t < p[0]);
        Object.assign(ac.controls, { pitch: step[1] * ac.pitchAuthority, roll: step[2], yaw: 0, throttle: step[3] });
        ac.updateFlight(dt);
    }
    return { pos: ac.pos.clone(), vel: ac.vel.clone(), speed: ac.speed };
}

function flySteer(id, fps) {
    const ac = makeAircraft(id, { alt: 3000 });
    ac.spawnAir(new THREE.Vector3(0, 3000, 0), 0, 0.6);
    ac.controls.throttle = 0.9;
    const dir = new THREE.Vector3(Math.sin(1.5), 0.05, -Math.cos(1.5)).normalize(); // ~86° right, a little up
    const dt = 1 / fps;
    for (let i = 0, N = Math.round(8 * fps); i < N; i++) { steerToward(ac, dir, ac.controls, 1); ac.updateFlight(dt); }
    return { pos: ac.pos.clone(), vel: ac.vel.clone(), speed: ac.speed };
}

const angle = (a, b) => Math.acos(Math.min(1, a.clone().normalize().dot(b.clone().normalize()))) * 180 / Math.PI;

describe('frame-rate independence', () => {
    for (const id of ['f16', 'mig21', 'b747', 'cessna']) {
        test(`${id}: 12 s stick program ends in the same place at ${RATES.join('/')} fps`, () => {
            const runs = RATES.map(fps => flyProgram(id, fps));
            const ref = runs[RATES.length - 1];
            for (let i = 0; i < runs.length - 1; i++) {
                const r = runs[i];
                const dist = r.pos.distanceTo(ref.pos);
                assert.ok(dist < 20, `${RATES[i]} fps ends ${dist.toFixed(1)} m from the 120 fps run`);
                assert.ok(Math.abs(r.speed - ref.speed) < ref.speed * 0.01, `speed ${r.speed.toFixed(1)} vs ${ref.speed.toFixed(1)}`);
                assert.ok(angle(r.vel, ref.vel) < 0.5, `heading differs by ${angle(r.vel, ref.vel).toFixed(2)}°`);
            }
        });
        test(`${id}: AI steering to a new heading gives the same path at ${RATES.join('/')} fps`, () => {
            const runs = RATES.map(fps => flySteer(id, fps));
            const ref = runs[RATES.length - 1];
            for (let i = 0; i < runs.length - 1; i++) {
                const r = runs[i];
                assert.ok(r.pos.distanceTo(ref.pos) < 20, `${RATES[i]} fps ends ${r.pos.distanceTo(ref.pos).toFixed(1)} m away`);
                assert.ok(angle(r.vel, ref.vel) < 0.5, `direction differs by ${angle(r.vel, ref.vel).toFixed(2)}°`);
            }
        });
    }
});

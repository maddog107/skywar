// Stall behaviour: types without an AoA limiter stall when pulled for more lift than the wing has
// (lift loss, a dropped wing, the STALL warning) and recover as soon as the stick is eased; fly-by-wire
// types hold max AoA instead. Normal hard turns (the player's full stick above ~1.3x the stall speed)
// never stall.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, THREE } from './helpers/flight.mjs';

const { refSpeeds } = await src('aircraft.js');
const ALT = 3000;
const bankOf = (ac) => {
    const r = new THREE.Vector3(1, 0, 0).applyQuaternion(ac.qv), u = new THREE.Vector3(0, 1, 0).applyQuaternion(ac.qv);
    return Math.atan2(-r.y, u.y) * 180 / Math.PI;
};

// Fly at vFrac x the 1-G stall speed with the player's full back stick (pitch scaled by pitchAuthority,
// as game.js does) for `hold` s, then centre the stick for `after` s.
function pullTest(id, vFrac, { hold = 3, after = 3, dt = 1 / 60, seed = 0, throttle = 0.5 } = {}) {
    const ac = makeAircraft(id, { alt: ALT });
    const vs = refSpeeds(ac.spec).stall / Math.sqrt(Math.exp(-ALT / 9000));
    ac.spawnAir(new THREE.Vector3(0, ALT, 0), 0, vs * vFrac / ac.spec.flight.speed);
    ac.rollRate = seed; // tiny asymmetry decides which wing drops
    ac.controls.throttle = throttle; ac.throttle = throttle;
    const r = { maxDepth: 0, maxBank: 0, warned: false, minCl: Infinity, endDepth: 0, endAlphaRatio: 0, finite: true };
    for (let t = 0; t < hold + after; t += dt) {
        ac.controls.pitch = t < hold ? ac.pitchAuthority : 0;
        ac.controls.roll = 0;
        ac.updateFlight(dt);
        if (t < hold) {
            r.maxDepth = Math.max(r.maxDepth, ac.stallDepth);
            r.maxBank = Math.max(r.maxBank, Math.abs(bankOf(ac)));
            if (ac.stallDepth > 0) r.warned = r.warned || ac.stalling;
        }
        if (![ac.pos.x, ac.pos.y, ac.vel.x, ac.vel.y, ac.alpha].every(Number.isFinite)) r.finite = false;
    }
    r.endDepth = ac.stallDepth;
    r.endAlphaRatio = ac.alpha / ac.alphaMax;
    return r;
}

describe('stall', () => {
    for (const id of ['mig21', 'f4', 'f14', 'cessna', 'pitts']) {
        test(`${id}: pulled at the stall speed it stalls (lift loss, a wing drops, STALL warning) and recovers when the stick is eased`, () => {
            const r = pullTest(id, 1.0, { seed: 0.01 });
            assert.ok(r.finite, 'state stays finite');
            assert.ok(r.maxDepth > 0.15, `post-stall depth ${r.maxDepth.toFixed(2)}`);
            assert.ok(r.maxBank > 2, `wing drop ${r.maxBank.toFixed(1)}°`);
            assert.ok(r.warned, 'STALL warning while stalled');
            assert.equal(r.endDepth, 0, 'unstalled after the stick is eased');
            assert.ok(r.endAlphaRatio <= 1.0001, `AoA back within limits (${r.endAlphaRatio.toFixed(2)})`);
        });
        test(`${id}: a full-stick turn at 1.4x the stall speed stays out of the stall`, () => {
            const r = pullTest(id, 1.4, { hold: 2, after: 0.5 });
            assert.equal(r.maxDepth, 0, `depth ${r.maxDepth}`);
        });
    }
    for (const id of ['f16', 'f22', 'su57', 'fa18']) {
        test(`${id} (AoA limiter): lift saturates at max AoA, no post-stall`, () => {
            const r = pullTest(id, 1.0);
            assert.ok(r.finite);
            assert.equal(r.maxDepth, 0);
            assert.ok(r.endAlphaRatio <= 1.0001);
        });
    }
});

// Autopilot auto-landing at the home runway, headless (real Aircraft + Autopilot over the real terrain):
// every kind of type gets down on the runway, softly, in reasonable time — including a slow type that
// arrives high and close, and a heavy that has to come round over the hills — at any frame rate.
import './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runAutoland } from './helpers/autoland.mjs';

const CASES = [
    // [type, start, time limit (s)]
    ['f16', { along: 9000, height: 600 }, 200],
    ['f16', { along: 2500, height: 1800, headingOff: Math.PI }, 250],
    ['cessna', { along: 2500, height: 1800 }, 300],
    ['cessna', { along: 2500, lateral: 2500, height: 1800, headingOff: 1.57 }, 300],
    ['cessna', { along: 4000, lateral: 3000, height: 900, headingOff: 3 }, 300],
    ['b747', { along: 8000, height: 700 }, 200],
    ['b747', { along: 3000, lateral: 4000, height: 2500, headingOff: 1.5 }, 300],
    ['b737', { along: 8000, height: 700 }, 200],
    ['c130', { along: 10000, height: 800 }, 250],
    ['c130', { along: 2500, height: 1800, headingOff: Math.PI }, 300],
    ['a10', { along: 9000, height: 700 }, 250],
    ['mig25', { along: 8000, height: 1500 }, 200],
    ['pitts', { along: 5000, height: 500 }, 250],
];

describe('auto-land', () => {
    for (const [id, start, limit] of CASES) {
        test(`${id} from ${JSON.stringify(start)}: lands on the runway within ${limit} s, touchdown under 2 m/s`, () => {
            const r = runAutoland(id, { ...start, maxT: limit + 30 });
            assert.ok(!r.crashed, `crashed (${r.g.autopilot.status})`);
            assert.ok(r.landed, `not down after ${r.t.toFixed(0)} s (${r.g.autopilot.phase}: ${r.g.autopilot.status})`);
            assert.ok(r.t < limit, `took ${r.t.toFixed(0)} s`);
            assert.ok(r.onRunway, 'touched down off the runway');
            assert.ok(r.td.vs > -2, `touchdown sink ${(-r.td.vs).toFixed(2)} m/s (${(-r.td.vs * 196.85).toFixed(0)} fpm)`);
        });
    }

    test('the same landing at 30 and 120 fps', () => {
        const a = runAutoland('cessna', { along: 6000, height: 600, dt: 1 / 30, maxT: 330 });
        const b = runAutoland('cessna', { along: 6000, height: 600, dt: 1 / 120, maxT: 330 });
        assert.ok(a.landed && b.landed);
        assert.ok(Math.abs(a.t - b.t) < a.t * 0.08, `${a.t.toFixed(0)} s vs ${b.t.toFixed(0)} s`);
        assert.ok(Math.abs(a.td.vs - b.td.vs) < 0.5, `touchdown ${a.td.vs.toFixed(2)} vs ${b.td.vs.toFixed(2)} m/s`);
    });
});

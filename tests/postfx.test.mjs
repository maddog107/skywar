import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { DynamicResolution, QUALITY } = await src('postfx.js');

// Drive the adaptive-resolution controller with a synthetic GPU: gpu ms = fixed + perPx · pr², frames
// quantised to a 60 Hz vsync, deterministic noise. Returns the final pixel ratio and every change.
function simulate({ fixed, perPx, cpu = 6, seconds = 120, timer = true, timerScale = 1, hz = 60, levels = [2, 1.75, 1.5, 1.334, 1.2, 1], start = 1 }) {
    let pr = 0, seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const d = new DynamicResolution((p) => { pr = p; });
    d.configure(levels, start, true);
    const vsync = 1000 / hz, changes = [];
    let t = 0, last = pr;
    while (t < seconds * 1000) {
        const gpu = (fixed + perPx * pr * pr) * (0.95 + rnd() * 0.1);
        const frame = Math.ceil(Math.max(cpu, gpu) / vsync - 1e-6) * vsync;
        d.update(frame / 1000, timer ? gpu * timerScale : -1);
        t += frame;
        if (pr !== last) { changes.push([+(t / 1000).toFixed(1), pr]); last = pr; }
    }
    return { pr, changes };
}
// the highest level whose GPU time fits the 60 fps budget (with the controller's 10 % margin)
const fitting = (fixed, perPx, levels = [2, 1.75, 1.5, 1.334, 1.2, 1]) => levels.find(p => fixed + perPx * p * p <= 1000 / 60 * 0.9) ?? levels[levels.length - 1];

describe('DynamicResolution', () => {
    test('light scene: climbs to the top level and stays there', () => {
        const r = simulate({ fixed: 2, perPx: 2.5 });
        assert.equal(r.pr, 2);
        assert.ok(r.changes.length <= 2, JSON.stringify(r.changes));
    });

    for (const [name, fixed, perPx] of [['heavy', 3, 5], ['very heavy', 4, 7.5], ['borderline', 3, 4.3]]) {
        test(`${name} scene: settles at the level that fits and doesn't thrash`, () => {
            const r = simulate({ fixed, perPx, seconds: 600 });
            assert.ok(r.pr <= fitting(fixed, perPx) + 1e-9, `final ${r.pr}, fits ${fitting(fixed, perPx)}`);
            // failed probes back off exponentially and stop once the GPU timer has been right twice
            assert.ok(r.changes.length <= 8, JSON.stringify(r.changes));
            assert.ok(r.changes.filter(c => c[0] > 120).length === 0, 'still changing after 2 min: ' + JSON.stringify(r.changes));
        });
    }

    test('CPU-bound frames never lower the resolution', () => {
        const r = simulate({ fixed: 2, perPx: 2, cpu: 20 });
        assert.equal(r.changes.length, 0, JSON.stringify(r.changes));
    });

    test('without a GPU timer it still holds 60 fps, probing up ever more rarely', () => {
        const r = simulate({ fixed: 3, perPx: 5, timer: false, seconds: 600 });
        assert.ok(r.pr <= fitting(3, 5) + 1e-9);
        const ups = r.changes.filter((c, i) => i > 0 && c[1] > r.changes[i - 1][1]).map(c => c[0]);
        assert.ok(ups.length <= 7, JSON.stringify(r.changes));
        assert.ok(ups[ups.length - 1] - ups[ups.length - 2] >= 150, 'probe interval should grow: ' + JSON.stringify(ups));
    });

    test('a GPU timer that reads 2x high only delays stepping up', () => {
        const r = simulate({ fixed: 2, perPx: 2.5, timerScale: 2, seconds: 180 });
        assert.equal(r.pr, 2);
    });

    test('quality presets: pixel-ratio range and features', () => {
        for (const [k, q] of Object.entries(QUALITY)) {
            assert.ok(q.floor <= q.pr && q.pr <= q.top, k);
        }
        assert.ok(QUALITY.ultra.ao && QUALITY.ultra.ssr && QUALITY.ultra.blur && QUALITY.ultra.msaa, 'ultra enables AO, SSR, blur, MSAA');
        assert.ok(!QUALITY.high.ao && !QUALITY.high.ssr && !QUALITY.high.blur && !QUALITY.high.msaa, 'high keeps its old cost');
        assert.ok(!QUALITY.low.flare && !QUALITY.low.dof, 'low stays lean');
    });
});

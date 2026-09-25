import { src } from './helpers/setup.mjs';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// The road network is generated from the seeded world, so these check the real layout.
describe('road network vs airbases', () => {
    let W, towns;
    before(async () => {
        const THREE = await import('three');
        W = await src('world.js');
        const { Towns } = await src('towns.js');
        towns = new Towns(new THREE.Scene(), { scene: new THREE.Scene(), refreshTrees() {}, setGroundConform() {} });
    });

    test('no road, street or dirt track crosses a runway', () => {
        const bad = [];
        const check = (label, pts) => {
            for (let k = 0; k + 1 < pts.length; k++) {
                const a = pts[k], b = pts[k + 1];
                for (let t = 0; t <= 1; t += 0.25) {
                    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
                    if (W.isOnRunway(x, z)) { bad.push(`${label} at ${Math.round(x)},${Math.round(z)}`); return; }
                }
            }
        };
        towns.paths.forEach((p, i) => check('road ' + i, p.pts));
        towns.streetPaths.forEach((p, i) => check('street ' + i, p.pts));
        (towns.dirtPaths || []).forEach((p, i) => check('dirt ' + i, p.pts));
        assert.deepEqual(bad, []);
    });

    test('every airbase gate is reached by a road', () => {
        for (const b of W.BASES) {
            const G = W.gateOf(b), g = W.baseToWorld(b, G.lx, G.lz);
            let best = Infinity;
            for (const p of towns.paths) for (const q of p.pts) best = Math.min(best, Math.hypot(q.x - g.x, q.z - g.z));
            assert.ok(best < 150, `${b.id}: nearest road ${Math.round(best)} m from the gate`);
        }
    });
});

import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const W = await src('world.js');
const { BASES, baseToWorld, worldToBase, runwayNumbers, runwayInfo, terrainHeight, groundHeight, isOnRunway } = W;

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

describe('base <-> world transforms', () => {
    for (const b of BASES) {
        test(`${b.id}: worldToBase(baseToWorld(p)) === p, and the base origin maps to (x, z)`, () => {
            const o = baseToWorld(b, 0, 0);
            close(o.x, b.x, 1e-9, 'origin x'); close(o.z, b.z, 1e-9, 'origin z');
            for (const [lx, lz] of [[0, 0], [100, 0], [0, 100], [-750, 1234.5], [2000, -3000], [-1e4, 7e3]]) {
                const w = baseToWorld(b, lx, lz);
                const l = worldToBase(b, w.x, w.z);
                close(l.lx, lx, 1e-6, 'lx'); close(l.lz, lz, 1e-6, 'lz');
                // rotation preserves distances
                close(Math.hypot(w.x - b.x, w.z - b.z), Math.hypot(lx, lz), 1e-6, 'distance');
            }
        });
    }
});

describe('runwayNumbers', () => {
    const DESIG = /^(0[1-9]|[12]\d|3[0-6])([LRC]?)$/;
    for (const b of BASES) {
        for (const [i, rw] of b.runways.entries()) {
            test(`${b.id} runway ${i}: valid 01-36 designators, reciprocal ends 18 apart, L/R only when parallel`, () => {
                const { toward, from } = runwayNumbers(b, rw);
                const ma = DESIG.exec(toward), mb = DESIG.exec(from);
                assert.ok(ma, `bad designator "${toward}"`); assert.ok(mb, `bad designator "${from}"`);
                const na = +ma[1], nb = +mb[1];
                assert.equal(((na - nb) % 36 + 36) % 36, 18, `${toward}/${from} are not reciprocal`);
                const parallels = b.runways.filter(o => Math.abs((o.rot || 0) - (rw.rot || 0)) < 0.05).length;
                if (parallels > 1) {
                    assert.ok(ma[2] && mb[2], `parallel runway without L/R: ${toward}/${from}`);
                    const opp = { L: 'R', R: 'L', C: 'C' };
                    assert.equal(mb[2], opp[ma[2]], `${toward}/${from}: the two ends should carry opposite L/R`);
                } else {
                    assert.equal(ma[2] + mb[2], '', `single runway should have no suffix: ${toward}/${from}`);
                }
            });
        }
        test(`${b.id}: no two runways share a designator`, () => {
            const all = b.runways.flatMap(rw => Object.values(runwayNumbers(b, rw)));
            assert.equal(new Set(all).size, all.length, all.join(' '));
        });
    }

    test('home base (heading 0) is 36/18', () => {
        const home = BASES.find(b => b.id === 'home');
        assert.deepEqual(runwayNumbers(home, home.runways[0]), { toward: '36', from: '18' });
    });
});

describe('terrain', () => {
    test('terrainHeight is finite and deterministic over a 60 km grid', () => {
        const hs = [];
        for (let x = -30000; x <= 30000; x += 1500) for (let z = -30000; z <= 30000; z += 1500) {
            const h = terrainHeight(x, z);
            assert.ok(Number.isFinite(h), `h(${x}, ${z}) = ${h}`);
            assert.equal(terrainHeight(x, z), h, 'deterministic');
            hs.push(h);
        }
        const min = Math.min(...hs), max = Math.max(...hs);
        assert.ok(min < 0, 'some sea'); assert.ok(max > 100, 'some hills');
        assert.ok(min > -400 && max < 4000, `plausible range ${min.toFixed(0)}..${max.toFixed(0)}`);
    });

    test('groundHeight never goes below sea level', () => {
        for (let x = -30000; x <= 30000; x += 3000) for (let z = -30000; z <= 30000; z += 3000) assert.ok(groundHeight(x, z) >= 0);
    });

    for (const b of BASES) {
        test(`${b.id}: airfield is flattened to the base height and each runway centre is on a runway`, () => {
            close(terrainHeight(b.x, b.z), b.h, 0.01, 'base centre height');
            for (const rw of b.runways) {
                const ri = runwayInfo(b, rw);
                close(terrainHeight(ri.x, ri.z), b.h, 0.5, 'runway centre height');
                // both ends of the runway too
                for (const s of [-0.95, 0.95]) {
                    const x = ri.x + ri.dirX * ri.half * s, z = ri.z + ri.dirZ * ri.half * s;
                    close(terrainHeight(x, z), b.h, 0.5, `runway end ${s}`);
                    assert.equal(isOnRunway(x, z), b, `runway end ${s} not on runway`);
                }
                assert.equal(isOnRunway(ri.x, ri.z), b);
                // 200 m off to the side is not runway (only checkable where there's a single runway)
                if (b.runways.length === 1) assert.equal(isOnRunway(ri.x - ri.dirZ * 200, ri.z + ri.dirX * 200), null);
            }
        });
    }
});

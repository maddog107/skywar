import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { pickConvoyBridge } = await src('convoy.js');

// shape used by pickConvoyBridge: a road path with total length, the bridge's span along it
// (s0..s1), world position and length
const bridge = (s0, s1, pathLen, x = 3000, z = 2000, len = s1 - s0) => ({ path: { len: pathLen }, s0, s1, pos: { x, z }, len });

describe('pickConvoyBridge', () => {
    test('empty / missing list returns null without throwing', () => {
        assert.equal(pickConvoyBridge([]), null);
        assert.equal(pickConvoyBridge(undefined), null);
        assert.equal(pickConvoyBridge(null), null);
    });

    test('bridges without a road path are ignored', () => {
        assert.equal(pickConvoyBridge([{ s0: 5000, s1: 5350, pos: { x: 0, z: 0 }, len: 350 }]), null);
    });

    test('rejects bridges with too little road either side', () => {
        // 1000 m of road each side: not enough approach (needs 1200 up, 300 down) in either direction
        assert.equal(pickConvoyBridge([bridge(1000, 1350, 2350)]), null);
    });

    test('returns {br, dir, upstream} for a usable bridge, approaching from the side with road', () => {
        const br = bridge(5000, 5350, 5700); // 5000 m of road before s0, 350 m after s1
        for (let i = 0; i < 20; i++) {
            const p = pickConvoyBridge([br]);
            assert.ok(p, 'a bridge');
            assert.equal(p.br, br);
            assert.equal(p.dir, 1);
            assert.equal(p.upstream, 5000);
        }
        const rev = bridge(350, 700, 6000); // road is after the bridge: convoy comes the other way
        const p = pickConvoyBridge([rev]);
        assert.equal(p.dir, -1);
        assert.equal(p.upstream, 6000 - 700);
    });

    test('picks among the three best-scoring options', () => {
        // same road; bridge length far from the ideal 350 m costs score
        const good = [bridge(5000, 5350, 9000), bridge(5000, 5360, 9000), bridge(5000, 5340, 9000)];
        const bad = [bridge(5000, 6500, 9000), bridge(5000, 7000, 9000)];
        // make the good ones one-directional so there are exactly 3 top options
        for (const b of good) b.path.len = b.s1 + 400;
        const seen = new Set();
        for (let i = 0; i < 200; i++) {
            const p = pickConvoyBridge([...bad, ...good]);
            assert.ok(good.includes(p.br), 'picked a poorly scored bridge');
            seen.add(p.br);
        }
        assert.equal(seen.size, 3, 'randomises among the top three');
    });

    test('tolerates a list mixing valid and invalid entries', () => {
        const ok = bridge(5000, 5350, 5700);
        const p = pickConvoyBridge([{}, { path: null }, ok]);
        assert.equal(p.br, ok);
    });
});

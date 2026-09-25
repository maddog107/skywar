// segmentModel cuts a model into detachable regions by triangle centroid. regionOf() itself is
// not exported, so it's tested through segmentModel on a hand-built mesh (no WebGL needed).
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const { segmentModel, REGIONS } = await src('damage.js');

const L = 10; // aircraft length; W = max(0.085 L, 1) = 1, wing edge = max(1.7, 0.42 * half-span)

// one small triangle centred on (x, z)
const tri = (x, z, y = 0) => [x - 0.1, y, z - 0.1, x + 0.1, y, z - 0.1, x, y, z + 0.2]; // centroid exactly (x, z)

function model(centres) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(centres.flatMap(([x, z]) => tri(x, z)), 3));
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
    return g;
}

function regionsOf(out) {
    const r = {};
    for (const g of out.children) {
        let n = 0;
        g.traverse(o => { if (o.isMesh) n += o.geometry.attributes.position.count / 3; });
        r[g.userData.region] = n;
    }
    return r;
}

describe('segmentModel region bucketing', () => {
    test('nose / tail / wings / centre split by triangle position', () => {
        // half-span 5 -> wing edge max(1.7, 2.1) = 2.1
        const out = segmentModel(model([
            [0, -4.5],            // nose (z < -0.24 L)
            [0, 4.5],             // tail (z > 0.28 L)
            [-4.9, 0], [-3, 1],   // left wing
            [4.9, 0], [3, -1],    // right wing
            [0, 0], [1.5, 0],     // centre (inside the wing edge)
            [4.9, -3.5],          // outboard but ahead of the wing box -> nose
        ]), L);
        assert.deepEqual(regionsOf(out), { nose: 2, tail: 1, wingL: 2, wingR: 2, center: 2 });
        for (const g of out.children) assert.ok(REGIONS.includes(g.userData.region));
    });

    test('empty regions are left out', () => {
        const out = segmentModel(model([[0, 0], [0, 0.5]]), L);
        assert.deepEqual(regionsOf(out), { center: 2 });
    });

    test('pieces keep their world position (group pivot + local geometry)', () => {
        const pts = [[0, -4.5], [4.9, 0], [0, 4.5]];
        const out = segmentModel(model(pts), L);
        out.updateMatrixWorld(true);
        const got = [];
        const v = new THREE.Vector3();
        out.traverse(o => {
            if (!o.isMesh) return;
            const p = o.geometry.attributes.position;
            for (let i = 0; i < p.count; i += 3) {
                let cx = 0, cz = 0;
                for (let k = 0; k < 3; k++) { v.fromBufferAttribute(p, i + k).applyMatrix4(o.matrixWorld); cx += v.x / 3; cz += v.z / 3; }
                got.push([+cx.toFixed(4), +cz.toFixed(4)]);
            }
        });
        const sort = (a) => [...a].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
        assert.deepEqual(sort(got), sort(pts));
    });

    test('mesh transforms are applied before bucketing', () => {
        // a triangle at the origin, moved into the nose by its mesh position
        const g = model([[0, 0]]);
        g.children[0].position.set(0, 0, -4.5);
        assert.deepEqual(regionsOf(segmentModel(g, L)), { nose: 1 });
    });
});

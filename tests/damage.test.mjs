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

// The Soviet and Chinese jets' model files (the manilov.ap MiG-21 / -25 / -31 imports, the kit-built J-8II / J-10A
// / J-20), loaded and normalised as the game does (tests/helpers/aircraftmodel.mjs): their MODEL_FILES rig points,
// textured paint, budget and real proportions, and how segmentModel cuts them up
describe('models: the Soviet and Chinese jets', async () => {
    const { loadAircraft, triangleCount } = await import('./helpers/aircraftmodel.mjs');
    const IDS = ['mig21', 'mig25', 'mig31', 'j8', 'j10', 'j20'];
    const engines = { mig21: 1, mig25: 2, mig31: 2, j8: 2, j10: 1, j20: 2 };
    const ray = new THREE.Raycaster();
    const hitWithin = (root, from, dir, dist) => { ray.set(from, dir); ray.far = dist; return ray.intersectObject(root, true).length > 0; };

    for (const id of IDS) {
        test(`${id}: one textured skin liveries repaint, a trim atlas they leave alone, glass; within the triangle budget`, async () => {
            const { json, holder } = await loadAircraft(id);
            const mats = json.materials.map(m => m.name);
            const skin = json.materials.find(m => m.name === 'Skin');
            assert.ok(skin && skin.pbrMetallicRoughness.baseColorTexture, 'a textured Skin material');
            assert.ok(json.materials.find(m => /trim/i.test(m.name)), 'a Nozzle_Trim atlas (models.js applyLivery skips "nozzle")');
            assert.ok(json.materials.some(m => m.alphaMode === 'BLEND'), 'see-through canopy glass');
            assert.ok(mats.length <= 5, `few materials, few draw calls (${mats})`);
            assert.ok((json.images || []).length <= 3, 'one or two atlases');
            const tris = triangleCount(holder);
            assert.ok(tris > 12000 && tris < 60000, `${tris} triangles`);
        });

        test(`${id}: real length and span, nozzles at the tail, the eye under the canopy`, async () => {
            const { holder, info, spec } = await loadAircraft(id);
            const L = spec.length;
            const box = new THREE.Box3().setFromObject(holder), size = box.getSize(new THREE.Vector3());
            assert.ok(Math.abs(size.z - L) < 1e-6, 'scaled to its real length');
            assert.ok(Math.abs(size.x / spec.span - 1) < 0.05, `span ${size.x.toFixed(2)} m vs ${spec.span} m`);
            assert.equal(info.nozzles.length, engines[id], 'one nozzle per engine');
            for (const [x, y, z] of info.nozzles) {
                assert.ok(z * L > box.max.z - 0.12 * L && z * L < box.max.z + 1e-6, `nozzle at the tail (z ${(z * L).toFixed(2)} of ${box.max.z.toFixed(2)})`);
                assert.ok(Math.abs(x) < 0.06 && y * L > box.min.y && y * L < box.max.y, 'nozzle on the fuselage');
                // the exhaust is open: looking forward from just behind it, the nozzle's own walls are there
                assert.ok(hitWithin(holder, new THREE.Vector3(x * L, y * L, z * L + 0.5), new THREE.Vector3(0, 0, -1), 4), 'a nozzle there');
            }
            const eye = new THREE.Vector3(0, info.cockpit[0] * L, info.cockpit[1] * L);
            assert.ok(eye.z < -0.15 * L && eye.z > -0.33 * L, 'the cockpit in the forward fuselage');
            assert.ok(hitWithin(holder, eye, new THREE.Vector3(0, 1, 0), 1.2), 'the canopy just above the eye');
            assert.ok(hitWithin(holder, eye, new THREE.Vector3(0, -1, 0), 2.0), 'the cockpit floor below it');
        });

        test(`${id}: segmentModel finds a nose, a tail, a centre and two matching wings`, async () => {
            const { holder, spec } = await loadAircraft(id);
            const r = regionsOf(segmentModel(holder, spec.length));
            for (const k of REGIONS) assert.ok(r[k] > 50, `${k}: ${r[k]} triangles`);
            assert.ok(Math.abs(r.wingL - r.wingR) <= 0.15 * Math.max(r.wingL, r.wingR), `wings alike (${r.wingL} / ${r.wingR})`);
        });
    }
});

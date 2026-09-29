// Welding (meshmerge.js weldGeometry, models.js weldModel): duplicate vertices shared through an index must draw
// exactly what the triangle soup drew, and a welded aircraft skin must cut its flaps the same as the soup.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const { weldGeometry, mergeWelded, mergeStaticModel } = await src('meshmerge.js');
const { weldModel } = await src('models.js');
const { segmentModel } = await src('damage.js');
const S = await src('surfaces.js');
const D = await src('surfacedefs.js');

// every triangle's vertices, all attributes, in draw order
function soup(geo) {
    const idx = geo.index, n = idx ? idx.count : geo.attributes.position.count, out = [];
    for (let k = 0; k < n; k++) {
        const i = idx ? idx.getX(k) : k;
        for (const name of Object.keys(geo.attributes).sort()) { const a = geo.attributes[name]; for (let c = 0; c < a.itemSize; c++) out.push(a.getComponent(i, c)); }
    }
    return out;
}

describe('weldGeometry', () => {
    test('a box soup: the same triangles in the same order, a fraction of the vertices, a 16-bit index', () => {
        const box = new THREE.BoxGeometry(2, 1, 3, 4, 2, 3).toNonIndexed();
        const w = weldGeometry(box);
        assert.ok(w.index, 'indexed');
        assert.ok(w.index.array instanceof Uint16Array);
        assert.deepEqual(soup(w), soup(box));
        assert.ok(w.attributes.position.count <= box.attributes.position.count / 2.5, `${w.attributes.position.count} of ${box.attributes.position.count}`);
    });
    test('vertices that differ in any attribute stay apart (hard edges, uv seams)', () => {
        const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); // each corner is 3 vertices: 3 normals
        const w = weldGeometry(box);
        assert.equal(w.attributes.position.count, 24);
    });
    test('groups, draw range and an existing index are kept', () => {
        const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2);
        const w = weldGeometry(g);
        assert.deepEqual(w.groups.map(x => [x.start, x.count, x.materialIndex]), g.groups.map(x => [x.start, x.count, x.materialIndex]));
        assert.deepEqual(soup(w), soup(g));
    });
    test('morph targets are left alone', () => {
        const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
        g.morphAttributes.position = [g.attributes.position.clone()];
        assert.equal(weldGeometry(g), g);
    });
    test('mergeWelded: indexed and non-indexed parts together', () => {
        const a = new THREE.BoxGeometry(1, 1, 1), b = new THREE.SphereGeometry(1, 8, 6).toNonIndexed();
        for (const k of ['uv']) { a.deleteAttribute(k); b.deleteAttribute(k); }
        const m = mergeWelded([a, b]);
        assert.deepEqual(soup(m), [...soup(a), ...soup(b)]);
    });
    test('mergeStaticModel output is indexed and draws the source meshes', () => {
        const g = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ color: 0x808080 });
        for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 2, 2, 2), mat); m.position.x = i * 2; g.add(m); }
        const out = mergeStaticModel(g);
        const meshes = out.children.filter(o => o.isMesh);
        assert.equal(meshes.length, 1);
        assert.ok(meshes[0].geometry.index);
        assert.equal(meshes[0].geometry.index.count, 4 * new THREE.BoxGeometry(1, 1, 1, 2, 2, 2).index.count);
    });
});

describe('welded aircraft skins and surfaces', () => {
    const L = 10;
    D.SURFACE_DEFS.__weld = {
        flaps: [{ top: [[0.2, 0.14], [0.45, 0.14], [0.45, 0.25], [0.2, 0.25]], y: [-0.05, 0.05], hinge: [[0.2, 0.02, 0.14], [0.45, 0.02, 0.14]], angle: 30 }],
    };
    const model = () => {
        const g = new THREE.Group();
        const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 2, 12, 1, 4), new THREE.MeshStandardMaterial());
        wing.position.set(0, 0, 1);
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 10, 2, 2, 10), new THREE.MeshStandardMaterial());
        g.add(wing, body);
        return segmentModel(g, L);
    };
    // world-space triangles of the airframe and of each surface pivot, sorted (order-free comparison)
    const tris = (obj) => {
        obj.updateMatrixWorld(true);
        const out = [], v = new THREE.Vector3();
        obj.traverse(o => {
            if (!o.isMesh || o.userData.surfaceWell) return;
            const g = o.geometry, idx = g.index, n = idx ? idx.count : g.attributes.position.count;
            for (let k = 0; k < n; k++) { v.fromBufferAttribute(g.attributes.position, idx ? idx.getX(k) : k).applyMatrix4(o.matrixWorld); out.push(v.toArray().map(x => x.toFixed(4)).join(',')); }
        });
        return out.sort();
    };
    test('cutting a welded model gives the soup\'s cut, and welding it again keeps it', () => {
        const a = model(), b = model();
        weldModel(b);
        b.traverse(o => { if (o.isMesh) assert.ok(o.geometry.index); });
        assert.equal(S.cutSurfaces(a, '__weld', L), 2);
        assert.equal(S.cutSurfaces(b, '__weld', L), 2);
        assert.deepEqual(tris(b), tris(a));
        weldModel(b);
        assert.deepEqual(tris(b), tris(a));
        let flaps = 0; b.traverse(o => { if (o.userData.surface) flaps++; });
        assert.equal(flaps, 2);
    });
    test('meshes the region never reaches stay welded', () => {
        const b = model();
        weldModel(b);
        S.cutSurfaces(b, '__weld', L);
        let welded = 0; b.traverse(o => { if (o.isMesh && o.geometry.index && o.userData.welded) welded++; });
        assert.ok(welded > 0);
    });
});

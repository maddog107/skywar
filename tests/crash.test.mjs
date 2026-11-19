// A jet going into the ground (damage.js Wreckage.scatter): its sections are thrown on along its path, bounce, slide
// to a stop strung out ahead of the impact (a debris field), lie on the ground (never under it) and burn under smoke
// columns; the heavy centre section digs a crater where it first hits; a war's worth of wrecks is capped. Headless: the
// real segmentModel and Wreckage on a stub game (flat ground, effects counted).
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const { segmentModel, Wreckage, REGIONS } = await src('damage.js');

const L = 15;
const tri = (x, z) => [x - 0.1, 0, z - 0.1, x + 0.1, 0, z - 0.1, x, 0, z + 0.2];

function stubGame(groundAt = () => 0) {
    const n = { columns: 0, craters: 0, sparks: 0, impacts: 0 };
    const sys = { emit: () => { n.sparks++; } };
    const scene = new THREE.Scene();
    return {
        n, scene, time: 0,
        camera: { position: new THREE.Vector3(0, 100, 300) },
        wind: new THREE.Vector3(),
        surfaceAt: (x, z) => ({ h: groundAt(x, z), water: false }),
        weapons: { addCrater: () => { n.craters++; } },
        effects: {
            sparks: sys, smoke: sys, puffSmoke() {}, puffFire() {}, explosion() {}, waterSplash() {},
            groundImpact: () => { n.impacts++; }, smokeColumn: () => { n.columns++; },
        },
        events: { emit() {} },
    };
}

// a stand-in for an Aircraft: the real region groups under its root, flying `vel` at `pos`
function jet(game, pos, vel) {
    const geo = new THREE.BufferGeometry();
    const centres = [[0, -6], [0, -5], [-6, 0], [-5, 1], [6, 0], [5, 1], [0, 0], [1, 1], [0, 6], [0, 5.5]];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(centres.flatMap(([x, z]) => tri(x, z)), 3));
    const holder = new THREE.Group();
    holder.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
    const model = segmentModel(holder, L);
    const root = new THREE.Group();
    root.add(model);
    root.position.copy(pos);
    game.scene.add(root);
    root.updateMatrixWorld(true);
    const regions = {};
    for (const g of model.children) regions[g.userData.region] = g;
    return { pos: pos.clone(), vel: vel.clone(), regions, lostRegions: new Set(), spec: { length: L, span: 10 }, root };
}

const run = (w, secs, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) w.update(dt); };

describe('crash: a debris field', () => {
    test('the sections are strewn on ahead of the impact and come to rest on the ground', () => {
        const g = stubGame();
        const w = new Wreckage(g);
        const v = new THREE.Vector3(-0.95, -0.3, 0).normalize().multiplyScalar(170);
        const ac = jet(g, new THREE.Vector3(0, 1, 0), v);
        w.scatter(ac);
        assert.equal(w.parts.length, REGIONS.length, 'every section thrown');
        run(w, 40);
        assert.ok(w.parts.every(p => p.resting), 'all at rest within 40 s');
        const xs = w.parts.map(p => p.obj.position.x);
        for (const p of w.parts) {
            assert.ok(p.obj.position.y >= 0, 'not under the ground');
            assert.ok(p.obj.position.y < 4, `lying on it (${p.obj.position.y.toFixed(1)} m)`);
        }
        assert.ok(xs.every(x => x < -10), `all thrown on along the path (${xs.map(x => x.toFixed(0)).join(', ')})`);
        const spread = Math.max(...xs) - Math.min(...xs), far = -Math.min(...xs);
        assert.ok(far > 60 && far < 900, `strewn out to ${far.toFixed(0)} m`);
        assert.ok(spread > 15, `over a field, not in one heap (${spread.toFixed(0)} m)`);
        assert.ok(g.n.columns >= 1, 'burning wrecks under smoke columns');
        assert.ok(g.n.impacts >= REGIONS.length, 'they bounce off the ground first');
        assert.ok(g.n.craters >= 1, 'the heavy centre section digs in');
    });

    test('straight down, they stay close to the hole', () => {
        const g = stubGame();
        const w = new Wreckage(g);
        const ac = jet(g, new THREE.Vector3(0, 1, 0), new THREE.Vector3(-8, -150, 0));
        w.scatter(ac);
        run(w, 30);
        for (const p of w.parts) assert.ok(Math.hypot(p.obj.position.x, p.obj.position.z) < 60, 'within 60 m');
    });

    test('a war leaves at most so many wrecks lying about', () => {
        const g = stubGame();
        const w = new Wreckage(g);
        for (let i = 0; i < 10; i++) {
            const ac = jet(g, new THREE.Vector3(i * 2000, 1, 0), new THREE.Vector3(-150, -40, 0));
            w.scatter(ac);
            run(w, 20);
        }
        const left = w.parts.filter(p => p.resting).length;
        assert.ok(left <= 31 && left >= 25, `${left} wrecks lying about`);
        // the oldest went first
        assert.ok(w.parts.every(p => p.obj.position.x > 2000 * 3), 'the first crashes cleared away');
        w.clear();
        assert.equal(w.parts.length, 0);
    });
});

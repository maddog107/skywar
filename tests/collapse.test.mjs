// Collapsing buildings (buildings.js + collapse.js): a destroyed building comes down storey by storey over a few
// seconds (longer for a taller one), throws its rubble out round its foot (most of it close in, the pieces resting on
// the ground where they land, a hillside's lower ground downhill), grows a heap on its footprint, and the next sortie
// puts it all back. Headless: a Buildings set with one box, no game (no particles), then a stub game for the effects.
import { src } from './helpers/setup.mjs';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const { Buildings, WORLD_BUILDINGS } = await src('buildings.js');
const { Chunks } = await src('collapse.js');

after(() => { WORLD_BUILDINGS.current = null; });

// a stub game: the effects the collapse calls (particles counted, not drawn), audio and the camera far away
function stubGame() {
    const emitted = { smoke: 0 };
    const sys = { emit: () => { emitted.smoke++; } };
    return {
        emitted,
        effects: { smoke: sys, explosion() {}, debrisBurst() {}, puffSmoke() {}, puffFire() {} },
        audio: { boom() {} },
        camera: { position: new THREE.Vector3(5000, 500, 5000) },
        addFeed() {}, shake: 0,
    };
}

function oneBuilding(ht = 30, w = 20, d = 16, groundAt = null) {
    const scene = new THREE.Scene();
    const bl = new Buildings(scene);
    if (groundAt) bl.groundAt = groundAt;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), 1);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([0.8, 0.7, 0.6]), 3);
    im.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(0, ht / 2, 0), new THREE.Quaternion(), new THREE.Vector3(w, ht, d)));
    scene.add(im);
    const b = bl.add({ x: 0, z: 0, y: 0, w, d, ht, yaw: 0.3, kind: 'apt' });
    bl.part(b, im, 0, 'wall');
    bl.index();
    return { bl, b, im };
}

const run = (bl, secs, dt = 1 / 60) => { for (let t = 0; t < secs; t += dt) bl.update(dt, null); };

describe('collapse: rubble pieces', () => {
    test('a thrown piece falls, bounces and comes to rest on the ground', () => {
        const C = new Chunks(new THREE.Scene(), 16);
        C.spawn(0, 20, 0, 6, 4, 0, 2, 0.4, 1.5, 0.7, 0.7, 0.7, 3, 3);
        let minY = Infinity;
        for (let i = 0; i < 600 && C.active; i++) { C.update(1 / 60); minY = Math.min(minY, C.p[1]); }
        assert.equal(C.active, 0, 'at rest within 10 s');
        assert.ok(minY >= 3, 'never below the ground it landed on');
        assert.ok(C.p[1] < 3.5, 'lying on it (a slab rests low)');
        assert.ok(C.p[0] > 5 && C.p[0] < 40, `came down a plausible distance out (${C.p[0].toFixed(1)} m)`);
    });

    test('the pool reuses the oldest pieces once full', () => {
        const C = new Chunks(new THREE.Scene(), 8);
        for (let i = 0; i < 20; i++) C.spawn(i, 5, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 1);
        assert.equal(C.mesh.count, 8);
        assert.ok(C.active <= 8);
        assert.equal(C.p[0], 16, 'slot 0 now holds the 17th piece');
    });
});

describe('collapse: a building coming down', () => {
    test('a taller building takes longer to come down, storey by storey', () => {
        const durs = [10, 30, 60].map(ht => {
            const { bl, b } = oneBuilding(ht);
            bl.destroy(b, null, null);
            return bl.collapsing[0].dur;
        });
        assert.ok(durs[0] < durs[1] && durs[1] < durs[2], durs.join(' < '));
        assert.ok(durs[0] > 1.5 && durs[2] < 8, `seconds, not instant or endless (${durs.map(d => d.toFixed(1)).join(', ')})`);
    });

    test('it sinks, sheds rubble round its foot, grows a heap and leaves a stub', () => {
        const { bl, b, im } = oneBuilding(30);
        const g = stubGame();
        bl.game = g;
        bl.destroy(b, g, null);
        const dur = bl.collapsing[0].dur, m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        run(bl, dur * 0.5);
        im.getMatrixAt(0, m); m.decompose(p, q, s);
        assert.ok(p.y < 15 - 0.5, 'half way through, it has sunk');
        assert.ok(bl.collapsing.length === 1, 'still coming down');
        run(bl, dur * 0.6 + 12);
        assert.equal(bl.collapsing.length, 0);
        im.getMatrixAt(0, m); m.decompose(p, q, s);
        assert.ok(s.y < 6, `the walls are a stub (${s.y.toFixed(1)} m)`);
        const C = bl.chunks;
        assert.ok(C.mesh.count >= 60, `rubble thrown (${C.mesh.count} pieces)`);
        assert.equal(C.active, 0, 'all of it at rest after a few seconds');
        const dist = [];
        for (let i = 0; i < C.mesh.count; i++) dist.push(Math.hypot(C.p[i * 3], C.p[i * 3 + 2]));
        dist.sort((a, c) => a - c);
        const median = dist[dist.length >> 1];
        assert.ok(median < 22, `most of it close round the foot (median ${median.toFixed(1)} m from the centre of a 20 x 16 m block)`);
        for (let i = 0; i < C.mesh.count; i++) assert.ok(C.p[i * 3 + 1] >= 0, 'none under the ground');
        assert.ok(g.emitted.smoke > 80, `dust pushed out by the storeys and the surge (${g.emitted.smoke} puffs)`);
        // the heap grew to its full height
        bl.rubble.getMatrixAt(0, m); m.decompose(p, q, s);
        assert.ok(s.y > 8, `heap full height (${s.y.toFixed(1)})`);
    });

    test('rubble on a hillside comes to rest on the ground where it lands', () => {
        const slope = (x) => -0.3 * x; // falling away to +x
        const { bl, b } = oneBuilding(24, 20, 16, (x, z) => slope(x));
        bl.game = stubGame();
        bl.destroy(b, bl.game, null);
        run(bl, 12);
        const C = bl.chunks;
        let off = 0;
        for (let i = 0; i < C.mesh.count; i++) {
            const gy = C.g[i] - 0.05;
            if (Math.abs(gy - slope(C.p[i * 3])) > 3) off++;
            assert.ok(C.p[i * 3 + 1] >= gy, 'not under its ground');
        }
        assert.ok(off < C.mesh.count * 0.15, `${off} of ${C.mesh.count} rest far from the slope's height`);
    });

    test('a blast on one side throws the facade away from it', () => {
        const { bl, b } = oneBuilding(30);
        const g = stubGame();
        bl.explode({ x: -40, y: 5, z: 0 }, 60, 1e9, g, null);
        assert.ok(!b.alive);
        run(bl, 0.3);
        const C = bl.chunks;
        let away = 0, n = 0;
        for (let i = 0; i < C.mesh.count; i++) { n++; if (C.v[i * 3] > 0) away++; }
        assert.ok(n > 5 && away > n * 0.6, `${away} of ${n} early pieces fly away from the blast`);
    });

    test('the next sortie puts it all back', () => {
        const { bl, b, im } = oneBuilding(30);
        bl.game = stubGame();
        bl.destroy(b, bl.game, null);
        run(bl, 10);
        bl.reset();
        assert.ok(b.alive && b.hp === b.maxHp && b.hitX == null);
        assert.equal(bl.chunks.mesh.count, 0);
        assert.equal(bl.rubble.count, 0);
        const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        im.getMatrixAt(0, m); m.decompose(p, q, s);
        assert.ok(Math.abs(s.y - 30) < 1e-3 && Math.abs(p.y - 15) < 1e-3, 'standing again');
    });
});

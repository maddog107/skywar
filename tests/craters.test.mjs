import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { Craters, craterAdj, CRATER_KINDS, CRATER_MAX, CRATER_U } = await src('craters.js');
const { Weapons } = await src('weapons.js');
const { BASES, terrainHeight } = await src('world.js');

// a world with flat ground 100 m up and no tiles (drawnSampleIn falls back to it)
function stubWorld(h = 100) {
    return {
        scene: { add() {}, remove() {} },
        tiles: new Map(), TILE: 2048, towns: null,
        tileKey: (tx, tz) => tx + ',' + tz,
        drawnSample(x, z, out) { return this.drawnSampleIn(undefined, x, z, out); },
        drawnSampleIn(t, x, z, out) { out.h = h; out.nx = 0; out.ny = 1; out.nz = 0; return out; },
        colorAt(x, hh, z, ny, out, o) { out[o] = 0.1; out[o + 1] = 0.2; out[o + 2] = 0.05; },
    };
}
// the craters indexed in the grid cell under (x, z) (as the terrain shader reads them)
function gridSlots(x, z) {
    const tex = CRATER_U.craterGrid.value, W = tex.image.width, G = W / 2, CELL = 1 / CRATER_U.craterInfo.value.x;
    const cx = ((Math.floor(x / CELL) % G) + G) % G, cz = ((Math.floor(z / CELL) % G) + G) % G;
    const o = (cz * W + cx * 2) * 4, d = tex.image.data, out = [];
    for (let k = 0; k < 8; k++) if (d[o + k]) out.push(d[o + k] - 1);
    return out;
}

describe('craters', () => {
    test('a bomb crater: a bowl below the ground, a rim above it, nothing a few radii out', () => {
        const C = new Craters(stubWorld());
        const c = C.add(1000, 2000, 'bomb', { instant: true });
        assert.ok(c, 'added');
        assert.ok(craterAdj(1000, 2000) < -0.5 * c.depth, `centre ${craterAdj(1000, 2000).toFixed(2)} vs depth ${c.depth.toFixed(2)}`);
        // somewhere on the rim (it wobbles) the ground is raised
        let top = -1;
        for (let a = 0; a < 6.28; a += 0.2) top = Math.max(top, craterAdj(1000 + Math.cos(a) * c.ra * 1.02, 2000 + Math.sin(a) * c.ra * 1.02));
        assert.ok(top > 0.2, `rim ${top.toFixed(2)}`);
        assert.equal(craterAdj(1000 + c.ra * 3, 2000), 0);
        assert.equal(craterAdj(5000, 5000), 0);
        // bigger weapons, bigger holes
        assert.ok(CRATER_KINDS.bomb.r > CRATER_KINDS.missile.r && CRATER_KINDS.missile.r > CRATER_KINDS.rkt.r);
        // the terrain finds it through the index grid
        assert.ok(gridSlots(1000, 2000).includes(c.slot));
        C.clear();
        assert.equal(C.count, 0);
        assert.equal(craterAdj(1000, 2000), 0);
        assert.deepEqual(gridSlots(1000, 2000), []);
    });

    test('a blast on an older crater replaces it; a much smaller one inside it is absorbed', () => {
        const C = new Craters(stubWorld());
        const a = C.add(0, 0, 'bomb', { instant: true });
        assert.equal(C.add(3, 2, 'rkt', { instant: true }), null);
        const b = C.add(4, 0, 'bomb', { instant: true });
        assert.ok(b && a.slot === -1 && C.count === 1);
        C.clear();
    });

    test('capped: the oldest fill in (fade) and are freed, the grid stays consistent', () => {
        const C = new Craters(stubWorld());
        for (let i = 0; i < 90; i++) C.add((i % 10) * 80, Math.floor(i / 10) * 80, 'missile', { instant: true });
        assert.ok(C.count <= CRATER_MAX);
        const fading = C.list.filter(c => c.target === 0);
        assert.ok(fading.length > 0 && C.list.filter(c => c.target > 0).length <= CRATER_MAX - 8);
        for (let t = 0; t < 4; t += 1 / 30) C.update(1 / 30);
        assert.ok(fading.every(c => c.slot === -1), 'faded out and freed');
        for (const c of C.list) assert.ok(gridSlots(c.x, c.z).includes(c.slot), 'indexed');
        C.clear();
    });

    test('a new crater digs itself in over a moment', () => {
        const C = new Craters(stubWorld());
        const c = C.add(0, 0, 'bomb');
        assert.equal(craterAdj(0, 0), 0);
        C.update(0.05);
        const early = craterAdj(0, 0);
        for (let i = 0; i < 20; i++) C.update(0.05);
        assert.ok(early < 0 && craterAdj(0, 0) < early, `${early.toFixed(2)} then ${craterAdj(0, 0).toFixed(2)}`);
        assert.equal(c.fade, 1);
        C.clear();
    });

    test('no craters in water, on a runway or inside an airbase fence', () => {
        const g = { world: { craters: null, towns: null }, ground: null, naval: null, effects: { ejecta() {} }, scene: { add() {}, remove() {} } };
        const W = new Weapons(g);
        const home = BASES[0];
        assert.equal(W.craterSite(home.x, home.z, home.h, 6.6), false, 'runway');
        assert.equal(W.craterSite(home.x + 300, home.z + 500, home.h, 3), false, 'inside the fence');
        // open sea
        let sea = null;
        for (let x = -40000; x < 40000 && !sea; x += 1000) if (terrainHeight(x, 30000) < -20) sea = x;
        assert.ok(sea !== null);
        assert.equal(W.craterSite(sea, 30000, 0, 3), false, 'sea');
        // and yes on open land
        let land = null;
        for (let x = 3000; x < 20000 && !land; x += 250) { const h = terrainHeight(x, 3000); if (h > 20 && h < 300) land = x; }
        assert.equal(W.craterSite(land, 3000, terrainHeight(land, 3000), 3), true, 'land');
    });
});

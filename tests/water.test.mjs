// The wave field of water.js: deterministic; the CPU functions and the GLSL (WAVE_GLSL) read the same numbers;
// the surface as drawn (rest points displaced by the Gerstner sum) is what waterHeight / waterNormal / waterVelocity
// report; the sea-state maps (watermap.js) make lakes and the shallows calmer than the open sea.
import { src } from './helpers/setup.mjs';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const W = await src('water.js');
const M = await src('watermap.js');
const { terrainHeight } = await src('terraincore.js');
const { WATER, SEA_STATES, MAX_WAVES } = W;

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`);
after(() => { W.setSeaMap(0, null); W.setSeaMap(1, null); W.setSeaState('clear', 3, -2); });

// The GLSL waveField (WAVE_GLSL), transcribed: it reads only the packed uniform arrays (float32, as uploaded),
// the origin, and the phase offsets updateWaveUniforms wrote. gains: the per-set factors (1 = open sea)
function glslField(x0, z0, gains = [1, 1, 1]) {
    const A = WATER.gpuA, B = WATER.gpuB, ox = WATER.originX, oz = WATER.originZ;
    let dx = 0, dy = 0, dz = 0;
    for (let i = 0; i < WATER.waves.n; i++) {
        const k = A[i * 4 + 2], a = A[i * 4 + 3] * gains[B[i * 4 + 3] | 0], q = B[i * 4];
        const th = k * (A[i * 4] * (x0 - ox) + A[i * 4 + 1] * (z0 - oz)) + B[i * 4 + 1];
        dy += a * Math.cos(th);
        dx -= q * a * A[i * 4] * Math.sin(th); dz -= q * a * A[i * 4 + 1] * Math.sin(th);
    }
    return { x: x0 + dx, y: dy, z: z0 + dz };
}

describe('sea states', () => {
    test('every weather builds a full set of waves within the uniform arrays, rougher with worse weather', () => {
        let last = 0;
        for (const w of ['clear', 'cloudy', 'rain', 'storm']) {
            W.setSeaState(w, 3, -2);
            assert.ok(WATER.waves.n > 12 && WATER.waves.n <= MAX_WAVES, `${w}: ${WATER.waves.n} waves`);
            // significant height from the amplitudes (Hs = 4 √(Σ a²/2))
            let m0 = 0;
            for (let i = 0; i < WATER.waves.n; i++) m0 += WATER.waves.a[i] ** 2 / 2;
            const hs = 4 * Math.sqrt(m0);
            const want = Math.hypot(...SEA_STATES[w].sets.map(s => s.hs));
            close(hs, want, want * 0.02, `${w} Hs`);
            assert.ok(hs > last, `${w} rougher than the weather before`);
            last = hs;
            // crests never fold over: the steepness budget stays below one
            let qak = 0;
            for (let i = 0; i < WATER.waves.n; i++) qak += WATER.waves.q[i] * WATER.waves.a[i] * WATER.waves.k[i];
            assert.ok(qak < 1, `${w}: Σ q a k = ${qak.toFixed(2)}`);
        }
    });
    test('deterministic: the same weather and wind give the same sea, every time', () => {
        W.setSeaState('rain', 7, -5);
        const a = [0, 1, 2].map(i => W.waterHeight(123.4 + i * 77, -456.7 + i * 31, 37.5));
        W.setSeaState('storm', 14, -10); W.setSeaState('rain', 7, -5);
        const b = [0, 1, 2].map(i => W.waterHeight(123.4 + i * 77, -456.7 + i * 31, 37.5));
        assert.deepEqual(a, b);
        assert.equal(W.setSeaState('rain', 7, -5), false, 'unchanged weather: nothing rebuilt');
        // and it moves: a different time, a different surface
        assert.notEqual(W.waterHeight(123.4, -456.7, 37.5), W.waterHeight(123.4, -456.7, 38.5));
    });
});

describe('the CPU field is the one the shader draws', () => {
    test('the packed GPU arrays carry the waves (direction, wavenumber, amplitude, steepness, length, set)', () => {
        W.setSeaState('storm', 14, -10);
        const w = WATER.waves;
        for (let i = 0; i < w.n; i++) {
            close(WATER.gpuA[i * 4], w.dx[i], 1e-6, 'Dx'); close(WATER.gpuA[i * 4 + 1], w.dz[i], 1e-6, 'Dz');
            close(WATER.gpuA[i * 4 + 2], w.k[i], w.k[i] * 1e-6, 'k'); close(WATER.gpuA[i * 4 + 3], w.a[i], 1e-6, 'a');
            close(WATER.gpuB[i * 4], w.q[i], 1e-6, 'q'); close(WATER.gpuB[i * 4 + 2], w.lambda[i], w.lambda[i] * 1e-6, 'wavelength');
            assert.equal(WATER.gpuB[i * 4 + 3], w.set[i]);
            close(w.w[i], Math.sqrt(9.81 * w.k[i]), 1e-9, 'deep-water dispersion');
        }
        for (let i = w.n; i < MAX_WAVES; i++) assert.equal(WATER.gpuA[i * 4 + 3], 0, 'unused slots are silent');
    });
    test('phase offsets relative to a far-away origin: the shader\'s float32 sum lands on the CPU surface', () => {
        W.setSeaState('rain', 7, -5);
        for (const [ox, oz, t] of [[0, 0, 12.3], [23552, -18176, 4567.8], [-40960, 51200, 9876.5]]) {
            W.updateWaveUniforms(ox, oz, t); W.setWaterTime(t);
            for (let k = 0; k < 20; k++) {
                const x0 = ox + (k * 37.3) % 300 - 150, z0 = oz + (k * 53.1) % 300 - 150;
                const p = glslField(x0, z0);
                // where the shader puts rest point (x0, z0), the CPU finds the same height
                close(W.waterHeight(p.x, p.z, t), p.y, 2e-3, `height at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
            }
        }
        W.updateWaveUniforms(0, 0, 0); W.setWaterTime(0);
    });
    test('the GLSL chunk declares the uniforms the ocean feeds it and is well formed', () => {
        const g = W.WAVE_GLSL;
        for (const u of ['waveA', 'waveB', 'waveN', 'waveOrigin', 'waveLod', 'seaMapFine', 'seaMapCoarse', 'seaFineInfo', 'seaCoarseInfo', 'setDepth', 'shoreInfo', 'time'])
            assert.match(g, new RegExp('uniform [A-Za-z0-9]+ [^;]*\\b' + u + '\\b'), u);
        const count = (c) => g.split(c).length - 1;
        assert.equal(count('{'), count('}'), 'braces balance');
        assert.equal(count('('), count(')'), 'parentheses balance');
        assert.ok(!g.includes('`'), 'no stray template quotes');
    });
});

describe('the surface as drawn', () => {
    test('waterNormal is the slope of waterHeight; waterVelocity moves the surface where it goes next', () => {
        W.setSeaState('rain', 7, -5);
        const t = 21.7, e = 0.05, dt = 1e-3;
        for (let k = 0; k < 12; k++) {
            const x = 40 + k * 13.7, z = -30 + k * 9.1;
            const n = W.waterNormal(x, z, t, { x: 0, y: 0, z: 0 });
            const gx = (W.waterHeight(x + e, z, t) - W.waterHeight(x - e, z, t)) / (2 * e);
            const gz = (W.waterHeight(x, z + e, t) - W.waterHeight(x, z - e, t)) / (2 * e);
            close(-n.x / n.y, gx, 0.01, 'dh/dx'); close(-n.z / n.y, gz, 0.01, 'dh/dz');
            // the water particle at the surface here: where the surface is a moment later
            const s = W.waterSample(x, z, t, {});
            const v = W.waterVelocity(x, z, t, { x: 0, y: 0, z: 0 });
            const x2 = x + v.x * dt, z2 = z + v.z * dt;
            close(W.waterHeight(x2, z2, t + dt), s.h + v.y * dt, 2e-5, 'the particle stays on the surface');
        }
    });
    test('a long hull only feels the long waves', () => {
        W.setSeaState('storm', 14, -10);
        let full = 0, long = 0;
        for (let k = 0; k < 400; k++) {
            const x = k * 7.3, z = (k * 13.1) % 500;
            full += W.waterHeight(x, z, 3) ** 2; long += W.waterHeightLong(x, z, 110, 3) ** 2;
        }
        assert.ok(long < full * 0.85 && long > full * 0.05, `rms long ${Math.sqrt(long / 400).toFixed(2)} vs all ${Math.sqrt(full / 400).toFixed(2)}`);
    });
});

describe('sea-state maps: lakes and shallows are calmer than the open sea', () => {
    // a lake and open sea near each other (found in the real terrain)
    const find = (pred) => { for (let r = 0; r < 30000; r += 250) for (let a = 0; a < 6.28; a += 0.15) { const x = Math.cos(a) * r, z = Math.sin(a) * r; if (pred(x, z)) return { x, z }; } return null; };
    const rms = (x0, z0, t = 5) => { let s = 0, n = 0; for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) { s += W.waterHeight(x0 + i * 9.7, z0 + j * 11.3, t) ** 2; n++; } return Math.sqrt(s / n); };
    test('a lake gets a fraction of the open sea\'s waves; the open sea gets them all', () => {
        W.setSeaState('storm', 14, -10);
        // a lake: water 5–40 m deep with land all round within 2 km (every direction hits land)
        const lake = find((x, z) => {
            const h = terrainHeight(x, z);
            if (h > -5 || h < -40) return false;
            for (let a = 0; a < 6.28; a += 0.5) { let land = false; for (let d = 100; d <= 2000; d += 100) if (terrainHeight(x + Math.cos(a) * d, z + Math.sin(a) * d) > 0) { land = true; break; } if (!land) return false; }
            return true;
        });
        const sea = find((x, z) => { for (const d of [3000, 6000]) for (let a = 0; a < 6.28; a += 0.8) if (terrainHeight(x + Math.cos(a) * d, z + Math.sin(a) * d) > -100) return false; return terrainHeight(x, z) < -120; });
        assert.ok(lake && sea, 'found a lake and open sea');
        for (const [p, label] of [[lake, 'lake'], [sea, 'sea']]) {
            const c = M.runJob(M.coarseJob(p.x, p.z, WATER.windX, WATER.windZ));
            W.setSeaMap(1, c); W.setSeaMap(0, M.runJob(M.fineJob(p.x, p.z, c)));
            p.rms = rms(p.x, p.z);
            p.f = W.seaFactors(p.x, p.z, [0, 0, 0, 0]).slice();
            void label;
        }
        W.setSeaMap(0, null); W.setSeaMap(1, null);
        assert.ok(sea.f[0] > 0.8, `open sea swell factor ${sea.f[0].toFixed(2)}`);
        assert.ok(lake.f[0] < 0.2, `lake swell factor ${lake.f[0].toFixed(2)}`);
        assert.ok(lake.rms < sea.rms * 0.25, `lake rms ${lake.rms.toFixed(2)} m vs sea ${sea.rms.toFixed(2)} m`);
        assert.ok(lake.rms > 0.02, 'but the lake is not glass in a storm');
    });
    test('the open-water waves die away into the shallows; a surf of breakers rolls in to the beach instead', () => {
        W.setSeaState('rain', 7, -5);
        // the coast west of the home base: deep water at x −2900, the beach at about x −2050 (z 0)
        const c = M.runJob(M.coarseJob(-2500, 0, WATER.windX, WATER.windZ));
        W.setSeaMap(1, c); W.setSeaMap(0, M.runJob(M.fineJob(-2300, 0, c)));
        let sx = -2150; while (terrainHeight(sx, 0) < -4) sx += 5; // about 4 m deep
        // the Gerstner sets alone (a tiny minLam leaves out the shore waves)
        const rmsSets = (x0, z0) => { let s2 = 0, n = 0; for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) { s2 += W.waterHeightLong(x0 + i * 9.7, z0 + j * 11.3, 1e-3, 5) ** 2; n++; } return Math.sqrt(s2 / n); };
        const deep = rmsSets(-2900, 0), shallow = rmsSets(sx, 0);
        // the surf: at 2.5 m deep the surface rises and falls with the breakers (height over a swell period)
        let bx = -2150; while (terrainHeight(bx, 0) < -2.5) bx += 2;
        let lo = 1e9, hi = -1e9;
        for (let t = 0; t < 12; t += 0.25) { const h = W.waterHeight(bx, 0, t) - W.waterHeightLong(bx, 0, 1e-3, t); lo = Math.min(lo, h); hi = Math.max(hi, h); }
        W.setSeaMap(0, null); W.setSeaMap(1, null);
        assert.ok(terrainHeight(sx, 0) > -5 && terrainHeight(sx, 0) < 0, 'shallow spot really is shallow');
        assert.ok(shallow < deep * 0.45, `the open-water waves at 4 m: rms ${shallow.toFixed(2)} vs ${deep.toFixed(2)} offshore`);
        assert.ok(hi - lo > 0.3 && hi - lo < 0.78 * 2.5 * 1.2, `breakers ${(hi - lo).toFixed(2)} m high in 2.5 m of water`);
    });
    test('the maps are deterministic and their fine map agrees with the true depth', () => {
        const a = M.runJob(M.coarseJob(1000, -2000, 1, 0)), b = M.runJob(M.coarseJob(1000, -2000, 1, 0));
        assert.deepEqual(Array.from(a.data.slice(0, 4000)), Array.from(b.data.slice(0, 4000)));
        const f = M.runJob(M.fineJob(1000, -2000, a));
        for (let k = 0; k < 50; k++) {
            const i = (k * 37) % f.size, j = (k * 91) % f.size, x = f.x0 + (i + 0.5) * f.texel, z = f.z0 + (j + 0.5) * f.texel;
            close(f.data[(j * f.size + i) * 4 + 3], -terrainHeight(x, z), 1e-3, 'depth');
            for (let c = 0; c < 3; c++) assert.ok(f.data[(j * f.size + i) * 4 + c] >= 0 && f.data[(j * f.size + i) * 4 + c] <= 1.2, 'factor in range');
        }
    });
});

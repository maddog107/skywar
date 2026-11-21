// Simulated fireballs (flipbook.js, effects.js, models/fx): the atlases' metadata and files, the frame / blend /
// window selection, size → scale and timing, the sprite system on a stub scene, and explosion() and its relatives
// still emitting what their callers rely on (lights, sparks, tendrils, dust, columns, the water paths).
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

const THREE = await import('three');
const F = await src('flipbook.js');
const { Effects } = await src('effects.js');
const { fireLights } = await src('firelight.js');

const fx = (f) => new URL(`../models/fx/${f}`, import.meta.url);
const META = {};
for (const n of F.FLIPBOOK_EVENTS) META[n] = JSON.parse(readFileSync(fx(`fireball_${n}.json`), 'utf8'));

// a lossy WebP's size, from its header (RIFF .... WEBP VP8 : the frame tag, then 14-bit width and height)
function webpSize(buf) {
    assert.equal(buf.toString('latin1', 0, 4), 'RIFF'); assert.equal(buf.toString('latin1', 8, 12), 'WEBP');
    const tag = buf.toString('latin1', 12, 16);
    if (tag === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    if (tag === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (tag === 'VP8L') { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
    throw new Error('webp chunk ' + tag);
}

const fog = { color: new THREE.Color(0.5, 0.6, 0.7), density: 0.00002 };
const camera = () => { const c = new THREE.PerspectiveCamera(55, 16 / 9, 1, 50000); c.position.set(0, 60, 300); c.lookAt(0, 20, 0); c.updateMatrixWorld(); return c; };
// effects on a bare scene over flat ground at y = 0 (far inland, so nothing is "water" unless a test says so), with
// the flipbooks' metadata in place of a load (no textures headless)
function stage({ books = true, water = false } = {}) {
    for (const n of F.FLIPBOOK_EVENTS) { if (books) F.flipbooks.setMeta(n, META[n]); else delete F.flipbooks.books[n]; }
    const scene = new THREE.Scene();
    const e = new Effects(scene);
    e.groundHeight = () => 0;
    e.isWater = () => water;
    const blasts = [];
    e.water = { blast: (p, o) => blasts.push({ p: p.clone(), o }), update() { }, clear() { }, setQuality() { }, impact() { }, spout() { } };
    fireLights.clear();
    return { e, scene, blasts };
}
const sprites = (e) => Object.values(e.books).reduce((n, s) => n + s.count, 0);
const step = (e, cam, t, dt = 1 / 60) => { for (let i = 0; i < Math.round(t / dt); i++) e.update(dt, cam, fog, () => 0); };
// the summed area of everything translucent that an effect has in the air (m²): the overdraw it can cost
function quadArea(e) {
    let a = 0;
    for (const s of [e.smoke, e.flame]) { const S = s.aPar.array; for (let i = 0; i < s.count; i++) a += 0.83 * S[i * 4] * S[i * 4]; }
    for (const k in e.books) a += e.books[k].area();
    return a;
}

describe('the fireball atlases (models/fx)', () => {
    test('metadata: 64 frames in an 8×8 grid of 256 px frames; times rising from 0; a window per frame; the fire out well before the end', () => {
        for (const n of F.FLIPBOOK_EVENTS) {
            const m = META[n];
            assert.equal(m.name, n);
            assert.equal(m.frames, 64); assert.equal(m.cols, 8); assert.equal(m.rows, 8); assert.equal(m.frameSize, 256);
            assert.equal(m.times.length, 64); assert.equal(m.windows.length, 64); assert.equal(m.glow.length, 64);
            assert.equal(m.times[0], 0);
            for (let i = 1; i < 64; i++) assert.ok(m.times[i] > m.times[i - 1], `${n}: times rise at ${i}`);
            assert.ok(m.times[63] < 1, `${n}: the last frame starts before the end`);
            // the first frames are packed into the first instants, the last ones seconds apart
            assert.ok(m.times[1] - m.times[0] < (m.times[63] - m.times[62]) / 8, `${n}: time steps grow`);
            assert.ok(m.burn > 0.08 && m.burn < 0.5, `${n}: burn-out at ${m.burn} of the flipbook`);
            assert.ok(m.fireDiameter > 6 && m.fireDiameter < 40, `${n}: fireball ${m.fireDiameter} m in the simulation`);
            assert.ok(m.mvScale > 0 && m.mvScale <= 0.12, `${n}: motion scale ${m.mvScale}`);
            for (const w of m.windows) assert.ok(w.length === 3 && w[2] > 2 && w.every(Number.isFinite));
            // a window never shrinks or jumps by much between frames (the quad's size is blended between them)
            for (let i = 1; i < 64; i++) { const r = m.windows[i][2] / m.windows[i - 1][2]; assert.ok(r > 0.85 && r < 1.3, `${n}: window ${i} is ${r.toFixed(2)}× the one before`); }
            assert.ok(m.windows[63][2] > m.windows[0][2] * 1.5, `${n}: the smoke ends up wider than the first flash`);
            assert.ok(Math.max(...m.glow) === 1 && m.glow[63] === 0, `${n}: the fire's brightness peaks at 1 and is out by the end`);
            assert.match(m.source, /SKYWAR \/ Blender.*CC0/);
        }
        assert.equal(META.air.ground, false); assert.equal(META.ground.ground, true); assert.equal(META.fuel.ground, true);
        // a ground burst stands on its frame's bottom edge: the window's centre is half its edge above the ground
        for (const n of ['ground', 'fuel']) for (const w of META[n].windows) assert.ok(Math.abs(w[1] + originHeight(n) - w[2] / 2) < 0.02, `${n}: foot on the ground`);
        // the fuel fire burns for a larger share of its flipbook than high explosive
        assert.ok(META.fuel.burn > META.air.burn);
    });
    test('files: two grey 2×2 mosaics per burst (4096 px), WebP, small; credited', () => {
        let total = 0;
        for (const n of F.FLIPBOOK_EVENTS) {
            for (const t of ['a', 'b']) {
                const buf = readFileSync(fx(`fireball_${n}_${t}.webp`));
                const [w, h] = webpSize(buf);
                assert.equal(w, META[n].cols * META[n].frameSize * 2, `${n}_${t} width`);
                assert.equal(h, META[n].rows * META[n].frameSize * 2, `${n}_${t} height`);
                assert.ok(buf.length < 900e3, `${n}_${t}: ${buf.length} bytes`);
                total += buf.length;
            }
            total += statSync(fx(`fireball_${n}.json`)).size;
        }
        assert.ok(total < 4.5e6, `models/fx is ${total} bytes`);
        console.log(`    models/fx: ${total} bytes in all`);
        const credits = readFileSync(fx('CREDITS.md'), 'utf8');
        assert.match(credits, /CC0/); assert.match(credits, /tools\/fx/);
        assert.match(readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'), /SKYWAR \/ Blender \(tools\/fx\)/);
    });
});
// the burst point's height over the floor in the simulation: the windows are measured from it
function originHeight(n) { const w = META[n].windows[0]; return w[2] / 2 - w[1]; }

describe('frame, blend and window selection', () => {
    const T = [0, 0.1, 0.3, 0.6];
    test('frameAt: the frame whose time has come and the share of the way to the next; the last frame held', () => {
        assert.deepEqual({ ...F.frameAt(T, 0) }, { i: 0, f: 0 });
        assert.deepEqual({ ...F.frameAt(T, -1) }, { i: 0, f: 0 });
        let r = F.frameAt(T, 0.05); assert.equal(r.i, 0); assert.ok(Math.abs(r.f - 0.5) < 1e-9);
        r = F.frameAt(T, 0.1); assert.equal(r.i, 1); assert.equal(r.f, 0);
        r = F.frameAt(T, 0.25); assert.equal(r.i, 1); assert.ok(Math.abs(r.f - 0.75) < 1e-9);
        r = F.frameAt(T, 0.6); assert.equal(r.i, 3); assert.equal(r.f, 0);
        r = F.frameAt(T, 5); assert.equal(r.i, 3); assert.equal(r.f, 0);
    });
    test('playback is continuous at any step: frame + blend never jumps, at 30, 144 or 2000 fps of slow motion', () => {
        const m = META.ground;
        for (const steps of [200, 1000, 20000]) {
            let prev = 0;
            for (let k = 0; k <= steps; k++) {
                const u = k / steps, r = F.frameAt(m.times, u);
                assert.ok(r.i >= 0 && r.i < m.frames && r.f >= 0 && r.f < 1 + 1e-9);
                const x = r.i + r.f;
                assert.ok(x >= prev - 1e-9, 'never goes back');
                // at most the frames that fit in one step of u (the fastest part of the table), plus rounding
                if (steps >= 20000) assert.ok(x - prev < 0.05, `a step of ${(1 / steps).toExponential(1)} moved ${(x - prev).toFixed(3)} frames`);
                prev = x;
            }
            assert.equal(Math.floor(prev), m.frames - 1);
        }
    });
    test('windowAt: the quad between two frames covers a window between theirs; r and the shift tell the shader where each frame sits', () => {
        const m = { windows: [[0, 5, 10], [2, 7, 20], [2, 7, 20]] };
        let w = F.windowAt(m, 0, 0); assert.deepEqual([w.cx, w.cy, w.e], [0, 5, 10]);
        w = F.windowAt(m, 0, 0.5); assert.deepEqual([w.cx, w.cy, w.e], [1, 6, 15]);
        assert.equal(w.r, 2); assert.equal(w.dx, 0.2); assert.equal(w.dy, 0.2);
        w = F.windowAt(m, 2, 0.7); assert.deepEqual([w.cx, w.cy, w.e, w.r, w.dx, w.dy], [2, 7, 20, 1, 0, 0]); // (the last frame: no next)
        // the shader's lookups (FLIPBOOK_FS): the centre of frame A's window lands at uv 0.5 in A, B's in B
        const f = 0.3, W0 = m.windows[0], W1 = m.windows[1];
        w = F.windowAt(m, 0, f);
        const ef = 1 + f * (w.r - 1);
        const uvA = (qx, qy) => [(qx - 0.5) * ef + 0.5 + f * w.dx, (qy - 0.5) * ef + 0.5 + f * w.dy];
        const uvB = (qx, qy) => [(qx - 0.5) * (ef / w.r) + 0.5 - (1 - f) * w.dx / w.r, (qy - 0.5) * (ef / w.r) + 0.5 - (1 - f) * w.dy / w.r];
        const quad = (x, y) => [(x - w.cx) / w.e + 0.5, (y - w.cy) / w.e + 0.5]; // a point of the cloud → quad coordinates
        let p = uvA(...quad(W0[0], W0[1])); assert.ok(Math.abs(p[0] - 0.5) < 1e-9 && Math.abs(p[1] - 0.5) < 1e-9);
        p = uvB(...quad(W1[0], W1[1])); assert.ok(Math.abs(p[0] - 0.5) < 1e-9 && Math.abs(p[1] - 0.5) < 1e-9);
        p = uvA(...quad(W0[0] + W0[2] / 2, W0[1] - W0[2] / 2)); assert.ok(Math.abs(p[0] - 1) < 1e-9 && Math.abs(p[1]) < 1e-9, 'A\'s corner');
        p = uvB(...quad(W1[0] - W1[2] / 2, W1[1] + W1[2] / 2)); assert.ok(Math.abs(p[0]) < 1e-9 && Math.abs(p[1] - 1) < 1e-9, 'B\'s corner');
    });
});

describe('size and timing from the blast size', () => {
    test('a 500 lb bomb: a fireball 15–20 m across that burns for about a second; bigger blasts are slower as well as larger', () => {
        for (const s of [2.2, 2.4]) {
            const b = F.fireballSpec(s);
            assert.ok(b.diameter >= 15 && b.diameter <= 20, `size ${s}: ${b.diameter.toFixed(1)} m`);
            assert.ok(b.burn >= 0.8 && b.burn <= 1.2, `size ${s}: ${b.burn.toFixed(2)} s`);
        }
        let last = F.fireballSpec(0.5);
        for (const s of [0.9, 1.6, 2.2, 3.4, 6, 9]) {
            const b = F.fireballSpec(s);
            assert.ok(b.diameter > last.diameter && b.burn > last.burn, `size ${s} is larger and slower`);
            last = b;
        }
        // an air-to-air warhead: a few metres, under half a second; the MK-84X's main burst: tens of metres, seconds
        const aam = F.fireballSpec(0.9), big = F.fireballSpec(6);
        assert.ok(aam.diameter < 9 && aam.burn < 0.5, `AAM ${aam.diameter.toFixed(1)} m, ${aam.burn.toFixed(2)} s`);
        assert.ok(big.diameter > 40 && big.burn > 2 && big.burn < 4, `size 6: ${big.diameter.toFixed(0)} m, ${big.burn.toFixed(1)} s`);
        // time goes with the cube root of the charge, near enough: 8× the charge (2× the size) takes 1.7-2.1× as long
        const r = F.fireballSpec(4.4).burn / F.fireballSpec(2.2).burn;
        assert.ok(r > 1.7 && r < 2.1, `twice the size burns ${r.toFixed(2)}× as long`);
    });
    test('fuel burns several seconds, orange and wide; high explosive is over quickly', () => {
        const he = F.fireballSpec(2.3), fuel = F.fireballSpec(2.3, 'fuel');
        assert.ok(fuel.burn > 2.5 && fuel.burn < 6, `fuel ${fuel.burn.toFixed(1)} s`);
        assert.ok(fuel.burn > he.burn * 2.5 && fuel.diameter > he.diameter);
    });
});

describe('FlipbookSystem', () => {
    test('a sprite: sized in metres from the fireball\'s width, played by its age, gone at the end of its life', () => {
        F.flipbooks.setMeta('air', META.air);
        const sys = new F.FlipbookSystem(new THREE.Scene(), 'air');
        assert.ok(sys.ready);
        const cam = camera(), m = META.air;
        const p = sys.emit(new THREE.Vector3(0, 100, 0), { diameter: 17.6, burn: 1, start: 0, mirror: 1, rot: 0 });
        assert.ok(Math.abs(p.life - 1 / m.burn) < 1e-9, 'the fire is out at `burn` seconds: the life follows from the flipbook\'s burn-out point');
        const S = sys.aPar.array;
        let last = -1;
        for (let k = 0; k < 30; k++) {
            sys.update(0.1, cam, fog, null, null);
            assert.equal(sys.geo.instanceCount, 1);
            assert.ok(S[3] >= last, 'frames only go forward');
            last = S[3];
        }
        // 3 s in: past burn-out, in the smoke; the quad is the frame's window scaled by 17.6 m / the simulation's fireball
        const fr = F.frameAt(m.times, 3 / p.life), win = F.windowAt(m, fr.i, fr.f);
        assert.ok(Math.abs(S[3] - (fr.i + fr.f)) < 1e-3, `frame ${S[3].toFixed(2)} at 3 s`);
        assert.ok(fr.i > m.times.findIndex(t => t >= m.burn) - 1, 'past the burn-out frame');
        assert.ok(Math.abs(S[0] - win.e * 17.6 / m.fireDiameter) < 1e-2, `quad ${S[0].toFixed(1)} m`);
        assert.ok(S[0] > 17.6 && S[0] < 17.6 * 5, 'a cloud a few fireballs across');
        // an air burst's window climbs with the cloud, along the world's up
        assert.ok(sys.aPos.array[1] > 100 + 2, `the cloud has climbed to ${sys.aPos.array[1].toFixed(1)} m`);
        for (let k = 0; k < 60; k++) sys.update(0.1, cam, fog, null, null);
        assert.equal(sys.count, 0); assert.equal(sys.geo.instanceCount, 0);
    });
    test('playback follows game time: the same age at 30 or 240 fps, and half the time step is half the speed', () => {
        F.flipbooks.setMeta('ground', META.ground);
        const run = (dt, n) => {
            const sys = new F.FlipbookSystem(new THREE.Scene(), 'ground');
            sys.emit(new THREE.Vector3(0, 0, 0), { diameter: 18, burn: 1, start: 0, mirror: 1, rot: 0 });
            for (let k = 0; k < n; k++) sys.update(dt, camera(), fog, null, null);
            return sys.aPar.array[3];
        };
        const a = run(1 / 30, 30), b = run(1 / 240, 240), slow = run(1 / 60, 30);
        assert.ok(Math.abs(a - b) < 0.02, `1 s at 30 fps: frame ${a.toFixed(3)}, at 240 fps: ${b.toFixed(3)}`);
        assert.ok(Math.abs(slow - run(1 / 30, 15)) < 0.02 && slow < a - 3, `half a second in: frame ${slow.toFixed(2)} (a second in: ${a.toFixed(2)})`);
    });
    test('a ground burst stands on its burst point; mirrored sprites flip their offset; the far one is drawn first', () => {
        F.flipbooks.setMeta('ground', META.ground);
        const sys = new F.FlipbookSystem(new THREE.Scene(), 'ground');
        const cam = camera();
        sys.emit(new THREE.Vector3(0, 0, -400), { diameter: 18, burn: 1, start: 0, mirror: 1, rot: 0 });
        sys.emit(new THREE.Vector3(50, 0, 100), { diameter: 18, burn: 1, start: 0, mirror: -1, rot: 0 });
        sys.update(0.5, cam, fog, null, null);
        const P = sys.aPos.array, S = sys.aPar.array, O = sys.aOff.array, W = sys.aWarp.array;
        assert.equal(P[2], -400, 'the far one first'); assert.equal(P[5], 100);
        assert.equal(P[1], 0, 'its position stays on the ground');
        for (const k of [0, 1]) assert.ok(Math.abs(O[k * 4 + 1] - S[k * 4] / 2) < 1e-3 * S[k * 4] + 0.02, 'the quad is lifted half its height: its foot on the burst point');
        assert.equal(W[3], 1); assert.equal(W[7], -1);
        assert.ok(Math.abs(O[0] + O[4]) < 1e-6, 'mirrored: the sideways offset flips');
    });
    test('the light it throws follows the simulated fire, and stops when the fire is out', () => {
        F.flipbooks.setMeta('air', META.air);
        const sys = new F.FlipbookSystem(new THREE.Scene(), 'air');
        const kept = [];
        const fl = { keep: (key, pos, I) => kept.push(I) };
        sys.emit(new THREE.Vector3(0, 100, 0), { diameter: 18, burn: 1, start: 0, light: 10000, heat: 1 });
        const cam = camera();
        for (let k = 0; k < 40; k++) sys.update(0.05, cam, fog, null, fl);
        assert.ok(kept.length > 10 && kept.length < 30, `lit for ${kept.length} of 40 steps of 0.05 s (the fire burns 1 s)`);
        assert.ok(Math.max(...kept) > 7000 && kept[kept.length - 1] < 1500, 'bright at first, dying away');
    });
    test('without its atlas nothing is emitted (the effects fall back to puffs); the oldest makes way when full', () => {
        delete F.flipbooks.books.fuel;
        const none = new F.FlipbookSystem(new THREE.Scene(), 'fuel');
        assert.equal(none.ready, false); assert.equal(none.emit(new THREE.Vector3(), {}), null);
        none.update(0.1, camera(), fog, null, null);
        F.flipbooks.setMeta('fuel', META.fuel);
        const sys = new F.FlipbookSystem(new THREE.Scene(), 'fuel', { max: 4 });
        for (let k = 0; k < 9; k++) sys.emit(new THREE.Vector3(k, 0, 0), { diameter: 10, burn: 2 });
        assert.equal(sys.count, 4);
        sys.update(0.1, camera(), fog, null, null);
        assert.equal(sys.geo.instanceCount, 4);
        sys.clear(); assert.equal(sys.count, 0);
    });
});

describe('explosion() and its relatives', () => {
    test('a 500 lb bomb on the ground: the ground-burst flipbook, a flash and its light, sparks, tendrils, dust, a smoke column', () => {
        const { e } = stage();
        e.explosion(new THREE.Vector3(0, 0, 0), 2.2);
        assert.equal(e.books.ground.count, 2, 'two sprites (one behind the other)'); assert.equal(e.books.air.count, 0);
        assert.equal(e.flame.count, 0, 'no fireball puffs');
        assert.ok(e.sparks.count >= 40, `${e.sparks.count} sparks`);
        assert.ok(e.fire.count === 3, 'the core flare');
        assert.ok(e.sprites.filter(s => s.visible).length >= 2, 'flash and shock ring');
        assert.ok(fireLights.pool.some(l => l.used && l.kind === 'flash'), 'a flash of light');
        assert.ok(e.emitters.some(x => x.kind === 'tendril') && e.emitters.some(x => x.kind === 'column'), 'tendrils and a column');
        assert.ok(e.smoke.count > 20, `${e.smoke.count} dust and smoke puffs`);
        const cam = camera();
        step(e, cam, 0.5);
        assert.ok(fireLights.pool.some(l => l.used && l.kind === 'keep'), 'the fireball lights its surroundings while it burns');
        step(e, cam, 2.5);
        assert.ok(!fireLights.pool.some(l => l.used && l.kind === 'keep'), 'and stops when it is out');
        assert.equal(e.books.ground.count, 2, 'the smoke is still the flipbook 3 s on');
        step(e, cam, 9);
        assert.equal(sprites(e), 0, 'gone in the end');
    });
    test('an aircraft blowing up in the air (size 1.6, moving): the air burst, carried along, burning as fuel', () => {
        const { e } = stage();
        e.explosion(new THREE.Vector3(0, 800, 0), 1.6, new THREE.Vector3(0, 0, -200));
        assert.equal(e.books.air.count, 2); assert.equal(e.books.ground.count, 0);
        const p = e.books.air.list[0];
        assert.ok(p.vel.z < -30, 'carried along at a share of its speed');
        const fuel = F.fireballSpec(1.6, 'fuel');
        assert.ok(Math.abs(p.life * META.air.burn / (1 - p.start) - fuel.burn) < 1e-6, 'burns as a fuel fire');
        // the same at rest (a warhead): high explosive, quicker
        const { e: e2 } = stage();
        e2.explosion(new THREE.Vector3(0, 800, 0), 1.6);
        assert.ok(e2.books.air.list[0].life < p.life / 2);
        assert.ok(!e.emitters.some(x => x.kind === 'column'), 'no smoke column in the air');
    });
    test('small bursts stay puffs; so does everything when the atlases are missing', () => {
        const { e } = stage();
        e.explosion(new THREE.Vector3(0, 0, 0), 0.3);
        assert.equal(sprites(e), 0); assert.ok(e.flame.count >= 10, `${e.flame.count} flame puffs`);
        const { e: e2 } = stage({ books: false });
        e2.explosion(new THREE.Vector3(0, 0, 0), 2.2);
        assert.equal(sprites(e2), 0); assert.ok(e2.flame.count >= 25, 'the old fireball');
        assert.ok(e2.sparks.count >= 40 && e2.emitters.some(x => x.kind === 'column'));
        e2.megaBlast(new THREE.Vector3(0, 0, 0), 2.5); e2.crashBlast(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -50, -190), 15);
        step(e2, camera(), 1);
    });
    test('on the water: the splash is asked for (not with noWater), the fireball is the air burst; quenched: one small short sprite leaving steam', () => {
        const { e, blasts } = stage({ water: true });
        e.explosion(new THREE.Vector3(0, 1, 0), 2.2);
        assert.equal(blasts.length, 1); assert.equal(blasts[0].o.fireball, false);
        assert.equal(e.books.ground.count, 0); assert.ok(e.books.air.count >= 1);
        assert.ok(!e.emitters.some(x => x.kind === 'tendril' || x.kind === 'column'), 'no tendrils, no column');
        const dry = stage().e; dry.explosion(new THREE.Vector3(0, 300, 0), 2.2);
        const { e: q, blasts: b2 } = stage({ water: true });
        q.explosion(new THREE.Vector3(0, 1.5, 0), 2, null, { noWater: true, quench: true });
        assert.equal(b2.length, 0, 'noWater: no splash of its own');
        assert.equal(q.books.air.count, 1);
        const a = q.books.air.list[0], d = dry.books.air.list[0];
        assert.ok(a.life < d.life * 0.6 && a.scale < d.scale * 0.7, 'smaller and shorter');
        assert.ok(a.c1[0] > 0.5, 'steam, not soot');
        assert.ok(q.smoke.count < dry.smoke.count);
    });
    test('megaBlast, earthFountain, crashBlast: flipbooks at the heart of them, the mushroom, the columns and the light as before', () => {
        const { e } = stage();
        e.megaBlast(new THREE.Vector3(0, 0, 0), 2.5);
        // (the main burst on the ground, five more round it a few metres up)
        assert.ok(e.books.ground.count >= 2 && sprites(e) >= 8, `${e.books.ground.count} ground-burst sprites, ${sprites(e)} in all`);
        assert.ok(e.emitters.some(x => x.kind === 'mushroom') && e.emitters.some(x => x.kind === 'column'));
        // the main burst is slower than a bomb's as well as larger
        const main = e.books.ground.list[0], bomb = stage().e;
        bomb.explosion(new THREE.Vector3(0, 0, 0), 2.2);
        assert.ok(main.life > bomb.books.ground.list[0].life * 2 && main.scale > bomb.books.ground.list[0].scale * 2);
        step(e, camera(), 2);
        assert.ok(e.flame.count > 50, 'the mushroom\'s stem and cap');

        const { e: c } = stage();
        c.crashBlast(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -50, -190), 15);
        assert.ok(c.books.fuel.count >= 4, `${c.books.fuel.count} fuel fireballs`);
        const zs = c.books.fuel.list.map(p => p.pos.z);
        assert.ok(Math.min(...zs) < -30, 'strung out along the path');
        assert.ok(c.books.fuel.list.some(p => p.vel.z < -10), 'and thrown on along it');
        assert.ok(c.emitters.filter(x => x.kind === 'column').length >= 2, 'the spilt fuel burning under columns');
        assert.ok(c.sparks.count > 40);
        // fuel burns for seconds
        step(c, camera(), 2.5);
        assert.ok(fireLights.pool.some(l => l.used && l.kind === 'keep'), 'still burning 2.5 s on');

        const { e: f } = stage();
        f.earthFountain(new THREE.Vector3(0, 0, 0), 1.7);
        assert.ok(f.books.ground.count >= 1 && f.smoke.count > 200);
    });
    test('overdraw: the flipbook fireball covers less than the puffs it replaces, at every moment of the first seconds', () => {
        const cam = camera();
        for (const [size, y] of [[2.2, 0], [1.6, 500], [3.4, 0]]) {
            const a = stage().e, b = stage({ books: false }).e;
            a.explosion(new THREE.Vector3(0, y, 0), size); b.explosion(new THREE.Vector3(0, y, 0), size);
            let sa = 0, sb = 0;
            for (let k = 0; k < 40; k++) {
                step(a, cam, 0.1, 0.05); step(b, cam, 0.1, 0.05);
                const qa = quadArea(a), qb = quadArea(b);
                if (k >= 2 && k < 30) assert.ok(qa < qb, `size ${size}, ${(0.1 * (k + 1)).toFixed(1)} s: ${qa.toFixed(0)} m² against ${qb.toFixed(0)} m²`);
                sa += qa; sb += qb;
            }
            console.log(`    size ${size}: ${(sa / 10).toFixed(0)} m²·s of translucent quads over 4 s, ${(sb / 10).toFixed(0)} with puffs (${(100 * sa / sb).toFixed(0)}%)`);
            assert.ok(sa < sb * 0.75);
        }
    });
    test('quality: on low one sprite a fireball, cross-faded without motion vectors', () => {
        const { e } = stage();
        e.setQuality('low');
        e.explosion(new THREE.Vector3(0, 0, 0), 2.2);
        assert.equal(e.books.ground.count, 1);
        assert.equal(e.books.ground.mat.defines.MOTION, undefined);
        e.setQuality('high');
        assert.equal(e.books.ground.mat.defines.MOTION, '');
    });
    test('warm(): a sprite of every flipbook is in the scene before the first explosion; clear() empties them', () => {
        const { e } = stage();
        e.warm(null);
        for (const n of F.FLIPBOOK_EVENTS) assert.equal(e.books[n].count, 1);
        e.update(1 / 60, camera(), fog, () => 0);
        for (const n of F.FLIPBOOK_EVENTS) assert.equal(e.books[n].geo.instanceCount, 1);
        e.clear();
        assert.equal(sprites(e), 0);
    });
});

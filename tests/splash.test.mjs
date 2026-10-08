// What hits the water (splash.js): a round's spout by calibre, speed and angle, and the shallow-angle skip; a
// charge's column, slick, surge and heave by its weight and depth; the budgets that keep hundreds of rounds a second
// cheap (the particle pools' caps, a frame's spouts, the wake-map stamps), by quality.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const S = await src('splash.js');
const WW = await src('waterwake.js');
const W = await src('water.js');
const { AIRCRAFT } = await src('config.js');

W.setSeaState('clear', 3, -2);
const SEA = { x: -7000, z: 0 };

// a particle system that only counts (and refuses past its size, like effects.js's)
const sys = (max) => ({ count: 0, max, emitted: 0, emit() { this.emitted++; if (this.count < this.max) this.count++; }, update() { }, clear() { this.count = 0; } });
function stubFx({ quality = 'high', cam = [SEA.x + 100, 20, SEA.z + 100] } = {}) {
    const field = new WW.WashField();
    const fx = {
        drops: sys(9000), mist: sys(3400), jets: sys(3000), fire: { n: 0, emit() { this.n++; } },
        game: { naval: { fx: { flyby: { field } } }, camera: { position: new THREE.Vector3(...cam) } },
    };
    const water = new S.WaterFX(fx);
    water.setQuality(quality);
    return { fx, water, field };
}
const total = (fx) => fx.drops.count + fx.mist.count + fx.jets.count;

describe('a round into the water', () => {
    test('every gun in config.js has a calibre; the real rates are known', () => {
        for (const [id, a] of Object.entries(AIRCRAFT)) {
            if (!a.gun) continue;
            const c = S.gunCalibre(a.gun.name);
            assert.ok(c >= 20 && c <= 30, `${id}: ${a.gun.name} → ${c} mm`);
            assert.ok(S.gunRealRate(a.gun.name) >= a.gun.rate, `${id}: real rate ${S.gunRealRate(a.gun.name)} ≥ game rate ${a.gun.rate}`);
        }
        assert.equal(S.gunCalibre('M61 20mm'), 20);
        assert.equal(S.gunCalibre('2× ADEN 30mm'), 30);
        assert.equal(S.gunCalibre('Type 23-III'), 23);
        assert.equal(S.roundCalibre({ small: true, def: { id: 'ak47' } }), 7.62);
        assert.equal(S.roundCalibre({ cal: 30 }), 30);
    });
    test('the spout by calibre: rifle bullets under a metre or so; cannon shells drawn tall to read (20 mm 6–13 m), 30 mm bigger', () => {
        const strafe = Math.sin(12 * Math.PI / 180);
        const h = (cal, v = 1000, s = 1) => S.spoutHeight(cal, v, s);
        assert.ok(h(5.56, 900) < h(7.62, 800) && h(7.62, 800) < 1.4, `5.56 mm ${h(5.56, 900).toFixed(2)} m, 7.62 mm ${h(7.62, 800).toFixed(2)} m`);
        assert.ok(h(12.7, 880) > 1.5 && h(12.7, 880) < 3.5, `12.7 mm ${h(12.7, 880).toFixed(2)} m`);
        for (const s of [1, strafe, Math.sin(25 * Math.PI / 180)]) assert.ok(h(20, 1000, s) >= 6 && h(20, 1000, s) <= 13, `20 mm ${h(20, 1000, s).toFixed(2)} m (sin ${s.toFixed(2)})`);
        assert.ok(h(30, 1000, strafe) > h(20, 1000, strafe) * 1.3, `30 mm ${h(30, 1000, strafe).toFixed(2)} vs 20 mm ${h(20, 1000, strafe).toFixed(2)}`);
        let last = 0;
        for (const c of [5.56, 7.62, 9, 12.7, 20, 23, 25, 27, 30]) { assert.ok(h(c) > last, `grows with calibre at ${c} mm`); last = h(c); }
        assert.ok(h(20, 1000, 0.15) < h(20, 1000, 0.8), 'a shallow round throws a lower spout');
        assert.ok(h(20, 400) < h(20, 1000), 'a spent round a lower one');
        const R = S.roundSplash(30, 1000, strafe);
        assert.ok(R.lean > 0.3 && R.ring > 1 && R.he, 'a strafing 30 mm round: leans along its path, a ring round it, an HE flash');
    });
    test('below ~5–9° a round skips off the water; steeper, shells and spent rounds never', () => {
        const s = (deg) => Math.sin(deg * Math.PI / 180);
        assert.ok(S.ricochets(s(3), 900, 20, 0.5) && S.ricochets(s(4.9), 900, 20, 0), '3°, 4.9°: skips');
        assert.ok(!S.ricochets(s(9.5), 900, 20, 1) && !S.ricochets(s(20), 900, 20, 0.5), '9.5°, 20°: goes in');
        assert.ok(!S.ricochets(s(3), 900, 127, 0.5), 'a 127 mm shell bursts on the water');
        assert.ok(!S.ricochets(s(3), 200, 20, 0.5), 'a spent round just plops in');
    });
    test('round(): a glancing round flies on, slowed and turned up, at most twice; a steep one splashes; a shell bursts', () => {
        const { water, fx } = stubFx();
        const r0 = Math.random;
        Math.random = () => 0.5;
        try {
            const b = { pos: new THREE.Vector3(SEA.x, -1, SEA.z), vel: new THREE.Vector3(0, -40, -1000), cal: 20, skips: 0 };
            const prev = new THREE.Vector3(SEA.x, 1.5, SEA.z + 40);
            const v0 = b.vel.length();
            assert.equal(water.round(b, prev), true, 'skipped');
            assert.ok(b.vel.y > 0 && b.vel.length() < v0 * 0.8 && b.pos.y > 0 && b.skips === 1, `flies on at ${b.vel.length().toFixed(0)} m/s, up ${b.vel.y.toFixed(1)}`);
            b.skips = 2; b.vel.set(0, -40, -1000); b.pos.y = -1;
            assert.equal(water.round(b, prev), false, 'no third skip');
            const steep = { pos: new THREE.Vector3(SEA.x, -2, SEA.z), vel: new THREE.Vector3(0, -600, -800), cal: 30 };
            assert.equal(water.round(steep, new THREE.Vector3(SEA.x, 8, SEA.z + 13)), false);
            assert.ok(fx.jets.count > 0 && fx.drops.count > 0 && fx.mist.count > 0, 'a spout: jets, drops, mist');
            const shell = { pos: new THREE.Vector3(SEA.x, -2, SEA.z), vel: new THREE.Vector3(0, -300, -500), cal: 127 };
            const n = water.stats.blasts;
            water.round(shell, new THREE.Vector3(SEA.x, 5, SEA.z + 12));
            assert.equal(water.stats.blasts, n + 1, 'a shell: a small column of its own');
        } finally { Math.random = r0; }
    });
});

describe('a charge in the water', () => {
    test('the column by warhead: tens of metres for a 500 lb bomb or a missile, 100 m and more for the biggest', () => {
        const bomb = S.blastSplash(S.WARHEAD_KG.bomb, 'shallow'), aam = S.blastSplash(S.WARHEAD_KG.aam, 'contact');
        assert.ok(bomb.H > 55 && bomb.H < 85, `500 lb bomb: ${bomb.H.toFixed(0)} m`);
        assert.ok(aam.H > 8 && aam.H < 25, `AIM-9: ${aam.H.toFixed(0)} m`);
        const harpoon = S.blastSplash(300, 'contact'), scud = S.blastSplash(700, 'shallow'), ton = S.blastSplash(1000, 'optimal');
        assert.ok(harpoon.H > 35, `Harpoon: ${harpoon.H.toFixed(0)} m`);
        assert.ok(scud.H >= 95 && ton.H >= 120, `Scud ${scud.H.toFixed(0)} m, a ton under a keel ${ton.H.toFixed(0)} m`);
        let last = 0;
        for (const kg of [0.2, 1, 8, 30, 93, 300, 1000, 5000]) { const H = S.blastSplash(kg, 'shallow').H; assert.ok(H > last, `grows with the charge at ${kg} kg`); last = H; }
        const d = (k) => S.blastSplash(93, k).H;
        assert.ok(d('contact') < d('shallow') && d('shallow') < d('optimal') && d('deep') < d('optimal'), 'the best depth throws it highest; a burst on the surface or deep down less');
        assert.ok(S.blastSplash(93, 'contact', 10).H < d('contact') * 0.5 && S.blastSplash(93, 'contact', 60).H < 0.5, 'a burst over the water: a ring of spray, nothing high up');
    });
    test('what follows: a base surge wider than the column, a slick that lasts tens of seconds, a heave; a flash for near-surface bursts', () => {
        const P = S.blastSplash(93, 'shallow');
        assert.ok(P.surge > P.H && P.surgeV > 3, `surge to ${P.surge.toFixed(0)} m at ${P.surgeV.toFixed(1)} m/s`);
        assert.ok(P.slick > P.R * 2 && P.slickLife >= 30, `slick ${P.slick.toFixed(0)} m for ${P.slickLife.toFixed(0)} s`);
        assert.ok(P.heave > 1 && P.heave < 6, `heave ${P.heave.toFixed(1)} m`);
        assert.ok(P.dome > 0 && P.flash > 0 && P.fire < 0.3, 'a dome, a muffled flash, little fire');
        const c = S.blastSplash(8, 'contact');
        assert.ok(c.dome === 0 && c.fire > 0.4, 'a burst on the surface: a fireball, no dome');
        assert.ok(S.blastSplash(1, 'impact').flash === 0, 'a wreck hitting the water: no flash');
        const jet = S.impactKg(9000, 150);
        assert.ok(jet > 15 && jet < 40, `a 9 t jet at 150 m/s: ${jet.toFixed(0)} kg of TNT's energy`);
        assert.ok(S.shellKg(127) > S.shellKg(76) && S.shellKg(155) > S.shellKg(127), 'shells by calibre');
    });
    test('blast(): column now, rain, hanging cloud and surge later; slick, shock and waves in the wake map; the heave', () => {
        const { water, fx, field } = stubFx();
        const P = water.blast(new THREE.Vector3(SEA.x, 0, SEA.z), { kg: 93, depth: 'shallow', sound: false });
        const n0 = total(fx);
        assert.ok(n0 > 300, `${n0} particles at once`);
        assert.ok(water.events.length === 3, 'rain, the hanging cloud, the surge to come');
        assert.ok(field.n >= 4 && Array.from(field.ring.slice(0, field.n)).includes(WW.KIND.slick) && Array.from(field.ring.slice(0, field.n)).includes(WW.KIND.wave), 'slick and wave rings stamped');
        assert.equal(water.heaves.length, 1, 'the surface heaves');
        for (let i = 0; i < 60 * P.tTop * 2; i++) water.update(1 / 60);
        assert.ok(water.events.length < 3 && total(fx) > n0, `the delayed parts went out (${total(fx) - n0} more)`);
        for (let i = 0; i < 60 * 40; i++) water.update(1 / 60);
        assert.equal(water.heaves.length, 0, 'the heave dies away');
        // a slick still there half a minute on
        const s = { foam: 0, milk: 0, agit: 0 };
        for (let i = 0; i < 60 * 30; i++) field.update(1 / 60);
        field.sample(SEA.x + 2, SEA.z + 2, s);
        assert.ok(s.milk > 0.1, `milky slick after 30 s: ${s.milk.toFixed(2)}`);
    });
});

describe('budgets', () => {
    test('the pools: thousands of rounds and a dozen blasts in a frame stay inside every cap', () => {
        for (const q of ['low', 'medium', 'high', 'ultra']) {
            const { water, fx, field } = stubFx({ quality: q });
            const Q = S.SPLASH_QUALITY[q];
            const at = new THREE.Vector3(), v = new THREE.Vector3(0, -500, -800);
            for (let i = 0; i < 5000; i++) water.spout(at.set(SEA.x + (i % 50), 0, SEA.z + i * 0.3), v, 30, { rep: 3 });
            // rounds never take more than their share
            assert.ok(fx.drops.count <= Math.round(Q.drops * 0.55) && fx.jets.count <= Math.round(Q.jets * 0.55) && fx.mist.count <= Math.round(Q.mist * 0.55), `${q}: rounds within their share`);
            // the frame's budget: past 3× the spouts a frame may draw, nothing more is emitted
            const e0 = fx.drops.emitted + fx.jets.emitted + fx.mist.emitted;
            for (let i = 0; i < 100; i++) water.spout(at.set(SEA.x, 0, SEA.z), v, 30);
            assert.equal(fx.drops.emitted + fx.jets.emitted + fx.mist.emitted, e0, `${q}: over the frame's budget: no particles`);
            assert.ok(field.n <= Q.spouts * 4 + 1, `${q}: ${field.n} stamps from one frame's rounds`);
            for (let i = 0; i < 12; i++) water.blast(at.set(SEA.x + i * 50, 0, SEA.z), { kg: 300, depth: 'shallow', sound: false });
            assert.ok(fx.drops.count <= Q.drops && fx.jets.count <= Q.jets && fx.mist.count <= Q.mist, `${q}: blasts within the caps`);
            assert.ok(water.heaves.length <= Q.heave && water.events.length <= 120, `${q}: heaves ${water.heaves.length}, events ${water.events.length}`);
            // next frame: the budget's back
            water.update(1 / 60);
            const e1 = fx.drops.emitted;
            fx.drops.count = 0;
            water.spout(at.set(SEA.x, 0, SEA.z), v, 30);
            assert.ok(fx.drops.emitted > e1, `${q}: a new frame splashes again`);
        }
    });
    test('quality: low draws a fraction of ultra for the same splash; far spouts thinner', () => {
        const count = (q) => { const { water, fx } = stubFx({ quality: q }); water.blast(new THREE.Vector3(SEA.x, 0, SEA.z), { kg: 93, depth: 'shallow', sound: false }); return total(fx); };
        assert.ok(count('low') < count('high') * 0.6 && count('high') < count('ultra'), `low ${count('low')}, high ${count('high')}, ultra ${count('ultra')}`);
        const near = stubFx(), far = stubFx({ cam: [SEA.x + 4000, 20, SEA.z] });
        const v = new THREE.Vector3(0, -500, -800);
        near.water.spout(new THREE.Vector3(SEA.x, 0, SEA.z), v, 20);
        far.water.spout(new THREE.Vector3(SEA.x, 0, SEA.z), v, 20);
        assert.ok(total(far.fx) < total(near.fx) * 0.5, `4 km off: ${total(far.fx)} vs ${total(near.fx)} particles`);
        // a gun's real rate: each game round stands for a few, a cluster of spouts
        const one = stubFx(), three = stubFx();
        one.water.spout(new THREE.Vector3(SEA.x, 0, SEA.z), v, 30);
        three.water.spout(new THREE.Vector3(SEA.x, 0, SEA.z), v, 30, { rep: 3 });
        assert.ok(three.fx.jets.count > one.fx.jets.count, 'a burst of three real rounds: more spouts');
    });
    test('the wake map stamps: every round on high, every third on low', () => {
        const stamps = (q) => { const { water, field } = stubFx({ quality: q }); const v = new THREE.Vector3(0, -500, -800); for (let i = 0; i < 30; i++) { water.spout(new THREE.Vector3(SEA.x + i * 3, 0, SEA.z), v, 20); water.update(1 / 60); } return field.n; };
        assert.equal(stamps('high'), 30);
        assert.equal(stamps('low'), 10);
    });
});

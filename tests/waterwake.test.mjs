// Low flybys over water (waterwake.js): how hard a jet's exhaust and downwash, a rotor's wash and a missile's
// sustainer blow on the water by height, speed and thrust; the marks they leave (foam, milky water, ripples), how
// those age and drift; a helicopter's ring; nothing high up or over land.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const WW = await src('waterwake.js');
const W = await src('water.js');
const { AIR_TARGETS } = await src('softtargets.js');
const { terrainHeight } = await src('terraincore.js');

W.setSeaState('clear', 3, -2);
const SEA = { x: -7000, z: 0 };   // open sea, ~140 m deep
assert.ok(terrainHeight(SEA.x, SEA.z) < -100, 'the test spot is open sea');

// a stub jet: an F/A-18-sized fighter flying north (−z) at `speed`, `alt` m up
function jet({ alt = 10, speed = 220, throttle = 0.8, ab = false, span = 13.6, length = 18.3, x = SEA.x, z = SEA.z } = {}) {
    return {
        pos: new THREE.Vector3(x, alt, z), vel: new THREE.Vector3(0, 0, -speed), spec: { span, length },
        alive: true, exploded: false, onGround: false, onWater: false, throttle, afterburner: ab, thrustAB: 13, thrustMil: 13 * 0.62,
        getForward(out) { return out.set(0, 0, -1); },
    };
}
// a stub game around one source; effects count the spray
function stubGame(sources = {}) {
    const fx = { n: 0, smoke: { emit() { fx.n++; } } };
    return { aircraft: sources.aircraft || [], strikes: { missiles: sources.missiles || [] }, wind: new THREE.Vector3(3, 0, -2), effects: fx };
}
// fly a source for `secs` at 60 fps (it moves with its velocity)
function fly(F, game, secs, src) {
    for (let i = 0; i < secs * 60; i++) {
        if (src) src.pos.addScaledVector(src.vel, 1 / 60);
        F.update(1 / 60, game);
    }
}

describe('how hard the air blows on the water', () => {
    test('a jet\'s exhaust lands nearer and blows harder the lower it is; nose up brings it in; no thrust, nothing', () => {
        const T = 100e3;
        const a = WW.exhaustWash(8, T), b = WW.exhaustWash(20, T), c = WW.exhaustWash(60, T);
        assert.ok(a.x < b.x && b.x < c.x, `lands ${a.x.toFixed(0)}, ${b.x.toFixed(0)}, ${c.x.toFixed(0)} m behind`);
        assert.ok(a.u > b.u && b.u > c.u, `blows ${a.u.toFixed(1)}, ${b.u.toFixed(1)}, ${c.u.toFixed(1)} m/s`);
        assert.ok(WW.exhaustWash(20, T, 0.2).x < b.x, 'nose up: the plume meets the water sooner');
        assert.ok(WW.exhaustWash(20, T * 2).u > b.u, 'more thrust, a harder blast');
        assert.equal(WW.exhaustWash(20, 0).u, 0);
        // the scale: 15 m over the water at military power a fighter tears it into spray, at 60 m it only ripples it
        const fighter = 15000 * 13 * 0.62;
        assert.ok(WW.washMarks(WW.exhaustWash(10, fighter).u).spray > 0.3, 'a fighter 10 m up throws spray');
        const hi = WW.washMarks(WW.exhaustWash(60, fighter).u);
        assert.ok(hi.spray === 0 && hi.agit > 0.2, `60 m up: ripples (${hi.agit.toFixed(2)}), no spray`);
    });
    test('the wing\'s downwash: stronger slow and heavy, felt only within about a span of the water', () => {
        const m = 15000, b = 13.6;
        assert.ok(WW.wingWash(5, m, 80, b) > WW.wingWash(5, m, 250, b) * 2, 'slow: much more downwash');
        assert.ok(WW.wingWash(5, m * 3, 120, b) > WW.wingWash(5, m, 120, b), 'heavier: more');
        assert.equal(WW.wingWash(b * 2, m, 120, b), 0, 'two spans up: nothing reaches the water');
    });
    test('a rotor in hover: a ring of outwash 1–2 radii out, weaker with height and in forward flight', () => {
        const low = WW.rotorWash(12, 9500, 8), high = WW.rotorWash(60, 9500, 8), fast = WW.rotorWash(12, 9500, 8, 50);
        assert.ok(low.u > 15, `a Black Hawk 12 m up blows ${low.u.toFixed(1)} m/s over the water`);
        assert.ok(high.u < low.u * 0.4, 'four diameters up, much less');
        assert.ok(fast.u < low.u * 0.6 && fast.back > 0, 'in forward flight the wake streams back and weakens');
        assert.ok(low.ring > 8 && low.ring < 16, `the ring ${low.ring.toFixed(1)} m out`);
    });
});

describe('the marks on the water', () => {
    test('foam bursts within seconds, the milky water lingers longer, the ripples die away; all of it spreads', () => {
        const at = (t) => WW.stampAt(1, 1, 1, 5, false, t, {});
        assert.ok(at(0.5).foam > 0.4 && at(12).foam < 0.05, `foam ${at(0.5).foam.toFixed(2)} → ${at(12).foam.toFixed(3)}`);
        assert.ok(at(12).milk > at(12).foam * 3, 'the bubbles under the foam outlast it');
        assert.ok(at(1).agit > 0.6 && at(25).agit < 0.02, 'ripples fade over several seconds');
        assert.ok(at(10).w > at(1).w, 'a streak spreads as it ages');
        assert.ok(WW.stampAt(1, 1, 1, 5, true, 4, {}).w > at(4).w, 'a rotor\'s ring runs outward faster');
        // monotonic after the first moment
        for (let t = 1; t < 20; t++) assert.ok(at(t + 1).foam <= at(t).foam && at(t + 1).agit <= at(t).agit, `decays at ${t} s`);
    });
    test('a field of marks drifts with the surface (~3 % of the wind) and lets faded marks go', () => {
        const F = new WW.WashField(64);
        F.add(0, 0, 0, 10, 4, 1, 1, 1);
        for (let i = 0; i < 60 * 10; i++) F.update(1 / 60, 0.09, -0.06);
        assert.ok(Math.abs(F.x[0] - 0.9) < 0.01 && Math.abs(F.z[0] + 0.6) < 0.01, `drifted to ${F.x[0].toFixed(2)}, ${F.z[0].toFixed(2)}`);
        for (let i = 0; i < 60 * 30; i++) F.update(1 / 60);
        assert.equal(F.n, 0, 'faded away');
        // full: the oldest gives way
        const G = new WW.WashField(4);
        for (let k = 0; k < 6; k++) { G.add(k, 0, 0, 1, 1, 1, 1, 1); G.update(0.1); }
        assert.equal(G.n, 4);
        assert.ok(Array.from(G.x).every(x => x >= 2), 'the two oldest replaced');
    });
});

describe('low flybys leave their marks', () => {
    test('a jet at 10 m leaves a long line of churned, rippled water and throws spray; at 40 m only ripples; at 150 m nothing', () => {
        const run = (alt) => {
            const a = jet({ alt }), g = stubGame({ aircraft: [a] }), F = new WW.FlybyWakes();
            fly(F, g, 3, a);
            return { F, a, g };
        };
        const low = run(10), mid = run(40), high = run(150);
        assert.ok(low.F.field.n > 50, `${low.F.field.n} marks at 10 m`);
        assert.ok(low.g.effects.n > 100, `${low.g.effects.n} spray particles at 10 m`);
        let foam = 0, agit = 0;
        for (let i = 0; i < low.F.field.n; i++) { foam = Math.max(foam, low.F.field.f0[i]); agit = Math.max(agit, low.F.field.a0[i]); }
        assert.ok(foam > 0.3 && agit > 0.9, `white water ${foam.toFixed(2)}, ripples ${agit.toFixed(2)}`);
        // the line: continuous along the path behind the jet (sampled every 10 m over 500 m)
        const s = {};
        let gaps = 0;
        for (let d = 100; d < 600; d += 10) { low.F.field.sample(SEA.x, low.a.pos.z + d, s); if (s.agit < 0.2) gaps++; }
        assert.equal(gaps, 0, 'no gaps in the line');
        assert.ok(mid.F.field.n > 10 && mid.g.effects.n === 0, `40 m: ${mid.F.field.n} marks, ${mid.g.effects.n} spray`);
        let mf = 0; for (let i = 0; i < mid.F.field.n; i++) mf = Math.max(mf, mid.F.field.f0[i]);
        assert.ok(mf < 0.05, 'no white water from 40 m');
        assert.equal(high.F.field.n, 0, 'nothing from 150 m');
    });
    test('afterburner: a harder blast than military power at the same height', () => {
        const strength = (ab) => {
            const a = jet({ alt: 25, ab }), g = stubGame({ aircraft: [a] }), F = new WW.FlybyWakes();
            fly(F, g, 1, a);
            let f = 0; for (let i = 0; i < F.field.n; i++) f = Math.max(f, F.field.f0[i] + F.field.a0[i] + F.field.m0[i]);
            return f;
        };
        assert.ok(strength(true) > strength(false), 'reheat stirs the water up more');
    });
    test('the marks fade: some seconds after the pass the white water is gone and the ripples are going', () => {
        const a = jet({ alt: 8 }), g = stubGame({ aircraft: [a] }), F = new WW.FlybyWakes();
        fly(F, g, 2, a);
        a.pos.y = 500; // pulls up and away
        fly(F, g, 12, a);
        let foam = 0, agit = 0, milk = 0;
        const s = { foam: 0, milk: 0, agit: 0, w: 0 };
        for (let i = 0; i < F.field.n; i++) { WW.stampAt(F.field.f0[i], F.field.m0[i], F.field.a0[i], F.field.w0[i], 0, F.field.time - F.field.born[i], s); foam = Math.max(foam, s.foam); agit = Math.max(agit, s.agit); milk = Math.max(milk, s.milk); }
        assert.ok(foam < 0.05, `foam ${foam.toFixed(3)} after 12 s`);
        assert.ok(agit < 0.15, `ripples ${agit.toFixed(3)}`);
        assert.ok(milk > 0.01, 'a milky trace still there');
        fly(F, g, 25, a);
        assert.equal(F.field.n, 0, 'all gone half a minute on');
    });
    test('over land: no marks (the exhaust lands on the ground)', () => {
        // the home airfield
        const a = jet({ alt: 10, x: 0, z: 0 }), g = stubGame({ aircraft: [a] }), F = new WW.FlybyWakes();
        assert.ok(terrainHeight(0, 0) > 0);
        fly(F, g, 0.5, a);
        assert.equal(F.field.n, 0);
    });
    test('a helicopter hovering low: rings of ripples and spray round the spot under it, running outward', () => {
        const rotor = new THREE.Mesh(new THREE.BoxGeometry(16, 0.1, 16));
        const mesh = new THREE.Group(); mesh.add(rotor); mesh.userData.rotor = rotor;
        mesh.position.set(SEA.x + 300, 12, SEA.z);
        const heli = { mesh, alive: true, vel: new THREE.Vector3(), name: 'UH-60 BLACK HAWK' };
        AIR_TARGETS.push(heli);
        try {
            const g = stubGame(), F = new WW.FlybyWakes();
            fly(F, g, 2);
            assert.ok(F.field.n > 5, `${F.field.n} ring marks`);
            assert.ok(g.effects.n > 50, `${g.effects.n} spray particles`);
            let ring = 0, near = 0;
            for (let i = 0; i < F.field.n; i++) { ring += F.field.ring[i]; near = Math.max(near, Math.hypot(F.field.x[i] - mesh.position.x, F.field.z[i] - mesh.position.z)); }
            assert.equal(ring, F.field.n, 'all of them rings');
            assert.ok(near < 3, 'centred under the rotor');
            // the oldest ring has run further out than the newest
            const s = { foam: 0, milk: 0, agit: 0, w: 0 }, w = [];
            for (let i = 0; i < F.field.n; i++) w.push(WW.stampAt(1, 1, 1, F.field.w0[i], 1, F.field.time - F.field.born[i], s).w);
            assert.ok(Math.max(...w) > Math.min(...w) + 2, 'older rings wider');
            // high up: nothing
            mesh.position.y = 120;
            const g2 = stubGame(), F2 = new WW.FlybyWakes();
            fly(F2, g2, 1);
            assert.equal(F2.field.n, 0, 'nothing from 120 m');
        } finally { AIR_TARGETS.splice(AIR_TARGETS.indexOf(heli), 1); }
    });
    test('a sea-skimming missile leaves a fainter line than a jet at the same height', () => {
        const m = { alive: true, kind: 'antiship', phase: 'cruise', pos: new THREE.Vector3(SEA.x, 7, SEA.z), vel: new THREE.Vector3(0, 0, -240) };
        const g = stubGame({ missiles: [m] }), F = new WW.FlybyWakes();
        fly(F, g, 2, m);
        assert.ok(F.field.n > 10, `${F.field.n} marks from a Harpoon at 7 m`);
        let mf = 0; for (let i = 0; i < F.field.n; i++) mf = Math.max(mf, F.field.f0[i] + F.field.a0[i]);
        const a = jet({ alt: 7 }), gj = stubGame({ aircraft: [a] }), FJ = new WW.FlybyWakes();
        fly(FJ, gj, 2, a);
        let jf = 0; for (let i = 0; i < FJ.field.n; i++) jf = Math.max(jf, FJ.field.f0[i] + FJ.field.a0[i]);
        assert.ok(mf < jf, `missile ${mf.toFixed(2)} vs jet ${jf.toFixed(2)}`);
        assert.ok(g.effects.n < gj.effects.n / 3, 'and much less spray');
        // still boosting (climbing out of its cell): not yet
        m.phase = 'boost';
        const F3 = new WW.FlybyWakes(); fly(F3, g, 0.5, m);
        assert.equal(F3.field.n, 0);
    });
});

// The CL-415 on the water (seaplane.js), headless over the real terrain and the wave field of water.js:
// it floats at its draught and rides the swell, taxis and turns on its water rudder, gets over the hump onto the
// step and flies off, lands on the water (and is hurt or wrecked by a hard, nose-low, gear-down or rough-sea
// landing), capsizes if rolled over, and runs up a beach on its wheels.
import { src } from './helpers/setup.mjs';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, stubGame, THREE } from './helpers/flight.mjs';

const W = await src('water.js');
const SP = await src('seaplane.js');
const { terrainHeight } = await src('terraincore.js');
const { Towns } = await src('towns.js');
const { mulberry32 } = await src('util.js');

const DT = 1 / 60, R2D = 180 / Math.PI;
const noop = () => {};
after(() => W.setSeaState('clear', 3, -2));

function seaGame() {
    const feed = [];
    const fx = { now: 0, puffSmoke: noop, puffFire: noop, waterSplash: noop, explosion: noop, debrisBurst: noop, smoke: { emit: noop }, fire: { emit: noop }, addTrail: () => ({ push: noop, emitting: false }) };
    // the ground and the water as game.surfaceAt gives them (no towns, craters or ships)
    const surfaceAt = (x, z, y = 1e9) => {
        const th = terrainHeight(x, z), water = th < -0.5;
        return { h: water && y < W.WATER.maxCrest + 2 ? W.waterHeight(x, z) : Math.max(th, 0), water, runway: false, ship: null, hull: false };
    };
    return stubGame({ effects: fx, wreckage: { eject: noop, breakup: noop }, addFeed: (t) => feed.push(t), feed, surfaceAt });
}
// a CL-415 afloat at (x, z) on heading h in a given weather (open sea: no maps, the whole sea is open water)
let clock = 0;
function afloat(weather = 'clear', x = -4000, z = 0, h = 0) {
    W.setSeaMap(0, null); W.setSeaMap(1, null);
    W.setSeaState(weather, 3, -2);
    const game = seaGame();
    const ac = makeAircraft('cl415', { game, isPlayer: true, alt: 500 });
    // standing on its wheels: in the browser the gear model (models.js gearContacts) gives the same height
    ac.gearOffset = -(SP.keelY(ac) + ac.spec.seaplane.wheels[0][1]) + 0.02;
    W.setWaterTime(clock);
    SP.spawnWater(ac, x, z, h);
    return ac;
}
function run(ac, seconds, each = null) {
    for (let i = 0; i < seconds / DT && !ac.exploded; i++) {
        W.setWaterTime(clock);
        if (each) each(ac, i * DT);
        ac.update(DT);
        clock += DT;
    }
}
const attitude = (ac) => {
    const f = ac.getForward(new THREE.Vector3()), r = ac.getRight(new THREE.Vector3());
    return { pitch: Math.asin(f.y) * R2D, roll: Math.asin(r.y) * R2D, heading: Math.atan2(-f.x, -f.z) * R2D };
};
const keelDepth = (ac) => W.waterHeight(ac.pos.x, ac.pos.z) - (ac.pos.y + SP.keelY(ac));

describe('afloat', () => {
    test('floats at its draught, near level, and stays put on a calm sea', () => {
        const ac = afloat('clear');
        run(ac, 30);
        const a = attitude(ac);
        assert.ok(ac.onWater && !ac.exploded, 'afloat');
        assert.ok(keelDepth(ac) > 0.6 && keelDepth(ac) < 1.6, `keel ${keelDepth(ac).toFixed(2)} m deep`);
        assert.ok(Math.abs(a.pitch) < 6, `pitch ${a.pitch.toFixed(1)}°`);
        assert.ok(Math.abs(a.roll) < 4, `roll ${a.roll.toFixed(1)}° (resting on a float at most)`);
        assert.ok(Math.hypot(ac.vel.x, ac.vel.z) < 1.2, `drifting at ${Math.hypot(ac.vel.x, ac.vel.z).toFixed(2)} m/s`);
        assert.equal(ac.health, ac.maxHealth);
    });
    test('rides the swell: its heave follows the water under it', () => {
        const ac = afloat('rain');
        run(ac, 5);
        const ys = [], hs = [];
        run(ac, 25, (a) => { ys.push(a.pos.y); hs.push(W.waterHeight(a.pos.x, a.pos.z)); });
        const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
        const my = mean(ys), mh = mean(hs);
        let c = 0, vy = 0, vh = 0;
        for (let i = 0; i < ys.length; i++) { c += (ys[i] - my) * (hs[i] - mh); vy += (ys[i] - my) ** 2; vh += (hs[i] - mh) ** 2; }
        const corr = c / Math.sqrt(vy * vh);
        assert.ok(Math.sqrt(vh / hs.length) > 0.2, 'there is a swell to ride');
        assert.ok(corr > 0.75, `heave vs the water under it: correlation ${corr.toFixed(2)}`);
        assert.ok(ac.onWater && !ac.exploded && ac.health === ac.maxHealth, 'still afloat and whole');
    });
    test('capsizes when rolled over', () => {
        const ac = afloat('clear');
        run(ac, 2);
        ac.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.3));
        run(ac, 3);
        assert.ok(ac.exploded, 'capsized');
    });
});

describe('taxi and takeoff', () => {
    test('taxis on power, turns on its water rudder, stops when the power comes off', () => {
        const ac = afloat('clear');
        run(ac, 5);
        ac.controls.throttle = 0.25;
        run(ac, 15);
        const v1 = ac.relSpeed, h0 = attitude(ac).heading;
        assert.ok(v1 > 3 && v1 < 13, `taxi speed ${v1.toFixed(1)} m/s at 25 % power`);
        ac.controls.yaw = 1;
        run(ac, 12);
        let turned = attitude(ac).heading - h0; turned = ((turned + 540) % 360) - 180;
        assert.ok(turned > 45, `turned ${turned.toFixed(0)}° left in 12 s`);
        ac.controls.yaw = 0; ac.controls.throttle = 0;
        run(ac, 25);
        assert.ok(ac.relSpeed < 3, `drifts to a stop: ${ac.relSpeed.toFixed(1)} m/s`);
    });
    test('hull resistance rises to a hump, then falls away once it planes', () => {
        const R = (x) => SP.hullResistance(x);
        let peak = 0, at = 0;
        for (let x = 0; x <= 3; x += 0.01) if (R(x) > peak) { peak = R(x); at = x; }
        assert.ok(Math.abs(at - 1) < 0.02, `hump at ${at.toFixed(2)} × the hump speed`);
        assert.ok(peak > 0.15 && peak < 0.25, `hump resistance ${peak.toFixed(3)} of the weight`);
        assert.ok(R(2) < peak * 0.6, 'on the step it is much less');
        assert.ok(R(0.3) < peak * 0.2, 'slow, very little');
    });
    test('full power: over the hump, onto the step, and off the water at its takeoff speed', () => {
        const ac = afloat('clear');
        run(ac, 5);
        const start = ac.pos.clone();
        ac.flaps = 1; ac.controls.throttle = 1;
        let off = null;
        run(ac, 70, (a, t) => {
            if (!off) a.controls.pitch = a.relSpeed > 38 ? 0.5 : a.relSpeed > 15 ? 0.1 : 0; // up onto the step, then rotate
            else { // then climb away at 7°, wings level
                const at = attitude(a);
                a.controls.pitch = Math.max(-0.5, Math.min(0.5, (7 - at.pitch) / 20));
                a.controls.roll = Math.max(-1, Math.min(1, at.roll / 20));
            }
            if (!off && !a.onWater) off = { t, d: Math.hypot(a.pos.x - start.x, a.pos.z - start.z), V: a.speed };
        });
        assert.ok(off, 'it flew');
        assert.ok(off.d > 400 && off.d < 1100, `off the water after ${off.d.toFixed(0)} m (real: ~800 m)`);
        assert.ok(off.V > 36 && off.V < 50, `at ${(off.V * 1.944).toFixed(0)} kt`);
        assert.ok(!ac.exploded && ac.health === ac.maxHealth, 'undamaged');
        assert.ok(ac.pos.y > start.y + 30, `climbing: ${(ac.pos.y - start.y).toFixed(0)} m up`);
    });
    test('a crest can throw it clear below flying speed: it drops back instead of "taking off"', () => {
        const ac = afloat('rain');
        run(ac, 3);
        ac.flaps = 1; ac.controls.throttle = 1;
        let early = false;
        run(ac, 20, (a) => { if (!a.onWater && a.speed < 30) early = true; });
        assert.ok(!early, 'never flying below 30 m/s');
    });
});

describe('landing on the water', () => {
    // just above the water, flaps down, gear up: a given speed, sink rate, pitch and roll
    function onFinal(weather, V, sink, pitchDeg, rollDeg = 0, gear = false) {
        const ac = afloat(weather);
        ac.spawnAir(new THREE.Vector3(-4200, 0, 400), 0, 0.3);
        ac.flaps = 2; ac.flapAnim = 1; ac.gear = gear; ac.gearAnim = gear ? 1 : 0;
        const th = pitchDeg / R2D, gam = Math.atan2(sink, V);
        ac.qv.setFromAxisAngle(new THREE.Vector3(1, 0, 0), gam).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -rollDeg / R2D));
        ac.vel.set(0, sink, -V);
        ac.alpha = th - gam; ac.syncBody();
        ac.pos.y = W.waterHeight(ac.pos.x, ac.pos.z) - SP.keelY(ac) + 0.5;
        ac.controls.throttle = 0.05;
        run(ac, 30, (a) => { a.controls.pitch = a.onWater ? 0 : Math.max(-1, Math.min(1, (th - Math.asin(a.getForward(new THREE.Vector3()).y)) * 4)); });
        return ac;
    }
    test('a normal touchdown: afloat, undamaged, slowing to a taxi', () => {
        const ac = onFinal('clear', 42, -0.8, 5);
        assert.ok(ac.onWater && !ac.exploded && ac.health === ac.maxHealth, 'afloat and whole: ' + JSON.stringify(ac.sea && ac.sea.lastLanding));
        assert.ok(ac.relSpeed < 8, `slowed to ${ac.relSpeed.toFixed(1)} m/s`);
    });
    test('a hard one hurts it; the gear down, a steep nose-down or a storm sea wreck it', () => {
        const hard = onFinal('clear', 42, -4.6, 4);
        assert.ok(!hard.exploded && hard.health < hard.maxHealth * 0.9, `hard: ${hard.health.toFixed(0)} / ${hard.maxHealth}`);
        const gear = onFinal('clear', 42, -0.8, 5, 0, true);
        assert.ok(gear.exploded, 'gear down: over it goes');
        const nose = onFinal('clear', 48, -3, -8);
        assert.ok(nose.exploded || nose.health < nose.maxHealth * 0.5, `nose low: ${nose.exploded ? 'wrecked' : nose.health.toFixed(0)}`);
        const storm = onFinal('storm', 42, -0.8, 5);
        assert.ok(storm.exploded, 'a storm sea is too big for it');
    });
});

describe('the shore', () => {
    test('with the gear down it runs up a beach instead of through it', () => {
        // the beach west of the home base (about x −2050 at z 0), from 40 m of water, heading east (+x)
        let x0 = -2600; while (terrainHeight(x0, 0) < -40) x0 += 10;
        const ac = afloat('clear', x0, 0, -Math.PI / 2);
        ac.gear = true; ac.gearAnim = 1;
        run(ac, 2);
        ac.controls.throttle = 0.35;
        let deepest = 0;
        run(ac, 90, (a) => {
            const th = terrainHeight(a.pos.x, a.pos.z);
            deepest = Math.max(deepest, th - (a.pos.y + SP.keelY(a)));
        });
        assert.ok(!ac.exploded && ac.health === ac.maxHealth, 'intact');
        assert.ok(deepest < 0.5, `the keel never goes more than ${deepest.toFixed(2)} m into the ground`);
        assert.ok(terrainHeight(ac.pos.x, ac.pos.z) > 0.5 && !ac.onWater && ac.onGround, `up on dry land on its wheels (x ${ac.pos.x.toFixed(0)})`);
    });
    test('driven onto the beach fast with the gear up, the hull tears; it stops at the waterline', () => {
        let x0 = -2600; while (terrainHeight(x0, 0) < -40) x0 += 10;
        const ac = afloat('clear', x0, 0, -Math.PI / 2);
        run(ac, 2);
        ac.controls.throttle = 0.6;
        run(ac, 40);
        assert.ok(!ac.exploded && ac.health < ac.maxHealth * 0.95, `hull ${ac.health.toFixed(0)} / ${ac.maxHealth}`);
        assert.ok(ac.game.feed.some(t => t.includes('AGROUND')), 'told so');
        assert.ok(ac.onWater && terrainHeight(ac.pos.x, ac.pos.z) < 1.5 && ac.relSpeed < 2, `stuck at the waterline (x ${ac.pos.x.toFixed(0)}, ${ac.relSpeed.toFixed(1)} m/s)`);
    });
    test('a seaplane base: sheltered water near a town, a jetty, room to take off', () => {
        const towns = Towns.prototype.placeTowns.call({ rand: mulberry32(2024) });
        const b = SP.findSeaplaneBase(towns, { x: 0, z: 0 }, { x: 3, z: -2 });
        assert.ok(b, 'found one');
        assert.ok(-terrainHeight(b.x, b.z) >= 4, 'deep enough to float');
        assert.ok(terrainHeight(b.shore.x, b.shore.z) > 0, 'the jetty starts on land');
        const hx = -Math.sin(b.heading), hz = -Math.cos(b.heading);
        for (let d = 0; d <= 1600; d += 50) assert.ok(terrainHeight(b.x + hx * d, b.z + hz * d) < -2.5, `clear water ${d} m along the takeoff run`);
    });
});

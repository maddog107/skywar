// The small boats you drive (src/boats.js BoatPhysics), headless on a flat sea, a swell and a stub sea bed:
// top speed against the real boats (NSW 11 m RHIB 45+ kt, CB90H 40+ kt), getting on the plane (the hump, lift,
// trim), turning (rate, radius, banking into the turn, speed bled off), a crash stop, coasting to a stop, leaving a
// crest and landing again, riding the swell adrift, the same run at 30 / 60 / 144 fps, running aground and backing
// off, a wall. Also warrooms.js steerShip: a naval.js ship (it steams round circles) driven as if it had a helm.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const B = await src('boats.js');
const W = await src('warrooms.js');

const flat = (x, z, out) => { out.h = 0; out.vy = 0; return out; };
const deep = () => -100;
function boat(type, { sea = flat, ground = deep, heading = 0 } = {}) {
    const p = new B.BoatPhysics(B.BOAT_SPECS[type], 0, 0, heading);
    p.sea = sea; p.ground = ground;
    return p.settle();
}
function run(p, s, ctl, dt = 1 / 60, each = null) { for (let t = 0; t < s; t += dt) { p.step(dt, ctl); if (each) each(p, t); } return p; }
const FULL = { throttle: 1, steer: 0 };

describe('boat physics (BoatPhysics)', () => {
    for (const type of ['rhib', 'cb90']) {
        const S = B.BOAT_SPECS[type];
        test(type + ': top speed on a calm sea, on the plane', () => {
            let t20 = null, maxTrim = 0, trimHump = 0;
            const p = run(boat(type), 90, FULL, 1 / 60, (q, t) => {
                if (t20 === null && q.u * B.KT >= 20) t20 = t;
                if (q.pitch > maxTrim) { maxTrim = q.pitch; trimHump = q.u; }
            });
            const kt = p.u * B.KT;
            console.log(`  ${type}: top ${kt.toFixed(1)} kt (spec ${(S.top * B.KT).toFixed(1)}), 0–20 kt ${t20.toFixed(1)} s, peak trim ${(maxTrim * 57.3).toFixed(1)}° at ${(trimHump * B.KT).toFixed(0)} kt, running trim ${(p.pitch * 57.3).toFixed(1)}°, rise ${p.y.toFixed(2)} m`);
            assert.ok(Math.abs(p.u - S.top) / S.top < 0.03, 'top speed ' + kt.toFixed(1) + ' kt');
            assert.ok(kt > (type === 'rhib' ? 44 : 39), 'the real boat\'s 45 / 40 kt');
            assert.ok(t20 > 3.5 && t20 < 8, '0–20 kt in ' + t20.toFixed(1) + ' s');
            assert.equal(p.plane, 1, 'fully on the plane');
            assert.ok(p.y > S.lift * 0.8, 'the hull rides up: ' + p.y.toFixed(2) + ' m');
            assert.ok(maxTrim > p.pitch + 0.01, 'the bow comes up over the hump and settles on the plane');
            assert.ok(trimHump > S.hump * 0.6 && trimHump < S.hump * 1.6, 'the trim peaks at the hump');
            assert.ok(p.immersion > 0.9, 'the jets stay in the water');
        });

        test(type + ': turns hard, banks into the turn, bleeds speed; turns to port too', () => {
            const p = run(boat(type), 40, FULL);
            const u0 = p.u;
            run(p, 6, { throttle: 1, steer: 1 });
            const radius = p.u / Math.abs(p.r);
            console.log(`  ${type}: full helm ${(-p.r * 57.3).toFixed(0)}°/s, radius ${radius.toFixed(0)} m, ${(p.u * B.KT).toFixed(0)} kt (from ${(u0 * B.KT).toFixed(0)}), heel ${(p.roll * 57.3).toFixed(1)}°, slip ${p.v.toFixed(2)} m/s`);
            assert.ok(p.r < -0.35 && p.r >= -S.rMax - 1e-6, 'starboard helm turns right (heading down): ' + p.r.toFixed(2));
            assert.ok(radius > 12 && radius < 60, 'turning circle radius ' + radius.toFixed(0) + ' m');
            assert.ok(p.roll < -0.05, 'banked into the turn (starboard side down)');
            assert.ok(p.u < u0 * 0.95, 'a hard turn bleeds speed');
            run(p, 8, { throttle: 1, steer: -1 });
            assert.ok(p.r > 0.35, 'port helm turns left');
            assert.ok(p.roll > 0.05, 'banked the other way');
        });

        test(type + ': crash stop, and coasting to a stop', () => {
            const p = run(boat(type), 40, FULL);
            const x0 = p.x, z0 = p.z;
            let t = 0;
            for (; t < 30 && p.u > 0.3; t += 1 / 60) p.step(1 / 60, { throttle: -1, steer: 0 });
            const d = Math.hypot(p.x - x0, p.z - z0);
            console.log(`  ${type}: crash stop in ${t.toFixed(1)} s over ${d.toFixed(0)} m (${(d / S.L).toFixed(1)} lengths)`);
            assert.ok(t < 7, 'stops in ' + t.toFixed(1) + ' s');
            assert.ok(d < S.L * (type === 'cb90' ? 3.2 : 5.5), 'within a few lengths: ' + d.toFixed(0) + ' m');
            const q = run(boat(type), 40, FULL);
            let tc = 0;
            for (; tc < 150 && q.u > 0.05; tc += 1 / 60) q.step(1 / 60, { throttle: 0, steer: 0 });
            assert.ok(tc < 150, 'coasts to a stop');
            run(q, 30, { throttle: 0, steer: 1 });
            assert.ok(Math.abs(q.u) < 0.05 && Math.abs(q.r) < 0.02, 'stopped with the engines idle, the helm alone does nothing');
            run(q, 5, { throttle: 0.3, steer: 1 });
            assert.ok(q.r < -0.02, 'but with a little power the nozzles swing the stern round');
        });
    }

    // a head sea: 1 m crest to trough, 25 m crest to crest, running south (+z) into a boat heading north
    const swell = (tRef) => (x, z, out) => { const k = 2 * Math.PI / 25, w = Math.sqrt(9.81 * k), t = tRef.t; out.h = 0.5 * Math.cos(k * z - w * t); out.vy = 0.5 * w * Math.sin(k * z - w * t); return out; };

    test('waves: at full speed into a head sea it leaves the crests and lands again, upright', () => {
        const T = { t: 0 }, sea = swell(T);
        const p = boat('rhib', { sea });
        let air = 0, slams = 0, maxRoll = 0, maxPitch = 0, minPitch = 0;
        run(p, 40, FULL, 1 / 60, (q, t) => {
            T.t = t;
            if (q.airborne) air += 1 / 60;
            if (q.slam > 1) { slams++; q.slam = 0; }
            maxRoll = Math.max(maxRoll, Math.abs(q.roll)); maxPitch = Math.max(maxPitch, q.pitch); minPitch = Math.min(minPitch, q.pitch);
        });
        console.log(`  rhib into a 1 m head sea: ${air.toFixed(1)} s of 40 in the air, ${slams} landings, pitch ${(minPitch * 57.3).toFixed(0)}…${(maxPitch * 57.3).toFixed(0)}°, ${(p.u * B.KT).toFixed(0)} kt`);
        assert.ok(air > 2, 'airborne off the crests');
        assert.ok(slams >= 5, 'and slams back down');
        assert.ok(maxRoll < 0.3, 'upright');
        assert.ok(maxPitch < 0.4 && minPitch > -0.35, 'no somersaults');
        assert.ok(p.u * B.KT > 25 && p.u < B.BOAT_SPECS.rhib.top * 0.95, 'still going, slower than in a calm');
        // adrift in the same swell it rides up and down with it
        T.t = 0;
        const q = boat('rhib', { sea });
        let err = 0, n = 0;
        run(q, 30, { throttle: 0, steer: 0 }, 1 / 60, (b, t) => { T.t = t; if (t > 5) { err += Math.abs(b.y - sea(b.x, b.z, {}).h); n++; } });
        assert.ok(err / n < 0.15, 'rides the surface: mean |y − sea| ' + (err / n).toFixed(3) + ' m');
        assert.equal(q.airborne, false);
    });

    test('the same run at 30, 60 and 144 fps ends in the same place', () => {
        const prog = (t) => ({ throttle: t < 12 ? 1 : 0.4, steer: t > 8 && t < 14 ? 0.7 : t > 16 ? -0.5 : 0 });
        const end = [30, 60, 144].map(fps => {
            const p = boat('cb90');
            for (let t = 0; t < 20; t += 1 / fps) p.step(1 / fps, prog(t));
            return p;
        });
        const [a, b, c] = end;
        const dist = Math.hypot(b.x, b.z);
        for (const p of [a, c]) {
            assert.ok(Math.hypot(p.x - b.x, p.z - b.z) < dist * 0.01 + 1, 'position within 1%: ' + Math.hypot(p.x - b.x, p.z - b.z).toFixed(2) + ' m of ' + dist.toFixed(0));
            assert.ok(Math.abs(p.h - b.h) < 1 / 57.3, 'heading within 1°');
            assert.ok(Math.abs(p.u - b.u) < 0.2, 'speed');
        }
    });

    test('runs aground in the shallows, backs off again; a wall stops it', () => {
        // deep water south of z = −150, a shoal (30 cm) north of it: heading north (−z) at full power
        const p = boat('rhib', { ground: (x, z) => (z < -150 ? -0.3 : -20) });
        run(p, 30, FULL);
        assert.equal(p.grounded, true);
        assert.ok(p.u < 1, 'stopped on the shoal: ' + p.u.toFixed(2));
        const bow = p.z - B.BOAT_SPECS.rhib.L * 0.45;
        assert.ok(bow < -145 && bow > -175, 'bow on the shoal at ' + bow.toFixed(0));
        run(p, 10, { throttle: -1, steer: 0 });
        assert.equal(p.grounded, false, 'backed off');
        assert.ok(p.z > -140);
        // a pier face across its path at z = −100
        const q = boat('rhib');
        const r0 = B.BOAT_SPECS.rhib.B * 0.5 + 0.2;
        q.collide = (x, z, r) => (z < -100 + r ? { nx: 0, nz: 1, d: -100 + r - z } : null);
        run(q, 30, FULL);
        assert.ok(q.z >= -100 + r0 - 0.05, 'held off the wall: ' + q.z.toFixed(2));
        assert.ok(Math.abs(q.u) < 1.5, 'no speed through it');
        assert.ok(q.bump > 5, 'hit it hard (' + q.bump.toFixed(1) + ' m/s)');
    });
});

// a naval.js-style ship: steams round its orbit (Ship.place)
function orbitShip(x, z, heading) {
    const s = { orbit: { cx: 0, cz: 0, R: 1e7, a: 0, w: 0 }, mesh: { position: { x, y: 0, z } }, heading };
    s.place = (dt) => {
        const o = s.orbit;
        o.a += o.w * dt;
        const px = o.cx + Math.cos(o.a) * o.R, pz = o.cz + Math.sin(o.a) * o.R;
        const tx = -Math.sin(o.a) * Math.sign(o.w), tz = Math.cos(o.a) * Math.sign(o.w);
        s.heading = Math.atan2(-tx, -tz);
        s.v = Math.hypot(px - s.mesh.position.x, pz - s.mesh.position.z) / dt;
        s.mesh.position.x = px; s.mesh.position.z = pz;
    };
    return s;
}
describe('steering a naval.js ship (warrooms.js steerShip)', () => {
    test('holds a heading at a speed from where it is; turns at a yaw rate either way', () => {
        const s = orbitShip(1000, -500, 0.7);
        W.steerShip(s, 0.7, 5, 0);
        const x0 = s.mesh.position.x, z0 = s.mesh.position.z;
        s.place(1);
        assert.ok(Math.abs(s.heading - 0.7) < 1e-4, 'heading kept');
        assert.ok(Math.abs(s.v - 5) < 1e-3, 'speed ' + s.v);
        const dx = s.mesh.position.x - x0, dz = s.mesh.position.z - z0;
        assert.ok(Math.abs(dx - -Math.sin(0.7) * 5) < 1e-3 && Math.abs(dz - -Math.cos(0.7) * 5) < 1e-3, 'moved along the heading (0 = −z, + to port)');
        for (const rate of [0.02, -0.02]) {
            let h = s.heading;
            for (let i = 0; i < 100; i++) { W.steerShip(s, h, 6, rate); s.place(0.1); h = s.heading; }
            assert.ok(Math.abs(h - (0.7 + rate * 10)) < 0.01, 'turned ' + ((h - 0.7) * 57.3).toFixed(1) + '° in 10 s at ' + (rate * 57.3).toFixed(1) + '°/s');
            W.steerShip(s, 0.7, 6, 0); s.place(1e-3); // back on course
            assert.ok(Math.abs(s.heading - 0.7) < 1e-3);
        }
    });
});

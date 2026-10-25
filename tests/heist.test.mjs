// Grand Theft Aero (heist.js): driving the stolen car around MCAS Miramar. The real airbase dressing (airbase.js)
// is built headlessly into real buildings records, and the car's own collision (GroundStart.canMove) is asked
// where it may go: the hangars, offices and parked aircraft stop it, the open apron, grass, streets and runways
// between them don't (hand-drawn boxes once walled off the whole flight line and the base's streets).
import { src } from './helpers/setup.mjs';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const { Buildings, WORLD_BUILDINGS } = await src('buildings.js');
const { Airbases } = await src('airbase.js');
const { GroundStart, carStep, CAR } = await src('groundstart.js');
const { HEIST_JET } = await src('heist.js');
const { BASES, baseToWorld, fenceOf, gateOf, worldToBase } = await src('world.js');

after(() => { WORLD_BUILDINGS.current = null; });

const scene = new THREE.Scene();
const bl = new Buildings(scene);
new Airbases(scene);
bl.index();
const mir = BASES.find(b => b.id === 'miramar');

// the stolen car's collision as the heist sets it up (no hand-drawn obstacles), without the scene or a character
const gs = Object.assign(Object.create(GroundStart.prototype), {
    base: mir, fence: fenceOf(mir), gate: gateOf(mir), obstacles: [], cleared: true,
    game: { world: { towns: { buildings: bl } } },
});
const at = (lx, lz) => { const w = baseToWorld(mir, lx, lz); return new THREE.Vector3(w.x, mir.h, w.z); };
// can the car (2.5 m) roll 1 m along +x from base-local (lx, lz)?
const drivable = (lx, lz) => gs.canMove(at(lx, lz), at(lx + 1, lz), 2.5) === 'ok';

describe('heist: driving around Miramar', () => {
    test('the heist hands the car no hand-drawn boxes', async () => {
        const src0 = (await import('node:fs')).readFileSync(new URL('../src/heist.js', import.meta.url), 'utf8');
        assert.match(src0, /obstacles: \[\]/);
    });

    test('open apron, grass, streets and runways are drivable', () => {
        const open = {
            'apron between the F/A-18 rows': [115, 0], 'apron between the F-35 and F/A-18 rows': [335, -500],
            'apron edge by the C-130s': [600, -1000], 'grass between the flight line and the hangars': [620, 400],
            'between two hangars': [700, -1210], 'the strip behind the hangars': [765, 600],
            'a street between the offices': [895, 150], 'the main road in': [1000, -300],
            'runway 1': [-520, 0], 'runway 2': [-220, 800], 'grass between the runways': [-370, -800],
            'the taxiway': [-60, 500], 'by the jet to steal': [HEIST_JET.lx + 25, HEIST_JET.lz],
        };
        for (const [name, [lx, lz]] of Object.entries(open)) assert.ok(drivable(lx, lz), name + ' (' + lx + ', ' + lz + ') is open');
    });

    test('the hangars, offices and parked aircraft are solid', () => {
        // a hangar's middle; a parked Hornet, F-35 and C-130 where the rows put them
        for (const [name, lx, lz] of [['hangar', 700, -1350], ['F/A-18', 60, -1350], ['F-35', 280, -1350 + 34 * 10], ['C-130', 530, -1350]])
            assert.ok(!drivable(lx, lz), name + ' at (' + lx + ', ' + lz + ') blocks the car');
        // most of the office blocks' footprint centres (a few lots are left empty) are solid
        let solid = 0, n = 0;
        for (const r of bl.list) {
            if (r.kind !== 'office') continue;
            const l = worldToBase(mir, r.x, r.z);
            if (l.lx < 800 || l.lx > 1400) continue;
            n++; if (!drivable(l.lx, l.lz)) solid++;
        }
        assert.ok(n > 100 && solid === n, solid + ' of ' + n + ' Miramar offices block the car');
    });
});

// the handling (groundstart.js carStep) on its own: a car record, keys held for a time, at a frame rate
const car = (o = {}) => ({ v: 0, yaw: 0, steer: 0, yawRate: 0, maxV: 52, accel: 7.5, ...o });
function hold(c, thr, steer, secs, fps = 60, each = null) {
    for (let i = 0, n = Math.round(secs * fps); i < n; i++) { carStep(c, thr, steer, 1 / fps); if (each) each(c); }
    return c;
}
const DEG = 180 / Math.PI;

describe('car handling', () => {
    test('full lock at speed: the turn is as wide as the tyres need (no 24 g flick)', () => {
        for (const kmh of [60, 100, 130, 180]) {
            const v = kmh / 3.6, c = hold(car({ v }), 0, 1, 3, 60, (q) => { q.v = v; }); // held at that speed
            const lat = Math.abs(c.v * c.yawRate);
            assert.ok(lat <= CAR.grip * 1.02, kmh + ' km/h: ' + lat.toFixed(1) + ' m/s² sideways (grip ' + CAR.grip + ')');
            assert.ok(lat > CAR.grip * 0.7, kmh + ' km/h: still turns properly (' + lat.toFixed(1) + ' m/s²)');
        }
        // at 130 km/h: well under 30°/s (it was about 380°/s)
        const c = hold(car({ v: 36 }), 0, 1, 3, 60, (q) => { q.v = 36; });
        assert.ok(Math.abs(c.yawRate) * DEG < 30, (Math.abs(c.yawRate) * DEG).toFixed(1) + '°/s');
    });

    test('slow: full lock turns on a kerb-to-kerb circle', () => {
        const c = car({ v: 4, maxV: 4 });
        hold(c, 1, 1, 3);
        const R = c.v / c.yawRate;
        assert.ok(R > 4 && R < 6, 'radius ' + R.toFixed(2) + ' m');
    });

    test('a tap of the key at 150 km/h is a nudge, and the yaw never jerks', () => {
        const c = car({ v: 150 / 3.6 });
        const keep = (q) => { q.v = 150 / 3.6; };
        hold(c, 0, 1, 0.1, 60, keep); hold(c, 0, 0, 1.5, 60, keep);
        assert.ok(Math.abs(c.yaw) * DEG < 2.5, 'heading changed ' + (c.yaw * DEG).toFixed(2) + '°');
        // full left to full right at 100 km/h, 30 fps: the yaw rate swings over (about 0.6 s) rather than snapping
        const d = car({ v: 100 / 3.6 }); let last = 0, worst = 0;
        const k100 = (q) => { q.v = 100 / 3.6; };
        hold(d, 0, 1, 1.5, 30, k100); last = d.yawRate;
        hold(d, 0, -1, 1.5, 30, (q) => { k100(q); worst = Math.max(worst, Math.abs(q.yawRate - last)); last = q.yawRate; });
        assert.ok(worst * DEG < 4, 'worst frame-to-frame change ' + (worst * DEG).toFixed(2) + '°/s');
    });

    test('pulls hard off the line, tops out at its top speed, brakes harder than it accelerates', () => {
        const c = car(); let t100 = 0, t = 0;
        hold(c, 1, 0, 30, 60, (q) => { t += 1 / 60; if (!t100 && q.v >= 100 / 3.6) t100 = t; });
        assert.ok(t100 > 3 && t100 < 5, '0–100 km/h in ' + t100.toFixed(2) + ' s');
        assert.ok(c.v <= c.maxV && c.v > c.maxV * 0.98, 'top ' + (c.v * 3.6).toFixed(0) + ' km/h');
        const b = car({ v: 100 / 3.6 }); let tb = 0;
        hold(b, -1, 0, 3, 60, (q) => { if (q.v > 0.5) tb += 1 / 60; });
        assert.ok(tb < 2, '100–0 in ' + tb.toFixed(2) + ' s');
        assert.ok(b.v < 0 && b.v >= -CAR.reverse, 'then reverses, slowly');
        // a sports car is quicker still
        const s = car({ maxV: 64, accel: 10 }); let ts = 0; t = 0;
        hold(s, 1, 0, 6, 60, (q) => { t += 1 / 60; if (!ts && q.v >= 100 / 3.6) ts = t; });
        assert.ok(ts < t100 && ts < 3.5, 'sports car 0–100 in ' + ts.toFixed(2) + ' s');
    });

    test('the same drive at 30 and 120 fps ends up in the same place', () => {
        const run = (fps) => {
            const c = car(); let x = 0, z = 0;
            const leg = (thr, st, secs) => hold(c, thr, st, secs, fps, (q) => { x += -Math.sin(q.yaw) * q.v / fps; z += -Math.cos(q.yaw) * q.v / fps; });
            leg(1, 0, 4); leg(1, 1, 2); leg(0, 0, 1); leg(-1, -1, 1.5); leg(1, 0, 2);
            return { x, z, yaw: c.yaw };
        };
        const a = run(30), b = run(120);
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 3, 'apart by ' + Math.hypot(a.x - b.x, a.z - b.z).toFixed(2) + ' m');
        assert.ok(Math.abs(a.yaw - b.yaw) * DEG < 2, 'headings ' + (a.yaw * DEG).toFixed(1) + '° vs ' + (b.yaw * DEG).toFixed(1) + '°');
    });

    test('the body leans out of a turn and squats under power', () => {
        const c = hold(car({ v: 25 }), 0, 1, 2, 60, (q) => { q.v = 25; }); // turning left
        assert.ok(c.lean < -0.02, 'rolls to the right (outside): ' + (c.lean * DEG).toFixed(1) + '°');
        const d = hold(car(), 1, 0, 0.6);
        assert.ok(d.dive > 0.005, 'nose up accelerating: ' + (d.dive * DEG).toFixed(2) + '°');
        hold(d, -1, 0, 0.5);
        assert.ok(d.dive < -0.005, 'nose down braking: ' + (d.dive * DEG).toFixed(2) + '°');
    });
});

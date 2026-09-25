// Flight-model envelope: builds every aircraft headlessly (procedural model, stub game) and flies
// it level at full throttle with Aircraft.updateFlight until the speed settles, at sea level, 5 km
// and 11 km. The sea-level and 11 km numbers are the two calibration points in config.js
// (`speed`, `mach`), so they must come out on target. Also checks every type can still take off,
// climb and land: takeoff roll, sea-level climb rate, approach speed vs the touchdown limit.
import { src } from './helpers/setup.mjs';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeAircraft, soundSpeed, levelFlight, stubGame } from './helpers/flight.mjs';

const { AIRCRAFT } = await src('config.js');
const { maxMach, refSpeeds, flightCalibration } = await src('aircraft.js');

const HIGH = 11000;
const types = Object.keys(AIRCRAFT);
const isJet = (s) => !(s.category === 'civil' || s.prop);
const results = {};

// Fly straight and level at `alt` from V0 until the speed settles (thrust = drag with 1 G of lift).
function levelTopSpeed(ac, alt, V0, throttle = 1, maxT = 900) {
    const run = levelFlight(ac, alt, V0, throttle);
    let lastCheck = V0, t = 0;
    for (let i = 0; t < maxT; i++) {
        run.step(0.05); t += 0.05;
        if (i % 200 === 199) { // every 10 s
            if (Math.abs(ac.speed - lastCheck) < 0.05) break;
            lastCheck = ac.speed;
        }
    }
    return { V: ac.speed, mach: ac.speed / soundSpeed(alt), t };
}

// Best sea-level climb rate (m/s): specific excess power V·(T−D)/W at 1 G, maximised over speed
function bestClimb(ac) {
    const f = ac.spec.flight, rs = refSpeeds(ac.spec);
    let best = 0, bestV = 0;
    for (let V = rs.stall * 1.3; V < f.speed * 0.95; V += Math.max(2, f.speed / 60)) {
        const run = levelFlight(ac, 0, V, 1);
        for (let i = 0; i < 40; i++) run.step(0.05, V); // settle AoA, hold the speed
        const v0 = ac.speed;
        run.step(0.05);
        const acc = (ac.speed - v0) / 0.05;
        if (acc * V / 9.81 > best) { best = acc * V / 9.81; bestV = V; }
    }
    return { rate: best, V: bestV };
}

// Full-throttle takeoff roll on a flat runway, rotating at the takeoff speed like the autopilot does
function takeoffRoll(ac) {
    ac.spawnRunway({ x: 0, h: 0, z: 0, heading: 0 });
    ac.controls.throttle = 1;
    const rs = refSpeeds(ac.spec);
    const x0 = ac.pos.clone();
    for (let t = 0; t < 120; t += 0.02) {
        ac.controls.pitch = ac.relSpeed > rs.takeoff ? 0.7 : 0;
        ac.updateFlight(0.02);
        if (!ac.onGround) return { dist: ac.pos.distanceTo(x0), V: ac.speed, t };
    }
    return { dist: Infinity, V: ac.speed, t: 120 };
}

before(() => {
    for (const id of types) {
        const spec = AIRCRAFT[id], f = spec.flight;
        const ac = makeAircraft(id);
        const mm = maxMach(id);
        const sea = levelTopSpeed(ac, 0, f.speed * 0.8);
        // start at M0.9 (or 90% of the target for slow types) so the transonic hump must be crossed
        const high = levelTopSpeed(ac, HIGH, Math.min(0.9, mm * 0.9) * soundSpeed(HIGH));
        const mid = levelTopSpeed(ac, 5000, Math.min(0.9, mm * 0.9) * soundSpeed(5000));
        const milHigh = isJet(spec) ? levelTopSpeed(ac, HIGH, 0.85 * soundSpeed(HIGH), 0.9) : null;
        // can it hold 1 G at MMAX up there at all? (C_L needed vs CL_MAX 1.65)
        const Vm = mm * soundSpeed(HIGH);
        const clNeed = 9.81 / (ac.liftK * Vm * Vm * Math.exp(-HIGH / 9000));
        const climb = bestClimb(ac);
        const to = takeoffRoll(makeAircraft(id, { game: stubGame({ runway: true }) }));
        results[id] = { ac, sea, high, mid, milHigh, mm, clNeed, climb, to, ref: refSpeeds(spec), cal: flightCalibration(id) };
    }
    const p = (v, n, d = 0) => (v == null ? '-' : v.toFixed(d)).padStart(n);
    const rows = types.map(id => {
        const r = results[id], f = AIRCRAFT[id].flight;
        return `${id.padEnd(8)}${p(f.speed / 340, 5, 2)}${p(r.sea.mach, 6, 2)}${p(r.sea.V, 5)}  ${p(r.mm, 5, 2)}${p(r.high.mach, 6, 2)}${p(r.mid.mach, 6, 2)}${p(r.milHigh?.mach, 6, 2)}` +
            `  ${p(r.cal.cd0, 7, 4)}${p(r.cal.waveK, 6, 2)}${p(r.cal.ramK, 6, 2)}   ${p(r.climb.rate, 5)}${p(r.to.dist, 6)}${p(r.ref.approach * 1.944, 6)}` +
            `${r.clNeed > 1.65 ? '  (cannot hold 1G at MMAX/11km)' : ''}`;
    });
    console.log('\nLevel-flight top speed, full throttle (Mach; SL also m/s), fitted drag/thrust terms, flyability:\n' +
        'type    SLtgt  SL M  m/s  11tgt 11km M  5km M mil11k      cd0 waveK  ramK   climb   TOroll appKT\n' + rows.join('\n') + '\n');
});

describe('flight envelope', () => {
    for (const id of types) {
        describe(id, () => {
            const r = () => results[id];
            const f = AIRCRAFT[id].flight;
            test('refSpeeds ordering: stall < takeoff < approach, all below sea-level top speed', () => {
                const { ref, sea } = r();
                for (const k of ['stall', 'takeoff', 'approach']) assert.ok(Number.isFinite(ref[k]) && ref[k] > 0, `${k}=${ref[k]}`);
                assert.ok(ref.stall < ref.takeoff, `stall ${ref.stall.toFixed(1)} < takeoff ${ref.takeoff.toFixed(1)}`);
                assert.ok(ref.takeoff < ref.approach, `takeoff ${ref.takeoff.toFixed(1)} < approach ${ref.approach.toFixed(1)}`);
                assert.ok(ref.approach < sea.V, `approach ${ref.approach.toFixed(1)} < top speed ${sea.V.toFixed(1)}`);
            });

            test('sea-level top speed matches config speed (+-0.03 Mach)', () => {
                const { sea } = r();
                assert.ok(Number.isFinite(sea.V));
                assert.ok(Math.abs(sea.V - f.speed) <= 0.03 * 340, `SL top ${sea.V.toFixed(1)} m/s vs target ${f.speed}`);
            });

            test('calibration terms are sane (wave drag and ram gain >= 0, cd0 > 0)', () => {
                const { cal } = r();
                assert.ok(cal.cd0 > 0 && cal.waveK >= 0 && cal.ramK >= 0, JSON.stringify(cal));
                assert.ok(cal.ramK < 2 && cal.waveK < 20, JSON.stringify(cal));
            });

            test('top speed at 11 km matches config mach (+-0.03 Mach)', (t) => {
                if (r().clNeed > 1.65) { t.skip(`cannot hold 1 G at M${r().mm} at 11 km (C_L ${r().clNeed.toFixed(2)} needed)`); return; }
                const d = r().high.mach - r().mm;
                assert.ok(Math.abs(d) <= 0.03, `reached M${r().high.mach.toFixed(3)}, target ${r().mm} (after ${r().high.t.toFixed(0)} s)`);
            });

            test('mid altitude (5 km) top speed sits between the calibration points', (t) => {
                if (r().clNeed > 1.65) { t.skip('slow type'); return; }
                const { sea, mid, high } = r();
                // the MiG-25's low-level drag wall holds it near M1 until it is high up; everyone else interpolates
                assert.ok(mid.mach >= sea.mach - 0.02 && mid.mach <= high.mach + 0.02, `5 km M${mid.mach.toFixed(2)} vs SL M${sea.mach.toFixed(2)} / 11 km M${high.mach.toFixed(2)}`);
            });

            if (isJet(AIRCRAFT[id]) && AIRCRAFT[id].flight.afterburner !== false) {
                test('military power (no afterburner) at 11 km is well below the afterburner top speed', () => {
                    const { milHigh, high } = r();
                    assert.ok(milHigh.mach < high.mach - 0.3 && milHigh.mach < 1.3, `mil M${milHigh.mach.toFixed(2)} vs AB M${high.mach.toFixed(2)}`);
                });
            }

            test('takes off within a 3 km runway', () => {
                const { to } = r();
                assert.ok(to.dist < 2600, `liftoff after ${to.dist.toFixed(0)} m (${to.t.toFixed(1)} s)`);
            });

            test('climbs at a sane rate at sea level', () => {
                const { climb } = r();
                const s = AIRCRAFT[id];
                const floor = s.category === 'fighter' ? (s.flight.afterburner === false ? 25 : 100) : s.category === 'bomber' ? 15 : s.category === 'racer' ? 12 : 3;
                assert.ok(climb.rate > floor && climb.rate < 400, `best climb ${climb.rate.toFixed(1)} m/s at ${climb.V.toFixed(0)} m/s (floor ${floor})`);
            });

            test('approach speed is below the touchdown speed limit (0.6 x speed)', () => {
                const { ref } = r();
                assert.ok(ref.approach < f.speed * 0.6, `approach ${ref.approach.toFixed(1)} vs limit ${(f.speed * 0.6).toFixed(1)}`);
            });
        });
    }
});

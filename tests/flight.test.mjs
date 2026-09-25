// Flight-model envelope: builds every aircraft headlessly (procedural model, stub game) and flies
// it level at full afterburner with Aircraft.updateFlight until the speed settles.
import { src } from './helpers/setup.mjs';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const { AIRCRAFT } = await src('config.js');
const { Aircraft, maxMach, refSpeeds } = await src('aircraft.js');

// Known problems (documented, not hidden): these fail today and are reported as TODO.
//  mig29: the wave-drag fit solves to a negative strength (about -0.07) and is clamped to 0,
//         so the jet can't reach its MMAX of 2.25 (tops out near M2.21).
const KNOWN_BAD_WAVE_FIT = {};

const soundSpeed = (h) => 340 - Math.max(h, 0) * 0.004; // same as aircraft.js (not exported)
const HIGH = 11000;
const DT = 0.05;

function stubGame() {
    return {
        scene: { add() {}, remove() {} },
        events: { emit() {} },
        settings: { fuel: false },
        audio: { tick() {}, say() {} },
        effects: null,
        world: null,
        wind: null,
        time: 0,
        addFeed() {},
        surfaceAt: () => ({ h: -1e6 }), // nothing to hit
    };
}

function make(typeId) {
    const ac = new Aircraft(stubGame(), typeId, { team: 'blue' });
    ac.spawnAir({ x: 0, y: 0, z: 0, isVector3: true }, 0, 0.5);
    return ac;
}

// Fly straight and level at `alt`, full throttle (afterburner), starting at V0 m/s.
// Altitude and heading are held by re-levelling the state after every step, so the result is
// the thrust = drag speed with 1 G of lift (induced drag included).
function levelTopSpeed(ac, alt, V0, maxT = 900) {
    ac.pos.set(0, alt, 0);
    ac.qv.identity();
    ac.vel.set(0, 0, -V0);
    ac.alpha = 0.03; ac.beta = 0; ac.rollRate = 0;
    ac.throttle = 1;
    Object.assign(ac.controls, { pitch: 0, roll: 0, yaw: 0, throttle: 1 });
    let lastCheck = V0, t = 0;
    for (let i = 0; t < maxT; i++) {
        ac.updateFlight(DT);
        t += DT;
        const V = ac.vel.length();
        ac.vel.set(0, 0, -V);
        ac.qv.identity();
        ac.pos.set(0, alt, 0);
        if (i % 200 === 199) { // every 10 s
            if (Math.abs(V - lastCheck) < 0.05) break;
            lastCheck = V;
        }
    }
    const V = ac.vel.length();
    return { V, mach: V / soundSpeed(alt), t };
}

const types = Object.keys(AIRCRAFT);
const results = {};

before(() => {
    for (const id of types) {
        const ac = make(id);
        const f = AIRCRAFT[id].flight;
        const sea = levelTopSpeed(ac, 200, f.speed * 0.8);
        // start at M0.9 (or 90% of the target for slow types) so the transonic hump must be crossed
        const mm = maxMach(id);
        const high = levelTopSpeed(ac, HIGH, Math.min(0.9, mm * 0.9) * soundSpeed(HIGH));
        // can it hold 1 G at MMAX up there at all? (C_L needed vs CL_MAX 1.65)
        const Vm = mm * soundSpeed(HIGH);
        const clNeed = 9.81 / (ac.liftK * Vm * Vm * Math.exp(-HIGH / 9000));
        results[id] = { ac, sea, high, mm, clNeed, ref: refSpeeds(AIRCRAFT[id]) };
    }
    const rows = types.map(id => {
        const r = results[id];
        return `${id.padEnd(8)} ${String(AIRCRAFT[id].flight.speed).padStart(5)} ${r.sea.V.toFixed(0).padStart(6)} ${r.sea.mach.toFixed(2).padStart(6)}   ` +
            `${r.high.V.toFixed(0).padStart(6)} ${r.high.mach.toFixed(2).padStart(6)} ${r.mm.toFixed(2).padStart(6)} ${(r.high.mach - r.mm >= 0 ? '+' : '') + (r.high.mach - r.mm).toFixed(3)}` +
            `  waveK=${r.ac.waveK.toFixed(3)}${r.clNeed > 1.65 ? '  (cannot hold 1G at MMAX/11km)' : ''}`;
    });
    console.log('\nLevel-flight top speed, full throttle (m/s, Mach):\n' +
        'type     spec  SL m/s  SL M    11km m/s 11km M  MMAX   delta\n' + rows.join('\n') + '\n');
});

describe('flight envelope', () => {
    for (const id of types) {
        describe(id, () => {
            test('refSpeeds ordering: stall < takeoff < approach, all below sea-level top speed', () => {
                const { ref, sea } = results[id];
                for (const k of ['stall', 'takeoff', 'approach']) assert.ok(Number.isFinite(ref[k]) && ref[k] > 0, `${k}=${ref[k]}`);
                assert.ok(ref.stall < ref.takeoff, `stall ${ref.stall.toFixed(1)} < takeoff ${ref.takeoff.toFixed(1)}`);
                assert.ok(ref.takeoff < ref.approach, `takeoff ${ref.takeoff.toFixed(1)} < approach ${ref.approach.toFixed(1)}`);
                assert.ok(ref.approach < sea.V, `approach ${ref.approach.toFixed(1)} < top speed ${sea.V.toFixed(1)}`);
            });

            test('sea-level top speed is finite and near the spec speed', () => {
                const { sea } = results[id];
                const spec = AIRCRAFT[id].flight.speed;
                assert.ok(Number.isFinite(sea.V));
                // spec speed ignores induced/wave drag, so the real number sits a little below (or above with ram)
                assert.ok(sea.V > spec * 0.75 && sea.V < spec * 1.15, `SL top ${sea.V.toFixed(0)} vs spec ${spec}`);
            });

            const r = () => results[id];
            const known = KNOWN_BAD_WAVE_FIT[id];
            test('fitted wave-drag strength is positive (a clamped 0 means the fit went negative)', { todo: known || false }, () => {
                assert.ok(r().ac.waveK > 0, `waveK=${r().ac.waveK}`);
            });

            test('top speed at 11 km matches MMAX (+-0.03 Mach)', { todo: known || false }, (t) => {
                if (r().clNeed > 1.65) { t.skip(`cannot hold 1 G at M${r().mm} at 11 km (C_L ${r().clNeed.toFixed(2)} needed)`); return; }
                const d = r().high.mach - r().mm;
                assert.ok(Math.abs(d) <= 0.03, `reached M${r().high.mach.toFixed(3)}, MMAX ${r().mm} (after ${r().high.t.toFixed(0)} s)`);
            });
        });
    }
});

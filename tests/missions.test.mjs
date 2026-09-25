import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { dailyMission, MISSIONS } = await src('missions.js');
const { AIRCRAFT, TIMES } = await src('config.js');
const { maxMach } = await src('aircraft.js');

// every day for ~3 years
const days = [];
for (let d = new Date(2025, 0, 1); d < new Date(2028, 0, 1); d.setDate(d.getDate() + 1)) days.push(new Date(d));

describe('dailyMission', () => {
    test('is deterministic for a date (and ignores the time of day)', () => {
        for (const d of days.slice(0, 60)) {
            const a = dailyMission(d);
            const b = dailyMission(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59));
            assert.deepEqual({ ...a, def: undefined }, { ...b, def: undefined });
            assert.equal(a.def, b.def);
        }
    });

    test('key is the local YYYY-MM-DD of the date', () => {
        assert.equal(dailyMission(new Date(2026, 8, 4)).key, '2026-09-04');
        assert.equal(dailyMission(new Date(2026, 11, 31, 23, 30)).key, '2026-12-31');
    });

    test('always returns a real mission, fighter and time of day', () => {
        for (const d of days) {
            const m = dailyMission(d);
            assert.ok(MISSIONS[m.id], `unknown mission ${m.id} on ${m.key}`);
            assert.equal(m.def, MISSIONS[m.id]);
            assert.ok(AIRCRAFT[m.aircraft], `unknown aircraft ${m.aircraft} on ${m.key}`);
            assert.equal(AIRCRAFT[m.aircraft].category, 'fighter', `${m.aircraft} on ${m.key}`);
            assert.ok(TIMES[m.time], `unknown time ${m.time} on ${m.key}`);
        }
    });

    test('varies from day to day (several missions and jets over a year)', () => {
        const year = days.slice(0, 365).map(d => dailyMission(d));
        assert.ok(new Set(year.map(m => m.id)).size >= Math.min(5, Object.keys(MISSIONS).length));
        assert.ok(new Set(year.map(m => m.aircraft)).size >= 10);
        assert.ok(new Set(year.map(m => m.key)).size === 365);
    });

    test('never picks the F-35 comparison model (f35n)', () => {
        const hits = days.map(d => dailyMission(d)).filter(m => m.aircraft === 'f35n').map(m => m.key);
        assert.deepEqual(hits, [], `f35n picked on ${hits.length} days, e.g. ${hits.slice(0, 5).join(', ')}`);
    });

    test('air-to-air / non-strike missions never hand out a subsonic jet (e.g. the A-10)', () => {
        const bad = days.map(d => dailyMission(d))
            .filter(m => m.def.tag !== 'STRIKE' && maxMach(m.aircraft) < 1)
            .map(m => `${m.key} ${m.id} ${m.aircraft}`);
        assert.deepEqual(bad, []);
    });
});

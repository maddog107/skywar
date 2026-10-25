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
const { GroundStart } = await src('groundstart.js');
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

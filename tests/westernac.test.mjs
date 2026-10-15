// The Western fighters and the airliner rebuilt from licensed models (tools/aircraft/IMPORTS.md, "Western types
// rebuilt"): F-4E, F-5E, Mirage 5F, Jaguar, F-35C (id f35n) and the 747-400. Each has its config entry, a model entry
// whose file exists and is shaped like the real aircraft (span / length from the GLB's own bounds), textured paint,
// rig points (cockpit eye, nozzles) inside the airframe, flaps and speed brakes defined where the real jet has them,
// the stores and livery parts it was built with, and its credits. The GLBs are read from their JSON chunk only (no
// WebGL, no image decoding).
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const { AIRCRAFT } = await src('config.js');
const { MODEL_FILES } = await src('models.js');
const { SURFACE_DEFS } = await src('surfacedefs.js');
const repo = new URL('../', import.meta.url);

// type → real length / span (m), flap and brake surface counts, materials its model must have, and the source
const TYPES = {
    f4: { name: /F-4E/, length: 19.2, span: 11.7, flaps: 2, brakes: 1, mats: [], src: 'f4-f7d8189af9fb40db9b4968830aabe29e', tris: [20000, 60000] },
    f5: { name: /F-5E/, length: 14.5, span: 8.1, flaps: 1, brakes: 1, mats: ['Store', 'Seeker'], src: 'f5-8089d66a8a8748b2a4b049b3c06f6a02', tris: [10000, 60000] },
    mirage: { name: /Mirage 5F/, length: 15.55, span: 8.22, flaps: 0, brakes: 2, mats: [], src: 'dassault-mirage-5-f0773e28da464309957c942543564305', tris: [10000, 60000] },
    jaguar: { name: /Jaguar/, length: 16.8, span: 8.7, flaps: 2, brakes: 1, mats: ['Store', 'Seeker', 'Pylon', 'Launcher'], src: 'jaguar-b09a0ee965bb424aaf14ebd06b698f96', tris: [10000, 60000] },
    f35n: { name: /F-35C/, length: 15.7, span: 13.1, flaps: 1, brakes: 0, mats: [], src: 'low-poly-11-usaf-f35a-dc727cb5c1404f26b3a29a7e2d50bb2b', tris: [2500, 60000] },
    b747: { name: /747-400/, length: 70.6, span: 64.4, flaps: 2, brakes: 2, mats: ['Fuselage', 'Fin', 'Window', 'Door', 'EngineCowl'], src: 'boeing747-4eadf04e705b41a2b272ee5aed4d01d5', tris: [20000, 60000] },
};

function glb(file) {
    const buf = readFileSync(file);
    assert.equal(buf.readUInt32LE(0), 0x46546c67, 'glTF magic');
    const len = buf.readUInt32LE(12);
    return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

// bounds of every POSITION accessor (the importer writes one mesh at the origin, no node transforms) and triangles
function stats(doc) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    let tris = 0;
    for (const m of doc.meshes || []) for (const p of m.primitives) {
        const a = doc.accessors[p.attributes.POSITION];
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], a.min[i]); mx[i] = Math.max(mx[i], a.max[i]); }
        tris += (p.indices != null ? doc.accessors[p.indices].count : a.count) / 3;
    }
    return { mn, mx, size: mx.map((v, i) => v - mn[i]), tris };
}

describe('Western types rebuilt from licensed models', () => {
    const main = readFileSync(new URL('src/main.js', repo), 'utf8');
    const credits = readFileSync(new URL('models/aircraft/CREDITS.md', repo), 'utf8');
    for (const [id, t] of Object.entries(TYPES)) {
        test(`${id}: entries, a model shaped like the real one, textured, credited`, () => {
            const s = AIRCRAFT[id];
            assert.ok(s, 'AIRCRAFT entry');
            assert.match(s.name, t.name);
            assert.ok(Math.abs(s.length - t.length) < 0.06 && Math.abs(s.span - t.span) < 0.06, `${id} dimensions ${s.length} × ${s.span}`);
            const m = MODEL_FILES[id];
            assert.ok(m && m.file && m.file.startsWith('aircraft/'), 'MODEL_FILES entry');
            const file = new URL(`models/${m.file}`, repo);
            assert.ok(existsSync(file), `model file ${m.file}`);
            const doc = glb(file);
            const st = stats(doc);
            // glTF is Y up with the nose toward −Z: the length runs along Z, the span along X
            assert.ok(st.size[2] > st.size[0] && st.size[2] > st.size[1], `${id}: longest along the fuselage`);
            const ratio = st.size[0] / st.size[2], real = t.span / t.length;
            assert.ok(Math.abs(ratio / real - 1) < 0.12, `${id}: span/length ${ratio.toFixed(3)} against the real ${real.toFixed(3)}`);
            // centred (the game scales and places it by its bounds)
            for (let i = 0; i < 3; i++) assert.ok(Math.abs(st.mn[i] + st.mx[i]) < 0.02 * st.size[2], `${id} centred on axis ${i}`);
            assert.ok(st.tris >= t.tris[0] && st.tris <= t.tris[1], `${id}: ${st.tris} triangles`);
            // paint is texture, not flat colour; the parts it was built with are there
            assert.ok((doc.images || []).length >= 1, `${id} has textures`);
            assert.ok((doc.materials || []).some(x => x.pbrMetallicRoughness?.baseColorTexture), `${id}: a textured material`);
            const names = new Set((doc.materials || []).map(x => x.name));
            for (const n of t.mats) assert.ok(names.has(n), `${id}: material ${n}`);
            // credited in the game and in the credits file
            assert.ok(main.includes(t.src), `${id}: in-game credit (main.js buildCredits)`);
            assert.ok(credits.includes(t.src), `${id}: models/aircraft/CREDITS.md`);
        });

        test(`${id}: rig points inside the airframe, surfaces where the real jet has them`, () => {
            const m = MODEL_FILES[id];
            if (m.cockpit) {
                const [y, z] = m.cockpit;
                assert.ok(Math.abs(y) < 0.1 && z < -0.1 && z > -0.5, `${id} cockpit eye [${y}, ${z}] forward, on the fuselage`);
            }
            for (const n of m.nozzles || []) {
                assert.ok(Math.abs(n[0]) < 0.1 && Math.abs(n[1]) < 0.12 && n[2] > 0.25 && n[2] <= 0.5, `${id} nozzle ${n} aft, under the tail`);
            }
            if (m.nozzles?.length === 2) assert.ok(Math.abs(m.nozzles[0][0] + m.nozzles[1][0]) < 1e-3, `${id}: twin nozzles mirrored`);
            const d = SURFACE_DEFS[id] || {};
            assert.equal((d.flaps || []).length, t.flaps, `${id} flaps`);
            assert.equal((d.brakes || []).length, t.brakes, `${id} speed brakes`);
            for (const s of [...(d.flaps || []), ...(d.brakes || [])]) {
                const pts = s.top || [];
                assert.ok(pts.length >= 3, `${id}: an outline`);
                for (const [x, z] of pts) assert.ok(Math.abs(x) <= 0.5 && Math.abs(z) <= 0.5, `${id}: outline inside the model`);
                const [lo, hi] = s.y;
                assert.ok(lo < hi, `${id}: height band`);
                // flaps (and lower / ventral panels) go down, upper-skin panels up; the hinge is at the outline's front
                if (d.flaps?.includes(s)) assert.ok(s.angle > 0, `${id}: flap goes down`);
                if (s.skin === 1) assert.ok(s.angle < 0, `${id}: upper panel rises`);
                if (s.skin === -1) assert.ok(s.angle > 0, `${id}: lower panel drops`);
                const zf = Math.min(...pts.map(p => p[1]));
                assert.ok(s.hinge.every(h => h[2] <= Math.max(...pts.map(p => p[1])) && h[2] >= zf - 0.01), `${id}: hinge on the outline`);
            }
        });
    }

    test('F-35C: the carrier variant (bigger wing than the A, Navy markings painted, bays closed)', () => {
        const a = stats(glb(new URL('models/aircraft/f35.glb', repo))), c = stats(glb(new URL('models/aircraft/f35c.glb', repo)));
        assert.ok(c.size[0] / c.size[2] > 1.15 * a.size[0] / a.size[2], 'span/length well above the A\'s');
        assert.ok(Math.abs(c.size[2] / a.size[2] - 1) < 0.01, 'same length');
        assert.ok(c.mn[1] > a.mn[1], 'nothing hangs below the belly (bay doors and weapons gone)');
        assert.equal(AIRCRAFT.f35n.category, 'fighter');   // fighters carry the tail hook (aircraft.js buildGear)
    });

    test('747: the livery is the fictional Aurelia Pacific (no real airline\'s name in the paint script)', () => {
        const paint = readFileSync(new URL('tools/aircraft/paint_b747.py', repo), 'utf8');
        assert.match(paint, /AURELIA PACIFIC/);
        assert.match(paint, /fictional airline/);
    });
});

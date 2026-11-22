// The towns' buildings as they're drawn (towns.js + facades.js), built headless: the records the rest of the game
// plays against (collisions, line of sight, missions) are exactly what they were before the facades and roofs were
// redone; everything hung on a building (roof, plant, balconies, chimneys…) is a part of its record, comes down with
// it and is put back by reset(); the shaders can tell a burnt instance from one as built; the 'low' look.
import { src } from './helpers/setup.mjs';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const { Towns, storeysOf } = await src('towns.js');
const { WORLD_BUILDINGS } = await src('buildings.js');
const F = await src('facades.js');

const T = new Towns(new THREE.Scene(), { scene: new THREE.Scene(), refreshTrees() {}, setGroundConform() {} });
const bl = T.buildings;
after(() => { if (WORLD_BUILDINGS.current === bl) WORLD_BUILDINGS.current = null; });

const meshes = (kind) => T.looks.filter(L => L.im.userData.kind === kind).map(L => L.im);
const run = (secs, dt = 1 / 30) => { for (let t = 0; t < secs; t += dt) bl.update(dt, null); };
const _m = new THREE.Matrix4(), _c = new THREE.Color();
const snapshot = (b) => b.parts.filter(pt => pt.im).map(pt => { pt.im.getMatrixAt(pt.i, _m); pt.im.getColorAt(pt.i, _c); return { pt, m: _m.toArray(), c: _c.toArray() }; });
const close = (a, b, eps = 1e-5) => a.every((v, i) => Math.abs(v - b[i]) <= eps * Math.max(1, Math.abs(v)));

describe('towns: the building records', () => {
    // A digest of every record (position, size, top, yaw, health, extra boxes) as the towns stood before their
    // facades were redone. The plan of the towns must not move: collisions, AI line of sight, missions and the
    // heist are played against these. (Changed the layout on purpose? Print the new digest with the loop below.)
    test('count, footprints and heights are what they were', () => {
        let h = 0x811c9dc5;
        const mix = (v) => { const n = Math.round(v * 100) | 0; for (let k = 0; k < 4; k++) { h ^= (n >> (k * 8)) & 0xff; h = Math.imul(h, 0x01000193); } };
        const kinds = {};
        for (const b of bl.list) {
            kinds[b.kind] = (kinds[b.kind] || 0) + 1;
            for (const v of [b.x, b.z, b.y, b.w, b.d, b.top, b.yaw, b.maxHp, b.r]) mix(v);
            for (const q of b.boxes || []) for (const v of [q.x, q.z, q.y0, q.y1, q.w, q.d]) mix(v);
        }
        assert.equal(bl.list.length, 5917, 'buildings');
        assert.deepEqual(kinds, { house: 4297, watertower: 12, church: 37, market: 23, town: 1180, station: 16, tower: 50, apt: 294, stadium: 8 });
        assert.equal((h >>> 0).toString(16), '451cd5cc', 'digest of every record');
    });

    test('every building has walls, and something over them', () => {
        for (const b of bl.list) {
            if (b.kind === 'stadium') continue;
            assert.ok(b.parts.length >= 2, `${b.kind} at ${b.x.toFixed(0)}, ${b.z.toFixed(0)} has ${b.parts.length} part(s)`);
            if (b.kind !== 'watertower') assert.ok(b.parts.some(pt => pt.role === 'wall'), b.kind + ' without a wall');
        }
    });
});

describe('towns: what hangs on a building belongs to it', () => {
    test('every wall, roof, spire, tank, dormer, flue and balcony instance is a part of exactly one record', () => {
        const owner = new Map(); // mesh → Uint8Array of how many records own each instance
        for (const b of bl.list) for (const pt of b.parts) {
            if (!pt.im) continue;
            if (!owner.has(pt.im)) owner.set(pt.im, new Uint8Array(pt.im.instanceMatrix.count));
            owner.get(pt.im)[pt.i]++;
        }
        let n = 0;
        for (const kind of ['walls', 'gables', 'hips', 'flats', 'spires', 'tanks', 'dormers', 'drums', 'balconies']) {
            const ims = meshes(kind);
            assert.ok(ims.length > 0, 'no ' + kind);
            for (const im of ims) {
                const own = owner.get(im);
                assert.ok(own, kind + ': a mesh nothing owns');
                for (let i = 0; i < im.instanceMatrix.count; i++) { assert.equal(own[i], 1, `${kind} instance ${i} owned ${own[i]} times`); n++; }
            }
        }
        assert.ok(n > 15000, `${n} instances checked`);
        // the details: everything on or against a building (not the market's stalls, which stand alone)
        let bits = 0, owned = 0;
        for (const im of meshes('bits')) { bits += im.instanceMatrix.count; const own = owner.get(im); if (own) for (const v of own) { assert.ok(v <= 1); owned += v; } }
        assert.ok(owned > bits * 0.8, `${owned} of ${bits} details belong to a building`);
        // hedges, fences and sheds stand on the lots, not on a building; patios and outbuildings against one do
        let lots = 0, lotsOwned = 0;
        for (const im of meshes('lots')) { lots += im.instanceMatrix.count; const own = owner.get(im); if (own) for (const v of own) lotsOwned += v; }
        assert.ok(lots > 5000 && lotsOwned > 500 && lotsOwned < lots * 0.5, `${lotsOwned} of ${lots} lot details against a building`);
    });

    test('the additions are within reach of their building (nothing registered to the wrong one)', () => {
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        let far = 0, n = 0;
        for (const b of bl.list) {
            if (b.kind === 'stadium') continue;
            for (const pt of b.parts) {
                if (!pt.im) continue;
                pt.im.getMatrixAt(pt.i, _m); _m.decompose(p, q, s);
                n++;
                if (Math.hypot(p.x - b.x, p.z - b.z) > b.r + 9) far++;
            }
        }
        assert.equal(far, 0, `${far} of ${n} parts further than their building's reach`);
    });

    test('a block of flats: balconies on the storeys and bays the facade gives doors', () => {
        const walls = meshes('walls'), bal = new Set(meshes('balconies'));
        const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
        let checked = 0;
        for (const b of bl.list) {
            if (b.kind !== 'apt') continue;
            const mine = b.parts.filter(pt => bal.has(pt.im));
            if (!mine.length) continue;
            const w = b.parts.find(pt => pt.role === 'wall');
            assert.ok(walls.includes(w.im));
            const A = w.im.geometry.attributes, flags = A.aStyle.getY(w.i), base = A.aInfo.getZ(w.i);
            assert.ok(flags & (F.FLAG.balcZp | F.FLAG.balcZm), 'the wall knows it has balconies');
            w.im.getMatrixAt(w.i, _m); _m.decompose(p, q, s);
            const S = storeysOf({ style: A.aStyle.getX(w.i), flags, ht: s.y, base });
            assert.ok(S.nUp >= 2 && S.fh >= 2.9 && S.fh < 3.6, `storeys ${S.nUp} x ${S.fh.toFixed(2)} m`);
            for (const pt of mine) {
                pt.im.getMatrixAt(pt.i, _m); _m.decompose(p, q, s);
                const k = (p.y - 0.03 - b.y - S.base - S.gf) / S.fh; // which storey's floor it stands at
                assert.ok(Math.abs(k - Math.round(k)) < 1e-3 && Math.round(k) >= 0 && Math.round(k) < S.nUp, `balcony at storey ${k.toFixed(3)} of ${S.nUp}`);
                assert.ok(p.y + 1 < b.top + 0.5, 'under the roof');
            }
            checked++;
        }
        assert.ok(checked > 100, `${checked} blocks with balconies`);
    });
});

describe('towns: damage', () => {
    const pick = (kind, need) => bl.list.find(b => b.kind === kind && b.alive && b.parts.length >= need);

    test('the shaders know the colour an instance was built with', () => {
        // (facades.js compares the instance colour to it: a scorched building is sooty, a burnt-out stub black and unlit)
        for (const im of meshes('walls')) {
            const A = im.geometry.attributes.aInfo;
            for (let i = 0; i < im.instanceMatrix.count; i += 7) { im.getColorAt(i, _c); assert.ok(Math.abs(_c.r + _c.g + _c.b - A.getX(i)) < 1e-4); assert.ok(A.getX(i) > 0.05, 'a wall colour dark enough to pass for burnt'); }
        }
        for (const kind of ['gables', 'hips', 'flats', 'spires']) for (const im of meshes(kind)) {
            const A = im.geometry.attributes.aRoof;
            for (let i = 0; i < im.instanceMatrix.count; i += 7) { im.getColorAt(i, _c); assert.ok(Math.abs(_c.r + _c.g + _c.b - A.getZ(i)) < 1e-4); }
        }
    });

    test('a hit building is darkened through every part; its walls read as burnt to the shader', () => {
        const b = pick('apt', 12), snap = snapshot(b);
        bl.damage(b, b.hp * 0.7, null, null);
        assert.ok(b.alive && b.hp < b.maxHp * 0.5);
        const k = 0.45 + 0.55 * b.hp / b.maxHp;
        for (const { pt, c } of snap) { pt.im.getColorAt(pt.i, _c); assert.ok(close(_c.toArray(), c.map(v => v * k), 1e-4), 'darkened by the scorch factor'); }
        const w = b.parts.find(pt => pt.role === 'wall');
        w.im.getColorAt(w.i, _c);
        const kb = (_c.r + _c.g + _c.b) / w.im.geometry.attributes.aInfo.getX(w.i);
        assert.ok(Math.abs(kb - k) < 1e-3 && kb < 0.75, `the wall is at ${kb.toFixed(2)} of its colour as built`);
        bl.reset();
        for (const { pt, c } of snap) { pt.im.getColorAt(pt.i, _c); assert.ok(close(_c.toArray(), c), 'colour restored'); }
    });

    for (const [kind, need] of [['apt', 14], ['house', 5], ['tower', 12], ['church', 5], ['town', 4]]) {
        test(`a ${kind} comes down with everything on it, leaves a burnt stub, and the next sortie puts it back`, () => {
            const b = pick(kind, need);
            assert.ok(b, 'a ' + kind + ' with ' + need + ' parts');
            const snap = snapshot(b), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
            bl.destroy(b, null, null);
            const dur = bl.collapsing[bl.collapsing.length - 1].dur;
            run(dur * 0.5);
            let moved = 0;
            for (const { pt, m } of snap) { pt.im.getMatrixAt(pt.i, _m); if (!close(_m.toArray(), m, 1e-3)) moved++; }
            assert.equal(moved, snap.length, 'every part is on its way down');
            run(dur * 0.6 + 1);
            assert.ok(!bl.collapsing.some(c => c.b === b));
            let stubs = 0;
            for (const { pt, m, c } of snap) {
                pt.im.getMatrixAt(pt.i, _m); _m.decompose(p, q, s);
                if (pt.role === 'wall') {
                    stubs++;
                    const h0 = new THREE.Vector3().setFromMatrixScale(new THREE.Matrix4().fromArray(m)).y;
                    assert.ok(s.y < Math.min(3.3, h0) + 1e-3 && s.y > 0.2, `a stub of wall ${s.y.toFixed(1)} m high (was ${h0.toFixed(1)})`);
                    // burnt: at 0.28 of the colour as built, which the facade shader takes for a ruin (no lit windows)
                    pt.im.getColorAt(pt.i, _c);
                    const kb = (_c.r + _c.g + _c.b) / pt.im.geometry.attributes.aInfo.getX(pt.i);
                    assert.ok(Math.abs(kb - 0.28) < 1e-3, `stub colour at ${kb.toFixed(2)} of as built`);
                    assert.ok((0.98 - kb) * 1.55 >= 1, 'which is fully burnt in facades.js');
                } else assert.ok(_m.elements.slice(0, 11).every(v => v === 0), 'everything else is gone (squashed to nothing)');
            }
            assert.ok(stubs >= 1);
            bl.reset();
            assert.ok(b.alive && b.hp === b.maxHp);
            for (const { pt, m, c } of snap) {
                pt.im.getMatrixAt(pt.i, _m); pt.im.getColorAt(pt.i, _c);
                assert.ok(close(_m.toArray(), m, 1e-6), 'matrix restored');
                assert.ok(close(_c.toArray(), c, 1e-6), 'colour restored');
            }
        });
    }
});

describe('towns: looks and geometry', () => {
    test("'low' draws the plain shaders and leaves the additions out; 'full' brings them back", () => {
        const walls = meshes('walls'), full = walls[0].material;
        const bits = meshes('bits'), all = bits.map(im => im.count);
        T.setLook('low');
        assert.notEqual(walls[0].material, full);
        for (const kind of ['drums', 'lots']) for (const im of meshes(kind)) assert.ok(im.userData.hide && !im.visible, kind + ' hidden');
        for (const im of meshes('balconies')) assert.ok(!im.userData.hide, 'balconies stay');
        bits.forEach((im, i) => assert.ok(im.count <= all[i] && im.count === im.userData.base));
        assert.ok(bits.some((im, i) => im.count < all[i]), 'fewer details');
        T.setLook('bare');
        for (const im of meshes('balconies')) assert.ok(im.userData.hide);
        T.setLook('full');
        assert.equal(walls[0].material, full);
        bits.forEach((im, i) => assert.equal(im.count, all[i]));
        for (const kind of ['drums', 'lots', 'balconies']) for (const im of meshes(kind)) assert.ok(!im.userData.hide);
        // both facade materials follow the town's lights
        T.setNight(true);
        for (const m of T.buildingMats) assert.equal(m.userData.night.value, 1);
        T.setNight(false);
    });

    test('the unit shapes: outward faces only, and no more of them than needed', () => {
        const tris = (g) => g.attributes.position.count / 3;
        assert.equal(tris(F.wallGeometry()), 8, 'a wall box is four walls');
        assert.equal(tris(F.boxGeometry()), 10);
        assert.equal(tris(F.gableGeometry()), 8, 'two pitches, two ends, the soffit');
        assert.equal(tris(F.hipGeometry()), 8);
        assert.ok(tris(F.trayGeometry()) <= 26 && tris(F.balconyGeometry()) <= 22 && tris(F.drumGeometry()) <= 16);
        // convex shapes: every face's normal points away from the middle
        for (const [name, g, c] of [['wall', F.wallGeometry(), [0, 0.5, 0]], ['box', F.boxGeometry(), [0, 0.5, 0]], ['gable', F.gableGeometry(), [0, 0.3, 0]], ['hip', F.hipGeometry(), [0, 0.3, 0]], ['drum', F.drumGeometry(), [0, 0.5, 0]]]) {
            const P = g.attributes.position, N = g.attributes.normal;
            for (let i = 0; i < P.count; i += 3) {
                const cx = (P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3 - c[0], cy = (P.getY(i) + P.getY(i + 1) + P.getY(i + 2)) / 3 - c[1], cz = (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3 - c[2];
                assert.ok(cx * N.getX(i) + cy * N.getY(i) + cz * N.getZ(i) > 0, `${name}: face ${i / 3} faces inward`);
            }
        }
        // the tray: its deck below the coping, facing up
        const g = F.trayGeometry(), P = g.attributes.position, N = g.attributes.normal;
        let deck = 0;
        for (let i = 0; i < P.count; i += 3) if (Math.abs(P.getY(i) - F.TRAY.deck) < 1e-6 && Math.abs(P.getY(i + 1) - F.TRAY.deck) < 1e-6 && Math.abs(P.getY(i + 2) - F.TRAY.deck) < 1e-6) { deck++; assert.ok(N.getY(i) > 0.99); }
        assert.equal(deck, 2);
    });

    test('the bays the shader counts, and the noise it reads', () => {
        assert.equal(F.bayCount(9, F.FACADE.house), 3);
        assert.equal(F.bayCount(2, F.FACADE.house), 1);
        assert.equal(F.bayCount(21, F.FACADE.apartment), 7);
        const t = F.noiseTexture();
        assert.equal(t.image.width, 128);
        assert.equal(t, F.noiseTexture(), 'one texture for every material');
        const d = t.image.data;
        let lo = 255, hi = 0, sum = 0;
        for (let i = 0; i < d.length; i += 4) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); sum += d[i]; }
        assert.ok(lo === 0 && hi === 255 && Math.abs(sum / (d.length / 4) - 127) < 40, 'the blotch channel spans its range');
    });
});

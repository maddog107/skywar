import { src } from './helpers/setup.mjs';
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

// Flaps and speed brakes cut from a model's skin (src/surfaces.js), on a simple box "aircraft": a 10 m long
// fuselage with a 12 m span wing (x ±6, z 0..2, y ±0.2) and a dorsal box on top.
describe('surfaces: cutting flaps and brakes out of a model', () => {
    let THREE, S, D, segmentModel;
    const L = 10;
    const model = () => {
        const g = new THREE.Group();
        const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 2, 12, 1, 4), new THREE.MeshStandardMaterial());
        wing.position.set(0, 0, 1);
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 10, 2, 2, 10), new THREE.MeshStandardMaterial());
        body.position.set(0, 0.5, 0);
        g.add(wing, body);
        return segmentModel(g, L);
    };
    // total area of the airframe (ignoring the wells that close the openings)
    const area = (obj) => {
        let a = 0;
        const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        obj.updateMatrixWorld(true);
        obj.traverse(o => {
            if (!o.isMesh || o.userData.surfaceWell) return;
            const pos = o.geometry.attributes.position;
            for (let t = 0; t < pos.count; t += 3) {
                for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(pos, t + k).applyMatrix4(o.matrixWorld);
                a += new THREE.Triangle(p[0], p[1], p[2]).getArea();
            }
        });
        return a;
    };
    const pivots = (obj) => { const out = []; obj.traverse(o => { if (o.userData.surface) out.push(o); }); return out; };

    before(async () => {
        THREE = await import('three');
        S = await src('surfaces.js');
        D = await src('surfacedefs.js');
        ({ segmentModel } = await src('damage.js'));
        D.SURFACE_DEFS.__test = {
            // flap: x 2..4.5, aft 0.6 m of the wing (z 1.4..2), hinged on the upper skin
            flaps: [{ top: [[0.2, 0.14], [0.45, 0.14], [0.45, 0.25], [0.2, 0.25]], y: [-0.05, 0.05], hinge: [[0.2, 0.02, 0.14], [0.45, 0.02, 0.14]], angle: 30 }],
            // dorsal brake: the top of the body box, x ±0.4, z −2..0 (a skin panel, hinged at its front)
            brakes: [{ top: [[-0.04, -0.2], [0.04, -0.2], [0.04, 0.0], [-0.04, 0.0]], y: [0.05, 0.12], hinge: [[-0.04, 0.1, -0.2], [0.04, 0.1, -0.2]], angle: -45, skin: 1, mirror: false }],
        };
    });

    test('the cut keeps every bit of skin: the airframe plus the surfaces have the area the model had', () => {
        const before = area(model());
        const obj = model();
        const n = S.cutSurfaces(obj, '__test', L);
        assert.equal(n, 3, 'two flaps and the dorsal brake');
        assert.ok(Math.abs(area(obj) - before) < 1e-3 * before, `area ${area(obj)} vs ${before}`);
    });

    test('left and right flaps: mirrored, hinged about +x, trailing edges go down together', () => {
        const obj = model();
        S.cutSurfaces(obj, '__test', L);
        const flaps = pivots(obj).filter(p => p.userData.surface.kind === 'flap');
        assert.equal(flaps.length, 2);
        for (const f of flaps) {
            const a = f.userData.surface.axis;
            assert.ok(a[0] > 0.99, 'axis along +x on both sides');
        }
        // pose fully down: every vertex of each flap is at or below where it was, the trailing edge ~0.3 m lower
        const lowest = (o) => { let y = Infinity; o.updateMatrixWorld(true); o.traverse(m => { if (m.isMesh && !m.userData.surfaceWell) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) y = Math.min(y, new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).y); } }); return y; };
        const y0 = flaps.map(lowest);
        S.poseSurfaces(obj, 1, 0);
        const y1 = flaps.map(lowest);
        for (let i = 0; i < 2; i++) assert.ok(y1[i] < y0[i] - 0.2, `flap ${i}: ${y0[i]} → ${y1[i]}`);
        assert.ok(Math.abs(y1[0] - y1[1]) < 1e-6, 'both sides alike');
    });

    test('a skin panel only takes the skin facing its way, and its opening gets a floor', () => {
        const obj = model();
        S.cutSurfaces(obj, '__test', L);
        const brake = pivots(obj).find(p => p.userData.surface.kind === 'brake');
        assert.ok(brake, 'brake made');
        brake.updateMatrixWorld(true);
        brake.traverse(m => {
            if (!m.isMesh || m.userData.surfaceWell) return;
            const n = m.geometry.attributes.normal;
            for (let i = 0; i < n.count; i++) assert.ok(n.getY(i) > 0.2, 'only the upward-facing skin');
        });
        let wells = 0;
        obj.traverse(o => { if (o.userData.surfaceWell) wells++; });
        assert.ok(wells >= 2, 'a bay floor on the airframe and an inside face on the panel');
    });

    test('wells are hidden while their surface is stowed and shown once it moves', () => {
        const obj = model();
        S.cutSurfaces(obj, '__test', L);
        const wells = [];
        obj.traverse(o => { if (o.userData.surfaceWell) wells.push(o); });
        const ids = new Set(pivots(obj).map(p => p.userData.surface.id));
        assert.ok(wells.length >= 4, 'flap walls and the brake bay');
        for (const w of wells) {
            assert.ok(ids.has(w.userData.surfaceWell), 'every well belongs to a surface');
            assert.equal(w.visible, false, 'hidden when stowed');
        }
        S.poseSurfaces(obj, 1, 0);
        const flapIds = new Set(pivots(obj).filter(p => p.userData.surface.kind === 'flap').map(p => p.userData.surface.id));
        for (const w of wells) assert.equal(w.visible, flapIds.has(w.userData.surfaceWell), 'flap wells shown, brake wells still hidden');
        S.poseSurfaces(obj, 0, 0);
        for (const w of wells) assert.equal(w.visible, false, 'hidden again when stowed');
    });

    test('a flap wall follows a narrow fairing under the wing instead of spilling past its sides', () => {
        // a 0.1 m wide strut fairing under the wing (x 3.0..3.1, y −0.5..−0.2), running through the flap's front face
        const g = new THREE.Group();
        const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 2, 12, 1, 4), new THREE.MeshStandardMaterial());
        wing.position.set(0, 0, 1);
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 1.3), new THREE.MeshStandardMaterial());
        strut.position.set(3.05, -0.35, 1.15);
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1, 10, 2, 2, 10), new THREE.MeshStandardMaterial());
        body.position.set(0, 0.5, 0);
        g.add(wing, strut, body);
        const obj = segmentModel(g, L);
        D.SURFACE_DEFS.__strut = { flaps: [{ top: [[0.2, 0.14], [0.45, 0.14], [0.45, 0.25], [0.2, 0.25]], y: [-0.06, 0.005], hinge: [[0.2, 0.02, 0.14], [0.45, 0.02, 0.14]], angle: 30, mirror: false }] };
        assert.equal(S.cutSurfaces(obj, '__strut', L), 1);
        obj.updateMatrixWorld(true);
        // any wall triangle reaching below the wing must lie wholly across the strut
        const t = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        let below = 0;
        obj.traverse(o => {
            if (!o.userData.surfaceWell) return;
            const pos = o.geometry.attributes.position;
            for (let i = 0; i < pos.count; i += 3) {
                for (let k = 0; k < 3; k++) t[k].fromBufferAttribute(pos, i + k).applyMatrix4(o.matrixWorld);
                if (!t.some(p => p.y < -0.21)) continue;
                below++;
                for (const p of t) assert.ok(p.x > 2.99 && p.x < 3.11, `wall below the wing only across the strut (x ${p.x.toFixed(3)})`);
            }
        });
        assert.ok(below > 0, 'the strut\'s section is closed off');
        delete D.SURFACE_DEFS.__strut;
    });

    test('split surface: each half takes its skin and the inner face turned its way, with no bay floor', () => {
        // two slabs meeting face to face at y = 0 (upper y 0..0.2, lower y −0.2..0), like the halves of a drag rudder
        const g = new THREE.Group();
        const up = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 2, 12, 1, 4), new THREE.MeshStandardMaterial());
        up.position.set(0, 0.1, 1);
        const dn = new THREE.Mesh(new THREE.BoxGeometry(12, 0.2, 2, 12, 1, 4), new THREE.MeshStandardMaterial());
        dn.position.set(0, -0.1, 1);
        g.add(up, dn);
        const obj = segmentModel(g, L);
        const out = { top: [[0.2, 0.14], [0.45, 0.14], [0.45, 0.25], [0.2, 0.25]], y: [-0.03, 0.03], split: true, mirror: false };
        D.SURFACE_DEFS.__split = { brakes: [
            { ...out, hinge: [[0.2, 0.02, 0.14], [0.45, 0.02, 0.14]], angle: -45, skin: 1 },
            { ...out, hinge: [[0.2, -0.02, 0.14], [0.45, -0.02, 0.14]], angle: 45, skin: -1 },
        ] };
        assert.equal(S.cutSurfaces(obj, '__split', L), 2);
        obj.updateMatrixWorld(true);
        const halves = pivots(obj);
        const p = new THREE.Vector3(), n = new THREE.Vector3();
        for (const h of halves) {
            const dir = h.userData.surface.angle < 0 ? 1 : -1;   // the upper half rises
            const ys = new Set();
            h.traverse(m => {
                if (!m.isMesh || m.userData.surfaceWell) return;
                const pos = m.geometry.attributes.position, nrm = m.geometry.attributes.normal;
                for (let i = 0; i < pos.count; i++) {
                    ys.add(Math.round(p.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).y * 10) / 10 || 0);
                    assert.ok(n.fromBufferAttribute(nrm, i).y * dir > 0.9, 'only faces turned its way');
                }
            });
            assert.deepEqual([...ys].sort(), dir > 0 ? [0, 0.2] : [-0.2, 0], 'its outer skin and the inner face');
        }
        // no floor: every well triangle stands on one of the region's faces (none lies flat under a half)
        obj.traverse(o => {
            if (!o.userData.surfaceWell) return;
            const pos = o.geometry.attributes.position;
            const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
            for (let i = 0; i < pos.count; i += 3) {
                a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
                const t = new THREE.Triangle(a, b, c);
                if (t.getArea() < 1e-9) continue;
                assert.ok(Math.abs(t.getNormal(n).y) < 0.1, 'walls only');
            }
        });
        delete D.SURFACE_DEFS.__split;
    });

    // two petal-like boxes stacked face to face (upper y 0..0.2, lower y −0.2..0, x 2..4.5, z 1.4..2), standing
    // behind a wing slab (z 0..1.4) that touches their front faces, like the F-16's speed-brake petals
    const petals = () => {
        const g = new THREE.Group();
        const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 1.4, 12, 1, 3), new THREE.MeshStandardMaterial());
        wing.position.set(0, 0, 0.7);
        const up = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 0.6), new THREE.MeshStandardMaterial());
        up.position.set(3.25, 0.1, 1.7);
        const dn = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 0.6), new THREE.MeshStandardMaterial());
        dn.position.set(3.25, -0.1, 1.7);
        g.add(wing, up, dn);
        return segmentModel(g, L);
    };
    const faces = (o) => {   // world-space triangles of a surface's own skin: [{ c: centre, n: normal }]
        const out = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
        o.updateMatrixWorld(true);
        o.traverse(m => {
            if (!m.isMesh || m.userData.surfaceWell) return;
            const pos = m.geometry.attributes.position;
            for (let i = 0; i < pos.count; i += 3) {
                a.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, i + 1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, i + 2).applyMatrix4(m.matrixWorld);
                const t = new THREE.Triangle(a, b, c);
                out.push({ c: t.getMidpoint(new THREE.Vector3()), n: t.getNormal(new THREE.Vector3()) });
            }
        });
        return out;
    };

    test('whole parts: two solids meeting face to face each move with their own faces, uncut, nothing closed', () => {
        const before = area(petals());
        const obj = petals();
        const band = { top: [[0.199, 0.14], [0.451, 0.14], [0.451, 0.201], [0.199, 0.201]], whole: true, mirror: false };
        D.SURFACE_DEFS.__whole = { brakes: [
            { ...band, y: [0, 0.03], hinge: [[0.2, 0, 0.14], [0.45, 0, 0.14]], angle: -30 },
            { ...band, y: [-0.03, 0], hinge: [[0.2, 0, 0.14], [0.45, 0, 0.14]], angle: 30 },
        ] };
        assert.equal(S.cutSurfaces(obj, '__whole', L), 2);
        assert.ok(Math.abs(area(obj) - before) < 1e-3 * before, 'nothing cut away, nothing added');
        let wells = 0;
        obj.traverse(o => { if (o.userData.surfaceWell) wells++; });
        assert.equal(wells, 0, 'no walls or floors');
        for (const p of pivots(obj)) {
            const upper = p.userData.surface.angle < 0;
            const f = faces(p);
            assert.equal(f.length, 12, 'the whole box: 12 triangles, none split');
            for (const t of f) assert.ok(upper ? t.c.y >= -1e-6 : t.c.y <= 1e-6, `${upper ? 'upper' : 'lower'} petal keeps to its own side (y ${t.c.y.toFixed(3)})`);
            // the split face turned toward the other petal comes along
            assert.ok(f.some(t => Math.abs(t.c.y) < 1e-6 && t.n.y * (upper ? -1 : 1) > 0.9), 'its face on the split');
        }
        // the wing's back face, which the petals stand against, stays on the airframe
        const rest = [];
        obj.traverse(o => { if (o.isMesh && !o.userData.surfaceWell && !pivots(obj).some(p => p === o.parent)) rest.push(o); });
        assert.ok(rest.some(m => faces(m).some(t => Math.abs(t.c.z - 1.4) < 1e-4 && t.n.z > 0.9 && t.c.x > 2 && t.c.x < 4.5)), 'wing trailing face kept');
        delete D.SURFACE_DEFS.__whole;
    });

    test('clip planes bound the region, and depth 0 leaves the opening unclosed', () => {
        const obj = model();
        // the flap region of the first test, cut in two by a plane tilted 45° across the chord: only the part
        // with y > (z − 1.7) is taken, and nothing closes the opening
        D.SURFACE_DEFS.__clip = { flaps: [{ top: [[0.2, 0.14], [0.45, 0.14], [0.45, 0.25], [0.2, 0.25]], y: [-0.05, 0.05], clip: [[[0.3, 0, 0.17], [0, 1, -1]]], depth: 0, hinge: [[0.2, 0.02, 0.14], [0.45, 0.02, 0.14]], angle: 30, mirror: false }] };
        assert.equal(S.cutSurfaces(obj, '__clip', L), 1);
        const [flap] = pivots(obj);
        const v = new THREE.Vector3();
        flap.traverse(m => {
            if (!m.isMesh) return;
            const pos = m.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); assert.ok(v.y - (v.z - 1.7) > -1e-4, 'on the kept side of the clip plane'); }
        });
        let wells = 0;
        obj.traverse(o => { if (o.userData.surfaceWell) wells++; });
        assert.equal(wells, 0, 'depth 0: no walls or floor');
        delete D.SURFACE_DEFS.__clip;
    });

    test('actuator travel times: fighters quick, airliners slow', () => {
        const fighter = S.surfaceTravel('f15', { category: 'fighter' });
        const civil = S.surfaceTravel('b737', { category: 'civil' });
        assert.ok(fighter.flap >= 2 && fighter.flap <= 5, 'fighter flaps a few seconds');
        assert.ok(civil.flap > fighter.flap * 2, 'airliner flaps much slower');
        assert.ok(fighter.brake <= 2 && civil.brake <= 2, 'speed brakes and spoilers come out in a second or two');
    });
});

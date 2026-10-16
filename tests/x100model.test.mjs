// The X-100 Overkill, SKYWAR's own test jet, built with the Blender kit (tools/aircraft/x100.py, x100_gear.py): its
// model file loaded and normalised as the game does (tests/helpers/aircraftmodel.mjs, textures stripped). Config and
// model entries; one textured skin, a trim atlas and glass inside the triangle budget; its real length and span; the
// gold leading and chine edges are geometry of their own (the trim material) where a ray from ahead or the side
// first meets the jet; the flame points inside the 2-D nozzles' exits; the eye under the frameless canopy; five
// damage regions; the flaps and the dorsal airbrake cut cleanly, stow without a seam and open the right way; its own
// gear (three legs, level on its wheels, folding away inside the airframe, the doors in the airframe's paint); a
// livery repainting the black and keeping the gold (models.js regreyPixels); its markings made up (no real insignia)
// and credited.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { AIRCRAFT } = await src('config.js');
const M = await src('models.js');
const { SURFACE_DEFS } = await src('surfacedefs.js');
const S = await src('surfaces.js');
const { segmentModel, REGIONS } = await src('damage.js');
const { loadAircraft, triangleCount, stripTextures } = await import('./helpers/aircraftmodel.mjs');
const repo = new URL('../', import.meta.url);

const { holder, json, info, spec } = await loadAircraft('x100');
const L = spec.length;
const box = new THREE.Box3().setFromObject(holder), size = box.getSize(new THREE.Vector3());
const ray = new THREE.Raycaster();
const hits = (root, from, dir, far = 100) => { ray.set(from, dir.clone().normalize()); ray.far = far; return ray.intersectObject(root, true); };
const matOf = (h) => [].concat(h.object.material)[h.face.materialIndex] || [].concat(h.object.material)[0];
const V = (x, y, z) => new THREE.Vector3(x, y, z);

describe('X-100 Overkill: the model', () => {
    test('entries: the test jet in config.js, its model, gear and surfaces', () => {
        const a = AIRCRAFT.x100;
        assert.ok(a && a.group === 'test', 'a TEST AIRCRAFT entry');
        assert.equal(a.length, 21.0);
        assert.equal(a.span, 12.6);
        assert.equal(info.file, 'aircraft/x100.glb');
        assert.ok(existsSync(new URL('models/' + info.file, repo)) && existsSync(new URL('models/' + info.gear, repo)), 'airframe and gear files');
        assert.equal(info.livery, 'regrey', 'liveries repaint the black, not the gold');
        assert.ok(SURFACE_DEFS.x100, 'flaps and brakes defined');
    });

    test('one textured skin liveries repaint, a trim atlas they leave alone, glass; within the triangle budget', () => {
        const names = json.materials.map(m => m.name).sort();
        assert.deepEqual(names, ['Canopy_Glass', 'Nozzle_Trim', 'Skin']);
        assert.ok(json.materials.find(m => m.name === 'Skin').pbrMetallicRoughness.baseColorTexture, 'a textured Skin');
        assert.ok(json.materials.find(m => m.name === 'Nozzle_Trim').pbrMetallicRoughness.baseColorTexture, 'a textured trim atlas');
        assert.equal(json.materials.find(m => m.name === 'Canopy_Glass').alphaMode, 'BLEND', 'see-through glass');
        assert.equal((json.images || []).length, 2, 'two atlases');
        const tris = triangleCount(holder);
        assert.ok(tris >= 15000 && tris <= 25000, `${tris} triangles`);
    });

    test('its real length and span; a long needle nose whose chines widen into the wing', () => {
        assert.ok(Math.abs(size.z - L) < 1e-6, 'scaled to its length');
        assert.ok(Math.abs(size.x / spec.span - 1) < 0.02, `span ${size.x.toFixed(2)} m`);
        assert.ok(size.y < 0.17 * L, `low and flat (${size.y.toFixed(2)} m tall)`);
        // the planform's half-width along the forebody: a needle widening steadily toward the wing
        const halfWidth = (f) => {
            const z = box.min.z + f * L;
            let w = 0;
            for (let y = box.min.y; y < box.max.y; y += 0.05) for (const dir of [1]) {
                const h = hits(holder, V(30 * dir, y, z), V(-dir, 0, 0), 60);
                if (h.length) w = Math.max(w, h[0].point.x);
            }
            return w;
        };
        const w = [0.05, 0.15, 0.25, 0.35].map(halfWidth);
        assert.ok(w[0] < 0.012 * L, `needle nose (${w[0].toFixed(2)} m)`);
        for (let i = 1; i < w.length; i++) assert.ok(w[i] > w[i - 1] * 1.25, `the forebody widens (${w.map(v => v.toFixed(2))})`);
    });

    test('gold edges are geometry: the wing and canard leading edges and the chines meet a ray first with the trim', () => {
        // a point in the kit's frame (s metres aft of the nose, x right, z up: tools/aircraft/x100.py) in model space
        holder.updateMatrixWorld(true);
        const frame = holder.children[0].matrixWorld;
        const kit = (s, x, z) => V(x, z, s).applyMatrix4(frame);
        const chineX = hits(holder, kit(6.0, 3.0, 0.031), V(-1, 0, 0))[0].point.x;
        const cases = [
            ['outer wing leading edge', kit(10, 5.0, -0.355), V(0, 0, 1)],
            ['inner wing leading edge', kit(10, 2.9, -0.097), V(0, 0, 1)],
            ['canard leading edge', kit(5, 1.9, 0.087), V(0, 0, 1)],
            ['chine edge, from the side', kit(4.0, 3.0, 0.03), V(-1, 0, 0)],
            ['chine edge, from below', V(chineX - 0.02, box.min.y - 1, kit(6.0, 0, 0).z), V(0, 1, 0)],
        ];
        for (const [what, from, dir] of cases) {
            const h = hits(holder, from, dir);
            assert.ok(h.length, `${what}: something there`);
            assert.equal(matOf(h[0]).name, 'Nozzle_Trim', `${what}: gold first (hit ${matOf(h[0]).name} at ${h[0].point.toArray().map(v => v.toFixed(2))})`);
        }
    });

    test('two flame points inside the 2-D nozzles\' exits, mirrored, at the tail', () => {
        assert.equal(info.nozzles.length, 2);
        assert.ok(Math.abs(info.nozzles[0][0] + info.nozzles[1][0]) < 1e-6, 'mirrored');
        for (const [x, y, z] of info.nozzles) {
            const p = V(x * L, y * L, z * L);
            assert.ok(p.z > box.max.z - 0.06 * L && p.z < box.max.z, `at the tail (${p.z.toFixed(2)} of ${box.max.z.toFixed(2)})`);
            // looking up the exhaust from behind: the nozzle's throat is right there
            const back = hits(holder, p.clone().add(V(0, 0, 0.5)), V(0, 0, -1), 2.0);
            assert.ok(back.length && back[0].distance < 1.6, 'an open exhaust in front of the flame');
            // the walls of the box nozzle round the point: the flame starts inside it
            for (const d of [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0)]) {
                const h = hits(holder, p.clone().add(V(0, 0, -0.1)), d, 1.0);
                assert.ok(h.length, `a nozzle wall ${d.toArray()} of the flame point`);
            }
        }
        const r = info.nozzleR * L;
        assert.ok(r > 0.3 && r < 0.5, `flame radius ${r.toFixed(2)} m against the 0.72 m-tall exits`);
    });

    test('the eye under the frameless gold canopy, the cockpit floor below it', () => {
        const eye = V(0, info.cockpit[0] * L, info.cockpit[1] * L);
        assert.ok(eye.z < -0.2 * L && eye.z > -0.33 * L, 'the cockpit well forward');
        // (the eye is inside the pilot's helmet, so the glass need not be the first thing the ray meets)
        assert.ok(hits(holder, eye, V(0, 1, 0), 1.0).some(h => matOf(h).name === 'Canopy_Glass'), 'the glass just above the eye');
        assert.ok(hits(holder, eye, V(0, -1, 0), 1.5).length, 'the cockpit floor below');
    });

    test('segmentModel finds a nose, a tail, a centre and two matching wings', () => {
        const out = segmentModel(holder.clone(true), L);
        const r = {};
        for (const g of out.children) { let n = 0; g.traverse(o => { if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; }); r[g.userData.region] = n; }
        for (const k of REGIONS) assert.ok(r[k] > 50, `${k}: ${r[k]} triangles`);
        assert.ok(Math.abs(r.wingL - r.wingR) <= 0.1 * Math.max(r.wingL, r.wingR), `wings alike (${r.wingL} / ${r.wingR})`);
    });
});

describe('X-100 Overkill: flaps and the dorsal airbrake', () => {
    const skinArea = (obj) => {
        let a = 0;
        const p = [0, 1, 2].map(() => new THREE.Vector3());
        obj.updateMatrixWorld(true);
        obj.traverse(o => {
            if (!o.isMesh || o.userData.surfaceWell) return;
            const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
            for (let t = 0; t < n; t += 3) {
                for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(o.matrixWorld);
                a += new THREE.Triangle(p[0], p[1], p[2]).getArea();
            }
        });
        return a;
    };
    const skinVerts = (pivot, root) => {
        const out = [], inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
        root.updateMatrixWorld(true);
        pivot.traverse(m => {
            if (!m.isMesh || m.userData.surfaceWell) return;
            const pos = m.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv));
        });
        return out;
    };
    const pivotsOf = (obj) => { const out = []; obj.traverse(o => { if (o.userData.surface) out.push(o); }); return out; };

    test('four flap panels (inner and outer, both sides) and one airbrake, cut with the skin all still there', () => {
        const obj = segmentModel(holder.clone(true), L);
        const before = skinArea(obj);
        assert.equal(S.cutSurfaces(obj, 'x100', L), 5, 'surfaces made');
        const after = skinArea(obj);
        assert.ok(Math.abs(after - before) < 2e-3 * before, `skin area ${after.toFixed(2)} vs ${before.toFixed(2)} m²`);
        const ps = pivotsOf(obj);
        assert.deepEqual(ps.map(p => p.userData.surface.kind).sort(), ['brake', 'flap', 'flap', 'flap', 'flap']);
        for (const p of ps) {
            const vs = skinVerts(p, obj);
            assert.ok(vs.length >= 24, `${p.userData.surface.kind}: a skin of its own`);
            const xs = vs.map(v => v.x), zs = vs.map(v => v.z);
            if (p.userData.surface.kind === 'flap') {
                // on the wing's trailing edge, outboard of the nacelles and fins
                assert.ok(Math.min(...xs.map(Math.abs)) > 0.085 * L && Math.max(...zs) < box.max.z, 'on the wing, off the body');
            } else {
                assert.ok(Math.max(...xs.map(Math.abs)) < 0.03 * L, 'the brake on the spine');
            }
        }
    });

    test('stowed nothing shows; deployed the flaps droop and the brake rises', () => {
        const obj = segmentModel(holder.clone(true), L);
        S.cutSurfaces(obj, 'x100', L);
        const ps = pivotsOf(obj);
        S.poseSurfaces(obj, 0, 0);
        const rest = ps.map(p => skinVerts(p, obj));
        const shown = () => { let n = 0; obj.traverse(o => { if (o.userData.surfaceWell && o.visible) n++; }); return n; };
        assert.equal(shown(), 0, 'stowed: every well hidden');
        S.poseSurfaces(obj, 1, 1);
        ps.forEach((p, i) => {
            const now = skinVerts(p, obj), r = rest[i], s = p.userData.surface;
            const aft = r.map((v, k) => k).sort((a, b) => r[b].z - r[a].z).slice(0, Math.max(3, r.length / 10 | 0));
            const dy = aft.reduce((a, k) => a + now[k].y - r[k].y, 0) / aft.length;
            if (s.kind === 'flap') assert.ok(dy < -0.1, `flap trailing edge goes down (${dy.toFixed(2)} m)`);
            else assert.ok(dy > 0.5, `the airbrake's trailing edge rises (${dy.toFixed(2)} m)`);
        });
        assert.ok(shown() > 0, 'deployed: the wells show');
    });
});

describe('X-100 Overkill: its own landing gear', async () => {
    const buf = readFileSync(new URL('models/' + info.gear, repo));
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(data, '', res, rej));
    holder.updateMatrixWorld(true);
    const frame = holder.children[0].matrixWorld.clone();     // the file → model transform the game uses
    const setup = () => {
        const { parts, contacts } = M.normaliseGear(gltf.scene.clone(true), frame, holder);
        const object = new THREE.Group(), rig = {};
        M.addGear(object, rig, parts);
        return { object, rig, contacts, pose: (k) => { M.poseGear(rig, k); object.updateMatrixWorld(true); } };
    };
    test('three legs on pivots inside the airframe, folding 90° aft; the wheels level, well under the belly', () => {
        const { rig, contacts } = setup();
        assert.deepEqual(rig.gearParts.map(p => p.userData.gear.kind).sort(), ['main', 'main', 'nose']);
        for (const p of rig.gearParts) {
            const g = p.userData.gear;
            assert.ok(Math.abs(g.axis.length() - 1) < 1e-9 && Math.abs(g.angle - Math.PI / 2) < 1e-9, 'a unit axis, 90°');
            assert.ok(g.axis.x < -0.99, 'about the lateral axis (the wheels swing aft and up)');
        }
        const ys = contacts.map(c => c.y);
        assert.ok(Math.max(...ys) - Math.min(...ys) < 0.01, 'all three wheels touch together: it sits level');
        assert.ok(Math.max(...ys) < box.min.y - 0.6, `the wheels ${(box.min.y - Math.max(...ys)).toFixed(2)} m under the lowest point`);
        const nose = rig.gearParts.findIndex(p => p.userData.gear.kind === 'nose');
        assert.ok(Math.abs(contacts[nose].x) < 1e-6 && contacts[nose].z < -0.25 * L, 'the nose wheel on the centreline, well forward');
        for (const [i, p] of rig.gearParts.entries()) if (p.userData.gear.kind === 'main') {
            assert.ok(Math.abs(contacts[i].x) > 1.0 && contacts[i].z > 0, 'a main wheel each side, aft of the centre');
        }
    });

    test('down, each leg reaches its wheel\'s contact point; folded, every part lies inside the airframe', () => {
        const { object, rig, contacts, pose } = setup();
        pose(1);
        rig.gearParts.forEach((p, i) => {
            const b = new THREE.Box3().setFromObject(p);
            assert.ok(Math.abs(b.min.y - contacts[i].y) < 0.03, `${p.name}: its lowest point on the contact (${b.min.y.toFixed(2)} / ${contacts[i].y.toFixed(2)})`);
        });
        pose(0);
        const dirs = [V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0), V(0, 0, 1), V(0, 0, -1)];
        const v = new THREE.Vector3();
        let n = 0, out = 0;
        object.traverse(o => {
            if (!o.isMesh || /door/.test(o.name) || /door/.test(o.parent?.name || '')) return;
            const pos = o.geometry.attributes.position;
            for (let i = 0; i < pos.count; i += 7) {
                v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
                n++;
                if (!dirs.every(d => hits(holder, v, d, 30).length)) out++;
            }
        });
        assert.ok(n > 100 && out === 0, `${out} of ${n} sampled gear points outside the airframe when folded`);
    });

    test('the doors wear the airframe\'s skin (and its livery); legs and wheels keep their own colour', () => {
        const { object } = setup();
        const skin = (() => { let m = null; holder.traverse(o => { if (o.isMesh) for (const x of [].concat(o.material)) if (x.name === 'Skin') m = x; }); return m; })();
        let doors = 0, rest = 0;
        object.traverse(o => {
            if (!o.isMesh) return;
            if (/door/.test(o.name) || /door/.test(o.parent?.name || '')) { assert.equal(o.material, skin, `${o.name}: the airframe's skin`); assert.ok(o.geometry.attributes.uv, 'with its UVs'); doors++; }
            else { assert.ok(o.material.userData.noPaint, `${o.name}: liveries skip it`); rest++; }
        });
        assert.equal(doors, 4, 'two nose doors, a main door each side');
        assert.ok(rest > 10);
    });
});

describe('X-100 Overkill: paint and credits', () => {
    test('a livery repaints the black in its colour (shading kept) and leaves the gold and red stencils alone', () => {
        const px = [
            [23, 24, 27], [23, 24, 27], [23, 24, 27], [23, 24, 27],  // the black paint (the median)
            [16, 17, 19],                                        // a panel line / ambient occlusion
            [222, 170, 64],                                      // gold leaf
            [204, 32, 30],                                       // a red warning stencil
            [36, 27, 20],                                        // a JPEG-tinted near-black pixel by the gold
        ];
        const d = new Uint8ClampedArray(px.flatMap(p => [...p, 255]));
        M.regreyPixels(d, 0xe8321f);
        const at = (i) => [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
        const near = (a, b, t) => a.every((v, i) => Math.abs(v - b[i]) <= t);
        assert.ok(near(at(0), [232, 50, 31], 6), `the paint takes the livery colour (${at(0)})`);
        assert.ok(at(4)[0] < at(0)[0] * 0.8 && at(4)[0] > at(0)[0] * 0.55, `a panel line stays darker (${at(4)})`);
        assert.deepEqual(at(5), [222, 170, 64], 'gold kept');
        assert.deepEqual(at(6), [204, 32, 30], 'red stencil kept');
        assert.ok(at(7)[0] > 150 && at(7)[1] < 80, `the tinted near-black is repainted, no dark halo (${at(7)})`);
    });

    test('its own made-up markings (no real insignia), credited in the game and the credits file', () => {
        const spec = readFileSync(new URL('tools/aircraft/x100.py', repo), 'utf8');
        const images = [...spec.matchAll(/'([\w-]+\.png)'/g)].map(m => m[1]);
        assert.ok(images.length >= 10);
        for (const im of images) assert.ok(/^x100_/.test(im) || ['warning.png', 'rescue.png'].includes(im), `${im}: its own marking or a generic stencil`);
        for (const im of new Set(images)) assert.ok(existsSync(new URL('tools/aircraft/markings/' + im, repo)), `${im} drawn (tools/aircraft/markings.py)`);
        const main = readFileSync(new URL('src/main.js', repo), 'utf8');
        assert.match(main, /\['[^']*X-100[^']*', 'SKYWAR \/ Blender \(tools\/aircraft_kit\.py\)'/, 'in-game credits row');
        const credits = readFileSync(new URL('models/aircraft/CREDITS.md', repo), 'utf8');
        assert.match(credits, /`x100\.glb`, `x100_gear\.glb`/);
    });
});

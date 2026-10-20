// The real cockpits (cockpit.js COCKPIT_MODELS, models/cockpits/*.glb cut out with tools/cockpits/import_cockpit.py),
// loaded headless (textures stripped): every entry's file is there with as many SCREEN_<n> faces as it lists displays,
// each face UV-mapped 0..1 across it and facing the eye; a HUD combiner on the eye line ahead, a canopy over the head;
// the eye (the entry's `eye` offset applied) clear of the seat and everything else, with the panel ahead and below it;
// a triangle budget; and the source credited in the game and in models/cockpits/CREDITS.md.
import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { COCKPIT_MODELS } = await src('cockpit.js');
const { stripTextures, triangleCount } = await import('./helpers/aircraftmodel.mjs');
const repo = new URL('../', import.meta.url);

// the cockpit as the game places it: the file's scene moved so the pilot's eye is at the origin
async function load(def) {
    const buf = readFileSync(new URL(def.file, repo));
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(stripTextures(buf), '', res, rej));
    const root = gltf.scene;
    if (def.eye) root.position.set(-def.eye[0], -def.eye[1], -def.eye[2]);
    root.updateMatrixWorld(true);
    const meshes = [];
    root.traverse(o => { if (o.isMesh) meshes.push(o); });
    return { root, meshes, bytes: buf.length };
}
const worldBox = (o) => new THREE.Box3().setFromObject(o);

describe('model cockpits', () => {
    for (const [type, def] of Object.entries(COCKPIT_MODELS)) {
        test(`${type}: the file, its screens, HUD and canopy`, async () => {
            assert.ok(existsSync(new URL(def.file, repo)), def.file);
            const { root, meshes, bytes } = await load(def);
            const screens = meshes.filter(m => /^SCREEN_\d+$/.test(m.name)).sort((a, b) => +a.name.slice(7) - +b.name.slice(7));
            assert.equal(screens.length, def.screens.length, 'a display for every screen');
            screens.forEach((m, i) => assert.equal(m.name, 'SCREEN_' + i));
            for (const m of screens) {
                const uv = m.geometry.attributes.uv;
                let u0 = 1, u1 = 0, v0 = 1, v1 = 0;
                for (let i = 0; i < uv.count; i++) { u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i)); v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i)); }
                assert.ok(u0 < 0.01 && u1 > 0.99 && v0 < 0.01 && v1 > 0.99, m.name + ': UV 0..1 across');
                const c = worldBox(m).getCenter(new THREE.Vector3());
                assert.ok(c.z < -0.3 && c.y < 0, m.name + ': ahead of and below the eye');
                // (its face turned toward the eye)
                const g = m.geometry, P = g.attributes.position, idx = g.index;
                const a = new THREE.Vector3().fromBufferAttribute(P, idx ? idx.getX(0) : 0), b = new THREE.Vector3().fromBufferAttribute(P, idx ? idx.getX(1) : 1), d = new THREE.Vector3().fromBufferAttribute(P, idx ? idx.getX(2) : 2);
                [a, b, d].forEach(v => v.applyMatrix4(m.matrixWorld));
                const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
                assert.ok(Math.abs(n.normalize().dot(c.clone().normalize())) > 0.3, m.name + ': faces the eye');
            }
            const hud = meshes.find(m => m.name.startsWith('HUD_GLASS')), canopy = meshes.find(m => m.name.startsWith('CANOPY_GLASS'));
            assert.ok(canopy, 'canopy');
            // (a helmet display's cockpit has no combiner: hmd)
            assert.equal(!!hud, !def.hmd, def.hmd ? 'no HUD under a helmet display' : 'a HUD combiner');
            if (hud) {
                const hb = worldBox(hud), hc = hb.getCenter(new THREE.Vector3());
                assert.ok(hc.z < -0.35 && hc.z > -0.9, 'the HUD ahead: ' + hc.z.toFixed(2));
                assert.ok(Math.abs(Math.atan2(hc.y, -hc.z)) < 0.12, 'the HUD on the eye line (within 7°): ' + (Math.atan2(hc.y, -hc.z) * 57.3).toFixed(1));
            }
            const cb = worldBox(canopy);
            assert.ok(cb.max.y > 0.1 && cb.min.z < -0.3, 'the canopy over the head and ahead');
            assert.ok(triangleCount(root) < 200000, 'triangles: ' + triangleCount(root));
            assert.ok(bytes < 12e6, 'file size: ' + bytes);
        });

        test(`${type}: the eye is clear of the seat and the airframe, the panel ahead of it`, async () => {
            const { root, meshes } = await load(def);
            // nothing solid within 9 cm of the eye (the head is there), glass excepted
            const solid = meshes.filter(m => !/GLASS|SCREEN/.test(m.name));
            const v = new THREE.Vector3();
            let nearest = Infinity;
            for (const m of solid) {
                const P = m.geometry.attributes.position;
                for (let i = 0; i < P.count; i++) nearest = Math.min(nearest, v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld).length());
            }
            assert.ok(nearest > 0.09, 'nearest solid point to the eye: ' + nearest.toFixed(3) + ' m');
            // straight ahead out through the canopy: nothing in the way but glass; down and ahead, the panel
            const ray = new THREE.Raycaster();
            ray.set(new THREE.Vector3(), new THREE.Vector3(0, 0.05, -1).normalize());
            assert.equal(ray.intersectObjects(solid, false).length, 0, 'clear out of the windscreen');
            ray.set(new THREE.Vector3(), new THREE.Vector3(0, -0.7, -1).normalize());
            const h = ray.intersectObjects(solid.concat(meshes.filter(m => /SCREEN/.test(m.name))), false)[0];
            assert.ok(h && h.distance < 1.2, 'the panel below and ahead: ' + (h && h.distance.toFixed(2)));
        });

        test(`${type}: credited`, () => {
            const credits = readFileSync(new URL('models/cockpits/CREDITS.md', repo), 'utf8');
            const file = def.file.split('/').pop();
            assert.match(credits, new RegExp('`' + file.replace('.', '\\.') + '`'));
            const main = readFileSync(new URL('src/main.js', repo), 'utf8');
            const row = credits.split('\n').find(l => l.includes('`' + file + '`'));
            if (def.kit) {
                // (our own: built by the kit, CC0)
                assert.match(row, /cockpit_kit\.py/); assert.match(row, /CC0/);
                assert.ok(main.includes('tools/cockpits/cockpit_kit.py'), 'the kit in the in-game credits');
                return;
            }
            const url = row.match(/https:\/\/sketchfab\.com\/3d-models\/[^\s)]+/);
            assert.ok(url && main.includes(url[0]), 'the source in the in-game credits');
        });

        if (def.kit) test(`${type}: the kit's live faces, controls, placards and baked occlusion`, async () => {
            const buf = readFileSync(new URL(def.file, repo));
            const { meshes, root } = await load(def);
            const names = new Set(meshes.map(m => m.name));
            for (const k of ['adi', 'asi', 'alt']) assert.ok(names.has('GAUGE_' + k), 'GAUGE_' + k);
            // (every gauge face is one the game draws)
            for (const n of names) if (n.startsWith('GAUGE_')) assert.ok(['adi', 'hsi', 'asi', 'alt', 'vvi', 'g', 'rpm', 'egt', 'fuel', 'aoa'].includes(n.split('_')[1]), n);
            for (const k of ['master', 'stall', 'ab', 'brake', 'launch', 'lock', 'gear', 'fuel']) assert.ok(names.has('ANN_' + k), 'ANN_' + k);
            const nodes = []; root.traverse(o => nodes.push(o));
            assert.ok(nodes.some(o => o.name === 'STICK') && nodes.some(o => o.name === 'THROTTLE'), 'stick and throttle');
            assert.ok(nodes.filter(o => o.userData && o.userData.lbl != null).length > 40, 'placards');
            // the occlusion bake: every painted material of the merged cockpit has it, on the second UV set
            const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
            const painted = json.materials.filter(m => /^Ck(Grey|GreyDark|Turq|Black|Seat|SeatK)$/.test(m.name));
            assert.ok(painted.length >= 4 && painted.every(m => m.occlusionTexture && m.occlusionTexture.texCoord === 1), 'occlusion on uv1');
        });
    }
});

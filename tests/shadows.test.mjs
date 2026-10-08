import { src } from './helpers/setup.mjs';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const THREE = await import('three');
const { practicalSplits, cascadeLayout, lightBasis, snapToTexel, cascadeAhead, SunShadows, CSM_QUALITY, CSM_INSTALLED, CSM, SUN_TAN_RADIUS } = await src('shadows.js');
const { sweepShadow, sampleHeights, shadowAt, terrainVisibility, toHalf, NO_SHADOW } = await src('terrainshadowcore.js');

const QUALITIES = ['low', 'medium', 'high', 'ultra'];

describe('cascade layout', () => {
    test('practical split scheme: near to far, uniform at λ = 0, logarithmic at λ = 1, monotonic', () => {
        const u = practicalSplits(10, 1000, 4, 0), l = practicalSplits(10, 1000, 4, 1), p = practicalSplits(10, 1000, 4, 0.7);
        for (const s of [u, l, p]) { assert.equal(s.length, 5); assert.equal(s[0], 10); assert.ok(Math.abs(s[4] - 1000) < 1e-9); }
        u.forEach((v, i) => assert.ok(Math.abs(v - (10 + 990 * i / 4)) < 1e-9));
        l.forEach((v, i) => assert.ok(Math.abs(v - 10 * Math.pow(100, i / 4)) < 1e-9));
        for (let i = 1; i < 5; i++) { assert.ok(p[i] > p[i - 1]); assert.ok(p[i] >= l[i] - 1e-9 && p[i] <= u[i] + 1e-9); }
    });

    for (const q of QUALITIES) test(`${q}: ${CSM_QUALITY[q].n} cascades growing outward, texels 2R / size, finer ones redrawn at least as often`, () => {
        const L = cascadeLayout(q);
        assert.equal(L.length, CSM_QUALITY[q].n);
        for (let k = 0; k < L.length; k++) {
            assert.ok(Math.abs(L[k].texel - 2 * L[k].R / L[k].size) < 1e-12);
            assert.ok(L[k].every >= 1 && L[k].phase >= 0 && L[k].phase < L[k].every);
            if (k) { assert.ok(L[k].R > L[k - 1].R * 2, 'each cascade much bigger than the last'); assert.ok(L[k].every >= L[k - 1].every); }
        }
        // the finest is a few centimetres a texel on high and ultra; the shadow distance is a kilometre or more there
        if (q === 'high' || q === 'ultra') { assert.ok(L[0].texel < 0.05, `finest texel ${L[0].texel}`); assert.ok(L[L.length - 1].R >= 1000); }
    });

    test('a different cascade count per quality (it picks the shaders\' filters), and the chunks patched', () => {
        assert.equal(new Set(QUALITIES.map(q => CSM_QUALITY[q].n)).size, 4);
        assert.equal(CSM_INSTALLED, true);
        const C = THREE.ShaderChunk;
        assert.ok(C.shadowmap_pars_fragment.includes('float csmShadow('));
        assert.ok(C.lights_fragment_begin.includes('csmShadow( dot( geometryNormal, directLight.direction )'));
        assert.ok(C.lights_fragment_begin.includes('terrainSunShadow('));
        assert.ok(THREE.ShaderLib.standard.uniforms.csmInfo.value === CSM.info, 'shared by reference');
        assert.ok(THREE.ShaderLib.standard.uniforms.csmTerrain.value === CSM.terrainTex);
    });

    test('cascades sit ahead of the camera, on the focus when it is close', () => {
        assert.equal(cascadeAhead(40, 37, 38, true), 37);       // the chase camera's jet
        assert.equal(cascadeAhead(40, 5, 6, true), 20);         // too close: half the box ahead
        assert.equal(cascadeAhead(40, 300, 300, true), 20);     // out of reach
        assert.equal(cascadeAhead(1000, -1, 1e9, false), 750);  // no focus: three quarters ahead
        assert.equal(cascadeAhead(1000, 860, 870, false), 860); // the photo target on the airbase
    });
});

// A stand-in world: the scene, the sun cascade lights and a camera, flown along a path
function rig(q = 'high', sun = new THREE.Vector3(0.45, 0.62, -0.64).normalize()) {
    const scene = new THREE.Scene();
    const light = new THREE.DirectionalLight(0xffffff, 3);
    scene.add(light, light.target);
    const sh = new SunShadows(scene, light, () => 0);
    sh.setQuality(q);
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 1, 60000);
    return { scene, sh, cam, sun };
}
// where a world point lands in cascade k's shadow map (texel units), through three's own shadow matrix
function texelOf(sh, k, p) {
    const L = sh.lights[k];
    L.updateMatrixWorld(); L.target.updateMatrixWorld();
    L.shadow.camera.updateProjectionMatrix();
    L.shadow.updateMatrices(L);
    const v = p.clone().applyMatrix4(L.shadow.matrix);
    return { x: v.x * L.shadow.mapSize.x, y: v.y * L.shadow.mapSize.y, z: v.z };
}
const frac = (x) => x - Math.floor(x);

describe('stable cascades', () => {
    test('snapping: light-space centres are whole texels, and a point keeps its place within its texel', () => {
        const s = new THREE.Vector3(0.3, 0.5, 0.81).normalize(), ox = new THREE.Vector3(), oy = new THREE.Vector3(), o = new THREE.Vector3();
        lightBasis(s, ox, oy);
        assert.ok(Math.abs(ox.dot(s)) < 1e-12 && Math.abs(oy.dot(s)) < 1e-12 && Math.abs(ox.dot(oy)) < 1e-12);
        assert.ok(Math.abs(ox.y) < 1e-12, 'x axis level (three\'s shadow camera, up = +y)');
        const texel = 0.0371;
        for (let i = 0; i < 50; i++) {
            const p = new THREE.Vector3(1000 * Math.sin(i), 300 + 20 * i, -500 + 37.3 * i);
            snapToTexel(p, ox, oy, s, texel, o);
            assert.ok(Math.abs(o.x / texel - Math.round(o.x / texel)) < 1e-6 && Math.abs(o.y / texel - Math.round(o.y / texel)) < 1e-6);
        }
    });

    for (const q of ['high', 'ultra']) test(`${q}: the camera flies and turns, a fixed point's sub-texel position never changes in any cascade (no shimmer)`, () => {
        const { sh, cam, sun } = rig(q);
        const W = new THREE.Vector3(123.456, 31.7, -88.9); // a shadow edge on a hangar near the path
        const first = [];
        const focus = new THREE.Vector3();
        for (let f = 0; f < 240; f++) {
            // a slow fly-by: moving 0.731 m a frame (no whole number of texels), heading and pitch wandering
            const t = f / 60;
            cam.position.set(60 + f * 0.731, 40 + 3 * Math.sin(t), 20 - f * 0.29);
            cam.rotation.set(-0.3 + 0.1 * Math.sin(t * 1.3), 2.2 + 0.4 * Math.sin(t * 0.7), 0.05 * Math.sin(t * 2));
            cam.updateMatrixWorld();
            focus.copy(cam.position).addScaledVector(cam.getWorldDirection(new THREE.Vector3()), 30);
            sh.update(cam, focus, sun);
            for (let k = 0; k < sh.cascades.length; k++) {
                const c = sh.cascades[k], L = sh.lights[k];
                if (!L.shadow.needsUpdate) continue; // (not redrawn this frame: its old placement stands)
                // fixed size whatever the view
                assert.equal(L.shadow.camera.right - L.shadow.camera.left, 2 * c.R);
                const tx = texelOf(sh, k, W);
                const fx = frac(tx.x), fy = frac(tx.y);
                if (first[k] == null) first[k] = [fx, fy];
                const d = (a, b) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
                assert.ok(d(fx, first[k][0]) < 2e-3 && d(fy, first[k][1]) < 2e-3, `cascade ${k} frame ${f}: ${fx.toFixed(4)},${fy.toFixed(4)} vs ${first[k].map(v => v.toFixed(4))}`);
            }
        }
    });

    test('the point the camera looks after is inside the finest cascade; the ground far ahead inside a coarse one', () => {
        const { sh, cam, sun } = rig('high');
        cam.position.set(0, 8, 37); cam.lookAt(0, 2, 0); cam.updateMatrixWorld(); // a chase view of a jet on the runway
        const jet = new THREE.Vector3(0, 2, 0);
        sh.update(cam, jet, sun);
        const inBox = (k, p) => { const t = texelOf(sh, k, p), n = sh.lights[k].shadow.mapSize.x; return t.x > 0 && t.y > 0 && t.x < n && t.y < n && t.z > 0 && t.z < 1; };
        assert.ok(inBox(0, jet));
        // its shadow on the runway (along the sun ray) too
        const shadowPt = jet.clone().addScaledVector(sun, -2 / sun.y);
        assert.ok(inBox(0, shadowPt));
        const far = new THREE.Vector3(0, 0, -900);
        assert.ok(!inBox(0, far) && inBox(2, far));
    });

    test('size culling and finer-cascade culling of casters', () => {
        const { sh, cam, sun } = rig('ultra');
        cam.position.set(0, 10, 50); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
        sh.update(cam, new THREE.Vector3(0, 2, 0), sun);
        const c3 = sh.cascades[3];
        // a man (0.9 m) is too small for the 2 m texels of the farthest cascade; a hangar beyond the third isn't
        assert.equal(sh.wantCaster(3, new THREE.Sphere(new THREE.Vector3(1500, 1, -1200), 0.9)), false);
        assert.equal(sh.wantCaster(3, new THREE.Sphere(new THREE.Vector3(1500, 10, -1200), 30)), true);
        assert.ok(c3.texel > 0.9);
        // a truck in the middle of the second cascade (which reaches the ground) needn't be drawn again in the third
        const k1 = sh.cascades[1];
        assert.ok(k1.ground);
        const ox = sh.ox, oy = sh.oy, s = sh.sunDir;
        const centre1 = ox.clone().multiplyScalar(k1.u).addScaledVector(oy, k1.v).addScaledVector(s, k1.w);
        assert.equal(sh.wantCaster(2, new THREE.Sphere(centre1.clone(), 3)), false);
        // ... but one near that cascade's edge is
        const edge = centre1.clone().addScaledVector(ox, k1.R * 0.97);
        assert.equal(sh.wantCaster(2, new THREE.Sphere(edge, 3)), true);
        // and a cascade hung in the air round a jet (not reaching the ground) never stands in for a coarser one
        cam.position.set(0, 3000, 50); cam.lookAt(0, 3000, 0); cam.updateMatrixWorld();
        sh.refresh();
        sh.update(cam, new THREE.Vector3(0, 3000, 0), sun);
        assert.equal(sh.cascades[0].ground, false);
        const jet = sh.ox.clone().multiplyScalar(sh.cascades[0].u).addScaledVector(sh.oy, sh.cascades[0].v).addScaledVector(sh.sunDir, sh.cascades[0].w);
        assert.equal(sh.wantCaster(3, new THREE.Sphere(jet, 8)), true);
    });

    test('quality changes add and remove cascade lights; the sun stays light 0', () => {
        const { scene, sh } = rig('ultra');
        assert.equal(sh.lights.length, 4);
        sh.setQuality('medium');
        assert.equal(sh.lights.length, 2);
        assert.equal(scene.children.filter(o => o.isDirectionalLight).length, 2);
        assert.equal(scene.children.find(o => o.isDirectionalLight), sh.sun);
        sh.setQuality('low');
        assert.equal(sh.lights.length, 1);
        assert.ok(sh.sun.castShadow);
        for (const l of sh.lights.slice(1)) assert.equal(l.intensity, 0);
    });
});

describe('terrain shadow (shadow-top sweep)', () => {
    const N = 64, cell = 50;
    // a north-south wall 100 m high at column 40 on flat ground
    const wall = (x) => (Math.abs(x - 40 * cell) < 1 ? 100 : 0);

    test('a wall lit from the east casts a shadow of height / tan(elevation) to the west', () => {
        const H = sampleHeights((x) => wall(x), 0, 0, cell, N);
        const S = new Float32Array(N * N), D = new Float32Array(N * N);
        const tanEl = 0.2; // the sun 11.3° up in the east (+x)
        sweepShadow(H, N, cell, 1, 0, tanEl, S, D);
        const j = 30;
        for (let i = 0; i < N; i++) {
            const k = j * N + i, x = i * cell;
            if (i >= 40) { assert.ok(S[k] < 0.01, `no shadow east of the wall: ${i} ${S[k]}`); continue; }
            // the wall's shadow top falls away from it; past its end the flat ground just upsun sets it
            const dist = 40 * cell - x, wallTop = 100 - dist * tanEl, groundTop = -cell * tanEl;
            assert.ok(Math.abs(S[k] - Math.max(wallTop, groundTop)) < 1e-3, `shadow top at ${dist} m: ${S[k]}`);
            assert.ok(Math.abs(D[k] - (wallTop > groundTop ? dist : cell)) < 1e-3, `occluder distance ${D[k]}`);
        }
        // the ground is in shadow out to 500 m, then lit
        const vis = (x) => { const r = shadowAt(S, D, N, 0, 0, cell, x, j * cell); return terrainVisibility(0, r[0], r[1], SUN_TAN_RADIUS, 2); };
        assert.ok(vis(40 * cell - 300) < 0.01 && vis(40 * cell - 450) < 0.01);
        assert.ok(vis(40 * cell - 560) > 0.99);
        // a jet 120 m up over the shadow is in sunlight, one at 30 m isn't
        const r = shadowAt(S, D, N, 0, 0, cell, 40 * cell - 200, j * cell);
        assert.ok(terrainVisibility(120, r[0], r[1], SUN_TAN_RADIUS, 2) > 0.99 && terrainVisibility(30, r[0], r[1], SUN_TAN_RADIUS, 2) < 0.01);
    });

    test('nothing upsun: no shadow (the grid edge facing the sun, and a sun from the west over the same wall)', () => {
        const H = sampleHeights((x) => wall(x), 0, 0, cell, N);
        const S = new Float32Array(N * N), D = new Float32Array(N * N);
        sweepShadow(H, N, cell, -1, 0, 0.2, S, D);
        assert.equal(S[10 * N + 0], NO_SHADOW);                  // the west edge: nothing known upsun
        assert.ok(S[10 * N + 20] < 0.01);                        // west of the wall, lit
        assert.ok(Math.abs(S[10 * N + 45] - (100 - 5 * cell * 0.2)) < 1e-3); // east of it, in its shadow
    });

    test('lit or in shadow: the sweep agrees with a brute-force march over the true terrain, in every direction', () => {
        const h = (x, z) => 300 * Math.sin(x * 0.004) * Math.cos(z * 0.0031) + 120 * Math.sin(x * 0.011 + z * 0.007) + 200;
        const H = sampleHeights(h, 0, 0, cell, N);
        const S = new Float32Array(N * N), D = new Float32Array(N * N);
        for (const az of [0, 0.3, 0.785, 1.2, 2.5, 3.9, 5.1]) {
            const dx = Math.cos(az), dz = Math.sin(az), tanEl = 0.15;
            sweepShadow(H, N, cell, dx, dz, tanEl, S, D);
            let n = 0, wrong = 0;
            for (let j = 8; j < N - 8; j += 2) for (let i = 8; i < N - 8; i += 2) {
                // the true shadow: march the height field itself toward the sun, from one cell out, to the grid's edge
                let top = NO_SHADOW;
                for (let r = cell; ; r += cell / 4) {
                    const x = i * cell + dx * r, z = j * cell + dz * r;
                    if (x < 0 || z < 0 || x > (N - 1) * cell || z > (N - 1) * cell) break;
                    top = Math.max(top, h(x, z) - r * tanEl);
                }
                const ground = h(i * cell, j * cell), got = S[j * N + i];
                if (Math.abs(top - ground) < 25) continue; // (on the shadow's edge either answer is fair)
                n++;
                if ((top > ground) !== (got > ground)) wrong++;
            }
            assert.ok(n > 100 && wrong / n < 0.04, `az ${az}: ${wrong} of ${n} wrong`);
        }
    });

    test('visibility: smooth across the penumbra, sharper near the occluder, never sharper than the grid allows', () => {
        assert.equal(terrainVisibility(100, 100, 1000, SUN_TAN_RADIUS, 2), 0.5);
        const w = (d, pw) => { let a = 0, b = 0; for (let y = 50; y < 150; y += 0.01) { const v = terrainVisibility(y, 100, d, SUN_TAN_RADIUS, pw); if (v > 0.05 && !a) a = y; if (v > 0.95 && !b) b = y; } return b - a; };
        assert.ok(w(10000, 2) > w(500, 2) * 5, 'a far ridge gives a wide penumbra');
        assert.ok(w(10, 2) >= 2, 'the grid floor');
    });

    test('half floats for the texture', () => {
        for (const v of [0, 1, -1, 0.5, 1234.5, -9999, 65504, 1e-5, 3.14159, NO_SHADOW, 42000]) {
            const h = toHalf(v), back = THREE.DataUtils.fromHalfFloat(h);
            assert.ok(Math.abs(back - v) <= Math.max(Math.abs(v) * 1e-3, 1e-4), `${v} -> ${back}`);
            assert.ok(Math.abs(h - THREE.DataUtils.toHalfFloat(v)) <= 1, `${v}`); // (ties may round either way)
        }
    });
});

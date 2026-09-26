// ═══════════════════════════════════════════════════════════════
// Cost of the ship models (dev tool, not loaded by the game).
//   const M = await import('/tools/ships/measure.js');
//   await M.load()        // in a page that has not loaded them yet: per model, download+parse ms, first-build ms,
//                         // triangles and draw calls of one ship
//   M.frame(types)        // in a running naval sortie (perf/harness.js boot('naval')): spawn `types` round the
//                         // home carrier in view, then frame time with them drawn vs hidden (harness knockout),
//                         // main-pass draw calls and triangles with and without them, and naval.update ms
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function load(types = null) {
    const N = await import('/src/naval.js?m=' + Date.now());
    const files = N.SHIP_MODEL_FILES;
    const out = {};
    const loader = new GLTFLoader();
    const t0 = performance.now();
    // all in parallel, as preloadShips does (the boot cost is the slowest one, not the sum)
    await Promise.all(Object.entries(files).filter(([t]) => !types || types.includes(t)).map(async ([type, file]) => {
        const a = performance.now();
        const g = await loader.loadAsync(file + '?m=' + Date.now());
        out[type] = { loadMs: Math.round(performance.now() - a) };
        N.setShipModel(type, g);
    }));
    const all = Math.round(performance.now() - t0);
    for (const type of Object.keys(out)) {
        const a = performance.now();
        const m = N.shipModel(type);          // first build: glTF → template (merge, instancing) → clone
        out[type].firstBuildMs = Math.round(performance.now() - a);
        const b = performance.now();
        N.shipModel(type);                    // later ships of the type: a clone
        out[type].cloneMs = +(performance.now() - b).toFixed(2);
        let tris = 0, calls = 0;
        m.group.traverse(o => {
            if (!o.isMesh || !o.visible) return;
            calls++;
            const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
            tris += o.isInstancedMesh ? t * o.count : t;
        });
        out[type].tris = Math.round(tris);
        out[type].drawCalls = calls;
        out[type].rigNodes = Object.keys(m.rig.nodes).length;
    }
    return { parallelLoadMs: all, models: out };
}

// In a naval sortie: spawn the ships near the home carrier, point the photo camera at them, A/B the frame time
export async function frame(types, opts = {}) {
    const H = await import('/perf/harness.js');
    await (await import('/src/naval.js')).shipsLoaded();
    const S = window.skywar, g = S.game, nv = g.naval, cv = nv.homeCarrier;
    const ships = [];
    types.forEach((t, i) => {
        const side = i % 2 ? 1 : -1, rank = Math.floor(i / 2) + 1;
        const s = nv.spawn(t, 'blue', { x: cv.orbit.cx, z: cv.orbit.cz }, { orbitR: cv.orbit.R + side * 300 * rank, angle: cv.orbit.a + 0.04 * rank, dir: Math.sign(cv.orbit.w) || 1, passive: true });
        s.orbit.w = cv.orbit.w;
        ships.push(s);
    });
    H.install();
    H.step(30);
    // look at the group from 1.2 km off the carrier's beam, so every ship is in the frustum
    const p = cv.mesh.position;
    g.photo = { target: new THREE.Vector3(p.x, 20, p.z), yaw: cv.heading + 1.3, pitch: 0.18, dist: opts.dist ?? 1400 };
    H.step(10);
    // draws per frame, counted exactly (main pass and shadow pass) by the harness
    const count = () => { const l = H.drawsExact(1).split('\n')[0].split(' '); return { calls: +l[1], shadow: +l[3] }; };
    const on = count();
    ships.forEach(s => { s.mesh.visible = false; });
    const off = count();
    ships.forEach(s => { s.mesh.visible = true; });
    const ko = H.knockout((hide) => ships.forEach(s => { s.mesh.visible = !hide; }), opts.rounds ?? 16, opts.n ?? 20);
    // CPU cost of simulating them (naval.update with and without the new ships)
    H.reset();
    H.step(120);
    const rep = H.report();
    const navalLine = rep.split('\n').find(l => l.startsWith(' naval')) || '';
    g.photo = null;
    return { ships: ships.map(s => s.type), mainDrawsWith: on.calls, mainDrawsWithout: off.calls, shadowDrawsWith: on.shadow, shadowDrawsWithout: off.shadow, frameKnockout: ko, navalUpdate: navalLine.trim() };
}

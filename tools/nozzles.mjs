// Find the engine nozzles of the glTF aircraft models (a dev aid for models.js MODEL_FILES):
//   node tools/nozzles.mjs f15 f14 ...
// Loads each model like models.js does (rotation from MODEL_FILES, scaled to the real length,
// centred), then looks at the rear 20 % of the airframe near the centreline: for each z-slice it
// finds the tightest ring of vertices on each side and prints a nozzle centre and radius in units
// of the aircraft length (the format MODEL_FILES[...].nozzles / nozzleR use).
import '../tests/helpers/setup.mjs';
import { readFile } from 'node:fs/promises';
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { MODEL_FILES } = await import('../src/models.js');
const { AIRCRAFT } = await import('../src/config.js');

const ids = process.argv.slice(2);
for (const id of ids) {
    const info = MODEL_FILES[id];
    if (!info) { console.log(id, 'no model file'); continue; }
    const buf = await readFile(new URL('../models/' + info.file, import.meta.url));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
    const holder = new THREE.Group(), inner = new THREE.Group();
    inner.add(gltf.scene);
    inner.rotation.set(...info.rot);
    holder.add(inner);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const L = AIRCRAFT[id].length, scale = L / size.z;
    inner.position.copy(center).multiplyScalar(-scale);
    inner.scale.setScalar(scale);
    holder.updateMatrixWorld(true);
    const pts = [], v = new THREE.Vector3();
    holder.traverse(o => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pts.push([v.x / L, v.y / L, v.z / L]); }
    });
    const zmax = Math.max(...pts.map(p => p[2]));
    console.log(`\n${id}: ${pts.length} verts, rear z=${zmax.toFixed(3)} (current: ${JSON.stringify(info.nozzles || 'auto')})`);
    for (let z = zmax; z > zmax - 0.2; z -= 0.015) {
        const sl = pts.filter(p => p[2] <= z && p[2] > z - 0.015 && Math.abs(p[0]) < 0.14 && Math.abs(p[1]) < 0.12);
        if (sl.length < 12) continue;
        const row = [];
        for (const side of [-1, 1]) {
            const s = sl.filter(p => p[0] * side > 0.004);
            if (s.length < 6) continue;
            const xs = s.map(p => p[0]), ys = s.map(p => p[1]);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
            row.push(`${side < 0 ? 'L' : 'R'} x[${Math.min(...xs).toFixed(3)},${Math.max(...xs).toFixed(3)}] y[${Math.min(...ys).toFixed(3)},${Math.max(...ys).toFixed(3)}] c(${cx.toFixed(3)},${cy.toFixed(3)}) n${s.length}`);
        }
        console.log(`  z ${z.toFixed(3)}  ${row.join('  |  ')}`);
    }
}

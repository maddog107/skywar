// ═══════════════════════════════════════════════════════════════
// Terrain-shadow worker (terrainshadow.js): samples the terrain's height on a grid round the camera (terraincore.js,
// kept while the grid stays put) and sweeps the shadow top for the sun's direction (terrainshadowcore.js).
// Message in:  { id, x0, z0, cell, N, dx, dz, tanEl }   (grid origin, spacing, size; horizontal unit vector toward
//              the sun and the tangent of its elevation)
// Message out: { id, x0, z0, cell, N, half }  half: Uint16Array N×N×2 of (shadow top m, occluder distance m) as
//              half floats, transferred
// ═══════════════════════════════════════════════════════════════
import { terrainHeight } from './terraincore.js';
import { sampleHeights, sweepShadow, toHalf } from './terrainshadowcore.js';

let grid = null, H = null, S = null, D = null;

export function onMessage(e) {
    const m = e.data;
    const key = m.x0 + ',' + m.z0 + ',' + m.cell + ',' + m.N;
    if (grid !== key) {
        H = sampleHeights(terrainHeight, m.x0, m.z0, m.cell, m.N, H && H.length === m.N * m.N ? H : undefined);
        grid = key;
    }
    const n = m.N * m.N;
    if (!S || S.length !== n) { S = new Float32Array(n); D = new Float32Array(n); }
    sweepShadow(H, m.N, m.cell, m.dx, m.dz, m.tanEl, S, D);
    const half = new Uint16Array(n * 2);
    for (let k = 0; k < n; k++) { half[k * 2] = toHalf(S[k]); half[k * 2 + 1] = toHalf(D[k]); }
    self.postMessage({ id: m.id, x0: m.x0, z0: m.z0, cell: m.cell, N: m.N, half }, [half.buffer]);
}
// (only as a worker: the tests import every module)
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) self.onmessage = onMessage;

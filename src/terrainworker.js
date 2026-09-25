// ═══════════════════════════════════════════════════════════════
// Terrain worker: builds terrain tiles (terraincore.js tileJob) off the main thread.
// Messages in:  { type: 'ground', ground }  the road / town grading data (RoadGround.packed()), or null
//               { type: 'build', id, tx, tz, seg, T, gen }
// Messages out: { id, gen, tile }  the tile's arrays (transferred, not copied)
// ═══════════════════════════════════════════════════════════════
import { tileJob, runJob, roadConform } from './terraincore.js';

let conform = null;
function onMessage(e) {
    const m = e.data;
    if (m.type === 'ground') {
        const R = m.ground;
        conform = R ? (x, z, h) => roadConform(R, x, z, h) : null;
        return;
    }
    if (m.type === 'build') {
        const t = runJob(tileJob(m.tx, m.tz, m.seg, m.T, conform));
        self.postMessage({ id: m.id, gen: m.gen, tile: t }, [t.pos.buffer, t.nor.buffer, t.col.buffer, t.ht.buffer, t.mo.buffer, t.idx.buffer]);
    }
}
// (only as a worker: importing it anywhere else does nothing)
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) self.onmessage = onMessage;

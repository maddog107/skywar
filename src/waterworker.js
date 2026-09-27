// ═══════════════════════════════════════════════════════════════
// Sea-state map worker: builds the maps of watermap.js off the main thread.
// Messages in:  { type: 'coarse', id, cx, cz, wx, wz }   { type: 'fine', id, cx, cz }
// Messages out: { type, id, map: { data, size, texel, x0, z0 } }  (data transferred, not copied)
// The worker keeps the last coarse map: the fine one takes its exposure from it.
// ═══════════════════════════════════════════════════════════════
import { coarseJob, fineJob, runJob } from './watermap.js';

let coarse = null;
function onMessage(e) {
    const m = e.data;
    if (m.type === 'coarse') {
        coarse = runJob(coarseJob(m.cx, m.cz, m.wx, m.wz));
        const copy = { ...coarse, data: coarse.data.slice() };
        self.postMessage({ type: 'coarse', id: m.id, map: copy }, [copy.data.buffer]);
    } else if (m.type === 'fine') {
        const f = runJob(fineJob(m.cx, m.cz, coarse));
        self.postMessage({ type: 'fine', id: m.id, map: f }, [f.data.buffer]);
    }
}
// (only as a worker: importing it anywhere else does nothing)
if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) self.onmessage = onMessage;

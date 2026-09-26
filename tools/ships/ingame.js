// ═══════════════════════════════════════════════════════════════
// In-game check for the ship models (dev tool, not loaded by the game). In a running SKYWAR tab:
//   const G = await import('/tools/ships/ingame.js');
//   G.boot();                                   // naval sortie (home carrier + enemy group), keyboard controls
//   const group = G.group(['cruiser', 'destroyer', 'supply', 'ssn', 'rhib']);   // spawn them round the home carrier
//   G.step(600);                                // 10 s of game time: they steam, the wakes build up
//   await G.shot(group[0], 0.6, 0.25, 260, 'naval/ingame_cruiser.jpg');         // photo-mode camera → upload server
// Uses perf/harness.js (boot, step, shot) so frames are stepped with window.skywarStep, not rAF.
// ═══════════════════════════════════════════════════════════════
import * as H from '/perf/harness.js';
const S = () => window.skywar;

export function boot() {
    try { localStorage.setItem = () => {}; } catch (e) { /* */ }
    S().settings.controlMode = 'keyboard';
    return H.boot('naval');
}

// spawn `types` in a loose formation round the home carrier's circle (same angular speed, so they keep station)
export function group(types, opts = {}) {
    const g = S().game, nv = g.naval, cv = nv.homeCarrier;
    const out = [];
    types.forEach((t, i) => {
        const side = i % 2 ? 1 : -1, rank = Math.floor(i / 2) + 1;
        const R = cv.orbit.R + side * (opts.spread ?? 420) * rank;
        const s = nv.spawn(t, opts.team || 'blue', { x: cv.orbit.cx, z: cv.orbit.cz }, { orbitR: R, angle: cv.orbit.a + (opts.lead ?? 0.05) * rank * (i % 3 === 2 ? -1 : 1), dir: Math.sign(cv.orbit.w) || 1, passive: true });
        s.orbit.w = cv.orbit.w;
        out.push(s);
    });
    return out;
}

export function step(n) { H.step(n); return n; }

// photo-mode shot orbiting ship `s` (yaw, pitch in rad; dist m), saved through the preview upload server
export async function shot(s, yaw, pitch, dist, name, upload = 'http://localhost:8158/') {
    const p = s.mesh.position;
    const url = await H.shot(p.x, p.y + (s.def.deckY || 5), p.z, s.heading + yaw, pitch, dist, 6);
    const r = await fetch(upload + '?name=' + encodeURIComponent(name), { method: 'POST', body: url });
    return r.text();
}
export function unshot() { H.unshot(); }

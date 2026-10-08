// ═══════════════════════════════════════════════════════════════
// The terrain's shadow on the sun at any range: mountains throwing long shadows across the valleys at dawn and
// dusk, far beyond the shadow maps (which don't draw the terrain at all). A worker (terrainshadowworker.js) samples
// the height field on a 512² grid 100 m apart (51 km, reaching further toward the sun than away from it) and sweeps
// the shadow top for the sun's direction (terrainshadowcore.js); every lit material reads it (shadows.js
// terrainSunShadow) and darkens whatever lies below it, the ground, buildings, trees and aircraft alike.
// The grid moves with the camera in coarse steps; a new sweep follows the sun as the clock runs.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { CSM, TERRAIN_SHADOW } from './shadows.js';
import { terrainVisibility } from './terrainshadowcore.js';

const fromHalf = THREE.DataUtils.fromHalfFloat;

export class TerrainShadow {
    constructor(renderer) {
        this.renderer = renderer;
        this.N = TERRAIN_SHADOW.N;
        this.cell = TERRAIN_SHADOW.cell;
        this.tex = CSM.terrainTex; // (made at import by shadows.js: every material's uniform points at it)
        this.worker = null;
        this.busy = false;
        this.id = 0;
        this.grid = null;    // where the grid sits: ideal centre, origin
        this.want = null;    // the sweep wanted now
        this.sent = null;    // the one in the worker
        this.have = null;    // the one in the texture
        this.half = null;    // its data (for the CPU query)
        this.lastPost = -1e9;
        this.enabled = true;
        if (typeof Worker === 'undefined' || typeof window === 'undefined') return;
        try {
            const w = new Worker(new URL('./terrainshadowworker.js', import.meta.url), { type: 'module' });
            w.onmessage = (e) => this.onResult(e.data);
            w.onerror = (e) => { console.warn('terrain shadow worker failed: no terrain shadows', e.message || e); this.stop(); };
            this.worker = w;
        } catch (e) { this.worker = null; }
    }

    stop() {
        if (this.worker) this.worker.terminate();
        this.worker = null;
        CSM.terrainInfo[3] = 0;
    }

    // per frame: the grid round the camera, the sweep for the sun's direction (the moon's at night)
    update(cam, sunDir) {
        if (!this.worker) return;
        if (!this.enabled) { CSM.terrainInfo[3] = 0; return; }
        const N = this.N, cell = this.cell, span = N * cell;
        const hl = Math.hypot(sunDir.x, sunDir.z);
        const dx = hl > 1e-4 ? sunDir.x / hl : 1, dz = hl > 1e-4 ? sunDir.z / hl : 0;
        const tanEl = sunDir.y / Math.max(hl, 1e-4);
        // the grid reaches 0.7 of its span toward the sun (where the shadows come from), 0.3 away; it moves in
        // steps of 8 cells, once the camera is 6 km from where it would centre it
        const cx = cam.x + dx * span * 0.2, cz = cam.z + dz * span * 0.2;
        let g = this.grid;
        if (!g || Math.abs(cx - g.cx) > 6000 || Math.abs(cz - g.cz) > 6000) {
            const snap = cell * 8, gx = Math.round(cx / snap) * snap, gz = Math.round(cz / snap) * snap;
            g = this.grid = { cx: gx, cz: gz, x0: gx - span / 2, z0: gz - span / 2 };
        }
        const w = this.want || (this.want = {});
        w.x0 = g.x0; w.z0 = g.z0; w.dx = dx; w.dz = dz; w.tanEl = tanEl;
        this.post();
    }

    // the sweep differs enough from what's on its way (or shown) to be worth a new one: the grid moved, the sun's
    // azimuth by 0.05°, its elevation by 0.4 % of the shadows' length
    stale(a, b) {
        return !b || a.x0 !== b.x0 || a.z0 !== b.z0 || Math.abs(a.dx * b.dz - a.dz * b.dx) > 9e-4
            || Math.abs(a.tanEl - b.tanEl) > Math.max(a.tanEl, 0.02) * 0.004;
    }

    post() {
        const w = this.want, now = performance.now();
        if (this.busy || !w || !this.stale(w, this.sent) || now - this.lastPost < 150) return;
        this.busy = true;
        this.lastPost = now;
        this.sent = { ...w };
        this.worker.postMessage({ id: ++this.id, x0: w.x0, z0: w.z0, cell: this.cell, N: this.N, dx: w.dx, dz: w.dz, tanEl: w.tanEl });
    }

    onResult(m) {
        this.busy = false;
        if (m.N !== this.N || !this.sent) return;
        const tex = this.tex;
        tex.image.data = m.half;
        tex.needsUpdate = true;
        if (this.renderer) this.renderer.initTexture(tex); // (the materials hold clones of it that share its image)
        this.half = m.half;
        this.have = { ...this.sent, x0: m.x0, z0: m.z0 };
        // (x0, z0 of the texture's edge, 1 / its span, the narrowest penumbra: half a texel's worth of the slope)
        const I = CSM.terrainInfo;
        I[0] = m.x0 - m.cell / 2; I[1] = m.z0 - m.cell / 2; I[2] = 1 / (m.N * m.cell);
        I[3] = Math.max(2, 0.5 * m.cell * Math.max(this.have.tanEl, 0));
        this.post();
    }

    // sunlight at a world point from the terrain's shadow (1 lit, 0 shadow; 1 off the grid), as the shaders see it
    visibilityAt(x, y, z) {
        const h = this.half, g = this.have;
        if (!h || !g || CSM.terrainInfo[3] <= 0) return 1;
        const N = this.N, cell = this.cell;
        const fx = (x - g.x0) / cell, fz = (z - g.z0) / cell;
        if (fx < 0 || fz < 0 || fx > N - 1 || fz > N - 1) return 1;
        const i = Math.min(Math.floor(fx), N - 2), j = Math.min(Math.floor(fz), N - 2), a = fx - i, b = fz - j;
        const at = (ii, jj, c) => fromHalf(h[(jj * N + ii) * 2 + c]);
        const bl = (c) => (at(i, j, c) * (1 - a) + at(i + 1, j, c) * a) * (1 - b) + (at(i, j + 1, c) * (1 - a) + at(i + 1, j + 1, c) * a) * b;
        return terrainVisibility(y, bl(0), bl(1), CSM.info[1], CSM.terrainInfo[3]);
    }
}

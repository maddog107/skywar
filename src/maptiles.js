// ═══════════════════════════════════════════════════════════════
// Tactical map background at close zoom (tacmap.js): a pyramid of 256-px tiles painted off the main thread by a
// small pool of map workers (mapworker.js: land cover, hill shading, contour lines, the sea by depth), kept in an
// LRU cache and drawn under the map's vector layers. A tile that isn't painted yet borrows the nearest coarser
// one, scaled up, so zooming in sharpens progressively instead of flashing.
// Level L tiles are 16 km / 2^L across: level 1 is 31 m a pixel … level 6 under 1 m. The worker samples the
// terrain on a 31-62 m grid and interpolates (the height field has no finer detail), so a tile costs 5-60 ms.
// ═══════════════════════════════════════════════════════════════
const TILE = 256, SPAN0 = 16000, MIN_LEVEL = 1, MAX_LEVEL = 6, CACHE = 220, IN_FLIGHT = 2;
const P = { x: 0, y: 0 };

export class MapTiles {
    constructor() {
        this.cache = new Map();     // key → { img, used }
        this.pending = new Set();
        this.workers = null;
        this.frame = 0;
        this.want = [];
        this.pool = [];
        this.painted = 0;
    }

    // tiles are worth drawing once the base picture (125 m a pixel) is well under the screen's resolution
    active(map) { return map.scale * (map.dpr || 1) > 0.02; }

    ensureWorkers() {
        if (this.workers) return this.workers.length > 0;
        this.workers = [];
        const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
        for (let k = 0; k < n; k++) {
            try {
                const w = new Worker(new URL('./mapworker.js', import.meta.url), { type: 'module' });
                w.busy = 0;
                w.onmessage = (e) => this.onTile(w, e.data);
                w.onerror = (e) => { w.dead = true; console.warn('[maptiles] worker failed', e.message || e); };
                this.workers.push(w);
            } catch (e) { break; }
        }
        return this.workers.length > 0;
    }

    onTile(w, d) {
        w.busy = Math.max(0, w.busy - 1);
        this.pending.delete(d.key);
        let img = d.bitmap;
        if (!img && d.pixels) {
            img = document.createElement('canvas');
            img.width = img.height = d.size;
            img.getContext('2d').putImageData(new ImageData(d.pixels, d.size, d.size), 0, 0);
        }
        if (!img) return;
        this.cache.set(d.key, { img, used: this.frame });
        this.painted++;
        if (this.cache.size > CACHE) {
            // least recently drawn first (never one drawn this frame)
            let oldK = null, oldU = Infinity;
            for (const [k, t] of this.cache) if (t.used < oldU && t.used < this.frame) { oldU = t.used; oldK = k; }
            if (oldK) { const t = this.cache.get(oldK); if (t.img.close) t.img.close(); this.cache.delete(oldK); }
        }
    }

    levelFor(pxPerM) { return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.ceil(Math.log2(62.5 * pxPerM)))); }

    draw(ctx, map) {
        this.frame++;
        if (!this.active(map) || !this.ensureWorkers()) return;
        const lvl = this.levelFor(map.scale * (map.dpr || 1)), span = SPAN0 / 2 ** lvl, sp = span * map.scale;
        const a = map.toWorld(0, 0), b = map.toWorld(map.w, map.h);
        const i0 = Math.floor(a.x / span), i1 = Math.floor(b.x / span), j0 = Math.floor(a.z / span), j1 = Math.floor(b.z / span);
        const want = this.want;
        want.length = 0;
        ctx.imageSmoothingEnabled = true;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const key = lvl + '/' + i + '/' + j;
            map.toScreen(i * span, j * span, P);
            // whole pixels, shared edges: no hairline seams between tiles
            const x0 = Math.floor(P.x), y0 = Math.floor(P.y), w = Math.floor(P.x + sp) - x0, h = Math.floor(P.y + sp) - y0;
            const t = this.cache.get(key);
            if (t) { t.used = this.frame; ctx.drawImage(t.img, x0, y0, w, h); continue; }
            this.drawAncestor(ctx, lvl, i, j, x0, y0, w, h);
            if (!this.pending.has(key)) {
                const o = this.pool[want.length] || (this.pool[want.length] = {});
                o.key = key; o.i = i; o.j = j; o.d = ((i + 0.5) * span - map.view.cx) ** 2 + ((j + 0.5) * span - map.view.cz) ** 2;
                want.push(o);
            }
        }
        // the nearest missing tiles first, a couple in flight per worker
        if (!want.length) return;
        want.sort(byDist);
        let k = 0;
        for (const w of this.workers) {
            while (!w.dead && w.busy < IN_FLIGHT && k < want.length) {
                const t = want[k++];
                w.busy++;
                this.pending.add(t.key);
                w.postMessage({ tile: true, key: t.key, size: TILE, x0: t.i * span, z0: t.j * span, span, level: lvl });
            }
        }
    }

    drawAncestor(ctx, lvl, i, j, x, y, w, h) {
        for (let up = 1; lvl - up >= MIN_LEVEL; up++) {
            const f = 2 ** up, pi = Math.floor(i / f), pj = Math.floor(j / f);
            const t = this.cache.get((lvl - up) + '/' + pi + '/' + pj);
            if (!t) continue;
            t.used = this.frame;
            const s = TILE / f;
            ctx.drawImage(t.img, (i - pi * f) * s, (j - pj * f) * s, s, s, x, y, w, h);
            return;
        }
    }
}
const byDist = (p, q) => p.d - q.d;

// ═══════════════════════════════════════════════════════════════
// Underground bases (docs/WAR.md, a war plug-in): hidden mountain complexes in enemy territory.
// (work in progress: the static world first)
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { UG_SITES, siteToWorld, worldToSite, ugPaved, carveBounds } from './ugsites.js';
import { ComplexWorld, setTerrainCuts } from './ugworld.js';

export class Underground {
    constructor(game) {
        this.game = game;
        this.complexes = [];
        this.built = false;
        this.enabled = false;
    }

    // the static world is built once (every mode shows the complexes, closed and quiet outside the war)
    build() {
        if (this.built) return;
        this.built = true;
        const g = this.game;
        for (const site of UG_SITES) this.complexes.push({ site, world: new ComplexWorld(g, site) });
        setTerrainCuts(this.complexes.flatMap(c => c.world.patches));
        // no trees or grass on the paving and in the cuttings (the tiles already planted there are replanted)
        const w = g.world, prev = w.blockTree;
        w.blockTree = (x, z) => (prev ? prev(x, z) : false) || ugPaved(x, z, 6);
        const prevG = w.noGrass;
        w.noGrass = (x, z) => (prevG ? prevG(x, z) : false) || ugPaved(x, z, 2);
        for (const b of carveBounds()) {
            const T = w.TILE;
            for (const [key, t] of w.tiles || []) {
                const [tx, tz] = key.split(',').map(Number);
                if (b.bb[2] < tx * T || b.bb[0] > (tx + 1) * T || b.bb[3] < tz * T || b.bb[1] > (tz + 1) * T) continue;
                t.treesDone = false;
            }
        }
    }

    start(mode) {
        this.build();
        this.mode = mode;
        this.enabled = mode === 'war' || mode === 'sandbox';
    }

    clear() { this.enabled = false; }

    update(dt) {
        if (!this.built) return;
        for (const c of this.complexes) c.world.update(dt);
    }
}

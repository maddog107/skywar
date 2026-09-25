// ═══════════════════════════════════════════════════════════════
// Terrain batch: every terrain tile drawn by one BatchedMesh — one multi-draw call for the whole
// terrain (~90 tiles in view) instead of a draw call per tile. Each LOD has a pool of fixed-size
// geometry slots in the batch; a tile takes a slot of its resolution and hands it back when it
// changes resolution or leaves the view. The batch culls tiles against the view itself and sorts
// them front to back. If a pool runs dry, the caller draws that tile as a mesh of its own.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

// vertices and indices of a tile with seg x seg quads plus skirts (terraincore.js tileJob)
export const tileVerts = (seg) => (seg + 1) * (seg + 1) + 4 * (seg + 1);
export const tileIndices = (seg) => seg * seg * 6 + seg * 24;

export class TerrainBatch {
    // slots: { seg: how many tiles of that resolution can be in the batch at once }
    constructor(material, slots) {
        this.slots = slots;
        let verts = 0, idx = 0, n = 0;
        for (const [seg, k] of Object.entries(slots)) { verts += k * tileVerts(+seg); idx += k * tileIndices(+seg); n += k; }
        const mesh = this.mesh = new THREE.BatchedMesh(n, verts, idx, material);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.frustumCulled = false; // (tiles come and go: the batch culls each one itself)
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldAutoUpdate = false;
        this.free = {};  // seg → geometry ids ready for reuse
        this.left = {};  // seg → slots not reserved yet
        for (const [seg, k] of Object.entries(slots)) { this.free[seg] = []; this.left[seg] = k; }
    }

    // put a tile's geometry in the batch: a handle, or null when that resolution's slots are all taken
    add(seg, geo) {
        let gid = this.free[seg] ? this.free[seg].pop() : undefined;
        if (gid !== undefined) this.mesh.setGeometryAt(gid, geo);
        else if (this.left[seg] > 0) { this.left[seg]--; gid = this.mesh.addGeometry(geo, tileVerts(seg), tileIndices(seg)); }
        else return null;
        return { seg, gid, iid: this.mesh.addInstance(gid) };
    }

    remove(h) {
        this.mesh.deleteInstance(h.iid);
        this.free[h.seg].push(h.gid);
    }
}

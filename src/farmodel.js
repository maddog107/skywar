// ═══════════════════════════════════════════════════════════════
// A cheap far version of an aircraft model (air support, airsupport.js): the support types are 20–50k triangles
// in tens of draw calls (a material per section and part), which is a lot for something a few pixels across.
// Beyond a few km the real jet is drawn with this instead: the model's triangles clustered onto a grid (vertex
// clustering: every vertex snaps to its cell's average, collapsed triangles go), one mesh, one draw, vertex colours
// taken from the materials and their textures, no shadow. Built once per type, shared by every jet of it.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';

const cache = new Map();   // type → { geometry, material } | null (couldn't)
const texCols = new Map(); // texture → { w, h, data } sampled small

// a texture's colours at 64×64 (null when its image can't be read: no DOM, a tainted canvas)
function sampler(tex) {
    if (texCols.has(tex)) return texCols.get(tex);
    let s = null;
    try {
        const img = tex && tex.image;
        if (img && typeof document !== 'undefined') {
            const c = document.createElement('canvas');
            c.width = c.height = 64;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            if (ctx && ctx.getImageData) { ctx.drawImage(img, 0, 0, 64, 64); s = { w: 64, h: 64, data: ctx.getImageData(0, 0, 64, 64).data }; }
        }
    } catch (e) { s = null; }
    texCols.set(tex, s);
    return s;
}

// the triangles of an object (model space) clustered on a grid `cell` m: { position, color, index } arrays.
// colorSplit: vertices of clearly different colours in one cell stay apart (a red wingtip, a dark window band), so
// small markings keep their colour instead of averaging into the paint around them
export function clusterTriangles(root, cell, { skip = null, colorSplit = false } = {}) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const m = new THREE.Matrix4(), v = new THREE.Vector3(), col = new THREE.Color(), uv = new THREE.Vector2();
    const cells = new Map();      // cell key → index
    const sum = [];               // per cell: x, y, z, r, g, b, n
    const tris = new Set();
    const index = [];
    const key = (x, y, z) => Math.round(x / cell) + ',' + Math.round(y / cell) + ',' + Math.round(z / cell);
    root.traverse((o) => {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.visible === false) return;
        if (skip && skip(o)) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const mat0 = mats[0];
        if (!mat0 || mat0.transparent) return; // (glass, blur discs)
        m.multiplyMatrices(inv, o.matrixWorld);
        const g = o.geometry, pos = g.attributes.position, uvA = g.attributes.uv, idx = g.index;
        const n = idx ? idx.count : pos.count;
        const tex = mat0.map ? sampler(mat0.map) : null;
        const base = mat0.color || col.set(0.6, 0.6, 0.6);
        const vcol = mat0.vertexColors && g.attributes.color ? g.attributes.color : null;
        const ids = [0, 0, 0];
        for (let t = 0; t + 2 < n; t += 3) {
            for (let k = 0; k < 3; k++) {
                const i = idx ? idx.getX(t + k) : t + k;
                v.fromBufferAttribute(pos, i).applyMatrix4(m);
                // the colour: the material's, times the texture's there
                let r = base.r, gC = base.g, b = base.b;
                // (a merged model's plain parts carry their colours per vertex: meshmerge.js)
                if (vcol) { r *= vcol.getX(i); gC *= vcol.getY(i); b *= vcol.getZ(i); }
                if (tex && uvA) {
                    uv.fromBufferAttribute(uvA, i);
                    const px = ((Math.floor(uv.x * tex.w) % tex.w) + tex.w) % tex.w, py = ((Math.floor(uv.y * tex.h) % tex.h) + tex.h) % tex.h;
                    const o4 = (py * tex.w + px) * 4;
                    r *= (tex.data[o4] / 255) ** 2.2; gC *= (tex.data[o4 + 1] / 255) ** 2.2; b *= (tex.data[o4 + 2] / 255) ** 2.2;
                }
                // (colours compared in a perceptual-ish space: square roots of the linear values, in eighths)
                const kk = key(v.x, v.y, v.z) + (colorSplit ? ',' + Math.round(Math.sqrt(r) * 8) + ',' + Math.round(Math.sqrt(gC) * 8) + ',' + Math.round(Math.sqrt(b) * 8) : '');
                let c = cells.get(kk);
                if (c === undefined) { c = sum.length / 7; cells.set(kk, c); sum.push(0, 0, 0, 0, 0, 0, 0); }
                const s = c * 7;
                sum[s] += v.x; sum[s + 1] += v.y; sum[s + 2] += v.z; sum[s + 3] += r; sum[s + 4] += gC; sum[s + 5] += b; sum[s + 6]++;
                ids[k] = c;
            }
            if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
            const sorted = ids[0] < ids[1] ? (ids[1] < ids[2] ? [ids[0], ids[1], ids[2]] : ids[0] < ids[2] ? [ids[0], ids[2], ids[1]] : [ids[2], ids[0], ids[1]]) : (ids[0] < ids[2] ? [ids[1], ids[0], ids[2]] : ids[1] < ids[2] ? [ids[1], ids[2], ids[0]] : [ids[2], ids[1], ids[0]]);
            const tk = sorted[0] + '_' + sorted[1] + '_' + sorted[2];
            if (tris.has(tk)) continue;
            tris.add(tk);
            index.push(ids[0], ids[1], ids[2]);
        }
    });
    const nc = sum.length / 7;
    const position = new Float32Array(nc * 3), color = new Float32Array(nc * 3);
    for (let c = 0; c < nc; c++) {
        const s = c * 7, k = sum[s + 6] || 1;
        position[c * 3] = sum[s] / k; position[c * 3 + 1] = sum[s + 1] / k; position[c * 3 + 2] = sum[s + 2] / k;
        color[c * 3] = sum[s + 3] / k; color[c * 3 + 1] = sum[s + 4] / k; color[c * 3 + 2] = sum[s + 5] / k;
    }
    return { position, color, index };
}

// the far version of a type (shared), built from one of its jets' models; null if it couldn't be
export function farModelFor(ac) {
    const type = ac.type;
    if (cache.has(type)) return cache.get(type);
    let out = null;
    try {
        const L = ac.spec.length;
        // (a cell of ~1/70 of the length: an E-3 comes out at a couple of thousand triangles)
        const { position, color, index } = clusterTriangles(ac.model, L / 70, { skip: (o) => /prop|flame|nav/i.test(o.name || ''), colorSplit: true });
        if (index.length >= 30) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(position, 3));
            g.setAttribute('color', new THREE.BufferAttribute(color, 3));
            g.setIndex(index);
            g.computeVertexNormals();
            g.computeBoundingSphere();
            const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.08, side: THREE.DoubleSide });
            out = { geometry: g, material: mat, triangles: index.length / 3 };
        }
    } catch (e) { console.warn('[farmodel] could not build', type, e); out = null; }
    cache.set(type, out);
    return out;
}

// a mesh of it for one jet (hung on its root, beside its model)
export function farMesh(ac) {
    const f = farModelFor(ac);
    if (!f) return null;
    const mesh = new THREE.Mesh(f.geometry, f.material);
    mesh.name = 'farModel';
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.position.copy(ac.model.position); mesh.quaternion.copy(ac.model.quaternion); mesh.scale.copy(ac.model.scale);
    mesh.visible = false;
    ac.root.add(mesh);
    return mesh;
}

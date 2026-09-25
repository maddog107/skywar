// ═══════════════════════════════════════════════════════════════
// Static mesh merging: fewer draw calls for models whose parts never move on their own
// (parked aircraft, air traffic, ships). Every draw call costs about the same CPU time
// whether it draws 12 triangles or 12 000, so a 37-mesh airliner drawn as 37 meshes
// costs as much as 37 airliners drawn as one mesh each.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// A plain material: untextured, opaque, standard. Plain materials that differ only in colour, roughness, metalness
// and emissive can share one mesh: those go into vertex attributes (see plainMaterial). The signature is
// everything else that changes how they draw. userData.noMerge keeps a material to itself (one that is changed
// while the game runs, e.g. a ship's "Under" paint that shipfx.js tints).
function plainSignature(m) {
    if (!m || m.type !== 'MeshStandardMaterial' || m.map || m.vertexColors || m.transparent || m.opacity !== 1 || m.alphaMap || m.alphaTest > 0
        || m.normalMap || m.bumpMap || m.roughnessMap || m.metalnessMap || m.emissiveMap || m.aoMap || m.lightMap || m.displacementMap || m.envMap
        || m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || m.userData.noMerge) return null;
    return ['plain', m.side, m.envMapIntensity, m.flatShading, m.fog, m.toneMapped, m.depthTest, m.depthWrite, m.polygonOffset, m.polygonOffsetFactor,
        m.polygonOffsetUnits, m.wireframe, m.blending, m.colorWrite, m.forceSinglePass, m.shadowSide, m.dithering].join('|');
}

// The material for merged plain meshes: a copy of the first one, reading colour, roughness / metalness (aRM) and
// emissive (aEmi) per vertex. One per signature, shared by every merged model (fewer material switches a frame).
const _plainMats = new Map();
function plainMaterial(src, sig) {
    if (_plainMats.has(sig)) return _plainMats.get(sig);
    const m = src.clone();
    _plainMats.set(sig, m);
    m.color.setRGB(1, 1, 1);
    m.vertexColors = true;
    m.roughness = 1; m.metalness = 1; m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 1;
    m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute vec2 aRM;\nattribute vec3 aEmi;\nvarying vec2 vRM;\nvarying vec3 vEmi;')
            .replace('#include <color_vertex>', '#include <color_vertex>\nvRM = aRM; vEmi = aEmi;');
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vRM;\nvarying vec3 vEmi;')
            .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vRM.x;')
            .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vRM.y;')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vEmi;');
    };
    m.customProgramCacheKey = () => 'plainmerged';
    return m;
}

// attributes a material reads from a geometry
function neededAttributes(m, geo) {
    const a = ['position', 'normal'];
    if (geo.attributes.uv && (m.map || m.normalMap || m.bumpMap || m.roughnessMap || m.metalnessMap || m.emissiveMap || m.alphaMap || m.aoMap || m.lightMap || m.specularMap || m.displacementMap)) a.push('uv');
    if (geo.attributes.uv1 && (m.aoMap || m.lightMap)) a.push('uv1');
    if (m.vertexColors && geo.attributes.color) a.push('color');
    if (m.normalMap && geo.attributes.tangent) a.push('tangent');
    return a;
}

// Merge the meshes under `root` (in root's space), except the `keep` subtrees, and visible ones only.
// Returns { meshes: merged meshes, used: the source meshes they replace }. A mesh is merged with the others of
// its material, or — plain materials — with every plain material of the same signature (colour → vertex colour).
// Skinned, morphed and instanced meshes are left alone.
function collect(root, keep) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const rel = new THREE.Matrix4();
    const groups = new Map(); // key → { mat, plain, geos, cast, receive }
    const used = [];
    const walk = (o, vis) => {
        if (keep.has(o)) return;
        vis = vis && o.visible;
        if (o.isMesh && vis && !o.isSkinnedMesh && !o.isInstancedMesh && !Object.keys(o.geometry.morphAttributes).length && o.geometry.attributes.normal) {
            rel.multiplyMatrices(inv, o.matrixWorld);
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            const ranges = Array.isArray(o.material) && o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
            const parts = [];
            let ok = true;
            for (const r of ranges) {
                const m = mats[r.materialIndex];
                if (!m) continue;
                const sig = plainSignature(m);
                const names = sig ? ['position', 'normal'] : neededAttributes(m, o.geometry);
                if (names.some(n => !o.geometry.attributes[n])) { ok = false; break; }
                parts.push({ m, sig, names, r });
            }
            if (ok && parts.length) {
                for (const { m, sig, names, r } of parts) {
                    const g = new THREE.BufferGeometry();
                    for (const n of names) g.setAttribute(n, o.geometry.attributes[n].clone());
                    if (o.geometry.index) g.setIndex(o.geometry.index.clone());
                    g.applyMatrix4(rel);
                    let flat = g.index ? g.toNonIndexed() : g;
                    if (r.count !== Infinity || r.start) { // one material's range of a multi-material mesh
                        const part = new THREE.BufferGeometry(), end = Math.min(r.start + r.count, flat.attributes.position.count);
                        for (const [k, a] of Object.entries(flat.attributes)) part.setAttribute(k, new THREE.BufferAttribute(a.array.slice(r.start * a.itemSize, end * a.itemSize), a.itemSize));
                        flat = part;
                    }
                    // a mirrored part: baking the transform reverses its triangles' winding, so turn them back
                    if (rel.determinant() < 0) {
                        for (const n of Object.keys(flat.attributes)) {
                            const A = flat.attributes[n], s = A.itemSize, arr = A.array;
                            for (let t = 0; t + 2 < A.count; t += 3) for (let c = 0; c < s; c++) { const i1 = (t + 1) * s + c, i2 = (t + 2) * s + c, tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp; }
                        }
                    }
                    if (sig) {
                        const n = flat.attributes.position.count, col = new Float32Array(n * 3), rm = new Float32Array(n * 2), emi = new Float32Array(n * 3);
                        const er = m.emissive.r * m.emissiveIntensity, eg = m.emissive.g * m.emissiveIntensity, eb = m.emissive.b * m.emissiveIntensity;
                        for (let i = 0; i < n; i++) {
                            col[i * 3] = m.color.r; col[i * 3 + 1] = m.color.g; col[i * 3 + 2] = m.color.b;
                            rm[i * 2] = m.roughness; rm[i * 2 + 1] = m.metalness;
                            emi[i * 3] = er; emi[i * 3 + 1] = eg; emi[i * 3 + 2] = eb;
                        }
                        flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
                        flat.setAttribute('aRM', new THREE.BufferAttribute(rm, 2));
                        flat.setAttribute('aEmi', new THREE.BufferAttribute(emi, 3));
                    }
                    const key = (sig || m.uuid) + '#' + names.join(',');
                    let e = groups.get(key);
                    if (!e) groups.set(key, e = { mat: m, plain: !!sig, sig, geos: [], cast: false, receive: false });
                    e.geos.push(flat);
                    e.cast = e.cast || o.castShadow; e.receive = e.receive || o.receiveShadow;
                }
                used.push(o);
            }
        }
        for (const c of o.children) walk(c, vis);
    };
    walk(root, true);
    const meshes = [];
    for (const e of groups.values()) {
        let geo = null;
        try { geo = mergeGeometries(e.geos); } catch (err) { geo = null; }
        e.geos.forEach(g => g.dispose());
        if (!geo) return { meshes: [], used: [] }; // odd attribute sets: leave everything as it was
        const mat = e.plain ? plainMaterial(e.mat, e.sig) : e.mat;
        if (mat.transparent && mat.side === THREE.DoubleSide && !mat.forceSinglePass) {
            // see-through and two-sided (canopy glass): three.js draws such a mesh twice, back faces then front, and
            // has to re-resolve its shader for each pass every frame. Two meshes (back then front, same place, so
            // they sort next to each other in that order) draw the same without that.
            const [back, front] = twoSided(mat);
            const b = new THREE.Mesh(geo, back), f = new THREE.Mesh(geo, front);
            b.receiveShadow = f.receiveShadow = e.receive;
            f.castShadow = e.cast; // (one shadow, drawn both-sided as before: see twoSided)
            meshes.push(b, f);
            continue;
        }
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = e.cast; mesh.receiveShadow = e.receive;
        meshes.push(mesh);
    }
    return { meshes, used };
}

// back-face and front-face copies of a two-sided transparent material (one pair per material)
const _twoSided = new WeakMap();
function twoSided(mat) {
    let p = _twoSided.get(mat);
    if (!p) {
        const back = mat.clone(), front = mat.clone();
        back.side = THREE.BackSide; front.side = THREE.FrontSide;
        front.shadowSide = mat.shadowSide ?? THREE.DoubleSide; // a DoubleSide material's shadow is drawn both-sided
        _twoSided.set(mat, p = [back, front]);
    }
    return p;
}

// A new Group (with the object's own transform) holding the object's visible meshes, merged (see collect).
// Unmergeable meshes are cloned into it as they are. `object` itself is not changed.
export function mergeStaticModel(object) {
    const out = new THREE.Group();
    out.name = object.name;
    out.position.copy(object.position); out.quaternion.copy(object.quaternion); out.scale.copy(object.scale);
    const { meshes, used } = collect(object, new Set());
    const merged = new Set(used);
    const inv = new THREE.Matrix4().copy(object.matrixWorld).invert(), rel = new THREE.Matrix4();
    const visible = (o) => { for (let q = o; q && q !== object; q = q.parent) if (!q.visible) return false; return true; };
    object.traverse(o => {
        if (!o.isMesh || merged.has(o) || !visible(o)) return;
        const c = o.clone();
        rel.multiplyMatrices(inv, o.matrixWorld).decompose(c.position, c.quaternion, c.scale);
        out.add(c);
    });
    out.add(...meshes);
    return out;
}

// Merge `root`'s static meshes in place: the merged meshes become children of root and the meshes they replace
// are removed. The `keep` objects (turrets, radars: things that move) and everything under them stay as they are.
export function mergeInPlace(root, keep = []) {
    const { meshes, used } = collect(root, new Set(keep));
    if (!meshes.length) return root;
    for (const o of used) o.parent.remove(o);
    root.add(...meshes);
    return root;
}

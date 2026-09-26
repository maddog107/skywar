// ═══════════════════════════════════════════════════════════════
// Moving surfaces cut from the model's own skin: trailing-edge flaps and speed brakes / spoilers.
// Each aircraft's surfaces are regions of its model (surfacedefs.js). When a model is first used, the
// triangles inside a region are cut out (split exactly along the region's faces, so the seam is a clean
// line), moved into a pivot on the hinge line, and the opening they leave is closed off: walls where a
// flap was cut through the whole wing, a floor under a panel cut from the skin. Stowed, a surface is
// the same skin it was cut from (same paint, same texture); deployed, it turns about its hinge (and
// slides aft, for a Fowler flap) at the speed of a real actuator (Aircraft.updateSurfaces).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { SURFACE_DEFS } from './surfacedefs.js';

// the flap wells, the speed brake bays and the inside of the panels
export const WELL_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.85, metalness: 0.2, envMapIntensity: 0.4, side: THREE.DoubleSide });
WELL_MAT.name = 'surface-well';
WELL_MAT.userData.noPaint = true;

// Seconds from stowed to fully deployed, when an aircraft's defs don't give their own.
//  - fighters: hydraulic flaps ~1.5 s a notch; speed brakes open in about 1.5 s
//  - airliners / transports: flaps take several seconds a notch (a 737's run from 0 to 30 is allowed up to
//    25 s); spoilers come up in about a second and a half
//  - light aircraft: electric flaps, about 3 s per 10° (Cessna 172: 30° in ~9 s)
const TRAVEL = {
    fighter: { flap: 3, brake: 1.5 },
    bomber: { flap: 6, brake: 2 },
    civil: { flap: 14, brake: 1.5 },
    racer: { flap: 6, brake: 1.5 },
};

export function surfaceTravel(typeId, spec) {
    const d = SURFACE_DEFS[typeId], t = TRAVEL[spec.category] || TRAVEL.fighter;
    return { flap: d?.travel?.flap ?? t.flap, brake: d?.travel?.brake ?? t.brake };
}

// Cut the surfaces of aircraft `id` out of its segmented model (damage.js segmentModel: region groups of
// non-indexed meshes). Adds a pivot per surface (userData.surface: kind, axis, angle, slide, id) to the region
// group it mostly came from; the meshes closing its opening carry userData.surfaceWell = that id. Returns the
// number of surfaces made.
export function cutSurfaces(obj, id, L) {
    const defs = SURFACE_DEFS[id];
    if (!defs) return 0;
    obj.updateMatrixWorld(true);
    let made = 0;
    const list = [];
    for (const kind of ['flaps', 'brakes']) {
        for (const d of defs[kind] || []) {
            const k = kind === 'flaps' ? 'flap' : 'brake';
            list.push({ def: d, kind: k, side: 1 });
            if (d.mirror !== false) list.push({ def: d, kind: k, side: -1 });
        }
    }
    for (const s of list) if (cutOne(obj, s.def, s.kind, s.side, L)) made++;
    return made;
}

// ── Region: a convex prism ──
// def.top: polygon [[x, z], ...] seen from above, with def.y = [lo, hi] the height band;
// def.side: polygon [[z, y], ...] seen from the side, with def.x = [lo, hi] the band across.
// All in fractions of the aircraft length; the def describes the right-hand (+x) surface, mirrored for the left.
function makeRegion(def, side, L) {
    const R = makePrism(def, side, L);
    // def.clip: extra half-spaces [[point], [normal]] (the normal points into the part kept), e.g. the split
    // between the upper and lower halves of a deceleron that is modelled drooped
    for (const [p, n] of def.clip || []) {
        const nn = new THREE.Vector3(n[0] * side, n[1], n[2]).normalize();
        R.planes.push({ n: nn, d: -nn.dot(new THREE.Vector3(p[0] * side * L, p[1] * L, p[2] * L)) });
    }
    return R;
}

function makePrism(def, side, L) {
    const planes = [];
    const box = new THREE.Box3();
    if (def.top) {
        const pts = def.top.map(([x, z]) => [x * side * L, z * L]);
        const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        for (let i = 0; i < pts.length; i++) {
            const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
            let nx = -(bz - az), nz = bx - ax;
            const l = Math.hypot(nx, nz); nx /= l; nz /= l;
            if (nx * (cx - ax) + nz * (cz - az) < 0) { nx = -nx; nz = -nz; }
            planes.push({ n: new THREE.Vector3(nx, 0, nz), d: -(nx * ax + nz * az), wall: true, a: [ax, az], b: [bx, bz] });
        }
        // the height band, tilted with the wing's dihedral: lo/hi hold at the hinge's first point, rising
        // tan(dihedral) per metre outboard
        const [lo, hi] = def.y.map(v => v * L);
        const tn = Math.tan((def.dihedral || 0) * Math.PI / 180), x0 = def.hinge[0][0] * L;
        const bl = (x) => lo + (Math.abs(x) - x0) * tn, bh = (x) => hi + (Math.abs(x) - x0) * tn;
        const k = 1 / Math.hypot(1, tn);
        // y ≥ lo + (side·x − x0)·tn  →  n = (−side·tn, 1, 0), and y ≤ hi + …  →  n = (side·tn, −1, 0)
        planes.push({ n: new THREE.Vector3(-side * tn * k, k, 0), d: -(lo - x0 * tn) * k },
                    { n: new THREE.Vector3(side * tn * k, -k, 0), d: (hi - x0 * tn) * k });
        for (const [x, z] of pts) { box.expandByPoint(new THREE.Vector3(x, bl(x), z)); box.expandByPoint(new THREE.Vector3(x, bh(x), z)); }
        return { planes, box, plan: 'top' };
    }
    const pts = def.side.map(([z, y]) => [z * L, y * L]);
    const cz = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    for (let i = 0; i < pts.length; i++) {
        const [az, ay] = pts[i], [bz, by] = pts[(i + 1) % pts.length];
        let nz = -(by - ay), ny = bz - az;
        const l = Math.hypot(nz, ny); nz /= l; ny /= l;
        if (nz * (cz - az) + ny * (cy - ay) < 0) { nz = -nz; ny = -ny; }
        planes.push({ n: new THREE.Vector3(0, ny, nz), d: -(nz * az + ny * ay), wall: true, a: [az, ay], b: [bz, by] });
    }
    let [lo, hi] = def.x.map(v => v * L);
    if (side < 0) [lo, hi] = [-hi, -lo];
    planes.push({ n: new THREE.Vector3(1, 0, 0), d: -lo }, { n: new THREE.Vector3(-1, 0, 0), d: hi });
    for (const [z, y] of pts) { box.expandByPoint(new THREE.Vector3(lo, y, z)); box.expandByPoint(new THREE.Vector3(hi, y, z)); }
    return { planes, box, plan: 'side' };
}

// ── Polygon clipping (vertices: { p: Vector3 in model space, a: Float32Array of the other attributes }) ──
const EPS = 1e-5;
function lerpVert(u, v, t) {
    const a = new Float32Array(u.a.length);
    for (let i = 0; i < a.length; i++) a[i] = u.a[i] + (v.a[i] - u.a[i]) * t;
    return { p: u.p.clone().lerp(v.p, t), a };
}
// → [inside, outside] (either may have < 3 vertices)
function splitPoly(poly, pl) {
    const inP = [], outP = [];
    const n = poly.length;
    const ds = poly.map(v => pl.n.dot(v.p) + pl.d);
    for (let i = 0; i < n; i++) {
        const u = poly[i], du = ds[i], j = (i + 1) % n, dv = ds[j];
        if (du > EPS) inP.push(u);
        else if (du < -EPS) outP.push(u);
        else { inP.push(u); outP.push(u); }
        if ((du > EPS && dv < -EPS) || (du < -EPS && dv > EPS)) {
            const w = lerpVert(u, poly[j], du / (du - dv));
            inP.push(w); outP.push(w);
        }
    }
    return [inP, outP];
}

let nextId = 1;
function cutOne(obj, def, kind, side, L) {
    const R = makeRegion(def, side, L);
    const hinge = def.hinge.map(([x, y, z]) => new THREE.Vector3(x * side * L, y * L, z * L));
    const surfBuckets = new Map(); // material → { names, sizes, verts, shadow }
    const cutSegs = R.planes.map(() => []);  // per wall plane: segments [p, q] of the cut, inside the region
    const owners = new Map(); // region group → surface area taken from it
    const tv = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const tbox = new THREE.Box3();
    const add = (arr, poly) => { for (let i = 1; i + 1 < poly.length; i++) arr.push(poly[0], poly[i], poly[i + 1]); };
    // a skin panel takes only the skin facing its way (up for an upper-skin panel): near a trailing edge the
    // wing is too thin for a height band alone to keep the other skin out
    const skinDir = def.skin ? (R.plan === 'top' ? new THREE.Vector3(0, def.skin, 0) : new THREE.Vector3(def.skin * side, 0, 0)) : null;
    const fn = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    // a whole part's faces may lie right on the region's faces: widen the box so rounding doesn't drop them
    const nudge = def.whole ? (def.whole === true ? 0.0003 : def.whole) * L : 0;
    if (nudge) R.box.expandByScalar(2 * nudge);
    for (const g of obj.children) {
        if (!g.userData.region) continue;
        const off = g.position;
        for (const mesh of [...g.children]) {
            if (!mesh.isMesh || mesh.userData.surfaceWell || mesh.geometry.index) continue;
            const geo = mesh.geometry, pos = geo.attributes.position;
            // triangles that reach into the region's box (usually a small share of the model)
            const hits = [];
            const nrm = geo.attributes.normal;
            for (let t = 0; t < pos.count; t += 3) {
                for (let k = 0; k < 3; k++) tv[k].fromBufferAttribute(pos, t + k).add(off);
                if (!tbox.setFromPoints(tv).intersectsBox(R.box)) continue;
                if (skinDir) {
                    if (nrm) fn.fromBufferAttribute(nrm, t).add(e1.fromBufferAttribute(nrm, t + 1)).add(e2.fromBufferAttribute(nrm, t + 2));
                    else fn.crossVectors(e1.subVectors(tv[1], tv[0]), e2.subVectors(tv[2], tv[0]));
                    if (fn.normalize().dot(skinDir) < 0.25) continue;
                }
                hits.push(t);
            }
            if (!hits.length) continue;
            const names = Object.keys(geo.attributes).filter(n => n !== 'position');
            const sizes = names.map(n => geo.attributes[n].itemSize);
            const width = sizes.reduce((a, b) => a + b, 0);
            const vert = (i) => {
                const a = new Float32Array(width);
                let o = 0;
                names.forEach((n, k) => { const at = geo.attributes[n]; for (let c = 0; c < sizes[k]; c++) a[o++] = at.array[i * sizes[k] + c]; });
                return { p: new THREE.Vector3().fromBufferAttribute(pos, i).add(off), a };
            };
            const taken = new Map();   // hit triangle → the pieces of it that stay with the airframe
            for (const t of hits) {
                let piece = [vert(t), vert(t + 1), vert(t + 2)];
                const out = [];
                if (def.whole) {
                    if (!partInside(piece, R, nudge)) continue;
                } else {
                    // clip plane by plane: what falls outside a plane stays with the airframe
                    for (let pi = 0; pi < R.planes.length && piece.length >= 3; pi++) {
                        const [inP, outP] = splitPoly(piece, R.planes[pi]);
                        if (outP.length >= 3) add(out, outP);
                        piece = inP;
                    }
                }
                const area = piece.length >= 3 ? polyArea(piece) : 0;
                if (area < 1e-7) continue; // only touches the region: the triangle stays whole
                taken.set(t, out);
                let b = surfBuckets.get(mesh.material);
                if (!b) surfBuckets.set(mesh.material, b = { names, sizes, verts: [], shadow: mesh.castShadow });
                add(b.verts, piece);
                owners.set(g, (owners.get(g) || 0) + area);
                // the cut along each wall plane: edges of the piece lying in that plane
                if (!def.whole) for (let pi = 0; pi < R.planes.length; pi++) {
                    const pl = R.planes[pi];
                    if (!pl.wall) continue;
                    for (let i = 0; i < piece.length; i++) {
                        const u = piece[i].p, v = piece[(i + 1) % piece.length].p;
                        if (Math.abs(pl.n.dot(u) + pl.d) < 1e-4 && Math.abs(pl.n.dot(v) + pl.d) < 1e-4 && u.distanceToSquared(v) > 1e-10) cutSegs[pi].push([u, v]);
                    }
                }
            }
            if (!taken.size) continue;
            // rebuild the airframe mesh: its untouched triangles as they were, and the pieces left outside the region
            // in place of the triangle they came from (a skin drawn blended, without depth writes, is layered in
            // triangle order: keeping the order keeps its look)
            mesh.geometry = rebuildGeometry(geo, taken, names, sizes, off);
            geo.dispose();
        }
    }
    if (!surfBuckets.size) return false;

    // the surface: a pivot on the hinge, owned by the region group it mostly came from
    let owner = null, best = -1;
    for (const [g, a] of owners) if (a > best) { best = a; owner = g; }
    const pivot = new THREE.Group();
    pivot.name = kind + (side > 0 ? 'R' : 'L');
    const h0 = hinge[0];
    pivot.position.copy(h0).sub(owner.position);
    for (const [mat, b] of surfBuckets) {
        const m = new THREE.Mesh(buildGeometry(b.verts, b.names, b.sizes, h0), solidMat(mat));
        m.castShadow = b.shadow; m.receiveShadow = true;
        pivot.add(m);
    }
    // hinge axis: taken on the right-hand side and pointed along +x, +y or +z (whichever it mostly runs along),
    // so the angle's sign reads the same for every surface: about +x a positive angle takes the part aft of the
    // hinge down; about +y it swings the aft part out to +x. The left side turns about the mirrored axis
    // −M·a = (a.x, −a.y, −a.z) (M: the x mirror) by the same angle, so the two sides move alike.
    const a = new THREE.Vector3().fromArray(def.hinge[1]).sub(new THREE.Vector3().fromArray(def.hinge[0])).normalize();
    const big = Math.abs(a.x) >= Math.abs(a.y) && Math.abs(a.x) >= Math.abs(a.z) ? 'x' : Math.abs(a.y) >= Math.abs(a.z) ? 'y' : 'z';
    if (a[big] < 0) a.negate();
    if (side < 0) a.set(a.x, -a.y, -a.z);
    const slide = def.slide ? [def.slide[0] * side * L, def.slide[1] * L, def.slide[2] * L] : null;

    // closing the opening
    const wellRest = [], wellSurf = [];
    // skin 0: cut through the whole thickness (a flap); ±1: a panel of the upper / lower skin ('top'), or the
    // outer / inner skin ('side')
    const skin = (def.skin || 0) * (R.plan === 'side' ? side : 1);
    // depth: 0 leaves the opening as it is (no walls, no floor): for a skin that is a single sheet (the panel
    // shows the other side of the sheet where it opened), or the two halves of a split surface
    const depth = (def.depth ?? 0.004) * L;
    // split: one half of a split surface (two defs on one outline, skin 1 and −1) whose halves are bodies of
    // their own meeting face to face: each takes its skin and the inner face turned its way, so the two make the
    // whole surface. No bay behind it: its walls span the half's own section, and it gets no floor or inside face.
    const split = !!(def.split && skin);
    if (depth > 0) R.planes.forEach((pl, pi) => {
        if (!pl.wall || !cutSegs[pi].length) return;
        for (const q of wallStrip(pl, cutSegs[pi], R.plan, split ? 0 : skin, depth)) { wellRest.push(q); if (!skin || split) wellSurf.push(q); }
    });
    if (skin && !split && depth > 0) {
        // a floor under the panel, and the panel's inside face (moves with it)
        const up = R.plan === 'top' ? new THREE.Vector3(0, skin, 0) : new THREE.Vector3(skin, 0, 0);
        const inset = Math.min(depth * 0.25, 0.03);
        for (const b of surfBuckets.values()) {
            for (let i = 0; i < b.verts.length; i += 3) {
                const [p0, p1, p2] = [b.verts[i].p, b.verts[i + 1].p, b.verts[i + 2].p];
                wellRest.push([p0, p1, p2].map(p => p.clone().addScaledVector(up, -depth)));
                wellSurf.push([p0, p2, p1].map(p => p.clone().addScaledVector(up, -inset)));
            }
        }
    }
    const id = nextId++;
    if (wellRest.length) owner.add(wellMesh(wellRest, owner.position, id));
    if (wellSurf.length) pivot.add(wellMesh(wellSurf, h0, id));
    pivot.userData.surface = { kind, axis: a.toArray(), angle: def.angle, slide, id };
    owner.add(pivot);
    return true;
}

// def.whole: the surface is a part modelled as its own closed solid (a separate mesh in the model file that
// segmentation merged, or a control surface modelled with a gap all round it). Its triangles are taken
// whole, never clipped, and nothing closes the opening (the part was closed all round). A triangle belongs
// to it if its centre, nudged `nudge` into the solid it bounds (against its normal), is inside the region:
// two parts that touch (upper and lower brake petals sharing a split face) each keep their own face, and the
// face of the airframe the part sits against stays put. whole: true nudges 0.0003 L; a number sets the
// nudge (larger lets the outline follow a curved gap loosely; keep it under half the part's thickness where
// the part meets a neighbour face to face).
function partInside(tri, R, nudge) {
    const [a, b, c] = tri.map(v => v.p);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const p = a.clone().add(b).add(c).divideScalar(3).addScaledVector(n, -nudge);
    return R.planes.every(pl => pl.n.dot(p) + pl.d > 0);
}

// A skin whose glTF material is blended at full opacity (the atlas's alpha is only for a canopy elsewhere on it)
// writes no depth, so a surface cut from it, now a mesh of its own, would sort against the airframe as a whole
// and let what lies behind it (a pylon under a flap) show through. Surfaces are solid skin: draw them opaque.
// Such a skin takes no livery paint (applyLivery skips blended materials), and neither does its twin.
const solidMats = new WeakMap();
function solidMat(mat) {
    if (!mat.transparent || mat.depthWrite || mat.opacity < 1) return mat;
    let s = solidMats.get(mat);
    if (!s) {
        s = mat.clone();
        s.transparent = false; s.depthWrite = true;
        s.userData = { ...mat.userData, noPaint: true };
        solidMats.set(mat, s);
    }
    return s;
}

function polyArea(poly) {
    const a = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 1; i + 1 < poly.length; i++) {
        e1.subVectors(poly[i].p, poly[0].p); e2.subVectors(poly[i + 1].p, poly[0].p);
        a.add(c.crossVectors(e1, e2));
    }
    return a.length() / 2;
}

// vertex records → non-indexed BufferGeometry, positions relative to `origin`
function buildGeometry(verts, names, sizes, origin) {
    const g = new THREE.BufferGeometry();
    const P = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => { P[i * 3] = v.p.x - origin.x; P[i * 3 + 1] = v.p.y - origin.y; P[i * 3 + 2] = v.p.z - origin.z; });
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    let o = 0;
    names.forEach((n, k) => {
        const s = sizes[k], A = new Float32Array(verts.length * s);
        verts.forEach((v, i) => { for (let c = 0; c < s; c++) A[i * s + c] = v.a[o + c]; });
        g.setAttribute(n, new THREE.BufferAttribute(A, s));
        o += s;
    });
    if (g.attributes.normal) {
        // (clipped normals are interpolated: renormalise)
        const N = g.attributes.normal;
        for (let i = 0; i < N.count; i++) { const x = N.getX(i), y = N.getY(i), z = N.getZ(i), l = Math.hypot(x, y, z) || 1; N.setXYZ(i, x / l, y / l, z / l); }
    }
    g.computeBoundingSphere();
    return g;
}

// The airframe mesh after a cut: untouched triangles copied straight across (most of the model: no per-vertex
// objects, so a type's first use doesn't hitch), the pieces of cut triangles written in their place
function rebuildGeometry(geo, taken, names, sizes, off) {
    const pos = geo.attributes.position;
    let count = 0;
    for (let t = 0; t < pos.count; t += 3) { const out = taken.get(t); count += out ? out.length : 3; }
    const g = new THREE.BufferGeometry();
    const P = new Float32Array(count * 3), src = pos.array;
    const A = sizes.map(sz => new Float32Array(count * sz)), S = names.map(n => geo.attributes[n].array);
    let v = 0;
    for (let t = 0; t < pos.count; t += 3) {
        const out = taken.get(t);
        if (!out) {
            P.set(src.subarray(t * 3, t * 3 + 9), v * 3);
            for (let k = 0; k < names.length; k++) A[k].set(S[k].subarray(t * sizes[k], (t + 3) * sizes[k]), v * sizes[k]);
            v += 3;
            continue;
        }
        for (const r of out) {
            P[v * 3] = r.p.x - off.x; P[v * 3 + 1] = r.p.y - off.y; P[v * 3 + 2] = r.p.z - off.z;
            let o = 0;
            for (let k = 0; k < names.length; k++) {
                const sz = sizes[k];
                for (let c = 0; c < sz; c++) A[k][v * sz + c] = r.a[o + c];
                if (names[k] === 'normal') {
                    const i = v * 3, x = A[k][i], y = A[k][i + 1], z = A[k][i + 2], l = Math.hypot(x, y, z) || 1;
                    A[k][i] = x / l; A[k][i + 1] = y / l; A[k][i + 2] = z / l;
                }
                o += sz;
            }
            v++;
        }
    }
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    names.forEach((n, k) => g.setAttribute(n, new THREE.BufferAttribute(A[k], sizes[k])));
    g.computeBoundingSphere();
    return g;
}

// A wall along one face of the region, following the cut: sampled along the face, it spans the section of
// the wing there (skin 0), or drops `depth` from the panel's edge into the bay (skin ±1).
function wallStrip(pl, segs, plan, skin, depth) {
    // face coordinates: s along the face's edge (in the plan), v across the band (y for 'top', x for 'side')
    const [ax, az] = pl.a, [bx, bz] = pl.b;
    const ex = bx - ax, ez = bz - az, el = Math.hypot(ex, ez);
    const toS = plan === 'top' ? (p) => ((p.x - ax) * ex + (p.z - az) * ez) / el : (p) => ((p.z - ax) * ex + (p.y - az) * ez) / el;
    const toV = plan === 'top' ? (p) => p.y : (p) => p.x;
    const at = plan === 'top'
        ? (s, v) => new THREE.Vector3(ax + ex * s / el, v, az + ez * s / el)
        : (s, v) => new THREE.Vector3(v, az + ez * s / el, ax + ex * s / el);
    let s0 = Infinity, s1 = -Infinity;
    const S = segs.map(([u, w]) => { const a = toS(u), b = toS(w); s0 = Math.min(s0, a, b); s1 = Math.max(s1, a, b); return [a, toV(u), b, toV(w)]; });
    if (!(s1 - s0 > 1e-4)) return [];
    // sampled evenly, and just either side of every segment's ends, so a narrow feature in the section (a strut
    // or track fairing under a flap) keeps its outline instead of a wedge spilling past its sides
    const N = 28, ss = [], e = (s1 - s0) * 1e-4;
    for (let i = 0; i <= N; i++) ss.push(s0 + (s1 - s0) * (i === 0 ? 0.002 : i === N ? 0.998 : i / N));
    for (const [a, , b] of S) for (const s of [a - e, a + e, b - e, b + e]) if (s > ss[0] && s < ss[N]) ss.push(s);
    ss.sort((p, q) => p - q);
    const samples = [];
    for (const s of ss) {
        let lo = Infinity, hi = -Infinity;
        for (const [a, va, b, vb] of S) {
            if ((s - a) * (s - b) > 0 || a === b) continue;
            const v = va + (vb - va) * (s - a) / (b - a);
            lo = Math.min(lo, v); hi = Math.max(hi, v);
        }
        if (lo > hi) { samples.push(null); continue; }
        if (skin > 0) lo = hi - depth;
        else if (skin < 0) hi = lo + depth;
        samples.push([s, lo, hi]);
    }
    const quads = [];
    for (let i = 0; i + 1 < samples.length; i++) {
        const A = samples[i], B = samples[i + 1];
        if (!A || !B) continue;
        const a0 = at(A[0], A[1]), a1 = at(A[0], A[2]), b0 = at(B[0], B[1]), b1 = at(B[0], B[2]);
        quads.push([a0, b0, b1], [a0, b1, a1]);
    }
    return quads;
}

function wellMesh(tris, origin, id) {
    const P = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => t.forEach((p, k) => { P[i * 9 + k * 3] = p.x - origin.x; P[i * 9 + k * 3 + 1] = p.y - origin.y; P[i * 9 + k * 3 + 2] = p.z - origin.z; }));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, WELL_MAT);
    m.castShadow = false; m.receiveShadow = true;
    m.userData.surfaceWell = id;
    m.visible = false;
    return m;
}

// The meshes closing each surface's opening, by surface id. They are shown only while it is out of its stowed
// position: stowed, the skin is whole, and a dark wall behind a hairline where the cut meets would show.
export function surfaceWells(model) {
    const wells = new Map();
    model.traverse(o => {
        const id = o.userData.surfaceWell;
        if (!o.isMesh || !id) return;
        if (!wells.has(id)) wells.set(id, []);
        wells.get(id).push(o);
    });
    return wells;
}

// Pose a model's surfaces (preview tool / hangar): flap and brake travel 0..1
export function poseSurfaces(model, flap, brake) {
    const q = new THREE.Quaternion(), ax = new THREE.Vector3();
    const wells = surfaceWells(model);
    model.traverse(o => {
        const s = o.userData.surface;
        if (!s) return;
        if (!o.userData.base) o.userData.base = o.position.toArray();
        const k = s.kind === 'flap' ? flap : brake;
        o.quaternion.copy(q.setFromAxisAngle(ax.fromArray(s.axis), s.angle * Math.PI / 180 * k));
        o.position.fromArray(o.userData.base);
        if (s.slide) o.position.x += s.slide[0] * k, o.position.y += s.slide[1] * k, o.position.z += s.slide[2] * k;
        for (const w of wells.get(s.id) || []) w.visible = k > 0;
    });
}

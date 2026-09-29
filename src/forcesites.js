// ═══════════════════════════════════════════════════════════════
// Mobile forces, the places they hide (forces.js): a camouflaged compound (open-sided vehicle sheds, a
// guard hut, camouflage nets on poles over the parking spots) and a hardened vehicle shelter (a concrete arch
// under an earth mound, a pair of sliding blast doors a TEL backs through). Each site is a couple of merged
// meshes, placed on the ground, shown only near the camera.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './util.js';

const MAT = {};
function mats() {
    if (MAT.steel) return MAT;
    MAT.steel = new THREE.MeshStandardMaterial({ color: 0x6c6f64, roughness: 0.85, metalness: 0.1, envMapIntensity: 0.3 });
    MAT.roof = new THREE.MeshStandardMaterial({ color: 0x6b7156, roughness: 0.9, metalness: 0, envMapIntensity: 0.25 }); // (olive-painted sheeting)
    MAT.concrete = new THREE.MeshStandardMaterial({ color: 0xa39d90, roughness: 0.95, metalness: 0, envMapIntensity: 0.15 });
    MAT.earth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.3 }); // (grassed: colours per vertex)
    MAT.door = new THREE.MeshStandardMaterial({ color: 0x6a6d60, roughness: 0.8, metalness: 0.1, envMapIntensity: 0.3 });
    MAT.dark = new THREE.MeshStandardMaterial({ color: 0x141512, roughness: 1, metalness: 0 });
    // camouflage net: garnished netting in woodland colours, seen from above and below (matte: no sky in it)
    MAT.net = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.25, side: THREE.DoubleSide });
    MAT.wood = new THREE.MeshStandardMaterial({ color: 0x6d5a41, roughness: 0.9 });
    return MAT;
}

const box = (w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); return g.translate(x, y + h / 2, z); };
const post = (x, z, h, r = 0.12) => new THREE.CylinderGeometry(r, r, h, 6).translate(x, h / 2, z);

// A camouflage net w × d on poles, sagging between them, ragged at the edges, blotched in three greens and a brown
export function netGeometry(w, d, h, seed = 1) {
    const r = mulberry32(seed);
    const nx = 14, nz = 10;
    const g = new THREE.PlaneGeometry(w, d, nx, nz);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, col = [];
    // woodland garnish, authored in sRGB (vertex colours are linear: squared-ish)
    const cols = [[0.34, 0.4, 0.2], [0.42, 0.45, 0.24], [0.26, 0.31, 0.16], [0.45, 0.39, 0.26]].map(c => c.map(v => Math.pow(v, 2.2)));
    for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const u = Math.abs(x) / (w / 2), v = Math.abs(z) / (d / 2);
        // held up on a ridge pole down the middle and on poles at the corners; it sags between them and drapes
        // to the ground at the edges
        const ridge = 1 - Math.min(1, Math.abs(x) / (w * 0.18));
        let y = h * (0.78 + 0.22 * ridge) - Math.max(0, Math.max(u, v) - 0.72) / 0.28 * h * 0.9;
        y -= Math.sin((u * 3 + 0.5) * Math.PI) ** 2 * 0.35 + r() * 0.25;
        const edge = Math.max(u, v) > 0.97;
        p.setXYZ(i, x + (edge ? (r() - 0.5) * 1.6 : 0), Math.max(y, 0.05), z + (edge ? (r() - 0.5) * 1.6 : 0));
        const c = cols[Math.floor(r() * cols.length)], k = 0.85 + r() * 0.3;
        col.push(c[0] * k, c[1] * k, c[2] * k);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
}

// ═════════════ A camouflaged compound ═════════════
// site: { x, z, heading }; groundAt(x, z). Returns { group, spots: [{ x, z, heading }] (where vehicles park,
// under the nets and in the sheds), r (radius) }
export function buildCompound(site, groundAt, seed = 1) {
    const M = mats();
    const y0 = groundAt(site.x, site.z);
    const steel = [], roof = [], nets = [], wood = [];
    const spots = [];
    // two open-sided vehicle sheds, 16 × 9 m, 5.5 m to the eaves (a TEL is 3.4 m tall with the missile down)
    for (const [sx, sz] of [[-13, -10], [13, -10]]) {
        for (const px of [-7.8, 0, 7.8]) for (const pz of [-4.3, 4.3]) steel.push(post(sx + px, sz + pz, 5.6, 0.16));
        steel.push(box(16.4, 0.3, 0.3, sx, 5.5, sz - 4.3), box(16.4, 0.3, 0.3, sx, 5.5, sz + 4.3));
        const r1 = new THREE.BoxGeometry(17.2, 0.12, 5.2); r1.rotateX(0.18); r1.translate(sx, 6.05, sz - 2.3);
        const r2 = new THREE.BoxGeometry(17.2, 0.12, 5.2); r2.rotateX(-0.18); r2.translate(sx, 6.05, sz + 2.3);
        roof.push(r1, r2);
        // the back wall
        roof.push(box(16.4, 5.4, 0.12, sx, 0, sz - 4.4));
        spots.push({ lx: sx, lz: sz + 1, h: 0 });
    }
    // camouflage nets over two more spots, poles under them
    for (const [nx, nz] of [[-12, 16], [12, 16]]) {
        nets.push(netGeometry(19, 15, 5.2, seed + nx).translate(nx, 0, nz));
        for (const [px, pz] of [[0, -5], [0, 5], [-8, -6], [8, -6], [-8, 6], [8, 6]]) wood.push(post(nx + px, nz + pz, px ? 4.1 : 5.2, 0.1));
        spots.push({ lx: nx, lz: nz, h: 0 });
    }
    // a guard hut by the gate
    roof.push(box(3, 2.6, 3, 24, 0, 30), box(3.6, 0.2, 3.6, 24, 2.6, 30));
    const group = new THREE.Group();
    const add = (geos, mat) => { if (!geos.length) return; const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = true; m.receiveShadow = true; group.add(m); };
    add(steel, M.steel); add(roof, M.roof); add(nets, M.net); add(wood, M.wood);
    group.position.set(site.x, y0 - 0.1, site.z);
    group.rotation.y = site.heading || 0;
    group.updateMatrixWorld(true);
    group.matrixAutoUpdate = false;
    for (const c of group.children) { c.matrixAutoUpdate = false; c.updateMatrix(); }
    const c = Math.cos(site.heading || 0), s = Math.sin(site.heading || 0);
    const world = spots.map(p => ({ x: site.x + p.lx * c + p.lz * s, z: site.z - p.lx * s + p.lz * c, heading: (site.heading || 0) + p.h }));
    return { group, spots: world, r: 40 };
}

// ═════════════ A hardened vehicle shelter ═════════════
// A reinforced-concrete arch, 20 m deep, 8.5 m wide and 6.8 m high inside, under an earth mound, the door toward
// site.heading's forward (−Z at yaw 0); the doors slide sideways (door.open 0..1). Returns { group, inside:
// { x, z, heading }, door: { x, z } (in front), setOpen(k) }
export function buildShelter(site, groundAt) {
    const M = mats();
    const y0 = groundAt(site.x, site.z);
    const W = 8.5, H = 6.8, D = 20, T = 0.9;
    // the arch: a half-tube of concrete (outer and inner surfaces and the rim at the door), then the mound
    const arch = new THREE.CylinderGeometry(W / 2 + T, W / 2 + T, D, 20, 1, true, -Math.PI / 2, Math.PI);
    arch.rotateX(Math.PI / 2); arch.scale(1, (H + T) / (W / 2 + T), 1); arch.translate(0, 0, 0);
    const inner = new THREE.CylinderGeometry(W / 2, W / 2, D - 0.2, 20, 1, true, -Math.PI / 2, Math.PI);
    inner.rotateX(Math.PI / 2); inner.scale(1, H / (W / 2), 1);
    inner.index && inner.index.array.reverse(); // (faces inward)
    const back = box(W + T * 2, H + T, T, 0, 0, D / 2 - T / 2);
    const floor = box(W + 4, 1.8, D + 8, 0, -1.65, -4); // (deep: the apron stays flush on a slope)
    // the earth over it: a long barrow, the arch's shape grown by 4 m of earth, rounded off behind, cut square at
    // the door by a concrete headwall
    const A = W / 2 + T + 4.2, B = H + T + 2.2, CAP = 8, nu = 18, nv = 14;
    const rnd = mulberry32(Math.floor(Math.abs(site.x * 7 + site.z * 13)) >>> 0);
    const mpos = [], mc = [], idx = [];
    for (let j = 0; j <= nv; j++) {
        // rows: 6 along the arch, the rest round the back cap
        const body = j <= 6, t = body ? j / 6 : (j - 6) / (nv - 6);
        const z = body ? -D / 2 + t * D : D / 2 + Math.sin(t * Math.PI / 2) * CAP;
        const f = body ? 1 : Math.max(0.02, Math.cos(t * Math.PI / 2));
        for (let i = 0; i <= nu; i++) {
            const th = Math.PI * i / nu, n = (i > 0 && i < nu && j > 0) ? (rnd() - 0.5) * 0.5 : 0;
            // (a flattened section: steep sides, a broad crown; the foot flares out a little)
            const sx = Math.cos(th), sy = Math.pow(Math.sin(th), 0.7);
            const x = sx * (A * f + (1 - sy) * 1.5 * f), y = sy * (B * f) + n * f;
            mpos.push(x, Math.max(0, y), z);
            const k = rnd(), foot = 1 - Math.min(1, y / B * 2.5), bare = Math.min(1, foot * 0.35 + (k < 0.1 ? 0.3 : 0));
            const c = [0.3 + k * 0.05 + bare * 0.1, 0.42 + k * 0.06 - bare * 0.07, 0.17 + k * 0.03];
            mc.push(...c.map(v => Math.pow(v, 2.2)));
        }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i, b = a + nu + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const mound = new THREE.BufferGeometry();
    mound.setAttribute('position', new THREE.Float32BufferAttribute(mpos, 3));
    mound.setAttribute('color', new THREE.Float32BufferAttribute(mc, 3));
    mound.setIndex(idx);
    mound.computeVertexNormals();
    // the headwall: the barrow's section with the arch cut out of it (one outline: over the barrow from the right
    // foot to the left, then back under the arch), facing out of the door (−Z)
    const hw = new THREE.Shape();
    for (let i = 0; i <= nu; i++) {
        const th = Math.PI * i / nu, sy = Math.pow(Math.sin(th), 0.7), x = Math.cos(th) * (A + (1 - sy) * 1.5), y = sy * B + 0.25;
        if (i === 0) hw.moveTo(x, 0); else hw.lineTo(x, y);
    }
    hw.lineTo(-(A + 1.5), 0);
    for (let i = nu; i >= 0; i--) { const th = Math.PI * i / nu; hw.lineTo(Math.cos(th) * W / 2, Math.sin(th) * H); }
    const head = new THREE.ShapeGeometry(hw);
    head.rotateY(Math.PI); head.translate(0, 0, -D / 2 - 0.02);
    const concrete = [arch, inner, back, floor, head];
    const group = new THREE.Group();
    const cm = new THREE.Mesh(mergeGeometries(concrete.map(g => g.index ? g.toNonIndexed() : g)), M.concrete);
    const em = new THREE.Mesh(mound, M.earth);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(W, H * 0.98).rotateY(Math.PI).translate(0, H * 0.49, D / 2 - T - 0.05), M.dark);
    for (const m of [cm, em]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
    group.add(dark);
    // the blast doors: two leaves on a track across the opening
    const doors = [];
    for (const side of [-1, 1]) {
        const d = new THREE.Mesh(new THREE.BoxGeometry(W / 2 + 0.3, H * 0.92, 0.5), M.door);
        d.position.set(side * (W / 4 + 0.1), H * 0.46, -D / 2 - 0.4);
        d.castShadow = true;
        d.userData.x0 = d.position.x; d.userData.side = side;
        group.add(d); doors.push(d);
    }
    group.position.set(site.x, y0 - 0.05, site.z);
    group.rotation.y = site.heading || 0;
    group.updateMatrixWorld(true);
    const c = Math.cos(site.heading || 0), s = Math.sin(site.heading || 0);
    const at = (lx, lz) => ({ x: site.x + lx * c + lz * s, z: site.z - lx * s + lz * c });
    const S = {
        group, open: 0, k: 0, doors,
        inside: { ...at(0, 1.5), heading: site.heading || 0 }, // (backed in: the TEL's nose to the door)
        door: at(0, -D / 2 - 26),
        setOpen(k) {
            S.k = k;
            for (const d of doors) d.position.x = d.userData.x0 + d.userData.side * k * (W / 2 + 0.6);
        },
    };
    return S;
}

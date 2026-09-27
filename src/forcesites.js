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
    MAT.steel = new THREE.MeshStandardMaterial({ color: 0x5f6258, roughness: 0.8, metalness: 0.25, envMapIntensity: 0.5 });
    MAT.roof = new THREE.MeshStandardMaterial({ color: 0x565c48, roughness: 0.85, metalness: 0.15, envMapIntensity: 0.4 }); // (olive-painted sheeting)
    MAT.concrete = new THREE.MeshStandardMaterial({ color: 0x8b8a82, roughness: 0.95, metalness: 0 });
    MAT.earth = new THREE.MeshStandardMaterial({ color: 0x5c6440, roughness: 1, metalness: 0 });
    MAT.door = new THREE.MeshStandardMaterial({ color: 0x55594f, roughness: 0.75, metalness: 0.35, envMapIntensity: 0.5 });
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
    const rim = new THREE.RingGeometry(W / 2, W / 2 + T, 20, 1, 0, Math.PI);
    rim.scale(1, (H + T) / (W / 2 + T), 1); rim.translate(0, 0, -D / 2);
    const back = box(W + T * 2, H + T, T, 0, 0, D / 2 - T / 2);
    const floor = box(W + 4, 0.25, D + 8, 0, -0.2, -4);
    const concrete = [arch, inner, rim.rotateY(Math.PI), back, floor];
    // the earth over it: a long mound, grassed
    const mound = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    mound.scale(W / 2 + 6.5, H + 3, D / 2 + 5); mound.translate(0, 0, 2.5);
    // (the door face is cut straight: the front of the mound pushed back behind the portal)
    const mp = mound.attributes.position;
    for (let i = 0; i < mp.count; i++) if (mp.getZ(i) < -D / 2) mp.setZ(i, -D / 2 + (mp.getZ(i) + D / 2) * 0.12);
    mound.computeVertexNormals();
    const group = new THREE.Group();
    const cm = new THREE.Mesh(mergeGeometries(concrete.map(g => g.index ? g.toNonIndexed() : g)), M.concrete);
    const em = new THREE.Mesh(mound, M.earth);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(W, H * 0.98).translate(0, H * 0.49, D / 2 - T - 0.05).rotateY(Math.PI), M.dark);
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

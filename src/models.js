// ═══════════════════════════════════════════════════════════════
// Aircraft models: loads real glTF jets where available, otherwise builds a
// detailed procedural model. Every model is normalised so the nose points -Z,
// up is +Y, and length (metres) matches the real aircraft.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AIRCRAFT } from './config.js';
import { segmentModel } from './damage.js';

// Loaded GLB models. rot = Euler to bring nose to -Z / up to +Y.
// Filled in by MODEL_FILES (see models/CREDITS.md for sources/licences).
const Q = Math.PI / 2;
export const MODEL_FILES = {
    f16: { file: 'f16.glb', rot: [0, 0, 0], cockpit: [0.07, -0.26] },
    f2: { file: 'f2.glb', rot: [0, Q, 0], cockpit: [0.07, -0.26] },
    f14: { file: 'f14.glb', rot: [0, Q, 0], nozzles: [[-0.065, 0.0, 0.49], [0.065, 0.0, 0.49]] },
    f15: { file: 'f15.glb', rot: [0, Q, 0] },
    f4: { file: 'f4.glb', rot: [0, Q, 0] },
    typhoon: { file: 'eurofighter.glb', rot: [0, Q, 0] },
    rafale: { file: 'rafale.glb', rot: [0, Q, 0] },
    j20: { file: 'j20.glb', rot: [0, Math.PI, 0] },
    mig29: { file: 'mig29.glb', rot: [0, Math.PI, 0] },
    su57: { file: 'su57.glb', rot: [0, 0, 0], paint: true },
    f35: { file: 'generic_fighter.glb', rot: [0, Math.PI, 0] },
    b747: { file: 'airliner.glb', rot: [0, Math.PI, 0] },
    c130: { file: 'cargo.glb', rot: [0, Math.PI, 0] },
    mig21: { file: 'mig21.glb', rot: [0, Math.PI, 0] },
    mig25: { file: 'mig25.glb', rot: [0, Math.PI, 0] },
    j10: { file: 'j10.glb', rot: [0, Math.PI, 0] },
    j8: { file: 'j8.glb', rot: [0, Math.PI, 0] },
    f5: { file: 'f5.glb', rot: [0, Q, 0] },
    mirage: { file: 'mirage.glb', rot: [0, Q, 0] },
    jaguar: { file: 'jaguar.glb', rot: [0, Q, 0] },
    su47: { file: 'su47.glb', rot: [0, 0, 0], paint: true },
    b2: { file: 'b2.glb', rot: [0, 0, 0], paint: true },
};

const cache = {};

export async function preloadModels(onProgress) {
    const loader = new GLTFLoader();
    const entries = Object.entries(MODEL_FILES);
    let done = 0;
    await Promise.all(entries.map(async ([id, info]) => {
        try {
            const gltf = await loader.loadAsync('models/' + info.file);
            const r = normaliseGLTF(gltf.scene, id, info);
            r.object = safeSegment(r.object, id);
            cache[id] = r;
        } catch (e) {
            console.warn('[models] failed to load', info.file, e);
        }
        done++;
        onProgress && onProgress(done / entries.length);
    }));
}

function safeSegment(obj, id) {
    try { return segmentModel(obj, AIRCRAFT[id].length); } catch (e) { console.warn('[models] could not segment', id, e); return obj; }
}

function normaliseGLTF(root, id, info) {
    const spec = AIRCRAFT[id];
    const holder = new THREE.Group();
    const inner = new THREE.Group();
    inner.add(root);
    if (info.rot) inner.rotation.set(info.rot[0], info.rot[1], info.rot[2]);
    holder.add(inner);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = spec.length / size.z;
    inner.position.copy(center).multiplyScalar(-scale);
    inner.scale.setScalar(scale);
    holder.updateMatrixWorld(true);

    root.traverse((o) => {
        if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach((m) => {
                if (!m) return;
                if (info.paint && m.color && !m.map) {
                    // uniform untextured models get the aircraft's paint scheme
                    const lum = m.color.r + m.color.g + m.color.b;
                    if (lum > 0.4 && !m.transparent) m.color.setHex(spec.proc?.paint ?? 0x7a848e);
                }
                if ('roughness' in m) {
                    m.roughness = Math.min(m.roughness ?? 0.6, 0.7);
                    m.metalness = Math.max(m.metalness ?? 0.2, info.metal ?? 0.25);
                    m.envMapIntensity = 1.0;
                }
                if (m.transparent && m.opacity < 1) {
                    m.depthWrite = false;
                }
            });
        }
    });
    const box2 = new THREE.Box3().setFromObject(holder);
    const rig = {
        length: spec.length,
        halfSpan: (box2.max.x - box2.min.x) / 2,
        height: box2.max.y - box2.min.y,
        minY: box2.min.y,
        nozzles: info.nozzles ? info.nozzles.map(n => new THREE.Vector3(n[0] * spec.length, n[1] * spec.length, n[2] * spec.length)) : defaultNozzles(spec, box2),
        nozzleR: (info.nozzleR ?? 0.028) * spec.length,
        wingtips: findWingtips(holder, box2),
        cockpit: new THREE.Vector3(0, (info.cockpit?.[0] ?? 0.05) * spec.length, (info.cockpit?.[1] ?? -0.27) * spec.length),
    };
    return { object: holder, rig };
}

function defaultNozzles(spec, box) {
    const n = spec.proc?.engines ?? 1;
    const L = spec.length;
    const z = box.max.z - L * 0.02;
    const y = (box.min.y + box.max.y) * 0.5 - L * 0.01;
    if (n === 1) return [new THREE.Vector3(0, y, z)];
    const s = (spec.proc?.spacing ?? 0.06) * L;
    return [new THREE.Vector3(-s, y, z), new THREE.Vector3(s, y, z)];
}

function findWingtips(obj, box) {
    // locate the extreme-x vertices: those are the wingtips (for contrails and nav lights)
    let best = [null, null];
    const v = new THREE.Vector3();
    obj.traverse((o) => {
        if (!o.isMesh) return;
        const p = o.geometry.attributes.position;
        o.updateMatrixWorld(true);
        const step = Math.max(1, Math.floor(p.count / 4000));
        for (let i = 0; i < p.count; i += step) {
            v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
            if (!best[0] || v.x < best[0].x) best[0] = v.clone();
            if (!best[1] || v.x > best[1].x) best[1] = v.clone();
        }
    });
    if (!best[0]) return [new THREE.Vector3(box.min.x, 0, 2), new THREE.Vector3(box.max.x, 0, 2)];
    return best;
}

// ── Public: get a fresh model instance for an aircraft ──
export function createAircraftModel(id) {
    if (cache[id]) {
        const src = cache[id];
        const object = src.object.clone(true);
        return { object, rig: cloneRig(src.rig), fromFile: true };
    }
    if (!cache['proc_' + id]) {
        const r = buildProcedural(id);
        r.object = safeSegment(r.object, id);
        cache['proc_' + id] = r;
    }
    const src = cache['proc_' + id];
    return { object: src.object.clone(true), rig: cloneRig(src.rig), fromFile: false };
}

export function hasFileModel(id) { return !!cache[id]; }

// ── Paint schemes ──
export const LIVERIES = {
    default: { label: 'STOCK', color: null },
    ghost: { label: 'GHOST', color: 0x8d969e },
    navy: { label: 'NAVY', color: 0x2f4c78 },
    desert: { label: 'DESERT', color: 0xb49a6a },
    arctic: { label: 'ARCTIC', color: 0xe3e8ec },
    black: { label: 'STEALTH', color: 0x2a2c30 },
    red: { label: 'RED ACE', color: 0x9e2a22 },
};

export function applyLivery(model, key) {
    const liv = LIVERIES[key] || LIVERIES.default;
    const white = new THREE.Color(1, 1, 1);
    model.traverse((o) => {
        if (!o.isMesh || Array.isArray(o.material)) return;
        if (!o.userData.origMat) o.userData.origMat = o.material;
        const base = o.userData.origMat;
        if (!liv.color || base.isShaderMaterial || base.transparent || base.isMeshPhysicalMaterial || base.userData?.noPaint || !base.color) {
            o.material = base;
            return;
        }
        const lum = (base.color.r + base.color.g + base.color.b) / 3;
        if (lum < 0.06 && !base.map) { o.material = base; return; } // keep dark trim, tyres, nozzles
        const m = base.clone();
        const c = new THREE.Color(liv.color);
        if (base.map) m.color.copy(c).lerp(white, 0.35);
        else m.color.copy(c).multiplyScalar(clamp01(lum / 0.4, 0.6, 1.35));
        o.material = m;
    });
}
function clamp01(v, a, b) { return Math.max(a, Math.min(b, v)); }

function cloneRig(r) {
    return {
        ...r,
        nozzles: r.nozzles.map(v => v.clone()),
        wingtips: r.wingtips.map(v => v.clone()),
        cockpit: r.cockpit.clone(),
        props: r.props,
    };
}

// ═══════════════════════════════════════════════════════════════
// Procedural builder
// ═══════════════════════════════════════════════════════════════
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x1a2430, metalness: 0.1, roughness: 0.05, transmission: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6 });
const goldGlassMat = new THREE.MeshPhysicalMaterial({ color: 0x5a4a20, metalness: 0.6, roughness: 0.08, clearcoat: 1, envMapIntensity: 1.8 });
const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, metalness: 0.85, roughness: 0.35 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.3, roughness: 0.6 });

// Superellipse loft along z. stations: [z, halfWidth, halfHeight, yOffset, squareness]
export function loft(stations, radial = 20) {
    const pos = [], idx = [];
    for (let s = 0; s < stations.length; s++) {
        const [z, w, h, y, n = 2.2] = stations[s];
        for (let i = 0; i <= radial; i++) {
            const a = (i / radial) * Math.PI * 2;
            const c = Math.cos(a), sn = Math.sin(a);
            const px = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
            const py = h * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
            pos.push(px, py + y, z);
        }
    }
    const R = radial + 1;
    for (let s = 0; s < stations.length - 1; s++) for (let i = 0; i < radial; i++) {
        const a = s * R + i, b = a + 1, c = a + R, d = c + 1;
        idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

// Planform polygon (x = span, z = chord) extruded to a thin lifting surface
function surface(points, thickness) {
    const shape = new THREE.Shape();
    points.forEach(([x, z], i) => (i ? shape.lineTo(x, z) : shape.moveTo(x, z)));
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, {
        depth: thickness * 0.4, bevelEnabled: true, bevelThickness: thickness * 0.3, bevelSize: thickness * 0.5, bevelSegments: 2, curveSegments: 1,
    });
    g.rotateX(Math.PI / 2);
    g.translate(0, thickness * 0.2, 0);
    g.computeVertexNormals();
    return g;
}

function wingPlanform(halfSpan, rootZ, rc, tc, sweepDeg, rootX = 0) {
    const tipLE = rootZ + halfSpan * Math.tan(sweepDeg * Math.PI / 180);
    return [
        [-halfSpan, tipLE], [-rootX, rootZ], [rootX, rootZ], [halfSpan, tipLE],
        [halfSpan, tipLE + tc], [rootX, rootZ + rc], [-rootX, rootZ + rc], [-halfSpan, tipLE + tc],
    ];
}

function buildProcedural(id) {
    const spec = AIRCRAFT[id];
    const p = spec.proc || {};
    const L = spec.length;
    const paint = new THREE.MeshStandardMaterial({ color: p.paint ?? 0x7a848e, metalness: 0.35, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: p.accent ?? 0x5d666f, metalness: 0.35, roughness: 0.55 });
    const g = new THREE.Group();
    const add = (geo, mat, x = 0, y = 0, z = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
        return m;
    };
    const rig = { length: L, nozzles: [], wingtips: [], cockpit: new THREE.Vector3(), nozzleR: 0.03 * L, props: [] };

    if (p.flyingWing) return buildFlyingWing(spec, paint, accent, rig);
    if (p.airliner || p.prop) return buildTransport(spec, paint, accent, rig);

    const [bw, bh] = p.body || [0.085, 0.075];
    const W = bw * L, H = bh * L;
    // ── fuselage ──
    const st = [
        [-0.5 * L, 0.004 * L, 0.004 * L, 0.0, 2],
        [-0.46 * L, 0.018 * L, 0.018 * L, 0.0, 2],
        [-0.38 * L, 0.034 * L, 0.032 * L, 0.002 * L, 2.1],
        [-0.29 * L, 0.043 * L, 0.042 * L, 0.006 * L, 2.3],
        [-0.2 * L, 0.05 * L, 0.05 * L, 0.008 * L, 2.5],
        [-0.1 * L, W * 0.85, H * 0.95, 0.004 * L, 3.0],
        [0.0, W, H, 0.0, 3.2],
        [0.2 * L, W, H * 0.95, 0.0, 3.2],
        [0.36 * L, W * 0.92, H * 0.8, -0.002 * L, 3.0],
        [0.45 * L, W * 0.8, H * 0.62, -0.004 * L, 2.6],
        [0.49 * L, W * 0.74, H * 0.55, -0.004 * L, 2.4],
    ];
    add(loft(st, 24), paint);

    // ── canopy ──
    const canopy = add(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), id === 'f22' || id === 'f35' ? goldGlassMat : glassMat, 0, 0.034 * L, -0.25 * L);
    canopy.scale.set(0.034 * L, 0.036 * L, 0.11 * L);
    rig.cockpit.set(0, 0.052 * L, -0.26 * L);

    // ── intakes ──
    if (p.intake === 'side') {
        for (const s of [-1, 1]) {
            const it = add(loft([
                [-0.18 * L, 0.028 * L, 0.036 * L, 0, 4],
                [-0.05 * L, 0.03 * L, 0.04 * L, 0, 4],
                [0.1 * L, 0.024 * L, 0.036 * L, 0, 4],
            ], 12), accent, s * (0.045 * L + 0.012 * L), -0.012 * L, 0);
            add(new THREE.CircleGeometry(0.026 * L, 12), darkMat, s * 0.057 * L, -0.012 * L, -0.181 * L).rotation.y = Math.PI;
            void it;
        }
    } else if (p.intake === 'chin' || p.intake === 'under') {
        const count = p.intake === 'under' ? 2 : 1;
        for (let k = 0; k < count; k++) {
            const x = count === 1 ? 0 : (k ? 1 : -1) * (p.spacing ?? 0.08) * L;
            add(loft([
                [-0.14 * L, 0.03 * L, 0.024 * L, 0, 5],
                [0.05 * L, 0.032 * L, 0.028 * L, 0, 5],
                [0.2 * L, 0.028 * L, 0.024 * L, 0, 4],
            ], 12), accent, x, -H * 0.95, 0);
        }
    }

    // ── wings ──
    const halfSpan = spec.span / 2;
    const w = p.wing || { rc: 0.4, tc: 0.1, sweep: 40, z: 0.1 };
    const rootZ = w.z * L - w.rc * L * 0.5;
    const thick = 0.012 * L;
    const wingMesh = add(surface(wingPlanform(halfSpan, rootZ, w.rc * L, w.tc * L, w.sweep, W * 0.5), thick), paint, 0, -H * 0.2, 0);
    void wingMesh;
    const tipZ = rootZ + halfSpan * Math.tan(w.sweep * Math.PI / 180) + w.tc * L * 0.5;
    rig.wingtips.push(new THREE.Vector3(-halfSpan, -H * 0.2, tipZ), new THREE.Vector3(halfSpan, -H * 0.2, tipZ));

    // leading-edge root extensions
    if (p.lerx) {
        add(surface([[-W * 1.4, rootZ], [0, -0.3 * L], [W * 1.4, rootZ], [W * 0.5, rootZ + 0.1 * L], [-W * 0.5, rootZ + 0.1 * L]], thick * 0.6), paint, 0, -H * 0.05, 0);
    }
    // canards
    if (p.canard) {
        const cs = halfSpan * 0.42;
        add(surface(wingPlanform(cs, -0.2 * L, 0.1 * L, 0.035 * L, 50, W * 0.6), thick * 0.6), accent, 0, 0.01 * L, 0);
    }
    // horizontal stabilisers
    if (p.hstab) {
        const hs = halfSpan * 0.55;
        add(surface(wingPlanform(hs, 0.33 * L, 0.16 * L, 0.06 * L, 42, W * 0.7), thick * 0.7), accent, 0, -H * 0.15, 0);
    }
    // vertical tails
    const finH = 0.2 * L;
    const finShape = (sweep) => {
        const lz = 0.3 * L;
        const tipLE = lz + finH * Math.tan(sweep * Math.PI / 180);
        return [[0, lz], [finH, tipLE], [finH, tipLE + 0.065 * L], [0, lz + 0.19 * L]];
    };
    const makeFin = (x, cant) => {
        const geo = surface(finShape(p.delta ? 55 : 45), thick * 0.7);
        geo.rotateZ(Math.PI / 2); // span along +y
        const m = add(geo, accent, x, H * 0.55, 0);
        m.rotation.z = -cant;
        return m;
    };
    if (p.tail === 'twin') {
        const sp = (p.spacing ?? 0.06) * L + W * 0.35;
        makeFin(-sp, -(p.cant ?? 10) * Math.PI / 180);
        makeFin(sp, (p.cant ?? 10) * Math.PI / 180);
    } else if (p.tail === 'single') {
        makeFin(0, 0);
    }

    // ── engines ──
    const n = p.engines ?? 1;
    const nozR = (n === 1 ? 0.042 : 0.03) * L;
    rig.nozzleR = nozR;
    const nzXs = n === 1 ? [0] : [-(p.spacing ?? 0.06) * L, (p.spacing ?? 0.06) * L];
    if (p.layout === 'tailpods') {
        // A-10 style pods above the rear fuselage
        for (const s of [-1, 1]) {
            const x = s * 0.1 * L, y = H * 1.5, z = 0.25 * L;
            add(loft([[z - 0.12 * L, 0.04 * L, 0.04 * L, 0, 2], [z, 0.05 * L, 0.05 * L, 0, 2], [z + 0.1 * L, 0.04 * L, 0.04 * L, 0, 2]], 16), paint, x, y, 0);
            add(new THREE.CylinderGeometry(0.02 * L, 0.02 * L, 0.06 * L, 8).rotateZ(Math.PI / 2), darkMat, x - s * 0.03 * L, y - 0.03 * L, z);
            rig.nozzles.push(new THREE.Vector3(x, y, z + 0.1 * L));
        }
        rig.nozzleR = 0.035 * L;
    } else {
        for (const x of nzXs) {
            const noz = add(new THREE.CylinderGeometry(nozR * 0.95, nozR * 1.08, 0.07 * L, 16, 1, true), nozzleMat, x, -0.004 * L, 0.5 * L);
            noz.rotation.x = Math.PI / 2;
            noz.material.side = THREE.DoubleSide;
            rig.nozzles.push(new THREE.Vector3(x, -0.004 * L, 0.53 * L));
        }
    }

    // ── weapons on rails: wingtip missiles for flavour ──
    const mslMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.5, metalness: 0.2 });
    for (const s of [-1, 1]) {
        const m = add(new THREE.CylinderGeometry(0.1, 0.1, 3, 8), mslMat, s * (halfSpan * 0.97), -H * 0.3, tipZ - 0.3);
        m.rotation.x = Math.PI / 2;
    }

    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { object: g, rig };
}

function buildTransport(spec, paint, accent, rig) {
    const p = spec.proc;
    const L = spec.length;
    const g = new THREE.Group();
    const add = (geo, mat, x = 0, y = 0, z = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
        return m;
    };
    const white = paint;
    const [bw, bh] = p.body || [0.1, 0.1];
    const R = bw * L * 0.5 * (p.prop ? 1.2 : 1);
    const Rh = bh * L * 0.5 * (p.prop ? 1.2 : 1);
    const st = p.prop ? [
        [-0.5 * L, R * 0.5, Rh * 0.5, 0, 2.5], [-0.42 * L, R * 0.9, Rh * 0.8, 0, 3], [-0.2 * L, R, Rh, Rh * 0.1, 3.5],
        [0.05 * L, R * 0.9, Rh * 0.9, Rh * 0.1, 3], [0.4 * L, R * 0.3, Rh * 0.35, Rh * 0.4, 2.5], [0.5 * L, R * 0.1, Rh * 0.15, Rh * 0.5, 2],
    ] : [
        [-0.5 * L, R * 0.05, Rh * 0.05, -Rh * 0.1, 2], [-0.48 * L, R * 0.55, Rh * 0.5, -Rh * 0.12, 2], [-0.44 * L, R * 0.85, Rh * 0.85, -Rh * 0.05, 2],
        [-0.38 * L, R, Rh, 0, 2], [0.28 * L, R, Rh, 0, 2], [0.42 * L, R * 0.6, Rh * 0.65, Rh * 0.25, 2], [0.5 * L, R * 0.12, Rh * 0.2, Rh * 0.55, 2],
    ];
    add(loft(st, 24), white);
    if (p.hump) {
        add(loft([[-0.44 * L, R * 0.3, Rh * 0.2, Rh * 0.8, 2], [-0.36 * L, R * 0.75, Rh * 0.45, Rh * 0.85, 2], [-0.15 * L, R * 0.7, Rh * 0.4, Rh * 0.8, 2], [-0.05 * L, R * 0.3, Rh * 0.1, Rh * 0.8, 2]], 16), white);
    }
    // cheatline
    add(loft([[-0.38 * L, R * 1.005, Rh * 0.12, -Rh * 0.2, 2], [0.28 * L, R * 1.005, Rh * 0.12, -Rh * 0.2, 2]], 24), accent);
    // cockpit windows
    const win = add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glassMat, 0, Rh * 0.35, -0.45 * L);
    win.scale.set(R * 0.7, Rh * 0.3, R * 0.8);
    rig.cockpit.set(0, Rh * 0.5, -0.44 * L);

    const halfSpan = spec.span / 2;
    const sweep = p.prop || p.turboprop ? 2 : 30;
    const rc = (p.prop ? 0.18 : 0.22) * L, tc = rc * (p.prop ? 1 : 0.35);
    const wy = p.highWing ? Rh * 0.95 : -Rh * 0.55;
    add(surface(wingPlanform(halfSpan, -0.05 * L, rc, tc, sweep, R * 0.5), 0.012 * L + 0.2), white, 0, wy, 0);
    const tipZ = -0.05 * L + halfSpan * Math.tan(sweep * Math.PI / 180) + tc / 2;
    rig.wingtips.push(new THREE.Vector3(-halfSpan, wy, tipZ), new THREE.Vector3(halfSpan, wy, tipZ));
    // tail
    const hs = halfSpan * 0.34;
    add(surface(wingPlanform(hs, 0.36 * L, 0.1 * L, 0.04 * L, sweep + 5, R * 0.2), 0.01 * L), white, 0, Rh * 0.4, 0);
    const finH = 0.17 * L;
    const fin = surface([[0, 0.28 * L], [finH, 0.28 * L + finH * 0.9], [finH, 0.28 * L + finH * 0.9 + 0.07 * L], [0, 0.49 * L]], 0.01 * L);
    fin.rotateZ(Math.PI / 2);
    add(fin, accent, 0, Rh * 0.5, 0);

    const n = p.engines || 1;
    if (p.prop) {
        const prop = new THREE.Group();
        for (let k = 0; k < 2; k++) {
            const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.05), darkMat);
            b.rotation.z = k * Math.PI / 2;
            prop.add(b);
        }
        prop.position.set(0, 0, -0.51 * L);
        g.add(prop);
        rig.props.push(prop);
        rig.nozzles = [];
    } else {
        const xs = n === 2 ? [0.33] : [0.3, 0.62];
        const engR = (p.turboprop ? 0.018 : 0.028) * L * (n === 4 && !p.turboprop ? 0.8 : 1);
        for (const f of xs) for (const s of [-1, 1]) {
            const x = s * halfSpan * f;
            const z = -0.05 * L + halfSpan * f * Math.tan(sweep * Math.PI / 180) - 0.02 * L;
            const y = wy - (p.highWing ? -engR * 0.2 : engR * 1.3);
            const nac = add(loft([[z - 0.07 * L, engR, engR, 0, 2], [z, engR * 1.05, engR * 1.05, 0, 2], [z + 0.06 * L, engR * 0.7, engR * 0.7, 0, 2]], 16), white, x, y, 0);
            void nac;
            if (p.turboprop) {
                const prop = new THREE.Group();
                for (let k = 0; k < 6; k++) {
                    const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.1, 0.08), darkMat);
                    b.position.y = 1.05; const piv = new THREE.Group(); piv.add(b); piv.rotation.z = k * Math.PI / 3; prop.add(piv);
                }
                prop.position.set(x, y, z - 0.075 * L);
                g.add(prop);
                rig.props.push(prop);
            } else {
                rig.nozzles.push(new THREE.Vector3(x, y, z + 0.06 * L));
            }
        }
        rig.nozzleR = engR * 0.6;
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    rig.civil = true;
    return { object: g, rig };
}

function buildFlyingWing(spec, paint, accent, rig) {
    const L = spec.length, hs = spec.span / 2;
    const g = new THREE.Group();
    // Sawtooth trailing edge B-2 planform
    const pts = [
        [0, -0.5 * L], [hs, 0.28 * L], [hs * 0.8, 0.38 * L], [hs * 0.55, 0.18 * L], [hs * 0.28, 0.4 * L], [0, 0.2 * L],
        [-hs * 0.28, 0.4 * L], [-hs * 0.55, 0.18 * L], [-hs * 0.8, 0.38 * L], [-hs, 0.28 * L],
    ];
    const wing = new THREE.Mesh(surface(pts, 0.5), paint);
    g.add(wing);
    const hump = new THREE.Mesh(loft([
        [-0.5 * L, 0.2, 0.1, 0.2, 2], [-0.35 * L, 2.2, 1.1, 0.4, 2.2], [-0.1 * L, 3.4, 1.6, 0.4, 2.5], [0.15 * L, 3.2, 1.0, 0.3, 2.5], [0.3 * L, 1.5, 0.3, 0.2, 2],
    ], 20), paint);
    g.add(hump);
    const win = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
    win.scale.set(1.4, 0.6, 1.4);
    win.position.set(0, 1.5, -0.32 * L);
    g.add(win);
    for (const s of [-1, 1]) for (const f of [0.12, 0.2]) {
        const x = s * hs * f;
        const eng = new THREE.Mesh(loft([[-0.1 * L, 0.6, 0.3, 0, 2], [0.12 * L, 1.0, 0.5, 0, 2.4], [0.26 * L, 0.8, 0.15, 0, 3]], 12), accent);
        eng.position.set(x, 0.55, 0);
        g.add(eng);
        rig.nozzles.push(new THREE.Vector3(x, 0.6, 0.27 * L));
    }
    rig.nozzleR = 0.5;
    rig.wingtips.push(new THREE.Vector3(-hs, 0, 0.28 * L), new THREE.Vector3(hs, 0, 0.28 * L));
    rig.cockpit.set(0, 1.9, -0.3 * L);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { object: g, rig };
}

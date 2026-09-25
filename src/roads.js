// ═══════════════════════════════════════════════════════════════
// Road network: two-lane roads between towns and airbases, with painted
// markings, and bridges wherever a road crosses water.
// A road is stored as a path (polyline with arc length) so traffic and
// convoys can drive along it.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight, BASES, fenceOf, baseToWorld, worldToBase } from './world.js';
import { Bridge } from './bridges.js';

export const ROAD_HALF = 7;      // 14 m wide: two 7 m lanes
export const LANE = 3.3;          // lane centre offset from the middle
const STEP = 30;
const MAX_BRIDGE = 1400, MIN_BRIDGE = 50;

// Keep roads outside airbase fences (they go round, not across the runway)
const FENCE_MARGIN = 35;
export function outsideBases(x, z) {
    for (const b of BASES) {
        const { lx, lz } = worldToBase(b, x, z);
        const FENCE = fenceOf(b);
        const x0 = FENCE.x0 - FENCE_MARGIN, x1 = FENCE.x1 + FENCE_MARGIN, z0 = FENCE.z0 - FENCE_MARGIN, z1 = FENCE.z1 + FENCE_MARGIN;
        if (lx > x0 && lx < x1 && lz > z0 && lz < z1) {
            // push to the nearest side of the fence
            const d = [lx - x0, x1 - lx, lz - z0, z1 - lz];
            const k = d.indexOf(Math.min(...d));
            const nlx = k === 0 ? x0 : k === 1 ? x1 : lx, nlz = k === 2 ? z0 : k === 3 ? z1 : lz;
            return { ...baseToWorld(b, nlx, nlz), base: b, side: k, lx: nlx, lz: nlz, box: [x0, x1, z0, z1] };
        }
    }
    return null;
}

function slopeAt(x, z) {
    const e = 20, h = terrainHeight(x, z);
    return (Math.abs(terrainHeight(x + e, z) - h) + Math.abs(terrainHeight(x, z + e) - h)) / (2 * e);
}

// Asphalt with white edge lines and a dashed yellow centre line (v runs along the road)
function roadTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4a4c4f';
    ctx.fillRect(0, 0, 128, 256);
    for (let i = 0; i < 1400; i++) {
        const v = 60 + Math.random() * 40;
        ctx.fillStyle = `rgba(${v},${v},${v + 4},0.35)`;
        ctx.fillRect(Math.random() * 128, Math.random() * 256, 2, 2);
    }
    ctx.fillStyle = '#6a6b68'; // gravel shoulders
    ctx.fillRect(0, 0, 6, 256); ctx.fillRect(122, 0, 6, 256);
    ctx.fillStyle = '#d6d6cf'; // edge lines
    ctx.fillRect(8, 0, 5, 256); ctx.fillRect(115, 0, 5, 256);
    ctx.fillStyle = '#f5c518'; // dashed centre line
    ctx.fillRect(61, 0, 6, 150);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}

let _roadMat = null;
export function roadMaterial() {
    if (!_roadMat) _roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return _roadMat;
}
export const ROAD_V = 24; // metres per texture repeat (one dash + gap)

// Path helpers ─────────────────────────────────────────────────
// path.pts: [{x, y, z, g, s}] (g = cross-slope, s = arc length); path.len
export function samplePath(path, s, out, tangent) {
    const pts = path.pts;
    s = Math.max(0, Math.min(path.len, s));
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].s <= s) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi];
    const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    out.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    out.g = a.g + (b.g - a.g) * t;
    if (tangent) tangent.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    // bridges: follow the deck curve exactly
    for (const br of path.bridges) {
        if (s >= br.s0 && s <= br.s1) { out.y = br.bridge.deckY((s - br.s0) / (br.s1 - br.s0)); out.g = 0; break; }
    }
    return out;
}

export function buildRoads(group, nodes) {
    const edges = new Set();
    nodes.forEach((a, i) => {
        const near = nodes.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.z - b.z) })).filter(o => o.j !== i && o.d < 9500).sort((p, q) => p.d - q.d).slice(0, 2);
        near.forEach(o => edges.add(Math.min(i, o.j) + ',' + Math.max(i, o.j)));
    });
    Bridge.roadMaterial = roadMaterial();
    const paths = [], bridges = [];
    for (const e of edges) {
        const [i, j] = e.split(',').map(Number);
        const a = nodes[i], b = nodes[j];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.ceil(len / STEP);
        const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
        const nx = -dz, nz = dx;
        const samples = [];
        let prevOut = null;
        for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            // gentle meander so roads don't look ruler-straight
            const wob = Math.sin(t * Math.PI * 3 + i) * Math.min(len * 0.04, 180) * Math.sin(t * Math.PI);
            let x = a.x + (b.x - a.x) * t + nx * wob, z = a.z + (b.z - a.z) * t + nz * wob;
            const out = outsideBases(x, z);
            if (out) {
                // switching fence sides: go round the corner(s) instead of cutting across the base
                if (prevOut && prevOut.base === out.base && prevOut.side !== out.side) {
                    const [x0, x1, z0, z1] = out.box;
                    const xSide = (sd) => (sd === 0 ? x0 : x1), zSide = (sd) => (sd === 2 ? z0 : z1);
                    const corners = [];
                    const a1 = prevOut.side, a2 = out.side;
                    if (a1 < 2 && a2 >= 2) corners.push([xSide(a1), zSide(a2)]);
                    else if (a1 >= 2 && a2 < 2) corners.push([xSide(a2), zSide(a1)]);
                    else if (a1 < 2) { const zs = Math.abs(prevOut.lz - z0) < Math.abs(prevOut.lz - z1) ? z0 : z1; corners.push([xSide(a1), zs], [xSide(a2), zs]); }
                    else { const xs = Math.abs(prevOut.lx - x0) < Math.abs(prevOut.lx - x1) ? x0 : x1; corners.push([xs, zSide(a1)], [xs, zSide(a2)]); }
                    for (const [clx, clz] of corners) {
                        const w = baseToWorld(out.base, clx, clz), ch = terrainHeight(w.x, w.z);
                        samples.push({ x: w.x, z: w.z, h: ch, kind: ch < 1 ? 'water' : 'land' });
                    }
                }
                x = out.x; z = out.z;
            }
            prevOut = out;
            const h = terrainHeight(x, z);
            samples.push({ x, z, h, kind: h < 1 ? 'water' : slopeAt(x, z) > 0.45 ? 'cliff' : 'land' });
        }
        let cur = null;
        const flush = () => { if (cur && cur.raw.length >= 2) paths.push(cur); cur = null; };
        for (let k = 0; k < samples.length; k++) {
            const sm = samples[k];
            if (sm.kind === 'land') {
                if (!cur) cur = { raw: [], bridgeRaw: [] };
                cur.raw.push({ x: sm.x, z: sm.z });
                continue;
            }
            if (sm.kind === 'cliff') { flush(); continue; }
            // water: look for the far shore
            let m = k;
            while (m < samples.length && samples[m].kind === 'water') m++;
            const A = samples[k - 1], B = samples[m];
            const span = A && B ? Math.hypot(B.x - A.x, B.z - A.z) : Infinity;
            if (cur && A && B && B.kind === 'land' && span <= MAX_BRIDGE && span >= MIN_BRIDGE) {
                const ya = A.h + 0.7, yb = B.h + 0.7;
                const br = new Bridge(new THREE.Vector3(A.x, ya, A.z), new THREE.Vector3(B.x, yb, B.z), bridges.length);
                bridges.push(br);
                group.add(br.group);
                cur.bridgeRaw.push({ bridge: br, at: cur.raw.length - 1 });
                // deck samples at the segment joints (the far shore sample is added by the loop)
                for (let q = 1; q < br.n; q++) cur.raw.push({ x: A.x + (B.x - A.x) * q / br.n, z: A.z + (B.z - A.z) * q / br.n, deck: true });
                k = m - 1;
            } else {
                flush();
                k = m - 1;
            }
        }
        flush();
    }
    // finish paths: heights, cross-slope, arc length, bridge ranges
    for (const p of paths) {
        let s = 0;
        p.pts = p.raw.map((r, idx) => {
            if (idx) s += Math.hypot(r.x - p.raw[idx - 1].x, r.z - p.raw[idx - 1].z);
            let y, g = 0;
            if (r.deck) y = 0; else {
                const h = terrainHeight(r.x, r.z);
                y = h + 0.7;
            }
            return { x: r.x, y, z: r.z, g, s };
        });
        // cross-slope from the direction of travel
        for (let idx = 0; idx < p.pts.length; idx++) {
            const P = p.pts[idx], Q = p.pts[Math.min(idx + 1, p.pts.length - 1)], O = p.pts[Math.max(idx - 1, 0)];
            let tx = Q.x - O.x, tz = Q.z - O.z;
            const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
            const rx = -tz, rz = tx; // right-hand side
            if (!p.raw[idx].deck) {
                const hr = terrainHeight(P.x + rx * ROAD_HALF, P.z + rz * ROAD_HALF), hl = terrainHeight(P.x - rx * ROAD_HALF, P.z - rz * ROAD_HALF);
                P.y = Math.max(P.y, Math.max(hr, hl) * 0.5 + terrainHeight(P.x, P.z) * 0.5 + 0.5);
                P.g = (hr - hl) / (2 * ROAD_HALF);
            }
        }
        p.len = s;
        p.bridges = p.bridgeRaw.map(({ bridge, at }) => {
            const s0 = p.pts[at].s, s1 = s0 + bridge.len;
            bridge.path = p; bridge.s0 = s0; bridge.s1 = s1;
            return { bridge, s0, s1 };
        });
        for (const q of p.pts) for (const br of p.bridges) if (q.s >= br.s0 - 0.01 && q.s <= br.s1 + 0.01) q.y = br.bridge.deckY((q.s - br.s0) / br.bridge.len);
        delete p.raw; delete p.bridgeRaw;
    }
    group.add(buildRoadMesh(paths));
    return { paths, bridges };
}

// Road ribbons (land sections only — bridges carry their own deck)
function buildRoadMesh(paths) {
    const pos = [], uv = [], idx = [];
    for (const p of paths) {
        let prev = null;
        for (let k = 0; k < p.pts.length; k++) {
            const P = p.pts[k];
            const onDeck = p.bridges.some(b => P.s > b.s0 + 0.01 && P.s < b.s1 - 0.01);
            const nextOnDeck = k + 1 < p.pts.length && p.bridges.some(b => p.pts[k + 1].s > b.s0 + 0.01 && p.pts[k + 1].s <= b.s1 + 0.01 && P.s >= b.s0 - 0.01);
            if (onDeck) { prev = null; continue; }
            const Q = p.pts[Math.min(k + 1, p.pts.length - 1)], O = p.pts[Math.max(k - 1, 0)];
            let tx = Q.x - O.x, tz = Q.z - O.z;
            const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
            const rx = -tz, rz = tx;
            const base = pos.length / 3;
            const lx = P.x - rx * ROAD_HALF, lz = P.z - rz * ROAD_HALF, Rx = P.x + rx * ROAD_HALF, Rz = P.z + rz * ROAD_HALF;
            // each edge follows its own ground so the ribbon never dips under a bank
            const yl = Math.max(P.y - P.g * ROAD_HALF, terrainHeight(lx, lz) + 0.35);
            const yr = Math.max(P.y + P.g * ROAD_HALF, terrainHeight(Rx, Rz) + 0.35);
            pos.push(lx, yl, lz, Rx, yr, Rz);
            uv.push(0, P.s / ROAD_V, 1, P.s / ROAD_V);
            if (prev !== null) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
            prev = nextOnDeck ? null : base;
        }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const road = new THREE.Mesh(g, roadMaterial());
    road.receiveShadow = true;
    road.frustumCulled = false;
    return road;
}

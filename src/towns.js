// ═══════════════════════════════════════════════════════════════
// Towns & roads: procedural villages on flat lowland, connected by roads.
// Houses are instanced (one draw call for walls, one for roofs); at night
// their windows glow as a warm point-light field.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight, BASES } from './world.js';
import { fbm, mulberry32, makeRadialTexture } from './util.js';

const EXTENT = 24000, CELL = 3200;

function slopeAt(x, z) {
    const e = 20, h = terrainHeight(x, z);
    return (Math.abs(terrainHeight(x + e, z) - h) + Math.abs(terrainHeight(x, z + e) - h)) / (2 * e);
}

export class Towns {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        scene.add(this.group);
        this.towns = this.placeTowns();
        this.buildHouses();
        this.buildRoads();
    }

    placeTowns() {
        const r = mulberry32(2024);
        const towns = [];
        for (let gx = -EXTENT; gx < EXTENT; gx += CELL) for (let gz = -EXTENT; gz < EXTENT; gz += CELL) {
            if (r() < 0.35) continue;
            // try a few spots in the cell: lowland, gentle slope, not forest, not at a base
            for (let t = 0; t < 6; t++) {
                const x = gx + r() * CELL, z = gz + r() * CELL;
                const h = terrainHeight(x, z);
                if (h < 8 || h > 160) continue;
                if (slopeAt(x, z) > 0.12) continue;
                if (fbm(x * 0.0006 + 40, z * 0.0006 - 12, 3) > 0.15) continue; // forests stay wild
                if (BASES.some(b => Math.hypot(x - b.x, z - b.z) < b.r * 2.2)) continue;
                const size = r() < 0.15 ? 'city' : r() < 0.5 ? 'town' : 'village';
                towns.push({ x, z, h, size, radius: size === 'city' ? 650 : size === 'town' ? 380 : 200, count: size === 'city' ? 220 : size === 'town' ? 90 : 35 });
                break;
            }
        }
        return towns;
    }

    buildHouses() {
        const r = mulberry32(99);
        const houses = [];
        for (const t of this.towns) {
            for (let i = 0; i < t.count * 2 && houses.length < 9000; i++) {
                const a = r() * Math.PI * 2, d = Math.sqrt(r()) * t.radius;
                const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
                const h = terrainHeight(x, z);
                if (h < 3 || slopeAt(x, z) > 0.2) continue;
                const central = d < t.radius * 0.35;
                const tall = t.size === 'city' && central && r() < 0.5;
                const w = tall ? 14 + r() * 14 : 7 + r() * 7, dep = tall ? 14 + r() * 14 : 7 + r() * 6;
                const ht = tall ? 20 + r() * 60 : 4 + r() * 4;
                houses.push({ x, z, y: h, w, d: dep, ht, rot: Math.floor(r() * 4) * Math.PI / 2 + (r() - 0.5) * 0.2, tall, hue: r() });
                if (houses.length >= t.count && i > t.count) break;
            }
        }
        this.houses = houses;
        const wallGeo = new THREE.BoxGeometry(1, 1, 1); wallGeo.translate(0, 0.5, 0);
        const roofGeo = new THREE.ConeGeometry(0.75, 1, 4, 1); roofGeo.rotateY(Math.PI / 4); roofGeo.translate(0, 0.5, 0);
        const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), houses.length);
        const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), houses.length);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
        const wallCols = [0xe8e0d0, 0xd8cdb8, 0xc9c2b4, 0xf0ece4, 0xbfb6a6], roofCols = [0x9a3b2a, 0x7a3326, 0x5a5f66, 0x8a4a2e, 0x4a4f55];
        const c = new THREE.Color();
        let n = 0;
        houses.forEach((hs) => {
            q.setFromAxisAngle(up, hs.rot);
            s.set(hs.w, hs.ht, hs.d); p.set(hs.x, hs.y - 0.5, hs.z);
            walls.setMatrixAt(n, m.compose(p, q, s));
            walls.setColorAt(n, c.setHex(hs.tall ? 0x9aa3ab : wallCols[Math.floor(hs.hue * wallCols.length)]));
            s.set(hs.w * 1.15, hs.tall ? 0.01 : hs.ht * 0.55, hs.d * 1.15); p.set(hs.x, hs.y - 0.5 + hs.ht, hs.z);
            roofs.setMatrixAt(n, m.compose(p, q, s));
            roofs.setColorAt(n, c.setHex(roofCols[Math.floor(hs.hue * 7) % roofCols.length]));
            n++;
        });
        for (const im of [walls, roofs]) { im.castShadow = false; im.receiveShadow = true; im.computeBoundingSphere(); this.group.add(im); }
        // night windows: one point per house, more on tall buildings
        const lp = [];
        houses.forEach(hs => {
            const k = hs.tall ? 6 : 1;
            for (let i = 0; i < k; i++) lp.push(hs.x + (Math.random() - 0.5) * hs.w * 0.6, hs.y + 2 + Math.random() * hs.ht * 0.8, hs.z + (Math.random() - 0.5) * hs.d * 0.6);
        });
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
        this.lights = new THREE.Points(lg, new THREE.PointsMaterial({
            map: makeRadialTexture(32, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,220,160,0.7)'], [1, 'rgba(255,180,90,0)']]),
            color: new THREE.Color(3.2, 2.2, 1.2), size: 26, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
        }));
        this.lights.visible = false;
        this.lights.frustumCulled = false;
        this.group.add(this.lights);
    }

    buildRoads() {
        const nodes = [...this.towns.map(t => ({ x: t.x, z: t.z })), ...BASES.map(b => ({ x: b.x, z: b.z }))];
        const edges = new Set();
        nodes.forEach((a, i) => {
            const near = nodes.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.z - b.z) })).filter(o => o.j !== i && o.d < 9000).sort((p, q) => p.d - q.d).slice(0, 2);
            near.forEach(o => edges.add(Math.min(i, o.j) + ',' + Math.max(i, o.j)));
        });
        const pos = [], idx = [];
        const W = 5;
        for (const e of edges) {
            const [i, j] = e.split(',').map(Number);
            const a = nodes[i], b = nodes[j];
            const len = Math.hypot(b.x - a.x, b.z - a.z);
            const steps = Math.ceil(len / 35);
            const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
            const nx = -dz, nz = dx;
            let prev = null;
            for (let k = 0; k <= steps; k++) {
                const t = k / steps;
                // gentle meander so roads don't look ruler-straight
                const wob = Math.sin(t * Math.PI * 3 + i) * Math.min(len * 0.04, 180) * Math.sin(t * Math.PI);
                const x = a.x + (b.x - a.x) * t + nx * wob, z = a.z + (b.z - a.z) * t + nz * wob;
                const h = terrainHeight(x, z);
                if (h < 1 || slopeAt(x, z) > 0.45) { prev = null; continue; } // no roads through the sea or up cliffs
                const y = h + 0.8;
                const base = pos.length / 3;
                pos.push(x + nx * W, y, z + nz * W, x - nx * W, y, z - nz * W);
                if (prev !== null) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
                prev = base;
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        const road = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
        road.receiveShadow = true;
        road.frustumCulled = false;
        this.group.add(road);
    }

    setNight(on) { this.lights.visible = on; }
}

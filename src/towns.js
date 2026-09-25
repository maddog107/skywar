// ═══════════════════════════════════════════════════════════════
// Towns: villages, towns and cities laid out on street grids.
//   • streets with markings, crossroads with traffic lights (cities) or stop
//     signs, zebra crossings, street lamps
//   • buildings set back along the streets on their lots: houses with pitched
//     roofs, townhouses, apartment blocks, downtown towers, a church, parks
//   • windows are drawn by a shader (lit at random at night)
//   • dirt trails out into the countryside with dune buggies
// Towns are joined by the intercity road network (roads.js); nothing is ever
// built on a road.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight, BASES, gateOf, baseToWorld } from './world.js';
import { fbm, mulberry32, makeRadialTexture, offsetUnits, freezeStatic } from './util.js';
import { buildRoads, roadMaterial, outsideBases, samplePath, liftWithDistance, RoadGround } from './roads.js';
import { mergeGeometries as mergeGeos } from 'three/addons/utils/BufferGeometryUtils.js';
import { Traffic } from './traffic.js';
import { setBridgeNight } from './bridges.js';
import { Buildings } from './buildings.js';
import { CarSet, PAINTS, NearInstances } from './carset.js';

const EXTENT = 24000, CELL = 3200;
const STREET_HALF = 5, BLOCK_CELL = 4;

function slopeAt(x, z) {
    const e = 12, h = terrainHeight(x, z);
    return (Math.abs(terrainHeight(x + e, z) - h) + Math.abs(terrainHeight(x, z + e) - h)) / (2 * e);
}

// ── Building material with shader-drawn windows (per-instance, in metres) ──
export function makeBuildingMaterial(kind) {
    const mat = new THREE.MeshStandardMaterial({ roughness: kind === 'tower' ? 0.35 : 0.85, metalness: kind === 'tower' ? 0.35 : 0.05 });
    mat.userData.night = { value: 0 };
    mat.onBeforeCompile = (sh) => {
        sh.uniforms.uNight = mat.userData.night;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying float vInst;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
                vScale = sc; vLp = position * sc; vLn = normal; vInst = float(gl_InstanceID);`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform float uNight; varying vec3 vLp; varying vec3 vLn; varying vec3 vScale; varying float vInst;
                float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
                // box-filtered repeating pulse (1 inside [a, b] of each unit period): far-away facades average
                // out to a flat tint instead of shimmering in moire patterns
                float pulseI(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
                float pulseAA(float x, float a, float b) { float w = max(fwidth(x), 1e-4); return (pulseI(x + 0.5 * w, a, b) - pulseI(x - 0.5 * w, a, b)) / w; }
                float winMask(out vec2 cell) {
                    cell = vec2(0.0);
                    if (abs(vLn.y) > 0.5) return 0.0;
                    float u = abs(vLn.x) > 0.5 ? vLp.z : vLp.x;
                    float y = vLp.y;
                    ${kind === 'tower' ? 'float fw = 2.4, fh = 3.6, wx0 = 0.08, wx1 = 0.92, wy0 = 0.18, wy1 = 0.9;' : 'float fw = 3.2, fh = 3.0, wx0 = 0.3, wx1 = 0.7, wy0 = 0.35, wy1 = 0.78;'}
                    cell = vec2(floor(u / fw) + (vLn.x + vLn.z) * 57.0, floor(y / fh));
                    float inX = pulseAA(u / fw, wx0, wx1);
                    float inY = pulseAA(y / fh, wy0, wy1);
                    float edge = step(1.0, y) * step(y, vScale.y - 0.8);
                    float halfW = (abs(vLn.x) > 0.5 ? vScale.z : vScale.x) * 0.5;
                    float side = step(abs(u), halfW - 0.9);
                    return inX * inY * edge * side;
                }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                vec2 wcell; float wm = winMask(wcell);
                float hw = hash12(wcell + vInst * 1.37);
                float lit = step(0.72, hw); // about a quarter of the windows are lit at night
                vec3 glass = ${kind === 'tower' ? 'vec3(0.18, 0.26, 0.34)' : 'vec3(0.12, 0.14, 0.17)'};
                diffuseColor.rgb = mix(diffuseColor.rgb, glass, wm);`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                // just under the bloom threshold: lit windows read as bright, not as a glowing haze
                totalEmissiveRadiance += wm * lit * uNight * mix(vec3(1.0, 0.72, 0.4), vec3(0.75, 0.85, 1.0), step(0.93, hw)) * 0.8;`);
    };
    mat.customProgramCacheKey = () => 'bld_' + kind;
    return mat;
}

// Gable roof: a prism along z (unit size, base at y = 0)
function gableGeometry() {
    const g = new THREE.BufferGeometry();
    const v = [
        -0.5, 0, -0.5, 0.5, 0, -0.5, 0, 1, -0.5,
        0.5, 0, 0.5, -0.5, 0, 0.5, 0, 1, 0.5,
        -0.5, 0, 0.5, -0.5, 0, -0.5, 0, 1, -0.5, -0.5, 0, 0.5, 0, 1, -0.5, 0, 1, 0.5,
        0.5, 0, -0.5, 0.5, 0, 0.5, 0, 1, 0.5, 0.5, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
}

function canvasTex(w, h, draw, rep = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
}

export class Towns {
    constructor(scene, world) {
        this.scene = scene;
        this.world = world;
        this.group = new THREE.Group();
        scene.add(this.group);
        this.blockGrid = new Set();
        this.rand = mulberry32(2024);
        this.towns = this.placeTowns();
        this.planStreets();
        // intercity roads join town centres and the airbase gates
        const gates = BASES.map(b => { const G = gateOf(b); const w = baseToWorld(b, G.lx + 70, G.lz); return { x: w.x, z: w.z }; });
        const { paths, bridges, deadEnds } = buildRoads(this.group, [...this.towns.map(t => ({ x: t.x, z: t.z })), ...gates]);
        this.deadEnds = deadEnds;
        this.paths = paths;
        this.bridges = bridges;
        for (const p of paths) this.markPath(p.pts, 10);
        this.streetPaths = this.buildStreets();
        this.dirtPaths = this.buildDirtTrails();
        this.buildSignals();
        this.buildBuildings();
        this.buildLamps();
        this.buildPeople();
        this.buildRoadblocks(this.deadEnds);
        this.traffic = new Traffic(this.group, [...paths, ...this.streetPaths], this.dirtPaths, this);
        for (const p of this.streetPaths) p.half = STREET_HALF;
        for (const p of this.dirtPaths) p.half = 3.2;
        this.ground = new RoadGround([...paths, ...this.streetPaths, ...this.dirtPaths]);
        this.time = 0;
        // nothing in a town moves as an object (cars and people are instances) except collapsing bridges
        freezeStatic(this.group, this.bridges.map(b => b.group));
        if (world) {
            world.blockTree = (x, z) => this.blocked(x, z) || this.towns.some(t => Math.hypot(x - t.x, z - t.z) < t.radius * 0.9);
            world.refreshTrees();
            world.setGroundConform(this.ground);
        }
    }

    // ── spatial blocker (roads, streets, buildings): 4 m cells ──
    key(x, z) { return Math.floor(x / BLOCK_CELL) + ',' + Math.floor(z / BLOCK_CELL); }
    mark(x, z, r) {
        for (let dx = -r; dx <= r + 0.01; dx += BLOCK_CELL) for (let dz = -r; dz <= r + 0.01; dz += BLOCK_CELL) {
            if (dx * dx + dz * dz <= r * r) this.blockGrid.add(this.key(x + dx, z + dz));
        }
    }
    blocked(x, z) { return this.blockGrid.has(this.key(x, z)); }
    markPath(pts, r) {
        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 4);
            for (let k = 0; k <= n; k++) this.mark(a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n, r);
        }
    }

    placeTowns() {
        const r = this.rand;
        const towns = [];
        for (let gx = -EXTENT; gx < EXTENT; gx += CELL) for (let gz = -EXTENT; gz < EXTENT; gz += CELL) {
            if (r() < 0.35) continue;
            for (let t = 0; t < 6; t++) {
                const x = gx + r() * CELL, z = gz + r() * CELL;
                const h = terrainHeight(x, z);
                if (h < 8 || h > 160) continue;
                if (slopeAt(x, z) > 0.1) continue;
                if (fbm(x * 0.0006 + 40, z * 0.0006 - 12, 3) > 0.15) continue; // forests stay wild
                if (BASES.some(b => Math.hypot(x - b.x, z - b.z) < b.r * 2.2)) continue;
                const size = r() < 0.15 ? 'city' : r() < 0.5 ? 'town' : 'village';
                const n = size === 'city' ? 5 : size === 'town' ? 3 : 1;
                const S = size === 'city' ? 66 : size === 'town' ? 74 : 84;
                towns.push({ x, z, h, size, n, S, radius: n * S + S * 0.6 });
                break;
            }
        }
        // grid orientation: line up with the direction to the nearest neighbour (where the main road comes in)
        for (const t of towns) {
            let best = null, bd = Infinity;
            for (const o of towns) { if (o === t) continue; const d = Math.hypot(o.x - t.x, o.z - t.z); if (d < bd) { bd = d; best = o; } }
            t.theta = best ? Math.atan2(best.x - t.x, best.z - t.z) : r() * Math.PI;
            t.ax = { x: Math.sin(t.theta), z: Math.cos(t.theta) };   // streets of axis 'a' run along ax
            t.bx = { x: Math.cos(t.theta), z: -Math.sin(t.theta) };  // streets of axis 'b' run along bx
        }
        return towns;
    }

    // town grid (u along bx, v along ax, metres) → world
    tw(t, u, v) { return { x: t.x + t.bx.x * u + t.ax.x * v, z: t.z + t.bx.z * u + t.ax.z * v }; }

    planStreets() {
        this.streetDefs = [];
        for (const t of this.towns) {
            const R = t.radius;
            const ks = t.size === 'village' ? [0] : [...Array(t.n * 2 + 1).keys()].map(k => k - t.n);
            for (const axis of ['a', 'b']) {
                for (const k of ks) {
                    const off = k * t.S;
                    const half = Math.sqrt(Math.max(0, R * R - off * off)) * (t.size === 'village' ? 1.6 : 1);
                    if (half < t.S * 0.8) continue;
                    this.streetDefs.push({ t, axis, k, off, half });
                }
            }
        }
    }

    // Street ribbons + drivable paths (split where the ground is unsuitable)
    buildStreets() {
        const paths = [];
        const pos = [], uv = [], idx = [];
        const STEP = 12;
        for (const sd of this.streetDefs) {
            const { t, axis, off, half } = sd;
            let cur = null, cut = false;
            // streets cut short by water or a steep bank get a roadblock at the cut
            const flush = (why) => {
                if (cur && cur.length > 2) {
                    const pth = this.makeStreetPath(cur, sd);
                    const P = pth.pts;
                    // waterfront streets just end at the water; only longer streets cut by a bank get a barrier
                    if (why === 'water') why = null;
                    if (cur.cutStart === 'water') cur.cutStart = null;
                    if (pth.len < 60) { cur.cutStart = null; why = null; }
                    if (cur.cutStart) this.deadEnds.push({ x: P[0].x, z: P[0].z, dx: P[0].x - P[1].x, dz: P[0].z - P[1].z, reason: cur.cutStart, w: STREET_HALF });
                    if (why) { const a = P[P.length - 1], b = P[P.length - 2]; this.deadEnds.push({ x: a.x, z: a.z, dx: a.x - b.x, dz: a.z - b.z, reason: why, w: STREET_HALF }); }
                    paths.push(pth);
                }
                cur = null;
            };
            for (let d = -half; d <= half + 0.01; d += STEP) {
                const w = axis === 'a' ? this.tw(t, off, d) : this.tw(t, d, off);
                const h = terrainHeight(w.x, w.z);
                if (h < 2 || slopeAt(w.x, w.z) > 0.34 || outsideBases(w.x, w.z)) { cut = h < 2 ? 'water' : 'closed'; flush(cut); continue; }
                if (!cur) { cur = []; cur.cutStart = d > -half + 0.01 ? cut || 'closed' : null; }
                cur.push({ x: w.x, z: w.z, d });
            }
            flush(null);
        }
        for (const p of paths) {
            this.markPath(p.pts, 6.5);
            let prev = null;
            for (let k = 0; k < p.pts.length; k++) {
                const P = p.pts[k], Q = p.pts[Math.min(k + 1, p.pts.length - 1)], O = p.pts[Math.max(k - 1, 0)];
                let tx = Q.x - O.x, tz = Q.z - O.z; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
                const rx = -tz, rz = tx;
                const lx = P.x - rx * STREET_HALF, lz = P.z - rz * STREET_HALF, Rx = P.x + rx * STREET_HALF, Rz = P.z + rz * STREET_HALF;
                const base = pos.length / 3;
                pos.push(lx, P.y - 0.05, lz, Rx, P.y - 0.05, Rz); // level across; the ground is shaped to meet it
                uv.push(0, P.s / 24, 1, P.s / 24);
                if (prev !== null) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
                prev = base;
            }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, roadMaterial());
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        return paths;
    }

    makeStreetPath(raw, sd) {
        let s = 0;
        const pts = raw.map((r, i) => {
            if (i) s += Math.hypot(r.x - raw[i - 1].x, r.z - raw[i - 1].z);
            return { x: r.x, y: terrainHeight(r.x, r.z) + 0.45, z: r.z, g: 0, s, d: r.d };
        });
        return { pts, len: s, bridges: [], street: true, sd, stops: [] };
    }

    // ── Crossroads: traffic lights (city centres, town squares) or 4-way stops ──
    buildSignals() {
        this.intersections = [];
        const byTown = new Map();
        for (const p of this.streetPaths) {
            if (!byTown.has(p.sd.t)) byTown.set(p.sd.t, []);
            byTown.get(p.sd.t).push(p);
        }
        for (const [t, ps] of byTown) {
            const aStreets = ps.filter(p => p.sd.axis === 'a'), bStreets = ps.filter(p => p.sd.axis === 'b');
            for (const pa of aStreets) for (const pb of bStreets) {
                // pa runs along ax at u = pa.off; pb runs along bx at v = pb.off → they cross at (pa.off, pb.off)
                const dA = pb.sd.off, dB = pa.sd.off; // where the crossing is, measured along each street
                const dA0 = pa.pts[0].d, dA1 = pa.pts[pa.pts.length - 1].d, dB0 = pb.pts[0].d, dB1 = pb.pts[pb.pts.length - 1].d;
                if (dA < dA0 + 6 || dA > dA1 - 6 || dB < dB0 + 6 || dB > dB1 - 6) continue;
                const w = this.tw(t, pa.sd.off, pb.sd.off);
                const ia = Math.abs(pa.sd.k), ib = Math.abs(pb.sd.k);
                const light = (t.size === 'city' && ia <= 2 && ib <= 2) || (t.size === 'town' && ia === 0 && ib === 0);
                const inter = { x: w.x, z: w.z, y: terrainHeight(w.x, w.z), t, type: light ? 'light' : 'stop', offset: this.rand() * 26, heads: [] };
                this.intersections.push(inter);
                pa.stops.push({ s: dA - dA0, inter, axis: 'a' });
                pb.stops.push({ s: dB - dB0, inter, axis: 'b' });
            }
        }
        for (const p of this.streetPaths) p.stops.sort((a, b) => a.s - b.s);
        const lights = this.intersections.filter(i => i.type === 'light'), stops = this.intersections.filter(i => i.type === 'stop');
        const poleGeo = new THREE.CylinderGeometry(0.1, 0.12, 5.2, 6); poleGeo.translate(0, 2.6, 0);
        const headGeo = new THREE.BoxGeometry(0.45, 1.3, 0.35);
        const lampGeo = new THREE.SphereGeometry(0.22, 8, 6);
        const signPoleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.3, 5); signPoleGeo.translate(0, 1.15, 0);
        // octagon with a flat top edge (thetaStart), not spun in its own plane, so STOP reads level
        const signGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 8, 1, false, Math.PI / 8); signGeo.rotateX(Math.PI / 2);
        { const uv = signGeo.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i) - 0.5, v = uv.getY(i) - 0.5; uv.setXY(i, 0.5 + v, 0.5 - u); } } // the cap UVs read sideways: turn them so STOP is upright
        const stopTex = canvasTex(128, 128, (ctx) => { ctx.fillStyle = '#c4161c'; ctx.fillRect(0, 0, 128, 128); ctx.fillStyle = '#fff'; ctx.font = 'bold 38px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('STOP', 64, 66); }, false);
        const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.6, metalness: 0.4 });
        const nL = Math.max(1, lights.length * 4), nS = Math.max(1, stops.length * 4);
        // street furniture is only drawn within a couple of km of the camera (see update)
        const poles = this.near(poleGeo, darkMat, nL);
        const heads = this.near(headGeo, darkMat, nL);
        this.lamps = this.near(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), nL, { colors: true });
        const sPoles = this.near(signPoleGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0a4, metalness: 0.5, roughness: 0.4 }), nS);
        const signs = this.near(signGeo, new THREE.MeshStandardMaterial({ map: stopTex, roughness: 0.6 }), nS);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
        const zebra = [];
        for (const it of this.intersections) {
            const t = it.t;
            const apps = [
                { dir: t.ax, axis: 'a', sgn: 1 }, { dir: t.ax, axis: 'a', sgn: -1 },
                { dir: t.bx, axis: 'b', sgn: 1 }, { dir: t.bx, axis: 'b', sgn: -1 },
            ];
            for (const ap of apps) {
                // traffic on this approach travels along -sgn*dir toward the junction; signs stand on its right-hand kerb
                const fx = -ap.dir.x * ap.sgn, fz = -ap.dir.z * ap.sgn;
                const rx = -fz, rz = fx;
                const x = it.x - fx * 8 + rx * (STREET_HALF + 1.2), z = it.z - fz * 8 + rz * (STREET_HALF + 1.2);
                const y = terrainHeight(x, z) - 0.1;
                q.setFromAxisAngle(up, Math.atan2(-fx, -fz)); // the plate (+Z) faces back along -f, toward the oncoming drivers
                if (it.type === 'light') {
                    poles.add(m.compose(p.set(x, y, z), q, one));
                    heads.add(m.compose(p.set(x, y + 5.6, z), q, one));
                    const li = this.lamps.add(m.compose(p.set(x - fx * 0.22, y + 5.6, z - fz * 0.22), q, one));
                    it.heads.push({ idx: li, axis: ap.axis, state: null });
                    zebra.push({ x: it.x - fx * 11, z: it.z - fz * 11, rot: Math.atan2(fx, fz) });
                } else {
                    sPoles.add(m.compose(p.set(x, y, z), q, one));
                    signs.add(m.compose(p.set(x - fx * 0.08, y + 2.25, z - fz * 0.08), q, one)); // plate in front of the post
                }
            }
        }
        this.lampColors = { red: new THREE.Color(4, 0.2, 0.1), amber: new THREE.Color(4, 2, 0.1), green: new THREE.Color(0.3, 4, 1) };
        for (let i = 0; i < this.lamps.n; i++) this.lamps.setColor(i, this.lampColors.red);
        const zTex = canvasTex(64, 64, (ctx) => { ctx.clearRect(0, 0, 64, 64); ctx.fillStyle = 'rgba(240,240,232,0.95)'; for (let i = 0; i < 4; i++) ctx.fillRect(4 + i * 16, 0, 8, 64); }, false);
        const zGeo = new THREE.PlaneGeometry(STREET_HALF * 2 - 1, 3.5); zGeo.rotateX(-Math.PI / 2);
        const zm = this.near(zGeo, new THREE.MeshStandardMaterial({ map: zTex, color: 0xb8b8b0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 }), Math.max(1, zebra.length));
        zebra.forEach((zb) => zm.add(m.compose(p.set(zb.x, terrainHeight(zb.x, zb.z) + 0.5, zb.z), q.setFromAxisAngle(up, zb.rot), one)));
    }

    // a NearInstances set that update() re-packs around the camera
    near(geo, mat, max, opts) {
        const set = new NearInstances(this.group, geo, mat, max, opts);
        (this.nearSets || (this.nearSets = [])).push(set);
        return set;
    }

    // One InstancedMesh per town for a kind of building part, each with its own tight bounding sphere,
    // so towns out of view (or out of the small shadow frustum) cost nothing. `far`: not drawn beyond this.
    perTown(geo, mat, list, write, { shadow = true, far = Infinity } = {}) {
        const byTown = new Map();
        for (const o of list) { if (!byTown.has(o.t)) byTown.set(o.t, []); byTown.get(o.t).push(o); }
        const out = [];
        for (const items of byTown.values()) {
            const im = new THREE.InstancedMesh(geo, mat, items.length);
            items.forEach((o, i) => write(im, i, o));
            im.castShadow = shadow; im.receiveShadow = true;
            im.computeBoundingSphere();
            im.matrixAutoUpdate = false;
            im.userData.far = far;
            this.group.add(im);
            (this.townMeshes || (this.townMeshes = [])).push(im);
            out.push(im);
        }
        return out;
    }

    // phase of a traffic light for an axis: 'green' | 'amber' | 'red'
    lightState(inter, axis) {
        const T = 26, t = (this.time + inter.offset) % T;
        if (axis === 'a') return t < 10 ? 'green' : t < 13 ? 'amber' : 'red';
        return t < 13 ? 'red' : t < 23 ? 'green' : 'amber';
    }

    // ── Buildings on lots along the streets ──
    buildBuildings() {
        const r = mulberry32(99);
        const items = { house: [], town: [], apt: [], tower: [] };
        const roofs = [], flatRoofs = [], acUnits = [], trees = [], parks = [], specials = [], driveways = [];
        const tryPlace = (t, u, v, w, d, rot, kind, ht) => {
            // the whole footprint must be on dry, fairly flat land and clear of every road and street
            const c = this.tw(t, u, v);
            const ca = Math.cos(rot), sa = Math.sin(rot);
            const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0], [0, -d / 2], [0, d / 2]].map(([a, b]) => this.tw(t, u + a * ca - b * sa, v + a * sa + b * ca));
            let hmin = Infinity, hmax = -Infinity;
            for (const q of corners) {
                if (this.blocked(q.x, q.z)) return false;
                const h = terrainHeight(q.x, q.z);
                if (h < 2) return false;
                hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
            }
            if (hmax - hmin > Math.max(3, w * 0.25)) return false;
            // lots are axis-aligned in the town grid: keep a 2 m gap to every footprint already placed
            const sw = Math.abs(Math.sin(rot)) > 0.5, hu = (sw ? d : w) / 2 + 1, hv = (sw ? w : d) / 2 + 1;
            const fp = t.footprints || (t.footprints = []);
            if (fp.some(f => Math.abs(f.u - u) < f.hu + hu && Math.abs(f.v - v) < f.hv + hv)) return false;
            fp.push({ u, v, hu, hv });
            for (const q of corners) this.mark(q.x, q.z, 2);
            items[kind].push({ x: c.x, z: c.z, y: hmin - 0.6, w, d, ht: ht + (hmax - hmin), yaw: t.theta + rot, hue: r(), t });
            return true;
        };
        for (const t of this.towns) {
            const S = t.S, inner = S - STREET_HALF * 2 - 6;
            const n = t.size === 'village' ? 1 : t.n;
            let church = false;
            for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) {
                const cu = (i + 0.5) * S, cv = (j + 0.5) * S;
                const dist = Math.hypot(cu, cv);
                if (dist > t.radius - S * 0.3) continue;
                const rel = dist / t.radius;
                const zone = t.size === 'city' ? (rel < 0.3 ? 'tower' : rel < 0.55 ? 'apt' : rel < 0.75 ? 'town' : 'house')
                    : t.size === 'town' ? (rel < 0.32 ? 'town' : 'house') : 'house';
                if (t.size !== 'village' && !church && rel < 0.55 && r() < 0.3) {
                    const c = this.tw(t, cu, cv);
                    if (!this.blocked(c.x, c.z) && terrainHeight(c.x, c.z) > 2 && slopeAt(c.x, c.z) < 0.1) {
                        church = true;
                        (t.footprints || (t.footprints = [])).push({ u: cu, v: cv, hu: 16, hv: 20 });
                        specials.push({ x: c.x, z: c.z, y: terrainHeight(c.x, c.z) - 0.5, yaw: t.theta });
                        this.mark(c.x, c.z, 18);
                        continue;
                    }
                }
                if (r() < (t.size === 'city' ? 0.08 : 0.05)) { parks.push({ t, cu, cv, size: inner }); continue; }
                if (zone === 'tower') {
                    const two = r() < 0.5;
                    const w = two ? inner * 0.44 : inner * (0.6 + r() * 0.3), d = inner * (0.55 + r() * 0.35);
                    const hgt = 28 + Math.pow(Math.max(0, 1 - rel / 0.3), 1.2) * 95 * (0.6 + r() * 0.6);
                    // if the big footprint doesn't fit (a road cuts the block), try smaller buildings in the corners
                    let placed = two
                        ? tryPlace(t, cu - inner * 0.26, cv, w, d, 0, 'tower', hgt) + tryPlace(t, cu + inner * 0.26, cv, w, d, 0, 'tower', hgt * (0.55 + r() * 0.5))
                        : tryPlace(t, cu, cv, w, d, 0, 'tower', hgt) ? 1 : 0;
                    if (!placed) for (const [a, b2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
                        tryPlace(t, cu + a * inner * 0.27, cv + b2 * inner * 0.27, inner * 0.4, inner * 0.4, 0, r() < 0.6 ? 'tower' : 'apt', hgt * (0.4 + r() * 0.4));
                    }
                    continue;
                }
                const lotW = zone === 'apt' ? 22 : zone === 'town' ? 12 : 13;
                const depth = zone === 'apt' ? 16 : zone === 'town' ? 12 : 10;
                const edge = inner / 2 - depth / 2 - (zone === 'house' ? 4 : 0); // houses get front yards
                for (const side of [0, 1, 2, 3]) {
                    const alongU = side < 2;
                    for (let o = -inner / 2 + lotW / 2; o <= inner / 2 - lotW / 2 + 0.1; o += lotW + (zone === 'house' ? 5 : 1)) {
                        if (zone === 'house' && r() < 0.18) continue; // gaps: driveways and gardens
                        const sgn = side % 2 ? 1 : -1;
                        const u = alongU ? cu + o : cu + sgn * edge;
                        const v = alongU ? cv + sgn * edge : cv + o;
                        const rot = alongU ? 0 : Math.PI / 2;
                        const w = lotW - (zone === 'house' ? 2 + r() * 3 : 0.5), d = depth - r() * 2;
                        const ht = zone === 'apt' ? 12 + Math.floor(r() * 5) * 3 : zone === 'town' ? 6 + Math.floor(r() * 3) * 3 : 3.2 + (r() < 0.35 ? 3 : 0);
                        if (tryPlace(t, u, v, w, d, rot, zone, ht) && zone === 'house') {
                            // driveway beside the house from the street, usually with a car on it
                            const streetEdge = S / 2 - STREET_HALF, back = edge - d * 0.25;
                            const len = streetEdge - back, mid = (streetEdge + back) / 2;
                            const lat = o + (w / 2 + 2);
                            const du = alongU ? cu + lat : cu + sgn * mid, dv = alongU ? cv + sgn * mid : cv + lat;
                            const c = this.tw(t, du, dv);
                            const k = r(); driveways.push({ t, x: c.x, z: c.z, len, yaw: t.theta + rot, cars: k < 0.15 ? 0 : k < 0.6 ? 1 : 2, hue: r(), hue2: r(), flip: r() < 0.5 });
                        }
                    }
                }
                if (zone === 'house' || zone === 'town') for (let k = 0; k < 2; k++) {
                    const c = this.tw(t, cu + (r() - 0.5) * inner * 0.35, cv + (r() - 0.5) * inner * 0.35);
                    if (!this.blocked(c.x, c.z)) trees.push({ x: c.x, z: c.z, s: 0.5 + r() * 0.4, t });
                }
            }
        }
        const wallGeo = new THREE.BoxGeometry(1, 1, 1); wallGeo.translate(0, 0.5, 0);
        const houseMat = makeBuildingMaterial('house'), towerMat = makeBuildingMaterial('tower');
        this.buildingMats = [houseMat, towerMat];
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
        const wallCols = [0xe8e0d0, 0xd8cdb8, 0xc9c2b4, 0xf0ece4, 0xbfb6a6, 0xd9c6a5, 0xa9b8c4, 0xc7a58a, 0xe6d3b3, 0xb7c7a8];
        const aptCols = [0xb8b0a4, 0xc9bda8, 0x9aa3a8, 0xd2c3ad, 0xa89484, 0xc4a896];
        const towerCols = [0x7d8fa0, 0x8a98a8, 0x5f7488, 0x9aa7b3, 0x6b7c70, 0xb0a898];
        const roofCols = [0x9a3b2a, 0x7a3326, 0x5a5f66, 0x8a4a2e, 0x4a4f55, 0x6e2f22];
        const all = [...items.house.map(o => ({ ...o, kind: 'house' })), ...items.town.map(o => ({ ...o, kind: 'town' })), ...items.apt.map(o => ({ ...o, kind: 'apt' }))];
        for (const o of all) {
            const top = o.y + o.ht;
            if (o.kind === 'house') roofs.push({ t: o.t, x: o.x, y: top, z: o.z, w: o.w * 1.12, d: o.d * 1.14, h: 2 + o.d * 0.2, yaw: o.yaw, hue: o.hue, b: o });
            else {
                flatRoofs.push({ t: o.t, x: o.x, y: top, z: o.z, w: o.w + 0.4, d: o.d + 0.4, yaw: o.yaw, b: o });
                if (o.kind === 'apt' || o.hue < 0.4) acUnits.push({ t: o.t, x: o.x + (o.hue - 0.5) * o.w * 0.4, y: top + 0.1, z: o.z, yaw: o.yaw, s: 1.4 + o.hue * 1.4, b: o });
            }
        }
        // every building is also a solid, destructible record (buildings.js) that knows the instances drawing it
        const B = this.buildings = new Buildings(this.group);
        for (const o of [...all, ...items.tower]) o.rec = B.add({ ...o, kind: o.kind || 'tower', roofH: o.kind === 'house' ? 2 + o.d * 0.2 : 0 });
        const own = (o, im, i, role) => { const b = o.rec || (o.b && o.b.rec); if (b) B.part(b, im, i, role); };
        this.perTown(wallGeo, houseMat, all, (im, i, o) => {
            own(o, im, i, 'wall');
            q.setFromAxisAngle(up, o.yaw);
            im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.w, o.ht, o.d)));
            im.setColorAt(i, c.setHex(o.kind === 'apt' ? aptCols[Math.floor(o.hue * aptCols.length)] : wallCols[Math.floor(o.hue * wallCols.length)]));
        });
        for (const o of items.tower) {
            flatRoofs.push({ t: o.t, x: o.x, y: o.y + o.ht, z: o.z, w: o.w + 0.6, d: o.d + 0.6, yaw: o.yaw, b: o });
            acUnits.push({ t: o.t, x: o.x, y: o.y + o.ht + 0.1, z: o.z, yaw: o.yaw, s: 3 + o.hue * 3, b: o });
            if (o.ht > 80) acUnits.push({ t: o.t, x: o.x, y: o.y + o.ht, z: o.z, yaw: 0, s: 0.5, mast: 18, b: o });
        }
        this.perTown(wallGeo, towerMat, items.tower, (im, i, o) => {
            own(o, im, i, 'wall');
            q.setFromAxisAngle(up, o.yaw);
            im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.w, o.ht, o.d)));
            im.setColorAt(i, c.setHex(towerCols[Math.floor(o.hue * towerCols.length)]));
        });
        // gable roofs: ridge along the building's long side (w), gables at the ends
        this.perTown(gableGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), roofs, (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw + Math.PI / 2);
            im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, s.set(o.d, o.h, o.w)));
            im.setColorAt(i, c.setHex(roofCols[Math.floor(o.hue * 7) % roofCols.length]));
        });
        this.perTown(wallGeo, new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.9 }), flatRoofs, (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw); im.setMatrixAt(i, m.compose(p.set(o.x, o.y - 0.2, o.z), q, s.set(o.w, 0.6, o.d)));
        });
        // rooftop clutter is too small to see from far away
        this.perTown(wallGeo, new THREE.MeshStandardMaterial({ color: 0x9da3a6, roughness: 0.6, metalness: 0.4 }), acUnits, (im, i, o) => {
            own(o, im, i);
            q.setFromAxisAngle(up, o.yaw); im.setMatrixAt(i, m.compose(p.set(o.x, o.y, o.z), q, o.mast ? s.set(o.s, o.mast, o.s) : s.set(o.s * 1.6, o.s * 0.7, o.s)));
        }, { far: 7000 });
        B.index();
        for (const sp of specials) this.group.add(this.makeChurch(sp));
        this.buildDriveways(driveways);
        // parks: a lawn following the ground, and trees
        const lawnMat = new THREE.MeshStandardMaterial({ color: 0x4f8a3c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 });
        for (const pk of parks) {
            const cpt = this.tw(pk.t, pk.cu, pk.cv);
            const h0 = terrainHeight(cpt.x, cpt.z);
            const geo = new THREE.PlaneGeometry(pk.size, pk.size, 4, 4);
            geo.rotateX(-Math.PI / 2);
            geo.rotateY(pk.t.theta);
            const la = geo.attributes.position;
            for (let i = 0; i < la.count; i++) la.setY(i, terrainHeight(cpt.x + la.getX(i), cpt.z + la.getZ(i)) - h0 + 0.3);
            geo.computeVertexNormals();
            const lawn = new THREE.Mesh(geo, lawnMat);
            lawn.position.set(cpt.x, h0, cpt.z);
            lawn.receiveShadow = true;
            this.group.add(lawn);
            for (let k = 0; k < 9; k++) {
                const tp = this.tw(pk.t, pk.cu + (this.rand() - 0.5) * pk.size * 0.85, pk.cv + (this.rand() - 0.5) * pk.size * 0.85);
                trees.push({ x: tp.x, z: tp.z, s: 0.6 + this.rand() * 0.5, t: pk.t });
            }
        }
        if (this.world && this.world.treeGeo && trees.length) {
            this.perTown(this.world.treeGeo, this.world.treeMat, trees, (im, i, o) => {
                q.setFromAxisAngle(up, this.rand() * 6.28); im.setMatrixAt(i, m.compose(p.set(o.x, terrainHeight(o.x, o.z) - 0.5, o.z), q, s.set(o.s, o.s, o.s)));
            }, { shadow: false, far: 12000 });
        }
        this.buildingCount = all.length + items.tower.length;
    }

    buildDriveways(list) {
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
        const slab = new THREE.BoxGeometry(1, 1, 1); slab.translate(0, 0.5, 0);
        this.perTown(slab, new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.95 }), list, (im, i, o) => {
            q.setFromAxisAngle(up, o.yaw);
            im.setMatrixAt(i, m.compose(p.set(o.x, terrainHeight(o.x, o.z) - 0.3, o.z), q, s.set(3.6, 0.75, o.len)));
        }, { shadow: false, far: 9000 });
        // parked cars
        // one or two cars per driveway (two parked nose to tail)
        const cars = [];
        for (const o of list) {
            if (o.cars === 1) cars.push({ ...o, off: 0 });
            else if (o.cars === 2) { cars.push({ ...o, off: -2.7 }); cars.push({ ...o, off: 2.7, hue: o.hue2, flip: !o.flip }); }
        }
        const set = new CarSet(this.group, Math.max(1, cars.length), mulberry32(5150), { castShadow: false, allowSpecial: false });
        cars.forEach((o, i) => {
            q.setFromAxisAngle(up, o.yaw + (o.flip ? Math.PI : 0));
            const ox = o.x - Math.sin(o.yaw) * o.off, oz = o.z - Math.cos(o.yaw) * o.off;
            m.compose(p.set(ox, terrainHeight(ox, oz) + 0.45, oz), q, s.set(1, 1, 1));
            set.setMatrix(i, m);
            set.setPaint(i, PAINTS[Math.floor(o.hue * PAINTS.length)]);
        });
        this.parkedSet = set; // uploaded near the camera only (see update)
        this.parkedCars = cars.length;
    }

    // People walking the sidewalks (instanced; a gentle bob sells the walk from the air)
    buildPeople() {
        const r = mulberry32(4242);
        const streets = this.streetPaths.filter(p => p.len > 60);
        const total = streets.reduce((a, p) => a + p.len, 0);
        const n = Math.min(1400, Math.floor(total / 55));
        const body = new THREE.CylinderGeometry(0.22, 0.2, 1.05, 6); body.translate(0, 1.05, 0);
        const head = new THREE.SphereGeometry(0.14, 6, 5); head.translate(0, 1.72, 0);
        const legs = new THREE.CylinderGeometry(0.16, 0.12, 0.55, 5); legs.translate(0, 0.28, 0);
        const merge = (g, col) => { const cols = []; for (let i = 0; i < g.attributes.position.count; i++) cols.push(col.r, col.g, col.b); g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); return g.index ? g.toNonIndexed() : g; };
        const white = new THREE.Color(1, 1, 1), skin = new THREE.Color(0.78, 0.6, 0.48), dark = new THREE.Color(0.18, 0.19, 0.22);
        void white;
        // shirts take a per-person colour; heads and legs are shared
        this.people = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.85 }), Math.max(1, n));
        this.peopleRest = new THREE.InstancedMesh(mergeGeos([merge(head, skin), merge(legs, dark)]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), Math.max(1, n));
        for (const im of [this.people, this.peopleRest]) { im.frustumCulled = false; im.castShadow = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); }
        const SHIRTS = [0xc0392b, 0x2980b9, 0x27ae60, 0xf1c40f, 0xecf0f1, 0x8e44ad, 0x34495e, 0xe67e22, 0x16a085, 0xd35400];
        this.walkers = [];
        const c = new THREE.Color();
        for (let i = 0; i < n; i++) {
            let x = r() * total, path = streets[0];
            for (const p of streets) { x -= p.len; if (x <= 0) { path = p; break; } }
            this.walkers.push({ path, s: r() * path.len, dir: r() < 0.5 ? 1 : -1, side: r() < 0.5 ? 1 : -1, speed: 1.1 + r() * 0.6, ph: r() * 6.28, h: 0.9 + r() * 0.2, shirt: SHIRTS[Math.floor(r() * SHIRTS.length)] });
            this.people.setColorAt(i, c.setHex(this.walkers[i].shirt));
        }
        this.people.count = this.peopleRest.count = n;
        this.group.add(this.people, this.peopleRest);
    }

    updatePeople(dt, cam) {
        if (!this.people) return;
        const T = this._pt || (this._pt = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), p: new THREE.Vector3(), t: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), c: new THREE.Color() });
        const { m, q, s, p, t, up } = T;
        const R2 = 1800 * 1800;
        let k = 0;
        for (const w of this.walkers) {
            w.s += w.dir * w.speed * dt;
            if (w.s < 1 || w.s > w.path.len - 1) { w.dir = -w.dir; w.s = Math.max(1, Math.min(w.path.len - 1, w.s)); }
            // too far away to see: just keep walking, don't draw
            if (cam && w.x !== undefined && (w.x - cam.x) ** 2 + (w.z - cam.z) ** 2 > R2) continue;
            samplePath(w.path, w.s, p, t);
            w.x = p.x; w.z = p.z;
            const i = k++;
            // sidewalk on one side of the street
            p.x += -t.z * (STREET_HALF + 1.4) * w.side; p.z += t.x * (STREET_HALF + 1.4) * w.side;
            w.ph += dt * w.speed * 5.5;
            p.y += -0.35 + Math.abs(Math.sin(w.ph)) * 0.06; // street height (cheaper than sampling the terrain)
            q.setFromAxisAngle(up, Math.atan2(-t.x * w.dir, -t.z * w.dir));
            m.compose(p, q, s.set(1, w.h, 1));
            m.toArray(this.people.instanceMatrix.array, i * 16);
            m.toArray(this.peopleRest.instanceMatrix.array, i * 16);
            T.c.setHex(w.shirt).toArray(this.people.instanceColor.array, i * 3);
        }
        const was = this.people.count;
        this.people.count = this.peopleRest.count = k;
        this.people.visible = this.peopleRest.visible = k > 0;
        if (!k && !was) return;
        // upload only the walkers actually drawn
        for (const [attr, n] of [[this.people.instanceMatrix, k * 16], [this.peopleRest.instanceMatrix, k * 16], [this.people.instanceColor, k * 3]]) {
            attr.clearUpdateRanges();
            if (n) attr.addUpdateRange(0, n);
            attr.needsUpdate = n > 0;
        }
    }

    makeChurch(sp) {
        const g = new THREE.Group();
        const wall = new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.85 });
        const roof = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.7, side: THREE.DoubleSide });
        const nave = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 26), wall); nave.position.y = 4.5; g.add(nave);
        const nr = new THREE.Mesh(gableGeometry(), roof); nr.scale.set(13.5, 5, 27); nr.position.y = 9; g.add(nr);
        const tower = new THREE.Mesh(new THREE.BoxGeometry(6, 20, 6), wall); tower.position.set(0, 10, -14); g.add(tower);
        const spire = new THREE.Mesh(new THREE.ConeGeometry(4.2, 14, 4), roof); spire.rotation.y = Math.PI / 4; spire.position.set(0, 27, -14); g.add(spire);
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), roof); cross.position.set(0, 35, -14); g.add(cross);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.3), roof); arm.position.set(0, 35.4, -14); g.add(arm);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        g.position.set(sp.x, sp.y, sp.z);
        g.rotation.y = sp.yaw;
        return g;
    }

    // Road closed / road works / bridge out: barriers, cones and a sign wherever a road stops short
    buildRoadblocks(list) {
        const r = mulberry32(31337);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
        const stripe = canvasTex(256, 32, (ctx, w, h) => { for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f4f4f0' : '#d0201a'; ctx.beginPath(); ctx.moveTo(i * 32, h); ctx.lineTo(i * 32 + 16, 0); ctx.lineTo(i * 32 + 48, 0); ctx.lineTo(i * 32 + 32, h); ctx.fill(); } }, false);
        const signTex = (text, bg, fg) => canvasTex(256, 160, (ctx, w, h) => {
            ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = fg; ctx.lineWidth = 10; ctx.strokeRect(8, 8, w - 16, h - 16);
            ctx.fillStyle = fg; ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const lines = text.split('\n'); lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 50));
        }, false);
        const SIGNS = { closed: signTex('ROAD\nCLOSED', '#f4f4ee', '#c4161c'), works: signTex('ROAD WORK\nAHEAD', '#ff8a1c', '#141414'), water: signTex('END OF\nROAD', '#f4f4ee', '#c4161c') };
        const plankGeo = new THREE.BoxGeometry(1, 0.45, 0.12); plankGeo.translate(0, 0, 0);
        const postGeo = new THREE.BoxGeometry(0.12, 1.2, 0.12); postGeo.translate(0, 0.6, 0);
        const coneGeo = new THREE.ConeGeometry(0.28, 0.75, 10); coneGeo.translate(0, 0.37, 0);
        const signGeo = new THREE.PlaneGeometry(2.2, 1.4); signGeo.translate(0, 2.2, 0);
        const planks = [], posts = [], cones = [], signs = { closed: [], works: [], water: [] };
        for (const d of list) {
            const L = Math.hypot(d.dx, d.dz) || 1, fx = d.dx / L, fz = d.dz / L; // outward (the way the road would have gone)
            const rx = -fz, rz = fx;
            const yaw = Math.atan2(-fx, -fz);
            const kind = d.reason === 'water' ? 'water' : r() < 0.5 ? 'works' : 'closed';
            const bx = d.x - fx * 3, bz = d.z - fz * 3;
            const y = terrainHeight(bx, bz);
            // barrier across the whole road
            const W = d.w * 2 + 1;
            planks.push([bx, y + 1.0, bz, yaw, W], [bx, y + 0.45, bz, yaw, W]);
            for (const o of [-d.w, 0, d.w]) posts.push([bx + rx * o, y, bz + rz * o, yaw]);
            // sign on the barrier, facing the traffic that arrives here
            signs[kind].push([bx - fx * 0.3, y, bz - fz * 0.3, yaw + Math.PI]);
            // a line of cones in front for road works (and a few anyway)
            const nc = kind === 'works' ? 6 : 3;
            for (let k = 0; k < nc; k++) {
                const t = (k / (nc - 1) - 0.5) * d.w * 1.6, back = 6 + (k % 2) * 2;
                const cx = bx - fx * back + rx * t, cz = bz - fz * back + rz * t;
                cones.push([cx, terrainHeight(cx, cz) + 0.3, cz, 0]);
            }
        }
        const add = (geo, mat, list, scaleW) => {
            if (!list.length) return;
            const set = this.near(geo, mat, list.length, { castShadow: true });
            for (const [x, y, z, yaw, w] of list) set.add(m.compose(p.set(x, y, z), q.setFromAxisAngle(up, yaw), scaleW ? s.set(w, 1, 1) : one));
        };
        add(plankGeo, new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 }), planks, true);
        add(postGeo, new THREE.MeshStandardMaterial({ color: 0x555a5e, roughness: 0.6 }), posts);
        add(coneGeo, new THREE.MeshStandardMaterial({ color: 0xff6a10, roughness: 0.6 }), cones);
        for (const k of Object.keys(signs)) add(signGeo, new THREE.MeshStandardMaterial({ map: SIGNS[k], roughness: 0.6, side: THREE.DoubleSide }), signs[k]);
        this.roadblockCount = list.length;
    }

    // Street lamps along town streets (glow at night)
    buildLamps() {
        const pts = [];
        for (const p of this.streetPaths) {
            for (let k = 1; k < p.pts.length - 1; k += 4) {
                const a = p.pts[k], b = p.pts[k + 1];
                let tx = b.x - a.x, tz = b.z - a.z; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
                const side = Math.floor(k / 4) % 2 ? 1 : -1; // alternate sides of the street
                const x = a.x - tz * (STREET_HALF + 1.5) * side, z = a.z + tx * (STREET_HALF + 1.5) * side;
                if (terrainHeight(x, z) < 2) continue;
                pts.push({ x, z, y: terrainHeight(x, z), rx: tz * side, rz: -tx * side });
            }
        }
        const poleGeo = new THREE.CylinderGeometry(0.08, 0.11, 7, 5); poleGeo.translate(0, 3.5, 0);
        const poles = this.near(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3b3f44, metalness: 0.5, roughness: 0.5 }), Math.max(1, pts.length));
        const m = new THREE.Matrix4();
        const glow = [];
        for (const o of pts) {
            poles.add(m.makeTranslation(o.x, o.y - 0.2, o.z));
            glow.push(o.x + o.rx * 1.2, o.y + 6.9, o.z + o.rz * 1.2);
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(glow, 3));
        this.lampGlow = new THREE.Points(lg, new THREE.PointsMaterial({
            map: makeRadialTexture(32, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,225,170,0.6)'], [1, 'rgba(255,190,110,0)']]),
            color: new THREE.Color(1.6, 1.2, 0.7), size: 5, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
        }));
        this.lampGlow.visible = false;
        this.lampGlow.frustumCulled = false;
        this.group.add(this.lampGlow);
    }

    // Dirt trails wandering from town edges into the hills and along the coast
    buildDirtTrails() {
        const r = mulberry32(777);
        const trails = [];
        for (const t of this.towns) {
            if (t.size === 'city' || r() < 0.4) continue;
            let ang = r() * Math.PI * 2;
            let x = t.x + Math.sin(ang) * (t.radius + 25), z = t.z + Math.cos(ang) * (t.radius + 25);
            if (this.blocked(x, z)) continue;
            const pts = [{ x, z }];
            const steps = 60 + Math.floor(r() * 70);
            for (let k = 0; k < steps; k++) {
                let ok = false;
                for (let tries = 0; tries < 8 && !ok; tries++) {
                    const a = ang + (r() - 0.5) * (0.6 + tries * 0.35);
                    const nx = x + Math.sin(a) * 22, nz = z + Math.cos(a) * 22;
                    const h = terrainHeight(nx, nz);
                    if (h < 1.5 || slopeAt(nx, nz) > 0.32 || outsideBases(nx, nz) || this.towns.some(o => Math.hypot(nx - o.x, nz - o.z) < o.radius)) continue;
                    x = nx; z = nz; ang = a + (r() - 0.5) * 0.2; ok = true;
                }
                if (!ok) break;
                pts.push({ x, z });
            }
            if (pts.length < 25) continue;
            let s = 0;
            const P = pts.map((q, i) => { if (i) s += Math.hypot(q.x - pts[i - 1].x, q.z - pts[i - 1].z); return { x: q.x, y: terrainHeight(q.x, q.z) + 0.3, z: q.z, g: 0, s }; });
            trails.push({ pts: P, len: s, bridges: [], dirt: true, stops: [] });
        }
        const tex = canvasTex(64, 128, (ctx, w, h) => {
            ctx.fillStyle = '#8a6f4d'; ctx.fillRect(0, 0, w, h);
            for (let i = 0; i < 900; i++) { const v = 90 + Math.random() * 60; ctx.fillStyle = `rgba(${v},${Math.round(v * 0.8)},${Math.round(v * 0.55)},0.5)`; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
            ctx.fillStyle = 'rgba(80,60,40,0.55)'; ctx.fillRect(14, 0, 8, h); ctx.fillRect(42, 0, 8, h);
            ctx.fillStyle = 'rgba(110,140,70,0.45)'; ctx.fillRect(28, 0, 8, h);
        });
        const pos = [], uv = [], idx = [];
        const HW = 3.2;
        for (const tr of trails) {
            let prev = null;
            tr.pts.forEach((P, k) => {
                const Q = tr.pts[Math.min(k + 1, tr.pts.length - 1)], O = tr.pts[Math.max(k - 1, 0)];
                let tx = Q.x - O.x, tz = Q.z - O.z; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
                const lx = P.x + tz * HW, lz = P.z - tx * HW, Rx = P.x - tz * HW, Rz = P.z + tx * HW;
                const base = pos.length / 3;
                pos.push(lx, P.y - 0.05, lz, Rx, P.y - 0.05, Rz);
                uv.push(0, P.s / 12, 1, P.s / 12);
                if (prev !== null) idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
                prev = base;
            });
            this.markPath(tr.pts, 4.5);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, liftWithDistance(new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: offsetUnits(-4), side: THREE.DoubleSide })));
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        return trails;
    }

    // Deck height of a standing bridge under (x, z) for something at height y, or null
    bridgeAt(x, z, y) {
        for (const b of this.bridges) { const h = b.deckAt(x, z, y); if (h != null) return h; }
        return null;
    }

    update(dt, cam) {
        this.time += dt;
        if (this.buildings) this.buildings.update(dt, cam);
        // parked cars: re-pick the ones near the camera when it has moved a fair way
        // (and the street furniture, and which towns' rooftop clutter / trees are close enough to draw)
        if (cam && (!this._parkAt || this._parkAt.distanceToSquared(cam) > 150 * 150)) {
            this._parkAt = (this._parkAt || new THREE.Vector3()).copy(cam);
            if (this.parkedSet) this.parkedSet.commit(cam, 2200);
            for (const set of this.nearSets || []) set.commit(cam, 2000);
            for (const im of this.townMeshes || []) {
                const sp = im.boundingSphere, far = im.userData.far;
                if (far < Infinity) im.visible = Math.hypot(sp.center.x - cam.x, sp.center.z - cam.z) - sp.radius < far;
            }
        }
        this.updatePeople(dt, cam);
        if (!this.lamps) return;
        let dirty = false;
        for (const it of this.intersections) {
            if (it.type !== 'light') continue;
            for (const h of it.heads) {
                const st = this.lightState(it, h.axis);
                if (h.state !== st) { h.state = st; this.lamps.setColor(h.idx, this.lampColors[st]); dirty = true; }
            }
        }
        if (dirty) this.lamps.refreshColors();
    }

    setNight(on) {
        if (this.lampGlow) this.lampGlow.visible = on;
        for (const m of this.buildingMats || []) m.userData.night.value = on ? 1 : 0;
        if (this.traffic) this.traffic.setNight(on);
        if (this.buildings) this.buildings.setNight(on);
        setBridgeNight(on);
    }
}

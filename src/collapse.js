// ═══════════════════════════════════════════════════════════════
// Rubble chunks: the pieces a collapsing building throws off (buildings.js) — slabs of floor, lumps of wall and small
// bits of masonry, one instanced mesh for all of them (per-instance colour: the building's own walls, dusty).
//   • spawn(...) throws one: it flies ballistically, tumbles, bounces a couple of times off the ground (losing most
//     of its speed each time) and comes to rest, where it stays until the next sortie (reset)
//   • only the pieces still moving are stepped and uploaded; the rest cost nothing but their draw
//   • when the pool is full the oldest piece is reused (a district flattened by a MOAB keeps the newest rubble)
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './util.js';

// A unit lump (about 1 m across, centred): a box with its corners knocked about, flat-shaded, light/dark vertex
// colours so a pile of them doesn't read as one flat colour. Its instances are scaled into slabs, blocks and bits.
function chunkGeometry() {
    const r = mulberry32(911);
    const parts = [];
    for (let k = 0; k < 2; k++) {
        const g = new THREE.BoxGeometry(1, 1, 1, 2, 1, 2);
        const p = g.attributes.position;
        // (the same corner shared by several faces must move the same way, or the lump opens up)
        const moved = new Map();
        for (let i = 0; i < p.count; i++) {
            const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
            let d = moved.get(key);
            if (!d) moved.set(key, d = [(r() - 0.5) * 0.3, (r() - 0.5) * 0.35, (r() - 0.5) * 0.3]);
            p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
        }
        if (k) { g.scale(0.6, 0.6, 0.6); g.rotateY(0.7); g.translate(0.25, 0.3, -0.2); } // a lump stuck on top
        parts.push(g.toNonIndexed());
    }
    for (const g of parts) {
        g.deleteAttribute('uv');
        const n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i += 3) { const v = 0.78 + r() * 0.34; for (let j = 0; j < 3; j++) { col[(i + j) * 3] = v; col[(i + j) * 3 + 1] = v * 0.98; col[(i + j) * 3 + 2] = v * 0.95; } }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const out = mergeGeometries(parts);
    out.computeVertexNormals();
    return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _w = new THREE.Vector3();

export class Chunks {
    constructor(parent, max = 3000) {
        this.max = max;
        this.mesh = new THREE.InstancedMesh(chunkGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), max);
        this.mesh.count = 0;
        this.mesh.castShadow = true; this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
        parent.add(this.mesh);
        // state (struct of arrays): position, velocity, orientation, spin (rad/s, world axes), size, ground, bounces
        this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
        this.q = new Float32Array(max * 4); this.w = new Float32Array(max * 3);
        this.s = new Float32Array(max * 3); this.g = new Float32Array(max);
        this.bounce = new Uint8Array(max);
        this.flying = [];       // indices still moving
        this.isFlying = new Uint8Array(max);
        this.next = 0;          // the slot the next spawn takes (oldest first once the pool is full)
        this.onBounce = null;   // (x, y, z, size, speed): a hard landing (buildings.js puffs dust)
    }

    // Throw a piece from (x, y, z) at (vx, vy, vz) m/s: sx × sy × sz metres, colour (r, g, b), coming to rest on the
    // ground at height `ground`, tumbling at up to `spin` rad/s
    spawn(x, y, z, vx, vy, vz, sx, sy, sz, r, g, b, ground, spin = 3) {
        const i = this.next;
        this.next = (this.next + 1) % this.max;
        if (this.mesh.count < this.max) this.mesh.count = Math.max(this.mesh.count, i + 1);
        const i3 = i * 3, i4 = i * 4;
        this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
        this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
        _q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        this.q[i4] = _q.x; this.q[i4 + 1] = _q.y; this.q[i4 + 2] = _q.z; this.q[i4 + 3] = _q.w;
        // bigger pieces turn over more slowly
        const k = spin / Math.max(1, Math.cbrt(sx * sy * sz));
        this.w[i3] = (Math.random() - 0.5) * 2 * k; this.w[i3 + 1] = (Math.random() - 0.5) * 2 * k; this.w[i3 + 2] = (Math.random() - 0.5) * 2 * k;
        this.s[i3] = sx; this.s[i3 + 1] = sy; this.s[i3 + 2] = sz;
        this.g[i] = ground;
        this.bounce[i] = 0;
        this.mesh.setColorAt(i, _c.setRGB(r, g, b));
        this.mesh.instanceColor.needsUpdate = true;
        if (!this.isFlying[i]) { this.isFlying[i] = 1; this.flying.push(i); }
        this.write(i);
    }

    write(i) {
        const i3 = i * 3, i4 = i * 4;
        _q.set(this.q[i4], this.q[i4 + 1], this.q[i4 + 2], this.q[i4 + 3]);
        this.mesh.setMatrixAt(i, _m.compose(_p.set(this.p[i3], this.p[i3 + 1], this.p[i3 + 2]), _q, _s.set(this.s[i3], this.s[i3 + 1], this.s[i3 + 2])));
    }

    update(dt) {
        const F = this.flying;
        if (!F.length) return;
        const P = this.p, V = this.v, Q = this.q, W = this.w, S = this.s;
        const drag = Math.exp(-0.04 * dt);
        for (let n = F.length - 1; n >= 0; n--) {
            const i = F[n], i3 = i * 3, i4 = i * 4;
            V[i3 + 1] -= 9.81 * dt;
            V[i3] *= drag; V[i3 + 1] *= drag; V[i3 + 2] *= drag;
            P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
            // turn by the spin: q ← exp(½ w dt) q
            _w.set(W[i3], W[i3 + 1], W[i3 + 2]);
            const a = _w.length() * dt;
            _q.set(Q[i4], Q[i4 + 1], Q[i4 + 2], Q[i4 + 3]);
            if (a > 1e-5) { _q2.setFromAxisAngle(_w.normalize(), a); _q.premultiply(_q2); }
            Q[i4] = _q.x; Q[i4 + 1] = _q.y; Q[i4 + 2] = _q.z; Q[i4 + 3] = _q.w;
            // (rests on about its thinnest half-size: a slab lies low, a block stands taller)
            const hs = Math.min(S[i3], S[i3 + 1], S[i3 + 2]) * 0.45;
            const floor = this.g[i] + hs;
            if (P[i3 + 1] < floor) {
                P[i3 + 1] = floor;
                const vy = -V[i3 + 1], vh = Math.hypot(V[i3], V[i3 + 2]);
                if (vy > 2.5 && this.bounce[i] < 3) {
                    this.bounce[i]++;
                    if (this.onBounce && this.bounce[i] === 1) this.onBounce(P[i3], floor, P[i3 + 2], Math.max(S[i3], S[i3 + 1], S[i3 + 2]), vy + vh);
                    V[i3 + 1] = vy * 0.22; V[i3] *= 0.5; V[i3 + 2] *= 0.5;
                    W[i3] *= 0.5; W[i3 + 1] *= 0.5; W[i3 + 2] *= 0.5;
                } else if (vh > 1.5) {
                    // sliding: friction takes the speed off, it rolls over less and less
                    V[i3 + 1] = 0;
                    const f = Math.max(0, 1 - 6 * dt / Math.max(vh, 0.1));
                    V[i3] *= f; V[i3 + 2] *= f;
                    W[i3] *= 0.9; W[i3 + 1] *= 0.9; W[i3 + 2] *= 0.9;
                } else {
                    // at rest: stops being stepped
                    V[i3] = V[i3 + 1] = V[i3 + 2] = 0;
                    this.write(i);
                    this.isFlying[i] = 0;
                    F[n] = F[F.length - 1]; F.pop();
                    continue;
                }
            }
            this.write(i);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    // moving pieces (tests, the frame budget)
    get active() { return this.flying.length; }

    reset() {
        this.flying.length = 0;
        this.isFlying.fill(0);
        this.next = 0;
        this.mesh.count = 0;
    }
}

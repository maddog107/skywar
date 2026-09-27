// ═══════════════════════════════════════════════════════════════
// Mobile forces, the ground (forces.js): where ground units can drive, and where they hide, fire and set up.
//  • RoadNet — the road network (towns.js roads and town streets, joined at junctions and where a road leaves a
//    street) as a graph: the shortest drive between two points on it (Dijkstra), round bridges that are down
//  • Route — a drivable polyline: road stretches in the right-hand lane (the road's own height, banking and
//    bridge decks) and legs across country (terrain heights), with a speed limit at every point from the bends
//    ahead (lateral grip), the grade (a loaded truck crawls up a hill) and room to brake
//  • sites — where a TEL hides (the edge of a forest, the floor of a valley, under a bridge's span, beside a
//    highway), the open, level ground it fires from, a SAM battery's hilltop, a compound's yard
// Plain numbers and injected functions (an `env`: heightAt, sideAt, forest, blocked, …), so it all runs headless
// (tests/forces.test.mjs).
// ═══════════════════════════════════════════════════════════════
import { fbm, smoothstep, clamp } from './noise.js';

export const LANE_ROAD = 3.3, LANE_STREET = 2.3;
const OFF_STEP = 20;          // m between samples on a leg across country

// Forest density 0..1 exactly as the trees are planted (world.js treesJob) and the ground is painted (colorAt)
export function forestDensity(x, z) { return smoothstep(0.03, 0.22, fbm(x * 0.0006 + 40, z * 0.0006 - 12, 3)); }

// Largest height difference across ±d (m per m): 0 flat … 0.1 a steep road … 0.5 a hillside a truck won't take
export function slopeAt(heightAt, x, z, d = 15, h0 = heightAt(x, z)) {
    let m = 0;
    for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + 0.4, h = heightAt(x + Math.cos(a) * d, z + Math.sin(a) * d);
        m = Math.max(m, Math.abs(h - h0));
    }
    return m / d;
}

// ═════════════ The road network ═════════════
// paths: towns.paths and towns.streetPaths ({ pts: [{x, y, z, g, s}], len, bridges: [{ bridge, s0, s1 }], links,
// street }); junctions: towns.junctions ({ x, z, arms: [{ path, s }] })
export class RoadNet {
    constructor(paths, junctions = []) {
        this.paths = (paths || []).filter(p => p && p.pts && p.pts.length >= 2 && p.len > 1);
        this.pi = new Map(this.paths.map((p, i) => [p, i]));
        const P = this.paths.length;
        const st = Array.from({ length: P }, (_, i) => [0, this.paths[i].len]);
        const joins = [];
        const join = (pa, sa, pb, sb, cost = 12) => {
            const a = this.pi.get(pa), b = this.pi.get(pb);
            if (a === undefined || b === undefined) return;
            st[a].push(sa); st[b].push(sb);
            joins.push([a, sa, b, sb, cost]);
        };
        // every arm of a junction meets every other
        for (const J of junctions || []) {
            const arms = (J.arms || []).filter(a => a.path && this.pi.has(a.path));
            for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
                if (arms[i].path === arms[j].path && Math.abs(arms[i].s - arms[j].s) < 1) continue;
                join(arms[i].path, clamp(arms[i].s, 0, arms[i].path.len), arms[j].path, clamp(arms[j].s, 0, arms[j].path.len));
            }
        }
        // a road's end joins the street it leaves from (traffic.js links, or the port it was built from)
        for (const p of this.paths) for (let e = 0; e < 2; e++) {
            const L = p.links && p.links[e];
            if (L && L.path && this.pi.has(L.path)) { join(p, e ? p.len : 0, L.path, L.end ? L.path.len : 0, 4); continue; }
            const port = e ? p.endPort : p.startPort;
            if (port && port.path && this.pi.has(port.path)) join(p, e ? p.len : 0, port.path, port.end ? port.path.len : 0, 4);
        }
        // path ends that meet another path's end without a link (two roads out of one gate): join them
        const ends = [];
        for (let i = 0; i < P; i++) { const p = this.paths[i]; ends.push([i, 0, p.pts[0]], [i, p.len, p.pts[p.pts.length - 1]]); }
        for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) {
            const A = ends[a], B = ends[b];
            if (A[0] === B[0]) continue;
            const d = Math.hypot(A[2].x - B[2].x, A[2].z - B[2].z);
            if (d < 30) join(this.paths[A[0]], A[1], this.paths[B[0]], B[1], d + 4);
        }
        // nodes: each path's stations (sorted, merged within 1 m)
        this.nodeP = []; this.nodeS = [];
        this.stations = st.map((list, i) => {
            list.sort((a, b) => a - b);
            const out = [];
            for (const s of list) if (!out.length || s - out[out.length - 1].s > 1) { out.push({ s, node: this.nodeP.length }); this.nodeP.push(i); this.nodeS.push(s); }
            return out;
        });
        const N = this.nodeP.length;
        this.adj = Array.from({ length: N }, () => []);
        // along each path, between consecutive stations (streets cost more: slower, through town)
        for (let i = 0; i < P; i++) {
            const S = this.stations[i], k = this.paths[i].street ? 1.6 : 1;
            for (let j = 0; j + 1 < S.length; j++) {
                const a = S[j], b = S[j + 1], c = (b.s - a.s) * k;
                const e = { a: a.node, b: b.node, cost: c, path: i, s0: a.s, s1: b.s };
                this.adj[a.node].push({ to: b.node, e }); this.adj[b.node].push({ to: a.node, e });
            }
        }
        for (const [a, sa, b, sb, cost] of joins) {
            const na = this.nodeAt(a, sa), nb = this.nodeAt(b, sb);
            if (na === nb) continue;
            const e = { a: na, b: nb, cost, join: true };
            this.adj[na].push({ to: nb, e }); this.adj[nb].push({ to: na, e });
        }
        // spatial index of the roads (not the streets: nobody drives off a town street into the fields)
        this.CELL = 400;
        this.grid = new Map();
        for (let i = 0; i < P; i++) {
            const p = this.paths[i];
            if (p.street) continue;
            for (let k = 0; k + 1 < p.pts.length; k++) {
                const a = p.pts[k], b = p.pts[k + 1];
                const cx0 = Math.floor(Math.min(a.x, b.x) / this.CELL), cx1 = Math.floor(Math.max(a.x, b.x) / this.CELL);
                const cz0 = Math.floor(Math.min(a.z, b.z) / this.CELL), cz1 = Math.floor(Math.max(a.z, b.z) / this.CELL);
                for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
                    const key = cx * 100003 + cz;
                    let l = this.grid.get(key);
                    if (!l) this.grid.set(key, l = []);
                    l.push(i, k);
                }
            }
        }
    }

    get nodeCount() { return this.nodeP.length; }

    // the node for station s on path index i (nearest station)
    nodeAt(i, s) {
        const S = this.stations[i];
        let best = S[0], bd = Infinity;
        for (const q of S) { const d = Math.abs(q.s - s); if (d < bd) { bd = d; best = q; } }
        return best.node;
    }

    // Nearest point on a road (not a street) to (x, z) within maxD: { path, s, x, z, d } or null
    nearest(x, z, maxD = 3000, accept = null) {
        const C = this.CELL, cx = Math.floor(x / C), cz = Math.floor(z / C);
        let best = null, bd = maxD * maxD;
        const R = Math.ceil(maxD / C);
        for (let ring = 0; ring <= R; ring++) {
            if (best && (ring - 1) * C > Math.sqrt(bd)) break;
            for (let ix = cx - ring; ix <= cx + ring; ix++) for (let iz = cz - ring; iz <= cz + ring; iz++) {
                if (Math.max(Math.abs(ix - cx), Math.abs(iz - cz)) !== ring) continue;
                const l = this.grid.get(ix * 100003 + iz);
                if (!l) continue;
                for (let q = 0; q < l.length; q += 2) {
                    const p = this.paths[l[q]], k = l[q + 1], a = p.pts[k], b = p.pts[k + 1];
                    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
                    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
                    const px = a.x + dx * t, pz = a.z + dz * t, d2 = (px - x) ** 2 + (pz - z) ** 2;
                    if (d2 >= bd) continue;
                    const s = a.s + (b.s - a.s) * t;
                    if (accept && !accept(p, s, px, pz)) continue;
                    bd = d2; best = { path: p, s, x: px, z: pz, d: Math.sqrt(d2) };
                }
            }
        }
        return best;
    }

    // is the stretch s0..s1 of path i passable (no bridge down on it)?
    passable(i, s0, s1) {
        const p = this.paths[i];
        if (!p.bridges || !p.bridges.length) return true;
        const a = Math.min(s0, s1), b = Math.max(s0, s1);
        for (const br of p.bridges) if (br.bridge && br.bridge.alive === false && br.s1 > a && br.s0 < b) return false;
        return true;
    }

    // Shortest drive from anchor A to anchor B ({ path, s } on the network): [{ path, s0, s1 }] legs, or null
    route(A, B, avoid = null) {
        const ia = this.pi.get(A.path), ib = this.pi.get(B.path);
        if (ia === undefined || ib === undefined) return null;
        const N = this.nodeP.length;
        const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), via = new Array(N);
        const heap = new MinHeap();
        // leave A toward either neighbouring station
        const [la, ua] = this.around(ia, A.s);
        const startCost = (st) => (this.passable(ia, A.s, st.s) ? Math.abs(st.s - A.s) * (this.paths[ia].street ? 1.6 : 1) : Infinity);
        for (const st of [la, ua]) { const c = startCost(st); if (c < dist[st.node]) { dist[st.node] = c; heap.push(st.node, c); } }
        const [lb, ub] = this.around(ib, B.s);
        const goal = new Map();
        for (const st of [lb, ub]) if (this.passable(ib, st.s, B.s)) goal.set(st.node, Math.abs(B.s - st.s) * (this.paths[ib].street ? 1.6 : 1));
        let best = Infinity, bestEnd = -1;
        // the same road: straight along it (the search below may still find a shorter way round)
        if (ia === ib && this.passable(ia, A.s, B.s)) { best = Math.abs(B.s - A.s) * (this.paths[ia].street ? 1.6 : 1); bestEnd = -2; }
        while (heap.size) {
            const [n, d] = heap.pop();
            if (d > dist[n]) continue;
            if (d >= best) break;
            if (goal.has(n) && d + goal.get(n) < best) { best = d + goal.get(n); bestEnd = n; }
            for (const { to, e } of this.adj[n]) {
                if (e.path !== undefined && !this.passable(e.path, e.s0, e.s1)) continue;
                if (avoid && avoid(e)) continue;
                const nd = d + e.cost;
                if (nd < dist[to]) { dist[to] = nd; prev[to] = n; via[to] = e; heap.push(to, nd); }
            }
        }
        if (bestEnd === -1) return null;
        if (bestEnd === -2) return [{ path: A.path, s0: A.s, s1: B.s }];
        // the chain of nodes back to the start
        const chain = [];
        for (let n = bestEnd; n !== -1; n = prev[n]) chain.push(n);
        chain.reverse();
        const legs = [];
        const push = (path, s0, s1) => {
            if (Math.abs(s1 - s0) < 0.5) return;
            const last = legs[legs.length - 1];
            if (last && last.path === path && Math.abs(last.s1 - s0) < 0.5 && Math.sign(last.s1 - last.s0) === Math.sign(s1 - s0)) { last.s1 = s1; return; }
            legs.push({ path, s0, s1 });
        };
        const n0 = chain[0];
        push(A.path, A.s, this.nodeS[n0]);
        for (let k = 1; k < chain.length; k++) {
            const e = via[chain[k]];
            if (!e.join) push(this.paths[e.path], this.nodeS[chain[k - 1]], this.nodeS[chain[k]]);
        }
        push(B.path, this.nodeS[bestEnd], B.s);
        legs.cost = best;
        return legs;
    }

    // the stations either side of s on path i
    around(i, s) {
        const S = this.stations[i];
        let lo = S[0], hi = S[S.length - 1];
        for (const q of S) { if (q.s <= s) lo = q; if (q.s >= s) { hi = q; break; } }
        return [lo, hi];
    }

    // which nodes can be reached from anchor A (for tests / connectivity): a Set of path indices
    reachablePaths(A) {
        const i = this.pi.get(A.path);
        if (i === undefined) return new Set();
        const seen = new Set(), out = new Set([i]);
        const stack = this.stations[i].map(q => q.node);
        while (stack.length) {
            const n = stack.pop();
            if (seen.has(n)) continue;
            seen.add(n); out.add(this.nodeP[n]);
            for (const { to, e } of this.adj[n]) if (e.path === undefined || this.passable(e.path, e.s0, e.s1)) stack.push(to);
        }
        return out;
    }
}

class MinHeap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
        const K = this.k, V = this.v;
        let i = K.length;
        K.push(key); V.push(val);
        while (i > 0) { const p = (i - 1) >> 1; if (V[p] <= val) break; K[i] = K[p]; V[i] = V[p]; i = p; }
        K[i] = key; V[i] = val;
    }
    pop() {
        const K = this.k, V = this.v, top = [K[0], V[0]];
        const lk = K.pop(), lv = V.pop();
        const n = K.length;
        if (n) {
            let i = 0;
            for (;;) {
                const l = i * 2 + 1, r = l + 1;
                let m = i, mv = lv;
                if (l < n && V[l] < mv) { m = l; mv = V[l]; }
                if (r < n && V[r] < mv) { m = r; mv = V[r]; }
                if (m === i) break;
                K[i] = K[m]; V[i] = V[m]; i = m;
            }
            K[i] = lk; V[i] = lv;
        }
        return top;
    }
}

// ═════════════ Routes ═════════════
// A polyline to drive: per point x, y (ground / road / deck), z, bank (road cross-slope, + = right side up),
// flags (1 on a road, 2 on a bridge deck, 4 reversing), s (arc length) and lim (m/s: the speed this point allows)
export class Route {
    constructor() {
        this.x = []; this.y = []; this.z = []; this.g = []; this.f = []; this.s = []; this.lim = null;
        this.len = 0;
        this.legs = [];           // [{ kind: 'road' | 'off', from, to (s on this route) }]
        this.id = Route.nextId++;
    }
    get n() { return this.x.length; }
    add(x, y, z, g = 0, f = 0) {
        const n = this.x.length;
        if (n) {
            const d = Math.hypot(x - this.x[n - 1], z - this.z[n - 1]);
            if (d < 0.5) { this.f[n - 1] |= f; return; }
            this.len += d;
        }
        this.x.push(x); this.y.push(y); this.z.push(z); this.g.push(g); this.f.push(f); this.s.push(this.len);
    }
    // a stretch of road: path from s0 to s1 (either way), in the right-hand lane
    addRoad(path, s0, s1, lane = path.street ? LANE_STREET : LANE_ROAD) {
        const dir = s1 >= s0 ? 1 : -1, P = path.pts;
        const from = this.len;
        const pts = [];
        const at = (s) => {
            s = clamp(s, 0, path.len);
            let lo = 0, hi = P.length - 1;
            while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s <= s) lo = m; else hi = m; }
            const a = P[lo], b = P[hi], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
            return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, g: (a.g || 0) + ((b.g || 0) - (a.g || 0)) * t, s };
        };
        pts.push(at(s0));
        if (dir > 0) { for (const q of P) if (q.s > s0 + 0.5 && q.s < s1 - 0.5) pts.push(q); }
        else for (let k = P.length - 1; k >= 0; k--) { const q = P[k]; if (q.s < s0 - 0.5 && q.s > s1 + 0.5) pts.push(q); }
        pts.push(at(s1));
        for (let k = 0; k < pts.length; k++) {
            const q = pts[k], a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
            let tx = b.x - a.x, tz = b.z - a.z;
            const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
            // right of the direction of travel (roads.js: right = (-tz, tx))
            const rx = -tz, rz = tx;
            let deck = false;
            for (const br of path.bridges || []) if (q.s >= br.s0 - 0.01 && q.s <= br.s1 + 0.01) { deck = true; break; }
            // (the lane is up or down the road's cross-slope from the centre line: g is + right side up, on the
            // path's own right; driving it backwards, our right is its left)
            const g = (q.g || 0) * dir;
            this.add(q.x + rx * lane, q.y + (deck ? 0 : g * lane), q.z + rz * lane, g, 1 | (deck ? 2 : 0));
        }
        this.legs.push({ kind: 'road', path, from, to: this.len });
    }
    // across country to (x, z), a sample every OFF_STEP m; heightAt gives the ground
    addOff(x, z, heightAt, flags = 0) {
        const n = this.x.length;
        const x0 = n ? this.x[n - 1] : x, z0 = n ? this.z[n - 1] : z;
        const from = this.len;
        const d = Math.hypot(x - x0, z - z0), k = Math.max(1, Math.ceil(d / OFF_STEP));
        for (let i = n ? 1 : 0; i <= k; i++) {
            const px = x0 + (x - x0) * i / k, pz = z0 + (z - z0) * i / k;
            this.add(px, Math.max(heightAt(px, pz), 0), pz, 0, flags);
        }
        this.legs.push({ kind: 'off', from, to: this.len });
    }
    // the speed each point allows (m/s): the bend (lateral acceleration aLat), the grade, and braking room ahead
    limits(vmax = 22, aLat = 1.7, brake = 1.6) {
        const n = this.x.length, lim = this.lim = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            let v = vmax;
            if (i > 0 && i < n - 1) {
                // the bend across ±12 m either side (short segments on a road; one step off it)
                const a = this.back(i, 12), b = this.ahead(i, 12);
                const h1 = Math.atan2(this.x[i] - this.x[a], this.z[i] - this.z[a]), h2 = Math.atan2(this.x[b] - this.x[i], this.z[b] - this.z[i]);
                let dh = Math.abs(h2 - h1); if (dh > Math.PI) dh = Math.PI * 2 - dh;
                const span = Math.max((this.s[b] - this.s[a]) * 0.5, 1);
                const k = dh / span;
                if (k > 1e-4) v = Math.min(v, Math.sqrt(aLat / k));
            }
            if (i < n - 1) {
                const ds = Math.max(this.s[i + 1] - this.s[i], 0.5), gr = (this.y[i + 1] - this.y[i]) / ds;
                // up a grade the engine gives out (a 40 t TEL on 10 %: a crawl); down it, engine braking
                v *= gr > 0 ? clamp(1 - gr * 5.5, 0.3, 1) : clamp(1 + gr * 2.5, 0.55, 1);
            }
            if (!(this.f[i] & 1)) v = Math.min(v, 9); // (across country; the vehicle's own limit applies too)
            if (this.f[i] & 4) v = Math.min(v, 2.2); // reversing
            lim[i] = Math.max(v, 1.2);
        }
        // room to brake for what's ahead
        for (let i = n - 2; i >= 0; i--) lim[i] = Math.min(lim[i], Math.sqrt(lim[i + 1] * lim[i + 1] + 2 * brake * (this.s[i + 1] - this.s[i])));
        if (n) lim[n - 1] = Math.min(lim[n - 1], 2);
        return lim;
    }
    back(i, d) { let j = i; while (j > 0 && this.s[i] - this.s[j] < d) j--; return j; }
    ahead(i, d) { let j = i; while (j < this.x.length - 1 && this.s[j] - this.s[i] < d) j++; return j; }
    // the index of the segment holding arc length s (hint: a starting index, for callers moving along it)
    seg(s, hint = 0) {
        const S = this.s, n = S.length;
        let i = clamp(hint | 0, 0, Math.max(n - 2, 0));
        if (S[i] > s) { while (i > 0 && S[i] > s) i--; }
        else while (i < n - 2 && S[i + 1] < s) i++;
        return i;
    }
    // point at arc length s → out { x, y, z, g, f, lim, tx, tz, i }
    at(s, out, hint = 0) {
        const n = this.x.length;
        if (n === 1) { out.x = this.x[0]; out.y = this.y[0]; out.z = this.z[0]; out.g = 0; out.f = this.f[0]; out.lim = 0; out.tx = 0; out.tz = -1; out.i = 0; return out; }
        s = clamp(s, 0, this.len);
        const i = this.seg(s, hint), j = i + 1;
        const L = this.s[j] - this.s[i], t = L > 1e-6 ? (s - this.s[i]) / L : 0;
        out.x = this.x[i] + (this.x[j] - this.x[i]) * t; out.y = this.y[i] + (this.y[j] - this.y[i]) * t; out.z = this.z[i] + (this.z[j] - this.z[i]) * t;
        out.g = this.g[i] + (this.g[j] - this.g[i]) * t;
        out.f = t < 0.5 ? this.f[i] : this.f[j];
        out.lim = this.lim ? this.lim[i] + (this.lim[j] - this.lim[i]) * t : 20;
        const dx = this.x[j] - this.x[i], dz = this.z[j] - this.z[i], dl = Math.hypot(dx, dz) || 1;
        out.tx = dx / dl; out.tz = dz / dl; out.i = i;
        return out;
    }
    // the road paths it uses (to clear the traffic off them)
    roadPaths() { return [...new Set(this.legs.filter(l => l.kind === 'road').map(l => l.path))]; }
    // bridges the route crosses: [{ bridge, s0, s1 }] in route arc length
    bridgesOn() {
        const out = [];
        for (const l of this.legs) if (l.kind === 'road') for (const br of l.path.bridges || []) out.push({ bridge: br.bridge, leg: l });
        return out;
    }
}
Route.nextId = 1;

// Plan a drive from `from` to `to` ({ x, z }): straight across country when it's short and clear, else to the
// nearest road, along the network, and off it again. opts: { net, heightAt, offMax (m of cross-country allowed
// at each end, 2500), direct (m under which to drive straight, 900), clear(x0, z0, x1, z1) → true when a
// cross-country leg is drivable, vmax, aLat, brake, reverseLast (m to reverse at the end: backing into a shelter),
// lane }. Returns a Route, or null.
export function planRoute(from, to, o) {
    const r = new Route();
    const H = o.heightAt;
    const clear = o.clear || (() => true);
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    const finish = () => {
        if (o.reverseLast && r.n >= 2) markReverse(r, o.reverseLast);
        r.limits(o.vmax ?? 22, o.aLat ?? 1.7, o.brake ?? 1.6);
        return r;
    };
    r.add(from.x, Math.max(H(from.x, from.z), 0), from.z, 0, 0);
    // no roads at all, or a short hop over clear ground: straight there
    if (!o.net || (d < (o.direct ?? 900) && clear(from.x, from.z, to.x, to.z))) { r.addOff(to.x, to.z, H); return finish(); }
    const net = o.net;
    const offMax = o.offMax ?? 2500;
    const A = net.nearest(from.x, from.z, offMax), B = net.nearest(to.x, to.z, offMax);
    if (!A || !B) {
        if (d < offMax * 2 && clear(from.x, from.z, to.x, to.z)) { r.addOff(to.x, to.z, H); return finish(); }
        return null;
    }
    const legs = net.route(A, B, o.avoid);
    if (!legs) {
        if (d < offMax * 2 && clear(from.x, from.z, to.x, to.z)) { r.addOff(to.x, to.z, H); return finish(); }
        return null;
    }
    // a road trip that goes far out of the way for a short hop: across country instead
    if (legs.cost > d * 3.5 + 1500 && d < offMax * 1.6 && clear(from.x, from.z, to.x, to.z)) { r.addOff(to.x, to.z, H); return finish(); }
    if (A.d > 6) r.addOff(A.x, A.z, H);
    for (const l of legs) r.addRoad(l.path, l.s0, l.s1, o.lane);
    if (B.d > 6) r.addOff(to.x, to.z, H);
    else r.addOff(to.x, to.z, H, 1);
    return finish();
}

// the last `m` metres are driven in reverse (the vehicle faces back along the route)
function markReverse(r, m) {
    for (let i = r.n - 1; i >= 0 && r.len - r.s[i] <= m; i--) r.f[i] |= 4;
}

// a Route through given points (all across country), e.g. round a site
export function offRoute(points, heightAt, vmax = 9) {
    const r = new Route();
    r.add(points[0].x, Math.max(heightAt(points[0].x, points[0].z), 0), points[0].z);
    for (let k = 1; k < points.length; k++) r.addOff(points[k].x, points[k].z, heightAt, points[k].flags || 0);
    r.limits(vmax);
    return r;
}

// Is a straight leg across country drivable? Dry land, not too steep, nothing built in the way (samples every
// 25 m). env: heightAt, blocked (buildings, fences), maxSlope
export function legClear(env, x0, z0, x1, z1, maxGrade = 0.32) {
    const d = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(d / 25));
    let prev = env.heightAt(x0, z0);
    for (let i = 1; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, z = z0 + (z1 - z0) * i / n, h = env.heightAt(x, z);
        if (h < 0.6) return false;
        if (Math.abs(h - prev) / (d / n) > maxGrade) return false;
        if (env.solid && env.solid(x, z)) return false;
        prev = h;
    }
    return true;
}

// ═════════════ Sites ═════════════
// env: { heightAt(x, z), sideAt(x, z), forest(x, z), blocked(x, z) (roads, streets, buildings), solid(x, z)
// (buildings, airbase fences: never drive through), inTown(x, z), nearBase(x, z, margin), net (RoadNet),
// bridges: [Bridge], rand() }
// Each finder returns { kind, x, z, heading (the way the vehicle should face: + = yaw, −Z forward at 0), conceal,
// clearing (m of trees to clear round it, 0 none) } or null. `near`: { x, z }; r0..r1: the ring to search.
export const HIDE_KINDS = ['forest', 'valley', 'bridge', 'roadside'];
export const CONCEAL = { forest: 0.85, valley: 0.55, bridge: 0.9, roadside: 0.45, compound: 0.8, shelter: 0.97, open: 0.3, firing: 0.15, sam: 0.25 };

const yawTo = (dx, dz) => Math.atan2(-dx, -dz); // the yaw that points −Z (a vehicle's front) along (dx, dz)

function candidate(env, near, r0, r1) {
    const a = env.rand() * Math.PI * 2, r = Math.sqrt(r0 * r0 + env.rand() * (r1 * r1 - r0 * r0));
    return { x: near.x + Math.cos(a) * r, z: near.z + Math.sin(a) * r };
}

// common ground rules: our side, dry, not in a town or a base, not on a road or in a building
function groundOK(env, team, x, z, hMin = 6, hMax = 900) {
    if (team && env.sideAt(x, z) !== team) return false;
    if (env.ok && !env.ok(x, z)) return false; // (a caller's extra rule: a band of distance from the front…)
    const h = env.heightAt(x, z);
    if (h < hMin || h > hMax) return false;
    if (env.inTown && env.inTown(x, z)) return false;
    if (env.nearBase && env.nearBase(x, z, 400)) return false;
    if (env.blocked && env.blocked(x, z)) return false;
    return true;
}

// within reach of a road (a truck has to get there): m to the nearest road, or Infinity
function roadDist(env, x, z, max) {
    if (!env.net) return 0;
    const q = env.net.nearest(x, z, max);
    return q ? q.d : Infinity;
}

// The edge of a forest: trees round the spot (density 0.5–0.9) with open ground close by to drive in from;
// the vehicle backs in, nose to the open side
// (the world is an archipelago: most random points in a ring are sea or the other side, and cost a microsecond or
// two to reject, so the finders try a few hundred)
export function forestSite(env, team, near, r0, r1, tries = 400) {
    for (let k = 0; k < tries; k++) {
        const c = candidate(env, near, r0, r1);
        if (!groundOK(env, team, c.x, c.z, 8, 950)) continue;
        const f = env.forest(c.x, c.z);
        if (f < 0.5 || f > 0.92) continue;
        // the open side: the thinnest direction 60–90 m out
        let best = -1, bf = 1;
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4, fx = c.x + Math.cos(a) * 75, fz = c.z + Math.sin(a) * 75;
            const ff = env.forest(fx, fz);
            if (ff < bf) { bf = ff; best = a; }
        }
        if (bf > 0.3) continue;
        if (slopeAt(env.heightAt, c.x, c.z, 12) > 0.14) continue;
        if (roadDist(env, c.x, c.z, 2500) > 2500) continue;
        const ox = Math.cos(best), oz = Math.sin(best);
        return { kind: 'forest', x: c.x, z: c.z, heading: yawTo(ox, oz), conceal: CONCEAL.forest, clearing: 9, approach: { x: c.x + ox * 70, z: c.z + oz * 70 } };
    }
    return null;
}

// The floor of a valley: the ground rises 45 m or more on most sides within 600 m (hidden from radars and from
// anyone not right above it)
export function valleySite(env, team, near, r0, r1, tries = 400) {
    for (let k = 0; k < tries; k++) {
        const c = candidate(env, near, r0, r1);
        if (!groundOK(env, team, c.x, c.z, 6, 800)) continue;
        const h = env.heightAt(c.x, c.z);
        let up = 0;
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; if (env.heightAt(c.x + Math.cos(a) * 550, c.z + Math.sin(a) * 550) - h > 35) up++; }
        if (up < 5) continue;
        if (slopeAt(env.heightAt, c.x, c.z, 15, h) > 0.1) continue;
        if (roadDist(env, c.x, c.z, 3000) > 3000) continue;
        return { kind: 'valley', x: c.x, z: c.z, heading: env.rand() * Math.PI * 2, conceal: CONCEAL.valley, clearing: env.forest(c.x, c.z) > 0.2 ? 9 : 0 };
    }
    return null;
}

// Under a bridge's span where the bank is dry and the deck high enough over it for a TEL (girders 3.3 m under the
// road, a 3.6 m truck, a metre spare)
export function bridgeSites(env, team) {
    const out = [];
    for (const b of env.bridges || []) {
        if (!b || b.alive === false || !b.a || !b.b) continue;
        for (const end of [0, 1]) {
            for (let s = 14; s <= Math.min(90, b.len * 0.45); s += 4) {
                const t = end ? 1 - s / b.len : s / b.len;
                const x = b.a.x + (b.b.x - b.a.x) * t, z = b.a.z + (b.b.z - b.a.z) * t;
                if (team && env.sideAt(x, z) !== team) break;
                const h = env.heightAt(x, z);
                if (h < 1.4) break;
                const deck = b.deckY ? b.deckY(t) : Math.max(b.a.y, b.b.y);
                if (deck - 3.3 - h < 4.8) continue;
                if (slopeAt(env.heightAt, x, z, 8, h) > 0.12) continue;
                const dx = b.b.x - b.a.x, dz = b.b.z - b.a.z;
                out.push({ kind: 'bridge', x, z, heading: yawTo(end ? dx : -dx, end ? dz : -dz), conceal: CONCEAL.bridge, clearing: 0, bridge: b });
                break;
            }
        }
    }
    return out;
}

// Beside a highway (a lay-by, a field edge 30–45 m off the road)
export function roadsideSite(env, team, near, r0, r1, tries = 120) {
    if (!env.net) return null;
    for (let k = 0; k < tries; k++) {
        const c = candidate(env, near, r0, r1);
        const q = env.net.nearest(c.x, c.z, 1500);
        if (!q) continue;
        const P = q.path.pts;
        let i = 0;
        while (i < P.length - 2 && P[i + 1].s < q.s) i++;
        const tx = P[i + 1].x - P[i].x, tz = P[i + 1].z - P[i].z, L = Math.hypot(tx, tz) || 1;
        const side = env.rand() < 0.5 ? 1 : -1, off = 30 + env.rand() * 15;
        const x = q.x - tz / L * off * side, z = q.z + tx / L * off * side;
        if (!groundOK(env, team, x, z, 5, 850)) continue;
        if (slopeAt(env.heightAt, x, z, 10) > 0.1) continue;
        return { kind: 'roadside', x, z, heading: yawTo(tx * side, tz * side) + Math.PI / 2 * side, conceal: CONCEAL.roadside + env.forest(x, z) * 0.3, clearing: env.forest(x, z) > 0.3 ? 8 : 0 };
    }
    return null;
}

// Open, level ground to fire from: nothing overhead, the missile stands 14 m tall; near a road
export function firingSite(env, team, near, r0, r1, tries = 400) {
    for (let k = 0; k < tries; k++) {
        const c = candidate(env, near, r0, r1);
        if (!groundOK(env, team, c.x, c.z, 5, 750)) continue;
        if (env.forest(c.x, c.z) > 0.12) continue;
        if (slopeAt(env.heightAt, c.x, c.z, 20) > 0.07) continue;
        if (roadDist(env, c.x, c.z, 900) > 900) continue;
        return { kind: 'firing', x: c.x, z: c.z, heading: env.rand() * Math.PI * 2, conceal: CONCEAL.firing, clearing: 16 };
    }
    return null;
}

// A SAM battery's position: open, level, high ground for the radar horizon (the best of a few)
export function samSite(env, team, near, r0, r1, tries = 240, avoid = []) {
    let best = null, bs = -Infinity;
    for (let k = 0; k < tries; k++) {
        const c = candidate(env, near, r0, r1);
        if (!groundOK(env, team, c.x, c.z, 5, 1100)) continue;
        if (avoid.some(p => Math.hypot(p.x - c.x, p.z - c.z) < 2500)) continue;
        if (env.forest(c.x, c.z) > 0.3) continue;
        const h = env.heightAt(c.x, c.z);
        if (slopeAt(env.heightAt, c.x, c.z, 25, h) > 0.08) continue;
        if (roadDist(env, c.x, c.z, 2000) > 2000) continue;
        let ring = 0;
        for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; ring += env.heightAt(c.x + Math.cos(a) * 900, c.z + Math.sin(a) * 900); }
        const score = h - ring / 6 + env.rand() * 30; // above its surroundings, give or take
        if (score > bs) { bs = score; best = { kind: 'sam', x: c.x, z: c.z, heading: env.rand() * Math.PI * 2, conceal: CONCEAL.sam, clearing: 30 }; }
    }
    return best;
}

// Level ground for a compound (sheds and camouflage nets) 120–500 m off a road
export function compoundSite(env, team, near, r0, r1, tries = 400) {
    for (let k = 0; k < tries; k++) {
        const c = candidate(env, near, r0, r1);
        if (!groundOK(env, team, c.x, c.z, 6, 700)) continue;
        if (env.forest(c.x, c.z) > 0.5) continue;
        if (slopeAt(env.heightAt, c.x, c.z, 35) > 0.05) continue;
        const rd = roadDist(env, c.x, c.z, 700);
        if (rd < 120 || rd > 700) continue;
        return { kind: 'compound', x: c.x, z: c.z, heading: env.rand() * Math.PI * 2, conceal: CONCEAL.compound, clearing: 48 };
    }
    return null;
}

// A hardened shelter: level ground at the foot of rising ground (the shelter is dug into it), near a road
export function shelterSite(env, team, near, r0, r1, tries = 400) {
    for (let k = 0; k < tries; k++) {
        const c = candidate(env, near, r0, r1);
        if (!groundOK(env, team, c.x, c.z, 6, 800)) continue;
        const h = env.heightAt(c.x, c.z);
        if (slopeAt(env.heightAt, c.x, c.z, 18, h) > 0.06) continue;
        // the hill behind: the steepest rise 80 m out
        let best = 0, ba = 0;
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = env.heightAt(c.x + Math.cos(a) * 80, c.z + Math.sin(a) * 80) - h; if (r > best) { best = r; ba = a; } }
        if (best < 6) continue;
        if (roadDist(env, c.x, c.z, 1500) > 1500) continue;
        // the door faces away from the hill
        return { kind: 'shelter', x: c.x, z: c.z, heading: yawTo(-Math.cos(ba), -Math.sin(ba)), conceal: CONCEAL.shelter, clearing: 30 };
    }
    return null;
}

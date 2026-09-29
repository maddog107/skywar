// ═══════════════════════════════════════════════════════════════
// Airbase logic without rendering (docs/WAR.md, "Airbases"): what bases.js runs and the tests check headless.
//  • AlertFSM — NORMAL → ALERT → ATTACK → DAMAGED, from threats seen, blasts on the field and damage
//  • CraterField — craters on a field's pavement (runways, taxiways, aprons): the longest clear strip of each
//    runway (the NATO "minimum operating strip", MOS: 15 m wide, here 1200 m long for fighters), which taxi
//    edges they block, and the rapid runway repair (RADR / ADR) that fills them: debris clearance, backfill,
//    cap (a fibre-reinforced FOD cover or rapid-set concrete) — the order chosen to reopen the runway soonest
//  • RepairCrews — the teams (loader, dump truck, crew truck) driving out from the equipment yard and working
//  • TaxiGraph — shortest taxi routes that avoid cratered pavement
//  • Airwing — the jets on the field: the two on quick reaction alert, the ones in shelters, turnarounds (slower
//    without fuel or munitions), destroyed with their shelter
//  • scrambleTimeline — horn to wheels-up for an alert pair, longer without the tower or power
// All positions are base-local metres (baselayout.js), times in seconds.
// ═══════════════════════════════════════════════════════════════
import { runwayFrames, toRunway, segDist, pavedAt } from './baselayout.js';

export const ALERT = { NORMAL: 0, ALERT: 1, ATTACK: 2, DAMAGED: 3 };
export const ALERT_NAMES = ['NORMAL', 'ALERT', 'ATTACK', 'DAMAGED'];
export const MOS_WIDTH = 15, MOS_LENGTH = 1200;   // minimum operating strip for fighters (m)
const LIP = 1.45;                                  // upheaved pavement reaches this many hole radii
const CLEAR = 1.5;                                 // m of margin a wheel needs past the broken edge

// ═════════════ Alert state machine ═════════════
// Inputs: threat(level) — 1: a hostile aircraft (or missile) detected heading for / near the field, 2: one close
// in on an attack run; impact() — a blast on the field; damaged — unrepaired damage. The state is the most urgent
// that applies, held for a while so it doesn't flicker: ATTACK while blasts or close threats were within
// ATTACK_HOLD, ALERT while threats within ALERT_HOLD, then DAMAGED if anything's still broken, else NORMAL.
export const ALERT_HOLD = 90, ATTACK_HOLD = 40, MIN_DWELL = [0, 25, 20, 0];
export class AlertFSM {
    constructor(t = 0) {
        this.state = ALERT.NORMAL;
        this.since = t;
        this.threatT = -1e9; this.attackT = -1e9;
        this.damaged = false;
        this.history = [];
    }
    threat(level, t) {
        if (level >= 1) this.threatT = t;
        if (level >= 2) this.attackT = Math.max(this.attackT, t - ATTACK_HOLD * 0.5); // close threat: hold ATTACK a little
        if (level >= 3) this.attackT = t;
    }
    impact(t) { this.attackT = t; this.threatT = t; }
    // the state that applies now (without the dwell)
    wanted(t) {
        if (t - this.attackT < ATTACK_HOLD) return ALERT.ATTACK;
        if (t - this.threatT < ALERT_HOLD) return ALERT.ALERT;
        return this.damaged ? ALERT.DAMAGED : ALERT.NORMAL;
    }
    // returns { from, to } when the state changed, else null
    update(t) {
        const want = this.wanted(t);
        if (want === this.state) return null;
        // escalations are immediate; stepping down waits out the minimum dwell
        const up = rank(want) > rank(this.state);
        if (!up && t - this.since < MIN_DWELL[this.state]) return null;
        const from = this.state;
        this.state = want; this.since = t;
        this.history.push({ t, from, to: want });
        if (this.history.length > 20) this.history.shift();
        return { from, to: want };
    }
    get name() { return ALERT_NAMES[this.state]; }
}
// urgency order: ATTACK > ALERT > DAMAGED > NORMAL
const rank = (s) => (s === ALERT.ATTACK ? 3 : s === ALERT.ALERT ? 2 : s === ALERT.DAMAGED ? 1 : 0);

// ═════════════ Craters on the pavement ═════════════
// Repair stages (s for a 500 lb bomb crater, r ≈ 4.5 m; bigger ones take longer): clearance of the upheaval and
// debris by the loader, backfill (crushed stone from the dump truck, compacted), the cap
export const REPAIR = { clearing: 50, filling: 70, capping: 40 };
const STAGES = ['open', 'clearing', 'filling', 'capping', 'repaired'];

export class CraterField {
    // base: a BASES entry; paved: the field's paved rects (base-local), besides its runways
    constructor(base, paved = []) {
        this.base = base;
        this.frames = runwayFrames(base);
        this.paved = paved || [];
        this.craters = [];
        this.nextId = 1;
        this.version = 0;     // bumped whenever the pavement changes (views and route caches re-check)
        this._r = {};
    }

    // which surface (lx, lz) is on: { kind: 'runway', rw } | { kind: 'taxiway' | 'apron' } | null
    surfaceAt(lx, lz, pad = 0) {
        for (const F of this.frames) {
            toRunway(F, lx, lz, this._r);
            if (Math.abs(this._r.u) <= F.hw + pad && Math.abs(this._r.v) <= F.half + pad) return { kind: 'runway', rw: F.i };
        }
        const p = pavedAt(this.paved, lx, lz, pad);
        return p ? { kind: p.kind, rw: -1 } : null;
    }

    // A blast on the pavement at (lx, lz) digging a hole of radius r (m): a new crater, a bigger old one it tore
    // into again, or null when it's not on the pavement. opts: { depth, t, kind, seed }
    add(lx, lz, r, opts = {}) {
        const s = this.surfaceAt(lx, lz, r * 0.5);
        if (!s) return null;
        // a blast in (or right by) an unrepaired crater makes that one bigger instead
        for (const c of this.craters) {
            if (c.stage === 'repaired') continue;
            const d = Math.hypot(c.lx - lx, c.lz - lz);
            if (d < (c.r + r) * 0.75) {
                const R = Math.max(c.r, r) + Math.min(c.r, r) * 0.35;
                c.lx = (c.lx * c.r + lx * r) / (c.r + r); c.lz = (c.lz * c.r + lz * r) / (c.r + r);
                c.r = Math.min(R, 14); c.depth = Math.max(c.depth, opts.depth ?? r * 0.45);
                if (c.stage !== 'open') { c.stage = 'open'; c.work = 0; c.fill = 0; } // the repair starts over
                c.debris = 1;
                this.locate(c);
                this.version++;
                return c;
            }
        }
        const c = {
            id: this.nextId++, lx, lz, r, depth: opts.depth ?? Math.min(3.2, r * 0.45), kind: opts.kind || 'bomb',
            seed: opts.seed ?? ((this.nextId * 0.6180339887) % 1) * 6.2832, t: opts.t ?? 0,
            surface: s.kind, rw: s.rw, u: 0, v: 0,
            stage: 'open', work: 0, fill: 0, debris: 1, crew: null,
        };
        this.locate(c);
        this.craters.push(c);
        this.version++;
        return c;
    }

    // where a crater sits on its runway (u across, v along), and which runway
    locate(c) {
        c.rw = -1;
        for (const F of this.frames) {
            toRunway(F, c.lx, c.lz, this._r);
            if (Math.abs(this._r.u) <= F.hw + c.r * LIP && Math.abs(this._r.v) <= F.half + c.r * LIP) { c.rw = F.i; c.u = this._r.u; c.v = this._r.v; break; }
        }
        if (c.surface === 'runway' && c.rw < 0) c.surface = 'taxiway';
    }

    get unrepaired() { return this.craters.filter(c => c.stage !== 'repaired'); }
    // the half-width of pavement a crater takes out of use: the hole, its broken lip, and wheel clearance
    reach(c) { return c.r * LIP + CLEAR; }

    // The longest straight, 15 m wide strip of runway i clear of unrepaired craters (MOS), and its lane:
    // { mos (m), lane: [u0, u1] | null, v0, v1, craters: n unrepaired on it }
    runwayStatus(i) {
        const F = this.frames[i];
        if (!F) return { mos: 0, lane: null, craters: 0, open: false };
        const on = this.craters.filter(c => c.rw === i && c.stage !== 'repaired');
        if (!on.length) return { mos: F.half * 2, lane: [-MOS_WIDTH / 2, MOS_WIDTH / 2], v0: -F.half, v1: F.half, craters: 0, open: true };
        let best = { mos: 0, lane: null, v0: 0, v1: 0 };
        const iv = [];
        // candidate lanes every 2.5 m across the runway
        for (let u0 = -F.hw; u0 + MOS_WIDTH <= F.hw + 1e-6; u0 += 2.5) {
            const u1 = u0 + MOS_WIDTH;
            iv.length = 0;
            for (const c of on) {
                const R = this.reach(c);
                if (c.u + R <= u0 || c.u - R >= u1) continue; // beside the lane
                iv.push([c.v - R, c.v + R]);
            }
            iv.sort((a, b) => a[0] - b[0]);
            // longest gap between blocked intervals, from runway end to end
            let prev = -F.half;
            const gap = (a, b) => { if (b - a > best.mos) best = { mos: b - a, lane: [u0, u1], v0: a, v1: b }; };
            for (const [a, b] of iv) { if (a > prev) gap(prev, Math.min(a, F.half)); prev = Math.max(prev, b); }
            if (prev < F.half) gap(prev, F.half);
        }
        best.craters = on.length;
        best.open = best.mos >= MOS_LENGTH;
        return best;
    }

    usable(i) { return this.runwayStatus(i).open; }
    anyRunwayOpen() { return this.frames.some(F => this.usable(F.i)); }

    // does an unrepaired crater cut the paved band a–b (width w, base-local)? A jet needs NEED m of it clear.
    blocksSegment(ax, az, bx, bz, w, need = 12) {
        for (const c of this.craters) {
            if (c.stage === 'repaired') continue;
            const { d, t } = segDist(ax, az, bx, bz, c.lx, c.lz);
            const R = this.reach(c);
            if (d >= w / 2 + R) continue;
            if ((t <= 0 || t >= 1) && d > R) continue; // off the end of this piece of the band (the next edge's)
            // the band spans [−w/2, w/2] across; the hole and its lip take [d − R, d + R]: what's left either side
            const near = Math.max(0, d - R + w / 2), far = Math.max(0, w / 2 - d - R);
            if (Math.max(near, far) < need) return c;
        }
        return null;
    }

    // What to repair next: the crater whose repair adds most to the best runway's MOS (reopening it first); then
    // the rest of the runway's, then the taxiways', nearest first. `busy`: craters another crew has.
    plan(fromLx, fromLz, busy = new Set()) {
        const todo = this.craters.filter(c => c.stage !== 'repaired' && !busy.has(c));
        if (!todo.length) return null;
        const runwayOpen = this.anyRunwayOpen();
        let best = null, bestScore = -Infinity;
        for (const c of todo) {
            let score = 0;
            if (c.rw >= 0 && !runwayOpen) {
                // try it repaired
                const was = c.stage;
                c.stage = 'repaired';
                score = this.runwayStatus(c.rw).mos + 2000;
                c.stage = was;
            } else if (c.rw >= 0) score = 1000 - Math.abs(c.u) * 2;
            else score = 500;
            if (c.stage !== 'open') score += 3000; // finish what was started
            score -= Math.hypot(c.lx - fromLx, c.lz - fromLz) * 0.05;
            if (score > bestScore) { bestScore = score; best = c; }
        }
        return best;
    }

    // advance a crater's repair by dt of crew work; returns true when it's done
    work(c, dt, rate = 1) {
        if (c.stage === 'repaired') return true;
        if (c.stage === 'open') { c.stage = 'clearing'; c.work = 0; }
        const k = Math.pow(Math.max(c.r, 2) / 4.5, 1.3);
        c.work += dt * rate / (REPAIR[c.stage] * k);
        if (c.stage === 'clearing') c.debris = Math.max(0, 1 - c.work);
        if (c.stage === 'filling') c.fill = Math.min(1, c.work);
        if (c.work >= 1) {
            c.stage = STAGES[STAGES.indexOf(c.stage) + 1];
            c.work = 0;
            if (c.stage === 'filling') c.debris = 0;
            if (c.stage === 'capping') c.fill = 1;
            this.version++;
            if (c.stage === 'repaired') { c.crew = null; return true; }
        }
        return false;
    }

    // a crater under (lx, lz)? (the hole or its broken lip) → the crater, or null
    at(lx, lz, pad = 0) {
        for (const c of this.craters) {
            if (c.stage === 'repaired' || c.stage === 'capping') continue;
            if (Math.hypot(c.lx - lx, c.lz - lz) < c.r * 1.2 + pad) return c;
        }
        return null;
    }
}

// ═════════════ Repair crews ═════════════
// A team drives out from the equipment yard (8 m/s, straight across the flat field), works a crater to the end,
// goes on to the next; it shelters (stops) while the field is under attack. Lost when its vehicles are.
export class RepairCrews {
    constructor(field, depot, { teams = 2, reserves = 2, speed = 8 } = {}) {
        this.field = field;
        this.depot = { lx: depot.lx, lz: depot.lz };
        this.speed = speed;
        this.reserves = reserves;
        this.crews = [];
        this.reserveT = 0;
        this.nextId = 1;
        for (let i = 0; i < teams; i++) this.addCrew(i);
    }
    addCrew(i = this.crews.length) {
        const c = { id: this.nextId++, lx: this.depot.lx + i * 14, lz: this.depot.lz, heading: 0, state: 'idle', target: null, alive: true, working: false, dist: 0 };
        this.crews.push(c);
        return c;
    }
    get active() { return this.crews.filter(c => c.alive); }
    busy() { return new Set(this.crews.filter(c => c.alive && c.target).map(c => c.target)); }

    // hold: the field is under attack (everybody takes cover); rate: work speed
    update(dt, { hold = false, rate = 1 } = {}) {
        const F = this.field;
        // a lost team is replaced from the reserve after a while
        if (this.crews.some(c => !c.alive) && this.reserves > 0 && this.crews.filter(c => c.alive).length < 2) {
            this.reserveT += dt;
            if (this.reserveT > 180) { this.reserveT = 0; this.reserves--; const dead = this.crews.find(c => !c.alive); if (dead) this.crews.splice(this.crews.indexOf(dead), 1); this.addCrew(); }
        } else this.reserveT = 0;
        for (const c of this.crews) {
            if (!c.alive) continue;
            c.working = false;
            if (c.target && c.target.stage === 'repaired') c.target = null;
            if (!c.target) {
                const next = F.plan(c.lx, c.lz, this.busy());
                if (next) { c.target = next; next.crew = c; c.state = 'driving'; }
                else if (Math.hypot(c.lx - this.depot.lx, c.lz - this.depot.lz) > 20) c.state = 'returning';
                else c.state = 'idle';
            }
            if (hold) { if (c.state === 'working') c.state = 'driving'; continue; }
            const goal = c.target ? this.workSpot(c) : c.state === 'returning' ? this.depot : null;
            if (!goal) continue;
            const dx = goal.lx - c.lx, dz = goal.lz - c.lz, d = Math.hypot(dx, dz);
            if (d > 1) {
                const step = Math.min(d, this.speed * dt);
                c.lx += dx / d * step; c.lz += dz / d * step; c.heading = Math.atan2(-dx, -dz); c.dist += step;
                c.state = c.target ? 'driving' : 'returning';
            } else if (c.target) {
                c.state = 'working'; c.working = true;
                if (F.work(c.target, dt, rate)) c.target = null;
            } else c.state = 'idle';
        }
    }
    // where the team parks to work: beside the crater, on the side toward the yard
    workSpot(c) {
        const t = c.target, dx = c.lx - t.lx, dz = c.lz - t.lz, d = Math.hypot(dx, dz) || 1;
        const R = t.r * 1.6 + 6;
        return { lx: t.lx + dx / d * R, lz: t.lz + dz / d * R };
    }
}

// ═════════════ Taxi routes ═════════════
export class TaxiGraph {
    constructor(def) {
        this.nodes = def ? def.nodes : {};
        this.edges = def ? def.edges.map(([a, b, w]) => ({ a, b, w })) : [];
        this.adj = {};
        for (const e of this.edges) {
            (this.adj[e.a] = this.adj[e.a] || []).push(e);
            (this.adj[e.b] = this.adj[e.b] || []).push(e);
        }
    }
    len(e) { const A = this.nodes[e.a], B = this.nodes[e.b]; return Math.hypot(B[0] - A[0], B[1] - A[1]); }
    // shortest route from node a to node b as a list of node ids, avoiding edges blocked(e) says are cut; null if none.
    // Taxiing along the runway itself (edges wider than 40 m) costs four times as much: only when there's no other way.
    route(a, b, blocked = null, runwayCost = 4) {
        if (!this.nodes[a] || !this.nodes[b]) return null;
        const dist = { [a]: 0 }, prev = {}, done = new Set();
        const open = [a];
        while (open.length) {
            let bi = 0;
            for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
            const n = open.splice(bi, 1)[0];
            if (n === b) break;
            if (done.has(n)) continue;
            done.add(n);
            for (const e of this.adj[n] || []) {
                if (blocked && blocked(e)) continue;
                const m = e.a === n ? e.b : e.a;
                const d = dist[n] + this.len(e) * (e.w > 40 ? runwayCost : 1);
                if (dist[m] === undefined || d < dist[m]) { dist[m] = d; prev[m] = n; open.push(m); }
            }
        }
        if (dist[b] === undefined) return null;
        const out = [b];
        while (out[0] !== a) out.unshift(prev[out[0]]);
        return out;
    }
    points(route) { return route.map(id => ({ lx: this.nodes[id][0], lz: this.nodes[id][1], id })); }
    // blocked-edge test for a crater field
    blocker(field) { return (e) => { const A = this.nodes[e.a], B = this.nodes[e.b]; return !!field.blocksSegment(A[0], A[1], B[0], B[1], e.w); }; }
}

// ═════════════ The jets on the field ═════════════
// shelters: { id, qra, alive, jet }; jets: { id, type, state: 'alert' | 'ready' | 'out' | 'turnaround' | 'lost',
// shelter, readyAt }. The two alert jets sit in the QRA shelters on five-minute alert. After a launch an empty alert
// shelter is taken over by a ready jet from the shelters (REFILL s later: it taxis over and the pilots take over the
// alert); a jet back from a sortie turns round (refuel, rearm) in any empty shelter: TURNAROUND s, longer when fuel
// or munitions are short (rate < 1). A shelter destroyed takes its jet with it.
export const TURNAROUND = 420, REFILL = 150;
export class Airwing {
    constructor(shelters, types) {
        this.shelters = shelters.map(s => ({ id: s.id, qra: !!s.alert, alive: true, jet: null, emptyT: 0 }));
        this.jets = [];
        let k = 0;
        for (const s of this.shelters) {
            const j = { id: this.jets.length + 1, type: types[k++ % types.length], state: s.qra ? 'alert' : 'ready', shelter: s, readyAt: 0 };
            s.jet = j;
            this.jets.push(j);
        }
    }
    shelter(id) { return this.shelters.find(s => s.id === id) || null; }
    get alertReady() { return this.jets.filter(j => j.state === 'alert'); }
    get ready() { return this.jets.filter(j => j.state === 'ready'); }
    get available() { return this.alertReady.length + this.ready.length; }
    count(state) { return this.jets.filter(j => j.state === state).length; }
    // jets for a scramble of n: the alert pair first, then ready ones from the shelters (they leave their shelter)
    take(n, t = 0) {
        const out = this.alertReady.slice(0, n);
        for (const j of this.ready) { if (out.length >= n) break; out.push(j); }
        for (const j of out) { j.state = 'out'; j.from = j.shelter; if (j.shelter) { j.shelter.jet = null; j.shelter.emptyT = t; } j.shelter = null; }
        return out;
    }
    // a jet back from a sortie (a returning flight, or a launch called off): turnaround in an empty shelter
    back(jet, t, rate = 1) {
        if (!jet || jet.state === 'lost') return null;
        const s = (jet.from && jet.from.alive && !jet.from.jet ? jet.from : null) || this.shelters.find(x => x.alive && !x.jet && !x.qra) || this.shelters.find(x => x.alive && !x.jet);
        jet.state = 'turnaround'; jet.readyAt = t + TURNAROUND / Math.max(rate, 0.15); jet.shelter = s || null;
        if (s) s.jet = jet;
        return s;
    }
    lost(jet) { if (jet) { jet.state = 'lost'; if (jet.shelter) jet.shelter.jet = null; jet.shelter = null; } }
    // a shelter destroyed, and the jet in it
    destroyShelter(id) {
        const s = this.shelter(id);
        if (!s || !s.alive) return null;
        s.alive = false;
        const j = s.jet;
        if (j) { j.state = 'lost'; j.shelter = null; s.jet = null; }
        return j;
    }
    // turnarounds finish; an empty alert shelter is filled by a ready jet. Returns the moves ({ jet, from, to })
    update(t, rate = 1) {
        for (const j of this.jets) if (j.state === 'turnaround' && t >= j.readyAt) j.state = j.shelter && j.shelter.qra ? 'alert' : 'ready';
        const moves = [];
        for (const q of this.shelters) {
            if (!q.qra || !q.alive || q.jet || t - q.emptyT < REFILL / Math.max(rate, 0.25)) continue;
            const donor = this.ready[0];
            if (!donor) continue;
            const from = donor.shelter;
            if (from) { from.jet = null; from.emptyT = t; }
            donor.shelter = q; q.jet = donor;
            donor.state = 'turnaround'; donor.readyAt = t + 90 / Math.max(rate, 0.25);
            moves.push({ jet: donor, from, to: q });
        }
        return moves;
    }
}

// ═════════════ Scramble timing ═════════════
// Horn → wheels up for a pair (s). qra: the alert pair (else jets from the shelters, engines started inside, a
// longer taxi); tower: ATC alive (without it, no clearances — the leader waits and goes on his own look-out);
// power: the field's power (without it, no ground power / lights: slower start and taxi at night)
export function scrambleTimeline({ qra = true, tower = true, power = true, night = false, taxi = 180 } = {}) {
    const T = {};
    T.horn = 0;
    T.run = 2;                                   // pilots out of the crew room
    T.climb = 16 + (qra ? 0 : 12);              // at the jets, up the ladders
    T.start = T.climb + 6;                       // engines (APU / JFS), canopy down
    T.canopy = T.start + 16 + (power ? 0 : 8);
    T.taxi = T.canopy + 4;
    const taxiTime = taxi / (night && !power ? 6 : 9);
    T.lineup = T.taxi + taxiTime;
    T.hold = tower ? 4 : 38;                     // cleared at once / look out and go
    T.roll1 = T.lineup + T.hold;
    T.roll2 = T.roll1 + 10;                      // ten-second stream
    T.airborne = T.roll2 + 18;
    return T;
}

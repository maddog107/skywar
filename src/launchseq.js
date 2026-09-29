// ═══════════════════════════════════════════════════════════════
// Launch sequences (docs/WAR.md "Naval operations"): how a missile leaves its ship — a Mk 41 cell, an inclined
// container, a cold-launch revolver, a Mk 141 canister, a trainable launcher, a submarine's tube — played on the
// ship's rig (naval.js openCell / ventCell / poseRig), and the launch phase the missile flies first (strikes.js
// StrategicMissile, the navalops.js interceptors) before its own guidance takes over.
//  • Magazine: what each cell / canister / launcher holds and which are empty (a quad-packed ESSM cell holds four)
//  • LaunchControl: per ship — opens the hatch, lights the motor when it's open, vents the module's uptake while
//    the missile climbs out, closes up after it; one hatch can serve several cells (a revolver, a sub's tube hatch)
//  • LaunchPhase: the missile inside its launcher (rising out of the cell on its booster, popped out cold and lit
//    in the air, a capsule rising from a submarine and broaching, booster lit above the water)
// Timings (TIMING, LAUNCH) from the Mk 41 / missile data and launch footage: the hatch swings up in about a second,
// the motor lights as it reaches the stop, a Tomahawk (Mk 106 booster, 26.7 kN for 12 s on a 1.45 t launch package)
// climbs out slowly in a cloud of exhaust from the uptake while a Standard is out in a fraction of a second, the
// plenum vents a moment longer and the hatch closes a few seconds after the missile has gone.
// No scene and no DOM: positions come from frame functions and the effects go out through callbacks, so all of it
// runs headless (tests/navalops.test.mjs).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { G } from './util.js';

// ── How each missile leaves its launcher ──
// mode: 'cell' — hot launch out of a vertical cell: the motor lights in the canister, the gas goes down the plenum
//         and up the module's uptake, the missile climbs out along the cell axis.
//       'container' — hot launch out of an inclined container (P-1000 on the Slava): the gas leaves at its back.
//       'canister' — Mk 141 Harpoon canister at 35°: the frangible cover blows off.
//       'cold' — thrown out by gas (S-300F's revolver, the Shtil VLS): it pops up and the motor lights in the air.
//       'rail' — off a trainable launcher (RAM, Sea Sparrow, Osa-M): it's already in the open.
//       (a submarine's tube is always 'capsule': see LaunchPhase)
// accel: m/s² along the axis while it's in the launcher (thrust / mass − g); eject: m/s out of a cold launcher,
// ignite: s later the motor lights; len: missile length (m)
export const LAUNCH = {
    tlam: { mode: 'cell', accel: 9, len: 6.25 },
    kalibr: { mode: 'cell', accel: 12, len: 6.2 },
    harpoon: { mode: 'canister', accel: 60, len: 4.6 },
    p1000: { mode: 'container', accel: 26, len: 11.7 },
    sm2: { mode: 'cell', accel: 150, len: 4.7 },
    sm6: { mode: 'cell', accel: 170, len: 6.55 },
    essm: { mode: 'cell', accel: 220, len: 3.66 },
    s300f: { mode: 'cold', eject: 26, ignite: 1.0, len: 7.25 },
    shtil: { mode: 'cold', eject: 22, ignite: 0.7, len: 5.2 },
    ram: { mode: 'rail', accel: 200, len: 2.8 },
    nssm: { mode: 'rail', accel: 200, len: 3.66 },
    osa: { mode: 'rail', accel: 160, len: 3.2 },
};

// ── Launcher timelines (s) ──
// open: hatch travel; ignite: after it's fully open; vent: the uptake keeps venting after the missile is out;
// closeDelay: after the missile is out, before the hatch closes; close: hatch travel; cycle: least time between two
// launches through one hatch (a revolver turns the next round under it; a submarine floods and re-pressurises)
export const TIMING = {
    mk41: { open: 1.0, ignite: 0.15, vent: 1.2, closeDelay: 4, close: 1.6, cycle: 0.6 },
    container: { open: 1.4, ignite: 0.3, vent: 1.5, closeDelay: 6, close: 2.2, cycle: 1 },
    revolver: { open: 1.2, ignite: 0.1, vent: 0.6, closeDelay: 5, close: 1.5, cycle: 3 },
    canister: { open: 0, ignite: 0.2, vent: 0.8, closeDelay: 0, close: 0, cycle: 1 },
    rail: { open: 0, ignite: 0.05, vent: 0.3, closeDelay: 0, close: 0, cycle: 1.5 },
    popup: { open: 3.0, ignite: 0.3, vent: 0.3, closeDelay: 25, close: 3.0, cycle: 2.5 }, // (the Osa-M rises out of its well)
    subtube: { open: 3.0, ignite: 0.4, vent: 0, closeDelay: 6, close: 3.0, cycle: 4 },
};
// uptake lids: blown open by the gas, closed by their spring
const UPTAKE = { open: 0.15, close: 1.0 };

// The key moments of a Mk 41 (or other hatch) launch, from the order: the hatch starts opening at 0
export function vlsTimeline(key, depth = 7.7, timing = TIMING.mk41) {
    const L = LAUNCH[key] || LAUNCH.tlam;
    const ignite = timing.open + timing.ignite;
    const inCell = L.mode === 'cold' ? depth / Math.max(L.eject || 20, 1) : Math.sqrt(2 * depth / Math.max(L.accel || 30, 1));
    const clear = ignite + inCell;
    const closeStart = clear + timing.closeDelay;
    return { open: timing.open, ignite, clear, closeStart, closed: closeStart + timing.close };
}

// ═════════════ The launch phase (the missile's side) ═════════════
const _p = new THREE.Vector3(), _d = new THREE.Vector3();
export class LaunchPhase {
    // o: { mode, frame(pos, dir) → the launcher's mouth (world) and axis, read every frame (the ship moves and rolls);
    //   depth (m of tube below the mouth), accel, len, hostVel (live Vector3: added when it leaves), eject, ignite,
    //   surface(x, z) (the sea's height, for a capsule), onClear(), onIgnite(pos, dir), onBroach(pos),
    //   onExhaust(pos, dir, k, dt) (the motor burning in the launcher) }
    constructor(o) {
        const L = LAUNCH[o.key] || {};
        this.mode = o.mode || L.mode || 'cell';
        this.frame = o.frame;
        this.depth = o.depth ?? 7.7;
        this.accel = o.accel ?? L.accel ?? 30;
        this.len = o.len ?? L.len ?? 5;
        this.eject = o.eject ?? L.eject ?? 25;
        this.igniteT = o.ignite ?? L.ignite ?? 1;
        this.hostVel = o.hostVel || null;
        this.surface = o.surface || (() => 0);
        this.onClear = o.onClear || null; this.onIgnite = o.onIgnite || null; this.onBroach = o.onBroach || null; this.onExhaust = o.onExhaust || null;
        this.s = 0; this.v = this.mode === 'cold' ? this.eject : 0; this.t = 0;
        this.dir = new THREE.Vector3(0, 1, 0);
        this.done = false; this.cleared = false; this.lit = this.mode !== 'cold' && this.mode !== 'capsule';
        this.p0 = null; this.broached = false; this.outT = 0;
    }

    // is the motor burning (the missile's own flame and smoke)?
    get burning() { return this.lit; }

    // Moves missile m (m.pos, m.vel) while it's still in or just out of its launcher; false once its own flight
    // takes over (m.vel is then its velocity, launch-platform motion included)
    step(m, dt) {
        if (this.done) return false;
        this.t += dt;
        if (this.mode === 'capsule') return this.stepCapsule(m, dt);
        if (this.mode === 'cold') return this.stepCold(m, dt);
        // hot launch: accelerate along the axis, the tail from the bottom of the tube to the mouth
        this.frame(_p, _d);
        this.dir.copy(_d);
        this.v += this.accel * dt;
        this.s += this.v * dt;
        m.pos.copy(_p).addScaledVector(_d, this.s - this.depth + this.len / 2);
        m.vel.copy(_d).multiplyScalar(Math.max(this.v, 0.1));
        if (this.onExhaust) this.onExhaust(_p, _d, 1, dt);
        if (this.s >= this.depth) {
            if (this.hostVel) m.vel.add(this.hostVel);
            this.cleared = this.done = true;
            if (this.onClear) this.onClear();
            return false;
        }
        return true;
    }

    // cold launch: thrown up out of the hatch by gas, coasting a moment, the motor lights in the air
    stepCold(m, dt) {
        if (!this.cleared) {
            this.frame(_p, _d);
            this.dir.copy(_d);
            this.s += this.v * dt;
            m.pos.copy(_p).addScaledVector(_d, this.s - this.len / 2);
            m.vel.copy(_d).multiplyScalar(this.v);
            if (this.s >= this.len) {
                if (this.hostVel) m.vel.add(this.hostVel);
                this.cleared = true;
                if (this.onClear) this.onClear();
            }
            return true;
        }
        m.vel.y -= G * dt;
        m.pos.addScaledVector(m.vel, dt);
        if (this.t >= this.igniteT || m.vel.y < 3) {
            this.lit = true; this.done = true;
            if (this.onIgnite) this.onIgnite(m.pos, _d.copy(m.vel).normalize());
            return false;
        }
        return true;
    }

    // submarine: the capsule leaves the tube, rises (gas and buoyancy), breaks the surface, coasts up a few metres,
    // the caps come off and the booster lights above the water
    stepCapsule(m, dt) {
        if (!this.p0) { this.frame(_p, _d); this.p0 = _p.clone(); this.dir.copy(_d); if (this.onClear) this.onClear(); this.cleared = true; }
        const D = this.dir;
        const bottomY = this.p0.y + D.y * this.s - this.len / 2;
        const water = this.surface(m.pos.x, m.pos.z);
        if (bottomY < water) this.v = Math.min(this.v + 14 * dt, 24); // (still pushed up through the water)
        else { this.v -= G * dt; this.outT += dt; }
        this.s += this.v * dt;
        m.pos.copy(this.p0).addScaledVector(D, this.s);
        m.vel.copy(D).multiplyScalar(this.v);
        if (!this.broached && m.pos.y + this.len / 2 > water) {
            this.broached = true;
            if (this.onBroach) this.onBroach(_p.set(m.pos.x, water, m.pos.z));
        }
        if (this.outT > 0.35 || (this.broached && this.v < 6 && bottomY > water)) {
            m.vel.copy(D).multiplyScalar(Math.max(this.v, 6));
            this.lit = true; this.done = true;
            if (this.onIgnite) this.onIgnite(m.pos, D);
            return false;
        }
        return this.t < 20;
    }
}

// ═════════════ Magazines ═════════════
// What each ship type carries (the navalops.js groups): cells: [[key, cells, per cell], …] spread over the ship's
// cells (a quad-packed ESSM cell holds 4); ranges: [[key, first cell, last cell]] (1-based, the Slava's P-1000
// containers and S-300F revolvers); canisters: [[key, point prefix, count]] (the cruiser's Harpoons); mounts:
// [[key, node, rounds]] (trainable launchers: RAM, Sea Sparrow, Osa-M). Loads are a typical mix, not an exact
// published one (those aren't published).
export const LOADOUTS = {
    destroyer: {
        blue: { cells: [['sm2', 40], ['sm6', 12], ['essm', 12, 4], ['tlam', 16], ['asroc', 16]] },
        red: { cells: [['shtil', 48], ['kalibr', 16], ['asroc', 32]] },
    },
    cruiser: {
        blue: { cells: [['sm2', 60], ['sm6', 16], ['essm', 12, 4], ['tlam', 26], ['asroc', 8]], canisters: [['harpoon', 'harpoon_', 8]] },
        red: { cells: [['shtil', 60], ['kalibr', 30], ['asroc', 32]] },
    },
    slava: {
        red: { ranges: [['p1000', 1, 16], ['s300f', 17, 80]], mounts: [['osa', 'launcher_osa_1', 20], ['osa', 'launcher_osa_2', 20]] },
        blue: { ranges: [['p1000', 1, 16], ['s300f', 17, 80]], mounts: [['osa', 'launcher_osa_1', 20], ['osa', 'launcher_osa_2', 20]] },
    },
    carrier: {
        blue: { mounts: [['ram', 'mount_sam_0', 21], ['nssm', 'mount_sam_1', 8]] },
        red: { mounts: [['osa', 'mount_sam_0', 12], ['osa', 'mount_sam_1', 12]] },
    },
    ssn: { blue: { cells: [['tlam', 40]] }, red: { cells: [['kalibr', 40]] } },
    ssgn: { blue: { cells: [['tlam', 154]] }, red: { cells: [['kalibr', 154]] } },
};

export class Magazine {
    // tubes: [{ key, left, kind: 'cell' | 'point' | 'mount', ref (cell index / node name), door, uptake, depth, mode }]
    constructor(tubes = []) {
        this.tubes = tubes;
        for (const t of tubes) { t.state = t.left > 0 ? 'ready' : 'empty'; t.fired = 0; }
    }
    count(key) { let n = 0; for (const t of this.tubes) if (t.key === key) n += t.left; return n; }
    keys() { return [...new Set(this.tubes.filter(t => t.left > 0).map(t => t.key))]; }
    // the next loaded tube with `key` that `ok(tube)` allows (default: any), marked firing; null if none
    take(key, ok = null) {
        for (const t of this.tubes) {
            if (t.key !== key || t.state !== 'ready' || t.left <= 0 || (ok && !ok(t))) continue;
            t.left--; t.fired++; t.state = 'firing';
            return t;
        }
        return null;
    }
    // the launch is over: the tube is ready again if it still holds a missile, empty otherwise
    release(t) { t.state = t.left > 0 ? 'ready' : 'empty'; }
    get empty() { return this.tubes.filter(t => t.state === 'empty'); }
}

// A ship's magazine from its rig and a LOADOUTS entry. Cells are filled in a stride order (37 is coprime with every
// cell count), so each missile is spread over the forward and aft launchers as on a real ship.
export function buildMagazine(ship, load) {
    const tubes = [];
    if (!load) return new Magazine(tubes);
    const rig = ship.rig || { cells: [], points: {}, nodes: {} };
    const sub = ship.def && ship.def.cls === 'sub';
    const cellTube = (i, key, per) => {
        const c = rig.cells[i];
        const L = LAUNCH[key] || {};
        return { key, left: per, kind: 'cell', ref: i, door: c.door ? c.door.name : null, uptake: c.uptake ? c.uptake.name : null, depth: c.spec.depth ?? 7.7,
            mode: sub ? 'capsule' : L.mode || 'cell', timing: sub ? 'subtube' : L.mode === 'container' ? 'container' : L.mode === 'cold' ? 'revolver' : 'mk41' };
    };
    const n = rig.cells.length;
    if (load.cells && n) {
        const order = [];
        for (let k = 0; k < n; k++) order.push((k * 37) % n);
        let j = 0;
        for (const [key, cells, per = 1] of load.cells) for (let c = 0; c < cells && j < n; c++, j++) tubes.push(cellTube(order[j], key, per));
    }
    for (const [key, a, b] of load.ranges || []) for (let i = a - 1; i < Math.min(b, n); i++) tubes.push(cellTube(i, key, 1));
    for (const [key, prefix, count] of load.canisters || []) {
        for (let i = 1; i <= count; i++) if (rig.points && rig.points[prefix + i]) tubes.push({ key, left: 1, kind: 'point', ref: prefix + i, door: null, uptake: null, depth: 4.2, mode: 'canister', timing: 'canister' });
    }
    for (const [key, node, rounds] of load.mounts || []) {
        // (a launcher that's a rig node of its own — the Slava's Osa-M — rises out of its well first, like a hatch)
        const pop = !!(rig.nodes && rig.nodes[node]);
        tubes.push({ key, left: rounds, kind: 'mount', ref: node, door: pop ? node : null, uptake: null, depth: 0, mode: 'rail', timing: pop ? 'popup' : 'rail' });
    }
    return new Magazine(tubes);
}

// ═════════════ Per ship: hatches and launches ═════════════
export class LaunchControl {
    // ship (naval.js); o: { magazine, pose(name, k) (moves a rig node: naval.js poseRig), frame(tube, pos, dir) (the
    //   tube's mouth and axis in the world), exhaustAt(tube, pos) (the uptake / the container's back, world),
    //   fx: { ignite(seq, pos, dir), exhaust(seq, pos, dir, k, dt), broach(seq, pos), clear(seq) } (all optional),
    //   surface(x, z), hostVel }. frame(tube, pos, dir, seq) gets the launch too (a trainable launcher aims at its
    //   target). Set .ready = (key) => bool to hold launches (a submarine below launch depth).
    constructor(ship, o = {}) {
        this.ship = ship;
        this.mag = o.magazine || new Magazine();
        this.pose = o.pose || (() => {});
        this.frameOf = o.frame || ((t, p, d) => { p.copy(ship.pos); d.set(0, 1, 0); });
        this.exhaustAt = o.exhaustAt || null;
        this.fx = o.fx || {};
        this.surface = o.surface || (() => 0);
        this.hostVel = o.hostVel || ship.vel || null;
        this.doors = new Map();   // name → { k, holdUntil, open, close }
        this.seqs = [];
        this.nextAt = new Map();  // door or tube → earliest time of the next launch through it
        this.time = 0;
    }

    count(key) { return this.mag.count(key); }
    has(key) { return this.mag.count(key) > 0; }
    // how long from the order to the motor lighting (the hatch has to open first)
    lead(key) { const t = this.mag.tubes.find(x => x.key === key); return t ? TIMING[t.timing].open + TIMING[t.timing].ignite : 0; }

    // keep a hatch opening (or open) until `until`; it closes by itself after that
    hold(name, until, open, close) {
        if (!name) return null;
        let d = this.doors.get(name);
        if (!d) this.doors.set(name, d = { k: 0, holdUntil: 0, open: open || 1, close: close || 1 });
        d.holdUntil = Math.max(d.holdUntil, until);
        if (open) d.open = open;
        if (close) d.close = close;
        return d;
    }
    doorK(name) { const d = name && this.doors.get(name); return d ? d.k : name ? 0 : 1; }

    // Launch one `key`: returns the sequence, or null when nothing loaded can fire now. spawn(phase, pos, dir) is
    // called when the motor lights (the phase flies the missile out of the launcher) and returns the missile.
    fire(key, spawn, opts = {}) {
        const now = this.time;
        if (this.ready && !this.ready(key)) return null; // (a submarine fires from periscope depth: navalops.js brings it up)
        const tube = this.mag.take(key, (t) => !this.busy(t, now) && (!opts.ok || opts.ok(t)));
        if (!tube) return null;
        const T = TIMING[tube.timing] || TIMING.mk41;
        const seq = { key, tube, T, t: 0, state: 'opening', spawn, missile: null, phase: null, clearT: 0, target: opts.target || null, data: opts.data || null };
        this.nextAt.set(tube.door || tube, now + T.cycle);
        if (tube.door) this.hold(tube.door, 1e9, T.open, T.close);
        this.seqs.push(seq);
        return seq;
    }

    // a tube can't fire while its hatch is busy with another launch (a revolver's next round, a sub's tube hatch)
    busy(tube, now) {
        const k = tube.door || tube;
        return (this.nextAt.get(k) ?? -1) > now;
    }

    update(dt) {
        this.time += dt;
        const now = this.time;
        for (let i = this.seqs.length - 1; i >= 0; i--) {
            const s = this.seqs[i];
            s.t += dt;
            if (s.state === 'opening') {
                // (the motor lights once the hatch is fully open and the sequencer has checked it)
                if (this.doorK(s.tube.door) >= 0.999) { s.readyT = (s.readyT || 0) + dt; if (s.readyT >= s.T.ignite) this.ignite(s); }
            } else if (s.state === 'firing') {
                // the missile's launch phase moves it and says when it's out (onClear); if it never does (the missile
                // is gone, the ship sank), give up after a while
                if (s.phase && s.phase.cleared) { s.state = 'venting'; s.clearT = now; this.afterClear(s); }
                else if (s.t > 30) { s.state = 'venting'; s.clearT = now; this.afterClear(s); }
            } else if (s.state === 'venting') {
                const k = 1 - (now - s.clearT) / Math.max(s.T.vent, 1e-3);
                if (k > 0 && this.fx.exhaust && this.exhaustAt) { this.exhaustAt(s.tube, _p); this.fx.exhaust(s, _p, _d.set(0, 1, 0), k * 0.5, dt); }
                if (k <= 0) { s.state = 'done'; this.mag.release(s.tube); this.seqs.splice(i, 1); }
            }
        }
        // hatches and uptakes move toward open while held, then close
        for (const [name, d] of this.doors) {
            const want = now < d.holdUntil ? 1 : 0;
            if (d.k === want) continue;
            const rate = want ? 1 / Math.max(d.open, 1e-3) : 1 / Math.max(d.close, 1e-3);
            d.k = want ? Math.min(1, d.k + rate * dt) : Math.max(0, d.k - rate * dt);
            this.pose(name, d.k);
        }
    }

    ignite(s) {
        s.state = 'firing';
        const tube = s.tube, now = this.time;
        if (tube.uptake) this.hold(tube.uptake, 1e9, UPTAKE.open, UPTAKE.close);
        const frame = (p, d) => this.frameOf(tube, p, d, s);
        const self = this;
        s.phase = new LaunchPhase({
            key: s.key, mode: tube.mode, frame, depth: tube.depth, hostVel: this.hostVel, surface: this.surface,
            onClear: () => { if (self.fx.clear) self.fx.clear(s); },
            onIgnite: (p, d) => { if (self.fx.ignite) self.fx.ignite(s, p, d, true); },
            onBroach: (p) => { if (self.fx.broach) self.fx.broach(s, p); },
            onExhaust: (p, d, k, dt) => {
                if (!self.fx.exhaust) return;
                if (self.exhaustAt && self.exhaustAt(tube, _p)) self.fx.exhaust(s, _p, d, k, dt);
                else self.fx.exhaust(s, p, d, k, dt);
            },
        });
        this.frameOf(tube, _p, _d, s);
        s.missile = s.spawn ? s.spawn(s.phase, _p.clone(), _d.clone(), s) : null;
        if (this.fx.spawned) this.fx.spawned(s);
        // (a hot launch lights in the tube: the flash is at the mouth now; cold and capsule launches light later)
        if (s.phase.lit && this.fx.ignite) this.fx.ignite(s, _p, _d, false);
        void now;
    }

    afterClear(s) {
        const now = this.time, T = s.T;
        if (s.tube.door) { const d = this.doors.get(s.tube.door); if (d) d.holdUntil = Math.max(now + T.closeDelay, this.stillFiring(s.tube.door, s) ? 1e9 : 0); }
        if (s.tube.uptake) { const u = this.doors.get(s.tube.uptake); if (u) u.holdUntil = this.stillFiring(s.tube.uptake, s, true) ? 1e9 : now + T.vent; }
    }

    // another launch still using this hatch (or uptake)?
    stillFiring(name, except, uptake = false) {
        return this.seqs.some(x => x !== except && (uptake ? x.tube.uptake === name && x.state === 'firing' : x.tube.door === name && x.state !== 'venting'));
    }

    // cells whose missiles are gone (for the map, the interiors' launch panels)
    emptyCells() { return this.mag.tubes.filter(t => t.kind === 'cell' && t.left <= 0).map(t => t.ref); }
}

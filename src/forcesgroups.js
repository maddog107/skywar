// ═══════════════════════════════════════════════════════════════
// Mobile forces, the units' behaviour (forces.js): what each kind of vehicle group does, as reusable units the
// director, tasks and sandbox tools can spawn and command (docs/WAR.md, "Mobile forces").
//  • TelUnit — a SCUD TEL: waits concealed at a hide site; on a launch order drives to a pre-surveyed firing
//    point, jacks down, swings the pad down, erects the missile, the crew prepares it, fires; lowers the erector,
//    raises the jacks and relocates to another hide (or to the brigade's transloader to reload). Freezes under
//    cover when aircraft are about, flees when hit.
//  • SamGroup — a mobile SAM battery (S-300, Buk, Osa, Patriot): sets up (jacks, masts, canisters, radars
//    spinning), its radars search and track through the radar horizon and terrain, launchers fire by type
//    (ranges, lock times, salvoes); without its engagement radar an S-300 or Patriot battery is blind, a Buk is
//    short-ranged. Shoots and scoots: packs up and moves when it's found, after firing, or now and then — so a
//    known-safe area can light up with a new radar.
//  • RocketBattery — Grad / Smerch / HIMARS / M270: on a fire mission each launcher drives to a firing point,
//    traverses and elevates, ripples its salvo from the tubes, stows and relocates; reloads from the ammunition
//    truck.
//  • Convoy — a mixed column on the road network between bases and towns, keeping its spacing, slowing for bends
//    and hills; attacked, it scatters off the road (troops dismount from the APCs), regroups when it's quiet,
//    turns back at a downed bridge. Director-compatible (alive(), leadVehicle(), centre(), state, total…).
//  • CoastalBattery — Bastion launchers that leave their hide for the shore, erect their canisters and fire
//    P-800s at ships.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { MISSILES } from './strikes.js';
import { VehicleLauncher } from './forcesunits.js';
import { INTEL } from './war.js';
import { terrainHeight } from './world.js';
import { clamp, rand, pick } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const G = 9.81;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ── Deploy sequences: [pose group, seconds], in order, travel → ready (stowing runs them backwards, a little
// quicker). Real times are minutes (a Scud battery ~30 min from march with a surveyed site, an S-300PS 5 min,
// an Osa 4, a Patriot 15–30); the game runs them about ten to twenty times faster.
export const DEPLOY = {
    scud: [['jack', 8], ['pad', 6], ['raise', 24]],
    bastion: [['door', 5], ['jack', 7], ['raise', 14]],
    s300: [['jack', 6], ['raise', 16]],
    flaplid: [['jack', 6], ['raise', 20]],
    p18: [['jack', 5], ['raise', 24]],
    osa: [['raise', 6], ['launcher', 4]],
    buk: [['launcher', 6]],
    patriot_ln: [['jack', 10], ['raise', 5], ['launcher', 8]],
    patriot_radar: [['jack', 10], ['raise', 10]],
    sentinel: [['jack', 6]],
    cmd_red: [['raise', 12]],
    cmd_blue: [['raise', 10]],
    smerch: [['jack', 6]],
    crane: [['jack', 8], ['raise', 12]],
    ammo_blue: [['side', 4], ['jack', 5]],
    ammo_red: [['door', 3]],
};
export const deploySteps = (vid, k = 1) => (DEPLOY[vid] || []).map(([g, t]) => ({ g, to: k, dur: t }));
export const stowSteps = (vid) => (DEPLOY[vid] || []).slice().reverse().map(([g, t]) => ({ g, to: 0, dur: t * 0.8 }));
export const deployTime = (vid) => (DEPLOY[vid] || []).reduce((a, [, t]) => a + t, 0);

// ═════════════ Base ═════════════
class Group {
    constructor(sys, kind, team, opts = {}) {
        this.sys = sys; this.game = sys.game;
        this.kind = kind; this.team = team;
        this.id = 'F' + (sys.nextId++);
        this.name = opts.name || kind.toUpperCase();
        this.members = [];
        this.thinkT = rand(0, 0.5);
        this.done = false;
    }
    get war() { return this.game.war; }
    get alive() { return this.members.some(v => v.alive && !v.removed); }
    add(v) { v.ctrl = this; v.group = this; this.members.push(v); return v; }
    living() { return this.members.filter(v => v.alive && !v.removed); }
    centre(out = new THREE.Vector3()) {
        const a = this.living();
        out.set(0, 0, 0);
        if (!a.length) return this.members.length ? out.copy(this.members[0].pos) : out;
        for (const v of a) out.add(v.pos);
        return out.divideScalar(a.length);
    }
    // throttled thinking (every `every` s), per frame otherwise
    update(dt) {
        this.thinkT -= dt;
        if (this.thinkT <= 0) { this.thinkT += this.every || 0.5; this.think(this.every || 0.5); }
        this.frame(dt);
    }
    think() {}
    frame() {}
    onHit() {}
    onKilled() {}
    // anyone hostile close by and low? (a vehicle crew hears and sees jets): the nearest, or null
    threatNear(pos, r = 4500, agl = 3000) {
        let best = null, bd = r * r;
        for (const a of this.game.aircraft || []) {
            if (!a.alive || a.team === this.team || a.team === 'neutral' || a.onGround) continue;
            const d2 = a.pos.distanceToSquared(pos);
            if (d2 > bd) continue;
            if (a.pos.y - Math.max(terrainHeight(a.pos.x, a.pos.z), 0) > agl) continue;
            bd = d2; best = a;
        }
        const pm = this.game.pilotMode;
        if (!best && pm && pm.alive && this.team !== 'blue' && pm.pos.distanceToSquared(pos) < 300 * 300) best = pm;
        return best;
    }
    // is this group known to the player's side (identified, or marked)?
    exposed() {
        const war = this.war;
        if (!war || this.team === war.side) return false;
        for (const v of this.members) {
            if (!v.alive) continue;
            const r = war.rec(v);
            if (r && r.known >= INTEL.IDENTIFIED && r.source !== 'prior') return true;
            if (war.designations.some(d => d.unit === v)) return true;
        }
        return false;
    }
}

// ═════════════ TEL ═════════════
// brigade: { hides: [site], firing: [site], reload: { site, crane, reserves }, occupied: Set }
export class TelUnit extends Group {
    constructor(sys, v, brigade, opts = {}) {
        super(sys, 'tel', v.team, { name: opts.name || v.realName });
        this.v = this.add(v);
        this.brigade = brigade;
        this.every = 0.5;
        this.state = 'hide';
        this.site = opts.site || null;
        this.order = null;
        this.prepT = 0; this.waitT = 0;
        this.freezeT = 0;
        this.launchPos = null;
        this.stock = v.loaded ? 1 : 0;
        this.launcher = null;
        this.spec = opts.missile || 'scud';
        if (sys.strikes) {
            this.launcher = sys.strikes.addSource(new VehicleLauncher(sys.strikes, v, { kind: 'launcher', name: opts.sourceName || (v.team === 'red' ? 'SCUD TEL' : v.realName), stock: { [this.spec]: this.stock }, final: 3 }));
        }
        if (this.site) this.occupy(this.site);
        this.setConceal();
    }
    get launchSite() { return this.launchPos; }
    occupy(site) { if (this.brigade && this.brigade.occupied) { this.brigade.occupied.delete(this.site); this.brigade.occupied.add(site); } this.site = site; }

    // ── the strike manager's side ──
    canTakeOrder() { return this.v.alive && !!(this.v.loaded & 1) && !this.order && !['stow', 'reload'].includes(this.state); }
    // seconds to the launch: the rest of the drive (the planned route), the set-up still to run, the prep, ignition
    prepEstimate() {
        const v = this.v;
        if (this.state === 'ready') return 3;
        if (this.state === 'prep') return this.prepT + 3;
        let t = 3 + this.prepTime();
        if (this.state === 'setup') {
            for (const a of v.anim) if (a.g) t += Math.max(0, (a.dur || 0) - (a.t || 0));
            return t;
        }
        t += DEPLOY_TIME.scud;
        if ((this.state === 'move' || this.state === 'freeze') && this.plan === 'fire' && v.route.r) return t + v.driveTime() + (this.state === 'freeze' ? this.freezeT : 0);
        const f = this.pickFiring(true);
        if (f) t += Math.hypot(f.x - v.pos.x, f.z - v.pos.z) * 1.3 / 8 + 15; // (a guess before the route's planned: ~8 m/s)
        return t;
    }
    prepTime() { return this.sys.difficultyK ? 40 + 20 / this.sys.difficultyK() : 50; } // gyros, targeting data, final checks
    onFireOrder(src, specKey, aim, strike) {
        this.order = { specKey, aim, strike, t0: this.war ? this.war.time : 0 };
        this.goFire();
        if (this.sys.onTelOrder) this.sys.onTelOrder(this, aim);
    }
    readyToFire() { return this.state === 'ready'; }
    // the missile leaves from its own centre, standing on the pad
    launchFrame(src, out, dir) {
        const v = this.v;
        const L = MISSILES[this.spec] ? MISSILES[this.spec].len : 11;
        if (v.live && v.live.rig.missile) {
            const m = v.live.rig.missile;
            m.updateWorldMatrix(true, false);
            out.setFromMatrixPosition(m.matrixWorld);
            dir.set(0, 0, -1).transformDirection(m.matrixWorld);
            out.addScaledVector(dir, L * 0.5);
            return true;
        }
        const hp = this.sys.hardpoint && this.sys.hardpoint(v.vid, 'missile', v.state);
        if (hp) v.toWorld(hp.x, hp.y, hp.z, out); else v.toWorld(0, 1.6, 7, out);
        out.y += L * 0.5;
        dir.set(0, 1, 0);
        return true;
    }
    onLaunch(src, q, m) {
        const v = this.v;
        v.loaded = 0;
        this.stock = 0;
        src.stock[this.spec] = 0;
        this.launchPos = v.pos.clone();
        this.order = null;
        this.state = 'fired';
        this.waitT = 4;
        this.game.events.emit('telLaunched', v, { missile: m, tel: this });
    }

    // ── moving ──
    pickFiring(peek = false) {
        const b = this.brigade, v = this.v;
        const list = (b && b.firing) || [];
        let best = null, bd = Infinity;
        for (const s of list) {
            if (!peek && b.occupied && b.occupied.has(s) && s !== this.site) continue;
            const d = Math.hypot(s.x - v.pos.x, s.z - v.pos.z);
            if (d < 400 || d > 16000) continue;
            if (d < bd) { bd = d; best = s; }
        }
        if (!best && !peek) best = this.sys.findSite('firing', v.team, v.pos, 1500, 7000);
        return best;
    }
    pickHide() {
        const b = this.brigade, v = this.v;
        const list = ((b && b.hides) || []).filter(s => !(b.occupied && b.occupied.has(s)) && s !== this.site && Math.hypot(s.x - v.pos.x, s.z - v.pos.z) > 1200);
        if (list.length) {
            // somewhere else, not too far: the nearer ones more likely (and a kind it didn't just use)
            list.sort((a, c) => Math.hypot(a.x - v.pos.x, a.z - v.pos.z) - Math.hypot(c.x - v.pos.x, c.z - v.pos.z));
            const pool = list.slice(0, 4).filter(s => !this.site || s.kind !== this.site.kind);
            return pick(pool.length ? pool : list.slice(0, 3));
        }
        return this.sys.findSite('hide', v.team, v.pos, 2000, 8000);
    }
    goTo(site, plan) {
        const v = this.v;
        const r = this.sys.plan(v, site, { reverseLast: site.approach ? Math.hypot(site.approach.x - site.x, site.approach.z - site.z) : site.kind === 'shelter' ? 22 : 0, via: site.approach });
        if (!r) return false;
        if (this.site && this.site !== site && this.brigade && this.brigade.occupied) this.brigade.occupied.delete(this.site);
        this.target = site; this.plan = plan;
        if (this.brigade && this.brigade.occupied) this.brigade.occupied.add(site);
        this.state = 'move';
        v.drive(r, { onArrive: () => this.arrive() });
        this.setConceal();
        if (this.site && this.site.kind === 'shelter' && this.site.building) this.site.building.open = 1;
        return true;
    }
    goFire() {
        const v = this.v;
        if (['setup', 'prep', 'ready'].includes(this.state)) return;
        if (this.state === 'move' && this.plan === 'fire') return;
        // already at a firing point: set up here
        if (this.site && this.site.kind === 'firing' && !v.moving) { this.setup(); return; }
        const f = this.pickFiring();
        if (!f || !this.goTo(f, 'fire')) { this.setup(); } // (nowhere to go: fire from here)
    }
    arrive() {
        const site = this.target;
        this.site = site;
        if (this.plan === 'fire') { this.setup(); return; }
        if (this.plan === 'reload') { this.state = 'reload'; this.waitT = 0; this.reload(); return; }
        this.state = 'hide';
        this.setConceal();
        if (site && site.kind === 'shelter' && site.building) this.sys.later(6, () => { if (this.site === site && this.state === 'hide') site.building.open = 0; });
        if (this.order) this.goFire(); // (an order arrived on the way)
    }
    setup() {
        const v = this.v;
        v.stop();
        this.state = 'setup';
        this.setConceal();
        v.play(deploySteps('scud')).play([{ fn: () => { this.state = 'prep'; this.prepT = this.prepTime(); } }]);
    }
    stow() {
        const v = this.v;
        this.state = 'stow';
        v.play(stowSteps('scud')).play([{ fn: () => this.relocate() }]);
    }
    relocate() {
        const b = this.brigade;
        // no missile and the brigade has reloads: to the transloader; else to a hide
        if (!(this.v.loaded & 1) && b && b.reload && b.reload.reserves > 0 && b.reload.crane && b.reload.crane.alive) {
            if (this.goTo(b.reload.site, 'reload')) { this.emitRelocated(); return; }
        }
        const h = this.pickHide();
        if (h && this.goTo(h, 'hide')) { this.emitRelocated(); return; }
        this.state = 'hide';
    }
    emitRelocated() {
        this.sys.later(20, () => { if (this.v.alive) this.game.events.emit('telRelocated', this.v); });
    }
    reload() {
        const b = this.brigade, crane = b && b.reload && b.reload.crane;
        this.state = 'reload';
        const done = () => {
            if (!this.v.alive) return;
            if (b.reload.reserves <= 0) { this.relocate(); return; }
            b.reload.reserves--;
            this.v.loaded = 1; this.stock = 1;
            if (this.launcher) this.launcher.stock[this.spec] = 1;
            this.sys.later(3, () => this.relocate());
        };
        if (crane && crane.alive) {
            // the transloader swings a missile across: jacks, boom up and round, down again
            crane.play(deploySteps('crane')).play([{ aim: [Math.PI * 0.9, 0], dur: 10 }, { wait: 12 }, { aim: [0, 0], dur: 10 }]).play(stowSteps('crane')).play([{ fn: done }]);
        } else this.sys.later(45, done);
    }
    setConceal() {
        const v = this.v;
        let c = 0.2;
        if (this.state === 'hide' && this.site) c = this.site.conceal ?? 0.5;
        else if (this.state === 'move' || this.state === 'reload') c = v.route.r && (v.route.r.f[v.route.i] & 1) ? 0.1 : 0.05;
        else if (this.state === 'freeze') c = Math.max(0.45, this.sys.env ? this.sys.env.forest(v.pos.x, v.pos.z) * 0.9 : 0.45);
        else c = 0.12; // set up in the open with a 14 m missile standing on it
        v.setConceal(c);
        v.hardened = this.state === 'hide' && this.site && this.site.kind === 'shelter' ? 0.85 : 0;
        const r = this.war && this.war.rec(v);
        if (r) r.hardened = v.hardened;
    }

    think(dt) {
        const v = this.v;
        if (!v.alive) return;
        if (this.state === 'prep') {
            this.prepT -= dt;
            if (this.prepT <= 0) this.state = 'ready';
        } else if (this.state === 'fired') {
            this.waitT -= dt;
            if (this.waitT <= 0) this.stow();
        } else if (this.state === 'ready' && !this.order && !(this.launcher && this.launcher.queue.length)) {
            // (the order was withdrawn: stand down)
            this.stow();
        } else if (this.state === 'move' && this.plan !== 'fire' && !this.order) {
            // aircraft about: pull over under what cover there is and wait
            const t = this.threatNear(v.pos, 4000, 2500);
            if (t && !this.freezeT && (v.route.r && !(v.route.r.f[v.route.i] & 4))) {
                this.freezeT = 25;
                v.route.hold = true;
                this.state = 'freeze';
                this.setConceal();
            }
        } else if (this.state === 'freeze') {
            const t = this.threatNear(v.pos, 6000, 3000);
            if (t) this.freezeT = 25; else this.freezeT -= dt;
            if (this.freezeT <= 0 || this.order) { this.freezeT = 0; v.route.hold = false; this.state = 'move'; this.setConceal(); if (this.order) { v.stop(); this.goFire(); } }
        } else if (this.state === 'hide' && this.order) this.goFire();
        if (this.state === 'move') this.setConceal();
    }
    onHit(v, source) {
        // hit while setting up: the crew gets out of there (the launch is off)
        if (['setup', 'prep', 'ready'].includes(this.state) && v.hp < v.maxHp * 0.6) {
            if (this.launcher) this.launcher.abort();
            this.order = null;
            v.anim.length = 0;
            this.stow();
        }
        void source;
    }
    onKilled() {
        if (this.brigade && this.brigade.occupied) { this.brigade.occupied.delete(this.site); this.brigade.occupied.delete(this.target); }
        if (this.launcher) this.launcher.abort();
    }
}
const DEPLOY_TIME = { scud: deployTime('scud') };

// ═════════════ SAM groups ═════════════
// Engagement envelopes are game-scale (the theatre is ~60 km across; real S-300PS reach is 75 km), kept in
// proportion: Osa < Buk < S-300 < Patriot. W: the missile (weapons.js SAM, config.js WEAPONS.sam, with a
// proximity fuse and the motor for the reach). own: each launcher has its own radar (a TELAR).
const samW = (o) => ({ ...WEAPONS.sam, prox: 18, ...o });
export const SAM_TYPES = {
    s300: { label: 'SA-10 GRUMBLE', launcher: 's300', radar: 'flaplid', search: 'p18', command: 'cmd_red', n: 3, range: 17000, rmin: 1800, altMin: 25,
        lock: 3.6, interval: 5, salvo: 2, spacing: 3, ammo: 4, radarRange: 42000, searchRange: 70000, vertical: true, blind: true, missiles: 'cruise',
        W: samW({ boost: 7.5, accelBoost: 230, turnG: 26, life: 26, damage: 95, navN: 3.6 }) },
    buk: { label: 'SA-11 GADFLY', launcher: 'buk', radar: null, search: 'p18', command: 'cmd_red', n: 2, range: 12500, rmin: 1000, altMin: 15,
        lock: 2.8, interval: 4, salvo: 1, ammo: 4, own: 20000, searchRange: 60000, degraded: { range: 0.6, lock: 1.7 },
        W: samW({ boost: 5.5, accelBoost: 205, turnG: 24, life: 20, damage: 85 }) },
    osa: { label: 'SA-8 GECKO', launcher: 'osa', radar: null, search: null, command: null, n: 2, range: 7500, rmin: 700, altMin: 10,
        lock: 2.2, interval: 4, salvo: 1, ammo: 6, own: 22000,
        W: samW({ boost: 3.2, accelBoost: 190, turnG: 22, life: 13, damage: 60, prox: 15 }) },
    patriot: { label: 'PATRIOT', launcher: 'patriot_ln', radar: 'patriot_radar', search: 'sentinel', command: 'cmd_blue', n: 3, range: 20000, rmin: 1600, altMin: 30,
        lock: 3.0, interval: 4, salvo: 2, spacing: 2.5, ammo: 4, radarRange: 60000, searchRange: 40000, blind: true, missiles: 'all',
        W: samW({ boost: 7.5, accelBoost: 245, turnG: 30, life: 26, damage: 110, prox: 20 }) },
};

export class SamGroup extends Group {
    // site: { x, z, heading (the threat axis: launchers face it) }
    constructor(sys, type, team, site, opts = {}) {
        const T = SAM_TYPES[type];
        super(sys, 'sam', team, { name: opts.name || T.label + ' BATTERY' });
        this.type = type; this.T = T;
        this.every = 0.25;
        this.site = { x: site.x, z: site.z, heading: site.heading ?? 0 };
        this.visited = [{ x: site.x, z: site.z }];
        this.state = 'ready';
        this.emcon = opts.emcon || (type === 'osa' || Math.random() < 0.35 ? 'ambush' : 'search');
        this.radarOn = false;
        this.tracks = new Map();   // target → { lockT, seenT, launcher, shots, nextT }
        this.shots = 0;            // since the last move
        this.moveAt = Infinity;    // war.time to pack up and go
        this.relocateEvery = opts.relocateEvery ?? rand(600, 1100);
        this.movedT = 0;
        this.launchers = []; this.radar = null; this.search = null; this.command = null; this.support = [];
        this.aims = new Map();     // launcher → { yaw, pitch } it's training toward
        const arm = (v) => {
            if (v.ammo === undefined) { v.ammo = T.ammo; v.loaded = (1 << T.ammo) - 1; }
            v.samRange = T.range; v.nextT = 0;
            if (T.own) v.radarRange = T.own;
        };
        if (opts.adopt) {
            // vehicles that already belong to something (a convoy's SA-8): they fight as a battery of their own
            // for a while, without leaving their column (their controller stays the convoy)
            for (const v of opts.adopt) { this.members.push(v); v.role = v.role || 'launcher'; arm(v); v.emitting = false; this.launchers.push(v); }
            this.adopted = true;
        } else {
            const n = opts.launchers ?? T.n;
            const slots = this.slots(n);
            let k = 0;
            const mk = (vid, role, slot) => {
                if (!vid) return null;
                const v = sys.spawnVehicle(vid, team, this.slotPos(slot), { heading: this.site.heading + slot.h });
                v.role = role; v.slot = slot;
                this.add(v);
                if (role === 'launcher') arm(v);
                if (role === 'radar') v.radarRange = T.radarRange;
                if (role === 'search') v.radarRange = T.searchRange;
                v.emitting = false;
                return v;
            };
            this.radar = mk(T.radar, 'radar', slots.radar);
            this.search = mk(T.search, 'search', slots.search);
            this.command = mk(T.command, 'command', slots.command);
            for (let i = 0; i < n; i++) this.launchers.push(mk(T.launcher, 'launcher', slots.launchers[k++]));
            if (opts.support !== false && T.command) this.support.push(mk(team === 'blue' ? 'ammo_blue' : 'ammo_red', 'support', slots.support));
            for (const v of this.members) v.setConceal(0.25);
        }
        // set up already (at the start of a war), or in travel order until it's told to deploy
        if (opts.deployed !== false) for (const v of this.living()) { for (const s of deploySteps(v.vid)) v.state[s.g] = 1; this.readyPose(v); }
        else this.state = 'travel';
    }

    // where each member stands, round the site (m, relative to the threat axis: +z behind it)
    slots(n) {
        const out = { launchers: [] };
        const T = this.T;
        if (this.type === 'osa') {
            for (let i = 0; i < n; i++) out.launchers.push({ x: (i - (n - 1) / 2) * 220, z: 0, h: 0 });
            return out;
        }
        out.radar = { x: 0, z: 0, h: 0 };
        out.search = { x: -260, z: 320, h: 0.6 };
        out.command = { x: 150, z: 180, h: -0.3 };
        out.support = { x: -120, z: 260, h: 0.2 };
        const R = this.type === 'patriot' ? 140 : this.type === 'buk' ? 200 : 210;
        for (let i = 0; i < n; i++) {
            const a = (n === 1 ? 0 : (i / (n - 1) - 0.5) * 2.2);
            out.launchers.push(this.type === 'patriot' ? { x: Math.sin(a) * R, z: 90 + Math.cos(a) * 40, h: 0 } : { x: Math.sin(a) * R, z: -Math.cos(a) * R * 0.6, h: 0 });
        }
        void T;
        return out;
    }
    slotPos(slot) {
        const h = this.site.heading, c = Math.cos(h), s = Math.sin(h);
        return { x: this.site.x + slot.x * c + slot.z * s, z: this.site.z - slot.x * s + slot.z * c };
    }
    // deployed: radars turning, launchers at their ready angle
    readyPose(v) {
        if (v.role === 'search' || (v.role === 'radar' && v.vid !== 'patriot_radar') || (v.role === 'launcher' && this.T.own)) v.spinning = true;
        if (v.vid === 'flaplid') v.aimYaw = 0;
    }
    deploy() {
        this.state = 'deploying';
        let n = 0;
        for (const v of this.living()) {
            if (v.moving) continue;
            n++;
            v.play(deploySteps(v.vid)).play([{ fn: () => { this.readyPose(v); this.checkReady(); } }]);
        }
        if (!n) this.checkReady();
    }
    checkReady() {
        const busy = this.living().some(v => v.moving || v.busy);
        if (busy || this.state !== 'deploying') return;
        this.state = 'ready';
        this.movedT = this.war ? this.war.time : 0;
        this.shots = 0;
        this.sys.emit('samReady', this);
    }
    // the eyes: the engagement radar (or, for TELARs, each launcher's own), if set up and emitting
    eyes(out) {
        out.length = 0;
        if (this.state !== 'ready') return out;
        const T = this.T;
        if (T.radar) { if (this.radar && this.radar.alive && this.radarOn) out.push(this.radar); }
        else for (const l of this.launchers) if (l && l.alive && this.radarOn) out.push(l);
        return out;
    }
    // range and lock time now (a Buk without its search radar and command post is on its own radars)
    envelope() {
        const T = this.T;
        let range = T.range, lock = T.lock;
        if (T.degraded && !(this.search && this.search.alive) && !(this.command && this.command.alive)) { range *= T.degraded.range; lock *= T.degraded.lock; }
        return { range, lock };
    }
    // can this radar see the target? (range, the clutter floor, the radar horizon, terrain in the way)
    sees(eye, t, R) {
        const d = eye.pos.distanceTo(t.pos);
        if (d > R) return false;
        const gt = Math.max(terrainHeight(t.pos.x, t.pos.z), 0);
        const agl = t.pos.y - gt;
        if (agl < this.T.altMin) return false;
        const mast = eye.vid === 'p18' ? 10 : eye.vid === 'flaplid' ? 24 : 6;
        const h1 = Math.max(eye.pos.y - Math.max(terrainHeight(eye.pos.x, eye.pos.z), 0), 0) + mast;
        if (d > 4120 * (Math.sqrt(h1) + Math.sqrt(Math.max(agl, 0)))) return false;
        return this.sys.lineOfSight(_v.copy(eye.pos).setY(eye.pos.y + mast), t.pos, d);
    }

    think(dt) {
        const war = this.war;
        if (!war || !this.alive) return;
        const T = this.T;
        // shoot and scoot: found, or a busy day, or just time to move
        if (this.state === 'ready' && !this.adopted) {
            if (this.moveAt === Infinity) {
                if (this.exposed()) this.moveAt = war.time + rand(25, 70);
                else if (this.shots >= (this.type === 'osa' ? 3 : 4)) this.moveAt = war.time + rand(15, 40);
                else if (war.time - this.movedT > this.relocateEvery) this.moveAt = war.time + rand(5, 30);
            }
            if (war.time >= this.moveAt && !this.engaged()) { this.relocate(); return; }
        }
        if (this.state === 'moving' && this.arrived()) this.deploy();
        // radar on/off (an ambush battery stays dark until the IADS cues it)
        const env = this.envelope();
        const targets = this.sys.airTargets(this.team);
        const c = this.centre(_v3);
        let near = false;
        for (const t of targets) if (t.pos.distanceTo(c) < env.range * (this.emcon === 'ambush' ? 0.8 : 1.4)) { near = true; break; }
        const want = this.state === 'ready' && (this.emcon === 'search' ? true : near || this.tracks.size > 0);
        if (want !== this.radarOn) this.setRadar(want);
        if (!this.radarOn) { this.tracks.clear(); return; }
        // (the player's RWR hears a radar that's on once he's in its reach)
        this.rwrAcc = (this.rwrAcc || 0) + dt;
        if (this.rwrAcc > 1) { this.rwrAcc = 0; this.sys.onRadarActive(this); }
        // search and track
        const eyes = this.eyes(this._eyes || (this._eyes = []));
        const own = !!T.own;
        for (const t of targets) {
            if (!t.alive) continue;
            const isMissile = !!t.isStrategic;
            if (isMissile && !this.wantsMissile(t)) continue;
            let seenBy = null;
            for (const e of eyes) if (this.sees(e, t, own ? Math.min(env.range * 1.25, T.own) : T.radarRange * 0.6 + env.range * 0.4)) { seenBy = e; break; }
            let tr = this.tracks.get(t);
            if (!seenBy) { if (tr) { tr.lostT = (tr.lostT || 0) + dt; if (tr.lostT > 2) this.tracks.delete(t); } continue; }
            if (!tr) { tr = { lockT: 0, shots: 0, nextT: 0, eye: seenBy }; this.tracks.set(t, tr); }
            tr.lostT = 0; tr.eye = seenBy;
            const d = seenBy.pos.distanceTo(t.pos);
            if (d > env.range * 1.1) { tr.lockT = Math.max(0, tr.lockT - dt); continue; }
            tr.lockT += dt / (isMissile ? 0.6 : 1);
            if (tr.lockT < env.lock || war.time < tr.nextT) continue;
            if (d < T.rmin || d > env.range) continue;
            if (!isMissile && t.incoming && t.incoming.length >= 2) continue;
            const l = this.pickLauncher(t, own ? seenBy : null);
            if (!l) continue;
            this.salvo(l, t, isMissile ? 2 : T.salvo);
            tr.shots++;
            tr.nextT = war.time + T.interval + (T.salvo > 1 ? T.spacing * (T.salvo - 1) : 0) + rand(0, 2);
        }
        for (const t of this.tracks.keys()) if (!t.alive || !targets.includes(t)) this.tracks.delete(t);
        // turn the launchers' turrets toward what they're tracking
        this.aimLaunchers();
    }
    // Patriot: ballistic and cruise missiles too; S-300: cruise missiles
    wantsMissile(t) {
        const m = this.T.missiles;
        if (!m) return false;
        if (m === 'all') return t.kind !== 'rocket';
        return t.kind === 'cruise' || t.kind === 'antiship';
    }
    engaged() { return [...this.tracks.values()].some(tr => tr.shots > 0 && tr.lockT > 0) || this.game.weapons.missiles.some(m => this.launchers.includes(m.owner)); }
    setRadar(on) {
        this.radarOn = on;
        if (!on) this.rwrIn = false;
        for (const v of this.members) if (v.alive && (v.role === 'radar' || v.role === 'search' || (v.role === 'launcher' && this.T.own))) v.emitting = on;
        if (on) this.sys.onRadarActive(this);
    }
    pickLauncher(t, prefer) {
        const war = this.war;
        let best = null, bd = Infinity;
        for (const l of this.launchers) {
            if (!l || !l.alive || l.ammo <= 0 || war.time < l.nextT || l.busy) continue;
            if (prefer && l !== prefer) continue;
            const d = l.pos.distanceToSquared(t.pos);
            if (d < bd) { bd = d; best = l; }
        }
        return best;
    }
    // where each launcher's turret should train: on the nearest thing it's tracking (a Patriot launcher trains on
    // the threat sector, ±110°, and keeps its fixed 38°)
    aimLaunchers() {
        if (this.T.vertical) return;
        for (const l of this.launchers) {
            if (!l || !l.alive) continue;
            let tgt = null, bd = Infinity;
            for (const [t, tr] of this.tracks) { if (tr.eye !== l && this.T.own) continue; const d = l.pos.distanceToSquared(t.pos); if (d < bd) { bd = d; tgt = t; } }
            const a = this.aims.get(l) || { yaw: 0, pitch: 0 };
            a.yaw = tgt ? l.relYaw(tgt.pos.x, tgt.pos.z) : 0;
            a.pitch = this.type === 'patriot' ? 0 : tgt ? clamp(Math.atan2(tgt.pos.y - l.pos.y, Math.sqrt(bd)) + 0.25, 0.35, 1.0) : 0;
            this.aims.set(l, a);
        }
    }
    // fire n missiles, `spacing` s apart, from launcher l at t
    salvo(l, t, n) {
        const T = this.T;
        for (let i = 0; i < n && i < l.ammo; i++) this.sys.later(i * (T.spacing || 1.5), () => this.fireOne(l, t));
        l.nextT = this.war.time + T.interval;
        this.shots += n;
        if (t === this.game.player && !this.warned) { this.warned = true; }
    }
    fireOne(l, t) {
        if (!l.alive || l.ammo <= 0 || !t.alive || this.state !== 'ready') return;
        const T = this.T;
        let i = 0;
        while (i < 8 && !(l.loaded & (1 << i))) i++;
        if (i >= 8) i = 0;
        const pos = _v.set(0, 0, 0), dir = _v2.set(0, 1, 0);
        l.muzzle(i, pos, dir);
        // (a vertical launch pitches over at once toward the target: the seeker has to see it)
        const to = _v3.subVectors(t.pos, pos).normalize();
        if (T.vertical) dir.set(0, 1, 0).lerp(to, 0.55).normalize();
        else if (dir.dot(to) < 0.6) dir.lerp(to, 0.5).normalize();
        l.launchDir = dir.clone();
        const m = this.game.weapons.fireMissile(l, t, 'sam');
        if (m) {
            m.pos.copy(pos);
            m.vel.copy(dir).multiplyScalar(T.vertical ? 35 : 55);
            m.W = T.W; m.life = T.W.life;
        }
        l.ammo--;
        l.loaded &= ~(1 << i);
        l.firingT = this.war.time;
        this.sys.launchPuff(pos, dir, T.vertical ? 1.2 : 0.7);
        if (l.ammo <= 0) this.reload(l);
    }
    reload(l) {
        const sup = this.support.find(s => s && s.alive);
        const t = sup ? rand(70, 110) : rand(240, 360);
        this.sys.later(t, () => { if (l.alive) { l.ammo = this.T.ammo; l.loaded = (1 << this.T.ammo) - 1; } });
    }
    // pack up and move to a new position (5–14 km, somewhere it hasn't been)
    relocate(to = null) {
        const war = this.war;
        this.moveAt = Infinity;
        this.setRadar(false);
        this.tracks.clear();
        this.state = 'packing';
        const site = to || this.sys.findSite('sam', this.team, this.site, 5000, 14000, this.visited);
        if (!site) { this.state = 'ready'; this.movedT = war ? war.time : 0; return false; }
        this.sys.emit('samRelocating', this, { to: site });
        this.next = { x: site.x, z: site.z, heading: this.threatAxis(site) };
        let n = 0;
        for (const v of this.living()) {
            n++;
            v.spinning = false;
            v.play([{ aim: [0, 0], dur: 4 }]).play(stowSteps(v.vid)).play([{ fn: () => this.leave(v) }]);
        }
        if (!n) this.state = 'ready';
        return true;
    }
    threatAxis(site) {
        // face the enemy's nearest airfield (or the player)
        const f = this.sys.threatFrom(this.team, site);
        return Math.atan2(-(f.x - site.x), -(f.z - site.z));
    }
    leave(v) {
        if (this.state === 'packing') { this.state = 'moving'; this.site = this.next; this.visited.push({ x: this.site.x, z: this.site.z }); if (this.visited.length > 6) this.visited.shift(); }
        const p = this.slotPos(v.slot);
        this.sys.queuePlan(v, p, (r) => {
            if (r) v.drive(r, { onArrive: () => { v.heading = this.site.heading + v.slot.h; if (this.state === 'deploying') v.play(deploySteps(v.vid)).play([{ fn: () => { this.readyPose(v); this.checkReady(); } }]); } });
            else v.setPos(p.x, p.z, this.site.heading + v.slot.h); // (no way there: it turns up anyway, off-screen)
        });
    }
    arrived() { return this.living().every(v => !v.moving && !v.planning); }
    frame(dt) {
        // the tracked aircraft hear the radar lock (the player's RWR: game.js clears lockedBy every frame)
        for (const [t, tr] of this.tracks) if (tr.lockT > 0.5 && !t.isStrategic && tr.eye && tr.eye.alive) (t.lockedBy || (t.lockedBy = new Set())).add(tr.eye);
        // turrets and launchers train at their own pace (~40°/s, elevation ~20°/s)
        if (this.state === 'ready') for (const [l, a] of this.aims) {
            if (!l.alive || l.busy) continue;
            l.aimYaw += clamp(wrap(a.yaw - l.aimYaw), -0.7 * dt, 0.7 * dt);
            l.aimPitch += clamp(a.pitch - l.aimPitch, -0.35 * dt, 0.35 * dt);
        }
    }
    onHit(v) {
        const war = this.war;
        if (war && this.state === 'ready' && this.moveAt === Infinity) this.moveAt = war.time + rand(10, 30);
        void v;
    }
    onKilled(v) {
        if (v === this.radar && this.T.blind) this.sys.emit('samBlind', this);
    }
}

// ═════════════ Rocket artillery ═════════════
export const MLRS_TYPES = {
    grad: { vid: 'grad', missile: 'grad', stock: 2, aim: 12, maxPitch: 0.96, yaw: [-1.22, 1.78], range: 20000, reload: 150, face: true },
    smerch: { vid: 'smerch', missile: 'smerch', stock: 1, aim: 14, maxPitch: 0.96, yaw: [-0.52, 0.52], range: 70000, reload: 220, face: true },
    himars: { vid: 'himars', missile: 'gmlrs', stock: 1, aim: 14, maxPitch: 1.05, yaw: [-Math.PI, Math.PI], range: 70000, reload: 180 },
    m270: { vid: 'm270', missile: 'gmlrs', stock: 2, aim: 16, maxPitch: 1.05, yaw: [-Math.PI, Math.PI], range: 70000, reload: 200 },
};

// A battery of launchers (any mix of MLRS types) with a command vehicle and an ammunition truck.
// opts: { types: ['grad', 'grad', 'grad'], kind: 'artillery' | 'launcher' (a launcher-kind battery carries
// ATACMS for the ballistic / hardened strikes), stock, command, support, spread }
export class RocketBattery extends Group {
    constructor(sys, team, site, opts = {}) {
        super(sys, 'battery', team, { name: opts.name });
        this.every = 0.5;
        this.site = { x: site.x, z: site.z, heading: site.heading ?? 0 };
        this.kind2 = opts.kind || 'artillery';
        this.launchers = [];
        this.firing = [];            // firing points nearby
        const types = opts.types || ['grad', 'grad', 'grad'];
        const spread = opts.spread ?? 180;
        types.forEach((type, i) => {
            const M = MLRS_TYPES[type];
            const a = (i - (types.length - 1) / 2) * 0.9;
            const p = { x: site.x + Math.sin(site.heading + a) * spread * (i ? 1 : 0.3), z: site.z + Math.cos(site.heading + a) * spread * (i ? 1 : 0.3) };
            const v = sys.spawnVehicle(M.vid, team, p, { heading: site.heading + rand(-0.4, 0.4) });
            v.role = 'launcher'; v.mlrs = M; v.home = { x: p.x, z: p.z, heading: v.heading };
            this.add(v);
            const stock = opts.stock ? { ...opts.stock } : { [M.missile]: M.stock };
            v.src = sys.strikes ? sys.strikes.addSource(new VehicleLauncher(sys.strikes, v, { kind: this.kind2, name: opts.sourceName || v.realName, stock, final: 2, range: M.range * (this.kind2 === 'launcher' ? 4 : 1) })) : null;
            v.maxStock = { ...stock };
            v.fstate = 'idle';
            v.muzzleI = 0;
            this.launchers.push(v);
        });
        if (opts.command !== false) { const c = sys.spawnVehicle(team === 'blue' ? 'cmd_blue' : 'cmd_red', team, { x: site.x - Math.sin(site.heading) * 260, z: site.z - Math.cos(site.heading) * 260 }, { heading: site.heading }); c.role = 'command'; this.add(c); c.state.raise = 1; }
        if (opts.support !== false) { const s = sys.spawnVehicle(team === 'blue' ? 'fuel_blue' : 'ammo_red', team, { x: site.x - Math.sin(site.heading + 0.6) * 330, z: site.z - Math.cos(site.heading + 0.6) * 330 }, { heading: site.heading }); s.role = 'support'; this.add(s); this.support = s; }
        for (const v of this.members) v.setConceal(team === 'red' ? 0.45 : 0.3);
    }
    // ── the strike manager's side (per launcher) ──
    canTakeOrder(src) { const v = src.unit; return v.alive && ['idle', 'hide'].includes(v.fstate); }
    prepEstimate(src) { const v = src.unit; return v.mlrs.aim + (v.vid === 'smerch' ? 6 : 0) + 8; }
    onFireOrder(src, specKey, aim) { this.mission(src.unit, aim.pos); }
    readyToFire(src) { return src.unit.fstate === 'aimed'; }
    launchFrame(src, out, dir, q) {
        const v = src.unit;
        const n = v.live ? v.live.rig.muzzles.length : 12;
        v.muzzle(v.muzzleI++ % Math.max(n, 1), out, dir);
        void q;
        return true;
    }
    onLaunch(src, q, m) {
        const v = src.unit;
        v.firingT = this.war.time;
        // the last rocket of the salvo: stow and go
        if (!src.queue.length) { v.fstate = 'fired'; this.sys.later(3, () => this.afterSalvo(v)); }
        void q; void m;
    }
    // a rocket salvo 12 km from the camera at both ends flies abstractly (sys.abstractRocket)
    abstractLaunch(src, q) {
        const spec = MISSILES[q.specKey];
        if (!spec || spec.kind !== 'rocket') return false;
        return this.sys.abstractRocket(src, q, spec);
    }
    // ── a fire mission: every launcher that can fires a salvo (or just `n` of them) at the target ──
    fireMission(target, opts = {}) {
        const at = target.pos || target;
        const aim = { pos: new THREE.Vector3(at.x, at.y ?? Math.max(terrainHeight(at.x, at.z), 0), at.z), unit: target.pos ? target : null, label: opts.label || 'TARGET' };
        let strike = opts.strike || null, fired = 0;
        for (const v of this.launchers) {
            if (opts.n && fired >= opts.n) break;
            if (!v.alive || !v.src || (opts.only && v !== opts.only)) continue;
            const key = opts.missile && v.src.stock[opts.missile] > 0 ? opts.missile : Object.keys(v.src.stock).find(k => v.src.stock[k] > 0);
            if (!key || !v.src.canFire(key)) continue;
            if (Math.hypot(at.x - v.pos.x, at.z - v.pos.z) > v.src.range) continue;
            // (the strike record, for our HUD and BDA, once someone's going to fire; the enemy's salvos don't need
            // one — and a launch with one reads as a missile launch to find, tasks.js)
            if (!strike && this.war && this.team === this.war.side) strike = this.sys.makeStrike(this.team, MISSILES[key].kind === 'rocket' ? 'rocket' : 'ballistic', aim);
            if (v.src.fire(key, 1, aim, strike)) { fired++; if (strike) { strike.planned += MISSILES[key].kind === 'rocket' ? MISSILES[key].count : 1; strike.sources.add(v.src); } }
        }
        if (fired) this.sys.emit('salvoOrdered', this, { target: aim, launchers: fired });
        return fired;
    }
    // one launcher's fire mission: out of its hide to a firing point if it's in one, face the target (Grad and
    // Smerch traverse only so far), elevate, and wait for the countdown
    mission(v, at) {
        v.target = at;
        const M = v.mlrs;
        const rel = v.relYaw(at.x, at.z);
        const within = rel >= M.yaw[0] + 0.1 && rel <= M.yaw[1] - 0.1;
        v.fstate = 'moving';
        if (!within) {
            // a short drive to point the launcher at the target: along a line toward it, 120 m
            const d = Math.hypot(at.x - v.pos.x, at.z - v.pos.z) || 1;
            const ux = (at.x - v.pos.x) / d, uz = (at.z - v.pos.z) / d;
            const p1 = { x: v.pos.x + ux * 60 - uz * 40, z: v.pos.z + uz * 60 + ux * 40 }, p2 = { x: p1.x + ux * 70, z: p1.z + uz * 70 };
            const r = this.sys.offRoute(v, [p1, p2]);
            if (r) { v.drive(r, { onArrive: () => this.lay(v) }); return; }
        }
        this.lay(v);
    }
    lay(v) {
        const M = v.mlrs, at = v.target;
        v.fstate = 'laying';
        const d = Math.hypot(at.x - v.pos.x, at.z - v.pos.z);
        const yaw = clamp(v.relYaw(at.x, at.z), M.yaw[0], M.yaw[1]);
        // elevation: flatter for a short shot, up to ~50° at the longest range (the rocket's speed is solved for it)
        const pitch = clamp(0.55 + (d / M.range) * 0.45, 0.52, M.maxPitch);
        const steps = [];
        if (v.vid === 'smerch') steps.push(...deploySteps('smerch'));
        // (raise the launcher before traversing it off the cab)
        steps.push({ aim: [0, Math.min(pitch, 0.35)], dur: M.aim * 0.35 }, { aim: [yaw, pitch], dur: M.aim * 0.65 }, { fn: () => { v.fstate = 'aimed'; } });
        v.play(steps);
        v.setConceal(0.15);
    }
    afterSalvo(v) {
        v.fstate = 'stowing';
        const steps = [{ aim: [0, 0.2], dur: v.mlrs.aim * 0.5 }, { aim: [0, 0], dur: v.mlrs.aim * 0.3 }];
        if (v.vid === 'smerch') steps.push(...stowSteps('smerch'));
        steps.push({ fn: () => this.scoot(v) });
        v.play(steps);
        // reload from the ammunition truck
        this.sys.later(v.mlrs.reload * (this.support && this.support.alive ? 1 : 2.5), () => {
            if (!v.alive || !v.src) return;
            for (const [k, n] of Object.entries(v.maxStock)) v.src.stock[k] = Math.max(v.src.stock[k] || 0, n);
        });
    }
    // shoot and scoot: 400–1500 m across country to a new spot (a counter-battery salvo lands on an empty field)
    scoot(v) {
        v.fstate = 'moving';
        const site = this.sys.findSite('firing', v.team, v.pos, 400, 1500) || this.sys.findSite('hide', v.team, v.pos, 400, 1500);
        const done = () => { v.fstate = 'idle'; v.setConceal(v.team === 'red' ? 0.4 : 0.3); if (v.src && v.src.queue.length) this.mission(v, v.target); };
        if (!site) { done(); return; }
        const r = this.sys.plan(v, site, { direct: 1800 });
        if (r) v.drive(r, { onArrive: done }); else done();
        this.sys.later(25, () => { if (v.alive && v.team !== (this.war && this.war.side)) this.game.events.emit('telRelocated', v); });
    }
    think() {}
}

// ═════════════ Convoys ═════════════
export const CONVOYS = {
    red: [['btr80', 'cmd_red', 'fuel_red', 'ammo_red', 'osa', 'fuel_red', 'ammo_red', 'btr80'], ['btr80', 'scud', 'crane', 'fuel_red', 'cmd_red', 'osa'], ['btr80', 's300', 's300', 'flaplid', 'ammo_red', 'fuel_red'], ['ammo_red', 'grad', 'grad', 'ammo_red', 'fuel_red', 'btr80']],
    blue: [['stryker', 'cmd_blue', 'fuel_blue', 'ammo_blue', 'fuel_blue', 'stryker'], ['stryker', 'himars', 'himars', 'ammo_blue', 'cmd_blue', 'stryker'], ['hemtt', 'fuel_blue', 'fuel_blue', 'ammo_blue', 'stryker']],
};
const CONVOY_CALLS = { blue: ['CARAVAN', 'MULE', 'PACKHORSE', 'WAGON', 'DRAYMAN'], red: ['CONVOY'] };
const SPACING = 48;

// opts: { callsign, cap (m/s), destName, spacing }
export class Convoy extends Group {
    constructor(sys, team, route, composition, opts = {}) {
        super(sys, 'convoy', team, { name: opts.callsign });
        this.every = 0.5;
        this.route = route;
        this.callsign = opts.callsign || (team === (sys.game.war ? sys.game.war.side : 'blue') ? pick(CONVOY_CALLS.blue) + ' ' + (1 + Math.floor(Math.random() * 4)) : 'CONVOY');
        this.spacing = opts.spacing || SPACING;
        this.cap = opts.cap || 11;
        this.state = 'move';
        this.t = 0; this.quietT = 0; this.arrived = 0; this.returned = 0;
        const n = composition.length;
        const lead0 = Math.min(route.len * 0.5, (n - 1) * this.spacing + 15);
        this.vehicles = [];
        let prev = null;
        composition.forEach((vid, k) => {
            const s = Math.max(0, lead0 - k * this.spacing);
            const p = route.at(s, {}, 0);
            const v = sys.spawnVehicle(vid, team, p, { heading: Math.atan2(-p.tx, -p.tz) });
            v.convoyOf = this; v.role = 'convoy'; v.slotK = k;
            this.add(v);
            v.drive(route, { s, lead: prev, gap: this.spacing, cap: this.cap, end: Math.max(route.len - k * this.spacing, s + 1), onArrive: () => this.vehicleArrived(v) });
            v.placeOnRoute();
            v.setConceal(team === 'red' ? 0.15 : 0);
            this.vehicles.push(v);
            prev = v;
        });
        this.total = this.vehicles.length;
        const endP = route.at(route.len, {}, route.n - 2);
        this.destPos = new THREE.Vector3(endP.x, endP.y, endP.z);
        this.destName = opts.destName || sys.placeName(this.destPos);
        this.startPos = this.vehicles[0].pos.clone();
        // keep the civilian traffic off its roads
        const tr = sys.game.world && sys.game.world.towns && sys.game.world.towns.traffic;
        if (tr && tr.clearPath) for (const p of route.roadPaths()) tr.clearPath(p);
    }
    // (the director's convoy interface: tasks.js reads these)
    alive() { return this.vehicles.filter(v => v.alive && !v.removed); }
    leadVehicle() { let best = null, bs = -Infinity; for (const v of this.vehicles) if (v.alive && !v.removed && v.route.s > bs && v.route.r === this.route) { bs = v.route.s; best = v; } return best || this.alive()[0] || null; }
    centre(out = new THREE.Vector3()) { const a = this.alive(); out.set(0, 0, 0); if (!a.length) return out.copy(this.destPos); for (const v of a) out.add(v.pos); return out.divideScalar(a.length); }

    vehicleArrived(v) {
        if (this.state !== 'move') return;
        const a = this.alive();
        if (a.every(x => !x.moving)) this.finish('arrived');
        void v;
    }
    finish(why) {
        if (this.done) return;
        this.done = true;
        this.state = why;
        const a = this.alive();
        if (why === 'arrived') this.arrived = a.filter(v => !v.dismounted).length;
        this.sys.onConvoyEnd(this, why);
        // parked at the destination a while, then gone (into the base, on to the front)
        if (why === 'arrived' || why === 'turned back') this.sys.later(90, () => { for (const v of this.alive()) this.sys.removeVehicle(v); });
    }
    think(dt) {
        this.t += dt;
        const a = this.alive();
        if (!a.length) { if (!this.done) this.finish('destroyed'); return; }
        if (this.done) return;
        // our intelligence picks up an enemy column after a while (tasks.js offers the attack on it)
        const war = this.war;
        if (war && this.team !== war.side && !this.reported && this.reportT != null && war.time > this.reportT) {
            const lead = this.leadVehicle();
            if (lead) {
                this.reported = true;
                const c = _v.copy(lead.pos).add(_v2.set(rand(-1200, 1200), 0, rand(-1200, 1200)));
                this.report = war.report({ text: 'ENEMY CONVOY MOVING ON THE ROAD NEAR ' + this.sys.placeName(lead.pos), center: c, radius: 2600, unit: lead, cls: 'convoy', say: false });
            }
        }
        // a bridge down ahead of the column: stop short of the gap, and after a while turn back
        if (this.state === 'move') {
            const lead = this.leadVehicle();
            const gap = lead && this.gapAhead(lead.route.s);
            if (gap != null && gap - lead.route.s < 900) {
                this.state = 'halt'; this.haltT = 0;
                a.forEach((v, k) => { if (v.route.r === this.route) v.route.end = Math.max(v.route.s, gap - 40 - k * this.spacing); });
                this.sys.onConvoyHalt(this);
            }
        } else if (this.state === 'halt') {
            this.haltT += dt;
            if (this.haltT > 40) this.turnBack();
        } else if (this.state === 'scatter') {
            this.quietT += dt;
            if (this.quietT > 75 && !this.threatNear(this.centre(_v), 5000, 2500)) this.regroup();
        } else if (this.state === 'regroup') {
            if (a.every(v => v.route.r === this.route || v.dismounted)) {
                this.state = 'move';
                for (const v of a) if (v.route.r === this.route) v.route.hold = false;
            }
        }
    }
    // the arc length on the route (past s) where the first bridge that's down begins, or null
    gapAhead(s) {
        let best = null;
        for (const leg of this.route.legs) {
            if (leg.kind !== 'road' || leg.to < s) continue;
            for (const br of leg.path.bridges || []) {
                if (!br.bridge || br.bridge.alive !== false) continue;
                const rs = this.locate(leg, br.bridge);
                if (rs != null && rs > s && (best === null || rs < best)) best = rs;
            }
        }
        return best;
    }
    // where on the route a bridge begins: the route point nearest either end of it, within this leg
    locate(leg, b) {
        const R = this.route;
        let best = null, bd = 1e12;
        for (let i = 0; i < R.n; i++) {
            if (R.s[i] < leg.from || R.s[i] > leg.to) continue;
            const d = Math.min((R.x[i] - b.a.x) ** 2 + (R.z[i] - b.a.z) ** 2, (R.x[i] - b.b.x) ** 2 + (R.z[i] - b.b.z) ** 2);
            if (d < bd) { bd = d; best = R.s[i]; }
        }
        return bd < 120 * 120 ? best : null;
    }
    turnBack() {
        this.state = 'back';
        for (const v of this.alive()) {
            this.sys.queuePlan(v, this.startPos, (r) => { if (r) v.drive(r, { cap: this.cap, onArrive: () => { this.returned++; if (this.alive().every(x => !x.moving)) this.finish('turned back'); } }); });
        }
    }
    // attacked: every vehicle off the road, 50–110 m to alternate sides, into what cover there is
    scatter(threat) {
        if (this.state === 'scatter' || this.done) return;
        this.state = 'scatter'; this.quietT = 0;
        const a = this.alive();
        a.forEach((v, k) => {
            if (v.route.r !== this.route) return;
            v.savedS = v.route.s;
            const p = this.route.at(v.route.s, {}, v.route.i);
            const side = k % 2 ? 1 : -1;
            let best = null;
            for (let tries = 0; tries < 6 && !best; tries++) {
                const off = rand(50, 110) * side * (tries > 2 ? -1 : 1);
                const x = p.x - p.tz * off + p.tx * rand(-20, 30), z = p.z + p.tx * off + p.tz * rand(-20, 30);
                if (this.sys.driveable(x, z)) best = { x, z };
            }
            if (!best) { v.route.hold = true; return; }
            const r = this.sys.offRoute(v, [best]);
            if (r) v.drive(r, { cap: 9, onArrive: () => this.dispersed(v, threat) }); else v.route.hold = true;
        });
        this.sys.onConvoyScatter(this, threat);
    }
    dispersed(v, threat) {
        v.setConceal(0.3 + (this.sys.env ? this.sys.env.forest(v.pos.x, v.pos.z) * 0.5 : 0));
        // troops out of the carriers
        if (v.u.troops && !v.dismounted) {
            v.dismounted = true;
            v.play([{ g: 'door', to: 1, dur: 3 }]);
            this.sys.later(2.5, () => this.sys.dismount(v, threat));
        }
        // an SA-8 in the column puts its radar up and fights
        if (SAM_TYPES[v.vid] && !v.escortGroup) v.escortGroup = this.sys.escortSam(v);
    }
    // quiet again: back to where each one left the road, and on
    regroup() {
        this.state = 'regroup';
        for (const v of this.alive()) {
            if (v.dismounted) continue; // (the carriers stay with their troops)
            if (v.route.r === this.route) { v.route.hold = false; continue; }
            const back = () => {
                const s = v.savedS ?? 0;
                const p = this.route.at(s, {}, 0);
                const r = this.sys.offRoute(v, [{ x: p.x, z: p.z }]);
                const resume = () => {
                    const k = this.vehicles.indexOf(v);
                    let lead = null;
                    for (let j = k - 1; j >= 0; j--) if (this.vehicles[j].alive && !this.vehicles[j].dismounted) { lead = this.vehicles[j]; break; }
                    v.drive(this.route, { s, lead, gap: this.spacing, cap: this.cap, end: Math.max(this.route.len - k * this.spacing, s + 1), onArrive: () => this.vehicleArrived(v) });
                    v.route.hold = true;
                    v.setConceal(this.team === 'red' ? 0.15 : 0);
                };
                if (r) v.drive(r, { cap: 6, onArrive: resume }); else resume();
            };
            // an SA-8 that put its radar up lowers it first
            if (v.escortGroup) { this.sys.dropEscort(v); v.play(stowSteps(v.vid)).play([{ fn: back }]); } else back();
        }
    }
    onHit(v, source) {
        if (this.state === 'move' || this.state === 'halt') this.scatter(source);
        this.quietT = 0;
    }
    onKilled(v, source) { this.onHit(v, source); }
}

// ═════════════ Coastal missile battery ═════════════
// Bastion launchers wait in a hide; to fire, they drive to the shore, open the housing, jack up, erect the
// canisters and launch P-800s at the ships (vertically: the missile tips over toward the sea).
export class CoastalBattery extends Group {
    constructor(sys, team, site, opts = {}) {
        super(sys, 'coastal', team, { name: opts.name || 'COASTAL MISSILE BATTERY' });
        this.every = 0.5;
        this.site = { x: site.x, z: site.z, heading: site.heading ?? 0 };
        this.shore = opts.shore || [];      // firing points by the sea
        this.launchers = [];
        const n = opts.launchers ?? 2;
        for (let i = 0; i < n; i++) {
            const p = { x: site.x + (i - (n - 1) / 2) * 60 * Math.cos(site.heading), z: site.z - (i - (n - 1) / 2) * 60 * Math.sin(site.heading) };
            const v = sys.spawnVehicle('bastion', team, p, { heading: site.heading });
            v.role = 'launcher'; v.home = { x: p.x, z: p.z, heading: site.heading };
            v.loaded = 3; v.fstate = 'hide';
            this.add(v);
            v.src = sys.strikes ? sys.strikes.addSource(new VehicleLauncher(sys.strikes, v, { kind: 'battery', name: opts.sourceName || 'BASTION BATTERY', stock: { oniks: 2 }, final: 3, range: 90000 })) : null;
            this.launchers.push(v);
        }
        const radar = sys.spawnVehicle('p18', team, { x: site.x - Math.sin(site.heading) * 300, z: site.z - Math.cos(site.heading) * 300 }, { heading: site.heading });
        radar.role = 'search'; radar.radarRange = 60000; radar.spinning = true; radar.emitting = true; radar.state.jack = 1; radar.state.raise = 1;
        this.add(radar); this.radar = radar;
        const cmd = sys.spawnVehicle('cmd_red', team, { x: site.x + Math.cos(site.heading) * 200, z: site.z - Math.sin(site.heading) * 200 }, { heading: site.heading });
        cmd.role = 'command'; cmd.state.raise = 1; this.add(cmd);
        for (const v of this.members) v.setConceal(v.role === 'launcher' ? 0.75 : 0.35);
    }
    canTakeOrder(src) { return src.unit.alive && src.unit.fstate === 'hide'; }
    prepEstimate(src) { const v = src.unit; return 40 + (this.shore.length ? Math.hypot(this.shore[0].x - v.pos.x, this.shore[0].z - v.pos.z) / 8 : 0); }
    onFireOrder(src) { this.sortie(src.unit); }
    readyToFire(src) { return src.unit.fstate === 'ready'; }
    launchFrame(src, out, dir) {
        const v = src.unit, i = (v.shot = (v.shot || 0) + 1) - 1;
        v.muzzle(i % 2, out, dir);
        dir.set(0, 1, 0);
        return true;
    }
    onLaunch(src) {
        const v = src.unit;
        v.firingT = this.war.time;
        v.loaded &= ~(1 << ((v.shot - 1) % 2));
        if (!src.queue.length) { v.fstate = 'fired'; this.sys.later(4, () => this.home(v)); }
    }
    // fire at a ship: n missiles from each launcher that can
    fireMission(target, opts = {}) {
        const aim = { pos: target.pos || target, unit: target.pos ? target : null, label: opts.label || (target.name || 'SHIP') };
        let strike = null, n = 0;
        for (const v of this.launchers) {
            if (!v.alive || !v.src || !v.src.canFire('oniks')) continue;
            if (!strike) strike = this.sys.makeStrike(this.team, 'antiship', aim);
            const k = v.src.fire('oniks', opts.per || 2, aim, strike);
            if (k) { n += k; if (strike) { strike.planned += k; strike.sources.add(v.src); } }
        }
        return n;
    }
    sortie(v) {
        v.fstate = 'moving';
        v.setConceal(0.1);
        const p = this.shore.length ? pick(this.shore) : null;
        const go = () => { v.fstate = 'deploying'; v.play(deploySteps('bastion')).play([{ fn: () => { v.fstate = 'ready'; } }]); };
        if (!p) { go(); return; }
        const r = this.sys.plan(v, p, {});
        if (r) v.drive(r, { onArrive: go }); else go();
    }
    home(v) {
        v.fstate = 'stowing';
        v.play(stowSteps('bastion')).play([{ fn: () => {
            v.fstate = 'moving';
            const r = this.sys.plan(v, v.home, {});
            const back = () => { v.fstate = 'hide'; v.setConceal(0.75); v.heading = v.home.heading; if (v.src) { v.src.stock.oniks = Math.max(v.src.stock.oniks || 0, 0); } this.sys.later(420, () => { if (v.alive && v.src) { v.src.stock.oniks = 2; v.loaded = 3; } }); };
            if (r) v.drive(r, { onArrive: back }); else back();
        } }]);
    }
}

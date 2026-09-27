// ═══════════════════════════════════════════════════════════════
// Mobile forces (docs/WAR.md, "Mobile forces"): the war's ground units that move — SCUD TELs that hide, set up,
// fire and relocate; mobile SAM batteries that shoot and scoot; rocket artillery (Grad, Smerch, HIMARS, M270);
// convoys driving the roads between bases and towns; a coastal missile battery; and the search-and-destroy hunt
// for a launcher on the move. A plug-in system (systems.js) as game.forces (alias game.mobile).
//  • every vehicle is a rigged model (vehicles.js) driven by forcesunits.js: abstract (a point moving along its
//    route) far away, a merged static copy within ~7 km, the live rig close in or while it animates (a budget)
//  • behaviour lives in forcesgroups.js (TelUnit, SamGroup, RocketBattery, Convoy, CoastalBattery); the roads,
//    routes and hide sites in forcesnav.js; compounds and shelters in forcesites.js
//  • it plugs into the rest: war registry (intel, conceal, radars for war.coverage), strikes (red TELs and
//    coastal batteries, our HIMARS / M270 as ballistic, hardened and rocket-artillery sources), the director
//    (its convoys drive as ours; its missile strikes reach our TELs), the front (its Grad batteries are ours),
//    tasks (search and destroy, SAMs on the move), infantry (troops dismount from APCs)
// API for the director, tasks and sandbox tools (all return the unit or group, or null):
//   forces.spawnTEL(team, pos, opts) · spawnSAM(team, type, pos, opts) · spawnArtillery(team, type, pos, opts)
//   spawnConvoy(team, from, to, composition, opts) · spawnCoastal(team, pos, opts) · startSearch(opts)
//   fireMission(unitOrGroup, target, opts) · relocate(unitOrGroup, to)
//   forces.auto.{ tel, search, artillery, counterBattery, coastal, convoys } — the built-in tasking to switch off
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { VEHICLES, hasVehicle, vehiclesReady, createVehicle, staticVehicle, setJoint, updateRams, stow as stowRig, muzzleWorld } from './vehicles.js';
import { MISSILES, STRIKE_TYPES } from './strikes.js';
import { BASES, terrainHeight, baseToWorld } from './world.js';
import { outsideBases } from './roads.js';
import { INTEL } from './war.js';
import { RoadNet, Route, planRoute, offRoute, legClear, forestDensity, forestSite, valleySite, roadsideSite, firingSite, samSite, compoundSite, shelterSite, bridgeSites } from './forcesnav.js';
import { ForceVehicle, GROUPS, WRECK_MATERIALS, paintFor } from './forcesunits.js';
import { TelUnit, SamGroup, RocketBattery, Convoy, CoastalBattery, SAM_TYPES, MLRS_TYPES, CONVOYS, deploySteps } from './forcesgroups.js';
import { buildCompound, buildShelter } from './forcesites.js';
import { clamp, rand, pick } from './util.js';

const MESH_R = 7000, MESH_OUT = 7600;   // a mesh within this of the camera (m)
const LIVE_MOVE = 650, LIVE_ANIM = 3800; // the live rig: close to a moving vehicle, or further out while it animates
const MAX_LIVE = 5;                      // live rigs at once (a tracked vehicle is ~50 draw calls live, 2–4 merged)
const SITE_R = 8000;                     // compounds and shelters drawn within this
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const RED_GRID = ['14TH', '22ND', '36TH', '112TH'];

export class MobileForces {
    constructor(game) {
        this.game = game;
        game.mobile = this; // (the other name the director's notes use)
        this.units = [];
        this.groups = [];
        this.sites = [];            // built compounds and shelters
        this.timers = [];
        this.planQ = [];
        this.nextId = 1;
        this.enabled = false;
        this.templates = new Map(); // 'vid|paint|pose|dead' → Group (merged; clone per vehicle)
        this.buildQ = [];
        this.posers = new Map();    // 'vid|paint' → { object, rig } used to pose templates
        this.pool = new Map();      // 'vid|paint' → [{ object, rig }] live rigs not in use
        this.hard = new Map();      // vid → measured launch points
        this.auto = { tel: true, search: true, artillery: true, counterBattery: true, coastal: true, convoys: true };
        this.stats = { units: 0, meshed: 0, live: 0, ms: 0 };
        this.meshOK = false;
        this.frame = 0;
        this.prewarm();
    }

    get war() { return this.game.war; }
    get strikes() { return this.game.strikes && this.game.strikes.enabled ? this.game.strikes : null; }

    // ═════════════ Lifecycle ═════════════
    start(mode, opts = {}) {
        this.clear();
        this.mode = mode;
        const g = this.game;
        this.enabled = !['rings', 'practice', 'mission'].includes(mode) && !!g.war;
        if (!this.enabled) return;
        this.full = mode === 'war' || mode === 'sandbox';
        this.buildEnv();
        vehiclesReady().then(() => { this.meshOK = true; }).catch(() => {});
        this.tacking = { tel: rand(300, 420), search: rand(240, 400), coastal: rand(360, 540), artillery: rand(60, 120), convoy: rand(40, 90) };
        if (opts.forces === false || mode === 'test') return;
        try { this.populate(); } catch (e) { console.warn('[forces] populate', e); }
    }

    clear() {
        for (const v of this.units) { this.releaseMesh(v); if (v.src && this.game.strikes) this.game.strikes.removeSource(v.src); }
        for (const gr of this.groups) if (gr.launcher && this.game.strikes) this.game.strikes.removeSource(gr.launcher);
        for (const s of this.sites) if (s.group && s.group.parent) s.group.parent.remove(s.group);
        const gt = this.game.ground && this.game.ground.targets;
        if (gt) for (let i = gt.length - 1; i >= 0; i--) if (gt[i] instanceof ForceVehicle) gt.splice(i, 1);
        this.units.length = 0; this.groups.length = 0; this.sites.length = 0; this.timers.length = 0; this.planQ.length = 0;
        this.brigades = []; this.search = null; this.cbPending = [];
        this.enabled = false;
    }

    // the ground, the roads, the hide-site finders' view of the world
    buildEnv() {
        const g = this.game, war = g.war, towns = g.world && g.world.towns;
        if (towns && towns.paths) {
            // (the network doesn't change between sorties: bridges that fall are checked as routes are made)
            if (!towns._forcesNet) towns._forcesNet = new RoadNet([...towns.paths, ...(towns.streetPaths || [])], towns.junctions || []);
            this.net = towns._forcesNet;
        } else this.net = null;
        const bl = towns && towns.buildings;
        this.env = {
            heightAt: terrainHeight,
            sideAt: (x, z) => war.sideAt(x, z),
            forest: forestDensity,
            blocked: towns && towns.blocked ? (x, z) => towns.blocked(x, z) : null,
            solid: (x, z) => !!outsideBases(x, z, 20) || !!(bl && bl.at && bl.at(x, terrainHeight(x, z) + 1.5, z, 2)),
            inTown: towns && towns.towns ? (x, z) => towns.towns.some(t => (t.x - x) ** 2 + (t.z - z) ** 2 < (t.radius + 150) ** 2) : null,
            nearBase: (x, z, m) => BASES.some(b => Math.hypot(x - b.x, z - b.z) < b.r + m),
            net: this.net,
            bridges: towns ? towns.bridges : [],
            rand: Math.random,
            ok: null,
        };
    }

    // ═════════════ The order of battle ═════════════
    populate() {
        const g = this.game;
        // ours, wherever strikes run: the rocket artillery and ATACMS launchers the command menu calls on
        this.placeBlueStrike();
        if (!this.full) return;
        this.placePatriots();
        this.placeScud();
        this.placeSams();
        this.placeCoastal();
        this.placeSmerch();
        // (the front, when there's one, places its Grad batteries after us: frontBattery)
        if (!g.front || !g.front.addBattery) this.placeRedGrads();
    }

    // distance from the front line (m)
    frontDist(x, z) {
        const F = this.war.front;
        let best = Infinity;
        for (let i = 0; i + 1 < F.length; i++) {
            const a = F[i], b = F[i + 1], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
            const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
            best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
        }
        return best;
    }
    // a finder with a band of distance from the front
    within(dMin, dMax, fn) {
        this.env.ok = (x, z) => { const d = this.frontDist(x, z); return d >= dMin && d <= dMax; };
        try { return fn(); } finally { this.env.ok = null; }
    }
    anchor(team) {
        const b = team === 'red' ? BASES.find(x => x.id === 'enemy') : BASES.find(x => x.id === 'home');
        return b ? { x: b.x, z: b.z } : { x: 0, z: team === 'red' ? -17000 : 0 };
    }

    placeBlueStrike() {
        const home = this.anchor('blue');
        // an ATACMS section near home (the BALLISTIC and HARDENED strikes), a GMLRS battery up toward the line
        const s1 = this.place('firing', 'blue', home, 2500, 12000);
        if (s1) this.spawnArtillery('blue', 'atacms', s1, { name: 'STEEL RAIN' });
        const s2 = this.place('firing', 'blue', home, 3000, 18000, [2500, 10000], s1 ? [s1] : []);
        if (s2) this.spawnArtillery('blue', 'gmlrs', s2, { name: 'THUNDER' });
    }

    placePatriots() {
        const home = BASES.find(b => b.id === 'home'), mir = BASES.find(b => b.id === 'miramar');
        for (const b of [home, mir]) {
            if (!b) continue;
            const s = this.place('sam', 'blue', b, b.r + 700, b.r + 3200);
            if (s) this.spawnSAM('blue', 'patriot', s, { name: 'PATRIOT BATTERY ' + (b === home ? 'ALPHA' : 'BRAVO') });
        }
    }

    placeScud() {
        const red = this.anchor('red');
        const b = this.brigade('red', red, { tels: this.game.difficulty && this.game.difficulty.skill > 0.8 ? 3 : 2 });
        if (b) this.brigades.push(b);
    }

    // A TEL brigade: its hides (forest edges, valleys, beside highways, under bridges, a compound, a shelter),
    // pre-surveyed firing points, and the transloader with the reloads
    brigade(team, near, { tels = 2, name = null } = {}) {
        const env = this.env;
        const B = { team, name: name || (team === 'red' ? pick(RED_GRID) + ' MISSILE BRIGADE' : 'MISSILE BATTALION'), hides: [], firing: [], occupied: new Set(), reload: null, tels: [] };
        const hideBand = () => this.within(6000, 22000, () => {
            for (const kind of ['forest', 'valley', 'forest', 'roadside', 'valley', 'forest', 'roadside', 'forest']) {
                const s = this.findSite(kind, team, near, 2000, 16000);
                if (s) B.hides.push(s);
            }
        });
        hideBand();
        for (const s of bridgeSites(env, team).slice(0, 2)) B.hides.push(s);
        for (let k = 0; k < 6 && B.hides.length < tels + 3; k++) { const s = this.findSite('hide', team, near, 2000, 16000); if (s) B.hides.push(s); }
        // a compound (the transloader waits there with the reloads) and a hardened shelter
        const cs = this.within(7000, 22000, () => this.findSite('compound', team, near, 1500, 14000));
        if (cs) {
            const c = this.buildSite('compound', cs);
            B.reload = { site: { kind: 'compound', x: c.spots[0].x, z: c.spots[0].z, heading: c.spots[0].heading, conceal: 0.8 }, reserves: tels + 1, crane: null };
            for (const sp of c.spots.slice(1)) B.hides.push({ kind: 'compound', x: sp.x, z: sp.z, heading: sp.heading, conceal: 0.8 });
            const crane = this.spawnVehicle('crane', team, { x: c.spots[1] ? c.spots[1].x : cs.x, z: c.spots[1] ? c.spots[1].z : cs.z }, { heading: cs.heading });
            crane.setConceal(0.8); crane.role = 'support';
            B.reload.crane = crane;
            const cmd = this.spawnVehicle(team === 'red' ? 'cmd_red' : 'cmd_blue', team, { x: cs.x + 22, z: cs.z + 30 }, { heading: cs.heading });
            cmd.state.raise = 1; cmd.setConceal(0.7); cmd.role = 'command';
        }
        const ss = this.within(6000, 22000, () => this.findSite('shelter', team, near, 2000, 15000));
        if (ss) { const s = this.buildSite('shelter', ss); B.hides.push({ kind: 'shelter', x: s.inside.x, z: s.inside.z, heading: s.inside.heading, conceal: 0.97, approach: s.door, building: s }); }
        // pre-surveyed firing points a short drive from the hides (a TEL is in the open as briefly as it can be)
        for (const h of B.hides.slice(0, 7)) { const f = this.findSite('firing', team, h, 500, 1700); if (f) B.firing.push(f); }
        if (B.firing.length < 2) this.within(3000, 16000, () => { for (let i = 0; i < 3; i++) { const f = this.findSite('firing', team, near, 2000, 16000); if (f) B.firing.push(f); } });
        for (const s of [...B.hides, ...B.firing]) if (s.clearing) this.war.addClearing(s.x, s.z, s.clearing);
        if (!B.hides.length) return null;
        // the TELs, each in its own hide
        const free = B.hides.slice().sort(() => Math.random() - 0.5);
        for (let i = 0; i < tels && free.length; i++) {
            const h = free.shift();
            const tel = this.spawnTEL(team, h, { brigade: B, site: h });
            if (tel) B.tels.push(tel);
        }
        return B;
    }

    placeSams() {
        const red = this.anchor('red');
        const s1 = this.place('sam', 'red', red, 2500, 8000);
        if (s1) this.spawnSAM('red', 's300', s1, { name: 'SA-10 BATTERY' });
        const s2 = this.place('sam', 'red', red, 2500, 16000, [2500, 12000], s1 ? [s1] : []);
        if (s2) this.spawnSAM('red', 'buk', s2, { name: 'SA-11 BATTERY' });
        const s3 = this.place('sam', 'red', red, 2500, 18000, [1000, 8000], [s1, s2].filter(Boolean));
        if (s3) this.spawnSAM('red', 'osa', s3, { name: 'SA-8 PLATOON' });
    }
    // (a finder that failed once may well succeed on another go: it samples at random)
    retry(fn, n = 3) { for (let i = 0; i < n; i++) { const r = fn(); if (r) return r; } return null; }
    // A place for a unit: the kind of site it wants (within a band of distance from the front), else anywhere in
    // the ring, else level open ground, else a spot to hide — so the order of battle is always all there
    place(kind, team, near, r0, r1, band = null, avoid = []) {
        const want = () => this.retry(() => this.findSite(kind, team, near, r0, r1, avoid));
        return (band ? this.within(band[0], band[1], want) : null) || want()
            || this.retry(() => this.findSite('firing', team, near, r0, r1 * 1.3)) || this.findSite('hide', team, near, r0, r1 * 1.3);
    }

    placeSmerch() {
        const red = this.anchor('red');
        const s = this.place('firing', 'red', red, 1500, 16000, [7000, 20000]);
        if (s) this.spawnArtillery('red', 'smerch', s, { name: 'SMERCH BATTERY' });
    }

    placeRedGrads() {
        const red = this.anchor('red');
        const s = this.place('firing', 'red', red, 2000, 16000, [2500, 7000]);
        if (s) this.spawnArtillery('red', 'grad', s, { name: 'GRAD BATTERY' });
    }

    // the Bastion battery: a hide a little inland, firing points on the shore, facing the sea our ships use
    placeCoastal() {
        const red = this.anchor('red');
        let best = null;
        for (let k = 0; k < 160 && !best; k++) {
            const a = Math.random() * Math.PI * 2, r = rand(3000, 17000);
            const x = red.x + Math.cos(a) * r, z = red.z + Math.sin(a) * r;
            if (this.war.sideAt(x, z) !== 'red') continue;
            const h = terrainHeight(x, z);
            if (h < 8 || h > 120) continue;
            // the sea within 1.5 km, toward our side
            let sea = null;
            for (let i = 0; i < 12 && !sea; i++) { const b = i / 12 * Math.PI * 2; if (terrainHeight(x + Math.cos(b) * 1400, z + Math.sin(b) * 1400) < -2) sea = b; }
            if (sea === null) continue;
            if (this.env.inTown && this.env.inTown(x, z)) continue;
            if (Math.abs(terrainHeight(x + 20, z) - h) > 3 || Math.abs(terrainHeight(x, z + 20) - h) > 3) continue;
            best = { x, z, heading: Math.atan2(-Math.cos(sea), -Math.sin(sea)), sea };
        }
        if (!best) return;
        // the hide 600–1500 m inland
        const inland = this.findSite('forest', 'red', best, 500, 1600) || this.findSite('valley', 'red', best, 500, 2000) || this.findSite('roadside', 'red', best, 400, 1500) || { x: best.x, z: best.z, heading: best.heading };
        this.spawnCoastal('red', inland, { shore: [best] });
    }

    // ═════════════ The spawn API ═════════════
    // accepts (team, pos) or (pos, team)
    static args(a, b) { return typeof a === 'string' ? [a, b] : [b, a]; }

    spawnVehicle(vid, team, at, opts = {}) {
        if (!VEHICLES[vid]) return null;
        const v = new ForceVehicle(this, vid, team, at, opts);
        this.units.push(v);
        const war = this.war;
        if (war) {
            war.add(v, { cls: v.cls, name: v.realName, conceal: v.conceal, hardened: v.hardened, contactName: 'UNKNOWN VEHICLE', value: v.u.score / 300 });
        }
        if (this.game.ground && this.game.ground.targets) this.game.ground.targets.push(v);
        return v;
    }

    spawnTEL(a, b, opts = {}) {
        const [team, pos] = MobileForces.args(a, b);
        if (!pos) return null;
        const vid = opts.vehicle || 'scud';
        const B = opts.brigade || { team, hides: [], firing: [], occupied: new Set(), reload: null, tels: [] };
        if (!opts.brigade) {
            // a TEL on its own: a few hides and firing points round where it turns up
            for (const k of ['forest', 'valley', 'roadside', 'forest']) { const h = this.findSite(k, team, pos, 1200, 6000); if (h) { B.hides.push(h); if (h.clearing) this.war.addClearing(h.x, h.z, h.clearing); } }
            for (const h of [pos, ...B.hides.slice(0, 2)]) { const f = this.findSite('firing', team, h, 500, 1800); if (f) { B.firing.push(f); this.war.addClearing(f.x, f.z, f.clearing); } }
        }
        const v = this.spawnVehicle(vid, team, pos, { heading: pos.heading ?? rand(0, 6.28), loaded: opts.loaded === false ? 0 : 1 });
        if (!v) return null;
        const tel = new TelUnit(this, v, B, { site: opts.site || null, sourceName: opts.sourceName });
        this.groups.push(tel);
        if (!opts.brigade) B.tels.push(tel);
        return tel;
    }

    spawnSAM(a, b, c, opts = {}) {
        // (team, type, pos) — or (pos, team, type)
        let team, type, pos;
        if (typeof a === 'string' && typeof b === 'string') { team = a; type = b; pos = c; } else { pos = a; team = b; type = c; }
        if (!SAM_TYPES[type] || !pos) return null;
        const site = { x: pos.x, z: pos.z, heading: pos.heading ?? this.threatAxis(team, pos) };
        const gr = new SamGroup(this, type, team, site, opts);
        this.groups.push(gr);
        return gr;
    }

    // type: 'grad' | 'smerch' | 'himars' | 'm270' (a battery of `count`), 'gmlrs' (our mixed HIMARS + M270 battery),
    // 'atacms' (a HIMARS and an M270 with ATACMS pods: the ballistic / hardened strike source)
    spawnArtillery(a, b, c, opts = {}) {
        let team, type, pos;
        if (typeof a === 'string' && typeof b === 'string') { team = a; type = b; pos = c; } else { pos = a; team = b; type = c; }
        if (!pos) return null;
        const site = { x: pos.x, z: pos.z, heading: pos.heading ?? this.threatAxis(team, pos) };
        let o = { ...opts };
        if (type === 'gmlrs') o = { types: ['himars', 'himars', 'm270'], kind: 'artillery', ...opts };
        else if (type === 'atacms') o = { types: ['himars', 'm270'], kind: 'launcher', stock: { atacms: 1, penetrator: 1 }, command: false, support: false, spread: 260, sourceName: opts.name || 'STEEL RAIN', ...opts };
        else if (MLRS_TYPES[type]) o = { types: Array(opts.count || (type === 'smerch' ? 2 : 3)).fill(type), ...opts };
        else return null;
        const gr = new RocketBattery(this, team, site, o);
        gr.type = type;
        this.groups.push(gr);
        return gr;
    }

    // from / to: { x, z } (a base, a town, anywhere near a road), a BASES id, or a town; composition: vehicle ids, or
    // a preset index into CONVOYS[team]
    spawnConvoy(a, b, c, d, opts = {}) {
        let team = a, from = b, to = c, comp = d;
        if (typeof a !== 'string') { from = a; to = b; team = c; comp = d; }
        const P = (p) => (typeof p === 'string' ? this.placeOf(p) : p && p.x !== undefined ? p : null);
        from = P(from); to = P(to);
        if (!from || !to) return null;
        const list = Array.isArray(comp) ? comp.filter(id => VEHICLES[id]) : (CONVOYS[team] || CONVOYS.red)[typeof comp === 'number' ? comp : Math.floor(Math.random() * (CONVOYS[team] || CONVOYS.red).length)];
        if (!list.length) return null;
        const r = this.plan({ pos: from, u: { road: 16 } }, to, { vmax: 14 });
        if (!r || r.len < 300) return null;
        const cv = new Convoy(this, team, r, list, opts);
        cv.managed = true; // (the director's convoy loop leaves it to us)
        cv.reportT = this.war.time + rand(50, 90);
        this.groups.push(cv);
        if (!opts.quiet) this.emit('convoyStarted', cv);
        return cv;
    }

    spawnCoastal(a, b, opts = {}) {
        const [team, pos] = MobileForces.args(a, b);
        if (!pos) return null;
        const gr = new CoastalBattery(this, team, { x: pos.x, z: pos.z, heading: pos.heading ?? 0 }, opts);
        this.groups.push(gr);
        return gr;
    }

    // ═════════════ Commands ═════════════
    // A fire mission: a rocket battery (or one launcher) fires on a target; a TEL launches at it; a coastal battery
    // fires at a ship. target: a unit, a war mark, or { x, z }. Returns the number of launches ordered.
    fireMission(who, target, opts = {}) {
        const gr = who && (who.ctrl || who);
        if (!gr || !target) return 0;
        const pos = target.pos || target.fixed || target;
        if (gr instanceof RocketBattery) {
            if (who.ctrl && who !== gr) opts = { ...opts, only: who };
            return gr.fireMission(target.unit || (target.pos ? target : pos), opts);
        }
        if (gr instanceof CoastalBattery) return gr.fireMission(target.unit || target, opts);
        if (gr instanceof TelUnit) {
            if (!gr.launcher || !gr.canTakeOrder()) return 0;
            const aim = { pos: new THREE.Vector3(pos.x, pos.y ?? Math.max(terrainHeight(pos.x, pos.z), 0), pos.z), unit: target.alive !== undefined ? target : target.unit || null, label: opts.label || 'TARGET' };
            const st = this.makeStrike(gr.team, 'ballistic', aim);
            const k = gr.launcher.fire(gr.spec, 1, aim, st);
            if (st && k) { st.planned += k; st.sources.add(gr.launcher); }
            return k;
        }
        return 0;
    }

    relocate(who, to = null) {
        const gr = who && (who.ctrl || who);
        if (!gr) return false;
        if (gr instanceof SamGroup) return gr.relocate(to);
        if (gr instanceof TelUnit) { if (to) return gr.goTo({ kind: 'roadside', x: to.x, z: to.z, conceal: 0.4 }, 'hide'); gr.relocate(); return true; }
        if (gr instanceof RocketBattery) { for (const v of gr.launchers) if (v.alive && v.fstate === 'idle') gr.scoot(v); return true; }
        return false;
    }

    // A strike record for launches we order ourselves (strikes.js bookkeeping: HUD, BDA, 'strategicLaunch')
    makeStrike(team, type, aim) {
        const st = this.strikes;
        if (!st) return null;
        const T = STRIKE_TYPES[type] || STRIKE_TYPES.rocket;
        const spec = MISSILES[T.use && T.use[team]] || MISSILES.grad;
        const s = { id: st.nextStrikeId++, type, label: T.label, team, spec, aims: [aim], launched: 0, planned: 0, impacts: 0, lost: 0, missiles: [], t: this.game.time, sources: new Set(), done: false };
        st.strikes.push(s);
        return s;
    }

    // ═════════════ Services for the units ═════════════
    findSite(kind, team, near, r0, r1, avoid = []) {
        const env = this.env;
        if (!env) return null;
        switch (kind) {
            case 'forest': return forestSite(env, team, near, r0, r1);
            case 'valley': return valleySite(env, team, near, r0, r1);
            case 'roadside': return roadsideSite(env, team, near, r0, r1);
            case 'firing': return firingSite(env, team, near, r0, r1);
            case 'open': { const s = firingSite(env, team, near, r0, r1, 30); return s; }
            case 'sam': return samSite(env, team, near, r0, r1, 50, avoid);
            case 'compound': return compoundSite(env, team, near, r0, r1);
            case 'shelter': return shelterSite(env, team, near, r0, r1);
            case 'hide': {
                for (const k of ['forest', 'valley', 'roadside'].sort(() => Math.random() - 0.5)) { const s = this.findSite(k, team, near, r0, r1); if (s) { if (s.clearing) this.war.addClearing(s.x, s.z, s.clearing); return s; } }
                // nothing better: anywhere level, off the roads, away from where it was
                for (let k = 0; k < 200; k++) {
                    const a = Math.random() * Math.PI * 2, r = rand(r0, r1), x = near.x + Math.cos(a) * r, z = near.z + Math.sin(a) * r;
                    if (env.sideAt(x, z) !== team || terrainHeight(x, z) < 5 || (env.blocked && env.blocked(x, z)) || !this.driveable(x, z)) continue;
                    return { kind: 'open', x, z, heading: rand(0, 6.28), conceal: 0.3 + forestDensity(x, z) * 0.4, clearing: 0 };
                }
                return null;
            }
        }
        return null;
    }

    buildSite(kind, site) {
        const b = kind === 'compound' ? buildCompound(site, (x, z) => this.env.heightAt(x, z), Math.floor(Math.random() * 1e6)) : buildShelter(site, (x, z) => this.env.heightAt(x, z));
        b.kind = kind; b.x = site.x; b.z = site.z; b.shown = false; b.open = 0;
        this.war.addClearing(site.x, site.z, kind === 'compound' ? 48 : 30);
        this.sites.push(b);
        return b;
    }

    // a drive for vehicle v to `to`: over the roads where it helps (opts.via: stop there, back into `to`)
    plan(v, to, opts = {}) {
        const env = this.env;
        if (!env) return null;
        const H = env.heightAt;
        const from = v.pos || v;
        const o = { net: this.net, heightAt: H, clear: (x0, z0, x1, z1) => legClear(env, x0, z0, x1, z1), vmax: opts.vmax ?? Math.max((v.u ? v.u.road : 16) * 1.25, 14), offMax: 3000, direct: opts.direct ?? 1100 };
        const via = opts.via || (to.approach ? to.approach : null);
        if (via) {
            // stop past the approach point, then back in (nose out, ready to leave)
            const ax = via.x - to.x, az = via.z - to.z, al = Math.hypot(ax, az) || 1;
            const p1 = { x: via.x + ax / al * 22 + az / al * 8, z: via.z + az / al * 22 - ax / al * 8 };
            const r = planRoute(from, p1, o);
            if (!r) return null;
            r.addOff(via.x, via.z, H, 4);
            r.addOff(to.x, to.z, H, 4);
            r.limits(o.vmax);
            return r;
        }
        return planRoute(from, to, o);
    }
    // a short drive across country through points (no roads)
    offRoute(v, points) {
        const pts = [{ x: v.pos.x, z: v.pos.z }, ...points];
        for (let i = 1; i < pts.length; i++) if (!legClear(this.env, pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z, 0.4)) return null;
        return offRoute(pts, this.env.heightAt, 9);
    }
    // route planning spread over frames (a few ms each): cb(route or null)
    queuePlan(v, to, cb, opts = {}) { v.planning = true; this.planQ.push({ v, to, cb, opts }); }
    driveable(x, z) {
        const h = terrainHeight(x, z);
        if (h < 1) return false;
        if (this.env.solid(x, z)) return false;
        return Math.abs(terrainHeight(x + 12, z) - h) < 4 && Math.abs(terrainHeight(x, z + 12) - h) < 4;
    }

    // the direction a battery faces: the enemy's nearest airfield
    threatAxis(team, at) {
        const f = this.threatFrom(team, at);
        return Math.atan2(-(f.x - at.x), -(f.z - at.z));
    }
    threatFrom(team, at) {
        let best = null, bd = Infinity;
        for (const b of BASES) {
            if ((team === 'red') !== !!b.friendly || b.civil) continue;
            const d = Math.hypot(b.x - at.x, b.z - at.z);
            if (d < bd) { bd = d; best = b; }
        }
        return best || { x: at.x, z: at.z + (team === 'red' ? 10000 : -10000) };
    }
    placeOf(id) {
        const b = BASES.find(x => x.id === id);
        if (b) { const gate = baseToWorld(b, 680, -300); return { x: gate.x, z: gate.z }; }
        const towns = this.game.world && this.game.world.towns;
        const t = towns && towns.towns && towns.towns.find(x => x.mapName === id);
        return t ? { x: t.x, z: t.z } : null;
    }
    placeName(pos) {
        const d = this.game.director;
        if (d && d.placeName) return d.placeName(pos);
        return 'GRID ' + this.war.grid(pos.x, pos.z);
    }

    // hostile things in the air for a team's air defences (aircraft, and missiles in flight): once a frame
    airTargets(team) {
        const k = team + this.frame;
        if (this._airK === k) return this._air;
        this._airK = k;
        const out = this._air || (this._air = []);
        out.length = 0;
        for (const a of this.game.aircraft || []) if (a.alive && !a.onGround && a.team !== team && a.team !== 'neutral' && !a.exploded) out.push(a);
        const st = this.game.strikes;
        if (st && st.missiles) for (const m of st.missiles) if (m.alive && m.team !== team) out.push(m);
        return out;
    }

    // terrain between a and b (samples every ~300 m, ends skipped)
    lineOfSight(a, b, d = a.distanceTo(b)) {
        const n = clamp(Math.ceil(d / 300), 6, 48);
        for (let i = 1; i < n; i++) {
            const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
            if (terrainHeight(x, z) > y + 1) return false;
        }
        return true;
    }

    // launch points measured on the model (a vehicle far away has no rig): 'missile' (a TEL's erected missile
    // base) or muzzle i, in the vehicle's frame, in the deployed pose
    hardpoint(vid, key) {
        if (!hasVehicle(vid)) return null;
        const k = vid + ':' + key;
        if (this.hard.has(k)) return this.hard.get(k);
        const P = this.poser(vid, VEHICLES[vid].paint);
        if (!P) return null;
        const rig = P.rig;
        stowRig(rig);
        for (const g of VEHICLES[vid].deploy || []) for (const e of rig.byGroup[g] || []) setJoint(rig, e, e.j.deploy);
        P.object.updateMatrixWorld(true);
        let out = null;
        if (key === 'missile' && rig.missile) { const p = new THREE.Vector3().setFromMatrixPosition(rig.missile.matrixWorld); out = { x: p.x, y: p.y, z: p.z, up: true }; }
        else if (typeof key === 'number' && rig.muzzles.length) { const p = new THREE.Vector3(), d = new THREE.Vector3(); muzzleWorld(rig, key % rig.muzzles.length, p, d); out = { x: p.x, y: p.y, z: p.z, up: d.y > 0.9 }; }
        stowRig(rig);
        this.hard.set(k, out);
        return out;
    }

    // A rocket launched out of everyone's sight (12 km or more from the camera at both ends): no missile object —
    // it lands after its flight time, with the salvo's spread, and does what a real one would (strikes.js impact)
    abstractRocket(src, q, spec) {
        const cam = this.game.camera && this.game.camera.position, st = this.game.strikes;
        if (!cam || !st || (st.cam && st.cam.missile)) return false;
        const from = src.unit.pos, to = q.aim.pos;
        if (from.distanceTo(cam) < 12000 || to.distanceTo(cam) < 12000) return false;
        const at = new THREE.Vector3(to.x + rand(-1, 1) * spec.spread, 0, to.z + rand(-1, 1) * spec.spread);
        at.y = Math.max(terrainHeight(at.x, at.z), 0);
        if (q.strike) q.strike.launched++;
        this.later(st.estimate(spec, from, at), () => this.rocketImpact(at, spec, q.strike, src));
        return true;
    }
    rocketImpact(at, spec, strike, src) {
        const g = this.game, war = this.war, st = g.strikes, cam = g.camera.position;
        // damage as strikes.js impact() does it: the blast falls off over 3 × its radius, hardened targets resist
        for (const { u, rec, d2 } of war.near(at, spec.blast * 3 + 60)) {
            if (!u.damage || u.team === src.team) continue;
            const d = Math.max(0, Math.sqrt(d2) - (u.radius || 0) * 0.6);
            if (d > spec.blast * 3) continue;
            let dmg = spec.warhead * clamp(1 - d / (spec.blast * 3), 0, 1) ** 1.5;
            const hard = rec.hardened || 0;
            if (hard > spec.hard) dmg *= Math.max(0.08, (1 - (hard - spec.hard) * 1.4)) ** 2;
            if (dmg > 1) u.damage(dmg, src.unit, 'strike');
        }
        const dc = at.distanceTo(cam);
        if (dc < 16000) {
            const fx = g.effects;
            fx.sprite(fx.flashTex, _v.copy(at).setY(at.y + 4), 18, 0.16, 0.8, 1, [1, 0.8, 0.55]);
            for (let i = 0; i < 3; i++) fx.smoke.emit(at, _v2.set(rand(-4, 4), rand(8, 16), rand(-4, 4)), rand(3, 6), 5, 20, [0.35, 0.32, 0.28], [0.5, 0.47, 0.42], 0.6, 0, 1.2, 1);
            if (g.audio && g.audio.boom && dc < 14000) g.audio.boom(dc, 0.5);
        }
        if (strike && st) { strike.impacts++; st.checkStrikeDone(strike); }
    }

    later(s, fn) { this.timers.push({ t: (this.war ? this.war.time : 0) + s, fn }); }
    emit(name, a, b) { this.game.events.emit(name, a, b || {}); }
    say(from, text, opts = {}) {
        const d = this.game.director;
        if (d && d.enabled && d.say) d.say(from, text, opts); else this.war.radio(from, text, opts);
    }
    boom(at, size) { const st = this.game.strikes; if (st && st.boom) st.boom(at, size); }
    // a SAM's launch: a flash and a burst of smoke at the tube (a cold launch throws up a cloud)
    launchPuff(pos, dir, size = 1) {
        const fx = this.game.effects, cam = this.game.camera;
        if (!cam || pos.distanceToSquared(cam.position) > 9000 * 9000) return;
        fx.sprite(fx.flashTex, pos, 10 * size, 0.18, 2, 0.9, [1, 0.88, 0.62]);
        for (let i = 0; i < 10 * size; i++) fx.smoke.emit(pos, _v.set(rand(-1, 1) * 6, rand(0, 3), rand(-1, 1) * 6).addScaledVector(dir, -rand(2, 8)), rand(3, 6), rand(2, 3) * size, rand(9, 16) * size, [0.78, 0.77, 0.74], [0.86, 0.85, 0.82], 0.55, 0, 1.2, 0.6, 0, 0.5, 0.5);
        this.boom(pos, 0.25);
    }

    // ═════════════ Events from the units ═════════════
    onVehicleKilled(v, source) {
        if (v.ctrl && v.ctrl.onKilled) v.ctrl.onKilled(v, source);
        if (v.src) { v.src.abort && v.src.abort(); }
        // a burning wreck: the live rig goes charred, a static copy is swapped for the burnt one
        if (v.live) v.live.object.traverse(o => { if (o.isMesh) o.material = WRECK_MATERIALS[Math.random() < 0.2 ? 1 : 0]; });
        else if (v.lod === 1) { v.copyKey = ''; this.setLod(v, 1); }
    }

    // a radar lights up: our side's RWR hears it if the player is in range (a new SAM where it was quiet)
    onRadarActive(gr) {
        const war = this.war, p = this.game.player;
        if (gr.team === war.side || !p || !p.alive || this.game.pilotMode) return;
        const eye = gr.radar || gr.launchers.find(l => l && l.alive) || gr.search;
        if (!eye) return;
        const d = eye.pos.distanceTo(p.pos);
        const R = (gr.T.radarRange || gr.T.own || 20000) * 1.2;
        if (d > R) return;
        if (gr.rwrT && war.time - gr.rwrT < 120) return;
        gr.rwrT = war.time;
        const br = war.bearingRange(p.pos, eye.pos);
        const rec = war.rec(eye);
        const fresh = !rec || rec.known < INTEL.CONTACT;
        this.say('MAGIC', 'SPIKE — ' + gr.T.label.split(' ')[0] + ' RADAR ACTIVE, BEARING ' + String(br.brg).padStart(3, '0') + ', ' + Math.round(br.km) + ' KM' + (fresh ? ' — NEW THREAT' : ''), { color: '#ff4a3d', say: 'Spike. ' + gr.T.label.split(' ')[0].replace('-', ' ') + ' radar, bearing ' + br.brg + '.', priority: true });
        // the RWR gives a bearing: a contact, placed roughly
        for (const v of gr.members) {
            if (!v.alive || !(v.role === 'radar' || v.role === 'search' || (v.role === 'launcher' && gr.T.own))) continue;
            war.reveal(v, INTEL.CONTACT, 'rwr', true);
            const r = war.rec(v);
            if (r && r.known === INTEL.CONTACT) r.lastPos.add(_v.set(rand(-1, 1), 0, rand(-1, 1)).multiplyScalar(d * 0.06));
        }
        this.emit('samActive', gr, { radar: eye });
    }

    // a launch order reached one of our TELs: intel may see it getting ready (a chance to stop it)
    onTelOrder(tel, aim) {
        const war = this.war, g = this.game;
        if (tel.team === war.side || (this.search && this.search.tel === tel)) return;
        const eta = tel.prepEstimate();
        if (eta < 70 || Math.random() > 0.55) return;
        const launchAt = war.time + eta;
        const off = _v.set(rand(-1400, 1400), 0, rand(-1400, 1400));
        const rp = war.report({ text: 'ENEMY BALLISTIC MISSILE LAUNCHER PREPARING TO FIRE NEAR ' + this.placeName(tel.v.pos), center: _v2.copy(tel.v.pos).add(off), radius: 3200, unit: tel.v, cls: 'tel', say: false });
        tel.report = rp;
        this.say('COMMAND', 'PRIORITY — ENEMY TEL PREPARING A LAUNCH, GRID ' + war.grid(rp.center.x, rp.center.z) + ' — FIND IT BEFORE IT FIRES', { color: '#ff9f5a', say: 'Priority. Enemy launcher preparing to fire. Find it before it launches.', priority: true });
        // our own task (with the search area), then the event (tasks.js's own TEL task is the same key: skipped)
        const tasks = g.tasks;
        const rec = war.rec(tel.v);
        if (tasks && tasks.offer) {
            tasks.offer({
                type: 'tel', key: 'tel:' + (rec ? rec.id : 0) + ':' + Math.round(launchAt), urgent: true, title: 'DESTROY THE TEL BEFORE IT FIRES',
                brief: 'A BALLISTIC MISSILE LAUNCHER IS SETTING UP' + (aim && aim.label ? ' TO HIT ' + aim.label : '') + '. SEARCH NEAR GRID ' + war.grid(rp.center.x, rp.center.z) + ' — IT WILL BE IN THE OPEN, MISSILE ERECT, ONCE IT FIRES IT RUNS.',
                units: [tel.v], reward: 1000, label: 'TEL', expires: Math.max(40, eta), area: { center: rp.center, radius: rp.radius }, report: rp,
                progress: () => (tel.state === 'ready' || tel.state === 'prep' ? 'ERECTED — LAUNCH IN ' + this.clock(tel.prepEstimate()) : 'LAUNCH IN ' + this.clock(tel.prepEstimate())),
                check: () => (!tel.v.alive ? 'done:NO LAUNCH TODAY — THE TEL IS DESTROYED' : tel.launchPos && war.time > launchAt - 60 ? 'failed:THE MISSILE IS AWAY' : null),
            }, { force: true });
        }
        g.events.emit('telPreparing', tel.v, { launchAt, target: aim ? { pos: aim.pos, label: aim.label } : null });
    }
    clock(s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

    // convoys: the director's bookkeeping when it's there (radio, supply, events), ours otherwise
    onConvoyEnd(c, why) {
        const d = this.game.director;
        if (d && d.enabled && d.endConvoy) { d.endConvoy(c, why); return; }
        this.emit(why === 'arrived' ? 'convoyArrived' : 'convoyLost', c, { why });
        if (why === 'arrived' && this.game.front && this.game.front.deliver) this.game.front.deliver(c.destPos, c.team, 0.04 + 0.14 * c.arrived / c.total);
    }
    onConvoyHalt(c) {
        const war = this.war;
        if (c.team === war.side) this.say(c.callsign, 'THE BRIDGE IS DOWN AHEAD OF US — HOLDING', { color: '#ffd24a', say: false });
        else if (c.alive().some(v => war.known(v) >= INTEL.CONTACT)) this.say('INTEL', 'ENEMY CONVOY HALTED AT A DOWNED BRIDGE — ' + this.placeName(c.centre(_v)), { color: '#5dffa0', say: false });
    }
    onConvoyScatter(c) {
        const war = this.war;
        if (c.team === war.side) this.say(c.callsign, 'CONTACT — WE\'RE UNDER ATTACK, DISPERSING OFF THE ROAD', { color: '#ff9f5a', say: c.callsign.toLowerCase() + ', we are under attack!', priority: true });
        this.emit('convoyScattered', c);
    }
    // troops out of an APC (infantry.js), facing where the trouble came from
    dismount(v, threat) {
        const inf = this.game.infantry;
        if (!v.alive || !inf || !inf.spawnSquad) return;
        const back = v.toWorld(0, 0, v.L * 0.5 + 4, _v3);
        const facing = threat && threat.pos ? Math.atan2(-(threat.pos.x - back.x), -(threat.pos.z - back.z)) : v.heading;
        try {
            const sq = inf.spawnSquad({ team: v.team, pos: back.clone(), n: Math.min(v.u.troops || 6, 8), kind: 'guard', weapon: 'mixed', facing, spread: 4, name: v.team === 'red' ? 'MOTOR RIFLE SQUAD' : 'INFANTRY SQUAD' });
            v.squad = sq;
        } catch (e) { console.warn('[forces] dismount', e); }
    }
    // a convoy's SAM vehicle stops, puts its radar up and fights (a one-launcher battery of its own for a while;
    // it stays in its column)
    escortSam(v) {
        if (!v.alive || !SAM_TYPES[v.vid]) return null;
        const gr = new SamGroup(this, v.vid, v.team, { x: v.pos.x, z: v.pos.z, heading: v.heading }, { adopt: [v], deployed: false, emcon: 'search', name: v.realName });
        this.groups.push(gr);
        gr.deploy();
        return gr;
    }
    dropEscort(v) {
        const gr = v.escortGroup;
        if (!gr) return;
        v.escortGroup = null;
        gr.setRadar(false);
        gr.done = true;
        const i = this.groups.indexOf(gr);
        if (i >= 0) this.groups.splice(i, 1);
        v.spinning = false; v.aimYaw = 0; v.aimPitch = 0;
    }
    removeVehicle(v) {
        const gt = this.game.ground && this.game.ground.targets;
        if (gt) { const i = gt.indexOf(v); if (i >= 0) gt.splice(i, 1); }
        if (v.src && this.game.strikes) this.game.strikes.removeSource(v.src);
        v.remove();
    }

    // ═════════════ Hooks the other systems call ═════════════
    // front.js: a Grad battery for sector s at site (the front's batteries API: { sector, units, at, forces })
    frontBattery(s, site, face) {
        if (!this.enabled) return null;
        const gr = this.spawnArtillery('red', 'grad', { x: site.x, z: site.z, heading: face }, { name: 'GRAD BATTERY', count: 3, support: true, command: true });
        if (!gr) return null;
        gr.sector = s;
        const bt = { sector: s, units: gr.launchers, at: new THREE.Vector3(site.x, terrainHeight(site.x, site.z), site.z), t: 0, forces: gr };
        gr.frontBt = bt;
        gr.fireT = rand(20, 60);
        return bt;
    }
    // director.js: a supply convoy as a column of ours, between bases and towns toward the front
    directorConvoy(team, dir) {
        if (!this.enabled || !this.net) return null;
        const pair = this.convoyEnds(team);
        if (!pair) return null;
        const comp = team === 'red' ? CONVOYS.red[Math.floor(Math.random() * CONVOYS.red.length)] : CONVOYS.blue[Math.floor(Math.random() * CONVOYS.blue.length)];
        const cv = this.spawnConvoy(team, pair.from, pair.to, comp, { quiet: true, destName: pair.name, callsign: team === this.war.side ? undefined : 'CONVOY' });
        if (cv) cv.id = dir.nextId++;
        return cv;
    }
    // a convoy's start and end: from a base or a town deep in its territory to a town (or a spot) behind the line
    convoyEnds(team) {
        const net = this.net, towns = this.game.world.towns;
        if (!net || !towns) return null;
        const war = this.war;
        const own = (p) => war.sideAt(p.x, p.z) === team;
        const cands = [];
        for (const b of BASES) if (!b.civil && (team === 'red') !== !!b.friendly) { const p = this.placeOf(b.id); if (p && own(p)) cands.push({ ...p, name: b.name, base: true }); }
        for (const t of towns.towns || []) if (own(t)) cands.push({ x: t.x, z: t.z, name: t.mapName || null });
        for (let k = 0; k < 20; k++) {
            const a = pick(cands), b = pick(cands);
            if (!a || !b || a === b) continue;
            const da = this.frontDist(a.x, a.z), db = this.frontDist(b.x, b.z);
            const [from, to] = da > db ? [a, b] : [b, a];
            if (Math.hypot(from.x - to.x, from.z - to.z) < 3000) continue;
            const A = net.nearest(from.x, from.z, 1500), B = net.nearest(to.x, to.z, 1500);
            if (!A || !B) continue;
            const legs = net.route(A, B);
            if (!legs || legs.cost < 2500) continue;
            return { from: { x: A.x, z: A.z }, to: { x: B.x, z: B.z }, name: to.name ? to.name.toUpperCase() : this.placeName(to) };
        }
        return null;
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.enabled) return;
        const t0 = performance.now();
        const war = this.war, g = this.game;
        this.frame++;
        // timers
        if (this.timers.length) {
            const now = war.time;
            for (let i = this.timers.length - 1; i >= 0; i--) {
                const tm = this.timers[i];
                if (now >= tm.t) { this.timers.splice(i, 1); try { tm.fn(); } catch (e) { console.warn('[forces] timer', e); } }
            }
        }
        // routes to plan (a couple a frame)
        for (let k = 0; k < 2 && this.planQ.length; k++) {
            const q = this.planQ.shift();
            q.v.planning = false;
            if (!q.v.alive) continue;
            let r = null;
            try { r = this.plan(q.v, q.to, q.opts); } catch (e) { console.warn('[forces] plan', e); }
            q.cb(r);
        }
        for (const v of this.units) if (!v.removed) v.step(dt);
        for (const gr of this.groups) if (!gr.done || gr.alive) gr.update(dt);
        if (this.search) this.search.update(dt);
        // meshes, sites and the built-in tasking
        this.lodT = (this.lodT || 0) - dt;
        if (this.lodT <= 0) { this.lodT = 0.2; this.updateLod(); }
        if (this.buildQ.length && this.meshOK) this.buildOne();
        this.siteT = (this.siteT || 0) - dt;
        if (this.siteT <= 0) { this.siteT = 0.5; this.updateSites(); }
        this.taskT = (this.taskT || 0) - dt;
        if (this.taskT <= 0) { this.taskT = 1; this.tasking(1); }
        for (const s of this.sites) if (s.setOpen && Math.abs(s.k - s.open) > 0.001) s.setOpen(s.k + clamp(s.open - s.k, -dt / 6, dt / 6));
        this.stats.ms = this.stats.ms * 0.95 + (performance.now() - t0) * 0.05;
        void g;
    }

    // ── what's drawn: nothing far off, a merged copy nearer, the live rig close in or while animating ──
    updateLod() {
        const g = this.game, cam = this.lodFocus || (g.camera && g.camera.position); // (lodFocus: tools, stills)
        if (!cam) return;
        const pod = g.sensors && g.sensors.view && g.sensors.pod ? g.sensors.pod : null;
        const want = this._want || (this._want = []);
        want.length = 0;
        let meshed = 0;
        for (const v of this.units) {
            if (v.removed) continue;
            const d = v.base.distanceTo(cam);
            let lod = d < (v.lod ? MESH_OUT : MESH_R) ? 1 : 0;
            // the targeting pod sees far: whatever's in its field of view gets a mesh
            if (!lod && pod && pod.los && d < 32000) { _v.subVectors(v.base, pod.pos || cam).normalize(); if (_v.dot(pod.los) > 0.9994) lod = 1; }
            if (!lod || !this.meshOK || !hasVehicle(v.vid)) { if (v.lod) this.setLod(v, 0); continue; }
            meshed++;
            // (a turret or launcher trained off its stowed pose counts as animating: a static copy is stowed)
            const anim = v.alive && (v.busy || v.midPose || Math.abs(v.aimYaw) > 0.02 || v.aimPitch > 0.02);
            const moving = v.alive && v.moving;
            let pr = 0;
            if (v.alive && anim && d < LIVE_ANIM) pr = 3 + (1 - d / LIVE_ANIM);
            else if (v.alive && (moving || v.spinning) && d < LIVE_MOVE) pr = 1 + (1 - d / LIVE_MOVE);
            else if (!v.alive && v.live && d < 500) pr = 0.5;
            if (pr > 0) want.push({ v, pr });
            else if (v.lod !== 1 || v.copyKey !== this.copyKey(v)) this.setLod(v, 1);
        }
        want.sort((a, b) => b.pr - a.pr);
        let live = 0;
        for (const w of want) {
            if (live < MAX_LIVE && this.setLod(w.v, 2)) live++;
            else if (w.v.lod !== 1 || w.v.copyKey !== this.copyKey(w.v)) this.setLod(w.v, 1);
        }
        this.stats.units = this.units.length; this.stats.meshed = meshed; this.stats.live = live;
    }

    // (what's aboard only matters for the vehicles whose missiles are parts of the model: a Scud, a Buk)
    copyKey(v) {
        const parts = v.spec.parts, shows = parts.includes('missile') || parts.includes('missile_1');
        let k = '';
        for (const g of GROUPS) k += v.state[g] > 0.5 ? '1' : '0';
        return v.vid + '|' + v.paint + '|' + k + '|' + (shows ? v.loaded & 0xff : 255) + (v.alive ? '' : '|x');
    }

    // switch a vehicle's drawn copy; returns false if it isn't ready (a template still to build, no rig spare)
    setLod(v, lod) {
        const g = this.game;
        if (lod === 0) {
            if (v.lod === 0) return true;
            this.dropCopy(v); this.dropLive(v);
            if (v.mesh.parent) v.mesh.parent.remove(v.mesh);
            v.lod = 0;
            return true;
        }
        if (lod === 1) {
            const key = this.copyKey(v);
            if (v.lod === 1 && v.copyKey === key) return true;
            const tpl = this.template(v, key);
            if (!tpl) { if (v.lod === 2) return true; if (!v.copy) return false; return true; }
            this.dropCopy(v); this.dropLive(v);
            v.copy = tpl.clone();
            v.copyKey = key;
            v.mesh.add(v.copy);
        } else {
            if (v.lod === 2) return true;
            const L = this.acquireRig(v.vid, v.paint);
            if (!L) return false;
            this.dropCopy(v);
            v.live = L; v.applied = {};
            L.steer = 0;
            v.mesh.add(L.object);
            v.applyRig(0);
        }
        if (!v.mesh.parent) g.scene.add(v.mesh);
        v.lod = lod;
        // placement on the drawn ground now that it's drawn
        if (!v.moving) v.settle(); else v.placeOnRoute();
        return true;
    }
    dropCopy(v) { if (v.copy) { v.mesh.remove(v.copy); v.copy = null; v.copyKey = ''; } }
    dropLive(v) {
        const L = v.live;
        if (!L) return;
        v.mesh.remove(L.object);
        v.live = null;
        if (v.alive) this.releaseRig(v.vid, v.paint, L); // (a charred wreck's rig isn't reused)
    }
    releaseMesh(v) { this.dropCopy(v); this.dropLive(v); if (v.mesh.parent) v.mesh.parent.remove(v.mesh); v.lod = 0; }

    // ── live rigs, pooled ──
    acquireRig(vid, paint) {
        const key = vid + '|' + paint, list = this.pool.get(key);
        if (list && list.length) return list.pop();
        if (this._rigFrame === this.frame) return null; // (one new rig a frame: a clone costs a few ms)
        this._rigFrame = this.frame;
        try { const { object, rig } = createVehicle(vid, { paint }); return { object, rig, steer: 0 }; } catch (e) { return null; }
    }
    releaseRig(vid, paint, L) {
        stowRig(L.rig);
        if (L.rig.missile) L.rig.missile.visible = true;
        for (const m of L.rig.missiles) m.visible = true;
        const key = vid + '|' + paint;
        if (!this.pool.has(key)) this.pool.set(key, []);
        const list = this.pool.get(key);
        if (list.length < 3) list.push(L);
    }

    // ── merged static copies: one per vehicle type, paint and pose (built a frame at a time) ──
    template(v, key) {
        const t = this.templates.get(key);
        if (t) return t;
        if (!this.buildQ.some(q => q.key === key)) this.buildQ.push({ key, vid: v.vid, paint: v.paint, state: { ...v.state }, loaded: v.loaded, dead: !v.alive });
        return null;
    }
    poser(vid, paint) {
        const key = vid + '|' + paint;
        let P = this.posers.get(key);
        if (!P && hasVehicle(vid)) { try { P = createVehicle(vid, { paint }); this.posers.set(key, P); } catch (e) { return null; } }
        return P;
    }
    buildOne() {
        const q = this.buildQ.shift();
        if (!q || this.templates.has(q.key)) return;
        if (q.dead) {
            // the burnt copy: the live pose's geometry, charred
            const aliveKey = q.key.replace(/\|x$/, '');
            const base = this.templates.get(aliveKey);
            if (!base) { this.buildQ.push({ ...q, dead: false, key: aliveKey }, q); return; }
            const w = base.clone();
            w.traverse(o => { if (o.isMesh) o.material = WRECK_MATERIALS[0]; });
            this.templates.set(q.key, w);
            return;
        }
        this.templates.set(q.key, this.makeTemplate(q.vid, q.paint, q.state, q.loaded));
    }
    makeTemplate(vid, paint, state, loaded) {
        const P = this.poser(vid, paint);
        if (!P) return null;
        const rig = P.rig;
        stowRig(rig);
        for (const g of GROUPS) if (state[g] > 0.5 && rig.byGroup[g]) for (const e of rig.byGroup[g]) setJoint(rig, e, e.j.deploy);
        if (rig.missile) rig.missile.visible = !!(loaded & 1);
        rig.missiles.forEach((m, i) => { m.visible = !!(loaded & (1 << i)); });
        P.object.position.set(0, 0, 0); P.object.rotation.set(0, 0, 0);
        updateRams(rig); // (the rams follow the erector / launcher they push)
        const t = staticVehicle(P.object);
        t.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.matrixAutoUpdate = false; o.updateMatrix(); } });
        if (rig.missile) rig.missile.visible = true;
        rig.missiles.forEach(m => { m.visible = true; });
        stowRig(rig);
        return t;
    }
    // before any sortie: the travel pose of every vehicle, built in idle time once the models are in
    prewarm() {
        const idle = globalThis.requestIdleCallback;
        if (!idle || typeof document === 'undefined') return;
        vehiclesReady().then(() => {
            const todo = Object.keys(VEHICLES).map(vid => ({ vid, paint: VEHICLES[vid].paint }));
            const step = (dl) => {
                while (todo.length && (!dl || dl.timeRemaining() > 14)) {
                    const { vid, paint } = todo.shift();
                    const state = {}; for (const g of GROUPS) state[g] = 0;
                    const parts = VEHICLES[vid].parts, loaded = parts.includes('missile') ? 1 : parts.includes('missile_1') ? 15 : 255;
                    const key = vid + '|' + paint + '|00000000|' + loaded;
                    if (!this.templates.has(key) && hasVehicle(vid)) { try { this.templates.set(key, this.makeTemplate(vid, paint, state, loaded)); } catch (e) { /* skip */ } }
                    if (dl && dl.didTimeout) break;
                }
                if (todo.length) idle(step, { timeout: 5000 });
            };
            idle(step, { timeout: 5000 });
        }).catch(() => {});
    }

    // compounds and shelters: in the scene near the camera
    updateSites() {
        const cam = this.game.camera && this.game.camera.position;
        if (!cam) return;
        for (const s of this.sites) {
            const near = Math.hypot(s.x - cam.x, s.z - cam.z) < SITE_R;
            if (near && !s.shown) { this.game.scene.add(s.group); s.shown = true; }
            else if (!near && s.shown) { this.game.scene.remove(s.group); s.shown = false; }
        }
    }

    // ═════════════ The built-in tasking (the director or tools can switch each off: forces.auto) ═════════════
    tasking(dt) {
        const g = this.game, war = g.war, T = this.tacking;
        if (!this.full || g.state !== 'playing' && g.state !== 'dead') return;
        const k = this.difficultyK();
        // SCUD strikes, when there's no director to order them
        if (this.auto.tel && !(g.director && g.director.enabled)) {
            T.tel -= dt;
            if (T.tel <= 0) { T.tel = rand(420, 660) / k; this.redMissileStrike(); }
        }
        // the search-and-destroy hunt
        if (this.auto.search) {
            T.search -= dt;
            if (T.search <= 0) { T.search = this.search ? 60 : rand(720, 1080) / k; if (!this.search) this.startSearch(); }
        }
        // the coastal battery at our ships
        if (this.auto.coastal) {
            T.coastal -= dt;
            if (T.coastal <= 0) { T.coastal = rand(420, 720) / k; this.coastalStrike(); }
        }
        // rocket artillery: the front's batteries shell their sectors; others fire now and then
        if (this.auto.artillery) {
            T.artillery -= dt;
            if (T.artillery <= 0) { T.artillery = rand(15, 25); this.artilleryPlan(); }
        }
        // convoys when there's no director to send them
        if (this.auto.convoys && !(g.director && g.director.enabled)) {
            T.convoy -= dt;
            if (T.convoy <= 0) {
                T.convoy = rand(200, 320);
                for (const team of ['red', 'blue']) if (!this.groups.some(c => c instanceof Convoy && c.team === team && !c.done)) { const p = this.convoyEnds(team); if (p) this.spawnConvoy(team, p.from, p.to, undefined, { destName: p.name }); }
            }
        }
        this.counterBattery();
        void war;
    }
    difficultyK() { const sk = (this.game.difficulty || { skill: 0.6 }).skill; return 0.55 + sk * 0.8; }

    // something of ours worth a missile: the airfields, the Patriot's radar, the missile field, the carrier
    blueTarget() {
        const g = this.game, opts = [];
        const home = BASES.find(b => b.id === 'home'), mir = BASES.find(b => b.id === 'miramar');
        const at = (b, lx, lz) => { const w = baseToWorld(b, lx, lz); return new THREE.Vector3(w.x, b.h, w.z); };
        if (home) opts.push({ w: 3, pos: at(home, 380 + rand(-100, 100), rand(-500, 500)), label: home.name });
        if (mir) opts.push({ w: 2, pos: at(mir, 900 + rand(-150, 150), rand(-900, 900)), label: mir.name });
        for (const gr of this.groups) if (gr instanceof SamGroup && gr.team === 'blue' && gr.radar && gr.radar.alive) opts.push({ w: 1.5, pos: gr.radar.pos, unit: gr.radar, label: gr.name });
        if (g.strikes && g.strikes.silo && g.strikes.silo.alive) opts.push({ w: 1, pos: g.strikes.silo.pos, label: g.strikes.silo.name });
        if (!opts.length) return null;
        let r = Math.random() * opts.reduce((a, o) => a + o.w, 0);
        for (const o of opts) { r -= o.w; if (r <= 0) return o; }
        return opts[0];
    }
    redMissileStrike() {
        const st = this.strikes, t = this.blueTarget();
        if (!st || !t) return null;
        const mark = t.unit ? t.unit : { id: 0, pos: t.pos, fixed: t.pos, transmitted: true, label: t.label };
        return st.request('ballistic', [mark], 'red', true);
    }
    coastalStrike() {
        const g = this.game, war = this.war;
        const bat = this.groups.find(x => x instanceof CoastalBattery && x.alive && x.team === 'red');
        if (!bat || !g.naval) return;
        const c = bat.centre(_v);
        let best = null, bd = 90000;
        for (const s of g.naval.ships) {
            if (!s.alive || s.team === 'red' || s.team === 'neutral') continue;
            const d = s.pos.distanceTo(c);
            if (d > bd) continue;
            // their radar sees it, or their recon has
            if (war.coverage('red', s.pos) <= 0 && !(g.director && g.director.reconSawCarrier && s === g.naval.homeCarrier) && Math.random() > 0.3) continue;
            bd = d; best = s;
        }
        if (best) bat.fireMission(best, { per: 2, label: best.name });
    }
    // red rocket artillery: batteries tied to a front sector shell our side of it; free ones hit our units near the
    // line (or a town there)
    artilleryPlan() {
        const g = this.game, war = this.war, fr = g.front;
        for (const gr of this.groups) {
            if (!(gr instanceof RocketBattery) || gr.team !== 'red' || !gr.alive) continue;
            gr.fireT = (gr.fireT ?? rand(30, 90)) - 20;
            if (gr.fireT > 0) continue;
            const s = gr.sector;
            if (s && s.red < 15) { gr.fireT = 30; continue; }
            let target = null;
            if (s && fr && fr.randomFrontPoint) { const p = fr.randomFrontPoint(s, -1, 300, 1600); if (p) target = p.clone(); }
            if (!target) {
                const near = war.near(gr.centre(_v), MLRS_TYPES[gr.type] ? MLRS_TYPES[gr.type].range : 20000, { team: 'blue' }).filter(o => o.u.isGround && !o.u.isShip && o.u.alive);
                if (near.length) target = pick(near.slice(0, 4)).u;
            }
            if (!target) { gr.fireT = 60; continue; }
            const n = gr.fireMission(target, { n: s ? 1 + Math.floor(Math.random() * 2) : 3, label: 'OUR LINES' });
            gr.fireT = n ? rand(90, 160) / this.difficultyK() : 40;
        }
    }
    // our counter-battery radar picks up their rockets: a HIMARS / M270 fires back at the launch point (a Grad
    // that has scooted is somewhere else by then)
    counterBattery() {
        const war = this.war, st = this.strikes;
        if (!st || !this.auto.counterBattery) return;
        for (const m of st.missiles) {
            if (!m.alive || m.team === war.side || m.kind !== 'rocket' || m.cbSeen) continue;
            m.cbSeen = true;
            const src = m.source && m.source.host;
            const who = src && (src.group || src); // (one reply per battery)
            if (!src || who.cbT && war.time - who.cbT < 90) continue;
            if (war.coverage(war.side, m.pos) <= 0) continue;
            who.cbT = war.time;
            war.reveal(src, INTEL.CONTACT, 'counter-battery', true);
            const at = src.pos.clone();
            const bat = this.groups.find(x => x instanceof RocketBattery && x.team === war.side && x.kind2 === 'artillery' && x.alive && x.launchers.some(v => v.alive && v.src && v.src.canFire('gmlrs')));
            if (!bat) continue;
            this.say('FIREFINDER', 'COUNTER-BATTERY: ENEMY ROCKETS FROM GRID ' + war.grid(at.x, at.z) + ' — ' + bat.name + ' FIRING', { color: '#9fd4ff', say: false });
            this.later(rand(30, 60), () => { if (bat.alive) bat.fireMission(at, { n: 1, label: 'ENEMY ARTILLERY' }); });
        }
    }

    // ═════════════ Search and destroy ═════════════
    // "Enemy TEL detected entering region → search highways and valleys → recon drone finds possible convoy → player
    // identifies missile launcher → enemy SAM escort activates → player attacks or marks launcher → friendly
    // strike destroys it." A TEL and its SA-8 escort drive in from the rear to a firing point; the countdown runs.
    startSearch(opts = {}) {
        if (this.search || !this.env || !this.strikes) return null;
        const op = new SearchOp(this, opts);
        if (!op.ok) return null;
        this.search = op;
        return op;
    }

    // ═════════════ HUD, map, commands ═════════════
    drawHud(ctx, hud) {
        const g = this.game;
        if (!this.enabled || g.photo || g.hideHud || !this.search || (g.tasks && g.tasks.enabled)) return;
        const op = this.search;
        if (op.done) return;
        ctx.save();
        ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const txt = 'SEARCH AND DESTROY · MOBILE LAUNCHER · LAUNCH IN ' + this.clock(op.eta()) + (op.rp ? ' · SEARCH AREA ' + this.war.describePos(op.rp.center).split(' · ')[0] : '');
        ctx.fillStyle = 'rgba(8,14,20,0.5)'; ctx.fillRect(hud.w / 2 - ctx.measureText(txt).width / 2 - 8, 66, ctx.measureText(txt).width + 16, 20);
        ctx.fillStyle = '#ffd24a'; ctx.fillText(txt, hud.w / 2, 76);
        ctx.restore();
    }

    drawMap(ctx, map) {
        if (!this.enabled) return;
        const war = this.war, P = {}, Q = {};
        ctx.save();
        ctx.font = '600 10px "Share Tech Mono", monospace';
        for (const gr of this.groups) {
            if (gr.team !== war.side || !gr.alive) continue;
            if (gr instanceof SamGroup) {
                // our air defence's reach
                const c = gr.centre(_v);
                map.toScreen(c.x, c.z, P);
                ctx.strokeStyle = 'rgba(111,180,255,0.35)'; ctx.setLineDash([2, 6]);
                ctx.beginPath(); ctx.arc(P.x, P.y, gr.T.range * map.scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
            } else if (gr instanceof RocketBattery && map.scale > 0.004) {
                const c = gr.centre(_v);
                map.toScreen(c.x, c.z, P);
                const ready = gr.launchers.filter(v => v.alive && v.src && Object.values(v.src.stock).some(n => n > 0)).length;
                ctx.fillStyle = '#6fb4ff'; ctx.textAlign = 'left';
                ctx.fillText(gr.name + ' · ' + ready + '/' + gr.launchers.length + ' READY', P.x + 12, P.y + 14);
            } else if (gr instanceof Convoy && !gr.done) {
                const c = gr.centre(_v);
                map.toScreen(c.x, c.z, P); map.toScreen(gr.destPos.x, gr.destPos.z, Q);
                ctx.strokeStyle = 'rgba(111,180,255,0.5)'; ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke(); ctx.setLineDash([]);
            }
        }
        ctx.restore();
    }

    mapActions(sel) {
        if (!this.enabled || !sel || sel.kind !== 'unit') return [];
        const u = sel.unit, war = this.war, out = [];
        if (!(u instanceof ForceVehicle) || u.team !== war.side || !u.alive) return out;
        const gr = u.ctrl;
        const mark = war.designations[war.designations.length - 1];
        if (gr instanceof RocketBattery && mark) out.push({ label: 'FIRE MISSION ON MARK ' + mark.id, run: () => { war.transmit([mark]); this.fireMission(gr, mark.unit || mark, { label: mark.label }); } });
        if (gr instanceof SamGroup || gr instanceof RocketBattery) out.push({ label: 'RELOCATE', run: () => this.relocate(gr) });
        return out;
    }

    commands() {
        if (!this.enabled) return [];
        const g = this.game, war = this.war, out = [];
        const op = this.search;
        if (op && !op.done && !op.droneDone) out.push({ path: ['SUPPORT'], label: 'RECON DRONE OVER THE TEL SEARCH AREA', hint: 'SHADOW 2', run: () => op.drone(true) });
        if (this.mode === 'sandbox') {
            const at = () => { const p = g.player && g.player.alive ? g.player.pos : g.camera.position; const f = g.player ? g.player.getForward(_v) : _v.set(0, 0, -1); return { x: p.x + f.x * 4000, z: p.z + f.z * 4000 }; };
            out.push({ path: ['SANDBOX', 'GROUND FORCES'], label: 'ENEMY SCUD TEL AHEAD', run: () => { const p = at(); const t = this.spawnTEL('red', p); if (t) war.reveal(t.v, INTEL.IDENTIFIED, 'sandbox'); } });
            for (const type of ['s300', 'buk', 'osa']) out.push({ path: ['SANDBOX', 'GROUND FORCES'], label: 'ENEMY ' + SAM_TYPES[type].label + ' AHEAD', run: () => this.spawnSAM('red', type, at()) });
            out.push({ path: ['SANDBOX', 'GROUND FORCES'], label: 'ENEMY GRAD BATTERY AHEAD', run: () => this.spawnArtillery('red', 'grad', at()) });
            out.push({ path: ['SANDBOX', 'GROUND FORCES'], label: 'START SEARCH AND DESTROY', enabled: !this.search, run: () => this.startSearch() });
        }
        void war;
        return out;
    }
}

// ═════════════ The search-and-destroy operation ═════════════
class SearchOp {
    constructor(sys, opts = {}) {
        this.sys = sys; this.game = sys.game;
        const war = this.war = sys.war;
        this.ok = false;
        this.done = false;
        // where it's going (a firing point nearer the line) and where it comes from (a road deep in their ground, a
        // drive of several minutes away)
        const red = sys.anchor('red');
        const fire = sys.within(3500, 11000, () => sys.findSite('firing', 'red', red, 1500, 16000));
        if (!fire) return;
        let entry = null;
        for (let k = 0; k < 30 && !entry; k++) {
            const s = sys.findSite('roadside', 'red', fire, 6500, 16000) || (k > 20 ? sys.findSite('hide', 'red', fire, 5000, 12000) : null);
            if (s && sys.frontDist(s.x, s.z) > sys.frontDist(fire.x, fire.z) + 1500) entry = s;
        }
        if (!entry) return;
        war.addClearing(fire.x, fire.z, fire.clearing);
        const B = { team: 'red', hides: [], firing: [fire], occupied: new Set(), reload: null, tels: [] };
        for (const k of ['forest', 'valley', 'roadside']) { const h = sys.findSite(k, 'red', fire, 1500, 5000); if (h) { B.hides.push(h); if (h.clearing) war.addClearing(h.x, h.z, h.clearing); } }
        const tel = sys.spawnTEL('red', entry, { brigade: B, sourceName: 'SCUD TEL' });
        if (!tel) return;
        this.tel = tel;
        B.tels.push(tel);
        // the escort: an SA-8 following 120 m behind, its radar dark until someone comes close
        const esc = sys.spawnSAM('red', 'osa', { x: entry.x + rand(-40, 40), z: entry.z + rand(-40, 40), heading: entry.heading }, { launchers: 1, deployed: false, emcon: 'ambush', support: false, name: 'SA-8 ESCORT' });
        this.escort = esc;
        if (esc) esc.state = 'travel';
        // the order: a missile at one of ours; the TEL drives to its firing point for it
        const t = sys.blueTarget();
        if (!t) return;
        this.target = t;
        const n = sys.fireMission(tel, t.unit || t.pos, { label: t.label });
        if (!n) return;
        if (esc) {
            const l = esc.launchers[0];
            const follow = () => { const r = tel.v.route.r; if (r && l.alive) { l.drive(r, { lead: tel.v, gap: 120, s: 0, end: Math.max(r.len - 120, 1) }); esc.state = 'moving'; } };
            sys.later(0.1, follow);
        }
        this.t0 = war.time;
        this.eta0 = tel.prepEstimate();
        // "Enemy TEL detected entering the region": a wide search area over the middle of its drive
        const r = tel.v.route.r;
        const mid = r ? r.at(r.len * 0.55, {}, 0) : fire;
        const c = new THREE.Vector3(mid.x + rand(-1500, 1500), 0, mid.z + rand(-1500, 1500));
        const place = sys.placeName(c), named = !place.startsWith('GRID');
        this.rp = war.report({ text: 'ENEMY TEL ENTERING ' + (named ? place : 'THE AREA') + ' — MOVING TO A FIRING POSITION. SEARCH THE HIGHWAYS AND VALLEYS', center: c, radius: 6500, unit: tel.v, cls: 'tel', say: false });
        sys.say('COMMAND', 'PRIORITY — INTEL REPORTS AN ENEMY TEL WITH AN ESCORT ENTERING ' + (named ? place + ', ' : '') + 'GRID ' + war.grid(c.x, c.z) + '. FIND IT BEFORE IT FIRES', { color: '#ff9f5a', say: 'Priority. An enemy missile launcher is moving into position. Find it before it fires.', priority: true });
        this.droneAt = war.time + this.eta0 * rand(0.3, 0.42);
        this.area = { center: this.rp.center, radius: this.rp.radius };
        const tasks = this.game.tasks, rec = war.rec(tel.v);
        if (tasks && tasks.offer) {
            this.task = tasks.offer({
                type: 'tel', key: 'tel:' + (rec ? rec.id : 0) + ':search', urgent: true, title: 'SEARCH AND DESTROY — MOBILE MISSILE LAUNCHER',
                brief: 'AN ENEMY SCUD TEL IS DRIVING TO A FIRING POSITION WITH A SAM ESCORT. SEARCH THE ROADS AND VALLEYS IN THE AREA, IDENTIFY THE LAUNCHER (EYES OR TARGETING POD), THEN DESTROY IT OR MARK IT FOR A STRIKE (ATACMS / GMLRS).',
                units: [tel.v], reward: 1500, label: 'TEL', expires: Math.max(90, this.eta0 * 0.8), limit: 0, area: this.area, report: this.rp,
                progress: () => (tel.launchPos ? 'MISSILE AWAY' : 'LAUNCH IN ' + sys.clock(this.eta()) + (this.droneDone ? ' · DRONE CONTACT' : '')),
                check: () => (!tel.v.alive ? 'done:NO LAUNCH TODAY — THE TEL IS DESTROYED' : tel.launchPos ? 'failed:THE MISSILE IS AWAY' : null),
            }, { force: true });
        }
        sys.emit('searchStarted', this, { tel: tel.v });
        this.ok = true;
    }
    eta() { return this.tel.v.alive && !this.tel.launchPos ? this.tel.prepEstimate() : 0; }
    // the recon drone finds "a possible convoy": the area shrinks round it, the vehicles become contacts
    drone(requested = false) {
        if (this.droneDone || this.done) return;
        this.droneDone = true;
        const sys = this.sys, war = this.war, v = this.tel.v;
        const c = new THREE.Vector3(v.pos.x + rand(-500, 500), 0, v.pos.z + rand(-500, 500));
        this.rp.center.copy(c); this.rp.radius = 1600;
        this.area.center = this.rp.center; this.area.radius = 1600;
        war.reveal(v, INTEL.CONTACT, 'drone', true);
        if (this.escort) for (const m of this.escort.members) if (m.alive) war.reveal(m, INTEL.CONTACT, 'drone', true);
        const moving = v.moving ? 'MOVING ' + this.dirWord(v) : 'STOPPED';
        sys.say('SHADOW 2', (requested ? 'ON STATION. ' : '') + 'POSSIBLE CONVOY — TWO VEHICLES ' + moving + ' NEAR ' + sys.placeName(c) + ', GRID ' + war.grid(c.x, c.z) + '. CAN\'T CONFIRM TYPE', { color: '#9fd4ff', say: 'Shadow two. Possible convoy, two vehicles. Grid ' + war.grid(c.x, c.z).replace(/ /g, ', ') + '.' });
    }
    dirWord(v) {
        const d = ((Math.atan2(v.vel.x, -v.vel.z) * 57.3) + 360) % 360;
        return ['NORTH', 'NORTH-EAST', 'EAST', 'SOUTH-EAST', 'SOUTH', 'SOUTH-WEST', 'WEST', 'NORTH-WEST'][Math.round(d / 45) % 8];
    }
    update() {
        if (this.done) return;
        const sys = this.sys, war = this.war, v = this.tel.v;
        if (!v.alive) { this.end('killed'); return; }
        if (!this.droneDone && war.time >= this.droneAt) this.drone(false);
        // the escort wakes up when a jet comes in close: radar on (its RWR spike), it halts and deploys
        const esc = this.escort;
        if (esc && esc.alive && esc.state === 'moving') {
            const p = this.game.player;
            const l = esc.launchers[0];
            if (p && p.alive && l && l.alive && p.pos.distanceTo(l.pos) < 9000 && !p.onGround) { l.stop(); esc.deploy(); }
            else if (l && l.alive && !l.moving && !v.moving) esc.deploy();
        }
        // identified: the SAM escort knows the game is up
        if (!this.idCalled && war.known(v) >= INTEL.IDENTIFIED) { this.idCalled = true; if (esc && esc.state === 'moving') { const l = esc.launchers[0]; if (l) l.stop(); esc.deploy(); } }
        if (this.tel.launchPos && !this.firedT) { this.firedT = war.time; sys.later(240, () => this.end('fired')); }
    }
    end(why) {
        this.done = true;
        this.why = why;
        this.sys.search = null;
        this.sys.emit('searchEnded', this, { why });
    }
}

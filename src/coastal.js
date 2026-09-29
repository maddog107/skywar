// ═══════════════════════════════════════════════════════════════
// Coastal missile batteries (docs/WAR.md, "Airbases" → ground missile installations), a plug-in system
// (systems.js, game.coastal) in the war modes:
//  • red: a K-300P Bastion-P battery on the coast east of their airbase — two K-340P launchers (P-800 Oniks in
//    their canisters: the roof opens, the jacks go down, the canisters stand up and the missile leaves vertically),
//    the battery command vehicle, and a surface-search radar (a P-18 standing in for the Monolit-B). It engages our
//    ships it can see — its own radar out to the horizon, or the carrier once their recon has found it
//  • blue: a Harpoon coastal defence battery west of our airbase — two HEMTT-mounted quad Harpoon launchers
//    (models/airbases/hcds.glb), a command post and a Sentinel radar. It engages enemy ships our side has identified
// Both are launch sources of kind 'battery' in the strike manager (strikes.js): the engagement goes through
// strikes.request('antiship', [ship], team), so they only fire when they are the shooter the manager would pick.
// Stock: two salvos, then a reload twenty minutes later (twice). A launch gives the battery away (the war layer's
// firingT, the director's launch contact, the tasks' "find the launcher").
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, terrainHeight } from './world.js';
import { LaunchSource, STRIKE_TYPES } from './strikes.js';
import { INTEL } from './war.js';
import { dress } from './dressing.js';
import { VEHICLES, pose, muzzleWorld, spin } from './vehicles.js';
import { hasModel, createModel, airbaseModelsReady } from './airbasemodels.js';
import { rand, clamp } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

// P-800 Oniks (game-scale speed; a sea-skimmer at the end): what the Bastion's launchers put in the air when the
// strike manager asks the red side for an anti-ship shot
export const ONIKS = { kind: 'antiship', name: 'P-800 ONIKS', short: 'ONIKS', speed: 320, alt: 14, seaAlt: 10, boost: 5, warhead: 250, blast: 22, hard: 0.4, len: 8.9, dia: 0.7, span: 1.7, color: 0x8b9087, nose: 0x3a3d3a };

// ═════════════ Where a battery goes ═════════════
// A flat spot on `team`'s side, 4–90 m up, within ~2 km of deep water, away from towns and airfields; the one
// nearest the preferred point wins (a fixed scan: the same place every war)
export function findCoastalSite(game, pref, team, { radius = 14000, step = 250 } = {}) {
    const war = game.war, towns = game.world && game.world.towns;
    let best = null, bs = Infinity;
    const R = radius;
    for (let dz = -R; dz <= R; dz += step) for (let dx = -R; dx <= R; dx += step) {
        const x = pref.x + dx, z = pref.z + dz;
        const d = Math.hypot(dx, dz);
        if (d > R || d * 1.0 > bs) continue;
        const h = terrainHeight(x, z);
        if (h < 4 || h > 90) continue;
        if (war && war.sideAt && war.sideAt(x, z) !== team) continue;
        if (BASES.some(b => Math.hypot(x - b.x, z - b.z) < b.r * 2)) continue;
        let flat = true;
        for (const [ox, oz] of [[45, 0], [-45, 0], [0, 45], [0, -45], [32, 32], [-32, -32]]) if (Math.abs(terrainHeight(x + ox, z + oz) - h) > 5) { flat = false; break; }
        if (!flat) continue;
        if (towns && towns.blockTree && towns.blockTree(x, z)) continue;
        if (towns && towns.towns && towns.towns.some(t => Math.hypot(t.x - x, t.z - z) < (t.radius || 600) + 500)) continue;
        // deep water close by, in some direction
        let sea = Infinity;
        for (let k = 0; k < 16; k++) {
            const a = k / 16 * Math.PI * 2;
            for (const r of [700, 1200, 1800, 2400]) if (terrainHeight(x + Math.cos(a) * r, z + Math.sin(a) * r) < -20) { sea = Math.min(sea, r); break; }
        }
        if (sea === Infinity) continue;
        const score = d + sea * 0.6;
        if (score < bs) { bs = score; best = { x, z, h, sea }; }
    }
    return best;
}

// ═════════════ The battery as a launch source ═════════════
export class CoastalBattery extends LaunchSource {
    // launchers: ground targets (each with .rig once its model is in); opts: { team, name, stock, spec (missile to fly
    // instead of the strike type's), range }
    constructor(mgr, launchers, opts) {
        super(mgr, { kind: 'battery', name: opts.name, team: opts.team, stock: opts.stock, host: launchers[0], range: opts.range || 110000 });
        this.launchers = launchers;
        this.spec = opts.spec || null;
        this.li = 0;
        this.deployK = 0;
        this.lastLaunch = -1e9;
    }
    get alive() { return this.launchers.some(l => l.alive); }
    get pos() { return (this.launchers.find(l => l.alive) || this.launchers[0]).pos; }
    prepTime() { return 45; }   // roof open, jacks down, canisters up
    fire(specKey, n, aim, strike) { return super.fire(specKey, n, aim, strike, 4); }
    launchFrame(out, dir, q) {
        // alternate launchers, each firing its canisters in turn: straight up out of the vertical canister
        const alive = this.launchers.filter(l => l.alive);
        const L = alive[(this.li++) % Math.max(1, alive.length)] || this.launchers[0];
        q.launcher = L;
        const rig = L.rig;
        if (rig && rig.muzzles.length && muzzleWorld(rig, (this.li >> 1) % rig.muzzles.length, out, dir)) {
            if (dir.y < 0.5) dir.set(0, 1, 0);
            return;
        }
        out.copy(L.pos).y += 6;
        dir.set(0, 1, 0);
    }
    launch(q) {
        const spec = this.spec || null;
        if (!spec) return super.launch(q);
        const p = new THREE.Vector3(), d = new THREE.Vector3();
        this.launchFrame(p, d, q);
        const m = this.mgr.spawnMissile(spec, this.team, p, d, q.aim, this, q.strike);
        this.fired++;
        this.lastLaunch = this.game.war.time;
        if (q.launcher) q.launcher.firingT = this.game.war.time;
        if (this.host) this.host.firingT = this.game.war.time;
        this.launchEffects(p, d, spec);
        return m;
    }
    update(dt) {
        super.update(dt);
        // the launchers come up to fire and go back down to travel a minute after the last shot
        const want = this.queue.length || this.game.war.time - this.lastLaunch < 60 ? 1 : 0;
        const k0 = this.deployK;
        this.deployK = clamp(this.deployK + (want ? dt / 40 : -dt / 50), 0, 1);
        if (this.deployK !== k0) for (const L of this.launchers) {
            if (!L.alive || !L.rig) continue;
            const groups = L.deployGroups || ['jack', 'raise'];
            const n = groups.length, k = this.deployK;
            groups.forEach((g, i) => pose(L.rig, g, clamp(k * n - i, 0, 1)));
        }
    }
}

// ═════════════ The system ═════════════
export class CoastalDefence {
    constructor(game) {
        this.game = game;
        this.enabled = false;
        this.batteries = [];
    }

    start(mode) {
        this.clear();
        this.enabled = mode === 'war' || mode === 'sandbox';
        if (!this.enabled) return;
        this.setupT = 2; // after the other systems (the front's towns, the strike manager's sources)
    }

    clear() {
        this.batteries.length = 0;
        this.enabled = false;
    }

    setup() {
        const g = this.game;
        if (!g.strikes || !g.ground || !g.ground.addTarget) return;
        const red = findCoastalSite(g, { x: 12000, z: -19500 }, 'red');
        if (red) this.batteries.push(this.build(red, 'red'));
        const blue = findCoastalSite(g, { x: -4500, z: 1800 }, 'blue');
        if (blue) this.batteries.push(this.build(blue, 'blue'));
    }

    // a battery at a site: two launchers facing the sea, the command vehicle and the radar behind
    build(site, team) {
        const g = this.game, war = g.war;
        // toward the water: the direction of the nearest deep water
        let sea = 0, sd = Infinity;
        for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; for (const r of [600, 1200, 1800, 2400]) if (terrainHeight(site.x + Math.cos(a) * r, site.z + Math.sin(a) * r) < -20) { if (r < sd) { sd = r; sea = a; } break; } }
        const fx = Math.cos(sea), fz = Math.sin(sea), rx = -fz, rz = fx;
        const yaw = Math.atan2(-fx, -fz); // the vehicles' noses toward the sea
        const at = (f, r) => ({ x: site.x + fx * f + rx * r, z: site.z + fz * f + rz * r });
        const red = team === 'red';
        const mk = (type, p, name, cls, hp) => {
            const t = g.ground.addTarget(type, p.x, p.z, yaw, team);
            t.name = name; t.def = { ...t.def, name, score: hp * 3 }; t.hp = t.maxHp = t.health = t.maxHealth = hp;
            t.radius = t.hitRadius = 7;
            // (theirs starts unknown: hidden on the coast until it's seen or it fires)
            war.add(t, { cls, name, conceal: red ? 0.35 : 0, known: red ? INTEL.UNKNOWN : undefined });
            return t;
        };
        const launchers = [mk('truck', at(0, -35), red ? 'K-340P BASTION-P LAUNCHER' : 'HARPOON COASTAL LAUNCHER', 'tel', 95), mk('truck', at(0, 35), red ? 'K-340P BASTION-P LAUNCHER' : 'HARPOON COASTAL LAUNCHER', 'tel', 95)];
        const cmd = mk('truck', at(-120, 0), red ? 'BASTION COMMAND VEHICLE' : 'BATTERY COMMAND POST', 'command', 70);
        const radar = mk('radar', at(-220, 60), red ? 'COASTAL SURVEILLANCE RADAR' : 'AN/MPQ-64 SENTINEL', 'radar', 110);
        radar.radarRange = red ? 70000 : 45000;
        // their models
        if (red) {
            for (const L of launchers) { L.deployGroups = VEHICLES.bastion.deploy; dress(L, 'bastion'); }
            dress(cmd, 'cmd_red', { pose: 'raised', onRig: (rig) => { for (const k of VEHICLES.cmd_red.deploy) pose(rig, k, 1); } });
            dress(radar, 'p18', { onRig: (rig) => { for (const k of VEHICLES.p18.deploy) pose(rig, k, 1); radar.spinRig = rig; } });
        } else {
            for (const L of launchers) this.dressHcds(L);
            dress(cmd, 'cmd_blue', { pose: 'raised', onRig: (rig) => { for (const k of VEHICLES.cmd_blue.deploy) pose(rig, k, 1); } });
            dress(radar, 'sentinel', { onRig: (rig) => { for (const k of VEHICLES.sentinel.deploy) pose(rig, k, 1); radar.spinRig = rig; } });
        }
        war.addClearing(site.x, site.z, 320);
        const src = g.strikes.addSource(new CoastalBattery(g.strikes, launchers, {
            team, name: red ? 'BASTION BATTERY' : 'HARPOON BATTERY', stock: red ? { kalibr: 4 } : { harpoon: 4 }, spec: red ? ONIKS : null, range: red ? 120000 : 100000,
        }));
        return { team, site, launchers, cmd, radar, src, nextT: this.game.war.time + rand(200, 360), reloads: 2, reloadT: 0, yaw };
    }

    // the Harpoon launcher model (airbasemodels.js), or the HIMARS standing in until it's loaded
    dressHcds(L) {
        const apply = () => {
            if (!L.alive || L.vehicle || !hasModel('hcds')) return false;
            const made = createModel('hcds');
            if (!made) return false;
            for (const c of L.mesh.children) c.visible = false;
            L.mesh.add(made.object);
            L.vehicle = made.object; L.rig = made.rig; L.parts = {};
            L.deployGroups = ['jack', 'raise'];
            return true;
        };
        if (!apply()) airbaseModelsReady().then(() => { if (!apply()) dress(L, 'himars'); });
    }

    update(dt) {
        if (!this.enabled) return;
        const g = this.game;
        if (this.setupT !== null) { this.setupT -= dt; if (this.setupT <= 0) { this.setupT = null; this.setup(); } return; }
        for (const B of this.batteries) if (B.radar.alive && B.radar.spinRig) spin(B.radar.spinRig, dt);
        this.acc = (this.acc || 0) + dt;
        if (this.acc < 2) return;
        const step = this.acc;
        this.acc = 0;
        for (const B of this.batteries) {
            if (!B.src.alive) continue;
            // reloads from the battery's transport-loaders
            const left = Object.values(B.src.stock).reduce((a, n) => a + n, 0);
            if (!left && B.reloads > 0) {
                B.reloadT += step;
                if (B.reloadT > 1200) { B.reloadT = 0; B.reloads--; for (const k of Object.keys(B.src.stock)) B.src.stock[k] = 2; }
                continue;
            }
            if (g.war.time < B.nextT || B.src.queue.length) continue;
            const ship = this.pickShip(B);
            if (!ship) continue;
            // only when we're the shooter the strike manager would pick for this one
            const T = STRIKE_TYPES.antiship, key = T.use[B.team];
            const first = g.strikes.sources.filter(s => s.team === B.team && T.sources.includes(s.kind) && s.canFire(key) && s.pos.distanceTo(ship.pos) < s.range)
                .sort((a, b) => a.pos.distanceToSquared(ship.pos) - b.pos.distanceToSquared(ship.pos))[0];
            if (first !== B.src) { B.nextT = g.war.time + 60; continue; }
            const st = g.strikes.request('antiship', [ship], B.team, true);
            const k = g.director && g.director.intensity ? g.director.intensity() : 1;
            B.nextT = g.war.time + (st ? rand(480, 660) / (B.team === 'red' ? k : 1) : 90);
            if (st && B.team === g.war.side) this.say('HARPOON BATTERY', 'ENGAGING ' + g.war.label(ship) + ' — ' + st.planned + ' HARPOONS, TIME ON TARGET ' + Math.round(g.strikes.estimate(st.spec, B.src.pos, ship.pos) + B.src.prepTime()) + ' SECONDS', { color: '#9fd4ff', say: 'Harpoon battery engaging.' });
        }
    }

    // a ship the battery can shoot at: in range, and seen — the red battery by its own radar (to the horizon) or,
    // for our carrier, by their recon; ours when our side has identified it lately
    pickShip(B) {
        const g = this.game, war = g.war, naval = g.naval;
        if (!naval) return null;
        let best = null, bs = Infinity;
        for (const s of naval.ships) {
            if (!s.alive || s.gone || s.team === B.team || s.type === 'rhib' || s.type === 'cb90') continue;
            const d = s.pos.distanceTo(B.src.pos);
            if (d > B.src.range * 0.9) continue;
            let seen;
            if (B.team === war.side) { const r = war.rec(s); seen = !!r && r.known >= INTEL.IDENTIFIED && war.time - r.lastSeen < 900; }
            else seen = (B.radar.alive && s.pos.distanceTo(B.radar.pos) < 42000) || (s.type === 'carrier' && g.director && g.director.reconSawCarrier);
            if (!seen) continue;
            const score = d * (s.type === 'carrier' ? 0.5 : 1);
            if (score < bs) { bs = score; best = s; }
        }
        return best;
    }

    say(from, text, opts) { const d = this.game.director; if (d && d.enabled && d.say) d.say(from, text, opts); else this.game.war.radio(from, text, opts); }
}
void _v; void _v2;

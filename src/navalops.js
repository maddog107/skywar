// ═══════════════════════════════════════════════════════════════
// Naval operations (docs/WAR.md "Naval operations"), a plug-in system (systems.js):
//  • carrier strike groups on both sides (spawnGroup): formation stations kept on the move, turns together, speed
//    changes, a zig-zag when threatened, flight operations into the wind; every ship in the war registry
//  • layered air defence: long-range SAMs (SM-2 / SM-6; the Slava's S-300F), then medium (ESSM, RAM, Sea Sparrow,
//    Osa-M, Shtil), then the CIWS guns (naval.js) — against aircraft, anti-ship missiles and the strategic missiles
//    in flight (strikes.js). Threat evaluation and weapon assignment twice a second (planEngagements):
//    shoot-shoot-look at missiles, shoot-look-shoot at aircraft, the outer layer first
//  • surface action: Harpoon / Tomahawk / Kalibr / P-1000 salvos between groups, flown through strikes.js
//  • launches on the rigs (launchseq.js): a Mk 41 cell's hatch opens, the missile climbs out on its booster, the
//    uptake vents, the hatch closes; the Slava's inclined containers and cold-launch revolvers; submarines come up
//    to periscope depth, raise their masts, and their capsules break the surface before the booster lights
//  • carrier operations (deckops.js): catapult launches, recoveries, deck crews, elevators, parked aircraft
//  • radio: VAMPIRE calls, BIRDS AWAY, splashes, leakers, BRUISER (through the director's pacing in a war);
//    naval tasks for the Living War (tasks.js)
// API for other plug-ins: spawnGroup(side, center, opts), launchFrom(ship, key, target, n), groupOf(ship),
// moveGroupOf(ship, pos), steerGroup(group, heading, speed), deckOf(carrier), catapultLaunch(carrier, ac),
// magazineOf(ship), recover(ac).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { findOcean, cellFrame, pointFrame, raiseMast, setDepth, poseRig, shipsLoaded, hasShipModel, HELM } from './naval.js';
import { ShipVLS, SubLauncher, MISSILES } from './strikes.js';
import { LaunchControl, buildMagazine, LOADOUTS } from './launchseq.js';
import { DeckOps, loadDeckCrew } from './deckops.js';
import { INTEL } from './war.js';
import { terrainHeight } from './world.js';
import { waterHeight } from './water.js';
import { clamp, lerp, rand, interceptTime, G, updateWorldChain } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(0, 0, -1);
const wrapPi = (a) => { a %= Math.PI * 2; return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a; };
const KT = 0.5144; // m/s per knot

// ═════════════ The interceptors ═════════════
// Game-scale (the theatre is ~120 km across: ranges are a fifth to a quarter of the real ones, speeds are real).
// layer: 'long' | 'medium'; range / minRange m (intercept point); speed m/s after the boost; accel m/s² while it
// burns; boost s of burn; turnG; prox m (proximity fuse); warhead (damage at the burst); pk: chance a burst kills a
// missile (aircraft take the damage instead); tip: s after leaving a vertical cell before it turns hard (the
// tip-over); ir: a heat seeker (flares fool it; radar ones are fooled by the chaff in a flare salvo less often).
export const SAMS = {
    sm2: { name: 'SM-2', layer: 'long', range: 26000, minRange: 2200, speed: 1000, accel: 170, boost: 4, turnG: 28, prox: 18, warhead: 110, pk: 0.72, tip: 0.9, len: 4.7, dia: 0.34, color: 0xe8e8e2 },
    sm6: { name: 'SM-6', layer: 'long', range: 36000, minRange: 3000, speed: 1150, accel: 160, boost: 5, turnG: 30, prox: 18, warhead: 120, pk: 0.8, tip: 1.1, len: 6.55, dia: 0.53, color: 0xe8e8e2, booster: 1.7 },
    essm: { name: 'ESSM', layer: 'medium', range: 12000, minRange: 800, speed: 950, accel: 260, boost: 2.5, turnG: 40, prox: 14, warhead: 80, pk: 0.75, tip: 0.45, len: 3.66, dia: 0.254, color: 0xe4e4dc },
    ram: { name: 'RAM', layer: 'medium', range: 6000, minRange: 400, speed: 780, accel: 240, boost: 2, turnG: 35, prox: 10, warhead: 60, pk: 0.7, tip: 0, len: 2.8, dia: 0.127, color: 0xe4e4dc, ir: true },
    nssm: { name: 'SEA SPARROW', layer: 'medium', range: 9000, minRange: 800, speed: 900, accel: 220, boost: 2.5, turnG: 30, prox: 14, warhead: 75, pk: 0.65, tip: 0, len: 3.66, dia: 0.2, color: 0xe4e4dc },
    s300f: { name: 'S-300F', layer: 'long', range: 24000, minRange: 3000, speed: 1100, accel: 150, boost: 5, turnG: 24, prox: 20, warhead: 130, pk: 0.65, tip: 0.6, len: 7.25, dia: 0.45, color: 0xd9dcd2 },
    osa: { name: 'OSA-M', layer: 'medium', range: 7000, minRange: 800, speed: 700, accel: 200, boost: 3, turnG: 22, prox: 14, warhead: 70, pk: 0.55, tip: 0, len: 3.2, dia: 0.21, color: 0xd0d4c8 },
    shtil: { name: 'SHTIL', layer: 'medium', range: 13000, minRange: 1000, speed: 900, accel: 200, boost: 3, turnG: 28, prox: 16, warhead: 90, pk: 0.65, tip: 0.5, len: 5.2, dia: 0.36, color: 0xd0d4c8 },
};

// ═════════════ Ships in groups ═════════════
// A group by role: [type, role, station across (starboard +), station along (aft +)] — metres, in the formation's
// frame (its axis is the base course). The guide (the carrier, or the first ship) sits at 0, 0.
export const CSG = [['carrier', 'hvu', 0, 0], ['cruiser', 'aaw', 0, -2600], ['destroyer', 'screen', -2300, -900], ['destroyer', 'screen', 2300, -900], ['supply', 'logistics', 1600, 1700], ['ssn', 'sub', 600, -5800]];
export const SAG = [['slava', 'aaw', 0, -2400], ['destroyer', 'screen', -2100, -700], ['destroyer', 'screen', 2100, -700], ['supply', 'logistics', 0, 2100], ['ssn', 'sub', -600, -5500]];
const NAMES = {
    blue: { carrier: ['USS GEORGE WASHINGTON (CVN-73)', 'USS THEODORE ROOSEVELT (CVN-71)', 'USS ABRAHAM LINCOLN (CVN-72)', 'USS HARRY S. TRUMAN (CVN-75)'], cruiser: ['USS NORMANDY (CG-60)', 'USS LEYTE GULF (CG-55)', 'USS PHILIPPINE SEA (CG-58)'], destroyer: ['USS MASON (DDG-87)', 'USS NITZE (DDG-94)', 'USS BAINBRIDGE (DDG-96)', 'USS GRAVELY (DDG-107)', 'USS STOUT (DDG-55)', 'USS ROSS (DDG-71)'], supply: ['USNS SUPPLY (T-AOE-6)', 'USNS ARCTIC (T-AOE-8)'], ssn: ['USS JOHN WARNER (SSN-785)', 'USS VERMONT (SSN-792)'], ssgn: ['USS FLORIDA (SSGN-728)', 'USS GEORGIA (SSGN-729)'], slava: ['SLAVA'] },
    red: { carrier: ['ENEMY CARRIER'], slava: ['VARYAG (011)', 'MARSHAL USTINOV (055)'], destroyer: ['ADMIRAL TRIBUTS (564)', 'ADMIRAL CHABANENKO (650)', 'ADMIRAL VINOGRADOV (572)', 'SEVEROMORSK (619)'], supply: ['AKADEMIK PASHIN', 'VYAZMA'], ssn: ['SEVERODVINSK (K-560)', 'KAZAN (K-561)'], ssgn: ['KAZAN (K-561)'], cruiser: ['MOSKVA (121)'] },
};
// what the HUD calls an enemy ship (its class), and the war registry once it's identified
const RED_HUD = { carrier: 'ENEMY CARRIER', slava: 'SLAVA CRUISER', destroyer: 'DESTROYER', supply: 'SUPPLY SHIP', ssn: 'SUBMARINE', ssgn: 'SUBMARINE', cruiser: 'CRUISER' };
const CLASS_OF = { carrier: 'CARRIER', slava: 'SLAVA-CLASS CRUISER', destroyer: 'DESTROYER', cruiser: 'TICONDEROGA-CLASS CRUISER', supply: 'FAST COMBAT SUPPORT SHIP', ssn: 'ATTACK SUBMARINE', ssgn: 'GUIDED-MISSILE SUBMARINE' };
// air-search radar: antenna height (m) and range (m); fire-control channels (missiles guided at once)
const SENSORS = { carrier: { h: 45, r: 90000, ch: 4 }, cruiser: { h: 38, r: 110000, ch: 16 }, destroyer: { h: 32, r: 100000, ch: 12 }, slava: { h: 36, r: 90000, ch: 6 }, supply: { h: 30, r: 40000, ch: 0 }, ssn: { h: 6, r: 25000, ch: 0 }, ssgn: { h: 6, r: 25000, ch: 0 } };
// the ship-killer each type fires in a surface action
const SURFACE = { blue: { cruiser: 'harpoon', destroyer: 'tlam' }, red: { slava: 'p1000', destroyer: 'kalibr', ssn: 'kalibr' } };
// radar horizon, game scale: HORIZON · (√h1 + √h2) m (the real 4/3-earth figure is 4120; the theatre is compressed)
export const HORIZON = 1900;
export const radarHorizon = (h1, h2) => HORIZON * (Math.sqrt(Math.max(h1, 0)) + Math.sqrt(Math.max(h2, 0)));
const SPEEDS = { cruise: 16 * KT, ops: 24 * KT, flank: 28 * KT };
const NAVAL_VOICE = { pitch: 0.86, rate: 1.16, name: 'Daniel|Alex|Fred' };

// ═════════════ Station keeping and navigation (pure; tests/navalops.test.mjs) ═════════════
// The heading and speed that bring a ship to its station and keep it there: the guide's own velocity (gvx, gvz) plus
// a correction that closes the gap over about a minute — slowing (never backing) when it's ahead of its station,
// sprinting up to its own top speed when it's behind or out on the far side of a turn.
export function stationSteer(px, pz, sx, sz, gvx, gvz, maxSpeed, out = {}, axis = 0) {
    const gSpeed = Math.hypot(gvx, gvz);
    const fx = gSpeed > 0.3 ? gvx / gSpeed : -Math.sin(axis), fz = gSpeed > 0.3 ? gvz / gSpeed : -Math.cos(axis), rx = -fz, rz = fx;
    const ex = sx - px, ez = sz - pz;
    const ea = ex * fx + ez * fz, ec = ex * rx + ez * rz;
    const k = 1 / 55;
    const along = clamp(gSpeed + ea * k, gSpeed * 0.45, maxSpeed);
    const cross = clamp(ec * k, -maxSpeed * 0.7, maxSpeed * 0.7);
    let vx = fx * along + rx * cross, vz = fz * along + rz * cross, v = Math.hypot(vx, vz);
    if (v > maxSpeed) { vx *= maxSpeed / v; vz *= maxSpeed / v; v = maxSpeed; }
    out.heading = Math.atan2(-vx, -vz); out.speed = v; out.err = Math.hypot(ex, ez);
    return out;
}
// a station's world position: the guide's plus the offset turned onto the formation axis
export function stationPos(gx, gz, axis, ox, oz, out = {}) {
    const c = Math.cos(axis), s = Math.sin(axis);
    out.x = gx + ox * c + oz * s; out.z = gz - ox * s + oz * c;
    return out;
}
// How far a course runs through water deeper than 30 m (and 600 m either side), up to `look` (Infinity: all clear)
export function clearRun(x, z, h, look = 5000) {
    const dx = -Math.sin(h), dz = -Math.cos(h), rx = -dz, rz = dx;
    for (let d = 400; d <= look; d += 400) for (const s of [-600, 0, 600]) if (terrainHeight(x + dx * d + rx * s, z + dz * d + rz * s) > -30) return d;
    return Infinity;
}
// deep water all round a point, out to r (room for a group)
export function openWater(x, z, r) {
    if (terrainHeight(x, z) > -60) return false;
    for (let k = 0; k < 12; k++) {
        const a = k / 12 * Math.PI * 2;
        for (const f of [0.5, 1]) if (terrainHeight(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f) > -30) return false;
    }
    return true;
}
// the heading nearest `want` with open water ahead (the most open one if nothing is clear)
export function openCourse(x, z, want, look = 5000) {
    if (clearRun(x, z, want, look) === Infinity) return want;
    let best = want, bestD = -1;
    for (let k = 1; k <= 12; k++) for (const sg of [1, -1]) {
        const h = wrapPi(want + sg * k * Math.PI / 12), d = clearRun(x, z, h, look);
        if (d === Infinity) return h;
        if (d > bestD) { bestD = d; best = h; }
    }
    return best;
}

// ═════════════ Threat evaluation and weapon assignment (pure; tests/navalops.test.mjs) ═════════════
// threats: [{ id, kind: 'missile' | 'aircraft', pos, vel, defend (the position it's closing on: its target ship's, or
//   the nearest of ours), inFlight (our interceptors on it now) }]; shooters: [{ id, pos, channels (free), weapons: [{ key, count, ready }] }].
// Returns [{ threat, shooter, key, n }] in firing order: the most urgent first (missiles before aircraft at the
// same time to go), each with the outermost layer whose intercept point is in its envelope — the medium layer where
// its envelope reaches (saving the long-range rounds for what only they can reach) — a salvo of two at a missile
// (shoot-shoot-look), one at an aircraft (shoot-look-shoot).
export function planEngagements(threats, shooters, { mediumReach = null } = {}) {
    const out = [];
    const ranked = threats.map(t => {
        const tgt = t.defend; // (the position it's closing on: its target's, or the group's)
        let ttg = Infinity;
        if (tgt) {
            const dx = tgt.x - t.pos.x, dy = (tgt.y ?? 0) - t.pos.y, dz = tgt.z - t.pos.z, d = Math.hypot(dx, dy, dz);
            const closing = (t.vel.x * dx + t.vel.y * dy + t.vel.z * dz) / Math.max(d, 1);
            ttg = closing > 5 ? d / closing : Infinity;
        }
        return { t, ttg, pri: (t.kind === 'missile' ? 3 : 1) / Math.max(Math.min(ttg, 1e5), 1) };
    }).sort((a, b) => b.pri - a.pri);
    const medR = mediumReach ?? Math.max(0, ...shooters.flatMap(s => s.weapons.filter(w => SAMS[w.key] && SAMS[w.key].layer === 'medium').map(w => SAMS[w.key].range)));
    for (const { t } of ranked) {
        const want = t.kind === 'missile' ? 2 : 1;
        let need = want - (t.inFlight || 0);
        if (need <= 0 || (t.kind !== 'missile' && t.inFlight > 0)) continue;
        while (need > 0) {
            let best = null;
            for (const s of shooters) {
                if (s.channels <= 0) continue;
                for (const w of s.weapons) {
                    const S = SAMS[w.key];
                    if (!S || w.count <= 0 || w.ready === false) continue;
                    const rx = t.pos.x - s.pos.x, ry = t.pos.y - s.pos.y, rz = t.pos.z - s.pos.z;
                    let ti = interceptTime(rx, ry, rz, t.vel.x, t.vel.y, t.vel.z, S.speed * 0.85);
                    if (ti <= 0) continue;
                    ti += S.tip + 1; // (the launch and the tip-over)
                    const ix = rx + t.vel.x * ti, iy = ry + t.vel.y * ti, iz = rz + t.vel.z * ti, r = Math.hypot(ix, iy, iz);
                    if (r > S.range || r < S.minRange) continue;
                    // the outer layer only where the medium can't reach yet
                    const layerScore = S.layer === 'long' ? (r > medR * 0.9 ? 2 : 0) : (r <= S.range ? 1.5 : 0);
                    const score = layerScore - ti * 0.002;
                    if (!best || score > best.score) best = { s, w, score };
                }
            }
            if (!best) break;
            const n = Math.min(need, best.w.count, best.s.channels);
            out.push({ threat: t, shooter: best.s, key: best.w.key, n });
            best.w.count -= n; best.s.channels -= n; need -= n;
            t.inFlight = (t.inFlight || 0) + n;
        }
    }
    return out;
}

// ═════════════ A group ═════════════
export class Group {
    constructor(ops, side, { name = null, area = null } = {}) {
        this.ops = ops; this.side = side;
        this.id = ops.nextGroup++;
        this.name = name || (side === ops.game.war?.side ? 'CARRIER STRIKE GROUP' : 'ENEMY SURFACE GROUP');
        this.members = [];        // { ship, role, ox, oz, slot }
        this.guide = null;
        this.course = 0; this.axis = 0; this.speed = SPEEDS.cruise; this.order = 'cruise';
        this.area = area;         // { x, z, r }: where it patrols
        this.dest = null;         // a fleet move's destination
        this.leg = null; this.legT = 0;
        this.zig = { on: true, t: 0, off: 0 }; this.threat = 0; this.threatT = 0;
        this.navT = 0; this.navCourse = 0;
        this.tracks = [];         // what its radars see (air-defence threats)
        this.adT = rand(0, 0.5);
        this.surfT = rand(90, 150);
        this.flightOps = 0;       // s left of steady into-the-wind course for launches / recoveries
        this.vampireCall = -1e9;
        this.deck = null;
    }

    add(ship, role, ox, oz) {
        const m = { ship, role, ox, oz, st: {} };
        this.members.push(m);
        if (!this.guide || role === 'hvu') this.guide = ship;
        ship.group = this;
        return m;
    }
    get alive() { return this.members.some(m => m.ship.alive); }
    get hvu() { return this.guide; }
    ships() { return this.members.map(m => m.ship); }

    // the guide: a base course (patrol leg, a destination, into the wind for flight ops), clear of land; the zig-zag
    // on top when threatened; the ordered speed
    steerGuide(dt) {
        const g = this.guide, G0 = this.ops.game;
        if (!g || !g.nav) return;
        this.navT -= dt;
        // a leader lost: the next ship takes the guide
        if (!g.alive) { const n = this.members.find(m => m.ship.alive && m.role !== 'sub'); if (n) { this.guide = n.ship; } return; }
        const p = g.mesh.position;
        let want = this.course;
        // (a jet on approach to the carrier: hold the course; game.js sets `straight`)
        if (g.straight > 0) { g.straight -= dt; g.steer(g.heading, g.nav.wantSpeed); return; }
        if (this.navT <= 0) {
            this.navT = 2;
            const wind = G0.wind;
            if (this.flightOps > 0 && wind && Math.hypot(wind.x, wind.z) > 1) want = Math.atan2(wind.x, wind.z);
            else if (this.dest) {
                const dx = this.dest.x - p.x, dz = this.dest.z - p.z, d = Math.hypot(dx, dz);
                want = Math.atan2(-dx, -dz);
                if (d < 1500) { this.dest = null; this.area = { x: p.x, z: p.z, r: 6000 }; }
                this.destT = (this.destT || 0) + 2;
                if (this.destT > 900) { this.dest = null; this.area = { x: p.x, z: p.z, r: 6000 }; } // (stuck behind an island: settle here)
            } else {
                // patrol legs round the area, turning back toward its centre from its edge
                this.legT -= 2;
                const A = this.area || (this.area = { x: p.x, z: p.z, r: 6000 });
                const off = Math.hypot(p.x - A.x, p.z - A.z);
                if (!this.leg || this.legT <= 0 || off > A.r) {
                    const a = Math.random() * Math.PI * 2, r = rand(0.2, 0.7) * A.r;
                    this.leg = { x: A.x + Math.cos(a) * r, z: A.z + Math.sin(a) * r };
                    this.legT = rand(150, 300);
                }
                want = Math.atan2(-(this.leg.x - p.x), -(this.leg.z - p.z));
            }
            this.course = openCourse(p.x, p.z, want, 4500);
        }
        // the zig-zag: legs of ±25° about the base course while under threat (not during flight ops)
        let h = this.course;
        const z = this.zig;
        if (z.on && this.threat > 0 && this.flightOps <= 0) {
            z.t -= dt;
            if (z.t <= 0) { z.t = rand(45, 80); z.off = z.off > 0 ? -0.44 : 0.44; }
            h = this.course + z.off;
            if (clearRun(p.x, p.z, h, 2500) !== Infinity) h = this.course;
        } else z.off = 0;
        const sp = this.order === 'stop' ? 0 : this.threat > 0.5 ? SPEEDS.flank : this.flightOps > 0 ? SPEEDS.ops : this.order === 'flank' ? SPEEDS.flank : SPEEDS.cruise;
        this.speed = Math.min(sp, this.maxSpeed() * 0.88);
        g.steer(h, this.speed);
        // the formation axis follows the base course only as fast as the screen can move round
        const rate = Math.max(0.002, (this.maxSpeed() - this.speed) / 3000);
        this.axis = wrapPi(this.axis + clamp(wrapPi(this.course - this.axis), -rate * dt, rate * dt));
    }
    maxSpeed() { let m = Infinity; for (const x of this.members) if (x.ship.alive && x.role !== 'sub') m = Math.min(m, (HELM[x.ship.type] || HELM.destroyer).maxSpeed); return m === Infinity ? 12 : m; }

    // escorts to their stations (pulled in toward the guide where the station is over shallow water), clear of the
    // other ships and of land
    keepStations(dt) {
        const g = this.guide;
        if (!g) return;
        const gp = g.mesh.position, gv = g.vel;
        const P = {};
        for (const m of this.members) {
            const s = m.ship;
            if (s === g || !s.alive || !s.nav) continue;
            let k = 1;
            for (; k > 0.2; k -= 0.2) { stationPos(gp.x, gp.z, this.axis, m.ox * k, m.oz * k, P); if (terrainHeight(P.x, P.z) < -30) break; }
            m.k = k;
            const hs = HELM[s.type] || HELM.destroyer;
            stationSteer(s.mesh.position.x, s.mesh.position.z, P.x, P.z, gv.x, gv.z, hs.maxSpeed * (m.role === 'sub' ? 1 : 0.97), m.st, this.axis);
            let h = m.st.heading, sp = m.st.speed;
            // don't run into another ship: turn away from anything within 450 m that we're closing on
            for (const o of this.ops.shipsNear(s, 600)) {
                const dx = o.mesh.position.x - s.mesh.position.x, dz = o.mesh.position.z - s.mesh.position.z, d = Math.hypot(dx, dz);
                if (d < 450 && (-Math.sin(h) * dx - Math.cos(h) * dz) > 0) { h += (dx * Math.cos(h) - dz * Math.sin(h) > 0 ? -1 : 1) * 0.5 * (1 - d / 450); sp *= 0.8; }
            }
            // nor aground: check the next 1.5 km now and then
            m.navT = (m.navT || rand(0, 1)) - dt;
            if (m.navT <= 0) { m.navT = 1; m.safe = clearRun(s.mesh.position.x, s.mesh.position.z, h, 1500) === Infinity ? null : openCourse(s.mesh.position.x, s.mesh.position.z, h, 1500); }
            if (m.safe != null) h = m.safe;
            if (m.err > 6000) sp = hs.maxSpeed; // (a long way off: full speed)
            s.steer(h, sp);
            m.err = m.st.err;
        }
    }
}

// ═════════════ An interceptor in flight ═════════════
const samGeo = new Map(), samMat = new Map();
function samMesh(key) {
    const S = SAMS[key];
    if (!samGeo.has(key)) {
        const R = S.dia / 2, L = S.len, nose = R * 3.5;
        const body = new THREE.CylinderGeometry(R, R, L - nose, 10).rotateX(-Math.PI / 2).translate(0, 0, nose / 2);
        const cone = new THREE.ConeGeometry(R, nose, 10).rotateX(-Math.PI / 2).translate(0, 0, -L / 2 + nose / 2);
        const parts = [body, cone];
        for (let k = 0; k < 4; k++) {
            const f = new THREE.BoxGeometry(0.02 + R * 0.08, R * 1.8, R * 2.6).translate(0, R + R * 0.9, L / 2 - R * 1.6);
            f.rotateZ(k * Math.PI / 2 + Math.PI / 4);
            parts.push(f);
            const w = new THREE.BoxGeometry(0.02 + R * 0.06, R * 1.1, L * 0.18).translate(0, R + R * 0.55, -L * 0.05);
            w.rotateZ(k * Math.PI / 2 + Math.PI / 4);
            parts.push(w);
        }
        samGeo.set(key, { body: mergeParts(parts), booster: S.booster ? new THREE.CylinderGeometry(R * 1.02, R * 1.02, S.booster, 10).rotateX(-Math.PI / 2).translate(0, 0, L / 2 + S.booster / 2) : null });
    }
    if (!samMat.has(S.color)) samMat.set(S.color, new THREE.MeshStandardMaterial({ color: S.color, roughness: 0.5, metalness: 0.25 }));
    const G0 = samGeo.get(key);
    const g = new THREE.Group();
    const m = new THREE.Mesh(G0.body, samMat.get(S.color)); m.castShadow = true;
    g.add(m);
    if (G0.booster) { const b = new THREE.Mesh(G0.booster, samMat.get(0x2a2c2e) || (samMat.set(0x2a2c2e, new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.7 })), samMat.get(0x2a2c2e))); b.name = 'booster'; g.add(b); }
    return g;
}
function mergeParts(parts) {
    let n = 0; for (const p of parts) n += (p.index ? p.index.count : p.attributes.position.count);
    const pos = [], nor = [];
    for (const p of parts) {
        const g = p.index ? p.toNonIndexed() : p;
        pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    void n;
    return out;
}

const _r = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _z = new THREE.Vector3();
class Interceptor {
    constructor(ops, key, ship, target, phase) {
        const S = SAMS[key];
        this.ops = ops; this.game = ops.game;
        this.key = key; this.sam = S; this.team = ship.team; this.owner = ship; this.shooter = ship;
        this.target = target;
        this.mesh = samMesh(key);
        this.pos = this.mesh.position; this.vel = new THREE.Vector3();
        this.phase = phase;
        this.state = phase ? 'launch' : 'fly';
        this.alive = true; this.age = 0; this.flyT = 0;
        this.motorT = S.boost;
        this.life = S.range / S.speed * 1.7 + 8;
        this.kind = 'sam'; this.W = { radar: !S.ir, damage: S.warhead }; // (ai.js: flares only fool heat seekers)
        this.name = S.name;
        this.salvos = new Set();
        this.booster = this.mesh.getObjectByName('booster');
        this.trail = null;
        this.game.scene.add(this.mesh);
        if (target && target.incoming) target.incoming.push(this);
    }

    // the motor lights: smoke trail, and a SAM launch warning if it's after an aircraft (game.js 'missileLaunch')
    lit() {
        if (this.trail) return;
        const fx = this.game.effects;
        this.trail = fx.addTrail({ max: 260, width: 0.9 + this.sam.dia, life: 6, color: [0.94, 0.94, 0.92], alpha: 0.55, minDist: 8, widthGrow: 2.6 });
        const t = this.target;
        if (t && !t.isStrategic && t.spec) this.game.events.emit('missileLaunch', this.shooter, { missile: this, target: t });
    }

    update(dt) {
        if (!this.alive) return;
        const g = this.game, fx = g.effects, S = this.sam;
        this.age += dt;
        if (this.state === 'launch') {
            if (this.phase.step(this, dt)) { this.orient(); if (this.phase.lit && !this.phase.cleared) this.exhaust(dt, 0.6); return; }
            this.state = 'fly';
            this.lit();
        }
        this.flyT += dt;
        const T = this.target;
        // (a missile of weapons.js has no alive flag: it's live while it's in the list)
        const tAlive = T && T.alive !== false && !T.exploded && !T.removed && (T.isStrategic || T.spec || this.game.weapons.missiles.includes(T));
        let speed = this.vel.length();
        // motor
        if (this.motorT > 0) { this.motorT -= dt; speed = Math.min(S.speed * 1.05, speed + S.accel * dt); if (this.motorT <= 0 && this.booster) this.dropBooster(); }
        else speed = Math.max(S.speed * 0.45, speed - speed * 0.035 * dt);
        const dir = _d.copy(this.vel).divideScalar(Math.max(speed, 1e-3));
        if (this.vel.lengthSq() < 1e-6) dir.set(0, 1, 0);
        // guidance: lead pursuit onto the predicted intercept point at up to the g available (little at first: out
        // of a vertical cell it rises, then tips over)
        if (tAlive) {
            const tv = T.vel || _z.set(0, 0, 0);
            const r = _r.subVectors(T.pos, this.pos);
            const ti = interceptTime(r.x, r.y, r.z, tv.x, tv.y, tv.z, Math.max(speed, S.speed * 0.7));
            _w.copy(T.pos);
            if (ti > 0) _w.addScaledVector(tv, Math.min(ti, 30));
            _w.sub(this.pos).normalize();
            const ramp = S.tip > 0 ? clamp((this.flyT - S.tip * 0.4) / S.tip, 0.08, 1) : 1;
            const maxTurn = S.turnG * G / Math.max(speed, 60) * ramp * dt;
            const ang = Math.acos(clamp(dir.dot(_w), -1, 1));
            if (ang > 1e-4) {
                const k = Math.min(1, maxTurn / ang);
                dir.lerp(_w, k).normalize();
            }
            // a flare salvo from the target: the chaff in it spoofs a radar seeker now and then, the flares an IR one
            if (T.spec && this.flyT > 1) this.checkDecoys(T);
        } else if (this.flyT > 1) this.lifeLeft = Math.min(this.lifeLeft ?? 3, 3);
        this.vel.copy(dir).multiplyScalar(speed);
        const prevX = this.pos.x, prevY = this.pos.y, prevZ = this.pos.z;
        this.pos.addScaledVector(this.vel, dt);
        this.orient();
        // exhaust
        if (this.motorT > 0) this.exhaust(dt, 1);
        else if (this.trail && this.trail.emitting) this.trail.emitting = false;
        // proximity fuse: the closest approach to the target during this step
        if (tAlive && this.flyT > 0.3) {
            const tv = T.vel || _z.set(0, 0, 0);
            const rpx = prevX - (T.pos.x - tv.x * dt), rpy = prevY - (T.pos.y - tv.y * dt), rpz = prevZ - (T.pos.z - tv.z * dt);
            const rvx = this.vel.x - tv.x, rvy = this.vel.y - tv.y, rvz = this.vel.z - tv.z;
            const vv = rvx * rvx + rvy * rvy + rvz * rvz;
            const tc = vv > 0 ? clamp(-(rpx * rvx + rpy * rvy + rpz * rvz) / vv, 0, dt) : 0;
            const dmin = Math.hypot(rpx + rvx * tc, rpy + rvy * tc, rpz + rvz * tc);
            if (dmin < S.prox + (T.hitRadius || 3) * 0.3) { this.detonate(T, dmin); return; }
        }
        if (this.lifeLeft != null) { this.lifeLeft -= dt; if (this.lifeLeft <= 0) { this.selfDestruct(); return; } }
        if (this.age > this.life || this.pos.y < Math.max(terrainHeight(this.pos.x, this.pos.z), 0)) this.selfDestruct();
    }

    orient() { if (this.vel.lengthSq() > 1) this.mesh.quaternion.setFromUnitVectors(FWD, _w.copy(this.vel).normalize()); }

    exhaust(dt, k) {
        const fx = this.game.effects, S = this.sam;
        if (this.trail) this.trail.push(this.pos, fx.now);
        const back = _v.copy(this.vel).normalize().multiplyScalar(-S.len * 0.55).add(this.pos);
        fx.fire.emit(back, _v2.copy(this.vel).multiplyScalar(0.5), 0.06, 1.6 * k, 0.6, [6, 4.5, 2.2], [3, 1, 0.2], 1, 0, 0, 0);
        if (Math.random() < 0.6 * k) fx.smoke.emit(back, _v2.copy(this.vel).multiplyScalar(0.04), rand(1.8, 3.5), 1.6, 7, [0.9, 0.9, 0.88], [0.72, 0.72, 0.7], 0.42, 0, 1.2, 1);
        // at night the motor lights the ship and the sea for the first seconds of its climb
        const w = this.game.world;
        if (w && w.timeKey !== 'day' && this.flyT < 2.5 && Math.random() < 0.3) fx.light(back, 28, 0.12);
    }

    checkDecoys(T) {
        const W = this.game.weapons;
        if (!W || !W.flares.length) return;
        for (const f of W.flares) {
            if (f.owner !== T || this.salvos.has(f.salvo) || f.pos.distanceToSquared(this.pos) > 4000 * 4000) continue;
            this.salvos.add(f.salvo);
            const chance = this.sam.ir ? (T.isPlayer ? 0.4 : 0.25) : (T.isPlayer ? 0.28 : 0.16);
            if (Math.random() < chance) { this.release(); this.target = null; this.lifeLeft = 2.5; this.ops.onDecoyed(this, T); }
            return;
        }
    }

    release() {
        const t = this.target;
        if (t && t.incoming) { const i = t.incoming.indexOf(this); if (i >= 0) t.incoming.splice(i, 1); }
    }

    detonate(T, d) {
        const g = this.game, S = this.sam;
        g.effects.explosion(this.pos, 0.55 + S.dia * 0.6, this.vel);
        let killed = false;
        if (T.isStrategic || !T.spec) {
            // a missile: the burst kills it or doesn't
            if (Math.random() < S.pk * this.ops.pkScale(this.team)) {
                killed = true;
                if (T.isStrategic) T.damage(1e3, this.shooter);
                else { const i = g.weapons.missiles.indexOf(T); if (i >= 0) { g.effects.explosion(T.pos, 0.5); g.weapons.removeMissile(i); } }
            }
        } else {
            // an aircraft takes the blast by how close it was
            const dmg = S.warhead * clamp(1.3 - d / (S.prox * 1.5), 0.3, 1.2);
            T.damage(dmg, this.shooter, 'missile');
            killed = !T.alive;
        }
        this.ops.onIntercept(this, T, killed);
        this.remove();
    }

    selfDestruct() {
        if (this.flyT > 0.5) this.game.effects.explosion(this.pos, 0.3);
        this.ops.onIntercept(this, this.target, false, true);
        this.remove();
    }

    dropBooster() {
        const b = this.booster;
        this.booster = null;
        const st = this.game.strikes;
        b.updateMatrixWorld();
        const w = new THREE.Mesh(b.geometry, b.material);
        b.getWorldPosition(w.position); b.getWorldQuaternion(w.quaternion);
        this.mesh.remove(b);
        if (st && st.debris) { st.debris.push({ mesh: w, vel: this.vel.clone().multiplyScalar(0.55), spin: rand(-3, 3), life: 18 }); this.game.scene.add(w); }
    }

    remove() {
        if (!this.alive) return;
        this.alive = false;
        this.release();
        this.game.scene.remove(this.mesh);
        if (this.trail) this.trail.emitting = false;
    }
}

// the submarine launch capsule (Tomahawk / Kalibr in their sleeve)
let _capGeo = null, _capMat = null;
function capsuleGeo() { return _capGeo || (_capGeo = new THREE.CylinderGeometry(1, 1, 1, 12).rotateX(Math.PI / 2)); }
function capsuleMat() { return _capMat || (_capMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6, metalness: 0.3 })); }

// ═════════════ The system ═════════════
export class NavalOps {
    constructor(game) {
        this.game = game;
        this.groups = []; this.interceptors = []; this.decks = [];
        this.nextGroup = 1; this.nextTrack = 4001;
        this.enabled = false;
        this.names = { blue: {}, red: {} };
        this.radioQ = []; this.lastRadio = -1e9;
        this.trackIds = new WeakMap();
        this.taskGen = false;
        this.stats = { launched: 0, kills: 0, leakers: 0 };
    }

    // ═════════════ Lifecycle ═════════════
    start(mode) {
        this.clear();
        const g = this.game;
        this.mode = mode;
        this.enabled = !!g.naval && !['rings', 'practice'].includes(mode);
        if (!this.enabled) return;
        this.token = {};
        loadDeckCrew();
        this.registerTasks();
        const full = mode === 'naval' || mode === 'war' || mode === 'sandbox';
        const cv = g.naval.homeCarrier;
        if (cv && cv.name === 'CVN-73' && !cv.fullName) cv.fullName = 'USS GEORGE WASHINGTON (CVN-73)';
        const token = this.token;
        const build = () => {
            if (this.token !== token) return;
            if (cv && !cv.gone) {
                const grp = this.formGroup('blue', cv, full ? CSG : CSG.slice(0, 1));
                // Mason (strikes.js) joins the screen
                for (const s of g.naval.ships) if (s.escortOf === cv && s.alive && !s.group) this.join(grp, s, 'screen');
                if (full) this.fill(grp, CSG);
                this.settle(grp);
                const deck = this.addDeck(cv, { launches: full || mode === 'freeflight' });
                if (full) { deck.requestLaunch({ type: 'fa18', skill: this.skill() }); deck.requestLaunch({ type: 'fa18', skill: this.skill() }); }
                else if (mode === 'freeflight') { this.ambientT = 40; }
                if (full && hasShipModel('ssgn')) {
                    // a guided-missile submarine on its own patrol box, 12–18 km from the group
                    const spot = findOcean(cv.pos.x, cv.pos.z, 11000, 19000, 3000);
                    if (spot) {
                        const sg = this.spawnGroup('blue', spot, { composition: [['ssgn', 'sub', 0, 0]], name: 'SSGN PATROL' });
                        if (sg && sg.guide) sg.guide.subDepth = 40;
                    }
                }
            }
            const ecv = g.naval.enemyCarrier;
            if (ecv && !ecv.gone && full) {
                const grp = this.formGroup('red', ecv, [['carrier', 'hvu', 0, 0], ...SAG]);
                for (const s of g.naval.ships) if (s.team === 'red' && s !== ecv && !s.group && s.type === 'destroyer' && s.alive) this.join(grp, s, 'screen');
                this.fill(grp, SAG);
                this.settle(grp);
                this.addDeck(ecv, { launches: true });
            } else if (ecv && !ecv.gone) this.addDeck(ecv, { launches: false });
        };
        // (the cruiser, the Slava, the supply ship and the submarines load after the boot: wait for them)
        const late = full && ['cruiser', 'slava', 'supply', 'ssn', 'ssgn'].some(t => !hasShipModel(t));
        if (late) shipsLoaded().then(() => { if (this.token === token && this.enabled) build(); });
        else build();
    }

    clear() {
        for (const m of this.interceptors) m.remove();
        this.interceptors.length = 0;
        for (const d of this.decks) d.dispose();
        this.decks.length = 0;
        for (const gr of this.groups) for (const m of gr.members) { m.ship.group = null; }
        this.groups.length = 0;
        this.radioQ.length = 0;
        this.names = { blue: {}, red: {} };
        this.enabled = false;
        this.token = null;
        this.hud = null;
    }

    skill() { return clamp((this.game.difficulty || { skill: 0.6 }).skill + rand(-0.05, 0.1), 0.3, 0.95); }
    // how well a side's SAMs kill missiles: red a bit worse for rookies, blue a bit better
    pkScale(team) { const sk = (this.game.difficulty || { skill: 0.6 }).skill; return team === this.game.war.side ? 1.05 - sk * 0.1 : 0.8 + sk * 0.25; }

    // ═════════════ Groups ═════════════
    // A new group of `side` around a point (the nearest open water to it). opts: composition ([[type, role, x, z]]
    // like CSG / SAG; default CSG for blue, SAG for red), name, course (rad), speed ('cruise' | 'ops' | 'flank'),
    // deck (carrier ops on its carrier; default true). Returns the group, or null without open water nearby.
    spawnGroup(side, center, opts = {}) {
        const g = this.game;
        if (!g.naval) return null;
        const comp = opts.composition || (side === 'blue' ? CSG : SAG);
        const spot = openWater(center.x, center.z, 3000) ? center : findOcean(center.x, center.z, 0, 9000, 3000) || findOcean(center.x, center.z, 0, 20000, 2000);
        if (!spot) return null;
        const course = opts.course ?? (g.wind && Math.hypot(g.wind.x, g.wind.z) > 1 ? Math.atan2(g.wind.x, g.wind.z) : rand(0, Math.PI * 2));
        const grp = new Group(this, side, { name: opts.name, area: { x: spot.x, z: spot.z, r: opts.areaR || 6000 } });
        grp.course = grp.axis = openCourse(spot.x, spot.z, course, 4000);
        if (opts.speed) grp.order = opts.speed;
        const P = {};
        for (const [type, role, ox, oz] of comp) {
            stationPos(spot.x, spot.z, grp.axis, ox, oz, P);
            const at = terrainHeight(P.x, P.z) < -25 ? P : { x: spot.x + rand(-300, 300), z: spot.z + rand(-300, 300) };
            const s = g.naval.spawn(type, side, at, { name: this.pickName(side, type) });
            if (!s) continue;
            this.enlist(grp, s, role, ox, oz, { x: at.x, z: at.z });
        }
        if (!grp.members.length) return null;
        this.groups.push(grp);
        const cv = grp.members.find(m => m.ship.type === 'carrier');
        if (cv && opts.deck !== false) this.addDeck(cv.ship, { launches: true });
        g.events.emit('navalGroup', grp);
        return grp;
    }

    // an existing carrier (the home carrier, the enemy one) becomes the guide of a new group
    formGroup(side, guide, comp) {
        let grp = this.groupOf(guide);
        if (grp) return grp;
        grp = new Group(this, side);
        const p = guide.mesh.position;
        grp.area = { x: guide.orbit.cx, z: guide.orbit.cz, r: Math.max(5000, guide.orbit.R * 2) };
        grp.course = grp.axis = guide.heading;
        this.enlist(grp, guide, 'hvu', 0, 0, { x: p.x, z: p.z });
        this.groups.push(grp);
        void comp;
        return grp;
    }

    // the group's missing ships from a composition (ships that joined it take their slots first)
    fill(grp, comp) {
        const g = this.game, P = {};
        const waiting = grp.members.filter(m => !m.slotted);
        for (const [type, role, ox, oz] of comp) {
            if (role === 'hvu' && grp.members.some(m => m.role === 'hvu' && m.ship.type === type)) continue;
            const j = waiting.findIndex(m => m.ship.type === type);
            if (j >= 0) { const m = waiting.splice(j, 1)[0]; m.ox = ox; m.oz = oz; m.role = role; m.slotted = true; continue; }
            const gp = grp.guide.mesh.position;
            stationPos(gp.x, gp.z, grp.axis, ox, oz, P);
            const at = terrainHeight(P.x, P.z) < -25 ? P : { x: gp.x + rand(-400, 400), z: gp.z + rand(-400, 400) };
            const s = g.naval.spawn(type, grp.side, at, { name: this.pickName(grp.side, type) });
            const m = this.enlist(grp, s, role, ox, oz, { x: at.x, z: at.z });
            m.slotted = true;
        }
    }

    // at the start of a sortie: every ship straight onto its station (deep water) on the group's course
    settle(grp) {
        const gp = grp.guide.mesh.position, P = {};
        for (const m of grp.members) {
            const s = m.ship;
            if (s === grp.guide || !s.nav) continue;
            let k = 1;
            for (; k > 0.2; k -= 0.2) { stationPos(gp.x, gp.z, grp.axis, m.ox * k, m.oz * k, P); if (terrainHeight(P.x, P.z) < -30) break; }
            s.nav.x = P.x; s.nav.z = P.z; s.heading = grp.axis; s.nav.speed = grp.guide.nav ? grp.guide.nav.speed : 6;
            s.place(0);
            // (a fresh wake: the old one would draw a line across the sea from where it was)
            const fx = this.game.naval.fx;
            if (fx && fx.entries.has(s)) { fx.remove(s); fx.add(s, s.layout); }
        }
    }

    join(grp, s, role) {
        const p = s.mesh.position;
        // a ship naval.js made with only its class for a name (the enemy's escorts) gets a real one, so the registry
        // doesn't call it "DESTROYER DESTROYER"
        if (!s.fullName && (s.name === RED_HUD[s.type] || s.name === s.def.name)) s.fullName = this.pickName(grp.side, s.type) || undefined;
        const m = this.enlist(grp, s, role, 0, 0, { x: p.x, z: p.z });
        m.slotted = false;
        return m;
    }

    // a ship joins a group: on the helm, in the war registry, its magazine, launch controller and strike source
    enlist(grp, s, role, ox, oz, at) {
        const g = this.game, war = g.war;
        const m = grp.add(s, role, ox, oz);
        m.slotted = role === 'hvu';
        // on the helm at its spot
        const n = s.steer(grp.axis, grp.speed);
        n.x = at.x; n.z = at.z; s.heading = grp.axis; n.speed = grp.speed * 0.8;
        s.place(0);
        s.adManaged = true;
        s.passive = false;
        // names: the HUD's short one for an enemy (its class), the war registry's full one
        const full = s.fullName || s.name;
        if (grp.side !== war.side) { s.fullName = full; s.name = RED_HUD[s.type] || s.name; s.callsign = s.name; }
        const cls = s.type === 'carrier' ? 'carrier' : s.def.cls === 'sub' ? 'sub' : 'ship';
        const warName = grp.side !== war.side ? (s.type === 'carrier' ? full : (CLASS_OF[s.type] || '') + ' ' + full).trim() : full;
        const rec = war.rec(s) || war.add(s, { cls, name: warName, contactName: cls === 'carrier' ? 'LARGE SURFACE CONTACT' : cls === 'sub' ? 'SUBSURFACE CONTACT' : 'SURFACE CONTACT' });
        if (rec) { rec.cls = cls; rec.name = warName; rec.contactName = cls === 'carrier' ? 'LARGE SURFACE CONTACT' : cls === 'sub' ? 'SUBSURFACE CONTACT' : 'SURFACE CONTACT'; s.cls = cls; }
        const sen = SENSORS[s.type];
        if (sen && cls !== 'sub') s.radarRange = sen.r;
        // what it carries and how it launches (launchseq.js)
        const load = (LOADOUTS[s.type] || {})[grp.side];
        if (load && !s.launcher) this.arm(s, load);
        if (cls === 'sub') { s.subDepth = s.subDepth ?? 38; s.depthWant = s.subDepth; setDepth(s, s.depthWant); s.masts = 0; }
        return m;
    }

    arm(s, load) {
        const g = this.game, st = g.strikes;
        const mag = buildMagazine(s, load);
        const lc = new LaunchControl(s, {
            magazine: mag,
            pose: (name, k) => poseRig(s, name, k),
            frame: (tube, p, d, seq) => this.tubeFrame(s, tube, p, d, seq),
            exhaustAt: (tube, out) => this.exhaustAt(s, tube, out),
            fx: this.launchFx(s),
            surface: (x, z) => waterHeight(x, z),
            hostVel: s.vel,
        });
        if (s.def.cls === 'sub') lc.ready = () => s.depth <= (s.layout ? s.layout.periscopeDepth : 12) + 2.5;
        s.launcher = lc;
        // missiles for strikes (strikes.js): land attack and anti-ship, from its own cells
        if (st) {
            const stock = {};
            for (const k of ['tlam', 'harpoon', 'kalibr', 'p1000']) { const n = mag.count(k); if (n) stock[k] = n; }
            let src = st.sources.find(x => x.host === s);
            if (Object.keys(stock).length) {
                if (!src) src = st.addSource(s.def.cls === 'sub' ? new SubLauncher(st, s, { stock }) : new ShipVLS(st, s, { stock }));
                else src.stock = stock;
                s.strikeSource = src;
            } else if (src) st.removeSource(src);
        }
    }

    pickName(side, type) {
        const list = (NAMES[side] || {})[type];
        if (!list) return null;
        const used = this.names[side][type] = (this.names[side][type] || 0) + 1;
        const taken = new Set(this.game.naval.ships.map(s => s.fullName || s.name));
        for (let i = 0; i < list.length; i++) { const n = list[(used - 1 + i) % list.length]; if (!taken.has(n)) return n; }
        return list[(used - 1) % list.length];
    }

    groupOf(ship) { return ship && ship.group && this.groups.includes(ship.group) ? ship.group : null; }
    deckOf(carrier) { return this.decks.find(d => d.ship === carrier) || null; }
    magazineOf(ship) { return ship && ship.launcher ? ship.launcher.mag : null; }
    // how far a ship's longest-range SAM reaches (0: none left), re-read every 10 s
    samReachOf(ship) {
        if (!ship || !ship.alive || !ship.launcher) return 0;
        const t = this.game.time;
        if (ship._samR == null || t > (ship._samRT || 0)) {
            let R = 0;
            for (const k of ship.launcher.mag.keys()) if (SAMS[k] && ship.launcher.count(k) > 0) R = Math.max(R, SAMS[k].range);
            ship._samR = R; ship._samRT = t + 10;
        }
        return ship._samR;
    }

    addDeck(carrier, opts) {
        let d = this.deckOf(carrier);
        if (d) { Object.assign(d.opts, opts); return d; }
        d = new DeckOps(this, carrier, opts);
        this.decks.push(d);
        return d;
    }

    // a fleet move (director.js): steam the group whose ship this is to a point; false if it isn't one of ours
    moveGroupOf(ship, pos) {
        const grp = this.groupOf(ship);
        if (!grp) return false;
        grp.dest = { x: pos.x, z: pos.z }; grp.destT = 0;
        grp.navT = 0;
        return true;
    }
    // order a group's course (rad; null keeps it) and speed ('cruise' | 'ops' | 'flank' | 'stop')
    steerGroup(grp, heading = null, speed = null) {
        if (!grp) return;
        if (heading != null) { grp.dest = null; grp.leg = { x: grp.guide.pos.x - Math.sin(heading) * 20000, z: grp.guide.pos.z - Math.cos(heading) * 20000 }; grp.legT = 600; grp.navT = 0; }
        if (speed) grp.order = speed;
    }

    // An existing enemy (or friendly) aircraft goes out by catapult (game.js's enemy carrier launches); false: no deck
    catapultLaunch(carrier, ac) { const d = this.deckOf(carrier); return !!(d && d.ok && d.adopt(ac)); }
    recover(ac, carrier = null) {
        const d = carrier ? this.deckOf(carrier) : this.decks.find(x => x.ok && x.team === ac.team && x.ship.alive);
        return !!(d && d.recover(ac));
    }

    // Fire n of a missile from a ship or submarine at a target (a unit, a designation or { x, z }): the interiors'
    // launch panels, a war director's order. Anti-ship and land-attack missiles fly through strikes.js (a real
    // strike: BDA, the missile camera); a SAM key (SAMS) engages the target as an interceptor. Returns the strike /
    // the interceptors, or null.
    launchFrom(ship, key, target, n = 1, opts = {}) {
        const g = this.game;
        if (!ship || !ship.alive || !target) return null;
        if (SAMS[key]) {
            const lc = ship.launcher;
            if (!lc || !lc.has(key)) return null;
            const out = [];
            for (let i = 0; i < n; i++) { const seq = this.fireSam(ship, key, target.unit || target); if (seq) out.push(seq); }
            return out.length ? out : null;
        }
        if (!MISSILES[key] || !g.strikes) return null;
        const src = ship.strikeSource || g.strikes.sources.find(s => s.host === ship);
        if (!src) return null;
        const st = g.strikes.fireFrom(src, key, n, target, { quiet: opts.quiet ?? false, type: MISSILES[key].kind === 'antiship' ? 'antiship' : 'naval' });
        if (st && ship.def.cls === 'sub') ship.upT = Math.max(ship.upT || 0, 60);
        return st;
    }

    // ═════════════ Launch sequences: frames and effects ═════════════
    tubeFrame(s, tube, p, d, seq) {
        if (tube.kind === 'cell') return cellFrame(s, tube.ref, p, d);
        if (tube.kind === 'point') return pointFrame(s, tube.ref, p, d);
        // a trainable launcher (RAM, Sea Sparrow, Osa-M): at the mount, pointing at its target, 15–60° up
        const r = s.rig && s.rig.nodes[tube.ref];
        let node = r ? r.node : null;
        if (!node) { const mm = /^mount_(\w+)_(\d+)$/.exec(tube.ref); if (mm) node = (s.mounts.filter(m => m.type === mm[1])[+mm[2]] || {}).turret || null; }
        if (node) { updateWorldChain(node); p.setFromMatrixPosition(node.matrixWorld); p.y += 2; } else p.copy(s.pos);
        const T = seq && seq.target;
        if (T && T.pos) { d.subVectors(T.pos, p); const h = Math.hypot(d.x, d.z) || 1; const el = clamp(Math.atan2(d.y, h) + 0.2, 0.26, 1.05); d.set(d.x / h * Math.cos(el), Math.sin(el), d.z / h * Math.cos(el)); }
        else d.set(0, 1, 0);
        return true;
    }
    exhaustAt(s, tube, out) {
        if (tube.kind === 'cell' && tube.uptake) { const n = s.rig.nodes[tube.uptake]; if (n) { updateWorldChain(n.node); out.setFromMatrixPosition(n.node.matrixWorld); out.y += 0.4; return true; } }
        if (tube.mode === 'container' || tube.mode === 'canister') {
            // (a container or canister vents at its back)
            if (this.tubeFrame(s, tube, out, _v3)) { out.addScaledVector(_v3, -tube.depth); return true; }
        }
        return false;
    }

    // the launch effects on the ship: the flash and the light at ignition, the exhaust out of the uptake (or the
    // container's back) while the motor burns in the cell, a gas puff for a cold launch, spray and foam when a
    // capsule breaks the surface, the booster lighting over the water
    launchFx(s) {
        const g = this.game;
        const self = this;
        return {
            ignite(seq, p, d, inAir) {
                const fx = g.effects; if (!fx) return;
                const night = g.world && g.world.timeKey !== 'day';
                const big = seq.key === 'p1000' ? 1.6 : seq.key === 'tlam' || seq.key === 'kalibr' ? 1.2 : 0.9;
                fx.sprite(fx.flashTex, p, (inAir ? 10 : 14) * big, 0.22, 4, 0.9, [1, 0.85, 0.6]);
                // (a point light only where it shows: at night the launch lights up the ship and the sea round it)
                if (night) fx.light(p, 110 * big, 1.6);
                else fx.light(p, 14 * big, 0.35);
                for (let i = 0; i < 8 * big; i++) fx.fire.emit(p, _v.set(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).multiplyScalar(8 * big), rand(0.15, 0.35), 3 * big, 8 * big, [5, 3.4, 1.4], [2.4, 0.8, 0.1], 0.8, 0, 2, 0);
                if (seq.tube.mode === 'capsule' && inAir) {
                    // the capsule's caps blow off as the booster lights
                    for (let i = 0; i < 6; i++) fx.smoke.emit(p, _v.set(rand(-6, 6), rand(-2, 6), rand(-6, 6)), rand(1.5, 3), 2, 7, [0.92, 0.94, 0.95], [0.8, 0.82, 0.84], 0.6, 0, 1, -4);
                    if (seq.missile && seq.missile.capsule) self.dropCapsule(seq.missile);
                }
                if (g.strikes) g.strikes.audioLaunch(p, { kind: 'cruise' });
            },
            exhaust(seq, p, d, k, dt) {
                const fx = g.effects; if (!fx) return;
                const cold = seq.tube.mode === 'cold';
                seq.acc = (seq.acc || 0) + dt * (cold ? 26 : 70) * k;
                const hv = s.vel;
                while (seq.acc > 1) {
                    seq.acc -= 1;
                    const c = rand(0.8, 0.92);
                    fx.smoke.emit(p, _v.set(hv.x + rand(-4, 4), rand(8, 22) * (cold ? 0.5 : 1), hv.z + rand(-4, 4)), rand(4, 8), rand(2, 3.5), rand(9, 16), [c, c, c * 0.98], [c * 0.82, c * 0.82, c * 0.8], 0.6, 0, 1.3, 1.2, 0, 0.5, 0.5);
                    if (!cold && Math.random() < 0.7) fx.fire.emit(p, _v.set(rand(-3, 3), rand(10, 30), rand(-3, 3)), rand(0.12, 0.3), 2.2, 5, [6, 4, 1.8], [2.4, 0.8, 0.1], 0.9, 0, 1.5, 0);
                }
            },
            clear(seq) {
                // a cold launch: the gas throw out of the hatch
                if (seq.tube.mode === 'cold' && g.effects) { const fx = g.effects; s.launcher.frameOf(seq.tube, _v2, _v3, seq); for (let i = 0; i < 10; i++) fx.smoke.emit(_v2, _v.set(rand(-5, 5), rand(4, 14), rand(-5, 5)), rand(2, 4), 2.5, 9, [0.95, 0.95, 0.94], [0.85, 0.85, 0.84], 0.55, 0, 1.2, 0.5); }
            },
            // a submarine's missile rides up in its capsule: a dark sleeve that comes off when the booster lights
            spawned(seq) {
                const m = seq.missile;
                if (seq.tube.mode !== 'capsule' || !m || !m.mesh || m.capsule) return;
                const L = (m.spec && m.spec.len) || 6.2, R = ((m.spec && m.spec.dia) || 0.53) * 0.62;
                const cap = new THREE.Mesh(capsuleGeo(), capsuleMat());
                cap.scale.set(R, R, L * 1.04);
                m.mesh.add(cap);
                m.capsule = cap;
            },
            broach(seq, p) {
                const fx = g.effects; if (!fx) return;
                fx.waterSplash(p, 1.1);
                // a ring of foam spreading on the surface
                for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; fx.smoke.emit(_v2.set(p.x + Math.cos(a) * 2, p.y + 0.3, p.z + Math.sin(a) * 2), _v.set(Math.cos(a) * rand(4, 9), rand(0.2, 1.2), Math.sin(a) * rand(4, 9)), rand(4, 7), 2, 9, [0.9, 0.94, 0.96], [0.84, 0.88, 0.9], 0.55, 0, 0.9, 0); }
                if (g.audio && g.audio.boom) g.audio.boom(g.camera.position.distanceTo(p) * 1.5, 0.3);
            },
        };
    }

    dropCapsule(m) {
        const cap = m.capsule;
        m.capsule = null;
        cap.updateMatrixWorld();
        const w = new THREE.Mesh(cap.geometry, cap.material);
        cap.getWorldPosition(w.position); cap.getWorldQuaternion(w.quaternion);
        cap.removeFromParent();
        const st = this.game.strikes;
        if (st) { st.debris.push({ mesh: w, vel: new THREE.Vector3(rand(-3, 3), rand(2, 6), rand(-3, 3)), spin: rand(-4, 4), life: 8 }); this.game.scene.add(w); }
    }

    // ═════════════ Air defence ═════════════
    fireSam(ship, key, target) {
        const lc = ship.launcher;
        if (!lc) return null;
        return lc.fire(key, (phase, p, d, seq) => {
            const m = new Interceptor(this, key, ship, target, phase);
            m.pos.copy(p); m.vel.copy(d).multiplyScalar(1);
            m.trackId = seq.data;
            this.interceptors.push(m);
            this.stats.launched++;
            ship.firingT = this.game.war.time;
            return m;
        }, { target, data: this.trackId(target) });
    }

    trackId(u) { let id = this.trackIds.get(u); if (!id) { id = this.nextTrack++; this.trackIds.set(u, id); } return id; }

    // what a group's radars see: enemy aircraft, strategic missiles and missiles fired at its ships, within radar
    // range and over the horizon, clear of terrain (the whole group shares the picture)
    trackPicture(grp) {
        const g = this.game, side = grp.side, out = grp.tracks;
        out.length = 0;
        const radars = grp.members.filter(m => m.ship.alive && m.ship.def.cls !== 'sub' && SENSORS[m.ship.type]);
        if (!radars.length) return out;
        const seen = (pos) => {
            const agl = Math.max(pos.y - Math.max(terrainHeight(pos.x, pos.z), 0), 1);
            for (const m of radars) {
                const s = m.ship, S = SENSORS[s.type], sp = s.mesh.position;
                const d = Math.hypot(pos.x - sp.x, pos.z - sp.z);
                if (d > S.r || d > radarHorizon(S.h, agl)) continue;
                if (d > 4000 && !g.war.lineOfSight(_v.set(sp.x, S.h, sp.z), pos)) continue;
                return true;
            }
            return false;
        };
        for (const a of g.aircraft) {
            if (!a.alive || a.team === side || a.onGround || a.team === 'neutral') continue;
            if (!seen(a.pos)) continue;
            out.push({ u: a, id: this.trackId(a), kind: 'aircraft', pos: a.pos, vel: a.vel, target: null });
        }
        const st = g.strikes;
        if (st) for (const m of st.missiles) {
            if (!m.alive || m.team === side || m.phase === 'launch' || m.kind === 'rocket') continue;
            if (!seen(m.pos)) continue;
            if (side === g.war.side) m.detected = true; // (strikes.js draws detected enemy missiles on the map)
            const aimShip = m.aim && m.aim.unit && m.aim.unit.isShip && m.aim.unit.team === side ? m.aim.unit : null;
            out.push({ u: m, id: this.trackId(m), kind: 'missile', pos: m.pos, vel: m.vel, target: aimShip, vampire: !!aimShip || m.kind === 'antiship' });
        }
        for (const m of g.weapons.missiles) {
            if (m.team === side || m.kind === 'rkt' || !m.target || !m.target.isShip || m.target.team !== side) continue;
            out.push({ u: m, id: this.trackId(m), kind: 'missile', pos: m.pos, vel: m.vel, target: m.target });
        }
        return out;
    }

    // twice a second per group: the picture, then threat evaluation and weapon assignment
    airDefense(grp) {
        const g = this.game;
        const tracks = this.trackPicture(grp);
        // interceptors already on each track (and the ones whose hatches are still opening)
        const inFlight = new Map();
        for (const m of this.interceptors) if (m.alive && m.target && m.team === grp.side) inFlight.set(m.target, (inFlight.get(m.target) || 0) + 1);
        for (const mm of grp.members) if (mm.ship.launcher) for (const q of mm.ship.launcher.seqs) if (!q.missile && q.target && SAMS[q.key]) inFlight.set(q.target, (inFlight.get(q.target) || 0) + 1);
        const hv = grp.guide ? grp.guide.pos : null;
        const threats = [];
        for (const t of tracks) {
            const defend = t.target ? t.target.pos : t.kind === 'aircraft' ? this.nearestMember(grp, t.pos) : hv;
            // aircraft: only the ones coming our way or already close, and inside the inner zone (further out is the
            // fighters' job — and the player's: a surface group doesn't clear the whole sky); missiles: anything seen
            if (t.kind === 'aircraft') {
                const d = defend ? t.pos.distanceTo(defend) : Infinity;
                const closing = defend ? -_v.subVectors(t.pos, defend).dot(t.vel) / Math.max(d, 1) : 0;
                if ((d > 9000 && closing < 30) || d > 21000) continue;
                if (t.u.team === 'neutral') continue;
            }
            threats.push({ ...t, defend, inFlight: inFlight.get(t.u) || 0 });
        }
        grp.threat = clamp(threats.filter(t => t.kind === 'missile').length * 0.5 + threats.filter(t => t.kind === 'aircraft').length * 0.25, 0, 1);
        if (grp.threat > 0) grp.threatT = g.war.time;
        this.callVampires(grp, threats);
        if (!threats.length) return;
        const shooters = [];
        for (const m of grp.members) {
            const s = m.ship, lc = s.launcher;
            if (!s.alive || !lc) continue;
            const ch = (SENSORS[s.type] || { ch: 0 }).ch - this.interceptors.filter(x => x.alive && x.shooter === s).length;
            if (ch <= 0) continue;
            const weapons = [];
            for (const key of lc.mag.keys()) if (SAMS[key]) weapons.push({ key, count: lc.count(key), ready: true });
            if (weapons.length) shooters.push({ ship: s, pos: s.mesh.position, channels: ch, weapons });
        }
        // red is slower to react, and doesn't always take the long shot at an aircraft
        const plan = planEngagements(threats, shooters);
        for (const a of plan) {
            const T = a.threat.u;
            if (a.threat.kind === 'aircraft' && grp.side !== g.war.side && T.isPlayer) {
                // the player gets a fair chance: one SAM at a time at him, not too often
                if (g.war.time - (grp.lastAtPlayer || -1e9) < lerp(16, 8, (g.difficulty || { skill: 0.6 }).skill)) continue;
                grp.lastAtPlayer = g.war.time;
            }
            let fired = 0;
            for (let i = 0; i < a.n; i++) if (this.fireSam(a.shooter.ship, a.key, T)) fired++;
            if (fired) this.birdsAway(grp, a.shooter.ship, a.key, fired, a.threat);
        }
    }

    nearestMember(grp, pos) {
        let best = null, bd = Infinity;
        for (const m of grp.members) { if (!m.ship.alive) continue; const d = m.ship.pos.distanceToSquared(pos); if (d < bd) { bd = d; best = m.ship.pos; } }
        return best;
    }

    // ═════════════ Surface action ═════════════
    // every few minutes a group with ship-killers takes a shot at the nearest enemy surface ships it knows about
    surfaceAction(grp) {
        const g = this.game, war = g.war;
        if (!grp.alive) return;
        // (only where there's a war at sea: in Free Flight the destroyers sank the unarmed target ships themselves)
        if (!['naval', 'war', 'sandbox'].includes(this.mode)) return;
        const ours = grp.side === war.side;
        // who it can see: our side through the war's intel; the enemy's reconnaissance knows roughly where we are
        const enemies = [];
        for (const s of g.naval.ships) {
            if (!s.alive || s.team === grp.side || s.team === 'neutral' || s.def.cls === 'sub' || s.def.cls === 'boat') continue;
            if (ours && war.known(s) < INTEL.CONTACT) continue;
            // (the player's own objective — the enemy carrier in Naval Strike — is left to him)
            if (ours && this.mode === 'naval' && s === g.naval.enemyCarrier) continue;
            const d = s.pos.distanceTo(grp.guide.pos);
            if (d < 48000) enemies.push({ s, d });
        }
        if (!enemies.length) return;
        enemies.sort((a, b) => a.d - b.d);
        // the target: their high-value unit if it's in reach, else the nearest
        const hvu = enemies.find(e => e.s.type === 'carrier' || e.s.type === 'slava');
        const tgt = (hvu && Math.random() < 0.65 ? hvu : enemies[0]).s;
        let salvo = 0;
        for (const m of grp.members) {
            const s = m.ship, key = (SURFACE[grp.side] || {})[s.type];
            if (!s.alive || !key || !s.strikeSource || !s.strikeSource.canFire(key)) continue;
            if (s.def.cls === 'sub' && Math.random() < 0.6) continue; // (a submarine only now and then: it gives itself away)
            const n = key === 'p1000' ? 4 : key === 'harpoon' ? 4 : 2;
            const st = this.launchFrom(s, key, tgt, n, { quiet: true });
            if (st) { salvo += st.planned; if (ours) this.say(this.short(s), (key === 'harpoon' ? 'BRUISER, BRUISER — ' : 'SHOT — ') + st.planned + '× ' + MISSILES[key].short + ' ON ' + war.label(tgt), { color: '#9fd4ff', say: key === 'harpoon' ? 'Bruiser, bruiser.' : false }); }
            if (salvo >= 8) break;
        }
        if (salvo && !ours) grp.lastSalvo = g.war.time;
    }

    // ═════════════ Submarines ═════════════
    // deep (invisible) on station; up to periscope depth to launch or to talk (masts up), then down again
    updateSub(s, dt) {
        const L = s.layout || {};
        const pd = L.periscopeDepth || 12;
        const src = s.strikeSource;
        const busy = (src && src.queue.length) || (s.launcher && s.launcher.seqs.length);
        s.upT = Math.max(0, (s.upT || 0) - dt);
        if (busy) s.upT = Math.max(s.upT, 25);
        // (now and then to periscope depth for the broadcast)
        s.commsT = (s.commsT ?? rand(120, 300)) - dt;
        if (s.commsT <= 0) { s.commsT = rand(240, 420); s.upT = Math.max(s.upT, rand(40, 70)); }
        const want = s.upT > 0 ? pd : (s.subDepth ?? 38);
        if (Math.abs(s.depth - want) > 0.01) setDepth(s, s.depth + clamp(want - s.depth, -1.3 * dt, 1.3 * dt));
        // masts: up at periscope depth
        const up = s.depth <= pd + 1 ? 1 : 0;
        const k = s.masts = clamp(s.masts + (up ? dt / 3 : -dt / 2), 0, 1);
        if (k !== s.mastPose) {
            s.mastPose = k;
            for (const name of Object.keys(s.rig.masts)) if (name !== 'snorkel' && name !== 'radar') raiseMast(s, name, k * (name === 'periscope_2' ? 0.7 : 1));
        }
        // a submerged boat is hard to find, and nothing on the surface can hit it: off the targets list (the HUD,
        // bombs, guns) while it's down, back on it at periscope depth
        const rec = this.game.war.rec(s);
        const down = s.depth > pd + 3;
        if (rec) rec.conceal = down ? 0.97 : 0.5;
        const T = this.game.ground.targets, i = T.indexOf(s);
        if (down && i >= 0) T.splice(i, 1);
        else if (!down && i < 0 && s.alive) T.push(s);
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.enabled) return;
        const g = this.game;
        for (const grp of this.groups) {
            if (!grp.guide || grp.guide.gone) continue;
            grp.flightOps = Math.max(0, grp.flightOps - dt);
            const deck = grp.guide.type === 'carrier' ? this.deckOf(grp.guide) : null;
            if (deck && (deck.queue.length || deck.jets.length)) grp.flightOps = 20;
            grp.steerGuide(dt);
            grp.keepStations(dt);
            grp.adT -= dt;
            if (grp.adT <= 0) { grp.adT = 0.5; this.airDefense(grp); }
            grp.surfT -= dt;
            if (grp.surfT <= 0) {
                const sk = (g.difficulty || { skill: 0.6 }).skill;
                grp.surfT = grp.side === g.war.side ? rand(200, 320) : rand(260, 380) - sk * 110;
                if (g.time > 60) this.surfaceAction(grp);
            }
            for (const m of grp.members) if (m.ship.def.cls === 'sub' && m.ship.alive) this.updateSub(m.ship, dt);
        }
        // launch sequences on every armed ship
        for (const s of g.naval.ships) if (s.launcher && !s.gone) s.launcher.update(dt);
        // interceptors
        for (let i = this.interceptors.length - 1; i >= 0; i--) {
            const m = this.interceptors[i];
            m.update(dt);
            if (!m.alive) this.interceptors.splice(i, 1);
        }
        for (const d of this.decks) d.update(dt);
        for (const d of this.decks) d.postPhysics();
        this.ciwsCalls();
        this.ambient(dt);
        this.flushRadio();
    }

    // Free Flight: now and then a jet off the home carrier's catapult, a few minutes up, back in the pattern
    ambient(dt) {
        if (this.mode !== 'freeflight' || this.ambientT == null) return;
        this.ambientT -= dt;
        const g = this.game, cv = g.naval.homeCarrier, d = cv && this.deckOf(cv);
        if (this.ambientT > 0 || !d || !d.ok) return;
        this.ambientT = rand(150, 260);
        if (d.cap.length + d.jets.length < 2) d.requestLaunch({ type: 'fa18', skill: 0.7 });
    }

    // ═════════════ Radio ═════════════
    short(s) { return (s.fullName || s.name).replace(/^(USS|USNS) /, '').split(' (')[0]; }
    say(from, text, o = {}) {
        const g = this.game, d = g.director;
        const opts = { voice: NAVAL_VOICE, ...o };
        if (d && d.enabled && d.say) { d.say(from, text, opts); return; }
        // (outside a war: our own pacing — a call every 2.5 s, stale ones dropped)
        if (opts.priority || (!this.radioQ.length && g.time - this.lastRadio > 2.5)) { this.lastRadio = g.time; g.war.radio(from, text, opts); return; }
        if (this.radioQ.length >= 5) this.radioQ.shift();
        this.radioQ.push({ from, text, opts, t: g.time });
    }
    flushRadio() {
        const g = this.game;
        while (this.radioQ.length && g.time - this.radioQ[0].t > (this.radioQ[0].opts.ttl ?? 14)) this.radioQ.shift();
        if (this.radioQ.length && g.time - this.lastRadio > 2.5) { const q = this.radioQ.shift(); this.lastRadio = g.time; g.war.radio(q.from, q.text, q.opts); }
    }
    aawc(grp) { const m = grp.members.find(x => x.ship.alive && x.role === 'aaw') || grp.members.find(x => x.ship.alive && x.ship.launcher); return m ? this.short(m.ship) : 'STRIKE GROUP'; }

    callVampires(grp, threats) {
        const g = this.game, war = g.war;
        if (grp.side !== war.side) return;
        const vamp = threats.filter(t => t.kind === 'missile' && t.u.isStrategic && t.vampire);
        grp.vampires = vamp.length;
        if (!vamp.length) return;
        const fresh = vamp.filter(t => !t.u.vampireCalled);
        if (fresh.length && war.time - grp.vampireCall > 12) {
            grp.vampireCall = war.time;
            for (const t of vamp) t.u.vampireCalled = true;
            const c = fresh[0], from = grp.guide.pos;
            const { brg, km } = war.bearingRange(from, c.pos);
            const b3 = String(brg).padStart(3, '0');
            const tgt = c.target ? this.short(c.target) : 'THE GROUP';
            this.say(this.aawc(grp), 'VAMPIRE, VAMPIRE — ' + (vamp.length > 1 ? vamp.length + ' INBOUND, ' : '') + 'BEARING ' + b3 + ', ' + Math.round(km) + ' KM, ON ' + tgt, { color: '#ff4a3d', priority: true, say: 'Vampire, vampire, bearing ' + b3.split('').join(' ') + '.' });
            g.events.emit('vampire', grp, { missiles: vamp.map(t => t.u) });
        }
        // a leaker inside the medium layer
        for (const t of vamp) {
            if (t.u.leakerCalled || !t.target) continue;
            const d = t.pos.distanceTo(t.target.pos);
            if (d < 3500) { t.u.leakerCalled = true; this.stats.leakers++; this.say(this.short(t.target), 'LEAKER, LEAKER — CIWS ENGAGING, BRACE FOR IMPACT', { color: '#ff4a3d', priority: true, say: 'Leaker! Brace for impact!' }); }
        }
    }

    birdsAway(grp, ship, key, n, threat) {
        const war = this.game.war;
        if (grp.side !== war.side) return;
        const now = war.time;
        if (now - (grp.birdsCall || -1e9) < 6) return;
        grp.birdsCall = now;
        const what = threat.kind === 'missile' ? (threat.vampire ? 'VAMPIRE' : 'MISSILE') : 'BANDIT';
        const { brg } = war.bearingRange(ship.pos, threat.pos);
        this.say(this.short(ship), 'BIRDS AWAY — ' + n + '× ' + SAMS[key].name + ', TRACK ' + this.trackId(threat.u) + ' (' + what + ' BRG ' + String(brg).padStart(3, '0') + ')', { color: '#9fd4ff', say: n > 1 ? 'Birds away.' : false });
    }

    onIntercept(m, T, killed, selfDestruct = false) {
        const g = this.game, war = g.war;
        if (killed) this.stats.kills++;
        if (m.team !== war.side || !T) return;
        const grp = this.groupOf(m.shooter);
        if (!grp) return;
        if (killed) {
            const what = T.isStrategic ? (T.vampireCalled ? 'VAMPIRE' : T.spec.short) : T.spec ? 'BANDIT' : 'MISSILE';
            if (war.time - (grp.splashCall || -1e9) > 4) { grp.splashCall = war.time; this.say(this.short(m.shooter), 'SPLASH ONE ' + what + ' — TRACK ' + (m.trackId || this.trackId(T)), { color: '#5dffa0', say: false }); }
        } else if (!selfDestruct && T.alive !== false && war.time - (grp.missCall || -1e9) > 10) {
            grp.missCall = war.time;
            this.say(this.short(m.shooter), 'MISS, TRACK ' + (m.trackId || this.trackId(T)) + ' — REENGAGING', { color: '#ffd24a', say: false });
        }
    }
    onDecoyed(m, T) { if (T && T.isPlayer) this.game.addFeed('SAM DECOYED', '#5dffa0'); }

    // CIWS (naval.js) engaging: one call per mount and burst
    ciwsCalls() {
        const g = this.game, war = g.war;
        for (const grp of this.groups) {
            if (grp.side !== war.side) continue;
            for (const m of grp.members) for (const mt of m.ship.mounts) {
                if (mt.type !== 'ciws' || !mt.engagedT) continue;
                const on = g.time - mt.engagedT < 0.3 && mt.target && mt.target.isStrategic;
                if (on && !mt.calling) { mt.calling = true; if (g.time - (grp.ciwsCall || -1e9) > 8) { grp.ciwsCall = g.time; this.say(this.short(m.ship), 'CIWS ENGAGING — MOUNT ' + (21 + m.ship.mounts.indexOf(mt)), { color: '#ff9f5a', say: false }); } }
                else if (!on) mt.calling = false;
            }
        }
    }

    // ═════════════ Tasks (tasks.js, the Living War and the sandbox) ═════════════
    registerTasks() {
        const T = this.game.tasks;
        if (this.taskGen || !T || !T.addGenerator) return;
        this.taskGen = true; // (generators are kept across sorties: once)
        T.addGenerator((tasks, g) => this.taskOffers(tasks, g));
    }
    taskOffers(tasks, g) {
        if (!this.enabled) return null;
        const war = g.war;
        // anti-ship missiles inbound to the carrier: go after the ship that fired them
        const blue = this.groups.find(gr => gr.side === war.side && gr.guide && gr.guide.type === 'carrier' && gr.guide.alive);
        if (blue && blue.vampires > 0 && tasks.canOffer(true)) {
            const shooter = g.strikes && g.strikes.missiles.map(m => m.vampireCalled && m.source && m.source.host).find(h => h && h.alive && h.isShip && war.known(h) >= INTEL.CONTACT);
            if (shooter) return {
                type: 'naval', key: 'vampire:' + war.rec(shooter).id, urgent: true, title: 'THE CARRIER IS UNDER MISSILE ATTACK', label: 'SHOOTER',
                brief: 'Anti-ship missiles inbound on the carrier group. The escorts are engaging — take out the ship that fired them before it reloads: ' + war.label(shooter) + ', ' + war.describePos(shooter.pos) + '.',
                pos: () => shooter.pos, units: [shooter], reward: 1200, expires: 240, limit: 900,
            };
        }
        // an enemy surface group within reach of our carrier
        const red = this.groups.find(gr => gr.side !== war.side && gr.alive);
        if (red && blue && tasks.canOffer(false)) {
            const lead = red.members.map(m => m.ship).find(s => s.alive && (s.type === 'slava' || s.type === 'destroyer') && war.known(s) >= INTEL.CONTACT);
            if (lead && lead.pos.distanceTo(blue.guide.pos) < 70000) return {
                type: 'naval', key: 'sag:' + red.id, title: 'ENEMY SURFACE GROUP', label: 'SURFACE GROUP',
                brief: 'An enemy surface action group is within striking range of our carrier. Sink the ' + war.label(lead) + ' — its SAMs cover the group: come in low, or mark it and call an anti-ship strike (TACTICAL SUPPORT).',
                pos: () => lead.pos, units: [lead], reward: 1500, expires: 300, limit: 1200,
            };
        }
        return null;
    }

    // ═════════════ HUD ═════════════
    drawHud(ctx, hud) {
        const g = this.game, war = g.war;
        if (!this.enabled || g.photo || g.hideHud || !g.player) return;
        const blue = this.groups.find(gr => gr.side === war.side && gr.guide && gr.guide.alive && gr.guide.type === 'carrier');
        if (!blue) return;
        const p = g.pilotMode ? g.pilotMode.pos : g.player.pos;
        const near = p.distanceTo(blue.guide.pos) < 30000;
        const sams = this.interceptors.filter(m => m.alive && m.team === war.side).length;
        if (!blue.vampires && !(near && sams)) return;
        const txt = 'CSG ' + this.short(blue.guide) + (blue.vampires ? ' · ' + blue.vampires + ' VAMPIRE' + (blue.vampires > 1 ? 'S' : '') + ' INBOUND' : '') + (sams ? ' · ' + sams + ' SAM' + (sams > 1 ? 'S' : '') + ' IN FLIGHT' : '');
        ctx.save();
        ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        const w = ctx.measureText(txt).width + 16, y = hud.compact ? 92 : 112;
        ctx.fillStyle = 'rgba(8,14,20,0.5)'; ctx.fillRect(hud.w / 2 - w / 2, y - 10, w, 20);
        ctx.fillStyle = blue.vampires && (g.time * 3) % 1 < 0.6 ? '#ff4a3d' : '#9fd4ff';
        ctx.fillText(txt, hud.w / 2, y);
        ctx.restore();
    }

    // ═════════════ Tactical map ═════════════
    drawMap(ctx, map) {
        const g = this.game, war = g.war, P = {}, Q = {};
        ctx.save();
        for (const grp of this.groups) {
            if (!grp.guide || !grp.alive) continue;
            const own = grp.side === war.side;
            const gp = grp.guide.pos;
            if (own) {
                // the group's air-defence umbrella, the screen, the course
                map.toScreen(gp.x, gp.z, P);
                const R = this.umbrella(grp);
                if (R > 0) { ctx.strokeStyle = 'rgba(111,180,255,0.35)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(P.x, P.y, R * map.scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
                ctx.strokeStyle = 'rgba(111,180,255,0.45)';
                for (const m of grp.members) { if (m.ship === grp.guide || !m.ship.alive || m.ship.def.cls === 'sub') continue; map.toScreen(m.ship.pos.x, m.ship.pos.z, Q); ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke(); }
                const h = grp.guide.heading, L = Math.max(24, 3000 * map.scale);
                ctx.strokeStyle = '#6fb4ff'; ctx.lineWidth = 1.6;
                ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(P.x - Math.sin(h) * L, P.y - Math.cos(h) * L); ctx.stroke();
                if (map.scale > 0.004) { ctx.fillStyle = '#6fb4ff'; ctx.font = '600 10px "Share Tech Mono", monospace'; ctx.textAlign = 'left'; ctx.fillText(this.short(grp.guide) + ' · ' + Math.round(this.groupSpeed(grp) / KT) + ' KT' + (grp.threat > 0 ? ' · ZIG-ZAG' : '') + (grp.flightOps > 0 ? ' · FLIGHT OPS' : ''), P.x + 12, P.y + 14); }
            } else {
                // known enemy ships with SAMs: their envelopes
                for (const m of grp.members) {
                    const s = m.ship, rec = war.rec(s);
                    if (!s.alive || !rec || rec.known < INTEL.IDENTIFIED || !s.launcher) continue;
                    let R = 0; for (const k of s.launcher.mag.keys()) if (SAMS[k]) R = Math.max(R, SAMS[k].range);
                    if (!R) continue;
                    map.toScreen(rec.lastPos.x, rec.lastPos.z, Q);
                    ctx.strokeStyle = 'rgba(255,90,74,0.5)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 1.2;
                    ctx.beginPath(); ctx.arc(Q.x, Q.y, R * map.scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
                    ctx.fillStyle = 'rgba(255,60,40,0.04)'; ctx.fill();
                }
            }
        }
        // interceptors in flight
        for (const m of this.interceptors) {
            if (!m.alive || (m.team !== war.side && !m.seen)) continue;
            map.toScreen(m.pos.x, m.pos.z, P);
            ctx.fillStyle = m.team === war.side ? '#bfe0ff' : '#ff8a7a';
            ctx.fillRect(P.x - 1.5, P.y - 1.5, 3, 3);
        }
        ctx.restore();
    }
    umbrella(grp) { let R = 0; for (const m of grp.members) if (m.ship.alive && m.ship.launcher) for (const k of m.ship.launcher.mag.keys()) if (SAMS[k] && m.ship.launcher.count(k)) R = Math.max(R, SAMS[k].range); return R; }
    groupSpeed(grp) { const v = grp.guide.vel; return Math.hypot(v.x, v.z); }

    mapInfo(sel) {
        const g = this.game, war = g.war;
        if (!sel || sel.kind !== 'unit' || !sel.unit.isShip) return [];
        const s = sel.unit, grp = this.groupOf(s), own = s.team === war.side;
        const out = [];
        if (grp) out.push({ text: (own ? grp.name : 'ENEMY GROUP') + ' · ' + (s === grp.guide ? 'GUIDE' : (grp.members.find(m => m.ship === s) || {}).role?.toUpperCase() || ''), color: '#9fd4ff' });
        if (own) {
            const v = s.vel;
            out.push({ text: 'COURSE ' + String(Math.round((((-s.heading) * 180 / Math.PI) + 360) % 360)).padStart(3, '0') + ' · ' + Math.round(Math.hypot(v.x, v.z) / KT) + ' KT' + (s.def.cls === 'sub' ? ' · DEPTH ' + Math.round(s.depth) + ' M' : '') });
            if (s.launcher) {
                const mag = s.launcher.mag, keys = mag.keys();
                if (keys.length) out.push({ text: keys.filter(k => k !== 'asroc').map(k => (SAMS[k] ? SAMS[k].name : MISSILES[k] ? MISSILES[k].short : k.toUpperCase()) + ' ' + mag.count(k)).join(' · '), color: '#9fd4ff' });
                const empty = s.launcher.emptyCells().length;
                if (empty) out.push({ text: empty + ' CELLS EMPTY', color: 'rgba(232,244,255,0.6)' });
            }
            const d = this.deckOf(s);
            if (d && d.ok) out.push({ text: 'DECK · ' + d.cap.length + ' JETS UP · ' + d.jets.filter(j => j.ac.onGround).length + ' ON DECK · ' + d.jets.filter(j => !j.ac.onGround).length + ' IN THE PATTERN', color: '#9fd4ff' });
        } else if (war.known(s) >= INTEL.IDENTIFIED && s.launcher) {
            const keys = s.launcher.mag.keys().filter(k => k !== 'asroc');
            if (keys.length) out.push({ text: 'ARMED: ' + keys.map(k => SAMS[k] ? SAMS[k].name : MISSILES[k] ? MISSILES[k].short : k.toUpperCase()).join(', '), color: '#ff9f5a' });
        }
        return out;
    }

    mapActions(sel) {
        const g = this.game, war = g.war;
        if (!this.enabled || !sel) return [];
        const acts = [];
        const blue = this.groups.filter(gr => gr.side === war.side && gr.alive && gr.guide.type !== 'ssgn');
        if (sel.kind === 'point' && blue.length) {
            const grp = blue.sort((a, b) => a.guide.pos.distanceToSquared(new THREE.Vector3(sel.pos.x, 0, sel.pos.z)) - b.guide.pos.distanceToSquared(new THREE.Vector3(sel.pos.x, 0, sel.pos.z)))[0];
            acts.push({ label: 'SEND ' + this.short(grp.guide) + ' GROUP HERE', run: () => { this.moveGroupOf(grp.guide, sel.pos); this.say(this.aawc(grp), 'COPY, PROCEEDING TO GRID ' + war.grid(sel.pos.x, sel.pos.z), { color: '#9fd4ff', say: false }); } });
        }
        if (sel.kind === 'unit' && sel.unit.isShip && sel.unit.team !== war.side && sel.unit.alive) {
            const t = sel.unit;
            for (const s of this.shooters(war.side, ['harpoon', 'tlam'])) {
                const key = s.strikeSource.canFire('harpoon') ? 'harpoon' : 'tlam';
                acts.push({ label: MISSILES[key].short + ' FROM ' + this.short(s), run: () => this.launchFrom(s, key, t, 2) });
                if (acts.length > 3) break;
            }
        }
        return acts;
    }
    shooters(team, keys) { return this.game.naval.ships.filter(s => s.alive && s.team === team && s.strikeSource && keys.some(k => s.strikeSource.canFire(k))); }

    // ═════════════ Command menu ═════════════
    commands() {
        const g = this.game, war = g.war;
        if (!this.enabled) return [];
        const out = [];
        const blue = this.groups.find(gr => gr.side === war.side && gr.guide && gr.guide.alive && gr.guide.type === 'carrier');
        const marks = war.designations, mark = marks[marks.length - 1];
        if (blue) {
            const d = this.deckOf(blue.guide);
            const cs = this.short(blue.guide);
            if (d && d.ok) {
                out.push({ path: ['NAVAL'], label: 'LAUNCH ALERT FIGHTERS (' + cs + ')', hint: d.cap.length + ' UP · ' + d.queue.length + ' QUEUED', run: () => { d.requestLaunch({ type: 'fa18', skill: this.skill() }); d.requestLaunch({ type: 'fa18', skill: this.skill() }); this.say('TOWER', 'COPY — LAUNCHING THE ALERT FIVE', { say: false }); } });
                out.push({ path: ['NAVAL'], label: 'RECOVER AIRCRAFT', hint: d.cap.length + ' AIRBORNE', enabled: d.cap.length > 0, run: () => { for (const c of [...d.cap]) d.recover(c.ac); } });
            }
            out.push({ path: ['NAVAL'], label: blue.order === 'flank' ? 'GROUP: CRUISE SPEED' : 'GROUP: FLANK SPEED', hint: Math.round(this.groupSpeed(blue) / KT) + ' KT', run: () => { blue.order = blue.order === 'flank' ? 'cruise' : 'flank'; } });
            out.push({ path: ['NAVAL'], label: 'GROUP: TURN INTO THE WIND', hint: 'FLIGHT OPS', run: () => { blue.flightOps = 120; blue.navT = 0; } });
            out.push({ path: ['NAVAL'], label: blue.zig.on ? 'GROUP: ZIG-ZAG OFF' : 'GROUP: ZIG-ZAG ON', hint: blue.threat > 0 ? 'THREAT' : 'NO THREAT', run: () => { blue.zig.on = !blue.zig.on; } });
        }
        // missile launches from a ship or submarine at the newest mark
        for (const s of this.shooters(war.side, ['tlam', 'harpoon'])) {
            const sub = s.def.cls === 'sub', key = s.strikeSource.canFire('tlam') ? 'tlam' : 'harpoon';
            const n = sub ? 4 : 2;
            out.push({ path: ['NAVAL', sub ? 'SUBMARINE LAUNCH' : 'SHIP LAUNCH'], label: n + '× ' + MISSILES[key].short + ' FROM ' + this.short(s), hint: mark ? 'ON MARK ' + mark.id + ' · ' + s.strikeSource.stock[key] + ' LEFT' : 'MARK A TARGET FIRST (,)', enabled: !!mark, run: () => this.launchFrom(s, key, mark, n) });
        }
        if (this.mode === 'sandbox' || this.mode === 'freeflight' || this.mode === 'war') {
            const p = g.player && g.player.alive ? g.player.pos : g.camera.position;
            const ahead = () => { const f = g.player ? g.player.getForward(_v2) : _v2.set(0, 0, -1); return { x: p.x + f.x * 15000, z: p.z + f.z * 15000 }; };
            out.push({ path: ['SANDBOX', 'NAVAL'], label: 'SPAWN RED SURFACE GROUP 15 KM AHEAD', run: () => { const gr = this.spawnGroup('red', ahead()); g.addFeed(gr ? 'RED SURFACE GROUP AT ' + war.grid(gr.guide.pos.x, gr.guide.pos.z) : 'NO OPEN WATER THERE', gr ? '#ff9f5a' : '#9fb2c4'); } });
            out.push({ path: ['SANDBOX', 'NAVAL'], label: 'SPAWN BLUE CARRIER GROUP 15 KM AHEAD', run: () => { const gr = this.spawnGroup('blue', ahead()); g.addFeed(gr ? 'CARRIER GROUP AT ' + war.grid(gr.guide.pos.x, gr.guide.pos.z) : 'NO OPEN WATER THERE', gr ? '#6fb4ff' : '#9fb2c4'); } });
        }
        return out;
    }

    // ships near a ship (for collision avoidance)
    shipsNear(s, r) {
        const out = [];
        for (const o of this.game.naval.ships) if (o !== s && !o.gone && o.alive && Math.abs(o.mesh.position.x - s.mesh.position.x) < r && Math.abs(o.mesh.position.z - s.mesh.position.z) < r) out.push(o);
        return out;
    }

    // a deck plug-in hook: a recovered jet went below (the carrier sends up another for the next CAP cycle)
    onStruckBelow(deck) {
        if (this.mode === 'naval' || this.mode === 'war' || this.mode === 'sandbox') {
            if (deck.team === this.game.war.side && deck.cap.length + deck.jets.length + deck.queue.length < 2) deck.requestLaunch({ type: 'fa18', skill: this.skill() });
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// The front line and the ground war (docs/WAR.md), a plug-in system (systems.js) that runs in the Living War
// and in the Sandbox.
//  • sectors — the fighting stretch of war.front is resampled into control points every 2 km and split into
//    sectors (ALPHA, BRAVO…), each with a blue and a red strength, supply and a push speed
//  • fighting — each second the sectors trade losses and draw reinforcements (faster with supply); when one
//    side dominates, the front moves into the other's ground at up to ~6 m/s (a kilometre in three minutes),
//    never closer than 5.5 km to an airbase of the side that's losing, and war.setFront() carries it
//  • player influence — anything military destroyed near the front weakens its side's sector: artillery,
//    SAMs, radars, armour, supply trucks; a bridge down behind a side's lines or a burnt fuel depot cuts its
//    supply for as long as it stays down (the whole war)
//  • something to see — near the camera: shell impacts and muzzle flashes, distant rumble, smoke from
//    burning wrecks, tracer across the line, and "engagement zones" of real ground units (ground.js tanks,
//    AAA, trucks) that fight each other and that the player can join; everything else is abstract
//  • red artillery batteries — real, persistent units behind the line that shell a sector (the "destroy the
//    artillery" tasks); each one alive adds to red's firepower there
//  • the tactical map — sectors, their strength, push arrows, contested zones and where the war started
// Other plug-ins: front.sectors, front.sectorAt(pos), front.hit(sector, team, amount, why),
// front.offensive(sector, team), front.zoneUnits(sector); events 'frontPush', 'frontOffensive',
// 'townCaptured' (and war's 'warFront').
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight, groundHeight, BASES } from './world.js';
import { INTEL } from './war.js';
import { BLUE_TOWNS, RED_TOWNS } from './tacmap.js';
import { clamp, lerp, rand, pick, damp } from './util.js';

const NAMES = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET'];
const ACTIVE_X0 = -32000, ACTIVE_X1 = 36000; // the stretch of the front that fights (the ends stay put)
const STEP = 2000;          // spacing of the moving control points (m)
const SECTOR_LEN = 12000;   // rough length of a sector along the front
const MAX_OFF = 7000;       // furthest the front moves either way from where the war started
const BASE_CLEAR = 5500;    // …and never closer than this to an airbase of the side giving ground
const PUSH_SPEED = 6;       // m/s at full dominance
const CAP = 100;            // strength a sector's side rebuilds toward
const FIRE_K = 0.0022, REINF_K = 0.004;
const VIS_R = 16000;        // shelling, flashes and smoke are drawn this close to the camera
const ZONE_R = 14000, ZONE_DROP = 22000; // real ground units near the player: made, and dropped
const BLUE_C = '#6fb4ff', RED_C = '#ff5a4a';
// what each class is worth to its side's sector when it's destroyed near the front
const WORTH = { artillery: 9, tank: 5, sam: 5, 'sam-radar': 5, radar: 4, aaa: 3, tel: 4, command: 10, fuel: 4, ammo: 6, vehicle: 2, convoy: 2, infantry: 1, bunker: 4, facility: 4 };
const RED_NAMES = { tank: 'T-72 TANK', spaag: 'ZSU-23-4 SHILKA', truck: 'URAL TRUCK', humvee: 'BRDM SCOUT CAR' };
const BLUE_NAMES = { tank: 'M1 ABRAMS', spaag: 'M163 VULCAN', truck: 'M939 TRUCK', humvee: 'HUMVEE' };
const TYPE_CLS = { tank: 'tank', spaag: 'aaa', msam: 'sam', truck: 'vehicle', humvee: 'vehicle', fueltruck: 'vehicle' };
const TRACER_RED = [3.4, 1.0, 0.5], TRACER_BLUE = [3.0, 2.6, 1.3];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const FRONT_FIRE = { team: 'front', name: 'GROUND FIRE', isFront: true }; // the source of the ground war's own fire

// Town names as the tactical map shows them (so a radio call and the map agree): red-held towns get the
// enemy's names, the rest ours, in town order — the map keeps a name it finds already set
export function nameTowns(towns, war) {
    let bi = 0, ri = 0;
    for (const t of towns || []) {
        if (t.mapName) { if (RED_TOWNS.includes(t.mapName)) ri++; else bi++; continue; }
        t.mapName = war.sideAt(t.x, t.z) === 'red' ? RED_TOWNS[ri++ % RED_TOWNS.length] : BLUE_TOWNS[bi++ % BLUE_TOWNS.length];
    }
}

export class FrontLine {
    constructor(game) {
        this.game = game;
        this.enabled = false;
        this.sectors = [];
        this.pts = [];
        this.zones = [];
        this.batteries = [];
        this.fires = [];
        this.pending = [];
        game.events.on('groundKilled', (t, { source } = {}) => this.onKill(t, source));
    }

    // ═════════════ Lifecycle ═════════════
    start(mode) {
        this.clear();
        this.enabled = mode === 'war' || mode === 'sandbox';
        if (!this.enabled) return;
        const g = this.game;
        this.build(g.war.front);
        if (g.world.towns) nameTowns(g.world.towns.towns, g.war);
        this.townSide = new Map();
        for (const t of g.world.towns ? g.world.towns.towns : []) this.townSide.set(t, g.war.sideAt(t.x, t.z));
        this.placeBatteries(mode === 'war' ? 3 : 2);
    }

    clear() {
        for (const z of this.zones) this.dropZone(z);
        this.zones.length = 0;
        this.batteries.length = 0;
        this.fires.length = 0;
        this.pending.length = 0;
        this.sectors = [];
        this.pts = [];
        this.enabled = false;
        this.simT = 0; this.geoT = 0; this.zoneT = 0; this.supplyT = 0; this.townT = 0;
        this.fxAcc = 0; this.flashAcc = 0; this.tracerAcc = 0;
        this.offensiveT = 150 + rand(0, 90);
        this.batteryT = 600;
        this.dirty = false;
    }

    // ═════════════ Geometry: control points and sectors ═════════════
    // F: the front polyline (west → east). The part between ACTIVE_X0 and ACTIVE_X1 is resampled every STEP m;
    // the rest is kept as fixed anchors.
    build(F) {
        const war = this.game.war;
        const S = [0];
        for (let i = 1; i < F.length; i++) S.push(S[i - 1] + Math.hypot(F[i].x - F[i - 1].x, F[i].z - F[i - 1].z));
        const total = S[S.length - 1];
        // arc positions where the polyline crosses the active limits
        const crossAt = (X, first) => {
            let best = first ? 0 : total;
            for (let i = 0; i + 1 < F.length; i++) {
                const a = F[i], b = F[i + 1];
                if ((a.x - X) * (b.x - X) <= 0 && a.x !== b.x) {
                    const s = S[i] + (S[i + 1] - S[i]) * (X - a.x) / (b.x - a.x);
                    if (first) return s;
                    best = s;
                }
            }
            return best;
        };
        const sA = Math.max(0, crossAt(ACTIVE_X0, true)), sB = Math.min(total, Math.max(sA + STEP * 4, crossAt(ACTIVE_X1, false)));
        const at = (s, out) => {
            let i = 0;
            while (i + 2 < F.length && S[i + 1] < s) i++;
            const t = clamp((s - S[i]) / Math.max(S[i + 1] - S[i], 1e-6), 0, 1);
            out.x = F[i].x + (F[i + 1].x - F[i].x) * t; out.z = F[i].z + (F[i + 1].z - F[i].z) * t;
            return out;
        };
        this.prefix = F.filter((p, i) => S[i] < sA - 1).map(p => ({ x: p.x, z: p.z }));
        this.suffix = F.filter((p, i) => S[i] > sB + 1).map(p => ({ x: p.x, z: p.z }));
        const n = Math.max(5, Math.round((sB - sA) / STEP) + 1);
        const pts = [];
        for (let i = 0; i < n; i++) {
            const s = sA + (sB - sA) * i / (n - 1);
            const b = at(s, {});
            pts.push({ s, bx: b.x, bz: b.z, x: b.x, z: b.z, nx: 0, nz: -1, lo: 0, hi: 0, off: 0, sec: 0 });
        }
        // normals into red ground, from a wide tangent (so they turn gradually round a corner)
        for (let i = 0; i < n; i++) {
            const a = pts[Math.max(0, i - 2)], b = pts[Math.min(n - 1, i + 2)];
            const tx = b.bx - a.bx, tz = b.bz - a.bz, L = Math.hypot(tx, tz) || 1;
            const p = pts[i];
            p.nx = tz / L; p.nz = -tx / L;
            if (war.sideAt(p.bx + p.nx * 600, p.bz + p.nz * 600) !== 'red') { p.nx = -p.nx; p.nz = -p.nz; }
            // how far it may move: not into an airbase of the side giving ground
            p.hi = this.reach(p, 1); p.lo = -this.reach(p, -1);
        }
        this.pts = pts;
        // sectors of roughly SECTOR_LEN along the front
        const count = clamp(Math.round((sB - sA) / SECTOR_LEN), 3, NAMES.length);
        this.sectors = [];
        for (let j = 0; j < count; j++) {
            const i0 = Math.round(j * (n - 1) / count), i1 = Math.round((j + 1) * (n - 1) / count);
            const mid = Math.round((i0 + i1) / 2);
            const sec = {
                id: j, name: NAMES[j], i0, i1, mid, s: pts[mid].s,
                center: new THREE.Vector3(pts[mid].x, 0, pts[mid].z), normal: new THREE.Vector3(pts[mid].nx, 0, pts[mid].nz),
                blue: rand(52, 66), red: rand(52, 66), supply: { blue: 1, red: 1 }, boost: { blue: 0, red: 0 },
                off: 0, vel: 0, intensity: 0.4, contested: false, offensive: null, lastCall: -1e9, pushing: 0,
                town: null, redFirepower: 1,
            };
            for (let i = i0; i <= i1; i++) pts[i].sec = j;
            this.sectors.push(sec);
        }
        this.describeSectors();
        this.front0 = [...this.prefix, ...pts.map(p => ({ x: p.bx, z: p.bz })), ...this.suffix];
        this.applyOffsets(true);
    }

    // metres a control point can move along its normal (dir +1 into red, −1 into blue) before it gets within
    // BASE_CLEAR of an airbase of the side that would be giving ground
    reach(p, dir) {
        let ok = 0;
        for (let d = 250; d <= MAX_OFF; d += 250) {
            const x = p.bx + p.nx * d * dir, z = p.bz + p.nz * d * dir;
            if (BASES.some(b => (dir > 0 ? !b.friendly : b.friendly) && Math.hypot(b.x - x, b.z - z) < BASE_CLEAR)) break;
            ok = d;
        }
        return ok;
    }

    // the nearest town to each sector's centre (for the radio: "SECTOR CHARLIE, NEAR HARROW")
    describeSectors() {
        const towns = this.game.world.towns ? this.game.world.towns.towns : [];
        for (const s of this.sectors) {
            let best = null, bd = 16000;
            for (const t of towns) { const d = Math.hypot(t.x - s.center.x, t.z - s.center.z); if (d < bd) { bd = d; best = t; } }
            s.town = best;
        }
    }

    sectorLabel(s) { return 'SECTOR ' + s.name + (s.town && s.town.mapName ? ' (' + s.town.mapName.toUpperCase() + ')' : ''); }

    // Each control point's offset: the sectors' offsets interpolated along the front, tapered to nothing at the
    // ends of the moving stretch; then the front is rebuilt (dropping any point that would fold back)
    applyOffsets(force = false) {
        const pts = this.pts, secs = this.sectors, n = pts.length;
        if (!n) return;
        for (let i = 0; i < n; i++) {
            const p = pts[i];
            let o;
            if (p.s <= secs[0].s) o = secs[0].off;
            else if (p.s >= secs[secs.length - 1].s) o = secs[secs.length - 1].off;
            else {
                let j = 0;
                while (j + 1 < secs.length && secs[j + 1].s < p.s) j++;
                const a = secs[j], b = secs[j + 1];
                o = lerp(a.off, b.off, (p.s - a.s) / Math.max(b.s - a.s, 1));
            }
            const taper = Math.min(1, i / 3, (n - 1 - i) / 3);
            p.off = clamp(o * taper, p.lo, p.hi);
            p.x = p.bx + p.nx * p.off; p.z = p.bz + p.nz * p.off;
        }
        for (const s of secs) { const m = pts[s.mid]; s.center.set(m.x, 0, m.z); }
        const out = [...this.prefix];
        let lx = null, lz = null, bxPrev = null, bzPrev = null;
        for (const p of pts) {
            if (lx !== null && (p.x - lx) * (p.bx - bxPrev) + (p.z - lz) * (p.bz - bzPrev) <= 0) continue; // folded back
            out.push({ x: p.x, z: p.z });
            lx = p.x; lz = p.z; bxPrev = p.bx; bzPrev = p.bz;
        }
        out.push(...this.suffix);
        if (force || this.dirty) { this.game.war.setFront(out); this.dirty = false; }
    }

    // ═════════════ Queries ═════════════
    // the sector whose stretch of front is nearest a point, and how far it is from the line (m)
    sectorAt(pos, maxDist = Infinity) {
        const pts = this.pts;
        if (!pts.length) return null;
        let bi = 0, bd = Infinity;
        for (let i = 0; i < pts.length; i++) {
            const d = (pts[i].x - pos.x) ** 2 + (pts[i].z - pos.z) ** 2;
            if (d < bd) { bd = d; bi = i; }
        }
        // refine against the two segments either side
        let best = Math.sqrt(bd);
        for (const j of [bi - 1, bi]) {
            if (j < 0 || j + 1 >= pts.length) continue;
            const a = pts[j], b = pts[j + 1], dx = b.x - a.x, dz = b.z - a.z;
            const t = clamp(((pos.x - a.x) * dx + (pos.z - a.z) * dz) / Math.max(dx * dx + dz * dz, 1), 0, 1);
            best = Math.min(best, Math.hypot(a.x + dx * t - pos.x, a.z + dz * t - pos.z));
        }
        if (best > maxDist) return null;
        const s = this.sectors[pts[bi].sec];
        s._dist = best;
        return s;
    }

    distToFront(pos) { const s = this.sectorAt(pos); return s ? s._dist : Infinity; }

    // overall balance (0 = all red … 1 = all blue) and how far the front has moved in blue's favour (km, mean)
    balance() { let q = 0; for (const s of this.sectors) q += s.blue / Math.max(s.blue + s.red, 1); return this.sectors.length ? q / this.sectors.length : 0.5; }
    gainKm() { let o = 0; for (const s of this.sectors) o += s.off; return this.sectors.length ? o / this.sectors.length / 1000 : 0; }

    zoneUnits(sector, team = null) {
        const out = [];
        for (const z of this.zones) if (!sector || z.sector === sector) for (const u of z.units) if (u.alive && (!team || u.team === team)) out.push(u);
        return out;
    }

    // ═════════════ The fighting ═════════════
    // amount: strength lost (a negative amount reinforces); why: a short reason for the log
    hit(sector, team, amount, why = '') {
        if (!sector) return;
        sector[team] = clamp(sector[team] - amount, 5, CAP * 1.2);
        sector.lastHit = { team, amount, why, t: this.game.war.time };
    }

    // a push by one side: a boost of strength arriving over ~20 s and a few minutes of extra firepower
    offensive(sector, team, quiet = false) {
        if (!sector) return;
        sector.offensive = { team, t: 0, dur: rand(170, 240) };
        sector.boost[team] += 26;
        this.game.events.emit('frontOffensive', sector, { team });
        if (quiet) return;
        const war = this.game.war, where = this.sectorLabel(sector);
        if (team === war.side) this.say('COMMAND', 'OUR FORCES ARE ATTACKING IN ' + where + ' — AIR SUPPORT REQUESTED', { color: '#9fd4ff', say: 'Our forces are attacking in sector ' + sector.name.toLowerCase() + '.' });
        else this.say('COMMAND', 'ENEMY OFFENSIVE IN ' + where + ' — ARMOUR ADVANCING ON OUR LINES', { color: '#ff9f5a', say: 'Enemy offensive in sector ' + sector.name.toLowerCase() + '.', priority: true });
    }

    // One second of war in every sector
    simulate(dt = 1) {
        const diff = this.game.difficulty || { skill: 0.6 };
        const redBias = 0.9 + diff.skill * 0.2; // the enemy fights a little harder on higher difficulty
        for (const s of this.sectors) {
            // offensives: the boost arrives over ~20 s, the push lasts a few minutes
            for (const team of ['blue', 'red']) {
                if (s.boost[team] > 0) { const k = Math.min(s.boost[team], 1.3 * dt); s[team] += k; s.boost[team] -= k; }
            }
            let bFire = 1.1, rFire = s.redFirepower * redBias; // (our own guns are abstract: a steady 10%)
            if (s.offensive) {
                s.offensive.t += dt;
                if (s.offensive.team === 'blue') bFire *= 1.35; else rFire *= 1.35;
                if (s.offensive.t > s.offensive.dur) s.offensive = null;
            }
            const b = s.blue, r = s.red;
            s.blue -= r * rFire * FIRE_K * rand(0.6, 1.4) * dt;
            s.red -= b * bFire * FIRE_K * rand(0.6, 1.4) * dt;
            s.blue += REINF_K * s.supply.blue * (CAP - s.blue) * dt;
            s.red += REINF_K * s.supply.red * (CAP - s.red) * dt;
            s.blue = clamp(s.blue, 5, CAP * 1.2); s.red = clamp(s.red, 5, CAP * 1.2);
            // the line moves when one side dominates (a stalemate band in the middle)
            const q = s.blue / (s.blue + s.red);
            const want = Math.abs(q - 0.5) < 0.045 ? 0 : clamp((q - 0.5) * 2 * PUSH_SPEED * 2.2, -PUSH_SPEED, PUSH_SPEED);
            s.vel = damp(s.vel, want, 0.35, dt);
            const lo = this.pts[s.mid].lo, hi = this.pts[s.mid].hi;
            const off = clamp(s.off + s.vel * dt, lo, hi);
            if ((off === lo && s.vel < 0) || (off === hi && s.vel > 0)) s.vel *= 0.5; // dug in at the limit
            if (Math.abs(off - s.off) > 0.01) this.dirty = true;
            s.off = off;
            s.intensity = clamp(0.3 + (s.offensive ? 0.35 : 0) + Math.abs(s.vel) / PUSH_SPEED * 0.4 + (1 - Math.abs(q - 0.5) * 2) * 0.15, 0, 1);
            s.contested = s.intensity > 0.55 || Math.abs(s.vel) > 1.2;
            this.reportPush(s);
        }
    }

    // radio when a sector starts to move (at most every few minutes per sector)
    reportPush(s) {
        const war = this.game.war;
        const dir = s.vel > 1.8 ? 1 : s.vel < -1.8 ? -1 : 0;
        if (dir === s.pushing) return;
        s.pushing = dir;
        if (!dir || war.time - s.lastCall < 150) return;
        s.lastCall = war.time;
        const team = dir > 0 ? 'blue' : 'red';
        this.game.events.emit('frontPush', s, { team });
        const where = this.sectorLabel(s);
        if (team === war.side) this.say('COMMAND', 'OUR FORCES ARE ADVANCING IN ' + where, { color: '#5dffa0', say: false });
        else this.say('COMMAND', 'ENEMY BREAKTHROUGH IN ' + where + ' — WE ARE FALLING BACK', { color: '#ff9f5a', say: 'Enemy breakthrough in sector ' + s.name.toLowerCase() + '. We are falling back.' });
    }

    // paced radio through the director when it's there
    say(from, text, opts) {
        const d = this.game.director;
        if (d && d.say) d.say(from, text, opts); else this.game.war.radio(from, text, opts);
    }

    // Supply: bridges down and fuel burnt behind a side's lines stay that way for the whole war
    updateSupply() {
        const g = this.game, war = g.war;
        const bridges = g.world.towns ? g.world.towns.bridges : [];
        const depots = war.units.filter(u => !u.alive && (war.recs.get(u)?.cls === 'fuel' || war.recs.get(u)?.cls === 'ammo'));
        const bunkerDown = war.units.some(u => !u.alive && u.team === 'red' && war.recs.get(u)?.cls === 'command');
        for (const s of this.sectors) {
            const cap = { blue: 1, red: 1 };
            for (const br of bridges) {
                if (br.alive) continue;
                const d = Math.hypot(br.pos.x - s.center.x, br.pos.z - s.center.z);
                if (d > 16000) continue;
                cap[war.sideAt(br.pos.x, br.pos.z)] -= 0.2;
            }
            for (const u of depots) if (Math.hypot(u.pos.x - s.center.x, u.pos.z - s.center.z) < 26000 && (u.team === 'red' || u.team === 'blue')) cap[u.team] -= 0.12;
            if (bunkerDown) cap.red -= 0.1;
            // convoys that got through top it up for a while
            for (const team of ['blue', 'red']) {
                s.delivered = s.delivered || { blue: 0, red: 0 };
                s.delivered[team] = Math.max(0, s.delivered[team] - 0.0006 * 5);
                s.supply[team] = clamp(cap[team] + s.delivered[team], 0.3, 1.3);
            }
            // artillery batteries alive in this sector add to red's firepower
            let guns = 0;
            for (const bt of this.batteries) if (bt.sector === s) for (const u of bt.units) if (u.alive) guns++;
            s.redFirepower = 1 + 0.07 * Math.min(guns, 4);
        }
    }

    // a convoy got through: supply for the sector nearest where it arrived
    deliver(pos, team, amount = 0.15) {
        const s = this.sectorAt(pos, 30000);
        if (!s) return null;
        s.delivered = s.delivered || { blue: 0, red: 0 };
        s.delivered[team] = Math.min(0.35, s.delivered[team] + amount);
        s[team] = Math.min(CAP * 1.2, s[team] + 6);
        return s;
    }

    // something military died: its side's sector near it loses strength (the ground war's own fire is already
    // counted in the abstract fighting, so only other causes count — the player, strikes, raids)
    onKill(t, source) {
        if (!this.enabled || !t || !t.pos) return;
        if (source && source.isFront) return;
        const war = this.game.war;
        if (t.isBridge) return; // (bridges work through supply)
        const team = t.team;
        if (team !== 'red' && team !== 'blue') return;
        const s = this.sectorAt(t.pos, 30000);
        if (!s) return;
        const rec = war.rec(t);
        const cls = rec ? rec.cls : t.cls || 'vehicle';
        let w = WORTH[cls] ?? 2;
        if (t.convoyOf) w += 1;
        // the deeper behind the line, the less it matters to the fighting here
        w *= clamp(1.25 - s._dist / 30000, 0.35, 1.25);
        this.hit(s, team, w, cls);
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.enabled || !this.sectors.length) return;
        const g = this.game;
        if (g.state !== 'playing' && g.state !== 'dead') return;
        this.simT += dt;
        if (this.simT >= 1) { const k = this.simT; this.simT = 0; this.simulate(k); }
        this.supplyT -= dt;
        if (this.supplyT <= 0) { this.supplyT = 5; this.updateSupply(); }
        this.geoT -= dt;
        if (this.geoT <= 0) { this.geoT = 2; if (this.dirty) this.applyOffsets(); }
        this.townT -= dt;
        if (this.townT <= 0) { this.townT = 4; this.checkTowns(); }
        this.offensiveT -= dt;
        if (this.offensiveT <= 0) this.randomOffensive();
        this.batteryT -= dt;
        if (this.batteryT <= 0) { this.batteryT = rand(480, 720); this.replaceBatteries(); }
        this.zoneT -= dt;
        if (this.zoneT <= 0) { this.zoneT = 1; this.manageZones(); }
        this.updateZones(dt);
        this.updateBatteries(dt);
        this.effectsNear(dt);
    }

    // a town that changed hands
    checkTowns() {
        const g = this.game, war = g.war;
        if (!this.townSide) return;
        for (const [t, was] of this.townSide) {
            const now = war.sideAt(t.x, t.z);
            if (now === was) continue;
            this.townSide.set(t, now);
            const name = (t.mapName || 'THE TOWN').toUpperCase();
            g.events.emit('townCaptured', t, { team: now });
            if (now === war.side) this.say('COMMAND', 'OUR FORCES HAVE TAKEN ' + name, { color: '#5dffa0', say: 'We have taken ' + (t.mapName || 'the town') + '.' });
            else this.say('COMMAND', name + ' HAS FALLEN TO THE ENEMY', { color: '#ff9f5a', say: (t.mapName || 'The town') + ' has fallen.' });
        }
    }

    // now and then one side goes on the attack somewhere — more often near the player, so it can be seen
    randomOffensive() {
        const g = this.game, diff = g.difficulty || { skill: 0.6 };
        this.offensiveT = rand(260, 420) / (0.8 + diff.skill * 0.4);
        const focus = this.focus();
        const cands = this.sectors.filter(s => !s.offensive);
        if (!cands.length) return;
        const w = cands.map(s => 1 / (1 + (Math.hypot(s.center.x - focus.x, s.center.z - focus.z) / 25000) ** 2));
        let r = Math.random() * w.reduce((a, b) => a + b, 0), s = cands[0];
        for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r <= 0) { s = cands[i]; break; } }
        // the side that's been losing ground there, more likely; the enemy a bit more often on harder settings
        const pRed = clamp(0.45 + diff.skill * 0.15 + (s.off > 1500 ? 0.2 : s.off < -1500 ? -0.2 : 0), 0.2, 0.85);
        this.offensive(s, Math.random() < pRed ? 'red' : 'blue');
    }

    focus() {
        const g = this.game;
        if (g.pilotMode) return g.pilotMode.pos;
        if (g.player && g.player.alive) return g.player.pos;
        return g.camera.position;
    }

    // ═════════════ Red artillery: real batteries behind the line ═════════════
    placeBatteries(n) {
        const order = [...this.sectors].sort(() => Math.random() - 0.5);
        // spread them: every other sector first
        const pickOrder = [...order.filter((s, i) => s.id % 2 === 1), ...order.filter(s => s.id % 2 === 0)];
        for (const s of pickOrder) {
            if (this.batteries.length >= n) break;
            this.addBattery(s);
        }
    }

    addBattery(s) {
        const g = this.game;
        if (!g.ground || !g.ground.addTarget) return null;
        const site = this.findSite(s, 'red', 3800, 6800);
        if (!site) return null;
        const bt = { sector: s, units: [], at: new THREE.Vector3(site.x, groundHeight(site.x, site.z), site.z), t: 0 };
        const face = Math.atan2(s.normal.x, s.normal.z); // (facing −normal: toward our lines)
        for (let k = 0; k < 3; k++) {
            const x = site.x + Math.cos(face) * (k - 1) * 75 + rand(-10, 10), z = site.z - Math.sin(face) * (k - 1) * 75 + rand(-10, 10);
            const u = g.ground.addTarget('tank', x, z, face, 'red');
            u.name = '2S19 MSTA-S';
            u.def = { ...u.def, name: '2S19 MSTA-S', score: 220 };
            u.battery = bt;
            u.fireT = rand(3, 14);
            this.gunBarrel(u);
            g.war.add(u, { cls: 'artillery', name: '2S19 MSTA-S HOWITZER', conceal: 0.35 });
            bt.units.push(u);
        }
        this.batteries.push(bt);
        return bt;
    }

    // a long barrel raised over the hull, so a howitzer doesn't read as a tank
    gunBarrel(u) {
        if (!FrontLine.barrelGeo) {
            FrontLine.barrelGeo = new THREE.CylinderGeometry(0.16, 0.2, 7.5, 8).translate(0, 3.75, 0);
            FrontLine.barrelMat = new THREE.MeshStandardMaterial({ color: 0x3f4633, roughness: 0.75, metalness: 0.3 });
        }
        const b = new THREE.Mesh(FrontLine.barrelGeo, FrontLine.barrelMat);
        b.position.set(0, 2.6, -0.8);
        b.rotation.x = -1.05; // ~30° elevation, pointing forward (−Z)
        b.castShadow = true;
        u.mesh.add(b);
    }

    // new batteries come up to replace ones that were destroyed (so there's always artillery to hunt)
    replaceBatteries() {
        const alive = this.batteries.filter(b => b.units.some(u => u.alive));
        const want = this.game.mode === 'war' ? 3 : 2;
        if (alive.length >= want) return;
        const used = new Set(alive.map(b => b.sector));
        const s = pick(this.sectors.filter(x => !used.has(x))) || pick(this.sectors);
        const bt = this.addBattery(s);
        if (bt) this.say('INTEL', 'NEW ENEMY ARTILLERY POSITIONS REPORTED BEHIND ' + this.sectorLabel(s), { color: '#ffd24a', say: false });
    }

    // flat, dry ground on a side of the line, at a depth behind it, away from towns and airbases
    findSite(s, team, dMin, dMax, along = 3000) {
        const g = this.game, world = g.world;
        const dir = team === 'red' ? 1 : -1;
        const tx = -s.normal.z, tz = s.normal.x;
        for (let k = 0; k < 80; k++) {
            const d = rand(dMin, dMax), a = rand(-along, along);
            const x = s.center.x + s.normal.x * d * dir + tx * a, z = s.center.z + s.normal.z * d * dir + tz * a;
            if (g.war.sideAt(x, z) !== team) continue;
            if (this.goodGround(x, z)) return { x, z };
        }
        return null;
    }

    goodGround(x, z, flat = 4) {
        const g = this.game, world = g.world;
        const h = terrainHeight(x, z);
        if (h < 4 || h > 900) return false;
        for (const [ox, oz] of [[40, 0], [-40, 0], [0, 40], [0, -40]]) if (Math.abs(terrainHeight(x + ox, z + oz) - h) > flat) return false;
        if (BASES.some(b => Math.hypot(x - b.x, z - b.z) < b.r * 1.3)) return false;
        const towns = world.towns;
        if (towns && towns.towns && towns.towns.some(t => Math.hypot(x - t.x, z - t.z) < t.radius + 150)) return false;
        if (world.blockTree && world.blockTree(x, z)) return false;
        return true;
    }

    updateBatteries(dt) {
        const g = this.game, war = g.war, cam = g.camera.position;
        for (const bt of this.batteries) {
            const s = bt.sector;
            if (s.red < 15) continue;
            for (const u of bt.units) {
                if (!u.alive) continue;
                u.fireT -= dt;
                if (u.fireT > 0) continue;
                u.fireT = rand(11, 19);
                u.firingT = war.time; // a gun firing gives its position away
                const d = u.pos.distanceTo(cam);
                if (d < VIS_R + 4000) {
                    const fx = g.effects;
                    const muzzle = _v.copy(u.pos).addScaledVector(s.normal, -4).setY(u.pos.y + 5);
                    fx.sprite(fx.flashTex, muzzle, 11, 0.16, 1.2, 1, [1, 0.85, 0.6]);
                    if (d < 6000) for (let i = 0; i < 5; i++) fx.smoke.emit(muzzle, _v2.set(rand(-3, 3), rand(2, 6), rand(-3, 3)), rand(3, 6), 3, 12, [0.6, 0.58, 0.55], [0.7, 0.68, 0.66], 0.5, 0, 1.2, 1);
                    if (d < 9000 && g.audio.boom) g.audio.boom(d, 0.8);
                    // the shell lands on our side of this sector a few seconds later
                    const p = this.randomFrontPoint(s, -1, 200, 1400);
                    if (p) this.pending.push({ at: p.clone(), t: war.time + rand(4, 8), size: rand(0.55, 0.85) });
                }
            }
        }
    }

    // a random point near this sector's line: side +1 red / −1 blue, at a depth from the line
    randomFrontPoint(s, side, dMin, dMax, near = null, nearR = Infinity) {
        const pts = this.pts;
        for (let k = 0; k < 6; k++) {
            const i = s.i0 + Math.floor(Math.random() * Math.max(1, s.i1 - s.i0));
            const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
            const t = Math.random();
            const x0 = lerp(a.x, b.x, t), z0 = lerp(a.z, b.z, t);
            const nx = lerp(a.nx, b.nx, t), nz = lerp(a.nz, b.nz, t);
            const d = rand(dMin, dMax) * side;
            const x = x0 + nx * d, z = z0 + nz * d;
            if (near && Math.hypot(x - near.x, z - near.z) > nearR) continue;
            if (terrainHeight(x, z) < 1) continue;
            return _v3.set(x, groundHeight(x, z), z);
        }
        return null;
    }

    // ═════════════ Near the camera: what the fighting looks like ═════════════
    effectsNear(dt) {
        const g = this.game, war = g.war, fx = g.effects, cam = g.camera.position;
        if (!fx || !fx.smoke) return;
        // shells in the air from earlier
        for (let i = this.pending.length - 1; i >= 0; i--) {
            const p = this.pending[i];
            if (war.time < p.t) continue;
            this.pending.splice(i, 1);
            this.impact(p.at, p.size);
        }
        // which sectors are close enough to see
        let heat = 0;
        const vis = this._vis || (this._vis = []);
        vis.length = 0;
        for (const s of this.sectors) {
            const near = this.nearestPointDist(s, cam);
            if (near > VIS_R) continue;
            vis.push(s);
            heat += s.intensity * (1 - near / VIS_R * 0.6);
        }
        if (!vis.length) return;
        const sPick = () => { let r = Math.random() * vis.reduce((a, s) => a + s.intensity, 0); for (const s of vis) { r -= s.intensity; if (r <= 0) return s; } return vis[0]; };
        // shell impacts on both sides of the line
        this.fxAcc += dt * heat * 0.9;
        while (this.fxAcc > 1) {
            this.fxAcc -= 1;
            const s = sPick();
            const redShoots = Math.random() < s.red * s.redFirepower / (s.red * s.redFirepower + s.blue);
            const p = this.randomFrontPoint(s, redShoots ? -1 : 1, 100, 1500, cam, VIS_R);
            if (p) this.impact(p, rand(0.45, 0.8));
        }
        // muzzle flashes of the guns further back (blue's are abstract; red's real batteries flash on their own)
        this.flashAcc += dt * heat * 0.8;
        while (this.flashAcc > 1) {
            this.flashAcc -= 1;
            const s = sPick();
            const side = Math.random() < 0.6 ? -1 : 1;
            const p = this.randomFrontPoint(s, side, 2500, 6000, cam, VIS_R + 3000);
            if (!p) continue;
            p.y += 3;
            fx.sprite(fx.flashTex, p, 9, 0.12, 1.5, 0.9, [1, 0.85, 0.6]);
            const d = p.distanceTo(cam);
            if (d < 7000) fx.smoke.emit(p, _v2.set(0, 3, 0), rand(2, 4), 3, 10, [0.6, 0.58, 0.55], [0.7, 0.68, 0.66], 0.4, 0, 1, 1);
        }
        // tracer arcing across the line close by
        this.tracerAcc += dt * heat * 0.7;
        while (this.tracerAcc > 1) {
            this.tracerAcc -= 1;
            const s = sPick();
            const red = Math.random() < 0.5;
            const from = this.randomFrontPoint(s, red ? 1 : -1, 150, 500, cam, 5000);
            if (from) this.tracerBurst(from, s.normal, red ? -1 : 1, red);
        }
        // burning wrecks: a few smoke columns per sector in view
        for (let i = this.fires.length - 1; i >= 0; i--) if (war.time > this.fires[i].until) this.fires.splice(i, 1);
        for (const s of vis) {
            const want = Math.round(0.6 + s.intensity * 2.2);
            let have = 0;
            for (const f of this.fires) if (f.sector === s) have++;
            if (have >= want || this.fires.length >= 7 || Math.random() > dt * 0.5) continue;
            const p = this.randomFrontPoint(s, Math.random() < 0.5 ? 1 : -1, 50, 900, cam, VIS_R);
            if (!p) continue;
            const life = rand(70, 120);
            fx.smokeColumn(p, rand(0.5, 1.1), life);
            this.fires.push({ sector: s, pos: p.clone(), until: war.time + life });
        }
        // flames at the foot of the fires that are close
        this.flameT = (this.flameT || 0) - dt;
        if (this.flameT <= 0) {
            this.flameT = 0.2;
            for (const f of this.fires) if (f.pos.distanceToSquared(cam) < 4000 * 4000 && Math.random() < 0.5) fx.puffFire(_v2.copy(f.pos).add(_v.set(rand(-3, 3), 0.5, rand(-3, 3))), _v.set(0, rand(4, 7), 0), rand(2.5, 4.5), 0.6);
        }
    }

    nearestPointDist(s, pos) {
        let bd = Infinity;
        for (let i = s.i0; i <= s.i1; i++) { const p = this.pts[i]; const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2; if (d < bd) bd = d; }
        return Math.sqrt(bd);
    }

    // a shell lands: close ones get the full explosion, far ones a flash and a puff; the sound arrives late
    impact(p, size) {
        const g = this.game, fx = g.effects, cam = g.camera.position;
        const d = p.distanceTo(cam);
        if (d < 7000) fx.explosion(_v2.copy(p).setY(p.y + 1), size);
        else {
            fx.sprite(fx.flashTex, _v2.copy(p).setY(p.y + 4), 22, 0.18, 0.8, 1, [1, 0.8, 0.55]);
            for (let i = 0; i < 4; i++) fx.smoke.emit(p, _v.set(rand(-4, 4), rand(8, 16), rand(-4, 4)), rand(3, 6), 6, 24, [0.35, 0.32, 0.28], [0.5, 0.47, 0.42], 0.6, 0, 1.2, 1);
        }
        if (g.world.timeKey === 'night' && d < 4000) fx.light(p, 30 * size, 0.3);
        if (g.audio && g.audio.boom && d < 14000) g.audio.boom(d, size * (d < 3000 ? 1 : 1.3));
    }

    // a few rounds of tracer from a point toward the other side of the line
    tracerBurst(from, normal, dir, red) {
        const w = this.game.weapons;
        if (!w || !w.newBullet) return;
        const n = 3 + Math.floor(Math.random() * 4);
        const ax = normal.x * dir, az = normal.z * dir;
        const side = rand(-0.35, 0.35), up = rand(0.02, 0.12);
        for (let i = 0; i < n; i++) {
            const vx = ax + -normal.z * side + rand(-0.03, 0.03), vz = az + normal.x * side + rand(-0.03, 0.03);
            const L = Math.hypot(vx, vz) || 1;
            _v.set(from.x, from.y + 2, from.z).addScaledVector(_v2.set(vx / L, 0, vz / L), i * 18);
            _v2.set(vx / L, up + rand(-0.02, 0.02), vz / L).normalize().multiplyScalar(850);
            w.newBullet(_v, _v2, FRONT_FIRE, 0, rand(1.1, 1.5), true, red ? TRACER_RED : TRACER_BLUE);
        }
    }

    // ═════════════ Engagement zones: real ground units where the player is ═════════════
    manageZones() {
        const g = this.game;
        if (!g.ground || !g.ground.addTarget) return;
        const focus = this.focus();
        // drop the ones the player has left behind
        for (let i = this.zones.length - 1; i >= 0; i--) {
            const z = this.zones[i];
            if (z.center.distanceTo(_v.set(focus.x, z.center.y, focus.z)) > ZONE_DROP) { this.dropZone(z); this.zones.splice(i, 1); }
        }
        if (this.zones.length >= 2) return;
        // the nearest sectors within reach get one (hotter sectors first)
        const cands = [];
        for (const s of this.sectors) {
            if (this.zones.some(z => z.sector === s)) continue;
            if (s.noZoneT != null && g.war.time - s.noZoneT < 30) continue; // (no ground for a fight there just now)
            const d = this.nearestPointDist(s, focus);
            if (d < ZONE_R) cands.push({ s, d: d - s.intensity * 3000 });
        }
        cands.sort((a, b) => a.d - b.d);
        if (cands.length) this.makeZone(cands[0].s, focus);
    }

    makeZone(s, focus) {
        const g = this.game, war = g.war, diff = g.difficulty || { skill: 0.6 };
        // on the front in this sector, nearest the player, where the ground allows a fight
        let best = null, bd = Infinity;
        for (let i = s.i0; i <= s.i1; i++) {
            const p = this.pts[i];
            const d = Math.hypot(p.x - focus.x, p.z - focus.z);
            if (d < bd && this.goodGround(p.x, p.z, 7) && this.goodGround(p.x + p.nx * 500, p.z + p.nz * 500, 9) && this.goodGround(p.x - p.nx * 500, p.z - p.nz * 500, 9)) { bd = d; best = i; }
        }
        if (best === null) { s.noZoneT = war.time; return null; }
        const p = this.pts[best];
        const zone = { sector: s, idx: best, center: new THREE.Vector3(p.x, groundHeight(p.x, p.z), p.z), units: [], slots: [], fireT: 2, reinfT: 30 };
        const nRed = 4 + Math.round(diff.skill * 2), nBlue = 4;
        const redTypes = ['tank', 'tank', 'spaag', 'tank', 'truck', 'tank'], blueTypes = ['tank', 'humvee', 'tank', 'truck', 'tank'];
        for (let k = 0; k < nRed; k++) zone.slots.push({ team: 'red', type: redTypes[k % redTypes.length], along: (k - (nRed - 1) / 2) * 210 + rand(-50, 50), depth: rand(280, 700), unit: null });
        for (let k = 0; k < nBlue; k++) zone.slots.push({ team: 'blue', type: blueTypes[k % blueTypes.length], along: (k - (nBlue - 1) / 2) * 230 + rand(-50, 50), depth: rand(280, 650), unit: null });
        for (const sl of zone.slots) this.fillSlot(zone, sl, false);
        this.zones.push(zone);
        // our troops there report what they're facing
        const reds = zone.units.filter(u => u.team === 'red');
        for (const u of reds.slice(0, 2)) war.reveal(u, INTEL.CONTACT, 'ground', true);
        if (war.time - (s.zoneCallT ?? -1e9) > 240) {
            s.zoneCallT = war.time;
            this.say(pick(['WARHORSE', 'GRIZZLY', 'BULLDOG']), 'TROOPS IN CONTACT, ' + this.sectorLabel(s) + ' — ENEMY ARMOUR AT GRID ' + war.grid(p.x + p.nx * 500, p.z + p.nz * 500), { color: '#9fd4ff', say: false });
        }
        return zone;
    }

    // where a slot sits now (it follows the line as the front moves)
    slotPos(zone, sl, out) {
        const p = this.pts[zone.idx];
        const tx = -p.nz, tz = p.nx, dir = sl.team === 'red' ? 1 : -1;
        const x = p.x + p.nx * sl.depth * dir + tx * sl.along, z = p.z + p.nz * sl.depth * dir + tz * sl.along;
        return out.set(x, groundHeight(x, z), z);
    }

    // put a unit in a slot: in place, or (reinforcements) driving up from further back
    fillSlot(zone, sl, drive) {
        const g = this.game, war = g.war;
        const at = this.slotPos(zone, sl, _v);
        const p = this.pts[zone.idx], dir = sl.team === 'red' ? 1 : -1;
        let x = at.x, z = at.z;
        if (drive) { x += p.nx * dir * rand(1500, 2200); z += p.nz * dir * rand(1500, 2200); }
        if (terrainHeight(x, z) < 1 || (!drive && !this.goodGround(x, z, 12))) {
            if (!drive) { x = at.x; z = at.z; if (terrainHeight(x, z) < 1) return null; }
            else return null;
        }
        const face = Math.atan2(p.nx * dir, p.nz * dir); // facing the enemy (−normal·dir)… (model forward is −Z)
        const u = g.ground.addTarget(sl.type, x, z, face, sl.team);
        u.name = (sl.team === 'red' ? RED_NAMES : BLUE_NAMES)[sl.type] || u.name;
        u.def = { ...u.def, name: u.name };
        u.frontZone = zone;
        u.drive = drive ? 1 : 0;
        war.add(u, { name: u.name, cls: TYPE_CLS[sl.type] || 'vehicle' });
        sl.unit = u;
        zone.units.push(u);
        return u;
    }

    // the player has left: the fight there goes back to being abstract (its vehicles and wrecks are taken away)
    dropZone(zone) {
        for (const u of zone.units) this.removeUnit(u);
        zone.units.length = 0;
    }

    removeUnit(u) {
        const g = this.game;
        const i = g.ground ? g.ground.targets.indexOf(u) : -1;
        if (i >= 0) { g.ground.targets.splice(i, 1); u.remove(); }
        u.removed = true;
    }

    // a long fight leaves a lot of wrecks: the oldest burnt-out ones are cleared away
    pruneWrecks(zone) {
        let dead = 0;
        for (const u of zone.units) if (!u.alive) dead++;
        if (dead <= 10) return;
        for (let i = 0; i < zone.units.length && dead > 10; i++) {
            const u = zone.units[i];
            if (u.alive || u.burnT > 0) continue;
            this.removeUnit(u);
            zone.units.splice(i--, 1);
            dead--;
        }
    }

    updateZones(dt) {
        const g = this.game, cam = g.camera.position;
        for (const zone of this.zones) {
            const s = zone.sector;
            const p = this.pts[zone.idx];
            zone.center.set(p.x, zone.center.y, p.z);
            // where each slot is now (the line moves slowly: twice a second is plenty)
            zone.slotT = (zone.slotT || 0) - dt;
            if (zone.slotT <= 0) {
                zone.slotT = 0.5;
                for (const sl of zone.slots) (sl.to || (sl.to = new THREE.Vector3())).copy(this.slotPos(zone, sl, _v));
            }
            // units drive to their slots (the line moves; reinforcements come up)
            for (const sl of zone.slots) {
                const u = sl.unit;
                if (!u || !u.alive || u.removed || !sl.to) continue;
                const to = sl.to;
                const dx = to.x - u.mesh.position.x, dz = to.z - u.mesh.position.z, d = Math.hypot(dx, dz);
                if (d > 8) {
                    const step = Math.min(d, (u.drive ? 7 : 3.5) * dt);
                    const x = u.mesh.position.x + dx / d * step, z = u.mesh.position.z + dz / d * step;
                    const y = groundHeight(x, z);
                    u.mesh.position.set(x, y, z);
                    u.pos.set(x, y + u.radius * 0.4, z);
                    u.mesh.rotation.y = Math.atan2(-dx, -dz);
                    u.vel.set(dx / d * step / Math.max(dt, 1e-3), 0, dz / d * step / Math.max(dt, 1e-3));
                } else if (u.drive || u.vel.lengthSq() > 0) {
                    u.drive = 0; u.vel.set(0, 0, 0);
                    const dir = sl.team === 'red' ? 1 : -1;
                    u.mesh.rotation.y = Math.atan2(p.nx * dir, p.nz * dir);
                }
            }
            // the two sides trade fire
            zone.fireT -= dt;
            if (zone.fireT <= 0) {
                zone.fireT = rand(1.6, 3.2) / (0.6 + s.intensity * 0.8);
                this.zoneShot(zone);
            }
            // reinforcements for a side that's lost vehicles here, while its sector still has the strength
            zone.reinfT -= dt;
            if (zone.reinfT <= 0) {
                zone.reinfT = rand(25, 45);
                for (const team of ['red', 'blue']) {
                    if (s[team] < 30) continue;
                    const empty = zone.slots.filter(sl => sl.team === team && (!sl.unit || !sl.unit.alive));
                    if (empty.length) this.fillSlot(zone, empty[0], true);
                }
                this.pruneWrecks(zone);
            }
        }
        void cam;
    }

    // one shot in a zone: a muzzle flash, tracer, the round landing, damage (the source is the ground war's own
    // fire, so it doesn't score for the player or count twice in the sector's strength)
    zoneShot(zone) {
        const g = this.game, fx = g.effects, cam = g.camera.position;
        const s = zone.sector;
        const reds = zone.units.filter(u => u.alive && u.team === 'red' && !u.drive), blues = zone.units.filter(u => u.alive && u.team === 'blue' && !u.drive);
        if (!reds.length || !blues.length) return;
        const redShoots = Math.random() < s.red * s.redFirepower / (s.red * s.redFirepower + s.blue);
        const shooter = pick(redShoots ? reds : blues), target = pick(redShoots ? blues : reds);
        const d = shooter.pos.distanceTo(target.pos);
        if (d > 3000) return;
        const near = shooter.pos.distanceTo(cam) < 9000;
        if (near) {
            const m = _v.copy(shooter.pos).setY(shooter.pos.y + 2);
            const dir = _v2.subVectors(target.pos, m).normalize();
            m.addScaledVector(dir, 4);
            fx.sprite(fx.flashTex, m, 5, 0.08, 1, 1, [1, 0.85, 0.6]);
            fx.smoke.emit(m, _v3.copy(dir).multiplyScalar(6), rand(1, 2), 1.5, 6, [0.5, 0.48, 0.45], [0.6, 0.58, 0.55], 0.5, 0, 1, 0.5);
            if (g.weapons && g.weapons.newBullet) g.weapons.newBullet(m, dir.multiplyScalar(1400), FRONT_FIRE, 0, d / 1400 + 0.05, true, redShoots ? TRACER_RED : TRACER_BLUE);
        }
        // the round lands (a near miss often)
        const hit = Math.random() < 0.55;
        const at = hit ? target.pos : this.nearMiss(target.pos);
        if (near || at.distanceTo(cam) < 9000) {
            if (hit) fx.explosion(_v.copy(at).setY(at.y + 1), 0.4);
            else fx.groundImpact ? fx.groundImpact(at) : null;
        }
        if (hit) target.damage(rand(8, 16), FRONT_FIRE, 'gun');
    }

    nearMiss(p) {
        const x = p.x + rand(-25, 25), z = p.z + rand(-25, 25);
        return _v3.set(x, groundHeight(x, z) + 1, z);
    }

    // ═════════════ Tactical map ═════════════
    drawMap(ctx, map) {
        if (!this.enabled || !this.sectors.length) return;
        const g = this.game, P = {}, Q = {};
        const t = performance.now() / 1000;
        ctx.save();
        // where the war started, faint
        if (this.front0) {
            ctx.beginPath();
            this.front0.forEach((p, i) => { map.toScreen(p.x, p.z, P); if (i) ctx.lineTo(P.x, P.y); else ctx.moveTo(P.x, P.y); });
            ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.setLineDash([2, 6]); ctx.stroke(); ctx.setLineDash([]);
        }
        for (const s of this.sectors) {
            const q = s.blue / (s.blue + s.red);
            // contested stretches glow
            if (s.contested) {
                ctx.beginPath();
                for (let i = s.i0; i <= s.i1; i++) { map.toScreen(this.pts[i].x, this.pts[i].z, P); if (i > s.i0) ctx.lineTo(P.x, P.y); else ctx.moveTo(P.x, P.y); }
                ctx.strokeStyle = 'rgba(255,160,60,' + (0.16 + 0.1 * Math.sin(t * 3 + s.id)) + ')';
                ctx.lineWidth = Math.max(6, 1800 * map.scale); ctx.lineCap = 'round'; ctx.stroke(); ctx.lineCap = 'butt';
            }
            // sector boundary ticks
            const a = this.pts[s.i0];
            map.toScreen(a.x - a.nx * 1500, a.z - a.nz * 1500, P); map.toScreen(a.x + a.nx * 1500, a.z + a.nz * 1500, Q);
            ctx.strokeStyle = 'rgba(232,244,255,0.35)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke();
            // push arrow: into the side that's giving ground
            if (Math.abs(s.vel) > 0.6) {
                const dir = Math.sign(s.vel), len = clamp(14 + Math.abs(s.vel) / PUSH_SPEED * 38, 14, 52);
                map.toScreen(s.center.x, s.center.z, P);
                const ang = Math.atan2(s.normal.z * dir, s.normal.x * dir);
                ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(ang);
                ctx.fillStyle = dir > 0 ? BLUE_C : RED_C; ctx.globalAlpha = 0.85;
                ctx.beginPath(); ctx.moveTo(-len * 0.35, -5); ctx.lineTo(len * 0.55, -5); ctx.lineTo(len * 0.55, -11); ctx.lineTo(len, 0); ctx.lineTo(len * 0.55, 11); ctx.lineTo(len * 0.55, 5); ctx.lineTo(-len * 0.35, 5); ctx.closePath(); ctx.fill();
                ctx.restore();
            }
            // label and strength bar, on our side of the line
            map.toScreen(s.center.x - s.normal.x * 2600, s.center.z - s.normal.z * 2600, P);
            ctx.font = '700 10px "Share Tech Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(232,244,255,0.85)';
            ctx.fillText(s.name + (s.offensive ? (s.offensive.team === 'blue' ? ' · ATTACKING' : ' · UNDER ATTACK') : ''), P.x, P.y);
            if (map.scale > 0.0035) {
                const W = 46, y = P.y + 9;
                ctx.fillStyle = 'rgba(6,12,18,0.7)'; ctx.fillRect(P.x - W / 2 - 1, y - 1, W + 2, 6);
                ctx.fillStyle = BLUE_C; ctx.fillRect(P.x - W / 2, y, W * q, 4);
                ctx.fillStyle = RED_C; ctx.fillRect(P.x - W / 2 + W * q, y, W * (1 - q), 4);
            }
        }
        // engagement zones and artillery we know about
        for (const z of this.zones) {
            map.toScreen(z.center.x, z.center.z, P);
            ctx.strokeStyle = '#ffb35a'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(P.x - 6, P.y - 6); ctx.lineTo(P.x + 6, P.y + 6); ctx.moveTo(P.x + 6, P.y - 6); ctx.lineTo(P.x - 6, P.y + 6); ctx.stroke();
        }
        ctx.restore();
        void g;
    }
}

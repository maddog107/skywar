// ═══════════════════════════════════════════════════════════════
// Underground bases (docs/WAR.md, a war plug-in): hidden mountain complexes in enemy territory.
//  • two complexes (ugsites.js): an Objekat 505 / Željava-style underground airbase with a runway on the plain, and a
//    missile operating base (Sakkanmol / "missile city" style) with launch pads above a lake. Portals in cuttings,
//    blast doors that open and close, tunnels and halls inside (ugworld.js, ugint.js) — always there; the war's life
//    (below) runs in the Living War and the Sandbox
//  • life: fighters taxi out of the mountain through the blast doors to the runway and take off — the director's
//    scramble source when the airbase is the nearest red base (scramble(types, target)); Scud TELs drive out, set up on
//    a pad, fire (a red launcher source of strikes.js) and drive back in by the other portal (shoot and scoot); doors
//    close again after use
//  • intelligence: each complex starts UNKNOWN. Clues are war units the player's eyes, the targeting pod, recon
//    aircraft and drones find through war.reveal: vehicle tracks into the hillside, warm vents on the ridge (FLIR), a
//    power line to nowhere, guard posts, a substation, antenna masts — and, decisively, a door seen opening or an
//    entrance seen. The facility goes UNKNOWN FACILITY → POSSIBLE MISSILE STORAGE (… UNDERGROUND HANGARS) →
//    CONFIRMED UNDERGROUND MISSILE FACILITY (… AIRBASE), with a TARGET IDENTIFIED callout. Intel reports put search
//    areas on the map ("activity reported in the hills NE of …")
//  • striking it: only penetrators — the hardened strike, a heavy bomber's bombs, or a bomb through an open door — can
//    destroy an entrance; anything else scars the facade. With every entrance down the complex is sealed: what's
//    inside is trapped, it launches nothing more and the director stops using it. BDA per entrance
//  • tasks: investigate reported activity, find the entrances, seal the complex, destroy the entrances before the TEL
//    fires
// API: underground.complexes, scramble(types, target, opts) → a sortie or null, scrambleOrigin(pos) → where it would come
// from (or null), surfaceAt(x, z, y) / floorAt(x, z, y) (inside the tunnels), sealed(id); events 'ugClue' (complex,
// { clue, score }), 'ugStage' (complex, { stage }), 'ugDoor' (complex, { portal, open }), 'ugScramble' (complex,
// { sortie }), 'ugTelSortie' (complex, { tel }), 'ugEntranceDestroyed' (complex, { portal, entrance }), 'ugSealed'
// (complex).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight } from './world.js';
import { INTEL } from './war.js';
import { LaunchSource, MISSILES } from './strikes.js';
import { Aircraft } from './aircraft.js';
import { Pilot } from './ai.js';
import { AIRCRAFT } from './config.js';
import { dress } from './dressing.js';
import { deployJacks, deployPad, raise, roll as rollWheels, steer as steerWheels } from './vehicles.js';
import { UG_SITES, siteToWorld, worldToSite, portalFrame, ugPaved, carveBounds, ugTunnelAt, tubeList, notchWidth, WALL_K } from './ugsites.js';
import { ComplexWorld, setTerrainCuts } from './ugworld.js';
import { interiorMaterial } from './ugint.js';
import { clamp, rand, pick, lerp } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _p = {};
const AMBER = '#ffc23f', GREEN = '#5dffa0', RED = '#ff5a4a', INTEL_COL = '#ffd24a';
const DOOR_TIME = { air: 22, tel: 14, service: 9 };   // s to open or close (Željava's 100 t doors were hydraulic)
const STAGE_AT = [0, 1, 3, 5.5];                      // clue score for CONTACT, POSSIBLE …, CONFIRMED
const CLUE_W = { vent: 1.5, tracks: 1, power: 1, guard: 1, substation: 0.75, mast: 0.75, entrance: 2 };
const AIR_TYPES = ['mig21', 'mig21', 'mig29', 'mig29', 'mig29', 'su35', 'su35', 'j10'];
const DIRS = ['NORTH', 'NORTH-EAST', 'EAST', 'SOUTH-EAST', 'SOUTH', 'SOUTH-WEST', 'WEST', 'NORTH-WEST'];
const compass = (dx, dz) => DIRS[Math.round((((Math.atan2(dx, -dz) * 180 / Math.PI) + 360) % 360) / 45) % 8];
const km = (m) => (m / 1000).toFixed(1) + ' KM';

// ═════════════ The complex's war units ═════════════
// Duck-typed like every war unit (docs/WAR.md): pos, team, alive, name, radius, damage(). Entrances and clues aren't
// ground targets, so guns, rockets and ordinary bombs don't reach them: blasts are handled here (blast()).
class UgUnit {
    constructor(cx, o) {
        this.cx = cx; this.game = cx.game; this.ug = true;
        this.kind = o.kind; this.cls = o.cls; this.name = o.name; this.type = o.kind;
        this.team = 'red'; this.alive = true; this.isGround = true;
        this.pos = o.pos.clone(); this.radius = this.hitRadius = o.radius;
        this.conceal = o.conceal ?? 0.5; this.hardened = o.hardened ?? 0.8;
        this.hp = this.maxHp = o.hp ?? 400;
        this.def = { name: o.name, score: o.score ?? 150 };
        this.contactName = o.contactName;
        this.heat = o.heat ?? null;          // sensors.js heatOf: a vent's warm air in the FLIR
        this.hotSpot = o.hotSpot || null;
        this.clue = o.clue ?? null;          // what finding it tells us (CLUE_W)
    }
    damage(amount, source, kind) { this.cx.unitHit(this, amount, source, kind); }
    // strikes.js reportBDA: "ENTRANCE 2 OF 3 DESTROYED"
    bdaResult() { return this.kind === 'entrance' || this.kind === 'facility' ? this.cx.bdaFor(this) : null; }
    // strikes.js impact: the doorway and the facade are what a missile has to hit
    hitTest(p) { return this.kind === 'entrance' ? this.cx.sys.portalDist(this, p) < 3 : false; }
}

// ═════════════ A complex ═════════════
export class Complex {
    constructor(sys, site) {
        this.sys = sys; this.game = sys.game; this.site = site;
        this.id = site.id; this.kind = site.kind;
        // (headless — tests, or a world without a renderer — the complex runs without its meshes)
        this.world = sys.game.world && sys.game.world.terrainMat ? new ComplexWorld(sys.game, site) : nullWorld();
        const c = this.center = new THREE.Vector3();
        // the middle of the halls (where the facility is)
        let n = 0;
        for (const T of tubeList()) if (T.site === site) for (const q of T.samples) if (q.w > 12) { c.x += q.x; c.y += q.y; c.z += q.z; n++; }
        if (n) c.divideScalar(n); else { const w = siteToWorld(site, 0, 0); c.set(w.x, 0, w.z); }
        c.y += 8;
        this.doors = site.portals.map(p => ({ p, k: 0, want: 0, users: new Set(), holdT: 0, moving: false, jammed: false }));
        this.reset();
    }

    reset() {
        this.active = false;
        this.units = [];
        this.entrances = [];
        this.clues = [];
        this.facility = null;
        this.airfield = null;
        this.score = 0;
        this.stage = 0;
        this.found = new Set();
        this.reports = [];
        this.sealed = false;
        this.sorties = [];
        this.tels = [];
        this.launchers = [];
        this.parked = [];
        this.scars = 0;
        this.alarmT = 0;
        for (const d of this.doors) { d.k = 0; d.want = 0; d.users.clear(); d.jammed = false; this.world.setDoor(d.p.id, 0); }
        this.world.setRuined && this.site.portals.forEach(p => this.world.setRuined(p.id, false));
    }

    // ── the war starts: the complex's units, its aircraft or launchers ──
    start() {
        const g = this.game, war = g.war, site = this.site;
        this.reset();
        this.active = true;
        const L = site.label;
        this.facility = this.add(new UgUnit(this, { kind: 'facility', cls: 'facility', name: L.confirmed, contactName: L.unknown, pos: this.center, radius: 60, conceal: 1, hardened: 1, hp: 1e9, score: 2000 }));
        for (const p of site.portals) {
            const F = portalFrame(site, p);
            const e = this.add(new UgUnit(this, {
                kind: 'entrance', cls: 'entrance', name: 'TUNNEL ENTRANCE ' + p.id + (p.kind === 'air' ? ' (AIRCRAFT)' : p.kind === 'tel' ? ' (VEHICLE)' : ''),
                contactName: 'UNKNOWN STRUCTURE', pos: new THREE.Vector3(F.x, p.floor + p.face[1] * 0.45, F.z), radius: p.face[0] / 2,
                conceal: 0.72, hardened: 0.95, hp: 1000, score: 800, clue: 'entrance',
            }));
            e.portal = p; e.F = F;
            this.entrances.push(e);
        }
        this.makeClues();
        if (site.runway) {
            const r = site.runway, w = siteToWorld(site, r.u, r.v);
            this.airfield = this.add(new UgUnit(this, { kind: 'airfield', cls: 'airbase', name: site.name + ' AIRFIELD (NO SHELTERS SEEN)', contactName: 'AIRFIELD', pos: new THREE.Vector3(w.x, r.y, w.z), radius: 400, conceal: 0, hardened: 0.4, hp: 1e9 }));
        }
        for (const u of this.units) {
            const known = u === this.airfield ? INTEL.IDENTIFIED : INTEL.UNKNOWN;
            war.add(u, { cls: u.cls, name: u.name, contactName: u.contactName, conceal: u.conceal, hardened: u.hardened, known });
        }
        if (site.kind === 'air') this.sys.placeParked(this);
        if (site.kind === 'missile') this.sys.stockTels(this);
    }

    add(u) { this.units.push(u); return u; }

    // the clue units: what an analyst would look for (FAS / DIA indicators of underground facilities)
    makeClues() {
        const site = this.site, P = site.props || {};
        const at = (q, lift = 0) => { const w = siteToWorld(site, q[0], q[1]); return new THREE.Vector3(w.x, terrainHeight(w.x, w.z) + lift, w.z); };
        const clue = (o) => { const u = this.add(new UgUnit(this, o)); this.clues.push(u); return u; };
        (P.vents || []).forEach((q, i) => clue({ kind: 'vent', cls: 'bunker', clue: 'vent', name: 'VENTILATION SHAFT ' + (i + 1) + ' (WARM AIR)', contactName: 'UNKNOWN STRUCTURE', pos: at(q, 2.5), radius: 6, conceal: 0.93, hardened: 0.9, hp: 700, heat: 0.85, score: 150 }));
        (P.guards || []).forEach((q, i) => clue({ kind: 'guard', cls: 'bunker', clue: 'guard', name: 'GUARD POST ' + (i + 1), contactName: 'UNKNOWN STRUCTURE', pos: at(q, 1.5), radius: 5, conceal: 0.35, hardened: 0.2, hp: 120, score: 60 }));
        (P.masts || []).forEach((q, i) => clue({ kind: 'mast', cls: 'radar', clue: 'mast', name: 'RELAY ANTENNA MAST ' + (i + 1), contactName: 'UNKNOWN INSTALLATION', pos: at(q, 12), radius: 7, conceal: 0.45, hardened: 0.1, hp: 90, score: 80 }));
        if (P.substation) clue({ kind: 'substation', cls: 'bunker', clue: 'substation', name: 'ELECTRICAL SUBSTATION', contactName: 'UNKNOWN STRUCTURE', pos: at(P.substation, 2), radius: 9, conceal: 0.3, hardened: 0.2, hp: 200, score: 120, heat: 0.3 });
        if (P.power && P.power.length > 2) {
            const q = P.power[P.power.length - 3];
            clue({ kind: 'power', cls: 'bunker', clue: 'power', name: 'POWER LINE INTO THE HILLSIDE', contactName: 'UNKNOWN STRUCTURE', pos: at(q, 6), radius: 8, conceal: 0.45, hardened: 0.1, hp: 60, score: 40 });
        }
        (P.tracks || []).forEach((tr, i) => {
            const q = tr[Math.floor(tr.length / 2)];
            clue({ kind: 'tracks', cls: 'vehicle', clue: 'tracks', name: 'HEAVY VEHICLE TRACKS ' + (i + 1), contactName: 'VEHICLE TRACKS', pos: at(q, 0.5), radius: 6, conceal: 0.2, hardened: 0, hp: 1e9, score: 0 });
        });
    }

    // ═════════════ Intel ═════════════
    // a clue unit was spotted (CONTACT) or identified by anyone (eyes, pod, recon, drones)
    onSeen(u, level) {
        if (!this.active || this.found.has(u)) return;
        if (u.kind === 'entrance') {
            this.found.add(u);
            this.addScore(level >= INTEL.IDENTIFIED ? 3 : CLUE_W.entrance, u, level >= INTEL.IDENTIFIED);
            return;
        }
        if (!u.clue || level < INTEL.CONTACT) return;
        // a contact is enough for tracks, a mast or a guard post; a vent is only a clue once the pod has seen its heat
        if (u.kind === 'vent' && level < INTEL.IDENTIFIED) return;
        this.found.add(u);
        this.addScore(CLUE_W[u.clue] || 1, u, false);
    }

    addScore(w, u, decisive) {
        const war = this.game.war;
        this.score += w;
        this.game.events.emit('ugClue', this, { clue: u, score: this.score });
        const was = this.stage;
        let st = 0;
        for (let i = 1; i < STAGE_AT.length; i++) if (this.score >= STAGE_AT[i]) st = i;
        if (decisive) st = 3;
        if (st <= was) {
            if (u && u.kind !== 'entrance') this.say('INTEL', 'CLUE: ' + this.clueText(u) + ' — ' + this.facilityLabel(), { color: INTEL_COL, ttl: 20 });
            return;
        }
        this.stage = st;
        const rec = war.rec(this.facility);
        if (!rec) return;
        const L = this.site.label;
        if (st >= 1 && rec.known < INTEL.CONTACT) war.reveal(this.facility, INTEL.CONTACT, 'intel', true);
        if (st === 2) rec.contactName = L.possible;
        if (st >= 3) {
            rec.name = L.confirmed; this.facility.name = L.confirmed;
            war.reveal(this.facility, INTEL.IDENTIFIED, 'intel');
            this.identified();
        } else {
            const why = u ? this.clueText(u) : 'NEW INTELLIGENCE';
            this.say('INTEL', 'INTEL UPDATE: ' + why + ' — ' + (st === 2 ? L.possible : L.unknown) + ' AT GRID ' + war.grid(this.center.x, this.center.z), { color: INTEL_COL, priority: st === 2 });
            this.sys.toast = { title: st === 2 ? L.possible : L.unknown, sub: 'CLUES ' + this.score.toFixed(1) + ' · GRID ' + war.grid(this.center.x, this.center.z), t: this.game.time, color: INTEL_COL };
        }
        this.game.events.emit('ugStage', this, { stage: st });
    }

    clueText(u) {
        switch (u.kind) {
            case 'vent': return 'HOT AIR FROM A VENT ON THE RIDGE';
            case 'tracks': return 'HEAVY VEHICLE TRACKS LEADING INTO THE HILLSIDE';
            case 'power': return 'A POWER LINE RUNNING INTO THE MOUNTAIN';
            case 'guard': return 'A GUARD POST ON A ROAD TO NOWHERE';
            case 'substation': return 'A SUBSTATION WITH NOTHING TO FEED';
            case 'mast': return 'RELAY ANTENNAS ON THE RIDGE';
            case 'entrance': return 'A TUNNEL ENTRANCE';
            case 'door': return 'A BLAST DOOR SEEN OPENING';
            case 'emerge': return 'VEHICLES COMING OUT OF THE MOUNTAIN';
            default: return 'ACTIVITY';
        }
    }

    facilityLabel() { const war = this.game.war; return this.facility ? war.label(this.facility) : this.site.label.unknown; }

    // TARGET IDENTIFIED: the callout, the radio, penetrators for the job
    identified() {
        const g = this.game, war = g.war;
        this.sys.callout = { title: 'TARGET IDENTIFIED', sub: this.site.label.confirmed, grid: war.grid(this.center.x, this.center.z), t: g.time };
        g.audio && g.audio.uiConfirm && g.audio.uiConfirm();
        this.say('COMMAND', 'TARGET IDENTIFIED — ' + this.site.label.confirmed + ' AT GRID ' + war.grid(this.center.x, this.center.z) + '. FIND THE ENTRANCES: ONLY PENETRATORS WILL CLOSE THEM', { color: '#ff9f5a', say: 'Target identified. ' + this.site.label.confirmed.toLowerCase() + '.', priority: true });
        for (const rp of this.reports) if (!rp.resolved) war.resolveReport(rp);
        // command releases hardened-target weapons for it
        const st = g.strikes;
        const silo = st && st.silo;
        if (silo && !this.allocated) {
            this.allocated = true;
            silo.stock.penetrator = (silo.stock.penetrator || 0) + this.entrances.length * 2;
            this.say('COMMAND', silo.name.split(' (')[0] + ' HAS ' + silo.stock.penetrator + ' ATACMS PENETRATORS FOR IT — MARK AN ENTRANCE, THEN COMMAND › STRIKE › HARDENED TARGET STRIKE', { color: '#9fd4ff', say: false });
        }
    }

    // A search area: "activity reported in the hills NE of …"
    report(what, radius = 3500, off = 0.45) {
        const g = this.game, war = g.war, c = this.center;
        if (this.stage >= 3 || this.sealed) return null;
        const a = rand(0, Math.PI * 2), r = rand(0.15, off) * radius;
        const center = new THREE.Vector3(c.x + Math.cos(a) * r, 0, c.z + Math.sin(a) * r);
        const rp = war.report({ text: what + ' ' + this.where(center), center, radius, unit: this.facility, cls: 'facility', say: false });
        rp.ug = this;
        this.reports.push(rp);
        return rp;
    }

    // "IN THE HILLS 14 KM NORTH-EAST OF VORSK" (the nearest named town), else the grid
    where(pos) {
        const towns = this.game.world.towns ? this.game.world.towns.towns : [];
        let best = null, bd = Infinity;
        for (const t of towns) { if (!t.mapName) continue; const d = Math.hypot(t.x - pos.x, t.z - pos.z); if (d < bd) { bd = d; best = t; } }
        if (!best) return 'NEAR GRID ' + this.game.war.grid(pos.x, pos.z);
        return 'IN THE HILLS ' + Math.round(bd / 1000) + ' KM ' + compass(pos.x - best.x, pos.z - best.z) + ' OF ' + best.mapName.toUpperCase();
    }

    say(from, text, opts = {}) {
        const d = this.game.director;
        if (d && d.enabled && d.say) d.say(from, text, opts); else this.game.war.radio(from, text, opts);
    }

    // ═════════════ Doors ═════════════
    door(pid) { return this.doors.find(d => d.p.id === pid); }
    entrance(pid) { return this.entrances.find(e => e.portal.id === pid); }
    usable(pid) { const d = this.door(pid), e = this.entrance(pid); return !!d && !d.jammed && (!e || e.alive); }

    // someone needs the door open (a jet, a TEL): it opens, and stays open while anyone needs it
    openDoor(pid, user) {
        const d = this.door(pid);
        if (!d || d.jammed) return false;
        d.users.add(user);
        if (d.want !== 1) {
            d.want = 1;
            this.doorSound(d, 1);
            this.game.events.emit('ugDoor', this, { portal: d.p, open: true });
        }
        return true;
    }
    releaseDoor(pid, user) { const d = this.door(pid); if (d) { d.users.delete(user); if (!d.users.size) d.holdT = 8; } }
    doorOpen(pid) { const d = this.door(pid); return !!d && d.k > 0.97; }

    doorSound(d, dir) {
        const g = this.game, F = portalFrame(this.site, d.p);
        const dist = g.camera.position.distanceTo(_v.set(F.x, d.p.floor, F.z));
        if (dist < 900 && g.audio && g.audio.hydraulic) g.audio.hydraulic(Math.min(DOOR_TIME[d.p.kind] || 12, 5), dir, false, clamp(1.5 - dist / 600, 0.1, 1.5));
        if (dir > 0) this.alarmT = Math.max(this.alarmT, 6);
    }

    updateDoors(dt) {
        const war = this.game.war;
        for (const d of this.doors) {
            if (!d.users.size && d.want === 1 && d.k >= 1) { d.holdT -= dt; if (d.holdT <= 0) { d.want = 0; this.doorSound(d, -1); this.game.events.emit('ugDoor', this, { portal: d.p, open: false }); } }
            const T = DOOR_TIME[d.p.kind] || 12, was = d.k;
            d.k = d.want ? Math.min(1, d.k + dt / T) : Math.max(0, d.k - dt / T);
            d.moving = d.k !== was;
            if (d.moving) this.world.setDoor(d.p.id, easeDoor(d.k));
            // a moving door gives the entrance away: anyone looking sees it (war.js: firingT)
            const e = this.entrance(d.p.id);
            if (e && (d.moving || d.k > 0.3)) e.firingT = war.time;
            if (e && d.moving && war.rec(e) && war.rec(e).known >= INTEL.CONTACT && !this.sawDoor) {
                this.sawDoor = true;
                this.addScore(3, { kind: 'door' }, true);
            }
        }
        // the klaxon and beacons while a door moves
        if (this.alarmT > 0) {
            this.alarmT -= dt;
            this.klaxT = (this.klaxT || 0) - dt;
            if (this.klaxT <= 0) {
                this.klaxT = 0.55;
                const g = this.game, d = this.doors.find(q => q.want) || this.doors[0], F = portalFrame(this.site, d.p);
                const dist = g.camera.position.distanceTo(_v.set(F.x, d.p.floor, F.z));
                if (dist < 700 && g.audio) { this.klaxHi = !this.klaxHi; g.audio.tick(this.klaxHi ? 620 : 470, clamp(0.3 - dist / 2500, 0.02, 0.3), 0.35); }
            }
        }
        this.world.setBeacons && this.world.setBeacons(this.doors.map(d => d.moving || (d.want && d.k < 1)));
    }

    // ═════════════ Damage ═════════════
    // strikes.js impact() and our own blast handling call damage() on the units: only a penetrator (or a bomb through
    // an open door) can bring an entrance down; everything else scars the facade
    unitHit(u, amount, source, kind) {
        if (!u.alive || amount <= 0) return;
        if (u.kind === 'facility' || u.kind === 'tracks' || u.kind === 'airfield') return;
        if (u.kind === 'entrance') {
            if (kind === 'penetrator' || kind === 'door') {
                u.hp -= amount;
                u.lastKind = kind;
                if (u.hp <= 0) this.entranceDestroyed(u, source, kind);
                else this.world.scar && this.world.scar(u.portal.id, 1);
                return;
            }
            // (scars: the hardened portal shrugs it off)
            u.hp = Math.max(u.maxHp * 0.8, u.hp - amount * 0.02);
            u.scarred = (u.scarred || 0) + 1;
            this.world.scar && this.world.scar(u.portal.id, 0.4);
            return;
        }
        u.hp -= amount * (1 - (u.hardened || 0) * 0.5);
        if (u.hp <= 0) this.clueDestroyed(u, source);
    }

    clueDestroyed(u, source) {
        const g = this.game;
        u.alive = false; u.hp = 0;
        g.effects.explosion(u.pos, u.kind === 'vent' ? 1.4 : 1, null);
        g.events.emit('groundKilled', u, { source });
        if (u.kind === 'substation') this.say('INTEL', 'THE SUBSTATION IS DOWN — ' + this.site.name + ' IS ON ITS OWN GENERATORS NOW', { color: '#9fd4ff', say: false });
        this.world.clueDestroyed && this.world.clueDestroyed(u.kind, u.pos);
    }

    entranceDestroyed(e, source, kind) {
        const g = this.game, war = g.war;
        e.alive = false; e.hp = 0;
        const d = this.door(e.portal.id);
        d.jammed = true; d.want = 0;
        // the facade comes down over the door: rubble, dust and smoke (ugworld.js)
        const F = e.F;
        g.effects.explosion(_v.set(F.x + F.vx * 4, e.portal.floor + e.portal.face[1] * 0.5, F.z + F.vz * 4), 3, null);
        g.effects.smokeColumn(_v.set(F.x + F.vx * 10, e.portal.floor + 2, F.z + F.vz * 10), 2.2, 45);
        g.effects.debrisBurst(_v.set(F.x + F.vx * 3, e.portal.floor + 6, F.z + F.vz * 3), _v2.set(F.vx * 30, 25, F.vz * 30), 14, 2);
        this.world.setRuined && this.world.setRuined(e.portal.id, true);
        g.events.emit('groundKilled', e, { source, kind });
        const down = this.entrances.filter(x => !x.alive).length, all = this.entrances.length;
        war.reveal(e, INTEL.CONFIRMED, 'bda', true);
        g.events.emit('ugEntranceDestroyed', this, { portal: e.portal, entrance: e });
        // whatever needed that door is stuck behind it
        for (const s of this.sorties) if (s.portal === e.portal.id && s.state !== 'air') s.blocked = true;
        for (const t of this.tels) if (t.inside && t.exit === e.portal.id) t.exitBlocked = true;
        if (down >= all) this.seal(source);
        else this.say('COMMAND', 'ENTRANCE ' + down + ' OF ' + all + ' DESTROYED — ' + e.portal.id + ' AT ' + this.site.name + ' IS BLOCKED', { color: GREEN, say: 'Entrance ' + down + ' of ' + all + ' destroyed.' });
    }

    // every way in or out is gone: the complex is sealed with whatever is inside
    seal(source) {
        const g = this.game;
        if (this.sealed) return;
        this.sealed = true;
        this.facility.alive = false;
        const planes = this.parked.filter(q => q.unit.alive).length + this.sorties.reduce((n, s) => n + s.jets.filter(j => !j.airborne && j.alive && j.unit.ugInside).length, 0);
        const tels = this.tels.filter(t => t.inside && t.unit.alive).length;
        for (const t of this.tels) if (t.inside) { t.trapped = true; t.src.queue.length = 0; }
        for (const s of this.sorties) if (s.state !== 'air') s.trapped = true;
        const what = [planes ? planes + ' AIRCRAFT' : null, tels ? tels + ' LAUNCHER' + (tels > 1 ? 'S' : '') : null].filter(Boolean).join(' AND ');
        this.say('COMMAND', 'ALL ENTRANCES DESTROYED — ' + this.site.name + ' IS SEALED' + (what ? '. ' + what + ' TRAPPED INSIDE' : ''), { color: GREEN, say: 'All entrances destroyed. The complex is sealed.', priority: true });
        this.sys.callout = { title: 'COMPLEX SEALED', sub: this.site.label.confirmed, grid: g.war.grid(this.center.x, this.center.z), t: g.time, color: GREEN };
        g.score = (g.score || 0) + 1500;
        g.events.emit('groundKilled', this.facility, { source });
        g.events.emit('ugSealed', this);
    }

    // BDA text for an entrance or the facility (strikes.js reportBDA asks for it)
    bdaFor(u) {
        const down = this.entrances.filter(x => !x.alive).length, all = this.entrances.length;
        if (u === this.facility) return this.sealed ? 'ALL ' + all + ' ENTRANCES DESTROYED — COMPLEX SEALED' : down + ' OF ' + all + ' ENTRANCES DESTROYED — STILL OPERATIONAL';
        if (!u.alive) return 'ENTRANCE ' + down + ' OF ' + all + ' DESTROYED' + (this.sealed ? ' — COMPLEX SEALED' : '');
        if (u.scarred) return 'ENTRANCE HIT — FACADE SCARRED, DOOR INTACT (PENETRATOR REQUIRED)';
        return null;
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        this.updateDoors(dt);
        if (!this.active) return;
        // what's inside the mountain: drawn with the interior, and off the HUD unless we're in there too
        const vis = this.world.interior.visible, me = this.world.inside;
        const hide = (t) => { if (!t || !t.alive) return; t.hidden = !!t.ugInside && !me; if (t.mesh) t.mesh.visible = !t.ugInside || vis; };
        for (const q of this.parked) hide(q.unit);
        for (const s of this.sorties) for (const j of s.jets) if (!j.airborne) hide(j.unit);
        for (const t of this.tels) { t.unit.ugInside = t.inside; hide(t.unit); }
        for (const s of this.sorties) this.sys.updateSortie(this, s, dt);
        this.sorties = this.sorties.filter(s => !s.done);
        for (const t of this.tels) this.sys.updateTel(this, t, dt);
    }
}

// doors ease in and out (hydraulic)
const easeDoor = (k) => k * k * (3 - 2 * k);

// a complex's world without meshes (headless)
function nullWorld() {
    const doors = {};
    return {
        patches: [], interior: { visible: false, add() {} }, inside: false, doors,
        setDoor(pid, k) { doors[pid] = k; }, update() {}, setRuined() {}, setBeacons() {}, scar() {}, clueDestroyed() {},
    };
}

// ═════════════ The system ═════════════
export class Underground {
    constructor(game) {
        this.game = game;
        this.complexes = [];
        this.built = false;
        this.enabled = false;
        this.callout = null;
        this.toast = null;
        const ev = game.events;
        const on = (k, fn) => ev.on(k, (a, b) => { if (this.enabled) { try { fn(a, b || {}); } catch (e) { console.warn('[underground]', e); } } });
        on('warContact', (u) => { if (u && u.ug) u.cx.onSeen(u, INTEL.CONTACT); });
        on('warIdentified', (u) => { if (u && u.ug) u.cx.onSeen(u, INTEL.IDENTIFIED); });
        on('strategicImpact', (m, { at }) => this.impact(m, at));
        on('blast', (at, o) => this.blast(at, o));
        on('flightDone', (f, { why }) => { if (f.ugHome && why === 'landed' && !f.ugHome.sealed) f.ugHome.returned = (f.ugHome.returned || 0) + f.n; });
    }

    // the static world is built once (every mode shows the complexes, closed and quiet outside the war)
    build() {
        if (this.built) return;
        this.built = true;
        const g = this.game;
        for (const site of UG_SITES) this.complexes.push(new Complex(this, site));
        setTerrainCuts(this.complexes.flatMap(c => c.world.patches));
        // no trees or grass on the paving and in the cuttings (the tiles already planted there are replanted)
        const w = g.world, prev = w.blockTree;
        w.blockTree = (x, z) => (prev ? prev(x, z) : false) || ugPaved(x, z, 6);
        const prevG = w.noGrass;
        w.noGrass = (x, z) => (prevG ? prevG(x, z) : false) || ugPaved(x, z, 2);
        for (const b of carveBounds()) {
            const T = w.TILE;
            for (const [key, t] of w.tiles || []) {
                const [tx, tz] = key.split(',').map(Number);
                if (b.bb[2] < tx * T || b.bb[0] > (tx + 1) * T || b.bb[3] < tz * T || b.bb[1] > (tz + 1) * T) continue;
                t.treesDone = false;
            }
        }
    }

    complex(id) { return this.complexes.find(c => c.id === id) || null; }
    sealed(id) { const c = this.complex(id); return !!c && c.sealed; }

    start(mode) {
        this.build();
        this.clear();
        this.mode = mode;
        this.enabled = mode === 'war' || mode === 'sandbox';
        if (!this.enabled) return;
        for (const c of this.complexes) c.start();
        // intelligence: the first report comes in after a few minutes; later ones when the complexes give themselves away
        this.reportT = rand(80, 160);
        this.launchT = rand(360, 520);
        this.telT = 0;
        if (this.game.tasks && !this.tasksHooked) { this.tasksHooked = true; this.hookTasks(this.game.tasks); }
    }

    clear() {
        for (const c of this.complexes) {
            for (const s of c.sorties) this.dropSortie(c, s);
            for (const t of c.tels) this.dropTel(c, t);
            for (const p of c.parked) this.removeTarget(p.unit);
            if (this.game.strikes) for (const L of c.launchers) this.game.strikes.removeSource(L);
            c.reset();
        }
        this.enabled = false;
        this.callout = null; this.toast = null;
    }

    update(dt) {
        if (!this.built) return;
        const g = this.game;
        for (const c of this.complexes) { c.world.update(dt); c.update(dt); }
        if (!this.enabled || !g.war.enabled) return;
        this.checkPlayerInTunnel();
        // the first intelligence report: a complex's activity has been noticed
        this.reportT -= dt;
        if (this.reportT <= 0) {
            this.reportT = rand(500, 800);
            const open = this.complexes.filter(c => c.stage < 3 && !c.sealed && !c.reports.some(r => !r.resolved));
            if (open.length) {
                const c = pick(open);
                const what = c.kind === 'air' ? 'AIRCRAFT MOVEMENTS WITH NO KNOWN AIRFIELD SHELTERS —' : 'HEAVY VEHICLE ACTIVITY REPORTED';
                const rp = c.report(what, 3500);
                if (rp) this.say(c, 'COMMAND', 'INTELLIGENCE REPORT: ' + rp.text + ' — SEARCH AREA ' + g.war.grid(rp.center.x, rp.center.z), { color: INTEL_COL, say: 'Intelligence report. Activity in the hills. Search area on your map.' });
            }
        }
        // the missile base's own launches (shoot and scoot) through strikes.js
        this.launchT -= dt;
        if (this.launchT <= 0) {
            this.launchT = rand(420, 640) / ((g.difficulty || { skill: 0.6 }).skill * 0.8 + 0.55);
            this.missileSortie();
        }
    }

    say(c, from, text, opts) { c.say(from, text, opts); }

    // ═════════════ Scrambles (the air complex) ═════════════
    // where a scramble toward `pos` would come from: the runway of an operational underground airbase, or null
    scrambleOrigin(pos) {
        let best = null, bd = Infinity;
        for (const c of this.complexes) {
            if (!this.canScramble(c)) continue;
            const d = c.airfield.pos.distanceTo(pos);
            if (d < bd) { bd = d; best = c; }
        }
        return best ? best.airfield.pos : null;
    }

    canScramble(c) {
        return !!c && c.active && c.kind === 'air' && !c.sealed && !!c.airfield &&
            c.parked.some(q => q.unit.alive) && c.site.portals.some(p => p.kind === 'air' && c.usable(p.id)) &&
            !c.sorties.some(s => s.state !== 'air' && !s.done);
    }

    // Fighters taxi out of the mountain and take off, then fly `opts.role` (intercept) toward `target` as a director
    // flight. types: what's wanted (the hangar's own aircraft are used, those types first). → the sortie, or null
    scramble(types = [], target = null, opts = {}) {
        const g = this.game, P = target ? (target.pos || target) : g.camera.position;
        const c = opts.complex ? this.complex(opts.complex) : this.complexes.filter(x => this.canScramble(x)).sort((a, b) => a.airfield.pos.distanceTo(P) - b.airfield.pos.distanceTo(P))[0];
        if (!c || !this.canScramble(c)) return null;
        c.parked = c.parked.filter(q => q.unit.alive);
        const n = Math.min(Math.max(types.length, 1), 2, c.parked.length);
        // the hangar's aircraft: of the wanted types if it has them, nearest the exit first
        const portals = c.site.portals.filter(p => p.kind === 'air' && c.usable(p.id));
        const pick2 = [];
        for (let i = 0; i < n; i++) {
            let k = c.parked.findIndex(q => !pick2.includes(q) && types.includes(q.type));
            if (k < 0) k = c.parked.findIndex(q => !pick2.includes(q));
            pick2.push(c.parked[k]);
        }
        const portal = portals[0];
        const s = { c, portal: portal.id, jets: [], state: 'alarm', t: 0, target: new THREE.Vector3(P.x, Math.max(P.y || 0, 2500), P.z), opts, flight: null, done: false };
        for (const q of pick2) { c.parked.splice(c.parked.indexOf(q), 1); s.jets.push(this.makeJet(c, s, q, portal)); }
        c.sorties.push(s);
        c.openDoor(portal.id, s);
        g.events.emit('ugScramble', c, { sortie: s });
        // unknown to us, a scramble from a mountainside is noticed
        if (c.stage < 3) {
            const rp = c.report('FIGHTERS SEEN SCRAMBLING', 2200, 0.35);
            if (rp) c.say('MAGIC', 'NEW CONTACTS GETTING AIRBORNE ' + rp.text.replace('FIGHTERS SEEN SCRAMBLING ', '') + ' — NO KNOWN AIRFIELD THERE', { color: '#ff9f5a' });
            c.addScore(1, { kind: 'emerge' }, false);
        }
        return s;
    }

    // a jet leaving the hangar: the parked ground target itself taxis out (every weapon can still hit it)
    makeJet(c, s, parked, portal) {
        const t = parked.unit;
        return { type: parked.type, unit: t, model: t.mesh, path: this.jetPath(c, parked, portal), i: 0, speed: 0, airborne: false, state: 'wait', yaw: parked.yaw, pos: parked.pos.clone(), pitch: 0, vel: new THREE.Vector3(), get alive() { return t.alive && !t.removed; } };
    }

    // bay → the hall's middle → the exit tunnel → out of the portal, down the cutting → the apron → the taxiway → the
    // runway's south end, lined up. Points { x, y, z, v (m/s), ins (inside: interior lighting) }
    jetPath(c, parked, portal) {
        const site = c.site, path = [];
        const T = tubeList().find(t => t.site === site && t.tube.ends.includes(portal.id));
        const S = T.samples;
        // the hall sample nearest the bay, and which way the portal lies along the tube
        let bi = 0, bd = Infinity;
        S.forEach((q, i) => { const d = (q.x - parked.pos.x) ** 2 + (q.z - parked.pos.z) ** 2; if (d < bd) { bd = d; bi = i; } });
        const toEnd = T.tube.ends[1] === portal.id;
        path.push({ x: parked.pos.x, y: parked.pos.y, z: parked.pos.z, v: 3, ins: true });
        const step = toEnd ? 1 : -1;
        for (let i = bi + step * 3; toEnd ? i < S.length : i >= 0; i += step * 3) path.push({ x: S[i].x, y: S[i].y, z: S[i].z, v: S[i].w > 16 ? 9 : 7, ins: true });
        const F = portalFrame(site, portal);
        for (const v of [4, 30, 60, portal.notch]) path.push({ x: F.x + F.vx * v, y: portal.floor, z: F.z + F.vz * v, v: 8 });
        const taxi = (site.roads || []).find(r => r.kind === 'taxi');
        if (taxi) {
            // join the taxiway at its apron end
            for (const q of taxi.pts) { const w = siteToWorld(site, q[0], q[1]); path.push({ x: w.x, y: q[2], z: w.z, v: 14 }); }
        }
        // onto the runway at its south end, lined up heading north (−u)
        const r = site.runway, thr = siteToWorld(site, r.u + r.len / 2 - 60, r.v), lin = siteToWorld(site, r.u + r.len / 2 - 160, r.v);
        path.push({ x: thr.x, y: r.y, z: thr.z, v: 6 }, { x: lin.x, y: r.y, z: lin.z, v: 0, hold: true });
        return path;
    }

    updateSortie(c, s, dt) {
        const g = this.game;
        s.t += dt;
        if (s.trapped) return;
        const doorOK = c.doorOpen(s.portal) || !c.usable(s.portal);
        s.jets.forEach((j, i) => {
            if (!j.alive || j.airborne) return;
            if (j.state === 'wait') {
                // engines start with the alarm; the first rolls when the door is half open, the second 12 s behind it
                if (s.t > 6 + i * 12 && c.door(s.portal).k > 0.55) j.state = 'taxi';
                this.placeJet(j);
                return;
            }
            if (s.blocked && j.path[j.i] && j.path[j.i].ins) { j.speed = 0; this.placeJet(j); return; } // (the way out is rubble)
            if (j.state === 'taxi') this.taxiJet(c, s, j, i, dt, doorOK);
            else if (j.state === 'roll') this.rollJet(c, s, j, dt);
        });
        // the door closes behind the last one out
        if (!s.released && s.jets.every(j => !j.alive || j.airborne || j.i > j.path.findIndex(q => !q.ins) + 2)) { s.released = true; c.releaseDoor(s.portal, s); }
        if (s.jets.every(j => !j.alive || j.airborne)) {
            if (!s.released) { s.released = true; c.releaseDoor(s.portal, s); }
            s.state = 'air';
            s.done = true;
        }
    }

    // along the path at taxi speeds, keeping behind the one in front
    taxiJet(c, s, j, i, dt, doorOK) {
        const P = j.path;
        const q = P[j.i];
        if (!q) { j.state = 'roll'; return; }
        let want = q.v;
        const ahead = s.jets[i - 1];
        if (ahead && ahead.alive && !ahead.airborne && ahead.pos.distanceTo(j.pos) < 45 && ahead.state !== 'roll') want = 0;
        if (ahead && ahead.alive && !ahead.airborne && ahead.state === 'roll' && ahead.speed < 60 && j.i >= P.length - 2) want = 0; // hold short while it rolls
        if (!doorOK && !q.ins && P[Math.max(0, j.i - 1)].ins) want = 0;
        const dx = q.x - j.pos.x, dz = q.z - j.pos.z, d = Math.hypot(dx, dz);
        const np = P[j.i + 1];
        if (np && !q.hold && d < 40 && dx * (np.x - q.x) + dz * (np.z - q.z) < 0) { j.i++; return; }
        if (q.hold && d < 3) { j.state = 'roll'; j.yaw = Math.atan2(-dx || -(q.x - P[j.i - 1].x), -dz || -(q.z - P[j.i - 1].z)); return; }
        // slow for the corner ahead
        const nx = P[j.i + 1];
        if (nx && d < 40) {
            const a1 = Math.atan2(dx, dz), a2 = Math.atan2(nx.x - q.x, nx.z - q.z);
            const turn = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
            want = Math.min(want, lerp(want, 4, clamp(turn / 1.2, 0, 1)));
        }
        if (q.hold) want = Math.min(6, d * 0.4 + 1);
        j.speed += clamp(want - j.speed, -3 * dt, 1.6 * dt);
        const target = Math.atan2(-dx, -dz);
        let dy = target - j.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        j.yaw += clamp(dy, -0.5 * dt * Math.max(j.speed / 6, 0.3), 0.5 * dt * Math.max(j.speed / 6, 0.3));
        j.pos.x += -Math.sin(j.yaw) * j.speed * dt; j.pos.z += -Math.cos(j.yaw) * j.speed * dt;
        if (d < 5 + j.speed * 0.4 && !q.hold) j.i++;
        this.placeJet(j);
        // seen coming out: that's a decisive clue
        if (!q.ins && c.stage < 3 && !c.sawEmerge) {
            const war = this.game.war, eye = this.game.camera.position;
            if (eye.distanceTo(j.pos) < 8000 && war.lineOfSight(eye, j.pos)) { c.sawEmerge = true; c.addScore(3, { kind: 'emerge' }, true); }
        }
    }

    // the take-off roll, rotation and the first seconds of the climb; then the director's AI has it
    rollJet(c, s, j, dt) {
        const g = this.game, spec = AIRCRAFT[j.type];
        const vr = (spec.flight && spec.flight.speed ? spec.flight.speed * 0.3 : 75);
        j.speed += (j.speed < vr ? 7.5 : 5) * dt;
        const fx = -Math.sin(j.yaw), fz = -Math.cos(j.yaw);
        j.pos.x += fx * j.speed * dt; j.pos.z += fz * j.speed * dt;
        const ground = c.site.runway.y;
        if (j.speed > vr) { j.pitch = Math.min(0.17, j.pitch + dt * 0.12); j.climb = (j.climb || 0) + j.speed * Math.sin(j.pitch) * dt * 0.9; }
        j.pos.y = ground + (j.climb || 0);
        j.onGround = !j.climb || j.climb < 1;
        if (j.model) {
            j.model.position.set(j.pos.x, j.pos.y, j.pos.z);
            j.model.rotation.set(0, 0, 0); j.model.rotation.order = 'YXZ'; j.model.rotation.y = j.yaw; j.model.rotation.x = j.pitch;
            const pm = j.model.children[0];
            if (j.climb > 8 && pm && pm.children[1]) pm.children[1].visible = false; // gear up
        }
        j.vel.set(fx * j.speed, j.speed * Math.sin(j.pitch), fz * j.speed);
        j.unit.pos.set(j.pos.x, j.pos.y + 2, j.pos.z); j.unit.vel.copy(j.vel);
        if (j.lit) { j.lit = false; setInterior(j.model, false); }
        // afterburner glow on the roll (a flash at the tail)
        if (j.model && g.camera.position.distanceTo(j.pos) < 3000 && Math.random() < 0.6) g.effects.fire.emit(_v.set(j.pos.x - fx * (spec.length || 15) * 0.5, j.pos.y + 2.2, j.pos.z - fz * (spec.length || 15) * 0.5), _v2.set(-fx * 30, 0, -fz * 30), 0.08, 1.4, 0.4, [6, 3.5, 1.5], [3, 1, 0.2], 1, 0, 0, 0);
        if ((j.climb || 0) > 110) this.airborne(c, s, j);
    }

    // hand the jet over: a director flight with real AI jets where the kinematic ones were
    airborne(c, s, j) {
        const g = this.game, war = g.war, dir = g.director;
        j.airborne = true;
        this.removeTarget(j.unit);
        const live = s.jets.filter(x => x.airborne && x.unit && !x.unit.alive === false);
        if (s.flight || !dir) { if (s.flight) this.addMember(s.flight, j, s.jets.indexOf(j)); return; }
        const types = s.jets.filter(x => x.airborne || x.unit.alive).map(x => x.type);
        const role = s.opts.role || 'intercept';
        const f = dir.spawnFlight({
            team: 'red', role, types, pos: j.pos.clone(), speed: 260, skill: s.opts.skill ?? (dir.redSkill ? dir.redSkill() + 0.05 : 0.65),
            route: s.opts.route || [{ p: s.target.clone() }], callsign: s.opts.callsign || 'SCRAMBLE',
        });
        f.home = new THREE.Vector3(c.airfield.pos.x, c.airfield.pos.y + 1200, c.airfield.pos.z);
        f.ugHome = c;
        if (role === 'intercept') { f.anchor = s.target.clone(); f.endT = war.time + 300; }
        f.detected = c.stage >= 3; f.seenT = war.time;
        s.flight = f;
        // near the player: real jets from the start, where the kinematic one was (the others join as they lift off)
        if (g.camera.position.distanceTo(j.pos) < 20000) {
            f.members = [];
            // (a slot for every jet in the flight; the ones still rolling are counted alive until they join)
            for (let k = 0; k < f.hp.length; k++) f.hp[k] = 1;
            this.addMember(f, j, 0);
            f.matT = war.time;
        }
        void live;
    }

    addMember(f, j, slot) {
        const g = this.game, dir = g.director;
        if (!f.members) return;
        const a = new Aircraft(g, j.type, { team: 'red' });
        const spec = a.spec;
        a.spawnAir(_v.copy(j.pos), j.yaw, clamp(j.speed / (spec.flight.speed || 250), 0.25, 0.7));
        a.qv.multiply(new THREE.Quaternion().setFromAxisAngle(_v2.set(1, 0, 0), j.pitch * 0.7));
        if (a.syncBody) a.syncBody();
        a.throttle = a.controls.throttle = 1;
        a.flares = 8; a.slot = Math.min(slot, f.types.length - 1); a.flight = f;
        const pl = new Pilot(g, a, clamp(f.skill + rand(-0.05, 0.05), 0.2, 1));
        dir.configure(f, a, pl);
        g.aircraft.push(a);
        f.members.push(a);
        g.war.add(a, { cls: 'aircraft', name: spec.name.toUpperCase() });
    }

    placeJet(j) {
        const t = j.unit, y = this.groundAt(j.pos.x, j.pos.z, j.pos.y + 1);
        j.pos.y = y;
        t.mesh.position.set(j.pos.x, y, j.pos.z);
        t.mesh.rotation.set(0, j.yaw, 0);
        t.pos.set(j.pos.x, y + 2, j.pos.z);
        j.vel.set(-Math.sin(j.yaw) * j.speed, 0, -Math.cos(j.yaw) * j.speed);
        t.vel.copy(j.vel);
        // interior light inside the mountain, the sun outside
        const ins = !!ugTunnelAt(j.pos.x, j.pos.z, y + 2, 2);
        t.ugInside = ins;
        if (ins !== j.lit && t.alive) { j.lit = ins; setInterior(t.mesh, ins); }
    }

    // a ground target of ours taken out of the world (lifted off, or the war's over)
    removeTarget(t) {
        const g = this.game;
        if (!t || t.removed) return;
        t.removed = true;
        const i = g.ground ? g.ground.targets.indexOf(t) : -1;
        if (i >= 0) g.ground.targets.splice(i, 1);
        if (t.remove) t.remove(); else if (t.mesh && t.mesh.parent) t.mesh.parent.remove(t.mesh);
        g.war.remove(t);
    }

    dropSortie(c, s) { for (const j of s.jets) this.removeTarget(j.unit); }

    // the ground under a vehicle: a tunnel's floor inside, the carved ground (flat on the paving) outside
    groundAt(x, z, y = 1e9) {
        const t = ugTunnelAt(x, z, y, 1);
        if (t) return t.floor;
        if (ugPaved(x, z, 0)) return terrainHeight(x, z);
        const ds = this._ds || (this._ds = { h: 0 });
        this.game.world.drawnSample(x, z, ds);
        return ds.h;
    }

    // ═════════════ The aircraft in the hangar ═════════════
    // Along the hall's inner wall, angled 40° toward the exits, lit by the hall's lamps (drawn with the interior)
    placeParked(c) {
        const g = this.game;
        if (!g.ground) return;
        const T = tubeList().find(t => t.site === c.site && t.tube.ends[0] && t.samples.some(q => q.w > 16));
        if (!T) return;
        const hall = T.samples.filter(q => q.w > 16);
        const types = AIR_TYPES.slice(0, 7);
        const s0 = hall[0].s + 14, s1 = hall[hall.length - 1].s - 14, n = types.length;
        types.forEach((type, i) => {
            const s = s0 + (s1 - s0) * (i + 0.5) / n;
            const q = hall.reduce((a, b) => (Math.abs(b.s - s) < Math.abs(a.s - s) ? b : a));
            const span = AIRCRAFT[type].span || 10, len = AIRCRAFT[type].length || 15;
            // the inner wall is to the samples' right (away from the portals); nose out toward the hall's middle
            const lat = q.w / 2 - span * 0.35 - len * 0.32;
            const pos = new THREE.Vector3(q.x - q.tz * lat, q.y, q.z + q.tx * lat);
            const toward = i < n / 2 ? -1 : 1; // the nearer exit
            const fx = q.tx * toward * 0.64 + q.tz * 0.77, fz = q.tz * toward * 0.64 - q.tx * 0.77;
            const yaw = Math.atan2(-fx, -fz);
            // a real ground target (every weapon can hit it — through an open door) with the parked jet model
            const t = g.ground.addTarget('parked', pos.x, pos.z, yaw, 'red', { model: type });
            t.name = AIRCRAFT[type].name.toUpperCase(); t.def = { ...t.def, name: t.name, score: 300 };
            t.mesh.position.y = q.y; t.pos.set(pos.x, q.y + 2, pos.z);
            t.radius = t.hitRadius = Math.max(span, len) * 0.4;
            t.ugInside = true; t.ugComplex = c;
            setInterior(t.mesh, true);
            t.mesh.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
            c.parked.push({ type, unit: t, pos, yaw });
        });
    }

    // ═════════════ TELs (the missile complex) ═════════════
    // Three Scud TELs in the garage hall, each a red launcher source of strikes.js. A launch order sends one out: the
    // door opens, it drives to a launch pad, sets up (jacks, pad, erector), fires, stows and comes back in by the
    // other portal (the garage is a drive-through loop); the door closes behind it.
    stockTels(c) {
        const g = this.game, st = g.strikes;
        if (!st || !g.ground || !st.enabled) return;
        const T = tubeList().find(t => t.site === c.site && t.samples.some(q => q.w > 16));
        const hall = T.samples.filter(q => q.w > 16);
        for (let i = 0; i < 3; i++) {
            const q = hall[Math.floor(hall.length * (0.25 + 0.25 * i))];
            const lat = -(q.w / 2 - 4.5); // along the wall nearer the portals (left of the samples)
            const x = q.x - q.tz * lat, z = q.z + q.tx * lat;
            const yaw = Math.atan2(q.tx, q.tz); // facing back along the hall, toward E1
            const u = g.ground.addTarget('truck', x, z, yaw, 'red');
            u.name = 'SS-1C SCUD-B TEL'; u.def = { ...u.def, name: 'SCUD TEL', score: 600 };
            u.radius = u.hitRadius = 8;
            u.mesh.position.y = q.y; u.pos.set(x, q.y + 3, z);
            g.war.add(u, { cls: 'tel', name: 'SS-1C SCUD-B TEL', conceal: 0.55 });
            const tel = { unit: u, bay: { x, y: q.y, z, yaw }, state: 'bay', inside: true, pos: new THREE.Vector3(x, q.y, z), yaw, speed: 0, path: null, i: 0, erect: 0, reloadT: 0, lit: null };
            dress(u, 'scud', { onRig: () => { tel.lit = null; this.poseTel(tel); } });
            tel.src = st.addSource(new UgLauncher(st, c, tel));
            c.launchers.push(tel.src);
            c.tels.push(tel);
            this.placeTel(c, tel);
        }
        c.magazine = 4; // reloads in the magazine gallery
    }

    // the missile base's own launch: one of its TELs against what the director would hit (strikes.js picks it)
    missileSortie() {
        const g = this.game, st = g.strikes, dir = g.director;
        if (!st) return null;
        const c = this.complexes.find(x => x.kind === 'missile' && x.active && !x.sealed && x.tels.some(t => t.state === 'bay' && t.src.canFire('scud')));
        if (!c) return null;
        const tgt = dir && dir.missileTarget ? dir.missileTarget() : null;
        if (!tgt) return null;
        const mark = tgt.unit || { id: 0, pos: tgt.pos, fixed: tgt.pos, transmitted: true, label: tgt.label };
        return st.request('ballistic', [mark], 'red', true, { only: c.launchers });
    }

    // a TEL's route out (bay → hall → exit tunnel → the cutting → the yard → a launch pad) or back in by the other portal
    telPath(c, tel, out) {
        const site = c.site;
        const T = tubeList().find(t => t.site === site && t.samples.some(q => q.w > 16));
        const S = T.samples;
        const tels = site.portals.filter(p => p.kind === 'tel');
        const pref = out ? [tels[0], tels[1]] : [tels[1], tels[0]];
        const portal = pref.find(p => p && c.usable(p.id));
        if (!portal) return null;
        const F = portalFrame(site, portal);
        const toEnd = T.tube.ends[1] === portal.id;
        const inside = [];
        let bi = 0, bd = Infinity;
        S.forEach((q, i) => { const d = (q.x - tel.bay.x) ** 2 + (q.z - tel.bay.z) ** 2; if (d < bd) { bd = d; bi = i; } });
        const step = toEnd ? 1 : -1;
        for (let i = bi + step * 4; toEnd ? i < S.length : i >= 0; i += step * 3) inside.push({ x: S[i].x, y: S[i].y, z: S[i].z, v: 5, ins: true });
        const cut = [4, 25, portal.notch * 0.8].map(v => ({ x: F.x + F.vx * v, y: portal.floor, z: F.z + F.vz * v, v: 6 }));
        // the pads and the tracks to them
        const pads = site.pads.filter(pd => pd.len < 60);
        const pad = tel.pad || (tel.pad = pads[c.tels.indexOf(tel) % pads.length]);
        const padW = siteToWorld(site, pad.u, pad.v);
        const track = (site.roads || []).filter(r => r.kind === 'track');
        // the track that ends at this pad (a branch starts on the first one: walk that up to the branch first)
        const tr = track.find(r => { const e = r.pts[r.pts.length - 1]; return Math.hypot(e[0] - pad.u, e[1] - pad.v) < 30; }) || track[0];
        const trackPts = [];
        if (tr !== track[0]) {
            const s0 = tr.pts[0];
            for (const q of track[0].pts) { if (Math.hypot(q[0] - s0[0], q[1] - s0[1]) < 5) break; trackPts.push(q); }
            if (!trackPts.length) trackPts.push(track[0].pts[0]);
        }
        for (const q of tr.pts) trackPts.push(q);
        const trackW = trackPts.map(q => { const w = siteToWorld(site, q[0], q[1]); return { x: w.x, y: q[2], z: w.z, v: 9 }; });
        const padP = { x: padW.x, y: pad.y, z: padW.z, v: 0, hold: true };
        if (out) return { portal: portal.id, path: [...inside, ...cut, ...trackW, padP] };
        // back: the reverse, to the bay (driving in forwards through the other portal)
        return { portal: portal.id, path: [...[...trackW].reverse(), ...[...cut].reverse(), ...[...inside].reverse(), { x: tel.bay.x, y: tel.bay.y, z: tel.bay.z, v: 0, hold: true, ins: true }] };
    }

    // a launch order has come in for a TEL in its bay: out it goes
    startTel(c, tel) {
        const r = this.telPath(c, tel, true);
        if (!r) { tel.trapped = true; tel.src.queue.length = 0; return; }
        tel.path = r.path; tel.i = 0; tel.exit = r.portal; tel.state = 'out'; tel.speed = 0; tel.fired = false;
        c.openDoor(r.portal, tel);
        const g = this.game, war = g.war;
        g.events.emit('ugTelSortie', c, { tel });
        // if we know the place, we see the preparations: a chance to shut it in first
        if (c.stage >= 1) {
            const q = tel.src.queue[0];
            c.say('INTEL', 'ACTIVITY AT ' + c.facilityLabel() + ' — A MISSILE LAUNCHER IS MOVING OUT' + (q && q.aim ? ', TARGET ' + (q.aim.label || 'UNKNOWN') : ''), { color: '#ff9f5a', say: 'Launcher moving at the underground site.', priority: true });
        }
        void war;
    }

    updateTel(c, tel, dt) {
        const u = tel.unit, war = this.game.war;
        if (!u.alive) { if (tel.state !== 'dead') { tel.state = 'dead'; if (tel.exit) c.releaseDoor(tel.exit, tel); } return; }
        if (tel.trapped && tel.inside) { tel.src.queue.length = 0; return; }
        switch (tel.state) {
            case 'bay':
                if (tel.src.queue.length && !c.sealed) this.startTel(c, tel);
                // reload from the magazine
                if (!(tel.src.stock.scud > 0) && c.magazine > 0) { tel.reloadT += dt; if (tel.reloadT > 90) { tel.reloadT = 0; c.magazine--; tel.src.stock.scud = 1; this.poseTel(tel); } }
                break;
            case 'out': case 'back': {
                const doorPid = tel.exit, q = tel.path[tel.i];
                // at the door (going out from inside, or in from outside): wait for it
                const atDoor = q && tel.inside !== !!q.ins;
                if (atDoor && !c.doorOpen(doorPid)) {
                    if (!c.usable(doorPid)) { this.rerouteTel(c, tel); return; }
                    c.openDoor(doorPid, tel);
                    tel.speed = Math.max(0, tel.speed - 4 * dt);
                    this.placeTel(c, tel);
                    break;
                }
                const arrived = this.driveTel(c, tel, dt);
                const ins = !!ugTunnelAt(tel.pos.x, tel.pos.z, tel.pos.y + 2, 1);
                if (ins !== tel.inside) { tel.inside = ins; if (!ins) u.firingT = war.time; }
                if (arrived) {
                    c.releaseDoor(doorPid, tel);
                    if (tel.state === 'out') { tel.state = 'setup'; tel.erect = 0; }
                    else { tel.state = 'bay'; tel.path = null; tel.inside = true; tel.yaw = tel.bay.yaw; }
                } else if (tel.state === 'out' && !tel.inside && tel.i > 2 && !tel.path[tel.i - 1].ins) c.releaseDoor(doorPid, tel);
                break;
            }
            case 'setup':
                // jacks, then the pad, then the erector: 25 s
                tel.erect = Math.min(1, tel.erect + dt / 25);
                this.poseTel(tel);
                u.firingT = war.time - 2.5; // a TEL erecting a missile is easier to see
                if (tel.erect >= 1) tel.state = 'ready';
                break;
            case 'ready':
                // strikes.js counts down and fires (UgLauncher); once it has, pack up
                if (!tel.src.queue.length) { tel.state = 'stow'; }
                break;
            case 'stow':
                tel.erect = Math.max(0, tel.erect - dt / 15);
                this.poseTel(tel);
                if (tel.erect <= 0) {
                    const r = this.telPath(c, tel, false);
                    if (!r) { tel.state = 'stranded'; break; }
                    tel.path = r.path; tel.i = 0; tel.exit = r.portal; tel.state = 'back'; tel.speed = 0;
                }
                break;
            default: break; // 'stranded': nowhere to go, it sits outside (and the player can find it)
        }
    }

    rerouteTel(c, tel) {
        const r = this.telPath(c, tel, tel.state === 'out');
        if (!r || r.portal === tel.exit) {
            c.releaseDoor(tel.exit, tel);
            if (tel.inside) { tel.trapped = true; tel.src.queue.length = 0; tel.state = 'bay'; } else tel.state = 'stranded';
            return;
        }
        // (from where it is: on to the new path's nearest point)
        let k = 0, bd = Infinity;
        r.path.forEach((q, i) => { const d = (q.x - tel.pos.x) ** 2 + (q.z - tel.pos.z) ** 2; if (d < bd) { bd = d; k = i; } });
        c.releaseDoor(tel.exit, tel);
        tel.path = r.path; tel.i = k; tel.exit = r.portal;
    }

    // along the path; true when it has arrived
    driveTel(c, tel, dt) {
        const P = tel.path, q = P[tel.i];
        if (!q) return true;
        const dx = q.x - tel.pos.x, dz = q.z - tel.pos.z, d = Math.hypot(dx, dz);
        let want = q.v;
        const nx = P[tel.i + 1];
        // (past it already — the next point is behind us relative to this one: move on)
        if (nx && !q.hold && d < 25 && dx * (nx.x - q.x) + dz * (nx.z - q.z) < 0) { tel.i++; return this.driveTel(c, tel, 0); }
        if (nx && d < 25) { const a1 = Math.atan2(dx, dz), a2 = Math.atan2(nx.x - q.x, nx.z - q.z); const turn = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1))); want = Math.min(want, lerp(want, 2.5, clamp(turn / 1.2, 0, 1))); }
        if (q.hold) want = Math.min(Math.max(want, 3), d * 0.35 + 0.3);
        tel.speed += clamp(want - tel.speed, -3 * dt, 1.2 * dt);
        const target = Math.atan2(-dx, -dz);
        let dy = target - tel.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const turnRate = Math.max(tel.speed, 1.5) / 11; // an 11 m turning circle
        tel.yaw += clamp(dy, -turnRate * dt, turnRate * dt);
        const step = tel.speed * dt;
        tel.pos.x += -Math.sin(tel.yaw) * step; tel.pos.z += -Math.cos(tel.yaw) * step;
        const r = tel.unit.rig;
        if (r) { rollWheels(r, step); steerWheels(r, clamp(dy, -0.5, 0.5)); }
        if (q.hold && d < 1.2) { tel.speed = 0; tel.i++; this.placeTel(c, tel); return true; }
        if (!q.hold && d < 4 + tel.speed * 0.3) tel.i++;
        this.placeTel(c, tel);
        return false;
    }

    placeTel(c, tel) {
        const u = tel.unit;
        const y = this.groundAt(tel.pos.x, tel.pos.z, tel.pos.y + 2);
        tel.pos.y = y;
        u.mesh.position.set(tel.pos.x, y, tel.pos.z);
        u.mesh.rotation.set(0, tel.yaw, 0);
        u.pos.set(tel.pos.x, y + 3, tel.pos.z);
        u.vel.set(-Math.sin(tel.yaw) * tel.speed, 0, -Math.cos(tel.yaw) * tel.speed);
        const ins = !!ugTunnelAt(tel.pos.x, tel.pos.z, y + 2, 2);
        const key = ins + ':' + !!u.vehicle;
        if (key !== tel.lit && u.alive) { tel.lit = key; setInterior(u.mesh, ins); }
    }

    poseTel(tel) {
        const r = tel.unit.rig, e = tel.erect;
        if (!r) return;
        deployJacks(r, clamp(e * 3, 0, 1)); deployPad(r, clamp(e * 3 - 1, 0, 1)); raise(r, clamp(e * 3 - 2, 0, 1));
        if (r.missile) r.missile.visible = (tel.src.stock.scud || 0) > 0 || tel.src.queue.length > 0;
    }

    dropTel(c, tel) {
        const g = this.game;
        if (g.strikes) g.strikes.removeSource(tel.src);
        g.war.remove(tel.unit);
        const i = g.ground ? g.ground.targets.indexOf(tel.unit) : -1;
        if (i >= 0) { g.ground.targets.splice(i, 1); if (tel.unit.remove) tel.unit.remove(); }
    }

    // ═════════════ Blasts on the complexes ═════════════
    // A strategic missile has landed: a penetrator on (or right in front of) a portal brings it down; on a vent it
    // collapses the shaft. (strikes.js has already called damage(…, 'strike') on the units nearby: scars.)
    impact(m, at) {
        if (!m || !m.spec) return;
        const pen = m.spec.hard >= 0.9;
        const src = m.source && m.source.host ? m.source.host : m.source;
        for (const c of this.complexes) {
            if (!c.active || c.center.distanceTo(at) > 1500) continue;
            for (const e of c.entrances) {
                if (!e.alive) continue;
                const d = this.portalDist(e, at);
                if (pen && d < 22) c.unitHit(e, 1200 * clamp(1.35 - d / 30, 0.55, 1.2), src, 'penetrator');
            }
            if (pen) for (const u of c.clues) if (u.alive && u.kind === 'vent' && u.pos.distanceTo(at) < 12) c.unitHit(u, 5000, src, 'penetrator');
        }
    }

    // how far a point is from a portal's face: 0 in the doorway or on the facade, metres beyond it
    portalDist(e, at) {
        const F = e.F, p = e.portal, dx = at.x - F.x, dz = at.z - F.z;
        const u = dx * F.ux + dz * F.uz, v = dx * F.vx + dz * F.vz, y = at.y - p.floor;
        const du = Math.max(0, Math.abs(u) - p.face[0] / 2), dv = Math.max(0, v - 2, -v - p.face[2] - 4), dy = Math.max(0, y - p.face[1] - 3, -y - 2);
        return Math.hypot(du, dv, dy);
    }

    // Everything else that goes bang (weapons.js worldBlast): a heavy bomber's bombs are penetrators (GBU-57 class); a
    // bomb that goes off in an open doorway wrecks the door and brings the portal down; the rest scars the facade
    blast(at, o) {
        const owner = o.owner, kind = o.kind || 'blast';
        if (!owner) return; // (strategic impacts come through impact())
        for (const c of this.complexes) {
            if (!c.active || c.center.distanceTo(at) > 1500) continue;
            for (const e of c.entrances) {
                if (!e.alive) continue;
                const d = this.portalDist(e, at);
                if (d > 45) continue;
                if (kind === 'bomb' && owner.spec && owner.spec.category === 'bomber' && d < 18) { c.unitHit(e, 1300, owner, 'penetrator'); continue; }
                if (kind === 'bomb' && this.inDoorway(c, e, at)) { c.unitHit(e, 2000, owner, 'door'); c.say('COMMAND', 'A BOMB THROUGH THE OPEN DOOR OF ' + e.portal.id + '!', { color: GREEN, say: false }); continue; }
                c.unitHit(e, (o.amount || 200) * clamp(1 - d / 45, 0, 1), owner, kind);
            }
            for (const u of c.clues) if (u.alive && u.hp < 1e8 && u.pos.distanceTo(at) < (o.r || 20) + u.radius) c.unitHit(u, (o.amount || 200) * 0.6, owner, kind);
        }
    }

    // inside the open door's opening (between the facade's faces, or just behind)?
    inDoorway(c, e, at) {
        const d = c.door(e.portal.id);
        if (!d || d.k < 0.4) return false;
        const F = e.F, p = e.portal, dx = at.x - F.x, dz = at.z - F.z;
        const u = dx * F.ux + dz * F.uz, v = dx * F.vx + dz * F.vz, y = at.y - p.floor;
        return Math.abs(u) < p.open[0] / 2 + 1 && v < 2 && v > -p.face[2] - 12 && y > -2 && y < p.open[1] + 1.5;
    }

    // ═════════════ Inside, for everyone else ═════════════
    // game.surfaceAt: inside a tunnel the ground is its floor (the mountain's surface is far overhead)
    surfaceAt(x, z, y) {
        if (!this.built || y > 5000) return null;
        const t = ugTunnelAt(x, z, y, 0.5);
        if (!t) return null;
        const r = this._surf || (this._surf = { h: 0, water: false, ship: null, runway: null, hull: false, bridge: false, tunnel: true });
        r.h = t.floor;
        return r;
    }
    // the cameras: the floor of a tunnel the point is in, or null
    floorAt(x, z, y) {
        if (!this.built) return null;
        const t = ugTunnelAt(x, z, y, 1);
        return t ? t.floor : null;
    }
    // a camera following something in a tunnel stays in the tunnel: pulled in toward it (never up through the rock)
    clampCamera(want, anchor) {
        if (!this.built || !ugTunnelAt(anchor.x, anchor.z, anchor.y, 0.5)) return want;
        if (ugTunnelAt(want.x, want.z, want.y, -0.8)) return want;
        let lo = 0, hi = 1;
        const P = _v3;
        for (let k = 0; k < 10; k++) {
            const m = (lo + hi) / 2;
            P.lerpVectors(anchor, want, m);
            if (ugTunnelAt(P.x, P.z, P.y, -0.8)) lo = m; else hi = m;
        }
        return want.lerpVectors(anchor, want, lo);
    }

    // flying (or driving) in a tunnel: the walls and the arch are hard
    checkPlayerInTunnel() {
        const g = this.game, p = g.player;
        if (!p || !p.alive || g.pilotMode || p.exploded) return;
        const t = ugTunnelAt(p.pos.x, p.pos.z, p.pos.y, 3);
        if (!t) return;
        const half = (p.spec.span || 10) * 0.45, top = p.pos.y + (p.onGround ? 1.5 : 2.5);
        const hitWall = Math.abs(t.lat) + half > t.w / 2;
        const tw = Math.min(1, (Math.abs(t.lat) + half * 0.4) / (t.w / 2));
        const ceil = t.floor + t.h * WALL_K + (t.h - t.h * WALL_K) * Math.sqrt(Math.max(0, 1 - tw * tw));
        if (hitWall || top > ceil) {
            if (p.invincible) { p.vel.multiplyScalar(0.3); g.addFeed('SANDBOX — TUNNEL WALL IGNORED', '#9fb2c4'); return; }
            g.addFeed('INTO THE TUNNEL WALL', RED);
            if (p.crash) p.crash();
        }
    }

    // ═════════════ Tasks ═════════════
    hookTasks(tasks) {
        const self = this;
        // investigate a reported search area (ours: the facility is what's there)
        tasks.addGenerator((T) => {
            if (!self.enabled || !T.canOffer()) return null;
            for (const c of self.complexes) {
                const rp = c.reports.find(r => !r.resolved && !r.tasked);
                if (!rp || c.stage >= 3 || c.sealed) continue;
                return {
                    type: 'ugInvestigate', key: 'ug:investigate:' + c.id + ':' + rp.id, title: 'INVESTIGATE REPORTED ACTIVITY',
                    brief: rp.text + '. LOOK FOR TRACKS, VENTS (WARM IN THE TARGETING POD\'S FLIR), POWER LINES, GUARD POSTS — AND WHERE THEY GO.',
                    area: { center: rp.center, radius: rp.radius }, report: rp, reward: 600, label: 'SEARCH', expires: 420,
                    onOffer: () => { rp.tasked = true; },
                    progress: () => c.facilityLabel() + ' · CLUES ' + c.score.toFixed(1),
                    check: () => (c.stage >= 3 ? 'done:TARGET IDENTIFIED — ' + c.site.label.confirmed : c.sealed ? 'done:SEALED' : null),
                };
            }
            return null;
        });
        // find the way in
        tasks.addGenerator((T) => {
            if (!self.enabled || !T.canOffer()) return null;
            const war = self.game.war;
            for (const c of self.complexes) {
                if (c.stage < 3 || c.sealed || c.findTasked) continue;
                if (c.entrances.every(e => war.known(e) >= INTEL.CONTACT)) continue;
                return {
                    type: 'ugEntrances', key: 'ug:entrances:' + c.id, title: 'FIND THE ENTRANCES — ' + c.site.name,
                    brief: 'THE FACILITY IS CONFIRMED. LOCATE ITS TUNNEL PORTALS: CUTTINGS IN THE HILLSIDE, CONCRETE FACADES, CAMOUFLAGE NETS. THE TARGETING POD HELPS.',
                    pos: c.center, reward: 500, label: 'ENTRANCES', expires: 480,
                    onOffer: () => { c.findTasked = true; }, onEnd: () => { c.findTasked = false; },
                    progress: () => c.entrances.filter(e => war.known(e) >= INTEL.CONTACT).length + '/' + c.entrances.length + ' FOUND',
                    check: () => (c.entrances.every(e => war.known(e) >= INTEL.CONTACT) ? 'done:ALL ENTRANCES FOUND' : null),
                };
            }
            return null;
        });
        // seal it
        tasks.addGenerator((T) => {
            if (!self.enabled || !T.canOffer()) return null;
            const war = self.game.war;
            for (const c of self.complexes) {
                if (c.sealed || c.sealTasked || !c.entrances.some(e => war.known(e) >= INTEL.CONTACT)) continue;
                return {
                    type: 'ugSeal', key: 'ug:seal:' + c.id, title: 'SEAL ' + c.site.name,
                    brief: 'DESTROY EVERY ENTRANCE. ONLY PENETRATORS WORK: MARK AN ENTRANCE AND REQUEST A HARDENED TARGET STRIKE, BRING A HEAVY BOMBER — OR PUT A BOMB THROUGH AN OPEN DOOR.',
                    units: c.entrances.slice(), reward: 1500, label: 'SEAL', expires: 900,
                    onOffer: () => { c.sealTasked = true; }, onEnd: () => { c.sealTasked = false; },
                    progress: () => c.entrances.filter(e => !e.alive).length + '/' + c.entrances.length + ' ENTRANCES DOWN',
                    check: () => (c.sealed ? 'done:' + c.site.name + ' IS SEALED' : null),
                };
            }
            return null;
        });
        // a TEL is moving out: shut it in
        this.game.events.on('ugTelSortie', (c, { tel }) => {
            if (!self.enabled || c.stage < 1 || !self.game.tasks) return;
            const g = self.game;
            const exits = c.entrances.filter(e => e.portal.kind === 'tel' && e.alive);
            g.tasks.offer({
                type: 'ugTel', key: 'ug:tel:' + c.id + ':' + Math.round(g.war.time), urgent: true, title: 'DESTROY THE ENTRANCES BEFORE THE TEL FIRES',
                brief: 'A SCUD LAUNCHER IS MOVING TO THE DOORS OF ' + c.facilityLabel() + '. BRING THE VEHICLE PORTALS DOWN (PENETRATORS) OR KILL THE LAUNCHER BEFORE IT LAUNCHES.',
                pos: () => tel.unit.pos, units: exits, need: exits.length, reward: 1000, label: 'TEL', expires: 120, limit: 240,
                progress: () => (tel.state === 'setup' ? 'ERECTING' : tel.state === 'ready' ? 'FIRING SOON' : tel.inside ? 'INSIDE' : 'MOVING'),
                check: () => {
                    if (!tel.unit.alive) return 'done:LAUNCHER DESTROYED';
                    if (tel.trapped || tel.state === 'stranded') return 'done:THE LAUNCHER IS SHUT IN';
                    if (tel.fired) return 'failed:THE TEL HAS FIRED';
                    return null;
                },
            }, { force: true });
        });
    }

    // ═════════════ HUD ═════════════
    drawHud(ctx, hud) {
        const g = this.game;
        if (!this.enabled || g.photo || g.hideHud || (g.tacmap && g.tacmap.open)) return;
        const war = g.war, cam = g.camera, C = hud.compact;
        // TARGET IDENTIFIED (and SEALED): a boxed callout under the centre for a few seconds
        const co = this.callout;
        if (co && g.time - co.t < 6) {
            const a = clamp((6 - (g.time - co.t)) / 0.8, 0, 1) * clamp((g.time - co.t) / 0.25, 0, 1);
            const blink = (g.time - co.t) < 1.6 ? ((g.time * 6) % 1 < 0.6 ? 1 : 0.35) : 1;
            const x = hud.w / 2, y = hud.h * 0.3, W = Math.min(hud.w * 0.7, 560), H = C ? 58 : 70;
            ctx.save();
            ctx.globalAlpha = a;
            ctx.fillStyle = 'rgba(12,6,2,0.55)'; ctx.fillRect(x - W / 2, y - H / 2, W, H);
            ctx.strokeStyle = co.color || '#ff9f5a'; ctx.lineWidth = 2;
            ctx.strokeRect(x - W / 2 + 0.5, y - H / 2 + 0.5, W - 1, H - 1);
            for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.beginPath(); ctx.moveTo(x + sx * (W / 2 + 6), y + sy * (H / 2 - 10)); ctx.lineTo(x + sx * (W / 2 + 6), y + sy * (H / 2 + 6)); ctx.lineTo(x + sx * (W / 2 - 10), y + sy * (H / 2 + 6)); ctx.stroke(); }
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.globalAlpha = a * blink;
            ctx.fillStyle = co.color || '#ff9f5a'; ctx.font = (C ? '700 20px' : '700 26px') + ' "Share Tech Mono", ui-monospace, monospace';
            ctx.fillText(co.title, x, y - (C ? 10 : 12));
            ctx.globalAlpha = a;
            ctx.fillStyle = '#ffe2c0'; ctx.font = (C ? '600 11px' : '600 13px') + ' "Share Tech Mono", ui-monospace, monospace';
            ctx.fillText(co.sub + (co.grid ? ' · GRID ' + co.grid : ''), x, y + (C ? 12 : 16), W - 20);
            ctx.restore();
        }
        const to = this.toast;
        if (to && g.time - to.t < 5 && !(co && g.time - co.t < 6)) {
            const a = clamp((5 - (g.time - to.t)) / 0.8, 0, 1);
            ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const x = hud.w / 2, y = hud.h * 0.3;
            ctx.fillStyle = 'rgba(12,10,2,0.5)'; ctx.fillRect(x - 230, y - 22, 460, 44);
            ctx.fillStyle = to.color; ctx.font = '700 16px "Share Tech Mono", ui-monospace, monospace'; ctx.fillText('INTEL UPDATE: ' + to.title, x, y - 7, 440);
            ctx.font = '600 11px "Share Tech Mono", ui-monospace, monospace'; ctx.fillStyle = '#fff2c8'; ctx.fillText(to.sub, x, y + 11, 440);
            ctx.restore();
        }
        // known entrances in view: a diamond, the door's state and the range
        ctx.save();
        ctx.font = '600 10px "Share Tech Mono", ui-monospace, monospace'; ctx.textAlign = 'center';
        for (const c of this.complexes) {
            if (!c.active || c.center.distanceTo(cam.position) > 16000) continue;
            for (const e of c.entrances) {
                const rec = war.rec(e);
                if (!rec || rec.known < INTEL.CONTACT) continue;
                hud.project(e.pos, cam, _p);
                if (!_p.front || _p.x < 0 || _p.x > hud.w || _p.y < 0 || _p.y > hud.h) continue;
                const d = e.pos.distanceTo(cam.position), s = clamp(4000 / Math.max(d, 1), 10, 34) + 6;
                const col = e.alive ? '#ff9f5a' : 'rgba(160,160,160,0.8)';
                ctx.strokeStyle = col; ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.moveTo(_p.x - s, _p.y); ctx.lineTo(_p.x, _p.y - s * 0.7); ctx.lineTo(_p.x + s, _p.y); ctx.lineTo(_p.x, _p.y + s * 0.7); ctx.closePath(); ctx.stroke();
                const door = c.door(e.portal.id);
                const st = !e.alive ? 'DESTROYED' : door.moving ? (door.want ? 'DOOR OPENING' : 'DOOR CLOSING') : door.k > 0.5 ? 'DOOR OPEN' : 'SHUT';
                ctx.fillStyle = col;
                ctx.fillText((rec.known >= INTEL.IDENTIFIED ? e.portal.id + ' · ' : '') + st + ' · ' + km(d), _p.x, _p.y + s * 0.7 + 12);
            }
        }
        ctx.restore();
    }

    // ═════════════ The tactical map ═════════════
    // only what's known: the runway once the airfield is, the complex's ring and state once it's identified (the
    // units themselves — clues, entrances, the facility — are the war layer's to draw)
    drawMap(ctx, map) {
        if (!this.enabled) return;
        const war = this.game.war, P = {}, Q = {};
        ctx.save();
        for (const c of this.complexes) {
            if (!c.active) continue;
            if (c.airfield && war.known(c.airfield) >= INTEL.CONTACT && c.site.runway) {
                const r = c.site.runway, a = siteToWorld(c.site, r.u - r.len / 2, r.v), b = siteToWorld(c.site, r.u + r.len / 2, r.v);
                map.toScreen(a.x, a.z, P); map.toScreen(b.x, b.z, Q);
                ctx.strokeStyle = RED; ctx.lineWidth = Math.max(2, r.w * map.scale);
                ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke();
            }
            const frec = war.rec(c.facility);
            if (!frec || frec.known < INTEL.IDENTIFIED) continue;
            map.toScreen(c.center.x, c.center.z, P);
            const R = Math.max(26, 420 * map.scale);
            ctx.strokeStyle = c.sealed ? 'rgba(150,150,150,0.8)' : RED; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(P.x, P.y, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = c.sealed ? '#bbb' : RED; ctx.font = '700 11px "Share Tech Mono", monospace'; ctx.textAlign = 'center';
            const down = c.entrances.filter(e => !e.alive).length;
            ctx.fillText(c.site.name + (c.sealed ? ' — SEALED' : ' — ' + down + '/' + c.entrances.length + ' ENTRANCES DOWN'), P.x, P.y - R - 8);
        }
        ctx.restore();
    }

    mapInfo(sel) {
        if (!this.enabled || !sel || sel.kind !== 'unit' || !sel.unit || !sel.unit.ug) return null;
        const u = sel.unit, c = u.cx, war = this.game.war, out = [];
        if (u.kind === 'facility') {
            out.push({ text: 'CLUES: ' + c.score.toFixed(1) + ' · STAGE ' + c.stage + '/3', color: INTEL_COL });
            if (c.stage >= 3) out.push({ text: 'ENTRANCES: ' + c.entrances.filter(e => war.known(e) >= INTEL.CONTACT).length + ' FOUND, ' + c.entrances.filter(e => !e.alive).length + ' DESTROYED OF ' + c.entrances.length, color: '#e8f4ff' });
            if (c.sealed) out.push({ text: 'SEALED — NOTHING GETS IN OR OUT', color: GREEN });
        }
        if (u.kind === 'entrance') {
            const d = c.door(u.portal.id);
            out.push({ text: !u.alive ? 'PORTAL COLLAPSED' : d.k > 0.5 ? 'BLAST DOOR OPEN' : 'BLAST DOOR SHUT', color: u.alive ? '#ff9f5a' : '#9fb2c4' });
            if (u.alive) out.push({ text: 'PENETRATORS ONLY (HARDENED STRIKE, HEAVY BOMBER) — OR A BOMB THROUGH THE OPEN DOOR', color: INTEL_COL });
        }
        if (u.kind === 'vent') out.push({ text: 'WARM AIR — SOMETHING BELOW IS VENTILATED', color: INTEL_COL });
        return out;
    }

    mapActions(sel) {
        if (!this.enabled || !sel || sel.kind !== 'unit' || !sel.unit || !sel.unit.ug) return null;
        const u = sel.unit, c = u.cx, g = this.game, war = g.war;
        const known = c.entrances.filter(e => e.alive && war.known(e) >= INTEL.CONTACT);
        if ((u.kind === 'facility' || u.kind === 'entrance') && known.length && g.strikes) {
            const one = u.kind === 'entrance' && u.alive;
            return [{ label: 'PENETRATOR STRIKE ON ' + (one ? u.portal.id : 'ALL KNOWN ENTRANCES (' + known.length + ')'), run: () => this.strikeEntrances(one ? [u] : known) }];
        }
        return null;
    }

    // COMMAND menu: a hardened strike on every entrance we know
    commands() {
        if (!this.enabled) return [];
        const war = this.game.war, out = [];
        for (const c of this.complexes) {
            const known = c.entrances.filter(e => e.alive && war.known(e) >= INTEL.CONTACT);
            if (!known.length || c.sealed) continue;
            out.push({ path: ['TACTICAL SUPPORT'], label: 'PENETRATORS ON ' + c.site.name + ' (' + known.length + ' ENTRANCE' + (known.length > 1 ? 'S' : '') + ')', hint: 'hardened target strike on every known entrance', run: () => this.strikeEntrances(known) });
        }
        return out;
    }

    // a hardened strike (two penetrators each) on these entrances
    strikeEntrances(list) {
        const g = this.game, war = g.war;
        const marks = list.map(e => war.designate(e, 'intel'));
        war.transmit(marks);
        let first = null;
        for (const m of marks) { const s = g.strikes.request('hardened', [m], war.side, !!first); if (s && !first) first = s; }
        return first;
    }
}

// ═════════════ A TEL as a strikes.js launch source ═════════════
// It holds its launch until the TEL has driven out and erected the missile, then fires from the missile on the erector
class UgLauncher extends LaunchSource {
    constructor(mgr, c, tel) {
        super(mgr, { kind: 'launcher', name: 'SCUD TEL (' + c.site.name + ')', team: 'red', host: tel.unit, stock: { scud: 1 }, range: 300000 });
        this.cx = c; this.tel = tel;
    }
    // (inside a sealed complex, or shut in, it's out of the war)
    get alive() { const t = this.tel; return t.unit.alive && !(t.trapped && t.inside) && !(this.cx.sealed && t.inside); }
    canFire(k) { return this.alive && (this.stock[k] || 0) > 0 && (this.tel.state === 'bay' || this.tel.state === 'ready'); }
    prepTime() { return 5; }
    update(dt) {
        if (!this.alive) { this.queue.length = 0; return; }
        if (this.tel.state !== 'ready') return; // (held: out of the mountain and erected first)
        super.update(dt);
    }
    launchFrame(out, dir) {
        const r = this.tel.unit.rig;
        if (r && r.missile) { r.missile.updateMatrixWorld(true); r.missile.getWorldPosition(out); out.y += 1; }
        else out.copy(this.tel.unit.pos).y += 8;
        dir.set(0, 1, 0);
    }
    launch(q) {
        const m = super.launch(q);
        this.tel.fired = true;
        const r = this.tel.unit.rig;
        if (r && r.missile) r.missile.visible = false;
        // an unknown site gives itself away when it fires
        const c = this.cx;
        if (c.stage < 3) {
            const rp = c.report('A BALLISTIC MISSILE LAUNCH', 2500, 0.4);
            if (rp) c.say('MAGIC', 'LAUNCH POINT ' + rp.text.replace('A BALLISTIC MISSILE LAUNCH ', '') + ' — SEARCH AREA ON THE MAP', { color: '#ff4a3d' });
            c.addScore(1.5, { kind: 'emerge' }, false);
        }
        return m;
    }
}

// swap a model between its own materials (daylight) and their interior twins (ugint.js)
function setInterior(obj, on) {
    obj.traverse(o => {
        if (!o.isMesh) return;
        if (!o.userData.dayMat) o.userData.dayMat = o.material;
        if (on) { if (!o.userData.ugMat) o.userData.ugMat = Array.isArray(o.material) ? o.material.map(m => interiorMaterial(m)) : interiorMaterial(o.material); o.material = o.userData.ugMat; }
        else o.material = o.userData.dayMat;
    });
}
export { setInterior, UgUnit, UgLauncher };

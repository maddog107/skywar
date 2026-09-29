// ═══════════════════════════════════════════════════════════════
// The war layer (docs/WAR.md): what the player's side knows about the battlefield and how it talks.
//  • registry — every military unit that matters (ground targets, ships, aircraft, and whatever the war
//    plug-ins add), with its class, team and what we know about it
//  • intel — for each enemy unit: UNKNOWN → CONTACT ("unknown vehicle") → IDENTIFIED ("SA-10 site") →
//    CONFIRMED (position fixed, targetable), with the last known position and when it was seen. The
//    player's eyes and radar raise it here; the targeting pod, AWACS, drones and recon aircraft call reveal()
//  • intel reports — an area to search ("possible underground facility within search area")
//  • designations — marked targets and points, the input to strikes (strikes.js)
//  • radio — messages from command, AWACS, wingmen… on the HUD, in the log and spoken
//  • territory and radar coverage — who holds the ground, whose radars see a point
// Plug-in systems (systems.js) are built around this: game.war is always there.
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight } from './world.js';
import { AIR_TARGETS } from './softtargets.js';
import { clamp } from './util.js';
import { fireLights } from './firelight.js'; // [night] what stands in a fire's light

export const INTEL = { UNKNOWN: 0, CONTACT: 1, IDENTIFIED: 2, CONFIRMED: 3 };
export const INTEL_NAMES = ['UNKNOWN', 'CONTACT', 'IDENTIFIED', 'CONFIRMED'];

// What an enemy unit is called before it's identified
const CONTACT_NAMES = {
    aircraft: 'UNKNOWN AIRCRAFT', helicopter: 'UNKNOWN HELICOPTER', ship: 'SURFACE CONTACT', carrier: 'LARGE SURFACE CONTACT',
    sub: 'SUBSURFACE CONTACT', facility: 'UNKNOWN FACILITY', entrance: 'UNKNOWN STRUCTURE', bunker: 'UNKNOWN STRUCTURE',
    radar: 'UNKNOWN INSTALLATION', sam: 'UNKNOWN SITE', silo: 'UNKNOWN STRUCTURE', airbase: 'AIRFIELD',
    hangar: 'UNKNOWN STRUCTURE', shelter: 'UNKNOWN STRUCTURE', fuel: 'UNKNOWN STRUCTURE', ammo: 'UNKNOWN STRUCTURE',
    tower: 'UNKNOWN STRUCTURE', command: 'UNKNOWN STRUCTURE', infantry: 'TROOPS',
};
const contactName = (cls) => CONTACT_NAMES[cls] || 'UNKNOWN VEHICLE';

// Ground target types (ground.js) → war classes
const GROUND_CLS = {
    sam: 'sam', aaa: 'aaa', radar: 'radar', hangar: 'hangar', fuel: 'fuel', tank: 'tank', bunker: 'command',
    parked: 'aircraft', truck: 'vehicle', humvee: 'vehicle', fueltruck: 'vehicle', spaag: 'aaa', msam: 'sam',
};
// how hard a warhead finds each class (0 soft … 1 needs a penetrator), where the unit doesn't say
const HARDENED = { command: 0.6, bunker: 0.8, facility: 0.9, entrance: 0.85, silo: 0.9, shelter: 0.7, tank: 0.35, bridge: 0.4, carrier: 0.5 };

// The front (km): red holds everything north-east of this line and the far north; the player's side the south
// and the Miramar pocket in the north-west. West → east. (A front-line system can move it: setFront.)
const FRONT_KM = [[-70, -34], [-20, -34], [-3, -30], [-2, -20], [-1, -12], [4, -8], [12, -5], [70, -6]];

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _nose = new THREE.Vector3();
let nextId = 1;

// Grid references (War.grid): a 10 km square named by two letters (columns west → east, rows south → north, I and
// O left out), then the easting and northing inside it. parseGrid is the inverse: "KD 412 883", "kd412883",
// "KD 41 88" (any even number of digits, split in half: 1 km, 100 m, 10 m or 1 m) → the centre of the square the
// reference names, { x, z, size }, or null when it isn't one
const GRID_L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function parseGrid(ref) {
    const m = /^\s*([A-Za-z])\s*([A-Za-z])\s*(\d+)\s*(\d*)\s*$/.exec(String(ref ?? ''));
    if (!m) return null;
    const cx = GRID_L.indexOf(m[1].toUpperCase()), cz = GRID_L.indexOf(m[2].toUpperCase());
    if (cx < 0 || cz < 0) return null;
    let e = m[3], n = m[4];
    if (!n) { if (e.length % 2) return null; n = e.slice(e.length / 2); e = e.slice(0, e.length / 2); }
    if (e.length !== n.length || e.length > 4) return null;
    const size = 10000 / 10 ** e.length;
    const ex = +e * size + size / 2, nz = +n * size + size / 2;
    return { x: (cx - 12) * 10000 + ex, z: -((cz - 12) * 10000 + nz), size };
}

export class War {
    constructor(game) {
        this.game = game;
        this.units = [];
        this.recs = new Map();       // unit → record
        this.designations = [];
        this.reports = [];
        this.radioLog = [];
        this.side = 'blue';          // the player's side
        this.front = FRONT_KM.map(([x, z]) => ({ x: x * 1000, z: z * 1000 }));
        this.syncT = 0;
        this.scan = 0;
        this.time = 0;
        this.enabled = false;
    }

    get playerTeam() { return this.side; }
    get enemyTeam() { return this.side === 'blue' ? 'red' : 'blue'; }

    // ═════════════ Lifecycle ═════════════
    start(mode) {
        this.clear();
        this.mode = mode;
        this.enabled = true;
        // what the player's side already knows at the start: the strike and naval briefings name their targets;
        // otherwise pre-war imagery shows the enemy airbase's fixed installations, and nothing else
        this.briefed = mode === 'strike' || mode === 'naval';
        this.sync(true);
    }

    clear() {
        this.clearClearings();
        this.units.length = 0;
        this.recs.clear();
        this.designations.length = 0;
        this.reports.length = 0;
        this.radioLog.length = 0;
        this.time = 0;
        this.enabled = false;
    }

    // ═════════════ Registry ═════════════
    // opts: cls, name, known (initial intel), conceal (0..1), hardened (0..1), value, contactName
    add(unit, opts = {}) {
        if (!unit || this.recs.has(unit)) return this.recs.get(unit);
        const cls = opts.cls || unit.cls || 'vehicle';
        if (!unit.cls) unit.cls = cls;
        const rec = {
            id: nextId++, unit, cls, team: unit.team || 'neutral',
            name: opts.name || unit.name || cls.toUpperCase(),
            contactName: opts.contactName || contactName(cls),
            known: 0, lastPos: new THREE.Vector3().copy(unit.pos || _v.set(0, 0, 0)), lastSeen: -1e9, seenT: 0,
            source: null, conceal: opts.conceal ?? unit.conceal ?? 0, value: opts.value ?? 1,
            hardened: opts.hardened ?? unit.hardened ?? HARDENED[cls] ?? 0,
        };
        if (unit.hardened == null) unit.hardened = rec.hardened;
        this.recs.set(unit, rec);
        this.units.push(unit);
        const friendly = rec.team === this.side;
        const initial = opts.known ?? (friendly ? INTEL.CONFIRMED : this.priorIntel(rec));
        if (initial > 0) this.setKnown(rec, initial, friendly ? 'own' : 'prior', true);
        return rec;
    }

    remove(unit) {
        if (!this.recs.delete(unit)) return;
        const i = this.units.indexOf(unit);
        if (i >= 0) this.units.splice(i, 1);
        for (const d of this.designations) if (d.unit === unit) d.unit = null;
    }

    rec(unit) { return this.recs.get(unit) || null; }
    known(unit) { const r = this.recs.get(unit); return r ? r.known : 0; }

    // What the player's side knows about a newly registered enemy unit before anyone has looked
    priorIntel(rec) {
        if (this.briefed) return INTEL.IDENTIFIED;
        const u = rec.unit;
        if (rec.cls === 'airbase') return INTEL.IDENTIFIED;
        // fixed installations at a known airfield are on pre-war imagery; everything mobile starts unknown
        if (u.isGround && !u.route && ['hangar', 'fuel', 'command', 'radar', 'tower', 'shelter', 'ammo'].includes(rec.cls)) return INTEL.IDENTIFIED;
        if (rec.cls === 'sam' && u.isGround && !u.route && u.type === 'sam') return INTEL.CONTACT; // suspected sites
        return INTEL.UNKNOWN;
    }

    // Pick up the units the older systems keep in their own lists: ground targets, ships and aircraft
    sync(force = false) {
        const g = this.game;
        if (g.ground) for (const t of g.ground.targets) {
            if (this.recs.has(t)) continue;
            if (t.isShip) { this.add(t, { cls: t.type === 'carrier' ? 'carrier' : t.type === 'sub' ? 'sub' : 'ship' }); continue; }
            if (t.isBridge) { this.add(t, { cls: 'bridge', name: t.name || 'BRIDGE', known: INTEL.IDENTIFIED }); continue; }
            if (t.type === 'board') continue; // practice boards aren't part of the war
            this.add(t, { cls: GROUND_CLS[t.type] || t.cls || 'vehicle' });
        }
        if (g.naval) for (const s of g.naval.ships) if (!this.recs.has(s)) this.add(s, { cls: s.type === 'carrier' ? 'carrier' : s.type === 'sub' ? 'sub' : 'ship' });
        for (const a of g.aircraft) {
            if (this.recs.has(a) || a === g.player) continue;
            this.add(a, { cls: /heli/.test(a.type || '') ? 'helicopter' : 'aircraft', name: a.spec ? a.spec.name.toUpperCase() : 'AIRCRAFT' });
        }
        void force;
    }

    // ═════════════ Queries ═════════════
    // Units near a point (optionally within a class / team / min intel level), nearest first
    near(pos, r, { cls = null, team = null, minKnown = 0, alive = true } = {}) {
        const out = [];
        const r2 = r * r;
        for (const u of this.units) {
            if (alive && !u.alive) continue;
            const rec = this.recs.get(u);
            if (cls && (Array.isArray(cls) ? !cls.includes(rec.cls) : rec.cls !== cls)) continue;
            if (team && rec.team !== team) continue;
            if (rec.known < minKnown) continue;
            const d2 = u.pos.distanceToSquared(pos);
            if (d2 <= r2) out.push({ u, rec, d2 });
        }
        out.sort((a, b) => a.d2 - b.d2);
        return out;
    }

    // The label the player's side uses for a unit: its real name once identified
    label(unit) {
        const rec = this.recs.get(unit);
        if (!rec) return unit.name || '?';
        return rec.known >= INTEL.IDENTIFIED || rec.team === this.side ? rec.name : rec.contactName;
    }

    // ═════════════ Intel ═════════════
    // Raise what we know about a unit (never lowers it). source: 'visual', 'radar', 'tgp', 'awacs', 'drone', …
    reveal(unit, level, source = 'intel', quiet = false) {
        const rec = this.recs.get(unit) || this.add(unit);
        if (!rec) return;
        rec.lastPos.copy(unit.pos);
        rec.lastSeen = this.time;
        if (level > rec.known) this.setKnown(rec, level, source, quiet);
    }

    setKnown(rec, level, source, quiet = false) {
        const was = rec.known;
        rec.known = level;
        rec.source = source;
        rec.lastPos.copy(rec.unit.pos);
        rec.lastSeen = this.time;
        if (quiet || rec.team === this.side || !this.enabled) return;
        const g = this.game;
        const where = this.describePos(rec.unit.pos);
        // (through the director's pacing when a war runs: flying over a base spots a dozen things at once)
        const call = (text, color, group) => {
            const d = g.director;
            if (d && d.enabled && d.say) d.say('INTEL', text, { color, say: false, group, merge: (n) => n + ' MORE ' + (group === 'contact' ? 'NEW CONTACTS' : 'TARGETS IDENTIFIED') + ' NEAR GRID ' + this.grid(rec.unit.pos.x, rec.unit.pos.z) + ' — SEE THE MAP' });
            else this.radio('INTEL', text, { color, say: false });
        };
        if (level === INTEL.CONTACT && was < INTEL.CONTACT && !['aircraft', 'helicopter'].includes(rec.cls)) {
            call('NEW CONTACT: ' + rec.contactName + ' — ' + where, '#ffd24a', 'contact');
            g.events.emit('warContact', rec.unit, { rec });
        } else if (level >= INTEL.IDENTIFIED && was < INTEL.IDENTIFIED && !['aircraft', 'helicopter'].includes(rec.cls)) {
            call('IDENTIFIED: ' + rec.name + ' — ' + where, '#ff9f5a', 'ident');
            g.events.emit('warIdentified', rec.unit, { rec });
            // an intel report whose facility this was is resolved
            for (const rp of this.reports) if (rp.unit === rec.unit && !rp.resolved) this.resolveReport(rp);
        }
    }

    // Area intel: "possible underground facility within search area". unit: what's really there (optional)
    report({ text, center, radius, unit = null, cls = null, say = true }) {
        const rp = { id: nextId++, text, center: new THREE.Vector3(center.x, 0, center.z), radius, unit, cls, time: this.time, resolved: false };
        this.reports.push(rp);
        this.radio('COMMAND', 'INTELLIGENCE REPORT: ' + text + ' — SEARCH AREA ' + this.grid(center.x, center.z), { color: '#ffd24a', say: say ? 'Intelligence report. ' + text.toLowerCase() + '.' : false });
        this.game.events.emit('warReport', rp);
        return rp;
    }

    resolveReport(rp) {
        rp.resolved = true;
        this.radio('COMMAND', 'TARGET IDENTIFIED: ' + (rp.unit ? this.recs.get(rp.unit)?.name || rp.text : rp.text) + ' — TRANSMIT COORDINATES TO REQUEST A STRIKE', { color: '#ff9f5a', say: 'Target identified.' });
        this.game.events.emit('warReportResolved', rp);
    }

    // ── The player's own sensors: eyes (and radar for aircraft) ──
    // A slice of the units each frame; a unit has to stay in view a moment to be spotted, longer to be identified.
    updateSensors(dt) {
        const g = this.game, units = this.units, n = units.length;
        if (!n) return;
        if (g.indoors && g.indoors.sealed) return; // (in a closed room nobody's looking out: interiors.js)
        const pm = g.pilotMode, p = g.player;
        const onFoot = !!pm;
        const eye = g.camera.position;
        const fwd = g.camera.getWorldDirection(_v2);
        const light = this.lightFactor();
        // [weather] with the weather model (weathersys.js) every line of sight has its own fog, rain and cloud; a fire
        // lights what's round it at night (firelight.js)
        const W = g.weather && g.weather.wx ? g.weather : null;
        const weather = W ? 1 : ({ clear: 1, cloudy: 0.85, rain: 0.55, storm: 0.4 }[g.world.weather] ?? 1);
        const hasRadar = p && p.alive && !onFoot && p.spec && (p.spec.missiles > 0 || p.spec.radar);
        // (the radar looks along the nose, wherever the camera — the head, the targeting pod — is looking)
        const nose = hasRadar ? p.getForward(_nose) : fwd;
        const per = Math.min(n, 48);
        const step = dt * n / per; // each unit gets looked at about every (n / per) frames: scale its dwell time
        for (let k = 0; k < per; k++) {
            this.scan = (this.scan + 1) % n;
            const u = units[this.scan];
            const rec = this.recs.get(u);
            if (!u.alive || rec.team === this.side || rec.team === 'neutral') continue;
            if (rec.known >= INTEL.CONFIRMED) { this.trackKnown(rec, eye, fwd); continue; }
            const d = u.pos.distanceTo(eye);
            let spotR, idR;
            if (rec.cls === 'aircraft' || rec.cls === 'helicopter') {
                const airborne = !u.onGround;
                // air-to-air radar: contacts to ~45 km in front, the type (NCTR) closer
                if (hasRadar && airborne && d < 45000) {
                    const inCone = _v.subVectors(u.pos, eye).divideScalar(d).dot(nose) > 0.35;
                    // (a jammer hides behind its noise strobe until the radar burns through, closer in; clouds are
                    // nothing to it, heavy rain takes a little of its range)
                    const jf = (inCone ? this.jamFactor(this.side, p.pos, u.pos) : 1) * (W ? W.transmittance(eye, u.pos, 'radar') : 1);
                    if (inCone && d < 45000 * jf) { this.bump(rec, d < 18000 * jf ? INTEL.IDENTIFIED : INTEL.CONTACT, 'radar', step); continue; }
                }
                spotR = 9000; idR = 3500;
            } else {
                const r = u.radius || 6;
                spotR = clamp(r * 600, 1500, 20000);
                idR = spotR * 0.4;
            }
            // (by night, what stands in a fire's light is seen as by day)
            const lit = W && light < 1 && fireLights.n > 0 ? Math.max(light, Math.min(1, fireLights.illuminationAt(u.pos) / 1.2)) : light;
            let f = lit * weather * (1 - 0.8 * (rec.conceal || 0));
            if (onFoot) f *= 0.45;
            if (u.firingT != null && this.time - u.firingT < 3) f = Math.max(f, 1.5); // a launch or a gun firing gives it away
            if (d > spotR * f) { rec.seenT = Math.max(0, rec.seenT - dt); continue; }
            // on screen, and not behind a hill
            _v.subVectors(u.pos, eye);
            if (_v.dot(fwd) < d * 0.72) { rec.seenT = Math.max(0, rec.seenT - dt); continue; }
            if (!this.lineOfSight(eye, u.pos)) { rec.seenT = Math.max(0, rec.seenT - dt); continue; }
            // [weather] and not hidden by cloud, fog or rain (a contact needs a trace of contrast, identifying much more)
            // (held half a second per unit: the scan comes round several times a second)
            let T = 1;
            if (W) {
                if (!(rec.wxAt > this.time - 0.5)) { rec.wxT = W.transmittance(eye, u.pos, 'eye'); rec.wxAt = this.time; }
                T = rec.wxT;
            }
            if (T < 0.06) { rec.seenT = Math.max(0, rec.seenT - dt); continue; }
            this.bump(rec, d < idR * f && T > 0.25 ? INTEL.IDENTIFIED : INTEL.CONTACT, 'visual', step);
        }
    }

    // keep watching a unit in view: dwell builds up to spotting (0.4 s) and identifying (1.6 s)
    bump(rec, level, source, dt) {
        rec.seenT += dt;
        rec.lastPos.copy(rec.unit.pos);
        rec.lastSeen = this.time;
        const need = level >= INTEL.IDENTIFIED ? 1.6 : 0.4;
        if (rec.seenT >= need && level > rec.known) this.setKnown(rec, level, source);
        else if (rec.seenT >= 0.4 && rec.known < INTEL.CONTACT) this.setKnown(rec, INTEL.CONTACT, source);
    }

    // confirmed units the player can see keep their track fresh
    trackKnown(rec, eye, fwd) {
        const u = rec.unit;
        const d = u.pos.distanceTo(eye);
        if (d < 25000 && _v.subVectors(u.pos, eye).dot(fwd) > d * 0.6) { rec.lastPos.copy(u.pos); rec.lastSeen = this.time; }
    }

    // daylight (1) … dusk … night (0.25); night vision brings the night back up
    lightFactor() {
        const g = this.game, W = g.weather && g.weather.wx ? g.weather : null;
        // [weather] as dark as it really is (the clock can run: weather.js nightOf), else by the time of day's name
        const key = g.world.timeKey; // (at night world.sunDir is the moon, so go by the time of day)
        let f = W ? 1 - 0.75 * W.night : key === 'night' ? 0.25 : key === 'dusk' || key === 'dawn' ? 0.55 : 1;
        if (g.nvg) f = Math.max(f, 0.7);
        return f;
    }

    // terrain between two points? (samples the line; ends are skipped so the ground under the target doesn't count)
    lineOfSight(a, b) {
        for (let i = 1; i < 10; i++) {
            const t = i / 10;
            const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
            if (terrainHeight(x, z) > y + 2) return false;
        }
        return true;
    }

    // ═════════════ Designations ═════════════
    // Mark a unit or a point for strikes. Returns the designation (existing one if already marked).
    designate(target, source = 'hud') {
        const unit = target && target.pos && target.alive !== undefined ? target : null;
        if (unit) {
            const have = this.designations.find(d => d.unit === unit);
            if (have) return have;
            this.reveal(unit, INTEL.CONFIRMED, source, true);
        }
        // a point: on the ground as drawn there (a deck, a bridge, the terrain)
        const pos = unit ? unit.pos : new THREE.Vector3(target.x, 0, target.z);
        if (!unit) pos.y = target.y > 0 ? target.y : this.game.surfaceAt(pos.x, pos.z).h;
        const d = {
            id: this.nextMark(), unit, pos: unit ? unit.pos : pos, fixed: unit ? null : pos.clone(),
            label: unit ? this.label(unit) : 'POINT', time: this.time, source, grid: this.grid(pos.x, pos.z), transmitted: false,
        };
        this.designations.push(d);
        while (this.designations.length > 8) this.designations.shift();
        this.radio(this.game.callsign ? this.game.callsign + ' 1' : 'LEAD', 'MARK ' + d.id + ': ' + d.label + ' — GRID ' + d.grid, { color: '#5dffa0', say: false });
        this.game.audio.tick(1500, 0.08, 0.05);
        this.game.events.emit('warDesignate', d);
        return d;
    }

    nextMark() {
        for (let i = 1; i < 99; i++) if (!this.designations.some(d => d.id === i)) return i;
        return 99;
    }

    undesignate(d) {
        const i = this.designations.indexOf(d);
        if (i >= 0) this.designations.splice(i, 1);
    }

    // Transmit marks to command (a strike request uses them); returns the transmitted list
    transmit(list = this.designations) {
        const fresh = list.filter(d => !d.transmitted);
        for (const d of fresh) d.transmitted = true;
        if (fresh.length) this.radio('COMMAND', 'COORDINATES RECEIVED: ' + fresh.map(d => 'MARK ' + d.id).join(', ') + '. STANDING BY FOR STRIKE REQUEST', { color: '#9fd4ff', say: 'Coordinates received.' });
        return list;
    }

    // ═════════════ Radio ═════════════
    // from: the speaker's callsign ('COMMAND', 'MAGIC' (AWACS), 'BOLT', …). say: true (the text), a string, or false.
    // voice: { pitch, rate, name } for the speech (each speaker keeps their own; see audio.say)
    radio(from, text, { color = '#9fd4ff', say = true, priority = false, voice = null } = {}) {
        const msg = { from, text, color, t: this.game.time };
        this.radioLog.push(msg);
        if (this.radioLog.length > 60) this.radioLog.shift();
        this.game.addFeed((from ? from + ': ' : '') + text, color);
        if (say && this.game.audio) this.game.audio.say(typeof say === 'string' ? say : (from && from !== 'INTEL' ? from.toLowerCase() + ', ' : '') + text.toLowerCase(), priority, voice);
        this.game.events.emit('radio', msg);
        return msg;
    }

    // ═════════════ Geography ═════════════
    // "KD 412 883" → { x, z, size } (the centre of that square), or null
    parseGrid(ref) { return parseGrid(ref); }

    // Grid reference: a 10 km square (two letters) and metres within it to 10 m ("KD 412 883")
    grid(x, z) {
        const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const cx = Math.floor(x / 10000) + 12, cz = Math.floor(-z / 10000) + 12;
        const ex = Math.floor(((x % 10000) + 10000) % 10000 / 10), nz = Math.floor(((-z % 10000) + 10000) % 10000 / 10);
        return L[clamp(cx, 0, 23)] + L[clamp(cz, 0, 23)] + ' ' + String(ex).padStart(3, '0') + ' ' + String(nz).padStart(3, '0');
    }

    // "7.2 KM BRG 045" from the player (or the camera)
    describePos(pos) {
        const g = this.game, from = g.player && g.player.alive && !g.pilotMode ? g.player.pos : g.camera.position;
        const dx = pos.x - from.x, dz = pos.z - from.z;
        const brg = Math.round(((Math.atan2(dx, -dz) * 57.2958) + 360) % 360);
        return (Math.hypot(dx, dz) / 1000).toFixed(1) + ' KM BRG ' + String(brg).padStart(3, '0') + ' · GRID ' + this.grid(pos.x, pos.z);
    }

    bearingRange(from, to) {
        const dx = to.x - from.x, dz = to.z - from.z;
        return { brg: Math.round(((Math.atan2(dx, -dz) * 57.2958) + 360) % 360), km: Math.hypot(dx, dz) / 1000 };
    }

    // Who holds the ground at (x, z): 'red' north of the front (and in the far north), 'blue' elsewhere.
    // The red side is the polygon the tactical map shades: the front, carried on far west and east, closed round
    // the north — so a front that bends back on itself as it moves (front.js) still answers correctly.
    sideAt(x, z) {
        const P = this.frontPoly();
        let inside = false;
        for (let i = 0, n = P.length, j = n - 2; i < n; j = i, i += 2) {
            const xi = P[i], zi = P[i + 1], xj = P[j], zj = P[j + 1];
            if ((zi > z) !== (zj > z) && x < xi + (z - zi) / (zj - zi) * (xj - xi)) inside = !inside;
        }
        return inside ? 'red' : 'blue';
    }

    // the red-side polygon as flat [x0, z0, x1, z1, …], rebuilt when the front changes
    frontPoly() {
        const F = this.front;
        if (this._poly && this._polyOf === F) return this._poly;
        const BIG = 1e7, n = F.length, P = new Float64Array((n + 4) * 2);
        let k = 0;
        const put = (x, z) => { P[k++] = x; P[k++] = z; };
        put(F[0].x - BIG, F[0].z);
        for (const p of F) put(p.x, p.z);
        put(F[n - 1].x + BIG, F[n - 1].z);
        put(F[n - 1].x + BIG, -BIG);
        put(F[0].x - BIG, -BIG);
        this._poly = P; this._polyOf = F;
        return P;
    }

    setFront(points) { this.front = points.map(p => ({ x: p.x, z: p.z })); this.game.events.emit('warFront', this.front); }

    // ═════════════ Radar coverage ═════════════
    // Does `team`'s radar network see a point? Returns 0..1 (best radar's quality). Radars are units of class
    // 'radar' / 'sam-radar' (and airborne early warning: 'awacs') with an optional radarRange; low flyers hide
    // under the radar horizon and behind terrain.
    coverage(team, pos) {
        let best = 0;
        for (const u of this.units) {
            if (!u.alive || u.team !== team || u.emitting === false) continue; // (emitting false: packed up or silent)
            const rec = this.recs.get(u);
            if (rec.cls !== 'radar' && rec.cls !== 'sam-radar' && rec.cls !== 'awacs' && !u.radarRange) continue;
            if (u.jammed && this.time < u.jammed) continue;
            const R0 = u.radarRange || (rec.cls === 'awacs' ? 250000 : rec.cls === 'sam-radar' ? 60000 : 90000);
            const d = u.pos.distanceTo(pos);
            if (d > R0) continue;
            // noise jamming shrinks what's left of the range (burn-through inside it)
            const R = R0 * this.jamFactor(team, u.pos, pos);
            if (d > R) continue;
            // radar horizon (4/3 earth): ~4.12 (√h1 + √h2) km — an airborne radar's from its altitude
            const h1 = Math.max(u.pos.y - Math.max(terrainHeight(u.pos.x, u.pos.z), 0), 0) + 10;
            const h2 = Math.max(pos.y - Math.max(terrainHeight(pos.x, pos.z), 0), 0);
            if (d > 4120 * (Math.sqrt(h1) + Math.sqrt(h2))) continue;
            // terrain in the way: a low flyer behind a ridge is hidden from an AWACS too
            if (!this.radarLOS(_v3.copy(u.pos).setY(u.pos.y + 12), pos)) continue;
            best = Math.max(best, 1 - (d / R0) * 0.6);
        }
        return best;
    }

    // line of sight for a radar: the usual samples, plus closer ones over the last few km before the target (where
    // a low flyer's cover is: the samples of a 100 km look are too far apart to find a ridge)
    radarLOS(a, b) {
        if (!this.lineOfSight(a, b)) return false;
        const d = a.distanceTo(b);
        if (d < 4000) return true;
        const span = Math.min(6000, d * 0.4) / d;
        for (let i = 1; i <= 8; i++) {
            const t = 1 - span * i / 9;
            const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
            if (terrainHeight(x, z) > y + 2) return false;
        }
        return true;
    }

    // Electronic warfare: the share of its range a `team` radar at `from` keeps looking at `to` through the other
    // side's jamming (1: none). The air-support plug-in (airsupport.js / ew.js) sets war.jam; coverage, the
    // player's radar and SAM fire control go through here.
    jamFactor(team, from, to) { return this.jam ? this.jam(team, from, to) : 1; }

    // ═════════════ Clearings ═════════════
    // Ground kept free of trees for an installation (a missile site, a SAM battery, a hidden compound's yard):
    // the forest planting skips it, and the tree tiles it touches are replanted
    addClearing(x, z, r) {
        const w = this.game.world;
        if (!w.clearings) {
            w.clearings = [];
            const prev = w.blockTree;
            w.blockTree = (px, pz) => (prev ? prev(px, pz) : false) || w.clearings.some(c => (px - c.x) * (px - c.x) + (pz - c.z) * (pz - c.z) < c.r2);
        }
        w.clearings.push({ x, z, r, r2: r * r });
        this.replant(x, z, r);
    }

    clearClearings() {
        const w = this.game.world;
        if (!w.clearings || !w.clearings.length) return;
        const old = w.clearings.splice(0);
        for (const c of old) this.replant(c.x, c.z, c.r);
    }

    replant(x, z, r) {
        const w = this.game.world, T = w.TILE;
        if (!w.tiles || !T) return;
        for (const [key, t] of w.tiles) {
            const [tx, tz] = key.split(',').map(Number);
            if (x + r < tx * T || x - r > (tx + 1) * T || z + r < tz * T || z - r > (tz + 1) * T) continue;
            t.treesDone = false;
        }
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.enabled) return;
        this.time += dt;
        this.syncT -= dt;
        if (this.syncT <= 0) { this.syncT = 0.5; this.sync(); this.prune(); }
        this.updateSensors(dt);
    }

    // drop units that are gone for good (removed wrecks); dead ones stay (persistent damage, BDA)
    prune() {
        const g = this.game;
        for (let i = this.units.length - 1; i >= 0; i--) {
            const u = this.units[i];
            const rec = this.recs.get(u);
            const gone = (rec.cls === 'aircraft' || rec.cls === 'helicopter') ? !g.aircraft.includes(u) && !AIR_TARGETS.includes(u) : false;
            if (gone || u.removed) { this.recs.delete(u); this.units.splice(i, 1); }
        }
    }
}

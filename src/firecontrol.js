// ═══════════════════════════════════════════════════════════════
// The logic behind the consoles (docs/WAR.md "Interiors and boats") — plain state machines, no three.js scene,
// no DOM, so the tests run them headless. warrooms.js wires them to the rooms' buttons and screens.
//  • SubControl: the submarine's ship control station — engine orders (bells), rudder, ordered depth, rig for dive,
//    dive / surface / emergency blow, masts; it moves the boat (depth, speed, course, the down angle)
//  • SubFireControl: a Tomahawk / Harpoon launch from the boat's payload tubes, the way it's done: select the target
//    and the weapon, weapon key, spin up, firing point procedures (the ship at launch depth and slow), solution,
//    open the muzzle hatch, then FIRE under its guard
//  • StrikeConsole: a strike console (the carrier's CIC, the JOC): shooter, weapon, target, LAUNCH
//  • TelPanel: a Scud-style TEL's launch panel: parking brake, jacks, launch table, erect, align, target, arm,
//    launch; then lower, jacks up and drive off
// ═══════════════════════════════════════════════════════════════

export const KT = 1.94384;
export const FT = 0.3048;

// ═════════════ Ship control ═════════════
export const SUB_BELLS = [
    { id: 'back13', label: 'BACK 1/3', kt: -5 }, { id: 'stop', label: 'ALL STOP', kt: 0 }, { id: 'ahead13', label: 'AHEAD 1/3', kt: 5 },
    { id: 'ahead23', label: 'AHEAD 2/3', kt: 10 }, { id: 'std', label: 'AHEAD STANDARD', kt: 15 }, { id: 'full', label: 'AHEAD FULL', kt: 20 },
    { id: 'flank', label: 'AHEAD FLANK', kt: 28 },
];
export const SUB_RUDDER = [-30, -15, -5, 0, 5, 15, 30];              // degrees (− = left)
export const SUB_DEPTHS = [                                            // keel depth ordered (feet, as the US Navy orders it)
    { label: 'SURFACE', ft: 0 }, { label: 'PERISCOPE DEPTH', ft: 60 }, { label: '150 FEET', ft: 150 },
    { label: '300 FEET', ft: 300 }, { label: '500 FEET', ft: 500 }, { label: '800 FEET', ft: 800 },
];
export const MASTS = ['periscope_1', 'periscope_2', 'esm', 'hdr', 'comms', 'radar'];

// spec: draft (m, keel below the waterline surfaced), pd (m: the boat's depth offset at periscope depth — naval.js
// layout.periscopeDepth), testDepth (m keel), L (m)
export class SubControl {
    constructor(spec = {}) {
        this.spec = { draft: 8.8, pd: 9.4, testDepth: 244, L: 140, accel: 0.09, maxRise: 1.1, maxSink: 1.5, ...spec };
        this.bell = 1;                 // ALL STOP
        this.rudder = 3;               // MIDSHIPS
        this.orderedIx = 0;            // SURFACE
        this.depth = 0;                // m below the surfaced trim (naval.js ship.depth)
        this.vDepth = 0;               // m/s, + = going down
        this.speed = 0;                // m/s through the water
        this.yawRate = 0;              // rad/s, + = to port (left)
        this.trim = 0;                 // rad, + = bow up (a dive puts the bow down)
        this.rigged = false;           // rigged for dive: every hull opening shut
        this.hatchOpen = false;        // the escape trunk's hatch (someone went up or came down)
        this.blow = 0;                 // emergency blow: s of it left
        this.alarm = null;             // { kind: 'dive' | 'surface', t }
        this.masts = {}; this.mastWant = {};
        for (const m of MASTS) { this.masts[m] = 0; this.mastWant[m] = 0; }
        this.floor = Infinity;         // the sea bed under the boat (m of water), set by the caller
        this.msg = null;               // the last complaint ('HATCH OPEN — CAN\'T DIVE'), for the display
        this.t = 0;
    }

    get keel() { return this.spec.draft + this.depth; }              // keel depth (m)
    get keelFt() { return this.keel / FT; }
    get surfaced() { return this.depth < 0.5; }
    get atPD() { return Math.abs(this.depth - this.spec.pd) < 1.2; }
    get ordered() { return SUB_DEPTHS[this.orderedIx]; }
    // the boat's depth offset for an ordered depth (keel feet → naval.js depth)
    depthFor(ix) { const ft = SUB_DEPTHS[ix].ft; return ft <= 0 ? 0 : ft === 60 ? this.spec.pd : Math.max(0, ft * FT - this.spec.draft); }
    get orderedKt() { return SUB_BELLS[this.bell].kt; }

    // ── orders (each returns true, or a reason it can't) ──
    setBell(i) { this.bell = Math.max(0, Math.min(SUB_BELLS.length - 1, i)); return true; }
    setRudder(i) { this.rudder = Math.max(0, Math.min(SUB_RUDDER.length - 1, i)); return true; }
    setRig(on) {
        if (on && this.hatchOpen) return (this.msg = 'HATCH OPEN — SHUT THE ESCAPE TRUNK FIRST');
        if (!on && !this.surfaced) return (this.msg = 'SUBMERGED — HULL OPENINGS STAY SHUT');
        this.rigged = !!on; this.msg = null; return true;
    }
    orderDepth(ix) {
        ix = Math.max(0, Math.min(SUB_DEPTHS.length - 1, ix));
        if (ix > 0 && !this.rigged) { return (this.msg = 'NOT RIGGED FOR DIVE — RIG FOR DIVE FIRST'); }
        if (ix > 0 && this.hatchOpen) { return (this.msg = 'HATCH OPEN — CAN\'T DIVE'); }
        const d = this.depthFor(ix);
        if (d + this.spec.draft > this.floor - 12) { return (this.msg = 'SHOAL WATER — ONLY ' + Math.round(this.floor / FT) + ' FEET UNDER THE KEEL HERE'); }
        this.orderedIx = ix; this.msg = null;
        return true;
    }
    dive() {
        const r = this.orderDepth(Math.max(1, this.orderedIx === 0 ? 1 : this.orderedIx));
        if (r === true) this.alarm = { kind: 'dive', t: this.t };
        return r;
    }
    surface() { this.orderedIx = 0; this.alarm = { kind: 'surface', t: this.t }; this.msg = null; return true; }
    emergencyBlow() { this.orderedIx = 0; this.blow = 12; this.bell = Math.max(this.bell, 5); this.alarm = { kind: 'surface', t: this.t }; this.msg = null; return true; }
    raiseMast(name, up) {
        if (!(name in this.masts)) return 'NO SUCH MAST';
        if (up && this.depth > this.spec.pd + 3) return (this.msg = 'TOO DEEP TO RAISE MASTS — COME TO PERISCOPE DEPTH');
        this.mastWant[name] = up ? 1 : 0; this.msg = null;
        return true;
    }
    openHatch(open) {
        if (open && !this.surfaced) return (this.msg = 'SUBMERGED — THE HATCH STAYS SHUT');
        this.hatchOpen = !!open;
        if (open) this.rigged = false;
        return true;
    }

    // ── per step: speed, depth and trim follow the orders; masts slide ──
    update(dt) {
        const S = this.spec;
        this.t += dt;
        // speed: the shaft answers the bell slowly (a 7,800 t boat)
        // (backing only stops her: a boat doesn't go astern here)
        const want = Math.max(0, this.orderedKt / KT * (this.blow > 0 ? 1.1 : 1));
        const dv = want - this.speed, a = S.accel * (want < this.speed ? (this.orderedKt < 0 ? 3 : 1.6) : 1);
        this.speed += Math.max(-a * dt, Math.min(a * dt, dv));
        // depth: the planes work with way on; stopped, it's slow ballast work. Keel off the bottom.
        const target = Math.min(this.depthFor(this.orderedIx), Math.max(0, this.floor - S.draft - 10));
        const planes = Math.min(1, Math.abs(this.speed) / 4);
        const maxSink = S.maxSink * (0.25 + 0.75 * planes), maxRise = this.blow > 0 ? 4.5 : S.maxRise * (0.4 + 0.6 * planes);
        const err = target - this.depth;
        const vWant = Math.max(-maxRise, Math.min(maxSink, err * 0.12 * (1 + planes)));
        this.vDepth += (vWant - this.vDepth) * Math.min(1, dt * 0.8);
        this.depth = Math.max(0, this.depth + this.vDepth * dt);
        if (this.depth <= 0 && this.vDepth < 0) this.vDepth = 0;
        if (this.blow > 0) this.blow = Math.max(0, this.blow - dt);
        // the down angle while diving (up while rising): the planes drive the bow
        const tWant = -Math.atan2(this.vDepth, Math.max(2, Math.abs(this.speed))) * 1.4;
        this.trim += (Math.max(-0.2, Math.min(0.2, tWant)) - this.trim) * Math.min(1, dt * 0.6);
        // the rudder turns it (+ right = heading down): yaw rate ∝ speed
        const rd = SUB_RUDDER[this.rudder];
        this.yawRate = -(rd / 30) * this.speed / 230;
        // masts: 6 s up or down; a mast can't stay up deep (they housed themselves)
        for (const m of MASTS) {
            if (this.depth > S.pd + 4) this.mastWant[m] = 0;
            const w = this.mastWant[m], k = this.masts[m];
            this.masts[m] = k + Math.max(-dt / 6, Math.min(dt / 6, w - k));
        }
        if (this.alarm && this.t - this.alarm.t > 6) this.alarm = null;
        return this;
    }
}

// ═════════════ Submarine fire control ═════════════
// ctx (warrooms.js; a stub in the tests):
//   targets() → [{ key, label, kind: 'land' | 'sea', pos, unit|null, mark|null, grid }]
//   stock(weapon) → n · tubes() → [{ i, label, cells: n loaded }] · link() → bool (a comms mast up, or surfaced)
//   shipReady() → { ok, why } · range(weapon, target) → { ok, km, max } · hatch(tube, open) (animates)
//   launch(weapon, target, tube) → a strike or null · now() → seconds
export const SUB_WEAPONS = {
    tlam: { name: 'BGM-109 TOMAHAWK (TLAM)', short: 'TLAM', vs: 'land', spinup: 9 },
    harpoon: { name: 'UGM-84 HARPOON', short: 'HARPOON', vs: 'sea', spinup: 6 },
};

export class SubFireControl {
    constructor(ctx) {
        this.ctx = ctx;
        this.reset(true);
        this.log = [];
    }

    reset(hard = false) {
        if (!hard && this.tube != null && this.hatchOpen) this.ctx.hatch(this.tube, false);
        this.target = hard ? null : this.target;
        this.weapon = hard ? 'tlam' : this.weapon;
        this.tube = null;
        this.armed = false;
        this.spin = 0;                // 0 … 1 (spin-up progress), -1 not started
        this.spinning = false;
        this.fpp = false;             // firing point procedures ordered
        this.solution = 0;            // 0 … 1 (mission data load)
        this.hatchOpen = false; this.hatchK = 0;
        this.fired = null;
    }

    say(t) { this.log.push({ t: this.ctx.now(), text: t }); if (this.log.length > 12) this.log.shift(); }

    // the checklist the launch display shows, top to bottom: { id, label, done, ready (can be done now), why }
    steps() {
        const c = this.ctx, sr = c.shipReady(), rg = this.target ? c.range(this.weapon, this.target) : null;
        return [
            { id: 'link', label: 'TARGET DATA LINK', done: c.link(), why: 'RAISE A COMMS MAST AT PERISCOPE DEPTH (OR SURFACE)' },
            { id: 'target', label: 'TARGET SELECTED', done: !!this.target, why: 'PICK A TARGET ON THE TARGETS CONSOLE' },
            { id: 'weapon', label: 'WEAPON ' + SUB_WEAPONS[this.weapon].short, done: !!this.target && this.weaponFits() && c.stock(this.weapon) > 0, why: c.stock(this.weapon) <= 0 ? 'NO ' + SUB_WEAPONS[this.weapon].short + ' LEFT' : 'WRONG WEAPON FOR THE TARGET' },
            { id: 'range', label: 'IN RANGE' + (rg ? ' (' + Math.round(rg.km) + ' KM)' : ''), done: !!rg && rg.ok, why: rg ? 'OUT OF RANGE (' + Math.round(rg.km) + ' / ' + Math.round(rg.max) + ' KM)' : '' },
            { id: 'tube', label: this.tube != null ? 'TUBE ' + this.tubeLabel() : 'TUBE', done: this.tube != null, why: 'NO LOADED TUBE' },
            { id: 'key', label: 'WEAPON KEY', done: this.armed, why: 'TURN THE WEAPON KEY' },
            { id: 'spin', label: this.spinning ? 'SPIN UP ' + Math.round(this.spin * 100) + '%' : 'SPIN UP', done: this.spin >= 1, why: 'PRESS SPIN UP' },
            { id: 'fpp', label: 'FIRING POINT PROCEDURES', done: this.fpp, why: 'ORDER FIRING POINT PROCEDURES' },
            { id: 'ship', label: 'SHIP READY', done: this.fpp && sr.ok, why: sr.why },
            { id: 'weaponReady', label: 'WEAPON READY', done: this.weaponReady(), why: 'SPIN UP AND KEY' },
            { id: 'solution', label: 'SOLUTION READY', done: this.solutionReady(), why: 'TARGET AND WEAPON DATA LOADING' },
            { id: 'hatch', label: 'MUZZLE HATCH OPEN', done: this.hatchOpen && this.hatchK >= 1, why: 'OPEN THE MUZZLE HATCH' },
        ];
    }
    weaponFits() { const t = this.target; return !t || SUB_WEAPONS[this.weapon].vs === (t.kind === 'sea' ? 'sea' : 'land') || this.weapon === 'tlam'; }
    tubeLabel() { const t = this.ctx.tubes().find(x => x.i === this.tube); return t ? t.label : String(this.tube + 1); }
    shipReady() { return this.fpp && this.ctx.shipReady().ok; }
    weaponReady() { return this.armed && this.spin >= 1 && this.tube != null; }
    solutionReady() { const rg = this.target ? this.ctx.range(this.weapon, this.target) : null; return !!rg && rg.ok && this.weaponReady() && this.solution >= 1 && this.ctx.link(); }
    get canFire() { return this.shipReady() && this.weaponReady() && this.solutionReady() && this.hatchOpen && this.hatchK >= 1; }
    // the first thing still missing (what the FIRE button says when it won't)
    blocker() { const s = this.steps().find(x => !x.done); return s ? s.why || s.label : ''; }

    // ── inputs ──
    selectTarget(t) {
        if (!t) return 'NO TARGET';
        this.target = t;
        this.solution = 0;
        if (t.kind === 'sea' && this.ctx.stock('harpoon') > 0) this.weapon = 'harpoon';
        else if (t.kind !== 'sea') this.weapon = 'tlam';
        this.say('TARGET: ' + t.label);
        return true;
    }
    selectWeapon(w) {
        if (!SUB_WEAPONS[w]) return 'NO SUCH WEAPON';
        if (this.spin > 0 || this.spinning) return 'ABORT FIRST — A WEAPON IS SPUN UP';
        this.weapon = w; this.solution = 0;
        this.say('WEAPON: ' + SUB_WEAPONS[w].short);
        return true;
    }
    selectTube(i) {
        if (this.hatchOpen) return 'SHUT THE MUZZLE HATCH FIRST';
        const t = this.ctx.tubes().find(x => x.i === i);
        if (!t || t.cells <= 0) return 'TUBE EMPTY';
        this.tube = i; this.spin = 0; this.spinning = false;
        return true;
    }
    autoTube() {
        if (this.tube != null) { const t = this.ctx.tubes().find(x => x.i === this.tube); if (t && t.cells > 0) return true; }
        const t = this.ctx.tubes().find(x => x.cells > 0);
        if (!t) return 'NO LOADED TUBE';
        this.tube = t.i;
        return true;
    }
    setKey(on) { this.armed = !!on; if (!on) { this.spin = 0; this.spinning = false; } this.say(on ? 'WEAPON KEY — ARMED' : 'WEAPON KEY — SAFE'); return true; }
    spinUp() {
        if (!this.target) return 'SELECT A TARGET FIRST';
        if (this.ctx.stock(this.weapon) <= 0) return 'NO ' + SUB_WEAPONS[this.weapon].short + ' LEFT';
        const r = this.autoTube();
        if (r !== true) return r;
        if (!this.armed) return 'TURN THE WEAPON KEY FIRST';
        if (this.spinning || this.spin >= 1) return true;
        this.spinning = true; this.spin = 0;
        this.say('SPIN UP ' + SUB_WEAPONS[this.weapon].short + ' IN TUBE ' + this.tubeLabel());
        return true;
    }
    orderFpp() { this.fpp = true; this.say('FIRING POINT PROCEDURES — ' + SUB_WEAPONS[this.weapon].short); return true; }
    openMuzzle() {
        if (!this.weaponReady()) return 'WEAPON NOT READY';
        if (!this.fpp) return 'ORDER FIRING POINT PROCEDURES FIRST';
        if (!this.ctx.shipReady().ok) return this.ctx.shipReady().why;
        if (this.hatchOpen) return true;
        this.hatchOpen = true; this.hatchK = 0;
        this.ctx.hatch(this.tube, true);
        this.say('OPENING MUZZLE HATCH, TUBE ' + this.tubeLabel());
        return true;
    }
    abort() {
        if (this.hatchOpen && this.tube != null) this.ctx.hatch(this.tube, false);
        const was = this.spinning || this.spin > 0 || this.fpp;
        this.spin = 0; this.spinning = false; this.fpp = false; this.solution = 0; this.hatchOpen = false; this.hatchK = 0;
        if (was) this.say('CHECK FIRE — ABORT');
        return true;
    }
    fire() {
        if (!this.canFire) return this.blocker() || 'NOT READY';
        const s = this.ctx.launch(this.weapon, this.target, this.tube);
        if (!s) return 'LAUNCH FAILED';
        this.fired = { t: this.ctx.now(), weapon: this.weapon, target: this.target, strike: s };
        this.say('FIRE! — ' + SUB_WEAPONS[this.weapon].short + ' AWAY, TUBE ' + this.tubeLabel());
        const tube = this.tube;
        this.spin = 0; this.spinning = false; this.solution = 0; this.fpp = false;
        this.shutAt = this.ctx.now() + 6; this.shutTube = tube;
        this.tube = null;
        return true;
    }

    update(dt) {
        if (this.spinning) {
            this.spin = Math.min(1, this.spin + dt / SUB_WEAPONS[this.weapon].spinup);
            if (this.spin >= 1) { this.spinning = false; this.say('WEAPON READY — ' + SUB_WEAPONS[this.weapon].short); }
        }
        if (this.weaponReady() && this.target && this.ctx.link()) this.solution = Math.min(1, this.solution + dt / 4);
        if (this.hatchOpen) this.hatchK = Math.min(1, this.hatchK + dt / 2.5);
        // the tube's hatch shuts again a few seconds after the missile's gone
        if (this.shutAt != null && this.ctx.now() >= this.shutAt) { this.ctx.hatch(this.shutTube, false); this.shutAt = null; this.hatchOpen = false; this.hatchK = 0; }
        if (this.target && this.target.unit && this.target.unit.alive === false && !this.fired) { /* a dead target stays selected: BDA says so */ }
    }
}

// ═════════════ A strike console (CIC, JOC) ═════════════
// ctx: shooters() → [{ key, name, src, stock: { tlam: n, … }, km(target) }] · targets() → as above ·
//      launch(src, weapon, target, n) → strike | null · auto(type, target) → strike | null (strikes.request)
export class StrikeConsole {
    constructor(ctx) { this.ctx = ctx; this.shooter = null; this.weapon = null; this.target = null; this.n = 1; this.armed = false; this.last = null; this.msg = ''; }
    select(what, v) {
        if (what === 'shooter') { this.shooter = v; if (v && (!this.weapon || !(v.stock[this.weapon] > 0))) this.weapon = Object.keys(v.stock).find(k => v.stock[k] > 0) || null; }
        else if (what === 'weapon') this.weapon = v;
        else if (what === 'target') this.target = v;
        else if (what === 'n') this.n = Math.max(1, Math.min(4, v));
        this.armed = false;
        return true;
    }
    ready() {
        if (!this.target) return 'SELECT A TARGET';
        if (!this.shooter) return 'SELECT A SHOOTER';
        if (!this.weapon || !(this.shooter.stock[this.weapon] > 0)) return 'NO WEAPON — THE SHOOTER IS EMPTY';
        const km = this.shooter.km ? this.shooter.km(this.target) : 0, max = this.shooter.rangeKm || 1e9;
        if (km > max) return 'OUT OF RANGE (' + Math.round(km) + ' KM)';
        return true;
    }
    arm() { const r = this.ready(); if (r !== true) return (this.msg = r); this.armed = true; this.msg = 'ARMED — LAUNCH WHEN READY'; return true; }
    launch() {
        const r = this.ready();
        if (r !== true) return (this.msg = r);
        if (!this.armed) return (this.msg = 'ARM FIRST');
        const s = this.ctx.launch(this.shooter.src, this.weapon, this.target, this.n);
        this.armed = false;
        if (!s) return (this.msg = 'UNABLE — NO LAUNCH');
        this.last = s;
        this.msg = 'LAUNCHED — ' + this.n + '× ' + this.weapon.toUpperCase() + ' FROM ' + this.shooter.name;
        return true;
    }
}

// ═════════════ A TEL's launch panel ═════════════
// ctx: pose(group, k) (vehicles.js: 'jack' | 'pad' | 'raise'), missile() → bool (one on the rail), targets(),
//      range(target) → { ok, km, max }, launch(target) → strike | null, moving() → bool, now()
// Times are shortened from the real ones (the Scud's ~1 h from halt to launch; erecting ~4-5 min).
export const TEL_TIMES = { jack: 8, pad: 5, raise: 14, align: 6, lower: 12 };
export class TelPanel {
    constructor(ctx) {
        this.ctx = ctx;
        this.brake = false;
        this.k = { jack: 0, pad: 0, raise: 0 };
        this.want = { jack: 0, pad: 0, raise: 0 };
        this.align = 0; this.aligning = false;
        this.target = null; this.armed = false; this.launched = false; this.count = 0;
        this.msg = '';
    }
    get stowed() { return this.k.jack <= 0 && this.k.pad <= 0 && this.k.raise <= 0; }
    get erected() { return this.k.raise >= 1; }
    // can it drive? (everything stowed and the brake off)
    get canDrive() { return this.stowed && !this.brake; }
    no(t) { this.msg = t; return t; }
    setBrake(on) { if (!on && !this.stowed) return this.no('STOW THE LAUNCHER FIRST'); if (on && this.ctx.moving()) return this.no('STOP THE TRUCK FIRST'); this.brake = !!on; this.msg = ''; return true; }
    jacks(down) {
        if (down && !this.brake) return this.no('SET THE PARKING BRAKE');
        if (!down && (this.k.pad > 0 || this.k.raise > 0 || this.want.pad > 0 || this.want.raise > 0)) return this.no('LOWER THE MISSILE AND STOW THE TABLE FIRST');
        this.want.jack = down ? 1 : 0; this.msg = ''; return true;
    }
    table(down) {
        if (down && this.k.jack < 1) return this.no('JACKS NOT DOWN');
        if (!down && (this.k.raise > 0 || this.want.raise > 0)) return this.no('LOWER THE MISSILE FIRST');
        this.want.pad = down ? 1 : 0; this.msg = ''; return true;
    }
    erect(up) {
        if (up && (this.k.jack < 1 || this.k.pad < 1)) return this.no('JACKS AND LAUNCH TABLE FIRST');
        if (up && !this.ctx.missile()) return this.no('NO MISSILE ON THE RAIL');
        this.want.raise = up ? 1 : 0;
        if (!up) { this.align = 0; this.aligning = false; this.armed = false; }
        this.msg = ''; return true;
    }
    startAlign() {
        if (!this.erected) return this.no('ERECT THE MISSILE FIRST');
        if (!this.target) return this.no('SELECT A TARGET FIRST');
        this.aligning = true; this.align = 0; this.msg = ''; return true;
    }
    selectTarget(t) { this.target = t; this.align = 0; this.aligning = false; this.armed = false; return true; }
    arm(on) {
        if (on && this.align < 1) return this.no('NOT ALIGNED');
        this.armed = !!on; this.msg = ''; return true;
    }
    ready() {
        if (!this.erected) return 'MISSILE NOT ERECTED';
        if (!this.target) return 'NO TARGET';
        const rg = this.ctx.range(this.target);
        if (!rg.ok) return 'OUT OF RANGE (' + Math.round(rg.km) + ' / ' + Math.round(rg.max) + ' KM)';
        if (this.align < 1) return 'NOT ALIGNED';
        if (!this.armed) return 'NOT ARMED';
        if (!this.ctx.missile()) return 'NO MISSILE';
        return true;
    }
    launch() {
        const r = this.ready();
        if (r !== true) return this.no(r);
        const s = this.ctx.launch(this.target);
        if (!s) return this.no('LAUNCH FAILED');
        this.launched = true; this.count++; this.armed = false; this.align = 0;
        this.msg = 'MISSILE AWAY';
        return true;
    }
    update(dt) {
        for (const g of ['jack', 'pad', 'raise']) {
            const w = this.want[g], k = this.k[g], T = TEL_TIMES[g === 'raise' ? (w > k ? 'raise' : 'lower') : g];
            if (w !== k) { this.k[g] = k + Math.max(-dt / T, Math.min(dt / T, w - k)); this.ctx.pose(g, this.k[g]); }
        }
        if (this.aligning) { this.align = Math.min(1, this.align + dt / TEL_TIMES.align); if (this.align >= 1) this.aligning = false; }
    }
}

// ═══════════════════════════════════════════════════════════════
// Command rooms (docs/WAR.md "Interiors and boats"), plugged into the interiors framework:
//  • CarrierOps: the home carrier's island — its doors on the flight deck, the Combat Direction Center (CIC:
//    the air picture, the surface picture, and a strike console that fires the group's escorts' Tomahawks and
//    Harpoons through their ShipVLS) and Pri-Fly (glass all round over the flight deck: deck status, the wind,
//    the deck camera, a jet spotted on the catapult for you, an alert fighter launched); the accommodation ladder
//    and the duty boat
//  • JocOps: the Joint Operations Center at the home base — a hardened building in the world (solid, and a
//    target), and inside, the operations floor: the video wall (the map, intel, tasks, the front, strikes, the
//    radio) and consoles for strikes, intel, tasks, the whole command menu and the radio log
//  • TelOps: a captured Scud TEL in the JOC's compound — its launch control cabin (jacks, launch table, erector,
//    gyrocompass alignment, the code lock, launch) and its cab, to drive it away
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { dressRoom, say, targetList, markFor, clockZ, CameraFeed } from './warrooms.js';
import { StrikeConsole, TelPanel } from './firecontrol.js';
import { C, f, page, readout, text, compass, MapView, bearing, hdgDeg } from './screens.js';
import { openHatch } from './naval.js';
import { MISSILES, STRIKE_TYPES, GroundLauncher } from './strikes.js';
import { INTEL, INTEL_NAMES } from './war.js';
import { BASES, baseToWorld } from './world.js';
import { terrainHeight } from './terraincore.js';
import { WORLD_BUILDINGS } from './buildings.js';
import { Aircraft } from './aircraft.js';
import { Pilot } from './ai.js';
import { KT } from './boats.js';
import { clamp, damp, rand, updateWorldChain } from './util.js';
import * as V from './vehicles.js';
import { dress } from './dressing.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const one = new THREE.Vector3(1, 1, 1);
const report = (g, r) => { if (r !== true && r) { g.addFeed(r, '#ffc23f'); g.audio.tick(260, 0.08, 0.06); } return r; };

// ═════════════ The carrier's island ═════════════
const CIC_OFFSET = new THREE.Vector3(-6, 13.0, 20);          // (ship-local: the gallery deck below the flight deck)
const PRIFLY_OFFSET = new THREE.Vector3(15.85, 34.4, 37.5);   // (ship-local: the glass cab at the island's top)
const LADDER_TOP = new THREE.Vector3(18.3, 0, 106);           // (ship-local x, z on the flight deck over the accommodation ladder)

export class CarrierOps {
    constructor(sys, harbor) {
        this.sys = sys; this.game = sys.game; this.harbor = harbor;
        this.cic = sys.addRoom(this.cicDef());
        this.prifly = sys.addRoom(this.priflyDef());
        this.console = new StrikeConsole(this.consoleCtx());
        this.deckStatus = 2;        // 0 red, 1 amber, 2 green
        this.plat = null;
    }

    cv() { const c = this.game.naval && this.game.naval.homeCarrier; return c && c.alive && !c.gone ? c : null; }

    start(mode) {
        const sys = this.sys;
        this.clear();
        if (mode === 'rings') return;
        this.deckStatus = 2;
        const door = (name, out) => { const c = this.cv(); const d = c && c.rig.doors[name]; if (!d) return null; updateWorldChain(d.node); out.setFromMatrixPosition(d.node.matrixWorld); const l = c.toLocal(out.x, out.z); const w = c.toWorld(l.lx - 1.0, c.def.deckY, l.lz, out); w.y = c.deckHeight(w.x, w.z); return w; };
        sys.addSite({ id: 'cv:cic', label: 'ENTER THE ISLAND — COMBAT DIRECTION CENTER (CIC)', radius: 2.2, dy: 2.5, at: (o) => door('island_1', o), enter: () => this.enter(this.cic) });
        sys.addSite({ id: 'cv:prifly', label: 'ENTER THE ISLAND — PRI-FLY (PRIMARY FLIGHT CONTROL)', radius: 2.2, dy: 2.5, at: (o) => door('island_2', o), enter: () => this.enter(this.prifly) });
        sys.addSite({
            id: 'cv:ladder', label: () => this.harbor.boats.some(b => b.moored && b.moored.host === this.cv() && !b.driver) ? 'DOWN THE ACCOMMODATION LADDER — TO THE BOAT' : 'DOWN THE ACCOMMODATION LADDER — CALL AWAY THE DUTY BOAT', radius: 3, dy: 2.5,
            at: (o) => { const c = this.cv(); if (!c) return null; const w = c.toWorld(LADDER_TOP.x, c.def.deckY, LADDER_TOP.z, o); w.y = c.deckHeight(w.x, w.z); return w; },
            enter: () => this.dutyBoat(),
        });
        // a boat alongside the ladder's bottom platform can put you aboard
        this.harbor.docks.push(this.dock = {
            id: 'cv', get host() { return this.ops.cv(); }, ops: this, label: 'CLIMB THE ACCOMMODATION LADDER', text: 'CVN-73 · FLIGHT DECK',
            at: (out) => { const c = this.cv(); if (!c) return null; const p = c.rig.points.hatch_entry; if (!p) return null; updateWorldChain(p); return out.setFromMatrixPosition(p.matrixWorld); },
            step: (out) => { const c = this.cv(); const w = c.toWorld(LADDER_TOP.x - 1.5, c.def.deckY, LADDER_TOP.z - 2, out); w.y = c.deckHeight(w.x, w.z); return w; },
            yaw: () => this.cv().heading + Math.PI / 2,
            ok: () => (this.cv() ? true : 'NO CARRIER'),
        });
    }
    clear() {
        const sys = this.sys;
        for (const id of ['cv:cic', 'cv:prifly', 'cv:ladder']) sys.removeSite(id);
        if (this.dock) { const i = this.harbor.docks.indexOf(this.dock); if (i >= 0) this.harbor.docks.splice(i, 1); this.dock = null; }
        this.console = new StrikeConsole(this.consoleCtx());
    }

    enter(room) {
        if (!this.cv()) return;
        this.swing(room === this.cic ? 'island_1' : 'island_2');
        this.sys.enterRoom(room, { text: room === this.cic ? 'CVN-73 · COMBAT DIRECTION CENTER' : 'CVN-73 · PRIMARY FLIGHT CONTROL' });
    }
    // an island door swings open for someone going through, and shuts behind them
    swing(name) { this.doorT = { name: 'door_' + name, t: 2.4 }; }

    // where you stand on the flight deck by the island (travel, and leaving the island)
    deckSpot(door = 'island_1', out = false) {
        const c = this.cv(), d = c.rig.doors[door];
        updateWorldChain(d.node);
        const p = new THREE.Vector3().setFromMatrixPosition(d.node.matrixWorld);
        const l = c.toLocal(p.x, p.z);
        const w = c.toWorld(l.lx - 2.2, c.def.deckY, l.lz, new THREE.Vector3());
        w.y = c.deckHeight(w.x, w.z);
        return { pos: w, yaw: c.heading + (out ? Math.PI / 2 : -Math.PI / 2) };
    }

    dutyBoat() {
        const c = this.cv(), h = this.harbor;
        if (!c) return;
        const p = c.rig.points.hatch_entry;
        updateWorldChain(p);
        const at = _v.setFromMatrixPosition(p.matrixWorld), l = c.toLocal(at.x, at.z);
        const b = h.boatAlongside(c, l.lx + 1.6 + 1.2, l.lz, 'rhib');
        say(this.game, 'CVN-73', 'AWAY THE DUTY BOAT — STARBOARD ACCOMMODATION LADDER', { color: '#9fd4ff', say: false });
        h.board(b);
    }

    update(dt) {
        const c = this.cv();
        if (this.doorT && c) {
            const D = this.doorT;
            D.t -= dt;
            openHatch(c, D.name, clamp(Math.min(2.4 - D.t, D.t) * 2.2, 0, 1));
            if (D.t <= 0) { openHatch(c, D.name, 0); this.doorT = null; }
        }
        // the deck camera, while someone's in Pri-Fly
        const rc = this.sys.ctl;
        if (c && rc && rc.room === this.prifly) {
            this.plat = this.plat || new CameraFeed(512, 288, 5, 24);
            this.plat.update(dt, this.game, (cam) => {
                // PLAT: on the island's aft end, looking down the landing area
                c.toWorld(14, c.def.deckY + 30, 50, cam.position);
                c.toWorld(-10, c.def.deckY, 150, _v);
                cam.up.set(0, 1, 0); cam.lookAt(_v);
                return true;
            });
        }
    }

    // the group's shooters: ship VLS, our submarine; within range of the target
    consoleCtx() {
        const g = this.game;
        return {
            shooters: () => {
                const st = g.strikes, out = [];
                if (!st) return out;
                for (const s of st.sources) {
                    if (s.team !== g.war.side || !s.alive || !(s.kind === 'ship' || s.kind === 'sub')) continue;
                    const stock = {};
                    for (const [k, n] of Object.entries(s.stock)) if (n > 0 && (k === 'tlam' || k === 'harpoon')) stock[k] = n;
                    if (!Object.keys(stock).length) continue;
                    out.push({ key: 'S' + s.id, name: s.name.split(' (')[0], src: s, stock, rangeKm: s.range / 1000, km: (t) => Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) / 1000 });
                }
                return out;
            },
            launch: (src, w, t, n) => g.strikes && g.strikes.launchFrom(src, w, [markFor(g, t, 'cic')], { n }),
        };
    }

    // ── the CIC ──
    cicDef() {
        const ops = this, g = this.game;
        const K = () => ops.console;
        return {
            id: 'cvn-cic', name: 'COMBAT DIRECTION CENTER', file: 'models/interiors/cvn_cic.glb', sealed: true, exitName: 'DOOR',
            title: () => 'CVN-73 · COMBAT DIRECTION CENTER (CIC)',
            status: () => { const c = ops.cv(); if (!c) return ''; return 'HDG ' + String(Math.round(hdgDeg(c.heading))).padStart(3, '0') + ' · ' + Math.round(Math.hypot(c.vel.x, c.vel.z) * KT) + ' KT · GRID ' + g.war.grid(c.pos.x, c.pos.z) + ' · DECK ' + ['RED', 'AMBER', 'GREEN'][ops.deckStatus]; },
            anchor: (out) => { const c = ops.cv(); if (!c) return out.identity(); _m.compose(c.mesh.position, c.mesh.quaternion, one); return out.makeTranslation(CIC_OFFSET.x, CIC_OFFSET.y, CIC_OFFSET.z).premultiply(_m); },
            exitTo: () => ops.deckSpot('island_1', true),
            onExit: () => ops.swing('island_1'),
            onLoad: (room) => { dressRoom(room); for (const l of room.lights || []) { l.intensity *= 0.7; l.userData.base = l.intensity; } },
            stations: {
                stand_tao: { label: 'TACTICAL ACTION OFFICER', order: 1 }, stand_strike: { label: 'STRIKE CONSOLE', order: 2, fov: 46 },
                stand_air: { label: 'AIR DEFENSE', order: 3 }, stand_surf: { label: 'SURFACE PLOT', order: 4 }, stand_asw: { label: 'UNDERSEA WARFARE', order: 5 },
            },
            bind: {
                exit_door: { label: 'DOOR — TO THE FLIGHT DECK (LEAVE)' },
                door_prifly: { label: 'LADDER UP TO PRI-FLY', press: () => ops.sys.switchRoom(ops.prifly, { text: 'CVN-73 · PRIMARY FLIGHT CONTROL' }) },
                sw_key: { label: () => K().key ? 'STRIKE KEY — ON' : 'STRIKE KEY — OFF', value: () => !!K().key, press: () => { K().key = !K().key; if (!K().key) K().armed = false; } },
                btn_arm: { label: 'ARM THE STRIKE', press: () => { if (!K().key) return report(g, 'TURN THE STRIKE KEY FIRST'); report(g, K().arm()); } },
                btn_abort: { label: 'ABORT', press: () => { K().armed = false; K().msg = 'ABORTED'; } },
                btn_launch: { label: 'LAUNCH', press: () => { const r = K().launch(); if (r !== true) report(g, 'CAN\'T LAUNCH — ' + r); else g.audio.uiConfirm && g.audio.uiConfirm(); } },
                guard_launch: { label: 'LAUNCH GUARD' },
                lamp_armed: { lit: () => K().armed },
                lamp_launch: { lit: () => K().last && g.time - (K().last.t || 0) < 10 && K().last.missiles.some(m => m.alive) ? (Math.sin(g.time * 10) > 0 ? 1 : 0.2) : 0 },
            },
            screens: cicScreens(ops),
        };
    }

    // ── Pri-Fly ──
    priflyDef() {
        const ops = this, g = this.game;
        return {
            id: 'cvn-prifly', name: 'PRIMARY FLIGHT CONTROL', file: 'models/interiors/cvn_prifly.glb', sealed: false, shadows: true, exitName: 'LADDER',
            title: () => 'CVN-73 · PRI-FLY (PRIMARY FLIGHT CONTROL)',
            status: () => { const c = ops.cv(); if (!c) return ''; const w = ops.wind(); return 'DECK ' + ['RED', 'AMBER', 'GREEN'][ops.deckStatus] + ' · WIND OVER DECK ' + Math.round(w.kt) + ' KT ' + (w.rel >= 0 ? 'STBD ' : 'PORT ') + Math.abs(Math.round(w.rel)) + '°'; },
            anchor: (out) => {
                const c = ops.cv(); if (!c) return out.identity();
                _m.compose(c.mesh.position, c.mesh.quaternion, one);
                _m2.makeRotationY(Math.PI / 2).setPosition(PRIFLY_OFFSET);
                return out.multiplyMatrices(_m, _m2);
            },
            exitTo: () => ops.deckSpot('island_2', true),
            onExit: () => ops.swing('island_2'),
            onLoad: (room) => dressRoom(room),
            stations: { stand_boss: { label: 'AIR BOSS', order: 1 }, stand_miniboss: { label: 'MINI BOSS', order: 2 } },
            bind: {
                exit_ladder: { label: 'LADDER DOWN TO THE FLIGHT DECK (LEAVE)' },
                door_cic: { label: 'DOWN TO THE CDC (CIC)', press: () => ops.sys.switchRoom(ops.cic, { text: 'CVN-73 · COMBAT DIRECTION CENTER' }) },
                knob_deck: { label: () => 'DECK STATUS — ' + ['RED', 'AMBER', 'GREEN'][ops.deckStatus], value: () => ops.deckStatus / 2, turn: (d) => ops.setDeck(clamp(ops.deckStatus + d, 0, 2)) },
                lamp_red: { lit: () => ops.deckStatus === 0 },
                lamp_amber: { lit: () => ops.deckStatus === 1 },
                lamp_green: { lit: () => ops.deckStatus === 2 },
                btn_horn: { label: 'FLIGHT DECK HORN / 5MC', key: 'KeyH', press: () => { ops.horn(); say(g, 'AIR BOSS', 'ON THE FLIGHT DECK: FLIGHT QUARTERS, FLIGHT QUARTERS — ALL HANDS NOT INVOLVED IN FLIGHT QUARTERS STAND CLEAR', { color: '#ffc23f', say: 'Flight quarters, flight quarters.' }); } },
                btn_spot: { label: 'SPOT A JET ON CAT 1 (FOR YOU)', press: () => report(g, ops.spotJet()) },
                btn_launch: { label: 'LAUNCH THE ALERT FIGHTER', press: () => report(g, ops.alertLaunch()) },
                guard_launch: { label: 'LAUNCH GUARD' },
                btn_recover: { label: 'RECOVERY — TURN INTO THE WIND', press: () => { const c = ops.cv(); if (!c) return; c.straight = 90; say(g, 'AIR BOSS', 'BRIDGE, PRI-FLY — STEADY UP INTO THE WIND FOR RECOVERY', { color: '#9fd4ff', say: false }); } },
            },
            screens: priflyScreens(ops),
        };
    }

    setDeck(k) {
        this.deckStatus = k;
        const g = this.game;
        say(g, 'AIR BOSS', 'DECK IS ' + ['RED — NOTHING MOVES', 'AMBER — STAND BY', 'GREEN — CLEAR TO LAUNCH'][k], { color: ['#ff5a4a', '#ffc23f', '#5dffa0'][k], say: false });
        return true;
    }
    horn() {
        const a = this.game.audio;
        if (!a || !a.running) return;
        const t = a.ctx.currentTime;
        for (let i = 0; i < 3; i++) a.tone(t + i * 0.55, { type: 'square', f0: 240, f1: 236, gain: 0.14, decay: 0.45 });
    }
    wind() {
        const c = this.cv(), w = this.game.wind;
        if (!c) return { kt: 0, rel: 0 };
        const rx = w.x - c.vel.x, rz = w.z - c.vel.z; // the air over the deck (from the ship)
        const kt = Math.hypot(rx, rz) * KT;
        // relative bearing the wind comes from (+ starboard)
        const from = Math.atan2(-rx, rz), rel = ((from - c.heading + Math.PI * 3) % (Math.PI * 2) - Math.PI) * -180 / Math.PI;
        return { kt, rel, true: Math.hypot(w.x, w.z) * KT };
    }
    // a jet on catapult 1, engines idling, nobody in it: walk out and climb in (E), full power launches you
    spotJet() {
        const g = this.game, c = this.cv();
        if (!c) return 'NO CARRIER';
        if (this.deckStatus === 0) return 'DECK IS RED';
        const cat = c.catapultSpot();
        if (g.aircraft.some(a => a.alive && a.deck === c && a.pos.distanceTo(cat) < 25)) return 'CAT 1 IS OCCUPIED';
        const a = new Aircraft(g, 'fa18', { team: 'blue', name: 'ALERT 1' });
        a.spawnDeck(c);
        a.abandoned = true;
        g.rearm && g.rearm(a);
        g.aircraft.push(a);
        this.spotted = a;
        say(g, 'AIR BOSS', 'F/A-18 SPOTTED ON CAT 1 — WALK OUT, CLIMB IN, FULL POWER AND SALUTE THE SHOOTER', { color: '#5dffa0', say: false });
        g.navTarget = { pos: a.pos, label: 'CAT 1' };
        return true;
    }
    // an alert F/A-18 off the bow (a deck-ops plug-in may own real launches: game.naval.launchAlert)
    alertLaunch() {
        const g = this.game, c = this.cv();
        if (!c) return 'NO CARRIER';
        if (this.deckStatus !== 2) return 'DECK ISN\'T GREEN';
        if (g.naval.launchAlert) return g.naval.launchAlert(c) ? true : 'NO ALERT JET';
        if (g.aircraft.filter(a => a.alertOf === c && a.alive).length >= 2) return 'THE ALERT FIGHTERS ARE UP';
        const bow = c.toWorld(12, c.def.deckY + 10, -c.def.L * 0.55, new THREE.Vector3());
        const a = new Aircraft(g, 'fa18', { team: 'blue', name: 'VIPER ' + (21 + g.aircraft.filter(x => x.alertOf).length) });
        a.spawnAir(bow, c.heading, 0.33);
        a.vel.add(c.vel);
        a.alertOf = c;
        const pl = new Pilot(g, a, 0.6);
        pl.home = c.pos; pl.leash = 20000;
        g.aircraft.push(a);
        g.war.add(a, { cls: 'aircraft', name: a.callsign });
        g.effects.smoke.emit(bow, _v.set(0, 5, 0), 3, 10, 30, [1, 1, 1], [0.9, 0.9, 0.9], 0.6, 0, 1, 2);
        g.audio.whoosh && g.audio.whoosh(0.6);
        say(g, 'CATAPULT 1', 'ALERT FIGHTER AWAY — ' + a.callsign, { color: '#9fd4ff', say: 'Alert fighter away.' });
        return true;
    }
}

// ── the CIC's screens ──
function cicScreens(ops) {
    const g = ops.game;
    const views = new Map();
    const mv = (s) => views.get(s) || (views.set(s, new MapView(g, s.w, s.h)), views.get(s));
    const K = () => ops.console;
    return {
        screen_lsd_air: { fps: 3, draw: (ctx, ui, s) => drawAirPicture(ctx, s, g, ops.cv(), 'AIR PICTURE — SPS-48 / CEC', 120000) },
        screen_lsd_map: { fps: 1, draw: (ctx, ui, s) => drawGroupMap(ctx, ui, s, g, ops.cv(), mv(s), 'TACTICAL PICTURE', 0.004) },
        screen_lsd_strike: { fps: 2, draw: (ctx, ui, s) => drawStrikeBoard(ctx, s, g, 'STRIKE STATUS') },
        screen_air_1: { fps: 4, draw: (ctx, ui, s) => drawAirPicture(ctx, s, g, ops.cv(), 'SPS-49 AIR SEARCH', 60000, true) },
        screen_air_2: { fps: 2, draw: (ctx, ui, s) => drawTrackList(ctx, ui, s, g, ops.cv()) },
        screen_surf: { fps: 2, draw: (ctx, ui, s) => drawSurfacePicture(ctx, ui, s, g, ops.cv()) },
        screen_asw: { fps: 2, draw: (ctx, ui, s) => drawAsw(ctx, s, g, ops.cv()) },
        screen_tao_1: { fps: 2, draw: (ctx, ui, s) => drawTao(ctx, ui, s, g, ops) },
        screen_tao_2: { fps: 2, wheel: (d) => { ops.logScroll = Math.max(0, (ops.logScroll || 0) - d); }, draw: (ctx, ui, s) => drawRadioLog(ctx, s, g, 'RADIO — NET LOG', ops.logScroll || 0) },
        screen_strike: { fps: 3, draw: (ctx, ui, s) => drawStrikeConsole(ctx, ui, s, g, K(), ops.cv() ? ops.cv().pos : null, 'STRIKE CONSOLE — TTWCS', 'THE GROUP\'S SHOOTERS') },
    };
}

// ── Pri-Fly's screens ──
function priflyScreens(ops) {
    const g = ops.game;
    return {
        screen_deck: {
            fps: 2, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h, c = ops.cv();
                const y0 = page(ctx, W, H, 'FLIGHT DECK STATUS', 'AIR PLAN', clockZ(g), ['#ff5a4a', '#ffc23f', '#5dffa0'][ops.deckStatus]);
                if (!c) return;
                const parked = (c.layout && c.layout.parked || []).length;
                readout(ctx, 20, y0 + 10, 300, 90, 'DECK', ['RED', 'AMBER', 'GREEN'][ops.deckStatus], ['#ff5a4a', '#ffc23f', '#5dffa0'][ops.deckStatus]);
                readout(ctx, 340, y0 + 10, 300, 90, 'ON DECK', parked + ' AIRCRAFT', C.white);
                const up = g.aircraft.filter(a => a.alive && a.team === 'blue' && !a.onGround);
                readout(ctx, 660, y0 + 10, 340, 90, 'AIRBORNE (OURS)', up.length + '', C.cyan);
                text(ctx, 'AIRBORNE', 20, y0 + 130, 15, C.dim, 700);
                up.slice(0, 9).forEach((a, i) => { const d = c.pos.distanceTo(a.pos); ui.row(16, y0 + 146 + i * 34, W - 32, 32, [[a.callsign || a.name || '—', 260], [a.spec ? a.spec.name.toUpperCase() : '', 300], [(d / 1852).toFixed(1) + ' NM', 160, 'right'], [Math.round(a.pos.y * 3.281) + ' FT', 180, 'right']], null); });
                ui.button(20, H - 80, 300, 60, 'SPOT JET ON CAT 1', () => report(g, ops.spotJet()), { size: 18 });
                ui.button(340, H - 80, 300, 60, 'DECK ' + ['AMBER', 'GREEN', 'RED'][ops.deckStatus], () => ops.setDeck((ops.deckStatus + 1) % 3), { size: 18 });
            },
        },
        screen_wind: {
            fps: 3, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h, c = ops.cv();
                const y0 = page(ctx, W, H, 'WIND OVER DECK', '', clockZ(g));
                if (!c) return;
                const w = ops.wind();
                const cx = W * 0.3, cy = y0 + (H - y0) / 2, R = (H - y0) / 2 - 30;
                compass(ctx, cx, cy, R, 0, null, 'RELATIVE');
                // the ship's outline pointing up, the wind arrow coming from its relative bearing
                ctx.strokeStyle = C.white; ctx.lineWidth = 2; ctx.strokeRect(cx - 8, cy - R * 0.4, 16, R * 0.8);
                const a = w.rel * Math.PI / 180 - Math.PI / 2;
                ctx.strokeStyle = C.amber; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95); ctx.lineTo(cx + Math.cos(a) * R * 0.45, cy + Math.sin(a) * R * 0.45); ctx.stroke();
                readout(ctx, W * 0.58, y0 + 20, W * 0.38, 100, 'WIND OVER DECK', Math.round(w.kt) + '', w.kt > 25 && w.kt < 35 && Math.abs(w.rel) < 15 ? C.green : C.amber, 'KT');
                readout(ctx, W * 0.58, y0 + 140, W * 0.38, 100, 'RELATIVE', (w.rel >= 0 ? 'STBD ' : 'PORT ') + Math.abs(Math.round(w.rel)) + '°', C.white);
                readout(ctx, W * 0.58, y0 + 260, W * 0.38, 100, 'TRUE WIND', Math.round(w.true) + '', C.white, 'KT');
            },
        },
        screen_plat: {
            fps: 5, feed: true, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h, F = ops.plat;
                s.setFeed(F && F.texture);
                if (F && F.texture) ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = '#10161b'; ctx.fillRect(0, 0, W, H); }
                ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.moveTo(W / 2, 30); ctx.lineTo(W / 2, H - 30); ctx.moveTo(W / 2 - 80, H / 2); ctx.lineTo(W / 2 + 80, H / 2); ctx.stroke();
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, 34);
                text(ctx, 'PLAT · LANDING AREA', 12, 17, 16, '#fff', 700);
                text(ctx, clockZ(g), W - 12, 17, 14, '#fff', 600, 'right');
            },
        },
        screen_cats: {
            fps: 2, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h, c = ops.cv();
                const y0 = page(ctx, W, H, 'CATAPULTS / ARRESTING GEAR', '', clockZ(g));
                if (!c) return;
                const onCat = g.aircraft.find(a => a.alive && a.deck === c && a.pos.distanceTo(c.catapultSpot()) < 25);
                for (let i = 0; i < 4; i++) {
                    const st = i === 0 && onCat ? (onCat.catapult > 0 ? 'LAUNCHING' : 'SPOTTED — ' + (onCat.spec ? onCat.spec.name.toUpperCase() : '')) : ops.deckStatus === 2 ? 'READY' : 'SAFE';
                    text(ctx, 'CAT ' + (i + 1), 30, y0 + 30 + i * 46, 20, C.white, 700);
                    text(ctx, st, 170, y0 + 30 + i * 46, 18, st === 'READY' ? C.green : st === 'SAFE' ? C.amber : C.cyan, 700);
                }
                for (let i = 0; i < 4; i++) {
                    text(ctx, 'WIRE ' + (i + 1), 30, y0 + 230 + i * 40, 18, C.white, 700);
                    text(ctx, i === 3 && c.type === 'carrier' ? 'ARMED' : 'ARMED', 170, y0 + 230 + i * 40, 16, C.green, 700);
                }
                text(ctx, 'THE ENGINE ROOMS REPORT READY', W - 20, H - 24, 14, C.dim, 600, 'right');
            },
        },
    };
}

// ═════════════ The JOC ═════════════
// The building stands on the home base's south side of the gate road (base-local), entrance to the north
const JOC_AT = { lx: 410, lz: -398 };
export class JocOps {
    constructor(sys) {
        this.sys = sys; this.game = sys.game;
        this.room = sys.addRoom(this.roomDef());
        this.console = new StrikeConsole(this.consoleCtx());
        this.jtype = 'cruise';
        this.cmdPath = [];
        this.entry = null;
        this.built = false;
    }
    start(mode) {
        this.clear();
        if (mode === 'rings') return;
        if (!this.built) this.build();
        this.sys.addSite({ id: 'joc:door', label: 'ENTER THE JOINT OPERATIONS CENTER', radius: 2.4, dy: 3, at: (o) => (this.entry && this.alive() ? o.copy(this.entry) : null), blocked: () => (this.rec && !this.rec.alive ? 'THE JOC IS DESTROYED' : null), enter: () => this.sys.enterRoom(this.room, { text: 'JOINT OPERATIONS CENTER' }) });
    }
    clear() { this.sys.removeSite('joc:door'); this.console = new StrikeConsole(this.consoleCtx()); }
    alive() { return !this.rec || this.rec.alive; }
    // outside the door, facing it (the building's −z face: the entrance)
    entrySpot() { return { pos: this.entry.clone(), yaw: this.yaw + Math.PI }; }
    // building-local (x, z) → world
    toWorld(lx, lz, out = new THREE.Vector3()) {
        const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
        return out.set(this.origin.x + lx * c + lz * s, this.origin.y, this.origin.z - lx * s + lz * c);
    }

    // the building (models/interiors/joc_ext.glb), placed once; solid and destructible (buildings.js)
    build() {
        this.built = true;
        const g = this.game, b = BASES.find(x => x.id === 'home') || BASES[0];
        const w = baseToWorld(b, JOC_AT.lx, JOC_AT.lz);
        const y = Math.max(terrainHeight(w.x, w.z), b.h);
        this.origin = new THREE.Vector3(w.x, y, w.z);
        this.yaw = -b.heading;
        this.entry = this.toWorld(8, -10.6);          // (the model's 'entry' point; read from it once it's loaded)
        new GLTFLoader().loadAsync('models/interiors/joc_ext.glb').then(gltf => {
            const root = gltf.scene;
            let meta = null;
            root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } if (!meta && typeof o.userData.room === 'string') { try { meta = JSON.parse(o.userData.room); } catch (e) { /* */ } } });
            const fake = { model: root, controls: new Map() };
            dressRoom(fake);
            root.position.copy(this.origin); root.rotation.y = this.yaw;
            g.scene.add(root);
            root.updateMatrixWorld(true);
            root.traverse(o => { o.matrixAutoUpdate = false; });       // (it never moves)
            this.ext = root;
            const ent = root.getObjectByName('entry');
            if (ent) { updateWorldChain(ent); this.entry = new THREE.Vector3().setFromMatrixPosition(ent.matrixWorld); this.entry.y = y; }
            // solid and destructible: the building's walls, and the blast walls, HESCO, generators and fuel tank
            // round it (the model's footprint and 'solids'), one record
            const fp = meta && meta.footprint ? meta.footprint : [-13, 13, -9, 9], ht = meta && meta.height ? meta.height : 5.5;
            const box = (x0, x1, z0, z1, h) => { const c = this.toWorld((x0 + x1) / 2, (z0 + z1) / 2); return { x: c.x, z: c.z, y0: y - 0.5, y1: y + h, w: x1 - x0, d: z1 - z0, yaw: this.yaw }; };
            const boxes = [box(fp[0], fp[1], fp[2], fp[3], ht), ...((meta && meta.solids) || []).map(q => box(...q))];
            const B = WORLD_BUILDINGS.current;
            if (B) {
                const m = boxes[0];
                this.rec = B.add({ x: m.x, z: m.z, y, w: m.w, d: m.d, ht, yaw: this.yaw, kind: 'office', name: 'JOINT OPERATIONS CENTER', friendly: true, hp: 2400, boxes });
                B.partMesh(this.rec, root);
                B.index();
            }
        }).catch(e => console.warn('[interiors] JOC exterior not loaded', e && e.message));
    }

    consoleCtx() {
        const g = this.game;
        return {
            shooters: () => {
                const st = g.strikes, out = [];
                if (!st) return out;
                for (const s of st.sources) {
                    if (s.team !== g.war.side || !s.alive) continue;
                    const stock = {};
                    for (const [k, n] of Object.entries(s.stock)) if (n > 0) stock[k] = n;
                    if (!Object.keys(stock).length) continue;
                    out.push({ key: 'S' + s.id, name: s.name.split(' (')[0], src: s, stock, rangeKm: s.range / 1000, km: (t) => Math.hypot(t.pos.x - s.pos.x, t.pos.z - s.pos.z) / 1000 });
                }
                return out;
            },
            launch: (src, w, t, n) => g.strikes && g.strikes.launchFrom(src, w, [markFor(g, t, 'joc')], { n }),
        };
    }

    // EXECUTE: a specific shooter if one's picked, else the strike type through strikes.request (nearest shooters)
    execute() {
        const g = this.game, K = this.console;
        if (!K.target) return 'SELECT A TARGET';
        if (K.shooter) return K.launch();
        if (!K.armed) return 'REQUEST (ARM) FIRST';
        const d = markFor(g, K.target, 'joc');
        g.war.transmit([d]);
        const s = g.strikes && g.strikes.request(this.jtype, [d]);
        K.armed = false;
        if (!s) return 'UNABLE — NO SHOOTER FOR ' + STRIKE_TYPES[this.jtype].label;
        K.last = s; K.msg = 'REQUESTED — ' + STRIKE_TYPES[this.jtype].label;
        return true;
    }

    roomDef() {
        const ops = this, g = this.game;
        const K = () => ops.console;
        return {
            id: 'joc', name: 'JOINT OPERATIONS CENTER', file: 'models/interiors/joc.glb', sealed: true, exitName: 'DOOR',
            title: () => 'JOINT OPERATIONS CENTER · SKYWAR AIR BASE',
            status: () => 'THEATRE ' + clockZ(g) + ' · MARKS ' + g.war.designations.length + ' · STRIKES IN FLIGHT ' + (g.strikes ? g.strikes.missiles.filter(m => m.team === g.war.side).length : 0) + (g.tasks && g.tasks.enabled ? ' · TASKS ' + g.tasks.offered.length + (g.tasks.active ? ' + ACTIVE' : '') : ''),
            // (the floor sits turned round in the building, 0.45 m below the ground outside: tools/interiors/joc_ext.py)
            anchor: (out) => { if (!ops.origin) return out.identity(); return out.makeRotationY(ops.yaw + Math.PI).setPosition(ops.origin.x, ops.origin.y - 0.45, ops.origin.z); },
            exitTo: () => ({ pos: ops.entry.clone(), yaw: ops.yaw }),
            onLoad: (room) => { dressRoom(room); for (const l of room.lights || []) { l.intensity *= 0.8; l.userData.base = l.intensity; } },
            stations: {
                stand_wall: { label: 'THE WALL', order: 1 }, stand_map: { label: 'MAP CONSOLE', order: 2 }, stand_intel: { label: 'INTEL CONSOLE', order: 3 },
                stand_strike: { label: 'STRIKE CELL', order: 4 }, stand_tasks: { label: 'TASKS', order: 5 }, stand_command: { label: 'COMMAND CONSOLE', order: 6 },
                stand_radio: { label: 'RADIO LOG', order: 7 }, stand_director: { label: 'BATTLE CAB', order: 8 },
            },
            bind: {
                exit_door: { label: 'EXIT — TO THE AIRFIELD (LEAVE)' },
                btn_execute: { label: 'EXECUTE STRIKE', press: () => { const r = ops.execute(); if (r !== true) report(g, 'CAN\'T EXECUTE — ' + r); } },
                guard_execute: { label: 'EXECUTE GUARD' },
                btn_transmit: { label: 'TRANSMIT MARKS TO COMMAND', press: () => g.war.transmit() },
                lamp_execute: { lit: () => K().armed || (K().shooter && K().target) ? (Math.sin(g.time * 6) > 0 ? 1 : 0.3) : 0 },
            },
            screens: jocScreens(ops),
        };
    }
}

function jocScreens(ops) {
    const g = ops.game;
    const views = new Map();
    const mv = (s) => views.get(s) || (views.set(s, new MapView(g, s.w, s.h)), views.get(s));
    const K = () => ops.console;
    return {
        screen_wall_map: { fps: 1, draw: (ctx, ui, s) => drawTheatre(ctx, ui, s, g, mv(s), ops) },
        screen_wall_intel: { fps: 1, draw: (ctx, ui, s) => drawIntelBoard(ctx, ui, s, g, false) },
        screen_wall_tasks: { fps: 1, draw: (ctx, ui, s) => drawTasks(ctx, ui, s, g, false) },
        screen_wall_strikes: { fps: 1, draw: (ctx, ui, s) => drawStrikeBoard(ctx, s, g, 'STRIKES · BDA') },
        screen_wall_radio: { fps: 1, draw: (ctx, ui, s) => drawRadioLog(ctx, s, g, 'RADIO', 0) },
        screen_wall_clock: {
            fps: 1, draw: (ctx, ui, s) => {
                const W = s.w, H = s.h;
                ctx.fillStyle = '#02070b'; ctx.fillRect(0, 0, W, H);
                const wx = { clear: 'CLEAR', cloudy: 'OVERCAST', rain: 'RAIN', storm: 'STORM' }[g.world.weather] || '';
                const items = ['ZULU ' + clockZ(g), 'WX ' + wx + ' · WIND ' + Math.round(Math.hypot(g.wind.x, g.wind.z) * KT) + ' KT', 'FPCON ' + (g.director && g.director.enabled ? 'CHARLIE' : 'BRAVO'), 'MARKS ' + g.war.designations.length, 'KNOWN HOSTILES ' + g.war.units.filter(u => { const r = g.war.rec(u); return r && r.team !== g.war.side && r.team !== 'neutral' && r.known >= INTEL.CONTACT && u.alive; }).length];
                items.forEach((t, i) => text(ctx, t, (i + 0.5) * W / items.length, H / 2, Math.round(H * 0.5), i === 0 ? C.green : C.text, 700, 'center', W / items.length - 10));
            },
        },
        screen_ws_map: {
            fps: 2, wheel: (d, s) => { ops.mapZoom = clamp((ops.mapZoom || 0.004) * (d > 0 ? 0.8 : 1.25), 0.0006, 0.08); },
            draw: (ctx, ui, s) => drawMapConsole(ctx, ui, s, g, mv(s), ops),
        },
        screen_ws_intel: { fps: 2, draw: (ctx, ui, s) => drawIntelBoard(ctx, ui, s, g, true) },
        screen_ws_strike: { fps: 3, draw: (ctx, ui, s) => drawJocStrike(ctx, ui, s, g, ops) },
        screen_ws_tasks: { fps: 2, draw: (ctx, ui, s) => drawTasks(ctx, ui, s, g, true) },
        screen_ws_command: { fps: 2, draw: (ctx, ui, s) => drawCommandConsole(ctx, ui, s, g, ops) },
        screen_ws_radio: { fps: 2, wheel: (d) => { ops.logScroll = Math.max(0, (ops.logScroll || 0) - d); }, draw: (ctx, ui, s) => drawRadioLog(ctx, s, g, 'RADIO — NET LOG', ops.logScroll || 0) },
        screen_cab: { fps: 1, draw: (ctx, ui, s) => drawWarSummary(ctx, ui, s, g) },
    };
}

// ═════════════ The TEL: a captured Scud and its launch cabin ═════════════
const TEL_AT = { lx: 468, lz: -452 };                   // (home base: beside the JOC, in the T-wall compound)
const CABIN_OFFSET = new THREE.Vector3(0, 1.0, -1.83);   // the launch cabin's floor in the vehicle's frame (tools/interiors/tel_cabin.py)
const CABIN_DOOR = { lx: -1.43, lz: -1.28 };             // its door (in the left wall), vehicle frame
const CAB_OFFSET = new THREE.Vector3(-1.145, 1.45, -4.337); // the left (driver's) cab's floor (tools/interiors/tel_cab.py)
export class TelOps {
    constructor(sys) {
        this.sys = sys; this.game = sys.game;
        this.cabin = sys.addRoom(this.cabinDef());
        this.cab = sys.addRoom(this.cabDef());
        this.tel = null; this.src = null; this.panel = null;
        this.code = '000000'; this.dial = [0, 0, 0, 0, 0, 0]; this.codeSw = 0;
    }
    start(mode) {
        this.clear();
        if (!['freeflight', 'sandbox', 'war'].includes(mode)) return; // (a blue truck would count as a strike mode's target)
        const token = this.token = {};
        V.vehiclesReady().then(() => { if (this.token === token) this.spawn(); });
    }
    clear() {
        this.token = null;
        for (const id of ['tel:cabin', 'tel:cab']) this.sys.removeSite(id);
        if (this.src && this.game.strikes) this.game.strikes.removeSource(this.src);
        this.tel = null; this.src = null; this.panel = null;
    }
    // beside the launch cabin's door, facing the truck (travel)
    spot() { return { pos: this.sidePoint(new THREE.Vector3(), CABIN_DOOR.lx - 1.2, CABIN_DOOR.lz), yaw: this.tel.mesh.rotation.y - Math.PI / 2 }; }

    spawn() {
        const g = this.game, b = BASES.find(x => x.id === 'home') || BASES[0];
        const w = baseToWorld(b, TEL_AT.lx, TEL_AT.lz);
        const u = g.ground.addTarget('truck', w.x, w.z, Math.PI / 2 - b.heading, 'blue');
        u.name = 'CAPTURED SS-1C SCUD-B TEL';
        u.def = { ...u.def, name: 'SCUD TEL', score: 0 };
        u.radius = u.hitRadius = 8;
        g.war.add(u, { cls: 'tel', name: u.name });
        dress(u, 'scud', { paint: 'blue_green', onRig: (rig) => { V.stow(rig); } });
        this.tel = u;
        const st = g.strikes;
        if (st) {
            this.src = st.addSource(new GroundLauncher(st, u, { kind: 'launcher', name: 'CAPTURED SCUD', stock: { scud: 2 } }));
            // the missile leaves from its place on the erected rail, straight up the way it stands
            this.src.launchFrame = (out, dir) => {
                const r = u.rig;
                if (r && r.missile) { updateWorldChain(r.missile); out.setFromMatrixPosition(r.missile.matrixWorld); dir.set(0, 0, -1).transformDirection(r.missile.matrixWorld); out.addScaledVector(dir, 5.5); }
                else { out.copy(u.pos).y += 8; dir.set(0, 1, 0); }
            };
            this.src.prepTime = () => 2.5;
        }
        this.panel = new TelPanel(this.panelCtx());
        this.code = String(Math.floor(rand(100000, 999999)));
        this.dial = [0, 0, 0, 0, 0, 0]; this.codeSw = 0;
        this.reloadAt = null;
        const sys = this.sys;
        sys.addSite({ id: 'tel:cabin', label: 'CLIMB INTO THE LAUNCH CONTROL CABIN', radius: 2.4, dy: 3, at: (o) => (u.alive ? this.sidePoint(o, CABIN_DOOR.lx, CABIN_DOOR.lz) : null), enter: () => sys.enterRoom(this.cabin, { text: '9P117 · LAUNCH CONTROL CABIN' }) });
        sys.addSite({ id: 'tel:cab', label: 'CLIMB INTO THE CAB (DRIVE)', radius: 2.4, dy: 3, at: (o) => (u.alive ? this.sidePoint(o, -1.5, -4.3) : null), enter: () => sys.enterRoom(this.cab, { text: 'MAZ-543 · DRIVER\'S CAB' }) });
    }
    // a point beside the truck (vehicle-local x, z) on the ground
    sidePoint(out, lx, lz) {
        const u = this.tel;
        updateWorldChain(u.mesh);
        out.set(lx + Math.sign(lx) * 0.9, 0, lz).applyMatrix4(u.mesh.matrixWorld);
        out.y = this.game.surfaceAt(out.x, out.z, 1e3).h;
        return out;
    }

    panelCtx() {
        const g = this.game;
        return {
            pose: (grp, k) => { const r = this.tel && this.tel.rig; if (r) V.pose(r, grp === 'jack' ? 'jack' : grp, k); },
            missile: () => !!(this.tel && this.tel.rig && this.tel.rig.missile && this.tel.rig.missile.visible && this.src && (this.src.stock.scud || 0) > 0),
            targets: () => targetList(g, this.tel.pos, { max: 12 }),
            range: (t) => { const km = Math.hypot(t.pos.x - this.tel.pos.x, t.pos.z - this.tel.pos.z) / 1000; return { ok: km <= 300 && km >= 20, km, max: 300 }; },
            launch: (t) => this.launch(t),
            moving: () => !!this.drive && Math.abs(this.drive.v) > 0.3,
            now: () => g.time,
        };
    }
    codeOk() { return this.dial.join('') === this.code && this.codeSw === 1; }
    launch(t) {
        const g = this.game;
        if (!this.codeOk()) return null;
        const s = g.strikes && g.strikes.launchFrom(this.src, 'scud', [markFor(g, t, 'tel')], { n: 1 });
        if (!s) return null;
        this.hideMissileAt = g.time + 2.5;
        this.reloadAt = null;
        say(g, 'SCUD TEL', 'LAUNCH! — R-17 AWAY TOWARD ' + t.label, { color: '#ffc23f', say: 'Missile away.' });
        return s;
    }
    update(dt) {
        const u = this.tel, g = this.game;
        if (!u) return;
        if (this.panel) this.panel.update(dt);
        if (this.hideMissileAt && g.time >= this.hideMissileAt) {
            this.hideMissileAt = null;
            if (u.rig && u.rig.missile) u.rig.missile.visible = false;
            if (this.src && this.src.stock.scud > 0) this.reloadAt = g.time + 120; // the transloader brings the next round
        }
        if (this.reloadAt && g.time > this.reloadAt && this.panel.stowed) { this.reloadAt = null; if (u.rig && u.rig.missile) u.rig.missile.visible = true; say(g, 'SCUD TEL', 'RELOADED — ONE ROUND ON THE RAIL', { color: '#9fd4ff', say: false }); }
        if (this.drive) this.drive.tick(dt);
    }

    cabinDef() {
        const ops = this, g = this.game;
        const P = () => ops.panel;
        const lampOf = (fn) => ({ lit: () => !!(ops.panel && fn()) });
        const dials = {};
        for (let i = 0; i < 6; i++) dials['knob_code_' + (i + 1)] = { label: () => 'CODE DIGIT ' + (i + 1) + ' — ' + ops.dial[i], value: () => ops.dial[i] / 9, turn: (d) => { ops.dial[i] = (ops.dial[i] + d + 10) % 10; } };
        return {
            id: 'tel-cabin', name: 'LAUNCH CONTROL CABIN', file: 'models/interiors/tel_cabin.glb', sealed: true, exitName: 'DOOR',
            title: () => '9P117 SCUD TEL · LAUNCH CONTROL CABIN',
            status: () => { const p = P(); if (!p) return ''; return 'JACKS ' + Math.round(p.k.jack * 100) + '% · TABLE ' + Math.round(p.k.pad * 100) + '% · BOOM ' + Math.round(p.k.raise * 100) + '% · ' + (p.target ? 'TARGET ' + p.target.label : 'NO TARGET'); },
            anchor: (out) => { const u = ops.tel; if (!u) return out.identity(); u.mesh.updateMatrixWorld(); return out.makeTranslation(CABIN_OFFSET.x, CABIN_OFFSET.y, CABIN_OFFSET.z).premultiply(u.mesh.matrixWorld); },
            exitTo: () => { const p = ops.sidePoint(new THREE.Vector3(), CABIN_DOOR.lx, CABIN_DOOR.lz); return { pos: p, yaw: ops.tel.mesh.rotation.y + Math.PI / 2 }; },
            onLoad: (room) => { dressRoom(room); for (const l of room.lights || []) l.userData.base = l.intensity; },
            stations: { stand_launch: { label: '2V12M LAUNCH STATION', order: 1 }, stand_code: { label: 'CODE LOCK', order: 2 } },
            bind: {
                exit_door: { label: 'DOOR (LEAVE)' },
                sw_power: { label: 'MAIN POWER', value: () => ops.power, press: () => { ops.power = !ops.power; } },
                sw_gen: { label: 'GENERATOR', value: () => ops.gen, press: () => { ops.gen = !ops.gen; } },
                lamp_power: lampOf(() => ops.power && ops.gen),
                sw_brake: { label: 'PARKING BRAKE', value: () => P() && P().brake, press: () => report(g, P().setBrake(!P().brake)) },
                sw_jacks: { label: () => 'REAR SUPPORTS — ' + (P() && P().want.jack ? 'DOWN' : 'UP'), value: () => P() && P().want.jack, press: () => { if (!ops.powered()) return report(g, 'NO POWER'); if (!P().brake) P().setBrake(true); report(g, P().jacks(!P().want.jack)); } },
                lamp_jacks: lampOf(() => P().k.jack >= 1),
                sw_table: { label: () => 'LAUNCH TABLE — ' + (P() && P().want.pad ? 'DOWN' : 'STOWED'), value: () => P() && P().want.pad, press: () => { if (!ops.powered()) return report(g, 'NO POWER'); report(g, P().table(!P().want.pad)); } },
                lamp_table: lampOf(() => P().k.pad >= 1),
                sw_erect: { label: () => 'BOOM — ' + (P() && P().want.raise ? 'RAISE' : 'LOWER'), value: () => P() && P().want.raise, press: () => { if (!ops.powered()) return report(g, 'NO POWER'); report(g, P().erect(!P().want.raise)); } },
                lamp_erect: lampOf(() => P().erected),
                knob_azimuth: { label: () => 'LAUNCH TABLE AZIMUTH — ' + Math.round(ops.az || 0) + '°', value: () => (ops.az || 0) / 360, turn: (d) => { ops.az = ((ops.az || 0) + d * 10 + 360) % 360; } },
                btn_gyro: { label: 'GYROCOMPASS — ALIGN ON THE TARGET', press: () => { if (!ops.powered()) return report(g, 'NO POWER'); report(g, P().startAlign()); } },
                lamp_align: lampOf(() => P().align >= 1 ? true : P().aligning ? (Math.sin(g.time * 8) > 0 ? 0.7 : 0.1) : false),
                btn_test: { label: 'CONTROL SYSTEM TEST', press: () => { if (!ops.powered()) return report(g, 'NO POWER'); ops.tested = g.time + 4; g.audio.tick(900, 0.2, 0.05); } },
                lamp_test: lampOf(() => ops.tested && g.time > ops.tested ? true : ops.tested ? (Math.sin(g.time * 8) > 0 ? 0.6 : 0.1) : false),
                sw_combat: { label: 'COMBAT MODE', value: () => ops.combat, press: () => { if (!(ops.tested && g.time > ops.tested)) return report(g, 'RUN THE CONTROL SYSTEM TEST FIRST'); ops.combat = !ops.combat; } },
                lamp_combat: lampOf(() => ops.combat),
                sw_batt: { label: 'MISSILE BATTERIES', value: () => ops.batt, press: () => { if (!ops.combat) return report(g, 'COMBAT MODE FIRST'); ops.batt = !ops.batt; } },
                ...dials,
                sw_code: { label: () => 'CODE LOCK — ' + (ops.codeSw ? 'О (FIRE)' : 'Н (DIAL)'), value: () => ops.codeSw, press: () => { ops.codeSw = ops.codeSw ? 0 : 1; if (ops.codeSw && !ops.codeOk()) { g.addFeed('CODE REJECTED', '#ff5a4a'); ops.codeSw = 0; } } },
                lamp_code: lampOf(() => ops.codeOk()),
                lamp_ready: lampOf(() => ops.ready() === true),
                btn_launch: { label: 'LAUNCH [ПУСК]', press: () => { const r = ops.ready(); if (r !== true) return report(g, 'NO LAUNCH — ' + r); P().arm(true); const x = P().launch(); if (x !== true) { P().arm(false); report(g, x); } } },
                guard_launch: { label: 'LAUNCH COVER' },
                btn_abort: { label: 'ABORT', press: () => { P().armed = false; P().aligning = false; ops.combat = false; ops.batt = false; ops.codeSw = 0; } },
            },
            screens: { screen_tel: { fps: 3, draw: (ctx, ui, s) => drawTelPanel(ctx, ui, s, g, ops) } },
        };
    }
    powered() { return !!(this.power && this.gen); }
    // everything the launch needs, the first missing thing
    ready() {
        const p = this.panel, g = this.game;
        if (!this.powered()) return 'NO POWER';
        if (!(this.tested && g.time > this.tested)) return 'NO CONTROL SYSTEM TEST';
        if (!this.combat) return 'NOT IN COMBAT MODE';
        if (!this.batt) return 'MISSILE BATTERIES OFF';
        if (!this.codeOk()) return 'CODE LOCK SHUT';
        const r = p.ready();
        return r === 'NOT ARMED' ? true : r; // (the launch button arms it)
    }

    cabDef() {
        const ops = this, g = this.game;
        return {
            id: 'tel-cab', name: 'DRIVER\'S CAB', file: 'models/interiors/tel_cab.glb', sealed: false, shadows: true, exitName: 'DOOR',
            title: () => 'MAZ-543 · DRIVER\'S CAB',
            status: () => (ops.drive ? Math.round(Math.abs(ops.drive.v) * 3.6) + ' KM/H' : ops.panel && !ops.panel.canDrive ? 'STOW THE LAUNCHER AND RELEASE THE BRAKE BEFORE DRIVING' : 'ENGINE ' + (ops.engine ? 'RUNNING — W/S DRIVE, A/D STEER' : 'OFF')),
            anchor: (out) => { const u = ops.tel; if (!u) return out.identity(); u.mesh.updateMatrixWorld(); return out.makeTranslation(CAB_OFFSET.x, CAB_OFFSET.y, CAB_OFFSET.z).premultiply(u.mesh.matrixWorld); },
            exitTo: () => { ops.stopDrive(); const p = ops.sidePoint(new THREE.Vector3(), -1.5, -4.3); return { pos: p, yaw: ops.tel.mesh.rotation.y + Math.PI / 2 }; },
            onLoad: (room) => dressRoom(room),
            stations: { stand_driver: { label: 'DRIVER', order: 1 } },
            bind: {
                exit_door: { label: 'DOOR (LEAVE)' },
                sw_brake: { label: () => 'PARKING BRAKE — ' + (ops.panel && ops.panel.brake ? 'SET' : 'OFF'), value: () => ops.panel && ops.panel.brake, press: () => report(g, ops.panel.setBrake(!ops.panel.brake)) },
                lamp_brake: { lit: () => !!(ops.panel && ops.panel.brake) },
                btn_start: { label: () => ops.engine ? 'ENGINE STOP' : 'ENGINE START', press: () => { ops.engine = !ops.engine; if (ops.engine) g.audio.tick(80, 0.5, 0.4); } },
            },
            drive: 'stand_driver',           // (seated at the wheel: WASD drive the truck, they don't walk)
            onEnter: (room, rc) => { const st = room.stations.find(x => x.id === 'stand_driver'); if (st) rc.focus(st); },
            update: (dt, room) => ops.cabTick(dt, room),
        };
    }
    // in the cab: W/S/A/D drive the truck once the launcher is stowed, the brake off and the engine running
    cabTick(dt) {
        const g = this.game, input = g.input, rc = this.sys.ctl;
        if (!rc || rc.room !== this.cab) return;
        const want = input.down('KeyW', 'ArrowUp') || input.down('KeyS', 'ArrowDown');
        if (want && !this.drive) {
            if (!this.engine) { if (!this._warnE || g.time - this._warnE > 3) { this._warnE = g.time; g.addFeed('START THE ENGINE FIRST', '#ffc23f'); } }
            else if (!this.panel.canDrive) { if (!this._warnD || g.time - this._warnD > 3) { this._warnD = g.time; g.addFeed(this.panel.brake ? 'RELEASE THE PARKING BRAKE' : 'STOW THE LAUNCHER FIRST', '#ffc23f'); } }
            else this.drive = new TruckDrive(this.game, this.tel);
        }
    }
    stopDrive() { if (this.drive) { this.drive.v = 0; this.drive = null; } }
}

// ── driving the truck: the Ready Room's car model (groundstart.js), heavier; the room moves with it ──
class TruckDrive {
    constructor(game, u) { this.game = game; this.u = u; this.v = 0; this.steer = 0; this.yaw = u.mesh.rotation.y; }
    tick(dt) {
        const g = this.game, input = g.input, u = this.u;
        const rc = g.interiors && g.interiors.ctl;
        if (!rc || !rc.room || rc.room.id !== 'tel-cab') { this.v = damp(this.v, 0, 2, dt); }
        const thr = rc && rc.room && rc.room.id === 'tel-cab' ? (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0) : 0;
        const st = rc && rc.room && rc.room.id === 'tel-cab' ? (input.down('KeyA', 'ArrowLeft') ? 1 : 0) - (input.down('KeyD', 'ArrowRight') ? 1 : 0) : 0;
        if (thr > 0) this.v += (this.v < 0 ? 3 : 1.1) * dt;
        else if (thr < 0) this.v -= (this.v > 0.5 ? 3 : 0.8) * dt;
        else this.v -= Math.sign(this.v) * Math.min(Math.abs(this.v), 0.8 * dt);
        this.v = clamp(this.v, -3, 12.5);
        this.steer = damp(this.steer, st, 3, dt);
        this.yaw += this.v / 7.7 * Math.tan(this.steer * 0.5) * dt;       // (7.7 m wheelbase)
        const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
        const nx = u.mesh.position.x + fx * this.v * dt, nz = u.mesh.position.z + fz * this.v * dt;
        const s = g.surfaceAt(nx, nz, 1e3);
        if (s.water) { this.v = 0; return; }
        const bl = g.world.towns && g.world.towns.buildings;
        if (bl && bl.blocks(nx, nz, s.h, 2.5)) { this.v *= -0.2; return; }
        u.mesh.position.set(nx, s.h, nz);
        u.mesh.rotation.y = this.yaw;
        u.pos.set(nx, s.h + u.radius * 0.4, nz);
        if (u.rig) { V.roll(u.rig, this.v * dt); V.steer(u.rig, this.steer * 0.5); }
    }
}

// ═════════════ Drawing: the command rooms' displays ═════════════
function drawAirPicture(ctx, s, g, cv, title, range, sweep = false) {
    const W = s.w, H = s.h;
    const y0 = page(ctx, W, H, title, (range / 1852).toFixed(0) + ' NM', clockZ(g));
    const cx = W / 2, cy = y0 + (H - y0) / 2, R = Math.min(W, H - y0) / 2 - 16;
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(cx, cy, R * i / 4, 0, Math.PI * 2); ctx.stroke(); }
    for (let a = 0; a < 12; a++) { const t = a * Math.PI / 6; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(t) * R, cy - Math.cos(t) * R); ctx.stroke(); }
    if (!cv) return;
    if (sweep) {
        const t = (g.time * 1.0) % (Math.PI * 2);
        ctx.strokeStyle = 'rgba(93,255,160,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(t) * R, cy - Math.cos(t) * R); ctx.stroke();
    }
    const P = cv.pos, k = R / range;
    const war = g.war;
    // air tracks: ours always; theirs when the war knows them
    for (const a of g.aircraft) {
        if (!a.alive || a.onGround) continue;
        const own = a.team === war.side;
        const rec = war.rec(a);
        if (!own && !(rec && rec.known >= INTEL.CONTACT)) continue;
        const dx = a.pos.x - P.x, dz = a.pos.z - P.z;
        if (Math.hypot(dx, dz) > range) continue;
        const x = cx + dx * k, y = cy + dz * k;
        ctx.strokeStyle = own ? C.blue : rec.known >= INTEL.IDENTIFIED ? C.red : C.amber; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.6;
        if (own) { ctx.beginPath(); ctx.arc(x, y - 2, 6, Math.PI, 0); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x, y - 7); ctx.lineTo(x + 6, y); ctx.stroke(); }
        const sp = Math.hypot(a.vel.x, a.vel.z) || 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + a.vel.x / sp * 16, y + a.vel.z / sp * 16); ctx.stroke();
        ctx.font = f(600, 11); ctx.textAlign = 'left'; ctx.fillText(String(Math.round(a.pos.y * 3.281 / 1000)).padStart(2, '0'), x + 8, y + 10);
    }
    // missiles in flight (ours and detected ones)
    if (g.strikes) for (const m of g.strikes.missiles) {
        const own = m.team === war.side;
        if (!own && !m.detected) continue;
        const dx = m.pos.x - P.x, dz = m.pos.z - P.z;
        if (Math.hypot(dx, dz) > range) continue;
        ctx.fillStyle = own ? '#bfe0ff' : C.red; ctx.fillRect(cx + dx * k - 2, cy + dz * k - 2, 4, 4);
    }
    // own ship
    ctx.fillStyle = C.green; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
}

function drawTrackList(ctx, ui, s, g, cv) {
    const W = s.w, H = s.h, war = g.war;
    const y0 = page(ctx, W, H, 'AIR TRACKS', 'AUTO TRACK / ID', clockZ(g));
    if (!cv) return;
    const rows = [];
    for (const a of g.aircraft) {
        if (!a.alive || a.onGround) continue;
        const own = a.team === war.side, rec = war.rec(a);
        if (!own && !(rec && rec.known >= INTEL.CONTACT)) continue;
        const br = war.bearingRange(cv.pos, a.pos);
        rows.push({ a, own, rec, br });
    }
    rows.sort((x, y) => x.br.km - y.br.km);
    text(ctx, 'TRACK   ID                         BRG    RANGE     ALT      SPD', 16, y0 + 10, 13, C.dim, 700);
    rows.slice(0, 11).forEach((r, i) => ui.row(12, y0 + 24 + i * 34, W - 24, 32, [[String(7000 + (r.rec ? r.rec.id : i) % 999), 80], [r.own ? (r.a.callsign || 'FRIEND') : war.label(r.a), 260], [String(r.br.brg).padStart(3, '0'), 70, 'right'], [(r.br.km / 1.852).toFixed(0) + ' NM', 100, 'right'], [Math.round(r.a.pos.y * 3.281 / 100) * 100 + '', 110, 'right'], [Math.round(Math.hypot(r.a.vel.x, r.a.vel.z) * KT) + ' KT', 110, 'right']], r.own ? null : () => war.designate(r.a, 'cic'), { colors: [C.cyan, r.own ? C.blue : r.rec.known >= INTEL.IDENTIFIED ? C.red : C.amber] }));
    if (!rows.length) text(ctx, 'NO AIR TRACKS', W / 2, H / 2, 20, C.dim, 700, 'center');
}

function drawSurfacePicture(ctx, ui, s, g, cv) {
    const W = s.w, H = s.h, war = g.war;
    const y0 = page(ctx, W, H, 'SURFACE PICTURE', 'SPS-67 / LINK', clockZ(g));
    if (!cv) return;
    const rows = [];
    for (const u of g.naval.ships) {
        if (u === cv || u.gone || !u.alive || (u.depth || 0) > 3) continue;
        const own = u.team === war.side, rec = war.rec(u);
        if (!own && !(rec && rec.known >= INTEL.CONTACT)) continue;
        rows.push({ u, own, rec, br: war.bearingRange(cv.pos, u.pos) });
    }
    rows.sort((a, b) => a.br.km - b.br.km);
    rows.slice(0, 12).forEach((r, i) => ui.row(12, y0 + 12 + i * 36, W - 24, 34, [[war.label(r.u), 330], [r.own ? 'FRIEND' : INTEL_NAMES[r.rec.known], 150], [String(r.br.brg).padStart(3, '0') + '°', 90, 'right'], [(r.br.km / 1.852).toFixed(1) + ' NM', 130, 'right']], r.own ? null : () => war.designate(r.u, 'cic'), { colors: [r.own ? C.blue : r.rec.known >= INTEL.IDENTIFIED ? C.red : C.amber] }));
    if (!rows.length) text(ctx, 'NO SURFACE CONTACTS', W / 2, H / 2, 20, C.dim, 700, 'center');
    text(ctx, 'CLICK A HOSTILE CONTACT TO DESIGNATE IT', W / 2, H - 20, 13, C.dim, 600, 'center');
}

function drawAsw(ctx, s, g, cv) {
    const W = s.w, H = s.h;
    const y0 = page(ctx, W, H, 'UNDERSEA WARFARE', 'MH-60R · SONOBUOYS', clockZ(g));
    if (!cv) return;
    const subs = g.naval.ships.filter(u => u.alive && !u.gone && (u.type === 'ssn' || u.type === 'ssgn'));
    subs.forEach((u, i) => {
        const br = g.war.bearingRange(cv.pos, u.pos);
        text(ctx, (u.team === g.war.side ? u.name : 'SUBSURFACE CONTACT') + ' · ' + String(br.brg).padStart(3, '0') + '° · ' + (br.km / 1.852).toFixed(1) + ' NM · ' + ((u.depth || 0) > 1 ? 'SUBMERGED' : 'SURFACED'), 20, y0 + 30 + i * 34, 17, u.team === g.war.side ? C.blue : C.amber, 700, 'left', W - 40);
    });
    if (!subs.length) text(ctx, 'NO SUBSURFACE CONTACTS', W / 2, H / 2, 20, C.dim, 700, 'center');
}

function drawTao(ctx, ui, s, g, ops) {
    const W = s.w, H = s.h, cv = ops.cv(), war = g.war;
    const y0 = page(ctx, W, H, 'TAO — SUMMARY', 'ALERT ' + (g.aircraft.some(a => a.alive && a.team !== war.side && !a.onGround && cv && a.pos.distanceTo(cv.pos) < 40000) ? 'RED' : 'WHITE'), clockZ(g));
    if (!cv) return;
    const hostile = g.aircraft.filter(a => a.alive && a.team !== war.side && !a.onGround && a.pos.distanceTo(cv.pos) < 100000).length;
    readout(ctx, 20, y0 + 10, 230, 90, 'HOSTILE AIR < 54 NM', hostile + '', hostile ? C.red : C.green);
    readout(ctx, 262, y0 + 10, 230, 90, 'CARRIER HULL', Math.round(cv.hp / cv.maxHp * 100) + '%', C.white);
    readout(ctx, 504, y0 + 10, 230, 90, 'SAMS (SHIP)', (cv.ammo ? cv.ammo.sam : 0) + '', C.white);
    const st = g.strikes;
    const vls = st ? st.sources.filter(x => x.team === war.side && x.kind === 'ship') : [];
    readout(ctx, 746, y0 + 10, 256, 90, 'TLAM IN THE GROUP', vls.reduce((a, x) => a + (x.stock.tlam || 0), 0) + '', C.cyan);
    text(ctx, 'ESCORTS', 20, y0 + 130, 15, C.dim, 700);
    const esc = g.naval.ships.filter(x => x.team === war.side && x !== cv && x.alive && !x.gone && x.def && x.def.L > 40);
    esc.slice(0, 6).forEach((x, i) => { const br = war.bearingRange(cv.pos, x.pos); ui.row(16, y0 + 146 + i * 34, W - 32, 32, [[x.name, 420], [x.type.toUpperCase(), 160], [String(br.brg).padStart(3, '0') + '° / ' + (br.km / 1.852).toFixed(1) + ' NM', 250, 'right']], null, { colors: [C.blue] }); });
}

function drawStrikeBoard(ctx, s, g, title) {
    const W = s.w, H = s.h, st = g.strikes, war = g.war;
    const y0 = page(ctx, W, H, title, '', clockZ(g));
    if (!st) return;
    const live = st.strikes.filter(x => x.team === war.side).slice(-7).reverse();
    text(ctx, 'STRIKE  TYPE                        TARGET                    STATUS', 16, y0 + 10, 13, C.dim, 700);
    live.forEach((x, i) => {
        const fl = x.missiles.filter(m => m.alive);
        const eta = fl.length ? Math.max(0, Math.min(...fl.map(m => m.eta - (g.time - m.t0)))) : null;
        const stat = x.done ? (x.aims[0] && x.aims[0].result ? x.aims[0].result : 'IMPACT — BDA PENDING') : eta != null ? 'IN FLIGHT · ' + st.clock(eta) : 'LAUNCHING';
        text(ctx, String(x.id).padStart(3, ' ') + '     ' + (x.planned + '× ' + (x.spec.short || x.spec.name)), 16, y0 + 36 + i * 30, 15, C.text, 600, 'left', 320);
        text(ctx, x.aims[0] ? x.aims[0].label : '', 340, y0 + 36 + i * 30, 15, C.text, 600, 'left', 300);
        text(ctx, stat, W - 16, y0 + 36 + i * 30, 15, x.done ? C.green : C.cyan, 700, 'right', W - 660);
    });
    if (!live.length) text(ctx, 'NO STRIKES', W / 2, y0 + 70, 20, C.dim, 700, 'center');
    // the latest battle damage imagery (the targeting pod's, sensors.js)
    const img = g.sensors && g.sensors.imagery && g.sensors.imagery[g.sensors.imagery.length - 1];
    if (img && img.canvas) {
        const ih = Math.min(H - (y0 + 36 + 7 * 30) - 16, 200), iw = ih * img.canvas.width / img.canvas.height;
        if (ih > 60) {
            ctx.drawImage(img.canvas, W - iw - 16, H - ih - 12, iw, ih);
            ctx.strokeStyle = C.line; ctx.strokeRect(W - iw - 16, H - ih - 12, iw, ih);
            text(ctx, 'BDA · ' + (img.result || '') + ' · ' + (img.grid || ''), W - iw - 24, H - 24, 13, C.amber, 700, 'right', W - iw - 40);
        }
    }
}

function drawRadioLog(ctx, s, g, title, scroll) {
    const W = s.w, H = s.h;
    const y0 = page(ctx, W, H, title, (g.war.radioLog.length) + ' MSGS', clockZ(g));
    const lh = 26, rows = Math.floor((H - y0 - 10) / lh);
    const log = g.war.radioLog;
    const end = Math.max(0, log.length - scroll);
    const list = log.slice(Math.max(0, end - rows), end);
    list.forEach((m, i) => {
        const t = Math.max(0, Math.round(m.t));
        text(ctx, String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'), 12, y0 + 12 + i * lh, 13, C.dim, 600);
        text(ctx, (m.from ? m.from + ': ' : '') + m.text, 76, y0 + 12 + i * lh, 14, m.color || C.text, 600, 'left', W - 90);
    });
}

function drawStrikeConsole(ctx, ui, s, g, K, from, title, sub) {
    const W = s.w, H = s.h;
    const y0 = page(ctx, W, H, title, sub, clockZ(g), K.armed ? C.red : C.cyan);
    const sh = K.ctx.shooters();
    text(ctx, 'SHOOTER', 16, y0 + 10, 14, C.dim, 700);
    sh.slice(0, 5).forEach((x, i) => ui.row(12, y0 + 24 + i * 32, W * 0.46, 30, [[x.name, W * 0.26], [Object.entries(x.stock).map(([k, n]) => MISSILES[k].short + ' ' + n).join(' · '), W * 0.19]], () => K.select('shooter', x), { sel: K.shooter && K.shooter.key === x.key }));
    if (!sh.length) text(ctx, 'NO SHOOTERS WITH MISSILES', 20, y0 + 40, 15, C.amber, 700);
    text(ctx, 'WEAPON', W * 0.5, y0 + 10, 14, C.dim, 700);
    if (K.shooter) Object.keys(K.shooter.stock).forEach((k, i) => ui.button(W * 0.5 + i * 160, y0 + 24, 150, 50, MISSILES[k].short, () => K.select('weapon', k), { on: K.weapon === k, sub: '×' + K.shooter.stock[k], size: 18 }));
    text(ctx, 'SALVO', W * 0.5, y0 + 96, 14, C.dim, 700);
    for (let n = 1; n <= 4; n++) ui.button(W * 0.5 + (n - 1) * 90, y0 + 110, 80, 44, n + '', () => K.select('n', n), { on: K.n === n, size: 18 });
    const tl = targetList(g, from, { max: 8 });
    text(ctx, 'TARGET', 16, y0 + 200, 14, C.dim, 700);
    tl.forEach((t, i) => ui.row(12, y0 + 214 + i * 30, W - 24, 28, [[t.label, W * 0.45], [t.kind === 'sea' ? 'SEA' : 'LAND', 90], [t.grid || '', 200], [Math.round(t.km) + ' KM', 120, 'right']], () => K.select('target', t), { sel: K.target && K.target.key === t.key, colors: [t.mark ? C.green : C.text] }));
    if (!tl.length) text(ctx, 'NO TARGETS — MARK ONE (COMMA / THE MAP)', 20, y0 + 232, 15, C.amber, 700);
    const r = K.ready();
    text(ctx, K.msg || (r === true ? (K.armed ? 'ARMED — LIFT THE GUARD AND PRESS LAUNCH' : 'READY — TURN THE KEY, ARM') : r), 16, H - 22, 16, K.armed ? C.red : r === true ? C.green : C.amber, 700, 'left', W - 32);
}

function drawGroupMap(ctx, ui, s, g, cv, view, title, scale) {
    const W = s.w, H = s.h;
    if (!cv) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    view.w = W; view.h = H; view.view.cx = cv.pos.x; view.view.cz = cv.pos.z; view.view.scale = scale;
    view.draw(ctx, { ui });
    ctx.fillStyle = 'rgba(2,7,11,0.8)'; ctx.fillRect(0, 0, W, 38);
    text(ctx, title, 14, 19, 18, C.white, 700);
    text(ctx, clockZ(g), W - 14, 19, 15, C.dim, 600, 'right');
}

// the theatre on the wall: from the home base up to the front and the enemy base
function drawTheatre(ctx, ui, s, g, view, ops) {
    const W = s.w, H = s.h;
    const home = BASES[0], enemy = BASES.find(b => b.id === 'enemy') || BASES[1];
    view.w = W; view.h = H;
    view.view.cx = (home.x + enemy.x) / 2; view.view.cz = (home.z + enemy.z) / 2;
    view.view.scale = Math.min(W, H) / 42000;
    view.draw(ctx, { ui });
    ctx.fillStyle = 'rgba(2,7,11,0.78)'; ctx.fillRect(0, 0, W, 40);
    text(ctx, 'COMMON OPERATIONAL PICTURE', 14, 20, 20, C.white, 700);
    text(ctx, clockZ(g), W - 14, 20, 16, C.green, 700, 'right');
    void ui; void ops;
}

function drawMapConsole(ctx, ui, s, g, view, ops) {
    const W = s.w, H = s.h;
    const c = ops.mapC || (ops.mapC = { x: BASES[0].x, z: BASES[0].z - 8000 });
    view.w = W; view.h = H; view.view.cx = c.x; view.view.cz = c.z; view.view.scale = ops.mapZoom || 0.004;
    ui.hit(0, 40, W, H - 90, (x, y) => { const w = view.toWorld(x, y); g.war.designate({ x: w.x, z: w.z }, 'joc'); }, 'map', { label: 'CLICK: MARK A POINT HERE · WHEEL: ZOOM' });
    view.draw(ctx, { ui });
    ctx.fillStyle = 'rgba(2,7,11,0.8)'; ctx.fillRect(0, 0, W, 40);
    text(ctx, 'MAP CONSOLE · CLICK: MARK · WHEEL: ZOOM', 14, 20, 16, C.white, 700);
    const step = 4000 / (view.view.scale / 0.004);
    const pan = [['◀', -1, 0], ['▲', 0, -1], ['▼', 0, 1], ['▶', 1, 0]];
    pan.forEach(([l, dx, dz], i) => ui.button(W - 4 * 58 - 10 + i * 58, H - 50, 52, 42, l, () => { c.x += dx * step; c.z += dz * step; }, { size: 20 }));
    ui.button(12, H - 50, 180, 42, 'CENTRE: BASE', () => { c.x = BASES[0].x; c.z = BASES[0].z - 8000; }, { size: 15 });
    ui.button(200, H - 50, 180, 42, 'CENTRE: ME', () => { const p = g.tacmap && g.tacmap.focusPos(); if (p) { c.x = p.x; c.z = p.z; } }, { size: 15 });
}

function drawIntelBoard(ctx, ui, s, g, interactive) {
    const W = s.w, H = s.h, war = g.war;
    const y0 = page(ctx, W, H, 'INTELLIGENCE — KNOWN TARGETS', 'FRONT', clockZ(g));
    const rows = [];
    for (const u of war.units) {
        const r = war.rec(u);
        if (!r || r.team === war.side || r.team === 'neutral' || r.known < INTEL.CONTACT) continue;
        if (r.cls === 'aircraft' || r.cls === 'helicopter' || r.cls === 'infantry') continue;
        rows.push({ u, r });
    }
    rows.sort((a, b) => (b.r.known - a.r.known) || (a.u.alive === b.u.alive ? 0 : a.u.alive ? -1 : 1));
    const sectors = (g.front && g.front.sectors) || [];
    const listW = sectors.length ? W * 0.64 : W - 24;
    text(ctx, 'TARGET                          CLASS       INTEL          GRID', 16, y0 + 10, 13, C.dim, 700);
    const n = Math.floor((H - y0 - 40) / 30);
    rows.slice(0, n).forEach(({ u, r }, i) => {
        const cells = [[war.label(u) + (u.alive ? '' : ' (DESTROYED)'), listW * 0.44], [r.cls.toUpperCase(), listW * 0.14], [INTEL_NAMES[r.known], listW * 0.18], [war.grid(r.lastPos.x, r.lastPos.z), listW * 0.22]];
        const marked = war.designations.some(d => d.unit === u);
        ui.row(12, y0 + 24 + i * 30, listW, 28, cells, interactive && u.alive ? () => { war.designate(u, 'joc'); } : null, { sel: marked, colors: [r.known >= INTEL.IDENTIFIED ? C.red : C.amber, C.text, r.known >= INTEL.CONFIRMED ? C.green : C.cyan] });
    });
    if (!rows.length) text(ctx, 'NOTHING KNOWN YET — FLY RECON, USE THE TARGETING POD', listW / 2, y0 + 80, 16, C.dim, 700, 'center');
    // the front's sectors, beside the list (front.js)
    if (sectors.length) {
        const x0 = W * 0.67, w = W - x0 - 12;
        text(ctx, 'THE FRONT', x0, y0 + 10, 14, C.dim, 700);
        sectors.slice(0, Math.floor((H - y0 - 40) / 34)).forEach((sc, i) => {
            const y = y0 + 26 + i * 34, tot = (sc.blue || 0) + (sc.red || 0) || 1;
            text(ctx, (sc.name || 'SECTOR ' + (i + 1)).toUpperCase(), x0, y + 6, 13, sc.contested ? C.amber : C.text, 700, 'left', w * 0.45);
            ctx.fillStyle = C.blue; ctx.fillRect(x0 + w * 0.47, y, w * 0.5 * (sc.blue || 0) / tot, 12);
            ctx.fillStyle = C.red; ctx.fillRect(x0 + w * 0.47 + w * 0.5 * (sc.blue || 0) / tot, y, w * 0.5 * (sc.red || 0) / tot, 12);
            text(ctx, (sc.off >= 0 ? '+' : '') + ((sc.off || 0) / 1000).toFixed(1) + ' KM' + (sc.offensive ? ' · OFFENSIVE' : ''), x0 + w * 0.47, y + 22, 11, C.dim, 600, 'left', w * 0.53);
        });
    }
    if (interactive) text(ctx, 'CLICK A TARGET TO MARK IT (IT JOINS THE STRIKE CONSOLES\' LISTS)', 16, H - 18, 13, C.dim, 600, 'left', W - 32);
}

function drawTasks(ctx, ui, s, g, interactive) {
    const W = s.w, H = s.h, T = g.tasks;
    const y0 = page(ctx, W, H, 'TASKS', T && T.enabled ? (T.doneCount || 0) + ' DONE' : 'NO WAR RUNNING', clockZ(g));
    if (!T || !T.enabled) { text(ctx, 'TASKS COME WITH THE LIVING WAR (AND SANDBOX)', W / 2, H / 2, 18, C.dim, 700, 'center'); return; }
    let y = y0 + 16;
    const a = T.active;
    if (a) {
        text(ctx, '▶ ' + a.title, 16, y, 18, C.green, 700, 'left', W - (interactive ? 250 : 32));
        if (interactive) ui.button(W - 230, y - 18, 214, 36, 'PUT ON HOLD', () => T.abandon(a), { size: 14 });
        y += 24;
        text(ctx, a.brief || '', 16, y, 13, C.dim, 600, 'left', W - 32); y += 30;
    }
    const offered = T.offered.slice().sort((p, q) => (q.urgent - p.urgent) || p.t0 - q.t0);
    for (const t of offered) {
        if (y > H - 50) break;
        text(ctx, (t.urgent ? '! ' : '') + t.title + '  +' + t.reward, 16, y, 16, t.urgent ? C.amber : C.text, 700, 'left', W - (interactive ? 250 : 32));
        if (interactive) ui.button(W - 230, y - 17, 214, 34, 'ACCEPT', () => T.accept(t), { size: 15 });
        y += 36;
    }
    if (!a && !offered.length) text(ctx, 'NO TASKS RIGHT NOW — STAND BY', W / 2, y0 + 70, 18, C.dim, 700, 'center');
    if (interactive && offered.length) ui.button(16, H - 50, 260, 40, 'IGNORE ALL OFFERS', () => T.dismissOffers(), { size: 15 });
}

// the command menu (\) as a console: categories, then their entries (the same run() the menu calls)
function drawCommandConsole(ctx, ui, s, g, ops) {
    const W = s.w, H = s.h, cm = g.command;
    const path = ops.cmdPath;
    const y0 = page(ctx, W, H, 'COMMAND' + (path.length ? ' › ' + path.join(' › ') : ''), 'THE COMMAND MENU (\\)', clockZ(g));
    if (!cm) return;
    const all = cm.entries();
    const here = all.filter(e => path.every((p, i) => e.path[i] === p));
    const cats = [];
    for (const e of here) if (e.path.length > path.length && !cats.includes(e.path[path.length])) cats.push(e.path[path.length]);
    const rows = [...cats.map(c => ({ cat: c, label: c + '  ›', hint: here.filter(e => e.path[path.length] === c).length + '' })), ...here.filter(e => e.path.length === path.length)];
    const cols = 2, bw = (W - 36) / cols, bh = 52;
    rows.slice(0, 16).forEach((r, i) => {
        const x = 12 + (i % cols) * (bw + 12), y = y0 + 10 + Math.floor(i / cols) * (bh + 8);
        const en = typeof r.enabled === 'function' ? r.enabled() : r.enabled !== false;
        ui.button(x, y, bw, bh, r.label, () => { if (r.cat) { ops.cmdPath = [...path, r.cat]; return; } if (!en) return; try { r.run && r.run(); } catch (e) { console.warn(e); } g.audio.tick(1500, 0.06, 0.05); }, { disabled: !en, sub: r.hint || '', size: 15, on: false });
    });
    if (path.length) ui.button(12, H - 54, 200, 44, '‹ BACK', () => { ops.cmdPath = path.slice(0, -1); }, { size: 16 });
}

function drawJocStrike(ctx, ui, s, g, ops) {
    const W = s.w, H = s.h, K = ops.console;
    const y0 = page(ctx, W, H, 'STRIKE CELL — REQUEST', K.armed ? 'ARMED' : '', clockZ(g), K.armed ? C.red : C.cyan);
    const types = Object.keys(STRIKE_TYPES).filter(k => k !== 'multi');
    types.forEach((k, i) => ui.button(12 + (i % 4) * 252, y0 + 8 + Math.floor(i / 4) * 52, 244, 46, STRIKE_TYPES[k].label.replace(' STRIKE', '').replace('MISSILE ', ''), () => { ops.jtype = k; K.shooter = null; K.armed = false; }, { on: ops.jtype === k && !K.shooter, size: 13 }));
    // specific shooters for the type's missile (or AUTO: the nearest with stock, strikes.request)
    const T = STRIKE_TYPES[ops.jtype];
    const spec = T.use ? T.use[g.war.side] : null;
    const sh = spec ? K.ctx.shooters().filter(x => x.stock[spec] > 0 && T.sources.includes(x.src.kind)) : [];
    text(ctx, 'SOURCE', 16, y0 + 128, 14, C.dim, 700);
    ui.button(12, y0 + 140, 180, 40, 'AUTO', () => { K.shooter = null; K.armed = false; }, { on: !K.shooter, size: 15 });
    sh.slice(0, 4).forEach((x, i) => ui.button(200 + i * 204, y0 + 140, 196, 40, x.name, () => { K.select('shooter', x); K.weapon = spec; }, { on: K.shooter && K.shooter.key === x.key, sub: MISSILES[spec].short + ' ×' + x.stock[spec], size: 13 }));
    const tl = targetList(g, BASES[0], { max: 7 });
    text(ctx, 'TARGET', 16, y0 + 200, 14, C.dim, 700);
    tl.forEach((t, i) => ui.row(12, y0 + 212 + i * 30, W - 24, 28, [[t.label, W * 0.45], [t.kind === 'sea' ? 'SEA' : 'LAND', 90], [t.grid || '', 200], [Math.round(t.km) + ' KM', 120, 'right']], () => K.select('target', t), { sel: K.target && K.target.key === t.key, colors: [t.mark ? C.green : C.text] }));
    ui.button(12, H - 54, 260, 44, K.shooter ? 'ARM' : 'REQUEST (ARM)', () => { if (!K.target) { K.msg = 'SELECT A TARGET'; return; } if (K.shooter) report(g, K.arm()); else { K.armed = true; K.msg = 'ARMED — ' + T.label + ': LIFT THE GUARD, EXECUTE'; } }, { on: K.armed, size: 16 });
    text(ctx, K.msg || 'TYPE · SOURCE · TARGET · ARM · EXECUTE (THE GUARDED BUTTON)', 290, H - 32, 14, K.armed ? C.red : C.dim, 700, 'left', W - 300);
}

function drawWarSummary(ctx, ui, s, g) {
    const W = s.w, H = s.h, war = g.war;
    const y0 = page(ctx, W, H, 'BATTLE CAB — THE WAR', g.mode === 'war' ? 'LIVING WAR' : g.mode.toUpperCase(), clockZ(g));
    readout(ctx, 20, y0 + 10, 300, 90, 'SCORE', Math.round(g.score || 0) + '', C.white);
    const sectors = (g.front && g.front.sectors) || [];
    const moved = sectors.length ? sectors.reduce((a, x) => a + (x.off || 0), 0) / sectors.length / 1000 : 0;
    readout(ctx, 340, y0 + 10, 300, 90, 'FRONT (MEAN)', (moved >= 0 ? '+' : '') + moved.toFixed(1), moved >= 0 ? C.green : C.red, 'KM');
    readout(ctx, 660, y0 + 10, 340, 90, 'TASKS DONE', (g.tasks ? g.tasks.doneCount || 0 : 0) + '', C.cyan);
    const d = g.director;
    const fl = d && d.flights ? d.flights : [];
    readout(ctx, 20, y0 + 120, 300, 90, 'OUR FLIGHTS', fl.filter(x => x.team === war.side).length + '', C.blue);
    readout(ctx, 340, y0 + 120, 300, 90, 'ENEMY FLIGHTS (KNOWN)', fl.filter(x => x.team !== war.side && x.detected).length + '', C.red);
    readout(ctx, 660, y0 + 120, 340, 90, 'MARKS', war.designations.length + '', C.green);
    const last = war.radioLog.slice(-4);
    last.forEach((m, i) => text(ctx, (m.from ? m.from + ': ' : '') + m.text, 20, y0 + 250 + i * 28, 14, m.color || C.text, 600, 'left', W - 40));
    void ui;
}

function drawTelPanel(ctx, ui, s, g, ops) {
    const W = s.w, H = s.h, p = ops.panel;
    ctx.fillStyle = '#031006'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(80,255,120,0.03)'; for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    const G = '#7dff9a', D = 'rgba(125,255,154,0.45)', A = '#ffd24a';
    const t = (s1, x, y, px = 18, col = G, al = 'left') => text(ctx, s1, x, y, px, col, 700, al, W - 30);
    t('2V12M · ПУСК · LAUNCH STATION', 16, 22, 20);
    if (!p) return;
    const steps = [
        ['POWER / GENERATOR', ops.powered()], ['PARKING BRAKE', p.brake], ['REAR SUPPORTS', p.k.jack >= 1], ['LAUNCH TABLE', p.k.pad >= 1], ['BOOM ERECTED', p.erected],
        ['TARGET', !!p.target], ['ALIGNED (1G5)', p.align >= 1], ['CONTROL SYSTEM TEST', !!(ops.tested && g.time > ops.tested)], ['COMBAT MODE', !!ops.combat], ['BATTERIES', !!ops.batt], ['CODE LOCK', ops.codeOk()],
    ];
    const first = steps.findIndex(x => !x[1]);
    steps.forEach(([l, ok], i) => { t((ok ? '■ ' : '□ ') + l, 16, 58 + i * 30, 17, ok ? G : i === first ? A : D); });
    // the target list (the launch order) and the range
    t('TARGETS', W * 0.55, 58, 15, D);
    const tl = ops.panelCtx().targets();
    tl.slice(0, 6).forEach((x, i) => ui.row(W * 0.55 - 4, 70 + i * 30, W * 0.45 - 12, 28, [[x.label, W * 0.3], [Math.round(Math.hypot(x.pos.x - ops.tel.pos.x, x.pos.z - ops.tel.pos.z) / 1000) + ' KM', W * 0.13, 'right']], () => { p.selectTarget(x); }, { sel: p.target && p.target.key === x.key, colors: [G, G] }));
    if (!tl.length) t('NO TARGETS — MARK ONE', W * 0.55, 90, 14, A);
    if (p.target) {
        const rg = ops.panelCtx().range(p.target);
        t('RANGE ' + Math.round(rg.km) + ' KM ' + (rg.ok ? '(IN)' : '(OUT: 20–300)'), W * 0.55, 270, 16, rg.ok ? G : A);
        t('AZIMUTH ' + String(Math.round(bearing(ops.tel.pos, p.target.pos))).padStart(3, '0') + '°', W * 0.55, 296, 16, G);
    }
    t('LAUNCH ORDER CODE: ' + ops.code, W * 0.55, 330, 16, A);
    t('DIALLED: ' + ops.dial.join(''), W * 0.55, 356, 16, ops.codeOk() ? G : D);
    t(p.msg || (ops.ready() === true ? 'READY — LIFT THE COVER, PRESS ПУСК' : 'NEXT: ' + (steps[first] ? steps[first][0] : '')), 16, H - 20, 16, ops.ready() === true ? A : D);
}

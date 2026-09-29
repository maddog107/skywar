// ═══════════════════════════════════════════════════════════════
// The sandbox toolkit (SANDBOX mode; docs/WAR.md "Sandbox"): set up a war and watch it.
//  • a SANDBOX panel on the tactical map (` or F2): SPAWN (aircraft, ships, ground units, installations, by side, then a
//    click on the map: ships only on open water, ground units only on firm land, aircraft at the altitude chosen),
//    UNITS (what's been placed: select, follow, re-task, delete), WAR (the side you fly for, the background war, the
//    weather and the time), WATCH (the spectator camera, the sim clock) and FILE (one-click scenarios, three save slots)
//  • missions drawn on the map: a patrol route, a CAP orbit, strike this, escort that, recon an area, SEAD, move, RTB —
//    through the plug-ins' own AI (sandboxunits.js: director flights, air support, naval groups, mobile forces)
//  • the spectator (spectator.js): BACKSPACE (or the map's FOLLOW) watches any unit; TAB / X next / previous, V the view, F a
//    free camera, 1–4 the clock (pause, ×1, ×2, ×4; PAGE UP / DOWN and HOME any time); the HUD says what it's doing
//  • the side swap: war.setSide, a fresh jet on that side's airfield (game.side is what the core reads)
//  • saved setups under localStorage 'skywar.sandbox' only (sandboxdefs.js)
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { terrainHeight, isOnRunway, BASES, groundHeight } from './world.js';
import { INTEL } from './war.js';
import { STRIKE_TYPES } from './strikes.js';
import {
    ITEMS, CATEGORIES, itemsIn, VARIANT_NAMES, variantOf, MISSIONS, missionsFor, validatePlacement, findSpot,
    normalizeSetup, readStore, writeStore, PRESETS, SIM_SPEEDS, SLOTS, FORMAT,
} from './sandboxdefs.js';
import { DRIVERS, KIND_OF, nameOf } from './sandboxunits.js';
import { Spectator, VIEW_MODES } from './spectator.js';
import { clamp } from './util.js';

const FONT = '"Share Tech Mono", monospace';
const OWN = '#6fb4ff', FOE = '#ff5a4a', CIV = '#cfd8e0', GREEN = '#5dffa0', AMBER = '#ffc23f', DIM = '#9fb2c4', TXT = '#e8f4ff';
const TABS = [['spawn', 'SPAWN'], ['units', 'UNITS'], ['war', 'WAR'], ['watch', 'WATCH'], ['file', 'FILE']];
const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'overcast'];
const WX_LABEL = { clear: 'CLEAR', cloudy: 'CLOUDY', rain: 'RAIN', storm: 'STORM', fog: 'FOG', overcast: 'LOW CLOUD' };
const TIMES = [['dawn', 'DAWN'], ['day', 'DAY'], ['dusk', 'DUSK'], ['night', 'NIGHT']];
const CLOCKS = [0, 1, 20, 60, 300];
const ALTS = { air: [1500, 5000, 9000], heli: [120, 300, 600] };
const NON_FOLLOW = new Set(['runway', 'taxiway', 'tower', 'fuel', 'ammo', 'shelter', 'hangar', 'power', 'bridge', 'facility', 'entrance', 'airbase', 'bunker']);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), P = {}, Q = {};

export class SandboxTools {
    constructor(game) {
        this.game = game;
        this.enabled = false;
        this.placed = [];
        this.nextId = 1;
        this.pal = { tab: 'spawn', cat: 'air', item: 'fighter', team: 'blue', variant: 0, n: 2, alt: 5000, open: true, scroll: 0 };
        this.tool = null;          // { kind: 'place' | 'dest' | 'mission', … }: what the next map click does
        this.sel = null;           // the placed record selected
        this.msg = null;
        this.background = true;    // the Living War's own activity (the director's flights, the forces' orders, tasks)
        this.godView = true;       // the map shows everything placed, known to intel or not
        this.holdJet = true;       // the player's jet waits (held, ignored by the AI) while the camera watches
        this.wxBlend = false;      // weather changes over two minutes instead of at once
        this.spec = new Spectator(this);
        this.env = {
            heightAt: terrainHeight,
            sideAt: (x, z) => game.war.sideAt(x, z),
            onRunway: (x, z) => !!isOnRunway(x, z),
            inTown: (x, z) => { const t = game.world && game.world.towns && game.world.towns.towns; return !!t && t.some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < (q.radius + 60) ** 2); },
            bases: BASES,
        };
        this.bindInput();
    }

    get war() { return this.game.war; }
    get storage() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }

    // ═════════════ Lifecycle ═════════════
    start(mode) {
        this.clear();
        this.enabled = mode === 'sandbox';
        if (!this.enabled) return;
        this.pal.team = this.war.side;
        this.store = readStore(this.storage);
        // a battle you set up is fought by real jets near the camera: a bigger budget than the war's own (~0.2 ms each)
        if (this.game.director) { this.game.director.liveMax = 12; this.game.director.fighterMax = 8; }
    }

    clear() {
        this.spec.stop();
        this.spec.target = null;
        this.placed.length = 0;   // (the game has taken everything away by now: the records just go)
        this.tool = null; this.sel = null; this.msg = null;
        this.background = true;
        const g = this.game;
        g.simSpeed = 1;
        g.viewFocus = null;
        if (g.director) { g.director.auto = true; g.director.liveMax = undefined; g.director.fighterMax = undefined; }
        if (g.forces && g.forces.auto) for (const k of Object.keys(g.forces.auto)) g.forces.auto[k] = true;
        this.enabled = false;
    }

    say(text, color = TXT) {
        this.msg = { text, color, t: this.game.time };
        this.game.addFeed('SANDBOX: ' + text, color);
    }

    // ═════════════ Placing ═════════════
    // place an item for a team at (x, z): { variant, n, alt, to, from, quiet } → the record, or null (this.why says why)
    place(item, team, x, z, o = {}) {
        const I = ITEMS[item];
        this.why = '';
        if (!I) { this.why = 'UNKNOWN UNIT'; return null; }
        if (!I.teams.includes(team)) { this.why = I.label + ' ISN\'T AVAILABLE FOR ' + team.toUpperCase(); return null; }
        if (I.ownSide && team !== this.war.side) { this.why = I.label + ': YOUR OWN SIDE ONLY'; return null; }
        const alt = o.alt ?? I.alt;
        const v = validatePlacement(item, x, z, this.env, { alt });
        if (!v.ok) { this.why = v.why; return null; }
        const variant = o.variant ?? 0;
        const rec = {
            id: this.nextId++, item, kind: KIND_OF[item], team, variant, type: variantOf(item, team, variant),
            n: clamp(o.n ?? I.n ?? 1, 1, 8), alt, at: { x, y: v.y, z }, to: o.to || null, from: o.from || null, mission: null, handle: null, t0: this.game.time,
        };
        rec.label = this.labelOf(rec);
        const D = DRIVERS[rec.kind];
        try { rec.handle = D.spawn(this, rec, rec.at); } catch (e) { console.warn('[sandbox] spawn', item, e); rec.why = 'IT FAILED TO SPAWN'; }
        if (!rec.handle) { this.why = rec.why || 'NOTHING FITS THERE'; return null; }
        rec.label = this.labelOf(rec);
        this.placed.push(rec);
        if (!o.quiet) this.say('PLACED ' + rec.label + ' — GRID ' + this.war.grid(x, z), team === 'red' ? FOE : team === 'blue' ? OWN : CIV);
        this.game.events.emit('sandboxPlaced', rec);
        return rec;
    }

    labelOf(rec) {
        const side = rec.team === 'neutral' ? 'CIVIL' : rec.team.toUpperCase();
        const I = ITEMS[rec.item];
        const typed = ['fighter', 'attack', 'bomber', 'awacs', 'tanker', 'growler', 'drone', 'heli', 'tel', 'sam', 'artillery'].includes(rec.item);
        const what = typed ? (rec.n > 1 ? rec.n + '× ' : '') + (VARIANT_NAMES[rec.type] || rec.type || I.label) : I.label;
        const call = rec.call ? ' "' + rec.call + '"' : '';
        return side + ' ' + what + call;
    }

    remove(rec) {
        const i = this.placed.indexOf(rec);
        if (i < 0) return;
        const units = this.unitsOf(rec);
        try { DRIVERS[rec.kind].remove(this, rec); } catch (e) { console.warn('[sandbox] remove', e); }
        // (intel reports about what's gone go with it: "LAUNCHER PREPARING TO FIRE" over an empty hillside)
        const reps = this.war.reports;
        for (let k = reps.length - 1; k >= 0; k--) if (reps[k].unit && units.includes(reps[k].unit)) reps.splice(k, 1);
        this.placed.splice(i, 1);
        for (const r of this.placed) if (r.mission && r.mission.target && r.mission.target.rec === rec) r.mission.target = null;
        if (this.sel === rec) this.sel = null;
        if (this.spec.target && this.spec.target.rec === rec) this.spec.target = null;
        const map = this.game.tacmap;
        if (map && map.sel && (map.sel.rec === rec || (map.sel.unit && this.recOfUnit(map.sel.unit) === rec))) map.sel = null;
    }
    removeAll() { for (const r of [...this.placed]) this.remove(r); }

    // ── the records' units, for the map, the camera and the missions ──
    unitsOf(rec) { try { return DRIVERS[rec.kind].units(this, rec); } catch (e) { return []; } }
    leadOf(rec) { return this.unitsOf(rec)[0] || null; }
    posOf(rec, out = new THREE.Vector3()) { return DRIVERS[rec.kind].pos(this, rec, out); }
    aliveOf(rec) { try { return DRIVERS[rec.kind].alive(this, rec); } catch (e) { return false; } }
    stateOf(rec) { try { const D = DRIVERS[rec.kind]; return D.state ? D.state(this, rec) : ''; } catch (e) { return ''; } }
    recOfUnit(u) {
        if (!u) return null;
        for (const r of this.placed) if (r.handle === u || this.unitsOf(r).includes(u)) return r;
        return null;
    }

    // ═════════════ Missions ═════════════
    // m: { type, route: [{ x, z }], at: { x, z }, target: { rec } | { unit } | null }. Returns true, or a reason
    assign(rec, m, { quiet = false } = {}) {
        if (!rec || !MISSIONS[m.type]) return 'NO SUCH MISSION';
        if (!missionsFor(rec.item).includes(m.type)) return MISSIONS[m.type].label + ' ISN\'T FOR ' + ITEMS[rec.item].label;
        if (MISSIONS[m.type].input === 'route' && !(m.route && m.route.length)) return 'NO ROUTE';
        if (!m.at) {
            if (m.target) { const p = m.target.unit ? m.target.unit.pos : m.target.rec ? this.posOf(m.target.rec, new THREE.Vector3()) : null; if (p) m.at = { x: p.x, z: p.z }; }
            else if (m.route && m.route.length) m.at = { x: m.route[0].x, z: m.route[0].z };
        }
        if ((m.type === 'strike' || m.type === 'escort') && m.target && m.target.rec === rec) return 'NOT ITSELF';
        let r;
        try { r = DRIVERS[rec.kind].assign(this, rec, m); } catch (e) { console.warn('[sandbox] assign', e); r = 'IT COULDN\'T TAKE THAT'; }
        if (r === true) {
            rec.mission = m.type === 'rtb' ? null : m;
            rec.leg = 0;
            if (!quiet) this.say(rec.label + ': ' + MISSIONS[m.type].label + (m.target ? ' — ' + this.targetName(m.target) : m.at ? ' — GRID ' + this.war.grid(m.at.x, m.at.z) : ''), GREEN);
        } else if (!quiet) this.say(rec.label + ': ' + r, AMBER);
        return r;
    }
    targetName(t) { return t.rec ? t.rec.label : t.unit ? nameOf(this.game, t.unit) : 'THE POINT'; }

    // ═════════════ Save, load, scenarios ═════════════
    // the setup as it stands (what's alive, where it is now, what it's doing)
    snapshot(name = 'SETUP') {
        const g = this.game, W = g.weather;
        const live = this.placed.filter(r => this.aliveOf(r));
        const idx = (rec) => live.indexOf(rec);
        const units = live.map(rec => {
            const p = this.posOf(rec, _v);
            const u = { item: rec.item, team: rec.team, variant: rec.variant, x: Math.round(p.x), z: Math.round(p.z) };
            if (rec.n > 1 || ITEMS[rec.item].n) u.n = rec.n;
            if (ITEMS[rec.item].domain === 'air') u.alt = Math.round(rec.alt);
            if (rec.item === 'convoy' && rec.to) u.to = { x: rec.to.x, z: rec.to.z };
            const m = rec.mission;
            if (m) {
                const s = { type: m.type };
                if (m.route) s.route = m.route.map(q => ({ x: Math.round(q.x), z: Math.round(q.z) }));
                if (m.at) s.at = { x: Math.round(m.at.x), z: Math.round(m.at.z) };
                if (m.target) {
                    const tr = m.target.rec || this.recOfUnit(m.target.unit);
                    if (tr && idx(tr) >= 0) s.target = { ref: idx(tr) };
                    else if (m.at) s.target = { x: Math.round(m.at.x), z: Math.round(m.at.z) };
                }
                u.mission = s;
            }
            return u;
        });
        return normalizeSetup({
            v: FORMAT, name, faction: this.war.side, background: this.background,
            weather: W ? W.kind : 'clear', hour: W ? W.hour : 13, clock: W ? W.timeScale : 1, units,
        });
    }

    // a setup (a save or a scenario) replaces what's placed: side, background, weather, time, the units and their orders
    apply(setup, { quiet = false } = {}) {
        const s = normalizeSetup(setup);
        const g = this.game;
        if (!s) { this.say('THAT ISN\'T A SANDBOX SETUP', AMBER); return { ok: false, placed: 0, failed: [] }; }
        this.spec.stop();
        this.tool = null; this.sel = null;
        this.removeAll();
        if (s.faction !== this.war.side) this.setFaction(s.faction, { quiet: true });
        this.setBackground(s.background && s.faction === 'blue', { quiet: true });
        const W = g.weather;
        if (W && W.wx) { W.set(s.weather); W.setTime(s.hour); W.timeScale = s.clock; }
        if (s.player && g.player && g.player.alive && !g.pilotMode) {
            const p = g.player;
            p.spawnAir(new THREE.Vector3(s.player.x, Math.max(s.player.alt, groundHeight(s.player.x, s.player.z) + 400), s.player.z), s.player.heading, 0.62);
        }
        const recs = [], failed = [];
        s.units.forEach((u, i) => {
            let x = u.x, z = u.z;
            if (u.near) { const at = this.nearPoint(u, recs[u.near.ref]); if (at) { x = at.x; z = at.z; } }
            let rec = this.place(u.item, u.team, x, z, { variant: u.variant, n: u.n, alt: u.alt, to: u.to, from: u.from, quiet: true });
            if (!rec && ITEMS[u.item].domain !== 'air') {
                // (the ground moved under a save: the nearest spot that fits)
                const spot = findSpot(u.item, { x, z }, this.env, { rMax: 3000, step: 250, alt: u.alt });
                if (spot) rec = this.place(u.item, u.team, spot.x, spot.z, { variant: u.variant, n: u.n, alt: u.alt, to: u.to, from: u.from, quiet: true });
            }
            recs[i] = rec;
            if (!rec) failed.push(ITEMS[u.item].label + ' (' + (this.why || '?') + ')');
        });
        s.units.forEach((u, i) => {
            const rec = recs[i];
            if (!rec || !u.mission) return;
            const m = { type: u.mission.type };
            if (u.mission.route) m.route = u.mission.route.map(q => ({ x: q.x, z: q.z }));
            if (u.mission.at) m.at = { ...u.mission.at };
            if (u.mission.target) {
                if (u.mission.target.ref != null) { const tr = recs[u.mission.target.ref]; if (tr) m.target = { rec: tr }; }
                else m.at = m.at || { x: u.mission.target.x, z: u.mission.target.z };
            }
            if ((m.type === 'strike' || m.type === 'escort') && !m.target && !m.at) return;
            this.assign(rec, m, { quiet: true });
        });
        const n = recs.filter(Boolean).length;
        if (s.view && recs[s.view.follow]) this.spec.start({ rec: recs[s.view.follow] });
        if (!quiet) this.say(s.name + ' — ' + n + ' PLACED' + (failed.length ? ', ' + failed.length + ' COULDN\'T BE: ' + failed.join(', ') : ''), failed.length ? AMBER : GREEN);
        return { ok: true, placed: n, failed, recs };
    }

    // where a unit placed "near" another goes: beside a convoy's road (along its route), or by the other's position
    nearPoint(u, ref) {
        if (!ref) return null;
        let base, perp = { x: 1, z: 0 };
        const h = ref.handle;
        if (h && h.route && h.route.len && h.route.at) {
            const q = h.route.at(h.route.len * u.near.along, {}, 0);
            base = { x: q.x, z: q.z };
            const L = Math.hypot(q.tx || 0, q.tz || 0) || 1;
            perp = { x: -(q.tz || 0) / L, z: (q.tx || 1) / L };
        } else { const p = this.posOf(ref, _v); base = { x: p.x, z: p.z }; }
        const want = { x: base.x + perp.x * u.near.side, z: base.z + perp.z * u.near.side };
        return findSpot(u.item, want, this.env, { rMax: 1500, step: 100 }) || want;
    }

    loadPreset(id) {
        const pr = PRESETS.find(p => p.id === id);
        if (!pr) return null;
        let setup;
        try { setup = pr.build(this.env); } catch (e) { this.say(pr.label + ': ' + e.message.toUpperCase(), AMBER); return null; }
        return this.apply(setup);
    }
    saveSlot(i) {
        const st = this.store || (this.store = readStore(this.storage));
        const W = this.game.weather;
        st.slots[i] = this.snapshot('SLOT ' + (i + 1) + ' · ' + this.placed.filter(r => this.aliveOf(r)).length + ' UNITS · ' + (W ? String(Math.floor(W.hour)).padStart(2, '0') + 'H' : ''));
        const ok = writeStore(this.storage, st);
        this.say(ok ? 'SAVED TO SLOT ' + (i + 1) : 'COULDN\'T SAVE (STORAGE BLOCKED)', ok ? GREEN : AMBER);
        return ok;
    }
    loadSlot(i) {
        const st = this.store || (this.store = readStore(this.storage));
        if (!st.slots[i]) { this.say('SLOT ' + (i + 1) + ' IS EMPTY', AMBER); return null; }
        return this.apply(st.slots[i]);
    }
    clearSlot(i) {
        const st = this.store || (this.store = readStore(this.storage));
        st.slots[i] = null;
        writeStore(this.storage, st);
    }

    // ═════════════ The war around it ═════════════
    // fly for the other side: war.setSide, and a fresh jet on that side's field
    setFaction(side, { quiet = false } = {}) {
        const g = this.game, war = this.war;
        if (side !== 'blue' && side !== 'red') return false;
        if (side === war.side) return true;
        if (g.pilotMode) { if (!quiet) this.say('CLIMB BACK INTO A JET FIRST', AMBER); return false; }
        const watching = this.spec.on;
        this.spec.stop();
        // the background war is blue against red with the player on blue (the director's GCI, raids and tasks): off for red
        if (side !== 'blue') this.setBackground(false, { quiet: true });
        war.setSide(side);
        this.pal.team = side;
        const old = g.player;
        if (old) {
            old.remove();
            const i = g.aircraft.indexOf(old);
            if (i >= 0) g.aircraft.splice(i, 1);
            old.removed = true;
            g.player = null;
        }
        g.lockTarget = null;
        if (g.respawnPlayer) g.respawnPlayer();
        if (!quiet) g.showBanner && g.showBanner('FLYING FOR ' + side.toUpperCase(), side === 'red' ? 'Your jet is on the red airfield. The background war is off: set up your own.' : 'Back on the blue side.', 5, side === 'red' ? FOE : OWN);
        if (watching) this.spec.start();
        return true;
    }
    // the war's own activity on or off (placed things carry on)
    setBackground(on, { quiet = false } = {}) {
        const g = this.game;
        if (on && this.war.side !== 'blue') { if (!quiet) this.say('THE BACKGROUND WAR NEEDS YOU ON BLUE', AMBER); on = false; }
        this.background = on;
        if (g.director) g.director.auto = on;
        if (g.forces && g.forces.auto) for (const k of Object.keys(g.forces.auto)) g.forces.auto[k] = on;
        if (g.tasks) { if (on && !g.tasks.enabled) g.tasks.start('sandbox'); else if (!on && g.tasks.enabled) g.tasks.clear(); }
        if (!quiet) this.say('BACKGROUND WAR ' + (on ? 'ON' : 'OFF'), on ? GREEN : DIM);
    }
    // the sim clock: 0 paused, 1, 2, 4
    setSimSpeed(s) {
        const g = this.game;
        g.simSpeed = SIM_SPEEDS.includes(s) ? s : 1;
        g.addFeed(g.simSpeed === 0 ? 'SIM PAUSED' : 'SIM ×' + g.simSpeed, g.simSpeed === 1 ? GREEN : AMBER);
    }
    stepSimSpeed(d) {
        const i = SIM_SPEEDS.indexOf(this.game.simSpeed ?? 1);
        this.setSimSpeed(SIM_SPEEDS[clamp((i < 0 ? 1 : i) + d, 0, SIM_SPEEDS.length - 1)]);
    }
    setWeather(kind) { const W = this.game.weather; if (W) W.set(kind, { transition: this.wxBlend ? 120 : 0, say: true }); }

    // the game asks where the next jet goes: this side's airfield when flying for red
    respawnPoint() {
        if (!this.enabled || this.war.side === 'blue') return null;
        const base = BASES.find(b => !b.friendly && !b.civil);
        return base ? { where: 'runway', base } : null;
    }

    // ═════════════ Watching ═════════════
    // what the camera can follow: the placed units first, then every aircraft and ship, then ground units
    followables() {
        const g = this.game, out = [], seen = new Set();
        for (const r of this.placed) if (this.aliveOf(r)) { out.push({ rec: r }); for (const u of this.unitsOf(r)) seen.add(u); }
        for (const a of g.aircraft) if (a.alive && a !== g.player && !seen.has(a) && !a.removed) out.push({ unit: a });
        for (const s of (g.naval ? g.naval.ships : [])) if (s.alive && !s.gone && !seen.has(s)) out.push({ unit: s });
        const war = this.war;
        for (const u of war.units) {
            if (!u.alive || u.removed || seen.has(u) || u.isShip) continue;
            const r = war.recs.get(u);
            if (!r || NON_FOLLOW.has(r.cls) || r.cls === 'aircraft' || r.cls === 'helicopter' && !u.alive) continue;
            if (!u.isGround && r.cls !== 'helicopter') continue;
            out.push({ unit: u });
            if (out.length > 160) break;
        }
        return out;
    }
    sameTarget(a, b) { return !!a && !!b && (a.rec ? a.rec === b.rec : a.unit === b.unit); }
    nextFollow(d = 1, skipCurrent = false) {
        const list = this.followables();
        if (!list.length) return null;
        const cur = this.spec.target;
        let i = cur ? list.findIndex(t => this.sameTarget(t, cur) || (cur.unit && t.rec && this.unitsOf(t.rec).includes(cur.unit))) : -1;
        if (i < 0) return list[d > 0 ? 0 : list.length - 1];
        i = (i + d + list.length) % list.length;
        if (skipCurrent && this.sameTarget(list[i], cur)) return null;
        return list[i];
    }
    defaultFollow() {
        if (this.sel) return { rec: this.sel };
        const g = this.game, p = g.player ? g.player.pos : g.camera.position;
        let best = null, bd = Infinity;
        for (const r of this.placed) { if (!this.aliveOf(r)) continue; const d = this.posOf(r, _v).distanceToSquared(p); if (d < bd) { bd = d; best = r; } }
        if (best) return { rec: best };
        return this.nextFollow(1);
    }
    spectate(target = null) { if (!this.enabled) return false; return this.spec.start(target); }
    toggleSpectate() { if (this.spec.on) this.spec.stop(); else this.spectate(); }

    // what the followed unit is doing, for the HUD: [title, lines…]
    describe(t) {
        const g = this.game, war = this.war;
        if (!t) return ['FREE CAMERA', 'W/S/A/D · Q/E · SHIFT FASTER · MOUSE LOOKS · WHEEL: SPEED'];
        const rec = t.rec || this.recOfUnit(t.unit);
        const u = t.unit || (rec && this.leadOf(rec));
        const out = [];
        out.push(rec ? rec.label : nameOf(g, u) + ' (' + (u.team || 'NEUTRAL').toUpperCase() + ')');
        if (rec) {
            const st = this.stateOf(rec);
            out.push((rec.mission ? MISSIONS[rec.mission.type].label + (rec.mission.target ? ' — ' + this.targetName(rec.mission.target) : '') : 'NO ORDERS') + (st ? ' · ' + st : ''));
        }
        if (u) {
            const bits = [];
            if (u.pilot) {
                const pl = u.pilot;
                bits.push('PILOT ' + String(pl.passive ? 'CRUISE' : pl.state || 'FLYING').toUpperCase());
                if (pl.target && pl.target.pos) bits.push('TARGET ' + nameOf(g, pl.target) + ' ' + (pl.target.pos.distanceTo(u.pos) / 1000).toFixed(1) + ' KM');
            } else if (u.support) {
                const f = u.support;
                bits.push(String(f.role || '').toUpperCase() + ' · ' + (f.task ? f.task.kind.toUpperCase() : 'IDLE'));
            } else if (u.fstate) bits.push(String(u.fstate).toUpperCase());
            else if (u.cls === 'infantry') bits.push(String(u.state).toUpperCase() + (u.target && u.target.pos ? ' · FIRING AT ' + nameOf(g, u.target) : ''));
            if (u.isShip && u.group) bits.push((u.group.threat > 0 ? 'THREAT · ' : '') + String(u.group.order || '').toUpperCase());
            const sp = u.vel ? Math.hypot(u.vel.x, u.vel.z) : 0;
            const hp = u.maxHealth ? u.health / u.maxHealth : u.maxHp ? u.hp / u.maxHp : null;
            if (!u.isGround || sp > 1) bits.push(Math.round(sp * 1.944) + ' KT');
            if (!u.isGround && !u.isShip) bits.push(Math.round(u.pos.y * 3.281).toLocaleString('en-US') + ' FT');
            if (hp != null) bits.push((u.alive ? Math.round(clamp(hp, 0, 1) * 100) + '%' : 'DESTROYED'));
            const r = war.rec(u);
            if (r && r.team !== war.side && r.team !== 'neutral') bits.push('INTEL: ' + ['UNKNOWN', 'CONTACT', 'IDENTIFIED', 'CONFIRMED'][r.known]);
            out.push(bits.join(' · '));
            if (u.incoming && u.incoming.length) out.push('MISSILE INBOUND ×' + u.incoming.length);
        }
        return out;
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.enabled) return;
        const g = this.game;
        for (const rec of this.placed) {
            const D = DRIVERS[rec.kind];
            if (D.update) { try { D.update(this, rec, dt); } catch (e) { if (!rec.err) { rec.err = true; console.warn('[sandbox] update', rec.item, e); } } }
        }
    }

    updateCamera(cam, dt, mouse) {
        if (!this.enabled || !this.spec.on) return false;
        const g = this.game;
        if (g.state !== 'playing' && g.state !== 'dead') return false;
        return this.spec.update(cam, dt, mouse);
    }

    // the player's controls while watching: the jet is held, the keys are the camera's
    onAction(a) {
        if (!this.enabled) return false;
        const g = this.game;
        if (!this.spec.on) return false;
        if (g.tacmap && g.tacmap.open) return false;
        switch (a) {
            case 'target': { const n = this.nextFollow(1); if (n) this.spec.follow(n); return true; }
            case 'weapon': { const n = this.nextFollow(-1); if (n) this.spec.follow(n); return true; }
            case 'camera': this.spec.cycleMode(); g.addFeed('VIEW: ' + this.spec.mode.toUpperCase(), DIM); return true;
            case 'flaps': this.spec.setMode(this.spec.mode === 'free' ? 'chase' : 'free'); g.addFeed('VIEW: ' + this.spec.mode.toUpperCase(), DIM); return true;
            case 'thr1': this.setSimSpeed(0); return true;
            case 'thr2': this.setSimSpeed(1); return true;
            case 'thr3': this.setSimSpeed(2); return true;
            case 'thr4': this.setSimSpeed(4); return true;
            case 'thr5': case 'thr6': case 'thr7': case 'thr8': case 'thr9': case 'thr10':
            case 'gear': case 'flares': case 'spoilers': case 'autoland': case 'autotakeoff': case 'eject': case 'missile':
            case 'loadout': case 'hook': case 'confirm': case 'missilecam': return this.spec.held ? true : false;
        }
        return false;
    }

    // keys of our own (the input's action table doesn't have them): BACKSPACE watch, PAGE UP / DOWN and HOME the clock; on the
    // map, Esc / Enter / Backspace / Delete for its tools
    bindInput() {
        if (typeof window === 'undefined' || !window.addEventListener) return;
        window.addEventListener('keydown', (e) => {
            const g = this.game;
            if (!this.enabled || g.state !== 'playing' || e.repeat) return;
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
            const map = g.tacmap;
            if (map && map.open) {
                if (e.code === 'Escape' && this.tool) { this.tool = null; this.say('TOOL CANCELLED', DIM); e.stopImmediatePropagation(); e.preventDefault(); return; }
                if (e.code === 'Enter' && this.tool && this.tool.kind === 'mission') { this.finishRoute(); e.preventDefault(); return; }
                if (e.code === 'Backspace' && this.tool && this.tool.pts && this.tool.pts.length) { this.tool.pts.pop(); e.preventDefault(); return; }
                if (e.code === 'Delete' && this.sel) { this.remove(this.sel); e.preventDefault(); return; }
                return;
            }
            if (g.pilotMode || g.sensorView || g.indoors || (g.command && g.command.open)) return;
            if (e.code === 'Backspace') { this.toggleSpectate(); e.preventDefault(); return; }
            if (e.code === 'PageUp') { this.stepSimSpeed(1); e.preventDefault(); return; }
            if (e.code === 'PageDown') { this.stepSimSpeed(-1); e.preventDefault(); return; }
            if (e.code === 'Home') { this.setSimSpeed((g.simSpeed ?? 1) === 0 ? 1 : 0); e.preventDefault(); }
        }, { capture: true });
    }
    bindMapMouse(map) {
        if (this._mapBound || !map || !map.canvas) return;
        this._mapBound = true;
        map.canvas.addEventListener('mousedown', (e) => {
            if (!this.enabled || e.button !== 2) return;
            if (this.tool && this.tool.kind === 'mission' && this.tool.pts && this.tool.pts.length) this.finishRoute();
            else if (this.tool) { this.tool = null; this.say('TOOL CANCELLED', DIM); }
        });
    }

    // ═════════════ The command menu (keyboard users) ═════════════
    commands() {
        if (!this.enabled) return [];
        const out = [], war = this.war;
        out.push({ path: ['SANDBOX', 'TOOLS'], label: this.spec.on ? 'STOP SPECTATING (⌫)' : 'SPECTATE (⌫ BACKSPACE)', hint: 'FOLLOW UNITS, FREE CAMERA', run: () => this.toggleSpectate() });
        for (const s of SIM_SPEEDS) out.push({ path: ['SANDBOX', 'TOOLS', 'SIM CLOCK'], label: s ? 'SIM ×' + s : 'PAUSE', enabled: (this.game.simSpeed ?? 1) !== s, keepOpen: true, run: () => this.setSimSpeed(s) });
        out.push({ path: ['SANDBOX', 'TOOLS'], label: 'FLY FOR ' + (war.side === 'blue' ? 'RED' : 'BLUE'), hint: 'SWAP SIDES', run: () => this.setFaction(war.side === 'blue' ? 'red' : 'blue') });
        out.push({ path: ['SANDBOX', 'TOOLS'], label: 'BACKGROUND WAR: ' + (this.background ? 'ON' : 'OFF'), enabled: war.side === 'blue', keepOpen: true, run: () => this.setBackground(!this.background) });
        for (const p of PRESETS) out.push({ path: ['SANDBOX', 'SCENARIOS'], label: p.label, hint: 'REPLACES WHAT YOU PLACED', run: () => this.loadPreset(p.id) });
        for (let i = 0; i < SLOTS; i++) {
            const s = this.store && this.store.slots[i];
            out.push({ path: ['SANDBOX', 'SCENARIOS', 'SAVE'], label: 'SAVE TO SLOT ' + (i + 1), hint: s ? 'OVERWRITES ' + s.name : 'EMPTY', run: () => this.saveSlot(i) });
            out.push({ path: ['SANDBOX', 'SCENARIOS', 'LOAD'], label: 'LOAD SLOT ' + (i + 1), hint: s ? s.name : 'EMPTY', enabled: !!s, run: () => this.loadSlot(i) });
        }
        out.push({ path: ['SANDBOX', 'TOOLS'], label: 'CLEAR EVERYTHING PLACED', hint: this.placed.length + ' PLACED', enabled: this.placed.length > 0, run: () => { this.removeAll(); this.say('CLEARED', DIM); } });
        return out;
    }

    // ═════════════ HUD ═════════════
    drawHud(ctx, hud) {
        if (!this.enabled) return;
        const g = this.game;
        if (this.tool && !(g.tacmap && g.tacmap.open)) this.tool = null; // (a map tool lives while the map is open)
        if (g.photo || g.hideHud || (g.tacmap && g.tacmap.open)) return;
        const W = hud.w;
        ctx.save();
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        const sp = g.simSpeed ?? 1;
        let y = 18;
        if (this.spec.on) {
            const lines = this.describe(this.spec.target);
            const keys = 'TAB/X NEXT/PREV · V VIEW: ' + this.spec.mode.toUpperCase() + ' · F FREE · 1–4 CLOCK · ⌫ BACK TO YOUR JET';
            ctx.font = '700 14px ' + FONT;
            let w = Math.max(...lines.map((l, i) => { ctx.font = (i ? '600 12px ' : '700 14px ') + FONT; return ctx.measureText(l).width; }), 300);
            ctx.font = '600 11px ' + FONT; w = Math.max(w, ctx.measureText(keys).width) + 28;
            const h = 20 + lines.length * 18 + 18;
            ctx.fillStyle = 'rgba(6,12,18,0.72)'; ctx.fillRect(W / 2 - w / 2, y, w, h);
            ctx.strokeStyle = 'rgba(111,180,255,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(W / 2 - w / 2 + 0.5, y + 0.5, w - 1, h - 1);
            let yy = y + 16;
            ctx.fillStyle = GREEN; ctx.font = '700 11px ' + FONT; ctx.textAlign = 'left';
            ctx.fillText('◉ SPECTATING', W / 2 - w / 2 + 10, yy); ctx.textAlign = 'center';
            lines.forEach((l, i) => { ctx.font = (i ? '600 12px ' : '700 14px ') + FONT; ctx.fillStyle = i ? '#cfe6ff' : TXT; ctx.fillText(l, W / 2, yy + (i ? 4 : 0)); yy += 18; });
            ctx.font = '600 11px ' + FONT; ctx.fillStyle = DIM; ctx.fillText(keys, W / 2, yy + 6);
            y += h + 6;
        }
        if (sp !== 1) {
            const txt = sp === 0 ? '❚❚ SIM PAUSED — HOME / 2 TO RESUME' : '▶▶ SIM ×' + sp;
            ctx.font = '700 13px ' + FONT;
            const w = ctx.measureText(txt).width + 20;
            ctx.fillStyle = 'rgba(6,12,18,0.72)'; ctx.fillRect(W / 2 - w / 2, y, w, 22);
            ctx.fillStyle = AMBER; ctx.fillText(txt, W / 2, y + 11);
        }
        ctx.restore();
    }

    // ═════════════ The map ═════════════
    teamColor(team) { return team === 'neutral' ? CIV : team === this.war.side ? OWN : FOE; }

    drawMap(ctx, map) {
        if (!this.enabled) return;
        this.bindMapMouse(map);
        ctx.save();
        ctx.textBaseline = 'middle';
        for (const rec of this.placed) this.drawRec(ctx, map, rec);
        this.drawTool(ctx, map);
        this.drawPanel(ctx, map);
        ctx.restore();
    }

    drawRec(ctx, map, rec) {
        const war = this.war, col = this.teamColor(rec.team);
        const alive = this.aliveOf(rec);
        const c = this.posOf(rec, _v);
        map.toScreen(c.x, c.z, P);
        const sel = this.sel === rec || (map.sel && map.sel.rec === rec);
        const hidden = rec.team !== war.side && rec.team !== 'neutral';
        ctx.globalAlpha = alive ? 1 : 0.45;
        // its units, where they are (the enemy's too: the sandbox is a god's view of what you placed)
        if (this.godView || !hidden) {
            ctx.fillStyle = col;
            let k = 0;
            for (const u of this.unitsOf(rec)) {
                if (k++ > 24) break;
                map.toScreen(u.pos.x, u.pos.z, Q);
                ctx.beginPath(); ctx.arc(Q.x, Q.y, 2.2, 0, Math.PI * 2); ctx.fill();
            }
            if (rec.kind === 'flight' && rec.handle && !rec.handle.members) map.planeGlyph(ctx, P.x, P.y, rec.handle, 6, col);
        }
        // the marker and the label
        ctx.strokeStyle = col; ctx.lineWidth = sel ? 2 : 1.2; ctx.setLineDash(sel ? [] : [4, 3]);
        ctx.beginPath(); ctx.arc(P.x, P.y, sel ? 15 : 12, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(P.x, P.y, 19, 0, Math.PI * 2); ctx.stroke(); }
        if (map.layers.labels || sel) {
            ctx.font = (sel ? '700 11px ' : '600 10px ') + FONT; ctx.textAlign = 'left'; ctx.fillStyle = col;
            ctx.fillText(rec.label + (alive ? '' : ' — DESTROYED') + (rec.mission ? ' · ' + MISSIONS[rec.mission.type].label : ''), P.x + 17, P.y - 9);
        }
        ctx.globalAlpha = 1;
        // its orders
        const m = rec.mission;
        if (!m || !alive) return;
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.3;
        if (m.type === 'patrol' && m.route) {
            ctx.setLineDash([7, 5]); ctx.beginPath();
            m.route.forEach((q, i) => { map.toScreen(q.x, q.z, Q); if (i) ctx.lineTo(Q.x, Q.y); else ctx.moveTo(Q.x, Q.y); });
            if (m.route.length > 2 || ['flight', 'naval', 'heli', 'armour', 'infantry', 'forces'].includes(rec.kind)) ctx.closePath();
            ctx.stroke(); ctx.setLineDash([]);
            m.route.forEach((q, i) => { map.toScreen(q.x, q.z, Q); ctx.fillRect(Q.x - 3, Q.y - 3, 6, 6); ctx.font = '600 9px ' + FONT; ctx.fillText(String(i + 1), Q.x + 5, Q.y - 6); });
        } else if (m.type === 'cap' || m.type === 'recon' || m.type === 'move' || m.type === 'sead') {
            map.toScreen(m.at.x, m.at.z, Q);
            ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke(); ctx.setLineDash([]);
            const R = m.type === 'cap' ? (rec.item === 'bomber' ? 9000 : 6000) : m.type === 'recon' ? 3500 : m.type === 'sead' ? 9000 : 0;
            if (R) { ctx.beginPath(); ctx.arc(Q.x, Q.y, Math.max(6, R * map.scale), 0, Math.PI * 2); ctx.stroke(); }
            else { ctx.beginPath(); ctx.arc(Q.x, Q.y, 4, 0, Math.PI * 2); ctx.fill(); }
        } else if ((m.type === 'strike' || m.type === 'escort') && (m.target || m.at)) {
            const tp = m.target ? (m.target.unit ? m.target.unit.pos : m.target.rec ? this.posOf(m.target.rec, _v2) : null) : null;
            const t = tp || m.at;
            if (!t) return;
            map.toScreen(t.x, t.z, Q);
            ctx.strokeStyle = m.type === 'strike' ? AMBER : col; ctx.setLineDash(m.type === 'strike' ? [9, 5] : [2, 4]);
            ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke(); ctx.setLineDash([]);
            if (m.type === 'strike') { ctx.beginPath(); ctx.moveTo(Q.x - 7, Q.y - 7); ctx.lineTo(Q.x + 7, Q.y + 7); ctx.moveTo(Q.x + 7, Q.y - 7); ctx.lineTo(Q.x - 7, Q.y + 7); ctx.stroke(); }
        }
    }

    // the tool in progress: the ghost of what's being placed (green: fits, red: why not), a route being drawn
    drawTool(ctx, map) {
        const T = this.tool, m = map.mouse;
        if (!T) return;
        const w = m ? map.toWorld(m.x, m.y) : null;
        if (T.kind === 'place' || T.kind === 'dest') {
            if (!w) return;
            let ok = true, why = '';
            if (T.kind === 'place') { const v = validatePlacement(T.item, w.x, w.z, this.env, { alt: T.alt }); ok = v.ok; why = v.why; }
            else {
                map.toScreen(T.from.x, T.from.z, Q);
                ctx.strokeStyle = this.teamColor(T.team); ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(Q.x, Q.y); ctx.lineTo(m.x, m.y); ctx.stroke(); ctx.setLineDash([]);
            }
            ctx.strokeStyle = ok ? GREEN : FOE; ctx.fillStyle = ok ? 'rgba(93,255,160,0.18)' : 'rgba(255,90,74,0.18)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(m.x, m.y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            if (!ok) { ctx.beginPath(); ctx.moveTo(m.x - 7, m.y - 7); ctx.lineTo(m.x + 7, m.y + 7); ctx.moveTo(m.x + 7, m.y - 7); ctx.lineTo(m.x - 7, m.y + 7); ctx.stroke(); }
            ctx.font = '700 11px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = ok ? GREEN : FOE;
            const label = T.kind === 'dest' ? 'CONVOY DESTINATION' : (ITEMS[T.item].label + (ITEMS[T.item].domain === 'air' ? ' · ' + Math.round(T.alt * 3.281).toLocaleString('en-US') + ' FT' : ''));
            ctx.fillText(ok ? label : why, m.x + 18, m.y - 2);
            return;
        }
        if (T.kind === 'mission') {
            const col = GREEN;
            ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash([6, 4]);
            ctx.beginPath();
            const from = this.posOf(T.rec, _v);
            map.toScreen(from.x, from.z, Q); ctx.moveTo(Q.x, Q.y);
            for (const q of T.pts || []) { map.toScreen(q.x, q.z, Q); ctx.lineTo(Q.x, Q.y); }
            if (m) ctx.lineTo(m.x, m.y);
            ctx.stroke(); ctx.setLineDash([]);
            for (const q of T.pts || []) { map.toScreen(q.x, q.z, Q); ctx.fillRect(Q.x - 3.5, Q.y - 3.5, 7, 7); }
            if (m) { ctx.font = '700 11px ' + FONT; ctx.textAlign = 'left'; ctx.fillText(MISSIONS[T.type].label + (T.pts ? ' · ' + T.pts.length + ' POINTS' : ''), m.x + 14, m.y - 10); }
        }
    }

    // ── clicks on the map while a tool is armed (tacmap.js asks before it selects anything) ──
    mapClick(x, y, map) {
        if (!this.enabled || !this.tool) return false;
        const T = this.tool, w = map.toWorld(x, y);
        if (T.kind === 'place') {
            const I = ITEMS[T.item];
            if (I.domain === 'road') {
                const v = validatePlacement(T.item, w.x, w.z, this.env);
                if (!v.ok) { this.say(v.why, AMBER); return true; }
                this.tool = { ...T, kind: 'dest', from: { x: w.x, z: w.z } };
                this.say('CONVOY: NOW CLICK WHERE IT GOES', DIM);
                return true;
            }
            const rec = this.place(T.item, T.team, w.x, w.z, { variant: T.variant, n: T.n, alt: T.alt });
            if (!rec) this.say(this.why || 'CAN\'T PLACE THAT THERE', AMBER);
            else { this.sel = rec; map.sel = { kind: 'sbx', rec }; }
            return true;
        }
        if (T.kind === 'dest') {
            const rec = this.place(T.item, T.team, T.from.x, T.from.z, { variant: T.variant, to: { x: w.x, z: w.z } });
            if (!rec) this.say(this.why || 'NO ROAD BETWEEN THOSE POINTS', AMBER);
            else { this.sel = rec; map.sel = { kind: 'sbx', rec }; }
            this.tool = { ...T, kind: 'place' };
            return true;
        }
        if (T.kind === 'mission') {
            const input = MISSIONS[T.type].input;
            if (input === 'route') { T.pts.push({ x: w.x, z: w.z }); return true; }
            if (input === 'point') { this.tool = null; this.assign(T.rec, { type: T.type, at: { x: w.x, z: w.z } }); return true; }
            const tgt = this.pickTarget(x, y, map);
            if (input === 'unit' && !tgt) { this.say('CLICK A UNIT TO ESCORT', AMBER); return true; }
            this.tool = null;
            this.assign(T.rec, { type: T.type, target: tgt, at: tgt ? null : { x: w.x, z: w.z } });
            return true;
        }
        return false;
    }
    finishRoute() {
        const T = this.tool;
        if (!T || T.kind !== 'mission') return;
        this.tool = null;
        if (!T.pts || !T.pts.length) return;
        if (T.pts.length === 1 && T.type === 'patrol') { this.assign(T.rec, { type: missionsFor(T.rec.item).includes('move') ? 'move' : 'cap', at: T.pts[0] }); return; }
        this.assign(T.rec, { type: T.type, route: T.pts });
    }
    startMission(rec, type) {
        const M = MISSIONS[type];
        if (!M.input) { this.assign(rec, { type }); return; }
        this.tool = { kind: 'mission', rec, type, pts: M.input === 'route' ? [] : null };
        this.say(M.label + ': ' + M.hint, DIM);
    }

    // a record's marker (or one of its units) near the cursor
    pickRec(x, y, map, R = 16) {
        let best = null, bd = R * R;
        for (const r of this.placed) {
            const c = this.posOf(r, _v);
            map.toScreen(c.x, c.z, P);
            const d = (P.x - x) ** 2 + (P.y - y) ** 2;
            if (d < bd) { bd = d; best = r; }
        }
        return best;
    }
    pickTarget(x, y, map) {
        const hit = map.pick(x, y);
        if (hit && hit.kind === 'unit') { const r = this.recOfUnit(hit.unit); return r ? { rec: r, unit: hit.unit } : { unit: hit.unit }; }
        if (hit && hit.kind === 'sbx') return { rec: hit.rec };
        if (hit && hit.kind === 'mark' && hit.mark.unit) return { unit: hit.mark.unit };
        const r = this.pickRec(x, y, map, 34); // (a generous reach: what's picked flies on while you aim)
        return r ? { rec: r } : null;
    }
    mapPick(x, y, map) {
        if (!this.enabled) return null;
        const r = this.pickRec(x, y, map);
        return r ? { kind: 'sbx', rec: r } : null;
    }

    // what the selection panel shows about a placed unit, and what can be done with it (and FOLLOW on anything)
    mapInfo(sel) {
        if (!this.enabled || !sel) return [];
        const rec = sel.kind === 'sbx' ? sel.rec : sel.kind === 'unit' ? this.recOfUnit(sel.unit) : null;
        if (!rec) return [];
        if (sel.kind === 'sbx') this.sel = rec;
        const out = [];
        if (sel.kind === 'sbx') {
            out.push({ text: rec.label, color: this.teamColor(rec.team), font: '700 15px' });
            const c = this.posOf(rec, _v);
            out.push({ text: 'GRID ' + this.war.grid(c.x, c.z) + (ITEMS[rec.item].domain === 'air' ? ' · ' + Math.round(c.y * 3.281).toLocaleString('en-US') + ' FT' : '') });
        } else out.push({ text: 'SANDBOX: ' + rec.label, color: GREEN });
        out.push({ text: this.aliveOf(rec) ? this.stateOf(rec) : 'DESTROYED', color: '#9fd4ff' });
        out.push({ text: rec.mission ? 'ORDERS: ' + MISSIONS[rec.mission.type].label + (rec.mission.target ? ' — ' + this.targetName(rec.mission.target) : '') : 'NO ORDERS', color: rec.mission ? GREEN : DIM });
        return out;
    }
    mapActions(sel) {
        if (!this.enabled || !sel) return [];
        const acts = [], g = this.game, war = this.war;
        const rec = sel.kind === 'sbx' ? sel.rec : sel.kind === 'unit' ? this.recOfUnit(sel.unit) : null;
        if (rec) {
            if (this.aliveOf(rec)) {
                acts.push({ label: '◉ FOLLOW WITH THE CAMERA', run: () => { g.tacmap.close(); this.spectate({ rec }); } });
                for (const k of missionsFor(rec.item)) acts.push({ label: '▸ ' + MISSIONS[k].label, run: () => this.startMission(rec, k) });
            }
            acts.push({ label: '✕ DELETE', run: () => { this.remove(rec); this.say('DELETED ' + rec.label, DIM); } });
            return acts;
        }
        if (sel.kind === 'unit' && sel.unit.alive) acts.push({ label: '◉ FOLLOW WITH THE CAMERA', run: () => { g.tacmap.close(); this.spectate({ unit: sel.unit }); } });
        if (sel.kind === 'point') acts.push({ label: '◉ FREE CAMERA HERE', run: () => { g.tacmap.close(); this.spec.start(); this.spec.target = null; this.spec.setMode('free'); this.spec.free.pos.set(sel.pos.x, Math.max(terrainHeight(sel.pos.x, sel.pos.z), 0) + 600, sel.pos.z + 900); this.spec.free.pitch = -0.5; this.spec.free.yaw = 0; } });
        // the other side's strike on this (a unit of ours, or a point): the sandbox can order either side's missiles
        if ((sel.kind === 'unit' && sel.unit.alive) || sel.kind === 'point' || sel.kind === 'mark') {
            const foe = war.enemyTeam;
            for (const [key, label] of [['ballistic', 'BALLISTIC'], ['cruise', 'CRUISE'], ['rocket', 'ROCKETS']]) {
                if (!STRIKE_TYPES[key]) continue;
                acts.push({ label: foe.toUpperCase() + ' STRIKE HERE: ' + label, run: () => this.enemyStrike(sel, key) });
            }
        }
        return acts;
    }
    enemyStrike(sel, key) {
        const g = this.game, war = this.war;
        if (!g.strikes) return;
        const tgt = sel.kind === 'unit' ? sel.unit : sel.kind === 'mark' ? (sel.mark.unit || sel.mark.fixed || sel.mark.pos) : sel.pos;
        const pos = tgt.pos || tgt;
        const mark = { id: 0, unit: tgt.alive !== undefined ? tgt : null, pos: new THREE.Vector3(pos.x, pos.y || groundHeight(pos.x, pos.z), pos.z), fixed: tgt.alive !== undefined ? null : new THREE.Vector3(pos.x, groundHeight(pos.x, pos.z), pos.z), label: tgt.alive !== undefined ? nameOf(g, tgt) : 'GRID ' + war.grid(pos.x, pos.z), transmitted: true };
        const st = g.strikes.request(key, [mark], war.enemyTeam);
        this.say(war.enemyTeam.toUpperCase() + ' ' + key.toUpperCase() + ' STRIKE ' + (st ? 'ORDERED' : '— NO LAUNCHER IN RANGE'), st ? AMBER : DIM);
    }

    // ═════════════ The panel ═════════════
    btn(ctx, map, label, x, y, w, on, run, opts = {}) {
        const m = map.mouse, en = opts.enabled !== false;
        const hov = en && m && m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + 22;
        const col = opts.color || '111,180,255';
        ctx.fillStyle = on ? 'rgba(' + col + ',0.45)' : hov ? 'rgba(' + col + ',0.28)' : 'rgba(' + col + ',0.12)';
        ctx.fillRect(x, y, w, 22);
        ctx.strokeStyle = on ? 'rgba(' + col + ',0.95)' : 'rgba(' + col + ',0.35)'; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 21);
        ctx.font = (on ? '700 ' : '600 ') + '11px ' + FONT; ctx.textAlign = 'center';
        ctx.fillStyle = en ? (on ? '#fff' : '#cfe6ff') : 'rgba(207,230,255,0.3)';
        ctx.fillText(label, x + w / 2, y + 11.5, w - 6);
        map.buttons.push({ x, y, w, h: 22, run, enabled: en, label });
    }
    row(ctx, map, x, y, W, items) {
        const gap = 4, n = items.length, w = (W - gap * (n - 1)) / n;
        items.forEach((it, i) => this.btn(ctx, map, it.label, x + i * (w + gap), y, w, it.on, it.run, it));
    }
    heading(ctx, x, y, text) { ctx.font = '700 10px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = '#7fa6c8'; ctx.fillText(text, x, y + 7); }

    drawPanel(ctx, map) {
        const g = this.game, pal = this.pal;
        const tk = g.tasks && g.tasks.enabled ? 30 + Math.max(1, (g.tasks.active ? 1 : 0) + g.tasks.offered.length) * 36 + 24 : 76;
        const x = 16, W = 318;
        let y = Math.max(76, tk);
        if (!pal.open) { this.btn(ctx, map, 'SANDBOX ▸', x, y, 110, false, () => { pal.open = true; }); return; }
        const bottom = map.h - 86;
        const top = y;
        // the frame (drawn first, its height known at the end: a reserved box)
        ctx.fillStyle = 'rgba(6,12,18,0.86)';
        ctx.fillRect(x, top, W, Math.max(60, bottom - top));
        ctx.strokeStyle = 'rgba(93,255,160,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, top + 0.5, W - 1, Math.max(60, bottom - top) - 1);
        const ix = x + 10, IW = W - 20;
        y += 8;
        ctx.font = '700 13px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = GREEN;
        ctx.fillText('SANDBOX', ix, y + 10);
        ctx.font = '600 11px ' + FONT; ctx.fillStyle = this.war.side === 'blue' ? OWN : FOE;
        ctx.fillText('FLYING FOR ' + this.war.side.toUpperCase(), ix + 76, y + 10);
        this.btn(ctx, map, '◂', x + W - 34, y, 24, false, () => { pal.open = false; this.tool = null; });
        y += 28;
        this.row(ctx, map, ix, y, IW, TABS.map(([k, l]) => ({ label: l, on: pal.tab === k, run: () => { pal.tab = k; if (k !== 'spawn' && this.tool && this.tool.kind !== 'mission') this.tool = null; } })));
        y += 30;
        const lim = bottom - 30;
        switch (pal.tab) {
            case 'spawn': y = this.tabSpawn(ctx, map, ix, y, IW, lim); break;
            case 'units': y = this.tabUnits(ctx, map, ix, y, IW, lim); break;
            case 'war': y = this.tabWar(ctx, map, ix, y, IW, lim); break;
            case 'watch': y = this.tabWatch(ctx, map, ix, y, IW, lim); break;
            case 'file': y = this.tabFile(ctx, map, ix, y, IW, lim); break;
        }
        // the status line: the last message, or what the tool wants
        const T = this.tool;
        let text = null, col = DIM;
        if (this.msg && g.time - this.msg.t < 6) { text = this.msg.text; col = this.msg.color; }
        else if (T && T.kind === 'place') text = 'CLICK THE MAP TO PLACE · RIGHT-CLICK: STOP';
        else if (T && T.kind === 'mission') text = MISSIONS[T.type].hint;
        if (text) {
            ctx.font = '600 11px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = col;
            wrap(ctx, text, ix, bottom - 22, IW, 13, 2);
        }
        void y;
    }

    tabSpawn(ctx, map, x, y, W, lim) {
        const pal = this.pal, war = this.war;
        this.row(ctx, map, x, y, W, CATEGORIES.map(([k, l]) => ({ label: l, on: pal.cat === k, run: () => { pal.cat = k; const first = itemsIn(k)[0]; this.pick(first); } })));
        y += 28;
        const items = itemsIn(pal.cat);
        const cw = (W - 4) / 2;
        items.forEach((k, i) => {
            const cx = x + (i % 2) * (cw + 4), cy = y + Math.floor(i / 2) * 26;
            this.btn(ctx, map, ITEMS[k].label, cx, cy, cw, pal.item === k, () => this.pick(k));
        });
        y += Math.ceil(items.length / 2) * 26 + 6;
        const I = ITEMS[pal.item];
        this.heading(ctx, x, y, 'SIDE'); y += 14;
        const sides = [['blue', 'BLUE'], ['red', 'RED'], ['neutral', 'CIVIL']];
        this.row(ctx, map, x, y, W, sides.map(([t, l]) => ({ label: l, on: pal.team === t, enabled: I.teams.includes(t) && (!I.ownSide || t === war.side), run: () => { pal.team = t; pal.variant = 0; this.arm(); }, color: t === 'red' ? '255,90,74' : t === 'neutral' ? '207,216,224' : '111,180,255' })));
        y += 28;
        const V = I.variants && I.variants[pal.team];
        if (V && V.length > 1) {
            this.heading(ctx, x, y, 'TYPE'); y += 14;
            const per = Math.min(V.length, 4);
            for (let r = 0; r < Math.ceil(V.length / per); r++) {
                this.row(ctx, map, x, y, W, V.slice(r * per, r * per + per).map((v, j) => ({ label: VARIANT_NAMES[v] || v, on: pal.variant === r * per + j, run: () => { pal.variant = r * per + j; this.arm(); } })));
                y += 26;
            }
            y += 2;
        }
        if (I.count) {
            this.heading(ctx, x, y, pal.item === 'armour' ? 'TANKS' : pal.item === 'infantry' ? 'SOLDIERS' : 'AIRCRAFT'); y += 14;
            this.row(ctx, map, x, y, W, I.count.map(n => ({ label: String(n), on: pal.n === n, run: () => { pal.n = n; this.arm(); } })));
            y += 28;
        }
        if (I.domain === 'air') {
            const A = pal.item === 'heli' ? ALTS.heli : ALTS.air;
            this.heading(ctx, x, y, pal.item === 'heli' ? 'HEIGHT ABOVE GROUND' : 'ALTITUDE'); y += 14;
            this.row(ctx, map, x, y, W, A.map(a => ({ label: a < 1000 ? Math.round(a * 3.281 / 100) * 100 + ' FT' : Math.round(a * 3.281 / 1000) + 'K FT', on: pal.alt === a, run: () => { pal.alt = a; this.arm(); } })));
            y += 28;
        }
        const armed = this.tool && this.tool.kind !== 'mission';
        this.btn(ctx, map, armed ? '■ STOP PLACING' : '▶ PLACE ON THE MAP', x, y, W, armed, () => { if (armed) this.tool = null; else this.arm(); }, { color: '93,255,160' });
        y += 28;
        ctx.font = '600 10px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = DIM;
        const where = { air: 'ANYWHERE, AT THE ALTITUDE CHOSEN', water: 'ON OPEN WATER', land: 'ON FIRM, LEVEL LAND (NOT RUNWAYS OR TOWNS)', coast: 'ON LAND WITHIN 3.5 KM OF THE SEA', road: 'CLICK THE START, THEN THE DESTINATION' }[I.domain];
        if (y < lim) wrap(ctx, where, x, y + 6, W, 12, 2);
        void war;
        return y;
    }
    pick(k) {
        const pal = this.pal, I = ITEMS[k];
        pal.item = k; pal.variant = 0;
        if (!I.teams.includes(pal.team) || (I.ownSide && pal.team !== this.war.side)) pal.team = I.teams.includes(this.war.side) ? this.war.side : I.teams[0];
        pal.n = I.n || 1;
        pal.alt = I.domain === 'air' ? (k === 'heli' ? 120 : I.alt >= 8000 ? 9000 : I.alt <= 2500 ? 1500 : 5000) : 0;
        this.arm();
    }
    arm() {
        const pal = this.pal;
        const I = ITEMS[pal.item];
        if (!I.teams.includes(pal.team) || (I.ownSide && pal.team !== this.war.side)) return;
        this.tool = { kind: 'place', item: pal.item, team: pal.team, variant: pal.variant, n: pal.n, alt: pal.item === 'heli' ? pal.alt : pal.alt || I.alt };
    }

    tabUnits(ctx, map, x, y, W, lim) {
        const pal = this.pal, list = this.placed;
        if (!list.length) { ctx.font = '600 11px ' + FONT; ctx.fillStyle = DIM; ctx.textAlign = 'left'; ctx.fillText('NOTHING PLACED YET — SPAWN OR LOAD A SCENARIO', x, y + 8); return y + 20; }
        const rows = Math.max(3, Math.floor((lim - y - 70) / 34));
        pal.scroll = clamp(pal.scroll, 0, Math.max(0, list.length - rows));
        for (let i = pal.scroll; i < Math.min(list.length, pal.scroll + rows); i++) {
            const rec = list[i], alive = this.aliveOf(rec), sel = this.sel === rec;
            const m = map.mouse, hov = m && m.x >= x && m.x <= x + W && m.y >= y && m.y <= y + 30;
            ctx.fillStyle = sel ? 'rgba(93,255,160,0.18)' : hov ? 'rgba(111,180,255,0.16)' : 'rgba(111,180,255,0.06)';
            ctx.fillRect(x, y, W, 30);
            ctx.fillStyle = this.teamColor(rec.team); ctx.fillRect(x, y, 3, 30);
            ctx.textAlign = 'left'; ctx.font = '700 11px ' + FONT; ctx.fillStyle = alive ? TXT : DIM;
            ctx.fillText(rec.label + (alive ? '' : ' ✕'), x + 8, y + 9, W - 12);
            ctx.font = '600 10px ' + FONT; ctx.fillStyle = DIM;
            ctx.fillText((rec.mission ? MISSIONS[rec.mission.type].label + ' · ' : '') + (alive ? this.stateOf(rec) : 'DESTROYED'), x + 8, y + 22, W - 12);
            map.buttons.push({ x, y, w: W, h: 30, run: () => { this.sel = rec; map.sel = { kind: 'sbx', rec }; const c = this.posOf(rec, _v); map.view.cx = c.x; map.view.cz = c.z; } });
            y += 34;
        }
        if (list.length > rows) {
            this.row(ctx, map, x, y, W, [
                { label: '▲', run: () => { pal.scroll = Math.max(0, pal.scroll - rows + 1); }, enabled: pal.scroll > 0 },
                { label: (pal.scroll + 1) + '–' + Math.min(list.length, pal.scroll + rows) + ' OF ' + list.length, run: () => {} },
                { label: '▼', run: () => { pal.scroll += rows - 1; }, enabled: pal.scroll + rows < list.length },
            ]);
            y += 28;
        }
        ctx.font = '600 10px ' + FONT; ctx.fillStyle = DIM; ctx.textAlign = 'left';
        ctx.fillText('SELECT ONE: ITS ORDERS ARE IN THE PANEL ON THE RIGHT', x, y + 6); y += 16;
        this.row(ctx, map, x, y, W, [
            { label: 'DELETE SELECTED', enabled: !!this.sel, run: () => { if (this.sel) { this.say('DELETED ' + this.sel.label, DIM); this.remove(this.sel); } } },
            { label: 'CLEAR ALL', enabled: list.length > 0, run: () => { this.removeAll(); this.say('CLEARED', DIM); }, color: '255,90,74' },
        ]);
        return y + 28;
    }

    tabWar(ctx, map, x, y, W, lim) {
        const g = this.game, war = this.war, Wx = g.weather;
        this.heading(ctx, x, y, 'YOU FLY FOR'); y += 14;
        this.row(ctx, map, x, y, W, [
            { label: 'BLUE', on: war.side === 'blue', run: () => this.setFaction('blue') },
            { label: 'RED', on: war.side === 'red', run: () => this.setFaction('red'), color: '255,90,74' },
        ]);
        y += 28;
        this.row(ctx, map, x, y, W, [
            { label: 'BACKGROUND WAR ' + (this.background ? 'ON' : 'OFF'), on: this.background, enabled: war.side === 'blue', run: () => this.setBackground(!this.background) },
            { label: 'SHOW ALL PLACED ' + (this.godView ? 'ON' : 'OFF'), on: this.godView, run: () => { this.godView = !this.godView; } },
        ]);
        y += 30;
        if (!Wx || !Wx.wx) return y;
        this.heading(ctx, x, y, 'WEATHER · NOW ' + (WX_LABEL[Wx.kind] || Wx.kind.toUpperCase())); y += 14;
        this.row(ctx, map, x, y, W, WEATHERS.slice(0, 3).map(k => ({ label: WX_LABEL[k], on: Wx.kind === k, run: () => this.setWeather(k) }))); y += 26;
        this.row(ctx, map, x, y, W, WEATHERS.slice(3).map(k => ({ label: WX_LABEL[k], on: Wx.kind === k, run: () => this.setWeather(k) }))); y += 26;
        this.row(ctx, map, x, y, W, [
            { label: this.wxBlend ? 'CHANGE OVER 2 MIN' : 'CHANGE AT ONCE', on: this.wxBlend, run: () => { this.wxBlend = !this.wxBlend; } },
            { label: 'STORM FRONT', run: () => Wx.front('storm', { eta: 300 }) },
            { label: 'CLEARING FRONT', run: () => Wx.front('clear', { eta: 300 }) },
        ]);
        y += 30;
        const h = Wx.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
        this.heading(ctx, x, y, 'TIME · ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ' LOCAL'); y += 14;
        this.row(ctx, map, x, y, W, TIMES.map(([k, l]) => ({ label: l, run: () => Wx.setTime(k) }))); y += 26;
        this.row(ctx, map, x, y, W, CLOCKS.map(s => ({ label: s ? '×' + s : 'STOP', on: Wx.timeScale === s, run: () => { Wx.timeScale = s; } })));
        y += 26;
        ctx.font = '600 10px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = DIM;
        if (y + 12 < lim) ctx.fillText('THE SKY CLOCK (THE SIM CLOCK IS ON WATCH)', x, y + 8);
        return y + 16;
    }

    tabWatch(ctx, map, x, y, W, lim) {
        const S = this.spec, g = this.game;
        this.row(ctx, map, x, y, W, [
            { label: S.on ? '■ STOP WATCHING (⌫)' : '◉ SPECTATE (⌫)', on: S.on, run: () => { if (S.on) S.stop(); else { g.tacmap.close(); this.spectate(); } }, color: '93,255,160' },
        ]);
        y += 28;
        this.row(ctx, map, x, y, W, [
            { label: 'FOLLOW SELECTED', enabled: !!this.sel, run: () => { g.tacmap.close(); this.spectate({ rec: this.sel }); } },
            { label: '◂ PREV', run: () => { const n = this.nextFollow(-1); if (n) { this.spec.follow(n); if (!S.on) this.spectate(n); } } },
            { label: 'NEXT ▸', run: () => { const n = this.nextFollow(1); if (n) { this.spec.follow(n); if (!S.on) this.spectate(n); } } },
        ]);
        y += 30;
        this.heading(ctx, x, y, 'VIEW'); y += 14;
        this.row(ctx, map, x, y, W, VIEW_MODES.map(m => ({ label: m.toUpperCase(), on: S.mode === m, run: () => S.setMode(m) })));
        y += 30;
        this.heading(ctx, x, y, 'SIM CLOCK (1–4 WHILE WATCHING · PAGE UP / DOWN · HOME)'); y += 14;
        const sp = g.simSpeed ?? 1;
        this.row(ctx, map, x, y, W, SIM_SPEEDS.map(s => ({ label: s ? '×' + s : '❚❚ PAUSE', on: sp === s, run: () => this.setSimSpeed(s), color: s === 1 ? '111,180,255' : '255,194,63' })));
        y += 30;
        this.row(ctx, map, x, y, W, [
            { label: 'HOLD MY JET WHILE WATCHING: ' + (this.holdJet ? 'ON' : 'OFF'), on: this.holdJet, run: () => { this.holdJet = !this.holdJet; S.setHold(this.holdJet); } },
        ]);
        y += 30;
        ctx.font = '600 10px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = DIM;
        const help = 'WATCHING: TAB / X NEXT / PREVIOUS · V VIEW · F FREE CAMERA (W/S/A/D, Q/E, SHIFT, MOUSE) · WHEEL ZOOM · ⌫ (BACKSPACE) STOP. YOUR JET WAITS, INVULNERABLE AND IGNORED, UNTIL YOU COME BACK. ×2 AND ×4 COST 2–4× THE SIMULATION TIME A FRAME.';
        if (y < lim) wrap(ctx, help, x, y + 6, W, 12, Math.max(1, Math.floor((lim - y) / 12)));
        return y;
    }

    tabFile(ctx, map, x, y, W, lim) {
        this.heading(ctx, x, y, 'SCENARIOS (REPLACE WHAT YOU PLACED)'); y += 14;
        for (const p of PRESETS) {
            this.btn(ctx, map, p.label, x, y, W, false, () => this.loadPreset(p.id), { color: '255,194,63' });
            y += 26;
        }
        y += 6;
        this.heading(ctx, x, y, 'SAVED SETUPS'); y += 14;
        const st = this.store || (this.store = readStore(this.storage));
        for (let i = 0; i < SLOTS; i++) {
            const s = st.slots[i];
            ctx.font = '600 10px ' + FONT; ctx.textAlign = 'left'; ctx.fillStyle = s ? TXT : DIM;
            ctx.fillText(s ? s.name : 'SLOT ' + (i + 1) + ' — EMPTY', x, y + 6, W);
            y += 14;
            this.row(ctx, map, x, y, W, [
                { label: 'SAVE', run: () => this.saveSlot(i), color: '93,255,160' },
                { label: 'LOAD', enabled: !!s, run: () => this.loadSlot(i) },
                { label: 'CLEAR', enabled: !!s, run: () => this.clearSlot(i), color: '255,90,74' },
            ]);
            y += 28;
            if (y > lim) break;
        }
        return y;
    }
}

// a line of text wrapped onto at most `max` lines
function wrap(ctx, text, x, y, W, lh, max = 3) {
    const words = String(text).split(' ');
    let line = '', n = 0;
    for (const w of words) {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > W && line) {
            ctx.fillText(line, x, y); y += lh; line = w;
            if (++n >= max - 1) { const rest = words.slice(words.indexOf(w)).join(' '); ctx.fillText(rest, x, y, W); return; }
        } else line = t;
    }
    if (line) ctx.fillText(line, x, y, W);
}
void INTEL;

// ═══════════════════════════════════════════════════════════════
// Airbases that feel alive (docs/WAR.md, "Airbases"): a plug-in system (systems.js, game.bases).
//  • alert states per field — NORMAL → ALERT → ATTACK → DAMAGED — from what happens: hostile aircraft or missiles
//    detected coming (their own radars for the enemy field: kill the radars and you get close unseen), bombs and
//    missiles landing, installations destroyed. The air-raid siren and the tower on the radio; AAA and SAM crews
//    to readiness (the S-300s erect); vehicles run for the dispersal points; at night the field blacks out under
//    attack and the searchlights sweep the sky (and cone a raider over the field)
//  • installations with real functions, registered in the war layer (cls runway, taxiway, tower, radar, shelter,
//    fuel, ammo, power) so the map, the pod, strikes and tasks all see them:
//      runway — bombs and the RUNWAY ATTACK strike dig real craters in it (runwaycraters.js); closed when there's no
//        clear 1200 × 15 m strip left: aircraft won't use it (scrambles stop, air traffic holds), a jet rolling into
//        a crater is wrecked, its lights go off and yellow crosses go down. Repair crews fill the craters over a few
//        minutes each. taxiways — craters close taxi routes (a shelter behind one can't launch)
//      tower — gone: no ATC calls, slower scrambles. radar — gone or unpowered: the war's radar coverage loses it
//      (no GCI from the enemy field). shelters — the jets inside; doors open for a scramble; destroyed with it.
//      fuel — fires, secondary explosions, and fewer sorties. ammunition — cooks off for minutes.
//      power — runway lights and radar go dark
//    Damage stays for the whole war session; only the repair crews put anything back
//  • life: ground crews, tugs, fuel trucks and follow-me cars about their work, jets taxiing, alert pairs on five
//    minutes' notice that really scramble (horn, pilots running, doors, taxi, afterburner takeoff) when the player's
//    near enough to see it — the director's GCI scrambles come through scramble() below
//  • tasks and radio: our cratered runway (cover the repair crews), crater theirs before the scramble, their field
//    at alert, their repair crews
// Director API: bases.scramble(from, opts), bases.launchStatus(base), bases.raidAim(base), bases.fieldAt(pos).
// Events: 'baseAlert' (field, { from, to }), 'runwayClosed' / 'runwayOpened' (field, { rw }), 'baseDamage'
// (field, { what, unit }), 'baseScramble' (field, { scramble }).
// ═══════════════════════════════════════════════════════════════
import * as THREE from 'three';
import { BASES, baseToWorld, worldToBase, terrainHeight, runwayNumbers, fenceOf } from './world.js';
import { baseLayout, fromRunway } from './baselayout.js';
import { AlertFSM, ALERT, ALERT_NAMES, CraterField, RepairCrews, TaxiGraph, Airwing, scrambleTimeline, MOS_LENGTH, REPAIR } from './basestate.js';
import { INTEL } from './war.js';
import { clamp, rand, pick } from './util.js';
import { BaseSounds } from './basesound.js';
import { PavementCraters } from './runwaycraters.js';
import { FieldStructures } from './basestructures.js';
import { FieldLife } from './baselife.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const TYPES = { blue: { qra: ['f16', 'f16'], has: ['f15', 'f16', 'f15'] }, red: { qra: ['mig29', 'mig29'], has: ['su35', 'mig29', 'su35'] } };
const COL = { NORMAL: '#9fd4ff', ALERT: '#ffd24a', ATTACK: '#ff4a3d', DAMAGED: '#ff9f5a' };
const clock = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// ═════════════ Installations (units in the war layer) ═════════════
// Common: pos, team, alive, name, radius, hitRadius, cls, hardened, isGround, damage(); the ground targets among
// them (shelters, igloos, the power plant) also have hitTest / distTo / update / remove (ground.js's interface).
class Installation {
    constructor(field, { kind, cls, name, lx, lz, dy = 0, radius = 12, hp = 500, hardened = 0, hw = 8, hd = 8, ht = 6, yaw = 0 }) {
        this.field = field; this.game = field.game;
        this.kind = kind; this.type = kind; this.cls = cls; this.name = name;
        this.team = field.team;
        this.lx = lx; this.lz = lz;
        const w = baseToWorld(field.base, lx, lz);
        this.pos = new THREE.Vector3(w.x, field.base.h + dy + ht * 0.4, w.z);
        this.center = this.pos;
        this.radius = radius; this.hitRadius = radius;
        this.hp = this.maxHp = hp; this.health = hp; this.maxHealth = hp;
        this.hardened = hardened;
        this.alive = true; this.isGround = true;
        this.hw = hw; this.hd = hd; this.ht = ht; this.yaw = yaw - field.base.heading;
        this.def = { name, score: Math.round(hp * 0.4), boom: 1.6 };
        this.mesh = new THREE.Object3D(); this.mesh.position.set(w.x, field.base.h, w.z); // (weapons.js settles small targets into craters)
        this.incoming = []; this.vel = new THREE.Vector3();
    }
    // box test in the installation's frame
    hitTest(p) {
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
        const u = dx * c - dz * s, v = dx * s + dz * c, y = p.y - this.field.base.h;
        return Math.abs(u) < this.hw && Math.abs(v) < this.hd && y > -1 && y < this.ht;
    }
    distTo(p) {
        const dx = p.x - this.pos.x, dz = p.z - this.pos.z, c = Math.cos(this.yaw), s = Math.sin(this.yaw);
        const u = Math.max(0, Math.abs(dx * c - dz * s) - this.hw), v = Math.max(0, Math.abs(dx * s + dz * c) - this.hd);
        const y = p.y - this.field.base.h, dy = y > this.ht ? y - this.ht : y < 0 ? -y : 0;
        return Math.hypot(u, v, dy);
    }
    // what each kind of weapon does to it (hardness): overridden per kind
    scale(kind) { return kind === 'strike' ? 1 : kind === 'gun' || kind === 'rifle' ? 0.05 : 1; }
    damage(amount, source, kind) {
        if (!this.alive || !(amount > 0)) return;
        const a = amount * this.scale(kind);
        this.hp -= a; this.health = this.hp;
        this.lastHit = { source, kind, t: this.field.sys.time };
        if (a > 5) this.field.sys.hitOnField(this.field);
        if (this.hp <= 0) this.destroy(source);
    }
    destroy(source) {
        if (!this.alive) return;
        this.alive = false; this.hp = this.health = 0;
        this.field.sys.destroyed(this.field, this, source);
        this.game.events.emit('groundKilled', this, { source });
    }
    update() { }
    remove() { this.removedFromGround = true; }
}

// Hardened aircraft shelter / QRA alert shelter: arched concrete over steel; a 500 lb bomb near it hardly marks
// it, a direct hit or two dents it, a penetrator goes through. Its jet dies with it.
class Shelter extends Installation {
    constructor(field, def) {
        const red = field.team === 'red';
        super(field, { kind: 'shelter', cls: 'shelter', name: def.alert ? (red ? 'ALERT SHELTER' : 'QRA SHELTER') : 'HARDENED AIRCRAFT SHELTER', lx: def.lx, lz: def.lz, radius: 20, hp: 1400, hardened: 0.7, hw: 13, hd: 19, ht: 9, yaw: def.face > 0 ? Math.PI : 0 });
        this.def = { name: this.name, score: 600, boom: 2.4 };
        this.sid = def.id;
    }
    scale(kind) {
        if (kind === 'strike') return 1; // (strikes.js already weighs the warhead against `hardened`)
        if (kind === 'bomb') return 0.32;
        if (kind === 'missile') return 0.22;
        if (kind === 'rocket') return 0.08;
        return 0.01;
    }
}
// Earth-covered munitions igloo: when it goes, what's inside keeps going off for minutes
class Igloo extends Installation {
    constructor(field, spot, i) {
        super(field, { kind: 'igloo', cls: 'ammo', name: 'MUNITIONS IGLOO', lx: spot.lx, lz: spot.lz, radius: 14, hp: 520, hardened: 0.5, hw: 7, hd: 14, ht: 6 });
        this.def = { name: 'AMMUNITION BUNKER', score: 350, boom: 3 };
        this.idx = i;
        this.cook = 0;
    }
    scale(kind) { return kind === 'strike' ? 1 : kind === 'bomb' ? 0.6 : kind === 'missile' ? 0.45 : kind === 'rocket' ? 0.2 : 0.02; }
    update(dt) {
        if (this.alive || this.cook <= 0) return;
        // cook-off: rounds and bombs inside going off at random for minutes, fewer as it burns out
        this.cook -= dt;
        this.nextPop = (this.nextPop ?? 0) - dt;
        if (this.nextPop <= 0) {
            this.nextPop = rand(1.5, 7) * (1.4 - this.cook / 240);
            const fx = this.game.effects, big = Math.random() < 0.25;
            const at = _v.set(this.pos.x + rand(-8, 8), this.field.base.h + rand(1, 4), this.pos.z + rand(-12, 12));
            fx.explosion(at, big ? 1.8 : 0.9);
            if (big) fx.debrisBurst(at, _v2.set(0, 30, 0), 5, 0.9);
            for (let k = 0; k < (big ? 10 : 4); k++) fx.sparks.emit(at, _v2.set(rand(-1, 1), rand(0.3, 1), rand(-1, 1)).multiplyScalar(rand(60, 140)), rand(0.8, 2), 0.7, 0.2, [2.4, 1.5, 0.55], [1.3, 0.35, 0.05], 1, 0, 1.1, -22, 0, 0.5, 1, 0.035);
            const cam = this.game.camera;
            if (cam && this.game.audio && this.game.audio.boom) this.game.audio.boom(cam.position.distanceTo(at), big ? 1.3 : 0.6);
            // a big one can set off a neighbour
            if (big) this.field.sys.blastNear(this.field, at, 60, 260, this);
        }
    }
}
// The power plant: without it the runway lights and the radar go dark
class PowerPlant extends Installation {
    constructor(field, spot) {
        super(field, { kind: 'power', cls: 'power', name: 'POWER PLANT', lx: spot.lx, lz: spot.lz, radius: 16, hp: 700, hardened: 0.3, hw: 15, hd: 11, ht: 9 });
        this.def = { name: 'POWER PLANT', score: 400, boom: 2 };
    }
    scale(kind) { return kind === 'strike' ? 1 : kind === 'bomb' ? 0.9 : kind === 'missile' ? 0.8 : kind === 'rocket' ? 0.5 : 0.04; }
}
// A structure airbase.js already builds (the control tower, the surveillance radar): a buildings.js record takes
// the blasts; this is its face in the war layer (damage from abstract raids goes to the record)
class Wrapped {
    constructor(field, rec, { cls, name, lx, lz, radius = 14 }) {
        this.field = field; this.game = field.game; this.rec = rec;
        this.cls = cls; this.name = name; this.team = field.team; this.type = cls;
        const w = baseToWorld(field.base, lx, lz);
        this.pos = new THREE.Vector3(w.x, field.base.h + 8, w.z);
        this.radius = this.hitRadius = radius; this.isGround = true; this.hardened = 0.2;
        this.def = { name, score: 300 };
    }
    get alive() { return this.rec ? this.rec.alive : true; }
    set alive(v) { /* (the record says) */ }
    get hp() { return this.rec ? this.rec.hp : 1; }
    get maxHp() { return this.rec ? this.rec.maxHp : 1; }
    damage(amount, source, kind) {
        // strikes and bombs reach the record through their blast (worldBlast); abstract raids come here
        if (!this.rec || !this.rec.alive || kind === 'strike') return;
        const B = this.game.world && this.game.world.towns && this.game.world.towns.buildings;
        if (B) B.damage(this.rec, amount * 3, this.game, source);
    }
}
// The runway: never "destroyed" — cratered and closed, or open (its MOS). A strike aimed at it digs a crater
class RunwayUnit {
    constructor(field, i) {
        this.field = field; this.i = i;
        const b = field.base, rw = b.runways[i], w = baseToWorld(b, rw.lx, rw.lz);
        const nums = runwayNumbers(b, rw);
        this.name = 'RUNWAY ' + nums.toward + '/' + nums.from;
        this.pos = new THREE.Vector3(w.x, b.h + 0.2, w.z);
        this.team = field.team; this.cls = 'runway'; this.type = 'runway';
        this.alive = true; this.radius = 30; this.hitRadius = 30; this.isGround = true; this.hardened = 0.5;
        this.def = { name: this.name, score: 0 };
    }
    get closed() { return !this.field.craters.usable(this.i); }
    get hp() { return Math.max(0.05, Math.min(1, this.field.craters.runwayStatus(this.i).mos / (this.field.base.runways[this.i].len))); }
    get maxHp() { return 1; }
    damage() { /* craters come from the blasts themselves (bombImpact / strategicImpact) */ }
}
class TaxiwayUnit {
    constructor(field) {
        this.field = field;
        const b = field.base, w = baseToWorld(b, 140, 0);
        this.name = 'TAXIWAYS'; this.cls = 'taxiway'; this.type = 'taxiway'; this.team = field.team;
        this.pos = new THREE.Vector3(w.x, b.h + 0.2, w.z);
        this.alive = true; this.radius = 30; this.hitRadius = 30; this.isGround = true; this.hardened = 0.5;
        this.def = { name: 'TAXIWAYS', score: 0 };
    }
    damage() { }
}

// ═════════════ A field ═════════════
class Field {
    constructor(sys, base, layout) {
        this.sys = sys; this.game = sys.game;
        this.base = base; this.L = layout; this.id = base.id;
        this.team = base.friendly ? 'blue' : 'red';
        this.name = base.name;
        this.towerCall = base.id === 'home' ? 'SKYWAR TOWER' : base.id === 'miramar' ? 'MIRAMAR TOWER' : 'TOWER';
        const f = fenceOf(base);
        this.fence = f;
        this.info = null;       // airbase.js's record of the field (tower, radar, group)
        this.structures = null; // basestructures.js (visuals)
        this.life = null;       // baselife.js (crews, vehicles, scrambles)
        this.reset(0);
    }
    // the paved rects of the field (the layout's, or what airbase.js laid for Miramar)
    get paved() { return this.L.paved || (this.info && this.info.group && this.info.group.userData.paved) || []; }
    reset(t) {
        this.fsm = new AlertFSM(t);
        this.craters = new CraterField(this.base, this.paved);
        this.crews = new RepairCrews(this.craters, this.L.depot || { lx: 400, lz: -200 });
        this.graph = this.L.taxi ? new TaxiGraph(this.L.taxi) : null;
        const T = TYPES[this.team];
        this.airwing = this.L.shelters && this.L.shelters.length ? new Airwing(this.L.shelters, [...T.qra, ...T.has]) : null;
        this.units = { runways: [], taxi: null, tower: null, radar: null, power: null, shelters: new Map(), igloos: [], fuel: [], pads: [], aaa: [] };
        this.scrambles = [];
        this.lostT = -1e9; this.damageLog = [];
        this.threat = 0; this.threatDist = Infinity; this.threats = [];
        this.closed = this.base.runways.map(() => false);
        this.lastState = ALERT.NORMAL;
        this.seenT = -1e9;
        this.repairCallT = -1e9;
        this.impacts = 0;
        this.version = -1;
        this.blackout = false;
        this.powered = true;
    }
    // base-local → world (y: the field's level + dy)
    w(lx, lz, dy = 0, out = new THREE.Vector3()) { const p = baseToWorld(this.base, lx, lz); return out.set(p.x, this.base.h + dy, p.z); }
    local(p) { return worldToBase(this.base, p.x, p.z); }
    inside(p, margin = 0) {
        const { lx, lz } = this.local(p), F = this.fence;
        return lx > F.x0 - margin && lx < F.x1 + margin && lz > F.z0 - margin && lz < F.z1 + margin;
    }
    get state() { return this.fsm.state; }
    get stateName() { return ALERT_NAMES[this.fsm.state]; }
    get towerUp() { return !this.units.tower || this.units.tower.alive; }
    get runwayOpen() { return this.craters.anyRunwayOpen(); }
    get fuelFrac() { const f = this.units.fuel; return f.length ? f.filter(u => u.alive).length / f.length : 1; }
    get ammoFrac() { const a = this.units.igloos; return a.length ? a.filter(u => u.alive).length / a.length : 1; }
    // sortie rate: turnarounds slow down without fuel and munitions
    get rate() { return (0.25 + 0.75 * this.fuelFrac) * (0.55 + 0.45 * this.ammoFrac); }
    get damaged() { return this.craters.unrepaired.length > 0 || this.damageLog.length > 0; }
}

// ═════════════ The system ═════════════
export class Bases {
    constructor(game) {
        this.game = game;
        this.enabled = false;   // the war logic (war and sandbox): installations as targets, scrambles, raids, tasks
        this.active = false;    // craters, alerts, repairs, sirens and life: every mode but the menu
        this.render = true;     // (headless tests turn the visuals off)
        this.time = 0;
        this.fields = [];
        for (const b of BASES) { const L = baseLayout(b); if (L && L.military) this.fields.push(new Field(this, b, L)); }
        this.sounds = new BaseSounds(game);
        this.view = null;
        this.listen();
        this.registered = false;
    }

    // ═════════════ Lifecycle ═════════════
    start(mode) {
        this.clear();
        this.mode = mode;
        this.active = true;
        this.enabled = mode === 'war' || mode === 'sandbox';
        const g = this.game;
        this.time = 0;
        this.attachWorld();
        for (const F of this.fields) {
            F.reset(0);
            if (F.structures) F.structures.reset();
            if (F.life) F.life.reset();
            if (this.enabled) this.buildInstallations(F);
        }
        if (this.enabled && !this.registered && g.tasks && g.tasks.addGenerator) { this.registered = true; this.addTaskGenerators(); }
        this.syncView(true);
    }

    clear() {
        for (const F of this.fields) {
            for (const s of F.scrambles) if (F.life) F.life.abortScramble(s);
            F.scrambles.length = 0;
            if (F.life) F.life.clear();
        }
        this.sounds.clear();
        if (this.view) this.view.clear();
        const ab = this.game.world && this.game.world.airbases;
        if (ab && ab.lights) for (const F of this.fields) { ab.lights.setBlackout(F.id, false); ab.lights.setPower(F.id, true); ab.lights.setSearch(F.id, false); for (let i = 0; i < 3; i++) ab.lights.setClosed(F.id, i, false); }
        this.active = false; this.enabled = false;
    }

    // hook up to the world's airbase dressing (built after the game in main.js boot, so done lazily)
    attachWorld() {
        const g = this.game, ab = g.world && g.world.airbases;
        if (!ab || this.attached) return;
        this.attached = true;
        for (const F of this.fields) F.info = ab.bases.find(i => i.base === F.base) || null;
        if (!this.render || !g.scene) return;
        // the visuals (headless tests run without them)
        try {
            this.view = new PavementCraters(g.scene);
            for (const F of this.fields) { F.structures = new FieldStructures(this, F); F.structures.build(); }
            for (const F of this.fields) F.life = new FieldLife(this, F);
            this.patchPavements();
        } catch (e) { console.warn('[bases] visuals', e); }
    }

    // the materials of every paved surface on the fields (runways, taxiways, aprons, our own) cut by craters
    patchPavements() {
        const v = this.view;
        if (!v) return;
        for (const b of BASES) for (const rw of b.runways) if (rw.holder) rw.holder.traverse(o => { if (o.isMesh && o.material) v.patch(o.material); });
        const scene = this.game.scene, ab = this.game.world.airbases;
        for (const F of this.fields) {
            // world.js's taxiway / apron planes: in the field's own group there
            for (const grp of scene.children) {
                if (!grp.isGroup || Math.abs(grp.position.x - F.base.x) > 1 || Math.abs(grp.position.z - F.base.z) > 1 || (ab && ab.bases.some(i => i.group === grp))) continue;
                for (const o of grp.children) if (o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry' && o.material && !o.material.map) v.patch(o.material);
            }
            if (F.info && F.info.group && F.info.group.userData.paved) for (const p of F.info.group.userData.paved) if (p.mesh) v.patch(p.mesh.material);
            if (F.structures && F.structures.paveMat) v.patch(F.structures.paveMat);
        }
    }

    // the field's installations as war units (and ground targets where they can be hit directly)
    buildInstallations(F) {
        const g = this.game, war = g.war, L = F.L, b = F.base, U = F.units;
        const add = (u, o) => { if (war) war.add(u, o); return u; };
        const ground = (u) => { u.noHud = true; if (g.ground && g.ground.targets && !g.ground.targets.includes(u)) g.ground.targets.push(u); return u; };
        // runways, taxiways
        b.runways.forEach((rw, i) => { const u = new RunwayUnit(F, i); U.runways.push(add(u, { cls: 'runway', name: F.name + ' ' + u.name, known: INTEL.IDENTIFIED })); });
        if (L.taxi) U.taxi = add(new TaxiwayUnit(F), { cls: 'taxiway', name: F.name + ' TAXIWAYS', known: INTEL.IDENTIFIED });
        // tower and radar (airbase.js's structures)
        const info = F.info;
        if (L.tower) U.tower = add(new Wrapped(F, info && info.towerRec, { cls: 'tower', name: 'CONTROL TOWER', lx: L.tower.lx, lz: L.tower.lz }), { cls: 'tower', name: F.name.replace(/ AIR BASE| INTERNATIONAL/, '') + ' CONTROL TOWER' });
        if (L.radar) {
            const r = add(new Wrapped(F, info && info.radarRec, { cls: 'radar', name: 'SURVEILLANCE RADAR', lx: L.radar.lx, lz: L.radar.lz, radius: 10 }), { cls: 'radar', name: 'AIRFIELD SURVEILLANCE RADAR' });
            r.radarRange = L.radar.range;
            U.radar = r;
        }
        if (L.power) U.power = ground(add(new PowerPlant(F, L.power), { cls: 'power', name: 'POWER PLANT' }));
        for (const [i, s] of (L.ammo || []).entries()) U.igloos.push(ground(add(new Igloo(F, s, i), { cls: 'ammo', name: 'AMMUNITION BUNKER' })));
        for (const s of L.shelters || []) { const u = ground(add(new Shelter(F, s), { cls: 'shelter' })); U.shelters.set(s.id, u); }
        // fuel: the enemy's live field has ground.js POL sites already; ours get the same
        for (const s of L.fuel || []) {
            const w = baseToWorld(b, s.lx, s.lz);
            let t = g.ground && g.ground.targets.find(x => x.type === 'fuel' && x.alive && Math.hypot(x.pos.x - w.x, x.pos.z - w.z) < 40);
            if (!t && g.ground && g.ground.addTarget) { t = g.ground.addTarget('fuel', w.x, w.z, -b.heading, F.team); t.name = 'FUEL DEPOT'; t.def = { ...t.def, name: 'FUEL DEPOT' }; }
            if (t) {
                t.field = F; t.name = 'BULK FUEL STORAGE'; t.noHud = true;
                add(t, { cls: 'fuel', name: 'BULK FUEL STORAGE' }); U.fuel.push(t);
                if (F.structures) for (const c of t.mesh.children) c.visible = false; // (our tank farm model stands there)
            }
        }
        // the field's own radars and SAM / AAA sites (ground.js) take the field's power and readiness
        if (g.ground) for (const t of g.ground.targets) {
            if (t.isShip || t.route || !t.pos || t.team !== F.team || t.field) continue;
            if (!F.inside(t.pos, 200)) continue;
            if (t.type === 'radar') { t.field = F; F.fieldRadars = F.fieldRadars || []; F.fieldRadars.push(t); }
            if (t.role === 'sam' || t.role === 'aaa') { t.field = F; U.aaa.push(t); }
        }
        // missile installations and extra air defence
        this.buildPads(F);
        for (const u of U.runways) u.field = F;
    }

    // hardened pads: the enemy's S-300 battery (it erects when the field goes to alert), our HIMARS pad (a launch source)
    buildPads(F) {
        const g = this.game, b = F.base, U = F.units;
        if (!g.ground || !g.ground.addTarget) return;
        for (const p of F.L.pads || []) {
            const w = baseToWorld(b, p.lx, p.lz);
            let t = null;
            if (p.kind === 'sam') {
                t = g.ground.addTarget('sam', w.x, w.z, -b.heading + p.yaw, F.team);
                t.name = p.name; t.def = { ...t.def, name: p.name, score: 400 }; t.samRange = 12000; t.ammo = 4;
                g.war.add(t, { cls: 'sam', name: 'S-300PS LAUNCHER' });
            } else if (p.kind === 'samradar') {
                t = g.ground.addTarget('radar', w.x, w.z, -b.heading + p.yaw, F.team);
                t.name = p.name; t.def = { ...t.def, name: p.name, score: 450 }; t.radarRange = 70000;
                g.war.add(t, { cls: 'sam-radar', name: '30N6 FLAP LID' });
            } else if (p.kind === 'launcher') {
                t = g.ground.addTarget('truck', w.x, w.z, -b.heading + p.yaw, F.team);
                t.name = 'M142 HIMARS'; t.def = { ...t.def, name: 'M142 HIMARS', score: 400 }; t.radius = t.hitRadius = 6;
                g.war.add(t, { cls: 'artillery', name: 'M142 HIMARS (HARDENED PAD)' });
                if (g.strikes && g.strikes.addSource) import('./strikes.js').then(({ GroundLauncher }) => {
                    if (!t.alive || !this.enabled) return;
                    t.launcher = g.strikes.addSource(new GroundLauncher(g.strikes, t, { kind: 'launcher', name: 'SKYWAR PAD HIMARS', stock: { atacms: 2, penetrator: 1 }, muzzle: new THREE.Vector3(0, 3.4, 1.6) }));
                });
            }
            if (!t) continue;
            t.field = F; t.pad = p; t.noHud = true;
            U.pads.push(t);
            if (F.structures) F.structures.dressPad(t, p);
        }
        for (const a of F.L.aaa || []) {
            const w = baseToWorld(b, a.lx, a.lz);
            const t = g.ground.addTarget('aaa', w.x, w.z, -b.heading, F.team);
            t.name = 'M163 VULCAN'; t.def = { ...t.def, name: 'M163 VULCAN AIR DEFENCE' }; t.field = F; t.noHud = true;
            g.war.add(t, { cls: 'aaa', name: 'M163 VULCAN' });
            U.aaa.push(t);
        }
    }

    // ═════════════ Queries ═════════════
    field(b) { if (!b) return null; const id = typeof b === 'string' ? b : b.id; return this.fields.find(F => F.id === id) || null; }
    // the field a world point is on (inside its fence + margin), or null
    fieldAt(p, margin = 400) {
        if (!p) return null;
        for (const F of this.fields) if (Math.hypot(p.x - F.base.x, p.z - F.base.z) < F.base.r * 2.2 && F.inside(p, margin)) return F;
        return null;
    }
    // can this field launch aircraft now? { ok, why, eta } — why: 'runway' | 'taxi' | 'aircraft' | 'fuel'
    launchStatus(b) {
        const F = this.field(b);
        if (!F) return { ok: true };
        if (!F.runwayOpen) return { ok: false, why: 'runway' };
        if (F.airwing && F.airwing.available < 1) return { ok: false, why: 'aircraft' };
        if (F.units.fuel.length && F.fuelFrac <= 0 && F.airwing && F.airwing.alertReady.length === 0) return { ok: false, why: 'fuel' };
        return { ok: true };
    }
    // where a raid on the field should aim: along the runway (a stick across it closes it) or at an installation
    raidAim(b) {
        const F = this.field(b);
        if (!F || !this.enabled) return null;
        if (Math.random() < 0.6 && F.runwayOpen) {
            const rw = F.base.runways[0];
            return baseToWorld(F.base, rw.lx + rand(-8, 8), rw.lz + rand(-0.3, 0.3) * rw.len);
        }
        const opts = [...F.units.shelters.values(), ...F.units.igloos, ...F.units.fuel, F.units.power].filter(u => u && u.alive);
        const u = opts.length ? pick(opts) : null;
        return u ? { x: u.pos.x, z: u.pos.z } : null;
    }

    // ═════════════ Events ═════════════
    listen() {
        const ev = this.game.events;
        if (!ev || !ev.on) return;
        ev.on('bombImpact', (b, d = {}) => { if (this.active) this.onBlast(d.at || (b && b.pos), 'bomb', b && b.owner, d); });
        ev.on('strategicImpact', (m, d = {}) => { if (this.active && m) this.onBlast(d.at || m.pos, 'strike', m.source && m.source.host, { missile: m }); });
        ev.on('raidDetected', (f) => { if (this.active && f && f.target && f.target.kind === 'base') this.onRaidDetected(f); });
        ev.on('raidHit', (f, d = {}) => { if (this.active && d.hit && d.target && d.target.kind === 'base' && !f.members) this.abstractRaid(d.target.base, f); });
        ev.on('groundKilled', (t, d = {}) => { if (this.active && t && t.field && t.type === 'fuel') this.fuelLost(t.field, t, d.source); });
        ev.on('flightDone', (f, d = {}) => { if (this.active && f && f.fromField && d.why === 'landed') this.jetsBack(f); });
        ev.on('killed', (ac) => { if (this.active && ac && ac.airwingJet) { const F = ac.fromField; if (F && F.airwing) F.airwing.lost(ac.airwingJet); } });
    }

    // a blast: on a field's pavement it's a crater, anywhere on the field it's an attack
    onBlast(at, kind, owner, d) {
        if (!at) return;
        const F = this.fieldAt(at, 300);
        if (!F) return;
        F.fsm.impact(this.time);
        F.impacts++;
        const { lx, lz } = F.local(at);
        if (at.y - F.base.h > 12) return; // an airburst over the field
        let r = 4.3, depth = 2.1;
        const m = d.missile;
        if (m && m.spec) {
            const wh = m.spec.warhead || 300;
            if (m.spec.kind === 'rocket' && wh < 100) return;
            r = clamp(Math.sqrt(wh) / 4.2, 2.8, 7.5); depth = clamp(r * 0.5, 1.2, 3.6);
            if (m.spec.hard >= 1) { r *= 0.7; depth *= 1.6; } // a penetrator: a deep, narrow hole
        }
        const runwayStrike = m && m.strike && m.strike.type === 'runway';
        if (runwayStrike) {
            // a runway-attack missile's payload: a line of cratering submunitions right across the runway
            const rw = F.craters.frames.find(Fr => { const u = (lx - Fr.cx) * Fr.c - (lz - Fr.cz) * Fr.s, v = (lx - Fr.cx) * Fr.s + (lz - Fr.cz) * Fr.c; return Math.abs(u) < Fr.hw * 3 && Math.abs(v) < Fr.half + 50; });
            if (rw) {
                const v = (lx - rw.cx) * rw.s + (lz - rw.cz) * rw.c;
                for (const u of [-rw.hw * 0.62, 0, rw.hw * 0.62]) {
                    const p = { lx: rw.cx + u * rw.c + v * rw.s, lz: rw.cz - u * rw.s + v * rw.c };
                    this.crater(F, p.lx + rand(-2, 2), p.lz + rand(-3, 3), 4.6, 2.3, 'strike');
                }
                return;
            }
        }
        if (!this.crater(F, lx, lz, r, depth, kind)) this.grassCrater(F, at, r);
    }

    // a crater on the field's pavement (null when it's not on it)
    crater(F, lx, lz, r, depth, kind) {
        const was = F.craters.version;
        const c = F.craters.add(lx, lz, r, { depth, t: this.time, kind, seed: Math.random() * 6.28 });
        if (c && F.craters.version !== was) this.pavementChanged(F);
        return c;
    }
    // off the pavement inside the fence: an ordinary crater in the ground (craters.js), where it doesn't touch paving
    grassCrater(F, at, r) {
        const C = this.game.world && this.game.world.craters;
        if (!C || !C.add) return;
        const { lx, lz } = F.local(at);
        if (F.craters.surfaceAt(lx, lz, r * 2.6 + 4)) return;
        if (terrainHeight(at.x, at.z) < 1) return;
        C.add(at.x, at.z, 'bomb', {});
    }

    onRaidDetected(f) {
        const F = this.field(f.target.base);
        if (!F) return;
        F.fsm.threat(1, this.time);
        F.raid = f;
        // our alert pair goes up after it
        if (F.team === this.game.war.side && this.enabled) this.scrambleCap(F, f);
    }

    // an abstract raid's bombs (the director settled the odds): a stick across the runway, or an installation hit
    abstractRaid(b, f) {
        const F = this.field(b);
        if (!F) return;
        F.fsm.impact(this.time);
        const rw = F.base.runways[0];
        if (Math.random() < 0.6) {
            const v = rand(-0.35, 0.35) * rw.len, n = 3 + Math.floor(Math.random() * 3);
            for (let k = 0; k < n; k++) this.crater(F, rw.lx + (k / (n - 1) - 0.5) * rw.w * 1.1 + rand(-3, 3), rw.lz + v + rand(-10, 10), 4.3, 2.1, 'bomb');
        } else {
            // a stick on an installation: bomb damage as a direct hit or two (its hardness applies)
            const opts = [...F.units.shelters.values(), ...F.units.igloos, ...F.units.fuel, F.units.power].filter(u => u && u.alive);
            if (opts.length) pick(opts).damage(rand(900, 2200), { team: f ? f.team : 'red', name: 'ENEMY AIRCRAFT' }, 'bomb');
        }
    }

    // any real hit on an installation of the field counts as an attack on it
    hitOnField(F) { F.fsm.impact(this.time); }

    // blast damage to the field's installations around a point (a cook-off, a secondary)
    blastNear(F, at, R, amount, except = null) {
        const all = [...F.units.shelters.values(), ...F.units.igloos, F.units.power].filter(u => u && u.alive && u !== except);
        for (const u of all) { const d = u.distTo ? u.distTo(at) : u.pos.distanceTo(at); if (d < R) u.damage(amount * (1 - d / R), null, 'bomb'); }
    }

    // an installation destroyed
    destroyed(F, u, source) {
        F.damageLog.push({ what: u.kind, t: this.time, unit: u });
        const g = this.game, friendly = F.team === g.war.side;
        const fx = g.effects;
        if (u.kind === 'shelter') {
            const jet = F.airwing ? F.airwing.destroyShelter(u.sid) : null;
            if (F.structures) F.structures.wreckShelter(u.sid);
            fx.explosion(u.pos, 2.6); fx.debrisBurst(u.pos, _v.set(0, 35, 0), 10, 1.4);
            fx.smokeColumn(_v.copy(u.pos).setY(F.base.h + 2), 1.4, 90);
            this.burning(F, u.pos, 1.3, 240);
            this.report(F, friendly ? 'SHELTER ' + u.sid.toUpperCase() + ' DESTROYED' + (jet ? ' — WE LOST THE ' + typeName(jet.type) + ' INSIDE' : '') : 'ENEMY SHELTER DESTROYED' + (jet ? ' — THE ' + typeName(jet.type) + ' INSIDE WITH IT' : ''), friendly);
        } else if (u.kind === 'igloo') {
            fx.explosion(u.pos, 3.4); fx.debrisBurst(u.pos, _v.set(0, 45, 0), 14, 1.6);
            fx.smokeColumn(_v.copy(u.pos).setY(F.base.h + 2), 1.8, 200);
            u.cook = rand(160, 260);
            if (F.structures) F.structures.wreckIgloo(u.idx);
            this.blastNear(F, u.pos, 90, 300, u);
            this.report(F, friendly ? 'MUNITIONS STORAGE HIT — IT IS COOKING OFF, KEEP CLEAR' : 'ENEMY AMMUNITION DUMP HIT — IT IS COOKING OFF', friendly);
        } else if (u.kind === 'power') {
            fx.explosion(u.pos, 2.2); fx.smokeColumn(_v.copy(u.pos).setY(F.base.h + 3), 1.2, 180);
            this.burning(F, u.pos, 1, 300);
            if (F.structures) F.structures.wreckPower();
            this.report(F, friendly ? 'POWER PLANT DESTROYED — RUNWAY LIGHTS AND RADAR ARE DARK' : 'ENEMY POWER PLANT DESTROYED — THEIR RADAR AND RUNWAY LIGHTS ARE DARK', friendly);
        }
        g.events.emit('baseDamage', F, { what: u.kind, unit: u, source });
    }

    fuelLost(F, t) {
        F.damageLog.push({ what: 'fuel', t: this.time, unit: t });
        const g = this.game, fx = g.effects, friendly = F.team === g.war.side;
        // secondaries: tanks going up one after another over the next minute, and the fire keeps burning
        const n = 3 + Math.floor(Math.random() * 3);
        F.secondaries = F.secondaries || [];
        for (let k = 0; k < n; k++) F.secondaries.push({ at: t.pos.clone().add(new THREE.Vector3(rand(-14, 14), rand(2, 8), rand(-14, 14))), t: this.time + rand(3, 55), size: rand(1.6, 3) });
        if (F.structures) F.structures.wreckFuel(t);
        this.burning(F, t.pos, 1.8, 1e9);
        this.report(F, friendly ? 'THE FUEL DEPOT IS BURNING — SORTIE RATE WILL DROP' : 'ENEMY FUEL DEPOT BURNING — THEIR SORTIE RATE WILL DROP', friendly);
        g.events.emit('baseDamage', F, { what: 'fuel', unit: t });
        void fx;
    }

    // a fire that keeps going (the director keeps fuel fires burning in the war modes; this covers the rest)
    burning(F, pos, size, dur) {
        F.fires = F.fires || [];
        F.fires.push({ pos: pos.clone(), size, until: this.time + dur, puff: 0, col: 0 });
    }

    // ═════════════ Radio ═════════════
    say(from, text, opts = {}) {
        const g = this.game, d = g.director;
        if (d && d.enabled && d.say) d.say(from, text, opts);
        else if (g.war && g.war.radio) g.war.radio(from, text, opts);
    }
    // the field's own tower (while it stands), else command
    tower(F, text, opts = {}) {
        if (F.team !== this.game.war.side) return;
        if (F.towerUp) this.say(F.towerCall, text, { color: '#9fd4ff', ...opts });
        else if (opts.critical) this.say('COMMAND', F.name + ': ' + text, { color: '#9fd4ff', ...opts });
    }
    // what we hear about a field: ours from its tower, theirs from intel (when we know about it)
    report(F, text, friendly) {
        if (friendly) this.tower(F, text, { critical: true, say: false });
        else this.say('INTEL', text, { color: '#5dffa0', say: false });
    }

    // ═════════════ Scrambles (the director's API) ═════════════
    // from: a field, a BASES entry or a point at a field. opts: { team, types, role, callsign, skill, speed, target
    // (Vector3), setup(flight) }. Returns { field, eta, physical, types } when the field launches (the flight is made at
    // wheels-up and setup() called on it), false when that field can't launch now, null when `from` is no field of ours
    scramble(from, opts = {}) {
        if (!this.active) return null;
        const F = from && from.base && from.fsm ? from : from && from.id && this.field(from.id) ? this.field(from.id) : this.fieldAt(from, 3000);
        if (!F || !F.airwing) return null;
        if (!this.launchStatus(F.base).ok) return false;
        if (F.scrambles.some(s => !s.done)) return false; // one pair at a time off a field
        const n = Math.min(2, (opts.types && opts.types.length) || 2);
        const jets = F.airwing.take(n, this.time);
        if (!jets.length) return false;
        const qra = jets.every(j => j.from && j.from.qra);
        const cam = this.game.camera ? this.game.camera.position : null;
        const near = !!cam && Math.hypot(cam.x - F.base.x, cam.z - F.base.z) < 16000;
        const night = this.night();
        const T = scrambleTimeline({ qra, tower: F.towerUp, power: F.powered, night, taxi: qra ? 170 : 900 });
        const sc = { field: F, jets, types: jets.map(j => j.type), opts: { ...opts, team: F.team }, t: 0, T, eta: T.airborne, physical: near && !!F.life && this.render, done: false, stage: 'horn', aircraft: [] };
        F.scrambles.push(sc);
        F.fsm.threat(1, this.time);
        if (sc.physical) F.life.startScramble(sc);
        this.game.events.emit('baseScramble', F, { scramble: sc });
        if (F.team !== this.game.war.side && near) this.say('INTEL', 'ALERT FIGHTERS SCRAMBLING AT ' + F.name + ' — AIRBORNE IN ABOUT ' + Math.round(T.airborne / 10) * 10 + ' SECONDS', { color: '#ff9f5a', say: false });
        return { field: F, eta: T.airborne, physical: sc.physical, types: sc.types, scramble: sc };
    }

    // abstract scrambles (or a physical one handing over): the flight at wheels-up
    airborne(sc, members = null) {
        const g = this.game, d = g.director, F = sc.field, o = sc.opts;
        sc.done = true;
        if (!d || !d.spawnFlight) return null;
        const b = F.base, dep = F.L.depart;
        const rw = b.runways[0], H = rw.len / 2;
        // abstract: climbing out over the far end of the runway (takeoffs run toward local −z)
        const far = baseToWorld(b, rw.lx, rw.lz + (dep ? dep.heading : -1) * H);
        const pos = members && members[0] ? members[0].pos.clone() : new THREE.Vector3(far.x, b.h + 400, far.z);
        const f = d.spawnFlight({ team: F.team, role: o.role || 'intercept', types: sc.types, pos, speed: o.speed || 280, skill: o.skill ?? 0.6, callsign: o.callsign || (F.team === g.war.side ? 'ALERT' : 'INTERCEPT'), route: o.target ? [{ p: new THREE.Vector3(o.target.x, Math.max(o.target.y || 0, 2500), o.target.z) }] : [] });
        f.fromField = F; f.jets = sc.jets;
        if (members && d.adopt) {
            d.adopt(f, members);
            members.forEach((a, i) => { a.fromField = F; a.airwingJet = sc.jets[i]; });
        }
        if (o.setup) { try { o.setup(f); } catch (e) { console.warn('[bases] setup', e); } }
        sc.flight = f;
        return f;
    }

    // a flight from a field is home: the jets turn round there
    jetsBack(f) {
        const F = f.fromField;
        if (!F || !F.airwing || !f.jets) return;
        f.jets.forEach((j, i) => { if (f.hp[i] > 0) F.airwing.back(j, this.time, F.rate); else F.airwing.lost(j); });
    }

    // our alert pair after a raid on the field
    scrambleCap(F, raid) {
        const g = this.game, war = g.war;
        if (!F.airwing || F.airwing.alertReady.length < 2 || !F.runwayOpen) return;
        if (raid.pos.distanceTo(_v.set(F.base.x, F.base.h, F.base.z)) < 15000) return; // too late for that
        const meet = raid.pos.clone().lerp(_v.set(F.base.x, 3000, F.base.z), 0.55);
        const r = this.scramble(F, {
            role: 'cap', callsign: 'ALERT', skill: 0.66, speed: 290, target: meet,
            setup: (f) => { f.loiter = { center: meet.clone().setY(Math.max(meet.y, 3000)), R: 6000, until: war.time + 600 }; f.vector = raid; f.home = new THREE.Vector3(F.base.x, F.base.h + 1500, F.base.z); },
        });
        if (r) this.tower(F, 'ALERT ONE, ALERT TWO — SCRAMBLE, SCRAMBLE. RAID INBOUND, ' + Math.round(raid.pos.distanceTo(F.w(0, 0)) / 1000) + ' KILOMETRES', { say: 'Alert one, scramble, scramble!', priority: true });
    }

    // dark enough for a blackout and searchlights (the weather system's continuous night, else the menu's time)
    night() {
        const wx = this.game.weather;
        if (wx && typeof wx.night === 'number') return wx.night > 0.5;
        const k = this.game.world && this.game.world.timeKey; return k === 'night' || k === 'dusk';
    }
    // runway and approach lights by day when the weather needs them (fog, a low ceiling), and after dark
    weatherLights(ab) {
        const wx = this.game.weather;
        if (!wx || !wx.visibility || !ab || !ab.lights || !ab.lights.setWeather) return;
        for (const L of ab.lights.fields.values()) {
            const c = _v.set(L.base.x, L.base.h + 5, L.base.z);
            const on = !!wx.lightsOn || wx.visibility(c) < 5000 || (wx.ceiling ? wx.ceiling(c) < 450 : false);
            ab.lights.setWeather(L.base.id, on);
        }
    }

    // ═════════════ Per frame ═════════════
    update(dt) {
        if (!this.active) return;
        const g = this.game;
        if (g.state === 'menu' || g.state === 'over' || g.state === 'paused') return;
        this.time += dt;
        if (!this.attached) this.attachWorld();
        this.thinkT = (this.thinkT ?? 0) - dt;
        const think = this.thinkT <= 0;
        if (think) this.thinkT = 1;
        const cam = g.camera ? g.camera.position : null;
        if (think) this.weatherLights(g.world && g.world.airbases);
        for (const F of this.fields) {
            if (think) this.threats(F);
            // repairs (crews shelter while the field is under attack), turnarounds
            F.crews.update(dt, { hold: F.fsm.state === ALERT.ATTACK, rate: 1 });
            if (F.airwing && think) { const moves = F.airwing.update(this.time, F.rate); if (moves.length && F.life) F.life.qraMoves(moves); }
            F.fsm.damaged = F.damaged;
            const ch = F.fsm.update(this.time);
            if (ch) this.stateChanged(F, ch);
            this.updateRunways(F);
            this.updateScrambles(F, dt);
            this.updateFires(F, dt, cam);
            this.updatePower(F);
            if (F.structures) F.structures.update(dt, cam);
            if (F.life) F.life.update(dt, cam);
        }
        this.playerCraters();
        this.syncView(false);
        if (this.view && g.world && g.world.sunDir) this.view.setSun(g.world.sunDir);
        this.sounds.update(dt, cam);
    }

    // who's coming: hostile aircraft and missiles near the field that its side can see
    threats(F) {
        const g = this.game, war = g.war;
        const c = _v.set(F.base.x, F.base.h, F.base.z);
        let level = 0, best = Infinity;
        F.threats.length = 0;
        for (const a of g.aircraft) {
            if (!a.alive || a.team === F.team || a.onGround) continue;
            const d = a.pos.distanceTo(c);
            if (d > 45000) continue;
            // their radars (or eyes and ears within 8 km) have to see it
            const seen = d < 8000 || (war && war.coverage(F.team, a.pos) > 0.15);
            if (!seen) continue;
            // heading this way (or already close)
            const closing = d < 15000 || _v2.subVectors(c, a.pos).normalize().dot(_v3.copy(a.vel).normalize()) > 0.6;
            if (!closing) continue;
            if (d < 6000) F.threats.push(a);
            best = Math.min(best, d);
            level = Math.max(level, d < 4000 ? 3 : d < 12000 ? 2 : 1);
        }
        const dir = g.director;
        if (dir && dir.flights) for (const f of dir.flights) {
            if (f.done || f.members || f.team === F.team || f.n === 0) continue;
            if (F.team === war.side && !f.detected) continue;
            const d = f.pos.distanceTo(c);
            if (d > 40000 || !(f.role === 'raid' || f.role === 'cas' || f.role === 'recon' || d < 15000)) continue;
            best = Math.min(best, d);
            level = Math.max(level, d < 12000 ? 2 : 1);
        }
        const st = g.strikes;
        if (st && st.missiles) for (const m of st.missiles) {
            if (!m.alive || m.team === F.team || !m.targetPos) continue;
            if (!F.inside(m.targetPos, 600)) continue;
            const d = m.pos.distanceTo(c);
            level = Math.max(level, d < 8000 ? 2 : 1);
            best = Math.min(best, d);
        }
        if (level) F.fsm.threat(level, this.time);
        F.threat = level; F.threatDist = best;
        // has our side had a look at the enemy field lately? (what the map may show of it)
        const cp = camPos(g);
        if (F.team !== war.side && cp && cp.distanceTo(c) < 16000) F.seenT = this.time;
    }

    stateChanged(F, { from, to }) {
        const g = this.game, war = g.war, friendly = F.team === war.side;
        this.game.events.emit('baseAlert', F, { from, to });
        const S = ALERT;
        // the siren (the one nearest the camera sounds for the field): a rise and hold for ALERT, the wavering tone
        // through an ATTACK, a steady ALL CLEAR
        const key = 'siren:' + F.id;
        const sp = this.sirenPos(F);
        if (to === S.ATTACK) this.sounds.siren(key, sp, 'attack');
        else if (to === S.ALERT && from !== S.ATTACK) this.sounds.siren(key, sp, 'alert');
        else if ((from === S.ATTACK || from === S.ALERT) && (to === S.NORMAL || to === S.DAMAGED)) this.sounds.siren(key, sp, 'clear');
        else if (to === S.ALERT && from === S.ATTACK) this.sounds.siren(key, sp, null);
        if (friendly) {
            if (to === S.ALERT && from !== S.ATTACK) this.tower(F, 'ALARM YELLOW, ALARM YELLOW — HOSTILE AIRCRAFT INBOUND' + (F.threatDist < 1e9 ? ', ' + Math.round(F.threatDist / 1000) + ' KILOMETRES' : '') + '. ALL PERSONNEL TO SHELTERS', { say: 'Alarm yellow, alarm yellow. Hostiles inbound.', color: '#ffd24a' });
            else if (to === S.ATTACK) this.tower(F, 'ALARM RED, ALARM RED — AIR ATTACK. TAKE COVER', { say: 'Alarm red! Alarm red! Air attack, take cover!', priority: true, color: '#ff4a3d', critical: true });
            else if (from === S.ATTACK && to === S.ALERT) this.tower(F, 'ALARM YELLOW — STAY UNDER COVER', { say: false });
            else if (to === S.DAMAGED) this.tower(F, 'ALL CLEAR — DAMAGE: ' + this.damageText(F) + (F.crews.active.length && F.craters.unrepaired.length ? '. REPAIR TEAMS ROLLING' : ''), { say: 'All clear. Damage reports coming in.', color: '#ff9f5a', critical: true });
            else if (to === S.NORMAL && from !== S.DAMAGED) this.tower(F, 'ALL CLEAR — AIRFIELD OPERATIONS NORMAL', { say: false, color: '#5dffa0' });
            else if (to === S.NORMAL && from === S.DAMAGED) this.tower(F, 'ALL REPAIRS COMPLETE — FULL OPERATIONS', { say: false, color: '#5dffa0' });
        } else if (to === S.ALERT && from === S.NORMAL && this.enabled && (!F.alertCallT || this.time - F.alertCallT > 300)) {
            F.alertCallT = this.time;
            this.say('INTEL', 'SIGINT: ' + F.name + ' HAS GONE TO ALERT — EXPECT FIGHTERS', { color: '#ffd24a', say: false });
        }
    }

    sirenPos(F) {
        const cam = this.game.camera ? this.game.camera.position : _v2.set(F.base.x, 0, F.base.z);
        let best = null, bd = Infinity;
        for (const s of F.L.sirens || [{ lx: 0, lz: 0 }]) { const p = F.w(s.lx, s.lz, 8); const d = p.distanceTo(cam); if (d < bd) { bd = d; best = p; } }
        return best;
    }

    damageText(F) {
        const out = [];
        for (const [i] of F.base.runways.entries()) {
            const st = F.craters.runwayStatus(i);
            if (st.craters) out.push(F.units.runways[i] ? F.units.runways[i].name + (st.open ? ' OPEN, ' : ' CLOSED, ') + st.craters + ' CRATER' + (st.craters > 1 ? 'S' : '') : st.craters + ' CRATERS ON THE RUNWAY');
        }
        const tx = F.craters.unrepaired.filter(c => c.rw < 0).length;
        if (tx) out.push(tx + ' ON THE TAXIWAYS');
        const kinds = {};
        for (const d of F.damageLog) kinds[d.what] = (kinds[d.what] || 0) + 1;
        const names = { shelter: 'SHELTER', igloo: 'MUNITIONS IGLOO', power: 'POWER PLANT', fuel: 'FUEL TANKS', tower: 'CONTROL TOWER', radar: 'RADAR' };
        for (const [k, n] of Object.entries(kinds)) out.push((n > 1 ? n + ' ' : '') + (names[k] || k.toUpperCase()) + (n > 1 ? 'S' : '') + ' LOST');
        return out.length ? out.join('; ') : 'NONE';
    }

    // runway open / closed: lights, crosses, the radio, air traffic, events
    updateRunways(F) {
        const g = this.game, ab = g.world && g.world.airbases, friendly = F.team === g.war.side;
        F.base.runways.forEach((rw, i) => {
            const closed = !F.craters.usable(i);
            if (closed === F.closed[i]) return;
            F.closed[i] = closed;
            if (ab && ab.lights) ab.lights.setClosed(F.id, i, closed);
            const name = F.units.runways[i] ? F.units.runways[i].name : 'THE RUNWAY';
            if (closed) {
                if (friendly) this.tower(F, name + ' CLOSED — ' + (F.id === 'home' ? 'DIVERT TO MIRAMAR OR THE CARRIER' : 'DIVERT'), { say: 'Runway closed.', critical: true, color: '#ff4a3d' });
                else if (this.enabled) this.say('COMMAND', F.name + ' ' + name + ' IS CLOSED — THEIR FIGHTERS WILL HAVE TO COME FROM FURTHER AWAY', { color: '#5dffa0', say: 'Enemy runway closed.' });
                g.events.emit('runwayClosed', F, { rw: i });
            } else {
                const st = F.craters.runwayStatus(i);
                if (friendly) this.tower(F, name + ' OPEN' + (st.craters ? ' — MINIMUM OPERATING STRIP ' + Math.round(st.mos / 50) * 50 + ' METRES, STAY ON THE CENTRELINE' : ''), { say: 'Runway open.', critical: true, color: '#5dffa0' });
                else if (this.enabled && this.time - F.seenT < 600) this.say('INTEL', F.name + ' ' + name + ' IS BACK IN SERVICE', { color: '#ff9f5a', say: false });
                g.events.emit('runwayOpened', F, { rw: i });
            }
            this.crossesDirty = true;
        });
        // the repair estimate, once the attack's over
        if (friendly && F.craters.unrepaired.length && F.fsm.state !== ALERT.ATTACK && this.time - F.repairCallT > 240 && F.crews.active.some(c => c.state === 'working')) {
            F.repairCallT = this.time;
            this.tower(F, 'REPAIR TEAMS ON THE ' + (F.runwayOpen ? 'TAXIWAYS' : 'RUNWAY') + ' — ESTIMATE ' + clock(this.repairEta(F)) + ' TO ' + (F.runwayOpen ? 'CLEAR' : 'REOPEN'), { say: false });
        }
        // air traffic (airtraffic.js) holds while a runway is closed
        const at = g.world && g.world.airTraffic;
        if (at && !at.runwayClosed) at.runwayClosed = (b, rw) => { const FF = this.active ? this.field(b) : null; return !!FF && FF.closed[b.runways.indexOf(rw)]; };
    }

    // seconds until the field's runway reopens (or its pavement is clear), with the crews it has
    repairEta(F) {
        const per = REPAIR.clearing + REPAIR.filling + REPAIR.capping;
        const todo = F.runwayOpen ? F.craters.unrepaired : F.craters.unrepaired.filter(c => c.rw >= 0);
        let need = 0;
        for (const c of todo) need += per * Math.pow(Math.max(c.r, 2) / 4.5, 1.3) * (c.stage === 'open' ? 1 : 0.5);
        if (!F.runwayOpen) need *= 0.6; // (only the strip's craters are needed to reopen)
        return need / Math.max(1, F.crews.active.length) + 30;
    }

    updateScrambles(F, dt) {
        for (let i = F.scrambles.length - 1; i >= 0; i--) {
            const sc = F.scrambles[i];
            sc.t += dt;
            // the runway cratered under them, or the jets lost: called off
            if (!sc.done && !F.runwayOpen && sc.t < sc.T.roll1) { this.abort(F, sc, 'runway'); F.scrambles.splice(i, 1); continue; }
            if (sc.physical) { if (F.life && !sc.done) F.life.scrambleUpdate(sc, dt); }
            else if (!sc.done && sc.t >= sc.T.airborne) this.airborne(sc);
            if (sc.done && sc.t > sc.T.airborne + 5) F.scrambles.splice(i, 1);
        }
    }
    abort(F, sc, why) {
        sc.done = true; sc.aborted = why;
        if (F.life && sc.physical) F.life.abortScramble(sc);
        for (const j of sc.jets) if (j.state === 'out') F.airwing.back(j, this.time, 4);
        if (F.team !== this.game.war.side && this.enabled && why === 'runway') this.say('INTEL', 'THE SCRAMBLE AT ' + F.name + ' HAS BEEN CALLED OFF — THE RUNWAY IS CUT', { color: '#5dffa0', say: 'Their scramble is off.' });
        this.game.events.emit('scrambleAborted', F, { scramble: sc, why });
    }

    // fires and secondaries on the field
    updateFires(F, dt, cam) {
        const fx = this.game.effects;
        if (F.secondaries) for (let i = F.secondaries.length - 1; i >= 0; i--) {
            const s = F.secondaries[i];
            if (this.time < s.t) continue;
            F.secondaries.splice(i, 1);
            fx.explosion(s.at, s.size);
            fx.debrisBurst(s.at, _v.set(0, 30, 0), 6, 1);
            if (cam && this.game.audio && this.game.audio.boom) this.game.audio.boom(cam.distanceTo(s.at), s.size);
            this.blastNear(F, s.at, 45, 160);
        }
        if (!F.fires || !cam) return;
        for (let i = F.fires.length - 1; i >= 0; i--) {
            const f = F.fires[i];
            if (this.time > f.until) { F.fires.splice(i, 1); continue; }
            const d = f.pos.distanceTo(cam);
            if (d > 15000) continue;
            f.col -= dt;
            if (f.col <= 0) { f.col = 50; fx.smokeColumn(_v.copy(f.pos).setY(F.base.h + 2), f.size, 60); }
            f.puff -= dt;
            if (f.puff <= 0 && d < 5000) { f.puff = 0.2; fx.puffFire(_v.copy(f.pos).add(_v2.set(rand(-8, 8), rand(0, 3), rand(-8, 8))), _v2.set(0, rand(5, 9), 0), rand(4, 7) * f.size, 0.8); }
        }
    }

    // the field's power: lights, radars; blackout and searchlights at night
    updatePower(F) {
        const g = this.game, ab = g.world && g.world.airbases, war = g.war;
        const powered = !F.units.power || F.units.power.alive;
        if (powered !== F.powered) {
            F.powered = powered;
            if (ab && ab.lights) ab.lights.setPower(F.id, powered);
        }
        // radars on the field's mains: dark without it (war.coverage skips units marked unpowered)
        const rad = F.units.radar;
        if (rad) rad.unpowered = !powered;
        for (const t of F.fieldRadars || []) t.unpowered = !powered;
        if (F.info) F.info.radarStopped = !powered || (rad && !rad.alive);
        // blackout: at night, under attack (or with raiders close)
        const night = this.night();
        const bo = night && (F.fsm.state === ALERT.ATTACK || (F.fsm.state === ALERT.ALERT && F.threatDist < 25000));
        if (bo !== F.blackout) { F.blackout = bo; if (ab && ab.lights) ab.lights.setBlackout(F.id, bo); if (F.info) F.info.blackout = bo; }
        if (ab && ab.lights) ab.lights.setSearch(F.id, night && F.fsm.state >= ALERT.ALERT && F.fsm.state !== ALERT.DAMAGED, F.threats);
        // air-defence readiness: crews at their guns and launchers on alert
        const ready = F.fsm.state === ALERT.ALERT || F.fsm.state === ALERT.ATTACK ? 1 : 0.35;
        for (const t of F.units.aaa) t.readiness = ready;
        for (const t of F.units.pads) t.readiness = ready;
        void war;
    }

    // the player's jet rolling into a crater: wrecked or badly damaged
    playerCraters() {
        const g = this.game, p = g.player;
        if (!p || !p.alive || !p.onGround || p.deck || g.pilotMode) return;
        const sp = p.speed || 0;
        if (sp < 2.5) return;
        const F = this.fieldAt(p.pos, 0);
        if (!F) return;
        const { lx, lz } = F.local(p.pos);
        const c = F.craters.at(lx, lz, (p.spec.span || 10) * 0.2);
        if (!c || p._craterHit === c) return;
        p._craterHit = c;
        g.shake = Math.min(1.5, (g.shake || 0) + 1.2);
        g.effects.dustBurst(_v.copy(p.pos).setY(F.base.h), 0.8, 1);
        if (sp > 32 || c.stage === 'open' && sp > 22) {
            g.addFeed('ROLLED INTO A CRATER', '#ff4a3d');
            p.crash();
        } else {
            p.damage(p.maxHealth * clamp(sp / 30, 0.18, 0.85), null, 'crash');
            p.relSpeed = (p.relSpeed || sp) * 0.15; p.vel.multiplyScalar(0.15);
            g.addFeed('GEAR DAMAGED — ROLLED INTO A CRATER', '#ff4a3d');
            g.audio && g.audio.thud && g.audio.thud(0.9);
        }
    }

    // ═════════════ The crater view ═════════════
    pavementChanged(F) { F.dirty = true; this.viewDirty = true; this.crossesDirty = true; }
    syncView(force) {
        const v = this.view;
        if (!v) return;
        let any = force || this.viewDirty;
        for (const F of this.fields) if (F.craters.version !== F.version) { F.version = F.craters.version; any = true; }
        // (repairs animate the fill and the debris: a few times a second is plenty)
        this.viewT = (this.viewT ?? 0) - 1;
        if (!any) {
            if (!this.fields.some(F => F.crews.active.some(c => c.working))) return;
            if (this.viewT > 0) return;
        }
        this.viewT = 8;
        this.viewDirty = false;
        const entries = [];
        for (const F of this.fields) {
            const b = F.base, y0 = b.h;
            for (const c of F.craters.craters) {
                const w = baseToWorld(b, c.lx, c.lz);
                const Fr = c.rw >= 0 ? F.craters.frames[c.rw] : null;
                const yaw = -b.heading + (Fr ? -(b.runways[c.rw].rot || 0) : 0);
                entries.push({ c, x: w.x, z: w.z, y: y0 + (c.surface === 'runway' || c.rw >= 0 ? 0.15 : 0.1), yaw });
            }
        }
        v.sync(entries);
        if (this.crossesDirty) {
            this.crossesDirty = false;
            const xs = [];
            for (const F of this.fields) F.base.runways.forEach((rw, i) => {
                if (!F.closed[i]) return;
                const Fr = F.craters.frames[i];
                for (const v0 of [Fr.half - 90, -(Fr.half - 90)]) {
                    const lx = Fr.cx + v0 * Fr.s, lz = Fr.cz + v0 * Fr.c, w = baseToWorld(F.base, lx, lz);
                    xs.push({ x: w.x, z: w.z, y: F.base.h + 0.17, yaw: -F.base.heading - (rw.rot || 0) });
                }
            });
            v.setCrosses(xs);
        }
    }

    // ═════════════ HUD ═════════════
    drawHud(ctx, hud) {
        const g = this.game;
        if (!this.active || g.photo || g.hideHud || !g.player || (g.indoors && g.indoors.kind === 'room')) return; // (not in a room: its own display has the corner)
        const P = g.pilotMode ? g.pilotMode.pos : g.player.pos;
        let F = null, bd = 22000;
        for (const f of this.fields) { const d = Math.hypot(P.x - f.base.x, P.z - f.base.z); if (d < bd && (f.team === g.war.side || this.enabled)) { bd = d; F = f; } }
        if (!F) return;
        const friendly = F.team === g.war.side;
        if (!friendly && this.time - F.seenT > 30 && bd > 12000) return;
        const lines = [];
        const st = F.stateName;
        lines.push({ t: (friendly ? '' : 'ENEMY ') + F.name + ' · ' + (st === 'ATTACK' ? 'ALARM RED' : st === 'ALERT' ? 'ALARM YELLOW' : st), c: COL[st] });
        F.base.runways.forEach((rw, i) => {
            const s = F.craters.runwayStatus(i);
            if (!s.craters && !F.closed[i]) return;
            const name = F.units.runways[i] ? F.units.runways[i].name : 'RWY';
            lines.push({ t: name + (F.closed[i] ? ' CLOSED' : ' OPEN') + ' · ' + s.craters + ' CRATER' + (s.craters === 1 ? '' : 'S') + (F.closed[i] && F.crews.active.length ? ' · REOPEN ~' + clock(this.repairEta(F)) : F.closed[i] ? '' : ' · MOS ' + Math.round(s.mos) + ' M'), c: F.closed[i] ? '#ff4a3d' : '#ffd24a' });
        });
        const flags = [];
        if (!F.powered) flags.push('POWER OUT');
        if (!F.towerUp) flags.push('TOWER DOWN');
        if (F.units.fuel.length && F.fuelFrac < 1) flags.push('FUEL ' + Math.round(F.fuelFrac * 100) + '%');
        if (F.units.igloos.length && F.ammoFrac < 1) flags.push('AMMO ' + Math.round(F.ammoFrac * 100) + '%');
        if (F.airwing && this.enabled) flags.push((friendly ? 'ALERT JETS ' : 'THEIR ALERT JETS ') + F.airwing.alertReady.length);
        for (const s of F.scrambles) if (!s.done) flags.push('SCRAMBLE ' + clock(Math.max(0, s.T.airborne - s.t)));
        if (flags.length) lines.push({ t: flags.join(' · '), c: '#cfd8e0' });
        ctx.save();
        ctx.font = '600 12px "Share Tech Mono", ui-monospace, monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        let y = (hud.compact ? 150 : 190) + 20 * ((g.strikes && g.strikes.strikes ? g.strikes.strikes.filter(s => !s.done && s.team === g.war.side).length : 0));
        for (const l of lines) {
            const w = ctx.measureText(l.t).width;
            ctx.fillStyle = 'rgba(8,14,20,0.45)'; ctx.fillRect(14, y - 9, w + 12, 18);
            ctx.fillStyle = l.c; ctx.fillText(l.t, 20, y);
            y += 20;
        }
        // landing on a closed runway: a warning in the middle of the HUD
        const p = g.player;
        if (friendly && F.closed.some(Boolean) && !g.pilotMode && p.alive && !p.onGround && p.gear && bd < 9000 && (p.pos.y - F.base.h) < 900 && Math.floor(g.time * 2) % 2 === 0) {
            ctx.font = '700 18px "Share Tech Mono", ui-monospace, monospace'; ctx.textAlign = 'center';
            ctx.fillStyle = '#ff4a3d'; ctx.fillText('RUNWAY CLOSED — GO AROUND', hud.w / 2, hud.h * 0.3);
        }
        ctx.restore();
    }

    // ═════════════ Tactical map ═════════════
    drawMap(ctx, map) {
        if (!this.active) return;
        const g = this.game, war = g.war, P = {}, Q = {};
        ctx.save();
        ctx.font = '600 10px "Share Tech Mono", monospace'; ctx.textBaseline = 'middle';
        for (const F of this.fields) {
            const friendly = F.team === war.side;
            const known = friendly || this.time - F.seenT < 900;
            map.toScreen(F.base.x, F.base.z, P);
            // alert ring
            const st = F.stateName;
            if (st !== 'NORMAL' && (friendly || known)) {
                const flash = st === 'ATTACK' ? 0.5 + 0.5 * Math.sin(g.time * 8) : 1;
                ctx.strokeStyle = COL[st]; ctx.globalAlpha = 0.35 + 0.5 * flash; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.arc(P.x, P.y, Math.max(18, F.base.r * 1.2 * map.scale), 0, Math.PI * 2); ctx.stroke();
                ctx.globalAlpha = 1;
                ctx.fillStyle = COL[st]; ctx.textAlign = 'left';
                ctx.fillText((st === 'ATTACK' ? 'ALARM RED' : st === 'ALERT' ? 'ALERT' : 'DAMAGED'), P.x + 14, P.y + 32);
            }
            if (!known) continue;
            // closed runways and craters (zoomed in: each crater)
            F.base.runways.forEach((rw, i) => {
                if (!F.closed[i]) return;
                const Fr = F.craters.frames[i];
                const e1 = fromRunway(Fr, 0, Fr.half), e2 = fromRunway(Fr, 0, -Fr.half);
                const a = baseToWorld(F.base, e1.lx, e1.lz), b2 = baseToWorld(F.base, e2.lx, e2.lz);
                map.toScreen(a.x, a.z, P); map.toScreen(b2.x, b2.z, Q);
                ctx.strokeStyle = '#ff4a3d'; ctx.lineWidth = Math.max(2, 55 * map.scale); ctx.setLineDash([6, 5]);
                ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(Q.x, Q.y); ctx.stroke(); ctx.setLineDash([]);
                ctx.fillStyle = '#ff4a3d'; ctx.textAlign = 'center';
                ctx.fillText('CLOSED', (P.x + Q.x) / 2 + 22, (P.y + Q.y) / 2);
            });
            if (map.scale > 0.02) for (const c of F.craters.craters) {
                const w = baseToWorld(F.base, c.lx, c.lz);
                map.toScreen(w.x, w.z, P);
                const s = Math.max(2.5, c.r * map.scale);
                ctx.strokeStyle = c.stage === 'repaired' ? 'rgba(160,170,160,0.6)' : c.stage === 'open' ? '#ff4a3d' : '#ffd24a'; ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.moveTo(P.x - s, P.y - s); ctx.lineTo(P.x + s, P.y + s); ctx.moveTo(P.x + s, P.y - s); ctx.lineTo(P.x - s, P.y + s); ctx.stroke();
            }
            if (map.scale > 0.012) for (const c of F.crews.active) {
                const w = baseToWorld(F.base, c.lx, c.lz);
                map.toScreen(w.x, w.z, P);
                ctx.fillStyle = friendly ? '#6fb4ff' : '#ff9f5a';
                ctx.fillRect(P.x - 2.5, P.y - 2.5, 5, 5);
                if (map.scale > 0.05) { ctx.textAlign = 'left'; ctx.fillText('REPAIR ' + c.id, P.x + 5, P.y); }
            }
        }
        ctx.restore();
    }

    mapInfo(sel) {
        if (!sel || sel.kind !== 'unit' || !sel.unit || !sel.unit.field) return null;
        const u = sel.unit, F = u.field, out = [];
        if (u.cls === 'runway') {
            const s = F.craters.runwayStatus(u.i);
            out.push({ text: (F.closed[u.i] ? 'CLOSED' : 'OPEN') + ' — LONGEST CLEAR STRIP ' + Math.round(s.mos) + ' M (NEEDS ' + MOS_LENGTH + ')', color: F.closed[u.i] ? '#ff4a3d' : '#5dffa0' });
            out.push({ text: s.craters + ' UNREPAIRED CRATER' + (s.craters === 1 ? '' : 'S') + ' · ' + F.crews.active.length + ' REPAIR TEAM' + (F.crews.active.length === 1 ? '' : 'S') });
            if (F.closed[u.i] && F.crews.active.length) out.push({ text: 'REOPENS IN ~' + clock(this.repairEta(F)) });
        }
        out.push({ text: F.name + ' · ' + F.stateName, color: COL[F.stateName] });
        return out;
    }

    commands() {
        if (!this.enabled) return [];
        const g = this.game, war = g.war, out = [];
        for (const F of this.fields) {
            if (F.team !== war.side) continue;
            const st = F.base.runways.map((rw, i) => F.closed[i]).some(Boolean) ? 'RUNWAY CLOSED' : 'OPEN';
            out.push({ path: ['AIRFIELDS'], label: F.name + ' — ' + F.stateName, hint: st + (F.airwing ? ' · ALERT JETS ' + F.airwing.alertReady.length : ''), run: () => { g.navTarget = { pos: new THREE.Vector3(F.base.x, F.base.h, F.base.z), label: F.name, steer: true }; } });
        }
        return out;
    }

    // ═════════════ Tasks ═════════════
    addTaskGenerators() {
        const self = this, T = this.game.tasks;
        // our runway is cratered and the crews are out: cover them (an attack on them comes, sometimes)
        T.addGenerator((tasks, g) => {
            if (!self.enabled) return null;
            for (const F of self.fields) {
                if (F.team !== g.war.side || F.runwayOpen || F.fsm.state === ALERT.ATTACK || !F.crews.active.length || F.coverTasked) continue;
                if (!tasks.canOffer(true)) return null;
                F.coverTasked = true;
                const threat = Math.random() < 0.7 ? self.attackOnCrews(F) : null;
                return {
                    type: 'basecover', key: 'basecover:' + F.id + ':' + Math.round(self.time), urgent: true, title: 'COVER THE RUNWAY REPAIR AT ' + F.name,
                    brief: F.name + '\'S RUNWAY IS CRATERED AND CLOSED. THE REPAIR TEAMS ARE OUT' + (threat ? ' AND ENEMY ATTACK AIRCRAFT ARE COMING FOR THEM' : '') + '. KEEP THEM ALIVE UNTIL THE RUNWAY REOPENS (~' + clock(self.repairEta(F)) + ').',
                    pos: () => F.w(0, 0), reward: 800, label: 'REPAIRS', expires: 200, data: { field: F, flight: threat },
                    progress: () => (F.runwayOpen ? 'RUNWAY OPEN' : 'REOPENS ~' + clock(self.repairEta(F))) + ' · ' + F.crews.active.length + ' TEAM' + (F.crews.active.length === 1 ? '' : 'S'),
                    onEnd: () => { F.coverTasked = false; },
                    check: () => (F.runwayOpen ? 'done:THE RUNWAY IS OPEN AGAIN' : !F.crews.active.length ? 'failed:THE REPAIR TEAMS ARE GONE' : null),
                };
            }
            return null;
        });
        // their field is scrambling (or at alert): crater the runway before the jets get off
        T.addGenerator((tasks, g) => {
            if (!self.enabled) return null;
            for (const F of self.fields) {
                if (F.team === g.war.side || !F.runwayOpen || F.cutTasked) continue;
                const sc = F.scrambles.find(s => !s.done);
                const alert = F.fsm.state === ALERT.ALERT || F.fsm.state === ALERT.ATTACK;
                if (!sc && !alert) continue;
                if (!tasks.canOffer(!!sc)) return null;
                F.cutTasked = true;
                const rw = F.units.runways[0];
                const limit = sc ? Math.max(40, sc.T.roll1 - sc.t) : 0;
                return {
                    type: 'cutrunway', key: 'cutrunway:' + F.id + ':' + Math.round(self.time), urgent: !!sc, title: sc ? 'CRATER THE RUNWAY AT ' + F.name + ' BEFORE THEIR SCRAMBLE' : 'CLOSE THE RUNWAY AT ' + F.name,
                    brief: (sc ? 'THEIR ALERT PAIR IS STARTING ENGINES. ' : F.name + ' IS AT ALERT. ') + 'CUT THE RUNWAY: BOMBS ACROSS IT IN TWO PLACES (A THIRD AND TWO THIRDS DOWN) LEAVE NO 1200 M STRIP — OR MARK IT AND CALL A RUNWAY ATTACK.',
                    units: rw ? [] : [], pos: () => F.w(0, 0), reward: sc ? 900 : 650, label: 'RUNWAY', expires: sc ? limit : 240, data: { field: F, scramble: sc },
                    progress: () => { const s = F.craters.runwayStatus(0); return 'LONGEST CLEAR STRIP ' + Math.round(s.mos) + ' M' + (sc && !sc.done ? ' · WHEELS UP ' + clock(sc.T.airborne - sc.t) : ''); },
                    onEnd: () => { F.cutTasked = false; },
                    check: () => (!F.runwayOpen ? 'done:THEIR RUNWAY IS CLOSED' + (sc && !sc.done ? ' — THE SCRAMBLE IS OFF' : '') : sc && sc.done && !sc.aborted ? 'failed:THEIR FIGHTERS ARE AIRBORNE' : null),
                };
            }
            return null;
        });
        // their repair crews are out on the runway: stop them
        T.addGenerator((tasks, g) => {
            if (!self.enabled) return null;
            for (const F of self.fields) {
                if (F.team === g.war.side || F.runwayOpen || F.stopTasked || self.time - F.seenT > 600) continue;
                const vehicles = F.life ? F.life.crewTargets() : [];
                if (!vehicles.length || !tasks.canOffer()) continue;
                F.stopTasked = true;
                return {
                    type: 'stoprepair', key: 'stoprepair:' + F.id + ':' + Math.round(self.time), title: 'STOP THE REPAIRS AT ' + F.name,
                    brief: 'THEIR RUNWAY REPAIR TEAMS ARE FILLING THE CRATERS (~' + clock(self.repairEta(F)) + ' TO REOPEN). HIT THE LOADERS AND DUMP TRUCKS ON THE RUNWAY.',
                    units: vehicles, need: Math.max(1, Math.ceil(vehicles.length * 0.6)), reward: 600, label: 'REPAIR CREWS', expires: 240,
                    progress: (t) => t.units.filter(u => !u.alive).length + '/' + t.units.length + ' VEHICLES · REOPENS ~' + clock(self.repairEta(F)),
                    onEnd: () => { F.stopTasked = false; },
                    check: () => (F.runwayOpen ? 'failed:THEIR RUNWAY IS OPEN AGAIN' : null),
                };
            }
            return null;
        });
        // the enemy field's alert shelters: catch the alert jets on the ground
        T.addGenerator((tasks, g) => {
            if (!self.enabled || g.war.time < 240) return null;
            for (const F of self.fields) {
                if (F.team === g.war.side || F.qraTasked || !F.airwing || F.fsm.state !== ALERT.ALERT) continue;
                const qra = [...F.units.shelters.values()].filter(u => u.alive && F.airwing.shelter(u.sid) && F.airwing.shelter(u.sid).qra && F.airwing.shelter(u.sid).jet);
                if (!qra.length || !tasks.canOffer()) continue;
                F.qraTasked = true;
                return {
                    type: 'qra', key: 'qra:' + F.id + ':' + Math.round(self.time), title: 'STRIKE THE ALERT SHELTERS AT ' + F.name,
                    brief: F.name + ' IS AT ALERT WITH ITS ALERT PAIR IN THE TWO SHELTERS BY THE RUNWAY END. PUT PENETRATORS OR A STICK OF BOMBS ON THEM BEFORE THEY LAUNCH.',
                    units: qra, reward: 900, label: 'ALERT SHELTERS', expires: 240,
                    progress: (t) => t.units.filter(u => !u.alive).length + '/' + t.units.length,
                    onEnd: () => { F.qraTasked = false; },
                };
            }
            return null;
        });
    }

    // enemy attack aircraft sent against a field's repair crews
    attackOnCrews(F) {
        const g = this.game, d = g.director;
        if (!d || !d.spawnFlight || !d.redOrigin) return null;
        const at = F.w(0, 0);
        const from = d.redOrigin(at);
        const dir = _v.subVectors(at, from).setY(0).normalize();
        const start = from.clone().addScaledVector(dir, 5000); start.y = Math.max(terrainHeight(start.x, start.z), 0) + 1200;
        const f = d.spawnFlight({ team: F.team === 'blue' ? 'red' : 'blue', role: 'cas', types: ['su35', 'mig29'], pos: start, speed: 230, skill: d.redSkill ? d.redSkill() : 0.6,
            route: [{ p: new THREE.Vector3(at.x, F.base.h + 900, at.z) }], target: { pos: at.clone(), unit: null, label: F.name + ' REPAIR CREWS', kind: 'base', base: F.base }, callsign: 'STRIKE' });
        f.home = d.homeFor ? d.homeFor('red', from) : from;
        return f;
    }
}

// the camera position (or null)
function camPos(g) { return g.camera ? g.camera.position : null; }
function typeName(id) {
    const n = { f16: 'F-16', f15: 'F-15', mig29: 'MIG-29', su35: 'SU-35', su57: 'SU-57', j20: 'J-20' };
    return n[id] || String(id).toUpperCase();
}
export { ALERT, ALERT_NAMES };
